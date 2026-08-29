#!/bin/sh
# Launch the DeepSeek Harness Electron desktop shell from a source checkout.
#
# The shell boots `dsh web --no-open` as a child and loads its authenticated
# URL in a native window. The child CLI must run under real Node (not the
# Electron binary), and the shell needs a system Electron binary, so both are
# pinned here to make the desktop launcher independent of a desktop session's
# often-minimal PATH.
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# Pin runtimes; honor explicit overrides so advanced users can redirect.
: "${DSH_ELECTRON_BIN:=/usr/bin/electron}"
: "${DSH_NODE:=/usr/bin/node}"
export DSH_ELECTRON_BIN DSH_NODE

exec /usr/bin/node "$APP_DIR/scripts/electron.mjs" "$APP_DIR"
