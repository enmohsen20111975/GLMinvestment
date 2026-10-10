#!/usr/bin/env python3
"""
Complete VPS Database Fix Script
=================================
This script fixes all database issues:
1. Adds missing columns (close, roe, etc.)
2. Deletes fake stocks (EG00X-EG29X, EGT...)
3. Ensures stock_price_history has correct columns
4. Populates prediction_performance data
"""

import sqlite3
import os
import sys
from datetime import datetime

DB_PATH = os.path.expanduser('~/GLMinvestment/db/stocks.db')

def log(msg):
    print(f"[FIX] {msg}")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def fix_stock_price_history_columns():
    """Fix stock_price_history table - add close column if missing"""
    log("Checking stock_price_history columns...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Get current columns
    cursor.execute("PRAGMA table_info(stock_price_history)")
    columns = [row[1] for row in cursor.fetchall()]
    log(f"Current columns: {columns}")
    
    # Check for close_price or close
    has_close_price = 'close_price' in columns
    has_close = 'close' in columns
    
    if not has_close_price and not has_close:
        # Need to add close column
        log("Adding close_price column...")
        try:
            cursor.execute("ALTER TABLE stock_price_history ADD COLUMN close_price REAL DEFAULT 0")
            conn.commit()
            log("Added close_price column successfully")
        except Exception as e:
            log(f"Error adding close_price: {e}")
    
    # Ensure we have other required columns
    required_columns = {
        'open': 'REAL DEFAULT 0',
        'high': 'REAL DEFAULT 0',
        'low': 'REAL DEFAULT 0',
        'volume': 'REAL DEFAULT 0',
        'date': 'TEXT',
        'ticker': 'TEXT'
    }
    
    for col, col_type in required_columns.items():
        if col not in columns:
            try:
                cursor.execute(f"ALTER TABLE stock_price_history ADD COLUMN {col} {col_type}")
                conn.commit()
                log(f"Added {col} column")
            except Exception as e:
                log(f"Column {col} might already exist or error: {e}")
    
    conn.close()
    log("stock_price_history columns fixed")

def fix_stocks_table_columns():
    """Add missing columns to stocks table"""
    log("Checking stocks table columns...")
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("PRAGMA table_info(stocks)")
    columns = [row[1] for row in cursor.fetchall()]
    
    required_columns = {
        'roe': 'REAL DEFAULT 0',
        'profit_margin': 'REAL DEFAULT 0',
        'debt_to_equity': 'REAL DEFAULT 0',
        'close': 'REAL DEFAULT 0',
        'current_price': 'REAL DEFAULT 0',
        'previous_close': 'REAL DEFAULT 0',
        'open_price': 'REAL DEFAULT 0',
        'high_price': 'REAL DEFAULT 0',
        'low_price': 'REAL DEFAULT 0',
        'volume': 'REAL DEFAULT 0',
        'change_percent': 'REAL DEFAULT 0',
        'pe_ratio': 'REAL DEFAULT 0',
        'pb_ratio': 'REAL DEFAULT 0',
        'market_cap': 'REAL DEFAULT 0',
        'dividend_yield': 'REAL DEFAULT 0',
        'eps': 'REAL DEFAULT 0',
        'beta': 'REAL DEFAULT 0',
        'avg_volume': 'REAL DEFAULT 0',
        'high_52w': 'REAL DEFAULT 0',
        'low_52w': 'REAL DEFAULT 0',
        'ma_50': 'REAL DEFAULT 0',
        'ma_200': 'REAL DEFAULT 0',
        'rsi': 'REAL DEFAULT 0',
        'support': 'REAL DEFAULT 0',
        'resistance': 'REAL DEFAULT 0',
        'trend': "TEXT DEFAULT 'neutral'",
        'name_ar': 'TEXT',
    }
    
    added = []
    for col, col_type in required_columns.items():
        if col not in columns:
            try:
                cursor.execute(f"ALTER TABLE stocks ADD COLUMN {col} {col_type}")
                conn.commit()
                added.append(col)
                log(f"Added {col} column to stocks")
            except Exception as e:
                if "duplicate column" not in str(e).lower():
                    log(f"Error adding {col}: {e}")
    
    conn.close()
    if added:
        log(f"Added {len(added)} new columns: {added}")
    else:
        log("All required columns already exist")

def delete_fake_stocks():
    """Delete fake stock data and non-stock instruments (Treasury Bills, Investment Funds)"""
    log("Deleting fake stocks and non-stock instruments...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Delete Treasury Bills (أذون الخزانة) - these are NOT stocks!
    # EGB* = Treasury Bills
    # EGT* = Treasury Bills
    treasury_patterns = ['EGB%', 'EGT%']
    
    # Delete Investment Funds (صناديق الاستثمار) - these are NOT stocks!
    # EG05* = Investment Funds
    fund_patterns = ['EG05%', 'ص.إ.%', 'صندوق%']
    
    # Delete fake stocks (EG00X-EG29X, EGXX patterns)
    fake_exact_patterns = [
        'EG00X', 'EG01X', 'EG02X', 'EG03X', 'EG04X', 'EG05X',
        'EG06X', 'EG07X', 'EG08X', 'EG09X', 'EG10X', 'EG11X',
        'EG12X', 'EG13X', 'EG14X', 'EG15X', 'EG16X', 'EG17X',
        'EG18X', 'EG19X', 'EG20X', 'EG21X', 'EG22X', 'EG23X',
        'EG24X', 'EG25X', 'EG26X', 'EG27X', 'EG28X', 'EG29X',
        'EGBE', 'EGTS',  # More treasury bills
    ]
    
    # Fake patterns with LIKE
    fake_like_patterns = [
        'EG%X',      # EG00X, EG01X, etc.
        'EG0%X',     # EG00X, EG01X, etc.
        'EG1%X',     # EG10X, EG11X, etc.
        'EG2%X',     # EG20X, EG21X, etc.
    ]
    
    deleted_count = 0
    
    # First, show what we're about to delete
    cursor.execute("""
        SELECT ticker FROM stocks 
        WHERE ticker LIKE 'EGB%' 
        OR ticker LIKE 'EGT%' 
        OR ticker LIKE 'EG05%'
        OR ticker LIKE 'EG%X'
        OR ticker LIKE 'EG0%X'
        OR ticker LIKE 'EG1%X'
        OR ticker LIKE 'EG2%X'
        OR ticker IN ('EGBE', 'EGTS')
    """)
    found = cursor.fetchall()
    log(f"Found {len(found)} non-stock instruments to delete: {[f[0] for f in found]}")
    
    # Delete fake stocks (exact match)
    for pattern in fake_exact_patterns:
        cursor.execute("DELETE FROM stocks WHERE ticker = ?", (pattern,))
        if cursor.rowcount > 0:
            deleted_count += cursor.rowcount
            log(f"Deleted fake stock {pattern}")
    
    # Delete fake stocks (LIKE patterns)
    for pattern in fake_like_patterns:
        cursor.execute("DELETE FROM stocks WHERE ticker LIKE ?", (pattern,))
        if cursor.rowcount > 0:
            deleted_count += cursor.rowcount
            log(f"Deleted {cursor.rowcount} fake stocks matching {pattern}")
    
    # Delete Treasury Bills using LIKE
    for pattern in treasury_patterns:
        cursor.execute("DELETE FROM stocks WHERE ticker LIKE ?", (pattern,))
        if cursor.rowcount > 0:
            deleted_count += cursor.rowcount
            log(f"Deleted {cursor.rowcount} Treasury Bills matching {pattern}")
    
    # Delete Investment Funds using LIKE
    for pattern in fund_patterns:
        cursor.execute("DELETE FROM stocks WHERE ticker LIKE ?", (pattern,))
        if cursor.rowcount > 0:
            deleted_count += cursor.rowcount
            log(f"Deleted {cursor.rowcount} Investment Funds matching {pattern}")
    
    # Delete from stock_price_history
    for pattern in fake_exact_patterns:
        cursor.execute("DELETE FROM stock_price_history WHERE ticker = ?", (pattern,))
    for pattern in fake_like_patterns + treasury_patterns + fund_patterns:
        cursor.execute("DELETE FROM stock_price_history WHERE ticker LIKE ?", (pattern,))
    
    # Delete from cached_analysis
    for pattern in fake_exact_patterns:
        cursor.execute("DELETE FROM cached_analysis WHERE ticker = ?", (pattern,))
    for pattern in fake_like_patterns + treasury_patterns + fund_patterns:
        cursor.execute("DELETE FROM cached_analysis WHERE ticker LIKE ?", (pattern,))
    
    conn.commit()
    conn.close()
    
    log(f"Total fake/non-stock instruments deleted: {deleted_count}")

def fix_price_history_ticker_column():
    """Fix ticker column in stock_price_history - convert IDs to tickers"""
    log("Checking stock_price_history ticker column...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if ticker has numeric values (IDs instead of tickers)
    cursor.execute("""
        SELECT ticker FROM stock_price_history 
        WHERE ticker IS NOT NULL 
        LIMIT 5
    """)
    samples = cursor.fetchall()
    
    needs_fix = False
    for sample in samples:
        ticker_val = str(sample[0])
        if ticker_val.isdigit():
            needs_fix = True
            break
    
    if needs_fix:
        log("Ticker column has IDs, fixing...")
        cursor.execute("""
            UPDATE stock_price_history 
            SET ticker = (
                SELECT s.ticker FROM stocks s 
                WHERE s.id = stock_price_history.ticker
            )
            WHERE EXISTS (
                SELECT 1 FROM stocks s 
                WHERE s.id = stock_price_history.ticker
            )
        """)
        conn.commit()
        log("Fixed ticker column in stock_price_history")
    
    conn.close()

def sync_prices_from_big_db():
    """Sync prices from egx_investment.db if available"""
    big_db_path = os.path.expanduser('~/GLMinvestment/db/egx_investment.db')
    
    if not os.path.exists(big_db_path):
        log(f"Big database not found at {big_db_path}, skipping sync")
        return
    
    log("Syncing prices from big database...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Attach big database
    cursor.execute(f"ATTACH DATABASE '{big_db_path}' AS big_db")
    
    try:
        # Update stocks with prices from big db
        update_queries = [
            ("current_price", "current_price"),
            ("previous_close", "previous_close"),
            ("open_price", "open_price"),
            ("high_price", "high_price"),
            ("low_price", "low_price"),
            ("volume", "volume"),
            ("market_cap", "market_cap"),
            ("pe_ratio", "pe_ratio"),
            ("pb_ratio", "pb_ratio"),
            ("eps", "eps"),
            ("dividend_yield", "dividend_yield"),
            ("ma_50", "ma_50"),
            ("ma_200", "ma_200"),
            ("rsi", "rsi"),
            ("support", "support_level"),
            ("resistance", "resistance_level"),
            ("beta", "beta"),
            ("change_percent", "change_percent"),
            ("name", "name"),
            ("name_ar", "name_ar"),
        ]
        
        for main_col, big_col in update_queries:
            try:
                cursor.execute(f"""
                    UPDATE main.stocks 
                    SET {main_col} = (
                        SELECT {big_col} FROM big_db.stocks 
                        WHERE big_db.stocks.ticker = main.stocks.ticker
                    )
                    WHERE EXISTS (
                        SELECT 1 FROM big_db.stocks 
                        WHERE big_db.stocks.ticker = main.stocks.ticker
                    )
                """)
            except Exception as e:
                log(f"Warning syncing {main_col}: {e}")
        
        conn.commit()
        log("Synced prices from big database")
        
    finally:
        cursor.execute("DETACH DATABASE big_db")
    
    conn.close()

def populate_cached_analysis():
    """Populate cached_analysis table with proper data"""
    log("Populating cached_analysis...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if table exists
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='cached_analysis'
    """)
    if not cursor.fetchone():
        log("cached_analysis table doesn't exist, creating...")
        cursor.execute("""
            CREATE TABLE cached_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE,
                sector TEXT,
                current_price REAL DEFAULT 0,
                recommendation TEXT DEFAULT 'hold',
                composite_score REAL DEFAULT 0,
                target_price REAL DEFAULT 0,
                stop_loss REAL DEFAULT 0,
                signal TEXT DEFAULT 'hold',
                confidence REAL DEFAULT 0,
                analysis_json TEXT DEFAULT '{}',
                master_score REAL DEFAULT 0,
                risk_level TEXT DEFAULT 'medium',
                technical_score REAL DEFAULT 0,
                fundamental_score REAL DEFAULT 0,
                sentiment_score REAL DEFAULT 0,
                risk_score REAL DEFAULT 0,
                momentum_score REAL DEFAULT 0,
                trend TEXT DEFAULT 'neutral',
                liquidity_level TEXT DEFAULT 'medium',
                volatility REAL DEFAULT 0,
                upside_potential REAL DEFAULT 0,
                is_tradeable INTEGER DEFAULT 1,
                volume_trend TEXT DEFAULT 'stable',
                price_strength REAL DEFAULT 0,
                analysis_date TEXT,
                price_change_1d REAL DEFAULT 0,
                price_change_1w REAL DEFAULT 0,
                price_change_1m REAL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT
            )
        """)
        conn.commit()
    
    # Get tradeable stocks
    cursor.execute("""
        SELECT ticker, current_price, previous_close, change_percent, sector
        FROM stocks 
        WHERE current_price > 0 
        AND is_active = 1 OR is_active IS NULL
        LIMIT 500
    """)
    stocks = cursor.fetchall()
    
    inserted = 0
    for stock in stocks:
        ticker = stock[0]
        current_price = stock[1] or 0
        previous_close = stock[2] or current_price
        change_percent = stock[3] or 0
        sector = stock[4] or 'Unknown'
        
        # Calculate simple scores
        price_change_1d = change_percent
        price_change_1w = change_percent * 3  # Simplified
        price_change_1m = change_percent * 7  # Simplified
        
        # Generate signal based on change
        if change_percent > 5:
            signal = 'BUY'
            recommendation = 'buy'
            master_score = 70 + min(change_percent, 20)
        elif change_percent > 2:
            signal = 'ACCUMULATE'
            recommendation = 'accumulate'
            master_score = 55 + change_percent
        elif change_percent < -5:
            signal = 'REDUCE'
            recommendation = 'reduce'
            master_score = 30
        else:
            signal = 'HOLD'
            recommendation = 'hold'
            master_score = 50
        
        master_score = min(100, max(0, master_score))
        
        # Insert or update
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO cached_analysis 
                (ticker, sector, current_price, recommendation, composite_score,
                 signal, confidence, master_score, technical_score, fundamental_score,
                 analysis_date, price_change_1d, price_change_1w, price_change_1m,
                 updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, datetime('now'))
            """, (ticker, sector, current_price, recommendation, master_score,
                  signal, 50, master_score, master_score, master_score,
                  price_change_1d, price_change_1w, price_change_1m))
            inserted += 1
        except Exception as e:
            pass
    
    conn.commit()
    conn.close()
    log(f"Populated {inserted} stocks in cached_analysis")


def create_prediction_logs():
    """Create prediction_logs table if not exists and populate from cached_analysis"""
    log("Creating/populating prediction_logs...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Create prediction_logs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            prediction_date TEXT NOT NULL,
            recommendation TEXT DEFAULT 'HOLD',
            predicted_direction TEXT DEFAULT 'neutral',
            confidence REAL DEFAULT 50,
            entry_price REAL DEFAULT 0,
            target_price REAL DEFAULT 0,
            stop_loss REAL DEFAULT 0,
            direction_correct_5d INTEGER,
            direction_correct_10d INTEGER,
            target_reached INTEGER DEFAULT 0,
            stop_hit INTEGER DEFAULT 0,
            actual_price_5d REAL,
            actual_price_10d REAL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            verified_at TEXT
        )
    """)
    conn.commit()
    
    # Check if we have data
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    count = cursor.fetchone()[0]
    
    if count == 0:
        # Populate from cached_analysis
        cursor.execute("""
            SELECT ticker, current_price, signal, master_score, target_price, stop_loss
            FROM cached_analysis
            WHERE signal IN ('ACCUMULATE', 'BUY', 'REDUCE')
        """)
        signals = cursor.fetchall()
        
        inserted = 0
        for sig in signals:
            ticker = sig[0]
            current_price = sig[1] or 0
            signal = sig[2] or 'HOLD'
            master_score = sig[3] or 50
            target_price = sig[4] or (current_price * 1.1)
            stop_loss = sig[5] or (current_price * 0.95)
            
            # Determine recommendation
            if signal in ['BUY', 'ACCUMULATE']:
                recommendation = 'ACCUMULATE'
                predicted_direction = 'up'
            else:
                recommendation = 'HOLD'
                predicted_direction = 'down' if signal == 'REDUCE' else 'neutral'
            
            # Insert
            cursor.execute("""
                INSERT INTO prediction_logs 
                (ticker, prediction_date, recommendation, predicted_direction, confidence,
                 entry_price, target_price, stop_loss, created_at)
                VALUES (?, date('now'), ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (ticker, recommendation, predicted_direction, min(master_score, 95),
                  current_price, target_price, stop_loss))
            inserted += 1
        
        conn.commit()
        log(f"Inserted {inserted} prediction logs from cached_analysis")
    else:
        log(f"prediction_logs already has {count} entries")
    
    conn.close()


def create_signal_logs():
    """Create signal_logs table if not exists"""
    log("Creating signal_logs...")
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS signal_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            signal_type TEXT DEFAULT 'ACCUMULATE',
            entry_price REAL DEFAULT 0,
            target_price REAL DEFAULT 0,
            stop_loss REAL DEFAULT 0,
            confidence REAL DEFAULT 50,
            master_score REAL DEFAULT 50,
            persona_name TEXT DEFAULT 'balanced',
            sector TEXT,
            regime TEXT DEFAULT 'neutral',
            indicators TEXT DEFAULT '{}',
            status TEXT DEFAULT 'ACTIVE',
            outcome TEXT,
            pnl_pct REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    
    # Populate from cached_analysis if empty
    cursor.execute("SELECT COUNT(*) FROM signal_logs")
    count = cursor.fetchone()[0]
    
    if count == 0:
        cursor.execute("""
            SELECT ticker, current_price, signal, master_score, sector
            FROM cached_analysis
            WHERE signal IN ('ACCUMULATE', 'BUY')
        """)
        signals = cursor.fetchall()
        
        for sig in signals:
            cursor.execute("""
                INSERT INTO signal_logs 
                (ticker, signal_date, signal_type, entry_price, confidence, master_score, sector, created_at)
                VALUES (?, date('now'), ?, ?, ?, ?, ?, datetime('now'))
            """, (sig[0], sig[2], sig[1], min(sig[3] or 50, 95), sig[3], sig[4]))
        
        conn.commit()
        log(f"Populated signal_logs with {len(signals)} entries")
    
    conn.close()


def create_outcome_logs():
    """Create outcome_logs table if not exists"""
    log("Creating outcome_logs...")
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS outcome_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id INTEGER,
            close_date TEXT NOT NULL,
            actual_exit_price REAL DEFAULT 0,
            close_reason TEXT DEFAULT 'TARGET',
            gross_profit_loss REAL DEFAULT 0,
            net_profit_loss REAL DEFAULT 0,
            profit_loss_percent REAL DEFAULT 0,
            days_open INTEGER DEFAULT 0,
            max_favorable REAL DEFAULT 0,
            max_adverse REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    log("outcome_logs table created/verified")
    conn.close()


def create_expert_tables():
    """Create expert_recommendations in auth.db and platform_recommendations in custom.db"""
    auth_db_path = os.path.expanduser('~/GLMinvestment/db/auth.db')
    custom_db_path = os.path.expanduser('~/GLMinvestment/db/custom.db')
    
    # Ensure db directory exists
    os.makedirs(os.path.dirname(auth_db_path), exist_ok=True)
    
    # ========== AUTH.DB - ExpertRecommendation (for Prisma) ==========
    log("Setting up ExpertRecommendation in auth.db...")
    conn_auth = sqlite3.connect(auth_db_path)
    cursor_auth = conn_auth.cursor()
    
    # Create expert_recommendations table (for Prisma compatibility)
    cursor_auth.execute("""
        CREATE TABLE IF NOT EXISTS ExpertRecommendation (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            expert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            recommendation_type TEXT DEFAULT 'detailed',
            entry_price REAL NOT NULL,
            entry_price_from REAL,
            entry_price_to REAL,
            target_price REAL,
            target_price_2 REAL,
            investment_target REAL,
            stop_loss REAL,
            session_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            notes TEXT,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    
    # Create expert_track_records table
    cursor_auth.execute("""
        CREATE TABLE IF NOT EXISTS ExpertTrackRecord (
            id TEXT PRIMARY KEY,
            expert_name TEXT NOT NULL UNIQUE,
            total_recommendations INTEGER DEFAULT 0,
            successful INTEGER DEFAULT 0,
            stopped INTEGER DEFAULT 0,
            pending INTEGER DEFAULT 0,
            success_rate REAL DEFAULT 0,
            avg_return REAL DEFAULT 0,
            best_return REAL,
            worst_return REAL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    
    # Create indexes
    try:
        cursor_auth.execute("CREATE INDEX IF NOT EXISTS idx_expert_rec_symbol ON ExpertRecommendation(stock_symbol)")
        cursor_auth.execute("CREATE INDEX IF NOT EXISTS idx_expert_rec_status ON ExpertRecommendation(status)")
    except:
        pass
    
    conn_auth.commit()
    conn_auth.close()
    log("Created ExpertRecommendation table in auth.db")
    
    # ========== CUSTOM.DB - platform_recommendations ==========
    log("Setting up platform_recommendations in custom.db...")
    
    # Check if custom.db exists and has platform_recommendations
    if os.path.exists(custom_db_path):
        log(f"Found existing custom.db at {custom_db_path}")
        conn_custom = sqlite3.connect(custom_db_path)
        cursor_custom = conn_custom.cursor()
        
        # Check if platform_recommendations exists
        cursor_custom.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_recommendations'")
        if cursor_custom.fetchone():
            cursor_custom.execute("SELECT COUNT(*) FROM platform_recommendations")
            count = cursor_custom.fetchone()[0]
            log(f"platform_recommendations table exists with {count} records")
        else:
            log("platform_recommendations table not found in custom.db, creating...")
            create_platform_recommendations_table(cursor_custom)
            conn_custom.commit()
        
        conn_custom.close()
    else:
        log(f"custom.db not found, creating at {custom_db_path}")
        conn_custom = sqlite3.connect(custom_db_path)
        cursor_custom = conn_custom.cursor()
        create_platform_recommendations_table(cursor_custom)
        conn_custom.commit()
        conn_custom.close()
    
    log("Expert and platform recommendations tables setup complete")


def create_platform_recommendations_table(cursor):
    """Create platform_recommendations table"""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS platform_recommendations (
            id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            name_ar TEXT,
            recommendation TEXT NOT NULL,
            recommendation_ar TEXT,
            confidence REAL,
            entry_price REAL NOT NULL,
            target_price REAL,
            stop_loss REAL,
            current_price REAL,
            current_profit_loss REAL,
            status TEXT DEFAULT 'active',
            days_active INTEGER DEFAULT 0,
            final_price REAL,
            final_profit_loss REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            last_checked TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    
    # Create indexes
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_platform_rec_ticker ON platform_recommendations(ticker)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_platform_rec_status ON platform_recommendations(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_platform_rec_date ON platform_recommendations(recommendation_date)")
    except:
        pass


def create_news_table():
    """Create news_items table in stocks.db"""
    log("Creating news_items table...")
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS news_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            source TEXT,
            url TEXT,
            category TEXT DEFAULT 'general',
            sentiment TEXT DEFAULT 'neutral',
            sentiment_score REAL DEFAULT 0,
            related_stocks TEXT,
            published_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_news_date ON news_items(published_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category)")
    except:
        pass
    
    conn.commit()
    conn.close()
    log("news_items table created/verified")

def verify_fixes():
    """Verify all fixes were applied"""
    log("Verifying fixes...")
    conn = get_db()
    cursor = conn.cursor()
    
    # Check stocks table
    cursor.execute("PRAGMA table_info(stocks)")
    stocks_cols = [row[1] for row in cursor.fetchall()]
    
    # Check stock_price_history
    cursor.execute("PRAGMA table_info(stock_price_history)")
    price_cols = [row[1] for row in cursor.fetchall()]
    
    # Check for fake stocks (all patterns)
    cursor.execute("""
        SELECT COUNT(*) FROM stocks 
        WHERE ticker LIKE 'EGB%' 
        OR ticker LIKE 'EGT%' 
        OR ticker LIKE 'EG05%'
        OR ticker LIKE 'EG%X'
        OR ticker LIKE 'EG0%X'
        OR ticker LIKE 'EG1%X'
        OR ticker LIKE 'EG2%X'
        OR ticker IN ('EGBE', 'EGTS')
    """)
    fake_count = cursor.fetchone()[0]
    
    # Check cached_analysis
    cursor.execute("SELECT COUNT(*) FROM cached_analysis")
    analysis_count = cursor.fetchone()[0]
    
    # Check stocks with prices
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE current_price > 0")
    priced_stocks = cursor.fetchone()[0]
    
    # Check news_items table
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news_items'")
    news_exists = cursor.fetchone() is not None
    
    conn.close()
    
    # Check auth.db for ExpertRecommendation
    auth_db_path = os.path.expanduser('~/GLMinvestment/db/auth.db')
    expert_rec_count = 0
    if os.path.exists(auth_db_path):
        conn_auth = sqlite3.connect(auth_db_path)
        cursor_auth = conn_auth.cursor()
        cursor_auth.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ExpertRecommendation'")
        if cursor_auth.fetchone():
            cursor_auth.execute("SELECT COUNT(*) FROM ExpertRecommendation")
            expert_rec_count = cursor_auth.fetchone()[0]
        conn_auth.close()
    
    # Check custom.db for platform_recommendations
    custom_db_path = os.path.expanduser('~/GLMinvestment/db/custom.db')
    platform_rec_count = 0
    if os.path.exists(custom_db_path):
        conn_custom = sqlite3.connect(custom_db_path)
        cursor_custom = conn_custom.cursor()
        cursor_custom.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_recommendations'")
        if cursor_custom.fetchone():
            cursor_custom.execute("SELECT COUNT(*) FROM platform_recommendations")
            platform_rec_count = cursor_custom.fetchone()[0]
        conn_custom.close()
    
    log("=== Verification Results ===")
    log(f"Stocks table columns: {len(stocks_cols)}")
    log(f"Price history columns: {len(price_cols)}")
    log(f"Fake stocks remaining: {fake_count}")
    log(f"Cached analysis entries: {analysis_count}")
    log(f"Stocks with prices: {priced_stocks}")
    log(f"news_items table: {'EXISTS' if news_exists else 'MISSING'}")
    log(f"ExpertRecommendation (auth.db): {expert_rec_count} records")
    log(f"platform_recommendations (custom.db): {platform_rec_count} records")
    
    # Check for critical columns
    missing = []
    if 'roe' not in stocks_cols:
        missing.append('roe')
    if 'close_price' not in price_cols and 'close' not in price_cols:
        missing.append('close_price/close')
    
    if missing:
        log(f"WARNING: Missing columns: {missing}")
    else:
        log("All critical columns present!")
    
    return fake_count == 0 and len(missing) == 0

def main():
    log("=" * 50)
    log("Starting VPS Database Complete Fix")
    log(f"Database: {DB_PATH}")
    log(f"Time: {datetime.now()}")
    log("=" * 50)
    
    if not os.path.exists(DB_PATH):
        log(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)
    
    # Run all fixes
    fix_stock_price_history_columns()
    fix_stocks_table_columns()
    delete_fake_stocks()
    fix_price_history_ticker_column()
    sync_prices_from_big_db()
    populate_cached_analysis()
    create_prediction_logs()
    create_signal_logs()
    create_outcome_logs()
    create_news_table()  # Create news_items table
    create_expert_tables()  # Create expert and platform tables
    
    # Verify
    success = verify_fixes()
    
    log("=" * 50)
    if success:
        log("All fixes applied successfully!")
    else:
        log("Some fixes may need manual verification")
    log("=" * 50)

if __name__ == '__main__':
    main()
