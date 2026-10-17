import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toFirefoxManifest, GECKO_ID, MIN_FIREFOX } from "../scripts/firefox-manifest.mjs";

const chrome = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("background runs as a module event page, not a service worker", () => {
  const ff = toFirefoxManifest(chrome);
  assert.deepEqual(ff.background, { scripts: ["background.js"], type: "module" });
});

test("options page becomes options_ui opened in a tab", () => {
  const ff = toFirefoxManifest(chrome);
  assert.equal(ff.options_page, undefined);
  assert.deepEqual(ff.options_ui, { page: "options.html", open_in_tab: true });
});

test("gecko id, minimum version and data-collection consent are set", () => {
  const { gecko } = toFirefoxManifest(chrome).browser_specific_settings;
  assert.equal(gecko.id, GECKO_ID);
  assert.equal(gecko.strict_min_version, MIN_FIREFOX);
  assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
});

test("everything else is carried over unchanged, and the input isn't mutated", () => {
  const before = JSON.stringify(chrome);
  const ff = toFirefoxManifest(chrome);
  assert.equal(JSON.stringify(chrome), before);
  for (const k of ["version", "name", "permissions", "optional_host_permissions", "devtools_page", "action", "icons"]) {
    assert.deepEqual(ff[k], chrome[k], k);
  }
});
