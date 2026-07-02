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
  originOf,
  httpHookSuccess,
  isPrivateHost,
  endpointSecurityWarnings,
  extractSecrets,
  applySecrets,
  redactSecrets,
  hasSecrets,
  resolveExportSecrets,
  exportFileName,
  formatBuildBadge,
  BLANK_CHOICES,
  resolveAddChoice,
  PAUSE_INDEFINITE,
  isPaused,
  pauseRemainingMs,
  describePause,
  countEnabledTargets,
  describeMeetingState,
  settingsSignature,
  reconcileModesFor,
  resolveReconcile,
  migrateReconcile,
  parseDeviceMode,
  reconcileDrift,
  parseCloudStateMode,
  DEFAULT_RECONCILE,
  modeLabel,
  targetSeverity,
  logSeverity,
  describeTargetLine,
  describeLogEntry
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
  test("originOf strips path/query, keeps scheme+host", () => {
    assert.equal(originOf("https://meet.google.com/abc-defg-hij?x=1"), "https://meet.google.com");
    assert.equal(originOf("https://teams.microsoft.com/l/meetup-join/9"), "https://teams.microsoft.com");
    assert.equal(originOf("garbage"), "");
    assert.equal(originOf(""), "");
  });

  test("meetingUrlForVars sends origin-only when off, full URL when on", () => {
    const full = "https://meet.google.com/abc-defg-hij";
    // off → origin only (host shared, meeting ID withheld)
    assert.equal(meetingUrlForVars({ includeMeetingUrl: false }, full), "https://meet.google.com");
    assert.equal(meetingUrlForVars({}, full), "https://meet.google.com");
    // on → full URL incl. meeting ID
    assert.equal(meetingUrlForVars({ includeMeetingUrl: true }, full), full);
    // empty / unparseable → nothing
    assert.equal(meetingUrlForVars({ includeMeetingUrl: false }, ""), "");
    assert.equal(meetingUrlForVars({ includeMeetingUrl: true }, null), "");
    assert.equal(meetingUrlForVars({ includeMeetingUrl: false }, "not a url"), "");
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

describe("dev build badge: formatBuildBadge", () => {
  test("renders version-dev · branch @ commit for a feature branch", () => {
    assert.equal(
      formatBuildBadge({ branch: "feature-x", commit: "abc1234", dirty: false }, "0.3.7"),
      "v0.3.7-dev · feature-x @ abc1234"
    );
  });

  test("marks a dirty working tree with *", () => {
    assert.equal(
      formatBuildBadge({ branch: "feature-x", commit: "abc1234", dirty: true }, "0.3.7"),
      "v0.3.7-dev · feature-x @ abc1234*"
    );
  });

  test("falls back to 'dev' when no version is given", () => {
    assert.equal(
      formatBuildBadge({ branch: "wip", commit: "deadbee" }, undefined),
      "dev · wip @ deadbee"
    );
  });

  test("renders nothing for main / detached / unknown / missing info", () => {
    assert.equal(formatBuildBadge(null, "0.3.7"), null);
    assert.equal(formatBuildBadge({ branch: "main", commit: "abc" }, "0.3.7"), null);
    assert.equal(formatBuildBadge({ branch: "HEAD", commit: "abc" }, "0.3.7"), null); // detached (CI/tag)
    assert.equal(formatBuildBadge({ branch: "unknown", commit: "abc" }, "0.3.7"), null);
    assert.equal(formatBuildBadge({ branch: "", commit: "abc" }, "0.3.7"), null);
  });
});

describe('"Add target" dropdown: resolveAddChoice', () => {
  const templates = {
    tasmota: { label: "Tasmota (GET)", target: { type: "httpHook" } },
    aws_iot_hybrid: { label: "OnAir IoT", target: { type: "iotHybrid" } }
  };

  test("placeholder maps to a no-op", () => {
    assert.deepEqual(resolveAddChoice("", templates), { kind: "none" });
  });

  test("blank choices add an empty target of the right type", () => {
    assert.deepEqual(resolveAddChoice("__blank_httpHook", templates), { kind: "blank", type: "httpHook" });
    assert.deepEqual(resolveAddChoice("__blank_listener", templates), { kind: "blank", type: "listener" });
  });

  test("template choices carry the template key and its target type", () => {
    assert.deepEqual(resolveAddChoice("tasmota", templates), { kind: "template", templateKey: "tasmota", type: "httpHook" });
    assert.deepEqual(resolveAddChoice("aws_iot_hybrid", templates), { kind: "template", templateKey: "aws_iot_hybrid", type: "iotHybrid" });
  });

  test("unrecognized values resolve to 'unknown'", () => {
    assert.deepEqual(resolveAddChoice("does_not_exist", templates), { kind: "unknown" });
  });

  test("BLANK_CHOICES covers the two former add buttons", () => {
    assert.deepEqual(Object.values(BLANK_CHOICES).map(c => c.type).sort(), ["httpHook", "listener"]);
  });
});

describe("UI: pause state", () => {
  const now = 1_000_000;

  test("isPaused handles none / indefinite / timed / expired", () => {
    assert.equal(isPaused(undefined, now), false);
    assert.equal(isPaused({ until: 0 }, now), false);
    assert.equal(isPaused({ until: PAUSE_INDEFINITE }, now), true);
    assert.equal(isPaused({ until: now + 1000 }, now), true);
    assert.equal(isPaused({ until: now - 1000 }, now), false); // expired
  });

  test("pauseRemainingMs returns Infinity for indefinite, ms for timed", () => {
    assert.equal(pauseRemainingMs({ until: PAUSE_INDEFINITE }, now), Infinity);
    assert.equal(pauseRemainingMs({ until: now + 5000 }, now), 5000);
    assert.equal(pauseRemainingMs({ until: 0 }, now), 0);
  });

  test("describePause is human-readable or null", () => {
    assert.equal(describePause(null, now), null);
    assert.equal(describePause({ until: PAUSE_INDEFINITE }, now), "Paused");
    assert.equal(describePause({ until: now + 25 * 60000 }, now), "Paused · 25m left");
    assert.equal(describePause({ until: now + 90 * 60000 }, now), "Paused · 1h 30m left");
    assert.equal(describePause({ until: now + 60 * 60000 }, now), "Paused · 1h left");
  });
});

describe("UI: popup summary helpers", () => {
  test("countEnabledTargets counts only enabled", () => {
    assert.equal(countEnabledTargets({ targets: [{ enabled: true }, { enabled: false }, { enabled: true }] }), 2);
    assert.equal(countEnabledTargets({ targets: [] }), 0);
    assert.equal(countEnabledTargets({}), 0);
  });

  test("describeMeetingState is plain language", () => {
    assert.equal(describeMeetingState("OFF", null), "No meeting detected");
    assert.equal(describeMeetingState("ON", "meet"), "In Google Meet");
    assert.equal(describeMeetingState("ON", "zoom"), "In Zoom");
    assert.equal(describeMeetingState("ON", "Webex"), "In Webex"); // custom service name passthrough
  });
});

describe("UI: settingsSignature (dirty detection)", () => {
  const cfg = () => ({
    services: { meet: true, teams: false, zoom: true },
    triggerMode: "ANY_TAB", timeoutSec: 3, iconMode: "alwaysColor",
    includeMeetingUrl: false, theme: "light", customServices: [],
    targets: [{ id: "a1", type: "httpHook", enabled: true, onUrl: "https://h/on", offUrl: "https://h/off" }]
  });

  test("identical configs (and id-only differences) produce the same signature", () => {
    const a = cfg();
    const b = cfg();
    b.targets[0].id = "different-id"; // id must not affect the signature
    assert.equal(settingsSignature(a), settingsSignature(b));
  });

  test("theme is excluded (toggling it is not an unsaved change)", () => {
    const a = cfg();
    const b = cfg();
    b.theme = "dark"; // a.theme is "light"
    assert.equal(settingsSignature(a), settingsSignature(b));
  });

  test("a meaningful change flips the signature", () => {
    const a = cfg();
    const b = cfg();
    b.targets[0].onUrl = "https://h/on2";
    assert.notEqual(settingsSignature(a), settingsSignature(b));

    const c = cfg();
    c.services.teams = true;
    assert.notEqual(settingsSignature(a), settingsSignature(c));
  });
});

// ---------------------------------------------------------------------------
// Reconcile policy (single / verify / always) + device state readback
// ---------------------------------------------------------------------------

describe("reconcile policy", () => {
  test("reconcileModesFor constrains modes by target type", () => {
    assert.deepEqual(reconcileModesFor("listener"), ["single"]);
    assert.deepEqual(reconcileModesFor("httpHook"), ["single", "always"]);
    assert.deepEqual(reconcileModesFor("simpleLed"), ["single", "verify", "always"]);
    assert.deepEqual(reconcileModesFor("iotHybrid"), ["single", "verify", "always"]);
    assert.deepEqual(reconcileModesFor("bogus"), ["single"]);
  });

  test("resolveReconcile falls back to the type default when unset", () => {
    assert.equal(resolveReconcile({ type: "listener" }), "single");
    assert.equal(resolveReconcile({ type: "httpHook" }), "single");
    assert.equal(resolveReconcile({ type: "simpleLed" }), "verify");
    assert.equal(resolveReconcile({ type: "iotHybrid" }), "verify");
  });

  test("resolveReconcile clamps an unsupported mode back to the default", () => {
    // verify isn't valid for a notification target — must not stick
    assert.equal(resolveReconcile({ type: "listener", reconcile: "verify" }), "single");
    assert.equal(resolveReconcile({ type: "listener", reconcile: "always" }), "single");
    assert.equal(resolveReconcile({ type: "httpHook", reconcile: "verify" }), "single");
    // a valid choice is honored
    assert.equal(resolveReconcile({ type: "httpHook", reconcile: "always" }), "always");
    assert.equal(resolveReconcile({ type: "simpleLed", reconcile: "single" }), "single");
  });

  test("migrateReconcile folds legacy verifyStatus into reconcile", () => {
    assert.equal(migrateReconcile({ type: "simpleLed", verifyStatus: true }).reconcile, "verify");
    assert.equal(migrateReconcile({ type: "simpleLed", verifyStatus: false }).reconcile, "single");
    // non-LED types get their default
    assert.equal(migrateReconcile({ type: "listener" }).reconcile, "single");
    assert.equal(migrateReconcile({ type: "iotHybrid" }).reconcile, "verify");
  });

  test("migrateReconcile is idempotent and honors an explicit reconcile", () => {
    const once = migrateReconcile({ type: "simpleLed", verifyStatus: true });
    const twice = migrateReconcile(once);
    assert.equal(twice.reconcile, "verify");
    // explicit reconcile wins over the legacy flag
    assert.equal(migrateReconcile({ type: "simpleLed", reconcile: "single", verifyStatus: true }).reconcile, "single");
  });

  test("DEFAULT_RECONCILE never defaults a notification target to a re-firing mode", () => {
    assert.equal(DEFAULT_RECONCILE.listener, "single");
  });
});

describe("device state readback", () => {
  test("parseDeviceMode reads output_mode strings", () => {
    assert.equal(parseDeviceMode({ output_mode: "off" }), 0);
    assert.equal(parseDeviceMode({ output_mode: "on" }), 1);
    assert.equal(parseDeviceMode({ output_mode: "breathing" }), 2);
    assert.equal(parseDeviceMode({ output_mode: "ON" }), 1); // case-insensitive
  });

  test("parseDeviceMode falls back to the legacy state boolean", () => {
    assert.equal(parseDeviceMode({ state: true }), 1);
    assert.equal(parseDeviceMode({ state: false }), 0);
  });

  test("parseDeviceMode returns null when it can't tell", () => {
    assert.equal(parseDeviceMode(null), null);
    assert.equal(parseDeviceMode({}), null);
    assert.equal(parseDeviceMode("nope"), null);
    assert.equal(parseDeviceMode({ output_mode: "purple" }), null);
  });

  test("reconcileDrift compares desired vs actual", () => {
    assert.equal(reconcileDrift(1, 1), false);   // matches
    assert.equal(reconcileDrift(1, 0), true);    // drifted
    assert.equal(reconcileDrift(2, 1), true);
    assert.equal(reconcileDrift(1, null), null); // unknown — caller decides
    assert.equal(reconcileDrift(1, undefined), null);
  });
});

describe("settingsSignature reconcile awareness", () => {
  const led = (reconcile) => ({
    services: { meet: true }, targets: [{ id: "x", type: "simpleLed", enabled: true, baseUrl: "http://d", reconcile }]
  });
  test("changing a target's reconcile mode is a settings change", () => {
    assert.notEqual(settingsSignature(led("single")), settingsSignature(led("always")));
  });
  test("an unset reconcile signs identically to its resolved default", () => {
    // simpleLed default is verify — unset and explicit-verify must match
    const unset = { services: { meet: true }, targets: [{ id: "x", type: "simpleLed", enabled: true, baseUrl: "http://d" }] };
    assert.equal(settingsSignature(unset), settingsSignature(led("verify")));
  });
});

// ---------------------------------------------------------------------------
// Diagnostics: humanized activity log
// ---------------------------------------------------------------------------

describe("diagnostics humanizer", () => {
  test("modeLabel maps device modes to words", () => {
    assert.equal(modeLabel(0), "off");
    assert.equal(modeLabel(1), "on");
    assert.equal(modeLabel(2), "breathing");
    assert.equal(modeLabel(9), "9"); // unknown falls through
  });

  test("targetSeverity classifies per-target outcomes", () => {
    assert.equal(targetSeverity({ ok: false }), "error");
    assert.equal(targetSeverity({ action: "remediate", drift: true }), "warn");
    assert.equal(targetSeverity({ noop: true }), "muted");
    assert.equal(targetSeverity({ ok: true, action: "edge" }), "ok");
  });

  test("logSeverity is the worst of an entry's targets", () => {
    assert.equal(logSeverity({ targets: [{ noop: true }, { ok: true }] }), "ok");
    assert.equal(logSeverity({ targets: [{ ok: true }, { ok: false }] }), "error");
    assert.equal(logSeverity({ targets: [{ ok: true }, { action: "remediate" }] }), "warn");
    assert.equal(logSeverity({ kind: "worker", event: "started" }), "info");
    assert.equal(logSeverity({ targets: [] }), "muted");
  });

  test("describeTargetLine renders plain English with latency and errors", () => {
    assert.match(
      describeTargetLine({ type: "iotHybrid", action: "remediate", actual: 2, via: "local", ms: 42 }).text,
      /IoT sign drifted \(was breathing\) — corrected via local · 42 ms/
    );
    assert.match(
      describeTargetLine({ type: "listener", ok: false, error: "timeout", ms: 3000 }).text,
      /Listener failed — timeout · 3000 ms/
    );
    assert.match(
      describeTargetLine({ type: "iotHybrid", action: "verify", noop: true, actual: 1 }).text,
      /IoT sign already correct \(on\)/
    );
  });

  test("describeLogEntry summarizes an edge and a reconcile", () => {
    const edge = describeLogEntry({
      kind: "edge", reason: "activated", to: "ON", service: "meet",
      targets: [{ type: "listener", ok: true, ms: 20 }]
    });
    assert.equal(edge.severity, "ok");
    assert.match(edge.headline, /State change · In meeting \(meet\)/);
    assert.equal(edge.lines.length, 1);

    const rec = describeLogEntry({
      kind: "reconcile", to: "OFF",
      targets: [{ type: "iotHybrid", action: "remediate", actual: 2, drift: true, ok: true }]
    });
    assert.equal(rec.severity, "warn");
    assert.match(rec.headline, /Reconcile · No meeting/);
    assert.equal(rec.reason, "alarm"); // defaulted for reconcile entries
  });

  test("describeLogEntry handles worker lifecycle markers", () => {
    const d = describeLogEntry({ kind: "worker", event: "started", ts: 123 });
    assert.equal(d.severity, "info");
    assert.match(d.headline, /Service worker started/);
    assert.deepEqual(d.lines, []);
  });
});

// ---------------------------------------------------------------------------
// Cloud state readback (iotHybrid cloud-leg verify — Phase 3)
// ---------------------------------------------------------------------------

describe("parseCloudStateMode", () => {
  test("reads the bare mode from the Lambda response", () => {
    assert.equal(parseCloudStateMode({ ok: true, thing: "x", mode: 2 }), 2);
    assert.equal(parseCloudStateMode({ ok: true, mode: 0 }), 0);
    assert.equal(parseCloudStateMode('{"ok":true,"mode":1}'), 1); // JSON string
  });

  test("falls back to the reported doc when mode is absent", () => {
    assert.equal(parseCloudStateMode({ ok: true, reported: { output_mode: "breathing" } }), 2);
    assert.equal(parseCloudStateMode({ ok: true, reported: { state: true } }), 1);
  });

  test("returns null for errors, junk, or out-of-range modes", () => {
    assert.equal(parseCloudStateMode({ ok: false, error: "no shadow" }), null);
    assert.equal(parseCloudStateMode({ ok: true, mode: 9 }), null);
    assert.equal(parseCloudStateMode("not json"), null);
    assert.equal(parseCloudStateMode(null), null);
    assert.equal(parseCloudStateMode({ ok: true }), null); // no mode, no reported
  });
});
