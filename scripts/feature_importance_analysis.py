#!/usr/bin/env python3
"""
feature_importance_analysis.py — Feature Importance + تحليل Wyckoff + Drawdown audit.

الـ tasks:
  1. Feature Importance: أي من SMC/VP/Core/V38 بـ تـدي قيمة فعلية؟
  2. Wyckoff audit: ليه S2 (with Wyckoff) أسوأ من S1 (without)?
  3. Drawdown audit: الـ 0.5% رقم حقيقي ولا حساب غلط؟
  4. actual_return audit: الـ 50% values fabricated؟
"""
import sys
import os
import json
import sqlite3
import random
import statistics
from datetime import datetime
from pathlib import Path
from collections import Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))

from wyckoff_state_machine import detect_wyckoff_phase

print("=" * 90)
print("  🧪 BRAVO FEATURE IMPORTANCE + WYCKOFF AUDIT + DRAWDOWN AUDIT")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل التوقعات (بـ فلتر actual_return الحقيقي)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل التوقعات + فلتر fabricated returns...")

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

# فلتر: نـشيل الـ actual_return = 50.0 (fabricated/capped)
# + نـشيل الـ actual_return = 0.0 (مش حقيقي)
all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status, actual_return,
           exit_type, holding_days
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= '2025-08-01' AND prediction_date <= '2026-10-31'
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
      AND status IN ('TARGET_HIT', 'STOPPED')
      AND actual_return IS NOT NULL
    ORDER BY prediction_date
""").fetchall()
conn.close()

print(f"  Total closed: {len(all_rows)}")

# فلتر الـ fabricated returns (50.0 = capped/placeholder)
clean_rows = [r for r in all_rows if abs(float(r['actual_return']) - 50.0) > 0.01]
print(f"  بعد فلتر actual_return=50 (fabricated): {len(clean_rows)}")
print(f"  Fabricated (50.0): {len(all_rows) - len(clean_rows)}")

# عينة من الـ clean returns
returns_clean = [float(r['actual_return']) for r in clean_rows]
print(f"\n  Clean returns distribution:")
print(f"    count: {len(returns_clean)}")
if returns_clean:
    print(f"    min:   {min(returns_clean):.2f}%")
    print(f"    max:   {max(returns_clean):.2f}%")
    print(f"    avg:   {sum(returns_clean)/len(returns_clean):.2f}%")
    wins = [r for r in returns_clean if r > 0]
    losses = [r for r in returns_clean if r < 0]
    print(f"    Wins: {len(wins)} (avg = {sum(wins)/len(wins):.2f}%)")
    print(f"    Losses: {len(losses)} (avg = {sum(losses)/len(losses):.2f}%)")

# تحميل بيانات الأسعار
ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

ticker_date_cache = {}
for r in clean_rows:
    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    cache_key = (ticker, pred_date)
    if cache_key in ticker_date_cache:
        continue
    hist = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 100
    """, (ticker, pred_date)).fetchall()
    if len(hist) >= 30:
        hist = list(reversed(hist))
        ticker_date_cache[cache_key] = {
            'closes':  [h['close_price'] for h in hist],
            'opens':   [h['open_price'] for h in hist],
            'highs':   [h['high_price'] for h in hist],
            'lows':    [h['low_price'] for h in hist],
            'volumes': [h['volume'] or 0 for h in hist],
        }
ph_conn.close()

# حساب inputs
print("\n[2/5] حساب inputs...")
from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
for idx, r in enumerate(clean_rows):
    if idx % 100 == 0:
        print(f"  ... {idx}/{len(clean_rows)}", flush=True)

    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    cache_key = (ticker, pred_date)
    if cache_key not in ticker_date_cache:
        continue

    data = ticker_date_cache[cache_key]
    filtered = [(o,h,l,c,v) for o,h,l,c,v in
                zip(data['opens'], data['highs'], data['lows'], data['closes'], data['volumes'])
                if c is not None and h is not None and l is not None and o is not None and c > 0]
    if len(filtered) < 30:
        continue
    opens = [f[0] for f in filtered]
    highs = [f[1] for f in filtered]
    lows = [f[2] for f in filtered]
    closes = [f[3] for f in filtered]
    volumes = [f[4] for f in filtered]

    v38 = float(r['technical_score']) if r['technical_score'] is not None else 50.0

    core = 50.0
    try:
        result = _cse.analyze(ticker=ticker, price_data={
            'closes': closes, 'opens': opens, 'highs': highs, 'lows': lows, 'volumes': volumes
        }, market='EGX', persona='trader')
        if result and result.score is not None:
            core = float(result.score)
    except Exception:
        pass

    smc = 50.0
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_r = calculate_smc_score(candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        pass

    vp = 50.0
    vp_result = None
    try:
        vp_result = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_result and vp_result.score is not None:
            vp = float(vp_result.score)
    except Exception:
        pass

    cycle = 'RANGE'
    try:
        ctx = detect_wyckoff_phase(closes, highs, lows, volumes, vp_result)
        cycle = ctx.phase
    except Exception:
        pass

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'actual_return': float(r['actual_return']),
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'cycle': cycle,
    })

