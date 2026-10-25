#!/usr/bin/env python3
"""
null_model_test.py — Null Model حقيقي: مقارنة الإشارة vs دخول عشوائي.

الـ framework:
  1. Strategy signals: drop 15% in 5 days → buy (Mean Reversion)
  2. Null Model: random entry on any day (NOT based on drop)
     - Same R/R (Target=10%, SL=3%)
     - Same holding (5 days)
     - Same liquidity filter (5M EGP)
     - Same regime filter (RANGE+BULL)
     - Same position sizing ($10K fixed)
     - Same max concurrent (5)
  3. Compare WR + PF
     - Strategy WR = 43-50%
     - Null WR = expected ~31% (breakeven for R/R 2.2:1)
     - If Strategy WR > Null WR significantly → signal has value
  4. 1000 random Null simulations → distribution → p-value

الـ logic:
  لو R/R = 2.2:1 (avg_win=6.8%, avg_loss=3.0%):
  - breakeven WR = 1 / (1 + R/R) = 1 / 3.2 = 31.25%
  - لو Strategy WR = 50% → edge = 50% - 31% = 19% (كبير!)
  - لو Null WR = 45% → edge = 50% - 45% = 5% (صغير)
  - لو Null WR = 50% → edge = 0% (لا edge)
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime
from pathlib import Path
from collections import defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO NULL MODEL TEST — هل الإشارة بتضيف قيمة فوق R/R؟")
print("=" * 90)

# CONFIG (same as final)
DROP_THRESHOLD = 15
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
KILL_SWITCH_DD = 15.0
FIXED_POSITION_DOLLAR = 10000
INITIAL_EQUITY = 100000
COST_RT = 0.70

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل البيانات...")

ph_db = DB_DIR / 'price_history.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
ph_conn = db_manager.connection(str(ph_db), writable=False).__enter__()
ph_conn.row_factory = sqlite3.Row

tickers = ph_conn.execute("""
    SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
    FROM price_history GROUP BY ticker HAVING cnt >= 200
""").fetchall()

valid_tickers = [t for t in tickers if t['last_date'] >= START_DATE]

ticker_data = {}
for t in valid_tickers:
    hist = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND date >= ? AND date <= ?
        ORDER BY date
    """, (t['ticker'], START_DATE, END_DATE)).fetchall()
    if len(hist) >= 200:
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None
                    and h['open_price'] is not None]
        if len(filtered) >= 200:
            ticker_data[t['ticker']] = filtered
ph_conn.close()

print(f"  ✅ {len(ticker_data)} tickers")


# ═══════════════════════════════════════════════════════════════════════
# 2. Strategy signals (drop 15% → buy)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] Strategy signals (drop 15%)...")

def calc_regime(closes, idx):
    if idx < 50:
        return 'RANGE'
    ma20 = sum(closes[idx-20:idx+1]) / 21
    ma50 = sum(closes[idx-50:idx+1]) / 51
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if idx >= 20 and closes[idx-20] > 0 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'


def generate_strategy_signals(ticker_data):
    """Strategy: drop 15% in 5 days → buy."""
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - closes[i]) / past_close) * 100
            if drop_pct < DROP_THRESHOLD:
                continue
            
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            entry = closes[i]
            entry_date = dates[i]
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
            exit_price = None
            exit_date = None
            exit_reason = None
            
            for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
                if closes[j] <= sl:
                    exit_price = sl
                    exit_date = dates[j]
                    exit_reason = 'STOP_LOSS'
                    break
                if closes[j] >= target:
                    exit_price = target
                    exit_date = dates[j]
                    exit_reason = 'TARGET'
                    break
            
            if exit_price is None:
                exit_idx = min(i + HOLDING_DAYS, len(closes) - 1)
                exit_price = closes[exit_idx]
                exit_date = dates[exit_idx]
                exit_reason = 'TIME_EXIT'
            
            gross_ret = ((exit_price - entry) / entry) * 100
            net_ret = gross_ret - COST_RT
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'net_return': net_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'year': entry_date[:4],
                'exit_reason': exit_reason,
            })
    
    return signals


strategy_signals = generate_strategy_signals(ticker_data)
print(f"  ✅ {len(strategy_signals)} strategy signals")


