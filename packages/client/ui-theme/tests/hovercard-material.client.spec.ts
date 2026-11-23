/**
 * Hover cards are popovers: their surface, ink, and state colors follow the
 * active palette instead of keeping one palette's colors over the other's
 * background. These assertions read the stylesheets on disk, the same way the
 * elevation and menu-material contracts do.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const PLATFORM_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/design-platform.css', import.meta.url)), 'utf8')
const HOVERCARD_CSS = readFileSync(
  fileURLToPath(new URL('../../ui-primitives/src/HoverCard.module.css', import.meta.url)), 'utf8')

/** Last declaration per property for one selector, in the order the browser applies them. */
function paletteTokens(selector: string): Map<string, string> {
  return new Map(parseRules(PLATFORM_CSS)
    .filter(rule => rule.selectors.includes(selector))
    .flatMap(rule => rule.declarations))
}

describe('hover card material', () => {
  it('takes the palette surface and the standard ink and state steps in both palettes', () => {
    for (const palette of ['body', 'body[data-ds-dark-theme]']) {
      const tokens = paletteTokens(palette)
      expect(tokens.get('--dsw-alias-hovercard-bg'), palette).toBe('var(--dsw-alias-bg-layer-2)')
      expect(tokens.get('--dsw-alias-hovercard-label-primary'), palette).toBe('var(--dsw-alias-label-primary)')
      expect(tokens.get('--dsw-alias-hovercard-label-secondary'), palette).toBe('var(--dsw-alias-label-secondary)')
      expect(tokens.get('--dsw-alias-hovercard-label-tertiary'), palette).toBe('var(--dsw-alias-label-tertiary)')
      expect(tokens.get('--dsw-alias-hovercard-state-done'), palette).toBe('var(--dsw-alias-state-done-primary)')
      expect(tokens.get('--dsw-alias-hovercard-state-error'), palette).toBe('var(--dsw-alias-state-error-primary)')
    }
  })

  it('draws the compact card on the shared floating surface and elevation', () => {
    const card = parseRules(HOVERCARD_CSS).find(rule => rule.selectors.includes('.card'))
    expect(card?.declarations).toContainEqual(['background', 'var(--dsw-alias-hovercard-bg)'])
    expect(card?.declarations).toContainEqual(['box-shadow', 'var(--dsw-elevation-prominent)'])
  })
})
