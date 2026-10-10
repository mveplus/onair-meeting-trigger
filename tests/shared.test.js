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
  describeLogEntry,
  bodyEncodingFor,
  redirectPolicyFor,
  isRelevantTabUpdate,
  isSecretHeader,
  urlCarriesSecret,
  urlMatchesPrefix,
  prefixToMatchPattern,
  serviceMatchPatterns,
  originPatternsFor,
  orphanedOrigins,
  importDestinations,
  targetDisplayName,
  targetHost,
  describeCustomService,
  supportedTargets,
  findPlaceholders,
  originPatternFor,
  normalizePrefixes,
  describeTestResult,
  summarizeDispatch,
  describeDispatchHealth,
  formatAgo,
  describePausedState,
  missingOrigins,
  PAUSE_INDEFINITE as PAUSE_FOREVER
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
    { id: "l1", type: "listener", url: "http://192.168.1.5/e" }
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
    assert.deepEqual(reconcileModesFor("iotHybrid"), ["single", "verify", "always"]);
    assert.deepEqual(reconcileModesFor("bogus"), ["single"]);
  });

  test("resolveReconcile falls back to the type default when unset", () => {
    assert.equal(resolveReconcile({ type: "listener" }), "single");
    assert.equal(resolveReconcile({ type: "httpHook" }), "single");
    assert.equal(resolveReconcile({ type: "iotHybrid" }), "verify");
  });

  test("resolveReconcile clamps an unsupported mode back to the default", () => {
    // verify isn't valid for a notification target — must not stick
    assert.equal(resolveReconcile({ type: "listener", reconcile: "verify" }), "single");
    assert.equal(resolveReconcile({ type: "listener", reconcile: "always" }), "single");
    assert.equal(resolveReconcile({ type: "httpHook", reconcile: "verify" }), "single");
    // a valid choice is honored
    assert.equal(resolveReconcile({ type: "httpHook", reconcile: "always" }), "always");
    assert.equal(resolveReconcile({ type: "iotHybrid", reconcile: "single" }), "single");
  });

  test("migrateReconcile gives each type its default", () => {
    assert.equal(migrateReconcile({ type: "listener" }).reconcile, "single");
    assert.equal(migrateReconcile({ type: "iotHybrid" }).reconcile, "verify");
  });

  test("migrateReconcile is idempotent and honors an explicit reconcile", () => {
    const once = migrateReconcile({ type: "iotHybrid" });
    const twice = migrateReconcile(once);
    assert.equal(twice.reconcile, "verify");
    assert.equal(migrateReconcile({ type: "iotHybrid", reconcile: "single" }).reconcile, "single");
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
    services: { meet: true }, targets: [{ id: "x", type: "iotHybrid", enabled: true, cloudBase: "http://d", reconcile }]
  });
  test("changing a target's reconcile mode is a settings change", () => {
    assert.notEqual(settingsSignature(led("single")), settingsSignature(led("always")));
  });
  test("an unset reconcile signs identically to its resolved default", () => {
    // iotHybrid default is verify — unset and explicit-verify must match
    const unset = { services: { meet: true }, targets: [{ id: "x", type: "iotHybrid", enabled: true, cloudBase: "http://d" }] };
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

// ---------------------------------------------------------------------------
// 2026-10 review fixes (S/R/P/U IDs — see PRs #18 and #19)
// ---------------------------------------------------------------------------

describe("S1: context-aware template escaping", () => {
  const evil = { state: "ON", service: "meet", url: "https://meet.google.com/abc?a=1&state=OFF", ts: 1 };

  test("url mode encodes values so params can't be injected", () => {
    const out = applyTemplate("http://h/x?u={url}&state={state}", evil, "url");
    assert.equal(out, "http://h/x?u=https%3A%2F%2Fmeet.google.com%2Fabc%3Fa%3D1%26state%3DOFF&state=ON");
    assert.equal(new URL(out).searchParams.getAll("state").join(","), "ON");
  });

  test("json mode escapes quotes so fields can't be injected", () => {
    const vars = { ...evil, service: 'x","admin":true,"y":"' };
    const out = applyTemplate('{"svc":"{service}"}', vars, "json");
    assert.deepEqual(JSON.parse(out), { svc: 'x","admin":true,"y":"' });
  });

  test("{url_raw} is never escaped; default mode stays raw", () => {
    assert.equal(applyTemplate("u={url_raw}", evil, "url"), `u=${evil.url}`);
    assert.equal(applyTemplate("u={url}", evil), `u=${evil.url}`);
  });

  test("buildListenerUrl encodes token values", () => {
    const out = buildListenerUrl("http://h/e?s={state}&u={url}", evil);
    assert.equal(new URL(out).searchParams.get("u"), evil.url);
    assert.equal(new URL(out).searchParams.getAll("state").length, 0);
  });

  test("bodyEncodingFor picks json only for JSON-looking bodies", () => {
    assert.equal(bodyEncodingFor(' {"a":1}'), "json");
    assert.equal(bodyEncodingFor("[1]"), "json");
    assert.equal(bodyEncodingFor("state={state}"), "none");
    assert.equal(bodyEncodingFor(undefined), "none");
  });
});

describe("S2: isPrivateHost only trusts real IP literals", () => {
  test("look-alike hostnames are public", () => {
    for (const u of ["http://10.evil.com/", "http://192.168.attacker.net/", "http://127.0.0.1.nip.io/", "http://172.16.x.io/"]) {
      assert.equal(isPrivateHost(u), false, u);
    }
  });

  test("private IPv4/IPv6 literals and LAN names are private", () => {
    for (const u of ["http://169.254.1.1/", "http://100.100.1.1/", "http://[::1]/", "http://[fd00::1]/",
      "http://[fe80::1]/", "http://[::ffff:192.168.1.1]/", "http://router.home.arpa/", "http://x.localhost/"]) {
      assert.equal(isPrivateHost(u), true, u);
    }
  });

  test("public IPv6 and CGNAT edge are public", () => {
    for (const u of ["http://[2001:db8::1]/", "http://[::ffff:8.8.8.8]/", "http://100.128.0.1/"]) {
      assert.equal(isPrivateHost(u), false, u);
    }
  });

  test("the cleartext-token warning now fires for a look-alike host", () => {
    const t = { type: "iotHybrid", cloudBase: "http://10.evil.com", cloudToken: "secret" };
    assert.equal(endpointSecurityWarnings(t).length, 1);
  });
});

describe("S3: redirect policy for credentialed requests", () => {
  test("iotHybrid never follows redirects", () => {
    assert.equal(redirectPolicyFor({ type: "iotHybrid" }), "error");
  });

  test("httpHook refuses redirects only when it carries credentials", () => {
    assert.equal(redirectPolicyFor({ type: "httpHook", headers: [] }), "follow");
    assert.equal(redirectPolicyFor({ type: "httpHook", headers: [{ key: "X-API-Token", value: "t" }] }), "error");
    assert.equal(redirectPolicyFor({ type: "httpHook", headers: [{ key: "Authorization", value: "" }] }), "follow");
    assert.equal(redirectPolicyFor({ type: "httpHook", basicAuth: { user: "u", pass: "" } }), "error");
  });

  test("listeners follow redirects", () => {
    assert.equal(redirectPolicyFor({ type: "listener" }), "follow");
  });
});

describe("R1: superseded requests render as expected, not as failures", () => {
  test("superseded target is muted with a plain-English line", () => {
    const t = { type: "listener", ok: false, superseded: true, ms: 12 };
    assert.equal(targetSeverity(t), "muted");
    assert.equal(describeTargetLine(t).text, "Listener cancelled — superseded by a newer change · 12 ms");
    assert.equal(logSeverity({ kind: "edge", targets: [t] }), "muted");
  });
});

describe("P1: tab update filtering", () => {
  test("only URL changes and finished loads are relevant", () => {
    assert.equal(isRelevantTabUpdate({ url: "https://meet.google.com/x" }), true);
    assert.equal(isRelevantTabUpdate({ status: "complete" }), true);
    assert.equal(isRelevantTabUpdate({ status: "loading" }), false);
    assert.equal(isRelevantTabUpdate({ title: "Meet" }), false);
    assert.equal(isRelevantTabUpdate({ favIconUrl: "x" }), false);
    assert.equal(isRelevantTabUpdate({ audible: true }), false);
    assert.equal(isRelevantTabUpdate(undefined), false);
  });
});

describe("S4: wider secret detection", () => {
  test("credential-looking header names are secret", () => {
    for (const k of ["Authorization", "X-API-Token", "X-Api-Key", "Cookie", "X-Auth-Token", "Api-Key", "X-Session-Id"]) {
      assert.equal(isSecretHeader(k), true, k);
    }
    for (const k of ["Content-Type", "Accept", "User-Agent", "Keep-Alive", ""]) {
      assert.equal(isSecretHeader(k), false, k);
    }
  });

  test("URL-borne secrets are recognized", () => {
    for (const u of [
      "http://ha.local:8123/api/webhook/abc123",
      "https://hooks.slack.com/services/T0/B0/xyz",
      "https://discord.com/api/webhooks/1/abc",
      "https://maker.ifttt.com/trigger/onair/with/key/abc",
      "https://ntfy.sh/topic?auth=xyz",
      "https://api.example.com/x?api_key=1&state={state}",
      "https://user:pw@example.com/x"
    ]) {
      assert.equal(urlCarriesSecret(u), true, u);
    }
    for (const u of ["http://127.0.0.1:8765/event?state={state}&url={url}", "http://192.168.1.17/cm?cmnd=Power%20On", "", "nope"]) {
      assert.equal(urlCarriesSecret(u), false, u);
    }
  });

  test("custom secret headers and secret URLs round-trip through extract/apply", () => {
    const cfg = { targets: [
      { id: "h1", type: "httpHook", onUrl: "http://ha.local/api/webhook/on123", offUrl: "http://lan/off",
        headers: [{ key: "X-Api-Key", value: "k" }, { key: "Content-Type", value: "text/plain" }] },
      { id: "l1", type: "listener", url: "https://ntfy.sh/t?auth=abc" }
    ] };
    const { config: clean, secrets } = extractSecrets(cfg);
    const json = JSON.stringify(clean);
    for (const leak of ["on123", "\"k\"", "auth=abc"]) assert.ok(!json.includes(leak), leak);
    assert.equal(clean.targets[0].offUrl, "http://lan/off");
    assert.equal(clean.targets[0].headers[1].value, "text/plain");
    assert.deepEqual(applySecrets(clean, secrets), cfg);
  });

  test("a secret listener URL over public http warns", () => {
    assert.equal(endpointSecurityWarnings({ type: "listener", url: "http://example.com/x?token=1" }).length, 1);
    assert.equal(endpointSecurityWarnings({ type: "listener", url: "http://example.com/x" }).length, 0);
  });
});

describe("S6: origin-exact prefix matching", () => {
  test("look-alike hosts don't match", () => {
    assert.equal(urlMatchesPrefix("https://webex.com.evil.io/x", "https://webex.com"), false);
    assert.equal(urlMatchesPrefix("https://webex.com@evil.io/x", "https://webex.com"), false);
    assert.equal(urlMatchesPrefix("http://webex.com/x", "https://webex.com"), false);
  });

  test("same origin + path prefix matches", () => {
    assert.equal(urlMatchesPrefix("https://webex.com/meet/1", "https://webex.com"), true);
    assert.equal(urlMatchesPrefix("https://WEBEX.com/meet/1", "https://webex.com/meet/"), true);
    assert.equal(urlMatchesPrefix("https://webex.com/other", "https://webex.com/meet/"), false);
    assert.equal(urlMatchesPrefix("https://webex.com/x", "not a url"), false);
  });

  test("matchService uses the safe matcher for custom services", () => {
    const cfg = { customServices: [{ enabled: true, name: "webex", prefixes: ["https://webex.com"] }] };
    assert.equal(matchService("https://webex.com.evil.io/", cfg), null);
    assert.equal(matchService("https://webex.com/m", cfg), "webex");
  });
});

describe("P4: match patterns for tabs.query", () => {
  test("prefixes convert to Chrome match patterns", () => {
    assert.equal(prefixToMatchPattern("https://meet.google.com/"), "https://meet.google.com/*");
    assert.equal(prefixToMatchPattern("https://x.com/meet"), "https://x.com/meet*");
    assert.equal(prefixToMatchPattern("http://x:8080/"), null);
    assert.equal(prefixToMatchPattern("https://x.com/?a=1"), null);
    assert.equal(prefixToMatchPattern("file:///x"), null);
  });

  test("any unconvertible prefix falls back to null (query all tabs)", () => {
    assert.deepEqual(serviceMatchPatterns({ services: { meet: true } }), ["https://meet.google.com/*"]);
    assert.deepEqual(serviceMatchPatterns({ services: {} }), []);
    assert.equal(serviceMatchPatterns({ services: { meet: true },
      customServices: [{ enabled: true, name: "c", prefixes: ["http://lan:9000/"] }] }), null);
  });
});

describe("P7 / S8: host permission helpers", () => {
  test("origin patterns are deduplicated and template-safe", () => {
    assert.deepEqual(
      originPatternsFor(["http://a:8080/x?s={state}", "http://a:8080/y", "https://b/", "bad", "ftp://c/"]),
      ["http://a:8080/*", "https://b/*"]
    );
  });

  test("orphaned origins exclude kept and non-site grants", () => {
    assert.deepEqual(
      orphanedOrigins(["http://a/*", "http://b:81/*", "<all_urls>", "https://*/*"], ["http://a/*"]),
      ["http://b:81/*"]
    );
  });
});

describe("S5: import destinations", () => {
  test("lists every host an import would contact", () => {
    assert.deepEqual(
      importDestinations([
        { type: "listener", url: "https://evil.example/x?u={url}" },
        { type: "iotHybrid", localBase: "http://10.0.0.5", cloudBase: "https://api.aws.com" },
        { type: "httpHook", onUrl: "https://evil.example/on", offUrl: "" }
      ]),
      ["10.0.0.5", "api.aws.com", "evil.example"]
    );
  });
});

// ---------------------------------------------------------------------------
// UI helpers (U1, U3, U7, U8, U13)
// ---------------------------------------------------------------------------

describe("U7: target names and summaries", () => {
  test("user name wins, else a readable type", () => {
    assert.equal(targetDisplayName({ type: "iotHybrid", name: "  Office sign " }), "Office sign");
    assert.equal(targetDisplayName({ type: "httpHook", name: "" }), "HTTP hook");
  });

  test("targetHost picks the main URL and tolerates tokens", () => {
    assert.equal(targetHost({ type: "listener", url: "http://127.0.0.1:8765/e?s={state}" }), "127.0.0.1:8765");
    assert.equal(targetHost({ type: "httpHook", onUrl: "", offUrl: "https://ntfy.sh/t" }), "ntfy.sh");
    assert.equal(targetHost({ type: "iotHybrid", cloudBase: "https://api.aws.com" }), "api.aws.com");
    assert.equal(targetHost({ type: "listener", url: "" }), "");
  });

  test("the name counts as an unsaved change", () => {
    const a = { targets: [{ type: "listener", url: "http://x", name: "A" }] };
    const b = { targets: [{ type: "listener", url: "http://x", name: "B" }] };
    assert.notEqual(settingsSignature(a), settingsSignature(b));
  });
});

describe("U8: describeTestResult", () => {
  test("success and the common failure reasons", () => {
    assert.deepEqual(describeTestResult({ ok: true, status: 200, via: "local", ms: 30 }), { ok: true, text: "Worked via local (HTTP 200) · 30 ms" });
    assert.match(describeTestResult({ ok: false, error: "timeout" }).text, /timed out/);
    assert.match(describeTestResult({ ok: false, status: 401 }).text, /check token/);
    assert.match(describeTestResult({ ok: false, status: 500 }).text, /HTTP 500/);
    assert.match(describeTestResult({ ok: false, skipped: true }).text, /fill in the URL/);
    assert.match(describeTestResult({ ok: false, error: "Failed to fetch: redirect" }).text, /redirected/);
    assert.equal(describeTestResult(null).ok, false);
  });
});

describe("U1: dispatch health", () => {
  const now = 1_000_000;

  test("summarizeDispatch ignores skipped / noop / superseded results", () => {
    const rec = summarizeDispatch([
      { type: "iotHybrid", name: "Sign", ok: true },
      { type: "listener", ok: false, error: "timeout" },
      { type: "httpHook", skipped: true },
      { type: "iotHybrid", noop: true },
      { type: "httpHook", ok: false, superseded: true }
    ], "ON", now);
    assert.deepEqual(rec, { ts: now, to: "ON", total: 2, failed: [{ name: "Listener", error: "timeout" }] });
  });

  test("health line reads like a status, not a count", () => {
    assert.deepEqual(describeDispatchHealth(null, 0, now), { severity: "muted", text: "No targets set up" });
    assert.deepEqual(describeDispatchHealth(null, 2, now), { severity: "muted", text: "2 targets ready" });
    assert.deepEqual(
      describeDispatchHealth({ ts: now - 12_000, total: 3, failed: [] }, 3, now),
      { severity: "ok", text: "✓ All 3 targets updated 12s ago" }
    );
    assert.deepEqual(
      describeDispatchHealth({ ts: now - 120_000, total: 2, failed: [{ name: "LED sign", error: "timeout" }, { name: "X", error: "HTTP 500" }] }, 2, now),
      { severity: "warn", text: "⚠ LED sign failed — timeout (+1 more) · 2m ago" }
    );
  });

  test("formatAgo", () => {
    assert.equal(formatAgo(1000), "just now");
    assert.equal(formatAgo(45_000), "45s ago");
    assert.equal(formatAgo(3 * 60_000), "3m ago");
    assert.equal(formatAgo(5 * 3600_000), "5h ago");
    assert.equal(formatAgo(3 * 86400_000), "3d ago");
  });
});

describe("U3: paused while in a meeting", () => {
  const now = 1_000_000;
  test("keeps the meeting visible and says the sign is held off", () => {
    assert.equal(describePausedState({ until: PAUSE_FOREVER }, "meet", now), "In Google Meet · sign held off");
    assert.equal(describePausedState({ until: now + 30 * 60_000 }, "zoom", now), "In Zoom · sign held off · 30m left");
    assert.equal(describePausedState({ until: now + 30 * 60_000 }, null, now), "Paused · 30m left");
  });
});

describe("U13: permissions still to be granted", () => {
  test("only ungranted origins are listed", () => {
    assert.deepEqual(
      missingOrigins(["http://a/x", "https://b/y", "http://a/z"], ["http://a/*"]),
      ["https://b/*"]
    );
  });
});

describe("custom services", () => {
  test("normalizePrefixes assumes https:// when the scheme is missing", () => {
    assert.deepEqual(
      normalizePrefixes([" webex.com/meet/ ", "", "http://lan.local/call", "https://a.example/"]),
      ["https://webex.com/meet/", "http://lan.local/call", "https://a.example/"]
    );
  });

  test("describeCustomService summarizes a complete service", () => {
    const d = describeCustomService({ name: "Webex", prefixes: ["https://webex.com/meet/", "https://webex.com/join/", "https://x.webex.com/"] });
    assert.equal(d.title, "Webex");
    assert.equal(d.host, "webex.com +1");
    assert.deepEqual(d.warnings, []);
  });

  test("describeCustomService lists what's missing", () => {
    const d = describeCustomService({ name: " ", prefixes: ["", "https://exa mple.com/"] });
    assert.equal(d.title, "New service");
    assert.equal(d.host, "no URL yet");
    assert.deepEqual(d.warnings, ["Needs a name", "Not a valid URL: https://exa mple.com/"]);
    assert.deepEqual(describeCustomService({ name: "X", prefixes: [] }).warnings, ["Add a meeting URL"]);
  });
});

describe("template placeholders", () => {
  test("findPlaceholders lists unfilled YOUR_* parts once", () => {
    assert.deepEqual(
      findPlaceholders("http://YOUR_HA_HOST:8123/api/webhook/YOUR_ON_WEBHOOK_ID", "https://ntfy.sh/YOUR_TOPIC/x", "http://YOUR_HA_HOST/"),
      ["YOUR_HA_HOST", "YOUR_ON_WEBHOOK_ID", "YOUR_TOPIC"]
    );
    assert.deepEqual(findPlaceholders("X-API-Token: REPLACE_WITH_TOKEN"), ["REPLACE_WITH_TOKEN"]);
  });

  test("findPlaceholders ignores real values", () => {
    assert.deepEqual(findPlaceholders("http://your_house.lan/on", "https://ntfy.sh/my_topic", "", undefined), []);
  });

  test("originPatternFor skips hosts that are still placeholders", () => {
    assert.equal(originPatternFor("http://YOUR_DEVICE_IP/cm?cmnd=Power%20On"), null);
    assert.deepEqual(originPatternsFor(["http://YOUR_DEVICE_IP/x", "http://10.0.0.5/x"]), ["http://10.0.0.5/*"]);
  });
});

describe("retired target types", () => {
  test("supportedTargets drops simpleLed and unknown types", () => {
    assert.deepEqual(
      supportedTargets([{ type: "simpleLed", baseUrl: "http://x" }, { type: "httpHook" }, { type: "iotHybrid" }, null, { type: "bogus" }]).map(t => t.type),
      ["httpHook", "iotHybrid"]
    );
    assert.deepEqual(supportedTargets(undefined), []);
  });
});
