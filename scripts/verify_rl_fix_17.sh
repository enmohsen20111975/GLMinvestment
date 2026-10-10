#!/bin/bash
# ============================================================
# RL-FIX-17 Verification Script — للتحقق من النتائج على السيرفر المحلي
# ============================================================
# يشغّل: bash scripts/verify_rl_fix_17.sh
#
# يفحص:
#   1. حالة الخدمات (Next.js + Python backend + data-engine)
#   2. KPI Summary (wins/losses/winRate/avgWin/avgLoss/profitFactor)
#   3. PENDING count per persona (يجب أن لا يتجاوز 5)
#   4. exit_type distribution (يجب أن يظهر trailing_profit)
#   5. ARVA duplicate check (يجب أن لا يتكرر نفس السهم في PENDING)
#   6. API endpoints (honest-tracking + live-tracking)
# ============================================================

set -e
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
PYTHON="vps-service/venv/bin/python3"

echo "============================================================"
echo "📊 RL-FIX-17 Verification — $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo

# ── 1. Services status ──
echo "─── 1️⃣  Services Status ───"
echo "Next.js (port 3000):  $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null || echo 'DOWN')"
echo "Python backend (8010): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8010/health 2>/dev/null || echo 'DOWN')"
echo "Data-engine (5000):   $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/ 2>/dev/null || echo 'DOWN')"
echo

# ── 2. KPI Summary ──
echo "─── 2️⃣  KPI Summary (predictions.db) ───"
$PYTHON -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
c = conn.cursor()
c.execute('''
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN actual_return > 0 AND outcome_date IS NOT NULL THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN actual_return <= 0 AND outcome_date IS NOT NULL THEN 1 ELSE 0 END) as losses,
  ROUND(100.0 * SUM(CASE WHEN actual_return > 0 AND outcome_date IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END),0), 1) as win_pct,
  ROUND(AVG(CASE WHEN actual_return > 0 AND outcome_date IS NOT NULL THEN actual_return END),2) as avg_win,
  ROUND(AVG(CASE WHEN actual_return <= 0 AND outcome_date IS NOT NULL THEN actual_return END),2) as avg_loss,
  ROUND(SUM(CASE WHEN actual_return > 0 AND outcome_date IS NOT NULL THEN actual_return END) / NULLIF(ABS(SUM(CASE WHEN actual_return < 0 AND outcome_date IS NOT NULL THEN actual_return END)),0),2) as profit_factor
FROM predictions WHERE (ABS(actual_return) <= 50 OR actual_return IS NULL)
''')
row = c.fetchone()
print(f'  total       = {row[0]}')
print(f'  closed      = {row[1]}')
print(f'  pending     = {row[2]}  (after RL-FIX-17 cap=5/persona)')
print(f'  wins        = {row[3]}')
print(f'  losses      = {row[4]}')
print(f'  winRate     = {row[5]}%')
print(f'  avgWin      = +{row[6]}%')
print(f'  avgLoss     = {row[7]}%')
print(f'  profitFactor= {row[8]}  (target: > 1.0)')
conn.close()
"
echo

# ── 3. PENDING per persona ──
echo "─── 3️⃣  PENDING per persona (cap=5) ───"
$PYTHON -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
c = conn.cursor()
c.execute('SELECT persona, COUNT(*) FROM predictions WHERE outcome_date IS NULL GROUP BY persona ORDER BY COUNT(*) DESC')
for r in c.fetchall():
    status = '✅ OK' if r[1] <= 5 else '⚠️  OVER CAP (will block new INSERTs)'
    print(f'  {r[0]:15} pending={r[1]}  {status}')
conn.close()
"
echo

