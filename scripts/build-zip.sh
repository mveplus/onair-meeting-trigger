#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Stamp the build with git metadata. The in-extension badge only shows
# for non-main branches, so a release zip cut from main (or CI's detached
# HEAD) carries an inert build-info.json.
"$ROOT/scripts/gen-build-info.sh" || true

cd "$ROOT/extension"

ZIP="$ROOT/dist.zip"
rm -f "$ZIP"
zip -r "$ZIP" . -x "*.DS_Store"

echo "Built $ZIP"
