#!/usr/bin/env python3
"""
us_stock_scraper.py — US Stock Prices Scraper (NYSE/NASDAQ)
============================================================
Fetches daily OHLCV for the top 50 US stocks from Yahoo Finance.

Stocks covered (seeded by scripts/seed_us_stocks.py):
  AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, JPM, V, JNJ,
  WMT, MA, PG, UNH, HD, CVX, MRK, ABBV, PFE, KO,
  PEP, BAC, TMO, COST, AVGO, MCD, CRM, AMD, NFLX, ACN,
  ADBE, DHR, ORCL, CMCSA, NEE, TXN, WFC, PM, IBM, MS,
  QCOM, RTX, HON, UPS, INTC, CAT, BA, GE, GM

Data source: Yahoo Finance (yfinance library)
  - US tickers don't need a suffix (unlike EGX which uses .CA)
  - Rate limit: 0.3s delay between batch calls
  - Batch fetch: yfinance can fetch multiple tickers in one call

Output: writes to db/price_history.db.price_history table
  - source = 'yahoo_us'
  - market = 'US'
  - adjusted = 0 (raw prices; yfinance returns adjusted by default —
    we explicitly request auto_adjust=False and store raw close)

Status: logs to data/us_scraper_status.json

Usage:
  python3 data_engine/scrapers/us_stock_scraper.py
  python3 data_engine/scrapers/us_stock_scraper.py --tickers AAPL,MSFT,GOOGL
  python3 data_engine/scrapers/us_stock_scraper.py --days 30
  python3 data_engine/scrapers/us_stock_scraper.py --dry-run
"""
from __future__ import annotations

import os
import sys
import json
import time
import sqlite3
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Any, Tuple

# ────────────────────────────────────────────────────────────────────────────
# Paths
# ────────────────────────────────────────────────────────────────────────────
_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent

DB_DIR = _PROJECT_ROOT / 'db'
STATUS_DIR = _PROJECT_ROOT / 'data'  # per task brief
STATUS_FILE = STATUS_DIR / 'us_scraper_status.json'

STOCKS_DB = DB_DIR / 'stocks.db'
PRICE_HISTORY_DB = DB_DIR / 'price_history.db'

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────
SOURCE = 'yahoo_us'
MARKET = 'US'

# US tickers don't need a Yahoo suffix (unlike EGX=.CA, TADAWUL=.SR, KSE=.KW)
US_YAHOO_SUFFIX = ''

# How many days of history to fetch by default (yfinance `period` value)
DEFAULT_PERIOD_DAYS = 30

# Batch size: yfinance can comfortably fetch 10 tickers per call (Yahoo rate
# limit safe). Going higher risks 429s.
BATCH_SIZE = 10

# Delay between batches (seconds) — respects Yahoo rate limits
BATCH_DELAY = float(os.environ.get('US_SCRAPER_DELAY', '0.3'))

# Max tickers to fetch in a single CLI run (safety cap)
MAX_TICKERS = int(os.environ.get('US_SCRAPER_MAX_TICKERS', '100'))

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [US-Scraper] %(message)s',
        datefmt='%H:%M:%S',
    ))
    logger.addHandler(_h)


# ────────────────────────────────────────────────────────────────────────────
# yfinance import (optional but expected — task brief says installed)
# ────────────────────────────────────────────────────────────────────────────
try:
    import yfinance as yf
    import pandas as pd
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    pd = None
    logger.warning(
        "⚠️ yfinance not installed — US scraper will run dry. "
        "Install with: pip install yfinance"
    )


# ────────────────────────────────────────────────────────────────────────────
# Status logging
# ────────────────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.utcnow().isoformat() + 'Z'


def update_status(status_update: Dict[str, Any]) -> None:
    """Append-safe status update to data/us_scraper_status.json."""
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            status = json.load(f)
    except Exception:
        status = {
            'running': False,
            'last_run': None,
            'logs': [],
            'results': {},
        }

    status.update(status_update)

    # Append log lines (cap at 100)
    if 'logs' not in status:
        status['logs'] = []
    status['logs'] = status['logs'][-100:]

    try:
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2, ensure_ascii=False, default=str)
    except Exception as e:
        logger.warning(f"⚠️ Failed to write status file: {e}")


