"""Block: breadth_trend — % الأسهم فوق SMA50 (market regime proxy).

Formula: breadth = count(stocks where close > SMA50) / count(active stocks) × 100
Score: > 70% → 1.0 (strong bull), 55-70% → 0.7 (bull), 45-55% → 0.5 (neutral),
       30-45% → 0.3 (bear), < 30% → 0.1 (strong bear)

Replaces egx30_trend (which had splits contamination problem).
breadth is calculated from price_history.db directly — no EGX30 chain needed.
"""
from __future__ import annotations
from typing import Any, Dict
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DB_DIR = PROJECT_ROOT / 'db'

# Module-level cache: date → (breadth, above, total)
_BREADTH_CACHE: Dict[str, Any] = {}


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    # Cache breadth per day (same for all tickers on same date)
    if date in _BREADTH_CACHE:
        breadth, above, total = _BREADTH_CACHE[date]
    else:
        try:
            conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
            rows = conn.execute("""
                SELECT ticker, close_price FROM price_history
                WHERE date=? AND ticker NOT LIKE '%.%' AND close_price>0
            """, (date,)).fetchall()
            conn.close()
            if not rows:
                return {'score': 0.5, 'raw': 0.0,
                        'reason': 'لا بيانات لهذا اليوم', 'metadata': {}}
            above = 0
            total = 0
            conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
            for t, close in rows:
                prev = conn.execute("""
                    SELECT close_price FROM price_history
                    WHERE ticker=? AND date<? AND close_price>0
                    ORDER BY date DESC LIMIT 50
                """, (t, date)).fetchall()
                if len(prev) >= 50:
                    sma50 = sum(r[0] for r in prev) / 50
                    if sma50 > 0:
                        total += 1
                        if close > sma50:
                            above += 1
            conn.close()
            breadth = (above / total * 100) if total > 0 else 0.0
            _BREADTH_CACHE[date] = (breadth, above, total)
        except Exception as e:
            return {'score': 0.5, 'raw': 0.0,
                    'reason': f'ERR: {type(e).__name__}: {str(e)[:40]}', 'metadata': {}}
    # Score mapping
    if breadth > 70:
        score = 1.0
        label = 'قوي صاعد (strong bull)'
    elif breadth > 55:
        score = 0.7
        label = 'صاعد (bull)'
    elif breadth > 45:
        score = 0.5
        label = 'محايد (neutral)'
    elif breadth > 30:
        score = 0.3
        label = 'هابط (bear)'
    else:
        score = 0.1
        label = 'قوي هابط (strong bear)'
    return {
        'score': round(score, 4),
        'raw': round(breadth, 1),
        'reason': f'Breadth={breadth:.1f}% ({label}) — {above}/{total} above SMA50',
        'metadata': {'breadth': round(breadth, 1), 'above': above, 'total': total}
    }
