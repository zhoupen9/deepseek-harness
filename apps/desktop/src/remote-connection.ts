/** Connect this shell to a remote Harness Web Host: token exchange, boot rows, and document base. */
import type { RemoteConnectionFailure } from './ipc.ts'
import type { WebDocumentInjections } from './web-document.ts'
import { readSessionCookie } from './web-document.ts'

/** A remote connection failure carrying the code the renderer localizes. */
export class RemoteConnectionError extends Error {
  /**
   * @param failure - stable code the renderer selects copy for.
   * @param message - developer-facing detail; never rendered verbatim.
   */
  constructor(readonly failure: RemoteConnectionFailure, message: string) {
    super(message)
    this.name = 'RemoteConnectionError'
  }
}

/** One prepared remote Harness the shell can serve the packaged client against. */
export interface RemoteConnection {
  /** Authenticated HTTP base, ending in `/`; forwarded requests keep its mount prefix. */
  readonly base: URL
  /** Browser-session cookie header value the remote issued for that authority. */
  readonly cookie: string
  /** Head boot rows taken from the remote index. */
  readonly head: string
  /** Body boot rows taken from the remote index. */
  readonly body: string
  /** Release version published by the remote boot graph, when it publishes one. */
  readonly version?: string
}

/** Row forms the Host renders at the start of the head or body: inline or external scripts, styles, and preloads. */
const ROWS = [
  /^<script\b(?![^>]*\btype\s*=\s*(?:"module"|'module'|module\b))[^>]*>[\s\S]*?<\/script\s*>/iu,
  /^<style\b[^>]*>[\s\S]*?<\/style\s*>/iu,
  /^<link\b[^>]*\brel\s*=\s*(?:"preload"|'preload'|preload(?=[\s/>]))[^>]*>/iu,
]
/** The boot graph row rendered by the Host's `global` injection kind. */
const BOOT_GRAPH = /<script>globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/u

/** Deadline for each exchange with a remote Harness; a dark address must not hold the dialog open. */
const CONNECT_TIMEOUT_MS = 15_000

/**
 * Collect the contiguous injection rows that start at one document position.
 * @param html - served remote index.
 * @param from - offset where the first possible row starts.
 * @returns the concatenated row markup, or `''` when no row starts there.
 */
function scanRows(html: string, from: number): string {
  let position = from
  let rows = ''
  for (;;) {
    const gap = /^\s*/u.exec(html.slice(position))
    position += gap?.[0].length ?? 0
    const match = ROWS.map(row => row.exec(html.slice(position))).find((row): row is RegExpExecArray => row !== null)
    if (match === undefined) return rows
    rows += match[0]
    position += match[0].length
  }
}

/**
 * Split the boot rows out of a remote index; the packaged index supplies every other part.
 * @param html - index served by the remote Harness.
 * @returns the head and body row markup.
 * @throws RemoteConnectionError with `no-injections` when the document carries no boot graph.
 */
export function extractIndexInjections(html: string): { readonly head: string; readonly body: string } {
  const headOpen = /<head(?:\s[^>]*)?>/iu.exec(html)
  const bodyOpen = /<body(?:\s[^>]*)?>/iu.exec(html)
  if (headOpen === null || bodyOpen === null) {
    throw new RemoteConnectionError('no-injections', 'the remote document has no head or body element')
  }
  let headStart = headOpen.index + headOpen[0].length
  // `frontend-static` inserts its relative base ahead of every row.
  const gap = /^\s*/u.exec(html.slice(headStart))
  headStart += gap?.[0].length ?? 0
  const base = /^<base\b[^>]*>/iu.exec(html.slice(headStart))
  if (base !== null) headStart += base[0].length
  const head = scanRows(html, headStart)
  const body = scanRows(html, bodyOpen.index + bodyOpen[0].length)
  if (!head.includes('__DSH_BOOT__') || !body.includes('__DSH_BOOT_READY__')) {
    throw new RemoteConnectionError('no-injections', 'the remote document carries no Harness boot rows')
  }
  return { head, body }
}

/**
 * Read the release version published by one boot graph row.
 * @param head - extracted head rows.
 * @returns the version, or undefined when the Host published none.
 * @throws RemoteConnectionError with `no-injections` when the graph is absent or unparsable.
 */
