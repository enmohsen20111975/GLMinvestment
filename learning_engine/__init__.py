"""
learning_engine — Independent Self-Learning System for GLMinvestment
====================================================================

Architecture:
  - Independent in execution (separate modules, separate DB).
  - Connected to the project via clear interfaces (adapters).
  - Consumes the Unified Indicators Library (vps-service/analyzers/indicators/).
  - Read-only access to production data sources.
  - Shadow Mode: never modifies V3 decisions.

Integration Contract:
  - indicators_adapter.py → vps-service/analyzers/indicators/ (SSOT for indicators)
  - market_data_adapter.py → data_engine/data_layer.py (SSOT for prices)
  - predictions_adapter.py → predictions.db (SSOT for historical decisions)
  - outcomes_adapter.py → predictions.db (SSOT for resolved outcomes)
  - engine_adapter.py → vps-service/core/{orchestrator_v3,executor_v3}.py (SSOT for engine logic — read-only)

Design Principle:
  "The learning system learns FROM the project, it does NOT rebuild it."
  "Existing libraries are the Single Source of Truth for calculations."
  "V3 remains the Single Source of Truth for production decisions."
  "Laptop = Training, VPS = Inference + Shadow Monitoring."

See: Documentation/Learning-Engine/ARCHITECTURE.md for full design.
"""
__version__ = "0.1.0"
__status__ = "SHADOW_MODE"

# Public API (consumed by CLI + integration layer)
# NOTE: imports kept minimal to avoid circular deps + heavy imports at package load
__all__ = [
    "LearningSettings",
    "FeatureSchema",
    "FeatureSchemaVersion",
    "ModelRegistry",
    "ShadowRunner",
]

def __getattr__(name):
    """Lazy imports to avoid heavy dependencies at package load."""
    if name == "LearningSettings":
        from .config.settings import LearningSettings
        return LearningSettings
    if name == "FeatureSchema":
        from .config.features_schema import FeatureSchema
        return FeatureSchema
    if name == "FeatureSchemaVersion":
        from .config.features_schema import FeatureSchemaVersion
        return FeatureSchemaVersion
    if name == "ModelRegistry":
        from .registry.model_registry import ModelRegistry
        return ModelRegistry
    if name == "ShadowRunner":
        from .integration.shadow_runner import ShadowRunner
        return ShadowRunner
    raise AttributeError(f"module 'learning_engine' has no attribute {name}")
