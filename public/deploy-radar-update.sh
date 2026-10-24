#!/bin/bash
# ============================================================================
# deploy-radar-update.sh — ينشر تحديثات الرادار على الإنتاج (بـ build)
# ============================================================================
# المشكلة: production بيستخدم `next start` اللي محتاج .next build folder.
#          بعد git pull، الكود الجديد محتاج rebuild.
#
# السكريبت ده بيعمل:
#   1. git pull (يجيب آخر التحديثات من GitHub)
#   2. bun run build (يبني الـ .next folder — أساسي لـ next start)
#   3. pm2 restart nextjs (يعيد تشغيل السيرفر بالكود الجديد)
#   4. ينتظر السيرفر يكون جاهز (health check)
#   5. أول warmup للرادار
#   6. يعرض الـ logs لو فيه مشكلة
#
# الاستخدام:
#   cd /root/GLMinvestment
#   bash deploy-radar-update.sh
# ============================================================================

set -e

PROJECT_DIR="/root/GLMinvestment"
cd "$PROJECT_DIR"

echo "════════════════════════════════════════════════════════════"
echo "  🚀 نشر تحديثات رادار الميكرز على الإنتاج"
echo "════════════════════════════════════════════════════════════"
echo ""

# ─── 1. Git Pull ───────────────────────────────────────────────
echo "⬇️  [1/6] سحب آخر التحديثات من GitHub..."
git pull origin main 2>&1 | tail -10
echo ""

# ─── 2. Build ─────────────────────────────────────────────────
echo "🔨 [2/6] بناء المشروع (next build)..."
echo "   ⏳ ده بياخد 2-5 دقايق على الإنتاج..."
echo ""

# استخدم bun لو موجود، غير كده npm
if command -v bun &> /dev/null; then
    echo "   بـاستخدام bun..."
    bun run build 2>&1 | tail -30
elif command -v npm &> /dev/null; then
    echo "   بـاستخدام npm..."
    npm run build 2>&1 | tail -30
else
    echo "   بـاستخدام npx next build..."
    npx next build 2>&1 | tail -30
fi

BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
    echo ""
    echo "❌ فشل البناء! اتحدّك في الـ logs:"
    echo "   pm2 logs nextjs --lines 50"
    exit 1
fi

echo ""
echo "   ✅ البناء خلص بنجاح"
echo ""

# ─── 3. Restart Next.js ───────────────────────────────────────
echo "🔄 [3/6] إعادة تشغيل Next.js..."
pm2 restart nextjs --update-env 2>&1 | tail -5
echo ""

# ─── 4. Health Check (انتظر السيرفر يكون جاهز) ────────────────
echo "⏳ [4/6] انتظار السيرفر يكون جاهز..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/" 2>/dev/null | grep -qE "^(200|307|302)$"; then
        echo "   ✅ السيرفر جاهز بعد ${WAITED}s"
        break
    fi
    printf "."
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo ""
    echo "   ❌ السيرفر مش بـ يستجيب بعد ${MAX_WAIT}s"
    echo "   📋 آخر 30 سطر من الـ logs:"
    pm2 logs nextjs --nostream --lines 30 2>&1 | tail -30
    exit 1
fi

echo ""

# ─── 5. أول Warmup للرادار ────────────────────────────────────
echo "🎯 [5/6] تشغيل أول warmup للرادار..."
echo "   ⏳ بياخد 1-10 ثواني على الإنتاج (DB = 1.8GB)..."
WARMUP_RESULT=$(curl -s --max-time 120 -X POST "http://localhost:3000/api/maker-radar/warmup?market=EGX&timeout=90000" 2>/dev/null || echo "FAILED")

if echo "$WARMUP_RESULT" | grep -q '"success":true'; then
    DURATION=$(echo "$WARMUP_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status']['last_warmup_duration_ms'])" 2>/dev/null || echo "?")
    SCANNED=$(echo "$WARMUP_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('cache_total_scanned','?'))" 2>/dev/null || echo "?")
    DB_SOURCE=$(echo "$WARMUP_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'].get('db_source','?'))" 2>/dev/null || echo "?")
    echo "   ✅ الرادار جاهز!"
    echo "      • المدة: ${DURATION}ms"
    echo "      • الأسهم المفحوصة: $SCANNED"
    echo "      • قاعدة البيانات: $DB_SOURCE"
else
    echo "   ⚠️  الـ warmup فشل أو لسه بـ يشتغل"
    echo "   استخدم: curl -X POST 'http://localhost:3000/api/maker-radar/warmup?market=EGX'"
fi
echo ""

# ─── 6. اختبار الـ API ────────────────────────────────────────
echo "🧪 [6/6] اختبار الـ API..."
API_RESULT=$(curl -s --max-time 10 "http://localhost:3000/api/maker-radar?market=EGX" 2>/dev/null || echo "FAILED")
if echo "$API_RESULT" | grep -q '"success":true'; then
    CACHE_AGE=$(echo "$API_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('cache_age_seconds','?'))" 2>/dev/null || echo "?")
    UNDER_MICRO=$(echo "$API_RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('under_microscope_count','?'))" 2>/dev/null || echo "?")
    echo "   ✅ الـ API شغال!"
    echo "      • cache_age: ${CACHE_AGE}s"
    echo "      • تحت الميكروسكوب: $UNDER_MICRO سهم"
else
    echo "   ⚠️  الـ API مش بـ يرجع بيانات"
    echo "$API_RESULT" | head -5
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ النشر خلص! افتح الموقع في المتصفح"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📋 الخطوة الأخيرة — أضف الـ cron jobs:"
echo "   crontab -e"
echo "   ثم أضف:"
echo "   PATH=/root/GLMinvestment/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo "   */5 10-14 * * 1-5 curl -s -X POST 'http://localhost:3000/api/maker-radar/warmup?market=EGX' >> /tmp/radar-cron.log 2>&1"
echo "   30 14 * * 1-5 curl -s -X POST 'http://localhost:3000/api/predictions/refresh-v40?mode=today' >> /tmp/v40-cron.log 2>&1"
echo ""
echo "🔍 لو فيه مشكلة، شوف الـ logs:"
echo "   pm2 logs nextjs --lines 50"
echo ""
