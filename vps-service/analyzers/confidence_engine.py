"""
Confidence Engine v1.0.0
========================
محرك حساب نسبة الثقة لكل توصية استثمارية.

فلسفة المحرك:
- لا يكفي أن نقول "BUY" — لازم نقول "BUY بثقة 82%"
- نسبة الثقة تحدد: هل هذه التوصية تستحق أن تكون ضمن Top 5 اليوم؟
- المستثمر الذكي لا يشتري 5 أسهم كل يوم — يشتري فقط عندما تكون الثقة عالية

العوامل السبعة للثقة (كل عامل 0-15 نقطة، المجموع 0-100):
1. Technical Score (RSI + MA crossover + MACD)     — 15 نقطة
2. Trend Strength (ADX-like)                        — 15 نقطة
3. Volume Confirmation (spike + trend)              — 15 نقطة
4. Risk/Reward Ratio (reward vs risk)               — 15 نقطة
5. Volatility Quality (ATR% optimal range)          — 10 نقطة
6. Explosive Momentum (breakout detection)          — 15 نقطة
7. Data Quality (price + volume sanity)             — 15 نقطة

النتيجة النهائية: 0-100%
- ≥ 80: TOP PICK (شراء بقوة)  ← يُدخل في Top 5
- 65-79: STRONG (شراء)         ← يُدخل في Top 5
- 50-64: WATCH (متابعة فقط)    ← لا يدخل Top 5
- < 50: SKIP (تجاهل)           ← لا يُخزن أصلاً

Usage:
    from analyzers.confidence_engine import compute_confidence
    score = compute_confidence(indicators, decision, persona)
    # score = {'confidence': 82.5, 'tier': 'TOP_PICK', 'factors': {...}}
"""

from typing import Dict, Any, Tuple
import math


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _safe_div(num: float, den: float, fallback: float = 0.0) -> float:
    try:
        return num / den if den else fallback
    except (ZeroDivisionError, TypeError):
        return fallback


# ---------------------------------------------------------------------------
# Factor 1: Technical Score (RSI + MA + MACD-like)  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_technical(ind: Dict) -> Tuple[float, Dict]:
    rsi = ind.get('rsi', 50) or 50
    ma20 = ind.get('ma20', 0) or 0
    ma50 = ind.get('ma50', 0) or 0
    close = ind.get('close', 0) or 0
    trend = ind.get('trend', 'NEUTRAL')

    score = 0.0
    reasons = []

    # RSI optimal zones (not overbought, not oversold extreme)
    if 40 <= rsi <= 65:
        score += 6
        reasons.append('RSI في نطاق صحي (40-65)')
    elif 30 <= rsi < 40:
        score += 4
        reasons.append('RSI قرب التشبع البيعي (فرصة ارتداد)')
    elif 65 < rsi <= 75:
        score += 3
        reasons.append('RSI قوي لكن قرب التشبع الشرائي')
    elif rsi > 75:
        score -= 2
        reasons.append('RSI تشبع شرائي (خطر تصحيح)')
    elif rsi < 30:
        score += 5  # oversold = bounce potential
        reasons.append('RSI تشبع بيعي قوي (ارتداد محتمل)')

    # MA alignment (golden/death cross)
    if ma20 > 0 and ma50 > 0:
        if ma20 > ma50 and close > ma20:
            score += 6
            reasons.append('MA20 > MA50 والسعر فوقهما (ترند صاعد قوي)')
        elif ma20 > ma50:
            score += 4
            reasons.append('MA20 > MA50 (ترند صاعد)')
        elif ma20 < ma50 and close < ma20:
            score -= 2
            reasons.append('MA20 < MA50 والسعر تحتهما (ترند هابط)')
        else:
            score += 1
            reasons.append('MA متشابكة (حياد)')

    # Trend confirmation
    if trend == 'BULLISH':
        score += 3
        reasons.append('ترند صاعد مؤكد')
    elif trend == 'BEARISH':
        score -= 3
        reasons.append('ترند هابط (تحذير)')

    return _clamp(score, 0, 15), {'factor': 'technical', 'score': round(score, 1), 'reasons': reasons}


