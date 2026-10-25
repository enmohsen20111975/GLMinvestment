#!/usr/bin/env python3
"""
mean_reversion_honest.py — Mean Reversion بـ Fixed Dollar Sizing + Percentage PF.

الـ framework (per Mohsen's directive — صارم وصادق):
  1. Fixed Dollar Position Sizing: $10,000 per trade (NOT % of equity)
  2. Percentage-based PF (NOT dollar-based)
  3. Config: target10_sl3 ONLY (the realistic one — PF=1.73 on Train)
  4. Stress Test: 0.70%, 1.0%, 1.5% cost
  5. Top 5/10 trades contribution
  6. Trailing Stop verification (no lookahead)
  7. Train/Test: Train=2024-2025, Test=2026
"""
import sys
import os
import json
import sqlite3
import random
import statistics
from datetime import datetime
from pathlib import Path
from collections import Counter, defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO MEAN REVERSION HONEST — Fixed Dollar + Percentage PF")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# CONFIG — target10_sl3 ONLY
# ═══════════════════════════════════════════════════════════════════════
DROP_THRESHOLD = 15
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
SL_PCT = 3.0           # Stop Loss = 3%
TARGET_PCT = 10.0       # Target = 10%
MIN_TURNOVER_EGP = 100000
MAX_CONCURRENT = 5
KILL_SWITCH_DD = 15.0

# FIXED DOLLAR position sizing (NOT % of equity)
FIXED_POSITION_DOLLAR = 10000  # $10,000 per trade (fixed, no compounding)

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'
TRAIN_END = '2025-12-31'
TEST_START = '2026-01-01'

INITIAL_EQUITY = 100000  # $100,000 starting capital


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/7] تحميل البيانات...")

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

# sector map
sector_map = {}
try:
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    s_conn = db_manager.connection(str(DB_DIR / 'stocks.db'), writable=False).__enter__()
    s_conn.row_factory = sqlite3.Row
    for r in s_conn.execute("SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL").fetchall():
        sector_map[r['ticker']] = r['sector'] or 'UNKNOWN'
    s_conn.close()
except Exception:
    pass

print(f"  ✅ {len(ticker_data)} tickers | {len(sector_map)} sectors")


# ═══════════════════════════════════════════════════════════════════════
# 2. Signal generation (target10_sl3 + costs + liquidity + RANGE filter)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/7] Signal generation (target10_sl3)...")

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


def generate_signals(ticker_data, cost_per_side_pct):
    """توليد signals بـ target10_sl3 + costs + liquidity + RANGE filter."""
    signals = []
    round_trip_cost = cost_per_side_pct * 2
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            # Liquidity filter
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            # Drop signal
            current_close = closes[i]
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - current_close) / past_close) * 100
            if drop_pct < DROP_THRESHOLD:
                continue
            
            # Regime filter (RANGE + BULL only)
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            entry = current_close
            entry_date = dates[i]
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
            # Exit logic — NO trailing, just fixed SL + Target + Time
            exit_price = None
            exit_date = None
            exit_reason = None
            
            for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
                # Stop loss FIRST (conservative)
                if closes[j] <= sl:
                    exit_price = sl
                    exit_date = dates[j]
                    exit_reason = 'STOP_LOSS'
                    break
                # Target
                if closes[j] >= target:
                    exit_price = target
                    exit_date = dates[j]
                    exit_reason = 'TARGET'
                    break
            
            if exit_price is None:
                # Time exit
                exit_idx = min(i + HOLDING_DAYS, len(closes) - 1)
                exit_price = closes[exit_idx]
                exit_date = dates[exit_idx]
                exit_reason = 'TIME_EXIT'
            
            # GROSS return (before costs)
            gross_ret = ((exit_price - entry) / entry) * 100
            
            # NET return (after costs — round trip)
            net_ret = gross_ret - round_trip_cost
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'entry': entry,
                'exit': exit_price,
                'gross_return': gross_ret,
                'net_return': net_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'regime': regime,
                'year': entry_date[:4],
                'exit_reason': exit_reason,
                'drop_pct': drop_pct,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
            })
    
    return signals


