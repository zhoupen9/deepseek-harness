# Agent Note: Workspace-files Host primitives

Status: implemented

[English](2026-08-30-workspace-files-host-primitives.md) | 中文

## Problem

浏览器的 Files 资源管理器需要目录与文件事实，但 Host 只暴露了一个列举动词——`directoryPickerController.list`——而且它被刻意限定为仅目录。它的后端会跳过每个非目录 dirent，其线上条目只携带 `{ name, path, hidden }`（没有文件种类、大小或修改时间），而且整条线上没有任何文件读取动词。该契约为工作区选择服务，绝不能改变。因此，重写后的 Files 资源管理器（其客户端半边已经按照 HOST_PRIMITIVES.md 中的契约编码）没有任何可提供实时“目录 + 文件”树的 Host 来源，只能退回到它基于会话已知信息的重建。

## Decision

**使用独立的 Remote 命名空间，而不是加宽目录选择。** 一个新的 Host 服务 `workspaceFilesController` 继承 `TypertRemoteService`，命名空间为 `workspaceFiles`，并暴露两个 Agent 作用域动词，以 `ctx.remote.workspaceFiles` 的形式呈现：

- `list(path?, signal)` —— 一层目录，目录在前、文件在后，各自按字母排序。
- `read(path, signal)` —— 一个普通文件的有界 UTF-8 文本。

两个动词都以 `agent: Agent` 作为第一个参数，由现有的 `agent` 查找从线上解析而来，因此客户端签名不携带会话 id，控制器会把每个操作限制在 `agent.session.header.cwd`（与 `SessionSummary.cwd` 所携带的值相同）之内。

**根围栏由 Host 强制，而非 UX。** 只有当目标是完全限定路径（与 directory-picker-browse 使用的 `fullyQualified` 围栏相同）、并且在 `resolve()` 与 `realpath()` 之后位于会话 cwd 之内时，才被接受。位于根目录父级或以上的路径，或解析到根之外的符号链接，都会以 `workspace-path-outside-root` 拒绝。逃逸出根目录的符号链接仍会作为叶子条目列出——客户端可以显示它们——但它们的 `read` 会被拒绝；损坏或循环的链接会以无大小、无修改时间的文件形式列出，读取失败时报 `workspace-file-unreadable`。

**列举像选择器一样流式且有界。** `list` 用 `opendir` 把一层内容流式读入一个规范顺序的、大小为 `maxEntries + 1`（默认 1000）的有界窗口，绝不会把一整层 `readdir` 进内存。目录由 dirent 判定；符号链接会用 stat 探测以跟随其目标种类；普通文件把大小/修改时间的 stat 推迟到物化阶段，因此只有被保留的窗口才付出代价。隐藏条目会被返回并标记（点前缀；Node 的 dirent 不暴露 Windows 隐藏属性），而绝不会被丢弃。`read` 最多读取 `maxBytes + 1` 字节（默认 512 KiB），多出的一个字节用于证明截断，去除 UTF-8 BOM，并在 `TextDecoder('utf-8', { fatal: true })` 失败时返回 `binary: true`——线上不传 base64。每个文件系统 await 都通过选择器的 `raceAbort` 模式与调用方信号竞速，被中止的扫描会关闭其句柄，而不会等待正在进行的读取。

**封闭的失败词汇表。** 控制器抛出 `WorkspaceFilesError`，包含 `workspace-path-outside-root`、`workspace-path-unreadable`、`workspace-file-unreadable` 或 `workspace-path-not-found`，并像 `DirectoryPickerErrorCode` 一样映射到线上，让客户端无需字符串匹配即可映射业务代码。`cancelled` 与 `internal` 补全线上映射。

该包作为 web-app bundle 中独立的 Loader entry 发布，其生成的 `./remote` 贡献被加入 `dsh-api-remotes` 组装，因此客户端的 `ctx.remote.workspaceFiles` 命名空间无需其他客户端改动即可存在。

