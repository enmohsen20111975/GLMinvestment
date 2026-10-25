#!/usr/bin/env python3
"""
Fix Missing Tables and Columns
==============================
This script adds missing tables and columns without breaking existing data.
"""

import sqlite3
import os
import sys
from pathlib import Path

# Database path
script_dir = Path(__file__).parent
project_root = script_dir.parent.parent
db_path = sys.argv[1] if len(sys.argv) > 1 else str(project_root / 'db' / 'stocks.db')

print(f"Fixing tables in: {db_path}")

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.get_connection(db_path, writable=False)
cursor = conn.cursor()

# Get existing tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
existing_tables = [row[0] for row in cursor.fetchall()]
print(f"Existing tables: {existing_tables}")

def table_exists(table_name):
    return table_name in existing_tables

def column_exists(table_name, column_name):
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns

def add_column_if_missing(table_name, column_name, column_type, default_value=None):
    if not table_exists(table_name):
        return False
    if column_exists(table_name, column_name):
        return False
    try:
        default_clause = f" DEFAULT {default_value}" if default_value else ""
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}{default_clause}")
        print(f"  Added column {column_name} to {table_name}")
        return True
    except Exception as e:
        print(f"  Could not add column {column_name} to {table_name}: {e}")
        return False

def create_table_if_missing(table_name, create_sql):
    if table_exists(table_name):
        print(f"  Table {table_name} already exists")
        return False
    try:
        cursor.execute(create_sql)
        print(f"  Created table {table_name}")
        return True
    except Exception as e:
        print(f"  Could not create table {table_name}: {e}")
        return False

# ========================================
# Fix signal_logs table
# ========================================
print("\n=== Fixing signal_logs ===")
if table_exists('signal_logs'):
    # Add missing columns
    add_column_if_missing('signal_logs', 'status', 'TEXT', "'pending'")
    add_column_if_missing('signal_logs', 'outcome', 'TEXT')
    add_column_if_missing('signal_logs', 'pnl_pct', 'REAL')
    add_column_if_missing('signal_logs', 'persona_name', 'TEXT', "'balanced'")
    add_column_if_missing('signal_logs', 'sector', 'TEXT')
    add_column_if_missing('signal_logs', 'regime', 'TEXT')
    add_column_if_missing('signal_logs', 'rsi_bucket', 'TEXT')
    add_column_if_missing('signal_logs', 'month', 'INTEGER')
    add_column_if_missing('signal_logs', 'indicators', 'TEXT')
    add_column_if_missing('signal_logs', 'rationale', 'TEXT')
    add_column_if_missing('signal_logs', 'closed_at', 'TEXT')
else:
    create_sql = '''
        CREATE TABLE signal_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            signal_type TEXT,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            confidence REAL,
            master_score REAL,
            persona_name TEXT DEFAULT 'balanced',
            sector TEXT,
            regime TEXT,
            rsi_bucket TEXT,
            month INTEGER,
            indicators TEXT,
            rationale TEXT,
            status TEXT DEFAULT 'pending',
            outcome TEXT,
            pnl_pct REAL,
            created_at TEXT DEFAULT (datetime('now')),
            closed_at TEXT
        )
    '''
    create_table_if_missing('signal_logs', create_sql)

