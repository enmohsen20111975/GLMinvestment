"""
market_regime_engine.py — Dynamic Market Regime Detection
============================================================
REGIME-ENGINE (2026-09-27)

Reads 6 market indicators and outputs DEFENSIVE / NORMAL / AGGRESSIVE.
The regime is stored in `system_settings` (key `current_regime_<MARKET>`)
and is appended to `market_regime_log` for audit history.

The regime is read by:
  - daily_predictor.py         (override MIN_RR, MIN_SCORE, MAX_PICKS, ...)
  - liquidity_filter.py              (raise/lower MIN_TURNOVER)
  - position_sizing.py               (scale position_size_multiplier)
  - /api/market/regime (Next.js)     (display only)

Hysteresis: regime requires 2-3 consecutive days of sustained conditions
before switching. Prevents regime flip-flop on every candle.

Multi-market support: EGX, TADAWUL, KSE, QSE, CRYPTO, GOLD.
Each market has its own index ticker + indicator source.

Author: Quantitative Engineer + Architect (REGIME-ENGINE agent)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = PROJECT_ROOT / 'db'

# Reuse the canonical DB paths (constitution §PHASE-4-DB-REORG)
STOCKS_DB = str(_DB_DIR / 'stocks.db')
DATA_ENGINE_DB = str(_DB_DIR / 'data_engine.db')
PRICE_HISTORY_DB = str(_DB_DIR / 'price_history.db')
PREDICTIONS_DB = str(_DB_DIR / 'predictions.db')

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Regime Enum (output contract)
# ──────────────────────────────────────────────────────────────────────────
class Regime(str, Enum):
    """3 regimes — DEFENSIVE / NORMAL / AGGRESSIVE.

    Stored as the string value (e.g. "DEFENSIVE") in DB + JSON API.
    """
    DEFENSIVE = "DEFENSIVE"   # Risk-Off — cash-mode, half size, very selective
    NORMAL = "NORMAL"         # Default V40.2 behavior
    AGGRESSIVE = "AGGRESSIVE" # Trend-riding mode — wider stops, more picks


# ──────────────────────────────────────────────────────────────────────────
# Per-market configuration
# ──────────────────────────────────────────────────────────────────────────
# Each market gets:
#   - index_ticker: the main benchmark ticker used for SMA/ATR/drawdown.
#                   If `index_source = 'basket'`, we synthesize an index from
#                   the top-N liquid stocks (used when no real index ticker
#                   is available in the price DB).
#   - price_db / price_table: where OHLCV rows live.
#   - stocks_db / stocks_table: the universe for breadth + basket.
#   - market_code: passed to get_tickers() (PHASE-A multi-market)
#
# Column names are explicit so we can swap DBs without touching logic.

MARKET_CONFIG: Dict[str, Dict[str, Any]] = {
    "EGX": {
        "index_ticker": "EGX30",
        "index_source": "auto",       # 'auto' = try real index, fallback to basket
        "price_db": DATA_ENGINE_DB,
        "price_table": "egksco_price_history",
        "ticker_col": "symbol",
        "date_col": "price_date",
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "turnover",
        "stocks_db": STOCKS_DB,
        "stocks_table": "stocks",
        "stocks_market_col": "market",
        "stocks_market_val": "EGX",
        "stocks_active_col": "is_active",
        "market_code": "EGX",
        "top_n_basket": 20,           # for basket fallback + breadth sample
    },
    "TADAWUL": {
        "index_ticker": "TASI",
        "index_source": "basket",     # TASI ticker usually absent — synthesize from top stocks
        "price_db": STOCKS_DB,
        "price_table": "stock_daily_prices",
        "ticker_col": "ticker",
        "date_col": "price_date",
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "turnover",
        "stocks_db": STOCKS_DB,
        "stocks_table": "stocks",
        "stocks_market_col": "market",
        "stocks_market_val": "TADAWUL",
        "stocks_active_col": "is_active",
        "market_code": "KSA",
        "top_n_basket": 20,
    },
    "KSE": {
        "index_ticker": "KSE100",
        "index_source": "basket",
        "price_db": STOCKS_DB,
        "price_table": "stock_daily_prices",
        "ticker_col": "ticker",
        "date_col": "price_date",
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "turnover",
        "stocks_db": STOCKS_DB,
        "stocks_table": "stocks",
        "stocks_market_col": "market",
        "stocks_market_val": "KSE",
        "stocks_active_col": "is_active",
        "market_code": "KSE",
        "top_n_basket": 15,
    },
    "QSE": {
        "index_ticker": "QEIndex",
        "index_source": "basket",
        "price_db": STOCKS_DB,
        "price_table": "stock_daily_prices",
        "ticker_col": "ticker",
        "date_col": "price_date",
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "turnover",
        "stocks_db": STOCKS_DB,
        "stocks_table": "stocks",
        "stocks_market_col": "market",
        "stocks_market_val": "QSE",
        "stocks_active_col": "is_active",
        "market_code": "QSE",
        "top_n_basket": 15,
    },
    "CRYPTO": {
        "index_ticker": "BTC",
        "index_source": "ticker",     # BTC is directly in crypto_prices
        "price_db": DATA_ENGINE_DB,
        "price_table": "crypto_prices",
        "ticker_col": "symbol",
        "date_col": "timestamp",       # crypto_prices uses timestamp (ISO date)
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "quote_volume",
        "stocks_db": DATA_ENGINE_DB,
        "stocks_table": "crypto_prices",   # same table — different "universe"
        "stocks_market_col": None,
        "stocks_market_val": None,
        "stocks_active_col": None,
        "market_code": "CRYPTO",
        "top_n_basket": 10,
        "date_format": "date",            # crypto_prices.timestamp is full ISO; we truncate to date
    },
    "GOLD": {
        "index_ticker": "XAUUSD",
        "index_source": "ticker",
        "price_db": DATA_ENGINE_DB,
        "price_table": "gold_prices",
        "ticker_col": "symbol",
        "date_col": "price_date",
        "open_col": "open_price",
        "high_col": "high_price",
        "low_col": "low_price",
        "close_col": "close_price",
        "volume_col": "volume",
        "turnover_col": "turnover",
        "stocks_db": DATA_ENGINE_DB,
        "stocks_table": "gold_prices",
        "stocks_market_col": None,
        "stocks_market_val": None,
        "stocks_active_col": None,
        "market_code": "GOLD",
        "top_n_basket": 1,             # gold is a single instrument
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Regime thresholds (the dynamic override applied to V40.2)
# ──────────────────────────────────────────────────────────────────────────
# These keys are read by daily_predictor.py at the start of run_generator()
# and override the defaults (lines 117-119, 552, 1674).
REGIME_CONFIG: Dict[Regime, Dict[str, float]] = {
    Regime.DEFENSIVE: {
        "min_rr": 1.8,                    # Task IMPROVEMENT-11: was 2.0 → 1.8 (Rule 18 floor)
        "min_score": 65,                  # Task IMPROVEMENT-11: was 75 → 65 (match NORMAL)
        "position_size_multiplier": 0.5,  # 50% of normal size (keep conservative)
        "max_picks_per_day": 5,           # Task IMPROVEMENT-11: was 2 → 5 (owner: max 5 is best)
        "atr_stop_multiplier": 1.5,       # tighter stops (was 2.0)
        "falling_knife_threshold": 0.12,  # 12% in 5d = reject (was 0.15)
        "min_turnover_multiplier": 1.5,   # Task IMPROVEMENT-11: was 2.0 → 1.5 (less restrictive)
        "max_open_positions": 5,          # Task IMPROVEMENT-11: was 3 → 5
    },
    Regime.NORMAL: {
        "min_rr": 1.5,
        "min_score": 60,
        "position_size_multiplier": 0.8,
        "max_picks_per_day": 5,
        "atr_stop_multiplier": 2.0,
        "falling_knife_threshold": 0.15,
        "min_turnover_multiplier": 1.0,
        "max_open_positions": 5,
    },
    Regime.AGGRESSIVE: {
        "min_rr": 1.5,                    # same R/R (we have more good setups)
        "min_score": 70,                  # slightly higher than NORMAL (avoid noise)
        "position_size_multiplier": 1.0,  # full size
        "max_picks_per_day": 7,           # +2 vs NORMAL
        "atr_stop_multiplier": 2.0,
        "falling_knife_threshold": 0.18,  # tolerate more pullback (trend rides dips)
        "min_turnover_multiplier": 0.8,   # lower bar (we ride momentum)
        "max_open_positions": 7,
    },
}


# ──────────────────────────────────────────────────────────────────────────
# Detection rule thresholds (when to trigger each regime)
# ──────────────────────────────────────────────────────────────────────────
# DEFENSIVE — ANY one of these triggers it (with hysteresis)
DEFENSIVE_RULES = {
    "index_below_sma20_and_sma50": True,   # price < SMA20 AND < SMA50
    "index_daily_decline_pct": 0.7,        # >= 0.7% down in one day
    "breadth_up_pct_lt": 0.25,             # < 25% stocks up (or > 70% down)
    "atr_ratio_gt": 1.4,                   # ATR(14) > 1.4× 20-day avg ATR
    "turnover_drop_pct_gt": 0.30,          # avg turnover down > 30% vs 10d avg
    "loss_streak_days_gte": 3,             # 3 consecutive down days
    "short_term_drawdown_pct_gt": 0.05,   # drawdown > 5% from recent peak
}

# AGGRESSIVE — ALL must be true (stricter)
AGGRESSIVE_RULES = {
    "index_above_sma20": True,
    "index_above_sma50": True,
    "sma50_above_sma200": True,
    "breadth_up_pct_gte": 0.55,             # >= 55% stocks up
    "turnover_ratio_gte": 1.2,              # >= 1.2× 10-day avg turnover
    "atr_stable_or_declining": True,        # ATR ratio <= 1.1
    "loss_streak_days_eq": 0,               # no down-day streak
}

# Hysteresis — require N consecutive days before switching
HYSTERESIS = {
    # Days of sustained new-regime conditions required to actually switch
    "to_defensive_days": 2,
    "to_aggressive_days": 3,
    "to_normal_from_defensive_days": 2,
    "to_normal_from_aggressive_days": 2,
}


# ──────────────────────────────────────────────────────────────────────────
# Dataclasses
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class RegimeIndicators:
    """6 indicators that determine the regime.

    All numeric fields are floats; None means "could not compute" (e.g. < 200
    trading days for SMA200).
    """
    index_sma20: Optional[float] = None
    index_sma50: Optional[float] = None
    index_sma200: Optional[float] = None
    index_current: Optional[float] = None
    index_daily_change_pct: float = 0.0
    breadth_pct: float = 0.5           # fraction of stocks up today (0..1)
    breadth_advances: int = 0
    breadth_declines: int = 0
    breadth_total: int = 0
    atr_14: float = 0.0
    atr_20d_avg: float = 0.0
    atr_ratio: float = 1.0              # atr_14 / atr_20d_avg
    avg_turnover_today: float = 0.0
    avg_turnover_10d: float = 0.0
    turnover_ratio: float = 1.0         # today / 10d avg
    loss_streak_days: int = 0
    short_term_drawdown_pct: float = 0.0
    # raw context (for audit)
    index_ticker_used: str = ""
    index_source: str = ""              # 'ticker' | 'basket'
    sample_size: int = 0
    latest_date: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class RegimeResult:
    regime: Regime
    indicators: RegimeIndicators
    confidence: float                    # 0..1 — how sure we are of this regime
    reasons: List[str] = field(default_factory=list)  # human-readable bullet list
    computed_at: str = ""
    market: str = ""
    # Hysteresis bookkeeping (exposed for transparency)
    raw_regime: Regime = Regime.NORMAL        # what the rules say today
    candidate_regime: Regime = Regime.NORMAL  # what we're "leaning toward"
    candidate_days: int = 0                   # how many days we've been leaning
    previous_effective_regime: Regime = Regime.NORMAL  # what was stored before

    @property
    def thresholds(self) -> Dict[str, float]:
        """Convenience accessor for the REGIME_CONFIG of the effective regime."""
        return REGIME_CONFIG[self.regime]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "regime": self.regime.value,
            "raw_regime": self.raw_regime.value,
            "candidate_regime": self.candidate_regime.value,
            "candidate_days": self.candidate_days,
            "previous_effective_regime": self.previous_effective_regime.value,
            "confidence": round(self.confidence, 3),
            "reasons": self.reasons,
            "market": self.market,
            "computed_at": self.computed_at,
            "indicators": self.indicators.to_dict(),
            "thresholds": REGIME_CONFIG[self.regime],
        }


# ──────────────────────────────────────────────────────────────────────────
# MarketRegimeEngine
# ──────────────────────────────────────────────────────────────────────────
class MarketRegimeEngine:
    """Dynamic Market Regime Detection.

    Usage:
        engine = MarketRegimeEngine(market="EGX")
        result = engine.update_regime()           # compute + apply hysteresis + persist
        regime = engine.get_current_regime()      # read persisted regime (cached)

    For tests:
        ind = engine.compute_indicators()         # raw indicators only
        res = engine.detect_regime(ind)           # raw regime from rules
    """

    HISTORY_DAYS = 220   # need 200 for SMA200 + buffer for ATR smoothing

    def __init__(self, market: str = "EGX", db_path: Optional[str] = None,
                 allow_unknown: bool = False):
        """Initialize the engine for a market.

        Args:
            market: one of EGX/TADAWUL/KSE/QSE/CRYPTO/GOLD.
            db_path: override the price DB path (for tests).
            allow_unknown: if True, accept unknown market names by
                inheriting the EGX config (used by hysteresis tests that
                need a separate state key without polluting production EGX).
        """
        market = (market or "EGX").upper()
        if market not in MARKET_CONFIG:
            if allow_unknown:
                # Clone EGX config — only the settings key differs (used for tests)
                self.config = dict(MARKET_CONFIG["EGX"])
                self.market = market
                if db_path is not None:
                    self.config["price_db"] = db_path
                    self.config["stocks_db"] = db_path
                return
            market = "EGX"
        self.market = market
        self.config = MARKET_CONFIG[market]
        # Override DB path for tests
        if db_path is not None:
            self.config = {**self.config, "price_db": db_path, "stocks_db": db_path}

    # ════════════════════════════════════════════════════════════════════
    # DB helpers
    # ════════════════════════════════════════════════════════════════════
    def _connect(self, db_path: str) -> sqlite3.Connection:
        conn = sqlite3.connect(db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> List[str]:
        cur = conn.cursor()
        try:
            cur.execute(f"PRAGMA table_info({table})")
            return [r[1] for r in cur.fetchall()]
        except Exception:
            return []

    def _table_exists(self, conn: sqlite3.Connection, table: str) -> bool:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        )
        return cur.fetchone() is not None

    # ════════════════════════════════════════════════════════════════════
    # Universe: which tickers to use for breadth + basket
    # ════════════════════════════════════════════════════════════════════
    def _get_universe_tickers(self, limit: int = 20) -> List[str]:
        """Top-N most-liquid tickers for the market.

        For EGX: from stocks.db.stocks (turnover_egp DESC).
        For CRYPTO/GOLD: returns the index ticker itself.
        """
        cfg = self.config
        if cfg["stocks_market_col"] is None:
            # CRYPTO / GOLD — universe == the index itself
            return [cfg["index_ticker"]]

        conn = self._connect(cfg["stocks_db"])
        try:
            if not self._table_exists(conn, cfg["stocks_table"]):
                return []
            cols = set(self._table_columns(conn, cfg["stocks_table"]))
            market_filter = ""
            params: Tuple = ()
            if cfg["stocks_market_col"] in cols:
                market_filter = f"WHERE {cfg['stocks_market_col']} = ?"
                params = (cfg["stocks_market_val"],)
            if cfg["stocks_active_col"] in cols:
                and_clause = "AND" if market_filter else "WHERE"
                market_filter = f"{market_filter} {and_clause} {cfg['stocks_active_col']} = 1"
            # Order by a liquidity proxy: prefer turnover_egp, then market_cap, then volume
            order_col = None
            for cand in ("turnover_egp", "market_cap", "avg_volume", "volume"):
                if cand in cols:
                    order_col = cand
                    break
            order_clause = f"ORDER BY {order_col} DESC" if order_col else "ORDER BY ticker"
            cur = conn.cursor()
            cur.execute(
                f"SELECT ticker FROM {cfg['stocks_table']} {market_filter} {order_clause} LIMIT ?",
                (*params, limit),
            )
            return [r[0] for r in cur.fetchall()]
        except Exception as e:
            logger.warning(f"[regime] universe fetch failed: {e}")
            return []
        finally:
            conn.close()

    # ════════════════════════════════════════════════════════════════════
    # Index OHLCV: either real index ticker or basket of top stocks
    # ════════════════════════════════════════════════════════════════════
    def _fetch_ticker_ohlcv(self, conn: sqlite3.Connection, ticker: str) -> List[Dict[str, Any]]:
        """Fetch OHLCV rows for one ticker, sorted oldest → newest."""
        cfg = self.config
        cols = self._table_columns(conn, cfg["price_table"])
        if not cols:
            return []
        # Choose close column (close_price preferred, else close)
        close_col = cfg["close_col"] if cfg["close_col"] in cols else (
            "close" if "close" in cols else cfg["close_col"]
        )
        high_col = cfg["high_col"] if cfg["high_col"] in cols else (
            "high" if "high" in cols else cfg["high_col"]
        )
        low_col = cfg["low_col"] if cfg["low_col"] in cols else (
            "low" if "low" in cols else cfg["low_col"]
        )
        open_col = cfg["open_col"] if cfg["open_col"] in cols else (
            "open" if "open" in cols else cfg["open_col"]
        )
        volume_col = cfg["volume_col"] if cfg["volume_col"] in cols else "volume"
        turnover_col = cfg["turnover_col"] if cfg["turnover_col"] in cols else None

        select_cols = [
            cfg["date_col"],
            open_col, high_col, low_col, close_col, volume_col,
        ]
        if turnover_col:
            select_cols.append(turnover_col)
        select_sql = ", ".join(select_cols)
        cur = conn.cursor()
        cur.execute(
            f"SELECT {select_sql} FROM {cfg['price_table']} "
            f"WHERE {cfg['ticker_col']} = ? "
            f"ORDER BY {cfg['date_col']} ASC",
            (ticker,),
        )
        rows = cur.fetchall()
        out: List[Dict[str, Any]] = []
        for r in rows:
            row = dict(r)
            # normalize column aliases
            row["close"] = row.get(close_col) or row.get("close")
            row["high"] = row.get(high_col) or row.get("high")
            row["low"] = row.get(low_col) or row.get("low")
            row["open"] = row.get(open_col) or row.get("open")
            row["date"] = row.get(cfg["date_col"])
            out.append(row)
        return out

    def _normalize_date(self, d: str) -> str:
        """Crypto timestamps are full ISO; truncate to YYYY-MM-DD."""
        if not d:
            return ""
        if "T" in d or " " in d:
            return d.split("T")[0].split(" ")[0]
        return d

    def _fetch_basket_ohlcv(self, tickers: List[str]) -> Tuple[List[Dict[str, Any]], int]:
        """Build a synthetic index from equal-weighted normalized closes.

        Returns (index_rows, sample_size). Each index row has
        {date, close, high, low, open, volume, turnover}.
        """
        if not tickers:
            return [], 0
        cfg = self.config
        conn = self._connect(cfg["price_db"])
        try:
            per_ticker = {}
            for tk in tickers:
                rows = self._fetch_ticker_ohlcv(conn, tk)
                if rows:
                    per_ticker[tk] = rows
            if not per_ticker:
                return [], 0
            # union of all dates
            all_dates = sorted({r["date"] for r in (row for rows in per_ticker.values() for row in rows)})
            # Build normalized close series per ticker, then average
            # (we normalize each ticker's first available close to 100, then
            #  average across tickers that have data on that date)
            norm_series: Dict[str, List[Tuple[str, float, float, float, float, float, float]]] = {}
            for tk, rows in per_ticker.items():
                if not rows:
                    continue
                base = rows[0]["close"] or 0
                if base <= 0:
                    continue
                norm = []
                for r in rows:
                    c = r.get("close") or 0
                    if c <= 0:
                        continue
                    h = r.get("high") or c
                    lo = r.get("low") or c
                    o = r.get("open") or c
                    # RELATIVE-PATHS + DATA-FIX: volume can be string like '259.54K' — parse safely
                    def _safe_float(val):
                        if val is None: return 0.0
                        if isinstance(val, (int, float)): return float(val)
                        s = str(val).replace('\u202f', '').replace('\xa0', '').strip()
                        if not s: return 0.0
                        mult = 1.0
                        if s.endswith('K') or s.endswith('k'): mult = 1_000; s = s[:-1]
                        elif s.endswith('M') or s.endswith('m'): mult = 1_000_000; s = s[:-1]
                        elif s.endswith('B') or s.endswith('b'): mult = 1_000_000_000; s = s[:-1]
                        try: return float(s) * mult
                        except: return 0.0
                    v = _safe_float(r.get("volume"))
                    t = _safe_float(r.get("turnover"))
                    norm.append((r["date"], c / base * 100.0, h / base * 100.0,
                                 lo / base * 100.0, o / base * 100.0, v, t))
                norm_series[tk] = norm
            # Pivot: for each date, average close/high/low/open across tickers present
            by_date: Dict[str, Dict[str, List[float]]] = {}
            for tk, norm in norm_series.items():
                for d, c, h, lo, o, v, t in norm:
                    slot = by_date.setdefault(d, {"c": [], "h": [], "l": [], "o": [], "v": [], "t": []})
                    slot["c"].append(c); slot["h"].append(h); slot["l"].append(lo)
                    slot["o"].append(o); slot["v"].append(v); slot["t"].append(t)
            index_rows = []
            for d in all_dates:
                slot = by_date.get(d)
                if not slot or not slot["c"]:
                    continue
                index_rows.append({
                    "date": d,
                    "close": statistics.mean(slot["c"]),
                    "high": statistics.mean(slot["h"]),
                    "low": statistics.mean(slot["l"]),
                    "open": statistics.mean(slot["o"]),
                    "volume": sum(slot["v"]),
                    "turnover": sum(slot["t"]),
                })
            return index_rows, len(norm_series)
        finally:
            conn.close()

    def _fetch_index_ohlcv(self) -> Tuple[List[Dict[str, Any]], str, int]:
        """Fetch the index OHLCV — try real ticker, then basket fallback.

        Returns (rows, source, sample_size).
        source ∈ {'ticker', 'basket', 'none'}
        """
        cfg = self.config
        mode = cfg.get("index_source", "auto")
        conn = self._connect(cfg["price_db"])
        try:
            if mode in ("auto", "ticker"):
                if self._table_exists(conn, cfg["price_table"]):
                    rows = self._fetch_ticker_ohlcv(conn, cfg["index_ticker"])
                    if rows and len(rows) >= 30:
                        # success — real index found
                        return rows, "ticker", 1
            if mode == "ticker":
                # explicit ticker required but missing
                return [], "none", 0
        finally:
            conn.close()
        # Fallback: basket of top-N liquid stocks
        universe = self._get_universe_tickers(cfg["top_n_basket"])
        if not universe:
            return [], "none", 0
        basket_rows, sample = self._fetch_basket_ohlcv(universe)
        return basket_rows, "basket", sample

    # ════════════════════════════════════════════════════════════════════
    # Indicator math
    # ════════════════════════════════════════════════════════════════════
    @staticmethod
    def _sma(values: List[float], period: int) -> Optional[float]:
        if len(values) < period:
            return None
        return statistics.mean(values[-period:])

    @staticmethod
    def _atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[float]:
        """Simple ATR (Wilder smoothing skipped for clarity; we use a 14-period SMA of TR)."""
        if len(closes) < period + 1:
            return []
        trs = []
        for i in range(1, len(closes)):
            h, lo, pc = highs[i], lows[i], closes[i - 1]
            tr = max(h - lo, abs(h - pc), abs(lo - pc))
            trs.append(tr)
        # Rolling SMA of TR over `period`
        atrs = []
        for i in range(len(trs) - period + 1):
            atrs.append(statistics.mean(trs[i:i + period]))
        return atrs

    @staticmethod
    def _loss_streak(closes: List[float]) -> int:
        """Count of consecutive strictly-down days at the end of the series."""
        if len(closes) < 2:
            return 0
        streak = 0
        for i in range(len(closes) - 1, 0, -1):
            if closes[i] < closes[i - 1]:
                streak += 1
            else:
                break
        return streak

    @staticmethod
    def _short_term_drawdown(closes: List[float], window: int = 20) -> float:
        """Max drawdown from the recent `window`-day peak (as a positive fraction)."""
        if len(closes) < 2:
            return 0.0
        window = min(window, len(closes))
        recent = closes[-window:]
        peak = max(recent)
        current = recent[-1]
        if peak <= 0:
            return 0.0
        return max(0.0, (peak - current) / peak)

    # ════════════════════════════════════════════════════════════════════
    # Breadth: % of universe stocks that went up on the latest date
    # ════════════════════════════════════════════════════════════════════
    def _compute_breadth(self) -> Tuple[float, int, int, int, str]:
        """Returns (up_pct, advances, declines, total, latest_date)."""
        cfg = self.config
        if cfg["stocks_market_col"] is None:
            # CRYPTO/GOLD — breadth is N/A (single instrument). Treat as neutral 0.5.
            # Use the index direction itself as a proxy: if BTC up today → 1.0, else 0.0
            conn = self._connect(cfg["price_db"])
            try:
                rows = self._fetch_ticker_ohlcv(conn, cfg["index_ticker"]) if self._table_exists(conn, cfg["price_table"]) else []
            finally:
                conn.close()
            if len(rows) < 2:
                return 0.5, 0, 0, 0, ""
            last = rows[-1]
            prev = rows[-2]
            if prev.get("close") and last.get("close"):
                up = 1.0 if last["close"] > prev["close"] else 0.0
                ld = self._normalize_date(last.get("date") or "")
                return up, 1 if up > 0.5 else 0, 0 if up > 0.5 else 1, 1, ld
            return 0.5, 0, 0, 0, ""

        # Stock markets — compute from universe
        universe = self._get_universe_tickers(cfg["top_n_basket"])
        if not universe:
            return 0.5, 0, 0, 0, ""
        conn = self._connect(cfg["price_db"])
        advances = declines = total = 0
        latest_date = ""
        try:
            for tk in universe:
                rows = self._fetch_ticker_ohlcv(conn, tk)
                if len(rows) < 2:
                    continue
                last = rows[-1]
                prev = rows[-2]
                lc = last.get("close") or 0
                pc = prev.get("close") or 0
                if lc <= 0 or pc <= 0:
                    continue
                total += 1
                if lc > pc:
                    advances += 1
                elif lc < pc:
                    declines += 1
                if not latest_date:
                    latest_date = self._normalize_date(last.get("date") or "")
                else:
                    ld = self._normalize_date(last.get("date") or "")
                    if ld > latest_date:
                        latest_date = ld
        finally:
            conn.close()
        up_pct = (advances / total) if total > 0 else 0.5
        return up_pct, advances, declines, total, latest_date

    # ════════════════════════════════════════════════════════════════════
    # Compute all 6 indicators
    # ════════════════════════════════════════════════════════════════════
    def compute_indicators(self) -> RegimeIndicators:
        """Read price history + stocks table, compute the 6 indicators.

        Safe-by-design: any failure short-circuits to a NEUTRAL indicator set
        (NORMAL regime). The V40.2 generator will still run with default
        thresholds — regime failure must NEVER block the generator.
        """
        ind = RegimeIndicators()
        try:
            index_rows, source, sample = self._fetch_index_ohlcv()
            if not index_rows:
                logger.warning(f"[regime] no index data for market={self.market}")
                return ind
            closes = [r["close"] for r in index_rows if r.get("close")]
            highs = [r["high"] for r in index_rows if r.get("high")]
            lows = [r["low"] for r in index_rows if r.get("low")]
            turnovers = [r.get("turnover") or 0.0 for r in index_rows]
            if len(closes) < 30:
                logger.warning(f"[regime] insufficient closes for market={self.market} ({len(closes)})")
                return ind

            ind.index_sma20 = self._sma(closes, 20)
            ind.index_sma50 = self._sma(closes, 50) if len(closes) >= 50 else None
            ind.index_sma200 = self._sma(closes, 200) if len(closes) >= 200 else None
            ind.index_current = closes[-1]
            if len(closes) >= 2 and closes[-2] > 0:
                ind.index_daily_change_pct = round(
                    (closes[-1] - closes[-2]) / closes[-2] * 100.0, 4
                )

            # Breadth (separate query against universe)
            up_pct, adv, dec, tot, ld_breadth = self._compute_breadth()
            ind.breadth_pct = round(up_pct, 4)
            ind.breadth_advances = adv
            ind.breadth_declines = dec
            ind.breadth_total = tot
            if ld_breadth:
                ind.latest_date = ld_breadth
            elif index_rows:
                ind.latest_date = self._normalize_date(index_rows[-1].get("date") or "")

            # ATR(14) + 20-day average ATR + ratio
            atrs = self._atr(highs, lows, closes, 14)
            if atrs:
                ind.atr_14 = round(atrs[-1], 6)
                ind.atr_20d_avg = round(statistics.mean(atrs[-20:]) if len(atrs) >= 20 else statistics.mean(atrs), 6)
                if ind.atr_20d_avg > 0:
                    ind.atr_ratio = round(ind.atr_14 / ind.atr_20d_avg, 3)

            # Liquidity: average turnover (today vs 10-day average)
            if turnovers and len(turnovers) >= 2:
                ind.avg_turnover_today = float(turnovers[-1] or 0)
                window = turnovers[-10:] if len(turnovers) >= 10 else turnovers
                non_zero = [t for t in window if t > 0]
                if non_zero:
                    ind.avg_turnover_10d = round(statistics.mean(non_zero), 2)
                if ind.avg_turnover_10d > 0:
                    ind.turnover_ratio = round(ind.avg_turnover_today / ind.avg_turnover_10d, 3)

            # Loss streak + drawdown
            ind.loss_streak_days = self._loss_streak(closes)
            ind.short_term_drawdown_pct = round(self._short_term_drawdown(closes, 20), 4)

            ind.index_ticker_used = self.config["index_ticker"]
            ind.index_source = source
            ind.sample_size = sample
            return ind
        except Exception as e:
            logger.exception(f"[regime] compute_indicators failed: {e}")
            return ind

    # ════════════════════════════════════════════════════════════════════
    # Regime detection rules
    # ════════════════════════════════════════════════════════════════════
    def detect_regime(self, indicators: RegimeIndicators) -> RegimeResult:
        """Apply the DEFENSIVE / AGGRESSIVE rules and return a RegimeResult.

        NOTE: This returns the *raw* regime (what the rules say today).
        Hysteresis is applied in `update_regime()`.
        """
        reasons_defensive: List[str] = []
        reasons_aggressive: List[str] = []

        # ── DEFENSIVE checks (ANY one triggers) ──
        if (indicators.index_sma20 is not None and indicators.index_sma50 is not None
                and indicators.index_current is not None):
            if (indicators.index_current < indicators.index_sma20
                    and indicators.index_current < indicators.index_sma50):
                reasons_defensive.append(
                    f"Index {indicators.index_current:.2f} < SMA20({indicators.index_sma20:.2f}) AND SMA50({indicators.index_sma50:.2f})"
                )

        if indicators.index_daily_change_pct <= -DEFENSIVE_RULES["index_daily_decline_pct"]:
            reasons_defensive.append(
                f"Index down {indicators.index_daily_change_pct:.2f}% (>= {DEFENSIVE_RULES['index_daily_decline_pct']}%)"
            )

        if indicators.breadth_total > 0 and indicators.breadth_pct < DEFENSIVE_RULES["breadth_up_pct_lt"]:
            reasons_defensive.append(
                f"Breadth: only {indicators.breadth_pct*100:.1f}% stocks up (< {DEFENSIVE_RULES['breadth_up_pct_lt']*100:.0f}%)"
            )

        if indicators.atr_20d_avg > 0 and indicators.atr_ratio > DEFENSIVE_RULES["atr_ratio_gt"]:
            reasons_defensive.append(
                f"ATR ratio {indicators.atr_ratio:.2f} > {DEFENSIVE_RULES['atr_ratio_gt']} (volatility spike)"
            )

        if (indicators.avg_turnover_10d > 0
                and indicators.turnover_ratio < (1 - DEFENSIVE_RULES["turnover_drop_pct_gt"])):
            reasons_defensive.append(
                f"Turnover ratio {indicators.turnover_ratio:.2f} (down > {DEFENSIVE_RULES['turnover_drop_pct_gt']*100:.0f}% vs 10d avg)"
            )

        if indicators.loss_streak_days >= DEFENSIVE_RULES["loss_streak_days_gte"]:
            reasons_defensive.append(
                f"{indicators.loss_streak_days} consecutive down days (>= {DEFENSIVE_RULES['loss_streak_days_gte']})"
            )

        if indicators.short_term_drawdown_pct > DEFENSIVE_RULES["short_term_drawdown_pct_gt"]:
            reasons_defensive.append(
                f"Short-term drawdown {indicators.short_term_drawdown_pct*100:.1f}% (> {DEFENSIVE_RULES['short_term_drawdown_pct_gt']*100:.0f}%)"
            )

        # ── AGGRESSIVE checks (ALL must be true) ──
        aggressive_ok = True
        if not (indicators.index_sma20 is not None and indicators.index_sma50 is not None
                and indicators.index_current is not None
                and indicators.index_current > indicators.index_sma20
                and indicators.index_current > indicators.index_sma50):
            aggressive_ok = False
        else:
            reasons_aggressive.append(
                f"Index {indicators.index_current:.2f} > SMA20({indicators.index_sma20:.2f}) > SMA50({indicators.index_sma50:.2f})"
            )

        if indicators.index_sma200 is not None and indicators.index_sma50 is not None:
            if indicators.index_sma50 > indicators.index_sma200:
                reasons_aggressive.append("SMA50 > SMA200 (golden cross)")
            else:
                aggressive_ok = False
        else:
            # SMA200 unavailable (new market) — don't fail aggressive on this alone
            reasons_aggressive.append("SMA200 N/A (< 200 days history) — skipped")

        if indicators.breadth_total > 0:
            if indicators.breadth_pct >= AGGRESSIVE_RULES["breadth_up_pct_gte"]:
                reasons_aggressive.append(
                    f"Breadth {indicators.breadth_pct*100:.1f}% (>= {AGGRESSIVE_RULES['breadth_up_pct_gte']*100:.0f}%)"
                )
            else:
                aggressive_ok = False
                reasons_aggressive.append(
                    f"Breadth {indicators.breadth_pct*100:.1f}% < {AGGRESSIVE_RULES['breadth_up_pct_gte']*100:.0f}% (FAIL)"
                )
        else:
            aggressive_ok = False
            reasons_aggressive.append("Breadth N/A (FAIL)")

        if indicators.turnover_ratio >= AGGRESSIVE_RULES["turnover_ratio_gte"]:
            reasons_aggressive.append(
                f"Turnover ratio {indicators.turnover_ratio:.2f} (>= {AGGRESSIVE_RULES['turnover_ratio_gte']})"
            )
        else:
            aggressive_ok = False
            reasons_aggressive.append(
                f"Turnover ratio {indicators.turnover_ratio:.2f} < {AGGRESSIVE_RULES['turnover_ratio_gte']} (FAIL)"
            )

        if indicators.atr_ratio <= 1.1:
            reasons_aggressive.append(f"ATR stable/declining (ratio {indicators.atr_ratio:.2f} <= 1.1)")
        else:
            aggressive_ok = False
            reasons_aggressive.append(
                f"ATR ratio {indicators.atr_ratio:.2f} > 1.1 (FAIL — volatility expanding)"
            )

        if indicators.loss_streak_days == AGGRESSIVE_RULES["loss_streak_days_eq"]:
            reasons_aggressive.append("No down-day streak")
        else:
            aggressive_ok = False
            reasons_aggressive.append(
                f"Loss streak {indicators.loss_streak_days} > 0 (FAIL)"
            )

        # ── Decide raw regime ──
        if reasons_defensive:
            raw_regime = Regime.DEFENSIVE
            confidence = min(1.0, len(reasons_defensive) / 3.0)  # 3+ reasons → high confidence
            reasons = ["DEFENSIVE triggered by:"] + [f"  • {r}" for r in reasons_defensive]
        elif aggressive_ok:
            raw_regime = Regime.AGGRESSIVE
            confidence = 0.85
            reasons = ["AGGRESSIVE confirmed (all rules pass):"] + [f"  • {r}" for r in reasons_aggressive]
        else:
            raw_regime = Regime.NORMAL
            confidence = 0.6
            reasons = [
                "NORMAL — neither DEFENSIVE nor AGGRESSIVE triggered.",
                f"  • Index daily change: {indicators.index_daily_change_pct:+.2f}%",
                f"  • Breadth up: {indicators.breadth_pct*100:.1f}% ({indicators.breadth_advances}/{indicators.breadth_total})",
                f"  • ATR ratio: {indicators.atr_ratio:.2f}",
                f"  • Turnover ratio: {indicators.turnover_ratio:.2f}",
                f"  • Loss streak: {indicators.loss_streak_days} days",
                f"  • Drawdown: {indicators.short_term_drawdown_pct*100:.1f}%",
            ]

        return RegimeResult(
            regime=raw_regime,                # raw — hysteresis applies next
            indicators=indicators,
            confidence=confidence,
            reasons=reasons,
            computed_at=datetime.now(timezone.utc).isoformat(),
            market=self.market,
            raw_regime=raw_regime,
            candidate_regime=raw_regime,
            candidate_days=0,
            previous_effective_regime=Regime.NORMAL,
        )

    # ════════════════════════════════════════════════════════════════════
    # Persistence: engine_settings + market_regime_log
    # ════════════════════════════════════════════════════════════════════
    def _settings_key(self) -> str:
        return f"current_regime_{self.market}"

    def _ensure_log_table(self, conn: sqlite3.Connection) -> None:
        """Create market_regime_log if missing + add new columns for v2 schema.

        The legacy table exists in stocks.db with a UNIQUE constraint on `date`
        (from the old regime_detector.py). The v2 schema:
          - drops the UNIQUE on `date` (we now log per-market per-day)
          - adds the new columns (breadth, atr_ratio, turnover_ratio, raw_regime,
            candidate_regime, candidate_days, market, ...) via ALTER TABLE.

        Migration strategy (idempotent):
          1. Rename the legacy table to `market_regime_log_legacy_v1` if the
             current schema still has a UNIQUE on `date`.
          2. Create the new v2 table.
          3. Preserve old rows by copying them (market='LEGACY_EGX', regime
             value cast to 'NORMAL' since the old vocab is incompatible).
        """
        cur = conn.cursor()
        # Check if the table exists with the legacy UNIQUE(date) constraint
        cur.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='market_regime_log'"
        )
        row = cur.fetchone()
        legacy_unique = False
        if row and row[0] and "UNIQUE" in row[0].upper() and "date" in row[0].upper():
            # legacy schema — flag for migration
            legacy_unique = True

        if legacy_unique:
            # Preserve audit history by renaming the old table
            try:
                cur.execute("ALTER TABLE market_regime_log RENAME TO market_regime_log_legacy_v1")
                print("📦 [regime] migrated legacy market_regime_log → market_regime_log_legacy_v1", flush=True)
            except sqlite3.OperationalError:
                # rename target already exists — just drop the old one
                cur.execute("DROP TABLE market_regime_log")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_regime_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                market TEXT NOT NULL DEFAULT 'EGX',
                regime TEXT NOT NULL,
                raw_regime TEXT,
                candidate_regime TEXT,
                candidate_days INTEGER DEFAULT 0,
                confidence REAL DEFAULT 0,
                reasons TEXT,
                indicators TEXT,
                index_ticker TEXT,
                index_source TEXT,
                index_current REAL,
                index_daily_change_pct REAL,
                breadth_pct REAL,
                atr_ratio REAL,
                turnover_ratio REAL,
                loss_streak_days INTEGER,
                short_term_drawdown_pct REAL,
                computed_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Add columns that may not exist on the legacy table (idempotent)
        existing = {r[1] for r in cur.execute("PRAGMA table_info(market_regime_log)").fetchall()}
        additions = [
            ("market", "TEXT"),
            ("raw_regime", "TEXT"),
            ("candidate_regime", "TEXT"),
            ("candidate_days", "INTEGER DEFAULT 0"),
            ("reasons", "TEXT"),
            ("indicators", "TEXT"),
            ("index_ticker", "TEXT"),
            ("index_source", "TEXT"),
            ("index_current", "REAL"),
            ("index_daily_change_pct", "REAL"),
            ("breadth_pct", "REAL"),
            ("atr_ratio", "REAL"),
            ("turnover_ratio", "REAL"),
            ("loss_streak_days", "INTEGER"),
            ("short_term_drawdown_pct", "REAL"),
            ("computed_at", "TEXT"),
        ]
        for col, typ in additions:
            if col not in existing:
                try:
                    cur.execute(f"ALTER TABLE market_regime_log ADD COLUMN {col} {typ}")
                except sqlite3.OperationalError:
                    pass  # already exists (race)
        conn.commit()

    def _read_state(self) -> Dict[str, Any]:
        """Read previous regime + candidate bookkeeping from system_settings.

        Returns {current_regime, candidate_regime, candidate_days, last_update}.
        """
        conn = self._connect(STOCKS_DB)
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT value FROM system_settings WHERE key = ?",
                (self._settings_key(),),
            )
            row = cur.fetchone()
            if row and row[0]:
                try:
                    return json.loads(row[0])
                except Exception:
                    pass
            return {
                "current_regime": Regime.NORMAL.value,
                "candidate_regime": Regime.NORMAL.value,
                "candidate_days": 0,
                "last_update": "",
            }
        finally:
            conn.close()

    def _write_state(self, state: Dict[str, Any]) -> None:
        """Persist state to system_settings (UPSERT)."""
        conn = self._connect(STOCKS_DB)
        try:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    value_type TEXT DEFAULT 'string',
                    description TEXT,
                    category TEXT DEFAULT 'general',
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_by TEXT DEFAULT 'system'
                )
            """)
            cur.execute(
                "INSERT INTO system_settings (key, value, value_type, description, category, updated_at, updated_by) "
                "VALUES (?, ?, 'string', ?, 'regime', ?, 'regime_engine') "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
                (
                    self._settings_key(),
                    json.dumps(state, ensure_ascii=False),
                    f"Current market regime for {self.market} (written by MarketRegimeEngine)",
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def _append_log(self, result: RegimeResult) -> None:
        """Append to market_regime_log for audit history."""
        conn = self._connect(STOCKS_DB)
        try:
            self._ensure_log_table(conn)
            ind = result.indicators
            cur = conn.cursor()
            cur.execute("""
                INSERT OR REPLACE INTO market_regime_log (
                    date, market, regime, raw_regime, candidate_regime, candidate_days,
                    confidence, reasons, indicators, index_ticker, index_source,
                    index_current, index_daily_change_pct, breadth_pct, atr_ratio,
                    turnover_ratio, loss_streak_days, short_term_drawdown_pct, computed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ind.latest_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                self.market,
                result.regime.value,
                result.raw_regime.value,
                result.candidate_regime.value,
                result.candidate_days,
                result.confidence,
                json.dumps(result.reasons, ensure_ascii=False),
                json.dumps(ind.to_dict(), ensure_ascii=False),
                ind.index_ticker_used,
                ind.index_source,
                ind.index_current,
                ind.index_daily_change_pct,
                ind.breadth_pct,
                ind.atr_ratio,
                ind.turnover_ratio,
                ind.loss_streak_days,
                ind.short_term_drawdown_pct,
                result.computed_at,
            ))
            conn.commit()
        finally:
            conn.close()

    # ════════════════════════════════════════════════════════════════════
    # Public API
    # ════════════════════════════════════════════════════════════════════
    def get_current_regime(self) -> Regime:
        """Read the current persisted regime (cached in system_settings)."""
        state = self._read_state()
        try:
            return Regime(state.get("current_regime", Regime.NORMAL.value))
        except ValueError:
            return Regime.NORMAL

    def get_current_thresholds(self) -> Dict[str, float]:
        """Return the REGIME_CONFIG dict for the current persisted regime."""
        return REGIME_CONFIG[self.get_current_regime()]

    def _apply_hysteresis(
        self,
        raw_regime: Regime,
        previous: Regime,
        candidate_regime: Regime,
        candidate_days: int,
    ) -> Tuple[Regime, Regime, int]:
        """Decide the new effective regime based on raw signals + history.

        Returns (new_effective_regime, new_candidate_regime, new_candidate_days).
        """
        if raw_regime == previous:
            # Sustained — reset candidate
            return previous, raw_regime, 0

        # raw differs from previous — start/continue candidate streak
        if raw_regime == candidate_regime:
            new_days = candidate_days + 1
        else:
            new_days = 1  # first day of new candidate

        # How many days required to switch?
        if raw_regime == Regime.DEFENSIVE:
            required = HYSTERESIS["to_defensive_days"]
        elif raw_regime == Regime.AGGRESSIVE:
            required = HYSTERESIS["to_aggressive_days"]
        else:  # NORMAL
            required = (HYSTERESIS["to_normal_from_defensive_days"]
                        if previous == Regime.DEFENSIVE
                        else HYSTERESIS["to_normal_from_aggressive_days"])

        if new_days >= required:
            # Switch!
            return raw_regime, raw_regime, 0
        # Not yet — keep previous regime as effective
        return previous, raw_regime, new_days

    def update_regime(self, force: bool = False) -> RegimeResult:
        """Full pipeline: compute → detect → hysteresis → persist → log.

        Args:
            force: if True, skip hysteresis and use raw_regime immediately.
                   (Useful for backtests + first run after migration.)

        Returns:
            RegimeResult with the *effective* regime (post-hysteresis).
        """
        # SANDBOX-FIX (2026-09-30): if FORCE_NORMAL_REGIME env var is set,
        # always return NORMAL (for testing on sandbox without full market data)
        if os.environ.get('FORCE_NORMAL_REGIME', '0') == '1':
            indicators = RegimeIndicators(
                index_sma20=100, index_sma50=100, index_sma200=100,
                index_current=100, index_daily_change_pct=0,
                breadth_pct=50, breadth_advances=10, breadth_declines=10,
                atr_14=1.0, atr_20d_avg=1.0, atr_ratio=1.0,
                avg_turnover_today=1.0, avg_turnover_10d=1.0, turnover_ratio=1.0,
                loss_streak_days=0, short_term_drawdown_pct=0.0,
            )
            return RegimeResult(
                regime=Regime.NORMAL, raw_regime=Regime.NORMAL,
                effective_regime=Regime.NORMAL, candidate_regime=Regime.NORMAL,
                candidate_days=0, previous_effective_regime=Regime.NORMAL,
                confidence=0.5,
                reasons=['FORCE_NORMAL_REGIME=1 — sandbox override'],
                indicators=indicators,
                computed_at=datetime.now().isoformat(),
                market=self.market,
            )
        indicators = self.compute_indicators()
        result = self.detect_regime(indicators)

        # Read previous state for hysteresis
        state = self._read_state()
        previous_str = state.get("current_regime", Regime.NORMAL.value)
        candidate_str = state.get("candidate_regime", Regime.NORMAL.value)
        candidate_days = int(state.get("candidate_days", 0))
        try:
            previous = Regime(previous_str)
        except ValueError:
            previous = Regime.NORMAL
        try:
            candidate = Regime(candidate_str)
        except ValueError:
            candidate = Regime.NORMAL

        if force:
            new_effective = result.raw_regime
            new_candidate = result.raw_regime
            new_days = 0
        else:
            new_effective, new_candidate, new_days = self._apply_hysteresis(
                result.raw_regime, previous, candidate, candidate_days,
            )

        result.previous_effective_regime = previous
        result.candidate_regime = new_candidate
        result.candidate_days = new_days
        result.regime = new_effective

        # Persist state
        new_state = {
            "current_regime": new_effective.value,
            "candidate_regime": new_candidate.value,
            "candidate_days": new_days,
            "last_update": datetime.now(timezone.utc).isoformat(),
            "last_raw_regime": result.raw_regime.value,
            "market": self.market,
        }
        self._write_state(new_state)
        self._append_log(result)

        # Log regime changes (and first-run)
        if previous != new_effective:
            logger.info(
                f"[regime] {self.market} regime CHANGED: {previous.value} → {new_effective.value} "
                f"(raw={result.raw_regime.value}, candidate_days={new_days})"
            )
            print(
                f"🔄 [REGIME-ENGINE] {self.market}: {previous.value} → {new_effective.value} "
                f"(raw={result.raw_regime.value}, candidate_days={new_days})",
                flush=True,
            )
        else:
            print(
                f"📊 [REGIME-ENGINE] {self.market}: {new_effective.value} (raw={result.raw_regime.value}, "
                f"candidate={new_candidate.value}/{new_days}d)",
                flush=True,
            )
        return result

    def get_history(self, limit: int = 30) -> List[Dict[str, Any]]:
        """Return the last N regime log entries for this market."""
        conn = self._connect(STOCKS_DB)
        try:
            self._ensure_log_table(conn)
            cur = conn.cursor()
            cur.execute(
                "SELECT date, market, regime, raw_regime, candidate_regime, candidate_days, "
                "confidence, index_current, index_daily_change_pct, breadth_pct, atr_ratio, "
                "turnover_ratio, loss_streak_days, short_term_drawdown_pct, computed_at "
                "FROM market_regime_log WHERE market = ? "
                "ORDER BY date DESC, id DESC LIMIT ?",
                (self.market, limit),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()


# ──────────────────────────────────────────────────────────────────────────
# Module-level convenience (for cron one-liners)
# ──────────────────────────────────────────────────────────────────────────
def update_all_markets() -> Dict[str, str]:
    """Update regime for every market in MARKET_CONFIG. Returns {market: regime}."""
    out = {}
    for market in MARKET_CONFIG.keys():
        try:
            r = MarketRegimeEngine(market).update_regime()
            out[market] = r.regime.value
        except Exception as e:
            logger.exception(f"[regime] update_all_markets failed for {market}: {e}")
            out[market] = f"ERROR: {e}"
    return out


# ──────────────────────────────────────────────────────────────────────────
# CLI entrypoint
# ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Market Regime Engine — dynamic regime detection")
    parser.add_argument("--market", default="EGX",
                        choices=list(MARKET_CONFIG.keys()),
                        help="Market to analyze (default: EGX)")
    parser.add_argument("--all", action="store_true",
                        help="Update regime for ALL markets")
    parser.add_argument("--force", action="store_true",
                        help="Skip hysteresis — use raw regime immediately (for backtest / first run)")
    parser.add_argument("--history", type=int, default=0,
                        help="Show last N regime log entries (read-only)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")

    if args.history > 0:
        engine = MarketRegimeEngine(args.market)
        for row in engine.get_history(args.history):
            print(row)
    elif args.all:
        out = update_all_markets()
        print(json.dumps(out, indent=2))
    else:
        engine = MarketRegimeEngine(args.market)
        result = engine.update_regime(force=args.force)
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
