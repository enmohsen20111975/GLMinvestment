"""
daily_opportunities_v402.py — V40.2 daily opportunities for Telegram.
=====================================================================
BRAVO MAESTRO-CANCER-1 STEP 2: replace maestro_orchestrator.daily_opportunities
with a V40.2-native version that reads from predictions.db (canonical V40.2 source).

Rule 20 (Python = Brain): all logic in Python.
Rule 27 (NO-FAKE-DATA): reads real predictions from predictions.db only.
Rule 21: V40.2 is the sole source of predictions.

Usage:
    from utils.daily_opportunities_v402 import daily_opportunities_v402
    result = daily_opportunities_v402(market='EGX', limit=5)
"""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

# Rule 17: relative path — vps-service/utils/ → project root = parents[2]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = os.environ.get('V40_2_PREDICTIONS_DB') or str(_PROJECT_ROOT / 'db' / 'predictions.db')


def daily_opportunities_v402(market: str = 'EGX', limit: int = 5) -> Dict:
    """Get top daily BUY opportunities from V40.2 predictions.db.

    Replaces maestro_orchestrator.daily_opportunities.
    Reads from predictions.db.aiPrediction (canonical V40.2 source per Rule 21).

    Args:
        market: market filter (default EGX). Predictions with market != EGX are excluded.
        limit: max number of opportunities (default 5).

    Returns:
        {
            'date': 'YYYY-MM-DD',
            'top_3': [...],  # list of opportunity dicts
            'count': int,
            'source': 'predictions.db.aiPrediction (V40.2)'
        }
    """
    date_str = datetime.now().strftime('%Y-%m-%d')

    if not os.path.exists(PREDICTIONS_DB):
        return {'date': date_str, 'top_3': [], 'count': 0, 'error': 'predictions.db not found'}

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        try:
            # Get latest BUY/STRONG_BUY/ACCUMULATE predictions (not quarantined)
            # Order by maestro_score DESC (highest confidence first)
            rows = conn.execute(
                """
                SELECT stock_symbol as ticker, stock_name_ar as name,
                       signal_type, entry_price, target_price, stop_loss,
                       maestro_score, confidence, prediction_date, market
                FROM aiPrediction
                WHERE signal_type IN ('BUY', 'STRONG_BUY', 'ACCUMULATE')
                  AND status NOT LIKE 'QUARANTINED_%'
                  AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
                  AND (market = ? OR market IS NULL OR market = '')
                ORDER BY maestro_score DESC, prediction_date DESC
                LIMIT ?
                """,
                (market, limit)
            ).fetchall()

            opportunities: List[Dict] = []
            for row in rows:
                entry = float(row['entry_price'])
                stop = float(row['stop_loss'])
                target = float(row['target_price'])

                # Geometry guard (Rule 7/8): BUY = stop below entry, target above entry
                if stop >= entry or target <= entry:
                    continue

                # R/R check (Rule 18): R/R >= 1.8
                rr = (target - entry) / (entry - stop)
                if rr < 1.8:
                    continue

                opportunities.append({
                    'ticker': row['ticker'],
                    'name': row['name'] or row['ticker'],
                    'signal': row['signal_type'],
                    'entry_price': entry,
                    'target_price': target,
                    'stop_loss': stop,
                    'risk_reward': round(rr, 2),
                    'maestro_score': float(row['maestro_score'] or 0),
                    'confidence': float(row['confidence'] or 0),
                    'prediction_date': row['prediction_date'],
                    'market': row['market'] or market,
                })

            return {
                'date': date_str,
                'top_3': opportunities,
                'count': len(opportunities),
                'source': 'predictions.db.aiPrediction (V40.2)',
                'market': market,
            }
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"[daily_opportunities_v402] failed: {e}")
        return {'date': date_str, 'top_3': [], 'count': 0, 'error': str(e)}


__all__ = ['daily_opportunities_v402', 'PREDICTIONS_DB']
