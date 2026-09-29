/** Prepare the target Electron distribution and pinned pnpm CLI. */

import { packagingStep } from './packaging-step.mjs'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import { parsePrimaryRuntime } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import extractZip from 'extract-zip'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { prepareCommandLink } from './prepare-command-link.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { preparePrimaryRuntime, SYSTEM_RUNTIME_ENV } from './prepare-primary-runtime.ts'
import { declaredElectronRange, resolveSystemElectron } from './system-electron.ts'
import { resolveSystemExecutable, resolveSystemPnpm, writeSystemPnpmLauncher } from '../../../scripts/primary-runtime/prepare.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

/** Install a launcher for the build host's pnpm so no package-manager copy ships. */
function prepareSystemPnpm(): string {
  const node = resolveSystemExecutable('node', process.env.DSH_DESKTOP_SYSTEM_NODE)
  const { entry, version } = resolveSystemPnpm(node, resolveSystemExecutable('pnpm', process.env.DSH_DESKTOP_SYSTEM_PNPM))
  writeSystemPnpmLauncher(RUNTIME_ROOT, entry)
  return version
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = resolveDesktopBuildTarget()
  const platform = target.startsWith('mac-') ? 'darwin' : target.startsWith('linux-') ? 'linux' : 'win32'
  const arch = target.endsWith('arm64') ? 'arm64' : 'x64'
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
  if (installed === undefined) {
    const require = createRequire(import.meta.url)
    const { version } = require('electron/package.json') as { version: string }
    const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
      () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
    rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => extractZip(archive, { dir: BUILD_PATHS.electron }))
  } else {
    rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
    console.log(`desktop runtime: using the ${installed.source} Electron ${installed.version} at ${installed.dist}`)
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'system:electron',
      () => cp(installed.dist, BUILD_PATHS.electron, { recursive: true }))
  }
  const macosMinimumVersion = platform === 'darwin' ? execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print LSMinimumSystemVersion', join(BUILD_PATHS.electron, 'Electron.app', 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim() : undefined
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const pnpmVersion = process.env[SYSTEM_RUNTIME_ENV] === '1' ? prepareSystemPnpm() : preparePnpm()
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  // The terminal command is a macOS and Windows feature: its launcher and link helper are platform-specific.
  if (platform !== 'linux') {
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:cli',
      async () => prepareDesktopCli(join(RUNTIME_ROOT, 'cli'), platform))
    if (macosMinimumVersion !== undefined) prepareCommandLink(join(RUNTIME_ROOT, 'cli'), arch, macosMinimumVersion)
    cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(RUNTIME_ROOT, 'cli', 'command-manager.js'))
    cpSync(join(import.meta.dirname, 'command-path.ps1'), join(RUNTIME_ROOT, 'cli', 'command-path.ps1'))
  }
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
  // The Host and the tools it starts run on this Node, not on Electron's, so the payload records
  // the runtime's version; the payload checks assert it against the process that runs them.
  const primaryRuntime = parsePrimaryRuntime(JSON.parse(readFileSync(join(RUNTIME_ROOT, 'primary-runtime', 'runtime.json'), 'utf8')))
  if (primaryRuntime.node === undefined) throw new Error('desktop runtime: the prepared primary runtime declares no Node.js runtime')
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: primaryRuntime.node,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
}

await main()
