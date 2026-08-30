/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the workspaceFilesController row, and the assertions
 * observe the durable outcome — the service it registers, that its validated
 * Config defaults reached the instance (a real listing works), and that
 * disposing the entry removes the service again (HMR safety).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import WorkspaceFilesController from '../src/index.ts'

const CONTROLLER = '@deepseek-ai/dsh-api-workspace-files-controller'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
})

/** Boot a single-row cordis.yml through the real Loader, resolving the controller from a module map. */
async function loadComposition(): Promise<{ ctx: Context; workspace: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-controller-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-ws-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [`- name: '${CONTROLLER}'`, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([[CONTROLLER, WorkspaceFilesController]])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, workspace }
}

describe('real Loader composition', () => {
  it('mounts the workspaceFilesController service with defaulted config and unmounts it on disposal', { timeout: 60_000 }, async () => {
    const { ctx, workspace } = await loadComposition()

    const controller = ctx.get('workspaceFilesController') as WorkspaceFilesController
    expect(controller).toBeInstanceOf(WorkspaceFilesController)
    // The validated Config defaults reached the instance: a real listing of
    // the empty workspace root resolves without a maxEntries/maxBytes miss.
    const agent = { session: { header: { cwd: workspace } } } as unknown as Agent
    const listing = await controller.list(agent, workspace, new AbortController().signal)
    expect(listing.path).toBe(workspace)
    expect(listing.home).toBeTypeOf('string')
    expect(Array.isArray(listing.crumbs)).toBe(true)
    expect(listing.entries).toEqual([])
    expect(listing.truncated).toBe(false)

    // HMR safety: disposing the entry removes the registered service.
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === CONTROLLER)!
    await entry.fiber!.dispose()
    expect(ctx.get('workspaceFilesController')).toBeUndefined()
  })
})
