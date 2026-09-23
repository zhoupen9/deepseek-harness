/** Resource ownership for one Desktop installation layout. */

import { basename, dirname } from 'node:path'

/** Resource location of the running Desktop installation. */
export interface DesktopResourceLayout {
  /** True when the application runs from an assembled payload instead of a source checkout. */
  readonly assembled: boolean
  /** Directory holding this application's runtime, icons, update metadata, and Harness payload. */
  readonly root: string
}

/**
 * Locate the resource directory of this application.
 *
 * electron-builder packs the application as `<resources>/app.asar`, and a distribution Electron
 * launched with that file reports the same application path. `process.resourcesPath` cannot
 * locate the payload under a distribution Electron because it then names that Electron's own
 * resources directory; a source checkout runs the application directory, which owns the
 * development resources directly.
 * @param appPath - `app.getAppPath()` of the running application.
 * @returns Payload flag and resource directory for this installation.
 */
export function desktopResourceLayout(appPath: string): DesktopResourceLayout {
  const assembled = basename(appPath) === 'app.asar'
  return { assembled, root: assembled ? dirname(appPath) : appPath }
}
