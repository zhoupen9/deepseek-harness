# Maintainer: Your Name <you@example.com>
#
# Builds the DeepSeek Harness (dsh) CLI and its Electron desktop launcher from
# the local source checkout at ~/Sources/deepseek-harness (electron branch).
# The source is consumed read-only via a `git+file://` clone into $srcdir, so
# nothing inside the source tree is modified by the build.
#
# Instead of `pnpm deploy` (which mangles this workspace: link:/workspace:/
# native packages become symlinks back into $srcdir and peer-only workspace
# packages get dropped), the whole built workspace tree is installed to
# /usr/lib/dsh. Every symlink pnpm wrote is relative within that tree, so the
# result is fully self-contained. After the build, prune-dev-deps.mjs removes
# dev-only packages from node_modules/.pnpm (the runtime closure is rooted at
# apps/cli and apps/electron), so the package ships production dependencies
# only.

pkgbase=deepseek-harness
pkgname=('deepseek-harness' 'deepseek-harness-desktop')
pkgver=0.1.3_alpha.2
pkgrel=1
arch=('x86_64' 'aarch64')
url="https://github.com/deepseek-ai/deepseek-harness"
license=('MIT')
# The pnpm store ships hundreds of prebuilt .node binaries; gdb-add-index on
# each one makes packaging take hours and the debug package is useless.
options=('!debug' '!strip')
# The PKGBUILD sits at the root of this checkout, so the source is this very
# directory. `$startdir` is the directory containing the PKGBUILD (makepkg sets
# it before sourcing this file); the build consumes it read-only via a
# `git+file://` clone into $srcdir. Replace with the upstream git URL if you
# move the PKGBUILD out of the tree.
_dsh_src="git+file://$startdir#branch=desktop"
source=("${_dsh_src}"
        "prune-dev-deps.mjs")
sha256sums=('SKIP'
            'SKIP')
# Set _exclude_pi_ai=1 to omit the pi-ai multi-provider adapter from the base
# profile. Drops ~42 MB of vendor SDKs (@earendil-works/pi-ai pulls openai,
# @anthropic-ai/sdk, @google/genai, and typebox) at the cost of the web Models
# page's "add custom provider" flow, which writes into the llm-pi-ai settings
# namespace. Default off: the base profile ships pi-ai dormant (zero routes
# until a settings section enables it).
_exclude_pi_ai=${_exclude_pi_ai:-0}
# node-pty and koffi compile native addons; python + base-devel (gcc/make)
# cover that. corepack activates the pnpm version pinned in package.json.
makedepends=('git' 'nodejs' 'corepack' 'python')

pkgver() {
  cd "$srcdir/deepseek-harness"
  node -p "require('./package.json').version.replace('-rc.', '_rc').replace('-', '_')"
}

prepare() {
  cd "$srcdir/deepseek-harness"
  # The node:url browser stub (apps/web/src/node-url-stub.ts) and its vite
  # alias already exist in the electron branch, so no patch is needed here.
  corepack prepare pnpm@11.7.0 --activate
  # deepseek-harness-desktop uses the system Electron package; skip the ~100 MB platform
  # binary download that Electron's install script would otherwise perform.
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
}

