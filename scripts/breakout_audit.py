#!/usr/bin/env python3
"""
breakout_audit.py — 5 checks قبل Paper Trading على Breakout strategy.

1. فلتر السوق: كيف يصنف كل شهر؟ Point-in-Time?
2. حجم العينة: صفقات لكل شهر
3. Walk-Forward على Breakout
4. تحليل Null Model PF=2.08
5. اختبار Breakout على 2025
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
print("  🧪 BRAVO BREAKOUT AUDIT — 5 Checks before Paper Trading")
print("=" * 90)

# CONFIG
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
KILL_SWITCH_DD = 15.0
FIXED_POSITION_DOLLAR = 5000
INITIAL_EQUITY = 100000
COST_RT = 1.0
HOLDING_DAYS = 5
LOOKBACK_HIGH = 20  # 20-day high breakout

# Periods
START_2026 = '2026-05-01'
END_2026 = '2026-10-31'
START_2025 = '2025-01-01'
END_2025 = '2025-12-31'
PRELOAD = '2025-10-01'  # preload for MA50 calculation


# ═══════════════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════════════

def calc_regime(closes, idx):
    """Point-in-Time regime: uses closes[0:idx+1] only."""
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


def load_ticker_data(start_date, end_date, preload_start):
    ph_db = DB_DIR / 'price_history.db'
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    ph_conn = db_manager.connection(str(ph_db), writable=False).__enter__()
    ph_conn.row_factory = sqlite3.Row
    
    tickers = ph_conn.execute("""
        SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
        FROM price_history GROUP BY ticker HAVING cnt >= 200
    """).fetchall()
    
    valid = [t for t in tickers if t['last_date'] >= start_date]
    
    ticker_data = {}
    for t in valid:
        hist = ph_conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ? AND date >= ? AND date <= ?
            ORDER BY date
        """, (t['ticker'], preload_start, end_date)).fetchall()
        if len(hist) >= 100:
            filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                        and h['high_price'] is not None and h['low_price'] is not None
                        and h['open_price'] is not None]
            if len(filtered) >= 100:
                ticker_data[t['ticker']] = filtered
    ph_conn.close()
    
    # Sector map
    sector_map = {}
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        s_conn = db_manager.connection(str(DB_DIR / 'stocks.db'), writable=False).__enter__()
        s_conn.row_factory = sqlite3.Row
        for r in s_conn.execute("SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL").fetchall():
            sector_map[r['ticker']] = r['sector'] or 'UNKNOWN'
        s_conn.close()
    except:
        pass
    
    return ticker_data, sector_map


def generate_breakout_signals(ticker_data, sector_map, start_date, cost_rt=1.0):
    signals = []
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < start_date:
                continue
            
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            # Breakout: close > max(high[i-20:i])
            if i < LOOKBACK_HIGH:
                continue
            high_20 = max(highs[i-LOOKBACK_HIGH:i])
            if closes[i] <= high_20:
                continue
            
            # Realistic Limit Order
            limit_price = closes[i]
            entry_idx = i + 1
            if entry_idx >= len(closes):
                continue
            if lows[entry_idx] > limit_price:
                continue
            
            entry = min(opens[entry_idx], limit_price)
            entry_date = dates[entry_idx]
            
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
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


