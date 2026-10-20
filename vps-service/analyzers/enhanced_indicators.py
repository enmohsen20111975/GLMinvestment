"""
Enhanced Technical Indicators Module
=====================================
مؤشرات تقنية محسّنة — MACD + Bollinger + Stochastic + ATR + ADX + Williams %R

الهدف: نرفع دقة التنبؤ فوق المؤشرات الأساسية (RSI/MA) اللي عملت 41.3% win rate.
كل المؤشرات بـ pure stdlib (math بس) — من غير numpy/pandas عشان نخليه خفيف.

المؤشرات المضافة:
1. MACD — تقاطع EMA12 و EMA26 مع signal line EMA9
2. Bollinger Bands — SMA20 ± 2*StdDev مع %B
3. Stochastic — %K و %D على 14 فترة
4. ATR — متوسط المدى الحقيقي 14 فترة (volatility)
5. ADX — قوة التريند مع +DI / -DI
6. Williams %R — مذبذب تشبع بيع/شراء

Author: دليل الاستثمار (GLMinvestment)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import math

# BRAVO UNIFY (Rule 67 — CALCULATION-CANONICAL): delegate Bollinger/ATR/ADX to canonical.
from analyzers.indicators.bollinger import calc_bollinger as _canonical_bollinger
from analyzers.indicators.atr import calc_atr as _canonical_atr
from analyzers.indicators.adx import calc_adx as _canonical_adx


@dataclass
class EnhancedIndicatorResult:
    """نتيجة المؤشرات المحسّنة — كل المؤشرات في كائن واحد."""

    # MACD
    macd_line: float = 0.0
    macd_signal: float = 0.0
    macd_histogram: float = 0.0
    macd_signal_type: str = 'neutral'  # 'bullish' / 'bearish' / 'neutral'

    # Bollinger Bands
    bb_upper: float = 0.0
    bb_middle: float = 0.0
    bb_lower: float = 0.0
    bb_percent_b: float = 50.0  # 0-100

    # Stochastic
    stochastic_k: float = 50.0
    stochastic_d: float = 50.0

    # ATR
    atr: float = 0.0
    atr_pct: float = 0.0  # ATR كنسبة من السعر

    # ADX
    adx: float = 0.0
    adx_plus_di: float = 0.0
    adx_minus_di: float = 0.0
    adx_trending: bool = False

    # Williams %R
    williams_r: float = -50.0

    # النتيجة الموحّدة
    composite_score: float = 50.0  # 0-100
    signal: str = 'HOLD'  # 'BUY' / 'SELL' / 'HOLD'
    confidence: float = 0.0  # 0-100


class EnhancedIndicators:
    """مؤشرات تقنية محسّنة — MACD + Bollinger + Stochastic + ATR + ADX + Williams %R"""

    # ---------- EMA ----------
    @staticmethod
    def calc_ema(values: list[float], period: int) -> list[float]:
        """
        حساب EMA لقائمة قيم.
        الصيغة: ema[i] = price[i] * multiplier + ema[i-1] * (1 - multiplier)
        multiplier = 2 / (period + 1)
        أول قيمة = SMA للـ period الأول.
        بيرجع list بكل قيم EMA (طوله = len(values) - period + 1).
        """
        if not values or period <= 0 or len(values) < period:
            return []

        multiplier = 2.0 / (period + 1)
        ema: list[float] = []
        # أول قيمة = SMA للنافذة الأولى
        first_window = values[:period]
        sma = sum(first_window) / period
        ema.append(sma)

        # بقية القيم بالصيغة التكرارية
        for i in range(period, len(values)):
            prev = ema[-1]
            new_ema = values[i] * multiplier + prev * (1 - multiplier)
            ema.append(new_ema)

        return ema

    # ---------- MACD ----------
    @staticmethod
    def calc_macd(prices: list[float], fast: int = 12, slow: int = 26,
                  signal: int = 9) -> tuple[float, float, float]:
        """
        حساب MACD.
        MACD line = EMA(fast) - EMA(slow)
        Signal line = EMA(signal) من MACD line
        Histogram = MACD - Signal
        بيرجع (macd_line, signal_line, histogram) لآخر قيمة بس.
        """
        if len(prices) < slow:
            return 0.0, 0.0, 0.0

        ema_fast = EnhancedIndicators.calc_ema(prices, fast)
        ema_slow = EnhancedIndicators.calc_ema(prices, slow)
        if not ema_fast or not ema_slow:
            return 0.0, 0.0, 0.0

        # محاذاة الطول — ema_slow أقصر من ema_fast بفرق (slow - fast)
        offset = len(ema_fast) - len(ema_slow)
        macd_line = [ema_fast[i + offset] - ema_slow[i] for i in range(len(ema_slow))]

        signal_line = EnhancedIndicators.calc_ema(macd_line, signal)
        if not signal_line:
            # لو معندناش signal كافي، نرجّع MACD و histogram = MACD
            current_macd = macd_line[-1] if macd_line else 0.0
            return current_macd, 0.0, current_macd

        current_macd = macd_line[-1]
        current_signal = signal_line[-1]
        hist = current_macd - current_signal

        return current_macd, current_signal, hist

    # ---------- Bollinger ----------
    @staticmethod
    def calc_bollinger(prices: list[float], period: int = 20,
                       std_dev: float = 2.0) -> tuple[float, float, float, float]:
        """
        حساب Bollinger Bands — BRAVO UNIFY: delegates to canonical analyzers.indicators.bollinger.
        بيرجع (upper, middle, lower, percent_b).
        Rule 27 (NO-FAKE-DATA): لو البيانات غير كافية → بيرجّع (None, None, None, None).
        """
        result = _canonical_bollinger(prices, period, std_dev)
        if result is None:
            return None, None, None, None
        return (result['upper'], result['middle'], result['lower'], result['percent_b'])

    # ---------- Stochastic ----------
    @staticmethod
    def calc_stochastic(highs: list[float], lows: list[float], closes: list[float],
                        k_period: int = 14, d_period: int = 3
                        ) -> tuple[float, float]:
        """
        حساب Stochastic Oscillator.
        %K = (close - lowest_low) / (highest_high - lowest_low) * 100
        %D = SMA(d_period) من %K
        بيرجع (%K, %D) لآخر قيمة.
        """
        n = min(len(highs), len(lows), len(closes))
        if n < k_period:
            return 50.0, 50.0

        # نحسب %K لكل نافذة كاملة
        k_values: list[float] = []
        for i in range(k_period - 1, n):
            window_high = highs[i - k_period + 1: i + 1]
            window_low = lows[i - k_period + 1: i + 1]
            hh = max(window_high)
            ll = min(window_low)
            close = closes[i]
            if hh - ll == 0:
                k = 50.0
            else:
                k = (close - ll) / (hh - ll) * 100.0
            k_values.append(k)

        if not k_values:
            return 50.0, 50.0

        current_k = k_values[-1]
        if len(k_values) < d_period:
            return current_k, current_k

        d_window = k_values[-d_period:]
        current_d = sum(d_window) / d_period

        return current_k, current_d

    # ---------- ATR ----------
    @staticmethod
    def calc_atr(highs: list[float], lows: list[float], closes: list[float],
                 period: int = 14) -> Optional[float]:
        """
        حساب Average True Range — BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.
        Rule 67: canonical بـ Wilder's smoothing (مش SMA القديم).
        Rule 27 (NO-FAKE-DATA): لو البيانات غير كافية → بيرجّع None (مش 0.0).
        True Range = max(high-low, |high-prev_close|, |low-prev_close|)
        ATR = Wilder's smoothing(TR, period).
        """
        return _canonical_atr(highs, lows, closes, period)

    # ---------- ADX ----------
    @staticmethod
    def calc_adx(highs: list[float], lows: list[float], closes: list[float],
                 period: int = 14) -> tuple[Optional[float], Optional[float], Optional[float], bool]:
        """
        حساب ADX — BRAVO UNIFY: delegates to canonical analyzers.indicators.adx (Wilder's).
        Rule 27 (NO-FAKE-DATA): لو البيانات غير كافية → بيرجّع (None, None, None, False).
        بيرجع (adx, plus_di, minus_di, trending).
        trending = True لو ADX > 25.
        """
        result = _canonical_adx(highs, lows, closes, period)
        if result is None:
            return None, None, None, False
        return (result['adx'], result['plus_di'], result['minus_di'], result['adx'] > 25.0)

    # ---------- Williams %R ----------
    @staticmethod
    def calc_williams_r(highs: list[float], lows: list[float], closes: list[float],
                        period: int = 14) -> float:
        """
        حساب Williams %R.
        %R = (highest_high - close) / (highest_high - lowest_low) * -100
        بيرجع قيمة بين -100 و 0.
        """
        n = min(len(highs), len(lows), len(closes))
        if n < period:
            return -50.0

        window_high = highs[n - period: n]
        window_low = lows[n - period: n]
        hh = max(window_high)
        ll = min(window_low)
        close = closes[-1]

        if hh - ll == 0:
            return -50.0

        return (hh - close) / (hh - ll) * -100.0

    # ---------- Composite Analysis ----------
    def analyze(self, prices: list[float], highs: list[float] | None = None,
                lows: list[float] | None = None,
                volumes: list[float] | None = None) -> EnhancedIndicatorResult:
        """
        تحليل شامل — يجمع كل المؤشرات ويعطي score موحّد من 0 لـ 100.
        لو highs/lows مش متوفرة، نستخدم prices كـ proxy.
        volumes بتقبل كـ argument لكن مش بتستخدم (محجوزة لمؤشرات مستقبلية).
        """
        if not prices:
            return EnhancedIndicatorResult()

        # proxy لو highs/lows مش موجودة
        if highs is None:
            highs = list(prices)
        if lows is None:
            lows = list(prices)

        result = EnhancedIndicatorResult()

        # 1) MACD — معالجة floating-point precision بحد نسبي
        macd_line, signal_line, hist = self.calc_macd(prices)
        result.macd_line = macd_line
        result.macd_signal = signal_line
        result.macd_histogram = hist
        price_ref = abs(prices[-1]) if prices else 1.0
        if price_ref < 1.0:
            price_ref = 1.0
        hist_eps = 1e-9 * price_ref  # حد التسامح نسبياً للسعر
        if abs(hist) < hist_eps:
            result.macd_signal_type = 'neutral'
        elif hist > 0:
            result.macd_signal_type = 'bullish'
        else:
            result.macd_signal_type = 'bearish'

        # 2) Bollinger Bands
        upper, middle, lower, percent_b = self.calc_bollinger(prices)
        result.bb_upper = upper
        result.bb_middle = middle
        result.bb_lower = lower
        result.bb_percent_b = percent_b

        # 3) Stochastic
        k, d = self.calc_stochastic(highs, lows, prices)
        result.stochastic_k = k
        result.stochastic_d = d

        # 4) ATR
        atr = self.calc_atr(highs, lows, prices)
        result.atr = atr
        if prices[-1] > 0:
            result.atr_pct = (atr / prices[-1]) * 100.0

        # 5) ADX
        adx, plus_di, minus_di, trending = self.calc_adx(highs, lows, prices)
        result.adx = adx
        result.adx_plus_di = plus_di
        result.adx_minus_di = minus_di
        result.adx_trending = trending

        # 6) Williams %R
        result.williams_r = self.calc_williams_r(highs, lows, prices)

        # ---------- Composite Scoring ----------
        score = 50.0  # Base score

        # MACD: bullish +15 / bearish -15
        if result.macd_signal_type == 'bullish':
            score += 15.0
        elif result.macd_signal_type == 'bearish':
            score -= 15.0

        # Bollinger %B: oversold +10 / overbought -10
        if percent_b < 20.0:
            score += 10.0
        elif percent_b > 80.0:
            score -= 10.0

        # Stochastic %K: oversold +10 / overbought -10
        if k < 20.0:
            score += 10.0
        elif k > 80.0:
            score -= 10.0

        # ADX: trending +DI>-DI +15 / trending -DI>+DI -15
        if adx > 25.0:
            if plus_di > minus_di:
                score += 15.0
            elif minus_di > plus_di:
                score -= 15.0

        # Williams %R: < -80 oversold +5 / > -20 overbought -5
        if result.williams_r < -80.0:
            score += 5.0
        elif result.williams_r > -20.0:
            score -= 5.0

        # Clamp 0-100
        score = max(0.0, min(100.0, score))
        result.composite_score = score

        # Signal: BUY >= 60 / SELL <= 40 / HOLD otherwise
        if score >= 60.0:
            result.signal = 'BUY'
        elif score <= 40.0:
            result.signal = 'SELL'
        else:
            result.signal = 'HOLD'

        # Confidence: مدى بعدنا عن الـ 50 × 2
        result.confidence = abs(score - 50.0) * 2.0

        return result


# =================== Self-test ===================
if __name__ == '__main__':
    print('=' * 60)
    print('  Enhanced Indicators Self-Test')
    print('=' * 60)

    # داتا تجريبية — 60 يوم بتريند صاعد وضوضاء
    base = 100.0
    test_prices: list[float] = []
    test_highs: list[float] = []
    test_lows: list[float] = []
    for i in range(60):
        noise = math.sin(i * 0.5) * 2.0
        price = base + i * 0.5 + noise
        test_prices.append(round(price, 2))
        test_highs.append(round(price + 1.5, 2))
        test_lows.append(round(price - 1.5, 2))

    engine = EnhancedIndicators()
    result = engine.analyze(test_prices, test_highs, test_lows)

    print(f'\n[MACD]      line={result.macd_line:.4f}  signal={result.macd_signal:.4f}  '
          f'hist={result.macd_histogram:.4f}  type={result.macd_signal_type}')
    print(f'[Bollinger] upper={result.bb_upper:.4f}  mid={result.bb_middle:.4f}  '
          f'lower={result.bb_lower:.4f}  %B={result.bb_percent_b:.2f}')
    print(f'[Stochastic] %K={result.stochastic_k:.2f}  %D={result.stochastic_d:.2f}')
    print(f'[ATR]       value={result.atr:.4f}  pct={result.atr_pct:.2f}%')
    print(f'[ADX]       adx={result.adx:.2f}  +DI={result.adx_plus_di:.2f}  '
          f'-DI={result.adx_minus_di:.2f}  trending={result.adx_trending}')
    print(f'[Williams %R] {result.williams_r:.2f}')

    print(f'\n{"=" * 60}')
    print(f'  Composite Score : {result.composite_score:.2f}/100')
    print(f'  Signal          : {result.signal}')
    print(f'  Confidence      : {result.confidence:.2f}%')
    print(f'{"=" * 60}')

    # اختبار edge cases
    print('\n--- Edge Cases ---')
    empty_result = engine.analyze([])
    print(f'Empty data      -> Signal: {empty_result.signal}, Score: {empty_result.composite_score}')
    short_result = engine.analyze([100, 101, 99, 100, 102])
    print(f'Short data      -> Signal: {short_result.signal}, Score: {short_result.composite_score}')
    prices_only = engine.analyze([100 + i for i in range(40)])
    print(f'Prices only     -> Signal: {prices_only.signal}, Score: {prices_only.composite_score}')
    bear_prices = [100 - i * 0.5 for i in range(50)]
    bear_highs = [p + 1 for p in bear_prices]
    bear_lows = [p - 1 for p in bear_prices]
    bear_result = engine.analyze(bear_prices, bear_highs, bear_lows)
    print(f'Bearish trend   -> Signal: {bear_result.signal}, Score: {bear_result.composite_score}')

    print('\n' + '=' * 60)
    print('  Self-test complete!')
    print('=' * 60)
