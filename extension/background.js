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
  extractSecrets
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
  // Privacy opt-in (Fix 3): when false, the meeting tab URL is never
  // sent to targets ({url} resolves to "" and is not auto-appended).
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
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.debugLogs) return;
  debugEnabled = !!changes.debugLogs.newValue;
});

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
      const tt = { ...t };
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
    targets,
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
    } catch {
      if (attempt >= RETRY_MAX) return { ok: false, status: 0, text: "", error: true };
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, status: 0, text: "", error: true };
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
  if (!target?.enabled || !target?.url) return;
  const finalUrl = buildListenerUrl(target.url, vars);
  if (!finalUrl) return;
  await callUrl(finalUrl, timeoutSec).catch(() => {});
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
  if (!target?.enabled || !target?.baseUrl) return;
  const base = trimSlash(target.baseUrl);

  if (target.verifyStatus) {
    const st = await getLedStatus(base, timeoutSec);
    if (st !== "REACHABLE") return;
  }

  const path = vars.state === "ON" ? "/led/on" : "/led/off";
  await callUrl(base + path, timeoutSec).catch(() => {});
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
}

// Local-first hybrid: tries the device's local HTTP API first with a
// short per-row timeout and no retries, then falls back to the AWS IoT
// cloud bridge. Either path flips the sign — exactly one fires per
// event under normal conditions.
async function runIotHybridTarget(target, vars, timeoutSec) {
  if (!target?.enabled) return;
  const mode = vars.state === "ON"
    ? clampMode(target.modeOn, 1)
    : clampMode(target.modeOff, 0);

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
      if (r.ok) return; // local won
    } catch (_) {
      // ignore — fall through to cloud
    } finally {
      clearTimeout(to);
    }
  }

  // 2. Cloud fallback. Re-uses the standard timeout + retry behaviour
  //    of callUrl because we're already off the happy path.
  if (!target.cloudBase || !target.thing) return;
  const headers = new Headers();
  if (target.cloudToken) headers.set("Authorization", `Bearer ${target.cloudToken}`);
  const cloudUrl = `${trimSlash(target.cloudBase)}/?thing=${encodeURIComponent(target.thing)}&mode=${mode}`;
  await callUrl(cloudUrl, timeoutSec, { method: "POST", headers }).catch(() => {});
}

async function applySideEffects(next, cfg) {
  await setToolbarIcon(next.state, cfg);

  const vars = {
    state: next.state,
    service: next.service || "",
    url: meetingUrlForVars(cfg, next.url), // Fix 3: gated by includeMeetingUrl
    ts: Date.now()
  };

  const timeoutSec = clampTimeoutSec(cfg.timeoutSec, 3);

  // Fire all enabled targets (don’t block others if one fails)
  const jobs = [];
  for (const t of cfg.targets || []) {
    if (!t?.enabled) continue;
    if (t.type === "listener") jobs.push(runListenerTarget(t, vars, timeoutSec));
    else if (t.type === "simpleLed") jobs.push(runSimpleLedTarget(t, vars, timeoutSec));
    else if (t.type === "httpHook") jobs.push(runHttpHookTarget(t, vars, timeoutSec));
    else if (t.type === "iotHybrid") jobs.push(runIotHybridTarget(t, vars, timeoutSec));
  }
  await Promise.allSettled(jobs);
}

async function tick(reason = "") {
  debugLog("tick:start", reason);
  const cfg = await getConfig();
  const next = await computeState(cfg);

  if (sameState(next, current)) {
    // Ensure icon is correct after SW wake
    await setToolbarIcon(next.state, cfg);
    current = { ...next, ts: Date.now() };
    debugLog("tick:same", current.state, current.service);
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debugLog("tick:debounce", next.state, next.service);
  debounceTimer = setTimeout(async () => {
    const cfg2 = await getConfig();
    const next2 = await computeState(cfg2);
    current = { ...next2, ts: Date.now() };
    debugLog("tick:apply", current.state, current.service);
    await applySideEffects(current, cfg2);
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
      sendResponse({ state: current.state, service: current.service });
      return;
    }
    if (msg?.type === "CONFIG_UPDATED") {
      await tick("config");
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true;
});
