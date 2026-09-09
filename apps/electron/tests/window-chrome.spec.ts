// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { installWindowChrome } from '../src/window-chrome.ts'

function titlebar(): HTMLElement {
  const el = document.getElementById('dsh-titlebar')
  if (el === null) throw new Error('drag strip was not injected')
  return el
}

function segments(): HTMLElement[] {
  return Array.from(titlebar().querySelectorAll('.dsh-drag-segment'))
}

function stylesheet(): string {
  return document.querySelector('style')?.textContent ?? ''
}

/** Give each segment a distinct synthetic box so probe x-coordinates differ. */
function mockSegmentRects(els: Element[], width = 20): void {
  els.forEach((el, i) => {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: i * width,
      right: (i + 1) * width,
      top: 0,
      bottom: 28,
      width,
      height: 28,
      x: i * width,
      y: 0,
      toJSON: () => ({}),
    })
  })
}

/** Queue rAF callbacks so scheduled refreshes run at a controlled point. */
const rafQueue: FrameRequestCallback[] = []
function flushRaf(): void {
  const pending = rafQueue.splice(0)
  for (const cb of pending) cb(0)
}

let elementFromPoint: Mock<(x: number, y: number) => Element | null>

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  rafQueue.length = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  // jsdom does not implement elementFromPoint; supply it so the strip's
  // controller can probe. Returning body is neither the window chrome nor an
  // interactive control, so segments stay draggable unless a test overrides
  // the stub with real page content.
  elementFromPoint = vi.fn(() => document.body)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPoint,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('installWindowChrome', () => {
  it('injects a transparent drag strip below content and no window controls', () => {
    installWindowChrome()
    const css = stylesheet()
    // No reserved band and no dedicated title bar: the strip rule itself
    // paints nothing (transparent).
    expect(css).not.toContain('padding-top')
    expect(css).not.toContain('--dsh-titlebar-height')
    const stripRule = css.slice(css.indexOf('#dsh-titlebar'), css.indexOf('.dsh-drag-segment'))
    expect(stripRule).not.toContain('background')
    // The drag strip is prepended below the app at the root stacking context,
    // and it is the only element the chrome injects.
    expect(document.body.children).toHaveLength(1)
    expect(document.body.firstElementChild).toBe(titlebar())
    expect(css).toContain('z-index: 0')
    expect(document.getElementById('dsh-window-controls')).toBeNull()
  })

  it('fills the strip with drag segments that flip to no-drag when covered', () => {
    installWindowChrome()
    expect(segments().length).toBeGreaterThan(0)
    const css = stylesheet()
    expect(css).toContain('.dsh-drag-segment')
    expect(css).toContain('-webkit-app-region: drag')
    expect(css).toContain('.dsh-drag-segment.covered')
    expect(css).toContain('-webkit-app-region: no-drag')
  })

  it('keeps segments draggable over the strip and inert page content', () => {
    installWindowChrome()
    flushRaf()
    const segs = segments()
    mockSegmentRects(segs)
    const inert = document.createElement('div')
    document.body.appendChild(inert)
    elementFromPoint.mockImplementation(() => inert)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs.every(seg => !seg.classList.contains('covered'))).toBe(true)

    // The strip itself is chrome, not content.
    elementFromPoint.mockImplementation(() => titlebar())
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs.every(seg => !seg.classList.contains('covered'))).toBe(true)
  })

  it('flips a segment to no-drag when an interactive control covers it, and back when it does not', () => {
    installWindowChrome()
    flushRaf()
    const segs = segments()
    mockSegmentRects(segs)
    const inert = document.createElement('div')
    const control = document.createElement('button')
    document.body.appendChild(inert)
    document.body.appendChild(control)
    elementFromPoint.mockImplementation((x: number) => {
      const idx = Math.floor(x / 20)
      if (idx === 1) return control
      return inert
    })

    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs[1].classList.contains('covered')).toBe(true)
    expect(segs[0].classList.contains('covered')).toBe(false)
    expect(segs[2].classList.contains('covered')).toBe(false)

    elementFromPoint.mockImplementation(() => inert)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs[1].classList.contains('covered')).toBe(false)
  })

  it('treats a descendant of an interactive control as covered', () => {
    installWindowChrome()
    flushRaf()
    const segs = segments()
    mockSegmentRects(segs)
    const label = document.createElement('span')
    const control = document.createElement('button')
    control.appendChild(label)
    document.body.appendChild(control)
    elementFromPoint.mockImplementation((x: number) => {
      const idx = Math.floor(x / 20)
      if (idx === 0) return label
      return document.body
    })
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs[0].classList.contains('covered')).toBe(true)
  })

  it('refreshes on pointer moves near the strip but not far below it', () => {
    installWindowChrome()
    flushRaf()
    elementFromPoint.mockClear()
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 200 }))
    flushRaf()
    expect(elementFromPoint).not.toHaveBeenCalled()

    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(elementFromPoint).toHaveBeenCalled()
  })

  it('refreshes on scroll, resize, and pointer down', () => {
    installWindowChrome()
    flushRaf()
    elementFromPoint.mockClear()
    window.dispatchEvent(new Event('scroll'))
    flushRaf()
    expect(elementFromPoint).toHaveBeenCalled()

    elementFromPoint.mockClear()
    window.dispatchEvent(new Event('resize'))
    flushRaf()
    expect(elementFromPoint).toHaveBeenCalled()

    elementFromPoint.mockClear()
    window.dispatchEvent(new MouseEvent('pointerdown'))
    expect(elementFromPoint).toHaveBeenCalled()
  })
})
