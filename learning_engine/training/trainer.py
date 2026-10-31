"""
training/trainer.py — Training pipeline orchestrator (v0.1.1 CORRECTED).

v0.1.1 fixes (Section 7 of correction directive):
  - Evaluation SEPARATE from final training (no contamination)
  - Per-fold metrics preserved in registry
  - Dataset fingerprint + FeatureSchema + LabelDefinition saved with model
  - Training period + evaluation period recorded
  - NO automatic promotion to production (always shadow)
  - Temporal sort enforced before walk-forward
"""
from __future__ import annotations
from typing import Optional, Dict, List
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime

from ..adapters.predictions_adapter import PredictionsAdapter
from ..datasets.dataset_builder import DatasetBuilder, Dataset
from ..labels.label_builder import LabelType
from ..models.direction_model import DirectionModel
from ..models.base_model import BaseModel
from ..registry.model_registry import ModelRegistry
from ..evaluation.walk_forward import WalkForwardValidator
from ..config.settings import LearningSettings


@dataclass
class TrainingResult:
    """Result of a training run (v0.1.1: expanded)."""
    success: bool
    model_id: str
    label_type: str
    horizon: int
    sample_count: int
    metrics: Dict
    artifact_path: Optional[str] = None
    error: Optional[str] = None
    # v0.1.1: additional metadata
    dataset_fingerprint: Optional[str] = None
    feature_schema_version: Optional[str] = None
    label_definition_version: Optional[str] = None
    training_period: Optional[tuple] = None
    evaluation_period: Optional[tuple] = None
    markets_included: List[str] = None
    fold_count: int = 0
    rejection_summary: Optional[Dict] = None


