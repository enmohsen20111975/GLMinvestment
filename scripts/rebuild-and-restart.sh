#!/usr/bin/env bash
# Production build + restart for the Next.js server, as one atomic sequence.
#
# WHY THIS EXISTS (2026-10-04):
#   `next build` rewrites .next in place. Running it while `next start` is
#   serving traffic deletes route chunks out from under the live server, which
#   made every API route fail at once with:
#     Error: Cannot find module '.next/server/app/api/.../route.js'
#   and 500s in the browser console (sharia, maker-radar/*, /news 404).
#   The build only ends up correct if the server is restarted afterwards, so
#   build and restart must never be run as separate manual steps.
#
# Usage: bash scripts/rebuild-and-restart.sh
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."
PROJECT_DIR="$PWD"

echo "==> Rebuilding production bundle"
bun run build

echo "==> Restarting nextjs"
pm2 restart nextjs --update-env

# Give the server a moment to bind before probing it.
sleep 6

fail=0
check() {
  local label="$1" path="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000${path}")
  printf '%-42s %s\n' "$label" "$code"
  case "$code" in
    200|301|302) ;;
    *) fail=1 ;;
  esac
}

echo "==> Verifying"
check "home"                       "/"
check "sharia symbol"              "/api/sharia?symbol=COMI"
check "sharia list"                "/api/sharia?limit=5"
check "maker-radar signal-tracker" "/api/maker-radar/signal-tracker?days=30"
check "maker-radar sector-treemap" "/api/maker-radar/sector-treemap?days=30"
check "maker-radar stock"          "/api/maker-radar/stock?ticker=COMI&days=30"

if [ "$fail" -ne 0 ]; then
  echo "!! Some endpoints did not return 200 — check: pm2 logs nextjs --lines 100"
  exit 1
fi

echo "==> Build live and healthy (BUILD_ID: $(cat "$PROJECT_DIR/.next/BUILD_ID"))"