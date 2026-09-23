/** Selection of an installed Electron distribution for the Desktop toolchain. */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { satisfies, valid } from 'semver'

/** Absolute path of an installed Electron distribution that replaces the npm copy. */
export const SYSTEM_ELECTRON_ENV = 'DSH_DESKTOP_SYSTEM_ELECTRON'

/** Path where Linux distributions install Electron beside its major-versioned directory. */
export const LINUX_ELECTRON_DIST = '/usr/lib/electron'

/** Installed Electron distribution selected for one build target. */
export interface SystemElectron {
  /** Distribution directory holding the unpacked Electron build. */
  readonly dist: string
  /** Electron executable inside the distribution. */
  readonly executable: string
  /** Version declared by the distribution's `version` file. */
  readonly version: string
  /** Whether the environment named this distribution or the toolchain discovered it. */
  readonly source: 'override' | 'system'
}

/** One installed Electron request. */
export interface SystemElectronRequest {
  readonly environment: NodeJS.ProcessEnv
  /** Target platform and architecture of the build that needs Electron. */
  readonly platform: NodeJS.Platform
  readonly arch: string
  /** Platform and architecture this process runs on. */
  readonly hostPlatform: NodeJS.Platform
  readonly hostArch: string
  /** Electron dependency range declared by the Desktop manifest. */
  readonly declaredRange: string
  /** Whether this build must use an installed Electron instead of falling back to the npm copy. */
  readonly required: boolean
  /** Whether discovery at the platform default path may satisfy the request. */
  readonly discover: boolean
  /** Distribution path probed during discovery; tests replace the platform default. */
  readonly systemDist?: string
}

/** An installed Electron distribution that is missing, malformed, or unusable for the target. */
class SystemElectronError extends Error {}

/**
 * Read the Electron dependency range declared by the Desktop manifest.
 * @param manifestPath - Absolute path of the Desktop `package.json`.
 * @returns the range declared under `devDependencies`.
 */
export function declaredElectronRange(manifestPath: string): string {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(`desktop electron: ${manifestPath} is not a package manifest`)
  }
  const { devDependencies } = manifest as { devDependencies?: unknown }
  const range = typeof devDependencies === 'object' && devDependencies !== null
    ? (devDependencies as Record<string, unknown>).electron
    : undefined
  if (typeof range !== 'string' || range === '') throw new Error(`desktop electron: ${manifestPath} declares no Electron dependency`)
  return range
}

/** Describe one distribution directory, rejecting anything that is not an unpacked Electron build. */
function describe(dist: string, source: SystemElectron['source']): SystemElectron {
  if (!existsSync(dist)) throw new SystemElectronError(`desktop electron: ${dist} does not exist`)
  const versionPath = join(dist, 'version')
  if (!existsSync(versionPath)) throw new SystemElectronError(`desktop electron: ${dist} has no version file`)
  const version = readFileSync(versionPath, 'utf8').trim()
  if (valid(version) === null) throw new SystemElectronError(`desktop electron: ${dist} declares the invalid version ${version}`)
  const resolved = realpathSync(dist)
  const executable = join(resolved, process.platform === 'win32' ? 'electron.exe' : 'electron')
  if (!existsSync(executable)) throw new SystemElectronError(`desktop electron: ${dist} has no Electron executable`)
  return { dist: resolved, executable, version, source }
}

/** Describe a discovered distribution that satisfies the declared dependency, or nothing. */
function discover(candidate: string, declaredRange: string): SystemElectron | undefined {
  let installed: SystemElectron
  try {
    installed = describe(candidate, 'system')
  } catch (error) {
    if (!(error instanceof SystemElectronError)) throw error
    return undefined
  }
  return satisfies(installed.version, declaredRange) ? installed : undefined
}

/**
 * Resolve the installed Electron distribution this build or development run uses.
 *
 * `DSH_DESKTOP_SYSTEM_ELECTRON` names a distribution explicitly and is honoured as written.
 * Otherwise discovery uses the platform default path, and a distribution qualifies only when its
 * version satisfies the declared dependency, so a required build fails loudly rather than
 * bundling a copy the selected mode is meant to avoid.
 * @param request - Environment, target, host, and requirement settings.
 * @returns the selected distribution, or undefined when the npm distribution applies.
 */
export function resolveSystemElectron(request: SystemElectronRequest): SystemElectron | undefined {
  const configured = request.environment[SYSTEM_ELECTRON_ENV]?.trim()
  if (configured !== undefined && configured !== '') {
    if (request.platform !== 'linux') {
      throw new Error(`desktop electron: ${SYSTEM_ELECTRON_ENV} requires a Linux target, not ${request.platform}`)
    }
    if (request.platform !== request.hostPlatform || request.arch !== request.hostArch) {
      throw new Error(`desktop electron: ${SYSTEM_ELECTRON_ENV} names the host Electron ${request.hostPlatform}-${request.hostArch}, not ${request.platform}-${request.arch}`)
    }
    return describe(resolve(configured), 'override')
  }
  if (request.platform !== 'linux') {
    if (request.required) throw new Error(`desktop electron: an installed Electron requires a Linux target, not ${request.platform}`)
    return undefined
  }
  const hostTarget = request.platform === request.hostPlatform && request.arch === request.hostArch
  if (!hostTarget) {
    if (request.required) throw new Error(`desktop electron: an installed Electron serves the host ${request.hostPlatform}-${request.hostArch}, not ${request.platform}-${request.arch}`)
    return undefined
  }
  const discovered = request.discover ? discover(request.systemDist ?? LINUX_ELECTRON_DIST, request.declaredRange) : undefined
  if (discovered !== undefined) return discovered
  if (request.required) {
    throw new Error(`desktop electron: no installed Electron at ${request.systemDist ?? LINUX_ELECTRON_DIST} satisfies ${request.declaredRange}; set ${SYSTEM_ELECTRON_ENV} or build without the system runtime mode`)
  }
  return undefined
}
