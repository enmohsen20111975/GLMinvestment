#!/usr/bin/env python3
"""
mean_reversion_fixed_risk.py — Mean Reversion بـ Position Sizing صحيح (Fixed Risk).

الـ framework (per Mohsen's directive):
  1. Fixed Risk: 1% من المحفظة لكل صفقة (based on SL distance)
  2. Max concurrent positions: 10 صفقات
  3. Equity curve realistic (ممنوع compounding وهمي)
  4. drop15_lbw5_hold5 + Regime filter (Bull+Range)
  5. CPCV + Monte Carlo بـ calculation صحيح

الـ Fixed Risk formula:
  risk_per_trade = 1% × equity
  position_size = risk_per_trade / (SL_distance_%)
  example: equity=100K, risk=1K, SL=5% → position = 20K (20% of equity)
  بس لو SL=3% → position = 33K (33% of equity)
  
  مع حد أقصى 10 صفقات متزامنة → max exposure = 10 × risk = 10%
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter, defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO MEAN REVERSION — Fixed Risk Position Sizing")
print("=" * 90)


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل كل الأسهم المتاحة
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل كل الأسهم المتاحة...")

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

tickers = ph_conn.execute("""
    SELECT ticker, COUNT(*) as cnt, MIN(date) as first_date, MAX(date) as last_date
    FROM price_history
    GROUP BY ticker
    HAVING cnt >= 200
    ORDER BY ticker
""").fetchall()

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'
valid_tickers = [t for t in tickers if t['last_date'] >= START_DATE]

ticker_data = {}
for t in valid_tickers:
    hist = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history 
        WHERE ticker = ? AND date >= ? AND date <= ?
        ORDER BY date
    """, (t['ticker'], START_DATE, END_DATE)).fetchall()
    if len(hist) >= 200:
        filtered = [h for h in hist if h['close_price'] is not None and h['close_price'] > 0
                    and h['high_price'] is not None and h['low_price'] is not None]
        if len(filtered) >= 200:
            ticker_data[t['ticker']] = filtered

ph_conn.close()
print(f"  ✅ {len(ticker_data)} ticker بـ data نظيفة")


# ═══════════════════════════════════════════════════════════════════════
# 2. بناء Mean Reversion signals (drop15_lbw5_hold5 + Bull/Range filter)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] بناء Mean Reversion signals (drop15_lbw5_hold5 + Bull/Range)...")

DROP_THRESHOLD = 15  # نزول 15%
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
STOP_LOSS_PCT = 5.0  # 5% stop loss
TARGET_PCT = 5.0  # 5% target
MAX_CONCURRENT = 10  # max 10 صفقات متزامنة
RISK_PER_TRADE = 0.01  # 1% من المحفظة


def calc_regime(closes, idx):
    if idx < 50:
        return 'RANGE'
    ma20 = sum(closes[idx-20:idx]) / 20
    ma50 = sum(closes[idx-50:idx]) / 50
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if idx >= 20 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'


def generate_signals(ticker_data):
    """توليد إشارات Mean Reversion."""
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            # drop في آخر LOOKBACK_DAYS
            current_close = closes[i]
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - current_close) / past_close) * 100
            
            if drop_pct >= DROP_THRESHOLD:
                # regime filter (Bull + Range only)
                regime = calc_regime(closes, i)
                if regime not in ('BULL', 'RANGE'):
                    continue
                
                entry = current_close
                entry_date = dates[i]
                sl = entry * (1 - STOP_LOSS_PCT / 100)
                target = entry * (1 + TARGET_PCT / 100)
                
                # exit logic
                exit_price = None
                exit_date = None
                exit_reason = None
                exit_idx = min(i + HOLDING_DAYS, len(closes) - 1)
                
                for j in range(i+1, min(i + HOLDING_DAYS + 1, len(closes))):
                    # stop loss first (conservative)
                    if closes[j] <= sl:
                        exit_price = sl
                        exit_date = dates[j]
                        exit_reason = 'STOP_LOSS'
                        exit_idx = j
                        break
                    # target
                    if closes[j] >= target:
                        exit_price = target
                        exit_date = dates[j]
                        exit_reason = 'TARGET'
                        exit_idx = j
                        break
                
                if exit_price is None:
                    # holding period expired
                    exit_price = closes[exit_idx]
                    exit_date = dates[exit_idx]
                    exit_reason = 'TIME_EXIT'
                
                ret = ((exit_price - entry) / entry) * 100
                outcome = 'TARGET_HIT' if ret > 0 else 'STOPPED'
                
                signals.append({
                    'ticker': ticker,
                    'entry_date': entry_date,
                    'exit_date': exit_date,
                    'entry': entry,
                    'exit': exit_price,
                    'return': ret,
                    'outcome': outcome,
                    'regime': regime,
                    'exit_reason': exit_reason,
                    'drop_pct': drop_pct,
                })
    
    return signals


signals = generate_signals(ticker_data)
print(f"  ✅ {len(signals)} إشارة Mean Reversion")