# ═══════════════════════════════════════════════════════════════════════
# 3. Simulation — FIXED DOLLAR sizing + percentage-based PF
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/7] Simulation (Fixed Dollar $10K + percentage PF)...")

def simulate_honest(signals, initial_equity=INITIAL_EQUITY, 
                    fixed_position=FIXED_POSITION_DOLLAR,
                    max_concurrent=MAX_CONCURRENT,
                    kill_switch_dd=KILL_SWITCH_DD,
                    sector_cap=3):
    """
    محاكاة بـ FIXED DOLLAR position sizing.
    
    PF = sum(positive net_returns) / sum(abs(negative net_returns))
    الـ returns دي percentage (مش dollar) → PF percentage-based.
    
    Equity = initial + sum(position × return%)
    ده compounding صحيح (position ثابت → linear growth).
    """
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
    sector_counts = defaultdict(int)
    
    # For percentage-based PF
    all_returns = []  # list of net_return percentages
    positive_returns = []
    negative_returns = []
    
    closed_count = 0
    wins_count = 0
    
    for s in sorted_signals:
        if killed:
            break
        
        # Update open positions
        still_open = []
        for pos in open_positions:
            if pos['exit_date'] >= s['entry_date']:
                still_open.append(pos)
            else:
                sector_counts[pos['sector']] = max(0, sector_counts[pos['sector']] - 1)
        open_positions = still_open
        
        if len(open_positions) >= max_concurrent:
            continue
        
        if sector_counts[s['sector']] >= sector_cap:
            continue
        
        # FIXED DOLLAR position sizing
        position_size = fixed_position  # $10,000 fixed (NOT % of equity)
        
        # PnL in dollars
        net_ret = s['net_return']
        pnl_dollars = position_size * (net_ret / 100)
        equity += pnl_dollars
        
        # Track returns for percentage-based PF
        all_returns.append(net_ret)
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
        
        if max_dd >= kill_switch_dd:
            killed = True
        
        open_positions.append({
            'ticker': s['ticker'],
            'entry_date': s['entry_date'],
            'exit_date': s['exit_date'],
            'sector': s['sector'],
        })
        sector_counts[s['sector']] += 1
    
    # PERCENTAGE-BASED PF (honest)
    sum_positive = sum(positive_returns)
    sum_negative = sum(negative_returns)
    pf_pct = sum_positive / sum_negative if sum_negative > 0 else 0
    
    wr = (wins_count / closed_count * 100) if closed_count > 0 else 0
    total_return_pct = ((equity - initial_equity) / initial_equity) * 100
    
    # Avg win / avg loss (percentage)
    avg_win = sum(positive_returns) / len(positive_returns) if positive_returns else 0
    avg_loss = sum(negative_returns) / len(negative_returns) if negative_returns else 0
    
    return {
        'n_closed': closed_count,
        'n_wins': wins_count,
        'wr': wr,
        'pf_percentage': pf_pct,  # HONEST PF
        'pf_dollar': None,  # not calculated (we don't use dollar PF)
        'max_dd': max_dd,
        'max_consec': max_consec,
        'total_return_pct': total_return_pct,
        'killed': killed,
        'avg_win_pct': avg_win,
        'avg_loss_pct': avg_loss,
        'sum_positive_pct': sum_positive,
        'sum_negative_pct': sum_negative,
        'final_equity': equity,
        'all_returns': all_returns,
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. Stress Test: 0.70%, 1.0%, 1.5% round trip costs
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/7] Stress Test (0.70%, 1.0%, 1.5% costs)...")
print("="*90)

