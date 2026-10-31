"""
adapters/market_data_adapter.py — Read-only bridge to production price data.

Uses data_engine/data_layer.py as SSOT (per Rule 10 — SINGLE-PRICE-SOURCE).
NEVER opens .db files directly. NEVER modifies production data.

Sources (read-only):
  - data_engine.db.historical_data (197K rows) — via data_layer.get_history_lists()
  - data_engine.db.egksco_price_history (60K rows, EGX only) — buy/sell pressure
  - stocks.db.stock_daily_prices (93K rows) — via db_manager (fallback)
  - data_engine.db.stocks (1,098 rows) — snapshots + market_cap
"""
from __future__ import annotations
import sys
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_VPS_PATH = _PROJECT_ROOT / "vps-service"
_DATA_ENGINE_PATH = _PROJECT_ROOT / "data_engine"
for p in [_VPS_PATH, _DATA_ENGINE_PATH]:
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

# Import from data_engine.data_layer (SSOT for price data — BRAVO-DATA-LAYER)
from data_engine.data_layer import data as _data_layer, normalize_market  # noqa: E402


@dataclass
class OHLCVBar:
    """Single OHLCV bar (daily)."""
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: float

    def __post_init__(self):
        # Validate OHLC consistency at read time (data quality flag, not rejection)
        self._ohlc_valid = (
            self.high >= max(self.open, self.close) and
            self.low <= min(self.open, self.close) and
            self.high >= self.low
        )

    @property
    def is_ohlc_valid(self) -> bool:
        return self._ohlc_valid

    @property
    def is_flat(self) -> bool:
        return self.open == self.high == self.low == self.close


class MarketDataAdapter:
    """
    Read-only adapter for production price data.
    All reads go through data_engine.data_layer (SSOT).
    """

    def __init__(self):
        self._data = _data_layer

    # ─── Symbol discovery ──────────────────────────────────────────────────

    def get_symbols_for_market(self, market: str) -> List[str]:
        """Get all tickers for a market. Uses data_layer.get_market_stocks()."""
        canonical = normalize_market(market)
        if not canonical:
            return []
        return self._data.get_market_stocks(canonical)

    def get_market_snapshots(self, market: str) -> List[Dict]:
        """Get current snapshots for all stocks in market."""
        canonical = normalize_market(market)
        if not canonical:
            return []
        return self._data.get_market_snapshots(canonical)

    # ─── Historical OHLCV ──────────────────────────────────────────────────

    def get_history_lists(
        self,
        ticker: str,
        days: int = 250,
        market: Optional[str] = None,
    ) -> Tuple[List[float], List[float], List[float], List[float], List[float]]:
        """
        Get historical OHLCV as separate lists (oldest → newest).

        Returns: (closes, volumes, highs, lows, opens)

        Source: data_layer.get_history_lists() — merges 3 sources:
          1. historical_data (data_engine.db)
          2. egksco_price_history (data_engine.db, EGX only)
          3. stocks table (data_engine.db, snapshot)
        """
        canonical = normalize_market(market) if market else None
        return self._data.get_history_lists(ticker, days=days, market=canonical)

    def get_history_bars(
        self,
        ticker: str,
        days: int = 250,
        market: Optional[str] = None,
    ) -> List[OHLCVBar]:
        """
        Get historical OHLCV as list of OHLCVBar objects.
        For features that need date information.
        """
        # We need dates too — use get_history() (returns list of dicts)
        canonical = normalize_market(market) if market else None
        hist = self._data.get_history(ticker, days=days, market=canonical)
        bars = []
        for h in hist:
            try:
                bar = OHLCVBar(
                    date=h.get("date", ""),
                    open=float(h.get("open", 0) or h.get("open_price", 0) or 0),
                    high=float(h.get("high", 0) or h.get("high_price", 0) or 0),
                    low=float(h.get("low", 0) or h.get("low_price", 0) or 0),
                    close=float(h.get("close", 0) or h.get("close_price", 0) or 0),
                    volume=float(h.get("volume", 0) or 0),
                )
                bars.append(bar)
            except (ValueError, TypeError):
                continue
        return bars

    # ─── Snapshot data ─────────────────────────────────────────────────────

    def get_snapshot(self, ticker: str) -> Optional[Dict]:
        """Get current snapshot (price, market_cap, etc.). Source: data_layer.get_snapshot()."""
        return self._data.get_snapshot(ticker)

    def get_market_cap(self, ticker: str) -> Optional[float]:
        """Get market cap for ticker. Source: data_layer.get_market_cap()."""
        return self._data.get_market_cap(ticker)

    # ─── Index data (for market features) ──────────────────────────────────

    def get_index_history(self, symbol: str, days: int = 250) -> List[OHLCVBar]:
        """
        Get index history (EGX30, TADAWUL, etc.).
        Source: stocks.db.index_daily_prices (read-only via sqlite3).

        NOTE: This is the ONLY direct sqlite3 read in the adapter.
        It's for index data which is NOT in data_engine.db.
        """
        import sqlite3
        stocks_db = _PROJECT_ROOT / "db" / "stocks.db"
        if not stocks_db.exists():
            return []
        try:
            conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute(
                """SELECT price_date, open, high, low, close, volume
                   FROM index_daily_prices
                   WHERE symbol = ?
                   ORDER BY price_date DESC LIMIT ?""",
                (symbol, days)
            )
            rows = cur.fetchall()
            conn.close()
            bars = []
            for r in reversed(rows):  # oldest → newest
                bars.append(OHLCVBar(
                    date=r[0], open=r[1] or 0, high=r[2] or 0,
                    low=r[3] or 0, close=r[4] or 0, volume=r[5] or 0
                ))
            return bars
        except Exception:
            return []

    # ─── Market normalization ──────────────────────────────────────────────

    @staticmethod
    def normalize_market(market: str) -> Optional[str]:
        """Canonicalize market slug. Source: data_layer.normalize_market()."""
        return normalize_market(market)
