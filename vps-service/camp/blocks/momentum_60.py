"""Block: momentum_60 — زخم 60 يوم (تأكيد الاتجاه).

Formula: (close[-1] - close[-61]) / close[-61] * 100
Score: normalize -20% to +20% → 0 to 1
"""
from __future__ import annotations
from typing import Any, Dict


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    closes = price_data.get('closes', [])
    if len(closes) < 61:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'بيانات غير كافية (< 61 يوم)', 'metadata': {}}
    mom_60 = (closes[-1] - closes[-61]) / closes[-61] * 100 if closes[-61] > 0 else 0.0
    # Normalize: -20% → 0, +20% → 1
    score = min(1.0, max(0.0, (mom_60 + 20) / 40))
    return {
        'score': round(score, 4),
        'raw': round(mom_60, 2),
        'reason': f'Momentum-60 = {mom_60:+.1f}%',
        'metadata': {'mom_60': round(mom_60, 2), 'closes_used': 61}
    }
