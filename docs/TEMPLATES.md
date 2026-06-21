# Templates Guide

Templates are preset **targets** that fill common ON/OFF URLs, methods, headers,
and (for the AWS IoT bridge) mode settings for you. Most are HTTP Hooks; the
cloud-bridge and local-first templates are `iotHybrid` targets.

## Using templates in the UI

1. Open Settings → Targets.
2. Pick an entry from the **Add a target…** dropdown — either a **Blank**
   HTTP Hook / Listener, or one of the **From template** presets.
3. Click **Add**.
4. Adjust URLs, headers, or body as needed.

## Current templates

- Tasmota (GET)
- Shelly (GET)
- On-Air API (placeholder token)
- ntfy.sh (placeholder topic)
- Home Assistant Webhook
- Generic JSON (POST)
- OnAir Cloud Bridge (AWS IoT Lambda)
- OnAir IoT — local first, AWS fallback

### OnAir Cloud Bridge — quick setup

Pairs with the companion Lambda + API Gateway in the
[`onair-led-sign-firmware`](https://github.com/mveplus/onair-led-sign-firmware)
repo under `scripts/cloud-bridge/`. After deploying that you get an
API Gateway endpoint and a bearer token; plug them into this template
to drive the sign from anywhere on the internet (works the same
whether you're on the home LAN or not).

The Lambda reads `thing` and `mode` from the URL query string, so this
template needs no body templating — just three values to fill in:

| Field | Put in | Where it comes from |
|---|---|---|
| Cloud endpoint URL | API Gateway HTTP API endpoint | `aws apigatewayv2 get-apis ... --query "Items[?Name=='onair-publish-api'].ApiId" --output text`, then `https://<ApiId>.execute-api.<region>.amazonaws.com` |
| AWS IoT thing | AWS IoT Thing name | e.g. `onair-test-1` — must be in the Lambda's `ALLOWED_THINGS` env var |
| Cloud bearer token | bearer token | contents of `.onair-bridge-token` next to the deploy script |

#### One template, choose Solid or Breathing

This is a **single** cloud-bridge template (type `iotHybrid`, configured
cloud-only — leave the local fields blank). Rather than shipping a
separate "Breathing" template, the **ON mode** dropdown picks what the
"ON" action does; **OFF mode** stays `0` so the meeting-ended flow
returns the sign to dark either way:

| ON mode | Effect | Use when… |
|---|---|---|
| `1` (on) | solid on for the meeting | You want the sign to stay solid for the duration of the meeting. |
| `2` (breathing) | soft pulse for the meeting | You prefer a softer pulsing pattern during meetings. |

Want one sign solid and another pulsing for the same event? Add the
template twice and set a different **ON mode** (and `thing`) on each row.

### Local-first hybrid

`OnAir IoT — local first, AWS fallback` is a **single-row** target
(type `iotHybrid`, not `httpHook`) that does what two parallel hooks
can't: try local first, fall back to cloud only if local is
unreachable inside a per-row timeout. Exactly one command reaches the
device per meeting event — no duplicate publishes.

When to pick this over the cloud-only templates above:

- You're on home Wi-Fi most of the time and want the snappy
  on-LAN response, **but** you also want it to "just work" when you're
  off-LAN without manually switching configs.
- You want one row per sign instead of two (`local` + `cloud`)
  with the indistinguishable Test buttons.

The template seeds **empty** string fields so a fresh Export Settings
file never carries `REPLACE_WITH_*` placeholders by accident — fill
in the row's UI and Save, then Export gives you real values.

Fields:

| Field | What to put | Source |
|---|---|---|
| Local base URL | IP of the device on your LAN | `http://10.37.22.98` — recommend a DHCP reservation so it doesn't drift |
| Local API token | The device's `X-API-Token` value | Same one you'd use in the On-Air API template |
| Cloud endpoint URL | API Gateway HTTP API endpoint | `aws apigatewayv2 get-apis ... --output text` from the firmware repo |
| Cloud bearer token | The shared bearer | Contents of `.onair-bridge-token` from the firmware repo's `scripts/cloud-bridge/deploy.sh` run |
| AWS IoT thing | The Thing name | Must be in the Lambda's `ALLOWED_THINGS` env var |
| ON mode | `0` off / `1` on / `2` breathing | `1` for solid, `2` for breathing |
| OFF mode | `0` off (typical) | `0` |
| Local timeout (ms) | How long to wait before fallover | `1500` is a sensible default |

## Template placeholders

Templates include placeholders that you should replace:

- `REPLACE_WITH_TOKEN` → your On-Air API token
- `YOUR_TOPIC` → your ntfy.sh topic
- `http://device.local` → your device hostname or IP

The **OnAir Cloud Bridge** and **local-first hybrid** templates seed
empty fields instead of literal placeholders — the inputs show grey
hint text (e.g. `https://API_ID.execute-api.eu-west-1.amazonaws.com`,
`onair-test-1`) so nothing leaks into an Export Settings file until you
type real values.

## Heads-up: `*.local` (mDNS) in MV3 service workers

The local **On-Air API** template defaults to `http://device.local/...`,
which **resolves fine from the shell** (`curl`, `getent`) but generally
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
**OnAir Cloud Bridge** template above — it goes over HTTPS to an
AWS API Gateway and has no name-resolution dependency.

## Tokens supported in URLs and bodies

You can use these in HTTP Hook URLs or bodies:

- `{state}` → `ON` or `OFF`
- `{service}` → `meet`, `teams`, `zoom` (or `test` during Test buttons)
- `{url}` → the meeting URL. By default (the **"Include the full meeting URL"**
  setting off) this is the **site origin only**, e.g. `https://meet.google.com` —
  the host is shared but the meeting ID never leaves the browser. Enable the
  setting to send the **full** URL including the meeting ID.
- `{ts}` → timestamp (unix ms)

## Adding your own templates (developers)

Templates are defined in:

- `extension/options.js` → `TEMPLATES` object

Each template looks like:

```js
my_template: {
  label: "My Template",
  target: {
    type: "httpHook",
    onUrl: "https://example/on",
    offUrl: "https://example/off",
    method: "POST",
    headers: [{ key: "Content-Type", value: "application/json" }],
    body: "{\"state\":\"{state}\"}",
    basicAuth: null,
    checkStatus: true,
    statusCodes: [200, 202, 204],
    matchOn: "",
    matchOff: ""
  }
}
```
