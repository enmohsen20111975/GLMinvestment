#!/usr/bin/env python3
"""
Rebuild price_history.db + stocks.db from scratch (clean).
Run this on your laptop to fix the malformed database.

Usage:
    python3 scripts/rebuild_db_from_dump.py
"""
import sqlite3, os, sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def rebuild_db(db_name, dump_path):
    """Rebuild a SQLite DB from a SQL dump."""
    db_path = PROJECT_ROOT / 'db' / db_name
    backup_path = PROJECT_ROOT / 'db' / f'{db_name}.broken'
    
    # Backup broken DB
    if db_path.exists():
        os.rename(db_path, backup_path)
        print(f"  Backed up broken DB → {backup_path}")
    
    # Create fresh DB and import
    print(f"  Creating fresh {db_name}...")
    c = sqlite3.connect(str(db_path))
    with open(dump_path, 'r') as f:
        c.executescript(f.read())
    c.commit()
    c.close()
    
    # Verify
    c = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    r = c.execute('PRAGMA integrity_check').fetchone()[0]
    c.close()
    print(f"  Integrity: {r}")
    return r == 'ok'

if __name__ == '__main__':
    print("=== Rebuilding databases from SQL dumps ===\n")
    
    # Check dumps exist
    ph_dump = PROJECT_ROOT / 'db' / 'price_history_dump.sql'
    st_dump = PROJECT_ROOT / 'db' / 'stocks_dump.sql'
    
    if not ph_dump.exists() or not st_dump.exists():
        print("ERROR: SQL dumps not found in db/ folder.")
        print("Download them from the sandbox or ask Bravo to push them.")
        sys.exit(1)
    
    print("1. Rebuilding price_history.db...")
    ok1 = rebuild_db('price_history.db', str(ph_dump))
    
    print("\n2. Rebuilding stocks.db...")
    ok2 = rebuild_db('stocks.db', str(st_dump))
    
    if ok1 and ok2:
        print("\n✅ Both databases rebuilt successfully!")
        print("Now run: python3 scripts/run_b0b4_full.py")
    else:
        print("\n❌ Rebuild failed. Check errors above.")
