---
description: "宿主工作区文件控制：受限的一层目录与文件列举，以及有界文本读取。"
kind: "package-reference"
---
# Workspace Files Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-files-controller` 拥有 Host 的 `ctx.workspaceFilesController` 服务和生成的 Client `ctx.remote.workspaceFiles` namespace。它的两个 Agent 作用域 Remote 动词分别列举一层目录（目录与文件一起、目录在前）并读取一个文本文件的有界 UTF-8 内容。每个动词都被限制在调用会话的工作区根目录内，因此浏览器端资源管理器永远无法读取或列举其工作区之外的内容。当 Client 需要浏览文件系统而无法直接访问时，可通过 API Gateway 使用它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`list(path?, signal)` 用 `opendir` 将一层内容流式读入一个有界窗口（默认 `maxEntries` 为 1000 项），目录在前、文件在后，各自按字母排序。隐藏条目会被返回并标记，而不会被丢弃；损坏或循环的符号链接会以无大小、无修改时间的文件形式列出。`read(path, signal)` 最多读取 `maxBytes + 1` 字节（默认 512 KiB），去除 UTF-8 BOM，并在字节不是合法 UTF-8 时返回 `binary: true`，而不传输 base64。

围栏将会话的 cwd 作为工作区根目录。位于根目录父级或以上的目标，或解析到根目录之外的符号链接，都会以 `workspace-path-outside-root` 拒绝。逃逸出根目录的符号链接仍会被列出（以便客户端显示它），但读取它会被拒绝。

在 git 仓库内，`list` 还会为每个条目附加折叠后的 VCS 状态：文件携带 `vcs`（modified/added/deleted/renamed/untracked/ignored/conflicted；干净的被跟踪文件省略它），当某个非忽略的后代有差异时目录携带 `vcsDirty`，当整个目录被 git 忽略时携带 `vcs: 'ignored'`。状态是每个工作树根目录一个缓存快照，在短暂的 TTL 后重新计算，缺失或损坏的 git 会退化为 `none`/`error` 上下文，而不是让列举失败。

-----

<a id="model-experience"></a>
## 模型体验

无，因为工作区文件浏览是浏览器与宿主的控制状态，不注册任何提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；工作区文件列举与读取不会改变模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- `hidden` 仅为 POSIX 的点前缀约定；Node 的 dirent 不暴露 Windows 的隐藏属性（尽力而为，已记录）。
- 被截断的读取若在字节边界处切断一个多字节 UTF-8 序列，会把一个本来合法的文件报告为 `binary: true`。
- 围栏会对目标做一次 realpath，随后再打开它；在检查与打开之间被改动的符号链接是一个与 directory-picker-browse 相同的 TOCTOU 窗口。
- VCS 状态是某一时间点的快照：两个相邻的 list 调用读取同一个快照，在 TTL 内被改动的文件会显示其先前状态，直到快照重新计算。
- 超过 `vcs.maxDirtyPaths` 个显著路径后，状态标注会退化为不显示，而不是报告一个不完整的集合。


<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
