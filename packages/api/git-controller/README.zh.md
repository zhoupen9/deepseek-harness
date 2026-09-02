---
description: "主机 git 历史控制：面向浏览器提交图的受围栏 commit-log 读取。"
kind: "package-reference"
---
# Git Controller

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-api-git-controller` 拥有主机侧 `ctx.gitController` 服务与生成的客户端 `ctx.remote.git` 命名空间。它的两个 Agent 作用域 Remote 动词在浏览器不接触 git 的情况下读取工作区仓库：`log(options?, signal)` 列出提交历史——每个提交的 hash、父提交、作者、主题与装饰性引用，按最新在前排列——而 `show(hash, signal)` 返回单个提交的完整消息、提交者、变更文件与有界补丁。每次读取都被围栏在调用会话的工作区根目录内，因此浏览器侧的图永远无法读取自身工作区之外的仓库。当客户端需要在不自行运行 git 的情况下渲染 git 历史时，请通过 API Gateway 使用它。

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`log(options?, signal)` 用 `git rev-parse` 发现拥有会话 cwd 的仓库，然后以稳定的 NUL 分隔格式读取 `git log --topo-order`，并由 `maxCount`（默认 200）限定数量。`firstParent` 默认为 `true`，因此日志只跟随每个提交的第一父提交——即主线——并把合并折叠为单条通道（合并的其他父提交会从窗口中裁掉）；传入 `firstParent: false` 可获得完整的分支拓扑。`maxParents: 1 | 2`（无默认值）是一个透传为 git `--max-parents=<n>` 的列表上限：`1` 隐藏所有合并提交，`2` 隐藏 octopus 合并（多于两个父提交的合并），而幸存的合并提交保留它的两个父提交，使图仍能画出合并通道。每个提交携带完整的 40 位对象 id、有序的父提交 id、作者姓名/邮箱/时间（纪元毫秒）、主题（首行），以及折叠为 `head`/`branch`/`tag`/`remote` 并带短显示名的引用。仅当边界切断了历史时 `truncated` 才为真（会额外探测一条记录）。`all: true` 记录所有引用的祖先链，而非仅 HEAD 的。

`show(hash, signal)` 接受缩写或完整的提交对象 id，并返回该提交的完整详情——主题与正文、作者与提交者、父提交与引用——外加其变更文件（路径、折叠为 `added`/`deleted`/`modified`/`renamed`/`copied`/`typechanged`/`unmerged` 的状态，以及重命名/复制的源路径）与统一补丁。补丁按字节受 `maxDiffBytes`（默认 1 MiB）限制，`diffTruncated` 标记截断；不是被围栏仓库中提交的 hash 返回 `git/commit-not-found`，格式错误的 hash 返回 `gateway/bad-request`。

围栏把会话 cwd 解析为工作区根目录。`.git` 为 cwd 处或其上方目录的仓库会被跟随（上报的 `vcs.root` 可能位于 cwd 之上；那只是信息性的）。`.git` 为文件（gitlink / 链接工作树 / 子模块）时，仅当其解析出的 gitdir 位于围栏根目录内才被跟随；位于围栏外的 gitlink 解析为 `vcs: { kind: 'none' }`，而真实路径逃出围栏的 gitlink 返回 `git/outside-root`。缺失 git 解析为 `none`；存在但损坏的仓库解析为 `vcs: { kind: 'error' }`——该动词绝不会因 git 失败而抛出异常。

-----

<a id="model-experience"></a>
## Model Experience

无——提交图浏览属于浏览器与主机控制状态，不注册任何 prompt、工具或会话事件。

#### KV Cache effect

无直接影响；commit-log 读取不会改变模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `%D` 装饰以 `--decorate=full` 读取，从而无歧义地折叠引用；短装饰形式的日志会把裸分支/远程名当作未知形态丢弃。
- `firstParent` 默认为 `true`，因此合并提交只上报其第一父提交、分支会被省略；完整拓扑是按请求传入 `firstParent: false` 的退出选项。
- `show` 的补丁按字节受 `maxDiffBytes` 限制；超过 32 MiB 子进程上限的补丁会报错而非截断。
- `show` 以 `core.quotePath=false` 读取 `--name-status`，因此非合法 UTF-8 的文件名会呈现替换字符。
- 合并提交的 `show` 差异是 git 的组合差异（仅冲突解决），干净合并时为空。
- 无 blame/文件树动词，无提交暂存/创建，无分页或实时刷新，也无跨会话浏览——每次读取都根植于其会话的 cwd。
- 围栏只对 gitdir 做一次 realpath；在检查与读取之间被重定向的 gitlink 是与 workspace-files 共有的 TOCTOU 窗口。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>供维护者的工作上下文——点击展开</summary>

None.

</details>
