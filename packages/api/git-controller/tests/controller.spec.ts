/** Behavior of the git controller over real temporary git repositories. */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { GitController, GitError, parseLog, parseNameStatus, parseRefs } from '../src/index.ts'

function agent(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

function signal(): AbortSignal {
  return new AbortController().signal
}

/** Run git in the repo (tests build the repo, not read it). */
function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

describe('parseRefs', () => {
  it('folds HEAD -> branch and full refs to short name plus kind, dropping unknown shapes', () => {
    expect(parseRefs('HEAD -> main, refs/remotes/origin/main, refs/tags/v1.2, refs/heads/feature'))
      .toEqual([
        { name: 'HEAD', kind: 'head' },
        { name: 'main', kind: 'branch' },
        { name: 'origin/main', kind: 'remote' },
        { name: 'v1.2', kind: 'tag' },
        { name: 'feature', kind: 'branch' },
      ])
    expect(parseRefs('')).toEqual([])
    expect(parseRefs('HEAD')).toEqual([{ name: 'HEAD', kind: 'head' }])
    expect(parseRefs('unknown-shape, tag: v9')).toEqual([{ name: 'v9', kind: 'tag' }])
  })
})

describe('parseLog', () => {
  it('parses NUL-delimited records newest-first, parents, seconds, and refs', () => {
    const stdout = [
      'hashA', 'hashB', 'Alice', 'alice@example.test', '1700000000', 'second', 'HEAD -> refs/heads/main',
      '',
      'hashB', '', 'Bob', 'bob@example.test', '1600000000', 'first', '',
      '',
    ].join('\0')
    expect(parseLog(stdout)).toEqual([
      {
        hash: 'hashA',
        parents: ['hashB'],
        authorName: 'Alice',
        authorEmail: 'alice@example.test',
        authorTime: 1700000000000,
        subject: 'second',
        refs: [{ name: 'HEAD', kind: 'head' }, { name: 'main', kind: 'branch' }],
      },
      {
        hash: 'hashB',
        parents: [],
        authorName: 'Bob',
        authorEmail: 'bob@example.test',
        authorTime: 1600000000000,
        subject: 'first',
        refs: [],
      },
    ])
  })

  it('splits a merge commit parent list into ordered parent ids', () => {
    const stdout = ['m', 'p1 p2', 'A', 'a@e.t', '1700000000', 'merge', '', ''].join('\0')
    expect(parseLog(stdout)[0]!.parents).toEqual(['p1', 'p2'])
  })
})

describe('parseNameStatus', () => {
  it('folds name-status codes and pairs rename old/new paths', () => {
    expect(parseNameStatus('M\ta.txt\nD\tb.txt\nR100\tc.txt\td.txt\nA\te.txt\n')).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'b.txt', status: 'deleted' },
      { path: 'd.txt', status: 'renamed', previousPath: 'c.txt' },
      { path: 'e.txt', status: 'added' },
    ])
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus('X\tunknown.txt\n')).toEqual([])
  })
})

describe('GitError', () => {
  it('carries its code and details', () => {
    const error = new GitError('git/outside-root', { path: '/elsewhere/.git' }, 'escapes')
    expect(error.code).toBe('git/outside-root')
    expect(error.details).toEqual({ path: '/elsewhere/.git' })
    expect(error.name).toBe('GitError')
  })
})

let repo: string
let outside: string
let ctx: Context
let controller: GitController

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'dsh-git-'))
  outside = await mkdtemp(join(tmpdir(), 'dsh-git-outside-'))
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 't@example.test'])
  git(repo, ['config', 'user.name', 't'])
  git(repo, ['branch', '-M', 'main'])
  await writeFile(join(repo, 'a.txt'), 'a')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-qm', 'root'])
  git(repo, ['checkout', '-qb', 'side'])
  await writeFile(join(repo, 'side.txt'), 'side')
  git(repo, ['add', 'side.txt'])
  git(repo, ['commit', '-qm', 'side work'])
  git(repo, ['checkout', '-q', 'main'])
  await writeFile(join(repo, 'main.txt'), 'main')
  git(repo, ['add', 'main.txt'])
  git(repo, ['commit', '-qm', 'main work'])
  git(repo, ['merge', '--no-edit', '-q', 'side'])

  ctx = new Context()
  controller = new GitController(ctx, { maxCount: 200, all: false, firstParent: true, maxDiffBytes: 1024 * 1024 })
})

