#!/usr/bin/env python3
"""
=============================================================================
🔍 Phase 5b Verification — liquidity_radar_v2.py reads from price_history.db
=============================================================================

Tests:
  1. Python syntax valid
  2. PRICE_HISTORY_DB constant defined
  3. Phase 5b marker present
  4. PRIMARY query reads from price_history (not stock_daily_prices)
  5. FALLBACK query to stock_daily_prices still present
  6. Backup file exists
  7. Runtime test: candles from price_history.db produce more rows than fallback
  8. Runtime test: scan_ticker works end-to-end on real ticker
"""
import ast
import sqlite3
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RADAR_SCRIPT = PROJECT_ROOT / 'scripts' / 'liquidity_radar_v2.py'
BACKUP_DIR = PROJECT_ROOT / 'db' / 'backups'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'


def run_checks():
    checks = []

    # Check 1: syntax
    try:
        code = RADAR_SCRIPT.read_text(encoding='utf-8')
        ast.parse(code)
        checks.append(('python_syntax', 'PASS', 'valid Python'))
        print('  ✅ Check 1: Python syntax valid')
    except SyntaxError as e:
        checks.append(('python_syntax', 'FAIL', str(e)))
        print(f'  ❌ Check 1: Python syntax error: {e}')
        return checks

    # Check 2: PRICE_HISTORY_DB constant defined
    if 'PRICE_HISTORY_DB = Path(' in code:
        checks.append(('constant_defined', 'PASS', 'PRICE_HISTORY_DB present'))
        print('  ✅ Check 2: PRICE_HISTORY_DB constant defined')
    else:
        checks.append(('constant_defined', 'FAIL', 'missing'))
        print('  ❌ Check 2: PRICE_HISTORY_DB constant missing')

    # Check 3: Phase 5b marker
    if 'Phase 5b (DATA-UNIFICATION)' in code:
        checks.append(('phase5b_marker', 'PASS', 'present'))
        print('  ✅ Check 3: Phase 5b marker present')
    else:
        checks.append(('phase5b_marker', 'FAIL', 'not found'))
        print('  ❌ Check 3: Phase 5b marker not found')

    # Check 4: PRIMARY query reads from price_history
    # Find the block: look for "price_history" in a SELECT context
    if 'FROM price_history' in code and 'PRIMARY' in code:
        checks.append(('primary_query', 'PASS', 'reads from price_history'))
        print('  ✅ Check 4: PRIMARY query reads from price_history.db')
    else:
        checks.append(('primary_query', 'FAIL', 'no price_history PRIMARY'))
        print('  ❌ Check 4: PRIMARY query missing')

    # Check 5: FALLBACK to stock_daily_prices still present
    if 'FROM stock_daily_prices' in code and 'FALLBACK' in code:
        checks.append(('fallback_query', 'PASS', 'stock_daily_prices still fallback'))
        print('  ✅ Check 5: FALLBACK to stock_daily_prices still present')
    else:
        checks.append(('fallback_query', 'FAIL', 'no fallback'))
        print('  ❌ Check 5: FALLBACK missing')

    # Check 6: backup exists
    backups = list(BACKUP_DIR.glob('liquidity_radar_v2.py.backup_phase5b_*'))
    if backups:
        latest = max(backups, key=lambda p: p.stat().st_mtime)
        checks.append(('backup_exists', 'PASS', latest.name))
        print(f'  ✅ Check 6: backup exists ({latest.name})')
    else:
        checks.append(('backup_exists', 'FAIL', 'no backup'))
        print('  ❌ Check 6: no backup')

    # Check 7: runtime — compare candle counts
    try:
        ticker = 'COMI'
        c1 = sqlite3.connect(str(PRICE_HISTORY_DB))
        cur1 = c1.cursor()
        cur1.execute(
            'SELECT COUNT(*) FROM price_history WHERE ticker=? AND close_price > 0 AND volume > 0',
            (ticker,)
        )
        ph_count = cur1.fetchone()[0]
        c1.close()

        c2 = sqlite3.connect(str(STOCKS_DB))
        cur2 = c2.cursor()
        cur2.execute(
            'SELECT COUNT(*) FROM stock_daily_prices WHERE ticker=? AND close > 0 AND volume > 0',
            (ticker,)
        )
        sdp_count = cur2.fetchone()[0]
        c2.close()

        # PRIMARY should have ≥ FALLBACK rows (after unify)
        if ph_count >= sdp_count:
            checks.append((
                'primary_richer', 'PASS',
                f'price_history={ph_count} ≥ stock_daily={sdp_count} for {ticker}'
            ))
            print(f'  ✅ Check 7: price_history ({ph_count}) ≥ stock_daily_prices ({sdp_count}) for {ticker}')
        else:
            checks.append((
                'primary_richer', 'FAIL',
                f'price_history={ph_count} < stock_daily={sdp_count}'
            ))
            print(f'  ❌ Check 7: price_history ({ph_count}) < stock_daily_prices ({sdp_count})')
    except Exception as e:
        checks.append(('primary_richer', 'FAIL', str(e)))
        print(f'  ❌ Check 7: runtime error: {e}')

    # Check 8: runtime — scan_ticker end-to-end
    try:
        result = subprocess.run(
            ['/home/z/.venv/bin/python3', str(RADAR_SCRIPT),
             '--market', 'EGX', '--ticker', 'COMI', '--json'],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0 and '"ticker": "COMI"' in result.stdout:
            checks.append(('runtime_scan', 'PASS', 'COMI scanned successfully'))
            print('  ✅ Check 8: runtime scan_ticker works (COMI)')
        else:
            checks.append(('runtime_scan', 'FAIL', f'rc={result.returncode}'))
            print(f'  ❌ Check 8: runtime scan failed (rc={result.returncode})')
            print(f'     stderr: {result.stderr[:200]}')
    except Exception as e:
        checks.append(('runtime_scan', 'FAIL', str(e)))
        print(f'  ❌ Check 8: runtime exception: {e}')

    return checks


def main():
    print(f"\n  🔍 Phase 5b verification: liquidity_radar_v2.py\n")
    checks = run_checks()
    passed = sum(1 for c in checks if c[1] == 'PASS')
    failed = sum(1 for c in checks if c[1] == 'FAIL')
    print(f"\n  📋 Verification: {passed} passed, {failed} failed")
    return 1 if failed > 0 else 0


if __name__ == '__main__':
    sys.exit(main())
