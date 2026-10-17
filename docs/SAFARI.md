# Safari — feasibility notes

**Status: parked (2026-10-10).** Not started. Publishing to Safari needs the
Apple Developer Program ($99/year), and testing needs Apple hardware (a Mac,
or an iPhone/iPad with TestFlight). Pick this up once both are available.

## Summary

| Part | Effort | Notes |
|---|---|---|
| Code | ~1 day | Same extension; one Safari-specific UX step (site access) |
| Packaging | 1 evening | App Store app record + Safari Web Extension Packager |
| Review | days | App Review is slower and stricter than CWS/AMO |
| Running cost | $99/year | Apple Developer Program |

## What changes in the code

- **Manifest:** a `scripts/safari-manifest.mjs` (`toSafariManifest`, tested
  like `tests/firefox-manifest.test.js`), and `build-zip.sh` writes a
  `dist-safari.zip`. Safari 15.4+ supports MV3, background service workers,
  `alarms` and `devtools_page`. `storage.session` needs Safari/iOS 16.4+.
- **Tab URLs are hidden until the user allows each site.** This is the real
  difference. Chrome and Firefox show tab URLs with the `tabs` permission.
  Safari returns tabs with an empty `url` (and no title) for sites the
  extension hasn't been granted. Without access to meet.google.com, Teams,
  Zoom and each custom service, detection never sees a meeting.
  - Fix: an **"Allow meeting sites"** button in Settings (plus a popup hint
    when access is missing). It requests the enabled services' origins with
    `chrome.permissions.request`, reusing `originPatternFor` /
    `missingOrigins` from `shared.js`. Add a pure, tested helper for "which
    meeting origins are missing".
  - Harmless on Chrome/Firefox, so no browser fork.
  - Detection already tolerates empty URLs (`matchService("")` → no match).
- Keep the code browser-neutral, as for Firefox (`chrome.*` works in Safari).

## Open questions (test on a real Mac)

- Plain `http://` requests from the extension to LAN devices (the sign,
  Tasmota, Shelly) — allowed, or blocked by App Transport Security?
- How Safari's per-endpoint permission prompt behaves from Save / Test.
- How long Safari keeps the background worker alive; does the 1-minute
  heartbeat still fire reliably?
- iPhone/iPad: probably not worth listing (meetings run in apps there).

## Distribution

1. Enrol in the Apple Developer Program.
2. App Store Connect → new app record (name, icon, privacy "nutrition label"
   = no data collected, App Store screenshots, support/privacy URLs — reuse
   https://mveplus.github.io/onair-meeting-trigger/PRIVACY.html).
3. Package the extension:
   - **No Mac:** App Store Connect → the app → **Xcode Cloud** tab →
     **Safari Web Extension Packager** → upload the extension files. Some
     developers report this section missing from their account — check it
     early.
   - **With a Mac:** `xcrun safari-web-extension-packager` or Xcode.
4. Test with TestFlight (or locally in Safari on a Mac), then submit for
   App Review.
5. Later: a CI job on a GitHub macOS runner with App Store Connect API keys,
   like `cws-upload.yml` / `amo-upload.yml`.

## Sources

- [Tab URLs need per-site access in Safari (Apple Developer Forums)](https://developer.apple.com/forums/thread/660646)
- [Packaging and distributing Safari web extensions with App Store Connect (Apple)](https://developer.apple.com/tutorials/data/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect.md)
- [Packager section missing in App Store Connect (Apple Developer Forums)](https://developer.apple.com/forums/thread/845035)
- [storage.session availability on iOS/iPadOS (Apple Developer Forums)](https://developer.apple.com/forums/thread/776369)
