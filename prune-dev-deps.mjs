#!/usr/bin/env node
// prune-dev-deps.mjs — slim a pnpm workspace build tree for shipping.
//
// Usage: node prune-dev-deps.mjs <workspaceRoot>
//
// Three jobs, in order:
//   1. Prune dev-only packages from node_modules/.pnpm. The runtime closure is
//      rooted at apps/cli (the `dsh` bin); the desktop application ships its
//      own bundled runtime, so it contributes no root. Every store entry
//      unreachable from those roots through
//      dependencies/optionalDependencies/peerDependencies is deleted. A few
//      peer-dependency names are type-checking-only and never keep an entry
//      (see NEVER_RUNTIME_PEERS).
//   2. Strip prebuilt native binaries for platforms the target cannot run
//      (e.g. node-pty ships win32/darwin prebuilds beside the linux one).
//   3. Delete non-runtime workspace members outright, and strip source/tests/
//      build metadata from the members that remain, so the shipped tree holds
//      only runtime artifacts (lib/, package.json, cordis yml, presets, dist).
//
// Set DSH_DRY_RUN=1 to report what would be removed without deleting anything.
// Set DSH_TARGET_ARCH=x64|arm64 to choose which linux prebuilds to keep
// (defaults to process.arch, which matches a native makepkg build).

import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  readFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? '.')
const PNPM_DIR = join(ROOT, 'node_modules', '.pnpm')
const DRY_RUN = process.env.DSH_DRY_RUN === '1'
const TARGET_ARCH = process.env.DSH_TARGET_ARCH ?? process.arch

/** Runtime entry points (workspace projects) whose prod closure must be kept. */
const RUNTIME_ROOTS = [
  join(ROOT, 'apps', 'cli'),
]

/**
 * Peer-dependency names that exist only for type-checking and must never keep
 * a store entry. Meta's `lexical` lists `typescript` as a peer; it is
 * bundled away at web build time and never loaded by the shipped runtime.
 */
const NEVER_RUNTIME_PEERS = new Set(['typescript'])

/** Prod-relevant dependency names of a package.json (peers included). */
function prodNames(pkg) {
  const names = new Set()
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[key]
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      if (key === 'peerDependencies' && NEVER_RUNTIME_PEERS.has(name)) continue
      names.add(name)
    }
  }
  return names
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Canonical (symlink-resolved) path, falling back to lexical resolve. */
function realpath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** True when `path` names a directory that is not a symlink. */
function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The .pnpm entry directory containing `path`, if any. */
function pnpmEntryOf(path) {
  const rel = relative(PNPM_DIR, path)
  if (rel.startsWith('..') || rel === '') return undefined
  const first = rel.split('/')[0]
  return first === '' ? undefined : join(PNPM_DIR, first)
}

/** Package name of a .pnpm entry directory name (@scope+name@ver → @scope/name). */
function entryPackageName(entryName) {
  const scoped = entryName.startsWith('@')
  const at = scoped ? entryName.indexOf('@', 1) : entryName.indexOf('@')
  const raw = at === -1 ? entryName : entryName.slice(0, at)
  return raw.replace(/\+/g, '/')
}

/** Disk usage in bytes, without following symlinks (DRY_RUN accounting only). */
function duBytes(path) {
  let total = 0
  const stack = [path]
  while (stack.length > 0) {
    const p = stack.pop()
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isFile()) {
      total += st.size
      continue
    }
    let entries
    try {
      entries = readdirSync(p)
    } catch {
      continue
    }
    for (const e of entries) stack.push(join(p, e))
  }
  return total
}

/** Delete-or-account counters, so DSH_DRY_RUN reports without mutating. */
const removedBytes = { value: 0 }
const removedKinds = new Map()
function prune(path, kind) {
  removedKinds.set(kind, (removedKinds.get(kind) ?? 0) + 1)
  if (DRY_RUN) {
    removedBytes.value += duBytes(path)
    return
  }
  rmSync(path, { recursive: true, force: true })
}

