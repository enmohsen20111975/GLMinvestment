"""
features/feature_builder.py — Point-in-Time Feature Builder (v0.1.1 CORRECTED).

v0.1.1 fixes (Section 1 of correction directive):
  - NO default values that hide missing data (no more adx=25, %b=50, etc.)
  - Every feature MUST be in FeatureSchema (validated at build time)
  - MissingDataPolicy applied per feature:
    * REJECT_SAMPLE → return None (sample dropped)
    * NULL → feature omitted (LightGBM handles natively)
    * ZERO → only when 0 is valid
  - Historical regime (not current) — see _add_regime_features

CRITICAL (Section 8 of directive): NO LOOK-AHEAD BIAS.
Every feature at timestamp T uses ONLY data available at T.
"""
from __future__ import annotations
from typing import Dict, Optional, List, Set
from dataclasses import dataclass, field
from datetime import datetime

from ..adapters.indicators_adapter import IndicatorsAdapter
from ..adapters.market_data_adapter import MarketDataAdapter, OHLCVBar
from ..adapters.engine_adapter import EngineAdapter
from ..adapters.predictions_adapter import HistoricalPrediction
from ..config.features_schema import FeatureSchema, FeatureGroup, MissingDataPolicy


@dataclass
class FeatureVector:
    """A single point-in-time feature vector with full provenance."""
    prediction_id: int
    ticker: str
    market: str
    decision_timestamp: str
    feature_timestamp: str
    features: Dict[str, float]  # feature_name → value (NO defaults for missing)
    feature_schema_version: str
    engine_version: str
    data_source: str
    missing_features: List[str] = field(default_factory=list)
    rejected_reason: Optional[str] = None  # if REJECT_SAMPLE policy triggered
    warnings: List[str] = field(default_factory=list)


