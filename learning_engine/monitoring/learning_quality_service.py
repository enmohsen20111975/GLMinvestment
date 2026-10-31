"""
monitoring/learning_quality_service.py — Learning Quality Center (Phase G).

Monitors learning quality SEPARATELY from data quality + business quality.

Per owner directive (Section G):
  - Dataset sample counts
  - Feature completeness
  - Label distribution
  - Model training history
  - Walk-forward metrics
  - Calibration
  - Performance by market
  - Performance by regime
  - Performance by liquidity
  - Model drift
  - Feature drift
  - Shadow predictions vs actual outcomes

Does NOT present training accuracy as proof of real-world trading quality.
Three separate quality dimensions:
  1. Data Quality (is data sound?) → data_quality_service.py
  2. Learning Quality (is model learning reliably?)
  3. Business/Trading Quality (do decisions make money?) → future

Read-only. Reads from learning.db + predictions.db.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

from ..config.settings import LearningSettings
from ..registry.model_registry import ModelRegistry


@dataclass
class ModelMetrics:
    """Per-model quality metrics."""
    model_id: str
    label_type: str
    horizon: int
    status: str
    sample_count: int
    folds_run: int
    avg_accuracy: float
    avg_f1: float
    avg_auc: float
    avg_brier: float
    std_accuracy: float
    training_period: tuple
    evaluation_period: Optional[tuple]
    last_updated: str


class LearningQualityService:
    """
    Learning Quality Center.
    Reads from learning.db + predictions.db (read-only).
    """

    def __init__(
        self,
        settings: Optional[LearningSettings] = None,
        registry: Optional[ModelRegistry] = None,
    ):
        self._settings = settings or LearningSettings()
        self._registry = registry or ModelRegistry(settings=self._settings)
        self._learning_db = self._settings.learning_db
        self._predictions_db = self._settings.predictions_db

    # ─── Dataset quality ───────────────────────────────────────────────────

    def get_dataset_quality(self) -> Dict:
        """Get dataset sample counts + label distribution."""
        # Read from predictions.db (read-only)
        if not self._predictions_db.exists():
            return {"error": "predictions.db not found"}

        conn = sqlite3.connect(f"file:{self._predictions_db}?mode=ro", uri=True)
        cur = conn.cursor()

        # Total + resolved predictions
        cur.execute("SELECT COUNT(*) FROM predictions")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
        resolved = cur.fetchone()[0]

        # Label distribution (resolved)
        cur.execute("""
            SELECT signal, COUNT(*),
                   SUM(hit_target), SUM(hit_stop)
            FROM predictions WHERE outcome_date IS NOT NULL
            GROUP BY signal ORDER BY COUNT(*) DESC
        """)
        label_dist = {}
        for r in cur.fetchall():
            wins = r[2] or 0
            losses = r[3] or 0
            total_outcomes = wins + losses
            wr = wins * 100 / total_outcomes if total_outcomes > 0 else 0
            label_dist[r[0]] = {
                "count": r[1],
                "wins": wins,
                "losses": losses,
                "win_rate": round(wr, 1),
            }

        # By market
        cur.execute("""
            SELECT market, COUNT(*) FROM predictions
            WHERE outcome_date IS NOT NULL
            GROUP BY market ORDER BY COUNT(*) DESC
        """)
        by_market = {r[0]: r[1] for r in cur.fetchall()}

        # Date range
        cur.execute("""
            SELECT MIN(prediction_date), MAX(prediction_date)
            FROM predictions WHERE outcome_date IS NOT NULL
        """)
        r = cur.fetchone()
        date_range = (str(r[0])[:10] if r[0] else None, str(r[1])[:10] if r[1] else None)

        conn.close()

        return {
            "total_predictions": total,
            "resolved": resolved,
            "resolution_rate": round(resolved / total * 100, 1) if total else 0,
            "label_distribution": label_dist,
            "by_market": by_market,
            "date_range": date_range,
        }

    # ─── Model quality ─────────────────────────────────────────────────────

    def get_model_quality(self) -> List[ModelMetrics]:
        """Get quality metrics for all registered models."""
        models = self._registry.list_models()
        results = []

        for m in models:
            meta = m.metadata or {}
            eval_metrics = meta.get("evaluation_metrics", {})

            results.append(ModelMetrics(
                model_id=m.model_id,
                label_type=m.label_type,
                horizon=m.horizon,
                status=m.status,
                sample_count=meta.get("sample_count", 0),
                folds_run=eval_metrics.get("folds_run", 0),
                avg_accuracy=eval_metrics.get("avg_accuracy", 0),
                avg_f1=eval_metrics.get("avg_f1", 0),
                avg_auc=eval_metrics.get("avg_auc", 0.5),
                avg_brier=eval_metrics.get("avg_brier", 0),
                std_accuracy=eval_metrics.get("std_accuracy", 0),
                training_period=tuple(meta.get("training_period", ["", ""])),
                evaluation_period=meta.get("evaluation_period"),
                last_updated=m.registered_at,
            ))

        return results

    # ─── Shadow predictions quality ────────────────────────────────────────

    def get_shadow_quality(self) -> Dict:
        """Get shadow predictions vs V3 comparison."""
        if not self._learning_db.exists():
            return {"total_shadow": 0, "agreement_rate": 0, "signal_matrix": {}, "by_model": {}}

        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        cur = conn.cursor()

        # Check if shadow_predictions table exists
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_predictions'")
        if not cur.fetchone():
            conn.close()
            return {"total_shadow": 0, "agreement_rate": 0, "signal_matrix": {}, "by_model": {}}

        cur.execute("SELECT SUM(agreement) FROM shadow_predictions")
        agree = cur.fetchone()[0] or 0

        cur.execute("""
            SELECT v3_signal, ml_signal, COUNT(*)
            FROM shadow_predictions
            GROUP BY v3_signal, ml_signal
            ORDER BY COUNT(*) DESC
        """)
        matrix = {}
        for r in cur.fetchall():
            key = f"{r[0]}→{r[1]}"
            matrix[key] = r[2]

        # By model
        cur.execute("""
            SELECT model_id, COUNT(*), SUM(agreement)
            FROM shadow_predictions
            GROUP BY model_id
        """)
        by_model = {}
        for r in cur.fetchall():
            by_model[r[0]] = {
                "count": r[1],
                "agreement": r[2] or 0,
                "agreement_rate": round((r[2] or 0) / r[1] * 100, 1) if r[1] else 0,
            }

        conn.close()

        return {
            "total_shadow": total,
            "agreement_count": agree,
            "agreement_rate": round(agree / total * 100, 1) if total else 0,
            "signal_matrix": matrix,
            "by_model": by_model,
        }

    # ─── Fundamental archive status ────────────────────────────────────────

    def get_archive_status(self) -> Dict:
        """Get fundamental snapshot archive status."""
        if not self._learning_db.exists():
            return {"total_snapshots": 0, "ready_for_training": False}

        conn = sqlite3.connect(f"file:{self._learning_db}?mode=ro", uri=True)
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM fundamental_snapshots")
        total = cur.fetchone()[0]

        cur.execute("SELECT COUNT(DISTINCT ticker) FROM fundamental_snapshots")
        tickers = cur.fetchone()[0]

        cur.execute("SELECT COUNT(DISTINCT snapshot_date) FROM fundamental_snapshots")
        dates = cur.fetchone()[0]

        cur.execute("SELECT MIN(snapshot_date), MAX(snapshot_date) FROM fundamental_snapshots")
        r = cur.fetchone()
        date_range = (r[0], r[1]) if r and r[0] else None

        conn.close()

        # Need at least 90 days of snapshots for minimal PIT training
        ready = dates >= 90

        return {
            "total_snapshots": total,
            "unique_tickers": tickers,
            "unique_dates": dates,
            "date_range": date_range,
            "ready_for_training": ready,
            "days_until_ready": max(0, 90 - dates),
        }

    # ─── Full report ───────────────────────────────────────────────────────

    def get_full_report(self) -> Dict:
        """Get full learning quality report."""
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "dataset_quality": self.get_dataset_quality(),
            "model_quality": [m.__dict__ for m in self.get_model_quality()],
            "shadow_quality": self.get_shadow_quality(),
            "fundamental_archive": self.get_archive_status(),
            "warnings": self._get_warnings(),
        }

    def _get_warnings(self) -> List[str]:
        """Generate warnings based on quality assessment."""
        warnings = []
        ds = self.get_dataset_quality()
        archive = self.get_archive_status()

        # Check label balance
        label_dist = ds.get("label_distribution", {})
        total_resolved = ds.get("resolved", 0)
        if total_resolved > 0:
            for signal, info in label_dist.items():
                if info["count"] / total_resolved > 0.9:
                    warnings.append(
                        f"LABEL_IMBALANCE: {signal} = {info['count']/total_resolved*100:.0f}% "
                        f"of resolved predictions"
                    )

        # Check archive readiness
        if not archive.get("ready_for_training", False):
            days_left = archive.get("days_until_ready", 90)
            warnings.append(
                f"FUNDAMENTAL_ARCHIVE_NOT_READY: {days_left} days until "
                f"minimum 90-day PIT archive"
            )

        # Check model count
        models = self.get_model_quality()
        if not models:
            warnings.append("NO_MODELS_REGISTERED: no trained models in registry")

        # Check shadow mode
        shadow = self.get_shadow_quality()
        if shadow.get("total_shadow", 0) == 0:
            warnings.append("SHADOW_EMPTY: no shadow predictions yet")

        return warnings
