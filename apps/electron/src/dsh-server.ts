/**
 * Boot the DeepSeek Harness Web profile as a child process and surface its
 * authenticated launch URL. The Electron main process owns one of these for a
 * window's lifetime.
 * @module @deepseek-ai/dsh-electron/dsh-server
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseWebUrlLine } from './url-line.ts'

/** npm identity of the dsh CLI this shell boots. */
const DSH_PACKAGE = '@deepseek-ai/dsh'
/** How long to wait for `dsh web` to announce its URL before failing. */
const DEFAULT_URL_TIMEOUT_MS = 30_000

/** A booted `dsh web` server plus its authenticated launch URL. */
export interface DshWebServer {
  /** Authenticated loopback URL (`?token=…`) a fresh window must load. */
  url: string
  /** The child process serving the Web profile. */
  child: ChildProcess
}

/** Options for {@link spawnDshWeb}. */
export interface SpawnDshWebOptions {
  /** Extra arguments appended after `web --no-open` (for example `--port 8080`). */
  args?: readonly string[]
  /** How long to wait for the URL line, in milliseconds. */
  urlTimeoutMs?: number
  /** Forward the server's own stdio to this process once started. Defaults to true. */
  passthrough?: boolean
}

/**
 * Resolve the absolute entry file of the `dsh` bin declared by
 * `@deepseek-ai/dsh`, so the child can be spawned without a shell or a
 * platform-specific `.bin` shim.
 * @param require - module resolver anchored at this package; injectable for tests.
 * @returns the absolute path of the `dsh` bin entry.
 */
export function resolveDshEntry(require: NodeRequire = createRequire(import.meta.url)): string {
  const manifestPath = require.resolve(DSH_PACKAGE + '/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: Record<string, string> }
  const bin = manifest.bin?.dsh
  if (bin === undefined) throw new Error(DSH_PACKAGE + ': package.json declares no dsh bin')
  return join(dirname(manifestPath), bin)
}

/**
 * Spawn `dsh web --no-open` and resolve once its authenticated URL appears on
 * stdout. The URL line is the harness's readiness signal: it is printed only
 * after the Loader tree settles and sibling rows such as `/api` finish mounting.
 * @param options - extra arguments, URL timeout, and stdio passthrough.
 * @returns the running server and its launch URL; rejects on early exit or timeout.
 */
export function spawnDshWeb(options: SpawnDshWebOptions = {}): Promise<DshWebServer> {
  const entry = resolveDshEntry()
  // In the Electron main process `process.execPath` is the Electron binary, not
  // Node. `ELECTRON_RUN_AS_NODE=1` makes that binary behave as plain Node, which
  // is how the CLI (and, transitively, its own subprocesses) run in a packaged app
  // that ships no system Node.
  const child = spawn(process.execPath, [entry, 'web', '--no-open', ...(options.args ?? [])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')

  const passthrough = options.passthrough ?? true
  const timeoutMs = options.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS

  return new Promise<DshWebServer>((resolve, reject) => {
    let settled = false
    // A partial line can straddle two stdout chunks; carry it across events.
    let pending = ''

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('dsh web did not announce a URL within ' + String(timeoutMs) + 'ms'))
    }, timeoutMs)

    const onStdout = (chunk: string): void => {
      if (settled) {
        if (passthrough) process.stdout.write(chunk)
        return
      }
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        if (passthrough) process.stdout.write(line + '\n')
        const parsed = parseWebUrlLine(line)
        if (parsed !== undefined) {
          settled = true
          clearTimeout(timeout)
          resolve({ url: parsed, child })
          return
        }
        newline = pending.indexOf('\n')
      }
    }
    const onStderr = (chunk: string): void => {
      process.stderr.write(chunk)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error('dsh web exited before announcing a URL (code ' + String(code) + ', signal ' + String(signal) + ')'))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}
