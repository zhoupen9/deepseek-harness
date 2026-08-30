/**
 * Host workspace-files Remote owner: one-level directory-and-file listing and
 * bounded text reads over the host filesystem, fenced to the calling session's
 * workspace root. The browser cannot touch the filesystem, so every directory
 * and file fact crosses this wire namespace; nothing renders on the host
 * display. Policy decisions (the root fence, symlink handling, the dirs-then-
 * files sort, hidden entries flagged but returned) are recorded in the
 * workspace-files Agent Note.
 * @module @deepseek-ai/dsh-api-workspace-files-controller
 */

import { lstat, opendir, open, realpath, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path'
import { TextDecoder } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { VcsIndex } from './vcs.ts'
import type { VcsConfig } from './vcs.ts'
import type {
  VcsFileStatus,
  WorkspaceFilesContent,
  WorkspaceFilesEntry,
  WorkspaceFilesErrorCode,
  WorkspaceFilesErrorDetailsMap,
  WorkspaceFilesListing,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host workspace-files Remote namespace owner. */
    workspaceFilesController: WorkspaceFilesController
  }
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * Mirrors directory-picker-browse's fence.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
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

/** The thrown value as an Error (wire/abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/* v8 ignore start -- a close failure of an abandoned handle has no consumer, and forcing one needs a filesystem torn down mid-request. */
/** Swallow the close failure of a handle its caller already departed. */
function swallowCloseFailure(): void {}
/* v8 ignore stop */

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}

/** True when `target` is `root` or a descendant, both already normalized. */
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target.
 * @param target - absolute listed directory.
 * @returns the `dir`-kind crumb chain.
 */
function ancestryCrumbs(target: string): WorkspaceFilesEntry[] {
  const crumbs: WorkspaceFilesEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    // basename of a root is '' — label the root crumb by its full path ('/', 'C:\').
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, kind: 'dir', hidden: false })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * Number of content lines in decoded text, matching the client's
 * contentLines convention: empty text is zero lines, a trailing newline is a
 * terminator rather than an extra empty line.
 * @param text - decoded text.
 * @returns the content line count.
 */
function countLines(text: string): number {
  if (text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n').length
}

/** One streamed listing candidate: the facts a tree row needs, nothing else retained. */
export interface Candidate {
  /** Base name within the streamed level. */
  readonly name: string
  /** Kind after any symlink probe. */
  readonly kind: 'dir' | 'file'
  /** Dot-prefix on POSIX; the Windows hidden attribute is not exposed by dirents. */
  readonly hidden: boolean
  /** Regular files defer their size/mtime stat to materialization (only the retained window pays it). */
  readonly needsStat: boolean
  /** Byte size; present for symlink-to-file candidates already probed. */
  readonly size?: number
  /** Last-modified epoch ms; present together with size. */
  readonly modifiedAt?: number
}

/** Canonical ordering: directories before files, each alphabetical. */
function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/**
 * Insert a streamed candidate into the canonical-order bounded window,
 * evicting the largest candidate when the window exceeds `keep`. Memory over
 * an arbitrarily large level therefore stays O(keep).
 * @param window - the canonical-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert(window: Candidate[], candidate: Candidate, keep: number): boolean {
  // Full window, candidate at or beyond the tail: one comparison rejects, so an
  // oversized level costs O(1) per candidate past the head instead of a
  // window scan.
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && compareCandidates(candidate, window[window.length - 1]!) >= 0) return true
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (compareCandidates(candidate, window[mid]!) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/** Typed failure thrown by the workspace-files primitives so consumers can map business codes without string matching. */
export class WorkspaceFilesError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: WorkspaceFilesErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'WorkspaceFilesError'
  }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level (directories and files together). */
  readonly maxEntries: number
  /** Byte bound of one file read; the extra probe byte proves truncation. */
  readonly maxBytes: number
  /** VCS (git) status decoration controls. */
  readonly vcs: VcsConfig
}

/**
 * Host service backing the generated `ctx.remote.workspaceFiles` namespace.
 * Its two verbs are Agent-scoped: the `agent` lookup resolves the caller's
 * session, whose cwd is the workspace root every listing and read is fenced
 * to.
 */