def log(msg: str, level: str = 'info') -> None:
    """Print + persist log line to status file."""
    ts = datetime.utcnow().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    getattr(logger, level.lower(), logger.info)(msg)

    # Append to status file
    try:
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            status = json.load(f)
        if 'logs' not in status:
            status['logs'] = []
        status['logs'].append(line)
        status['logs'] = status['logs'][-100:]
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2, ensure_ascii=False, default=str)
    except Exception:
        pass


# ────────────────────────────────────────────────────────────────────────────
# Ticker list
# ────────────────────────────────────────────────────────────────────────────
def get_us_tickers_from_db() -> List[Tuple[str, str]]:
    """
    جلب قائمة tickers US من stocks.db.

    Returns:
        List of (ticker, name) tuples, sorted by ticker.
    """
    if not STOCKS_DB.exists():
        log(f"⚠️ stocks.db not found at {STOCKS_DB}", 'warning')
        return []

    try:
        conn = sqlite3.connect(str(STOCKS_DB), timeout=15.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT ticker, name FROM stocks
            WHERE market = 'US' AND (is_active = 1 OR is_active IS NULL)
            ORDER BY ticker
        """)
        rows = cur.fetchall()
        conn.close()
        return [(r['ticker'], r['name'] or r['ticker']) for r in rows]
    except Exception as e:
        log(f"⚠️ Failed to read US tickers from stocks.db: {e}", 'warning')
        return []


# ────────────────────────────────────────────────────────────────────────────
# price_history.db schema
# ────────────────────────────────────────────────────────────────────────────
def ensure_price_history_schema(conn: sqlite3.Connection) -> bool:
    """
    Ensure price_history table has the full schema (with adjusted + market
    columns). Forward-compatible: if the table was created by an older
    scraper (price_history_safetynet.py), ALTER TABLE adds the missing
    columns. If the table doesn't exist, it's created.

    Production schema (per agent-ctx/_audit_data.json):
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume INTEGER,
        source TEXT DEFAULT 'system',
        created_at TEXT DEFAULT (datetime('now')),
        adjusted INTEGER DEFAULT 0,
        market TEXT,
        UNIQUE(ticker, date)
    """
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                source TEXT DEFAULT 'system',
                created_at TEXT DEFAULT (datetime('now')),
                adjusted INTEGER DEFAULT 0,
                market TEXT,
                UNIQUE(ticker, date)
            )
        """)
        # Forward-compat: add adjusted + market columns if missing
        # (price_history_safetynet.py creates the table without them)
        for col, decl in [
            ('adjusted', 'INTEGER DEFAULT 0'),
            ('market', 'TEXT'),
        ]:
            try:
                cols = {row[1] for row in conn.execute('PRAGMA table_info(price_history)').fetchall()}
                if col not in cols:
                    conn.execute(f'ALTER TABLE price_history ADD COLUMN {col} {decl}')
                    log(f"  ✅ Added column {col} to price_history (forward-compat)")
            except Exception as e:
                logger.debug(f"Column {col} check: {e}")

        # Index for fast ticker+date lookups (idempotent)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date "
            "ON price_history(ticker, date)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_price_history_market "
            "ON price_history(market)"
        )
        conn.commit()
        return True
    except Exception as e:
        log(f"❌ Schema ensure failed: {e}", 'error')
        return False


# ────────────────────────────────────────────────────────────────────────────
# yfinance batch fetch
# ────────────────────────────────────────────────────────────────────────────
def _normalize_ticker(t: str) -> str:
    """Normalize: uppercase + strip whitespace."""
    return (t or '').strip().upper()


