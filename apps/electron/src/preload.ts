/**
 * Electron preload for the DeepSeek Harness shell.
 *
 * This script runs in the isolated preload world before the Web UI boots and
 * does two jobs:
 *
 * 1. Exposes `window.dshNotify(kind)` — the Web UI calls it when the user's
 *    attention or action is needed; the main process maps the kind to a native
 *    desktop notification.
 * 2. Installs the frameless window's drag strip — main.ts opens the window
 *    with `frame: false`, so there is no OS title bar and the shell draws no
 *    window controls; {@link installWindowChrome} injects a transparent strip
 *    along the top edge so the window stays movable, while interactive page
 *    content overlapping the strip keeps receiving the interaction.
 *
 * The build bundles this to `lib/preload.cjs` (CommonJS, with `electron`
 * left external): sandboxed preloads cannot load ESM.
 * @module @deepseek-ai/dsh-electron/preload
 */
import { contextBridge, ipcRenderer } from 'electron'
import { NOTIFY_CHANNEL } from './ipc.ts'
import { installWindowChrome } from './window-chrome.ts'

contextBridge.exposeInMainWorld('dshNotify', (kind: unknown) => {
  if (typeof kind !== 'string' || kind === '') return
  ipcRenderer.send(NOTIFY_CHANNEL, { kind })
})

installWindowChrome()
