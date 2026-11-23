/** Appearance, font, and font-color row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontColorRowStore, createFontRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', revision: -1 })
  })

  it('sync mirrors the preference and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', revision: 0 })
    store.actions.sync('light', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 3)
    store.actions.sync('system', 2)
    store.actions.sync('system', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createFontRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' }, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontRowStore().create()
    const sizes = { text: 16, code: 12, terminal: 14 }
    const fonts = { text: '"Inter"', code: '', terminal: '' }
    store.actions.sync(sizes, { ...fonts }, 3)
    expect(store.getSnapshot()).toEqual({ fontSizes: sizes, fontFamilies: fonts, revision: 3 })
    store.actions.sync({ ...sizes, text: 12 }, fonts, 2)
    store.actions.sync({ ...sizes, text: 12 }, fonts, 3)
    expect(store.getSnapshot().fontSizes.text).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createFontColorRowStore', () => {
  it('init shape: no override for either mode with revision at -1', () => {
    expect(createFontColorRowStore().create().getSnapshot()).toEqual({ fontColorLight: '', fontColorDark: '', revision: -1 })
  })

  it('sync mirrors both colors; the revision guard drops stale and duplicate writes', () => {
    const store = createFontColorRowStore().create()
    store.actions.sync('#0f1115', '#f9fafb', 3)
    expect(store.getSnapshot()).toEqual({ fontColorLight: '#0f1115', fontColorDark: '#f9fafb', revision: 3 })
    store.actions.sync('#101010', '#eeeeee', 2)
    store.actions.sync('#101010', '#eeeeee', 3)
    expect(store.getSnapshot().fontColorLight).toBe('#0f1115')
    expect(store.getSnapshot().fontColorDark).toBe('#f9fafb')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
