#!/usr/bin/env python3
"""
Phase 6: A/B/C/D Comparison Backtest
=====================================
Runs 4 policy variants on the same 4-month EGX data.
Compares: Baseline (A) vs Regime-aware (B) vs Stock-aware (C) vs Full (D).

Run: python3 scripts/run_abcd_comparison.py
"""
from __future__ import annotations
import sys, os, sqlite3, csv, statistics, warnings
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'
COMMISSION_PCT = 0.1
SLIPPAGE_PCT = 0.05
POSITION_SIZE_PCT = 5.0
INITIAL_CAPITAL = 10000.0
MAX_HOLDING = 7
SAMPLE_TICKERS = 20
DB_PH = str(PROJECT_ROOT / 'db' / 'price_history.db')

def get_week_key(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def run_variant(policy_name: str, use_regime: bool = False):
    """Run backtest with a specific policy."""
    from core.orchestrator_v2 import create_regime_plan, detect_market_regime, detect_stock_regime
    from core.executor import execute_plan
    from core.risk_gate import apply_risk_gate
    from analyzers.master_analyzer import MasterAnalyzer
    
    c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE_TICKERS}")
    tickers = [r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    all_dates = [r[0] for r in cur.fetchall()]
    c.close()
    
    trades = []
    capital = INITIAL_CAPITAL
    capital_curve = [(WINDOW_START, capital)]
    no_trade_count = 0
    analyzer = MasterAnalyzer()
    
    for i, signal_date in enumerate(all_dates):
        if i < 60: continue
        
        for ticker in tickers:
            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            cur.execute(f"SELECT close_price, volume FROM price_history WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60", (ticker, signal_date))
            rows = cur.fetchall()[::-1]
            c.close()
            
            if len(rows) < 50: continue
            prices = [r[0] for r in rows]
            volumes = [r[1] for r in rows if r[1]]
            if len(prices) < 50: continue
            
            # Regime detection (only for B/C/D)
            if use_regime:
                plan = create_regime_plan(ticker, prices, volumes, policy=policy_name)
                if plan.decision_policy == 'no_trade':
                    no_trade_count += 1
                    continue
                market_regime = plan.regime_context.market_regime
                stock_regime = plan.regime_context.stock_regime
                confidence = plan.regime_context.confidence
            else:
                market_regime = 'UNKNOWN'
                stock_regime = 'UNKNOWN'
                confidence = 'MEDIUM'
            
            # Run master_analyzer
            try:
                result = analyzer.analyze(ticker, prices=prices, volumes=volumes)
            except: continue
            if not result: continue
            
            signal = getattr(result, 'signal', 'HOLD')
            score = getattr(result, 'master_score', 0)
            
            if signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'): continue
            
            # Risk gate
            entry = prices[-1]
            rp = getattr(result, 'risk_profile', {})
            if isinstance(rp, dict):
                stop = rp.get('stop_loss', entry * 0.95)
                target = rp.get('target_price', entry * 1.10)
                rr = rp.get('risk_reward_ratio', 2.0)
            else:
                stop = entry * 0.95; target = entry * 1.10; rr = 2.0
            
            # Regime-aware position sizing (C/D only)
            pos_size = POSITION_SIZE_PCT
            if policy_name in ('C', 'D'):
                if market_regime in ('R3', 'R4'): pos_size *= 0.5  # reduce in bear
                if confidence == 'LOW': pos_size *= 0.5
            
            final_signal, risk_warnings, final_pos = apply_risk_gate(
                signal=signal, master_score=score,
                risk_profile={'risk_reward_ratio': rr},
                data_quality='fresh', position_size_pct=pos_size,
            )
            
            if final_signal == 'NO_TRADE':
                no_trade_count += 1
                continue
            
            # Simulate trade
            future_idx = all_dates.index(signal_date) if signal_date in all_dates else i
            future_dates = all_dates[future_idx+1:future_idx+1+MAX_HOLDING]
            
            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            if future_dates:
                placeholders = ','.join('?' * len(future_dates))
                cur.execute(f"SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker=? AND market='EGX' AND date IN ({placeholders}) ORDER BY date", (ticker, *future_dates))
                future_rows = cur.fetchall()
            else:
                future_rows = []
            c.close()
            
            if not future_rows: continue
            
            exit_price = None; exit_reason = ''; exit_date = ''
            for fr in future_rows:
                f_date, f_high, f_low, f_close = fr
                if f_low and stop and f_low <= stop:
                    exit_price = stop; exit_reason = 'STOP_LOSS'; exit_date = f_date; break
                if f_high and target and f_high >= target:
                    exit_price = target; exit_reason = 'TARGET_HIT'; exit_date = f_date; break
                exit_price = f_close; exit_reason = 'HOLDING_EXPIRED'; exit_date = f_date
            
            if not exit_price: continue
            
            gross = (exit_price - entry) / entry * 100
            costs = COMMISSION_PCT * 2 + SLIPPAGE_PCT * 2
            net = gross - costs
            pos_value = capital * (final_pos / 100)
            pnl = pos_value * (net / 100)
            capital += pnl
            
            trades.append({
                'policy': policy_name, 'signal_date': signal_date,
                'week': get_week_key(signal_date), 'ticker': ticker,
                'market_regime': market_regime, 'stock_regime': stock_regime,
                'confidence': confidence, 'signal': signal, 'master_score': round(score,2),
                'entry_price': round(entry,4), 'stop_loss': round(stop,4),
                'target_price': round(target,4), 'position_size': final_pos,
                'exit_price': round(exit_price,4), 'exit_reason': exit_reason,
                'gross_return': round(gross,4), 'net_return': round(net,4),
                'pnl': round(pnl,2), 'capital_after': round(capital,2),
            })
            capital_curve.append((exit_date, capital))
    
    return trades, no_trade_count, capital

def calc_metrics(trades, capital):
    if not trades:
        return {'trades': 0, 'wr': 'N/A', 'pnl': 0, 'pf': 'N/A', 'return': 0, 'dd': 0}
    wins = [t for t in trades if t['net_return'] > 0.5]
    losses = [t for t in trades if t['net_return'] < -0.5]
    wr = len(wins)/len(trades)*100
    total_pnl = sum(t['pnl'] for t in trades)
    profit = sum(t['pnl'] for t in wins)
    loss = abs(sum(t['pnl'] for t in losses))
    pf = profit / loss if loss > 0 else float('inf')
    ret = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
    avg_w = statistics.mean([t['net_return'] for t in wins]) if wins else 0
    avg_l = statistics.mean([t['net_return'] for t in losses]) if losses else 0
    return {
        'trades': len(trades), 'wins': len(wins), 'losses': len(losses),
        'wr': f'{wr:.1f}%', 'pnl': round(total_pnl, 2),
        'pf': f'{pf:.2f}' if pf != float('inf') else '∞',
        'return': f'{ret:+.2f}%', 'avg_win': f'{avg_w:+.2f}%',
        'avg_loss': f'{avg_l:+.2f}%',
    }

print("="*70)
print("A/B/C/D COMPARISON — 4 months EGX")
print("="*70)

results = {}

# Policy A: Baseline (fixed weights, no regime)
print("\n--- Policy A: Baseline (fixed) ---")
trades_a, no_a, cap_a = run_variant('A', use_regime=False)
m_a = calc_metrics(trades_a, cap_a)
results['A'] = m_a
results['A']['no_trade'] = no_a
print(f"  Trades: {m_a['trades']} | WR: {m_a['wr']} | PF: {m_a['pf']} | P&L: {m_a['pnl']} | NO_TRADE: {no_a}")

# Policy B: Regime-aware engine selection
print("\n--- Policy B: Regime-aware selection ---")
trades_b, no_b, cap_b = run_variant('B', use_regime=True)
m_b = calc_metrics(trades_b, cap_b)
results['B'] = m_b
results['B']['no_trade'] = no_b
print(f"  Trades: {m_b['trades']} | WR: {m_b['wr']} | PF: {m_b['pf']} | P&L: {m_b['pnl']} | NO_TRADE: {no_b}")

# Policy C: Regime + position sizing
print("\n--- Policy C: Regime + position sizing ---")
trades_c, no_c, cap_c = run_variant('C', use_regime=True)
m_c = calc_metrics(trades_c, cap_c)
results['C'] = m_c
results['C']['no_trade'] = no_c
print(f"  Trades: {m_c['trades']} | WR: {m_c['wr']} | PF: {m_c['pf']} | P&L: {m_c['pnl']} | NO_TRADE: {no_c}")

# Policy D: Full (regime + weights + position sizing)
print("\n--- Policy D: Full package ---")
trades_d, no_d, cap_d = run_variant('D', use_regime=True)
m_d = calc_metrics(trades_d, cap_d)
results['D'] = m_d
results['D']['no_trade'] = no_d
print(f"  Trades: {m_d['trades']} | WR: {m_d['wr']} | PF: {m_d['pf']} | P&L: {m_d['pnl']} | NO_TRADE: {no_d}")

# Summary table
print(f"\n{'='*70}")
print("COMPARISON SUMMARY")
print(f"{'='*70}")
print(f"{'Policy':<10} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR':>7} {'PF':>6} {'P&L':>10} {'Return':>8} {'NO_TRADE':>9}")
print("-"*75)
for p in ['A', 'B', 'C', 'D']:
    m = results[p]
    print(f"{p:<10} {m['trades']:>7} {m.get('wins',0):>5} {m.get('losses',0):>7} {m['wr']:>7} {m['pf']:>6} {m['pnl']:>+9.2f} {m['return']:>8} {m.get('no_trade',0):>9}")

# Save
os.makedirs('backtest_results', exist_ok=True)
with open('backtest_results/regime_optimization_comparison.md', 'w') as f:
    f.write("# Regime Optimization Comparison\n\n")
    f.write(f"Window: {WINDOW_START} to {WINDOW_END} | EGX | {SAMPLE_TICKERS} tickers\n\n")
    f.write("| Policy | Description | Trades | WR | PF | P&L | Return | NO_TRADE |\n")
    f.write("|--------|-------------|--------|----|----|-----|--------|----------|\n")
    descs = {'A': 'Baseline (fixed weights)', 'B': 'Regime-aware engine selection',
             'C': 'Regime + position sizing', 'D': 'Full package'}
    for p in ['A', 'B', 'C', 'D']:
        m = results[p]
        f.write(f"| {p} | {descs[p]} | {m['trades']} | {m['wr']} | {m['pf']} | {m['pnl']} | {m['return']} | {m.get('no_trade',0)} |\n")

# Trade ledger
all_trades = trades_a + trades_b + trades_c + trades_d
if all_trades:
    with open('backtest_results/trade_ledger_abcd.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(all_trades[0].keys()))
        w.writeheader()
        for t in all_trades: w.writerow(t)

print(f"\nOutputs: backtest_results/regime_optimization_comparison.md")
print(f"         backtest_results/trade_ledger_abcd.csv ({len(all_trades)} trades)")
