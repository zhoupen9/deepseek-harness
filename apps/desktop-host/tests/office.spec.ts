import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import * as desktopOffice from '../src/office.ts'

const SKILL_ASSETS = new URL('../../../packages/skill/skill-office/assets/', import.meta.url)

/** Prepared Office payload under test: its runtime directory, skill assets, and declared Node.js. */
interface Payload {
  /** Absolute primary runtime directory passed to the Desktop Office composition. */
  readonly source: string
  /** Absolute Office skill resources the composition registers. */
  readonly assets: string
  /** Node.js executable the payload's LibreOffice Kit CLI must run on. */
  readonly node: string
}

/** A payload carrying its own interpreter tree under `dependencies/`. */
async function bundledPayload(root: string): Promise<Payload> {
  const assets = join(root, 'runtime', 'office-skills')
  await cp(SKILL_ASSETS, assets, { recursive: true })
  const source = join(root, 'runtime', 'primary-runtime')
  const node = join(source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  await mkdir(dirname(node), { recursive: true })
  await cp(process.execPath, node)
  await writeFile(join(source, 'runtime.json'), JSON.stringify({
    desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
    python: '3.14.7', node: '24.21.0', pythonPackages: {},
  }))
  return { source, assets, node }
}

/** A payload declaring absolute system interpreters in `external` and no `dependencies/` tree. */
async function systemPayload(root: string): Promise<Payload> {
  const assets = join(root, 'runtime', 'office-skills')
  await cp(SKILL_ASSETS, assets, { recursive: true })
  const source = join(root, 'runtime', 'primary-runtime')
  const python = join(root, 'usr', 'bin', 'python3')
  const node = join(root, 'usr', 'bin', 'node')
  await mkdir(dirname(node), { recursive: true })
  await writeFile(python, 'interpreter')
  await writeFile(node, 'interpreter')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'runtime.json'), JSON.stringify({
    desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
    python: '3.14.7', node: '24.21.0', pythonPackages: {},
    external: {
      python, pythonPackages: join(root, 'usr', 'lib', 'python3.14', 'site-packages'), node,
    },
  }))
  return { source, assets, node }
}

it.each([
  ['bundled payload', bundledPayload],
  ['system-runtime payload', systemPayload],
] as const)('loads Desktop Office CLI paths for a %s and removes them on disposal', async (_case, buildPayload) => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-'))
  vi.stubEnv('DSH_HOME', root)
  const ctx = new Context()

  try {
    const payload = await buildPayload(root)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    expect('default' in desktopOffice).toBe(false)
    expect(ctx.loader.unwrapExports(desktopOffice)).toBe(desktopOffice)
    const modules = new Map<string, unknown>([
      ['agents', AgentRegistry], ['systemPrompt', SystemPrompt], ['tools', ToolRuntime],
      ['skills', SkillRegistry], ['office', desktopOffice],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected plugin ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const config = join(root, 'cordis.yml')
    await writeFile(config, [
      '- name: agents', '- name: systemPrompt', '- name: tools', '- name: skills', '- name: office',
      '  config:', `    source: ${JSON.stringify(payload.source)}`,
      `    root: ${JSON.stringify(join(root, 'installed'))}`,
      `    runtimeDir: ${JSON.stringify(join(root, 'dsh'))}`, '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx'])
    expect((await ctx.skills.get('office-pptx'))?.resourceBase).toEqual({ kind: 'directory', path: join(payload.assets, 'office-pptx').split(sep).join('/') })
    expect((await ctx.skills.get('office-pptx'))?.content).toContain('office-render')
    expect((await ctx.skills.get('office-pptx'))?.content).not.toContain(dirname(payload.node))
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['load_workspace_dependencies'])
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'office')
    expect(entry).toBeDefined()
    await entry?.fiber?.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.tools.schemas()).toEqual([])
  } finally {
    try { await ctx.fiber.dispose() }
    finally {
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  }
})
