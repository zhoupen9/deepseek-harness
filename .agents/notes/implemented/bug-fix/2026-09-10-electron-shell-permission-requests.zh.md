# Agent Note: Electron 外壳的权限请求

Status: implemented

[English](2026-09-10-electron-shell-permission-requests.md) | 中文

## Problem

Electron 外壳（[apps/electron](../../../../apps/electron/README.zh.md)）安装了 session 权限请求处理器，但只授予 `local-fonts`，即设置中字体选择器所需的权限。安装请求处理器会取代 Electron 默认的“全部授予”，因此这一处比较会拒绝其他所有权限请求——包括支撑 Web UI 全部复制控件的 `clipboard-sanitized-write`。`navigator.clipboard.writeText` 以 `NotAllowedError` 拒绝，共用的 `writeClipboard` 如实报告失败，复制按钮静默无响应。

## Decision

[`apps/electron/src/permissions.ts`](../../../../apps/electron/src/permissions.ts) 持有被授予的权限名，`main.ts` 通过 `permissionGranted` 回答每个请求。集合列出了 Web UI 需要的两个权限：设置字体选择器使用的 `local-fonts`，以及复制控件使用的 `clipboard-sanitized-write`。其他请求一律拒绝，因此在安装处理器期间，页面无法获得外壳未声明的权限。

## Alternatives considered

**移除请求处理器，保留 Electron 默认行为。** 剪贴板写入会恢复，但页面请求的任何权限——媒体、地理位置、串口、USB——也会在无人审查的情况下被授予。字体选择器的授权正是为了让外壳声明自己需要什么；删除处理器等于用一处未告知的拒绝换取多处的未告知授予。

**在 `writeClipboard` 内回退到 `document.execCommand('copy')`。** 该 helper 已为缺少异步 Clipboard API 的主机（jsdom、非安全上下文）保留这条回退路径，但它对写入被拒绝刻意返回 false：拒绝是配置事实，绕过它只会让 UI 报告成功，而外壳仍处于错误配置。

**同时授予 `clipboard-read`。** 客户端没有代码通过异步 API 读取剪贴板；粘贴以原生剪贴板事件到达，并带有自己的隐式授权。授予读取只会为一个无人使用的能力扩大集合。

## Consequences

Electron 外壳的复制控件恢复工作：消息复制、Markdown 代码块、终端与 diff 块、工作区行以及会话日志导出都共用 `writeClipboard`。需要未列出权限的 Web UI 能力仍然既不会写入也不会弹出提示——即本记录修复的同一种静默失败——因此该授予集合是唯一需要扩展的位置。

## Testing

[`apps/electron/tests/permissions.spec.ts`](../../../../apps/electron/tests/permissions.spec.ts) 覆盖被授予的集合，以及 Web UI 没有使用方的权限仍被拒绝。处理器接入 `session.defaultSession` 的过程只有用系统 Electron 二进制启动外壳时才会执行；没有自动化套件会启动它。
