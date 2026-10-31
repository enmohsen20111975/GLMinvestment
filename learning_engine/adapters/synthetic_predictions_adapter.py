"""
adapters/synthetic_predictions_adapter.py — Read synthetic predictions from learning.db.

Used when predictions.db (production) has no resolved predictions.
Reads from learning.db.synthetic_predictions instead.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import List, Optional
from dataclasses import dataclass

from .predictions_adapter import HistoricalPrediction, PredictionsAdapter


class SyntheticPredictionsAdapter(PredictionsAdapter):
    """
    Reads synthetic predictions from learning.db.synthetic_predictions.
    Same interface as PredictionsAdapter — drop-in replacement.
    """

    def __init__(self, learning_db_path: Optional[Path] = None):
        from ..config.settings import LearningSettings
        settings = LearningSettings()
        self.db_path = learning_db_path or settings.learning_db

    def _connect(self) -> sqlite3.Connection:
        if not self.db_path.exists():
            raise FileNotFoundError(f"learning.db not found at {self.db_path}")
        return sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)

    def is_available(self) -> bool:
        if not self.db_path.exists():
            return False
        try:
            conn = self._connect()
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM synthetic_predictions LIMIT 1")
            count = cur.fetchone()[0]
            conn.close()
            return count > 0
        except Exception:
            return False

    def get_all_predictions(self, market: Optional[str] = None) -> List[HistoricalPrediction]:
        return self.get_resolved_predictions(market=market)

    def get_resolved_predictions(self, market: Optional[str] = None) -> List[HistoricalPrediction]:
        """Get all synthetic predictions (all are resolved by design)."""
        if not self.db_path.exists():
            return []

        conn = self._connect()
        cur = conn.cursor()

        if market:
            cur.execute("""
                SELECT ticker, market, prediction_date, signal, entry_price,
                       target_price, stop_loss, master_score, technical_score,
                       confidence, risk_reward, market,
                       outcome_date, exit_price, actual_return,
                       hit_target, hit_stop, holding_days, exit_type
                FROM synthetic_predictions
                WHERE market = ?
                ORDER BY prediction_date ASC
            """, (market,))
        else:
            cur.execute("""
                SELECT ticker, market, prediction_date, signal, entry_price,
                       target_price, stop_loss, master_score, technical_score,
                       confidence, risk_reward, market,
                       outcome_date, exit_price, actual_return,
                       hit_target, hit_stop, holding_days, exit_type
                FROM synthetic_predictions
                ORDER BY prediction_date ASC
            """)

        rows = cur.fetchall()
        conn.close()

        predictions = []
        for row in rows:
            predictions.append(HistoricalPrediction(
                id=0,  # synthetic — no real ID
                ticker=row[0],
                signal=row[3],
                signal_type=row[3],
                prediction_date=str(row[2]) if row[2] else "",
                entry_price=float(row[4]) if row[4] else 0.0,
                target_price=float(row[5]) if row[5] is not None else None,
                stop_loss=float(row[6]) if row[6] is not None else None,
                master_score=float(row[7]) if row[7] is not None else None,
                technical_score=float(row[8]) if row[8] is not None else None,
                confidence=float(row[9]) if row[9] is not None else None,
                risk_reward=float(row[10]) if row[10] is not None else None,
                market=row[11] or "EGX",
                outcome_date=str(row[12])[:10] if row[12] else None,
                exit_price=float(row[13]) if row[13] is not None else None,
                actual_return=float(row[14]) if row[14] is not None else None,
                hit_target=row[15] or 0,
                hit_stop=row[16] or 0,
                holding_days=row[17] or 0,
                exit_reason=str(row[18]) if row[18] else None,
            ))

        return predictions

    def get_prediction_by_id(self, prediction_id: int) -> Optional[HistoricalPrediction]:
        return None  # synthetic predictions don't have IDs

    def get_predictions_for_ticker(self, ticker: str) -> List[HistoricalPrediction]:
        if not self.db_path.exists():
            return []
        conn = self._connect()
        cur = conn.cursor()
        cur.execute("""
            SELECT ticker, market, prediction_date, signal, entry_price,
                   target_price, stop_loss, master_score, technical_score,
                   confidence, risk_reward, market,
                   outcome_date, exit_price, actual_return,
                   hit_target, hit_stop, holding_days, exit_type
            FROM synthetic_predictions
            WHERE ticker = ?
            ORDER BY prediction_date ASC
        """, (ticker,))
        rows = cur.fetchall()
        conn.close()
        return [self._row_to_synth(r) for r in rows]

    def _row_to_synth(self, row) -> HistoricalPrediction:
        return HistoricalPrediction(
            id=0,
            ticker=row[0],
            signal=row[3],
            signal_type=row[3],
            prediction_date=str(row[2]) if row[2] else "",
            entry_price=float(row[4]) if row[4] else 0.0,
            target_price=float(row[5]) if row[5] is not None else None,
            stop_loss=float(row[6]) if row[6] is not None else None,
            master_score=float(row[7]) if row[7] is not None else None,
            technical_score=float(row[8]) if row[8] is not None else None,
            confidence=float(row[9]) if row[9] is not None else None,
            risk_reward=float(row[10]) if row[10] is not None else None,
            market=row[11] or "EGX",
            outcome_date=str(row[12])[:10] if row[12] else None,
            exit_price=float(row[13]) if row[13] is not None else None,
            actual_return=float(row[14]) if row[14] is not None else None,
            hit_target=row[15] or 0,
            hit_stop=row[16] or 0,
            holding_days=row[17] or 0,
            exit_reason=str(row[18]) if row[18] else None,
        )

    def get_stats(self) -> dict:
        if not self.db_path.exists():
            return {"total": 0}
        conn = self._connect()
        cur = conn.cursor()
        stats = {}
        cur.execute("SELECT COUNT(*) FROM synthetic_predictions")
        stats["total"] = cur.fetchone()[0]
        cur.execute("SELECT market, COUNT(*) FROM synthetic_predictions GROUP BY market")
        stats["by_market"] = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute("SELECT signal, COUNT(*) FROM synthetic_predictions GROUP BY signal")
        stats["by_signal"] = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute("SELECT SUM(hit_target), SUM(hit_stop) FROM synthetic_predictions")
        r = cur.fetchone()
        stats["targets"] = r[0] or 0
        stats["stops"] = r[1] or 0
        conn.close()
        return stats
