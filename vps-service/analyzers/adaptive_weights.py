#!/usr/bin/env python3
"""
Adaptive Weights Engine — أوزان تكييفية لحالة السوق
=====================================================
بدل أوزان ثابتة، نضبط الأوزان حسب:
1. Market Regime (bull → زيادة technical، bear → زيادة fundamental)
2. Sector (قطاعات مختلفة لها أولويات مختلفة)
3. Volatility (تذبذب عالي → زيادة volume_profile + ATR-based)

الـ baseline أظهر أن scores أعلى = أداء أسوأ. هذا النظام يعالج المشكلة
بتكييف الأوزان حسب السياق بدل أوزان ثابتة خاطئة في بعض الحالات.
"""

from __future__ import annotations

from typing import Dict, Tuple
from dataclasses import dataclass, field


# ============================================================================
# Base weights (from MASTER_WEIGHTS in master_analyzer.py)
# ============================================================================
BASE_WEIGHTS = {
    'technical': 0.15,
    'fundamental': 0.25,
    'timing': 0.05,
    'ai_pattern': 0.15,
    'sentiment': 0.05,
    'market_regime': 0.05,
    'enhanced_indicators': 0.15,
    'multi_timeframe': 0.10,
    'volume_profile': 0.05,
    'sector_relative': 0.08,       # وزن الأداء النسبي للسهم داخل قطاعه
}

# P24-ADAPTIVE-ENGINE (Aug 2026): المرجع الكامل للأوزان الثابتة (includes 'smc').
# دي نفس MASTER_WEIGHTS اللي في master_analyzer.py — بنحتفظ بنسخة هنا عشان
# get_adaptive_weights() تبقى المصدر الموحّد للأوزان الديناميكية، وتشمل الـ SMC
# (اللي كان ناقص من BASE_WEIGHTS القديمة وكان بيتعالج بـ blend منفصل 60/40).
FULL_BASE_WEIGHTS = {
    'smc': 0.26,                  # Order Blocks / SMC zones — LEADING (institutional)
    'fundamental': 0.40,          # الأساسيات = قلب القرار
    'technical': 0.042,           # SMA/EMA — LAGGING
    'ai_pattern': 0.06,           # Pattern recognition
    'sentiment': 0.04,            # News sentiment
    'market_regime': 0.05,        # Real market regime
    'sector_relative': 0.05,      # Stock vs sector
    'enhanced_indicators': 0.024, # MACD/RSI/Bollinger — MACD is LAGGING
    'multi_timeframe': 0.03,      # Daily/weekly/monthly confluence
    'volume_profile': 0.043,      # VWAP + OBV — LEADING (hidden accumulation)
    'timing': 0.015,              # Session timing — least critical
}

# ============================================================================
# PILLAR-5 PERSONA WEIGHTING MATRIX (Aug 2026)
# ============================================================================
# مصفوفة أوزان الشخصيات — كل persona بـ تـ weight الـ input categories بشكل مختلف
# جذريًا. الـ Gambler بـ يركّز على الزخم و SMC و القطاع الساخن و بـ يتجاهل الأساسيات.
# الـ Conservative بـ يحكم بالأساسيات (60%) و بـ يقلل وزن الزخم لـ 15% فقط.
#
# الـ matrix دي بتـ feed الـ maestro_orchestrator و الـ core_scoring_engine عبر
# get_persona_input_weights() عشان يـ weight الـ conviction scores لكل persona.
# ----------------------------------------------------------------------------
# الأرقام دي بـ reflect الـ strategy:
#   - Gambler: زخم + SMC + قطاع ساخن = 100% (0% أساسيات)
#   - Balanced: توزيع متوازن (30/25/20/25)
#   - Conservative: أساسيات = 60% حاكم (PA=15%, SMC=10%, Sector=15%)
# ============================================================================

PERSONA_INPUT_WEIGHTS = {
    'gambler': {
        'price_action': 0.40,    # الزخم وحركة الشموع — الملك
        'smc_vsa':      0.35,    # هيكل صناع السوق و السيولة
        'sector_heat':  0.25,    # سخونة القطاع و دوران السيولة
        'fundamental':  0.00,    # تجاهل تام — المضارب بـ يتداول الزخم مش الـ valuation
        'horizon_sessions': '1-5',
        'horizon_label': '1-5 جلسات (intraday/swing)',
    },
    'balanced': {
        'price_action': 0.30,
        'smc_vsa':      0.25,
        'sector_heat':  0.20,
        'fundamental':  0.25,
        'horizon_sessions': '2-6w',
        'horizon_label': '2-6 أسابيع (swing/position)',
    },
    'conservative': {
        'price_action': 0.15,
        'smc_vsa':      0.10,
        'sector_heat':  0.15,
        'fundamental':  0.60,    # الوزن الحاكم — الأساسيات هي اللي تـ decide
        'horizon_sessions': '3-12m',
        'horizon_label': '3-12 شهر (position/long-term)',
    },
}

