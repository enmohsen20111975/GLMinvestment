"""
Backtest Engine — Phase 4 of Kimi's plan
========================================

يختبر استراتيجية MasterAnalyzer على بيانات تاريخية.

لكل يوم في الفترة المحددة:
1. يستدعي MasterAnalyzer.analyze(ticker) باستخدام الأسعار حتى ذلك اليوم فقط
2. يسجل الإشارة (BUY/SELL/HOLD) + entry + target + stop
3. يمشي 30 يوم قدّام: يتحقق هل hit target ولا hit stop ولا expired
4. يحسب: نسبة النجاح، صافي الربح/الخسارة، متوسط R/R
5. النتيجة تتخزن في backtest_results table في predictions.db

Usage (CLI):
    python3 vps-service/analyzers/backtest_engine.py \\
        --tickers 20 --start 2026-01-01 --end 2026-06-01

Usage (Python):
    from analyzers.backtest_engine import BacktestEngine
    engine = BacktestEngine()
    summary = engine.run_quick(ticker_count=20,
                               start_date='2026-01-01',
                               end_date='2026-06-01')
    print(json.dumps(summary, indent=2, ensure_ascii=False))

Author: Phase 4 (BacktestEngine) — general-purpose agent
"""

from __future__ import annotations

import os
import sys
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from contextlib import contextmanager

# Phase 7.3 dedup: import canonical _open_db + dbm handle from core.db_helpers
from core.db_helpers import _open_db, dbm as _dbm, DBM_AVAILABLE as _BT_ENGINE_DBM_AVAILABLE

# ---------------------------------------------------------------------------
# Path setup — make `from analyzers.master_analyzer import MasterAnalyzer` work
# whether the file is run as a script or imported as a module.
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
VPS_SERVICE_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = VPS_SERVICE_DIR.parent

if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

from analyzers.master_analyzer import MasterAnalyzer  # noqa: E402

# ---------------------------------------------------------------------------
# Default DB paths
# ---------------------------------------------------------------------------
DEFAULT_STOCKS_DB = str(PROJECT_ROOT / "db" / "stocks.db")
DEFAULT_PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
DEFAULT_PRICE_HISTORY_DB = str(PROJECT_ROOT / "db" / "price_history.db")

# Signals we consider "actionable" (i.e. something we could trade on)
ACTIONABLE_BUY_SIGNALS = {"STRONG_BUY", "BUY", "ACCUMULATE"}
ACTIONABLE_SELL_SIGNALS = {"STRONG_SELL", "SELL", "REDUCE"}
SKIP_SIGNALS = {"EXCLUDED", "INSUFFICIENT_DATA", "HOLD"}

# Minimum R:R to actually evaluate the trade
MIN_RR_RATIO = 1.5

# Minimum number of historical price points needed to call MasterAnalyzer
MIN_PRICE_HISTORY = 50


def _parse_volume(value: Any) -> float:
    """
    Parse a volume value that may be int, float, or a formatted string like
    '990.2 K', '88.01 M', '1.44\u202fM', '4.5M', '12,345'. Returns 0.0 on
    failure. Used for ordering tickers by liquidity when stocks.volume is
    stored as text.
    """
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return 0.0
    # Remove narrow no-break space (U+202F), regular spaces, commas
    s = s.replace("\u202f", "").replace(" ", "").replace(",", "")
    multiplier = 1.0
    if s and s[-1] in ("K", "k"):
        multiplier = 1_000.0
        s = s[:-1]
    elif s and s[-1] in ("M", "m"):
        multiplier = 1_000_000.0
        s = s[:-1]
    elif s and s[-1] in ("B", "b"):
        multiplier = 1_000_000_000.0
        s = s[:-1]
    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return 0.0


