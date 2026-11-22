/** Local Web document and authenticated HTTP forwarding for the application window. */
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
}
const BOOT = '<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>'

/** Markup added to the packaged index before its client bundles run. */
export interface WebDocumentAppearance {
  /** Inserted immediately after the opening head tag. */
  readonly head: string
  /** Inserted immediately after the opening body tag. */
  readonly body: string
}

/** Additional rows inserted after the appearance rows, in table order. */
export interface WebDocumentInjections {
  /** Head rows; they run before the packaged index's own module script. */
  readonly head?: string
  /** Body rows. */
  readonly body?: string
}

/** Insert boot readiness, the appearance rows, and extra rows into one packaged index. */
function injectIndex(
  html: string,
  appearance: WebDocumentAppearance | undefined,
  extra: WebDocumentInjections | undefined,
): string {
  const head = `${BOOT}${appearance?.head ?? ''}${extra?.head ?? ''}`
  const booted = html.replace(/<head(?:\s[^>]*)?>/i, tag => `${tag}${head}`)
  const body = `${appearance?.body ?? ''}${extra?.body ?? ''}`
  return body === '' ? booted : booted.replace(/<body(?:\s[^>]*)?>/i, tag => `${tag}${body}`)
}

/**
 * Read an application-owned static asset; the index waits for asynchronous Host injections.
 * @param request - Local application request.
 * @param root - Packaged Web dist directory.
 * @param appearance - Rows that paint the packaged index before the Host answers.
 * @param extra - Boot rows supplied by a remote Harness the shell connected to.
 * @returns Static response, or a missing/invalid path response.
 */
export async function serveWebDocument(
  request: Request,
  root: string,
  appearance?: WebDocumentAppearance,
  extra?: WebDocumentInjections,
): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const url = new URL(request.url)
  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const directory = resolve(root)
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let body: Buffer
  try { body = await readFile(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  const content = pathname === '/' || pathname === '/index.html'
    ? injectIndex(body.toString(), appearance, extra) : new Uint8Array(body)
  return new Response(request.method === 'HEAD' ? null : content, {
    headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
  })
}

/**
 * Read the session cookie from one authenticated index exchange.
 * @param response - Response to the URL carrying the process token.
 * @returns the `name=value` cookie pair, or undefined when the exchange did not authenticate.
 */
export function readSessionCookie(response: Response): string | undefined {
  const cookie = response.headers.get('set-cookie')
  if (response.status !== 303 || cookie === null) return undefined
  const end = cookie.indexOf(';')
  return end < 0 ? cookie : cookie.slice(0, end)
}

/** Cookie store operations used to remove legacy Host authentication cookies. */
export interface HostCookieStore {
  get(filter: { url: string }): Promise<readonly { readonly name: string }[]>
  remove(url: string, name: string): Promise<void>
}

/**
 * Remove every `dsh-auth-*` cookie that earlier releases left in a cookie store for the Host's hostname.
 * Cookies ignore ports, so cookies from earlier random-port Hosts would otherwise travel with every
 * request to that hostname until they expire.
 * @param cookies - Electron session cookie store.
 * @param url - Host URL; cookies for its hostname on every port are removed.
 */
export async function removeLegacyHostCookies(cookies: HostCookieStore, url: string): Promise<void> {
  const origin = new URL(url).origin
  for (const { name } of await cookies.get({ url: origin })) {
    if (name.startsWith('dsh-auth-')) await cookies.remove(origin, name)
  }
}

/**
 * Response headers not relayed to the renderer. `set-cookie` would hand the
 * Host's authentication cookie to the page's cookie jar, which the shell owns
 * instead; the rest describe the Node `fetch` connection (its encoding, length,
 * and hop-by-hop transport), which Chromium never sees.
 */
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  'content-encoding', 'content-length',
  'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
]

/** Host routes whose responses carry immutable cache headers keyed by a per-process revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u

/**
 * Resolve one application pathname beneath a Host mount.
 * @param mount - Host base pathname, ending in `/`; `/` names the origin root.
 * @param pathname - Application pathname starting with `/`.
 * @returns the pathname to request from that Host.
 */
function mountPathname(mount: string, pathname: string): string {
  return mount === '/' ? pathname : `${mount.slice(0, -1)}${pathname}`
}

/**
 * Forward local application requests to its authenticated Host, preserving streaming and cancellation.
 * Plugin bundle responses lose their `cache-control` for `no-store`: the Host marks them immutable
 * under a revision that changes every launch, so Chromium's disk cache would only accumulate bundles
 * no later launch can reuse.
 * @param request - Request from the application origin.
 * @param host - Host URL; a path prefix mounts the application behind a reverse proxy.
 * @param cookie - Host-issued authentication cookie: the Desktop-private credential for the owned Host,
 * or the remote Host's browser-session cookie when the shell drives a remote Harness.
 * @returns Host response without connection-level headers.
 */
export async function forwardWebRequest(request: Request, host: string, cookie: string): Promise<Response> {
  const source = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== 'dsh-app://app') return new Response(null, { status: 403 })
  const target = new URL(host)
  target.pathname = mountPathname(target.pathname, source.pathname)
  target.search = source.search
  const headers = new Headers(request.headers)
  for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name)
  headers.set('cookie', cookie)
  const init = { method: request.method, headers, body: request.body, signal: request.signal, duplex: 'half', redirect: 'manual' as const }
  const response = await fetch(target, init)
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set('cache-control', 'no-store')
  return new Response(response.body, { status: response.status, headers: outgoing })
}
