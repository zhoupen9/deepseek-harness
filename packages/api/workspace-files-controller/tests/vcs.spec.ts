/** VCS (git) status decoration: pure snapshot parsing plus listing under a real repository. */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkspaceFilesController } from '../src/index.ts'
import { buildSnapshot } from '../src/vcs.ts'

describe('buildSnapshot', () => {
  it('collapses porcelain XY into the enum and maps absolute paths', () => {
    const output = [
      ' M mod.txt',
      'A  added.txt',
      '?? untracked.txt',
      '!! ignored.txt',
      'D  deleted.txt',
      'R  new.txt',
      'old.txt',
      'UU conflicted.txt',
    ].join('\0') + '\0'
    const snapshot = buildSnapshot('/repo', output, 100)
    expect(snapshot.statusByPath.get('/repo/mod.txt')).toBe('modified')
    expect(snapshot.statusByPath.get('/repo/added.txt')).toBe('added')
    expect(snapshot.statusByPath.get('/repo/untracked.txt')).toBe('untracked')
    expect(snapshot.statusByPath.get('/repo/ignored.txt')).toBe('ignored')
    expect(snapshot.statusByPath.get('/repo/deleted.txt')).toBe('deleted')
    expect(snapshot.statusByPath.get('/repo/new.txt')).toBe('renamed')
    expect(snapshot.statusByPath.get('/repo/conflicted.txt')).toBe('conflicted')
    // A rename's old-path segment is skipped, not treated as a status row.
    expect(snapshot.statusByPath.has('/repo/old.txt')).toBe(false)
  })

  it('marks ancestor directories dirty for notable paths, not ignored-only', () => {
    const output = ' M sub/deep/mod.txt\0!! sub/ignored.txt\0!! only-ignored/skip.txt\0'
    const snapshot = buildSnapshot('/repo', output, 100)
    expect(snapshot.dirtyDirs.has('/repo/sub')).toBe(true)
    expect(snapshot.dirtyDirs.has('/repo/sub/deep')).toBe(true)
    expect(snapshot.dirtyDirs.has('/repo/only-ignored')).toBe(false)
  })

  it('maps an entirely-ignored directory row onto its path as ignored, never a dirty ancestor', () => {
    const output = '!! build/\0 M sub/mod.txt\0'
    const snapshot = buildSnapshot('/repo', output, 100)
    expect(snapshot.statusByPath.get('/repo/build')).toBe('ignored')
    expect(snapshot.dirtyDirs.has('/repo/build')).toBe(false)
    expect(snapshot.dirtyDirs.has('/repo/sub')).toBe(true)
  })

  it('degrades to empty maps past maxDirtyPaths instead of reporting partial status', () => {
    const output = ' M a.txt\0 M b.txt\0 M c.txt\0'
    const snapshot = buildSnapshot('/repo', output, 2)
    expect(snapshot.statusByPath.size).toBe(0)
    expect(snapshot.dirtyDirs.size).toBe(0)
  })
})

let repo: string
let ctx: Context
let controller: WorkspaceFilesController

function agent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

function signal(): AbortSignal {
  return new AbortController().signal
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-vcs-'))
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.test'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
  await writeFile(join(repo, 'committed.txt'), 'base')
  execFileSync('git', ['-C', repo, 'add', 'committed.txt'])
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'init'])
  // Worktree changes after the commit.
  await writeFile(join(repo, 'committed.txt'), 'modified')
  await writeFile(join(repo, 'untracked.txt'), 'new')
  await writeFile(join(repo, '.gitignore'), '*.ignored\nignored-dir/\n')
  await writeFile(join(repo, 'skip.ignored'), 'x')
  await mkdir(join(repo, 'sub'))
  await writeFile(join(repo, 'sub', 'added.txt'), 'a')
  execFileSync('git', ['-C', repo, 'add', 'sub/added.txt'])
  await mkdir(join(repo, 'ignored-dir'))
  await writeFile(join(repo, 'ignored-dir', 'only.ignored'), 'x')

  ctx = new Context()
  controller = new WorkspaceFilesController(ctx, {
    maxEntries: 1000,
    maxBytes: 512 * 1024,
    vcs: { enabled: true, maxDirtyPaths: 20000 },
  })
})

afterAll(async () => {
  await ctx.fiber.dispose()
  await rm(repo, { recursive: true, force: true })
})

describe('WorkspaceFilesController VCS decoration', () => {
  it('annotates files and dirs under a git repo and reports the repo context', async () => {
    const listing = await controller.list(agent(repo), repo, signal())
    expect(listing.vcs).toEqual({ kind: 'git', root: repo, worktree: join(repo, '.git') })
    const byName = new Map(listing.entries.map(entry => [entry.name, entry]))
    expect(byName.get('committed.txt')?.vcs).toBe('modified')
    expect(byName.get('untracked.txt')?.vcs).toBe('untracked')
    expect(byName.get('skip.ignored')?.vcs).toBe('ignored')
    expect(byName.get('sub')?.vcsDirty).toBe(true)
    // An entirely-ignored directory is marked ignored and is never dirty.
    expect(byName.get('ignored-dir')?.vcs).toBe('ignored')
    expect(byName.get('ignored-dir')?.vcsDirty).toBeUndefined()
  })

  it('reports none outside a repository with no per-entry status', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-novcs-'))
    try {
      const listing = await controller.list(agent(outside), outside, signal())
      expect(listing.vcs.kind).toBe('none')
      expect(listing.entries.every(entry => entry.vcs === undefined && entry.vcsDirty === undefined)).toBe(true)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('reports error (not a throw) for a broken repository and still lists', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-broken-'))
    try {
      await mkdir(join(broken, '.git'))
      await writeFile(join(broken, 'file.txt'), 'content')
      const listing = await controller.list(agent(broken), broken, signal())
      expect(listing.vcs.kind).toBe('error')
      expect(listing.entries.map(entry => entry.name)).toContain('file.txt')
    } finally {
      await rm(broken, { recursive: true, force: true })
    }
  })

  it('serves sibling calls from one snapshot and recomputes after the TTL', async () => {
    const statusOf = async (): Promise<string | undefined> => {
      const listing = await controller.list(agent(repo), repo, signal())
      return listing.entries.find(entry => entry.name === 'committed.txt')?.vcs
    }
    expect(await statusOf()).toBe('modified')

    // Make the file clean; the cached snapshot still reports the prior state.
    execFileSync('git', ['-C', repo, 'add', 'committed.txt'])
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'second'])
    expect(await statusOf()).toBe('modified')

    // Past the TTL the next listing recomputes and sees the clean file.
    const realNow = Date.now
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow() + 5000)
    try {
      expect(await statusOf()).toBeUndefined()
    } finally {
      clock.mockRestore()
    }
  })
})
