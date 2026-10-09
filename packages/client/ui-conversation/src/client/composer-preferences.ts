/** Composer statistics visibility shared with the Chat domain. */

import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PERFORMANCE_MODES, type ChatPreferenceSettings, type PerformanceMode } from './contract/composer-preferences.ts'

/** Ordinary detail level when no preference is served. */
const DEFAULT_PERFORMANCE_MODE: PerformanceMode = 'detailed'

/**
 * Only a mode this composer understands hides its statistics; anything else
 * keeps them, so an unserved or future value never blanks the composer.
 */
function parsePerformanceMode(value: unknown): PerformanceMode {
  return typeof value === 'string' && (PERFORMANCE_MODES as readonly string[]).includes(value)
    ? value as PerformanceMode
    : DEFAULT_PERFORMANCE_MODE
}

/**
 * Composer statistics preference. The accepted value is owned by the Chat
 * settings namespace, whose row labels every mode; this reader follows it so
 * the context meter, which is not a composer dock entry, hides with the pills.
 * The mode contract is declared in `contract/composer-preferences.ts` rather
 * than imported from the owning plugin: a client feature plugin crosses to a
 * sibling only through Cordis services and slots.
 */
export class ComposerPreferences {
  private readonly unsubscribe: () => void
  /** Accepted detail level; undefined until the Host serves a preference. */
  readonly mode: SnapshotStore<PerformanceMode | undefined> = createSnapshotStore<PerformanceMode | undefined>(undefined)

  /** @param host - Chat settings scope, served by Settings and writable only for host-backed pages. */
  constructor(private readonly host: ConfigForm<ChatPreferenceSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.performanceUsage
      if (accepted !== undefined) this.mode.set(parsePerformanceMode(accepted))
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /**
   * Whether composer statistics are shown. Nothing is shown before the first
   * accepted section, so a page that already hid them never paints them once
   * while the settings mirror loads; a scope that serves no settings at all
   * shows them, as the pills, which read the same absent section, do.
   * @returns the current visibility.
   */
  get visible(): boolean {
    const { status } = this.host.getSnapshot()
    if (status === 'unavailable') return true
    if (status === 'loading') return false
    return this.mode.getSnapshot() !== 'hidden'
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }
}

/**
 * Stable observable face of {@link ComposerPreferences.visible} for the bar's
 * hook compartment: the source identity decides hook binding, so it must not
 * be rebuilt per registration.
 * @param preferences - composer statistics preference reader.
 * @returns the visibility source, which notifies with the accepted mode.
 */
export function composerStatisticsVisible(preferences: ComposerPreferences): ObservableSnapshot<boolean> {
  return {
    getSnapshot: () => preferences.visible,
    subscribe: listener => preferences.mode.subscribe(listener),
  }
}
