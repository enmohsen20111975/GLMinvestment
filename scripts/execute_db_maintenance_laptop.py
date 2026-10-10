import sqlite3
import os
import shutil
from datetime import datetime

PROJECT_ROOT = "/home/meme/my_apps/GLMinvestment"
DB_DIR = os.path.join(PROJECT_ROOT, "db")
TODAY = datetime.now().strftime("%Y%m%d")

def backup_databases():
    print("=== 1. CREATING BACKUPS ===")
    targets = ["predictions.db", "stocks.db", "news.db", "auth.db"]
    for t in targets:
        src = os.path.join(DB_DIR, t)
        if os.path.exists(src):
            dst = os.path.join(DB_DIR, f"{t}.backup-{TODAY}")
            shutil.copy2(src, dst)
            print(f"  [OK] Backed up {t} -> {dst} ({os.path.getsize(dst):,} bytes)")
        else:
            print(f"  [SKIP] {t} does not exist")

def cleanup_duplicate_tables():
    print("\n=== 2. CLEANING UP DUPLICATE / OBSOLETE TABLES ===")
    
    # 2.1 predictions.db
    p_path = os.path.join(DB_DIR, "predictions.db")
    if os.path.exists(p_path):
        conn = sqlite3.connect(p_path)
        cur = conn.cursor()
        
        # Check aiPrediction
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='aiPrediction'")
        if cur.fetchone():
            cnt = cur.execute("SELECT count(*) FROM aiPrediction").fetchone()[0]
            print(f"  Found aiPrediction ({cnt} rows). Archiving to aiPrediction_archive...")
            cur.execute("CREATE TABLE IF NOT EXISTS aiPrediction_archive AS SELECT * FROM aiPrediction;")
            cur.execute("DROP TABLE IF EXISTS aiPrediction;")
            conn.commit()
            print("  [OK] Dropped aiPrediction table (archived in aiPrediction_archive)")
        else:
            print("  aiPrediction table does not exist in predictions.db")
        
        conn.close()

    # 2.2 stocks.db
    s_path = os.path.join(DB_DIR, "stocks.db")
    if os.path.exists(s_path):
        conn = sqlite3.connect(s_path)
        cur = conn.cursor()
        for tbl in ["predictions", "prediction_logs", "stocks_backup"]:
            cur.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{tbl}'")
            if cur.fetchone():
                cnt = cur.execute(f'SELECT count(*) FROM "{tbl}"').fetchone()[0]
                cur.execute(f'DROP TABLE IF EXISTS "{tbl}";')
                print(f"  [OK] Dropped stocks.db.{tbl} (had {cnt} rows)")
            else:
                print(f"  stocks.db.{tbl} does not exist (already clean)")
        conn.commit()
        conn.close()

    # 2.3 news.db
    n_path = os.path.join(DB_DIR, "news.db")
    if os.path.exists(n_path):
        conn = sqlite3.connect(n_path)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news_articles'")
        if cur.fetchone():
            cnt = cur.execute("SELECT count(*) FROM news_articles").fetchone()[0]
            cur.execute("DROP TABLE IF EXISTS news_articles;")
            print(f"  [OK] Dropped news.db.news_articles (had {cnt} rows)")
        else:
            print("  news.db.news_articles does not exist (already clean)")
        conn.commit()
        conn.close()

    # 2.4 custom.db
    for root, dirs, files in os.walk(PROJECT_ROOT):
        for f in files:
            if f == "custom.db":
                fp = os.path.join(root, f)
                os.remove(fp)
                print(f"  [OK] Removed custom.db at {fp}")

def create_indexes():
    print("\n=== 3. CREATING PERFORMANCE INDEXES ===")
    
    # 3.1 data_engine.db
    de_path = os.path.join(DB_DIR, "data_engine.db")
    if os.path.exists(de_path):
        conn = sqlite3.connect(de_path)
        cur = conn.cursor()
        indexes_de = [
            ("idx_crypto_prices_symbol", "CREATE INDEX IF NOT EXISTS idx_crypto_prices_symbol ON crypto_prices(symbol);"),
            ("idx_gold_prices_timestamp", "CREATE INDEX IF NOT EXISTS idx_gold_prices_timestamp ON gold_prices(timestamp);"),
            ("idx_historical_data_symbol", "CREATE INDEX IF NOT EXISTS idx_historical_data_symbol ON historical_data(symbol);"),
            ("idx_exchange_rates_currency", "CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency);"),
            ("idx_stocks_symbol", "CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol);")
        ]
        for idx_name, sql in indexes_de:
            print(f"  Applying {idx_name} on data_engine.db...")
            cur.execute(sql)
            print(f"  [OK] {idx_name}")
        conn.commit()
        conn.close()

    # 3.2 stocks.db
    s_path = os.path.join(DB_DIR, "stocks.db")
    if os.path.exists(s_path):
        conn = sqlite3.connect(s_path)
        cur = conn.cursor()
        indexes_s = [
            ("idx_stocks_ticker", "CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker);"),
            ("idx_stock_daily_prices_ticker", "CREATE INDEX IF NOT EXISTS idx_stock_daily_prices_ticker ON stock_daily_prices(ticker);"),
            ("idx_outcome_logs_trade_id", "CREATE INDEX IF NOT EXISTS idx_outcome_logs_trade_id ON outcome_logs(trade_id);"),
            ("idx_outcome_logs_close_date", "CREATE INDEX IF NOT EXISTS idx_outcome_logs_close_date ON outcome_logs(close_date);")
        ]
        for idx_name, sql in indexes_s:
            print(f"  Applying {idx_name} on stocks.db...")
            cur.execute(sql)
            print(f"  [OK] {idx_name}")
        conn.commit()
        conn.close()

def vacuum_databases():
    print("\n=== 4. VACUUM DATABASES ===")
    for db_name in ["predictions.db", "stocks.db", "news.db", "data_engine.db"]:
        path = os.path.join(DB_DIR, db_name)
        if os.path.exists(path):
            print(f"  Vacuuming {db_name}...")
            conn = sqlite3.connect(path)
            conn.execute("VACUUM;")
            conn.close()
            print(f"  [OK] {db_name} vacuumed successfully")

if __name__ == "__main__":
    backup_databases()
    cleanup_duplicate_tables()
    create_indexes()
    vacuum_databases()
    print("\n=== ALL DATABASE TASKS COMPLETED SUCCESSFULLY ===")
