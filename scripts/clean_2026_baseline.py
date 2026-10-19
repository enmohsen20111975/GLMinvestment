#!/usr/bin/env python3
"""
clean_2026_baseline.py — Baseline على 6 شهور نظيفة (مايو-أكتوبر 2026).

الـ framework:
  1. إلغاء 2024 + 2025 تماماً (بيانات مضللة)
  2. Baseline: Realistic Limit Order + drop 15% (no filters)
  3. Train: مايو-يوليو 2026 (3 شهور)
  4. Test: أغسطس-أكتوبر 2026 (3 شهور)
  5. لو PF > 1.5 → ممنوع نضيف فلاتر
  6. لو PF < 1.3 → نجرب فلتر واحد بس
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
print("  🧪 BRAVO CLEAN 2026 BASELINE — مايو-أكتوبر 2026 فقط")
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
COST_RT = 1.0

# الفترة النظيفة فقط
START_DATE = '2026-05-01'
END_DATE = '2026-10-31'
TRAIN_END = '2026-07-31'   # Train: مايو-يوليو
TEST_START = '2026-08-01'  # Test: أغسطس-أكتوبر


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات (2026 فقط)
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل البيانات (مايو-أكتوبر 2026)...")

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

# نحتاج بيانات قبل مايو 2026 عشان نحسب MA50 + drop 5 days
# فنجيب من 2026-01-01 (عشان lookahead window) بس الفلتر هيدخل من مايو
PRELOAD_START = '2026-01-01'

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

print(f"  ✅ {len(ticker_data)} tickers loaded")


# ═══════════════════════════════════════════════════════════════════════
# 2. Signal generation (Realistic Limit Order, entry only from May 2026)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] Signal generation (Realistic Limit, entries from May 2026)...")

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


def generate_signals(ticker_data, cost_rt=1.0, rsi_filter=None):
    """
    Realistic Limit Order signals.
    Entry only from START_DATE (May 2026).
    Optional RSI filter: rsi_filter=<threshold> (e.g. 30 → only enter if RSI < 30)
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
            # Only generate signals from May 2026
            if dates[i] < START_DATE:
                continue
            
            # Liquidity filter
            avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < MIN_TURNOVER_EGP:
                continue
            
            # Drop signal
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - closes[i]) / past_close) * 100
            if drop_pct < DROP_THRESHOLD:
                continue
            
            # Regime filter
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            # Optional RSI filter
            if rsi_filter is not None:
                rsi = calc_rsi(closes[:i+1], 14)
                if rsi is None or rsi >= rsi_filter:
                    continue
            
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
            
            # Determine month for Train/Test split
            month = entry_date[:7]  # YYYY-MM
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'net_return': net_ret,
                'gross_return': gross_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'regime': regime,
                'month': month,
                'exit_reason': exit_reason,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
            })
    
    return signals


def calc_rsi(closes, period=14):
    """Simple RSI calculation."""
    if len(closes) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, period + 1):
        change = closes[-i] - closes[-i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


# Generate baseline signals
signals = generate_signals(ticker_data, cost_rt=COST_RT)
print(f"  ✅ {len(signals)} signals (May-Oct 2026)")


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
# 4. Results
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] Results...")
print("="*90)

# Split Train/Test
train_sig = [s for s in signals if s['entry_date'] <= TRAIN_END]
test_sig = [s for s in signals if s['entry_date'] >= TEST_START]
full_r = simulate(signals)
train_r = simulate(train_sig)
test_r = simulate(test_sig)

print(f"\n  Period: {START_DATE} → {END_DATE}")
print(f"  Train: May-Jul 2026 ({len(train_sig)} signals)")
print(f"  Test:  Aug-Oct 2026 ({len(test_sig)} signals)")

print(f"\n  {'Period':12s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7} | {'avgWin':>7} | {'avgLoss':>7} | {'R/R':>5}")
print("  " + "-"*100)

