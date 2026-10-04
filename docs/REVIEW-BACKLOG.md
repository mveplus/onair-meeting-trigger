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
- [ ] **S4 — Secret coverage gaps.** Tokens in URLs (ntfy `?auth=`, HA webhook
  IDs, IFTTT keys) sync + export; only `authorization`/`x-api-token` headers are
  treated as secret. Fix: secret header names by pattern
  (`auth|token|key|secret|cookie`); move hook/listener URLs to `storage.local`
  or warn on secret-looking query params.
- [ ] **S5 — Import can silently enable `includeMeetingUrl`** and add an
  exfiltrating listener. Fix: import preview listing destination hosts; confirm
  before accepting `includeMeetingUrl: true`.
- [ ] **S6 — Custom prefix look-alike match.** `https://webex.com` matches
  `https://webex.com.evil.io/`. Fix: exact origin compare + path prefix.
- [ ] **S7 — Basic Auth password in a plain text input** (`user:pass`). Split
  into user + masked password fields.
- [ ] **S8 — Host permissions never revoked** when targets are removed. Call
  `chrome.permissions.remove` for orphaned origins after save.
- [ ] **S9 — Options Test duplicates iotHybrid dispatch** (no `clampMode`,
  violates the shared.js single-source rule). Move to shared.js or route Test
  through the worker.
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
- [ ] **P4 — `tabs.query({})` + loop.** Use `tabs.query({ url: patterns })`
  built from enabled prefixes.
- [ ] **P5 — Retry on timeout.** A dead LAN host costs ~3× timeout + backoff.
  Retry only fast network errors, not `AbortError`.
- [ ] **P6 — Icon before dispatch.** `applySideEffects` awaits `setIcon` before
  firing targets; run concurrently.
- [ ] **P7 — One permission prompt per origin on Save.** Batch into a single
  `chrome.permissions.request({ origins: [...] })`.
- [ ] **P8 — `logActivity` read-modify-write race** drops entries under
  concurrency. Serialize through an in-memory queue.

## UI — popup

- [ ] **U1 — Show last-dispatch health**, not "N targets active"
  ("✓ Sign updated 5s ago" / "⚠ LED sign unreachable → Diagnostics").
- [ ] **U2 — First-paint flash.** Cache last state + theme in `localStorage`
  for instant correct paint; read `config` once instead of three times.
- [ ] **U3 — Paused during a meeting**: say both ("⏸ Paused · in Google Meet ·
  sign held off").
- [ ] **U4 — Copy/hierarchy:** "+1h" → "Extend 1h"; Settings becomes a small
  gear link, Pause is the primary action.

## UI — settings

- [ ] **U5 — Reorder:** Meeting detection (custom services folded in as
  "+ Add another service") → Targets → Preferences → Diagnostics →
  Backup & restore.
- [ ] **U6 — One-step add:** button row (ON-AIR sign / LED / Webhook /
  Listener) or add on `<select>` change.
- [ ] **U7 — Target names + collapsed summary rows**; drop the internal-id pill.
- [ ] **U8 — Inline Test results with reason** (timeout / HTTP 401 /
  permission denied) next to the button, not the page-bottom status line.
- [ ] **U9 — Move Import / Export / Include secrets** to a Backup & restore
  section.
- [ ] **U10 — Plain language:** "Reconcile behavior" → "Keep the sign in sync";
  modes "1 (on)" → "On"/"Breathing"; drop the marketing subtitle.
- [ ] **U11 — Consistent saving:** theme saves instantly, everything else via
  the save bar — auto-save simple toggles or route theme through the bar.
- [ ] **U12 — Undo for Remove** ("Target removed · Undo" toast).
- [ ] **U13 — Pre-explain permission prompts** before Chrome's dialog on Save.
