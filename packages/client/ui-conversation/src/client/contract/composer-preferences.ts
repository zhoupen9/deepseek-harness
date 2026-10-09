/** Composer statistics preference contract, owned by the Chat settings namespace. */

/** Composer statistics display modes; `hidden` renders no statistics below the composer. */
export const PERFORMANCE_MODES = ['compact', 'detailed', 'hidden'] as const

/** How much composer-level performance and usage information to show. */
export type PerformanceMode = typeof PERFORMANCE_MODES[number]

/** Settings section that carries the preference, as this package reads it. */
export interface ChatPreferenceSettings {
  performanceUsage?: PerformanceMode
}
