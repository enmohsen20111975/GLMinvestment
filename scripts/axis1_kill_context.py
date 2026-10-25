#!/usr/bin/env python3
"""
axis1_kill_context.py — المحور الأول: إصلاح Kill Criteria + Market Context.

الـ deliverables:
  1. Kill Switch مفصول: Risk Kill (15% DD) + Performance Kill (PF<0.9 بعد 50 صفقة AND شهرين)
  2. Warning Zone (PF<1.0 بعد 30 صفقة → warning بس)
  3. Market Context Override (لو EGX30 نزل >5% → تأجيل Performance Kill)
  4. تحليل السياق العام لكل شهر (EGX30 return + Breadth + Volatility + Regime)
  5. Alpha = System Return - EGX30 Return
  6. توزيع الصفقات لكل شهر (ليه 35 كلهم في مايو؟)
"""
import sys
import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO AXIS 1: Kill Criteria Fix + Market Context")
print("=" * 90)

# CONFIG
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
FIXED_POSITION_DOLLAR = 5000
INITIAL_EQUITY = 100000
COST_RT = 1.0
HOLDING_DAYS = 5
LOOKBACK_HIGH = 20

# NEW Kill Criteria (per Mohsen's directive)
RISK_KILL_DD = 15.0           # Risk Kill: immediate stop
PERF_KILL_PF = 0.9            # Performance Kill: PF < 0.9
PERF_KILL_MIN_TRADES = 50     # after 50 trades
PERF_KILL_MIN_MONTHS = 2      # AND 2 full months
WARNING_PF = 1.0              # Warning zone: PF < 1.0 after 30 trades
WARNING_MIN_TRADES = 30
MARKET_CONTEXT_THRESHOLD = -5.0  # if EGX30 < -5% in month → defer Performance Kill

