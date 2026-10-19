#!/usr/bin/env python3
"""
backtest_hybrid_weights.py — باك تست لـ تجربة weights مختلفة للـ hybrid score.

الـ framework:
  1. يحسب الـ 4 scores (v38 + core + smc + vp) لكل سهم على شهر كامل.
  2. يـجرب 5 weights combinations.
  3. يقارن النتايج + يختار الأفضل.

الـ usage:
  python3 scripts/backtest_hybrid_weights.py
  python3 scripts/backtest_hybrid_weights.py --start 2026-09-15 --end 2026-10-15
"""
import sys
import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path

# Add vps-service to path
VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))

# المشروع root
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 80)
print("  🧪 BRAVO HYBRID SCORE BACKTEST — تجربة weights مختلفة")
print("=" * 80)

# ═══════════════════════════════════════════════════════════════════════
# 1. الـ weights combinations اللي هـ نـجربها
# ═══════════════════════════════════════════════════════════════════════
COMBOS = {
    'baseline':    {'v38': 0.75, 'core': 0.00, 'smc': 0.15, 'vp': 0.10},  # الحالي
    'combo_A':     {'v38': 0.40, 'core': 0.35, 'smc': 0.15, 'vp': 0.10},  # المقترح الأول
    'combo_B':     {'v38': 0.30, 'core': 0.40, 'smc': 0.20, 'vp': 0.10},  # core أعلى
    'combo_C':     {'v38': 0.25, 'core': 0.35, 'smc': 0.25, 'vp': 0.15},  # SMC + VP أعلى
    'combo_D':     {'v38': 0.20, 'core': 0.45, 'smc': 0.20, 'vp': 0.15},  # core مهيمن
}

# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل التوقعات الفعلية من predictions.db
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل التوقعات من predictions.db...")

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# التوقعات في الفترة + status صالح (مستبعد INVALID)
START_DATE = '2026-09-15'
END_DATE = '2026-10-15'

rows = cur.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status,
           actual_return, holding_days, persona, kill_filter_result
    FROM predictions
    WHERE signal LIKE '%BUY%'
      AND status NOT LIKE 'INVALID%'
      AND prediction_date >= ?
      AND prediction_date <= ?
      AND entry_price IS NOT NULL AND entry_price > 0
      AND target_price IS NOT NULL AND target_price > 0
      AND stop_loss IS NOT NULL AND stop_loss > 0
      AND target_price > entry_price
      AND stop_loss < entry_price
    ORDER BY prediction_date
""", (START_DATE, END_DATE)).fetchall()

print(f"  ✅ {len(rows)} توقع في الفترة {START_DATE} → {END_DATE}")
print(f"  closed (TARGET_HIT + STOPPED): {sum(1 for r in rows if r['status'] in ('TARGET_HIT','STOPPED'))}")

conn.close()

if not rows:
    print("❌ مفيش توقعات في الفترة دي!")
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# 3. تحميل بيانات الأسعار لكل ticker (للـ CoreScoringEngine)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] تحميل بيانات الأسعار من price_history.db...")

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

# كل ticker + آخر 100 يوم قبل prediction_date
ticker_data = {}
for r in rows:
    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    if ticker not in ticker_data:
        ticker_data[ticker] = {}
    if pred_date not in ticker_data[ticker]:
        # اخر 100 يوم قبل pred_date
        hist = ph_conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 100
        """, (ticker, pred_date)).fetchall()
        if len(hist) >= 30:  # minimum 30 days
            hist = list(reversed(hist))  # oldest first
            ticker_data[ticker][pred_date] = {
                'closes':  [h['close_price'] for h in hist],
                'opens':   [h['open_price'] for h in hist],
                'highs':   [h['high_price'] for h in hist],
                'lows':    [h['low_price'] for h in hist],
                'volumes': [h['volume'] or 0 for h in hist],
            }

ph_conn.close()
print(f"  ✅ {len(ticker_data)} ticker لهم بيانات سعرية كافية")

# ═══════════════════════════════════════════════════════════════════════
# 4. حساب الـ 4 scores لكل توقع
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] حساب الـ 4 scores (v38 + core + smc + vp) لكل توقع...")

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions_with_scores = []
_core_fail_count = 0
_smc_fail_count = 0
_vp_fail_count = 0

