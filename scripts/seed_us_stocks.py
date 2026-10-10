#!/usr/bin/env python3
"""
seed_us_stocks.py — Seed US stocks into stocks.db
=================================================
Seeds the top 50 US stocks by market cap (S&P 50 top components) into the
local `stocks.db` so they appear in the unified multi-market radar.

Tickers covered (50):
  AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, BRK.B, JPM, V,
  JNJ, WMT, MA, PG, UNH, HD, CVX, MRK, ABBV, PFE,
  KO, PEP, BAC, TMO, COST, AVGO, MCD, CRM, AMD, NFLX,
  ACN, ADBE, DHR, ORCL, CMCSA, NEE, TXN, WFC, PM, IBM,
  MS, QCOM, RTX, HON, UPS, INTC, CAT, BA, GE, GM

Idempotent: uses INSERT OR REPLACE so re-running is safe.

Usage:
    python3 scripts/seed_us_stocks.py
    python3 scripts/seed_us_stocks.py --dry-run
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "db" / "stocks.db"


# ============================================================================
# Top 50 US stocks by market cap (S&P 50 top components)
# ============================================================================

US_STOCKS = [
    # Technology
    {"ticker": "AAPL",  "name_ar": "آبل",                  "name_en": "Apple Inc.",                       "sector": "Technology"},
    {"ticker": "MSFT",  "name_ar": "مايكروسوفت",            "name_en": "Microsoft Corporation",            "sector": "Technology"},
    {"ticker": "GOOGL", "name_ar": "جوجل",                  "name_en": "Alphabet Inc.",                     "sector": "Communication Services"},
    {"ticker": "AMZN",  "name_ar": "أمازون",                "name_en": "Amazon.com Inc.",                  "sector": "Consumer Discretionary"},
    {"ticker": "NVDA",  "name_ar": "إنفيديا",               "name_en": "NVIDIA Corporation",               "sector": "Technology"},
    {"ticker": "META",  "name_ar": "ميتا",                  "name_en": "Meta Platforms Inc.",              "sector": "Communication Services"},
    {"ticker": "TSLA",  "name_ar": "تسلا",                  "name_en": "Tesla Inc.",                       "sector": "Consumer Discretionary"},
    {"ticker": "BRK.B", "name_ar": "بيركشاير هاثاواي",      "name_en": "Berkshire Hathaway Inc.",          "sector": "Financials"},
    {"ticker": "JPM",   "name_ar": "جي بي مورجان",          "name_en": "JPMorgan Chase & Co.",            "sector": "Financials"},
    {"ticker": "V",     "name_ar": "فيزا",                  "name_en": "Visa Inc.",                        "sector": "Financials"},
    {"ticker": "JNJ",   "name_ar": "جونسون آند جونسون",     "name_en": "Johnson & Johnson",               "sector": "Healthcare"},
    {"ticker": "WMT",   "name_ar": "وول مارت",              "name_en": "Walmart Inc.",                     "sector": "Consumer Staples"},
    {"ticker": "MA",    "name_ar": "ماستركارد",              "name_en": "Mastercard Incorporated",         "sector": "Financials"},
    {"ticker": "PG",    "name_ar": "بروكتر آند غامبل",      "name_en": "Procter & Gamble Company",         "sector": "Consumer Staples"},
    {"ticker": "UNH",   "name_ar": "يونايتد هيلث جروب",     "name_en": "UnitedHealth Group Incorporated", "sector": "Healthcare"},
    {"ticker": "HD",    "name_ar": "هوم ديبوت",             "name_en": "The Home Depot, Inc.",             "sector": "Consumer Discretionary"},
    {"ticker": "CVX",   "name_ar": "شيفرون",                "name_en": "Chevron Corporation",              "sector": "Energy"},
    {"ticker": "MRK",   "name_ar": "ميرك",                  "name_en": "Merck & Co., Inc.",                "sector": "Healthcare"},
    {"ticker": "ABBV",  "name_ar": "أبفي",                  "name_en": "AbbVie Inc.",                      "sector": "Healthcare"},
    {"ticker": "PFE",   "name_ar": "فايزر",                 "name_en": "Pfizer Inc.",                      "sector": "Healthcare"},
    {"ticker": "KO",    "name_ar": "كوكاكولا",              "name_en": "The Coca-Cola Company",            "sector": "Consumer Staples"},
    {"ticker": "PEP",   "name_ar": "بيبسيكو",               "name_en": "PepsiCo, Inc.",                    "sector": "Consumer Staples"},
    {"ticker": "BAC",   "name_ar": "بنك أوف أمريكا",         "name_en": "Bank of America Corporation",     "sector": "Financials"},
    {"ticker": "TMO",   "name_ar": "ثرمو فيشر",             "name_en": "Thermo Fisher Scientific Inc.",   "sector": "Healthcare"},
    {"ticker": "COST",  "name_ar": "كوستكو",                "name_en": "Costco Wholesale Corporation",     "sector": "Consumer Staples"},
    {"ticker": "AVGO",  "name_ar": "برودكوم",               "name_en": "Broadcom Inc.",                    "sector": "Technology"},
    {"ticker": "MCD",   "name_ar": "ماكدونالدز",             "name_en": "McDonald's Corporation",          "sector": "Consumer Discretionary"},
    {"ticker": "CRM",   "name_ar": "سيلزفورس",               "name_en": "Salesforce, Inc.",                 "sector": "Technology"},
    {"ticker": "AMD",   "name_ar": "إيه إم دي",             "name_en": "Advanced Micro Devices, Inc.",    "sector": "Technology"},
    {"ticker": "NFLX",  "name_ar": "نتفليكس",               "name_en": "Netflix, Inc.",                    "sector": "Communication Services"},
    {"ticker": "ACN",   "name_ar": "أكسنتشر",               "name_en": "Accenture plc",                    "sector": "Technology"},
    {"ticker": "ADBE",  "name_ar": "أدوبي",                 "name_en": "Adobe Inc.",                       "sector": "Technology"},
    {"ticker": "DHR",   "name_ar": "داناهر",                "name_en": "Danaher Corporation",             "sector": "Healthcare"},
    {"ticker": "ORCL",  "name_ar": "أوراكل",                "name_en": "Oracle Corporation",              "sector": "Technology"},
    {"ticker": "CMCSA", "name_ar": "كومكاست",               "name_en": "Comcast Corporation",             "sector": "Communication Services"},
    {"ticker": "NEE",   "name_ar": "نيكستيرا إنرجي",         "name_en": "NextEra Energy, Inc.",            "sector": "Utilities"},
    {"ticker": "TXN",   "name_ar": "تكساس إنسترومنتس",      "name_en": "Texas Instruments Incorporated",   "sector": "Technology"},
    {"ticker": "WFC",   "name_ar": "ويلز فارغو",             "name_en": "Wells Fargo & Company",           "sector": "Financials"},
    {"ticker": "PM",    "name_ar": "فيليب موريس",            "name_en": "Philip Morris International",     "sector": "Consumer Staples"},
    {"ticker": "IBM",   "name_ar": "آي بي إم",               "name_en": "International Business Machines",   "sector": "Technology"},
    {"ticker": "MS",    "name_ar": "مورجان ستانلي",          "name_en": "Morgan Stanley",                  "sector": "Financials"},
    {"ticker": "QCOM",  "name_ar": "كوالكوم",                "name_en": "Qualcomm Incorporated",           "sector": "Technology"},
    {"ticker": "RTX",   "name_ar": "رايثيون",                "name_en": "RTX Corporation",                 "sector": "Industrials"},
    {"ticker": "HON",   "name_ar": "هانيويل",                "name_en": "Honeywell International Inc.",    "sector": "Industrials"},
    {"ticker": "UPS",   "name_ar": "يو بي إس",               "name_en": "United Parcel Service, Inc.",     "sector": "Industrials"},
    {"ticker": "INTC",  "name_ar": "إنتل",                  "name_en": "Intel Corporation",               "sector": "Technology"},
    {"ticker": "CAT",   "name_ar": "كاتربيلر",               "name_en": "Caterpillar Inc.",                "sector": "Industrials"},
    {"ticker": "BA",    "name_ar": "بوينغ",                 "name_en": "The Boeing Company",              "sector": "Industrials"},
    {"ticker": "GE",    "name_ar": "جنرال إلكتريك",          "name_en": "General Electric Company",        "sector": "Industrials"},
    {"ticker": "GM",    "name_ar": "جنرال موتورز",            "name_en": "General Motors Company",          "sector": "Consumer Discretionary"},
]


# ============================================================================
# Schema (matches stocks.db.stocks — created by VPS seed scripts)
# ============================================================================

CREATE_STOCKS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS stocks (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    name_ar TEXT,
    market TEXT,
    sector TEXT,
    is_active INTEGER DEFAULT 1,
    current_price REAL,
    previous_close REAL,
    market_cap REAL,
    pe_ratio REAL,
    pb_ratio REAL,
    eps REAL,
    roe REAL,
    roa REAL,
    dividend_yield REAL,
    high_52w REAL,
    low_52w REAL,
    ma_50 REAL,
    ma_200 REAL,
    rsi REAL,
    support REAL,
    resistance REAL,
    trend TEXT,
    turnover_egp REAL,
    last_update TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
"""

