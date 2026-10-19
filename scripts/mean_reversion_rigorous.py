#!/usr/bin/env python3
"""
mean_reversion_rigorous.py — Mean Reversion بـ Block Bootstrap + Costs + Robustness.

الـ framework (per Mohsen's directive):
  1. Block Bootstrap Monte Carlo (يحافظ على الترتيب الزمني)
  2. Null Model (random entries بنفس التوقيت + holding + risk)
  3. التكاليف: commission + slippage + bid-ask (0.5% per round trip)
  4. Liquidity filter: استبعاد الأسهم قليلة التداول
  5. تحليل الثبات: per year + per regime
  6. Top 5/10 trades contribution
"""
import sys
import os
import json
import sqlite3
import random
import statistics
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter, defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO MEAN REVERSION RIGOROUS — Block Bootstrap + Costs")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════
DROP_THRESHOLD = 15
LOOKBACK_DAYS = 5
HOLDING_DAYS = 5
STOP_LOSS_PCT = 5.0
TARGET_PCT = 5.0
MAX_CONCURRENT = 10
RISK_PER_TRADE = 0.01

# التكاليف (EGX realistic)
COMMISSION_PCT = 0.15  # 0.15% عمولة broker
SLIPPAGE_PCT = 0.20    # 0.20% slippage (bid-ask + impact)
TOTAL_COST_PCT = COMMISSION_PCT + SLIPPAGE_PCT  # 0.35% per side → 0.70% round trip

# Liquidity filter
MIN_TURNOVER_EGP = 100000  # 100K EGP minimum daily turnover

START_DATE = '2024-01-01'
END_DATE = '2026-10-31'


# ═══════════════════════════════════════════════════════════════════════
# 1. تحميل البيانات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/7] تحميل البيانات...")

ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

tickers = ph_conn.execute("""
    SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
    FROM price_history
    GROUP BY ticker
    HAVING cnt >= 200
""").fetchall()

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
                    and h['high_price'] is not None and h['low_price'] is not None
                    and h['open_price'] is not None]
        if len(filtered) >= 200:
            ticker_data[t['ticker']] = filtered

ph_conn.close()
print(f"  ✅ {len(ticker_data)} ticker بـ data نظيفة")


# ═══════════════════════════════════════════════════════════════════════
# 2. بناء signals + liquidity filter + costs
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/7] بناء signals + liquidity filter + costs...")


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


