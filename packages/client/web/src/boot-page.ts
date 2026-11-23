/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer, so the
 * brand banner is serialized artwork from `ui-primitives` rather than a React
 * mark.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import { BRAND_NAME_MARKUP, FISH_LOGO_MARKUP } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Boot phases the page reports before the UI renderer mounts. */
export type BootPhase = 'starting' | 'loading'

const STARTING_HINT = 'Starting…'
const LOADING_HINT = 'Loading plugins…'

/** Brand name the banner carries as text for assistive technology. */
const BRAND_NAME = 'DeepSeek Harness'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Create a div holding one piece of the build-time brand artwork. */
function artwork(className: string | undefined, markup: string): HTMLDivElement {
  const el = div(className)
  el.innerHTML = markup
  return el
}

/** Create the visually hidden text that names the artwork for assistive technology. */
function srOnly(className: string | undefined, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = className ?? ''
  el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly brand: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.brand = div(css.brand)
    this.brand.dataset.dshBootBrand = ''
    this.brand.append(
      artwork(css.brandMark, FISH_LOGO_MARKUP),
      artwork(css.brandName, BRAND_NAME_MARKUP),
      srOnly(css.srOnly, BRAND_NAME),
    )
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.hint = div(css.hint, STARTING_HINT)
    this.card.append(this.brand, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Switch the hint between carrier startup and client plugin loading.
   * @param phase - Current phase before the UI renderer mounts.
   */
  setPhase(phase: BootPhase): void {
    this.hint.textContent = phase === 'starting' ? STARTING_HINT : LOADING_HINT
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.brand, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.brand, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
