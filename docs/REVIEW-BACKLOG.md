# Review backlog (security · speed · UI)

Findings from the 2026-10-04 code review of the extension. Tick an item when
it lands on `main` (note the PR). Work top-down within each section; IDs are
stable so commits/PRs can reference them (e.g. `fix(S1): …`).

## Security

- [x] **S1 — Template injection.** `{url}`/`{service}` are substituted raw into
  URL templates and JSON bodies; with `includeMeetingUrl` on, a crafted meeting
  link (`…?a=1&state=OFF`) injects query params into the user's hooks.
  Fix: `applyTemplate(str, vars, encode)` — `"url"` → `encodeURIComponent`,
  `"json"` → JSON-string escaping; `{url_raw}` escape hatch. *(branch
  fix/review-security-speed)*
- [x] **S2 — `isPrivateHost` prefix bypass.** `10.evil.com`, `192.168.x.net`,
  `127.0.0.1.nip.io` were treated as LAN, hiding the cleartext-token warning.
  Fix: classify only real IPv4/IPv6 literals by range. *(fix/review-security-speed)*
- [x] **S3 — Custom headers survive cross-origin redirects.** Fetch strips only
  `Authorization`; `X-API-Token` follows a redirect. Fix: `redirect: "error"` on
  credentialed requests (worker + options Test). *(fix/review-security-speed)*
- [x] **S4 — Secret coverage gaps.** Tokens in URLs (ntfy `?auth=`, HA webhook
  IDs, IFTTT keys) sync + export; only `authorization`/`x-api-token` headers are
  treated as secret. Fix: secret header names by pattern
  (`auth|token|key|secret|cookie`); move hook/listener URLs to `storage.local`
  or warn on secret-looking query params.
  *Done (wave 2, fix/review-security-speed): isSecretHeader (name pattern) + urlCarriesSecret (secret query params, userinfo, HA/Slack/Discord/IFTTT webhooks); secret URLs stored in `storage.local`; secrets already in sync are moved on next worker load. Limitation: secrets in a plain path (e.g. an ntfy topic name) aren't detectable.*
- [x] **S5 — Import can silently enable `includeMeetingUrl`** and add an
  exfiltrating listener. Fix: import preview listing destination hosts; confirm
  before accepting `includeMeetingUrl: true`.
  *Done (wave 2, fix/review-security-speed): confirm() listing importDestinations hosts; separate confirm before accepting includeMeetingUrl: true.*
- [x] **S6 — Custom prefix look-alike match.** `https://webex.com` matches
  `https://webex.com.evil.io/`. Fix: exact origin compare + path prefix.
  *Done (wave 2, fix/review-security-speed): urlMatchesPrefix: exact origin + path prefix.*
- [x] **S7 — Basic Auth password in a plain text input** (`user:pass`). Split
  into user + masked password fields.
  *Done (wave 2, fix/review-security-speed): separate user / masked password fields.*
- [x] **S8 — Host permissions never revoked** when targets are removed. Call
  `chrome.permissions.remove` for orphaned origins after save.
  *Done (wave 2, fix/review-security-speed): revokeOrphanedPermissions after save (keeps origins of disabled targets).*
- [x] **S9 — Options Test duplicates iotHybrid dispatch** (no `clampMode`,
  violates the shared.js single-source rule). Move to shared.js or route Test
  through the worker.
  *Done (wave 2, fix/review-security-speed): Test buttons send TEST_TARGET to the worker → live dispatchTarget; duplicated executors removed from options.js. Worker also rejects messages from other extensions (sender.id check).*
- [x] **R1 — Out-of-order edges.** A retrying ON request could land after a
  later OFF, leaving a `single` target stuck ON. Fix: edge generation counter;
  in-flight requests from a superseded edge are aborted / not retried.
  *(fix/review-security-speed)*

## Speed

- [x] **P1 — `tabs.onUpdated` storm.** Every title/favicon/audible change on any
  tab ran a full tick. Fix: only react to `changeInfo.url` / `status` changes.
  *(fix/review-security-speed)*
- [x] **P2 — Config re-read every tick.** Fix: in-memory cache invalidated by
  `storage.onChanged` (sync `config`, local `secrets`). *(fix/review-security-speed)*
- [x] **P3 — Redundant icon/state writes on unchanged ticks.** Fix: only
  `setIcon` / `saveCurrent` when something changed. *(fix/review-security-speed)*
- [x] **P4 — `tabs.query({})` + loop.** Use `tabs.query({ url: patterns })`
  built from enabled prefixes.
  *Done (wave 2, fix/review-security-speed): serviceMatchPatterns → tabs.query({url}); falls back to query({}) for ports/query-string prefixes.*
- [x] **P5 — Retry on timeout.** A dead LAN host costs ~3× timeout + backoff.
  Retry only fast network errors, not `AbortError`.
  *Done (wave 2, fix/review-security-speed): callUrl no longer retries AbortError (timeout).*
