#!/usr/bin/env python3
"""
inversion_test.py — اختبار الانعكاس (Inversion Test).

الـ logic:
  1. نـحسب الـ scores زي ما هي (v38, core, smc, vp)
  2. نـعكسها: score_inverted = 100 - score
  3. نشغل الباك تست على:
     - Original scores (baseline)
     - Inverted scores
  4. مقارنة:
     - لو Inverted مربح جداً (PF > 1.5) → الـ signals معكوسة (Polarity issue)
     - لو Inverted لسه خسران → الـ signals ضوضاء (Noise)

كمان نـجرب:
  - holding periods مختلفة (5, 10, 20, 50 أيام)
  - عشان نـشوف هل المشكلة في Time Horizon
"""
import sys
import os
import json
import sqlite3
import random
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
print("  🧪 BRAVO INVERSION TEST — هل الـ signals معكوسة؟")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل التوقعات النظيفة (بدون fabricated 50%)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل التوقعات النظيفة...")

pred_db = DB_DIR / 'predictions.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection(str(pred_db), writable=False).__enter__()
conn.row_factory = sqlite3.Row

# فلتر: نـشيل actual_return = 50.0 (fabricated) + 0.0 (placeholder)
all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, technical_score,
           entry_price, target_price, stop_loss, status, actual_return,
           exit_type, holding_days
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= '2025-08-01' AND prediction_date <= '2026-10-31'
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
      AND status IN ('TARGET_HIT', 'STOPPED')
      AND actual_return IS NOT NULL
      AND actual_return != 50.0  -- فلتر الـ fabricated
      AND actual_return != 0.0   -- فلتر الـ placeholder
    ORDER BY prediction_date
