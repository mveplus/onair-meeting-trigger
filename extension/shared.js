// shared.js — pure, side-effect-free helpers shared by the MV3 service
// worker (background.js) and the options page (options.js), and exercised
// directly by the Node test suite under tests/.
//
// HARD RULE: nothing in this file may touch chrome.*, window, document,
// fetch, or any other browser/runtime global at import time. Keep it
// pure so it can be imported and unit-tested in plain Node.

export const RETRY_MAX = 2;
export const RETRY_BASE_MS = 250;
export const RETRY_MAX_MS = 2000;

export const DEFAULT_STATUS_CODES = [200, 202, 204];

// Built-in meeting services and their URL prefixes.
export const URL_PREFIXES = {
  meet: ["https://meet.google.com/"],
  teams: ["https://teams.microsoft.com/"],
  zoom: ["https://zoom.us/", "https://app.zoom.us/"]
};

// LED "mode" values understood by the firmware / cloud bridge.
export const VALID_MODES = [0, 1, 2]; // 0 = off, 1 = solid on, 2 = breathing

// ---- reconcile policy --------------------------------------------------
//
// How the 1-minute reconcile heartbeat treats each target, once a
// meeting state has already been dispatched on its ON<->OFF edge:
//   single — fire ONCE on the edge, never re-fire. The only safe mode
//            for notification targets (Ntfy/listener) so a suspended-then
//            -woken service worker can't spam duplicate "in a meeting"
//            pushes (the original bug).
//   verify — on each heartbeat, read the device's ACTUAL state and re-fire
//            only if it drifted from the desired state. Needs a readback
//            endpoint, so it's only offered where one exists.
//   always — blindly re-assert the set on every heartbeat. Harmless for
//            idempotent device setters (a duplicate mode= just re-sets the
//            same value); never offered for notifications (would spam).
export const RECONCILE_MODES = ["single", "verify", "always"];

export const DEFAULT_RECONCILE = {
  listener: "single",
  httpHook: "single",
  simpleLed: "verify",
  iotHybrid: "verify"
};

// Which reconcile modes a given target TYPE can actually support. The
// options UI shows only these; anything else collapses to the type's
// default. `verify` is offered only where a state/reachability readback
// exists (simpleLed's /led/status, iotHybrid's /api/status).
export function reconcileModesFor(type) {
  if (type === "listener") return ["single"];              // notification only
  if (type === "httpHook") return ["single", "always"];    // no readback
  if (type === "simpleLed" || type === "iotHybrid") return ["single", "verify", "always"];
  return ["single"];
}

// Resolve a target's effective reconcile mode, clamped to what its type
// supports (a hand-edited import can't smuggle `verify` onto Ntfy).
export function resolveReconcile(target) {
  const type = target?.type;
  const want = target?.reconcile;
  if (want && reconcileModesFor(type).includes(want)) return want;
  return DEFAULT_RECONCILE[type] || "single";
}

// Fold the legacy simpleLed `verifyStatus` boolean into the reconcile
// field: a target that had "verify status" turned on wanted its state
// re-asserted, which is now `verify`; off means fire once (`single`).
// Idempotent — leaves an already-migrated target untouched.
export function migrateReconcile(target) {
  const t = { ...target };
  if (!t.reconcile) {
    if (t.type === "simpleLed") t.reconcile = t.verifyStatus ? "verify" : "single";
    else t.reconcile = DEFAULT_RECONCILE[t.type] || "single";
  }
  t.reconcile = resolveReconcile(t);
  return t;
}

// ---- diagnostics: humanize the activity log ---------------------------
//
// Pure formatters shared by the diagnostics page / DevTools panel so the
// raw ring-buffer entries render as plain English with a severity, and so
// the mapping is unit-tested rather than reinvented in the UI.

export const MODE_LABELS = { 0: "off", 1: "on", 2: "breathing" };

export function modeLabel(n) {
  return Object.prototype.hasOwnProperty.call(MODE_LABELS, n) ? MODE_LABELS[n] : String(n);
}

const TYPE_LABELS = {
  listener: "Listener",
  httpHook: "HTTP hook",
  simpleLed: "LED sign",
  iotHybrid: "IoT sign"
};

