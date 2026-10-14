import os
import sqlite3
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(BASE_DIR, "db")

results = {}

def inspect_db(db_name):
    db_path = os.path.join(DB_DIR, db_name)
    if not os.path.exists(db_path):
        return {"exists": False}
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index')")
    objects = cur.fetchall()
    tables = [o[0] for o in objects if o[1] == 'table']
    indexes = [o[0] for o in objects if o[1] == 'index']
    
    table_counts = {}
    for t in tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM `{t}`")
            table_counts[t] = cur.fetchone()[0]
        except Exception as e:
            table_counts[t] = str(e)
            
    table_columns = {}
    for t in tables:
        try:
            cur.execute(f"PRAGMA table_info(`{t}`)")
            table_columns[t] = [row[1] for row in cur.fetchall()]
        except Exception as e:
            table_columns[t] = str(e)
            
    conn.close()
    return {
        "exists": True,
        "tables": table_counts,
        "columns": table_columns,
        "indexes": indexes
    }

for db in ["news.db", "predictions.db", "stocks.db", "data_engine.db", "custom.db", "auth.db"]:
    results[db] = inspect_db(db)

with open(os.path.join(BASE_DIR, "scripts/inspect_output.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print("Inspection completed successfully.")
