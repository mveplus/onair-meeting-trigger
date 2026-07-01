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
scripts/           Release tooling (build-zip.sh, release.sh, gen-build-info.sh)
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
- **Privacy:** the meeting URL is gated by `includeMeetingUrl` (default off) via
  `meetingUrlForVars` — off sends the **origin only** (no meeting ID), on sends
  the full URL.
- **MV3 reliability:** a 1-minute `chrome.alarms` reconcile heartbeat
  (`alarms` permission) re-derives state so a suspended worker can't leave the
  sign stale; the 400 ms `setTimeout` debounce is kept for sub-second coalescing.
- **Persisted state (no duplicate notifications):** the last-applied
  `{state,service,url}` is written to `chrome.storage.session` (`saveCurrent`/
  `loadCurrent`) and hydrated at the top of `tick()`. Without it the module
  `current` reset to OFF on every cold start, so the heartbeat saw a phantom
  OFF→ON edge and re-fired every target — that was the duplicate "in a meeting"
  push bug. Edges fire all targets once; the heartbeat only re-fires per the
  target's reconcile policy.
- **Per-target reconcile policy** (`shared.js`: `RECONCILE_MODES`,
  `reconcileModesFor`, `resolveReconcile`, `migrateReconcile`): `single` (edge
  only — the only mode for listener/Ntfy), `verify` (read actual state, re-fire
  on drift — iotHybrid via `/api/status` + `parseDeviceMode`/`reconcileDrift`,
  simpleLed via `/led/status` reachability), `always` (blind re-assert; the only
  remediation for the cloud/Lambda leg, which has no readback). `reconcilePass()`
  runs only on `reason === "alarm"`. Legacy `simpleLed.verifyStatus` migrates to
  `reconcile`. Cloud `verify` awaits a future IoT-shadow/state-query (firmware +
  Lambda).
- **Diagnostics:** an opt-in ring buffer (`activityLog` in `storage.local`, cap
  200, gated by the `debugLogs` toggle) records edge/reconcile/worker events with
  per-target outcomes (latency, error text, drift). The viewer is `diagnostics.html`
  + `diagnostics.js` — surfaced both as a DevTools panel (`devtools.js` →
  `devtools_page`) and via Options → "Open diagnostics" (a tab); it reads the log
  straight from `storage.local` and live-updates via `storage.onChanged` (no
  worker round-trip). Humanizing is pure/tested in `shared.js`
  (`describeLogEntry`, `logSeverity`, `describeTargetLine`, `modeLabel`). The
  options page keeps only the toggle + open button, so settings stays uncluttered.
- **Popup is status-first:** the worker broadcasts `STATE_CHANGED` and answers
  `GET_STATE` with `{ state, service, pause }`; the popup renders a big
  color-coded status card and a quick **Pause** control. Pause lives in
  `chrome.storage.local` as `{ until }` (`PAUSE_INDEFINITE` or epoch-ms); while
  paused, `tick()` forces OFF. Pure helpers: `isPaused`, `describePause`,
  `describeMeetingState`, `countEnabledTargets`.
- **Settings unsaved-changes bar:** `collectConfigFromUI()` builds the config
  the same way `save()` does; `settingsSignature()` (pure, tested) compares it to
  the saved baseline to drive a sticky save bar. Settings are grouped into
  "Meeting detection" and a "Preferences" card (Appearance / Privacy / Advanced).
- **Dev build badge:** `scripts/gen-build-info.sh` writes the gitignored
  `extension/build-info.json` (commit/branch/dirty); `build-zip.sh` runs it
  before zipping. The popup and options page fetch it and render
  `formatBuildBadge` — a `vX-dev · branch @ commit` label that shows **only** for
  unpacked builds off a non-`main` branch (detached HEAD / release / store
  installs render nothing). Run `scripts/gen-build-info.sh` after switching
  branches to refresh it.

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
