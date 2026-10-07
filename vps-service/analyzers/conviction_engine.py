"""
Conviction Engine — "هل الوقت مناسب للدخول؟"
================================================
Independent of Master Score (which measures "is the stock good?"),
Conviction Score measures "is NOW the right time to enter?".

6 weighted factors → 0-100 score → action decision.

Conviction Levels:
- 85-100: "فرصة نادرة" → MAX position (15%)
- 70-84:  "فرصة كويسة" → NORMAL position (10%)
- 55-69:  "فرصة عادية" → SMALL position (5%)
- <55:     "مش فرصة" → SKIP

Author: دليل الاستثمار — GLMinvestment
"""

from dataclasses import dataclass, asdict
from typing import Dict, Optional


# ============================================================================
# WEIGHTS — sum = 1.0
# ============================================================================
CONVICTION_WEIGHTS = {
    'technical_alignment': 0.25,   # Are all indicators agreeing?
    'volume_confirmation': 0.20,   # Is volume supporting the move?
    'sr_quality': 0.20,            # Is there clear S/R nearby?
    'regime_favorability': 0.15,   # Is the market with us?
    'sector_strength': 0.10,       # Is the sector up?
    'risk_reward': 0.10,           # Is R/R good enough?
}


@dataclass
class ConvictionResult:
    """Result of the conviction scoring engine."""
    score: float              # 0-100
    level: str                # 'rare' | 'good' | 'normal' | 'skip'
    level_ar: str             # Arabic label
    action: str               # 'MAX' | 'NORMAL' | 'SMALL' | 'SKIP'
    position_size_pct: float  # 0, 5, 10, or 15
    factors: Dict[str, float]  # individual factor scores
    factor_details: Dict[str, str]  # Arabic explanations
    narrative: str            # Arabic summary

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# FACTOR SCORERS — each returns (score: float, detail_ar: str)
# ============================================================================

def _score_technical_alignment(
    signal: str,
    rsi: float,
    macd_bullish: bool,
    ma_alignment: str,
    bb_position: str,
    stochastic_signal: str,
) -> tuple:
    """
    Factor 1: technical_alignment (weight: 0.25)
    Count how many of {RSI, MACD, MA_alignment, BB_position, Stochastic}
    agree with the direction. Score = (agreeing / total) * 100.
    """
    is_buy = signal in ('BUY', 'STRONG_BUY')
    is_sell = signal in ('SELL', 'STRONG_SELL')

    if not (is_buy or is_sell):
        return 50.0, "إشارة WAIT — محايدة"

    agreeing = 0
    total = 5

    # RSI agreement
    if is_buy and rsi < 50:
        agreeing += 1
    elif is_sell and rsi > 50:
        agreeing += 1
    elif not is_buy and rsi >= 45 and rsi <= 55:
        agreeing += 0.5  # neutral RSI — partial credit

    # MACD agreement
    if is_buy and macd_bullish:
        agreeing += 1
    elif is_sell and not macd_bullish:
        agreeing += 1

    # MA alignment
    if is_buy and ma_alignment == 'bullish':
        agreeing += 1
    elif is_sell and ma_alignment == 'bearish':
        agreeing += 1
    elif ma_alignment == 'mixed':
        agreeing += 0.3  # slight credit

    # BB position
    if is_buy and bb_position == 'lower':
        agreeing += 1
    elif is_buy and bb_position == 'middle':
        agreeing += 0.4
    elif is_sell and bb_position == 'upper':
        agreeing += 1
    elif is_sell and bb_position == 'middle':
        agreeing += 0.4

    # Stochastic
    if is_buy and stochastic_signal == 'bullish':
        agreeing += 1
    elif is_sell and stochastic_signal == 'bearish':
        agreeing += 1
    elif stochastic_signal == 'neutral':
        agreeing += 0.3

    score = min(100, (agreeing / total) * 100)

    if score >= 80:
        detail = f"اتفاق قوي {int(agreeing)}/{total} مؤشرات"
    elif score >= 60:
        detail = f"اتفاق متوسط {agreeing:.1f}/{total} مؤشرات"
    elif score >= 40:
        detail = f"تضارب جزئي — {agreeing:.1f}/{total} موافقة"
    else:
        detail = f"تضارب شديد — مؤشرات متعاكسة ({agreeing:.1f}/{total})"

    return round(score, 1), detail


