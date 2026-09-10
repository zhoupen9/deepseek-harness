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

import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { spawnDshWeb, type DshWebServer } from './dsh-server.ts'
import { NOTIFY_CHANNEL } from './ipc.ts'
import { permissionGranted } from './permissions.ts'

let server: DshWebServer | undefined
let mainWindow: BrowserWindow | undefined
let quitting = false

// The Local Font Access API (window.queryLocalFonts) — powering the Settings
// font pickers — is behind a Chromium feature flag and a permission prompt.
// Enable it, and grant it for the shell's own webContents so the pickers act
// on the host's real installed fonts without prompting. Only the served
// origin reaches a window (other navigation is sent to the platform browser),
// so scoping the grant to the shell's own pages is no broader than the session.
app.commandLine.appendSwitch('enable-features', 'LocalFontAccess')
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permissionGranted(permission))
  })
})

/** Stop the child server, letting its own SIGTERM handler dispose the tree. */
function terminateServer(): void {
  const child = server?.child
  server = undefined
  if (child !== undefined && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM')
  }
}

/**
 * Show a native desktop notification, no-oping on platforms without support
 * (for example a Linux session with no notification daemon).
 * @param title - notification title.
 * @param body - notification body text.
 */
function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

/**
 * Notification copy for each Web UI attention kind. The Web UI calls
 * `window.dshNotify(kind)` when the user's attention or action is needed; the
 * shell maps the kind to a notification.
 */
const ATTENTION_COPY: Readonly<Record<string, { title: string; body: string }>> = {
  approval: { title: 'Approval requested', body: 'DeepSeek Harness needs your approval to continue.' },
  question: { title: 'Question', body: 'DeepSeek Harness has a question for you.' },
  'plan-review': { title: 'Plan ready', body: 'DeepSeek Harness has a plan for your review.' },
  'turn-complete': { title: 'Response ready', body: 'DeepSeek Harness finished responding.' },
}

/** Log a diagnostic line when `DSH_DEBUG_NOTIFY` is set (any non-empty value). */
function logNotify(message: string): void {
  if (process.env.DSH_DEBUG_NOTIFY !== undefined && process.env.DSH_DEBUG_NOTIFY !== '') {
    console.log('[dsh-notify]', message)
  }
}

/** Whether the shell window currently has focus (or none exists yet). */
function windowFocused(): boolean {
  return mainWindow !== undefined && mainWindow.isFocused()
}

/** Forward one Web UI attention kind to a native notification. */
function handleAttention(kind: unknown): void {
  if (typeof kind !== 'string') return
  const copy = ATTENTION_COPY[kind]
  logNotify('attention kind ' + JSON.stringify(kind) + (copy === undefined ? ' (unknown)' : ''))
  if (copy === undefined) return
  // Attention notifications only interrupt when the window is not already in
  // front of the user; a focused window already shows the event in the UI.
  if (windowFocused()) {
    logNotify('suppressing ' + kind + ': window focused')
    return
  }
  logNotify('notifying: ' + copy.title)
  notify(copy.title, copy.body)
}

ipcMain.on(NOTIFY_CHANNEL, (_event, payload: unknown) => {
  const kind = typeof payload === 'object' && payload !== null ? (payload as { kind?: unknown }).kind : undefined
  handleAttention(kind)
})

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
      const detail = 'dsh web exited (code ' + String(code) + ', signal ' + String(signal) + ').'
      notify('DeepSeek Harness stopped', detail)
      dialog.showErrorBox('DeepSeek Harness stopped', detail)
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
    // The shell runs frameless: no OS title bar and no injected window
    // controls; the preload installs a transparent drag strip along the top so
    // the window stays movable (preload.ts), while minimize / restore / close
    // ride the OS or window-manager shortcuts. The menu bar stays hidden.
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  mainWindow.once('ready-to-show', () => { mainWindow?.show() })
  mainWindow.on('closed', () => { mainWindow = undefined })
  // F12 opens the DevTools dock for the main window.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
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
    notify('DeepSeek Harness', 'Ready')
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
