"""Block: volume_surge — حجم فوق متوسط 20 يوم.

Formula: volume[-1] / avg(volume[-21:-1])
Score: <1.0 → 0.2, 1.0-2.0 linear → 0.2-1.0, >2.0 → 1.0
"""
from __future__ import annotations
from typing import Any, Dict


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    volumes = price_data.get('volumes', [])
    if len(volumes) < 21:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'بيانات غير كافية', 'metadata': {}}
    today_vol = volumes[-1]
    avg_20 = sum(volumes[-21:-1]) / 20
    if avg_20 <= 0:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'متوسط حجم = 0', 'metadata': {}}
    ratio = today_vol / avg_20
    if ratio < 1.0:
        score = 0.2
    elif ratio <= 2.0:
        score = 0.2 + (ratio - 1.0) * 0.8  # linear 0.2→1.0
    else:
        score = 1.0
    return {
        'score': round(score, 4),
        'raw': round(ratio, 2),
        'reason': f'Volume ratio = {ratio:.2f}× (today={today_vol:,}, avg20={avg_20:,.0f})',
        'metadata': {'ratio': round(ratio, 2), 'today_vol': today_vol, 'avg20': avg_20}
    }
