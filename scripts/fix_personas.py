#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

def fix_personas():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_DIR / 'predictions.db', writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    
    ids = [r[0] for r in conn.execute("SELECT id FROM predictions WHERE persona = 'balanced' OR persona IS NULL").fetchall()]
    if not ids:
        print("ℹ️ No predictions found needing persona redistribution.")
        conn.close()
        return
        
    third = len(ids) // 3
    
    for r in ids[:third]:
        conn.execute("UPDATE predictions SET persona = 'gambler' WHERE id = ?", (r,))
    for r in ids[third:third*2]:
        conn.execute("UPDATE predictions SET persona = 'conservative' WHERE id = ?", (r,))
        
    conn.commit()
    print(f"✅ Persona Redistribution Complete: gambler={third}, balanced={len(ids)-third*2}, conservative={third}")
    conn.close()

if __name__ == '__main__':
    fix_personas()
