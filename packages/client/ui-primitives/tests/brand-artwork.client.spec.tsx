// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  BRAND_NAME_BADGE, BRAND_NAME_GLYPH_FILL, BRAND_NAME_GLYPH_PATHS, BRAND_NAME_LETTER_PATHS,
  BRAND_NAME_MARKUP, BRAND_NAME_VIEWBOX, BrandWordmark, FishLogo, FISH_LOGO_MARKUP, FISH_LOGO_PATH,
  FISH_LOGO_VIEWBOX,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Parse one serialized mark into its svg element. */
function parse(markup: string): SVGElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  const svg = host.querySelector('svg')
  if (svg === null) throw new Error('expected one svg in the serialized mark')
  return svg
}

/** Draw order of a mark's paths, each as its geometry and fill. */
function pathDraw(svg: SVGElement): (string | null)[][] {
  return [...svg.querySelectorAll('path')].map(path => [path.getAttribute('d'), path.getAttribute('fill')])
}

/** Geometry of the pill the name artwork draws, excluding clip rects. */
function pillDraw(svg: SVGElement): (string | null)[] {
  const pill = svg.querySelector(':scope > rect')
  if (pill === null) throw new Error('expected the pill beside the letterforms')
  return ['x', 'y', 'width', 'height', 'rx', 'fill'].map(name => pill.getAttribute(name))
}

describe('brand artwork', () => {
  it('serializes the whale exactly as the React mark draws it', () => {
    const serialized = parse(FISH_LOGO_MARKUP)
    const rendered = parse(renderToStaticMarkup(createElement(FishLogo)))

    expect(serialized.getAttribute('viewBox')).toBe(`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`)
    expect(serialized.getAttribute('viewBox')).toBe(rendered.getAttribute('viewBox'))
    expect(pathDraw(serialized)).toEqual(pathDraw(rendered))
    expect(pathDraw(serialized)).toEqual([[FISH_LOGO_PATH, 'currentColor']])
  })

  it('serializes the name artwork exactly as the React wordmark draws it', () => {
    const serialized = parse(BRAND_NAME_MARKUP)
    const rendered = parse(renderToStaticMarkup(createElement(BrandWordmark, { includeMark: false })))
    const viewBox = `${BRAND_NAME_VIEWBOX.x} ${BRAND_NAME_VIEWBOX.y} ${BRAND_NAME_VIEWBOX.width} ${BRAND_NAME_VIEWBOX.height}`

    expect(serialized.getAttribute('viewBox')).toBe(viewBox)
    expect(serialized.getAttribute('viewBox')).toBe(rendered.getAttribute('viewBox'))
    expect(pathDraw(serialized)).toEqual(pathDraw(rendered))
    expect(pillDraw(serialized)).toEqual(pillDraw(rendered))
  })

  it('draws the letterforms in reading order, then the pill glyphs', () => {
    const paths = pathDraw(parse(BRAND_NAME_MARKUP))

    expect(paths).toEqual([
      ...BRAND_NAME_LETTER_PATHS.map(letter => [letter, 'currentColor']),
      ...BRAND_NAME_GLYPH_PATHS.map(glyph => [glyph, BRAND_NAME_GLYPH_FILL]),
    ])
    expect(pillDraw(parse(BRAND_NAME_MARKUP))).toEqual([
      String(BRAND_NAME_BADGE.x), String(BRAND_NAME_BADGE.y),
      String(BRAND_NAME_BADGE.width), String(BRAND_NAME_BADGE.height),
      String(BRAND_NAME_BADGE.radius), 'currentColor',
    ])
  })

  it('keeps both marks decorative', () => {
    for (const markup of [FISH_LOGO_MARKUP, BRAND_NAME_MARKUP]) {
      expect(parse(markup).getAttribute('aria-hidden')).toBe('true')
      expect(parse(markup).getAttribute('role')).toBeNull()
    }
  })
})
