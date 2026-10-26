#!/usr/bin/env python3
"""
Tests for data quality flags (OHLC + MENA + POUL/ORHD adjustments).
Run: python3 scripts/test_data_quality_fixes.py
"""
from __future__ import annotations
import sys, sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PASS = 0; FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name}  {detail}')

print("=" * 60)
print("Data Quality Fixes Tests")
print("=" * 60)

# ============================================================================
# 1. OHLC flags exist
# ============================================================================
print("\n=== OHLC Validity Flags ===")
c = sqlite3.connect('file:db/stocks.db?mode=ro', uri=True)
cur = c.cursor()
cur.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE data_quality_flags = 'OHLC_INVALID'")
n_flagged = cur.fetchone()[0]
check(f'OHLC_INVALID rows flagged: {n_flagged}', n_flagged > 0, f'got {n_flagged}')

cur.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE data_quality_flags = '' OR data_quality_flags IS NULL")
n_clean = cur.fetchone()[0]
check(f'Clean rows (no flags): {n_clean}', n_clean > 0)
c.close()

# ============================================================================
# 2. MENA soft-flags
# ============================================================================
print("\n=== MENA Soft-Flags ===")
c = sqlite3.connect('file:db/price_history.db?mode=ro', uri=True)
cur = c.cursor()
cur.execute("SELECT COUNT(*) FROM price_history WHERE ticker='MENA' AND data_quality_flags = 'ANOMALY_MENA_OCT4_14'")
n = cur.fetchone()[0]
check(f'MENA rows flagged in price_history: {n}', n > 0, f'got {n}')

# Verify NOT deleted
cur.execute("SELECT COUNT(*) FROM price_history WHERE ticker='MENA' AND date BETWEEN '2026-10-04' AND '2026-10-14'")
n_total = cur.fetchone()[0]
check(f'MENA rows preserved (not deleted): {n_total}', n_total == n, f'{n_total} vs {n}')
c.close()

# ============================================================================
# 3. POUL/ORHD adjusted_entry_price
# ============================================================================
print("\n=== POUL/ORHD Adjustments ===")
c = sqlite3.connect('file:db/stocks.db?mode=ro', uri=True)
cur = c.cursor()
cur.execute("SELECT id, entry_price, adjusted_entry_price FROM radar_signal_tracking WHERE ticker='POUL'")
for r in cur.fetchall():
    check(f'POUL id={r[0]}: entry={r[1]} → adjusted={r[2]}', 
          r[2] is not None and abs(r[2] - round(r[1] * 0.2542, 2)) < 0.01,
          f'entry={r[1]}, adjusted={r[2]}')

cur.execute("SELECT id, entry_price, adjusted_entry_price FROM radar_signal_tracking WHERE ticker='ORHD' LIMIT 3")
for r in cur.fetchall():
    if r[2] is not None:
        check(f'ORHD id={r[0]}: entry={r[1]} → adjusted={r[2]}', 
              abs(r[2] - round(r[1] * 0.30967, 2)) < 0.01,
              f'entry={r[1]}, adjusted={r[2]}')
    else:
        check(f'ORHD id={r[0]}: adjusted_entry_price set', False, 'NULL')
c.close()

# ============================================================================
# 4. Oct 15 gap documented
# ============================================================================
print("\n=== Oct 15 Gap ===")
c = sqlite3.connect('file:db/stocks.db?mode=ro', uri=True)
cur = c.cursor()
cur.execute("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices WHERE price_date = '2026-10-15'")
n = cur.fetchone()[0]
check(f'Oct 15: {n} tickers have data (expected 0)', n == 0, f'got {n}')
c.close()

# ============================================================================
print(f"\n{'='*60}")
print(f"SUMMARY: {PASS} PASS, {FAIL} FAIL")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
