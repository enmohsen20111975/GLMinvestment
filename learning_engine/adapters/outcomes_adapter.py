"""
adapters/outcomes_adapter.py — Read-only bridge to resolved prediction outcomes.

Source: predictions.db.predictions (rows where outcome_date IS NOT NULL).
This is the SSOT for LABELS (what actually happened).

Label extraction logic lives in learning_engine/labels/ — NOT here.
This adapter only fetches raw outcome data.
"""
from __future__ import annotations
from typing import List, Dict, Optional
from dataclasses import dataclass
from .predictions_adapter import PredictionsAdapter, HistoricalPrediction


@dataclass
class OutcomeRecord:
    """A resolved prediction with its outcome."""
    prediction_id: int
    ticker: str
    market: str
    prediction_date: str
    outcome_date: str
    entry_price: float
    target_price: Optional[float]
    stop_loss: Optional[float]
    exit_price: Optional[float]
    actual_return: Optional[float]  # percentage
    hit_target: int
    hit_stop: int
    holding_days: int
    exit_reason: Optional[str]
    signal: str
    master_score: Optional[float]
    confidence: Optional[float]


class OutcomesAdapter:
    """
    Read-only adapter for resolved outcomes.
    Wraps PredictionsAdapter to expose only resolved predictions.
    """

    def __init__(self, predictions_adapter: Optional[PredictionsAdapter] = None):
        self._pred_adapter = predictions_adapter or PredictionsAdapter()

    def get_all_outcomes(self, market: Optional[str] = None) -> List[OutcomeRecord]:
        """Get all resolved outcomes (optionally filtered by market)."""
        preds = self._pred_adapter.get_resolved_predictions(market=market)
        return [self._pred_to_outcome(p) for p in preds]

    def get_outcomes_for_ticker(self, ticker: str) -> List[OutcomeRecord]:
        """Get all resolved outcomes for a ticker."""
        preds = self._pred_adapter.get_predictions_for_ticker(ticker)
        resolved = [p for p in preds if p.outcome_date is not None]
        return [self._pred_to_outcome(p) for p in resolved]

    def get_outcomes_in_range(
        self, start_date: str, end_date: str, market: Optional[str] = None
    ) -> List[OutcomeRecord]:
        """Get resolved outcomes in a date range (by prediction_date)."""
        all_outcomes = self.get_all_outcomes(market=market)
        return [
            o for o in all_outcomes
            if start_date <= o.prediction_date <= end_date
        ]

    def get_outcome_stats(self) -> Dict:
        """Summary stats for outcomes (for labels analysis)."""
        outcomes = self.get_all_outcomes()
        if not outcomes:
            return {"total": 0}

        total = len(outcomes)
        targets = sum(1 for o in outcomes if o.hit_target)
        stops = sum(1 for o in outcomes if o.hit_stop)
        neither = total - targets - stops

        returns = [o.actual_return for o in outcomes if o.actual_return is not None]
        avg_return = sum(returns) / len(returns) if returns else 0.0
        win_count = sum(1 for r in returns if r > 0)
        loss_count = sum(1 for r in returns if r < 0)

        return {
            "total": total,
            "hit_target": targets,
            "hit_stop": stops,
            "neither": neither,
            "target_rate": targets / total if total else 0,
            "stop_rate": stops / total if total else 0,
            "avg_return": avg_return,
            "win_count": win_count,
            "loss_count": loss_count,
            "win_rate": win_count / total if total else 0,
            "by_market": self._group_by(outcomes, "market"),
            "by_signal": self._group_by(outcomes, "signal"),
        }

    def _pred_to_outcome(self, p: HistoricalPrediction) -> OutcomeRecord:
        return OutcomeRecord(
            prediction_id=p.id,
            ticker=p.ticker,
            market=p.market,
            prediction_date=p.prediction_date,
            outcome_date=p.outcome_date,
            entry_price=p.entry_price,
            target_price=p.target_price,
            stop_loss=p.stop_loss,
            exit_price=p.exit_price,
            actual_return=p.actual_return,
            hit_target=p.hit_target,
            hit_stop=p.hit_stop,
            holding_days=p.holding_days,
            exit_reason=p.exit_reason,
            signal=p.signal,
            master_score=p.master_score,
            confidence=p.confidence,
        )

    def _group_by(self, outcomes: List[OutcomeRecord], key: str) -> Dict:
        groups: Dict[str, int] = {}
        for o in outcomes:
            k = getattr(o, key, "unknown")
            groups[k] = groups.get(k, 0) + 1
        return groups