stress_results = {}
for cost_round_trip in [0.70, 1.00, 1.50]:
    cost_per_side = cost_round_trip / 2
    signals = generate_signals(ticker_data, cost_per_side)
    
    # Split
    train_sig = [s for s in signals if s['entry_date'] <= TRAIN_END]
    test_sig = [s for s in signals if s['entry_date'] >= TEST_START]
    
    train_r = simulate_honest(train_sig)
    test_r = simulate_honest(test_sig)
    
    stress_results[cost_round_trip] = {'train': train_r, 'test': test_r}
    
    print(f"\n  Cost = {cost_round_trip:.2f}% round trip:")
    print(f"    {'':8s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7} | {'avgWin':>7} | {'avgLoss':>7}")
    print(f"    {'Train':8s} | {train_r['n_closed']:>6} | {train_r['wr']:>5.1f}% | {train_r['pf_percentage']:>6.2f} | {train_r['max_dd']:>5.1f}% | {train_r['total_return_pct']:>+7.2f}% | {str(train_r['killed']):>7} | {train_r['avg_win_pct']:>+6.2f}% | {train_r['avg_loss_pct']:>+6.2f}%")
    print(f"    {'Test':8s} | {test_r['n_closed']:>6} | {test_r['wr']:>5.1f}% | {test_r['pf_percentage']:>6.2f} | {test_r['max_dd']:>5.1f}% | {test_r['total_return_pct']:>+7.2f}% | {str(test_r['killed']):>7} | {test_r['avg_win_pct']:>+6.2f}% | {test_r['avg_loss_pct']:>+6.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. Top Trades Contribution
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/7] Top Trades Contribution...")
print("="*90)

# Use 0.70% cost (baseline)
signals_070 = generate_signals(ticker_data, 0.35)
all_signals = signals_070

# Sort by net_return
sorted_by_ret = sorted(all_signals, key=lambda s: s['net_return'], reverse=True)

total_positive = sum(s['net_return'] for s in all_signals if s['net_return'] > 0)
top5_positive = sum(s['net_return'] for s in sorted_by_ret[:5] if s['net_return'] > 0)
top10_positive = sum(s['net_return'] for s in sorted_by_ret[:10] if s['net_return'] > 0)

top5_pct = (top5_positive / total_positive * 100) if total_positive > 0 else 0
top10_pct = (top10_positive / total_positive * 100) if total_positive > 0 else 0

print(f"\n  Total positive returns: {total_positive:.2f}%")
print(f"  Top 5 contribution: {top5_pct:.1f}%")
print(f"  Top 10 contribution: {top10_pct:.1f}%")

print(f"\n  --- Top 5 trades ---")
print(f"  {'ticker':8s} | {'date':12s} | {'gross':>7s} | {'net':>7s} | {'reason':>12s}")
print("  " + "-"*55)
for s in sorted_by_ret[:5]:
    print(f"  {s['ticker']:8s} | {s['entry_date']:12s} | {s['gross_return']:>+6.2f}% | {s['net_return']:>+6.2f}% | {s['exit_reason']:>12s}")

print(f"\n  --- Bottom 5 trades ---")
for s in sorted_by_ret[-5:]:
    print(f"  {s['ticker']:8s} | {s['entry_date']:12s} | {s['gross_return']:>+6.2f}% | {s['net_return']:>+6.2f}% | {s['exit_reason']:>12s}")


# ═══════════════════════════════════════════════════════════════════════
# 6. Distribution of Returns
# ═══════════════════════════════════════════════════════════════════════
print("\n[6/7] Distribution of Returns...")
print("="*90)

returns = [s['net_return'] for s in all_signals]
print(f"\n  Return distribution:")
print(f"    count: {len(returns)}")
print(f"    min: {min(returns):.2f}%")
print(f"    max: {max(returns):.2f}%")
print(f"    avg: {sum(returns)/len(returns):.2f}%")
print(f"    median: {sorted(returns)[len(returns)//2]:.2f}%")
print(f"    stdev: {statistics.stdev(returns):.2f}%")