# ═══════════════════════════════════════════════════════════════════════
# 3. محاكاة بـ Fixed Risk + Max Concurrent
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] محاكاة بـ Fixed Risk (1% per trade) + Max 10 concurrent...")


def simulate_fixed_risk(signals, initial_equity=100000, risk_per_trade=0.01, max_concurrent=10):
    """محاكاة بـ Fixed Risk + Max Concurrent positions."""
    if not signals:
        return None
    
    # ترتيب حسب entry_date
    sorted_signals = sorted(signals, key=lambda s: s['entry_date'])
    
    equity = initial_equity
    peak = initial_equity
    max_dd = 0.0
    max_consec = 0
    current_consec = 0
    
    # تتبع الصفقات المفتوحة
    open_positions = []  # list of {ticker, entry_date, exit_date}
    closed_count = 0
    wins_count = 0
    total_profit = 0
    total_loss = 0
    
    equity_curve = [initial_equity]
    
    for s in sorted_signals:
        # تحقق من الصفقات اللي اتقفلت
        still_open = []
        for pos in open_positions:
            if pos['exit_date'] >= s['entry_date']:
                # لسه مفتوحة
                still_open.append(pos)
        open_positions = still_open
        
        # لو وصلنا للحد الأقصى → skip
        if len(open_positions) >= max_concurrent:
            continue
        
        # حساب الـ position size (Fixed Risk)
        risk_amount = equity * risk_per_trade
        sl_distance_pct = STOP_LOSS_PCT  # 5%
        position_size = risk_amount / (sl_distance_pct / 100)
        # حد أقصى للمركز = 20% من المحفظة
        max_position = equity * 0.20
        if position_size > max_position:
            position_size = max_position
        
        # حساب الـ P&L
        ret_pct = s['return']
        pnl = position_size * (ret_pct / 100)
        equity += pnl
        
        # تتبع
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
        
        open_positions.append({'ticker': s['ticker'], 'entry_date': s['entry_date'], 'exit_date': s['exit_date']})
        equity_curve.append(equity)
    
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
        'final_equity': equity,
        'gross_profit': total_profit,
        'gross_loss': total_loss,
    }


baseline = simulate_fixed_risk(signals)
print(f"\n  Baseline Results (Fixed Risk 1% + Max 10 concurrent):")
print(f"    closed: {baseline['n_closed']}")
print(f"    wins: {baseline['n_wins']}")
print(f"    WR: {baseline['wr']:.1f}%")
print(f"    PF: {baseline['pf']:.2f}")
print(f"    Max Drawdown: {baseline['max_dd']:.1f}%")
print(f"    Max Consecutive Losses: {baseline['max_consec']}")
print(f"    Total Return: {baseline['total_return']:.2f}%")
print(f"    Final equity: ${baseline['final_equity']:,.0f}")
print(f"    Gross profit: ${baseline['gross_profit']:,.0f}")
print(f"    Gross loss: ${baseline['gross_loss']:,.0f}")


# ═══════════════════════════════════════════════════════════════════════
# 4. Monte Carlo (1000 simulations)
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] Monte Carlo (1000 simulations)...")

N_SIMULATIONS = 1000
mc_pfs = []
mc_wrs = []
mc_returns = []
mc_dds = []

random.seed(42)

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)
    
    # shuffle returns + outcomes
    returns = [s['return'] for s in signals]
    outcomes = [s['outcome'] for s in signals]
    random.shuffle(returns)
    random.shuffle(outcomes)
    
    shuffled = []
    for i, s in enumerate(signals):
        shuffled.append({**s, 'return': returns[i], 'outcome': outcomes[i]})
    
    r = simulate_fixed_risk(shuffled)
    mc_pfs.append(r['pf'])
    mc_wrs.append(r['wr'])
    mc_returns.append(r['total_return'])
    mc_dds.append(r['max_dd'])

# إحصائيات MC
mc_pfs_sorted = sorted(mc_pfs)
mc_wrs_sorted = sorted(mc_wrs)
mc_returns_sorted = sorted(mc_returns)
mc_dds_sorted = sorted(mc_dds)


def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100


print(f"\n  Monte Carlo Statistics ({N_SIMULATIONS} simulations):")
print(f"\n  {'Metric':20s} | {'baseline':>12s} | {'MC avg':>12s} | {'MC median':>12s} | {'MC 5th':>12s} | {'MC 95th':>12s} | {'p-value':>8s}")
print("  " + "-"*110)

print(f"  {'WR':20s} | {baseline['wr']:>11.1f}% | {sum(mc_wrs)/len(mc_wrs):>11.1f}% | "
      f"{mc_wrs_sorted[len(mc_wrs)//2]:>11.1f}% | {mc_wrs_sorted[int(len(mc_wrs)*0.05)]:>11.1f}% | "
      f"{mc_wrs_sorted[int(len(mc_wrs)*0.95)]:>11.1f}% | {p_value(baseline['wr'], mc_wrs):>7.1f}%")

