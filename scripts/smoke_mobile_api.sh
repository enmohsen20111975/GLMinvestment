#!/usr/bin/env bash
# ============================================================================
# P41 Smoke Tests — Mobile API Package (جرس الصباح + الاستمرار + الخروج)
# ============================================================================
# بتفحّص الـ endpoints الـ 3 الجديدة للموبايل + desktop counterparts.
# الاستخدام: bash scripts/smoke_mobile_api.sh [BASE_URL]
# الافتراضي: http://localhost:3000
# ============================================================================

set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$1"; }

check() {
  local name="$1"
  local url="$2"
  local expect_key="$3"   # key expected in JSON response
  local resp_code
  local body

  printf "\n▶ %s\n" "$name"
  printf "  URL: %s\n" "$url"

  resp_code=$(curl -s -o /tmp/smoke_resp.json -w "%{http_code}" --max-time 30 "$url" 2>/dev/null || echo "000")
  body=$(cat /tmp/smoke_resp.json 2>/dev/null || echo "{}")

  if [ "$resp_code" = "000" ]; then
    red "  ✗ FAIL — لا اتصال (timeout/refused)"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ "$resp_code" != "200" ]; then
    red "  ✗ FAIL — HTTP $resp_code"
    printf "  body: %.300s\n" "$body"
    FAIL=$((FAIL + 1))
    return
  fi

  if echo "$body" | grep -q "\"$expect_key\""; then
    green "  ✓ PASS — HTTP 200 + '$expect_key' موجود"
    PASS=$((PASS + 1))
  else
    red "  ✗ FAIL — HTTP 200 بس '$expect_key' مش موجود"
    printf "  body: %.300s\n" "$body"
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================================"
echo "  P41 Mobile API Smoke Tests"
echo "  Base URL: $BASE"
echo "============================================================"

# --- 1. Mobile Morning Bell (Live) ---
check "Mobile Morning Bell" \
  "$BASE/api/mobile/morning-bell?limit=5" \
  "channel"

# --- 2. Desktop Morning Bell (Live) ---
check "Desktop Morning Bell (live=1)" \
  "$BASE/api/market/morning-bell?live=1&limit=5" \
  "channel"

# --- 3. Mobile Continuation (ticker) ---
check "Mobile Continuation (COMI)" \
  "$BASE/api/mobile/predictions/continuation?ticker=COMI" \
  "continuation"

# --- 4. Desktop Continuation ---
check "Desktop Continuation (COMI)" \
  "$BASE/api/market/continuation/COMI" \
  "continuation"

# --- 5. Mobile Exit Status ---
check "Mobile Exit Status" \
  "$BASE/api/mobile/predictions/exit-status?limit=10" \
  "summary"

# --- 6. Desktop Exit Status ---
check "Desktop Exit Status" \
  "$BASE/api/market/exit-status?limit=10" \
  "summary"

# --- 7. Morning Bell Stats (separation) ---
check "Morning Bell Stats (separation)" \
  "$BASE/api/market/morning-bell/stats" \
  "stats_separated"

echo ""
echo "============================================================"
printf "  Results: %s passed, %s failed\n" "$(green $PASS)" "$(red $FAIL)"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
