/**
 * Font-color preference row registered into the General section item slot:
 * title + description + one native color control per palette mode (light and
 * dark), each with a reset restoring that mode's shipped default. Registered
 * by this package — the theme feature owns the per-mode default-text-color
 * setting the same way it owns the appearance preference. Each swatch shows
 * the persisted color, or that mode's shipped palette default while unset
 * (reset = no override, never a stored hex). The displayed value follows the
 * persisted setting, never the click echo.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createFontColorRowStore } from './settings-store.ts'
import css from './FontColorRow.module.css'

/** Injected business face: the per-mode color writes (t rides the standard locale seat). */
export interface FontColorRowInjected {
  /** Change the default text color used while the light palette is active ('' resets). */
  setFontColorLight: (color: string) => void
  /** Change the default text color used while the dark palette is active ('' resets). */
  setFontColorDark: (color: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontColorRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontColorRowStore>>
  & PropsLocale<'settings.theme'> & FontColorRowInjected

/** One palette mode's shipped default label-primary color (the alias values a
 * reset inherits; static because a live computed style only reflects the mode
 * currently applied to the document). */
const PALETTE_DEFAULT: Record<'light' | 'dark', string> = { light: '#0f1115', dark: '#f9fafb' }

/** Expand #rgb to #rrggbb; other durable color forms cannot feed a native
 * color input, whose value must be a six-digit hex color. */
function swatchValue(color: string, mode: 'light' | 'dark'): string {
  if (color === '') return PALETTE_DEFAULT[mode]
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (match === null) return PALETTE_DEFAULT[mode]
  const hex = match[1]
  /* v8 ignore next -- group 1 is always present on a match; noUncheckedIndexedAccess types it as undefined */
  if (hex === undefined) return PALETTE_DEFAULT[mode]
  return hex.length === 6
    ? `#${hex.toLowerCase()}`
    : `#${hex.toLowerCase().replace(/([0-9a-f])/g, '$1$1')}`
}

/**
 * Render the font-color row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontColorRow({ t, setFontColorLight, setFontColorDark, useStore }: FontColorRowComponentProps) {
  const fontColorLight = useStore(s => s.fontColorLight)
  const fontColorDark = useStore(s => s.fontColorDark)
  const modes: readonly { id: 'light' | 'dark'; labelKey: ThemeKey; color: string; set: (color: string) => void }[] = [
    { id: 'light', labelKey: 'fontColor.light', color: fontColorLight, set: setFontColorLight },
    { id: 'dark', labelKey: 'fontColor.dark', color: fontColorDark, set: setFontColorDark },
  ]
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('fontColor.title')}</div>
        <div className={css.desc}>{t('fontColor.description')}</div>
      </div>
      <div className={css.control}>
        {modes.map(mode => (
          <div key={mode.id} className={css.modeLine}>
            <span className={css.modeLabel}>{t(mode.labelKey)}</span>
            <input
              type="color"
              className={css.swatch}
              value={swatchValue(mode.color, mode.id)}
              aria-label={t(mode.labelKey)}
              onChange={(event) => { mode.set(event.target.value) }}
            />
            <button
              type="button"
              className={css.reset}
              aria-label={`${t('fontColor.reset')} ${t(mode.labelKey)}`}
              onClick={() => { mode.set('') }}
            >
              {t('fontColor.reset')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
