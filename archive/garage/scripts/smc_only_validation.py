#!/usr/bin/env python3
"""
smc_only_validation.py — SMC-only Backtest شامل + CPCV + Monte Carlo.

الـ framework:
  1. SMC = Score Producer الوحيد (بعد إصلاح الـ daily_closer)
  2. نشغل على كل التوقعات (مش بس closed)
  3. CPCV (15 combinations) للـ Generalization Ratio
  4. Monte Carlo (1000 simulations) للـ p-value
  5. Threshold audit: ليه SMC بـ يقبل 8 صفقات بس؟

المهم: ممنوع أي كلام عن "Edge" قبل ما العينة توصل 50 صفقة على الأقل.
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

print("=" * 90)
print("  🧪 BRAVO SMC-ONLY VALIDATION — بعد إصلاح daily_closer")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل التوقعات النظيفة (بعد إصلاح الـ 50% placeholder)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل التوقعات النظيفة...")

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

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
      AND actual_return != 0.0
    ORDER BY prediction_date
""").fetchall()
conn.close()

print(f"  Total clean closed: {len(all_rows)}")

# توزيع الـ returns
returns = [float(r['actual_return']) for r in all_rows]
wins = [r for r in returns if r > 0]
losses = [r for r in returns if r < 0]
print(f"  Wins: {len(wins)} | Losses: {len(losses)} | WR: {len(wins)/len(returns)*100:.1f}%")
print(f"  avg return: {sum(returns)/len(returns):.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل بيانات الأسعار + حساب SMC scores
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] حساب SMC scores لكل توقع...")

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

from analyzers.smc_engine import calculate_smc_score

predictions = []
smc_fail_count = 0

for idx, r in enumerate(all_rows):
    if idx % 50 == 0:
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

    # SMC score (with NO leakage — using hist data only)
    smc = 50.0
    try:
        # استخدم hist data (بدون اليوم الحالي) لـ تجنب leakage
        hist_candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                        for o, h, l, c, v in zip(opens[:-1], highs[:-1], lows[:-1], closes[:-1], volumes[:-1])]
        smc_r = calculate_smc_score(hist_candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        smc_fail_count += 1

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'actual_return': float(r['actual_return']),
        'holding_days': r['holding_days'] or 50,
        'smc': smc,
    })

print(f"  ✅ {len(predictions)} توقع بـ SMC scores")
print(f"  SMC fails: {smc_fail_count}")


# ═══════════════════════════════════════════════════════════════════════
# 3. THRESHOLD AUDIT — ليه SMC بـ يقبل 8 صفقات بس؟
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] Threshold Audit — توزيع SMC scores...")
print("="*90)

# توزيع الـ SMC scores
smc_scores = [p['smc'] for p in predictions]
print(f"\n  SMC score distribution:")
print(f"    count: {len(smc_scores)}")
print(f"    min:   {min(smc_scores):.1f}")
print(f"    max:   {max(smc_scores):.1f}")
print(f"    avg:   {sum(smc_scores)/len(smc_scores):.1f}")
print(f"    median: {sorted(smc_scores)[len(smc_scores)//2]:.1f}")

# توزيع الـ SMC بـ bands
print(f"\n  SMC score bands:")
bands = [(0, 10), (10, 20), (20, 30), (30, 40), (40, 50), (50, 60), (60, 70), (70, 80), (80, 90), (90, 100)]
print(f"  {'Band':10s} | {'count':>5} | {'wins':>4} | {'WR':>6} | {'avg_ret':>8}")
print("  " + "-"*50)
for lo, hi in bands:
    subset = [p for p in predictions if lo <= p['smc'] < hi]
    if not subset:
        continue
    wins_n = sum(1 for p in subset if p['status'] == 'TARGET_HIT')
    wr = wins_n/len(subset)*100 if subset else 0
    avg_ret = sum(p['actual_return'] for p in subset)/len(subset)
    print(f"  {lo:>3d}-{hi:<5d} | {len(subset):>5} | {wins_n:>4} | {wr:>5.1f}% | {avg_ret:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. SMC-ONLY BACKTEST على thresholds مختلفة
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] SMC-only Backtest على thresholds مختلفة...")
print("="*90)


