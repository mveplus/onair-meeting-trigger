import { formatBuildBadge } from "./shared.js";

function $(id){ return document.getElementById(id); }

// Show a "vX-dev · branch @ commit" badge when running an unpacked build
// off a non-main branch. build-info.json is written by
// scripts/gen-build-info.sh and is absent in store/release installs, so
// this silently no-ops there.
async function showBuildBadge() {
  try {
    const res = await fetch(chrome.runtime.getURL("build-info.json"), { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    const label = formatBuildBadge(info, chrome.runtime.getManifest().version);
    if (!label) return;
    const el = $("build_badge");
    el.textContent = label;
    el.style.display = "block";
  } catch {
    // no build info (packed/store build) — render nothing
  }
}

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

async function refresh() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const st = resp?.state || "OFF";
  const svc = resp?.service || "—";

  const stateEl = $("state");
  stateEl.textContent = st;
  stateEl.classList.toggle("on", st === "ON");
  stateEl.classList.toggle("off", st !== "ON");

  $("service").textContent = svc;
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

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("refresh").addEventListener("click", refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.config) return;
  updateIconHint();
  updateTheme();
});
refresh();
updateIconHint();
updateTheme();
showBuildBadge();
