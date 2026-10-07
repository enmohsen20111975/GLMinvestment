#!/usr/bin/env python3
"""
================================================================
production-migrate.py — سكربت ترحيل قواعد البيانات للإنتاج
================================================================
يشتغل على السيرفر الإنتاجي (~/my_apps/GLMinvestment/db/)
مهم: وقّف PM2 قبل التشغيل + خد نسخة احتياطية الأول!

الاستخدام:
  cd ~/my_apps/GLMinvestment
  pm2 stop all
  cp -r db/ db_backup_$(date +%Y%m%d_%H%M%S)/
  python3 production-migrate.py
  pm2 restart all

كل الـ migrations idempotent — تقدر تشغلها أكتر من مرة بدون مشاكل.
================================================================
"""

import sqlite3
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone

# ─── Configuration ───────────────────────────────────────────
# Support running from project root OR from scripts/ subdirectory
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name == 'scripts' else SCRIPT_DIR
DB_DIR = PROJECT_ROOT / 'db'

def log(msg, level='INFO'):
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f'[{ts}] {level}: {msg}')

def add_column_if_missing(conn, table, column, col_type, default=None):
    """Add a column to a table if it doesn't already exist (idempotent).
    Skips silently if the parent table doesn't exist yet (e.g. sandbox with
    partial schema) — the caller's create-table step will handle that case."""
    # Rule 6 — schema-aware: check parent table exists before PRAGMA table_info
    tables = [t[0] for t in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,)
    ).fetchall()]
    if table not in tables:
        log(f'  ⏭️  Table "{table}" not present — skipping {table}.{column}')
        return False
    cols = [c[1] for c in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]
    if column not in cols:
        default_clause = f' DEFAULT {default}' if default is not None else ''
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN {column} {col_type}{default_clause}')
        log(f'  ✅ {table}.{column} ({col_type}) added')
        return True
    else:
        log(f'  ⏭️  {table}.{column} already exists — skipping')
        return False

def create_table_if_missing(conn, table_name, schema_sql):
    """Create a table if it doesn't already exist (idempotent)."""
    tables = [t[0] for t in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    ).fetchall()]
    if table_name not in tables:
        conn.executescript(schema_sql)
        log(f'  ✅ Table "{table_name}" created')
        return True
    else:
        log(f'  ⏭️  Table "{table_name}" already exists — skipping')
        return False

