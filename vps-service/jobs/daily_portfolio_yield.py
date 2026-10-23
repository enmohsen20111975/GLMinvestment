#!/usr/bin/env python3
"""
daily_portfolio_yield.py
========================
Task 4 (Live Portfolio Overhaul): Daily portfolio yield + wealth tracking snapshot.

Runs at 3 AM (via cron or MarketScheduler) to:
  1. Compute accrued yield for bank/certificate/fund assets (daily interest).
  2. Sum portfolio values by asset type (stocks, gold, crypto, bank, cash).
  3. Record a daily snapshot in the `wealth_tracking` table for the equity curve.

Usage:
  python3 vps-service/jobs/daily_portfolio_yield.py
  # Or via cron: 0 3 * * * cd /home/z/my-project && python3 vps-service/jobs/daily_portfolio_yield.py >> logs/portfolio_yield.log 2>&1

Protocol: Does NOT touch .env or ecosystem.config.js. Pure read+write to stocks.db.
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, date
from pathlib import Path

# ── Setup paths ──────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parents[2]  # project root
STOCKS_DB = _ROOT / 'db' / 'stocks.db'
LOG_DIR = _ROOT / 'logs'
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [daily_portfolio_yield] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / 'portfolio_yield.log', encoding='utf-8'),
    ],
)
log = logging.getLogger(__name__)


WEALTH_TRACKING_DDL = """
CREATE TABLE IF NOT EXISTS wealth_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    snapshot_date TEXT NOT NULL,
    total_invested REAL DEFAULT 0,
    total_current_value REAL DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    total_pnl_pct REAL DEFAULT 0,
    stocks_value REAL DEFAULT 0,
    gold_value REAL DEFAULT 0,
    crypto_value REAL DEFAULT 0,
    bank_value REAL DEFAULT 0,
    cash_value REAL DEFAULT 0,
    other_value REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, snapshot_date)
)
"""

PORTFOLIO_ASSETS_DDL = """
CREATE TABLE IF NOT EXISTS portfolio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    portfolio_id TEXT DEFAULT 'default',
    type TEXT NOT NULL DEFAULT 'stock',
    name TEXT NOT NULL,
    total_invested REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    notes TEXT,
    weight_grams REAL,
    karat INTEGER,
    purchase_price_per_gram REAL,
    bank_name TEXT,
    interest_rate REAL,
    certificate_duration_months INTEGER,
    certificate_return_rate REAL,
    certificate_maturity_date TEXT,
    fund_name TEXT,
    fund_type TEXT,
    stock_id INTEGER,
    stock_ticker TEXT,
    quantity REAL,
    avg_buy_price REAL,
    market TEXT DEFAULT 'EGX',
    currency TEXT DEFAULT 'EGP',
    annual_return_rate REAL,
    return_type TEXT,
    purchase_date TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
"""


def ensure_tables(conn: sqlite3.Connection):
    """Create wealth_tracking + portfolio_assets tables if they don't exist."""
    cur = conn.cursor()
    cur.execute(WEALTH_TRACKING_DDL)
    cur.execute(PORTFOLIO_ASSETS_DDL)
    conn.commit()
    log.info("Ensured wealth_tracking + portfolio_assets tables exist")


def compute_asset_yield(asset: dict, now: datetime) -> float:
    """
    Compute the current value for a single asset, applying daily yield
    for bank/certificate/fund/deposit types.

    For interest-bearing assets:
      current_value = invested + (daily_interest * days_held)

    For other types, returns the stored current_value (updated by the
    live price refresh process).
    """
    asset_type = (asset.get('type') or 'other').lower()
    invested = float(asset.get('total_invested') or 0)
    current = float(asset.get('current_value') or 0)

    if asset_type in ('bank', 'certificate', 'fund', 'deposit'):
        rate = float(
            asset.get('interest_rate')
            or asset.get('certificate_return_rate')
            or asset.get('annual_return_rate')
            or asset.get('return_rate')
            or 0
        )
        return_type = (asset.get('return_type') or 'annual').lower()

        if rate > 0 and invested > 0:
            if return_type == 'daily':
                daily_interest = invested * (rate / 100)
            elif return_type == 'monthly':
                daily_interest = (invested * (rate / 100)) / 30
            else:  # annual
                daily_interest = (invested * (rate / 100)) / 365

            date_str = asset.get('purchase_date') or asset.get('added_at')
            start_ts = now.timestamp()
            if date_str:
                try:
                    start_ts = datetime.fromisoformat(str(date_str).replace('Z', '')).timestamp()
                except (ValueError, TypeError):
                    pass

            days_held = max(0, (now.timestamp() - start_ts) / 86400)
            accrued = daily_interest * days_held
            return invested + accrued

    # For non-yield assets, return stored current_value (or invested as fallback)
    if current > 0:
        return current
    return invested


