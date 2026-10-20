#!/bin/bash
# ============================================================================
# deep_server_audit.sh — فحص شامل لكل البيانات على السرفر الإنتاجي
# ============================================================================
# المالك: enmohsen20111975
# الهدف: التحقق من تدفق البيانات الكامل + كل الأرقام في كل الشاشات
#
# شغّل على السرفر الإنتاجي:
#   cd ~/my_apps/GLMinvestment
#   git pull origin main
#   chmod +x deep_server_audit.sh
#   ./deep_server_audit.sh 2>&1 | tee deep_audit_$(date +%Y%m%d_%H%M).log
# ============================================================================

set -e
cd ~/my_apps/GLMinvestment

echo "=========================================="
echo "🔬 فحص شامل لتدفق البيانات — GLMinvestment"
echo "=========================================="
echo "التاريخ: $(date)"
echo ""

# ─── 1. فحص egksco_price_history (الجذر #1) ─────────────────────────────────
echo "📋 [1] egksco_price_history (مصدر الأسعار الكنسي لـ V40.2):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/data_engine.db')
    r = c.execute('SELECT MAX(price_date), COUNT(*) FROM egksco_price_history').fetchone()
    print(f'  آخر تاريخ: {r[0]}')
    print(f'  إجمالي الصفوف: {r[1]}')
    # آخر 5 أيام
    rows = c.execute('SELECT price_date, COUNT(DISTINCT ticker) FROM egksco_price_history GROUP BY price_date ORDER BY price_date DESC LIMIT 5').fetchall()
    print('  آخر 5 أيام:')
    for r in rows:
        print(f'    {r[0]} | {r[1]} ticker')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 2. فحص predictions.db (آخر توقعات) ────────────────────────────────────
echo "📋 [2] predictions.db (آخر توقعات):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/predictions.db')
    r = c.execute('SELECT MAX(prediction_date), COUNT(*) FROM predictions').fetchone()
    print(f'  آخر توقع: {r[0]}')
    print(f'  إجمالي التوقعات: {r[1]}')
    # آخر 10 توقعات
    rows = c.execute('''SELECT prediction_date, ticker, signal, master_score, 
                        risk_reward, who_is_buying, evidence_count
                        FROM predictions ORDER BY id DESC LIMIT 10''').fetchall()
    print(f'  آخر 10 توقعات:')
    print(f'    {\"Date\":<12} {\"Ticker\":<8} {\"Signal\":<12} {\"Score\":<6} {\"R:R\":<6} {\"Who\":<25} {\"Ev\":<4}')
    for r in rows:
        score = f'{r[3]:.0f}' if r[3] else '—'
        rr = f'{r[4]:.2f}' if r[4] else 'NULL'
        who = (r[5] or '—')[:23]
        ev = str(r[6] or 0)
        print(f'    {r[0]:<12} {r[1]:<8} {r[2]:<12} {score:<6} {rr:<6} {who:<25} {ev:<4}')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 3. فحص cron jobs ──────────────────────────────────────────────────────
echo "📋 [3] cron jobs المفعّلة:"
crontab -l 2>/dev/null | grep -E "egksco|daily_predictor|daily_price_updater|multi_market|market_regime" || echo "  ❌ لا cron jobs مفعّلة"
echo ""

# ─── 4. فحص data_engine.db (الأسعار اللحظية) ──────────────────────────────
echo "📋 [4] data_engine.db.stocks (الأسعار اللحظية):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/data_engine.db')
    r = c.execute('SELECT MAX(last_update), COUNT(*) FROM stocks').fetchone()
    print(f'  آخر تحديث: {r[0]}')
    print(f'  إجمالي الأسهم: {r[1]}')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 5. فحص stocks.db (radar_signal_tracking) ──────────────────────────────
