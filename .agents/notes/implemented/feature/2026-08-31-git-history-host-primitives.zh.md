# Agent Note: Git-history Host primitives

Status: implemented

[English](2026-08-31-git-history-host-primitives.md) | 中文

## Problem

浏览器 Git 标签页需要提交历史，但 Host 只暴露按文件的 VCS *status* 装饰（`workspaceFiles`）。没有任何 Remote 命名空间承载提交、父链接、引用或仓库事实；`workspaceFiles` 的状态词汇是按文件的，并折叠为单个图标，且没有历史动词。浏览器无法运行 `git log` 或读取仓库，因此每个提交事实都必须经线上从 Host 传回。ui-git 客户端半边（在用户空间构建）已经针对该约定编码，并在 `ctx.remote.git` 命名空间存在之前渲染「需要 Host」的提示。

## Decision

**使用独立的 Remote 命名空间，而非扩宽 workspaceFiles。** 新 Host 服务 `gitController` 在命名空间 `git` 下继承 `TypertRemoteService`，并暴露两个以 `ctx.remote.git` 呈现的 Agent 作用域动词：

- `log(options?, signal)` — 工作区仓库的提交窗口，最新在前，外加其仓库上下文与 HEAD 事实。
- `show(hash, signal)` — 单个提交的完整消息、提交者、变更文件与有界补丁。

该动词以 `agent: Agent` 为首参数，由既有的 `agent` lookup 从线上解析，因此客户端签名为 `log(agentId, options?, signal?)`，且控制器把每次读取都围栏在 `agent.session.header.cwd`（与 `SessionSummary.cwd` 携带的值相同）之内。`options` 为 JSON 编码且 `acceptsUndefined`，镜像 `workspaceFiles/list` 的可选 `path`。

**围栏由 Host 强制执行，且能识别 gitlink。** 发现过程从 realpath 后的会话 cwd 向上寻找 `.git` 入口，然后用 `git rev-parse`（`--show-toplevel`、`--absolute-git-dir`、`--abbrev-ref HEAD`、`HEAD`）读取权威事实。位于 cwd 处或其上方的 `.git` 目录即为其所属仓库并被跟随——上报的 `vcs.root` 可能位于 cwd 之上，这只是信息性的。`.git` 为文件（gitlink / 链接工作树 / 子模块）时，仅当其解析出的 gitdir 位于围栏根目录内才被跟随：字面 `gitdir:` 目标位于围栏外的 gitlink 解析为 `vcs: { kind: 'none' }`，而真实路径逃出围栏的 gitlink（目标为符号链接）返回响亮的 `git/outside-root` 错误。Host 绝不会对围栏外的工作树运行 git。

**日志是一个有界子进程，采用稳定的 NUL 格式。** `git log --topo-order -z --decorate=full --first-parent --max-count=<maxCount+1> [--all]` 使用格式 `%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D%x00`，并在围栏根目录以 `-c core.hooksPath=/dev/null -c core.fsmonitor=false --no-optional-locks` 运行。记录按 NUL 切分（七个字段加 `-z` 的分隔 NUL）；`%P` 按空格切分（为空即根提交），`%at` 乘以 1000，`%D` 折叠为带短显示名的 `head`/`branch`/`tag`/`remote`。加入 `--decorate=full` 是为了无歧义地折叠引用：规范中的 `refs/heads/main` → `branch main`、`refs/tags/v1.2` → `tag v1.2`、`refs/remotes/origin/main` → `remote origin/main` 映射假定了完整引用名，而默认短装饰会让裸分支/远程名无法归类。额外探测一条记录，使 `truncated` 恰好仅在边界切断历史时为真。`--first-parent` 默认开启（`firstParent` 配置默认为 true）：日志只跟随每个提交的第一父提交，因此图渲染的是线性主线而非完整合并拓扑。因为 `--first-parent` 只收窄遍历、不收窄 `%P`，控制器还会把每个提交的父提交裁到其第一父提交，使窗口内每个父引用都可解析、图不会挂出悬空的侧支。遍历模式是按请求的选择：`options.maxParents: 1 | 2`（无 `Config` 默认）把 `--max-parents=<n>` 拼接在第一父提交标志之后，且绝不与 `firstParent` 同时出现——ui 客户端总是显式发送 `firstParent` 并每次只请求一种模式，因此配置默认值绝不会泄漏到其他模式。解析后的父提交裁剪仍只以 `firstParent` 为条件：在 `--max-parents=2` 下幸存的合并保留两个父提交，使图仍能画出合并通道；在 `--max-parents=1` 下每个幸存行本来就至多一个父提交。`maxCount` 默认 200，`all` 默认 false，`firstParent` 默认 true，均由经过校验的 `Config` 提供。

**`show` 返回单个提交的完整详情及其修改。** `git show -s <hash>^{commit} --format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x00%D` 产出元数据，其中 `%B` 拆分为主题与正文；`^{commit}` 剥离强制该 hash 是围栏仓库中的提交（树、blob、tag 或缺失的 hash 都会失败）。`git show <hash> --format= --name-status` 产出变更文件，折叠为 `added`/`deleted`/`modified`/`renamed`/`copied`/`typechanged`/`unmerged` 并带重命名/复制源，`git show <hash> --format=` 产出统一补丁，按字节受 `maxDiffBytes`（默认 1 MiB）限制、`diffTruncated` 标记截断。`core.quotePath=false` 让文件名保持不加引号。格式错误的 hash 在线上边界返回 `gateway/bad-request`；不是提交的 hash 以 `{ hash }` 返回 `git/commit-not-found`。

