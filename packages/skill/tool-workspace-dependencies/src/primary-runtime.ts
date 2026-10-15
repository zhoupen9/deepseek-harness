/** Primary runtime payload metadata and the interpreter paths it declares. */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Canonical build metadata, independent of user-installed packages; legacy files are normalized on read. */
export interface PrimaryRuntimeManifest {
  readonly desktopVersion: string
  readonly platform: string
  readonly arch: string
  /** Locked payload identity; absent only in installations made before payload hashing. */
  readonly payloadDigest?: string
  /** Bundled Python interpreter version. */
  readonly python: string
  /** Absent when the payload ships no Node.js. */
  readonly node?: string
  /** Bundled pnpm version; requires a bundled Node.js executable. */
  readonly pnpm?: string
  /** All recorded Python distribution versions; empty for legacy files without a distribution map. */
  readonly pythonPackages: Readonly<Record<string, string>>
  /**
   * Absolute system paths used instead of a bundled `dependencies/` tree. Absent for payloads that
   * carry their own interpreters, so existing carriers and their recorded manifests are unchanged.
   */
  readonly external?: ExternalPrimaryRuntime
}

/** Absolute system interpreter and package paths declared by a payload that bundles no interpreter tree. */
export interface ExternalPrimaryRuntime {
  /** System Python executable. */
  readonly python: string
  /** System Python `site-packages` directory. */
  readonly pythonPackages: string
  /** System Node.js executable; required when `pnpm` is declared. */
  readonly node?: string
  /** System Node.js global package directory. */
  readonly nodePackages?: string
  /** Host pnpm executable the payload's pnpm launcher starts, a script or a native image. */
  readonly pnpm?: string
}

/** Absolute entry points and bundled versions; pnpm runs through the returned Node executable. */
export interface WorkspaceDependencies {
  readonly python: string
  readonly node?: string
  readonly pnpm?: string
  readonly pythonPackages: string
  readonly nodePackages?: string
  /** Locked distribution versions; excludes packages users add to the installed environment. */
  readonly pythonDistributions: Readonly<Record<string, string>>
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u
const PLATFORMS = ['win32', 'darwin', 'linux']

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDistributionMap(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.entries(value).every(([name, version]) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)
    && typeof version === 'string' && /^\d[\w.!+-]*$/u.test(version))
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value)
}

function parseExternalPrimaryRuntime(value: unknown): ExternalPrimaryRuntime {
  if (!isRecord(value)) throw new Error('primary runtime: invalid metadata')
  const { python, pythonPackages, node, nodePackages, pnpm } = value
  if (!isAbsolutePath(python) || !isAbsolutePath(pythonPackages)
    || (node !== undefined && !isAbsolutePath(node))
    || (nodePackages !== undefined && (node === undefined || !isAbsolutePath(nodePackages)))
    || (pnpm !== undefined && (node === undefined || !isAbsolutePath(pnpm)))) {
    throw new Error('primary runtime: invalid metadata')
  }
  return {
    python, pythonPackages,
    ...(node === undefined ? {} : { node }),
    ...(nodePackages === undefined ? {} : { nodePackages }),
    ...(pnpm === undefined ? {} : { pnpm }),
  }
}

/**
 * Validate payload JSON and normalize legacy component fields to top-level versions.
 * @param value - Untrusted decoded runtime.json contents.
 * @returns Canonical metadata with one Python distribution map and no components field.
 * @throws For malformed or mixed formats, duplicate distribution names, or inconsistent legacy metadata.
 */