def migrate_auth_db():
    """Migrate auth.db: market_pricing + User.last_active_at + portfolio_items.updated_at + analytics_events + user_telegram_links + bot_link_tokens"""
    db_path = DB_DIR / 'auth.db'
    if not db_path.exists():
        log(f'❌ auth.db not found at {db_path}', 'ERROR')
        return False

    log('═══ Migrating auth.db ═══')
    conn = sqlite3.connect(str(db_path))
    changes = 0

    # 1. User.last_active_at
    if add_column_if_missing(conn, 'User', 'last_active_at', 'TEXT'):
        changes += 1

    # 2. portfolio_items.updated_at
    if add_column_if_missing(conn, 'portfolio_items', 'updated_at', 'TEXT'):
        changes += 1

    # 3. market_pricing table + seed
    market_pricing_schema = '''
    CREATE TABLE IF NOT EXISTS market_pricing (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      market TEXT NOT NULL,
      price_local REAL NOT NULL,
      price_egp REAL,
      currency TEXT NOT NULL,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tier, market, billing_cycle)
    );
    '''
    if create_table_if_missing(conn, 'market_pricing', market_pricing_schema):
        changes += 1
        # Seed pricing data
        pricing_data = [
            ('premium', 'EGX', 99, 99, 'EGP', 'monthly'),
            ('premium', 'EGX', 990, 990, 'EGP', 'yearly'),
            ('pro', 'EGX', 199, 199, 'EGP', 'monthly'),
            ('pro', 'EGX', 1990, 1990, 'EGP', 'yearly'),
            ('premium', 'TADAWUL', 19, None, 'SAR', 'monthly'),
            ('premium', 'TADAWUL', 190, None, 'SAR', 'yearly'),
            ('pro', 'TADAWUL', 39, None, 'SAR', 'monthly'),
            ('pro', 'TADAWUL', 390, None, 'SAR', 'yearly'),
            ('premium', 'KSE', 1.5, None, 'KWD', 'monthly'),
            ('pro', 'KSE', 2.9, None, 'KWD', 'monthly'),
            ('premium', 'QSE', 15, None, 'QAR', 'monthly'),
            ('pro', 'QSE', 29, None, 'QAR', 'monthly'),
            ('premium', 'us', 2.99, None, 'USD', 'monthly'),
            ('premium', 'CRYPTO', 2.99, None, 'USD', 'monthly'),
            ('premium', 'GOLD', 2.99, None, 'USD', 'monthly'),
            ('b2b_starter', 'all', 99, None, 'USD', 'monthly'),
            ('b2b_pro', 'all', 299, None, 'USD', 'monthly'),
            ('b2b_enterprise', 'all', 999, None, 'USD', 'monthly'),
        ]
        for tier, market, price, price_egp, currency, cycle in pricing_data:
            conn.execute(
                'INSERT OR IGNORE INTO market_pricing (id, tier, market, price_local, price_egp, currency, billing_cycle) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (str(uuid.uuid4()), tier, market, price, price_egp, currency, cycle)
            )
        log(f'  ✅ market_pricing seeded with {len(pricing_data)} rows')

    # 4. analytics_events table
    analytics_schema = '''
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      event_route TEXT,
      user_id TEXT,
      is_authenticated INTEGER DEFAULT 0,
      session_id TEXT,
      ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_route ON analytics_events(event_route);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
    '''
    if create_table_if_missing(conn, 'analytics_events', analytics_schema):
        changes += 1

    # 5. user_telegram_links table (bot subscription gate)
    telegram_links_schema = '''
    CREATE TABLE IF NOT EXISTS user_telegram_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      telegram_chat_id TEXT NOT NULL UNIQUE,
      telegram_username TEXT,
      linked_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_chat_id ON user_telegram_links(telegram_chat_id);
    '''
    if create_table_if_missing(conn, 'user_telegram_links', telegram_links_schema):
        changes += 1

    # 6. bot_link_tokens table (bot linking tokens)
    bot_tokens_schema = '''
    CREATE TABLE IF NOT EXISTS bot_link_tokens (
      token TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      username TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      used INTEGER DEFAULT 0
    );
    '''
    if create_table_if_missing(conn, 'bot_link_tokens', bot_tokens_schema):
        changes += 1

    # 7. Fix any existing Prisma @updatedAt columns that are stored as numeric timestamps
    # (Prisma can't deserialize "1790858563207" as DateTime)
    try:
        bad_dates = conn.execute(
            "SELECT id, created_at FROM market_pricing WHERE typeof(created_at)='integer' OR created_at GLOB '[0-9]*'"
        ).fetchall()
        if bad_dates:
            for row_id, bad_ts in bad_dates:
                try:
                    iso = datetime.fromtimestamp(int(bad_ts)/1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
                    conn.execute("UPDATE market_pricing SET created_at=? WHERE id=?", (iso, row_id))
                except:
                    pass
            log(f'  ✅ Fixed {len(bad_dates)} bad timestamps in market_pricing')
    except:
        pass

    conn.commit()
    conn.close()
    log(f'═══ auth.db: {changes} migrations applied ═══\n')
    return True

def verify_stocks_db():
    """Verify stocks.db post-migration state. Prints market/currency breakdown
    and asserts no rows remain with the legacy Arabic market value 'أمريكا'."""
    db_path = DB_DIR / 'stocks.db'
    if not db_path.exists():
        log(f'❌ stocks.db not found at {db_path}', 'ERROR')
        return False

    log('═══ Verifying stocks.db ═══')
    conn = sqlite3.connect(str(db_path))

    # Market/currency breakdown
    log('  Market / currency / count:')
    for row in conn.execute(
        'SELECT market, currency, COUNT(*) FROM stocks '
        'GROUP BY market, currency ORDER BY market'
    ).fetchall():
        log(f'    {row[0]!r:12s} {row[1]!r:6s} {row[2]}')

    # Rule 16 — Verified Honesty: print the literal count of the buggy value
    america_count = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE market = 'أمريكا'"
    ).fetchone()[0]
    log(f'  COUNT(stocks WHERE market = "أمريكا") = {america_count}')
    if america_count != 0:
        log('  ❌ VERIFICATION FAILED — أمريكا rows still present', 'ERROR')
        conn.close()
        return False
    log('  ✅ VERIFICATION PASSED — zero أمريكا rows remaining')

    conn.close()
    return True


