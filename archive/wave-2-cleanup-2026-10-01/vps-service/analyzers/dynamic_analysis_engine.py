"""
Dynamic Analysis Engine — Gemini Strategy Implementation
========================================================
محرك التحليل الديناميكي المتكيف

"السوق كائن حي بيتحرك بالسيولة والنفسية، مش بكتالوج ثابت"

This engine implements the 4 core Gemini proposals:
1. Dynamic Parameter Matrix — RSI/ATR/MA periods adapt to Regime + Volatility + Sector
2. ATR-Aware Structural Targets — Stop & Target based on ATR multipliers + S/R + Fib extensions
3. Adaptive Weights Engine — Component weights shift based on market regime
4. BB Squeeze Detection + Position Override — Squeeze triggers momentum boost; profitable positions override to TAKE_PROFIT

Design: Pure functions, no DB, no network. Can be called from maestro, gate-analyzer,
or any API route.

Migrated from TypeScript (dynamic-analysis-engine.ts) to Python — THE BRAIN.
Node.js / Next.js is DISPLAY ONLY.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple, Literal


# ============================================================================
# TYPES
# ============================================================================

StockRegime = Literal['STRONG_BULL', 'WEAK_BULL', 'RANGE', 'WEAK_BEAR', 'STRONG_BEAR']
SectorSpeed = Literal['FAST', 'MEDIUM', 'SLOW']
VolatilityLevel = Literal['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']
SqueezeLevel = Literal['NONE', 'NARROWING', 'SQUEEZE', 'EXTREME_SQUEEZE']
SignalType = Literal['BUY', 'SELL', 'HOLD', 'TAKE_PROFIT', 'STRONG_BUY', 'STRONG_SELL']
TargetSource = Literal['swing_resistance', 'fibonacci_1618', 'fibonacci_1272', 'atr_multiple', 'atr_floor']
StopSource = Literal['swing_support', 'atr_multiple', 'atr_floor']
BBWidthTrend = Literal['narrowing', 'stable', 'widening']


@dataclass
class DynamicParams:
    rsiOverbought: float = 70
    rsiOversold: float = 30
    rsiPeriod: int = 14
    atrPeriod: int = 14
    atrStopMultiplier: float = 1.8
    atrTargetMultiplier: float = 2.5
    swingLookback: int = 20
    minRiskReward: float = 1.5
    bbSqueezeThreshold: float = 3.0
    trailingStopPct: float = 0.05
    minProfitPct: float = 0.03


@dataclass
class BBSqueezeResult:
    level: SqueezeLevel = 'NONE'
    bbWidthPct: float = 0
    bbWidthTrend: BBWidthTrend = 'stable'
    avgWidth20: float = 0
    squeezeScore: int = 0
    descriptionAr: str = 'بيانات غير كافية'


@dataclass
class StructuralTargets:
    entry: float = 0
    target: float = 0
    stopLoss: float = 0
    riskReward: float = 0
    targetSource: TargetSource = 'atr_multiple'
    stopSource: StopSource = 'atr_multiple'
    fibExtensionUsed: Optional[float] = None
    distanceToResistance: Optional[float] = None
    distanceToSupport: Optional[float] = None


@dataclass
class AdaptiveWeights:
    technical: float = 0
    fundamental: float = 0
    momentum: float = 0
    volumeProfile: float = 0
    supportResistance: float = 0
    bollingerBands: float = 0
    risk: float = 0
    regime: str = 'RANGE'
    regimeLabel: str = ''
    regimeMultiplier: float = 1.0


@dataclass
class PositionOverrideResult:
    shouldOverride: bool = False
    originalSignal: str = 'HOLD'
    overrideSignal: str = 'HOLD'
    reason: str = ''
    reasonAr: str = ''


@dataclass
class DynamicAnalysisInput:
    close: float
    atr: Optional[float] = None
    rsi: Optional[float] = None
    trend: str = 'NEUTRAL'
    adx: Optional[float] = None
    support: Optional[float] = None
    resistance: Optional[float] = None
    farSupport: Optional[float] = None
    farResistance: Optional[float] = None
    recentSwingHighs: List[float] = field(default_factory=list)
    recentSwingLows: List[float] = field(default_factory=list)
    bollingerWidthPct: Optional[float] = None
    bollingerWidthHistory: List[float] = field(default_factory=list)
    sector: str = ''
    userPositionPnl: Optional[float] = None
    currentSignal: str = 'HOLD'
    priceVsMA20: Optional[float] = None
    priceVsMA50: Optional[float] = None


@dataclass
class DynamicAnalysisResult:
    params: DynamicParams = field(default_factory=DynamicParams)
    squeeze: BBSqueezeResult = field(default_factory=BBSqueezeResult)
    targets: Optional[StructuralTargets] = None
    weights: AdaptiveWeights = field(default_factory=AdaptiveWeights)
    positionOverride: Optional[PositionOverrideResult] = None
    regime: StockRegime = 'RANGE'
    volatility: VolatilityLevel = 'MEDIUM'
    sectorSpeed: SectorSpeed = 'MEDIUM'
    analysisNotes: List[str] = field(default_factory=list)
    analysisNotesAr: List[str] = field(default_factory=list)


# ============================================================================
# LABEL HELPERS
# ============================================================================

REGIME_LABELS_AR: Dict[str, str] = {
    'STRONG_BULL': 'صاعد قوي \U0001f402',
    'WEAK_BULL': 'صاعد ضعيف \U0001f4c8',
    'RANGE': 'عرضي \u27a1\ufe0f',
    'WEAK_BEAR': 'هابط ضعيف \U0001f4c9',
    'STRONG_BEAR': 'هابط قوي \U0001f43b',
}

VOLATILITY_LABELS_AR: Dict[str, str] = {
    'VERY_LOW': 'منخفض جداً',
    'LOW': 'منخفض',
    'MEDIUM': 'متوسط',
    'HIGH': 'عالي',
    'VERY_HIGH': 'عالي جداً',
}

SECTOR_SPEED_LABELS_AR: Dict[str, str] = {
    'FAST': 'سريع \u26a1',
    'MEDIUM': 'متوسط',
    'SLOW': 'بطيء \U0001f422',
}

TARGET_SOURCE_LABELS_AR: Dict[str, str] = {
    'swing_resistance': 'مقاومة هيكلية',
    'fibonacci_1618': 'فيبوناتشي 161.8%',
    'fibonacci_1272': 'فيبوناتشي 127.2%',
    'atr_multiple': 'مضاعف ATR',
    'atr_floor': 'حد أدنى ATR',
    'swing_support': 'دعم هيكلي',
}

SIGNAL_LABELS_AR: Dict[str, str] = {
    'BUY': 'شراء',
    'SELL': 'بيع',
    'HOLD': 'انتظار',
    'TAKE_PROFIT': 'جني أرباح',
    'STRONG_BUY': 'شراء قوي',
    'STRONG_SELL': 'بيع قوي',
}


# ============================================================================
# 1. DYNAMIC PARAMETER MATRIX
# ============================================================================

FAST_SECTORS = [
    'technology', 'tech', '\u062a\u0643\u0646\u0648\u0644\u0648\u062c\u064a\u0627',
    'pharma', '\u0623\u062f\u0648\u064a\u0629',
    'financial', '\u0645\u0635\u0631\u0641\u064a', 'banking', '\u0628\u0646\u0648\u0643',
    'services', '\u062e\u062f\u0645\u0627\u062a',
    'telecom', '\u0627\u062a\u0635\u0627\u0644\u0627\u062a',
]

SLOW_SECTORS = [
    'utilities', '\u0645\u0631\u0627\u0641\u0642',
    'real estate', '\u0639\u0642\u0627\u0631\u0627\u062a',
    'consumer staples', '\u0633\u0644\u0639 \u0627\u0633\u062a\u0647\u0644\u0627\u0643\u064a\u0629',
    'cement', '\u0623\u0633\u0645\u0646\u062a', 'construction', '\u0628\u0646\u0627\u0621',
    'food', '\u0623\u063a\u0630\u064a\u0629',
    'healthcare', '\u0631\u0639\u0627\u064a\u0629 \u0635\u062d\u064a\u0629',
]


def classify_sector_speed(sector: str) -> SectorSpeed:
    """Classify sector as FAST, MEDIUM, or SLOW based on its name."""
    s = (sector or '').lower()
    for f in FAST_SECTORS:
        if f in s:
            return 'FAST'
    for f in SLOW_SECTORS:
        if f in s:
            return 'SLOW'
    return 'MEDIUM'


def classify_volatility(atr_pct: float) -> VolatilityLevel:
    """Classify volatility level based on ATR as % of price."""
    if atr_pct > 6:
        return 'VERY_HIGH'
    if atr_pct > 4:
        return 'HIGH'
    if atr_pct > 2:
        return 'MEDIUM'
    if atr_pct > 1:
        return 'LOW'
    return 'VERY_LOW'


def detect_stock_regime(
    trend: str,
    rsi: Optional[float],
    adx: Optional[float],
    price_vs_ma20: Optional[float],
    price_vs_ma50: Optional[float],
) -> StockRegime:
    """Detect stock regime (STRONG_BULL, WEAK_BULL, RANGE, WEAK_BEAR, STRONG_BEAR)."""
    is_bull = trend == 'BULLISH'
    is_bear = trend == 'BEARISH'
    strong_trend = (adx is not None and adx > 30)
    strong_price_position = (price_vs_ma20 is not None and abs(price_vs_ma20) > 5)

    if is_bull:
        if strong_trend and strong_price_position and price_vs_ma50 is not None and price_vs_ma50 > 8:
            return 'STRONG_BULL'
        return 'WEAK_BULL'
    if is_bear:
        if strong_trend and strong_price_position and price_vs_ma50 is not None and price_vs_ma50 < -8:
            return 'STRONG_BEAR'
        return 'WEAK_BEAR'
    return 'RANGE'


def get_dynamic_params(
    regime: StockRegime,
    volatility: VolatilityLevel,
    sector_speed: SectorSpeed,
    base_params: Optional[Dict[str, Any]] = None,
) -> DynamicParams:
    """
    Compute dynamic parameters based on regime, volatility, and sector speed.
    Adjusts RSI periods/thresholds, ATR multipliers, swing lookbacks, etc.
    """
    p = DynamicParams()

    if base_params:
        for k, v in base_params.items():
            if hasattr(p, k):
                setattr(p, k, v)

    # ---- REGIME ADJUSTMENTS ----
    if regime == 'STRONG_BULL':
        p.rsiOverbought = max(55, p.rsiOverbought - 5)
        p.rsiOversold = max(0, p.rsiOversold + 8)
        p.minRiskReward = max(0.8, p.minRiskReward - 0.5)
        p.atrStopMultiplier = max(1.2, p.atrStopMultiplier - 0.3)
    elif regime == 'WEAK_BULL':
        p.rsiOverbought = max(60, p.rsiOverbought - 3)
        p.rsiOversold = max(0, p.rsiOversold + 4)
        p.minRiskReward = max(1.0, p.minRiskReward - 0.2)
    elif regime == 'RANGE':
        p.minRiskReward = max(1.8, p.minRiskReward + 0.3)
        p.atrStopMultiplier = max(1.5, p.atrStopMultiplier + 0.2)
    elif regime == 'WEAK_BEAR':
        p.rsiOverbought = min(90, p.rsiOverbought + 5)
        p.rsiOversold = max(0, p.rsiOversold - 2)
        p.minRiskReward = min(10, p.minRiskReward + 0.3)
    elif regime == 'STRONG_BEAR':
        p.rsiOverbought = min(95, p.rsiOverbought + 10)
        p.rsiOversold = max(0, p.rsiOversold - 8)
        p.minRiskReward = min(10, p.minRiskReward + 0.5)
        p.atrStopMultiplier = max(1.5, p.atrStopMultiplier + 0.5)

    # ---- VOLATILITY ADJUSTMENTS ----
    if volatility == 'VERY_HIGH':
        p.swingLookback = min(100, p.swingLookback + 8)
        p.atrPeriod = min(30, p.atrPeriod + 4)
        p.rsiPeriod = min(28, p.rsiPeriod + 4)
        p.atrStopMultiplier = max(1.5, p.atrStopMultiplier + 0.7)
        p.atrTargetMultiplier = max(2.0, p.atrTargetMultiplier + 0.5)
        p.trailingStopPct = min(0.15, p.trailingStopPct + 0.03)
    elif volatility == 'HIGH':
        p.swingLookback = min(80, p.swingLookback + 5)
        p.atrPeriod = min(25, p.atrPeriod + 2)
        p.rsiPeriod = min(25, p.rsiPeriod + 2)
        p.atrStopMultiplier = max(1.5, p.atrStopMultiplier + 0.4)
        p.atrTargetMultiplier = max(2.0, p.atrTargetMultiplier + 0.3)
    elif volatility == 'LOW':
        p.swingLookback = max(8, p.swingLookback - 4)
        p.atrPeriod = max(7, p.atrPeriod - 2)
        p.rsiPeriod = max(7, p.rsiPeriod - 1)
        p.atrStopMultiplier = max(1.2, p.atrStopMultiplier - 0.2)
    elif volatility == 'VERY_LOW':
        p.swingLookback = max(6, p.swingLookback - 6)
        p.atrPeriod = max(5, p.atrPeriod - 3)
        p.rsiPeriod = max(5, p.rsiPeriod - 2)
        p.atrStopMultiplier = max(1.0, p.atrStopMultiplier - 0.3)
    # MEDIUM: no adjustment

    # ---- SECTOR SPEED ADJUSTMENTS ----
    if sector_speed == 'FAST':
        p.swingLookback = max(5, p.swingLookback - 3)
        p.atrPeriod = max(5, p.atrPeriod - 2)
        p.rsiPeriod = max(7, p.rsiPeriod - 2)
    elif sector_speed == 'SLOW':
        p.swingLookback = min(100, p.swingLookback + 4)
        p.atrPeriod = min(25, p.atrPeriod + 2)
        p.rsiPeriod = min(25, p.rsiPeriod + 2)
    # MEDIUM: no adjustment

    return p


# ============================================================================
# 2. BB SQUEEZE DETECTOR
# ============================================================================

def detect_bb_squeeze(
    bb_width_pct: Optional[float],
    bb_width_history: Optional[List[float]] = None,
) -> BBSqueezeResult:
    """
    Detect Bollinger Band Squeeze.
    BB Width = (4 * SD) / MA20  (as % of price)
    Squeeze = BB Width < avg(BB Width, 20 periods) * threshold
    """
    empty = BBSqueezeResult()

    if bb_width_pct is None or bb_width_pct <= 0:
        return empty

    history = bb_width_history if bb_width_history else [bb_width_pct]
    avg_width = sum(history) / len(history) if history else bb_width_pct

    # Determine trend: compare recent 5 vs previous 10
    trend: BBWidthTrend = 'stable'
    recent5 = history[-5:] if len(history) >= 5 else history
    prev10 = history[-15:-5] if len(history) >= 15 else []
    if recent5 and prev10:
        avg_recent = sum(recent5) / len(recent5)
        avg_prev = sum(prev10) / len(prev10)
        if avg_prev > 0:
            change = (avg_recent - avg_prev) / avg_prev
            if change < -0.15:
                trend = 'narrowing'
            elif change > 0.15:
                trend = 'widening'

    # Squeeze detection
    ratio = bb_width_pct / avg_width if avg_width > 0 else 1.0

    if ratio < 0.4:
        level: SqueezeLevel = 'EXTREME_SQUEEZE'
        squeeze_score = 95
        description_ar = '\u0627\u0646\u0636\u063a\u0627\u0637 \u0628\u0648\u0644\u0646\u062c\u0631 \u0634\u062f\u064a\u062f \u2014 \u0627\u0646\u0641\u062c\u0627\u0631 \u0633\u0639\u0631\u064a \u0648\u0634\u064a\u0643 \u062c\u062f\u0627\u064b'
    elif ratio < 0.6:
        level = 'SQUEEZE'
        squeeze_score = 75
        description_ar = '\u0627\u0646\u0636\u063a\u0627\u0637 \u0628\u0648\u0644\u0646\u062c\u0631 \u2014 \u0627\u062d\u062a\u0645\u0627\u0644 \u062d\u0631\u0643\u0629 \u0642\u0648\u064a\u0629 \u0642\u0631\u064a\u0628\u0629'
    elif ratio < 0.8 and trend == 'narrowing':
        level = 'NARROWING'
        squeeze_score = 50
        description_ar = '\u0627\u0644\u0646\u0637\u0627\u0642 \u0628\u064a\u062a\u0636\u064a\u0642 \u062a\u062f\u0631\u064a\u062c\u064a\u0627\u064b \u2014 \u0631\u0627\u0642\u0628 \u0627\u0644\u0643\u0633\u0631'
    else:
        level = 'NONE'
        squeeze_score = max(0, int((1 - ratio) * 50))
        description_ar = '\u0644\u0627 \u064a\u0648\u062c\u062f \u0627\u0646\u0636\u063a\u0627\u0637'

    # Boost score if actively narrowing
    if trend == 'narrowing' and level != 'NONE':
        squeeze_score = min(100, squeeze_score + 10)

    return BBSqueezeResult(
        level=level,
        bbWidthPct=round(bb_width_pct, 2),
        bbWidthTrend=trend,
        avgWidth20=round(avg_width, 2),
        squeezeScore=squeeze_score,
        descriptionAr=description_ar,
    )


# ============================================================================
# 3. ATR-AWARE STRUCTURAL TARGETS
# ============================================================================

def calculate_structural_targets(
    entry: float,
    atr: float,
    signal: str,
    support: Optional[float],
    resistance: Optional[float],
    far_support: Optional[float],
    far_resistance: Optional[float],
    recent_swing_highs: List[float],
    recent_swing_lows: List[float],
    min_risk_reward: float,
    atr_stop_multiplier: float,
    atr_target_multiplier: float,
    bb_squeeze_level: SqueezeLevel = 'NONE',
) -> StructuralTargets:
    """
    Calculate dynamic stop-loss and target based on:
    1. Primary: ATR multipliers (adaptive to volatility)
    2. Secondary: Structural S/R levels
    3. Tertiary: Fibonacci extensions (for breakout trades)

    Stop Loss = Entry - (ATR * DynamicMultiplier)
    Target = max(Structural Resistance, ATR * TargetMultiplier, Fib Extension)
    """
    is_buy = signal in ('BUY', 'STRONG_BUY')

    # ---- STEP 1: Dynamic ATR Stop ----
    stop_atr_dist = atr * atr_stop_multiplier

    # In squeeze, widen the stop slightly (explosion can be violent)
    if bb_squeeze_level in ('SQUEEZE', 'EXTREME_SQUEEZE'):
        stop_atr_dist *= 1.2

    stop_loss: float
    stop_source: StopSource = 'atr_multiple'

    if is_buy:
        stop_loss = entry - stop_atr_dist
        # If there's a structural support that's closer (tighter stop = better R:R)
        if support and support > 0 and support < entry:
            support_dist = entry - support
            if atr * 0.5 <= support_dist <= atr * 2.5:
                stop_loss = support * 0.995  # tiny buffer below support
                stop_source = 'swing_support'
    else:
        stop_loss = entry + stop_atr_dist
        if resistance and resistance > entry:
            res_dist = resistance - entry
            if atr * 0.5 <= res_dist <= atr * 2.5:
                stop_loss = resistance * 1.005
                stop_source = 'swing_support'

    # Floor: ensure stop is at least 0.5% away
    min_stop_dist = entry * 0.005
    if abs(stop_loss - entry) < min_stop_dist:
        stop_loss = (entry - min_stop_dist) if is_buy else (entry + min_stop_dist)
        stop_source = 'atr_floor'

    # Ensure stop is valid
    if stop_loss <= 0:
        stop_loss = entry * 0.97 if is_buy else entry * 1.03
    if is_buy and stop_loss >= entry:
        stop_loss = entry * 0.97
    if not is_buy and stop_loss <= entry:
        stop_loss = entry * 1.03

    # ---- STEP 2: Structural Target ----
    target_source: TargetSource = 'atr_multiple'
    fib_extension_used: Optional[float] = None

    risk_dist = abs(entry - stop_loss)
    min_target_dist = risk_dist * min_risk_reward

    # Candidate 1: ATR-based target
    target_atr_dist = atr * atr_target_multiplier
    if bb_squeeze_level == 'SQUEEZE':
        target_atr_dist *= 1.15
    elif bb_squeeze_level == 'EXTREME_SQUEEZE':
        target_atr_dist *= 1.3

    candidate_target = (entry + target_atr_dist) if is_buy else (entry - target_atr_dist)

    # Candidate 2: Structural resistance/support
    if is_buy:
        near_res = resistance
        if not near_res and recent_swing_highs:
            near_res = recent_swing_highs[-1]
        if near_res and near_res > entry:
            res_dist = near_res - entry
            if res_dist >= min_target_dist:
                candidate_target = near_res
                target_source = 'swing_resistance'

        # Blue Sky Breakout: use Fibonacci 1.618
        if target_source == 'atr_multiple' and not resistance and far_resistance is None and not recent_swing_highs:
            if recent_swing_lows and recent_swing_highs:
                last_low = min(recent_swing_lows[-3:])
                last_high = max(recent_swing_highs[-3:])
                range_val = last_high - last_low
                if range_val > 0:
                    fib_1618 = entry + range_val * 0.618
                    fib_1272 = entry + range_val * 0.272
                    if fib_1272 >= min_target_dist + entry:
                        candidate_target = max(fib_1618, candidate_target)
                        target_source = 'fibonacci_1618'
                        fib_extension_used = 1.618
    else:
        near_sup = support
        if not near_sup and recent_swing_lows:
            near_sup = recent_swing_lows[-1]
        if near_sup and near_sup < entry:
            sup_dist = entry - near_sup
            if sup_dist >= min_target_dist:
                candidate_target = near_sup
                target_source = 'swing_resistance'

    # Ensure minimum R:R
    if is_buy:
        if candidate_target - entry < min_target_dist:
            candidate_target = entry + min_target_dist
            target_source = 'atr_floor'
    else:
        if entry - candidate_target < min_target_dist:
            candidate_target = entry - min_target_dist
            target_source = 'atr_floor'

    target = candidate_target

    # Ensure target is positive
    if target <= 0:
        target = entry * 1.05 if is_buy else entry * 0.95

    # ---- STEP 3: Calculate R:R ----
    risk = abs(entry - stop_loss)
    reward = abs(target - entry)
    risk_reward = round(reward / risk, 2) if risk > 0 else 0

    distance_to_resistance = round(((resistance - entry) / entry) * 100, 2) if resistance else None
    distance_to_support = round(((entry - support) / entry) * 100, 2) if support else None

    return StructuralTargets(
        entry=round(entry, 4),
        target=round(target, 4),
        stopLoss=round(stop_loss, 4),
        riskReward=risk_reward,
        targetSource=target_source,
        stopSource=stop_source,
        fibExtensionUsed=fib_extension_used,
        distanceToResistance=distance_to_resistance,
        distanceToSupport=distance_to_support,
    )


# ============================================================================
# 4. ADAPTIVE WEIGHTS ENGINE
# ============================================================================

REGIME_WEIGHT_CONFIGS: Dict[str, Dict[str, Any]] = {
    'STRONG_BULL': {
        'technical': 0.25,
        'fundamental': 0.15,
        'momentum': 0.20,
        'volumeProfile': 0.18,
        'supportResistance': 0.10,
        'bollingerBands': 0.07,
        'risk': 0.05,
        'regimeLabel': '\u0635\u0627\u0639\u062f \u0642\u0648\u064a \u2014 \u0627\u0644\u0633\u064a\u0648\u0644\u0629 \u0648\u0627\u0644\u0632\u062e\u0645 \u0647\u0645\u0627 \u0627\u0644\u0645\u0644\u0643',
        'regimeMultiplier': 1.2,
    },
    'WEAK_BULL': {
        'technical': 0.22,
        'fundamental': 0.18,
        'momentum': 0.15,
        'volumeProfile': 0.15,
        'supportResistance': 0.15,
        'bollingerBands': 0.08,
        'risk': 0.07,
        'regimeLabel': '\u0635\u0627\u0639\u062f \u0636\u0639\u064a\u0641 \u2014 \u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u062f\u0639\u0645 \u0642\u0628\u0644 \u0627\u0644\u062f\u062e\u0648\u0644',
        'regimeMultiplier': 1.1,
    },
    'RANGE': {
        'technical': 0.15,
        'fundamental': 0.22,
        'momentum': 0.10,
        'volumeProfile': 0.10,
        'supportResistance': 0.22,
        'bollingerBands': 0.13,
        'risk': 0.08,
        'regimeLabel': '\u0639\u0631\u0636\u064a \u2014 \u0627\u0644\u062f\u0639\u0645 \u0648\u0627\u0644\u0645\u0642\u0627\u0648\u0645\u0629 \u0648\u0627\u0644\u0628\u0648\u0644\u0646\u062c\u0631 \u0647\u0645\u0627 \u0627\u0644\u0645\u0631\u062c\u0639',
        'regimeMultiplier': 0.9,
    },
    'WEAK_BEAR': {
        'technical': 0.18,
        'fundamental': 0.20,
        'momentum': 0.12,
        'volumeProfile': 0.12,
        'supportResistance': 0.12,
        'bollingerBands': 0.10,
        'risk': 0.16,
        'regimeLabel': '\u0647\u0627\u0628\u0637 \u0636\u0639\u064a\u0641 \u2014 \u062d\u0630\u0631 \u0645\u0646 \u0627\u0644\u0641\u062e\u0627\u062e \u0648\u0627\u0644\u0627\u0631\u062a\u062f\u0627\u062f\u0627\u062a',
        'regimeMultiplier': 0.8,
    },
    'STRONG_BEAR': {
        'technical': 0.15,
        'fundamental': 0.15,
        'momentum': 0.10,
        'volumeProfile': 0.10,
        'supportResistance': 0.10,
        'bollingerBands': 0.10,
        'risk': 0.30,
        'regimeLabel': '\u0647\u0627\u0628\u0637 \u0642\u0648\u064a \u2014 \u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u062e\u0627\u0637\u0631 \u0623\u0648\u0644\u0627\u064b \u0648\u0627\u0644\u0627\u0628\u062a\u0639\u0627\u062f \u0623\u0641\u0636\u0644',
        'regimeMultiplier': 0.6,
    },
}


def get_adaptive_weights(regime: StockRegime) -> AdaptiveWeights:
    """Calculate analysis component weights based on market regime."""
    config = REGIME_WEIGHT_CONFIGS.get(regime, REGIME_WEIGHT_CONFIGS['RANGE'])
    return AdaptiveWeights(
        technical=config['technical'],
        fundamental=config['fundamental'],
        momentum=config['momentum'],
        volumeProfile=config['volumeProfile'],
        supportResistance=config['supportResistance'],
        bollingerBands=config['bollingerBands'],
        risk=config['risk'],
        regime=regime,
        regimeLabel=config['regimeLabel'],
        regimeMultiplier=config['regimeMultiplier'],
    )


# ============================================================================
# 5. POSITION OVERRIDE ENGINE
# ============================================================================

def apply_position_override(
    current_signal: str,
    user_position_pnl: Optional[float],
    rsi: Optional[float],
    rsi_overbought: float,
    rsi_oversold: float,
    bollinger_width_pct: Optional[float],
    trend: str,
    price_vs_ma20: Optional[float],
) -> Optional[PositionOverrideResult]:
    """
    Override the generated signal based on the user's existing position state.
    Key rule: If the user is already in profit and indicators show exhaustion,
    flip the signal to TAKE_PROFIT regardless of what the model says.
    """
    if user_position_pnl is None:
        return None

    no_override = PositionOverrideResult(
        shouldOverride=False,
        originalSignal=current_signal,
        overrideSignal=current_signal,
        reason='',
        reasonAr='',
    )

    # ---- PROFITABLE LONG POSITION ----
    if user_position_pnl > 0:
        # Rule 1: Significant profit + RSI overbought = TAKE_PROFIT
        if user_position_pnl >= 10 and rsi is not None and rsi >= rsi_overbought:
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal=current_signal,
                overrideSignal='TAKE_PROFIT',
                reason=f'Position +{user_position_pnl:.1f}% with RSI {rsi:.0f} >= {rsi_overbought} (overbought)',
                reasonAr=f'\u0627\u0644\u0645\u0631\u0643\u0632 \u0631\u0627\u0628\u062d {user_position_pnl:.1f}% \u0648\u0627\u0644\u0640 RSI {rsi:.0f} \u0641\u064a \u062a\u0634\u0628\u0639 \u0634\u0631\u0627\u0626\u064a \u2014 \u062c\u0646\u064a \u0623\u0631\u0628\u0627\u062d',
            )

        # Rule 2: Big profit + bearish trend reversal = TAKE_PROFIT
        if user_position_pnl >= 15 and trend == 'BEARISH':
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal=current_signal,
                overrideSignal='TAKE_PROFIT',
                reason=f'Position +{user_position_pnl:.1f}% but trend reversed to BEARISH',
                reasonAr=f'\u0627\u0644\u0645\u0631\u0643\u0632 \u0631\u0627\u0628\u062d {user_position_pnl:.1f}% \u0644\u0643\u0646 \u0627\u0644\u0627\u062a\u062c\u0627\u0647 \u0627\u0646\u0639\u0643\u0633 \u0647\u0627\u0628\u0637 \u2014 \u062c\u0646\u064a \u0623\u0631\u0628\u0627\u062d \u0641\u0648\u0631\u0627\u064b',
            )

        # Rule 3: Big profit + price dropped below MA20 = TAKE_PROFIT
        if user_position_pnl >= 12 and price_vs_ma20 is not None and price_vs_ma20 < -2:
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal=current_signal,
                overrideSignal='TAKE_PROFIT',
                reason=f'Position +{user_position_pnl:.1f}% but price {price_vs_ma20:.1f}% below MA20',
                reasonAr=f'\u0627\u0644\u0645\u0631\u0643\u0632 \u0631\u0627\u0628\u062d {user_position_pnl:.1f}% \u0644\u0643\u0646 \u0627\u0644\u0633\u0639\u0631 \u0646\u0632\u0644 \u062a\u062d\u062a \u0627\u0644\u0645\u062a\u0648\u0633\u0637 \u2014 \u062c\u0646\u064a \u0623\u0631\u0628\u0627\u062d',
            )

        # Rule 4: Moderate profit + BB very wide (exhaustion) = TAKE_PROFIT
        if user_position_pnl >= 8 and bollinger_width_pct is not None and bollinger_width_pct > 8:
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal=current_signal,
                overrideSignal='TAKE_PROFIT',
                reason=f'Position +{user_position_pnl:.1f}% with BB width {bollinger_width_pct:.1f}% (exhaustion)',
                reasonAr=f'\u0627\u0644\u0645\u0631\u0643\u0632 \u0631\u0627\u0628\u062d {user_position_pnl:.1f}% \u0648\u0627\u0644\u0628\u0648\u0644\u0646\u062c\u0631 \u0645\u062a\u0633\u0639 \u062c\u062f\u0627\u064b (\u0625\u0631\u0647\u0627\u0642) \u2014 \u062c\u0646\u064a \u0623\u0631\u0628\u0627\u062d',
            )

        # Rule 5: Huge profit (>20%) — always suggest taking at least partial profit
        if user_position_pnl >= 20 and current_signal != 'TAKE_PROFIT':
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal=current_signal,
                overrideSignal='TAKE_PROFIT',
                reason=f'Position +{user_position_pnl:.1f}% \u2014 profit protection trigger at 20%',
                reasonAr=f'\u0627\u0644\u0645\u0631\u0643\u0632 \u0631\u0627\u0628\u062d {user_position_pnl:.1f}% \u2014 \u062d\u0645\u0627\u064a\u0629 \u0627\u0644\u0623\u0631\u0628\u0627\u062d (\u062a\u062c\u0627\u0648\u0632 20%)',
            )

    # ---- LOSING POSITION ----
    if user_position_pnl < 0:
        # Rule 6: Significant loss + RSI oversold in downtrend = DON'T add to loser
        if user_position_pnl <= -8 and trend == 'BEARISH' and rsi is not None and rsi <= rsi_oversold and current_signal == 'BUY':
            return PositionOverrideResult(
                shouldOverride=True,
                originalSignal='BUY',
                overrideSignal='HOLD',
                reason=f'Position -{abs(user_position_pnl):.1f}% in BEARISH trend \u2014 avoid adding to loser (catching falling knife)',
                reasonAr=f'\u062e\u0633\u0627\u0631\u0629 {abs(user_position_pnl):.1f}% \u0641\u064a \u0627\u062a\u062c\u0627\u0647 \u0647\u0627\u0628\u0637 \u2014 \u0645\u0641\u064a\u0634 \u062d\u0627\u062c\u0629 \u062a\u0636\u064a\u0641 \u0639\u0644\u0649 \u062e\u0627\u0633\u0631',
            )

    return no_override


# ============================================================================
# 6. MAIN ENTRY POINT — TIE EVERYTHING TOGETHER
# ============================================================================

def run_dynamic_analysis(input_data: DynamicAnalysisInput) -> DynamicAnalysisResult:
    """
    Main entry point. Runs all 4 Gemini modules and returns unified result.
    """
    notes: List[str] = []
    notes_ar: List[str] = []

    # ---- Step 1: Classify market context ----
    regime = detect_stock_regime(
        input_data.trend, input_data.rsi, input_data.adx,
        input_data.priceVsMA20, input_data.priceVsMA50,
    )
    atr_pct = (input_data.atr / input_data.close * 100) if input_data.atr and input_data.close > 0 else 2.0
    volatility = classify_volatility(atr_pct)
    sector_speed = classify_sector_speed(input_data.sector)

    notes.append(f'Regime={regime}, Vol={volatility}, Sector={sector_speed}')
    notes_ar.append(f'\u0627\u0644\u0648\u0636\u0639: {REGIME_LABELS_AR.get(regime, regime)}, \u0627\u0644\u062a\u0642\u0644\u0628: {VOLATILITY_LABELS_AR.get(volatility, volatility)}, \u0627\u0644\u0642\u0637\u0627\u0639: {SECTOR_SPEED_LABELS_AR.get(sector_speed, sector_speed)}')

    # ---- Step 2: Dynamic Parameter Matrix ----
    params = get_dynamic_params(regime, volatility, sector_speed)
    notes.append(f'RSI: {params.rsiOversold}/{params.rsiOverbought}, ATR Stop: {params.atrStopMultiplier}x, Min R:R: {params.minRiskReward}')
    notes_ar.append(f'RSI: {params.rsiOversold}/{params.rsiOverbought}, \u0648\u0642\u0641: {params.atrStopMultiplier}\u00d7ATR, \u062d\u062f R:R: {params.minRiskReward}')

    # ---- Step 3: BB Squeeze ----
    squeeze = detect_bb_squeeze(input_data.bollingerWidthPct, input_data.bollingerWidthHistory)
    if squeeze.level != 'NONE':
        notes.append(f'BB Squeeze: {squeeze.level} (score: {squeeze.squeezeScore})')
        notes_ar.append(f'\u0627\u0646\u0636\u063a\u0627\u0637 \u0628\u0648\u0644\u0646\u062c\u0631: {squeeze.level} (\u0645\u0633\u062a\u0648\u0649: {squeeze.squeezeScore})')

    # ---- Step 4: Structural Targets ----
    targets: Optional[StructuralTargets] = None
    if input_data.atr and input_data.atr > 0 and input_data.currentSignal in ('BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'):
        signal = 'BUY' if input_data.currentSignal in ('BUY', 'STRONG_BUY') else 'SELL'
        targets = calculate_structural_targets(
            entry=input_data.close,
            atr=input_data.atr,
            signal=signal,
            support=input_data.support,
            resistance=input_data.resistance,
            far_support=input_data.farSupport,
            far_resistance=input_data.farResistance,
            recent_swing_highs=input_data.recentSwingHighs,
            recent_swing_lows=input_data.recentSwingLows,
            min_risk_reward=params.minRiskReward,
            atr_stop_multiplier=params.atrStopMultiplier,
            atr_target_multiplier=params.atrTargetMultiplier,
            bb_squeeze_level=squeeze.level,
        )
        src_label = TARGET_SOURCE_LABELS_AR.get(targets.targetSource, targets.targetSource)
        notes.append(f'Target: {targets.target:.2f} ({targets.targetSource}), Stop: {targets.stopLoss:.2f} ({targets.stopSource}), R:R: {targets.riskReward}')
        notes_ar.append(f'\u0647\u062f\u0641: {targets.target:.2f} ({src_label}), \u0648\u0642\u0641: {targets.stopLoss:.2f} ({targets.stopSource}), \u0646\u0633\u0628\u0629: {targets.riskReward}')

    # ---- Step 5: Adaptive Weights ----
    weights = get_adaptive_weights(regime)
    notes.append(f'Weights: Tech={weights.technical*100:.0f}% Fund={weights.fundamental*100:.0f}% Mom={weights.momentum*100:.0f}% Risk={weights.risk*100:.0f}%')
    notes_ar.append(f'\u0627\u0644\u0623\u0648\u0632\u0627\u0646: \u0641\u0646\u064a={weights.technical*100:.0f}% \u0623\u0633\u0627\u0633\u064a={weights.fundamental*100:.0f}% \u0632\u062e\u0645={weights.momentum*100:.0f}% \u0645\u062e\u0627\u0637\u0631={weights.risk*100:.0f}%')

    # ---- Step 6: Position Override ----
    position_override: Optional[PositionOverrideResult] = None
    if input_data.userPositionPnl is not None:
        position_override = apply_position_override(
            current_signal=input_data.currentSignal,
            user_position_pnl=input_data.userPositionPnl,
            rsi=input_data.rsi,
            rsi_overbought=params.rsiOverbought,
            rsi_oversold=params.rsiOversold,
            bollinger_width_pct=input_data.bollingerWidthPct,
            trend=input_data.trend,
            price_vs_ma20=input_data.priceVsMA20,
        )
        if position_override and position_override.shouldOverride:
            orig_label = SIGNAL_LABELS_AR.get(position_override.originalSignal, position_override.originalSignal)
            over_label = SIGNAL_LABELS_AR.get(position_override.overrideSignal, position_override.overrideSignal)
            notes.append(f'OVERRIDE: {position_override.originalSignal} \u2192 {position_override.overrideSignal}: {position_override.reason}')
            notes_ar.append(f'\u062a\u062c\u0627\u0648\u0632: {orig_label} \u2192 {over_label}: {position_override.reasonAr}')

    return DynamicAnalysisResult(
        params=params,
        squeeze=squeeze,
        targets=targets,
        weights=weights,
        positionOverride=position_override,
        regime=regime,
        volatility=volatility,
        sectorSpeed=sector_speed,
        analysisNotes=notes,
        analysisNotesAr=notes_ar,
    )


# ============================================================================
# DATA SERIALIZATION — Convert dataclasses to dicts for JSON response
# ============================================================================

def _dataclass_to_dict(obj) -> Any:
    """Recursively convert dataclasses to dicts."""
    if hasattr(obj, '__dataclass_fields__'):
        return {k: _dataclass_to_dict(v) for k, v in obj.__dict__.items()}
    if isinstance(obj, list):
        return [_dataclass_to_dict(i) for i in obj]
    if isinstance(obj, (int, float, str, bool, type(None))):
        return obj
    return str(obj)


def result_to_json(result: DynamicAnalysisResult) -> Dict[str, Any]:
    """Convert DynamicAnalysisResult to JSON-serializable dict."""
    return _dataclass_to_dict(result)