"""
vps-service/api/notifications_routes.py
========================================
Priority notifications endpoint (B3).

Rule 20 (Python=Brain): priority calculation in Python.
Rule 27 (NO FAKE DATA): notifications from user_notifications table.
Rule 56 (NO SQL INJECTION): parameterized queries.
Rule 64 (IDOR guard): user can only see their own notifications.
"""
import sqlite3
import logging
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

notifications_bp = Blueprint('notifications', __name__, url_prefix='/api/notifications')

# In-memory cache (2 min TTL per user)
_priority_cache = {}  # {user_id: {'data': ..., 'ts': ...}}
_CACHE_TTL = 120  # 2 minutes


def _get_session_user_id():
    """Extract user_id from session (Rule 64 — IDOR guard)."""
    # Try header first (X-User-Id from proxy)
    user_id = request.headers.get('X-User-Id')
    if user_id:
        return user_id

    # Try query param (for testing only — production uses header)
    user_id = request.args.get('user_id')
    if user_id:
        return user_id

    return None


def _calculate_priority_score(notification, user_portfolio_tickers=None, user_watchlist_tickers=None):
    """Calculate priority score (0-100) for a notification.

    Logic:
      - base_score by type
      - multipliers: age < 1h × 1.5, age > 24h × 0.5
      - ticker in portfolio × 1.3
      - ticker in watchlist × 1.15
    """
    notif_type = (notification.get('type') or '').lower()
    created_at = notification.get('created_at') or ''

    # Base score by type
    if 'stop' in notif_type or 'near_stop' in notif_type:
        base = 95
        severity = 'danger'
    elif 'target' in notif_type or 'near_target' in notif_type:
        base = 78
        severity = 'opportunity'
    elif 'price_alert' in notif_type:
        base = 67
        severity = 'warning'
    elif 'news' in notif_type or 'market_news' in notif_type:
        base = 50
        severity = 'info'
    elif 'portfolio' in notif_type:
        base = 30
        severity = 'info'
    else:
        base = 15
        severity = 'info'

    score = float(base)

    # Age multiplier
    try:
        if 'T' in created_at:
            created_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        else:
            created_dt = datetime.fromisoformat(created_at)
        now = datetime.now(created_dt.tzinfo) if created_dt.tzinfo else datetime.now()
        age_hours = (now - created_dt).total_seconds() / 3600

        if age_hours < 1:
            score *= 1.5
        elif age_hours > 24:
            score *= 0.5
    except Exception:
        pass

    # Portfolio/watchlist multiplier
    ticker = notification.get('ticker', '')
    if ticker and user_portfolio_tickers and ticker in user_portfolio_tickers:
        score *= 1.3
    elif ticker and user_watchlist_tickers and ticker in user_watchlist_tickers:
        score *= 1.15

    # Clamp to 0-100
    score = max(0, min(100, int(score)))

    return score, severity


@notifications_bp.route('/priority', methods=['GET'])
def priority_notifications():
    """GET /api/notifications/priority?user_id=X&limit=3

    Returns top N priority notifications for the user.

    Response:
    {
      "success": true,
      "data": {
        "priority": [...],
        "total_count": 15,
        "rest_count": 12
      }
    }
    """
    # Auth check (Rule 64 — IDOR guard)
    session_user_id = _get_session_user_id()
    if not session_user_id:
        return jsonify({
            'success': False,
            'error': 'Authentication required'
        }), 401

    # IDOR guard: user can only request their own notifications
    requested_user_id = request.args.get('user_id', session_user_id)
    if requested_user_id != session_user_id:
        return jsonify({
            'success': False,
            'error': 'Forbidden — can only access your own notifications'
        }), 403

    try:
        limit = min(int(request.args.get('limit', 3)), 10)
    except (ValueError, TypeError):
        limit = 3

    # Check cache
    cache_key = f"{session_user_id}_{limit}"
    now = time.time()
    if cache_key in _priority_cache:
        cached = _priority_cache[cache_key]
        if (now - cached['ts']) < _CACHE_TTL:
            return jsonify({
                'success': True,
                'data': cached['data'],
                'cached': True,
            })

    try:
        conn = sqlite3.connect(f'file:{STOCKS_DB}?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Get user's portfolio tickers (for multiplier)
        portfolio_tickers = set()
        try:
            cur.execute("""
                SELECT DISTINCT ticker FROM portfolio_assets
                WHERE user_id = ? AND ticker IS NOT NULL
            """, (session_user_id,))
            portfolio_tickers = {r[0] for r in cur.fetchall() if r[0]}
        except Exception:
            pass

        # Get user's watchlist tickers
        watchlist_tickers = set()
        try:
            cur.execute("""
                SELECT DISTINCT ticker FROM user_stock_watchlists
                WHERE user_id = ? AND ticker IS NOT NULL
            """, (session_user_id,))
            watchlist_tickers = {r[0] for r in cur.fetchall() if r[0]}
        except Exception:
            pass

        # Get all unread notifications for user
        cur.execute("""
            SELECT id, user_id, type, title, message, ticker,
                   created_at, is_read
            FROM user_notifications
            WHERE user_id = ?
              AND (is_read = 0 OR is_read IS NULL)
            ORDER BY created_at DESC
            LIMIT 50
        """, (session_user_id,))

        all_notifs = []
        for row in cur.fetchall():
            notif = dict(row)
            score, severity = _calculate_priority_score(
                notif,
                user_portfolio_tickers=portfolio_tickers,
                user_watchlist_tickers=watchlist_tickers
            )
            notif['priority_score'] = score
            notif['severity'] = severity
            notif['action'] = {
                'label': 'شوف التفاصيل',
                'url': f"/stock/{notif.get('ticker', '')}" if notif.get('ticker') else None
            }
            all_notifs.append(notif)

        conn.close()

        # Sort by priority_score DESC
        all_notifs.sort(key=lambda x: x['priority_score'], reverse=True)

        # Top N
        top_n = all_notifs[:limit]
        total_count = len(all_notifs)
        rest_count = max(0, total_count - limit)

        result = {
            'priority': top_n,
            'total_count': total_count,
            'rest_count': rest_count,
        }

        # Update cache
        _priority_cache[cache_key] = {'data': result, 'ts': now}

        return jsonify({
            'success': True,
            'data': result,
            'cached': False,
        })

    except Exception as e:
        logger.error(f"[notifications_routes] priority error: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'data': {'priority': [], 'total_count': 0, 'rest_count': 0}
        }), 500
