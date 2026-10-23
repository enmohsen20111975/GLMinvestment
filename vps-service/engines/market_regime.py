"""
Market Regime Engine — EGX30/EGX100 Stage Detection
=====================================================
Uses real index data to determine market stage (Minervini 1-4):
- Stage 1: Consolidation (price around SMA200, low slope)
- Stage 2: Bull Market (price > SMA200, SMA50 > SMA200, positive slope)
- Stage 3: Distribution (price > SMA200 but weakening)
- Stage 4: Bear Market (price < SMA200, negative slope)

Data Source: price_history.db (EGX30/EGX100 ticker, 2021-2026)
"""

import sqlite3
import sys
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path
import os
# BRAVO INDICATOR-UNIFY: canonical SMA + ADX
_VPS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _VPS_ROOT not in sys.path:
    sys.path.insert(0, _VPS_ROOT)
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.adx import calc_adx as _canonical_adx

logger = logging.getLogger(__name__)

# Resolve project root: engines/ -> vps-service/ -> project root (my-project/)
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DB = str(_PROJECT_ROOT / "db" / "price_history.db")


@dataclass
class RegimeResult:
    stage: int               # 1-4
    stage_name: str          # "Bull Market", "Bear Market", etc.
    price: float             # Current EGX30 price
    sma50: float             # 50-day SMA
    sma200: float            # 200-day SMA
    slope_50: float          # SMA50 slope (%)
    slope_200: float         # SMA200 slope (%)
    adx: float               # ADX value (0 if not enough data)
    confidence: float        # 0-100
    trading_allowed: bool    # Whether trading is allowed
    position_modifier: float  # 1.0 (full), 0.5 (half), 0.0 (none)
    date: str                # Date of analysis
    index_ticker: str        # Which index was used
    reason: str              # Human-readable explanation

    def to_dict(self) -> dict:
        return asdict(self)