CREATE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
"""


def get_db_path() -> Path:
    """Resolve DB path. Allows override via STOCKS_DB env var."""
    env = os.environ.get("STOCKS_DB")
    if env:
        return Path(env)
    return DEFAULT_DB_PATH


def seed_us_stocks(db_path: Path = None, dry_run: bool = False) -> int:
    """Seed the 50 US stocks into stocks.db. Returns count of upserted rows."""
    db_path = db_path or get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("🇺🇸  US Stocks Seeder — top 50 by market cap")
    print("=" * 60)
    print(f"  DB: {db_path}")
    print(f"  Stocks to seed: {len(US_STOCKS)}")
    print(f"  Mode: {'DRY-RUN' if dry_run else 'LIVE'}")

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Ensure schema exists (idempotent)
    cur.executescript(CREATE_STOCKS_TABLE_SQL)
    cur.executescript(CREATE_INDEX_SQL)
    conn.commit()

    inserted = 0
    updated = 0
    for s in US_STOCKS:
        ticker = s["ticker"]
        name_en = s["name_en"]
        name_ar = s["name_ar"]
        sector = s["sector"]
        market = "US"

        if dry_run:
            print(f"  [dry-run] would upsert {ticker:7s} | {name_en:42s} | {name_ar}")
            inserted += 1
            continue

        # INSERT OR REPLACE — idempotent
        cur.execute(
            """
            INSERT OR REPLACE INTO stocks (
                ticker, name, name_ar, market, sector, is_active,
                current_price, previous_close, last_update
            ) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, datetime('now'))
            """,
            (ticker, name_en, name_ar, market, sector),
        )
        # rowcount tells us if the row was actually written (always 1 for REPLACE)
        # Distinguish insert vs update by querying prior existence
        inserted += 1

    if not dry_run:
        conn.commit()
    conn.close()

    # Count US stocks in DB after seeding
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM stocks WHERE market = 'US'")
    total_us = cur.fetchone()[0]
    conn.close()

    print()
    print(f"  ✅ Upserted: {inserted}")
    print(f"  📊 Total US stocks in DB: {total_us}")
    print("=" * 60)
    return inserted


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Seed 50 US stocks into stocks.db")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be done without writing")
    parser.add_argument("--db", type=str, help="Path to stocks.db (overrides default)")
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else get_db_path()
    n = seed_us_stocks(db_path=db_path, dry_run=args.dry_run)
    return 0 if n > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
