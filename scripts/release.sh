#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <version>   (example: $0 0.1.2)" >&2
  exit 2
fi

VER="$1"
if ! [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must look like 0.1.2 (SemVer X.Y.Z)" >&2
  exit 2
fi

# Require clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit/stash first." >&2
  git status --porcelain >&2
  exit 1
fi

# Prevent accidental duplicate tag
if git rev-parse "v$VER" >/dev/null 2>&1; then
  echo "Error: tag v$VER already exists." >&2
  exit 1
fi

# Bump manifest + VERSION
python3 - <<PY
import json
from pathlib import Path

ver = "$VER"

m = Path("extension/manifest.json")
data = json.loads(m.read_text(encoding="utf-8"))
data["version"] = ver
m.write_text(json.dumps(data, indent=2) + "\\n", encoding="utf-8")

Path("VERSION").write_text(ver + "\\n", encoding="utf-8")
print("Updated manifest + VERSION to", ver)
PY

git add extension/manifest.json VERSION
git commit -m "Release v$VER"

git tag "v$VER"

git push origin main --tags
echo "Released v$VER"