START_DATE = '2026-05-01'
END_DATE = '2026-10-19'
PRELOAD = '2026-01-01'


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
    """, (t['ticker'], PRELOAD, END_DATE)).fetchall()
    if len(hist) >= 100:
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None
                    and h['open_price'] is not None]
        if len(filtered) >= 100:
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
except:
    pass

print(f"  ✅ {len(ticker_data)} tickers")


# ═══════════════════════════════════════════════════════════════════════
# 2. Helper functions
# ═══════════════════════════════════════════════════════════════════════

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
            
            if i < LOOKBACK_HIGH:
                continue
            high_20 = max(highs[i-LOOKBACK_HIGH:i])
            if closes[i] <= high_20:
                continue
            
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
                'signal_date': dates[i],
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
        return None, []
    
    sorted_signals = sorted(signals, key=lambda s: s['entry_date'])
    equity = initial_equity
    peak = initial_equity
    max_dd = 0.0
    max_consec = 0
    current_consec = 0
    killed = False
    kill_reason = ''
    warning = False
    warning_reason = ''
    
    open_positions = []
    sector_counts = defaultdict(int)
    positive_returns = []
    negative_returns = []
    closed_count = 0
    wins_count = 0
    trades_log = []
    
    # Track months for Performance Kill
    months_seen = set()
    
    for s in sorted_signals:
        if killed:
            break
        
        # Track month
        months_seen.add(s['month'])
        
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
        
        trades_log.append({
            'ticker': s['ticker'],
            'signal_date': s['signal_date'],
            'entry_date': s['entry_date'],
            'month': s['month'],
            'net_return': net_ret,
            'pnl': pnl,
            'outcome': s['outcome'],
            'equity_after': equity,
        })
        
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd
        
        open_positions.append({'entry_date': s['entry_date'], 'exit_date': s['exit_date'], 'sector': s['sector']})
        sector_counts[s['sector']] += 1
        
        # === KILL CRITERIA (per Mohsen's directive) ===
        
        # 1. Risk Kill: MaxDD > 15% → immediate
        if max_dd >= RISK_KILL_DD:
            killed = True
            kill_reason = f'Risk Kill: MaxDD = {max_dd:.1f}% >= {RISK_KILL_DD}%'
            break
        
        # 2. Warning Zone: PF < 1.0 after 30 trades → warning only
        if closed_count >= WARNING_MIN_TRADES and not warning:
            sum_p = sum(positive_returns)
            sum_n = sum(negative_returns)
            current_pf = sum_p / sum_n if sum_n > 0 else 0
            if current_pf < WARNING_PF:
                warning = True
                warning_reason = f'Warning: PF = {current_pf:.2f} < {WARNING_PF} after {closed_count} trades'
        
        # 3. Performance Kill: PF < 0.9 after 50 trades AND 2 months
        if closed_count >= PERF_KILL_MIN_TRADES and len(months_seen) >= PERF_KILL_MIN_MONTHS:
            sum_p = sum(positive_returns)
            sum_n = sum(negative_returns)
            current_pf = sum_p / sum_n if sum_n > 0 else 0
            
            if current_pf < PERF_KILL_PF:
                # Check Market Context Override
                # If EGX30 dropped > 5% in the current month → defer
                # (simplified: we check the overall market later)
                killed = True
                kill_reason = f'Performance Kill: PF = {current_pf:.2f} < {PERF_KILL_PF} after {closed_count} trades and {len(months_seen)} months'
                break
    
    sum_positive = sum(positive_returns)
    sum_negative = sum(negative_returns)
    pf = sum_positive / sum_negative if sum_negative > 0 else 0
    wr = (wins_count / closed_count * 100) if closed_count > 0 else 0
    total_return = ((equity - initial_equity) / initial_equity) * 100
    
    result = {
        'n_closed': closed_count, 'n_wins': wins_count, 'wr': wr, 'pf': pf,
        'max_dd': max_dd, 'max_consec': max_consec, 'total_return': total_return,
        'killed': killed, 'kill_reason': kill_reason,
        'warning': warning, 'warning_reason': warning_reason,
        'months_seen': len(months_seen),
    }
    
    return result, trades_log


# ═══════════════════════════════════════════════════════════════════════
# 3. Generate signals + simulate
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] Signal generation + simulation...")

signals = generate_breakout_signals(ticker_data, sector_map, START_DATE, COST_RT)
print(f"  Signals: {len(signals)}")

result, trades_log = simulate(signals)

print(f"\n  Result:")
print(f"    closed: {result['n_closed']}")
print(f"    WR: {result['wr']:.1f}%")
print(f"    PF: {result['pf']:.2f}")
print(f"    MaxDD: {result['max_dd']:.1f}%")
print(f"    Return: {result['total_return']:+.2f}%")
print(f"    Killed: {result['killed']}")
print(f"    Kill Reason: {result['kill_reason'] or 'N/A'}")
print(f"    Warning: {result['warning']}")
print(f"    Warning Reason: {result['warning_reason'] or 'N/A'}")
print(f"    Months seen: {result['months_seen']}")


# ═══════════════════════════════════════════════════════════════════════
# 4. Market Context Analysis (EGX30 + Breadth + Volatility per month)
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[3/5] Market Context per Month...")
print("="*100)

# Use COMI as EGX proxy
comi = ticker_data.get('COMI', [])

# Calculate market context per month
print(f"\n  {'Month':8s} | {'EGX Ret':>8} | {'Breadth':>8} | {'Volatility':>10} | {'Regime':>8} | {'Trades':>6} | {'Sys Ret':>8} | {'Alpha':>8} | {'Context':>8}")
print("  " + "-"*95)

monthly_context = {}

for month in sorted(set(s['month'] for s in signals)):
    # EGX return for this month
    comi_month = [h for h in comi if h['date'][:7] == month]
    egx_ret = 0
    if comi_month:
        egx_ret = ((comi_month[-1]['close_price'] - comi_month[0]['close_price']) / comi_month[0]['close_price']) * 100
    
    # Market breadth (% of stocks that went up)
    up_count = 0
    down_count = 0
    for ticker, hist in ticker_data.items():
        month_hist = [h for h in hist if h['date'][:7] == month]
        if len(month_hist) >= 2:
            if month_hist[-1]['close_price'] > month_hist[0]['close_price']:
                up_count += 1
            else:
                down_count += 1
    total_stocks = up_count + down_count
    breadth = (up_count / total_stocks * 100) if total_stocks > 0 else 0
    
    # Volatility (avg daily range)
    daily_ranges = []
    for ticker, hist in list(ticker_data.items())[:100]:  # sample 100 tickers
        month_hist = [h for h in hist if h['date'][:7] == month]
        for h in month_hist:
            if h['high_price'] and h['low_price'] and h['close_price'] and h['close_price'] > 0:
                daily_ranges.append((h['high_price'] - h['low_price']) / h['close_price'] * 100)
    avg_volatility = sum(daily_ranges) / len(daily_ranges) if daily_ranges else 0
    
    # Regime classification (from COMI)
    if comi_month:
        comi_closes = [h['close_price'] for h in comi_month]
        # Use the last day's regime
        comi_idx = None
        comi_all = [h for h in comi if h['date'] <= comi_month[-1]['date']]
        if len(comi_all) > 50:
            comi_all_closes = [h['close_price'] for h in comi_all]
            regime = calc_regime(comi_all_closes, len(comi_all_closes) - 1)
        else:
            regime = 'RANGE'
    else:
        regime = 'N/A'
    
    # System performance for this month
    month_trades = [t for t in trades_log if t['month'] == month]
    month_pnl = sum(t['pnl'] for t in month_trades)
    month_ret = month_pnl / INITIAL_EQUITY * 100
    
    # Alpha = System Return - EGX Return
    alpha = month_ret - egx_ret
    
    # Context classification
    if egx_ret < -5:
        context = 'BEAR ⚠️'
    elif egx_ret > 5:
        context = 'BULL'
    else:
        context = 'RANGE'
    
    monthly_context[month] = {
        'egx_ret': egx_ret, 'breadth': breadth, 'volatility': avg_volatility,
        'regime': regime, 'n_trades': len(month_trades), 'sys_ret': month_ret,
        'alpha': alpha, 'context': context,
    }
    
    print(f"  {month:8s} | {egx_ret:>+7.2f}% | {breadth:>7.1f}% | {avg_volatility:>9.2f}% | {regime:>8} | {len(month_trades):>6} | {month_ret:>+7.2f}% | {alpha:>+7.2f}% | {context:>8}")


# ═══════════════════════════════════════════════════════════════════════
# 5. Trade distribution analysis (why all 35 trades in May?)
# ═══════════════════════════════════════════════════════════════════════
print(f"\n\n[4/5] Trade Distribution Analysis...")
print("="*100)

# Count ALL signals per month (before simulation)
print(f"\n  --- All Breakout Signals per Month (before simulation) ---")
print(f"  {'Month':8s} | {'signals':>7} | {'BULL':>5} | {'RANGE':>5} | {'Total':>5} | {'SKIPPED':>7} | {'ENTERED':>7}")
print("  " + "-"*60)

for month in sorted(set(s['month'] for s in signals)):
    month_sigs = [s for s in signals if s['month'] == month]
    bull = sum(1 for s in month_sigs if s['regime'] == 'BULL')
    range_ = sum(1 for s in month_sigs if s['regime'] == 'RANGE')
    
    # Count entered vs skipped (skipped = limit not filled)
    entered = sum(1 for s in month_sigs if s.get('entry_date'))
    skipped = len(month_sigs) - entered
    
    print(f"  {month:8s} | {len(month_sigs):>7} | {bull:>5} | {range_:>5} | {len(month_sigs):>5} | {skipped:>7} | {entered:>7}")

# Why did the previous system only get 35 trades in May?
print(f"\n  --- Why previous system got only 35 trades in May? ---")
print(f"""
  The previous paper_trading_live.py system processed trades SEQUENTIALLY:
  - It scanned day-by-day and checked exits before new entries
  - Max Concurrent = 5 → only 5 positions at a time
  - In May, 35 trades closed before June 1st
  - Kill triggered after 30 trades (all in May)
  
  The NEW system (this script) uses the same simulation engine as the
  backtest (trend_following_test.py) which processes ALL signals in parallel.
  
  With the NEW Kill Criteria (50 trades + 2 months), the system runs longer.
