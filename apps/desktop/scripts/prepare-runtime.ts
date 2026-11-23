/** Prepare Desktop resources and publish their versions after every preparation stage succeeds. */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { readPrimaryRuntime } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { packagingStep } from './packaging-step.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { prepareCommandLink } from './prepare-command-link.ts'
import { declaredElectronRange, resolveSystemElectron } from './system-electron.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime
/** Name declared with the system-runtime payload in `prepare-primary-runtime.ts`. */
const SYSTEM_RUNTIME_ENV = 'DSH_DESKTOP_SYSTEM_RUNTIME'

type DesktopTarget = ReturnType<typeof desktopTargetPlatform>

/**
 * Materialize the target Electron distribution.
 *
 * A system-runtime build copies the installed distribution it packages against; every other
 * build downloads the npm distribution declared by the Desktop manifest.
 * @param target - Target platform and architecture to prepare.
 * @returns Resolves after the distribution reaches the target build directory.
 */
async function prepareElectron({ platform, arch }: DesktopTarget): Promise<void> {
  const systemRuntime = process.env[SYSTEM_RUNTIME_ENV] === '1'
  const installed = resolveSystemElectron({
    environment: process.env,
    platform,
    arch,
    hostPlatform: process.platform,
    hostArch: process.arch,
    declaredRange: declaredElectronRange(join(import.meta.dirname, '..', 'package.json')),
    required: systemRuntime,
    discover: systemRuntime,
  })
  rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
  if (installed !== undefined) {
    console.log(`desktop runtime: using the ${installed.source} Electron ${installed.version} at ${installed.dist}`)
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'system:electron',
      () => cp(installed.dist, BUILD_PATHS.electron, { recursive: true }))
    return
  }
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
    () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => extractZip(archive, { dir: BUILD_PATHS.electron }))
}

/** Install the terminal command and the private Node launcher the payload runs package scripts with. */
function prepareCli({ platform, arch }: DesktopTarget): void {
  // The terminal command is a macOS and Windows feature: its launcher and link helper are platform-specific.
  if (platform === 'linux') throw new Error('desktop runtime: the terminal command requires a macOS or Windows target')
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  const cli = join(RUNTIME_ROOT, 'cli')
  prepareDesktopCli(cli, platform)
  if (platform === 'darwin') {
    const minimumVersion = execFileSync('/usr/libexec/PlistBuddy', [
      '-c', 'Print LSMinimumSystemVersion', join(BUILD_PATHS.electron, 'Electron.app', 'Contents', 'Info.plist'),
    ], { encoding: 'utf8' }).trim()
    prepareCommandLink(cli, arch, minimumVersion)
  }
  cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(cli, 'command-manager.js'))
  cpSync(join(import.meta.dirname, 'command-path.ps1'), join(cli, 'command-path.ps1'))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = desktopTargetPlatform(resolveDesktopBuildTarget())
  const systemRuntime = process.env[SYSTEM_RUNTIME_ENV] === '1'
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const preparePrimary = () => packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
  if (target.platform === 'win32') {
    const [electron, primary] = await Promise.allSettled([prepareElectron(target), preparePrimary()])
    if (electron.status === 'rejected') throw electron.reason
    if (primary.status === 'rejected') throw primary.reason
  } else {
    await prepareElectron(target)
    await preparePrimary()
  }
  // The Host and the tools it starts run on this Node, not on Electron's, so the payload records
  // the runtime's version; the payload checks assert it against the process that runs them.
  const primaryRuntime = await readPrimaryRuntime(join(RUNTIME_ROOT, 'primary-runtime'))
  if (primaryRuntime.pnpm === undefined) throw new Error('desktop runtime: primary-runtime manifest has no pnpm version')
  if (primaryRuntime.node === undefined) throw new Error('desktop runtime: the prepared primary runtime declares no Node.js runtime')
  // The system primary-runtime preparation materializes the payload's pnpm launcher and records
  // it as the external pnpm entry, so packaging needs no separate pnpm step here.
  if (systemRuntime && primaryRuntime.external?.pnpm === undefined) {
    throw new Error('desktop runtime: the system payload declares no system pnpm entry')
  }
  if (target.platform !== 'linux') {
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:cli', async () => { prepareCli(target) })
  }
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: primaryRuntime.node,
    pnpm: primaryRuntime.pnpm,
  }, undefined, 2)}\n`)
}

await main()
