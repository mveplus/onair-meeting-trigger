#!/usr/bin/env bash
#
# Regenerate the Chrome Web Store screenshot tiles in resources/store/.
#
# It renders the REAL popup.html / options.html pages with a headless
# Chromium against a mocked chrome.* API (seeded with a realistic, fully
# configured extension), then composes branded 1280x800 tiles.
#
# Requirements: chromium (or chromium-browser / google-chrome) and
# ImageMagick (magick). No extension code is modified — a throwaway copy
# is rendered from a temp dir.
#
# Usage:  scripts/make-store-shots.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$REPO/extension"
DEST="$REPO/resources/store"
WORK="$(mktemp -d)"
SITE="$WORK/site"
RAW="$WORK/raw"; PROC="$WORK/proc"; TILES="$WORK/tiles"
mkdir -p "$SITE" "$RAW" "$PROC" "$TILES" "$DEST"

# --- locate tools -----------------------------------------------------
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in chromium-browser google-chrome google-chrome-stable chromium chrome; do
    command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
  done
fi
[ -n "$CHROME" ] || { echo "No chromium/chrome binary found" >&2; exit 1; }
command -v magick >/dev/null 2>&1 || { echo "ImageMagick (magick) required" >&2; exit 1; }

trap 'rm -rf "$WORK"' EXIT

# --- assemble served copy + chrome.* mock -----------------------------
cp -r "$EXT/." "$SITE/"
rm -f "$SITE/build-info.json"   # store builds ship none → no dev badge

cat > "$SITE/mock-chrome.js" <<'MOCK'
// Headless screenshot mock for chrome.* — seeds a realistic, fully
// configured extension so popup.html / options.html render a "live" UI.
(function () {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const SEED_CONFIG = {
    services: { meet: true, teams: true, zoom: true },
    triggerMode: "ANY_TAB", timeoutSec: 3, theme,
    iconMode: "alwaysColor", includeMeetingUrl: false, customServices: [],
    targets: [
      { id: "iot_office", type: "iotHybrid", enabled: true,
        localBase: "http://10.37.22.98", localToken: "device-api-token-9f3c",
        cloudBase: "https://k3f9qz.execute-api.eu-west-1.amazonaws.com",
        cloudToken: "bearer-7b21c0e4", thing: "onair-office-1",
        modeOn: 1, modeOff: 0, localTimeoutMs: 1500 },
      { id: "hook_homeassistant", type: "httpHook", enabled: true,
        onUrl: "http://homeassistant.local:8123/api/webhook/ON_AIR_ON",
        offUrl: "http://homeassistant.local:8123/api/webhook/ON_AIR_OFF",
        method: "POST",
        headers: [ { key: "Authorization", value: "Bearer eyJ0eXA–redacted" },
                   { key: "Content-Type", value: "application/json" } ],
        body: "{\"entity_id\":[\"light.office_sign\"]}",
        basicAuth: null, checkStatus: true, statusCodes: [200, 204],
        matchOn: "", matchOff: "" },
      { id: "listener_local", type: "listener", enabled: true,
        url: "http://127.0.0.1:8765/event?state={state}&service={service}" }
    ]
  };
  const SEED_STATE = { state: "ON", service: "meet", pause: { until: 0 } };
  function get(req) {
    const out = {};
    const keys = Array.isArray(req) ? req : Object.keys(req || {});
    for (const k of keys) {
      if (k === "config") out.config = JSON.parse(JSON.stringify(SEED_CONFIG));
      else if (k === "secrets") out.secrets = {};
      else out[k] = (req && typeof req === "object" && !Array.isArray(req)) ? req[k] : undefined;
    }
    return Promise.resolve(out);
  }
  const noopListener = { addListener() {}, removeListener() {} };
  window.chrome = {
    storage: { sync: { get, set: () => Promise.resolve() },
               local: { get, set: () => Promise.resolve() }, onChanged: noopListener },
    runtime: {
      sendMessage: (msg) => Promise.resolve(msg && msg.type === "GET_STATE" ? SEED_STATE : null),
      onMessage: noopListener, getURL: (p) => p,
      getManifest: () => ({ version: "0.0.0" }), openOptionsPage: () => {}, lastError: null },
    permissions: { request: () => Promise.resolve(true), contains: () => Promise.resolve(true),
                   remove: () => Promise.resolve(true) },
    tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({}) }
  };
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "#savebar{display:none!important}#build_badge{display:none!important}#icon_hint{display:none!important}";
    document.head.appendChild(s);
  });
})();
MOCK

