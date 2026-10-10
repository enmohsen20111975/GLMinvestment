#!/bin/bash
# ============================================================================
# fix_cron_paths.sh — إصلاح cron jobs (مسار خاطئ + ناقصة)
# ============================================================================
# المشكلة: cron jobs تشير إلى /root/GLMinvestment/ بدل /home/meme/my_apps/GLMinvestment/
# + ناقصة: daily_predictor, egksco_scraper, maker_radar, intraday_scanner
#
# شغّل على السرفر الإنتاجي:
#   cd ~/my_apps/GLMinvestment
#   git pull origin main
#   chmod +x fix_cron_paths.sh
#   ./fix_cron_paths.sh
# ============================================================================

PROJECT_ROOT="${PROJECT_ROOT:-$HOME/my_apps/GLMinvestment}"
PYTHON="$PROJECT_ROOT/.venv/bin/python"
LOG_DIR="$PROJECT_ROOT/logs"

# UNIFY-FIX: اكتشاف المسار الصحيح تلقائيًا
if [ ! -d "$PROJECT_ROOT" ]; then
  # جرب المسارات المحتملة حسب الأولوية
  for path in "/root/GLMinvestment" "$HOME/my_apps/GLMinvestment" "/root/my_apps/GLMinvestment"; do
    if [ -d "$path" ]; then
      PROJECT_ROOT="$path"
      break
    fi
  done
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
  LOG_DIR="$PROJECT_ROOT/logs"
fi

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "🔧 إصلاح cron jobs — GLMinvestment"
echo "=========================================="
echo "Project root: $PROJECT_ROOT"
echo "Python: $PYTHON"
echo ""

# ─── قراءة crontab الحالي ────────────────────────────────────────────────────
CURRENT_CRON=$(crontab -l 2>/dev/null || echo "")

# ─── استبدال المسار الخاطئ ──────────────────────────────────────────────────
# /root/GLMinvestment → $PROJECT_ROOT
FIXED_CRON=$(echo "$CURRENT_CRON" | sed "s|/root/GLMinvestment|$PROJECT_ROOT|g")

echo "📋 [1] إصلاح المسارات الخاطئة:"
echo "  قبل: /root/GLMinvestment"
echo "  بعد: $PROJECT_ROOT"
CHANGED=$(echo "$CURRENT_CRON" | grep -c "/root/GLMinvestment" 2>/dev/null || echo 0)
echo "  عدد السطور المُصلحة: $CHANGED"
echo ""

# ─── إضافة cron jobs الناقصة ────────────────────────────────────────────────
echo "📋 [2] إضافة cron jobs الناقصة:"

# 1. daily_predictor.py — V40.2 (صباحي + مسائي)
if ! echo "$FIXED_CRON" | grep -q "daily_predictor"; then
    FIXED_CRON="$FIXED_CRON

# GLMinvestment — V40.2 daily predictor (UNIFY-FIX 2026-10-08)
# صباحي: 03:00 UTC = 05:00 Cairo (قبل افتتاح السوق)
0 3 * * 0-4 cd $PROJECT_ROOT && $PYTHON vps-service/jobs/daily_predictor.py --today-only --max-picks 5 >> $LOG_DIR/daily_predictor_morning.log 2>&1
# مسائي: 13:30 UTC = 15:30 Cairo (بعد الإغلاق — deep analysis)
30 13 * * 0-4 cd $PROJECT_ROOT && $PYTHON vps-service/jobs/daily_predictor.py --yesterday-only --max-picks 10 >> $LOG_DIR/daily_predictor_evening.log 2>&1"
    echo "  ✅ daily_predictor.py (صباحي 03:00 + مسائي 13:30 UTC)"
else
    echo "  ⚠️ daily_predictor.py موجود بالفعل"
fi

# 2. maker_radar.py — رادار السيولة (كل 5 دقايق أثناء الجلسة)
if ! echo "$FIXED_CRON" | grep -q "maker_radar"; then
    FIXED_CRON="$FIXED_CRON
