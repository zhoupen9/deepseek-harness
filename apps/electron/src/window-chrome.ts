/**
 * Injected frameless-window chrome for the Electron shell.
 *
 * main.ts opens the window with `frame: false`, so there is no OS title bar
 * and the shell draws no window controls (no minimize / maximize / close
 * buttons; window management rides the OS or window-manager shortcuts). This
 * module keeps the page layout intact: no reserved space — a transparent drag
 * strip at the very top keeps the window movable. The drag strip sits BELOW
 * page content in z-order, so the page never has a dead band at the top:
 * interactive controls that overlap the strip (buttons, links, inputs, tabs,
 * menu items) receive the interaction, and the window is draggable only over
 * the inert parts of the top strip (header padding, background, empty areas).
 *
 * Electron's `-webkit-app-region` drag regions are geometric rectangles, not
 * z-order aware: a drag rect blocks clicks on anything beneath it regardless
 * of stacking. The strip is therefore split into drag segments and a
 * controller re-evaluates each segment with `document.elementFromPoint`,
 * flipping a segment to `no-drag` when an interactive control is the topmost
 * element over it, so that control's area is carved out of the drag mask.
 *
 * It is a pure DOM module: the preload injects it and it imports nothing from
 * Electron, so it is testable under jsdom.
 * @module @deepseek-ai/dsh-electron/window-chrome
 */

/** Height of the drag strip, in px. */
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

/** Styles for the injected drag strip. */
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
`

/**
 * Keep the drag strip's mask in sync with what is on top of it. Electron's
 * app-region drag regions are geometric rectangles (union of drag rects minus
 * no-drag rects, z-order-blind), so a segment must flip to no-drag to carve a
 * covered control out of the mask. Each segment probes its corners with
 * `document.elementFromPoint`: a probe whose topmost element is the strip
 * itself or inert page content keeps the segment draggable; a probe whose
 * topmost element is an interactive control marks the segment covered.
 */
class DragRegionController {
  private readonly strip: HTMLElement
  private readonly segments: readonly HTMLElement[]
  private frame: number | null = null

  constructor(strip: HTMLElement, segments: readonly HTMLElement[]) {
    this.strip = strip
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
    if (this.strip.contains(element)) return false
    return element.closest(INTERACTIVE_SELECTOR) !== null
  }
}

/** Inject the drag strip below content and keep its mask in sync. */
function mount(): void {
  if (document.getElementById('dsh-titlebar') !== null) return

  const style = document.createElement('style')
  style.textContent = TITLEBAR_CSS
  document.head.appendChild(style)

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
  // root stacking context, and earlier DOM order wins at equal z-index.
  document.body.prepend(bar)

  const controller = new DragRegionController(bar, segments)
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
}

/**
 * Inject the drag strip once the document body exists, keeping the drag mask
 * in sync with what covers the strip.
 */
export function installWindowChrome(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mount() }, { once: true })
  } else {
    mount()
  }
}
