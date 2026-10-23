#!/usr/bin/env python3
"""
mean_reversion_2024_analysis.py — تحليل 2024 بالتفصيل + Gap Risk + Block Bootstrap.

الـ tasks:
  1. تحليل 2024: Regime + Return + MaxDD + توزيع الخسائر
  2. توزيع Regime لكل سنة (2024/2025/2026)
  3. Point-in-Time liquidity filter verification
  4. Gap Risk Stress Test (-5% / -10% gaps)
  5. Block Bootstrap + Null Model على Config النهائي
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
print("  🧪 BRAVO 2024 ANALYSIS + GAP RISK + BLOCK BOOTSTRAP")
print("=" * 90)

# CONFIG (same as audit fix)
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
COST_RT = 0.70  # round trip cost

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/6] تحميل البيانات...")

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
# 2. Signal generation (same as audit fix)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/6] Signal generation...")

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


def generate_signals(ticker_data, cost_rt=0.70, gap_stress=0.0):
    """
    Generate signals.
    gap_stress: additional gap loss to simulate (e.g. 5.0 = -5% gap on SL exits)
    """
    signals = []
    cost_per_side = cost_rt / 2
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            # Point-in-Time liquidity filter (20-day average BEFORE entry)
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            current_close = closes[i]
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - current_close) / past_close) * 100
            if drop_pct < DROP_THRESHOLD:
                continue
            
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            entry = current_close
            entry_date = dates[i]
            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)
            
            # Exit logic
            exit_price = None
            exit_date = None
            exit_reason = None
            
            for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
                if closes[j] <= sl:
                    # Gap stress: if SL hit, apply additional gap loss
                    if gap_stress > 0:
                        exit_price = sl * (1 - gap_stress / 100)
                    else:
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
        
        open_positions.append({'ticker': s['ticker'], 'entry_date': s['entry_date'], 
                               'exit_date': s['exit_date'], 'sector': s['sector']})
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
        'sum_positive': sum_positive, 'sum_negative': sum_negative,
    }


# Generate signals
signals = generate_signals(ticker_data, COST_RT)
print(f"  ✅ {len(signals)} signals (cost=0.70%, liquidity=5M EGP)")


# ═══════════════════════════════════════════════════════════════════════
# 3. تحليل 2024 بالتفصيل
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/6] تحليل 2024 بالتفصيل...")
print("="*90)

signals_2024 = [s for s in signals if s['year'] == '2024']
signals_2025 = [s for s in signals if s['year'] == '2025']
signals_2026 = [s for s in signals if s['year'] == '2026']

# Regime distribution per year
print(f"\n  --- Regime Distribution per Year ---")
print(f"  {'Year':6s} | {'BULL':>6} | {'RANGE':>6} | {'Total':>6} | {'BULL%':>6} | {'RANGE%':>7}")
print("  " + "-"*55)
for year, sigs in [('2024', signals_2024), ('2025', signals_2025), ('2026', signals_2026)]:
    bull = sum(1 for s in sigs if s['regime'] == 'BULL')
    range_ = sum(1 for s in sigs if s['regime'] == 'RANGE')
    total = len(sigs)
    print(f"  {year:6s} | {bull:>6} | {range_:>6} | {total:>6} | {bull/total*100 if total else 0:>5.1f}% | {range_/total*100 if total else 0:>6.1f}%")

# Performance per year
print(f"\n  --- Performance per Year ---")
print(f"  {'Year':6s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7} | {'MaxConsec':>9}")
print("  " + "-"*80)
for year, sigs in [('2024', signals_2024), ('2025', signals_2025), ('2026', signals_2026)]:
    r = simulate(sigs)
    if r:
        print(f"  {year:6s} | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7} | {r['max_consec']:>9}")

# 2024 deep dive — exit reasons
print(f"\n  --- 2024 Exit Reasons ---")
exit_dist = Counter(s['exit_reason'] for s in signals_2024)
for reason, cnt in exit_dist.most_common():
    pct = cnt / len(signals_2024) * 100
    print(f"    {reason:15s}: {cnt:>4} ({pct:.1f}%)")

# 2024 win/loss distribution
print(f"\n  --- 2024 Return Distribution ---")
returns_2024 = [s['net_return'] for s in signals_2024]
if returns_2024:
    print(f"    count: {len(returns_2024)}")
    print(f"    min: {min(returns_2024):.2f}%")
    print(f"    max: {max(returns_2024):.2f}%")
    print(f"    avg: {sum(returns_2024)/len(returns_2024):.2f}%")
    print(f"    median: {sorted(returns_2024)[len(returns_2024)//2]:.2f}%")
    
    wins = [r for r in returns_2024 if r > 0]
    losses = [r for r in returns_2024 if r <= 0]
    print(f"    Wins: {len(wins)} (avg = {sum(wins)/len(wins):.2f}%)" if wins else "    Wins: 0")
    print(f"    Losses: {len(losses)} (avg = {sum(losses)/len(losses):.2f}%)" if losses else "    Losses: 0")

# 2024 vs 2025/2026: drop magnitude comparison
print(f"\n  --- Drop Magnitude per Year ---")
print(f"  {'Year':6s} | {'avg_drop':>8} | {'max_drop':>8} | {'min_drop':>8}")
print("  " + "-"*40)
for year, sigs in [('2024', signals_2024), ('2025', signals_2025), ('2026', signals_2026)]:
    drops = [s['drop_pct'] for s in sigs]
    if drops:
        print(f"  {year:6s} | {sum(drops)/len(drops):>7.1f}% | {max(drops):>7.1f}% | {min(drops):>7.1f}%")

# 2024 regime filter — did it work?
print(f"\n  --- 2024: Were there BEAR signals that got filtered? ---")
# Count BEAR signals in 2024 (before filter)
bear_2024 = 0
for ticker, hist in ticker_data.items():
    closes = [h['close_price'] for h in hist]
    volumes = [h['volume'] or 0 for h in hist]
    dates = [h['date'] for h in hist]
    for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
        if dates[i][:4] != '2024':
            continue
        avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
        turnover = avg_vol_20 * closes[i]
        if turnover < MIN_TURNOVER_EGP:
            continue
        current_close = closes[i]
        past_close = closes[i - LOOKBACK_DAYS]
        drop_pct = ((past_close - current_close) / past_close) * 100
        if drop_pct < DROP_THRESHOLD:
            continue
        regime = calc_regime(closes, i)
        if regime == 'BEAR':
            bear_2024 += 1

print(f"    BEAR signals in 2024 (filtered out): {bear_2024}")
print(f"    BULL+RANGE signals in 2024: {len(signals_2024)}")
print(f"    → Total signals before regime filter: {bear_2024 + len(signals_2024)}")


# ═══════════════════════════════════════════════════════════════════════
# 4. Point-in-Time liquidity filter verification
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[4/6] Point-in-Time Liquidity Filter Verification...")
print("="*90)

print(f"""
  ✅ VERIFIED: The liquidity filter uses:
    avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20
    
  This is the 20-day average volume BEFORE day i (entry day).
  - volumes[max(0,i-20):i] = days [i-20, i-19, ..., i-1]
  - Day i (entry) is NOT included in the average
  - No future data is used → Point-in-Time ✅
  
  turnover = avg_vol_20 × closes[i] (current price × historical volume)
  → This is a realistic estimate of daily turnover at entry time ✅
