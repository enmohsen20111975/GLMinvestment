#!/usr/bin/env python3
"""
paper_trading_audit.py — Audit قبل Paper Trading (3 checks).

1. Stress Test 1.5% cost على مايو-أكتوبر 2026
2. Null Model على نفس الفترة
3. جدول صفقات + PF لكل شهر + Walk-Forward داخل 6 شهور
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO PAPER TRADING AUDIT — 3 Checks before going live")
print("=" * 90)

# CONFIG
DROP_THRESHOLD = 15
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
KILL_SWITCH_DD = 15.0
FIXED_POSITION_DOLLAR = 5000
INITIAL_EQUITY = 100000

START_DATE = '2026-05-01'
END_DATE = '2026-10-31'
PRELOAD_START = '2026-01-01'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل البيانات...")

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
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
    """, (t['ticker'], PRELOAD_START, END_DATE)).fetchall()
    if len(hist) >= 100:
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None
                    and h['open_price'] is not None]
        if len(filtered) >= 100:
            ticker_data[t['ticker']] = filtered
ph_conn.close()

sector_map = {}
try:
    s_conn = sqlite3.connect(str(DB_DIR / 'stocks.db'))
    s_conn.row_factory = sqlite3.Row
    for r in s_conn.execute("SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL").fetchall():
        sector_map[r['ticker']] = r['sector'] or 'UNKNOWN'
    s_conn.close()
except Exception:
    pass

print(f"  ✅ {len(ticker_data)} tickers")


# ═══════════════════════════════════════════════════════════════════════
# 2. Signal generation (Realistic Limit Order)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] Signal generation...")

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


def generate_signals(ticker_data, cost_rt=1.0, random_entry=False, seed=42):
    """
    Realistic Limit Order signals.
    If random_entry=True: random entry (NOT based on drop) — for Null Model.
    """
    if random_entry:
        random.seed(seed)
    
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < START_DATE:
                continue
            
            # Liquidity filter
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            # Regime filter
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            if not random_entry:
                # Strategy: drop 15% signal
                past_close = closes[i - LOOKBACK_DAYS]
                drop_pct = ((past_close - closes[i]) / past_close) * 100
                if drop_pct < DROP_THRESHOLD:
                    continue
            else:
                # Null: random entry (any day that passes filters)
                drop_pct = 0
            
            # Realistic Limit Order
            limit_price = closes[i]
            entry_idx = i + 1
            if entry_idx >= len(closes):
                continue
            if lows[entry_idx] > limit_price:
                continue  # price never reached limit → SKIP
            
            entry = min(opens[entry_idx], limit_price)
            entry_date = dates[entry_idx]
            
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
            # Exit: SL checked FIRST (conservative)
            exit_price = None
            exit_date = None
            exit_reason = None
            exit_idx_max = min(entry_idx + HOLDING_DAYS, len(closes) - 1)
            
            for j in range(entry_idx + 1, exit_idx_max + 1):
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
                exit_price = closes[exit_idx_max]
                exit_date = dates[exit_idx_max]
                exit_reason = 'TIME_EXIT'
            
            gross_ret = ((exit_price - entry) / entry) * 100
            net_ret = gross_ret - cost_rt
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'net_return': net_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'regime': regime,
                'month': entry_date[:7],
                'exit_reason': exit_reason,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
            })
    
    return signals


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
    sector_counts = defaultdict(int)
    positive_returns = []
    negative_returns = []
    closed_count = 0
    wins_count = 0
    
    for s in sorted_signals:
        if killed:
            break
        still_open = [pos for pos in open_positions if pos['exit_date'] >= s['entry_date']]
        for pos in open_positions:
            if pos['exit_date'] < s['entry_date']:
                sector_counts[pos['sector']] = max(0, sector_counts[pos['sector']] - 1)
        open_positions = still_open
        if len(open_positions) >= MAX_CONCURRENT:
            continue
        if sector_counts[s['sector']] >= 3:
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
        open_positions.append({'entry_date': s['entry_date'], 'exit_date': s['exit_date'], 'sector': s['sector']})
        sector_counts[s['sector']] += 1
    
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
# 3. CHECK 1: Stress Test (1.0% + 1.5% cost)
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] CHECK 1: Stress Test (1.0% + 1.5% cost)...")
print("="*90)

