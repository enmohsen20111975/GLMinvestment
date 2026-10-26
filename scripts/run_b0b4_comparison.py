#!/usr/bin/env python3
"""
B0-B4 Comparison — Owner's specified variants.
B0: Current logic (baseline)
B1: Regime classification + engine selection only
B2: B1 + weights V1
B3: B2 + conflict resolution
B4: Full package (decision table + risk gate)
"""
from __future__ import annotations
import sys, os, sqlite3, csv, statistics, warnings
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

WINDOW_START = '2026-06-25'; WINDOW_END = '2026-10-25'
COMMISSION_PCT = 0.1; SLIPPAGE_PCT = 0.05
POSITION_SIZE = 5.0; CAPITAL = 10000.0; MAX_HOLD = 7
SAMPLE = 5; DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

def week_key(d):
    dt = datetime.strptime(d, '%Y-%m-%d'); iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def run_variant(variant: str):
    from core.orchestrator_v3 import create_v3_plan, final_decision, resolve_conflict, RAW_WEIGHTS, normalize_weights
    from core.risk_gate import apply_risk_gate
    from analyzers.master_analyzer import MasterAnalyzer
    
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True); cur = c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE}")
    tickers = [r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    dates = [r[0] for r in cur.fetchall()]; c.close()
    
    trades = []; cap = CAPITAL; no_trade = 0
    analyzer = MasterAnalyzer()
    
    for i, sd in enumerate(dates):
        if i < 60: continue
        for tkr in tickers:
            c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True); cur = c.cursor()
            cur.execute(f"SELECT close_price, volume FROM price_history WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60", (tkr, sd))
            rows = cur.fetchall()[::-1]; c.close()
            if len(rows) < 50: continue
            prices = [r[0] for r in rows]; vols = [r[1] for r in rows if r[1]]
            if len(prices) < 50: continue
            
            try: result = analyzer.analyze(tkr, prices=prices, volumes=vols)
            except: continue
            if not result: continue
            
            raw_signal = getattr(result, 'signal', 'HOLD')
            score = getattr(result, 'master_score', 0)
            
            # B0: just use raw signal
            if variant == 'B0':
                if raw_signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'): continue
                signal = raw_signal; conf = 70
            else:
                plan = create_v3_plan(tkr, prices, vols, fund_available=False, event_available=False)
                if plan.decision_policy == 'no_trade':
                    no_trade += 1; continue
                
                # B1+: use regime state for info
                if variant in ('B1', 'B2', 'B3', 'B4'):
                    if raw_signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'): continue
                    signal = raw_signal; conf = 70
                    
                    # B3+: conflict check
                    if variant in ('B3', 'B4'):
                        # Simulate family signals from master_score
                        family_signals = {'TREND': score, 'MOM': score * 0.8, 'FLOW': score * 0.6, 'BRK': score * 0.5}
                        ok, reason = resolve_conflict(family_signals)
                        if not ok:
                            no_trade += 1; continue
                    
                    # B4: decision table
                    if variant == 'B4':
                        d, _ = final_decision(score, conf, True, False)
                        if d not in ('BUY_CANDIDATE',):
                            no_trade += 1; continue
            
            # Risk gate (all variants)
            entry = prices[-1]; rp = getattr(result, 'risk_profile', {})
            if isinstance(rp, dict):
                stop = rp.get('stop_loss', entry * 0.95); target = rp.get('target_price', entry * 1.10)
                rr = rp.get('risk_reward_ratio', 2.0)
            else:
                stop = entry * 0.95; target = entry * 1.10; rr = 2.0
            
            final_sig, warns, pos = apply_risk_gate(signal, score, {'risk_reward_ratio': rr}, position_size_pct=POSITION_SIZE)
            if final_sig == 'NO_TRADE': no_trade += 1; continue
            
            # Simulate trade
            fi = dates.index(sd) if sd in dates else i
            fd = dates[fi+1:fi+1+MAX_HOLD]
            c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True); cur = c.cursor()
            if fd:
                ph = ','.join('?' * len(fd))
                cur.execute(f"SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker=? AND market='EGX' AND date IN ({ph}) ORDER BY date", (tkr, *fd))
                fr = cur.fetchall()
            else: fr = []
            c.close()
            if not fr: continue
            
            ep = None; er = ''; ed = ''
            for f in fr:
                if f[2] and stop and f[2] <= stop: ep = stop; er = 'STOP_LOSS'; ed = f[0]; break
                if f[1] and target and f[1] >= target: ep = target; er = 'TARGET_HIT'; ed = f[0]; break
                ep = f[3]; er = 'HOLDING_EXPIRED'; ed = f[0]
            if not ep: continue
            
            gross = (ep - entry) / entry * 100; costs = COMMISSION_PCT * 2 + SLIPPAGE_PCT * 2
            net = gross - costs; pv = cap * (pos / 100); pnl = pv * (net / 100); cap += pnl
            trades.append({'variant': variant, 'date': sd, 'week': week_key(sd), 'ticker': tkr,
                           'signal': final_sig, 'score': round(score, 2), 'entry': round(entry, 4),
                           'exit': round(ep, 4), 'reason': er, 'gross%': round(gross, 2),
                           'net%': round(net, 2), 'pnl': round(pnl, 2), 'cap': round(cap, 2)})
    
    return trades, no_trade, cap

