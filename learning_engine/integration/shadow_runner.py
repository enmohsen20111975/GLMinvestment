"""
integration/shadow_runner.py — Shadow Mode runner.

Runs ML inference in PARALLEL with V3 engine.
NEVER modifies V3 decisions. NEVER blocks V3 execution.
Writes shadow predictions to isolated learning.db.

If shadow_runner crashes, V3 continues unaffected (Section 15).
"""
from __future__ import annotations
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict
from pathlib import Path
from datetime import datetime
import sqlite3
import json
import traceback

from ..adapters.predictions_adapter import PredictionsAdapter, HistoricalPrediction
from ..features.feature_builder import FeatureBuilder, FeatureVector
from ..registry.model_registry import ModelRegistry
from ..models.direction_model import DirectionModel
from ..config.settings import LearningSettings


@dataclass
class ShadowPrediction:
    """A shadow prediction (parallel to V3, not affecting it)."""
    prediction_id: int  # links to V3 prediction
    ticker: str
    market: str
    prediction_date: str
    model_id: str
    label_type: str
    horizon: int
    ml_probability: float  # model output
    ml_signal: str  # derived from probability
    v3_signal: str  # original V3 signal (for comparison)
    agreement: bool  # does ML agree with V3?
    feature_schema_version: str
    model_version: str
    shadow_timestamp: str


class ShadowRunner:
    """
    Runs ML inference in shadow mode.
    Reads V3 predictions → builds features → runs ML → writes shadow result.
    V3 is NEVER modified.
    """

    def __init__(
        self,
        settings: Optional[LearningSettings] = None,
        feature_builder: Optional[FeatureBuilder] = None,
        registry: Optional[ModelRegistry] = None,
    ):
        self._settings = settings or LearningSettings()
        self._feature_builder = feature_builder or FeatureBuilder()
        self._registry = registry or ModelRegistry(settings=self._settings)
        self._learning_db = self._settings.learning_db
        self._init_learning_db()

    def _init_learning_db(self):
        """Initialize learning.db with shadow_predictions table (if not exists)."""
        self._learning_db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._learning_db))
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shadow_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prediction_id INTEGER NOT NULL,
                ticker TEXT NOT NULL,
                market TEXT,
                prediction_date TEXT,
                model_id TEXT,
                label_type TEXT,
                horizon INTEGER,
                ml_probability REAL,
                ml_signal TEXT,
                v3_signal TEXT,
                agreement INTEGER,
                feature_schema_version TEXT,
                model_version TEXT,
                shadow_timestamp TEXT,
                UNIQUE(prediction_id, model_id)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_shadow_pred_date
            ON shadow_predictions(prediction_date)
        """)
        conn.commit()
        conn.close()

    def run_shadow_for_prediction(
        self, prediction: HistoricalPrediction
    ) -> Optional[ShadowPrediction]:
        """
        Run ML inference for a single V3 prediction.
        Returns shadow prediction (does NOT modify V3).
        """
        if not self._settings.shadow_mode:
            return None

        # 1. Get active direction model
        active_model_entry = self._registry.get_active(
            label_type="direction", horizon=5
        )
        if not active_model_entry:
            return None  # no model available — V3 continues alone

        # 2. Load model
        model = DirectionModel(horizon=5)
        try:
            model.load(Path(active_model_entry.artifact_path))
        except Exception:
            return None

        # 3. Check schema compatibility
        if not model.is_compatible_schema(self._feature_builder._schema.version()):
            return None  # schema mismatch — skip (safety)

        # 4. Build features (point-in-time)
        try:
            fv = self._feature_builder.build_for_prediction(prediction)
            if not fv or len(fv.features) < 5:
                return None
        except Exception:
            return None  # feature build failed — V3 continues

        # 5. Run inference
        try:
            feature_row = [fv.features.get(fn, 0.0) for fn in model._feature_names]
            probabilities = model.predict([feature_row])
            ml_prob = probabilities[0] if probabilities else 0.5
        except Exception:
            return None  # inference failed — V3 continues

        # 6. Derive ML signal
        if ml_prob >= 0.65:
            ml_signal = "BUY"
        elif ml_prob <= 0.35:
            ml_signal = "SELL"
        else:
            ml_signal = "HOLD"

        # 7. Compare with V3
        v3_signal = prediction.signal
        agreement = self._signals_agree(ml_signal, v3_signal)

        shadow = ShadowPrediction(
            prediction_id=prediction.id,
            ticker=prediction.ticker,
            market=prediction.market,
            prediction_date=prediction.prediction_date,
            model_id=active_model_entry.model_id,
            label_type="direction",
            horizon=5,
            ml_probability=ml_prob,
            ml_signal=ml_signal,
            v3_signal=v3_signal,
            agreement=agreement,
            feature_schema_version=fv.feature_schema_version,
            model_version=active_model_entry.version,
            shadow_timestamp=datetime.now().isoformat(),
        )

        # 8. Write to learning.db (NOT predictions.db)
        self._save_shadow(shadow)

        return shadow

    def _signals_agree(self, ml_signal: str, v3_signal: str) -> bool:
        """Check if ML and V3 agree on direction."""
        bullish = {"BUY", "STRONG_BUY", "ACCUMULATE", "INSTITUTIONAL_BUY"}
        bearish = {"SELL", "STRONG_SELL", "REDUCE"}
        ml_bull = ml_signal in bullish
        ml_bear = ml_signal in bearish
        v3_bull = v3_signal in bullish
        v3_bear = v3_signal in bearish
        if ml_bull and v3_bull:
            return True
        if ml_bear and v3_bear:
            return True
        return False

    def _save_shadow(self, shadow: ShadowPrediction):
        """Save shadow prediction to learning.db (atomic upsert)."""
        conn = sqlite3.connect(str(self._learning_db))
        cur = conn.cursor()
        cur.execute("""
            INSERT OR REPLACE INTO shadow_predictions
            (prediction_id, ticker, market, prediction_date, model_id,
             label_type, horizon, ml_probability, ml_signal, v3_signal,
             agreement, feature_schema_version, model_version, shadow_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            shadow.prediction_id, shadow.ticker, shadow.market,
            shadow.prediction_date, shadow.model_id, shadow.label_type,
            shadow.horizon, shadow.ml_probability, shadow.ml_signal,
            shadow.v3_signal, int(shadow.agreement),
            shadow.feature_schema_version, shadow.model_version,
            shadow.shadow_timestamp,
        ))
        conn.commit()
        conn.close()

    def get_shadow_stats(self) -> Dict:
        """Get aggregate stats for shadow predictions."""
        if not self._learning_db.exists():
            return {"total": 0}
        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM shadow_predictions")
        total = cur.fetchone()[0]
        cur.execute("SELECT SUM(agreement) FROM shadow_predictions")
        agree = cur.fetchone()[0] or 0
        cur.execute("""
            SELECT v3_signal, ml_signal, COUNT(*)
            FROM shadow_predictions GROUP BY v3_signal, ml_signal
        """)
        matrix = {f"{r[0]}→{r[1]}": r[2] for r in cur.fetchall()}
        conn.close()
        return {
            "total": total,
            "agreement_count": agree,
            "agreement_rate": agree / total if total else 0,
            "signal_matrix": matrix,
        }
