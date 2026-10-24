#!/usr/bin/env python3
"""
Add Missing Columns to Existing Tables
======================================

This script adds missing columns to existing tables in stocks.db.
Run on your VPS with the 300MB+ database - it will only add what's missing.

SAFE TO RUN MULTIPLE TIMES - won't affect existing data.
"""

import sqlite3
import os
import sys
from pathlib import Path

# Database is ALWAYS in project root: /db/stocks.db
# NOT in vps-service/db/
script_dir = Path(__file__).parent  # vps-service/scripts/
project_root = script_dir.parent.parent  # GLMinvestment/
DEFAULT_DB_PATH = str(project_root / 'db' / 'stocks.db')

def get_existing_columns(cursor, table_name):
    """Get list of existing columns in a table."""
    cursor.execute(f'PRAGMA table_info({table_name})')
    return [row[1] for row in cursor.fetchall()]

def add_column_if_missing(cursor, table_name, column_name, column_def):
    """Add a column to table if it doesn't exist."""
    existing = get_existing_columns(cursor, table_name)
    if column_name not in existing:
        try:
            cursor.execute(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_def}')
            print(f"   ✅ Added {table_name}.{column_name}")
            return True
        except Exception as e:
            print(f"   ⚠️  Could not add {table_name}.{column_name}: {e}")
            return False
    else:
        print(f"   ✓  {table_name}.{column_name} already exists")
        return False

