// ON-AIR Meeting Trigger — universal targets (MV3 module)
//
// Adds "targets" so you can drive any IoT device via HTTP hooks (e.g., Tasmota),
// while keeping legacy listenerUrl + direct LED support.

import {
  RETRY_MAX,
  trimSlash,
  applyTemplate,
  backoffMs,
  normalizeHeaders,
  normalizeCustomServices,
  matchService,
  clampMode,
  clampLocalTimeoutMs,
  clampTimeoutSec,
  buildListenerUrl,
  meetingUrlForVars,
  httpHookSuccess,
  applySecrets,
  extractSecrets,
  isPaused,
  resolveReconcile,
  migrateReconcile,
  parseDeviceMode,
  reconcileDrift
} from "./shared.js";

const LEGACY_DEFAULTS = {
  services: { meet: true, teams: true, zoom: true },
  triggerMode: "ANY_TAB", // or ACTIVE_TAB
  listenerUrl: "",
  direct: { enabled: false, ledBase: "", timeoutSec: 3, verifyStatus: false }
};

// New defaults
const DEFAULTS = {
  services: { meet: true, teams: true, zoom: true },
  triggerMode: "ANY_TAB",
  timeoutSec: 3,
  iconMode: "alwaysColor",
  // Privacy opt-in (Fix 3): when false, {url} is the site origin only
  // (no meeting ID); when true, it's the full meeting URL. See
  // meetingUrlForVars.
  includeMeetingUrl: false,
  targets: [
    // Examples:
    // { id:"listener1", type:"listener", enabled:false, url:"http://127.0.0.1:8765/event?state={state}&service={service}&url={url}&ts={ts}" },
    // { id:"tasmota1", type:"httpHook", enabled:false, onUrl:"http://192.168.1.17/cm?cmnd=Power%20On", offUrl:"http://192.168.1.17/cm?cmnd=Power%20Off", method:"GET", headers:[], body:"" },
    // { id:"led1", type:"simpleLed", enabled:false, baseUrl:"http://192.168.1.50", verifyStatus:false }
  ],
  customServices: []
};

const ICONS_COLOR = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png"
};
const ICONS_GRAY = {
  16: "icons/icon16_gray.png",
  32: "icons/icon32_gray.png",
  48: "icons/icon48_gray.png",
  128: "icons/icon128_gray.png"
};

// MV3 reconcile heartbeat (Fix 5): the 400ms debounce below uses
// setTimeout, which is fine for sub-second coalescing while the worker
// is awake, but events can be missed while Chrome has the service
// worker suspended. This periodic alarm wakes the worker and re-derives
// state from scratch so the sign can't get stuck out of sync.
const RECONCILE_ALARM = "onair-reconcile";
const RECONCILE_PERIOD_MIN = 1;

const DEBOUNCE_MS = 400;

let current = { state: "OFF", service: null, url: null, ts: Date.now() };
let debounceTimer = null;
let debugEnabled = false;

function debugLog(...args) {
  if (!debugEnabled) return;
  console.debug("[ON-AIR]", ...args);
}

