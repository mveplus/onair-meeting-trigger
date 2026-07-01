# ON-AIR Meeting Trigger (Chromium Extension)

This extension detects when **Google Meet**, **Microsoft Teams**, **Zoom** or **custom - user defined** tabs are open (or active — depending on mode) and then triggers **one or more local/remote outputs**.

It’s designed for “ON AIR” lights, LED signs, Tasmota/Shelly relays, or any IoT device that can be controlled via **HTTP hooks**.

---

## What it does

- Detects meeting tabs for:
  - Google Meet (`meet.google.com`)
  - Microsoft Teams (`teams.microsoft.com`)
  - Zoom (`zoom.us`, `app.zoom.us`)
  - Custom services (user-defined URL prefixes)
- Supports two detection modes:
  - **Any matching tab exists** (works even pre-join)
  - **Only when matching tab is active**
- When state changes, fires **Targets** (multiple outputs supported)
- Global settings: timeout (applies to all targets) and toolbar icon mode
- Redesigned settings UI with templates and quick actions

State is either:
- `ON` (a matching meeting tab exists / is active)
- `OFF` (no matching meeting tab)

---

## Toolbar popup

Click the toolbar icon for an at-a-glance status:

- A big, color-coded card — **🔴 ON AIR**, **Off air**, or **⏸ Paused** — with a
  plain-language line ("In Google Meet" / "No meeting detected"). It updates live.
- How many outputs are wired up ("3 targets active"), or a shortcut to Settings
  when none are configured.
- **Pause** — silence the sign without opening Settings: **1 hour** or **Until I
  resume**. While paused the sign is forced OFF and meeting detection is
  suppressed; **Resume** (or **+1h**) any time.

---

## Targets (outputs)

You can add **multiple targets** and enable/disable them independently:

### 1) Listener target (original local listener support)
Calls your local service (for example a Python listener on your machine) using a URL.

Example (recommended with tokens):
```
http://127.0.0.1:8765/event?state={state}&service={service}&url={url}&ts={ts}
```

Backward compatibility:
- If your listener URL **does not** include tokens, the extension will append:
  `?state=...&service=...&url=...&ts=...`

### 2) Simple LED target (original direct LED support)
For the original LED device API:
- `GET /led/on`
- `GET /led/off`
- Optional `GET /led/status` (if “Verify” is enabled)

Base URL example:
```
http://192.168.1.17
```

### 3) HTTP Hook target (universal IoT control)
This is the **generic** target that can drive almost any IoT device that exposes HTTP endpoints.

Config includes:
- ON URL / OFF URL
- Method: `GET`, `POST`, `PUT`
- Optional headers (one per line: `Key: Value`)
- Optional body (tokens supported)
- Optional Basic Auth (`user:pass`)
- Optional status checks (allowed status codes + response-body match)

### 4) IoT (local + cloud) target — local-first with AWS IoT fallback
A single target row that tries the device's local HTTP API first
(~30 ms on your home Wi-Fi) and **transparently falls back to an AWS
IoT MQTT publish** when local is unreachable — laptop closed at
home, you on a train, devices on a guest network, etc. Exactly one
command per meeting event reaches the device.