echo "📋 [5] radar_signal_tracking (تتبع إشارات الرادار):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/stocks.db')
    r = c.execute('SELECT MAX(signal_date), COUNT(*) FROM radar_signal_tracking').fetchone()
    print(f'  آخر إشارة: {r[0]}')
    print(f'  إجمالي الإشارات: {r[1]}')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 6. فحص market_indices (مؤشرات السوق) ──────────────────────────────────
echo "📋 [6] market_indices (EGX30/100/33):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/stocks.db')
    rows = c.execute('SELECT symbol, last_update FROM market_indices LIMIT 5').fetchall()
    for r in rows:
        print(f'  {r[0]}: {r[1]}')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 7. فحص system_settings (v402_min_evidence_count) ──────────────────────
echo "📋 [7] system_settings (V40.2 thresholds):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/stocks.db')
    rows = c.execute(\"SELECT key, value FROM system_settings WHERE key LIKE 'v402%'\").fetchall()
    if rows:
        for r in rows:
            print(f'  {r[0]} = {r[1]}')
    else:
        print('  ⚠️ لا توجد V40.2 settings في system_settings')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 8. فحص آخر logs لـ daily_predictor ────────────────────────────────────
echo "📋 [8] آخر logs لـ daily_predictor:"
for f in /tmp/v40_2_morning.log /tmp/v40_2_evening.log /tmp/daily_predictor.log; do
    if [ -f "$f" ]; then
        echo "  --- $f (آخر 5 سطور) ---"
        tail -5 "$f" 2>/dev/null
    fi
done
echo ""

# ─── 9. فحص PM2 services ───────────────────────────────────────────────────
echo "📋 [9] PM2 services:"
pm2 list 2>/dev/null | head -20 || echo "  ❌ PM2 غير مثبت"
echo ""

# ─── 10. اختبار API endpoints ─────────────────────────────────────────────
echo "📋 [10] اختبار API endpoints (localhost:8010):"
python3 -c "
import urllib.request, json
endpoints = [
    ('/api/health', 'Python backend health'),
    ('/api/predictions/honest-tracking/list?market=EGX&limit=5', 'honest-tracking'),
    ('/api/market/regime?market=EGX', 'market regime'),
    ('/api/stocks/PHDC/unified', 'unified API (PHDC)'),
]
for path, name in endpoints:
    try:
        r = urllib.request.urlopen(f'http://127.0.0.1:8010{path}', timeout=5)
        print(f'  ✅ {name}: HTTP {r.status}')
    except Exception as e:
        print(f'  ❌ {name}: {str(e)[:80]}')
"
echo ""

# ─── 11. التشخيص النهائي ──────────────────────────────────────────────────
echo "📋 [11] التشخيص النهائي:"
python3 -c "
import sqlite3, os

# تحقق من egksco_price_history freshness
c = sqlite3.connect('db/data_engine.db')
r = c.execute('SELECT MAX(price_date) FROM egksco_price_history').fetchone()
last_egksco = r[0] if r else None
c.close()

# تحقق من predictions freshness
c = sqlite3.connect('db/predictions.db')
r = c.execute('SELECT MAX(prediction_date) FROM predictions').fetchone()
last_pred = r[0] if r else None
c.close()

import datetime
today = datetime.date.today().isoformat()

print(f'  آخر egksco_price_history: {last_egksco}')
print(f'  آخر prediction: {last_pred}')
print(f'  اليوم: {today}')
print()
if last_egksco and last_egksco < today:
    print(f'  ❌ مشكلة: egksco_price_history قديمة ({today - last_egksco} أيام)')
    print(f'     السبب: vps-service/data/egksco_scraper.py مش مجدول في cron')
    print(f'     الإصلاح: أضف cron job لـ egksco_scraper.py')
else:
    print(f'  ✅ egksco_price_history محدّثة')

if last_pred and last_pred < today:
    print(f'  ⚠️ predictions.db قديمة (آخر: {last_pred})')
else:
    print(f'  ✅ predictions.db محدّثة')
"
echo ""

echo "=========================================="
echo "✅ اكتمل الفحص — أرسل النتائج للمالك"
echo "=========================================="
