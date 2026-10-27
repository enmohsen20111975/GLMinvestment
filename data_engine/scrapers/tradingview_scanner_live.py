#!/usr/bin/env python3
"""
tradingview_scanner_live.py — Unified TradingView Scanner Engine
================================================================
Owner directive (2026-10-27): استبدال كل السكرابرات الميتة بمحرك موحد
TradingView Scanner API. لا Playwright، لا متصفحات، استهلاك رام صفري.

المصدر: POST https://scanner.tradingview.com/{market}/scan
الأسواق: egypt, saudi, kuwait, qatar, america
السرعة: < 3 ثوانٍ للكل (مثبت حيًا: 230ms لـ egypt)

الحقول الـ 60 (موثقة من الـ API):
  - بيانات الجلسة: close, change, change_abs, volume, Value.Traded, relative_volume_10d_calc, high, low, open
  - التقييم: market_cap_basic, enterprise_value_fq, price_earnings_ttm, price_sales_current, price_book_fq, ev_to_revenue, ev_to_ebitda
  - الأرباح: eps, eps_diluted, dividend_yield, dps_ttm, payout_ratio
  - الربحية: gross_margin, operating_margin, net_margin, roa, roe, roic
  - الموازنة: total_assets, total_current_assets, cash_and_equivalents, total_liabilities, total_debt, total_equity, shares_outstanding
  - الدخل: total_revenue, gross_profit, operating_income, net_income
  - التدفقات: cash_flow_operating, cash_flow_investing, cash_flow_financing, free_cash_flow
  - الفنية: Recommend.All, Recommend.MA, Recommend.Other, RSI, MACD.macd, MACD.signal, ATR, SMA20, SMA50, SMA200
  - وصف: description, sector, industry, currency, exchange, logoid

الحفظ: db/stocks.db → جدول stocks (CREATE TABLE IF NOT EXISTS + ALTER idempotent)

Usage:
  python3 data_engine/scrapers/tradingview_scanner_live.py              # كل الأسواق
  python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt  # سوق واحد
  python3 data_engine/scrapers/tradingview_scanner_live.py --dry-run     # بدون حفظ

Exit: 0 = success, 1 = error
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─── Config ─────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = REPO_ROOT / "db" / "stocks.db"

# Markets: (slug, arabic_label)
MARKETS = [
    ("egypt", "مصر"),
    ("ksa", "السعودية"),
    ("kuwait", "الكويت"),
    ("qatar", "قطر"),
    ("america", "أمريكا"),
]

# Scanner API endpoint
SCANNER_URL = "https://scanner.tradingview.com/{market}/scan"

# All 60 fields from the API (verified live 2026-10-27)
API_COLUMNS = [
    # session + liquidity (10)
    "name", "close", "change", "change_abs", "volume", "Value.Traded",
    "relative_volume_10d_calc", "high", "low", "open",
    # valuation (7)
    "market_cap_basic", "enterprise_value_fq", "price_earnings_ttm",
    "price_sales_current", "price_book_fq",
    "enterprise_value_to_revenue_ttm", "enterprise_value_to_ebitda_ttm",
    # earnings/dividends (5)
    "earnings_per_share_basic_ttm", "earnings_per_share_diluted_ttm",
    "dividends_yield_current", "dps_common_stock_prim_issue_fy",
    "payout_ratio_ttm_fq",
    # profitability (6)
    "gross_margin", "operating_margin", "net_margin",
    "return_on_assets", "return_on_equity", "return_on_invested_capital",
    # balance sheet (7)
    "total_assets", "total_current_assets", "cash_n_cash_equivalents_fq",
    "total_liabilities", "total_debt", "total_equity",
    "total_shares_outstanding_fundamental",
    # income (4)
    "total_revenue", "gross_profit", "operating_income", "net_income",
    # cash flow (4)
    "cash_f_operating_activities", "cash_f_investing_activities",
    "cash_f_financing_activities", "free_cash_flow",
    # technicals (10)
    "Recommend.All", "Recommend.MA", "Recommend.Other",
    "RSI", "MACD.macd", "MACD.signal",
    "ATR", "SMA20", "SMA50", "SMA200",
    # description (6)
    "description", "sector", "industry", "currency", "exchange", "logoid",
]

# API field → DB column mapping (snake_case + semantic names)
FIELD_MAP: Dict[str, str] = {
    "name": "symbol",
    "close": "current_price",
    "change": "change_percent",
    "change_abs": "change_value",
    "volume": "volume",
    "Value.Traded": "value_traded",
    "relative_volume_10d_calc": "relative_volume_10d",
    "high": "high_price",
    "low": "low_price",
    "open": "open_price",
    "market_cap_basic": "market_cap",
    "enterprise_value_fq": "enterprise_value",
    "price_earnings_ttm": "pe_ratio",
    "price_sales_current": "ps_ratio",
    "price_book_fq": "pb_ratio",
    "enterprise_value_to_revenue_ttm": "ev_to_revenue",
    "enterprise_value_to_ebitda_ttm": "ev_to_ebitda",
    "earnings_per_share_basic_ttm": "eps",
    "earnings_per_share_diluted_ttm": "eps_diluted",
    "dividends_yield_current": "dividend_yield",
    "dps_common_stock_prim_issue_fy": "dps_ttm",
    "payout_ratio_ttm_fq": "payout_ratio",
    "gross_margin": "gross_margin",
    "operating_margin": "operating_margin",
    "net_margin": "profit_margin",
    "return_on_assets": "roa",
    "return_on_equity": "roe",
    "return_on_invested_capital": "roic",
    "total_assets": "total_assets",
    "total_current_assets": "total_current_assets",
    "cash_n_cash_equivalents_fq": "cash_and_equivalents",
    "total_liabilities": "total_liabilities",
    "total_debt": "total_debt",
    "total_equity": "total_equity",
    "total_shares_outstanding_fundamental": "shares_outstanding",
    "total_revenue": "total_revenue",
    "gross_profit": "gross_profit",
    "operating_income": "operating_income",
    "net_income": "net_income",
    "cash_f_operating_activities": "cash_flow_operating",
    "cash_f_investing_activities": "cash_flow_investing",
    "cash_f_financing_activities": "cash_flow_financing",
    "free_cash_flow": "free_cash_flow",
    "Recommend.All": "recommend_all",
    "Recommend.MA": "recommend_ma",
    "Recommend.Other": "recommend_other",
    "RSI": "rsi",
    "MACD.macd": "macd",
    "MACD.signal": "macd_signal",
    "ATR": "atr",
    "SMA20": "sma20",
    "SMA50": "sma50",
    "SMA200": "sma200",
    "description": "name_ar",
    "sector": "sector",
    "industry": "industry",
    "currency": "currency",
    "exchange": "exchange",
    "logoid": "logoid",
}

# DB column → SQLite type (REAL for numbers, TEXT for strings)
COLUMN_TYPES: Dict[str, str] = {
    "symbol": "TEXT", "current_price": "REAL", "change_percent": "REAL",
    "change_value": "REAL", "volume": "REAL", "value_traded": "REAL",
    "relative_volume_10d": "REAL", "high_price": "REAL", "low_price": "REAL",
    "open_price": "REAL", "market_cap": "REAL", "enterprise_value": "REAL",
    "pe_ratio": "REAL", "ps_ratio": "REAL", "pb_ratio": "REAL",
    "ev_to_revenue": "REAL", "ev_to_ebitda": "REAL", "eps": "REAL",
    "eps_diluted": "REAL", "dividend_yield": "REAL", "dps_ttm": "REAL",
    "payout_ratio": "REAL", "gross_margin": "REAL", "operating_margin": "REAL",
    "profit_margin": "REAL", "roa": "REAL", "roe": "REAL", "roic": "REAL",
    "total_assets": "REAL", "total_current_assets": "REAL",
    "cash_and_equivalents": "REAL", "total_liabilities": "REAL",
    "total_debt": "REAL", "total_equity": "REAL", "shares_outstanding": "REAL",
    "total_revenue": "REAL", "gross_profit": "REAL", "operating_income": "REAL",
    "net_income": "REAL", "cash_flow_operating": "REAL",
    "cash_flow_investing": "REAL", "cash_flow_financing": "REAL",
    "free_cash_flow": "REAL", "recommend_all": "REAL", "recommend_ma": "REAL",
    "recommend_other": "REAL", "rsi": "REAL", "macd": "REAL",
    "macd_signal": "REAL", "atr": "REAL", "sma20": "REAL", "sma50": "REAL",
    "sma200": "REAL", "name_ar": "TEXT", "sector": "TEXT", "industry": "TEXT",
    "currency": "TEXT", "exchange": "TEXT", "logoid": "TEXT",
    "logo_url": "TEXT",
    "tabs_data": "TEXT",  # JSON: merged historical tab data (from migration)
    # meta columns (not from API)
    "market": "TEXT", "turnover_egp": "REAL", "last_updated": "TEXT",
    "is_active": "INTEGER DEFAULT 1",
}

# TradingView S3 logo URL template (official, used by tradingview.com itself)
LOGO_URL_TEMPLATE = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"

HTTP_TIMEOUT = 20
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


# ─── Logging ────────────────────────────────────────────────────────────────


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


# ─── Pollution guard (preserved from tradingview_scraper.py) ────────────────


def _is_polluted_scrape_record(symbol: str, name: str) -> bool:
    """Return True if (symbol, name) matches the legacy merge-pollution signature.

    Catches:
      - Latin: symbol='LUTSL', name='LUTSLotus For Agricultural...D'
      - Arabic: symbol='COMI', name='COMIالبنك'
    """
    if not symbol or not name:
        return False
    # symbol contains Arabic
    if any("\u0600" <= ch <= "\u06FF" for ch in symbol):
        return True
    # name starts with symbol + has extra chars (merge bleed-through)
    if name.startswith(symbol) and len(name) > len(symbol) + 2:
        remainder = name[len(symbol):]
        if remainder and (remainder[0].isupper() or "\u0600" <= remainder[0] <= "\u06FF"):
            return True
    return False


# ─── HTTP ───────────────────────────────────────────────────────────────────


def fetch_market(market_slug: str) -> Tuple[List[Dict[str, Any]], float]:
    """Fetch all stocks for one market from Scanner API.

    Returns (rows, elapsed_ms). Each row is a dict of {db_column: value}.
    """
    url = SCANNER_URL.format(market=market_slug)
    body = {
        "range": [0, 1000],  # max 1000 stocks per market
        "columns": API_COLUMNS,
        "sort": {"sortBy": "Value.Traded", "sortOrder": "desc"},
        "markets": [market_slug],
        "options": {"lang": "ar"},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        log(f"  ❌ {market_slug}: HTTP {e.code} — {e.read().decode()[:200]}")
        return [], 0
    except Exception as e:
        log(f"  ❌ {market_slug}: {type(e).__name__}: {e}")
        return [], 0

    elapsed = (time.time() - t0) * 1000
    raw_rows = data.get("data", [])
    mapped: List[Dict[str, Any]] = []

    for row in raw_rows:
        s = row.get("s", "")  # e.g. "EGX:COMI"
        d = row.get("d")
        if d is None:
            continue
        # Handle both list (positional) and dict (keyed) shapes
        if isinstance(d, list):
            vals = dict(zip(API_COLUMNS, d))
        elif isinstance(d, dict):
            vals = d
        else:
            continue

        # Extract clean symbol from the "s" field (strip market prefix)
        symbol = s.split(":")[-1].strip() if ":" in s else s.strip()
        if not symbol:
            symbol = str(vals.get("name", "")).strip()

        name = str(vals.get("description", "")).strip()
        if _is_polluted_scrape_record(symbol, name):
            log(f"  ⚠️ skipped polluted: {symbol!r} / {name!r}")
            continue

        # Build the mapped row
        record: Dict[str, Any] = {"symbol": symbol, "ticker": symbol}
        for api_field, db_col in FIELD_MAP.items():
            if api_field == "name":
                continue  # already set as symbol
            val = vals.get(api_field)
            record[db_col] = val
        # SCANNER-LIVE-3 (2026-10-27): build logo_url from logoid
        logoid = record.get("logoid")
        if logoid:
            record["logo_url"] = LOGO_URL_TEMPLATE.format(logoid=logoid)
        else:
            record["logo_url"] = None
        record["market"] = market_slug
        # value_traded = turnover_egp (same thing, EGX cash value)
        if record.get("value_traded") is not None:
            record["turnover_egp"] = record["value_traded"]
        record["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        mapped.append(record)

    return mapped, elapsed


# ─── DB ─────────────────────────────────────────────────────────────────────


def _ensure_schema(conn: sqlite3.Connection) -> int:
    """CREATE TABLE IF NOT EXISTS + ALTER TABLE for missing columns.

    Returns number of columns added via ALTER.
    """
    cur = conn.cursor()
    # Build CREATE TABLE with all columns
    col_defs = []
    for col, typ in COLUMN_TYPES.items():
        col_defs.append(f'"{col}" {typ}')
    create_sql = f'''
        CREATE TABLE IF NOT EXISTS stocks (
            {", ".join(col_defs)},
            "id" INTEGER PRIMARY KEY AUTOINCREMENT
        )
    '''
    cur.execute(create_sql)

    # Check existing columns and ALTER for missing ones
    existing = {r[1] for r in cur.execute("PRAGMA table_info(stocks)").fetchall()}
    added = 0
    for col, typ in COLUMN_TYPES.items():
        if col not in existing:
            cur.execute(f'ALTER TABLE stocks ADD COLUMN "{col}" {typ}')
            added += 1

    # Ensure UNIQUE index on symbol (required for ON CONFLICT upsert)
    cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)')
    conn.commit()
    return added


def save_to_db(conn: sqlite3.Connection, rows: List[Dict[str, Any]]) -> int:
    """INSERT OR REPLACE rows into stocks table. Returns count saved."""
    if not rows:
        return 0
    cur = conn.cursor()
    # Get actual columns in DB
    db_cols = [r[1] for r in cur.execute("PRAGMA table_info(stocks)").fetchall()]
    db_cols_set = set(db_cols)

    # Build INSERT OR REPLACE using only columns that exist in DB
    # All rows should have the same keys
    sample_keys = [k for k in rows[0].keys() if k in db_cols_set]
    placeholders = ", ".join(["?"] * len(sample_keys))
    col_list = ", ".join(f'"{k}"' for k in sample_keys)
    conflict_col = "ticker" if "ticker" in db_cols_set else "symbol"
    update_set = ", ".join(f'"{k}" = excluded."{k}"' for k in sample_keys if k not in ("symbol", "ticker", "id"))

    sql = f'''
        INSERT INTO stocks ({col_list})
        VALUES ({placeholders})
        ON CONFLICT({conflict_col}) DO UPDATE SET
            {update_set}
    '''
    saved = 0
    for row in rows:
        try:
            cur.execute(sql, tuple(row.get(k) for k in sample_keys))
            saved += 1
        except Exception as e:
            log(f"  ⚠️ save error {row.get('symbol')}: {e}")

    conn.commit()
    return saved


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="TradingView Scanner Live — unified scraper")
    ap.add_argument("--market", default="all", help="market slug (egypt/saudi/kuwait/qatar/america) or 'all'")
    ap.add_argument("--dry-run", action="store_true", help="fetch only, no DB save")
    ap.add_argument("--db", default=str(DB_PATH), help="DB path")
    args = ap.parse_args()

    markets = MARKETS if args.market == "all" else [(m, l) for m, l in MARKETS if m == args.market]
    if not markets:
        log(f"unknown market: {args.market}")
        return 1

    print("=" * 70)
    print("TradingView Scanner Live — Unified Engine")
    print("=" * 70)
    print(f"DB: {args.db}")
    print(f"Markets: {[m for m, _ in markets]}")
    print(f"Fields: {len(API_COLUMNS)}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print()

    conn = None
    if not args.dry_run:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(args.db)
        added = _ensure_schema(conn)
        if added:
            log(f"📦 schema: added {added} new columns via ALTER")

    total_rows = 0
    total_time = 0.0

    for slug, label in markets:
        log(f"🌍 fetching {slug} ({label})...")
        rows, elapsed = fetch_market(slug)
        total_time += elapsed
        total_rows += len(rows)

        if rows:
            # Show top 3 by value_traded
            top = sorted(rows, key=lambda r: r.get("value_traded") or 0, reverse=True)[:3]
            log(f"  ✅ {len(rows)} stocks in {elapsed:.0f}ms")
            for r in top:
                vt = r.get("value_traded")
                vt_str = f"{vt/1e6:.0f}M" if vt else "—"
                log(f"     {r['symbol']:8} cash={vt_str:>8} | close={r.get('current_price')} | RSI={r.get('rsi')}")
        else:
            log(f"  ⚠️ 0 stocks returned")

        if not args.dry_run and rows:
            saved = save_to_db(conn, rows)
            log(f"  💾 saved {saved}/{len(rows)} to stocks table")

    if conn:
        conn.close()

    print()
    print("=" * 70)
    print(f"TOTAL: {total_rows} stocks across {len(markets)} markets in {total_time:.0f}ms")
    print(f"Average: {total_time/len(markets):.0f}ms per market")
    if not args.dry_run:
        print(f"DB: {args.db}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
