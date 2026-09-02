/**
 * Injected frameless-window chrome for the Electron shell.
 *
 * main.ts opens the window with `frame: false`, so there is no OS title bar.
 * This module keeps the original layout: no reserved space — a transparent
 * drag strip at the very top and a floating minimize / maximize / close button
 * group at the top-right, riding on top of whatever page is showing. The drag
 * strip sits BELOW page content in z-order, so the page never has a dead band
 * at the top: interactive controls that overlap the strip (buttons, links,
 * inputs, tabs, menu items) receive the interaction, and the window is
 * draggable only over the inert parts of the top strip (header padding,
 * background, empty areas).
 *
 * Electron's `-webkit-app-region` drag regions are geometric rectangles, not
 * z-order aware: a drag rect blocks clicks on anything beneath it regardless
 * of stacking. The strip is therefore split into drag segments and a
 * controller re-evaluates each segment with `document.elementFromPoint`,
 * flipping a segment to `no-drag` when an interactive control is the topmost
 * element over it, so that control's area is carved out of the drag mask.
 *
 * It is a pure DOM module: the preload supplies the window-control operations
 * through the {@link WindowChrome} seam, so it imports nothing from Electron
 * and is testable under jsdom.
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

/** Height of the drag strip and of the floating control cluster. */
const TITLEBAR_HEIGHT = 28
/** Target width of one drag segment; segments flex to share the strip. */
const SEGMENT_TARGET_WIDTH = 16
/** Vertical slack below the strip, in px, that still counts as near it for pointer-move refreshes. */
const POINTER_SLACK = 64
/** Probe offset from the strip's top and bottom edges, in px. */
const PROBE_INSET = 2

/**
 * Controls that must win over the drag strip when the strip overlaps them.
 * The controller walks up from the topmost element at a probe point; a match
 * means the point is interactive page content and the segment under it must
 * yield (no-drag). Everything else — the app's background shell, header
 * padding, plain text — is inert, so the strip stays draggable there.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="option"]',
  '[role="textbox"]',
  '[role="searchbox"]',
].join(', ')

/** Inline SVG glyphs, stroked in `currentColor` so they follow the app theme. */
const MINIMIZE_GLYPH = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0 5.5h10" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const MAXIMIZE_GLYPH = '<svg data-glyph="maximize" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const RESTORE_GLYPH = '<svg data-glyph="restore" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
const CLOSE_GLYPH = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" fill="none" stroke="currentColor" stroke-width="1"/></svg>'

