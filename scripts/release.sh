#!/usr/bin/env bash
#
# Cut a release: bump extension/manifest.json + VERSION, commit
# "Release vX.Y.Z", tag vX.Y.Z and push main + that tag. The pushed tag
# starts .github/workflows/release.yml (GitHub release + Chrome Web Store
# draft).
#
# Usage:  scripts/release.sh [--dry-run] X.Y.Z
#
# Safe to re-run: if a previous run made the release commit but stopped
# before tagging or pushing, running it again with the same version finishes
# the job instead of failing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die()  { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✓ $*"; }
step() { echo "→ $*"; }

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 [--dry-run] <version>   (example: $0 0.8.1)" >&2
  exit 2
fi
VER="${1#v}"
TAG="v$VER"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be SemVer X.Y.Z (got '$1')"

# --- where are we? -------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || die "releases are cut from main (you're on '$BRANCH')"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  die "working tree is not clean — commit or stash first"
fi

step "Fetching origin…"
git fetch -q origin main --tags || die "git fetch failed — are you online?"

CUR="$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')"
HEAD_MSG="$(git log -1 --format=%s)"

# A previous run that committed but didn't tag/push: resume from there.
RESUME=0
if [[ "$CUR" == "$VER" && "$HEAD_MSG" == "Release $TAG" ]]; then
  RESUME=1
  ok "Release commit for $TAG already exists — resuming (tag + push)"
fi

# main must not be behind origin (ahead is fine when resuming).
BEHIND="$(git rev-list --count HEAD..origin/main)"
[[ "$BEHIND" == "0" ]] || die "main is $BEHIND commit(s) behind origin/main — run 'git pull --ff-only' first"
AHEAD="$(git rev-list --count origin/main..HEAD)"
if [[ "$AHEAD" != "0" && $RESUME -eq 0 ]]; then
  die "main has $AHEAD unpushed commit(s) — push or drop them before releasing"
fi

# --- version checks ------------------------------------------------------
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "tag $TAG already exists locally"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists on origin"
fi

if [[ $RESUME -eq 0 ]]; then
  NEWER="$(printf '%s\n%s\n' "$CUR" "$VER" | sort -V | tail -1)"
  [[ "$NEWER" == "$VER" && "$CUR" != "$VER" ]] || die "$VER is not newer than the current version $CUR"
  ok "Version $CUR → $VER"
fi

# --- changelog -----------------------------------------------------------
# Promote the [Unreleased] notes to "## [X.Y.Z] — today" (and fix the
# compare links) unless a section for this version is already there. The
# file is only written for a real run; it goes into the release commit.
CHANGELOG_PY='
import re, sys, datetime
from pathlib import Path
ver, write = sys.argv[1], sys.argv[2] == "1"
p = Path("CHANGELOG.md")
s = p.read_text(encoding="utf-8")
if re.search(r"^## \[" + re.escape(ver) + r"\]", s, re.M):
    print("has"); sys.exit(0)
m = re.search(r"^## \[Unreleased\][^\n]*\n(.*?)(?=^## \[)", s, re.M | re.S)
if not m:
    print("no-unreleased"); sys.exit(0)
notes = m.group(1).strip("\n")
notes = re.sub(r"\n{3,}", "\n\n", notes)
count = sum(1 for l in notes.splitlines() if l.startswith("- "))
body = notes if notes.strip() else "_No notable changes._"
date = datetime.date.today().isoformat()
s = s[:m.start()] + f"## [Unreleased]\n\n## [{ver}] — {date}\n\n{body}\n\n" + s[m.end():]
link = re.search(r"^\[Unreleased\]: (\S+)/compare/(v[\d.]+)\.\.\.HEAD$", s, re.M)
if link:
    base, prev = link.group(1), link.group(2)
    s = s.replace(link.group(0),
        f"[Unreleased]: {base}/compare/v{ver}...HEAD\n[{ver}]: {base}/compare/{prev}...v{ver}")
if write:
    p.write_text(s, encoding="utf-8")
print(f"moved {count}")
'
if [[ -f CHANGELOG.md ]]; then
  CL="$(python3 -c "$CHANGELOG_PY" "$VER" 0)"
  case "$CL" in
    has)           ok "CHANGELOG.md already has a $VER section" ;;
    no-unreleased) die "CHANGELOG.md has no '## [Unreleased]' section to promote" ;;
    "moved 0")     ok "CHANGELOG.md: [Unreleased] is empty — $VER will say 'No notable changes'" ;;
    moved*)        ok "CHANGELOG.md: ${CL#moved } [Unreleased] entr$([[ ${CL#moved } == 1 ]] && echo y || echo ies) → [$VER] — $(date +%F)" ;;
  esac
fi

# --- tests ---------------------------------------------------------------
if [[ -f package.json ]] && command -v npm >/dev/null 2>&1; then
  step "Running tests…"
  npm test --silent >/dev/null 2>&1 || die "npm test failed — fix before releasing (run 'npm test' to see why)"
  ok "Tests pass"
fi

if [[ $DRY -eq 1 ]]; then
  ok "Dry run: all checks passed — nothing changed"
  exit 0
fi

# --- bump + commit -------------------------------------------------------
if [[ $RESUME -eq 0 ]]; then
  python3 - "$VER" <<'PY'
import json, sys
from pathlib import Path

ver = sys.argv[1]
m = Path("extension/manifest.json")
data = json.loads(m.read_text(encoding="utf-8"))
data["version"] = ver
m.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
Path("VERSION").write_text(ver + "\n", encoding="utf-8")
PY
  if [[ -f CHANGELOG.md && "$CL" == moved* ]]; then
    python3 -c "$CHANGELOG_PY" "$VER" 1 >/dev/null
    git add CHANGELOG.md
  fi
  git add extension/manifest.json VERSION
  git commit -q -m "Release $TAG"
  ok "Committed 'Release $TAG'"
fi

# --- tag + push ----------------------------------------------------------
# Annotated tag with a message: works with or without tag.gpgsign (a
# lightweight `git tag vX` fails with "no tag message?" when signing is on).
git tag -a "$TAG" -m "Release $TAG"
ok "Tagged $TAG"

step "Pushing main + $TAG…"
if ! git push --atomic origin main "refs/tags/$TAG"; then
  echo "✗ Push failed. The commit and tag are local — fix the problem and re-run:" >&2
  echo "    git tag -d $TAG && $0 $VER" >&2
  exit 1
fi

REPO_URL="$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')"
ok "Released $TAG"
echo "  Workflow: $REPO_URL/actions/workflows/release.yml"
echo "  Release:  $REPO_URL/releases/tag/$TAG"
