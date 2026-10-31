"""
data/fundamental_archive.py — Historical Fundamental Snapshot Archive (Phase E).

OWNER DIRECTIVE (Section E):
  "Design a time-aware feature layer that can learn from changes in
   company fundamentals."

  "Only implement features supported by actual historical data and
   valid publication timestamps."

ARCHITECTURE:
  stocks.db.stocks is a SNAPSHOT (current values only).
  This module builds a HISTORICAL ARCHIVE by taking daily snapshots.

  Every day, the Learning Engine (NOT V3, NOT data_engine) takes a
  read-only snapshot of the 50 mapped TV fields from stocks.db.stocks
  and stores them in learning.db.fundamental_snapshots with:
    - snapshot_date (when the snapshot was taken)
    - ticker + market
    - All 50 TV field values
    - source = 'stocks.db.stocks'

  After 3-6 months of daily snapshots, this becomes a usable
  point-in-time fundamental dataset for historical training.

CRITICAL:
  - This module READS from stocks.db (read-only)
  - This module WRITES to learning.db ONLY (isolated)
  - It does NOT modify stocks.db or data_engine.db
  - It does NOT affect V3 or production

Usage:
  from learning_engine.data.fundamental_archive import FundamentalArchive
  archive = FundamentalArchive()
  archive.take_daily_snapshot()  # call from cron daily
  archive.get_snapshot_at_date("COMI", "EGX", "2026-10-15")  # PIT lookup
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..config.settings import LearningSettings
from ..features.tv_field_mapping import TVFieldMapper, TVFieldMapping, TVDataGroup, PITStatus


# Fields to archive (from TV field mapping — only snapshot_only fields)
# Exclude static fields (ticker, market) — they don't change
ARCHIVED_FIELDS = [
    # Valuation
    "pe_ratio", "pb_ratio", "ps_ratio", "eps", "eps_diluted",
    "enterprise_value", "ev_to_revenue", "market_cap",
    # Profitability
    "roe", "roa", "roic", "gross_margin", "operating_margin",
    "profit_margin", "dividend_yield", "dps_ttm",
    # Balance Sheet
    "total_assets", "total_current_assets", "total_debt", "shares_outstanding",
    # Income Statement
    "total_revenue", "gross_profit", "net_income",
    # Cash Flow
    "free_cash_flow",
    # Technicals (TV snapshot — for comparison with Unified Library)
    "rsi", "macd", "macd_signal", "atr", "sma20", "sma50", "sma200",
    "recommend_all", "recommend_ma", "recommend_other",
    # Liquidity
    "turnover_egp", "value_traded", "relative_volume_10d",
    # Performance
    "change_percent", "high_52w", "low_52w",
    # V3 score
    "fundamental_score",
    # Categories
    "sector", "industry", "trend",
]


@dataclass
class FundamentalSnapshot:
    """A single point-in-time fundamental snapshot."""
    snapshot_date: str  # YYYY-MM-DD
    ticker: str
    market: str
    fields: Dict[str, any]  # field_name → value
    source: str = "stocks.db.stocks"


class FundamentalArchive:
    """
    Builds + queries historical fundamental snapshots.
    Writes to learning.db ONLY (isolated from production).
    """

    def __init__(self, settings: Optional[LearningSettings] = None):
        self._settings = settings or LearningSettings()
        self._learning_db = self._settings.learning_db
        self._stocks_db = self._settings.stocks_db
        self._init_db()

    def _init_db(self):
        """Initialize learning.db with fundamental_snapshots table."""
        self._learning_db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._learning_db))
        cur = conn.cursor()

        # Build CREATE TABLE with all archived fields
        field_defs = []
        for f in ARCHIVED_FIELDS:
            if f in ("sector", "industry", "trend"):
                field_defs.append(f'"{f}" TEXT')
            else:
                field_defs.append(f'"{f}" REAL')

        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS fundamental_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_date TEXT NOT NULL,
                ticker TEXT NOT NULL,
                market TEXT NOT NULL,
                {', '.join(field_defs)},
                source TEXT DEFAULT 'stocks.db.stocks',
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(snapshot_date, ticker, market)
            )
        """)

        # Index for PIT lookups
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_fund_snap_pit
            ON fundamental_snapshots(ticker, market, snapshot_date DESC)
        """)

        conn.commit()
        conn.close()

    def take_daily_snapshot(self) -> int:
        """
        Take a daily snapshot of all stocks from stocks.db.stocks.
        Reads stocks.db (read-only). Writes to learning.db ONLY.

        Returns: number of snapshots taken.
        """
        if not self._stocks_db.exists():
            return 0

        today = datetime.utcnow().strftime("%Y-%m-%d")

        # Read from stocks.db (read-only)
        read_conn = sqlite3.connect(f"file:{self._stocks_db}?mode=ro", uri=True)
        read_conn.row_factory = sqlite3.Row
        read_cur = read_conn.cursor()

        # Select all archived fields + ticker + market
        cols_str = ", ".join([f'"{f}"' for f in ARCHIVED_FIELDS])
        read_cur.execute(f"""
            SELECT ticker, market, {cols_str}
            FROM stocks
            WHERE ticker IS NOT NULL AND market IS NOT NULL
        """)
        rows = read_cur.fetchall()
        read_conn.close()

        if not rows:
            return 0

        # Write to learning.db (isolated)
        write_conn = sqlite3.connect(str(self._learning_db))
        write_cur = write_conn.cursor()

        count = 0
        for row in rows:
            try:
                values = [today, row["ticker"], row["market"]]
                for f in ARCHIVED_FIELDS:
                    values.append(row[f])

                placeholders = ", ".join(["?"] * (3 + len(ARCHIVED_FIELDS)))
                cols = ", ".join(["snapshot_date", "ticker", "market"] + [f'"{f}"' for f in ARCHIVED_FIELDS])

                write_cur.execute(
                    f"""INSERT OR REPLACE INTO fundamental_snapshots
                        ({cols}) VALUES ({placeholders})""",
                    values
                )
                count += 1
            except (sqlite3.Error, KeyError):
                continue

        write_conn.commit()
        write_conn.close()
        return count

    def get_snapshot_at_date(
        self, ticker: str, market: str, target_date: str
    ) -> Optional[FundamentalSnapshot]:
        """
        Point-in-Time lookup: get the most recent snapshot AT or BEFORE target_date.
        This is the PIT-correct way to use fundamentals.
        """
        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cols_str = ", ".join([f'"{f}"' for f in ARCHIVED_FIELDS])
        cur.execute(f"""
            SELECT snapshot_date, ticker, market, {cols_str}, source
            FROM fundamental_snapshots
            WHERE ticker = ? AND market = ? AND snapshot_date <= ?
            ORDER BY snapshot_date DESC LIMIT 1
        """, (ticker, market, target_date[:10]))

        row = cur.fetchone()
        conn.close()

        if not row:
            return None

        fields = {f: row[f] for f in ARCHIVED_FIELDS}
        return FundamentalSnapshot(
            snapshot_date=row["snapshot_date"],
            ticker=row["ticker"],
            market=row["market"],
            fields=fields,
            source=row["source"] or "stocks.db.stocks",
        )

    def get_archive_stats(self) -> Dict:
        """Get archive statistics."""
        if not self._learning_db.exists():
            return {"total_snapshots": 0, "date_range": None}

        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM fundamental_snapshots")
        total = cur.fetchone()[0]

        cur.execute("SELECT MIN(snapshot_date), MAX(snapshot_date) FROM fundamental_snapshots")
        r = cur.fetchone()
        date_range = (r[0], r[1]) if r and r[0] else None

        cur.execute("SELECT COUNT(DISTINCT ticker) FROM fundamental_snapshots")
        unique_tickers = cur.fetchone()[0]

        cur.execute("SELECT COUNT(DISTINCT snapshot_date) FROM fundamental_snapshots")
        unique_dates = cur.fetchone()[0]

        conn.close()
        return {
            "total_snapshots": total,
            "unique_tickers": unique_tickers,
            "unique_dates": unique_dates,
            "date_range": date_range,
            "fields_archived": len(ARCHIVED_FIELDS),
        }

    def get_coverage_at_date(self, target_date: str, market: Optional[str] = None) -> Dict:
        """Get coverage report for a specific date."""
        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        cur = conn.cursor()

        if market:
            cur.execute("""
                SELECT COUNT(*), COUNT(DISTINCT ticker)
                FROM fundamental_snapshots
                WHERE snapshot_date <= ? AND market = ?
            """, (target_date[:10], market))
        else:
            cur.execute("""
                SELECT COUNT(*), COUNT(DISTINCT ticker)
                FROM fundamental_snapshots
                WHERE snapshot_date <= ?
            """, (target_date[:10],))

        r = cur.fetchone()
        conn.close()
        return {
            "target_date": target_date[:10],
            "market": market or "all",
            "total_snapshots": r[0],
            "unique_tickers": r[1],
        }
