#!/usr/bin/env python3
"""
scripts/migrate_stocks_to_data_engine.py
=========================================
BRAVO-DATA-LAYER migration script (2026-10-29) — PERMANENT, IDEMPOTENT.

Owner directive: "مافيش ملفات جديدة ولا جداول ولا قواعد بيانات جديدة"
This script does NOT create new tables. It:
  1. ALTERs existing data_engine.db.stocks (adds 84 TV columns)
  2. ALTERs existing data_engine.db.historical_data (adds 19 indicator columns)
  3. Migrates stocks.db.stocks → data_engine.db.stocks (1,240 rows)
  4. Migrates stocks.db.stock_daily_prices → data_engine.db.historical_data (90K rows)
  5. Migrates stocks.db.stock_indicators → data_engine.db.historical_data (295 rows)

SAFE TO RE-RUN: detects existing columns and skips them. Safe to run multiple times.

Usage:
  python3 scripts/migrate_stocks_to_data_engine.py
  python3 scripts/migrate_stocks_to_data_engine.py --stocks-db /path/to/stocks.db
  python3 scripts/migrate_stocks_to_data_engine.py --dry-run
"""
import argparse
import sqlite3
import sys
from pathlib import Path

# Default paths — auto-detect PROJECT_ROOT from script location
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
DEFAULT_DE_DB = PROJECT_ROOT / "db" / "data_engine.db"


def log(msg):
    print(f"  {msg}")


def step(n, title):
    print(f"\n{'='*72}")
    print(f"  STEP {n}: {title}")
    print(f"{'='*72}")


def get_existing_columns(conn, table):
    """Get set of column names for a table."""
    cur = conn.cursor()
    return {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}


def alter_add_columns(conn, table, columns_to_add, dry_run=False):
    """ALTER TABLE ADD COLUMN for each missing column. Idempotent.

    Args:
        conn: sqlite3 connection
        table: table name
        columns_to_add: list of (col_name, col_type) tuples
    Returns:
        number of columns actually added
    """
    if dry_run:
        existing = get_existing_columns(conn, table)
        missing = [c for c in columns_to_add if c[0] not in existing]
        log(f"[DRY-RUN] would add {len(missing)} columns to {table}")
        return 0
    cur = conn.cursor()
    existing = get_existing_columns(conn, table)
    added = 0
    for col, typ in columns_to_add:
        if col in existing:
            continue
        try:
            cur.execute(f'ALTER TABLE {table} ADD COLUMN "{col}" {typ}')
            added += 1
            existing.add(col)
        except Exception as e:
            log(f"  ⚠️ couldn't add {table}.{col}: {e}")
    conn.commit()
    return added


def migrate_stocks_table(sconn, dconn, dry_run=False):
    """Migrate stocks.db.stocks → data_engine.db.stocks.

    Column mapping: ticker→symbol, current_price→price, last_updated→last_update
    """
    step(3, "MIGRATE stocks.db.stocks → data_engine.db.stocks")
    scur = sconn.cursor()
    dcur = dconn.cursor()

    s_cols = [r[1] for r in scur.execute("PRAGMA table_info(stocks)").fetchall()]
    de_cols = get_existing_columns(dconn, "stocks")

    # Map stocks.db columns → data_engine.db columns
    col_map = {}
    for sc in s_cols:
        if sc == "ticker":
            col_map[sc] = "symbol" if "symbol" in de_cols else None
        elif sc == "current_price":
            col_map[sc] = "price" if "price" in de_cols else None
        elif sc == "last_updated":
            col_map[sc] = "last_update" if "last_update" in de_cols else None
        elif sc in de_cols:
            col_map[sc] = sc
        elif sc == "id":
            col_map[sc] = None  # skip PK
        else:
            col_map[sc] = None  # not in DE

    src_cols = [k for k, v in col_map.items() if v is not None]
    dst_cols = [col_map[k] for k in src_cols]

    if dry_run:
        rows_count = scur.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        log(f"[DRY-RUN] would migrate {rows_count} rows, {len(src_cols)} columns")
        return 0

    # Ensure unique index on symbol (for ON CONFLICT)
    try:
        dcur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_de_stocks_symbol ON stocks(symbol)')
        dconn.commit()
    except Exception:
        pass

    placeholders = ", ".join(["?"] * len(src_cols))
    col_list = ", ".join(f'"{c}"' for c in dst_cols)
    conflict_col = "symbol"
    update_cols = [c for c in dst_cols if c != conflict_col and c != "id"]
    update_set = ", ".join(f'"{c}" = COALESCE(excluded."{c}", stocks."{c}")' for c in update_cols)

    sql = f'''
        INSERT INTO stocks ({col_list})
        VALUES ({placeholders})
        ON CONFLICT({conflict_col}) DO UPDATE SET {update_set}
    '''

    rows = scur.execute(f"SELECT {', '.join(src_cols)} FROM stocks").fetchall()
    log(f"migrating {len(rows)} rows...")
    migrated = 0
    errors = 0
    for row in rows:
        vals = [row[k] for k in src_cols]
        try:
            dcur.execute(sql, vals)
            migrated += 1
        except Exception as e:
            if errors < 3:
                log(f"  ⚠️ error {row[col_map.get('ticker','symbol')]}: {e}")
            errors += 1
    dconn.commit()
    log(f"✅ migrated {migrated}/{len(rows)} rows (errors: {errors})")
    return migrated


