/**
 * Appearance, font, and font-color row slot stores: mirrors of the theme
 * service snapshot. The plugin's apply-world change listener is the only
 * writer; the row components read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SIZES, type FontFamilies, type FontSizes, type ThemePreference } from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, revision: number) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', revision: -1 }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's fonts (shared by the font-size row and the font settings group). */
export interface FontRowState {
  /** Persisted font sizes in px by role. */
  fontSizes: FontSizes
  /** Persisted normalized font lists by role. */
  fontFamilies: FontFamilies
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontRowActions = {
  sync: (draft: FontRowState, fontSizes: FontSizes, fontFamilies: FontFamilies, revision: number) => void
}

/**
 * Declares the font rows' state and write surface.
 * @returns the store handle.
 */
export function createFontRowStore(): EngineStoreHandle<FontRowState, FontRowActions> {
  return defineStore({
    init: (): FontRowState => ({ fontSizes: DEFAULT_FONT_SIZES, fontFamilies: { text: '', code: '', terminal: '' }, revision: -1 }),
    actions: {
      sync: (d, fontSizes: FontSizes, fontFamilies: FontFamilies, revision: number) => {
        if (revision <= d.revision) return
        d.fontSizes = fontSizes
        d.fontFamilies = fontFamilies
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's default text colors. */
export interface FontColorRowState {
  /** Default text color while the light palette is active ('' = no override). */
  fontColorLight: string
  /** Default text color while the dark palette is active ('' = no override). */
  fontColorDark: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontColorRowActions = {
  sync: (draft: FontColorRowState, fontColorLight: string, fontColorDark: string, revision: number) => void
}

/**
 * Declares the font-color row state and write surface.
 * @returns the store handle.
 */
export function createFontColorRowStore(): EngineStoreHandle<FontColorRowState, FontColorRowActions> {
  return defineStore({
    init: (): FontColorRowState => ({ fontColorLight: '', fontColorDark: '', revision: -1 }),
    actions: {
      sync: (d, fontColorLight: string, fontColorDark: string, revision: number) => {
        if (revision <= d.revision) return
        d.fontColorLight = fontColorLight
        d.fontColorDark = fontColorDark
        d.revision = revision
      },
    },
  })
}
