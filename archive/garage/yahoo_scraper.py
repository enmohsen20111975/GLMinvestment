#!/usr/bin/env python3
"""
Yahoo Finance Scraper — Last-resort fallback for EGX stocks
============================================================

الوظيفة:
  - يجيب أسعار أسهم EGX من Yahoo Finance (yfinance library).
  - بياخد قائمة الـ tickers من stocks.db (WHERE market='EGX') ويجرّب كل واحد.
  - بيستخدم suffix '.CA' للأسهم المصرية على Yahoo (مثل COMI.CA, ETEL.CA).
  - يرجّع list of dicts بنفس شكل tradingview_scraper (symbol, name, price, ...).

الـ Documentation المرجعي:
  - HOW_WE_ANALYZE_AND_PREDICT.md §18 — Fallback Chain (TV → EGXPilot → Yahoo)

Note: Yahoo Finance ممكن يكون فيه rate limit. بنتأخر 0.3s بين كل طلب.
المكتبة: yfinance (https://github.com/ranaroussi/yfinance)

@author M2y Platform
@version 1.0.0 — يوليو 2026 (Fallback Chain - Phase 1)
"""
from __future__ import annotations

import os
import sys
import json
import sqlite3
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Make sure we can import shared helpers when invoked as a script or module
_THIS_DIR = Path(__file__).resolve().parent
_SCRAPERS_DIR = _THIS_DIR
_DATA_ENGINE_DIR = _THIS_DIR.parent
_PROJECT_ROOT = _DATA_ENGINE_DIR.parent

# Database paths - unified in /db folder
DB_FILE = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Yahoo uses '.CA' suffix for Egyptian stocks (Cairo exchange)
YAHOO_EGX_SUFFIX = os.environ.get('YAHOO_EGX_SUFFIX', '.CA')
# Delay between requests to avoid rate limit (seconds)
YAHOO_DELAY = float(os.environ.get('YAHOO_DELAY', '0.3'))
# Max tickers to fetch in one run (avoid hammering Yahoo for hours)
YAHOO_MAX_TICKERS = int(os.environ.get('YAHOO_MAX_TICKERS', '280'))

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [Yahoo] %(message)s', datefmt='%H:%M:%S'))
    logger.addHandler(_h)


def log(msg: str, level: str = 'info') -> None:
    """Compat log function matching tradingview_scraper signature."""
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}")
    getattr(logger, level.lower(), logger.info)(msg)


# ============================================================================
# yfinance import (optional dependency)
# ============================================================================

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    log("⚠️ yfinance not installed — Yahoo scraper will return empty list", 'warning')


# ============================================================================
# Ticker list helpers
# ============================================================================

