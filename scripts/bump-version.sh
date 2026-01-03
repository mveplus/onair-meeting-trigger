#!/usr/bin/env bash
set -euo pipefail

# Bumps extension/manifest.json "version" to the given SemVer string.
# Usage:
#   ./scripts/bump-version.sh 0.1.2
#
# Then:
#   git commit -am "Bump version to 0.1.2"
#   git tag v0.1.2
#   git push origin main --tags

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/extension/manifest.json"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>   (example: $0 0.1.2)" >&2
  exit 2
fi

VER="$1"

# Basic SemVer check: X.Y.Z where X,Y,Z are integers
if ! [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must look like 0.1.2 (SemVer X.Y.Z)" >&2
  exit 2
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "Error: manifest not found at $MANIFEST" >&2
  exit 1
fi

# Require clean working tree (prevents tagging dirty states)
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit/stash your changes first." >&2
  git -C "$ROOT" status --porcelain >&2
  exit 1
fi

python3 - "$MANIFEST" "$VER" <<'PY'
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
ver = sys.argv[2]

data = json.loads(path.read_text(encoding="utf-8"))
data["version"] = ver
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"Updated {path} -> version={ver}")
PY

echo
echo "Next:"
echo "  git add extension/manifest.json"
echo "  git commit -m \"Bump version to $VER\""
echo "  git tag v$VER"
echo "  git push origin main --tags"

