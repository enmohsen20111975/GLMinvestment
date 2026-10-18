#!/usr/bin/env python3
"""
Fix and complete Bravo database tasks:
1. stored_analyses schema migration in predictions.db (add persona, master_score).
2. Create news_signals view in news.db reflecting market_news.
3. Clean bad historical prices from stock_daily_prices in stocks.db.
"""
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

def fix_all():
    print("=== تنفيذ المهام الحقيقية على قواعد بيانات المشروع ===")

    # 1. predictions.db -> stored_analyses
    pred_db = PROJECT_ROOT / "db" / "predictions.db"
    if pred_db.exists():
        conn = sqlite3.connect(str(pred_db))
        c = conn.cursor()
        cols = [r[1] for r in c.execute("PRAGMA table_info(stored_analyses)").fetchall()]
        print(f"stored_analyses columns before: {cols}")
        
        if 'persona' not in cols:
            c.execute("ALTER TABLE stored_analyses ADD COLUMN persona TEXT DEFAULT 'balanced'")
            print("  + Added persona column")
        if 'master_score' not in cols:
            c.execute("ALTER TABLE stored_analyses ADD COLUMN master_score REAL")
            print("  + Added master_score column")
        conn.commit()
        conn.close()
        print("✅ predictions.db -> stored_analyses updated.")

    # 2. news.db -> news_signals view
    news_db = PROJECT_ROOT / "db" / "news.db"
    if news_db.exists():
        conn = sqlite3.connect(str(news_db))
        c = conn.cursor()
        c.execute("DROP VIEW IF EXISTS news_signals")
        c.execute("CREATE VIEW news_signals AS SELECT * FROM market_news")
        conn.commit()
        cnt = c.execute("SELECT COUNT(*) FROM news_signals").fetchone()[0]
        conn.close()
        print(f"✅ news.db -> news_signals view created with {cnt} rows.")

    # 3. stocks.db -> stock_daily_prices cleanup
    stocks_db = PROJECT_ROOT / "db" / "stocks.db"
    if stocks_db.exists():
        conn = sqlite3.connect(str(stocks_db))
        c = conn.cursor()
        bad_cnt = c.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE close_price <= 0 OR close_price IS NULL OR close <= 0 OR close IS NULL").fetchone()[0]
        print(f"stock_daily_prices bad rows count: {bad_cnt}")
        if bad_cnt > 0:
            res = c.execute("DELETE FROM stock_daily_prices WHERE close_price <= 0 OR close_price IS NULL OR close <= 0 OR close IS NULL")
            conn.commit()
            print(f"  + Deleted {res.rowcount} bad rows from stock_daily_prices.")
        conn.close()
        print("✅ stocks.db -> stock_daily_prices cleaned.")

if __name__ == '__main__':
    fix_all()
