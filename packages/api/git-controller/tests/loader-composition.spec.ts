/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the gitController row, and the assertions observe the
 * durable outcome — the service it registers, that its validated Config
 * defaults reached the instance (a real log works), and that disposing the
 * entry removes the service again (HMR safety).
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GitController from '../src/index.ts'

const CONTROLLER = '@deepseek-ai/dsh-api-git-controller'

let context: Context | undefined
let root: string | undefined
let repo: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
  if (repo !== undefined) await rm(repo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  repo = undefined
})

/** Boot a single-row cordis.yml through the real Loader, resolving the controller from a module map. */
async function loadComposition(): Promise<{ ctx: Context }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-controller-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, ['- name: \'' + CONTROLLER + '\'', ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([[CONTROLLER, GitController]])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context }
}

describe('real Loader composition', () => {
  it('mounts the gitController service with defaulted config and unmounts it on disposal', { timeout: 60_000 }, async () => {
    repo = await mkdtemp(join(tmpdir(), 'dsh-git-controller-repo-'))
    execFileSync('git', ['-C', repo, 'init', '-q'])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.test'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
    await writeFile(join(repo, 'f.txt'), 'f')
    execFileSync('git', ['-C', repo, 'add', 'f.txt'])
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'one'])

    const { ctx } = await loadComposition()

    const controller = ctx.get('gitController') as GitController
    expect(controller).toBeInstanceOf(GitController)
    // The validated Config defaults reached the instance: a real log resolves
    // without a maxCount/all miss.
    const agent = { session: { header: { cwd: repo } } } as unknown as Agent
    const result = await controller.log(agent, undefined, new AbortController().signal)
    expect(result.vcs).toEqual({ kind: 'git', root: repo, worktree: join(repo, '.git') })
    expect(result.commits.map(commit => commit.subject)).toEqual(['one'])
    expect(result.truncated).toBe(false)

    // HMR safety: disposing the entry removes the registered service.
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === CONTROLLER)!
    await entry.fiber!.dispose()
    expect(ctx.get('gitController')).toBeUndefined()
  })
})
