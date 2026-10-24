"""
candlestick.py — كشف أنماط الشموع اليابانية (Phase 9.1 — Strangler Pattern V2)
================================================================================

اتسحب من master_analyzer.py (lines 579-631).

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

from typing import List, Dict


def _detect_candlestick_patterns(ohlcv) -> List[Dict]:
    """كشف أنماط الشموع اليابانية على آخر شمعتين.

    يُرجع قائمة من dicts: {name, name_ar, signal, strength}.
    signal: 'bullish' | 'bearish' | 'neutral'
    strength: 'weak' | 'medium' | 'strong'
    """
    patterns = []
    if len(ohlcv) < 2:
        return patterns
    last = ohlcv[-1]
    prev = ohlcv[-2]

    o, c = float(last.get('open', 0)), float(last.get('close', 0))
    h, l = float(last.get('high', 0)), float(last.get('low', 0))
    po, pc = float(prev.get('open', 0)), float(prev.get('close', 0))

    body = abs(c - o)
    range_ = h - l
    if range_ <= 0:
        return patterns

    lower_wick = min(o, c) - l
    upper_wick = h - max(o, c)

    # Doji (تردد)
    if body / range_ < 0.1:
        patterns.append({'name': 'Doji', 'name_ar': 'دوجي',
                         'signal': 'neutral', 'strength': 'weak'})

    # Hammer (مطرقة - إيجابي عند القاع)
    if body > 0 and lower_wick > 2 * body and upper_wick < body * 0.5:
        patterns.append({'name': 'Hammer', 'name_ar': 'مطرقة',
                         'signal': 'bullish', 'strength': 'medium'})

    # Shooting Star (نجم هابط - سلبي عند القمة)
    if body > 0 and upper_wick > 2 * body and lower_wick < body * 0.5:
        patterns.append({'name': 'Shooting Star', 'name_ar': 'نجم هابط',
                         'signal': 'bearish', 'strength': 'medium'})

    # Bullish Engulfing (ابتلاع صعودي)
    if po > 0 and pc < po and c > o:
        if c >= po and o <= pc:
            patterns.append({'name': 'Bullish Engulfing', 'name_ar': 'ابتلاع صعودي',
                             'signal': 'bullish', 'strength': 'strong'})

    # Bearish Engulfing (ابتلاع هبوطي)
    if po > 0 and pc > po and c < o:
        if o >= pc and c <= po:
            patterns.append({'name': 'Bearish Engulfing', 'name_ar': 'ابتلاع هبوطي',
                             'signal': 'bearish', 'strength': 'strong'})

    return patterns
