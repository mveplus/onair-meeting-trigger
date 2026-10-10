#!/usr/bin/env bash
#
# Upload a ZIP to the Chrome Web Store as a draft (Chrome Web Store API v2).
# Used by .github/workflows/release.yml and cws-upload.yml.
#
# Before uploading it asks the store for the item's status: while a previous
# submission is still in review (PENDING_REVIEW) or approved but not yet
# published (STAGED) the store refuses uploads (ITEM_NOT_UPDATABLE), so the
# script stops and reports "blocked" instead of failing mid-upload.
#
# Usage:  scripts/cws-upload.sh dist.zip
# Env:    CLIENT_ID CLIENT_SECRET REFRESH_TOKEN  (OAuth, chromewebstore scope)
#         PUBLISHER_ID EXTENSION_ID
# Result: written to $GITHUB_OUTPUT as result=uploaded|blocked (when set);
#         exit 0 for both. Any other problem exits non-zero.
set -euo pipefail

ZIP="${1:?usage: cws-upload.sh <zip>}"
API="https://chromewebstore.googleapis.com"
CONSOLE="https://chrome.google.com/webstore/devconsole"

for v in CLIENT_ID CLIENT_SECRET REFRESH_TOKEN PUBLISHER_ID EXTENSION_ID; do
  if [ -z "${!v:-}" ]; then
    echo "::error::$v is not set — add the CWS_$v repository secret."
    exit 1
  fi
done
[ -f "$ZIP" ] || { echo "::error::$ZIP not found"; exit 1; }

ITEM="publishers/$PUBLISHER_ID/items/$EXTENSION_ID"

output()  { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT" || true; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY" || true; }

# 1) Exchange the refresh token for a short-lived access token.
TOKEN="$(curl -fsS https://oauth2.googleapis.com/token \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" \
  -d refresh_token="$REFRESH_TOKEN" -d grant_type=refresh_token \
  | jq -r '.access_token // empty')"
if [ -z "$TOKEN" ]; then
  echo "::error::Google OAuth returned no access token — check CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN."
  exit 1
fi

fetch_status() {
  curl -sS --fail-with-body -H "Authorization: Bearer $TOKEN" "$API/v2/$ITEM:fetchStatus"
}

# 2) Is the store accepting a new upload?
STATUS="$(fetch_status)"
SUBMITTED="$(jq -r '.submittedItemRevisionStatus.state // "NONE"' <<<"$STATUS")"
PUBLISHED="$(jq -r '.publishedItemRevisionStatus.state // "NONE"' <<<"$STATUS")"
TAKEN_DOWN="$(jq -r '.takenDown // false' <<<"$STATUS")"
echo "Store status: submitted=$SUBMITTED published=$PUBLISHED takenDown=$TAKEN_DOWN"

if [ "$TAKEN_DOWN" = "true" ]; then
  echo "::error::The item is taken down in the Chrome Web Store — see $CONSOLE"
  exit 1
fi

case "$SUBMITTED" in
  PENDING_REVIEW|STAGED)
    if [ "$SUBMITTED" = "PENDING_REVIEW" ]; then
      why="the previous submission is still in review"
      todo="wait for the review to finish (or cancel it in the developer console)"
    else
      why="the previous submission is approved but not yet published"
      todo="publish it in the developer console"
    fi
    echo "::warning::Chrome Web Store upload skipped — $why."
    summary "### ⏸ Chrome Web Store upload skipped"
    summary ""
    summary "The store isn't accepting uploads: $why (\`$SUBMITTED\`)."
    summary ""
    summary "1. In the [developer console]($CONSOLE), $todo."
    summary "2. Then run **Actions → Upload to Chrome Web Store → Run workflow** with this tag."
    output "result=blocked"
    exit 0
    ;;
esac

# 3) Upload. Processing can be asynchronous — poll until it settles.
RESP="$(curl -sS --fail-with-body -X POST -H "Authorization: Bearer $TOKEN" \
  -T "$ZIP" "$API/upload/v2/$ITEM:upload")"
echo "$RESP"
STATE="$(jq -r '.uploadState // empty' <<<"$RESP")"

for _ in $(seq 1 24); do
  [ "$STATE" = "UPLOAD_IN_PROGRESS" ] || break
  sleep 5
  STATE="$(fetch_status | jq -r '.lastAsyncUploadState // empty')"
  echo "Upload state: $STATE"
done

if [ "$STATE" != "SUCCEEDED" ]; then
  echo "::error::Chrome Web Store upload ended with uploadState=${STATE:-unknown}"
  exit 1
fi

VERSION="$(jq -r '.crxVersion // empty' <<<"$RESP")"
echo "✓ Uploaded ${VERSION:-the new version} as a draft — submit it for review at $CONSOLE"
summary "### ✓ Uploaded to the Chrome Web Store as a draft"
summary ""
summary "Open the [developer console]($CONSOLE), check the listing and click **Submit for review**."
output "result=uploaded"