- [x] **P6 — Icon before dispatch.** `applySideEffects` awaits `setIcon` before
  firing targets; run concurrently.
  *Done (wave 2, fix/review-security-speed): setIcon runs concurrently with dispatch.*
- [x] **P7 — One permission prompt per origin on Save.** Batch into a single
  `chrome.permissions.request({ origins: [...] })`.
  *Done (wave 2, fix/review-security-speed): one chrome.permissions.request with all origins (also fixes later prompts losing the user gesture).*
- [x] **P8 — `logActivity` read-modify-write race** drops entries under
  concurrency. Serialize through an in-memory queue.
  *Done (wave 2, fix/review-security-speed): logActivity serialized via a promise chain.*

## UI decisions (agreed 2026-10-04)

- **Branch:** UI work lands on `feature/review-ui` (stacked on
  `fix/review-security-speed`) as its own PR, so the security/speed PR isn't
  held up by design review.
- **U11 saving — hybrid:** simple toggles (services, trigger mode, theme, icon,
  privacy, timeout) auto-save instantly with a small "✓ saved" cue; target and
  custom-service edits keep the sticky save bar (saving targets may trigger
  Chrome permission prompts, which need a click).
- **U6 add target — button row:** `[ON-AIR sign] [LED] [Webhook] [Listener]`
  plus a "More templates ▾" menu for the pre-filled templates.
- **U7 target cards — collapsed summaries:** one line with name · host · status
  and a Test button; click to expand. New targets open expanded.

## UI — popup

- [x] **U1 — Show last-dispatch health**, not "N targets active"
  ("✓ Sign updated 5s ago" / "⚠ LED sign unreachable → Diagnostics").
  *Done (feature/review-ui): worker stores `lastDispatch` (summarizeDispatch) in storage.session; popup renders describeDispatchHealth with a Details link to diagnostics on failure.*
- [x] **U2 — First-paint flash.** Cache last state + theme in `localStorage`
  for instant correct paint; read `config` once instead of three times.
  *Done (feature/review-ui): popup paints from a localStorage cache (state + theme), then reconciles; one config read.*
- [x] **U3 — Paused during a meeting**: say both ("⏸ Paused · in Google Meet ·
  sign held off").
  *Done (feature/review-ui): worker reports `detected` service even while paused; describePausedState.*
- [x] **U4 — Copy/hierarchy:** "+1h" → "Extend 1h"; Settings becomes a small
  gear link, Pause is the primary action.
  *Done (feature/review-ui): Pause buttons are primary; "Extend 1h" adds to the remaining pause; Settings is a small footer link.*

## UI — settings

- [x] **U5 — Reorder:** Meeting detection (custom services folded in as
  "+ Add another service") → Targets → Preferences → Diagnostics →
  Backup & restore.
  *Done (feature/review-ui): order: detection (custom services folded in) → targets → preferences → diagnostics → backup & restore.*
- [x] **U6 — One-step add:** button row (ON-AIR sign / LED / Webhook /
  Listener) or add on `<select>` change.
  *Done (feature/review-ui): add-button row + "More templates…" select that adds on pick.*
- [x] **U7 — Target names + collapsed summary rows**; drop the internal-id pill.
  *Done (feature/review-ui): `name` field (synced, exported, in settingsSignature); collapsed summary rows, expanded on add/import; id pill removed.*
- [x] **U8 — Inline Test results with reason** (timeout / HTTP 401 /
  permission denied) next to the button, not the page-bottom status line.
  *Done (feature/review-ui): Test result shown on the card via describeTestResult (timeout / 401 / redirect / HTTP n).*
- [x] **U9 — Move Import / Export / Include secrets** to a Backup & restore
  section.
  *Done (feature/review-ui): Backup & restore card.*
- [x] **U10 — Plain language:** "Reconcile behavior" → "Keep the sign in sync";
  modes "1 (on)" → "On"/"Breathing"; drop the marketing subtitle.
  *Done (feature/review-ui): "Keep the sign in sync"; modes On/Off/Breathing; subtitle removed; tighter copy.*
- [x] **U11 — Consistent saving:** theme saves instantly, everything else via
  the save bar — auto-save simple toggles or route theme through the bar.
  *Done (feature/review-ui): hybrid: `.autosave` controls + theme + timeout save instantly (saveGeneral, "✓ Saved" cue); save bar tracks targets/custom services only (editsSignature).*
- [x] **U12 — Undo for Remove** ("Target removed · Undo" toast).
  *Done (feature/review-ui): Undo toast for target and custom-service removal; add/remove now preserve unsaved edits in other cards.*
- [x] **U13 — Pre-explain permission prompts** before Chrome's dialog on Save.
  *Done (feature/review-ui): save bar names the hosts Chrome will ask about (missingOrigins vs permissions.getAll).*
