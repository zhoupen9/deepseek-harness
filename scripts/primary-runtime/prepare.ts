/** Prepare pinned, relocatable script interpreters without installing into the build host. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../../packages/skill/tool-workspace-dependencies/src/index.ts'
import lock from './lock.json' with { type: 'json' }

/**
 * Checksum-verified transport mirror for the Node.js distribution. Some networks
 * reset TLS connections to nodejs.org; the lock digest still decides the accepted bytes.
 */
const NODE_DIST_MIRROR = 'https://npmmirror.com/mirrors/node'

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * @param url - Locked archive URL.
 * @param sha256 - Expected SHA-256 digest.
 * @param cache - Download cache directory.
 * @param mirrors - Transport mirrors tried after the locked URL; the digest still decides the accepted bytes.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(
  url: string, sha256: string, cache: string, mirrors: readonly string[] = [],
): Promise<string> {
  const destination = join(cache, sha256)
  let bytes: Buffer
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    bytes = await fetchFirstAvailable([url, ...mirrors], url)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  writeFileSync(destination, bytes)
  return destination
}

/**
 * Fetch an archive from the first source that answers, so a blocked locked host can fall back to a mirror.
 * @param sources - The locked URL followed by mirror URLs.
 * @param url - The locked URL named in the failure message.
 * @returns The first successful response body.
 */
async function fetchFirstAvailable(sources: readonly string[], url: string): Promise<Buffer> {
  const failures: string[] = []
  for (const source of sources) {
    try {
      const response = await fetch(source)
      if (!response.ok) { failures.push(`${String(response.status)} ${source}`); continue }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      failures.push(`${error instanceof Error ? error.message : String(error)} ${source}`)
    }
  }
  throw new Error(`primary runtime download failed for ${url}: ${failures.join('; ')}`)
}

async function pythonArchive(target: keyof typeof lock.targets, cache: string): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  return downloadPrimaryRuntimeAsset(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Runtime target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param pnpmVersion - Package-manager version copied into the payload.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(
  target: keyof typeof lock.targets, runtimeLock: typeof lock, pnpmVersion: string | undefined,
): string {
  const { pythonVersion, pythonRelease, nodeVersion, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 4, target, pythonVersion, pythonRelease, nodeVersion: pnpmVersion === undefined ? undefined : nodeVersion,
    artifact: runtimeLock.targets[target], wheels, pythonPackages, pnpm: pnpmVersion,
  })).digest('hex')
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - External Office skill resource directory.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/** A locked interpreter and wheel target. */
export type PrimaryRuntimeTarget = keyof typeof lock.targets

/**
 * Resolve the manifest platform and architecture for a locked target.
 * @param target - Locked runtime target.
 * @returns Manifest platform and architecture identifiers.
 */
function targetIdentity(target: PrimaryRuntimeTarget): { platform: string; arch: string } {
  return {
    platform: target === 'win-x64' ? 'win32' : target.startsWith('linux-') ? 'linux' : 'darwin',
    arch: target.endsWith('-arm64') ? 'arm64' : 'x64',
  }
}

/**
 * Find an executable on `PATH`, or validate an explicit override.
 * @param name - Executable file name without extension.
 * @param override - Absolute path that replaces the `PATH` search.
 * @returns Absolute executable path.
 */
export function resolveSystemExecutable(name: string, override?: string): string {
  if (override !== undefined) {
    if (!isAbsolute(override) || !existsSync(override)) throw new Error(`primary runtime: ${name} override does not name an existing executable: ${override}`)
    return override
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    // A node_modules/.bin shim is a package manager's wrapper script, not the host interpreter.
    if (directory === '' || basename(directory) === '.bin') continue
    const candidate = join(directory, name)
    try { accessSync(candidate, constants.X_OK) } catch { continue }
    return candidate
  }
  throw new Error(`primary runtime: ${name} is not on PATH`)
}

function systemPythonVersion(python: string): string {
  const version = execFileSync(python, ['-I', '-B', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8' }).trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`primary runtime: ${python} reported an unsupported version ${JSON.stringify(version)}`)
  return version
}

function systemPythonPackages(python: string): string {
  const packages = execFileSync(python, ['-I', '-B', '-c', 'import site; print(site.getsitepackages()[0])'], { encoding: 'utf8' }).trim()
  if (!isAbsolute(packages)) throw new Error(`primary runtime: ${python} reported no absolute site-packages directory`)
  return packages
}

function systemPythonDistributions(python: string): Record<string, string> {
  const script = [
    'import importlib.metadata as metadata, json, sys',
    'versions = {}',
    'missing = []',
    'for name in json.loads(sys.argv[1]):',
    '    try:',
    '        versions[name] = metadata.version(name)',
    '    except metadata.PackageNotFoundError:',
    '        missing.append(name)',
    'print(json.dumps({"versions": versions, "missing": missing}))',
  ].join('\n')
  const reported = execFileSync(python, ['-I', '-B', '-c', script, JSON.stringify(Object.keys(lock.pythonPackages))], { encoding: 'utf8' })
  const parsed: unknown = JSON.parse(reported)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`primary runtime: ${python} reported invalid distribution versions`)
  }
  const { versions, missing } = parsed as { versions?: unknown; missing?: unknown }
  if (Array.isArray(missing) && missing.length > 0) {
    throw new Error(`primary runtime: system Python is missing ${missing.map(String).join(', ')}`)
  }
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) {
    throw new Error(`primary runtime: ${python} reported invalid distribution versions`)
  }
  for (const [name, value] of Object.entries(versions)) {
    if (typeof value !== 'string') throw new Error(`primary runtime: ${python} reported an invalid version for ${name}`)
  }
  return versions as Record<string, string>
}

