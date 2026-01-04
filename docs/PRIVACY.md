# Privacy Policy — ON-AIR Meeting Trigger

**Last updated:** 2026-01-04

## Overview
ON-AIR Meeting Trigger is a privacy-first browser extension designed to detect when the user is in an online meeting and signal that state to user-configured endpoints. The extension operates entirely on the user’s device.

## Data collection
This extension does **not** collect, store, sell, or transmit user data to the developer or any third party.

Specifically:
- No analytics are used
- No telemetry is sent
- No personal data is collected
- No browsing history is logged
- No data is transmitted to external servers operated by the developer

## Network requests
The extension may send HTTP requests **only to network endpoints explicitly configured by the user**, such as:
- Home Assistant
- Local IoT devices (e.g. Tasmota, Shelly, ESP-based devices)
- User-owned local webhooks or scripts

These requests are initiated solely for the purpose of signaling meeting state (ON/OFF).

The extension:
- Does **not** scan the local network
- Does **not** communicate with unknown or automatic endpoints
- Requests host permissions only after explicit user approval

## Meeting detection
To perform its single purpose, the extension checks whether browser tabs matching supported meeting services (Google Meet, Microsoft Teams, Zoom) are open or active.

- Only tab URLs and active status are evaluated
- Page content is not read
- Data is not stored beyond runtime state

## Optional data in requests
If configured by the user, the extension may include:
- Meeting state (`ON` / `OFF`)
- Meeting service identifier
- Meeting tab URL (optional)

This data is sent **only** to endpoints configured by the user and is not retained or transmitted elsewhere.

## Authentication
If an endpoint requires authentication (for example, Home Assistant REST API), credentials or tokens are provided directly by the user and are stored locally in the browser’s extension storage.

The extension does not intercept, transmit, or reuse authentication data for any other purpose.

## Third-party access
The developer does not have access to any data generated or transmitted by the extension.

No data is shared with advertisers, analytics providers, or external services.

## Changes
If this privacy policy changes in the future, it will be updated in the project repository and reflected in the Chrome Web Store listing.

## Contact
Please use the project issue tracker for privacy questions:
https://github.com/mveplus/onair-meeting-trigger/issues
