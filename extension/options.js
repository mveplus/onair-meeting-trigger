const DEFAULTS = {
  services: { meet: true, teams: true, zoom: true },
  triggerMode: "ANY_TAB",
  timeoutSec: 3,
  targets: [],
  customServices: [],
  theme: "light",
  iconMode: "alwaysColor"
};

const DEFAULT_STATUS_CODES = [200, 202, 204];
const KNOWN_STATUS_CODES = [200, 202, 204, 401, 403];
const RETRY_MAX = 2;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2000;
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
  aws_iot_lambda: {
    // Cloud bridge for the OnAir LED sign over AWS IoT.
    // The companion Lambda is in onair-led-sign-firmware →
    // scripts/cloud-bridge/. It validates a bearer token, reads
    // `thing` and `mode` from the query string (so this template
    // doesn't need any body templating), and publishes
    // {"mode": N} on the device's onair/<thing>/cmd topic.
    // Replace API_ID, YOUR_THING, and REPLACE_WITH_TOKEN below.
    label: "OnAir Cloud Bridge (AWS IoT Lambda)",
    target: {
      type: "httpHook",
      onUrl:  "https://API_ID.execute-api.eu-west-1.amazonaws.com/?thing=YOUR_THING&mode=1",
      offUrl: "https://API_ID.execute-api.eu-west-1.amazonaws.com/?thing=YOUR_THING&mode=0",
      method: "POST",
      headers: [
        { key: "Authorization", value: "Bearer REPLACE_WITH_TOKEN" }
      ],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      // Lambda returns json.dumps with default (no-space) separators,
      // so match on the exact substring it emits per state.
      matchOn:  "\"mode\":1",
      matchOff: "\"mode\":0"
    }
  },
  aws_iot_lambda_breathing: {
    // Same cloud bridge as aws_iot_lambda above, but the "ON" action
    // triggers breathing mode (mode=2) instead of solid on (mode=1).
    // Pick this template if you'd rather the sign pulse during
    // meetings than stay solid — the OFF action is still mode=0,
    // so the meeting-ended flow returns the sign to dark either way.
    label: "OnAir Cloud Bridge — Breathing (AWS IoT Lambda)",
    target: {
      type: "httpHook",
      onUrl:  "https://API_ID.execute-api.eu-west-1.amazonaws.com/?thing=YOUR_THING&mode=2",
      offUrl: "https://API_ID.execute-api.eu-west-1.amazonaws.com/?thing=YOUR_THING&mode=0",
      method: "POST",
      headers: [
        { key: "Authorization", value: "Bearer REPLACE_WITH_TOKEN" }
      ],
      body: "",
      basicAuth: null,
      checkStatus: true,
      statusCodes: [...DEFAULT_STATUS_CODES],
      matchOn:  "\"mode\":2",
      matchOff: "\"mode\":0"
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
function trimSlash(s){ return (s || "").replace(/\/+$/, ""); }
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
    cfg.customServices = normalizeCustomServices(config?.customServices);
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
  }
  return urls;
}

function normalizePrefixes(prefixes) {
  if (!Array.isArray(prefixes)) return [];
  return prefixes.map(p => String(p || "").trim()).filter(Boolean);
}

function normalizeCustomServices(customServices) {
  if (!Array.isArray(customServices)) return [];
  return customServices
    .map(s => {
      const name = String(s?.name || "").trim();
      const prefixes = normalizePrefixes(s?.prefixes || []);
      if (!name || prefixes.length === 0) return null;
      return {
        id: s?.id || newId("svc"),
        name,
        enabled: s?.enabled !== false,
        prefixes
      };
    })
    .filter(Boolean);
}

function normalizeHeadersList(headers) {
  if (!Array.isArray(headers)) return [];
  return headers
    .map(h => (h && typeof h.key === "string") ? { key: h.key.trim(), value: String(h.value ?? "") } : null)
    .filter(h => h && h.key);
}

