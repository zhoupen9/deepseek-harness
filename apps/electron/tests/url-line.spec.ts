import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDshEntry } from '../src/dsh-server.ts'
import { parseWebUrlLine } from '../src/url-line.ts'

describe('parseWebUrlLine', () => {
  it('extracts the authenticated URL from the readiness line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4567/?token=test-token'))
      .toBe('http://127.0.0.1:4567/?token=test-token')
  })

  it('ignores the LAN suffix', () => {
    const line = 'dsh web: http://127.0.0.1:4567/?token=test-token (LAN: http://192.168.1.5:4567/?token=test-token)'
    expect(parseWebUrlLine(line)).toBe('http://127.0.0.1:4567/?token=test-token')
  })

  it('returns undefined for other lines', () => {
    expect(parseWebUrlLine('some unrelated log line')).toBeUndefined()
    expect(parseWebUrlLine('dsh web: opening the default browser; pass --no-open to disable')).toBeUndefined()
  })
})

describe('resolveDshEntry', () => {
  it('resolves the dsh bin entry from the package manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-'))
    const pkgDir = join(root, '@deepseek-ai', 'dsh')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { dsh: 'lib/bin.js' } }))
    const require = { resolve: () => join(pkgDir, 'package.json') } as unknown as NodeRequire
    expect(resolveDshEntry(require)).toBe(join(pkgDir, 'lib', 'bin.js'))
  })

  it('throws when the manifest declares no dsh bin', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-'))
    const pkgDir = join(root, '@deepseek-ai', 'dsh')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { other: 'lib/other.js' } }))
    const require = { resolve: () => join(pkgDir, 'package.json') } as unknown as NodeRequire
    expect(() => resolveDshEntry(require)).toThrow(/declares no dsh bin/)
  })
})