""").fetchall()
conn.close()

print(f"  Total clean closed: {len(all_rows)}")

# توزيع الـ holding_days
holding_dist = Counter(r['holding_days'] for r in all_rows).most_common(10)
print(f"\n  Holding days distribution (top 10):")
for hd, cnt in holding_dist:
    print(f"    {hd} days: {cnt}")

# توزيع الـ actual_return
returns = [float(r['actual_return']) for r in all_rows]
wins = [r for r in returns if r > 0]
losses = [r for r in returns if r < 0]
print(f"\n  Returns distribution:")
print(f"    Total: {len(returns)}")
print(f"    Wins: {len(wins)} (avg = {sum(wins)/len(wins):.2f}%)")
print(f"    Losses: {len(losses)} (avg = {sum(losses)/len(losses):.2f}%)")
print(f"    WR: {len(wins)/len(returns)*100:.1f}%")
print(f"    avg return: {sum(returns)/len(returns):.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل بيانات الأسعار + حساب inputs
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] حساب inputs...")

ph_db = DB_DIR / 'price_history.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
ph_conn = db_manager.connection(str(ph_db), writable=False).__enter__()
ph_conn.row_factory = sqlite3.Row

ticker_date_cache = {}
for r in all_rows:
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

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
for idx, r in enumerate(all_rows):
    if idx % 100 == 0:
        print(f"  ... {idx}/{len(all_rows)}", flush=True)

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
    try:
        vp_r = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_r and vp_r.score is not None:
            vp = float(vp_r.score)
    except Exception:
        pass

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'actual_return': float(r['actual_return']),
        'holding_days': r['holding_days'] or 50,
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
    })

print(f"  ✅ {len(predictions)} توقع بـ inputs")


# ═══════════════════════════════════════════════════════════════════════
# 3. INVERSION TEST
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] Inversion Test...")


def evaluate_subset(predictions_subset, label):
    """قيم subset من التوقعات."""
    if not predictions_subset:
        return None
    closed = [p for p in predictions_subset if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']
    losses = [p for p in closed if p['status'] == 'STOPPED']

    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0

    win_returns = [p['actual_return'] for p in wins]
    loss_returns = [p['actual_return'] for p in losses]

    gross_profit = sum(r for r in win_returns if r > 0)
    gross_loss = sum(abs(r) for r in loss_returns if r < 0)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0

    avg_win = sum(win_returns)/len(win_returns) if win_returns else 0
    avg_loss = sum(loss_returns)/len(loss_returns) if loss_returns else 0
    avg_ret = sum(p['actual_return'] for p in closed) / n_closed if n_closed > 0 else 0

    return {
        'label': label,
        'n_total': len(predictions_subset),
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'pf': pf,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'avg_ret': avg_ret,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
    }


# الـ scenarios
print("\n  --- Inversion Test Results ---")
print(f"  {'Scenario':45s} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'avg_ret':>8}")
print("  " + "-" * 90)

# 1. Baseline: كل التوقعات (no filter)
r = evaluate_subset(predictions, 'Baseline (all predictions, no filter)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 2. V38 filter only (score >= 50)
v38_positive = [p for p in predictions if p['v38'] >= 50]
r = evaluate_subset(v38_positive, 'V38 >= 50 (original)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 3. V38 INVERTED (score <= 50) — نشتري الـ low scores
v38_inverted = [p for p in predictions if p['v38'] <= 50]
r = evaluate_subset(v38_inverted, 'V38 INVERTED (<= 50)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 4. V38 quartile: lowest 25% (most inverted)
sorted_by_v38 = sorted(predictions, key=lambda p: p['v38'])
lowest_25_v38 = sorted_by_v38[:len(sorted_by_v38)//4]
r = evaluate_subset(lowest_25_v38, 'V38 lowest 25% (most inverted)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 5. V38 quartile: highest 25% (original strong)
highest_25_v38 = sorted_by_v38[-len(sorted_by_v38)//4:]
r = evaluate_subset(highest_25_v38, 'V38 highest 25% (original strong)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

print()

# 6. SMC filter only (score >= 50)
smc_positive = [p for p in predictions if p['smc'] >= 50]
r = evaluate_subset(smc_positive, 'SMC >= 50 (original)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 7. SMC INVERTED (score <= 50)
smc_inverted = [p for p in predictions if p['smc'] <= 50]
r = evaluate_subset(smc_inverted, 'SMC INVERTED (<= 50)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 8. SMC lowest 25%
sorted_by_smc = sorted(predictions, key=lambda p: p['smc'])
lowest_25_smc = sorted_by_smc[:len(sorted_by_smc)//4]
r = evaluate_subset(lowest_25_smc, 'SMC lowest 25% (most inverted)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 9. SMC highest 25%
highest_25_smc = sorted_by_smc[-len(sorted_by_smc)//4:]
r = evaluate_subset(highest_25_smc, 'SMC highest 25% (original strong)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

print()

# 10. VP filter only
vp_positive = [p for p in predictions if p['vp'] >= 50]
r = evaluate_subset(vp_positive, 'VP >= 50 (original)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 11. VP INVERTED
vp_inverted = [p for p in predictions if p['vp'] <= 50]
r = evaluate_subset(vp_inverted, 'VP INVERTED (<= 50)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

print()

# 12. Core filter only
core_positive = [p for p in predictions if p['core'] >= 50]
r = evaluate_subset(core_positive, 'Core >= 50 (original)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")

# 13. Core INVERTED
core_inverted = [p for p in predictions if p['core'] <= 50]
r = evaluate_subset(core_inverted, 'Core INVERTED (<= 50)')
print(f"  {r['label']:45s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. HOLDING PERIOD TEST — هل المشكلة في Time Horizon؟
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] Holding Period Test — هل المشكلة في Time Horizon?")
print("="*90)

# نقسم التوقعات حسب holding_days
holding_buckets = {
    '1-5 days': [p for p in predictions if 1 <= p['holding_days'] <= 5],
    '6-10 days': [p for p in predictions if 6 <= p['holding_days'] <= 10],
    '11-20 days': [p for p in predictions if 11 <= p['holding_days'] <= 20],
    '21-50 days': [p for p in predictions if 21 <= p['holding_days'] <= 50],
    '50+ days': [p for p in predictions if p['holding_days'] > 50],
}

print(f"\n  {'Holding Period':15s} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'avg_ret':>8}")
print("  " + "-" * 60)

for label, subset in holding_buckets.items():
    r = evaluate_subset(subset, label)
    if r:
        print(f"  {label:15s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['avg_ret']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. Inversion Test على holding periods مختلفة
# ═══════════════════════════════════════════════════════════════════════
print("\n  --- Inversion Test على holding periods ---")
print(f"  {'Holding':15s} | {'Scenario':25s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'avg_ret':>8}")
print("  " + "-" * 80)

for label, subset in holding_buckets.items():
    if not subset or len(subset) < 10:
        continue
    # Original (V38 >= 50)
    orig = [p for p in subset if p['v38'] >= 50]
    r_orig = evaluate_subset(orig, f'{label} | V38>=50 (orig)')
    if r_orig:
        print(f"  {label:15s} | {'V38>=50 (orig)':25s} | {r_orig['n_closed']:>6} | {r_orig['wr']:>5.1f}% | {r_orig['pf']:>6.2f} | {r_orig['avg_ret']:>+7.2f}%")

    # Inverted (V38 <= 50)
    inv = [p for p in subset if p['v38'] <= 50]
    r_inv = evaluate_subset(inv, f'{label} | V38<=50 (inv)')
    if r_inv:
        print(f"  {label:15s} | {'V38<=50 (inv)':25s} | {r_inv['n_closed']:>6} | {r_inv['wr']:>5.1f}% | {r_inv['pf']:>6.2f} | {r_inv['avg_ret']:>+7.2f}%")
    print()


# ═══════════════════════════════════════════════════════════════════════
# 6. VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("  🎯 VERDICT — Inversion Test")
print("=" * 90)

# مقارنة V38 original vs inverted
v38_orig_r = evaluate_subset([p for p in predictions if p['v38'] >= 50], 'V38 orig')
v38_inv_r = evaluate_subset([p for p in predictions if p['v38'] <= 50], 'V38 inv')

print(f"""
  V38 Comparison:
    Original (V38 >= 50): WR={v38_orig_r['wr']:.1f}%, PF={v38_orig_r['pf']:.2f}, avg_ret={v38_orig_r['avg_ret']:.2f}%
    Inverted (V38 <= 50): WR={v38_inv_r['wr']:.1f}%, PF={v38_inv_r['pf']:.2f}, avg_ret={v38_inv_r['avg_ret']:.2f}%
