/** Model-facing query for a bundled Python, Node.js, and pnpm payload, in place or installed under the Harness home. */

import { cp, lstat, mkdir, mkdtemp, readlink, rename, rm, stat, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parsePrimaryRuntime, readPrimaryRuntime, workspaceDependencyPaths } from './primary-runtime.ts'
import type { ExternalPrimaryRuntime, PrimaryRuntimeManifest, WorkspaceDependencies } from './primary-runtime.ts'

// Consumers that must not load this Cordis plugin, such as the Desktop launcher and the payload
// build scripts, import the payload metadata from `./primary-runtime` instead.
export { parsePrimaryRuntime, readPrimaryRuntime, workspaceDependencyPaths }
export type { ExternalPrimaryRuntime, PrimaryRuntimeManifest, WorkspaceDependencies }

/** Cordis plugin identity. */
export const name = 'tool-workspace-dependencies'
/** Registry the tool registers into. */
export const inject = ['tools']

/** Payload location and optional installation directory. */
export interface Config {
  /** Payload directory carrying `runtime.json` and `dependencies/`. */
  readonly source: string
  /**
   * Installation directory under the Harness home. When set, the payload is copied there on the
   * first call (the Desktop behavior); when omitted, the payload is used in place without copying,
   * which suits read-only carriers such as container image layers.
   */
  readonly root?: string
}

/** Require a named payload source before the Loader activates the tool. */
export const Config: z<Config> = z.object({
  source: z.string().min(1).required(),
  root: z.string().min(1),
})

/**
 * Identify POSIX interpreter aliases that can survive payload relocation.
 * @param root - Payload directory.
 * @param manifest - Validated payload metadata.
 * @returns Relative alias paths mapped to their sibling interpreter filename; regular command files are omitted.
 * @throws When an interpreter alias does not point directly to the versioned regular file.
 */
