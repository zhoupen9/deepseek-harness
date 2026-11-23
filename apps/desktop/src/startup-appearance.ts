/**
 * Last theme source reported by the Web UI, used to paint the packaged index
 * before the Host can supply its own index injections.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** Built-in preferences accepted from Electron's nativeTheme and the Web UI. */
export const THEME_SOURCES = ['light', 'dark', 'system'] as const

/** One persistable theme source. */
export type ThemeSource = typeof THEME_SOURCES[number]

/** Loading-page canvas colors, matching the ui-theme bootstrap palette. */
const LIGHT_BACKGROUND = '#fff'
const DARK_BACKGROUND = '#151517'

const HINT_FILE = 'theme.json'

function themeSource(value: unknown): value is ThemeSource {
  return typeof value === 'string' && (THEME_SOURCES as readonly string[]).includes(value)
}

/**
 * Read the last reported theme source. The Web UI's durable preference remains
 * authoritative; this value only covers the interval before the Host answers.
 * @param userData - Electron's userData directory.
 * @returns The stored source, or `system` when absent or unreadable.
 */
export function readThemeSourceHint(userData: string): ThemeSource {
  const path = join(userData, 'desktop', HINT_FILE)
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof value !== 'object' || value === null || !('themeSource' in value)) {
      throw new Error('expected an object with a themeSource of light, dark, or system')
    }
    const stored: unknown = (value as { themeSource?: unknown }).themeSource
    if (!themeSource(stored)) throw new Error('expected a themeSource of light, dark, or system')
    return stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`desktop theme hint: ${path}: using system because the source could not be loaded`, error)
    }
    return 'system'
  }
}

/**
 * Store the theme source reported by the Web UI for the next launch. Failures
 * keep the previous hint and never disturb the running application.
 * @param userData - Electron's userData directory.
 * @param source - Validated theme source applied to the native theme.
 */
export function writeThemeSourceHint(userData: string, source: ThemeSource): void {
  const path = join(userData, 'desktop', HINT_FILE)
  const temporary = `${path}.tmp-${String(process.pid)}`
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(temporary, `${JSON.stringify({ themeSource: source }, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    console.warn(`desktop theme hint: ${path}: could not store ${source}`, error)
    try { unlinkSync(temporary) } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`desktop theme hint: ${temporary}: could not remove the partial file`, cleanupError)
    }
  }
}

/**
 * Loading-page canvas color for one resolved native appearance.
 * @param dark - Whether the effective preference resolves to the dark palette.
 * @returns The canvas background color.
 */
export function themeBackground(dark: boolean): string {
  return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

/**
 * Rows that color the packaged index before its client bundles load. The
 * ui-theme plugin's `bootThemeInjections` owns the same document contract
 * (`color-scheme`, `--dsh-boot-bg`, and `body[data-ds-dark-theme]`) once the
 * Host supplies its own rows.
 * @param source - Last reported theme source.
 * @returns Head style and body script markup.
 */
export function startupThemeMarkup(source: ThemeSource): { readonly head: string; readonly body: string } {
  const light = `:root{color-scheme:light}body{background-color:${LIGHT_BACKGROUND};--dsh-boot-bg:${LIGHT_BACKGROUND}}`
  const dark = `:root{color-scheme:dark}body{background-color:${DARK_BACKGROUND};--dsh-boot-bg:${DARK_BACKGROUND}}`
  const style = source === 'light' ? light : source === 'dark' ? dark : `${light}@media(prefers-color-scheme:dark){${dark}}`
  const resolvedDark = source === 'dark'
    ? 'true'
    : source === 'light' ? 'false' : "matchMedia('(prefers-color-scheme: dark)').matches"
  const script = `(() => {
  document.documentElement.dataset.dsThemeSource = ${JSON.stringify(source)}
  document.body.toggleAttribute('data-ds-dark-theme', ${resolvedDark})
})()`
  return { head: `<style>${style}</style>`, body: `<script>${script}</script>` }
}
