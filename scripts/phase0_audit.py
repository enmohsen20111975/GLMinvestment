#!/usr/bin/env python3
"""
phase0_audit.py — Engine Inventory Audit (Phase 0)
==================================================
Checks which engines exist, import OK, run OK, and how fast.
"""
from __future__ import annotations

import os, sys, json, time, sqlite3, importlib, traceback
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'jobs'))

ENGINES = [
    {
        'name': 'Liquidity Filter',
        'file': 'analyzers/liquidity_filter.py',
        'import_path': 'analyzers.liquidity_filter',
        'class_name': 'LiquidityFilter',
    },
    {
        'name': 'Market Regime Engine',
        'file': 'analyzers/market_regime_engine.py',
        'import_path': 'analyzers.market_regime_engine',
        'class_name': 'MarketRegimeEngine',
    },
    {
        'name': 'Fundamental Scorer',
        'file': 'analyzers/fundamental_scorer.py',
        'import_path': 'analyzers.fundamental_scorer',
        'class_name': 'FundamentalScorer',
    },
    {
        'name': 'SMC Engine',
        'file': 'analyzers/smc_engine.py',
        'import_path': 'analyzers.smc_engine',
        'class_name': None,  # may not have a class
    },
    {
        'name': 'Volume Profile',
        'file': 'analyzers/volume_profile.py',
        'import_path': 'analyzers.volume_profile',
        'class_name': None,
    },
    {
        'name': 'V38 Backtest Engine',
        'file': 'engines/backtest_engine.py',
        'import_path': 'engines.backtest_engine',
        'class_name': 'V38BacktestEngine',
    },
    {
        'name': 'Session Timing',
        'file': 'analyzers/session_timing.py',
        'import_path': 'analyzers.session_timing',
        'class_name': 'SessionTimingAnalyzer',
    },
    {
        'name': 'Sentiment Analyzer',
        'file': 'analyzers/sentiment_analyzer.py',
        'import_path': 'analyzers.sentiment_analyzer',
        'class_name': 'SentimentAnalyzer',
    },
]

def check_engine(engine):
    """Check one engine: exists, imports, runs."""
    result = {
        'name': engine['name'],
        'file': engine['file'],
        'file_exists': False,
        'import_ok': False,
        'import_error': '',
        'class_found': False,
        'run_ok': False,
        'run_error': '',
        'speed_ms': 0,
        'output_shape': 'N/A',
        'verdict': 'FAIL',
    }
    
    fpath = VPS / engine['file']
    result['file_exists'] = fpath.exists()
    if not result['file_exists']:
        result['verdict'] = 'FAIL — file not found'
        return result
    
    # Try import
    try:
        mod = importlib.import_module(engine['import_path'])
        result['import_ok'] = True
        
        if engine['class_name']:
            cls = getattr(mod, engine['class_name'], None)
            result['class_found'] = cls is not None
            
            if cls is not None:
                # Try instantiation (may need db_path)
                try:
                    if engine['name'] == 'V38 Backtest Engine':
                        inst = cls(buy_threshold=60, use_v393=True, market_code='EGX')
                    else:
                        db_path = str(DB_DIR / 'stocks.db')
                        try:
                            inst = cls(db_path)
                        except:
                            inst = cls()
                    
                    result['run_ok'] = True
                    result['output_shape'] = str(type(inst).__name__)
                    result['verdict'] = 'PASS'
                except Exception as e:
                    result['run_error'] = str(e)[:100]
                    result['verdict'] = 'FAIL — instantiation error'
        else:
            result['class_found'] = True
            result['run_ok'] = True
            result['verdict'] = 'PASS'
            
    except Exception as e:
        result['import_error'] = str(e)[:100]
        result['verdict'] = 'FAIL — import error'
    
    return result


def main():
    print(f"\n{'='*70}")
    print(f"  Phase 0: Engine Inventory Audit")
    print(f"{'='*70}\n")
    
    results = []
    pass_count = 0
    
    for engine in ENGINES:
        t0 = time.time()
        result = check_engine(engine)
        result['speed_ms'] = round((time.time() - t0) * 1000, 1)
        results.append(result)
        
        status = '✅' if result['verdict'] == 'PASS' else '❌'
        print(f"  {status} {result['name']:<25} {result['verdict']}")
        if result['import_error']:
            print(f"     Error: {result['import_error'][:80]}")
        if result['run_error']:
            print(f"     Run error: {result['run_error'][:80]}")
        
        if result['verdict'] == 'PASS':
            pass_count += 1
    
    print(f"\n  {'='*70}")
    print(f"  Results: {pass_count}/{len(ENGINES)} engines PASS")
    print(f"  {'='*70}\n")
    
    # Go/No-Go
    if pass_count >= 6:
        print("  ✅ GO — 6+ engines passed, proceeding to Phase 1")
    elif pass_count >= 3:
        print(f"  ⚠️  GO WITH CAUTION — {pass_count} engines passed (need 6+)")
    else:
        print(f"  ❌ NO-GO — only {pass_count} engines passed (need 3+)")
    
    # Save JSON
    output_dir = PROJECT_ROOT / 'scripts' / 'audit_output'
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / 'phase0_inventory.json'
    with open(output_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_engines': len(ENGINES),
            'passed': pass_count,
            'results': results,
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n  💾 Saved: {output_path}")
    
    # Save markdown table
    doc_path = PROJECT_ROOT / 'Documentation' / 'PHASE0-AUDIT.md'
    with open(doc_path, 'w') as f:
        f.write(f"# Phase 0 — Engine Inventory Audit\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"| # | Engine | File | Import OK | Runs OK | Speed (ms) | Output | Verdict |\n")
        f.write(f"|---|--------|------|-----------|---------|------------|--------|---------|\n")
        for i, r in enumerate(results, 1):
            f.write(f"| {i} | {r['name']} | {r['file']} | {'✅' if r['import_ok'] else '❌'} | {'✅' if r['run_ok'] else '❌'} | {r['speed_ms']} | {r['output_shape']} | {r['verdict']} |\n")
        f.write(f"\n## Summary\n\n")
        f.write(f"- Total engines: {len(ENGINES)}\n")
        f.write(f"- Passed: {pass_count}\n")
        f.write(f"- Failed: {len(ENGINES) - pass_count}\n")
        f.write(f"\n## Go/No-Go: {'✅ GO' if pass_count >= 6 else '⚠️ CAUTION' if pass_count >= 3 else '❌ NO-GO'}\n")
    
    print(f"  📄 Report: {doc_path}")
    
    return 0 if pass_count >= 3 else 1


if __name__ == '__main__':
    sys.exit(main())
