import os
import shutil
import sqlite3
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(BASE_DIR, "db")
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

print(f"Starting safe database maintenance at {timestamp}...")

# 1. NEWS.DB
news_db_path = os.path.join(DB_DIR, "news.db")
news_backup = os.path.join(DB_DIR, f"news.db.backup_{timestamp}")
shutil.copy2(news_db_path, news_backup)
print(f"✓ Backup created: {news_backup}")

conn_news = sqlite3.connect(news_db_path)
cur_news = conn_news.cursor()

# Check if market_code column exists
cur_news.execute("PRAGMA table_info(market_news)")
cols = [r[1] for r in cur_news.fetchall()]
if "market_code" not in cols:
    cur_news.execute("ALTER TABLE market_news ADD COLUMN market_code TEXT;")
    print("✓ Added column market_code to market_news")
else:
    print("• Column market_code already exists")

# Populate market_code where NULL
cur_news.execute("UPDATE market_news SET market_code = market WHERE market_code IS NULL;")
updated_rows = cur_news.rowcount
print(f"✓ Updated {updated_rows} rows in market_news setting market_code = market")

# Create index on market_code
cur_news.execute("CREATE INDEX IF NOT EXISTS idx_market_news_market_code ON market_news(market_code);")
print("✓ Created index idx_market_news_market_code")

# Drop duplicate empty table news_articles if exists and empty
cur_news.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='news_articles'")
if cur_news.fetchone()[0] > 0:
    cur_news.execute("SELECT count(*) FROM news_articles")
    cnt = cur_news.fetchone()[0]
    if cnt == 0:
        cur_news.execute("DROP TABLE IF EXISTS news_articles;")
        print("✓ Dropped empty duplicate table news_articles")
    else:
        print(f"⚠️ Table news_articles has {cnt} rows, not dropping!")

conn_news.commit()
conn_news.close()

# 2. PREDICTIONS.DB
pred_db_path = os.path.join(DB_DIR, "predictions.db")
pred_backup = os.path.join(DB_DIR, f"predictions.db.backup_{timestamp}")
shutil.copy2(pred_db_path, pred_backup)
print(f"✓ Backup created: {pred_backup}")

conn_pred = sqlite3.connect(pred_db_path)
cur_pred = conn_pred.cursor()

# Drop empty legacy table aiPrediction if exists and empty
cur_pred.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='aiPrediction'")
if cur_pred.fetchone()[0] > 0:
    cur_pred.execute("SELECT count(*) FROM aiPrediction")
    cnt = cur_pred.fetchone()[0]
    if cnt == 0:
        cur_pred.execute("DROP TABLE IF EXISTS aiPrediction;")
        print("✓ Dropped empty legacy table aiPrediction")
    else:
        print(f"⚠️ Table aiPrediction has {cnt} rows, not dropping!")

# Add missing indexes
cur_pred.execute("CREATE INDEX IF NOT EXISTS predictions_signal_idx ON predictions(signal);")
cur_pred.execute("CREATE INDEX IF NOT EXISTS predictions_master_score_idx ON predictions(master_score);")
cur_pred.execute("CREATE INDEX IF NOT EXISTS predictions_was_published_idx ON predictions(was_published);")
print("✓ Created missing indexes in predictions.db (signal, master_score, was_published)")

conn_pred.commit()
conn_pred.close()

print("\nAll database maintenance operations completed successfully with 0 data loss.")
