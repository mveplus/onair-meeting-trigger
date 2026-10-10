# Templates Guide

Targets are added from the row of buttons in Settings → Targets:

| Button | Adds |
|---|---|
| **ON-AIR sign** | The companion sign — local first, AWS IoT cloud fallback (`iotHybrid`) |
| **Webhook** | A blank HTTP hook — any URL, method, headers and body (`httpHook`) |
| **Listener** | A local app that receives `state`/`service`/`url`/`ts` (`listener`) |

The same row continues with one-click **templates** — pre-filled
Webhooks for common devices and services (hover a button for details):

| Button | What it sets up |
|---|---|
| **Tasmota** | Tasmota plug/relay — GET `/cm?cmnd=Power%20On` / `Power%20Off` |
| **Shelly** | Shelly plug/relay — GET `/relay/0?turn=on` / `off` (Gen1, and Gen2+ via its compatibility endpoint) |
| **Home Assistant** | POST to `/api/webhook/<id>` — no token needed; your automation decides what to switch |
| **Ntfy push** | ntfy.sh push to your phone on ON and OFF |

Template URLs mark what you must fill in as `YOUR_*` (`YOUR_DEVICE_IP`,
`YOUR_TOPIC`, `YOUR_HA_HOST`, `YOUR_ON_WEBHOOK_ID`…). Until every one is
replaced, the card shows **⚠ Replace YOUR_…** instead of **Ready**, and the
extension won't ask Chrome for access to a placeholder host.

### Removed templates

Saved targets don't depend on the template they came from, so these keep
working if you already have them (except LED, see below):

- *OnAir IoT — local first, AWS fallback* → it's the **ON-AIR sign** button.
- *On-Air API* → use **ON-AIR sign** with the cloud fields blank (LAN-only).
- *LED* (old `/led/on` firmware) → the LED target type has been removed;
  saved LED targets are dropped. Use **ON-AIR sign**.
- *Generic JSON (POST)* → use **Webhook**, set Method to POST and put JSON in
  the body. A body starting with `{` or `[` is sent as `application/json`
  automatically unless you set your own `Content-Type` header.

## ON-AIR sign — local first, AWS fallback

The **ON-AIR sign** button adds a **single-row** target
(type `iotHybrid`, not `httpHook`) that does what two parallel hooks
can't: try the device's local HTTP API first, fall back to the AWS IoT
cloud bridge only if local is unreachable inside a per-row timeout.
Exactly one command reaches the device per meeting event — no duplicate
publishes. Leave the **local** fields blank to run it cloud-only (drives
the sign from anywhere on the internet); leave the **cloud** fields
blank to run it LAN-only.

When to pick this:

- You're on home Wi-Fi most of the time and want the snappy
  on-LAN response, **but** you also want it to "just work" when you're
  off-LAN without manually switching configs.
- You want one row per sign instead of two (`local` + `cloud`)
  with the indistinguishable Test buttons.

The cloud half pairs with the companion Lambda + API Gateway in the
[`onair-led-sign-firmware`](https://github.com/mveplus/onair-led-sign-firmware)
repo under `scripts/cloud-bridge/`. After deploying that you get an
API Gateway endpoint and a bearer token. The Lambda reads `thing` and
`mode` from the URL query string, so this target needs no body
templating.

### Solid or Breathing

Rather than a separate "Breathing" target, the **ON mode**
dropdown picks what the "ON" action does; **OFF mode** stays `0` so the
meeting-ended flow returns the sign to dark either way:

| ON mode | Effect | Use when… |
|---|---|---|
| `1` (on) | solid on for the meeting | You want the sign to stay solid for the duration of the meeting. |
| `2` (breathing) | soft pulse for the meeting | You prefer a softer pulsing pattern during meetings. |

Want one sign solid and another pulsing for the same event? Add the
sign twice and set a different **ON mode** (and `thing`) on each row.

The sign starts with **empty** fields (grey example hints only), so a
fresh Export Settings file never carries placeholders by accident.

Fields:

| Field | What to put | Source |
|---|---|---|
| Local base URL | IP of the device on your LAN | `http://10.37.22.98` — recommend a DHCP reservation so it doesn't drift |
| Local API token | The device's `X-API-Token` value | Shown in the device's web UI |
| Cloud endpoint URL | API Gateway HTTP API endpoint | `aws apigatewayv2 get-apis ... --output text` from the firmware repo |
| Cloud bearer token | The shared bearer | Contents of `.onair-bridge-token` from the firmware repo's `scripts/cloud-bridge/deploy.sh` run |
| AWS IoT thing | The Thing name | Must be in the Lambda's `ALLOWED_THINGS` env var |
| ON mode | `0` off / `1` on / `2` breathing | `1` for solid, `2` for breathing |
| OFF mode | `0` off (typical) | `0` |
| Local timeout (ms) | How long to wait before fallover | `1500` is a sensible default |

## Heads-up: `*.local` (mDNS) in MV3 service workers

A `*.local` address (e.g. `http://onair.local` or
`homeassistant.local`) **resolves fine from the shell** (`curl`, `getent`) but generally
**does not work from inside the extension's service worker** on
Linux — Chromium's network-service resolver doesn't fall through to
mDNS / Avahi the way `glibc`'s NSS does. Toggling
`chrome://flags/#async-dns` and granting `http://*.local/*` site
access don't reliably fix it.

The boring-but-reliable fix is to give the device a fixed IP via a
DHCP reservation on your router (MAC → IP) and point the hook at the
IP instead of `.local`:

```text
ON URL : http://10.37.22.98/api/set?state=1
OFF URL: http://10.37.22.98/api/set?state=0
```

Or, if you don't want to depend on the LAN path at all, use the
**ON-AIR sign** above configured cloud-only (leave the local
fields blank) — it goes over HTTPS to an AWS API Gateway and has no
name-resolution dependency.

## Tokens supported in URLs and bodies

You can use these in HTTP Hook URLs or bodies:

- `{state}` → `ON` or `OFF`
- `{service}` → `meet`, `teams`, `zoom` (or `test` during Test buttons)
- `{url}` → the meeting URL. By default (the **"Include the full meeting URL"**
  setting off) this is the **site origin only**, e.g. `https://meet.google.com` —
  the host is shared but the meeting ID never leaves the browser. Enable the
  setting to send the **full** URL including the meeting ID.
- `{ts}` → timestamp (unix ms)
- `{url_raw}` → same as `{url}` but never escaped (see below). Only use it if
  you really need the unencoded value.

**Escaping.** Substituted values are escaped for where they land, so a
crafted meeting link can't inject extra parameters or JSON fields:

- in **URLs** (hook ON/OFF URLs, listener URLs) values are URL-encoded
  (`https://meet.google.com` → `https%3A%2F%2Fmeet.google.com`);
- in **bodies that start with `{` or `[`** values are JSON-string escaped;
- in any other body (plain text / form) values are inserted as-is.

## Adding your own templates (developers)

Templates are defined in `extension/options.js` → `TEMPLATES`; the
template buttons on the Add row are built from it. Mark anything the user must fill in
as `YOUR_*` so the card flags it:

```js
my_template: {
  label: "My device",          // button text — keep it short
  name: "My device",           // the new target's name
  hint: "What it sets up",     // button tooltip
  target: {
    ...hookDefaults(),         // GET, no headers/body/auth, status check on
    onUrl: "http://YOUR_DEVICE_IP/on",
    offUrl: "http://YOUR_DEVICE_IP/off"
  }
}
```