for cost in [1.0, 1.5]:
    sigs = generate_signals(ticker_data, cost_rt=cost)
    full_r = simulate(sigs)
    
    # Train/Test
    train_sig = [s for s in sigs if s['entry_date'] <= '2026-07-31']
    test_sig = [s for s in sigs if s['entry_date'] >= '2026-08-01']
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    print(f"\n  Cost = {cost:.1f}%:")
    print(f"    {'Period':12s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7}")
    print(f"    {'-'*65}")
    print(f"    {'Full':12s} | {full_r['n_closed']:>6} | {full_r['wr']:>5.1f}% | {full_r['pf']:>6.2f} | {full_r['max_dd']:>5.1f}% | {full_r['total_return']:>+7.2f}% | {str(full_r['killed']):>7}")
    print(f"    {'Train':12s} | {train_r['n_closed']:>6} | {train_r['wr']:>5.1f}% | {train_r['pf']:>6.2f} | {train_r['max_dd']:>5.1f}% | {train_r['total_return']:>+7.2f}% | {str(train_r['killed']):>7}")
    print(f"    {'Test':12s} | {test_r['n_closed']:>6} | {test_r['wr']:>5.1f}% | {test_r['pf']:>6.2f} | {test_r['max_dd']:>5.1f}% | {test_r['total_return']:>+7.2f}% | {str(test_r['killed']):>7}")


# ═══════════════════════════════════════════════════════════════════════
# 4. CHECK 2: Null Model (1000 random simulations)
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[4/5] CHECK 2: Null Model (1000 random simulations)...")
print("="*90)

# Strategy baseline
strat_signals = generate_signals(ticker_data, cost_rt=1.0)
strat_full = simulate(strat_signals)
strat_test = simulate([s for s in strat_signals if s['entry_date'] >= '2026-08-01'])

print(f"\n  Strategy (drop 15%):")
print(f"    Full: PF={strat_full['pf']:.2f}, WR={strat_full['wr']:.1f}%, Return={strat_full['total_return']:.2f}%")
print(f"    Test: PF={strat_test['pf']:.2f}, WR={strat_test['wr']:.1f}%, Return={strat_test['total_return']:.2f}%")

# Null Model: 1000 random entry simulations
N_NULL = 1000
null_pfs = []
null_wrs = []
null_returns = []

print(f"\n  Running {N_NULL} Null simulations...")

# For Null: we need same number of signals as strategy
# Random entry = any day that passes liquidity + regime (NOT drop)
# Sample same count as strategy
all_valid_entries = []
for ticker, hist in ticker_data.items():
    closes = [h['close_price'] for h in hist]
    volumes = [h['volume'] or 0 for h in hist]
    dates = [h['date'] for h in hist]
    lows = [h['low_price'] for h in hist]
    opens = [h['open_price'] for h in hist]
    for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS - 3):
        if dates[i] < START_DATE:
            continue
        avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
        turnover = avg_vol_20 * closes[i]
        if turnover < MIN_TURNOVER_EGP:
            continue
        regime = calc_regime(closes, i)
        if regime == 'BEAR':
            continue
        # Limit order check
        limit_price = closes[i]
        entry_idx = i + 1
        if entry_idx >= len(closes):
            continue
        if lows[entry_idx] > limit_price:
            continue
        all_valid_entries.append({
            'ticker': ticker, 'i': i, 'hist': hist,
            'entry': min(opens[entry_idx], limit_price),
            'entry_date': dates[entry_idx],
        })

n_samples = len(strat_signals)
print(f"  Valid entries (no drop filter): {len(all_valid_entries)}")
print(f"  Strategy signals: {n_samples}")

