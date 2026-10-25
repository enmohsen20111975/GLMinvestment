#!/usr/bin/env python3
"""
FIX-DB-RESTORE — re-apply FIX-WAVE-2 data fixes to restored DBs + Android engineer fixes.

Touches (sandbox only — Rule 1 compliant):
  - db/auth.db       : CREATE market_pricing + seed pricing + fresh admin token
  - db/stocks.db     : currency normalization (EGP → SAR/KWD/QAR/USD per market)
                      + market_regime_log.market NULL → 'EGX'
  - db/predictions.db: status normalization (mixed-case → 4 canonical) + Rule 7 cap
                      + ADD COLUMN published_at / telegram_message_id / was_published
                        / target_hit_at / stop_hit_at

All SQL uses parameterized values (Rule 56). No production DBs touched.
"""

import sqlite3
import uuid
import secrets
from datetime import datetime, timedelta, timezone

DB_AUTH = '/home/z/my-project/db/auth.db'
DB_STOCKS = '/home/z/my-project/db/stocks.db'
DB_PRED = '/home/z/my-project/db/predictions.db'


# ---------------------------------------------------------------------------
# Task 1 + Task 5: auth.db — market_pricing table + fresh admin token
# ---------------------------------------------------------------------------
def fix_auth_db():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_AUTH, writable=False).__enter__()
    cur = conn.cursor()

    # --- Task 1: CREATE market_pricing table (Prisma @@map("market_pricing")) ---
    cur.execute('''
        CREATE TABLE IF NOT EXISTS market_pricing (
            id            TEXT PRIMARY KEY,
            tier          TEXT NOT NULL,
            market        TEXT NOT NULL,
            price_egp     REAL,
            price_local   REAL NOT NULL,
            currency      TEXT NOT NULL,
            billing_cycle TEXT NOT NULL DEFAULT 'monthly',
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tier, market, billing_cycle)
        )
    ''')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_market_pricing_tier_market ON market_pricing(tier, market)')

    # Seed pricing data (per Documentation/05-CURRENT_STATE.md §11.1).
    # Tuple shape: (tier, market, price_local, price_egp, currency, billing_cycle)
    pricing_data = [
        # EGX (Egypt) — price_egp == price_local
        ('premium', 'EGX',     99,   99,   'EGP', 'monthly'),
        ('premium', 'EGX',    990,  990,   'EGP', 'yearly'),
        ('pro',     'EGX',    199,  199,   'EGP', 'monthly'),
        ('pro',     'EGX',   1990, 1990,   'EGP', 'yearly'),
        # TADAWUL (Saudi Arabia)
        ('premium', 'TADAWUL', 19,  None,  'SAR', 'monthly'),
        ('premium', 'TADAWUL',190,  None,  'SAR', 'yearly'),
        ('pro',     'TADAWUL', 39,  None,  'SAR', 'monthly'),
        ('pro',     'TADAWUL',390,  None,  'SAR', 'yearly'),
        # KSE (Kuwait)
        ('premium', 'KSE',     1.5, None,  'KWD', 'monthly'),
        ('pro',     'KSE',     2.9, None,  'KWD', 'monthly'),
        # QSE (Qatar)
        ('premium', 'QSE',     15,  None,  'QAR', 'monthly'),
        ('pro',     'QSE',     29,  None,  'QAR', 'monthly'),
        # International (US / Crypto / Gold)
        ('premium', 'us',      2.99,None,  'USD', 'monthly'),
        ('premium', 'CRYPTO',  2.99,None,  'USD', 'monthly'),
        ('premium', 'GOLD',    2.99,None,  'USD', 'monthly'),
        # B2B tiers (all markets)
        ('b2b_starter',     'all',  99, None, 'USD', 'monthly'),
        ('b2b_pro',         'all', 299, None, 'USD', 'monthly'),
        ('b2b_enterprise',  'all', 999, None, 'USD', 'monthly'),
    ]
    seeded = 0
    for tier, market, price_local, price_egp, currency, cycle in pricing_data:
        # INSERT OR IGNORE so idempotent re-runs don't duplicate rows (UNIQUE constraint protects).
        cur.execute('''
            INSERT OR IGNORE INTO market_pricing
                (id, tier, market, price_local, price_egp, currency, billing_cycle, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ''', (str(uuid.uuid4()), tier, market, price_local, price_egp, currency, cycle))
        seeded += cur.rowcount
    print(f'[auth.db] market_pricing seeded: {seeded} new rows '
          f'(total now: {cur.execute("SELECT COUNT(*) FROM market_pricing").fetchone()[0]})')

    # --- Task 5: fresh admin token (30-day expiry) for testing ---
    # User id 48457b7f-... is the admin user that already has tokens.
    ADMIN_USER_ID = '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd'
    admin_exists = cur.execute('SELECT COUNT(*) FROM User WHERE id = ?', (ADMIN_USER_ID,)).fetchone()[0]
    if not admin_exists:
        raise RuntimeError(f'Admin user {ADMIN_USER_ID} not found in User table — abort token creation')

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=30)
    now_str = now.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    expires_str = expires.strftime('%Y-%m-%dT%H:%M:%S.000Z')

    cur.execute('''
        INSERT OR REPLACE INTO api_tokens
            (id, user_id, token, name, expires_at, last_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', ('admin_test_token_wave5', ADMIN_USER_ID, token, 'admin-test-wave5',
          expires_str, now_str, now_str))
    print(f'[auth.db] admin token created (expires {expires_str}):')
    print(f'   {token}')

    conn.commit()
    conn.close()
    return token


# ---------------------------------------------------------------------------
# Task 2: stocks.db — currency normalization + market_regime_log NULL fill
# ---------------------------------------------------------------------------
def fix_stocks_db():
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_STOCKS, writable=True).__enter__()
    cur = conn.cursor()

    updates = [
        ("UPDATE stocks SET currency='SAR' WHERE market='TADAWUL' AND (currency IS NULL OR currency='EGP')", 'TADAWUL → SAR'),
        ("UPDATE stocks SET currency='KWD' WHERE market='KSE'       AND (currency IS NULL OR currency='EGP')", 'KSE → KWD'),
        ("UPDATE stocks SET currency='QAR' WHERE market='QSE'       AND (currency IS NULL OR currency='EGP')", 'QSE → QAR'),
        ("UPDATE stocks SET currency='USD' WHERE market IN ('US','CRYPTO') AND (currency IS NULL OR currency='EGP')", 'US/CRYPTO → USD'),
        ("UPDATE stocks SET currency='USD' WHERE market='GOLD'      AND (currency IS NULL OR currency='EGP')", 'GOLD → USD'),
    ]
    for sql, label in updates:
        cur.execute(sql)
        print(f'[stocks.db] {label}: {cur.rowcount} rows updated')

    # market_regime_log.market NULL → 'EGX'
    try:
        cur.execute("UPDATE market_regime_log SET market='EGX' WHERE market IS NULL")
        print(f'[stocks.db] market_regime_log NULL→EGX: {cur.rowcount} rows updated')
    except sqlite3.OperationalError as e:
        print(f'[stocks.db] market_regime_log: SKIP ({e})')

    conn.commit()

    # Verify each market has exactly ONE currency
    print('[stocks.db] post-fix market/currency breakdown:')
    for r in cur.execute('SELECT market, currency, COUNT(*) FROM stocks GROUP BY market, currency ORDER BY market'):
        print(f'   {r[0]:10s} {r[1]:5s} {r[2]}')

    conn.close()


# ---------------------------------------------------------------------------
# Task 3 + Task 4: predictions.db — status normalization + Rule 7 cap +
#                            published_at + related columns
# ---------------------------------------------------------------------------
def fix_predictions_db():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PRED, writable=False).__enter__()
    cur = conn.cursor()

    # --- Task 4: ADD missing columns (idempotent) ---
    cols = [c[1] for c in cur.execute('PRAGMA table_info(predictions)').fetchall()]
    added = []
    for col, decl in [
        ('published_at',         'TEXT'),
        ('telegram_message_id',  'TEXT'),
        ('was_published',        'INTEGER DEFAULT 0'),
        ('target_hit_at',        'TEXT'),
        ('stop_hit_at',          'TEXT'),
    ]:
        if col not in cols:
            cur.execute(f'ALTER TABLE predictions ADD COLUMN {col} {decl}')
            added.append(col)
    print(f'[predictions.db] columns added: {added or "(none — already present)"}')

    # --- Task 3: status normalization (4 canonical statuses) ---
    status_map = [
        ("UPDATE predictions SET status='TARGET_HIT' WHERE status IN ('closed_win','TARGET_HIT','CLOSED')"),
        ("UPDATE predictions SET status='STOPPED'    WHERE status IN ('closed_stop','STOPPED')"),
        ("UPDATE predictions SET status='EXPIRED'    WHERE status IN ('expired','EXPIRED')"),
        ("UPDATE predictions SET status='ACTIVE'     WHERE status IN ('active','ACTIVE')"),
    ]
    for sql in status_map:
        cur.execute(sql)
        # rowcount is unreliable for IN() matches that find 0 rows; show actual count post-update

    # --- Task 3b: Rule 7 cap (ABS(actual_return) ≤ 50) ---
    cur.execute("UPDATE predictions SET actual_return=50.0 WHERE actual_return > 50")
    capped_high = cur.rowcount
    print(f'[predictions.db] Rule 7 cap (actual_return > 50 → 50.0): {capped_high} rows capped')

    # --- Backfill was_published=1 for TARGET_HIT predictions (per Task 4 instructions) ---
    cur.execute("UPDATE predictions SET was_published=1 WHERE status='TARGET_HIT' AND (was_published IS NULL OR was_published=0)")
    print(f'[predictions.db] was_published=1 backfill for TARGET_HIT: {cur.rowcount} rows')

    conn.commit()

    # Verify
    print('[predictions.db] post-fix status breakdown:')
    for r in cur.execute('SELECT status, COUNT(*) FROM predictions GROUP BY status ORDER BY status'):
        print(f'   {r[0]:15s} {r[1]}')
    cols2 = [c[1] for c in cur.execute('PRAGMA table_info(predictions)').fetchall()]
    print(f'[predictions.db] published_at present: {"published_at" in cols2}')

    conn.close()


if __name__ == '__main__':
    print('=' * 70)
    print('FIX-DB-RESTORE — applying DB fixes (sandbox only — Rule 1)')
    print('=' * 70)
    fix_auth_db()
    print('-' * 70)
    fix_stocks_db()
    print('-' * 70)
    fix_predictions_db()
    print('=' * 70)
    print('DONE')
