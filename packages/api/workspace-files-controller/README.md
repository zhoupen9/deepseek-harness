---
description: "Host workspace-files control: fenced one-level directory-and-file listing and bounded text reads."
kind: "package-reference"
---
# Workspace Files Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-workspace-files-controller` owns the Host `ctx.workspaceFilesController` service and the generated Client `ctx.remote.workspaceFiles` namespace. Its two Agent-scoped Remote verbs list one directory level (directories and files together, directories first) and read one text file's bounded UTF-8 content. Every verb is fenced to the calling session's workspace root, so the browser-side explorer can never read or list outside its own workspace. Use it through API Gateway when a Client must browse the filesystem without touching it directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`list(path?, signal)` streams one level with `opendir` into a bounded window of `maxEntries` (default 1000) entries, directories first then files, each alphabetical. Hidden entries are returned and flagged, never dropped; broken or cyclic symlinks list as files with no size or mtime. `read(path, signal)` reads at most `maxBytes + 1` bytes (default 512 KiB), strips a UTF-8 BOM, and reports `binary: true` when the bytes are not valid UTF-8 instead of transferring base64.

The fence resolves the session's cwd as the workspace root. A target at or above the root's parent, or a symlink that resolves outside the root, is refused with `workspace-path-outside-root`. A symlink escaping the root still lists (so the client can show it), but its read is refused.

Under a git repository `list` also decorates each entry with a collapsed VCS status: files carry `vcs` (modified/added/deleted/renamed/untracked/ignored/conflicted; a clean tracked file omits it) and directories carry `vcsDirty` when a non-ignored descendant differs. Status is one cached snapshot per worktree root, recomputed after a short TTL, and a missing or broken git degrades to a `none`/`error` context instead of failing the listing.

-----

<a id="model-experience"></a>
## Model Experience

None, as workspace-file browsing is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; workspace-file listing and reads do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `hidden` is the POSIX dot-prefix convention only; the Windows hidden attribute is not exposed by Node dirents (best-effort, documented).
- A truncated read that cuts a multi-byte UTF-8 sequence at the byte bound reports `binary: true` for an otherwise-valid file.
- The fence realpaths the target once, then opens it; a symlink retargeted between the check and the open is a TOCTOU window shared with directory-picker-browse.
- VCS status is a point-in-time snapshot: two sibling list calls read the same snapshot, and a file changed within the TTL shows its previous status until the snapshot recomputes.
- Past `vcs.maxDirtyPaths` notable paths, status annotation degrades to absent rather than reporting a partial set.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