def generate_signals(ticker_data, apply_liquidity_filter=True):
    signals = []
    
    for ticker, hist in ticker_data.items():
        closes = [h['close_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        for i in range(LOOKBACK_DAYS + 50, len(closes) - HOLDING_DAYS):
            # Liquidity filter
            if apply_liquidity_filter:
                avg_vol_20 = sum(volumes[max(0,i-20):i]) / 20 if i >= 20 else 0
                avg_price = closes[i]
                turnover = avg_vol_20 * avg_price
                if turnover < MIN_TURNOVER_EGP:
                    continue
            
            # drop في آخر LOOKBACK_DAYS
            current_close = closes[i]
            past_close = closes[i - LOOKBACK_DAYS]
            drop_pct = ((past_close - current_close) / past_close) * 100
            
            if drop_pct >= DROP_THRESHOLD:
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
                    if closes[j] <= sl:
                        exit_price = sl
                        exit_date = dates[j]
                        exit_reason = 'STOP_LOSS'
                        exit_idx = j
                        break
                    if closes[j] >= target:
                        exit_price = target
                        exit_date = dates[j]
                        exit_reason = 'TARGET'
                        exit_idx = j
                        break
                
                if exit_price is None:
                    exit_price = closes[exit_idx]
                    exit_date = dates[exit_idx]
                    exit_reason = 'TIME_EXIT'
                
                # Gross return
                gross_ret = ((exit_price - entry) / entry) * 100
                
                # Net return (after costs: 0.70% round trip)
                net_ret = gross_ret - TOTAL_COST_PCT * 2  # buy + sell
                
                # Determine year
                year = entry_date[:4]
                
                signals.append({
                    'ticker': ticker,
                    'entry_date': entry_date,
                    'exit_date': exit_date,
                    'entry': entry,
                    'exit': exit_price,
                    'gross_return': gross_ret,
                    'net_return': net_ret,
                    'return': net_ret,  # use net for all calculations
                    'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
                    'regime': regime,
                    'year': year,
                    'exit_reason': exit_reason,
                    'drop_pct': drop_pct,
                })
    
    return signals


signals = generate_signals(ticker_data)
print(f"  ✅ {len(signals)} إشارة (بعد liquidity filter + costs)")


# ═══════════════════════════════════════════════════════════════════════
# 3. محاكاة بـ Fixed Risk
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/7] محاكاة بـ Fixed Risk...")


def simulate_fixed_risk(signals, initial_equity=100000, risk_per_trade=0.01, max_concurrent=10):
    if not signals:
        return None
    
    sorted_signals = sorted(signals, key=lambda s: s['entry_date'])
    
    equity = initial_equity
    peak = initial_equity
    max_dd = 0.0
    max_consec = 0
    current_consec = 0
    
    open_positions = []
    closed_count = 0
    wins_count = 0
    total_profit = 0
    total_loss = 0
    
    for s in sorted_signals:
        still_open = [pos for pos in open_positions if pos['exit_date'] >= s['entry_date']]
        open_positions = still_open
        
        if len(open_positions) >= max_concurrent:
            continue
        
        risk_amount = equity * risk_per_trade
        position_size = risk_amount / (STOP_LOSS_PCT / 100)
        max_position = equity * 0.20
        if position_size > max_position:
            position_size = max_position
        
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
        
        open_positions.append({'ticker': s['ticker'], 'entry_date': s['entry_date'], 'exit_date': s['exit_date']})
    
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
print(f"\n  Baseline (بعد التكاليف):")
print(f"    closed: {baseline['n_closed']}")
print(f"    WR: {baseline['wr']:.1f}%")
print(f"    PF: {baseline['pf']:.2f}")
print(f"    Max Drawdown: {baseline['max_dd']:.1f}%")
print(f"    Max Consecutive Losses: {baseline['max_consec']}")
print(f"    Total Return: {baseline['total_return']:.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 4. BLOCK BOOTSTRAP Monte Carlo (يحافظ على الترتيب الزمني)
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/7] Block Bootstrap Monte Carlo (1000 simulations)...")

N_SIMULATIONS = 1000
BLOCK_SIZE = 10  # blocks of 10 trades (preserves temporal correlation)
mc_pfs = []
mc_wrs = []
mc_returns = []
mc_dds = []

random.seed(42)

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)
    
    # Block Bootstrap: divide returns into blocks, shuffle blocks (not individual returns)
    returns = [s['return'] for s in signals]
    outcomes = [s['outcome'] for s in signals]
    
    n_blocks = len(returns) // BLOCK_SIZE
    blocks = []
    for i in range(n_blocks):
        start = i * BLOCK_SIZE
        end = start + BLOCK_SIZE
        blocks.append({
            'returns': returns[start:end],
            'outcomes': outcomes[start:end],
        })
    
    # Shuffle blocks
    random.shuffle(blocks)
    
    # Reconstruct
    shuffled_returns = []
    shuffled_outcomes = []
    for block in blocks:
        shuffled_returns.extend(block['returns'])
        shuffled_outcomes.extend(block['outcomes'])
    
    # Build shuffled signals (keep same dates/tickers)
    shuffled = []
    for i, s in enumerate(signals):
        if i < len(shuffled_returns):
            shuffled.append({
                **s,
                'return': shuffled_returns[i],
                'outcome': shuffled_outcomes[i],
            })
    
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


print(f"\n  Block Bootstrap Monte Carlo Statistics ({N_SIMULATIONS} simulations):")
print(f"\n  {'Metric':20s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'p-value':>8s}")
print("  " + "-"*70)
print(f"  {'WR':20s} | {baseline['wr']:>9.1f}% | {sum(mc_wrs)/len(mc_wrs):>9.1f}% | {mc_wrs_sorted[len(mc_wrs)//2]:>9.1f}% | {p_value(baseline['wr'], mc_wrs):>7.1f}%")
print(f"  {'Profit Factor':20s} | {baseline['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | {mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {p_value(baseline['pf'], mc_pfs):>7.1f}%")
print(f"  {'Max Drawdown':20s} | {baseline['max_dd']:>9.1f}% | {sum(mc_dds)/len(mc_dds):>9.1f}% | {mc_dds_sorted[len(mc_dds)//2]:>9.1f}% | {p_value(baseline['max_dd'], mc_dds, False):>7.1f}%")
print(f"  {'Total Return':20s} | {baseline['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | {mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {p_value(baseline['total_return'], mc_returns):>7.1f}%")


# ═══════════════════════════════════════════════════════════════════════
# 5. NULL MODEL (random entries بنفس التوقيت + holding + risk)
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/7] Null Model (random entries بنفس التوقيت)...")

# الـ Null Model: بدل ما نشتري الأسهم النازلة 15%، نشتري أسهم عشوائية
# بنفس التواريخ + نفس holding + نفس risk
null_signals = []
random.seed(123)

