#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f dist.zip
( cd extension && zip -r ../dist.zip . -x "*.DS_Store" )
echo "Built: dist.zip"
