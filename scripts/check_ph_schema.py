import sqlite3

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection('db/price_history.db', writable=False).__enter__()
print("Schema of price_history:")
for r in conn.execute("PRAGMA table_info(price_history)").fetchall():
    print("  ", r)
print("Indexes:")
for r in conn.execute("PRAGMA index_list(price_history)").fetchall():
    print("  ", r)
    for c in conn.execute(f"PRAGMA index_info({r[1]})").fetchall():
        print("     ->", c)
conn.close()
