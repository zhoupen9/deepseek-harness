# Maintainer: Zhou Peng <zhoupen9@outlook.com>
#
# Builds the DeepSeek Harness (dsh) CLI and the Electron desktop application
# from the local source checkout at ~/Sources/deepseek-harness.
# The source is consumed read-only via a `git+file://` clone into $srcdir, so
# nothing inside the source tree is modified by the build.
#
# Instead of `pnpm deploy` (which mangles this workspace: link:/workspace:/
# native packages become symlinks back into $srcdir and peer-only workspace
# packages get dropped), the whole built workspace tree is installed to
# /usr/lib/dsh. Every symlink pnpm wrote is relative within that tree, so the
# result is fully self-contained. After the build, prune-dev-deps.mjs removes
# dev-only packages from node_modules/.pnpm (the runtime closure is rooted at
# apps/cli), so the package ships production dependencies only.

pkgbase=deepseek-harness
pkgname=('deepseek-harness' 'deepseek-harness-desktop')
pkgver=0.1.7_rc.2
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
# Set _skip_runtime_smoke=0 to run the packaged payload and Host smoke checks.
# They execute the packaged payload on the system Node.js and pass on this host,
# but add a few minutes to every package build. Only linux-x64 accepts
# --skip-runtime-smoke.
_skip_runtime_smoke=${_skip_runtime_smoke:-1}
# node-pty and koffi compile native addons; python + base-devel (gcc/make)
# cover that. corepack activates the pnpm version pinned in package.json. The
# desktop payload uses the build host's Node.js, pnpm and Python packages
# instead of shipping downloaded interpreters, so they are makedepends too; the
# build likewise assembles the application against the distribution Electron.
# python-pptx is missing from some Arch mirrors; install it manually (for
# example `python -m pip install --break-system-packages python-pptx`) before
# building, or add the package here when the mirror provides it.
_system_python_packages=(python-numpy python-pandas python-pillow python-lxml
  python-openpyxl python-docx python-xlsxwriter python-dateutil python-six
  python-tzdata python-typing_extensions python-et-xmlfile)
makedepends=('git' 'nodejs' 'pnpm' 'corepack' 'python' 'electron' "${_system_python_packages[@]}")

# The returned string must equal the pkgver= above: when it differs, makepkg
# rewrites pkgver= to this value and forces pkgrel=1 (update_pkgver), which
# drops a release bump.
pkgver() {
  cd "$srcdir/deepseek-harness"
  # Arch pkgver forbids '-'; the separator maps to '_': 0.1.6-alpha.2 -> 0.1.6_alpha.2.
  node -p "require('./package.json').version.replace('-rc.', '_rc.').replace('-', '_')"
}

prepare() {
  cd "$srcdir/deepseek-harness"
  # The node:url browser stub (apps/web/src/node-url-stub.ts) and its vite
  # alias already exist in the electron branch, so no patch is needed here.
  corepack prepare pnpm@11.7.0 --activate
  # Packaging assembles the application against the distribution Electron
  # (DSH_DESKTOP_SYSTEM_ELECTRON below), so Electron's own install script must
  # not download the ~100 MB copy this build never uses.
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
  # The Linux packaging reads apps/desktop/.env.linux (see
  # scripts/desktop-package-environment.mjs). The file is git-ignored, so the
  # clone lacks it; copy the local copy from the checkout instead of committing
  # release settings.
  local env_file="$startdir/apps/desktop/.env.linux"
  if [[ ! -f "$env_file" ]]; then
    error "missing $env_file; copy apps/desktop/.env.linux.example and fill it in"
    return 1
  fi
  install -Dm600 "$env_file" apps/desktop/.env.linux
}

build() {
  cd "$srcdir/deepseek-harness"
  DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE='DeepSeek Harness' DSH_CLIENT_REVISION_BADGE=true pnpm run build
  #pnpm run build
  # Package the desktop application: this assembles an unpacked Electron
  # application under apps/desktop/.desktop-build/targets/linux-x64/artifacts/
  # linux-unpacked. DSH_DESKTOP_SYSTEM_RUNTIME selects the host's Python,
  # Node.js and pnpm for the payload instead of downloading and bundling them,
  # and assembles the application against the distribution Electron instead of
  # downloading one of its own.
  local smoke_args=()
  [[ "$_skip_runtime_smoke" == 1 ]] && smoke_args+=(--skip-runtime-smoke)
  DSH_DESKTOP_SYSTEM_RUNTIME=1 \
    DSH_DESKTOP_SYSTEM_PYTHON=/usr/bin/python3 \
    DSH_DESKTOP_SYSTEM_NODE=/usr/bin/node \
    DSH_DESKTOP_SYSTEM_PNPM=/usr/bin/pnpm \
    DSH_DESKTOP_SYSTEM_ELECTRON=/usr/lib/electron \
    pnpm run package:desktop:linux:x64:dir "${smoke_args[@]}"
  # Stage the payload outside the workspace tree: the runtime prune below
  # deletes non-runtime workspace members, apps/desktop among them. Only
  # resources/ is staged, because the launcher runs the distribution Electron
  # instead of the Electron copy electron-builder assembles beside it.
  rm -rf "$srcdir/desktop-app"
  cp -a apps/desktop/.desktop-build/targets/linux-x64/artifacts/linux-unpacked/resources "$srcdir/desktop-app"
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
  # node_modules/.pnpm (rooted at apps/cli), strip foreign
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
  pkgdesc="DeepSeek Harness desktop application (distribution Electron with system Python and Node.js)"
  # The payload carries the dsh tree; Electron, Node.js, pnpm and the Python
  # libraries come from the distribution, so the package follows their version
  # and security updates and needs neither a second Electron copy nor the CLI
  # package.
  depends=('electron' 'nodejs' 'pnpm' 'python' "${_system_python_packages[@]}")

  install -d "$pkgdir/usr/lib/deepseek-harness-desktop/resources"
  cp -a "$srcdir/desktop-app/." "$pkgdir/usr/lib/deepseek-harness-desktop/resources/"

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/deepseek-harness-desktop" <<'EOF'
#!/bin/sh
# A distribution Electron reports an explicit application path as an unpackaged
# run, and its own resources directory; the flag keeps the payload on its
# packaged resources and runtime.
export ELECTRON_FORCE_IS_PACKAGED=true
exec /usr/bin/electron /usr/lib/deepseek-harness-desktop/resources/app.asar "$@"
EOF

  install -Dm644 "$srcdir/desktop-app/icon.png"     "$pkgdir/usr/share/icons/hicolor/1024x1024/apps/deepseek-harness.png"

  install -Dm644 /dev/stdin "$pkgdir/usr/share/applications/deepseek-harness-desktop.desktop" <<'EOF'
[Desktop Entry]
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop application
Exec=deepseek-harness-desktop
Icon=deepseek-harness
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=deepseek-harness
EOF

  install -Dm644 "$srcdir/deepseek-harness/LICENSE" \
    "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