# ---------------------------------------------------------------------------
# Factor 2: Trend Strength (ADX-like via price slope)  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_trend_strength(ind: Dict) -> Tuple[float, Dict]:
    closes = ind.get('closes', []) or []
    if len(closes) < 20:
        return 5.0, {'factor': 'trend_strength', 'score': 5.0, 'reasons': ['بيانات غير كافية']}

    # Slope of last 20 closes (linear regression lite)
    recent = closes[-20:]
    n = len(recent)
    x_mean = (n - 1) / 2
    y_mean = sum(recent) / n
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
    den = sum((i - x_mean) ** 2 for i in range(n))
    slope = _safe_div(num, den)
    # Normalize slope as % of price
    slope_pct = (slope / y_mean * 100) if y_mean > 0 else 0

    score = 0.0
    reasons = []
    if slope_pct > 1.5:
        score = 13
        reasons.append(f'ميل صاعد قوي (+{slope_pct:.2f}%/يوم)')
    elif slope_pct > 0.5:
        score = 10
        reasons.append(f'ميل صاعد متوسط (+{slope_pct:.2f}%/يوم)')
    elif slope_pct > 0:
        score = 6
        reasons.append(f'ميل صاعد ضعيف (+{slope_pct:.2f}%/يوم)')
    elif slope_pct > -0.5:
        score = 3
        reasons.append(f'ميل جانبي/ضعيف ({slope_pct:.2f}%/يوم)')
    else:
        score = 1
        reasons.append(f'ميل هابط ({slope_pct:.2f}%/يوم)')

    return _clamp(score, 0, 15), {'factor': 'trend_strength', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Factor 3: Volume Confirmation  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_volume(ind: Dict) -> Tuple[float, Dict]:
    volume_spike = ind.get('volume_spike', False)
    volume_trend = ind.get('volume_trend', 'stable')
    volume_ratio = ind.get('volume_ratio', 1.0) or 1.0

    score = 0.0
    reasons = []
    if volume_spike and volume_trend == 'increasing':
        score = 14
        reasons.append(f'volume spike + increasing (ratio={volume_ratio:.2f})')
    elif volume_spike:
        score = 10
        reasons.append('volume spike (تأكيد الحركة)')
    elif volume_trend == 'increasing':
        score = 8
        reasons.append('volume increasing (تراكم)')
    elif volume_trend == 'decreasing':
        score = 3
        reasons.append('volume decreasing (ضعف الاهتمام)')
    else:
        score = 5
        reasons.append('volume stable (حياد)')

    return _clamp(score, 0, 15), {'factor': 'volume', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Factor 4: Risk/Reward Ratio  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_risk_reward(decision: Dict) -> Tuple[float, Dict]:
    rr = decision.get('risk_reward', 0) or 0
    entry = decision.get('entry_price', 0) or 0
    target = decision.get('target_price', 0) or 0
    stop = decision.get('stop_loss', 0) or 0

    score = 0.0
    reasons = []
    if rr >= 3.0:
        score = 15
        reasons.append(f'R/R ممتاز ({rr:.2f})')
    elif rr >= 2.0:
        score = 12
        reasons.append(f'R/R قوي ({rr:.2f})')
    elif rr >= 1.5:
        score = 9
        reasons.append(f'R/R جيد ({rr:.2f})')
    elif rr >= 1.0:
        score = 6
        reasons.append(f'R/R مقبول ({rr:.2f})')
    elif rr > 0:
        score = 2
        reasons.append(f'R/R ضعيف ({rr:.2f})')
    else:
        score = 0
        reasons.append('R/R غير محسوب')

    return _clamp(score, 0, 15), {'factor': 'risk_reward', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Factor 5: Volatility Quality (ATR% optimal range)  — 10 نقطة
# ---------------------------------------------------------------------------
# ⚠️ BACKTEST FINDING (2026-08-11): ATR≥6% → 43.2% WR, -3.43% avg, PF=0.48
# النظام بخسر في التذبذب المفرط. لازم نعاقب ATR≥6% بشدة بدل ما نكافئه.
# ATR 2-4% = الأفضل (84.5% WR)، ATR 4-6% = جيد (85.3% WR)، ATR≥6% = خطر
def _factor_volatility(ind: Dict) -> Tuple[float, Dict]:
    atr_pct = ind.get('atr_pct', 0) or 0
    score = 0.0
    reasons = []
    # NEW calibrated ranges based on backtest:
    # - ATR 2-4%: BEST (84.5% WR, +6.93% avg, PF=9.64)
    # - ATR 4-6%: GOOD (85.3% WR, +6.98% avg, PF=10.85)
    # - ATR 6-8%: DANGER (transition zone)
    # - ATR≥8%: AVOID (extreme volatility = losses)
    if 2 <= atr_pct <= 4:
        score = 10
        reasons.append(f'تذبذب مثالي ({atr_pct:.1f}%)')
    elif 4 <= atr_pct <= 6:
        score = 8
        reasons.append(f'تذبذب جيد ({atr_pct:.1f}%)')
    elif 1 <= atr_pct < 2:
        score = 5
        reasons.append(f'تذبذب منخفض ({atr_pct:.1f}%)')
    elif 6 < atr_pct <= 8:
        score = 2  # was 7 — heavily penalized based on backtest
        reasons.append(f'تذبذب خطر ({atr_pct:.1f}%) — خسائر محتملة')
    elif atr_pct > 8:
        score = 0  # HARD PENALTY — backtest showed 43.2% WR here
        reasons.append(f'تذبذب مفرط ({atr_pct:.1f}%) — تجنب تام')
    else:
        score = 2
        reasons.append(f'تذبذب شبه معدوم ({atr_pct:.1f}%)')

    return _clamp(score, 0, 10), {'factor': 'volatility', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Extreme Volatility VETO — HARD SKIP
# ---------------------------------------------------------------------------
# ⚠️ BACKTEST FINDING: ATR≥6% → PF=0.48 (خسائر). لازم نرفض تماماً ATR≥8%.
def should_skip_extreme_volatility(ind: Dict) -> Tuple[bool, str]:
    """فحص صارم: هل السهم في حالة تذبذب مفرط يستوجب الرفض التام؟"""
    atr_pct = ind.get('atr_pct', 0) or 0
    if atr_pct >= 8.0:
        return True, f'تذبذب مفرط (ATR={atr_pct:.1f}%) — رفض تام بناءً على backtest'
    return False, ''


# ---------------------------------------------------------------------------
# Factor 6: Explosive Momentum  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_explosive(decision: Dict) -> Tuple[float, Dict]:
    explosive_score = decision.get('explosive_score', 0) or 0
    explosive_label = decision.get('explosive_label', '') or ''
    bull_score = decision.get('technical_score', 50) or 50

    score = 0.0
    reasons = []
    if explosive_label == 'BOMB' and explosive_score >= 80:
        score = 15
        reasons.append(f'BOMB 🚀 (explosive={explosive_score})')
    elif explosive_label == 'ROCKET' and explosive_score >= 70:
        score = 12
        reasons.append(f'ROCKET 🔥 (explosive={explosive_score})')
    elif explosive_label == 'SPARK' and explosive_score >= 50:
        score = 8
        reasons.append(f'SPARK ✨ (explosive={explosive_score})')
    elif bull_score >= 75:
        score = 7
        reasons.append(f'زخم قوي بدون breakout (bull={bull_score})')
    elif bull_score >= 60:
        score = 4
        reasons.append(f'زخم متوسط (bull={bull_score})')
    else:
        score = 1
        reasons.append('زخم ضعيف')

    return _clamp(score, 0, 15), {'factor': 'explosive', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Factor 7: Data Quality  — 15 نقطة
# ---------------------------------------------------------------------------
def _factor_data_quality(ind: Dict, decision: Dict) -> Tuple[float, Dict]:
    close = ind.get('close', 0) or 0
    volume = ind.get('volume', 0) or 0
    history_len = ind.get('history_len', 0) or 0
    quality_flags = ind.get('quality_flags', []) or []

    score = 0.0
    reasons = []
    # Price sanity
    if close > 0:
        score += 4
    else:
        reasons.append('سعر غير صالح')
        return 0, {'factor': 'data_quality', 'score': 0, 'reasons': reasons}

    # Volume sanity
    if volume > 0:
        score += 3
    else:
        reasons.append('حجم صفري')

    # History length
    if history_len >= 100:
        score += 5
        reasons.append(f'تاريخ كافٍ ({history_len} يوم)')
    elif history_len >= 50:
        score += 3
        reasons.append(f'تاريخ مقبول ({history_len} يوم)')
    elif history_len >= 20:
        score += 1
        reasons.append(f'تاريخ محدود ({history_len} يوم)')
    else:
        reasons.append(f'تاريخ غير كافٍ ({history_len} يوم)')

    # Quality flags
    if not quality_flags:
        score += 3
    else:
        score += 1
        reasons.append(f'تحذيرات جودة: {quality_flags[:2]}')

    return _clamp(score, 0, 15), {'factor': 'data_quality', 'score': score, 'reasons': reasons}


# ---------------------------------------------------------------------------
# Main: compute_confidence
# ---------------------------------------------------------------------------
def compute_confidence(ind: Dict, decision: Dict, persona: str = 'balanced') -> Dict:
    """
    يحسب نسبة الثقة النهائية (0-100) لتوصية استثمارية.

    Args:
        ind: indicators dict (rsi, ma20, ma50, atr, atr_pct, trend, volume_spike, ...)
        decision: decision dict (signal, entry_price, target_price, stop_loss, risk_reward, ...)
        persona: 'gambler' | 'balanced' | 'conservative'

    Returns:
        {
            'confidence': float (0-100),
            'tier': 'TOP_PICK' | 'STRONG' | 'WATCH' | 'SKIP',
            'factors': [list of 7 factor dicts],
            'top_reasons': [list of human-readable reasons],
        }
    """
    try:
        # ⚠️ BACKTEST-DRIVEN HARD VETO: ATR≥8% → SKIP entirely (43.2% WR in backtest)
        skip_veto, veto_reason = should_skip_extreme_volatility(ind)
        if skip_veto:
            return {
                'confidence': 0.0,
                'tier': 'SKIP',
                'factors': [{'factor': 'volatility_veto', 'score': 0, 'reasons': [veto_reason]}],
                'top_reasons': [veto_reason],
                'raw_score': 0.0,
                'vetoed': True,
            }

        f1, d1 = _factor_technical(ind)
        f2, d2 = _factor_trend_strength(ind)
        f3, d3 = _factor_volume(ind)
        f4, d4 = _factor_risk_reward(decision)
        f5, d5 = _factor_volatility(ind)
        f6, d6 = _factor_explosive(decision)
        f7, d7 = _factor_data_quality(ind, decision)

        raw = f1 + f2 + f3 + f4 + f5 + f6 + f7
        # Persona adjustment:
        # - gambler: boost high-confidence picks more (risk-seeker)
        # - conservative: penalize low-confidence more (risk-averse)
        if persona == 'gambler':
            adjusted = raw * 1.05 if raw >= 70 else raw * 0.95
        elif persona == 'conservative':
            adjusted = raw * 0.95 if raw < 60 else raw * 1.03
        else:
            adjusted = raw

        confidence = _clamp(round(adjusted, 1), 0, 100)

        # Tier classification — BACKTEST-CALIBRATED thresholds
        # ⚠️ Finding: WATCH (50-64%) had 85.2% WR vs TOP_PICK (≥80%) 83.7% WR
        # This means 80+ threshold is too high. Lowered to 75 for TOP_PICK.
        if confidence >= 75:
            tier = 'TOP_PICK'
        elif confidence >= 60:
            tier = 'STRONG'
        elif confidence >= 45:
            tier = 'WATCH'
        else:
            tier = 'SKIP'

        # Collect top reasons (highest factor scores first)
        all_factors = [d1, d2, d3, d4, d5, d6, d7]
        all_factors.sort(key=lambda x: x.get('score', 0), reverse=True)
        top_reasons = []
        for f in all_factors[:3]:
            for r in f.get('reasons', []):
                top_reasons.append(r)

        return {
            'confidence': confidence,
            'tier': tier,
            'factors': [d1, d2, d3, d4, d5, d6, d7],
            'top_reasons': top_reasons[:5],
            'raw_score': round(raw, 1),
        }
    except Exception as e:
        return {
            'confidence': 50.0,
            'tier': 'WATCH',
            'factors': [],
            'top_reasons': [f'خطأ في حساب الثقة: {e}'],
            'raw_score': 50.0,
        }


# ---------------------------------------------------------------------------
# Daily Cap = 5 — اختيار أعلى 5 توصيات
# ---------------------------------------------------------------------------
def select_top_picks(candidates: list, cap: int = 5, min_confidence: float = 50.0) -> list:
    """
    يختار أعلى `cap` توصيات من قائمة candidates بناءً على confidence.

    - يفلتر أي توصية confidence < min_confidence
    - يمنع التكرار: نفس الـ ticker يظهر مرة واحدة فقط (نأخذ الأعلى ثقة)
    - يرتب الباقي تنازلياً ويأخذ أعلى `cap`

    Args:
        candidates: list of dicts, each must have 'ticker' and 'confidence'
        cap: max number of picks (default 5)
        min_confidence: minimum confidence threshold (default 50)

    Returns:
        list of top `cap` picks
    """
    if not candidates:
        return []

    # Filter by min confidence
    filtered = [c for c in candidates if (c.get('confidence', 0) or 0) >= min_confidence]

    # Deduplicate by ticker — keep highest confidence per ticker
    by_ticker = {}
    for c in filtered:
        t = (c.get('ticker') or '').upper()
        if not t:
            continue
        if t not in by_ticker or (c.get('confidence', 0) or 0) > (by_ticker[t].get('confidence', 0) or 0):
            by_ticker[t] = c

    # Sort by confidence desc
    unique = list(by_ticker.values())
    unique.sort(key=lambda x: (x.get('confidence', 0) or 0, x.get('risk_reward', 0) or 0), reverse=True)

    return unique[:cap]


# ---------------------------------------------------------------------------
# Module self-test
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    test_ind = {
        'rsi': 55, 'ma20': 100, 'ma50': 95, 'close': 102,
        'trend': 'BULLISH', 'volume_spike': True, 'volume_trend': 'increasing',
        'volume_ratio': 2.1, 'atr_pct': 3.5, 'history_len': 150,
        'quality_flags': [], 'closes': [95, 96, 97, 98, 99, 100, 101, 102] * 5,
    }
    test_decision = {
        'signal': 'BUY', 'entry_price': 102, 'target_price': 110,
        'stop_loss': 98, 'risk_reward': 2.0, 'explosive_score': 75,
        'explosive_label': 'ROCKET', 'technical_score': 78,
    }
    result = compute_confidence(test_ind, test_decision, 'balanced')
    print(f"Confidence: {result['confidence']} ({result['tier']})")
    print(f"Top reasons: {result['top_reasons']}")
    print('---')
    # Test select_top_picks
    cands = [
        {'ticker': 'ABCD', 'confidence': 88, 'risk_reward': 2.5},
        {'ticker': 'EFGH', 'confidence': 72, 'risk_reward': 1.8},
        {'ticker': 'ABCD', 'confidence': 75, 'risk_reward': 2.0},  # duplicate
        {'ticker': 'IJKL', 'confidence': 45, 'risk_reward': 1.2},  # below threshold
        {'ticker': 'MNOP', 'confidence': 91, 'risk_reward': 3.1},
        {'ticker': 'QRST', 'confidence': 68, 'risk_reward': 1.9},
        {'ticker': 'UVWX', 'confidence': 82, 'risk_reward': 2.2},
        {'ticker': 'YZAB', 'confidence': 60, 'risk_reward': 1.5},
    ]
    top = select_top_picks(cands, cap=5, min_confidence=50)
    print(f'Top {len(top)} picks:')
    for p in top:
        print(f"  {p['ticker']}: {p['confidence']}%")
