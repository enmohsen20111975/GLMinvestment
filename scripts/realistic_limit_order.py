#!/usr/bin/env python3
"""
realistic_limit_order.py — Realistic Limit Order Logic (corrected).

الـ CORRECTED logic:
  Buy Limit Order at closes[i]:
  - لو low[i+1] <= closes[i] → الأمر يتنفذ (السعر وصل لـ limit)
    entry = min(opens[i+1], closes[i])
    (لو فتح تحت → entry = opens; لو فتح فوق بس نزل → entry = closes)
  - لو low[i+1] > closes[i] → الأمر ما يتنفذش (السعر ما وصلش لـ limit)
    SKIP

  ده = لا lookahead + لا cherry-picking + execution realistic

مقارنة 4 scenarios:
  1. Next-Day Open (baseline realistic): entry = opens[i+1]
  2. Realistic Limit: entry = min(opens[i+1], closes[i]) IF low[i+1] <= closes[i]
  3. Wait 1 Rebound: entry = opens[i+2] IF closes[i+1] > closes[i]
  4. Close (lookahead reference): entry = closes[i] — للـ comparison فقط
"""
import sys
import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from collections import defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO REALISTIC LIMIT ORDER — Corrected Logic (no cherry-picking)")
print("=" * 90)

# CONFIG (unchanged)
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
COST_RT = 1.0

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل البيانات...")

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
    """, (t['ticker'], START_DATE, END_DATE)).fetchall()
    if len(hist) >= 200:
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None
                    and h['open_price'] is not None]
        if len(filtered) >= 200:
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
# 2. Generate signals for 4 entry methods
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] Generating signals for 4 entry methods...")

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


def generate_signals(ticker_data, entry_method='next_open'):
    """
    Generate signals with specified entry method.
    
    entry_method:
      'next_open'       — entry = opens[i+1] (baseline realistic)
      'realistic_limit' — Buy Limit at closes[i]:
                          IF low[i+1] <= closes[i] → entry = min(opens[i+1], closes[i])
                          IF low[i+1] > closes[i] → SKIP (price never reached limit)
      'wait_rebound'    — entry = opens[i+2] IF closes[i+1] > closes[i], else SKIP
      'close_lookahead' — entry = closes[i] (LOOKAHEAD — for reference only)
    """
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS - 3):
            # Liquidity filter (Point-in-Time)
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            # Drop signal
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - closes[i]) / past_close) * 100
            if drop_pct < DROP_THRESHOLD:
                continue
            
            # Regime filter (Point-in-Time)
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            # === ENTRY METHOD ===
            entry = None
            entry_idx = None
            entry_date = None
            limit_price = closes[i]  # the limit order price
            
            if entry_method == 'next_open':
                entry_idx = i + 1
                if entry_idx >= len(closes):
                    continue
                entry = opens[entry_idx]
                entry_date = dates[entry_idx]
            
            elif entry_method == 'realistic_limit':
                # Buy Limit at closes[i]
                # Executes ONLY if price reaches limit (low[i+1] <= closes[i])
                entry_idx = i + 1
                if entry_idx >= len(closes):
                    continue
                if lows[entry_idx] > limit_price:
                    # Price never reached limit → SKIP
                    continue
                # Limit filled → entry = min(open, limit)
                # If opened below limit → buy at open (better price)
                # If opened above limit but dropped → buy at limit
                entry = min(opens[entry_idx], limit_price)
                entry_date = dates[entry_idx]
            
            elif entry_method == 'wait_rebound':
                if i + 2 >= len(closes):
                    continue
                if closes[i + 1] <= closes[i]:
                    continue  # No rebound → SKIP
                entry_idx = i + 2
                entry = opens[entry_idx]
                entry_date = dates[entry_idx]
            
            elif entry_method == 'close_lookahead':
                # LOOKAHEAD — for reference only
                entry_idx = i
                entry = closes[i]
                entry_date = dates[i]
            
            if entry is None or entry <= 0:
                continue
            
            # SL + Target
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
            # Exit logic
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
            net_ret = gross_ret - COST_RT
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'net_return': net_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'year': entry_date[:4],
                'exit_reason': exit_reason,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
            })
    
    return signals


# Generate for all 4 methods
print("  Generating...")
signals_next_open = generate_signals(ticker_data, 'next_open')
signals_realistic_limit = generate_signals(ticker_data, 'realistic_limit')
signals_wait_rebound = generate_signals(ticker_data, 'wait_rebound')
signals_close_lookahead = generate_signals(ticker_data, 'close_lookahead')

print(f"  Next-Day Open (baseline):  {len(signals_next_open)} signals")
print(f"  Realistic Limit:           {len(signals_realistic_limit)} signals")
print(f"  Wait 1 Rebound:            {len(signals_wait_rebound)} signals")
print(f"  Close (lookahead ref):     {len(signals_close_lookahead)} signals")


# ═══════════════════════════════════════════════════════════════════════
# 3. Simulation
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] Simulation...")

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
# 4. Compare 4 scenarios
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] Comparison (4 scenarios, Train/Test, cost=1.0%)...")
print("="*100)

scenarios = [
    ('Next-Day Open (realistic)', signals_next_open),
    ('Realistic Limit', signals_realistic_limit),
    ('Wait 1 Rebound', signals_wait_rebound),
    ('Close (LOOKAHEAD ref)', signals_close_lookahead),
]

print(f"\n  {'Scenario':30s} | {'Period':8s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7} | {'avgWin':>7} | {'avgLoss':>7}")
print("  " + "-"*110)

results = {}
for name, sigs in scenarios:
    train_sig = [s for s in sigs if s['entry_date'] <= '2025-12-31']
    test_sig = [s for s in sigs if s['entry_date'] >= '2026-01-01']
    
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    results[name] = {'train': train_r, 'test': test_r}
    
    if train_r:
        print(f"  {name:30s} | {'Train':8s} | {train_r['n_closed']:>6} | {train_r['wr']:>5.1f}% | {train_r['pf']:>6.2f} | {train_r['max_dd']:>5.1f}% | {train_r['total_return']:>+7.2f}% | {str(train_r['killed']):>7} | {train_r['avg_win']:>+6.2f}% | {train_r['avg_loss']:>+6.2f}%")
    if test_r:
        print(f"  {name:30s} | {'Test':8s} | {test_r['n_closed']:>6} | {test_r['wr']:>5.1f}% | {test_r['pf']:>6.2f} | {test_r['max_dd']:>5.1f}% | {test_r['total_return']:>+7.2f}% | {str(test_r['killed']):>7} | {test_r['avg_win']:>+6.2f}% | {test_r['avg_loss']:>+6.2f}%")
    print()

# Stress Test on Realistic Limit
print(f"\n  --- Stress Test (1.0% + 1.5% cost) on Realistic Limit ---")
print(f"  {'Cost':>5s} | {'Period':8s} | {'PF':>6} | {'Return':>8} | {'Killed':>7}")
print("  " + "-"*50)

for cost in [1.0, 1.5]:
    cost_diff = cost - COST_RT
    adjusted = [{**s, 'net_return': s['net_return'] - cost_diff} for s in signals_realistic_limit]
    
    train_sig = [s for s in adjusted if s['entry_date'] <= '2025-12-31']
    test_sig = [s for s in adjusted if s['entry_date'] >= '2026-01-01']
    
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    if train_r:
        print(f"  {cost:>4.1f}% | {'Train':8s} | {train_r['pf']:>6.2f} | {train_r['total_return']:>+7.2f}% | {str(train_r['killed']):>7}")
    if test_r:
        print(f"  {cost:>4.1f}% | {'Test':8s} | {test_r['pf']:>6.2f} | {test_r['total_return']:>+7.2f}% | {str(test_r['killed']):>7}")

# VERDICT
print(f"\n{'='*100}")
print(f"  🎯 VERDICT — Realistic Limit Order")
print(f"{'='*100}")

rl_test = results.get('Realistic Limit', {}).get('test')
no_test = results.get('Next-Day Open (realistic)', {}).get('test')
cl_test = results.get('Close (LOOKAHEAD ref)', {}).get('test')

if rl_test and no_test:
    print(f"""
  Realistic Limit:
    Test PF = {rl_test['pf']:.2f} | WR = {rl_test['wr']:.1f}% | Return = {rl_test['total_return']:.2f}% | MaxDD = {rl_test['max_dd']:.1f}%
  
  Next-Day Open (baseline):
    Test PF = {no_test['pf']:.2f} | WR = {no_test['wr']:.1f}% | Return = {no_test['total_return']:.2f}% | MaxDD = {no_test['max_dd']:.1f}%
  
  Close (LOOKAHEAD reference):
    Test PF = {cl_test['pf']:.2f} | WR = {cl_test['wr']:.1f}% | Return = {cl_test['total_return']:.2f}%
""")

    if rl_test['pf'] > 1.3:
        print(f"  ✅ Realistic Limit PASSES: PF = {rl_test['pf']:.2f} > 1.3")
    elif rl_test['pf'] > 1.0:
        print(f"  ⚠️ Realistic Limit marginal: PF = {rl_test['pf']:.2f} > 1.0 but not > 1.3")
    else:
        print(f"  ❌ Realistic Limit FAILS: PF = {rl_test['pf']:.2f} < 1.0")

    # How much did the limit help vs next-day open?
    diff_pf = rl_test['pf'] - no_test['pf']
    print(f"\n  Limit vs Next-Day Open: PF difference = {diff_pf:+.2f}")
    if diff_pf > 0.2:
        print(f"  → Limit Order adds value (+{diff_pf:.2f} PF)")
    elif diff_pf > 0:
        print(f"  → Limit Order slightly better (+{diff_pf:.2f} PF)")
    else:
        print(f"  → Limit Order NOT better than Next-Day Open")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'realistic_limit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'results': {name: {'train': r['train'], 'test': r['test']} for name, r in results.items() if r['train'] and r['test']},
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*100}")