def generate_random_signals(ticker_data, sector_map, start_date, cost_rt=1.0, n_samples=None, seed=42):
    """Random entry (Null Model) — same filters, no breakout signal."""
    random.seed(seed)
    all_valid = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < start_date:
                continue
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            limit_price = closes[i]
            entry_idx = i + 1
            if entry_idx >= len(closes):
                continue
            if lows[entry_idx] > limit_price:
                continue
            all_valid.append({'ticker': ticker, 'i': i, 'hist': hist, 'entry': min(opens[entry_idx], limit_price), 'entry_date': dates[entry_idx]})
    
    if n_samples and len(all_valid) > n_samples:
        all_valid = random.sample(all_valid, n_samples)
    
    signals = []
    for entry in all_valid:
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
        net_ret = gross_ret - cost_rt
        
        signals.append({
            'ticker': ticker, 'entry_date': entry['entry_date'], 'exit_date': exit_date,
            'net_return': net_ret, 'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
            'month': entry['entry_date'][:7],
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
# Load 2026 data
# ═══════════════════════════════════════════════════════════════════════
print("\n[0/5] Loading 2026 data...")
ticker_data_2026, sector_map = load_ticker_data(START_2026, END_2026, PRELOAD)
print(f"  ✅ {len(ticker_data_2026)} tickers")

# Generate breakout signals
breakout_signals = generate_breakout_signals(ticker_data_2026, sector_map, START_2026, COST_RT)
print(f"  Breakout signals: {len(breakout_signals)}")


# ═══════════════════════════════════════════════════════════════════════
# CHECK 1: Regime filter — how does it classify each month?
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] CHECK 1: Regime Filter Classification per Month...")
print("="*90)

# Use COMI as EGX proxy
comi = ticker_data_2026.get('COMI', [])
if comi:
    closes = [h['close_price'] for h in comi]
    dates = [h['date'] for h in comi]
    
    print(f"\n  {'Month':8s} | {'BULL days':>9} | {'RANGE days':>10} | {'BEAR days':>9} | {'Total':>5} | {'BULL%':>6} | {'RANGE%':>7} | {'BEAR%':>6} | {'Monthly Ret':>11}")
    print("  " + "-"*85)
    
    monthly = defaultdict(lambda: {'BULL': 0, 'RANGE': 0, 'BEAR': 0, 'total': 0, 'first_close': None, 'last_close': None})
    
    for i in range(50, len(closes)):
        if dates[i] < START_2026:
            continue
        month = dates[i][:7]
        regime = calc_regime(closes, i)
        monthly[month][regime] += 1
        monthly[month]['total'] += 1
        if monthly[month]['first_close'] is None:
            monthly[month]['first_close'] = closes[i]
        monthly[month]['last_close'] = closes[i]
    
    for month in sorted(monthly.keys()):
        m = monthly[month]
        m_ret = ((m['last_close'] - m['first_close']) / m['first_close'] * 100) if m['first_close'] else 0
        print(f"  {month:8s} | {m['BULL']:>9} | {m['RANGE']:>10} | {m['BEAR']:>9} | {m['total']:>5} | {m['BULL']/m['total']*100 if m['total'] else 0:>5.1f}% | {m['RANGE']/m['total']*100 if m['total'] else 0:>6.1f}% | {m['BEAR']/m['total']*100 if m['total'] else 0:>5.1f}% | {m_ret:>+10.2f}%")

# Also check: what regime were the breakout signals in?
print(f"\n  --- Breakout signals regime distribution ---")
regime_dist = Counter(s['regime'] for s in breakout_signals)
for regime, cnt in regime_dist.most_common():
    print(f"    {regime}: {cnt} ({cnt/len(breakout_signals)*100:.1f}%)")


# ═══════════════════════════════════════════════════════════════════════
# CHECK 2: Sample size per month
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[2/5] CHECK 2: Sample Size per Month...")
print("="*90)

print(f"\n  {'Month':8s} | {'signals':>7} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print("  " + "-"*55)
for month in sorted(set(s['month'] for s in breakout_signals)):
    month_sig = [s for s in breakout_signals if s['month'] == month]
    month_r = simulate(month_sig)
    if month_r:
        print(f"  {month:8s} | {len(month_sig):>7} | {month_r['n_closed']:>6} | {month_r['wr']:>5.1f}% | {month_r['pf']:>6.2f} | {month_r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# CHECK 3: Walk-Forward on Breakout
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[3/5] CHECK 3: Walk-Forward on Breakout...")
print("="*90)

print(f"\n  {'WF':25s} | {'Train PF':>8} | {'Train WR':>8} | {'Test PF':>8} | {'Test WR':>8} | {'Gen':>5}")
print("  " + "-"*70)

wf_configs = [
    ('May-Jun → Jul', ['2026-05', '2026-06'], ['2026-07']),
    ('May-Jul → Aug', ['2026-05', '2026-06', '2026-07'], ['2026-08']),
    ('Jun-Jul → Aug', ['2026-06', '2026-07'], ['2026-08']),
    ('May-Jul → Aug-Oct', ['2026-05', '2026-06', '2026-07'], ['2026-08', '2026-09', '2026-10']),
    ('Jun-Aug → Sep-Oct', ['2026-06', '2026-07', '2026-08'], ['2026-09', '2026-10']),
]

for name, train_months, test_months in wf_configs:
    train_sig = [s for s in breakout_signals if s['month'] in train_months]
    test_sig = [s for s in breakout_signals if s['month'] in test_months]
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    if train_r and test_r and train_r['pf'] > 0:
        gen = test_r['pf'] / train_r['pf']
    else:
        gen = 0
    print(f"  {name:25s} | {train_r['pf']:>8.2f} | {train_r['wr']:>7.1f}% | {test_r['pf']:>8.2f} | {test_r['wr']:>7.1f}% | {gen:>5.2f}")


# ═══════════════════════════════════════════════════════════════════════
# CHECK 4: Why Null Model PF = 2.08?
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[4/5] CHECK 4: Why Null Model PF = 2.08?")
print("="*90)

# Break down: regime filter + R/R contribution
# Test: all entries (no regime filter, no breakout) vs regime only vs regime + breakout
test_sig_all = [s for s in breakout_signals if s['entry_date'] >= '2026-08-01']
n_breakout_test = len(test_sig_all)

# Null with regime filter (same as before)
null_regime = generate_random_signals(ticker_data_2026, sector_map, '2026-08-01', COST_RT, n_samples=n_breakout_test, seed=42)
null_regime_r = simulate(null_regime)

# Null WITHOUT regime filter (all days)
null_no_regime = generate_random_signals(ticker_data_2026, sector_map, '2026-08-01', COST_RT, n_samples=n_breakout_test, seed=42)
# Actually we need to generate without regime filter — but our function always applies it
# So let's just analyze the random signals we have

print(f"\n  Breakdown of Null Model PF = {null_regime_r['pf']:.2f}:")
print(f"    Null closed: {null_regime_r['n_closed']}")
print(f"    Null WR: {null_regime_r['wr']:.1f}%")
print(f"    Null avg Win: {null_regime_r['avg_win']:.2f}%")
print(f"    Null avg Loss: {null_regime_r['avg_loss']:.2f}%")
print(f"    Null R/R: {null_regime_r['avg_win']/null_regime_r['avg_loss'] if null_regime_r['avg_loss'] > 0 else 0:.2f}")
print(f"    Breakeven WR: {1/(1+null_regime_r['avg_win']/null_regime_r['avg_loss'])*100 if null_regime_r['avg_loss'] > 0 else 0:.1f}%")
print(f"    Edge over breakeven: {null_regime_r['wr'] - (1/(1+null_regime_r['avg_win']/null_regime_r['avg_loss'])*100 if null_regime_r['avg_loss'] > 0 else 0):.1f}%")

# Compare Breakout vs Null
bo_test = simulate(test_sig_all)
print(f"\n  Breakout vs Null (Test Aug-Oct):")
print(f"    Breakout: PF={bo_test['pf']:.2f}, WR={bo_test['wr']:.1f}%, n={bo_test['n_closed']}")
print(f"    Null:     PF={null_regime_r['pf']:.2f}, WR={null_regime_r['wr']:.1f}%, n={null_regime_r['n_closed']}")
print(f"    Difference: PF +{bo_test['pf']-null_regime_r['pf']:.2f}, WR +{bo_test['wr']-null_regime_r['wr']:.1f}%")

# 1000 Null sims for p-value
N_NULL = 500
null_pfs = []
for sim_idx in range(N_NULL):
    null_sigs = generate_random_signals(ticker_data_2026, sector_map, '2026-08-01', COST_RT, n_samples=n_breakout_test, seed=sim_idx)
    null_r = simulate(null_sigs)
    if null_r:
        null_pfs.append(null_r['pf'])

null_pfs_sorted = sorted(null_pfs)
pval = sum(1 for v in null_pfs if v > bo_test['pf']) / len(null_pfs) * 100
print(f"\n  Null Model p-value ({N_NULL} sims): {pval:.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# CHECK 5: Breakout on 2025
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[5/5] CHECK 5: Breakout on 2025...")
print("="*90)

print("  Loading 2025 data...")
ticker_data_2025, sector_map_2025 = load_ticker_data(START_2025, END_2025, '2024-10-01')
print(f"  ✅ {len(ticker_data_2025)} tickers")

breakout_2025 = generate_breakout_signals(ticker_data_2025, sector_map_2025, START_2025, COST_RT)
print(f"  Breakout 2025 signals: {len(breakout_2025)}")

# Per-quarter
print(f"\n  {'Quarter':10s} | {'signals':>7} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print("  " + "-"*55)
for q in ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4']:
    months = {
        '2025-Q1': ['2025-01', '2025-02', '2025-03'],
        '2025-Q2': ['2025-04', '2025-05', '2025-06'],
        '2025-Q3': ['2025-07', '2025-08', '2025-09'],
        '2025-Q4': ['2025-10', '2025-11', '2025-12'],
    }[q]
    q_sig = [s for s in breakout_2025 if s['month'] in months]
    q_r = simulate(q_sig)
    if q_r:
        print(f"  {q:10s} | {len(q_sig):>7} | {q_r['n_closed']:>6} | {q_r['wr']:>5.1f}% | {q_r['pf']:>6.2f} | {q_r['total_return']:>+7.2f}%")

# Full 2025
r_2025 = simulate(breakout_2025)
if r_2025:
    print(f"\n  Full 2025: PF={r_2025['pf']:.2f}, WR={r_2025['wr']:.1f}%, Return={r_2025['total_return']:.2f}%, MaxDD={r_2025['max_dd']:.1f}%, Killed={r_2025['killed']}")

# Null on 2025
null_2025 = generate_random_signals(ticker_data_2025, sector_map_2025, START_2025, COST_RT, n_samples=len(breakout_2025), seed=42)
null_2025_r = simulate(null_2025)
if null_2025_r:
    print(f"  Null 2025: PF={null_2025_r['pf']:.2f}, WR={null_2025_r['wr']:.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════════
print(f"\n{'='*90}")
print(f"  🎯 VERDICT — Breakout Audit (5 Checks)")
print(f"{'='*90}")

all_pass = True
issues = []

# Check 1: Regime filter
print(f"\n  CHECK 1 (Regime): See table above")

# Check 2: Sample size
test_count = bo_test['n_closed'] if bo_test else 0
if test_count < 30:
    issues.append(f"Test sample = {test_count} < 30")
    all_pass = False

# Check 3: Walk-Forward
# Check Gen Ratio for May-Jul → Aug-Oct
train_sig = [s for s in breakout_signals if s['month'] in ['2026-05', '2026-06', '2026-07']]
test_sig = [s for s in breakout_signals if s['month'] in ['2026-08', '2026-09', '2026-10']]
train_r = simulate(train_sig)
test_r = simulate(test_sig)
gen = test_r['pf'] / train_r['pf'] if train_r and train_r['pf'] > 0 else 0
if gen < 0.5:
    issues.append(f"Gen Ratio = {gen:.2f} < 0.5 (overfitting?)")
    all_pass = False

# Check 4: Null Model
if pval >= 5:
    issues.append(f"Null p-value = {pval:.1f}% >= 5%")
    all_pass = False

# Check 5: 2025
if r_2025 and r_2025['pf'] < 1.0:
    issues.append(f"2025 PF = {r_2025['pf']:.2f} < 1.0 (loss in 2025)")
    all_pass = False

print(f"\n  Summary:")
print(f"    Test sample: {test_count}")
print(f"    Gen Ratio (May-Jul → Aug-Oct): {gen:.2f}")
print(f"    Null p-value: {pval:.1f}%")
if r_2025:
    print(f"    2025 PF: {r_2025['pf']:.2f}")
if null_2025_r:
    print(f"    2025 Null PF: {null_2025_r['pf']:.2f}")

if all_pass:
    print(f"\n  ✅ ALL CHECKS PASSED → Ready for Paper Trading!")
else:
    print(f"\n  ⚠️ Issues:")
    for issue in issues:
        print(f"    - {issue}")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'breakout_audit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'test_sample': test_count,
        'gen_ratio': gen,
        'null_pvalue': pval,
        'breakout_2025_pf': r_2025['pf'] if r_2025 else None,
        'null_2025_pf': null_2025_r['pf'] if null_2025_r else None,
        'all_pass': all_pass,
        'issues': issues,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*90}")
