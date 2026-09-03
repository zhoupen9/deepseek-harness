/** Appearance and font-size row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontColorRowStore, createFontFaceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'

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

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
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

describe('createFontFaceRowStore', () => {
  it('init shape: empty family, empty catalogue, loading, revision -1', () => {
    expect(createFontFaceRowStore().create().getSnapshot()).toEqual({ font: '', families: [], loading: true, revision: -1 })
  })

  it('sync mirrors the family; the revision guard drops stale and duplicate writes', () => {
    const store = createFontFaceRowStore().create()
    store.actions.sync('Georgia', 3)
    expect(store.getSnapshot().font).toBe('Georgia')
    store.actions.sync('Arial', 2)
    store.actions.sync('Arial', 3)
    expect(store.getSnapshot().font).toBe('Georgia')
    expect(store.getSnapshot().revision).toBe(3)
  })

  it('setFamilies replaces the catalogue and clears loading', () => {
    const store = createFontFaceRowStore().create()
    store.actions.setFamilies(['Arial', 'Georgia'], false)
    expect(store.getSnapshot().families).toEqual(['Arial', 'Georgia'])
    expect(store.getSnapshot().loading).toBe(false)
  })
})