def update_database(db_path=None):
    """Add missing columns and tables."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    
    db_path = os.path.abspath(db_path)
    
    print("=" * 70)
    print("🔧 UPDATING DATABASE SCHEMA")
    print("=" * 70)
    print(f"📂 Database: {db_path}")
    
    if not os.path.exists(db_path):
        print(f"❌ Database not found!")
        return
    
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=True)
    cursor = conn.cursor()
    
    # Enable WAL mode
    cursor.execute('PRAGMA journal_mode=WAL')
    
    changes_made = 0
    
    # ========================================
    # 1. STOCKS TABLE - Add missing columns
    # ========================================
    print("\n📋 Checking stocks table...")
    changes_made += add_column_if_missing(cursor, 'stocks', 'personality', "TEXT DEFAULT 'FOLLOWER'")
    changes_made += add_column_if_missing(cursor, 'stocks', 'beta', 'REAL')
    changes_made += add_column_if_missing(cursor, 'stocks', 'last_price', 'REAL')
    changes_made += add_column_if_missing(cursor, 'stocks', 'change_pct', 'REAL')
    changes_made += add_column_if_missing(cursor, 'stocks', 'updated_at', "TEXT DEFAULT (datetime('now'))")
    
    # ========================================
    # 2. SIGNAL_LOGS - Add learning columns
    # ========================================
    print("\n📋 Checking signal_logs table...")
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'persona_name', "TEXT DEFAULT 'balanced'")
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'sector', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'regime', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'rsi_bucket', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'month', 'INTEGER')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'confidence', 'REAL')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'master_score', 'REAL')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'indicators', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'rationale', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'status', "TEXT DEFAULT 'pending'")
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'outcome', 'TEXT')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'pnl_pct', 'REAL')
    changes_made += add_column_if_missing(cursor, 'signal_logs', 'closed_at', 'TEXT')
    
    # ========================================
    # 3. OUTCOME_LOGS - Add analysis columns
    # ========================================
    print("\n📋 Checking outcome_logs table...")
    changes_made += add_column_if_missing(cursor, 'outcome_logs', 'max_favorable', 'REAL')
    changes_made += add_column_if_missing(cursor, 'outcome_logs', 'max_adverse', 'REAL')
    changes_made += add_column_if_missing(cursor, 'outcome_logs', 'mae_pct', 'REAL')
    changes_made += add_column_if_missing(cursor, 'outcome_logs', 'mfe_pct', 'REAL')
    
    # ========================================
    # 4. LEARNED_LESSONS - Add validation columns
    # ========================================
    print("\n📋 Checking learned_lessons table...")
    changes_made += add_column_if_missing(cursor, 'learned_lessons', 'win_rate', 'REAL DEFAULT 0')
    changes_made += add_column_if_missing(cursor, 'learned_lessons', 'impact_score', 'REAL DEFAULT 0')
    
    # ========================================
    # 5. REGIME_INDICATOR_WEIGHTS - Add sample count
    # ========================================
    print("\n📋 Checking regime_indicator_weights table...")
    changes_made += add_column_if_missing(cursor, 'regime_indicator_weights', 'sample_count', 'INTEGER DEFAULT 0')
    
    # ========================================
    # 6. INDICATOR_TRUST_SCORES - Add unique constraint column
    # ========================================
    print("\n📋 Checking indicator_trust_scores table...")
    # Check if unique constraint exists by checking if we can insert duplicates
    # We can't add UNIQUE constraint via ALTER, so we'll just note it
    
    # ========================================
    # 7. Create missing tables if needed
    # ========================================
    print("\n📋 Checking for missing tables...")
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = [row[0] for row in cursor.fetchall()]
    
    # market_regime_log table (new)
    if 'market_regime_log' not in existing_tables:
        cursor.execute('''
            CREATE TABLE market_regime_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                regime TEXT NOT NULL,
                confidence REAL DEFAULT 0,
                egx30_close REAL,
                egx30_change_pct REAL,
                volume_ratio REAL,
                adx REAL,
                rsi REAL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        print("   ✅ Created market_regime_log table")
        changes_made += 1
    else:
        print("   ✓  market_regime_log table exists")
    
    # mirror_analysis table (new - for 6 questions)
    if 'mirror_analysis' not in existing_tables:
        cursor.execute('''
            CREATE TABLE mirror_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER NOT NULL,
                what_worked TEXT,
                what_failed TEXT,
                surprises TEXT,
                beliefs TEXT,
                reality TEXT,
                lesson TEXT,
                analysis_date TEXT DEFAULT (datetime('now')),
                created_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        print("   ✅ Created mirror_analysis table")
        changes_made += 1
    else:
        print("   ✓  mirror_analysis table exists")
    
    # learning_parameters table (new - for Bayesian optimization)
    if 'learning_parameters' not in existing_tables:
        cursor.execute('''
            CREATE TABLE learning_parameters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                param_name TEXT NOT NULL UNIQUE,
                param_group TEXT,
                current_value REAL,
                optimal_value REAL,
                min_bound REAL,
                max_bound REAL,
                improvement_pct REAL,
                sample_count INTEGER DEFAULT 0,
                last_optimized TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        print("   ✅ Created learning_parameters table")
        changes_made += 1
    else:
        print("   ✓  learning_parameters table exists")
    
    # ========================================
    # 8. Create indexes for performance
    # ========================================
    print("\n📋 Creating indexes...")
    
    indexes = [
        ('idx_signal_persona', 'signal_logs(persona_name)'),
        ('idx_signal_status', 'signal_logs(status)'),
        ('idx_signal_sector_regime', 'signal_logs(sector, regime)'),
        ('idx_outcome_close_date', 'outcome_logs(close_date)'),
        ('idx_lesson_status', 'learned_lessons(status)'),
        ('idx_conjunction_lookup', 'conjunction_patterns(sector, regime, rsi_bucket, month)'),
        ('idx_prediction_ticker', 'prediction_logs(ticker)'),
        ('idx_prediction_date', 'prediction_logs(prediction_date)'),
    ]
    
    for idx_name, idx_def in indexes:
        try:
            cursor.execute(f'CREATE INDEX IF NOT EXISTS {idx_name} ON {idx_def}')
            print(f"   ✓  Index {idx_name}")
        except Exception as e:
            print(f"   ⚠️  Index {idx_name}: {e}")
    
    conn.commit()
    
    # ========================================
    # SUMMARY
    # ========================================
    print("\n" + "=" * 70)
    print("📊 UPDATE COMPLETE")
    print("=" * 70)
    print(f"\n✅ Changes made: {changes_made}")
    
    # Show table row counts
    print("\n📈 Current data:")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [row[0] for row in cursor.fetchall()]
    
    total_rows = 0
    for table in sorted(tables):
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            total_rows += count
            if count > 0:
                print(f"   {table}: {count:,} rows")
        except:
            pass
    
    print(f"\n📊 Total rows: {total_rows:,}")
    conn.close()
    
    print("\n🚀 Database ready for Unified Learning System!")


if __name__ == "__main__":
    db_path = sys.argv[1] if len(sys.argv) > 1 else None
    update_database(db_path)
