"""
adapters/engine_adapter.py — Read-only bridge to V3 engine state.

Reads historical engine outputs from predictions.db (NOT real-time).
Does NOT import orchestrator_v3 or executor_v3 (to avoid coupling).
Does NOT re-run engines — only reads what was already computed.

For real-time shadow inference, see integration/shadow_runner.py.
"""
from __future__ import annotations
from typing import Dict, Optional
from .predictions_adapter import PredictionsAdapter, HistoricalPrediction


class EngineAdapter:
    """
    Read-only adapter for V3 engine outputs.
    Reads from predictions.db (historical decisions).
    NEVER re-runs engines. NEVER modifies engine state.
    """

    def __init__(self, predictions_adapter: Optional[PredictionsAdapter] = None):
        self._pred_adapter = predictions_adapter or PredictionsAdapter()

    def get_engine_features_for_prediction(self, prediction_id: int) -> Optional[Dict]:
        """
        Get engine-level features for a historical prediction.
        These are READ from predictions.db, NOT recomputed.

        Returns dict with:
          - engine_master_score (0-100)
          - engine_technical_score (0-100)
          - engine_signal_type (STRONG_BUY/BUY/HOLD/SELL/etc.)
          - engine_confidence (0-100)
          - engine_risk_reward (float)
        """
        pred = self._pred_adapter.get_prediction_by_id(prediction_id)
        if not pred:
            return None

        return {
            "engine_master_score": pred.master_score,
            "engine_technical_score": pred.technical_score,
            "engine_signal_type": pred.signal,
            "engine_confidence": pred.confidence,
            "engine_risk_reward": pred.risk_reward,
            # Provenance
            "source": "predictions.db.predictions",
            "prediction_id": prediction_id,
            "prediction_date": pred.prediction_date,
            "ticker": pred.ticker,
            "market": pred.market,
            "entry_price": pred.entry_price,
            "target_price": pred.target_price,
            "stop_loss": pred.stop_loss,
        }

    def get_engine_version(self) -> str:
        """
        Detect which engine version produced the predictions.
        V3: persona='balanced' (post-2026-10-28)
        V40.2: persona='v3_smart' or older (pre-2026-10-28)
        """
        # Read persona distribution from predictions.db
        import sqlite3
        from pathlib import Path
        db_path = Path(__file__).resolve().parents[2] / "db" / "predictions.db"
        if not db_path.exists():
            return "unknown"
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cur = conn.cursor()
            # Check if persona column exists
            cur.execute("PRAGMA table_info(predictions)")
            cols = [r[1] for r in cur.fetchall()]
            if "persona" not in cols:
                conn.close()
                return "unknown (no persona column)"
            cur.execute(
                """SELECT persona, COUNT(*) FROM predictions
                   GROUP BY persona ORDER BY COUNT(*) DESC LIMIT 3"""
            )
            personas = cur.fetchall()
            conn.close()
            if not personas:
                return "unknown (no predictions)"
            return f"mixed: {', '.join(f'{p[0]}={p[1]}' for p in personas)}"
        except Exception as e:
            return f"error: {e}"

    def get_signal_distribution(self) -> Dict[str, int]:
        """Get distribution of signal types in historical predictions."""
        stats = self._pred_adapter.get_stats()
        return stats.get("by_signal", {})
