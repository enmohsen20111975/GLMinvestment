"""Block: buy_sell_pressure — صافي شراء/بيع.

Uses price_history.db columns:
  - buy_volume, sell_volume (when available)
  - delta_volume (fallback)
  - delta_pct (fallback)

Formula: delta_pct = (buy - sell) / (buy + sell) × 100
Score: > +30% → 1.0, -30% to +30% → linear, < -30% → 0.2
"""
from __future__ import annotations
from typing import Any, Dict
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DB_DIR = PROJECT_ROOT / 'db'


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    try:
        conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
        row = conn.execute("""
            SELECT buy_volume, sell_volume, delta_volume, delta_pct, pressure
            FROM price_history WHERE ticker=? AND date=? AND close_price>0
        """, (ticker, date)).fetchone()
        conn.close()
        if not row:
            return {'score': 0.5, 'raw': 0.0,
                    'reason': 'لا توجد بيانات', 'metadata': {}}
        buy_vol, sell_vol, delta_vol, delta_pct, pressure = row
        # Prefer delta_pct; fallback to computed from buy/sell; fallback to delta_volume sign
        if delta_pct is not None:
            delta = float(delta_pct)
            source = 'delta_pct'
        elif buy_vol is not None and sell_vol is not None and (buy_vol + sell_vol) > 0:
            delta = (buy_vol - sell_vol) / (buy_vol + sell_vol) * 100
            source = 'computed'
        elif delta_vol is not None:
            # Use delta_volume sign as proxy
            delta = 100.0 if delta_vol > 0 else -100.0 if delta_vol < 0 else 0.0
            source = 'delta_volume_sign'
        else:
            return {'score': 0.5, 'raw': 0.0,
                    'reason': 'لا بيانات buy/sell', 'metadata': {}}
        # Normalize: > +30% → 1.0, -30% to +30% → linear, < -30% → 0.2
        if delta > 30:
            score = 1.0
        elif delta < -30:
            score = 0.2
        else:
            score = 0.5 + delta / 30 * 0.5
            score = min(1.0, max(0.2, score))
        bv = buy_vol or 0; sv = sell_vol or 0
        return {
            'score': round(score, 4),
            'raw': round(delta, 2),
            'reason': f'Buy/Sell delta={delta:+.1f}% ({source}) buy={bv:,} sell={sv:,}',
            'metadata': {'delta_pct': round(delta, 2),
                         'buy_volume': bv, 'sell_volume': sv,
                         'delta_volume': delta_vol, 'pressure': pressure}
        }
    except Exception as e:
        return {'score': 0.5, 'raw': 0.0,
                'reason': f'ERR: {type(e).__name__}: {str(e)[:40]}', 'metadata': {}}
