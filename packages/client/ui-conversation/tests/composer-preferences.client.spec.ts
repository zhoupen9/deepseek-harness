import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ComposerPreferences, composerStatisticsVisible } from '../src/client/composer-preferences.ts'
import type { ChatPreferenceSettings } from '../src/client/contract/composer-preferences.ts'

describe('ComposerPreferences', () => {
  it('leaves the accepted level unknown until the Host serves one', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    const preferences = new ComposerPreferences(host.scope)
    expect(preferences.mode.getSnapshot()).toBeUndefined()
    // An absent or unrelated update carries no mode and must not fabricate one.
    host.publish({ value: {} })
    host.publish({ value: undefined })
    expect(preferences.mode.getSnapshot()).toBeUndefined()
    // Nothing may render before the accepted section arrives.
    expect(preferences.visible).toBe(false)
    preferences.dispose()
  })

  it('adopts an accepted level at construction and after updates', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    host.publish({ value: { performanceUsage: 'compact' } })
    const preferences = new ComposerPreferences(host.scope)
    expect(preferences.mode.getSnapshot()).toBe('compact')
    for (const mode of ['detailed', 'hidden', 'compact'] as const) {
      host.publish({ value: { performanceUsage: mode } })
      expect(preferences.mode.getSnapshot()).toBe(mode)
    }
    preferences.dispose()
  })

  it('treats a mode outside this composer contract as the ordinary level', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    host.publish({ value: { performanceUsage: 'hidden' } })
    const preferences = new ComposerPreferences(host.scope)
    // A composer that met a future value would blank its statistics instead of
    // showing them, so only a recognized hiding mode hides anything.
    host.publish({ value: { performanceUsage: 'silent' as never } })
    expect(preferences.mode.getSnapshot()).toBe('detailed')
    preferences.dispose()
  })

  it('hides only once a served preference says so, and shows them while none arrives', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    const preferences = new ComposerPreferences(host.scope)
    // Host-backed page, mirror still loading: the composer must not paint
    // statistics a hidden preference would remove in the next frame.
    expect(preferences.visible).toBe(false)
    host.publish({ status: 'ready', value: { performanceUsage: 'detailed' } })
    expect(preferences.visible).toBe(true)
    host.publish({ value: { performanceUsage: 'hidden' } })
    expect(preferences.visible).toBe(false)
    host.publish({ value: { performanceUsage: 'compact' } })
    expect(preferences.visible).toBe(true)
    preferences.dispose()
  })

  it('shows statistics where the Host serves no settings scope at all', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    host.publish({ status: 'unavailable' })
    const preferences = new ComposerPreferences(host.scope)
    // The pills read the same absent section and keep their default rendering,
    // so the ring must not diverge from them on a read-only page.
    expect(preferences.visible).toBe(true)
    preferences.dispose()
  })

  it('derives one stable visibility source that follows every accepted update', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    const preferences = new ComposerPreferences(host.scope)
    const visible = composerStatisticsVisible(preferences)
    const seen: boolean[] = []
    const unsubscribe = visible.subscribe(() => { seen.push(visible.getSnapshot()) })
    host.publish({ status: 'ready', value: { performanceUsage: 'hidden' } })
    host.publish({ value: { performanceUsage: 'detailed' } })
    unsubscribe()
    expect(seen).toEqual([false, true])
    expect(visible.getSnapshot()).toBe(true)
    preferences.dispose()
  })

  it('releases its subscription when the consuming plugin unloads', () => {
    const host = stubConfigForm<ChatPreferenceSettings>()
    const preferences = new ComposerPreferences(host.scope)
    expect(host.listenerCount()).toBe(1)
    preferences.dispose()
    expect(host.listenerCount()).toBe(0)
  })
})
