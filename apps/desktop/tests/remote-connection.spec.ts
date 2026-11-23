/** Remote Web Host connection: pasted URL parsing, boot-row extraction, token exchange, and document order. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractIndexInjections, parseRemoteUrl, prepareRemoteConnection, remoteDocumentInjections, remoteTransportScript,
} from '../src/remote-connection.ts'
import { serveWebDocument } from '../src/web-document.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

/** Build one served remote index with the shell-visible row layout. */
function remoteIndex(version: string | null = '1.2.3'): string {
  const graph = version === null
    ? '{"rev":"r1","entries":[],"batches":[]}'
    : `{"rev":"r1","release":{"version":${JSON.stringify(version)}},"entries":[],"batches":[]}`
  return [
    '<!doctype html><html lang="en"><head><base href="./">',
    '<script>QUEUE</script>',
    '<link rel="preload" as="script" href="plugins/a/client.js">',
    '<script src="plugins/a/client.js"></script>',
    `<script>globalThis["__DSH_BOOT__"] = ${graph}</script>`,
    '<style>THEME</style>',
    '<meta charset="utf-8"><title>Remote</title>',
    '<script type="module" crossorigin src="./assets/index-remote.js"></script>',
    '</head><body>',
    '<script>BODY</script>',
    '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>',
    '<div id="root"></div>',
    '</body></html>',
  ].join('')
}

it('takes only the contiguous boot rows around the packaged index', () => {
  const rows = extractIndexInjections(remoteIndex())
  expect(rows.head).toBe([
    '<script>QUEUE</script>',
    '<link rel="preload" as="script" href="plugins/a/client.js">',
    '<script src="plugins/a/client.js"></script>',
    '<script>globalThis["__DSH_BOOT__"] = {"rev":"r1","release":{"version":"1.2.3"},"entries":[],"batches":[]}</script>',
    '<style>THEME</style>',
  ].join(''))
  expect(rows.body).toBe('<script>BODY</script><script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>')
  expect(rows.head).not.toContain('index-remote.js')
})

it('rejects a document without Harness rows', () => {
  expect(() => extractIndexInjections('<html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>'))
    .toThrow(expect.objectContaining({ failure: 'no-injections' }))
  expect(() => extractIndexInjections('<div id="root"></div>'))
    .toThrow(expect.objectContaining({ failure: 'no-injections' }))
})

it('parses the pasted token URL into an exchange URL and a clean base', () => {
  const parsed = parseRemoteUrl('  https://app.example/ui?token=owned  ')
  expect(parsed.tokenized.href).toBe('https://app.example/ui?token=owned')
  expect(parsed.base.href).toBe('https://app.example/ui/')
  expect(parseRemoteUrl('http://127.0.0.1:3080/?token=t').base.href).toBe('http://127.0.0.1:3080/')
})

it.each([
  ['', 'invalid-url'],
  ['not a url', 'invalid-url'],
  ['ftp://app.example/?token=t', 'invalid-url'],
  ['https://user:secret@app.example/?token=t', 'invalid-url'],
  ['https://app.example/?token=t#fragment', 'invalid-url'],
  ['https://app.example/', 'missing-token'],
  ['https://app.example/?token=', 'missing-token'],
] as const)('rejects %j as %s', (value, failure) => {
  expect(() => parseRemoteUrl(value)).toThrow(expect.objectContaining({ failure }))
})

it('exchanges the token, reads the mounted index, and keeps its boot rows', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'dsh-session=owned; Path=/ui/; HttpOnly' } }))
    .mockResolvedValueOnce(new Response(remoteIndex(), { status: 200 }))
  const connection = await prepareRemoteConnection('https://app.example/ui/?token=owned', '1.2.3', send)
  expect(connection.base.href).toBe('https://app.example/ui/')
  expect(connection.cookie).toBe('dsh-session=owned')
  expect(connection.version).toBe('1.2.3')
  expect(connection.head).toContain('__DSH_BOOT__')
  expect(connection.body).toContain('__DSH_BOOT_READY__')
  expect(send.mock.calls[0]?.[0]).toBe('https://app.example/ui/?token=owned')
  expect(send.mock.calls[1]?.[0]).toBe('https://app.example/ui/index.html')
  expect(new Headers(send.mock.calls[1]?.[1]?.headers).get('cookie')).toBe('dsh-session=owned')
})

