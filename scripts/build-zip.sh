#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT/extension"

ZIP="$ROOT/dist.zip"
rm -f "$ZIP"
zip -r "$ZIP" . -x "*.DS_Store"

echo "Built $ZIP"
