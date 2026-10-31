"""
adapters/readonly_data_adapter.py — True Read-Only Data Access (v0.1.2).

CRITICAL (Section B of directive):
  The current data_engine.data_layer opens a WRITABLE SQLite connection
  (WAL mode). "Learning Engine reads only" is NOT guaranteed just because
  the adapter doesn't execute writes.

  This module provides a TRUE read-only boundary:
    - SQLite URI mode=ro (cannot write even if code tries)
    - Separate from data_layer (which remains writable for production)
    - Graceful handling of locked/unavailable DBs
    - No schema changes to production DBs

  This adapter DOES NOT use data_engine.data_layer.
  It opens its own read-only connections directly.

Usage:
  from learning_engine.adapters.readonly_data_adapter import ReadOnlyDataAdapter
  adapter = ReadOnlyDataAdapter()
  bars = adapter.get_history_bars("COMI", days=250, market="EGX")
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import threading

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = _PROJECT_ROOT / "db"


@dataclass
class OHLCVBar:
    """Single OHLCV bar (daily)."""
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: float
    source: str = ""

    @property
    def is_ohlc_valid(self) -> bool:
        return (
            self.high >= max(self.open, self.close) and
            self.low <= min(self.open, self.close) and
            self.high >= self.low
        )

    @property
    def is_flat(self) -> bool:
        return self.open == self.high == self.low == self.close


class ReadOnlyDataAdapter:
    """
    TRUE read-only adapter for production data.
    Opens SQLite connections with mode=ro (read-only URI).
    CANNOT write even if code tries (SQLite enforces this).

    Sources (all read-only):
      - data_engine.db: historical_data + egksco_price_history + stocks + tab_*
      - stocks.db: stocks (97 cols) + stock_daily_prices + market_regime_log + indices
      - price_history.db: price_history (1.4M candles)
      - predictions.db: predictions + historical_trades + learned_lessons

    Does NOT use data_engine.data_layer (which opens writable WAL connection).
    """

    def __init__(self, db_dir: Optional[Path] = None):
        self._db_dir = db_dir or _DB_DIR
        self._connections: Dict[str, sqlite3.Connection] = {}
        self._lock = threading.Lock()

    def _get_connection(self, db_name: str) -> Optional[sqlite3.Connection]:
        """
        Get or create a read-only connection to a database.
        Uses mode=ro — SQLite ENFORCES read-only at the VFS level.
        """
        with self._lock:
            if db_name in self._connections:
                try:
                    # Test connection is still alive
                    self._connections[db_name].execute("SELECT 1")
                    return self._connections[db_name]
                except sqlite3.ProgrammingError:
                    # Connection closed — recreate
                    del self._connections[db_name]

            db_path = self._db_dir / db_name
            if not db_path.exists():
                return None

            try:
                # mode=ro = READ ONLY. immutable=1 would be even stricter
                # but prevents WAL readers from seeing writes.
                # mode=ro allows reading while production writes.
                uri = f"file:{db_path}?mode=ro"
                conn = sqlite3.connect(uri, uri=True, timeout=10.0)
                conn.row_factory = sqlite3.Row
                self._connections[db_name] = conn
                return conn
            except sqlite3.OperationalError:
                return None

    def close_all(self):
        """Close all connections."""
        with self._lock:
            for conn in self._connections.values():
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()

    # ─── Market data (prices) ──────────────────────────────────────────────

    def get_history_bars(
        self,
        ticker: str,
        days: int = 250,
        market: Optional[str] = None,
        source_db: str = "price_history.db",
    ) -> List[OHLCVBar]:
        """
        Get historical OHLCV bars. Read-only.
        Default source: price_history.db (1.4M candles, richest).
        Alternative: data_engine.db.historical_data
        """
        conn = self._get_connection(source_db)
        if not conn:
            return []

        try:
            if source_db == "price_history.db":
                cur = conn.cursor()
                cur.execute(
                    """SELECT date, open_price, high_price, low_price, close_price,
                              volume, source
                       FROM price_history
                       WHERE ticker = ? AND market = ?
                       ORDER BY date DESC LIMIT ?""",
                    (ticker, market or "", days)
                )
                rows = cur.fetchall()
                bars = []
                for r in reversed(rows):  # oldest → newest
                    bars.append(OHLCVBar(
                        date=r["date"],
                        open=r["open_price"] or 0,
                        high=r["high_price"] or 0,
                        low=r["low_price"] or 0,
                        close=r["close_price"] or 0,
                        volume=r["volume"] or 0,
                        source=r["source"] or "",
                    ))
                return bars

            elif source_db == "data_engine.db":
                cur = conn.cursor()
                cur.execute(
                    """SELECT date, open, high, low, close, volume
                       FROM historical_data
                       WHERE symbol = ?
                       ORDER BY date DESC LIMIT ?""",
                    (ticker, days)
                )
                rows = cur.fetchall()
                bars = []
                for r in reversed(rows):
                    bars.append(OHLCVBar(
                        date=r["date"],
                        open=r["open"] or 0,
                        high=r["high"] or 0,
                        low=r["low"] or 0,
                        close=r["close"] or 0,
                        volume=r["volume"] or 0,
                        source="historical_data",
                    ))
                return bars
        except sqlite3.Error:
            return []
        return []

    def get_stocks_snapshot(self, market: Optional[str] = None) -> List[Dict]:
        """
        Get current stocks snapshot from stocks.db.stocks (97 columns).
        Read-only. Returns dict per stock.
        """
        conn = self._get_connection("stocks.db")
        if not conn:
            return []

        try:
            cur = conn.cursor()
            # Normalize market slug
            if market:
                # Handle polluted slugs (america/US, ksa/TADAWUL, etc.)
                market_variants = [market]
                if market == "US":
                    market_variants.append("america")
                elif market == "TADAWUL":
                    market_variants.append("ksa")
                elif market == "KSE":
                    market_variants.append("kuwait")
                elif market == "america":
                    market_variants.append("US")
                elif market == "ksa":
                    market_variants.append("TADAWUL")
                elif market == "kuwait":
                    market_variants.append("KSE")

                placeholders = ",".join(["?"] * len(market_variants))
                cur.execute(
                    f"""SELECT * FROM stocks WHERE market IN ({placeholders})
                        ORDER BY ticker""",
                    market_variants
                )
            else:
                cur.execute("SELECT * FROM stocks ORDER BY ticker")

            rows = cur.fetchall()
            return [dict(r) for r in rows]
        except sqlite3.Error:
            return []

    def get_stock_by_ticker(self, ticker: str) -> Optional[Dict]:
        """Get single stock snapshot from stocks.db.stocks."""
        conn = self._get_connection("stocks.db")
        if not conn:
            return None
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
            row = cur.fetchone()
            return dict(row) if row else None
        except sqlite3.Error:
            return None

    # ─── Market regime (historical) ────────────────────────────────────────

    def get_regime_at_date(self, market: str, prediction_date: str) -> Optional[str]:
        """
        Get HISTORICAL market regime at a specific date.
        Source: stocks.db.market_regime_log (63 rows, EGX only).
        Read-only.

        Returns: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | None
        """
        conn = self._get_connection("stocks.db")
        if not conn:
            return None
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT regime FROM market_regime_log
                   WHERE market = ? AND date <= ?
                   ORDER BY date DESC LIMIT 1""",
                (market, prediction_date[:10])
            )
            row = cur.fetchone()
            return row["regime"] if row else None
        except sqlite3.Error:
            return None

    def get_regime_history(self, market: str, days: int = 90) -> List[Dict]:
        """Get regime history for a market."""
        conn = self._get_connection("stocks.db")
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT date, regime, confidence, computed_at, market
                   FROM market_regime_log
                   WHERE market = ?
                   ORDER BY date DESC LIMIT ?""",
                (market, days)
            )
            return [dict(r) for r in cur.fetchall()]
        except sqlite3.Error:
            return []

    # ─── Index data ────────────────────────────────────────────────────────

    def get_index_history(self, symbol: str, days: int = 250) -> List[OHLCVBar]:
        """Get index OHLCV history. Source: stocks.db.index_daily_prices."""
        conn = self._get_connection("stocks.db")
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT price_date, open, high, low, close, volume
                   FROM index_daily_prices
                   WHERE symbol = ?
                   ORDER BY price_date DESC LIMIT ?""",
                (symbol, days)
            )
            rows = cur.fetchall()
            bars = []
            for r in reversed(rows):
                bars.append(OHLCVBar(
                    date=r["price_date"],
                    open=r["open"] or 0,
                    high=r["high"] or 0,
                    low=r["low"] or 0,
                    close=r["close"] or 0,
                    volume=r["volume"] or 0,
                    source="index_daily_prices",
                ))
            return bars
        except sqlite3.Error:
            return []

    # ─── Predictions (read-only) ───────────────────────────────────────────

    def get_predictions_stats(self) -> Dict:
        """Get predictions summary stats."""
        conn = self._get_connection("predictions.db")
        if not conn:
            return {}
        try:
            cur = conn.cursor()
            stats = {}
            cur.execute("SELECT COUNT(*) as cnt FROM predictions")
            stats["total"] = cur.fetchone()["cnt"]
            cur.execute("SELECT COUNT(*) as cnt FROM predictions WHERE outcome_date IS NOT NULL")
            stats["resolved"] = cur.fetchone()["cnt"]
            cur.execute("SELECT MIN(prediction_date) as mn, MAX(prediction_date) as mx FROM predictions")
            r = cur.fetchone()
            stats["date_range"] = (r["mn"], r["mx"])
            return stats
        except sqlite3.Error:
            return {}

    # ─── Data freshness monitoring ─────────────────────────────────────────

    def get_data_freshness(self) -> Dict:
        """
        Get data freshness report for all sources.
        Used by the monitoring service (Phase C).
        """
        report = {}

        # price_history.db
        conn = self._get_connection("price_history.db")
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT MAX(date) as latest FROM price_history")
                r = cur.fetchone()
                report["price_history"] = {"latest_date": r["latest"] if r else None}
            except sqlite3.Error:
                report["price_history"] = {"error": "cannot read"}

        # data_engine.db.historical_data
        conn = self._get_connection("data_engine.db")
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT MAX(date) as latest, MAX(last_fetch) as fetch FROM historical_data")
                r = cur.fetchone()
                report["historical_data"] = {
                    "latest_date": r["latest"] if r else None,
                    "last_fetch": r["fetch"] if r else None,
                }
            except sqlite3.Error:
                report["historical_data"] = {"error": "cannot read"}

        # stocks.db.stocks
        conn = self._get_connection("stocks.db")
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT MAX(last_update) as latest FROM stocks")
                r = cur.fetchone()
                report["stocks_snapshot"] = {"last_update": r["latest"] if r else None}

                cur.execute("SELECT MAX(date) as latest FROM market_regime_log")
                r = cur.fetchone()
                report["market_regime"] = {"latest_date": r["latest"] if r else None}
            except sqlite3.Error:
                report["stocks_snapshot"] = {"error": "cannot read"}

        # predictions.db
        conn = self._get_connection("predictions.db")
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT MAX(prediction_date) as latest FROM predictions")
                r = cur.fetchone()
                report["predictions"] = {"latest_date": r["latest"] if r else None}
            except sqlite3.Error:
                report["predictions"] = {"error": "cannot read"}

        return report

    # ─── Data quality checks (for monitoring) ──────────────────────────────

    def get_quality_summary(self, market: Optional[str] = None) -> Dict:
        """
        Quick data quality summary for monitoring.
        """
        conn = self._get_connection("price_history.db")
        if not conn:
            return {"error": "price_history.db unavailable"}

        try:
            cur = conn.cursor()
            if market:
                cur.execute(
                    """SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN high_price = low_price AND open_price = close_price THEN 1 ELSE 0 END) as flat,
                        SUM(CASE WHEN volume = 0 THEN 1 ELSE 0 END) as zero_vol,
                        COUNT(DISTINCT ticker) as tickers
                       FROM price_history WHERE market = ?""",
                    (market,)
                )
            else:
                cur.execute(
                    """SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN high_price = low_price AND open_price = close_price THEN 1 ELSE 0 END) as flat,
                        SUM(CASE WHEN volume = 0 THEN 1 ELSE 0 END) as zero_vol,
                        COUNT(DISTINCT ticker) as tickers
                       FROM price_history"""
                )
            r = cur.fetchone()
            total = r["total"]
            return {
                "market": market or "all",
                "total_candles": total,
                "tickers": r["tickers"],
                "flat_candles": r["flat"],
                "flat_pct": round(r["flat"] / total * 100, 2) if total else 0,
                "zero_vol_candles": r["zero_vol"],
                "zero_vol_pct": round(r["zero_vol"] / total * 100, 2) if total else 0,
            }
        except sqlite3.Error as e:
            return {"error": str(e)}

    # ─── Fundamental coverage (for monitoring) ─────────────────────────────

    def get_fundamental_coverage(self) -> Dict:
        """
        Check fundamental data coverage in stocks.db.stocks (97 columns).
        How many stocks have non-null values for key fundamentals.
        """
        conn = self._get_connection("stocks.db")
        if not conn:
            return {"error": "stocks.db unavailable"}

        try:
            cur = conn.cursor()
            fundamental_cols = [
                "pe_ratio", "pb_ratio", "roe", "roa", "roic",
                "gross_margin", "operating_margin", "profit_margin",
                "total_assets", "total_revenue", "net_income",
                "debt_to_equity", "current_ratio", "dividend_yield",
                "eps", "eps_diluted", "market_cap", "enterprise_value",
                "free_cash_flow", "beta", "recommend_all",
            ]

            coverage = {}
            for col in fundamental_cols:
                try:
                    cur.execute(f"SELECT COUNT(*) as cnt FROM stocks WHERE {col} IS NOT NULL AND {col} != 0")
                    coverage[col] = cur.fetchone()["cnt"]
                except sqlite3.Error:
                    coverage[col] = 0

            cur.execute("SELECT COUNT(*) as total FROM stocks")
            total = cur.fetchone()["total"]

            return {
                "total_stocks": total,
                "fundamental_coverage": coverage,
                "coverage_pct": {
                    col: round(cnt / total * 100, 1) if total else 0
                    for col, cnt in coverage.items()
                },
            }
        except sqlite3.Error as e:
            return {"error": str(e)}
