#!/usr/bin/env python3
"""
no_v38_validation.py — اختبار بدون V38 كـ Score Producer.

الـ paradigm الجديد (per Mohsen's directive):
  - V38 = Trend Filter فقط (مش Score Producer)
  - Score = SMC + VP + Wyckoff + Core (مدخلات مستمرة)

الـ logic:
  1. V38 Filter: لازم يكون إيجابي (score >= 50) عشان نـقبل السهم
  2. لو V38 إيجابي → نحسب Score من SMC + VP + Wyckoff + Core
  3. الـ Score ده اللي بنـختبره

الـ scenarios:
  S0_v38_dominant:   V38 = Score Producer (القديم — فيه خلل)
  S1_v38_filter_only: V38 = Filter فقط، Score = SMC+VP+Core (no Wyckoff)
  S2_v38_filter_wyckoff: V38 = Filter، Score = SMC+VP+Core+Wyckoff
  S3_no_v38:         مفيش V38 خالص، Score = SMC+VP+Core+Wyckoff
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime
from pathlib import Path
from collections import Counter
from itertools import combinations

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))

from wyckoff_state_machine import detect_wyckoff_phase, get_threshold, is_exit_pattern

print("=" * 90)
print("  🧪 BRAVO NO-V38 VALIDATION — V38 as Filter, not Score Producer")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل التوقعات + حساب inputs
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل التوقعات + حساب inputs...")

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status, actual_return
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= '2025-08-01' AND prediction_date <= '2026-10-31'
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
    ORDER BY prediction_date
""").fetchall()
conn.close()

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
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
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
for idx, r in enumerate(all_rows):
    if idx % 200 == 0:
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
    vp_result = None
    try:
        vp_result = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_result and vp_result.score is not None:
            vp = float(vp_result.score)
    except Exception:
        pass

    regime = 'RANGE'
    try:
        if len(closes) >= 50:
            ma20 = sum(closes[-20:]) / 20
            ma50 = sum(closes[-50:]) / 50
            roc20 = (closes[-1] - closes[-20]) / closes[-20] * 100
            if ma20 > ma50 * 1.02 and roc20 > 2:
                regime = 'BULL'
            elif ma20 < ma50 * 0.98 and roc20 < -2:
                regime = 'BEAR'
    except Exception:
        pass

    cycle = 'RANGE'
    cycle_confidence = 0.5
    try:
        ctx = detect_wyckoff_phase(closes, highs, lows, volumes, vp_result)
        cycle = ctx.phase
        cycle_confidence = ctx.confidence
    except Exception:
        pass

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'actual_return': float(r['actual_return']) if r['actual_return'] is not None else None,
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'regime': regime, 'cycle': cycle, 'cycle_confidence': cycle_confidence,
    })

print(f"  ✅ {len(predictions)} توقع بـ inputs")


# ═══════════════════════════════════════════════════════════════════════
# 2. الـ SCENARIOS الجديدة (بدون V38 كـ Score Producer)
# ═══════════════════════════════════════════════════════════════════════

# Wyckoff phase → score (continuous, not boolean)
WYCKOFF_SCORE = {
    'STOPPING_ACTION': 30,    # selling climax — risky
    'SPRING': 70,             # false breakdown — bullish signal
    'ACCUMULATION': 65,       # in range + accumulating — bullish
    'MARKUP_START': 85,       # breakout — strong bullish
    'MARKUP_MID': 75,         # trending up — bullish
    'DISTRIBUTION_START': 25, # topping — bearish
    'DISTRIBUTION_MID': 35,   # in range + distributing — bearish
    'RANGE': 50,              # neutral
    'MARKDOWN': 20,           # below range — bearish
    'INSUFFICIENT_DATA': 50,
}