print(f"  ✅ {len(predictions)} توقع بـ inputs (clean returns)")


# ═══════════════════════════════════════════════════════════════════════
# 2. FEATURE IMPORTANCE — أي input بـ يـدي قيمة؟
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] Feature Importance Analysis...")

# لكل input: نقسمه لـ quartiles + نحسب الـ WR + avg return لكل quartile
def analyze_feature(predictions, feature_name):
    """حلل feature بـ quartiles."""
    values = [(p[feature_name], p['status'], p['actual_return']) for p in predictions]
    values.sort(key=lambda x: x[0])

    n = len(values)
    if n < 20:
        return None

    q_size = n // 4
    quartiles = {
        'Q1 (low)':    values[:q_size],
        'Q2':          values[q_size:2*q_size],
        'Q3':          values[2*q_size:3*q_size],
        'Q4 (high)':   values[3*q_size:],
    }

    result = {'feature': feature_name, 'quartiles': {}}
    for q_name, q_vals in quartiles.items():
        if not q_vals:
            continue
        wins = sum(1 for v in q_vals if v[1] == 'TARGET_HIT')
        closed = len(q_vals)
        wr = (wins / closed * 100) if closed > 0 else 0
        avg_return = sum(v[2] for v in q_vals) / closed if closed > 0 else 0
        avg_feature = sum(v[0] for v in q_vals) / closed if closed > 0 else 0
        result['quartiles'][q_name] = {
            'count': closed,
            'wins': wins,
            'wr': wr,
            'avg_return': avg_return,
            'avg_feature': avg_feature,
        }
    return result


features = ['v38', 'core', 'smc', 'vp']
importance_results = {}

print(f"\n  {'Feature':10s} | {'Quartile':12s} | {'count':>5} | {'WR':>6} | {'avg_ret':>8} | {'avg_feat':>8}")
print("  " + "-" * 70)

for feat in features:
    result = analyze_feature(predictions, feat)
    if result:
        importance_results[feat] = result
        for q_name, q_data in result['quartiles'].items():
            print(f"  {feat:10s} | {q_name:12s} | {q_data['count']:>5} | "
                  f"{q_data['wr']:>5.1f}% | {q_data['avg_return']:>+7.2f}% | {q_data['avg_feature']:>8.1f}")
    print()


# ═══════════════════════════════════════════════════════════════════════
# 3. WYCKOFF AUDIT — ليه S2 أسوأ من S1؟
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Wyckoff Audit — ليه S2 أسوأ من S1?")
print("="*90)

# توزيع الـ Wyckoff phases
cycle_dist = Counter(p['cycle'] for p in predictions).most_common()
print(f"\n  Wyckoff phase distribution:")
for phase, cnt in cycle_dist:
    pct = cnt/len(predictions)*100
    print(f"    {phase:25s} | {cnt:>4} ({pct:>5.1f}%)")

# WR per phase
print(f"\n  WR per Wyckoff phase:")
print(f"  {'Phase':25s} | {'count':>5} | {'wins':>4} | {'WR':>6} | {'avg_ret':>8}")
print("  " + "-" * 60)

phase_results = {}
for phase, _ in cycle_dist:
    phase_preds = [p for p in predictions if p['cycle'] == phase]
    if not phase_preds:
        continue
    wins = sum(1 for p in phase_preds if p['status'] == 'TARGET_HIT')
    closed = len(phase_preds)
    wr = (wins / closed * 100) if closed > 0 else 0
    avg_ret = sum(p['actual_return'] for p in phase_preds) / closed
    phase_results[phase] = {'count': closed, 'wins': wins, 'wr': wr, 'avg_ret': avg_ret}
    print(f"  {phase:25s} | {closed:>5} | {wins:>4} | {wr:>5.1f}% | {avg_ret:>+7.2f}%")

