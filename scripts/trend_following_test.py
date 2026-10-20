#!/usr/bin/env python3
"""
trend_following_test.py — استراتيجية الترند (Breakout + Pullback) vs Null Model.

الـ framework:
  1. تحليل EGX30 (COMI) من مايو-أكتوبر 2026 — هل سوق صاعد؟
  2. Breakout: سعر يخترق أعلى قمة 20 يوم → buy
  3. Pullback: فوق MA50 + نزل 5-10% في 3 أيام → buy
  4. نفس R/R (Target 10%, SL 3%) + نفس التكاليف (1.0%) + Realistic Limit
  5. مقارنة بـ Null Model (random entry)
  6. لو PF > 2.05 (Null) → عندنا edge حقيقي
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
print("  🧪 BRAVO TREND FOLLOWING TEST — Breakout + Pullback vs Null Model")
print("=" * 90)

# CONFIG (same R/R + costs as before)
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
KILL_SWITCH_DD = 15.0
FIXED_POSITION_DOLLAR = 5000
INITIAL_EQUITY = 100000
COST_RT = 1.0
HOLDING_DAYS = 5

START_DATE = '2026-05-01'
END_DATE = '2026-10-31'
PRELOAD_START = '2026-01-01'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات + تحليل EGX (COMI)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل البيانات + تحليل EGX...")

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

# EGX analysis (COMI as proxy)
comi_data = ticker_data.get('COMI', [])
if comi_data:
    comi_may = [h for h in comi_data if h['date'] >= '2026-05-01']
    if comi_may:
        first_close = comi_may[0]['close_price']
        last_close = comi_may[-1]['close_price']
        egx_return = ((last_close - first_close) / first_close) * 100
        print(f"\n  📊 EGX (COMI) Analysis (May-Oct 2026):")
        print(f"    Start: {first_close:.2f} ({comi_may[0]['date']})")
        print(f"    End:   {last_close:.2f} ({comi_may[-1]['date']})")
        print(f"    Return: {egx_return:+.2f}%")
        
        # Monthly returns
        print(f"\n    Monthly:")
        from collections import defaultdict
        monthly = defaultdict(list)
        for h in comi_may:
            monthly[h['date'][:7]].append(h['close_price'])
        for month in sorted(monthly.keys()):
            prices = monthly[month]
            m_ret = ((prices[-1] - prices[0]) / prices[0]) * 100
            print(f"      {month}: {m_ret:+.2f}%")
        
        if egx_return > 10:
            print(f"\n    ✅ EGX was BULL MARKET (+{egx_return:.1f}%)")
        elif egx_return > 0:
            print(f"\n    ⚠️ EGX was slightly UP (+{egx_return:.1f}%)")
        else:
            print(f"\n    ❌ EGX was BEAR ({egx_return:.1f}%)")


# ═══════════════════════════════════════════════════════════════════════
# 2. Signal generation (3 strategies)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] Signal generation (3 strategies)...")

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


def generate_signals(ticker_data, strategy='breakout', cost_rt=1.0):
    """
    Generate signals for different strategies.
    
    strategy:
      'breakout'    — price breaks above 20-day high → buy
      'pullback'    — above MA50 + dropped 5-10% in 3 days → buy (buy the dip in uptrend)
      'random'      — random entry (any day passing filters)
    """
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < START_DATE:
                continue
            
            # Liquidity filter
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            # Regime filter (BULL + RANGE only)
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            # === STRATEGY SIGNAL ===
            signal_triggered = False
            
            if strategy == 'breakout':
                # Breakout: close[i] > max(high[i-20:i]) (20-day high breakout)
                if i >= 20:
                    high_20 = max(highs[i-20:i])
                    if closes[i] > high_20:
                        signal_triggered = True
            
            elif strategy == 'pullback':
                # Pullback in uptrend: above MA50 + dropped 5-10% in 3 days
                if i >= 50:
                    ma50 = sum(closes[i-50:i+1]) / 51
                    if closes[i] > ma50:  # above MA50 (uptrend)
                        drop_3d = ((closes[i-3] - closes[i]) / closes[i-3]) * 100 if i >= 3 and closes[i-3] > 0 else 0
                        if 5 <= drop_3d <= 10:  # dropped 5-10% in 3 days
                            signal_triggered = True
            
            elif strategy == 'random':
                # Random entry (any day passing filters)
                signal_triggered = True
            
            if not signal_triggered:
                continue
            
            # Realistic Limit Order at close
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
            
            # Exit: SL first (conservative)
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


# Generate for all 3 strategies
breakout_signals = generate_signals(ticker_data, 'breakout')
pullback_signals = generate_signals(ticker_data, 'pullback')
random_signals = generate_signals(ticker_data, 'random')

print(f"  Breakout (20-day high): {len(breakout_signals)} signals")
print(f"  Pullback (MA50 + drop 5-10%): {len(pullback_signals)} signals")
print(f"  Random (baseline): {len(random_signals)} signals")


# ═══════════════════════════════════════════════════════════════════════
# 3. Simulation (same as before)
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] Simulation...")

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
# 4. Compare 3 strategies (Full + Train + Test)
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Comparison (3 strategies, cost=1.0%)...")
print("="*100)

scenarios = [
    ('Breakout (20-day high)', breakout_signals),
    ('Pullback (MA50 + dip)', pullback_signals),
    ('Random (Null baseline)', random_signals),
]

print(f"\n  {'Strategy':25s} | {'Period':8s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7}")
print("  " + "-"*85)

results = {}
for name, sigs in scenarios:
    train_sig = [s for s in sigs if s['entry_date'] <= '2026-07-31']
    test_sig = [s for s in sigs if s['entry_date'] >= '2026-08-01']
    
    full_r = simulate(sigs)
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    results[name] = {'full': full_r, 'train': train_r, 'test': test_r}
    
    for label, r in [('Full', full_r), ('Train', train_r), ('Test', test_r)]:
        if r:
            print(f"  {name:25s} | {label:8s} | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7}")
    print()


# ═══════════════════════════════════════════════════════════════════════
# 5. Null Model comparison (Breakout + Pullback vs Random)
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] Strategy vs Null Model (Test Aug-Oct)...")
print("="*90)

# Null = random entry (1000 simulations with different random subsets)
N_NULL = 200  # fewer sims for speed
random_test = [s for s in random_signals if s['entry_date'] >= '2026-08-01']
null_pfs = []
null_wrs = []

for sim_idx in range(N_NULL):
    random.seed(sim_idx)
    # Sample same size as breakout test
    n_samples = len([s for s in breakout_signals if s['entry_date'] >= '2026-08-01'])
    if len(random_test) > n_samples and n_samples > 0:
        sampled = random.sample(random_test, n_samples)
    else:
        sampled = random_test
    r = simulate(sampled)
    if r:
        null_pfs.append(r['pf'])
        null_wrs.append(r['wr'])

null_pfs_sorted = sorted(null_pfs)
null_wrs_sorted = sorted(null_wrs)

def p_value(baseline, null_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in null_values if v > baseline)
    else:
        n_better = sum(1 for v in null_values if v < baseline)
    return n_better / len(null_values) * 100

print(f"\n  {'Strategy':25s} | {'Test PF':>8} | {'Test WR':>8} | {'Null PF med':>12} | {'p-value PF':>10} | {'Edge?':>6}")
print("  " + "-"*80)

for name, sigs in [('Breakout', breakout_signals), ('Pullback', pullback_signals)]:
    test_sig = [s for s in sigs if s['entry_date'] >= '2026-08-01']
    test_r = simulate(test_sig)
    
    if test_r and null_pfs:
        null_median = null_pfs_sorted[len(null_pfs)//2]
        pval = p_value(test_r['pf'], null_pfs)
        edge = '✅' if pval < 5 else '❌'
        print(f"  {name:25s} | {test_r['pf']:>8.2f} | {test_r['wr']:>7.1f}% | {null_median:>12.2f} | {pval:>9.1f}% | {edge:>6}")

# VERDICT
print(f"\n{'='*90}")
print(f"  🎯 VERDICT — Trend Following vs Mean Reversion vs Null")
print(f"{'='*90}")

bo_test = results.get('Breakout (20-day high)', {}).get('test')
pb_test = results.get('Pullback (MA50 + dip)', {}).get('test')
rnd_test = results.get('Random (Null baseline)', {}).get('test')

if bo_test and pb_test and rnd_test:
    print(f"""
  Test (Aug-Oct 2026):
    Breakout:  PF = {bo_test['pf']:.2f} | WR = {bo_test['wr']:.1f}% | Return = {bo_test['total_return']:.2f}%
    Pullback:  PF = {pb_test['pf']:.2f} | WR = {pb_test['wr']:.1f}% | Return = {pb_test['total_return']:.2f}%
    Random:    PF = {rnd_test['pf']:.2f} | WR = {rnd_test['wr']:.1f}% | Return = {rnd_test['total_return']:.2f}%
  
  Null median PF = {null_pfs_sorted[len(null_pfs)//2] if null_pfs else 0:.2f}
""")

    best_pf = max(bo_test['pf'], pb_test['pf'])
    best_name = 'Breakout' if bo_test['pf'] > pb_test['pf'] else 'Pullback'
    
    if best_pf > null_pfs_sorted[len(null_pfs)//2] if null_pfs else 0:
        print(f"  ✅ {best_name} PF = {best_pf:.2f} > Null median = {null_pfs_sorted[len(null_pfs)//2] if null_pfs else 0:.2f}")
        print(f"  → {best_name} has edge over random!")
    else:
        print(f"  ❌ No strategy beats Null Model")
        print(f"  → The R/R + bull market is the edge, not the signal")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'trend_following_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'results': {name: {k: v for k, v in r.items() if v} for name, r in results.items()},
        'null_median_pf': null_pfs_sorted[len(null_pfs)//2] if null_pfs else None,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*90}")