def evaluate_scenario(predictions, scenario_name):
    """قيم scenario واحد."""
    accepted = []
    skipped_v38_filter = 0
    skipped_threshold = 0

    for p in predictions:
        # === V38 FILTER (مش Score Producer) ===
        if scenario_name in ('S1_v38_filter_only', 'S2_v38_filter_wyckoff'):
            if p['v38'] < 50:  # V38 لازم يكون إيجابي
                skipped_v38_filter += 1
                continue

        # === حساب Score ===
        if scenario_name == 'S0_v38_dominant':
            # القديم: V38 = Score Producer (75%) + SMC (15%) + VP (10%)
            score = p['v38'] * 0.75 + p['smc'] * 0.15 + p['vp'] * 0.10
            threshold = 65
        elif scenario_name == 'S1_v38_filter_only':
            # V38 = Filter، Score = SMC (40%) + VP (30%) + Core (30%)
            score = p['smc'] * 0.40 + p['vp'] * 0.30 + p['core'] * 0.30
            threshold = 50
        elif scenario_name == 'S2_v38_filter_wyckoff':
            # V38 = Filter، Score = SMC (35%) + VP (25%) + Core (20%) + Wyckoff (20%)
            wyckoff_score = WYCKOFF_SCORE.get(p['cycle'], 50)
            score = p['smc'] * 0.35 + p['vp'] * 0.25 + p['core'] * 0.20 + wyckoff_score * 0.20
            threshold = 50
        elif scenario_name == 'S3_no_v38':
            # مفيش V38 خالص، Score = SMC (35%) + VP (25%) + Core (20%) + Wyckoff (20%)
            wyckoff_score = WYCKOFF_SCORE.get(p['cycle'], 50)
            score = p['smc'] * 0.35 + p['vp'] * 0.25 + p['core'] * 0.20 + wyckoff_score * 0.20
            threshold = 50
        else:
            continue

        score = max(0, min(100, round(score, 2)))

        if score < threshold:
            skipped_threshold += 1
            continue

        accepted.append(p)

    closed = [p for p in accepted if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']
    losses = [p for p in closed if p['status'] == 'STOPPED']

    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0

    win_returns = [float(p['actual_return']) for p in wins if p['actual_return'] is not None]
    loss_returns = [float(p['actual_return']) for p in losses if p['actual_return'] is not None]

    gross_profit = sum(r for r in win_returns if r > 0)
    gross_loss = sum(abs(r) for r in loss_returns if r < 0)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0

    # Max Drawdown
    closed_sorted = sorted(closed, key=lambda p: p['pred_date'])
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    POSITION_SIZE = 0.025
    for p in closed_sorted:
        if p['actual_return'] is not None:
            ret = float(p['actual_return'])
            equity_change = (ret / 100) * POSITION_SIZE * 100
            equity += equity_change
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak * 100
            if dd > max_dd:
                max_dd = dd

    return {
        'scenario': scenario_name,
        'n_total': len(predictions),
        'n_accepted': len(accepted),
        'n_skipped_v38': skipped_v38_filter,
        'n_skipped_thr': skipped_threshold,
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'pf': pf,
        'max_dd': max_dd,
        'total_return': equity - 100,
        'avg_win': sum(win_returns)/len(win_returns) if win_returns else 0,
        'avg_loss': sum(loss_returns)/len(loss_returns) if loss_returns else 0,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. تشغيل كل scenarios
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] تشغيل scenarios...")

scenarios = ['S0_v38_dominant', 'S1_v38_filter_only', 'S2_v38_filter_wyckoff', 'S3_no_v38']
results = {}
for s in scenarios:
    results[s] = evaluate_scenario(predictions, s)

# عرض النتائج
print("\n" + "=" * 110)
print("  📊 SCENARIOS COMPARISON — V38 as Filter vs Score Producer")
print("=" * 110)

print(f"\n  {'Scenario':25s} | {'accept':>6} | {'skipV38':>7} | {'skipThr':>7} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8}")
print("  " + "-" * 105)

for s in scenarios:
    r = results[s]
    print(f"  {s:25s} | {r['n_accepted']:>6} | {r['n_skipped_v38']:>7} | {r['n_skipped_thr']:>7} | "
          f"{r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | "
          f"{r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. Monte Carlo على أفضل scenario
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] Monte Carlo على أفضل scenario...")

# اختيار أفضل scenario (أعلى PF مع closed كافي)
best_scenario = max(results.values(), key=lambda x: x['pf'] if x['n_closed'] >= 20 else -1)
print(f"  Best scenario: {best_scenario['scenario']} (PF = {best_scenario['pf']:.2f})")

# Monte Carlo على الـ best scenario
N_SIMULATIONS = 1000
mc_wrs = []
mc_pfs = []
mc_dds = []
mc_returns = []

random.seed(42)

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)

    # shuffle
    shuffled = []
    statuses_returns = [(p['status'], p['actual_return']) for p in predictions]
    random.shuffle(statuses_returns)
    for i, p in enumerate(predictions):
        shuffled.append({**p, 'status': statuses_returns[i][0], 'actual_return': statuses_returns[i][1]})

    metrics = evaluate_scenario(shuffled, best_scenario['scenario'])
    mc_wrs.append(metrics['wr'])
    mc_pfs.append(metrics['pf'])
    mc_dds.append(metrics['max_dd'])
    mc_returns.append(metrics['total_return'])

