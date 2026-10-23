"""
محرك الخروج الذكي — Smart Exit Engine
======================================
V41: نظام خروج ذكي بيفهم المسار مش بس بيع عند نسبة ثابتة

المشاكل اللي بيحلها:
- سهم بيطير +100% وبنبيع عند +10% → انتحار!
- مفيش تحليل استمرار قبل البيع → بنبيع في نص الترند
- نسب الربح ثابتة مش ديناميكية → +10%/+20% مش مناسبة لكل الأسهم
- مفيش تحديد للمستقبل → المستخدم مش عارف الخطوة الجاية

الفلسفة:
"لا تبيع سهم بيعمل قمم أعلى وأعلى إلا لما يعمل قمة أقل"
— جيسي ليفرمور

"السهم اللي بيطير لما الحجم بيفضل معاه — امسكه لما الحجم يقل"
— ريتشارد أونيل
"""

import math
from dataclasses import dataclass, field
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime, timedelta
from enum import Enum


# ============================================================================
# أنواع الخروج
# ============================================================================

class ExitReason(str, Enum):
    """أسباب الخروج الذكية"""
    TRAILING_STOP = "trailing_stop"           # الستوب المتحرك وقع
    MOMENTUM_DEATH = "momentum_death"         # الزخم مات (حجم نزل + مفيش قمم جديدة)
    TARGET_SMART = "target_smart"             # هدف ذكي (resistance حقيقي مش نسبة ثابتة)
    REGIME_CHANGE = "regime_change"           # السوق اتغير (bull → bear)
    SECTOR_ROTATION = "sector_rotation"       # السيولة طلعت من القطاع
    BREAKDOWN = "breakdown"                   # السهم كسر دعم مهم
    HOLD_THROUGH = "hold_through"             # امسك — لسه بيطير
    SCALE_OUT_PARTIAL = "scale_out_partial"   # جني جزئي عند مقاومة
    NO_EXIT = "no_exit"                       # مفيش سبب للخروج


class TrajectoryType(str, Enum):
    """أنواع مسار السهم"""
    STRONG_UPTREND = "strong_uptrend"         # ترند صاعد قوي (قمم أعلى + حجم)
    UPTREND = "uptrend"                       # ترند صاعد عادي
    CONSOLIDATION = "consolidation"           # تجميع (مفيش اتجاه واضح)
    WEAKENING = "weakening"                   # ضعف (حجم نزل + مفيش اختراقات)
    DISTRIBUTION = "distribution"             # توزيع (الحيتان بيبيعوا)
    DOWNTREND = "downtrend"                   # ترند نازل
    REVERSAL_RISK = "reversal_risk"           # خطر انعكاس


@dataclass
class ContinuationAnalysis:
    """تحليل الاستمرار — هل السهم مكمل ولا بيقع؟"""
    is_continuing: bool                        # لسه بيطير؟
    making_higher_highs: bool                  # بيعمل قمم أعلى؟
    making_higher_lows: bool                   #يعمل قيعان أعلى؟
    volume_confirming: bool                    # الحجم بيتأكد؟
    momentum_alive: bool                      # الزخم لسه موجود؟
    days_since_last_high: int                 # كم يوم من آخر قمة؟
    volume_trend: str                          # 'rising', 'flat', 'declining'
    price_vs_vwap: str                         # 'above', 'at', 'below'
    confidence: float                          # 0.0 - 1.0
    reason: str                                # سبب عربي
    next_step: str                             # الخطوة الجاية (عربي)
    watch_for: List[str]                       # إيه اللي لازم تراقبه


@dataclass
class TrajectoryAnalysis:
    """تحليل مسار السهم — إيه اللي جاي؟"""
    trajectory: TrajectoryType
    trajectory_strength: float                 # 0.0 - 1.0
    expected_move_pct: float                  # الحركة المتوقعة %
    time_horizon_days: int                    # الأفق الزمني
    key_levels: Dict[str, float]              # مقاومات ودعوم مهمة
    catalysts: List[str]                       # محفزات محتملة
    risks: List[str]                          # مخاطر
    advice: str                                # نصيحة عربية مفصلة
    confidence: float                          # ثقة 0.0 - 1.0


@dataclass 
class SmartExitDecision:
    """قرار الخروج الذكي"""
    should_exit: bool
    exit_reason: ExitReason
    exit_pct: float                            # نسبة الخروج (0.0-1.0) — 1.0 = خروج كامل
    exit_price_target: Optional[float]         # سعر الخروج المقترح
    continuation: ContinuationAnalysis         # تحليل الاستمرار
    trajectory: TrajectoryAnalysis             # تحليل المسار
    dynamic_targets: Dict[str, Any]            # الأهداف الديناميكية
    message: str                               # رسالة عربية


# ============================================================================
# المحرك الذكي
# ============================================================================