def run():
    """Main entry point — computes and records daily wealth snapshots."""
    # B2.2: migrated from raw sqlite3.connect → db_manager
    from core.db_manager import db_manager

    if not STOCKS_DB.exists():
        log.error(f"stocks.db not found at {STOCKS_DB}")
        return False

    today = date.today().isoformat()
    now = datetime.now()

    try:
        with db_manager.connection('stocks', writable=True) as conn:
            ensure_tables(conn)

            # Fetch all portfolio assets grouped by user_id
            cur = conn.cursor()
            cur.execute("SELECT DISTINCT user_id FROM portfolio_assets WHERE user_id != ''")
            user_ids = [r[0] for r in cur.fetchall()]

            if not user_ids:
                log.info("No portfolio assets found — recording empty snapshot for 'default' user")
                user_ids = ['default']

            total_recorded = 0
            for uid in user_ids:
                cur.execute(
                    "SELECT * FROM portfolio_assets WHERE user_id = ?",
                    (uid,)
                )
                assets = [dict(r) for r in cur.fetchall()]

                total_invested = 0.0
                total_current = 0.0
                by_type = {
                    'stocks': 0.0, 'gold': 0.0, 'crypto': 0.0,
                    'bank': 0.0, 'cash': 0.0, 'other': 0.0,
                }

                for a in assets:
                    inv = float(a.get('total_invested') or 0)
                    cur_val = compute_asset_yield(a, now)
                    total_invested += inv
                    total_current += cur_val

                    t = (a.get('type') or 'other').lower()
                    if t == 'stock':
                        by_type['stocks'] += cur_val
                    elif t in ('gold', 'silver'):
                        by_type['gold'] += cur_val
                    elif t == 'crypto':
                        by_type['crypto'] += cur_val
                    elif t in ('bank', 'certificate', 'fund', 'deposit'):
                        by_type['bank'] += cur_val
                    elif t in ('currency', 'forex'):
                        by_type['cash'] += cur_val
                    else:
                        by_type['other'] += cur_val

                total_pnl = total_current - total_invested
                total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

                # Insert or replace today's snapshot
                cur.execute("""
                    INSERT OR REPLACE INTO wealth_tracking
                        (user_id, snapshot_date, total_invested, total_current_value,
                         total_pnl, total_pnl_pct, stocks_value, gold_value,
                         crypto_value, bank_value, cash_value, other_value)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    uid, today,
                    round(total_invested, 2), round(total_current, 2),
                    round(total_pnl, 2), round(total_pnl_pct, 2),
                    round(by_type['stocks'], 2), round(by_type['gold'], 2),
                    round(by_type['crypto'], 2), round(by_type['bank'], 2),
                    round(by_type['cash'], 2), round(by_type['other'], 2),
                ))
                total_recorded += 1
                log.info(
                    f"User {uid}: invested={total_invested:.2f} current={total_current:.2f} "
                    f"pnl={total_pnl:.2f} ({total_pnl_pct:.2f}%) | "
                    f"stocks={by_type['stocks']:.0f} gold={by_type['gold']:.0f} "
                    f"crypto={by_type['crypto']:.0f} bank={by_type['bank']:.0f}"
                )

            conn.commit()
            log.info(f"✓ Recorded {total_recorded} wealth snapshot(s) for {today}")
            return True

    except Exception as e:
        log.error(f"Failed to record wealth snapshots: {e}", exc_info=True)
        return False


if __name__ == '__main__':
    success = run()
    sys.exit(0 if success else 1)
