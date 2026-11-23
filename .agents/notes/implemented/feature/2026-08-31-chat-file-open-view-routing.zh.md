# Agent Note: 聊天文件打开在注册了 Files 视图时路由到该视图

Status: implemented

[English](2026-08-31-chat-file-open-view-routing.md) | 中文

## Problem

聊天页面的文件链接通过 `openFile` 打开：`chatFileMentions` 提及解析器、回合尾部芯片和文件工具行都调用它，它会在主机上原生打开路径（`openWorkspacePath` → `openNativePath`，[在操作系统中打开工具调用文件](../../archived/feature/2026-07-28-tool-call-file-open-in-os.md)）。树外的 `ui-files` 插件希望聊天文件链接在其 Files 资源管理器中打开，并将会话切换到该标签页。平台已经提供了这种手势：`ConversationSession` 将 `openView(view, focus)` 传递给每个 `conversation.view` 组件，它会设置活动标签页并向被寻址的视图发送一次性焦点请求（Files 视图以 `focus = path` 响应 `view === 'files'`）。但是聊天文件打开的所有者——`TurnTailOwnerProps`（`chatFileMentions` 提供者的 `forClosing(owner)` 所接收的）和 `ChatNodeOwnerProps`（键控节点渲染器，包括文件工具行）——只携带 `openFile`，而且聊天的文件打开入口点总是原生打开，因此没有任何界面可以将打开路由到会话视图。

## Decision

**聊天文件打开经过一个决策点路由。** `ChatView.requestOpenFile` —— 所有聊天界面（工具行、生成文件芯片、已发布的散文提及）调用的 `openFile` —— 在注册了 `files` 会话视图时切换到该视图，否则回退到主机打开器。Files 视图 id 是协议常量 `FILES_VIEW_ID = 'files'`，与 ui-files 插件为其 `conversation.view` 条目注册的 id 一致；`ConversationSession` 现在将会话的已注册视图名册交给每个视图条目（`ConvViewOwnerProps.conversationViews`），`ChatView` 据此做出决定。

**所有者同时携带视图打开器。** `ChatView` 通过 `ChatNodeSeat` 将其 `openView` owner 属性传递到路由后的 `ChatNodeOwnerProps`，`TurnTailNodeView` 和 `AssistantNodeView` 将其复制到它们构建的 `TurnTailOwnerProps` 中——因此 `chatFileMentions` 提供者可以自己路由提及点击（`owner.openView('files', path)`），而不必经过 `openFile`。

## Alternatives considered

**新的主机 RPC。** 已拒绝：标签页切换是浏览器端会话存储状态；主机不参与其中。

**由 `openFile` 查询的 `chatFileOpen` 服务。** 已拒绝：提供者仍然需要 `openView`，而它只在组件层持有；owner 属性穿线加上 `ChatView` 中基于名册的路由是最小的接缝。

## Consequences

在注册了 `files` 视图的部署中，每个聊天文件链接——工具行路径、生成文件芯片、已发布的散文提及——都会切换到该标签页并以路径作为焦点，Files 视图显示该文件（完成一次性请求）。没有该视图的部署保持完全先前的行为：主机原生打开路径。`ConvViewOwnerProps` 增加了 `conversationViews`（目录重新生成；测试中的视图条目构建器已更新）。`~/.dsh` 的 ui-files 提供者通过 `owner.openView` 路由自己的散文提及，其 Files 视图已经消费焦点请求。
