"""
Screener Routes Blueprint
=========================
Endpoints للـ Stock Screener (ماسح الأسهم)

Endpoints:
- GET  /api/screener/presets — قائمة البريسيت المتاحة
- GET  /api/screener/scan?preset=day_trader — قراءة نتائج بريسيت من screener_results
- POST /api/screener/run-all — تشغيل كل البريسيت وحفظ النتائج
"""

import json
from core.auth_middleware import require_admin
import time
from datetime import datetime
from flask import Blueprint, request, jsonify

from utils.db_paths import DBPaths

screener_bp = Blueprint('screener', __name__)

# ---------------------------------------------------------------------------
# Preset metadata
# ---------------------------------------------------------------------------

PRESETS = {
    'day_trader': {
        'id': 'day_trader',
        'name_ar': 'رادار المضارب',
        'name_en': 'Day Trader Radar',
        'description': 'أسهم عالية التذبذب مع تقييم فني إيجابي ومذبذب في النطاق المحايد',
        'icon': '⚡',
    },
    'daily_speculator': {
        'id': 'daily_speculator',
        'name_ar': 'المضارب اليومي',
        'name_en': 'Daily Speculator',
        'description': '6 قواعد: خصم من قمة 52 أسبوع + EPS + P/E + توزيعات + حجم',
        'icon': '🎯',
    },
    'value': {
        'id': 'value',
        'name_ar': 'صائد القيمة',
        'name_en': 'Value Hunter',
        'description': 'أسهم مُقيّمة بأقل من قيمتها الدفترية مع عوائد توزيعات مرتفعة',
        'icon': '💎',
    },
    'momentum': {
        'id': 'momentum',
        'name_ar': 'صواريخ الزخم',
        'name_en': 'Momentum Rockets',
        'description': 'أسهم صاعدة بقوة مع زخم إيجابي وتقييم شراء قوي',
        'icon': '🚀',
    },
    'thermometer': {
        'id': 'thermometer',
        'name_ar': 'ميزان حرارة السوق',
        'name_en': 'Market Thermometer',
        'description': 'درجة حرارة السوق بناءً على نسبة الصاعدة/الهابطة ومتوسط الاتجاه',
        'icon': '🌡️',
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_stocks_conn():
    """Get a connection to stocks.db."""
    import sqlite3
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DBPaths.STOCKS_DB, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_table(conn):
    """Ensure screener_results table exists."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screener_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            preset TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            market TEXT,
            price REAL,
            score REAL,
            reason TEXT,
            scan_date TEXT NOT NULL
        )
    """)
    conn.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@screener_bp.route('/api/screener/presets', methods=['GET'])
def get_presets():
    """Return the list of available screener presets."""
    return jsonify({
        'success': True,
        'presets': list(PRESETS.values()),
    })


@screener_bp.route('/api/screener/scan', methods=['GET'])
def scan_preset():
    """
    Read pre-computed results for a preset from screener_results table.
    Does NOT compute on-the-fly — only reads stored results.
    """
    preset = request.args.get('preset', '').strip()
    market = request.args.get('market', '').strip()
    limit = request.args.get('limit', 50, type=int)
    limit = min(limit, 200)

    if not preset or preset not in PRESETS:
        return jsonify({
            'success': False,
            'error': f'Invalid preset. Available: {list(PRESETS.keys())}',
        }), 400

    conn = _get_stocks_conn()
    try:
        _ensure_table(conn)

        query = """
            SELECT symbol, name, market, price, score, reason, scan_date
            FROM screener_results
            WHERE preset = ?
        """
        params = [preset]

        if market:
            # Map short market codes to Arabic
            market_map = {
                'EGX': 'مصر', 'egx': 'مصر',
                'Tadawul': 'السعودية', 'tadawul': 'السعودية', 'SA': 'السعودية',
                'Kuwait': 'الكويت', 'KW': 'الكويت',
                'Qatar': 'قطر', 'QA': 'قطر',
            }
            mkt_ar = market_map.get(market, market)
            query += " AND market = ?"
            params.append(mkt_ar)

        query += " ORDER BY score DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()

        results = []
        for r in rows:
            results.append({
                'symbol': r['symbol'],
                'name': r['name'],
                'market': r['market'],
                'price': r['price'],
                'score': max(0, min(100, r['score'])),
                'reason': r['reason'],
            })

        # Get scan date from latest result
        scan_date = results[0]['scan_date'] if results and 'scan_date' in (results[0] if results else {}) else None
        if not scan_date and results:
            scan_date = rows[0]['scan_date'] if rows else None

        return jsonify({
            'success': True,
            'preset': preset,
            'preset_name': PRESETS[preset]['name_ar'],
            'count': len(results),
            'scan_date': scan_date,
            'results': results,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


@require_admin
@screener_bp.route('/api/screener/run-all', methods=['POST'])
def run_all_presets():
    """
    Run all 4 presets using the screener.py module and save to DB.
    """
    try:
        from analyzers.screener import run_all, PRESET_NAMES

        data = request.get_json() or {}
        market = data.get('market')  # Optional market filter

        start = time.time()
        all_results = run_all(market=market)
        duration = round((time.time() - start) * 1000)

        summary = {}
        for name, res in all_results.items():
            summary[name] = {
                'preset_name': PRESET_NAMES[name],
                'count': len(res),
                'top_score': res[0]['score'] if res else 0,
            }

        return jsonify({
            'success': True,
            'duration_ms': duration,
            'summary': summary,
            'scan_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        })
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }), 500
