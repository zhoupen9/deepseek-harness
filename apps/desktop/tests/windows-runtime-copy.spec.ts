import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyWindowsRuntimeCopy } from '../scripts/windows-runtime-signature.mjs'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Minimal file satisfying the PE header probe. */
function portableExecutable(): Buffer {
  const body = Buffer.alloc(128)
  body.writeUInt16LE(0x5a4d, 0)
  body.writeUInt32LE(64, 0x3c)
  body.writeUInt32LE(0x4550, 64)
  return body
}

const RELATIVE = join('node_modules', 'foo', 'tool.exe')

/** Prepare one signed source tree and the resource copy electron-builder would make. */
async function fixture(): Promise<{ source: string; resources: string; copied: string }> {
  const root = await mkdtemp(join(tmpdir(), 'windows-runtime-copy-'))
  roots.push(root)
  const source = join(root, 'prepared')
  const resources = join(root, 'resources')
  const prepared = join(source, RELATIVE)
  const copied = join(resources, 'dsh', RELATIVE)
  await mkdir(dirname(prepared), { recursive: true })
  await mkdir(dirname(copied), { recursive: true })
  await writeFile(prepared, portableExecutable())
  await writeFile(copied, portableExecutable())
  return { source, resources, copied }
}

describe('Windows runtime copy verification', () => {
  it('accepts the verbatim unpacked payload copy', async () => {
    const { source, resources } = await fixture()
    await expect(verifyWindowsRuntimeCopy(source, resources)).resolves.toBeUndefined()
  })

  it('rejects a payload copy whose bytes changed', async () => {
    const { source, resources, copied } = await fixture()
    await writeFile(copied, Buffer.concat([portableExecutable(), Buffer.from('re-signed')]))
    await expect(verifyWindowsRuntimeCopy(source, resources)).rejects.toThrow('PE bytes changed')
  })

  it('rejects a linked or absent payload copy', async () => {
    const { source, resources, copied } = await fixture()
    await rm(copied)
    await symlink(join(source, RELATIVE), copied)
    await expect(verifyWindowsRuntimeCopy(source, resources)).rejects.toThrow('expected a real PE file')
    await rm(copied)
    await expect(verifyWindowsRuntimeCopy(source, resources)).rejects.toThrow()
  })

  it('rejects malformed Windows code in the prepared payload', async () => {
    const { source, resources } = await fixture()
    await writeFile(join(source, 'node_modules', 'foo', 'broken.dll'), 'not a portable executable')
    await expect(verifyWindowsRuntimeCopy(source, resources)).rejects.toThrow('invalid PE file')
  })
})
