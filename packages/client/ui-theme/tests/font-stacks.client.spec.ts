// @vitest-environment jsdom
/** Font-stack resolution and installed-font loading via the Local Font Access API. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadInstalledFonts, monoFontStack, variantFontStack } from '../src/styles/font-stacks.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('variantFontStack', () => {
  it('returns the built-in default stack for the empty family', () => {
    expect(variantFontStack('')).toContain('-apple-system')
  })

  it('quotes a chosen family and trails the CJK faces and a sans-serif tail', () => {
    const stack = variantFontStack('Georgia')
    expect(stack.startsWith('"Georgia"')).toBe(true)
    expect(stack).toContain("'PingFang SC'")
    expect(stack.endsWith('sans-serif')).toBe(true)
  })
})

describe('monoFontStack', () => {
  it('returns the built-in default stack for the empty family', () => {
    expect(monoFontStack('')).toContain("'SF Mono'")
  })

  it('quotes a chosen family and trails the CJK faces with no generic tail', () => {
    const stack = monoFontStack('JetBrains Mono')
    expect(stack.startsWith('"JetBrains Mono"')).toBe(true)
    expect(stack).toContain("'Microsoft YaHei'")
    expect(stack.endsWith('monospace')).toBe(false)
  })
})

describe('loadInstalledFonts', () => {
  it('resolves to an empty list when the API is absent', async () => {
    vi.stubGlobal('queryLocalFonts', undefined)
    expect(await loadInstalledFonts()).toEqual([])
  })

  it('resolves to an empty list when the API rejects (permission denied)', async () => {
    vi.stubGlobal('queryLocalFonts', vi.fn(async () => { throw new Error('denied') }))
    expect(await loadInstalledFonts()).toEqual([])
  })

  it('deduplicates a family spread across weights and sorts case-insensitively', async () => {
    vi.stubGlobal('queryLocalFonts', vi.fn(async () => [
      { family: 'Arial' },
      { family: 'Georgia' },
      { family: 'Arial' },
    ]))
    expect(await loadInstalledFonts()).toEqual(['Arial', 'Georgia'])
  })
})