class MarketRegimeEngine:
    """
    Determines the current market regime using EGX30 index data
    from price_history.db and Minervini stage classification.
    """

    DB_PATH: str = _DEFAULT_DB
    INDEX_TICKER: str = "EGX30"
    SMA_SHORT: int = 50
    SMA_LONG: int = 200
    SLOPE_LOOKBACK: int = 20  # Days to measure SMA slope

    # Stage classification thresholds
    SLOPE_BULL_THRESHOLD: float = 0.002    # 0.2% over 20 days
    SLOPE_BEAR_THRESHOLD: float = -0.002   # -0.2% over 20 days

    def __init__(self, db_path: str = None, index_ticker: str = None):
        self.db_path = db_path or self.DB_PATH
        self.index_ticker = index_ticker or self.INDEX_TICKER

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_regime(self, as_of_date: str = None) -> RegimeResult:
        """
        Get current market regime. If as_of_date is None, use latest available date.
        Returns a RegimeResult with full stage analysis.
        """
        try:
            closes, dates = self._load_closes(as_of_date)
        except Exception as e:
            # P23-FILTER-HOTFIX: ده expected لو EGX30 مش متوفر في price_history.db.
            # الـ fallback محايد (Stage 1, position_modifier=0.5) → مفيش لازم log ERROR.
            # خفّضنا لـ DEBUG عشان نتجنب log spam اللي بيغطي على أخطاء حقيقية.
            logger.debug(f"[MarketRegime] EGX30 data unavailable (using neutral fallback): {e}")
            return self._default_regime(as_of_date, reason=f"Data load error: {e}")

        if len(closes) < self.SMA_LONG + 10:
            logger.warning(
                f"[MarketRegime] Insufficient data: {len(closes)} rows "
                f"(need {self.SMA_LONG + 10})"
            )
            return self._default_regime(
                as_of_date,
                reason=f"Insufficient data ({len(closes)}/{self.SMA_LONG + 10})"
            )

        current_price = closes[-1]
        current_date = dates[-1]

        # Calculate SMAs
        sma50 = self._calc_sma(closes, self.SMA_SHORT)
        sma200 = self._calc_sma(closes, self.SMA_LONG)

        if sma50 is None or sma200 is None:
            return self._default_regime(
                current_date,
                price=current_price,
                reason="Could not calculate SMAs"
            )

        # Calculate slopes
        slope_50 = self._calc_slope(closes, self.SMA_SHORT, self.SLOPE_LOOKBACK)
        slope_200 = self._calc_slope(closes, self.SMA_LONG, self.SLOPE_LOOKBACK)

        if slope_50 is None:
            slope_50 = 0.0
        if slope_200 is None:
            slope_200 = 0.0

        # Calculate ADX (simplified)
        adx = self._calc_adx(closes)

        # Determine stage
        stage, stage_name = self._determine_stage(
            current_price, sma50, sma200, slope_50, slope_200
        )

        # Calculate confidence
        confidence = self._calc_confidence(
            stage, current_price, sma50, sma200, slope_50, slope_200
        )

        # Trading rules based on stage
        trading_allowed, position_modifier = self._trading_rules(stage)

        result = RegimeResult(
            stage=stage,
            stage_name=stage_name,
            price=round(current_price, 2),
            sma50=round(sma50, 2),
            sma200=round(sma200, 2),
            slope_50=round(slope_50 * 100, 4),  # As percentage
            slope_200=round(slope_200 * 100, 4),
            adx=round(adx, 2),
            confidence=round(confidence, 1),
            trading_allowed=trading_allowed,
            position_modifier=position_modifier,
            date=current_date,
            index_ticker=self.index_ticker,
            reason=self._stage_reason(stage, current_price, sma200, slope_200)
        )

        logger.info(
            f"[MarketRegime] {self.index_ticker} Stage {stage} ({stage_name}) | "
            f"Price: {current_price:.2f} | SMA200: {sma200:.2f} | "
            f"Slope200: {slope_200*100:.3f}% | Confidence: {confidence:.0f}% | "
            f"Trading: {'ALLOWED' if trading_allowed else 'PAUSED'}"
        )

        return result

    def get_regime_history(self, days: int = 30) -> List[RegimeResult]:
        """
        Get regime for the last N trading days.
        Returns a list of RegimeResult objects, one per day.
        """
        results: List[RegimeResult] = []

        try:
            closes, dates = self._load_closes()
        except Exception as e:
            logger.error(f"[MarketRegime] Error loading data for history: {e}")
            return results

        if len(closes) < self.SMA_LONG + 10:
            logger.warning(f"[MarketRegime] Not enough data for history")
            return results

        # Start from the point where we have enough data for SMA200
        start_idx = max(self.SMA_LONG + 10, len(closes) - days)

        for i in range(start_idx, len(closes)):
            subset_closes = closes[:i + 1]
            subset_date = dates[i]

            regime = self.get_regime(as_of_date=subset_date)
            if regime is not None:
                results.append(regime)

        return results

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------

    def _load_closes(self, as_of_date: str = None) -> Tuple[List[float], List[str]]:
        """
        Load closing prices from price_history.db for the configured index ticker.
        Returns (closes, dates) in chronological order.
        """
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(f"Database not found: {self.db_path}")

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=False)
        try:
            query = """
                SELECT date, close_price
                FROM price_history
                WHERE ticker = ?
            """
            params: list = [self.index_ticker]

            if as_of_date:
                query += " AND date <= ?"
                params.append(as_of_date)

            query += " ORDER BY date ASC"

            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
        finally:
            conn.close()

        if not rows:
            raise ValueError(
                f"No data found for ticker '{self.index_ticker}'"
                + (f" up to {as_of_date}" if as_of_date else "")
            )

        dates = [row[0] for row in rows]
        closes = [float(row[1]) for row in rows]

        return closes, dates

    # ------------------------------------------------------------------
    # Technical calculations
    # ------------------------------------------------------------------

    def _calc_sma(self, closes: list, period: int) -> Optional[float]:
        """SMA — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma."""
        return _canonical_sma(closes, period)

    def _calc_slope(self, closes: list, period: int, lookback: int = 5) -> Optional[float]:
        """
        SMA slope as a percentage change over `lookback` days.
        Compares current SMA to SMA `lookback` days ago.
        Returns a ratio (e.g., 0.005 = 0.5%).
        """
        if len(closes) < period + lookback:
            return None

        # Current SMA
        current_sma = sum(closes[-period:]) / period

        # SMA from `lookback` days ago
        start = len(closes) - period - lookback
        end = len(closes) - lookback
        past_sma = sum(closes[start:end]) / period

        if past_sma == 0:
            return 0.0

        return (current_sma - past_sma) / past_sma

    def _calc_adx(self, closes: list, period: int = 14) -> float:
        """
        ADX — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.adx.calc_adx (Wilder's smoothing).
        Returns a value 0-100. Higher = stronger trend.
        Backward-compat: returns 0.0 on insufficient data.

        Note: local signature only takes `closes` — we pass closes as proxy for
        highs/lows (consistent with Rule 67 single-source delegation).
        """
        result = _canonical_adx(closes, closes, closes, period)
        if result is None:
            return 0.0
        return result['adx']

    # ------------------------------------------------------------------
    # Stage classification
    # ------------------------------------------------------------------

    def _determine_stage(
        self,
        price: float,
        sma50: float,
        sma200: float,
        slope_50: float,
        slope_200: float
    ) -> Tuple[int, str]:
        """
        Determine Minervini Stage 1-4 based on price, SMAs, and slopes.

        Stage 2 (Bull Market):
            price > SMA200 AND SMA50 > SMA200 AND slope_200 > threshold

        Stage 4 (Bear Market):
            price < SMA200 AND slope_200 < -threshold

        Stage 3 (Distribution):
            price > SMA200 but not meeting Stage 2 conditions
            (weakening trend, SMA50 crossing below SMA200, etc.)

        Stage 1 (Consolidation):
            Everything else (price around SMA200, flat slopes)
        """
        # Stage 2: Clear uptrend — all systems go
        if price > sma200 and sma50 > sma200 and slope_200 > self.SLOPE_BULL_THRESHOLD:
            return 2, "Bull Market"

        # Stage 4: Bear market — price below SMA200 with declining SMA200
        if price < sma200 and slope_200 < self.SLOPE_BEAR_THRESHOLD:
            return 4, "Bear Market"

        # Stage 3: Distribution — price above SMA200 but weakening
        #   Either SMA50 < SMA200 (death cross forming) or slope is flat/negative
        #   while still above SMA200
        if price > sma200:
            if sma50 < sma200:
                # Death cross forming while price still above = distribution
                return 3, "Distribution"
            if slope_200 <= 0:
                # SMA200 flattening/declining while price above = late cycle
                return 3, "Distribution"
            # price > SMA200, SMA50 > SMA200, but slope_200 is weak (0 to 0.002)
            # This is a weak Stage 2 that we classify as Stage 3 for safety
            return 3, "Distribution"

        # Stage 1: Consolidation — price below or near SMA200 but not in downtrend
        #   Either slope_200 is flat/positive (bottoming) or price is near SMA200
        if price < sma200 and slope_200 >= self.SLOPE_BEAR_THRESHOLD:
            return 1, "Consolidation"

        # Fallback: Stage 1
        return 1, "Consolidation"

    def _calc_confidence(
        self,
        stage: int,
        price: float,
        sma50: float,
        sma200: float,
        slope_50: float,
        slope_200: float
    ) -> float:
        """
        Calculate confidence score (0-100) for the regime classification.
        Higher confidence = more certainty in the stage assignment.
        """
        confidence = 50.0  # Base

        if stage == 2:
            # Stronger signals increase confidence
            if price > sma200 * 1.05:  # 5% above SMA200
                confidence += 15
            elif price > sma200:
                confidence += 8
            if sma50 > sma200 * 1.02:  # 2% above SMA200
                confidence += 10
            if slope_200 > 0.01:  # Strong uptrend
                confidence += 15
            elif slope_200 > 0.005:
                confidence += 8

        elif stage == 4:
            if price < sma200 * 0.95:  # 5% below SMA200
                confidence += 15
            elif price < sma200:
                confidence += 8
            if slope_200 < -0.01:  # Strong downtrend
                confidence += 15
            elif slope_200 < -0.005:
                confidence += 8

        elif stage == 3:
            # Distribution is inherently less certain
            if sma50 < sma200:
                confidence += 10
            if slope_200 <= 0:
                confidence += 5
            # Near SMA200 = less certain
            if abs(price - sma200) / sma200 < 0.03:
                confidence -= 10

        elif stage == 1:
            # Consolidation — low conviction by nature
            if abs(slope_200) < 0.001:  # Very flat
                confidence += 10
            if abs(price - sma200) / sma200 < 0.05:  # Near SMA200
                confidence += 10
            else:
                confidence -= 10

        return max(0.0, min(100.0, confidence))

    def _trading_rules(self, stage: int) -> Tuple[bool, float]:
        """
        Determine trading rules based on market stage.
        Returns (trading_allowed, position_modifier).
        """
        if stage == 2:
            # Bull market: full trading
            return True, 1.0
        elif stage == 1:
            # Consolidation: cautious, half positions
            return True, 0.5
        elif stage == 3:
            # Distribution: cautious, half positions
            return True, 0.5
        elif stage == 4:
            # Bear market: no new trades
            return False, 0.0
        else:
            # Unknown: cautious
            return True, 0.5

    def _stage_reason(
        self, stage: int, price: float, sma200: float, slope_200: float
    ) -> str:
        """Generate a human-readable reason for the stage classification."""
        price_vs_sma = ((price - sma200) / sma200) * 100 if sma200 > 0 else 0
        slope_pct = slope_200 * 100

        if stage == 2:
            return (
                f"EGX30 {price:.0f} is {price_vs_sma:+.1f}% above SMA200 "
                f"with SMA200 rising {slope_pct:+.3f}%/20d — clear uptrend"
            )
        elif stage == 4:
            return (
                f"EGX30 {price:.0f} is {price_vs_sma:+.1f}% vs SMA200 "
                f"with SMA200 falling {slope_pct:+.3f}%/20d — bear market"
            )
        elif stage == 3:
            return (
                f"EGX30 {price:.0f} is {price_vs_sma:+.1f}% vs SMA200 "
                f"but trend weakening (slope {slope_pct:+.3f}%/20d) — distribution"
            )
        else:
            return (
                f"EGX30 {price:.0f} is {price_vs_sma:+.1f}% vs SMA200 "
                f"(slope {slope_pct:+.3f}%/20d) — consolidation"
            )

    def _default_regime(
        self, as_of_date: str = None, price: float = 0.0, reason: str = ""
    ) -> RegimeResult:
        """
        Return a default Stage 1 (consolidation/cautious) result
        when data is unavailable or errors occur.
        """
        date_str = as_of_date or datetime.now().strftime("%Y-%m-%d")
        return RegimeResult(
            stage=1,
            stage_name="Consolidation",
            price=price,
            sma50=0.0,
            sma200=0.0,
            slope_50=0.0,
            slope_200=0.0,
            adx=0.0,
            confidence=0.0,
            trading_allowed=True,
            position_modifier=0.5,  # Cautious by default
            date=date_str,
            index_ticker=self.index_ticker,
            reason=f"Default (data unavailable): {reason}" if reason else "Default: data unavailable"
        )


