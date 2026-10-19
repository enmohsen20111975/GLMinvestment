"""
Core Scoring Engine
===================
محرك التسجيل الموحد

هذا هو القلب النابض للنظام الجديد.
يستقبل بيانات السهم + MarketProfile + PersonaProfile
ويعطي نتيجة موحدة UnifiedSignalResult

الميزات:
1. نظام أوزان مرن حسب السوق
2. إصلاحات Kimi مدمجة (RSI Override + R/R Validation)
3. ATR Stop Loss ديناميكي
4. يدعم كل الأسواق بنفس المحرك

@authorM2yDevelopers Team
@version 2.0.0
"""

import sys
import os
import math
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.unified_config import (
    UnifiedConfig, MarketProfile, PersonaProfile,
    UnifiedSignalResult, StopLossMethod,
    TradingStrategy, translate_signal,
    get_unified_config, MARKET_PROFILES
)

# AXIS-5: Rocket Hunter — configurable score boost via admin settings
from analyzers.engine_settings import get_setting

# ============================================================================
# CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
# قبل كده: كان فيه `def calc_rsi` محلي بحساب Wilder's صحيح لكنه duplicate.
# الحل: re-export canonical من analyzers.indicators.rsi — callers بـ تستخدم
# `from analyzers.core_scoring_engine import calc_rsi` أو `core_scoring_engine.calc_rsi`
# بدون أي تغيير في الـ API. يرجع None لو البيانات غير كافية (per Rule 24).
# ============================================================================
from analyzers.indicators.rsi import calc_rsi
from analyzers.indicators.ma import macd as _canonical_macd_cse, sma as _canonical_sma_cse  # BRAVO INDICATOR-UNIFY  # noqa: F401 — re-exported for backward compat


# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================


def calc_macd(closes: List[float]) -> Tuple[float, float, str]:
    """MACD — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.macd.
    Returns: (macd_value, signal_value, direction)
    """
    if len(closes) < 35:  # 26 + 9
        return 0.0, 0.0, "neutral"
    result = _canonical_macd_cse(closes)
    if result is None:
        return 0.0, 0.0, "neutral"
    macd_val = result.get('line', 0.0)
    signal_val = result.get('signal', 0.0)
    if macd_val > signal_val and macd_val > 0:
        direction = "bullish"
    elif macd_val < signal_val and macd_val < 0:
        direction = "bearish"
    else:
        direction = "neutral"
    return macd_val, signal_val, direction

def calc_sma(data: List[float], period: int) -> float:
    """SMA — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma."""
    val = _canonical_sma_cse(data, period)
    return val if val is not None else 50.0

def calc_atr(highs: List[float], lows: List[float], closes: List[float],
             period: int = 14) -> float:
    """حساب ATR (Average True Range) — Rule 54: بندوّد لـ analyzers.indicators.canonical (Wilder's)."""
    # Rule 54: استخدم canonical (Wilder's) بدل SMA
    try:
        from analyzers.indicators import calc_atr as _canonical_atr
        result = _canonical_atr(highs, lows, closes, period)
        # احتفظ بنفس الـ fallback (3% من آخر close) لو البيانات غير كافية
        if result is not None:
            return result
        return closes[-1] * 0.03 if closes else 0
    except Exception:
        # fallback آمن لو canonical مش متاح
        if len(closes) < period + 1:
            return closes[-1] * 0.03 if closes else 0
        trs = []
        for i in range(1, len(closes)):
            if i < len(highs) and i < len(lows):
                tr = max(
                    highs[i] - lows[i],
                    abs(highs[i] - closes[i - 1]),
                    abs(lows[i] - closes[i - 1])
                )
            else:
                tr = abs(closes[i] - closes[i - 1])
            trs.append(tr)
        return sum(trs[-period:]) / period if len(trs) >= period else sum(trs) / len(trs)


def calc_bollinger(closes: List[float], period: int = 20) -> Tuple[float, float, float]:
    """حساب Bollinger Bands → (upper, middle, lower)"""
    if len(closes) < period:
        mid = closes[-1]
        return mid * 1.02, mid, mid * 0.98

    recent = closes[-period:]
    mid = sum(recent) / period
    std = math.sqrt(sum((x - mid) ** 2 for x in recent) / period)
    return round(mid + 2 * std, 4), round(mid, 4), round(mid - 2 * std, 4)


def detect_candlestick_pattern(
    opens: List[float], highs: List[float],
    lows: List[float], closes: List[float]
) -> Tuple[str, int]:
    """
    كشف أبرز نماذج الشموع → (pattern_name, score -100 to +100)
    موجب = صاعد، سالب = هابط
    """
    if len(closes) < 3:
        return "none", 0

    # آخر 3 شموع
    o, h, l, c = opens[-1], highs[-1], lows[-1], closes[-1]
    body = abs(c - o)
    candle_range = h - l if h > l else 1

    # Doji (تردد)
    if body < candle_range * 0.1:
        return "doji", 0

    # Hammer / Inverted Hammer (صاعد)
    lower_shadow = min(o, c) - l
    upper_shadow = h - max(o, c)
    if lower_shadow > body * 2 and upper_shadow < body * 0.5 and c > o:
        return "hammer", 40

    # Shooting Star (هابط)
    if upper_shadow > body * 2 and lower_shadow < body * 0.5 and c < o:
        return "shooting_star", -40

    # Bullish Engulfing (صاعد قوي)
    if len(closes) >= 2:
        prev_o, prev_c = opens[-2], closes[-2]
        if prev_c < prev_o and c > o and o < prev_c and c > prev_o:
            return "bullish_engulfing", 60

        # Bearish Engulfing (هابط قوي)
        if prev_c > prev_o and c < o and o > prev_c and c < prev_o:
            return "bearish_engulfing", -60

    # Morning Star (صاعد)
    if len(closes) >= 3:
        if (closes[-3] < opens[-3] and  # شمعة هابطة
                abs(closes[-2] - opens[-2]) < candle_range * 0.3 and  # doji أو صغيرة
                closes[-1] > opens[-1] and  # شمعة صاعدة
                closes[-1] > (opens[-3] + closes[-3]) / 2):
            return "morning_star", 70

    # Strong bullish or bearish
    if c > o and body > candle_range * 0.7:
        return "strong_bullish", 35
    if c < o and body > candle_range * 0.7:
        return "strong_bearish", -35

    return "none", 0


# ============================================================================
# SCORE CALCULATORS
# ============================================================================

class TechnicalScorer:
    """تسجيل المؤشرات التقنية (0-100)"""

    @staticmethod
    def score(price_data: dict, market: MarketProfile) -> Tuple[float, dict]:
        """
        Returns: (score 0-100, details dict)
        """
        closes = price_data.get("closes", [])
        highs  = price_data.get("highs", [])
        lows   = price_data.get("lows", [])

        if len(closes) < 14:
            # REAL DATA ONLY — no placeholder 50.0 (per owner directive + Rule 24).
            # Return None to signal "insufficient data" — caller must handle.
            return None, {"error": "بيانات غير كافية — no placeholder per Rule 24"}

        score = 50.0  # نقطة البداية (neutral midpoint of 0-100 — NOT a placeholder)
        details = {}

        # ─── RSI ───────────────────────────────────────────────────────────
        # FIX-1 Step 4: calc_rsi now returns None when insufficient data
        # (per owner directive + Rule 24). Guard with `is not None` so we skip
        # RSI scoring entirely when no data — score stays at 50 baseline.
        rsi = calc_rsi(closes)
        details["rsi"] = rsi

        if rsi is not None:
            if rsi <= market.rsi_extreme_low:     # 20- → شراء قوي
                score += 20
            elif rsi <= market.rsi_oversold:      # 20-30 → شراء
                score += 12
            elif rsi <= 50:                        # 30-50 → محايد-إيجابي
                score += 4
            elif rsi <= 60:                        # 50-60 → محايد
                score -= 2
            elif rsi < market.rsi_overbought:     # 60-70 → تحذير
                score -= 8
            elif rsi < market.rsi_extreme_high:   # 70-85 → تشبع شرائي
                score -= 15
            else:                                  # 85+ → تشبع قصوي
                score -= 25

        # ─── MACD ──────────────────────────────────────────────────────────
        if len(closes) >= 26:
            _, _, macd_dir = calc_macd(closes)
            details["macd"] = macd_dir
            if macd_dir == "bullish":
                score += 10
            elif macd_dir == "bearish":
                score -= 10

        # ─── Moving Averages ───────────────────────────────────────────────
        current = closes[-1]
        ma20  = calc_sma(closes, 20)
        ma50  = calc_sma(closes, 50)
        ma200 = calc_sma(closes, 200) if len(closes) >= 200 else None

        details["ma20"]  = round(ma20, 4)
        details["ma50"]  = round(ma50, 4)
        details["current"] = round(current, 4)

        above_20  = current > ma20
        above_50  = current > ma50
        above_200 = (current > ma200) if ma200 else True

        if above_20 and above_50 and above_200:
            score += 12   # فوق كل المتوسطات = قوي
            details["ma_signal"] = "above_all"
        elif above_20 and above_50:
            score += 7
            details["ma_signal"] = "above_20_50"
        elif not above_20 and not above_50:
            score -= 10
            details["ma_signal"] = "below_all"
        else:
            details["ma_signal"] = "mixed"

        # ─── Bollinger ─────────────────────────────────────────────────────
        bb_upper, bb_mid, bb_lower = calc_bollinger(closes)
        details["bb_upper"] = round(bb_upper, 4)
        details["bb_lower"] = round(bb_lower, 4)

        if current < bb_lower:
            score += 8    # تحت النطاق السفلي = فرصة
            details["bb_signal"] = "below_lower"
        elif current > bb_upper:
            score -= 8    # فوق النطاق العلوي = تشبع
            details["bb_signal"] = "above_upper"
        else:
            details["bb_signal"] = "inside"

        return (round(min(100, max(0, score)), 2), details)


class VolumeScorer:
    """تسجيل الحجم والسيولة (0-100)"""

    @staticmethod
    def score(price_data: dict, market: MarketProfile) -> Tuple[float, dict]:
        volumes = price_data.get("volumes", [])
        current_volume = price_data.get("current_volume", 0)

        if not volumes or len(volumes) < 5:
            return 50.0, {"volume_data": "غير متاح"}

        avg_volume = sum(volumes[-20:]) / min(20, len(volumes))
        details = {
            "current_volume": current_volume or (volumes[-1] if volumes else 0),
            "avg_volume_20": round(avg_volume),
            "min_required": market.min_volume_filter,
        }

        vol = current_volume or (volumes[-1] if volumes else 0)
        score = 50.0

        # مقارنة بالمتوسط
        if avg_volume > 0:
            ratio = vol / avg_volume
            details["volume_ratio"] = round(ratio, 2)

            if ratio >= 3.0:
                score += 30   # حجم 3× المتوسط = إشارة قوية
            elif ratio >= 2.0:
                score += 20
            elif ratio >= 1.5:
                score += 12
            elif ratio >= 1.0:
                score += 5
            elif ratio >= 0.7:
                score -= 5
            else:
                score -= 15   # حجم منخفض = إشارة ضعيفة

        # فلتر الحد الأدنى
        if vol < market.min_volume_filter:
            score -= 20
            details["below_min_volume"] = True

        return (round(min(100, max(0, score)), 2), details)


class CandlestickScorer:
    """تسجيل نماذج الشموع (0-100)"""

    @staticmethod
    def score(price_data: dict) -> Tuple[float, dict]:
        opens  = price_data.get("opens", [])
        highs  = price_data.get("highs", [])
        lows   = price_data.get("lows", [])
        closes = price_data.get("closes", [])

        if len(closes) < 3:
            return 50.0, {"pattern": "غير كافٍ"}

        pattern, pattern_score = detect_candlestick_pattern(opens, highs, lows, closes)

        # تحويل النقاط من (-100/+100) إلى (0/100)
        normalized = 50 + (pattern_score / 2)
        details = {
            "pattern": pattern,
            "pattern_score_raw": pattern_score,
            "direction": "bullish" if pattern_score > 0 else "bearish" if pattern_score < 0 else "neutral",
        }

        return (round(min(100, max(0, normalized)), 2), details)


class FundamentalScorer:
    """تسجيل الأساسيات (0-100)"""

    @staticmethod
    def score(price_data: dict) -> Tuple[float, dict]:
        """
        بيانات أساسية اختيارية
        لو ما فيش → 50 محايد
        """
        fundamental = price_data.get("fundamental", {})
        if not fundamental:
            return 50.0, {"fundamental_data": "غير متاح - استخدم 50 محايد"}

        score = 50.0
        details = {}

        # P/E Ratio
        pe = fundamental.get("pe_ratio")
        if pe and pe > 0:
            if pe < 10:
                score += 15  # رخيص جداً
            elif pe < 15:
                score += 10
            elif pe < 20:
                score += 5
            elif pe < 30:
                score -= 5
            else:
                score -= 10  # غالٍ جداً
            details["pe_ratio"] = pe

        # EPS Growth
        eps_growth = fundamental.get("eps_growth_pct")
        if eps_growth:
            if eps_growth > 20:
                score += 15
            elif eps_growth > 10:
                score += 8
            elif eps_growth > 0:
                score += 3
            else:
                score -= 10
            details["eps_growth"] = eps_growth

        # Debt/Equity
        de = fundamental.get("debt_equity")
        if de is not None:
            if de < 0.3:
                score += 5
            elif de > 2:
                score -= 10
            details["debt_equity"] = de

        return (round(min(100, max(0, score)), 2), details)


# ============================================================================
# STOP LOSS & TARGET CALCULATOR
# ============================================================================

