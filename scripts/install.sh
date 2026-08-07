#!/usr/bin/env bash
# Myna Notes — free unsigned install for macOS (Apple Silicon).
#
# This is NOT notarization. Gatekeeper still treats random internet apps as
# untrusted; we remove the download quarantine flag so a technical user can
# install without an Apple Developer Program membership.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/masconics/myna-notes/main/scripts/install.sh | bash
#
# Safer (inspect first):
#   curl -fsSL https://raw.githubusercontent.com/masconics/myna-notes/main/scripts/install.sh -o install.sh
#   less install.sh
#   bash install.sh
#
# Overrides:
#   MYNA_RELEASE_URL=https://…/Myna-Notes-macos-arm64.zip bash install.sh
#   MYNA_VERSION=0.1.0 bash install.sh   # downloads that tag's asset
#   MYNA_APP_DIR=~/Applications bash install.sh

set -euo pipefail

APP_NAME="Myna Notes"
REPO="${MYNA_REPO:-masconics/myna-notes}"
ASSET="${MYNA_ASSET:-Myna-Notes-macos-arm64.zip}"
INSTALL_DIR="${MYNA_APP_DIR:-/Applications}"

die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

need curl
need unzip
need ditto

[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
[[ "$(uname -m)" == "arm64" ]] || die "Apple Silicon (arm64) only for now"

if [[ -n "${MYNA_RELEASE_URL:-}" ]]; then
  URL="$MYNA_RELEASE_URL"
elif [[ -n "${MYNA_VERSION:-}" ]]; then
  URL="https://github.com/${REPO}/releases/download/v${MYNA_VERSION#v}/${ASSET}"
else
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/myna-install.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "→ Downloading ${APP_NAME}"
echo "  ${URL}"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip" \
  || die "download failed (is the GitHub Release asset published as ${ASSET}?)"

echo "→ Unpacking"
unzip -q "$TMP/app.zip" -d "$TMP/out"

# Prefer a top-level .app; otherwise first match.
APP="$(find "$TMP/out" -maxdepth 3 -type d -name "*.app" -print -quit || true)"
[[ -n "${APP:-}" && -d "$APP" ]] || die "archive did not contain a .app bundle"

# Free workaround: clear the quarantine xattr that marks the download as
# untrusted. Users who run this script are opting into that trust decision.
if xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1; then
  echo "→ Clearing download quarantine (unsigned build)"
fi
xattr -cr "$APP" 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/$(basename "$APP")"
echo "→ Installing to ${DEST}"
rm -rf "$DEST"
# ditto preserves bundle metadata better than cp -R for .app trees
ditto "$APP" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Ad-hoc sign the whole bundle so Gatekeeper at least sees *a* signature.
# Does not replace Developer ID + notarization for public downloads.
if command -v codesign >/dev/null 2>&1; then
  echo "→ Ad-hoc codesign (local only; not Developer ID)"
  codesign --force --deep --sign - "$DEST" 2>/dev/null || true
fi

echo "✓ Installed ${APP_NAME}"
echo "  Open with: open \"${DEST}\""
echo
echo "If macOS still blocks it:"
echo "  xattr -dr com.apple.quarantine \"${DEST}\""
echo "  # or Finder → right-click the app → Open → Open"
echo

if [[ "${MYNA_OPEN:-1}" == "1" ]]; then
  open "$DEST" || true
fi