class Trainer:
    """
    Training pipeline orchestrator. Runs on LAPTOP.
    v0.1.1: Strict separation of evaluation and final training.
    """

    def __init__(
        self,
        settings: Optional[LearningSettings] = None,
        dataset_builder: Optional[DatasetBuilder] = None,
        registry: Optional[ModelRegistry] = None,
    ):
        self._settings = settings or LearningSettings()

        # Auto-detect: use synthetic predictions if production has none
        from ..adapters.predictions_adapter import PredictionsAdapter
        from ..adapters.synthetic_predictions_adapter import SyntheticPredictionsAdapter

        prod_adapter = PredictionsAdapter()
        synth_adapter = SyntheticPredictionsAdapter()

        if prod_adapter.is_available():
            try:
                resolved = prod_adapter.get_resolved_predictions()
                if len(resolved) >= 10:
                    pred_adapter = prod_adapter
                elif synth_adapter.is_available():
                    print("[Trainer] Using synthetic predictions (production has no resolved)")
                    pred_adapter = synth_adapter
                else:
                    pred_adapter = prod_adapter  # will fail with clear message
            except Exception:
                if synth_adapter.is_available():
                    print("[Trainer] Using synthetic predictions (production read failed)")
                    pred_adapter = synth_adapter
                else:
                    pred_adapter = prod_adapter
        elif synth_adapter.is_available():
            print("[Trainer] Using synthetic predictions (production DB not found)")
            pred_adapter = synth_adapter
        else:
            pred_adapter = prod_adapter  # will fail with clear message

        self._dataset_builder = dataset_builder or DatasetBuilder(
            settings=self._settings,
            predictions_adapter=pred_adapter,
        )
        self._registry = registry or ModelRegistry(settings=self._settings)
        # v0.1.1: walk-forward with purging + embargo
        self._validator = WalkForwardValidator(
            n_splits=5,
            purge_horizon=5,  # matches default label horizon
            embargo_days=5,
        )

    def train_direction_model(
        self,
        horizon: int = 5,
        market: Optional[str] = None,
        min_samples: int = 50,
    ) -> TrainingResult:
        """Train a direction model (binary: price up/down)."""
        print(f"\n{'='*60}")
        print(f"Training DIRECTION model (horizon={horizon}d, market={market or 'all'})")
        print(f"{'='*60}")

        # 1. Build dataset
        print("\n[1/5] Building dataset...")
        dataset = self._dataset_builder.build_dataset(
            label_type=LabelType.DIRECTION,
            horizon=horizon,
            market=market,
            min_samples=min_samples,
        )

        if dataset.metadata.get("error"):
            return TrainingResult(
                success=False, model_id="", label_type="direction",
                horizon=horizon, sample_count=0, metrics={},
                error=dataset.metadata["error"],
            )

        if dataset.size < min_samples:
            return TrainingResult(
                success=False, model_id="", label_type="direction",
                horizon=horizon, sample_count=dataset.size, metrics={},
                error=f"Insufficient samples: {dataset.size} < {min_samples}",
                rejection_summary=dataset.metadata.get("stage_report", {}).get("rejection_reasons", {}),
            )

        print(f"  ✅ Built {dataset.size} samples")
        print(f"  Features: {len(dataset.feature_names)}")
        print(f"  Date range: {dataset.metadata.get('date_range')}")
        print(f"  Rejection reasons: {dataset.metadata.get('stage_report', {}).get('rejection_reasons', {})}")

        # 2. Prepare data with temporal ordering
        print("\n[2/5] Preparing data with temporal sort...")
        X, y = dataset.to_matrix()

        # Get sample dates + IDs for walk-forward (v0.1.1)
        sample_dates = [s.prediction_date for s in dataset.samples]
        sample_ids = [s.prediction_id for s in dataset.samples]

        # 3. Walk-forward evaluation (SEPARATE from final training)
        print("\n[3/5] Walk-forward evaluation (with purging + embargo)...")
        eval_model = DirectionModel(horizon=horizon)  # separate model for eval
        metrics = self._validator.validate(
            model=eval_model,
            X=X, y=y,
            feature_names=dataset.feature_names,
            sample_dates=sample_dates,
            sample_prediction_ids=sample_ids,
        )

        if metrics.get("error"):
            return TrainingResult(
                success=False, model_id="", label_type="direction",
                horizon=horizon, sample_count=dataset.size, metrics=metrics,
                error=f"Walk-forward failed: {metrics['error']}",
            )

        print(f"  Folds run: {metrics.get('folds_run', 0)}/{metrics.get('folds_total', 0)}")
        print(f"  Avg accuracy: {metrics.get('avg_accuracy', 0):.4f}")
        print(f"  Avg F1: {metrics.get('avg_f1', 0):.4f}")
        print(f"  Avg AUC: {metrics.get('avg_auc', 0.5):.4f}")
        print(f"  Purged samples: {metrics.get('total_purged_samples', 0)}")

        # 4. FINAL training on FULL dataset (SEPARATE from evaluation)
        print("\n[4/5] Final training on full dataset...")
        final_model = DirectionModel(horizon=horizon)
        final_model.train(X, y, dataset.feature_names)

        # Compute dataset fingerprint
        fingerprint = BaseModel.compute_dataset_fingerprint(X, y)

        # Update model metadata
        if final_model.metadata:
            final_model.metadata.training_period = dataset.metadata.get("date_range", ("", ""))
            final_model.metadata.markets_included = dataset.metadata.get("markets_included", [])
            final_model.metadata.training_timestamp = datetime.now().isoformat()
            final_model.metadata.evaluation_metrics = metrics
            final_model.metadata.dataset_fingerprint = fingerprint
            final_model.metadata.feature_schema_version = self._dataset_builder._feature_builder._schema.version()
            final_model.metadata.label_definition_version = "1.1.0"
            final_model.metadata.sample_count = dataset.size

        # 5. Register model (ALWAYS shadow — never auto-promote)
        print("\n[5/5] Registering model (status=shadow)...")
        temp_path = Path(f"/tmp/direction_h{horizon}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pkl")
        final_model.save(temp_path)

        entry = self._registry.register(
            model_id=final_model.metadata.model_id if final_model.metadata else f"direction_h{horizon}_v011",
            artifact_path=temp_path,
            metadata=final_model.metadata,
            status="shadow",  # ALWAYS shadow (Section 12 of directive)
        )

        # Cleanup temp
        temp_path.unlink(missing_ok=True)

        print(f"\n✅ Training complete!")
        print(f"   Model ID: {entry.model_id}")
        print(f"   Status: {entry.status} (shadow — NOT promoted)")
        print(f"   Samples: {dataset.size}")
        print(f"   Folds: {metrics.get('folds_run', 0)}")
        print(f"   Fingerprint: {fingerprint}")

        # Determine evaluation period from fold details
        eval_period = None
        fold_details = metrics.get("fold_details", [])
        if fold_details:
            valid_folds = [f for f in fold_details if not f.get("error")]
            if valid_folds:
                eval_period = (
                    valid_folds[0]["train_period"][0],
                    valid_folds[-1]["test_period"][1],
                )

        return TrainingResult(
            success=True,
            model_id=entry.model_id,
            label_type="direction",
            horizon=horizon,
            sample_count=dataset.size,
            metrics=metrics,
            artifact_path=entry.artifact_path,
            dataset_fingerprint=fingerprint,
            feature_schema_version=final_model.metadata.feature_schema_version if final_model.metadata else "1.1.0",
            label_definition_version="1.1.0",
            training_period=dataset.metadata.get("date_range"),
            evaluation_period=eval_period,
            markets_included=dataset.metadata.get("markets_included", []),
            fold_count=metrics.get("folds_run", 0),
            rejection_summary=dataset.metadata.get("stage_report", {}).get("rejection_reasons", {}),
        )
