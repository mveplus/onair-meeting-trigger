// Diagnostics UI — shared by the standalone page (Options → Open
// diagnostics) and the "ON-AIR" DevTools panel. Reads the activity log
// straight from chrome.storage.local so it works even while the service
// worker is suspended, and live-updates via storage.onChanged.

import { describeLogEntry, logSeverity } from "./shared.js";

const LOG_KEY = "activityLog";
const DEBUG_KEY = "debugLogs";

const $ = id => document.getElementById(id);
let cache = [];

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour12: false }); } catch { return String(ts); }
}

function matchesFilter(entry, filter) {
  if (filter === "all") return true;
  if (filter === "errors") return logSeverity(entry) === "error";
  if (filter === "worker") return entry.kind === "worker";
  if (filter === "reconcile") return entry.kind === "reconcile";
  if (filter === "change") return entry.kind === "edge";
  return true;
}

function render() {
  const filter = $("filter").value;
  const log = $("log");
  const shown = cache.filter(e => matchesFilter(e, filter));
  $("count").textContent = `${shown.length} / ${cache.length} events`;

  if (!shown.length) {
    log.innerHTML = `<div class="empty">${cache.length ? "No events match this filter." : "No activity recorded yet. Turn on logging, reproduce the issue, and it'll appear here live."}</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of shown.slice().reverse()) { // newest first
    const d = describeLogEntry(entry);
    const el = document.createElement("div");
    el.className = `entry ${d.severity}`;
    const lines = d.lines.map(l => `<li class="${esc(l.severity)}">${esc(l.text)}</li>`).join("");
    el.innerHTML = `
      <div class="entryHead">
        <span class="time">${esc(fmtTime(d.ts))}</span>
        <span class="headline">${esc(d.headline)}</span>
        ${d.reason ? `<span class="reason">[${esc(d.reason)}]</span>` : ""}
      </div>
      ${lines ? `<ul class="lines">${lines}</ul>` : ""}
    `;
    frag.appendChild(el);
  }
  log.replaceChildren(frag);
}

async function loadLog() {
  try {
    const got = await chrome.storage.local.get({ [LOG_KEY]: [] });
    cache = got[LOG_KEY] || [];
  } catch {
    cache = [];
  }
  render();
}

async function syncDebugToggle() {
  const { [DEBUG_KEY]: on = false } = await chrome.storage.local.get({ [DEBUG_KEY]: false });
  $("debug_logs").checked = !!on;
  $("off_banner").hidden = !!on;
}

async function buildReport() {
  let config = null;
  try {
    // storage.sync config is already credential-free — secrets live in
    // storage.local and never sync — so it's safe to bundle in a report.
    const got = await chrome.storage.sync.get({ config: null });
    config = got.config;
  } catch { /* ignore */ }
  const manifest = chrome.runtime.getManifest?.() || {};
  return {
    generatedAt: new Date().toISOString(),
    extension: manifest.name,
    version: manifest.version,
    userAgent: navigator.userAgent,
    events: cache,
    config
  };
}

function flash(btn, msg) {
  const orig = btn.dataset.label || btn.textContent;
  btn.dataset.label = orig;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ---- wiring ----
$("filter").addEventListener("change", render);
$("refresh").addEventListener("click", loadLog);

$("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
  await loadLog();
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(await buildReport(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    flash($("copy"), "Copied ✓");
  } catch {
    // clipboard API can be blocked inside the devtools panel — fall back
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); flash($("copy"), "Copied ✓"); }
    catch { flash($("copy"), "Copy failed"); }
    ta.remove();
  }
});

$("debug_logs").addEventListener("change", () => {
  chrome.storage.local.set({ [DEBUG_KEY]: !!$("debug_logs").checked });
});

// Live updates: storage.onChanged fires in every extension context.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[DEBUG_KEY]) syncDebugToggle();
  if (changes[LOG_KEY] && $("live").checked) {
    cache = changes[LOG_KEY].newValue || [];
    render();
  }
});

syncDebugToggle();
loadLog();
