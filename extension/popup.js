
function $(id){ return document.getElementById(id); }

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