# ═══════════════════════════════════════════════════════════════════════
# 3. Null Model: RANDOM entry (NOT based on drop)
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] Null Model: random entry (NOT based on drop)...")

def generate_null_signals(ticker_data, seed=42):
    """
    Null Model: random entry on any day that passes liquidity + regime filter.
    Same R/R, same holding, same costs.
    NOT based on drop signal.
    """
    random.seed(seed)
    signals = []
    
    # Collect ALL valid entry points (pass liquidity + regime, but NOT drop filter)
    all_valid_entries = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            # NOT checking drop — this is the KEY difference
            all_valid_entries.append({
                'ticker': ticker,
                'closes': closes,
                'dates': dates,
                'idx': i,
            })
    
    # Sample SAME NUMBER of entries as strategy
    n_samples = len(strategy_signals)
    if len(all_valid_entries) > n_samples:
        sampled = random.sample(all_valid_entries, n_samples)
    else:
        sampled = all_valid_entries
    
    for entry in sampled:
        ticker = entry['ticker']
        closes = entry['closes']
        dates = entry['dates']
        i = entry['idx']
        
        entry_price = closes[i]
        entry_date = dates[i]
        sl = entry_price * (1 - SL_PCT / 100)
        target = entry_price * (1 + TARGET_PCT / 100)
        
        exit_price = None
        exit_date = None
        exit_reason = None
        
        for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
            if closes[j] <= sl:
                exit_price = sl
                exit_date = dates[j]
                exit_reason = 'STOP_LOSS'
                break
            if closes[j] >= target:
                exit_price = target
                exit_date = dates[j]
                exit_reason = 'TARGET'
                break
        
        if exit_price is None:
            exit_idx = min(i + HOLDING_DAYS, len(closes) - 1)
            exit_price = closes[exit_idx]
            exit_date = dates[exit_idx]
            exit_reason = 'TIME_EXIT'
        
        gross_ret = ((exit_price - entry_price) / entry_price) * 100
        net_ret = gross_ret - COST_RT
        
        signals.append({
            'ticker': ticker,
            'entry_date': entry_date,
            'exit_date': exit_date,
            'net_return': net_ret,
            'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
            'year': entry_date[:4],
            'exit_reason': exit_reason,
        })
    
    return signals


# ═══════════════════════════════════════════════════════════════════════
# 4. Simulation function (same as before)
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Simulation...")

def simulate(signals, initial_equity=INITIAL_EQUITY):
    if not signals:
        return None
    
    sorted_signals = sorted(signals, key=lambda s: s['entry_date'])
    
    equity = initial_equity
    peak = initial_equity
    max_dd = 0.0
    max_consec = 0
    current_consec = 0
    killed = False
    
    open_positions = []
    positive_returns = []
    negative_returns = []
    closed_count = 0
    wins_count = 0
    
    for s in sorted_signals:
        if killed:
            break
        
        still_open = [pos for pos in open_positions if pos['exit_date'] >= s['entry_date']]
        open_positions = still_open
        
        if len(open_positions) >= MAX_CONCURRENT:
            continue
        
        net_ret = s['net_return']
        pnl = FIXED_POSITION_DOLLAR * (net_ret / 100)
        equity += pnl
        
        if net_ret > 0:
            positive_returns.append(net_ret)
            wins_count += 1
            current_consec = 0
        else:
            negative_returns.append(abs(net_ret))
            current_consec += 1
            if current_consec > max_consec:
                max_consec = current_consec
        
        closed_count += 1
        
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd
        if max_dd >= KILL_SWITCH_DD:
            killed = True
        
        open_positions.append({'entry_date': s['entry_date'], 'exit_date': s['exit_date']})
    
    sum_positive = sum(positive_returns)
    sum_negative = sum(negative_returns)
    pf = sum_positive / sum_negative if sum_negative > 0 else 0
    wr = (wins_count / closed_count * 100) if closed_count > 0 else 0
    total_return = ((equity - initial_equity) / initial_equity) * 100
    avg_win = sum(positive_returns) / len(positive_returns) if positive_returns else 0
    avg_loss = sum(negative_returns) / len(negative_returns) if negative_returns else 0
    
    return {
        'n_closed': closed_count, 'n_wins': wins_count, 'wr': wr, 'pf': pf,
        'max_dd': max_dd, 'max_consec': max_consec, 'total_return': total_return,
        'killed': killed, 'avg_win': avg_win, 'avg_loss': avg_loss,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Run Strategy vs Null Model (1000 Null simulations)
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] Strategy vs Null Model (1000 Null simulations)...")
print("="*90)

