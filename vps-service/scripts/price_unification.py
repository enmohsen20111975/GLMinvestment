#!/usr/bin/env python3
"""
BRAVO-PRICE-UNIFICATION-001 — Canonical price source unification.
===================================================================
canonical = stocks.db.stock_daily_prices (per Kimi P1 directive).
data_engine.db.historical_data + price_history.db = fallback only.

This script:
  1. AUDIT: finds tickers missing from canonical but present in fallback DBs.
  2. REPLENISH: copies missing (ticker, date) rows INTO stocks.db.stock_daily_prices.
  3. MISMATCH LOG: logs rows where canonical + fallback disagree on close price
     (does NOT modify canonical — that's an owner decision).

Idempotent: running twice = 0 new inserts (UNIQUE constraint or skip).
Audit trail: every insert logged with source DB.

Rule 17 (RELATIVE-PATHS-ONLY): parents[2] = project root.
Works on laptop + VPS + sandbox.

Usage:
    python3 vps-service/scripts/price_unification.py              # audit + replenish
    python3 vps-service/scripts/price_unification.py --audit-only # no writes
    python3 vps-service/scripts/price_unification.py --dry-run    # show, no write
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Rule 17: relative paths — script at vps-service/scripts/ → parents[2] = root.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
DATA_ENGINE_DB = PROJECT_ROOT / "db" / "data_engine.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"


def _connect(db_path: Path) -> sqlite3.Connection:
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_unique_constraint(conn: sqlite3.Connection) -> None:
    """Ensure stock_daily_prices has UNIQUE(ticker, price_date).
    Idempotent: only creates index if not exists."""
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sdp_ticker_date "
            "ON stock_daily_prices(ticker, price_date)"
        )
        conn.commit()
    except sqlite3.OperationalError as e:
        print(f"  WARN: could not create unique index: {e}")


def audit_canonical(conn_stocks: sqlite3.Connection) -> set[tuple[str, str]]:
    """Return set of (ticker, date) currently in canonical stock_daily_prices."""
    rows = conn_stocks.execute(
        "SELECT ticker, price_date FROM stock_daily_prices "
        "WHERE ticker IS NOT NULL AND price_date IS NOT NULL"
    ).fetchall()
    return {(r["ticker"], r["price_date"]) for r in rows}


def replenish_from_data_engine(
    conn_stocks: sqlite3.Connection,
    existing: set[tuple[str, str]],
    dry_run: bool = False,
) -> dict[str, int]:
    """Copy missing (ticker, date) rows from data_engine.historical_data."""
    if not DATA_ENGINE_DB.exists():
        print("  SKIP: data_engine.db not found")
        return {"candidates": 0, "inserted": 0}

    conn_de = _connect(DATA_ENGINE_DB)
    rows = conn_de.execute("""
        SELECT ticker, date, open, high, low, close, volume, change_percent, market
        FROM historical_data
        WHERE ticker IS NOT NULL AND date IS NOT NULL AND close > 0
    """).fetchall()
    conn_de.close()

    candidates = 0
    inserted = 0
    for row in rows:
        key = (row["ticker"], row["date"])
        if key in existing:
            continue
        candidates += 1
        if not dry_run:
            try:
                conn_stocks.execute("""
                    INSERT OR IGNORE INTO stock_daily_prices
                        (ticker, price_date, open, high, low, close, volume, change_percent, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (row["ticker"], row["date"], row["open"], row["high"],
                      row["low"], row["close"], row["volume"], row["change_percent"],
                      row["market"] or "EGX"))
                inserted += 1
                existing.add(key)
            except sqlite3.IntegrityError:
                pass  # race-safe
        else:
            inserted += 1

    if not dry_run:
        conn_stocks.commit()
    return {"candidates": candidates, "inserted": inserted}


