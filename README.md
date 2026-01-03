# ON-AIR Meeting Trigger

![ON-AIR Meeting Trigger](resources/OnAir_Meeting_Trigger_Extention_media.png)

Detect Google Meet, Microsoft Teams, and Zoom meetings and trigger
local or LAN automations (Home Assistant, Tasmota, LED signs).

## Quick start
- Chromium / Chrome extension
- LAN-first, no cloud required
- Works great with Home Assistant

👉 **Full documentation:**  
[extension/README.md](extension/README.md)

## Features
- Meeting detection (Meet / Teams / Zoom)
- Custom service detection (user-defined URL prefixes)
- HTTP hooks (Home Assistant, Tasmota, Shelly, ESP)
- Import/export HTTP Hook settings
- Flatpak / Snap compatible
- Privacy-first (no telemetry)


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
MIT