def migrate_daily_prices(sconn, dconn, dry_run=False):
    """Migrate stocks.db.stock_daily_prices → data_engine.db.historical_data."""
    step(4, "MIGRATE stocks.db.stock_daily_prices → data_engine.db.historical_data")
    scur = sconn.cursor()
    dcur = dconn.cursor()

    # Ensure unique index on (ticker, date)
    try:
        dcur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_ticker_date ON historical_data(ticker, date)')
        dconn.commit()
    except Exception:
        pass

    hd_cols = get_existing_columns(dconn, "historical_data")
    src_map = {
        "ticker": "ticker",
        "price_date": "date",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
        "change_percent": "change_percent",
        "market": "market",
    }
    dst_cols = [v for v in src_map.values() if v in hd_cols]
    src_cols_kept = [k for k, v in src_map.items() if v in hd_cols]

    # Build SELECT with COALESCE for OHLC (prefer short name, fallback to _price)
    select_parts = []
    for sc in src_cols_kept:
        dc = src_map[sc]
        if sc == "open":
            select_parts.append("COALESCE(open, open_price) as open")
        elif sc == "high":
            select_parts.append("COALESCE(high, high_price) as high")
        elif sc == "low":
            select_parts.append("COALESCE(low, low_price) as low")
        elif sc == "close":
            select_parts.append("COALESCE(close, close_price) as close")
        else:
            select_parts.append(f"{sc} as {dc}")

    if dry_run:
        count = scur.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE ticker IS NOT NULL AND price_date IS NOT NULL").fetchone()[0]
        log(f"[DRY-RUN] would migrate {count:,} rows")
        return 0

    select_sql = f"SELECT {', '.join(select_parts)} FROM stock_daily_prices WHERE ticker IS NOT NULL AND price_date IS NOT NULL"
    placeholders = ", ".join(["?"] * len(dst_cols))
    col_list = ", ".join(f'"{c}"' for c in dst_cols)
    update_cols = [c for c in dst_cols if c not in ("ticker", "date")]
    update_set = ", ".join(f'"{c}" = COALESCE(excluded."{c}", historical_data."{c}")' for c in update_cols)

    sql = f'''
        INSERT INTO historical_data ({col_list})
        VALUES ({placeholders})
        ON CONFLICT(ticker, date) DO UPDATE SET {update_set}
    '''

    rows = scur.execute(select_sql).fetchall()
    log(f"migrating {len(rows):,} rows...")
    migrated = 0
    errors = 0
    batch = []
    batch_size = 5000
    for row in rows:
        vals = [row[k] for k in dst_cols]
        batch.append(vals)
        if len(batch) >= batch_size:
            try:
                dcur.executemany(sql, batch)
                migrated += len(batch)
            except Exception as e:
                errors += len(batch)
                if errors <= 3:
                    log(f"  ⚠️ batch error: {e}")
            batch = []
            dconn.commit()
            if migrated % 10000 == 0:
                log(f"  ... {migrated:,}/{len(rows):,}")
    if batch:
        try:
            dcur.executemany(sql, batch)
            migrated += len(batch)
        except Exception as e:
            errors += len(batch)
    dconn.commit()
    log(f"✅ migrated {migrated:,}/{len(rows):,} rows (errors: {errors})")
    return migrated


