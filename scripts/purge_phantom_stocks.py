#!/usr/bin/env python3
"""
purge_phantom_stocks.py — Purge corrupted phantom tickers from stocks.db & predictions.db
========================================================================================
Root cause:
  Historical scraping bugs entered phantom tickers into stocks.db (e.g. TAQATA, TWSATA,
  NNFCIE, OOCAPO, EGS65861C014) with distorted Arabic names ending in 'D'.
  The prediction engine saw these in stocks.db and generated predictions for them.

This script:
  1. Removes phantom tickers from stocks.db (stocks & stock_daily_prices tables).
  2. Removes phantom predictions from predictions.db.
  3. Safe and idempotent.
"""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = ROOT / "db" / "stocks.db"
PREDICTIONS_DB = ROOT / "db" / "predictions.db"

PHANTOM_TICKERS = [
    'TAQATA',       # Fake phantom of TAQA
    'TWSATA',       # Fake phantom of TWSA
    'NNFCIE',       # Fake phantom of NNFC
    'OOCAPO',       # Fake phantom of OOCAP
    'EGS65861C014', # ISIN code mistakenly entered as ticker
]

def purge_stocks():
    print(f"Connecting to {STOCKS_DB}...")
    conn = sqlite3.connect(STOCKS_DB)
    cur = conn.cursor()
    
    total_stocks_del = 0
    total_prices_del = 0
    
    for t in PHANTOM_TICKERS:
        cur.execute("DELETE FROM stocks WHERE ticker = ?", (t,))
        total_stocks_del += cur.rowcount
        
        cur.execute("DELETE FROM stock_daily_prices WHERE ticker = ?", (t,))
        total_prices_del += cur.rowcount
        
    conn.commit()
    conn.close()
    print(f"✅ Deleted {total_stocks_del} phantom stocks from stocks.db.stocks")
    print(f"✅ Deleted {total_prices_del} rows from stocks.db.stock_daily_prices")

def purge_predictions():
    print(f"Connecting to {PREDICTIONS_DB}...")
    conn = sqlite3.connect(PREDICTIONS_DB)
    cur = conn.cursor()
    
    total_preds_del = 0
    for t in PHANTOM_TICKERS:
        cur.execute("DELETE FROM predictions WHERE ticker = ?", (t,))
        total_preds_del += cur.rowcount
        
    conn.commit()
    conn.close()
    print(f"✅ Deleted {total_preds_del} phantom predictions from predictions.db.predictions")

if __name__ == '__main__':
    purge_stocks()
    purge_predictions()
    print("\n🎉 All phantom monstrosities permanently purged!")
