/**
 * Injected frameless-window chrome for the Electron shell.
 *
 * main.ts opens the window with `frame: false`, so there is no OS title bar.
 * This module floats a small minimize / maximize / close button group over the
 * top-right of the Web UI — no dedicated title bar and no reserved space, so
 * the controls ride on top of whatever page is showing. The container is also
 * a thin transparent drag region so the frameless window stays movable. It is
 * a pure DOM module: the preload supplies the window-control operations through
 * the {@link WindowChrome} seam, so it imports nothing from Electron and is
 * testable under jsdom.
 * @module @deepseek-ai/dsh-electron/window-chrome
 */

/** One window-control command a button can issue. */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

/** Window-control operations the buttons drive; supplied by the preload. */
export interface WindowChrome {
  /** Issue a window-control command. */
  send(action: WindowAction): void
  /** Subscribe to maximize-state changes (true once maximized). */
  onMaximized(listener: (maximized: boolean) => void): void
  /** Read the current maximize state. */
  isMaximized(): Promise<boolean>
}

/** Height of the floating control cluster and its transparent drag region. */
const TITLEBAR_HEIGHT = 28

/** Inline SVG glyphs, stroked in `currentColor` so they follow the app theme. */
const MINIMIZE_GLYPH = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0 5.5h10" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const MAXIMIZE_GLYPH = '<svg data-glyph="maximize" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const RESTORE_GLYPH = '<svg data-glyph="restore" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const CLOSE_GLYPH = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" fill="none" stroke="currentColor" stroke-width="1"/></svg>'

/** Styles for the injected floating controls; theme tokens come from the app with fallbacks. */
const TITLEBAR_CSS = `
#dsh-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${TITLEBAR_HEIGHT}px;
  z-index: 2147483000;
  display: flex;
  align-items: stretch;
  -webkit-app-region: drag;
  -webkit-user-select: none;
  user-select: none;
  color: var(--dsw-alias-label-primary, #0f1115);
}

.dsh-window-controls {
  display: flex;
  align-items: stretch;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.dsh-wc {
  width: 46px;
  height: 100%;
  padding: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: inherit;
  cursor: default;
  -webkit-app-region: no-drag;
}

.dsh-wc:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
}

.dsh-wc[data-action='close']:hover {
  background: #e81123;
  color: #fff;
}

.dsh-wc:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: -2px;
}
`

/** Build one window-control button; `id` names the role, `action` the command it sends. */
function makeButton(
  chrome: WindowChrome,
  id: 'minimize' | 'maximize' | 'close',
  action: WindowAction,
  label: string,
  innerHtml: string,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dsh-wc'
  button.dataset.action = id
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML = innerHtml
  button.addEventListener('click', () => { chrome.send(action) })
  return button
}

/** Show or hide one maximize-button glyph via its inline display. */
function setGlyphDisplay(glyph: Element | null, display: 'none' | 'block'): void {
  glyph?.setAttribute('style', `display: ${display}`)
}

/** Swap the maximize button between its maximize and restore faces. */
function setMaximized(button: HTMLButtonElement, maximized: boolean): void {
  setGlyphDisplay(button.querySelector('[data-glyph="maximize"]'), maximized ? 'none' : 'block')
  setGlyphDisplay(button.querySelector('[data-glyph="restore"]'), maximized ? 'block' : 'none')
  button.dataset.maximized = maximized ? 'true' : 'false'
  const label = maximized ? 'Restore' : 'Maximize'
  button.setAttribute('aria-label', label)
  button.title = label
}

/** Inject the floating window controls into the document body. */
function mount(chrome: WindowChrome): void {
  if (document.getElementById('dsh-titlebar') !== null) return

  const style = document.createElement('style')
  style.textContent = TITLEBAR_CSS
  document.head.appendChild(style)

  const controls = document.createElement('div')
  controls.className = 'dsh-window-controls'

  const minimize = makeButton(chrome, 'minimize', 'minimize', 'Minimize', MINIMIZE_GLYPH)
  const maximize = makeButton(chrome, 'maximize', 'toggle-maximize', 'Maximize', MAXIMIZE_GLYPH + RESTORE_GLYPH)
  const close = makeButton(chrome, 'close', 'close', 'Close', CLOSE_GLYPH)
  setMaximized(maximize, false)

  controls.append(minimize, maximize, close)

  const bar = document.createElement('div')
  bar.id = 'dsh-titlebar'
  bar.appendChild(controls)
  document.body.appendChild(bar)

  // Double-clicking the strip toggles maximize, mirroring the native title bar;
  // a double-click on a control is that control's action, not a toggle.
  bar.addEventListener('dblclick', (event) => {
    if (!(event.target instanceof Element) || event.target.closest('.dsh-wc') !== null) return
    chrome.send('toggle-maximize')
  })

  chrome.onMaximized((maximized) => { setMaximized(maximize, maximized) })
  void chrome.isMaximized().then((maximized) => { setMaximized(maximize, maximized) })
}

/**
 * Inject the floating window controls once the document body exists, keeping
 * the maximize glyph in sync with the window state.
 * @param chrome - the window-control operations the buttons drive.
 */
export function installWindowChrome(chrome: WindowChrome): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mount(chrome) }, { once: true })
  } else {
    mount(chrome)
  }
}
