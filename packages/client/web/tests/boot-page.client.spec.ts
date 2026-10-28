// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('draws the startup skeleton before any boot data arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    const brand = el.querySelector('[data-dsh-boot-brand]')
    const marks = [...(brand?.querySelectorAll('svg') ?? [])].map(svg => svg.getAttribute('viewBox'))
    expect(marks).toEqual(['0 0 23.16 17.04', '26 0 156 24'])
    expect(el.textContent).toContain('DeepSeek Harness')
    expect(el.textContent).toContain('Starting…')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('reports the client plugin phase once boot data settles', () => {
    const { el, page } = mount()
    page.setPhase('loading')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Starting…')
    page.setPhase('starting')
    expect(el.textContent).toContain('Starting…')
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setPhase('loading')
    page.setTotal(2)
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('72deg')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('180deg')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('288deg')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('keeps the brand banner through a failure report and its recovery', () => {
    const { el, page } = mount()
    const brand = el.querySelector('[data-dsh-boot-brand]')
    page.setState('a', 'failed')
    expect(el.querySelector('[data-dsh-boot-brand]')).toBe(brand)
    expect(el.textContent).toContain('DeepSeek Harness')
    page.setState('a', 'active')
    expect(el.querySelector('[data-dsh-boot-brand]')).toBe(brand)
    expect(el.querySelector('[data-dsh-boot-spinner]')).not.toBeNull()
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