for s in signals:
    # اختار ticker عشوائي
    random_ticker = random.choice(list(ticker_data.keys()))
    hist = ticker_data[random_ticker]
    closes = [h['close_price'] for h in hist]
    dates = [h['date'] for h in hist]
    
    # find the entry_date in this ticker
    entry_date = s['entry_date']
    try:
        idx = dates.index(entry_date)
    except ValueError:
        # closest date
        idx = min(range(len(dates)), key=lambda i: abs(dates[i].compare_to(entry_date) if hasattr(dates[i], 'compare_to') else 0))
        continue
    
    if idx >= len(closes) - HOLDING_DAYS:
        continue
    
    entry = closes[idx]
    sl = entry * (1 - STOP_LOSS_PCT / 100)
    target = entry * (1 + TARGET_PCT / 100)
    
    exit_price = None
    exit_idx = min(idx + HOLDING_DAYS, len(closes) - 1)
    
    for j in range(idx+1, min(idx + HOLDING_DAYS + 1, len(closes))):
        if closes[j] <= sl:
            exit_price = sl
            exit_idx = j
            break
        if closes[j] >= target:
            exit_price = target
            exit_idx = j
            break
    
    if exit_price is None:
        exit_price = closes[exit_idx]
    
    gross_ret = ((exit_price - entry) / entry) * 100
    net_ret = gross_ret - TOTAL_COST_PCT * 2
    
    null_signals.append({
        'ticker': random_ticker,
        'entry_date': entry_date,
        'exit_date': dates[exit_idx] if exit_idx < len(dates) else dates[-1],
        'return': net_ret,
        'outcome': 'TARGET_HIT' if net_ret > 0 else 'STOPPED',
    })