class RiskCalculator:
    """حساب وقف الخسارة والهدف"""

    def calculate(
        self,
        entry_price: float,
        price_data: dict,
        config: UnifiedConfig,
        support: float = None,
        resistance: float = None,
        momentum_mode: bool = False,
    ) -> dict:
        """
        حساب وقف الخسارة والهدف بناءً على:
        - طريقة السوق (ATR / Support / Fixed)
        - تعديلات الشخصية
        - momentum_mode: وقف متحرك أوسع للأسهم اللي بتتجمع (منع فخ الوقف الضيق)
        """
        closes = price_data.get("closes", [])
        highs  = price_data.get("highs", [])
        lows   = price_data.get("lows", [])
        mp     = config.market_profile
        pp     = config.persona_profile

        if entry_price <= 0:
            return {"error": "سعر دخول غير صالح"}

        # ─── حساب ATR ────────────────────────────────────────────────────
        atr = calc_atr(highs, lows, closes)
        atr_pct = (atr / entry_price) * 100 if entry_price > 0 else 3.0

        # ─── حساب وقف الخسارة ────────────────────────────────────────────
        method = config.stop_method
        atr_mult = config.stop_atr_mult

        if method == StopLossMethod.ATR:
            raw_stop_pct = atr_pct * atr_mult
        elif method == StopLossMethod.SUPPORT and support and support > 0:
            support_dist = ((entry_price - support) / entry_price) * 100
            raw_stop_pct = support_dist + 0.5  # تحت الدعم بـ 0.5%
        elif method == StopLossMethod.COMBINED:
            atr_stop = atr_pct * atr_mult
            if support and support > 0:
                sup_stop = ((entry_price - support) / entry_price) * 100 + 0.5
                raw_stop_pct = min(atr_stop, sup_stop)  # الأضيق
            else:
                raw_stop_pct = atr_stop
        else:  # FIXED
            raw_stop_pct = mp.stop_fixed_pct

        # قيود ديناميكية بالكامل بناءً على حركة السهم والـ ATR بدلاً من النسب الثابتة
        # Floor stop at 0.75x ATR to avoid daily noise, cap at 15% or 3x ATR
        min_stop_limit = max(0.3, atr_pct * 0.75) if atr_pct > 0 else 0.5
        max_stop_limit = max(15.0, atr_pct * 3.0) if atr_pct > 0 else 15.0
        
        stop_pct = max(min_stop_limit, min(max_stop_limit, raw_stop_pct))
        stop_price = round(entry_price * (1 - stop_pct / 100), 4)

        # ─── حساب الهدف ──────────────────────────────────────────────────
        target_rr = config.target_rr_mult
        raw_target_pct = stop_pct * target_rr

        # استخدام المقاومة إن وجدت
        if resistance and resistance > entry_price:
            resist_pct = ((resistance - entry_price) / entry_price) * 100
            if resist_pct > raw_target_pct:
                raw_target_pct = min(resist_pct, stop_pct * 3)

        min_target_limit = max(0.5, atr_pct * 1.0) if atr_pct > 0 else 1.5
        max_target_limit = max(40.0, atr_pct * 6.0) if atr_pct > 0 else 30.0

        target_pct = max(min_target_limit, min(max_target_limit, raw_target_pct))
        target_price = round(entry_price * (1 + target_pct / 100), 4)

        # هدف ثانٍ (1.5× الأول)
        target_2_pct = target_pct * 1.5
        target_2_price = round(entry_price * (1 + target_2_pct / 100), 4)

        # ─── R/R الفعلي ──────────────────────────────────────────────────
        risk   = entry_price - stop_price
        reward = target_price - entry_price
        rr     = round(reward / risk, 2) if risk > 0 else 0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            rr = compute_risk_reward(entry_price, target_price, stop_price, fallback=rr)
        except Exception:
            pass  # keep inline rr computed above

        # ─── وضع Momentum Accumulation: وقف متحرك أوسع ────────────────
        # منع فخ الوقف الضيق (-8% على سهم زي ELKA = فخ).
        # الوقف تحت آخر قاع بـ 1% + ATR، ويتحرك لفوق بس.
        trailing_stop = None
        method_used_final = method.value
        if momentum_mode:
            recent_lows = lows[-15:] if (lows and len(lows) >= 15) else []
            # Task FINALIZE-UNIFICATION (Rule 27): لا fabrication — لو مفيش recent_lows
            # بيانات كافية، swing_low = None (لا حساب trailing stop وهمي).
            # كان: swing_low = min(recent_lows) if recent_lows else entry_price * 0.95
            swing_low = min(recent_lows) if recent_lows else None
            if swing_low is None:
                # لا بيانات كافية لـ trailing momentum — skip هذا الـ mode
                method_used_final = "INSUFFICIENT_DATA"
                trailing_stop = None
            else:
                trail_pct = ((entry_price - swing_low) / entry_price) * 100 + 1.0
                trail_pct = max(min_stop_limit, min(max_stop_limit, trail_pct))
                stop_price = round(entry_price * (1 - trail_pct / 100), 4)
                trailing_stop = stop_price
                method_used_final = "TRAILING_MOMENTUM"
                # إعادة حساب المخاطرة/العائد بعد الوقف الأوسع
                risk = entry_price - stop_price
                reward = target_price - entry_price
                rr = round(reward / risk, 2) if risk > 0 else 0
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    rr = compute_risk_reward(entry_price, target_price, stop_price, fallback=rr)
                except Exception:
                    pass  # keep inline rr computed above

        return {
            "stop_loss":       stop_price if momentum_mode and 'stop_price' in dir() else (stop_price if not momentum_mode else None),
            "stop_loss_pct":   round(stop_pct if not momentum_mode else (((entry_price - stop_price) / entry_price * 100) if ('stop_price' in dir() and stop_price) else 0.0), 2),
            "target_1":        target_price,
            "target_1_pct":    round(target_pct, 2),
            "target_2":        target_2_price,
            "target_2_pct":    round(target_2_pct, 2),
            "risk_reward":     rr if ('rr' in dir()) else 0.0,
            "atr":             round(atr, 4),
            "atr_pct":         round(atr_pct, 2),
            "method_used":     method_used_final,
            "stop_valid":      bool(stop_price and stop_price < entry_price) if momentum_mode else (stop_price < entry_price),
            "rr_valid":        (rr if ('rr' in dir()) else 0.0) >= config.min_rr,
            "trailing_stop":   trailing_stop,
        }


# ============================================================================
# P24-ADAPTIVE-RR (Aug 2026): Adaptive Risk/Reward & Stop multipliers
# ============================================================================
# بدل ما تكون الـ Targets و Stops ثابتة (1.5R/3.0R)، بنحسبها ديناميكياً من:
#   - persona (المضارب يطمع أكتر، المحافظ يحافظ)
#   - regime (في الصاعد نوسّع الأهداف، في الهابط نقفل الأهداف)
#   - volatility_percentile (تذبذب عالي → أهداف أكبر وأوقف أوسع)
#
# القاعدة (من البروتوكول): لو persona=gambler و volatility>80% → R/R = 2.2 / 4.5.
# ============================================================================

# جدول الـ (stop_mult, target_mult) حسب persona + volatility band.
# stop_mult و target_mult هما مضاعفات الـ ATR.
#
# V34-PERSONA-FIX (Aug 2026): تعديل الجدول عشان يحل مشكلة أداء personas المتذبذب.
# المشكلة السابقة: gambler كان target_mult=3.0-4.5 (بعيد جداً — نادراً ما يتحقق)
# و conservative كان target_mult=1.6-2.2 (قريب — ربح قليل بيوكل بأي خسارة).
# الحل: قربنا أهداف gambler + وسعنا أهداف conservative.
_ADAPTIVE_RR_TABLE = {
    # persona: { vol_band: (stop_atr_mult, target_atr_mult) }
    'gambler': {
        'extreme': (1.8, 2.5),   # كان (2.2, 4.5) — قللنا الاثنين عشان الخسارة والهدف يكونوا أقرب
        'high':    (1.6, 2.3),   # كان (2.0, 4.0)
        'normal':  (1.5, 2.0),   # كان (1.8, 3.5)
        'low':     (1.3, 1.8),   # كان (1.5, 3.0)
    },
    'active_trader': {
        'extreme': (1.7, 2.4),   # كان (2.0, 4.0)
        'high':    (1.6, 2.2),   # كان (1.8, 3.5)
        'normal':  (1.4, 2.0),   # كان (1.6, 3.0)
        'low':     (1.3, 1.8),   # كان (1.4, 2.8)
    },
    'balanced': {
        'extreme': (1.6, 2.6),   # كان (1.8, 3.0) — رفعنا target عشان r/R أحسن
        'high':    (1.5, 2.4),   # كان (1.6, 2.8)
        'normal':  (1.4, 2.2),   # كان (1.5, 2.5)
        'low':     (1.2, 2.0),   # كان (1.3, 2.2)
    },
    'conservative': {
        'extreme': (1.5, 2.8),   # كان (1.6, 2.2) — رفعنا target عشان ربح أكبر
        'high':    (1.4, 2.6),   # كان (1.5, 2.0)
        'normal':  (1.3, 2.4),   # كان (1.4, 1.8)
        'low':     (1.2, 2.2),   # كان (1.2, 1.6)
    },
    'investor': {
        'extreme': (1.5, 2.8),   # كان (1.6, 2.2)
        'high':    (1.4, 2.6),   # كان (1.5, 2.0)
        'normal':  (1.3, 2.4),   # كان (1.4, 1.8)
        'low':     (1.2, 2.2),   # كان (1.2, 1.6)
    },
}

# تعديل الـ regime على المضاعفات (نطبّق فوق الـ persona+vol)
_REGIME_RR_ADJUST = {
    'bull':        {'target': 1.15, 'stop': 1.0},   # صاعد → أهداف أوسع
    'strong_bull': {'target': 1.25, 'stop': 0.95},  # زخم قوي → طمع أكبر
    'range':       {'target': 1.0,  'stop': 1.0},
    'bear':        {'target': 0.85, 'stop': 1.1},   # هابط → أهداف أضيق، وقف أوسع
    'crash':       {'target': 0.7,  'stop': 1.25},
}


def adaptive_rr(ticker: str, atr: float, volatility_percentile: float,
                persona: str = 'balanced', regime: str = 'range',
                stock_profile: Dict = None) -> Dict[str, float]:
    """P24/P25-ADAPTIVE-RR: حساب مضاعفات الـ R/R الديناميكية.

    Args:
        ticker: رمز السهم.
        atr: قيمة ATR الحالية (مطلق، مش نسبة).
        volatility_percentile: 0-100 (percentile التذبذب، أو ATR/price*100).
        persona: gambler/active_trader/balanced/conservative/investor.
        regime: bull/strong_bull/range/bear/crash (يقبل bull_trend/bear_trend).
        stock_profile: (P25-LIVING-ENGINE) dict من stock_adaptive_profiles —
                       لو متاح، بنستخدم avg_atr_pct و typical_move_5d/15d
                       لحساب نسب الوقف/الهدف من النطاق الحقيقي للسهم بدل
                       تقدير ثابت. كمان بنعدّل حسب reaction_to_market_crashes:
                         - amplifier → وقف أوسع (السهم بيهدّ بقوة).
                         - defensive → وقف أضيق (السهم مستقر).

    Returns:
        dict: {
            'stop_atr_mult': float,   # مضاعف ATR للوقف
            'target_atr_mult': float, # مضاعف ATR للهدف
            'stop_pct': float,        # نسبة الوقف المقدّرة (من atr/price)
            'target_pct': float,      # نسبة الهدف المقدّرة
            'rr_ratio': float,        # target_mult / stop_mult
            'vol_band': str,          # extreme/high/normal/low
            'method': 'adaptive_rr',
        }
    """
    _persona = (persona or 'balanced').lower().strip()
    if _persona not in _ADAPTIVE_RR_TABLE:
        _persona = 'balanced'

    # تصنيف التذبذب
    try:
        _vp = float(volatility_percentile)
    except (TypeError, ValueError):
        _vp = 30.0
    if _vp > 80.0:
        _vol_band = 'extreme'
    elif _vp > 50.0:
        _vol_band = 'high'
    elif _vp > 15.0:
        _vol_band = 'normal'
    else:
        _vol_band = 'low'

    stop_mult, target_mult = _ADAPTIVE_RR_TABLE[_persona][_vol_band]

    # تعديل الـ regime
    _reg = str(regime or 'range').lower().strip()
    _regime_map = {
        'bull_trend': 'bull', 'strong_bull': 'strong_bull', 'momentum': 'strong_bull',
        'bear_trend': 'bear', 'ranging': 'range', 'sideways': 'range',
    }
    _reg_key = _regime_map.get(_reg, _reg)
    if _reg_key in _REGIME_RR_ADJUST:
        _adj = _REGIME_RR_ADJUST[_reg_key]
        target_mult *= _adj['target']
        stop_mult *= _adj['stop']

    # نسب مقدّرة من الـ ATR (لو atr متاح)
    try:
        _atr = float(atr) if atr and atr > 0 else 0.0
    except (TypeError, ValueError):
        _atr = 0.0
    # P25-LIVING-ENGINE: لو الـ stock_profile متاح وفيه avg_atr_pct، نستخدمه
    # كنسبة ATR/price حقيقية للسهم بدل تقدير ثابت (_est_price=100). ده بيخلّي
    # stop_pct/target_pct دقيقة لكل سهم (سهم بـ ATR 5% مش زي سهم بـ ATR 1%).
    _profile_atr_pct = 0.0
    _crash_class = ''
    if stock_profile and isinstance(stock_profile, dict):
        try:
            _profile_atr_pct = float(stock_profile.get('avg_atr_pct') or 0)
        except (TypeError, ValueError):
            _profile_atr_pct = 0.0
        try:
            _crash_class = str(stock_profile.get('reaction_to_market_crashes') or '').lower().strip()
        except Exception:
            _crash_class = ''

    if _atr > 0:
        # عندنا ATR مطلق — نحسب النسبة من الـ profile لو متاح (عشان price دقيق)،
        # иначе نستخدم تقدير volatility_percentile.
        if _profile_atr_pct > 0:
            _atr_pct = _profile_atr_pct
        else:
            _est_price = 100.0
            _atr_pct = (_atr / _est_price * 100.0)
    else:
        # fallback: تقدير من الـ volatility_percentile أو الـ profile
        _atr_pct = _profile_atr_pct if _profile_atr_pct > 0 else max(1.0, _vp / 10.0)

    # P25: تعديل الوقف حسب سلوك الأزمات:
    #   - amplifier → وقف أوسع (السهم بيهدّ بقوة، لازم وقف أوسع عشان ميتضربش بالـ wick)
    #   - defensive → وقف أضيق (السهم مستقر، الوقف الواسع بيضيّع فرص)
    _crash_stop_mult = 1.0
    if _crash_class == 'amplifier':
        _crash_stop_mult = 1.20
    elif _crash_class == 'defensive':
        _crash_stop_mult = 0.85
    elif _crash_class == 'resilient':
        _crash_stop_mult = 0.92

    stop_pct = stop_mult * _atr_pct * _crash_stop_mult
    target_pct = target_mult * _atr_pct

    rr_ratio = round(target_mult / stop_mult, 2) if stop_mult > 0 else 0.0

    return {
        'stop_atr_mult': round(stop_mult, 2),
        'target_atr_mult': round(target_mult, 2),
        'stop_pct': round(stop_pct, 2),
        'target_pct': round(target_pct, 2),
        'rr_ratio': rr_ratio,
        'vol_band': _vol_band,
        'method': 'adaptive_rr',
        'crash_class': _crash_class or 'unknown',
    }


