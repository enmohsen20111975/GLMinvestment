#!/usr/bin/env python3
"""
Regime Filter — فلتر الاتجاه الإلزامي للسوق المصري (EGX)
============================================================
يمنع الدخول ضد الاتجاه. يطبق على مستوى السهم (قاعدة 29: UNIFIED-SYSTEM).

النسختان المدعومتان (لتجريب أيهما أفضل):
  - mode='A': Close > SMA50  (اتجاه صحي متوسط المدى)
  - mode='B': Close > SMA20 AND Close > SMA50  (تأكيد مزدوج — أصرم)

التكامل:
  - يُستخدم في evaluate_strict_entry() كـ pre-filter ( قبل is_late / is_grab).
  - يُستخدم في V40.2 entry pipeline خلف feature flag V40_2_REGIME_FILTER.
  - الـ dashboard backtest scripts تستدعيه مباشرة (testable in isolation).

لا ملفات مبعثرة — كل الـ helpers هنا. indicator primitives بـ تستخدم _sma/_rsi
من strict_entry_filters (نفس المصدر).

Author: Z.ai Code
Date: 2026-09-02
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any

from analyzers.indicators.ma import sma as _canonical_sma


# ═══════════════════════════════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════════════════════════════

# Regime thresholds (توجيه المالك 2026-09-02)
REGIME_MODE_A_SMA = 50            # النسخة أ: SMA50
REGIME_MODE_B_SMA_SHORT = 20      # النسخة ب: SMA20 + SMA50
REGIME_MODE_B_SMA_LONG = 50


# ═══════════════════════════════════════════════════════════════════════
# Helpers (تستخدم نفس primitives من strict_entry_filters — no duplication)
# ═══════════════════════════════════════════════════════════════════════

def _sma(values: List[float], period: int) -> Optional[float]:
    """Simple Moving Average — identical to strict_entry_filters._sma.

    BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma.
    """
    if len(values) < period or period <= 0:
        return None
    return _canonical_sma(values, period)


def compute_sma_series(closes: List[float], period: int) -> List[Optional[float]]:
    """Compute SMA series (None for warmup period).

    BRAVO UNIFY: delegates per-point to canonical analyzers.indicators.ma.sma.
    """
    out: List[Optional[float]] = []
    for i in range(len(closes)):
        if i + 1 < period:
            out.append(None)
        else:
            out.append(_canonical_sma(closes[:i + 1], period))
    return out


# ═══════════════════════════════════════════════════════════════════════
# Regime filter (per-stock)
# ═══════════════════════════════════════════════════════════════════════

def is_bullish_regime(closes: List[float],
                       mode: str = 'A',
                       ma_short_period: int = REGIME_MODE_B_SMA_SHORT,
                       ma_long_period: int = REGIME_MODE_A_SMA) -> Dict[str, Any]:
    """
    تحقق هل السهم في اتجاه صاعد (bullish regime) — مسموح بالدخول.

    Args:
        closes: قائمة أسعار الإغلاق (الأقدم → الأحدث).
        mode: 'A' = Close > SMA50 | 'B' = Close > SMA20 AND Close > SMA50.
        ma_short_period: للـ mode B (default 20).
        ma_long_period: default 50.

    Returns:
        {
            'is_bullish': bool,
            'mode': str,
            'close': float | None,
            'sma50': float | None,
            'sma20': float | None,
            'reason': str,
        }
    """
    if not closes or len(closes) < ma_long_period:
        return {
            'is_bullish': False,
            'mode': mode,
            'close': None,
            'sma50': None,
            'sma20': None,
            'reason': f'بيانات غير كافية ({len(closes) or 0} < {ma_long_period})',
        }

    close = closes[-1]
    sma_long = _sma(closes, ma_long_period)
    if sma_long is None:
        return {
            'is_bullish': False,
            'mode': mode,
            'close': close,
            'sma50': None,
            'sma20': None,
            'reason': 'SMA50 غير متاح',
        }

    sma_short = _sma(closes, ma_short_period) if mode == 'B' else None

    if mode == 'A':
        is_bull = close > sma_long
        reason = (
            f'Close ({close:.2f}) > SMA50 ({sma_long:.2f}) ✅ اتجاه صاعد'
            if is_bull else
            f'Close ({close:.2f}) ≤ SMA50 ({sma_long:.2f}) ❌ اتجاه هابط — ممنوع الدخول'
        )
        return {
            'is_bullish': is_bull,
            'mode': mode,
            'close': close,
            'sma50': sma_long,
            'sma20': None,
            'reason': reason,
        }

    if mode == 'B':
        if sma_short is None:
            return {
                'is_bullish': False,
                'mode': mode,
                'close': close,
                'sma50': sma_long,
                'sma20': None,
                'reason': f'SMA{ma_short_period} غير متاح',
            }
        is_bull = close > sma_short and close > sma_long
        cond_short = '✅' if close > sma_short else '❌'
        cond_long = '✅' if close > sma_long else '❌'
        reason = (
            f'Close ({close:.2f}) {cond_short}>SMA{ma_short_period} ({sma_short:.2f}) '
            f'AND {cond_long}>SMA{ma_long_period} ({sma_long:.2f}) → '
            f'{"✅ صاعد" if is_bull else "❌ غير صاعد — ممنوع الدخول"}'
        )
        return {
            'is_bullish': is_bull,
            'mode': mode,
            'close': close,
            'sma50': sma_long,
            'sma20': sma_short,
            'reason': reason,
        }

    return {
        'is_bullish': False,
        'mode': mode,
        'close': close,
        'sma50': sma_long,
        'sma20': sma_short,
        'reason': f'mode غير معروف: {mode}',
    }


def passes_regime_filter(closes: List[float], mode: str = 'A') -> bool:
    """Helper سريع: هل السهم اجتاز فلتر الـ regime؟"""
    return is_bullish_regime(closes, mode=mode)['is_bullish']


# ═══════════════════════════════════════════════════════════════════════
# Market-level regime (proxy) — للحماية من bear markets الكلية
# ═══════════════════════════════════════════════════════════════════════

def compute_market_proxy_index(per_ticker_closes: Dict[str, List[float]]) -> List[float]:
    """Build equal-weighted market index from per-ticker closes.

    Args:
        per_ticker_closes: {ticker: [c1, c2, ...]} — all same length.

    Returns:
        List[float]: cumulative market index starting at 100.
    """
    if not per_ticker_closes:
        return []
    # find common length
    n = min(len(v) for v in per_ticker_closes.values())
    if n < 2:
        return [100.0]

    # equal-weighted daily return
    index = [100.0]
    for i in range(1, n):
        rets = []
        for tk, closes in per_ticker_closes.items():
            if i < len(closes) and closes[i - 1] > 0:
                rets.append((closes[i] - closes[i - 1]) / closes[i - 1])
        if not rets:
            index.append(index[-1])
            continue
        avg_ret = sum(rets) / len(rets)
        index.append(index[-1] * (1.0 + avg_ret))
    return index


def is_market_bullish(per_ticker_closes: Dict[str, List[float]],
                       ma_period: int = 50) -> Dict[str, Any]:
    """Market-level regime based on equal-weighted EGX proxy."""
    index = compute_market_proxy_index(per_ticker_closes)
    if len(index) < ma_period:
        return {'is_bullish': False, 'index': index, 'reason': 'بيانات غير كافية للـ proxy'}
    sma = _sma(index, ma_period)
    if sma is None:
        return {'is_bullish': False, 'index': index, 'reason': 'SMA غير متاح'}
    is_bull = index[-1] > sma
    return {
        'is_bullish': is_bull,
        'index': index,
        'sma': sma,
        'reason': f'Proxy ({index[-1]:.2f}) {"<" if not is_bull else ">"} SMA{ma_period} ({sma:.2f})',
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test (run directly)
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    # synthetic test: bull then bear
    closes_bull = [10 + i*0.2 for i in range(60)]  # rising
    closes_bear = [20 - i*0.2 for i in range(60)]   # falling
    closes_side = [15 + 0.05 * ((-1)**i) for i in range(60)]  # sideways

    print('=== bull ===')
    print('A:', is_bullish_regime(closes_bull, 'A')['reason'])
    print('B:', is_bullish_regime(closes_bull, 'B')['reason'])
    print('=== bear ===')
    print('A:', is_bullish_regime(closes_bear, 'A')['reason'])
    print('B:', is_bullish_regime(closes_bear, 'B')['reason'])
    print('=== sideways ===')
    print('A:', is_bullish_regime(closes_side, 'A')['reason'])
    print('B:', is_bullish_regime(closes_side, 'B')['reason'])
