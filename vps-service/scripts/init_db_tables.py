#!/usr/bin/env python3
"""
Initialize Database Tables
=========================

Creates the missing tables for the EGX trading system:
- outcome_logs
- conjunction_patterns
- context_logs
- indicator_trust_scores
- learned_lessons
- regime_indicator_weights
"""

import sqlite3
import os
from pathlib import Path as _P

# Database path (relative)
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
DB_PATH = str(_PROJECT_ROOT / 'db' / 'stocks.db')

def init_tables():
    """Initialize all required tables."""
    print("=" * 60)
    print("INITIALIZING DATABASE TABLES")
    print("=" * 60)
    print(f"Database: {DB_PATH}")
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cursor = conn.cursor()
    
    # outcome_logs table
    cursor.execute('''
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
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    print("✅ Created outcome_logs table")
    
    # conjunction_patterns table
    cursor.execute('''
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
            last_updated TEXT,
            UNIQUE(persona_name, sector, regime, rsi_bucket, month)
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_conjunction_lookup 
        ON conjunction_patterns(sector, regime, rsi_bucket, month)
    ''')
    print("✅ Created conjunction_patterns table")
    
    # context_logs table
    cursor.execute('''
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
    ''')
    print("✅ Created context_logs table")
    
    # indicator_trust_scores table
    cursor.execute('''
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
    ''')
    print("✅ Created indicator_trust_scores table")
    
    # learned_lessons table
    cursor.execute('''
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
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    print("✅ Created learned_lessons table")
    
    # regime_indicator_weights table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS regime_indicator_weights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            indicator_name TEXT NOT NULL,
            regime TEXT NOT NULL,
            weight REAL DEFAULT 1.0,
            expectancy REAL DEFAULT 0,
            last_calculated TEXT DEFAULT (datetime('now')),
            UNIQUE(indicator_name, regime)
        )
    ''')
    print("✅ Created regime_indicator_weights table")
    
    conn.commit()
    conn.close()
    
    print("\n" + "=" * 60)
    print("✅ ALL TABLES INITIALIZED SUCCESSFULLY")
    print("=" * 60)


def check_tables():
    """Check existing tables."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    
    print(f"\n📊 Current tables in database: {len(tables)}")
    for table in sorted(tables):
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"   {table}: {count} rows")
    
    conn.close()


if __name__ == "__main__":
    init_tables()
    check_tables()