def migrate_indicators(sconn, dconn, dry_run=False):
    """Migrate stocks.db.stock_indicators → data_engine.db.historical_data (indicator columns)."""
    step(5, "MIGRATE stocks.db.stock_indicators → data_engine.db.historical_data")
    scur = sconn.cursor()
    dcur = dconn.cursor()

    hd_cols = get_existing_columns(dconn, "historical_data")
    ind_cols_all = [r[1] for r in scur.execute("PRAGMA table_info(stock_indicators)").fetchall()]
    ind_data_cols = [c for c in ind_cols_all if c not in ("ticker", "market", "date", "fetch_time", "source")]
    ind_data_cols = [c for c in ind_data_cols if c in hd_cols]
    log(f"indicator columns to merge: {len(ind_data_cols)}")

    if dry_run:
        count = scur.execute("SELECT COUNT(*) FROM stock_indicators").fetchone()[0]
        log(f"[DRY-RUN] would merge {count} indicator rows")
        return 0

    if not ind_data_cols:
        log("no indicator columns to merge — skipping (stocks.db may not have stock_indicators table with matching columns)")
        return 0

    set_clause = ", ".join(f'"{c}" = ?' for c in ind_data_cols)
    update_sql = f'UPDATE historical_data SET {set_clause} WHERE ticker = ? AND date = ?'

    rows = scur.execute(f"SELECT ticker, date, {', '.join(ind_data_cols)} FROM stock_indicators").fetchall()
    log(f"migrating {len(rows)} indicator rows...")
    migrated = 0
    for row in rows:
        ticker = row["ticker"] if isinstance(row, sqlite3.Row) else row[0]
        date = row["date"] if isinstance(row, sqlite3.Row) else row[1]
        if isinstance(row, sqlite3.Row):
            vals = [row[c] for c in ind_data_cols] + [ticker, date]
        else:
            # row is a tuple — need column indices
            col_idx = {c: i for i, c in enumerate(ind_data_cols)}
            vals = [row[idx + 2] for idx in range(len(ind_data_cols))] + [ticker, date]
        try:
            dcur.execute(update_sql, vals)
            migrated += 1
        except:
            pass  # row might not exist in historical_data for this date
    dconn.commit()
    log(f"✅ merged {migrated}/{len(rows)} indicator rows")
    return migrated