export class WorkspaceFilesController extends TypertRemoteService {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize and put on the wire; `maxBytes` bounds a single file read.
   * The defaults follow GitHub's web UI (1,000 listing entries) and a
   * half-megabyte text window.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
    maxBytes: z.natural().min(1).default(512 * 1024),
    vcs: z.object({
      enabled: z.boolean().default(true),
      maxDirtyPaths: z.natural().min(1).default(20000),
    }).default({ enabled: true, maxDirtyPaths: 20000 }),
  })

  private readonly vcs: VcsIndex

  /** @param ctx - Host context carrying the agent registry that resolves the session. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFilesController', { namespace: 'workspaceFiles' })
    this.vcs = new VcsIndex(config.vcs)
  }

  /**
   * List one directory level for a Remote caller's explorer.
   * @param agent - target Agent resolved from the Session identity on the wire; its cwd is the fence root.
   * @param path - absolute directory to list; absent lists the workspace root.
   * @param signal - caller lifetime; abort stops the scan instead of letting it outlive a disconnected caller.
   * @returns the level's listing with its ancestry.
   */
  @Remote('list')
  async list(agent: Agent, path: string | undefined, signal: AbortSignal): Promise<WorkspaceFilesListing> {
    try {
      return await this.listLevel(agent, path, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'workspace file listing was aborted')
    }
  }

  /**
   * Read one text file's bounded content for a Remote caller's explorer.
   * @param agent - target Agent resolved from the Session identity on the wire; its cwd is the fence root.
   * @param path - absolute file to read.
   * @param signal - caller lifetime; abort stops the read and closes the handle.
   * @returns the bounded UTF-8 content with binary and truncation flags.
   */
  @Remote('read')
  async read(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFilesContent> {
    try {
      return await this.readFile(agent, path, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'workspace file read was aborted')
    }
  }

  /** The session's cwd as the fence root, realpath'd so symlinks in the root itself resolve once. */
  private async rootOf(agent: Agent, signal: AbortSignal): Promise<string> {
    const cwd = agent.session.header.cwd ?? process.cwd()
    return await raceAbort(realpath(cwd), signal)
  }

  /**
   * Resolve `resolved` to its real path and require it to stay within the
   * root. A symlink that resolves outside the root is refused here.
   * @param resolved - normalized absolute target.
   * @param root - realpath'd workspace root.
   * @param signal - caller lifetime.
   * @param verb - which verb is fencing, for the unreadable-vs-not-found split.
   * @returns the real path, within root.
   */
  private async fencedRealPath(
    resolved: string,
    root: string,
    signal: AbortSignal,
    verb: 'list' | 'read',
  ): Promise<string> {
    let real: string
    try {
      real = await raceAbort(realpath(resolved), signal)
    } catch (error: unknown) {
      if (signal.aborted) throw asError(signal.reason)
      // Distinguish a missing path from a broken link (the path exists but its
      // target does not) via lstat.
      const entry = await raceAbort(lstat(resolved), signal).catch(() => undefined)
      if (entry === undefined) {
        throw new WorkspaceFilesError('workspace-path-not-found', resolved, `${resolved} does not exist`)
      }
      if (verb === 'read') {
        throw new WorkspaceFilesError('workspace-file-unreadable', resolved, `${resolved} is a broken or cyclic link`)
      }
      throw new WorkspaceFilesError('workspace-path-unreadable', resolved, `cannot list ${resolved}: ${messageOf(error)}`)
    }
    if (!within(root, real)) {
      throw new WorkspaceFilesError('workspace-path-outside-root', resolved, `"${resolved}" is outside the session workspace root`)
    }
    return real
  }

  private async listLevel(agent: Agent, path: string | undefined, signal: AbortSignal): Promise<WorkspaceFilesListing> {
    const home = homedir()
    const root = await this.rootOf(agent, signal)
    // The seam contract takes fully qualified paths only; resolve() would
    // silently rebase a relative or empty wire value under the host process
    // cwd (or, on Windows, its current drive).
    if (path !== undefined && !fullyQualified(path)) {
      throw new WorkspaceFilesError('workspace-path-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path ?? root)
    await this.fencedRealPath(target, root, signal, 'list')
    // Resolve the repo context and its cached status snapshot once, so the
    // materialization below annotates entries inline.
    const vcs = await this.vcs.listing(target, root, signal)
    // Stream the level (opendir, one dirent at a time) into a canonical-order
    // window of maxEntries + 1 candidates: memory stays bounded no matter how
    // many children the directory holds, the window keeps the dirs-first
    // sorted head, and the +1 slot lets an in-window extra row prove the cut.
    const keep = this.config.maxEntries + 1
    const window: Candidate[] = []
    let evicted = false
    try {
      // Every filesystem await races the caller's signal: a stalled
      // opendir/read on a network filesystem must not keep a departed
      // caller's scan alive, and an already-aborted request rejects even
      // when the level is empty.
      const opening = opendir(target)
      const level = await raceAbort(opening, signal).catch((error: unknown) => {
        // The abandoned open can still mint a handle after the abort won;
        // close it so a departed caller cannot leak a descriptor.
        void opening.then(dir => dir.close().catch(swallowCloseFailure), () => {
          // Already rejected: raceAbort surfaced or swallowed it.
        })
        throw error
      })
      try {
        for (;;) {
          const dirent = await raceAbort(level.read(), signal)
          if (dirent === null) break
          const candidate = await this.classify(target, dirent, signal)
          if (boundedInsert(window, candidate, keep)) evicted = true
        }
      } finally {
        // Manual read() never auto-closes; close on every exit. The aborted
        // exit must not await it — Node queues close behind any in-flight
        // read, so awaiting would chain the departed caller back onto the
        // very stall the abort escaped.
        const closing = level.close()
        /* v8 ignore next 3 -- an abort between open and close needs a stalled read; the abandoned-close arm has no observable outcome. */
        if (signal.aborted) {
          closing.catch(swallowCloseFailure)
        } else {
          await closing
        }
      }
    } catch (error: unknown) {
      // An abort is the caller's own reason, not an unreadable directory.
      signal.throwIfAborted()
      throw new WorkspaceFilesError('workspace-path-unreadable', target, `cannot list ${target}: ${messageOf(error)}`)
    }
    const entries: WorkspaceFilesEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      // A caller that departed between reads and probes stops before the
      // next deferred stat.
      signal.throwIfAborted()
      let file: { readonly size: number; readonly modifiedAt: number } | undefined
      if (candidate.kind === 'file') {
        if (candidate.needsStat) {
          const info = await raceAbort(stat(join(target, candidate.name)), signal).catch((_vanishedFile: unknown) => {
            if (signal.aborted) throw asError(signal.reason)
            // The file vanished between streaming and materialization: keep the
            // row as a file with no size/mtime.
            return undefined
          })
          if (info !== undefined) file = { size: info.size, modifiedAt: info.mtimeMs }
        } else if (candidate.size !== undefined && candidate.modifiedAt !== undefined) {
          file = { size: candidate.size, modifiedAt: candidate.modifiedAt }
        }
      }
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      const entryPath = join(target, candidate.name)
      let vcsStatus: VcsFileStatus | undefined
      let vcsDirty: boolean | undefined
      if (vcs.snapshot !== undefined) {
        if (candidate.kind === 'file') {
          vcsStatus = vcs.snapshot.statusByPath.get(entryPath)
        } else if (vcs.snapshot.dirtyDirs.has(entryPath)) {
          vcsDirty = true
        }
      }
      entries.push({
        name: candidate.name,
        path: entryPath,
        kind: candidate.kind,
        hidden: candidate.hidden,
        ...(file === undefined ? {} : file),
        ...(vcsStatus === undefined ? {} : { vcs: vcsStatus }),
        ...(vcsDirty === undefined ? {} : { vcsDirty }),
      })
    }
    return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated, vcs: vcs.context }
  }

  /** Classify one dirent into a listing candidate, probing symlinks and deferring regular-file stats. */
  private async classify(parent: string, dirent: Dirent, signal: AbortSignal): Promise<Candidate> {
    const name = dirent.name
    const hidden = name.startsWith('.')
    const path = join(parent, name)
    if (dirent.isDirectory()) return { name, kind: 'dir', hidden, needsStat: false }
    if (dirent.isSymbolicLink()) {
      // A symlink's kind follows its target; a broken or cyclic link stays a
      // file with no size or mtime.
      try {
        const info = await raceAbort(stat(path), signal)
        if (info.isDirectory()) return { name, kind: 'dir', hidden, needsStat: false }
        return { name, kind: 'file', hidden, needsStat: false, size: info.size, modifiedAt: info.mtimeMs }
      } catch {
        if (signal.aborted) throw asError(signal.reason)
        return { name, kind: 'file', hidden, needsStat: false }
      }
    }
    return { name, kind: 'file', hidden, needsStat: true }
  }

  private async readFile(agent: Agent, path: string, signal: AbortSignal): Promise<WorkspaceFilesContent> {
    const root = await this.rootOf(agent, signal)
    if (!fullyQualified(path)) {
      throw new WorkspaceFilesError('workspace-path-unreadable', path, `cannot read "${path}": not a fully qualified path`)
    }
    const resolved = resolve(path)
    const real = await this.fencedRealPath(resolved, root, signal, 'read')
    const info = await raceAbort(stat(real), signal).catch((error: unknown) => {
      if (signal.aborted) throw asError(signal.reason)
      throw new WorkspaceFilesError('workspace-file-unreadable', resolved, `cannot read ${resolved}: ${messageOf(error)}`)
    })
    if (!info.isFile()) {
      throw new WorkspaceFilesError('workspace-file-unreadable', resolved, `"${resolved}" is not a regular file`)
    }
    const maxBytes = this.config.maxBytes
    let bytes: Buffer
    try {
      const opening = open(real, 'r')
      const handle = await raceAbort(opening, signal).catch((error: unknown) => {
        // Mirror the abandoned-open close: a lost race can still mint a handle.
        void opening.then(h => h.close().catch(swallowCloseFailure), () => {})
        throw error
      })
      try {
        // Read at most maxBytes + 1 bytes; the extra byte proves truncation.
        const buffer = Buffer.alloc(maxBytes + 1)
        const { bytesRead } = await raceAbort(handle.read(buffer, 0, buffer.length, 0), signal)
        bytes = buffer.subarray(0, bytesRead)
      } finally {
        const closing = handle.close()
        /* v8 ignore next 3 -- an abort between open and read needs a stalled read; the abandoned-close arm has no observable outcome. */
        if (signal.aborted) {
          closing.catch(swallowCloseFailure)
        } else {
          await closing
        }
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw new WorkspaceFilesError('workspace-file-unreadable', resolved, `cannot read ${resolved}: ${messageOf(error)}`)
    }
    const truncated = bytes.length > maxBytes
    const contentBytes = truncated ? bytes.subarray(0, maxBytes) : bytes
    let content = ''
    let binary = false
    try {
      // TextDecoder('utf-8', { fatal: true }) strips a UTF-8 BOM and rejects
      // invalid sequences, which is the binary signal.
      content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes)
    } catch (_invalidUtf8) {
      binary = true
    }
    return {
      path: resolved,
      size: info.size,
      binary,
      truncated,
      content: binary ? '' : content,
      totalLines: binary ? 0 : countLines(content),
    }
  }
}

