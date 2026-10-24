"""Block: volume_price_div — تباين حجم-سعر (accumulation signal).

Logic: if volume increasing but price flat/falling → accumulation (smart money buying quietly)
       if volume increasing AND price rising → confirmation (normal)
       if volume falling AND price rising → distribution (weak rally)

Score:
  - Volume up + Price flat/down → 1.0 (accumulation)
  - Volume up + Price up → 0.7 (confirmed move)
  - Volume down + Price up → 0.3 (weak rally, distribution)
  - Volume down + Price down → 0.5 (capitulation, neutral)
"""
from __future__ import annotations
from typing import Any, Dict


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    closes = price_data.get('closes', [])
    volumes = price_data.get('volumes', [])
    if len(closes) < 11 or len(volumes) < 11:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'بيانات غير كافية', 'metadata': {}}
    # Compare last 5 days vs previous 5 days
    recent_closes = closes[-5:]
    prev_closes = closes[-10:-5]
    recent_vols = volumes[-5:]
    prev_vols = volumes[-10:-5]
    avg_recent_vol = sum(recent_vols) / 5 if recent_vols else 0
    avg_prev_vol = sum(prev_vols) / 5 if prev_vols else 0
    avg_recent_close = sum(recent_closes) / 5
    avg_prev_close = sum(prev_closes) / 5
    if avg_prev_vol <= 0 or avg_prev_close <= 0:
        return {'score': 0.5, 'raw': 0.0,
                'reason': 'متوسطات = 0', 'metadata': {}}
    vol_change = (avg_recent_vol - avg_prev_vol) / avg_prev_vol * 100
    price_change = (avg_recent_close - avg_prev_close) / avg_prev_close * 100
    vol_up = vol_change > 5
    vol_down = vol_change < -5
    price_up = price_change > 1
    price_down = price_change < -1
    if vol_up and not price_up:
        # Volume rising, price flat/down → accumulation
        score = 1.0
        pattern = 'تراكم (accumulation)'
    elif vol_up and price_up:
        # Both up → confirmed move
        score = 0.7
        pattern = 'تأكيد صعود (confirmed)'
    elif vol_down and price_up:
        # Volume falling, price rising → weak rally / distribution
        score = 0.3
        pattern = 'صعود ضعيف (distribution)'
    elif vol_down and price_down:
        # Both down → capitulation
        score = 0.5
        pattern = 'استسلام (capitulation)'
    else:
        score = 0.5
        pattern = 'محايد'
    return {
        'score': round(score, 4),
        'raw': round(vol_change - price_change, 2),
        'reason': f'{pattern}: vol_change={vol_change:+.1f}%, price_change={price_change:+.1f}%',
        'metadata': {'vol_change': round(vol_change, 2),
                     'price_change': round(price_change, 2),
                     'pattern': pattern}
    }
