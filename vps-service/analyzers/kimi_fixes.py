"""
Kimi's Critical Fixes v2 - إصلاحات كيمى الحرجة
================================================

المشاكل اللى اكتشفها كيمى:
1. current_price = 0 لكل الأسهم ← بيانات غلط
2. 72% من التوقعات "شراء" ← مفيش "بيع" خالص
3. RSI 96 مع "BUY" ← شراء في قمة = خسارة
4. Risk/Reward 0.01 ← الخسارة أكتر من الربح 100 مرة
5. Stop Loss غير منطقي

الحلول:
1. رفض أي تحليل لو current_price <= 0
2. لو RSI > 70 → إشارة SELL/REDUCE إجبارياً
3. رفض أي توقعة لو R/R < 1.0
4. Stop Loss مبني على ATR مش نسبة ثابتة
5. توازن الإشارات

v2 Fix:
- الهدف لازم يكون أبعد من وقف الخسارة
- R/R دايماً >= 1.5

Author: دليل الاستثمار (Based on Kimi's Analysis)
Date: 2026-05-28
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import math

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr


# ============================================================================
# CRITICAL THRESHOLDS - عتبات حرجة
# ============================================================================

# RSI Thresholds
RSI_OVERBOUGHT = 70      # فوق كدة = تشبع شرائي = خطر
RSI_OVERSOLD = 30        # تحت كدة = تشبع بيعي = فرصة
RSI_EXTREME_HIGH = 85    # فوق كدة = خطر شديد = SELL إجباري
RSI_EXTREME_LOW = 20     # تحت كدة = فرصة قوية = BUY إجباري

# Risk/Reward
MIN_RISK_REWARD = 1.0    # أقل نسبة مقبولة (1:1)
GOOD_RISK_REWARD = 1.5   # نسبة جيدة
GREAT_RISK_REWARD = 2.0  # نسبة ممتازة

# Signal Distribution Targets (للتوازن)
SIGNAL_DISTRIBUTION = {
    'STRONG_BUY': 0.05,   # 5% من التوقعات
    'BUY': 0.15,          # 15%
    'ACCUMULATE': 0.20,   # 20%
    'HOLD': 0.30,         # 30%
    'REDUCE': 0.15,       # 15%
    'SELL': 0.10,         # 10%
    'STRONG_SELL': 0.05,  # 5%
}


# ============================================================================
# SIGNAL OVERRIDES - تجاوز الإشارات
# ============================================================================

def apply_rsi_override(rsi: float, current_signal: str, master_score: float) -> Tuple[str, float]:
    """
    تطبيق تجاوز RSI
    
    القاعدة: لو RSI > 70، لازم نبعت إشارة تخفيف/بيع
             لو RSI > 85، لازم نبعت إشارة بيع قوي
    
    Returns:
        Tuple[str, float]: (new_signal, score_adjustment)
    """
    if rsi <= 0 or rsi > 100:
        return current_signal, 0
    
    # Extreme overbought - FORCE SELL
    if rsi >= RSI_EXTREME_HIGH:
        if current_signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
            return 'SELL', -25  # تحويل لبيع + خصم نقاط
        elif current_signal == 'HOLD':
            return 'REDUCE', -15
    
    # Overbought - Warning zone
    elif rsi >= RSI_OVERBOUGHT:
        if current_signal in ['STRONG_BUY', 'BUY']:
            return 'REDUCE', -20  # تحويل لتخفيف
        elif current_signal == 'ACCUMULATE':
            return 'HOLD', -10
    
    # Extreme oversold - FORCE BUY
    elif rsi <= RSI_EXTREME_LOW:
        if current_signal in ['SELL', 'STRONG_SELL', 'REDUCE']:
            return 'BUY', 25  # تحويل لشراء
        elif current_signal == 'HOLD':
            return 'ACCUMULATE', 15
    
    # Oversold - Opportunity zone
    elif rsi <= RSI_OVERSOLD:
        if current_signal in ['SELL', 'STRONG_SELL']:
            return 'HOLD', 10
        elif current_signal == 'REDUCE':
            return 'HOLD', 5
    
    return current_signal, 0


def apply_risk_reward_override(rr: float, current_signal: str) -> Optional[str]:
    """
    تطبيق تجاوز Risk/Reward
    
    القاعدة: لو R/R < 1.0، التوقعة غير صالحة
    
    Returns:
        Optional[str]: None لو التوقعة مقبولة، أو إشارة مرفوضة
    """
    if rr < MIN_RISK_REWARD:
        # التوقعة غير صالحة - الربح أقل من المخاطرة
        if current_signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
            return 'REJECTED_RR'  # مرفوض بسبب R/R
    
    return None  # التوقعة مقبولة


# ============================================================================
# PROPER TARGET/STOP CALCULATION - حساب صحيح للهدف ووقف الخسارة
# ============================================================================

def calculate_proper_target_stop(
    entry_price: float,
    master_score: float = 50,
    volatility: float = 3.0,
    support: float = None,
    resistance: float = None
) -> Dict:
    """
    حساب الهدف ووقف الخسارة بشكل صحيح
    
    القاعدة الذهبية: الهدف لازم يكون أبعد من وقف الخسارة
    عشان كده الـ R/R يكون >= 1.5
    
    Args:
        entry_price: سعر الدخول
        master_score: النقاط (لتحديد قوة التوقعة)
        volatility: التذبذب (%)
        support: مستوى الدعم
        resistance: مستوى المقاومة
    
    Returns:
        Dict مع target_price, stop_loss_price, target_pct, stop_loss_pct, risk_reward
    """
    if entry_price <= 0:
        return {
            'target_price': 0,
            'target_pct': 10.0,
            'stop_loss_price': 0,
            'stop_loss_pct': 8.0,
            'risk_reward': 1.5,
            'risk_amount': 0,
            'reward_amount': 0
        }
    
    # Step 1: حساب وقف الخسارة بناءً على التذبذب
    # لو التذبذب عالي = وقف خسارة أوسع
    if volatility > 5:
        stop_pct = min(15.0, volatility * 2.5)
    elif volatility > 3:
        stop_pct = min(12.0, volatility * 2.0)
    else:
        stop_pct = max(5.0, volatility * 1.5)
    
    # لا تتجاوز 15% للوقف ولا تقل عن 5%
    stop_pct = min(15.0, max(5.0, stop_pct))
    
    # استخدام الدعم لو متاح وقريب
    if support and support > 0 and support < entry_price:
        support_pct = ((entry_price - support) / entry_price) * 100
        if support_pct > 2 and support_pct < stop_pct + 2:
            # الدعم قريب ومتاح - ضع الوقف تحت الدعم بقليل
            stop_pct = min(stop_pct, support_pct + 1)
    
    stop_loss_price = entry_price * (1 - stop_pct / 100)
    
    # Step 2: حساب الهدف
    # الهدف لازم يكون على الأقل 1.5 ضعف المخاطرة
    # يعني لو الخسارة 8% = الربح لازم يكون 12% على الأقل
    target_pct = stop_pct * 1.5  # R/R = 1.5
    
    # استخدام المقاومة لو متاحة
    if resistance and resistance > 0 and resistance > entry_price:
        resist_pct = ((resistance - entry_price) / entry_price) * 100
        if resist_pct > target_pct:
            # المقاومة أعلى = ممكن نزود الهدف
            target_pct = min(resist_pct, stop_pct * 3)  # لا تتجاوز 3x المخاطرة
    
    target_price = entry_price * (1 + target_pct / 100)
    
    # Step 3: حساب R/R الفعلي
    risk = entry_price - stop_loss_price
    reward = target_price - entry_price
    risk_reward = reward / risk if risk > 0 else 1.5
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        risk_reward = compute_risk_reward(entry_price, target_price, stop_loss_price, fallback=risk_reward)
    except Exception:
        pass  # keep inline risk_reward computed above

    # ضمان R/R >= 1.5
    if risk_reward < 1.5:
        # زود الهدف
        target_pct = stop_pct * 1.5
        target_price = entry_price * (1 + target_pct / 100)
        reward = target_price - entry_price
        risk_reward = reward / risk if risk > 0 else 1.5
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target_price, stop_loss_price, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above
    
    return {
        'target_price': round(target_price, 3),
        'target_pct': round(target_pct, 2),
        'stop_loss_price': round(stop_loss_price, 3),
        'stop_loss_pct': round(stop_pct, 2),
        'risk_reward': round(risk_reward, 2),
        'risk_amount': round(risk, 3),
        'reward_amount': round(reward, 3)
    }


def calculate_atr_stop_loss(
    prices: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
    period: int = 14,
    multiplier: float = 2.0
) -> Dict:
    """
    حساب وقف الخسارة بناءً على ATR (Average True Range)

    الطريقة دي أحسن من النسبة الثابتة لأنها بتاخد في الاعتبار:
    - تذبذب السهم
    - السيولة
    - ظروف السوق

    Returns:
        Dict: {
            'atr': float,
            'stop_loss_pct': float,
            'stop_loss_price': float,
            'volatility_level': str
        }

    BRAVO UNIFY: ATR calculation delegates to canonical
    analyzers.indicators.atr.calc_atr (Wilder's smoothing). Stop-loss logic
    (multiplier, caps, volatility level) is preserved unchanged.
    """
    if len(prices) < period + 1:
        # بيانات غير كافية - استخدم نسبة ثابتة محافظة
        return {
            'atr': 0,
            'stop_loss_pct': 8.0,  # 8% افتراضي
            'stop_loss_price': prices[-1] * 0.92 if prices else 0,
            'volatility_level': 'UNKNOWN'
        }

    # Delegate ATR to canonical calc_atr — handles Wilder's smoothing
    if highs and lows:
        atr = _canonical_calc_atr(highs, lows, prices, period=period) or 0.0
    else:
        # Use close prices only — pass closes for highs/lows (TR collapses to |Δclose|)
        atr = _canonical_calc_atr(prices, prices, prices, period=period) or 0.0

    current_price = prices[-1]

    # Calculate stop loss percentage
    if current_price > 0 and atr > 0:
        atr_pct = (atr / current_price) * 100
        stop_loss_pct = atr_pct * multiplier

        # Cap at reasonable limits (5% - 15%)
        stop_loss_pct = max(5.0, min(15.0, stop_loss_pct))
    else:
        stop_loss_pct = 8.0  # Default 8%

    # Determine volatility level
    if stop_loss_pct < 6:
        volatility_level = 'LOW'
    elif stop_loss_pct < 10:
        volatility_level = 'MEDIUM'
    elif stop_loss_pct < 13:
        volatility_level = 'HIGH'
    else:
        volatility_level = 'VERY_HIGH'

    return {
        'atr': round(atr, 4),
        'stop_loss_pct': round(stop_loss_pct, 2),
        'stop_loss_price': round(current_price * (1 - stop_loss_pct / 100), 2),
        'volatility_level': volatility_level
    }


def calculate_dynamic_target(
    entry_price: float,
    stop_loss_price: float,
    min_rr: float = 1.5
) -> Dict:
    """
    حساب الهدف الديناميكي
    
    الهدف لازم يكون على الأقل min_rr أضعاف المخاطرة
    
    Returns:
        Dict: {
            'target_price': float,
            'target_pct': float,
            'risk_reward': float,
            'risk_amount': float
        }
    """
    if entry_price <= 0 or stop_loss_price <= 0:
        return {
            'target_price': entry_price * 1.12 if entry_price > 0 else 0,
            'target_pct': 12.0,
            'risk_reward': 1.5,
            'risk_amount': 0
        }
    
    risk_amount = entry_price - stop_loss_price
    
    if risk_amount <= 0:
        # Stop loss above entry - invalid
        return {
            'target_price': entry_price * 1.12,
            'target_pct': 12.0,
            'risk_reward': 1.5,
            'risk_amount': 0
        }
    
    # Calculate target to achieve minimum R:R
    target_price = entry_price + (risk_amount * min_rr)
    target_pct = ((target_price - entry_price) / entry_price) * 100
    
    return {
        'target_price': round(target_price, 2),
        'target_pct': round(target_pct, 2),
        'risk_reward': min_rr,
        'risk_amount': round(risk_amount, 2)
    }


# ============================================================================
# SIGNAL VALIDATION - التحقق من صحة الإشارة
# ============================================================================

@dataclass
class SignalValidation:
    """نتيجة التحقق من الإشارة"""
    is_valid: bool
    signal: str
    signal_ar: str
    rejection_reason: Optional[str]
    rsi_override: bool
    rr_rejection: bool
    adjusted_score: float
    warnings: List[str]


def validate_and_adjust_signal(
    signal: str,
    master_score: float,
    rsi: float,
    current_price: float,
    stop_loss_price: float,
    target_price: float,
    entry_price: float = None
) -> SignalValidation:
    """
    التحقق من صحة الإشارة وتعديلها إذا لزم
    
    دي الدالة الرئيسية اللى بتتأكد إن التوقعة منطقية
    
    Steps:
    1. التحقق من السعر الحالي
    2. تطبيق تجاوز RSI
    3. حساب R/R
    4. رفض التوقعات غير المنطقية
    """
    warnings = []
    adjusted_score = master_score
    rsi_override = False
    rr_rejection = False
    rejection_reason = None
    
    # Step 1: Check current price
    if current_price <= 0:
        return SignalValidation(
            is_valid=False,
            signal='REJECTED',
            signal_ar='مرفوض',
            rejection_reason='السعر الحالي صفر أو سالب - بيانات غير صحيحة',
            rsi_override=False,
            rr_rejection=False,
            adjusted_score=0,
            warnings=['بيانات السعر غير متوفرة']
        )
    
    # Step 2: Apply RSI Override
    if rsi > 0:
        original_signal = signal
        signal, score_adj = apply_rsi_override(rsi, signal, master_score)
        adjusted_score += score_adj
        
        if signal != original_signal:
            rsi_override = True
            if rsi >= RSI_EXTREME_HIGH:
                warnings.append(f'⚠️ RSI {rsi:.1f} = تشبع شرائي قصوي - تم تحويل الإشارة لبيع')
            elif rsi >= RSI_OVERBOUGHT:
                warnings.append(f'⚠️ RSI {rsi:.1f} = تشبع شرائي - تم تعديل الإشارة')
    
    # Step 3: Calculate Risk/Reward
    entry = entry_price or current_price
    
    if stop_loss_price > 0 and target_price > 0:
        risk = entry - stop_loss_price
        reward = target_price - entry
        
        if risk > 0:
            rr = reward / risk
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                rr = compute_risk_reward(entry, target_price, stop_loss_price, fallback=rr)
            except Exception:
                pass  # keep inline rr computed above
        else:
            rr = 0
            warnings.append('⚠️ وقف الخسارة أعلى من سعر الدخول!')
    else:
        rr = 0
        warnings.append('⚠️ بيانات وقف الخسارة أو الهدف غير متوفرة')
    
    # Step 4: Reject if R/R is too low for BUY signals
    if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
        if rr < MIN_RISK_REWARD:
            rr_rejection = True
            rejection_reason = f'نسبة المخاطرة/العائد ({rr:.2f}) أقل من {MIN_RISK_REWARD}'
            
            return SignalValidation(
                is_valid=False,
                signal='REJECTED_RR',
                signal_ar='مرفوض - نسبة مخاطرة غير مقبولة',
                rejection_reason=rejection_reason,
                rsi_override=rsi_override,
                rr_rejection=True,
                adjusted_score=adjusted_score,
                warnings=warnings + [f'❌ R/R = {rr:.2f} غير مقبول (الحد الأدنى: {MIN_RISK_REWARD})']
            )
        elif rr < GOOD_RISK_REWARD:
            warnings.append(f'⚡ R/R = {rr:.2f} مقبول لكن ليس مثالي')
    
    # Get Arabic signal
    signal_ar = get_signal_arabic(signal)
    
    return SignalValidation(
        is_valid=True,
        signal=signal,
        signal_ar=signal_ar,
        rejection_reason=None,
        rsi_override=rsi_override,
        rr_rejection=rr_rejection,
        adjusted_score=max(0, min(100, adjusted_score)),
        warnings=warnings
    )


def get_signal_arabic(signal: str) -> str:
    """تحويل الإشارة للعربية"""
    translations = {
        'STRONG_BUY': 'شراء قوي',
        'BUY': 'شراء',
        'ACCUMULATE': 'تجميع',
        'HOLD': 'احتفاظ',
        'REDUCE': 'تخفيف',
        'SELL': 'بيع',
        'STRONG_SELL': 'بيع قوي',
        'REJECTED_RR': 'مرفوض - نسبة مخاطرة غير مقبولة',
        'REJECTED': 'مرفوض',
        'EXCLUDED': 'مستبعد',
        'INSUFFICIENT_DATA': 'بيانات غير كافية',
    }
    return translations.get(signal, signal)


# ============================================================================
# STATISTICS HELPER - مساعد الإحصائيات
# ============================================================================

def analyze_signal_distribution(signals: List[str]) -> Dict:
    """
    تحليل توزيع الإشارات
    
    بيظهر لو التوزيع متوازن ولا لأ
    """
    if not signals:
        return {'error': 'لا توجد إشارات'}
    
    total = len(signals)
    counts = {}
    
    for signal in signals:
        counts[signal] = counts.get(signal, 0) + 1
    
    # Calculate percentages
    distribution = {}
    for signal, count in counts.items():
        pct = (count / total) * 100
        target = SIGNAL_DISTRIBUTION.get(signal, 0) * 100
        deviation = abs(pct - target)
        
        distribution[signal] = {
            'count': count,
            'percentage': round(pct, 1),
            'target': round(target, 1),
            'deviation': round(deviation, 1),
            'status': '✅' if deviation < 5 else '⚠️' if deviation < 10 else '❌'
        }
    
    # Calculate balance score (0-100)
    total_deviation = sum(d['deviation'] for d in distribution.values())
    balance_score = max(0, 100 - total_deviation)
    
    return {
        'total_signals': total,
        'distribution': distribution,
        'balance_score': round(balance_score, 1),
        'is_balanced': balance_score >= 70
    }


# ============================================================================
# MAIN EXPORT
# ============================================================================

__all__ = [
    # Thresholds
    'RSI_OVERBOUGHT',
    'RSI_OVERSOLD',
    'RSI_EXTREME_HIGH',
    'RSI_EXTREME_LOW',
    'MIN_RISK_REWARD',
    'GOOD_RISK_REWARD',
    'GREAT_RISK_REWARD',
    
    # Functions
    'apply_rsi_override',
    'apply_risk_reward_override',
    'calculate_proper_target_stop',
    'calculate_atr_stop_loss',
    'calculate_dynamic_target',
    'validate_and_adjust_signal',
    'get_signal_arabic',
    'analyze_signal_distribution',
    
    # Classes
    'SignalValidation',
]
