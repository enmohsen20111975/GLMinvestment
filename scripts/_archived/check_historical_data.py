#!/usr/bin/env python3
"""Check available historical data in data_engine.db"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'data_engine.db')

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

print("=" * 80)
print("HISTORICAL DATA SUMMARY")
print("=" * 80)

# Date range per market
c.execute('''
    SELECT MIN(date) as min_date, MAX(date) as max_date, 
           COUNT(*) as total_records, market, 
           COUNT(DISTINCT symbol) as stocks 
    FROM historical_data 
    GROUP BY market 
    ORDER BY market
''')
for row in c.fetchall():
    print(f"  {row[3]:15s}: {row[0]} to {row[1]} | {row[2]:>8,} records | {row[4]:>4} stocks")

# Check if we have data from Jan 2026
print("\n" + "=" * 80)
print("DATA FROM JAN 2026")
print("=" * 80)
c.execute('''
    SELECT market, COUNT(DISTINCT symbol), COUNT(*), MIN(date), MAX(date)
    FROM historical_data 
    WHERE date >= '2026-01-01'
    GROUP BY market
''')
rows = c.fetchall()
if rows:
    for row in rows:
        print(f"  {row[0]:15s}: {row[3]} to {row[4]} | {row[2]:>8,} records | {row[1]:>4} stocks")
else:
    print("  NO DATA from Jan 2026!")

# Check tab_technical_analysis
print("\n" + "=" * 80)
print("TAB_TECHNICAL_ANALYSIS")
print("=" * 80)
try:
    c.execute('SELECT COUNT(*) FROM tab_technical_analysis')
    total = c.fetchone()[0]
    print(f"  Total records: {total}")
    
    c.execute('SELECT technical_rating, COUNT(*) FROM tab_technical_analysis GROUP BY technical_rating ORDER BY COUNT(*) DESC LIMIT 10')
    for row in c.fetchall():
        print(f"  {str(row[0]):30s}: {row[1]}")
except Exception as e:
    print(f"  Error: {e}")

# Check tab_valuation
print("\n" + "=" * 80)
print("TAB_VALUATION")
print("=" * 80)
try:
    c.execute('SELECT COUNT(*) FROM tab_valuation')
    total = c.fetchone()[0]
    print(f"  Total records: {total}")
    
    c.execute('SELECT COUNT(*) FROM tab_valuation WHERE pe_ratio IS NOT NULL AND pe_ratio != ""')
    with_pe = c.fetchone()[0]
    print(f"  With PE ratio: {with_pe}")
except Exception as e:
    print(f"  Error: {e}")

# Check tab_profitability
print("\n" + "=" * 80)
print("TAB_PROFITABILITY")
print("=" * 80)
try:
    c.execute('SELECT COUNT(*) FROM tab_profitability')
    total = c.fetchone()[0]
    print(f"  Total records: {total}")
    
    c.execute('SELECT COUNT(*) FROM tab_profitability WHERE roe IS NOT NULL AND roe != ""')
    with_roe = c.fetchone()[0]
    print(f"  With ROE: {with_roe}")
except Exception as e:
    print(f"  Error: {e}")

# Sample stock data
print("\n" + "=" * 80)
print("SAMPLE STOCKS (first 5)")
print("=" * 80)
c.execute('SELECT symbol, name, price, change_percent, market FROM stocks LIMIT 5')
for row in c.fetchall():
    print(f"  {row[0]:10s} | {row[1]:30s} | Price: {row[2]} | Change: {row[3]}% | Market: {row[4]}")

# Markets distribution
print("\n" + "=" * 80)
print("MARKETS DISTRIBUTION IN STOCKS TABLE")
print("=" * 80)
c.execute('SELECT market, COUNT(*) FROM stocks GROUP BY market ORDER BY COUNT(*) DESC')
for row in c.fetchall():
    print(f"  {str(row[0]):20s}: {row[1]} stocks")

conn.close()