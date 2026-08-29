import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Copy the plain-CJS preload beside the bundled main entry so the BrowserWindow
// can reference it as a sibling of lib/main.js.
const root = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(fileURLToPath(new URL('../lib/', import.meta.url)), { recursive: true })
copyFileSync(
  fileURLToPath(new URL('../src/preload.cjs', import.meta.url)),
  fileURLToPath(new URL('../lib/preload.cjs', import.meta.url)),
)
void root
