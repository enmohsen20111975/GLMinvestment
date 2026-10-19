#!/usr/bin/env python3
"""
smc_deep_validation.py — SMC Backtest طويل (2024-2026) بـ SMC engine محسّن.

الـ framework:
  1. SMC engine بـ inputs صحيحة (sma200 + volume_ratio + rsi)
  2. Backtest على فترة طويلة (2024-2026)
  3. threshold = 40 + 50 بس (مش 60-70)
  4. Monte Carlo + Max Drawdown
  5. ممنوع V38 + VP + Core (SMC بس)
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

print("=" * 90)
print("  🧪 BRAVO SMC DEEP VALIDATION — Backtest طويل (2024-2026)")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل التوقعات النظيفة (فترة طويلة)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل التوقعات النظيفة (2024-2026)...")

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, technical_score,
           entry_price, target_price, stop_loss, status, actual_return,
           exit_type, holding_days
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= '2024-01-01' AND prediction_date <= '2026-10-31'
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
      AND status IN ('TARGET_HIT', 'STOPPED')
      AND actual_return IS NOT NULL
      AND actual_return != 0.0
    ORDER BY prediction_date
""").fetchall()
conn.close()

print(f"  Total clean closed: {len(all_rows)}")

# توزيع زمني
years = Counter(r['prediction_date'][:4] for r in all_rows)
print(f"\n  Distribution by year:")
for y, cnt in sorted(years.items()):
    print(f"    {y}: {cnt}")


# ═══════════════════════════════════════════════════════════════════════
# 2. حساب SMC scores بـ inputs صحيحة
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] حساب SMC scores بـ inputs صحيحة (sma200 + vol_ratio + rsi)...")

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
        ORDER BY date DESC LIMIT 250
    """, (ticker, pred_date)).fetchall()
    if len(hist) >= 50:
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


def calc_rsi(closes, period=14):
    """حساب RSI بسيط."""
    if len(closes) < period + 1:
        return 50.0
    gains = []
    losses = []
    for i in range(1, period + 1):
        change = closes[-i] - closes[-i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


predictions = []
smc_fail_count = 0

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
    if len(filtered) < 50:
        continue
    opens = [f[0] for f in filtered]
    highs = [f[1] for f in filtered]
    lows = [f[2] for f in filtered]
    closes = [f[3] for f in filtered]
    volumes = [f[4] for f in filtered]

    # SMC inputs صحيحة
    current_price = closes[-1]
    
    # SMA200
    sma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else sum(closes) / len(closes)
    
    # Volume ratio
    avg_vol_20 = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
    current_vol = volumes[-1] if volumes else 0
    vol_ratio = current_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0
    
    # RSI
    rsi = calc_rsi(closes, 14)
    
    # SMC score بـ inputs صحيحة
    smc = 50.0
    try:
        # استخدم hist data (بدون اليوم الحالي) لـ تجنب leakage
        hist_candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                        for o, h, l, c, v in zip(opens[:-1], highs[:-1], lows[:-1], closes[:-1], volumes[:-1])]
        smc_r = calculate_smc_score(
            hist_candles, current_price,
            volume_ratio=vol_ratio,
            rsi=rsi,
            sma200=sma200,
        )
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
        'smc_signals': smc_r.get('signals', []) if isinstance(smc_r, dict) else [],
    })

print(f"  ✅ {len(predictions)} توقع بـ SMC scores (بـ inputs صحيحة)")
print(f"  SMC fails: {smc_fail_count}")

# توزيع الـ SMC scores
smc_scores = [p['smc'] for p in predictions]
print(f"\n  SMC score distribution:")
print(f"    count: {len(smc_scores)}")
print(f"    min:   {min(smc_scores):.1f}")
print(f"    max:   {max(smc_scores):.1f}")
print(f"    avg:   {sum(smc_scores)/len(smc_scores):.1f}")
print(f"    median: {sorted(smc_scores)[len(smc_scores)//2]:.1f}")


# ═══════════════════════════════════════════════════════════════════════
# 3. SMC-only Backtest على thresholds 40 + 50
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] SMC-only Backtest على thresholds 40 + 50...")


def evaluate_smc_threshold(predictions, threshold):
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
    max_consecutive_losses = 0
    current_consecutive = 0
    for p in closed_sorted:
        ret = p['actual_return']
        equity += ret * 0.025
        if equity > peak:
            peak = equity
            current_consecutive = 0
        else:
            current_consecutive += 1
            if current_consecutive > max_consecutive_losses:
                max_consecutive_losses = current_consecutive
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
        'max_consecutive_losses': max_consecutive_losses,
        'total_return': equity - 100,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
    }


print(f"\n  {'Threshold':>10s} | {'accept':>6} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'MaxConsec':>10} | {'Return':>8}")
print("  " + "-"*90)

thresholds = [40, 50]
threshold_results = {}
for thr in thresholds:
    r = evaluate_smc_threshold(predictions, thr)
    threshold_results[thr] = r
    print(f"  {thr:>9d} | {r['n_accepted']:>6} | {r['n_closed']:>6} | {r['n_wins']:>4} | "
          f"{r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['max_consecutive_losses']:>10} | {r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. Monte Carlo على threshold = 40
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Monte Carlo على threshold = 40 (1000 simulations)...")

best_thr = 40
N_SIMULATIONS = 1000
mc_pfs = []
mc_wrs = []
mc_returns = []
mc_dds = []

random.seed(42)

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)

    shuffled = []
    statuses_returns = [(p['status'], p['actual_return']) for p in predictions]
    random.shuffle(statuses_returns)
    for i, p in enumerate(predictions):
        shuffled.append({**p, 'status': statuses_returns[i][0], 'actual_return': statuses_returns[i][1]})

    r = evaluate_smc_threshold(shuffled, best_thr)
    mc_pfs.append(r['pf'])
    mc_wrs.append(r['wr'])
    mc_returns.append(r['total_return'])
    mc_dds.append(r['max_dd'])

# إحصائيات MC
mc_pfs_sorted = sorted(mc_pfs)
mc_wrs_sorted = sorted(mc_wrs)
mc_returns_sorted = sorted(mc_returns)
mc_dds_sorted = sorted(mc_dds)


def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100


best_r = threshold_results[best_thr]
print(f"\n  Monte Carlo Statistics on threshold = {best_thr}:")
print(f"\n  {'Metric':20s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'MC 5th':>10s} | {'MC 95th':>10s} | {'p-value':>8s}")
print("  " + "-"*100)

print(f"  {'WR':20s} | {best_r['wr']:>9.1f}% | {sum(mc_wrs)/len(mc_wrs):>9.1f}% | "
      f"{mc_wrs_sorted[len(mc_wrs)//2]:>9.1f}% | {mc_wrs_sorted[int(len(mc_wrs)*0.05)]:>9.1f}% | "
      f"{mc_wrs_sorted[int(len(mc_wrs)*0.95)]:>9.1f}% | {p_value(best_r['wr'], mc_wrs):>7.1f}%")

print(f"  {'Profit Factor':20s} | {best_r['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | "
      f"{mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {mc_pfs_sorted[int(len(mc_pfs)*0.05)]:>10.2f} | "
      f"{mc_pfs_sorted[int(len(mc_pfs)*0.95)]:>10.2f} | {p_value(best_r['pf'], mc_pfs):>7.1f}%")

print(f"  {'Max Drawdown':20s} | {best_r['max_dd']:>9.1f}% | {sum(mc_dds)/len(mc_dds):>9.1f}% | "
      f"{mc_dds_sorted[len(mc_dds)//2]:>9.1f}% | {mc_dds_sorted[int(len(mc_dds)*0.05)]:>9.1f}% | "
      f"{mc_dds_sorted[int(len(mc_dds)*0.95)]:>9.1f}% | {p_value(best_r['max_dd'], mc_dds, False):>7.1f}%")

print(f"  {'Total Return':20s} | {best_r['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | "
      f"{mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {mc_returns_sorted[int(len(mc_returns)*0.05)]:>9.2f}% | "
      f"{mc_returns_sorted[int(len(mc_returns)*0.95)]:>9.2f}% | {p_value(best_r['total_return'], mc_returns):>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] Verdict...")
print("\n" + "=" * 90)
print("  🎯 VERDICT — SMC Deep Validation (2024-2026)")
print("=" * 90)

pf_pvalue = p_value(best_r['pf'], mc_pfs)
wr_pvalue = p_value(best_r['wr'], mc_wrs)
ret_pvalue = p_value(best_r['total_return'], mc_returns)
dd_pvalue = p_value(best_r['max_dd'], mc_dds, False)

print(f"""
  Period: 2024-01-01 → 2026-10-31
  Total clean predictions: {len(predictions)}
  SMC threshold: {best_thr}
  Sample size: {best_r['n_closed']} closed
  WR: {best_r['wr']:.1f}% (p-value = {wr_pvalue:.1f}%)
  PF: {best_r['pf']:.2f} (p-value = {pf_pvalue:.1f}%)
  Return: {best_r['total_return']:.2f}% (p-value = {ret_pvalue:.1f}%)
  Max Drawdown: {best_r['max_dd']:.1f}% (p-value = {dd_pvalue:.1f}%)
  Max Consecutive Losses: {best_r['max_consecutive_losses']}
