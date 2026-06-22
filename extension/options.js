import {
  RETRY_MAX,
  DEFAULT_STATUS_CODES,
  trimSlash,
  applyTemplate,
  backoffMs,
  normalizePrefixes,
  normalizeCustomServices,
  normalizeStatusCodes,
  clampMode,
  clampLocalTimeoutMs,
  clampTimeoutSec,
  buildListenerUrl,
  httpHookSuccess,
  endpointSecurityWarnings,
  extractSecrets,
  applySecrets,
  resolveExportSecrets,
  exportFileName,
  formatBuildBadge,
  BLANK_CHOICES,
  resolveAddChoice,
  settingsSignature
} from "./shared.js";

const DEFAULTS = {
  services: { meet: true, teams: true, zoom: true },
  triggerMode: "ANY_TAB",
  timeoutSec: 3,
  targets: [],
  customServices: [],
  theme: "light",
  iconMode: "alwaysColor",
  // Privacy opt-in (Fix 3): off → {url} is the site origin only (no
  // meeting ID); on → the full meeting URL.
  includeMeetingUrl: false
};

const KNOWN_STATUS_CODES = [200, 202, 204, 401, 403];
const TEMPLATES = {
  tasmota: {
    label: "Tasmota (GET)",
    target: {
      type: "httpHook",
      onUrl: "http://192.168.1.17/cm?cmnd=Power%20On",
      offUrl: "http://192.168.1.17/cm?cmnd=Power%20Off",
      method: "GET",
      headers: [],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  },
  shelly: {
    label: "Shelly (GET)",
    target: {
      type: "httpHook",
      onUrl: "http://192.168.1.10/relay/0?turn=on",
      offUrl: "http://192.168.1.10/relay/0?turn=off",
      method: "GET",
      headers: [],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  },
  home_assistant: {
    label: "Home Assistant Webhook",
    target: {
      type: "httpHook",
      onUrl: "http://homeassistant.local:8123/api/webhook/ON_AIR_ON",
      offUrl: "http://homeassistant.local:8123/api/webhook/ON_AIR_OFF",
      method: "POST",
      headers: [
        { key: "Authorization", value: "Bearer YOUR_LONG_LIVED_ACCESS_TOKEN" },
        { key: "Content-Type", value: "application/json" }
      ],
      body: "{\"entity_id\":[\"light.wiz_rgbw_tunable_4c105a\"]}",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  },
  json_post: {
    label: "Generic JSON (POST)",
    target: {
      type: "httpHook",
      onUrl: "http://example.local/on",
      offUrl: "http://example.local/off",
      method: "POST",
      headers: [{ key: "Content-Type", value: "application/json" }],
      body: "{\"state\":\"{state}\",\"service\":\"{service}\",\"url\":\"{url}\",\"ts\":\"{ts}\"}",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  }
  ,
  api_access: {
    label: "On-Air API",
    target: {
      type: "httpHook",
      onUrl: "http://device.local/api/set?state=1",
      offUrl: "http://device.local/api/set?state=0",
      method: "GET",
      headers: [{ key: "X-API-Token", value: "REPLACE_WITH_TOKEN" }],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  },
  ntfy: {
    label: "ntfy.sh",
    target: {
      type: "httpHook",
      onUrl: "https://ntfy.sh/YOUR_TOPIC/publish?title=%F0%9F%93%9E%20ON-AIR&message=Do%20not%20disturb%2C%20in%20a%20meeting&priority=urgent",
      offUrl: "https://ntfy.sh/YOUR_TOPIC/publish?title=%E2%9C%85%20OFF-AIR&message=Meeting%20ended&priority=low",
      method: "GET",
      headers: [],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn: "",
      matchOff: ""
    }
  },
  aws_iot_hybrid: {
    // Local-first hybrid: tries the device's local HTTP API first
    // (~30 ms on LAN) and falls back to the AWS IoT cloud bridge on
    // failure or timeout. This is the single-row equivalent of
    // enabling both "On-Air API" and a cloud bridge in
    // parallel, but with proper fall-through semantics so the device
    // receives exactly one command per event.
    //
    // The string fields here are intentionally empty: the inputs in
    // renderTargets carry their own `placeholder="…"` hints in grey,
    // so adding from this template gives the user empty fields plus
    // example text, instead of pre-populated REPLACE_WITH_* literals
    // that would otherwise leak straight into an Export Settings
    // file if the user didn't actually overtype them. The mode and
    // timeout defaults stay populated because those ARE the real
    // defaults, not placeholders.
    label: "OnAir IoT — local first, AWS fallback",
    target: {
      type: "iotHybrid",
      localBase: "",
      localToken: "",
      cloudBase: "",
      cloudToken: "",
      thing: "",
      modeOn: 1,
      modeOff: 0,
      localTimeoutMs: 1500
    }
  }
};

function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll("\"","&quot;")
    .replaceAll("'","&#39;");
}
function newId(prefix="t"){ return `${prefix}_${Math.random().toString(16).slice(2,10)}`; }

function showStatus(msg, ok=true) {
  const s = $("status");
  s.textContent = msg;
  s.style.color = ok ? "#0a0" : "#a00";
  setTimeout(()=>{ s.textContent = ""; }, 2500);
}

function migrateIfNeeded(config) {
  // If already new schema
  if (config?.targets && Array.isArray(config.targets)) {
    const cfg = { ...DEFAULTS, ...config };
    cfg.services = { ...DEFAULTS.services, ...(config?.services || {}) };
    cfg.customServices = normalizeCustomServices(config?.customServices, newId);
    return cfg;
  }

  // Try to migrate legacy fields if present
  const legacy = config || {};
  const targets = [];

  if (legacy.listenerUrl && legacy.listenerUrl.trim()) {
    targets.push({ id: newId("listener"), type:"listener", enabled:true, url: legacy.listenerUrl.trim() });
  }
  if (legacy.direct?.enabled && legacy.direct?.ledBase) {
    targets.push({
      id: newId("led"),
      type:"simpleLed",
      enabled:true,
      baseUrl: trimSlash(legacy.direct.ledBase),
      verifyStatus: !!legacy.direct.verifyStatus
    });
  }

  return {
    services: { ...DEFAULTS.services, ...(legacy.services || {}) },
    triggerMode: legacy.triggerMode || "ANY_TAB",
    timeoutSec: Math.max(1, Math.min(20, parseInt(legacy.direct?.timeoutSec ?? 3, 10))),
    targets,
    customServices: [],
    theme: DEFAULTS.theme,
    iconMode: DEFAULTS.iconMode
  };
}

async function ensureHostPermissionFor(url) {
  try {
    const u = new URL(url);
    const originPattern = `${u.protocol}//${u.host}/*`;
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

function getOriginsFromTargets(cfg) {
  const urls = [];
  for (const t of cfg.targets || []) {
    if (!t.enabled) continue;
    if (t.type === "listener" && t.url) urls.push(t.url);
    if (t.type === "simpleLed" && t.baseUrl) urls.push(t.baseUrl + "/");
    if (t.type === "httpHook") {
      if (t.onUrl) urls.push(t.onUrl);
      if (t.offUrl) urls.push(t.offUrl);
    }
    if (t.type === "iotHybrid") {
      // Both halves of the hybrid speak HTTP from background.js — the
      // user has to grant host permission for both origins or the
      // fetch fails with the "No Access-Control-Allow-Origin"
      // pre-flight error you only see on the FIRST event after a
      // fresh import/add. The trailing "/" makes the URL parseable
      // even when the base hasn't been filled in yet.
      if (t.localBase) urls.push(t.localBase + "/");
      if (t.cloudBase) urls.push(t.cloudBase + "/");
    }
  }
  return urls;
}

function normalizeHeadersList(headers) {
  if (!Array.isArray(headers)) return [];
  return headers
    .map(h => (h && typeof h.key === "string") ? { key: h.key.trim(), value: String(h.value ?? "") } : null)
    .filter(h => h && h.key);
}

function normalizeTarget(raw) {
  const type = raw?.type;
  if (type === "listener") {
    const url = String(raw?.url || "").trim();
    if (!url) return null;
    return { id: newId("listener"), type: "listener", enabled: raw?.enabled !== false, url };
  }
  if (type === "simpleLed") {
    const baseUrl = trimSlash(String(raw?.baseUrl || "").trim());
    if (!baseUrl) return null;
    return {
      id: newId("led"),
      type: "simpleLed",
      enabled: raw?.enabled !== false,
      baseUrl,
      verifyStatus: !!raw?.verifyStatus
    };
  }
  if (type === "iotHybrid") {
    const localBase = trimSlash(String(raw?.localBase || "").trim());
    const cloudBase = trimSlash(String(raw?.cloudBase || "").trim());
    // Either path must carry SOMETHING — a row with no local and no
    // cloud URL is meaningless and we drop it silently rather than
    // import a no-op.
    if (!localBase && !cloudBase) return null;
    return {
      id: newId("iot"),
      type: "iotHybrid",
      enabled: raw?.enabled !== false,
      localBase,
      localToken: String(raw?.localToken || ""),
      cloudBase,
      cloudToken: String(raw?.cloudToken || ""),
      thing: String(raw?.thing || ""),
      modeOn: clampMode(raw?.modeOn, 1),
      modeOff: clampMode(raw?.modeOff, 0),
      localTimeoutMs: clampLocalTimeoutMs(raw?.localTimeoutMs, 1500)
    };
  }
  if (type === "httpHook") {
    const onUrl = String(raw?.onUrl || "").trim();
    const offUrl = String(raw?.offUrl || "").trim();
    if (!onUrl && !offUrl) return null;

    const method = String(raw?.method || "GET").toUpperCase();
    const headers = normalizeHeadersList(raw?.headers);
    const basicAuth = raw?.basicAuth
      ? { user: String(raw.basicAuth.user || ""), pass: String(raw.basicAuth.pass || "") }
      : null;

    return {
      id: newId("hook"),
      type: "httpHook",
      enabled: raw?.enabled !== false,
      onUrl,
      offUrl,
      method,
      headers,
      body: String(raw?.body || ""),
      basicAuth,
      checkStatus: raw?.checkStatus !== false,
      statusCodes: normalizeStatusCodes(raw?.statusCodes),
      matchOn: String(raw?.matchOn || ""),
      matchOff: String(raw?.matchOff || "")
    };
  }
  return null;
}

function renderCustomServices(cfg) {
  const wrap = $("custom_services");
  wrap.innerHTML = "";

  (cfg.customServices || []).forEach((s, idx) => {
    if (!s.id) s.id = newId("svc");
    const div = document.createElement("div");
    div.className = "serviceItem";
    div.dataset.id = s.id;

    const prefixesText = (s.prefixes || []).join("\n");

    div.innerHTML = `
      <div class="targetHead">
        <div>
          <b>${esc(s.name || "Custom Service")}</b>
          <span class="pill">${esc(s.id)}</span>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <label style="margin:0;"><input type="checkbox" class="s_enabled" ${s.enabled ? "checked":""}> Enabled</label>
          <button class="danger s_remove">Remove</button>
        </div>
      </div>
      <label>Service name
        <input type="text" class="s_name" placeholder="Example: Webex" value="${esc(s.name || "")}">
      </label>
      <label>URL prefixes (one per line)
        <textarea class="s_prefixes" placeholder="https://example.com/meeting/">${esc(prefixesText)}</textarea>
      </label>
    `;

    div.querySelector(".s_remove").addEventListener("click", () => {
      cfg.customServices.splice(idx, 1);
      renderCustomServices(cfg);
    });

    wrap.appendChild(div);
  });
  refreshDirty();
}

function readCustomServicesFromUI(cfg) {
  const wrap = $("custom_services");
  const nodes = [...wrap.querySelectorAll(".serviceItem")];
  const out = [];

  for (const n of nodes) {
    const id = n.dataset.id || newId("svc");
    const name = n.querySelector(".s_name")?.value.trim() || "";
    const enabled = !!n.querySelector(".s_enabled")?.checked;
    const prefixesRaw = (n.querySelector(".s_prefixes")?.value || "").split("\n");
    const prefixes = normalizePrefixes(prefixesRaw);
    if (!name || prefixes.length === 0) continue;
    out.push({ id, name, enabled, prefixes });
  }

  cfg.customServices = out;
  return cfg;
}

function shouldOpenAdvanced(hook) {
  if (!hook || hook.type !== "httpHook") return false;
  const headers = Array.isArray(hook.headers) ? hook.headers : [];
  const hasHeaders = headers.length > 0;
  const hasBody = (hook.body || "").trim().length > 0;
  const hasAuth = !!(hook.basicAuth && (hook.basicAuth.user || hook.basicAuth.pass));
  const hasMatch = !!(hook.matchOn || hook.matchOff);
  const codes = normalizeStatusCodes(hook.statusCodes);
  const hasCustomCodes = codes.some(c => !DEFAULT_STATUS_CODES.includes(c));
  const hasCheckOverride = hook.checkStatus === false;
  return hasHeaders || hasBody || hasAuth || hasMatch || hasCustomCodes || hasCheckOverride;
}

function renderTargets(cfg) {
  const wrap = $("targets");
  wrap.innerHTML = "";

  if (!(cfg.targets || []).length) {
    const empty = document.createElement("div");
    empty.className = "emptyTargets";
    empty.textContent = "No targets yet — pick one from “Add a target…” above to drive your sign or service.";
    wrap.appendChild(empty);
    refreshDirty();
    return;
  }

  (cfg.targets || []).forEach((t, idx) => {
    const typeLabel = t.type === "listener" ? "Local listener"
      : t.type === "simpleLed" ? "LED sign"
      // A cloud-only iotHybrid (no local URL) is just the AWS bridge; only
      // call it "local + cloud" once a LAN path is actually configured.
      : t.type === "iotHybrid" ? (t.localBase ? "IoT (local + cloud)" : "Cloud Bridge (AWS IoT Lambda)")
      : "HTTP request";

    const div = document.createElement("div");
    div.className = "target";
    div.dataset.id = t.id;

    div.innerHTML = `
      <div class="targetHead">
        <div class="targetTitle">
          <label style="margin:0; display:flex; gap:8px; align-items:center;">
            <input type="checkbox" class="t_enabled" ${t.enabled ? "checked":""}>
            <b>${esc(typeLabel)}</b>
          </label>
          <span class="pill">${esc(t.id)}</span>
        </div>
        <div class="targetActions">
          ${t.type === "httpHook" ? `
              <select class="t_method actionCtrl" title="Method">
                ${["GET","POST","PUT"].map(m => `<option value="${m}" ${String(t.method||"GET").toUpperCase()===m?"selected":""}>${m}</option>`).join("")}
              </select>
          ` : ``}
          <button class="t_test_on actionCtrl">Test ON</button>
          <button class="t_test_off actionCtrl">Test OFF</button>
          <button class="danger t_remove actionCtrl">Remove</button>
        </div>
      </div>

      <div class="t_body" style="margin-top:10px;"></div>
      <div class="validation" style="margin-top:8px;"></div>
    `;

    const body = div.querySelector(".t_body");

    if (t.type === "listener") {
      body.innerHTML = `
        <label>URL
          <input type="text" class="t_url" placeholder="http://127.0.0.1:8765/event?state={state}&service={service}&url={url}&ts={ts}" value="${esc(t.url || "")}">
        </label>
        <div class="muted">You can use tokens: <code>{state}</code> <code>{service}</code> <code>{url}</code> <code>{ts}</code></div>
        <div class="muted" style="margin-top:8px;">If you don&#39;t use tokens, the extension will append <code>?state=..&amp;service=..&amp;url=..&amp;ts=..</code> automatically (backward compatible).</div>
      `;
    } else if (t.type === "simpleLed") {
      body.innerHTML = `
        <div class="row">
          <div>
            <label>Base URL
              <input type="text" class="t_baseUrl" placeholder="http://192.168.1.50" value="${esc(t.baseUrl || "")}">
            </label>
            <div class="muted">Uses <code>/led/on</code>, <code>/led/off</code>, optional <code>/led/status</code>.</div>
          </div>
          <div>
            <label style="margin-top:30px;"><input type="checkbox" class="t_verify" ${t.verifyStatus ? "checked":""}> Verify using <code>/led/status</code></label>
          </div>
        </div>
      `;
    } else if (t.type === "iotHybrid") {
      const modeOpts = [[0, "off"], [1, "on"], [2, "breathing"]];
      const modeOn = Number(t.modeOn ?? 1);
      const modeOff = Number(t.modeOff ?? 0);
      // The cloud (AWS IoT Lambda) bridge is the primary, always-visible
      // path. The optional LAN-first path lives in a <details> that opens
      // automatically once a local base URL is set, so a cloud-only row
      // stays uncluttered without hiding the inputs for good.
      const hasLocal = !!(t.localBase || t.localToken);
      body.innerHTML = `
        <label>Cloud endpoint URL
          <input type="text" class="t_cloudBase" placeholder="https://API_ID.execute-api.eu-west-1.amazonaws.com" value="${esc(t.cloudBase || "")}">
        </label>
        <label>Cloud bearer token (<code>Authorization</code>)
          <input type="password" class="t_cloudToken" placeholder="bearer token" value="${esc(t.cloudToken || "")}" autocomplete="off" spellcheck="false">
        </label>
        <label>AWS IoT thing
          <input type="text" class="t_thing" placeholder="onair-test-1" value="${esc(t.thing || "")}">
        </label>
        <div class="row">
          <div>
            <label>ON mode
              <select class="t_modeOn">
                ${modeOpts.map(([v, lbl]) => `<option value="${v}" ${v===modeOn?"selected":""}>${v} (${lbl})</option>`).join("")}
              </select>
            </label>
          </div>
          <div>
            <label>OFF mode
              <select class="t_modeOff">
                ${modeOpts.map(([v, lbl]) => `<option value="${v}" ${v===modeOff?"selected":""}>${v} (${lbl})</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
        <details class="advanced" ${hasLocal ? "open" : ""}>
          <summary>Local-first LAN path (optional)</summary>
          <div class="muted" style="margin-bottom:8px;">Fill this in to try the device on your LAN first and only fall back to the cloud bridge above when it's unreachable. Leave blank for a cloud-only setup.</div>
          <label>Local base URL
            <input type="text" class="t_localBase" placeholder="http://10.37.22.98" value="${esc(t.localBase || "")}">
          </label>
          <label>Local API token (<code>X-API-Token</code>)
            <input type="password" class="t_localToken" placeholder="device API token" value="${esc(t.localToken || "")}" autocomplete="off" spellcheck="false">
          </label>
          <label>Local timeout before cloud fallback (ms)
            <input type="number" class="t_localTimeoutMs" min="100" max="10000" value="${Number(t.localTimeoutMs ?? 1500)}">
          </label>
        </details>
        <div class="muted">On every event the extension fires <em>one</em> request${hasLocal ? " to the local API (single fetch, no retries, capped by the timeout above); if it doesn't return 2xx in time the cloud endpoint takes over" : " to the cloud endpoint"}. Exactly one path flips the sign per event — no duplicate commands.</div>
      `;
    } else {
      // httpHook
      const checkStatus = t.checkStatus !== false;
      const statusCodes = normalizeStatusCodes(t.statusCodes);
      const knownSelected = statusCodes.filter(c => KNOWN_STATUS_CODES.includes(c));
      const customSelected = statusCodes.filter(c => !KNOWN_STATUS_CODES.includes(c));
      body.innerHTML = `
        <label>ON URL
          <input type="text" class="t_onUrl" placeholder="http://192.168.1.17/cm?cmnd=Power%20On" value="${esc(t.onUrl || "")}">
        </label>
        <label>OFF URL
          <input type="text" class="t_offUrl" placeholder="http://192.168.1.17/cm?cmnd=Power%20Off" value="${esc(t.offUrl || "")}">
        </label>
        <details class="advanced" ${shouldOpenAdvanced(t) ? "open" : ""}>
          <summary>Advanced (status, headers, body, auth)</summary>
          <label class="check"><input type="checkbox" class="t_check" ${checkStatus ? "checked":""}> Check response status/body</label>
          <div class="smallRow">
            ${KNOWN_STATUS_CODES.map(code => `
              <label style="margin:0;"><input type="checkbox" class="t_status_known" value="${code}" ${knownSelected.includes(code) ? "checked":""}> ${code}</label>
            `).join("")}
          </div>
          <label>Custom status codes (comma-separated)
            <input type="text" class="t_status_custom" placeholder="200, 204, 418" value="${esc(customSelected.join(", "))}">
          </label>
          <label>Response body contains (ON)
            <input type="text" class="t_match_on" placeholder='{"success":true}' value="${esc(t.matchOn || "")}">
          </label>
          <label>Response body contains (OFF)
            <input type="text" class="t_match_off" placeholder='{"success":true}' value="${esc(t.matchOff || "")}">
          </label>
          <label>Basic Auth (optional) user:pass
            <input type="text" class="t_auth" placeholder="admin:secret" value="${esc(t.basicAuth ? `${t.basicAuth.user||""}:${t.basicAuth.pass||""}` : "")}">
          </label>
          <label>Headers (one per line: <code>Key: Value</code>)</label>
          <textarea class="t_headers" placeholder="Content-Type: text/plain">${esc((t.headers||[]).map(h=>`${h.key}: ${h.value}`).join("\n"))}</textarea>
          <label>Body (optional; tokens allowed)</label>
          <textarea class="t_bodyText" placeholder='{"state":"{state}","service":"{service}"}'>${esc(t.body || "")}</textarea>
        </details>

      `;
    }

    // Wire remove
    div.querySelector(".t_remove").addEventListener("click", () => {
      cfg.targets.splice(idx, 1);
      renderTargets(cfg);
    });
    div.querySelector(".t_test_on").addEventListener("click", () => testTargetNode(div, t, "ON"));
    div.querySelector(".t_test_off").addEventListener("click", () => testTargetNode(div, t, "OFF"));

    wireValidation(div, t);

    wrap.appendChild(div);
  });
  refreshDirty();
}

function wireValidation(node, t) {
  const validation = node.querySelector(".validation");
  if (!validation) return;
  const inputs = [...node.querySelectorAll("input, textarea, select")];
  const update = () => {
    const v = validateTargetNode(node, t);
    validation.innerHTML = v.length ? v.map(msg => `<span class="badge warn">${esc(msg)}</span>`).join(" ") : `<span class="badge">Ready</span>`;
  };
  inputs.forEach(i => i.addEventListener("input", update));
  update();
}

function validateTargetNode(node, t) {
  const warnings = [];
  if (t.type === "listener") {
    const url = node.querySelector(".t_url")?.value.trim() || "";
    if (!url) warnings.push("Listener URL is empty");
  } else if (t.type === "simpleLed") {
    const base = node.querySelector(".t_baseUrl")?.value.trim() || "";
    if (!base) warnings.push("LED base URL is empty");
  } else if (t.type === "iotHybrid") {
    const localBase = node.querySelector(".t_localBase")?.value.trim() || "";
    const cloudBase = node.querySelector(".t_cloudBase")?.value.trim() || "";
    if (!localBase && !cloudBase) warnings.push("Set Local base URL and/or Cloud endpoint URL");
    if (cloudBase) {
      if (!node.querySelector(".t_thing")?.value.trim()) warnings.push("Cloud endpoint needs an AWS IoT thing name");
      if (!node.querySelector(".t_cloudToken")?.value.trim()) warnings.push("Cloud endpoint set but bearer token is empty");
    }
  } else {
    const onUrl = node.querySelector(".t_onUrl")?.value.trim() || "";
    const offUrl = node.querySelector(".t_offUrl")?.value.trim() || "";
    if (!onUrl && !offUrl) warnings.push("Add ON and/or OFF URL");
  }
  // Fix 2: flag credentials about to travel over cleartext to a non-LAN
  // host. Built from the live field values so the warning appears as you
  // type, before Save.
  warnings.push(...endpointSecurityWarnings(buildTargetFromNode(node, t)));
  return warnings;
}

function buildTargetFromNode(node, t) {
  const enabled = !!node.querySelector(".t_enabled")?.checked;
  const base = { ...t, enabled };

  if (t.type === "listener") {
    base.url = node.querySelector(".t_url")?.value.trim() || "";
  } else if (t.type === "simpleLed") {
    base.baseUrl = trimSlash(node.querySelector(".t_baseUrl")?.value.trim() || "");
    base.verifyStatus = !!node.querySelector(".t_verify")?.checked;
  } else if (t.type === "iotHybrid") {
    base.localBase = trimSlash(node.querySelector(".t_localBase")?.value.trim() || "");
    base.localToken = node.querySelector(".t_localToken")?.value.trim() || "";
    base.cloudBase = trimSlash(node.querySelector(".t_cloudBase")?.value.trim() || "");
    base.cloudToken = node.querySelector(".t_cloudToken")?.value.trim() || "";
    base.thing = node.querySelector(".t_thing")?.value.trim() || "";
    base.modeOn = clampMode(node.querySelector(".t_modeOn")?.value, 1);
    base.modeOff = clampMode(node.querySelector(".t_modeOff")?.value, 0);
    base.localTimeoutMs = clampLocalTimeoutMs(node.querySelector(".t_localTimeoutMs")?.value, 1500);
  } else {
    base.onUrl = node.querySelector(".t_onUrl")?.value.trim() || "";
    base.offUrl = node.querySelector(".t_offUrl")?.value.trim() || "";
    base.method = (node.querySelector(".t_method")?.value || "GET").toUpperCase();
    base.checkStatus = !!node.querySelector(".t_check")?.checked;

    const knownNodes = [...node.querySelectorAll(".t_status_known")];
    const knownCodes = knownNodes.filter(x => x.checked).map(x => parseInt(x.value, 10));
    const customRaw = (node.querySelector(".t_status_custom")?.value || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(v => parseInt(v, 10))
      .filter(n => Number.isFinite(n) && n >= 100 && n <= 599);
    base.statusCodes = normalizeStatusCodes([...new Set([...knownCodes, ...customRaw])]);
    base.matchOn = node.querySelector(".t_match_on")?.value ?? "";
    base.matchOff = node.querySelector(".t_match_off")?.value ?? "";

    const auth = (node.querySelector(".t_auth")?.value || "").trim();
    if (auth.includes(":")) {
      const [user, ...rest] = auth.split(":");
      base.basicAuth = { user: user || "", pass: rest.join(":") || "" };
    } else {
      base.basicAuth = null;
    }

    const headersRaw = (node.querySelector(".t_headers")?.value || "").split("\n");
    base.headers = headersRaw
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const i = line.indexOf(":");
        if (i < 1) return null;
        return { key: line.slice(0, i).trim(), value: line.slice(i+1).trim() };
      })
      .filter(Boolean);

    base.body = node.querySelector(".t_bodyText")?.value ?? "";
  }

  return base;
}

async function testTargetNode(node, t, state) {
  const cfg = window.__cfg || DEFAULTS;
  const target = buildTargetFromNode(node, t);
  target.enabled = true;

  // Request host permission for every URL this target would hit
  // BEFORE we call fetch. Otherwise the first Test on a freshly
  // imported / freshly added row gets blocked at the CORS preflight
  // because the origin isn't in the extension's granted set. Going
  // through ensureHostPermissionFor here means each Test click is
  // a user gesture that can pop the permission dialog — background
  // event-driven calls can't request permissions, so the Test
  // button is the natural "first-touch" grant moment alongside Save.
  for (const url of getOriginsFromTargets({ targets: [target] })) {
    const granted = await ensureHostPermissionFor(url);
    if (!granted) {
      return showStatus(`Permission denied for ${url}`, false);
    }
  }

  const vars = { state, service: "test", url: "", ts: Date.now() };
  const timeoutMs = Math.max(1, Math.min(20, parseInt($("http_timeout").value || "3", 10))) * 1000;
  const res = await testSingleTarget(target, vars, timeoutMs);
  showStatus(`${t.id} ${state}: ${res ? "OK" : "FAIL"}`, !!res);
}

function readTargetsFromUI(cfg) {
  const wrap = $("targets");
  const nodes = [...wrap.querySelectorAll(".target")];

  const out = [];
  for (const n of nodes) {
    const id = n.dataset.id;
    const t = (cfg.targets || []).find(x => x.id === id);
    if (!t) continue;

    out.push(buildTargetFromNode(n, t));
  }

  cfg.targets = out;
  return cfg;
}

async function load() {
  const [{ config }, { secrets }] = await Promise.all([
    chrome.storage.sync.get({ config: DEFAULTS }),
    chrome.storage.local.get({ secrets: {} })
  ]);
  // Fix 1: credentials are stored in storage.local (never synced to the
  // Google account); merge them back onto the synced, sanitized config.
  const cfg = applySecrets(migrateIfNeeded(config), secrets);

  $("svc_meet").checked = !!cfg.services.meet;
  $("svc_teams").checked = !!cfg.services.teams;
  $("svc_zoom").checked = !!cfg.services.zoom;

  $("mode_select").value = cfg.triggerMode === "ACTIVE_TAB" ? "ACTIVE_TAB" : "ANY_TAB";

  $("http_timeout").value = cfg.timeoutSec ?? 3;
  $("icon_mode").value = cfg.iconMode || DEFAULTS.iconMode;
  updateIconPreview();
  $("theme_switch").checked = (cfg.theme || "light") === "dark";
  applyTheme(cfg.theme || "light");
  $("include_meeting_url").checked = !!cfg.includeMeetingUrl;
  updateTimeoutPills();

  // Store current cfg on window for edits
  cfg.customServices = normalizeCustomServices(cfg.customServices, newId);
  window.__cfg = cfg;
  // Baseline for "unsaved changes" detection — set before rendering so the
  // initial render reads as clean.
  savedSignature = settingsSignature(cfg);
  renderCustomServices(cfg);
  renderTargets(cfg);
  refreshDirty();
}

function addCustomService() {
  const cfg = window.__cfg;
  if (!cfg.customServices) cfg.customServices = [];
  cfg.customServices.push({
    id: newId("svc"),
    name: "",
    enabled: true,
    prefixes: []
  });
  renderCustomServices(cfg);
}

function addTarget(type, templateKey = "") {
  const cfg = window.__cfg;
  if (!cfg.targets) cfg.targets = [];
  readTargetsFromUI(cfg);

  if (type === "listener") {
    cfg.targets.push({
      id: newId("listener"),
      type: "listener",
      enabled: true,
      url: "http://127.0.0.1:8765/event?state={state}&service={service}&url={url}&ts={ts}"
    });
  } else if (type === "simpleLed") {
    cfg.targets.push({
      id: newId("led"),
      type: "simpleLed",
      enabled: true,
      baseUrl: "",
      verifyStatus: false
    });
  } else if (type === "iotHybrid") {
    const tpl = templateKey && TEMPLATES[templateKey] ? TEMPLATES[templateKey].target : null;
    cfg.targets.push({
      id: newId("iot"),
      type: "iotHybrid",
      enabled: true,
      localBase: tpl?.localBase || "",
      localToken: tpl?.localToken || "",
      cloudBase: tpl?.cloudBase || "",
      cloudToken: tpl?.cloudToken || "",
      thing: tpl?.thing || "",
      modeOn: tpl?.modeOn ?? 1,
      modeOff: tpl?.modeOff ?? 0,
      localTimeoutMs: tpl?.localTimeoutMs ?? 1500
    });
  } else {
    const key = templateKey && TEMPLATES[templateKey] ? templateKey : "tasmota";
    const template = TEMPLATES[key].target;
    cfg.targets.push({
      id: newId("hook"),
      type: "httpHook",
      enabled: true,
      ...template
    });
  }
  renderTargets(cfg);
}

// Build the full config object from the current UI state. Shared by
// save() and the dirty-state check so they can't drift.
function collectConfigFromUI() {
  const prev = window.__cfg || DEFAULTS;
  let cfg = {
    services: {
      meet: $("svc_meet").checked,
      teams: $("svc_teams").checked,
      zoom: $("svc_zoom").checked
    },
    triggerMode: $("mode_select").value || "ANY_TAB",
    timeoutSec: clampTimeoutSec($("http_timeout").value, 3),
    targets: prev.targets || [],
    customServices: prev.customServices || [],
    theme: $("theme_switch").checked ? "dark" : "light",
    iconMode: $("icon_mode").value || DEFAULTS.iconMode,
    includeMeetingUrl: $("include_meeting_url").checked
  };
  cfg = readCustomServicesFromUI(cfg);
  cfg = readTargetsFromUI(cfg);
  return cfg;
}

// "Unsaved changes" state. savedSignature is the signature of what's in
// storage; whenever the UI signature differs, show the sticky save bar.
// There is no separate Save button — the bar is the save affordance, and
// it reappears automatically whenever the form drifts from saved.
let savedSignature = "";
let savedFlashTimer = null;
let flashing = false;

function refreshDirty() {
  const bar = $("savebar");
  if (!bar || savedSignature === "" || flashing) return;
  const dirty = settingsSignature(collectConfigFromUI()) !== savedSignature;
  bar.classList.toggle("show", dirty);
}

// Briefly turn the save bar into a green "Saved" confirmation in place,
// then let refreshDirty hide it (since the form now matches storage).
function flashSaved() {
  const bar = $("savebar");
  if (!bar) return;
  flashing = true;
  clearTimeout(savedFlashTimer);
  bar.classList.add("show", "saved");
  $("savebar_msg").textContent = "Saved";
  savedFlashTimer = setTimeout(() => {
    flashing = false;
    bar.classList.remove("saved");
    $("savebar_msg").textContent = "You have unsaved changes";
    refreshDirty();
  }, 1400);
}

async function save() {
  const cfg = collectConfigFromUI();

  // Request permissions for all enabled target origins
  for (const url of getOriginsFromTargets(cfg)) {
    const ok = await ensureHostPermissionFor(url);
    if (!ok) return showStatus(`Permission denied for ${url}`, false);
  }

  // Fix 1: split credentials out of the synced blob. The sanitized
  // config goes to storage.sync (mirrored to the user's Google account);
  // the secrets map goes to storage.local only.
  const { config: sanitized, secrets } = extractSecrets(cfg);
  await Promise.all([
    chrome.storage.sync.set({ config: sanitized }),
    chrome.storage.local.set({ secrets })
  ]);
  window.__cfg = cfg;
  savedSignature = settingsSignature(cfg);
  flashSaved();
  chrome.runtime.sendMessage({ type: "CONFIG_UPDATED" });
}

function exportHooks() {
  let cfg = window.__cfg || DEFAULTS;
  cfg = readCustomServicesFromUI({ ...cfg, customServices: cfg.customServices || [] });
  cfg = readTargetsFromUI({ ...cfg, targets: cfg.targets || [] });
  const services = {
    meet: $("svc_meet").checked,
    teams: $("svc_teams").checked,
    zoom: $("svc_zoom").checked
  };
  const triggerMode = $("mode_select").value || "ANY_TAB";
  const timeoutSec = clampTimeoutSec($("http_timeout").value, 3);
  const iconMode = $("icon_mode").value || DEFAULTS.iconMode;

  // Fix 1 + user choice: credentials are excluded by default. The user
  // can opt in via the "Include secrets" checkbox; the pure decision
  // (what gets included) lives in resolveExportSecrets so it's testable.
  const wantSecrets = $("export_secrets")?.checked === true;
  const { hasSecrets: secretsPresent, includesSecrets: includeSecrets, targets: sourceTargets } =
    resolveExportSecrets(cfg.targets || [], wantSecrets);

  // Either way, never let the consequence be silent.
  if (secretsPresent) {
    const ok = includeSecrets
      ? confirm(
          "⚠️ Include secrets is ON.\n\n" +
          "The exported file will contain your tokens / passwords in PLAINTEXT. " +
          "Anyone who gets the file can read them — keep it private (don't email it, " +
          "commit it, or sync it to a shared drive).\n\nExport WITH secrets?"
        )
      : confirm(
          "Your saved tokens / passwords will NOT be included in this file " +
          "(this is the safe default). You'll re-enter them after importing.\n\n" +
          "Tip: tick \"Include secrets\" next to Export to bundle them instead.\n\n" +
          "Export without secrets?"
        );
    if (!ok) return showStatus("Export cancelled", false);
  }

  const targets = sourceTargets.map(t => {
    if (t.type === "listener") {
      return { type: "listener", url: t.url || "", enabled: t.enabled !== false };
    }
    if (t.type === "simpleLed") {
      return {
        type: "simpleLed",
        baseUrl: t.baseUrl || "",
        verifyStatus: !!t.verifyStatus,
        enabled: t.enabled !== false
      };
    }
    if (t.type === "iotHybrid") {
      return {
        type: "iotHybrid",
        localBase: t.localBase || "",
        localToken: t.localToken || "",
        cloudBase: t.cloudBase || "",
        cloudToken: t.cloudToken || "",
        thing: t.thing || "",
        modeOn: clampMode(t.modeOn, 1),
        modeOff: clampMode(t.modeOff, 0),
        localTimeoutMs: clampLocalTimeoutMs(t.localTimeoutMs, 1500),
        enabled: t.enabled !== false
      };
    }
    return {
      type: "httpHook",
      onUrl: t.onUrl || "",
      offUrl: t.offUrl || "",
      method: t.method || "GET",
      headers: t.headers || [],
      body: t.body || "",
      basicAuth: t.basicAuth || null,
      checkStatus: t.checkStatus !== false,
      statusCodes: normalizeStatusCodes(t.statusCodes),
      matchOn: t.matchOn || "",
      matchOff: t.matchOff || "",
      enabled: t.enabled !== false
    };
  });

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    services,
    triggerMode,
    timeoutSec,
    targets,
    customServices: cfg.customServices || [],
    theme: $("theme_switch").checked ? "dark" : "light",
    iconMode,
    includeMeetingUrl: $("include_meeting_url").checked
  };

  if (includeSecrets) payload.containsSecrets = true;

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Name the file so a secret-bearing export is obvious on disk.
  a.download = exportFileName(includeSecrets);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const note = includeSecrets ? " — ⚠️ includes secrets (keep private)"
    : secretsPresent ? " — credentials excluded (re-enter after import)"
    : "";
  showStatus(`Exported ${targets.length} target(s)${note}`);
}

async function importHooksFromFile(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    let targets = [];
    let customServices = [];
    let importedSettings = null;

    if (Array.isArray(parsed)) {
      targets = parsed;
    } else if (Array.isArray(parsed?.hooks)) {
      targets = parsed.hooks.map(h => ({ ...h, type: "httpHook" }));
    } else if (Array.isArray(parsed?.targets)) {
      targets = parsed.targets;
    }
    if (parsed?.services || parsed?.triggerMode || parsed?.timeoutSec !== undefined || parsed?.theme || parsed?.iconMode || parsed?.includeMeetingUrl !== undefined) {
      importedSettings = {
        services: { ...DEFAULTS.services, ...(parsed.services || {}) },
        triggerMode: parsed.triggerMode || DEFAULTS.triggerMode,
        timeoutSec: clampTimeoutSec(parsed.timeoutSec ?? DEFAULTS.timeoutSec, DEFAULTS.timeoutSec),
        theme: parsed.theme || DEFAULTS.theme,
        iconMode: parsed.iconMode || DEFAULTS.iconMode,
        includeMeetingUrl: !!parsed.includeMeetingUrl
      };
    }
    if (Array.isArray(parsed?.customServices)) {
      customServices = normalizeCustomServices(parsed.customServices, newId);
    }

    const normalizedTargets = targets.map(normalizeTarget).filter(Boolean);
    if (normalizedTargets.length === 0 && customServices.length === 0 && !importedSettings) {
      showStatus("No valid settings found", false);
      return;
    }

    const cfg = window.__cfg;
    if (importedSettings) {
      cfg.services = importedSettings.services;
      cfg.triggerMode = importedSettings.triggerMode;
      cfg.timeoutSec = importedSettings.timeoutSec;
      cfg.theme = importedSettings.theme;
      cfg.iconMode = importedSettings.iconMode;
      cfg.includeMeetingUrl = importedSettings.includeMeetingUrl;

      $("svc_meet").checked = !!cfg.services.meet;
      $("svc_teams").checked = !!cfg.services.teams;
      $("svc_zoom").checked = !!cfg.services.zoom;

      $("mode_select").value = cfg.triggerMode === "ACTIVE_TAB" ? "ACTIVE_TAB" : "ANY_TAB";

      $("http_timeout").value = cfg.timeoutSec ?? DEFAULTS.timeoutSec;
      updateTimeoutPills();
      $("icon_mode").value = cfg.iconMode || DEFAULTS.iconMode;
      updateIconPreview();
      $("theme_switch").checked = (cfg.theme || "light") === "dark";
      applyTheme(cfg.theme || "light");
      $("include_meeting_url").checked = !!cfg.includeMeetingUrl;
    }
    cfg.targets = [...(cfg.targets || []), ...normalizedTargets];
    if (customServices.length > 0) {
      cfg.customServices = [...(cfg.customServices || []), ...customServices];
      renderCustomServices(cfg);
    }
    renderTargets(cfg);
    const parts = [];
    if (normalizedTargets.length > 0) parts.push(`${normalizedTargets.length} target(s)`);
    if (customServices.length > 0) parts.push(`${customServices.length} service(s)`);
    if (importedSettings) parts.push("trigger settings");
    showStatus(`Imported ${parts.join(", ")}`);
  } catch {
    showStatus("Invalid JSON file", false);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function btoaSafe(s) {
  try { return btoa(s); } catch { return ""; }
}

async function fetchWithTimeout(url, opts, timeoutMs, checkStatus = true) {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, cache:"no-store", signal: ac.signal });
      return checkStatus ? r.ok : true;
    } catch {
      if (attempt >= RETRY_MAX) return false;
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(t);
    }
  }
  return false;
}

async function testSingleTarget(t, vars, timeoutMs) {
  if (!t || !t.enabled) return false;
  if (t.type === "listener") {
    const url = buildListenerUrl(t.url, vars);
    if (!url) return false;
    return fetchWithTimeout(url, { method:"GET" }, timeoutMs);
  }
  if (t.type === "simpleLed") {
    const base = trimSlash(t.baseUrl || "");
    if (!base) return false;
    const url = base + (vars.state === "ON" ? "/led/on" : "/led/off");
    return fetchWithTimeout(url, { method:"GET" }, timeoutMs);
  }
  if (t.type === "iotHybrid") {
    const mode = vars.state === "ON"
      ? (Number.isFinite(+t.modeOn) ? +t.modeOn : 1)
      : (Number.isFinite(+t.modeOff) ? +t.modeOff : 0);

    // Local probe — single fetch, no retries, capped by t_localTimeoutMs.
    if (t.localBase) {
      const localTimeout = Math.max(100, Math.min(10000, Number(t.localTimeoutMs) || 1500));
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), localTimeout);
        const headers = new Headers();
        if (t.localToken) headers.set("X-API-Token", t.localToken);
        const r = await fetch(`${trimSlash(t.localBase)}/api/set?state=${mode}`,
          { method: "GET", headers, cache: "no-store", signal: ac.signal });
        clearTimeout(to);
        if (r.ok) return true;
      } catch (_) { /* fall through to cloud */ }
    }

    // Cloud fallback.
    if (!t.cloudBase || !t.thing) return false;
    const cloudHeaders = new Headers();
    if (t.cloudToken) cloudHeaders.set("Authorization", `Bearer ${t.cloudToken}`);
    const cloudUrl = `${trimSlash(t.cloudBase)}/?thing=${encodeURIComponent(t.thing)}&mode=${mode}`;
    return fetchWithTimeout(cloudUrl, { method: "POST", headers: cloudHeaders }, timeoutMs);
  }
  return testHttpHookTarget(t, vars, timeoutMs, vars.state);
}

async function testHttpHookTarget(t, vars, timeoutMs, state) {
  const urlTpl = state === "ON" ? t.onUrl : t.offUrl;
  if (!urlTpl) return false;
  const url = applyTemplate(urlTpl, vars);
  const method = (t.method || "GET").toUpperCase();

  const headers = new Headers();
  for (const h of (t.headers || [])) headers.set(h.key, h.value);

  if (t.basicAuth && (t.basicAuth.user || t.basicAuth.pass)) {
    headers.set("Authorization", "Basic " + btoaSafe(`${t.basicAuth.user||""}:${t.basicAuth.pass||""}`));
  }

  const body = (method === "GET" || method === "HEAD") ? undefined : (applyTemplate(t.body || "", vars) || undefined);
  // Fix 4: same success rule the live background dispatch uses.
  const res = await fetchWithTimeoutResult(url, { method, headers, body }, timeoutMs);
  return httpHookSuccess(t, state, res);
}

async function fetchWithTimeoutResult(url, opts, timeoutMs) {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, cache:"no-store", signal: ac.signal });
      const text = await r.text().catch(() => "");
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

$("savebar_save").addEventListener("click", save);

// Any edit anywhere in the form re-checks the unsaved-changes state.
document.addEventListener("input", refreshDirty);
document.addEventListener("change", refreshDirty);

$("add_custom_service").addEventListener("click", addCustomService);
$("add_template").addEventListener("click", () => {
  // The dropdown now covers both blank targets (formerly the "Add HTTP
  // Hook" / "Add local Listener" buttons) and pre-filled templates; the
  // pure resolveAddChoice tells us which action the selection maps to.
  const choice = resolveAddChoice($("target_template").value, TEMPLATES);
  if (choice.kind === "none") return showStatus("Pick something to add first", false);
  if (choice.kind === "unknown") return showStatus("Unknown selection", false);
  // Templates may carry a `target.type` other than httpHook (e.g.
  // iotHybrid). Either way addTarget(type, templateKey?) picks the right
  // branch; a blank choice has no templateKey.
  addTarget(choice.type, choice.templateKey || "");
});

// Build the "Add a target…" <select> from BLANK_CHOICES + the TEMPLATES
// object so adding an entry is a single-file change. Blanks go in their
// own optgroup above the templates.
function populateTemplateDropdown() {
  const sel = $("target_template");
  if (!sel) return;
  sel.innerHTML = '<option value="">Add a target…</option>';

  const blanks = document.createElement("optgroup");
  blanks.label = "Blank";
  for (const [value, def] of Object.entries(BLANK_CHOICES)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = def.label;
    blanks.appendChild(opt);
  }
  sel.appendChild(blanks);

  const tpls = document.createElement("optgroup");
  tpls.label = "From template";
  for (const [key, def] of Object.entries(TEMPLATES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = def.label || key;
    tpls.appendChild(opt);
  }
  sel.appendChild(tpls);
}
populateTemplateDropdown();

$("export_hooks").addEventListener("click", exportHooks);
$("import_hooks").addEventListener("click", () => $("import_hooks_file").click());
$("import_hooks_file").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importHooksFromFile(file);
  e.target.value = "";
});

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

// Show a "vX-dev · branch @ commit" badge for unpacked dev builds off a
// non-main branch. build-info.json is absent in store/release installs,
// so this no-ops there. See scripts/gen-build-info.sh + formatBuildBadge.
async function showBuildBadge() {
  try {
    const res = await fetch(chrome.runtime.getURL("build-info.json"), { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    const label = formatBuildBadge(info, chrome.runtime.getManifest().version);
    if (!label) return;
    const el = $("build_badge");
    el.textContent = label;
    el.style.display = "inline-block";
  } catch {
    // no build info — render nothing
  }
}

// Theme is a personal display preference, not document content — apply
// and persist it instantly on toggle so it never requires a Save (and so
// it doesn't trip the unsaved-changes bar; see settingsSignature, which
// excludes theme).
async function persistTheme(theme) {
  const { config } = await chrome.storage.sync.get({ config: DEFAULTS });
  config.theme = theme;
  await chrome.storage.sync.set({ config });
  if (window.__cfg) window.__cfg.theme = theme;
}

$("theme_switch").addEventListener("change", () => {
  const theme = $("theme_switch").checked ? "dark" : "light";
  applyTheme(theme);
  persistTheme(theme);
});

function updateIconPreview() {
  const mode = $("icon_mode").value || DEFAULTS.iconMode;
  const img = $("icon_preview");
  if (!img) return;
  img.src = mode === "alwaysColor" ? "icons/icon48.png" : "icons/icon48_gray.png";
}

$("icon_mode").addEventListener("change", updateIconPreview);

function updateTimeoutPills() {
  const val = parseInt($("http_timeout").value || "3", 10);
  const pills = [...document.querySelectorAll(".timeout-pill")];
  pills.forEach(p => p.classList.toggle("active", parseInt(p.dataset.val, 10) === val));
}

document.querySelectorAll(".timeout-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    $("http_timeout").value = btn.dataset.val;
    updateTimeoutPills();
    refreshDirty();
  });
});

load();
showBuildBadge();
