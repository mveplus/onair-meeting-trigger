# Templates Guide

Templates are preset **HTTP Hook targets** that fill common ON/OFF URL, method, and headers for you.

## Using templates in the UI

1. Open Settings → Targets.
2. Pick a template from the **Template** dropdown.
3. Click **Add from Template**.
4. Adjust URLs, headers, or body as needed.

## Current templates

- Tasmota (GET)
- Shelly (GET)
- On-Air API (placeholder token)
- ntfy.sh (placeholder topic)
- Home Assistant Webhook
- Generic JSON (POST)
- OnAir Cloud Bridge (AWS IoT Lambda)

### OnAir Cloud Bridge — quick setup

Pairs with the companion Lambda + API Gateway in the
[`onair-led-sign-firmware`](https://github.com/mveplus/onair-led-sign-firmware)
repo under `scripts/cloud-bridge/`. After deploying that you get an
API Gateway endpoint and a bearer token; plug them into this template
to drive the sign from anywhere on the internet (works the same
whether you're on the home LAN or not).

The Lambda reads `thing` and `mode` from the URL query string, so this
template needs no body templating — just three values to fill in:

| Placeholder | Replace with | Where it comes from |
|---|---|---|
| `API_ID` | API Gateway HTTP API id | `aws apigatewayv2 get-apis ... --query "Items[?Name=='onair-publish-api'].ApiId" --output text` |
| `YOUR_THING` | AWS IoT Thing name | e.g. `onair-test-1` — must be in the Lambda's `ALLOWED_THINGS` env var |
| `REPLACE_WITH_TOKEN` | bearer token | contents of `.onair-bridge-token` next to the deploy script |

`matchOn` / `matchOff` are pre-set to `"mode":1` / `"mode":0` so the
hook can verify the round-trip reached the Lambda, not just any HTTP
2xx.

## Template placeholders

Templates include placeholders that you should replace:

- `REPLACE_WITH_TOKEN` → your API token (On-Air API) or bearer (AWS IoT Lambda)
- `YOUR_TOPIC` → your ntfy.sh topic
- `YOUR_THING` → AWS IoT Thing name (AWS IoT Lambda)
- `API_ID` → API Gateway HTTP API id (AWS IoT Lambda)
- `http://device.local` → your device hostname or IP

## Tokens supported in URLs and bodies

You can use these in HTTP Hook URLs or bodies:

- `{state}` → `ON` or `OFF`
- `{service}` → `meet`, `teams`, `zoom` (or `test` during Test buttons)
- `{url}` → the meeting tab URL (when available)
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
