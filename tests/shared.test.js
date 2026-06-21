// Unit tests for extension/shared.js — the pure logic shared by the MV3
// service worker and the options page. Run with `npm test` (Node's
// built-in test runner, no dependencies).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  trimSlash,
  applyTemplate,
  backoffMs,
  clampTimeoutSec,
  clampLocalTimeoutMs,
  clampMode,
  matchService,
  normalizeStatusCodes,
  buildListenerUrl,
  meetingUrlForVars,
  httpHookSuccess,
  isPrivateHost,
  endpointSecurityWarnings,
  extractSecrets,
  applySecrets,
  redactSecrets,
  hasSecrets,
  resolveExportSecrets,
  exportFileName
} from "../extension/shared.js";

// ---------------------------------------------------------------------------
// Basic functionality
// ---------------------------------------------------------------------------

describe("basic helpers", () => {
  test("trimSlash strips trailing slashes only", () => {
    assert.equal(trimSlash("http://x/"), "http://x");
    assert.equal(trimSlash("http://x///"), "http://x");
    assert.equal(trimSlash("http://x"), "http://x");
    assert.equal(trimSlash(""), "");
    assert.equal(trimSlash(null), "");
  });

  test("applyTemplate substitutes tokens and tolerates missing vars", () => {
    assert.equal(
      applyTemplate("s={state}&svc={service}&u={url}&t={ts}", { state: "ON", service: "meet", url: "http://m", ts: 5 }),
      "s=ON&svc=meet&u=http://m&t=5"
    );
    assert.equal(applyTemplate("{state}", {}), "");
    assert.equal(applyTemplate(null, {}), "");
  });

  test("backoffMs grows then caps at RETRY_MAX_MS", () => {
    assert.equal(backoffMs(0), 250);
    assert.equal(backoffMs(1), 500);
    assert.equal(backoffMs(2), 1000);
    assert.equal(backoffMs(10), 2000); // capped
  });

  test("clampTimeoutSec keeps 1..20 with fallback", () => {
    assert.equal(clampTimeoutSec(3), 3);
    assert.equal(clampTimeoutSec(0), 1);
    assert.equal(clampTimeoutSec(999), 20);
    assert.equal(clampTimeoutSec("x", 3), 3);
  });

  test("normalizeStatusCodes filters junk and falls back to defaults", () => {
    assert.deepEqual(normalizeStatusCodes([200, "204", 700, "x"]), [200, 204]);
    assert.deepEqual(normalizeStatusCodes("nope"), [200, 202, 204]);
    assert.deepEqual(normalizeStatusCodes([]), [200, 202, 204]);
  });

  test("matchService honors built-ins, custom services, and enabled flags", () => {
    const cfg = {
      services: { meet: true, teams: false, zoom: true },
      customServices: [{ name: "webex", enabled: true, prefixes: ["https://example.webex.com/"] }]
    };
    assert.equal(matchService("https://meet.google.com/abc", cfg), "meet");
    assert.equal(matchService("https://teams.microsoft.com/x", cfg), null); // disabled
    assert.equal(matchService("https://app.zoom.us/wc/123", cfg), "zoom");
    assert.equal(matchService("https://example.webex.com/m/9", cfg), "webex");
    assert.equal(matchService("https://news.example.com", cfg), null);
    assert.equal(matchService("", cfg), null);
  });
});

// ---------------------------------------------------------------------------
// Fix 6 — mode / timeout clamping
// ---------------------------------------------------------------------------

