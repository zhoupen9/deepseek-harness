---
description: "Host git-history control: fenced commit-log reads for the browser commit graph."
kind: "package-reference"
---
# Git Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-git-controller` owns the Host `ctx.gitController` service and the generated Client `ctx.remote.git` namespace. Its two Agent-scoped Remote verbs read the workspace repository without the browser touching git: `log(options?, signal)` lists commit history — each commit's hash, parents, author, subject, and decorating refs, newest first — and `show(hash, signal)` returns one commit's full message, committer, changed files, and bounded patch. Every read is fenced to the calling session's workspace root, so the browser-side graph can never read a repository outside its own workspace. Use it through API Gateway when a Client must render git history without running git itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`log(options?, signal)` discovers the repository owning the session's cwd with `git rev-parse`, then reads `git log --topo-order` in a stable NUL-delimited format bounded by `maxCount` (default 200). `firstParent` defaults to `true`, so the log follows only each commit's first parent — the mainline — and collapses merges to a single lane (a merge's other parents are trimmed from the window); pass `firstParent: false` for the full branch topology. `maxParents: 1 | 2` (no default) is a listing bound passed through as git's `--max-parents=<n>`: `1` hides every merge commit, `2` hides octopus merges (more than two parents) while a surviving merge keeps both of its parents, so the graph can still draw its merge lane. Each commit carries its full 40-char object id, ordered parent ids, author name/email/time (epoch milliseconds), the subject (first line), and refs folded to `head`/`branch`/`tag`/`remote` with short display names. `truncated` is true exactly when the bound cut the history (one extra record is probed). `all: true` logs every ref's ancestry instead of HEAD's.

`show(hash, signal)` takes an abbreviated or full commit object id and returns that commit's full detail — subject and body, author and committer, parents, and refs — plus its changed files (path, status folded to `added`/`deleted`/`modified`/`renamed`/`copied`/`typechanged`/`unmerged`, with the rename/copy source) and the unified patch. The patch is byte-bounded by `maxDiffBytes` (default 1 MiB) with `diffTruncated` marking the cut; a hash that is not a commit in the fenced repo answers `git/commit-not-found`, and a malformed hash answers `gateway/bad-request`.

The fence resolves the session's cwd as the workspace root. A repository whose `.git` is a DIRECTORY at or above the cwd is followed (the reported `vcs.root` may lie above the cwd; that is informational). A `.git` FILE (gitlink / linked worktree / submodule) is followed only when its resolved gitdir stays inside the fence root; an out-of-fence gitlink resolves `vcs: { kind: 'none' }`, and a gitlink whose real path escapes the fence answers `git/outside-root`. A missing git resolves `none`; a present-but-broken repository resolves `vcs: { kind: 'error' }` — the verb never throws for git failures.

-----

<a id="model-experience"></a>
## Model Experience

None, as commit-graph browsing is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; commit-log reads do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The `%D` decoration is read with `--decorate=full` so refs fold unambiguously; a short-decorated log would drop bare branch/remote names as unknown shapes.
- `firstParent` defaults to `true`, so a merge reports only its first parent and side branches are omitted; the full topology is a per-request `firstParent: false` opt-out.
- `show`'s patch is byte-bounded by `maxDiffBytes`; a patch exceeding the 32 MiB subprocess cap errors rather than truncating.
- `show` reads `--name-status` with `core.quotePath=false`, so a filename that is not valid UTF-8 surfaces replacement characters.
- A merge commit's `show` diff is git's combined diff (conflict resolutions only), which is empty for a clean merge.
- No blame/file-tree verbs, no commit staging/creating, no paging or live refresh, and no cross-session browsing — each read is rooted at its session's cwd.
- The fence realpaths the gitdir once; a gitlink retargeted between the check and the read is a TOCTOU window shared with workspace-files.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
