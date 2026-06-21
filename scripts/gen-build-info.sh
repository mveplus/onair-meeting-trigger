#!/usr/bin/env bash
# Write extension/build-info.json from the current git state so an
# unpacked dev build can show which commit/branch is loaded. The file is
# gitignored; the in-extension badge only renders for non-main branches
# (see formatBuildBadge in extension/shared.js), so packed/release builds
# cut from main — or CI's detached HEAD — show nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/extension/build-info.json"

commit="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
dirty=false
if ! git -C "$ROOT" diff --quiet HEAD 2>/dev/null; then dirty=true; fi
builtAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$OUT" <<JSON
{
  "commit": "$commit",
  "branch": "$branch",
  "dirty": $dirty,
  "builtAt": "$builtAt"
}
JSON

echo "wrote $OUT ($branch @ $commit, dirty=$dirty)"