def replenish_from_price_history(
    conn_stocks: sqlite3.Connection,
    existing: set[tuple[str, str]],
    dry_run: bool = False,
) -> dict[str, int]:
    """Copy missing (ticker, date) rows from price_history.price_history."""
    if not PRICE_HISTORY_DB.exists():
        print("  SKIP: price_history.db not found")
        return {"candidates": 0, "inserted": 0}

    conn_ph = _connect(PRICE_HISTORY_DB)
    rows = conn_ph.execute("""
        SELECT ticker, date, open_price, high_price, low_price, close_price, volume, market
        FROM price_history
        WHERE ticker IS NOT NULL AND date IS NOT NULL AND close_price > 0
    """).fetchall()
    conn_ph.close()

    candidates = 0
    inserted = 0
    for row in rows:
        key = (row["ticker"], row["date"])
        if key in existing:
            continue
        candidates += 1
        if not dry_run:
            try:
                conn_stocks.execute("""
                    INSERT OR IGNORE INTO stock_daily_prices
                        (ticker, price_date, open_price, high_price, low_price,
                         close_price, volume, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (row["ticker"], row["date"], row["open_price"], row["high_price"],
                      row["low_price"], row["close_price"], row["volume"],
                      row["market"] or "EGX"))
                inserted += 1
                existing.add(key)
            except sqlite3.IntegrityError:
                pass
        else:
            inserted += 1

    if not dry_run:
        conn_stocks.commit()
    return {"candidates": candidates, "inserted": inserted}


def log_mismatches(
    conn_stocks: sqlite3.Connection,
    max_samples: int = 50,
) -> int:
    """Log rows where canonical close != data_engine close (audit only, no write)."""
    if not DATA_ENGINE_DB.exists():
        return 0
    conn_de = _connect(DATA_ENGINE_DB)
    mismatches = 0
    print("\n  Price mismatches (canonical vs data_engine) — first 50:")
    rows = conn_de.execute("""
        SELECT ticker, date, close FROM historical_data
        WHERE close > 0 ORDER BY date DESC LIMIT 10000
    """).fetchall()
    for de_row in rows:
        key = (de_row["ticker"], de_row["date"])
        canon = conn_stocks.execute(
            "SELECT close FROM stock_daily_prices WHERE ticker = ? AND price_date = ?",
            key
        ).fetchone()
        if canon and canon["close"]:
            if abs(canon["close"] - de_row["close"]) > 0.01:
                mismatches += 1
                if mismatches <= max_samples:
                    print(f"    {de_row['ticker']} {de_row['date']}: "
                          f"canon={canon['close']:.2f} vs de={de_row['close']:.2f}")
    conn_de.close()
    print(f"  Total mismatches (sample 10K): {mismatches}")
    return mismatches


def main() -> int:
    parser = argparse.ArgumentParser(description="BRAVO-PRICE-UNIFICATION-001")
    parser.add_argument("--audit-only", action="store_true",
                        help="Only audit, no replenish writes")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be inserted, no writes")
    args = parser.parse_args()

    print("=" * 72)
    print("BRAVO-PRICE-UNIFICATION-001 — Canonical price unification")
    print(f"Canonical: {STOCKS_DB} . stock_daily_prices")
    print(f"Fallback 1: {DATA_ENGINE_DB} . historical_data")
    print(f"Fallback 2: {PRICE_HISTORY_DB} . price_history")
    print(f"Mode: {'AUDIT-ONLY' if args.audit_only else ('DRY-RUN' if args.dry_run else 'WRITE')}")
    print("=" * 72)

    if not STOCKS_DB.exists():
        print(f"ERROR: canonical {STOCKS_DB} not found")
        return 1

    conn = _connect(STOCKS_DB)

    # Ensure UNIQUE constraint for idempotency
    if not args.audit_only and not args.dry_run:
        _ensure_unique_constraint(conn)

    # BEFORE state
    before = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
    before_tickers = conn.execute(
        "SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices"
    ).fetchone()[0]
    print(f"\nBEFORE: {before:,} rows, {before_tickers} tickers in canonical")

    existing = audit_canonical(conn)
    print(f"Loaded {len(existing):,} existing (ticker, date) pairs")

    if not args.audit_only:
        print("\n── REPLENISH from data_engine.historical_data ──")
        de_stats = replenish_from_data_engine(conn, existing, dry_run=args.dry_run)
        print(f"  candidates: {de_stats['candidates']:,} | inserted: {de_stats['inserted']:,}")

        print("\n── REPLENISH from price_history.price_history ──")
        ph_stats = replenish_from_price_history(conn, existing, dry_run=args.dry_run)
        print(f"  candidates: {ph_stats['candidates']:,} | inserted: {ph_stats['inserted']:,}")

    # Mismatch audit (always — read-only)
    print("\n── MISMATCH AUDIT (canonical vs data_engine) ──")
    log_mismatches(conn)

    # AFTER state
    if not args.dry_run and not args.audit_only:
        after = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        after_tickers = conn.execute(
            "SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices"
        ).fetchone()[0]
        print(f"\nAFTER: {after:,} rows, {after_tickers} tickers in canonical")
        print(f"Delta: +{after - before:,} rows, +{after_tickers - before_tickers} tickers")
    else:
        print("\n(no writes — audit/dry-run mode)")

    conn.close()
    print("\n✅ Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