for sim_idx in range(N_NULL):
    if sim_idx % 200 == 0:
        print(f"  ... null sim {sim_idx}/{N_NULL}", flush=True)
    
    random.seed(sim_idx)
    if len(all_valid_entries) > n_samples:
        sampled = random.sample(all_valid_entries, n_samples)
    else:
        sampled = all_valid_entries
    
    null_signals = []
    for entry in sampled:
        ticker = entry['ticker']
        i = entry['i']
        hist = entry['hist']
        closes = [h['close_price'] for h in hist]
        dates = [h['date'] for h in hist]
        entry_idx = i + 1
        
        entry_price = entry['entry']
        sl = entry_price * (1 - SL_PCT / 100)
        target = entry_price * (1 + TARGET_PCT / 100)
        
        exit_price = None
        exit_date = None
        exit_idx_max = min(entry_idx + HOLDING_DAYS, len(closes) - 1)
        for j in range(entry_idx + 1, exit_idx_max + 1):
            if closes[j] <= sl:
                exit_price = sl
                exit_date = dates[j]
                break
            if closes[j] >= target:
                exit_price = target
                exit_date = dates[j]
                break
        if exit_price is None:
            exit_price = closes[exit_idx_max]
            exit_date = dates[exit_idx_max]
        
        gross_ret = ((exit_price - entry_price) / entry_price) * 100
        net_ret = gross_ret - 1.0
        
        null_signals.append({
            'ticker': ticker, 'entry_date': entry['entry_date'], 'exit_date': exit_date,
            'net_return': net_ret, 'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
            'sector': sector_map.get(ticker, 'UNKNOWN'),
        })
    
    null_test = [s for s in null_signals if s['entry_date'] >= '2026-08-01']
    null_r = simulate(null_test)
    if null_r:
        null_pfs.append(null_r['pf'])
        null_wrs.append(null_r['wr'])
        null_returns.append(null_r['total_return'])

null_pfs_sorted = sorted(null_pfs)
null_wrs_sorted = sorted(null_wrs)
null_returns_sorted = sorted(null_returns)

def p_value(baseline, null_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in null_values if v > baseline)
    else:
        n_better = sum(1 for v in null_values if v < baseline)
    return n_better / len(null_values) * 100

pf_pval = p_value(strat_test['pf'], null_pfs)
wr_pval = p_value(strat_test['wr'], null_wrs)
ret_pval = p_value(strat_test['total_return'], null_returns)

