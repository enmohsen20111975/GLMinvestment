"""
محرك تحليل حجم التداول (Volume Profile Engine)
Volume Profile Analyzer

بيعمل تحليل للحجم ومؤشراته عشان يحسن دقة التوقع:
- VWAP (متوسط السعر الموزون بالحجم)
- OBV (On Balance Volume — حجم الرصيد)
- كشف طفرات الحجم (volume spike > 1.5x المتوسط)
- خط التجميع/التوزيع (Accumulation/Distribution Line)
- تحديد عقد الحجم (Volume Nodes) = مستويات الدعم/المقاومة

السكور النهائي:
- سعر فوق VWAP + OBV صاعد + طفرة حجم → إيجابي (70+)
- سعر تحت VWAP + OBV هابط → سلبي (30-)
- غير كده → محايد

@version 1.0.0
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

from analyzers.indicators.vwap import calc_vwap as _canonical_calc_vwap


# ==================== DATACLASS ====================

@dataclass
class VolumeProfileResult:
    """نتيجة محرك تحليل الحجم"""
    vwap: float                              # متوسط السعر الموزون بالحجم
    obv: float                               # On Balance Volume الحالي
    volume_trend: str                        # accumulating | distributing | neutral
    volume_spike: bool                       # طفرة حجم في آخر شمعة (>1.5x المتوسط)
    vwap_distance_pct: float                 # بُعد السعر عن VWAP بالنسبة المئوية
    volume_nodes: List[float]                # مستويات الدعم/المقاومة من عقد الحجم
    ad_line: float                           # خط التجميع/التوزيع (Accumulation/Distribution)
    score: float                             # 0-100
    signal: str                              # bullish | bearish | neutral
    signals: List[str] = field(default_factory=list)


# ==================== HELPERS ====================

def _to_float(v: Any, fallback: float = 0.0) -> float:
    """تحويل آمن لأرقام عشرية"""
    try:
        return float(v) if v is not None else fallback
    except (TypeError, ValueError):
        return fallback


def _extract_series(prices: List[Any], volumes: List[Any]) -> Tuple[List[float], List[float]]:
    """استخراج أسعار الإغلاق + الحجوم من مدخلات مختلطة (Dict أو رقم)"""
    closes: List[float] = []
    vols: List[float] = []

    for i, p in enumerate(prices):
        if isinstance(p, (int, float)):
            closes.append(float(p))
        elif isinstance(p, dict):
            closes.append(_to_float(p.get('close', p.get('close_price', 0))))
        else:
            closes.append(0.0)

        if i < len(volumes):
            v = volumes[i]
            if isinstance(v, (int, float)):
                vols.append(float(v))
            elif isinstance(v, dict):
                vols.append(_to_float(v.get('volume', 0)))
            else:
                vols.append(0.0)
        else:
            vols.append(0.0)

    # لو السلسلتين بأطوال مختلفة نآخذ الحد الأدنى
    n = min(len(closes), len(vols))
    return closes[:n], vols[:n]


def _calc_vwap(closes: List[float], volumes: List[float]) -> float:
    """حساب VWAP = Σ(price × volume) / Σ(volume).

    BRAVO UNIFY: delegates to canonical analyzers.indicators.vwap.calc_vwap.
    Uses closes for highs/lows (typical_price ≡ close in the simple mode) so the
    canonical session/cumulative VWAP matches the legacy simple formula.
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    if not closes or not volumes:
        return 0.0
    vwap = _canonical_calc_vwap(closes, closes, closes, volumes, period=None)
    if vwap is None:
        return closes[-1] if closes else 0.0
    return vwap


def _calc_obv(closes: List[float], volumes: List[float]) -> float:
    """حساب OBV: لو السعر طلع نضيف الحجم، لو نزل نطرحه، لو ثابت نسيبه"""
    if len(closes) < 2:
        return 0.0
    obv = 0.0
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            obv += volumes[i]
        elif closes[i] < closes[i - 1]:
            obv -= volumes[i]
    return obv


def _calc_ad_line(closes: List[float], highs: List[float],
                  lows: List[float], volumes: List[float]) -> float:
    """خط التجميع/التوزيع — يستخدم Money Flow Multiplier.

    MFM = ((Close - Low) - (High - Close)) / (High - Low)
    AD = AD_prev + MFM × Volume

    لو مفيش highs/lows بنستخدم close كبديل (نطاق صفري → AD = 0).
    """
    if not closes or not volumes:
        return 0.0
    ad = 0.0
    for i in range(len(closes)):
        h = highs[i] if i < len(highs) and highs[i] else closes[i]
        l = lows[i] if i < len(lows) and lows[i] else closes[i]
        rng = h - l
        if rng == 0:
            continue
        mfm = ((closes[i] - l) - (h - closes[i])) / rng
        ad += mfm * volumes[i]
    return ad