class BacktestEngine:
    """
    Backtest Engine — يختبر استراتيجية MasterAnalyzer على بيانات تاريخية.

    For each (ticker, prediction_date) where prediction_date is a trading day
    in [start_date, end_date]:
        1. Pre-load ALL price history for the ticker ONCE (sorted by date).
        2. Slice closes[:idx+1] / volumes[:idx+1] to simulate "as of that date"
           (no future leakage).
        3. Call MasterAnalyzer.analyze(ticker, prices=closes_slice,
                                       volumes=volumes_slice).
        4. Skip if signal in (EXCLUDED, INSUFFICIENT_DATA, HOLD).
        5. Extract entry/target/stop from analysis.risk_profile.
        6. If risk_reward_ratio < 1.5 → record as REJECTED_RR (no outcome).
        7. Otherwise → walk forward `horizon_days` (default 30), evaluate
           outcome (TARGET_HIT / STOPPED / EXPIRED), store result.
    """

    def __init__(self, db_path: str = None,
                 predictions_db_path: str = None):
        """
        Args:
            db_path: Path to stocks.db (default: project_root/db/stocks.db).
            predictions_db_path: Path to predictions.db
                (default: project_root/db/predictions.db).
        """
        self.db_path = db_path or os.environ.get(
            "BACKTEST_STOCKS_DB", DEFAULT_STOCKS_DB
        )
        self.predictions_db_path = predictions_db_path or os.environ.get(
            "BACKTEST_PREDICTIONS_DB", DEFAULT_PREDICTIONS_DB
        )
        self.price_history_db_path = str(
            Path(self.db_path).parent / "price_history.db"
        )

        # Initialize MasterAnalyzer ONCE — it's expensive to recreate
        # (loads sub-analyzers, fundamental data, etc.).
        self.master_analyzer = MasterAnalyzer(self.db_path)

        # In-memory cache: ticker -> {"dates": [...], "closes": [...],
        # "volumes": [...]} sorted ascending by date.
        self._history_cache: Dict[str, Dict[str, List]] = {}

        # Phase 7 A/B testing — 'control' (no lessons) or 'treatment'
        # (with lessons). Default 'treatment' for backward compat with
        # any code path that calls _store_result() outside run_backtest().
        self._current_ab_group: str = "treatment"

        # Initialize the backtest_results table.
        self._init_table()

    # ------------------------------------------------------------------ #
    # Table initialization
    # ------------------------------------------------------------------ #
    def _init_table(self) -> None:
        """CREATE TABLE IF NOT EXISTS backtest_results (...).

        Phase 7 (A/B testing): adds `ab_group TEXT DEFAULT 'treatment'`
        column. For existing tables that lack the column, an ALTER TABLE
        migration is attempted inside try/except (column may already exist).
        """
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_init_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.predictions_db_path, writable=True)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.predictions_db_path)
                _bt_init_ctx = None
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS backtest_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    target_price REAL,
                    stop_loss REAL,
                    prediction_date TEXT NOT NULL,
                    outcome TEXT,
                    exit_price REAL,
                    actual_return_pct REAL,
                    days_held INTEGER,
                    rr_ratio REAL,
                    trend_filter_passed INTEGER,
                    vcp_detected INTEGER,
                    order_block_found INTEGER,
                    liquidity_sweep_detected INTEGER,
                    master_score REAL,
                    ab_group TEXT DEFAULT 'treatment',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.commit()

            # Migration for existing tables created before Phase 7.
            try:
                conn.execute(
                    "ALTER TABLE backtest_results "
                    "ADD COLUMN ab_group TEXT DEFAULT 'treatment'"
                )
                conn.commit()
                print(
                    "[BacktestEngine] _init_table: added ab_group column "
                    "(migration)."
                )
            except sqlite3.OperationalError:
                # Column already exists — expected on second run onward.
                pass

            conn.close()
        except Exception as e:  # pragma: no cover - storage failures are
            # logged but must NOT crash the engine.
            print(f"[BacktestEngine] _init_table failed: {e}")

    # ------------------------------------------------------------------ #
    # Price history loading
    # ------------------------------------------------------------------ #
    def _preload_full_history(self, ticker: str) -> Dict[str, List]:
        """
        Pre-load ALL price history for a ticker ONCE (sorted ascending by
        date). Used to make backtest iteration efficient — for each
        prediction date we just slice closes[:idx+1].

        Tries price_history.db first (most complete: 274K rows spec),
        then falls back to stocks.db / stock_daily_prices.

        Returns:
            {"dates": [...], "closes": [...], "volumes": [...]} — all lists
            of equal length, sorted ascending by date. Empty lists if no
            data found.
        """
        if ticker in self._history_cache:
            return self._history_cache[ticker]

        dates: List[str] = []
        closes: List[float] = []
        volumes: List[float] = []

        # ---- Source 1: price_history.db (preferred — 274K rows) ----
        try:
            if os.path.exists(self.price_history_db_path):
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _bt_ph1_ctx = None
                try:
                    if _BT_ENGINE_DBM_AVAILABLE:
                        conn = _dbm.get_connection(self.price_history_db_path, writable=False)
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(self.price_history_db_path)
                    _bt_ph1_ctx = None
                cursor = conn.cursor()
                try:
                    cursor.execute(
                        """
                        SELECT date, close_price, volume
                        FROM price_history
                        WHERE ticker = ?
                        ORDER BY date ASC
                        """,
                        (ticker,),
                    )
                    try:
                        from utils.helpers import parse_volume
                    except Exception:
                        parse_volume = lambda val: float(val) if val is not None else 0.0

                    for row in cursor.fetchall():
                        d, c, v = row
                        if c is None:
                            continue
                        dates.append(d)
                        closes.append(float(c))
                        volumes.append(float(parse_volume(v)))
                except sqlite3.OperationalError:
                    # Table doesn't exist in price_history.db — silent
                    # fallback to stocks.db.
                    pass
                conn.close()
        except Exception as e:
            print(
                f"[BacktestEngine] price_history.db load failed for "
                f"{ticker}: {e}"
            )

        # ---- Source 2 (fallback): stocks.db / stock_daily_prices ----
        if not dates:
            try:
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _bt_ph2_ctx = None
                try:
                    if _BT_ENGINE_DBM_AVAILABLE:
                        conn = _dbm.get_connection(self.db_path, writable=False)
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(self.db_path)
                    _bt_ph2_ctx = None
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT price_date, close, volume
                    FROM stock_daily_prices
                    WHERE ticker = ? AND close IS NOT NULL
                    ORDER BY price_date ASC
                    """,
                    (ticker,),
                )
                for row in cursor.fetchall():
                    d, c, v = row
                    if c is None:
                        continue
                    dates.append(d)
                    closes.append(float(c))
                    volumes.append(_parse_volume(v))
                conn.close()
            except Exception as e:
                print(
                    f"[BacktestEngine] stocks.db load failed for "
                    f"{ticker}: {e}"
                )

        result = {"dates": dates, "closes": closes, "volumes": volumes}
        self._history_cache[ticker] = result
        return result

    def _load_price_history_up_to(
        self, ticker: str, up_to_date: str
    ) -> Tuple[List[float], List[float]]:
        """
        Load (closes, volumes) up to up_to_date (inclusive), sorted ascending
        by date. Wrapper around _preload_full_history + date filter.

        Args:
            ticker: Stock symbol.
            up_to_date: YYYY-MM-DD cutoff (inclusive).

        Returns:
            (closes, volumes) — lists of floats, equal length, ascending by
            date. Empty lists if no data.
        """
        full = self._preload_full_history(ticker)
        closes_up: List[float] = []
        volumes_up: List[float] = []
        for i, d in enumerate(full["dates"]):
            if d <= up_to_date:
                closes_up.append(full["closes"][i])
                volumes_up.append(full["volumes"][i])
            else:
                # dates are sorted ascending — stop at first future date.
                break
        return closes_up, volumes_up

    # ------------------------------------------------------------------ #
    # Outcome evaluation
    # ------------------------------------------------------------------ #
    def _evaluate_outcome(
        self,
        ticker: str,
        pred_date: str,
        entry: float,
        target: Optional[float],
        stop: Optional[float],
        signal: str,
        horizon_days: int = 30,
    ) -> Dict[str, Any]:
        """
        Walk forward `horizon_days` (default 30) trading days from pred_date.
        For each day, check whether target or stop was hit.

        For BUY signals: target is above entry, stop is below.
        For SELL signals: target is below entry, stop is above.
        If both hit on the same day → assume STOPPED first (conservative).
        If neither hit after `horizon_days` → EXPIRED, exit_price = last close.

        Returns:
            {
                "outcome": "TARGET_HIT" | "STOPPED" | "EXPIRED",
                "exit_price": float,
                "actual_return_pct": float,   # signed percent
                "days_held": int,
                "max_price": float,
                "min_price": float,
            }
        """
        full = self._preload_full_history(ticker)
        dates = full["dates"]
        closes = full["closes"]

        empty = {
            "outcome": "EXPIRED",
            "exit_price": entry,
            "actual_return_pct": 0.0,
            "days_held": 0,
            "max_price": entry,
            "min_price": entry,
        }

        if not dates or not closes:
            return empty

        # Find the index of pred_date (or first date >= pred_date).
        pred_idx: Optional[int] = None
        for i, d in enumerate(dates):
            if d >= pred_date:
                pred_idx = i
                break
        if pred_idx is None:
            return empty

        # Walk forward up to horizon_days trading days AFTER pred_idx.
        end_idx = min(pred_idx + 1 + horizon_days, len(dates))
        future_closes = closes[pred_idx + 1: end_idx]

        if not future_closes:
            # No future data after pred_date — treat as EXPIRED at entry.
            return empty

        max_price = max(future_closes)
        min_price = min(future_closes)

        sig_upper = (signal or "").upper()
        is_buy = sig_upper in ACTIONABLE_BUY_SIGNALS
        is_sell = sig_upper in ACTIONABLE_SELL_SIGNALS

        def _ret(exit_price: float, outcome: str, day: int) -> Dict[str, Any]:
            ret_pct = (
                (exit_price - entry) / entry * 100.0
                if entry and entry > 0
                else 0.0
            )
            return {
                "outcome": outcome,
                "exit_price": float(exit_price),
                "actual_return_pct": round(ret_pct, 4),
                "days_held": day,
                "max_price": float(max_price),
                "min_price": float(min_price),
            }

        # Walk day-by-day through future closes.
        for day_offset, close_price in enumerate(future_closes, start=1):
            if is_buy:
                hit_stop = stop is not None and close_price <= stop
                hit_target = target is not None and close_price >= target
            elif is_sell:
                hit_stop = stop is not None and close_price >= stop
                hit_target = target is not None and close_price <= target
            else:
                # Non-tradeable signal (shouldn't happen here) — expire.
                continue

            # Conservative: if both hit on the same day, STOPPED wins.
            if hit_stop:
                return _ret(close_price, "STOPPED", day_offset)
            if hit_target:
                return _ret(close_price, "TARGET_HIT", day_offset)

        # Neither target nor stop hit within horizon → EXPIRED.
        last_close = future_closes[-1]
        return _ret(last_close, "EXPIRED", len(future_closes))

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _compute_trend_filter(closes: List[float]) -> int:
        """
        Return 1 if SMA20 > SMA50 (uptrend), 0 otherwise.
        Requires at least 50 data points.
        """
        if not closes or len(closes) < 50:
            return 0
        try:
            sma_20 = sum(closes[-20:]) / 20.0
            sma_50 = sum(closes[-50:]) / 50.0
            return 1 if sma_20 > sma_50 else 0
        except Exception:
            return 0

    def _store_result(self, result: Dict[str, Any]) -> None:
        """Insert one row into backtest_results. Wrapped in try/except —
        storage failures must NOT crash the engine.

        Phase 7 A/B testing: stores `ab_group` (read from
        self._current_ab_group) so we can later split results between
        'control' (no lessons) and 'treatment' (with lessons)."""
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_store_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.predictions_db_path, writable=True)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.predictions_db_path)
                _bt_store_ctx = None
            conn.execute(
                """
                INSERT INTO backtest_results (
                    ticker, signal, entry_price, target_price, stop_loss,
                    prediction_date, outcome, exit_price, actual_return_pct,
                    days_held, rr_ratio, trend_filter_passed, vcp_detected,
                    order_block_found, liquidity_sweep_detected,
                    master_score, ab_group
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.get("ticker"),
                    result.get("signal"),
                    result.get("entry_price"),
                    result.get("target_price"),
                    result.get("stop_loss"),
                    result.get("prediction_date"),
                    result.get("outcome"),
                    result.get("exit_price"),
                    result.get("actual_return_pct"),
                    result.get("days_held"),
                    result.get("rr_ratio"),
                    int(result.get("trend_filter_passed", 0) or 0),
                    int(result.get("vcp_detected", 0) or 0),
                    int(result.get("order_block_found", 0) or 0),
                    int(result.get("liquidity_sweep_detected", 0) or 0),
                    result.get("master_score"),
                    result.get("ab_group", self._current_ab_group),
                ),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[BacktestEngine] _store_result failed: {e}")

    def _get_top_liquid_tickers(self, count: int) -> List[str]:
        """
        Pick the top `count` liquid EGX tickers, ordered by avg volume.

        Tries price_history.db first (AVG(volume) GROUP BY ticker). If
        price_history.db has no price_history table (or is empty), falls
        back to stocks.db / stocks table ordered by parsed volume DESC.
        """
        # ---- Source 1: price_history.db (preferred) ----
        try:
            if os.path.exists(self.price_history_db_path):
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _bt_tlt1_ctx = None
                try:
                    if _BT_ENGINE_DBM_AVAILABLE:
                        conn = _dbm.get_connection(self.price_history_db_path, writable=False)
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(self.price_history_db_path)
                    _bt_tlt1_ctx = None
                cursor = conn.cursor()
                try:
                    cursor.execute(
                        """
                        SELECT ticker, AVG(volume) AS avg_vol
                        FROM price_history
                        GROUP BY ticker
                        ORDER BY avg_vol DESC
                        LIMIT ?
                        """,
                        (count,),
                    )
                    tickers = [row[0] for row in cursor.fetchall()]
                    conn.close()
                    if tickers:
                        return tickers
                except sqlite3.OperationalError:
                    conn.close()
        except Exception as e:
            print(f"[BacktestEngine] price_history.db liquid query: {e}")

        # ---- Source 2 (fallback): stocks.db / stocks ----
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_tlt2_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.db_path, writable=False)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
                _bt_tlt2_ctx = None
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT ticker, volume, avg_volume
                FROM stocks
                WHERE market = 'EGX'
                  AND is_active = 1
                  AND current_price IS NOT NULL
                  AND current_price > 0
                """
            )
            rows = cursor.fetchall()
            conn.close()

            # Parse volume text ('990.2 K' / '1.44 M') into floats for sort.
            def _key(row: Tuple[str, Any, Any]) -> float:
                _ticker, vol, avg_vol = row
                v = _parse_volume(vol)
                a = _parse_volume(avg_vol)
                # Prefer raw volume; fall back to avg_volume.
                return max(v, a)

            rows.sort(key=_key, reverse=True)
            return [r[0] for r in rows[:count]]
        except Exception as e:
            print(f"[BacktestEngine] stocks.db liquid query: {e}")
            return []

    # ------------------------------------------------------------------ #
    # Main entry points
    # ------------------------------------------------------------------ #
    def run_backtest(
        self,
        tickers: List[str],
        start_date: str,
        end_date: str,
        horizon_days: int = 30,
        persona_filter: Optional[str] = None,
        disable_lessons: bool = False,
    ) -> Dict[str, Any]:
        """
        Main entry point. For each (ticker, date) combo where date is a
        trading day in [start_date, end_date]:
            1. Load price history up to date (slice of pre-loaded data).
            2. If len(closes) < 50 → skip (insufficient data).
            3. Call MasterAnalyzer.analyze(ticker, prices=closes,
                                            volumes=volumes).
            4. Skip if signal in (EXCLUDED, INSUFFICIENT_DATA, HOLD).
            5. Get entry/target/stop from analysis.risk_profile.
            6. If risk_reward_ratio < 1.5 → record as REJECTED_RR.
            7. Otherwise → evaluate outcome, store in backtest_results.

        Args:
            tickers: List of ticker symbols to backtest.
            start_date: YYYY-MM-DD start (inclusive).
            end_date: YYYY-MM-DD end (inclusive).
            horizon_days: Forward window for outcome evaluation (default 30).
            persona_filter: Optional persona name (reserved for future use;
                not yet implemented).
            disable_lessons: Phase 7 A/B testing — if True, MasterAnalyzer
                will skip the learned-lessons application block. Each row
                stored from this run is tagged with ab_group='control'
                (disable_lessons=True) or ab_group='treatment' (default).

        Returns:
            Summary dict with the following keys:
                total_predictions, valid_signals, target_hit, stopped,
                expired, rejected_rr, win_rate_pct, avg_return_pct,
                net_return_pct, avg_rr, by_ticker, tickers_processed,
                skipped_insufficient_data, errors, ab_group
        """
        # Phase 7 A/B testing — tag every row stored from this run.
        self._current_ab_group = (
            "control" if disable_lessons else "treatment"
        )

        summary: Dict[str, Any] = {
            "total_predictions": 0,
            "valid_signals": 0,
            "target_hit": 0,
            "stopped": 0,
            "expired": 0,
            "rejected_rr": 0,
            "win_rate_pct": 0.0,
            "avg_return_pct": 0.0,
            "net_return_pct": 0.0,
            "avg_rr": 0.0,
            "by_ticker": {},
            "tickers_processed": 0,
            "skipped_insufficient_data": 0,
            "errors": 0,
            "start_date": start_date,
            "end_date": end_date,
            "horizon_days": horizon_days,
            "tickers_requested": len(tickers),
            "ab_group": self._current_ab_group,
        }

        all_returns: List[float] = []
        all_rrs: List[float] = []

        for t_idx, ticker in enumerate(tickers):
            try:
                full = self._preload_full_history(ticker)
                dates = full["dates"]
                closes = full["closes"]
                volumes = full["volumes"]

                if len(closes) < MIN_PRICE_HISTORY:
                    summary["skipped_insufficient_data"] += 1
                    continue

                # Find trading-day indices whose date is in [start, end].
                in_range_indices = [
                    i for i, d in enumerate(dates)
                    if start_date <= d <= end_date
                ]

                if not in_range_indices:
                    # No trading days in range for this ticker — skip
                    # silently.
                    continue

                ticker_stats = {
                    "predictions": 0,
                    "target_hit": 0,
                    "stopped": 0,
                    "expired": 0,
                    "rejected_rr": 0,
                }

                for idx in in_range_indices:
                    pred_date = dates[idx]
                    closes_slice = closes[: idx + 1]
                    volumes_slice = volumes[: idx + 1]

                    if len(closes_slice) < MIN_PRICE_HISTORY:
                        continue

                    summary["total_predictions"] += 1

                    # ---- Call MasterAnalyzer with sliced history ----
                    try:
                        analysis = self.master_analyzer.analyze(
                            ticker,
                            prices=closes_slice,
                            volumes=volumes_slice,
                            disable_lessons=disable_lessons,
                        )
                    except Exception as e:
                        print(
                            f"[BacktestEngine] analyze() failed for "
                            f"{ticker} @ {pred_date}: {e}"
                        )
                        summary["errors"] += 1
                        continue

                    signal = analysis.signal or "HOLD"

                    # Step 4: skip non-actionable signals.
                    if signal in SKIP_SIGNALS:
                        continue

                    summary["valid_signals"] += 1

                    # Step 5: extract entry/target/stop.
                    rp = analysis.risk_profile or {}
                    entry = rp.get("entry_price") or closes_slice[-1]
                    target = rp.get("target_price")
                    stop = rp.get("stop_loss_price") or rp.get("stop_loss")
                    rr = float(rp.get("risk_reward_ratio", 0.0) or 0.0)

                    trend_passed = self._compute_trend_filter(closes_slice)

                    # Step 6: R:R rejection.
                    if rr < MIN_RR_RATIO:
                        summary["rejected_rr"] += 1
                        ticker_stats["rejected_rr"] += 1
                        ticker_stats["predictions"] += 1
                        self._store_result(
                            {
                                "ticker": ticker,
                                "signal": "REJECTED_RR",
                                "entry_price": entry,
                                "target_price": target,
                                "stop_loss": stop,
                                "prediction_date": pred_date,
                                "outcome": "REJECTED_RR",
                                "exit_price": None,
                                "actual_return_pct": None,
                                "days_held": None,
                                "rr_ratio": rr,
                                "trend_filter_passed": trend_passed,
                                "master_score": analysis.master_score,
                            }
                        )
                        continue

                    # Step 7: evaluate outcome.
                    outcome = self._evaluate_outcome(
                        ticker=ticker,
                        pred_date=pred_date,
                        entry=entry,
                        target=target,
                        stop=stop,
                        signal=signal,
                        horizon_days=horizon_days,
                    )

                    outcome_label = outcome["outcome"]
                    actual_return = outcome["actual_return_pct"]
                    days_held = outcome["days_held"]
                    exit_price = outcome["exit_price"]

                    if outcome_label == "TARGET_HIT":
                        summary["target_hit"] += 1
                        ticker_stats["target_hit"] += 1
                    elif outcome_label == "STOPPED":
                        summary["stopped"] += 1
                        ticker_stats["stopped"] += 1
                    elif outcome_label == "EXPIRED":
                        summary["expired"] += 1
                        ticker_stats["expired"] += 1

                    all_returns.append(actual_return)
                    all_rrs.append(rr)

                    self._store_result(
                        {
                            "ticker": ticker,
                            "signal": signal,
                            "entry_price": entry,
                            "target_price": target,
                            "stop_loss": stop,
                            "prediction_date": pred_date,
                            "outcome": outcome_label,
                            "exit_price": exit_price,
                            "actual_return_pct": actual_return,
                            "days_held": days_held,
                            "rr_ratio": rr,
                            "trend_filter_passed": trend_passed,
                            "master_score": analysis.master_score,
                        }
                    )

                    ticker_stats["predictions"] += 1

                summary["by_ticker"][ticker] = ticker_stats
                summary["tickers_processed"] += 1

                # Print progress every 10 tickers.
                if (t_idx + 1) % 10 == 0:
                    print(
                        f"[BacktestEngine] Progress: "
                        f"{t_idx + 1}/{len(tickers)} tickers processed — "
                        f"{summary['total_predictions']} predictions, "
                        f"{summary['target_hit']} target_hit, "
                        f"{summary['stopped']} stopped, "
                        f"{summary['expired']} expired, "
                        f"{summary['rejected_rr']} rejected_rr so far"
                    )

            except Exception as e:
                print(
                    f"[BacktestEngine] Error processing {ticker}: {e}"
                )
                summary["errors"] += 1

        # ---- Aggregate stats ----
        closed_count = summary["target_hit"] + summary["stopped"]
        summary["win_rate_pct"] = round(
            (summary["target_hit"] / closed_count * 100.0)
            if closed_count > 0
            else 0.0,
            2,
        )
        summary["avg_return_pct"] = round(
            sum(all_returns) / len(all_returns)
            if all_returns
            else 0.0,
            2,
        )
        summary["net_return_pct"] = round(
            sum(all_returns) if all_returns else 0.0, 2
        )
        summary["avg_rr"] = round(
            sum(all_rrs) / len(all_rrs) if all_rrs else 0.0, 2
        )

        return summary

    def run_quick(
        self,
        ticker_count: int = 20,
        start_date: str = "2026-01-01",
        end_date: str = "2026-06-01",
    ) -> Dict[str, Any]:
        """
        Quick run: pick top `ticker_count` liquid EGX tickers (by avg volume
        from price_history.db, falling back to stocks.db) and run backtest
        over [start_date, end_date].

        Returns same dict as run_backtest.
        """
        tickers = self._get_top_liquid_tickers(ticker_count)
        print(
            f"[BacktestEngine] run_quick: {len(tickers)} tickers from "
            f"{start_date} to {end_date}"
        )
        if tickers:
            print(f"[BacktestEngine] Tickers: {', '.join(tickers)}")
        return self.run_backtest(tickers, start_date, end_date)

    # ------------------------------------------------------------------ #
    # Phase 7: A/B Testing
    # ------------------------------------------------------------------ #
    def _clear_backtest_results(self) -> None:
        """Delete ALL rows from backtest_results. Used by run_ab_test()
        when clear_existing=True so the A/B test starts fresh."""
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_clear_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.predictions_db_path, writable=True)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.predictions_db_path)
                _bt_clear_ctx = None
            conn.execute("DELETE FROM backtest_results")
            conn.commit()
            conn.close()
            print(
                "[BacktestEngine] _clear_backtest_results: all rows deleted."
            )
        except Exception as e:
            print(
                f"[BacktestEngine] _clear_backtest_results failed: {e}"
            )

    def run_ab_test(
        self,
        tickers: List[str],
        start_date: str,
        end_date: str,
        horizon_days: int = 30,
        clear_existing: bool = True,
    ) -> Dict[str, Any]:
        """
        Phase 7: A/B Testing — يُشغّل الـ backtest مرتين:
          1. control group (بدون دروس) — disable_lessons=True
          2. treatment group (مع الدروس) — disable_lessons=False

        يقارن النتائج لتحديد إذا كانت الدروس بتساعد أو بتضر.

        Args:
            tickers: List of ticker symbols to backtest in both groups.
            start_date: YYYY-MM-DD start (inclusive).
            end_date: YYYY-MM-DD end (inclusive).
            horizon_days: Forward window for outcome evaluation (default 30).
            clear_existing: If True, DELETE all rows from backtest_results
                before running (so the A/B test starts fresh). Default True.

        Returns:
            {
                'control': <summary without lessons>,
                'treatment': <summary with lessons>,
                'comparison': {
                    'win_rate_delta': treatment.win_rate - control.win_rate,
                    'avg_return_delta': treatment.avg_return - control.avg_return,
                    'net_return_delta': treatment.net_return - control.net_return,
                    'prediction_count_delta': treatment.total - control.total,
                    'verdict': 'lessons_help' | 'lessons_hurt' | 'neutral',
                }
            }
        """
        print("=" * 70)
        print("  Phase 7: A/B Testing — BacktestEngine.run_ab_test()")
        print(
            f"  tickers={len(tickers)} | {start_date} → {end_date} | "
            f"horizon={horizon_days}d | clear_existing={clear_existing}"
        )
        print("=" * 70)

        # Step 0: optionally clear the table.
        if clear_existing:
            self._clear_backtest_results()

        # Step 1: CONTROL group — run WITHOUT learned lessons.
        print("\n[A/B Test] Step 1/2 — CONTROL group (disable_lessons=True)")
        print("-" * 70)
        self._current_ab_group = "control"
        control_summary = self.run_backtest(
            tickers=tickers,
            start_date=start_date,
            end_date=end_date,
            horizon_days=horizon_days,
            disable_lessons=True,
        )

        # Step 2: TREATMENT group — run WITH learned lessons.
        print("\n[A/B Test] Step 2/2 — TREATMENT group (disable_lessons=False)")
        print("-" * 70)
        self._current_ab_group = "treatment"
        treatment_summary = self.run_backtest(
            tickers=tickers,
            start_date=start_date,
            end_date=end_date,
            horizon_days=horizon_days,
            disable_lessons=False,
        )

        # Step 3: reset ab_group to default for any subsequent runs.
        self._current_ab_group = "treatment"

        # Step 4: compute deltas (treatment − control).
        win_rate_delta = round(
            treatment_summary.get("win_rate_pct", 0.0)
            - control_summary.get("win_rate_pct", 0.0),
            2,
        )
        avg_return_delta = round(
            treatment_summary.get("avg_return_pct", 0.0)
            - control_summary.get("avg_return_pct", 0.0),
            2,
        )
        net_return_delta = round(
            treatment_summary.get("net_return_pct", 0.0)
            - control_summary.get("net_return_pct", 0.0),
            2,
        )
        prediction_count_delta = (
            treatment_summary.get("valid_signals", 0)
            - control_summary.get("valid_signals", 0)
        )

        # Step 5: verdict.
        if win_rate_delta > 2.0 and avg_return_delta > 0:
            verdict = "lessons_help"
        elif win_rate_delta < -2.0 or avg_return_delta < -0.5:
            verdict = "lessons_hurt"
        else:
            verdict = "neutral"

        comparison = {
            "win_rate_delta": win_rate_delta,
            "avg_return_delta": avg_return_delta,
            "net_return_delta": net_return_delta,
            "prediction_count_delta": prediction_count_delta,
            "verdict": verdict,
        }

        print("\n" + "=" * 70)
        print("  A/B Test — Comparison")
        print("=" * 70)
        print(
            f"  Control   (no lessons):   "
            f"win_rate={control_summary.get('win_rate_pct', 0.0)}%, "
            f"avg_return={control_summary.get('avg_return_pct', 0.0)}%, "
            f"net_return={control_summary.get('net_return_pct', 0.0)}%, "
            f"predictions={control_summary.get('valid_signals', 0)}"
        )
        print(
            f"  Treatment (with lessons): "
            f"win_rate={treatment_summary.get('win_rate_pct', 0.0)}%, "
            f"avg_return={treatment_summary.get('avg_return_pct', 0.0)}%, "
            f"net_return={treatment_summary.get('net_return_pct', 0.0)}%, "
            f"predictions={treatment_summary.get('valid_signals', 0)}"
        )
        print(
            f"  Delta: win_rate={win_rate_delta:+.2f}%, "
            f"avg_return={avg_return_delta:+.2f}%, "
            f"net_return={net_return_delta:+.2f}%, "
            f"predictions={prediction_count_delta:+d}"
        )
        verdict_emoji = {
            "lessons_help": "✅",
            "lessons_hurt": "❌",
            "neutral": "⚖️",
        }.get(verdict, "")
        print(f"  Verdict: {verdict} {verdict_emoji}")
        print("=" * 70)

        return {
            "control": control_summary,
            "treatment": treatment_summary,
            "comparison": comparison,
        }

    # ------------------------------------------------------------------ #
    # Read helpers
    # ------------------------------------------------------------------ #
    def get_results(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Read recent backtest_results rows (newest first)."""
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_gr_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.predictions_db_path, writable=False)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.predictions_db_path)
                _bt_gr_ctx = None
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM backtest_results
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows
        except Exception as e:
            print(f"[BacktestEngine] get_results failed: {e}")
            return []

    def get_summary(self) -> Dict[str, Any]:
        """
        Aggregate stats from all rows in backtest_results:
            total, by_outcome, win_rate_pct, avg_return_pct, avg_rr.
        """
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _bt_gs_ctx = None
            try:
                if _BT_ENGINE_DBM_AVAILABLE:
                    conn = _dbm.get_connection(self.predictions_db_path, writable=False)
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.predictions_db_path)
                _bt_gs_ctx = None
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM backtest_results")
            total = cursor.fetchone()[0]

            cursor.execute(
                "SELECT outcome, COUNT(*) FROM backtest_results "
                "GROUP BY outcome"
            )
            by_outcome = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.execute(
                "SELECT AVG(actual_return_pct) FROM backtest_results "
                "WHERE actual_return_pct IS NOT NULL"
            )
            avg_return = cursor.fetchone()[0] or 0.0

            cursor.execute(
                "SELECT AVG(rr_ratio) FROM backtest_results "
                "WHERE rr_ratio IS NOT NULL"
            )
            avg_rr = cursor.fetchone()[0] or 0.0

            cursor.execute(
                "SELECT AVG(master_score) FROM backtest_results "
                "WHERE master_score IS NOT NULL"
            )
            avg_master_score = cursor.fetchone()[0] or 0.0

            conn.close()

            target_hit = by_outcome.get("TARGET_HIT", 0)
            stopped = by_outcome.get("STOPPED", 0)
            expired = by_outcome.get("EXPIRED", 0)
            rejected = by_outcome.get("REJECTED_RR", 0)
            closed = target_hit + stopped
            win_rate = (
                (target_hit / closed * 100.0) if closed > 0 else 0.0
            )

            return {
                "total": total,
                "by_outcome": by_outcome,
                "target_hit": target_hit,
                "stopped": stopped,
                "expired": expired,
                "rejected_rr": rejected,
                "win_rate_pct": round(win_rate, 2),
                "avg_return_pct": round(avg_return, 2),
                "avg_rr": round(avg_rr, 2),
                "avg_master_score": round(avg_master_score, 2),
            }
        except Exception as e:
            print(f"[BacktestEngine] get_summary failed: {e}")
            return {}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="BacktestEngine — historical strategy verification"
    )
    parser.add_argument(
        "--tickers",
        type=int,
        default=20,
        help="Number of liquid tickers to test (default: 20)",
    )
    parser.add_argument(
        "--start",
        type=str,
        default="2026-01-01",
        help="Start date YYYY-MM-DD (default: 2026-01-01)",
    )
    parser.add_argument(
        "--end",
        type=str,
        default="2026-06-01",
        help="End date YYYY-MM-DD (default: 2026-06-01)",
    )
    args = parser.parse_args()

    engine = BacktestEngine()
    summary = engine.run_quick(
        ticker_count=args.tickers,
        start_date=args.start,
        end_date=args.end,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))