# ------------------------------------------------------------------
# Backwards-compatible function (used by existing code)
# ------------------------------------------------------------------

def get_index_stage(index_symbol: str = "EGX30", target_date: str = None, lookback: int = 300) -> dict:
    """
    Backwards-compatible function returning a dict (old API).
    Delegates to MarketRegimeEngine internally.
    """
    engine = MarketRegimeEngine(index_ticker=index_symbol)
    result = engine.get_regime(as_of_date=target_date)
    return {
        "stage": result.stage,
        "reason": result.reason,
        "close": result.price,
        "sma200": result.sma200,
        "sma50": result.sma50,
        "slope": result.slope_200 / 100 if result.slope_200 else 0.0,
        "date": result.date,
    }


# ------------------------------------------------------------------
# CLI / standalone test
# ------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    engine = MarketRegimeEngine()
    result = engine.get_regime()

    print(f"\n{'='*60}")
    print(f"  EGX30 Market Regime Analysis")
    print(f"{'='*60}")
    print(f"  Date:           {result.date}")
    print(f"  Stage:          {result.stage} — {result.stage_name}")
    print(f"  Price:          {result.price:,.2f}")
    print(f"  SMA50:          {result.sma50:,.2f}")
    print(f"  SMA200:         {result.sma200:,.2f}")
    print(f"  SMA50 Slope:    {result.slope_50:+.4f}%")
    print(f"  SMA200 Slope:   {result.slope_200:+.4f}%")
    print(f"  ADX:            {result.adx:.1f}")
    print(f"  Confidence:     {result.confidence:.1f}%")
    print(f"  Trading:        {'ALLOWED' if result.trading_allowed else 'PAUSED'}")
    print(f"  Position Size:  {result.position_modifier * 100:.0f}%")
    print(f"  Reason:         {result.reason}")
    print(f"{'='*60}\n")
