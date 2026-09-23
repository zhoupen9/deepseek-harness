import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runtimeNode } from '../src/runtime-node.ts'

const scratch: string[] = []

/** Write one prepared primary runtime and return its directory. */
function prepared(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-node-'))
  scratch.push(root)
  writeFileSync(join(root, 'runtime.json'), JSON.stringify(manifest))
  return root
}

const BUNDLED = {
  desktopVersion: '0.1.7-alpha.2',
  platform: 'linux',
  arch: 'x64',
  python: '3.13.0',
  node: '24.21.0',
  pnpm: '11.7.0',
  pythonPackages: {},
}

afterEach(() => {
  for (const created of scratch.splice(0)) rmSync(created, { recursive: true, force: true })
})

describe('runtime Node resolution', () => {
  it('resolves the bundled Node of a prepared payload', () => {
    const root = prepared(BUNDLED)
    expect(runtimeNode(root)).toBe(join(root, 'dependencies', 'node', 'bin', 'node'))
  })

  it('resolves the platform file name a bundled Windows payload uses', () => {
    const root = prepared({ ...BUNDLED, platform: 'win32' })
    expect(runtimeNode(root)).toBe(join(root, 'dependencies', 'node', 'bin', 'node.exe'))
  })

  it('resolves the host Node an external payload declares', () => {
    const root = prepared({ ...BUNDLED, platform: 'linux', external: { python: '/usr/bin/python3', pythonPackages: '/usr/lib/python3', node: '/usr/bin/node' } })
    expect(runtimeNode(root)).toBe('/usr/bin/node')
  })

  it('reports no runtime for a payload that declares none', () => {
    expect(runtimeNode(prepared({ ...BUNDLED, node: undefined, pnpm: undefined }))).toBeUndefined()
    expect(runtimeNode(join(mkdtempSync(join(tmpdir(), 'dsh-runtime-node-')), 'absent'))).toBeUndefined()
  })

  it('rejects a malformed runtime manifest', () => {
    expect(() => runtimeNode(prepared({ ...BUNDLED, platform: 'plan9' }))).toThrow(/invalid metadata/u)
  })
})
