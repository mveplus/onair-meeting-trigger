#!/usr/bin/env bash
#
# Submit the Firefox package to addons.mozilla.org (listed channel). Used by
# .github/workflows/release.yml and amo-upload.yml.
#
# AMO sends a listed version to Mozilla's review by itself — there's no draft
# step. The add-on must already exist on AMO (the first version is uploaded by
# hand in the Developer Hub); this script submits later versions.
#
# Usage:  scripts/amo-submit.sh dist-firefox.zip
# Env:    AMO_JWT_ISSUER AMO_JWT_SECRET  (addons.mozilla.org → Manage API Keys)
# Result: written to $GITHUB_OUTPUT as result=submitted|skipped (when set);
#         exit 0 for both. A failed submission exits non-zero.
set -euo pipefail

ZIP="${1:?usage: amo-submit.sh <dist-firefox.zip>}"
HUB="https://addons.mozilla.org/developers/addons"

output()  { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT" || true; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY" || true; }

# No credentials yet (e.g. before the add-on is on AMO): skip, don't fail.
if [ -z "${AMO_JWT_ISSUER:-}" ] || [ -z "${AMO_JWT_SECRET:-}" ]; then
  echo "::warning::Firefox Add-ons submission skipped — AMO_JWT_ISSUER / AMO_JWT_SECRET secrets are not set."
  summary "### ⏸ Firefox Add-ons submission skipped"
  summary ""
  summary "Add the \`AMO_JWT_ISSUER\` and \`AMO_JWT_SECRET\` repository secrets (addons.mozilla.org → Tools → Manage API Keys), then run **Actions → Upload to Firefox Add-ons → Run workflow**."
  output "result=skipped"
  exit 0
fi
[ -f "$ZIP" ] || { echo "::error::$ZIP not found"; exit 1; }

SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
unzip -q "$ZIP" -d "$SRC"
VERSION="$(jq -r .version "$SRC/manifest.json")"

# --approval-timeout 0: hand the version to AMO and return; review can take
# from minutes to days and is tracked in the Developer Hub.
if ! npx --yes web-ext@8 sign \
    --source-dir "$SRC" --artifacts-dir "$SRC/.artifacts" \
    --channel listed --approval-timeout 0 \
    --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"; then
  echo "::error::Firefox Add-ons submission of $VERSION failed — see the log above."
  summary "### ✗ Firefox Add-ons submission of $VERSION failed"
  summary ""
  summary "Check the log. If this version is already on AMO, bump the version; otherwise fix the problem and run **Actions → Upload to Firefox Add-ons**."
  exit 1
fi

echo "✓ Submitted $VERSION to Firefox Add-ons — review status: $HUB"
summary "### ✓ Submitted $VERSION to Firefox Add-ons"
summary ""
summary "Mozilla reviews it automatically; follow it in the [Developer Hub]($HUB)."
output "result=submitted"
