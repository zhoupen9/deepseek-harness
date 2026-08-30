/**
 * Electron preload for the DeepSeek Harness shell.
 *
 * This script runs in the isolated preload world before the Web UI boots and
 * does two jobs:
 *
 * 1. Exposes `window.dshNotify(kind)` — the Web UI calls it when the user's
 *    attention or action is needed; the main process maps the kind to a native
 *    desktop notification.
 * 2. Installs the frameless window's title bar — main.ts opens the window with
 *    `frame: false`, so there is no OS title bar; {@link installWindowChrome}
 *    draws a slim top strip whose right side holds minimize / maximize / close
 *    controls, wired back to the main process over IPC.
 *
 * The build bundles this to `lib/preload.cjs` (CommonJS, with `electron`
 * left external): sandboxed preloads cannot load ESM.
 * @module @deepseek-ai/dsh-electron/preload
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IS_MAXIMIZED_CHANNEL, MAXIMIZED_CHANGED_CHANNEL, NOTIFY_CHANNEL, WINDOW_CHANNEL } from './ipc.ts'
import { installWindowChrome, type WindowChrome } from './window-chrome.ts'

contextBridge.exposeInMainWorld('dshNotify', (kind: unknown) => {
  if (typeof kind !== 'string' || kind === '') return
  ipcRenderer.send(NOTIFY_CHANNEL, { kind })
})

const chrome: WindowChrome = {
  send: (action) => { ipcRenderer.send(WINDOW_CHANNEL, action) },
  onMaximized: (listener) => {
    ipcRenderer.on(MAXIMIZED_CHANGED_CHANNEL, (_event, maximized) => { listener(maximized === true) })
  },
  isMaximized: async () => (await ipcRenderer.invoke(IS_MAXIMIZED_CHANNEL)) === true,
}

installWindowChrome(chrome)
