#!/usr/bin/env bash
# Build the Swift `fluidasr` sidecar and deploy it to the paths the app runs from:
#   - src-tauri/binaries/fluidasr-<triple>   (Tauri externalBin -> bundled into the .app)
#   - src-tauri/target/debug/fluidasr         (used by `tauri dev`, if that dir exists)
#
# Run automatically via `beforeDevCommand` / `beforeBuildCommand` in tauri.conf.json
# so a code change in fluid-sidecar/ can never leave a stale binary behind. `swift
# build` is incremental, so this is ~1s when nothing changed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_DIR="$ROOT/fluid-sidecar"

# Tauri externalBin expects the target-triple suffix. Derive it from the host.
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TRIPLE="x86_64-apple-darwin" ;;
  *) echo "build-sidecar: unsupported arch '$ARCH'" >&2; exit 1 ;;
esac

echo "build-sidecar: swift build -c release ($SIDECAR_DIR)"
( cd "$SIDECAR_DIR" && swift build -c release )

BIN_DIR="$(cd "$SIDECAR_DIR" && swift build -c release --show-bin-path)"
SRC="$BIN_DIR/fluidasr"
[ -x "$SRC" ] || { echo "build-sidecar: built binary not found at $SRC" >&2; exit 1; }

BUNDLED="$ROOT/src-tauri/binaries/fluidasr-$TRIPLE"
mkdir -p "$(dirname "$BUNDLED")"
cp "$SRC" "$BUNDLED"
echo "build-sidecar: deployed -> $BUNDLED"

# Dev path: only when a debug build dir already exists (i.e. during/after `tauri dev`).
DEV_DIR="$ROOT/src-tauri/target/debug"
if [ -d "$DEV_DIR" ]; then
  cp "$SRC" "$DEV_DIR/fluidasr"
  echo "build-sidecar: deployed -> $DEV_DIR/fluidasr"
fi