for idx, r in enumerate(rows):
    if idx % 50 == 0:
        print(f"  ... معالجة {idx}/{len(rows)}", flush=True)

    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]

    # skip لو مفيش بيانات سعرية
    if ticker not in ticker_data or pred_date not in ticker_data[ticker]:
        continue

    data = ticker_data[ticker][pred_date]
    closes = data['closes']
    opens = data['opens']
    highs = data['highs']
    lows = data['lows']
    volumes = data['volumes']

    # فلتر الـ None values (بعض الصفوف فيها high_price/low_price = NULL)
    filtered = [(o, h, l, c, v) for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)
                if c is not None and h is not None and l is not None and o is not None and c > 0]
    if len(filtered) < 30:
        continue
    opens = [f[0] for f in filtered]
    highs = [f[1] for f in filtered]
    lows = [f[2] for f in filtered]
    closes = [f[3] for f in filtered]
    volumes = [f[4] for f in filtered]

    # V38 score = technical_score الحالي من الـ DB
    v38_score = float(r['technical_score']) if r['technical_score'] is not None else 50.0

    # CoreScoringEngine score
    core_score = None
    try:
        price_data = {
            'closes': closes, 'opens': opens, 'highs': highs, 'lows': lows,
            'volumes': volumes,
        }
        result = _cse.analyze(ticker=ticker, price_data=price_data, market='EGX', persona='trader')
        if result and result.score is not None:
            core_score = float(result.score)
    except Exception as e:
        _core_fail_count += 1

    # SMC score
    smc_score = None
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_result = calculate_smc_score(candles, closes[-1])
        if smc_result and 'score' in smc_result:
            smc_score = float(smc_result['score'])
    except Exception:
        _smc_fail_count += 1

    # Volume Profile score
    vp_score = None
    try:
        vp_result = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_result and vp_result.score is not None:
            vp_score = float(vp_result.score)
    except Exception:
        _vp_fail_count += 1

    predictions_with_scores.append({
        'id': r['id'],
        'ticker': ticker,
        'pred_date': pred_date,
        'signal': r['signal'],
        'status': r['status'],
        'actual_return': float(r['actual_return']) if r['actual_return'] is not None else None,
        'v38': v38_score,
        'core': core_score if core_score is not None else 50.0,
        'smc': smc_score if smc_score is not None else 50.0,
        'vp': vp_score if vp_score is not None else 50.0,
        'core_available': core_score is not None,
    })

print(f"  ✅ {len(predictions_with_scores)} توقع بـ scores محسوبة")
print(f"  CoreScoringEngine fails: {_core_fail_count}")
print(f"  SMC fails: {_smc_fail_count}")
print(f"  VP fails: {_vp_fail_count}")

# ═══════════════════════════════════════════════════════════════════════
# 5. تجربة كل combo + حساب الـ WR
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] تجربة كل weights combination...")

def score_band(score):
    if score is None: return 'NULL'
    if score < 50: return '<50'
    if score < 60: return '50-60'
    if score < 65: return '60-65'
    if score < 70: return '65-70'
    if score < 80: return '70-80'
    if score < 90: return '80-90'
    return '>=90'

