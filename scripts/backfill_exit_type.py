#!/usr/bin/env python3
"""
backfill_exit_type.py — Backfill exit_type for predictions closed without it
=========================================================================
Some predictions were closed by backtest scripts (not daily_closer) and
have exit_type=NULL. This script backfills based on hit_target/hit_stop.

Usage:
    python3 scripts/backfill_exit_type.py
"""
import sqlite3, os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'

def main():
    conn = sqlite3.connect(str(PREDICTIONS_DB), timeout=30)
    
    # Count before
    n_null = conn.execute('SELECT COUNT(*) FROM predictions WHERE actual_return IS NOT NULL AND exit_type IS NULL').fetchone()[0]
    
    if n_null == 0:
        print("✅ No predictions need backfill — exit_type is already set for all closed predictions")
        conn.close()
        return
    
    print(f"Found {n_null} predictions with exit_type=NULL")
    
    # Backfill
    rows = conn.execute('''
        SELECT id, actual_return, hit_target, hit_stop
        FROM predictions 
        WHERE actual_return IS NOT NULL AND exit_type IS NULL
    ''').fetchall()
    
    n_updated = 0
    for pred_id, ret, hit_t, hit_s in rows:
        if hit_t == 1:
            exit_type = 'target_hit'
        elif hit_s == 1:
            exit_type = 'stop_loss'
        elif ret > 0:
            exit_type = 'expired'
        else:
            exit_type = 'expired'
        
        conn.execute('UPDATE predictions SET exit_type = ? WHERE id = ?', (exit_type, pred_id))
        n_updated += 1
    
    conn.commit()
    print(f"✅ Backfilled exit_type for {n_updated} predictions")
    
    # Verify
    print("\nFinal distribution:")
    for r in conn.execute('SELECT exit_type, COUNT(*) FROM predictions WHERE actual_return IS NOT NULL GROUP BY exit_type').fetchall():
        print(f"  {r[0]}: {r[1]}")
    
    conn.close()

if __name__ == '__main__':
    main()
