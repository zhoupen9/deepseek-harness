import { defineConfig } from 'tsdown'

/**
 * The Electron shell ships a single main-process entry. `electron` and every
 * Node built-in stay external: the former is provided by the Electron runtime,
 * the latter by Node. `@deepseek-ai/dsh` is never imported - its bin entry is
 * resolved at runtime through `createRequire` - so it needs no bundling either.
 * `fixedExtension: false` keeps the `.js` extension the `main` field points at
 * (the package is `type: module`).
 */
export default defineConfig({
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
})