def _score_volume_confirmation(volume_ratio: float) -> tuple:
    """
    Factor 2: volume_confirmation (weight: 0.20)
    Is volume supporting the move?
    """
    if volume_ratio > 2.0:
        score = 100
        detail = f"حجم ضخم جداً ({volume_ratio:.1f}×) — تأكيد قوي"
    elif volume_ratio > 1.5:
        score = 75
        detail = f"حجم مرتفع ({volume_ratio:.1f}×) — تأكيد جيد"
    elif volume_ratio > 1.2:
        score = 50
        detail = f"حجم أعلى من المعتاد ({volume_ratio:.1f}×)"
    elif volume_ratio > 0.8:
        score = 25
        detail = f"حجم طبيعي ({volume_ratio:.1f}×) — لا تأكيد"
    else:
        score = 0
        detail = f"حجم ضعيف ({volume_ratio:.1f}×) — تحذير"

    return float(score), detail


def _score_sr_quality(
    close: float,
    nearest_support: float,
    nearest_resistance: float,
) -> tuple:
    """
    Factor 3: sr_quality (weight: 0.20)
    Is there clear S/R nearby? Measures distance from support & resistance.
    """
    if close <= 0:
        return 50.0, "سعر غير صالح"

    dist_to_support_pct = abs(close - nearest_support) / close * 100
    dist_to_resistance_pct = abs(nearest_resistance - close) / close * 100

    # Near support and far from resistance = ideal buying zone
    if dist_to_support_pct < 3 and dist_to_resistance_pct > 5:
        score = 100
        detail = "بالقرب من الدعم وبعيد عن المقاومة — منطقة مثالية"
    elif dist_to_support_pct < 5:
        score = 75
        detail = f"قريب من الدعم ({dist_to_support_pct:.1f}%) — جيد"
    elif dist_to_resistance_pct < 3:
        score = 25
        detail = f"قريب من المقاومة ({dist_to_resistance_pct:.1f}%) — خطورة"
    elif dist_to_resistance_pct < 1:
        score = 0
        detail = "عند المقاومة مباشرة — دخول محظور"
    else:
        score = 50
        detail = f"في المنتصف (دعم {dist_to_support_pct:.1f}% | مقاومة {dist_to_resistance_pct:.1f}%)"

    return float(score), detail


def _score_regime_favorability(
    signal: str,
    market_regime: str,
) -> tuple:
    """
    Factor 4: regime_favorability (weight: 0.15)
    Is the market with us?
    """
    is_buy = signal in ('BUY', 'STRONG_BUY')
    is_sell = signal in ('SELL', 'STRONG_SELL')

    # Mapping from master_analyzer regime vocabulary to conviction vocabulary
    # master uses: bull_trend, bear_trend, ranging, unknown, volatile_bull, volatile_bear
    regime_map = {
        'bull_trend': 'strong_bull',
        'volatile_bull': 'weak_bull',
        'ranging': 'range',
        'volatile_bear': 'weak_bear',
        'bear_trend': 'strong_bear',
        'unknown': 'range',
    }
    regime = regime_map.get(market_regime, 'range')

    if is_buy:
        scores = {
            'strong_bull': (100, "سوق صاعد قوي + شراء = تطابق مثالي"),
            'weak_bull':  (75,  "سوق صاعد ضعيف + شراء = موافق"),
            'range':      (50,  "سوق عرضي + شراء = محايد"),
            'weak_bear':  (25,  "سوق هابط ضعيف + شراء = مخاطرة"),
            'strong_bear':(0,   "سوق هابط قوي + شراء = خطير جداً"),
        }
    elif is_sell:
        scores = {
            'strong_bear':(100, "سوق هابط قوي + بيع = تطابق مثالي"),
            'weak_bear':  (75,  "سوق هابط ضعيف + بيع = موافق"),
            'range':      (50,  "سوق عرضي + بيع = محايد"),
            'weak_bull':  (25,  "سوق صاعد ضعيف + بيع = مخاطرة"),
            'strong_bull':(0,   "سوق صاعد قوي + بيع = خطير جداً"),
        }
    else:
        return 50.0, "إشارة محايدة — لا تأثير للـ regime"

    score, detail = scores.get(regime, (50, "regime غير معروف"))
    return float(score), detail


