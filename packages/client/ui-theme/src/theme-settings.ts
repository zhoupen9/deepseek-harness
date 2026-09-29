/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Field carrying the selected variant (proportional) UI font family name. */
export const VARIANT_FONT_FIELD = 'variantFont'

/** Field carrying the selected fixed-width (monospace) font family name. */
export const MONO_FONT_FIELD = 'monoFont'

/** Field carrying the default text color while the light palette is active. */
export const FONT_COLOR_LIGHT_FIELD = 'fontColorLight'

/** Field carrying the default text color while the dark palette is active. */
export const FONT_COLOR_DARK_FIELD = 'fontColorDark'

/** Empty family name: fall back to the built-in default stack. */
export const DEFAULT_VARIANT_FONT = ''

/** Empty family name: fall back to the built-in default stack. */
export const DEFAULT_MONO_FONT = ''

/** Longest accepted font family name (chars). Bounds the durable value the
 * browser later interpolates into a CSS font-family string. */
export const FONT_FAMILY_MAX_LENGTH = 64

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 10

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 22

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Selected variant (proportional) font family name; empty = built-in default. */
  variantFont: string
  /** Selected fixed-width (monospace) font family name; empty = built-in default. */
  monoFont: string
  /**
   * Default text color while the light palette is active. Empty or absent =
   * no override, so the shipped alias palette applies.
   */
  fontColorLight?: string
  /**
   * Default text color while the dark palette is active. Empty or absent =
   * no override, so the shipped alias palette applies.
   */
  fontColorDark?: string
}

/**
 * A validated font-family name: non-empty strings and '' (the default).
 * @returns the schema field for one selectable font family.
 */
export const fontFamilyField = () => z.string().max(FONT_FAMILY_MAX_LENGTH).default('')

/**
 * Anchored matcher for one persistable default-text-color value: the empty
 * string (no override) or a solid CSS color — #rgb/#rrggbb hex, or rgb()/hsl()
 * in the comma or space-separated form. Alpha-bearing forms (rgba(), a /
 * <alpha> channel, #rrggbbaa) are rejected because text color must stay
 * solid: alpha text composites differently over surfaces and makes contrast
 * unguaranteed.
 */
const FONT_COLOR_PATTERN = new RegExp(
  [
    '^(?:|#(?:[0-9a-f]{3}){1,2}',
    '|rgb\\(\\s*-?\\d+(?:\\.\\d+)?%?\\s*,\\s*-?\\d+(?:\\.\\d+)?%?\\s*,\\s*-?\\d+(?:\\.\\d+)?%?\\s*\\)',
    '|rgb\\(\\s*-?\\d+(?:\\.\\d+)?%?\\s+-?\\d+(?:\\.\\d+)?%?\\s+-?\\d+(?:\\.\\d+)?%?\\s*\\)',
    '|hsl\\(\\s*-?\\d+(?:\\.\\d+)?(?:deg|grad|rad|turn)?\\s*,\\s*-?\\d+(?:\\.\\d+)?%\\s*,\\s*-?\\d+(?:\\.\\d+)?%\\s*\\)',
    '|hsl\\(\\s*-?\\d+(?:\\.\\d+)?(?:deg|grad|rad|turn)?\\s+-?\\d+(?:\\.\\d+)?%\\s+-?\\d+(?:\\.\\d+)?%\\s*\\)',
    ')$',
  ].join(''),
  'i',
)

/**
 * A validated default-text-color field: '' (no override) or a solid CSS color.
 * @returns the schema field for one palette mode's default text color.
 */
export const fontColorField = () => z.string().pattern(FONT_COLOR_PATTERN).default('')

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [VARIANT_FONT_FIELD]: fontFamilyField(),
  [MONO_FONT_FIELD]: fontFamilyField(),
  [FONT_COLOR_LIGHT_FIELD]: fontColorField(),
  [FONT_COLOR_DARK_FIELD]: fontColorField(),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Validate a persisted font family: the empty string (built-in default) or a
 * non-empty name within {@link FONT_FAMILY_MAX_LENGTH} characters.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is a persistable font family name.
 */
export function isFontFamily(value: unknown): value is string {
  return value === '' || (typeof value === 'string' && value.length <= FONT_FAMILY_MAX_LENGTH)
}

/**
 * Validate a persisted default text color: the empty string (no override) or
 * a solid CSS color accepted by {@link ThemeSettingsSchema}.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is persistable as a default text color.
 */
export function isFontColor(value: unknown): value is string {
  return value === '' || (typeof value === 'string' && FONT_COLOR_PATTERN.test(value))
}