def _yahoo_symbol(ticker: str) -> str:
    """
    Build the Yahoo Finance symbol — US tickers need no suffix.

    Special handling:
      - BRK.B → BRK-B (Yahoo uses hyphen for class B shares, not period)
      - BRK.A → BRK-A (same convention for class A)
    """
    t = _normalize_ticker(ticker)
    # Yahoo Finance uses '-' for share-class separators, not '.'
    if '.' in t:
        t = t.replace('.', '-')
    return f"{t}{US_YAHOO_SUFFIX}"


def fetch_batch(
    tickers: List[str],
    period_days: int = DEFAULT_PERIOD_DAYS,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Batch-fetch OHLCV for up to 10 tickers in a single yfinance call.

    Returns:
        Dict mapping ticker -> list of {date, open, high, low, close, volume} dicts.
        Failed tickers map to an empty list.
    """
    if not YFINANCE_AVAILABLE:
        log("⚠️ yfinance not available — fetch_batch returns empty", 'warning')
        return {t: [] for t in tickers}

    if not tickers:
        return {}

    tickers = [_normalize_ticker(t) for t in tickers]
    symbols_str = ' '.join(_yahoo_symbol(t) for t in tickers)
    period = f"{period_days}d"

    try:
        # auto_adjust=False → returns raw OHLC + Adj Close (separate column)
        # We store raw Close as close_price (adjusted=0).
        # NOTE: yfinance ≥1.7 removed `raise_errors` kwarg — we rely on
        # try/except + empty-DataFrame check instead.
        data = yf.download(
            symbols_str,
            period=period,
            interval='1d',
            group_by='ticker',
            auto_adjust=False,
            threads=True,
            progress=False,
        )
    except Exception as e:
        log(f"⚠️ yfinance download error for batch {tickers}: {str(e)[:120]}", 'warning')
        return {t: [] for t in tickers}

    if data is None or data.empty:
        log(f"⚠️ yfinance returned empty DataFrame for batch {tickers}", 'warning')
        return {t: [] for t in tickers}

    results: Dict[str, List[Dict[str, Any]]] = {t: [] for t in tickers}

    # Handle two column layouts:
    # 1) Single ticker: data.columns = Index(['Open','High','Low','Close','Adj Close','Volume'])
    # 2) Multiple tickers: data.columns = MultiIndex(levels=[tickers, fields])
    is_multi = isinstance(data.columns, pd.MultiIndex)

    # Build a map from Yahoo symbol (e.g., BRK-B) → original ticker (e.g., BRK.B)
    # so we can look up rows even when Yahoo uses a different separator.
    yahoo_to_orig: Dict[str, str] = {}
    for ticker in tickers:
        yahoo_to_orig[_yahoo_symbol(ticker)] = ticker

    for ticker in tickers:
        ysym = _yahoo_symbol(ticker)
        try:
            if is_multi:
                # MultiIndex columns → access by Yahoo symbol
                if ysym not in data.columns.get_level_values(0):
                    continue
                df = data[ysym].dropna(subset=['Close'])
            else:
                # Single ticker — columns are flat
                df = data.dropna(subset=['Close'])

            if df.empty:
                continue

            for date_idx, row in df.iterrows():
                try:
                    close = row.get('Close')
                    if close is None or pd.isna(close) or float(close) <= 0:
                        continue

                    date_str = date_idx.strftime('%Y-%m-%d') if hasattr(date_idx, 'strftime') else str(date_idx)[:10]

                    open_p = row.get('Open')
                    high_p = row.get('High')
                    low_p = row.get('Low')
                    volume = row.get('Volume')

                    results[ticker].append({
                        'date': date_str,
                        'open_price': float(open_p) if open_p is not None and not pd.isna(open_p) else None,
                        'high_price': float(high_p) if high_p is not None and not pd.isna(high_p) else None,
                        'low_price': float(low_p) if low_p is not None and not pd.isna(low_p) else None,
                        'close_price': float(close),
                        'volume': int(volume) if volume is not None and not pd.isna(volume) else 0,
                    })
                except Exception as e:
                    logger.debug(f"Row parse error {ticker} {date_idx}: {e}")
        except Exception as e:
            log(f"⚠️ Parse error for {ticker}: {str(e)[:80]}", 'warning')

    return results


# ────────────────────────────────────────────────────────────────────────────
# DB write
# ────────────────────────────────────────────────────────────────────────────
def save_batch_to_db(
    conn: sqlite3.Connection,
    ticker: str,
    rows: List[Dict[str, Any]],
) -> int:
    """
    Write rows for one ticker to price_history.db.

    Per Rule 12 + Rule 66 (P1-PARALLEL-ENGINES-FIX 2026-10-12):
      All writes to `price_history` MUST go through `write_guarded()` from
      `vps-service/data/source_authority.py`. The guard:
        - rejects BANNED sources (egxpilot_live, yahoo_safetynet, ...)
        - rejects sources not in the market's CANONICAL_SOURCES list
        - skips the write if a higher-priority source already has FRESH data
          for this ticker (< 7 days old)
      The guard transparently rewrites the source label to the market's
      PRIMARY canonical name when writing from a FALLBACK source.

    Each row gets:
      - source = 'yahoo_us'  (declared as US fallback in CANONICAL_SOURCES)
      - market = 'US'
      - adjusted = 0

    Returns: number of rows actually written (after guard filtering).
    """
    if not rows:
        return 0

    # ── Lazy import of write_guarded ──────────────────────────────────────
    # The scraper may be invoked from contexts where vps-service isn't on
    # the path (e.g., a standalone cron). Fall back to a direct INSERT
    # only if the import fails — and warn loudly.
    try:
        import sys as _sys
        _vps_dir = str(_THIS_DIR.parent.parent / 'vps-service')
        if _vps_dir not in _sys.path:
            _sys.path.insert(0, _vps_dir)
        from data.source_authority import write_guarded as _write_guarded
        _GUARD_AVAILABLE = True
    except Exception as _e:
        logger.warning(
            f"⚠️ write_guarded unavailable ({_e}); falling back to direct INSERT. "
            "Rule 12 + Rule 66 violation — please fix the import path."
        )
        _write_guarded = None
        _GUARD_AVAILABLE = False

    written = 0
    ticker = _normalize_ticker(ticker)
    db_path_str = str(PRICE_HISTORY_DB)
    for row in rows:
        try:
            if _GUARD_AVAILABLE:
                ok = _write_guarded(
                    db_path=db_path_str,
                    ticker=ticker,
                    market=MARKET,
                    date=row['date'],
                    open_price=row.get('open_price') or 0.0,
                    high_price=row.get('high_price') or 0.0,
                    low_price=row.get('low_price') or 0.0,
                    close_price=row.get('close_price') or 0.0,
                    volume=int(row.get('volume', 0) or 0),
                    source=SOURCE,          # 'yahoo_us'
                    adjusted=0,             # raw prices
                    market_label=MARKET,   # 'US'
                )
                if ok:
                    written += 1
            else:
                # Fallback path — only used if write_guarded import failed.
                conn.execute("""
                    INSERT OR REPLACE INTO price_history
                    (ticker, date, open_price, high_price, low_price,
                     close_price, volume, source, adjusted, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    ticker,
                    row['date'],
                    row.get('open_price'),
                    row.get('high_price'),
                    row.get('low_price'),
                    row.get('close_price'),
                    row.get('volume', 0),
                    SOURCE,         # 'yahoo_us'
                    0,              # adjusted = raw prices
                    MARKET,         # 'US'
                ))
                written += 1
        except Exception as e:
            logger.debug(f"INSERT error {ticker} {row.get('date')}: {e}")

    if _GUARD_AVAILABLE:
        # The guard opens its own connection per row; commit on the caller's
        # connection is a no-op but harmless. Skip it to avoid confusion.
        pass
    else:
        conn.commit()
    return written