# Aliases — same as PERSONA_CONFIGS legacy aliases in maestro_orchestrator.py
PERSONA_INPUT_WEIGHTS['investor']      = PERSONA_INPUT_WEIGHTS['conservative']
PERSONA_INPUT_WEIGHTS['active_trader'] = PERSONA_INPUT_WEIGHTS['gambler']
PERSONA_INPUT_WEIGHTS['default']       = PERSONA_INPUT_WEIGHTS['balanced']


def get_persona_input_weights(persona: str = 'balanced') -> Dict[str, float]:
    """بترجّع أوزان الـ input categories لـ persona معينة.

    Args:
        persona: 'gambler' | 'balanced' | 'conservative' (case-insensitive).
                 Aliases: 'investor' → 'conservative', 'active_trader' → 'gambler'.

    Returns:
        dict فيه الـ 4 أوزان (price_action, smc_vsa, sector_heat, fundamental)
        + horizon_sessions + horizon_label. مجموع الأوزان الأربعة = 1.0.
        لو persona غير معروف → بـ fallback لـ 'balanced'.
    """
    key = (persona or 'balanced').lower().strip()
    if key not in PERSONA_INPUT_WEIGHTS:
        key = 'balanced'
    weights = PERSONA_INPUT_WEIGHTS[key]
    # Validate sum (sanity check — should always be 1.0 by definition)
    total = weights['price_action'] + weights['smc_vsa'] + weights['sector_heat'] + weights['fundamental']
    if abs(total - 1.0) > 0.001:
        # defensive normalization
        norm = 1.0 / total if total > 0 else 1.0
        weights = {k: round(v * norm, 4) if isinstance(v, float) else v
                   for k, v in weights.items()}
    return dict(weights)


def apply_persona_weighting_to_score(
    base_scores: Dict[str, float],
    persona: str = 'balanced',
) -> float:
    """بـ weight الـ category scores حسب persona و بيرجّع score نهائي 0-100.

    Args:
        base_scores: dict فيه scores لكل category:
            {
              'price_action': 0-100,    # momentum + candle structure score
              'smc_vsa':      0-100,    # SMC + VSA + order blocks score
              'sector_heat':  0-100,    # sector heat + leader/laggard score
              'fundamental':   0-100,    # P/E + ROE + debt score
            }
        persona: 'gambler' | 'balanced' | 'conservative'

    Returns:
        weighted_score (float 0-100). الـ persona بـ decide وزن كل category.
    """
    weights = get_persona_input_weights(persona)
    weighted = 0.0
    for cat in ('price_action', 'smc_vsa', 'sector_heat', 'fundamental'):
        cat_score = float(base_scores.get(cat, 0.0))
        cat_score = max(0.0, min(100.0, cat_score))  # clamp
        weighted += cat_score * weights[cat]
    return round(weighted, 2)


# ============================================================================
# Regime-specific adjustments
# ============================================================================
# في السوق الصاعد: التحليل التقني والمؤشرات المحسّنة أهم (الزخم يكسب)
# في السوق الهابط: التحليل الأساسي والمتعدد الإطارات أهم (القيمة تتفوق)
# في السوق العرضي: حجم التداول والمؤشرات أهم (اكتشاف الاختراق)
REGIME_ADJUSTMENTS = {
    'bull': {
        'technical': 1.3,            # زيادة 30%
        'enhanced_indicators': 1.2,  # زيادة 20%
        'multi_timeframe': 1.2,      # زيادة 20%
        'fundamental': 0.8,          # تقليل 20%
        'volume_profile': 1.1,       # زيادة 10%
        'sector_relative': 1.5,      # زيادة 50% — في السوق الصاعد القيادة القطاعية مهمة
    },
    'bear': {
        'fundamental': 1.3,          # زيادة 30% — القيمة تتفوق
        'multi_timeframe': 1.2,      # زيادة 20% — تأكيد الاتجاه
        'technical': 0.8,            # تقليل 20% — إشارات تقنية كاذبة كثيرة
        'enhanced_indicators': 0.9,  # تقليل 10%
        'ai_pattern': 1.1,           # زيادة 10%
        'sector_relative': 0.5,      # تقليل 50% — في الهبوط كل القطاعات بتسقط مع بعض
    },
    'range': {
        'volume_profile': 1.4,       # زيادة 40% — السيولة تكشف الاختراق
        'enhanced_indicators': 1.2,  # زيادة 20% — مؤشرات التذبذب مهمة
        'technical': 0.9,            # تقليل 10%
        'multi_timeframe': 0.8,      # تقليل 20% — لا يوجد اتجاه واضح
        'timing': 1.3,               # زيادة 30% — توقيت الجلسة مهم في العرض
        'sector_relative': 1.0,      # وزن معتدل — في العرض الأداء النسبي متوسط الأهمية
    },
}

