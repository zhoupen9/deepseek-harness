/**
 * CSS font-family resolution for the variant and fixed-width font settings.
 * The persisted value is a chosen family name ('' = built-in default); the
 * resolvers build the concrete stack the boot script and presenter write on
 * body, and the detection helper lists fonts the current browser can render.
 */

/** Default variant stack (today's --dsw-font-family value), used when variantFont is empty. */
const VARIANT_DEFAULT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"

/** Default fixed-width stack (today's --ds-font-family-code value), used when monoFont is empty. */
const MONO_DEFAULT = "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"

/** CJK faces appended after a user-chosen Latin family so Chinese text keeps its
 * proportional faces; a bare generic tail after these would send Windows CJK to
 * SimSun, so the variant resolver's sans-serif tail comes only after the CJK faces. */
const VARIANT_TAIL = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

/** CJK faces appended after a chosen monospace family; no bare 'monospace' tail so CJK never falls to SimSun. */
const MONO_TAIL = "'PingFang SC', 'Microsoft YaHei'"

/** Body variable carrying the selected variant (proportional) font stack. */
export const UI_FONT_VARIABLE = '--dsh-ui-font-family'

/** Body variable carrying the selected fixed-width (monospace) font stack. */
export const MONO_FONT_VARIABLE = '--dsh-mono-font-family'

/** Body dataset attribute carrying the selected variant font family name. */
export const UI_FONT_ID_ATTRIBUTE = 'dshVariantFont'

/** Body dataset attribute carrying the selected fixed-width font family name. */
export const MONO_FONT_ID_ATTRIBUTE = 'dshMonoFont'

/**
 * Resolve a persisted variant family name to its CSS stack.
 * An empty name returns the built-in default stack; a non-empty name is
 * quoted first and trailed by the CJK faces and a sans-serif tail.
 * @param family - persisted font family name ('' = built-in default).
 * @returns the CSS font-family stack.
 */
export function variantFontStack(family: string): string {
  if (family === '') return VARIANT_DEFAULT
  return `${JSON.stringify(family)}, ${VARIANT_TAIL}`
}

/**
 * Resolve a persisted fixed-width family name to its CSS stack.
 * An empty name returns the built-in default stack; a non-empty name is
 * quoted first and trailed by the CJK faces (no generic monospace tail).
 * @param family - persisted font family name ('' = built-in default).
 * @returns the CSS font-family stack.
 */
export function monoFontStack(family: string): string {
  if (family === '') return MONO_DEFAULT
  return `${JSON.stringify(family)}, ${MONO_TAIL}`
}

/** The Local Font Access API surface: Chromium exposes it on the window. */
interface LocalFontAccess {
  queryLocalFonts: () => Promise<{ family: string }[]>
}

/**
 * Load the font family names actually installed on this machine via the Local
 * Font Access API. Resolves to an empty list when the API or its permission is
 * absent, or when the user denies the prompt — the picker then shows only the
 * built-in default. Families are de-duplicated (a family with multiple weights
 * reports once) and sorted case-insensitively.
 * @returns a promise of the installed family names.
 */
export async function loadInstalledFonts(): Promise<string[]> {
  if (typeof window === 'undefined') return []
  const access = (window as unknown as { queryLocalFonts?: LocalFontAccess['queryLocalFonts'] }).queryLocalFonts
  if (typeof access !== 'function') return []
  try {
    const fonts = await access.call(window)
    const seen = new Set<string>()
    for (const font of fonts) seen.add(font.family)
    return [...seen].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  } catch {
    // Permission denied or API unsupported: the picker degrades to the default.
    return []
  }
}
