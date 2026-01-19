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

## Template placeholders

Templates include placeholders that you should replace:

- `REPLACE_WITH_TOKEN` → your API token
- `YOUR_TOPIC` → your ntfy.sh topic
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
