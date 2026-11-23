# Agent Note: Workspace-files Host primitives

Status: implemented

English | [中文](2026-08-30-workspace-files-host-primitives.zh.md)

## Problem

The browser Files explorer needs directory and file facts, but the Host exposes only one listing verb — `directoryPickerController.list` — and it is deliberately directories-only. Its backend skips every non-directory dirent, its wire entry carries only `{ name, path, hidden }` (no file kind, size, or mtime), and there is no file-read verb anywhere on the wire. That contract serves workspace picking and must not change. The rewritten Files explorer (its client half already codes against the contract in HOST_PRIMITIVES.md) therefore had no Host source for a live directories-and-files tree, and fell back to its session-known reconstruction.

## Decision

**A separate Remote namespace, not a widening of directory picking.** A new Host service `workspaceFilesController` extends `TypertRemoteService` under namespace `workspaceFiles` and exposes two Agent-scoped verbs that surface as `ctx.remote.workspaceFiles`:

- `list(path?, signal)` — one directory level, directories then files, each alphabetical.
- `read(path, signal)` — bounded UTF-8 text of one regular file.

Both verbs take an `agent: Agent` first parameter resolved from the wire by the existing `agent` lookup, so the client signature carries no session id and the controller fences every operation to `agent.session.header.cwd` (the same value `SessionSummary.cwd` carries).

**The root fence is Host-enforced, not UX.** A target is accepted only when fully qualified (the same `fullyQualified` fence directory-picker-browse uses) and, after `resolve()` and `realpath()`, within the session cwd. A path at or above the root's parent, or a symlink that resolves outside it, is refused with `workspace-files/path-outside-root`. Symlinks that escape still list as leaf entries — the client may show them — but their `read` is refused, and broken/cyclic links list as files with no size or mtime and fail read with `workspace-files/file-unreadable`.

**Listing streams and bounds like the picker.** `list` streams the level with `opendir` into a canonical-order bounded window of `maxEntries + 1` (default 1000), never `readdir`-ing a whole level into memory. Directories are classified from the dirent; symlinks are stat-probed to follow their target kind; regular files defer their size/mtime stat to materialization so only the retained window pays it. Hidden entries are returned and flagged (dot-prefix; the Windows hidden attribute is not exposed by dirents), never dropped. `read` reads at most `maxBytes + 1` (default 512 KiB), where the extra byte proves truncation, strips a UTF-8 BOM, and reports `binary: true` when `TextDecoder('utf-8', { fatal: true })` fails — no base64 on the wire. Every filesystem await races the caller signal via the picker's `raceAbort` pattern, and an aborted scan closes its handle without awaiting behind the in-flight read.

**A closed failure vocabulary.** The controller throws `WorkspaceFilesError` with `workspace-files/path-outside-root`, `workspace-files/path-unreadable`, `workspace-files/file-unreadable`, or `workspace-files/path-not-found`, wrapped as a `RemoteError` so the client maps business codes without string matching. Carrier `gateway/cancelled` and `gateway/internal` complete the wire map.

The package ships as its own Loader entry in the web-app bundle, and its generated `./remote` contribution is added to the `dsh-api-remotes` assembly, so the client `ctx.remote.workspaceFiles` namespace exists with no other client change.

**VCS (git) status is a capability of `list`, not a third verb.** Each listing carries a `vcs` context (`none` / `error` / `git` with `root` + `worktree`), and under git each file entry carries a collapsed `vcs` status while each directory carries `vcsDirty` when a non-ignored descendant differs, or `vcs: 'ignored'` when the whole directory is git-ignored. Status is one cached snapshot per worktree root, reused across sibling list calls and recomputed after a short TTL, so a path cannot flip mid-render and a stale snapshot is acceptable. The git run is fenced: it uses `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, and a `.git` FILE (linked worktree / gitlink / submodule) whose `gitdir:` resolves outside the workspace root is never followed. Ignored files and entirely-ignored directories (reported via `--ignored=matching`) stay `ignored`, never `untracked`; porcelain XY collapses to one code per file, with `U`/conflict pairs mapping to `conflicted`. A missing git degrades to `none`, a failing status run to `error` — the listing always succeeds. Past `maxDirtyPaths` notable paths the snapshot degrades to no annotation rather than a partial set.

## Alternatives considered

**Widen `directoryPickerController.list` to include files.** Rejected: the picking seam's `DirectoryEntry` carries only `{ name, path, hidden }`, and adding kind/size/mtime plus a read verb would change a picking-oriented contract that the native and browse backends both answer. A separate namespace keeps picking directories-only and gives the explorer its own, fuller shape.

**Pass an explicit session or agent id on the wire.** Rejected: the Typert `agent` lookup already resolves the live `Agent` from the wire identity, and the client already holds that identity in its scope adapter. An explicit parameter would duplicate a mechanism the gateway owns and let a caller name a session other than its own.

**Read whole files with `readFile`.** Rejected: unbounded reads would put an arbitrary file's full content on the wire. The `maxBytes + 1` probe keeps memory and wire size bounded while still proving truncation.

**Transfer binary as base64.** Rejected for v1: the explorer renders a binary notice rather than content, and base64 on the wire buys nothing the surface does not show.

**Host the controller inside `workspace-controller` like `DirectoryPickerController`.** Rejected: `DirectoryPickerController` is hosted there only because its picking seam is abstract and never a Loader entry of its own. Workspace-files has no abstract seam, so a standalone Loader-entry package keeps its config and wire namespace independent.

**Expose VCS status as a third `status` verb.** Rejected: the lazy-tree client expands one level at a time, so a separate verb would add a round-trip per level and a second consistency problem (status vs listing drift). Inline fields keep one round-trip per level, and a read-only `vcs` field is the whole decoration the surface needs (no stage/commit/diff/blame in v1).

## Consequences

The explorer is workspace-scoped by construction: no verb can reach outside the session cwd, and a symlink that escapes is visible but unreadable. The fence realpaths once then opens, so a symlink retargeted between the check and the open is a TOCTOU window shared with directory-picker-browse.

A truncated read that cuts a multi-byte UTF-8 sequence at the byte bound reports `binary: true` for an otherwise-valid file. `hidden` reflects only the POSIX dot-prefix convention.

Memory over an arbitrarily large level stays `O(maxEntries)` regardless of child count; regular files pay one stat only when retained. The client continues to fall back to its session-known reconstruction whenever the namespace is absent.

## Testing

Package tests cover the dirs-first sort and truncation, the fence (outside-root, not-fully-qualified, symlink escape, not-found), broken-link listing and read refusal, bounded/binary/line-count reads, the cancelled code for an aborted scan, and a real Loader composition that mounts the controller with defaulted config and removes it on disposal. VCS tests cover the porcelain collapse (including rename old-path skipping, the entirely-ignored directory collapse, and the `maxDirtyPaths` degradation), per-entry annotation, `vcsDirty`, and the entirely-ignored directory `vcs: 'ignored'` under a real repository, the ignored-not-untracked distinction, the `none`/`error` contexts outside and inside a broken repo, and the snapshot cache (identical sibling reads, recompute after the TTL). The generated `./remote` artifact is validated by the Typert generator's export check during build.
