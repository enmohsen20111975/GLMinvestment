#!/usr/bin/env python3
"""
Adaptive Scoring Engine — Dynamic Weight System
================================================
Research deliverable: implements the 10-pattern dynamic scoring framework
described in DYNAMIC_SCORING_RESEARCH.md.

Adjusts component weights based on 4 dimensions:
  1. Market Regime  (BULL / RANGE / BEAR)
  2. Stock Type     (large / mid / small)
  3. Liquidity State (5 states)
  4. Cycle Position  (6 Wyckoff/ICT phases)

Collapses 270 theoretical combinations into 10 working patterns.

Integration: designed to sit as a WEIGHT OVERRIDE layer on top of the
existing BoardOfAnalysts / EGXBoardManager, NOT replace it. It computes
the optimal weights, then the BoardManager normalizes and applies them.

Dependencies: numpy, pandas, sqlite3 (all already in the project)
Optional:    hmmlearn (existing in project via hmm_market_regime.py)

Usage:
    from adaptive_scoring_engine import AdaptiveScoringEngine
    engine = AdaptiveScoringEngine(db_path='db/stocks.db')
    result = engine.score_stock('COMI')
    print(result['pattern_name'], result['weights'], result['weighted_score'])

Author: Bravo (Quantitative Research)
Date: 2026-10-19
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np

logger = logging.getLogger(__name__)

# Resolve DB paths (consistent with project convention)
try:
    from utils.db_paths import DBPaths
    _STOCKS_DB = DBPaths.STOCKS_DB
    _PRICE_HISTORY_DB = DBPaths.PRICE_HISTORY_DB
except Exception:
    _BASE_DIR = Path(__file__).resolve().parent.parent.parent
    _STOCKS_DB = str(_BASE_DIR / 'db' / 'stocks.db')
    _PRICE_HISTORY_DB = str(_BASE_DIR / 'db' / 'price_history.db')


# ============================================================================
# THE 10 PATTERNS — Dynamic Weight Definitions
# ============================================================================
# Each pattern defines:
#   - conditions: which dimension states trigger this pattern
#   - weights:    component weights (sum = 1.0)
#   - conviction: Kelly multiplier (0.1 - 0.5)
#   - priority:   selection priority (lower = higher priority)
#   - description: human-readable explanation

PATTERNS: Dict[str, Dict] = {
    "TREND_RIDER": {
        "description": "Bull-market momentum play on liquid stocks",
        "priority": 7,
        "conviction": 0.50,  # half Kelly
        "conditions": {
            "regime": ["BULL"],
            "stock_type": ["large", "mid"],
            "liquidity": ["STRONG_INFLOW", "MODERATE_INFLOW"],
            "cycle": ["MARKUP_START", "MARKUP_MID"],
        },
        "weights": {
            "trend": 0.45, "technicals": 0.20, "fundamentals": 0.20,
            "volume_profile": 0.10, "smc": 0.05,
        },
    },
    "VALUE_ACCUMULATOR": {
        "description": "Accumulating quality large-caps in a range at fair value",
        "priority": 8,
        "conviction": 0.25,
        "conditions": {
            "regime": ["RANGE", "BULL"],
            "stock_type": ["large"],
            "liquidity": ["NEUTRAL", "MODERATE_INFLOW"],
            "cycle": ["STOPPING_ACTION", "SPRING"],
        },
        "weights": {
            "fundamentals": 0.40, "volume_profile": 0.25, "smc": 0.20,
            "trend": 0.10, "mean_reversion": 0.05,
        },
    },
    "SPRING_HUNTER": {
        "description": "Catching the Wyckoff Spring / ICT Liquidity Sweep",
        "priority": 3,
        "conviction": 0.40,
        "conditions": {
            "regime": ["BEAR", "RANGE", "BULL"],  # any — spring is cycle-dominant
            "stock_type": ["mid", "small"],
            "liquidity": ["NEUTRAL", "MODERATE_INFLOW"],
            "cycle": ["SPRING"],
        },
        "weights": {
            "smc": 0.40, "volume_profile": 0.30, "trend": 0.15,
            "fundamentals": 0.10, "mean_reversion": 0.05,
        },
    },
    "BREAKOUT_RIDER": {
        "description": "Small-cap breakout with volume — ride thin-market momentum",
        "priority": 6,
        "conviction": 0.30,
        "conditions": {
            "regime": ["BULL", "RANGE"],
            "stock_type": ["small"],
            "liquidity": ["MODERATE_INFLOW", "STRONG_INFLOW"],
            "cycle": ["MARKUP_START"],
        },
        "weights": {
            "trend": 0.35, "volume_profile": 0.30, "smc": 0.20,
            "fundamentals": 0.10, "mean_reversion": 0.05,
        },
    },
    "DISTRIBUTION_EXIT": {
        "description": "Selling into strength — smart money distributing",
        "priority": 4,
        "conviction": 0.0,  # exit pattern — no new entry
        "conditions": {
            "regime": ["BULL", "RANGE"],
            "stock_type": ["large", "mid"],
            "liquidity": ["OUTFLOW"],
            "cycle": ["DISTRIBUTION_START"],
        },
        "weights": {
            "smc": 0.35, "volume_profile": 0.30, "fundamentals": 0.20,
            "trend": 0.10, "mean_reversion": 0.05,
        },
    },
    "BEAR_DEFENDER": {
        "description": "Surviving a bear market — capital preservation",
        "priority": 2,
        "conviction": 0.10,
        "conditions": {
            "regime": ["BEAR"],
            "stock_type": ["large"],
            "liquidity": ["OUTFLOW", "STRONG_OUTFLOW"],
            "cycle": ["DISTRIBUTION_MID", "STOPPING_ACTION"],
        },
        "weights": {
            "smc": 0.40, "volume_profile": 0.30, "fundamentals": 0.20,
            "trend": 0.05, "mean_reversion": 0.05,
        },
    },
    "MEAN_REVERSION_RANGE": {
        "description": "Trading the range — buy low, sell high at VP nodes",
        "priority": 10,  # lowest priority — default fallback
        "conviction": 0.20,
        "conditions": {
            "regime": ["RANGE"],
            "stock_type": ["large", "mid"],
            "liquidity": ["NEUTRAL"],
            "cycle": ["STOPPING_ACTION", "DISTRIBUTION_MID"],  # mid-cycle
        },
        "weights": {
            "volume_profile": 0.35, "smc": 0.25, "fundamentals": 0.20,
            "mean_reversion": 0.15, "trend": 0.05,
        },
    },
    "LIQUIDITY_DRAIN_SURVIVOR": {
        "description": "Thin stock losing liquidity — protect capital, exit",
        "priority": 1,  # highest priority — override everything
        "conviction": 0.0,  # exit / avoid pattern
        "conditions": {
            "regime": ["BULL", "RANGE", "BEAR"],  # any
            "stock_type": ["small"],
            "liquidity": ["OUTFLOW", "STRONG_OUTFLOW"],
            "cycle": ["STOPPING_ACTION", "SPRING", "MARKUP_START",
                       "MARKUP_MID", "DISTRIBUTION_START", "DISTRIBUTION_MID"],
        },
        "weights": {
            "volume_profile": 0.40, "smc": 0.35, "trend": 0.15,
            "fundamentals": 0.10,
        },
    },
    "BOTTOM_FISHER": {
        "description": "Catching the selling climax — high risk, high reward",
        "priority": 5,
        "conviction": 0.15,
        "conditions": {
            "regime": ["BEAR", "RANGE"],
            "stock_type": ["mid", "small"],
            "liquidity": ["STRONG_OUTFLOW"],
            "cycle": ["STOPPING_ACTION"],
        },
        "weights": {
            "smc": 0.35, "volume_profile": 0.35, "fundamentals": 0.20,
            "trend": 0.05, "mean_reversion": 0.05,
        },
    },
    "SAFE_HAVEN_LARGE_CAP": {
        "description": "Defensive large-cap in uncertain market",
        "priority": 9,
        "conviction": 0.30,
        "conditions": {
            "regime": ["RANGE", "BEAR"],
            "stock_type": ["large"],
            "liquidity": ["MODERATE_INFLOW", "NEUTRAL"],
            "cycle": ["STOPPING_ACTION", "SPRING"],
        },
        "weights": {
            "fundamentals": 0.45, "volume_profile": 0.25, "smc": 0.15,
            "trend": 0.10, "mean_reversion": 0.05,
        },
    },
}

# Validate all weights sum to 1.0
for name, pat in PATTERNS.items():
    total = sum(pat["weights"].values())
    assert abs(total - 1.0) < 0.02, f"Pattern {name} weights sum to {total}, not 1.0"


# ============================================================================
# DETECTION FUNCTIONS
# ============================================================================

@dataclass
class MarketContext:
    """Full 4-dimensional context for a stock at a point in time."""
    ticker: str
    regime: str = "RANGE"          # BULL / RANGE / BEAR
    regime_confidence: float = 0.0
    stock_type: str = "mid"        # large / mid / small
    liquidity_state: str = "NEUTRAL"
    cycle_phase: str = "MARKUP_MID"
    # Raw indicators for audit trail
    indicators: Dict[str, Any] = field(default_factory=dict)


class AdaptiveScoringEngine:
    """
    Main engine: detects 4-dimensional context → selects pattern → applies weights.

    Designed to integrate with the existing project:
      - Reads from stock_price_history (stocks.db)
      - Uses existing RegimeDetector + HMMMarketRegime for regime
      - Uses existing SMCEngine for cycle/SMC signals
      - Outputs weights that override EGXBoardManager defaults
    """

    # EGX-specific thresholds
    LARGE_CAP_THRESHOLD = 30_000_000_000   # 30B EGP
    MID_CAP_THRESHOLD = 5_000_000_000      # 5B EGP
    LARGE_ADV_THRESHOLD = 50_000_000       # 50M EGP/day
    SMALL_ADV_OVERRIDE = 10_000_000        # 10M EGP/day (thin-trading override)

    def __init__(self, db_path: str = None, price_db_path: str = None):
        self.db_path = db_path or _STOCKS_DB
        self.price_db_path = price_db_path or _PRICE_HISTORY_DB

    # ------------------------------------------------------------------
    # DIMENSION 1: Market Regime Detection
    # ------------------------------------------------------------------

    def detect_regime(self, index_ticker: str = "EGX30ETF") -> Tuple[str, float, Dict]:
        """
        Hybrid regime detection: ADX + ROC + HMM + Breadth.

        Returns: (regime, confidence, indicators_dict)
        """
        prices = self._load_ohlcv(index_ticker, limit=100)
        if len(prices) < 50:
            return "RANGE", 0.0, {"error": "insufficient data"}

        adx = self._calculate_adx(prices, period=14)
        roc = self._calculate_roc(prices, period=20)

        # HMM state (from existing project module)
        hmm_state = "UNKNOWN"
        try:
            from analyzers.hmm_market_regime import get_hmm_regime
            hmm_result = get_hmm_regime(index_ticker)
            hmm_state = hmm_result.get("regime", "UNKNOWN")
        except Exception as e:
            logger.debug(f"HMM unavailable: {e}")

        # Breadth (simplified — % of stocks above their 50MA)
        breadth_pct = self._calculate_breadth()

        # Score
        score = 0
        if adx["adx"] and adx["adx"] > 25:
            score += 3 if adx["direction"] == "bullish" else -3
        if roc > 5:
            score += 2
        elif roc < -5:
            score -= 2

        hmm_map = {"Markup": 2, "Accumulation": 1, "Distribution": -1, "Markdown": -2}
        score += hmm_map.get(hmm_state, 0)

        if breadth_pct > 0.60:
            score += 1
        elif breadth_pct < 0.40:
            score -= 1

        if score >= 4:
            regime = "BULL"
        elif score <= -3:
            regime = "BEAR"
        else:
            regime = "RANGE"

        confidence = min(abs(score) / 8 * 100, 100)
        indicators = {"adx": adx, "roc": roc, "hmm_state": hmm_state, "breadth_pct": breadth_pct}
        return regime, confidence, indicators

    # ------------------------------------------------------------------
    # DIMENSION 2: Stock Type Classification
    # ------------------------------------------------------------------

    def classify_stock(self, ticker: str) -> str:
        """
        Classify as large/mid/small based on market cap + ADV.
        Includes EGX-specific liquidity override.
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Market cap
        cursor.execute("SELECT market_cap FROM stocks WHERE ticker = ?", (ticker,))
        row = cursor.fetchone()
        market_cap = row[0] if row and row[0] else 0
        conn.close()

        # 30-day ADV
        adv = self._get_adv_30d(ticker)

        # Primary by market cap
        if market_cap > self.LARGE_CAP_THRESHOLD:
            cap_class = "large"
        elif market_cap > self.MID_CAP_THRESHOLD:
            cap_class = "mid"
        else:
            cap_class = "small"

        # EGX override: thin-trading "large cap" → treat as small
        if cap_class == "large" and adv < self.SMALL_ADV_OVERRIDE:
            return "small"
        if cap_class == "mid" and adv < 5_000_000:
            return "small"

        return cap_class

    # ------------------------------------------------------------------
    # DIMENSION 3: Liquidity State Detection
    # ------------------------------------------------------------------

    def detect_liquidity_state(self, ticker: str) -> Tuple[str, Dict]:
        """
        Detect 5-state liquidity: volume ratio + OBV slope + MFI.

        Returns: (state, indicators_dict)
        """
        prices = self._load_ohlcv(ticker, limit=80)
        if len(prices) < 60:
            return "NEUTRAL", {"error": "insufficient data"}

        closes = np.array([p["close"] for p in prices])
        volumes = np.array([p["volume"] for p in prices])

        # Volume ratio: 20d avg / 60d avg
        vol_20 = np.mean(volumes[-20:])
        vol_60 = np.mean(volumes[-60:])
        vol_ratio = vol_20 / max(vol_60, 1)

        # OBV slope (20d)
        obv = self._calculate_obv(closes, volumes)
        obv_slope = (obv[-1] - obv[-20]) / max(abs(obv[-20]), 1)

        # MFI (14)
        mfi = self._calculate_mfi(prices, period=14)

        indicators = {
            "volume_ratio": round(vol_ratio, 3),
            "obv_slope": round(obv_slope, 4),
            "mfi": round(mfi, 1),
        }

        # Classification
        if vol_ratio > 1.5 and obv_slope > 0.1 and mfi > 70:
            return "STRONG_INFLOW", indicators
        elif vol_ratio > 1.2 and obv_slope > 0.05 and mfi > 60:
            return "MODERATE_INFLOW", indicators
        elif (vol_ratio < 0.5 and obv_slope < -0.1 and mfi < 30) or \
             (vol_ratio > 2.0 and obv_slope < -0.05):
            return "STRONG_OUTFLOW", indicators
        elif vol_ratio < 0.8 and obv_slope < -0.05 and mfi < 40:
            return "OUTFLOW", indicators
        else:
            return "NEUTRAL", indicators

    # ------------------------------------------------------------------
    # DIMENSION 4: Cycle Position Detection (Wyckoff/ICT)
    # ------------------------------------------------------------------

    def detect_cycle_phase(self, ticker: str) -> Tuple[str, Dict]:
        """
        Detect Wyckoff cycle phase using price structure + SMC + HMM.

        Returns: (phase, indicators_dict)
        Phases: STOPPING_ACTION, SPRING, MARKUP_START, MARKUP_MID,
                DISTRIBUTION_START, DISTRIBUTION_MID
        """
        prices = self._load_ohlcv(ticker, limit=120)
        if len(prices) < 60:
            return "MARKUP_MID", {"error": "insufficient data"}

        closes = np.array([p["close"] for p in prices])
        vols = np.array([p["volume"] for p in prices])

        # Swing structure
        swing_highs = self._find_swing_highs(closes, lookback=60)
        swing_lows = self._find_swing_lows(closes, lookback=60)

        hl_pattern = False  # higher highs + higher lows
        lh_pattern = False  # lower highs + lower lows
        if len(swing_lows) >= 2 and len(swing_highs) >= 2:
            hl_pattern = (swing_lows[-1] > swing_lows[-2]) and (swing_highs[-1] > swing_highs[-2])
            lh_pattern = (swing_lows[-1] < swing_lows[-2]) and (swing_highs[-1] < swing_highs[-2])

        # Volume surge (effort vs result)
        recent_vol = np.mean(vols[-5:])
        avg_vol = np.mean(vols[-20:])
        vol_surge = recent_vol / max(avg_vol, 1)
        recent_return = (closes[-1] - closes[-5]) / closes[-5] if closes[-5] > 0 else 0

        # SMC signals (from existing project module)
        smc_signals = {"bullish_obs": 0, "bearish_obs": 0,
                       "downside_sweeps": 0, "upside_sweeps": 0, "fvgs": 0}
        try:
            from analyzers.smc_engine import SMCEngine
            smc = SMCEngine(prices[-60:])
            if smc.ready:
                obs = smc.get_order_blocks(max_ob_age=20)
                smc_signals["bullish_obs"] = sum(1 for ob in obs if ob.get("type") == "bullish")
                smc_signals["bearish_obs"] = sum(1 for ob in obs if ob.get("type") == "bearish")
                sweeps = smc.get_liquidity_sweeps()
                smc_signals["downside_sweeps"] = sum(1 for s in sweeps if s.get("direction") == "downside")
                smc_signals["upside_sweeps"] = sum(1 for s in sweeps if s.get("direction") == "upside")
                smc_signals["fvgs"] = len(smc.get_fvg())
        except Exception as e:
            logger.debug(f"SMC unavailable: {e}")

        # HMM state
        hmm_state = "UNKNOWN"
        try:
            from analyzers.hmm_market_regime import get_hmm_regime
            hmm_state = get_hmm_regime("EGX30ETF").get("regime", "UNKNOWN")
        except Exception:
            pass

        indicators = {
            "hl_pattern": hl_pattern, "lh_pattern": lh_pattern,
            "vol_surge": round(vol_surge, 2), "recent_return": round(recent_return, 3),
            "smc": smc_signals, "hmm_state": hmm_state,
        }

        # === PHASE CLASSIFICATION (priority order) ===

        # Phase 1: STOPPING_ACTION
        if (vol_surge > 2.0 and recent_return < -0.03 and
                smc_signals["downside_sweeps"] > 0 and
                hmm_state in ["Markdown", "Distribution"]):
            return "STOPPING_ACTION", indicators

        # Phase 2: SPRING
        if (smc_signals["downside_sweeps"] > 0 and smc_signals["bullish_obs"] > 0 and
                closes[-1] > closes[-2] and vol_surge > 1.5):
            return "SPRING", indicators

        # Phase 3: MARKUP_START (SOS + BOS + FVG)
        if (hl_pattern and smc_signals["fvgs"] > 0 and
                hmm_state == "Markup" and recent_return > 0.02):
            return "MARKUP_START", indicators

        # Phase 4: MARKUP_MID
        if (hl_pattern and hmm_state == "Markup" and
                smc_signals["bullish_obs"] > 0 and recent_return > 0):
            return "MARKUP_MID", indicators

        # Phase 5: DISTRIBUTION_START (UTAD)
        if (smc_signals["upside_sweeps"] > 0 and smc_signals["bearish_obs"] > 0 and
                closes[-1] < closes[-2] and vol_surge > 1.5):
            return "DISTRIBUTION_START", indicators

        # Phase 6: DISTRIBUTION_MID
        if (lh_pattern and smc_signals["bearish_obs"] > 0 and
                hmm_state in ["Distribution", "Markdown"]):
            return "DISTRIBUTION_MID", indicators

        # Fallback by HMM
        if hmm_state == "Accumulation":
            return "STOPPING_ACTION", indicators
        elif hmm_state == "Markup":
            return "MARKUP_MID", indicators
        elif hmm_state in ["Distribution", "Markdown"]:
            return "DISTRIBUTION_MID", indicators

        return "MARKUP_MID", indicators

    # ------------------------------------------------------------------
    # PATTERN SELECTION
    # ------------------------------------------------------------------

    def select_pattern(self, context: MarketContext) -> Tuple[str, Dict]:
        """
        Select the best-matching pattern from the 10 defined.
        Uses priority ordering — most restrictive patterns win.

        Returns: (pattern_name, pattern_definition)
        """
        candidates = []
        for name, pat in PATTERNS.items():
            conds = pat["conditions"]
            match = (
                context.regime in conds["regime"]
                and context.stock_type in conds["stock_type"]
                and context.liquidity_state in conds["liquidity"]
                and context.cycle_phase in conds["cycle"]
            )
            if match:
                candidates.append((name, pat))

        if not candidates:
            # Fallback: MEAN_REVERSION_RANGE (safest default)
            return "MEAN_REVERSION_RANGE", PATTERNS["MEAN_REVERSION_RANGE"]

        # Sort by priority (lower number = higher priority)
        candidates.sort(key=lambda x: x[1]["priority"])
        return candidates[0]

    # ------------------------------------------------------------------
    # MAIN SCORING ENTRY POINT
    # ------------------------------------------------------------------

    def score_stock(
        self,
        ticker: str,
        component_scores: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Full adaptive scoring for a stock.

        Args:
            ticker: Stock ticker (e.g., 'COMI')
            component_scores: Optional dict of pre-computed component scores:
                {'trend': 65, 'fundamentals': 70, 'volume_profile': 55, 'smc': 60,
                 'mean_reversion': 45, 'technicals': 60}
                If None, scores must be provided by the caller (from existing analyzers).

        Returns:
            Dict with: pattern_name, weights, weighted_score, conviction,
                       context, indicators, signal, position_size_hint
        """
        # 1. Detect all 4 dimensions
        regime, regime_conf, regime_indicators = self.detect_regime()
        stock_type = self.classify_stock(ticker)
        liquidity_state, liquidity_indicators = self.detect_liquidity_state(ticker)
        cycle_phase, cycle_indicators = self.detect_cycle_phase(ticker)

        context = MarketContext(
            ticker=ticker,
            regime=regime,
            regime_confidence=regime_conf,
            stock_type=stock_type,
            liquidity_state=liquidity_state,
            cycle_phase=cycle_phase,
            indicators={
                "regime": regime_indicators,
                "liquidity": liquidity_indicators,
                "cycle": cycle_indicators,
            },
        )

        # 2. Select pattern
        pattern_name, pattern_def = self.select_pattern(context)
        weights = pattern_def["weights"]
        conviction = pattern_def["conviction"]

        # 3. Compute weighted score
        if component_scores is None:
            component_scores = self._get_default_component_scores()

        weighted_score = 0.0
        total_weight = 0.0
        for comp, weight in weights.items():
            if comp in component_scores:
                weighted_score += component_scores[comp] * weight
                total_weight += weight

        if total_weight > 0:
            weighted_score = weighted_score / total_weight  # already 0-100 scale
        else:
            weighted_score = 50.0  # neutral

        # 4. Signal classification (consistent with project thresholds)
        if weighted_score >= 78:
            signal = "STRONG_BUY"
        elif weighted_score >= 65:
            signal = "BUY"
        elif weighted_score >= 55:
            signal = "ACCUMULATE"
        elif weighted_score >= 40:
            signal = "HOLD"
        elif weighted_score >= 25:
            signal = "REDUCE"
        else:
            signal = "STRONG_SELL"

        # Override for exit/avoid patterns
        if pattern_name in ("DISTRIBUTION_EXIT", "LIQUIDITY_DRAIN_SURVIVOR"):
            if weighted_score < 55:
                signal = "SELL"

        # 5. Position size hint (Kelly-based)
        position_size_hint = self._kelly_position_hint(conviction, weighted_score)

        # 6. Log to database
        self._log_adaptive_weights(ticker, context, pattern_name, weights, conviction)

        return {
            "ticker": ticker,
            "pattern_name": pattern_name,
            "pattern_description": pattern_def["description"],
            "weights": weights,
            "weighted_score": round(weighted_score, 1),
            "signal": signal,
            "conviction": conviction,
            "position_size_hint": position_size_hint,
            "context": asdict(context),
            "timestamp": datetime.now().isoformat(),
        }

    # ------------------------------------------------------------------
    # KELLY POSITION SIZING (Adaptive)
    # ------------------------------------------------------------------

    def _kelly_position_hint(self, conviction: float, score: float) -> float:
        """
        Adaptive Kelly position sizing.
        conviction: pattern conviction (0.0 - 0.5 fractional Kelly)
        score: weighted score (0-100)

        Returns: suggested position size as fraction of portfolio (0.0 - 0.25)
        """
        if conviction == 0.0:
            return 0.0  # exit/avoid pattern

        # Base Kelly (simplified — assumes p=0.55, b=1.2 in absence of history)
        base_kelly = 0.55 - (0.45 / 1.2)  # ≈ 0.175

        # Apply fractional Kelly (conviction)
        position = base_kelly * conviction

        # Score multiplier: 0.5x at score=50, 1.0x at score=100
        score_mult = 0.5 + (score / 100) * 0.5
        position *= score_mult

        # Cap at 25%
        return round(min(position, 0.25), 3)

    def adaptive_kelly_with_history(
        self, ticker: str, trade_history: List[Dict], conviction: float, score: float
    ) -> float:
        """
        Full adaptive Kelly using rolling trade history.

        Args:
            trade_history: list of {'pnl': float, 'ticker': str, 'pattern': str}
                           (last 20+ trades)
        """
        if len(trade_history) < 10:
            return self._kelly_position_hint(conviction, score)

        wins = [t for t in trade_history if t["pnl"] > 0]
        losses = [t for t in trade_history if t["pnl"] <= 0]

        p = len(wins) / len(trade_history)
        avg_win = np.mean([t["pnl"] for t in wins]) if wins else 0.02
        avg_loss = abs(np.mean([t["pnl"] for t in losses])) if losses else 0.03
        b = avg_win / max(avg_loss, 0.001)

        kelly_f = max(p - (1 - p) / max(b, 0.001), 0)
        position = kelly_f * conviction

        score_mult = 0.5 + (score / 100) * 0.5
        position *= score_mult

        return round(min(position, 0.25), 3)

    # ------------------------------------------------------------------
    # HELPER: INDICATOR CALCULATIONS
    # ------------------------------------------------------------------

    def _load_ohlcv(self, ticker: str, limit: int = 100) -> List[Dict]:
        """Load OHLCV data. Tries price_history.db first (richer), falls back to stocks.db."""
        # Try price_history.db first (has buy_volume, sell_volume, pressure — richer data)
        prices = self._load_from_price_history_db(ticker, limit)
        if prices:
            return prices

        # Fallback: stock_daily_prices in stocks.db
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(stock_daily_prices)")
        columns = [r[1] for r in cursor.fetchall()]
        has_open_price = "open_price" in columns
        open_col = "open_price" if has_open_price else "open"
        high_col = "high_price" if has_open_price else "high"
        low_col = "low_price" if has_open_price else "low"
        close_col = "close_price" if has_open_price else "close"

        cursor.execute(
            f'''SELECT price_date, {open_col}, {high_col}, {low_col}, {close_col}, volume
                FROM stock_daily_prices WHERE ticker = ?
                ORDER BY price_date DESC LIMIT ?''',
            (ticker, limit),
        )
        rows = cursor.fetchall()
        conn.close()

        prices = []
        for r in reversed(rows):
            prices.append({
                "date": r[0], "open": r[1] or r[4], "high": r[2] or r[4],
                "low": r[3] or r[4], "close": r[4], "volume": r[5] or 0,
            })
        return prices

    def _load_from_price_history_db(self, ticker: str, limit: int = 100) -> List[Dict]:
        """Load from price_history.db (has buy/sell volume + pressure)."""
        try:
            conn = sqlite3.connect(self.price_db_path)
            cursor = conn.cursor()
            cursor.execute(
                '''SELECT date, open_price, high_price, low_price, close_price, volume
                    FROM price_history WHERE ticker = ?
                    ORDER BY date DESC LIMIT ?''',
                (ticker, limit),
            )
            rows = cursor.fetchall()
            conn.close()
            prices = []
            for r in reversed(rows):
                prices.append({
                    "date": r[0], "open": r[1] or r[4], "high": r[2] or r[4],
                    "low": r[3] or r[4], "close": r[4], "volume": r[5] or 0,
                })
            return prices
        except Exception as e:
            logger.debug(f"price_history.db load failed: {e}")            
            return []

    def _get_adv_30d(self, ticker: str) -> float:
        """Get 30-day average daily turnover (volume × close) in EGP."""
        # Try price_history.db first
        try:
            conn = sqlite3.connect(self.price_db_path)
            cursor = conn.cursor()
            cursor.execute(
                '''SELECT AVG(volume * close_price) as adv
                    FROM price_history
                    WHERE ticker = ? AND date >= date('now', '-30 days')''',
                (ticker,),
            )
            row = cursor.fetchone()
            conn.close()
            if row and row[0]:
                return row[0]
        except Exception:
            pass

        # Fallback: stock_daily_prices
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(stock_daily_prices)")
        columns = [r[1] for r in cursor.fetchall()]
        close_col = "close_price" if "close_price" in columns else "close"
        cursor.execute(
            f'''SELECT AVG(volume * {close_col}) as adv
                FROM stock_daily_prices
                WHERE ticker = ? AND price_date >= date('now', '-30 days')''',
            (ticker,),
        )
        row = cursor.fetchone()
        conn.close()
        return row[0] if row and row[0] else 0

    def _calculate_adx(self, prices: List[Dict], period: int = 14) -> Dict:
        """Calculate ADX (Average Directional Index)."""
        if len(prices) < period + 1:
            return {"adx": None, "direction": "neutral", "trend_strength": "unknown"}

        tr_list, plus_dm, minus_dm = [], [], []
        for i in range(1, len(prices)):
            high, low, prev_close = prices[i]["high"], prices[i]["low"], prices[i - 1]["close"]
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
            tr_list.append(tr)
            up_move = high - prices[i - 1]["high"]
            down_move = prices[i - 1]["low"] - low
            plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0)
            minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0)

        def smooth(vals, p):
            return [sum(vals[max(0, i - p + 1):i + 1]) / min(i + 1, p) for i in range(len(vals))]

        tr_s = smooth(tr_list, period)
        plus_s = smooth(plus_dm, period)
        minus_s = smooth(minus_dm, period)

        plus_di = [(plus_s[i] / tr_s[i] * 100) if tr_s[i] > 0 else 0 for i in range(len(tr_s))]
        minus_di = [(minus_s[i] / tr_s[i] * 100) if tr_s[i] > 0 else 0 for i in range(len(tr_s))]

        dx = [
            abs(plus_di[i] - minus_di[i]) / (plus_di[i] + minus_di[i]) * 100
            if (plus_di[i] + minus_di[i]) > 0 else 0
            for i in range(len(plus_di))
        ]
        adx = smooth(dx, period)[-1] if dx else 0

        if adx > 40:
            strength = "strong"
        elif adx > 25:
            strength = "moderate"
        else:
            strength = "weak"

        return {
            "adx": round(adx, 2),
            "trend_strength": strength,
            "direction": "bullish" if (plus_di[-1] if plus_di else 0) > (minus_di[-1] if minus_di else 0) else "bearish",
        }

    def _calculate_roc(self, prices: List[Dict], period: int = 20) -> float:
        """Rate of Change (%)."""
        if len(prices) < period + 1:
            return 0.0
        current = prices[-1]["close"]
        old = prices[-(period + 1)]["close"]
        return ((current - old) / old * 100) if old > 0 else 0.0

    def _calculate_breadth(self) -> float:
        """Simplified breadth: % of EGX stocks above their 50-day MA.
        Uses price_history.db (richest data source).
        """
        try:
            conn = sqlite3.connect(self.price_db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT ticker FROM price_history")
            tickers = [r[0] for r in cursor.fetchall()]

            above = 0
            total = 0
            for ticker in tickers[:50]:  # sample top 50 for speed
                cursor.execute(
                    '''SELECT close_price FROM price_history
                        WHERE ticker = ? AND close_price IS NOT NULL
                        ORDER BY date DESC LIMIT 51''',
                    (ticker,),
                )
                rows = cursor.fetchall()
                if len(rows) >= 51:
                    current = rows[0][0]
                    ma50 = sum(r[0] for r in rows[1:51]) / 50
                    if current > ma50:
                        above += 1
                    total += 1
            conn.close()
            return above / max(total, 1)
        except Exception as e:
            logger.debug(f"Breadth calculation failed: {e}")
            return 0.5  # neutral default

    def _calculate_obv(self, closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
        """On-Balance Volume."""
        obv = np.zeros(len(closes))
        for i in range(1, len(closes)):
            if closes[i] > closes[i - 1]:
                obv[i] = obv[i - 1] + volumes[i]
            elif closes[i] < closes[i - 1]:
                obv[i] = obv[i - 1] - volumes[i]
            else:
                obv[i] = obv[i - 1]
        return obv

    def _calculate_mfi(self, prices: List[Dict], period: int = 14) -> float:
        """Money Flow Index."""
        if len(prices) < period + 1:
            return 50.0

        typical = []
        for p in prices:
            tp = (p["high"] + p["low"] + p["close"]) / 3
            typical.append(tp)
        typical = np.array(typical)
        vols = np.array([p["volume"] for p in prices])

        mf = typical * vols
        pos_mf = 0
        neg_mf = 0
        for i in range(-period, 0):
            if i == -period:
                continue
            if typical[i] > typical[i - 1]:
                pos_mf += mf[i]
            else:
                neg_mf += mf[i]

        if neg_mf == 0:
            return 100.0
        mfr = pos_mf / neg_mf
        return 100 - (100 / (1 + mfr))

    def _find_swing_highs(self, closes: np.ndarray, lookback: int = 60, window: int = 3) -> List[float]:
        """Find swing high points."""
        n = min(len(closes), lookback)
        segment = closes[-n:]
        highs = []
        for i in range(window, len(segment) - window):
            if all(segment[i] > segment[i + j] for j in range(-window, window + 1) if j != 0):
                highs.append(float(segment[i]))
        return highs

    def _find_swing_lows(self, closes: np.ndarray, lookback: int = 60, window: int = 3) -> List[float]:
        """Find swing low points."""
        n = min(len(closes), lookback)
        segment = closes[-n:]
        lows = []
        for i in range(window, len(segment) - window):
            if all(segment[i] < segment[i + j] for j in range(-window, window + 1) if j != 0):
                lows.append(float(segment[i]))
        return lows

    def _get_default_component_scores(self) -> Dict[str, float]:
        """Default neutral scores when no external analyzers provided."""
        return {
            "trend": 50, "technicals": 50, "fundamentals": 50,
            "volume_profile": 50, "smc": 50, "mean_reversion": 50,
        }

    # ------------------------------------------------------------------
    # DATABASE LOGGING
    # ------------------------------------------------------------------

    def _log_adaptive_weights(
        self, ticker: str, context: MarketContext,
        pattern_name: str, weights: Dict, conviction: float,
    ):
        """Log the adaptive weights decision for audit trail."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS adaptive_weights_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                ticker TEXT NOT NULL,
                pattern_name TEXT,
                regime TEXT,
                stock_type TEXT,
                liquidity_state TEXT,
                cycle_phase TEXT,
                weights_json TEXT,
                conviction REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date, ticker)
            )
        ''')
        today = datetime.now().strftime("%Y-%m-%d")
        cursor.execute(
            '''INSERT OR REPLACE INTO adaptive_weights_log
               (date, ticker, pattern_name, regime, stock_type, liquidity_state,
                cycle_phase, weights_json, conviction)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (today, ticker, pattern_name, context.regime, context.stock_type,
             context.liquidity_state, context.cycle_phase,
             json.dumps(weights), conviction),
        )
        conn.commit()
        conn.close()


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

