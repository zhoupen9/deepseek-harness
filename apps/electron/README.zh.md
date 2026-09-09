# @deepseek-ai/dsh-electron

[English](README.md) | 中文

[DeepSeek Harness](../..) 的 Electron 桌面外壳：它在子进程中启动 `dsh web` 配置，并在原生窗口中承载其经过认证的 Web UI。

## 工作原理

Web UI 不是独立的静态站点 —— 只有 `dsh web` 会注入 `window.__DSH_BOOT__` 并提供经过认证的 `/api` 路由。因此外壳会：

1. 启动 `dsh web --no-open`（从 `@deepseek-ai/dsh` 的 `bin` 解析）。
2. 等待 `dsh web` 打印到 stdout 的经过认证的启动 URL（即它的就绪信号），其中包含一次性 `?token=`。
3. 在原生 `BrowserWindow` 中加载该 URL，并将导航限制在所服务的源内；任何其他链接都会在系统浏览器中打开。

服务器进程与窗口同生命周期：关闭窗口会发送 `SIGTERM` 并结束会话。

## 窗口外框

窗口采用无边框设计 —— 移除了系统标题栏（`frame: false`），外壳不绘制任何窗口控件：最小化 / 还原 / 关闭交由操作系统或窗口管理器快捷键处理。**没有专用标题栏，也不预留任何空间**：一条透明的拖动顶栏贴着页面顶部，让窗口保持可拖动。拖动顶栏位于**页面内容之下（z-order）**，因此页面顶部不再有死区：与顶栏重叠的可交互控件（按钮、链接、输入框、标签页、菜单项）接收交互，窗口只在顶栏的惰性区域（头部内边距、背景、空白处）可拖动。

Electron 的 `-webkit-app-region` 拖动区域是几何矩形，不感知 z-order —— 拖动区域会拦截其下方任何元素的点击，无论层叠顺序如何。因此顶栏被拆分为若干拖动分段，preload 通过 `document.elementFromPoint` 持续重新评估每个分段（在靠近顶栏的指针移动、滚动、窗口缩放和按下指针时触发）：当某个可交互控件成为该点的最顶层元素时，将其下的分段切换为 `no-drag`，从而把这些控件从拖动遮罩中挖掉。原生遮罩是异步更新的，因此指针进入被覆盖分段后的一帧内点击，仍可能触发窗口拖动；按下与移动指针时的刷新会尽量缩短这一窗口。

## 通知

外壳会在两类事件时显示原生桌面通知：

- **生命周期** —— 窗口加载完成时一次，以及子服务器意外停止时。
- **需要关注** —— 当 Web UI 需要用户关注或操作时：审批请求（`approval`）、提问（`question`）、待审阅的计划（`plan-review`），或助手回合完成（`turn-complete`）。

关注通知仅在窗口未聚焦时触发；聚焦的窗口已经在 UI 中显示了该事件。

Web UI 通过调用 `window.dshNotify(kind)` 来发信号，该函数由外壳的 preload 通过 `contextBridge` 暴露；主进程将 kind 映射为通知。可设置 `DSH_DEBUG_NOTIFY=1` 在外壳 stdout 中追踪每个关注事件。

## 前置条件

- 已构建的工作区。被启动的 CLI 是编译后的 `@deepseek-ai/dsh` `lib/bin.js`，因此需先在仓库根目录运行 `pnpm run build`。
- Node `^22.19 || >=24`（与 harness 相同的版本范围）。被启动的 `dsh web` 运行在此 Node 而非 Electron 二进制上：harness 的插件加载器通过 `node-addon-require-builtin` 原生插件访问 Node 内部，该插件无法在 `ELECTRON_RUN_AS_NODE` 模式下加载。
- 系统安装的 Electron（43.x）。npm 的 `electron` 依赖仅用于其 TypeScript 类型声明 —— 其 postinstall 二进制下载已在 `pnpm-workspace.yaml` 中拒绝，运行时由 `scripts/electron.mjs` 从系统中解析。

## 运行

```sh
# from the repository root
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run dev
```

`dev` 会构建主进程（`tsdown`）并通过 `scripts/electron.mjs` 启动 Electron，该脚本优先使用系统的 `electron` 二进制。`start` 假定构建已存在。

## 脚本

- `build` —— 将 `src/main.ts` 打包为 `lib/main.js`（ESM），并将 `src/preload.ts` 打包为 `lib/preload.cjs`（CommonJS，`electron` 保持外部依赖），通过 tsdown 完成。
- `typecheck` —— `tsc -b`。
- `test` —— 单元测试（URL 行解析、bin 解析与拖动顶栏注入）。
- `start` —— 在构建好的 `lib/main.js` 上运行 `scripts/electron.mjs`。
- `dev` —— 构建，然后运行 `scripts/electron.mjs`。

### 选择 Electron 二进制

`scripts/electron.mjs` 按以下顺序解析运行时：`DSH_ELECTRON_BIN` 环境变量、electron 的 `ELECTRON_OVERRIDE_DIST_PATH` 约定、`PATH` 上位于 `node_modules/.bin` 之外的 `electron`（即系统安装），最后才是 npm 垫片。可设置 `DSH_ELECTRON_BIN=/path/to/electron` 强制指定某个二进制。

子进程 `dsh web` 使用 `PATH` 上的 `node`（而非 Electron 二进制）启动。可设置 `DSH_NODE=/path/to/node` 强制指定某个 Node。

## 已知限制与待办工作

- 尚无可分发的打包方案（electron-builder/Forge）；当前应用只能从源码检出运行。
- 关闭时使用 `SIGTERM`；在 Windows 上 `child.kill('SIGTERM')` 会映射为强制终止，而非 harness 的优雅处理。
- 子进程继承本进程的环境；模型凭据与 `dsh web` 一样，从环境的 `DEEPSEEK_API_KEY` / `.env` 读取。
