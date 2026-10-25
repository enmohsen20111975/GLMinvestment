#!/usr/bin/env python3
"""
تشخيص شامل: scan كل 234 سهم + print إحصائيات
شغّل: .venv/bin/python3 scripts/diagnose_v402_full.py
"""
import sys, os
sys.path.insert(0, 'vps-service')
from engines.v38_backtest_engine import V38BacktestEngine
from utils.entry_gate import check_entry_gate
import sqlite3
from collections import Counter

engine = V38BacktestEngine()
engine._load_benchmark()

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection('db/price_history.db', writable=False).__enter__()
cur = conn.cursor()

def parse_volume(val):
    """Parse volume strings like '2.56M', '1.2K', '500' to float."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace('\u202f', '').replace(' ', '')
    if not s:
        return 0.0
    multipliers = {'K': 1000, 'M': 1_000_000, 'B': 1_000_000_000}
    for suffix, mult in multipliers.items():
        if s.upper().endswith(suffix):
            try:
                return float(s[:-1]) * mult
            except ValueError:
                return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

# Get all EGX tickers (same logic as V40.2)
cur.execute("SELECT DISTINCT ticker FROM price_history ORDER BY ticker")
all_tickers = [r[0] for r in cur.fetchall()]

# Blocklist (Rule 28)
blocklist = {'APRI', 'CCRS', 'CEFM', 'DEIN', 'DSCW', 'EFIC', 'EGTS', 'EKHO', 'ETEL', 'GETO', 'ISPH', 'JUFO', 'MASR', 'OCIC', 'ORHD', 'ORTE', 'PETR', 'PHAR', 'PHYG', 'SKPC', 'TMGH'}
tickers = [t for t in all_tickers if t not in blocklist]

print(f"Total tickers: {len(all_tickers)} | After blocklist: {len(tickers)}")

signal_counts = Counter()
gate_results = {'passed': 0, 'failed': 0, 'not_buy': 0, 'no_data': 0, 'errors': 0}
reject_reasons = Counter()
accepted_tickers = []

for i, ticker in enumerate(tickers):
    if i % 50 == 0:
        print(f"  ⏳ Processing {i}/{len(tickers)}...")
    
    cur.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? ORDER BY date ASC
    ''', (ticker,))
    rows = cur.fetchall()
    if not rows or len(rows) < 200:
        gate_results['no_data'] += 1
        continue
    
    dates = [r[0] for r in rows]
    opens = [float(r[1] or 0) for r in rows]
    highs = [float(r[2] or 0) for r in rows]
    lows = [float(r[3] or 0) for r in rows]
    closes = [float(r[4] or 0) for r in rows]
    volumes = [parse_volume(r[5]) for r in rows]
    
    day_idx = len(closes) - 1
    try:
        result = engine.analyze_single_day_v393(
            ticker, dates, opens, highs, lows, closes, volumes, day_idx, 0.0
        )
    except Exception as e:
        gate_results['errors'] += 1
        continue
    
    signal = result.get('signal', 'WAIT')
    score = result.get('score', 0)
    signal_counts[signal] += 1
    
    if signal in ('WAIT', 'HOLD', 'WATCH', 'NEUTRAL'):
        gate_results['not_buy'] += 1
        continue
    
    # Run entry_gate
    entry = result.get('entry', 0)
    target = result.get('target', 0)
    stop = result.get('stop_loss', 0) or result.get('stop', 0)
    evidence = sum(1 for v in result.get('proofs', {}).values() if v and '✅' in str(v))
    
    gate_data = {
        'entry_price': entry,
        'target_price': target,
        'stop_price': stop,
        'evidence_count': evidence,
        'proofs': result.get('proofs', {}),
        'closes': closes[:day_idx+1],
        'volumes': volumes[:day_idx+1],
        'market_regime_trend': result.get('market_regime_trend', ''),
        'stock_roc': float(result.get('stock_roc', 0) or 0),
        'benchmark_change': float(result.get('benchmark_change', 0) or 0),
        'signal_type': signal,
        'score': score,
    }
    
    try:
        gate_result = check_entry_gate(gate_data)
        if gate_result['passed']:
            gate_results['passed'] += 1
            accepted_tickers.append((ticker, signal, score))
        else:
            gate_results['failed'] += 1
            for r in gate_result.get('reasons_failed', []):
                if isinstance(r, str):
                    reject_reasons[r] += 1
                elif isinstance(r, dict):
                    reject_reasons[r.get('reason', 'unknown')] += 1
    except Exception as e:
        gate_results['errors'] += 1

conn.close()

print(f"\n{'='*80}")
print(f"📊 V40.2 FULL DIAGNOSTIC — {len(tickers)} tickers scanned")
print(f"{'='*80}")

print(f"\n📈 Signal Distribution:")
for sig, cnt in signal_counts.most_common():
    print(f"  {sig:25s}: {cnt}")

print(f"\n🎯 Entry Gate Results:")
print(f"  ✅ Passed: {gate_results['passed']}")
print(f"  ❌ Failed: {gate_results['failed']}")
print(f"  ⏭️  Not BUY (WAIT/HOLD): {gate_results['not_buy']}")
print(f"  📭 No data (<200 days): {gate_results['no_data']}")
print(f"  ⚠️  Errors: {gate_results['errors']}")

if reject_reasons:
    print(f"\n❌ Reject Reasons (top 10):")
    for reason, cnt in reject_reasons.most_common(10):
        print(f"  {cnt:3d}x | {reason}")

if accepted_tickers:
    print(f"\n✅ ACCEPTED TICKERS ({len(accepted_tickers)}):")
    for ticker, signal, score in accepted_tickers:
        print(f"  {ticker:6s} | {signal:25s} | score={score}")
else:
    print(f"\n❌ NO TICKERS PASSED — V40.2 will generate 0 predictions")
    print(f"   Main issue: {gate_results['not_buy']} tickers returned WAIT/HOLD")
    print(f"   (market conditions don't trigger BUY signals today)")
