// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { installWindowChrome, type WindowChrome } from '../src/window-chrome.ts'

function makeChrome() {
  const send = vi.fn<(action: Parameters<WindowChrome['send']>[0]) => void>()
  const isMaximized = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
  const maximizedListeners: Array<(maximized: boolean) => void> = []
  const chrome: WindowChrome = {
    send,
    isMaximized,
    onMaximized: (listener) => { maximizedListeners.push(listener) },
  }
  return { chrome, send, isMaximized, maximizedListeners }
}

function titlebar(): HTMLElement {
  const el = document.getElementById('dsh-titlebar')
  if (el === null) throw new Error('drag strip was not injected')
  return el
}

function controls(): HTMLElement {
  const el = document.getElementById('dsh-window-controls')
  if (el === null) throw new Error('window controls were not injected')
  return el
}

function button(id: 'minimize' | 'maximize' | 'close'): HTMLButtonElement {
  const el = controls().querySelector(`[data-action='${id}']`)
  if (el === null) throw new Error('missing window control button: ' + id)
  return el as HTMLButtonElement
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
  it('keeps the original floating layout: transparent strip below content, controls on top', () => {
    installWindowChrome(makeChrome().chrome)
    const css = stylesheet()
    // No reserved band and no dedicated title bar: the strip rule itself
    // paints nothing (transparent), unlike the button hover states.
    expect(css).not.toContain('padding-top')
    expect(css).not.toContain('--dsh-titlebar-height')
    const stripRule = css.slice(css.indexOf('#dsh-titlebar'), css.indexOf('.dsh-drag-segment'))
    expect(stripRule).not.toContain('background')
    // The drag strip is prepended below the app at the root stacking context.
    expect(document.body.firstElementChild).toBe(titlebar())
    expect(css).toContain('z-index: 0')
    // The floating controls ride on top at the top-right, like before.
    expect(document.body.lastElementChild).toBe(controls())
    expect(css).toContain('z-index: 2147483000')
  })

  it('fills the strip with drag segments and floats minimize, maximize, and close in order', () => {
    installWindowChrome(makeChrome().chrome)
    const actions = Array.from(controls().querySelectorAll('.dsh-wc')).map(el => el.getAttribute('data-action'))
    expect(actions).toEqual(['minimize', 'maximize', 'close'])
    expect(segments().length).toBeGreaterThan(0)
    const css = stylesheet()
    expect(css).toContain('.dsh-drag-segment')
    expect(css).toContain('-webkit-app-region: drag')
    expect(css).toContain('.dsh-drag-segment.covered')
    expect(css).toContain('-webkit-app-region: no-drag')
  })

  it('labels each control for assistive tech and tooltips', () => {
    installWindowChrome(makeChrome().chrome)
    expect(button('minimize').getAttribute('aria-label')).toBe('Minimize')
    expect(button('maximize').getAttribute('aria-label')).toBe('Maximize')
    expect(button('close').getAttribute('aria-label')).toBe('Close')
  })

  it('routes each button click to its window command', () => {
    const { chrome, send } = makeChrome()
    installWindowChrome(chrome)
    button('minimize').click()
    button('maximize').click()
    button('close').click()
    expect(send).toHaveBeenNthCalledWith(1, 'minimize')
    expect(send).toHaveBeenNthCalledWith(2, 'toggle-maximize')
    expect(send).toHaveBeenNthCalledWith(3, 'close')
  })

  it('keeps segments draggable over the window chrome and inert page content', () => {
    installWindowChrome(makeChrome().chrome)
    flushRaf()
    const segs = segments()
    mockSegmentRects(segs)
    const inert = document.createElement('div')
    document.body.appendChild(inert)
    elementFromPoint.mockImplementation(() => inert)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs.every(seg => !seg.classList.contains('covered'))).toBe(true)

    // The strip itself and the floating controls are chrome, not content.
    elementFromPoint.mockImplementation(() => titlebar())
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs.every(seg => !seg.classList.contains('covered'))).toBe(true)

    elementFromPoint.mockImplementation(() => button('close'))
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }))
    flushRaf()
    expect(segs.every(seg => !seg.classList.contains('covered'))).toBe(true)
  })

  it('flips a segment to no-drag when an interactive control covers it, and back when it does not', () => {
    installWindowChrome(makeChrome().chrome)
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
    installWindowChrome(makeChrome().chrome)
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
    installWindowChrome(makeChrome().chrome)
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
    installWindowChrome(makeChrome().chrome)
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

  it('toggles maximize on a strip double-click, but not on a control', () => {
    const { chrome, send } = makeChrome()
    installWindowChrome(chrome)
    titlebar().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(send).toHaveBeenCalledWith('toggle-maximize')

    send.mockClear()
    button('maximize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(send).not.toHaveBeenCalledWith('toggle-maximize')
  })

  it('swaps the maximize glyph and label when the window becomes maximized', () => {
    const { chrome, maximizedListeners } = makeChrome()
    installWindowChrome(chrome)
    const maximize = button('maximize')
    expect(maximize.dataset.maximized).toBe('false')
    expect(maximize.querySelector('[data-glyph="maximize"]')?.getAttribute('style')).toBe('display: block')
    expect(maximize.querySelector('[data-glyph="restore"]')?.getAttribute('style')).toBe('display: none')

    maximizedListeners.forEach((listener) => { listener(true) })

    expect(maximize.dataset.maximized).toBe('true')
    expect(maximize.getAttribute('aria-label')).toBe('Restore')
    expect(maximize.querySelector('[data-glyph="maximize"]')?.getAttribute('style')).toBe('display: none')
    expect(maximize.querySelector('[data-glyph="restore"]')?.getAttribute('style')).toBe('display: block')
  })

  it('applies an already-maximized initial state', async () => {
    const { chrome, isMaximized } = makeChrome()
    isMaximized.mockResolvedValue(true)
    installWindowChrome(chrome)
    await vi.waitFor(() => {
      expect(button('maximize').dataset.maximized).toBe('true')
      expect(button('maximize').getAttribute('aria-label')).toBe('Restore')
    })
  })
})