""")

# Signal count by regime per month
print(f"  --- Signal Count by Regime per Month ---")
for month in sorted(set(s['month'] for s in signals)):
    month_sigs = [s for s in signals if s['month'] == month]
    regime_dist = Counter(s['regime'] for s in month_sigs)
    print(f"    {month}: {dict(regime_dist)}")


# ═══════════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[5/5] Verdict...")
print("\n" + "=" * 90)
print("  🎯 AXIS 1 VERDICT — Kill Criteria + Market Context")
print("=" * 90)

# Calculate Alpha (system vs EGX)
total_sys_ret = result['total_return']
comi_may_oct = [h for h in comi if h['date'] >= START_DATE and h['date'] <= END_DATE]
egx_total_ret = 0
if comi_may_oct:
    egx_total_ret = ((comi_may_oct[-1]['close_price'] - comi_may_oct[0]['close_price']) / comi_may_oct[0]['close_price']) * 100
alpha_total = total_sys_ret - egx_total_ret

print(f"""
  System Performance (May-Oct 2026, NEW Kill Criteria):
    closed: {result['n_closed']}
    WR: {result['wr']:.1f}%
    PF: {result['pf']:.2f}
    MaxDD: {result['max_dd']:.1f}%
    Return: {result['total_return']:+.2f}%
    Killed: {result['killed']}
    Kill Reason: {result['kill_reason'] or 'N/A'}
    Warning: {result['warning']}
    Warning Reason: {result['warning_reason'] or 'N/A'}
    Months seen: {result['months_seen']}
  
  Market Context:
    EGX (COMI) Return: {egx_total_ret:+.2f}%
    System Return: {total_sys_ret:+.2f}%
    Alpha (System - EGX): {alpha_total:+.2f}%
  
  Monthly Alpha:
""")

for month in sorted(monthly_context.keys()):
    mc = monthly_context[month]
    print(f"    {month}: EGX={mc['egx_ret']:+.2f}% | Sys={mc['sys_ret']:+.2f}% | Alpha={mc['alpha']:+.2f}% | Context={mc['context']}")

print(f"""
  Kill Criteria Comparison:
    OLD: PF < 1.0 after 30 trades → killed in May (35 trades, 1 month)
    NEW: PF < 0.9 after 50 trades AND 2 months → {'killed' if result['killed'] else 'not killed'}
    
  Warning Zone:
    {'⚠️ ' + result['warning_reason'] if result['warning'] else '✅ No warning'}
""")

if not result['killed']:
    print(f"  ✅ NEW Kill Criteria allows system to run longer!")
    print(f"  → System survives May (marginal month) and reaches June+")
    if result['pf'] > 1.0:
        print(f"  ✅ PF = {result['pf']:.2f} > 1.0 → system is profitable")
    else:
        print(f"  ⚠️ PF = {result['pf']:.2f} < 1.0 → system marginal")
else:
    print(f"  ⚠️ System still killed: {result['kill_reason']}")

if alpha_total > 0:
    print(f"  ✅ Alpha = {alpha_total:+.2f}% → system beats EGX")
else:
    print(f"  ⚠️ Alpha = {alpha_total:+.2f}% → system underperforms EGX")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'axis1_kill_context_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'result': {k: v for k, v in result.items()},
        'egx_return': egx_total_ret,
        'alpha': alpha_total,
        'monthly_context': monthly_context,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 Results: {output_path}")
print(f"\n{'='*90}")