# Split strategy
strategy_train = [s for s in strategy_signals if s['entry_date'] <= '2025-12-31']
strategy_test = [s for s in strategy_signals if s['entry_date'] >= '2026-01-01']

strategy_train_r = simulate(strategy_train)
strategy_test_r = simulate(strategy_test)

print(f"\n  Strategy (drop 15%):")
print(f"    Train: closed={strategy_train_r['n_closed']}, WR={strategy_train_r['wr']:.1f}%, PF={strategy_train_r['pf']:.2f}, MaxDD={strategy_train_r['max_dd']:.1f}%, Return={strategy_train_r['total_return']:.2f}%")
print(f"    Test:  closed={strategy_test_r['n_closed']}, WR={strategy_test_r['wr']:.1f}%, PF={strategy_test_r['pf']:.2f}, MaxDD={strategy_test_r['max_dd']:.1f}%, Return={strategy_test_r['total_return']:.2f}%")

# Null Model: 1000 random simulations
N_NULL = 1000
null_wrs = []
null_pfs = []
null_returns = []
null_dds = []

print(f"\n  Running {N_NULL} Null Model simulations...")

for sim in range(N_NULL):
    if sim % 200 == 0:
        print(f"  ... null sim {sim}/{N_NULL}", flush=True)
    
    null_signals = generate_null_signals(ticker_data, seed=sim)
    null_test = [s for s in null_signals if s['entry_date'] >= '2026-01-01']
    
    null_r = simulate(null_test)
    if null_r:
        null_wrs.append(null_r['wr'])
        null_pfs.append(null_r['pf'])
        null_returns.append(null_r['total_return'])
        null_dds.append(null_r['max_dd'])

# Sort for percentiles
null_wrs_sorted = sorted(null_wrs)
null_pfs_sorted = sorted(null_pfs)
null_returns_sorted = sorted(null_returns)
null_dds_sorted = sorted(null_dds)


def p_value(baseline, null_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in null_values if v > baseline)
    else:
        n_better = sum(1 for v in null_values if v < baseline)
    return n_better / len(null_values) * 100


# Results
print(f"\n  {'='*90}")
print(f"  📊 STRATEGY vs NULL MODEL (Test 2026)")
print(f"  {'='*90}")

print(f"\n  {'Metric':20s} | {'Strategy':>10s} | {'Null avg':>10s} | {'Null median':>12s} | {'Null 5th':>10s} | {'Null 95th':>10s} | {'p-value':>8s}")
print(f"  {'-'*90}")

wr_pval = p_value(strategy_test_r['wr'], null_wrs)
pf_pval = p_value(strategy_test_r['pf'], null_pfs)
ret_pval = p_value(strategy_test_r['total_return'], null_returns)
dd_pval = p_value(strategy_test_r['max_dd'], null_dds, False)

print(f"  {'WR':20s} | {strategy_test_r['wr']:>9.1f}% | {sum(null_wrs)/len(null_wrs):>9.1f}% | {null_wrs_sorted[len(null_wrs)//2]:>11.1f}% | {null_wrs_sorted[int(len(null_wrs)*0.05)]:>9.1f}% | {null_wrs_sorted[int(len(null_wrs)*0.95)]:>9.1f}% | {wr_pval:>7.1f}%")
print(f"  {'PF':20s} | {strategy_test_r['pf']:>10.2f} | {sum(null_pfs)/len(null_pfs):>10.2f} | {null_pfs_sorted[len(null_pfs)//2]:>12.2f} | {null_pfs_sorted[int(len(null_pfs)*0.05)]:>10.2f} | {null_pfs_sorted[int(len(null_pfs)*0.95)]:>10.2f} | {pf_pval:>7.1f}%")
print(f"  {'MaxDD':20s} | {strategy_test_r['max_dd']:>9.1f}% | {sum(null_dds)/len(null_dds):>9.1f}% | {null_dds_sorted[len(null_dds)//2]:>11.1f}% | {null_dds_sorted[int(len(null_dds)*0.05)]:>9.1f}% | {null_dds_sorted[int(len(null_dds)*0.95)]:>9.1f}% | {dd_pval:>7.1f}%")
print(f"  {'Return':20s} | {strategy_test_r['total_return']:>9.2f}% | {sum(null_returns)/len(null_returns):>9.2f}% | {null_returns_sorted[len(null_returns)//2]:>11.2f}% | {null_returns_sorted[int(len(null_returns)*0.05)]:>9.2f}% | {null_returns_sorted[int(len(null_returns)*0.95)]:>9.2f}% | {ret_pval:>7.1f}%")