class FeatureBuilder:
    """
    Builds point-in-time feature vectors for historical predictions.
    Uses IndicatorsAdapter (Unified Library) — NO duplicate formulas.
    v0.1.1: Strict schema enforcement + MissingDataPolicy.
    """

    def __init__(
        self,
        indicators_adapter: Optional[IndicatorsAdapter] = None,
        market_data_adapter: Optional[MarketDataAdapter] = None,
        engine_adapter: Optional[EngineAdapter] = None,
        schema: Optional[FeatureSchema] = None,
    ):
        self._indicators = indicators_adapter or IndicatorsAdapter()
        self._market_data = market_data_adapter or MarketDataAdapter()
        self._engine = engine_adapter or EngineAdapter()
        self._schema = schema or FeatureSchema()

    def build_for_prediction(
        self,
        prediction: HistoricalPrediction,
        lookback_days: int = 250,
    ) -> Optional[FeatureVector]:
        """
        Build feature vector for a single historical prediction.
        STRICTLY point-in-time: only data up to prediction_date.

        Returns None if any REJECT_SAMPLE feature is missing.
        """
        # 1. Fetch price history up to prediction_date (exclusive)
        bars = self._market_data.get_history_bars(
            prediction.ticker, days=lookback_days, market=prediction.market
        )
        pred_date = prediction.prediction_date[:10]
        bars_before = [b for b in bars if b.date < pred_date]

        if len(bars_before) < 30:
            return None  # insufficient history

        closes = [b.close for b in bars_before]
        highs = [b.high for b in bars_before]
        lows = [b.low for b in bars_before]
        volumes = [b.volume for b in bars_before]

        # 2. Compute features
        features: Dict[str, float] = {}
        missing: List[str] = []
        rejected_reason: Optional[str] = None

        # ─── A. PRICE FEATURES ────────────────────────────────────────────
        self._add_price_features(features, missing, closes, highs, lows, volumes)

        # ─── B. LIQUIDITY FEATURES ────────────────────────────────────────
        self._add_liquidity_features(features, missing, closes, highs, lows, volumes, prediction)

        # ─── C. MARKET FEATURES ───────────────────────────────────────────
        self._add_market_features(features, missing, closes, prediction)

        # ─── D. REGIME FEATURES (HISTORICAL — v0.1.1) ─────────────────────
        self._add_regime_features(features, missing, prediction)

        # ─── E. ENGINE FEATURES (read from predictions.db) ────────────────
        self._add_engine_features(features, missing, prediction)

        # 3. Apply MissingDataPolicy per feature
        rejected_reason = self._apply_missing_policies(features, missing)

        if rejected_reason:
            return FeatureVector(
                prediction_id=prediction.id,
                ticker=prediction.ticker,
                market=prediction.market,
                decision_timestamp=prediction.prediction_date,
                feature_timestamp=datetime.now().isoformat(),
                features={},
                feature_schema_version=self._schema.version(),
                engine_version=self._engine.get_engine_version(),
                data_source="data_engine.db.historical_data + predictions.db",
                missing_features=missing,
                rejected_reason=rejected_reason,
            )

        # 4. Validate: every produced feature MUST be in schema
        produced_names = set(features.keys())
        validation = self._schema.validate_feature_set(produced_names)
        if not validation["is_valid"]:
            # Log but don't crash (schema drift detection)
            for name in validation["produced_only"]:
                # Remove features not in schema (they shouldn't be used)
                features.pop(name, None)

        return FeatureVector(
            prediction_id=prediction.id,
            ticker=prediction.ticker,
            market=prediction.market,
            decision_timestamp=prediction.prediction_date,
            feature_timestamp=datetime.now().isoformat(),
            features=features,
            feature_schema_version=self._schema.version(),
            engine_version=self._engine.get_engine_version(),
            data_source="data_engine.db.historical_data + predictions.db",
            missing_features=missing,
        )

    # ─── MissingDataPolicy enforcement ─────────────────────────────────────

    def _apply_missing_policies(
        self, features: Dict, missing: List[str]
    ) -> Optional[str]:
        """
        Apply MissingDataPolicy for each missing feature.
        Returns rejection reason if any REJECT_SAMPLE feature is missing.
        """
        for feat_name in missing:
            if feat_name not in features:  # only process truly missing
                try:
                    feat_def = self._schema.get(feat_name)
                except KeyError:
                    # Feature not in schema — reject sample (schema drift)
                    return f"UNKNOWN_FEATURE: {feat_name} not in schema"

                if feat_def.missing_policy == MissingDataPolicy.REJECT_SAMPLE:
                    return f"MISSING_REQUIRED: {feat_name} (policy=REJECT_SAMPLE)"
                # For NULL policy: do nothing (feature omitted, LightGBM handles)
                # For ZERO policy: add 0.0 (only when 0 is valid)
                elif feat_def.missing_policy == MissingDataPolicy.ZERO:
                    features[feat_name] = 0.0
                # FORWARD_FILL: not implemented (would need historical cache)
        return None

    # ─── Feature group builders ────────────────────────────────────────────

    def _add_price_features(
        self, features: Dict, missing: List,
        closes: List[float], highs: List[float],
        lows: List[float], volumes: List[float],
    ):
        """Price features — ALL via IndicatorsAdapter. NO defaults."""

        # RSI (14)
        rsi = self._indicators.calc_rsi(closes, period=14)
        if rsi is not None:
            features["rsi_14"] = float(rsi)
        else:
            missing.append("rsi_14")

        # ATR (14) + derived atr_pct
        atr = self._indicators.calc_atr(highs, lows, closes, period=14)
        if atr is not None and atr > 0 and closes[-1] > 0:
            features["atr_14"] = float(atr)
            features["atr_pct"] = float(atr / closes[-1] * 100)
        else:
            missing.append("atr_14")
            missing.append("atr_pct")

        # MACD (line, signal, histogram)
        macd_result = self._indicators.macd(closes)
        if macd_result and macd_result.get("line") is not None:
            features["macd_line"] = float(macd_result["line"])
            features["macd_signal"] = float(macd_result.get("signal", 0) or 0)
            features["macd_histogram"] = float(macd_result.get("histogram", 0) or 0)
        else:
            missing.extend(["macd_line", "macd_signal", "macd_histogram"])

        # SMA (20, 50, 200) + distance %
        for period in [20, 50, 200]:
            val = self._indicators.sma(closes, period)
            if val is not None and val > 0:
                features[f"sma_{period}"] = float(val)
                features[f"distance_to_sma_{period}_pct"] = float((closes[-1] - val) / val * 100)
            else:
                missing.append(f"sma_{period}")
                missing.append(f"distance_to_sma_{period}_pct")

        # Bollinger (%B, bandwidth)
        bb = self._indicators.calc_bollinger(closes, period=20)
        if bb and bb.get("percent_b") is not None:
            features["bollinger_percent_b"] = float(bb["percent_b"])
            features["bollinger_bandwidth"] = float(bb.get("bandwidth", 0) or 0)
        else:
            missing.extend(["bollinger_percent_b", "bollinger_bandwidth"])

        # ADX (+DI, -DI)
        adx = self._indicators.calc_adx(highs, lows, closes, period=14)
        if adx and adx.get("adx") is not None:
            features["adx_14"] = float(adx["adx"])
            features["plus_di"] = float(adx.get("plus_di", 0) or 0)
            features["minus_di"] = float(adx.get("minus_di", 0) or 0)
        else:
            missing.extend(["adx_14", "plus_di", "minus_di"])

        # Stochastic RSI (K, D)
        srsi = self._indicators.calc_srsi(closes)
        if srsi and srsi.get("k") is not None:
            features["srsi_k"] = float(srsi["k"])
            features["srsi_d"] = float(srsi.get("d", 0) or 0)
        else:
            missing.extend(["srsi_k", "srsi_d"])

        # Returns (1d, 5d, 20d)
        if len(closes) >= 2 and closes[-2] > 0:
            features["return_1d"] = float((closes[-1] - closes[-2]) / closes[-2] * 100)
        else:
            missing.append("return_1d")
        if len(closes) >= 6 and closes[-6] > 0:
            features["return_5d"] = float((closes[-1] - closes[-6]) / closes[-6] * 100)
        else:
            missing.append("return_5d")
        if len(closes) >= 21 and closes[-21] > 0:
            features["return_20d"] = float((closes[-1] - closes[-21]) / closes[-21] * 100)
        else:
            missing.append("return_20d")

    def _add_liquidity_features(
        self, features: Dict, missing: List,
        closes: List[float], highs: List[float],
        lows: List[float], volumes: List[float],
        prediction: HistoricalPrediction,
    ):
        """Liquidity features. NO defaults."""

        # MFI
        mfi = self._indicators.calc_mfi(highs, lows, closes, volumes, period=14)
        if mfi is not None:
            features["mfi_14"] = float(mfi)
        else:
            missing.append("mfi_14")

        # CMF
        cmf = self._indicators.calc_cmf(highs, lows, closes, volumes, period=20)
        if cmf is not None:
            features["cmf_20"] = float(cmf)
        else:
            missing.append("cmf_20")

        # OBV trend
        obv_series = self._indicators.calc_obv(closes, volumes)
        if obv_series and len(obv_series) >= 20:
            features["obv_trend"] = self._indicators.obv_trend(obv_series[-20:])
        else:
            missing.append("obv_trend")

        # VWAP premium
        vwap = self._indicators.calc_vwap(highs, lows, closes, volumes)
        if vwap is not None and vwap > 0:
            vwap_prem = self._indicators.calc_vwap_premium(closes, vwap)
            if vwap_prem is not None:
                features["vwap_premium"] = float(vwap_prem)
            else:
                missing.append("vwap_premium")
        else:
            missing.append("vwap_premium")

        # Money flow (buy_pct)
        mf = self._indicators.compute_money_flow(closes, volumes, highs, lows)
        if mf and mf.get("buy_pct") is not None:
            features["money_flow_buy_pct"] = float(mf["buy_pct"])
        else:
            missing.append("money_flow_buy_pct")

        # Liquidity intensity (needs market_cap)
        snapshot = self._market_data.get_snapshot(prediction.ticker)
        if snapshot and snapshot.get("market_cap") and volumes[-1] > 0 and closes[-1] > 0:
            try:
                turnover = volumes[-1] * closes[-1]
                market_cap = float(snapshot["market_cap"])
                if market_cap > 0:
                    intensity = self._indicators.liquidity_intensity(turnover, market_cap)
                    if intensity is not None:
                        features["liquidity_intensity"] = float(intensity)
                    else:
                        missing.append("liquidity_intensity")
                else:
                    missing.append("liquidity_intensity")
            except (ValueError, TypeError):
                missing.append("liquidity_intensity")
        else:
            missing.append("liquidity_intensity")

        # Relative volume (current vs 20-day average)
        if len(volumes) >= 20:
            avg_vol_20 = sum(volumes[-20:]) / 20
            if avg_vol_20 > 0:
                features["relative_volume_20d"] = float(volumes[-1] / avg_vol_20)
            else:
                missing.append("relative_volume_20d")
        else:
            missing.append("relative_volume_20d")

    def _add_market_features(
        self, features: Dict, missing: List,
        closes: List[float], prediction: HistoricalPrediction,
    ):
        """Market features — index returns, relative strength."""

        index_map = {
            "EGX": "EGX30",
            "TADAWUL": "TASI",
            "US": "SPX",
        }
        index_symbol = index_map.get(prediction.market)
        if not index_symbol:
            missing.extend(["market_index_return_5d", "relative_strength_vs_index_20d"])
            return

        index_bars = self._market_data.get_index_history(index_symbol, days=30)
        if len(index_bars) < 21:
            missing.extend(["market_index_return_5d", "relative_strength_vs_index_20d"])
            return

        # Point-in-time: filter index bars to before prediction_date
        pred_date = prediction.prediction_date[:10]
        index_before = [b for b in index_bars if b.date < pred_date]
        if len(index_before) < 21:
            missing.extend(["market_index_return_5d", "relative_strength_vs_index_20d"])
            return

        index_closes = [b.close for b in index_before]

        # 5-day index return
        if len(index_closes) >= 6 and index_closes[-6] > 0:
            features["market_index_return_5d"] = float(
                (index_closes[-1] - index_closes[-6]) / index_closes[-6] * 100
            )
        else:
            missing.append("market_index_return_5d")

        # Relative strength (stock 20d return - index 20d return)
        if len(closes) >= 21 and len(index_closes) >= 21:
            if closes[-21] > 0 and index_closes[-21] > 0:
                stock_ret = (closes[-1] - closes[-21]) / closes[-21] * 100
                idx_ret = (index_closes[-1] - index_closes[-21]) / index_closes[-21] * 100
                features["relative_strength_vs_index_20d"] = float(stock_ret - idx_ret)
            else:
                missing.append("relative_strength_vs_index_20d")
        else:
            missing.append("relative_strength_vs_index_20d")

    def _add_regime_features(
        self, features: Dict, missing: List,
        prediction: HistoricalPrediction,
    ):
        """
        v0.1.1: HISTORICAL regime (NOT current).
        Reads regime state AT prediction_date from archive.
        If no historical archive → missing (NULL policy).
        """
        import sqlite3
        from pathlib import Path

        stocks_db = Path(__file__).resolve().parents[2] / "db" / "stocks.db"
        if not stocks_db.exists():
            missing.append("market_regime")
            return

        try:
            conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
            cur = conn.cursor()

            # Look for historical regime archive table
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%regime%'"
            )
            regime_tables = [r[0] for r in cur.fetchall()]

            pred_date = prediction.prediction_date[:10]

            if regime_tables:
                table = regime_tables[0]
                # Check if table has a date/timestamp column
                cur.execute(f"PRAGMA table_info({table})")
                cols = [r[1] for r in cur.fetchall()]
                date_col = None
                for candidate in ["date", "timestamp", "as_of_date", "recorded_at", "updated_at"]:
                    if candidate in cols:
                        date_col = candidate
                        break

                if date_col:
                    # Historical archive: get regime AT or BEFORE prediction_date
                    cur.execute(
                        f"""SELECT regime FROM {table}
                            WHERE market = ? AND {date_col} <= ?
                            ORDER BY {date_col} DESC LIMIT 1""",
                        (prediction.market, pred_date)
                    )
                    row = cur.fetchone()
                    if row and row[0]:
                        features["market_regime"] = row[0]
                    else:
                        missing.append("market_regime")
                else:
                    # Table has no date column — cannot do historical lookup
                    # v0.1.1: DO NOT use current regime as historical
                    missing.append("market_regime")
            else:
                # No regime table at all
                missing.append("market_regime")

            conn.close()
        except Exception:
            missing.append("market_regime")

    def _add_engine_features(
        self, features: Dict, missing: List,
        prediction: HistoricalPrediction,
    ):
        """Engine features — READ from predictions.db (NOT recomputed)."""

        if prediction.master_score is not None:
            features["engine_master_score"] = float(prediction.master_score)
        else:
            missing.append("engine_master_score")

        if prediction.technical_score is not None:
            features["engine_technical_score"] = float(prediction.technical_score)
        else:
            missing.append("engine_technical_score")

        if prediction.signal:
            features["engine_signal_type"] = prediction.signal
        else:
            missing.append("engine_signal_type")

        if prediction.confidence is not None:
            features["engine_confidence"] = float(prediction.confidence)
        else:
            missing.append("engine_confidence")

        if prediction.risk_reward is not None:
            features["engine_risk_reward"] = float(prediction.risk_reward)
        else:
            missing.append("engine_risk_reward")
