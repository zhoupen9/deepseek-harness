/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { bootThemeInjections } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_MONO_FONT, DEFAULT_PREFERENCE, DEFAULT_VARIANT_FONT,
  THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_MONO_FONT, DEFAULT_PREFERENCE, DEFAULT_VARIANT_FONT,
  FONT_COLOR_DARK_FIELD, FONT_COLOR_LIGHT_FIELD, FONT_FAMILY_MAX_LENGTH, FONT_SIZE_FIELD,
  FONT_SIZE_MAX, FONT_SIZE_MIN, MONO_FONT_FIELD, THEME_PREFERENCE_FIELD, THEME_PREFERENCES,
  THEME_SETTINGS_NAMESPACE, VARIANT_FONT_FIELD,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = THEME_SETTINGS_NAMESPACE

/** Read the registered theme section or the schema defaults without a settings provider. */
function readSection(ctx: Context): ThemeSettings {
  const fallback: ThemeSettings = {
    preference: DEFAULT_PREFERENCE,
    fontSize: DEFAULT_FONT_SIZE,
    variantFont: DEFAULT_VARIANT_FONT,
    monoFont: DEFAULT_MONO_FONT,
    fontColorLight: '',
    fontColorDark: '',
  }
  const settings = ctx.get('settings')
  if (settings === undefined) return fallback
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return fallback
  return section
}

/**
 * Register the durable theme section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * theme bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    const section = readSection(ctx)
    table.push(...bootThemeInjections(section.preference, section.fontSize, section.variantFont, section.monoFont))
  }, { prepend: true })
}
