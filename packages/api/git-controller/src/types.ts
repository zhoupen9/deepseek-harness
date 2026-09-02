/**
 * Client-safe wire vocabulary of the git Remote namespace. Types only — no
 * runtime code, and nothing here reaches a Host-only symbol, so a browser
 * consumer reads exactly the signatures the Host emits.
 * @module @deepseek-ai/dsh-api-git-controller/types
 */

/** Repo context of a log request. */
export type GitContext =
  | { readonly kind: 'none' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'git'; readonly root: string; readonly worktree: string }

/** One ref (branch/tag/remote/HEAD) decorating a commit. */
export interface GitRef {
  /** Short display name: `main`, `HEAD`, `v1.2`, `origin/main`. */
  readonly name: string
  /** Ref kind, folded from the full ref name by the host. */
  readonly kind: 'head' | 'branch' | 'tag' | 'remote'
}

/** One commit in the requested window, newest first. */
export interface GitCommit {
  /** Full 40-char object id; clients derive the short form. */
  readonly hash: string
  /** Parent object ids in order (empty for a root; length >= 2 for a merge). */
  readonly parents: readonly string[]
  readonly authorName: string
  readonly authorEmail: string
  /** Author epoch milliseconds. */
  readonly authorTime: number
  /** First line of the commit message. */
  readonly subject: string
  /** Refs pointing at this commit (empty when undecorated). */
  readonly refs: readonly GitRef[]
}

/** Bounds for a log request. */
export interface GitLogOptions {
  /** Commit bound; the host applies its own default when absent. */
  readonly maxCount?: number
  /** `true` requests all refs, not just HEAD's ancestry. */
  readonly all?: boolean
  /** `true` follows only each commit's first parent (the mainline); `false` shows full topology. */
  readonly firstParent?: boolean
  /**
   * Keep only commits with at most this many parents: `1` hides merge commits,
   * `2` hides octopus merges (more than two parents). Passed through as git's
   * `--max-parents=<n>`; the Host never slices a surviving merge's parents.
   */
  readonly maxParents?: 1 | 2
}

/** The host `git` namespace's one verb result. */
export interface GitLogResult {
  /** Repo context; commits are empty unless `kind` is `git`. */
  readonly vcs: GitContext
  /** HEAD branch short name, or `HEAD` when detached; absent outside a repo or in an empty repo. */
  readonly currentBranch?: string
  /** HEAD commit object id; absent outside a repo or in an empty repo. */
  readonly headHash?: string
  /** Requested window, newest first. */
  readonly commits: readonly GitCommit[]
  /** True when the host cut `commits` at its bound. */
  readonly truncated: boolean
}

/** Status of one file changed by a commit, folded from `git --name-status`. */
export type GitFileStatus =
  | 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'typechanged' | 'unmerged'

/** One file a commit changed. */
export interface GitFileChange {
  /** Worktree-relative path (the new path for renames and copies). */
  readonly path: string
  /** Folded change kind. */
  readonly status: GitFileStatus
  /** Rename/copy source path; present only for `renamed` and `copied`. */
  readonly previousPath?: string
}

/** Full detail of one commit, extending the log's graph facts. */
export interface GitCommitDetail extends GitCommit {
  readonly committerName: string
  readonly committerEmail: string
  /** Committer epoch milliseconds. */
  readonly committerTime: number
  /** Message body after the subject line; empty for a one-line message. */
  readonly body: string
}

/** The host `git` namespace's commit-detail verb result. */
export interface GitShowResult {
  /** Repo context; `commit` is present only when `kind` is `git`. */
  readonly vcs: GitContext
  /** The requested commit's full detail. */
  readonly commit?: GitCommitDetail
  /** Files the commit changed, in git's diff order. */
  readonly files: readonly GitFileChange[]
  /** Unified patch text; empty when the commit has no diff (e.g. a clean merge). */
  readonly diff: string
  /** True when `diff` was cut at the host byte bound. */
  readonly diffTruncated: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The resolved git worktree escapes the session fence. */
    'git/outside-root': { readonly path: string }
    /** The requested hash is not a commit in the fenced repository. */
    'git/commit-not-found': { readonly hash: string }
  }
}

/** Closed failure vocabulary of the git primitives. */
export type GitErrorCode = 'git/outside-root' | 'git/commit-not-found'