""")

if best_r['n_closed'] >= 30:
    print(f"  ✅ Sample size = {best_r['n_closed']} (أكبر من 30 — إحصائياً موثوق)")
else:
    print(f"  ⚠️ Sample size = {best_r['n_closed']} (أقل من 30)")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → edge حقيقي")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → مش edge")

if ret_pvalue < 5:
    print(f"  ✅ Return p-value = {ret_pvalue:.1f}% → return حقيقي")
else:
    print(f"  ❌ Return p-value = {ret_pvalue:.1f}% → مش return")

if best_r['max_dd'] > 15:
    print(f"  ⚠️ Max Drawdown = {best_r['max_dd']:.1f}% → مرتفع (أكتر من 15%)")
else:
    print(f"  ✅ Max Drawdown = {best_r['max_dd']:.1f}% → مقبول (أقل من 15%)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'smc_deep_validation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': '2024-01-01 → 2026-10-31',
        'n_clean_predictions': len(predictions),
        'smc_score_stats': {
            'min': min(smc_scores),
            'max': max(smc_scores),
            'avg': sum(smc_scores)/len(smc_scores),
            'median': sorted(smc_scores)[len(smc_scores)//2],
        },
        'threshold_results': threshold_results,
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'return_pvalue': ret_pvalue,
            'dd_pvalue': dd_pvalue,
            'mc_pf_median': mc_pfs_sorted[len(mc_pfs)//2],
            'mc_wr_median': mc_wrs_sorted[len(mc_wrs)//2],
            'mc_return_median': mc_returns_sorted[len(mc_returns)//2],
            'mc_dd_median': mc_dds_sorted[len(mc_dds)//2],
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ SMC Deep Validation خلص")
print("=" * 90)