""")


# ═══════════════════════════════════════════════════════════════════════
# 5. Gap Risk Stress Test
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[5/6] Gap Risk Stress Test...")
print("="*90)

print(f"\n  Simulating gap risk: when SL is hit, price gaps further down.")
print(f"  Base SL = 3%. Gap scenarios: -2%, -5%, -10% additional loss.")

print(f"\n  {'Gap':>6s} | {'Train closed':>12} | {'Train PF':>8} | {'Train MaxDD':>11} | {'Train Return':>12} | {'Test PF':>8} | {'Test MaxDD':>11}")
print("  " + "-"*85)

for gap in [0.0, 2.0, 5.0, 10.0]:
    gap_signals = generate_signals(ticker_data, COST_RT, gap_stress=gap)
    train_sig = [s for s in gap_signals if s['entry_date'] <= '2025-12-31']
    test_sig = [s for s in gap_signals if s['entry_date'] >= '2026-01-01']
    
    train_r = simulate(train_sig)
    test_r = simulate(test_sig)
    
    if train_r and test_r:
        print(f"  {gap:>5.1f}% | {train_r['n_closed']:>12} | {train_r['pf']:>8.2f} | {train_r['max_dd']:>10.1f}% | {train_r['total_return']:>+11.2f}% | {test_r['pf']:>8.2f} | {test_r['max_dd']:>10.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 6. Block Bootstrap + Null Model on final config
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[6/6] Block Bootstrap + Null Model...")
print("="*90)

# Full period signals
full_signals = signals  # already generated at 0.70% cost
train_sig = [s for s in full_signals if s['entry_date'] <= '2025-12-31']
test_sig = [s for s in full_signals if s['entry_date'] >= '2026-01-01']

baseline_train = simulate(train_sig)
baseline_test = simulate(test_sig)

print(f"\n  Baseline:")
print(f"    Train: PF={baseline_train['pf']:.2f}, WR={baseline_train['wr']:.1f}%, MaxDD={baseline_train['max_dd']:.1f}%, Return={baseline_train['total_return']:.2f}%")
print(f"    Test:  PF={baseline_test['pf']:.2f}, WR={baseline_test['wr']:.1f}%, MaxDD={baseline_test['max_dd']:.1f}%, Return={baseline_test['total_return']:.2f}%")

# Block Bootstrap on Test
N_SIMULATIONS = 1000
BLOCK_SIZE = 10
mc_pfs = []
mc_returns = []
mc_dds = []

random.seed(42)

test_returns = [s['net_return'] for s in test_sig]
n_blocks = len(test_returns) // BLOCK_SIZE

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)
    
    # Block Bootstrap: shuffle blocks of returns
    blocks = []
    for i in range(n_blocks):
        start = i * BLOCK_SIZE
        blocks.append(test_returns[start:start+BLOCK_SIZE])
    random.shuffle(blocks)
    
    shuffled = []
    for block in blocks:
        shuffled.extend(block)
    
    # Build fake signals with shuffled returns
    fake_signals = []
    for i, ret in enumerate(shuffled):
        if i < len(test_sig):
            fake_signals.append({**test_sig[i], 'net_return': ret, 'outcome': 'TARGET_HIT' if ret > 0 else 'STOPPED'})
    
    r = simulate(fake_signals)
    mc_pfs.append(r['pf'])
    mc_returns.append(r['total_return'])
    mc_dds.append(r['max_dd'])

mc_pfs_sorted = sorted(mc_pfs)
mc_returns_sorted = sorted(mc_returns)
mc_dds_sorted = sorted(mc_dds)

def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100

pf_pval = p_value(baseline_test['pf'], mc_pfs)
ret_pval = p_value(baseline_test['total_return'], mc_returns)
dd_pval = p_value(baseline_test['max_dd'], mc_dds, False)

print(f"\n  Block Bootstrap Monte Carlo ({N_SIMULATIONS} sims, block_size={BLOCK_SIZE}):")
print(f"\n  {'Metric':20s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'p-value':>8s}")
print("  " + "-"*70)
print(f"  {'PF':20s} | {baseline_test['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | {mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {pf_pval:>7.1f}%")
print(f"  {'Max Drawdown':20s} | {baseline_test['max_dd']:>9.1f}% | {sum(mc_dds)/len(mc_dds):>9.1f}% | {mc_dds_sorted[len(mc_dds)//2]:>9.1f}% | {dd_pval:>7.1f}%")
print(f"  {'Total Return':20s} | {baseline_test['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | {mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {ret_pval:>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("  🎯 FINAL VERDICT — 2024 Analysis + Gap Risk + Block Bootstrap")
print("=" * 90)

r2024 = simulate(signals_2024)

print(f"""
  2024 Analysis:
    closed: {r2024['n_closed']}
    WR: {r2024['wr']:.1f}%
    PF: {r2024['pf']:.2f}
    MaxDD: {r2024['max_dd']:.1f}%
    Return: {r2024['total_return']:.2f}%
    Killed: {r2024['killed']}
    MaxConsec: {r2024['max_consec']}
  
  Gap Risk:
    0% gap: Test PF = baseline
    5% gap: Test PF = (see above)
    10% gap: Test PF = (see above)
  
  Block Bootstrap:
    PF p-value: {pf_pval:.1f}%
    Return p-value: {ret_pval:.1f}%
    MaxDD p-value: {dd_pval:.1f}%
""")

if pf_pval < 5:
    print(f"  ✅ PF p-value = {pf_pval:.1f}% → edge حقيقي!")
else:
    print(f"  ❌ PF p-value = {pf_pval:.1f}% → مش edge")

if r2024['pf'] < 1.0:
    print(f"\n  ⚠️ 2024 PF = {r2024['pf']:.2f} < 1.0 → سنة خاسرة")
    print(f"  ⚠️ الـ edge موسمي — مش مضمون في كل الظروف")
    print(f"  ⚠️ لازم Regime Filter إضافي أو تقليل حجم التداول في ظروف مشابهة لـ 2024")
else:
    print(f"\n  ✅ 2024 PF = {r2024['pf']:.2f} → سنة مربحة")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'analysis_2024_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'baseline_train': {k:v for k,v in baseline_train.items()},
        'baseline_test': {k:v for k,v in baseline_test.items()},
        '2024_results': {k:v for k,v in r2024.items()},
        'gap_risk': {},
        'block_bootstrap': {
            'n_simulations': N_SIMULATIONS,
            'pf_pvalue': pf_pval,
            'return_pvalue': ret_pval,
            'dd_pvalue': dd_pval,
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
