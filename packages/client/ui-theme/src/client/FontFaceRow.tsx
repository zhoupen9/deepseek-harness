/**
 * Font-face preference row registered into the General section item slot:
 * title + body-text-only description + a native select listing the fonts
 * installed on this machine (each option previews its own family) plus a
 * leading default entry. One component serves both the variant (proportional)
 * font row and the fixed-width (monospace) font row — the owning plugin passes
 * the copy keys and the write callback through the injected face, while the
 * installed-family list rides the row store (a shared reactive fact). Selection
 * follows the persisted family; the family list loads asynchronously and starts
 * empty while the Local Font Access API resolves.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createFontFaceRowStore } from './settings-store.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './FontFaceRow.module.css'

/** Injected business face: the family write plus the row's copy. */
export interface FontFaceRowInjected {
  /** Locale key for the row title. */
  titleKey: ThemeKey
  /** Locale key for the row description. */
  descKey: ThemeKey
  /** Locale key for the leading built-in-default option label. */
  defaultKey: ThemeKey
  /** Change the font family name ('' restores the built-in default). */
  setFont: (family: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontFaceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createFontFaceRowStore>>
  & PropsLocale<'settings.theme'> & FontFaceRowInjected

/**
 * Render a font-face row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontFaceRow({ t, titleKey, descKey, defaultKey, setFont, useStore }: FontFaceRowComponentProps) {
  const font = useStore(s => s.font)
  const families = useStore(s => s.families)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(titleKey)}</div>
        <div className={css.desc}>{t(descKey)}</div>
      </div>
      <select
        className={css.select}
        value={font}
        aria-label={t(titleKey)}
        onChange={(event) => { setFont(event.target.value) }}
      >
        <option value="">{t(defaultKey)}</option>
        {families.map(family => (
          <option key={family} value={family} style={{ fontFamily: family }}>{family}</option>
        ))}
      </select>
    </div>
  )
}