class SmartExitEngine:
    """
    محرك الخروج الذكي
    
    بيقرأ:
    - مسار السهم (قمم وقيعان)
    - حجم التداول (تأكيد أو ضعف)
    - القطاع (سيولة جارية ولا لا)
    - السوق (ترند عام)
    - تاريخ الصفقات السابقة (تعلم)
    
    بيقرر:
    - امسك ولا بيع
    - لو بيع: كام نسبة ولما
    - الخطوة الجاية
    """
    
    def __init__(self):
        # أوزان العوامل
        self.W_MOMENTUM = 0.30     # وزن الزخم
        self.W_VOLUME = 0.25       # وزن الحجم
        self.W_SECTOR = 0.20       # وزن القطاع
        self.W_REGIME = 0.15       # وزن السوق
        self.W_PATTERN = 0.10      # وزن النمط
    
    # ========================================================================
    # 1. تحليل الاستمرار — هل السهم مكمل؟
    # ========================================================================
    
    def analyze_continuation(
        self,
        current_price: float,
        entry_price: float,
        highest_price: float,
        recent_highs: List[float],        # آخر 5-10 قمم (أحدث أول)
        recent_lows: List[float],         # آخر 5-10 قيعان
        recent_volumes: List[float],      # آخر 10-20 يوم حجم
        avg_volume_20: float,             # متوسط حجم 20 يوم
        vwap: Optional[float] = None,     # VWAP لو متاح
        sector_momentum: float = 0.0,     # زخم القطاع (-1 لـ +1)
        market_regime: str = "neutral",   # bull/bear/neutral
    ) -> ContinuationAnalysis:
        """
        تحليل الاستمرار: هل السهم لسه بيطير ولا بيقع؟
        
        فلسفة ليفرمور: "لا تبيع سهم بيعمل قمم أعلى"
        فلسفة أونيل: "احتفظ لما الحجم يقل مع السعر"
        """
        
        # --- قمم أعلى؟ ---
        making_higher_highs = False
        if len(recent_highs) >= 3:
            # آخر 3 قمم: كل واحدة أعلى من اللي قبلها؟
            making_higher_highs = (
                recent_highs[0] > recent_highs[1] > recent_highs[2]
            )
        
        # --- قيعان أعلى؟ ---
        making_higher_lows = False
        if len(recent_lows) >= 3:
            making_higher_lows = (
                recent_lows[0] > recent_lows[1] > recent_lows[2]
            )
        
        # --- حجم مؤكد؟ ---
        if len(recent_volumes) >= 5:
            recent_avg_vol = sum(recent_volumes[:5]) / 5
            volume_confirming = recent_avg_vol >= avg_volume_20 * 0.8
            # اتجاه الحجم
            if len(recent_volumes) >= 10:
                first_half = sum(recent_volumes[:5]) / 5
                second_half = sum(recent_volumes[5:10]) / 5
                if first_half > second_half * 1.2:
                    volume_trend = "rising"
                elif second_half > first_half * 1.2:
                    volume_trend = "declining"
                else:
                    volume_trend = "flat"
            else:
                volume_trend = "flat"
        else:
            volume_confirming = True  # مفيش بيانات كافية — افترض صح
            volume_trend = "flat"
        
        # --- زخم لسه موجود؟ ---
        gain_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
        pct_from_high = ((highest_price - current_price) / highest_price) * 100 if highest_price > 0 else 0
        
        # الزخم لسه حي لو:
        # 1. بيعمل قمم أعلى أو قيعان أعلى
        # 2. السعر قريب من القمة (ضمن 5%)
        # 3. الحجم لسه مؤكد
        momentum_alive = (
            (making_higher_highs or making_higher_lows) and
            pct_from_high <= 5.0 and
            volume_confirming
        )
        
        # لو السهم ربحان أكتر من 15% ومفيش قمم أعلى بس السعر ثابت = تجميع
        if gain_pct > 15 and not making_higher_highs and pct_from_high <= 3.0:
            momentum_alive = True  # تجميع قبل اختراق تاني
        
        # --- كم يوم من آخر قمة؟ ---
        days_since_last_high = 0
        if highest_price > 0 and current_price < highest_price:
            # تقدير: كل 1% تحت القمة ≈ 1-2 يوم
            days_since_last_high = int(pct_from_high * 1.5)
        
        # --- سعر مقابل VWAP ---
        if vwap and vwap > 0:
            vwap_diff = ((current_price - vwap) / vwap) * 100
            if vwap_diff > 1:
                price_vs_vwap = "above"
            elif vwap_diff < -1:
                price_vs_vwap = "below"
            else:
                price_vs_vwap = "at"
        else:
            price_vs_vwap = "above"  # افتراضي
        
        # --- هل الاستمرار صحيح؟ ---
        is_continuing = momentum_alive and gain_pct > 0
        
        # --- ثقة التحليل ---
        confidence = 0.0
        if making_higher_highs: confidence += 0.3
        if making_higher_lows: confidence += 0.2
        if volume_confirming: confidence += 0.2
        if price_vs_vwap == "above": confidence += 0.15
        if sector_momentum > 0.3: confidence += 0.15
        
        # --- السبب و الخطوة الجاية ---
        if is_continuing:
            if making_higher_highs and volume_confirming:
                reason = "السهم بيعمل قمم أعلى بحجم مؤكد — امسك واتابع"
                next_step = "راقب الحجم: لو نزل بكتير مع السعر، اعمل trailing stop أضيق"
                watch_for = [
                    "حجم نزل تحت 50% من المتوسط مع هبوط السعر",
                    "السهم عمل قمة أقل من اللي قبلها",
                    f"القطاع ({'قوي' if sector_momentum > 0 else 'ضعيف'})",
                ]
            elif making_higher_lows:
                reason = "السهم بيعمل قيعان أعلى — ترند صاعد سليم"
                next_step = "انتظر اختراق القمة الأخيرة لزيادة المركز"
                watch_for = [
                    "اختراق أعلى قمة بأكثر من المتوسط حجم",
                    "كسر آخر قاع صاعد",
                ]
            else:
                reason = "السهم في تجميع قبل حركة — امسك"
                next_step = "انتظر اختراق بحجم عالي"
                watch_for = [
                    "حجم فجر أكتر من 2× المتوسط",
                    "اختراق مقاومة",
                ]
        else:
            if not volume_confirming and pct_from_high > 5:
                reason = "الحجم نزل والسهم بعد عن القمة — زخم ميت"
                next_step = "فكر في جني أرباح جزئي أو تضييق الـ trailing stop"
                watch_for = [
                    "حجم رجع مع ارتفاع السعر (إشارة تجديد)",
                    "السهم رجع للقمة",
                ]
            elif pct_from_high > 10:
                reason = "السهم بعد أكتر من 10% عن القمة — خطر انعكاس"
                next_step = "ضيّق الـ trailing stop وقرب وقف الخسارة"
                watch_for = [
                    "السهم كسر متوسط 20 يوم",
                    "حجم بيع عالي",
                ]
            else:
                reason = "مفيش اتجاه واضح — راقب"
                next_step = "لا تبيع ولا تزيد — انتظر وضوح"
                watch_for = [
                    "اتجاه حجم واضح",
                    "اختراق أو كسر مستويات مهمة",
                ]
        
        return ContinuationAnalysis(
            is_continuing=is_continuing,
            making_higher_highs=making_higher_highs,
            making_higher_lows=making_higher_lows,
            volume_confirming=volume_confirming,
            momentum_alive=momentum_alive,
            days_since_last_high=days_since_last_high,
            volume_trend=volume_trend,
            price_vs_vwap=price_vs_vwap,
            confidence=confidence,
            reason=reason,
            next_step=next_step,
            watch_for=watch_for,
        )
    
    # ========================================================================
    # 2. تحليل مسار السهم — إيه اللي جاي؟
    # ========================================================================
    
    def analyze_trajectory(
        self,
        current_price: float,
        entry_price: float,
        atr: float,
        recent_highs: List[float],
        recent_lows: List[float],
        recent_volumes: List[float],
        avg_volume_20: float,
        sma_20: Optional[float] = None,
        sma_50: Optional[float] = None,
        sma_200: Optional[float] = None,
        sector_momentum: float = 0.0,
        market_regime: str = "neutral",
        rsi_14: Optional[float] = None,
    ) -> TrajectoryAnalysis:
        """
        تحليل مسار السهم: إيه اللي متوقع؟
        
        بيعطي المستخدم صورة كاملة:
        - المسار الحالي
        - الحركة المتوقعة
        - المستويات المهمة
        - المحفزات والمخاطر
        - نصيحة مفصلة
        """
        
        gain_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
        atr_pct = (atr / current_price) * 100 if current_price > 0 else 2.0
        
        # --- تحديد المسار ---
        making_higher_highs = len(recent_highs) >= 3 and recent_highs[0] > recent_highs[1] > recent_highs[2]
        making_higher_lows = len(recent_lows) >= 3 and recent_lows[0] > recent_lows[1] > recent_lows[2]
        volume_rising = len(recent_volumes) >= 10 and sum(recent_volumes[:5]) > sum(recent_volumes[5:10]) * 1.2
        
        above_sma20 = sma_20 is not None and current_price > sma_20
        above_sma50 = sma_50 is not None and current_price > sma_50
        above_sma200 = sma_200 is not None and current_price > sma_200
        
        # تصنيف المسار
        if making_higher_highs and making_higher_lows and volume_rising:
            trajectory = TrajectoryType.STRONG_UPTREND
            trajectory_strength = 0.9
        elif making_higher_highs and above_sma20:
            trajectory = TrajectoryType.UPTREND
            trajectory_strength = 0.7
        elif making_higher_lows and not making_higher_highs:
            trajectory = TrajectoryType.CONSOLIDATION
            trajectory_strength = 0.5
        elif above_sma20 and not making_higher_highs:
            trajectory = TrajectoryType.WEAKENING
            trajectory_strength = 0.3
        elif not above_sma20 and above_sma50:
            trajectory = TrajectoryType.DISTRIBUTION
            trajectory_strength = 0.4
        elif not above_sma50:
            trajectory = TrajectoryType.DOWNTREND
            trajectory_strength = 0.2
        else:
            trajectory = TrajectoryType.CONSOLIDATION
            trajectory_strength = 0.4
        
        # لو RSI > 80 أو < 20 — تعديل
        if rsi_14 is not None:
            if rsi_14 > 80 and trajectory in (TrajectoryType.STRONG_UPTREND, TrajectoryType.UPTREND):
                trajectory = TrajectoryType.REVERSAL_RISK
                trajectory_strength = 0.6
        
        # --- الحركة المتوقعة ---
        if trajectory == TrajectoryType.STRONG_UPTREND:
            expected_move = atr_pct * 3  # 3 ATR
            time_horizon = 15
        elif trajectory == TrajectoryType.UPTREND:
            expected_move = atr_pct * 2
            time_horizon = 10
        elif trajectory == TrajectoryType.CONSOLIDATION:
            expected_move = atr_pct * 1
            time_horizon = 20
        else:
            expected_move = -atr_pct * 2
            time_horizon = 5
        
        # --- المستويات المهمة ---
        key_levels = {}
        if recent_highs:
            key_levels["مقاومة_1"] = max(recent_highs[:3]) if len(recent_highs) >= 3 else recent_highs[0]
            key_levels["اختراق_هدف"] = key_levels["مقاومة_1"] * (1 + atr_pct / 100)
        if recent_lows:
            key_levels["دعم_1"] = min(recent_lows[:3]) if len(recent_lows) >= 3 else recent_lows[0]
            key_levels["كسر_خطر"] = key_levels["دعم_1"] * (1 - atr_pct / 100)
        if sma_20: key_levels["SMA_20"] = sma_20
        if sma_50: key_levels["SMA_50"] = sma_50
        if sma_200: key_levels["SMA_200"] = sma_200
        
        # --- المحفزات والمخاطر ---
        catalysts = []
        risks = []
        
        if sector_momentum > 0.5:
            catalysts.append("سيولة جارية في القطاع")
        if market_regime == "bull":
            catalysts.append("سوق صاعد عام")
        if making_higher_highs and volume_rising:
            catalysts.append("اختراق بحجم عالي")
        
        if sector_momentum < -0.3:
            risks.append("سيولة بتخرج من القطاع")
        if market_regime in ("bear", "bear_trend"):
            risks.append("سوق هابط")
        if rsi_14 is not None and rsi_14 > 75:
            risks.append("RSI مرتفع — تشبع شرائي")
        if not above_sma20:
            risks.append("تحت SMA 20 — ضعف تقني")
        
        # --- النصيحة ---
        if trajectory == TrajectoryType.STRONG_UPTREND:
            advice = f"🟢 السهم في ترند صاعد قوي — امسك واتابع الـ trailing stop. متوقع +{expected_move:.1f}% خلال {time_horizon} يوم. اختراق {key_levels.get('اختراق_هدف', 0):.2f} يفتح هدف أعلى."
        elif trajectory == TrajectoryType.UPTREND:
            advice = f"🟡 ترند صاعد بس مش قوي — امسك بس ضيّق الـ trailing stop. متوقع +{expected_move:.1f}% خلال {time_horizon} يوم."
        elif trajectory == TrajectoryType.CONSOLIDATION:
            advice = f"⏳ السهم بيتجمع — لو فوق SMA 20 امسك، لو تحتها كن حذر. انتظر اختراق {key_levels.get('مقاومة_1', 0):.2f} بحجم."
        elif trajectory == TrajectoryType.WEAKENING:
            advice = f"🟠 الزخم بيضعف — فكر في جني أرباح جزئي (30-50%). لو السعر تحت SMA 20 = خطر."
        elif trajectory == TrajectoryType.DISTRIBUTION:
            advice = f"🔴 الحيتان بيوزعوا (بيع خفي) — قيّم الخروج. كسر {key_levels.get('دعم_1', 0):.2f} = خروج."
        elif trajectory == TrajectoryType.REVERSAL_RISK:
            advice = f"🔴⚠️ خطر انعكاس! RSI مرتفع والسهم بعد عن القمة. ضيّق الـ stop وجني أرباح."
        else:
            advice = f"🔻 ترند نازل — ممنع الدخول. لو داخل، قيّم الخروج على {key_levels.get('دعم_1', 0):.2f}."
        
        confidence = trajectory_strength
        if sector_momentum > 0.3: confidence = min(1.0, confidence + 0.1)
        if market_regime == "bull": confidence = min(1.0, confidence + 0.1)
        
        return TrajectoryAnalysis(
            trajectory=trajectory,
            trajectory_strength=trajectory_strength,
            expected_move_pct=expected_move,
            time_horizon_days=time_horizon,
            key_levels=key_levels,
            catalysts=catalysts,
            risks=risks,
            advice=advice,
            confidence=confidence,
        )
    
    # ========================================================================
    # 3. حساب الأهداف الديناميكية — مش +10%/+20% ثابتة!
    # ========================================================================
    
    def compute_dynamic_targets(
        self,
        entry_price: float,
        atr: float,
        momentum_score: float = 50.0,      # 0-100
        sector_momentum: float = 0.0,       # -1 to +1
        market_regime: str = "neutral",
        stock_typical_move_15d: float = 5.0, # متوسط حركة السهم 15 يوم %
        is_breakout: bool = False,
        volume_ratio: float = 1.0,
    ) -> Dict[str, Any]:
        """
        حساب أهداف ديناميكية بناءً على:
        - ATR (تقلب السهم)
        - زخم السهم والقطاع والسوق
        - نمط السهم التاريخي
        - نوع الحركة (اختراق ولا عادي)
        
        بدل +10%/+20% ثابتة:
        - T1 = entry + 2×ATR (أو 1.5× typical_move)
        - T2 = entry + 4×ATR (أو 3× typical_move)
        - T3 = None (مفيش سقف — trailing stop يخرجنا)
        - لو اختراق بقوة: T1 و T2 أبعد
        """
        
        atr_pct = (atr / entry_price) * 100 if entry_price > 0 else 2.0
        
        # --- مضاعف ATR حسب الزخم ---
        if momentum_score >= 80 and is_breakout and volume_ratio >= 2.0:
            # اختراق قوي بقوة: أهداف أبعد
            t1_atr_mult = 3.0
            t2_atr_mult = 6.0
            t1_pct = max(atr_pct * t1_atr_mult, stock_typical_move_15d * 1.5)
            t2_pct = max(atr_pct * t2_atr_mult, stock_typical_move_15d * 3.0)
        elif momentum_score >= 60 and sector_momentum > 0.3:
            # زخم جيد + قطاع قوي
            t1_atr_mult = 2.5
            t2_atr_mult = 5.0
            t1_pct = max(atr_pct * t1_atr_mult, stock_typical_move_15d * 1.2)
            t2_pct = max(atr_pct * t2_atr_mult, stock_typical_move_15d * 2.5)
        elif momentum_score >= 40:
            # زخم متوسط
            t1_atr_mult = 2.0
            t2_atr_mult = 4.0
            t1_pct = max(atr_pct * t1_atr_mult, stock_typical_move_15d * 1.0)
            t2_pct = max(atr_pct * t2_atr_mult, stock_typical_move_15d * 2.0)
        else:
            # زخم ضعيف: أهداف قريبة
            t1_atr_mult = 1.5
            t2_atr_mult = 3.0
            t1_pct = max(atr_pct * t1_atr_mult, stock_typical_move_15d * 0.8)
            t2_pct = max(atr_pct * t2_atr_mult, stock_typical_move_15d * 1.5)
        
        # --- سقف أدنى: T1 لا يقل عن 5% ---
        t1_pct = max(t1_pct, 5.0)
        t2_pct = max(t2_pct, t1_pct * 1.5)
        
        # --- الأهداف ---
        target_1 = entry_price * (1 + t1_pct / 100)
        target_2 = entry_price * (1 + t2_pct / 100)
        target_3 = None  # مفيش سقف — trailing stop يخرجنا
        
        # --- T1 exit fraction: لو زخم قوي، نبيع أقل عند T1 ---
        if momentum_score >= 70 and is_breakout:
            t1_exit_fraction = 0.25  # نبيع 25% بس عند T1 — الباقي يكمل
        elif momentum_score >= 50:
            t1_exit_fraction = 0.30  # 30%
        else:
            t1_exit_fraction = 0.50  # 50% (محافظ)
        
        # --- Trailing stop activation ---
        # لو زخم قوي: نشط الـ trailing متأخر (عشان مطلعش بدري)
        if momentum_score >= 70 and volume_ratio >= 1.5:
            trailing_activation_pct = t1_pct * 0.8  # نشط بعد 80% من T1
        else:
            trailing_activation_pct = max(3.0, atr_pct * 1.5)  # الأدنى 3%
        
        return {
            "target_1": target_1,
            "target_2": target_2,
            "target_3": target_3,
            "t1_pct": round(t1_pct, 1),
            "t2_pct": round(t2_pct, 1),
            "t1_exit_fraction": t1_exit_fraction,
            "trailing_activation_pct": trailing_activation_pct,
            "atr_pct": round(atr_pct, 1),
            "momentum_score": momentum_score,
            "is_dynamic": True,
            "reason": self._explain_targets(t1_pct, t2_pct, momentum_score, is_breakout, volume_ratio),
        }
    
    def _explain_targets(
        self,
        t1_pct: float,
        t2_pct: float,
        momentum_score: float,
        is_breakout: bool,
        volume_ratio: float,
    ) -> str:
        """شرح عربي ليه الأهداف كدة"""
        parts = []
        if momentum_score >= 80 and is_breakout:
            parts.append("اختراق قوي بقوة → أهداف بعيدة المدى")
        elif momentum_score >= 60:
            parts.append("زخم جيد → أهداف متوسطة-بعيدة")
        else:
            parts.append("زخم متوسط/ضعيف → أهداف قريبة")
        
        if volume_ratio >= 2.0:
            parts.append("حجم تأكيد عالي")
        
        parts.append(f"T1={t1_pct:.1f}%, T2={t2_pct:.1f}%")
        return " | ".join(parts)
    
    # ========================================================================
    # 4. القرار النهائي — نمشي ولا نمسك؟
    # ========================================================================
    
    def decide(
        self,
        current_price: float,
        entry_price: float,
        highest_price: float,
        atr: float,
        recent_highs: List[float],
        recent_lows: List[float],
        recent_volumes: List[float],
        avg_volume_20: float,
        trailing_stop_price: Optional[float] = None,
        sma_20: Optional[float] = None,
        sma_50: Optional[float] = None,
        sma_200: Optional[float] = None,
        vwap: Optional[float] = None,
        rsi_14: Optional[float] = None,
        sector_momentum: float = 0.0,
        market_regime: str = "neutral",
        momentum_score: float = 50.0,
        is_breakout: bool = False,
        volume_ratio: float = 1.0,
        stock_typical_move_15d: float = 5.0,
        days_held: int = 0,
    ) -> SmartExitDecision:
        """
        القرار النهائي: نمشي ولا نمسك؟
        
        ده القرار اللي بيعمله "الخبير" مش "الآلة الحاسبة".
        بيفكر في:
        1. هل السهم لسه بيطير؟ (استمرار)
        2. إيه المسار المتوقع؟ (مستقبل)
        3. إيه الأهداف الذكية؟ (أرباح)
        4. إيه المخاطر؟ (حماية)
        """
        
        gain_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
        pct_from_high = ((highest_price - current_price) / highest_price) * 100 if highest_price > 0 else 0
        
        # --- تحليل الاستمرار ---
        continuation = self.analyze_continuation(
            current_price=current_price,
            entry_price=entry_price,
            highest_price=highest_price,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            vwap=vwap,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
        )
        
        # --- تحليل المسار ---
        trajectory = self.analyze_trajectory(
            current_price=current_price,
            entry_price=entry_price,
            atr=atr,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            sma_20=sma_20,
            sma_50=sma_50,
            sma_200=sma_200,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            rsi_14=rsi_14,
        )
        
        # --- الأهداف الديناميكية ---
        dynamic_targets = self.compute_dynamic_targets(
            entry_price=entry_price,
            atr=atr,
            momentum_score=momentum_score,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            stock_typical_move_15d=stock_typical_move_15d,
            is_breakout=is_breakout,
            volume_ratio=volume_ratio,
        )
        
        # ====================================================================
        # قرار الخروج
        # ====================================================================
        
        should_exit = False
        exit_reason = ExitReason.NO_EXIT
        exit_pct = 0.0
        exit_price_target = None
        
        # --- 1. Trailing stop وقع → خروج كامل ---
        if trailing_stop_price and current_price <= trailing_stop_price:
            should_exit = True
            exit_reason = ExitReason.TRAILING_STOP
            exit_pct = 1.0
            exit_price_target = trailing_stop_price
        
        # --- 2. الزخم مات → خروج جزئي أو كامل ---
        elif not continuation.momentum_alive and gain_pct > 5:
            if pct_from_high > 8 or not continuation.making_higher_lows:
                should_exit = True
                exit_reason = ExitReason.MOMENTUM_DEATH
                exit_pct = 0.75 if gain_pct > 15 else 1.0
                exit_price_target = current_price
            else:
                # زخم ضعف بس لسه في أمل — جني جزئي
                should_exit = True
                exit_reason = ExitReason.SCALE_OUT_PARTIAL
                exit_pct = 0.30
                exit_price_target = current_price
        
        # --- 3. السوق اتغير → خروج ---
        elif market_regime in ("bear", "bear_trend", "crash") and gain_pct > 0:
            should_exit = True
            exit_reason = ExitReason.REGIME_CHANGE
            exit_pct = 0.75
            exit_price_target = current_price
        
        # --- 4. كسر دعم مهم → خروج ---
        elif sma_20 and current_price < sma_20 * 0.97 and gain_pct < 10:
            should_exit = True
            exit_reason = ExitReason.BREAKDOWN
            exit_pct = 1.0
            exit_price_target = current_price
        
        # --- 5. هدف ذكي — جني جزئي عند T1 ---
        elif gain_pct >= dynamic_targets["t1_pct"] and continuation.is_continuing:
            should_exit = True
            exit_reason = ExitReason.TARGET_SMART
            exit_pct = dynamic_targets["t1_exit_fraction"]
            exit_price_target = dynamic_targets["target_1"]
        
        # --- لو لسه بيطير → امسك ---
        elif continuation.is_continuing:
            should_exit = False
            exit_reason = ExitReason.HOLD_THROUGH
        
        # --- الرسالة النهائية ---
        if should_exit:
            if exit_pct >= 1.0:
                action = "خروج كامل"
            elif exit_pct >= 0.5:
                action = f"جني أرباح {exit_pct*100:.0f}% من المركز"
            else:
                action = f"جني أرباح جزئي {exit_pct*100:.0f}%"
            message = f"{'🟢' if gain_pct > 0 else '🔴'} {action}: {exit_reason.value} | ربح: {gain_pct:.1f}% | {continuation.reason}"
        else:
            message = f"⏳ امسك: {continuation.reason} | ربح حالي: {gain_pct:.1f}% | {trajectory.advice}"
        
        return SmartExitDecision(
            should_exit=should_exit,
            exit_reason=exit_reason,
            exit_pct=exit_pct,
            exit_price_target=exit_price_target,
            continuation=continuation,
            trajectory=trajectory,
            dynamic_targets=dynamic_targets,
            message=message,
        )

    # ========================================================================
    # 5. قياس استمرار الحركة — Continuation Metrics (P41 Morning Bell)
    # ========================================================================

    def compute_continuation_metrics(
        self,
        current_price: float,
        entry_price: float,
        highest_price: float,
        recent_highs: List[float],
        recent_lows: List[float],
        recent_volumes: List[float],
        avg_volume_20: float,
        atr: float,
        rvol: float = 1.0,
        vwap: Optional[float] = None,
        sector_momentum: float = 0.0,
        market_regime: str = "neutral",
        rsi_14: Optional[float] = None,
        sma_20: Optional[float] = None,
    ) -> Dict[str, Any]:
        """قياس استمرار الحركة — هل السهم مكمل / بيضعف / خلص؟

        بيرجّع الحقول الإلزامية لجرس الصباح وخطة الخروج:
        - continuation_state: continuing | weakening | exhausted
        - prob_continue_up / prob_mild_pullback / prob_sharp_drop (مجموع = 1.0)
        - suggested_tp1 / suggested_tp2 / suggested_stop (متحركة مع السعر)
        - risk_flag: elevated | extreme_north
        - client_responsibility_required: True دائماً (جرس الصباح = مخاطر عالية)
        - confidence + reason_ar

        بيعتمد على:
        - analyze_continuation() (قمم/قيعان/حجم)
        - analyze_trajectory() (المسار + RSI)
        - compute_dynamic_targets() (TP1/TP2 ديناميكي)
        """
        # --- التحليلات الأساسية (إعادة استخدام المنطق الموجود) ---
        continuation = self.analyze_continuation(
            current_price=current_price,
            entry_price=entry_price,
            highest_price=highest_price,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            vwap=vwap,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
        )

        trajectory = self.analyze_trajectory(
            current_price=current_price,
            entry_price=entry_price,
            atr=atr,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            sma_20=sma_20,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            rsi_14=rsi_14,
        )

        # --- الأهداف الديناميكية ---
        momentum_score = 50.0
        if continuation.momentum_alive:
            momentum_score = 70.0
        if continuation.making_higher_highs and continuation.volume_confirming:
            momentum_score = 85.0

        is_breakout = (
            highest_price > 0
            and current_price >= highest_price * 0.99
            and rvol >= 1.5
        )

        dynamic_targets = self.compute_dynamic_targets(
            entry_price=entry_price,
            atr=atr,
            momentum_score=momentum_score,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            is_breakout=is_breakout,
            volume_ratio=rvol,
        )

        # --- 1. continuation_state ---
        traj = trajectory.trajectory
        if continuation.momentum_alive and traj in (
            TrajectoryType.STRONG_UPTREND,
            TrajectoryType.UPTREND,
        ):
            state = "continuing"
        elif continuation.is_continuing or traj == TrajectoryType.CONSOLIDATION:
            state = "weakening"
        else:
            # DISTRIBUTION / DOWNTREND / REVERSAL_RISK / WEAKENING
            state = "exhausted"

        # --- 2. الاحتمالات الثلاثة (prob_continue_up / mild_pullback / sharp_drop) ---
        # قاعدة 0.40 + مكافآت/عقوبات
        p_up = 0.40
        if continuation.making_higher_highs:
            p_up += 0.15
        if continuation.making_higher_lows:
            p_up += 0.08
        if continuation.volume_confirming:
            p_up += 0.10
        if continuation.price_vs_vwap == "above":
            p_up += 0.06
        if sector_momentum > 0.3:
            p_up += 0.06
        if market_regime == "bull":
            p_up += 0.05
        if rvol >= 2.0:
            p_up += 0.05
        elif rvol < 0.8:
            p_up -= 0.10  # حجم ضعيف = ضعف

        # عقوبات
        if rsi_14 is not None and rsi_14 > 78:
            p_up -= 0.20  # تشبع شرائي قوي
        elif rsi_14 is not None and rsi_14 > 70:
            p_up -= 0.08

        # المسافة من القمة
        pct_from_high = 0.0
        if highest_price > 0:
            pct_from_high = ((highest_price - current_price) / highest_price) * 100
        if pct_from_high > 8:
            p_up -= 0.15
        elif pct_from_high > 5:
            p_up -= 0.08

        # قيود
        p_up = max(0.10, min(0.85, p_up))
        remaining = 1.0 - p_up
        # لو exhausted → اقلب نحو الهبوط
        if state == "exhausted":
            p_sharp = remaining * 0.65
            p_mild = remaining * 0.35
        elif state == "weakening":
            p_mild = remaining * 0.65
            p_sharp = remaining * 0.35
        else:  # continuing
            p_mild = remaining * 0.75
            p_sharp = remaining * 0.25

        # --- 3. risk_flag ---
        is_extreme = (
            (rsi_14 is not None and rsi_14 > 78)
            or rvol >= 3.0
            or pct_from_high > 8
            or trajectory.trajectory == TrajectoryType.REVERSAL_RISK
        )
        risk_flag = "extreme_north" if is_extreme else "elevated"

        # --- 4. suggested TP/Stop متحركة ---
        suggested_tp1 = dynamic_targets["target_1"]
        suggested_tp2 = dynamic_targets["target_2"]
        # الوقف المتحرك: max(وقف ATR, entry - atr_stop_min) ويرتفع مع السعر
        atr_pct = (atr / current_price) * 100 if current_price > 0 else 2.0
        # الوقف تحت السعر الحالي بمسافة ATR (متحرك للأعلى)
        trailing_stop = current_price * (1 - min(max(atr_pct, 3.0), 9.0) / 100)
        # لا ينزل تحت entry (breakeven floor) لو ربحان
        if current_price > entry_price:
            trailing_stop = max(trailing_stop, entry_price)
        suggested_stop = round(trailing_stop, 4)

        # --- 5. reason_ar ---
        if state == "continuing":
            reason_ar = "الحركة مستمرة — قمم أعلى بحجم مؤكد. امسك واتابع الوقف المتحرك."
        elif state == "weakening":
            reason_ar = "الزخم يضعف — الحجم تراجع أو السعر ابتعد عن القمة. قيّم جني أرباح جزئي."
        else:
            reason_ar = "الحركة انتهت — خطر انعكاس. ضيّق الوقف واخرج عند أي كسر هيكلي."

        return {
            "continuation_state": state,
            "prob_continue_up": round(p_up, 3),
            "prob_mild_pullback": round(p_mild, 3),
            "prob_sharp_drop": round(p_sharp, 3),
            "suggested_tp1": round(suggested_tp1, 4),
            "suggested_tp2": round(suggested_tp2, 4),
            "suggested_stop": suggested_stop,
            "risk_flag": risk_flag,
            "client_responsibility_required": True,
            "confidence": round(continuation.confidence, 3),
            "momentum_alive": continuation.momentum_alive,
            "making_higher_highs": continuation.making_higher_highs,
            "volume_confirming": continuation.volume_confirming,
            "rvol": round(rvol, 2),
            "atr_pct": round(atr_pct, 2),
            "pct_from_high": round(pct_from_high, 2),
            "trajectory": traj.value,
            "reason_ar": reason_ar,
            "dynamic_targets": dynamic_targets,
        }

    # ========================================================================
    # 6. محرك الخروج اللحظي — EXIT / TAKE_PROFIT / REDUCE / HOLD
    # ========================================================================

    def decide_exit_action(
        self,
        current_price: float,
        entry_price: float,
        highest_price: float,
        atr: float,
        recent_highs: List[float],
        recent_lows: List[float],
        recent_volumes: List[float],
        avg_volume_20: float,
        client_stop: Optional[float] = None,
        trailing_stop_price: Optional[float] = None,
        tp1: Optional[float] = None,
        tp2: Optional[float] = None,
        sma_20: Optional[float] = None,
        vwap: Optional[float] = None,
        rsi_14: Optional[float] = None,
        sector_momentum: float = 0.0,
        market_regime: str = "neutral",
        rvol: float = 1.0,
        days_held: int = 0,
    ) -> Dict[str, Any]:
        """محرك الخروج اللحظي — EXIT / TAKE_PROFIT / REDUCE / HOLD

        بيعمل على المراكز المفتوحة / التوصيات النشطة أثناء الجلسة.
        بيستخدم decide() الأساسي + continuation metrics + يرجّع الإجراء المناسب.

        Returns:
            action: EXIT | TAKE_PROFIT | REDUCE | HOLD
            reason_code: كود مختصر (STOP_BROKEN, TP1_HIT, WEAKENING, ...)
            reason_ar: نص عربي مختصر
            new_stop / new_tp: الوقف/الهدف الجديد (لو اتغيّروا)
            exit_pct: نسبة الخروج (0.0-1.0)
            confidence: ثقة القرار
            continuation: metrics الاستمرار الكاملة
        """
        # --- الوقف الفعال: وقف العميل لو موجود، وإلا الوقف المتحرك ---
        effective_stop = client_stop or trailing_stop_price

        # --- القرار الأساسي (من decide الموجود) ---
        decision = self.decide(
            current_price=current_price,
            entry_price=entry_price,
            highest_price=highest_price,
            atr=atr,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            trailing_stop_price=effective_stop,
            sma_20=sma_20,
            vwap=vwap,
            rsi_14=rsi_14,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            volume_ratio=rvol,
            days_held=days_held,
        )

        # --- metrics الاستمرار ---
        metrics = self.compute_continuation_metrics(
            current_price=current_price,
            entry_price=entry_price,
            highest_price=highest_price,
            recent_highs=recent_highs,
            recent_lows=recent_lows,
            recent_volumes=recent_volumes,
            avg_volume_20=avg_volume_20,
            atr=atr,
            rvol=rvol,
            vwap=vwap,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            rsi_14=rsi_14,
            sma_20=sma_20,
        )

        gain_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
        reason = decision.exit_reason
        state = metrics["continuation_state"]

        # --- خرائط القرار → إجراء + كود + نص ---
        action = "HOLD"
        reason_code = "TREND_INTACT"
        reason_ar = "الاتجاه والهيكل والحجم ما زالوا داعمين — امسك مع تحريك الوقف."
        new_stop: Optional[float] = None
        new_tp: Optional[float] = None
        exit_pct = 0.0

        # 1. كسر الوقف → EXIT كامل
        if effective_stop and current_price <= effective_stop:
            action = "EXIT"
            reason_code = "STOP_BROKEN"
            reason_ar = f"السعر كسر الوقف ({effective_stop:.2f}) — خروج كامل فوري."
            exit_pct = 1.0
            new_stop = None
            new_tp = None

        # 2. state=exhausted + انكسار هيكلي → EXIT
        elif state == "exhausted" and (
            reason in (ExitReason.BREAKDOWN, ExitReason.MOMENTUM_DEATH)
            and decision.should_exit
            and decision.exit_pct >= 0.75
        ):
            action = "EXIT"
            reason_code = "EXHAUSTED_BREAK"
            reason_ar = "الحركة انتهت مع انكسار هيكلي — خروج كامل."
            exit_pct = 1.0
            new_stop = None
            new_tp = None

        # 3. انعكاس حاد مع RVOL عالي ضد الصفقة → EXIT
        elif rvol >= 2.0 and current_price < entry_price and gain_pct < -2:
            action = "EXIT"
            reason_code = "SHARP_REVERSAL"
            reason_ar = f"انعكاس حاد بحجم عالي (RVOL={rvol:.1f}) ضد الصفقة — خروج كامل."
            exit_pct = 1.0
            new_stop = None
            new_tp = None

        # 4. لمس TP1 → TAKE_PROFIT جزئي + رفع الوقف
        elif tp1 and current_price >= tp1:
            action = "TAKE_PROFIT"
            reason_code = "TP1_HIT"
            reason_ar = f"لمس TP1 ({tp1:.2f}) — جني جزئي + رفع وقف المتبقي للدخول."
            exit_pct = decision.exit_pct if decision.exit_pct > 0 else 0.30
            new_stop = entry_price  # breakeven floor
            new_tp = tp2  # الهدف التالي

        # 5. لمس TP2 → TAKE_PROFIT كلي/غالبية
        elif tp2 and current_price >= tp2:
            action = "TAKE_PROFIT"
            reason_code = "TP2_HIT"
            reason_ar = f"لمس TP2 ({tp2:.2f}) — جني كلي أو تأمين غالبية المركز."
            exit_pct = 0.80
            new_stop = tp1 or entry_price
            new_tp = None

        # 6. امتداد مفرط مع ضعف حجم → TAKE_PROFIT أسرع
        elif gain_pct > 15 and not metrics["volume_confirming"]:
            action = "TAKE_PROFIT"
            reason_code = "OVEREXTENDED_LOW_VOL"
            reason_ar = f"امتداد مفرط ({gain_pct:.1f}%) مع ضعف حجم — جني أسرع."
            exit_pct = 0.50
            new_stop = max(entry_price, current_price * 0.97)
            new_tp = None

        # 7. REDUCE: مخاطر ارتفعت لكن لم يُكسر الوقف
        elif state == "weakening" and reason == ExitReason.SCALE_OUT_PARTIAL:
            action = "REDUCE"
            reason_code = "WEAKENING"
            reason_ar = "الزخم يضعف لكن الهيكل سليم — تقليل مركز جزئي."
            exit_pct = 0.30
            new_stop = max(effective_stop or entry_price, current_price * 0.97)
            new_tp = tp1

        # 8. REDUCE: regime change
        elif reason == ExitReason.REGIME_CHANGE:
            action = "REDUCE"
            reason_code = "REGIME_SHIFT"
            reason_ar = "السوق تغيّر (bull→bear) — تقليل تعرض."
            exit_pct = 0.50
            new_stop = max(effective_stop or entry_price, current_price * 0.96)
            new_tp = None

        # 9. HOLD: الاتجاه سليم
        else:
            action = "HOLD"
            reason_code = "TREND_INTACT"
            reason_ar = "الاتجاه والهيكل والحجم ما زالوا داعمين — امسك مع تحريك الوقف."
            exit_pct = 0.0
            # تحريك الوقف للأعلى مع السعر
            if current_price > entry_price:
                new_stop = metrics["suggested_stop"]
            new_tp = metrics["suggested_tp2"]

        return {
            "action": action,
            "reason_code": reason_code,
            "reason_ar": reason_ar,
            "new_stop": round(new_stop, 4) if new_stop else None,
            "new_tp": round(new_tp, 4) if new_tp else None,
            "exit_pct": round(exit_pct, 3),
            "current_gain_pct": round(gain_pct, 2),
            "confidence": round(decision.continuation.confidence, 3),
            "exit_reason": reason.value,
            "continuation": metrics,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


# ============================================================================
# ماسح زخم القطاعات — Sector Momentum Scanner
# ============================================================================

@dataclass
class SectorMomentum:
    """زخم قطاع واحد"""
    sector: str
    avg_change_1d: float
    avg_change_5d: float
    avg_change_20d: float
    turnover_trend: str           # 'flowing_in', 'flowing_out', 'stable'
    rising_ratio: float           # نسبة الأسهم الصاعدة
    momentum_score: float         # -1 لـ +1
    liquidity_grade: str          # 'A', 'B', 'C', 'D', 'F'
    top_stocks: List[str]         # أقوى 3 أسهم
    status: str                   # 'hot', 'warming', 'neutral', 'cooling', 'dead'


class SectorMomentumScanner:
    """
    ماسح زخم القطاعات
    
    بيكتشف:
    - السيولة بتجرى أنهي قطاع
    - القطاعات اللي بتسخن (قبل ما الأسهم تفجر)
    - دوران القطاعات (money rotation)
    - القطاعات الميتة (تجنب)
    """
    
    def __init__(self, db_path: str = "db/stocks.db"):
        self.db_path = db_path
    
    def scan_all_sectors(self) -> Dict[str, SectorMomentum]:
        """
        مسح كل القطاعات وإعطاء نتيجة مفصلة
        """
        import sqlite3
        result = {}
        
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            conn.row_factory = sqlite3.Row
            
            # جيب كل القطاعات مع أسهمها
            sectors = conn.execute("""
                SELECT sector, COUNT(*) as cnt,
                       AVG(change_percent) as avg_1d
                FROM stocks
                WHERE sector IS NOT NULL AND sector != ''
                GROUP BY sector
                HAVING cnt >= 3
                ORDER BY avg_1d DESC
            """).fetchall()
            
            for s in sectors:
                sector_name = s['sector']
                
                # عدد الصاعدة والنازلة
                rising = conn.execute("""
                    SELECT COUNT(*) as cnt FROM stocks
                    WHERE sector = ? AND change_percent > 0
                """, (sector_name,)).fetchone()['cnt']
                
                total = s['cnt']
                rising_ratio = rising / total if total > 0 else 0
                
                # اتجاه السيولة (turnover trend)
                # لو change_percent > 0 and volume مرتفع = سيولة جارية
                high_volume = conn.execute("""
                    SELECT COUNT(*) as cnt FROM stocks
                    WHERE sector = ? AND volume > (SELECT AVG(volume) FROM stocks WHERE volume > 0)
                """, (sector_name,)).fetchone()['cnt']
                
                if high_volume >= total * 0.4 and s['avg_1d'] > 0:
                    turnover_trend = "flowing_in"
                elif high_volume < total * 0.15 and s['avg_1d'] < -0.5:
                    turnover_trend = "flowing_out"
                else:
                    turnover_trend = "stable"
                
                # زخم القطاع (-1 لـ +1)
                momentum_score = 0.0
                if s['avg_1d'] is not None:
                    momentum_score += max(-0.3, min(0.3, s['avg_1d'] / 10))
                momentum_score += (rising_ratio - 0.5) * 0.4
                if turnover_trend == "flowing_in":
                    momentum_score += 0.3
                elif turnover_trend == "flowing_out":
                    momentum_score -= 0.3
                momentum_score = max(-1.0, min(1.0, momentum_score))
                
                # درجة السيولة
                if momentum_score > 0.5 and turnover_trend == "flowing_in":
                    liquidity_grade = "A"
                elif momentum_score > 0.2:
                    liquidity_grade = "B"
                elif momentum_score > -0.2:
                    liquidity_grade = "C"
                elif momentum_score > -0.5:
                    liquidity_grade = "D"
                else:
                    liquidity_grade = "F"
                
                # أقوى 3 أسهم
                top_stocks_rows = conn.execute("""
                    SELECT ticker FROM stocks
                    WHERE sector = ? AND change_percent IS NOT NULL
                    ORDER BY change_percent DESC
                    LIMIT 3
                """, (sector_name,)).fetchall()
                top_stocks = [r['ticker'] for r in top_stocks_rows]
                
                # حالة القطاع
                if momentum_score > 0.4 and turnover_trend == "flowing_in":
                    status = "hot"
                elif momentum_score > 0.2:
                    status = "warming"
                elif momentum_score > -0.2:
                    status = "neutral"
                elif momentum_score > -0.4:
                    status = "cooling"
                else:
                    status = "dead"
                
                result[sector_name] = SectorMomentum(
                    sector=sector_name,
                    avg_change_1d=float(s['avg_1d'] or 0),
                    avg_change_5d=float(s['avg_1d'] or 0),  # fallback to 1d
                    avg_change_20d=float(s['avg_1d'] or 0),  # fallback to 1d
                    turnover_trend=turnover_trend,
                    rising_ratio=round(rising_ratio, 2),
                    momentum_score=round(momentum_score, 2),
                    liquidity_grade=liquidity_grade,
                    top_stocks=top_stocks,
                    status=status,
                )
            
            conn.close()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"[SectorMomentumScanner] Error: {e}")
        
        return result
    
    def get_hot_sectors(self) -> List[SectorMomentum]:
        """القطاعات الساخنة — اللي فيها سيولة جارية"""
        all_sectors = self.scan_all_sectors()
        return sorted(
            [s for s in all_sectors.values() if s.status in ("hot", "warming")],
            key=lambda s: s.momentum_score,
            reverse=True,
        )
    
    def get_sector_opportunities(self) -> List[Dict[str, Any]]:
        """فرص استثمارية من القطاعات النشطة"""
        hot = self.get_hot_sectors()
        opportunities = []
        for sector in hot:
            for ticker in sector.top_stocks:
                opportunities.append({
                    "ticker": ticker,
                    "sector": sector.sector,
                    "sector_status": sector.status,
                    "sector_momentum": sector.momentum_score,
                    "sector_liquidity": sector.liquidity_grade,
                    "reason": f"قطاع {sector.sector} {sector.status} (زخم={sector.momentum_score:.1f}, سيولة={sector.liquidity_grade})",
                })
        return opportunities
