#!/usr/bin/env python3
"""
reconcile_and_clean_historical_data.py — Rosetta Stone data reconciliation

Owner directive (SCANNER-LIVE-4, 2026-10-27): use the clean Ground Truth from
tradingview_scanner_live.py (1480 stocks, pure English symbols) to clean and
reconcile ALL legacy historical data.

4-stage pipeline (idempotent, production-safe):

  Stage 1: Build Rosetta mapping (clean symbol → {name_ar, logo_url, ...})
           from stocks.db (the unified scanner output).

  Stage 2: Clean stock_daily_prices in stocks.db:
           - Add `symbol` column (mirror of `ticker`)
           - Convert text volume ('1.36 M', '500 K') → REAL numbers
           - Clean polluted tickers (COMIالبنك → COMI, LUTSL → LUTS)

  Stage 3: Clean tab_* tables in data_engine.db (if present):
           - tab_income_statement, tab_balance_sheet, tab_cash_flow, etc.
           - Split Arabic from symbol → name_ar, leave symbol pure
           - Map legacy tickers to clean symbols via Rosetta

  Stage 4: Inject logo_url into stocks.db.stocks for all rows missing it.

Usage:
  python3 scripts/reconcile_and_clean_historical_data.py
  python3 scripts/reconcile_and_clean_historical_data.py --dry-run
  python3 scripts/reconcile_and_clean_historical_data.py --stocks-db db/stocks.db --data-engine-db db/data_engine.db

Exit: 0 = success, 1 = error
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STOCKS_DB = REPO_ROOT / "db" / "stocks.db"
DEFAULT_DATA_ENGINE_DB = REPO_ROOT / "db" / "data_engine.db"

LOGO_URL_TEMPLATE = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"

# Arabic unicode range
ARABIC_RE = re.compile(r"[\u0600-\u06FF]+")
# Latin uppercase prefix (ticker-like)
LATIN_PREFIX_RE = re.compile(r"^[A-Z]{2,8}")
# Trailing 'D' badge (legacy TradingView status)
TRAILING_D_RE = re.compile(r"^([A-Z]{2,8})D$")


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


# ─── Symbol cleaning ────────────────────────────────────────────────────────


def clean_symbol(raw: str, name: str = "") -> Tuple[str, str]:
    """Clean a polluted symbol. Returns (clean_symbol, extracted_name_ar).

    Handles:
      - Arabic suffix: 'COMIالبنك' → ('COMI', 'البنك')
      - Trailing 'D' badge: 'LUTSL' → ('LUTS', '')
      - Pure Arabic: 'البنك' → ('', 'البنك')
    """
    if not raw:
        return "", name or ""
    raw = str(raw).strip()
    # Extract Arabic portion
    arabic_match = ARABIC_RE.search(raw)
    name_ar = arabic_match.group(0) if arabic_match else ""
    # Strip Arabic from symbol
    symbol = ARABIC_RE.sub("", raw).strip()
    # Strip trailing 'D' badge (only if symbol > 3 chars to avoid legit 3-char + D tickers)
    m = TRAILING_D_RE.match(symbol)
    if m and len(symbol) > 4:
        symbol = m.group(1)
    return symbol, name_ar or name or ""


def is_polluted(symbol: str) -> bool:
    """Check if symbol still has Arabic or is clearly malformed."""
    if not symbol:
        return False
    if ARABIC_RE.search(symbol):
        return True
    return False


# ─── Volume parsing ─────────────────────────────────────────────────────────


def parse_volume_to_real(val: Any) -> Optional[float]:
    """Convert volume value (possibly text like '1.36 M') to REAL number.

    Returns None if unparseable. Handles:
      - Already numeric (int/float) → float
      - '32.43 M' → 32430000.0
      - '500 K' → 500000.0
      - '1.2 B' → 1200000000.0
      - '' / None → None
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val) if val != 0 else 0.0
    s = str(val).strip()
    if not s:
        return None
    # Remove unicode spaces, nbsp, thin spaces
    s = s.replace("\u202f", "").replace("\xa0", "").replace(" ", "").replace(",", "")
    if not s:
        return None
    # Extract number + suffix
    m = re.match(r"^([\d.]+)\s*([KMB]?)$", s, re.IGNORECASE)
    if not m:
        return None
    try:
        num = float(m.group(1))
    except ValueError:
        return None
    suffix = m.group(2).upper()
    if suffix == "K":
        num *= 1e3
    elif suffix == "M":
        num *= 1e6
    elif suffix == "B":
        num *= 1e9
    return num


# ─── Stage 1: Rosetta mapping ───────────────────────────────────────────────


def build_rosetta(stocks_db: Path) -> Dict[str, Dict[str, Any]]:
    """Build the clean symbol → {name_ar, logo_url, logoid, market} mapping.

    Uses stocks.db.stocks (output of tradingview_scanner_live) as Ground Truth.
    """
    if not stocks_db.exists():
        log(f"⚠️ stocks.db not found: {stocks_db}")
        return {}
    conn = sqlite3.connect(str(stocks_db))
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()}
    select_cols = ["symbol"]
    for c in ["name_ar", "logo_url", "logoid", "market"]:
        if c in cols:
            select_cols.append(c)
    rows = conn.execute(f"SELECT {', '.join(select_cols)} FROM stocks").fetchall()
    mapping: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        sym = r["symbol"]
        if not sym or is_polluted(sym):
            continue
        mapping[sym] = {c: r[c] for c in select_cols[1:]}
    conn.close()
    log(f"🗺️  Rosetta mapping: {len(mapping)} clean symbols")
    return mapping