export function parsePrimaryRuntime(value: unknown): PrimaryRuntimeManifest {
  if (!isRecord(value)) throw new Error('primary runtime: invalid metadata')
  const legacy = value.components !== undefined
  const versions = legacy ? value.components : value
  if (!isRecord(versions) || (legacy && ['python', 'node', 'pnpm'].some(key => value[key] !== undefined))) {
    throw new Error('primary runtime: invalid metadata')
  }
  const { desktopVersion, platform, arch, payloadDigest } = value
  const external = value.external === undefined ? undefined : parseExternalPrimaryRuntime(value.external)
  const { python, node, pnpm } = versions
  const pythonPackages = value.pythonPackages === undefined && legacy ? {} : value.pythonPackages
  if (typeof desktopVersion !== 'string' || desktopVersion.length === 0
    || typeof platform !== 'string' || !PLATFORMS.includes(platform)
    || typeof arch !== 'string' || !['x64', 'arm64'].includes(arch)
    || !isVersion(python)
    || (node !== undefined && !isVersion(node))
    || (pnpm !== undefined && (!isVersion(pnpm) || node === undefined))
    || (payloadDigest !== undefined && (typeof payloadDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(payloadDigest)))
    || !isDistributionMap(pythonPackages)) {
    throw new Error('primary runtime: invalid metadata')
  }
  const entries = Object.entries(pythonPackages)
  const distributions = new Map(entries.map(([name, version]) => [name.toLowerCase().replace(/[-_.]+/gu, '-'), version]))
  if (distributions.size !== entries.length) throw new Error('primary runtime: invalid metadata')
  // Only the old on-disk format duplicates these versions. New manifests use the distribution map alone.
  if (legacy) {
    for (const name of ['numpy', 'pandas'] as const) {
      if (!isVersion(versions[name])) throw new Error('primary runtime: invalid metadata')
      const version = distributions.get(name)
      if (version !== undefined && version !== versions[name]) {
        throw new Error(`primary runtime: conflicting ${name} distribution version`)
      }
    }
  }
  return {
    desktopVersion, platform, arch,
    ...(payloadDigest === undefined ? {} : { payloadDigest }),
    python,
    ...(node === undefined ? {} : { node }),
    ...(pnpm === undefined ? {} : { pnpm }),
    pythonPackages,
    ...(external === undefined ? {} : { external }),
  }
}

/**
 * Read and normalize build metadata without rewriting the source file.
 * @param root - Installed or bundled primary runtime directory.
 * @returns Validated top-level versions and target identifiers, including for legacy components manifests.
 */
export async function readPrimaryRuntime(root: string): Promise<PrimaryRuntimeManifest> {
  const value: unknown = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))
  return parsePrimaryRuntime(value)
}

/**
 * Resolve platform-specific interpreter and library locations without changing the environment.
 * @param root - Absolute payload or installation directory.
 * @param manifest - Validated runtime metadata.
 * @returns Absolute paths for explicit script execution and recorded bundled Python versions.
 */
export function workspaceDependencyPaths(root: string, manifest: PrimaryRuntimeManifest): WorkspaceDependencies {
  if (manifest.external !== undefined) {
    const { python, pythonPackages, node, nodePackages, pnpm } = manifest.external
    return {
      python, pythonPackages,
      ...(node === undefined ? {} : { node }),
      // A system payload ships a launcher for the host pnpm, which may be a native image the
      // declared Node.js executable cannot import.
      ...(pnpm === undefined ? {} : { pnpm: join(root, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') }),
      ...(nodePackages === undefined ? {} : { nodePackages }),
      pythonDistributions: manifest.pythonPackages,
    }
  }
  const dependencies = join(root, 'dependencies')
  const windows = manifest.platform === 'win32'
  const node = manifest.node === undefined ? {} : {
    node: join(dependencies, 'node', 'bin', windows ? 'node.exe' : 'node'),
    nodePackages: join(dependencies, 'node', 'node_modules'),
  }
  const pnpm = manifest.pnpm === undefined ? {} : { pnpm: join(dependencies, 'pnpm', 'bin', 'pnpm.mjs') }
  return {
    python: join(dependencies, 'python', ...(windows ? ['python.exe'] : ['bin', 'python3'])),
    ...node,
    ...pnpm,
    pythonPackages: join(dependencies, 'python', ...(windows ? ['Lib'] : ['lib', `python${manifest.python.split('.').slice(0, 2).join('.')}`]), 'site-packages'),
    pythonDistributions: manifest.pythonPackages,
  }
}
