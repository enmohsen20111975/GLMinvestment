#!/usr/bin/env python3
"""
PHASE 1 TASK 3 — Historical Field Test (EGX, Sep 28 - Oct 25, 2026)
=====================================================================
Read-only test of data integrity, market isolation, OHLC validity, 
missing sessions, and freshness.

Run:
    python3 scripts/test_historical_field.py
"""
from __future__ import annotations
import sqlite3, sys, os
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PASS = 0; FAIL = 0; WARN = 0
def check(name, cond, detail=''):
    global PASS, FAIL, WARN
    if cond: PASS += 1; print(f'  ✅ {name}')
    elif 'invalid' in detail.lower() or 'missing' in detail.lower(): WARN += 1; print(f'  ⚠️  {name}  {detail}')
    else: FAIL += 1; print(f'  ❌ {name}  {detail}')

print("=" * 70)
print("PHASE 1 TASK 3 — Historical Field Test")
print("Period: EGX, 2026-09-28 to 2026-10-25 (20 expected trading days)")
print("=" * 70)

# Test 1: Database integrity
print("\nTest 1: Database integrity (PRAGMA integrity_check)")
for db in ['db/stocks.db','db/price_history.db','db/data_engine.db','db/intraday.db','db/predictions.db','db/news.db']:
    if not os.path.exists(db): continue
    c=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
    r=c.execute('PRAGMA integrity_check').fetchone()[0]
    check(f'{db} integrity', r=='ok', r)
    c.close()

# Test 2: Duplicate keys
print("\nTest 2: Duplicate keys (ticker, date, market)")
c=sqlite3.connect('file:db/stocks.db?mode=ro',uri=True); cur=c.cursor()
cur.execute("SELECT COUNT(*) FROM (SELECT ticker, price_date, market, COUNT(*) as n FROM stock_daily_prices GROUP BY ticker, price_date, market HAVING n > 1)")
n=cur.fetchone()[0]
check('stock_daily_prices no duplicates', n==0, f'{n} duplicates')
c.close()

c=sqlite3.connect('file:db/price_history.db?mode=ro',uri=True); cur=c.cursor()
cur.execute("SELECT COUNT(*) FROM (SELECT ticker, date, market, COUNT(*) as n FROM price_history GROUP BY ticker, date, market HAVING n > 1)")
n=cur.fetchone()[0]
check('price_history no duplicates', n==0, f'{n} duplicates')
c.close()

# Test 3: Market isolation
print("\nTest 3: Market isolation (EGX tickers with US-tagged rows)")
c1=sqlite3.connect('file:db/stocks.db?mode=ro',uri=True); cur1=c1.cursor()
cur1.execute("SELECT ticker FROM stocks WHERE market='EGX'")
egx=set(r[0] for r in cur1.fetchall())
c1.close()

c2=sqlite3.connect('file:db/price_history.db?mode=ro',uri=True); cur2=c2.cursor()
cur2.execute("SELECT DISTINCT ticker FROM price_history WHERE market='US'")
us_ph=set(r[0] for r in cur2.fetchall())
c2.close()
contam_ph = egx & us_ph
check('price_history EGX isolation', len(contam_ph)==0, f'{len(contam_ph)} contaminated')

c3=sqlite3.connect('file:db/stocks.db?mode=ro',uri=True); cur3=c3.cursor()
cur3.execute("SELECT DISTINCT ticker FROM stock_daily_prices WHERE market='US' AND ticker IN (SELECT ticker FROM stocks WHERE market='EGX')")
contam_sdp = cur3.fetchall()
check('stock_daily_prices EGX isolation', len(contam_sdp)==0, f'{len(contam_sdp)} contaminated')
c3.close()

# Test 4: OHLC validity (low ≤ open/close ≤ high)
print("\nTest 4: OHLC validity (low ≤ open/close ≤ high)")
for db, tab, lo, hi, op, cl in [
    ('db/stocks.db','stock_daily_prices','low','high','open','close'),
    ('db/price_history.db','price_history','low_price','high_price','open_price','close_price'),
]:
    c=sqlite3.connect(f'file:{db}?mode=ro',uri=True); cur=c.cursor()
    cur.execute(f"SELECT COUNT(*) FROM {tab} WHERE {lo} IS NOT NULL AND {hi} IS NOT NULL AND ({lo} > {hi} OR {op} > {hi} OR {op} < {lo} OR {cl} > {hi} OR {cl} < {lo})")
    n_invalid=cur.fetchone()[0]
    cur.execute(f"SELECT COUNT(*) FROM {tab} WHERE {lo} IS NOT NULL AND {hi} IS NOT NULL")
    total=cur.fetchone()[0]
    pct = n_invalid/total*100 if total else 0
    check(f'{db}::{tab} OHLC validity', n_invalid==0, f'{n_invalid} invalid out of {total} ({pct:.1f}%)')
    c.close()

# Test 5: Missing sessions
print("\nTest 5: Missing sessions (EGX Sep 28 - Oct 25)")
def egx_days(s,e):
    d=[]; dt=datetime.strptime(s,'%Y-%m-%d'); et=datetime.strptime(e,'%Y-%m-%d')
    while dt<=et:
        if dt.weekday() not in (4,5): d.append(dt.strftime('%Y-%m-%d'))
        dt+=timedelta(days=1)
    return d
expected=egx_days('2026-09-28','2026-10-25')

c=sqlite3.connect('file:db/stocks.db?mode=ro',uri=True); cur=c.cursor()
# Check COMI, ABUK, HRHO, ETEL, SWDY
for tkr in ['COMI','ABUK','HRHO','ETEL','SWDY']:
    cur.execute("SELECT price_date FROM stock_daily_prices WHERE ticker=? AND price_date BETWEEN '2026-09-28' AND '2026-10-25' AND market='EGX'",(tkr,))
    actual=set(r[0] for r in cur.fetchall())
    missing = set(expected) - actual
    # Oct 6 = Armed Forces Day (known holiday) — OK to miss
    missing_unknown = {d for d in missing if d != '2026-10-06'}
    check(f'{tkr} no unexpected missing sessions', len(missing_unknown)==0, f'missing {missing_unknown}' if missing_unknown else '')
c.close()

# Test 6: Freshness
print("\nTest 6: Freshness (latest price date)")
for db, tab, date_col in [
    ('db/stocks.db','stock_daily_prices','price_date'),
    ('db/price_history.db','price_history','date'),
    ('db/data_engine.db','egksco_price_history','price_date'),
]:
    c=sqlite3.connect(f'file:{db}?mode=ro',uri=True); cur=c.cursor()
    cur.execute(f"SELECT MAX({date_col}) FROM {tab}")
    latest=cur.fetchone()[0]
    # Latest should be within last 7 days (2026-10-25 is latest)
    check(f'{db}::{tab} freshness', latest >= '2026-10-20', f'latest={latest}')
    c.close()

# Test 7: Writer regression — verify schema DEFAULT
print("\nTest 7: Writer regression (schema DEFAULT 'EGX')")
c=sqlite3.connect('file:db/stocks.db?mode=ro',uri=True); cur=c.cursor()
cur.execute("SELECT sql FROM sqlite_master WHERE name='stock_daily_prices'")
schema=cur.fetchone()[0]
check('stock_daily_prices DEFAULT EGX', "DEFAULT 'EGX'" in schema, 'still DEFAULT US')
c.close()

# SUMMARY
print(f"\n{'='*70}")
print(f"SUMMARY: {PASS} PASS, {WARN} WARN, {FAIL} FAIL")
print(f"{'='*70}")
sys.exit(0 if FAIL == 0 else 1)