/** Styles for the injected chrome; theme tokens come from the app with fallbacks. */
const TITLEBAR_CSS = `
/* The drag strip lives below page content (prepended to <body> at the root
   stacking context, z-index 0), so the page is never blocked at the top. It
   stays transparent: there is no dedicated title bar and no reserved space. */
#dsh-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${TITLEBAR_HEIGHT}px;
  z-index: 0;
  display: flex;
  align-items: stretch;
  -webkit-user-select: none;
  user-select: none;
}

/* Drag segments fill the strip and are draggable by default; the controller
   marks a covered segment (interactive page content on top), flipping it to
   no-drag. Electron's drag mask is the union of drag rects minus no-drag rects
   (z-order-blind), so only an explicit no-drag rect carves the covered point
   out of the mask. */
.dsh-drag-segment {
  flex: 1 1 0;
  height: 100%;
  -webkit-app-region: drag;
}

.dsh-drag-segment.covered {
  -webkit-app-region: no-drag;
}

/* The window controls float above the page at the top-right, exactly like a
   native button group, and stay no-drag so their clicks reach the buttons. */
#dsh-window-controls {
  position: fixed;
  top: 0;
  right: 0;
  height: ${TITLEBAR_HEIGHT}px;
  z-index: 2147483000;
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
  -webkit-user-select: none;
  user-select: none;
  color: var(--dsw-alias-label-primary, #0f1115);
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

/**
 * Keep the drag strip's mask in sync with what is on top of it. Electron's
 * app-region drag regions are geometric rectangles (union of drag rects minus
 * no-drag rects, z-order-blind), so a segment must flip to no-drag to carve a
 * covered control out of the mask. Each segment probes its corners with
 * `document.elementFromPoint`: a probe whose topmost element is the window
 * chrome (the strip itself or the floating controls) or inert page content
 * keeps the segment draggable; a probe whose topmost element is an interactive
 * control marks the segment covered.
 */
class DragRegionController {
  private readonly chrome: readonly HTMLElement[]
  private readonly segments: readonly HTMLElement[]
  private frame: number | null = null

  constructor(chrome: readonly HTMLElement[], segments: readonly HTMLElement[]) {
    this.chrome = chrome
    this.segments = segments
  }

  /** Schedule one refresh on the next animation frame, coalescing bursts. */
  schedule(): void {
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.refresh()
    })
  }

  /** Re-evaluate every segment against the topmost element at its corners. */
  refresh(): void {
    for (const segment of this.segments) {
      const rect = segment.getBoundingClientRect()
      const covered =
        this.coveredAt(rect.left + PROBE_INSET, PROBE_INSET) ||
        this.coveredAt(rect.right - PROBE_INSET, PROBE_INSET) ||
        this.coveredAt(rect.left + PROBE_INSET, rect.bottom - PROBE_INSET) ||
        this.coveredAt(rect.right - PROBE_INSET, rect.bottom - PROBE_INSET)
      segment.classList.toggle('covered', covered)
    }
  }

  /** Whether an interactive control is the topmost element at (x, y). */
  private coveredAt(x: number, y: number): boolean {
    const element = document.elementFromPoint(x, y)
    if (element === null) return false
    if (this.chrome.some(root => root.contains(element))) return false
    return element.closest(INTERACTIVE_SELECTOR) !== null
  }
}

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

/** Inject the window chrome: the drag strip below content, the floating controls, and the controller. */
function mount(chrome: WindowChrome): void {
  if (document.getElementById('dsh-titlebar') !== null) return

  const style = document.createElement('style')
  style.textContent = TITLEBAR_CSS
  document.head.appendChild(style)

  const controls = document.createElement('div')
  controls.id = 'dsh-window-controls'

  const minimize = makeButton(chrome, 'minimize', 'minimize', 'Minimize', MINIMIZE_GLYPH)
  const maximize = makeButton(chrome, 'maximize', 'toggle-maximize', 'Maximize', MAXIMIZE_GLYPH + RESTORE_GLYPH)
  const close = makeButton(chrome, 'close', 'close', 'Close', CLOSE_GLYPH)
  setMaximized(maximize, false)

  controls.append(minimize, maximize, close)

  // Drag segments fill the strip; the count follows the window width and flex
  // distributes the space, so a resize never rebuilds.
  const bar = document.createElement('div')
  bar.id = 'dsh-titlebar'
  const segmentCount = Math.max(1, Math.ceil(window.innerWidth / SEGMENT_TARGET_WIDTH))
  const segments: HTMLDivElement[] = []
  for (let i = 0; i < segmentCount; i++) {
    const segment = document.createElement('div')
    segment.className = 'dsh-drag-segment'
    segments.push(segment)
    bar.appendChild(segment)
  }

  // The strip is prepended so it paints below #root (the app): both are in the
  // root stacking context, and earlier DOM order wins at equal z-index. The
  // controls are appended on top, mirroring the floating look of a native
  // button group.
  document.body.prepend(bar)
  document.body.appendChild(controls)

  // Double-clicking the strip toggles maximize, mirroring the native title bar.
  // The strip is below content, so only a point where nothing interactive sits
  // on top reaches it — content handles its own double-clicks.
  bar.addEventListener('dblclick', () => { chrome.send('toggle-maximize') })

  const controller = new DragRegionController([bar, controls], segments)
  // The native drag mask updates asynchronously (style recalc -> layout -> IPC),
  // so keep the strip fresh on the events that change what covers it.
  const onPointerMove = (event: PointerEvent): void => {
    if (event.clientY >= TITLEBAR_HEIGHT + POINTER_SLACK) return
    controller.schedule()
  }
  const onScroll = (): void => { controller.schedule() }
  const onResize = (): void => { controller.schedule() }
  // A pointer-down refresh shortens the window in which a click on just-covered
  // content still starts a window drag (the mask is consulted at mouse-down).
  const onPointerDown = (): void => { controller.refresh() }
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('resize', onResize)
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  // First pass once the strip is laid out, and once more after the app loads.
  controller.schedule()
  window.addEventListener('load', () => { controller.schedule() }, { once: true })

  chrome.onMaximized((maximized) => { setMaximized(maximize, maximized) })
  void chrome.isMaximized().then((maximized) => { setMaximized(maximize, maximized) })
}

/**
 * Inject the window chrome once the document body exists, keeping the maximize
 * glyph in sync with the window state and the drag mask in sync with what
 * covers the strip.
 * @param chrome - the window-control operations the buttons drive.
 */
export function installWindowChrome(chrome: WindowChrome): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mount(chrome) }, { once: true })
  } else {
    mount(chrome)
  }
}
