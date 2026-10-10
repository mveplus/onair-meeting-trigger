import {
  formatBuildBadge,
  describeMeetingState,
  countEnabledTargets,
  isPaused,
  describePausedState,
  describeDispatchHealth,
  PAUSE_INDEFINITE
} from "./shared.js";

function $(id){ return document.getElementById(id); }

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

// U2: the last rendered snapshot + theme, cached per-browser so the next
// open paints the right state and colors immediately instead of flashing
// "Off air" in the light theme while the worker wakes up.
const CACHE_KEY = "popupCache";

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}

function writeCache(patch) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...(readCache() || {}), ...patch })); } catch { /* best effort */ }
}

let pollTimer = null;
let lastSnap = { state: "OFF", service: null, detected: null, pause: { until: 0 } };
let enabledCount = 0;
let lastDispatch = null;

// Render the whole popup from a state snapshot { state, service, detected, pause }.
function render(snap) {
  const state = snap?.state || "OFF";
  const service = snap?.service || null;
  const pause = snap?.pause || { until: 0 };
  const paused = isPaused(pause);

  const card = $("status_card");
  const big = $("status_big");
  const sub = $("status_sub");

  card.classList.remove("on", "off", "paused");
  if (paused) {
    card.classList.add("paused");
    big.textContent = "⏸ Paused";
    // U3: keep the meeting visible so it's clear the sign is held off on purpose.
    sub.textContent = describePausedState(pause, snap?.detected || null);
  } else if (state === "ON") {
    card.classList.add("on");
    big.textContent = "🔴 ON AIR";
    sub.textContent = describeMeetingState(state, service);
  } else {
    card.classList.add("off");
    big.textContent = "Off air";
    sub.textContent = describeMeetingState(state, service);
  }

  renderPause(paused);
  // Tick the "Xm left" label down while a timed pause is open.
  clearInterval(pollTimer);
  if (paused) pollTimer = setInterval(refresh, 30000);
}

function renderPause(paused) {
  const row = $("pause_row");
  row.replaceChildren();
  if (paused) {
    const resume = btn("▶ Resume", () => send({ type: "RESUME" }));
    const plus = btn("Extend 1h", () => send({ type: "SET_PAUSE", until: extendUntil(lastSnap.pause) }));
    row.append(resume, plus);
  } else {
    const hour = btn("Pause 1 hour", () => send({ type: "SET_PAUSE", until: Date.now() + 3600_000 }));
    const forever = btn("Pause indefinitely", () => send({ type: "SET_PAUSE", until: PAUSE_INDEFINITE }));
    row.append(hour, forever);
  }
}

// "Extend 1h" adds an hour to the remaining pause (not to now), so
// pressing it twice really means two more hours.
function extendUntil(pause) {
  const until = pause?.until;
  if (until === PAUSE_INDEFINITE) return PAUSE_INDEFINITE;
  return Math.max(Date.now(), Number(until) || 0) + 3600_000;
}

function btn(text, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// U1: answer "did my sign actually get the update?" instead of just
// counting configured targets.
function renderHealth() {
  const el = $("health");
  const h = describeDispatchHealth(lastDispatch, enabledCount);
  el.className = `health ${h.severity === "muted" ? "muted" : h.severity}`;
  el.textContent = h.text;
  if (!enabledCount) {
    el.append(" — ", link("Add one in Settings", () => chrome.runtime.openOptionsPage()));
  } else if (h.severity === "warn") {
    el.append(" ", link("Details", () => chrome.tabs.create({ url: chrome.runtime.getURL("diagnostics.html") })));
  }
}

function link(text, onClick) {
  const a = document.createElement("a");
  a.textContent = text;
  a.tabIndex = 0;
  a.addEventListener("click", onClick);
  return a;
}

async function send(msg) {
  try {
    const resp = await chrome.runtime.sendMessage(msg);
    if (resp?.pause) { lastSnap = { ...lastSnap, pause: resp.pause }; render(lastSnap); }
  } catch { /* worker asleep — refresh will re-sync */ }
  refresh();
}

async function refresh() {
  try {
    const snap = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (snap) {
      lastSnap = snap;
      render(snap);
      writeCache({ snap: { state: snap.state, service: snap.service, detected: snap.detected, pause: snap.pause } });
    }
  } catch { /* worker asleep */ }
}

// One read of the synced config drives theme, icon hint and target count.
async function loadConfig() {
  const { config } = await chrome.storage.sync.get({ config: {} });
  const theme = config?.theme === "dark" ? "dark" : "light";
  applyTheme(theme);
  writeCache({ theme });
  const hint = $("icon_hint");
  if (hint) hint.style.display = config?.iconMode === "state" ? "block" : "none";
  enabledCount = countEnabledTargets(config);
  renderHealth();
}

async function loadDispatch() {
  try {
    const store = chrome.storage.session || chrome.storage.local;
    const { lastDispatch: rec = null } = await store.get({ lastDispatch: null });
    lastDispatch = rec;
  } catch {
    lastDispatch = null;
  }
  renderHealth();
}

async function showBuildBadge() {
  try {
    const res = await fetch(chrome.runtime.getURL("build-info.json"), { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    const text = formatBuildBadge(info, chrome.runtime.getManifest().version);
    if (!text) return;
    const el = $("build_badge");
    el.textContent = text;
    el.title = text;
    el.style.display = "block";
  } catch { /* packed build — nothing to show */ }
}

// Live updates pushed by the service worker when the state/pause changes.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "STATE_CHANGED") {
    lastSnap = { state: msg.state, service: msg.service, detected: msg.detected, pause: msg.pause };
    render(lastSnap);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.config) loadConfig();
  if ((area === "session" || area === "local") && changes.lastDispatch) {
    lastDispatch = changes.lastDispatch.newValue || null;
    renderHealth();
  }
});

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

// U2: paint from cache synchronously, then reconcile with live state.
const cached = readCache();
if (cached?.theme) applyTheme(cached.theme);
if (cached?.snap) { lastSnap = cached.snap; render(lastSnap); } else { render(lastSnap); }

// Keep the "updated Xs ago" text fresh while the popup is open.
setInterval(renderHealth, 15000);

refresh();
loadConfig();
loadDispatch();
showBuildBadge();