Config includes:
- Local base URL + `X-API-Token` (the device's existing on-LAN API)
- Cloud endpoint URL + bearer token (your own API Gateway + Lambda)
- AWS IoT thing name
- ON mode / OFF mode mapping (0=off, 1=on, 2=breathing) — same row
  drives either solid-on or breathing during meetings without
  spawning a sibling target
- Local timeout (ms) before falling over to cloud (default 1500 ms)

Token fields are masked (`type="password"`) in the UI to keep
secrets off the screen during screen-shares.

The companion Lambda + API Gateway scaffold for the cloud half lives
in the firmware repo at
[`onair-led-sign-firmware/scripts/cloud-bridge/`](https://github.com/mveplus/onair-led-sign-firmware/tree/main/scripts/cloud-bridge);
one `deploy.sh` script provisions the IAM role, Lambda, and API
Gateway and prints the endpoint URL + bearer token to paste into
this target.

Use the **OnAir IoT — local first, AWS fallback** template from the
template dropdown to get a row pre-shaped with the right field
layout and mode defaults (1 / 0).

### Reconcile behavior (per target)

The extension re-checks meeting state on a 1-minute heartbeat so a
suspended service worker can't leave a target stale. Each target chooses
how that heartbeat treats it (under **Reconcile behavior** on the target):

- **Fire once on change** (`single`) — the target fires only when a
  meeting genuinely starts or ends, never on the heartbeat. This is the
  only mode for notification targets (Ntfy/listener) so a worker that
  Chrome sleeps and re-wakes can't send duplicate "in a meeting" pushes.
- **Verify state & remediate** (`verify`) — on each heartbeat the
  extension reads the device's *actual* state and re-sends the command
  **only if it drifted**. Available where a readback exists: the LED sign
  target (`/led/status` reachability) and the IoT target's local leg
  (`/api/status`, which reports `output_mode`). No drift → no request.
- **Re-assert every minute** (`always`) — blindly re-sends the desired
  state each heartbeat. Harmless for idempotent devices; not offered for
  notifications. Use this for the IoT **cloud/Lambda** leg, which has no
  state readback yet, when you want it kept fresh regardless.

Defaults: notifications → *fire once*; LED / IoT → *verify*. The old
"Verify using `/led/status`" checkbox is migrated automatically to the
*verify* reconcile mode.

### Diagnostics

Because MV3 keeps suspending the service worker, live console logs are
unreliable. Turn on **Enable debug logging** in the options page's
*Diagnostics* card to record a persistent, rolling trail of every state
change, reconcile action, and worker cold-start — with per-target
outcomes in plain English (which fired, HTTP status, latency, detected
drift, and the actual error text on failures).

View it two ways, both showing the same live log:

- **Options → Open diagnostics…** opens it in a browser tab.
- A dedicated **ON-AIR** panel in Chrome DevTools (F12).

The viewer updates live, filters by *Errors / State changes / Reconciles
/ Worker lifecycle*, and has a **Copy report** button that bundles the
log with your redacted config and extension/Chrome versions — the thing
to paste into a bug report. (Kept out of the settings page so it stays
uncluttered.)

For the lowest-level view, `chrome://extensions → ON-AIR → “Inspect
views: service worker”` gives you Chrome's own console + Network tab —
complementary to the in-extension log, which exists precisely because
that inspector dies when the worker sleeps.

#### Tasmota example
Turn a Tasmota relay on/off via HTTP:

ON URL:
```
http://192.168.1.17/cm?cmnd=Power%20On
```

OFF URL:
```
http://192.168.1.17/cm?cmnd=Power%20Off
```

Method:
- `GET`

No headers/body needed for typical Tasmota setups.

#### Push notifications

Drive phone push notifications (ntfy and others) with no smart-home hardware —
see the [Push Notifications guide](../docs/ON-AIR-Push-Notifications.md).

#### Import/export settings
On the Settings page you can **export** all settings (targets, custom services,
trigger mode, timeout, and toolbar icon mode) to `onair-settings.json`, or **import** settings to quickly
move them between machines.

Imported targets and custom services are appended to your existing list.
Trigger settings are applied immediately in the UI.
After importing (or any edit), an **unsaved-changes** bar appears at the top — click **Save now** to persist changes and permissions.

---

## Templates

The settings UI includes an **Add a target…** dropdown for common targets. Pick a **Blank** HTTP Hook / Listener or a **From template** preset, then click **Add** to prefill URLs, headers, and method.

See the full guide:

- `docs/TEMPLATES.md`

---

## Tokens (templating)

In Listener and HTTP Hook targets, you can use:

- `{state}` → `ON` or `OFF`
- `{service}` → `meet`, `teams`, `zoom` (or `test` during Test buttons)
- `{url}` → the meeting URL. Off by default it's the **site origin only**
  (e.g. `https://meet.google.com`, no meeting ID); enable **Include the full
  meeting URL** in Settings to send the complete URL
- `{ts}` → timestamp (unix ms)

---

## Custom services

Add a custom service by name and one or more URL prefixes. Each prefix must include
the scheme (`https://`) and should end with a trailing slash.

Example:
```
Name: Webex
Prefixes:
https://web.webex.com/meet/
https://company.webex.com/meet/
```

When a tab URL starts with any of those prefixes, the extension will report
`service = Webex`.

---

## Installation (Chrome / Chromium / Edge)

1. Open: `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the extension folder

---

## Permissions

Declared permissions: `storage`, `tabs`, `alarms` (the alarm drives a
once-a-minute reconcile so a suspended service worker can't leave the sign
stuck out of sync).

Host permissions are requested **only for the targets you configure**, for example:
- `http://127.0.0.1/*`
- `http://192.168.1.17/*`

You’ll be prompted to allow these when you save settings.

---

## Credential storage & privacy

- Tokens and passwords (`localToken`, `cloudToken`, HTTP Basic password, and
  `Authorization` / `X-API-Token` header values) are kept in
  `chrome.storage.local` and are **never** written to `chrome.storage.sync`, so
  they aren't mirrored to your Google account. Everything else (URLs, modes,
  service toggles) syncs normally.
- **Export Settings** omits credentials by default (you re-enter them after
  importing), and confirms this before downloading so it's never silent. Tick
  **Include secrets** next to the Export button to bundle tokens/passwords in
  plaintext instead — that path requires a separate confirmation and names the
  file `onair-settings-with-secrets.json` so a credential-bearing export is
  obvious on disk.
- A non-LAN endpoint carrying a token over plain `http://` shows a warning badge;
  use `https://` for anything off the local network.

---

## Testing

Each target row has its own **Test ON / Test OFF** buttons on the Settings page,
so you can fire one output at a time and see exactly what it does. They evaluate
success with the same rule the live background dispatch uses (status codes +
optional body match), so a hook that tests OK behaves identically in production.

Unit tests for the shared logic run with Node's built-in runner (no deps):

```bash
npm test
```

---

## Notes / troubleshooting

- If a target is not reachable, it won’t block other targets.
- If your IoT device requires authentication, use the HTTP Hook target’s Basic Auth or headers.
- For HTTPS devices with self-signed certs, your browser may block requests unless the cert is trusted.

---

## Changelog

Per-version history lives in the
[GitHub Releases](https://github.com/mveplus/onair-meeting-trigger/releases).

---

## Home Assistant REST (Authorization: Bearer) — Minimal Setup

Use this method if you want the extension to **directly control Home Assistant entities**
via the REST API.

### Home Assistant URL
```
http://192.168.1.200:8123
```

### 1) Create a Long-Lived Access Token
1. Home Assistant → click your **user profile**
2. Scroll to **Long-Lived Access Tokens**
3. Click **Create Token**
4. Name it (e.g. `onair-chrome-extension`)
5. **Copy the token immediately**

### 2) Create a helper entity (recommended)
Create a Toggle helper:

```
Settings → Devices & Services → Helpers → Create Helper → Toggle
```

Example entity:
```
input_boolean.on_air
```

### 3) Configure HTTP Hook target

**Method**
```
POST
```

**ON URL**
```
http://192.168.1.200:8123/api/services/input_boolean/turn_on
```
or turn ON WiZ Light, example:
```
http://192.168.1.200:8123/api/services/light/turn_on
```

**OFF URL**
```
http://192.168.1.200:8123/api/services/input_boolean/turn_off
```
or turn OFF WiZ Light, example:
```
http://192.168.1.200:8123/api/services/light/turn_off
```

**Headers**
```
Authorization: Bearer YOUR_LONG_LIVED_TOKEN
Content-Type: application/json
```

**Body**
```json
{"entity_id":"input_boolean.on_air"}
```
or a WiZ Lights, example:
```json
{"entity_id":["light.wiz_1","light.wiz_2"]}'
```

Save and approve the permission prompt.
Use the target's **Test ON / Test OFF** buttons to verify.

---

## Ungoogled Chromium (Flatpak / Snap) — Extension Location

Sandboxed Chromium builds require extensions to live inside
the sandbox-visible filesystem.

### Flatpak (Ungoogled Chromium)

App ID:
```
io.github.ungoogled_software.ungoogled_chromium
```

Recommended location:
```
~/.var/app/io.github.ungoogled_software.ungoogled_chromium/data/extensions/onair/
```

Load via:
```
chrome://extensions → Load unpacked
```

---

### Snap (Ubuntu Chromium)

Works with [Chrome Web Store](https://chromewebstore.google.com/detail/dhcgpjlbnchcbnpplfidkfbfmapokhfn?utm_source=item-share-cb) 

---

### Why this matters
- Prevents `ERR_FILE_NOT_FOUND` popup errors
- Avoids sandbox path invalidation
- Recommended for Home Assistant + LAN IoT usage

## More

- [Privacy Policy](../docs/PRIVACY.md)
- [Terms of Service](../docs/TERMS_OF_SERVICE.md)
- [Templates guide](../docs/TEMPLATES.md)
- [MIT License](../LICENSE)
