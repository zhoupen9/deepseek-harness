/**
 * Client-safe wire vocabulary of the workspace-files Remote namespace. Types
 * only — no runtime code, and nothing here reaches a Host-only symbol, so a
 * browser consumer reads exactly the signatures the Host emits.
 * @module @deepseek-ai/dsh-api-workspace-files-controller/types
 */

/** VCS status of one file, collapsed index+worktree (v1: one icon per file). */
export type VcsFileStatus =
  | 'modified' | 'added' | 'deleted'
  | 'renamed' | 'untracked' | 'ignored' | 'conflicted'

/** Repo context of a listing. */
export type VcsContext =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly message: string }
  | {
    /** Worktree top-level; may lie above the session workspace root. */
    readonly kind: 'git'
    readonly root: string
    /** The `.git` directory path (a resolved gitdir for a linked worktree). */
    readonly worktree: string
  }

/** One listed child: a directory or a file. */
export interface WorkspaceFilesEntry {
  /** Base name shown in a tree row. */
  readonly name: string
  /** Absolute host path — clients never join path segments themselves. */
  readonly path: string
  /** `dir`: expandable directory; `file`: selectable leaf. */
  readonly kind: 'dir' | 'file'
  /** Hidden by the host platform's convention (dot-prefix on POSIX). */
  readonly hidden: boolean
  /** Byte size; present only for files the host could stat. */
  readonly size?: number
  /** Last-modified epoch ms; present only for files the host could stat. */
  readonly modifiedAt?: number
  /** Notable VCS status; present only for files under a git repo (clean = absent). */
  readonly vcs?: VcsFileStatus
  /** Present (true) for directories with a differing descendant (ignored-only excluded). */
  readonly vcsDirty?: boolean
}

/** One directory level plus its ancestry, as the host reports it. */
export interface WorkspaceFilesListing {
  /** Absolute path of the listed directory. */
  readonly path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  readonly home: string
  /** Ancestor chain from the filesystem root to the listed directory, every crumb a `dir` entry. */
  readonly crumbs: readonly WorkspaceFilesEntry[]
  /** Direct children: directories first, then files, each alphabetical. */
  readonly entries: readonly WorkspaceFilesEntry[]
  /** True when the backend cut `entries` at its complete-result bound. */
  readonly truncated: boolean
  /** Repo context; `git` enables the per-entry `vcs`/`vcsDirty` fields. */
  readonly vcs: VcsContext
}

/** Bounded read of one text file. */
export interface WorkspaceFilesContent {
  /** Absolute path that was read. */
  readonly path: string
  /** Byte size the host observed. */
  readonly size: number
  /** True when the file is not valid UTF-8 text (content is empty). */
  readonly binary: boolean
  /** True when the content was cut at the host read bound. */
  readonly truncated: boolean
  /** Decoded text; empty when binary. */
  readonly content: string
  /** Number of content lines; 0 when binary. */
  readonly totalLines: number
}

/** Closed failure vocabulary of the workspace-files primitives. */
export type WorkspaceFilesErrorCode =
  | 'workspace-path-outside-root'
  | 'workspace-path-unreadable'
  | 'workspace-file-unreadable'
  | 'workspace-path-not-found'

/** Stable workspace-files failure details returned by the wire verbs. */
export interface WorkspaceFilesErrorDetailsMap {
  /** The target escapes the session workspace root. */
  'workspace-path-outside-root': { readonly path: string }
  /** The target is not fully qualified, or cannot be listed. */
  'workspace-path-unreadable': { readonly path: string }
  /** The read target is a directory, a non-regular file, unreadable, or a broken link. */
  'workspace-file-unreadable': { readonly path: string }
  /** The target does not exist. */
  'workspace-path-not-found': { readonly path: string }
  /** The caller's own timeout or disconnect ended the scan or the read. */
  cancelled: Record<never, never>
  /** A backend failure with no seam code of its own. */
  internal: Record<never, never>
}