# Inject the mock as the first (classic) script in <head> so it runs
# before the deferred module scripts that call chrome.*.
perl -0pi -e 's{<head>}{<head>\n  <script src="mock-chrome.js"></script>}' \
  "$SITE/popup.html" "$SITE/options.html"

# --- render (file:// + the file-access flag lets ES modules load) -----
COMMON=(--headless=new --hide-scrollbars --force-device-scale-factor=2
        --allow-file-access-from-files --no-sandbox --disable-gpu
        --user-data-dir="$WORK/chrome-profile" --no-first-run
        --no-default-browser-check --virtual-time-budget=2500)
shot() {
  "$CHROME" "${COMMON[@]}" --window-size="$2" --screenshot="$RAW/$1.png" \
    "file://$SITE/$3" 2>/dev/null || true
  [ -s "$RAW/$1.png" ] || { echo "screenshot failed: $1 (is '$CHROME' working headless?)" >&2; exit 1; }
}
shot popup_light   280,330   "popup.html?theme=light"
shot popup_dark    280,330   "popup.html?theme=dark"
shot options_light 1100,1480 "options.html?theme=light"
shot options_dark  1100,1480 "options.html?theme=dark"

for f in popup_light popup_dark options_light options_dark; do
  magick "$RAW/$f.png" -trim +repage "$PROC/$f.png"
done
# Trim makes the popup's red status card flush to the top edge, so the
# outer corner-rounding would cut across the card's OWN radius and leave a
# mismatched notch. Restore a small uniform margin in the popup's body
# colour so the rounded corner cuts through a solid fill instead.
magick "$PROC/popup_light.png" -bordercolor '#ffffff' -border 18 +repage "$PROC/popup_light.png"
magick "$PROC/popup_dark.png"  -bordercolor '#0f1f25' -border 18 +repage "$PROC/popup_dark.png"

# --- compose branded tiles --------------------------------------------
W=1280; H=800
# A mid-teal gradient (not near-black) so a card's rounded corners reveal a
# pleasant background, never a black void.
BG1='#15454f'; BG2='#0c2f38'; INK='#0c2430'; TEAL='#16c0c0'
TXT='#eef7f8'; MUTED='#c2dadf'
FONT=Liberation-Sans; FONTB=Liberation-Sans-Bold

bg() { magick -size ${W}x${H} gradient:"$BG1"-"$BG2" \
    \( -size ${W}x${H} radial-gradient:"rgba(22,192,192,0.30)"-"rgba(22,192,192,0)" \
       -gravity East -background none -extent ${W}x${H} \) \
    -compose screen -composite -fill "$TEAL" -draw "rectangle 0,0 10,$H" "$1"; }

# card <src> <width> <radius> <border> <out> — scale, round the corners,
# then stroke a crisp 2px hairline border that follows the same radius. No
# drop shadow: on a dark/branded background a dark shadow only smears into
# black blobs at the corners.
#
# Rounding uses a black/white mask + CopyOpacity (white roundrect → opaque,
# black corners → transparent). DstIn was tried first but left opaque BLACK
# pixels in the corner triangles — visible as ugly notches against the card.
card() { local src=$1 cw=$2 r=$3 bc=$4 out=$5
  magick "$src" -resize ${cw}x \
    \( +clone -alpha off -fill black -colorize 100 \
       -fill white -draw "roundrectangle 0,0,%[fx:w-1],%[fx:h-1],$r,$r" \) \
    -alpha off -compose CopyOpacity -composite \
    -compose Over -fill none -stroke "$bc" -strokewidth 2 \
    -draw "roundrectangle 1,1,%[fx:w-2],%[fx:h-2],$r,$r" \
    "$out"; }

