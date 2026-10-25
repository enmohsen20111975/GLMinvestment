#!/usr/bin/env python3
"""
mean_reversion_analysis.py — المرحلة 2: تحليل Mean Reversion في EGX.

الـ framework (per Mohsen's research):
  1. Mean Reversion: شراء الأسهم النازلة بشدة (oversold) + بيع عند الارتداد
  2. اختبار thresholds مختلفة (drop 5%, 10%, 15%)
  3. اختبار holding periods مختلفة (1, 3, 5, 10 أيام)
  4. اختبار exit strategies (SMA20 return + fixed days)
  5. Regime filter: بس في bull/range (مش bear)

الـ logic:
  - بدل momentum (شراء الصاعد)، نـجرب contrarian (شراء النازل)
  - الأسهم النازلة بـ 5-10% في 3-5 أيام → إشارة شراء
  - exit لما يـرجع لـ SMA20 أو بعد N أيام
"""
import sys
import os
import json
import sqlite3
import random
import statistics
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO MEAN REVERSION ANALYSIS — المرحلة 2")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل كل الأسهم المتاحة (مش بس الـ predictions)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل كل الأسهم المتاحة من price_history.db...")

ph_db = DB_DIR / 'price_history.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
ph_conn = db_manager.connection(str(ph_db), writable=False).__enter__()
ph_conn.row_factory = sqlite3.Row

# كل tickers مع data كافية (200+ يوم)
tickers = ph_conn.execute("""
    SELECT ticker, COUNT(*) as cnt, MIN(date) as first_date, MAX(date) as last_date
    FROM price_history
    GROUP BY ticker
    HAVING cnt >= 200
    ORDER BY ticker
""").fetchall()

print(f"  ✅ {len(tickers)} ticker مع 200+ يوم بيانات")

# الفترة: 2024-01-01 → 2026-10-31 (3 سنين)
START_DATE = '2024-01-01'
END_DATE = '2026-10-31'

# فلتر tickers متاحة في الفترة (لها بيانات في الفترة)
valid_tickers = [t for t in tickers if t['last_date'] >= START_DATE]
print(f"  ✅ {len(valid_tickers)} ticker متاح في الفترة {START_DATE} → {END_DATE}")

# تحميل كل البيانات لكل ticker
ticker_data = {}
for t in valid_tickers:
    hist = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history 
        WHERE ticker = ? AND date >= ? AND date <= ?
        ORDER BY date
    """, (t['ticker'], START_DATE, END_DATE)).fetchall()
    if len(hist) >= 200:
        # فلتر None values
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None]
        if len(filtered) >= 200:
            ticker_data[t['ticker']] = filtered

ph_conn.close()
print(f"  ✅ {len(ticker_data)} ticker بـ data نظيفة")


# ═══════════════════════════════════════════════════════════════════════
# 2. بناء Mean Reversion signals
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] بناء Mean Reversion signals...")

def calc_sma(values, period):
    """حساب SMA."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def calc_regime(closes, idx):
    """تحديد regime: BULL/RANGE/BEAR."""
    if idx < 50:
        return 'RANGE'
    ma20 = sum(closes[idx-20:idx]) / 20
    ma50 = sum(closes[idx-50:idx]) / 50
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if idx >= 20 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'


