# Agent Note: Electron frameless window with injected title-bar controls

Status: implemented

English | [中文](2026-08-30-electron-frameless-window-chrome.zh.md)

## Problem

The Electron desktop shell (`apps/electron`) opened a standard `BrowserWindow` and let the OS draw the title bar. The shell is meant to read as a native DeepSeek Harness app, but the OS chrome — with its platform-varied buttons and placement — sits outside the app's own theming. The request was to drop the system title bar and draw minimize / maximize / close controls in the window's top-right instead.

## Decision

- **Frameless window.** `BrowserWindow` is created with `frame: false`, removing the OS title bar on every platform while keeping edge resize and maximize.
- **Preload-injected chrome.** The preload (`src/preload.ts`) floats a small minimize / maximize / close button group over the top-right of every page, with no reserved space; the same invisible container is a thin transparent drag region (`-webkit-app-region: drag`). The controls use the Web UI's `--dsw-*` design tokens with fallbacks, so they follow light/dark theme without coupling to the shared Web UI.
- **IPC window controls.** The buttons drive the window through new channels defined once in `src/ipc.ts` — `dsh:window` (a command word), `dsh:window:is-maximized` (one-time state query), and `dsh:window:maximized-changed` (state pushes). The main process maps `minimize` / `toggle-maximize` / `close` to the window, toggles maximize, and forwards `maximize`/`unmaximize` to the renderer so the glyph can swap.
- **Maximize glyph.** The maximize button swaps to a restore glyph and a "Restore" label while maximized; double-clicking the drag region toggles maximize, mirroring the native title bar.
- **Bundled preload.** The hand-written `src/preload.cjs` (copied by `scripts/copy-preload.mjs`) is replaced by `src/preload.ts`, which tsdown bundles to `lib/preload.cjs` (CommonJS, `electron` external). This inlines the shared `src/ipc.ts` / `src/window-chrome.ts` modules, matching the repo's existing worker-`.cjs` pattern, because a sandboxed preload cannot `require` relative files.
- **Testable seam.** The window-control DOM logic lives in `src/window-chrome.ts` behind a semantic `WindowChrome` seam (`send` / `onMaximized` / `isMaximized`), so it is unit-tested under jsdom with a plain fake — no Electron mock needed.

## Alternatives considered

- **Electron `titleBarStyle: 'hidden'` + `titleBarOverlay`** — rejected: the native overlay controls are unsupported on Linux, their placement and styling cannot follow the Web UI theme, and the request called for a self-drawn button group.
- **Building the controls into the shared Web UI (`packages/client`)** — rejected: it would couple the shared browser app to Electron-specific chrome; injecting from the preload keeps the whole change inside `apps/electron`.
- **Keeping a hand-written `src/preload.cjs`** — rejected: the sandboxed preload cannot `require` a relative module, so the title-bar logic had to be either duplicated or inlined by the bundler; bundling from TS makes it type-checked and unit-testable.
- **Native macOS traffic lights** — rejected (out of scope): the custom buttons replace native controls uniformly on every platform.

## Consequences

- The shell now owns its window chrome; the OS title bar is gone on every platform. macOS loses the native traffic lights in exchange for the custom button group.
- A follow-up ([Electron title bar under page content](../architecture/2026-09-02-electron-titlebar-under-content.md)) keeps the floating layout but moves the drag strip below page content in z-order and toggles the drag mask per segment: interactive controls that overlap the strip receive the interaction, and the window is draggable only over the inert parts of the top strip.
- `apps/electron` gains `src/ipc.ts`, `src/window-chrome.ts`, and `src/preload.ts`; `src/preload.cjs` and `scripts/copy-preload.mjs` are removed. The build emits `lib/main.js` (ESM) and `lib/preload.cjs` (CJS), and the package `tsconfig.json` adds the DOM lib for the renderer-side preload.
- The `WindowChrome` seam is the one place the preload adapts Electron IPC to the DOM module, keeping channel names in `ipc.ts` shared by both processes.

## Testing

- `apps/electron/tests/window-chrome.spec.ts` (jsdom) drives `installWindowChrome` with a fake `WindowChrome` and asserts button order and labels, click-to-command routing, strip double-click toggle (and that a control double-click does not toggle), the maximize glyph swap, and the already-maximized initial-state query.
