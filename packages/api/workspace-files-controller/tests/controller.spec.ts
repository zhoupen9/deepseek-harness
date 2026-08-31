/** Behavior of the workspace-files controller over a real temporary directory tree. */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WorkspaceFilesController, WorkspaceFilesError, boundedInsert, fullyQualified } from '../src/index.ts'
import type { Candidate } from '../src/index.ts'

let root: string
let outside: string
let ctx: Context
let controller: WorkspaceFilesController

function fakeAgent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

const agent = (): Agent => fakeAgent(root)

/** VCS disabled for the non-VCS listing/read tests. */
const VCS_OFF = { enabled: false, maxDirtyPaths: 20000 }

/** A controller over its own context; the caller disposes the returned fiber. */
function scopedController(
  config: { maxEntries: number; maxBytes: number; vcs: { enabled: boolean; maxDirtyPaths: number } },
): { controller: WorkspaceFilesController; dispose: () => Promise<void> } {
  const scoped = new Context()
  const scopedController = new WorkspaceFilesController(scoped, config)
  return { controller: scopedController, dispose: () => scoped.fiber.dispose() }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-'))
  outside = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-outside-'))
  await mkdir(join(root, 'sub'))
  await mkdir(join(root, 'dir-a'))
  await mkdir(join(root, 'dir-b'))
  await mkdir(join(root, '.hidden-dir'))
  await writeFile(join(root, 'sub', 'notes.txt'), 'hello\nworld\n')
  await writeFile(join(root, 'z-file.txt'), 'plain text')
  await writeFile(join(root, '.hidden-file'), 'hidden')
  await writeFile(join(root, 'big.txt'), 'x'.repeat(64))
  await writeFile(join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x80]))
  await writeFile(join(outside, 'secret.txt'), 'outside content')
  await symlink(join(root, 'dir-a'), join(root, 'link-dir'))
  await symlink(join(outside, 'secret.txt'), join(root, 'link-out'))
  await symlink(join(root, 'gone'), join(root, 'broken-link'))

  ctx = new Context()
  controller = new WorkspaceFilesController(ctx, { maxEntries: 1000, maxBytes: 512 * 1024, vcs: VCS_OFF })
})

