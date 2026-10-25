#!/usr/bin/env bash
# smoke_test.sh — اختبار سريع للـ API (Phase 9 — Deploy Prep)
# ============================================================
# بيختبر 10 endpoints حرجة + يقيس زمن الاستجابة.
#
# Author: برافو (Phase 9 — Deploy Prep)

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "════════════════════════════════════════════════════════════════"
echo "  🧪 Smoke Test — $(date '+%H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Endpoints to test (public ones should return 200, protected should return 401/403)
ENDPOINTS=(
    "GET|/api/health|200"
    "GET|/api/market/overview|200"
    "GET|/api/market/sectors|200"
    "GET|/api/market/top-movers|200"
    "GET|/api/portfolio|401"
    "GET|/api/notifications/priority|401"
    "GET|/api/screener/presets|200"
    "GET|/api/market/regime|200"
    "POST|/api/portfolio/create|401"
    "POST|/api/ai/ask|401"
)

PASS=0
FAIL=0

for entry in "${ENDPOINTS[@]}"; do
    IFS='|' read -r method path expected <<< "$entry"
    
    start=$(date +%s%N)
    
    if [ "$method" = "GET" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE_URL$path" 2>/dev/null || echo "000")
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X "$method" "$BASE_URL$path" 2>/dev/null || echo "000")
    fi
    
    end=$(date +%s%N)
    elapsed=$(( (end - start) / 1000000 ))
    
    if [ "$status" = "$expected" ]; then
        printf "  ✅ %-6s %-40s → %s (%dms)\n" "$method" "$path" "$status" "$elapsed"
        PASS=$((PASS + 1))
    else
        printf "  ❌ %-6s %-40s → %s (expected %s) (%dms)\n" "$method" "$path" "$status" "$expected" "$elapsed"
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
