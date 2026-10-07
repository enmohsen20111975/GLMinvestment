"""
محرك تحليل الأطر الزمنية المتعددة (V3)
Multi-Timeframe Confluence Engine

بيعمل تحليل لـ 3 أطر زمنية (يومي / أسبوعي / شهري) ويحسب تقارب بينهم.
كل إطار بيتحسبله: RSI(14) + MA20 + MA50 + ترتيب المتوسطات.
نتيجة التقارب بتحدد قوة الإشارة (شراء قوي/متوسط/محايد/بيع متوسط/بيع قوي).

الإصدار ده V3 — مبني على درس الباك تيست (41.3% win rate):
الهدف رفع دقة إشارات الشراء عن طريق تأكيد التقارب بين الأطر الزمنية.

@version 3.0.0
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime


# ==================== DATACLASSES (الـ API الجديد) ====================

@dataclass
class MultiTimeframeResult:
    """نتيجة محرك الأطر الزمنية المتعددة"""
    daily_score: float
    weekly_score: float
    monthly_score: float
    confluence_score: float
    signal: str            # strong_buy | moderate_buy | neutral | moderate_sell | strong_sell
    aligned: bool
    daily_trend: str = 'neutral'    # bullish | bearish | neutral
    weekly_trend: str = 'neutral'
    monthly_trend: str = 'neutral'
    signals: List[str] = field(default_factory=list)


# ==================== DATACLASSES (للتوافق مع maestro_orchestrator) ====================

@dataclass
class TimeframeResult:
    """نتيجة إطار زمني واحد — للتوافق مع maestro"""
    trend: str
    score: float
    signals: List[str] = field(default_factory=list)
    ma_alignment: Optional[str] = None
    rsi_value: Optional[float] = None
    macd_signal: Optional[str] = None
    volume_trend: Optional[str] = None
    support_level: Optional[float] = None
    resistance_level: Optional[float] = None


@dataclass
class ConfluenceResult:
    """نتيجة التقارب — للتوافق مع maestro"""
    score: float
    aligned: bool
    aligned_count: int
    bonus: float = 0.0
    aligned_timeframes: List[str] = field(default_factory=list)
    conflicting_timeframes: List[str] = field(default_factory=list)


@dataclass
class TimeframeAnalysis:
    """النتيجة الكاملة للتحليل — للتوافق مع maestro"""
    ticker: str
    analysis_date: str
    daily: TimeframeResult
    weekly: TimeframeResult
    monthly: TimeframeResult
    confluence: ConfluenceResult


# ==================== HELPER FUNCTIONS ====================

def _to_float(v: Any, fallback: float = 0.0) -> float:
    """تحويل آمن لأرقام عشرية"""
    try:
        return float(v) if v is not None else fallback
    except (TypeError, ValueError):
        return fallback


def _sma(data: List[float], period: int) -> Optional[float]:
    """حساب المتوسط المتحرك البسيط — بيرجع None لو البيانات أقل من الفترة"""
    if not data or period <= 0 or len(data) < period:
        return None
    return sum(data[-period:]) / period


def _rsi(closes: List[float], period: int = 14) -> float:
    """حساب RSI مبسط (SMA بدل Wilder's) — بيرجع 50 لو البيانات قليلة"""
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        gains.append(ch if ch > 0 else 0.0)
        losses.append(-ch if ch < 0 else 0.0)
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    if avg_gain == 0:
        return 0.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _extract_closes(price_history: List[Any]) -> List[float]:
    """استخراج أسعار الإغلاق من قاموس أو رقم"""
    closes: List[float] = []
    for p in price_history:
        if isinstance(p, (int, float)):
            closes.append(float(p))
        elif isinstance(p, dict):
            v = p.get('close', p.get('close_price', 0))
            closes.append(_to_float(v))
    return closes


def _resample(closes: List[float], bucket: int) -> List[float]:
    """تجميع الإغلاقات اليومية (5=أسبوع، 20=شهر) — بنآخذ آخر قيمة في كل باكت"""
    out: List[float] = []
    for i in range(0, len(closes), bucket):
        chunk = closes[i:i + bucket]
        if chunk:
            out.append(chunk[-1])
    return out


def _score_timeframe(closes: List[float]) -> Tuple[float, str, List[str]]:
    """حساب سكور لإطار زمني واحد باستخدام RSI + MA20 + MA50"""
    signals: List[str] = []
    if len(closes) < 20:
        return 50.0, 'neutral', ['بيانات غير كافية للإطار ده']

    price = closes[-1]
    ma20 = _sma(closes, 20)
    ma50 = _sma(closes, 50)
    rsi = _rsi(closes, 14)
    score = 50.0

    # ترتيب المتوسطات: price > MA20 > MA50 = صاعد قوي
    if ma20 is not None and ma50 is not None:
        if price > ma20 > ma50:
            score += 20
            signals.append('ترتيب صاعد (price > MA20 > MA50)')
        elif price < ma20 < ma50:
            score -= 20
            signals.append('ترتيب هابط (price < MA20 < MA50)')
        elif price > ma20:
            score += 8
            signals.append('السعر فوق MA20')
        else:
            score -= 8
            signals.append('السعر تحت MA20')
    elif ma20 is not None:
        if price > ma20:
            score += 10
            signals.append('السعر فوق MA20')
        else:
            score -= 10
            signals.append('السعر تحت MA20')

    # RSI
    if rsi > 70:
        score -= 8
        signals.append(f'RSI {rsi:.1f} تشبع شرائي')
    elif rsi < 30:
        score += 8
        signals.append(f'RSI {rsi:.1f} تشبع بيعي - فرصة')
    elif rsi >= 50:
        score += 5
        signals.append(f'RSI {rsi:.1f} إيجابي')
    else:
        score -= 5
        signals.append(f'RSI {rsi:.1f} سلبي')

    score = max(0.0, min(100.0, score))
    trend = 'bullish' if score >= 60 else 'bearish' if score <= 40 else 'neutral'
    return round(score, 2), trend, signals


# ==================== ENGINE (الـ API الجديد) ====================

class MultiTimeframeEngine:
    """محرك الأطر الزمنية المتعددة

    بيعمل تحليل للتقارب بين 3 أطر زمنية (يومي/أسبوعي/شهري)
    بناءً على RSI و MA20 و MA50 لكل إطار.
    """

    def analyze(self, prices: list) -> MultiTimeframeResult:
        """تحليل قائمة الأسعار اليومية وإرجاع نتيجة التقارب بين الأطر الزمنية."""
        # حالات الحافة: بيانات فاضية
        if not prices:
            return MultiTimeframeResult(
                daily_score=50.0, weekly_score=50.0, monthly_score=50.0,
                confluence_score=50.0, signal='neutral', aligned=False,
                signals=['المدخلات فاضية - مفيش بيانات']
            )

        closes = _extract_closes(prices)
        if not closes:
            return MultiTimeframeResult(
                daily_score=50.0, weekly_score=50.0, monthly_score=50.0,
                confluence_score=50.0, signal='neutral', aligned=False,
                signals=['مفيش أسعار إغلاق صالحة']
            )

        daily_score, daily_trend, daily_sigs = _score_timeframe(closes)
        weekly_score, weekly_trend, weekly_sigs = _score_timeframe(_resample(closes, 5))
        monthly_score, monthly_trend, monthly_sigs = _score_timeframe(_resample(closes, 20))

        # عدّ الأطر الزمنية المتوافقة
        trends = (daily_trend, weekly_trend, monthly_trend)
        bullish = sum(1 for t in trends if t == 'bullish')
        bearish = sum(1 for t in trends if t == 'bearish')
        aligned = bullish >= 2 or bearish >= 2
        avg = (daily_score + weekly_score + monthly_score) / 3.0

        # منطق الإشارة حسب عدد الأطر المتوافقة
        if bullish == 3:
            confluence_score = max(80.0, avg + 10.0)
            signal = 'strong_buy'
        elif bullish == 2:
            confluence_score = max(60.0, min(70.0, avg + 5.0))
            signal = 'moderate_buy'
        elif bearish == 3:
            confluence_score = min(20.0, avg - 10.0)
            signal = 'strong_sell'
        elif bearish == 2:
            confluence_score = min(40.0, max(30.0, avg - 5.0))
            signal = 'moderate_sell'
        else:
            confluence_score = 50.0
            signal = 'neutral'

        confluence_score = max(0.0, min(100.0, round(confluence_score, 2)))

        all_signals = [
            f'يومي: {daily_sigs[0] if daily_sigs else ""}',
            f'أسبوعي: {weekly_sigs[0] if weekly_sigs else ""}',
            f'شهري: {monthly_sigs[0] if monthly_sigs else ""}',
        ]

        return MultiTimeframeResult(
            daily_score=round(daily_score, 2),
            weekly_score=round(weekly_score, 2),
            monthly_score=round(monthly_score, 2),
            confluence_score=confluence_score,
            signal=signal,
            aligned=aligned,
            daily_trend=daily_trend,
            weekly_trend=weekly_trend,
            monthly_trend=monthly_trend,
            signals=all_signals,
        )


# ==================== BACKWARD-COMPAT SHIM لـ maestro_orchestrator ====================

def analyze_timeframes(ticker: str, price_history: List[Dict]) -> TimeframeAnalysis:
    """تحليل الأطر الزمنية — shim للتوافق مع maestro_orchestrator.py."""
    engine = MultiTimeframeEngine()
    res = engine.analyze(price_history)

    daily = TimeframeResult(
        trend=res.daily_trend, score=res.daily_score,
        signals=res.signals[:1] if res.signals else []
    )
    weekly = TimeframeResult(trend=res.weekly_trend, score=res.weekly_score, signals=[])
    monthly = TimeframeResult(trend=res.monthly_trend, score=res.monthly_score, signals=[])

    trends = (res.daily_trend, res.weekly_trend, res.monthly_trend)
    aligned_count = max(sum(1 for t in trends if t == 'bullish'),
                        sum(1 for t in trends if t == 'bearish'))
    confluence = ConfluenceResult(
        score=res.confluence_score, aligned=res.aligned,
        aligned_count=aligned_count,
    )

    return TimeframeAnalysis(
        ticker=ticker,
        analysis_date=datetime.now().isoformat(),
        daily=daily, weekly=weekly, monthly=monthly,
        confluence=confluence,
    )


# ==================== SELF-TEST ====================

if __name__ == '__main__':
    print('=== تجربة MultiTimeframeEngine (ترند صاعد) ===')
    # 450 شمعة يومية → 90 أسبوعي + 22 شهري (يكفي لـ MA20 على كل الإطارات)
    base = 100.0
    bullish_prices = [{'close': base + i * 0.4} for i in range(450)]
    engine = MultiTimeframeEngine()
    r = engine.analyze(bullish_prices)
    print(f'  يومي:   {r.daily_score} ({r.daily_trend})')
    print(f'  أسبوعي: {r.weekly_score} ({r.weekly_trend})')
    print(f'  شهري:   {r.monthly_score} ({r.monthly_trend})')
    print(f'  تقارب:  {r.confluence_score} | متوافق: {r.aligned} | إشارة: {r.signal}')

    print('\n=== تجربة ترند هابط ===')
    bearish_prices = [{'close': 300 - i * 0.4} for i in range(450)]
    r2 = engine.analyze(bearish_prices)
    print(f'  يومي: {r2.daily_score} | أسبوعي: {r2.weekly_score} | شهري: {r2.monthly_score}')
    print(f'  تقارب: {r2.confluence_score} | إشارة: {r2.signal}')

    print('\n=== تجربة بيانات فاضية ===')
    empty = engine.analyze([])
    print(f'  إشارة: {empty.signal} (متوقع: neutral)')

    print('\n=== تجربة shim للتوافق مع maestro ===')
    legacy = analyze_timeframes('TEST', bullish_prices)
    print(f'  ticker={legacy.ticker} daily.trend={legacy.daily.trend} '
          f'confluence.aligned_count={legacy.confluence.aligned_count}')

    print('\nOK ✓ كل التجارب اشتغلت بنجاح')