export async function primaryRuntimePythonAliases(root: string, manifest: PrimaryRuntimeManifest): Promise<ReadonlyMap<string, string>> {
  const aliases = new Map<string, string>()
  if (manifest.platform === 'win32') return aliases
  const interpreter = `python${manifest.python.split('.').slice(0, 2).join('.')}`
  for (const name of ['python', 'python3']) {
    const path = `dependencies/python/bin/${name}`
    let entry
    try { entry = await lstat(join(root, path)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!entry.isSymbolicLink()) continue
    if (await readlink(join(root, path)) !== interpreter
      || !(await lstat(join(root, 'dependencies/python/bin', interpreter))).isFile()) {
      throw new Error(`primary runtime: invalid Python alias ${path}`)
    }
    aliases.set(path, interpreter)
  }
  return aliases
}

/**
 * Copy a payload, retaining only validated Python interpreter aliases as relative links.
 * @param source - Payload directory; all other links are materialized.
 * @param destination - Empty destination owned by the caller.
 * @param manifest - Validated source metadata.
 * @returns Resolves after every copied file and interpreter alias is available independently of the source.
 */
export async function copyPrimaryRuntime(source: string, destination: string, manifest: PrimaryRuntimeManifest): Promise<void> {
  const aliases = await primaryRuntimePythonAliases(source, manifest)
  const excluded = new Set([...aliases.keys()].map(path => join(source, path)))
  await cp(source, destination, { recursive: true, dereference: true, filter: path => !excluded.has(path) })
  for (const [path, target] of aliases) await symlink(target, join(destination, path))
}
async function validatePayloadEntries(paths: WorkspaceDependencies): Promise<void> {
  for (const [path, kind] of [
    [paths.python, 'file'], [paths.node, 'file'], [paths.pnpm, 'file'],
    [paths.pythonPackages, 'directory'], [paths.nodePackages, 'directory'],
  ] as const) {
    if (path === undefined) continue
    const entry = await stat(path)
    if (!(kind === 'file' ? entry.isFile() : entry.isDirectory())) {
      throw new Error(`primary runtime: expected ${kind} at ${path}`)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`primary runtime: installation path is a filesystem link: ${path}`)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function compatibleManifest(source: string): Promise<PrimaryRuntimeManifest> {
  const manifest = await readPrimaryRuntime(source)
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('primary runtime: incompatible platform or architecture')
  return manifest
}

/**
 * Use a payload where it lies: validate its metadata and entries, copying nothing.
 * @param source - Payload directory, typically a read-only carrier.
 * @returns Paths into the payload itself.
 */
export async function resolvePrimaryRuntime(source: string): Promise<WorkspaceDependencies> {
  const manifest = await compatibleManifest(source)
  await primaryRuntimePythonAliases(source, manifest)
  const paths = workspaceDependencyPaths(source, manifest)
  await validatePayloadEntries(paths)
  return paths
}

/**
 * Install the application-owned payload locally, retaining a complete previous tree on copy failure.
 * @param source - Payload carried by the current installation.
 * @param root - Fixed primary runtime directory under the Harness home.
 * @returns Paths into the installed payload; no PATH or package-manager configuration is changed.
 */
export async function installPrimaryRuntime(source: string, root: string): Promise<WorkspaceDependencies> {
  const manifest = await compatibleManifest(source)
  if (manifest.external !== undefined) {
    const paths = workspaceDependencyPaths(source, manifest)
    await validatePayloadEntries(paths)
    return paths
  }
  await mkdir(dirname(root), { recursive: true })
  const previous = `${root}.previous`
  const previousExists = await exists(previous)
  const rootExists = await exists(root)
  if (!rootExists && previousExists) await rename(previous, root)
  if (await exists(join(root, 'runtime.json')) && JSON.stringify(await readPrimaryRuntime(root)) === JSON.stringify(manifest)) {
    await primaryRuntimePythonAliases(root, manifest)
    const paths = workspaceDependencyPaths(root, manifest)
    await validatePayloadEntries(paths)
    return paths
  }
  const staging = await mkdtemp(join(dirname(root), '.primary-runtime-'))
  try {
    await copyPrimaryRuntime(source, staging, manifest)
    const paths = workspaceDependencyPaths(staging, manifest)
    await validatePayloadEntries(paths)
    await rm(previous, { recursive: true, force: true })
    const replacing = await exists(root)
    if (replacing) await rename(root, previous)
    try { await rename(staging, root) } catch (error) {
      if (replacing) await rename(previous, root)
      throw error
    }
    await rm(previous, { recursive: true, force: true })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return workspaceDependencyPaths(root, manifest)
}

/**
 * Register the read-only path query; the first invocation prepares (or merely validates) the payload.
 * @param ctx - Tool registry owner.
 * @param config - Payload location and optional installation directory.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.source) || (config.root !== undefined && !isAbsolute(config.root))) {
    throw new Error('workspace dependencies: source and root must be absolute paths')
  }
  let preparation: Promise<WorkspaceDependencies> | undefined
  ctx.effect(() => async () => {
    // Tool execution reports preparation failures; disposal only waits for filesystem work to settle.
    await preparation?.catch(() => undefined)
  })
  ctx.tools.register(defineTool({
    name: 'load_workspace_dependencies',
    description: 'Get absolute paths to bundled Python and library directories, plus bundled Python distribution versions. Node.js and pnpm paths are included when the payload provides them. Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml, and XlsxWriter. Use these libraries for Office files unless the user or workspace instructions select another environment. When Node.js and pnpm paths are returned, run pnpm with that Node executable and pnpm script path. This does not change PATH or package-manager settings.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          python: { type: 'string', required: true },
          node: { type: 'string', description: 'Absent when the payload ships no Node.js.' },
          pnpm: { type: 'string', description: 'Absent when the payload ships no pnpm.' },
          pythonPackages: { type: 'string', required: true },
          nodePackages: { type: 'string', description: 'Absent when the payload ships no Node.js.' },
          pythonDistributions: { type: 'object', additionalProperties: true, required: true, description: 'Bundled distribution names and versions recorded in runtime.json; excludes user-installed additions.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, undefined, 2) }],
    },
    execute: () => {
      preparation ??= (config.root === undefined ? resolvePrimaryRuntime(config.source) : installPrimaryRuntime(config.source, config.root))
        .catch((error: unknown) => {
          preparation = undefined
          throw error
        })
      return preparation
    },
    presentCall: () => ({ card: 'generic', title: 'Load workspace dependencies', kind: 'read' }),
  }))
}
