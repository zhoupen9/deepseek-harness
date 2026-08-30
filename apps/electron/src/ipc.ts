/**
 * IPC channel names shared by the Electron main process (main.ts) and the
 * preload (preload.ts). Keeping each channel in one module prevents its two
 * endpoints from drifting.
 * @module @deepseek-ai/dsh-electron/ipc
 */

/** Attention signal the Web UI sends to raise a native notification. */
export const NOTIFY_CHANNEL = 'dsh:notify'
/** Window-control commands from the injected title bar. */
export const WINDOW_CHANNEL = 'dsh:window'
/** One-time query the title bar makes for the current maximize state. */
export const IS_MAXIMIZED_CHANNEL = 'dsh:window:is-maximized'
/** Main-process push of maximize-state changes to the title bar. */
export const MAXIMIZED_CHANGED_CHANNEL = 'dsh:window:maximized-changed'
