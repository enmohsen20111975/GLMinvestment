"""
adapters/predictions_adapter.py — Read-only bridge to predictions.db.

Source: predictions.db.predictions table (1,361 predictions, 1,279 resolved).
This is the SSOT for historical V3/V40.2 decisions.

Read-only. NEVER writes to predictions.db.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_PREDICTIONS_DB = _PROJECT_ROOT / "db" / "predictions.db"

# All paths RELATIVE to PROJECT_ROOT — no absolute paths.
# Works on all 3 environments: sandbox, laptop, VPS.
_PREDICTIONS_DB_ALT_PATHS = [
    _PROJECT_ROOT / "db" / "predictions.db",  # standard (relative)
]

# Allow override via env var (for non-standard locations)
import os
_env_path = os.environ.get("PREDICTIONS_DB_PATH")
if _env_path:
    _PREDICTIONS_DB_ALT_PATHS.insert(0, Path(_env_path))


def _find_predictions_db() -> Path:
    """Find predictions.db. All paths relative to PROJECT_ROOT."""
    for p in _PREDICTIONS_DB_ALT_PATHS:
        try:
            if p.exists() and p.stat().st_size > 0:
                return p
        except (PermissionError, OSError):
            continue
    return _PREDICTIONS_DB  # default (will fail gracefully)


@dataclass
class HistoricalPrediction:
    """A historical prediction from V3/V40.2 (resolved or pending)."""
    id: int
    ticker: str
    signal: str  # STRONG_BUY, BUY, HOLD, SELL, etc.
    signal_type: str
    prediction_date: str
    entry_price: float
    target_price: Optional[float]
    stop_loss: Optional[float]
    master_score: Optional[float]
    technical_score: Optional[float]
    confidence: Optional[float]
    risk_reward: Optional[float]
    market: str
    # Outcome (NULL if pending)
    outcome_date: Optional[str]
    exit_price: Optional[float]
    actual_return: Optional[float]
    hit_target: int  # 0 or 1
    hit_stop: int  # 0 or 1
    holding_days: int
    exit_reason: Optional[str] = None


class PredictionsAdapter:
    """
    Read-only adapter for predictions.db.
    All reads use sqlite3 with mode=ro (read-only URI).
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or _find_predictions_db()

    def _connect(self) -> sqlite3.Connection:
        """Open read-only connection. Raises if DB not found."""
        if not self.db_path.exists():
            raise FileNotFoundError(
                f"predictions.db not found at {self.db_path}\n"
                f"Searched: {_PREDICTIONS_DB_ALT_PATHS}\n"
                f"Run on laptop/VPS where predictions.db exists, or "
                f"download from GitHub Releases."
            )
        return sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)

    def is_available(self) -> bool:
        """Check if predictions.db is available."""
        return self.db_path.exists()

    # ─── Query methods ─────────────────────────────────────────────────────

    def get_all_predictions(self, market: Optional[str] = None) -> List[HistoricalPrediction]:
        """Get all predictions (optionally filtered by market)."""
        conn = self._connect()
        cur = conn.cursor()
        if market:
            cur.execute(
                """SELECT id, ticker, signal, signal_type, prediction_date,
                          entry_price, target_price, stop_loss, master_score,
                          technical_score, confidence, risk_reward, market,
                          outcome_date, exit_price, actual_return,
                          hit_target, hit_stop, holding_days, exit_reason
                   FROM predictions WHERE market = ?
                   ORDER BY prediction_date ASC""",
                (market,)
            )
        else:
            cur.execute(
                """SELECT id, ticker, signal, signal_type, prediction_date,
                          entry_price, target_price, stop_loss, master_score,
                          technical_score, confidence, risk_reward, market,
                          outcome_date, exit_price, actual_return,
                          hit_target, hit_stop, holding_days, exit_reason
                   FROM predictions
                   ORDER BY prediction_date ASC"""
            )
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_prediction(r) for r in rows]

    def get_resolved_predictions(self, market: Optional[str] = None) -> List[HistoricalPrediction]:
        """
        Get only resolved predictions. Used for LABELS.
        Resolution = any of: outcome_date, closed_at, exit_type IS NOT NULL
        (different V3 versions use different columns)
        """
        conn = self._connect()
        cur = conn.cursor()

        # Build query — check multiple resolution columns
        resolution_check = (
            "(outcome_date IS NOT NULL "
            "OR closed_at IS NOT NULL "
            "OR exit_type IS NOT NULL "
            "OR pnl_pct IS NOT NULL)"
        )

        query = f"""
            SELECT id, ticker, signal, signal_type, prediction_date,
                   entry_price, target_price, stop_loss, master_score,
                   technical_score, confidence, risk_reward, market,
                   outcome_date, exit_price, actual_return,
                   hit_target, hit_stop, holding_days, exit_reason,
                   closed_at, exit_type, pnl_pct, actual_exit_price
            FROM predictions
            WHERE {resolution_check}
        """
        if market:
            query += " AND market = ?"
            cur.execute(query + " ORDER BY prediction_date ASC", (market,))
        else:
            cur.execute(query + " ORDER BY prediction_date ASC")

        rows = cur.fetchall()
        conn.close()
        return [self._row_to_prediction(r) for r in rows]

    def get_predictions_for_ticker(self, ticker: str) -> List[HistoricalPrediction]:
        """Get all predictions for a specific ticker."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, ticker, signal, signal_type, prediction_date,
                      entry_price, target_price, stop_loss, master_score,
                      technical_score, confidence, risk_reward, market,
                      outcome_date, exit_price, actual_return,
                      hit_target, hit_stop, holding_days, exit_reason
               FROM predictions WHERE ticker = ?
               ORDER BY prediction_date ASC""",
            (ticker,)
        )
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_prediction(r) for r in rows]

    def get_prediction_by_id(self, prediction_id: int) -> Optional[HistoricalPrediction]:
        """Get a single prediction by ID."""
        conn = self._connect()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, ticker, signal, signal_type, prediction_date,
                      entry_price, target_price, stop_loss, master_score,
                      technical_score, confidence, risk_reward, market,
                      outcome_date, exit_price, actual_return,
                      hit_target, hit_stop, holding_days, exit_reason
               FROM predictions WHERE id = ?""",
            (prediction_id,)
        )
        row = cur.fetchone()
        conn.close()
        return self._row_to_prediction(row) if row else None

    # ─── v0.1.1: Engine version + consistency checks (Section 6) ───────────

    def get_engine_version_distribution(self) -> Dict[str, int]:
        """
        v0.1.1: Detect engine version distribution in predictions.db.
        V3: persona='balanced' (post-2026-10-28)
        V40.2: persona='v3_smart' or older + INSTITUTIONAL_BUY signals
        """
        conn = self._connect()
        cur = conn.cursor()

        # Check if persona column exists
        cur.execute("PRAGMA table_info(predictions)")
        cols = [r[1] for r in cur.fetchall()]

        distribution: Dict[str, int] = {}

        if "persona" in cols:
            cur.execute("SELECT persona, COUNT(*) FROM predictions GROUP BY persona ORDER BY COUNT(*) DESC")
            for r in cur.fetchall():
                persona = r[0] or "null"
                if persona == "balanced":
                    distribution["V3"] = r[1]
                elif persona == "v3_smart":
                    distribution["V40.2"] = r[1]
                else:
                    distribution[f"unknown({persona})"] = r[1]
        else:
            # No persona column — use signal + date heuristics
            cur.execute("SELECT signal, COUNT(*) FROM predictions GROUP BY signal")
            for r in cur.fetchall():
                if r[0] == "INSTITUTIONAL_BUY":
                    distribution["V40.2 (INSTITUTIONAL_BUY)"] = r[1]

            cur.execute(
                """SELECT COUNT(*) FROM predictions
                   WHERE prediction_date >= '2026-10-28'"""
            )
            v3_count = cur.fetchone()[0]
            cur.execute(
                """SELECT COUNT(*) FROM predictions
                   WHERE prediction_date < '2026-10-28' AND signal != 'INSTITUTIONAL_BUY'"""
            )
            v402_count = cur.fetchone()[0]
            distribution["V3 (post-2026-10-28)"] = v3_count
            distribution["V40.2 (pre-2026-10-28)"] = v402_count

        conn.close()
        return distribution

    def validate_prediction_consistency(self, pred: HistoricalPrediction) -> List[str]:
        """
        v0.1.1: Validate that a prediction is consistent.
        Returns list of issues (empty = valid).
        """
        issues = []

        # Check entry_price is positive
        if pred.entry_price <= 0:
            issues.append("INVALID_ENTRY_PRICE: entry_price <= 0")

        # Check prediction_date format
        try:
            datetime.strptime(pred.prediction_date[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            issues.append("INVALID_PREDICTION_DATE_FORMAT")

        # Check outcome consistency (if resolved)
        if pred.outcome_date:
            try:
                pred_dt = datetime.strptime(pred.prediction_date[:10], "%Y-%m-%d")
                out_dt = datetime.strptime(pred.outcome_date[:10], "%Y-%m-%d")
                if out_dt < pred_dt:
                    issues.append("OUTCOME_BEFORE_PREDICTION: outcome_date < prediction_date")
            except (ValueError, TypeError):
                issues.append("INVALID_OUTCOME_DATE_FORMAT")

            # Check hit_target + hit_stop mutual exclusivity (v0.1.1)
            if pred.hit_target == 1 and pred.hit_stop == 1:
                issues.append("BOTH_TARGET_AND_STOP_HIT: ambiguous outcome")

        # Check target/stop direction consistency
        if pred.target_price and pred.stop_loss and pred.entry_price > 0:
            if pred.signal in ("BUY", "STRONG_BUY", "ACCUMULATE", "INSTITUTIONAL_BUY"):
                # Long: target > entry > stop
                if not (pred.target_price > pred.entry_price > pred.stop_loss):
                    issues.append("INVALID_LONG_SETUP: target/entry/stop order wrong")
            elif pred.signal in ("SELL", "STRONG_SELL", "REDUCE"):
                # Short: stop > entry > target
                if not (pred.stop_loss > pred.entry_price > pred.target_price):
                    issues.append("INVALID_SHORT_SETUP: target/entry/stop order wrong")

        return issues

    def get_resolved_predictions_filtered(
        self,
        market: Optional[str] = None,
        engine_version: Optional[str] = None,
        skip_inconsistent: bool = True,
    ) -> List[HistoricalPrediction]:
        """
        v0.1.1: Get resolved predictions with consistency filtering.
        - skip_inconsistent: drop predictions with consistency issues
        - engine_version: filter by detected version ('V3' or 'V40.2')
        """
        preds = self.get_resolved_predictions(market=market)
        filtered = []

        for pred in preds:
            # Engine version filter
            if engine_version:
                pred_version = self._detect_version(pred)
                if pred_version != engine_version:
                    continue

            # Consistency check
            if skip_inconsistent:
                issues = self.validate_prediction_consistency(pred)
                if issues:
                    continue

            filtered.append(pred)

        return filtered

    def _detect_version(self, pred: HistoricalPrediction) -> str:
        """Detect engine version for a single prediction."""
        if pred.signal == "INSTITUTIONAL_BUY":
            return "V40.2"
        if pred.prediction_date >= "2026-10-28":
            return "V3"
        return "V40.2_or_earlier"

    # ─── Stats ─────────────────────────────────────────────────────────────

    def get_stats(self) -> Dict:
        """Get summary stats for predictions."""
        conn = self._connect()
        cur = conn.cursor()
        stats = {}
        cur.execute("SELECT COUNT(*) FROM predictions")
        stats["total"] = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
        stats["resolved"] = cur.fetchone()[0]
        cur.execute("SELECT MIN(prediction_date), MAX(prediction_date) FROM predictions")
        r = cur.fetchone()
        stats["date_range"] = (r[0], r[1]) if r else (None, None)
        cur.execute(
            """SELECT market, COUNT(*) FROM predictions
               GROUP BY market ORDER BY COUNT(*) DESC"""
        )
        stats["by_market"] = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute(
            """SELECT signal, COUNT(*) FROM predictions
               WHERE outcome_date IS NOT NULL
               GROUP BY signal ORDER BY COUNT(*) DESC"""
        )
        stats["by_signal"] = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute(
            """SELECT
                 SUM(hit_target) as targets,
                 SUM(hit_stop) as stops,
                 SUM(CASE WHEN hit_target=0 AND hit_stop=0 THEN 1 ELSE 0 END) as neither
               FROM predictions WHERE outcome_date IS NOT NULL"""
        )
        r = cur.fetchone()
        stats["outcomes"] = {"targets": r[0] or 0, "stops": r[1] or 0, "neither": r[2] or 0}
        conn.close()
        return stats

    # ─── Helpers ───────────────────────────────────────────────────────────

    def _row_to_prediction(self, row) -> HistoricalPrediction:
        """Convert DB row to HistoricalPrediction. Handles variable column count."""
        # row indices: 0-19 = standard, 20+ = V3 extra columns
        outcome_date = row[13] if len(row) > 13 else None
        exit_price = row[14] if len(row) > 14 else None
        actual_return = row[15] if len(row) > 15 else None

        # V3 uses alternative columns for resolution
        if outcome_date is None and len(row) > 20:
            closed_at = row[20] if len(row) > 20 else None
            exit_type = row[21] if len(row) > 21 else None
            pnl_pct = row[22] if len(row) > 22 else None
            actual_exit = row[23] if len(row) > 23 else None

            # If closed_at exists, use it as outcome_date
            if closed_at:
                outcome_date = str(closed_at)[:10] if closed_at else None
            # If pnl_pct exists, use it as actual_return
            if actual_return is None and pnl_pct is not None:
                actual_return = float(pnl_pct)
            # If actual_exit_price exists, use it as exit_price
            if exit_price is None and actual_exit is not None:
                exit_price = float(actual_exit)

        # Determine hit_target / hit_stop from exit_type if columns are NULL
        hit_target = row[16] or 0 if len(row) > 16 else 0
        hit_stop = row[17] or 0 if len(row) > 17 else 0

        if len(row) > 21 and row[21]:  # exit_type
            exit_type_str = str(row[21]).lower()
            if 'target' in exit_type_str and hit_target == 0:
                hit_target = 1
            if 'stop' in exit_type_str and hit_stop == 0:
                hit_stop = 1

        exit_reason = row[19] if len(row) > 19 else None
        if not exit_reason and len(row) > 21 and row[21]:
            exit_reason = str(row[21])  # use exit_type as exit_reason

        return HistoricalPrediction(
            id=row[0],
            ticker=row[1],
            signal=row[2],
            signal_type=row[3],
            prediction_date=str(row[4]) if row[4] else "",
            entry_price=float(row[5]) if row[5] else 0.0,
            target_price=float(row[6]) if row[6] else None,
            stop_loss=float(row[7]) if row[7] else None,
            master_score=float(row[8]) if row[8] is not None else None,
            technical_score=float(row[9]) if row[9] is not None else None,
            confidence=float(row[10]) if row[10] is not None else None,
            risk_reward=float(row[11]) if row[11] is not None else None,
            market=row[12] or "EGX",
            outcome_date=str(outcome_date)[:10] if outcome_date else None,
            exit_price=float(exit_price) if exit_price is not None else None,
            actual_return=float(actual_return) if actual_return is not None else None,
            hit_target=hit_target,
            hit_stop=hit_stop,
            holding_days=row[18] or 0 if len(row) > 18 else 0,
            exit_reason=exit_reason,
        )