htext() { magick -background none -fill "$4" -font "$FONTB" -pointsize "$3" \
    -size "$2"x caption:"$5" "$1"; }
subtext() { magick -background none -fill "$4" -font "$FONT" -pointsize "$3" \
    -size "$2"x caption:"$5" "$1"; }

# textblock <out> <width> <hpt> <spt> <headline> <sub> — headline + gap + sub,
# stacked into one image so the two can never collide regardless of wrapping.
textblock() {
  local out=$1 w=$2 hpt=$3 spt=$4 head=$5 sub=$6
  htext   "$WORK/_h.png" "$w" "$hpt" "$TXT"   "$head"
  subtext "$WORK/_s.png" "$w" "$spt" "$MUTED" "$sub"
  magick -background none "$WORK/_h.png" \( -size "${w}x26" xc:none \) "$WORK/_s.png" \
    -append "$out"
}

cd "$WORK"
# 1 — popup status (text left, card right)
bg t1_bg.png
card "$PROC/popup_light.png" 460 28 '#dfe8ea' t1_card.png
textblock t1_txt.png 470 56 29 "Your status, at a glance" \
  "The toolbar turns ON AIR the moment a Meet, Teams, or Zoom call starts — and a single tap pauses everything."
magick t1_bg.png t1_txt.png -gravity West -geometry +80+0 -composite \
  t1_card.png -gravity East -geometry +120+0 -composite "$TILES/1_popup_status.png"

# 2 — options setup
bg t2_bg.png
magick "$PROC/options_light.png" -crop 2200x1480+0+0 +repage t2_src.png
card t2_src.png 760 20 '#dfe8ea' t2_card.png
htext t2_h.png 1080 46 "$TXT" "Wire up any sign, light, or webhook"
magick t2_bg.png t2_h.png -gravity North -geometry +0+48 -composite \
  t2_card.png -gravity South -geometry +0+44 -composite "$TILES/2_options_setup.png"

# 3 — options IoT (dark)
bg t3_bg.png
magick "$PROC/options_dark.png" -crop 2200x1400+0+1500 +repage t3_src.png
card t3_src.png 760 20 '#4d7a87' t3_card.png
htext t3_h.png 1120 44 "$TXT" "Local-first on your LAN, cloud when you roam"
magick t3_bg.png t3_h.png -gravity North -geometry +0+48 -composite \
  t3_card.png -gravity South -geometry +0+44 -composite "$TILES/3_options_iot.png"

# 4 — popup privacy (dark; card left, text right)
bg t4_bg.png
card "$PROC/popup_dark.png" 460 28 '#4d7a87' t4_card.png
textblock t4_txt.png 520 50 28 "Private by design, dark mode included" \
  "No telemetry. Tokens stay in local storage and never sync. Only the meeting site origin is shared — never the meeting ID, unless you opt in."
magick t4_bg.png t4_card.png -gravity West -geometry +100+0 -composite \
  t4_txt.png -gravity East -geometry +70+0 -composite "$TILES/4_popup_privacy.png"

# --- export 8-bit, 24-bit, no alpha (store-ready) ---------------------
for f in 1_popup_status 2_options_setup 3_options_iot 4_popup_privacy; do
  magick "$TILES/$f.png" -background "$INK" -alpha remove -alpha off -depth 8 -strip \
    "PNG24:$DEST/$f.png"
done

echo "Wrote store tiles to $DEST:"
identify -format "  %f  %wx%h  depth=%z  %B bytes\n" "$DEST"/*.png