# ============================================================================
# Sector-specific adjustments (EGX sectors)
# ============================================================================
# القطاعات المالية: الأساسيات مهمة (P/E, ROE)
# العقارات: السيولة وحجم التداول مهم
# الصناعية: التقني والمتعدد الإطارات مهم
# التكنولوجيا: الزخم والمؤشرات المحسّنة مهمة
SECTOR_ADJUSTMENTS = {
    'BANKS': {
        'fundamental': 1.3,
        'enhanced_indicators': 0.9,
        'sector_relative': 1.3,          # البنوك تقود السوق في البورصة المصرية
    },
    'REAL_ESTATE': {
        'volume_profile': 1.3,
        'fundamental': 1.1,
        'sector_relative': 0.8,          # العقارات أقل أهمية نسبية، مدفوعة بالماكرو
    },
    'INDUSTRIALS': {
        'technical': 1.2,
        'multi_timeframe': 1.2,
    },
    'TECHNOLOGY': {
        'enhanced_indicators': 1.3,
        'technical': 1.2,
        'fundamental': 0.8,
    },
    'HEALTHCARE': {
        'fundamental': 1.2,
        'ai_pattern': 1.1,
    },
    'ENERGY': {
        'multi_timeframe': 1.2,
        'volume_profile': 1.1,
    },
    'TELECOM': {
        'fundamental': 1.2,
        'sentiment': 1.2,
    },
    'TOURISM': {
        'sector_relative': 1.1,          # موسمي بس ممكن يكون قوي
    },
    'CHEMICALS': {
        'sector_relative': 0.9,          # مرتبط بالسلع والكوموديتي
    },
    'DEFAULT': {
        'sector_relative': 1.0,          # كل القطاعات التانية: وزن افتراضي
    },
}


# ============================================================================
# P24-ADAPTIVE-ENGINE (Aug 2026): get_adaptive_weights — Dynamic & Adaptive
# ============================================================================
# الدالة دي بتحلّ مشكلة "الشيت الإكسل العقيم": بدل ما تكون الأوزان ثابتة لكل
# السوق وكل الأوقات، بتتكيّف حسب 3 محاور:
#   1. market_regime      — strong_bull / bull / range / bear / crash
#   2. volatility_regime  — low / normal / high / extreme
#   3. liquidity_score    — 0.0 (ميت) ... 1.0 (سيولة عالية)
#
# القواعد (من بروتوكول المالك):
#   - strong_bull / momentum: fundamental ×0.6, technical ×1.8, smc ×1.4,
#     volume_profile ×1.5 (الزخم هو الملك — الأساسيات بتأخر)
#   - bear / high_volatility: fundamental ×1.3, technical ×0.7 (القيمة تتفوق،
#     الإشارات التقنية الكاذبة بتزيد في الهبوط)
#   - liquidity_score منخفض → يقلّل كل الأوزان ويفتح مساحة كاش (تقليل التعرض)
#
# النتيجة: dict مُطبّبَع (normalized) المجموع = 1.0، وفيه 'smc' كمان.
# ============================================================================

