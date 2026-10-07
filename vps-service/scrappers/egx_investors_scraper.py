#!/usr/bin/env python3
"""
EGX Investors Flow Scraper — حركة المستثمرين (مصريين / عرب / أجانب)
==================================================================

Scraper / pipeline that populates the `investors_data` table in
`db/stocks.db` (SQLite) with daily buy/sell/net values per investor
type for the Egyptian Exchange (EGX).

Strategy
--------
1. **Primary source** — EGX official site `egyptse.com` publishes
   daily investor-flow reports at:
       - https://www.egyptse.com/en/markets/foreign-trading  (English)
       - https://www.egyptse.com/ar/markets/foreign-trading  (Arabic)
   The scraper attempts an HTTP fetch with a strict 10s timeout
   and graceful failure. If the page is blocked or the structure
   cannot be parsed, it falls back to (2).

2. **Fallback — computed estimate** — uses our existing
   `stock_daily_prices` table (turnover + trade-size distribution +
   advancing/declining split) and the long-term historical EGX ratios
   for investor participation:
       Egyptians   ≈ 70%
       Arabs       ≈ 10%
       Foreigners  ≈ 20%
   For each investor type we estimate a buy/sell split based on the
   day's advancing vs declining stocks and apply it to the day's
   total turnover allocated to that type.

The result is upserted (INSERT OR REPLACE) into `investors_data`
with `UNIQUE(date)` — safe to run multiple times for the same date.

Usage
-----
    python3 egx_investors_scraper.py                 # latest day only
    python3 egx_investors_scraper.py --days 30       # backfill last 30 days
    python3 egx_investors_scraper.py --date 2026-08-27
    python3 egx_investors_scraper.py --source-only   # do not write to DB

Author: GLMinvestment Team
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

try:
    import requests
except ImportError:  # pragma: no cover - scraper runs on production VPS
    requests = None  # type: ignore

# Make `vps-service/utils/db_paths.py` importable when run from project root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_VPS_ROOT = os.path.abspath(os.path.join(_HERE, os.pardir))
if _VPS_ROOT not in sys.path:
    sys.path.insert(0, _VPS_ROOT)

try:
    from utils.db_paths import DBPaths  # type: ignore
    DEFAULT_STOCKS_DB = DBPaths.STOCKS_DB
except Exception:  # pragma: no cover - fallback if db_paths missing
    DEFAULT_STOCKS_DB = os.path.join(
        os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir)),
        "db",
        "stocks.db",
    )

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("egx_investors")

# ─────────────────────────────────────────────────────────────────────────────
# Constants — historical EGX participation ratios + thresholds
# ─────────────────────────────────────────────────────────────────────────────
EGX_RATIO_EGYPTIANS = 0.70
EGX_RATIO_ARABS = 0.10
EGX_RATIO_FOREIGNERS = 0.20

# Stocks with average trade value > this threshold are treated as institutional flow
INSTITUTIONAL_TRADE_VALUE = 1_000_000.0

EGX_FOREIGN_TRADING_URL_EN = "https://www.egyptse.com/en/markets/foreign-trading"
EGX_FOREIGN_TRADING_URL_AR = "https://www.egyptse.com/ar/markets/foreign-trading"
HTTP_TIMEOUT_SECONDS = 10.0

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS investors_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    session_type TEXT,
    individuals_buys_value REAL,
    individuals_sells_value REAL,
    individuals_net_value REAL,
    arab_buys_value REAL,
    arab_sells_value REAL,
    arab_net_value REAL,
    foreign_buys_value REAL,
    foreign_sells_value REAL,
    foreign_net_value REAL,
    total_buys_value REAL,
    total_sells_value REAL,
    number_of_trades INTEGER,
    source TEXT DEFAULT 'computed_estimate',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date)
);
"""


