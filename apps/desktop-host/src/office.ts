/** Desktop Office skills and bundled authoring dependencies. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'

/** Loader identity for the application-owned Office composition. */
export const name = 'desktop-office'
/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled payload directory. Missing sibling `office-skills` resources fail Host startup. */
  readonly source: string
  /** Harness-home directory where workspace dependencies are installed. */
  readonly root: string
}

/**
 * Enable offline Office authoring and structural checks in the Desktop profile.
 * @param ctx - Profile scope; child plugins declare their own service requirements.
 * @param config - Bundled payload source and Harness-home installation root.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config)
  // The payload sits beside the application archive, so the resolved manifest is already physical.
  const packageRoot = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json')))
  // A system-runtime payload declares absolute interpreters in `external` instead of a bundled tree.
  const manifest = await workspaceDependencies.readPrimaryRuntime(config.source)
  const node = workspaceDependencies.workspaceDependencyPaths(config.source, manifest).node
  if (node === undefined) throw new Error('desktop-office: the primary runtime declares no Node.js executable')
  await ctx.plugin(officeSkills, {
    assetRoot: join(dirname(config.source), 'office-skills'),
    node,
    cli: join(packageRoot, 'lib', 'cli.js'),
  })
}
