/**
 * Host git-history Remote owner: a bounded commit-log verb and a commit-detail
 * verb, both fenced to the calling session's workspace root. The browser cannot
 * run git or read a repository, so every commit, parent link, ref, message, and
 * diff fact crosses this wire namespace; nothing renders on the host display.
 * The fence decision (which `.git` entry the host may run git against) and the
 * failure vocabulary are recorded in the git-history Agent Note.
 * @module @deepseek-ai/dsh-api-git-controller
 */

import { execFile } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify, TextDecoder } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, RemoteError, TypertRemoteService, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteErrorDetailsMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GitCommit,
  GitCommitDetail,
  GitErrorCode,
  GitFileChange,
  GitFileStatus,
  GitLogOptions,
  GitLogResult,
  GitRef,
  GitShowResult,
} from './types.ts'

export type * from './types.ts'

const execFileAsync = promisify(execFile)

/** Git flags that disable hooks, fsmonitor, and path quoting, and skip optional locks. */
const GIT_SAFE_ARGS = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotePath=false',
  '--no-optional-locks',
]

/** Max bytes of one git subprocess stdout before the run is treated as a failure. */
const GIT_MAX_BUFFER = 32 * 1024 * 1024

/** The commit log record layout: NUL-separated fields, newest first. */
const GIT_LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x00'

/** The commit-detail layout: NUL-separated fields ending in the raw message and refs. */
const GIT_SHOW_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x00%D'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host git-history Remote namespace owner. */
    gitController: GitController
  }
}

/** Typed failure thrown by the git primitives so consumers can map business codes without string matching. */
export class GitError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param details - code-typed wire details.
   * @param message - operator-facing description.
   */
  constructor(readonly code: GitErrorCode, readonly details: RemoteErrorDetailsMap[GitErrorCode], message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/** Validated plugin configuration. */
export interface Config {
  /** Commit bound of one log call; the extra probe record proves truncation. */
  readonly maxCount: number
  /** `true` requests all refs, not just HEAD's ancestry. */
  readonly all: boolean
  /** `true` follows only the first parent, collapsing merges to the mainline. */
  readonly firstParent: boolean
  /** Byte bound of one commit's unified patch. */
  readonly maxDiffBytes: number
}

/** True when `target` is `root` or a descendant, both already normalized. */
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation itself
 * keeps running and its late settlement is swallowed here.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => {
      operation.catch(() => {})
      rejectPromise(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(asError(reason))
      },
    )
  })
}

/** The thrown value as an Error (abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when the error is the child-process ENOENT of a missing `git` binary. */
function isMissingGit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * Fold the `%D` decoration of one commit into refs. `HEAD -> main` yields a
 * `head` ref (`HEAD`) plus a `branch` ref (`main`); full ref names fold
 * to their short name plus kind. Unknown shapes are dropped, never surfaced raw.
 * @param raw - the comma-space separated decoration field (empty when undecorated).
 * @returns the folded refs, in decoration order.
 */
export function parseRefs(raw: string): GitRef[] {
  if (raw === '') return []
  const refs: GitRef[] = []
  for (const token of raw.split(',')) {
    const item = token.trim()
    if (item === '') continue
    const arrow = item.indexOf(' -> ')
    if (arrow !== -1) {
      const left = item.slice(0, arrow)
      const right = item.slice(arrow + 4)
      if (left === 'HEAD') refs.push({ name: 'HEAD', kind: 'head' })
      // The right side always names the branch HEAD points at: short in the
      // short decoration, refs/heads/… in the full decoration this controller uses.
      const branch = right.startsWith('refs/heads/') ? right.slice(11) : right
      if (branch !== '') refs.push({ name: branch, kind: 'branch' })
      continue
    }
    const folded = foldRef(item)
    if (folded !== undefined) refs.push(folded)
  }
  return refs
}

/** Fold one decoration token to its short name plus kind, or drop unknown shapes. */
function foldRef(name: string): GitRef | undefined {
  if (name === 'HEAD') return { name: 'HEAD', kind: 'head' }
  if (name.startsWith('refs/heads/')) return { name: name.slice(11), kind: 'branch' }
  if (name.startsWith('refs/tags/')) return { name: name.slice(10), kind: 'tag' }
  if (name.startsWith('refs/remotes/')) return { name: name.slice(13), kind: 'remote' }
  if (name.startsWith('tag: ')) return { name: name.slice(5), kind: 'tag' }
  return undefined
}

