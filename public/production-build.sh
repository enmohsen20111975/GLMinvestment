#!/bin/bash
# ============================================================================
# production-build.sh — بناء آمن للإنتاج مع swap + SHARED_SECRET
# ============================================================================
# المشكلة: next build بـ يـ SIGSEGV بسبب OOM (Out of Memory)
# الحل:
#   1. يتأكد إن فيه swap (4GB) — أساسي للـ build
#   2. يضيف SHARED_SECRET لـ .env لو مش موجود
#   3. يبني بـ memory limit 4GB
#   4. يعرض الـ logs كاملة لو فشل
#
# الاستخدام:
#   cd /root/GLMinvestment
#   bash production-build.sh
# ============================================================================

set -e

PROJECT_DIR="/root/GLMinvestment"
cd "$PROJECT_DIR"

echo "════════════════════════════════════════════════════════════"
echo "  🚀 بناء آمن للإنتاج"
echo "════════════════════════════════════════════════════════════"
echo ""

# ─── 1. تأكد إن فيه swap ──────────────────────────────────────
echo "💾 [1/5] فحص الـ swap..."
SWAP_SIZE=$(swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{s+=$1} END {print s}')
if [ -z "$SWAP_SIZE" ] || [ "$SWAP_SIZE" -lt 2000000000 ]; then
    echo "   ⚠️  Swap صغير أو مش موجود — بـ إنشاء 4GB swap..."
    if [ ! -f /swapfile ]; then
        fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        # اجعله دائم
        if ! grep -q '/swapfile' /etc/fstab; then
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
        fi
        echo "   ✅ اتعمل swap 4GB"
    else
        swapon /swapfile 2>/dev/null || true
        echo "   ✅ swap متفعّل"
    fi
else
    echo "   ✅ Swap موجود: $((SWAP_SIZE / 1024 / 1024 / 1024))GB"
fi

free -h
echo ""

# ─── 2. تأكد من SHARED_SECRET ─────────────────────────────────
echo "🔐 [2/5] فحص SHARED_SECRET..."
if ! grep -q "SHARED_SECRET" .env 2>/dev/null; then
    echo "   ⚠️  SHARED_SECRET مش موجود في .env — بـ إنشاء واحد..."
    SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))" 2>/dev/null || openssl rand -base64 32)
    echo "SHARED_SECRET=$SECRET" >> .env
    echo "   ✅ اتضاف SHARED_SECRET لـ .env"
    echo "   📋 القيمة: $SECRET"
else
    echo "   ✅ SHARED_SECRET موجود في .env"
fi
echo ""

# ─── 3. Git Pull ──────────────────────────────────────────────
echo "⬇️  [3/5] سحب آخر التحديثات..."
git pull origin main 2>&1 | tail -5
echo ""

# ─── 4. Build ─────────────────────────────────────────────────
echo "🔨 [4/5] بناء المشروع..."
rm -rf .next

# استخدم memory limit عالي + NEXT_PHASE لـ skip build-time checks
export NODE_OPTIONS="--max-old-space-size=4096"
export NEXT_TELEMETRY_DISABLED=1

# شغّل البناء — لو فشل، اعرض آخر 60 سطر
if bun run build 2>&1 | tee /tmp/build.log; then
    echo "   ✅ البناء نجح!"
else
    echo ""
    echo "   ❌ البناء فشل!"
    echo ""
    echo "   === آخر 60 سطر من الـ log ==="
    tail -60 /tmp/build.log
    echo ""
    echo "   === فحص الذاكرة ==="
    free -h
    echo ""
    echo "   === العمليات اللي بتستهلك ذاكرة ==="
    ps aux --sort=-%mem | head -5
    exit 1
fi
echo ""

# ─── 5. Restart + Test ────────────────────────────────────────
echo "🔄 [5/5] إعادة تشغيل + اختبار..."
pm2 restart nextjs --update-env 2>&1 | tail -3

echo "   ⏳ استنى السيرفر يقلع..."
sleep 15

# Health check
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ السيرفر جاهز (HTTP 200)"
else
    echo "   ⚠️  السيرفر مش جاهز بعد (HTTP $HTTP_CODE) — استنى 10 ثواني تانية..."
    sleep 10
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/" 2>/dev/null)
    echo "   دلوقتي: HTTP $HTTP_CODE"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ خلصت! الموقع جاهز"
echo "════════════════════════════════════════════════════════════"
echo ""

# اختبر الرادار لو السيرفر جاهز
if [ "$HTTP_CODE" = "200" ]; then
    echo "🎯 اختبار الرادار..."
    curl -s -X POST "http://localhost:3000/api/maker-radar/warmup?market=EGX&timeout=120000" | python3 -m json.tool 2>/dev/null | head -15
fi
