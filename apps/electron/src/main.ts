/**
 * Electron main process for the DeepSeek Harness desktop shell.
 *
 * The Web UI is not a standalone static site: only the `dsh web` profile
 * injects `window.__DSH_BOOT__` and serves the authenticated `/api` routes.
 * This process therefore boots `dsh web --no-open` as a child, reads the
 * authenticated launch URL it announces on stdout, and loads that URL in a
 * native window. The server lives and dies with the window.
 * @module @deepseek-ai/dsh-electron
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawnDshWeb, type DshWebServer } from './dsh-server.ts'

let server: DshWebServer | undefined
let mainWindow: BrowserWindow | undefined
let quitting = false

/** Stop the child server, letting its own SIGTERM handler dispose the tree. */
function terminateServer(): void {
  const child = server?.child
  server = undefined
  if (child !== undefined && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM')
  }
}

/**
 * Boot the child server, then create and load the window. A boot or load
 * failure is surfaced in a native dialog and exits the app.
 */
async function start(): Promise<void> {
  try {
    server = await spawnDshWeb()
  } catch (error) {
    dialog.showErrorBox('DeepSeek Harness failed to start', error instanceof Error ? error.message : String(error))
    app.quit()
    return
  }
  // An unexpected child exit tears down the window it was serving.
  server.child.once('exit', (code, signal) => {
    if (!quitting) {
      dialog.showErrorBox('DeepSeek Harness stopped', 'dsh web exited (code ' + String(code) + ', signal ' + String(signal) + ').')
    }
    app.quit()
  })

  const origin = new URL(server.url).origin
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'DeepSeek Harness',
    show: false,
    // The Web UI is the only chrome; hide the default application menu bar.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.once('ready-to-show', () => { mainWindow?.show() })
  mainWindow.on('closed', () => { mainWindow = undefined })

  // Keep the renderer inside the served origin; hand anything else to the
  // platform browser so links into the wider web never escape the shell.
  const allowOrigin = (url: string): boolean => url.startsWith(origin)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!allowOrigin(url)) void shell.openExternal(url)
    return { action: allowOrigin(url) ? 'allow' : 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowOrigin(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  try {
    await mainWindow.loadURL(server.url)
  } catch (error) {
    dialog.showErrorBox('DeepSeek Harness failed to load', error instanceof Error ? error.message : String(error))
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  // Another instance already owns the window; focus it and exit.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(start)
}

// The server is scoped to the window, so closing it ends the session on every
// platform (no macOS keep-alive).
app.on('window-all-closed', () => { app.quit() })
app.on('before-quit', () => { quitting = true })
app.on('will-quit', terminateServer)
