# Agent Note: Web 账号菜单中的桌面应用命令

Status: implemented

[English](2026-09-23-desktop-application-commands-in-the-web-account-menu.md) | 中文

侧边栏账号菜单承载桌面外壳的应用命令（不含仅限 macOS 的窗口可见性命令），且仅请求由主进程执行的效果。

## 问题

桌面外壳的应用命令位于原生应用菜单中。Linux 主窗口无边框且菜单栏自动隐藏，Windows 则以标题栏的 Application 弹出菜单替代应用菜单，因此没有任何一个原生界面在所有平台都提供这些命令。macOS 菜单还包含作用于操作系统窗口而非产品本身的窗口可见性命令。

## 决策

侧边栏账号入口在账号行之上渲染外壳应用命令组，并在其下渲染“退出”：关于 DeepSeek Harness、检查更新…、开发构建中的刷新页面与重启应用与 Host，以及退出 DeepSeek Harness。仅限 macOS 的“隐藏”“隐藏其他”“显示全部”保留在原生菜单中。

Web UI 只请求这些命令。`apps/desktop/src/preload-app.ts` 向 `dsh-app://app` 文档暴露 `dshDesktop.application`（`development` 以及 `about`、`quit`、`reload`、`restart`），各处理器保留既有的 `assertProductSender` 校验。`packages/client/ui-settings-account/src/client/desktop-application.ts` 将该载体投影为入口菜单的命令，并对“检查更新…”复用既有更新载体，使更新提示只有一条通道。`packages/client/ui-settings-account` 仅在载体声明 `protocolVersion: 1` 且同时提供应用组和更新组时构建该命令组；更早的外壳保留仅含账号的菜单。

刷新页面与重启在两处都仅限开发构建。`createWindow` 只为未打包构建的主窗口追加 `--dsh-desktop-development` 渲染器参数，preload 将其报告为 `development`，主进程在打包运行时独立拒绝这两个通道。关于沿用原生菜单的平台划分：Windows 使用外壳的暗色对话框（Electron 的兜底是朴素消息框），其他平台使用原生关于面板。

## 备选方案

**只保留原生菜单入口。** Linux 无边框窗口和 Windows 标题栏菜单已提供这些命令，但它们都不是用户寻找账号级操作的位置，且在窗口边框保持隐藏时无法触达。

**由外壳向 Web UI 提供命令列表。** 异步返回描述符会让菜单内容依赖一次请求，并把加载状态引入入口组件；而标签和图标属于 Web 文案。带开发标记的固定载体使渲染保持同步，并让文案留在语言字典中。

**在所有构建中暴露刷新与重启。** Electron 自身的菜单仅在开发构建提供这两项；刷新会丢弃页面内的查看状态，重启会在没有更新提示的任务准备下停止运行中的 Host，因此打包构建只提供退出路径。

**在 Web 菜单中镜像 macOS 的窗口可见性命令。** 这些命令作用于操作系统窗口，且原生菜单已经承载它们；Web 菜单负责账号与应用命令。

## 后果

账号包读取第二个 Desktop 载体，与 `ui-settings-general`、`ui-sidebar-browser` 为其各自能力采用的模式相同。版本差异是显式的：早于该载体的外壳保留仅含账号的菜单，而不是显示无法工作的行。

开发限制刻意存在两处：preload 隐藏这些行，主进程在打包构建中拒绝这些通道，因此被修改的渲染进程也无法触达它们。Web 的“退出”与原生 Quit 项执行同一条有序退出流程。

## 测试

`packages/client/ui-settings-account/tests/account.client.spec.tsx` 固定有无开发命令时的渲染行、每条命令的分发，以及被拒绝命令的控制台报告。`apply.client.spec.ts` 用桩 `dshDesktop` 固定组合，`desktop-application.client.spec.ts` 覆盖载体投影及其缺失情形。`apps/desktop/tests/main-startup.spec.ts` 覆盖关于的平台划分、开发构建的刷新与重启路径、打包构建的拒绝以及退出请求；`apps/desktop/tests/preload-app.spec.ts` 覆盖暴露的通道和开发标记。

## 相关

[DeepSeek 账号浏览器登录](2026-09-14-deepseek-account-login.zh.md)记录入口菜单的退出登录位置与账号流。
