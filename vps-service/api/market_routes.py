"""
vps-service/api/market_routes.py
=================================
Market-level endpoints (B2: top-movers).

Rule 20 (Python=Brain): كل logic هنا.
Rule 27 (NO FAKE DATA): كل رقم من stocks.db.
Rule 56 (NO SQL INJECTION): parameterized queries.
Rule 66 (Source Authority): stocks.db = canonical لـ metadata.
"""
import sqlite3
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

market_bp = Blueprint('market', __name__, url_prefix='/api/market')

# In-memory cache (5 min TTL)
_top_movers_cache = {'data': None, 'ts': 0.0, 'limit': 0}
_CACHE_TTL = 300  # 5 minutes


@market_bp.route('/top-movers', methods=['GET'])
def top_movers():
    """GET /api/market/top-movers?limit=5

    Returns top N stocks by change_percent (filtered by turnover >= 1M + is_active).

    Response:
    {
      "success": true,
      "data": {
        "movers": [
          {
            "ticker": "COMI",
            "name_ar": "التجاري الدولي",
            "sector": "Finance",
            "current_price": 129.00,
            "change_percent": -2.98,
            "volume": 3420000,
            "turnover_egp": 441180000.0
          }
        ],
        "as_of": "2026-10-23T14:30:00+00:00"
      }
    }
    """
    try:
        limit = min(int(request.args.get('limit', 5)), 20)  # cap at 20
    except (ValueError, TypeError):
        limit = 5

    # Check cache
    now = time.time()
    if (_top_movers_cache['data'] is not None
            and _top_movers_cache['limit'] == limit
            and (now - _top_movers_cache['ts']) < _CACHE_TTL):
        return jsonify({
            'success': True,
            'data': {
                'movers': _top_movers_cache['data'],
                'as_of': datetime.now(timezone.utc).isoformat(),
                'cached': True,
            }
        })

    try:
        conn = sqlite3.connect(f'file:{STOCKS_DB}?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Rule 56: parameterized query (no f-string in SQL)
        # Rule 27: real data only (is_active=1 + turnover >= 1M)
        cur.execute("""
            SELECT ticker, name_ar, sector, current_price,
                   change_percent, volume, turnover_egp
            FROM stocks
            WHERE is_active = 1
              AND market = 'EGX'
              AND current_price IS NOT NULL
              AND current_price > 0
              AND COALESCE(turnover_egp, 0) >= 1000000
            ORDER BY change_percent DESC
            LIMIT ?
        """, (limit,))

        movers = []
        for row in cur.fetchall():
            movers.append({
                'ticker': row['ticker'],
                'name_ar': row['name_ar'] or row['ticker'],
                'sector': row['sector'] or '',
                'current_price': round(float(row['current_price']), 2),
                'change_percent': round(float(row['change_percent'] or 0), 2),
                'volume': int(row['volume'] or 0),
                'turnover_egp': round(float(row['turnover_egp'] or 0), 2),
            })

        conn.close()

        # Update cache
        _top_movers_cache['data'] = movers
        _top_movers_cache['ts'] = now
        _top_movers_cache['limit'] = limit

        return jsonify({
            'success': True,
            'data': {
                'movers': movers,
                'as_of': datetime.now(timezone.utc).isoformat(),
                'cached': False,
            }
        })

    except Exception as e:
        logger.error(f"[market_routes] top_movers error: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'data': {'movers': [], 'as_of': datetime.now(timezone.utc).isoformat()}
        }), 500
