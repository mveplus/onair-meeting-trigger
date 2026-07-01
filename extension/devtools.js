// Registers the "ON-AIR" DevTools panel. The panel content is the same
// diagnostics.html served as a standalone tab, so there's a single log UI
// surfaced two ways (DevTools panel + Options → Open diagnostics).
chrome.devtools.panels.create(
  "ON-AIR",
  "icons/icon32.png",
  "diagnostics.html",
  () => { /* panel created */ }
);
