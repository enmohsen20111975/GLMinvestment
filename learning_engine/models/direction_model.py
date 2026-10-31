"""
models/direction_model.py — LightGBM binary classifier for direction prediction.

Predicts: probability that price goes UP over horizon N days.
Default model: LightGBM (Section 10 of directive).
"""
from __future__ import annotations
from pathlib import Path
from typing import List, Optional
import pickle
import json

from .base_model import BaseModel, ModelMetadata


class DirectionModel(BaseModel):
    """LightGBM binary classifier: P(price up | features)."""

    def __init__(self, horizon: int = 5):
        super().__init__(
            model_type="lightgbm",
            label_type="direction",
            horizon=horizon,
        )
        self._feature_names: List[str] = []

    def train(
        self,
        X: List[List[float]],
        y: List[float],
        feature_names: List[str],
        config: Optional[dict] = None,
    ):
        """Train LightGBM binary classifier."""
        try:
            import lightgbm as lgb
            import numpy as np
        except ImportError as e:
            raise ImportError(
                "LightGBM not installed. Run: pip install lightgbm"
            ) from e

        config = config or {
            "objective": "binary",
            "metric": "binary_logloss",
            "boosting_type": "gbdt",
            "num_leaves": 31,
            "max_depth": 4,
            "learning_rate": 0.1,
            "feature_fraction": 0.8,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "min_data_in_leaf": 10,
            "feature_fraction_bynode": 0.8,
            "lambda_l1": 0.1,
            "lambda_l2": 1.0,
            "random_state": 42,
        }

        X_arr = np.array(X, dtype=np.float64)
        y_arr = np.array(y, dtype=np.float64)

        # Handle NaN/inf (LightGBM handles natively, but be safe)
        X_arr = np.nan_to_num(X_arr, nan=0.0, posinf=1e10, neginf=-1e10)

        train_data = lgb.Dataset(X_arr, label=y_arr, feature_name=feature_names)

        self._model = lgb.train(
            config, train_data,
            num_boost_round=100,
        )
        self._feature_names = feature_names

        # Compute metadata
        fingerprint = self.compute_dataset_fingerprint(X, y.tolist())
        self._metadata = ModelMetadata(
            model_id=f"direction_h{self.horizon}_{fingerprint[:8]}",
            model_type=self.model_type,
            label_type=self.label_type,
            horizon=self.horizon,
            feature_schema_version="1.0.0",
            label_definition_version="1.0.0",
            training_data_cutoff="auto",
            training_period=("", ""),
            markets_included=[],
            dataset_fingerprint=fingerprint,
            code_commit="auto",
            library_version=f"lightgbm {lgb.__version__}",
            model_config=config,
            feature_names=feature_names,
            sample_count=len(X),
        )

    def predict(self, X: List[List[float]]) -> List[float]:
        """Predict P(up). Returns list of probabilities [0, 1]."""
        if not self._model:
            raise RuntimeError("Model not trained or loaded")
        import numpy as np
        X_arr = np.array(X, dtype=np.float64)
        X_arr = np.nan_to_num(X_arr, nan=0.0, posinf=1e10, neginf=-1e10)
        return self._model.predict(X_arr).tolist()

    def save(self, path: Path) -> None:
        """Save model + metadata to path (creates .pkl + .json)."""
        path.parent.mkdir(parents=True, exist_ok=True)
        # Save model
        with open(path, "wb") as f:
            pickle.dump({"model": self._model, "feature_names": self._feature_names}, f)
        # Save metadata
        meta_path = path.with_suffix(".json")
        with open(meta_path, "w") as f:
            json.dump(self._metadata.__dict__, f, indent=2)

    def load(self, path: Path) -> None:
        """Load model + metadata from path."""
        with open(path, "rb") as f:
            data = pickle.load(f)
        self._model = data["model"]
        self._feature_names = data["feature_names"]
        meta_path = path.with_suffix(".json")
        if meta_path.exists():
            with open(meta_path, "r") as f:
                meta_dict = json.load(f)
            self._metadata = ModelMetadata(**meta_dict)