function fmtBytes(n) {
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * Delete foreign-platform prebuilt binaries from a KEPT store entry. Only the
 * target's own platform directories survive; everything else is dead weight
 * (node-pty alone ships ~24 MB of win32 prebuilds).
 */
function stripForeignPrebuilds(entry) {
  const nm = join(entry, 'node_modules')
  if (!existsSync(nm)) return
  for (const pkgName of readdirSync(nm)) {
    const prebuilds = join(nm, pkgName, 'prebuilds')
    if (!isDir(prebuilds)) continue
    for (const platform of readdirSync(prebuilds)) {
      if (isForeignPlatform(platform)) prune(join(prebuilds, platform), 'foreign prebuild')
    }
  }
}

function isForeignPlatform(name) {
  if (name.startsWith('win32-') || name.startsWith('darwin-')) return true
  if (name.startsWith('linux-')) {
    return !(name === `linux-${TARGET_ARCH}` || name.startsWith(`linux-${TARGET_ARCH}-`))
  }
  return false
}

/** Enumerate workspace member project dirs (vendor, packages/group, apps). */
function enumerateMembers() {
  const dirs = []
  const push = (d) => {
    if (existsSync(join(d, 'package.json'))) dirs.push(realpath(d))
  }
  if (existsSync(join(ROOT, 'vendor'))) {
    for (const n of readdirSync(join(ROOT, 'vendor'))) push(join(ROOT, 'vendor', n))
  }
  if (existsSync(join(ROOT, 'packages'))) {
    for (const group of readdirSync(join(ROOT, 'packages'))) {
      const gp = join(ROOT, 'packages', group)
      if (!isDir(gp)) continue
      for (const n of readdirSync(gp)) push(join(gp, n))
    }
  }
  if (existsSync(join(ROOT, 'apps'))) {
    for (const n of readdirSync(join(ROOT, 'apps'))) push(join(ROOT, 'apps', n))
  }
  return dirs
}

/**
 * Walk files under `dir` without descending into node_modules or following
 * symlinks, calling `fn(path)` for each regular file.
 */
function walkFiles(dir, fn) {
  const stack = [dir]
  while (stack.length > 0) {
    const d = stack.pop()
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules') continue
      const p = join(d, ent.name)
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) stack.push(p)
      else if (ent.isFile()) fn(p)
    }
  }
}

/**
 * Strip source, tests, and build metadata from a runtime workspace member. The
 * runtime resolves everything through the built `lib/` (or `dist/` for the
 * web frontend); `src/`, `tests/`, `.tsbuildinfo`, and source maps match
 * the npm `files` publish surface, which also omits them.
 */
function stripProjectArtifacts(project) {
  for (const sub of ['src', 'tests']) {
    const p = join(project, sub)
    if (existsSync(p)) prune(p, 'src/tests dir')
  }
  walkFiles(project, (p) => {
    if (p.endsWith('.tsbuildinfo') || p.endsWith('.map')) prune(p, 'tsbuildinfo/map')
  })
}

/**
 * Remove non-runtime workspace members entirely and slim the runtime members.
 * `scannedProjects` is the exact set of workspace projects reachable from the
 * two runtime roots, so anything outside it is a build/test-only member.
 */
function cleanWorkspaceMembers(scannedProjects) {
  for (const member of enumerateMembers()) {
    if (scannedProjects.has(member)) stripProjectArtifacts(member)
    else prune(member, 'non-runtime member')
  }
}

