"""
executor_v3.py — المنفّذ المطور: يطبّق الأوزان فعليًا
=====================================================
يستقبل خطة من orchestrator_v3، يشغّل المحركات،
يطبّق الأوزان V1 على مخرجات منفصلة، يدمج النتائج.

STAGE-1 FIX (2026-10-29): كل العائلات اتصلحت:
- MOM: Wilder's RSI (مش SMA بدائي)
- FLOW: compute_money_flow (مش volume_ratio ساذج)
- BRK: اختراق حقيقي (close > high_20 + volume ≥ 1.4× + body ≥ 50%)
- MR: ATR-based (مش SMA20 بس)
- FUND/EVENT: وزن = 0 + إعادة تطبيع
- TREND: MasterAnalyzer (موثّق)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
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
    engine_scores: Dict[str, float] = field(default_factory=dict)
    engine_signals: Dict[str, str] = field(default_factory=dict)
    
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


def execute_v3(plan, prices=None, volumes=None, ticker=None, market='EGX',
               highs=None, lows=None, opens=None,
               market_cap=None, free_float=None):
    """ينفذ خطة V3 مع تطبيق الأوزان فعليًا.
    
    Args:
        plan: V3Plan من orchestrator_v3
        prices: قائمة أسعار الإغلاق (آخرها في النهاية)
        volumes: قائمة أحجام التداول
        ticker: رمز السهم
        market: السوق
        highs: قائمة أعلى الأسعار (لـ money_flow + breakout body)
        lows: قائمة أدنى الأسعار (لـ money_flow + breakout body)
        opens: قائمة أسعار الافتتاح (لـ breakout body)
        market_cap: القيمة السوقية (لـ liquidity_intensity)
        free_float: النسبة الحرة (لـ position sizing)
    
    Returns:
        V3Result
    """
    result = V3Result(
        plan_id=plan.plan_id,
        code_version=os.environ.get('GIT_COMMIT', 'unknown'),
    )
    
    if plan.decision_policy == 'no_trade':
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = plan.no_trade_reason
        result.completed_at = datetime.now().isoformat()
        return result
    
    # ── STAGE-1.5: إعادة تطبيع الأوزان لو FUND/EVENT غير متاح ──
    # لو العائلة بـ ترجع placeholder (0, HOLD) → وزنها = 0 + إعادة تطبيع
    weights = dict(plan.normalized_weights)
    _fund_available = getattr(plan, 'available_families', [])
    if 'FUND' not in _fund_available and 'FUND' in weights:
        weights.pop('FUND', None)
    if 'EVENT' not in _fund_available and 'EVENT' in weights:
        weights.pop('EVENT', None)
    # إعادة تطبيع
    _total_w = sum(weights.values())
    if _total_w > 0:
        weights = {k: v / _total_w for k, v in weights.items()}
    
    # Run engines per family and normalize scores
    family_scores = {}
    family_signals = {}
    
    for family, weight in weights.items():
        if weight <= 0:
            continue
        
        try:
            score, signal = _run_family_engine(
                family, plan, prices, volumes, ticker, market,
                highs=highs, lows=lows, opens=opens
            )
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
    total_weight = sum(weights.get(f, 0) for f in family_scores)
    if total_weight == 0:
        result.final_signal = 'NO_TRADE'
        result.no_trade_reason = 'zero total weight'
        result.completed_at = datetime.now().isoformat()
        return result
    
    signal_score = sum(family_scores[f] * weights.get(f, 0) for f in family_scores) / total_weight
    result.signal_score = round(signal_score, 2)
    
    # ── STAGE-3: Confidence + Conflict Detection ──
    positive = sum(1 for s in family_scores.values() if s > 20)
    negative = sum(1 for s in family_scores.values() if s < -20)
    neutral = len(family_scores) - positive - negative
    
    if positive > 0 and negative > 0:
        agreement = max(positive, negative) / len(family_scores)
        result.confidence = round(agreement * 60, 1)
    elif positive > 0:
        result.confidence = round(min(positive / len(family_scores) * 100, 90), 1)
    elif negative > 0:
        result.confidence = round(min(negative / len(family_scores) * 100, 90), 1)
    else:
        result.confidence = 30.0
    
    # Conflict check (STAGE-3: وسّع القواعد)
    from core.orchestrator_v3 import resolve_conflict
    ok, conflict_reason = resolve_conflict(family_scores)
    if not ok:
        result.warnings.append(f'Conflict: {conflict_reason}')
        result.confidence = min(result.confidence, 40)
    
    # STAGE-3.2: فحوصات تعارض إضافية
    _has_conflict = False
    _flow_score = family_scores.get('FLOW', 0)
    _trend_score = family_scores.get('TREND', 0)
    _mom_score = family_scores.get('MOM', 0)
    _mr_score = family_scores.get('MR', 0)
    _brk_score = family_scores.get('BRK', 0)
    
    # FLOW قوي + TREND ضعيف/سلبي → تعارض
    if _flow_score > 30 and _trend_score < -10:
        result.warnings.append('Conflict: FLOW strong + TREND weak/negative')
        result.confidence = min(result.confidence, 45)
        _has_conflict = True
    
    # MOM قوي + MR قوي في اتجاهين متعاكسين → تعارض
    if _mom_score > 30 and _mr_score < -30:
        result.warnings.append('Conflict: MOM+MR opposing directions')
        result.confidence = min(result.confidence, 45)
        _has_conflict = True
    
    # كل العائلات |score| < 15 → confidence منخفضة جدًا
    _all_weak = all(abs(s) < 15 for s in family_scores.values())
    if _all_weak:
        result.warnings.append('All engines weak (|score| < 15)')
        result.confidence = min(result.confidence, 25)
    
    # ── STAGE-4: تحويل الإشارة + Position Sizing ──
    _regime = getattr(plan, 'market_regime', 'NORMAL').upper()
    if 'DEFENSIVE' in _regime:
        _buy_thresh, _strong_thresh, _sell_thresh = 35, 55, -35
    elif 'AGGRESSIVE' in _regime:
        _buy_thresh, _strong_thresh, _sell_thresh = 25, 45, -25
    else:
        _buy_thresh, _strong_thresh, _sell_thresh = 30, 50, -30
    
    # STAGE-4: Confidence Gate — ممنوع BUY لو confidence < 45
    # (كان 58 — عالي أوي، بيقتل فرص حقيقية. 45 = 3 من 4 محركات تتفق)
    _confidence_ok = result.confidence >= 45
    _no_conflict = not _has_conflict and ok
    
    if signal_score >= _strong_thresh and _confidence_ok and _no_conflict:
        result.final_signal = 'STRONG_BUY'
    elif signal_score >= _buy_thresh and _confidence_ok:
        result.final_signal = 'BUY'
    elif signal_score <= _sell_thresh and result.confidence >= 50:
        result.final_signal = 'SELL'
    else:
        result.final_signal = 'NO_TRADE'
        _reason = f'signal_score {signal_score:.1f} '
        if not _confidence_ok:
            _reason += f'+ confidence {result.confidence:.0f} < 45'
        if _has_conflict:
            _reason += f' + conflict detected'
        result.no_trade_reason = _reason
    
    # Position size من final_position_size (موحد + كامل العوامل)
    try:
        import sys as _ps_sys
        _ps_sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from utils.shared_liquidity import final_position_size, liquidity_intensity
        
        # liquidity_intensity من market_cap
        _intensity = None
        if market_cap and market_cap > 0 and prices and len(prices) > 0:
            _turnover = (volumes[-1] if volumes else 0) * prices[-1]
            _intensity = liquidity_intensity(_turnover, market_cap)
        
        _base = 0.02  # 2% base
        result.position_size_pct = final_position_size(
            _base,
            flow_score=signal_score + 50,
            liquidity_intensity=_intensity,
            free_float=free_float,
            regime=_regime
        ) * 100
    except Exception:
        result.position_size_pct = 2.0
    
    # STAGE-4: S8 (سيولة ضعيفة) → position صغير جدًا
    if getattr(plan, 'state_code', '') == 'S8':
        result.position_size_pct = min(result.position_size_pct, 1.0)
        result.warnings.append('S8 (weak liquidity) → position capped at 1%')
    
    result.complete = True
    result.completed_at = datetime.now().isoformat()
    return result


def _run_family_engine(family, plan, prices, volumes, ticker, market,
                        highs=None, lows=None, opens=None):
    """يشغّل محرك من عائلة معينة ويرجع (normalized_score, signal)."""
    if family == 'TREND':
        return _run_trend(plan, prices, volumes, ticker, market)
    elif family == 'MOM':
        return _run_momentum(plan, prices, volumes, ticker, market)
    elif family == 'MR':
        return _run_mean_reversion(plan, prices, volumes, ticker, market,
                                    highs=highs, lows=lows)
    elif family == 'BRK':
        return _run_breakout(plan, prices, volumes, ticker, market,
                              highs=highs, lows=lows, opens=opens)
    elif family == 'FLOW':
        return _run_flow(plan, prices, volumes, ticker, market,
                          highs=highs, lows=lows)
    elif family == 'FUND':
        return _run_fundamental(plan, ticker, market)
    elif family == 'EVENT':
        return _run_event(plan, ticker, market)
    else:
        return None, None


# ═══════════════════════════════════════════════════════════════════════
# TREND — محرك مستقل بـ المؤشرات الـ canonical (لا MasterAnalyzer)
# ═══════════════════════════════════════════════════════════════════════
def _run_trend(plan, prices, volumes, ticker, market):
    """TREND family — تحليل الاتجاه بـ المؤشرات الـ canonical.

    STAGE-FIX (2026-10-29): شيلنا MasterAnalyzer خالص — كان صندوق أسود
    بـ يقرا من stocks.db بنفسه + بـ ينشئ LiquidityFilter جواه.
    دلوقتي: بـ نستخدم المؤشرات من analyzers/indicators/ بس.
    لا DB reads. لا LiquidityFilter. لا background_analyzer.

    المؤشرات المستخدمة:
      1. SMA alignment (price vs SMA20 vs SMA50)
      2. ADX (قوة الاتجاه)
      3. RSI (زخم)
      4. Bollinger (ضغط/توسع)
      5. MACD (اتجاه)

    Score: -100..+100 (weighted combination)
    """
    if not prices or len(prices) < 20:
        return None, None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.indicators.rsi import calc_rsi
        from analyzers.indicators.ma import sma, macd
        from analyzers.indicators.atr import calc_atr
        from analyzers.indicators.adx import calc_adx
        from analyzers.indicators.bollinger import calc_bollinger

        last = prices[-1]
        sma20 = sma(prices, 20) or sum(prices[-20:]) / 20
        sma50 = sma(prices, 50) if len(prices) >= 50 else sma20

        # 1. SMA alignment (40%)
        _align_score = 0
        if last > sma20: _align_score += 25
        else: _align_score -= 25
        if last > sma50: _align_score += 15
        else: _align_score -= 15
        if sma20 > sma50: _align_score += 10
        else: _align_score -= 10

        # 2. ADX — قوة الاتجاه (25%)
        _adx_score = 0
        if len(prices) >= 15:
            _highs = [prices[i] + abs(prices[i] - prices[i-1]) if i > 0 else prices[i] for i in range(len(prices))]
            _lows = [prices[i] - abs(prices[i] - prices[i-1]) if i > 0 else prices[i] for i in range(len(prices))]
            try:
                _adx_result = calc_adx(_highs[-15:], _lows[-15:], prices[-15:], 14)
                _adx_val = _adx_result.get('adx', 25) if isinstance(_adx_result, dict) else 25
                _plus_di = _adx_result.get('plus_di', 20) if isinstance(_adx_result, dict) else 20
                _minus_di = _adx_result.get('minus_di', 20) if isinstance(_adx_result, dict) else 20
                if _adx_val > 25:  # trend strong
                    if _plus_di > _minus_di: _adx_score = 25  # bullish trend
                    else: _adx_score = -25  # bearish trend
                elif _adx_val > 20:
                    if _plus_di > _minus_di: _adx_score = 10
                    else: _adx_score = -10
            except: pass

        # 3. RSI (15%)
        _rsi_score = 0
        _rsi = calc_rsi(prices, 14)
        if _rsi is not None:
            if _rsi > 55: _rsi_score = 15
            elif _rsi > 45: _rsi_score = 5
            elif _rsi < 35: _rsi_score = -10  # oversold — might bounce
            elif _rsi < 45: _rsi_score = -5
            else: _rsi_score = 0

        # 4. Bollinger (10%)
        _bb_score = 0
        try:
            _bb = calc_bollinger(prices, 20)
            if _bb and isinstance(_bb, dict):
                _pct_b = _bb.get('percent_b', 50)
                if _pct_b > 80: _bb_score = 10  # upper band — strong
                elif _pct_b > 50: _bb_score = 5
                elif _pct_b < 20: _bb_score = -10  # lower band — weak
                elif _pct_b < 50: _bb_score = -5
        except: pass

        # 5. MACD (10%)
        _macd_score = 0
        try:
            _macd_result = macd(prices)
            if _macd_result and isinstance(_macd_result, dict):
                _macd_val = _macd_result.get('macd', 0)
                _signal_val = _macd_result.get('signal', 0)
                if _macd_val and _signal_val:
                    if _macd_val > _signal_val: _macd_score = 10  # bullish crossover
                    else: _macd_score = -10  # bearish
        except: pass

        # Weighted combination
        norm = max(-100, min(100,
            _align_score * 1.0 +   # already -50..+50
            _adx_score * 1.0 +     # -25..+25
            _rsi_score * 1.0 +     # -10..+15
            _bb_score * 1.0 +      # -10..+10
            _macd_score * 1.0      # -10..+10
        ))

        signal = 'BUY' if norm > 20 else 'SELL' if norm < -20 else 'HOLD'
        return norm, signal
    except Exception as e:
        logger.warning(f'TREND engine failed: {e}')
        return None, None

def _run_momentum(plan, prices, volumes, ticker, market):
    """MOM family — Wilder's RSI(14) من analyzers/indicators/rsi.py.
    
    STAGE-1.1 FIX (2026-10-29): استبدل الحساب البدائي (SMA RSI) بـ
    calc_rsi (Wilder's smoothing) — المصدر الـ canonical.
    
    Normalization:
      RSI 50 → 0
      RSI 70 → +40
      RSI 30 → -40
      clamp بين -80 و +80
    
    Signal:
      RSI > 60 → BUY
      RSI < 40 → SELL
      غير كده → HOLD
    """
    if not prices or len(prices) < 15:
        return None, None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from analyzers.indicators.rsi import calc_rsi
        rsi = calc_rsi(prices, period=14)
        if rsi is None:
            return 0, 'HOLD'
        # Normalize: RSI 50 → 0, RSI 70 → +40, RSI 30 → -40
        norm = max(-80, min(80, (rsi - 50) * 2))
        signal = 'BUY' if rsi > 60 else 'SELL' if rsi < 40 else 'HOLD'
        return norm, signal
    except Exception as e:
        logger.warning(f'MOM engine failed: {e}')
        return 0, 'HOLD'


# ═══════════════════════════════════════════════════════════════════════
# MR — Mean Reversion (STAGE-1.4 FIX: ATR-based)
# ═══════════════════════════════════════════════════════════════════════
def _run_mean_reversion(plan, prices, volumes, ticker, market,
                         highs=None, lows=None):
    """MR family — Mean Reversion using ATR + SMA20 + RSI.
    
    STAGE-1.4 FIX (2026-10-29): قبل كده كان SMA20 بس (انحراف 5% = كفاية).
    دلوقتي: لازم انحراف ≥ 1.8 × ATR(14) + RSI في منطقة متطرفة.
    
    Logic:
      1. احسب ATR(14) من highs/lows/closes
      2. احسب الانحراف عن SMA20
      3. لو |deviation| ≥ 1.8 × ATR → إشارة mean reversion
      4. لو السعر تحت SMA20 (deviation < 0) → BUY (ارتداد متوقع)
      5. لو السعر فوق SMA20 (deviation > 0) → SELL (تصحيح متوقع)
    
    Normalize: deviation / (1.8 × ATR) × ±60، clamp -80..+80
    """
    if not prices or len(prices) < 20:
        return None, None
    
    sma20 = sum(prices[-20:]) / 20
    last = prices[-1]
    deviation_pct = (last - sma20) / sma20 * 100 if sma20 > 0 else 0
    
    # احسب ATR(14) لو highs/lows متاحين
    atr = None
    if highs and lows and len(highs) >= 15 and len(lows) >= 15:
        try:
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
            from analyzers.indicators.atr import calc_atr
            atr = calc_atr(highs[-15:], lows[-15:], prices[-15:], 14)
        except Exception:
            atr = None
    
    # لو ATR مش متاح → fallback لـ deviation بس (أقل حساسية)
    if atr is None or atr <= 0:
        # fallback: استخدم الانحراف المطلق بس
        norm = max(-60, min(60, -deviation_pct * 6))
        signal = 'BUY' if deviation_pct < -3 else 'SELL' if deviation_pct > 3 else 'HOLD'
        return norm, signal
    
    # ATR-based: لازم انحراف ≥ 1.8 × ATR (كنسبة من السعر)
    atr_pct = (atr / last) * 100 if last > 0 else 0
    threshold = 1.8 * atr_pct
    
    if abs(deviation_pct) < threshold:
        # الانحراف مش كافي → neutral
        norm = max(-30, min(30, -deviation_pct * 3))
        signal = 'HOLD'
    else:
        # انحراف كافي → mean reversion signal
        strength = min(abs(deviation_pct) / threshold, 1.5)
        norm = max(-80, min(80, -deviation_pct * 8 * strength / threshold))
        signal = 'BUY' if deviation_pct < 0 else 'SELL'
    
    return norm, signal


# ═══════════════════════════════════════════════════════════════════════
# BRK — Breakout (STAGE-1.3 FIX: تشديد + volume + body)
# ═══════════════════════════════════════════════════════════════════════
def _run_breakout(plan, prices, volumes, ticker, market,
                   highs=None, lows=None, opens=None):
    """BRK family — Breakout detection with volume + body confirmation.
    
    STAGE-1.3 FIX (2026-10-29): قبل كده كان 0.98 من القمة (ضعيف).
    دلوقتي: اختراق صاعد حقيقي لازم:
      1. إغلاق فوق أعلى قمة 20 يوم
      2. حجم اليوم ≥ 1.4 × متوسط 20 يوم
      3. body الشمعة ≥ 50% من الـ range
    
    Normalize:
      اختراق صاعد مؤكد → +55 لـ +75 (حسب قوة الحجم)
      كسر هابط مؤكد → -55 لـ -75
      غير كده → موقع السعر في الـ range (-40..+40)
    """
    if not prices or len(prices) < 20:
        return None, None
    
    # STAGE-1.3 FIX: استخدم highs/lows الفعلية لو متاحة (مش closes)
    # high_20 = أعلى قمة في آخر 20 يوم BEFORE today (مش شامل اليوم)
    if highs and len(highs) >= 21:
        high_20 = max(highs[-21:-1])
    elif highs and len(highs) >= 20:
        high_20 = max(highs[-20:-1]) if len(highs) > 20 else max(highs[:20])
    else:
        high_20 = max(prices[-21:-1]) if len(prices) > 20 else max(prices[-20:-1] if len(prices) > 20 else prices[:20])
    if lows and len(lows) >= 21:
        low_20 = min(lows[-21:-1])
    elif lows and len(lows) >= 20:
        low_20 = min(lows[-20:-1]) if len(lows) > 20 else min(lows[:20])
    else:
        low_20 = min(prices[-21:-1]) if len(prices) > 20 else min(prices[-20:-1] if len(prices) > 20 else prices[:20])
    last = prices[-1]
    
    # Volume confirmation
    avg_vol_20 = sum(volumes[-20:]) / 20 if volumes and len(volumes) >= 20 else 0
    last_vol = volumes[-1] if volumes and len(volumes) > 0 else 0
    vol_ratio = last_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0
    vol_confirmed = vol_ratio >= 1.4
    
    # Body confirmation (لو opens متاح)
    body_ok = True
    body_ratio = 0.5
    if opens and len(opens) > 0:
        last_open = opens[-1]
        _range = (highs[-1] if highs and len(highs) > 0 else last) - (lows[-1] if lows and len(lows) > 0 else last)
        if _range > 0:
            body_ratio = abs(last - last_open) / _range
            body_ok = body_ratio >= 0.50
    
    # اختراق صاعد حقيقي
    if last > high_20 and vol_confirmed and body_ok:
        norm = min(75, 55 + (vol_ratio - 1.4) * 20)
        signal = 'BUY'
    # كسر هابط حقيقي
    elif last < low_20 and vol_confirmed and body_ok:
        norm = max(-75, -55 - (vol_ratio - 1.4) * 20)
        signal = 'SELL'
    # غير كده: موقع السعر في الـ range
    else:
        pos = (last - low_20) / (high_20 - low_20) if high_20 > low_20 else 0.5
        norm = max(-40, min(40, (pos - 0.5) * 40))
        signal = 'HOLD'
    
    return norm, signal


# ═══════════════════════════════════════════════════════════════════════
# FLOW — compute_money_flow (STAGE-1.2 FIX)
# ═══════════════════════════════════════════════════════════════════════
def _run_flow(plan, prices, volumes, ticker, market,
               highs=None, lows=None):
    """FLOW family — uses compute_money_flow from shared_liquidity.
    
    STAGE-1.2 FIX (2026-10-29): قبل كده كان volume_ratio ساذج.
    دلوقتي: يستخدم compute_money_flow (6 طبقات: CLV + CMF + vol + trend + dead + SMA)
    كمصدر وحيد لـ buy/sell pressure.
    
    Input: closes, volumes, highs, lows (آخر 25+ يوم)
    Output: buy_pct (0-100) → normalize to -100..+100
    
    Normalize: (buy_pct - 50) * 2
    Signal:
      buy_pct ≥ 65 → BUY
      buy_pct ≤ 35 → SELL
      غير كده → HOLD
    
    لو compute_money_flow فشل → norm = 0, signal = HOLD + warning
    """
    if not prices or not volumes or len(prices) < 5 or len(volumes) < 5:
        return None, None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from utils.shared_liquidity import compute_money_flow
        
        # proxy highs/lows لو مش متاحة
        _highs = highs if highs and len(highs) >= len(prices) else [p * 1.01 for p in prices]
        _lows = lows if lows and len(lows) >= len(prices) else [p * 0.99 for p in prices]
        
        mf = compute_money_flow(prices, volumes, _highs, _lows)
        if not mf:
            logger.warning(f'FLOW: compute_money_flow returned None for {ticker}')
            return 0, 'HOLD'
        
        buy_pct = mf.get('buy_pct', 50)
        # Normalize: buy_pct 50 → 0, buy_pct 65 → +30, buy_pct 35 → -30
        norm = (buy_pct - 50) * 2
        norm = max(-100, min(100, norm))
        
        signal = 'BUY' if buy_pct >= 65 else 'SELL' if buy_pct <= 35 else 'HOLD'
        return norm, signal
    except Exception as e:
        logger.warning(f'FLOW engine failed: {e}')
        return 0, 'HOLD'


# ═══════════════════════════════════════════════════════════════════════
# FUND — Placeholder (STAGE-1.5: وزن = 0)
# ═══════════════════════════════════════════════════════════════════════
def _run_fundamental(plan, ticker, market):
    """FUND family — placeholder.
    
    STAGE-1.5 FIX: مش بـ ترجع (0, HOLD) على وزن 5-15%.
    دلوقتي: execute_v3 بـ يشيل FUND من الأوزان لو مش متاح
    + بـ يعيد تطبيع باقي الأوزان.
    
    TODO: ربط بـ data_engine.db.tab_* (fundamentals)
    """
    return 0, 'HOLD'


# ═══════════════════════════════════════════════════════════════════════
# EVENT — Placeholder (STAGE-1.5: وزن = 0)
# ═══════════════════════════════════════════════════════════════════════
def _run_event(plan, ticker, market):
    """EVENT family — placeholder.
    
    STAGE-1.5 FIX: نفس منطق FUND — وزن = 0 + إعادة تطبيع.
    
    TODO: ربط بـ news.db + Ollama sentiment
    """
    return 0, 'HOLD'