results = {}
for combo_name, weights in COMBOS.items():
    w_v38 = weights['v38']
    w_core = weights['core']
    w_smc = weights['smc']
    w_vp = weights['vp']

    # fallback: لو core مش متاح → زوّد وزن v38
    predictions = []
    for p in predictions_with_scores:
        if p['core_available']:
            v38_w = w_v38
            core_w = w_core
        else:
            v38_w = w_v38 + w_core
            core_w = 0.0

        # normalize
        total_w = v38_w + core_w + w_smc + w_vp
        if total_w > 0:
            v38_w /= total_w
            core_w /= total_w
            smc_w = w_smc / total_w
            vp_w = w_vp / total_w
        else:
            smc_w = 0
            vp_w = 0

        # hybrid score
        hybrid = (
            p['v38'] * v38_w +
            p['core'] * core_w +
            p['smc'] * smc_w +
            p['vp'] * vp_w
        )
        hybrid = max(0, min(100, round(hybrid, 2)))

        predictions.append({
            'status': p['status'],
            'hybrid_score': hybrid,
        })

    # حساب الـ WR
    closed = [p for p in predictions if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']

    n_total = len(predictions)
    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0

    # توزيع score
    bands = {}
    for p in predictions:
        band = score_band(p['hybrid_score'])
        if band not in bands:
            bands[band] = {'count': 0, 'wins': 0, 'closed': 0}
        bands[band]['count'] += 1
        if p['status'] == 'TARGET_HIT':
            bands[band]['wins'] += 1
        if p['status'] in ('TARGET_HIT', 'STOPPED'):
            bands[band]['closed'] += 1

    # عدد الـ ≥90
    n_ge90 = bands.get('>=90', {}).get('count', 0)
    n_ge90_closed = bands.get('>=90', {}).get('closed', 0)
    n_ge90_wins = bands.get('>=90', {}).get('wins', 0)
    wr_ge90 = (n_ge90_wins / n_ge90_closed * 100) if n_ge90_closed > 0 else 0

    # WR للـ 65-70
    n_65_70 = bands.get('65-70', {}).get('count', 0)
    n_65_70_closed = bands.get('65-70', {}).get('closed', 0)
    n_65_70_wins = bands.get('65-70', {}).get('wins', 0)
    wr_65_70 = (n_65_70_wins / n_65_70_closed * 100) if n_65_70_closed > 0 else 0

    results[combo_name] = {
        'weights': weights,
        'n_total': n_total,
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'n_ge90': n_ge90,
        'wr_ge90': wr_ge90,
        'wr_65_70': wr_65_70,
        'bands': bands,
    }

# ═══════════════════════════════════════════════════════════════════════
# 6. عرض النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("  📊 النتائج: مقارنة weights combinations")
print("=" * 80)

print(f"\n{'Combo':12s} | {'v38':>5} | {'core':>5} | {'smc':>5} | {'vp':>5} | {'closed':>6} | {'WR':>6} | {'≥90':>4} | {'WR≥90':>6} | {'WR65-70':>7}")
print("-" * 95)
for name, r in results.items():
    w = r['weights']
    print(f"{name:12s} | {w['v38']:>5.2f} | {w['core']:>5.2f} | {w['smc']:>5.2f} | {w['vp']:>5.2f} | "
          f"{r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['n_ge90']:>4} | {r['wr_ge90']:>5.1f}% | {r['wr_65_70']:>6.1f}%")

# الـ combo الأفضل
print("\n" + "=" * 80)
print("  🏆 التحليل")
print("=" * 80)

best_wr = max(results.items(), key=lambda x: x[1]['wr'])
best_ge90 = max(results.items(), key=lambda x: x[1]['wr_ge90'] if x[1]['n_ge90'] > 0 else -1)
fewest_ge90 = min(results.items(), key=lambda x: x[1]['n_ge90'])

print(f"\n  أعلى WR إجمالي:    {best_wr[0]:12s} = {best_wr[1]['wr']:.2f}%")
print(f"  أعلى WR للـ ≥90:   {best_ge90[0]:12s} = {best_ge90[1]['wr_ge90']:.1f}% ({best_ge90[1]['n_ge90']} توقع)")
print(f"  أقل عدد ≥90:       {fewest_ge90[0]:12s} = {fewest_ge90[1]['n_ge90']} توقع")

# توزيع الـ bands لكل combo
print("\n" + "=" * 80)
print("  📊 توزيع score bands لكل combo")
print("=" * 80)

band_order = ['<50', '50-60', '60-65', '65-70', '70-80', '80-90', '>=90', 'NULL']
print(f"\n{'Combo':12s} | " + " | ".join(f"{b:>8s}" for b in band_order))
print("-" * 100)
for name, r in results.items():
    row = f"{name:12s} |"
    for b in band_order:
        if b in r['bands']:
            cnt = r['bands'][b]['count']
            wr_b = (r['bands'][b]['wins'] / r['bands'][b]['closed'] * 100) if r['bands'][b]['closed'] > 0 else 0
            row += f" {cnt:>3}({wr_b:>3.0f}%) |"
        else:
            row += f" {0:>3}({0:>3.0f}%) |"
    print(row)

# حفظ النتائج JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'hybrid_weights_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': f'{START_DATE} → {END_DATE}',
        'n_predictions': len(predictions_with_scores),
        'n_tickers': len(ticker_data),
        'combos': results,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 80)
print("  ✅ الباك تست خلص — اختار الـ combo الأفضل بناءً على:")
print("     1. WR ≥90 أعلى (كسر العلاقة المقلوبة)")
print("     2. WR 65-70 لا تدهور (لا يقل عن 80%)")
print("     3. WR إجمالي لا تدهور (لا يقل عن 55%)")
print("     4. عدد ≥90 أقل (الـ 100 بقى نادر)")
print("=" * 80)