build() {
  cd "$srcdir/deepseek-harness"
  DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE='DeepSeek Harness' DSH_CLIENT_REVISION_BADGE=true pnpm run build
  #pnpm run build
  # the Electron main process is its own tsdown build, not part of `pnpm build`
  pnpm --filter @deepseek-ai/dsh-electron run build
  # Optional: drop the pi-ai multi-provider adapter (and its ~42 MB of vendor
  # SDKs) before pruning. Removes it from the base bundle manifest and its
  # cordis composition so the loader never tries to resolve the missing package.
  if [[ "$_exclude_pi_ai" == 1 ]]; then
    node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

// 1. Drop the dependency from the base bundle manifest.
const pkgPath = path.join(process.cwd(), 'packages/bundle/base/package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (!pkg.dependencies || !('@deepseek-ai/dsh-llm-pi-ai' in pkg.dependencies)) {
  console.error('exclude-pi-ai: @deepseek-ai/dsh-llm-pi-ai not in bundle/base dependencies')
  process.exit(1)
}
delete pkg.dependencies['@deepseek-ai/dsh-llm-pi-ai']
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 2. Drop the llm-pi-ai entry (and its leading comment block) from the
//    composition, so the loader never references the removed package.
const yamlPath = path.join(process.cwd(), 'packages/bundle/base/cordis.patch.yml')
const lines = fs.readFileSync(yamlPath, 'utf8').split('\n')
const idx = lines.findIndex((line) => line.trim() === '- id: llm-pi-ai')
if (idx === -1) {
  console.error('exclude-pi-ai: llm-pi-ai entry not in bundle/base/cordis.patch.yml')
  process.exit(1)
}
let start = idx
while (start - 1 >= 0 && /^\s*#/.test(lines[start - 1])) start -= 1
lines.splice(start, (idx + 1) - start + 1)
fs.writeFileSync(yamlPath, lines.join('\n'))
console.error('exclude-pi-ai: removed @deepseek-ai/dsh-llm-pi-ai from bundle/base')
NODE
  fi
  # Now that everything is built, slim the tree: prune dev-only packages from
  # node_modules/.pnpm (rooted at apps/cli and apps/electron), strip foreign
  # prebuilds, and delete non-runtime workspace members and source/tests/build
  # metadata (see prune-dev-deps.mjs for why `pnpm prune --prod` cannot be
  # used here).
  node "$srcdir/prune-dev-deps.mjs" .
}

# Install the built workspace (runtime packages, apps, config, node_modules)
# to /usr/lib/deepseek-harness, minus clearly dev-only trees. prune-dev-deps.mjs
# has already deleted non-runtime workspace members and source/tests/build
# metadata; these excludes cover the top-level dev/deploy trees it leaves alone.
# Symlinks are preserved as-is; they are all relative, so they stay valid.
install_tree() {
  cd "$srcdir/deepseek-harness"
  install -d "$1"
  tar -cf - \
    --exclude=./.git \
    --exclude=./.gitlab-ci.yml \
    --exclude=./.sessions \
    --exclude=./.agents \
    --exclude=./.claude \
    --exclude=./.github \
    --exclude=./website \
    --exclude=./docs \
    --exclude=./snapshots \
    --exclude=./scripts \
    --exclude=./python \
    . | tar -xf - -C "$1"
  # node_modules/.bin shims are package-manager CLIs (build/dev tools, never
  # invoked by the runtime) that also embed absolute $srcdir paths in their
  # NODE_PATH; drop every .bin directory at any depth.
  find "$1" -type d -name .bin -prune -exec rm -rf {} +
}

package_deepseek-harness() {
  pkgdesc="DeepSeek Harness CLI: open-source agent harness where everything is a plugin"
  depends=('nodejs>=22.19')
  install_tree "$pkgdir/usr/lib/deepseek-harness"

  install -d "$pkgdir/usr/bin"
  ln -s /usr/lib/deepseek-harness/apps/cli/lib/bin.js "$pkgdir/usr/bin/deepseek-harness"
  install -Dm644 "$srcdir/deepseek-harness/LICENSE" \
    "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}

package_deepseek-harness-desktop() {
  pkgdesc="DeepSeek Harness desktop launcher (Electron)"
  depends=('nodejs>=22.19' 'electron' 'deepseek-harness')

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/deepseek-harness-desktop" <<'EOF'
#!/bin/sh
exec /usr/bin/electron /usr/lib/deepseek-harness/apps/electron "$@"
EOF

  install -Dm644 /dev/stdin "$pkgdir/usr/share/applications/deepseek-harness-desktop.desktop" <<'EOF'
[Desktop Entry]
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop launcher
Exec=deepseek-harness-desktop
Icon=io.deepseek.harness
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=io.deepseek.harness
EOF

  install -Dm644 "$srcdir/deepseek-harness/LICENSE" \
    "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