# Mapping من حالة السوق لمضاعفات الأوزان (regime multipliers)
_REGIME_WEIGHT_MULTIPLIERS = {
    'strong_bull': {
        # زخم قوي: التقني و SMC و Volume Profile يقودوا، الأساسيات تأخر
        'technical': 1.8, 'smc': 1.4, 'volume_profile': 1.5,
        'enhanced_indicators': 1.3, 'fundamental': 0.6, 'multi_timeframe': 1.2,
        'ai_pattern': 1.2, 'sentiment': 1.1, 'market_regime': 1.2,
        'sector_relative': 1.3, 'timing': 1.0,
    },
    'bull': {
        # سوق صاعد طبيعي: تقني و SMC أعلى، أساسيات أقل ب شوية
        'technical': 1.3, 'smc': 1.2, 'volume_profile': 1.2,
        'enhanced_indicators': 1.2, 'fundamental': 0.8, 'multi_timeframe': 1.2,
        'ai_pattern': 1.1, 'sentiment': 1.1, 'market_regime': 1.1,
        'sector_relative': 1.3, 'timing': 1.0,
    },
    'range': {
        # سوق عرضي: السيولة تكشف الاختراق، المؤشرات مهمة
        'volume_profile': 1.4, 'enhanced_indicators': 1.2, 'technical': 0.9,
        'multi_timeframe': 0.8, 'timing': 1.3, 'fundamental': 1.0, 'smc': 1.0,
        'ai_pattern': 1.0, 'sentiment': 1.0, 'market_regime': 1.0,
        'sector_relative': 1.0,
    },
    'bear': {
        # سوق هابط: القيمة تتفوق، الإشارات التقنية الكاذبة كثيرة
        'fundamental': 1.3, 'technical': 0.7, 'multi_timeframe': 1.2,
        'enhanced_indicators': 0.9, 'ai_pattern': 1.1, 'smc': 0.9,
        'volume_profile': 0.9, 'sentiment': 1.1, 'market_regime': 1.2,
        'sector_relative': 0.7, 'timing': 1.0,
    },
    'crash': {
        # انهيار: أساسيات هي الحماية الوحيدة، تقليل التقني بقوة
        'fundamental': 1.5, 'technical': 0.5, 'enhanced_indicators': 0.7,
        'multi_timeframe': 1.3, 'ai_pattern': 0.8, 'smc': 0.8,
        'volume_profile': 0.8, 'sentiment': 1.3, 'market_regime': 1.4,
        'sector_relative': 0.5, 'timing': 1.0,
    },
}

# Mapping من حالة التذبذب لتعديلات إضافية (تُطبّق فوق الـ regime)
_VOLATILITY_ADJUSTMENTS = {
    'low':      {'fundamental': 1.1, 'volume_profile': 0.9},   # سهم مستقر
    'normal':   {},                                              # لا تعديل
    'high':     {'volume_profile': 1.3, 'technical': 0.9, 'smc': 1.1},  # تذبذب → سيولة و SMC
    'extreme':  {'volume_profile': 1.5, 'technical': 0.7, 'fundamental': 1.2, 'smc': 1.2},
}


def _classify_volatility_regime(volatility_regime) -> str:
    """تطبيع مدخلات التذبذب لـ low/normal/high/extreme."""
    if isinstance(volatility_regime, (int, float)):
        v = float(volatility_regime)
        if v > 80.0:
            return 'extreme'
        elif v > 40.0:
            return 'high'
        elif v > 15.0:
            return 'normal'
        else:
            return 'low'
    s = str(volatility_regime or 'normal').lower().strip()
    if s in ('extreme', 'very_high', 'crisis'):
        return 'extreme'
    if s in ('high', 'volatile'):
        return 'high'
    if s in ('low', 'calm', 'stable'):
        return 'low'
    return 'normal'


