#!/usr/bin/env python3
"""
Initialize Learning Tables
==========================

Creates all required tables for the Unified Learning System in stocks.db.

Tables Created:
- prediction_logs (if not exists)
- signal_logs (if not exists)
- outcome_logs
- learned_lessons
- conjunction_patterns
- indicator_trust_scores
- regime_indicator_weights
- context_logs

Run this script on VPS to initialize tables in your 300MB+ database.
Tables will be created only if they don't exist - existing data preserved.
"""

import sqlite3
import os
import sys
from datetime import datetime
from pathlib import Path

# Database is ALWAYS in project root: /db/stocks.db
# NOT in vps-service/db/
script_dir = Path(__file__).parent  # vps-service/scripts/
project_root = script_dir.parent.parent  # GLMinvestment/
DEFAULT_DB_PATH = str(project_root / 'db' / 'stocks.db')

def init_learning_tables(db_path=None):
    """Initialize all learning system tables."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    
    # Resolve absolute path
    db_path = os.path.abspath(db_path)
    
    print("=" * 70)
    print("🧠 UNIFIED LEARNING SYSTEM - TABLE INITIALIZATION")
    print("=" * 70)
    print(f"📂 Database: {db_path}")
    
    if not os.path.exists(db_path):
        print(f"⚠️  Database file not found. Creating new database...")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=True).__enter__()
    cursor = conn.cursor()
    
    # Enable WAL mode for better concurrency
    cursor.execute('PRAGMA journal_mode=WAL')
    cursor.execute('PRAGMA busy_timeout=30000')
    
    tables_created = []
    tables_existing = []
    
    # ========================================
    # 1. STOCKS TABLE (Base table)
    # ========================================
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stocks (
            ticker TEXT PRIMARY KEY,
            name TEXT,
            name_ar TEXT,
            sector TEXT,
            industry TEXT,
            is_active INTEGER DEFAULT 1,
            last_price REAL,
            change_pct REAL,
            volume INTEGER,
            market_cap REAL,
            pe_ratio REAL,
            pb_ratio REAL,
            roe REAL,
            eps REAL,
            dividend_yield REAL,
            beta REAL,
            personality TEXT DEFAULT 'FOLLOWER',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    tables_created.append('stocks')
    print("✅ stocks table ready")
    
    # ========================================
    # 2. STOCK PRICE HISTORY
    # ========================================
    cursor.execute('''
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
            FOREIGN KEY (ticker) REFERENCES stocks(ticker),
            UNIQUE(ticker, date)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_ticker ON stock_price_history(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_date ON stock_price_history(date)')
    tables_created.append('stock_price_history')
    print("✅ stock_price_history table ready")
    
    # ========================================
    # 3. PREDICTION LOGS
    # ========================================
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            prediction_date TEXT NOT NULL,
            predicted_direction TEXT,
            predicted_change_pct REAL,
            confidence REAL,
            model_version TEXT,
            features_used TEXT,
            actual_outcome TEXT,
            actual_change_pct REAL,
            was_correct INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (ticker) REFERENCES stocks(ticker)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pred_ticker ON prediction_logs(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pred_date ON prediction_logs(prediction_date)')
    tables_created.append('prediction_logs')
    print("✅ prediction_logs table ready")
    
    # ========================================
    # 4. SIGNAL LOGS
    # ========================================
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS signal_logs (
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
            closed_at TEXT,
            FOREIGN KEY (ticker) REFERENCES stocks(ticker)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_ticker ON signal_logs(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_date ON signal_logs(signal_date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_status ON signal_logs(status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_persona ON signal_logs(persona_name)')
    tables_created.append('signal_logs')
    print("✅ signal_logs table ready")
    
    # ========================================
    # 5. OUTCOME LOGS
    # ========================================
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
            max_favorable REAL,
            max_adverse REAL,
            mae_pct REAL,
            mfe_pct REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_outcome_trade ON outcome_logs(trade_id)')
    tables_created.append('outcome_logs')
    print("✅ outcome_logs table ready")
    
    # ========================================
    # 6. LEARNED LESSONS
    # ========================================
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
            win_rate REAL DEFAULT 0,
            impact_score REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_lesson_type ON learned_lessons(lesson_type)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_lesson_status ON learned_lessons(status)')
    tables_created.append('learned_lessons')
    print("✅ learned_lessons table ready")
    
    # ========================================
    # 7. CONJUNCTION PATTERNS (Expert Memory V3)
    # ========================================
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
            last_updated TEXT DEFAULT (datetime('now')),
            UNIQUE(persona_name, sector, regime, rsi_bucket, month)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_conjunction_lookup 
        ON conjunction_patterns(sector, regime, rsi_bucket, month)
    ''')
    tables_created.append('conjunction_patterns')
    print("✅ conjunction_patterns table ready")
    
    # ========================================
    # 8. INDICATOR TRUST SCORES
    # ========================================
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
    tables_created.append('indicator_trust_scores')
    print("✅ indicator_trust_scores table ready")
    
    # ========================================
    # 9. REGIME INDICATOR WEIGHTS
    # ========================================
    cursor.execute('''
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
    ''')
    tables_created.append('regime_indicator_weights')
    print("✅ regime_indicator_weights table ready")
    
    # ========================================
    # 10. CONTEXT LOGS
    # ========================================
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
    tables_created.append('context_logs')
    print("✅ context_logs table ready")
    
    # ========================================
    # 11. MARKET REGIME LOG
    # ========================================
    cursor.execute('''
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
    ''')
    tables_created.append('market_regime_log')
    print("✅ market_regime_log table ready")
    
    conn.commit()
    
    # ========================================
    # SUMMARY
    # ========================================
    print("\n" + "=" * 70)
    print("📊 TABLE INITIALIZATION COMPLETE")
    print("=" * 70)
    
    # Get current table counts
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    all_tables = [row[0] for row in cursor.fetchall()]
    
    print(f"\n📋 Tables in database: {len(all_tables)}")
    print("-" * 50)
    
    for table in sorted(all_tables):
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            status = "✅" if count > 0 else "⚠️ "
            print(f"   {status} {table}: {count:,} rows")
        except Exception as e:
            print(f"   ❌ {table}: error - {e}")
    
    conn.close()
    
    print("\n" + "=" * 70)
    print("✅ ALL LEARNING TABLES READY!")
    print("=" * 70)
    print("\n📌 Next steps:")
    print("   1. Run self-learning to populate tables")
    print("   2. Run Expert Memory to build conjunction patterns")
    print("   3. Run Maestro to generate signals")
    print("\n🚀 Ready to learn!")


if __name__ == "__main__":
    # Allow custom database path via command line
    db_path = sys.argv[1] if len(sys.argv) > 1 else None
    init_learning_tables(db_path)
