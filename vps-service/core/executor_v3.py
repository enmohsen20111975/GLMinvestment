"""
executor_v3.py — المنفّذ المطور: يطبّق الأوزان فعليًا
=====================================================
يستقبل خطة من orchestrator_v3، يشغّل المحركات،
يطبّق الأوزان V1 على مخرجات منفصلة، يدمج النتائج.

الفرق عن executor.py القديم:
- يطبّق الأوزان على درجات المحركات المنفصلة
- يدمج flow_system + master_analyzer كمصدرين مستقلين
- يحسب Signal Score موزون + Confidence منفصل
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid, sys, os, logging

logger = logging.getLogger(__name__)

@dataclass
class V3Result:
    """نتيجة تنفيذ خطة V3."""
    execution_id: str = ""
    plan_id: str = ""
    started_at: str = ""
    completed_at: str = ""
    
    # Engine outputs (normalized -100 to +100)
    engine_scores: Dict[str, float] = field(default_factory=dict)  # family → normalized score
    engine_signals: Dict[str, str] = field(default_factory=dict)   # family → signal direction
    
    # Weighted combination
    signal_score: float = 0.0       # weighted average (-100 to +100)
    confidence: float = 50.0       # 0-100
    
    # Final decision
    final_signal: str = "NO_TRADE"
    risk_profile: Dict = field(default_factory=dict)
    position_size_pct: float = 5.0
    
    # Audit
    failed_engines: List[Dict] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=dict)
    complete: bool = False
    no_trade_reason: str = ""
    code_version: str = ""
    
    def __post_init__(self):
        if not self.execution_id:
            self.execution_id = str(uuid.uuid4())
        if not self.started_at:
            self.started_at = datetime.now().isoformat()


def execute_v3(plan, prices=None, volumes=None, ticker=None, market='EGX'):
    """ينفذ خطة V3 مع تطبيق الأوزان فعليًا."""
    result = V3Result(
        plan_id=plan.plan_id,
        code_version=os.environ.get('GIT_COMMIT', 'unknown'),
    )
    
    if plan.decision_policy == 'no_trade':
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = plan.no_trade_reason
        result.completed_at = datetime.now().isoformat()
        return result
    
    # Run engines per family and normalize scores
    family_scores = {}
    family_signals = {}
    
    for family, weight in plan.normalized_weights.items():
        if weight <= 0:
            continue
        
        try:
            score, signal = _run_family_engine(family, plan, prices, volumes, ticker, market)
            if score is not None:
                family_scores[family] = score
                family_signals[family] = signal
            else:
                result.failed_engines.append({'family': family, 'error': 'returned None'})
        except Exception as e:
            result.failed_engines.append({'family': family, 'error': str(e)})
            result.warnings.append(f'{family} failed: {e}')
    
    result.engine_scores = family_scores
    result.engine_signals = family_signals
    
    # Check minimum evidence coverage
    if len(family_scores) < 3:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = f'insufficient evidence: only {len(family_scores)} families'
        result.completed_at = datetime.now().isoformat()
        return result
    
    # Calculate weighted Signal Score
    weights = plan.normalized_weights
    total_weight = sum(weights.get(f, 0) for f in family_scores)
    if total_weight == 0:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = 'zero total weight'
        result.completed_at = datetime.now().isoformat()
        return result
    
    signal_score = sum(family_scores[f] * weights.get(f, 0) for f in family_scores) / total_weight
    result.signal_score = round(signal_score, 2)
    
    # ALPHA-FIX (2026-10-31): Confidence حساب ذكي (مش cap عند 60%)
    # المشكلة: لو فيه تعارض → confidence capped at 60% → مستحيل يوصل threshold 60
    # الحل: confidence بـ يحسب من نسبة الاتفاق + قوة الإشارة
    positive = sum(1 for s in family_scores.values() if s > 20)
    negative = sum(1 for s in family_scores.values() if s < -20)
    neutral = len(family_scores) - positive - negative
    total = len(family_scores)
    
    if total == 0:
        result.confidence = 0.0
    elif positive > 0 and negative > 0:
        # تعارض — بس مش necessarily سيء
        # confidence = نسبة الأغلبية + قوة إشارة الأغلبية
        majority = max(positive, negative)
        minority = min(positive, negative)
        agreement_ratio = majority / total  # 0.4-0.8
        # قوة الإشارة: متوسط |score| للـ engines المتفقة
        if positive >= negative:
            majority_scores = [s for s in family_scores.values() if s > 20]
        else:
            majority_scores = [s for s in family_scores.values() if s < -20]
        avg_strength = sum(abs(s) for s in majority_scores) / len(majority_scores) if majority_scores else 0
        strength_bonus = min(avg_strength / 100 * 30, 30)  # max +30 from strength
        # confidence = base agreement (40-80) + strength bonus (0-30) - conflict penalty
        conflict_penalty = minority / total * 20  # كل ما الأقلية أكبر → penalty أكبر
        result.confidence = round(max(20, min(85, agreement_ratio * 70 + strength_bonus - conflict_penalty)), 1)
    elif positive > 0:
        # كلها موجبة (agreement كامل)
        result.confidence = round(min(positive / total * 100, 90), 1)
    elif negative > 0:
        # كلها سالبة (agreement كامل على البيع)
        result.confidence = round(min(negative / total * 100, 90), 1)
    else:
        result.confidence = 30.0  # كلها neutral
    
    # Conflict check — بس ما تقللش confidence أوي
    from core.orchestrator_v3 import resolve_conflict, final_decision
    ok, conflict_reason = resolve_conflict(family_scores)
    if not ok:
        result.warnings.append(f'Conflict: {conflict_reason}')
        result.confidence = max(20, result.confidence - 10)  # -10 بس (مش -20)
    
    # ALPHA-FIX (2026-10-31): الـ ROOT CAUSE!
    # final_signal كان بـ يفضل 'NO_TRADE' دايماً — final_decision() ما اتـ استدعتش!
    # دلوقتي: بنـ استدعى final_decision() بـ state_code عشان يـ emit signal حقيقي
    _state_code = getattr(plan, 'state_code', '')
    _decision, _reason = final_decision(
        signal_score, result.confidence, 
        data_valid=True, risk_blocked=False,
        state_code=_state_code
    )
    
    # تحويل الـ decision لـ signal
    if _decision == 'BUY_CANDIDATE':
        result.final_signal = 'BUY'
    elif _decision == 'NEEDS_CONFIRMATION':
        result.final_signal = 'BUY'  # ضعيف بس لسه BUY
    elif _decision == 'NEGATIVE_SIGNAL':
        result.final_signal = 'SELL'
    elif _decision == 'STRONG_NEGATIVE':
        result.final_signal = 'STRONG_SELL'
    else:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = _reason
    
    result.complete = True
    result.completed_at = datetime.now().isoformat()
    
    # ALPHA-DYNAMIC (2026-10-31): حساب entry/target/stop ديناميكي
    # ماينفعش ثابت — كل سهم وكل سوق ليه منطق خاص
    if result.final_signal != 'NO_TRADE':
        result.risk_profile = _calculate_dynamic_levels(
            result.final_signal, prices, volumes, plan, family_scores
        )
    
    return result


def _calculate_dynamic_levels(signal, prices, volumes, plan, family_scores):
    """حساب entry/target/stop ديناميكي لكل سهم.
    
    ALPHA-DYNAMIC (2026-10-31): كل سهم وكل سوق ليه منطق خاص.
    ماينفعش نسبة ثابتة — لازم نحسب:
      1. ATR (مدى تداول السهم) → لتحديد stop + target
      2. recent swing low/high → support/resistance
      3. market regime → ضبط المعاملات حسب حالة السوق
      4. confidence → ضبط المسافات
    
    Returns:
        dict: {
            'entry_price': float,
            'target_price': float,
            'stop_loss': float,
            'target_price_2': float,  # هدف ثاني
            'atr': float,
            'atr_pct': float,
            'support': float,  # أقرب دعم
            'resistance': float,  # أقرب مقاومة
            'method': str,  # طريقة الحساب
        }
    """
    if not prices or len(prices) < 5:
        return {}
    
    entry = prices[-1]
    is_buy = 'BUY' in str(signal).upper()
    
    # 1. حساب ATR (مدى تداول السهم)
    atr = None
    atr_pct = 0.0
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.indicators.atr import calc_atr
        # بناء highs/lows لو مش متاحين (proxy من prices)
        _highs = []
        _lows = []
        for i in range(1, len(prices)):
            _change = abs(prices[i] - prices[i-1])
            _highs.append(max(prices[i], prices[i-1]) + _change * 0.3)
            _lows.append(min(prices[i], prices[i-1]) - _change * 0.3)
        if len(_highs) >= 14:
            atr = calc_atr(_highs[-14:], _lows[-14:], prices[-14:], 14)
        if atr is None or atr <= 0:
            # fallback: متوسط المدى اليومي
            if len(prices) >= 5:
                ranges = [abs(prices[i] - prices[i-1]) for i in range(1, min(len(prices), 15))]
                atr = sum(ranges) / len(ranges) if ranges else entry * 0.02
            else:
                atr = entry * 0.02  # fallback: 2% من السعر
        atr_pct = (atr / entry * 100) if entry > 0 else 2.0
    except Exception:
        atr = entry * 0.02  # fallback: 2%
        atr_pct = 2.0
    
    # 2. حساب support/resistance (recent swing low/high)
    lookback = min(len(prices), 20)
    recent_prices = prices[-lookback:]
    support = min(recent_prices)  # أقل سعر في آخر 20 يوم
    resistance = max(recent_prices)  # أعلى سعر في آخر 20 يوم
    
    # 3. ضبط المعاملات حسب market regime
    state_code = getattr(plan, 'state_code', 'S9')
    # في السوق الهابط: stop أوسع + target أقل (الحذر)
    # في السوق الصاعد: stop أضيق + target أعلى (الثقة)
    if state_code in ('S1', 'S2'):  # صاعد
        stop_mult = 1.5   # 1.5 × ATR
        target_mult = 3.0  # 3.0 × ATR
    elif state_code in ('S5', 'S6'):  # هابط
        stop_mult = 2.0   # 2.0 × ATR (أوسع — السوق متقلب)
        target_mult = 2.0  # 2.0 × ATR (أقل — الحذر)
    elif state_code == 'S7':  # تذبذب مرتفع
        stop_mult = 2.5   # 2.5 × ATR (أوسع جداً)
        target_mult = 2.5  # 2.5 × ATR
    elif state_code == 'S8':  # سيولة ضعيفة
        stop_mult = 2.0   # 2.0 × ATR
        target_mult = 1.5  # 1.5 × ATR (أقل — صعب يطلع)
    else:  # S3, S4, S9, S10 (عرضي/متعارض)
        stop_mult = 1.8   # 1.8 × ATR
        target_mult = 2.5  # 2.5 × ATR
    
    # 4. حساب entry/target/stop
    if is_buy:
        # BUY: stop تحت الدخول، target فوقه
        # stop = الأقرب من (ATR-based, support) — الحماية الأقرب أحسن
        stop_loss = min(
            entry - (atr * stop_mult),  # ATR-based
            support * 0.995  # أو تحت الدعم مباشرة
        )
        # target = الأبعد من (ATR-based, resistance) — الطموح الأبعد أحسن
        target_price = max(
            entry + (atr * target_mult),  # ATR-based
            resistance * 1.005  # أو فوق المقاومة
        )
        target_2 = entry + (atr * target_mult * 1.5)  # هدف ثاني أبعد
    else:
        # SELL: stop فوق الدخول، target تحته
        # stop = الأقرب من (ATR-based, resistance) — الحماية الأقرب أحسن
        stop_loss = min(
            entry + (atr * stop_mult),  # ATR-based
            resistance * 1.005  # أو فوق المقاومة مباشرة
        )
        # target = الأبعد من (ATR-based, support) — الطموح الأبعد أحسن
        target_price = max(
            entry - (atr * target_mult),  # ATR-based
            support * 0.995  # أو تحت الدعم
        )
        target_2 = entry - (atr * target_mult * 1.5)  # هدف ثاني أبعد
    
    # 5. فلتر: stop + target لازم يكونوا منطقيين
    min_stop_distance = atr * 0.5  # أقل نص ATR
    if is_buy:
        if (entry - stop_loss) < min_stop_distance:
            stop_loss = entry - min_stop_distance
    else:
        if (stop_loss - entry) < min_stop_distance:
            stop_loss = entry + min_stop_distance
    
    # ALPHA-FIX (2026-10-31): R/R check — لو أقل من 1.5 → اقتل الإشارة
    # المشكلة: في S6 (هبوط)، الدعم قريب → target قريب → R/R ضعيف
    # الحل الصحيح: مش نمد الهدف (ده تلفيق)، بل نرفض الإشارة
    # القاعدة: R/R < 1.5 = NO_TRADE (إشارة ضعيفة)
    stop_distance = abs(entry - stop_loss)
    target_distance = abs(target_price - entry)
    actual_rr = target_distance / stop_distance if stop_distance > 0 else 0
    
    if actual_rr < 1.5:
        # إشارة ضعيفة — R/R أقل من 1.5 → لا تتداول
        return {
            'entry_price': round(entry, 4),
            'target_price': round(target_price, 4),
            'stop_loss': round(stop_loss, 4),
            'target_price_2': 0.0,
            'atr': round(atr, 4),
            'atr_pct': round(atr_pct, 2),
            'support': round(support, 4),
            'resistance': round(resistance, 4),
            'state_code': state_code,
            'stop_mult': stop_mult,
            'target_mult': target_mult,
            'rr': round(actual_rr, 2),
            'method': 'ATR+support/resistance — R/R too low (rejected)',
            'rejected': True,  # علامة إن الإشارة مرفوضة
        }
    
    # كمان target_2 = 2× target_distance
    if is_buy:
        target_2 = entry + (target_distance * 2)
    else:
        target_2 = entry - (target_distance * 2)
    
    return {
        'entry_price': round(entry, 4),
        'target_price': round(target_price, 4),
        'stop_loss': round(stop_loss, 4),
        'target_price_2': round(target_2, 4),
        'atr': round(atr, 4),
        'atr_pct': round(atr_pct, 2),
        'support': round(support, 4),
        'resistance': round(resistance, 4),
        'state_code': state_code,
        'stop_mult': stop_mult,
        'target_mult': target_mult,
        'method': 'ATR+support/resistance (dynamic)',
    }


def _run_family_engine(family, plan, prices, volumes, ticker, market):
    """يشغّل محرك من عائلة معينة ويرجع (normalized_score, signal)."""
    
    if family == 'TREND':
        return _run_trend(plan, prices, volumes, ticker, market)
    elif family == 'MOM':
        return _run_momentum(plan, prices, volumes, ticker, market)
    elif family == 'MR':
        return _run_mean_reversion(plan, prices, volumes, ticker, market)
    elif family == 'BRK':
        return _run_breakout(plan, prices, volumes, ticker, market)
    elif family == 'FLOW':
        return _run_flow(plan, prices, volumes, ticker, market)
    elif family == 'FUND':
        return _run_fundamental(plan, ticker, market)
    elif family == 'EVENT':
        return _run_event(plan, ticker, market)
    else:
        return None, None


def _run_trend(plan, prices, volumes, ticker, market):
    """TREND family — uses master_analyzer's technical output."""
    if not prices or len(prices) < 50:
        return None, None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.master_analyzer import MasterAnalyzer
        a = MasterAnalyzer()
        r = a.analyze(ticker or plan.ticker, prices=prices, volumes=volumes or [])
        if not r:
            return None, None
        score = getattr(r, 'master_score', 50)
        signal = getattr(r, 'signal', 'HOLD')
        # Normalize to -100..+100 (master_score is 0-100, neutral=50)
        norm = (score - 50) * 2
        return norm, signal
    except Exception as e:
        logger.warning(f'TREND engine failed: {e}')
        raise