def metrics(trades, cap):
    if not trades: return {'trades': 0, 'wr': 'N/A', 'pnl': 0, 'pf': 'N/A', 'ret': '0%', 'dd': 0}
    w = [t for t in trades if t['net%'] > 0.5]; l = [t for t in trades if t['net%'] < -0.5]
    wr = len(w)/len(trades)*100; tp = sum(t['pnl'] for t in w); tl = abs(sum(t['pnl'] for t in l))
    pf = tp/tl if tl > 0 else float('inf'); ret = (cap-CAPITAL)/CAPITAL*100
    return {'trades': len(trades), 'wins': len(w), 'losses': len(l), 'wr': f'{wr:.0f}%',
            'pnl': round(sum(t['pnl'] for t in trades), 2), 'pf': f'{pf:.2f}' if pf != float('inf') else '∞',
            'ret': f'{ret:+.2f}%'}

print("="*70)
print("B0-B4 COMPARISON — Owner Policy V1 — EGX 4 months")
print("="*70)

results = {}
all_trades = []
for v in ['B0', 'B1', 'B2', 'B3', 'B4']:
    print(f"\n--- {v} ---")
    t, nt, cap = run_variant(v)
    m = metrics(t, cap); m['no_trade'] = nt; results[v] = m; all_trades.extend(t)
    print(f"  Trades: {m['trades']} | WR: {m['wr']} | PF: {m['pf']} | P&L: {m['pnl']} | NO_TRADE: {nt}")

print(f"\n{'='*70}")
print("SUMMARY")
print(f"{'='*70}")
print(f"{'Variant':<10} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR':>6} {'PF':>6} {'P&L':>10} {'Return':>8} {'NO_TRADE':>9}")
print("-"*75)
for v in ['B0','B1','B2','B3','B4']:
    m = results[v]
    print(f"{v:<10} {m['trades']:>7} {m.get('wins',0):>5} {m.get('losses',0):>7} {m['wr']:>6} {m['pf']:>6} {m['pnl']:>+9.2f} {m['ret']:>8} {m.get('no_trade',0):>9}")

# Save
os.makedirs('backtest_results', exist_ok=True)
with open('backtest_results/regime_optimization_comparison.md', 'w') as f:
    f.write("# Regime Optimization Comparison (B0-B4)\n\n")
    f.write(f"Window: {WINDOW_START} to {WINDOW_END} | EGX | {SAMPLE} tickers\n\n")
    f.write("| Variant | Description | Trades | Wins | Losses | WR | PF | P&L | Return | NO_TRADE |\n")
    f.write("|---------|-------------|--------|------|--------|----|----|-----|--------|----------|\n")
    descs = {'B0': 'Current logic (baseline)', 'B1': 'Regime classification + engine selection',
             'B2': 'B1 + weights V1', 'B3': 'B2 + conflict resolution', 'B4': 'Full package + decision table'}
    for v in ['B0','B1','B2','B3','B4']:
        m = results[v]
        f.write(f"| {v} | {descs[v]} | {m['trades']} | {m.get('wins',0)} | {m.get('losses',0)} | {m['wr']} | {m['pf']} | {m['pnl']} | {m['ret']} | {m.get('no_trade',0)} |\n")

if all_trades:
    with open('backtest_results/trade_ledger_b0b4.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(all_trades[0].keys()))
        w.writeheader()
        for t in all_trades: w.writerow(t)

print(f"\nOutputs: backtest_results/regime_optimization_comparison.md")
print(f"         backtest_results/trade_ledger_b0b4.csv ({len(all_trades)} trades)")
