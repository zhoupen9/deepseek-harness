import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { readThemeSourceHint, startupThemeMarkup, themeBackground, writeThemeSourceHint } from '../src/startup-appearance.ts'

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-theme-'))
  onTestFinished(() => { rmSync(userData, { recursive: true, force: true }) })
  return { userData, path: join(userData, 'desktop', 'theme.json') }
}

it('defaults to system without a stored source', () => {
  const { userData } = fixture()
  expect(readThemeSourceHint(userData)).toBe('system')
  expect(console.warn).not.toHaveBeenCalled()
})

it.each(['light', 'dark', 'system'] as const)('stores and reads the %s source', (source) => {
  const { userData, path } = fixture()
  writeThemeSourceHint(userData, source)
  expect(readThemeSourceHint(userData)).toBe(source)
  expect(readFileSync(path, 'utf8')).toBe(`{\n  "themeSource": "${source}"\n}\n`)
})

it.each([
  '', '{', 'null', '[]', '{}', '{"themeSource":null}', '{"themeSource":"dim"}', '{"themeSource":1}',
])('reports the invalid hint and falls back to system: %s', (raw) => {
  const { userData, path } = fixture()
  mkdirSync(join(userData, 'desktop'))
  writeFileSync(path, raw)
  expect(readThemeSourceHint(userData)).toBe('system')
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('keeps running when the hint cannot be stored', () => {
  const { userData } = fixture()
  // A file where the directory belongs makes the temporary write fail without touching the app.
  writeFileSync(join(userData, 'desktop'), 'not a directory')
  expect(() => { writeThemeSourceHint(userData, 'dark') }).not.toThrow()
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not store dark'), expect.any(Error))
  expect(readThemeSourceHint(userData)).toBe('system')
})

it.each([
  [true, '#151517'],
  [false, '#fff'],
] as const)('resolves the loading canvas for dark=%s', (dark, background) => {
  expect(themeBackground(dark)).toBe(background)
})

it('colors the packaged index light without media queries', () => {
  const markup = startupThemeMarkup('light')
  expect(markup.head).toContain(':root{color-scheme:light}')
  expect(markup.head).toContain('--dsh-boot-bg:#fff')
  expect(markup.head).not.toContain('prefers-color-scheme')
  expect(markup.body).toContain('document.documentElement.dataset.dsThemeSource = "light"')
  expect(markup.body).toContain("toggleAttribute('data-ds-dark-theme', false)")
})

it('colors the packaged index dark without media queries', () => {
  const markup = startupThemeMarkup('dark')
  expect(markup.head).toContain(':root{color-scheme:dark}')
  expect(markup.head).toContain('--dsh-boot-bg:#151517')
  expect(markup.head).not.toContain('prefers-color-scheme')
  expect(markup.body).toContain('document.documentElement.dataset.dsThemeSource = "dark"')
  expect(markup.body).toContain("toggleAttribute('data-ds-dark-theme', true)")
})

it('follows the operating system for a system source', () => {
  const markup = startupThemeMarkup('system')
  expect(markup.head).toContain('@media(prefers-color-scheme:dark)')
  expect(markup.head).toContain('--dsh-boot-bg:#151517')
  expect(markup.body).toContain('matchMedia(\'(prefers-color-scheme: dark)\').matches')
  expect(markup.body).toContain('document.documentElement.dataset.dsThemeSource = "system"')
})
