import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PREFERENCE, FONT_COLOR_DARK_FIELD, FONT_COLOR_LIGHT_FIELD,
  THEME_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-theme'
import { isFontColor } from '../src/theme-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** Narrow the theme row and return its script body. */
function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('ui-theme host', () => {
  it('registers, validates, and disposes the durable theme namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = THEME_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({
      preference: DEFAULT_PREFERENCE, fontSize: 14, variantFont: '', monoFont: '',
      fontColorLight: '', fontColorDark: '',
    })
    // A section written before the color fields existed (no color keys) still
    // resolves: the widened schema defaults both fields to ''.
    await ctx.settings.update(ns, { preference: 'dark', fontSize: 16 })
    expect(ctx.settings.get(ns)).toEqual({
      preference: 'dark', fontSize: 16, variantFont: '', monoFont: '',
      fontColorLight: '', fontColorDark: '',
    })
    // Solid colors persist per mode; invalid or alpha-bearing values reject.
    await ctx.settings.update(ns, { [FONT_COLOR_LIGHT_FIELD]: '#0f1115', [FONT_COLOR_DARK_FIELD]: 'hsl(210, 50%, 40%)' })
    expect(ctx.settings.get(ns)).toEqual({
      preference: 'dark', fontSize: 16, variantFont: '', monoFont: '',
      fontColorLight: '#0f1115', fontColorDark: 'hsl(210, 50%, 40%)',
    })
    await expect(ctx.settings.update(ns, { [FONT_COLOR_LIGHT_FIELD]: 'red' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { [FONT_COLOR_DARK_FIELD]: 'rgba(0, 0, 0, 0.5)' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { preference: 'sepia' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { fontSize: 11 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { fontSize: 18 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('answers each collection with the current durable preference until disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const rows = collect(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(scriptText(rows[0])).toContain('const preference = "system"')
    expect(scriptText(rows[0])).toContain('"14px"')
    expect(scriptText(rows[0])).toContain('--dsh-ui-font-family')
    expect(scriptText(rows[0])).toContain('--dsh-mono-font-family')
    expect(scriptText(rows[0])).toContain('dshVariantFont')
    expect(scriptText(rows[0])).toContain('dshMonoFont')
    await ctx.settings.update(THEME_SETTINGS_NAMESPACE, { preference: 'dark', fontSize: 17, variantFont: 'Georgia', monoFont: 'JetBrains Mono' })
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "dark"')
    expect(scriptText(collect(ctx)[0])).toContain('"17px"')
    expect(scriptText(collect(ctx)[0])).toContain('"Georgia"')
    expect(scriptText(collect(ctx)[0])).toContain('"JetBrains Mono"')
    await fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })

  it('uses the system preference without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "system"')
  })

  it('falls back to the schema default while the theme namespace holds no section', async () => {
    // A settings provider whose namespace read comes back empty (registration
    // still pending or a provider without schema defaults).
    const ctx = new Context()
    ctx.provide('settings', { register: () => () => {}, get: () => undefined } as never)
    await ctx.plugin({ apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "system"')
  })

  it('accepts empty, hex, and rgb()/hsl() text colors and rejects the rest', () => {
    // The empty string is the durable "no override" value; every non-empty
    // accepted value is a solid CSS color. Alpha-bearing forms (rgba(),
    // alpha channels, #rrggbbaa) are rejected: alpha text composites
    // differently over surfaces and makes contrast unguaranteed.
    const valid = [
      '', '#0f1115', '#fff', '#F9FAFB',
      'rgb(15, 17, 21)', 'rgb(15 17 21)', 'rgb(100%, 0%, 0%)',
      'hsl(210, 50%, 40%)', 'hsl(210deg 50% 40%)',
    ]
    for (const value of valid) expect(isFontColor(value)).toBe(true)
    const invalid = [
      'red', 'transparent', '#12345', '#f9fafb80',
      'rgba(0, 0, 0, 0.5)', 'rgb(15 17 21 / 50%)', 'hsl(210 50%)',
      'not-a-color', 42, null,
    ]
    for (const value of invalid) expect(isFontColor(value)).toBe(false)
  })
})
