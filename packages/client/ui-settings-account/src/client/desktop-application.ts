/** Optional Desktop preload carrier projected onto the launcher's application commands. */
import type { DesktopApplicationCommands, DesktopRemoteConnectionResult } from '../types.ts'

/**
 * Preload fields the launcher reads. A shell older than this contract carries
 * the update carrier alone, so both groups are optional here.
 */
export interface DesktopCarrier {
  readonly protocolVersion?: number
  readonly application?: {
    readonly development: boolean
    about: () => Promise<void>
    quit: () => Promise<void>
    reload: () => Promise<void>
    restart: () => Promise<void>
    connectRemote?: (url: string) => Promise<DesktopRemoteConnectionResult>
  }
  readonly updates?: { open: () => Promise<void> }
}

/**
 * Project the Desktop preload carrier onto the commands the launcher renders.
 * @param carrier - `globalThis.dshDesktop`, absent outside the Desktop shell.
 * @returns commands for this contract's shell, or undefined in browsers and older shells.
 */
export function desktopApplicationCommands(carrier: DesktopCarrier | undefined): DesktopApplicationCommands | undefined {
  if (carrier === undefined || carrier.protocolVersion !== 1) return undefined
  const { application, updates } = carrier
  if (application === undefined || updates === undefined) return undefined
  const connectRemote = application.connectRemote
  return {
    development: application.development,
    about: () => application.about(),
    openUpdates: () => updates.open(),
    reload: () => application.reload(),
    restart: () => application.restart(),
    quit: () => application.quit(),
    ...(connectRemote === undefined ? {} : { connectRemote: (url: string) => connectRemote(url) }),
  }
}