# ============================================================================
# P26-PERSONA-SEPARATION (Aug 2026): Persona-specific target/stop overrides.
# ----------------------------------------------------------------------------
# المشكلة اللي بتحل: المضارب والمستثمر كانو بيطلعوا نفس الأرقام لأن الـ maestro
# بيحسب entry/target/stop موحّد لكل الشخصيات. ده بيخلي الـ persona مجرد "فلتر"
# على التوصية بس، من غير ما الأرقام نفسها تتغير.
#
# الحل: لما persona_type يكون محدّد (gambler/balanced/conservative)، نحسب
# target/stop كنسب مئوية ثابتة لكل persona — مختلفة جذرياً:
#   - gambler:      target +3%..+6%,  stop -2%..-3%   (أفق 1-5 أيام)
#   - balanced:     target +8%..+14%, stop -5%..-7%   (أفق 2-6 أسابيع)
#   - conservative: target +20%..+35%, stop -10%..-15% (أفق 6-12 شهر)
# النسبة المضبوطة جوه النطاق بتتحدد حسب التذبذب (volatility) — سهم متقلب
# أكتر → ناخد النهاية العليا للنطاق. ده بيضمن إن الأرقام تختلف تماماً بين
# المضارب والمستثمر من غير أي Fallback موحّد.
# ============================================================================

# النطاقات لكل persona: (target_min, target_max, stop_min, stop_max)
# كل القيم نسب مئوية (موجبة). target = مكسب صاعد، stop = خسارة هابطة.
_PERSONA_RR_BANDS = {
    'gambler':      (0.03, 0.06, 0.02, 0.03),   # مضارب: هدف سريع صغير، وقف ضيق
    'balanced':     (0.08, 0.14, 0.05, 0.07),   # متوازن: هدف وسطي، وقف وسطي
    'conservative': (0.20, 0.35, 0.10, 0.15),   # محافظ/مستثمر: هدف استثماري كبير، وقف عريض
}

# C4-DNA-RR (v3.67.0): مضاعفات DNA لكل persona — بتحل محل الـ bands الثابتة.
# لما stock_profile فيه typical_move_1d/5d/15d متاح، نستخدم مضاعفات الـ DNA دي.
# typical_move = متوسط الحركة النمطية للسهم (٪) — فالهدف = typical_move × multiplier.
#
# الفلسفة (مش أرقام ثابتة):
#   - gambler (مضارب): هدف أوسع نسبياً (1.5–3× حركة 1 يوم) — يتفرّج للصفقة تجري
#     (trailing مفتوح). وقف أوسع نسبياً (0.8–1.5×) — يتحمّل ضجيج intraday.
#   - balanced (متوازن): هدف وسط (1.2–2× حركة 5 أيام) — هدف هيكلي معتدل.
#     وقف وسط (0.6–1.0×) — توازن بين الحماية وإعطاء مساحة.
#   - conservative (مستثمر): هدف أصغر نسبياً (1.0–1.5× حركة 15 يوم) — هدف هيكلي
#     من قيمة عادلة / مقاومة أبعد. وقف أضيق نسبياً (0.4–0.7×) — حماية رأس المال.
#
# كل "أوسع/أضيق/وسط" = نسبة من typical_move لنفس السهم، مش نسبة ثابتة من سعر الدخول.
# ده بيخلّي المضارب والمستثمر يطلعوا أهداف/أوقاف مختلفة حتى لو نفس السهم.
_PERSONA_DNA_MULT = {
    'gambler':      {'t_min': 1.5, 't_max': 3.0, 's_min': 0.8, 's_max': 1.5},
    'balanced':     {'t_min': 1.2, 't_max': 2.0, 's_min': 0.6, 's_max': 1.0},
    'conservative': {'t_min': 1.0, 't_max': 1.5, 's_min': 0.4, 's_max': 0.7},
}

_PERSONA_HORIZON_AR = {
    'gambler': '1-5 أيام',
    'balanced': '2-6 أسابيع',
    'conservative': '6-12 شهر',
}


def compute_persona_rr_overrides(persona_type, entry_price, atr=0.0, vol_pct=0.0,
                                 stock_profile=None, volume_ratio=0.0, change_1w_pct=0.0,
                                 lesson_summary=None, change_1d_pct=0.0, is_breakout=False,
                                 structural_resistance=0.0,
                                 sector_status='neutral', market_regime='range',
                                 volume_dryup_confirmed=None):
    """P26-PERSONA-SEPARATION: حساب الهدف/الوقف كنسب مئوية حسب الـ persona.

    Args:
        persona_type: gambler/balanced/conservative/investor/active_trader.
            investor → يتعامل كـ conservative (نفس الأفق الاستثماري الطويل).
            active_trader → يتعامل كـ gambler.
        entry_price: سعر الدخول الحالي.
        atr: قيمة ATR المطلقة (اختياري — للسياق).
        vol_pct: نسبة التذبذب 0-100 (ATR/price*100 أو percentile).
        stock_profile: dict من stock_adaptive_profiles (اختياري) — لو متاح،
            نستخدم volatility_percentile_90d لتعديل النطاق.
        volume_ratio: نسبة حجم التداول الحالي للمتوسط (اختياري) — لو >= 2.0
            مع change_1w_pct >= 8.0 → نفعّل نطاقات الزخم الانفجاري (Uncapping).
        change_1w_pct: نسبة تغير الأسبوع (اختياري) — لو >= 8.0 مع volume_ratio >= 2.0
            → نفعّل نطاقات الزخم الانفجاري (Uncapping).
        lesson_summary: B3 (Closed-Loop) — ملخص دروس الشخصية من lesson_store.
            لو فيه STOP_TOO_TIGHT متكرر (≥2) → وسّع مسافة الوقف بنسبة محصورة
            (max +40%). لو فيه LATE_MOMENTUM متكرر → لا تغيير على الـ RR هنا
            (التعديل بيحصل في الـ gate، مش الـ RR).
        sector_status: 'hot' | 'dead' | 'neutral' — من compute_sector_heat_map.
            Phase 3: لو 'dead' → explosive_uncap مبيتفعلش (Sector Heat Veto).
        market_regime: 'bull' | 'bear' | 'bear_trend' | 'crash' | 'range' —
            من _macro_regime / market_regime_detector.
            Phase 3: لو 'bear'/'bear_trend'/'crash' → كل uncaps بتتعطل.

    Returns:
        dict فيه target/stop (أسعار مطلقة) + النسب + rr_ratio + persona + horizon +
            is_wash_trading (bool) + uncap_veto_reasons (list).
        أو None لو entry_price غير صالح.
    """
    _p = (persona_type or 'balanced').lower().strip()
    # تطبيع الأسماء البديلة (legacy aliases)
    if _p == 'investor':
        _p = 'conservative'
    elif _p == 'active_trader':
        _p = 'gambler'
    if _p not in _PERSONA_RR_BANDS:
        _p = 'balanced'

    # MOMENTUM-UNCAP (v3.63.0): فك حظر الأهداف عند الزخم الانفجاري.
    # لما السهم يثبت وجود حجم تداول انفجاري (Volume Ratio >= 2.0) + صعود أسبوعي >= 8%،
    # نلغي الـ Caps الافتراضية ونستخدم نطاقات أوسع:
    #   - gambler:      target +10%..+30%, stop -2%..-5%   (بدل +3%..+6%)
    #   - balanced:     target +20%..+50%, stop -5%..-10%   (بدل +8%..+14%)
    #   - conservative: target +30%..+80%, stop -10%..-15%  (بدل +20%..+35%)
    # ده بيخلّي الأسهم زي Galaxy (اللي بتعمل +200%) تفضل في الـ picks بدل ما تتباع
    # عند +6% وتتفرج على باقي الصعود.
    # 🔥 P0-v6 FIX #3 (MOMENTUM-UNCAP-THRESHOLD-LOWER):
    #    العتبة القديمة (vr≥2.0 AND chg_1w≥8%) كانت مستحيلة عملياً على EGX.
    #    أغلب الأسهم اللي بتعمل +50% بتبدأ بـ vr≈2.0 + chg_1d≈+4% (مش 8% أسبوعي).
    #    العتبة الجديدة متوافقة مع _mom_is_momentum في maestro (vr≥1.8 + chg_1d≥3%
    #    OR breakout) → أي سهم momentum هـ يـ uncapped وياخد target بناءً على
    #    المقاومة الهيكلية بدل ما يـ cap عند +6%.
    _is_momentum_explosion = False
    try:
        _vr = float(volume_ratio or 0.0)
        _c1w = float(change_1w_pct or 0.0)
        _c1d = float(change_1d_pct or 0.0)
        if (_vr >= 1.8 and (_c1d >= 3.0 or _c1w >= 5.0)) or is_breakout:
            _is_momentum_explosion = True
    except (TypeError, ValueError):
        _is_momentum_explosion = False

    # ═══════════════════════════════════════════════════════════════════
    # Phase 3: Veto guards for explosive_uncap (WIRING — no new engines)
    # ═══════════════════════════════════════════════════════════════════
    # Three independent guards that prevent explosive_uncap when conditions
    # warrant caution. Each guard sets a veto reason string if triggered.
    # These use EXISTING data (sector_status, market_regime, volume_ratio,
    # change_1d) — no new computations, just wiring.
    # ═══════════════════════════════════════════════════════════════════
    _uncap_veto_reasons = []
    _is_wash_trading = False

    # Guard 1: Sector Heat Veto — dead sector ⇒ no infinity target
    # Even if volume surges, a stock in a dead sector doesn't get explosive_uncap.
    _sector_st = (sector_status or 'neutral').lower().strip()
    if _sector_st == 'dead' and _is_momentum_explosion:
        _uncap_veto_reasons.append('sector_dead')
        _is_momentum_explosion = False

    # Guard 2: Wash Trading Guard — volume surge but price flat ⇒ manipulation
    # If volume_ratio >= 2.0 but change_1d < 1.0% → likely wash trading.
    # This sets is_wash_trading flag (used by UI/API) and prevents uncap.
    try:
        if _vr >= 2.0 and _c1d < 1.0:
            _is_wash_trading = True
            if _is_momentum_explosion:
                _uncap_veto_reasons.append('wash_trading')
                _is_momentum_explosion = False
    except (TypeError, ValueError):
        pass

    # Guard 3: Market Breadth Guard — bear market ⇒ disable all uncaps
    # In a bear market, momentum_uncap and explosive_uncap are fully disabled.
    # Targets revert to conservative persona bands.
    _mkt_reg = (market_regime or 'range').lower().strip()
    if _mkt_reg in ('bear', 'bear_trend', 'crash') and _is_momentum_explosion:
        _uncap_veto_reasons.append('bear_market')
        _is_momentum_explosion = False

    # Guard 4: Volume Dry-up Guard — فلسفة ليفرمور/أونيل
    # السهم اللي حجمه ما جفش قبل الاختراق ده اختراق وهمي (Fakeout).
    # لازم آخر 3 شموع (قبل الإشارة) يكون متوسط حجمها < 50% من avg_volume_20.
    # ده معناه إن المعروض انشف وصناع السوق خلصوا تجميع → الاختراق حقيقي.
    # volume_dryup_confirmed=True → الاختراق مأكد (حجم جف قبلها).
    # volume_dryup_confirmed=False →Fakeout (حجم عالي قبل الاخترار = توزيع).
    # volume_dryup_confirmed=None → مش متاح (fallback: سمح).
    if _is_momentum_explosion and volume_dryup_confirmed is False:
        _uncap_veto_reasons.append('no_volume_dryup')
        _is_momentum_explosion = False

    # V39.2 MOMENTUM-UNCAP: فك حظر الأهداف تماماً للأسهم الطائرة.
    # السهم الطاير زي TMGH/AALR اللي بيعمل 50-100% في أسبوع — مفيش ليه سقف.
    # الستوب المتحرك (Trailing) بس هو اللي بيخرجنا.
    # t_max = 2.0 يعني هدف حتى +200% — عملياً مفيش سقف.
    _MOMENTUM_RR_BANDS = {
        'gambler':      (0.10, 2.00, 0.02, 0.05),   # مضارب زخم: هدف مفتوح حتى +200%، وقف ضيق — الـ trailing يخرجنا
        'balanced':     (0.15, 2.00, 0.05, 0.10),   # متوازن زخم: هدف مفتوح حتى +200%، وقف وسطي
        'conservative': (0.20, 2.00, 0.10, 0.15),   # محافظ زخم: هدف مفتوح حتى +200%، وقف عريض
    }

    if _is_momentum_explosion and _p in _MOMENTUM_RR_BANDS:
        t_min, t_max, s_min, s_max = _MOMENTUM_RR_BANDS[_p]
        _use_dna = False  # زخم انفجاري → نطاقات أوسع (نلغي DNA scale)
    else:
        t_min, t_max, s_min, s_max = _PERSONA_RR_BANDS[_p]
        _use_dna = True   # الوضع العادي → جرّب DNA لو متاح

    # =====================================================================
    # C4-DNA-RR (v3.67.0): حساب الهدف/الوقف من typical_move النمطي للسهم.
    # ---------------------------------------------------------------------
    # قبل كده كان الكود بيستخدم bands ثابتة (0.03-0.06 للمضارب، 0.20-0.35 للمستثمر)
    # لكل الأسهم — ده كان بيخلّي المضارب والمستثمر يطلعوا نفس الأرقام على سهم
    # هادي، وأرقام غير منطقية على سهم متطاير. دلوقتي:
    #   - لو stock_profile فيه typical_move_1d/5d/15d → نستخدم مضاعفات DNA.
    #     * gambler:      target = typical_move_1d × [1.5, 3.0]
    #     * balanced:     target = typical_move_5d × [1.2, 2.0]
    #     * conservative: target = typical_move_15d × [1.0, 1.5]
    #   - غير كده → نرجع للـ bands الثابتة (backward compat).
    # =====================================================================
    _tm_pct = 0.0  # typical move %
    if _use_dna and stock_profile and isinstance(stock_profile, dict):
        try:
            if _p == 'gambler':
                _tm_pct = float(stock_profile.get('typical_move_1d') or 0)
            elif _p == 'balanced':
                _tm_pct = float(stock_profile.get('typical_move_5d') or 0)
            else:  # conservative
                _tm_pct = float(stock_profile.get('typical_move_15d') or 0)
        except (TypeError, ValueError):
            _tm_pct = 0.0

    # حساب معامل التذبذب (0..1): يحدد فين جوه النطاق نوقف.
    # نفضّل volatility_percentile_90d من الـ stock_profile لو متاح (أدق)،
    # غير كده نستخدم vol_pct الممرّر.
    _vol = 0.0
    if stock_profile and isinstance(stock_profile, dict):
        try:
            _vp_profile = float(stock_profile.get('volatility_percentile_90d') or 0)
            if _vp_profile > 0:
                _vol = _vp_profile
        except (TypeError, ValueError):
            pass
    if _vol <= 0:
        try:
            _vol = float(vol_pct)
        except (TypeError, ValueError):
            _vol = 0.0
    # Clamp لـ 0-100
    _vol_clamped = max(0.0, min(100.0, _vol))
    # المقياس: 0.20..1.00 — حتى السهم المستقر جداً ياخد على الأقل 20% من
    # المسافة للنهاية العليا، والسهم المتقلب يوصل للنهاية العليا.
    _scale = 0.20 + (_vol_clamped / 100.0) * 0.80

    if _use_dna and _tm_pct > 0:
        # C4-DNA-RR: typical_move × مضاعفات الـ persona (ديناميكي من السهم نفسه)
        _mult = _PERSONA_DNA_MULT[_p]
        _t_factor = _mult['t_min'] + (_mult['t_max'] - _mult['t_min']) * _scale
        _s_factor = _mult['s_min'] + (_mult['s_max'] - _mult['s_min']) * _scale
        # typical_move_pct قيمة % (مثلاً 2.5 = 2.5%) → نحوّلها لـ fraction
        target_pct = (_tm_pct * _t_factor) / 100.0
        stop_pct = (_tm_pct * _s_factor) / 100.0
        _method_tag = 'dna_typical_move'
    else:
        # Fallback: bands ثابتة (لو DNA مش متاح أو زخم انفجاري)
        target_pct = t_min + (t_max - t_min) * _scale
        stop_pct = s_min + (s_max - s_min) * _scale
        _method_tag = 'momentum_uncap' if _is_momentum_explosion else 'persona_rr_override'

    # ── B3 (Closed-Loop): تعديل محدود للوقف من دروس الشخصية ──────────────
    # لو الشخصية عندها تكرار STOP_TOO_TIGHT (≥2 في 30 يوم) → وسّع مسافة الوقف
    # بمقدار 0.10×count بسقف 0.40. التعديل ده محصور ومستمد من الدروس، مش سحري.
    # ممنوع: تغيير الأوزان عشوائياً بلا سقف. الـ ceiling هنا = +40%.
    _stop_expansion_mult = 1.0
    if lesson_summary and isinstance(lesson_summary, dict):
        try:
            from utils.lesson_store import compute_bounded_stop_expansion
            _stop_expansion_mult = compute_bounded_stop_expansion(_p, lesson_summary)
            if _stop_expansion_mult > 1.0:
                stop_pct = stop_pct * _stop_expansion_mult
                _method_tag = _method_tag + '+lesson_expand'
        except Exception:
            pass

    try:
        _entry = float(entry_price)
    except (TypeError, ValueError):
        _entry = 0.0
    if _entry <= 0:
        return None

    target = _entry * (1.0 + target_pct)
    stop = _entry * (1.0 - stop_pct)

    # Phase 2 (V40): لو explosive_uncap شغال AND فيه مقاومة هيكلية →
    # الهدف يتحول للمقاومة الهيكلية بدل النسبة المئوية الثابتة.
    # الأسهم زي TMGH/AALR لما بتكسر مقاومة بـ volume انفجاري،
    # المقاومة التانية أو التالتة هي الهدف الطبيعي — مش +30% عشوائي.
    # Exit only via trailing stop — مفيش profit cap.
    _target_source = 'persona_pct'
    if _is_momentum_explosion and structural_resistance and structural_resistance > _entry:
        _sr = float(structural_resistance)
        if _sr > target:  # المقاومة أعلى من الهدف المحسوب → نستخدمها
            target = _sr
            # Recalculate target_pct from structural resistance
            target_pct = (_sr - _entry) / _entry
            _target_source = 'structural_resistance'
            _method_tag = 'momentum_uncap+structural_resistance'

    rr = round(target_pct / stop_pct, 2) if stop_pct > 0 else 0.0

    return {
        'target': round(target, 4),
        'stop': round(stop, 4),
        'target_pct': round(target_pct * 100, 2),
        'stop_pct': round(stop_pct * 100, 2),
        'rr_ratio': rr,
        'persona': _p,
        'horizon': _PERSONA_HORIZON_AR.get(_p, ''),
        'method': _method_tag,
        'momentum_uncap': _is_momentum_explosion,
        'explosive_uncap': _is_momentum_explosion,  # V39.2: سهم طاير — مفيش سقف أرباح، الـ trailing بس يخرجنا
        'is_wash_trading': _is_wash_trading,  # Phase 3: volume surge + flat price
        'uncap_veto_reasons': _uncap_veto_reasons,  # Phase 3: list of veto reasons (sector_dead/wash_trading/bear_market)
        'target_source': _target_source,  # Phase 2: 'persona_pct' or 'structural_resistance'
    }


