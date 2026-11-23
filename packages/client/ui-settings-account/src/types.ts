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
  /**
   * Replace this run's Harness with a remote Web Host.
   * @param url - complete URL printed by the remote `dsh --profile web`, including its token.
   * @returns success, or the failure code the connect dialog localizes.
   */
  connectRemote?: (url: string) => Promise<DesktopRemoteConnectionResult>
}

/** Failure code for one remote Harness connection attempt; the shell reports it and the launcher localizes it. */
export type DesktopRemoteFailure =
  | 'invalid-url'
  | 'missing-token'
  | 'unreachable'
  | 'authentication'
  | 'no-injections'
  | 'version-mismatch'
  | 'local-host'
  | 'local-stop'
  | 'internal'

/** Settlement of one remote Harness connection request. */
export type DesktopRemoteConnectionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: DesktopRemoteFailure }