function bootReleaseVersion(head: string): string | undefined {
  const match = BOOT_GRAPH.exec(head)
  if (match === null) throw new RemoteConnectionError('no-injections', 'the remote document carries no boot graph')
  let graph: unknown
  try {
    graph = JSON.parse(match[1] ?? '')
  } catch {
    throw new RemoteConnectionError('no-injections', 'the remote boot graph is not JSON')
  }
  if (typeof graph !== 'object' || graph === null || !('release' in graph)) return undefined
  const release = graph.release
  if (typeof release !== 'object' || release === null || !('version' in release)) return undefined
  return typeof release.version === 'string' ? release.version : undefined
}

/**
 * Parse the URL copied from a remote `dsh --profile web` startup line.
 * @param text - pasted URL, including its `token` query parameter.
 * @returns the token exchange URL and the clean base the document resolves against.
 * @throws RemoteConnectionError with `invalid-url` or `missing-token`.
 */
export function parseRemoteUrl(text: string): { readonly tokenized: URL; readonly base: URL } {
  const value = text.trim()
  if (value === '') throw new RemoteConnectionError('invalid-url', 'the URL is empty')
  let tokenized: URL
  try {
    tokenized = new URL(value)
  } catch {
    throw new RemoteConnectionError('invalid-url', 'the value is not an absolute URL')
  }
  if (tokenized.protocol !== 'http:' && tokenized.protocol !== 'https:') {
    throw new RemoteConnectionError('invalid-url', 'the URL must use http or https')
  }
  if (tokenized.username !== '' || tokenized.password !== '') {
    throw new RemoteConnectionError('invalid-url', 'the URL must not include credentials')
  }
  if (tokenized.hash !== '') throw new RemoteConnectionError('invalid-url', 'the URL must not include a fragment')
  const token = tokenized.searchParams.get('token')
  if (token === null || token === '') {
    throw new RemoteConnectionError('missing-token', 'the URL has no token parameter')
  }
  const base = new URL(tokenized)
  base.search = ''
  base.hash = ''
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return { tokenized, base }
}

/**
 * Build the transport row that must precede the remote client entry.
 * @param base - authenticated remote base the WebSocket carrier resolves against.
 * @returns one classic script row declaring a shell-owned, non-loopback transport.
 */
export function remoteTransportScript(base: URL): string {
  const transport = JSON.stringify({ ownsHost: false, streamBaseUrl: base.href }).replaceAll('<', '\\u003c')
  return `<script>globalThis.__DSH_TRANSPORT__ = ${transport}</script>`
}

/**
 * Compose the rows inserted into the packaged index for one remote connection.
 * @param connection - prepared remote connection.
 * @returns head rows with the transport first, and the remote body rows.
 */
export function remoteDocumentInjections(connection: RemoteConnection): WebDocumentInjections {
  return { head: `${remoteTransportScript(connection.base)}${connection.head}`, body: connection.body }
}

/**
 * Exchange a pasted token URL for a remote connection and its boot rows.
 * @param text - pasted URL, including its `token` query parameter.
 * @param expectedVersion - release this application's client build belongs to.
 * @param send - request carrier; tests pass a stub.
 * @returns the authenticated connection ready for request forwarding.
 * @throws RemoteConnectionError with the failure the dialog localizes.
 */
export async function prepareRemoteConnection(
  text: string,
  expectedVersion: string,
  send: typeof fetch = fetch,
): Promise<RemoteConnection> {
  const { tokenized, base } = parseRemoteUrl(text)
  let exchange: Response
  try {
    exchange = await send(tokenized.href, { redirect: 'manual', signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) })
  } catch (error) {
    throw new RemoteConnectionError('unreachable', `the remote Harness is unreachable: ${String(error)}`)
  }
  const cookie = readSessionCookie(exchange)
  await exchange.body?.cancel()
  if (cookie === undefined) {
    throw new RemoteConnectionError('authentication', 'the remote Harness did not authenticate the token URL')
  }
  const index = new URL('index.html', base)
  let response: Response
  try {
    response = await send(index.href, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) })
  } catch (error) {
    throw new RemoteConnectionError('unreachable', `the remote index is unreachable: ${String(error)}`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new RemoteConnectionError(
      response.status === 401 ? 'authentication' : 'unreachable',
      `the remote index answered ${String(response.status)}`,
    )
  }
  const { head, body } = extractIndexInjections(await response.text())
  const version = bootReleaseVersion(head)
  if (version !== undefined && version !== expectedVersion) {
    throw new RemoteConnectionError('version-mismatch', `the remote Harness runs ${version}; this app runs ${expectedVersion}`)
  }
  return { base, cookie, head, body, ...(version === undefined ? {} : { version }) }
}
