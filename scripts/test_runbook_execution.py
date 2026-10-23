import sqlite3
import os
import sys

# Add vps-service to sys.path
sys.path.insert(0, os.path.abspath('vps-service'))

print("=================================================================")
print("🧪 TESTING RUNBOOK STEP 2.2, 2.3, 2.4, 2.5 RESULTS")
print("=================================================================")

# 1. Step 2.2: Verify source_priority_cleaner status
print("\n[Step 2.2] source_priority_cleaner status:")
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn_ph = db_manager.connection('db/price_history.db', writable=False).__enter__()
multi = conn_ph.execute('SELECT COUNT(*) FROM (SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1)').fetchone()[0]
total_rows = conn_ph.execute('SELECT COUNT(*) FROM price_history').fetchone()[0]
print(f"  -> Multi-source tickers in price_history.db: {multi} (Target: 0)")
print(f"  -> Total price_history rows: {total_rows:,}")
conn_ph.close()

# 2. Step 2.3: Fix close column NULL
print("\n[Step 2.3] Fixing close column NULL in stocks.db:")
# Phase 7.1: migrated to db_manager (writable=True)
from core.db_manager import db_manager
conn_stocks = db_manager.connection('db/stocks.db', writable=True).__enter__()
updated = conn_stocks.execute("""
    UPDATE stocks SET close = current_price
    WHERE (close IS NULL OR close = 0) AND current_price > 0
""").rowcount
conn_stocks.commit()
still_null = conn_stocks.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0").fetchone()[0]
print(f"  -> Successfully updated: {updated} stocks.")
print(f"  -> Remaining NULL/0 close prices: {still_null}")
conn_stocks.close()

# 3. Step 2.4: Validation Layer Check
print("\n[Step 2.4] Testing Data Validation Layer on CRST (Bug Reproduction):")
from data.validation import validate_stock_data, summarize_validation
from data.source_authority import get_canonical_source, get_market_for_ticker

vd = validate_stock_data(
    ticker='CRST',
    current_price=3.02,
    high_52w=1.95,
    low_52w=0.99,
    support=158.73,
    resistance=137.97,
)
print(f"  -> CRST overall valid: {vd.is_valid_overall} (Expected: False due to price/52w/SR mismatch)")
print("  -> CRST findings:")
for f in vd.findings:
    print(f"     - Field: {f.field} | Status: {f.status} | Value: {f.value} | Reason: {f.reason}")

# 4. Check canonical sources
print("\n[Step 2.4b] Testing Canonical Source Authority:")
tickers_to_test = ['COMI', '2222', '101', 'QNBK', 'AAPL', 'BTC', 'GOLD']
for t in tickers_to_test:
    market = get_market_for_ticker(t)
    source = get_canonical_source(t)
    print(f"  Ticker {t:6s} -> Market: {market:8s} | Canonical Source: {source}")

# 5. Price Accuracy Comparison (EGX Stocks sample vs stocks.db)
print("\n[Step 2.5] Live EGX Stock Prices in stocks.db:")
# Phase 7.1: migrated to db_manager (writable=True)
from core.db_manager import db_manager
conn_stocks = db_manager.connection('db/stocks.db', writable=True).__enter__()
sample = ['COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY', 'EAST', 'TMGH', 'HELI']
for t in sample:
    row = conn_stocks.execute("SELECT ticker, name_ar, current_price, close, open_price, high_price, low_price, last_update FROM stocks WHERE ticker = ?", (t,)).fetchone()
    if row:
        print(f"  {row[0]:6s}: Price={row[2]} | Close={row[3]} | Open={row[4]} | High={row[5]} | Low={row[6]} | Updated={row[7]}")
conn_stocks.close()
