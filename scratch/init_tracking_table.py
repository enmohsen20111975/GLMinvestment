import sqlite3
import sys

def init_db():
    try:
        conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db', timeout=30.0)
        
        print("Creating table...")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS hunter_pick_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                market TEXT NOT NULL,
                entry_price REAL NOT NULL,
                stop_loss REAL NOT NULL,
                target_price REAL NOT NULL,
                risk_reward REAL NOT NULL,
                pick_date TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                current_price REAL,
                verification_date TEXT,
                profit_loss_pct REAL,
                narrative TEXT,
                personas TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_hpt_ticker_date
            ON hunter_pick_tracking(ticker, pick_date)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_hpt_market_status
            ON hunter_pick_tracking(market, status)
        """)
        conn.commit()
        print("Table created.")
        
    except Exception as e:
        print("Error:", e)
        sys.exit(1)

init_db()
