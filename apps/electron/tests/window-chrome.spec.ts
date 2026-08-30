// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  if (el === null) throw new Error('title bar was not injected')
  return el
}

function button(id: 'minimize' | 'maximize' | 'close'): HTMLButtonElement {
  const el = titlebar().querySelector(`[data-action='${id}']`)
  if (el === null) throw new Error('missing title bar button: ' + id)
  return el as HTMLButtonElement
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('installWindowChrome', () => {
  it('injects a title bar with minimize, maximize, and close in order', () => {
    installWindowChrome(makeChrome().chrome)
    const actions = Array.from(titlebar().querySelectorAll('.dsh-wc')).map(el => el.getAttribute('data-action'))
    expect(actions).toEqual(['minimize', 'maximize', 'close'])
  })

  it('floats the controls over the content without reserving body space', () => {
    installWindowChrome(makeChrome().chrome)
    const css = document.querySelector('style')?.textContent ?? ''
    expect(css).toContain('position: fixed')
    expect(css).not.toContain('padding-top')
    expect(css).toContain('-webkit-app-region: drag')
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
