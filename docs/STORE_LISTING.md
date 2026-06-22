1️⃣ Extension description (store listing)

Detects Google Meet, Microsoft Teams, and Zoom tabs and triggers user-configured local or remote endpoints (HTTP) to control external indicators such as “On Air” lights or smart home automations.

2️⃣ Permission justification (review form)

tabs: used to detect meeting tabs

storage: used to save user configuration

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

Regenerate with `scripts/make-store-shots.sh` (renders the real popup/options
pages headless against a mocked `chrome.*`, then composes the branded tiles).