function systemNodeVersion(node: string): string {
  const version = execFileSync(node, ['-p', 'process.version'], { encoding: 'utf8' }).trim().replace(/^v/u, '')
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(version)) throw new Error(`primary runtime: ${node} reported an unsupported version ${JSON.stringify(version)}`)
  return version
}

/**
 * Resolve the system pnpm entry script and its version.
 * @param node - System Node.js executable that runs the script.
 * @param pnpm - System pnpm executable, which may be a symlink to its entry script.
 * @returns Absolute entry script and its version.
 */
export function resolveSystemPnpm(node: string, pnpm: string): { entry: string; version: string } {
  const entry = realpathSync(pnpm)
  // A project package.json with a packageManager field makes pnpm switch to that version; ask outside one.
  const version = execFileSync(node, [entry, '--version'], { encoding: 'utf8', cwd: tmpdir() }).trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(version)) throw new Error(`primary runtime: ${pnpm} reported an unsupported version ${JSON.stringify(version)}`)
  return { entry, version }
}

/** Build-only inputs for a payload that uses the build host's own interpreters. */
export interface SystemPrimaryRuntimeOptions {
  /** Target whose platform and architecture the manifest records. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
  /** Python executable override; defaults to `python3` on `PATH`. */
  readonly python?: string | undefined
  /** Node.js executable override; defaults to `node` on `PATH`. */
  readonly node?: string | undefined
  /** pnpm executable override; defaults to `pnpm` on `PATH`. */
  readonly pnpm?: string | undefined
}

/**
 * Write a manifest that references the host's own Python, Node.js, and pnpm instead of a closed payload.
 * @param options - Target, output directory, carrier version, and interpreter overrides.
 * @returns Resolves after the manifest and Office skills reach the output directory; nothing is downloaded.
 */