chrome.storage.local.get({ debugLogs: false }).then(({ debugLogs }) => {
  debugEnabled = !!debugLogs;
  // Record every cold start so the log shows how often Chrome recycles the
  // worker — the single most useful signal when debugging MV3 flakiness.
  if (debugEnabled) logActivity({ kind: "worker", event: "started" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.debugLogs) return;
  debugEnabled = !!changes.debugLogs.newValue;
});

const OFF_STATE = { state: "OFF", service: null, url: null };

// ---- persisted runtime state (survives worker suspension) --------------
// MV3 kills the service worker after ~30s idle; the `current` module
// global then resets to OFF on the next cold start. The 1-minute reconcile
// alarm would wake the worker, see a phantom OFF->ON edge (the meeting tab
// is still open) and re-fire every target — that's what spammed duplicate
// "in a meeting" pushes. Persisting the last-applied state to
// storage.session (in-memory, wiped on browser restart, never synced) lets
// tick() compare `next` against what we actually last dispatched.
const STATE_KEY = "runtimeState";

function stateStore() {
  return chrome.storage.session || chrome.storage.local;
}

async function loadCurrent() {
  try {
    const got = await stateStore().get({ [STATE_KEY]: null });
    if (got && got[STATE_KEY]) return got[STATE_KEY];
  } catch {
    // fall through — first run or session storage unavailable
  }
  return null;
}

async function saveCurrent(state) {
  try {
    await stateStore().set({ [STATE_KEY]: { state: state.state, service: state.service, url: state.url } });
  } catch {
    // best effort
  }
}

// ---- diagnostics activity log (ring buffer) ----------------------------
// Persistent, structured event trail the options page can render. MV3
// console logs are near-useless here because the worker keeps dying;
// this survives. Opt-in via the existing debugLogs toggle to avoid
// storage churn when nobody's looking.
const LOG_KEY = "activityLog";
const LOG_MAX = 200;

async function logActivity(entry) {
  if (!debugEnabled) return;
  try {
    const { [LOG_KEY]: log = [] } = await chrome.storage.local.get({ [LOG_KEY]: [] });
    log.push({ ts: Date.now(), ...entry });
    const trimmed = log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log;
    await chrome.storage.local.set({ [LOG_KEY]: trimmed });
  } catch {
    // best effort
  }
}

function newId(prefix = "t") {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

// Legacy -> targets migration (best-effort)
function migrateConfig(config) {
  // If already on new schema, just normalize a bit
  if (config?.targets && Array.isArray(config.targets)) {
    const cfg = { ...DEFAULTS, ...config };
    cfg.services = { ...DEFAULTS.services, ...(config?.services || {}) };
    cfg.timeoutSec = clampTimeoutSec(cfg.timeoutSec, 3);
    cfg.iconMode = config.iconMode || DEFAULTS.iconMode;
    cfg.includeMeetingUrl = !!config.includeMeetingUrl;
    cfg.customServices = normalizeCustomServices(config?.customServices, newId);

    cfg.targets = cfg.targets.map(t => {
      let tt = { ...t };
      tt.enabled = !!tt.enabled;
      if (!tt.id) tt.id = newId(tt.type || "t");
      if (tt.type === "simpleLed") {
        tt.baseUrl = trimSlash(tt.baseUrl || "");
        tt.verifyStatus = !!tt.verifyStatus;
      }
      if (tt.type === "listener") {
        tt.url = (tt.url || "").trim();
      }
      if (tt.type === "httpHook") {
        tt.onUrl = (tt.onUrl || "").trim();
        tt.offUrl = (tt.offUrl || "").trim();
        tt.method = (tt.method || "GET").toUpperCase();
        tt.headers = normalizeHeaders(tt.headers);
        tt.body = String(tt.body ?? "");
        tt.basicAuth = tt.basicAuth
          ? { user: String(tt.basicAuth.user ?? ""), pass: String(tt.basicAuth.pass ?? "") }
          : null;
      }
      if (tt.type === "iotHybrid") {
        tt.localBase = trimSlash(tt.localBase || "");
        tt.localToken = String(tt.localToken || "");
        tt.cloudBase = trimSlash(tt.cloudBase || "");
        tt.cloudToken = String(tt.cloudToken || "");
        tt.thing = String(tt.thing || "");
        // Fix 6: clamp modes to {0,1,2} so a tampered import can't push
        // an arbitrary mode= into the cloud URL.
        tt.modeOn = clampMode(tt.modeOn, 1);
        tt.modeOff = clampMode(tt.modeOff, 0);
        tt.localTimeoutMs = clampLocalTimeoutMs(tt.localTimeoutMs, 1500);
      }
      // Fold legacy verifyStatus into the reconcile policy and clamp the
      // mode to what this target type can support.
      tt = migrateReconcile(tt);
      return tt;
    });

    return cfg;
  }

  // Otherwise: treat it as legacy and convert
  const legacy = { ...LEGACY_DEFAULTS, ...(config || {}) };
  legacy.services = { ...LEGACY_DEFAULTS.services, ...(config?.services || {}) };
  legacy.direct = { ...LEGACY_DEFAULTS.direct, ...(config?.direct || {}) };

  const targets = [];

  if (legacy.listenerUrl && legacy.listenerUrl.trim()) {
    targets.push({
      id: newId("listener"),
      type: "listener",
      enabled: true,
      url: legacy.listenerUrl.trim()
    });
  }

  if (legacy.direct?.enabled && legacy.direct?.ledBase) {
    targets.push({
      id: newId("led"),
      type: "simpleLed",
      enabled: true,
      baseUrl: trimSlash(legacy.direct.ledBase),
      verifyStatus: !!legacy.direct.verifyStatus
    });
  }

  return {
    services: legacy.services,
    triggerMode: legacy.triggerMode || "ANY_TAB",
    timeoutSec: clampTimeoutSec(legacy.direct?.timeoutSec, 3),
    targets: targets.map(migrateReconcile),
    customServices: [],
    iconMode: DEFAULTS.iconMode,
    includeMeetingUrl: false
  };
}

async function getConfig() {
  const [{ config }, { secrets }] = await Promise.all([
    chrome.storage.sync.get({ config: DEFAULTS }),
    chrome.storage.local.get({ secrets: {} })
  ]);
  let cfg = migrateConfig(config);
  // Fix 1: credentials live in storage.local (not synced to the Google
  // account). Merge them back onto the synced, sanitized config.
  cfg = applySecrets(cfg, secrets);

  // Persist migrated config once so the options UI sees it — and move
  // any credentials that were sitting in the synced blob (pre-update
  // installs) out into storage.local.
  if (!config?.targets && cfg.targets) {
    const { config: sanitized, secrets: migratedSecrets } = extractSecrets(cfg);
    await chrome.storage.sync.set({ config: sanitized });
    if (Object.keys(migratedSecrets).length) {
      await chrome.storage.local.set({ secrets: { ...secrets, ...migratedSecrets } });
    }
  }
  return cfg;
}

async function computeState(cfg) {
  if (cfg.triggerMode === "ACTIVE_TAB") {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const t = tabs[0] || null;
    const svc = matchService(t?.url || "", cfg);
    return svc ? { state: "ON", service: svc, url: t.url } : { state: "OFF", service: null, url: null };
  }

  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const svc = matchService(t.url || "", cfg);
    if (svc) return { state: "ON", service: svc, url: t.url || null };
  }
  return { state: "OFF", service: null, url: null };
}

function sameState(a, b) {
  return a.state === b.state && a.service === b.service;
}

async function getPause() {
  const { pause } = await chrome.storage.local.get({ pause: { until: 0 } });
  return pause || { until: 0 };
}

// Tell any open popup the state/pause changed. Rejects (no receiver)
// when no popup is open — that's expected, so swallow it.
function broadcastState(pause) {
  chrome.runtime
    .sendMessage({ type: "STATE_CHANGED", state: current.state, service: current.service, pause })
    .catch(() => {});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Single fetch with retry-on-network-error (not on bad status — status
// handling is the caller's job via httpHookSuccess). Optionally reads
// the response body so the caller can do body matching.
async function callUrl(url, timeoutSec, fetchOpts = {}) {
  const readBody = !!fetchOpts.readBody;
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), Math.max(1, timeoutSec) * 1000);
    try {
      const r = await fetch(url, {
        method: fetchOpts.method || "GET",
        headers: fetchOpts.headers || undefined,
        body: fetchOpts.body || undefined,
        cache: "no-store",
        signal: ac.signal
      });
      const text = readBody ? await r.text().catch(() => "") : "";
      return { ok: r.ok, status: r.status, text, error: false };
    } catch (e) {
      if (attempt >= RETRY_MAX) {
        const errorMsg = e?.name === "AbortError" ? "timeout" : (e?.message || "network error");
        return { ok: false, status: 0, text: "", error: true, errorMsg };
      }
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, status: 0, text: "", error: true, errorMsg: "network error" };
}

async function setToolbarIcon(state, cfg) {
  try {
    const mode = cfg?.iconMode || DEFAULTS.iconMode;
    const useColor = mode === "alwaysColor" ? true : state !== "OFF";
    await chrome.action.setIcon({ path: useColor ? ICONS_COLOR : ICONS_GRAY });
  } catch {
    // ignore
  }
}

// ---- Target executors ----

async function runListenerTarget(target, vars, timeoutSec) {
  if (!target?.enabled || !target?.url) return { skipped: true };
  const finalUrl = buildListenerUrl(target.url, vars);
  if (!finalUrl) return { skipped: true };
  const res = await callUrl(finalUrl, timeoutSec).catch(() => ({ ok: false, status: 0, error: true, errorMsg: "network error" }));
  return { ok: res.ok, status: res.status, error: res.ok ? undefined : res.errorMsg };
}

async function getLedStatus(baseUrl, timeoutSec) {
  try {
    const r = await callUrl(baseUrl + "/led/status", timeoutSec);
    return r.ok ? "REACHABLE" : "UNREACHABLE";
  } catch {
    return "UNREACHABLE";
  }
}

async function runSimpleLedTarget(target, vars, timeoutSec) {
  if (!target?.enabled || !target?.baseUrl) return { skipped: true };
  const base = trimSlash(target.baseUrl);
  // Reachability gating now lives in the `verify` reconcile path
  // (reconcileTarget); the edge always attempts the set.
  const path = vars.state === "ON" ? "/led/on" : "/led/off";
  const res = await callUrl(base + path, timeoutSec).catch(() => ({ ok: false, status: 0, error: true, errorMsg: "network error" }));
  return { ok: res.ok, status: res.status, error: res.ok ? undefined : res.errorMsg };
}

async function ledReachable(target, timeoutSec) {
  const st = await getLedStatus(trimSlash(target.baseUrl), timeoutSec);
  return st === "REACHABLE";
}

function buildAuthHeader(basicAuth) {
  if (!basicAuth || (!basicAuth.user && !basicAuth.pass)) return null;
  const token = btoa(`${basicAuth.user || ""}:${basicAuth.pass || ""}`);
  return `Basic ${token}`;
}

async function runHttpHookTarget(target, vars, timeoutSec) {
  if (!target?.enabled) return;

  const urlTemplate = vars.state === "ON" ? target.onUrl : target.offUrl;
  if (!urlTemplate) return;

  const url = applyTemplate(urlTemplate, vars);
  const method = (target.method || "GET").toUpperCase();

  const headers = new Headers();
  for (const h of normalizeHeaders(target.headers)) headers.set(h.key, h.value);

  const auth = buildAuthHeader(target.basicAuth);
  if (auth) headers.set("Authorization", auth);

  let body = null;
  const bodyTpl = target.body || "";
  if (method !== "GET" && method !== "HEAD") {
    const rendered = applyTemplate(bodyTpl, vars);
    if (rendered.length) body = rendered;
  }

  // Fix 4: evaluate the response with the SAME rules the options Test
  // button uses (status codes + body match), so a hook that "tests OK"
  // behaves identically live. We only read the body when a match string
  // is configured, to avoid pulling response bodies we won't inspect.
  const needsBody = !!(vars.state === "ON" ? target.matchOn : target.matchOff);
  const res = await callUrl(url, timeoutSec, { method, headers, body, readBody: needsBody })
    .catch(() => ({ ok: false, status: 0, text: "", error: true }));
  const ok = httpHookSuccess(target, vars.state, res);
  if (!ok) debugLog("httpHook:fail", target.id, vars.state, res.status || res.error);
  return { ok, status: res.status, error: ok ? undefined : (res.errorMsg || (res.status ? `HTTP ${res.status}` : "check failed")) };
}

// Local-first hybrid: tries the device's local HTTP API first with a
// short per-row timeout and no retries, then falls back to the AWS IoT
// cloud bridge. Either path flips the sign — exactly one fires per
// event under normal conditions.
async function runIotHybridTarget(target, vars, timeoutSec) {
  if (!target?.enabled) return { skipped: true };
  const mode = desiredMode(target, vars.state);

  // 1. Local probe (single fetch, no retries — the meeting state just
  //    changed and we want either an instant success or a quick fall
  //    through to cloud).
  if (target.localBase) {
    const localTimeoutMs = clampLocalTimeoutMs(target.localTimeoutMs, 1500);
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), localTimeoutMs);
    try {
      const headers = new Headers();
      if (target.localToken) headers.set("X-API-Token", target.localToken);
      const r = await fetch(
        `${trimSlash(target.localBase)}/api/set?state=${mode}`,
        { method: "GET", headers, cache: "no-store", signal: ac.signal }
      );
      if (r.ok) return { ok: true, via: "local", status: r.status }; // local won
    } catch (_) {
      // ignore — fall through to cloud
    } finally {
      clearTimeout(to);
    }
  }

  // 2. Cloud fallback. Re-uses the standard timeout + retry behaviour
  //    of callUrl because we're already off the happy path.
  if (!target.cloudBase || !target.thing) return { ok: false, via: "none", status: 0 };
  const headers = new Headers();
  if (target.cloudToken) headers.set("Authorization", `Bearer ${target.cloudToken}`);
  const cloudUrl = `${trimSlash(target.cloudBase)}/?thing=${encodeURIComponent(target.thing)}&mode=${mode}`;
  const res = await callUrl(cloudUrl, timeoutSec, { method: "POST", headers })
    .catch(() => ({ ok: false, status: 0, error: true, errorMsg: "network error" }));
  return { ok: res.ok, via: "cloud", status: res.status, error: res.ok ? undefined : res.errorMsg };
}

