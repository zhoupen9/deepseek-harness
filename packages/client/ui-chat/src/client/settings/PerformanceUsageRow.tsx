/** General Settings row for performance and usage detail. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PerformanceUsageMode } from '../../chat-settings.ts'
import type { PerformanceUsageInjected } from '../contract/slots.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side performance and usage preference face. */
export interface PerformanceUsageRowInjected extends PerformanceUsageInjected {
  /** Change the performance and usage detail. */
  setPerformanceUsage: (mode: PerformanceUsageMode) => void
}

/** Full Settings-row props. */
export type PerformanceUsageRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<PerformanceUsageRowInjected>

const OPTIONS = [
  { id: 'compact', label: 'settings.performance.compact' },
  { id: 'detailed', label: 'settings.performance.detailed' },
  { id: 'hidden', label: 'settings.performance.hidden' },
] as const satisfies readonly { id: PerformanceUsageMode; label: ChatKey }[]

/** Menu-order label of one mode; the closed union keeps the selection total. */
function labelOf(mode: PerformanceUsageMode): ChatKey {
  switch (mode) {
    case 'compact': return 'settings.performance.compact'
    case 'detailed': return 'settings.performance.detailed'
    case 'hidden': return 'settings.performance.hidden'
  }
}

/**
 * Render the performance and usage detail selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function PerformanceUsageRow({ usePerformanceUsage, setPerformanceUsage, t }: PerformanceUsageRowProps) {
  const mode = usePerformanceUsage(value => value)
  return (
    <PreferenceRow
      title={t('settings.performance.title')}
      description={t('settings.performance.description')}
      value={mode}
      selectedLabel={t(labelOf(mode))}
      options={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
      onSelect={(value) => { setPerformanceUsage(value as PerformanceUsageMode) }}
    />
  )
}