/**
 * Parse one `git log` stdout in the NUL-delimited record format into commits.
 * Each record is seven fields (hash, parents, author name, author email, author
 * seconds, subject, decoration) followed by `-z`'s record separator NUL.
 * @param stdout - decoded log output.
 * @returns the commits, newest first.
 */
export function parseLog(stdout: string): GitCommit[] {
  const segments = stdout.split('\0')
  const commits: GitCommit[] = []
  for (let index = 0; index + 7 <= segments.length;) {
    const [hash, parents, authorName, authorEmail, authorTime, subject, refs] = segments.slice(index, index + 7) as [
      string, string, string, string, string, string, string,
    ]
    commits.push({
      hash,
      parents: parents === '' ? [] : parents.split(' '),
      authorName,
      authorEmail,
      authorTime: Number(authorTime) * 1000,
      subject,
      refs: parseRefs(refs),
    })
    index += 7
    // `-z` separates records with one extra NUL after the format's own trailing NUL.
    if (index < segments.length && segments[index] === '') index += 1
  }
  return commits
}

/**
 * Split `%B`'s raw message into its first-line subject and the remaining body.
 * @param raw - raw message with one trailing newline.
 * @returns the subject and the body (body is empty for a one-line message).
 */
function splitMessage(raw: string): { subject: string; body: string } {
  const message = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  const newline = message.indexOf('\n')
  if (newline < 0) return { subject: message, body: '' }
  const subject = message.slice(0, newline)
  const body = message.slice(newline + 1).replace(/^\n/, '')
  return { subject, body }
}

/**
 * Parse one `git show -s` metadata stdout into a commit detail. The ten
 * NUL-separated fields end with the raw `%B` message and the `%D` refs.
 * @param stdout - decoded `git show -s` output.
 * @returns the commit detail with the full message split into subject and body.
 */
function parseShowMetadata(stdout: string): GitCommitDetail {
  const [hash, parents, authorName, authorEmail, authorTime, committerName, committerEmail, committerTime, message, refsRaw] = stdout.split('\0') as [
    string, string, string, string, string, string, string, string, string, string,
  ]
  const { subject, body } = splitMessage(message)
  return {
    hash,
    parents: parents === '' ? [] : parents.split(' '),
    authorName,
    authorEmail,
    authorTime: Number(authorTime) * 1000,
    committerName,
    committerEmail,
    committerTime: Number(committerTime) * 1000,
    subject,
    body,
    refs: parseRefs(refsRaw.trim()),
  }
}

/** Fold one `--name-status` code to its closed status, or drop unknown shapes. */
function foldFileStatus(code: string): GitFileStatus | undefined {
  if (code.startsWith('A')) return 'added'
  if (code.startsWith('D')) return 'deleted'
  if (code.startsWith('M')) return 'modified'
  if (code.startsWith('R')) return 'renamed'
  if (code.startsWith('C')) return 'copied'
  if (code.startsWith('T')) return 'typechanged'
  if (code.startsWith('U')) return 'unmerged'
  return undefined
}

/**
 * Parse one `git show --name-status` stdout into file changes. A rename or
 * copy emits three tab-separated fields (status, old path, new path); every
 * other status emits two.
 * @param stdout - decoded name-status output.
 * @returns the changed files, in git's diff order.
 */
export function parseNameStatus(stdout: string): GitFileChange[] {
  const changes: GitFileChange[] = []
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const [code, ...paths] = line.split('\t')
    const status = foldFileStatus(code ?? '')
    if (status === undefined) continue
    if (paths.length >= 2 && paths[0] !== undefined && paths[1] !== undefined) {
      changes.push({ path: paths[1], status, previousPath: paths[0] })
    } else if (paths.length === 1 && paths[0] !== undefined) {
      changes.push({ path: paths[0], status })
    }
  }
  return changes
}

/**
 * Read the `gitdir:` target of a `.git` file, resolved against its directory.
 * @param dotGit - absolute path of the `.git` file.
 * @param signal - caller lifetime.
 * @returns the resolved gitdir, or undefined when the file is unreadable or malformed.
 */
async function readGitdir(dotGit: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const content = await raceAbort(readFile(dotGit, 'utf8'), signal)
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(content)
    if (match === null) return undefined
    const gitdir = match[1]
    if (gitdir === undefined) return undefined
    return resolve(dirname(dotGit), gitdir)
  } catch {
    if (signal.aborted) throw asError(signal.reason)
    return undefined
  }
}

