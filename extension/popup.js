import {
  formatBuildBadge,
  describeMeetingState,
  countEnabledTargets,
  isPaused,
  describePause,
  PAUSE_INDEFINITE
} from "./shared.js";

function $(id){ return document.getElementById(id); }

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

let pollTimer = null;

// Render the whole popup from a state snapshot { state, service, pause }.
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
    sub.textContent = describePause(pause) || "Paused";
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
  row.innerHTML = "";
  if (paused) {
    const resume = btn("Resume", "small", () => send({ type: "RESUME" }));
    const plus = btn("+1h", "small", () => send({ type: "SET_PAUSE", until: Date.now() + 3600_000 }));
    row.append(label("Sign paused"), resume, plus);
  } else {
    const hour = btn("1 hour", "small", () => send({ type: "SET_PAUSE", until: Date.now() + 3600_000 }));
    const forever = btn("Until I resume", "small", () => send({ type: "SET_PAUSE", until: PAUSE_INDEFINITE }));
    row.append(label("Pause:"), hour, forever);
  }
}

function label(text) {
  const s = document.createElement("span");
  s.className = "lbl";
  s.textContent = text;
  return s;
}

function btn(text, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

async function send(msg) {
  try {
    const resp = await chrome.runtime.sendMessage(msg);
    if (resp) render(resp.pause ? { ...lastSnap, pause: resp.pause } : lastSnap);
  } catch { /* worker asleep — refresh will re-sync */ }
  refresh();
}

let lastSnap = { state: "OFF", service: null, pause: { until: 0 } };

async function refresh() {
  try {
    const snap = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (snap) { lastSnap = snap; render(snap); }
  } catch { /* worker asleep */ }
  updateTargetsLine();
}

async function updateTargetsLine() {
  const { config } = await chrome.storage.sync.get({ config: { targets: [] } });
  const n = countEnabledTargets(config);
  const el = $("targets_line");
  if (n === 0) {
    el.innerHTML = 'No targets set up — <a id="targets_link">Open Settings</a> to add one';
    $("targets_link").addEventListener("click", () => chrome.runtime.openOptionsPage());
  } else {
    el.textContent = `${n} target${n === 1 ? "" : "s"} active`;
  }
}

async function updateIconHint() {
  const { config } = await chrome.storage.sync.get({ config: { iconMode: "alwaysColor" } });
  const mode = config?.iconMode || "alwaysColor";
  const hint = $("icon_hint");
  if (hint) hint.style.display = mode === "state" ? "block" : "none";
}

async function updateTheme() {
  const { config } = await chrome.storage.sync.get({ config: { theme: "light" } });
  applyTheme(config?.theme || "light");
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
    el.style.display = "block";
  } catch { /* packed build — nothing to show */ }
}

// Live updates pushed by the service worker when the state/pause changes.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "STATE_CHANGED") {
    lastSnap = { state: msg.state, service: msg.service, pause: msg.pause };
    render(lastSnap);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.config) { updateIconHint(); updateTheme(); updateTargetsLine(); }
});

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
updateIconHint();
updateTheme();
showBuildBadge();