export function friendlyTargetType(type) {
  return TYPE_LABELS[type] || type || "target";
}

const SEVERITY_RANK = { info: 0, muted: 1, ok: 2, warn: 3, error: 4 };

// Severity of a single target outcome within a log entry.
export function targetSeverity(t) {
  if (!t) return "muted";
  if (t.ok === false) return "error";
  if (t.action === "remediate" || t.drift === true) return "warn";
  if (t.noop) return "muted";
  return "ok";
}

// Overall severity of a log entry = worst of its targets (worker
// lifecycle markers are informational).
export function logSeverity(entry) {
  if (entry?.kind === "worker") return "info";
  let worst = "muted";
  for (const t of entry?.targets || []) {
    const s = targetSeverity(t);
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

// One plain-English line describing what happened to a target.
export function describeTargetLine(t) {
  const name = friendlyTargetType(t?.type);
  const severity = targetSeverity(t);
  let text;
  if (t?.ok === false) {
    text = `${name} failed`;
    if (t.status) text += ` (HTTP ${t.status})`;
    if (t.error) text += ` — ${t.error}`;
  } else if (t?.action === "remediate") {
    text = `${name} drifted (was ${modeLabel(t.actual)}) — corrected`;
    if (t.via) text += ` via ${t.via}`;
  } else if (t?.action === "reassert") {
    text = `${name} re-asserted`;
    if (t.via) text += ` via ${t.via}`;
  } else if (t?.noop) {
    text = (t.actual !== undefined && t.actual !== null)
      ? `${name} already correct (${modeLabel(t.actual)})`
      : `${name} — nothing to do`;
  } else {
    text = `${name} fired`;
    if (t?.via) text += ` via ${t.via}`;
    if (t?.status) text += ` (HTTP ${t.status})`;
  }
  if (t && typeof t.ms === "number") text += ` · ${t.ms} ms`;
  return { severity, text };
}

// A whole log entry, humanized: a headline, the trigger, and per-target
// lines. `ts` is left raw for the UI to format in the local timezone.
export function describeLogEntry(entry) {
  if (!entry) return { severity: "muted", ts: 0, headline: "—", reason: "", lines: [] };
  if (entry.kind === "worker") {
    return {
      severity: "info",
      ts: entry.ts,
      headline: `Service worker ${entry.event || "event"}`,
      reason: entry.reason || "",
      lines: []
    };
  }
  const meeting = entry.to === "ON"
    ? `In meeting${entry.service ? ` (${entry.service})` : ""}`
    : "No meeting";
  const kind = entry.kind === "reconcile" ? "Reconcile" : "State change";
  return {
    severity: logSeverity(entry),
    ts: entry.ts,
    headline: `${kind} · ${meeting}`,
    reason: entry.reason || (entry.kind === "reconcile" ? "alarm" : ""),
    lines: (entry.targets || []).map(describeTargetLine)
  };
}

// Parse a firmware `/api/status` JSON body into a normalized mode
// (0=off, 1=on, 2=breathing), or null when the body doesn't tell us.
// Prefers the explicit `output_mode` string; falls back to the legacy
// `state` boolean for older firmware.
export function parseDeviceMode(json) {
  if (!json || typeof json !== "object") return null;
  const om = String(json.output_mode || "").toLowerCase();
  if (om === "off") return 0;
  if (om === "on") return 1;
  if (om === "breathing") return 2;
  if (typeof json.state === "boolean") return json.state ? 1 : 0;
  return null;
}

// Compare the device's actual mode to what we want:
//   true  — drifted, remediation needed
//   false — matches, do nothing
//   null  — unknown (no readback / unreachable); caller decides
export function reconcileDrift(desiredMode, actualMode) {
  if (actualMode === null || actualMode === undefined) return null;
  return clampMode(actualMode, -1) !== clampMode(desiredMode, -1);
}

// Header keys we treat as credentials: kept out of synced storage and
// redacted from exported settings (see extractSecrets / redactSecrets).
export const SECRET_HEADER_KEYS = ["authorization", "x-api-token"];

export function trimSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

export function clampInt(n, lo, hi, fallback) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function clampTimeoutSec(n, fallback = 3) {
  return clampInt(n, 1, 20, fallback);
}

export function clampLocalTimeoutMs(n, fallback = 1500) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(100, Math.min(10000, v));
}

// Fix 6: a mode must be one of {0,1,2}. Anything else — NaN, 7, "drop" —
// collapses to a safe fallback so a hand-edited import can't smuggle an
// arbitrary `mode=` value into the cloud URL.
export function clampMode(n, fallback = 0) {
  const v = Number(n);
  return VALID_MODES.includes(v) ? v : fallback;
}

export function backoffMs(attempt) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** attempt));
}

