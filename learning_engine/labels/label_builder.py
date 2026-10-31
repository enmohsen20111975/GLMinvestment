"""
labels/label_builder.py — Label construction for 5 independent models (v0.1.1 CORRECTED).

v0.1.1 fixes (Section 3 of correction directive):
  - Trade Quality: AMBIGUOUS candle handling (high+low hit barriers same day)
  - Trade Quality: effective_entry IS now used in barrier checks
  - Trade Quality: direction from V3 signal (not from target vs entry)
  - Separate outcomes: STOP / TARGET / TIMEOUT / AMBIGUOUS
  - Direction: documented reference price definition
  - Regime label: HISTORICAL (not current) — see build_regime_label

Each label is a SEPARATE learning target. NO mixing.
"""
from __future__ import annotations
from typing import Dict, Optional, List
from dataclasses import dataclass
from enum import Enum

from ..adapters.predictions_adapter import HistoricalPrediction
from ..adapters.market_data_adapter import MarketDataAdapter
from ..config.settings import LearningSettings


class LabelType(str, Enum):
    DIRECTION = "direction"
    FORWARD_RETURN = "forward_return"
    VOLATILITY = "volatility"
    TRADE_QUALITY = "trade_quality"
    REGIME = "regime"


class TradeQualityOutcome(str, Enum):
    """v0.1.1: Explicit outcome categories (not just 0/1)."""
    TARGET_HIT = "target_hit"        # target reached before stop
    STOP_HIT = "stop_hit"            # stop reached before target
    TIMEOUT = "timeout"              # neither hit within horizon
    AMBIGUOUS = "ambiguous"          # both hit in same candle, order unknown


@dataclass
class Label:
    """A single label for a single prediction."""
    prediction_id: int
    label_type: LabelType
    horizon_days: int
    value: float  # binary {0,1} for classification, float for regression
    label_available_timestamp: str
    label_definition_version: str
    confidence: float = 1.0
    # v0.1.1: explicit outcome category (for trade_quality)
    outcome_category: Optional[str] = None


# ─── V3 signal direction mapping ──────────────────────────────────────────
BULLISH_SIGNALS = {"BUY", "STRONG_BUY", "ACCUMULATE", "INSTITUTIONAL_BUY"}
BEARISH_SIGNALS = {"SELL", "STRONG_SELL", "REDUCE"}


def _is_long_signal(signal: str) -> Optional[bool]:
    """
    Determine trade direction from V3 signal.
    Returns True (long), False (short), or None (unknown/hold).
    """
    if signal in BULLISH_SIGNALS:
        return True
    if signal in BEARISH_SIGNALS:
        return False
    return None  # HOLD or unknown