it('reports an unreachable Harness', async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
  await expect(prepareRemoteConnection('http://127.0.0.1:3080/?token=t', '1.2.3', send))
    .rejects.toMatchObject({ failure: 'unreachable' })
})

it('reports a rejected token exchange and a rejected index', async () => {
  const refused = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
  await expect(prepareRemoteConnection('http://127.0.0.1:3080/?token=t', '1.2.3', refused))
    .rejects.toMatchObject({ failure: 'authentication' })
  const refusedIndex = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=owned' } }))
    .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
  await expect(prepareRemoteConnection('http://127.0.0.1:3080/?token=t', '1.2.3', refusedIndex))
    .rejects.toMatchObject({ failure: 'authentication' })
})

it('refuses a Harness from a different release', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=owned' } }))
    .mockResolvedValueOnce(new Response(remoteIndex('9.9.9'), { status: 200 }))
  await expect(prepareRemoteConnection('http://127.0.0.1:3080/?token=t', '1.2.3', send))
    .rejects.toMatchObject({ failure: 'version-mismatch' })
})

it('tolerates a Harness that publishes no release identity', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=owned' } }))
    .mockResolvedValueOnce(new Response(remoteIndex(null), { status: 200 }))
  const connection = await prepareRemoteConnection('http://127.0.0.1:3080/?token=t', '1.2.3', send)
  expect(connection.version).toBeUndefined()
})

it('declares a non-loopback transport ahead of the remote rows', () => {
  const base = new URL('http://127.0.0.1:3080/')
  expect(remoteTransportScript(base)).toBe(
    '<script>globalThis.__DSH_TRANSPORT__ = {"ownsHost":false,"streamBaseUrl":"http://127.0.0.1:3080/"}</script>',
  )
  const rows = remoteDocumentInjections({ base, cookie: 'c', head: '<script>H</script>', body: '<script>B</script>' })
  expect(rows.head).toBe(`${remoteTransportScript(base)}<script>H</script>`)
  expect(rows.body).toBe('<script>B</script>')
})

it('serves the packaged index with the remote rows ahead of its own client bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-remote-'))
  roots.push(root)
  await writeFile(join(root, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./assets/entry.js"></script></body></html>')
  const rows = extractIndexInjections(remoteIndex())
  const connection = { base: new URL('http://127.0.0.1:3080/'), cookie: 'session=owned', head: rows.head, body: rows.body }
  const html = await (await serveWebDocument(new Request('dsh-app://app/'), root,
    { head: '<style>APPEARANCE</style>', body: '<script>APPEARANCE_BODY</script>' },
    remoteDocumentInjections(connection))).text()
  const order = [
    '__DSH_BOOT_READY__',
    '__DSH_TRANSPORT__',
    'QUEUE',
    '<meta charset="utf-8">',
    'assets/entry.js',
  ]
  for (let index = 1; index < order.length; index += 1) {
    expect(html.indexOf(order[index - 1]!)).toBeGreaterThanOrEqual(0)
    expect(html.indexOf(order[index - 1]!)).toBeLessThan(html.indexOf(order[index]!))
  }
  expect(html).toContain('<body><script>APPEARANCE_BODY</script><script>BODY</script><script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script><div id="root">')
  expect(html.indexOf('APPEARANCE_BODY')).toBeLessThan(html.indexOf('BODY</script>'))
  expect(html.indexOf('__DSH_BOOT__')).toBeLessThan(html.indexOf('assets/entry.js'))
})