export function applyTemplate(str, vars = {}) {
  return String(str ?? "")
    .replaceAll("{state}", vars.state ?? "")
    .replaceAll("{service}", vars.service ?? "")
    .replaceAll("{url}", vars.url ?? "")
    .replaceAll("{ts}", String(vars.ts ?? ""));
}

// ---- service matching --------------------------------------------------

export function normalizePrefixes(prefixes) {
  if (!Array.isArray(prefixes)) return [];
  return prefixes.map(p => String(p || "").trim()).filter(Boolean);
}

export function getServiceMatchers(cfg) {
  const builtIns = Object.entries(URL_PREFIXES)
    .map(([key, prefixes]) => ({ key, prefixes, enabled: !!cfg?.services?.[key] }))
    .filter(s => s.enabled);

  const custom = (cfg?.customServices || [])
    .filter(s => s.enabled && s.name && (s.prefixes || []).length > 0)
    .map(s => ({ key: s.name, prefixes: s.prefixes }));

  return [...custom, ...builtIns];
}

export function matchService(url, cfg) {
  if (!url) return null;
  for (const svc of getServiceMatchers(cfg)) {
    if (svc.prefixes.some(p => url.startsWith(p))) return svc.key;
  }
  return null;
}

// ---- normalization -----------------------------------------------------

export function normalizeHeaders(headers) {
  if (!Array.isArray(headers)) return [];
  return headers
    .map(h => (h && typeof h.key === "string") ? { key: h.key.trim(), value: String(h.value ?? "") } : null)
    .filter(h => h && h.key);
}

export function normalizeStatusCodes(codes) {
  if (!Array.isArray(codes)) return [...DEFAULT_STATUS_CODES];
  const out = codes
    .map(c => parseInt(c, 10))
    .filter(n => Number.isFinite(n) && n >= 100 && n <= 599);
  return out.length ? out : [...DEFAULT_STATUS_CODES];
}

export function normalizeCustomServices(customServices, newId = defaultNewId) {
  if (!Array.isArray(customServices)) return [];
  return customServices
    .map(s => {
      const name = String(s?.name || "").trim();
      const prefixes = normalizePrefixes(s?.prefixes || []);
      if (!name || prefixes.length === 0) return null;
      return { id: s?.id || newId("svc"), name, enabled: s?.enabled !== false, prefixes };
    })
    .filter(Boolean);
}

