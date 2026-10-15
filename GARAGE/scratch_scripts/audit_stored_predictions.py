import sqlite3
import os

dbs = [
    "/home/meme/my_apps/GLMinvestment/db/predictions.db",
    "/home/meme/my_apps/GLMinvestment/db/stocks.db"
]

portfolio_tickers = ["EGREF", "CCRS", "UEGC", "NIPH"]

for db_path in dbs:
    if not os.path.exists(db_path):
        continue
    print(f"\n================ DB: {db_path} ================")
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print("Tables:", tables)
    
    for t in ["predictions", "stored_analyses", "ExpertRecommendation", "real_evaluated_predictions"]:
        if t in tables:
            cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})").fetchall()]
            print(f"\n--- Checking table {t} ---")
            for ticker in portfolio_tickers:
                try:
                    q = f"SELECT * FROM {t} WHERE ticker = ? ORDER BY 1 DESC LIMIT 1"
                    row = c.execute(q, (ticker,)).fetchone()
                    if row:
                        res = dict(zip(cols, row))
                        # Print relevant fields
                        sub = {k: res[k] for k in ["ticker", "signal", "recommendation", "target_price", "stop_loss", "entry_price", "created_at", "updated_at", "confidence"] if k in res}
                        print(f"  [{ticker}]: {sub}")
                except Exception as e:
                    print(f"Error for {ticker} in {t}: {e}")
