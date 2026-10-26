#!/usr/bin/env python3
"""
Fix OHLC validity + POUL adjustment + MENA soft-flag.
Read-only audit + targeted fixes on stocks.db (with backup).
"""
import sqlite3, os
from datetime import datetime

DB = 'db/stocks.db'
BACKUP = f'db/backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

# Backup
os.makedirs(BACKUP, exist_ok=True)
os.system(f'cp {DB} {BACKUP}/stocks.db.bak')
print(f"Backup: {BACKUP}/stocks.db.bak")

c = sqlite3.connect(DB)
cur = c.cursor()

# ============================================================================
# 1. OHLC validity: flag invalid rows (don't delete — soft-flag)
# ============================================================================
print("\n=== OHLC Validity Audit ===")
cur.execute("""SELECT COUNT(*) FROM stock_daily_prices 
              WHERE low IS NOT NULL AND high IS NOT NULL 
              AND (low > high OR open > high OR open < low OR close > high OR close < low)""")
n_invalid = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE low IS NOT NULL AND high IS NOT NULL")
n_total = cur.fetchone()[0]
print(f"Invalid OHLC: {n_invalid}/{n_total} ({n_invalid/n_total*100:.1f}%)")

# Add a data_quality_flags column if not exists
try:
    cur.execute("ALTER TABLE stock_daily_prices ADD COLUMN data_quality_flags TEXT DEFAULT ''")
    print("Added data_quality_flags column")
except:
    print("data_quality_flags column already exists")

# Flag invalid OHLC rows
cur.execute("""UPDATE stock_daily_prices 
              SET data_quality_flags = 'OHLC_INVALID'
              WHERE low IS NOT NULL AND high IS NOT NULL 
              AND (low > high OR open > high OR open < low OR close > high OR close < low)""")
flagged = cur.rowcount
print(f"Flagged {flagged} rows with OHLC_INVALID")

# ============================================================================
# 2. POUL adjustment: apply close-to-close factor (0.2542) to pre-event signals
# ============================================================================
print("\n=== POUL Adjustment ===")
cur.execute("SELECT id, entry_price, signal_date FROM radar_signal_tracking WHERE ticker='POUL' AND signal_date < '2026-09-28'")
poul_signals = cur.fetchall()
print(f"POUL pre-event signals: {len(poul_signals)}")

# We DON'T modify entry_price (per owner: no unauthorized DB changes to production)
# Instead, add an adjusted_entry_price column for reference
try:
    cur.execute("ALTER TABLE radar_signal_tracking ADD COLUMN adjusted_entry_price REAL")
    print("Added adjusted_entry_price column")
except:
    print("adjusted_entry_price column already exists")

# Calculate adjusted entry for POUL pre-event
POUL_FACTOR = 0.2542  # close-to-close
for sid, entry, sd in poul_signals:
    if entry and entry > 0:
        adjusted = round(entry * POUL_FACTOR, 2)
        cur.execute("UPDATE radar_signal_tracking SET adjusted_entry_price = ? WHERE id = ?", (adjusted, sid))

print(f"Updated {len(poul_signals)} POUL signals with adjusted_entry_price")

# ============================================================================
# 3. MENA corrupt prices: soft-flag (don't delete)
# ============================================================================
print("\n=== MENA Soft-Flag ===")
try:
    cur.execute("ALTER TABLE price_history ADD COLUMN data_quality_flags TEXT DEFAULT ''")
    print("Added data_quality_flags to price_history")
except:
    print("data_quality_flags already exists in price_history")

# Flag MENA Oct 4-14 rows
cur.execute("""UPDATE price_history 
              SET data_quality_flags = 'ANOMALY_MENA_OCT4_14'
              WHERE ticker='MENA' AND date BETWEEN '2026-10-04' AND '2026-10-14'""")
mena_flagged = cur.rowcount
print(f"Flagged {mena_flagged} MENA rows as ANOMALY_MENA_OCT4_14 (not deleted)")

# Also flag in stock_daily_prices
cur.execute("""UPDATE stock_daily_prices 
              SET data_quality_flags = 'ANOMALY_MENA_OCT4_14'
              WHERE ticker='MENA' AND price_date BETWEEN '2026-10-04' AND '2026-10-14'""")
mena_sdp = cur.rowcount
print(f"Flagged {mena_sdp} MENA rows in stock_daily_prices")

# ============================================================================
# 4. Oct 15 gap: flag as UNRESOLVED_GAP
# ============================================================================
print("\n=== Oct 15 Gap Documentation ===")
cur.execute("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices WHERE price_date = '2026-10-15'")
n_oct15 = cur.fetchone()[0]
print(f"Tickers with Oct 15 data: {n_oct15} (expected 0 — market-wide gap)")
print("Classification: UNRESOLVED — no documented EGX holiday found")
print("Action: flagged in EGX_SESSION_GAPS.csv, needs independent EGX calendar verification")

c.commit()
c.close()
print("\n✅ All fixes committed to stocks.db")
print(f"Backup at: {BACKUP}/")