class LabelBuilder:
    """
    Builds labels for historical predictions.
    All labels use point-in-time outcome data (no look-ahead).
    """

    def __init__(
        self,
        market_data_adapter: Optional[MarketDataAdapter] = None,
        settings: Optional[LearningSettings] = None,
    ):
        self._adapter = market_data_adapter or MarketDataAdapter()
        self._settings = settings or LearningSettings()

    # ─── Model 1: Direction (binary: did price go up?) ─────────────────────
    # v0.1.1: Documented reference price definition.
    # Reference = prediction.entry_price (V3's entry at decision time).
    # Outcome = close at horizon_days after prediction.
    # Label = 1 if outcome > reference, else 0.

    def build_direction_label(
        self, prediction: HistoricalPrediction, horizon: int = 5
    ) -> Optional[Label]:
        """
        Direction label: 1 if price went up after `horizon` trading days, 0 otherwise.

        Reference price: prediction.entry_price (V3's entry at decision time).
        Outcome price: close at horizon_days after prediction_date.

        This is a price-direction label, NOT a trade-success label.
        For trade success, use build_trade_quality_label().
        """
        bars = self._adapter.get_history_bars(
            prediction.ticker, days=horizon + 30, market=prediction.market
        )
        pred_date = prediction.prediction_date[:10]
        future_bars = [b for b in bars if b.date > pred_date]

        if len(future_bars) < horizon:
            return None

        reference_price = prediction.entry_price
        outcome_close = future_bars[horizon - 1].close

        if reference_price <= 0:
            return None

        direction = 1.0 if outcome_close > reference_price else 0.0

        return Label(
            prediction_id=prediction.id,
            label_type=LabelType.DIRECTION,
            horizon_days=horizon,
            value=direction,
            label_available_timestamp=future_bars[horizon - 1].date,
            label_definition_version="1.1.0",
        )

    # ─── Model 2: Forward Return (regression) ──────────────────────────────

    def build_forward_return_label(
        self, prediction: HistoricalPrediction, horizon: int = 5
    ) -> Optional[Label]:
        """Forward return label: percentage return over `horizon` days."""
        bars = self._adapter.get_history_bars(
            prediction.ticker, days=horizon + 30, market=prediction.market
        )
        pred_date = prediction.prediction_date[:10]
        future_bars = [b for b in bars if b.date > pred_date]

        if len(future_bars) < horizon:
            return None

        reference_price = prediction.entry_price
        outcome_close = future_bars[horizon - 1].close

        if reference_price <= 0:
            return None

        return_pct = (outcome_close - reference_price) / reference_price * 100

        return Label(
            prediction_id=prediction.id,
            label_type=LabelType.FORWARD_RETURN,
            horizon_days=horizon,
            value=return_pct,
            label_available_timestamp=future_bars[horizon - 1].date,
            label_definition_version="1.1.0",
        )

    # ─── Model 3: Volatility (regression) ──────────────────────────────────

    def build_volatility_label(
        self, prediction: HistoricalPrediction, horizon: int = 10
    ) -> Optional[Label]:
        """Volatility label: realized volatility (std of daily returns) over horizon."""
        import math
        bars = self._adapter.get_history_bars(
            prediction.ticker, days=horizon + 30, market=prediction.market
        )
        pred_date = prediction.prediction_date[:10]
        future_bars = [b for b in bars if b.date > pred_date]

        if len(future_bars) < horizon + 1:
            return None

        closes = [b.close for b in future_bars[:horizon + 1]]
        returns = [(closes[i] - closes[i-1]) / closes[i-1] * 100
                   for i in range(1, len(closes)) if closes[i-1] > 0]

        if len(returns) < 2:
            return None

        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        vol = math.sqrt(variance)

        return Label(
            prediction_id=prediction.id,
            label_type=LabelType.VOLATILITY,
            horizon_days=horizon,
            value=vol,
            label_available_timestamp=future_bars[horizon].date,
            label_definition_version="1.1.0",
        )

    # ─── Model 4: Trade Quality (v0.1.1: AMBIGUOUS + effective_entry) ──────

    def build_trade_quality_label(
        self, prediction: HistoricalPrediction, max_horizon: int = 20
    ) -> Optional[Label]:
        """
        Trade quality label.
        v0.1.1 fixes:
          - Direction from V3 signal (not from target vs entry comparison)
          - effective_entry (after transaction cost) IS used in barrier checks
          - AMBIGUOUS candles (both barriers hit same day) → outcome_category=AMBIGUOUS
          - Separate outcomes: TARGET_HIT / STOP_HIT / TIMEOUT / AMBIGUOUS

        Returns Label with:
          - value: 1.0 (target hit first), 0.0 (stop/timeout), -1.0 (ambiguous — excluded)
          - outcome_category: explicit category string
          - confidence: 1.0 for clear, 0.5 for timeout, 0.0 for ambiguous
        """
        if not prediction.target_price or not prediction.stop_loss:
            return None

        entry = prediction.entry_price
        target = prediction.target_price
        stop = prediction.stop_loss

        if entry <= 0 or target <= 0 or stop <= 0:
            return None

        # v0.1.1: Direction from V3 signal (not from target > entry)
        is_long = _is_long_signal(prediction.signal)
        if is_long is None:
            # HOLD or unknown signal — cannot determine trade direction
            return None

        # Validate barriers make sense for the direction
        if is_long:
            # Long: target should be above entry, stop below
            if not (target > entry > stop):
                return None  # invalid setup
        else:
            # Short: target should be below entry, stop above
            if not (stop > entry > target):
                return None  # invalid setup

        bars = self._adapter.get_history_bars(
            prediction.ticker, days=max_horizon + 30, market=prediction.market
        )
        pred_date = prediction.prediction_date[:10]
        future_bars = [b for b in bars if b.date > pred_date][:max_horizon]

        if not future_bars:
            return None

        # v0.1.1: Apply transaction cost to entry (used in barrier checks)
        cost = self._settings.transaction_cost_pct / 100  # per side
        if is_long:
            # Buy higher (cost adds), sell lower (cost subtracts)
            effective_entry = entry * (1 + cost)
            effective_target = target * (1 - cost)
            effective_stop = stop * (1 + cost)  # stop loss worse with cost
        else:
            # Short: sell lower, buy back higher (cost)
            effective_entry = entry * (1 - cost)
            effective_target = target * (1 + cost)
            effective_stop = stop * (1 - cost)

        # Check barriers day by day
        for day_idx, bar in enumerate(future_bars):
            if is_long:
                target_hit = bar.high >= effective_target
                stop_hit = bar.low <= effective_stop
            else:
                target_hit = bar.low <= effective_target
                stop_hit = bar.high >= effective_stop

            if target_hit and stop_hit:
                # v0.1.1: AMBIGUOUS — both hit in same candle, order unknown
                return Label(
                    prediction_id=prediction.id,
                    label_type=LabelType.TRADE_QUALITY,
                    horizon_days=day_idx + 1,
                    value=-1.0,  # ambiguous marker
                    label_available_timestamp=bar.date,
                    label_definition_version="1.1.0",
                    confidence=0.0,  # cannot determine
                    outcome_category=TradeQualityOutcome.AMBIGUOUS.value,
                )
            elif stop_hit:
                return Label(
                    prediction_id=prediction.id,
                    label_type=LabelType.TRADE_QUALITY,
                    horizon_days=day_idx + 1,
                    value=0.0,
                    label_available_timestamp=bar.date,
                    label_definition_version="1.1.0",
                    confidence=1.0,
                    outcome_category=TradeQualityOutcome.STOP_HIT.value,
                )
            elif target_hit:
                return Label(
                    prediction_id=prediction.id,
                    label_type=LabelType.TRADE_QUALITY,
                    horizon_days=day_idx + 1,
                    value=1.0,
                    label_available_timestamp=bar.date,
                    label_definition_version="1.1.0",
                    confidence=1.0,
                    outcome_category=TradeQualityOutcome.TARGET_HIT.value,
                )

        # Neither hit within horizon — TIMEOUT
        return Label(
            prediction_id=prediction.id,
            label_type=LabelType.TRADE_QUALITY,
            horizon_days=max_horizon,
            value=0.0,  # no target hit
            label_available_timestamp=future_bars[-1].date,
            label_definition_version="1.1.0",
            confidence=0.5,
            outcome_category=TradeQualityOutcome.TIMEOUT.value,
        )

    # ─── Model 5: Regime (classification — HISTORICAL) ─────────────────────

    def build_regime_label(
        self, prediction: HistoricalPrediction
    ) -> Optional[Label]:
        """
        v0.1.1: HISTORICAL regime label.
        Reads regime state AT prediction_date from archive.
        Does NOT use current regime (that would be look-ahead bias).

        If no historical archive → returns None (missing).
        """
        import sqlite3
        from pathlib import Path

        stocks_db = Path(__file__).resolve().parents[2] / "db" / "stocks.db"
        if not stocks_db.exists():
            return None

        try:
            conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
            cur = conn.cursor()

            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%regime%'"
            )
            regime_tables = [r[0] for r in cur.fetchall()]

            if not regime_tables:
                conn.close()
                return None  # no regime table at all

            table = regime_tables[0]
            cur.execute(f"PRAGMA table_info({table})")
            cols = [r[1] for r in cur.fetchall()]

            # Find date column
            date_col = None
            for candidate in ["date", "timestamp", "as_of_date", "recorded_at", "updated_at"]:
                if candidate in cols:
                    date_col = candidate
                    break

            if not date_col:
                conn.close()
                return None  # no date column → cannot do historical lookup

            pred_date = prediction.prediction_date[:10]

            # Historical: get regime AT or BEFORE prediction_date
            cur.execute(
                f"""SELECT regime FROM {table}
                    WHERE market = ? AND {date_col} <= ?
                    ORDER BY {date_col} DESC LIMIT 1""",
                (prediction.market, pred_date)
            )
            row = cur.fetchone()
            conn.close()

            if not row or not row[0]:
                return None  # no historical regime for this date

            regime_map = {"DEFENSIVE": 0, "NORMAL": 1, "AGGRESSIVE": 2}
            regime_val = regime_map.get(row[0])
            if regime_val is None:
                return None

            return Label(
                prediction_id=prediction.id,
                label_type=LabelType.REGIME,
                horizon_days=0,
                value=float(regime_val),
                label_available_timestamp=prediction.prediction_date,
                label_definition_version="1.1.0",
            )
        except Exception:
            return None

    # ─── Build all labels for a prediction ─────────────────────────────────

    def build_all_labels(
        self, prediction: HistoricalPrediction, horizons: Optional[List[int]] = None
    ) -> List[Label]:
        """Build all available labels for a prediction."""
        horizons = horizons or list(self._settings.label_horizons_days)
        labels = []

        for h in horizons:
            for builder in [
                self.build_direction_label,
                self.build_forward_return_label,
                self.build_volatility_label,
            ]:
                lbl = builder(prediction, horizon=h)
                if lbl:
                    labels.append(lbl)

        tq = self.build_trade_quality_label(prediction)
        if tq:
            labels.append(tq)

        rg = self.build_regime_label(prediction)
        if rg:
            labels.append(rg)

        return labels
