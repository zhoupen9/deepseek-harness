import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  declaredElectronRange,
  resolveSystemElectron,
  SYSTEM_ELECTRON_ENV,
  type SystemElectronRequest,
} from '../scripts/system-electron.ts'

const EXECUTABLE = process.platform === 'win32' ? 'electron.exe' : 'electron'
const scratch: string[] = []

function directory(): string {
  const created = mkdtempSync(join(tmpdir(), 'dsh-system-electron-'))
  scratch.push(created)
  return created
}

/** Build a fake distribution; `entries` selects which files it declares. */
function distribution(version: string, entries: readonly string[] = ['version', EXECUTABLE]): string {
  const dist = directory()
  if (entries.includes('version')) writeFileSync(join(dist, 'version'), `${version}\n`)
  if (entries.includes(EXECUTABLE)) writeFileSync(join(dist, EXECUTABLE), '')
  return dist
}

function request(overrides: Partial<SystemElectronRequest> = {}): SystemElectronRequest {
  return {
    environment: {},
    platform: 'linux',
    arch: 'x64',
    hostPlatform: 'linux',
    hostArch: 'x64',
    declaredRange: '^44.4.3',
    required: false,
    discover: false,
    ...overrides,
  }
}

afterEach(() => {
  for (const created of scratch.splice(0)) rmSync(created, { recursive: true, force: true })
})

describe('installed Electron selection', () => {
  it('selects the distribution named by the environment', () => {
    const dist = distribution('44.4.3')
    expect(resolveSystemElectron(request({ environment: { [SYSTEM_ELECTRON_ENV]: dist } }))).toEqual({
      dist: realpathSync(dist),
      executable: join(realpathSync(dist), EXECUTABLE),
      version: '44.4.3',
      source: 'override',
    })
  })

  it('rejects an environment distribution the target cannot run', () => {
    const environment = { [SYSTEM_ELECTRON_ENV]: distribution('44.4.3') }
    expect(() => resolveSystemElectron(request({ environment, platform: 'win32', hostPlatform: 'win32' })))
      .toThrow(/requires a Linux target/u)
    expect(() => resolveSystemElectron(request({ environment, arch: 'arm64' })))
      .toThrow(/names the host Electron/u)
  })

  it('rejects a directory that is not an unpacked Electron build', () => {
    const environment = (dist: string): NodeJS.ProcessEnv => ({ [SYSTEM_ELECTRON_ENV]: dist })
    expect(() => resolveSystemElectron(request({ environment: environment(join(directory(), 'absent')) })))
      .toThrow(/does not exist/u)
    expect(() => resolveSystemElectron(request({ environment: environment(distribution('44.4.3', [EXECUTABLE])) })))
      .toThrow(/has no version file/u)
    expect(() => resolveSystemElectron(request({ environment: environment(distribution('44.4.3', ['version'])) })))
      .toThrow(/has no Electron executable/u)
    expect(() => resolveSystemElectron(request({ environment: environment(distribution('not-a-version')) })))
      .toThrow(/invalid version/u)
  })

  it('discovers the platform distribution when the version satisfies the declared dependency', () => {
    expect(resolveSystemElectron(request({ discover: true, systemDist: distribution('44.4.3') })))
      .toMatchObject({ version: '44.4.3', source: 'system' })
    expect(resolveSystemElectron(request({ required: true, discover: true, systemDist: distribution('44.4.3') })))
      .toMatchObject({ source: 'system' })
  })

  it('leaves the npm distribution in place when discovery finds nothing that qualifies', () => {
    expect(resolveSystemElectron(request({ discover: true, systemDist: distribution('45.0.0') }))).toBeUndefined()
    expect(resolveSystemElectron(request({ discover: true, systemDist: join(directory(), 'absent') }))).toBeUndefined()
    expect(resolveSystemElectron(request({ systemDist: distribution('44.4.3') }))).toBeUndefined()
  })

  it('fails loudly when a required build finds no installed Electron', () => {
    expect(() => resolveSystemElectron(request({ required: true, discover: true, systemDist: distribution('45.0.0') })))
      .toThrow(new RegExp(SYSTEM_ELECTRON_ENV, 'u'))
    expect(() => resolveSystemElectron(request({ required: true, discover: true, systemDist: join(directory(), 'absent') })))
      .toThrow(/satisfies/u)
  })

  it('rejects a required build whose target is not the host', () => {
    expect(() => resolveSystemElectron(request({ required: true, platform: 'darwin', hostPlatform: 'darwin' })))
      .toThrow(/requires a Linux target/u)
    expect(() => resolveSystemElectron(request({ required: true, arch: 'arm64' })))
      .toThrow(/serves the host/u)
    expect(resolveSystemElectron(request({ discover: true, platform: 'darwin', hostPlatform: 'darwin' }))).toBeUndefined()
    expect(resolveSystemElectron(request({ discover: true, arch: 'arm64' }))).toBeUndefined()
  })

  it('treats an empty environment value as unset', () => {
    const environment = { [SYSTEM_ELECTRON_ENV]: '  ' }
    expect(resolveSystemElectron(request({ environment, discover: true, systemDist: distribution('44.4.3') })))
      .toMatchObject({ source: 'system' })
  })

  it('reads the Electron range from a manifest', () => {
    const manifest = join(directory(), 'package.json')
    writeFileSync(manifest, JSON.stringify({ devDependencies: { electron: '^44.4.3' } }))
    expect(declaredElectronRange(manifest)).toBe('^44.4.3')
    writeFileSync(manifest, JSON.stringify({ dependencies: {} }))
    expect(() => declaredElectronRange(manifest)).toThrow(/declares no Electron dependency/u)
    writeFileSync(manifest, JSON.stringify([]))
    expect(() => declaredElectronRange(manifest)).toThrow(/is not a package manifest/u)
  })

  it('reads the range the Desktop manifest declares', () => {
    const manifest = join(import.meta.dirname, '..', 'package.json')
    const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { devDependencies: { electron: string } }).devDependencies.electron
    expect(declaredElectronRange(manifest)).toBe(declared)
  })
})
