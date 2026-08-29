#!/usr/bin/env node
/**
 * Launch the DeepSeek Harness Electron shell with a system-installed Electron
 * binary.
 *
 * The npm `electron` package is kept only for its TypeScript declarations: its
 * postinstall binary download is denied in pnpm-workspace.yaml, so the
 * `electron .` shim under node_modules/.bin would fail with "Electron failed
 * to install correctly". This launcher instead resolves a real Electron on the
 * machine — an explicit `DSH_ELECTRON_BIN` path, electron's own
 * `ELECTRON_OVERRIDE_DIST_PATH` convention, or an `electron` on PATH outside
 * node_modules/.bin — and only then falls back to the npm shim.
 * @module @deepseek-ai/dsh-electron/scripts/electron
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, sep } from 'node:path'

/** Platform binary name of the Electron executable. */
const BINARY = process.platform === 'win32' ? 'electron.exe' : 'electron'

/**
 * Candidate Electron executables, most specific first: an explicit override,
 * electron's override-dist convention, then every `electron` on PATH outside a
 * node_modules/.bin directory (the system install), and finally the npm shim.
 * @returns absolute candidate paths in resolution order.
 */
function resolveCandidates() {
  const candidates = []
  if (process.env.DSH_ELECTRON_BIN) candidates.push(process.env.DSH_ELECTRON_BIN)
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    candidates.push(join(process.env.ELECTRON_OVERRIDE_DIST_PATH, BINARY))
  }
  const binSuffix = sep + 'node_modules' + sep + '.bin'
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '' || dir.endsWith(binSuffix)) continue
    candidates.push(join(dir, BINARY))
  }
  return candidates
}

const executable = resolveCandidates().find(existsSync)
if (executable === undefined) {
  console.error('dsh-electron: no Electron binary found; set DSH_ELECTRON_BIN or install Electron')
  process.exit(1)
}

// Run Electron in place: inherit the terminal, forward signals, and mirror the
// child's exit status so the shell behaves as if it had launched Electron directly.
const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { child.kill(signal) })
}
child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
