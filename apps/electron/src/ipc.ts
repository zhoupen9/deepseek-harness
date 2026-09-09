/**
 * IPC channel names shared by the Electron main process (main.ts) and the
 * preload (preload.ts). Keeping each channel in one module prevents its two
 * endpoints from drifting.
 * @module @deepseek-ai/dsh-electron/ipc
 */

/** Attention signal the Web UI sends to raise a native notification. */
export const NOTIFY_CHANNEL = 'dsh:notify'
