/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference and content font size;
 * the browser resolves only `system`, then writes the same DOM fields
 * ui-layout's ThemePresenter owns after the client plugin tree activates.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_FONT_SIZE, DEFAULT_MONO_FONT, DEFAULT_PREFERENCE, DEFAULT_VARIANT_FONT,
  type ThemePreference,
} from './theme-settings.ts'
import {
  MONO_FONT_ID_ATTRIBUTE, MONO_FONT_VARIABLE, monoFontStack, UI_FONT_ID_ATTRIBUTE,
  UI_FONT_VARIABLE, variantFontStack,
} from './styles/font-stacks.ts'

/** Build the inline script body for one schema-validated durable theme section. */
function bootThemeScript(preference: ThemePreference, fontSize: number, variantFont: string, monoFont: string): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${fontSize}px`)})
  document.documentElement.style.setProperty(${JSON.stringify(UI_FONT_VARIABLE)}, ${JSON.stringify(variantFontStack(variantFont))})
  document.documentElement.style.setProperty(${JSON.stringify(MONO_FONT_VARIABLE)}, ${JSON.stringify(monoFontStack(monoFont))})
  document.body.dataset.${UI_FONT_ID_ATTRIBUTE} = ${JSON.stringify(variantFont)}
  document.body.dataset.${MONO_FONT_ID_ATTRIBUTE} = ${JSON.stringify(monoFont)}
})()`
}

/**
 * The theme bootstrap as an injection row: an inline script immediately after
 * the opening body tag, before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @param variantFont - Current Host-backed variant (proportional) font family name.
 * @param monoFont - Current Host-backed fixed-width font family name.
 * @returns the body script row.
 */
export function bootThemeInjection(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
  variantFont: string = DEFAULT_VARIANT_FONT,
  monoFont: string = DEFAULT_MONO_FONT,
): IndexInjection {
  return { kind: 'script', placement: 'body', text: bootThemeScript(preference, fontSize, variantFont, monoFont) }
}