def _score_sector_strength(sector_change_pct: float) -> tuple:
    """
    Factor 5: sector_strength (weight: 0.10)
    Is the sector up?
    """
    if sector_change_pct > 2.0:
        score = 100
        detail = f"القطاع صاعد بقوة (+{sector_change_pct:.1f}%)"
    elif sector_change_pct > 0:
        score = 75
        detail = f"القطاع إيجابي (+{sector_change_pct:.1f}%)"
    elif sector_change_pct > -2:
        score = 50
        detail = f"القطاع محايد ({sector_change_pct:.1f}%)"
    elif sector_change_pct > -5:
        score = 25
        detail = f"القطاع سلبي ({sector_change_pct:.1f}%)"
    else:
        score = 0
        detail = f"القطاع هابط بقوة ({sector_change_pct:.1f}%)"

    return float(score), detail


def _score_risk_reward(rr_ratio: float) -> tuple:
    """
    Factor 6: risk_reward (weight: 0.10)
    Is R/R good enough?
    """
    if rr_ratio >= 3.0:
        score = 100
        detail = f"R/R ممتاز ({rr_ratio:.1f}:1) — فرصة استثنائية"
    elif rr_ratio >= 2.0:
        score = 80
        detail = f"R/R جيد ({rr_ratio:.1f}:1) — يستحق المخاطرة"
    elif rr_ratio >= 1.5:
        score = 60
        detail = f"R/R مقبول ({rr_ratio:.1f}:1)"
    elif rr_ratio >= 1.0:
        score = 30
        detail = f"R/R ضعيف ({rr_ratio:.1f}:1) — حذر"
    else:
        score = 0
        detail = f"R/R غير مقبول ({rr_ratio:.1f}:1) — لا يدخل"

    return float(score), detail


# ============================================================================
# CONVICTION LEVELS
# ============================================================================

def _get_conviction_level(score: float) -> tuple:
    """
    Map score to conviction level.
    Returns (level, level_ar, action, position_size_pct)
    """
    if score >= 85:
        return 'rare', 'فرصة نادرة', 'MAX', 15.0
    elif score >= 70:
        return 'good', 'فرصة كويسة', 'NORMAL', 10.0
    elif score >= 55:
        return 'normal', 'فرصة عادية', 'SMALL', 5.0
    else:
        return 'skip', 'مش فرصة', 'SKIP', 0.0


def _build_narrative(
    score: float,
    level_ar: str,
    action: str,
    factors: Dict[str, float],
    factor_details: Dict[str, str],
) -> str:
    """Generate an Arabic narrative summary."""
    if action == 'SKIP':
        # Find weakest factors
        weak = [(k, v) for k, v in factors.items() if v < 40]
        if weak:
            weakest_name = max(weak, key=lambda x: x[1])[0]
            weakest_detail = factor_details.get(weakest_name, '')
            return f"❌ {level_ar} ({score:.0f}/100) — السبب الرئيسي: {weakest_detail}"
        return f"❌ {level_ar} ({score:.0f}/100) — المؤشرات لا تدعم الدخول"

    # Find strongest and weakest
    strongest = max(factors.items(), key=lambda x: x[1])
    weakest = min(factors.items(), key=lambda x: x[1])

    strength_detail = factor_details.get(strongest[0], '')
    weakness_detail = factor_details.get(weakest[0], '')

    if action == 'MAX':
        return (f"🔥 {level_ar} ({score:.0f}/100) — حجم MAX ({15}%) — "
                f"أقوى نقطة: {strength_detail} | نقطة ضعف: {weakness_detail}")
    elif action == 'NORMAL':
        return (f"✅ {level_ar} ({score:.0f}/100) — حجم عادي ({10}%) — "
                f"أقوى نقطة: {strength_detail} | نقطة ضعف: {weakness_detail}")
    else:  # SMALL
        return (f"⚠️ {level_ar} ({score:.0f}/100) — حجم صغير ({5}%) — "
                f"حذر: {weakness_detail}")