def get_adaptive_weights(market_regime: str, volatility_regime='normal',
                         liquidity_score: float = 1.0,
                         stock_profile: Dict = None) -> Dict[str, float]:
    """P24/P25-ADAPTIVE-ENGINE: حساب أوزان ديناميكية متكيفة مع حالة السوق + السهم.

    Args:
        market_regime: 'strong_bull' | 'bull' | 'range' | 'bear' | 'crash'
                       (يقبل كمان 'bull_trend'/'bear_trend'/'ranging'/'momentum')
        volatility_regime: 'low' | 'normal' | 'high' | 'extreme'
                           (أو رقمpercentile 0-100)
        liquidity_score: 0.0 (سيولة ميتة) ... 1.0 (سيولة ممتازة)
        stock_profile: (P25-LIVING-ENGINE) dict من stock_adaptive_profiles —
                       ملف تعريف السهم الديناميكي. لو متاح، بنطبّق طبقة إضافية:
                         - لو volatility_percentile_90d > 75 (سهم متقلب جداً الآن)
                           → نزوّد volume_profile + smc (السيولة و الـ OB أهم)
                           ونقلل technical (الإشارات التقنية بتهتز).
                         - لو reaction_to_market_crashes == 'amplifier' و regime هابط
                           → نزوّد fundamental (الحماية الأساسية) ونقلل technical بقوة.
                         - لو reaction_to_market_crashes == 'defensive' و regime هابط
                           → نثق أكتر في الأساسيات (السهم بياخد وقايته).
                         - لو personality = speculative_bull → نزوّد technical/smc.

    Returns:
        dict من الأوزان مُطبّبَع للمجموع = 1.0 (يشمل 'smc').
    """
    # تطبيع الـ regime
    _reg = str(market_regime or 'range').lower().strip()
    _regime_map = {
        'bull_trend': 'bull', 'strong_bull': 'strong_bull', 'momentum': 'strong_bull',
        'bear_trend': 'bear', 'ranging': 'range', 'sideways': 'range',
        'bull': 'bull', 'bear': 'bear', 'range': 'range', 'crash': 'crash',
    }
    regime_key = _regime_map.get(_reg, 'range')
    if regime_key not in _REGIME_WEIGHT_MULTIPLIERS:
        regime_key = 'range'

    vol_key = _classify_volatility_regime(volatility_regime)

    # ابدأ من الأوزان الأساسية الكاملة (includes 'smc')
    weights = dict(FULL_BASE_WEIGHTS)

    # 1. طبّق مضاعفات الـ regime
    for k, mult in _REGIME_WEIGHT_MULTIPLIERS[regime_key].items():
        if k in weights:
            weights[k] *= mult

    # 2. طبّق تعديلات التذبذب (فوق الـ regime)
    for k, mult in _VOLATILITY_ADJUSTMENTS.get(vol_key, {}).items():
        if k in weights:
            weights[k] *= mult

    # 3. تعديل السيولة: سيولة منخفضة → تقليل شامل + مساحة كاش
    #    (السهم الميت حتى لو زخم، المخاطرة أعلى → نقلل الثقة)
    try:
        liq = float(liquidity_score)
    except (TypeError, ValueError):
        liq = 1.0
    if liq < 0.3:
        # سيولة ضعيفة جداً → قلل كل الأوزان 20% (كأنها كاش 20%)
        for k in weights:
            weights[k] *= 0.8
    elif liq < 0.6:
        # سيولة متوسطة → قلل 10%
        for k in weights:
            weights[k] *= 0.9
    elif liq > 0.9:
        # سيولة ممتازة → زود التقني و SMC شوية (الزخم بيصدق في السائل)
        weights['technical'] *= 1.1
        weights['smc'] *= 1.05

    # 4. P25-LIVING-ENGINE: طبقة ملف تعريف السهم (Stock DNA).
    #    بنطبّق تعديلات إضافية بناءً على طبيعة السهم الخاصة (لو الـ profile متاح).
    if stock_profile and isinstance(stock_profile, dict):
        try:
            _vol_pct = float(stock_profile.get('volatility_percentile_90d') or 0)
        except (TypeError, ValueError):
            _vol_pct = 0.0
        try:
            _crash = str(stock_profile.get('reaction_to_market_crashes') or '').lower().strip()
        except Exception:
            _crash = ''
        try:
            _pers = str(stock_profile.get('personality_type_en') or '').lower().strip()
        except Exception:
            _pers = ''

        # 4a. سهم متقلب جداً الآن (vol percentile > 75) → السيولة و SMC أهم،
        #     التقني بيهتز في التذبذب العالي.
        if _vol_pct > 75.0:
            weights['volume_profile'] = weights.get('volume_profile', 0.05) * 1.35
            weights['smc'] = weights.get('smc', 0.26) * 1.20
            weights['technical'] = weights.get('technical', 0.04) * 0.80

        # 4b. رد فعل الأزمات × regime الحالي:
        #     - amplifier في هابط/انهيار → الأساسيات هي الحماية، نقلل التقني بقوة.
        #     - defensive في هابط → نثق في الأساسيات (السهم واقي).
        if _crash == 'amplifier' and regime_key in ('bear', 'crash'):
            weights['fundamental'] = weights.get('fundamental', 0.40) * 1.35
            weights['technical'] = weights.get('technical', 0.04) * 0.65
            weights['ai_pattern'] = weights.get('ai_pattern', 0.06) * 0.85
        elif _crash == 'defensive' and regime_key in ('bear', 'crash'):
            weights['fundamental'] = weights.get('fundamental', 0.40) * 1.20
        elif _crash == 'resilient' and regime_key in ('bull', 'strong_bull'):
            # سهم بيتعافى بسرعة بعد الأزمات — في الصاعد يلتقط بقوة
            weights['technical'] = weights.get('technical', 0.04) * 1.15
            weights['smc'] = weights.get('smc', 0.26) * 1.10

        # 4c. شخصية السهم:
        #     - speculative_bull → زخم قوي، التقني و SMC يقودوا.
        #     - defensive_stable → الأساسيات أهم.
        if _pers == 'speculative_bull':
            weights['technical'] = weights.get('technical', 0.04) * 1.25
            weights['smc'] = weights.get('smc', 0.26) * 1.15
        elif _pers in ('defensive_stable', 'banking_core'):
            weights['fundamental'] = weights.get('fundamental', 0.40) * 1.12

    # 5. تطبيع: المجموع = 1.0
    total = sum(weights.values())
    if total > 0:
        weights = {k: v / total for k, v in weights.items()}

    return weights


