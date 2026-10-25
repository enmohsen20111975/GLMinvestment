"""Block: sector_leadership — القطاع في top 3 هذا الشهر؟

Formula: rank sector's avg monthly return among all sectors
Score: rank 1-3 → 1.0, rank 4-6 → 0.6, rank 7+ → 0.2
"""
from __future__ import annotations
from typing import Any, Dict
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DB_DIR = PROJECT_ROOT / 'db'

# Module-level cache: month → (sector_rank, sector, total_sectors, my_ret)
_SECTOR_CACHE: Dict[str, Any] = {}


def compute(ticker: str, date: str, price_data: Dict[str, Any]) -> Dict[str, Any]:
    # Cache sector rankings per month (avoids DB hit per observation)
    cache_key = f"_sector_ranking_{date[:7]}"
    if cache_key in _SECTOR_CACHE:
        sector_rank, sector, total_sectors, my_ret = _SECTOR_CACHE[cache_key]
    else:
        try:
            conn = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=30)
            row = conn.execute("SELECT sector FROM stocks WHERE ticker=?", (ticker,)).fetchone()
            if not row or not row[0]:
                conn.close()
                return {'score': 0.5, 'raw': 0,
                        'reason': 'لا يوجد قطاع', 'metadata': {}}
            sector = row[0]
            # Get all sectors' avg change_percent
            sectors_ret = {}
            for s, in conn.execute("SELECT DISTINCT sector FROM stocks WHERE sector IS NOT NULL").fetchall():
                avg_ret = conn.execute("SELECT AVG(change_percent) FROM stocks WHERE sector=? AND change_percent IS NOT NULL", (s,)).fetchone()[0]
                if avg_ret is not None:
                    sectors_ret[s] = float(avg_ret)
            conn.close()
            if not sectors_ret:
                return {'score': 0.5, 'raw': 0,
                        'reason': f'قطاع {sector}: لا بيانات', 'metadata': {'sector': sector}}
            ranked = sorted(sectors_ret.items(), key=lambda x: -x[1])
            sector_rank = next((i + 1 for i, (s, _) in enumerate(ranked) if s == sector), len(ranked))
            total_sectors = len(ranked)
            my_ret = sectors_ret.get(sector, 0)
            _SECTOR_CACHE[cache_key] = (sector_rank, sector, total_sectors, my_ret)
        except Exception as e:
            return {'score': 0.5, 'raw': 0,
                    'reason': f'ERR: {type(e).__name__}: {str(e)[:40]}', 'metadata': {}}
    if sector_rank <= 3:
        score = 1.0
    elif sector_rank <= 6:
        score = 0.6
    else:
        score = 0.2
    return {
        'score': round(score, 4),
        'raw': sector_rank,
        'reason': f'قطاع {sector}: rank #{sector_rank}/{total_sectors} (ret={my_ret:+.2f}%)',
        'metadata': {'sector': sector, 'rank': sector_rank, 'total_sectors': total_sectors,
                     'monthly_return': round(my_ret, 2)}
    }
