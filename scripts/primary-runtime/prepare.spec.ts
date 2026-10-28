import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { downloadPrimaryRuntimeAsset, prepareOfficeSkillAssets, primaryRuntimePayloadDigest, prunePnpmForeignNativePackages, resolveSystemPnpm, smokePrimaryRuntime, unpackPrimaryRuntimeWheel, writeSystemPnpmLauncher } from './prepare.ts'
import lock from './lock.json' with { type: 'json' }

it('covers every SDK wheel target with the shared interpreter lock', () => {
  const platforms = JSON.parse(readFileSync(new URL('../../python/sdk-runtime/platforms.json', import.meta.url), 'utf8')) as Record<string, unknown>
  expect(Object.keys(lock.targets).sort()).toEqual(Object.keys(platforms).map(target => target.replace('macos-', 'mac-')).sort())
})

const libraryWheel = Buffer.from('UEsDBAoAAAAAAASeLl0sYMPjDAAAAAwAAAAJAAAAc2FtcGxlLnB5c2FtcGxlID0gNDIKUEsBAh4DCgAAAAAABJ4uXSxgw+MMAAAADAAAAAkAAAAAAAAAAQAAAKSBAAAAAHNhbXBsZS5weVBLBQYAAAAAAQABADcAAAAzAAAAAAA=', 'base64')
const relocatedWheel = Buffer.from('UEsDBAoAAAAAAASeLl3x0Nj9FAAAABQAAAAeAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlcmVxdWlyZXMgcmVsb2NhdGlvbgpQSwECHgMKAAAAAAAEni5d8dDY/RQAAAAUAAAAHgAAAAAAAAABAAAApIEAAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlUEsFBgAAAAABAAEATAAAAFAAAAAAAA==', 'base64')
const externalLibraryWheel = Buffer.from('UEsDBBQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAc2FtcGxlLTEuMC5kYXRhL3B1cmVsaWIvc2FtcGxlLnB5cmVxdWlyZXMgbGlicmFyeSByZWxvY2F0aW9uClBLAQIUAxQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAAAAAAAAAAACAAQAAAABzYW1wbGUtMS4wLmRhdGEvcHVyZWxpYi9zYW1wbGUucHlQSwUGAAAAAAEAAQBPAAAAWwAAAAAA', 'base64')

it.each(Object.entries(lock.targets))('records every locked wheel distribution and version for %s', (_target, artifact) => {
  const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/gu, '-')
  const distributions = [...artifact.wheels, ...lock.wheels].map(({ url }) => {
    const [name, version] = basename(new URL(url).pathname).split('-')
    return [normalize(name!), version] as const
  })
  const declared = Object.entries(lock.pythonPackages).map(([name, version]) => [normalize(name), version] as const)
  expect(new Set(distributions.map(([name]) => name)).size).toBe(distributions.length)
  expect(new Set(declared.map(([name]) => name)).size).toBe(declared.length)
  expect(Object.fromEntries(distributions)).toEqual(Object.fromEntries(declared))
})

it('keeps a target payload identity independent of other target archives', () => {
  const changed = structuredClone(lock)
  changed.targets['win-x64'].wheels[0]!.sha256 = 'a'.repeat(64)
  expect(primaryRuntimePayloadDigest('mac-arm64', changed, '11.7.0')).toBe(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0'))
  expect(primaryRuntimePayloadDigest('win-x64', changed, '11.7.0')).not.toBe(primaryRuntimePayloadDigest('win-x64', lock, '11.7.0'))
})

it('invalidates payload identity for shared wheels, package versions and package-manager changes', () => {
  const wheel = structuredClone(lock), distribution = structuredClone(lock)
  wheel.wheels[0]!.sha256 = 'a'.repeat(64)
  distribution.pythonPackages['python-docx'] = '1.2.1'
  const original = primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0')
  expect(primaryRuntimePayloadDigest('mac-arm64', wheel, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', distribution, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.1')).not.toBe(original)
})

it('reports missing distribution metadata before trying to execute a stale native payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stale-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      components: { python: '3.12.14', numpy: '2.3.5', pandas: '3.0.1' } }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('missing Python distribution versions; prepare the payload')
  } finally { await rm(root, { recursive: true, force: true }) }
})

