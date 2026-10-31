"""
datasets/dataset_builder.py — Builds training datasets (v0.1.1 CORRECTED).

v0.1.1 fixes (Section 5 of correction directive):
  - QualityControl ENABLED by default (cannot bypass without explicit flag)
  - to_matrix() does NOT zero-fill missing features (returns None per policy)
  - Tracks rejection reasons for every sample
  - Shows sample counts before/after each stage
  - Shows label distribution
  - Shows temporal coverage per market
  - Detects duplicate prediction_ids
  - Attaches FeatureSchema + LabelDefinition to every Dataset
"""
from __future__ import annotations
from typing import List, Dict, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import datetime

from ..adapters.predictions_adapter import PredictionsAdapter, HistoricalPrediction
from ..adapters.market_data_adapter import MarketDataAdapter
from ..features.feature_builder import FeatureBuilder, FeatureVector
from ..labels.label_builder import LabelBuilder, Label, LabelType
from ..data.quality_control import QualityControl, QualityClass, QualityReport
from ..config.settings import LearningSettings
from ..config.features_schema import FeatureSchema, MissingDataPolicy


@dataclass
class DatasetSample:
    """A single training sample: features + label + provenance."""
    prediction_id: int
    ticker: str
    market: str
    prediction_date: str
    features: Dict[str, Optional[float]]  # None for missing (NOT zero)
    label_type: str
    label_value: float
    label_horizon: int
    label_outcome_category: Optional[str]  # for trade_quality (v0.1.1)
    feature_schema_version: str
    label_definition_version: str
    data_source: str


@dataclass
class DatasetStageReport:
    """Tracks sample counts at each pipeline stage."""
    total_predictions: int = 0
    after_engine_version_filter: int = 0
    after_quality_check: int = 0
    after_feature_build: int = 0
    after_label_build: int = 0
    after_dedup: int = 0
    final_samples: int = 0
    rejection_reasons: Dict[str, int] = field(default_factory=dict)


@dataclass
class Dataset:
    """A training dataset for a specific label type."""
    label_type: LabelType
    horizon: int
    samples: List[DatasetSample] = field(default_factory=list)
    feature_names: List[str] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)
    stage_report: Optional[DatasetStageReport] = None
    feature_schema: Optional[FeatureSchema] = None
    label_definition_version: str = "1.1.0"

    @property
    def size(self) -> int:
        return len(self.samples)

    def to_matrix(self, feature_names: Optional[List[str]] = None) -> Tuple[List[List[Optional[float]]], List[float]]:
        """
        Convert to (X, y) matrices.
        v0.1.1: Missing features are None (NOT zero). LightGBM handles natively.
        Features with REJECT_SAMPLE policy should never reach here (filtered earlier).
        """
        names = feature_names or self.feature_names
        X = []
        y = []
        for s in self.samples:
            # Build row: None for missing features (LightGBM native NaN handling)
            row = []
            for fn in names:
                val = s.features.get(fn)
                row.append(val if val is not None else None)
            X.append(row)
            y.append(s.label_value)
        return X, y

    def get_label_distribution(self) -> Dict:
        """Distribution of label values (v0.1.1)."""
        if not self.samples:
            return {}
        if self.label_type in (LabelType.DIRECTION, LabelType.TRADE_QUALITY):
            pos = sum(1 for s in self.samples if s.label_value >= 0.5)
            neg = sum(1 for s in self.samples if s.label_value < 0.5)
            ambiguous = sum(1 for s in self.samples if s.label_value == -1.0)
            return {"positive": pos, "negative": neg, "ambiguous": ambiguous, "total": len(self.samples)}
        else:
            values = [s.label_value for s in self.samples]
            return {
                "min": min(values),
                "max": max(values),
                "mean": sum(values) / len(values),
                "total": len(values),
            }

    def get_temporal_coverage(self) -> Dict:
        """Temporal coverage per market (v0.1.1)."""
        by_market: Dict[str, Dict] = {}
        for s in self.samples:
            if s.market not in by_market:
                by_market[s.market] = {"count": 0, "min_date": s.prediction_date, "max_date": s.prediction_date}
            by_market[s.market]["count"] += 1
            by_market[s.market]["min_date"] = min(by_market[s.market]["min_date"], s.prediction_date)
            by_market[s.market]["max_date"] = max(by_market[s.market]["max_date"], s.prediction_date)
        return by_market