null_result = simulate_fixed_risk(null_signals) if null_signals else None
if null_result:
    print(f"\n  Null Model Results:")
    print(f"    closed: {null_result['n_closed']}")
    print(f"    WR: {null_result['wr']:.1f}%")
    print(f"    PF: {null_result['pf']:.2f}")
    print(f"    Return: {null_result['total_return']:.2f}%")
    print(f"    Max Drawdown: {null_result['max_dd']:.1f}%")
    print(f"\n  Strategy vs Null Model:")
    print(f"    Strategy PF: {baseline['pf']:.2f} vs Null PF: {null_result['pf']:.2f}")
    print(f"    Strategy Return: {baseline['total_return']:.2f}% vs Null Return: {null_result['total_return']:.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 6. ROBUSTNESS: per year + per regime
# ═══════════════════════════════════════════════════════════════════════
print("\n[6/7] Robustness Analysis (per year + per regime)...")

# per year
print(f"\n  --- Per Year ---")
print(f"  {'Year':6s} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print("  " + "-"*55)
for year in sorted(set(s['year'] for s in signals)):
    year_signals = [s for s in signals if s['year'] == year]
    year_r = simulate_fixed_risk(year_signals)
    if year_r:
        print(f"  {year:6s} | {year_r['n_closed']:>6} | {year_r['n_wins']:>4} | {year_r['wr']:>5.1f}% | {year_r['pf']:>6.2f} | {year_r['total_return']:>+7.2f}%")

# per regime
print(f"\n  --- Per Regime ---")
print(f"  {'Regime':10s} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
print("  " + "-"*55)
for regime in ['BULL', 'RANGE', 'BEAR']:
    regime_signals = [s for s in signals if s['regime'] == regime]
    regime_r = simulate_fixed_risk(regime_signals)
    if regime_r:
        print(f"  {regime:10s} | {regime_r['n_closed']:>6} | {regime_r['n_wins']:>4} | {regime_r['wr']:>5.1f}% | {regime_r['pf']:>6.2f} | {regime_r['total_return']:>+7.2f}%")


# ═══════════════════════════════════════════════════════════════════════
# 7. TOP TRADES CONTRIBUTION
# ═══════════════════════════════════════════════════════════════════════
print("\n[7/7] Top Trades Contribution...")

# حساب PnL لكل صفقة (بـ Fixed Risk)
sorted_signals = sorted(signals, key=lambda s: s['entry_date'])
equity = 100000
trade_pnls = []

for s in sorted_signals:
    risk_amount = equity * RISK_PER_TRADE
    position_size = risk_amount / (STOP_LOSS_PCT / 100)
    max_position = equity * 0.20
    if position_size > max_position:
        position_size = max_position
    
    ret_pct = s['return']
    pnl = position_size * (ret_pct / 100)
    equity += pnl
    trade_pnls.append({
        'ticker': s['ticker'],
        'entry_date': s['entry_date'],
        'return': ret_pct,
        'pnl': pnl,
        'equity_after': equity,
    })

# Top 5 + Top 10
total_pnl = sum(t['pnl'] for t in trade_pnls)
sorted_pnls = sorted(trade_pnls, key=lambda t: t['pnl'], reverse=True)

top5_pnl = sum(t['pnl'] for t in sorted_pnls[:5])
top10_pnl = sum(t['pnl'] for t in sorted_pnls[:10])
top5_pct = (top5_pnl / total_pnl * 100) if total_pnl > 0 else 0
top10_pct = (top10_pnl / total_pnl * 100) if total_pnl > 0 else 0

print(f"\n  Total trades: {len(trade_pnls)}")
print(f"  Total PnL: ${total_pnl:,.0f}")
print(f"  Top 5 trades PnL: ${top5_pnl:,.0f} ({top5_pct:.1f}% of total)")
print(f"  Top 10 trades PnL: ${top10_pnl:,.0f} ({top10_pct:.1f}% of total)")

print(f"\n  --- Top 5 trades ---")
print(f"  {'ticker':8s} | {'date':12s} | {'return':>8s} | {'PnL':>10s}")
print("  " + "-"*50)
for t in sorted_pnls[:5]:
    print(f"  {t['ticker']:8s} | {t['entry_date']:12s} | {t['return']:>+7.2f}% | ${t['pnl']:>9.0f}")

print(f"\n  --- Bottom 5 trades ---")
for t in sorted_pnls[-5:]:
    print(f"  {t['ticker']:8s} | {t['entry_date']:12s} | {t['return']:>+7.2f}% | ${t['pnl']:>9.0f}")


# ═══════════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("  🎯 VERDICT — Mean Reversion Rigorous (بعد التكاليف + Block Bootstrap)")
print("=" * 90)

pf_pvalue = p_value(baseline['pf'], mc_pfs)
wr_pvalue = p_value(baseline['wr'], mc_wrs)
ret_pvalue = p_value(baseline['total_return'], mc_returns)

print(f"""
  Strategy: Mean Reversion (drop15% + 5d lookback + 5d hold + Bull/Range filter)
  Costs: {TOTAL_COST_PCT * 2:.2f}% round trip (commission + slippage)
  Liquidity filter: {MIN_TURNOVER_EGP:,} EGP minimum daily turnover
  Position Sizing: Fixed Risk 1% + Max 10 concurrent
  Sample size: {baseline['n_closed']} closed
  
  WR: {baseline['wr']:.1f}% (p-value = {wr_pvalue:.1f}%)
  PF: {baseline['pf']:.2f} (p-value = {pf_pvalue:.1f}%)
  Return: {baseline['total_return']:.2f}% (p-value = {ret_pvalue:.1f}%)
  Max Drawdown: {baseline['max_dd']:.1f}%
  Max Consecutive Losses: {baseline['max_consec']}
""")

if null_result:
    print(f"  Strategy vs Null Model:")
    print(f"    PF: {baseline['pf']:.2f} vs {null_result['pf']:.2f}")
    print(f"    Return: {baseline['total_return']:.2f}% vs {null_result['total_return']:.2f}%")
    if baseline['pf'] > null_result['pf']:
        print(f"    ✅ Strategy أفضل من Null Model")
    else:
        print(f"    ❌ Strategy ليس أفضل من Null Model")

print(f"\n  Top 5 contribution: {top5_pct:.1f}% (هش لو > 50%)")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → edge حقيقي!")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → مش edge")

if ret_pvalue < 5:
    print(f"  ✅ Return p-value = {ret_pvalue:.1f}% → return حقيقي!")
else:
    print(f"  ❌ Return p-value = {ret_pvalue:.1f}% → مش return")

if baseline['pf'] > 1.3 and baseline['max_dd'] < 15:
    print(f"\n  🎉 PF > 1.3 + MaxDD < 15% → جاهز لتحسين الـ Exit!")
elif baseline['pf'] > 1.0:
    print(f"\n  ⚠️ PF > 1.0 (مربح) بس MaxDD = {baseline['max_dd']:.1f}% > 15%")
else:
    print(f"\n  ❌ PF < 1.0 (خسارة بعد التكاليف)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_rigorous_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'strategy': 'Mean Reversion (drop15 + lbw5 + hold5 + Bull/Range + costs + liquidity)',
        'costs': {'commission_pct': COMMISSION_PCT, 'slippage_pct': SLIPPAGE_PCT, 'total_round_trip': TOTAL_COST_PCT * 2},
        'liquidity_filter': MIN_TURNOVER_EGP,
        'n_signals': len(signals),
        'baseline': baseline,
        'null_model': null_result,
        'block_bootstrap': {
            'n_simulations': N_SIMULATIONS,
            'block_size': BLOCK_SIZE,
            'wr_pvalue': wr_pvalue,
            'pf_pvalue': pf_pvalue,
            'return_pvalue': ret_pvalue,
        },
        'top_trades': {
            'top5_pct': top5_pct,
            'top10_pct': top10_pct,
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ Mean Reversion Rigorous خلص")
print("=" * 90)
