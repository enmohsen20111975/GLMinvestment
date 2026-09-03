#!/usr/bin/env python3
"""
تشخيص entry_gate — ليه ABUK (INSTITUTIONAL_BUY, score=100) بيتـ reject؟
شغّل على الإنتاج: .venv/bin/python3 scripts/diagnose_entry_gate.py
"""
import sys, os
sys.path.insert(0, 'vps-service')
from engines.v38_backtest_engine import V38BacktestEngine
from utils.entry_gate import check_entry_gate
import sqlite3

engine = V38BacktestEngine()
engine._load_benchmark()

conn = sqlite3.connect('db/price_history.db')
cur = conn.cursor()

for ticker in ['ABUK', 'COMI', 'EAST', 'SWDY', 'DAPH']:
    cur.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? ORDER BY date ASC
    ''', (ticker,))
    rows = cur.fetchall()
    if not rows:
        print(f'{ticker}: NO DATA')
        continue
    
    dates = [r[0] for r in rows]
    opens = [float(r[1] or 0) for r in rows]
    highs = [float(r[2] or 0) for r in rows]
    lows = [float(r[3] or 0) for r in rows]
    closes = [float(r[4] or 0) for r in rows]
    volumes = [float(r[5] or 0) for r in rows]
    
    day_idx = len(closes) - 1
    result = engine.analyze_single_day_v393(
        ticker, dates, opens, highs, lows, closes, volumes, day_idx, 0.0
    )
    
    signal = result.get('signal', 'WAIT')
    score = result.get('score', 0)
    entry = result.get('entry', 0)
    target = result.get('target', 0)
    stop = result.get('stop_loss', 0) or result.get('stop', 0)
    evidence = 0
    proofs = result.get('proofs', {})
    for v in proofs.values():
        if v and '✅' in str(v):
            evidence += 1
    
    print(f'\n{"="*80}')
    print(f'{ticker}: signal={signal}, score={score}')
    print(f'  entry={entry}, target={target}, stop={stop}')
    print(f'  evidence={evidence}, proofs={list(proofs.keys())}')
    
    # Skip if WAIT
    if signal in ('WAIT', 'HOLD', 'WATCH', 'NEUTRAL'):
        print(f'  → SKIPPED (signal not BUY)')
        continue
    
    # Run entry_gate
    gate_data = {
        'entry_price': entry,
        'target_price': target,
        'stop_price': stop,
        'evidence_count': evidence,
        'proofs': proofs,
        'closes': closes[:day_idx+1],
        'volumes': volumes[:day_idx+1],
        'market_regime_trend': result.get('market_regime_trend', ''),
        'stock_roc': float(result.get('stock_roc', 0) or 0),
        'benchmark_change': float(result.get('benchmark_change', 0) or 0),
    }
    
    gate_result = check_entry_gate(gate_data)
    
    print(f'\n  ENTRY GATE: passed={gate_result["passed"]}, score={gate_result["score"]}/{gate_result["total_checks"]}')
    
    if gate_result['passed']:
        print(f'  ✅ ACCEPTED — التوقع هيـ save')
    else:
        print(f'  ❌ REJECTED — الأسباب:')
        for r in gate_result.get('reasons_failed', []):
            print(f'    ✗ {r["name"]}: {r["reason"]}')
        print(f'\n  الشروط اللي passed:')
        for r in gate_result.get('reasons_passed', []):
            print(f'    ✓ {r["name"]}: {r["reason"]}')

conn.close()
print(f'\n{"="*80}')
print('✓ التشخيص كامل')