_engine_instance: Optional[AdaptiveScoringEngine] = None


def get_adaptive_engine(db_path: str = None) -> AdaptiveScoringEngine:
    """Singleton accessor for the adaptive scoring engine."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = AdaptiveScoringEngine(db_path)
    return _engine_instance


def score_stock_adaptive(ticker: str, component_scores: Dict = None) -> Dict:
    """One-call convenience function for adaptive scoring."""
    engine = get_adaptive_engine()
    return engine.score_stock(ticker, component_scores)


# ============================================================================
# CLI
# ============================================================================

if __name__ == "__main__":
    import sys

    print("=" * 70)
    print("  ADAPTIVE SCORING ENGINE — Dynamic Weight System")
    print("  10 Patterns × 4 Dimensions (Regime × StockType × Liquidity × Cycle)")
    print("=" * 70)

    ticker = sys.argv[1] if len(sys.argv) > 1 else "COMI"
    engine = AdaptiveScoringEngine()

    print(f"\n  Scoring: {ticker}")
    print(f"  Time: {datetime.now().isoformat()}")
    print("-" * 70)

    result = engine.score_stock(ticker)

    print(f"\n  📊 PATTERN: {result['pattern_name']}")
    print(f"     {result['pattern_description']}")
    print(f"\n  🎯 WEIGHTED SCORE: {result['weighted_score']}/100")
    print(f"  📢 SIGNAL: {result['signal']}")
    print(f"  💪 CONVICTION: {result['conviction']} (Kelly fraction)")
    print(f"  💰 POSITION SIZE HINT: {result['position_size_hint']*100:.1f}% of portfolio")

    ctx = result["context"]
    print(f"\n  📐 CONTEXT:")
    print(f"     Regime:          {ctx['regime']} (conf: {ctx['regime_confidence']:.0f}%)")
    print(f"     Stock Type:      {ctx['stock_type']}")
    print(f"     Liquidity State: {ctx['liquidity_state']}")
    print(f"     Cycle Phase:     {ctx['cycle_phase']}")

    print(f"\n  ⚖️  WEIGHTS:")
    for comp, w in sorted(result["weights"].items(), key=lambda x: -x[1]):
        bar = "█" * int(w * 40)
        print(f"     {comp:<20s} {w*100:5.1f}%  {bar}")

    print("\n" + "=" * 70)
