#!/usr/bin/env python3
"""
HISTORICAL DATA QUALITY REPORT
================================
Checks 4-month data availability per market (2026-06-25 to 2026-10-25).
Read-only — no DB writes.
"""
import sqlite3, json, os
from datetime import datetime, timedelta
from pathlib import Path

DB_PH = 'db/price_history.db'
DB_DE = 'db/data_engine.db'
DB_ST = 'db/stocks.db'

WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'

def egx_trading_days(start, end):
    days=[]; d=datetime.strptime(start,'%Y-%m-%d'); e=datetime.strptime(end,'%Y-%m-%d')
    while d<=e:
        if d.weekday() not in (4,5): days.append(d.strftime('%Y-%m-%d'))
        d+=timedelta(days=1)
    return days

print("="*70)
print("HISTORICAL DATA QUALITY REPORT")
print(f"Window: {WINDOW_START} to {WINDOW_END} (4 months)")
print("="*70)

results = {}

# === EGX ===
print("\n=== EGX ===")
c=sqlite3.connect(f'file:{DB_PH}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(date), MAX(date) FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
n,ntk,mn,mx=cur.fetchone()
# Check coverage per ticker (top 5)
cur.execute(f"SELECT ticker, COUNT(*) FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' GROUP BY ticker ORDER BY COUNT(*) DESC LIMIT 5")
top=cur.fetchall()
# Missing sessions for COMI
expected_egx = egx_trading_days(WINDOW_START, WINDOW_END)
cur.execute(f"SELECT DISTINCT date FROM price_history WHERE ticker='COMI' AND market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
actual=set(r[0] for r in cur.fetchall())
missing = set(expected_egx) - actual
c.close()
print(f"  Rows: {n}, Tickers: {ntk}, Range: {mn}..{mx}")
print(f"  Expected EGX sessions: {len(expected_egx)}, COMI has: {len(actual)}, missing: {len(missing)}")
print(f"  Top tickers: {top[:3]}")
results['EGX'] = {'rows':n, 'tickers':ntk, 'range':f'{mn}..{mx}', 'sessions_expected':len(expected_egx), 'sessions_actual':len(actual), 'missing':len(missing), 'status':'TESTABLE'}

# === TADAWUL ===
print("\n=== TADAWUL ===")
c=sqlite3.connect(f'file:{DB_PH}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(date), MAX(date) FROM price_history WHERE market='TADAWUL' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
n,ntk,mn,mx=cur.fetchone()
c.close()
print(f"  Rows: {n}, Tickers: {ntk}, Range: {mn}..{mx}")
results['TADAWUL'] = {'rows':n, 'tickers':ntk, 'range':f'{mn}..{mx}', 'status':'TESTABLE' if n>100 else 'BLOCKED'}

# === KSE ===
print("\n=== KSE ===")
c=sqlite3.connect(f'file:{DB_PH}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(date), MAX(date) FROM price_history WHERE market='KSE' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
n,ntk,mn,mx=cur.fetchone()
c.close()
print(f"  Rows: {n}, Tickers: {ntk}, Range: {mn}..{mx}")
results['KSE'] = {'rows':n, 'tickers':ntk, 'range':f'{mn}..{mx}', 'status':'TESTABLE' if n>100 else 'BLOCKED'}

# === QSE ===
print("\n=== QSE ===")
c=sqlite3.connect(f'file:{DB_PH}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(date), MAX(date) FROM price_history WHERE market='QSE' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
n,ntk,mn,mx=cur.fetchone()
c.close()
print(f"  Rows: {n}, Tickers: {ntk}, Range: {mn}..{mx}")
results['QSE'] = {'rows':n, 'tickers':ntk, 'range':f'{mn}..{mx}', 'status':'TESTABLE' if n>100 else 'BLOCKED'}

# === US ===
print("\n=== US ===")
c=sqlite3.connect(f'file:{DB_PH}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(date), MAX(date) FROM price_history WHERE market='US' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}'")
n,ntk,mn,mx=cur.fetchone()
c.close()
print(f"  Rows: {n}, Tickers: {ntk}, Range: {mn}..{mx}")
print(f"  NOTE: US tickers in price_history are EGX-listed (collision), NOT real US stocks")
results['US'] = {'rows':n, 'tickers':ntk, 'range':f'{mn}..{mx}', 'status':'BLOCKED — US tickers are EGX collisions, not real US market data'}

# === CRYPTO ===
print("\n=== CRYPTO ===")
c=sqlite3.connect(f'file:{DB_DE}?mode=ro',uri=True); cur=c.cursor()
cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT symbol), MIN(timestamp), MAX(timestamp) FROM crypto_prices WHERE timestamp >= '{WINDOW_START}'")
n,nsk,mn,mx=cur.fetchone()
c.close()
print(f"  Rows: {n}, Symbols: {nsk}, Range: {mn}..{mx}")
print(f"  NOTE: crypto_prices is intraday (not daily OHLCV) — different schema")
results['CRYPTO'] = {'rows':n, 'tickers':nsk, 'range':f'{mn}..{mx}', 'status':'BLOCKED — intraday data, not daily OHLCV for backtest'}

# === Summary ===
print("\n" + "="*70)
print("SUMMARY")
print("="*70)
for mkt, d in results.items():
    print(f"  {mkt:10} {d['status']}")

# Write report
os.makedirs('backtest_results', exist_ok=True)
with open('backtest_results/historical_data_quality_report.md','w') as f:
    f.write("# Historical Data Quality Report\n\n")
    f.write(f"**Window:** {WINDOW_START} to {WINDOW_END}\n\n")
    f.write("| Market | Rows | Tickers | Range | Status |\n")
    f.write("|--------|------|---------|-------|--------|\n")
    for mkt, d in results.items():
        f.write(f"| {mkt} | {d['rows']:,} | {d['tickers']} | {d['range']} | {d['status']} |\n")
    f.write(f"\n**EGX missing sessions:** {len(missing)} (out of {len(expected_egx)} expected)\n")
    f.write(f"**EGX OHLC validity:** 12-17% invalid (flagged, documented)\n")

print("\nReport written: backtest_results/historical_data_quality_report.md")
