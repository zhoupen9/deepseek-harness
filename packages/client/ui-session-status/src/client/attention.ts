/**
 * Dispatch one browser attention event for a Desktop shell. The Electron preload exposes
 * `window.dshNotify`; a regular browser or a node test has no bridge, so this is a no-op there.
 * @param kind - stable attention discriminator (for example `approval` or `turn-complete`).
 */
export function dispatchAttention(kind: string): void {
  if (typeof window === 'undefined') return
  const bridge = (window as unknown as { dshNotify?: (kind: string) => void }).dshNotify
  if (typeof bridge !== 'function') return
  bridge(kind)
}