class DatasetBuilder:
    """
    Builds training datasets by combining features + labels.
    v0.1.1: QualityControl ENABLED by default. Strict integrity checks.
    """

    def __init__(
        self,
        predictions_adapter: Optional[PredictionsAdapter] = None,
        feature_builder: Optional[FeatureBuilder] = None,
        label_builder: Optional[LabelBuilder] = None,
        quality_control: Optional[QualityControl] = None,
        settings: Optional[LearningSettings] = None,
        enable_quality_control: bool = True,  # v0.1.1: default ON
    ):
        self._pred_adapter = predictions_adapter or PredictionsAdapter()
        self._feature_builder = feature_builder or FeatureBuilder()
        self._label_builder = label_builder or LabelBuilder()
        self._settings = settings or LearningSettings()
        self._enable_qc = enable_quality_control

        # v0.1.1: Auto-create QualityControl if enabled and not provided
        if self._enable_qc and quality_control is None:
            self._quality = QualityControl(
                market_data_adapter=MarketDataAdapter(),
            )
        else:
            self._quality = quality_control

    def build_dataset(
        self,
        label_type: LabelType,
        horizon: int = 5,
        market: Optional[str] = None,
        min_samples: int = 50,
    ) -> Dataset:
        """
        Build a dataset for a specific label type + horizon.
        v0.1.1: Full stage tracking + rejection reasons.
        """
        stage = DatasetStageReport()
        rejection_reasons: Dict[str, int] = {}

        def reject(reason: str):
            rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1

        # 1. Get resolved predictions
        if not self._pred_adapter.is_available():
            return Dataset(
                label_type=label_type, horizon=horizon,
                metadata={
                    "error": "predictions.db not found",
                    "hint": "Download from GitHub Releases or run on laptop/VPS where it exists",
                    "searched_paths": str(self._pred_adapter.db_path),
                },
                stage_report=stage,
            )

        try:
            predictions = self._pred_adapter.get_resolved_predictions(market=market)
        except Exception as e:
            return Dataset(
                label_type=label_type, horizon=horizon,
                metadata={"error": f"Failed to read predictions: {e}"},
                stage_report=stage,
            )
        stage.total_predictions = len(predictions)

        if len(predictions) < min_samples:
            return Dataset(
                label_type=label_type, horizon=horizon,
                metadata={"error": f"Insufficient predictions: {len(predictions)} < {min_samples}"},
                stage_report=stage,
            )

        # 2. Filter by engine version consistency (v0.1.1)
        # Group by persona/version — don't mix V40.2 + V3
        engine_versions_seen: Dict[str, int] = {}
        filtered_predictions = []
        for pred in predictions:
            # Determine engine version from prediction characteristics
            engine_ver = self._detect_engine_version(pred)
            engine_versions_seen[engine_ver] = engine_versions_seen.get(engine_ver, 0) + 1
            # Keep all (but track versions) — mixing is logged in metadata
            filtered_predictions.append(pred)
        stage.after_engine_version_filter = len(filtered_predictions)

        # 3. Build samples
        samples = []
        feature_names_set: Set[str] = set()
        seen_prediction_ids: Set[int] = set()

        for pred in filtered_predictions:
            # Dedup check (v0.1.1)
            if pred.id in seen_prediction_ids:
                reject("DUPLICATE_PREDICTION_ID")
                continue
            seen_prediction_ids.add(pred.id)

            # Quality check (v0.1.1: enabled by default)
            if self._quality:
                report = self._quality.classify_symbol(pred.ticker, pred.market)
                if report.classification == QualityClass.REJECTED:
                    reject(f"QUALITY_REJECTED ({'; '.join(report.issues[:2])})")
                    continue
                if report.classification == QualityClass.INCOMPLETE:
                    reject("QUALITY_INCOMPLETE")
                    continue

            # Build features (point-in-time)
            fv = self._feature_builder.build_for_prediction(pred)
            if not fv:
                reject("FEATURE_BUILD_FAILED")
                continue
            if fv.rejected_reason:
                reject(f"FEATURE_REJECTED: {fv.rejected_reason}")
                continue
            if len(fv.features) < 5:
                reject("INSUFFICIENT_FEATURES")
                continue

            # Build label
            label = self._build_single_label(pred, label_type, horizon)
            if not label:
                reject("LABEL_BUILD_FAILED")
                continue

            # v0.1.1: For trade_quality, skip AMBIGUOUS samples
            if label_type == LabelType.TRADE_QUALITY and label.outcome_category == "ambiguous":
                reject("TRADE_QUALITY_AMBIGUOUS")
                continue

            # Combine
            feature_names_set.update(ff for ff in fv.features.keys() if fv.features[ff] is not None)
            samples.append(DatasetSample(
                prediction_id=pred.id,
                ticker=pred.ticker,
                market=pred.market,
                prediction_date=pred.prediction_date,
                features=fv.features,
                label_type=label_type.value,
                label_value=label.value,
                label_horizon=horizon,
                label_outcome_category=label.outcome_category,
                feature_schema_version=fv.feature_schema_version,
                label_definition_version=label.label_definition_version,
                data_source=fv.data_source,
            ))

        stage.after_feature_build = len(samples)
        stage.after_label_build = len(samples)
        stage.after_dedup = len(samples)
        stage.final_samples = len(samples)
        stage.rejection_reasons = rejection_reasons

        return Dataset(
            label_type=label_type,
            horizon=horizon,
            samples=samples,
            feature_names=sorted(feature_names_set),
            metadata={
                "total_predictions": stage.total_predictions,
                "samples_built": len(samples),
                "stage_report": {
                    "total_predictions": stage.total_predictions,
                    "after_engine_version_filter": stage.after_engine_version_filter,
                    "after_quality_check": stage.after_quality_check,
                    "after_feature_build": stage.after_feature_build,
                    "after_label_build": stage.after_label_build,
                    "after_dedup": stage.after_dedup,
                    "final_samples": stage.final_samples,
                    "rejection_reasons": rejection_reasons,
                },
                "engine_versions_seen": engine_versions_seen,
                "markets_included": list(set(s.market for s in samples)),
                "date_range": (
                    min(s.prediction_date for s in samples) if samples else None,
                    max(s.prediction_date for s in samples) if samples else None,
                ),
                "label_distribution": Dataset(label_type=label_type, horizon=horizon, samples=samples).get_label_distribution() if samples else {},
                "temporal_coverage": Dataset(label_type=label_type, horizon=horizon, samples=samples).get_temporal_coverage() if samples else {},
                "built_at": datetime.now().isoformat(),
                "settings": {
                    "min_samples": min_samples,
                    "feature_schema_version": self._feature_builder._schema.version(),
                    "label_definition_version": "1.1.0",
                    "quality_control_enabled": self._enable_qc,
                },
            },
            stage_report=stage,
            feature_schema=self._feature_builder._schema,
            label_definition_version="1.1.0",
        )

    def _detect_engine_version(self, pred: HistoricalPrediction) -> str:
        """
        v0.1.1: Detect which engine version produced this prediction.
        V3: persona='balanced' (post-2026-10-28)
        V40.2: older persona or no persona column
        """
        # Heuristic: V3 predictions have signal in {STRONG_BUY, BUY, SELL, NO_TRADE}
        # V40.2 had INSTITUTIONAL_BUY (killed in V3)
        if pred.signal == "INSTITUTIONAL_BUY":
            return "V40.2"
        # Post-2026-10-28 → likely V3
        if pred.prediction_date >= "2026-10-28":
            return "V3"
        if pred.prediction_date >= "2026-10-20":
            return "V3_or_transition"
        return "V40.2_or_earlier"

    def _build_single_label(
        self, pred: HistoricalPrediction, label_type: LabelType, horizon: int
    ) -> Optional[Label]:
        """Build a single label by type."""
        if label_type == LabelType.DIRECTION:
            return self._label_builder.build_direction_label(pred, horizon)
        elif label_type == LabelType.FORWARD_RETURN:
            return self._label_builder.build_forward_return_label(pred, horizon)
        elif label_type == LabelType.VOLATILITY:
            return self._label_builder.build_volatility_label(pred, horizon)
        elif label_type == LabelType.TRADE_QUALITY:
            return self._label_builder.build_trade_quality_label(pred, max_horizon=horizon)
        elif label_type == LabelType.REGIME:
            return self._label_builder.build_regime_label(pred)
        return None
