"""Block: distance_52w — قريب من قمة 52 أسبوع.

Formula: (close[-1] - high_52w) / high_52w * 100
Score: -30% → 0, 0% → 1.0 (at the high)
"""
from __future__ import annotations
from typing import Any, Dict


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    highs = price_data.get('highs', [])
    closes = price_data.get('closes', [])
    if len(highs) < 252:  # 52 weeks
        # Use available history
        if len(highs) < 20:
            return {'score': 0.5, 'raw': 0.0,
                    'reason': 'بيانات غير كافية', 'metadata': {}}
        high_52w = max(highs)
    else:
        high_52w = max(highs[-252:])
    close = closes[-1] if closes else 0
    if high_52w <= 0:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'high_52w = 0', 'metadata': {}}
    distance_pct = (close - high_52w) / high_52w * 100
    # Normalize: -30% → 0, 0% → 1.0
    score = min(1.0, max(0.0, (distance_pct + 30) / 30))
    return {
        'score': round(score, 4),
        'raw': round(distance_pct, 2),
        'reason': f'Distance from 52w high = {distance_pct:+.1f}% (high={high_52w:.2f})',
        'metadata': {'distance_pct': round(distance_pct, 2), 'high_52w': high_52w, 'close': close}
    }