# Create indexes safely
try:
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_ticker ON signal_logs(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_date ON signal_logs(signal_date)')
    if column_exists('signal_logs', 'status'):
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_status ON signal_logs(status)')
    if column_exists('signal_logs', 'persona_name'):
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_persona ON signal_logs(persona_name)')
except Exception as e:
    print(f"  Index creation warning: {e}")

# ========================================
# Create indicator_trust_scores if missing
# ========================================
print("\n=== indicator_trust_scores ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS indicator_trust_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL UNIQUE,
        current_score REAL DEFAULT 100,
        base_score REAL DEFAULT 100,
        total_signals INTEGER DEFAULT 0,
        successful_signals INTEGER DEFAULT 0,
        failed_signals INTEGER DEFAULT 0,
        consecutive_losses INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        reflection_start TEXT,
        reflection_end TEXT,
        regime_scores TEXT DEFAULT '{}',
        last_updated TEXT DEFAULT (datetime('now'))
    )
'''
create_table_if_missing('indicator_trust_scores', create_sql)

# ========================================
# Create stock_price_history if missing
# ========================================
print("\n=== stock_price_history ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS stock_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(ticker, date)
    )
'''
create_table_if_missing('stock_price_history', create_sql)
try:
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_ticker ON stock_price_history(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_date ON stock_price_history(date)')
except:
    pass

# ========================================
# Create outcome_logs if missing
# ========================================
print("\n=== outcome_logs ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS outcome_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        close_date TEXT NOT NULL,
        actual_exit_price REAL,
        close_reason TEXT,
        gross_profit_loss REAL,
        net_profit_loss REAL,
        profit_loss_percent REAL,
        days_open INTEGER,
        max_favorable REAL,
        max_adverse REAL,
        mae_pct REAL,
        mfe_pct REAL,
        created_at TEXT DEFAULT (datetime('now'))
    )
'''
create_table_if_missing('outcome_logs', create_sql)

# ========================================
# Create learned_lessons if missing
# ========================================
print("\n=== learned_lessons ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS learned_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger_conditions TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'testing',
        validation_start TEXT,
        validation_end TEXT,
        paper_trades_tested INTEGER DEFAULT 0,
        paper_trades_success INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0,
        impact_score REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    )
'''
create_table_if_missing('learned_lessons', create_sql)

# ========================================
# Create conjunction_patterns if missing
# ========================================
print("\n=== conjunction_patterns ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS conjunction_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_name TEXT DEFAULT 'balanced',
        sector TEXT NOT NULL,
        regime TEXT NOT NULL,
        rsi_bucket TEXT NOT NULL,
        month INTEGER,
        quarter TEXT,
        total_signals INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0,
        avg_pnl REAL DEFAULT 0,
        decision TEXT DEFAULT 'proceed',
        confidence_adjustment REAL DEFAULT 0,
        last_updated TEXT DEFAULT (datetime('now')),
        UNIQUE(persona_name, sector, regime, rsi_bucket, month)
    )
'''
create_table_if_missing('conjunction_patterns', create_sql)

# ========================================
# Create market_regime_log if missing
# ========================================
print("\n=== market_regime_log ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS market_regime_log (
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
'''
create_table_if_missing('market_regime_log', create_sql)

# ========================================
# Create context_logs if missing
# ========================================
print("\n=== context_logs ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS context_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        egx30_state TEXT,
        egx30_adx REAL DEFAULT 0,
        official_usd_rate REAL DEFAULT 0,
        parallel_usd_rate REAL DEFAULT 0,
        usd_gap_percent REAL DEFAULT 0,
        egx30_volume REAL DEFAULT 0,
        egx30_avg_volume REAL DEFAULT 0,
        liquidity_ratio REAL DEFAULT 1,
        is_dividend_season INTEGER DEFAULT 0,
        is_cbe_decision_near INTEGER DEFAULT 0,
        market_sentiment REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    )
'''
create_table_if_missing('context_logs', create_sql)

# ========================================
# Create regime_indicator_weights if missing
# ========================================
print("\n=== regime_indicator_weights ===")
create_sql = '''
    CREATE TABLE IF NOT EXISTS regime_indicator_weights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL,
        regime TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        expectancy REAL DEFAULT 0,
        sample_count INTEGER DEFAULT 0,
        last_calculated TEXT DEFAULT (datetime('now')),
        UNIQUE(indicator_name, regime)
    )
'''
create_table_if_missing('regime_indicator_weights', create_sql)

conn.commit()
conn.close()

print("\n=== Table Fix Complete ===")
print("Run 'pm2 restart python-backend' to apply changes")