function defaultNewId(prefix = "t") {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

// ---- listener URL building (Fix 3) ------------------------------------

// Build the final listener URL. If the template uses {tokens} we
// substitute them; otherwise we append state/service/ts query params
// for backward compatibility. The meeting URL only ever appears when
// vars.url is a non-empty string — callers pass "" to keep the meeting
// URL out of the request (the includeMeetingUrl privacy opt-in is
// enforced upstream by what gets put into vars.url).
export function buildListenerUrl(rawUrl, vars = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  const hasToken = ["{state}", "{service}", "{url}", "{ts}"].some(tok => url.includes(tok));
  if (hasToken) return applyTemplate(url, vars);
  let u;
  try { u = new URL(url); } catch { return null; }
  u.searchParams.set("state", vars.state ?? "");
  if (vars.service) u.searchParams.set("service", vars.service);
  if (vars.url) u.searchParams.set("url", vars.url);
  u.searchParams.set("ts", String(vars.ts ?? ""));
  return u.toString();
}

// Scheme + host of a URL, with the path/query (where the meeting ID
// lives) stripped. "" for anything unparseable.
export function originOf(url) {
  try {
    const o = new URL(url).origin;
    return o === "null" ? "" : o;
  } catch {
    return "";
  }
}

// Resolve the meeting URL exposed to templates, honoring the
// includeMeetingUrl opt-in (Fix 3):
//   on  → the full URL (path/query included — i.e. the meeting ID)
//   off → the origin only (e.g. https://meet.google.com), so the host is
//         shared but the meeting ID never leaves the browser
export function meetingUrlForVars(cfg, rawUrl) {
  if (!rawUrl) return "";
  return cfg?.includeMeetingUrl ? rawUrl : originOf(rawUrl);
}

// ---- http hook success evaluation (Fix 4) -----------------------------

// Single source of truth for "did this hook succeed?", shared by the
// options Test buttons and the live background dispatch so they can
// never disagree. response = { ok, status, text, error }.
export function httpHookSuccess(target, state, response) {
  if (!response || response.error) return false;
  const checkStatus = target?.checkStatus !== false;
  if (!checkStatus) return true;
  const codes = normalizeStatusCodes(target?.statusCodes);
  const okStatus = codes.includes(response.status);
  const match = state === "ON" ? (target?.matchOn || "") : (target?.matchOff || "");
  const okBody = match ? String(response.text || "").includes(match) : true;
  return okStatus && okBody;
}

// ---- endpoint security warnings (Fix 2) -------------------------------

export function isPrivateHost(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  if (!host) return false;
  host = host.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true;
  if (!host.includes(".")) return true; // bare hostname, assume LAN
  if (host === "127.0.0.1" || host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m) { const o = +m[1]; if (o >= 16 && o <= 31) return true; }
  return false;
}

function isCleartext(url) {
  try { return new URL(url).protocol === "http:"; } catch { return false; }
}

// Warn when a credential would travel in cleartext to a non-LAN host.
// Loopback / RFC1918 / *.local http endpoints are tolerated (the sign
// lives on the LAN); a public http host carrying a token is flagged.
export function endpointSecurityWarnings(target) {
  const warnings = [];
  const flag = (url, hasToken, label) => {
    if (!url || !hasToken) return;
    if (isCleartext(url) && !isPrivateHost(url)) {
      warnings.push(`${label} sends a token over plain HTTP — use HTTPS`);
    }
  };
  if (target?.type === "iotHybrid") {
    flag(target.cloudBase, hasText(target.cloudToken), "Cloud endpoint");
    flag(target.localBase, hasText(target.localToken), "Local endpoint");
  } else if (target?.type === "httpHook") {
    const hasAuthHeader = (target.headers || [])
      .some(h => SECRET_HEADER_KEYS.includes(String(h?.key || "").toLowerCase()) && hasText(h?.value));
    const hasBasic = !!(target.basicAuth && (target.basicAuth.user || target.basicAuth.pass));
    const hasToken = hasAuthHeader || hasBasic;
    flag(target.onUrl, hasToken, "ON URL");
    flag(target.offUrl, hasToken, "OFF URL");
  }
  return warnings;
}

function hasText(s) {
  return typeof s === "string" && s.trim() !== "";
}

// ---- secret splitting (Fix 1) -----------------------------------------

function clone(obj) {
  return typeof structuredClone === "function"
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
}

// Split a config into a sync-safe sanitized copy (credentials blanked)
// and a secrets map keyed by target id. The sanitized copy is what we
// put in chrome.storage.sync (which Chrome mirrors to the user's Google
// account); the secrets map goes to chrome.storage.local only.
export function extractSecrets(cfg) {
  const sanitized = clone(cfg || {});
  const secrets = {};
  for (const t of sanitized.targets || []) {
    const s = {};
    if (t.type === "iotHybrid") {
      if (hasText(t.localToken)) { s.localToken = t.localToken; t.localToken = ""; }
      if (hasText(t.cloudToken)) { s.cloudToken = t.cloudToken; t.cloudToken = ""; }
    } else if (t.type === "httpHook") {
      if (t.basicAuth && hasText(t.basicAuth.pass)) {
        s.basicAuthPass = t.basicAuth.pass;
        t.basicAuth = { ...t.basicAuth, pass: "" };
      }
      const hs = {};
      for (const h of t.headers || []) {
        const k = String(h.key || "").toLowerCase();
        if (SECRET_HEADER_KEYS.includes(k) && hasText(h.value)) { hs[k] = h.value; h.value = ""; }
      }
      if (Object.keys(hs).length) s.headers = hs;
    }
    if (Object.keys(s).length) secrets[t.id] = s;
  }
  return { config: sanitized, secrets };
}

// Recombine a sanitized config with a secrets map. Never overwrites a
// value the sanitized config already carries (so an explicit edit wins
// over a stale stored secret).
export function applySecrets(cfg, secrets = {}) {
  const merged = clone(cfg || {});
  for (const t of merged.targets || []) {
    const s = secrets?.[t.id];
    if (!s) continue;
    if (t.type === "iotHybrid") {
      if (s.localToken && !hasText(t.localToken)) t.localToken = s.localToken;
      if (s.cloudToken && !hasText(t.cloudToken)) t.cloudToken = s.cloudToken;
    } else if (t.type === "httpHook") {
      if (s.basicAuthPass) {
        const cur = t.basicAuth || { user: "", pass: "" };
        if (!hasText(cur.pass)) t.basicAuth = { ...cur, pass: s.basicAuthPass };
      }
      if (s.headers) {
        for (const h of t.headers || []) {
          const k = String(h.key || "").toLowerCase();
          if (s.headers[k] && !hasText(h.value)) h.value = s.headers[k];
        }
      }
    }
  }
  return merged;
}

// The sanitized half on its own — used to strip credentials from an
// exported settings file (Fix 1).
export function redactSecrets(cfg) {
  return extractSecrets(cfg).config;
}

// True if any target carries a credential we'd otherwise keep out of
// synced storage / exports.
export function hasSecrets(targets) {
  return Object.keys(extractSecrets({ targets: targets || [] }).secrets).length > 0;
}

// Decide what an export should contain. `wantSecrets` is the user's
// opt-in (the "Include secrets" checkbox). Secrets are only ever
// included when they both exist AND the user asked for them; otherwise
// the returned targets are credential-free. The UI layer is left to do
// the confirm() prompt and the actual download.
export function resolveExportSecrets(targets, wantSecrets) {
  const present = hasSecrets(targets);
  const includesSecrets = present && !!wantSecrets;
  const outTargets = includesSecrets
    ? (targets || [])
    : (redactSecrets({ targets: targets || [] }).targets || []);
  return { hasSecrets: present, includesSecrets, targets: outTargets };
}

export function exportFileName(includesSecrets) {
  return includesSecrets ? "onair-settings-with-secrets.json" : "onair-settings.json";
}

// ---- "Add target" dropdown choices ------------------------------------

// Synthetic dropdown entries that add a blank target instead of a
// pre-filled template — these fold the old "Add HTTP Hook" / "Add local
// Listener" buttons into the single template <select>.
export const BLANK_CHOICES = {
  __blank_httpHook: { type: "httpHook", label: "Blank HTTP Hook" },
  __blank_listener: { type: "listener", label: "Blank Listener" }
};

// Resolve a dropdown selection into an add action. Kinds:
//   "none"     — placeholder selected, nothing to do
//   "blank"    — add an empty target of `type`
//   "template" — add `type` pre-filled from templates[templateKey]
//   "unknown"  — value matched nothing (stale/garbage selection)
export function resolveAddChoice(value, templates) {
  if (!value) return { kind: "none" };
  const blank = BLANK_CHOICES[value];
  if (blank) return { kind: "blank", type: blank.type };
  const tpl = templates?.[value];
  if (!tpl) return { kind: "unknown" };
  return { kind: "template", templateKey: value, type: tpl.target?.type || "httpHook" };
}

// ---- dev build badge ---------------------------------------------------

// Format the "you're running an unpacked dev build" label from the git
// metadata that scripts/gen-build-info.sh writes into build-info.json.
// Returns null (→ render nothing) for the cases that should look like a
// normal install: no build info, the main branch, a detached HEAD (CI /
// release tag builds), or unknown git state. `version` is the manifest
// version, marked `-dev` to distinguish it from a store build.
export function formatBuildBadge(info, version) {
  if (!info) return null;
  const branch = String(info.branch || "").trim();
  if (!branch || branch === "main" || branch === "HEAD" || branch === "unknown") return null;
  const commit = String(info.commit || "").trim() || "unknown";
  const v = version ? `v${version}-dev` : "dev";
  return `${v} · ${branch} @ ${commit}${info.dirty ? "*" : ""}`;
}

// ---- pause state -------------------------------------------------------

// pause = { until: number }:
//   absent / 0            → not paused
//   PAUSE_INDEFINITE (-1) → paused until manually resumed
//   epoch-ms > now        → paused until that time
export const PAUSE_INDEFINITE = -1;

export function isPaused(pause, now = Date.now()) {
  const until = pause?.until;
  if (!until) return false;
  if (until === PAUSE_INDEFINITE) return true;
  return until > now;
}

export function pauseRemainingMs(pause, now = Date.now()) {
  if (!isPaused(pause, now)) return 0;
  if (pause.until === PAUSE_INDEFINITE) return Infinity;
  return pause.until - now;
}

// Human-readable pause status for the popup, or null when not paused.
export function describePause(pause, now = Date.now()) {
  if (!isPaused(pause, now)) return null;
  const rem = pauseRemainingMs(pause, now);
  if (rem === Infinity) return "Paused";
  const mins = Math.ceil(rem / 60000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `Paused · ${h}h${m ? ` ${m}m` : ""} left`;
  }
  return `Paused · ${mins}m left`;
}

// ---- popup summary helpers --------------------------------------------

export function countEnabledTargets(cfg) {
  return (cfg?.targets || []).filter(t => t && t.enabled).length;
}

// One-line, plain-language description of the meeting state for the popup.
export function describeMeetingState(state, service) {
  if (state !== "ON") return "No meeting detected";
  const names = { meet: "Google Meet", teams: "Microsoft Teams", zoom: "Zoom" };
  const label = service ? (names[service] || service) : "a meeting";
  return `In ${label}`;
}

// ---- settings dirty detection -----------------------------------------

function canonTarget(t) {
  const base = { type: t.type, enabled: t.enabled !== false, reconcile: resolveReconcile(t) };
  if (t.type === "listener") return { ...base, url: t.url || "" };
  if (t.type === "simpleLed") return { ...base, baseUrl: t.baseUrl || "" };
  if (t.type === "iotHybrid") {
    return {
      ...base,
      localBase: t.localBase || "", localToken: t.localToken || "",
      cloudBase: t.cloudBase || "", cloudToken: t.cloudToken || "",
      thing: t.thing || "", modeOn: clampMode(t.modeOn, 1), modeOff: clampMode(t.modeOff, 0),
      localTimeoutMs: clampLocalTimeoutMs(t.localTimeoutMs, 1500)
    };
  }
  return {
    ...base,
    onUrl: t.onUrl || "", offUrl: t.offUrl || "", method: (t.method || "GET").toUpperCase(),
    headers: normalizeHeaders(t.headers), body: t.body || "",
    basicAuth: t.basicAuth ? { user: t.basicAuth.user || "", pass: t.basicAuth.pass || "" } : null,
    checkStatus: t.checkStatus !== false, statusCodes: normalizeStatusCodes(t.statusCodes),
    matchOn: t.matchOn || "", matchOff: t.matchOff || ""
  };
}

// Stable signature of the user-meaningful settings (ignores target ids
// and field ordering noise) so the options page can tell whether the
// form differs from what was last saved — and clear the "unsaved" state
// if an edit is reverted.
export function settingsSignature(cfg) {
  const c = cfg || {};
  const canon = {
    services: { meet: !!c.services?.meet, teams: !!c.services?.teams, zoom: !!c.services?.zoom },
    triggerMode: c.triggerMode === "ACTIVE_TAB" ? "ACTIVE_TAB" : "ANY_TAB",
    timeoutSec: clampTimeoutSec(c.timeoutSec, 3),
    iconMode: c.iconMode || "alwaysColor",
    includeMeetingUrl: !!c.includeMeetingUrl,
    // `theme` is intentionally excluded: it's persisted instantly when the
    // user toggles it, so it must never count as an "unsaved change".
    customServices: (c.customServices || []).map(s => ({
      name: String(s.name || ""), enabled: s.enabled !== false, prefixes: [...(s.prefixes || [])]
    })),
    targets: (c.targets || []).map(canonTarget)
  };
  return JSON.stringify(canon);
}
