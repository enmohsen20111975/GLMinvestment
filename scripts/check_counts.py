import sqlite3, glob
from pathlib import Path

def main():
    db_dir = Path('/home/meme/my_apps/GLMinvestment/db')
    for db_path in sorted(db_dir.glob('*.db')):
        try:
            conn = sqlite3.connect(str(db_path))
            tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            print(f"=== DB: {db_path.name}")
            for t in tables:
                cnt = conn.execute(f"SELECT COUNT(*) FROM \"{t}\"").fetchone()[0]
                print(f"  {t}: {cnt}")
            conn.close()
        except Exception as e:
            print(f"Error reading {db_path.name}: {e}")

if __name__ == '__main__':
    main()