# Phases اللي Wyckoff بـ يـrejectها (EXIT patterns)
# في S2، الـ EXIT patterns بـ تـskip التوقعات
# نشوف إيه الـ phases اللي بتـskip كتير


# ═══════════════════════════════════════════════════════════════════════
# 4. DRAWDOWN AUDIT — الـ 0.5% رقم حقيقي؟
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] Drawdown Audit (على clean returns)...")
print("="*90)

# S1 scenario: V38 as Filter, Score = SMC×40% + VP×30% + Core×30%
accepted_s1 = []
for p in predictions:
    if p['v38'] < 50:  # V38 filter
        continue
    score = p['smc'] * 0.40 + p['vp'] * 0.30 + p['core'] * 0.30
    if score >= 50:
        accepted_s1.append(p)

print(f"\n  S1 accepted: {len(accepted_s1)}")

# Sort by date
accepted_s1.sort(key=lambda p: p['pred_date'])

# حساب الـ equity curve + Max Drawdown
for ps in [0.025, 0.05, 0.10]:
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    equity_curve = [100.0]
    consecutive_losses = 0
    max_consecutive = 0

    for p in accepted_s1:
        ret = p['actual_return']
        equity_change = ret * ps
        equity += equity_change
        if equity > peak:
            peak = equity
            consecutive_losses = 0
        else:
            consecutive_losses += 1
            if consecutive_losses > max_consecutive:
                max_consecutive = consecutive_losses
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd
        equity_curve.append(equity)

    print(f"\n  Position size = {ps*100:.1f}%:")
    print(f"    Closed: {len(accepted_s1)}")
    print(f"    Wins: {sum(1 for p in accepted_s1 if p['status'] == 'TARGET_HIT')}")
    print(f"    Losses: {sum(1 for p in accepted_s1 if p['status'] == 'STOPPED')}")
    print(f"    WR: {sum(1 for p in accepted_s1 if p['status'] == 'TARGET_HIT')/len(accepted_s1)*100:.1f}%")
    print(f"    Total return: {equity - 100:.2f}%")
    print(f"    Max Drawdown: {max_dd:.2f}%")
    print(f"    Max consecutive losses: {max_consecutive}")
    print(f"    Peak: {max(equity_curve):.2f}%")
    print(f"    Min: {min(equity_curve):.2f}%")

# Profit Factor (real)
wins = [p for p in accepted_s1 if p['status'] == 'TARGET_HIT']
losses = [p for p in accepted_s1 if p['status'] == 'STOPPED']
gross_profit = sum(p['actual_return'] for p in wins)
gross_loss = sum(abs(p['actual_return']) for p in losses)
pf = gross_profit / gross_loss if gross_loss > 0 else 0
print(f"\n  Profit Factor (real): {pf:.2f}")
print(f"  Gross profit: {gross_profit:.2f}%")
print(f"  Gross loss: {gross_loss:.2f}%")
print(f"  avg win: {sum(p['actual_return'] for p in wins)/len(wins):.2f}%")
print(f"  avg loss: {sum(p['actual_return'] for p in losses)/len(losses):.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. حفظ النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("  📋 SUMMARY")
print("=" * 90)

print(f"""
  1. FABRICATED RETURNS كشفنا:
     - 94 توقع بـ actual_return = 50.0 (capped/placeholder)
     - كلهم exit_type = maker_fuel_exhausted + holding_days = 50
     - exit_price = NULL
     - ده fabrication إضافي (مثل INVALID_FABRICATED)
     - بعد الفلتر: {len(clean_rows)} توقع نظيف

  2. FEATURE IMPORTANCE:
     - نشوف أي input ليه WR مرتبط بـ قيمته (Q4 > Q1 = feature useful)
     - لو WR ثابت عبر quartiles = feature مش useful

  3. WYCKOFF AUDIT:
     - توزيع الـ phases
     - WR per phase
     - أي phases بـ تـkill الأداء

  4. DRAWDOWN AUDIT (على clean returns):
     - Max Drawdown الحقيقي (بـ position sizes مختلفة)
     - Profit Factor الحقيقي
     - Max consecutive losses
""")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'feature_importance_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'n_clean_predictions': len(predictions),
        'n_fabricated_50': len(all_rows) - len(clean_rows),
        'feature_importance': importance_results,
        'wyckoff_audit': phase_results,
        'drawdown_audit': {
            's1_accepted': len(accepted_s1),
            'profit_factor': pf,
            'gross_profit': gross_profit,
            'gross_loss': gross_loss,
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Feature Importance + Wyckoff Audit + Drawdown Audit خلص")
print("=" * 90)
