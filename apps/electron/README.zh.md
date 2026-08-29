# @deepseek-ai/dsh-electron

[DeepSeek Harness](../..) 的 Electron 桌面外壳：它在子进程中启动 `dsh web` 配置，并在原生窗口中承载其经过认证的 Web UI。

## 工作原理

Web UI 不是独立的静态站点 —— 只有 `dsh web` 会注入 `window.__DSH_BOOT__` 并提供经过认证的 `/api` 路由。因此外壳会：

1. 启动 `dsh web --no-open`（从 `@deepseek-ai/dsh` 的 `bin` 解析）。
2. 等待 `dsh web` 打印到 stdout 的经过认证的启动 URL（即它的就绪信号），其中包含一次性 `?token=`。
3. 在原生 `BrowserWindow` 中加载该 URL，并将导航限制在所服务的源内；任何其他链接都会在系统浏览器中打开。

服务器进程与窗口同生命周期：关闭窗口会发送 `SIGTERM` 并结束会话。

## 前置条件

- 已构建的工作区。被启动的 CLI 是编译后的 `@deepseek-ai/dsh` `lib/bin.js`，因此需先在仓库根目录运行 `pnpm run build`。
- Node `^22.19 || >=24`（与 harness 相同的版本范围）。
- 系统安装的 Electron（43.x）。npm 的 `electron` 依赖仅用于其 TypeScript 类型声明 —— 其 postinstall 二进制下载已在 `pnpm-workspace.yaml` 中拒绝，运行时由 `scripts/electron.mjs` 从系统中解析。

## 运行

```sh
# 在仓库根目录
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run dev
```

`dev` 会构建主进程（`tsdown`）并通过 `scripts/electron.mjs` 启动 Electron，该脚本优先使用系统的 `electron` 二进制。`start` 假定构建已存在。

## 脚本

- `build` —— 将 `src/main.ts` 打包为 `lib/main.js`（tsdown）。
- `typecheck` —— `tsc -b`。
- `test` —— 单元测试（URL 行解析与 bin 解析）。
- `start` —— 在构建好的 `lib/main.js` 上运行 `scripts/electron.mjs`。
- `dev` —— 构建，然后运行 `scripts/electron.mjs`。

### 选择 Electron 二进制

`scripts/electron.mjs` 按以下顺序解析运行时：`DSH_ELECTRON_BIN` 环境变量、electron 的 `ELECTRON_OVERRIDE_DIST_PATH` 约定、`PATH` 上位于 `node_modules/.bin` 之外的 `electron`（即系统安装），最后才是 npm 垫片。可设置 `DSH_ELECTRON_BIN=/path/to/electron` 强制指定某个二进制。

## 已知限制与待办工作

- 尚无可分发的打包方案（electron-builder/Forge）；当前应用只能从源码检出运行。
- 关闭时使用 `SIGTERM`；在 Windows 上 `child.kill('SIGTERM')` 会映射为强制终止，而非 harness 的优雅处理。
- 子进程继承本进程的环境；模型凭据与 `dsh web` 一样，从环境的 `DEEPSEEK_API_KEY` / `.env` 读取。