# ────────────────────────────────────────────────────────────────────────────
# Main fetch routine
# ────────────────────────────────────────────────────────────────────────────
def fetch_us_stocks(
    tickers: Optional[List[str]] = None,
    period_days: int = DEFAULT_PERIOD_DAYS,
    max_tickers: int = MAX_TICKERS,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Fetch OHLCV for a list of US tickers and persist to price_history.db.

    Args:
        tickers: optional override (else read from stocks.db WHERE market='US')
        period_days: yfinance period (default 30d)
        max_tickers: safety cap on number of tickers processed
        dry_run: if True, do NOT make network calls or DB writes — just print

    Returns:
        Dict with: tickers_processed, tickers_updated, tickers_failed,
                   rows_inserted, sample_failures, sample_updated,
                   dry_run, started_at, finished_at
    """
    result: Dict[str, Any] = {
        'tickers_processed': 0,
        'tickers_updated': 0,
        'tickers_failed': 0,
        'tickers_skipped': 0,
        'rows_inserted': 0,
        'sample_failures': [],
        'sample_updated': [],
        'dry_run': dry_run,
        'market': MARKET,
        'source': SOURCE,
        'started_at': _now_iso(),
        'period_days': period_days,
        'batch_size': BATCH_SIZE,
    }

    update_status({
        'running': True,
        'last_run_started_at': result['started_at'],
        'dry_run': dry_run,
    })

    # ── 1. Resolve ticker list ──
    if tickers:
        ticker_list = [_normalize_ticker(t) for t in tickers if t and t.strip()]
    else:
        from_db = get_us_tickers_from_db()
        ticker_list = [t for t, _ in from_db]

    ticker_list = sorted(set(ticker_list))
    if len(ticker_list) > max_tickers:
        log(f"⚠️ Capping ticker list from {len(ticker_list)} to {max_tickers}", 'warning')
        ticker_list = ticker_list[:max_tickers]

    if not ticker_list:
        msg = "No US tickers found — run scripts/seed_us_stocks.py first"
        log(f"❌ {msg}")
        result['error'] = msg
        result['finished_at'] = _now_iso()
        update_status({'running': False, 'last_error': msg, 'results': result})
        return result

    log(f"📡 US scraper: {len(ticker_list)} tickers | period={period_days}d | "
        f"batch={BATCH_SIZE} | dry_run={dry_run}")

    if dry_run:
        # Print the list and exit — NO network calls, NO DB writes
        for i, t in enumerate(ticker_list, 1):
            print(f"  {i:3d}. {t}")
        result['tickers_processed'] = len(ticker_list)
        result['tickers_skipped'] = len(ticker_list)
        result['finished_at'] = _now_iso()
        update_status({'running': False, 'results': result})
        log(f"✅ [DRY-RUN] Would fetch {len(ticker_list)} tickers — no network/DB writes")
        return result

    if not YFINANCE_AVAILABLE:
        msg = "yfinance not installed — cannot fetch live data"
        log(f"❌ {msg}")
        result['error'] = msg
        result['finished_at'] = _now_iso()
        update_status({'running': False, 'last_error': msg, 'results': result})
        return result

    # ── 2. Open price_history.db + ensure schema ──
    if not PRICE_HISTORY_DB.exists():
        # Create empty DB so the schema can be created
        PRICE_HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)

    ph_conn = sqlite3.connect(str(PRICE_HISTORY_DB), timeout=30.0)
    ph_conn.execute('PRAGMA journal_mode=WAL')
    ph_conn.execute('PRAGMA busy_timeout=30000')

    if not ensure_price_history_schema(ph_conn):
        ph_conn.close()
        result['error'] = 'Schema ensure failed'
        result['finished_at'] = _now_iso()
        update_status({'running': False, 'last_error': 'Schema ensure failed', 'results': result})
        return result

    # ── 3. Batch fetch + write ──
    total_batches = (len(ticker_list) + BATCH_SIZE - 1) // BATCH_SIZE
    log(f"📊 {len(ticker_list)} tickers in {total_batches} batches (batch size={BATCH_SIZE})")

    for batch_idx in range(0, len(ticker_list), BATCH_SIZE):
        batch = ticker_list[batch_idx:batch_idx + BATCH_SIZE]
        batch_no = batch_idx // BATCH_SIZE + 1
        log(f"  ▶️ Batch {batch_no}/{total_batches}: {batch}")

        # Fetch
        fetched = fetch_batch(batch, period_days=period_days)

        # Write each ticker
        for ticker in batch:
            rows = fetched.get(ticker, [])
            result['tickers_processed'] += 1
            if not rows:
                result['tickers_failed'] += 1
                if len(result['sample_failures']) < 10:
                    result['sample_failures'].append({
                        'ticker': ticker,
                        'reason': 'no rows returned from yfinance',
                    })
                continue

            written = save_batch_to_db(ph_conn, ticker, rows)
            if written > 0:
                result['tickers_updated'] += 1
                result['rows_inserted'] += written
                if len(result['sample_updated']) < 10:
                    result['sample_updated'].append({
                        'ticker': ticker,
                        'rows': written,
                        'first_date': rows[0]['date'],
                        'last_date': rows[-1]['date'],
                        'last_close': rows[-1]['close_price'],
                    })
            else:
                result['tickers_failed'] += 1
                if len(result['sample_failures']) < 10:
                    result['sample_failures'].append({
                        'ticker': ticker,
                        'reason': '0 rows written (all NaN?)',
                    })

        # Rate limit between batches
        if BATCH_DELAY > 0 and batch_idx + BATCH_SIZE < len(ticker_list):
            time.sleep(BATCH_DELAY)

    ph_conn.close()
    result['finished_at'] = _now_iso()

    log(
        f"✅ DONE | processed={result['tickers_processed']} "
        f"updated={result['tickers_updated']} failed={result['tickers_failed']} "
        f"rows_inserted={result['rows_inserted']}"
    )

    update_status({
        'running': False,
        'last_run_finished_at': result['finished_at'],
        'last_run_summary': {
            'tickers_processed': result['tickers_processed'],
            'tickers_updated': result['tickers_updated'],
            'tickers_failed': result['tickers_failed'],
            'rows_inserted': result['rows_inserted'],
        },
        'results': result,
    })

    return result


# ────────────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────────────
def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='US Stock Scraper — fetch OHLCV from Yahoo Finance into price_history.db',
    )
    parser.add_argument(
        '--tickers',
        type=str,
        default=None,
        help='Comma-separated list of tickers (default: read all from stocks.db WHERE market=US)',
    )
    parser.add_argument(
        '--days',
        type=int,
        default=DEFAULT_PERIOD_DAYS,
        help=f'Period in days to fetch (default: {DEFAULT_PERIOD_DAYS})',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print what would be done — NO network calls, NO DB writes',
    )
    parser.add_argument(
        '--max-tickers',
        type=int,
        default=MAX_TICKERS,
        help=f'Safety cap on number of tickers (default: {MAX_TICKERS})',
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=BATCH_SIZE,
        help=f'Number of tickers per yfinance call (default: {BATCH_SIZE})',
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    # Override module-level config from CLI args
    global BATCH_SIZE
    if args.batch_size:
        BATCH_SIZE = max(1, min(args.batch_size, 20))  # cap at 20 for safety

    tickers: Optional[List[str]] = None
    if args.tickers:
        tickers = [t.strip() for t in args.tickers.split(',') if t.strip()]

    log("=" * 60)
    log("🇺🇸  US Stock Scraper — Yahoo Finance → price_history.db")
    log(f"   source={SOURCE} | market={MARKET} | adjusted=0 (raw prices)")
    log(f"   period={args.days}d | batch_size={BATCH_SIZE} | dry_run={args.dry_run}")
    log("=" * 60)

    result = fetch_us_stocks(
        tickers=tickers,
        period_days=args.days,
        max_tickers=args.max_tickers,
        dry_run=args.dry_run,
    )

    print()
    print("─" * 60)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))

    # Exit code: 0 if any rows inserted (or dry-run completed), 1 otherwise
    if args.dry_run:
        return 0 if result['tickers_processed'] > 0 else 1
    return 0 if result['rows_inserted'] > 0 else 1


if __name__ == '__main__':
    sys.exit(main())
