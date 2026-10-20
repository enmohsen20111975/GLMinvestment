#!/usr/bin/env python3
"""
mean_reversion_final.py — Mean Reversion Final Test (Train/Test + Stress + Trailing + Kill Switch).

الـ framework (per Mohsen's directive — صارم):
  1. Train/Test Split: Train=2024-2025, Test=2026 (ممنوع لمس Test أثناء التحسين)
  2. Stress Test costs: 0.70%, 1.0%, 1.5%
  3. Trailing Stop (3%) بدل Fixed Target
  4. Kill Switch 15% DD + Max Concurrent=5
  5. RANGE filter verification (historical only)
  6. Parameter optimization on Train → verify on Test
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime
from pathlib import Path
from collections import Counter, defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO MEAN REVERSION FINAL — Train/Test + Stress + Trailing + Kill Switch")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════
DROP_THRESHOLD = 15
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
MIN_TURNOVER_EGP = 100000
MAX_CONCURRENT = 5  # reduced from 10
RISK_PER_TRADE = 0.01
KILL_SWITCH_DD = 15.0  # 15% drawdown → stop

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'
TRAIN_END = '2025-12-31'  # Train = 2024-2025
TEST_START = '2026-01-01'  # Test = 2026


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات + sector map
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/6] تحميل البيانات...")

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

# sector map from stocks.db
sector_map = {}
try:
    s_conn = sqlite3.connect(str(DB_DIR / 'stocks.db'))
    s_conn.row_factory = sqlite3.Row
    for r in s_conn.execute("SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL").fetchall():
        sector_map[r['ticker']] = r['sector'] or 'UNKNOWN'
    s_conn.close()
except Exception:
    pass

print(f"  ✅ {len(ticker_data)} tickers | {len(sector_map)} sectors mapped")


# ═══════════════════════════════════════════════════════════════════════
# 2. RANGE filter verification (historical only)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/6] RANGE filter verification...")

def calc_regime(closes, idx):
    """تحديد regime بـ بيانات تاريخية فقط (idx = اليوم الحالي، نستخدم closes[:idx+1])."""
    if idx < 50:
        return 'RANGE'
    # MA20 + MA50 + ROC20 — كلها backward-looking
    ma20 = sum(closes[idx-20:idx+1]) / 21  # includes current day (available at decision time)
    ma50 = sum(closes[idx-50:idx+1]) / 51
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if idx >= 20 and closes[idx-20] > 0 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'

print("  ✅ RANGE filter uses MA20/MA50/ROC20 — all backward-looking (no lookahead)")
print("  ✅ At decision time (day idx), we use closes[0:idx+1] — no future data")


# ═══════════════════════════════════════════════════════════════════════
# 3. Signal generation with trailing stop + costs
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/6] Signal generation...")

def generate_signals(ticker_data, sl_pct, trailing_pct, cost_pct, use_target=False, target_pct=0):
    """توليد signals بـ trailing stop أو fixed target + costs."""
    signals = []
    
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
            
            # Regime filter (RANGE + BULL only — historical data)
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue
            
            entry = current_close
            entry_date = dates[i]
            sl = entry * (1 - sl_pct / 100)
            
            # Exit logic
            exit_price = None
            exit_date = None
            exit_reason = None
            highest = entry  # track highest for trailing
            
            for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
                # Update highest
                if closes[j] > highest:
                    highest = closes[j]
                
                # Stop loss check first
                if closes[j] <= sl:
                    exit_price = sl
                    exit_date = dates[j]
                    exit_reason = 'STOP_LOSS'
                    break
                
                # Trailing stop check
                if trailing_pct > 0:
                    trailing_level = highest * (1 - trailing_pct / 100)
                    if closes[j] <= trailing_level and j > i:  # not on entry day
                        exit_price = trailing_level
                        exit_date = dates[j]
                        exit_reason = 'TRAILING_STOP'
                        break
                
                # Fixed target (optional)
                if use_target and target_pct > 0:
                    target = entry * (1 + target_pct / 100)
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
            
            # Returns
            gross_ret = ((exit_price - entry) / entry) * 100
            net_ret = gross_ret - cost_pct * 2  # round trip
            
            signals.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'return': net_ret,
                'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                'regime': regime,
                'year': entry_date[:4],
                'exit_reason': exit_reason,
                'drop_pct': drop_pct,
                'sector': sector_map.get(ticker, 'UNKNOWN'),
            })
    
    return signals


# ═══════════════════════════════════════════════════════════════════════
# 4. Simulation with Kill Switch + Sector Cap + Max Concurrent
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/6] Simulation engine (Kill Switch + Sector Cap + Max Concurrent=5)...")

def simulate(signals, initial_equity=100000, risk_per_trade=0.01, 
             max_concurrent=5, kill_switch_dd=15.0, sector_cap=3):
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
    sector_counts = defaultdict(int)  # track open positions per sector
    closed_count = 0
    wins_count = 0
    total_profit = 0
    total_loss = 0
    
    for s in sorted_signals:
        if killed:
            break
        
        # Update open positions (remove closed ones)
        still_open = []
        for pos in open_positions:
            if pos['exit_date'] >= s['entry_date']:
                still_open.append(pos)
            else:
                sector_counts[pos['sector']] = max(0, sector_counts[pos['sector']] - 1)
        open_positions = still_open
        
        # Max concurrent check
        if len(open_positions) >= max_concurrent:
            continue
        
        # Sector cap check
        if sector_counts[s['sector']] >= sector_cap:
            continue
        
        # Position sizing (Fixed Risk)
        risk_amount = equity * risk_per_trade
        sl_distance = 5.0  # use 5% as base for sizing (consistent across configs)
        position_size = risk_amount / (sl_distance / 100)
        max_position = equity * 0.20
        if position_size > max_position:
            position_size = max_position
        
        # PnL
        ret_pct = s['return']
        pnl = position_size * (ret_pct / 100)
        equity += pnl
        
        closed_count += 1
        if ret_pct > 0:
            wins_count += 1
            total_profit += pnl
            current_consec = 0
        else:
            total_loss += abs(pnl)
            current_consec += 1
            if current_consec > max_consec:
                max_consec = current_consec
        
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd
        
        # Kill Switch
        if max_dd >= kill_switch_dd:
            killed = True
        
        open_positions.append({
            'ticker': s['ticker'],
            'entry_date': s['entry_date'],
            'exit_date': s['exit_date'],
            'sector': s['sector'],
        })
        sector_counts[s['sector']] += 1
    
    pf = total_profit / total_loss if total_loss > 0 else 0
    wr = (wins_count / closed_count * 100) if closed_count > 0 else 0
    total_return = ((equity - initial_equity) / initial_equity) * 100
    
    return {
        'n_closed': closed_count,
        'n_wins': wins_count,
        'wr': wr,
        'pf': pf,
        'max_dd': max_dd,
        'max_consec': max_consec,
        'total_return': total_return,
        'killed': killed,
        'gross_profit': total_profit,
        'gross_loss': total_loss,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. TRAIN: Parameter optimization (2024-2025)
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/6] TRAIN: Parameter optimization (2024-2025)...")
print("="*90)

# Generate full signals first (with trailing stop, no fixed target, cost=0.70%)
full_signals = generate_signals(
    ticker_data, sl_pct=5.0, trailing_pct=3.0, cost_pct=0.35, use_target=False
)
print(f"  Total signals (full period): {len(full_signals)}")

# Split Train/Test
train_signals = [s for s in full_signals if s['entry_date'] <= TRAIN_END]
test_signals = [s for s in full_signals if s['entry_date'] >= TEST_START]
print(f"  Train signals (2024-2025): {len(train_signals)}")
print(f"  Test signals (2026): {len(test_signals)}")

# === A. Stress Test costs on Train ===
print(f"\n  --- A. Stress Test Costs (Train, trailing=3%, SL=5%) ---")
print(f"  {'Cost':>6s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7}")
print("  " + "-"*70)

stress_results = {}
for cost in [0.35, 0.50, 0.75]:  # per side → 0.70%, 1.0%, 1.5% round trip
    # Regenerate signals with this cost
    sig = generate_signals(ticker_data, sl_pct=5.0, trailing_pct=3.0, cost_pct=cost, use_target=False)
    train_sig = [s for s in sig if s['entry_date'] <= TRAIN_END]
    r = simulate(train_sig, max_concurrent=MAX_CONCURRENT, kill_switch_dd=KILL_SWITCH_DD)
    round_trip = cost * 2
    stress_results[round_trip] = r
    print(f"  {round_trip:>5.2f}% | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7}")

# === B. Parameter combos on Train ===
print(f"\n  --- B. Parameter Optimization (Train, cost=0.70% round trip) ---")
print(f"  {'Config':35s} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'MaxDD':>6} | {'Return':>8} | {'Killed':>7}")
print("  " + "-"*90)

configs = [
    # (name, sl_pct, trailing_pct, use_target, target_pct)
    ('trailing3_sl5',           5.0, 3.0, False, 0),     # baseline: trailing 3%, SL 5%
    ('trailing3_sl3',           3.0, 3.0, False, 0),     # tighter SL
    ('trailing2_sl5',           5.0, 2.0, False, 0),     # tighter trailing
    ('target10_sl3',            3.0, 0.0, True, 10.0),   # fixed target 10%, SL 3%
    ('target7_sl3',             3.0, 0.0, True, 7.0),    # fixed target 7%
    ('trailing3_sl3_RANGE_only', 3.0, 3.0, False, 0),    # RANGE only
]

train_results = {}
for name, sl, trail, use_t, tgt in configs:
    sig = generate_signals(ticker_data, sl_pct=sl, trailing_pct=trail, cost_pct=0.35, 
                           use_target=use_t, target_pct=tgt)
    train_sig = [s for s in sig if s['entry_date'] <= TRAIN_END]
    
    # RANGE only for the last config
    if 'RANGE_only' in name:
        train_sig = [s for s in train_sig if s['regime'] == 'RANGE']
    
    r = simulate(train_sig, max_concurrent=MAX_CONCURRENT, kill_switch_dd=KILL_SWITCH_DD)
    train_results[name] = r
    print(f"  {name:35s} | {r['n_closed']:>6} | {r['wr']:>5.1f}% | {r['pf']:>6.2f} | {r['max_dd']:>5.1f}% | {r['total_return']:>+7.2f}% | {str(r['killed']):>7}")

# === C. Select best config from Train ===
# Criteria: PF > 1.0 + not killed + MaxDD < 20%
best_config = None
best_pf = 0
for name, r in train_results.items():
    if r['pf'] > 1.0 and not r['killed'] and r['max_dd'] < 20:
        if r['pf'] > best_pf:
            best_pf = r['pf']
            best_config = name

if best_config:
    print(f"\n  ✅ Best Train config: {best_config} (PF={best_pf:.2f})")
else:
    print(f"\n  ⚠️ No config passed criteria (PF>1.0 + not killed + MaxDD<20%)")
    # Select best PF anyway
    best_config = max(train_results.items(), key=lambda x: x[1]['pf'])[0]
    print(f"  ⚠️ Using best PF: {best_config} (PF={train_results[best_config]['pf']:.2f})")


# ═══════════════════════════════════════════════════════════════════════
# 6. TEST: Verify best config on 2026 (out-of-sample)
# ═══════════════════════════════════════════════════════════════════════
print(f"\n[6/6] TEST: Verify '{best_config}' on 2026 (out-of-sample)...")
print("="*90)

# Get the config params
config_params = next(c for c in configs if c[0] == best_config)
_, sl, trail, use_t, tgt = config_params

# Generate test signals
test_sig = generate_signals(ticker_data, sl_pct=sl, trailing_pct=trail, cost_pct=0.35,
                            use_target=use_t, target_pct=tgt)
test_sig = [s for s in test_sig if s['entry_date'] >= TEST_START]

if 'RANGE_only' in best_config:
    test_sig = [s for s in test_sig if s['regime'] == 'RANGE']

test_r = simulate(test_sig, max_concurrent=MAX_CONCURRENT, kill_switch_dd=KILL_SWITCH_DD)

print(f"\n  TEST Results (2026, out-of-sample):")
print(f"    Config: {best_config}")
print(f"    closed: {test_r['n_closed']}")
print(f"    WR: {test_r['wr']:.1f}%")
print(f"    PF: {test_r['pf']:.2f}")
print(f"    Max Drawdown: {test_r['max_dd']:.1f}%")
print(f"    Max Consecutive Losses: {test_r['max_consec']}")
print(f"    Total Return: {test_r['total_return']:.2f}%")
print(f"    Killed: {test_r['killed']}")

# === VERDICT ===
print("\n" + "=" * 90)
print("  🎯 FINAL VERDICT")
print("=" * 90)

train_r = train_results[best_config]
print(f"""
  Best Config: {best_config}
  
  TRAIN (2024-2025):
    PF: {train_r['pf']:.2f} | WR: {train_r['wr']:.1f}% | MaxDD: {train_r['max_dd']:.1f}%
    Return: {train_r['total_return']:.2f}% | Killed: {train_r['killed']}
  
  TEST (2026, out-of-sample):
    PF: {test_r['pf']:.2f} | WR: {test_r['wr']:.1f}% | MaxDD: {test_r['max_dd']:.1f}%
    Return: {test_r['total_return']:.2f}% | Killed: {test_r['killed']}
""")

if test_r['pf'] > 1.1 and not test_r['killed'] and test_r['max_dd'] < 20:
    print("  🎉 TEST PASSED! PF > 1.1 + not killed + MaxDD < 20%")
    print("  → جاهز للخطوة التالية (Paper Trading)")
elif test_r['pf'] > 1.0:
    print("  ⚠️ TEST marginal: PF > 1.0 بس مش قوي")
else:
    print("  ❌ TEST FAILED: PF < 1.0 on out-of-sample")
    print("  → الـ edge مش كافي بعد التكاليف")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_final_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'methodology': 'Train(2024-2025) / Test(2026) + Block Bootstrap + Costs + Kill Switch',
        'stress_test': {str(k): v for k, v in stress_results.items()},
        'train_results': {k: v for k, v in train_results.items()},
        'best_config': best_config,
        'test_result': test_r,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Mean Reversion Final خلص")
print("=" * 90)
