// Firefox build of the extension manifest.
//
// extension/manifest.json is written for Chrome. Firefox MV3 differs in a
// few keys, so the Firefox package gets a manifest generated from it at
// build time — the source and the Chrome package stay untouched.
//
//   node scripts/firefox-manifest.mjs <in manifest.json> <out manifest.json>

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Permanent once the add-on is published on addons.mozilla.org.
export const GECKO_ID = "onair-meeting-trigger@mveplus";
// Built-in data-collection consent (required for new AMO add-ons) needs 140+.
export const MIN_FIREFOX = "140.0";
// Firefox for Android added data_collection_permissions in 142; without its
// own minimum, gecko's 140 applies there too and AMO's validator warns.
export const MIN_FIREFOX_ANDROID = "142.0";

export function toFirefoxManifest(chrome) {
  const m = structuredClone(chrome);

  // No background service workers in Firefox: run the same module as an
  // event page.
  if (m.background?.service_worker) {
    m.background = { scripts: [m.background.service_worker], type: m.background.type || "module" };
  }

  // Firefox's preferred form of options_page.
  if (m.options_page) {
    m.options_ui = { page: m.options_page, open_in_tab: true };
    delete m.options_page;
  }

  m.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: MIN_FIREFOX,
      // Requests go only to endpoints the user configures; nothing is sent
      // to the developer or anyone else (see docs/PRIVACY.md).
      data_collection_permissions: { required: ["none"] }
    },
    gecko_android: { strict_min_version: MIN_FIREFOX_ANDROID }
  };
  return m;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error("usage: node scripts/firefox-manifest.mjs <in> <out>");
    process.exit(2);
  }
  const out = toFirefoxManifest(JSON.parse(readFileSync(src, "utf8")));
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
}
