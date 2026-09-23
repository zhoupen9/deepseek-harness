/** Node.js executable that runs the Desktop Host and the dsh runtime it starts. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePrimaryRuntime, workspaceDependencyPaths } from '@deepseek-ai/dsh-tool-workspace-dependencies/primary-runtime'

/** Runtime manifest at the root of the prepared primary runtime. */
const PRIMARY_RUNTIME_MANIFEST = 'runtime.json'

/**
 * Resolve the Node.js executable the prepared payload declares.
 *
 * The Host must run on this Node rather than on Electron's: Electron builds reach the runtime
 * through Node's internals, which the payload's builtin-require addon supports only for the
 * Electron versions it fingerprints, and its native modules are built for the payload's runtime.
 * @param primaryRuntime - Absolute prepared primary runtime directory.
 * @returns the declared Node.js executable, or undefined when the payload declares none.
 */
export function runtimeNode(primaryRuntime: string): string | undefined {
  const manifestPath = join(primaryRuntime, PRIMARY_RUNTIME_MANIFEST)
  // A payload without a prepared primary runtime carries no runtime of its own.
  if (!existsSync(manifestPath)) return undefined
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(manifestPath, 'utf8')))
  return workspaceDependencyPaths(primaryRuntime, manifest).node
}