# ── 4. exit_type distribution ──
echo "─── 4️⃣  exit_type distribution ───"
$PYTHON -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
c = conn.cursor()
c.execute('SELECT COALESCE(exit_type,\"(NULL/PENDING)\"), COUNT(*), ROUND(AVG(actual_return),2) FROM predictions WHERE (ABS(actual_return) <= 50 OR actual_return IS NULL) GROUP BY exit_type ORDER BY COUNT(*) DESC')
for r in c.fetchall():
    flag = ''
    if r[0] == 'trailing_profit': flag = ' 💰 RL-FIX-17 Profit Lock'
    elif r[0] == 'target_2_hit': flag = ' 🎯 RL-FIX-17 T2 Multi-Target'
    elif r[0] == 'trend_break': flag = ' 📉 Dynamic Exit Rule 6'
    elif r[0] == 'momentum_dead': flag = ' ⚡ Dynamic Exit Rule 7'
    print(f'  {r[0]:25} n={r[1]:5}  avg_ret={r[2]}%{flag}')
conn.close()
"
echo

# ── 5. ARVA duplicate check ──
echo "─── 5️⃣  Duplicate check (ticker+persona in PENDING) ───"
$PYTHON -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
c = conn.cursor()
c.execute('''
SELECT ticker, persona, COUNT(*) as n
FROM predictions
WHERE outcome_date IS NULL
GROUP BY ticker, persona
HAVING n > 1
ORDER BY n DESC
''')
dups = c.fetchall()
if dups:
    print('  ⚠️  DUPLICATES found:')
    for r in dups:
        print(f'    {r[0]:8} {r[1]:15} count={r[2]}')
    print('  → RL-FIX-17 dedup will prevent new duplicates on INSERT')
else:
    print('  ✅ NO duplicates — dedup is working')
conn.close()
"
echo

# ── 6. API endpoints ──
echo "─── 6️⃣  API endpoints ───"
echo "honest-tracking (Next.js proxy):"
curl -s -o /dev/null -w "  HTTP %{http_code} | time=%{time_total}s\n" "http://localhost:3000/api/predictions/honest-tracking/list?market=EGX&limit=5"
echo "live-tracking (Python direct):"
curl -s -o /dev/null -w "  HTTP %{http_code} | time=%{time_total}s\n" "http://127.0.0.1:8010/api/stored-analysis/live-tracking?market=EGX&days=30&limit=5"
echo

# ── 7. New fields in live-tracking ──
echo "─── 7️⃣  New fields check (live-tracking) ───"
curl -s "http://127.0.0.1:8010/api/stored-analysis/live-tracking?market=EGX&days=30&limit=1" 2>/dev/null | $PYTHON -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    preds = d.get('predictions', {})
    all_preds = []
    for persona_list in preds.values():
        all_preds.extend(persona_list)
    if all_preds:
        p = all_preds[0]
        new_fields = ['highest_price_reached', 'lowest_price_reached', 'exit_type', 'target_price_2']
        print('  Sample prediction:', p.get('ticker'), '|', p.get('persona'))
        for f in new_fields:
            val = p.get(f, 'MISSING')
            status = '✅' if f in p else '❌'
            print(f'    {status} {f}: {val}')
    else:
        print('  (no predictions in last 30 days — try --days 60)')
except Exception as e:
    print(f'  Error: {e}')
"
echo

echo "============================================================"
echo "✅ Verification complete"
echo
echo "📋 Next steps:"
echo "  1. شغّل daily_closer يدوياً: cd vps-service && ./venv/bin/python3 -m jobs.daily_closer"
echo "  2. افتح الموقع في المتصفح وراجع التبويبين:"
echo "     - تبويب متابعة التوقعات (PredictionTrackingDashboard)"
echo "     - تبويب ملخص التوقعات (ExecutiveReportView)"
echo "  3. لو كل شيء سليم: git add -A && git commit -m 'RL-FIX-17: 5-Max + Profit Lock + T1/T2 + Persona + Frontend'"
echo "  4. git push origin main"
echo "  5. على VPS: cd /root/GLMinvestment && git pull origin main && pm2 restart python-backend"
echo "============================================================"