// Native Windows payloads require python.exe rather than POSIX interpreter aliases.
it.skipIf(process.platform === 'win32')('rejects expanded interpreter aliases in the native payload smoke', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-expanded-aliases-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1', platform: process.platform, arch: process.arch,
      python: '3.12.14', pythonPackages: { numpy: '2.3.5' } }))
    await mkdir(join(root, 'dependencies/python/bin'), { recursive: true })
    for (const name of ['python', 'python3', 'python3.12']) await writeFile(join(root, 'dependencies/python/bin', name), 'interpreter')
    expect(() => { smokePrimaryRuntime(root) }).toThrow('Python commands must be relative aliases')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts a hash-verified cached library without a Python installer or network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update(libraryWheel).digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, libraryWheel)
    const original = await stat(archive)
    expect(await downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).toBe(archive)
    const reused = await stat(archive)
    expect(reused.ino).toBe(original.ino)
    expect(reused.mtimeMs).toBe(original.mtimeMs)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample.py'), 'utf8')).toBe('sample = 42\n')
    await writeFile(archive, 'corrupt archive')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).rejects.toThrow('checksum mismatch')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('falls back to a mirror when the locked host cannot be reached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const body = Buffer.from('mirror bytes')
    const hash = createHash('sha256').update(body).digest('hex')
    // A file: primary fails without network; the data: mirror returns the verified bytes.
    const mirror = `data:application/octet-stream;base64,${body.toString('base64')}`
    const archive = await downloadPrimaryRuntimeAsset('file:///nonexistent/library.bin', hash, root, [mirror])
    expect(archive).toBe(join(root, hash))
    expect(await readFile(archive)).toEqual(body)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reports every source when no mirror serves the archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update('missing').digest('hex')
    await expect(downloadPrimaryRuntimeAsset('file:///nonexistent/library.bin', hash, root, ['file:///also-missing/library.bin']))
      .rejects.toThrow('primary runtime download failed for file:///nonexistent/library.bin')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('fully extracts a large deflate-compressed wheel entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-large-wheel-'))
  try {
    const expected = Buffer.alloc(1024 * 1024)
    // Seeded xorshift bytes keep the compressed entry larger than the stream buffers.
    let state = 26
    for (let index = 0; index < expected.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      expected[index] = state & 255
    }
    const archive = join(root, 'large.whl')
    await writeFile(archive, zipSync({ 'large.bin': expected }, { level: 6 }))
    await unpackPrimaryRuntimeWheel(archive, root)
    // Native byte equality avoids a per-byte matcher traversal for this 1 MiB expected output.
    expect((await readFile(join(root, 'large.bin'))).equals(expected)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains auxiliary wheel scripts without generating command wrappers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, relocatedWheel)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample-1.0.data/scripts/sample'), 'utf8')).toBe('requires relocation\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects library files requiring an unsupported installation scheme', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, externalLibraryWheel)
    await expect(unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))).rejects.toThrow('unsupported installation paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('copies complete Office resources outside the application archive and removes obsolete assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-assets-'))
  try {
    const source = join(root, 'package', 'assets')
    const destination = join(root, 'Contents', 'Resources', 'runtime', 'office-skills')
    await mkdir(source, { recursive: true })
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      await mkdir(join(source, name))
      await writeFile(join(source, name, 'SKILL.md'), `# ${name}\n`)
    }
    await prepareOfficeSkillAssets(source, destination)
    await writeFile(join(destination, 'obsolete.py'), 'old helper')
    await prepareOfficeSkillAssets(source, destination)
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      expect(await readFile(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    await expect(readFile(join(destination, 'obsolete.py'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('gives Python-only payloads a distinct identity', () => {
  expect(primaryRuntimePayloadDigest('linux-x64', lock, undefined)).not.toBe(primaryRuntimePayloadDigest('linux-x64', lock, '11.7.0'))
})

it('keeps carrier pnpm versions aligned with the shared payload build', () => {
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    packageManager: string
    devDependencies: { pnpm: string }
  }
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8')) as {
    devDependencies: { pnpm: string }
  }
  expect(desktop.devDependencies.pnpm).toBe(root.devDependencies.pnpm)
  expect(root.packageManager).toBe(`pnpm@${root.devDependencies.pnpm}`)
})

it('resolves a script pnpm through the supplied Node and validates its output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-script-'))
  try {
    const entry = join(root, 'pnpm.cjs')
    await writeFile(entry, 'console.log("12.13.0")\n')
    expect(resolveSystemPnpm(process.execPath, entry)).toEqual({ entry: realpathSync(entry), version: '12.13.0' })
    await writeFile(entry, 'console.log("beta")\n')
    expect(() => resolveSystemPnpm(process.execPath, entry)).toThrow('reported an unsupported version "beta"')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('executes a standalone binary pnpm directly rather than loading it as JavaScript', () => {
  // process.execPath is a native image and its --version output keeps the leading v the resolver
  // rejects; loading it under Node would die on the image bytes before printing any version.
  expect(() => resolveSystemPnpm(process.execPath, process.execPath)).toThrow(/reported an unsupported version "v/u)
})

it('imports a script pnpm entry with the arguments the payload forwarded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-launcher-'))
  try {
    const entry = join(root, 'pnpm.mjs')
    await writeFile(entry, 'console.log(process.argv.slice(2).join(" "))\n')
    const launcher = writeSystemPnpmLauncher(join(root, 'dependencies'), entry)
    expect(launcher).toBe(join(root, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'))
    expect(execFileSync(process.execPath, [launcher, '--version', '--store-dir', 'x'], { encoding: 'utf8' }).trim())
      .toBe('--version --store-dir x')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('launches a standalone binary pnpm and forwards its exit status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-binary-'))
  try {
    const launcher = writeSystemPnpmLauncher(root, process.execPath)
    expect(execFileSync(process.execPath, [launcher, '-p', '40 + 2'], { encoding: 'utf8' }).trim()).toBe('42')
    let status: number | undefined
    try {
      execFileSync(process.execPath, [launcher, '-e', 'process.exit(7)'])
    } catch (error) {
      status = (error as { status?: number }).status
    }
    expect(status).toBe(7)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.each([
  ['darwin', 'arm64', ['reflink', 'reflink-darwin-arm64'], ['.bin', '@reflink', 'any-cpu', 'not-windows', 'semver']],
  ['darwin', 'x64', ['reflink', 'reflink-darwin-x64'], ['.bin', '@reflink', 'any-cpu', 'not-windows', 'semver']],
  ['win32', 'x64', ['reflink', 'reflink-win32-x64-msvc'], ['.bin', '@reflink', 'any-cpu', 'not-darwin', 'semver']],
] as const)('keeps only pnpm-bundled packages that %s/%s admits', async (platform, arch, reflink, top) => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-natives-'))
  try {
    const modules = join(root, 'dist', 'node_modules')
    const packages: Record<string, { os?: string[]; cpu?: string[] }> = {
      'semver': {}, '@reflink/reflink': {}, 'any-cpu': { cpu: ['any'] },
      '@reflink/reflink-darwin-arm64': { os: ['darwin'], cpu: ['arm64'] },
      '@reflink/reflink-darwin-x64': { os: ['darwin'], cpu: ['x64'] },
      '@reflink/reflink-win32-x64-msvc': { os: ['win32'], cpu: ['x64'] },
      'not-windows': { os: ['!win32'] },
      'not-darwin': { os: ['!darwin'] },
      'contradictory': { os: ['darwin', 'win32', '!darwin', '!win32'] },
    }
    for (const [name, fields] of Object.entries(packages)) {
      await mkdir(join(modules, name), { recursive: true })
      await writeFile(join(modules, name, 'package.json'), JSON.stringify({ name, ...fields }))
    }
    await mkdir(join(modules, '.bin'))
    await writeFile(join(modules, '.modules.yaml'), '')
    prunePnpmForeignNativePackages(root, platform, arch)
    expect((await readdir(modules)).filter(name => name !== '.modules.yaml').sort()).toEqual(top)
    expect((await readdir(join(modules, '@reflink'))).sort()).toEqual(reflink)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('names the bundled manifest whose platform field is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-invalid-'))
  try {
    await mkdir(join(root, 'dist', 'node_modules', 'invalid'), { recursive: true })
    await writeFile(join(root, 'dist', 'node_modules', 'invalid', 'package.json'), JSON.stringify({ os: 'darwin' }))
    expect(() => { prunePnpmForeignNativePackages(root, 'darwin', 'arm64') }).toThrow(/invalid.package\.json: npm platform constraints must be arrays of strings/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})