def _run_momentum(plan, prices, volumes, ticker, market):
    """MOM family — RSI-based momentum."""
    if not prices or len(prices) < 20:
        return None, None
    # Simple RSI(14)
    gains = [max(0, prices[i] - prices[i-1]) for i in range(1, min(len(prices), 15))]
    losses = [max(0, prices[i-1] - prices[i]) for i in range(1, min(len(prices), 15))]
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses) / len(losses) if losses else 1
    rsi = 100 - (100 / (1 + avg_gain / avg_loss)) if avg_loss > 0 else 100
    # Normalize: RSI=50 → 0, RSI=70 → +40, RSI=30 → -40
    norm = (rsi - 50) * 2
    signal = 'BUY' if rsi > 60 else 'SELL' if rsi < 40 else 'HOLD'
    return norm, signal


def _run_mean_reversion(plan, prices, volumes, ticker, market):
    """MR family — price vs SMA20."""
    if not prices or len(prices) < 20:
        return None, None
    sma20 = sum(prices[-20:]) / 20
    last = prices[-1]
    # If price below SMA → mean reversion buy signal
    deviation = (last - sma20) / sma20 * 100
    # Normalize: price 5% below SMA → +40, price 5% above → -40
    norm = max(-80, min(80, -deviation * 8))
    signal = 'BUY' if deviation < -2 else 'SELL' if deviation > 2 else 'HOLD'
    return norm, signal