# ============================================================================
# MAIN FUNCTION
# ============================================================================

def calculate_conviction(
    signal: str,                # 'BUY', 'SELL', 'WAIT', etc.
    rsi: float,
    macd_bullish: bool,
    ma_alignment: str,          # 'bullish', 'bearish', 'mixed'
    bb_position: str,           # 'lower', 'middle', 'upper'
    stochastic_signal: str,     # 'bullish', 'bearish', 'neutral'
    volume_ratio: float,
    close: float,
    nearest_support: float,
    nearest_resistance: float,
    market_regime: str,         # 'strong_bull', 'weak_bull', 'range', 'weak_bear', 'strong_bear'
                                # or master_analyzer format: 'bull_trend', 'bear_trend', 'ranging'
    sector_change_pct: float = 0.0,
    rr_ratio: float = 0.0,
) -> ConvictionResult:
    """
    Calculate the conviction score — "is NOW the right time to enter?".

    This is INDEPENDENT of the master score (which measures "is the stock good?").
    Conviction measures TIMING: are all conditions aligned for entry RIGHT NOW?

    Returns:
        ConvictionResult with score, level, action, position sizing, and narrative.
    """
    # ── Score each factor ────────────────────────────────────────────────
    tech_score, tech_detail = _score_technical_alignment(
        signal=signal,
        rsi=rsi,
        macd_bullish=macd_bullish,
        ma_alignment=ma_alignment,
        bb_position=bb_position,
        stochastic_signal=stochastic_signal,
    )

    vol_score, vol_detail = _score_volume_confirmation(volume_ratio)

    sr_score, sr_detail = _score_sr_quality(
        close=close,
        nearest_support=nearest_support,
        nearest_resistance=nearest_resistance,
    )

    regime_score, regime_detail = _score_regime_favorability(
        signal=signal,
        market_regime=market_regime,
    )

    sector_score, sector_detail = _score_sector_strength(sector_change_pct)

    rr_score, rr_detail = _score_risk_reward(rr_ratio)

    # ── Weighted sum ─────────────────────────────────────────────────────
    factors = {
        'technical_alignment': tech_score,
        'volume_confirmation': vol_score,
        'sr_quality': sr_score,
        'regime_favorability': regime_score,
        'sector_strength': sector_score,
        'risk_reward': rr_score,
    }

    factor_details = {
        'technical_alignment': tech_detail,
        'volume_confirmation': vol_detail,
        'sr_quality': sr_detail,
        'regime_favorability': regime_detail,
        'sector_strength': sector_detail,
        'risk_reward': rr_detail,
    }

    weighted_sum = sum(
        factors[k] * CONVICTION_WEIGHTS[k]
        for k in CONVICTION_WEIGHTS
    )
    score = round(min(100, max(0, weighted_sum)), 1)

    # ── Determine level and action ───────────────────────────────────────
    level, level_ar, action, position_size_pct = _get_conviction_level(score)

    # ── Build narrative ──────────────────────────────────────────────────
    narrative = _build_narrative(score, level_ar, action, factors, factor_details)

    return ConvictionResult(
        score=score,
        level=level,
        level_ar=level_ar,
        action=action,
        position_size_pct=position_size_pct,
        factors=factors,
        factor_details=factor_details,
        narrative=narrative,
    )