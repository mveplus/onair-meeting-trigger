1️⃣ Extension description (store listing)

Detects Google Meet, Microsoft Teams, and Zoom tabs and triggers user-configured local or remote endpoints (HTTP) to control external indicators such as “On Air” lights or smart home automations.

2️⃣ Permission justification (review form)

tabs: used to detect meeting tabs

storage: used to save user configuration

alarms: a once-a-minute check that keeps the user's devices in sync with the meeting state after the browser suspends the extension's service worker

optional_host_permissions:
“Used to send HTTP requests to user-specified endpoints (e.g., Home Assistant, smart devices) only after explicit user configuration. Permissions are requested per configured origin.”

3️⃣ Privacy disclosure (required)

This extension does not collect, store, or transmit personal data to the developer.
All network requests are initiated by the user and target endpoints configured by the user.

4️⃣ Screenshots (1280×800 PNG, upload in order)

Store-ready tiles live in `resources/store/`:

1. `1_popup_status.png` — toolbar popup ON AIR status + one-tap Pause
2. `2_options_setup.png` — Settings: meeting detection, services, preferences
3. `3_options_iot.png` — Targets: local-first LAN with AWS cloud fallback (dark)
4. `4_popup_privacy.png` — privacy posture + dark mode
5. `5_toolbar.png` — the popup open under the browser toolbar

Regenerate with `scripts/make-store-shots.sh` (renders the real popup/options
pages headless against a mocked `chrome.*`, then composes the branded tiles).
Tile 5 frames a hand capture, `resources/store-src/05_toolbar_raw.png` —
replace it with a fresh screenshot of the open popup (no dev badge) when the
popup changes.

5️⃣ Promo images and artwork (`resources/`)

- `OnAir_small_promo_tile_440_280.png` — small promo tile
- `OnAir_marquee_promo_tile_1400_560.png` — marquee promo tile
- `OnAir_Meeting_Trigger_Extension_media.png` — banner (also the README header)
- `icons_combined.png` — icon artwork source

---

# Firefox Add-ons (addons.mozilla.org)

The Firefox package is `dist-firefox.zip` (built by `scripts/build-zip.sh`,
attached to every GitHub release). Its manifest is generated from
`extension/manifest.json` by `scripts/firefox-manifest.mjs`: add-on ID
`onair-meeting-trigger@mveplus`, Firefox 140+.

**Listing:** https://addons.mozilla.org/firefox/addon/on-air-meeting-trigger/ (public).

**First submission (one time, by hand — done):** Developer Hub → *Submit a New
Add-on* → *On this site* → upload `dist-firefox.zip`. Source code upload is
not needed — the code isn't minified or bundled.

- **Name:** ON-AIR Meeting Trigger
- **Summary** (≤ 250 chars): Turns your ON-AIR sign, smart plug, Home
  Assistant or phone notification on when a Google Meet, Teams, Zoom or custom
  meeting tab is open — and off when it closes. Local-first, no telemetry.
- **Description** (AMO allows basic HTML — `<b>`, `<ul>`/`<li>`, `<a>`):

  ```html
  Lets the people around you know you're on a call. When a Google Meet, Microsoft Teams or Zoom meeting tab is open, ON-AIR Meeting Trigger switches your sign, light or automation on — and off again when the meeting tab closes.

  <b>What it can trigger</b>
  <ul>
  <li>An ON-AIR LED/neon sign on your network, with optional cloud fallback when you're away from it</li>
  <li>Smart plugs and lights: ready-made Tasmota and Shelly templates</li>
  <li>Home Assistant webhooks</li>
  <li>Phone notifications via Ntfy</li>
  <li>Any HTTP/HTTPS endpoint (GET or POST, custom headers and JSON body)</li>
  </ul>

  <b>Features</b>
  <ul>
  <li>Detects Meet, Teams and Zoom out of the box; add your own meeting sites (e.g. Jitsi, Webex)</li>
  <li>Any open meeting tab or only the active tab</li>
  <li>Pause from the toolbar for an hour or until you resume</li>
  <li>Keeps the sign in sync: a light check every minute fixes a sign that missed an update</li>
  <li>Built-in Test buttons and an optional diagnostics log (also a DevTools panel)</li>
  <li>Light and dark theme; export/import settings (works between Firefox and Chrome)</li>
  </ul>

  <b>Private by design</b>
  <ul>
  <li>No telemetry, no analytics, no developer servers — requests go only to the endpoints you set up</li>
  <li>Sends the meeting site's origin only (no meeting ID) unless you turn on the full URL</li>
  <li>Tokens and passwords stay on this device and are left out of exports</li>
  <li>Asks for access to each address only when you save or test it</li>
  </ul>

  Open source (MIT): <a href="https://github.com/mveplus/onair-meeting-trigger">github.com/mveplus/onair-meeting-trigger</a>
  Sign firmware: <a href="https://github.com/mveplus/onair-led-sign-firmware">github.com/mveplus/onair-led-sign-firmware</a>
  ```
- **Homepage:** https://github.com/mveplus/onair-meeting-trigger
- **Support site:** https://github.com/mveplus/onair-meeting-trigger/issues
- **Categories:** e.g. *Alerts & Updates*, *Social & Communication*.
- **License:** MIT.
- **Data collection:** none — the manifest declares
  `data_collection_permissions: { required: ["none"] }`. Requests go only to
  endpoints the user configures; nothing reaches the developer.
- **Privacy policy:** https://mveplus.github.io/onair-meeting-trigger/PRIVACY.html
  (GitHub Pages copy of `docs/PRIVACY.md`).
- **Screenshots:** the same tiles as the Chrome Web Store, `resources/store/`.
- **Notes to reviewer:** host access is optional and requested per configured
  endpoint (on Save / Test). The `innerHTML` linter warnings are template
  strings whose dynamic values all pass through the `esc()` HTML-escaper in
  `options.js` / `diagnostics.js`.

**Later versions** (0.8.3 on) go through CI using the repository secrets
`AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (Developer Hub → Tools → *Manage API
Keys*). Each release tag then submits `dist-firefox.zip` automatically;
**Actions → Upload to Firefox Add-ons** re-submits a release by hand.
