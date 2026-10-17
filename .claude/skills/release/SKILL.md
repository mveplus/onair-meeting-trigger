---
name: release
description: Cut and ship a release of the ON-AIR Meeting Trigger extension to GitHub, the Chrome Web Store and Firefox Add-ons (AMO). Use when the user asks to release, cut/tag a version, publish, push a new version to the stores, or check why a release/store upload failed.
---

# Release the extension

The user runs the irreversible steps; Claude prepares, checks and reports.
Full reference: the "Release process" section of `CLAUDE.md`.

## 1. Before cutting

1. All release PRs are merged to `main`; `git checkout main && git pull --ff-only`.
2. `CHANGELOG.md` → `[Unreleased]` lists what's shipping (add missing
   entries via a PR — `main` is protected). Pick the SemVer bump from it.
3. `npm test` passes.
4. `scripts/release.sh --dry-run X.Y.Z` — every check green.

## 2. Cut (the user runs it, or confirms first)

`scripts/release.sh X.Y.Z` — promotes the changelog, bumps manifest +
VERSION, commits `Release vX.Y.Z`, annotated tag, atomic push.

- **Never tag by hand** (no manifest bump → the workflow's version check fails).
- **Never delete remote tags** — that's blocked for Claude; ask the user to do it.
- A failed run is resumable: re-run the same command.

## 3. Watch the workflow

`gh run list --workflow release.yml -L 1`, then `gh run watch <id>` /
`gh run view <id> --log-failed`. Read the run summary for the store steps.

| Step result | Meaning | What to do |
|---|---|---|
| CWS `result=uploaded` | Draft in the Chrome Web Store | User clicks **Submit for review** in the dev console |
| CWS `result=blocked` | Previous version `PENDING_REVIEW` / `STAGED` | User waits / cancels review / publishes, then **Actions → Upload to Chrome Web Store** with this tag |
| AMO `result=submitted` | Mozilla reviews it automatically | Nothing; status in the Developer Hub |
| AMO `result=skipped` | `AMO_JWT_*` secrets missing | Add secrets, then **Actions → Upload to Firefox Add-ons** |
| AMO failed (`continue-on-error`) | Usually version already on AMO | Bump the version; don't re-upload the same number |

## 4. Manual store uploads — check the version first

Before running a manual upload workflow, confirm the tag is the **latest
release** (`gh release list -L 3`) and that the user means that version.
Uploading an older release replaces the newer draft in the store.

## 5. Report

Tell the user: tag, workflow link, release link, each store's result and
the one action left for them (Submit for review / wait for AMO).