afterAll(async () => {
  await ctx.fiber.dispose()
  await rm(repo, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('GitController.log', () => {
  it('returns the first-parent mainline newest-first with hash, parents, author, subject, and refs', async () => {
    const result = await controller.log(agent(repo), undefined, signal())
    expect(result.vcs).toEqual({ kind: 'git', root: repo, worktree: join(repo, '.git') })
    expect(result.currentBranch).toBe('main')
    expect(result.headHash).toMatch(/^[0-9a-f]{40}$/)
    expect(result.truncated).toBe(false)
    // First-parent view: the mainline only; the side branch is omitted.
    expect(result.commits.length).toBe(3)
    expect(result.commits.map(commit => commit.subject)).toContain('main work')
    expect(result.commits.map(commit => commit.subject)).toContain('root')
    expect(result.commits.map(commit => commit.subject)).not.toContain('side work')
    // The merge is collapsed to its first parent, which is the next commit.
    const merge = result.commits[0]!
    expect(merge.parents.length).toBe(1)
    expect(merge.parents[0]).toBe(result.commits[1]!.hash)
    expect(merge.refs).toContainEqual({ name: 'HEAD', kind: 'head' })
    expect(merge.refs).toContainEqual({ name: 'main', kind: 'branch' })
    for (const commit of result.commits) {
      expect(commit.hash).toMatch(/^[0-9a-f]{40}$/)
      expect(commit.authorName).toBe('t')
      expect(commit.authorEmail).toBe('t@example.test')
      expect(commit.authorTime).toBeTypeOf('number')
    }
  })

  it('shows full topology (merge with two parents and the side branch) when firstParent is false', async () => {
    const result = await controller.log(agent(repo), { firstParent: false }, signal())
    expect(result.commits.length).toBe(4)
    expect(result.commits.map(commit => commit.subject)).toContain('side work')
    const merge = result.commits[0]!
    expect(merge.parents.length).toBe(2)
  })

  it('reports the repo root above a subdirectory cwd', async () => {
    const subdir = join(repo, 'subdir')
    await mkdir(subdir)
    const result = await controller.log(agent(subdir), undefined, signal())
    expect(result.vcs).toEqual({ kind: 'git', root: repo, worktree: join(repo, '.git') })
    expect(result.commits.length).toBe(3)
  })

  it('resolves none outside any repository', async () => {
    const result = await controller.log(agent(outside), undefined, signal())
    expect(result.vcs).toEqual({ kind: 'none' })
    expect(result.commits).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('resolves error for a broken repository without throwing', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'dsh-git-broken-'))
    try {
      await mkdir(join(broken, '.git'))
      await writeFile(join(broken, 'file.txt'), 'x')
      const result = await controller.log(agent(broken), undefined, signal())
      expect(result.vcs.kind).toBe('error')
      expect(result.commits).toEqual([])
    } finally {
      await rm(broken, { recursive: true, force: true })
    }
  })

  it('treats a gitlink resolving outside the fence as none', async () => {
    const gitlink = await mkdtemp(join(tmpdir(), 'dsh-git-link-'))
    try {
      await writeFile(join(gitlink, '.git'), 'gitdir: ' + join(repo, '.git') + '\n')
      const result = await controller.log(agent(gitlink), undefined, signal())
      expect(result.vcs).toEqual({ kind: 'none' })
      expect(result.commits).toEqual([])
    } finally {
      await rm(gitlink, { recursive: true, force: true })
    }
  })

  it('throws git/outside-root when a gitlink target realpaths outside the fence', async () => {
    const gitlink = await mkdtemp(join(tmpdir(), 'dsh-git-escape-'))
    try {
      await symlink(join(repo, '.git'), join(gitlink, 'gitdir-link'))
      await writeFile(join(gitlink, '.git'), 'gitdir: ' + join(gitlink, 'gitdir-link') + '\n')
      await expect(controller.log(agent(gitlink), undefined, signal()))
        .rejects.toMatchObject({ code: 'git/outside-root' })
    } finally {
      await rm(gitlink, { recursive: true, force: true })
    }
  })

  it('cuts the window at maxCount and flags the cut', async () => {
    const bounded = new Context()
    const small = new GitController(bounded, { maxCount: 2, all: false, firstParent: true, maxDiffBytes: 1024 * 1024 })
    try {
      const result = await small.log(agent(repo), undefined, signal())
      expect(result.commits.length).toBe(2)
      expect(result.truncated).toBe(true)
    } finally {
      await bounded.fiber.dispose()
    }
  })

  it('answers an aborted signal with the cancelled code', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('caller left'))
    await expect(controller.log(agent(repo), undefined, aborted.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    // Give the abandoned realpath settlement a turn to surface as an unhandled rejection.
    await new Promise(resolve => setTimeout(resolve, 10))
  })
})

describe('GitController.show', () => {
  let showRepo: string
  let showCtx: Context
  let showController: GitController
  let showHead: string

  beforeAll(async () => {
    showRepo = await mkdtemp(join(tmpdir(), 'dsh-git-show-'))
    git(showRepo, ['init', '-q'])
    git(showRepo, ['config', 'user.email', 't@example.test'])
    git(showRepo, ['config', 'user.name', 't'])
    git(showRepo, ['branch', '-M', 'main'])
    await writeFile(join(showRepo, 'a.txt'), 'a1\n')
    await writeFile(join(showRepo, 'b.txt'), 'b1\n')
    await writeFile(join(showRepo, 'c.txt'), 'c1\n')
    git(showRepo, ['add', '-A'])
    git(showRepo, ['commit', '-qm', 'root'])
    await writeFile(join(showRepo, 'a.txt'), 'a1\na2\n')
    git(showRepo, ['rm', '-q', 'b.txt'])
    git(showRepo, ['mv', 'c.txt', 'd.txt'])
    await writeFile(join(showRepo, 'e.txt'), 'e1\n')
    git(showRepo, ['add', '-A'])
    git(showRepo, ['commit', '-m', 'title line', '-m', 'body line one'])
    showHead = git(showRepo, ['rev-parse', 'HEAD']).trim()

    showCtx = new Context()
    showController = new GitController(showCtx, { maxCount: 200, all: false, firstParent: true, maxDiffBytes: 1024 * 1024 })
  })

  afterAll(async () => {
    await showCtx.fiber.dispose()
    await rm(showRepo, { recursive: true, force: true })
  })

  it('returns the full message, committer, changed files, and patch', async () => {
    const result = await showController.show(agent(showRepo), showHead, signal())
    expect(result.vcs).toEqual({ kind: 'git', root: showRepo, worktree: join(showRepo, '.git') })
    expect(result.commit?.subject).toBe('title line')
    expect(result.commit?.body).toBe('body line one')
    expect(result.commit?.committerName).toBe('t')
    expect(result.commit?.committerEmail).toBe('t@example.test')
    expect(result.commit?.committerTime).toBeTypeOf('number')
    expect(result.commit?.parents.length).toBe(1)
    expect(result.files).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'b.txt', status: 'deleted' },
      { path: 'd.txt', status: 'renamed', previousPath: 'c.txt' },
      { path: 'e.txt', status: 'added' },
    ])
    expect(result.diff).toContain('diff --git a/a.txt b/a.txt')
    expect(result.diffTruncated).toBe(false)
  })

  it('returns empty parents for a root commit', async () => {
    const rootHash = git(showRepo, ['rev-list', '--max-parents=0', 'HEAD']).trim()
    const result = await showController.show(agent(showRepo), rootHash, signal())
    expect(result.commit?.parents).toEqual([])
    expect(result.files.length).toBe(3)
  })

  it('answers git/commit-not-found for a hash absent from the repo', async () => {
    await expect(showController.show(agent(showRepo), '0'.repeat(40), signal()))
      .rejects.toMatchObject({ code: 'git/commit-not-found', details: { hash: '0'.repeat(40) } })
  })

  it('answers gateway/bad-request for a malformed hash', async () => {
    await expect(showController.show(agent(showRepo), 'zzz', signal()))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('resolves none outside any repository', async () => {
    const result = await showController.show(agent(outside), '0'.repeat(40), signal())
    expect(result.vcs).toEqual({ kind: 'none' })
    expect(result.files).toEqual([])
    expect(result.diff).toBe('')
    expect(result.diffTruncated).toBe(false)
  })

  it('truncates the patch at maxDiffBytes and flags it', async () => {
    const bounded = new Context()
    const small = new GitController(bounded, { maxCount: 200, all: false, firstParent: true, maxDiffBytes: 16 })
    try {
      const result = await small.show(agent(showRepo), showHead, signal())
      expect(result.diffTruncated).toBe(true)
      expect(Buffer.byteLength(result.diff, 'utf8')).toBeLessThanOrEqual(16)
    } finally {
      await bounded.fiber.dispose()
    }
  })
})
