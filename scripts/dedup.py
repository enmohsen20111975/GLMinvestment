import sqlite3

def dedup():
    db_path = '/home/meme/my_apps/GLMinvestment/db/data_engine.db'
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=60000')
    
    before = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    print(f"Rows before dedup: {before}")
    
    conn.execute("CREATE TABLE IF NOT EXISTS stocks_clean AS SELECT * FROM stocks WHERE rowid IN (SELECT MAX(rowid) FROM stocks GROUP BY symbol)")
    conn.execute("DROP TABLE stocks")
    conn.execute("ALTER TABLE stocks_clean RENAME TO stocks")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)")
    conn.commit()
    
    after = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    print(f"✅ Rows after dedup: {after}")
    conn.close()

if __name__ == '__main__':
    dedup()
