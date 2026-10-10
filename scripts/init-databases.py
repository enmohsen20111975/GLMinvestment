#!/usr/bin/env python3
"""
init-databases.py — إنشاء كل قواعد البيانات وجداولها
======================================================
يُشغّل مرة واحدة بعد git clone أو git pull لإنشاء كل الـ DBs.

Usage:
    python3 scripts/init-databases.py
"""
import sqlite3
import os
import sys
from pathlib import Path

# Project root
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)


def safe_connect(db_path: Path) -> sqlite3.Connection:
    """Connect with WAL mode for concurrent access."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_stocks_db():
    """Create stocks.db with full schema."""
    db_path = DB_DIR / "stocks.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT UNIQUE NOT NULL,
            name TEXT,
            name_ar TEXT,
            market TEXT DEFAULT 'EGX',
            sector TEXT,
            industry TEXT,
            current_price REAL,
            previous_close REAL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            volume INTEGER,
            market_cap REAL,
            pe_ratio REAL,
            pb_ratio REAL,
            ps_ratio REAL,
            eps REAL,
            roe REAL,
            roa REAL,
            dividend_yield REAL,
            debt_to_equity REAL,
            current_ratio REAL,
            book_value_per_share REAL,
            rsi REAL,
            ma_50 REAL,
            ma_200 REAL,
            support_level REAL,
            resistance_level REAL,
            is_halal INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            is_crypto INTEGER DEFAULT 0,
            egx30_member INTEGER DEFAULT 0,
            egx70_member INTEGER DEFAULT 0,
            egx100_member INTEGER DEFAULT 0,
            icon_url TEXT,
            last_update TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)")

    c.execute('''
        CREATE TABLE IF NOT EXISTS stock_daily_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            price_date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            change_percent REAL,
            fetch_time TEXT,
            UNIQUE(ticker, price_date)
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_sdp_ticker_date ON stock_daily_prices(ticker, price_date)")

    c.execute('''
        CREATE TABLE IF NOT EXISTS market_indices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            value REAL,
            change_percent REAL,
            market TEXT,
            last_update TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS maestro_personas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            persona_type TEXT NOT NULL,
            signal_type TEXT,
            confidence REAL DEFAULT 0.5,
            reasoning TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ stocks.db initialized ({db_path})")


def init_predictions_db():
    """Create predictions.db with full schema."""
    db_path = DB_DIR / "predictions.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT DEFAULT 'EGX',
            signal TEXT,
            confidence REAL DEFAULT 0.5,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            reasoning TEXT,
            indicators TEXT,
            news_summary TEXT,
            verify_date TEXT,
            verified INTEGER DEFAULT 0,
            final_price REAL,
            result TEXT,
            profit_loss_pct REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            prediction_type TEXT,
            log_data TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS persona_predictions (
            id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            market TEXT,
            persona_type TEXT,
            signal_type TEXT,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            prediction_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            analysis_type TEXT,
            analysis_data TEXT,
            score REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS stored_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            analysis_type TEXT,
            score REAL,
            data TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS platform_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            recommendation_type TEXT,
            signal TEXT,
            confidence REAL DEFAULT 0.5,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            reasoning TEXT,
            valid_until TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS expert_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            source TEXT,
            recommendation TEXT,
            target_price REAL,
            confidence REAL,
            date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ predictions.db initialized ({db_path})")


def init_price_history_db():
    """Create price_history.db."""
    db_path = DB_DIR / "price_history.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            adjusted_close REAL,
            source TEXT DEFAULT 'unknown',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, date)
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_ticker ON price_history(ticker)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_date ON price_history(date)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_ticker_date ON price_history(ticker, date)")

    conn.commit()
    conn.close()
    print(f"✅ price_history.db initialized ({db_path})")


def init_intraday_db():
    """Create intraday.db."""
    db_path = DB_DIR / "intraday.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS stock_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            volume INTEGER DEFAULT 0,
            open REAL DEFAULT 0,
            high REAL DEFAULT 0,
            low REAL DEFAULT 0,
            UNIQUE(ticker, timestamp)
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_stock_ticker_ts ON stock_intraday(ticker, timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_stock_ts ON stock_intraday(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_stock_market ON stock_intraday(market)")

    c.execute('''
        CREATE TABLE IF NOT EXISTS crypto_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            timestamp TEXT NOT NULL,
            price_usd REAL NOT NULL,
            change_24h REAL DEFAULT 0,
            volume_24h REAL DEFAULT 0,
            market_cap REAL DEFAULT 0,
            UNIQUE(symbol, timestamp)
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_crypto_symbol_ts ON crypto_intraday(symbol, timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_crypto_ts ON crypto_intraday(timestamp)")

    c.execute('''
        CREATE TABLE IF NOT EXISTS commodity_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            unit TEXT,
            UNIQUE(symbol, timestamp)
        )
    ''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_comm_symbol_ts ON commodity_intraday(symbol, timestamp)")

    c.execute('''
        CREATE TABLE IF NOT EXISTS intraday_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ intraday.db initialized ({db_path})")


def init_data_engine_db():
    """Create data_engine.db."""
    db_path = DB_DIR / "data_engine.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS stocks (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            price REAL,
            change_percent REAL,
            volume TEXT,
            market_cap TEXT,
            sector TEXT,
            market TEXT,
            tabs_data TEXT,
            last_update TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Tab tables
    for tab in ['technical_analysis', 'profitability', 'valuation', 'dividends',
                'performance', 'balance_sheet', 'income_statement', 'cash_flow']:
        c.execute(f'''
            CREATE TABLE IF NOT EXISTS tab_{tab} (
                symbol TEXT PRIMARY KEY,
                data TEXT
            )
        ''')

    conn.commit()
    conn.close()
    print(f"✅ data_engine.db initialized ({db_path})")


def init_crypto_db():
    """Create crypto.db."""
    db_path = DB_DIR / "crypto.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS cryptos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT,
            current_price REAL,
            market_cap REAL,
            volume_24h REAL,
            change_24h REAL,
            change_7d REAL,
            last_update TEXT,
            is_active INTEGER DEFAULT 1
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS crypto_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(symbol, date)
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS crypto_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            signal TEXT,
            confidence REAL,
            reasoning TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS sync_status (
            key TEXT PRIMARY KEY,
            value TEXT,
            last_update TEXT
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ crypto.db initialized ({db_path})")


def init_learned_db():
    """Create learned.db."""
    db_path = DB_DIR / "learned.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS learned_lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            market TEXT,
            lesson_type TEXT,
            lesson_data TEXT,
            confidence REAL DEFAULT 0.5,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ learned.db initialized ({db_path})")


def init_news_db():
    """Create news.db."""
    db_path = DB_DIR / "news.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            url TEXT UNIQUE,
            source TEXT,
            published_at TEXT,
            sentiment TEXT,
            related_tickers TEXT,
            summary TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ news.db initialized ({db_path})")


def init_community_db():
    """Create community.db."""
    db_path = DB_DIR / "community.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS community_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            username TEXT,
            content TEXT,
            ticker TEXT,
            market TEXT,
            likes INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ community.db initialized ({db_path})")


def init_analytics_db():
    """Create analytics.db."""
    db_path = DB_DIR / "analytics.db"
    conn = safe_connect(db_path)
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS prediction_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            signal TEXT,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            final_price REAL,
            result TEXT,
            profit_loss_pct REAL,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    conn.commit()
    conn.close()
    print(f"✅ analytics.db initialized ({db_path})")


def main():
    print("=" * 60)
    print("🗄️  Database Initialization Script")
    print("=" * 60)
    print(f"📁 DB Directory: {DB_DIR}")
    print()

    # Ensure db directory exists
    DB_DIR.mkdir(parents=True, exist_ok=True)

    # Initialize all databases
    try:
        init_stocks_db()
    except Exception as e:
        print(f"❌ stocks.db failed: {e}")

    try:
        init_predictions_db()
    except Exception as e:
        print(f"❌ predictions.db failed: {e}")

    try:
        init_price_history_db()
    except Exception as e:
        print(f"❌ price_history.db failed: {e}")

    try:
        init_intraday_db()
    except Exception as e:
        print(f"❌ intraday.db failed: {e}")

    try:
        init_data_engine_db()
    except Exception as e:
        print(f"❌ data_engine.db failed: {e}")

    try:
        init_crypto_db()
    except Exception as e:
        print(f"❌ crypto.db failed: {e}")

    try:
        init_learned_db()
    except Exception as e:
        print(f"❌ learned.db failed: {e}")

    try:
        init_news_db()
    except Exception as e:
        print(f"❌ news.db failed: {e}")

    try:
        init_community_db()
    except Exception as e:
        print(f"❌ community.db failed: {e}")

    try:
        init_analytics_db()
    except Exception as e:
        print(f"❌ analytics.db failed: {e}")

    # List created databases
    print()
    print("=" * 60)
    print("📊 Databases created:")
    for f in sorted(DB_DIR.glob("*.db")):
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"   {f.name:30s} {size_mb:8.2f} MB")
    print("=" * 60)
    print()
    print("✅ All databases initialized!")
    print("⚠️  Note: auth.db is managed by Prisma — run: npx prisma db push")
    print("⚠️  Note: stocks data needs to be fetched by data_engine")


if __name__ == "__main__":
    main()