# Breakeven analysis
print(f"\n  --- Breakeven Analysis ---")
# R/R = avg_win / avg_loss
rr = strategy_test_r['avg_win'] / strategy_test_r['avg_loss'] if strategy_test_r['avg_loss'] > 0 else 0
breakeven_wr = 1 / (1 + rr) * 100
print(f"  Strategy R/R = {rr:.2f}:1")
print(f"  Breakeven WR = {breakeven_wr:.1f}%")
print(f"  Strategy WR = {strategy_test_r['wr']:.1f}%")
print(f"  Null WR (median) = {null_wrs_sorted[len(null_wrs)//2]:.1f}%")
print(f"  Edge over breakeven = {strategy_test_r['wr'] - breakeven_wr:.1f}%")
print(f"  Edge over Null = {strategy_test_r['wr'] - null_wrs_sorted[len(null_wrs)//2]:.1f}%")

# VERDICT
print(f"\n  {'='*90}")
print(f"  🎯 VERDICT")
print(f"  {'='*90}")

print(f"""
  Strategy (drop 15% signal):
    WR = {strategy_test_r['wr']:.1f}% | PF = {strategy_test_r['pf']:.2f}
  
  Null Model (random entry, same R/R + holding + liquidity):
    WR (median) = {null_wrs_sorted[len(null_wrs)//2]:.1f}% | PF (median) = {null_pfs_sorted[len(null_pfs)//2]:.2f}
  
  p-value (WR): {wr_pval:.1f}%
  p-value (PF): {pf_pval:.1f}%
  p-value (Return): {ret_pval:.1f}%
""")

if wr_pval < 5:
    print(f"  ✅ WR p-value = {wr_pval:.1f}% < 5% → SIGNAL HAS VALUE!")
    print(f"  → الإشارة (drop 15%) بتضيف قيمة فوق الـ R/R")
    print(f"  → Strategy WR ({strategy_test_r['wr']:.1f}%) > Null WR ({null_wrs_sorted[len(null_wrs)//2]:.1f}%)")
elif wr_pval < 10:
    print(f"  ⚠️ WR p-value = {wr_pval:.1f}% < 10% → SIGNAL MARGINAL")
    print(f"  → الإشارة بتضيف قيمة بس ضعيفة")
else:
    print(f"  ❌ WR p-value = {wr_pval:.1f}% ≥ 10% → NO SIGNAL VALUE")
    print(f"  → الـ R/R هو اللي بـ يـدي الـ edge، مش الإشارة")
    print(f"  → Strategy WR ({strategy_test_r['wr']:.1f}%) ≈ Null WR ({null_wrs_sorted[len(null_wrs)//2]:.1f}%)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'null_model_test_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'strategy_test': {k:v for k,v in strategy_test_r.items()},
        'null_model': {
            'n_simulations': N_NULL,
            'wr_median': null_wrs_sorted[len(null_wrs)//2],
            'pf_median': null_pfs_sorted[len(null_pfs)//2],
            'wr_pvalue': wr_pval,
            'pf_pvalue': pf_pval,
            'return_pvalue': ret_pval,
        },
        'breakeven': {
            'rr': rr,
            'breakeven_wr': breakeven_wr,
            'strategy_wr': strategy_test_r['wr'],
            'null_wr_median': null_wrs_sorted[len(null_wrs)//2],
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n  {'='*90}")