afterAll(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('WorkspaceFilesController.list', () => {
  it('lists directories first then files, flags hidden rows, follows symlinks, keeps broken links as bare files', async () => {
    const listing = await controller.list(agent(), root, new AbortController().signal)
    expect(listing.path).toBe(root)
    expect(listing.home).toBe(homedir())
    expect(listing.entries.map(entry => entry.name)).toEqual([
      '.hidden-dir', 'dir-a', 'dir-b', 'link-dir', 'sub',
      '.hidden-file', 'big.txt', 'binary.bin', 'broken-link', 'link-out', 'z-file.txt',
    ])
    expect(listing.entries.map(entry => entry.kind)).toEqual([
      'dir', 'dir', 'dir', 'dir', 'dir',
      'file', 'file', 'file', 'file', 'file', 'file',
    ])
    expect(listing.entries.map(entry => entry.hidden)).toEqual([
      true, false, false, false, false,
      true, false, false, false, false, false,
    ])
    // The broken symlink stays a file with no size/mtime; regular files carry both.
    const broken = listing.entries.find(entry => entry.name === 'broken-link')!
    expect(broken.size).toBeUndefined()
    expect(broken.modifiedAt).toBeUndefined()
    const big = listing.entries.find(entry => entry.name === 'big.txt')!
    expect(big.size).toBe(64)
    expect(big.modifiedAt).toBeTypeOf('number')
    // Every entry path is absolute and host-joined — clients never join segments.
    expect(listing.entries.every(entry => entry.path === join(root, entry.name))).toBe(true)
    expect(listing.truncated).toBe(false)
  })

  it('lists the workspace root when no path is given', async () => {
    const listing = await controller.list(agent(), undefined, new AbortController().signal)
    expect(listing.path).toBe(root)
  })

  it('cuts a level at maxEntries keeping the dirs-first head, and flags the cut', async () => {
    const bounded = scopedController({ maxEntries: 2, maxBytes: 512 * 1024, vcs: VCS_OFF })
    try {
      const cut = await bounded.controller.list(agent(), root, new AbortController().signal)
      expect(cut.entries.map(entry => entry.name)).toEqual(['.hidden-dir', 'dir-a'])
      expect(cut.truncated).toBe(true)
    } finally {
      await bounded.dispose()
    }
  })

  it('reports the ancestry as dir-kind crumbs ending at the listed directory', async () => {
    const listing = await controller.list(agent(), join(root, 'sub'), new AbortController().signal)
    const tail = listing.crumbs.at(-1)!
    expect(tail).toMatchObject({ name: 'sub', path: join(root, 'sub'), kind: 'dir', hidden: false })
    expect(listing.crumbs.at(-2)!.path).toBe(root)
    // The chain starts at the filesystem root, whose crumb is labeled by its full path.
    expect(listing.crumbs[0]!.name).toBe(listing.crumbs[0]!.path)
  })
})

describe('WorkspaceFilesController.read', () => {
  it('returns decoded text with size, line count, and no truncation or binary flags', async () => {
    const content = await controller.read(agent(), join(root, 'sub', 'notes.txt'), new AbortController().signal)
    expect(content).toEqual({
      path: join(root, 'sub', 'notes.txt'),
      size: 'hello\nworld\n'.length,
      binary: false,
      truncated: false,
      content: 'hello\nworld\n',
      totalLines: 2,
    })
  })

  it('truncates a file larger than maxBytes and reports it', async () => {
    const bounded = scopedController({ maxEntries: 1000, maxBytes: 10, vcs: VCS_OFF })
    try {
      const content = await bounded.controller.read(agent(), join(root, 'big.txt'), new AbortController().signal)
      expect(content.truncated).toBe(true)
      expect(content.content).toBe('x'.repeat(10))
      expect(content.size).toBe(64)
    } finally {
      await bounded.dispose()
    }
  })

  it('reports binary files with empty content and zero lines', async () => {
    const content = await controller.read(agent(), join(root, 'binary.bin'), new AbortController().signal)
    expect(content.binary).toBe(true)
    expect(content.content).toBe('')
    expect(content.totalLines).toBe(0)
  })

  it('counts a trailing newline as a terminator, not an extra line', async () => {
    await writeFile(join(root, 'one-line.txt'), 'a\n')
    const content = await controller.read(agent(), join(root, 'one-line.txt'), new AbortController().signal)
    expect(content.totalLines).toBe(1)
  })
})

describe('WorkspaceFilesController fence', () => {
  it('refuses a path outside the workspace root', async () => {
    await expect(controller.list(agent(), '/etc', new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/path-outside-root', details: { path: '/etc' } })
  })

  it('refuses a read of a symlink that resolves outside the root, while still listing it', async () => {
    const listing = await controller.list(agent(), root, new AbortController().signal)
    expect(listing.entries.map(entry => entry.name)).toContain('link-out')
    await expect(controller.read(agent(), join(root, 'link-out'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/path-outside-root' })
  })

  it('refuses non-fully-qualified paths instead of rebasing them under the process cwd', async () => {
    for (const relative of ['', 'sub', './sub', '..']) {
      const listFailure = await controller.list(agent(), relative, new AbortController().signal).catch((error: unknown) => error)
      expect(listFailure).toMatchObject({ code: 'workspace-files/path-unreadable' })
    }
  })

  it('refuses a read of a directory and a missing file', async () => {
    await expect(controller.read(agent(), join(root, 'dir-a'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/file-unreadable' })
    await expect(controller.read(agent(), join(root, 'no-such-file'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/path-not-found' })
  })

  it('refuses a read of a broken link', async () => {
    await expect(controller.read(agent(), join(root, 'broken-link'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/file-unreadable' })
  })

  it('maps a missing list target to workspace-files/path-not-found', async () => {
    await expect(controller.list(agent(), join(root, 'no-such-dir'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace-files/path-not-found' })
  })
})

describe('WorkspaceFilesController abort', () => {
  it('answers an aborted scan with the cancelled code and swallows the abandoned settlement', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('caller left'))
    await expect(controller.list(agent(), root, aborted.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    await expect(controller.read(agent(), join(root, 'big.txt'), aborted.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    // Give the abandoned realpath/read settlements a turn to surface as
    // unhandled rejections; raceAbort swallows them.
    await new Promise(resolve => setTimeout(resolve, 10))
  })
})

describe('WorkspaceFilesController helpers', () => {
  it('throws a typed WorkspaceFilesError carrying its code and path', () => {
    const error = new WorkspaceFilesError('workspace-files/path-outside-root', '/etc', 'outside')
    expect(error.code).toBe('workspace-files/path-outside-root')
    expect(error.path).toBe('/etc')
    expect(error.name).toBe('WorkspaceFilesError')
  })

  it('boundedInsert keeps the window canonically sorted (dirs first) and bounded, reporting evictions', () => {
    const candidate = (name: string, kind: 'dir' | 'file' = 'file'): Candidate => ({ name, kind, hidden: false, needsStat: false })
    const window: Candidate[] = []
    expect(boundedInsert(window, candidate('m'), 2)).toBe(false)
    expect(boundedInsert(window, candidate('z'), 2)).toBe(false)
    // A directory outranks an earlier file regardless of name.
    expect(boundedInsert(window, candidate('zzz', 'dir'), 2)).toBe(true)
    expect(window.map(entry => entry.name)).toEqual(['zzz', 'm'])
    // A name at or beyond the full window's tail rejects on one comparison.
    expect(boundedInsert(window, candidate('t'), 2)).toBe(true)
    expect(window.map(entry => entry.name)).toEqual(['zzz', 'm'])
  })

  it('classifies fully qualified paths per platform (drive-less rooted Windows forms rejected)', () => {
    expect(fullyQualified('/home/x', 'linux')).toBe(true)
    expect(fullyQualified('x/y', 'darwin')).toBe(false)
    expect(fullyQualified('C:\\projects', 'win32')).toBe(true)
    expect(fullyQualified('C:/projects', 'win32')).toBe(true)
    expect(fullyQualified('\\\\server\\share', 'win32')).toBe(true)
    expect(fullyQualified('\\foo', 'win32')).toBe(false)
    expect(fullyQualified('/foo', 'win32')).toBe(false)
    expect(fullyQualified('C:relative', 'win32')).toBe(false)
  })
})