# رادار السيولة — كل 5 دقايق أثناء جلسة EGX (08:00-14:00 UTC)
*/5 8-14 * * 0-4 cd $PROJECT_ROOT && $PYTHON scripts/maker_radar.py --market EGX --min-quiet-signals 5 --min-price 1.0 --json-only >> $LOG_DIR/maker_radar.log 2>&1"
    echo "  ✅ maker_radar.py (كل 5 دقايق 08:00-14:00 UTC)"
else
    echo "  ⚠️ maker_radar.py موجود بالفعل"
fi

# 3. intraday_scanner.py (كل 5 دقايق أثناء الجلسة)
if ! echo "$FIXED_CRON" | grep -q "intraday_scanner"; then
    FIXED_CRON="$FIXED_CRON
# intraday scanner — كل 5 دقايق أثناء جلسة EGX
*/5 8-12 * * 0-4 cd $PROJECT_ROOT && $PYTHON vps-service/jobs/intraday_scanner.py >> $LOG_DIR/intraday_scanner.log 2>&1"
    echo "  ✅ intraday_scanner.py (كل 5 دقايق 08:00-12:00 UTC)"
else
    echo "  ⚠️ intraday_scanner.py موجود بالفعل"
fi

# 4. market_regime_engine.py (يومي قبل daily_predictor)
if ! echo "$FIXED_CRON" | grep -q "market_regime_engine"; then
    FIXED_CRON="$FIXED_CRON
# market regime engine — يومي قبل daily_predictor
50 2 * * 0-4 cd $PROJECT_ROOT && $PYTHON vps-service/analyzers/market_regime_engine.py >> $LOG_DIR/market_regime.log 2>&1"
    echo "  ✅ market_regime_engine.py (02:50 UTC يومي)"
else
    echo "  ⚠️ market_regime_engine.py موجود بالفعل"
fi

echo ""

# ─── تطبيق الـ crontab الجديد ────────────────────────────────────────────────
echo "📋 [3] تطبيق crontab الجديد..."
echo "$FIXED_CRON" | crontab -
if [ $? -eq 0 ]; then
    echo "  ✅ تم تطبيق crontab بنجاح"
else
    echo "  ❌ فشل تطبيق crontab"
    exit 1
fi

echo ""
echo "📋 [4] crontab النهائي:"
crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$"

echo ""
echo "=========================================="
echo "✅ اكتمل إصلاح cron jobs"
echo "=========================================="
echo ""
echo "⚠️ مهم: أعد تشغيل PM2 لسحب إصلاحات الكود:"
echo "  pm2 restart all"
echo ""
echo "ثم شغّل daily_predictor يدويًا للتحقق:"
echo "  cd $PROJECT_ROOT"
echo "  $PYTHON vps-service/jobs/daily_predictor.py --today-only --max-picks 5"

# UNIFY-FIX (2026-10-08): إضافة cron jobs للمصادر الجديدة
# market_indices (يومي قبل daily_predictor)
if ! crontab -l 2>/dev/null | grep -q "update_market_indices"; then
    (crontab -l 2>/dev/null; echo "# market_indices — يومي قبل daily_predictor
45 2 * * 0-4 cd $PROJECT_ROOT && $PYTHON vps-service/scripts/update_market_indices.py >> $LOG_DIR/market_indices.log 2>&1") | crontab -
    echo "  ✅ market_indices cron added"
fi

# metals + forex (كل 15 دقيقة)
if ! crontab -l 2>/dev/null | grep -q "update_metals_and_forex"; then
    (crontab -l 2>/dev/null; echo "# metals + forex — كل 15 دقيقة
*/15 * * * * cd $PROJECT_ROOT && $PYTHON vps-service/scripts/update_metals_and_forex.py >> $LOG_DIR/metals_forex.log 2>&1") | crontab -
    echo "  ✅ metals_forex cron added"
fi

# fundamentals (أسبوعي)
if ! crontab -l 2>/dev/null | grep -q "update_fundamentals"; then
    (crontab -l 2>/dev/null; echo "# fundamentals — أسبوعي (السبت)
0 14 * * 6 cd $PROJECT_ROOT && $PYTHON -m data_engine.scrapers.update_fundamentals >> $LOG_DIR/fundamentals.log 2>&1") | crontab -
    echo "  ✅ fundamentals cron added"
fi