export async function prepareSystemPrimaryRuntime(options: SystemPrimaryRuntimeOptions): Promise<void> {
  const python = resolveSystemExecutable('python3', options.python)
  const node = resolveSystemExecutable('node', options.node)
  const { entry: pnpm, version: pnpmVersion } = resolveSystemPnpm(node, resolveSystemExecutable('pnpm', options.pnpm))
  const identity = targetIdentity(options.target)
  const manifest: PrimaryRuntimeManifest = {
    desktopVersion: options.version,
    ...identity,
    python: systemPythonVersion(python),
    node: systemNodeVersion(node),
    pnpm: pnpmVersion,
    pythonPackages: systemPythonDistributions(python),
    external: { python, pythonPackages: systemPythonPackages(python), node, pnpm },
  }
  const runtime = resolve(options.output)
  const destination = join(runtime, 'primary-runtime')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  writeFileSync(join(destination, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const require = createRequire(import.meta.url)
  await prepareOfficeSkillAssets(join(dirname(require.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'),
    join(runtime, 'office-skills'))
}

/**
 * Write the pnpm launcher that a system payload executes under its own Node.js.
 * @param root - Desktop runtime root receiving `pnpm/bin/pnpm.mjs`.
 * @param entry - Absolute system pnpm entry script.
 * @returns Absolute launcher path.
 */
export function writeSystemPnpmLauncher(root: string, entry: string): string {
  const launcher = join(root, 'pnpm', 'bin', 'pnpm.mjs')
  rmSync(join(root, 'pnpm'), { recursive: true, force: true })
  mkdirSync(dirname(launcher), { recursive: true })
  writeFileSync(launcher, `process.argv[1] = ${JSON.stringify(entry)}\nawait import(${JSON.stringify(pathToFileURL(entry).href)})\n`)
  return launcher
}

/** Build-only inputs shared by Desktop and SDK carriers. */
export interface PreparePrimaryRuntimeOptions {
  /** Target whose archives and wheels are downloaded. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** SHA-256-addressed archive cache. */
  readonly cache: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
  /** Omit Node.js and pnpm for carriers providing only Python. */
  readonly pythonOnly?: boolean
}

/**
 * Materialize locked interpreters, libraries and Office resources without executing target code.
 * @param options - Explicit target and carrier-owned output locations.
 * @returns Resolves after the complete payload and skills have been copied to the output directory.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions): Promise<void> {
  const { target } = options
  const paths = { runtime: resolve(options.output), downloads: resolve(options.cache) }
  const artifact = lock.targets[target]
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    let pnpmVersion: string | undefined
    if (!options.pythonOnly) {
      const nodeFilename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
      const nodeUrl = `https://nodejs.org/dist/v${lock.nodeVersion}/${nodeFilename}`
      const nodeArchive = await downloadPrimaryRuntimeAsset(nodeUrl, artifact.nodeSha256, paths.downloads,
        [`${NODE_DIST_MIRROR}/v${lock.nodeVersion}/${nodeFilename}`])
      const unpackedNode = join(staging, 'node')
      mkdirSync(unpackedNode)
      if (target === 'win-x64') await extractZip(nodeArchive, { dir: unpackedNode })
      else await extractTar({ file: nodeArchive, cwd: unpackedNode })
      const nodeSource = join(unpackedNode, nodeFilename.replace(/\.(?:zip|tar\.gz)$/u, ''))
      mkdirSync(join(dependencies, 'node', 'bin'), { recursive: true })
      mkdirSync(join(dependencies, 'node', 'node_modules'))
      writeFileSync(join(dependencies, 'node', 'node_modules', 'README.txt'), 'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
      cpSync(join(nodeSource, ...(target === 'win-x64' ? ['node.exe'] : ['bin', 'node'])),
        join(dependencies, 'node', 'bin', target === 'win-x64' ? 'node.exe' : 'node'))
      cpSync(join(nodeSource, 'LICENSE'), join(dependencies, 'node', 'LICENSE'))
      const require = createRequire(import.meta.url)
      const pnpmManifest = require.resolve('pnpm')
      pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
      await cp(dirname(pnpmManifest), join(dependencies, 'pnpm'), { recursive: true, dereference: true })
    }
    await extractTar({ file: await pythonArchive(target, paths.downloads), cwd: dependencies })
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: options.version,
      ...targetIdentity(target),
      payloadDigest: primaryRuntimePayloadDigest(target, lock, pnpmVersion),
      python: lock.pythonVersion,
      ...(pnpmVersion === undefined ? {} : { node: lock.nodeVersion, pnpm: pnpmVersion }),
      pythonPackages: lock.pythonPackages,
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const wheel of [...artifact.wheels, ...lock.wheels]) {
      await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads), entries.pythonPackages)
    }
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    await cp(output, destination, { recursive: true, dereference: true })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const require = createRequire(import.meta.url)
  await prepareOfficeSkillAssets(join(dirname(require.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'),
    join(paths.runtime, 'office-skills'))
}

/**
 * Execute the native payload's interpreters, package manager and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 * @param environment - Scrubbed subprocess environment; defaults to excluding credential-shaped names.
 */
export function smokePrimaryRuntime(root: string, environment: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)),
)): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  const external = manifest.external !== undefined
  const options = { stdio: 'inherit', timeout: 120_000, env: environment } as const
  execFileSync(entries.python, ['-I', '-B', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], options)
  execFileSync(entries.python, ['-I', '-B', join(import.meta.dirname, 'smoke.py'), JSON.stringify(manifest.pythonPackages),
    manifest.python, join(dirname(root), 'office-skills', 'scripts', 'check_office.py'), ...(external ? ['--external'] : [])], options)
  // A system interpreter has no closed distribution set to check; pip is not a declared dependency either.
  if (!external) execFileSync(entries.python, ['-I', '-B', '-m', 'pip', 'check'], options)
  if (entries.node !== undefined) execFileSync(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`], options)
  // A project package.json with a packageManager field would make pnpm switch to that version instead.
  if (entries.pnpm !== undefined && entries.node !== undefined) execFileSync(entries.node, [entries.pnpm, '--version'], { ...options, cwd: tmpdir() })
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
    'python-only': { type: 'boolean', default: false }, system: { type: 'boolean', default: false },
    python: { type: 'string' }, node: { type: 'string' }, pnpm: { type: 'string' },
  } })
  if (!values.target || !Object.hasOwn(lock.targets, values.target) || !values.output) {
    throw new Error(`Usage: pnpm run prepare:primary-runtime --target <${Object.keys(lock.targets).join('|')}> --output <directory> [--cache <directory>] [--python-only] [--system]`)
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  const output = resolve(values.output)
  if (values.system) {
    await prepareSystemPrimaryRuntime({
      target: values.target as PrimaryRuntimeTarget, output, version,
      python: values.python, node: values.node, pnpm: values.pnpm,
    })
  } else {
    await preparePrimaryRuntime({
      target: values.target as PrimaryRuntimeTarget, output,
      cache: values.cache ?? join(tmpdir(), 'dsh-primary-runtime-downloads'), version,
      pythonOnly: values['python-only'],
    })
  }
  smokePrimaryRuntime(join(output, 'primary-runtime'))
}
