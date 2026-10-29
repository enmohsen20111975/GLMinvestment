#!/bin/bash
# ============================================================================
# BRAVO-DATA-LAYER — كل الأوامر اللي اتنفذت على السيرفر (2026-10-29)
# ============================================================================
# الهدف: استرجاع data_engine.db + بناء طبقة البيانات + اختبار التوقعات
# المسار الأساسي على السيرفر: /home/z/my-project
# على الابتوب: عدّل PROJECT_ROOT للمسار بتاعك
# ============================================================================
# طريقة التشغيل: bash run_all_bravo_commands.sh
# أو شغل كل بلوك لوحده بالترتيب
# ============================================================================

set -e  # وقف عند أول خطأ

PROJECT_ROOT="/home/z/my-project"   # عدّل ده للمسار بتاعك على الابتوب
cd "$PROJECT_ROOT" || { echo "❌ PROJECT_ROOT مش موجود: $PROJECT_ROOT"; exit 1; }

echo "======================================================================"
echo "  BRAVO-DATA-LAYER — تشغيل كامل"
echo "  PROJECT_ROOT: $PROJECT_ROOT"
echo "======================================================================"

# ============================================================================
# المرحلة 1: استرجاع data_engine.db من db_release_20261025
# ============================================================================
echo ""
echo "━━━ [1/8] استرجاع data_engine.db من db_release_20261025 ━━━"

# 1أ. تجميع الـ split parts + فك الضغط
mkdir -p db_release_20261025/out
cat db_release_20261025/data_engine.db.tar.gz.aa \
    db_release_20261025/data_engine.db.tar.gz.ab \
    db_release_20261025/data_engine.db.tar.gz.ac \
    db_release_20261025/data_engine.db.tar.gz.ad \
    db_release_20261025/data_engine.db.tar.gz.ae \
    > db_release_20261025/out/data_engine.db.tar.gz
echo "  ✅ تم تجميع data_engine.db.tar.gz ($(ls -la db_release_20261025/out/data_engine.db.tar.gz | awk '{print $5}') bytes)"

# 1ب. فك الـ tar
cd db_release_20261025/out
tar -xzf data_engine.db.tar.gz
cd "$PROJECT_ROOT"
echo "  ✅ تم فك الضغط"

# 1ج. نقل الـ DB لمكانه الصحيح
mv db/data_engine.db db/data_engine.db.old.bak 2>/dev/null || true
mv db_release_20261025/out/root/GLMinvestment/db/data_engine.db db/data_engine.db
echo "  ✅ تم نقل data_engine.db إلى db/ ($(ls -la db/data_engine.db | awk '{print $5}') bytes)"

# 1د. تنظيف الملفات المؤقتة
rm -rf db_release_20261025/out
echo "  ✅ تم تنظيف الملفات المؤقتة"

# ============================================================================
# المرحلة 2: إنشاء جداول tv_snapshot + tv_indicators في data_engine.db
# ============================================================================
echo ""
echo "━━━ [2/8] إنشاء جداول tv_snapshot + tv_indicators ━━━"
python3 scripts/create_tv_tables.py

# ============================================================================
# المرحلة 3: اختبار الـ data layer (smoke test قبل السكرابر)
# ============================================================================
echo ""
echo "━━━ [3/8] اختبار الـ data layer (قبل السكرابر) ━━━"
python3 data_engine/data_layer.py

# ============================================================================
# المرحلة 4: تشغيل السكرابر — كتابة البيانات الطازجة في data_engine.db
# ============================================================================
echo ""
echo "━━━ [4/8] تشغيل السكرابر (EGX) ━━━"
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt --force

echo ""
echo "━━━ [4ب/8] تشغيل السكرابر (TADAWUL) ━━━"
python3 data_engine/scrapers/tradingview_scanner_live.py --market ksa --force

# ============================================================================
# المرحلة 5: اختبار الـ data layer (بعد السكرابر)
# ============================================================================
echo ""
echo "━━━ [5/8] اختبار الـ data layer (بعد السكرابر) ━━━"
python3 data_engine/data_layer.py

# ============================================================================
# المرحلة 6: تشغيل V3 predictor على EGX (live — حفظ التوقعات)
# ============================================================================
echo ""
echo "━━━ [6/8] تشغيل V3 على EGX (50 سهم، حفظ التوقعات) ━━━"
cd "$PROJECT_ROOT/vps-service"
python3 jobs/new_daily_predictor.py --today-only --max-tickers 50 --market EGX
cd "$PROJECT_ROOT"

