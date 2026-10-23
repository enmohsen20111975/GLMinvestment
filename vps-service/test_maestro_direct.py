import sys
import os
import sqlite3

# Add current directory to path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from analyzers.unified_maestro import UnifiedMaestroEngine

db_path = os.path.abspath(os.path.dirname(__file__) + '/../db/stocks.db')
engine = UnifiedMaestroEngine(db_path)

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.get_connection(db_path, writable=False)
c = conn.cursor()
c.execute("SELECT ticker FROM stocks WHERE current_price > 0 AND (market = 'EGX' OR market IS NULL) ORDER BY volume DESC LIMIT 10")
tickers = [r[0] for r in c.fetchall()]
conn.close()

print("Top 10 EGX Stocks Analysis:")
for t in tickers:
    try:
        res = engine.analyze(t, 'EGX')
        if res:
            print(f"  Ticker: {t:8} | Score: {res.score:5.1f} | Signal: {res.signal:12} | Regime: {res.market_regime:8} | Close: {res.current_price}")
        else:
            print(f"  Ticker: {t:8} | None returned")
    except Exception as e:
        print(f"  Ticker: {t:8} | Error: {e}")