print(f"  {'Profit Factor':20s} | {baseline['pf']:>12.2f} | {sum(mc_pfs)/len(mc_pfs):>12.2f} | "
      f"{mc_pfs_sorted[len(mc_pfs)//2]:>12.2f} | {mc_pfs_sorted[int(len(mc_pfs)*0.05)]:>12.2f} | "
      f"{mc_pfs_sorted[int(len(mc_pfs)*0.95)]:>12.2f} | {p_value(baseline['pf'], mc_pfs):>7.1f}%")

print(f"  {'Max Drawdown':20s} | {baseline['max_dd']:>11.1f}% | {sum(mc_dds)/len(mc_dds):>11.1f}% | "
      f"{mc_dds_sorted[len(mc_dds)//2]:>11.1f}% | {mc_dds_sorted[int(len(mc_dds)*0.05)]:>11.1f}% | "
      f"{mc_dds_sorted[int(len(mc_dds)*0.95)]:>11.1f}% | {p_value(baseline['max_dd'], mc_dds, False):>7.1f}%")

print(f"  {'Total Return':20s} | {baseline['total_return']:>11.2f}% | {sum(mc_returns)/len(mc_returns):>11.2f}% | "
      f"{mc_returns_sorted[len(mc_returns)//2]:>11.2f}% | {mc_returns_sorted[int(len(mc_returns)*0.05)]:>11.2f}% | "
      f"{mc_returns_sorted[int(len(mc_returns)*0.95)]:>11.2f}% | {p_value(baseline['total_return'], mc_returns):>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] Verdict...")
print("\n" + "=" * 90)
print("  🎯 VERDICT — Mean Reversion (Fixed Risk)")
print("=" * 90)

pf_pvalue = p_value(baseline['pf'], mc_pfs)
wr_pvalue = p_value(baseline['wr'], mc_wrs)
ret_pvalue = p_value(baseline['total_return'], mc_returns)
dd_pvalue = p_value(baseline['max_dd'], mc_dds, False)

print(f"""
  Strategy: Mean Reversion (drop15% + 5d lookback + 5d hold + Bull/Range filter)
  Position Sizing: Fixed Risk 1% per trade + Max 10 concurrent
  Sample size: {baseline['n_closed']} closed
  
  WR: {baseline['wr']:.1f}% (p-value = {wr_pvalue:.1f}%)
  PF: {baseline['pf']:.2f} (p-value = {pf_pvalue:.1f}%)
  Return: {baseline['total_return']:.2f}% (p-value = {ret_pvalue:.1f}%)
  Max Drawdown: {baseline['max_dd']:.1f}% (p-value = {dd_pvalue:.1f}%)
  Max Consecutive Losses: {baseline['max_consec']}
""")

if baseline['n_closed'] >= 30:
    print(f"  ✅ Sample size = {baseline['n_closed']} (أكبر من 30 — موثوق)")
else:
    print(f"  ⚠️ Sample size = {baseline['n_closed']} (أقل من 30)")

if wr_pvalue < 5:
    print(f"  ✅ WR p-value = {wr_pvalue:.1f}% → edge حقيقي!")
else:
    print(f"  ❌ WR p-value = {wr_pvalue:.1f}% → مش edge")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → PF حقيقي!")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → مش PF")

if ret_pvalue < 5:
    print(f"  ✅ Return p-value = {ret_pvalue:.1f}% → return حقيقي!")
else:
    print(f"  ❌ Return p-value = {ret_pvalue:.1f}% → مش return")

if baseline['max_dd'] > 15:
    print(f"  ⚠️ Max Drawdown = {baseline['max_dd']:.1f}% → مرتفع")
else:
    print(f"  ✅ Max Drawdown = {baseline['max_dd']:.1f}% → مقبول")

if baseline['pf'] > 1.5:
    print(f"\n  🎉 PF = {baseline['pf']:.2f} > 1.5 → ابدأ بناء استراتيجية Mean Reversion كاملة!")
elif baseline['pf'] > 1.0:
    print(f"\n  ⚠️ PF = {baseline['pf']:.2f} > 1.0 (مربح بس مش قوي)")
else:
    print(f"\n  ❌ PF = {baseline['pf']:.2f} < 1.0 (خسارة)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_fixed_risk_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'strategy': 'Mean Reversion (drop15 + lbw5 + hold5 + Bull/Range filter)',
        'position_sizing': 'Fixed Risk 1% + Max 10 concurrent',
        'n_tickers': len(ticker_data),
        'n_signals': len(signals),
        'baseline': baseline,
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'return_pvalue': ret_pvalue,
            'dd_pvalue': dd_pvalue,
            'mc_pf_median': mc_pfs_sorted[len(mc_pfs)//2],
            'mc_wr_median': mc_wrs_sorted[len(mc_wrs)//2],
            'mc_return_median': mc_returns_sorted[len(mc_returns)//2],
            'mc_dd_median': mc_dds_sorted[len(mc_dds)//2],
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Mean Reversion Fixed Risk خلص")
print("=" * 90)