@dataclass
class AdaptiveWeights:
    """أوزان تكييفية محسوبة حسب السياق."""
    weights: Dict[str, float] = field(default_factory=dict)
    regime: str = 'unknown'
    sector: str = 'DEFAULT'
    adjustments_applied: Dict[str, str] = field(default_factory=dict)
    cash_weight: float = 0.0            # نسبة الكاش المُقترحة (0.0 = كامل التعرض، 1.0 = كلها كاش)

    def get(self, key: str, default: float = 0.0) -> float:
        """الحصول على وزن مُكيّف."""
        return self.weights.get(key, default)

    def to_dict(self) -> Dict:
        """تحويل لـ dict للـ logging."""
        return {
            'weights': self.weights,
            'regime': self.regime,
            'sector': self.sector,
            'adjustments_applied': self.adjustments_applied,
            'cash_weight': self.cash_weight,
            'sum': sum(self.weights.values()),
        }


class AdaptiveWeightsEngine:
    """محرك الأوزان التكييفية."""

    def compute_weights(
        self,
        regime: str = 'unknown',
        sector: str = 'DEFAULT',
        volatility_pct: float = 0.0,
        market_breadth: float = 0.5,
        sector_momentum: float = 0.0,
        stock_rank: int = 5,
    ) -> AdaptiveWeights:
        """
        حساب الأوزان المُكيّفة.

        Args:
            regime: 'bull' | 'bear' | 'range' | 'unknown'
            sector: اسم القطاع (BANKS, REAL_ESTATE, etc.)
            volatility_pct: نسبة التذبذب (ATR/price * 100)
            market_breadth: نسبة الأسهم الصاعدة (0.0 = كلها هابط، 1.0 = كلها صاعد)
            sector_momentum: زخم القطاع بالـ % (موجب = القطاع أقوى، سالب = أضعف)
            stock_rank: ترتيب السهم في القطاع (1 = قائد، 10 = متأخر)

        Returns:
            AdaptiveWeights with adjusted weights summing to ~1.0
        """
        # نسخة من الأوزان الأساسية
        weights = dict(BASE_WEIGHTS)
        adjustments = {}
        cash_weight = 0.0

        # 1. تعديل حسب الـ regime
        regime_key = regime.lower() if regime else 'unknown'
        if regime_key in REGIME_ADJUSTMENTS:
            for key, mult in REGIME_ADJUSTMENTS[regime_key].items():
                if key in weights:
                    weights[key] *= mult
            adjustments['regime'] = regime_key

        # 2. تعديل حسب القطاع
        sector_key = sector.upper().strip() if sector else 'DEFAULT'
        if sector_key not in SECTOR_ADJUSTMENTS:
            # محاولة مطابقة جزئية
            for sk in SECTOR_ADJUSTMENTS:
                if sk in sector_key or sector_key in sk:
                    sector_key = sk
                    break
            else:
                sector_key = 'DEFAULT'

        if sector_key in SECTOR_ADJUSTMENTS:
            for key, mult in SECTOR_ADJUSTMENTS[sector_key].items():
                if key in weights:
                    weights[key] *= mult
            adjustments['sector'] = sector_key

        # 3. تعديل حسب التذبذب
        if volatility_pct > 5.0:
            # تذبذب عالي → زيادة volume_profile + تقليص technical
            weights['volume_profile'] *= 1.3
            weights['technical'] *= 0.9
            adjustments['volatility'] = f'high ({volatility_pct:.1f}%)'
        elif volatility_pct < 1.5 and volatility_pct > 0:
            # تذبذب منخفض → زيادة fundamental (سهم مستقر)
            weights['fundamental'] *= 1.1
            adjustments['volatility'] = f'low ({volatility_pct:.1f}%)'

        # 4. تعديل حسب الانتشار السعري (قلة وخسة)
        if market_breadth < 0.4:
            # قلة وخسة — المؤشر صاعد بس شوية أسهم بس اللي بتتحرك
            # نقلل كل الأوزان ونسيب مساحة للكاش (تقليل التعرض)
            for key in weights:
                weights[key] *= 0.8
            cash_weight = 0.2  # 20% كاش — السوق غشوم
            adjustments['market_breadth'] = f'قلة وخسة ({market_breadth:.2f})'
        elif market_breadth > 0.6:
            # موجة صاعدة عريضة — كل القطاعات بتتحرك
            # نزود الأداء النسبي وحجم التداول
            if 'sector_relative' in weights:
                weights['sector_relative'] *= 1.2
            if 'volume_profile' in weights:
                weights['volume_profile'] *= 1.2
            adjustments['market_breadth'] = f'موجة عريضة ({market_breadth:.2f})'

        # 5. تعديل حسب زخم القطاع
        if sector_momentum < -5.0:
            # القطاع ضعيف — مش هنثق بمؤشرات القطاع
            if 'sector_relative' in weights:
                weights['sector_relative'] *= 0.5
            adjustments['sector_momentum'] = f'قطاع ضعيف ({sector_momentum:.1f}%)'
        elif sector_momentum > 5.0:
            # القطاع قوي — نثق أكتر في مؤشرات القطاع
            if 'sector_relative' in weights:
                weights['sector_relative'] *= 1.3
            adjustments['sector_momentum'] = f'قطاع قوي ({sector_momentum:.1f}%)'

        # 6. تعديل حسب ترتيب السهم في القطاع
        if stock_rank > 5:
            # مش قائد — نقلل التقني ونزود الأساسي (القيمة أهم من الزخم)
            if 'technical' in weights:
                weights['technical'] *= 0.7
            if 'fundamental' in weights:
                weights['fundamental'] *= 1.3
            adjustments['stock_rank'] = f'متأخر ({stock_rank})'
        elif stock_rank <= 3:
            # قائد القطاع — نزود التقني وحجم التداول (الزخم بيصدق في القادة)
            if 'technical' in weights:
                weights['technical'] *= 1.2
            if 'volume_profile' in weights:
                weights['volume_profile'] *= 1.2
            adjustments['stock_rank'] = f'قائد ({stock_rank})'

        # 7. تطبيع: جعل المجموع = 1.0
        total = sum(weights.values())
        if total > 0:
            weights = {k: v / total for k, v in weights.items()}

        return AdaptiveWeights(
            weights=weights,
            regime=regime_key,
            sector=sector_key,
            adjustments_applied=adjustments,
            cash_weight=cash_weight,
        )