for name, r in [('Full (May-Oct)', full_r), ('Train (May-Jul)', train_r), ('Test (Aug-Oct)', test_r)]:
    if r:
        rr = r['avg_win'] / r['avg_loss'] if r['avg_loss'] > 0 else 0
        print(f"  {name:12s} | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7} | {r['avg_win']:>+6.2f}% | {r['avg_loss']:>+6.2f}% | {rr:>5.2f}")

# Exit reasons
print(f"\n  --- Exit Reasons ---")
from collections import Counter
for name, sigs in [('Full', signals), ('Train', train_sig), ('Test', test_sig)]:
    exits = Counter(s['exit_reason'] for s in sigs)
    total = len(sigs)
    print(f"\n  {name}:")
    for reason, cnt in exits.most_common():
        print(f"    {reason:15s}: {cnt:>4} ({cnt/total*100 if total else 0:.1f}%)")

# Per-month breakdown
print(f"\n  --- Per-Month ---")
print(f"  {'Month':8s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print("  " + "-"*45)
for month in sorted(set(s['month'] for s in signals)):
    month_sig = [s for s in signals if s['month'] == month]
    month_r = simulate(month_sig)
    if month_r:
        print(f"  {month:8s} | {month_r['n_closed']:>6} | {month_r['wr']:>5.1f}% | {month_r['pf']:>6.2f} | {month_r['total_return']:>+7.2f}%")

# VERDICT
print(f"\n{'='*90}")
print(f"  🎯 VERDICT — Clean 2026 Baseline (May-Oct)")
print(f"{'='*90}")

if full_r:
    print(f"""
  Full (May-Oct 2026):
    closed: {full_r['n_closed']}
    WR: {full_r['wr']:.1f}%
    PF: {full_r['pf']:.2f}
    MaxDD: {full_r['max_dd']:.1f}%
    Return: {full_r['total_return']:.2f}%
    Killed: {full_r['killed']}
    avg Win: {full_r['avg_win']:.2f}% | avg Loss: {full_r['avg_loss']:.2f}%
  
  Train (May-Jul):
    PF: {train_r['pf']:.2f} | WR: {train_r['wr']:.1f}% | Return: {train_r['total_return']:.2f}%
  
  Test (Aug-Oct):
    PF: {test_r['pf']:.2f} | WR: {test_r['wr']:.1f}% | Return: {test_r['total_return']:.2f}%
""")

    if full_r['pf'] > 1.5:
        print(f"  ✅ Baseline PF = {full_r['pf']:.2f} > 1.5 → ممنوع نضيف فلاتر!")
        print(f"  → النظام شغال كويس على البيانات النظيفة")
    elif full_r['pf'] > 1.3:
        print(f"  ⚠️ Baseline PF = {full_r['pf']:.2f} > 1.3 → acceptable")
        print(f"  → ممكن نضيف فلتر واحد لو محتاجين")
    elif full_r['pf'] > 1.0:
        print(f"  ⚠️ Baseline PF = {full_r['pf']:.2f} > 1.0 → marginal")
        print(f"  → محتاجين فلتر")
    else:
        print(f"  ❌ Baseline PF = {full_r['pf']:.2f} < 1.0 → خسارة")
        print(f"  → محتاجين إشارة أقوى")
    
    # Train vs Test stability
    if train_r and test_r:
        gen_ratio = test_r['pf'] / train_r['pf'] if train_r['pf'] > 0 else 0
        print(f"\n  Gen Ratio (Test/Train): {gen_ratio:.2f}")
        if 0.7 < gen_ratio < 1.3:
            print(f"  ✅ Stable (Test ≈ Train)")
        elif gen_ratio > 1.3:
            print(f"  ⚠️ Test > Train (possible luck)")
        else:
            print(f"  ⚠️ Test < Train (overfitting?)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'clean_2026_baseline_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': f'{START_DATE} → {END_DATE}',
        'full': {k:v for k,v in full_r.items()} if full_r else None,
        'train': {k:v for k,v in train_r.items()} if train_r else None,
        'test': {k:v for k,v in test_r.items()} if test_r else None,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print(f"\n{'='*90}")