def _detect_volume_spike(volumes: List[float], threshold: float = 1.5) -> bool:
    """كشف طفرة حجم: آخر حجم > threshold × متوسط الـ 20 شمعة السابقة"""
    if len(volumes) < 5:
        return False
    last = volumes[-1]
    if last == 0:
        return False
    window = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
    if not window:
        return False
    avg = sum(window) / len(window)
    if avg == 0:
        return False
    return last > (avg * threshold)


def _find_volume_nodes(closes: List[float], volumes: List[float],
                       bins: int = 10) -> List[float]:
    """تقسيم نطاق الأسعار لـ bins وتحديد أعلى البينات = عقد حجم (دعم/مقاومة).

    البينات اللي فيها حجم > 1.3x المتوسط بنتعتبرها "High Volume Nodes".
    """
    if not closes or not volumes or len(closes) < 5:
        return []
    lo, hi = min(closes), max(closes)
    if hi == lo:
        return [round(lo, 2)]
    step = (hi - lo) / bins
    bin_vols = [0.0] * bins
    bin_centers = [lo + step * (i + 0.5) for i in range(bins)]
    for c, v in zip(closes, volumes):
        idx = int((c - lo) / step)
        if idx >= bins:
            idx = bins - 1
        elif idx < 0:
            idx = 0
        bin_vols[idx] += v
    avg_vol = sum(bin_vols) / bins if bins else 0
    if avg_vol == 0:
        return []
    nodes = [round(bin_centers[i], 2) for i in range(bins)
             if bin_vols[i] > avg_vol * 1.3]
    return nodes


def _classify_volume_trend(ad_line: float, ad_prev: Optional[float]) -> str:
    """تصنيف اتجاه الحجم بناءً على اتجاه خط AD"""
    if ad_prev is None:
        return 'neutral'
    if ad_line > ad_prev:
        return 'accumulating'
    if ad_line < ad_prev:
        return 'distributing'
    return 'neutral'


# ==================== ENGINE ====================

