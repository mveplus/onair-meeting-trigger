# ON-AIR Meeting Trigger

![ON-AIR Meeting Trigger](resources/OnAir_Meeting_Trigger_Extension_media.png)

Detect Google Meet, Microsoft Teams, and Zoom meetings and trigger
local or LAN automations (Home Assistant, Tasmota, LED signs).


## Quick start
- Chromium / Chrome extension [now published at CWS](https://chromewebstore.google.com/detail/dhcgpjlbnchcbnpplfidkfbfmapokhfn?utm_source=item-share-cb)
- LAN-first, no cloud required e.g. [OnAir Led/Neon sign](https://github.com/mveplus/onair-led-sign-firmware) 
- Works great with Home Assistant
- Works without Smart Home hardware [Phone push notifications](docs/ON-AIR-Push-Notifications.md)

👉 **Full documentation:**  [extension/README.md](extension/README.md)
  
👉 **Templates guide:**  [docs/TEMPLATES.md](docs/TEMPLATES.md)

## Features
- Meeting detection (Meet / Teams / Zoom)
- Custom service detection (user-defined URL prefixes)
- HTTP hooks (Home Assistant, Tasmota, Shelly, ESP)
- Redesigned settings UI
- Built-in templates for common targets
- Import/export settings (includes trigger mode, timeout, toolbar icon mode)
- Flatpak / Snap compatible
- Privacy-first (no telemetry)

![ON-AIR Meeting Trigger Settings](resources/Screenshot_OnAir_dark_theme.png)

## Releasing 

Releases are automated via GitHub Actions.

To publish a new version:
```bash
./scripts/release.sh X.Y.Z
```

This will:
- update extension/manifest.json and VERSION
- commit the change
- create a git tag (vX.Y.Z)
- push to GitHub
- trigger an automated GitHub Release with a ZIP artifact


## License

This project is licensed under the [MIT License](LICENSE).
