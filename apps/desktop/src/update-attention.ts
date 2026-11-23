/** Best-effort background attention never grants update or task-stop authorization. */
import { app, type BrowserWindow, type NativeImage, Notification } from 'electron'
import type { DesktopLocale } from './locale.ts'

/** Copy, artwork, and native attention implementation for one background reminder. */
export interface DesktopUpdateAttentionOptions {
  /** Shell-owned notification copy. */
  readonly locale: DesktopLocale
  /** Application image shown by the platform notification. */
  readonly notificationIcon: NativeImage
  /** Native attention implementation, replaceable for platform tests. */
  readonly platform?: string
}

/** Owns one reminder per downloaded version until reset for a new download. */
export class DesktopUpdateAttention {
  private version: string | undefined
  private notification: Notification | undefined
  private stop: (() => void) | undefined
  private readonly platform: string

  /** @param options - Notification copy, notification image, and platform override. */
  constructor(private readonly options: DesktopUpdateAttentionOptions) {
    this.platform = options.platform ?? process.platform
  }

  /**
   * @param version - Prepared target whose confirmation is waiting.
   * @param parent - Taskbar window; never restored or focused by the reminder.
   * @param modal - Existing installation confirmation.
   * @param returnToConfirmation - Rechecks current policy and returns to UI without installing.
   */
  ready(version: string, parent: BrowserWindow, modal: BrowserWindow, returnToConfirmation: () => void): void {
    if (this.version === version) return
    this.version = version
    if (parent.isFocused() || modal.isFocused()) return
    const clear = (): void => { this.clear() }
    let bounce: number | undefined
    parent.on('focus', clear)
    modal.on('focus', clear)
    this.stop = () => {
      parent.off('focus', clear)
      modal.off('focus', clear)
      if (this.platform === 'win32' && !parent.isDestroyed()) parent.flashFrame(false)
      if (bounce !== undefined) app.dock?.cancelBounce(bounce)
    }
    try {
      if (this.platform === 'win32') parent.flashFrame(true)
      if (this.platform === 'darwin') bounce = app.dock?.bounce('informational')
    } catch (error) { console.warn('desktop update: attention unavailable', error) }
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({ title: this.options.locale.messages.mandatoryReady,
        body: this.options.locale.messages.mandatoryNotification, silent: true, icon: this.options.notificationIcon })
      this.notification = notification
      notification.on('failed', () => {
        if (this.notification === notification) this.notification = undefined
        notification.removeAllListeners()
      })
      notification.once('click', () => {
        if (this.notification !== notification) return
        this.clear()
        returnToConfirmation()
      })
      notification.show()
    } catch (error) { console.warn('desktop update: notification unavailable', error) }
  }

  /** Release owned native reminders without scheduling another for the same target. */
  clear(): void {
    const notification = this.notification
    this.notification = undefined
    notification?.removeAllListeners()
    try { notification?.close() }
    catch (error) { console.warn('desktop update: could not close notification', error) }
    const stop = this.stop
    this.stop = undefined
    try { stop?.() }
    catch (error) { console.warn('desktop update: could not clear attention', error) }
  }

  /** Start a new download episode, or dispose all owned reminders. */
  reset(): void { this.clear(); this.version = undefined }
}
