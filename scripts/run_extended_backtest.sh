#!/bin/bash
# BRAVO EXTENDED BACKTEST — للاب توب / VPS
# يقارن: قبل (بدون SMC+VP) vs بعد (مع SMC+VP)
# ====================================================================

set -e
cd "$(dirname "$0")/.."

echo "============================================================"
echo "BRAVO EXTENDED BACKTEST — قبل vs بعد SMC+VP"
echo "============================================================"
echo ""

# 1. تشغيل V40.2 WITHOUT SMC+VP (baseline)
echo "=== 1. BASELINE (بدون SMC+VP) ==="
V40_2_SKIP_SMC_VP=1 python3 vps-service/jobs/daily_predictor.py \
    --start 2026-07-01 --end 2026-10-15 \
    --market EGX --max-picks 50 \
    --output baseline_results.json 2>&1 | tail -5

echo ""
echo "=== 2. WITH SMC+VP (النسخة الجديدة) ==="
python3 vps-service/jobs/daily_predictor.py \
    --start 2026-07-01 --end 2026-10-15 \
    --market EGX --max-picks 50 \
    --output smc_vp_results.json 2>&1 | tail -5

echo ""
echo "=== 3. مقارنة النتائج ==="
python3 -c "
import json, sqlite3

# Load both results
try:
    with open('baseline_results.json') as f:
        baseline = json.load(f)
except:
    baseline = []

try:
    with open('smc_vp_results.json') as f:
        smc_vp = json.load(f)
except:
    smc_vp = []

# Compare against actual outcomes in predictions.db
c = sqlite3.connect('db/predictions.db')
c.row_factory = sqlite3.Row

def analyze(results, label):
    if not results:
        print(f'{label}: no results')
        return
    total = len(results)
    wins = 0
    returns = []
    for r in results:
        ticker = r.get('ticker', '')
        pred_date = r.get('prediction_date', '')
        row = c.execute(
            'SELECT actual_return FROM predictions WHERE ticker=? AND prediction_date=? AND actual_return IS NOT NULL ORDER BY created_at DESC LIMIT 1',
            (ticker, pred_date)
        ).fetchone()
        if row:
            ret = float(row['actual_return'])
            returns.append(ret)
            if ret > 0:
                wins += 1
    n = len(returns)
    wr = wins / n * 100 if n > 0 else 0
    avg = sum(returns) / n if n > 0 else 0
    print(f'{label}: {n} matched | WR={wr:.1f}% | avg_return={avg:.2f}%')

analyze(baseline, 'BASELINE (بدون SMC+VP)')
analyze(smc_vp, 'WITH SMC+VP')
c.close()
"

echo ""
echo "=== 4. فحص الـ radar gate (الربط العكسي) ==="
python3 -c "
import json, os
from pathlib import Path

# Check if maker_radar JSON exists
output_dir = Path('scripts/output')
radar_files = list(output_dir.glob('maker_radar_*_*.json'))
if radar_files:
    latest = max(radar_files, key=os.path.getctime)
    with open(latest) as f:
        radar = json.load(f)
    stocks = radar.get('stocks', radar.get('under_microscope', []))
    print(f'رادار السيولة: {len(stocks)} سهم في آخر scan')
    # count by phase
    phases = {}
    for s in stocks:
        p = s.get('phase', 'unknown')
        phases[p] = phases.get(p, 0) + 1
    for p, n in sorted(phases.items(), key=lambda x: -x[1]):
        print(f'  {p}: {n}')
else:
    print('⚠️ مفيش maker_radar JSON — شغّل الرادار الأول:')
    print('   python3 scripts/maker_radar.py --json-only')
"

echo ""
echo "=== 5. audit_data_integrity ==="
python3 vps-service/tests/audit_data_integrity.py 2>&1 | tail -5

echo ""
echo "============================================================"
echo "الباك تست خلص. قارن النتايج فوق."
echo "============================================================"
