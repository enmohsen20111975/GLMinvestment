import sqlite3

conn = sqlite3.connect('db/price_history.db')
print("Schema of price_history:")
for r in conn.execute("PRAGMA table_info(price_history)").fetchall():
    print("  ", r)
print("Indexes:")
for r in conn.execute("PRAGMA index_list(price_history)").fetchall():
    print("  ", r)
    for c in conn.execute(f"PRAGMA index_info({r[1]})").fetchall():
        print("     ->", c)
conn.close()
