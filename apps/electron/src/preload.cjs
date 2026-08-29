// Electron preload for the DeepSeek Harness shell.
// Exposes `window.dshNotify(kind)` to the Web UI; the main process maps the kind
// to a native desktop notification. The Web UI calls it when the user's attention
// or action is needed (approval requested, question asked, plan ready for review,
// or an assistant turn completed).
// CommonJS: sandboxed preloads cannot load ESM.
const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = 'dsh:notify'

contextBridge.exposeInMainWorld('dshNotify', (kind) => {
  if (typeof kind !== 'string' || kind === '') return
  ipcRenderer.send(CHANNEL, { kind })
})