function main() {
  if (!existsSync(PNPM_DIR)) throw new Error(`no .pnpm store under ${ROOT}`)

  const marked = new Set()      // absolute .pnpm entry dirs that must stay
  const devLinks = []           // absolute symlink paths (dev position) to remove
  const queue = []              // { kind: 'project' | 'entry', path }
  const scannedProjects = new Set()
  const scannedEntries = new Set()

  for (const p of RUNTIME_ROOTS) {
    if (existsSync(join(p, 'package.json'))) queue.push({ kind: 'project', path: realpath(p) })
  }

  /**
   * Follow one symlink `linkPath` named `linkName` (e.g. "zod" or
   * "@scope/name"). `prodSet` is the owning package's prod names. `inProject`
   * is true for links inside a workspace project (dev links there must be
   * removed explicitly); false for links inside a .pnpm entry (they dangle
   * harmlessly once their target entry is deleted).
   */
  function markEdge(linkPath, linkName, prodSet, inProject) {
    let target
    try {
      target = resolve(dirname(linkPath), readlinkSync(linkPath))
    } catch {
      return
    }
    if (!prodSet.has(linkName)) {
      if (inProject) devLinks.push(linkPath)
      return
    }
    const entry = pnpmEntryOf(target)
    if (entry !== undefined) {
      marked.add(entry)
      queue.push({ kind: 'entry', path: entry })
    } else {
      const project = realpath(target)
      if (existsSync(join(project, 'package.json'))) {
        queue.push({ kind: 'project', path: project })
      }
    }
  }

  /** Walk <dir>/node_modules of one package; follow prod edges. */
  function scanNodeModules(nodeModules, prodSet, inProject) {
    if (!existsSync(nodeModules)) return
    for (const scope of readdirSync(nodeModules, { withFileTypes: true })) {
      if (scope.name === '.bin' || scope.name === '.modules.yaml') continue
      if (scope.name.startsWith('@')) {
        const scopeDir = join(nodeModules, scope.name)
        if (!isDir(scopeDir)) continue
        for (const name of readdirSync(scopeDir)) {
          const p = join(scopeDir, name)
          if (lstatSync(p).isSymbolicLink()) markEdge(p, scope.name + '/' + name, prodSet, inProject)
        }
      } else if (scope.isSymbolicLink()) {
        markEdge(join(nodeModules, scope.name), scope.name, prodSet, inProject)
      }
    }
  }

  while (queue.length > 0) {
    const item = queue.pop()
    if (item.kind === 'project') {
      if (scannedProjects.has(item.path)) continue
      scannedProjects.add(item.path)
      const pkg = readJson(join(item.path, 'package.json'))
      const prodSet = pkg ? prodNames(pkg) : new Set()
      scanNodeModules(join(item.path, 'node_modules'), prodSet, true)
    } else {
      if (scannedEntries.has(item.path)) continue
      scannedEntries.add(item.path)
      const pkgName = entryPackageName(item.path.split('/').pop())
      const pkg = readJson(join(item.path, 'node_modules', pkgName, 'package.json'))
      const prodSet = pkg ? prodNames(pkg) : new Set()
      scanNodeModules(join(item.path, 'node_modules'), prodSet, false)
    }
  }

  // Strip foreign prebuilds from the entries that survive (before deleting the
  // unmarked ones, so the kept set is fully known).
  for (const entry of marked) stripForeignPrebuilds(entry)

  // Delete unmarked .pnpm entries (keep the hoisted node_modules dir itself).
  for (const ent of readdirSync(PNPM_DIR)) {
    const full = join(PNPM_DIR, ent)
    if (ent === 'node_modules' || marked.has(full)) continue
    prune(full, 'store entry')
  }

  // Delete dev links, then any symlink left dangling.
  function pruneDangling(dir) {
    const stack = [dir]
    while (stack.length > 0) {
      const d = stack.pop()
      let entries
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const p = join(d, ent.name)
        let st
        try {
          st = lstatSync(p)
        } catch {
          continue
        }
        if (st.isSymbolicLink()) {
          try {
            statSync(p)
          } catch {
            prune(p, 'dangling link')
          }
        } else if (st.isDirectory() && ent.name !== '.pnpm') {
          stack.push(p)
        }
      }
    }
  }
  for (const link of devLinks) prune(link, 'dev link')
  pruneDangling(join(ROOT, 'node_modules'))
  pruneDangling(join(PNPM_DIR, 'node_modules'))
  for (const project of scannedProjects) {
    pruneDangling(join(project, 'node_modules'))
  }

  // Finally, drop non-runtime members and slim the ones that remain.
  cleanWorkspaceMembers(scannedProjects)

  const total = DRY_RUN ? removedBytes.value : undefined
  const verb = DRY_RUN ? 'would remove' : 'removed'
  console.error(
    `prune-dev-deps: ${verb} ${removedKinds.size} kinds` +
      (total === undefined ? '' : ` (${fmtBytes(total)})`) +
      ` from ${ROOT}`,
  )
  for (const [kind, count] of [...removedKinds.entries()].sort()) {
    console.error(`  ${kind}: ${count}`)
  }
}

main()
