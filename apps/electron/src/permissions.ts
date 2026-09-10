/**
 * Permission requests from the Web UI that the Electron shell grants.
 *
 * Installing a request handler replaces Electron's grant-all default: every
 * permission this module does not name is denied. The set stays explicit, so a
 * new Web UI capability names its permission here instead of relying on that
 * default.
 * @module @deepseek-ai/dsh-electron/permissions
 */

/**
 * Permission names the Web UI needs, and only those: `local-fonts` backs the
 * Settings font pickers, and `clipboard-sanitized-write` backs every copy
 * control (`navigator.clipboard.writeText` is a sanitized write). Electron's
 * bundled types predate `local-fonts`, so the set holds the raw names the
 * runtime sends rather than the typed union.
 */
const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set([
  'local-fonts',
  'clipboard-sanitized-write',
])

/**
 * Decide one permission request from the shell's own pages.
 * @param permission - the permission name Electron passes to the request handler.
 * @returns true only for a permission this shell needs; every other request is denied.
 */
export function permissionGranted(permission: string): boolean {
  return GRANTED_PERMISSIONS.has(permission)
}
