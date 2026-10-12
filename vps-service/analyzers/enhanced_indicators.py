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
import math


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
        حساب Bollinger Bands.
        Middle = SMA(period)
        Upper = Middle + std_dev * StdDev
        Lower = Middle - std_dev * StdDev
        percent_b = (price - lower) / (upper - lower) * 100
        بيرجع (upper, middle, lower, percent_b).
        """
        if len(prices) < period:
            return 0.0, 0.0, 0.0, 50.0

        window = prices[-period:]
        middle = sum(window) / period
        variance = sum((x - middle) ** 2 for x in window) / period
        sd = math.sqrt(variance)

        upper = middle + std_dev * sd
        lower = middle - std_dev * sd

        price = prices[-1]
        if upper - lower == 0:
            percent_b = 50.0
        else:
            percent_b = (price - lower) / (upper - lower) * 100.0

        return upper, middle, lower, percent_b

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
    # PKG4-DEV-A (Engine Unification): كان بيستخدم SMA(period) وهذا غلط رياضيًا
    # حسب Rule 54 (CALCULATION-CANONICAL) — ATR لازم Wilder's smoothing.
    # تم توحيد الحساب ليطابق analyzers/indicators/atr.py (canonical).
    @staticmethod
    def calc_atr(highs: list[float], lows: list[float], closes: list[float],
                 period: int = 14) -> float:
        """
        حساب Average True Range بصيغة Wilder's smoothing (canonical — Rule 54).

        True Range = max(high-low, |high-prev_close|, |low-prev_close|)
        ATR = (ATR_prev × (period-1) + TR) / period   ← Wilder's smoothing

        المرجعية: analyzers/indicators/atr.py (المصدر الموحّد الوحيد).
        لو فيه محتاج API قائمة (Tuple/List) بيُفضّل استيراد canonical مباشرةً.
        """
        n = min(len(highs), len(lows), len(closes))
        if n < 2:
            return 0.0

        tr_values: list[float] = []
        for i in range(1, n):
            tr1 = highs[i] - lows[i]
            tr2 = abs(highs[i] - closes[i - 1])
            tr3 = abs(lows[i] - closes[i - 1])
            tr = max(tr1, tr2, tr3)
            tr_values.append(tr)

        if not tr_values:
            return 0.0

        if len(tr_values) < period:
            # لو الداتا أقل من المطلوب نرجّع متوسط اللي موجود
            return sum(tr_values) / len(tr_values)

        # Wilder's smoothing (canonical — لا SMA).
        # seed = simple average of first `period` TRs, then recursive smoothing.
        atr = sum(tr_values[:period]) / period
        for i in range(period, len(tr_values)):
            atr = (atr * (period - 1) + tr_values[i]) / period
        return round(atr, 4)

    # ---------- ADX ----------
    @staticmethod
    def calc_adx(highs: list[float], lows: list[float], closes: list[float],
                 period: int = 14) -> tuple[float, float, float, bool]:
        """
        حساب ADX (Average Directional Index) بطريقة Wilder.
        +DI / -DI باستخدام Wilder's smoothing.
        بيرجع (adx, plus_di, minus_di, trending).
        trending = True لو ADX > 25.
        """
        n = min(len(highs), len(lows), len(closes))
        if n < period + 2:
            return 0.0, 0.0, 0.0, False

        # 1) نحسب +DM, -DM, TR لكل فترة
        plus_dm: list[float] = []
        minus_dm: list[float] = []
        tr: list[float] = []
        for i in range(1, n):
            up_move = highs[i] - highs[i - 1]
            down_move = lows[i - 1] - lows[i]

            p_dm = up_move if (up_move > down_move and up_move > 0) else 0.0
            m_dm = down_move if (down_move > up_move and down_move > 0) else 0.0

            tr1 = highs[i] - lows[i]
            tr2 = abs(highs[i] - closes[i - 1])
            tr3 = abs(lows[i] - closes[i - 1])
            tr_val = max(tr1, tr2, tr3)

            plus_dm.append(p_dm)
            minus_dm.append(m_dm)
            tr.append(tr_val)

        # 2) Wilder's smoothing — بيخزن الـ sum-level (مش average)
        def wilder_smooth(values: list[float], p: int) -> list[float]:
            if len(values) < p:
                return []
            smoothed: list[float] = []
            first = sum(values[:p])
            smoothed.append(first)
            for i in range(p, len(values)):
                prev = smoothed[-1]
                new_val = prev - (prev / p) + values[i]
                smoothed.append(new_val)
            return smoothed

        sm_plus = wilder_smooth(plus_dm, period)
        sm_minus = wilder_smooth(minus_dm, period)
        sm_tr = wilder_smooth(tr, period)

        if not sm_plus or not sm_minus or not sm_tr:
            return 0.0, 0.0, 0.0, False

        # 3) +DI / -DI و DX
        k = min(len(sm_plus), len(sm_minus), len(sm_tr))
        dx_values: list[float] = []
        plus_di_last = 0.0
        minus_di_last = 0.0
        for i in range(k):
            if sm_tr[i] == 0:
                continue
            p_di = 100.0 * sm_plus[i] / sm_tr[i]
            m_di = 100.0 * sm_minus[i] / sm_tr[i]
            plus_di_last = p_di
            minus_di_last = m_di
            denom = p_di + m_di
            if denom == 0:
                dx_values.append(0.0)
            else:
                dx_values.append(100.0 * abs(p_di - m_di) / denom)

        if not dx_values:
            return 0.0, 0.0, 0.0, False

        # 4) ADX = Wilder's smoothing of DX (نقسم على period عشان نرجّع average)
        if len(dx_values) < period:
            adx = sum(dx_values) / len(dx_values)
        else:
            sm_dx = wilder_smooth(dx_values, period)
            if not sm_dx:
                adx = sum(dx_values) / len(dx_values)
            else:
                adx = sm_dx[-1] / period

        trending = adx > 25.0
        return adx, plus_di_last, minus_di_last, trending

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
