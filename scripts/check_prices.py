#!/usr/bin/env python3
import sqlite3
from pathlib import Path

DB_DIR = Path('db')

print("\n--- 1. stocks.db (Live Prices) ---")
conn = sqlite3.connect(DB_DIR / 'stocks.db')
conn.row_factory = sqlite3.Row
for ticker in ['BONY', 'COMI', 'BIOC', 'AMER', 'JUFO']:
    row = conn.execute("SELECT ticker, current_price, previous_close, change_percent, last_update FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
    if row:
        print(f"{row['ticker']:6s} | current={row['current_price']:>10.2f} | prev={row['previous_close'] or 0:>10.2f} | chg={row['change_percent'] or 0:>6.2f}% | last_update={row['last_update']}")
    else:
        print(f"{ticker:6s} | NOT FOUND in stocks table")

print("\n--- 2. price_history.db (Historical Data) ---")
try:
    conn_ph = sqlite3.connect(DB_DIR / 'price_history.db')
    tables = conn_ph.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    print(f"Tables: {tables}")
    if tables:
        for t in tables:
            count = conn_ph.execute(f"SELECT count(*) FROM {t[0]}").fetchone()[0]
            print(f"  {t[0]}: {count} rows")
            if count > 0:
                sample = conn_ph.execute(f"SELECT * FROM {t[0]} ORDER BY date DESC LIMIT 3").fetchall()
                for s in sample:
                    print(f"    {dict(s) if hasattr(s, 'keys') else s}")
except Exception as e:
    print(f"❌ price_history.db error: {e}")

print("\n--- 3. predictions.db (BONY outcome check) ---")
conn_pred = sqlite3.connect(DB_DIR / 'predictions.db')
conn_pred.row_factory = sqlite3.Row
preds = conn_pred.execute("SELECT ticker, signal, entry_price, target_price, stop_loss, hit_target, hit_stop, actual_return, outcome_date FROM predictions WHERE ticker IN ('BONY', 'AMER', 'BIOC') ORDER BY prediction_date DESC LIMIT 10").fetchall()
for p in preds:
    print(f"{p['ticker']:6s} | signal={p['signal']:12s} | entry={p['entry_price']:>8.2f} | target={p['target_price'] or 0:>8.2f} | hit_target={p['hit_target']} | return={p['actual_return'] or 0:>6.2f}%")
