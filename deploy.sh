#!/usr/bin/env bash
# Update the site on the server: pull the latest version and rebuild dist/ (served by nginx).
set -euo pipefail
cd "$(dirname "$0")"

git pull
npm ci
npm run build
