"""
config/features_schema.py — Feature Schema with versioning (v1.1.0 — CORRECTED).

Defines metadata for every feature consumed by the learning engine.
This is the CONTRACT between the feature builder and the model.

CRITICAL (Section 1 of v0.1.1 correction directive):
  - Every feature used by the model MUST be defined here.
  - feature_builder.py MUST NOT output features not in this schema.
  - Missing features MUST follow their MissingDataPolicy (NOT silently zeroed).
  - NO default values that hide missing data.

Version bump: v1.0.0 → v1.1.0
  - Added 9 features that feature_builder actually produces:
    atr_pct, macd_histogram, plus_di, minus_di, srsi_d,
    return_1d, return_5d, return_20d, relative_volume_20d
  - Removed 4 features that feature_builder does NOT produce:
    ema_12, ema_26 (kept in library but not consumed yet)
  - Added distance_to_sma_*_pct features (3) that ARE produced
  - Tightened MissingDataPolicy per feature
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, List, Set
from enum import Enum


class FeatureGroup(str, Enum):
    PRICE = "price"
    LIQUIDITY = "liquidity"
    MARKET = "market"
    REGIME = "regime"
    ENGINE = "engine"


class MissingDataPolicy(str, Enum):
    REJECT_SAMPLE = "reject_sample"  # drop the whole training sample
    NULL = "null"                    # pass None (LightGBM handles natively)
    ZERO = "zero"                    # pass 0.0 (ONLY when 0 is a valid value)
    FORWARD_FILL = "forward_fill"   # use last known value (with caution)


@dataclass(frozen=True)
class FeatureDef:
    """Immutable definition of a single feature."""
    name: str
    group: FeatureGroup
    source_module: str
    source_function: str
    input_requirements: str
    output_type: str            # "float", "int", "category"
    timeframe: str              # "daily", "weekly", "intraday"
    version: str                # feature definition version
    missing_policy: MissingDataPolicy = MissingDataPolicy.NULL
    description: str = ""
    # For categorical features: allowed values
    allowed_values: Optional[tuple] = None


@dataclass(frozen=True)
class FeatureSchemaVersion:
    version: str
    created_at: str
    feature_count: int
    checksum: str


# ─── Schema v1.1.0 — ALIGNED with feature_builder.py output ──────────────
# Every feature here MUST be produced by feature_builder.py.
# Every feature in feature_builder.py MUST be defined here.

FEATURES_V1_1: List[FeatureDef] = [
    # ─── A. PRICE FEATURES (from Unified Indicators Library) ──────────────
    FeatureDef(
        name="rsi_14",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.rsi",
        source_function="calc_rsi",
        input_requirements="closes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Wilder's RSI (14-period)",
    ),
    FeatureDef(
        name="atr_14",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.atr",
        source_function="calc_atr",
        input_requirements="highs, lows, closes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Wilder's ATR (14-period)",
    ),
    FeatureDef(
        name="atr_pct",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: atr_14 / close * 100)",
        input_requirements="atr_14: float, closes[-1]: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="ATR as % of current price (volatility-normalized)",
    ),
    FeatureDef(
        name="macd_line",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="macd",
        input_requirements="closes: List[float], fast=12, slow=26, signal_period=9",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="MACD line (EMA12 - EMA26). From dict{line, signal, histogram}",
    ),
    FeatureDef(
        name="macd_signal",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="macd",
        input_requirements="closes: List[float], fast=12, slow=26, signal_period=9",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="MACD signal line (EMA9 of MACD line)",
    ),
    FeatureDef(
        name="macd_histogram",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="macd",
        input_requirements="closes: List[float], fast=12, slow=26, signal_period=9",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="MACD histogram (line - signal)",
    ),
    FeatureDef(
        name="sma_20",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="sma",
        input_requirements="data: List[float], period=20",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Simple Moving Average (20-period)",
    ),
    FeatureDef(
        name="sma_50",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="sma",
        input_requirements="data: List[float], period=50",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Simple Moving Average (50-period)",
    ),
    FeatureDef(
        name="sma_200",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.ma",
        source_function="sma",
        input_requirements="data: List[float], period=200",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Simple Moving Average (200-period) — often missing for new stocks",
    ),
    FeatureDef(
        name="distance_to_sma_20_pct",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close - sma_20) / sma_20 * 100)",
        input_requirements="sma_20: float, closes[-1]: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Distance from SMA20 as %",
    ),
    FeatureDef(
        name="distance_to_sma_50_pct",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close - sma_50) / sma_50 * 100)",
        input_requirements="sma_50: float, closes[-1]: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Distance from SMA50 as %",
    ),
    FeatureDef(
        name="distance_to_sma_200_pct",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close - sma_200) / sma_200 * 100)",
        input_requirements="sma_200: float, closes[-1]: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Distance from SMA200 as %",
    ),
    FeatureDef(
        name="bollinger_percent_b",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.bollinger",
        source_function="calc_bollinger",
        input_requirements="closes: List[float], period=20, std_dev=2.0",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Bollinger %B (position within bands). From dict{percent_b, ...}",
    ),
    FeatureDef(
        name="bollinger_bandwidth",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.bollinger",
        source_function="calc_bollinger",
        input_requirements="closes: List[float], period=20, std_dev=2.0",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Bollinger bandwidth (volatility squeeze indicator)",
    ),
    FeatureDef(
        name="adx_14",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.adx",
        source_function="calc_adx",
        input_requirements="highs, lows, closes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="ADX (trend strength). From dict{adx, plus_di, minus_di}",
    ),
    FeatureDef(
        name="plus_di",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.adx",
        source_function="calc_adx",
        input_requirements="highs, lows, closes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="+DI (directional movement indicator, bullish)",
    ),
    FeatureDef(
        name="minus_di",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.adx",
        source_function="calc_adx",
        input_requirements="highs, lows, closes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="-DI (directional movement indicator, bearish)",
    ),
    FeatureDef(
        name="srsi_k",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.srsi",
        source_function="calc_srsi",
        input_requirements="closes: List[float], period=14, smooth_k=3, smooth_d=3",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Stochastic RSI %K",
    ),
    FeatureDef(
        name="srsi_d",
        group=FeatureGroup.PRICE,
        source_module="vps-service.analyzers.indicators.srsi",
        source_function="calc_srsi",
        input_requirements="closes: List[float], period=14, smooth_k=3, smooth_d=3",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Stochastic RSI %D (signal line)",
    ),
    FeatureDef(
        name="return_1d",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close[-1] - close[-2]) / close[-2] * 100)",
        input_requirements="closes: List[float] (len >= 2)",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="1-day return %",
    ),
    FeatureDef(
        name="return_5d",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close[-1] - close[-6]) / close[-6] * 100)",
        input_requirements="closes: List[float] (len >= 6)",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="5-day return %",
    ),
    FeatureDef(
        name="return_20d",
        group=FeatureGroup.PRICE,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_price_features (derived: (close[-1] - close[-21]) / close[-21] * 100)",
        input_requirements="closes: List[float] (len >= 21)",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="20-day return %",
    ),

    # ─── B. LIQUIDITY FEATURES ────────────────────────────────────────────
    FeatureDef(
        name="mfi_14",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.analyzers.indicators.mfi",
        source_function="calc_mfi",
        input_requirements="highs, lows, closes, volumes: List[float], period=14",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Money Flow Index (volume-weighted RSI)",
    ),
    FeatureDef(
        name="cmf_20",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.analyzers.indicators.flow_indicators",
        source_function="calc_cmf",
        input_requirements="highs, lows, closes, volumes: List[float], period=20",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Chaikin Money Flow",
    ),
    FeatureDef(
        name="obv_trend",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.analyzers.indicators.flow_indicators",
        source_function="obv_trend",
        input_requirements="obv_series: List[float], lookback=20",
        output_type="category",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="OBV trend direction",
        allowed_values=("up", "down", "flat"),
    ),
    FeatureDef(
        name="vwap_premium",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.analyzers.indicators.vwap",
        source_function="calc_vwap_premium",
        input_requirements="closes: List[float], vwap: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Price premium/discount vs VWAP (%)",
    ),
    FeatureDef(
        name="money_flow_buy_pct",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.utils.shared_liquidity",
        source_function="compute_money_flow",
        input_requirements="closes, volumes, highs, lows: List[float]",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Money flow buy pressure (0-100). 6-layer computation.",
    ),
    FeatureDef(
        name="liquidity_intensity",
        group=FeatureGroup.LIQUIDITY,
        source_module="vps-service.utils.shared_liquidity",
        source_function="liquidity_intensity",
        input_requirements="turnover: float, market_cap: float",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,  # often missing if no market_cap
        description="Turnover / market_cap (%)",
    ),
    FeatureDef(
        name="relative_volume_20d",
        group=FeatureGroup.LIQUIDITY,
        source_module="learning_engine.features.feature_builder",
        source_function="_add_liquidity_features (derived: volumes[-1] / avg(volumes[-20:]))",
        input_requirements="volumes: List[float] (len >= 20)",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Relative volume vs 20-day average",
    ),

    # ─── C. MARKET FEATURES ───────────────────────────────────────────────
    FeatureDef(
        name="market_index_return_5d",
        group=FeatureGroup.MARKET,
        source_module="learning_engine.features.market_features",
        source_function="compute_index_return",
        input_requirements="index_closes: List[float], horizon=5",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Market index 5-day return (%)",
    ),
    FeatureDef(
        name="relative_strength_vs_index_20d",
        group=FeatureGroup.MARKET,
        source_module="learning_engine.features.market_features",
        source_function="compute_relative_strength",
        input_requirements="stock_closes, index_closes: List[float], horizon=20",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Relative strength of stock vs market index (20-day)",
    ),

    # ─── D. REGIME FEATURES ───────────────────────────────────────────────
    # v0.1.1: HISTORICAL regime (not current). Missing if no historical archive.
    FeatureDef(
        name="market_regime",
        group=FeatureGroup.REGIME,
        source_module="vps-service.analyzers.market_regime_engine (HISTORICAL archive)",
        source_function="get_regime_at_date(market, date)",
        input_requirements="market: str, prediction_date: str",
        output_type="category",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,  # NULL if no historical archive
        description="Market regime AT prediction date (historical, NOT current)",
        allowed_values=("DEFENSIVE", "NORMAL", "AGGRESSIVE"),
    ),

    # ─── E. ENGINE FEATURES (from predictions.db — read-only) ─────────────
    FeatureDef(
        name="engine_master_score",
        group=FeatureGroup.ENGINE,
        source_module="predictions.db.predictions",
        source_function="column:master_score",
        input_requirements="prediction_id: int",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Master score from V3 prediction (0-100)",
    ),
    FeatureDef(
        name="engine_technical_score",
        group=FeatureGroup.ENGINE,
        source_module="predictions.db.predictions",
        source_function="column:technical_score",
        input_requirements="prediction_id: int",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Technical score from V3 prediction",
    ),
    FeatureDef(
        name="engine_signal_type",
        group=FeatureGroup.ENGINE,
        source_module="predictions.db.predictions",
        source_function="column:signal",
        input_requirements="prediction_id: int",
        output_type="category",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.REJECT_SAMPLE,
        description="Signal type from V3 prediction",
        allowed_values=("STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL", "ACCUMULATE", "REDUCE", "INSTITUTIONAL_BUY"),
    ),
    FeatureDef(
        name="engine_confidence",
        group=FeatureGroup.ENGINE,
        source_module="predictions.db.predictions",
        source_function="column:confidence",
        input_requirements="prediction_id: int",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Confidence value from V3 prediction (0-100)",
    ),
    FeatureDef(
        name="engine_risk_reward",
        group=FeatureGroup.ENGINE,
        source_module="predictions.db.predictions",
        source_function="column:risk_reward",
        input_requirements="prediction_id: int",
        output_type="float",
        timeframe="daily",
        version="1.1.0",
        missing_policy=MissingDataPolicy.NULL,
        description="Risk/reward ratio from V3 prediction",
    ),
]


class FeatureSchema:
    """Schema manager — validates features + versions."""

    def __init__(self, features: List[FeatureDef] = None):
        self.features = features or FEATURES_V1_1
        self._by_name = {f.name: f for f in self.features}

    def get(self, name: str) -> FeatureDef:
        if name not in self._by_name:
            raise KeyError(f"Unknown feature: {name}")
        return self._by_name[name]

    def all_names(self) -> List[str]:
        return list(self._by_name.keys())

    def by_group(self, group: FeatureGroup) -> List[FeatureDef]:
        return [f for f in self.features if f.group == group]

    def version(self) -> str:
        return max(f.version for f in self.features)

    def checksum(self) -> str:
        import hashlib
        content = "|".join(
            f"{f.name}:{f.source_module}:{f.source_function}:{f.version}:{f.missing_policy.value}"
            for f in sorted(self.features, key=lambda x: x.name)
        )
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def version_info(self) -> FeatureSchemaVersion:
        return FeatureSchemaVersion(
            version=self.version(),
            created_at="2026-10-29",
            feature_count=len(self.features),
            checksum=self.checksum(),
        )

    def is_compatible(self, other_version: str) -> bool:
        my_major = self.version().split(".")[0]
        other_major = other_version.split(".")[0]
        return my_major == other_major

    def validate_feature_set(self, produced_names: Set[str]) -> dict:
        """
        v0.1.1: Validate that produced features match schema exactly.
        Returns dict with:
          - schema_only: features in schema but not produced (BUG)
          - produced_only: features produced but not in schema (BUG)
          - matched: features in both
        """
        schema_names = set(self._by_name.keys())
        return {
            "schema_only": schema_names - produced_names,  # declared but not produced
            "produced_only": produced_names - schema_names,  # produced but not declared
            "matched": schema_names & produced_names,
            "is_valid": len(schema_names - produced_names) == 0 and len(produced_names - schema_names) == 0,
        }
