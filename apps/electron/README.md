# @deepseek-ai/dsh-electron

English | [中文](README.zh.md)

Electron desktop shell for [DeepSeek Harness](../..): it boots the `dsh web` profile in a child process and hosts its authenticated Web UI in a native window.

## How it works

The Web UI is not a standalone static site — only `dsh web` injects `window.__DSH_BOOT__` and serves the authenticated `/api` routes. The shell therefore:

1. Spawns `dsh web --no-open` (resolved from `@deepseek-ai/dsh`'s `bin`).
2. Waits for the authenticated launch URL that `dsh web` prints on stdout (its readiness signal), including the one-time `?token=`.
3. Loads that URL in a native `BrowserWindow` and keeps navigation inside the served origin; any other link opens in the platform browser.

The server process lives and dies with the window: closing the window sends `SIGTERM` and ends the session.

## Window chrome

The window is frameless — the OS title bar is removed (`frame: false`) and the shell draws no window controls: minimize / restore / close ride the OS or window-manager shortcuts. There is **no dedicated title bar and no reserved space**: a transparent drag strip rides the top of the page so the window stays movable. The drag strip lives **below page content in z-order**, so the page never has a dead band at the top: interactive controls (buttons, links, inputs, tabs, menu items) that overlap the strip receive the interaction, and the window is draggable only over the inert parts of the top strip (header padding, background, empty areas).

Electron's `-webkit-app-region` drag regions are geometric rectangles, not z-order aware — a drag region blocks clicks on anything beneath it regardless of stacking. The strip is therefore split into drag segments, and the preload re-evaluates each segment with `document.elementFromPoint` (on pointer moves near the strip, scroll, resize, and pointer down), flipping a segment to `no-drag` when an interactive control is the topmost element over it, so that control's area is carved out of the drag mask. The native mask updates asynchronously, so a click landing within a frame of the pointer entering a covered segment may still begin a window drag; the pointer-down and pointer-move refreshes keep that window short.

## Notifications

The shell raises native desktop notifications for two kinds of events:

- **Lifecycle** — once when the window finishes loading, and when the child server stops unexpectedly.
- **Attention** — when the Web UI needs the user's attention or action: an approval request (`approval`), a question (`question`), a plan ready for review (`plan-review`), or a completed assistant turn (`turn-complete`).

Attention notifications only fire when the window is not focused; a focused window already shows the event in the UI.

The Web UI signals these by calling `window.dshNotify(kind)`, which the shell's preload exposes through `contextBridge`; the main process maps the kind to a notification. Set `DSH_DEBUG_NOTIFY=1` to trace each attention event in the shell's stdout.

## Prerequisites

- A built workspace. The spawned CLI is the compiled `@deepseek-ai/dsh` `lib/bin.js`, so run `pnpm run build` at the repository root first.
- Node `^22.19 || >=24` (the same range as the harness). The spawned `dsh web` runs under this Node, not the Electron binary: the harness's plugin loader reaches Node internals through the `node-addon-require-builtin` native addon, which cannot load under `ELECTRON_RUN_AS_NODE`.
- A system-installed Electron (43.x). The npm `electron` dependency is kept only for its TypeScript declarations — its postinstall binary download is denied in `pnpm-workspace.yaml`, and `scripts/electron.mjs` resolves the runtime from the system instead.

## Run

```sh
# from the repository root
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run dev
```

`dev` builds the main process (`tsdown`) and launches Electron via `scripts/electron.mjs`, which prefers the system `electron` binary. `start` assumes the build already exists.

## Scripts

- `build` — bundle `src/main.ts` to `lib/main.js` (ESM) and `src/preload.ts` to `lib/preload.cjs` (CommonJS, with `electron` external) via tsdown.
- `typecheck` — `tsc -b`.
- `test` — unit tests (URL-line parser, bin resolution, and drag-strip injection).
- `start` — run `scripts/electron.mjs` over the built `lib/main.js`.
- `dev` — build, then run `scripts/electron.mjs`.

### Choosing the Electron binary

`scripts/electron.mjs` resolves the runtime in this order: the `DSH_ELECTRON_BIN` environment variable, electron's `ELECTRON_OVERRIDE_DIST_PATH` convention, then an `electron` on `PATH` outside `node_modules/.bin` (the system install), and finally the npm shim. Set `DSH_ELECTRON_BIN=/path/to/electron` to force a specific binary.

The child `dsh web` process is spawned with the ambient `node` from `PATH` (not the Electron binary). Set `DSH_NODE=/path/to/node` to force a specific Node.

## Known Limitations and Deferred Work

- No distributable packaging (electron-builder/Forge) yet; the app runs from a source checkout only.
- `SIGTERM` is used for shutdown; on Windows `child.kill('SIGTERM')` maps to a force-terminate rather than the harness's graceful handler.
- The child inherits this process's environment; model credentials are picked up from the ambient `DEEPSEEK_API_KEY` / `.env` as `dsh web` would.
