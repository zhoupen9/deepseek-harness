/** Type-only Electron declarations consumed by the sidebar account launcher. */

/** Shell-owned application commands the launcher requests; the shell performs every effect. */
export interface DesktopApplicationCommands {
  /** Whether the shell exposes the development-only reload and restart commands. */
  readonly development: boolean
  /** Show the shell's About panel. */
  about: () => Promise<void>
  /** Open the shell's update prompt. */
  openUpdates: () => Promise<void>
  /** Reload the primary document. */
  reload: () => Promise<void>
  /** Relaunch the application. */
  restart: () => Promise<void>
  /** Request the shell's ordered shutdown. */
  quit: () => Promise<void>
}