# ─────────────────────────────────────────────────────────────────────────────
# Data class
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class InvestorFlowRow:
    date: str
    session_type: Optional[str]
    individuals_buys_value: float
    individuals_sells_value: float
    individuals_net_value: float
    arab_buys_value: float
    arab_sells_value: float
    arab_net_value: float
    foreign_buys_value: float
    foreign_sells_value: float
    foreign_net_value: float
    total_buys_value: float
    total_sells_value: float
    number_of_trades: int
    source: str = "computed_estimate"

    def to_dict(self) -> Dict[str, object]:
        d = asdict(self)
        return d


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────
def _connect(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        # Touch the file so we can create tables in it.
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        open(db_path, "a").close()
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=15000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(CREATE_TABLE_SQL)
    conn.commit()


def upsert_row(conn: sqlite3.Connection, row: InvestorFlowRow) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO investors_data (
            date, session_type,
            individuals_buys_value, individuals_sells_value, individuals_net_value,
            arab_buys_value, arab_sells_value, arab_net_value,
            foreign_buys_value, foreign_sells_value, foreign_net_value,
            total_buys_value, total_sells_value, number_of_trades,
            source, created_at
        ) VALUES (
            ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, datetime('now')
        )
        """,
        (
            row.date,
            row.session_type,
            row.individuals_buys_value,
            row.individuals_sells_value,
            row.individuals_net_value,
            row.arab_buys_value,
            row.arab_sells_value,
            row.arab_net_value,
            row.foreign_buys_value,
            row.foreign_sells_value,
            row.foreign_net_value,
            row.total_buys_value,
            row.total_sells_value,
            row.number_of_trades,
            row.source,
        ),
    )
    conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Primary source — egypsite.com scrape
# ─────────────────────────────────────────────────────────────────────────────
def _parse_egx_html(html: str) -> Optional[Dict[str, float]]:
    """
    Best-effort parser for the EGX foreign-trading page. The EGX site renders
    a table with rows like "Egyptians | Buy | Sell | Net" etc. We try multiple
    patterns. Returns None if extraction fails.
    """
    if not html:
        return None
    text = html.lower()
    # Detect whether this looks like the foreign-trading page.
    if "foreign trading" not in text and "تداول الأجانب" not in text and "أجانب" not in text:
        return None

    # Capture numbers that look like currency (1,234,567.89 or 1234567.89).
    # EGX reports are in EGP millions usually; we keep raw parsed value.
    float_re = re.compile(r"-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?")

    # Try a structured table approach — find labels and nearest numbers.
    label_map = {
        "egyptians": ("egyptians", "مصريين", "المصريين", "مصر"),
        "arab": ("arab", "arabs", "عرب", "العرب"),
        "foreign": ("foreign", "foreigners", "أجانب", "الأجانب"),
    }

    result: Dict[str, Dict[str, float]] = {}
    for key, aliases in label_map.items():
        for alias in aliases:
            idx = text.find(alias)
            if idx == -1:
                continue
            # Look in the next 1200 chars for 3 numbers (buy / sell / net)
            window = html[idx : idx + 1200]
            nums = float_re.findall(window)
            if len(nums) >= 3:
                try:
                    buy = float(nums[0].replace(",", ""))
                    sell = float(nums[1].replace(",", ""))
                    net = float(nums[2].replace(",", ""))
                    result[key] = {"buy": buy, "sell": sell, "net": net}
                    break
                except (ValueError, IndexError):
                    continue

    if not result:
        return None

    # Use whatever we found (fill missing with zero).
    def _g(key: str) -> Tuple[float, float, float]:
        d = result.get(key, {"buy": 0.0, "sell": 0.0, "net": 0.0})
        return d["buy"], d["sell"], d["net"]

    egy_buy, egy_sell, egy_net = _g("egyptians")
    arab_buy, arab_sell, arab_net = _g("arab")
    for_buy, for_sell, for_net = _g("foreign")
    return {
        "individuals_buys_value": egy_buy,
        "individuals_sells_value": egy_sell,
        "individuals_net_value": egy_net,
        "arab_buys_value": arab_buy,
        "arab_sells_value": arab_sell,
        "arab_net_value": arab_net,
        "foreign_buys_value": for_buy,
        "foreign_sells_value": for_sell,
        "foreign_net_value": for_net,
    }


def fetch_egx_real(session_date: Optional[str] = None) -> Optional[InvestorFlowRow]:
    """
    Attempt to fetch the EGX official foreign-trading page. Returns an
    InvestorFlowRow if successful, None otherwise.
    """
    if requests is None:
        log.warning("requests not installed — skipping real EGX scrape.")
        return None

    for url in (EGX_FOREIGN_TRADING_URL_EN, EGX_FOREIGN_TRADING_URL_AR):
        try:
            resp = requests.get(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
                },
                timeout=HTTP_TIMEOUT_SECONDS,
            )
            if resp.status_code != 200:
                log.info("EGX %s → HTTP %d", url, resp.status_code)
                continue
            parsed = _parse_egx_html(resp.text)
            if parsed:
                date_str = session_date or datetime.utcnow().strftime("%Y-%m-%d")
                total_buys = (
                    parsed["individuals_buys_value"]
                    + parsed["arab_buys_value"]
                    + parsed["foreign_buys_value"]
                )
                total_sells = (
                    parsed["individuals_sells_value"]
                    + parsed["arab_sells_value"]
                    + parsed["foreign_sells_value"]
                )
                row = InvestorFlowRow(
                    date=date_str,
                    session_type="day",
                    individuals_buys_value=parsed["individuals_buys_value"],
                    individuals_sells_value=parsed["individuals_sells_value"],
                    individuals_net_value=parsed["individuals_net_value"],
                    arab_buys_value=parsed["arab_buys_value"],
                    arab_sells_value=parsed["arab_sells_value"],
                    arab_net_value=parsed["arab_net_value"],
                    foreign_buys_value=parsed["foreign_buys_value"],
                    foreign_sells_value=parsed["foreign_sells_value"],
                    foreign_net_value=parsed["foreign_net_value"],
                    total_buys_value=total_buys,
                    total_sells_value=total_sells,
                    number_of_trades=0,
                    source="egx_official_scrape",
                )
                log.info("EGX real scrape OK for date=%s", row.date)
                return row
        except requests.exceptions.Timeout:
            log.info("EGX %s timed out after %.0fs", url, HTTP_TIMEOUT_SECONDS)
            continue
        except Exception as exc:  # pragma: no cover — defensive
            log.info("EGX %s failed: %s", url, exc)
            continue

    log.info("EGX real scrape unavailable — falling back to computed estimate.")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Fallback — computed estimate from stock_daily_prices
# ─────────────────────────────────────────────────────────────────────────────
def _latest_dates(conn: sqlite3.Connection, days: int) -> List[str]:
    cur = conn.execute(
        "SELECT DISTINCT price_date FROM stock_daily_prices "
        "WHERE price_date IS NOT NULL "
        "ORDER BY price_date DESC LIMIT ?",
        (days,),
    )
    return [r[0] for r in cur.fetchall() if r[0]]


def _safe_float(v: object) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0  # filter NaN
    except (TypeError, ValueError):
        return 0.0


def _compute_estimate_for_date(conn: sqlite3.Connection, date_str: str) -> Optional[InvestorFlowRow]:
    """
    Build an investor-flow estimate for a single trading day from
    `stock_daily_prices`. Returns None if no rows exist for that date.
    """
    rows = conn.execute(
        """
        SELECT ticker,
               COALESCE(close, close_price, 0.0) AS close,
               COALESCE(volume, 0)              AS volume,
               COALESCE(turnover, 0.0)           AS turnover,
               COALESCE(change_percent, 0.0)     AS change_pct
        FROM stock_daily_prices
        WHERE price_date = ?
        """,
        (date_str,),
    ).fetchall()
    if not rows:
        return None

    total_turnover = 0.0
    total_volume = 0
    advancing_turnover = 0.0
    declining_turnover = 0.0
    flat_turnover = 0.0
    block_trade_count = 0
    for ticker, close, volume, turnover, change_pct in rows:
        price = _safe_float(close)
        vol = int(volume or 0)
        if turnover and _safe_float(turnover) > 0:
            day_turnover = _safe_float(turnover)
        else:
            day_turnover = price * vol
        if day_turnover <= 0:
            continue
        total_turnover += day_turnover
        total_volume += vol
        pct = _safe_float(change_pct)
        if pct > 0.01:
            advancing_turnover += day_turnover
        elif pct < -0.01:
            declining_turnover += day_turnover
        else:
            flat_turnover += day_turnover
        # Institutional threshold: avg trade value > 1M EGP
        avg_trade_val = (day_turnover / vol) if vol > 0 else 0.0
        if avg_trade_val >= INSTITUTIONAL_TRADE_VALUE or day_turnover >= INSTITUTIONAL_TRADE_VALUE:
            block_trade_count += 1

    if total_turnover <= 0:
        return None

    # Buy/sell split from advancing vs declining turnover. The ratio is
    # smoothed so a flat market doesn't produce a 0% buy side.
    adv_share = advancing_turnover / total_turnover
    dec_share = declining_turnover / total_turnover
    flat_share = flat_turnover / total_turnover
    # Distribute flat turnover evenly (50/50) to buy/sell.
    buy_ratio = adv_share + flat_share * 0.5
    sell_ratio = dec_share + flat_share * 0.5
    # Smooth so we never report extreme 0% / 100% splits (which would be unrealistic).
    buy_ratio = max(0.20, min(0.80, buy_ratio))
    sell_ratio = 1.0 - buy_ratio

    egy_turnover = total_turnover * EGX_RATIO_EGYPTIANS
    arab_turnover = total_turnover * EGX_RATIO_ARABS
    foreign_turnover = total_turnover * EGX_RATIO_FOREIGNERS

    # Approximate number_of_trades from volume (assumed avg trade size = 1000 shares).
    approx_trades = int(total_volume / 1000) if total_volume > 0 else block_trade_count

    return InvestorFlowRow(
        date=date_str,
        session_type="day",
        individuals_buys_value=round(egy_turnover * buy_ratio, 2),
        individuals_sells_value=round(egy_turnover * sell_ratio, 2),
        individuals_net_value=round(egy_turnover * (buy_ratio - sell_ratio), 2),
        arab_buys_value=round(arab_turnover * buy_ratio, 2),
        arab_sells_value=round(arab_turnover * sell_ratio, 2),
        arab_net_value=round(arab_turnover * (buy_ratio - sell_ratio), 2),
        foreign_buys_value=round(foreign_turnover * buy_ratio, 2),
        foreign_sells_value=round(foreign_turnover * sell_ratio, 2),
        foreign_net_value=round(foreign_turnover * (buy_ratio - sell_ratio), 2),
        total_buys_value=round(total_turnover * buy_ratio, 2),
        total_sells_value=round(total_turnover * sell_ratio, 2),
        number_of_trades=approx_trades,
        source="computed_estimate",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline driver
# ─────────────────────────────────────────────────────────────────────────────
def run_pipeline(
    db_path: str = DEFAULT_STOCKS_DB,
    days: int = 1,
    specific_date: Optional[str] = None,
    source_only: bool = False,
) -> List[Dict[str, object]]:
    """
    Run the investor-flow pipeline for `days` most-recent trading days
    (or a single specific date). Returns the rows that were computed
    (and persisted unless source_only=True).
    """
    conn = _connect(db_path)
    ensure_schema(conn)

    # Check whether stock_daily_prices exists. If not, we cannot compute.
    tbl = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices' LIMIT 1"
    ).fetchone()
    if not tbl:
        log.error("stock_daily_prices table not found in %s — cannot compute estimate.", db_path)
        conn.close()
        return []

    if specific_date:
        target_dates = [specific_date]
    else:
        target_dates = _latest_dates(conn, days)

    if not target_dates:
        log.warning("No trading days found in stock_daily_prices.")
        conn.close()
        return []

    results: List[Dict[str, object]] = []
    for d in target_dates:
        # 1) try real scrape first
        row = fetch_egx_real(session_date=d)
        # 2) fallback to computed estimate
        if row is None:
            row = _compute_estimate_for_date(conn, d)
        if row is None:
            log.info("No data for date=%s — skipped.", d)
            continue
        if not source_only:
            upsert_row(conn, row)
            log.info(
                "Upserted investors_data date=%s source=%s egy_net=%.0f arab_net=%.0f foreign_net=%.0f",
                row.date,
                row.source,
                row.individuals_net_value,
                row.arab_net_value,
                row.foreign_net_value,
            )
        results.append(row.to_dict())

    conn.close()
    log.info("Pipeline done. Rows produced: %d", len(results))
    return results


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="EGX Investors Flow scraper — populates investors_data table.",
    )
    p.add_argument("--db", default=DEFAULT_STOCKS_DB, help="Path to stocks.db")
    p.add_argument("--days", type=int, default=1, help="Number of recent trading days (default 1)")
    p.add_argument("--date", dest="specific_date", default=None, help="Specific date YYYY-MM-DD")
    p.add_argument(
        "--source-only",
        action="store_true",
        help="Do not write to DB; print computed rows as JSON to stdout.",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    rows = run_pipeline(
        db_path=args.db,
        days=args.days,
        specific_date=args.specific_date,
        source_only=args.source_only,
    )
    if args.source_only:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