// Read the device's actual mode from the firmware's /api/status on the
// local network. Returns 0|1|2 or null when we can't tell (no localBase,
// unreachable, or an unparseable body). The cloud leg has no readback
// yet (the Lambda is publish-only), so `verify` can only remediate over
// the local path — see reconcileTarget.
async function readIotHybridMode(target) {
  if (!target?.localBase) return null;
  const localTimeoutMs = clampLocalTimeoutMs(target.localTimeoutMs, 1500);
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), localTimeoutMs);
  try {
    const headers = new Headers();
    if (target.localToken) headers.set("X-API-Token", target.localToken);
    const r = await fetch(
      `${trimSlash(target.localBase)}/api/status`,
      { method: "GET", headers, cache: "no-store", signal: ac.signal }
    );
    if (!r.ok) return null;
    const json = await r.json().catch(() => null);
    return parseDeviceMode(json);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function desiredMode(target, state) {
  if (target?.type === "iotHybrid") {
    return state === "ON" ? clampMode(target.modeOn, 1) : clampMode(target.modeOff, 0);
  }
  return state === "ON" ? 1 : 0;
}

function makeVars(st, cfg) {
  return {
    state: st.state,
    service: st.service || "",
    url: meetingUrlForVars(cfg, st.url), // Fix 3: gated by includeMeetingUrl
    ts: Date.now()
  };
}

// Route a target to its executor and tag the result with id/type so the
// activity log and reconcile pass can attribute outcomes.
async function dispatchTarget(t, vars, timeoutSec) {
  const t0 = Date.now();
  let res = { skipped: true };
  if (t.type === "listener") res = await runListenerTarget(t, vars, timeoutSec);
  else if (t.type === "simpleLed") res = await runSimpleLedTarget(t, vars, timeoutSec);
  else if (t.type === "httpHook") res = await runHttpHookTarget(t, vars, timeoutSec);
  else if (t.type === "iotHybrid") res = await runIotHybridTarget(t, vars, timeoutSec);
  return { id: t.id, type: t.type, ...res, ms: Date.now() - t0 };
}

// Edge dispatch: a genuine ON<->OFF transition fires EVERY enabled target
// once, regardless of reconcile mode (that's the "single" fire, and also
// the initial fire for verify/always).
async function applySideEffects(next, cfg, reason = "") {
  await setToolbarIcon(next.state, cfg);
  const vars = makeVars(next, cfg);
  const timeoutSec = clampTimeoutSec(cfg.timeoutSec, 3);

  const jobs = [];
  for (const t of cfg.targets || []) {
    if (!t?.enabled) continue;
    jobs.push(dispatchTarget(t, vars, timeoutSec).then(r => ({ ...r, action: "edge" })));
  }
  const results = (await Promise.allSettled(jobs)).map(r => r.value).filter(Boolean);
  await logActivity({ kind: "edge", reason, to: next.state, service: next.service || "", targets: results });
}

// One target's reconcile step on the heartbeat. `single` never re-fires;
// `always` blindly re-asserts; `verify` reads actual state and re-fires
// only on drift (iotHybrid via /api/status) or when reachable (simpleLed,
// whose /led/status is reachability-only). Returns a log-friendly record;
// `noop:true` means nothing was sent.
async function reconcileTarget(t, vars, timeoutSec) {
  const mode = resolveReconcile(t);
  if (mode === "single") return { id: t.id, type: t.type, action: "skip", noop: true };

  if (mode === "always") {
    const r = await dispatchTarget(t, vars, timeoutSec);
    return { ...r, action: "reassert" };
  }

  // mode === "verify"
  if (t.type === "iotHybrid") {
    const actual = await readIotHybridMode(t);
    const drift = reconcileDrift(desiredMode(t, vars.state), actual);
    if (drift === true) {
      const r = await dispatchTarget(t, vars, timeoutSec);
      return { ...r, action: "remediate", drift: true, actual };
    }
    return { id: t.id, type: t.type, action: "verify", noop: true, drift, actual };
  }
  if (t.type === "simpleLed") {
    if (await ledReachable(t, timeoutSec)) {
      const r = await dispatchTarget(t, vars, timeoutSec);
      return { ...r, action: "reassert" };
    }
    return { id: t.id, type: t.type, action: "verify", noop: true, reachable: false };
  }
  return { id: t.id, type: t.type, action: "verify", noop: true };
}

// Heartbeat reconciliation: runs only on the periodic alarm (never on
// every tab event) while the meeting state is unchanged. Keeps devices at
// the desired state without re-firing notification targets.
async function reconcilePass(cfg, cur) {
  const vars = makeVars(cur, cfg);
  const timeoutSec = clampTimeoutSec(cfg.timeoutSec, 3);
  const jobs = [];
  for (const t of cfg.targets || []) {
    if (!t?.enabled) continue;
    if (resolveReconcile(t) === "single") continue;
    jobs.push(reconcileTarget(t, vars, timeoutSec));
  }
  if (!jobs.length) return;
  const results = (await Promise.allSettled(jobs)).map(r => r.value).filter(Boolean);
  // Only log when something actually fired, so the log stays a signal of
  // remediations rather than a per-minute heartbeat of no-ops.
  if (results.some(r => r && !r.noop)) {
    await logActivity({ kind: "reconcile", reason: "alarm", to: cur.state, service: cur.service || "", targets: results });
  }
}

async function tick(reason = "") {
  debugLog("tick:start", reason);
  const cfg = await getConfig();
  const pause = await getPause();
  // Hydrate the last-applied state so a freshly-woken worker compares
  // against reality instead of the cold-start OFF default (the fix for
  // duplicate "in a meeting" pushes).
  const hydrated = await loadCurrent();
  if (hydrated) current = { ...hydrated, ts: Date.now() };
  // While paused, force OFF regardless of meeting tabs.
  const next = isPaused(pause) ? { ...OFF_STATE } : await computeState(cfg);

  if (sameState(next, current)) {
    // Ensure icon is correct after SW wake
    await setToolbarIcon(next.state, cfg);
    current = { ...next, ts: Date.now() };
    await saveCurrent(current);
    debugLog("tick:same", current.state, current.service);
    // Reconcile only on the heartbeat alarm (never per tab event) so we
    // don't hammer device status endpoints, and never while paused.
    if (reason === "alarm" && !isPaused(pause)) await reconcilePass(cfg, current);
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debugLog("tick:debounce", next.state, next.service);
  debounceTimer = setTimeout(async () => {
    const cfg2 = await getConfig();
    const pause2 = await getPause();
    const prev = await loadCurrent();
    const next2 = isPaused(pause2) ? { ...OFF_STATE } : await computeState(cfg2);
    current = { ...next2, ts: Date.now() };
    await saveCurrent(current);
    // Re-check the edge after the debounce against persisted state: if it
    // settled back to what we already dispatched, don't re-fire.
    if (prev && sameState(next2, prev)) {
      await setToolbarIcon(current.state, cfg2);
      debugLog("tick:debounce-noedge", current.state);
      return;
    }
    debugLog("tick:apply", current.state, current.service);
    await applySideEffects(current, cfg2, reason);
    broadcastState(pause2);
  }, DEBOUNCE_MS);
}

// Tab/window events
chrome.tabs.onCreated.addListener(() => tick("created"));
chrome.tabs.onUpdated.addListener(() => tick("updated"));
chrome.tabs.onRemoved.addListener(() => tick("removed"));
chrome.tabs.onActivated.addListener(() => tick("activated"));
chrome.windows.onFocusChanged.addListener(() => tick("focus"));
chrome.windows.onRemoved.addListener(() => tick("window-removed"));

chrome.runtime.onStartup.addListener(() => {
  ensureReconcileAlarm();
  tick("startup");
});
chrome.runtime.onInstalled.addListener(() => {
  ensureReconcileAlarm();
  tick("installed");
});

// Fix 5: heartbeat so a suspended worker can't leave the sign stale.
function ensureReconcileAlarm() {
  try {
    chrome.alarms.create(RECONCILE_ALARM, { periodInMinutes: RECONCILE_PERIOD_MIN });
  } catch {
    // alarms unavailable — the event listeners still cover the common case
  }
}

chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm?.name === RECONCILE_ALARM) tick("alarm");
});

// Create the alarm at worker startup too (covers reloads where neither
// onStartup nor onInstalled fires).
ensureReconcileAlarm();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_STATE") {
      const hydrated = await loadCurrent();
      if (hydrated) current = { ...hydrated, ts: Date.now() };
      const pause = await getPause();
      sendResponse({ state: current.state, service: current.service, pause });
      return;
    }
    if (msg?.type === "CONFIG_UPDATED") {
      await tick("config");
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "SET_PAUSE") {
      // until: PAUSE_INDEFINITE (-1) for "until I resume", or an epoch-ms.
      const until = Number(msg.until) || 0;
      await chrome.storage.local.set({ pause: { until } });
      await tick("pause");
      broadcastState({ until });
      sendResponse({ ok: true, pause: { until } });
      return;
    }
    if (msg?.type === "RESUME") {
      await chrome.storage.local.set({ pause: { until: 0 } });
      await tick("resume");
      broadcastState({ until: 0 });
      sendResponse({ ok: true, pause: { until: 0 } });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true;
});