def evaluate_smc_threshold(predictions, threshold):
    """قيم SMC بـ threshold معين."""
    accepted = [p for p in predictions if p['smc'] >= threshold]
    closed = [p for p in accepted if p['status'] in ('TARGET_HIT', 'STOPPED')]
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

    # Max Drawdown (position size = 2.5%)
    closed_sorted = sorted(closed, key=lambda p: p['pred_date'])
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    for p in closed_sorted:
        ret = p['actual_return']
        equity += ret * 0.025
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd

    return {
        'threshold': threshold,
        'n_accepted': len(accepted),
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'pf': pf,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'avg_ret': avg_ret,
        'max_dd': max_dd,
        'total_return': equity - 100,
    }


print(f"\n  {'Threshold':>10s} | {'accept':>6} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8}")
print("  " + "-"*80)

thresholds = [30, 40, 50, 60, 70, 80]
threshold_results = {}
for thr in thresholds:
    r = evaluate_smc_threshold(predictions, thr)
    threshold_results[thr] = r
    print(f"  {thr:>9d} | {r['n_accepted']:>6} | {r['n_closed']:>6} | {r['n_wins']:>4} | "
          f"{r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. CPCV على أفضل threshold
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] CPCV + Monte Carlo على أفضل threshold...")

# اختيار أفضل threshold (أعلى PF مع closed >= 10)
best_thr = max(threshold_results.values(), key=lambda x: x['pf'] if x['n_closed'] >= 10 else -1)
print(f"  Best threshold: {best_thr['threshold']} (PF = {best_thr['pf']:.2f}, closed = {best_thr['n_closed']})")

if best_thr['n_closed'] < 30:
    print(f"\n  ⚠️ Sample size = {best_thr['n_closed']} — أقل من 30")
    print(f"  ⚠️ النتايج دي مـشـ حاسمة إحصائياً")
    print(f"  ⚠️ محتاجين sample أكبر قبل أي استنتاج")

# CPCV: تقسيم لـ 6 groups
predictions_sorted = sorted(predictions, key=lambda p: p['pred_date'])
n_groups = 6
group_size = len(predictions_sorted) // n_groups
groups = []
for i in range(n_groups):
    start = i * group_size
    end = start + group_size if i < n_groups - 1 else len(predictions_sorted)
    groups.append(predictions_sorted[start:end])

combos = list(combinations(range(n_groups), 2))
print(f"\n  CPCV: {len(combos)} combinations (C({n_groups},2))")

cpcv_results = []
for test_group_idxs in combos:
    test_groups = [groups[i] for i in test_group_idxs]
    train_groups = [groups[i] for i in range(n_groups) if i not in test_group_idxs]

    train_data = sum(train_groups, [])
    test_data = sum(test_groups, [])

    train_r = evaluate_smc_threshold(train_data, best_thr['threshold'])
    test_r = evaluate_smc_threshold(test_data, best_thr['threshold'])

    gen_ratio = (test_r['wr'] / train_r['wr']) if train_r['wr'] > 0 else 0

    cpcv_results.append({
        'test_groups': test_group_idxs,
        'train_n': len(train_data),
        'test_n': len(test_data),
        'train_wr': train_r['wr'],
        'test_wr': test_r['wr'],
        'train_pf': train_r['pf'],
        'test_pf': test_r['pf'],
        'test_closed': test_r['n_closed'],
        'gen_ratio': gen_ratio,
    })

# عرض CPCV
print(f"\n  {'combo':12s} | {'train_n':>7} | {'test_n':>6} | {'train_WR':>8} | {'test_WR':>7} | {'train_PF':>8} | {'test_PF':>7} | {'test_closed':>11} | {'Gen':>5}")
print("  " + "-"*100)
for r in cpcv_results:
    combo = f"{r['test_groups'][0]+1},{r['test_groups'][1]+1}"
    print(f"  {combo:>12s} | {r['train_n']:>7} | {r['test_n']:>6} | "
          f"{r['train_wr']:>7.1f}% | {r['test_wr']:>6.1f}% | "
          f"{r['train_pf']:>8.2f} | {r['test_pf']:>7.2f} | "
          f"{r['test_closed']:>11} | {r['gen_ratio']:>5.2f}")