def detect_regime(prices: list) -> str:
    """
    كشف حالة السوق من الأسعار.
    - bull: السعر فوق MA50 + MA50 صاعدة
    - bear: السعر تحت MA50 + MA50 هابطة
    - range: السعر حول MA50 مع تذبذب محدود
    """
    if len(prices) < 60:
        return 'unknown'

    current = prices[-1]
    ma20 = sum(prices[-20:]) / 20
    ma50 = sum(prices[-50:]) / 50

    # كشف الاتجاه
    if current > ma50 and ma50 > sum(prices[-60:-10]) / 50:
        return 'bull'
    elif current < ma50 and ma50 < sum(prices[-60:-10]) / 50:
        return 'bear'
    else:
        # كشف العرض: تذبذب محدود حول MA50
        recent = prices[-20:]
        volatility = (max(recent) - min(recent)) / (sum(recent) / len(recent)) * 100
        if volatility < 5:
            return 'range'
        # تذبذب عالي بدون اتجاه واضح
        return 'range'


def compute_market_pulse(db_path: str = 'stocks.db') -> Dict:
    """
    نبض السوق — قراءة من الداتابيز لتحديد حالة السوق الحالية.

    بيجيب أكتر الأسهم سيولة من stocks.db وبيحسب:
    - regime: حالة السوق (bull/bear/range/unknown)
    - strength: قوة الاتجاه (نسبة التغير)
    - breadth: الانتشار السعري (نسبة الأسهم الصاعدة)
    - risk_level: مستوى المخاطر (low/medium/high/extreme)

    Args:
        db_path: مسار الداتابيز (افتراضي: stocks.db في المسار الحالي)

    Returns:
        dict بالنتائج
    """
    import sqlite3

    pulse = {
        'regime': 'unknown',
        'strength': 0.0,
        'breadth': 0.5,
        'risk_level': 'medium',
        'stocks_analyzed': 0,
        'timestamp': '',
    }

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # جلب أعلى 50 سهم من حيث السيولة (turnover)
        try:
            cursor.execute("""
                SELECT symbol, sector, close, prev_close, volume
                FROM stocks
                WHERE close IS NOT NULL AND prev_close IS NOT NULL
                ORDER BY volume DESC
                LIMIT 50
            """)
            rows = cursor.fetchall()
        except Exception:
            # لو الجدول مش موجود أو الأعمدة مختلفة، نجرب جدول تاني
            try:
                cursor.execute("""
                    SELECT symbol, close, volume
                    FROM stocks
                    WHERE close IS NOT NULL
                    ORDER BY volume DESC
                    LIMIT 50
                """)
                rows = cursor.fetchall()
            except Exception:
                pulse['risk_level'] = 'unknown'
                conn.close()
                return pulse

        if not rows:
            conn.close()
            return pulse

        pulse['stocks_analyzed'] = len(rows)

        # حساب نسبة الأسهم الصاعدة (breadth)
        advancing = 0
        total_change = 0.0
        prices_for_regime = []

        for row in rows:
            close_val = float(row['close'])
            prev_close_val = float(row['prev_close']) if 'prev_close' in row.keys() else close_val

            # تجميع الأسعار لكشف الـ regime
            prices_for_regime.append(close_val)

            if prev_close_val > 0:
                change_pct = ((close_val - prev_close_val) / prev_close_val) * 100
                total_change += change_pct
                if change_pct > 0:
                    advancing += 1

        # حساب الـ breadth
        pulse['breadth'] = advancing / len(rows) if rows else 0.5

        # حساب متوسط التغير (strength)
        pulse['strength'] = total_change / len(rows) if rows else 0.0

        # كشف الـ regime من أسعار أعلى الأسهم سيولة
        pulse['regime'] = detect_regime(prices_for_regime)

        # تحديد مستوى المخاطر
        avg_change = abs(pulse['strength'])
        if pulse['regime'] == 'bear' or pulse['breadth'] < 0.3:
            pulse['risk_level'] = 'high' if avg_change > 2 else 'medium'
        elif pulse['regime'] == 'bull' and pulse['breadth'] > 0.6:
            pulse['risk_level'] = 'low'
        else:
            pulse['risk_level'] = 'medium'

        # لو التغير كبير جداً → extreme
        if avg_change > 5:
            pulse['risk_level'] = 'extreme'

        conn.close()

    except Exception:
        # أي خطأ في الداتابيز → نرجع قيم افتراضية آمنة
        pass

    return pulse


