#!/bin/bash
# ============================================================================
# radar_server_commands.sh — أوامر تشغيل رادار السيولة على السرفر الإنتاجي
# ============================================================================
# المالك: enmohsen20111975
# الهدف: تشغيل maker_radar.py + جلب النتائج الكاملة لفهم حالة الرادار
#
# ⚠️ شغّل هذا على السرفر الإنتاجي (VPS) حيث DBs EGX حقيقية موجودة.
# هذا السكربت للقراءة + التشغيل اليدوي — لا يُرفع على GitHub.
#
# الاستخدام:
#   chmod +x radar_server_commands.sh
#   ./radar_server_commands.sh
# ============================================================================

set -e

echo "=========================================="
echo "🔬 رادار السيولة — أوامر السرفر"
echo "=========================================="
echo ""

# ─── 1. فحص البيئة ─────────────────────────────────────────────────────────
echo "📋 [1] فحص البيئة:"
echo "  Python: $(python3 --version 2>&1)"
echo "  Project root: $(pwd)"
echo "  DBs present:"
ls -lh db/*.db 2>/dev/null | awk '{print "    " $9 " (" $5 ")"}' || echo "    ❌ لا توجد DBs"
echo ""

# ─── 2. فحص جدول radar_signal_tracking ─────────────────────────────────────
echo "📋 [2] فحص جدول radar_signal_tracking:"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/stocks.db')
    count = c.execute('SELECT COUNT(*) FROM radar_signal_tracking').fetchone()[0]
    print(f'  ✅ جدول radar_signal_tracking موجود — {count} سجل')
    # آخر 5 إشارات
    rows = c.execute('SELECT ticker, signal_date, signal_type, entry_price, status FROM radar_signal_tracking ORDER BY signal_date DESC LIMIT 5').fetchall()
    if rows:
        print('  آخر 5 إشارات:')
        for r in rows:
            print(f'    {r[1]} | {r[0]} | {r[2]} | entry={r[3]} | {r[4]}')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 3. فحص توقعات V40.2 الأخيرة ───────────────────────────────────────────
echo "📋 [3] آخر توقعات V40.2 (آخر 5 أيام):"
python3 -c "
import sqlite3, json
try:
    c = sqlite3.connect('db/predictions.db')
    rows = c.execute('''
        SELECT ticker, prediction_date, signal, entry_price, target_price, stop_loss,
               risk_reward, master_score, confidence, analysis_json
        FROM predictions
        WHERE market IN ('EGX', 'مصر') AND prediction_date >= date('now', '-5 days')
        ORDER BY prediction_date DESC LIMIT 10
    ''').fetchall()
    if rows:
        print(f'  ✅ {len(rows)} توقع حديث:')
        for r in rows:
            analysis = json.loads(r[9]) if r[9] else {}
            who = analysis.get('who_is_buying', '—')
            print(f'    {r[1]} | {r[0]} | signal={r[2]} | score={r[7]} | R:R={r[6]}')
            print(f'      entry={r[3]} | target={r[4]} | stop={r[5]}')
            print(f'      who_is_buying: {who}')
    else:
        print('  ⚠️ لا توجد توقعات حديثة (آخر 5 أيام)')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

# ─── 4. تشغيل maker_radar.py (الرادار الكامل) ──────────────────────────────
echo "📋 [4] تشغيل maker_radar.py (الرادار الكامل لـ EGX):"
echo "  ⏳ جارٍ التشغيل (قد يستغرق 30-120 ثانية)..."

if [ -f "scripts/maker_radar.py" ]; then
    python3 scripts/maker_radar.py --market EGX --min-quiet-signals 5 --min-price 1.0 --json-only 2>&1 | tail -20
    echo ""
    echo "  ✅ الرادار اكتمل — تحقق من scripts/output/maker_radar_EGX_*.json"
    ls -lh scripts/output/maker_radar_EGX_*.json 2>/dev/null | tail -3
else
    echo "  ❌ scripts/maker_radar.py غير موجود"
fi
echo ""

# ─── 5. عرض نتائج الرادار (أهم 10 أسهم) ────────────────────────────────────
echo "📋 [5] نتائج الرادار — أهم 10 أسهم تحت المجهر:"
python3 -c "
import json, glob, os
files = sorted(glob.glob('scripts/output/maker_radar_EGX_*.json'), reverse=True)
if not files:
    print('  ❌ لا توجد ملفات رادار — شغّل [4] أولًا')
else:
    with open(files[0]) as f:
        data = json.load(f)
    print(f'  📄 الملف: {files[0]}')
    print(f'  📊 إجمالي الأسهم المفحوصة: {data.get(\"total_scanned\", \"—\")}')
    print(f'  🔬 تحت المجهر: {data.get(\"under_microscope_count\", \"—\")}')
    print(f'  📅 تاريخ البيانات: {data.get(\"generated_at\", \"—\")[:19]}')
    print()
    under = data.get('under_microscope', [])
    if under:
        print('  أهم الأسهم تحت المجهر:')
        for i, s in enumerate(under[:10], 1):
            ticker = s.get('ticker', '—')
            price = s.get('current_price', 0)
            buy_pct = s.get('buy_pct', 0)
            net_flow = s.get('net_flow_egp', 0)
            path = s.get('path', '—')
            accum = s.get('accumulation', '—')
            print(f'    {i}. {ticker} | {price:.2f} ج.م | شراء={buy_pct:.1f}% | net={net_flow/1e6:.1f}M | {path}')
            print(f'       تجميع: {accum} | turnover: {s.get(\"avg_turnover_20d\", 0)/1e6:.1f}M')
    else:
        print('  ⚠️ لا توجد أسهم تحت المجهر في هذا الـ scan')
"
echo ""

# ─── 6. فحص cache status ────────────────────────────────────────────────────
echo "📋 [6] حالة cache الرادار:"
python3 -c "
import json, os
status_file = 'db/radar_cache_status.json'
if os.path.exists(status_file):
    with open(status_file) as f:
        s = json.load(f)
    print(f'  آخر warmup: {s.get(\"last_warmup_status\", \"—\")}')
    print(f'  بدأ في: {s.get(\"last_warmup_started_at\", \"—\")}')
    print(f'  انتهى في: {s.get(\"last_warmup_finished_at\", \"—\")}')
    print(f'  المدة: {s.get(\"last_warmup_duration_ms\", 0)/1000:.1f}s')
    print(f'  cache file: {s.get(\"cache_file\", \"—\")}')
    print(f'  cache age: {s.get(\"cache_age_seconds\", 0)}s')
    if s.get('last_error'):
        print(f'  ⚠️ آخر خطأ: {s.get(\"last_error\")}')
else:
    print('  ❌ db/radar_cache_status.json غير موجود')
"
echo ""

# ─── 7. فحص V40.2 daily predictor (آخر تشغيل) ──────────────────────────────
echo "📋 [7] فحص V40.2 daily predictor (آخر توقعات):"
python3 -c "
import sqlite3
try:
    c = sqlite3.connect('db/predictions.db')
    # آخر توقع لكل سهم
    rows = c.execute('''
        SELECT ticker, prediction_date, signal, master_score, risk_reward, status
        FROM predictions
        WHERE market IN ('EGX', 'مصر')
        ORDER BY prediction_date DESC LIMIT 15
    ''').fetchall()
    if rows:
        print(f'  آخر 15 توقع:')
        for r in rows:
            print(f'    {r[1]} | {r[0]} | {r[2]} | score={r[3]} | R:R={r[4]} | {r[5]}')
    else:
        print('  ⚠️ لا توجد توقعات في predictions.db')
    c.close()
except Exception as e:
    print(f'  ❌ خطأ: {e}')
"
echo ""

echo "=========================================="
echo "✅ اكتمل الفحص — أرسل النتائج للمالك"
echo "=========================================="
echo ""
echo "💡 إذا واجهت أخطاء، تحقق من:"
echo "   1. DBs موجودة في db/ (stocks.db + predictions.db + data_engine.db)"
echo "   2. Python deps مثبتة (pandas, ta, sqlite3)"
echo "   3. صلاحيات الكتابة على db/ و scripts/output/"
echo "   4. cron jobs تعمل (crontab -l | grep maker_radar)"