**VCS（git）状态是 `list` 的一种能力，而非第三个动词。** 每个列举都携带一个 `vcs` 上下文（`none` / `error` / 带 `root` 与 `worktree` 的 `git`），在 git 下每个文件条目携带折叠后的 `vcs` 状态，而每个目录在某个非忽略的后代有差异时携带 `vcsDirty`。状态是每个工作树根目录一个缓存快照，在相邻的 list 调用间复用，并在短暂的 TTL 后重新计算，因此路径不会在渲染中途翻转，陈旧的快照也可接受。git 运行是被围栏的：它使用 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`，且一个 `gitdir:` 解析到工作区根之外的 `.git` FILE（链接工作树 / gitlink / 子模块）绝不会被跟随。被忽略的文件（通过 `--ignored` 报告）保持为 `ignored`，绝不会是 `untracked`；porcelain XY 折叠为每个文件一个代码，其中 `U`/冲突对映射为 `conflicted`。缺失的 git 退化为 `none`，失败的状态运行退化为 `error` —— 列举总是成功。超过 `maxDirtyPaths` 个显著路径后，快照退化为不标注，而不是一个不完整的集合。

## Alternatives considered

**加宽 `directoryPickerController.list` 以包含文件。** 已拒绝：选择 seam 的 `DirectoryEntry` 只携带 `{ name, path, hidden }`，加入种类/大小/修改时间再加一个读取动词，会改变 native 与 browse 后端都要应答的、以选择为导向的契约。独立命名空间既让选择保持仅目录，又给了资源管理器更完整的形状。

**在线上传递显式的 session 或 agent id。** 已拒绝：Typert 的 `agent` 查找已经从线上身份解析出活的 `Agent`，客户端也已在其作用域适配器中持有该身份。显式参数会重复一个由网关拥有的机制，并让调用方得以命名并非自己的会话。

**用 `readFile` 读取整个文件。** 已拒绝：无界读取会把任意文件的全部内容放到线上。`maxBytes + 1` 探测在保持内存与线上大小有界的同时，仍能证明截断。

**把二进制以 base64 传输。** 已为 v1 拒绝：资源管理器渲染的是“二进制”提示而非内容，线上传 base64 对界面并不展示的东西毫无益处。

**像 `DirectoryPickerController` 一样把控制器寄宿在 `workspace-controller` 内。** 已拒绝：`DirectoryPickerController` 寄宿在那里，只是因为它的选择 seam 是抽象的、自身从来不是 Loader entry。Workspace-files 没有抽象 seam，因此一个独立的 Loader-entry 包能让它的配置与线上命名空间保持独立。

**把 VCS 状态作为第三个 `status` 动词暴露。** 已拒绝：懒加载树客户端一次只展开一层，因此单独的动词会给每一层增加一次往返，并带来第二个一致性问题（状态与列举漂移）。内联字段让每一层只需一次往返，而只读的 `vcs` 字段正是界面所需的全部装饰（v1 中没有 stage/commit/diff/blame）。

## Consequences

资源管理器在构造上就是工作区作用域的：任何动词都无法触及会话 cwd 之外，逃逸的符号链接可见但不可读。围栏先做一次 realpath 再打开，因此符号链接在检查与打开之间被改指是一个与 directory-picker-browse 相同的 TOCTOU 窗口。

被截断的读取若在字节边界处切断一个多字节 UTF-8 序列，会把一个本来合法的文件报告为 `binary: true`。`hidden` 只反映 POSIX 的点前缀约定。

无论子项数量多少，在任意大的层级上的内存都保持 `O(maxEntries)`；普通文件只有被保留时才付出一次 stat。当命名空间不存在时，客户端仍会继续退回到其基于会话已知信息的重建。

## Testing

包测试覆盖目录在前的排序与截断、围栏（根之外、非完全限定、符号链接逃逸、不存在）、损坏链接的列出与读取拒绝、有界/二进制/行数读取、被中止扫描的 cancelled 代码，以及一个真实的 Loader 组装——它以默认配置挂载控制器并在销毁时移除它。VCS 测试覆盖 porcelain 折叠（包括重命名旧路径跳过与 `maxDirtyPaths` 退化）、真实仓库下的逐条目标注与 `vcsDirty`、被忽略而非未跟踪的区分、仓库外与损坏仓库内的 `none`/`error` 上下文，以及快照缓存（相邻读取结果一致、TTL 后重新计算）。生成的 `./remote` 产物在构建期间由 Typert 生成器的导出检查验证。
