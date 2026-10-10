import sqlite3
import os

PROJECT_ROOT = "/home/meme/my_apps/GLMinvestment"
DB_DIR = os.path.join(PROJECT_ROOT, "db")

def check_news_db():
    print("=== 1. Checking news.db ===")
    conn = sqlite3.connect(os.path.join(DB_DIR, "news.db"))
    c = conn.cursor()
    c.execute("PRAGMA table_info('market_news')")
    cols = [r[1] for r in c.fetchall()]
    print("market_news columns:", cols)
    has_market_code = "market_code" in cols
    print("has market_code:", has_market_code)
    
    if "market" in cols:
        c.execute("SELECT market, count(*) FROM market_news GROUP BY market")
        print("market distribution:", c.fetchall())
    
    if has_market_code:
        c.execute("SELECT market_code, count(*) FROM market_news GROUP BY market_code")
        print("market_code distribution:", c.fetchall())
    conn.close()

def check_predictions_indexes():
    print("\n=== 2. Checking predictions.db indexes ===")
    conn = sqlite3.connect(os.path.join(DB_DIR, "predictions.db"))
    c = conn.cursor()
    c.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='predictions'")
    print("predictions indexes:", [r[0] for r in c.fetchall()])
    conn.close()

def check_news_agent():
    print("\n=== 3. Checking news-agent/main.py ===")
    main_py = os.path.join(PROJECT_ROOT, "news-agent", "main.py")
    if os.path.exists(main_py):
        with open(main_py, "r", encoding="utf-8") as f:
            lines = f.readlines()
        print(f"news-agent/main.py lines: {len(lines)}")
        has_while_true = any("while True" in line or "while true" in line for line in lines)
        print("news-agent/main.py has while True (daemon loop):", has_while_true)

if __name__ == "__main__":
    check_news_db()
    check_predictions_indexes()
    check_news_agent()
