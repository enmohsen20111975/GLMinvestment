#!/usr/bin/env python3
"""
train_analysis.py — تحليل Train بالتفصيل + Walk-Forward.

الـ tasks:
  1. تقسيم Train لـ 2024 و 2025 (PF + WR + Regime + trades)
  2. جدول PF لكل سنة عند 1.0% و 1.5% cost
  3. Walk-Forward: 2024→2025 + 2024-2025→2026
  4. توزيع avg return per trade per year
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
print("  🧪 BRAVO TRAIN ANALYSIS — Per Year + Walk-Forward")
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

print(f"  ✅ {len(ticker_data)} tickers")


# ═══════════════════════════════════════════════════════════════════════
# 2. Signal generation (Realistic Limit Order)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] Signal generation (Realistic Limit Order)...")

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


def generate_signals(ticker_data, cost_rt=1.0):
    """Realistic Limit Order signals."""
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        opens = [h['open_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        lows = [h['low_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS - 3):
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
                'gross_return': gross_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'regime': regime,
                'year': entry_date[:4],
                'exit_reason': exit_reason,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
                'drop_pct': drop_pct,
            })
    
    return signals


# Generate at different costs
signals_100 = generate_signals(ticker_data, cost_rt=1.0)
signals_150 = generate_signals(ticker_data, cost_rt=1.5)

print(f"  Signals (1.0% cost): {len(signals_100)}")
print(f"  Signals (1.5% cost): {len(signals_150)}")


# ═══════════════════════════════════════════════════════════════════════
# 3. Simulation
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
# 4. Per-year analysis (2024 / 2025 / 2026) at 1.0% and 1.5% cost
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Per-Year Analysis...")
print("="*100)

for cost_label, signals in [('1.0%', signals_100), ('1.5%', signals_150)]:
    print(f"\n  --- Cost = {cost_label} ---")
    print(f"  {'Year':6s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7} | {'avgWin':>7} | {'avgLoss':>7} | {'R/R':>5}")
    print("  " + "-"*90)
    
    for year in ['2024', '2025', '2026']:
        year_sig = [s for s in signals if s['year'] == year]
        r = simulate(year_sig)
        if r:
            rr = r['avg_win'] / r['avg_loss'] if r['avg_loss'] > 0 else 0
            print(f"  {year:6s} | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7} | {r['avg_win']:>+6.2f}% | {r['avg_loss']:>+6.2f}% | {rr:>5.2f}")

# Regime distribution per year
print(f"\n  --- Regime Distribution per Year ---")
print(f"  {'Year':6s} | {'BULL':>6} | {'RANGE':>6} | {'Total':>6} | {'BULL%':>6} | {'RANGE%':>7}")
print("  " + "-"*55)
for year in ['2024', '2025', '2026']:
    year_sig = [s for s in signals_100 if s['year'] == year]
    bull = sum(1 for s in year_sig if s['regime'] == 'BULL')
    range_ = sum(1 for s in year_sig if s['regime'] == 'RANGE')
    total = len(year_sig)
    print(f"  {year:6s} | {bull:>6} | {range_:>6} | {total:>6} | {bull/total*100 if total else 0:>5.1f}% | {range_/total*100 if total else 0:>6.1f}%")

# Exit reasons per year
print(f"\n  --- Exit Reasons per Year ---")
from collections import Counter
for year in ['2024', '2025', '2026']:
    year_sig = [s for s in signals_100 if s['year'] == year]
    if not year_sig:
        continue
    exits = Counter(s['exit_reason'] for s in year_sig)
    total = len(year_sig)
    print(f"\n  {year}:")
    for reason, cnt in exits.most_common():
        print(f"    {reason:15s}: {cnt:>4} ({cnt/total*100:.1f}%)")

# Avg return per trade per year
print(f"\n  --- Avg Return per Trade per Year ---")
print(f"  {'Year':6s} | {'avg_net':>8} | {'avg_gross':>9} | {'median':>8} | {'min':>8} | {'max':>8}")
print("  " + "-"*55)
for year in ['2024', '2025', '2026']:
    year_sig = [s for s in signals_100 if s['year'] == year]
    if not year_sig:
        continue
    nets = [s['net_return'] for s in year_sig]
    gross = [s['gross_return'] for s in year_sig]
    import statistics
    print(f"  {year:6s} | {sum(nets)/len(nets):>+7.2f}% | {sum(gross)/len(gross):>+8.2f}% | {statistics.median(nets):>+7.2f}% | {min(nets):>+7.2f}% | {max(nets):>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. Walk-Forward Validation
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[5/5] Walk-Forward Validation...")
print("="*100)

# WF1: Train=2024, Test=2025
wf1_train = [s for s in signals_100 if s['year'] == '2024']
wf1_test = [s for s in signals_100 if s['year'] == '2025']

# WF2: Train=2024-2025, Test=2026
wf2_train = [s for s in signals_100 if s['year'] in ('2024', '2025')]
wf2_test = [s for s in signals_100 if s['year'] == '2026']

# WF3: Train=2025, Test=2026
wf3_train = [s for s in signals_100 if s['year'] == '2025']
wf3_test = [s for s in signals_100 if s['year'] == '2026']

print(f"\n  {'Walk-Forward':25s} | {'Train PF':>8} | {'Train WR':>8} | {'Test PF':>8} | {'Test WR':>8} | {'Gen Ratio':>9}")
print("  " + "-"*80)

for name, train_sig, test_sig in [
    ('WF1: 2024 → 2025', wf1_train, wf1_test),
    ('WF2: 2024-2025 → 2026', wf2_train, wf2_test),
    ('WF3: 2025 → 2026', wf3_train, wf3_test),
]:
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    if train_r and test_r and train_r['pf'] > 0:
        gen_ratio = test_r['pf'] / train_r['pf']
    else:
        gen_ratio = 0
    
    print(f"  {name:25s} | {train_r['pf']:>8.2f} | {train_r['wr']:>7.1f}% | {test_r['pf']:>8.2f} | {test_r['wr']:>7.1f}% | {gen_ratio:>9.2f}")

# VERDICT
print(f"\n{'='*100}")
print(f"  🎯 VERDICT — Train Analysis + Walk-Forward")
print(f"{'='*100}")

# Per-year PF at 1.0%
r2024 = simulate([s for s in signals_100 if s['year'] == '2024'])
r2025 = simulate([s for s in signals_100 if s['year'] == '2025'])
r2026 = simulate([s for s in signals_100 if s['year'] == '2026'])

# Per-year PF at 1.5%
r2024_15 = simulate([s for s in signals_150 if s['year'] == '2024'])
r2025_15 = simulate([s for s in signals_150 if s['year'] == '2025'])
r2026_15 = simulate([s for s in signals_150 if s['year'] == '2026'])

print(f"""
  Per-Year PF Summary:
  
  {'Year':6s} | {'PF @1.0%':>9} | {'PF @1.5%':>9} | {'Verdict':>10}
  {'-'*45}""")

for year, r10, r15 in [('2024', r2024, r2024_15), ('2025', r2025, r2025_15), ('2026', r2026, r2026_15)]:
    if r10 and r15:
        verdict = '✅' if r10['pf'] > 1.3 and r15['pf'] > 1.0 else '⚠️' if r10['pf'] > 1.0 else '❌'
        print(f"  {year:6s} | {r10['pf']:>9.2f} | {r15['pf']:>9.2f} | {verdict:>10}")

# Stability check
pfs = [r['pf'] for r in [r2024, r2025, r2026] if r]
pf_range = max(pfs) - min(pfs) if pfs else 0
pf_cv = (statistics.stdev(pfs) / statistics.mean(pfs) * 100) if len(pfs) > 1 else 0

print(f"""
  Stability:
    PF range (max-min): {pf_range:.2f}
    PF coefficient of variation: {pf_cv:.1f}%
    {'✅ Stable' if pf_cv < 30 else '⚠️ Unstable' if pf_cv < 60 else '❌ Very unstable'}
""")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'train_analysis_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'per_year_1.0': {year: simulate([s for s in signals_100 if s['year'] == year]) for year in ['2024','2025','2026']},
        'per_year_1.5': {year: simulate([s for s in signals_150 if s['year'] == year]) for year in ['2024','2025','2026']},
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*100}")