def generate_mean_reversion_signals(ticker_data, drop_threshold, lookback_days, holding_days, regime_filter=None):
    """توليد إشارات Mean Reversion."""
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(lookback_days + 50, len(closes) - holding_days):
            # حساب الـ drop في آخر lookback_days
            current_close = closes[i]
            past_close = closes[i - lookback_days]
            drop_pct = ((past_close - current_close) / past_close) * 100
            
            # إشارة شراء لو drop >= threshold
            if drop_pct >= drop_threshold:
                # regime filter
                regime = calc_regime(closes, i)
                if regime_filter and regime not in regime_filter:
                    continue
                
                # entry = current close
                entry = current_close
                entry_date = dates[i]
                
                # exit بعد holding_days
                exit_idx = min(i + holding_days, len(closes) - 1)
                exit = closes[exit_idx]
                exit_date = dates[exit_idx]
                
                # return
                ret = ((exit - entry) / entry) * 100
                
                # SMA20 exit (لو السعر رجع لـ SMA20)
                sma20 = calc_sma(closes[:i+1], 20)
                sma20_exit = None
                for j in range(i+1, min(i + holding_days + 1, len(closes))):
                    s = calc_sma(closes[:j+1], 20)
                    if s and closes[j] >= s:
                        sma20_exit = closes[j]
                        sma20_exit_date = dates[j]
                        break
                
                sma20_ret = None
                if sma20_exit:
                    sma20_ret = ((sma20_exit - entry) / entry) * 100
                
                # stop loss 5%
                sl = entry * 0.95
                sl_hit = False
                for j in range(i+1, min(i + holding_days + 1, len(closes))):
                    if closes[j] <= sl:
                        sl_hit = True
                        sl_ret = ((closes[j] - entry) / entry) * 100
                        break
                
                # determine final outcome
                if sl_hit:
                    final_ret = sl_ret
                    outcome = 'STOPPED'
                elif sma20_ret is not None and sma20_ret > ret:
                    final_ret = sma20_ret
                    outcome = 'TARGET_HIT' if sma20_ret > 0 else 'STOPPED'
                else:
                    final_ret = ret
                    outcome = 'TARGET_HIT' if ret > 0 else 'STOPPED'
                
                signals.append({
                    'ticker': ticker,
                    'entry_date': entry_date,
                    'exit_date': exit_date,
                    'entry': entry,
                    'exit': exit if not sl_hit else sl,
                    'return': final_ret,
                    'outcome': outcome,
                    'regime': regime,
                    'drop_pct': drop_pct,
                    'sma20_return': sma20_ret,
                    'sl_hit': sl_hit,
                })
    
    return signals


# ═══════════════════════════════════════════════════════════════════════
# 3. اختبار scenarios مختلفة
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] اختبار Mean Reversion scenarios...")

scenarios = [
    {'name': 'drop5_lbw3_hold5', 'drop': 5, 'lookback': 3, 'holding': 5, 'regime': None},
    {'name': 'drop5_lbw3_hold10', 'drop': 5, 'lookback': 3, 'holding': 10, 'regime': None},
    {'name': 'drop10_lbw3_hold5', 'drop': 10, 'lookback': 3, 'holding': 5, 'regime': None},
    {'name': 'drop10_lbw5_hold5', 'drop': 10, 'lookback': 5, 'holding': 5, 'regime': None},
    {'name': 'drop10_lbw5_hold10', 'drop': 10, 'lookback': 5, 'holding': 10, 'regime': None},
    {'name': 'drop15_lbw5_hold5', 'drop': 15, 'lookback': 5, 'holding': 5, 'regime': None},
    {'name': 'drop10_lbw5_hold5_bull', 'drop': 10, 'lookback': 5, 'holding': 5, 'regime': ['BULL']},
    {'name': 'drop10_lbw5_hold5_range', 'drop': 10, 'lookback': 5, 'holding': 5, 'regime': ['RANGE']},
    {'name': 'drop10_lbw5_hold5_bull_range', 'drop': 10, 'lookback': 5, 'holding': 5, 'regime': ['BULL', 'RANGE']},
]


def evaluate_signals(signals, position_size=0.025):
    """قيم signals."""
    if not signals:
        return None
    
    closed = signals  # كلها closed
    wins = [s for s in closed if s['outcome'] == 'TARGET_HIT']
    losses = [s for s in closed if s['outcome'] == 'STOPPED']
    
    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0
    
    win_returns = [s['return'] for s in wins]
    loss_returns = [s['return'] for s in losses]
    
    gross_profit = sum(r for r in win_returns if r > 0)
    gross_loss = sum(abs(r) for r in loss_returns if r < 0)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    
    avg_win = sum(win_returns)/len(win_returns) if win_returns else 0
    avg_loss = sum(loss_returns)/len(loss_returns) if loss_returns else 0
    avg_ret = sum(s['return'] for s in closed) / n_closed if n_closed > 0 else 0
    
    # Max Drawdown
    closed_sorted = sorted(closed, key=lambda s: s['entry_date'])
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    max_consec = 0
    current_consec = 0
    for s in closed_sorted:
        ret = s['return']
        equity += ret * position_size
        if equity > peak:
            peak = equity
            current_consec = 0
        else:
            current_consec += 1
            if current_consec > max_consec:
                max_consec = current_consec
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd
    
    return {
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'pf': pf,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'avg_ret': avg_ret,
        'max_dd': max_dd,
        'max_consec': max_consec,
        'total_return': equity - 100,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
    }