# ─── Stage 2: Clean stock_daily_prices ──────────────────────────────────────


def clean_stock_daily_prices(stocks_db: Path, rosetta: Dict, dry_run: bool) -> Dict[str, int]:
    """Clean stock_daily_prices table in stocks.db.

    - Add `symbol` column (mirror of ticker after cleaning)
    - Convert text volume → REAL
    - Clean polluted tickers
    """
    stats = {"rows_total": 0, "volume_converted": 0, "tickers_cleaned": 0,
             "symbols_populated": 0, "skipped_polluted": 0}
    conn = sqlite3.connect(str(stocks_db))
    conn.row_factory = sqlite3.Row

    # Check if table exists
    tabs = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if "stock_daily_prices" not in tabs:
        log("  ℹ️ stock_daily_prices not in stocks.db (sandbox — skipping)")
        conn.close()
        return stats

    cols = {r[1] for r in conn.execute("PRAGMA table_info(stock_daily_prices)").fetchall()}

    # Add symbol column if missing
    if "symbol" not in cols and not dry_run:
        conn.execute("ALTER TABLE stock_daily_prices ADD COLUMN symbol TEXT")
        conn.commit()
        log("  + added `symbol` column to stock_daily_prices")
    elif "symbol" not in cols and dry_run:
        log("  (dry-run) would add `symbol` column")

    stats["rows_total"] = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
    log(f"  stock_daily_prices: {stats['rows_total']} rows")

    if dry_run:
        # Just report
        text_vols = conn.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE typeof(volume)='text'").fetchone()[0]
        log(f"  (dry-run) would convert {text_vols} text volumes to REAL")
        conn.close()
        return stats

    # Convert text volumes (select rowid explicitly)
    text_rows = conn.execute(
        "SELECT rowid, volume FROM stock_daily_prices WHERE typeof(volume)='text'"
    ).fetchall()
    for r in text_rows:
        parsed = parse_volume_to_real(r[1])  # volume is 2nd column
        if parsed is not None:
            conn.execute("UPDATE stock_daily_prices SET volume = ? WHERE rowid = ?",
                         (parsed, r[0]))  # rowid is 1st
            stats["volume_converted"] += 1

    # Clean tickers + populate symbol (use tuple access)
    ticker_col = "ticker" if "ticker" in cols else "symbol"
    rows = conn.execute(f"SELECT rowid, {ticker_col} FROM stock_daily_prices").fetchall()
    for r in rows:
        raw_tck = r[1]
        if not raw_tck:
            continue
        clean_tck, name_ar = clean_symbol(raw_tck)
        if is_polluted(clean_tck):
            stats["skipped_polluted"] += 1
            continue
        if clean_tck != raw_tck:
            conn.execute(f"UPDATE stock_daily_prices SET {ticker_col} = ? WHERE rowid = ?",
                         (clean_tck, r[0]))
            stats["tickers_cleaned"] += 1
        # Populate symbol column (we added it above if missing)
        conn.execute("UPDATE stock_daily_prices SET symbol = ? WHERE rowid = ?",
                     (clean_tck, r[0]))
        stats["symbols_populated"] += 1

    conn.commit()
    conn.close()
    return stats


# ─── Stage 3: Clean tab_* tables ────────────────────────────────────────────


