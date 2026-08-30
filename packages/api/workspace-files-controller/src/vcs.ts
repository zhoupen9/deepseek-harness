/**
 * VCS (git) status decoration for the workspace-files controller: repo
 * discovery, one cached status snapshot per worktree root, and per-entry
 * annotation data. Status is read-only decoration — a missing or broken git
 * degrades to a 'none'/'error' context, never a thrown error.
 * @module @deepseek-ai/dsh-api-workspace-files-controller/vcs
 */

import { execFile } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { VcsContext, VcsFileStatus } from './types.ts'

const execFileAsync = promisify(execFile)

/** Git flags that disable hooks and fsmonitor before reading status. */
const GIT_SAFE_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']

/** How long one worktree-root snapshot is reused before a recompute (the client Refresh falls back to this TTL). */
const VCS_SNAPSHOT_TTL_MS = 2000

/** Max bytes of one `git status` stdout before the run is treated as a failure. */
const GIT_STATUS_MAX_BUFFER = 32 * 1024 * 1024

/** The per-worktree-root status facts a listing annotates entries with. */
export interface VcsSnapshot {
  /** Absolute path -> collapsed status for every porcelain path, ignored included. */
  readonly statusByPath: ReadonlyMap<string, VcsFileStatus>
  /** Absolute directories with a notable (non-ignored) descendant. */
  readonly dirtyDirs: ReadonlySet<string>
}

/** The VCS result one listing consumes: a context plus, under git, the snapshot. */
export interface VcsListing {
  readonly context: VcsContext
  readonly snapshot: VcsSnapshot | undefined
}

/** Validated VCS configuration. */
export interface VcsConfig {
  readonly enabled: boolean
  readonly maxDirtyPaths: number
}

/** True when `target` is `root` or a descendant, both normalized. */
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation keeps
 * running against a handle the caller then closes; its late settlement is
 * swallowed here.
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

/** True when a porcelain XY pair carries a rename, which emits an old-path segment after the new path. */
function isRename(xy: string): boolean {
  return xy[0] === 'R' || xy[1] === 'R'
}

/** Collapse a porcelain XY pair into the v1 single-code enum. */
function collapseStatus(xy: string): VcsFileStatus {
  if (xy === '??') return 'untracked'
  if (xy === '!!') return 'ignored'
  const x = xy.charAt(0)
  const y = xy.charAt(1)
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted'
  if (isRename(xy)) return 'renamed'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'A' || y === 'A') return 'added'
  return 'modified'
}

/** Mark every proper ancestor directory of a notable path, stopping at the worktree root. */
function markAncestors(path: string, root: string, dirtyDirs: Set<string>): void {
  let dir = dirname(path)
  while (dir !== root) {
    dirtyDirs.add(dir)
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/**
 * Parse one `git status --porcelain=v1 -z` output into status facts. A
 * rename emits `XY <new>\0<old>\0`, so the old-path segment carries no
 * status prefix and is skipped. Past `maxDirtyPaths` notable paths the
 * snapshot degrades to empty — the listing stays browsable and status is
 * omitted rather than reported partially.
 * @param root - worktree top-level the porcelain paths are relative to.
 * @param output - NUL-terminated porcelain output.
 * @param maxDirtyPaths - notable-path bound before degradation.
 * @returns the status facts (empty maps when the bound was exceeded).
 */
export function buildSnapshot(root: string, output: string, maxDirtyPaths: number): VcsSnapshot {
  const statusByPath = new Map<string, VcsFileStatus>()
  const dirtyDirs = new Set<string>()
  const segments = output.split('\0')
  let notable = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    // A valid entry is "XY <path>": two status columns, a space, then a path.
    if (segment === undefined || segment.length < 4 || segment[2] !== ' ') continue
    const xy = segment.slice(0, 2)
    const status = collapseStatus(xy)
    const abs = resolve(root, segment.slice(3))
    if (isRename(xy)) index += 1
    statusByPath.set(abs, status)
    if (status === 'ignored') continue
    notable += 1
    if (notable > maxDirtyPaths) {
      return { statusByPath: new Map(), dirtyDirs: new Set() }
    }
    markAncestors(abs, root, dirtyDirs)
  }
  return { statusByPath, dirtyDirs }
}

/**
 * Discover the repo owning `path` by walking up for a `.git` entry. A
 * `.git` FILE (linked worktree / gitlink / submodule) is followed only when
 * its resolved `gitdir:` stays within the fence.
 * @param path - listed directory to start the walk from.
 * @param fenceRoot - session workspace root the gitdir must stay within.
 * @param signal - caller lifetime; every filesystem await races it.
 * @returns the repo context, or `none` when no followable repo is found.
 */
async function discover(path: string, fenceRoot: string, signal: AbortSignal): Promise<VcsContext> {
  let dir = path
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
      if (info.isDirectory()) return { kind: 'git', root: dir, worktree: dotGit }
      if (info.isFile()) {
        const gitdir = await readGitdir(dotGit, signal)
        if (gitdir !== undefined && within(fenceRoot, gitdir)) {
          return { kind: 'git', root: dir, worktree: gitdir }
        }
        // A .git FILE resolving outside the fence is not followed; keep walking.
      }
    }
    signal.throwIfAborted()
    const parent = dirname(dir)
    if (parent === dir) return { kind: 'none' }
    dir = parent
  }
}

