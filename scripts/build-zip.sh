#!/usr/bin/env bash
# Build the store packages from extension/:
#   dist.zip          Chrome / Chromium (extension/ as-is)
#   dist-firefox.zip  Firefox (manifest from scripts/firefox-manifest.mjs)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Stamp the build with git metadata. The in-extension badge only shows
# for non-main branches, so a release zip cut from main (or CI's detached
# HEAD) carries an inert build-info.json.
"$ROOT/scripts/gen-build-info.sh" || true

ZIP="$ROOT/dist.zip"
rm -f "$ZIP"
(cd "$ROOT/extension" && zip -qr "$ZIP" . -x "*.DS_Store")
echo "Built $ZIP"

# Firefox: same files, Firefox manifest. Built in a temp copy so extension/
# is never modified.
FFZIP="$ROOT/dist-firefox.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -r "$ROOT/extension/." "$TMP/"
node "$ROOT/scripts/firefox-manifest.mjs" "$ROOT/extension/manifest.json" "$TMP/manifest.json"
rm -f "$FFZIP"
(cd "$TMP" && zip -qr "$FFZIP" . -x "*.DS_Store")
echo "Built $FFZIP"
