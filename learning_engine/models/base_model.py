"""
models/base_model.py — Abstract base for all ML models.

Supports pluggable model types (LightGBM default, CatBoost/XGBoost later).
NO LLM for price prediction. NO internet dependency.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field
from pathlib import Path
import pickle
import hashlib


@dataclass
class ModelMetadata:
    """Versioned model metadata (Section 11 of directive)."""
    model_id: str
    model_type: str  # "lightgbm" | "catboost" | "xgboost"
    label_type: str
    horizon: int
    feature_schema_version: str
    label_definition_version: str
    training_data_cutoff: str
    training_period: tuple  # (start, end)
    markets_included: List[str]
    dataset_fingerprint: str  # hash of dataset
    code_commit: str
    library_version: str  # e.g., "lightgbm 4.5.0"
    evaluation_metrics: Dict = field(default_factory=dict)
    model_config: Dict = field(default_factory=dict)
    training_timestamp: str = ""
    feature_names: List[str] = field(default_factory=list)
    sample_count: int = 0


class BaseModel(ABC):
    """Abstract base class for ML models."""

    def __init__(self, model_type: str, label_type: str, horizon: int):
        self.model_type = model_type
        self.label_type = label_type
        self.horizon = horizon
        self._model: Any = None
        self._metadata: Optional[ModelMetadata] = None

    @abstractmethod
    def train(self, X: List[List[float]], y: List[float], feature_names: List[str]):
        """Train the model on (X, y)."""
        pass

    @abstractmethod
    def predict(self, X: List[List[float]]) -> List[float]:
        """Predict for X. Returns probabilities for classification, values for regression."""
        pass

    @abstractmethod
    def save(self, path: Path) -> None:
        """Save model artifact + metadata."""
        pass

    @abstractmethod
    def load(self, path: Path) -> None:
        """Load model from artifact."""
        pass

    @property
    def metadata(self) -> Optional[ModelMetadata]:
        return self._metadata

    def is_compatible_schema(self, schema_version: str) -> bool:
        """Check if model is compatible with a feature schema version."""
        if not self._metadata:
            return False
        # Major version must match
        my_major = self._metadata.feature_schema_version.split(".")[0]
        other_major = schema_version.split(".")[0]
        return my_major == other_major

    @staticmethod
    def compute_dataset_fingerprint(X: List[List[float]], y: List[float]) -> str:
        """Stable hash of dataset for integrity tracking."""
        content = f"{len(X)}_{len(y)}_{hash(str(X[:10]))}_{hash(str(y[:10]))}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
