import { defineConfig } from 'tsdown'

/**
 * The Electron shell ships two entries: the ESM main process and the CommonJS
 * preload. Each is built separately (a multi-entry build would emit an unlisted
 * shared chunk) and inlines its own copy of the shared ipc/window-chrome
 * modules. `electron` and every Node built-in stay external: the former is
 * provided by the Electron runtime, the latter by Node. `@deepseek-ai/dsh` is
 * never imported - its bin entry is resolved at runtime through `createRequire`
 * - so it needs no bundling either. `fixedExtension: false` keeps the `.js`
 * extension the `main` field points at, and emits `.cjs` for the CommonJS
 * preload (the package is `type: module`).
 */
export default defineConfig([
  {
    entry: ['src/main.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    deps: {
      neverBundle: ['electron'],
    },
  },
  {
    entry: { preload: 'src/preload.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: ['electron'],
    },
  },
])
