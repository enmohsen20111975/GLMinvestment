"""
config/settings.py — Global settings for the Learning Engine.

Single source of truth for all paths, DBs, and operational parameters.
NO hardcoded secrets. NO production paths modified.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# ─── Project Root (auto-detect, works on both Laptop + VPS) ────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[2]

# ─── Production DBs (READ-ONLY access) ─────────────────────────────────────
PROD_DB_DIR = PROJECT_ROOT / "db"
DATA_ENGINE_DB = PROD_DB_DIR / "data_engine.db"
STOCKS_DB = PROD_DB_DIR / "stocks.db"
PRICE_HISTORY_DB = PROD_DB_DIR / "price_history.db"
PREDICTIONS_DB = PROD_DB_DIR / "predictions.db"

# ─── Learning Engine DB (separate — owned by Learning Engine) ──────────────
LEARNING_DB = PROD_DB_DIR / "learning.db"

# ─── Model Registry (artifact storage) ─────────────────────────────────────
MODEL_REGISTRY_DIR = PROJECT_ROOT / "learning_engine" / "registry" / "artifacts"

# ─── Unified Indicators Library (SSOT — Rule 67) ───────────────────────────
INDICATORS_PACKAGE = "vps-service.analyzers.indicators"

# ─── Feature Schema Version (bumped on any feature definition change) ──────
CURRENT_FEATURE_SCHEMA_VERSION = "1.0.0"


@dataclass(frozen=True)
class LearningSettings:
    """Immutable global settings. Inject into modules via constructor."""

    # Operational
    shadow_mode: bool = True  # SHADOW_MODE = True by design (Section 12)
    dry_run: bool = False

    # DB paths
    learning_db: Path = LEARNING_DB
    predictions_db: Path = PREDICTIONS_DB
    data_engine_db: Path = DATA_ENGINE_DB
    stocks_db: Path = STOCKS_DB
    price_history_db: Path = PRICE_HISTORY_DB

    # Model registry
    registry_dir: Path = MODEL_REGISTRY_DIR

    # Schema versions
    feature_schema_version: str = CURRENT_FEATURE_SCHEMA_VERSION

    # Training defaults (LightGBM)
    default_model_type: str = "lightgbm"
    random_state: int = 42

    # Label horizons (trading days)
    label_horizons_days: tuple = (1, 3, 5, 10, 20)

    # Data quality thresholds
    min_candles_for_training: int = 200
    min_years_coverage: float = 1.0
    max_flat_candle_pct: float = 20.0
    max_zero_volume_pct: float = 80.0
    max_ohlc_violation_pct: float = 5.0
    max_stale_ratio_pct: float = 70.0

    # Transaction costs (for trade_quality label)
    transaction_cost_pct: float = 0.15  # 0.15% per side (EGX average)

    # Read-only enforcement flag
    read_only_production: bool = True  # HARD CONSTRAINT — never flip to False

    def validate_paths(self) -> list[str]:
        """Return list of missing production DBs (warnings, not errors)."""
        missing = []
        for name, path in [
            ("data_engine.db", self.data_engine_db),
            ("stocks.db", self.stocks_db),
            ("price_history.db", self.price_history_db),
            ("predictions.db", self.predictions_db),
        ]:
            if not path.exists():
                missing.append(f"{name} not found at {path}")
        return missing


# Singleton instance
settings = LearningSettings()