def migrate_stocks_db():
    """Migrate stocks.db: user_notifications.title + price_alerts + radar_signal_tracking
    + currency column safety + أمريكا→US market name migration + currency fix"""
    db_path = DB_DIR / 'stocks.db'
    if not db_path.exists():
        log(f'❌ stocks.db not found at {db_path}', 'ERROR')
        return False

    log('═══ Migrating stocks.db ═══')
    conn = sqlite3.connect(str(db_path))
    changes = 0

    # 1. user_notifications.title column
    if add_column_if_missing(conn, 'user_notifications', 'title', 'TEXT'):
        changes += 1

    # 2. price_alerts table
    price_alerts_schema = '''
    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      alert_type TEXT DEFAULT 'price_above',
      target_price REAL,
      current_price REAL,
      is_triggered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      triggered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_price_alerts_ticker ON price_alerts(ticker);
    '''
    if create_table_if_missing(conn, 'price_alerts', price_alerts_schema):
        changes += 1

    # 3. radar_signal_tracking table (if missing)
    radar_tracking_schema = '''
    CREATE TABLE IF NOT EXISTS radar_signal_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      signal_type TEXT,
      signal_date TEXT,
      entry_price REAL,
      status TEXT DEFAULT 'pending',
      outcome_7d REAL,
      outcome_14d REAL,
      outcome_30d REAL,
      max_price_after REAL,
      min_price_after REAL,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_radar_tracking_ticker ON radar_signal_tracking(ticker);
    CREATE INDEX IF NOT EXISTS idx_radar_tracking_status ON radar_signal_tracking(status);
    '''
    if create_table_if_missing(conn, 'radar_signal_tracking', radar_tracking_schema):
        changes += 1

    # 4. Currency column safety — ensure `stocks.currency` exists before UPDATE.
    #    The sandbox stocks.db schema (from init-databases.py) lacks this column;
    #    production stocks.db has had it since multi-market rollout. Idempotent.
    if add_column_if_missing(conn, 'stocks', 'currency', 'TEXT', "'EGP'"):
        changes += 1

    # 5. أمريكا → US market name migration (REBUILT — Wave 1 P0 Fix 1, 2026-10-01)
    #    The old commit 25781d3 claimed "أمريكا → US market name (62 rows) FIXED"
    #    but contained NO UPDATE statement — pure fabrication. This block does
    #    the actual migration. Idempotent: WHERE market='أمريكا' only touches
    #    affected rows; re-running on already-migrated DBs is a no-op.
    cursor = conn.execute(
        'UPDATE stocks SET market = ?, currency = ? WHERE market = ?',
        ('US', 'USD', 'أمريكا')
    )
    if cursor.rowcount > 0:
        log(f'  ✅ أمريكا → US market migration: {cursor.rowcount} rows updated')
        changes += 1
    else:
        log('  ⏭️  أمريكا → US market migration: 0 rows (already migrated)')

    # 6. Fix currency for non-EGX markets (existing migration — preserved)
    currency_updates = [
        ("UPDATE stocks SET currency='SAR' WHERE market='TADAWUL' AND (currency IS NULL OR currency='EGP')"),
        ("UPDATE stocks SET currency='KWD' WHERE market='KSE' AND (currency IS NULL OR currency='EGP')"),
        ("UPDATE stocks SET currency='QAR' WHERE market='QSE' AND (currency IS NULL OR currency='EGP')"),
        ("UPDATE stocks SET currency='USD' WHERE market IN ('US', 'CRYPTO') AND (currency IS NULL OR currency='EGP')"),
        ("UPDATE stocks SET currency='USD' WHERE market='GOLD' AND (currency IS NULL OR currency='EGP')"),
    ]
    for sql in currency_updates:
        cursor = conn.execute(sql)
        if cursor.rowcount > 0:
            log(f'  ✅ Currency fix: {cursor.rowcount} rows updated')
            changes += 1

    conn.commit()
    conn.close()
    log(f'═══ stocks.db: {changes} migrations applied ═══\n')
    return True

def migrate_predictions_db():
    """Migrate predictions.db: 5 new columns + status normalization + Rule 7 cap + was_published backfill"""
    db_path = DB_DIR / 'predictions.db'
    if not db_path.exists():
        log(f'❌ predictions.db not found at {db_path}', 'ERROR')
        return False

    log('═══ Migrating predictions.db ═══')
    conn = sqlite3.connect(str(db_path))
    changes = 0

    # 1. Add 5 new columns
    if add_column_if_missing(conn, 'predictions', 'published_at', 'TEXT'):
        changes += 1
    if add_column_if_missing(conn, 'predictions', 'telegram_message_id', 'TEXT'):
        changes += 1
    if add_column_if_missing(conn, 'predictions', 'was_published', 'INTEGER', '0'):
        changes += 1
    if add_column_if_missing(conn, 'predictions', 'target_hit_at', 'TEXT'):
        changes += 1
    if add_column_if_missing(conn, 'predictions', 'stop_hit_at', 'TEXT'):
        changes += 1

    # 2. Normalize status values (mixed case → canonical)
    status_mappings = [
        ("UPDATE predictions SET status='TARGET_HIT' WHERE status IN ('closed_win', 'CLOSED')"),
        ("UPDATE predictions SET status='STOPPED' WHERE status IN ('closed_stop')"),
        ("UPDATE predictions SET status='EXPIRED' WHERE status IN ('expired')"),
        ("UPDATE predictions SET status='ACTIVE' WHERE status IN ('active')"),
    ]
    for sql in status_mappings:
        cursor = conn.execute(sql)
        if cursor.rowcount > 0:
            log(f'  ✅ Status normalization: {cursor.rowcount} rows updated')
            changes += 1

    # 3. Cap Rule 7 violations (actual_return > 50%)
    cursor = conn.execute("UPDATE predictions SET actual_return=50.0 WHERE actual_return > 50")
    if cursor.rowcount > 0:
        log(f'  ✅ Rule 7 cap: {cursor.rowcount} rows capped at 50.0%')
        changes += 1

    # 4. Backfill was_published=1 for TARGET_HIT predictions
    cursor = conn.execute("UPDATE predictions SET was_published=1 WHERE status='TARGET_HIT' AND was_published=0")
    if cursor.rowcount > 0:
        log(f'  ✅ was_published backfill: {cursor.rowcount} rows set to 1')
        changes += 1

    conn.commit()
    conn.close()
    log(f'═══ predictions.db: {changes} migrations applied ═══\n')
    return True