/**
 * Decide whether the host may run git against the repo owning the fence root.
 * Walking up from the fence root, a `.git` DIRECTORY is the enclosing repo; a
 * `.git` FILE (gitlink / linked worktree / submodule) is followed only when
 * its resolved gitdir stays within the fence root, and a gitdir whose real
 * path escapes the fence is a loud `git/outside-root` failure.
 * @param fenceRoot - realpath'd session cwd bounding what git may read.
 * @param signal - caller lifetime.
 * @returns true when a followable repo owns the fence root.
 */
async function discoverGate(fenceRoot: string, signal: AbortSignal): Promise<boolean> {
  let dir = fenceRoot
  for (;;) {
    const dotGit = join(dir, '.git')
    let info: Stats | undefined
    try {
      info = await raceAbort(lstat(dotGit), signal)
    } catch {
      if (signal.aborted) throw asError(signal.reason)
      info = undefined
    }
    if (info !== undefined) {
      if (info.isDirectory()) return true
      if (info.isFile()) {
        const gitdir = await readGitdir(dotGit, signal)
        // An unreadable gitlink, or one resolving outside the fence, is not
        // followed; keep walking toward the filesystem root.
        if (gitdir !== undefined && within(fenceRoot, gitdir)) {
          const real = await raceAbort(realpath(gitdir), signal).catch(() => undefined)
          if (real !== undefined && !within(fenceRoot, real)) {
            throw new GitError('git/outside-root', { path: real }, 'git worktree "' + real + '" escapes the session fence')
          }
          return true
        }
      }
    }
    signal.throwIfAborted()
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** One `git rev-parse` discovery result. */
interface RevParseFacts {
  /** Worktree top-level; may lie above the fence root. */
  readonly toplevel: string
  /** The resolved `.git` directory path. */
  readonly gitdir: string
  /** `--abbrev-ref HEAD`: the branch short name, or `HEAD` when detached/unborn. */
  readonly branch: string
}

/** Run one discovery `git rev-parse` at the fence root. */
async function revParse(fenceRoot: string, signal: AbortSignal): Promise<RevParseFacts> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', fenceRoot, ...GIT_SAFE_ARGS, 'rev-parse', '--show-toplevel', '--absolute-git-dir', '--abbrev-ref', 'HEAD'],
    { signal, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
  )
  const [toplevel, gitdir, branch] = stdout.split('\n') as [string, string, string]
  return { toplevel, gitdir, branch }
}

/** Run one `git rev-parse HEAD`; absent when the branch is unborn. */
async function headHashOf(fenceRoot: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', fenceRoot, ...GIT_SAFE_ARGS, 'rev-parse', 'HEAD'],
      { signal, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
    )
    return stdout.trim()
  } catch (_headError) {
    if (signal.aborted) throw asError(signal.reason)
    // An unborn branch (empty repo) has no HEAD; any other HEAD failure is also
    // reported as no headHash and the log itself decides the error context.
    return undefined
  }
}

/** One bounded commit log run: the truncated-flag probe plus the parsed window. */
interface LogOutcome {
  readonly commits: GitCommit[]
  readonly truncated: boolean
}

/** Run one `git log` at the fence root with the stable NUL-delimited format. */
async function runLog(
  fenceRoot: string,
  maxCount: number,
  all: boolean,
  firstParent: boolean,
  signal: AbortSignal,
): Promise<LogOutcome> {
  // Probe one extra record so a full window can prove it was cut without a second call.
  const args = [
    '-C', fenceRoot, ...GIT_SAFE_ARGS,
    'log', '--topo-order', '-z', '--decorate=full',
    ...(firstParent ? ['--first-parent'] : []),
    '--max-count=' + String(maxCount + 1),
    ...(all ? ['--all'] : []),
    '--format=' + GIT_LOG_FORMAT,
  ]
  const { stdout } = await execFileAsync('git', args, {
    signal,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'utf8',
  })
  const parsed = parseLog(stdout)
  // `--first-parent` only narrows traversal; `%P` still lists a merge's other
  // parents, whose commits are absent from this window. Trimming to the first
  // parent keeps every parent reference resolvable so the graph stays linear.
  const commits = firstParent
    ? parsed.map(commit => ({ ...commit, parents: commit.parents.slice(0, 1) }))
    : parsed
  const truncated = commits.length > maxCount
  return { commits: truncated ? commits.slice(0, maxCount) : commits, truncated }
}

