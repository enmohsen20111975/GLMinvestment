"""
registry/model_registry.py — Model version registry.

Manages model artifacts + metadata + versions.
Each model version is stored with:
  - Artifact file (.pkl)
  - Metadata file (.json)
  - Atomic promotion (no half-published models)

Located at: learning_engine/registry/artifacts/
"""
from __future__ import annotations
from pathlib import Path
from typing import List, Optional, Dict
from dataclasses import dataclass, asdict
import json
import shutil
import tempfile
from datetime import datetime

from ..config.settings import LearningSettings
from ..models.base_model import ModelMetadata


@dataclass
class RegisteredModel:
    """A model entry in the registry."""
    model_id: str
    model_type: str
    label_type: str
    horizon: int
    version: str  # semver
    status: str  # "active" | "archived" | "shadow"
    artifact_path: str
    metadata_path: str
    registered_at: str
    promoted_at: Optional[str] = None
    metadata: Optional[Dict] = None


class ModelRegistry:
    """
    Model artifact registry with versioning + atomic promotion.
    """

    def __init__(self, settings: Optional[LearningSettings] = None):
        self._settings = settings or LearningSettings()
        self._registry_dir = self._settings.registry_dir
        self._registry_dir.mkdir(parents=True, exist_ok=True)
        self._index_file = self._registry_dir / "registry_index.json"
        self._index: Dict[str, RegisteredModel] = self._load_index()

    def _load_index(self) -> Dict[str, RegisteredModel]:
        """Load registry index from JSON."""
        if not self._index_file.exists():
            return {}
        try:
            with open(self._index_file, "r") as f:
                data = json.load(f)
            return {k: RegisteredModel(**v) for k, v in data.items()}
        except Exception:
            return {}

    def _save_index(self):
        """Save registry index atomically."""
        # Atomic write: write to temp, then rename
        with tempfile.NamedTemporaryFile(
            mode="w", dir=self._registry_dir, suffix=".tmp", delete=False
        ) as tmp:
            json.dump(
                {k: asdict(v) for k, v in self._index.items()},
                tmp, indent=2, default=str
            )
            tmp_path = tmp.name
        Path(tmp_path).replace(self._index_file)

    def register(
        self,
        model_id: str,
        artifact_path: Path,
        metadata: ModelMetadata,
        status: str = "shadow",
    ) -> RegisteredModel:
        """Register a new model version. Atomic operation."""
        # Copy artifact to registry (atomic)
        dest_artifact = self._registry_dir / f"{model_id}.pkl"
        dest_meta = self._registry_dir / f"{model_id}.json"

        # Write metadata
        with tempfile.NamedTemporaryFile(
            mode="w", dir=self._registry_dir, suffix=".tmp", delete=False
        ) as tmp:
            json.dump(asdict(metadata), tmp, indent=2, default=str)
            tmp_meta = tmp.name
        Path(tmp_meta).replace(dest_meta)

        # Copy artifact
        if artifact_path.exists():
            shutil.copy2(artifact_path, dest_artifact)

        entry = RegisteredModel(
            model_id=model_id,
            model_type=metadata.model_type,
            label_type=metadata.label_type,
            horizon=metadata.horizon,
            version=metadata.feature_schema_version,
            status=status,
            artifact_path=str(dest_artifact),
            metadata_path=str(dest_meta),
            registered_at=datetime.now().isoformat(),
            metadata=asdict(metadata),
        )

        self._index[model_id] = entry
        self._save_index()
        return entry

    def get(self, model_id: str) -> Optional[RegisteredModel]:
        """Get a model by ID."""
        return self._index.get(model_id)

    def list_models(self, label_type: Optional[str] = None) -> List[RegisteredModel]:
        """List all models, optionally filtered by label_type."""
        models = list(self._index.values())
        if label_type:
            models = [m for m in models if m.label_type == label_type]
        return sorted(models, key=lambda m: m.registered_at, reverse=True)

    def get_active(self, label_type: str, horizon: int) -> Optional[RegisteredModel]:
        """Get the active model for a label_type + horizon."""
        for m in self._index.values():
            if (
                m.label_type == label_type
                and m.horizon == horizon
                and m.status == "active"
            ):
                return m
        return None

    def promote(self, model_id: str) -> bool:
        """
        Promote a model from 'shadow' to 'active'.
        Atomically demotes any other active model for the same label_type + horizon.
        """
        if model_id not in self._index:
            return False
        entry = self._index[model_id]
        # Demote others
        for other_id, other in self._index.items():
            if (
                other_id != model_id
                and other.label_type == entry.label_type
                and other.horizon == entry.horizon
                and other.status == "active"
            ):
                other.status = "archived"
                other.promoted_at = None
        # Promote this one
        entry.status = "active"
        entry.promoted_at = datetime.now().isoformat()
        self._save_index()
        return True

    def deactivate(self, model_id: str) -> bool:
        """Deactivate a model (set to archived)."""
        if model_id not in self._index:
            return False
        self._index[model_id].status = "archived"
        self._index[model_id].promoted_at = None
        self._save_index()
        return True

    def delete(self, model_id: str) -> bool:
        """Delete a model from registry (removes files + index entry)."""
        if model_id not in self._index:
            return False
        entry = self._index[model_id]
        # Remove files
        for p in [entry.artifact_path, entry.metadata_path]:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass
        del self._index[model_id]
        self._save_index()
        return True