def main():
    ap = argparse.ArgumentParser(description="BRAVO-DATA-LAYER migration (idempotent)")
    ap.add_argument("--stocks-db", default=str(DEFAULT_STOCKS_DB), help="path to stocks.db")
    ap.add_argument("--de-db", default=str(DEFAULT_DE_DB), help="path to data_engine.db")
    ap.add_argument("--dry-run", action="store_true", help="show what would happen without changes")
    args = ap.parse_args()

    stocks_db = args.stocks_db
    de_db = args.de_db

    print("=" * 72)
    print("  BRAVO-DATA-LAYER MIGRATION (idempotent, no new tables)")
    print("=" * 72)
    print(f"  stocks.db:      {stocks_db}")
    print(f"  data_engine.db: {de_db}")
    print(f"  mode:           {'DRY-RUN' if args.dry_run else 'LIVE'}")

    if not Path(stocks_db).exists():
        print(f"\n❌ stocks.db not found: {stocks_db}")
        return 1
    if not Path(de_db).exists():
        print(f"\n❌ data_engine.db not found: {de_db}")
        return 1

    sconn = sqlite3.connect(stocks_db)
    sconn.row_factory = sqlite3.Row
    dconn = sqlite3.connect(de_db)
    dconn.row_factory = sqlite3.Row

    try:
        # ── STEP 1: ALTER data_engine.db.stocks (add TV columns) ──
        step(1, "ALTER data_engine.db.stocks — add missing TV columns")
        # Get columns from stocks.db.stocks that need to exist in data_engine.db.stocks
        s_stocks_cols = {r[1]: r[2] for r in sconn.execute("PRAGMA table_info(stocks)").fetchall()}
        de_stocks_cols = get_existing_columns(dconn, "stocks")
        # Columns that are mapped (not direct copy)
        mapped = {"id", "ticker", "current_price", "last_updated", "name", "name_ar",
                  "market", "sector", "volume", "market_cap", "change_percent",
                  "is_active", "high_price", "low_price", "logo_url", "created_at",
                  "tabs_data", "analyst_rating", "last_update", "price", "symbol"}
        to_add = []
        for col, typ in s_stocks_cols.items():
            if col in mapped:
                continue
            if col in de_stocks_cols:
                continue
            if typ == "INTEGER":
                sqltype = "INTEGER"
            elif typ == "REAL":
                sqltype = "REAL"
            else:
                sqltype = "TEXT"
            to_add.append((col, sqltype))
        log(f"columns to add: {len(to_add)}")
        added = alter_add_columns(dconn, "stocks", to_add, dry_run=args.dry_run)
        log(f"✅ added {added} columns to data_engine.db.stocks (now {len(get_existing_columns(dconn, 'stocks'))} total)")

        # ── STEP 2: ALTER data_engine.db.historical_data (add indicator columns) ──
        step(2, "ALTER data_engine.db.historical_data — add indicator columns")
        indicator_cols = [
            ("rsi", "REAL"), ("macd", "REAL"), ("macd_signal", "REAL"),
            ("sma20", "REAL"), ("sma50", "REAL"), ("sma200", "REAL"), ("atr", "REAL"),
            ("recommend_all", "REAL"), ("recommend_ma", "REAL"), ("recommend_other", "REAL"),
            ("volatility_daily", "REAL"), ("volatility_weekly", "REAL"),
            ("avg_volume_30d", "REAL"), ("avg_volume_10d", "REAL"), ("avg_volume_90d", "REAL"),
            ("relative_volume_10d", "REAL"), ("high_52w", "REAL"), ("low_52w", "REAL"),
            ("beta_1y", "REAL"),
        ]
        added_ind = alter_add_columns(dconn, "historical_data", indicator_cols, dry_run=args.dry_run)
        log(f"✅ added {added_ind} indicator columns to historical_data (now {len(get_existing_columns(dconn, 'historical_data'))} total)")

        if args.dry_run:
            log("\n[DRY-RUN] skipping data migration")
        else:
            # ── STEPS 3-5: Migrate data ──
            migrate_stocks_table(sconn, dconn)
            migrate_daily_prices(sconn, dconn)
            migrate_indicators(sconn, dconn)

        # ── VERIFY ──
        print(f"\n{'='*72}")
        print(f"  VERIFICATION")
        print(f"{'='*72}")
        de_stocks_cnt = dconn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        hd_cnt = dconn.execute("SELECT COUNT(*) FROM historical_data").fetchone()[0]
        hd_max = dconn.execute("SELECT MAX(date) FROM historical_data").fetchone()[0]
        hd_min = dconn.execute("SELECT MIN(date) FROM historical_data").fetchone()[0]
        de_stocks_cols_now = len(get_existing_columns(dconn, "stocks"))
        hd_cols_now = len(get_existing_columns(dconn, "historical_data"))
        print(f"  data_engine.db.stocks:           {de_stocks_cnt} rows | {de_stocks_cols_now} columns")
        print(f"  data_engine.db.historical_data:  {hd_cnt:,} rows | {hd_cols_now} columns | {hd_min} → {hd_max}")
        # COMI check
        comi = dconn.execute("SELECT symbol, price, market, rsi, sma20, sma50, atr FROM stocks WHERE symbol='COMI'").fetchone()
        if comi:
            print(f"  COMI: symbol={comi['symbol']} price={comi['price']} market={comi['market']} rsi={comi['rsi']} sma20={comi['sma20']} sma50={comi['sma50']} atr={comi['atr']}")
        else:
            print(f"  COMI: not found (run scanner after migration to populate)")

        print(f"\n✅ Migration complete. NO new tables created. Existing tables enriched + data migrated.")

    finally:
        sconn.close()
        dconn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
