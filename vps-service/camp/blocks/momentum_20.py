"""Block: momentum_20 — زخم 20 يوم (نسبة التغير).

Formula: (close[-1] - close[-21]) / close[-21] * 100
Score: normalize -10% to +10% → 0 to 1
"""
from __future__ import annotations
from typing import Any, Dict


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    closes = price_data.get('closes', [])
    if len(closes) < 21:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'بيانات غير كافية (< 21 يوم)', 'metadata': {}}
    mom_20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if closes[-21] > 0 else 0.0
    # Normalize: -10% → 0, +10% → 1
    score = min(1.0, max(0.0, (mom_20 + 10) / 20))
    return {
        'score': round(score, 4),
        'raw': round(mom_20, 2),
        'reason': f'Momentum-20 = {mom_20:+.1f}%',
        'metadata': {'mom_20': round(mom_20, 2), 'closes_used': 21}
    }