def _get_egx_tickers_from_db() -> List[Tuple[str, str]]:
    """
    جلب قائمة tickers EGX من stocks.db.
    Returns: list of (ticker, name) tuples.
    """
    if not os.path.exists(STOCKS_DB):
        log(f"⚠️ stocks.db not found at {STOCKS_DB}", 'warning')
        return []

    try:
        conn = sqlite3.connect(STOCKS_DB, timeout=15.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT ticker, name FROM stocks
            WHERE market = 'EGX' AND (is_active = 1 OR is_active IS NULL)
            ORDER BY ticker
        """)
        rows = cur.fetchall()
        conn.close()
        return [(r['ticker'], r['name'] or r['ticker']) for r in rows]
    except Exception as e:
        log(f"⚠️ Failed to read EGX tickers from stocks.db: {e}", 'warning')
        return []


# ============================================================================
# Yahoo Finance fetch
# ============================================================================

def _fetch_one_yahoo(ticker: str) -> Optional[Dict]:
    """جلب سهم واحد من Yahoo Finance."""
    if not YFINANCE_AVAILABLE:
        return None
    yahoo_symbol = f"{ticker}{YAHOO_EGX_SUFFIX}" if not ticker.endswith(YAHOO_EGX_SUFFIX) else ticker
    try:
        t = yf.Ticker(yahoo_symbol)
        hist = t.history(period='5d')
        if hist is None or hist.empty:
            return None

        last_row = hist.iloc[-1]
        close = float(last_row.get('Close', 0) or 0)
        if close <= 0:
            return None

        # Compute change_percent from last two rows (if available)
        if len(hist) >= 2:
            prev_close = float(hist.iloc[-2].get('Close', close) or close)
        else:
            prev_close = close
        change_pct = round(((close - prev_close) / prev_close) * 100.0, 4) if prev_close > 0 else 0.0

        volume = int(last_row.get('Volume', 0) or 0)
        high = float(last_row.get('High', close) or close)
        low = float(last_row.get('Low', close) or close)
        open_p = float(last_row.get('Open', close) or close)

        return {
            'symbol': ticker,
            'name': ticker,  # Yahoo returns long names sometimes; we'll keep it simple
            'price': close,
            'change_percent': change_pct,
            'volume': str(volume),
            'market_cap': '',
            'sector': '',
            'tabs_data': {
                'open_price': open_p,
                'high': high,
                'low': low,
                'prev_close': prev_close,
                'source': 'yahoo_finance',
            },
        }
    except Exception as e:
        log(f"⚠️ Yahoo fetch error for {ticker}: {str(e)[:60]}", 'warning')
        return None


def fetch_yahoo_stocks(max_tickers: int = YAHOO_MAX_TICKERS) -> Tuple[List[Dict], str]:
    """
    جلب أسعار أسهم EGX من Yahoo Finance.

    Args:
        max_tickers: أقصى عدد من الـ tickers نجرّبهم (لتجنّب rate limit).

    Returns:
        Tuple[List[Dict], str]: (stocks_list, status_message)
    """
    if not YFINANCE_AVAILABLE:
        return [], "Yahoo: yfinance غير متاح"

    log(f"📡 جلب قائمة الـ tickers من stocks.db...")
    tickers = _get_egx_tickers_from_db()
    if not tickers:
        return [], "Yahoo: لا يوجد tickers EGX في stocks.db"

    # Apply max cap
    tickers = tickers[:max_tickers]
    log(f"📡 محاولة جلب {len(tickers)} سهم من Yahoo Finance (suffix={YAHOO_EGX_SUFFIX})...")

    results: List[Dict] = []
    failed = 0
    for i, (ticker, name) in enumerate(tickers):
        stock = _fetch_one_yahoo(ticker)
        if stock:
            # Override name with stocks.db name
            stock['name'] = name or ticker
            results.append(stock)
        else:
            failed += 1

        # Rate limit delay
        if YAHOO_DELAY > 0:
            time.sleep(YAHOO_DELAY)

        # Progress log every 50 tickers
        if (i + 1) % 50 == 0:
            log(f"  ... {i + 1}/{len(tickers)} (success={len(results)}, failed={failed})")

    if not results or len(results) < 30:
        return [], f"Yahoo: بيانات غير كافية ({len(results)} سهم فقط من {len(tickers)})"

    log(f"✅ Yahoo Finance: تم استلام {len(results)} سهم ({failed} فشل)")
    return results, 'success'


# ============================================================================
# DB Save (same schema as tradingview_scraper + egxpilot_scraper)
# ============================================================================

def save_to_db(stocks: List[Dict], market: str = 'مصر') -> int:
    """
    حفظ الأسهم في data_engine.db (نفس schema).
    Returns: عدد الأسهم المحفوظة.
    """
    if not stocks:
        return 0

    conn = sqlite3.connect(DB_FILE, timeout=30.0)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    cursor = conn.cursor()

    # Ensure table exists
    cursor.execute('''
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

    saved = 0
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for s in stocks:
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO stocks
                (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                s.get('symbol', ''), s.get('name', ''), float(s.get('price', 0) or 0),
                float(s.get('change_percent', 0) or 0), s.get('volume', ''), s.get('market_cap', ''),
                s.get('sector', ''), market,
                json.dumps(s.get('tabs_data', {}), ensure_ascii=False), now
            ))
            saved += 1
        except Exception as e:
            log(f"⚠️ DB save error for {s.get('symbol', '?')}: {e}", 'warning')

    conn.commit()
    conn.close()
    return saved


# ============================================================================
# Public API
# ============================================================================

def fetch_yahoo_stocks_and_save() -> Dict:
    """
    جلب + حفظ في data_engine.db.

    Returns:
        Dict: {success, source, stocks_count, market, message}
    """
    stocks, status = fetch_yahoo_stocks()
    if not stocks:
        return {
            'success': False,
            'source': 'yahoo',
            'stocks_count': 0,
            'market': 'مصر',
            'message': status,
        }

    saved = save_to_db(stocks, market='مصر')
    return {
        'success': True,
        'source': 'yahoo',
        'stocks_count': saved,
        'market': 'مصر',
        'message': f'تم حفظ {saved} سهم من Yahoo Finance',
    }


# ============================================================================
# CLI Entry
# ============================================================================

def main() -> int:
    """CLI entry — يرجع 0 على النجاح، 1 على الفشل."""
    log("=" * 50)
    log("📡 Yahoo Finance Scraper (Last-resort fallback)")
    log(f"EGX suffix: {YAHOO_EGX_SUFFIX} | Max tickers: {YAHOO_MAX_TICKERS}")
    log("=" * 50)

    result = fetch_yahoo_stocks_and_save()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
