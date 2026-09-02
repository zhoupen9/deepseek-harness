# Agent Note: Electron 无边框窗口与注入式标题栏控制

Status: implemented

[English](2026-08-30-electron-frameless-window-chrome.md) | 中文

## 问题

Electron 桌面外壳（`apps/electron`）此前打开一个标准的 `BrowserWindow`，由操作系统绘制标题栏。外壳本应呈现为一个原生的 DeepSeek Harness 应用，而操作系统自带的标题栏 —— 其按钮位置与外观因平台而异 —— 位于应用自身主题之外。需求是移除系统标题栏，改为在窗口右上角绘制最小化 / 最大化 / 关闭控制。

## 决策

- **无边框窗口。** 以 `frame: false` 创建 `BrowserWindow`，在所有平台上移除系统标题栏，同时保留边缘调整大小与最大化。
- **由 preload 注入外框。** preload（`src/preload.ts`）在每个页面的右上角悬浮一组 最小化 / 最大化 / 关闭 按钮，不预留任何空间；同一个不可见容器同时是一条细长的透明拖动区域（`-webkit-app-region: drag`）。这些控件使用 Web UI 的 `--dsw-*` 设计令牌并带有回退值，因此能跟随明暗主题，而无需耦合到共享的 Web UI。
- **通过 IPC 控制窗口。** 按钮通过 `src/ipc.ts` 中一次性定义的新通道驱动窗口 —— `dsh:window`（命令词）、`dsh:window:is-maximized`（一次性状态查询）、`dsh:window:maximized-changed`（状态推送）。主进程将 `minimize` / `toggle-maximize` / `close` 映射到窗口操作，切换最大化，并将 `maximize`/`unmaximize` 转发给渲染进程以便切换图标。
- **最大化图标。** 窗口最大化时，最大化按钮切换为还原图标与 “Restore” 标签；双击拖动区域可切换最大化，与原生的标题栏行为一致。
- **打包后的 preload。** 手写的 `src/preload.cjs`（由 `scripts/copy-preload.mjs` 复制）被 `src/preload.ts` 取代，由 tsdown 打包为 `lib/preload.cjs`（CommonJS，`electron` 保持外部依赖）。这会把共享的 `src/ipc.ts` / `src/window-chrome.ts` 模块内联进去，符合仓库既有的 worker-`.cjs` 模式，因为沙箱化 preload 无法 `require` 相对文件。
- **可测试的接缝。** 窗口控制 DOM 逻辑位于 `src/window-chrome.ts`，背后是一个语义化的 `WindowChrome` 接缝（`send` / `onMaximized` / `isMaximized`），因此可以在 jsdom 下用普通假对象进行单元测试 —— 无需 mock Electron。

## 备选方案

- **Electron `titleBarStyle: 'hidden'` + `titleBarOverlay`** —— 否决：原生覆盖控制在 Linux 上不支持，其位置与样式无法跟随 Web UI 主题，且需求要求自行绘制按钮组。
- **把控件构建进共享的 Web UI（`packages/client`）** —— 否决：会把共享浏览器应用耦合到 Electron 专属外框；从 preload 注入可把整个改动限制在 `apps/electron` 内。
- **保留手写的 `src/preload.cjs`** —— 否决：沙箱化 preload 无法 `require` 相对模块，因此标题栏逻辑要么复制、要么由打包器内联；从 TS 打包可使其获得类型检查与单元测试。
- **原生 macOS 红绿灯按钮** —— 否决（超出范围）：自定义按钮在所有平台上统一替代原生控件。

## 后果

- 外壳现在拥有自己的窗口外框；所有平台上的系统标题栏都被移除。macOS 以失去原生红绿灯按钮为代价，换来自定义按钮组。
- 后续的 [Electron 标题栏位于页面内容之下](../architecture/2026-09-02-electron-titlebar-under-content.zh.md) 保留悬浮布局，但把拖动顶栏移到页面内容之下（z-order），并按分段切换拖动遮罩：与顶栏重叠的可交互控件接收交互，窗口只在顶栏的惰性区域可拖动。
- `apps/electron` 新增 `src/ipc.ts`、`src/window-chrome.ts` 与 `src/preload.ts`；`src/preload.cjs` 与 `scripts/copy-preload.mjs` 被移除。构建产物为 `lib/main.js`（ESM）与 `lib/preload.cjs`（CJS），包级 `tsconfig.json` 为渲染侧 preload 增加了 DOM lib。
- `WindowChrome` 接缝是 preload 把 Electron IPC 适配到 DOM 模块的唯一位置，使 `ipc.ts` 中的通道名由两个进程共享。

## 测试

- `apps/electron/tests/window-chrome.spec.ts`（jsdom）用假 `WindowChrome` 驱动 `installWindowChrome`，断言按钮顺序与标签、点击到命令的路由、顶栏双击切换（以及控件双击不切换）、最大化图标切换，以及已处于最大化状态的初始查询。