def clean_tab_tables(data_engine_db: Path, rosetta: Dict, dry_run: bool) -> Dict[str, int]:
    """Clean tab_* tables in data_engine.db (if present).

    For each tab_* table with a symbol/ticker column:
      - Split Arabic → name_ar column (add if missing)
      - Clean symbol via Rosetta
    """
    stats = {"tables_found": 0, "rows_cleaned": 0, "arabic_split": 0}
    if not data_engine_db.exists():
        log(f"  ℹ️ data_engine.db not found: {data_engine_db} (skipping tab_* clean)")
        return stats
    conn = sqlite3.connect(str(data_engine_db))
    conn.row_factory = sqlite3.Row
    tabs = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tab_%'"
    ).fetchall()]
    stats["tables_found"] = len(tabs)
    if not tabs:
        log("  ℹ️ no tab_* tables in data_engine.db (skipping)")
        conn.close()
        return stats
    log(f"  found {len(tabs)} tab_* tables: {tabs}")

    for tab in tabs:
        cols = {r[1] for r in conn.execute(f'PRAGMA table_info("{tab}")').fetchall()}
        sym_col = "symbol" if "symbol" in cols else ("ticker" if "ticker" in cols else None)
        if not sym_col:
            continue
        # Add name_ar column if missing
        if "name_ar" not in cols and not dry_run:
            conn.execute(f'ALTER TABLE "{tab}" ADD COLUMN name_ar TEXT')
            conn.commit()
        # Find polluted rows
        rows = conn.execute(
            f'SELECT rowid, "{sym_col}" as sym FROM "{tab}" '
            f'WHERE "{sym_col}" GLOB "*[^\x20-\x7E]*" OR "{sym_col}" LIKE "%\u0600%"'
        ).fetchall()
        for r in rows:
            raw = r["sym"]
            if not raw:
                continue
            clean_sym, name_ar = clean_symbol(raw)
            if dry_run:
                stats["rows_cleaned"] += 1
                if name_ar:
                    stats["arabic_split"] += 1
                continue
            conn.execute(f'UPDATE "{tab}" SET "{sym_col}" = ?, name_ar = ? WHERE rowid = ?',
                         (clean_sym, name_ar, r["rowid"]))
            stats["rows_cleaned"] += 1
            if name_ar:
                stats["arabic_split"] += 1
        # Also clean trailing-D symbols via Rosetta
        for clean_sym, info in rosetta.items():
            legacy = f"{clean_sym}D"
            rows = conn.execute(
                f'SELECT rowid FROM "{tab}" WHERE "{sym_col}" = ?', (legacy,)
            ).fetchall()
            for r in rows:
                if dry_run:
                    stats["rows_cleaned"] += 1
                    continue
                conn.execute(f'UPDATE "{tab}" SET "{sym_col}" = ? WHERE rowid = ?',
                             (clean_sym, r[0]))
                stats["rows_cleaned"] += 1
    if not dry_run:
        conn.commit()
    conn.close()
    return stats


# ─── Stage 4: Inject logo_url ───────────────────────────────────────────────


def inject_logo_urls(stocks_db: Path, dry_run: bool) -> Dict[str, int]:
    """Ensure all stocks have logo_url (build from logoid if missing)."""
    stats = {"total": 0, "injected": 0, "already_present": 0}
    conn = sqlite3.connect(str(stocks_db))
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()}
    if "logo_url" not in cols:
        log("  ⚠️ stocks table has no logo_url column")
        conn.close()
        return stats
    stats["total"] = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    missing = conn.execute(
        "SELECT symbol, logoid FROM stocks WHERE (logo_url IS NULL OR logo_url = '') AND logoid IS NOT NULL"
    ).fetchall()
    for r in missing:
        if dry_run:
            stats["injected"] += 1
            continue
        url = LOGO_URL_TEMPLATE.format(logoid=r["logoid"])
        conn.execute("UPDATE stocks SET logo_url = ? WHERE symbol = ?", (url, r["symbol"]))
        stats["injected"] += 1
    stats["already_present"] = stats["total"] - conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE logo_url IS NULL OR logo_url = ''"
    ).fetchone()[0]
    if not dry_run:
        conn.commit()
    conn.close()
    return stats


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="Rosetta Stone — reconcile & clean historical data")
    ap.add_argument("--stocks-db", default=str(DEFAULT_STOCKS_DB))
    ap.add_argument("--data-engine-db", default=str(DEFAULT_DATA_ENGINE_DB))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stocks_db = Path(args.stocks_db)
    data_engine_db = Path(args.data_engine_db)

    print("=" * 70)
    print("Rosetta Stone — Reconcile & Clean Historical Data")
    print("=" * 70)
    print(f"stocks.db:      {stocks_db}")
    print(f"data_engine.db: {data_engine_db}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print()

    # Stage 1: Rosetta mapping
    log("Stage 1: Building Rosetta mapping from stocks.db (Ground Truth)...")
    rosetta = build_rosetta(stocks_db)
    if not rosetta:
        log("❌ no clean symbols found — run tradingview_scanner_live.py first")
        return 1

    # Stage 2: Clean stock_daily_prices
    log("\nStage 2: Cleaning stock_daily_prices (volume → REAL, ticker → symbol)...")
    sdp_stats = clean_stock_daily_prices(stocks_db, rosetta, args.dry_run)
    for k, v in sdp_stats.items():
        log(f"  {k}: {v}")

    # Stage 3: Clean tab_* tables
    log("\nStage 3: Cleaning tab_* tables in data_engine.db...")
    tab_stats = clean_tab_tables(data_engine_db, rosetta, args.dry_run)
    for k, v in tab_stats.items():
        log(f"  {k}: {v}")

    # Stage 4: Inject logo_url
    log("\nStage 4: Injecting logo_url for all stocks...")
    logo_stats = inject_logo_urls(stocks_db, args.dry_run)
    for k, v in logo_stats.items():
        log(f"  {k}: {v}")

    # Final verification
    log("\n" + "=" * 70)
    log("VERIFICATION")
    log("=" * 70)
    conn = sqlite3.connect(str(stocks_db))
    polluted = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE symbol GLOB '*[^\x20-\x7E]*'"
    ).fetchone()[0]
    log(f"  polluted symbols in stocks: {polluted} (expected: 0)")
    with_logo = conn.execute("SELECT COUNT(*) FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ''").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    log(f"  stocks with logo_url: {with_logo}/{total} ({with_logo/total*100:.0f}%)")
    conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