print(f"\n  Null Model Results (Test Aug-Oct, {N_NULL} sims):")
print(f"\n  {'Metric':20s} | {'Strategy':>10s} | {'Null avg':>10s} | {'Null median':>12s} | {'p-value':>8s}")
print(f"  {'-'*70}")
print(f"  {'WR':20s} | {strat_test['wr']:>9.1f}% | {sum(null_wrs)/len(null_wrs):>9.1f}% | {null_wrs_sorted[len(null_wrs)//2]:>11.1f}% | {wr_pval:>7.1f}%")
print(f"  {'PF':20s} | {strat_test['pf']:>10.2f} | {sum(null_pfs)/len(null_pfs):>10.2f} | {null_pfs_sorted[len(null_pfs)//2]:>12.2f} | {pf_pval:>7.1f}%")
print(f"  {'Return':20s} | {strat_test['total_return']:>9.2f}% | {sum(null_returns)/len(null_returns):>9.2f}% | {null_returns_sorted[len(null_returns)//2]:>11.2f}% | {ret_pval:>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. CHECK 3: Per-month + Walk-Forward
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[5/5] CHECK 3: Per-Month + Walk-Forward...")
print("="*90)

# Per-month
print(f"\n  --- Per-Month Breakdown ---")
print(f"  {'Month':8s} | {'signals':>7} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print(f"  {'-'*50}")
for month in sorted(set(s['month'] for s in strat_signals)):
    month_sig = [s for s in strat_signals if s['month'] == month]
    month_r = simulate(month_sig)
    if month_r:
        print(f"  {month:8s} | {len(month_sig):>7} | {month_r['n_closed']:>6} | {month_r['wr']:>5.1f}% | {month_r['pf']:>6.2f} | {month_r['total_return']:>+7.2f}%")

# Walk-Forward inside 6 months
print(f"\n  --- Walk-Forward (inside May-Oct) ---")
print(f"  {'WF':25s} | {'Train PF':>8} | {'Train WR':>8} | {'Test PF':>8} | {'Test WR':>8} | {'Gen':>5}")
print(f"  {'-'*70}")

wf_configs = [
    ('May-Jun → Jul', ['2026-05', '2026-06'], ['2026-07']),
    ('May-Jul → Aug', ['2026-05', '2026-06', '2026-07'], ['2026-08']),
    ('Jun-Jul → Aug', ['2026-06', '2026-07'], ['2026-08']),
    ('May-Jul → Aug-Oct', ['2026-05', '2026-06', '2026-07'], ['2026-08', '2026-09', '2026-10']),
    ('Jun-Aug → Sep-Oct', ['2026-06', '2026-07', '2026-08'], ['2026-09', '2026-10']),
]

for name, train_months, test_months in wf_configs:
    train_sig = [s for s in strat_signals if s['month'] in train_months]
    test_sig = [s for s in strat_signals if s['month'] in test_months]
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    if train_r and test_r and train_r['pf'] > 0:
        gen = test_r['pf'] / train_r['pf']
    else:
        gen = 0
    print(f"  {name:25s} | {train_r['pf']:>8.2f} | {train_r['wr']:>7.1f}% | {test_r['pf']:>8.2f} | {test_r['wr']:>7.1f}% | {gen:>5.2f}")


# ═══════════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════════
print(f"\n{'='*90}")
print(f"  🎯 VERDICT — Paper Trading Audit")
print(f"{'='*90}")

print(f"""
  CHECK 1: Stress Test
    1.0% cost: Full PF = {strat_full['pf']:.2f} | Test PF = {strat_test['pf']:.2f}
    1.5% cost: (see above)
  
  CHECK 2: Null Model (Test Aug-Oct)
    Strategy PF = {strat_test['pf']:.2f} | Null median PF = {null_pfs_sorted[len(null_pfs)//2]:.2f}
    p-value (PF) = {pf_pval:.1f}%
    p-value (WR) = {wr_pval:.1f}%
  
  CHECK 3: Per-Month + Walk-Forward
    (see tables above)
""")

# Final decision
all_pass = True
reasons = []

# Check 1: PF > 1.0 at 1.5% cost
sigs_15 = generate_signals(ticker_data, cost_rt=1.5)
r_15 = simulate(sigs_15)
if r_15['pf'] < 1.0:
    all_pass = False
    reasons.append(f"1.5% cost PF = {r_15['pf']:.2f} < 1.0")

# Check 2: Null Model p-value < 5%
if pf_pval >= 5:
    all_pass = False
    reasons.append(f"Null Model p-value = {pf_pval:.1f}% >= 5%")

# Check 3: All months have signals
months_with_signals = set(s['month'] for s in strat_signals)
if len(months_with_signals) < 5:
    all_pass = False
    reasons.append(f"Only {len(months_with_signals)} months with signals")

if all_pass:
    print(f"  ✅ ALL CHECKS PASSED → Ready for Paper Trading!")
else:
    print(f"  ⚠️ Issues found:")
    for reason in reasons:
        print(f"    - {reason}")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'paper_trading_audit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'strategy_test': {k:v for k,v in strat_test.items()},
        'null_model': {
            'n_simulations': N_NULL,
            'pf_pvalue': pf_pval,
            'wr_pvalue': wr_pval,
            'null_pf_median': null_pfs_sorted[len(null_pfs)//2],
        },
        'all_pass': all_pass,
        'reasons': reasons,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*90}")
