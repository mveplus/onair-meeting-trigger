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