/** Run one `git show -s` and parse the commit metadata. */
async function showMetadata(fenceRoot: string, hash: string, signal: AbortSignal): Promise<GitCommitDetail> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', fenceRoot, ...GIT_SAFE_ARGS, 'show', '-s', '--format=' + GIT_SHOW_FORMAT, hash + '^{commit}'],
    { signal, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
  )
  return parseShowMetadata(stdout)
}

/** Run one `git show --name-status` and parse the changed files. */
async function showFiles(fenceRoot: string, hash: string, signal: AbortSignal): Promise<GitFileChange[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', fenceRoot, ...GIT_SAFE_ARGS, 'show', hash, '--format=', '--name-status'],
    { signal, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' },
  )
  return parseNameStatus(stdout)
}

/** One bounded commit diff: the patch bytes and whether they were cut. */
interface DiffOutcome {
  readonly diff: string
  readonly truncated: boolean
}

/** Run one `git show` and bound its patch to `maxDiffBytes`. */
async function showDiff(
  fenceRoot: string,
  hash: string,
  maxDiffBytes: number,
  signal: AbortSignal,
): Promise<DiffOutcome> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', fenceRoot, ...GIT_SAFE_ARGS, 'show', hash, '--format='],
    { signal, maxBuffer: GIT_MAX_BUFFER, encoding: 'buffer' },
  )
  const truncated = stdout.length > maxDiffBytes
  const diff = new TextDecoder('utf-8', { fatal: false }).decode(
    truncated ? stdout.subarray(0, maxDiffBytes) : stdout,
  )
  return { diff, truncated }
}

/** Validate a client-supplied commit hash: abbreviated or full hexadecimal. */
function parseCommitHash(hash: string): string {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) {
    throw new RemoteError('gateway/bad-request', 'invalid commit hash: ' + hash, {})
  }
  return hash
}

/**
 * Classify a primitive's rejection. An abort is the caller's own timeout or
 * disconnect, not a backend failure, so it answers `gateway/cancelled` before
 * the business classification runs.
 * @param error - the primitive's rejection.
 * @param signal - the caller lifetime the primitive ran under.
 * @param cancelled - operator-facing text for the abort outcome.
 * @returns the failure to throw across the Remote boundary.
 */
function cancellableFailure(error: unknown, signal: AbortSignal, cancelled: string): RemoteError {
  if (signal.aborted) return new RemoteError('gateway/cancelled', cancelled, {}, { cause: error })
  // A wire failure thrown at the boundary (payload validation) already carries
  // its code; pass it through rather than re-classifying it as internal.
  const wire = remoteErrorOf(error)
  if (wire !== undefined) return wire
  if (error instanceof GitError) {
    return new RemoteError(error.code, error.message, error.details, { cause: error })
  }
  return new RemoteError('gateway/internal', messageOf(error), {}, { cause: error })
}

/** Empty log result for a `none`/`error` context. */
function emptyResult(vcs: GitLogResult['vcs']): GitLogResult {
  return { vcs, commits: [], truncated: false }
}

/** Empty show result for a `none`/`error` context. */
function emptyShow(vcs: GitShowResult['vcs']): GitShowResult {
  return { vcs, files: [], diff: '', diffTruncated: false }
}

/** Repo context after the fence and discovery steps. */
type ResolvedRepo =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'git'; readonly fenceRoot: string; readonly toplevel: string; readonly gitdir: string; readonly branch: string }

/**
 * Host service backing the generated `ctx.remote.git` namespace. Its two verbs
 * are Agent-scoped: the `agent` lookup resolves the caller's session, whose cwd
 * is the fence root every read is bounded to.
 */
export class GitController extends TypertRemoteService {
  /** `maxCount` bounds the window; `all` selects all refs; `firstParent` follows only the mainline; `maxDiffBytes` bounds one patch. */
  static Config: z<Config> = z.object({
    maxCount: z.natural().min(1).default(200),
    all: z.boolean().default(false),
    firstParent: z.boolean().default(true),
    maxDiffBytes: z.natural().min(1).default(1024 * 1024),
  })

