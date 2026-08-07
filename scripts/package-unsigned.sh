#!/usr/bin/env bash
# Package the release .app as an unsigned ZIP for GitHub Releases + install.sh.
#
# Run after: yarn tauri:build
#
# Produces:
#   dist-release/Myna-Notes-macos-arm64.zip
#
# Upload that asset on the GitHub Release. install.sh expects this name by default.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_SRC="${MYNA_APP_SRC:-}"
if [[ -z "$APP_SRC" ]]; then
  # Tauri default macOS bundle location
  CANDIDATES=(
    "src-tauri/target/release/bundle/macos/Myna Notes.app"
    "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Myna Notes.app"
  )
  for c in "${CANDIDATES[@]}"; do
    if [[ -d "$c" ]]; then
      APP_SRC="$c"
      break
    fi
  done
fi

[[ -n "${APP_SRC:-}" && -d "$APP_SRC" ]] || {
  echo "error: could not find Myna Notes.app" >&2
  echo "Build first: yarn tauri:build" >&2
  echo "Or set MYNA_APP_SRC=/path/to/Myna Notes.app" >&2
  exit 1
}

OUT_DIR="${MYNA_OUT_DIR:-dist-release}"
ASSET="${MYNA_ASSET:-Myna-Notes-macos-arm64.zip}"
mkdir -p "$OUT_DIR"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/myna-package.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

echo "→ Staging $(basename "$APP_SRC")"
ditto "$APP_SRC" "$STAGE/Myna Notes.app"

# Clear any local quarantine so the zipped app is a clean tree.
xattr -cr "$STAGE/Myna Notes.app" 2>/dev/null || true

ZIP_PATH="${OUT_DIR}/${ASSET}"
rm -f "$ZIP_PATH"
echo "→ Writing ${ZIP_PATH}"
(
  cd "$STAGE"
  # -y store symlinks as links; -r recurse
  ditto -c -k --sequesterRsrc --keepParent "Myna Notes.app" "$ROOT/$ZIP_PATH"
)

echo "✓ Packaged $(du -h "$ZIP_PATH" | awk '{print $1}') → ${ZIP_PATH}"
echo
echo "Publish:"
echo "  1. Create a GitHub Release (tag v0.1.0, etc.)"
echo "  2. Upload ${ASSET}"
echo "  3. Users install with:"
echo "       curl -fsSL https://raw.githubusercontent.com/crstnmac/myna-notes/main/scripts/install.sh | bash"