describe("Fix 6: clampMode / clampLocalTimeoutMs", () => {
  test("clampMode accepts only {0,1,2}", () => {
    assert.equal(clampMode(0), 0);
    assert.equal(clampMode(1), 1);
    assert.equal(clampMode(2), 2);
    assert.equal(clampMode("2"), 2); // numeric strings coerce
  });

  test("clampMode rejects out-of-range / junk to the fallback", () => {
    assert.equal(clampMode(7, 1), 1);
    assert.equal(clampMode(-1, 0), 0);
    assert.equal(clampMode("drop tables", 0), 0);
    assert.equal(clampMode(NaN, 1), 1);
    assert.equal(clampMode(undefined, 0), 0);
    assert.equal(clampMode(null, 0), 0); // Number(null) === 0 is valid, but null path uses fallback only if invalid
  });

  test("clampLocalTimeoutMs clamps to 100..10000 with fallback", () => {
    assert.equal(clampLocalTimeoutMs(1500), 1500);
    assert.equal(clampLocalTimeoutMs(50), 100);
    assert.equal(clampLocalTimeoutMs(999999), 10000);
    assert.equal(clampLocalTimeoutMs("x", 1500), 1500);
    assert.equal(clampLocalTimeoutMs(0, 1500), 1500);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — meeting URL opt-in / listener URL building
// ---------------------------------------------------------------------------

describe("Fix 3: meeting URL is opt-in", () => {
  test("meetingUrlForVars hides the URL unless includeMeetingUrl is on", () => {
    assert.equal(meetingUrlForVars({ includeMeetingUrl: false }, "https://meet/x"), "");
    assert.equal(meetingUrlForVars({}, "https://meet/x"), "");
    assert.equal(meetingUrlForVars({ includeMeetingUrl: true }, "https://meet/x"), "https://meet/x");
    assert.equal(meetingUrlForVars({ includeMeetingUrl: true }, null), "");
  });

  test("buildListenerUrl substitutes tokens when present", () => {
    const out = buildListenerUrl("http://h/e?s={state}&u={url}", { state: "ON", url: "" });
    assert.equal(out, "http://h/e?s=ON&u=");
  });

  test("buildListenerUrl appends params and omits url= when empty", () => {
    const out = buildListenerUrl("http://h/e", { state: "ON", service: "meet", url: "", ts: 7 });
    const u = new URL(out);
    assert.equal(u.searchParams.get("state"), "ON");
    assert.equal(u.searchParams.get("service"), "meet");
    assert.equal(u.searchParams.get("ts"), "7");
    assert.equal(u.searchParams.has("url"), false); // privacy: not appended when empty
  });

  test("buildListenerUrl appends url= only when provided", () => {
    const out = buildListenerUrl("http://h/e", { state: "ON", service: "meet", url: "https://meet/x", ts: 7 });
    assert.equal(new URL(out).searchParams.get("url"), "https://meet/x");
  });

  test("buildListenerUrl returns null on empty/invalid input", () => {
    assert.equal(buildListenerUrl("", {}), null);
    assert.equal(buildListenerUrl("not a url", { state: "ON" }), null);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — shared HTTP hook success rule
// ---------------------------------------------------------------------------

describe("Fix 4: httpHookSuccess", () => {
  const base = { checkStatus: true, statusCodes: [200, 204], matchOn: "", matchOff: "" };

  test("network error is always failure", () => {
    assert.equal(httpHookSuccess(base, "ON", { error: true }), false);
    assert.equal(httpHookSuccess(base, "ON", null), false);
  });

  test("checkStatus=false passes any non-error response", () => {
    const t = { ...base, checkStatus: false };
    assert.equal(httpHookSuccess(t, "ON", { status: 500, error: false }), true);
  });

  test("status must be in statusCodes when checkStatus=true", () => {
    assert.equal(httpHookSuccess(base, "ON", { status: 200, text: "", error: false }), true);
    assert.equal(httpHookSuccess(base, "ON", { status: 418, text: "", error: false }), false);
  });

  test("body match is enforced per state", () => {
    const t = { ...base, matchOn: '"mode":2', matchOff: '"mode":0' };
    assert.equal(httpHookSuccess(t, "ON", { status: 200, text: '{"mode":2}', error: false }), true);
    assert.equal(httpHookSuccess(t, "ON", { status: 200, text: '{"mode":1}', error: false }), false);
    assert.equal(httpHookSuccess(t, "OFF", { status: 200, text: '{"mode":0}', error: false }), true);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — cleartext-credential warnings
// ---------------------------------------------------------------------------

describe("Fix 2: endpoint security warnings", () => {
  test("isPrivateHost recognizes LAN / loopback / mDNS", () => {
    for (const u of [
      "http://localhost:8123/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.50/x",
      "http://172.16.0.1/x",
      "http://172.31.255.1/x",
      "http://device.local/x",
      "http://nas.lan/x",
      "http://bareword/x"
    ]) {
      assert.equal(isPrivateHost(u), true, u);
    }
    for (const u of ["https://example.com", "http://8.8.8.8/x", "http://172.32.0.1/x"]) {
      assert.equal(isPrivateHost(u), false, u);
    }
  });

  test("iotHybrid: token over public HTTP warns, HTTPS / LAN does not", () => {
    const pub = { type: "iotHybrid", cloudBase: "http://api.example.com", cloudToken: "secret" };
    assert.equal(endpointSecurityWarnings(pub).length, 1);

    const https = { type: "iotHybrid", cloudBase: "https://api.example.com", cloudToken: "secret" };
    assert.equal(endpointSecurityWarnings(https).length, 0);

    const lan = { type: "iotHybrid", localBase: "http://192.168.1.9", localToken: "secret" };
    assert.equal(endpointSecurityWarnings(lan).length, 0);

    const noToken = { type: "iotHybrid", cloudBase: "http://api.example.com", cloudToken: "" };
    assert.equal(endpointSecurityWarnings(noToken).length, 0);
  });

  test("httpHook: Authorization header over public HTTP warns", () => {
    const t = {
      type: "httpHook",
      onUrl: "http://api.example.com/on",
      offUrl: "http://api.example.com/off",
      headers: [{ key: "Authorization", value: "Bearer abc" }]
    };
    assert.equal(endpointSecurityWarnings(t).length, 2); // on + off

    const safe = { ...t, onUrl: "https://api.example.com/on", offUrl: "https://api.example.com/off" };
    assert.equal(endpointSecurityWarnings(safe).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — secret splitting (sync vs local) and export redaction
// ---------------------------------------------------------------------------

describe("Fix 1: secret splitting & export redaction", () => {
  const sample = () => ({
    targets: [
      { id: "iot1", type: "iotHybrid", localToken: "LT", cloudToken: "CT", cloudBase: "https://a", thing: "x" },
      {
        id: "hook1",
        type: "httpHook",
        onUrl: "https://h/on",
        basicAuth: { user: "u", pass: "P" },
        headers: [{ key: "Authorization", value: "Bearer ZZZ" }, { key: "Accept", value: "text/plain" }]
      },
      { id: "listen1", type: "listener", url: "http://h/e" }
    ]
  });

  test("extractSecrets blanks credentials and collects them by id", () => {
    const { config, secrets } = extractSecrets(sample());

    // sanitized config carries no secret material
    const iot = config.targets[0];
    assert.equal(iot.localToken, "");
    assert.equal(iot.cloudToken, "");
    const hook = config.targets[1];
    assert.equal(hook.basicAuth.pass, "");
    assert.equal(hook.headers.find(h => h.key === "Authorization").value, "");
    assert.equal(hook.headers.find(h => h.key === "Accept").value, "text/plain"); // non-secret untouched

    // secrets map captured everything
    assert.deepEqual(secrets.iot1, { localToken: "LT", cloudToken: "CT" });
    assert.equal(secrets.hook1.basicAuthPass, "P");
    assert.equal(secrets.hook1.headers.authorization, "Bearer ZZZ");
    assert.equal(secrets.listen1, undefined);
  });

  test("applySecrets is the inverse of extractSecrets (round-trip)", () => {
    const original = sample();
    const { config, secrets } = extractSecrets(original);
    const restored = applySecrets(config, secrets);
    assert.deepEqual(restored, original);
  });

  test("applySecrets never overwrites a value already present", () => {
    const { config, secrets } = extractSecrets(sample());
    config.targets[0].cloudToken = "EDITED";
    const restored = applySecrets(config, secrets);
    assert.equal(restored.targets[0].cloudToken, "EDITED"); // edit wins over stored secret
    assert.equal(restored.targets[0].localToken, "LT");     // untouched field still restored
  });

  test("redactSecrets produces a credential-free copy and leaves the input untouched", () => {
    const original = sample();
    const redacted = redactSecrets(original);
    const blob = JSON.stringify(redacted);
    assert.equal(blob.includes("LT"), false);
    assert.equal(blob.includes("CT"), false);
    assert.equal(blob.includes("Bearer ZZZ"), false);
    assert.equal(blob.includes('"P"'), false);
    // original object not mutated
    assert.equal(original.targets[0].cloudToken, "CT");
  });
});

describe("Fix 1 (export decision): hasSecrets / resolveExportSecrets / exportFileName", () => {
  const withSecrets = () => [
    { id: "iot1", type: "iotHybrid", localToken: "LT", cloudToken: "CT", cloudBase: "https://a", thing: "x" }
  ];
  const noSecrets = () => [
    { id: "led1", type: "simpleLed", baseUrl: "http://192.168.1.5" }
  ];

  test("hasSecrets detects credential-bearing targets", () => {
    assert.equal(hasSecrets(withSecrets()), true);
    assert.equal(hasSecrets(noSecrets()), false);
    assert.equal(hasSecrets([]), false);
    assert.equal(hasSecrets(undefined), false);
  });

  test("default export (wantSecrets=false) strips credentials", () => {
    const r = resolveExportSecrets(withSecrets(), false);
    assert.equal(r.hasSecrets, true);
    assert.equal(r.includesSecrets, false);
    const blob = JSON.stringify(r.targets);
    assert.equal(blob.includes("LT"), false);
    assert.equal(blob.includes("CT"), false);
  });

  test("opt-in export (wantSecrets=true) keeps credentials", () => {
    const r = resolveExportSecrets(withSecrets(), true);
    assert.equal(r.hasSecrets, true);
    assert.equal(r.includesSecrets, true);
    assert.equal(r.targets[0].localToken, "LT");
    assert.equal(r.targets[0].cloudToken, "CT");
  });

  test("opt-in has no effect when there are no secrets to include", () => {
    const r = resolveExportSecrets(noSecrets(), true);
    assert.equal(r.hasSecrets, false);
    assert.equal(r.includesSecrets, false); // nothing to include
  });

  test("exportFileName flags secret-bearing files", () => {
    assert.equal(exportFileName(true), "onair-settings-with-secrets.json");
    assert.equal(exportFileName(false), "onair-settings.json");
  });
});
