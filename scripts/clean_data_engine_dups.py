import sqlite3
from pathlib import Path

def main():
    db_path = Path('/home/meme/my_apps/GLMinvestment/db/data_engine.db')
    if not db_path.exists():
        print("data_engine.db not found")
        return
        
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=True).__enter__()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=60000")
    conn.row_factory = sqlite3.Row
    
    total_rows = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    unique_symbols = conn.execute("SELECT COUNT(DISTINCT symbol) FROM stocks").fetchone()[0]
    
    print(f"📊 Before Cleanup: data_engine.db 'stocks' table has {total_rows} rows ({unique_symbols} unique symbols)")
    
    if total_rows == unique_symbols:
        print("✅ Already cleaned and deduplicated!")
        conn.close()
        return

    # Deduplicate: Keep only the latest entry per symbol
    print("🧹 Deduplicating 'stocks' table to keep only 1 row per unique symbol...")
    
    conn.execute("BEGIN IMMEDIATE TRANSACTION")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stocks_clean AS
        SELECT * FROM stocks
        WHERE rowid IN (
            SELECT MAX(rowid)
            FROM stocks
            GROUP BY symbol
        )
    """)
    conn.execute("DROP TABLE stocks")
    conn.execute("ALTER TABLE stocks_clean RENAME TO stocks")
    
    # Create unique index on symbol so duplicates can never happen again!
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)")
    conn.execute("COMMIT")
    
    after_rows = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    print(f"✅ After Cleanup: data_engine.db 'stocks' table now has EXACTLY {after_rows} unique stocks!")
    conn.close()

if __name__ == '__main__':
    main()