  /** @param ctx - Host context carrying the agent registry that resolves the session. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'gitController', { namespace: 'git' })
  }

  /**
   * Log the workspace repository's commit history for a Remote caller's graph.
   * @param agent - target Agent resolved from the Session identity on the wire; its cwd is the fence root.
   * @param options - commit bound, ref selection, and first-parent collapse; absent applies the configured defaults.
   * @param signal - caller lifetime; abort kills the git child and rejects with the signal reason.
   * @returns the repo context, HEAD facts, and the bounded newest-first commit window.
   */
  @Remote('log')
  async log(agent: Agent, options: GitLogOptions | undefined, signal: AbortSignal): Promise<GitLogResult> {
    try {
      return await this.logHistory(agent, options ?? {}, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'git history log was aborted')
    }
  }

  /**
   * Show one commit's full message and modifications for a Remote caller.
   * @param agent - target Agent resolved from the Session identity on the wire; its cwd is the fence root.
   * @param hash - abbreviated or full commit object id to show.
   * @param signal - caller lifetime; abort kills the git child and rejects with the signal reason.
   * @returns the repo context, the commit detail, its changed files, and the bounded patch.
   */
  @Remote('show')
  async show(agent: Agent, hash: string, signal: AbortSignal): Promise<GitShowResult> {
    try {
      return await this.showCommit(agent, hash, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'git commit show was aborted')
    }
  }

  /** Resolve the repo owning the session cwd, applying the fence decision. */
  private async resolveRepo(agent: Agent, signal: AbortSignal): Promise<ResolvedRepo> {
    const cwd = agent.session.header.cwd ?? process.cwd()
    const fenceRoot = await raceAbort(realpath(cwd), signal)
    if (!(await discoverGate(fenceRoot, signal))) return { kind: 'none' }
    try {
      const facts = await revParse(fenceRoot, signal)
      return { kind: 'git', fenceRoot, toplevel: facts.toplevel, gitdir: facts.gitdir, branch: facts.branch }
    } catch (error) {
      if (signal.aborted) throw asError(signal.reason)
      if (isMissingGit(error)) return { kind: 'none' }
      return { kind: 'error', message: messageOf(error) }
    }
  }

  private async logHistory(agent: Agent, options: GitLogOptions, signal: AbortSignal): Promise<GitLogResult> {
    const repo = await this.resolveRepo(agent, signal)
    if (repo.kind !== 'git') return emptyResult(repo)

    const headHash = await headHashOf(repo.fenceRoot, signal)
    if (headHash === undefined) {
      // An unborn branch (empty repo) has no HEAD and no commits.
      return { vcs: { kind: 'git', root: repo.toplevel, worktree: repo.gitdir }, commits: [], truncated: false }
    }

    const maxCount = options.maxCount ?? this.config.maxCount
    const all = options.all ?? this.config.all
    const firstParent = options.firstParent ?? this.config.firstParent
    let outcome: LogOutcome
    try {
      outcome = await runLog(repo.fenceRoot, maxCount, all, firstParent, signal)
    } catch (error) {
      if (signal.aborted) throw asError(signal.reason)
      // git present but the log command failed: a context, not a thrown error.
      return emptyResult({ kind: 'error', message: messageOf(error) })
    }

    return {
      vcs: { kind: 'git', root: repo.toplevel, worktree: repo.gitdir },
      currentBranch: repo.branch,
      headHash,
      commits: outcome.commits,
      truncated: outcome.truncated,
    }
  }

  private async showCommit(agent: Agent, hash: string, signal: AbortSignal): Promise<GitShowResult> {
    const commitHash = parseCommitHash(hash)
    const repo = await this.resolveRepo(agent, signal)
    if (repo.kind !== 'git') return emptyShow(repo)

    let detail: GitCommitDetail
    try {
      detail = await showMetadata(repo.fenceRoot, commitHash, signal)
    } catch (_showError) {
      if (signal.aborted) throw asError(signal.reason)
      // Discovery already proved the repo valid, so a failed git show of one
      // hash means that hash is not a commit in this repo.
      throw new GitError('git/commit-not-found', { hash: commitHash }, 'commit "' + commitHash + '" was not found')
    }

    try {
      const files = await showFiles(repo.fenceRoot, detail.hash, signal)
      const outcome = await showDiff(repo.fenceRoot, detail.hash, this.config.maxDiffBytes, signal)
      return {
        vcs: { kind: 'git', root: repo.toplevel, worktree: repo.gitdir },
        commit: detail,
        files,
        diff: outcome.diff,
        diffTruncated: outcome.truncated,
      }
    } catch (error) {
      if (signal.aborted) throw asError(signal.reason)
      // git present but the file list or patch failed: a context, not a thrown error.
      return emptyShow({ kind: 'error', message: messageOf(error) })
    }
  }
}

export default GitController
