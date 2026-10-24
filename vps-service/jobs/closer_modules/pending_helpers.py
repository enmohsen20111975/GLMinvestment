"""
pending_helpers.py — جلب التوقعات المعلقة (Phase 9.1 — Strangler Pattern V2)
==============================================================================

اتسحب من daily_closer.py (lines 310-345).

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

from typing import List, Dict


def get_pending_predictions(closer, market_filter: str = None) -> List[Dict]:
    """جلب كل التوقعات المعلقة.

    Extracted from DailyCloser.get_pending_predictions.

    Args:
        closer: DailyCloser instance (for _conn access)
        market_filter: لو 'EGX' → بيرجع بس توقعات EGX.
                       لو 'CRYPTO' → بيرجع بس توقعات CRYPTO.
                       لو None → بيرجع الكل.
    """
    try:
        conn = closer._conn(closer.predictions_db)
        cursor = conn.cursor()
        # FIX (July 2026): predictions table has NO 'status' column.
        # Use outcome_date IS NULL to find pending predictions.
        # FIX (Aug 2026): لو market_filter محدد، بـ يـ filter على market column
        # عشان نمنع ghost closures لتوقعات CRYPTO من مصادر أس EGX.
        if market_filter:
            cursor.execute("""
                SELECT *
                FROM predictions
                WHERE outcome_date IS NULL
                  AND market = ?
                ORDER BY created_at ASC
            """, (market_filter,))
        else:
            cursor.execute("""
                SELECT *
                FROM predictions
                WHERE outcome_date IS NULL
                ORDER BY created_at ASC
            """)
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error getting pending predictions: {e}")
        return []
