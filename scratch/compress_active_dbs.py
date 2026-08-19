import os
import tarfile
import lzma

def compress_databases():
    core_dbs = [
        "ai_search_cache.db",
        "analytics.db",
        "auth.db",
        "community.db",
        "crypto-lab.db",
        "crypto.db",
        "crypto_learning.db",
        "data_engine.db",
        "gold_prices.db",
        "historical.db",
        "intraday.db",
        "learned.db",
        "news.db",
        "predictions.db",
        "stocks.db",
        "telegram_data.db"
    ]
    
    db_dir = "/home/meme/my_apps/GLMinvestment/db"
    output_file = os.path.join(db_dir, "active_databases_ultra.tar.xz")
    
    print(f"Compressing databases to {output_file}...")
    
    with tarfile.open(output_file, "w:xz") as tar:
        for db in core_dbs:
            file_path = os.path.join(db_dir, db)
            if os.path.exists(file_path):
                print(f"Adding {db} ({os.path.getsize(file_path) / 1024 / 1024:.2f} MB)")
                tar.add(file_path, arcname=db)
            else:
                print(f"Skipping {db}, file not found.")
                
    print(f"Compression complete. File size: {os.path.getsize(output_file) / 1024 / 1024:.2f} MB")

if __name__ == "__main__":
    compress_databases()