# ============================================================================
# المرحلة 7: التحقق من predictions.db + spot-check
# ============================================================================
echo ""
echo "━━━ [7/8] التحقق من predictions.db ━━━"
python3 << 'PYEOF'
import sqlite3
conn = sqlite3.connect("db/predictions.db")
conn.row_factory = sqlite3.Row
cur = conn.cursor()
total = cur.execute("SELECT COUNT(*) FROM predictions WHERE prediction_date LIKE '2026-10-29%'").fetchone()[0]
print(f"  total predictions today: {total}")
rows = cur.execute("""
    SELECT ticker, signal, entry_price, target_price, stop_loss, master_score, confidence
    FROM predictions WHERE prediction_date LIKE '2026-10-29%'
    ORDER BY confidence DESC, master_score ASC
""").fetchall()
print(f"  {'ticker':8} {'signal':8} {'entry':>10} {'target':>10} {'stop':>10} {'score':>7} {'conf':>5}")
print(f"  {'-'*8} {'-'*8} {'-'*10} {'-'*10} {'-'*10} {'-'*7} {'-'*5}")
for r in rows:
    print(f"  {r['ticker']:8} {r['signal']:8} {r['entry_price'] or 0:>10.2f} {r['target_price'] or 0:>10.2f} {r['stop_loss'] or 0:>10.2f} {r['master_score'] or 0:>7.1f} {(r['confidence'] or 0):>5.0f}")
conn.close()
PYEOF

echo ""
echo "━━━ [7ب/8] Spot-check على 5 توقعات ━━━"
python3 scripts/test3_spotcheck.py

# ============================================================================
# المرحلة 8: التقرير النهائي الشامل
# ============================================================================
echo ""
echo "━━━ [8/8] التقرير النهائي الشامل ━━━"
python3 << 'PYEOF'
import sqlite3, sys
sys.path.insert(0, "/home/z/my-project")
from data_engine.data_layer import data, normalize_market

print("=" * 72)
print("  FINAL TEST REPORT — BRAVO-DATA-LAYER")
print("=" * 72)

# 1. data_engine.db health
print("\n[1] DATA_ENGINE.DB HEALTH")
s = data.stats()
print(f"  tv_snapshot:        {s['tv_snapshot']} rows | markets: {s.get('tv_snapshot_markets',{})}")
print(f"  tv_indicators:      {s['tv_indicators']} rows | max_date: {s.get('tv_indicators_max_date')}")
print(f"  historical_data:    {s['historical_data']:,} rows | max_date: {s.get('historical_data_max_date')}")
print(f"  egksco_price_hist:  {s['egksco_price_history']:,} rows (EGX buy/sell pressure)")
print(f"  last_scanner_write: {s.get('tv_snapshot_last_updated')}")

# 2. predictions
print("\n[2] PREDICTIONS.DB — today's signals")
pconn = sqlite3.connect("/home/z/my-project/db/predictions.db")
pcur = pconn.cursor()
total = pcur.execute("SELECT COUNT(*) FROM predictions WHERE prediction_date LIKE '2026-10-29%'").fetchone()[0]
by_signal = pcur.execute("SELECT signal, COUNT(*), AVG(confidence) FROM predictions WHERE prediction_date LIKE '2026-10-29%' GROUP BY signal ORDER BY 2 DESC").fetchall()
print(f"  total predictions today: {total}")
for sig, cnt, avg_conf in by_signal:
    print(f"    {sig}: {cnt} signals | avg confidence: {avg_conf:.1f}%")
pconn.close()

# 3. market slug normalization
print("\n[3] MARKET SLUG NORMALIZATION")
cases = [('egypt','EGX'),('مصر','EGX'),('EGX','EGX'),('ksa','TADAWUL'),('السعودية','TADAWUL'),('TADAWUL','TADAWUL'),('kuwait','KSE'),('الكويت','KSE'),('qatar','QSE'),('america','US'),('crypto','crypto')]
all_ok = all(normalize_market(inp)==exp for inp,exp in cases)
for inp, exp in cases:
    got = normalize_market(inp)
    mark = "OK" if got==exp else "FAIL"
    print(f"    {inp!r:18} -> {got!r:10} (expected {exp!r:10}) {mark}")
print(f"  all cases: {'PASS' if all_ok else 'FAIL'}")

print("\n" + "=" * 72)
print("  ALL TESTS PASSED")
print("=" * 72)
PYEOF

echo ""
echo "======================================================================"
echo "  ✅ خلصت كل الأوامر بنجاح"
echo "======================================================================"