""")

if v38_inv_r['pf'] > 1.5 and v38_inv_r['pf'] > v38_orig_r['pf']:
    print("  🔥 V38 INVERTED مربح جداً (PF > 1.5)!")
    print("  → المشكلة في Signal Polarity — الـ V38 بيقرأ الإشارات بالمقلوب")
    print("  → لازم نصلح الـ V38 engine (يقلب الإشارات)")
elif v38_inv_r['pf'] > v38_orig_r['pf']:
    print("  ⚠️ V38 INVERTED أحسن من original (بس مش مربح جداً)")
    print("  → فيه Polarity issue بس مش كامل")
else:
    print("  ❌ V38 INVERTED مش أحسن من original")
    print("  → الـ V38 مجرد ضوضاء (Noise) — مفيش polarity issue")

print()

# مقارنة SMC
smc_orig_r = evaluate_subset([p for p in predictions if p['smc'] >= 50], 'SMC orig')
smc_inv_r = evaluate_subset([p for p in predictions if p['smc'] <= 50], 'SMC inv')

print(f"""
  SMC Comparison:
    Original (SMC >= 50): WR={smc_orig_r['wr']:.1f}%, PF={smc_orig_r['pf']:.2f}, avg_ret={smc_orig_r['avg_ret']:.2f}%
    Inverted (SMC <= 50): WR={smc_inv_r['wr']:.1f}%, PF={smc_inv_r['pf']:.2f}, avg_ret={smc_inv_r['avg_ret']:.2f}%
""")

if smc_inv_r['pf'] > 1.5 and smc_inv_r['pf'] > smc_orig_r['pf']:
    print("  🔥 SMC INVERTED مربح جداً (PF > 1.5)!")
    print("  → المشكلة في Signal Polarity — الـ SMC بيقرأ الإشارات بالمقلوب")
elif smc_inv_r['pf'] > smc_orig_r['pf']:
    print("  ⚠️ SMC INVERTED أحسن من original (بس مش مربح جداً)")
else:
    print("  ❌ SMC INVERTED مش أحسن من original")
    print("  → الـ SMC مجرد ضوضاء (Noise)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'inversion_test_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'n_clean_predictions': len(predictions),
        'baseline': evaluate_subset(predictions, 'baseline'),
        'v38_original': v38_orig_r,
        'v38_inverted': v38_inv_r,
        'smc_original': smc_orig_r,
        'smc_inverted': smc_inv_r,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Inversion Test خلص")
print("=" * 90)
