"""
adapters/unified_price_adapter.py — Unified Historical Price Layer (v0.2.2).

OWNER DIRECTIVE (2026-10-30):
  1. "price_history.db ممنوع" — contains gapfill/autofill (interpolation, not raw)
  2. "تنسى historical_data لأنى هامسحة ده تكار بلا معنى" — will be deleted

  The REMAINING raw data sources (written by data_engine + sync):
    1. data_engine.db.egksco_price_history  ← EGX daily OHLCV + buy/sell (60K rows)
    2. stocks.db.stock_daily_prices          ← daily OHLCV synced from data_engine (93K rows)

  stocks.db is a SYNC COPY of data_engine.db (per sync.py).
  data_engine.db is the CANONICAL SOURCE (per data_layer.py line 8+13).

This module:
  - Reads ONLY from egksco_price_history + stock_daily_prices
  - NO price_history.db (banned — gapfill)
  - NO historical_data (owner will delete it — tukkar bala ma3na)
  - Preserves provenance (which DB + table each bar came from)
  - Filters by (ticker, market) — NEVER ticker alone
  - Detects cross-source conflicts
  - Read-only: mode=ro on all connections
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import List, Dict, Optional, Set
from dataclasses import dataclass, field
from enum import Enum

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = _PROJECT_ROOT / "db"


class PriceSource(str, Enum):
    """Canonical price sources (per owner directive 2026-10-30).
    historical_data REMOVED — owner will delete it.
    price_history.db REMOVED — banned (gapfill).
    """
    DATA_ENGINE_EGKSCO = "data_engine.db.egksco_price_history"  # EGX buy/sell (60K)
    STOCKS_DB_DAILY = "stocks.db.stock_daily_prices"  # SYNCED OHLCV (93K)


@dataclass
class UnifiedOHLCVBar:
    """Normalized OHLCV bar with full provenance."""
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    source_db: str       # "data_engine.db" or "stocks.db"
    source_table: str    # "historical_data" or "egksco_price_history" or "stock_daily_prices"
    market: str
    # EGX-specific (from egksco)
    buy_volume: Optional[float] = None
    sell_volume: Optional[float] = None
    pressure: Optional[str] = None
    # Conflict detection
    has_conflict: bool = False
    conflict_sources: List[str] = field(default_factory=list)

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


def _parse_volume(val) -> float:
    """
    Parse volume value to float.
    Handles: int, float, string with K/M/B suffixes (TradingView format).
    Examples: '1.36M' → 1360000, '65.62K' → 65620, '3B' → 3000000000
    """
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        s = val.strip().replace('\u202f', '').replace(' ', '').replace(',', '')
        if not s:
            return 0.0
        multipliers = {'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12}
        upper = s.upper()
        for suffix, mult in multipliers.items():
            if upper.endswith(suffix):
                try:
                    return float(upper[:-1]) * mult
                except ValueError:
                    return 0.0
        try:
            return float(s)
        except ValueError:
            return 0.0
    return 0.0


class UnifiedPriceAdapter:
    """
    Unified read-only price layer.
    Reads ONLY from data_engine.db + stocks.db (NO price_history.db).

    Sources (per data_engine/data_layer.py):
      data_engine.db = canonical source (written by scrapers via data_layer)
      stocks.db = synced copy (written by sync.py for Next.js frontend)

    Priority:
      1. data_engine.db.egksco_price_history (EGX — has buy/sell pressure)
      2. stocks.db.stock_daily_prices (all markets — synced from data_engine)
    """

    def __init__(self, db_dir: Optional[Path] = None):
        self._db_dir = db_dir or _DB_DIR
        self._connections: Dict[str, sqlite3.Connection] = {}

    def _get_conn(self, db_name: str) -> Optional[sqlite3.Connection]:
        if db_name in self._connections:
            try:
                self._connections[db_name].execute("SELECT 1")
                return self._connections[db_name]
            except sqlite3.ProgrammingError:
                del self._connections[db_name]

        db_path = self._db_dir / db_name
        if not db_path.exists():
            return None
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10.0)
            conn.row_factory = sqlite3.Row
            self._connections[db_name] = conn
            return conn
        except sqlite3.OperationalError:
            return None

    def close_all(self):
        for conn in self._connections.values():
            try: conn.close()
            except: pass
        self._connections.clear()

    # ─── Core: unified history ─────────────────────────────────────────────

    def get_unified_history(
        self,
        ticker: str,
        market: str,
        days: int = 250,
    ) -> List[UnifiedOHLCVBar]:
        """
        Get unified OHLCV from data_engine.db + stocks.db.
        NO price_history.db (per owner directive).
        Filters by (ticker, market) — NEVER ticker alone.
        """
        all_bars: Dict[str, List[UnifiedOHLCVBar]] = {}

        # Source 1: data_engine.db.egksco_price_history (EGX — has buy/sell pressure)
        if market == "EGX":
            bars = self._query_egksco(ticker, market, days)
            if bars:
                all_bars["egksco_price_history"] = bars

        # Source 2: stocks.db.stock_daily_prices (all markets — synced)
        bars = self._query_stock_daily(ticker, market, days)
        if bars:
            all_bars["stock_daily_prices"] = bars

        return self._merge_with_conflict_detection(all_bars, days)

    def _query_egksco(
        self, ticker: str, market: str, days: int
    ) -> List[UnifiedOHLCVBar]:
        """
        Query data_engine.db.egksco_price_history (EGX only).
        Columns: symbol, price_date, open_price, high_price, low_price, close_price,
                 volume, turnover, market, source, buy_volume, sell_volume, pressure
        Written by: egksco_scraper + consolidate_prices scripts
        """
        conn = self._get_conn("data_engine.db")
        if not conn:
            return []

        try:
            cur = conn.cursor()
            # egksco has Arabic market slugs — normalize
            market_variants = [market]
            if market == "EGX":
                market_variants.append("مصر")

            placeholders = ",".join(["?"] * len(market_variants))
            cur.execute(
                f"""SELECT price_date, open_price, high_price, low_price, close_price,
                          volume, market, buy_volume, sell_volume, pressure
                   FROM egksco_price_history
                   WHERE symbol = ? AND market IN ({placeholders})
                   ORDER BY price_date DESC LIMIT ?""",
                (ticker, *market_variants, days)
            )
            rows = cur.fetchall()
            bars = []
            for r in reversed(rows):
                bars.append(UnifiedOHLCVBar(
                    date=r["price_date"],
                    open=r["open_price"] or 0,
                    high=r["high_price"] or 0,
                    low=r["low_price"] or 0,
                    close=r["close_price"] or 0,
                    volume=_parse_volume(r["volume"]),
                    source_db="data_engine.db",
                    source_table="egksco_price_history",
                    market=market,  # normalize
                    buy_volume=_parse_volume(r["buy_volume"]) if r["buy_volume"] else None,
                    sell_volume=_parse_volume(r["sell_volume"]) if r["sell_volume"] else None,
                    pressure=r["pressure"],
                ))
            return bars
        except sqlite3.Error:
            return []

    def _query_stock_daily(
        self, ticker: str, market: str, days: int
    ) -> List[UnifiedOHLCVBar]:
        """
        Query stocks.db.stock_daily_prices.
        Columns: ticker, price_date, open, high, low, close, volume, market
                 (ALSO has open_price, high_price, etc. — but 30% mismatch, use 'open')
        Written by: sync.py (copies from data_engine.db)
        """
        conn = self._get_conn("stocks.db")
        if not conn:
            return []

        try:
            cur = conn.cursor()
            # Use 'open' column (canonical). 'open_price' has 30% mismatch per audit.
            cur.execute(
                """SELECT price_date, open, high, low, close, volume, market
                   FROM stock_daily_prices
                   WHERE ticker = ? AND market = ?
                   ORDER BY price_date DESC LIMIT ?""",
                (ticker, market, days)
            )
            rows = cur.fetchall()
            bars = []
            for r in reversed(rows):
                bars.append(UnifiedOHLCVBar(
                    date=r["price_date"],
                    open=r["open"] or 0,
                    high=r["high"] or 0,
                    low=r["low"] or 0,
                    close=r["close"] or 0,
                    volume=_parse_volume(r["volume"]),
                    source_db="stocks.db",
                    source_table="stock_daily_prices",
                    market=r["market"] or market,
                ))
            return bars
        except sqlite3.Error:
            return []

    # ─── Conflict detection + merge ────────────────────────────────────────

    def _merge_with_conflict_detection(
        self, all_bars: Dict[str, List[UnifiedOHLCVBar]], days: int
    ) -> List[UnifiedOHLCVBar]:
        """
        Merge bars from multiple sources.
        Priority: historical_data > egksco > stock_daily_prices
        """
        by_date: Dict[str, List[UnifiedOHLCVBar]] = {}
        for source_name, bars in all_bars.items():
            for bar in bars:
                if bar.date not in by_date:
                    by_date[bar.date] = []
                by_date[bar.date].append(bar)

        source_priority = {
            "egksco_price_history": 1,  # EGX buy/sell (richest for EGX)
            "stock_daily_prices": 2,    # synced OHLCV (all markets)
        }

        merged: List[UnifiedOHLCVBar] = []
        for date in sorted(by_date.keys())[-days:]:
            bars_on_date = by_date[date]

            if len(bars_on_date) == 1:
                merged.append(bars_on_date[0])
            else:
                # Check for conflicts
                closes = set(round(b.close, 4) for b in bars_on_date)
                has_conflict = len(closes) > 1

                best = min(bars_on_date, key=lambda b: source_priority.get(b.source_table, 99))

                if has_conflict:
                    best.has_conflict = True
                    best.conflict_sources = [b.source_table for b in bars_on_date]

                merged.append(best)

        return merged

    # ─── Coverage analysis ─────────────────────────────────────────────────

    def get_coverage_report(self, market: str) -> Dict:
        """Get coverage report for a market across data_engine + stocks DBs."""
        report = {"market": market, "sources": {}, "symbols": {}}

        # data_engine.db.egksco_price_history (EGX only)
        conn = self._get_conn("data_engine.db")
        if market == "EGX" and conn:
            try:
                cur = conn.cursor()
                market_variants = [market, "مصر"]
                placeholders = ",".join(["?"] * len(market_variants))
                cur.execute(
                    f"""SELECT symbol, COUNT(*), MIN(price_date), MAX(price_date)
                       FROM egksco_price_history WHERE market IN ({placeholders})
                       GROUP BY symbol ORDER BY COUNT(*) DESC""",
                    market_variants
                )
                egk_syms = {}
                for r in cur.fetchall():
                    egk_syms[r[0]] = {"candles": r[1], "min_date": r[2], "max_date": r[3]}
                report["sources"]["data_engine.egksco_price_history"] = {
                    "symbol_count": len(egk_syms),
                    "total_candles": sum(s["candles"] for s in egk_syms.values()),
                }
                for sym, info in egk_syms.items():
                    if sym not in report["symbols"]:
                        report["symbols"][sym] = {}
                    report["symbols"][sym]["egksco"] = info
            except sqlite3.Error:
                pass

        # stocks.db.stock_daily_prices
        conn = self._get_conn("stocks.db")
        if conn:
            try:
                cur = conn.cursor()
                cur.execute(
                    """SELECT ticker, COUNT(*), MIN(price_date), MAX(price_date)
                       FROM stock_daily_prices WHERE market = ?
                       GROUP BY ticker ORDER BY COUNT(*) DESC""",
                    (market,)
                )
                sd_syms = {}
                for r in cur.fetchall():
                    sd_syms[r[0]] = {"candles": r[1], "min_date": r[2], "max_date": r[3]}
                report["sources"]["stocks.stock_daily_prices"] = {
                    "symbol_count": len(sd_syms),
                    "total_candles": sum(s["candles"] for s in sd_syms.values()),
                }
                for sym, info in sd_syms.items():
                    if sym not in report["symbols"]:
                        report["symbols"][sym] = {}
                    report["symbols"][sym]["stock_daily_prices"] = info
            except sqlite3.Error:
                pass

        # Calculate best source per symbol
        for sym, sources in report["symbols"].items():
            valid_sources = {k: v for k, v in sources.items() if isinstance(v, dict) and "candles" in v}
            if valid_sources:
                best = max(valid_sources.items(), key=lambda x: x[1]["candles"])
                sources["_best_source"] = best[0]
                sources["_max_candles"] = best[1]["candles"]
                sources["_date_range"] = (best[1]["min_date"], best[1]["max_date"])

        return report

    # ─── Provenance audit ──────────────────────────────────────────────────

    def get_provenance_report(self, ticker: str, market: str) -> Dict:
        """Get detailed provenance for a single symbol."""
        bars = self.get_unified_history(ticker, market, days=500)
        if not bars:
            return {"ticker": ticker, "market": market, "total_bars": 0}

        by_source: Dict[str, int] = {}
        conflicts = 0
        for bar in bars:
            src = bar.source_table
            by_source[src] = by_source.get(src, 0) + 1
            if bar.has_conflict:
                conflicts += 1

        return {
            "ticker": ticker,
            "market": market,
            "total_bars": len(bars),
            "date_range": (bars[0].date, bars[-1].date),
            "by_source": by_source,
            "conflicts": conflicts,
            "conflict_pct": round(conflicts / len(bars) * 100, 2) if bars else 0,
        }