/** Read the `gitdir:` target of a `.git` file, resolved against its directory. */
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

/** One cached snapshot with its expiry instant. */
interface CachedSnapshot {
  readonly snapshot: VcsSnapshot
  readonly expiresAt: number
}

/**
 * Per-controller VCS decoration owner. Snapshots are cached per worktree root
 * so two sibling list calls read the same status, and recompute after the TTL.
 */
export class VcsIndex {
  private readonly snapshots = new Map<string, CachedSnapshot>()

  /** @param config - validated VCS configuration. */
  constructor(private readonly config: VcsConfig) {}

  /**
   * Resolve the VCS context for a listed directory and, under git, its snapshot.
   * @param path - absolute listed directory.
   * @param fenceRoot - session workspace root bounding gitdir following.
   * @param signal - caller lifetime; abort propagates instead of degrading.
   * @returns the context (always) and the snapshot (only under git).
   */
  async listing(path: string, fenceRoot: string, signal: AbortSignal): Promise<VcsListing> {
    if (!this.config.enabled) return { context: { kind: 'none' }, snapshot: undefined }
    const context = await discover(path, fenceRoot, signal)
    if (context.kind !== 'git') return { context, snapshot: undefined }
    const outcome = await this.snapshot(context.root, signal)
    if (outcome.kind === 'snapshot') return { context, snapshot: outcome.snapshot }
    return {
      context: outcome.kind === 'none'
        ? { kind: 'none' }
        : { kind: 'error', message: outcome.message },
      snapshot: undefined,
    }
  }

  private async snapshot(
    root: string,
    signal: AbortSignal,
  ): Promise<
    | { readonly kind: 'snapshot'; readonly snapshot: VcsSnapshot }
    | { readonly kind: 'none' }
    | { readonly kind: 'error'; readonly message: string }
  > {
    const now = Date.now()
    const cached = this.snapshots.get(root)
    if (cached !== undefined && cached.expiresAt > now) {
      return { kind: 'snapshot', snapshot: cached.snapshot }
    }
    let snapshot: VcsSnapshot
    try {
      snapshot = await computeSnapshot(root, this.config.maxDirtyPaths, signal)
    } catch (error) {
      if (signal.aborted) throw asError(signal.reason)
      if (isMissingGit(error)) return { kind: 'none' }
      return { kind: 'error', message: messageOf(error) }
    }
    this.snapshots.set(root, { snapshot, expiresAt: now + VCS_SNAPSHOT_TTL_MS })
    return { kind: 'snapshot', snapshot }
  }
}

/** Run one `git status` with the safe flags and build its snapshot. */
async function computeSnapshot(root: string, maxDirtyPaths: number, signal: AbortSignal): Promise<VcsSnapshot> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', root, ...GIT_SAFE_CONFIG, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all', '-z'],
    { signal, maxBuffer: GIT_STATUS_MAX_BUFFER, encoding: 'utf8' },
  )
  return buildSnapshot(root, stdout, maxDirtyPaths)
}
