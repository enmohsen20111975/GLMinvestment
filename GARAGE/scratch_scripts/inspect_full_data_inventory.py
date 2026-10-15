import sqlite3
import os
import glob
from pathlib import Path

PROJECT_ROOT = Path("/home/meme/my_apps/GLMinvestment")

def check_db(path):
    p = PROJECT_ROOT / path
    if not p.exists():
        print(f"File not found: {p}")
        return
    print(f"\n=======================================================")
    print(f"📊 DATABASE: {path} ({p.stat().st_size / (1024*1024):.2f} MB)")
    print(f"=======================================================")
    try:
        conn = sqlite3.connect(p)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for t in sorted(tables):
            try:
                count = conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
                cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")').fetchall()]
                print(f"  • {t:<28} | {count:>8} rows | cols ({len(cols)}): {', '.join(cols[:6])}{'...' if len(cols)>6 else ''}")
            except Exception as e:
                print(f"  • {t:<28} | Error: {e}")
    except Exception as e:
        print(f"Error opening DB: {e}")

check_db("db/data_engine.db")
check_db("db/stocks.db")

print("\n=======================================================")
print("🔍 SCRAPERS IN data_engine/")
print("=======================================================")
scrapers = list((PROJECT_ROOT / "data_engine").glob("**/*.py"))
for s in sorted(scrapers):
    rel = s.relative_to(PROJECT_ROOT)
    print(f"  - {rel} ({s.stat().st_size} bytes)")