# إحصائيات MC
mc_wrs_sorted = sorted(mc_wrs)
mc_pfs_sorted = sorted(mc_pfs)
mc_dds_sorted = sorted(mc_dds)
mc_returns_sorted = sorted(mc_returns)


def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100


print(f"\n  Monte Carlo Statistics ({N_SIMULATIONS} simulations) on {best_scenario['scenario']}:")
print(f"\n  {'Metric':15s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'MC 5th':>10s} | {'MC 95th':>10s} | {'p-value':>8s}")
print("  " + "-" * 95)

print(f"  {'WR':15s} | {best_scenario['wr']:>9.1f}% | {sum(mc_wrs)/len(mc_wrs):>9.1f}% | "
      f"{mc_wrs_sorted[len(mc_wrs)//2]:>9.1f}% | {mc_wrs_sorted[int(len(mc_wrs)*0.05)]:>9.1f}% | "
      f"{mc_wrs_sorted[int(len(mc_wrs)*0.95)]:>9.1f}% | {p_value(best_scenario['wr'], mc_wrs):>7.1f}%")

print(f"  {'Profit Factor':15s} | {best_scenario['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | "
      f"{mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {mc_pfs_sorted[int(len(mc_pfs)*0.05)]:>10.2f} | "
      f"{mc_pfs_sorted[int(len(mc_pfs)*0.95)]:>10.2f} | {p_value(best_scenario['pf'], mc_pfs):>7.1f}%")

print(f"  {'Max Drawdown':15s} | {best_scenario['max_dd']:>9.1f}% | {sum(mc_dds)/len(mc_dds):>9.1f}% | "
      f"{mc_dds_sorted[len(mc_dds)//2]:>9.1f}% | {mc_dds_sorted[int(len(mc_dds)*0.05)]:>9.1f}% | "
      f"{mc_dds_sorted[int(len(mc_dds)*0.95)]:>9.1f}% | {p_value(best_scenario['max_dd'], mc_dds, False):>7.1f}%")

print(f"  {'Total Return':15s} | {best_scenario['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | "
      f"{mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {mc_returns_sorted[int(len(mc_returns)*0.05)]:>9.2f}% | "
      f"{mc_returns_sorted[int(len(mc_returns)*0.95)]:>9.2f}% | {p_value(best_scenario['total_return'], mc_returns):>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. Verdict
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] Verdict...")
print("\n" + "=" * 90)
print("  🎯 VERDICT — بعد إصلاح Data Leakage + V38 as Filter")
print("=" * 90)

wr_pvalue = p_value(best_scenario['wr'], mc_wrs)
pf_pvalue = p_value(best_scenario['pf'], mc_pfs)

print(f"""
  Best Scenario: {best_scenario['scenario']}
  Baseline WR: {best_scenario['wr']:.1f}% | MC median WR: {mc_wrs_sorted[len(mc_wrs)//2]:.1f}% | p-value: {wr_pvalue:.1f}%
  Baseline PF: {best_scenario['pf']:.2f} | MC median PF: {mc_pfs_sorted[len(mc_pfs)//2]:.2f} | p-value: {pf_pvalue:.1f}%
  Max Drawdown: {best_scenario['max_dd']:.1f}%
  Total Return: {best_scenario['total_return']:.2f}%

  التفسير:
  - p-value < 5% = النظام أحسن من random (edge حقيقي)
  - p-value > 5% = النظام مش أحسن من random (لا edge)
""")

if wr_pvalue < 5:
    print(f"  ✅ WR p-value = {wr_pvalue:.1f}% → النظام أحسن من random")
else:
    print(f"  ❌ WR p-value = {wr_pvalue:.1f}% → النظام مش أحسن من random")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → النظام مربح أكثر من random")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → النظام مش مربح أكثر من random")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'no_v38_validation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'scenarios': results,
        'best_scenario': best_scenario['scenario'],
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'mc_wr_median': mc_wrs_sorted[len(mc_wrs)//2],
            'mc_pf_median': mc_pfs_sorted[len(mc_pfs)//2],
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ NO-V38 VALIDATION خلص")
print("=" * 90)