print(f"\n  {'Scenario':35s} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'MaxConsec':>9} | {'Return':>8}")
print("  " + "-"*100)

scenario_results = {}
for scen in scenarios:
    signals = generate_mean_reversion_signals(
        ticker_data,
        drop_threshold=scen['drop'],
        lookback_days=scen['lookback'],
        holding_days=scen['holding'],
        regime_filter=scen['regime'],
    )
    r = evaluate_signals(signals)
    if r:
        scenario_results[scen['name']] = r
        print(f"  {scen['name']:35s} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | "
              f"{r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['max_consec']:>9} | {r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. Monte Carlo على أفضل scenario
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Monte Carlo على أفضل scenario...")

# اختيار أفضل scenario (أعلى PF مع closed >= 30)
best_scen = max(scenario_results.items(), key=lambda x: x[1]['pf'] if x[1]['n_closed'] >= 30 else -1)
best_name = best_scen[0]
best_r = best_scen[1]
print(f"  Best scenario: {best_name} (PF = {best_r['pf']:.2f}, closed = {best_r['n_closed']})")

# إعادة generate signals للـ best scenario
best_scen_config = next(s for s in scenarios if s['name'] == best_name)
best_signals = generate_mean_reversion_signals(
    ticker_data,
    drop_threshold=best_scen_config['drop'],
    lookback_days=best_scen_config['lookback'],
    holding_days=best_scen_config['holding'],
    regime_filter=best_scen_config['regime'],
)

# Monte Carlo
N_SIMULATIONS = 1000
mc_pfs = []
mc_wrs = []
mc_returns = []
mc_dds = []

random.seed(42)

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)
    
    # shuffle returns
    returns = [s['return'] for s in best_signals]
    random.shuffle(returns)
    
    shuffled = [{**s, 'return': returns[i]} for i, s in enumerate(best_signals)]
    # shuffle outcomes too
    outcomes = [s['outcome'] for s in best_signals]
    random.shuffle(outcomes)
    for i, s in enumerate(shuffled):
        s['outcome'] = outcomes[i]
    
    r = evaluate_signals(shuffled)
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


print(f"\n  Monte Carlo Statistics ({N_SIMULATIONS} simulations) on {best_name}:")
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
print("  🎯 VERDICT — Mean Reversion Analysis")
print("=" * 90)

pf_pvalue = p_value(best_r['pf'], mc_pfs)
wr_pvalue = p_value(best_r['wr'], mc_wrs)
ret_pvalue = p_value(best_r['total_return'], mc_returns)

print(f"""
  Best Scenario: {best_name}
  Sample size: {best_r['n_closed']} closed
  WR: {best_r['wr']:.1f}% (p-value = {wr_pvalue:.1f}%)
  PF: {best_r['pf']:.2f} (p-value = {pf_pvalue:.1f}%)
  Return: {best_r['total_return']:.2f}% (p-value = {ret_pvalue:.1f}%)
  Max Drawdown: {best_r['max_dd']:.1f}%
  Max Consecutive Losses: {best_r['max_consec']}
""")

if best_r['n_closed'] >= 30:
    print(f"  ✅ Sample size = {best_r['n_closed']} (أكبر من 30 — إحصائياً موثوق)")
else:
    print(f"  ⚠️ Sample size = {best_r['n_closed']} (أقل من 30)")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → edge حقيقي!")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → مش edge")

if ret_pvalue < 5:
    print(f"  ✅ Return p-value = {ret_pvalue:.1f}% → return حقيقي!")
else:
    print(f"  ❌ Return p-value = {ret_pvalue:.1f}% → مش return")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': f'{START_DATE} → {END_DATE}',
        'n_tickers': len(ticker_data),
        'scenarios': {name: r for name, r in scenario_results.items()},
        'best_scenario': best_name,
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'return_pvalue': ret_pvalue,
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Mean Reversion Analysis خلص")
print("=" * 90)
