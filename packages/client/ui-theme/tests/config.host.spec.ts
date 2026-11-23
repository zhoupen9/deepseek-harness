import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection, WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_PREFERENCE, Config, apply,
} from '@deepseek-ai/dsh-client-ui-theme'
import { FONT_COLOR_DARK_FIELD, FONT_COLOR_LIGHT_FIELD, isFontColor } from '../src/theme-settings.ts'

/** The Peer an index render speaks for; this listener reads no field of it. */
const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]


/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table, PAGE_PEER)
  return table
}

/** Narrow a theme style or script row and return its text. */
function rowText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script' && row?.kind !== 'style') throw new Error('expected a style or script row')
  return row.text
}

describe('ui-theme host', () => {
  it('registers, validates, and disposes the durable theme namespace with its fiber', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: DEFAULT_PREFERENCE, fontSize: 14, codeFontSize: 11, terminalFontSize: 13, textFontFamily: '', codeFontFamily: '', terminalFontFamily: '', fontColorLight: '', fontColorDark: '' })
    await configuration.update({ preference: 'dark', fontSize: 10, codeFontSize: 16, codeFontFamily: '"Iosevka"' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'dark', fontSize: 10, codeFontSize: 16, terminalFontSize: 13, textFontFamily: '', codeFontFamily: '"Iosevka"', terminalFontFamily: '', fontColorLight: '', fontColorDark: '' })
    await configuration.update({ fontSize: 22 })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ preference: 'dark', fontSize: 22 })
    // Solid colors persist per mode; invalid or alpha-bearing values reject.
    await configuration.update({ [FONT_COLOR_LIGHT_FIELD]: '#0f1115', [FONT_COLOR_DARK_FIELD]: 'hsl(210, 50%, 40%)' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ fontColorLight: '#0f1115', fontColorDark: 'hsl(210, 50%, 40%)' })
    await expect(configuration.update({ [FONT_COLOR_LIGHT_FIELD]: 'red' })).rejects.toThrow()
    await expect(configuration.update({ [FONT_COLOR_DARK_FIELD]: 'rgba(0, 0, 0, 0.5)' })).rejects.toThrow()
    await expect(configuration.update({ preference: 'sepia' })).rejects.toThrow()
    await expect(configuration.update({ fontSize: 9 })).rejects.toThrow()
    await expect(configuration.update({ fontSize: 23 })).rejects.toThrow()
    await expect(configuration.update({ codeFontSize: 17 })).rejects.toThrow()
    await expect(configuration.update({ terminalFontSize: 9 })).rejects.toThrow()
    await fiber.dispose()
  })

  it('answers each collection with the current durable preference until disposal', async () => {
    const ctx = new Context()
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: 'window.afterTheme=true' })
    })
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    const rows = collect(ctx)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ kind: 'style' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(rows[2]).toMatchObject({ kind: 'script', placement: 'head', text: 'window.afterTheme=true' })
    expect(rowText(rows[0])).toContain('@media(prefers-color-scheme:dark)')
    expect(rowText(rows[1])).toContain('const preference = "system"')
    expect(rowText(rows[1])).toContain('"14px"')
    expect(rowText(rows[1])).not.toContain('--dsh-font-family')
    await configuration.update({ preference: 'dark', fontSize: 22, terminalFontSize: 18, terminalFontFamily: 'MesloLGS NF' })
    expect(rowText(collect(ctx)[1])).toContain('"--dsh-terminal-font-size", "18px"')
    expect(rowText(collect(ctx)[1])).toContain('"--dsh-font-family-terminal", "\\"MesloLGS NF\\""')
    expect(rowText(collect(ctx)[0])).toContain('color-scheme:dark')
    expect(rowText(collect(ctx)[1])).toContain('const preference = "dark"')
    expect(rowText(collect(ctx)[1])).toContain('"22px"')
    await fiber.dispose()
    expect(collect(ctx)).toEqual([{ kind: 'script', placement: 'head', text: 'window.afterTheme=true' }])
  })

  it('uses the system preference without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ Config, apply }).await()
    expect(rowText(collect(ctx)[1])).toContain('const preference = "system"')
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

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