class VolumeProfileAnalyzer:
    """محرك تحليل حجم التداول

    بيحسب VWAP, OBV, A/D Line, عقد الحجم، وطفرات الحجم
    وبيطلع سكور + إشارة (إيجابي/سلبي/محايد).
    """

    def analyze(self, prices: list, volumes: list) -> VolumeProfileResult:
        """تحليل قائمتين (أسعار + حجوم) وإرجاع نتيجة محرك الحجم."""
        # حالات الحافة
        if not prices or not volumes:
            return VolumeProfileResult(
                vwap=0.0, obv=0.0, volume_trend='neutral', volume_spike=False,
                vwap_distance_pct=0.0, volume_nodes=[], ad_line=0.0,
                score=50.0, signal='neutral',
                signals=['المدخلات فاضية - مفيش بيانات']
            )

        closes, vols = _extract_series(prices, volumes)
        if not closes or len(closes) < 2:
            return VolumeProfileResult(
                vwap=0.0, obv=0.0, volume_trend='neutral', volume_spike=False,
                vwap_distance_pct=0.0, volume_nodes=[], ad_line=0.0,
                score=50.0, signal='neutral',
                signals=['بيانات غير كافية - لازم على الأقل شمعتين']
            )

        current_price = closes[-1]
        vwap = _calc_vwap(closes, vols)
        obv = _calc_obv(closes, vols)
        spike = _detect_volume_spike(vols, threshold=1.5)
        nodes = _find_volume_nodes(closes, vols, bins=10)

        # خط AD الحالي vs السابق (لتحديد الاتجاه)
        ad_now = _calc_ad_line(closes, closes, closes, vols)  # closes كبديل لـ high/low
        ad_prev_val: Optional[float] = None
        if len(closes) > 5:
            ad_prev_val = _calc_ad_line(closes[:-1], closes[:-1], closes[:-1], vols[:-1])
        vol_trend = _classify_volume_trend(ad_now, ad_prev_val)

        # بُعد السعر عن VWAP
        if vwap > 0:
            vwap_dist = ((current_price - vwap) / vwap) * 100.0
        else:
            vwap_dist = 0.0

        # اتجاه OBV (صاعد لو آخر 5 قيم بتزيد)
        obv_recent = _calc_obv(closes[-5:], vols[-5:]) if len(closes) >= 5 else 0.0
        obv_prev = _calc_obv(closes[-10:-5], vols[-10:-5]) if len(closes) >= 10 else 0.0
        obv_rising = obv_recent > obv_prev
        obv_falling = obv_recent < obv_prev

        # ========= المنطق =========
        signals: List[str] = []
        score = 50.0

        # 1) السعر vs VWAP
        if current_price > vwap:
            score += 10
            signals.append(f'السعر فوق VWAP ({vwap:.2f}) — إيجابي')
        elif current_price < vwap:
            score -= 10
            signals.append(f'السعر تحت VWAP ({vwap:.2f}) — سلبي')
        else:
            signals.append(f'السعر عند VWAP ({vwap:.2f}) — محايد')

        # 2) OBV
        if obv_rising:
            score += 10
            signals.append('OBV صاعد — ضغط شرائي')
        elif obv_falling:
            score -= 10
            signals.append('OBV هابط — ضغط بيعي')
        else:
            signals.append('OBV ثابت')

        # 3) طفرة الحجم
        if spike:
            score += 5
            signals.append('طفرة حجم تداول (>1.5x المتوسط)')

        # 4) اتجاه الحجم (تجميع/توزيع)
        if vol_trend == 'accumulating':
            score += 8
            signals.append('الحجم في وضع تجميع')
        elif vol_trend == 'distributing':
            score -= 8
            signals.append('الحجم في وضع توزيع')

        # 5) عقد الحجم القريبة من السعر
        if nodes:
            closest = min(nodes, key=lambda n: abs(n - current_price))
            if abs(closest - current_price) / current_price < 0.02:
                signals.append(f'السعر قرب عقدة حجم رئيسية ({closest:.2f})')

        score = max(0.0, min(100.0, round(score, 2)))
        signal = 'bullish' if score >= 70 else 'bearish' if score <= 30 else 'neutral'

        return VolumeProfileResult(
            vwap=round(vwap, 4),
            obv=round(obv, 2),
            volume_trend=vol_trend,
            volume_spike=spike,
            vwap_distance_pct=round(vwap_dist, 2),
            volume_nodes=nodes,
            ad_line=round(ad_now, 2),
            score=score,
            signal=signal,
            signals=signals,
        )


# ==================== SELF-TEST ====================

if __name__ == '__main__':
    print('=== تجربة VolumeProfileAnalyzer (إيجابي) ===')
    # أسعار بتطلع تدريجياً + حجم بيزيد
    prices = [100 + i * 0.5 for i in range(30)]
    volumes = [1000 + i * 50 for i in range(30)]
    # طفرة حجم في آخر شمعة
    volumes[-1] = volumes[-2] * 2.0

    analyzer = VolumeProfileAnalyzer()
    r = analyzer.analyze(prices, volumes)
    print(f'  VWAP:                {r.vwap}')
    print(f'  OBV:                 {r.obv}')
    print(f'  اتجاه الحجم:         {r.volume_trend}')
    print(f'  طفرة حجم:            {r.volume_spike}')
    print(f'  بُعد السعر عن VWAP:  {r.vwap_distance_pct}%')
    print(f'  عقد الحجم:           {r.volume_nodes}')
    print(f'  خط AD:               {r.ad_line}')
    print(f'  السكور:              {r.score} | الإشارة: {r.signal}')
    print(f'  إشارات:              {r.signals[:3]}')

    print('\n=== تجربة ترند هابط ===')
    prices2 = [200 - i * 0.7 for i in range(30)]
    volumes2 = [2000 + i * 30 for i in range(30)]
    r2 = analyzer.analyze(prices2, volumes2)
    print(f'  السكور: {r2.score} | الإشارة: {r2.signal}')

    print('\n=== تجربة بيانات فاضية ===')
    r3 = analyzer.analyze([], [])
    print(f'  الإشارة: {r3.signal} (متوقع: neutral)')

    print('\n=== تجربة Dict inputs ===')
    dict_prices = [{'close': 100 + i * 0.3} for i in range(25)]
    dict_vols = [{'volume': 1500 + i * 20} for i in range(25)]
    r4 = analyzer.analyze(dict_prices, dict_vols)
    print(f'  VWAP: {r4.vwap} | الإشارة: {r4.signal}')

    print('\nOK ✓ كل التجارب اشتغلت بنجاح')