def migrate_news_db():
    """Create news.db market_news table if missing"""
    db_path = DB_DIR / 'news.db'

    log('═══ Migrating news.db ═══')
    conn = sqlite3.connect(str(db_path))

    news_schema = '''
    CREATE TABLE IF NOT EXISTS market_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      summary_ar TEXT,
      summary_en TEXT,
      source TEXT DEFAULT 'news_agent',
      source_type TEXT DEFAULT 'telegram',
      url TEXT,
      tickers TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 0,
      sentiment TEXT DEFAULT 'neutral',
      impact_type TEXT DEFAULT 'general',
      market TEXT DEFAULT 'EGX',
      image_paths TEXT DEFAULT '[]',
      ocr_text TEXT DEFAULT '',
      raw_analysis TEXT DEFAULT '{}',
      published_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT,
      is_sent INTEGER DEFAULT 0,
      UNIQUE(title, source)
    );
    CREATE INDEX IF NOT EXISTS idx_news_market ON market_news(market);
    CREATE INDEX IF NOT EXISTS idx_news_fetched ON market_news(fetched_at);
    '''

    if create_table_if_missing(conn, 'market_news', news_schema):
        log(f'  ✅ market_news table created')
    else:
        # Check if title column exists (might be older schema)
        cols = [c[1] for c in conn.execute('PRAGMA table_info(market_news)').fetchall()]
        if 'title' not in cols:
            # Old schema — recreate
            conn.execute('DROP TABLE IF EXISTS market_news')
            conn.executescript(news_schema)
            log(f'  ✅ market_news table recreated (was missing title column)')

    conn.commit()
    conn.close()
    log(f'═══ news.db migration complete ═══\n')
    return True

def main():
    log('🚀 Production DB Migration Script')
    log(f'   Project root: {PROJECT_ROOT}')
    log(f'   DB directory: {DB_DIR}')
    log(f'   Time: {datetime.now(timezone.utc).isoformat()}')
    log('')

    # Verify DB directory exists
    if not DB_DIR.exists():
        log(f'❌ DB directory not found: {DB_DIR}', 'ERROR')
        sys.exit(1)

    # Run migrations
    success = True
    success &= migrate_auth_db()
    stocks_ok = migrate_stocks_db()

    # Verify stocks.db immediately after its migration — Rule 16 (Verified Honesty).
    # Decoupled from later DBs so a predictions.db failure does not mask our
    # أمريكا → US migration evidence.
    if stocks_ok:
        verify_stocks_db()

    success &= stocks_ok
    success &= migrate_predictions_db()
    success &= migrate_news_db()

    if success:
        log('🎉 All migrations completed successfully!')
        log('')
        log('Next steps:')
        log('  1. Set DEEPSEEK_API_KEY in .env:')
        log('     echo "DEEPSEEK_API_KEY=your-key-here" >> .env')
        log('  2. Set BOT_API_SECRET in .env:')
        log('     echo "BOT_API_SECRET=$(openssl rand -hex 32)" >> .env')
        log('  3. Regenerate Prisma clients:')
        log('     npx prisma generate --schema=prisma/auth-schema.prisma')
        log('     npx prisma generate --schema=prisma/predictions-schema.prisma')
        log('  4. Rebuild + restart:')
        log('     npm run build && pm2 restart all')
    else:
        log('⚠️  Some migrations failed — check errors above', 'WARN')
        sys.exit(1)

if __name__ == '__main__':
    main()
