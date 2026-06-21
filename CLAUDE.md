# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**ON-AIR Meeting Trigger** is a Chromium MV3 browser extension. It detects Meet/Zoom/Teams/custom
meeting tabs and triggers a local/remote http/s service and/or an ON-AIR LED sign on the LAN (and
beyond). Pairs with the `onair-led-sign-firmware` project.

```text
extension/         The MV3 extension (this is what ships)
  manifest.json    MV3 manifest — `version` here is the source of truth for releases
  background.js    Service worker: tab detection + trigger dispatch
  shared.js        Pure helpers shared by background.js + options.js (no browser
                   globals at import time — the only file the test suite imports)
  popup.{html,js}  Toolbar popup UI
  options.{html,js} Settings page (endpoints, sign config). options.html loads
                   options.js as `type="module"` so it can import shared.js.
  icons/
tests/             Node built-in test runner specs for shared.js (`npm test`)
package.json       `type:module`; `npm test` → `node --test`
scripts/           Release tooling (build-zip.sh, release.sh)
.github/workflows/release.yml   Tag-triggered release + Chrome Web Store upload
VERSION            Mirror of manifest version, bumped by release.sh
docs/, resources/  Documentation and store assets
```

## Architecture notes

- **`shared.js` is the single source of truth for pure logic** (templating,
  service matching, mode/timeout clamping, listener-URL building, HTTP-hook
  success evaluation, secret splitting, security warnings). `background.js` and
  `options.js` must call into it rather than re-implementing — that's what keeps
  the live dispatch and the options "Test" buttons in agreement, and what the
  tests exercise. Keep `shared.js` free of `chrome.*`, `window`, `document`, and
  `fetch` at import time.
- **Credentials never sync.** Tokens (`localToken`, `cloudToken`,
  `basicAuth.pass`, `Authorization`/`X-API-Token` headers) live in
  `chrome.storage.local` via `extractSecrets`/`applySecrets`; only the sanitized
  config goes to `chrome.storage.sync`. Exports run through `redactSecrets`.
- **Privacy:** the meeting tab URL is gated behind the `includeMeetingUrl`
  setting (default off) — see `meetingUrlForVars`.
- **MV3 reliability:** a 1-minute `chrome.alarms` reconcile heartbeat
  (`alarms` permission) re-derives state so a suspended worker can't leave the
  sign stale; the 400 ms `setTimeout` debounce is kept for sub-second coalescing.

## Tests

```bash
npm test          # runs tests/*.test.js via Node's built-in runner (no deps)
```

## Release process

Releases are cut from a SemVer git tag `vX.Y.Z`. The whole flow is two parts: a local helper that
bumps + tags, and a GitHub Actions workflow that builds and publishes on the pushed tag.

### Cut a release

```bash
# From repo root, with a clean working tree:
scripts/release.sh 0.3.8
```

`scripts/release.sh <version>` (version must be bare SemVer `X.Y.Z`, no leading `v`):

1. Refuses to run if the working tree is dirty or if tag `vX.Y.Z` already exists.
2. Writes the version into `extension/manifest.json` and `VERSION`.
3. Commits `Release vX.Y.Z`, creates tag `vX.Y.Z`, and pushes `main` + tags.

### What the tag triggers (`.github/workflows/release.yml`)

On any pushed `v*` tag the `release` job:

1. **Verify manifest version matches tag** — fails the run if `extension/manifest.json` `version`
   != tag (minus the `v`). This is why the bump and tag must stay in lockstep — always use
   `release.sh`, don't tag by hand.
2. **Build extension zip** — `scripts/build-zip.sh` zips `extension/` into `dist.zip`.
3. **Replace existing release** — deletes a pre-existing GitHub release for the tag so a re-run on
   the same tag can recreate it cleanly (the tag itself is left intact).
4. **Create GitHub release** — `softprops/action-gh-release` attaches `dist.zip` and auto-generates
   release notes.
5. **Upload to Chrome Web Store (draft)** — pushes `dist.zip` as a *draft* version via the CWS API.
   It does **not** publish.

### Finish in the Chrome Web Store

The workflow only uploads a draft. Open the [CWS dev console](https://chrome.google.com/webstore/devconsole),
confirm the listing diff, and click **Submit for review** by hand. This keeps a human gate before
anything reaches Google's review queue.

### Required GitHub secrets

The CWS step needs these repo secrets (Settings → Secrets and variables → Actions). If any are
missing or stale, the run hard-fails at step 5 *after* the GitHub release is already created:

- `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` — OAuth desktop client
- `CWS_REFRESH_TOKEN` — long-lived refresh token captured once
- `CWS_EXTENSION_ID` — the 32-char id from the CWS URL

### Notes / gotchas

- **Immutable releases:** this repo has GitHub immutable releases enabled, so the release action
  must upload assets *before* publishing. Keep `softprops/action-gh-release` at `v3.0.0`+ —
  older versions (e.g. `v2.2.2`) publish-then-upload and fail with
  "Cannot upload assets to an immutable release."
- Re-running a release on an existing tag works because step 3 deletes the prior release first.
- `main` is protected (changes via PR); pushes that bypass the rule are owner overrides.

## Local build / smoke test

```bash
scripts/build-zip.sh          # produces dist.zip from extension/
# Load unpacked: chrome://extensions → Developer mode → Load unpacked → select extension/
```