def _run_breakout(plan, prices, volumes, ticker, market):
    """BRK family — price vs 20-day high/low."""
    if not prices or len(prices) < 20:
        return None, None
    high_20 = max(prices[-20:])
    low_20 = min(prices[-20:])
    last = prices[-1]
    range_pct = (high_20 - low_20) / low_20 * 100 if low_20 > 0 else 0
    
    if last >= high_20 * 0.98:
        norm = 50  # near breakout
        signal = 'BUY'
    elif last <= low_20 * 1.02:
        norm = -50  # near breakdown
        signal = 'SELL'
    else:
        # Position within range
        pos = (last - low_20) / (high_20 - low_20) if high_20 > low_20 else 0.5
        norm = (pos - 0.5) * 40
        signal = 'HOLD'
    return norm, signal


def _run_flow(plan, prices, volumes, ticker, market):
    """FLOW family — volume analysis."""
    if not volumes or len(volumes) < 20:
        return None, None
    avg_vol_20 = sum(volumes[-20:]) / 20
    recent_vol = sum(volumes[-5:]) / 5
    vol_ratio = recent_vol / avg_vol_20 if avg_vol_20 > 0 else 1
    
    # High volume = confirmation (positive), but only if price is up
    if prices and len(prices) >= 2:
        price_change = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 else 0
        if vol_ratio > 1.5 and price_change > 0:
            norm = min(80, vol_ratio * 20)
            signal = 'BUY'
        elif vol_ratio > 1.5 and price_change < 0:
            norm = min(-40, -vol_ratio * 15)
            signal = 'SELL'
        else:
            norm = 0
            signal = 'HOLD'
    else:
        norm = 0
        signal = 'HOLD'
    return norm, signal


def _run_fundamental(plan, ticker, market):
    """FUND family — placeholder (needs fundamental data)."""
    # Without fundamental data, return neutral
    return 0, 'HOLD'


def _run_event(plan, ticker, market):
    """EVENT family — placeholder (needs news data)."""
    return 0, 'HOLD'
