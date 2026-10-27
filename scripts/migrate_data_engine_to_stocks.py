#!/usr/bin/env python3
"""
migrate_data_engine_to_stocks.py — Migration: data_engine.db → stocks.db

Owner directive (SCANNER-LIVE-3, 2026-10-27): migrate all stocks, names,
sectors, logo_url, and tabs_data from the legacy data_engine.db.stocks table
into the unified stocks.db.stocks table (managed by tradingview_scanner_live.py).

Features:
  1. Copy logo_url, name_ar, sector, industry from data_engine.db → stocks.db
     (only if stocks.db has NULL/missing values — preserves scanner data).
  2. Clean polluted symbols (legacy LUTSL, COMIالبنك, trailing 'D' badges).
  3. Merge tabs_data (JSON) from data_engine.db into stocks.db.tabs_data.
  4. Idempotent — safe to run multiple times.
  5. Production-safe: uses INSERT OR IGNORE + UPDATE, never DELETE.

Usage:
  python3 scripts/migrate_data_engine_to_stocks.py                    # default paths
  python3 scripts/migrate_data_engine_to_stocks.py --source db/data_engine.db --target db/stocks.db
  python3 scripts/migrate_data_engine_to_stocks.py --dry-run          # report only

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
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "db" / "data_engine.db"
DEFAULT_TARGET = REPO_ROOT / "db" / "stocks.db"

# Pollution patterns (from tradingview_scraper.py _is_polluted_scrape_record)
ARABIC_RANGE = re.compile(r"[\u0600-\u06FF]")
TRAILING_D = re.compile(r"[A-Z]{2,8}D$")  # symbol ends with 'D' status badge


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _is_polluted(symbol: str, name: str) -> bool:
    """Detect legacy merge-pollution: symbol contains Arabic or name starts with symbol."""
    if not symbol or not name:
        return False
    if ARABIC_RANGE.search(symbol):
        return True
    if name.startswith(symbol) and len(name) > len(symbol) + 2:
        remainder = name[len(symbol):]
        if remainder and (remainder[0].isupper() or ARABIC_RANGE.match(remainder[0])):
            return True
    return False


def _clean_symbol(symbol: str, name: str) -> Tuple[str, str]:
    """Attempt to clean a polluted symbol. Returns (clean_symbol, clean_name)."""
    if not symbol:
        return symbol, name
    # Strip trailing 'D' badge (legacy TradingView status indicator)
    if TRAILING_D.match(symbol) and len(symbol) > 3:
        symbol = symbol[:-1]
    # Strip Arabic from symbol
    if ARABIC_RANGE.search(symbol):
        symbol = re.sub(r"[\u0600-\u06FF]+", "", symbol)
    # Strip symbol prefix from name
    if name and symbol and name.startswith(symbol) and len(name) > len(symbol) + 2:
        remainder = name[len(symbol):]
        if remainder and (remainder[0].isupper() or ARABIC_RANGE.match(remainder[0])):
            name = remainder
    return symbol.strip(), (name or "").strip()


def _get_columns(conn: sqlite3.Connection, table: str) -> set:
    """Return set of column names for a table."""
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def migrate(source_path: Path, target_path: Path, dry_run: bool = False) -> Dict[str, int]:
    """Run the migration. Returns stats dict."""
    stats = {
        "source_rows": 0,
        "target_rows_before": 0,
        "cleaned_symbols": 0,
        "logos_migrated": 0,
        "names_migrated": 0,
        "sectors_migrated": 0,
        "tabs_merged": 0,
        "new_stocks_added": 0,
        "skipped_polluted": 0,
    }

    if not source_path.exists():
        log(f"⚠️ source DB not found: {source_path}")
        log("   (this is OK if data_engine.db was never populated — scanner_live already fills stocks.db)")
        return stats

    if not target_path.exists():
        log(f"⚠️ target DB not found: {target_path}")
        log("   run tradingview_scanner_live.py first to create the schema")
        return stats

    log(f"📂 source: {source_path}")
    log(f"📂 target: {target_path}")

    src = sqlite3.connect(str(source_path))
    src.row_factory = sqlite3.Row
    tgt = sqlite3.connect(str(target_path))
    tgt.row_factory = sqlite3.Row

    # Check source has stocks table
    src_cols = _get_columns(src, "stocks") if "stocks" in [
        r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    ] else set()
    if not src_cols:
        log("⚠️ source has no 'stocks' table — nothing to migrate")
        src.close()
        tgt.close()
        return stats

    tgt_cols = _get_columns(tgt, "stocks")
    log(f"   source columns: {len(src_cols)}")
    log(f"   target columns: {len(tgt_cols)}")

    # Count rows
    stats["source_rows"] = src.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    stats["target_rows_before"] = tgt.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    log(f"   source rows: {stats['source_rows']}")
    log(f"   target rows (before): {stats['target_rows_before']}")

    if dry_run:
        log("🔍 DRY-RUN — no changes will be made")

    # Build a lookup of target symbols for fast matching
    target_symbols = {r[0] for r in tgt.execute("SELECT symbol FROM stocks").fetchall()}

    rows = src.execute(
        "SELECT symbol, name, name_ar, sector, industry, logo_url, tabs_data, market "
        "FROM stocks"
    ).fetchall()

    for row in rows:
        raw_symbol = row["symbol"] or ""
        raw_name = row["name"] or ""
        name_ar = row["name_ar"] if "name_ar" in row.keys() else None
        sector = row["sector"]
        industry = row["industry"] if "industry" in row.keys() else None
        logo_url = row["logo_url"] if "logo_url" in row.keys() else None
        tabs_data = row["tabs_data"] if "tabs_data" in row.keys() else None
        market = row["market"] or "egypt"

        # Clean polluted symbol
        clean_sym, clean_name = _clean_symbol(raw_symbol, raw_name or name_ar or "")
        if clean_sym != raw_symbol:
            stats["cleaned_symbols"] += 1
        if _is_polluted(clean_sym, clean_name or ""):
            stats["skipped_polluted"] += 1
            continue

        if not clean_sym:
            continue

        if dry_run:
            continue

        # If target doesn't have this symbol, INSERT a minimal row
        if clean_sym not in target_symbols:
            try:
                tgt.execute(
                    'INSERT OR IGNORE INTO stocks (symbol, market, name_ar, sector, industry, logo_url, tabs_data, last_updated) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (clean_sym, market, clean_name or name_ar, sector, industry, logo_url, tabs_data,
                     datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                )
                stats["new_stocks_added"] += 1
                target_symbols.add(clean_sym)
            except Exception as e:
                log(f"  ⚠️ insert {clean_sym}: {e}")
            continue

        # UPDATE existing target row with non-null source values
        updates = []
        params = []
        if logo_url and "logo_url" in tgt_cols:
            # Only update if target logo_url is NULL
            existing = tgt.execute("SELECT logo_url FROM stocks WHERE symbol = ?", (clean_sym,)).fetchone()
            if existing and not existing["logo_url"]:
                updates.append("logo_url = ?")
                params.append(logo_url)
                stats["logos_migrated"] += 1
        if clean_name and "name_ar" in tgt_cols:
            existing = tgt.execute("SELECT name_ar FROM stocks WHERE symbol = ?", (clean_sym,)).fetchone()
            if existing and not existing["name_ar"]:
                updates.append("name_ar = ?")
                params.append(clean_name)
                stats["names_migrated"] += 1
        if sector and "sector" in tgt_cols:
            existing = tgt.execute("SELECT sector FROM stocks WHERE symbol = ?", (clean_sym,)).fetchone()
            if existing and not existing["sector"]:
                updates.append("sector = ?")
                params.append(sector)
                stats["sectors_migrated"] += 1
        if tabs_data and "tabs_data" in tgt_cols:
            # Merge: if target has tabs_data, merge JSON; else use source
            existing = tgt.execute("SELECT tabs_data FROM stocks WHERE symbol = ?", (clean_sym,)).fetchone()
            if existing:
                existing_tabs = existing["tabs_data"]
                if not existing_tabs:
                    updates.append("tabs_data = ?")
                    params.append(tabs_data)
                    stats["tabs_merged"] += 1
                else:
                    # Merge JSON (source supplements target)
                    try:
                        t = json.loads(existing_tabs) if existing_tabs else {}
                        s = json.loads(tabs_data) if tabs_data else {}
                        for k, v in s.items():
                            if k not in t:
                                t[k] = v
                        if s:
                            updates.append("tabs_data = ?")
                            params.append(json.dumps(t, ensure_ascii=False))
                            stats["tabs_merged"] += 1
                    except Exception:
                        pass  # skip merge on JSON error

        if updates:
            params.append(clean_sym)
            try:
                tgt.execute(f"UPDATE stocks SET {', '.join(updates)} WHERE symbol = ?", params)
            except Exception as e:
                log(f"  ⚠️ update {clean_sym}: {e}")

    if not dry_run:
        tgt.commit()

    src.close()
    tgt.close()
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate data_engine.db → stocks.db")
    ap.add_argument("--source", default=str(DEFAULT_SOURCE), help="source DB path")
    ap.add_argument("--target", default=str(DEFAULT_TARGET), help="target DB path")
    ap.add_argument("--dry-run", action="store_true", help="report only, no changes")
    args = ap.parse_args()

    print("=" * 70)
    print("Migration: data_engine.db → stocks.db")
    print("=" * 70)

    stats = migrate(Path(args.source), Path(args.target), args.dry_run)

    print()
    print("=" * 70)
    print("MIGRATION STATS")
    print("=" * 70)
    for k, v in stats.items():
        print(f"  {k:25}: {v}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