# ============================================================================
# AXIS-5: EXPLOSIVE ROCKET HUNTER — كشف الأسهم الانفجارية
# ============================================================================
def detect_explosive_rocket(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    atr: float = 0.0,
) -> Dict[str, Any]:
    """
    AXIS-5: Explosive Rocket Hunter — كشف الأسهم الانفجارية.

    3 شروط لازم تتحقق مع بعض:
      1. Volume Dry-up (العصر): آخر 5 شموع حجمها < 50% من متوسط 20 يوم
      2. VCP (Volatility Contraction): مدى الشموع بـ يضيق آخر 3-5 شموع
      3. Ignition Candle: آخر شمعة صاعدة، تغلق قرب الهاي، بحجم > 1.5× المتوسط

    Returns:
        {is_rocket: bool, score_boost: float (0-30), reason: str, details: dict}
    """
    # ── Edge case: insufficient data ──────────────────────────────────────
    if not closes or not volumes or not highs or not lows:
        return {
            'is_rocket': False,
            'score_boost': 0.0,
            'reason': 'بيانات ناقصة',
            'details': {'closes_len': len(closes), 'volumes_len': len(volumes)},
        }
    if (len(closes) < 25 or len(volumes) < 25
            or len(highs) < 25 or len(lows) < 25):
        return {
            'is_rocket': False,
            'score_boost': 0.0,
            'reason': (
                f'بيانات غير كافية (< 25 شمعة): '
                f'closes={len(closes)}, vols={len(volumes)}'
            ),
            'details': {
                'closes_len': len(closes),
                'volumes_len': len(volumes),
                'highs_len': len(highs),
                'lows_len': len(lows),
            },
        }

    # ── Compute ATR if not provided ─────────────────────────────────────────
    if atr <= 0:
        try:
            trs = []
            start_i = max(1, len(closes) - 14)
            for i in range(start_i, len(closes)):
                h = highs[i] if i < len(highs) else closes[i]
                l = lows[i] if i < len(lows) else closes[i]
                prev_c = closes[i - 1]
                tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
                trs.append(tr)
            atr = (sum(trs) / len(trs)) if trs else 0.0
        except Exception:
            atr = 0.0

    reasons: List[str] = []
    details: Dict[str, Any] = {'atr': round(atr, 4)}

    # ── 1) Volume Dry-up (العصر) ────────────────────────────────────────────
    # خد آخر 20 شمعة كـ baseline، وآخر 5 كـ نافذة العصر.
    # المفروض الحجم يبقى أقل من 50% من المتوسط. بنستخدم الميديان عشان
    # نتجاهل شمعة الإشعال (اللي حجمها بيبقى عالي جداً).
    vol_last_20 = volumes[-20:]
    avg_20 = (sum(vol_last_20) / len(vol_last_20)) if vol_last_20 else 0.0

    vol_last_5 = volumes[-5:]
    avg_5 = (sum(vol_last_5) / len(vol_last_5)) if vol_last_5 else 0.0
    sorted_5 = sorted(vol_last_5)
    median_5 = sorted_5[len(sorted_5) // 2] if sorted_5 else 0.0

    details['avg_vol_20'] = round(avg_20, 2)
    details['avg_vol_5'] = round(avg_5, 2)
    details['median_vol_5'] = round(median_5, 2)

    cond_volume_dryup = False
    if avg_20 > 0:
        threshold = 0.5 * avg_20
        # الميديان أصلح إحصائياً (لا يتأثر بـ شمعة الإشعال)، لكن بنقبل
        # أيضاً الـ avg الصريح لو قطع النص (للحالات الواضحة).
        if median_5 < threshold or avg_5 < threshold:
            cond_volume_dryup = True
            reasons.append('انكماش حجمي (العصر)')

    # ── 2) VCP (Volatility Contraction Pattern) ────────────────────────────
    # بنقيس المدى (high - low) لكل شمعة، ونتأكد إنه بـ يضيق.
    # بنستثني شمعة الإشعال من النافذة لأنها بطبيعتها مدى كبير.
    ranges_all: List[float] = []
    for i in range(len(highs)):
        if i < len(lows):
            ranges_all.append(highs[i] - lows[i])

    # نافذة الـ VCP = 5 شموع قبل الإشعال (عشان نقيس التضييق قبل الانفجار)
    if len(ranges_all) >= 6:
        vcp_ranges = ranges_all[-6:-1]
    elif len(ranges_all) >= 5:
        vcp_ranges = ranges_all[-5:]
    else:
        vcp_ranges = ranges_all

    details['vcp_ranges'] = [round(r, 4) for r in vcp_ranges]

    cond_vcp = False
    if len(vcp_ranges) >= 3:
        # 3 شروط بديلة (أي واحد يكفي):
        #   أ. 3 شموع متتالية بتضيّق (مع تسامح <= للتعادل)
        #   ب. آخر مدى هو الأصغر (مع تسامح للتعادل)
        #   ج. تقلص محكم: max <= 2 × min (consolidation ضيق)
        consec_3 = (
            vcp_ranges[-1] <= vcp_ranges[-2]
            and vcp_ranges[-2] <= vcp_ranges[-3]
        )
        last_is_smallest = (
            len(vcp_ranges) >= 2
            and vcp_ranges[-1] <= min(vcp_ranges[:-1])
        )
        tight_consolidation = (
            bool(vcp_ranges)
            and min(vcp_ranges) > 0
            and max(vcp_ranges) <= 2 * min(vcp_ranges)
        )
        cond_vcp = consec_3 or last_is_smallest or tight_consolidation
        if cond_vcp:
            reasons.append('تقلص مدى التذبذب (VCP)')

    # ── 3) Ignition Candle (شمعة الإشعال) ────────────────────────────────────
    # آخر شمعة لازم:
    #   أ. صاعدة (close > prev_close — proxy لـ close > open)
    #   ب. تغلق في الـ 25% الأعلى من مدى الشمعة (close_ratio >= 0.75)
    #   ج. حجمها > 1.5× متوسط 20 يوم
    last_close = closes[-1]
    prev_close = closes[-2] if len(closes) >= 2 else last_close
    last_high = highs[-1]
    last_low = lows[-1]
    last_vol = volumes[-1]

    cond_bullish = last_close > prev_close

    close_ratio = 0.0
    if last_high > last_low:
        close_ratio = (last_close - last_low) / (last_high - last_low)
    cond_upper_close = close_ratio >= 0.75  # >= لتسامح الحدود

    cond_ignition_vol = avg_20 > 0 and last_vol > 1.5 * avg_20  # RESTORED to original (was 1.2 — too low)

    details['last_close'] = round(last_close, 4)
    details['prev_close'] = round(prev_close, 4)
    details['last_high'] = round(last_high, 4)
    details['last_low'] = round(last_low, 4)
    details['last_vol'] = last_vol
    details['close_ratio'] = round(close_ratio, 4)
    details['ignition_vol_ratio'] = (
        round(last_vol / avg_20, 2) if avg_20 > 0 else None
    )
    details['cond_bullish'] = cond_bullish
    details['cond_upper_close'] = cond_upper_close
    details['cond_ignition_vol'] = cond_ignition_vol

    cond_ignition = cond_bullish and cond_upper_close and cond_ignition_vol
    if cond_ignition:
        reasons.append('شمعة إشعال صاعدة بحجم عالي')

    # ── Aggregate ─────────────────────────────────────────────────────────
    passed = sum([cond_volume_dryup, cond_vcp, cond_ignition])
    details['conditions_passed'] = passed
    details['cond_volume_dryup'] = cond_volume_dryup
    details['cond_vcp'] = cond_vcp
    details['cond_ignition'] = cond_ignition

    if passed == 3:
        boost = float(get_setting('rocket_score_boost', default=25.0))
        reason = '🚀 صاروخ انفجاري: ' + ' + '.join(reasons)
        return {
            'is_rocket': True,
            'score_boost': boost,
            'reason': reason,
            'details': details,
        }
    elif passed == 2:
        reason = 'إشارات صاروخية جزئية: ' + ' + '.join(reasons)
        return {
            'is_rocket': False,
            'score_boost': 8.0,
            'reason': reason,
            'details': details,
        }
    else:
        return {
            'is_rocket': False,
            'score_boost': 0.0,
            'reason': f'عدد الشروط المتحققة = {passed} (المطلوب ≥ 2)',
            'details': details,
        }


def detect_volume_surge_rocket(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    opens: List[float],
    volumes: List[float],
) -> Dict[str, Any]:
    """
    AXIS-5b: Volume Surge Hunter — صياد الأسهم الانفجارية بالـ Volume Surge.

    مكمل لـ detect_explosive_rocket (اللي بيدور على VCP/Dry-up).
    بيدور على نمط مختلف: انفجار السيولة المفاجئ (Volume Surge) قبل ما السهم يطير.

    مستوحى من Pine Script V56:
      - maker_bull = (volume_surge AND delta_vol > 0) OR imbalance_bull
      - rs_positive (ROC20 > 0)
      - not deeply_extended (ext_atr < 2.2)
      - above SMA50

    الشروط (6 عوامل تتراكم في score 0-100):
      1. Volume Surge (25pts): vol > MA20 + 1.5×STD20
      2. ROC20 > +15% (20pts): زخم قوي آخر 20 يوم
      3. Above SMA50 (15pts): فوق المتوسط
      4. Maker Bull (20pts): delta_vol > 0 OR imbalance_bull
      5. Not deeply extended (10pts): ext_atr < 2.2 (لسه مش طار)
      6. ROC5 > +3% (10pts): زخم قصير المدى

    Returns:
        {is_surge_rocket: bool, score: float (0-100), reason: str,
         entry, target (3R), stop (1.5R → R:R=2.0), details: dict}
    """
    if not closes or not volumes or len(closes) < 25 or len(volumes) < 25:
        return {
            'is_surge_rocket': False, 'score': 0.0,
            'reason': 'بيانات غير كافية (< 25 شمعة)',
            'entry': 0, 'target': 0, 'stop': 0,
            'details': {'closes_len': len(closes), 'volumes_len': len(volumes)},
        }

    # ── Compute indicators ────────────────────────────────────────────────
    # EMA20
    k = 2 / 21
    ema20 = sum(closes[:20]) / 20
    for v in closes[20:]:
        ema20 = v * k + ema20 * (1 - k)

    # SMA50
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else sum(closes) / len(closes)

    # ATR(14)
    trs = []
    for i in range(max(1, len(closes) - 14), len(closes)):
        h, l = highs[i], lows[i]
        prev_c = closes[i - 1]
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    atr_val = sum(trs) / len(trs) if trs else 0.0

    # ROC20 and ROC5
    roc20 = 0.0
    if len(closes) >= 21 and closes[-21] > 0:
        roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100
    roc5 = 0.0
    if len(closes) >= 6 and closes[-6] > 0:
        roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100

    # Volume surge (V56: vol > ma + 1.5*std)
    vol_last_20 = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    avg_vol = sum(vol_last_20) / len(vol_last_20) if vol_last_20 else 0.0
    vol_std = 0.0
    if len(vol_last_20) >= 2 and avg_vol > 0:
        vol_std = (sum((v - avg_vol) ** 2 for v in vol_last_20) / len(vol_last_20)) ** 0.5
    dyn_surge = avg_vol + (vol_std * 1.5)  # RESTORED to original (was 1.0 — too low)
    vol_surge = volumes[-1] > dyn_surge if avg_vol > 0 else False
    vol_ratio = volumes[-1] / (avg_vol or 1)

    # Buy/sell volume (V56 logic)
    denom = highs[-1] - lows[-1] if (highs[-1] - lows[-1]) != 0 else 0.001
    buy_vol = volumes[-1] * ((closes[-1] - lows[-1]) / denom)
    sell_vol = volumes[-1] - buy_vol
    delta_vol = buy_vol - sell_vol
    imbalance_bull = buy_vol > sell_vol * 3 and closes[-1] > opens[-1]
    maker_bull = (vol_surge and delta_vol > 0) or imbalance_bull

    above_sma50 = closes[-1] > sma50 if sma50 > 0 else False
    extension_atr = (closes[-1] - ema20) / atr_val if atr_val > 0 else 0.0
    deeply_extended = extension_atr > 2.2

    # ── Score (0-100) ──────────────────────────────────────────────────────
    score = 0.0
    reasons: List[str] = []

    # 1. Volume surge (25 points)
    if vol_surge:
        score += 25
        reasons.append(f'Volume surge {vol_ratio:.1f}x')
    elif vol_ratio >= 1.3:
        score += 12
        reasons.append(f'Volume semi-surge {vol_ratio:.1f}x')

    # 2. ROC20 (20 points)
    if roc20 > 15:
        score += 20
        reasons.append(f'ROC20=+{roc20:.1f}%')
    elif roc20 > 10:
        score += 12
        reasons.append(f'ROC20=+{roc20:.1f}%')
    elif roc20 > 5:
        score += 5
        reasons.append(f'ROC20=+{roc20:.1f}%')

    # 3. Above SMA50 (15 points)
    if above_sma50:
        score += 15
        reasons.append('فوق SMA50')

    # 4. Maker bull (20 points)
    if maker_bull:
        score += 20
        reasons.append('ميكرز بيشتري')
    elif delta_vol > 0:
        score += 8
        reasons.append('delta +')

    # 5. Not deeply extended (10 points)
    if not deeply_extended:
        score += 10
        reasons.append(f'ext={extension_atr:+.2f}')

    # 6. ROC5 (10 points)
    if roc5 > 3:
        score += 10
        reasons.append(f'ROC5=+{roc5:.1f}%')

    # ── Decision: rocket requires volume surge + positive momentum ──────────
    # RESTORED to original thresholds (was lowered to 30 — caused false signals + quality drop)
    is_rocket = score >= 60 and vol_surge and roc20 > 5

    entry = closes[-1]
    target = entry + (atr_val * 3.0)  # 3R target
    stop = entry - (atr_val * 1.5)    # 1.5R stop → R:R = 2.0

    return {
        'is_surge_rocket': is_rocket,
        'score': min(score, 100.0),
        'reason': ' | '.join(reasons) if reasons else 'لا توجد إشارات',
        'entry': entry,
        'target': target,
        'stop': stop,
        'atr': atr_val,
        'details': {
            'vol_surge': vol_surge,
            'vol_ratio': round(vol_ratio, 2),
            'avg_vol': round(avg_vol, 2),
            'roc20': round(roc20, 1),
            'roc5': round(roc5, 1),
            'above_sma50': above_sma50,
            'maker_bull': maker_bull,
            'imbalance_bull': imbalance_bull,
            'delta_vol': round(delta_vol, 0),
            'ext_atr': round(extension_atr, 2),
            'deeply_extended': deeply_extended,
        },
    }


def detect_accumulation_phase(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    opens: List[float],
    volumes: List[float],
    benchmark_roc14: float = 0.0,
) -> Dict[str, Any]:
    """
    AXIS-5c: Pre-explosion Accumulation Detector — كشف التجميع الهادئ قبل الانفجار.

    بيدور على الأسهم اللي بتجمع سيولة بهدوء قبل ما تطير (مش surge انفجاري).
    ده بيكشف الأسهم اللي detect_volume_surge_rocket بيفوتهم (لأنهم لسه ما عملوش surge).

    مستوحى من نصيحة المحلل (2026-08-28):
      "اللي لسه ناقص هو اكتشاف التجميع الهادئ قبل الانفجار — الحجم يرتفع
       تدريجياً 3-5 أيام من غير ما يبقى surge انفجاري، والسعر فوق المتوسطات،
       و RS إيجابي."

    الشروط (5 عوامل تتراكم في score 0-100):
      1. Accumulation Volume (30pts): متوسط آخر 3 أيام حجم ≥ 1.25× متوسط 20 يوم
      2. Above SMA20 (20pts): السعر فوق SMA20 (اتجاه صاعد قريب)
      3. ROC5 معتدل (20pts): ROC5 بين +3% و +15% (زخم معتدل مش انفجار)
      4. Relative Strength (15pts): ROC14 السهم > benchmark_roc14 + 1.0
      5. Not in Correction (15pts): السعر نزل أقل من 5% من آخر high

    Returns:
        {is_accumulation: bool, score: float (0-100), reason: str,
         entry, target (2.5R), stop (1.25R → R:R=2.0), details: dict}
    """
    if not closes or not volumes or len(closes) < 25 or len(volumes) < 25:
        return {
            'is_accumulation': False, 'score': 0.0,
            'reason': 'بيانات غير كافية (< 25 شمعة)',
            'entry': 0, 'target': 0, 'stop': 0,
            'details': {'closes_len': len(closes), 'volumes_len': len(volumes)},
        }

    # ── Compute indicators ────────────────────────────────────────────────
    # SMA20
    sma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else sum(closes) / len(closes)

    # ATR(14)
    trs = []
    for i in range(max(1, len(closes) - 14), len(closes)):
        h, l = highs[i], lows[i]
        prev_c = closes[i - 1]
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    atr_val = sum(trs) / len(trs) if trs else 0.0

    # ROC5 و ROC14
    roc5 = 0.0
    if len(closes) >= 6 and closes[-6] > 0:
        roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100
    roc14 = 0.0
    if len(closes) >= 15 and closes[-15] > 0:
        roc14 = (closes[-1] - closes[-15]) / closes[-15] * 100

    # ── 1) Accumulation Volume: متوسط آخر 3 أيام حجم ≥ 1.25× متوسط 20 يوم ──
    vol_last_3 = volumes[-3:] if len(volumes) >= 3 else volumes
    avg_vol_3 = sum(vol_last_3) / len(vol_last_3) if vol_last_3 else 0.0
    vol_baseline = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    avg_vol_20 = sum(vol_baseline) / len(vol_baseline) if vol_baseline else 0.0
    vol_ratio = avg_vol_3 / avg_vol_20 if avg_vol_20 > 0 else 0.0
    is_accumulating = vol_ratio >= 1.25  # RESTORED to original (was 1.1 — too low)

    # ── 2) Above SMA20 ──
    above_sma20 = closes[-1] > sma20 if sma20 > 0 else False

    # ── 3) ROC5 معتدل (+3% to +15%) ──
    roc5_moderate = 3.0 <= roc5 <= 15.0

    # ── 4) Relative Strength: ROC14 السهم > benchmark + 1.0 ──
    rs_value = roc14 - benchmark_roc14
    rs_positive = rs_value > 1.0

    # ── 5) Not in Correction: نزل أقل من 5% من آخر high ──
    recent_high_window = highs[-7:] if len(highs) >= 7 else highs
    recent_high = max(recent_high_window) if recent_high_window else closes[-1]
    drawdown_from_high = ((recent_high - closes[-1]) / recent_high * 100) if recent_high > 0 else 0.0
    not_in_correction = drawdown_from_high < 5.0

    # ── Score (0-100) ──────────────────────────────────────────────────────
    score = 0.0
    reasons: List[str] = []

    # 1. Accumulation Volume (30 points)
    if is_accumulating:
        score += 30
        reasons.append(f'Vol accumulation {vol_ratio:.2f}x')
    elif vol_ratio >= 1.15:
        score += 15
        reasons.append(f'Vol semi-accum {vol_ratio:.2f}x')

    # 2. Above SMA20 (20 points)
    if above_sma20:
        score += 20
        reasons.append('فوق SMA20')

    # 3. ROC5 معتدل (20 points)
    if roc5_moderate:
        score += 20
        reasons.append(f'ROC5={roc5:+.1f}% (معتدل)')
    elif 0 < roc5 < 3:
        score += 8
        reasons.append(f'ROC5={roc5:+.1f}% (ضعيف)')

    # 4. Relative Strength (15 points)
    if rs_positive:
        score += 15
        reasons.append(f'RS=+{rs_value:.1f}%')
    elif rs_value > 0:
        score += 7
        reasons.append(f'RS=+{rs_value:.1f}% (ضعيف)')

    # 5. Not in Correction (15 points)
    if not_in_correction:
        score += 15
        reasons.append(f'DD={drawdown_from_high:.1f}%')

    # ── Decision: accumulation requires vol + momentum + trend ──────────
    # RESTORED to original thresholds (was lowered to 40 — caused false signals)
    is_accumulation_signal = (
        score >= 65 and is_accumulating and above_sma20 and roc5 > 0
    )

    entry = closes[-1]
    target = entry + (atr_val * 2.5)  # 2.5R target (موسع شوية للـ accumulation)
    stop = entry - (atr_val * 1.25)   # 1.25R stop → R:R = 2.0

    return {
        'is_accumulation': is_accumulation_signal,
        'score': min(score, 100.0),
        'reason': ' | '.join(reasons) if reasons else 'لا توجد إشارات',
        'entry': entry,
        'target': target,
        'stop': stop,
        'atr': atr_val,
        'details': {
            'vol_ratio': round(vol_ratio, 2),
            'avg_vol_3': round(avg_vol_3, 2),
            'avg_vol_20': round(avg_vol_20, 2),
            'is_accumulating': is_accumulating,
            'above_sma20': above_sma20,
            'roc5': round(roc5, 1),
            'roc14': round(roc14, 1),
            'rs_value': round(rs_value, 1),
            'rs_positive': rs_positive,
            'drawdown_from_high': round(drawdown_from_high, 2),
            'not_in_correction': not_in_correction,
        },
    }


# ============================================================================
# RECOVERY FROM LONG BASE / LONG CORRECTION DETECTOR (AXIS-5d)
# ============================================================================
# صطياد الأسهم اللي فضلت هادية أو بتصحح لمدة طويلة (30-60 يوم)
# ولما تبدأ تظهر علامات التعافي → دخول بدري قبل الانفجار الكبير
# ============================================================================

def detect_recovery_from_base(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    opens: List[float],
    volumes: List[float],
) -> Optional[Dict[str, Any]]:
    """
    Recovery from Long Base / Long Correction Detector (AXIS-5d)

    يصطاد الأسهم التي:
    1. قعدت فترة طويلة (30-60 يوم) في تصحيح أو عرضي (Base)
    2. بدأت تظهر علامات التعافي الحقيقية

    شروط الاكتشاف:
    - وجود قاعدة طويلة (ATR منخفض + حركة محدودة)
    - علامات بداية التعافي (حجم يرجع + سعر يقطع SMA20 + شمعة قوية)
    - السعر قريب من SMA50
    - R/R ≥ 1.8
    - ممنوع لو طلع >12% في 3-5 أيام (مطاردة)
    """
    if len(closes) < 50:
        return None

    # ── 1) وجود قاعدة طويلة أو تصحيح ممتد ──────────────────────────────────
    # ATR آخر 20 يوم vs ATR آخر 60 يوم (لو ATR الحالي أقل → قاعدة)
    import statistics as _stats
    recent_20 = closes[-20:] if len(closes) >= 20 else closes
    recent_60 = closes[-60:] if len(closes) >= 60 else closes

    # Calculate ATR proxy (range-based)
    atr_20 = _stats.mean([(highs[i] - lows[i]) for i in range(-20, 0)]) if len(highs) >= 20 else 0
    atr_60 = _stats.mean([(highs[i] - lows[i]) for i in range(-60, 0)]) if len(highs) >= 60 else atr_20

    # Base condition: ATR الحالي ≤ 0.8× ATR التاريخي (هدوء نسبي)
    is_quiet_base = atr_60 > 0 and atr_20 <= atr_60 * 0.8

    # أو: السعر في نطاق ضيق (آخر 30 يوم ±10%)
    last_30 = closes[-30:] if len(closes) >= 30 else closes
    range_30 = (max(last_30) - min(last_30)) / (min(last_30) or 1) * 100
    is_narrow_range = range_30 < 15  # أقل من 15% نطاق

    # أو: تصحيح من قمة (نزل >15% من قمة 60 يوم)
    high_60 = max(highs[-60:]) if len(highs) >= 60 else max(highs)
    current = closes[-1]
    drawdown = ((current - high_60) / high_60 * 100) if high_60 > 0 else 0
    is_correction = drawdown < -10  # نزل أكثر من 10% من قمة 60 يوم

    # لازم فيه واحدة على الأقل من الحالات الثلاث
    has_base = is_quiet_base or is_narrow_range or is_correction

    if not has_base:
        return None

    # ── 2) علامات بداية التعافي (اثنين على الأقل) ──────────────────────────
    recovery_signals = 0
    reasons = []
    score = 0

    # (أ) الحجم يرجع فوق المتوسط تدريجياً (1.2×–1.6×)
    vol_last_3 = volumes[-3:] if len(volumes) >= 3 else volumes
    avg_vol_3 = sum(vol_last_3) / len(vol_last_3) if vol_last_3 else 0
    vol_baseline = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    avg_vol_20 = sum(vol_baseline) / len(vol_baseline) if vol_baseline else 0
    vol_ratio = avg_vol_3 / avg_vol_20 if avg_vol_20 > 0 else 0

    vol_returning = 1.2 <= vol_ratio <= 2.0  # تدريجي مش انفجار
    if vol_returning:
        recovery_signals += 1
        score += 25
        reasons.append(f'vol_ratio={vol_ratio:.2f}x')

    # (ب) السعر قطع فوق SMA20
    sma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else 0
    above_sma20 = sma20 > 0 and current > sma20
    if above_sma20:
        recovery_signals += 1
        score += 20
        reasons.append('فوق SMA20')

    # (ج) شمعة قوية (إغلاق قريب من الأعلى)
    if len(highs) >= 1 and len(lows) >= 1:
        candle_range = highs[-1] - lows[-1]
        if candle_range > 0:
            close_position = (current - lows[-1]) / candle_range
            strong_candle = close_position >= 0.7  # إغلاق في أعلى 30%
            if strong_candle:
                recovery_signals += 1
                score += 20
                reasons.append(f'close_pos={close_position:.0%}')

    # (د) ROC5 إيجابي (زخم بسيط)
    if len(closes) >= 6:
        roc5 = ((current - closes[-6]) / closes[-6] * 100) if closes[-6] > 0 else 0
        if roc5 > 0:
            recovery_signals += 1
            score += 15
            reasons.append(f'ROC5=+{roc5:.1f}%')

    # لازم عندنا 2 على الأقل من علامات التعافي
    if recovery_signals < 2:
        return None

    # ── 3) شروط الجودة والحماية ─────────────────────────────────────────────
    # السعر قريب من SMA50 (مش تحتها بعمق)
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else 0
    near_sma50 = True
    if sma50 > 0:
        dist_from_sma50 = ((current - sma50) / sma50 * 100)
        near_sma50 = dist_from_sma50 > -15  # مش نازل أكثر من 15% تحت SMA50

    if not near_sma50:
        return None  # بعيد عن SMA50 → انتظر

    # إضافي: فوق SMA50 = نقطة قوة
    if sma50 > 0 and current > sma50:
        score += 10
        reasons.append('فوق SMA50')

    # R/R ≥ 1.8 (وقف تحت آخر قاع + هدف 1.8R)
    recent_low = min(lows[-20:]) if len(lows) >= 20 else min(lows)
    atr_val = atr_20 if atr_20 > 0 else (highs[-1] - lows[-1] or 0.01)

    entry = current
    stop = min(recent_low, entry - atr_val * 1.2)  # تحت آخر قاع أو 1.2×ATR
    target = entry + (atr_val * 2.0)  # 2R target (R:R = 2.0)

    if entry <= 0 or stop >= entry:
        return None

    rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        rr = compute_risk_reward(entry, target, stop, fallback=rr)
    except Exception:
        pass  # keep inline rr computed above
    if rr < 1.5:  # محتاج R/R ≥ 1.5 (مرن شوية عشان السهم في تعافي)
        return None

    # ── 4) شروط الرفض القاطعة ───────────────────────────────────────────────
    # ممنوع لو طلع >12% في 3-5 أيام (مطاردة)
    if len(closes) >= 4:
        roc3 = ((current - closes[-4]) / closes[-4] * 100) if closes[-4] > 0 else 0
        if roc3 > 12:
            return None  # مطاردة
    if len(closes) >= 6:
        roc5 = ((current - closes[-6]) / closes[-6] * 100) if closes[-6] > 0 else 0
        if roc5 > 15:
            return None  # مطاردة

    # Zero Volume guard
    if volumes[-1] < 100:
        return None

    is_recovery = score >= 40 and recovery_signals >= 2

    return {
        'is_recovery_signal': is_recovery,
        'score': min(score, 100.0),
        'reason': ' | '.join(reasons) if reasons else 'لا توجد إشارات تعافي',
        'entry': entry,
        'target': target,
        'stop': stop,
        'rr': rr,
        'details': {
            'has_base': has_base,
            'is_quiet_base': is_quiet_base,
            'is_narrow_range': is_narrow_range,
            'is_correction': is_correction,
            'drawdown_from_60d_high': round(drawdown, 1),
            'vol_ratio': round(vol_ratio, 2),
            'recovery_signals': recovery_signals,
            'atr_20': round(atr_20, 4),
            'atr_60': round(atr_60, 4),
            'above_sma20': above_sma20,
            'near_sma50': near_sma50,
            'above_sma50': sma50 > 0 and current > sma50,
            'roc5': round(roc5, 1) if 'roc5' in dir() else 0,
            'rr_ratio': round(rr, 2),
        },
    }


# ============================================================================
# CORE SCORING ENGINE
# ============================================================================

class CoreScoringEngine:
    """
    محرك التسجيل الموحد
    النقطة الوحيدة للتحليل في النظام الجديد
    """

    def __init__(self):
        self.technical_scorer   = TechnicalScorer()
        self.volume_scorer      = VolumeScorer()
        self.candlestick_scorer = CandlestickScorer()
        self.fundamental_scorer = FundamentalScorer()
        self.risk_calculator    = RiskCalculator()

    def analyze(
        self,
        ticker: str,
        price_data: dict,
        market: str,
        persona: str = "trader",
        support: float = None,
        resistance: float = None,
        extra_data: dict = None,
        custom_overrides: dict = None,
        market_regime: str = 'unknown',
    ) -> UnifiedSignalResult:
        """
        التحليل الكامل

        Args:
            ticker: رمز السهم
            price_data: {
                "closes": [],  "opens": [], "highs": [], "lows": [],
                "volumes": [], "current_volume": int,
                "fundamental": {}  ← اختياري
            }
            market: EGX / KSA / KSE / QSE / CRYPTO
            persona: scalper / trader / investor / conservative
            support: مستوى دعم (اختياري)
            resistance: مستوى مقاومة (اختياري)
            market_regime: حالة السوق bull/bear/range/unknown (اختياري)
                           لو مش متحدد، النظام بيكتشفها تلقائي
        """
        timestamp = datetime.now().isoformat()

        # ─── 1. إعداد الكونفيج ───────────────────────────────────────────
        try:
            config = get_unified_config(market, persona, **(custom_overrides or {}))
        except ValueError as e:
            return self._error_result(ticker, market, persona, str(e), timestamp)

        mp = config.market_profile
        closes = price_data.get("closes", [])

        if not closes or len(closes) < 5:
            return self._error_result(ticker, market, persona,
                                      "بيانات سعرية غير كافية", timestamp)

        current_price = closes[-1]
        if current_price <= 0:
            return self._error_result(ticker, market, persona,
                                      "السعر الحالي صفر - Kimi Fix", timestamp)

        # ─── 2. حساب درجات كل محلل ───────────────────────────────────────
        # FIX-1 Step 4: scorers may return None when data insufficient (per
        # owner directive + Rule 24 — NO placeholder 50.0 anymore). Coerce
        # None → 0.0 here so weighted sum doesn't crash. 0.0 = "no contribution
        # to BUY signal" (honest — no fake neutrality inflation).
        tech_score,   tech_details   = TechnicalScorer.score(price_data, mp)
        vol_score,    vol_details    = VolumeScorer.score(price_data, mp)
        candle_score, candle_details = CandlestickScorer.score(price_data)
        fund_score,   fund_details   = FundamentalScorer.score(price_data)
        # REAL DATA ONLY — no placeholder (per owner directive + Rule 24)
        tech_score   = tech_score   if tech_score   is not None else 0.0
        vol_score    = vol_score    if vol_score    is not None else 0.0
        candle_score = candle_score if candle_score is not None else 0.0
        fund_score   = fund_score   if fund_score   is not None else 0.0

        # Sentiment & Sector (50 محايد لو ما في بيانات)
        sentiment_score = (extra_data or {}).get("sentiment_score", 50.0)
        sector_score    = (extra_data or {}).get("sector_score", 50.0)

        # ─── 3. الدرجة المرجحة ───────────────────────────────────────────
        w = config.weights  # Dict[str, int] مجموعها 100

        weighted_score = (
            tech_score   * w["technical"]    +
            vol_score    * w["volume"]       +
            candle_score * w["candlestick"]  +
            fund_score   * w["fundamental"]  +
            sentiment_score * w["sentiment"] +
            sector_score * w["sector"]
        ) / 100.0

        weighted_score = round(min(100, max(0, weighted_score)), 1)

        # ─── AXIS-5: Explosive Rocket Hunter — score boost ──────────────────
        # Initialize warnings here (moved up from line 1319) so the rocket
        # detection can append to it before the RSI override runs.
        warnings = []
        rocket = detect_explosive_rocket(
            closes=closes,
            highs=price_data.get("highs", []),
            lows=price_data.get("lows", []),
            volumes=price_data.get("volumes", []),
            atr=tech_details.get("atr", 0.0),
        )
        if rocket.get('is_rocket') or rocket.get('score_boost', 0) > 0:
            weighted_score = min(100.0, weighted_score + rocket['score_boost'])
            weighted_score = round(weighted_score, 1)
            warnings.append(
                f"🚀 Rocket boost +{rocket['score_boost']:.0f}: {rocket['reason']}"
            )

        # ─── 4. RSI Override (Kimi Fix) ─────────────────────────────────
        rsi = tech_details.get("rsi", 50.0)
        rsi_override = False

        # تحديد الإشارة الأولية
        raw_signal = self._score_to_signal(weighted_score, config)

        # ─── 4.5 كشف Momentum Accumulation (تجميع ذكي / Pre-Explosion) ──
        # يكشف الأسهم اللي بتصعد متواصل بدون pullback حقيقي (زي ELKA)
        # عشان الـ RSI Override ما يبيعهاش بدري قبل الانفجار
        volume_ratio = vol_details.get("volume_ratio", 1.0)
        momentum = self._detect_momentum_accumulation(
            price_data, rsi, volume_ratio, tech_details.get("macd", "neutral")
        )

        # ─── 4.6 تحديد حالة السوق (regime) ───────────────────────────────
        # لو المستخدم مش محدد regime، نكتشفها تلقائي من الأسعار
        effective_regime = market_regime
        try:
            if effective_regime == 'unknown':
                effective_regime = self._detect_regime(closes)
        except Exception:
            effective_regime = 'unknown'

        # تطبيق RSI Override (ذكي حسب حالة السوق + divergence + حجم)
        volumes_list = price_data.get("volumes", [])
        adjusted_signal, score_adj, rsi_override, rsi_warnings = self._apply_rsi_override(
            raw_signal, rsi, weighted_score, mp,
            momentum=momentum["is_momentum"], momentum_strength=momentum["strength"],
            market_regime=effective_regime,
            prices=closes,
            volumes=volumes_list,
            rsi_current=rsi,
        )
        adjusted_score = round(min(100, max(0, weighted_score + score_adj)), 1)
        warnings.extend(rsi_warnings)

        # ─── 5. حساب وقف الخسارة والهدف ─────────────────────────────────
        entry_price = current_price  # الدخول بالسعر الحالي

        risk_data = self.risk_calculator.calculate(
            entry_price, price_data, config, support, resistance,
            momentum_mode=momentum["is_momentum"]
        )

        # ─── 6. Kimi R/R Validation ──────────────────────────────────────
        rr = risk_data.get("risk_reward", 0)
        rr_valid = risk_data.get("rr_valid", False)
        rejection_reason = None

        if adjusted_signal in ("STRONG_BUY", "BUY", "ACCUMULATE"):
            if not rr_valid:
                if momentum["is_momentum"]:
                    # التجميع الذكي ليه هدف مفتوح + وقف متحرك →
                    # ما نرفضش الصفقة بسبب R/R الضيّق المؤقت
                    rr_valid = True
                    warnings.append(
                        "✅ تجميع ذكي: R/R مفتوح — هدف متحرك مع الوقف المتحرك"
                    )
                else:
                    rejection_reason = (
                        f"R/R = {rr:.2f} أقل من المطلوب {config.min_rr:.1f} "
                        f"(Kimi Fix)"
                    )
                    adjusted_signal = "REJECTED_RR"
                    warnings.append(f"❌ {rejection_reason}")

        # ─── 7. فلاتر الشخصية ────────────────────────────────────────────
        if not config.is_signal_allowed(adjusted_signal):
            adjusted_signal = "HOLD"
            warnings.append(f"⚡ الإشارة معدّلة لـ HOLD لأن الشخصية لا تسمح بهذه الإشارة")

        # ─── 8. Confidence ───────────────────────────────────────────────
        confidence = self._calculate_confidence(
            adjusted_score, len(closes), rr, rsi, rr_valid
        )

        # ─── 9. MACD Details ─────────────────────────────────────────────
        macd_dir = tech_details.get("macd", "neutral")

        # ─── 10. Market Regime ───────────────────────────────────────────
        regime = self._detect_regime(closes)

        # ─── 11. تجميع النتيجة ───────────────────────────────────────────
        result = UnifiedSignalResult(
            ticker        = ticker,
            market        = market.upper(),
            persona       = persona,
            strategy      = mp.default_strategy.value,
            timestamp     = timestamp,
            signal        = adjusted_signal,
            signal_ar     = translate_signal(adjusted_signal),
            score         = adjusted_score,
            confidence    = confidence,
            current_price = round(current_price, 4),
            entry_price   = round(entry_price, 4),
            stop_loss     = risk_data.get("stop_loss", 0),
            target_1      = risk_data.get("target_1", 0),
            target_2      = risk_data.get("target_2"),
            risk_reward   = rr,
            technical_score   = tech_score,
            volume_score      = vol_score,
            candle_score      = candle_score,
            fundamental_score = fund_score,
            sentiment_score   = sentiment_score,
            sector_score      = sector_score,
            rsi_override      = rsi_override,
            rr_valid          = rr_valid,
            rejection_reason  = rejection_reason,
            momentum_accumulation = momentum["is_momentum"],
            momentum_strength     = momentum["strength"],
            momentum_reason       = momentum["reason"],
            no_pullback           = momentum["no_pullback"],
            trailing_stop         = risk_data.get("trailing_stop"),
            market_regime     = regime,
            rsi               = rsi,
            macd_signal       = macd_dir,
            warnings          = warnings,
        )
        # ─── AXIS-5: attach rocket detection metadata ─────────────────────
        # UnifiedSignalResult is a @dataclass without explicit rocket fields,
        # but Python allows attaching dynamic attributes at runtime (no __slots__).
        # Consumers can read `result.rocket_detected` and `result.rocket_details`
        # to surface the AXIS-5 rocket pattern in the UI / logs.
        result.rocket_detected = rocket.get('is_rocket', False)
        result.rocket_details = rocket
        return result

    # ─── Private Helpers ──────────────────────────────────────────────────

    def _score_to_signal(self, score: float, config: UnifiedConfig) -> str:
        """تحويل الدرجة لإشارة
        
        مراجعة (يوليو 2026) — كان فيه bug خطير:
        - قبل: elif score >= 30: REDUCE | elif score >= min_score_sell (35): SELL
        - المشكلة: أي score من 30-34 بياخده REDUCE، وأي score ≥ 35 بياخده HOLD
          من الـ elif اللي قبلها → فرع SELL كان unreachable!
        - بعد: إعادة ترتيب عشان SELL يبقى reachable فعلاً
        """
        mp = config.market_profile
        min_buy    = config.min_score_buy
        min_strong = mp.min_score_strong
        min_sell   = mp.min_score_sell  # 35 افتراضياً

        if score >= min_strong:
            return "STRONG_BUY"
        elif score >= min_buy:
            return "BUY"
        elif score >= 55:               # 55+ -> ACCUMULATE (تضييق نطاق الـ HOLD)
            return "ACCUMULATE"
        elif score >= 45:               # 45-54 → HOLD (نطاق محايد مظبوط)
            return "HOLD"
        elif score >= 35:               # 35-44 → REDUCE (تخفيف تدريجي)
            return "REDUCE"
        elif score >= 20:               # 20-34 → SELL (بيع)
            return "SELL"
        else:
            return "STRONG_SELL"       # <20 → بيع قوي


    def _detect_rsi_divergence(
        self, prices: List[float], rsi_current: float, volumes: List[float] = None
    ) -> str:
        """
        كشف Divergence ثلاثي الأبعاد (3D): السعر + RSI + الحجم
        
        بيقارن آخر 5 قمم/قيعان عشان يشوف لو في اختلاف:
        - السعر يعمل قمم أعلى بس الـ RSI يعمل قمم أقل → bearish divergence
        - السعر يعمل قيعان أقل بس الـ RSI يعمل قيعان أعلى → bullish divergence
        
        ⚡ 3D CONFIRMATION (جديد):
        - Bearish divergence + حجم متناقص = تأكيد حقيقي (distribution)
        - Bullish divergence + حجم متزايد = تأكيد حقيقي (accumulation)
        - Divergence بدون تأكيد الحجم = 'none' (مش واثق)
        
        محتاجين 10 نقاط على الأقل عشان نقدر نكتشف النمط
        """
        try:
            if len(prices) < 10:
                return 'none'

            window = prices[-30:] if len(prices) >= 30 else prices
            n = len(window)

            # نلاقي القمم والقيعان المحلية
            peaks_idx = []
            troughs_idx = []
            for i in range(1, n - 1):
                if window[i] > window[i - 1] and window[i] > window[i + 1]:
                    peaks_idx.append(i)
                if window[i] < window[i - 1] and window[i] < window[i + 1]:
                    troughs_idx.append(i)

            peaks_idx = peaks_idx[-5:] if len(peaks_idx) >= 5 else peaks_idx
            troughs_idx = troughs_idx[-5:] if len(troughs_idx) >= 5 else troughs_idx

            # ⚡ تحديد اتجاه الحجم (volume trend)
            vol_trend = 'neutral'  # 'increasing' | 'decreasing' | 'neutral'
            if volumes and len(volumes) >= 10:
                vol_window = volumes[-(len(window)):] if len(volumes) >= len(window) else volumes
                if len(vol_window) >= 10:
                    first_half_vol = vol_window[:len(vol_window) // 2]
                    second_half_vol = vol_window[len(vol_window) // 2:]
                    avg_first_vol = sum(first_half_vol) / len(first_half_vol) if first_half_vol else 0
                    avg_second_vol = sum(second_half_vol) / len(second_half_vol) if second_half_vol else 0
                    if avg_first_vol > 0:
                        vol_ratio = avg_second_vol / avg_first_vol
                        if vol_ratio > 1.2:
                            vol_trend = 'increasing'
                        elif vol_ratio < 0.8:
                            vol_trend = 'decreasing'

            # كشف Bearish Divergence
            if len(peaks_idx) >= 2:
                first_half_peaks = peaks_idx[:len(peaks_idx) // 2]
                second_half_peaks = peaks_idx[len(peaks_idx) // 2:]
                if first_half_peaks and second_half_peaks:
                    avg_first = sum(window[i] for i in first_half_peaks) / len(first_half_peaks)
                    avg_second = sum(window[i] for i in second_half_peaks) / len(second_half_peaks)
                    
                    # السعر بيعمل قمم أعلى...
                    if avg_second > avg_first:
                        # ⚡ 3D: لازم الحجم يأكد — حجم متناقص = distribution
                        if vol_trend == 'decreasing':
                            return 'bearish_confirmed'  # 3D confirmed — strongest signal
                        elif rsi_current < 65:
                            return 'bearish'  # 2D only — RSI confirms weakness
                        # volume increasing + higher highs = momentum, NOT divergence

            # كشف Bullish Divergence  
            if len(troughs_idx) >= 2:
                first_half_troughs = troughs_idx[:len(troughs_idx) // 2]
                second_half_troughs = troughs_idx[len(troughs_idx) // 2:]
                if first_half_troughs and second_half_troughs:
                    avg_first = sum(window[i] for i in first_half_troughs) / len(first_half_troughs)
                    avg_second = sum(window[i] for i in second_half_troughs) / len(second_half_troughs)
                    
                    # السعر بيعمل قيعان أقل...
                    if avg_second < avg_first:
                        # ⚡ 3D: لازم الحجم يأكد — حجم متزايد = accumulation
                        if vol_trend == 'increasing':
                            return 'bullish_confirmed'  # 3D confirmed — strongest signal
                        elif rsi_current > 35:
                            return 'bullish'  # 2D only — RSI confirms strength

            return 'none'
        except Exception:
            return 'none'

    def _apply_rsi_override(
        self,
        signal: str,
        rsi: float,
        score: float,
        mp: MarketProfile,
        momentum: bool = False,
        momentum_strength: float = 0.0,
        market_regime: str = 'unknown',
        prices: List[float] = None,
        volumes: List[float] = None,
        rsi_current: float = None,
    ) -> Tuple[str, float, bool, List[str]]:
        """تطبيق قواعد RSI Override — ذكي حسب حالة السوق (regime-aware)"""
        warnings = []
        override = False
        adj = 0.0

        if rsi <= 0 or rsi > 100:
            return signal, adj, override, warnings

        # ─── تحديد حالة السوق ────────────────────────────────────────────
        # لو مفيش regime صالح، نستخدم القيم الافتراضية (unknown = القيم الأصلية)
        valid_regimes = ('bull', 'bear', 'range', 'unknown')
        if market_regime not in valid_regimes:
            market_regime = 'unknown'

        # ─── حدود RSI حسب حالة السوق ─────────────────────────────────────
        # في السوق الصاعد، الـ RSI بيقع فوق 80 أسابيع → الحدود أعلى
        # في السوق الهابط، RSI 60 يبقى overbought → الحدود أقل
        RSI_THRESHOLDS = {
            'bull':  {'extreme_high': 90, 'overbought': 82, 'oversold': 25, 'extreme_low': 15},
            'bear':  {'extreme_high': 65, 'overbought': 58, 'oversold': 35, 'extreme_low': 25},
            'range': {'extreme_high': 80, 'overbought': 72, 'oversold': 28, 'extreme_low': 18},
            'unknown': {'extreme_high': 75, 'overbought': 70, 'oversold': 30, 'extreme_low': 20},
        }
        # Fix: map bear_trend/bull_trend to base regime keys
        _rm = market_regime
        if _rm in ('bear_trend', 'bear'): _rm = 'bear'
        elif _rm in ('bull_trend', 'bull'): _rm = 'bull'
        elif _rm in ('ranging', 'range'): _rm = 'range'
        else: _rm = 'unknown'
        thresh = RSI_THRESHOLDS.get(_rm, RSI_THRESHOLDS['unknown'])

        # ─── كشف Divergence ───────────────────────────────────────────────
        # بنشوف لو السعر والـ RSI ماشيين في اتجاهين مختلفين
        divergence = 'none'
        try:
            effective_prices = prices if prices else []
            effective_rsi = rsi_current if rsi_current is not None else rsi
            if effective_prices:
                divergence = self._detect_rsi_divergence(effective_prices, effective_rsi, volumes=volumes)
        except Exception:
            divergence = 'none'

        if divergence == 'bearish_confirmed':
            warnings.append("⚠️ 3D Divergence: السعر يصعد + RSI يضعف + حجم بيقل = distribution حقيقي — SELL قوي")
        elif divergence == 'bearish':
            warnings.append("⚠️ Divergence: السعر يصعد بس RSI يضعف — تنبيه بيع (مش مأكد)")
        elif divergence == 'bullish_confirmed':
            warnings.append("✅ 3D Divergence: السعر يهبط + RSI يقوي + حجم بيزيد = accumulation حقيقي — BUY قوي")
        elif divergence == 'bullish':
            warnings.append("✅ Divergence: السعر يهبط بس RSI يقوي — تنبيه شراء (مش مأكد)")

        # ─── فحص الحجم (تأكيد أو رفض إشارة RSI) ─────────────────────────
        # لو الحجم تحت المتوسط = إشارة RSI ممكن تكون "مزيفة"
        volume_below_avg = False
        try:
            if volumes and len(volumes) >= 20:
                vol_5 = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else 0
                vol_20 = sum(volumes[-20:]) / 20
                if vol_20 > 0 and vol_5 < vol_20:
                    volume_below_avg = True
        except Exception:
            volume_below_avg = False

        # ─── تعديل الحدود بناءً على Divergence (3D: confirmed = تعديل أكبر) ──
        effective_thresh = dict(thresh)  # نسخة عشان نعدل عليها
        if divergence == 'bearish_confirmed':
            effective_thresh['extreme_high'] -= 8  # -8 بدل -5 (أقوى)
            effective_thresh['overbought'] -= 8
        elif divergence == 'bearish':
            effective_thresh['extreme_high'] -= 5
            effective_thresh['overbought'] -= 5
        elif divergence == 'bullish_confirmed':
            effective_thresh['extreme_low'] += 8  # +8 بدل +5 (أقوى)
            effective_thresh['oversold'] += 8
        elif divergence == 'bullish':
            effective_thresh['extreme_low'] += 5
            effective_thresh['oversold'] += 5

        # ⚡ 3D: لو في confirmed bearish divergence → حتى لو momentum، احذر
        if divergence == 'bearish_confirmed' and rsi >= effective_thresh['overbought']:
            if signal in ("STRONG_BUY", "BUY", "ACCUMULATE"):
                signal, adj, override = "SELL", -20, True
                warnings.append(
                    f"⚠️ 3D Divergence بيغلب الـ Momentum: حجم بيقل + سعر صاعد = distribution → بيع"
                )
                return signal, adj, override, warnings

        # ─── استثناء Momentum Accumulation (تجميع ذكي / Pre-Explosion) ──
        # سهم بيتجمع (حجم ×3 + فوق كل المتوسطات + RSI < 85) = أيدي قوية
        # شارية، مش overbought. ما نبيعوش بدري قبل الانفجار (زي ELKA).
        if momentum and rsi < 85:
            if signal in ("STRONG_BUY", "BUY", "ACCUMULATE"):
                new_signal = "ACCUMULATE" if signal == "STRONG_BUY" else signal
                override = True
                warnings.append(
                    "✅ Momentum Accumulation: RSI مرتفع = أيدي قوية شارية، "
                    "مش overbought — نمسك مع الاتجاه (Pre-Explosion)"
                )
                return new_signal, 0.0, override, warnings
            if signal == "HOLD":
                override = True
                warnings.append(
                    "✅ Momentum Accumulation: رفعنا HOLD لـ ACCUMULATE — "
                    "السهم بيتجمع مش بيع"
                )
                return "ACCUMULATE", 10.0, override, warnings

        # ─── RSI تشبع شرائي قصوي → بيع إجباري ────────────────────────────
        # الحدود دي بتتغير حسب حالة السوق (regime-aware)
        # لكن لو الحجم تحت المتوسط = مش هندّي بيع (مزيفة)
        if rsi >= effective_thresh['extreme_high']:
            # لو الحجم تحت المتوسط → إشارة RSI مزيفة (صعود بلا دعم)
            # ⚡ 3D: لو confirmed bearish divergence = بيع حتى لو الحجم عادي
            if divergence == 'bearish_confirmed':
                signal, adj, override = "SELL", -25, True
                warnings.append(
                    f"⚠️ 3D Divergence حقيقي: RSI {rsi:.0f} + distribution حقيقي (حجم بيقل) → بيع فوري"
                )
            elif volume_below_avg:
                warnings.append(
                    f"⚠️ RSI {rsi:.0f} تشبع قصوي بس الحجم تحت المتوسط → "
                    f"إشارة RSI مزيفة (صعود ضعيف) — ما نبيعش"
                )
            else:
                if signal in ("STRONG_BUY", "BUY", "ACCUMULATE"):
                    signal, adj, override = "SELL", -25, True
                    warnings.append(
                        f"⚠️ Kimi Fix: RSI {rsi:.0f} = تشبع قصوي [{market_regime}] → تحويل لبيع"
                    )
                elif signal == "HOLD":
                    signal, adj, override = "SELL", -15, True
                    warnings.append(
                        f"⚠️ Kimi Fix: RSI {rsi:.0f} + HOLD [{market_regime}] = بيع وقائي"
                    )
                elif signal == "REDUCE":
                    signal, adj, override = "SELL", -10, True
                    warnings.append(
                        f"⚠️ Kimi Fix: RSI {rsi:.0f} + REDUCE [{market_regime}] = بيع"
                    )

        # RSI تشبع شرائي → تخفيف
        elif rsi >= effective_thresh['overbought']:
            if signal == "STRONG_BUY":
                signal, adj, override = "REDUCE", -20, True
                warnings.append(
                    f"⚠️ Kimi Fix: RSI {rsi:.0f} = تشبع [{market_regime}] → تحويل لتخفيف"
                )
            elif signal == "BUY":
                signal, adj, override = "ACCUMULATE", -10, True

        # RSI تشبع بيعي قصوي → شراء قوي
        elif rsi <= effective_thresh['extreme_low']:
            # لو الحجم تحت المتوسط → إشارة RSI مزيفة (مفيش ضغط بيعي حقيقي)
            if volume_below_avg:
                warnings.append(
                    f"⚠️ RSI {rsi:.0f} تشبع بيعي قصوي بس الحجم تحت المتوسط → "
                    f"إشارة RSI مزيفة (مفيش ضغط بيعي) — ما نشتريش"
                )
            else:
                if signal in ("SELL", "STRONG_SELL", "REDUCE"):
                    signal, adj, override = "BUY", 25, True
                    warnings.append(
                        f"✅ Kimi Fix: RSI {rsi:.0f} = تشبع بيعي قصوي [{market_regime}] → شراء"
                    )

        # RSI تشبع بيعي → رفع الإشارة
        elif rsi <= effective_thresh['oversold']:
            if signal == "SELL":
                signal, adj, override = "HOLD", 10, True
            elif signal == "REDUCE":
                signal, adj, override = "HOLD", 5, True

        return signal, adj, override, warnings

    def _calculate_confidence(
        self,
        score: float,
        data_points: int,
        rr: float,
        rsi: float,
        rr_valid: bool,
    ) -> float:
        """حساب مستوى الثقة (0-100)"""
        confidence = 50.0

        # بيانات أكثر = ثقة أعلى
        if data_points >= 200:
            confidence += 15
        elif data_points >= 100:
            confidence += 10
        elif data_points >= 50:
            confidence += 5
        elif data_points < 20:
            confidence -= 20

        # R/R جيد = ثقة أعلى
        if rr_valid:
            if rr >= 2.5:
                confidence += 15
            elif rr >= 2.0:
                confidence += 10
            elif rr >= 1.5:
                confidence += 5
        else:
            confidence -= 20

        # الدرجة العالية = ثقة أعلى
        if score >= 80:
            confidence += 15
        elif score >= 70:
            confidence += 8
        elif score >= 60:
            confidence += 3
        elif score < 40:
            confidence -= 10

        # RSI في المنطقة المحايدة = أفضل
        if 40 <= rsi <= 60:
            confidence += 5

        return round(min(95, max(5, confidence)), 1)

    def _detect_regime(self, closes: List[float]) -> str:
        """كشف حالة السوق (bull/bear/range)"""
        if len(closes) < 20:
            return "unknown"

        ma20 = sum(closes[-20:]) / 20
        current = closes[-1]
        oldest = closes[-20]

        change_pct = ((current - oldest) / oldest) * 100 if oldest > 0 else 0

        if change_pct > 5 and current > ma20:
            return "bull"
        elif change_pct < -5 and current < ma20:
            return "bear"
        else:
            return "range"

    def _detect_momentum_accumulation(
        self,
        price_data: dict,
        rsi: float,
        volume_ratio: float,
        macd_dir: str,
    ) -> dict:
        """
        كشف Momentum Accumulation (تجميع ذكي / Pre-Explosion)

        النمط: سهم بيصعد متواصل بدون pullback حقيقي (زي ELKA) —
        مش صعود عادي، ده smart money بيتجمع.

        الشروط (النتيجة 0-100):
        - السعر فوق SMA20 > SMA50        : +30
        - RSI في النطاق 55-85 (momentum) : +25
        - حجم ≥ 2.5× المتوسط (تجميع خفي) : +25
        - مفيش تراجع > 5% في آخر 15 يوم  : +20
        """
        closes = price_data.get("closes", [])
        if len(closes) < 30:
            return {"is_momentum": False, "strength": 0.0, "reason": "", "no_pullback": False}

        ma20 = calc_sma(closes, 20)
        ma50 = calc_sma(closes, 50)
        current = closes[-1]
        above_mas = current > ma20 > ma50

        rsi_zone = 55 <= rsi <= 85
        vol_spike = volume_ratio >= 2.5

        window = closes[-15:]
        peak = max(window)
        trough = min(window)
        drawdown = ((peak - trough) / peak * 100) if peak > 0 else 100
        no_pullback = drawdown <= 5.0

        score = 0.0
        if above_mas:    score += 30
        if rsi_zone:     score += 25
        if vol_spike:    score += 25
        if no_pullback:  score += 20

        # لازم الشرط الجوهري يتحقق: فوق المتوسطات + (حجم أو RSI momentum)
        is_momentum = score >= 70 and above_mas and (vol_spike or rsi_zone)

        reason = ""
        if is_momentum:
            reason = (
                f"تجميع ذكي (+{score:.0f}): فوق كل المتوسطات، "
                f"حجم ×{volume_ratio:.1f}، RSI={rsi:.0f}، "
                f"بدون تراجع >5%={'نعم' if no_pullback else 'لا'}"
            )

        return {
            "is_momentum": is_momentum,
            "strength": score,
            "reason": reason,
            "no_pullback": no_pullback,
        }

    def _error_result(
        self, ticker: str, market: str, persona: str,
        reason: str, timestamp: str
    ) -> UnifiedSignalResult:
        """نتيجة خطأ"""
        return UnifiedSignalResult(
            ticker=ticker, market=market, persona=persona,
            strategy="unknown", timestamp=timestamp,
            signal="NO_DATA", signal_ar="بيانات غير كافية",
            score=0, confidence=0,
            current_price=0, entry_price=0, stop_loss=0,
            target_1=0, risk_reward=0,
            rr_valid=False,
            rejection_reason=reason,
            warnings=[f"❌ خطأ: {reason}"],
        )


# ============================================================================
# BATCH ANALYZER
# ============================================================================

class BatchAnalyzer:
    """تحليل مجموعة أسهم دفعة واحدة"""

    def __init__(self):
        self.engine = CoreScoringEngine()

    def analyze_batch(
        self,
        tickers_data: Dict[str, dict],
        market: str,
        persona: str = "trader",
        min_score: float = None,
        top_n: int = None,
    ) -> List[UnifiedSignalResult]:
        """
        تحليل مجموعة أسهم

        Args:
            tickers_data: {ticker: price_data}
            market: السوق
            persona: الشخصية
            min_score: الحد الأدنى للدرجة (يستخدم من الكونفيج لو None)
            top_n: أعلى N نتيجة فقط
        """
        results = []
        config = get_unified_config(market, persona)
        threshold = min_score or config.min_score_buy

        for ticker, data in tickers_data.items():
            try:
                result = self.engine.analyze(ticker, data, market, persona)
                if result.score >= threshold and result.is_valid:
                    results.append(result)
            except Exception as e:
                print(f"[BatchAnalyzer] خطأ في {ticker}: {e}")

        # ترتيب حسب الدرجة
        results.sort(key=lambda r: r.score, reverse=True)

        return results[:top_n] if top_n else results

    def get_summary_stats(self, results: List[UnifiedSignalResult]) -> dict:
        """إحصائيات ملخصة"""
        if not results:
            return {}

        signals = [r.signal for r in results]
        valid = [r for r in results if r.is_valid]

        return {
            "total":           len(results),
            "valid":           len(valid),
            "strong_buy":      signals.count("STRONG_BUY"),
            "buy":             signals.count("BUY"),
            "accumulate":      signals.count("ACCUMULATE"),
            "hold":            signals.count("HOLD"),
            "sell":            signals.count("SELL") + signals.count("STRONG_SELL"),
            "rejected":        signals.count("REJECTED_RR") + signals.count("NO_DATA"),
            "avg_score":       round(sum(r.score for r in valid) / len(valid), 1) if valid else 0,
            "avg_rr":          round(sum(r.risk_reward for r in valid) / len(valid), 2) if valid else 0,
            "avg_confidence":  round(sum(r.confidence for r in valid) / len(valid), 1) if valid else 0,
        }


# ============================================================================
# SINGLETON
# ============================================================================

_engine_instance: Optional[CoreScoringEngine] = None


def get_engine() -> CoreScoringEngine:
    """الحصول على instance وحيد من المحرك"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = CoreScoringEngine()
    return _engine_instance


# ============================================================================
# QUICK TEST
# ============================================================================

if __name__ == "__main__":
    import random

    print("=" * 60)
    print("🧪 اختبار Core Scoring Engine")
    print("=" * 60)

    # بيانات تجريبية
    n = 250
    base = 100.0
    closes = []
    for i in range(n):
        base *= (1 + random.uniform(-0.02, 0.025))
        closes.append(round(base, 4))

    price_data = {
        "closes":  closes,
        "opens":   [c * 0.99 for c in closes],
        "highs":   [c * 1.01 for c in closes],
        "lows":    [c * 0.98 for c in closes],
        "volumes": [random.randint(500_000, 5_000_000) for _ in range(n)],
    }

    engine = get_engine()

    # اختبار كل الأسواق مع كل الشخصيات
    markets  = ["EGX", "KSA", "CRYPTO"]
    personas = ["scalper", "trader", "investor", "conservative"]

    for market in markets:
        print(f"\n{'─'*50}")
        print(f"📊 السوق: {MARKET_PROFILES[market].market_name_ar}")
        for persona in personas:
            result = engine.analyze("TEST", price_data, market, persona)
            print(f"  [{persona:12s}] {result.signal:12s} | "
                  f"Score: {result.score:5.1f} | "
                  f"R/R: {result.risk_reward:.2f} | "
                  f"Conf: {result.confidence:.0f}%")
            if result.warnings:
                for w in result.warnings:
                    print(f"    ⚡ {w}")