function normalizeStatusCodes(codes) {
  if (!Array.isArray(codes)) return [...DEFAULT_STATUS_CODES];
  const out = codes
    .map(c => parseInt(c, 10))
    .filter(n => Number.isFinite(n) && n >= 100 && n <= 599);
  return out.length ? out : [...DEFAULT_STATUS_CODES];
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

  (cfg.targets || []).forEach((t, idx) => {
    const typeLabel = t.type === "listener" ? "Listener"
      : t.type === "simpleLed" ? "Simple LED"
      : "HTTP";

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
  } else {
    const onUrl = node.querySelector(".t_onUrl")?.value.trim() || "";
    const offUrl = node.querySelector(".t_offUrl")?.value.trim() || "";
    if (!onUrl && !offUrl) warnings.push("Add ON and/or OFF URL");
  }
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
  const { config } = await chrome.storage.sync.get({ config: DEFAULTS });
  const cfg = migrateIfNeeded(config);

  $("svc_meet").checked = !!cfg.services.meet;
  $("svc_teams").checked = !!cfg.services.teams;
  $("svc_zoom").checked = !!cfg.services.zoom;

  $("mode_select").value = cfg.triggerMode === "ACTIVE_TAB" ? "ACTIVE_TAB" : "ANY_TAB";

  $("http_timeout").value = cfg.timeoutSec ?? 3;
  $("icon_mode").value = cfg.iconMode || DEFAULTS.iconMode;
  updateIconPreview();
  $("theme_switch").checked = (cfg.theme || "light") === "dark";
  applyTheme(cfg.theme || "light");
  updateTimeoutPills();

  // Store current cfg on window for edits
  cfg.customServices = normalizeCustomServices(cfg.customServices);
  window.__cfg = cfg;
  renderCustomServices(cfg);
  renderTargets(cfg);
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

async function save() {
  let cfg = window.__cfg;

  cfg = {
    services: {
      meet: $("svc_meet").checked,
      teams: $("svc_teams").checked,
      zoom: $("svc_zoom").checked
    },
    triggerMode: $("mode_select").value || "ANY_TAB",
    timeoutSec: Math.max(1, Math.min(20, parseInt($("http_timeout").value || "3", 10))),
    targets: cfg.targets || [],
    customServices: cfg.customServices || [],
    theme: $("theme_switch").checked ? "dark" : "light",
    iconMode: $("icon_mode").value || DEFAULTS.iconMode
  };

  cfg = readCustomServicesFromUI(cfg);
  cfg = readTargetsFromUI(cfg);

  // Request permissions for all enabled target origins
  for (const url of getOriginsFromTargets(cfg)) {
    const ok = await ensureHostPermissionFor(url);
    if (!ok) return showStatus(`Permission denied for ${url}`, false);
  }

  await chrome.storage.sync.set({ config: cfg });
  window.__cfg = cfg;
  showStatus("Saved");
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
  const timeoutSec = Math.max(1, Math.min(20, parseInt($("http_timeout").value || "3", 10)));
  const iconMode = $("icon_mode").value || DEFAULTS.iconMode;

  const targets = (cfg.targets || []).map(t => {
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
    iconMode
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "onair-settings.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showStatus(`Exported ${targets.length} target(s)`);
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
    if (parsed?.services || parsed?.triggerMode || parsed?.timeoutSec !== undefined || parsed?.theme || parsed?.iconMode) {
      importedSettings = {
        services: { ...DEFAULTS.services, ...(parsed.services || {}) },
        triggerMode: parsed.triggerMode || DEFAULTS.triggerMode,
        timeoutSec: Math.max(1, Math.min(20, parseInt(parsed.timeoutSec ?? DEFAULTS.timeoutSec, 10))),
        theme: parsed.theme || DEFAULTS.theme,
        iconMode: parsed.iconMode || DEFAULTS.iconMode
      };
    }
    if (Array.isArray(parsed?.customServices)) {
      customServices = normalizeCustomServices(parsed.customServices);
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

function applyTemplate(str, vars) {
  return String(str ?? "")
    .replaceAll("{state}", vars.state ?? "")
    .replaceAll("{service}", vars.service ?? "")
    .replaceAll("{url}", vars.url ?? "")
    .replaceAll("{ts}", String(vars.ts ?? ""));
}

function backoffMs(attempt) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** attempt));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function btoaSafe(s) {
  try { return btoa(s); } catch { return ""; }
}

async function testAll(state) {
  const { config } = await chrome.storage.sync.get({ config: DEFAULTS });
  const cfg = migrateIfNeeded(config);

  const vars = { state, service: "test", url: "", ts: Date.now() };
  const timeoutMs = Math.max(1, Math.min(20, parseInt(cfg.timeoutSec ?? 3, 10))) * 1000;

  const jobs = (cfg.targets || []).filter(t => t.enabled).map(async (t) => {
    if (t.type === "listener") {
      let url = t.url || "";
      if (url.includes("{state}") || url.includes("{service}") || url.includes("{url}") || url.includes("{ts}")) {
        url = applyTemplate(url, vars);
      } else {
        try {
          const u = new URL(url);
          u.searchParams.set("state", vars.state);
          u.searchParams.set("service", vars.service);
          u.searchParams.set("ts", String(vars.ts));
          url = u.toString();
        } catch {
          return { ok:false, name:t.id };
        }
      }
      return fetchWithTimeout(url, { method:"GET" }, timeoutMs).then(ok => ({ ok, name:t.id }));
    }

    if (t.type === "simpleLed") {
      const base = trimSlash(t.baseUrl || "");
      if (!base) return { ok:false, name:t.id };
      const url = base + (state === "ON" ? "/led/on" : "/led/off");
      return fetchWithTimeout(url, { method:"GET" }, timeoutMs).then(ok => ({ ok, name:t.id }));
    }

    // httpHook
    const ok = await testHttpHookTarget(t, vars, timeoutMs, state);
    return { ok, name: t.id };
  });

  const res = await Promise.allSettled(jobs);
  const okCount = res.filter(r => r.status === "fulfilled" && r.value.ok).length;
  const total = res.length;
  showStatus(`Test ${state}: ${okCount}/${total} OK`, okCount === total);
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
    let url = t.url || "";
    if (url.includes("{state}") || url.includes("{service}") || url.includes("{url}") || url.includes("{ts}")) {
      url = applyTemplate(url, vars);
    } else {
      try {
        const u = new URL(url);
        u.searchParams.set("state", vars.state);
        u.searchParams.set("service", vars.service);
        u.searchParams.set("ts", String(vars.ts));
        url = u.toString();
      } catch {
        return false;
      }
    }
    return fetchWithTimeout(url, { method:"GET" }, timeoutMs);
  }
  if (t.type === "simpleLed") {
    const base = trimSlash(t.baseUrl || "");
    if (!base) return false;
    const url = base + (vars.state === "ON" ? "/led/on" : "/led/off");
    return fetchWithTimeout(url, { method:"GET" }, timeoutMs);
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
  const checkStatus = t.checkStatus !== false;
  const statusCodes = normalizeStatusCodes(t.statusCodes);
  const match = state === "ON" ? (t.matchOn || "") : (t.matchOff || "");
  const res = await fetchWithTimeoutResult(url, { method, headers, body }, timeoutMs);
  if (!checkStatus) return !res.error;
  const okStatus = statusCodes.includes(res.status);
  const okBody = match ? (res.text || "").includes(match) : true;
  return okStatus && okBody;
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

$("save").addEventListener("click", save);
$("test_on").addEventListener("click", () => testAll("ON"));
$("test_off").addEventListener("click", () => testAll("OFF"));

$("add_listener").addEventListener("click", () => addTarget("listener"));
$("add_hook").addEventListener("click", () => addTarget("httpHook"));
$("add_custom_service").addEventListener("click", addCustomService);
$("add_template").addEventListener("click", () => {
  const key = $("target_template").value;
  if (!key) return showStatus("Pick a template first", false);
  addTarget("httpHook", key);
});

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

$("theme_switch").addEventListener("change", () => applyTheme($("theme_switch").checked ? "dark" : "light"));

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
  });
});

load();