# إحصائيات CPCV
gen_ratios = [r['gen_ratio'] for r in cpcv_results if r['test_closed'] > 0]
test_pfs = [r['test_pf'] for r in cpcv_results if r['test_closed'] > 0]

if gen_ratios:
    print(f"\n  CPCV Statistics:")
    print(f"    combinations with test_closed > 0: {len(gen_ratios)} / {len(cpcv_results)}")
    print(f"    Gen Ratio: min={min(gen_ratios):.2f}, max={max(gen_ratios):.2f}, avg={sum(gen_ratios)/len(gen_ratios):.2f}")
    if test_pfs:
        print(f"    Test PF:   min={min(test_pfs):.2f}, max={max(test_pfs):.2f}, avg={sum(test_pfs)/len(test_pfs):.2f}")


# Monte Carlo
print(f"\n  Monte Carlo (1000 simulations)...")
N_SIMULATIONS = 1000
mc_pfs = []
mc_wrs = []
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

    r = evaluate_smc_threshold(shuffled, best_thr['threshold'])
    mc_pfs.append(r['pf'])
    mc_wrs.append(r['wr'])
    mc_returns.append(r['total_return'])

# إحصائيات MC
mc_pfs_sorted = sorted(mc_pfs)
mc_wrs_sorted = sorted(mc_wrs)
mc_returns_sorted = sorted(mc_returns)


def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100


print(f"\n  Monte Carlo Statistics on threshold = {best_thr['threshold']}:")
print(f"\n  {'Metric':15s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'p-value':>8s}")
print("  " + "-"*70)
print(f"  {'WR':15s} | {best_thr['wr']:>9.1f}% | {sum(mc_wrs)/len(mc_wrs):>9.1f}% | "
      f"{mc_wrs_sorted[len(mc_wrs)//2]:>9.1f}% | {p_value(best_thr['wr'], mc_wrs):>7.1f}%")
print(f"  {'Profit Factor':15s} | {best_thr['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | "
      f"{mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {p_value(best_thr['pf'], mc_pfs):>7.1f}%")
print(f"  {'Total Return':15s} | {best_thr['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | "
      f"{mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {p_value(best_thr['total_return'], mc_returns):>7.1f}%")


# VERDICT
print("\n" + "=" * 90)
print("  🎯 VERDICT — SMC-only Validation")
print("=" * 90)

pf_pvalue = p_value(best_thr['pf'], mc_pfs)
wr_pvalue = p_value(best_thr['wr'], mc_wrs)
ret_pvalue = p_value(best_thr['total_return'], mc_returns)

print(f"""
  Best Threshold: {best_thr['threshold']}
  Sample size: {best_thr['n_closed']} closed
  WR: {best_thr['wr']:.1f}% (p-value = {wr_pvalue:.1f}%)
  PF: {best_thr['pf']:.2f} (p-value = {pf_pvalue:.1f}%)
  Return: {best_thr['total_return']:.2f}% (p-value = {ret_pvalue:.1f}%)
""")

if best_thr['n_closed'] < 30:
    print(f"  ⚠️ WARNING: Sample size = {best_thr['n_closed']} (أقل من 30)")
    print(f"  ⚠️ النتايج دي مـشـ حاسمة إحصائياً")
    print(f"  ⚠️ محتاجين sample أكبر قبل أي استنتاج عن 'Edge'")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → edge حقيقي")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → مش edge")

if ret_pvalue < 5:
    print(f"  ✅ Return p-value = {ret_pvalue:.1f}% → return حقيقي")
else:
    print(f"  ❌ Return p-value = {ret_pvalue:.1f}% → مش return")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'smc_only_validation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'n_clean_predictions': len(predictions),
        'threshold_audit': threshold_results,
        'best_threshold': best_thr['threshold'],
        'best_threshold_results': best_thr,
        'cpcv': cpcv_results,
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'return_pvalue': ret_pvalue,
            'mc_pf_median': mc_pfs_sorted[len(mc_pfs)//2],
            'mc_wr_median': mc_wrs_sorted[len(mc_wrs)//2],
            'mc_return_median': mc_returns_sorted[len(mc_returns)//2],
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ SMC-only Validation خلص")
print("=" * 90)