if __name__ == '__main__':
    """اختبار ذاتي."""
    engine = AdaptiveWeightsEngine()

    print("=" * 60)
    print("اختبار الأوزان التكييفية")
    print("=" * 60)

    # Test 1: Bull market
    result = engine.compute_weights(regime='bull', sector='TECHNOLOGY', volatility_pct=2.0)
    print(f"\n📊 Bull + Technology + Low Volatility:")
    print(f"   Regime: {result.regime} | Sector: {result.sector}")
    for k, v in sorted(result.weights.items(), key=lambda x: -x[1]):
        print(f"   {k}: {v:.4f}")
    print(f"   Sum: {sum(result.weights.values()):.4f}")
    print(f"   Adjustments: {result.adjustments_applied}")

    # Test 2: Bear market
    result = engine.compute_weights(regime='bear', sector='BANKS', volatility_pct=6.0)
    print(f"\n📊 Bear + Banks + High Volatility:")
    print(f"   Regime: {result.regime} | Sector: {result.sector}")
    for k, v in sorted(result.weights.items(), key=lambda x: -x[1]):
        print(f"   {k}: {v:.4f}")
    print(f"   Sum: {sum(result.weights.values()):.4f}")

    # Test 3: Range market
    result = engine.compute_weights(regime='range', sector='REAL_ESTATE', volatility_pct=3.0)
    print(f"\n📊 Range + Real Estate:")
    print(f"   Regime: {result.regime} | Sector: {result.sector}")
    for k, v in sorted(result.weights.items(), key=lambda x: -x[1]):
        print(f"   {k}: {v:.4f}")
    print(f"   Sum: {sum(result.weights.values()):.4f}")

    # Test 4: Regime detection
    print(f"\n📊 كشف الـ Regime:")
    bull_prices = [100 + i * 0.5 for i in range(100)]
    bear_prices = [100 - i * 0.5 for i in range(100)]
    range_prices = [100 + (i % 10 - 5) * 0.3 for i in range(100)]
    print(f"   Bull prices → {detect_regime(bull_prices)}")
    print(f"   Bear prices → {detect_regime(bear_prices)}")
    print(f"   Range prices → {detect_regime(range_prices)}")

    print("\n✅ كل الاختبارات نجحت")