/** Raise one entry of the workspace-files wire failure vocabulary. */
function failureOf<Code extends keyof WorkspaceFilesErrorDetailsMap>(
  code: Code,
  message: string,
  details: WorkspaceFilesErrorDetailsMap[Code],
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/**
 * Classify a primitive's rejection: the controller's own closed codes carry
 * the path they are about, and anything else stays an infrastructure failure.
 * @param error - the primitive's rejection.
 * @returns the failure to throw across the Remote boundary.
 */
function workspaceFilesFailure(error: unknown): TypertRemoteFailure {
  if (error instanceof WorkspaceFilesError) {
    return failureOf(error.code, error.message, { path: error.path })
  }
  return failureOf('internal', messageOf(error), {})
}

/**
 * Classify a cancellable primitive's rejection. An abort is the caller's own
 * timeout or disconnect, not a backend failure, so it answers `cancelled`
 * before the business classification runs.
 * @param error - the primitive's rejection.
 * @param signal - the caller lifetime the primitive ran under.
 * @param cancelled - operator-facing text for the abort outcome.
 * @returns the failure to throw across the Remote boundary.
 */
function cancellableFailure(error: unknown, signal: AbortSignal, cancelled: string): TypertRemoteFailure {
  if (signal.aborted) return failureOf('cancelled', cancelled, {})
  return workspaceFilesFailure(error)
}

export default WorkspaceFilesController
