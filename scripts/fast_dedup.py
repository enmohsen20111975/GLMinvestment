import sqlite3

def fast_dedup():
    db_path = '/home/meme/my_apps/GLMinvestment/db/data_engine.db'
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=True).__enter__()
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=60000')
    
    print("Fast deduplication running...")
    conn.execute("DROP TABLE IF EXISTS stocks_clean")
    conn.execute("CREATE TABLE stocks_clean AS SELECT * FROM stocks GROUP BY symbol")
    conn.execute("DROP TABLE stocks")
    conn.execute("ALTER TABLE stocks_clean RENAME TO stocks")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)")
    conn.commit()
    
    after = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    print(f"✅ Fast Dedup Finished! Total unique stocks now: {after}")
    conn.close()

if __name__ == '__main__':
    fast_dedup()