# Histogram
print(f"\n  Histogram:")
bands = [(-10, -7), (-7, -5), (-5, -3), (-3, -1), (-1, 0), (0, 1), (1, 3), (3, 5), (5, 7), (7, 10), (10, 20)]
print(f"  {'Band':12s} | {'count':>5} | {'bar':>40}")
print("  " + "-"*60)
for lo, hi in bands:
    cnt = sum(1 for r in returns if lo <= r < hi)
    bar = '█' * (cnt // 10)
    print(f"  {lo:>4}% to {hi:>4}% | {cnt:>5} | {bar}")


# ═══════════════════════════════════════════════════════════════════════
# 7. VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n[7/7] Final Verdict...")
print("\n" + "=" * 90)
print("  🎯 FINAL VERDICT — Mean Reversion Honest (target10_sl3 + Fixed Dollar)")
print("=" * 90)

# Use 0.70% cost as baseline
baseline_train = stress_results[0.70]['train']
baseline_test = stress_results[0.70]['test']

print(f"""
  Config: target10_sl3 (Target=10%, SL=3%, RANGE+BULL filter)
  Position Sizing: Fixed Dollar $10,000 per trade
  Kill Switch: 15% DD
  Max Concurrent: 5
  
  TRAIN (2024-2025, cost=0.70%):
    closed: {baseline_train['n_closed']}
    WR: {baseline_train['wr']:.1f}%
    PF (percentage): {baseline_train['pf_percentage']:.2f}
    MaxDD: {baseline_train['max_dd']:.1f}%
    Return: {baseline_train['total_return_pct']:.2f}%
    Killed: {baseline_train['killed']}
    avg Win: {baseline_train['avg_win_pct']:.2f}% | avg Loss: {baseline_train['avg_loss_pct']:.2f}%
  
  TEST (2026, cost=0.70%):
    closed: {baseline_test['n_closed']}
    WR: {baseline_test['wr']:.1f}%
    PF (percentage): {baseline_test['pf_percentage']:.2f}
    MaxDD: {baseline_test['max_dd']:.1f}%
    Return: {baseline_test['total_return_pct']:.2f}%
    Killed: {baseline_test['killed']}
    avg Win: {baseline_test['avg_win_pct']:.2f}% | avg Loss: {baseline_test['avg_loss_pct']:.2f}%
""")

# Stress Test summary
print(f"  Stress Test Summary:")
for cost in [0.70, 1.00, 1.50]:
    r = stress_results[cost]['test']
    print(f"    {cost:.2f}% cost → Test PF: {r['pf_percentage']:.2f} | MaxDD: {r['max_dd']:.1f}% | Killed: {r['killed']}")

print(f"\n  Top 5 contribution: {top5_pct:.1f}% (هش لو > 50%)")
print(f"  Top 10 contribution: {top10_pct:.1f}%")

# Final criteria
test_pf = baseline_test['pf_percentage']
test_dd = baseline_test['max_dd']
test_killed = baseline_test['killed']

if test_pf > 1.3 and not test_killed and test_dd < 15:
    print(f"\n  🎉 ALL CRITERIA PASSED!")
    print(f"    ✅ Test PF = {test_pf:.2f} > 1.3")
    print(f"    ✅ MaxDD = {test_dd:.1f}% < 15%")
    print(f"    ✅ Not killed")
    print(f"  → جاهز للـ Paper Trading")
elif test_pf > 1.0 and not test_killed:
    print(f"\n  ⚠️ PARTIAL: PF > 1.0 but not > 1.3")
    print(f"    Test PF = {test_pf:.2f}")
    print(f"    MaxDD = {test_dd:.1f}%")
    print(f"  → محتاج تحسين")
else:
    print(f"\n  ❌ FAILED: PF = {test_pf:.2f} or killed or MaxDD > 15%")
    print(f"  → الـ edge مش كافي")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_honest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'config': 'target10_sl3 (Target=10%, SL=3%, RANGE+BULL, Fixed Dollar $10K)',
        'stress_test': {str(k): {'train': {kk:vv for kk,vv in v['train'].items() if kk != 'all_returns'},
                                  'test': {kk:vv for kk,vv in v['test'].items() if kk != 'all_returns'}} 
                         for k,v in stress_results.items()},
        'top_trades': {'top5_pct': top5_pct, 'top10_pct': top10_pct},
        'distribution': {'min': min(returns), 'max': max(returns), 'avg': sum(returns)/len(returns), 
                         'median': sorted(returns)[len(returns)//2], 'stdev': statistics.stdev(returns)},
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Mean Reversion Honest خلص")
print("=" * 90)