**git 失败是上下文，不是错误。** 缺失 git 与无可跟随的仓库都解析为 `vcs: { kind: 'none' }`；存在但损坏的仓库或失败的日志/show 解析为 `vcs: { kind: 'error', message }`——这些动词总是成功解析，绝不会因 git 失败而抛出异常。抛出的类型化失败是 `git/outside-root`（围栏）与 `git/commit-not-found`（不是围栏仓库中提交的 hash），分别以 `{ path }` / `{ hash }` 镜像到线上（类似 `DirectoryPickerErrorCode`），让客户端无需字符串匹配即可映射业务码；格式错误的 hash 返回载体的 `gateway/bad-request`。中止的信号会杀掉 git 子进程（execFile 的 signal）并返回 `gateway/cancelled`。

该包作为 web-app bundle 中独立的 Loader 条目发布，其生成的 `./remote` 贡献加入 `dsh-api-remotes` 装配，因此 `ctx.remote.git` 无需其他客户端改动即存在。

## Alternatives considered

**用历史动词扩宽 `workspaceFiles`。** 否决：其状态词汇是按文件、按目录的，且其列表约定是树的一层，而非提交图。独立命名空间让按文件状态与按提交历史各自独立，并各自拥有围栏与失败词汇。

**在线上传递显式的 session 或 agent id。** 否决：Typert `agent` lookup 已从线上身份解析出活的 `Agent`。显式参数会重复网关拥有的机制，并让调用方指定自身之外的会话。

**仅用手动 `.git` 遍历发现，或仅用 `git rev-parse`。** 两者单独使用都被否决：仅遍历只能得到字面的 `.git` 位置，却得不到 git 在边界情形（链接工作树）下的权威 toplevel/gitdir；仅 `rev-parse` 会解析 gitlink，却无从执行文件与目录的围栏区分。拆分——遍历做围栏判定、`rev-parse` 取事实——让安全检查保持字面化，同时响应携带 git 自身的解析结果。

**把每个围栏外的 gitlink 都当作 `none`。** 因不完整而否决：字面目标位于围栏内、但真实路径位于围栏外（符号链接）的 gitlink，正是错误词汇所指的「工作树逃出会话围栏」，因此它应响亮地以 `git/outside-root` 失败，而非静默降级。

**默认短 `%D` 装饰。** 否决：短装饰会把非 HEAD 分支与远程渲染为裸名（`feature`、`origin/main`），没有可供折叠的前缀，因此规范所要求的 `refs/heads/`/`refs/tags/`/`refs/remotes/` 无歧义折叠必须使用 `--decorate=full`。

**始终显示完整合并拓扑。** 作为默认被否决：繁忙仓库的第一父提交图是一条线性主线，这是浏览历史时最常用的视图，而完整拓扑会把每条侧支交错进一张过宽、难以阅读的图。`firstParent` 默认为 `true`，并保留按请求退出（`firstParent: false`），因此完整图从未丢失——它只是不再是默认。

## Consequences

图在构造上即受工作区作用域限制：任何动词都无法触达会话 cwd 之外，逃逸的 gitlink 要么被拒绝（`none`），要么被响亮地应答（`git/outside-root`）。围栏只对 gitdir 做一次 realpath，因此在检查与日志之间被重定向的 gitlink 是与 workspace-files 共有的 TOCTOU 窗口。

引用在服务端折叠为短名加类别；消费者绝不会看到原始引用名。`log` 只暴露作者时间，而 `show` 额外暴露提交者时间。提交的补丁按字节受 `maxDiffBytes` 限制，干净合并的 `show` 差异为空。无分页、实时刷新或跨会话浏览——客户端在挂载时重新获取，每次读取都根植于其会话的 cwd。

## Testing

包测试覆盖 `parseRefs`（`HEAD -> branch`、`refs/heads/`、`refs/tags/`、`refs/remotes/`、`tag:` 折叠与未知形态丢弃）、`parseLog`（NUL 记录解析、根/合并父列表、秒转毫秒）、`parseNameStatus`（代码折叠与重命名旧/新路径配对），以及真实仓库上的控制器：按最新在前的第一父提交主线及其 hash/父/作者/主题/引用（合并折叠为一个父提交、侧支被省略）、`firstParent: false` 下的完整拓扑（合并带两个父提交且侧支存在）、仓库外的 `none` 上下文、损坏仓库的 `error` 上下文、围栏外 gitlink 解析为 `none`、真实路径逃逸的 gitlink 返回 `git/outside-root`、`maxCount` 截断标志，以及中止信号的 `gateway/cancelled` 码。`show` 测试覆盖多行消息的完整主题/正文与提交者、变更文件折叠（修改/删除/重命名/新增）、补丁内容、根提交的空父提交、缺失 hash 的 `git/commit-not-found`、格式错误 hash 的 `gateway/bad-request`、仓库外的 `none` 上下文，以及 `maxDiffBytes` 补丁截断。一个遍历模式夹具——五个普通提交（root、main work 与三个分支上各一个主题提交）外加一个双父合并与一个三父 octopus 合并——覆盖 `--first-parent` 主线行、`maxParents: 1` 的无合并窗口、保留双父合并并丢弃 octopus 的 `maxParents: 2` 窗口、未传 `maxParents` 的完整拓扑，以及 max-parents 过滤下的截断探测。一次真实 Loader 装配以默认配置挂载控制器并在销毁时移除它。生成的 `./remote` 构件在构建期间由 Typert 生成器的导出检查校验。
