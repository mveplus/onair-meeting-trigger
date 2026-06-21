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

// Resolve the meeting URL that should be exposed to templates, honoring
// the includeMeetingUrl opt-in (Fix 3). Defaults to NOT leaking the URL.
export function meetingUrlForVars(cfg, rawUrl) {
  return cfg?.includeMeetingUrl ? (rawUrl || "") : "";
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
