# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Smart Confluence Routes - API for Historical Predictions
توليد وتقييم التوقعات التاريخية
"""

import os
import sys
import json
import sqlite3
import threading
from datetime import datetime
from flask import Blueprint, jsonify, request

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engines'))
sys.path.insert(0, os.path.dirname(__file__))

from pathlib import Path
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# Create Blueprint
smart_bp = Blueprint('smart_confluence', __name__, url_prefix='/api/smart-confluence')

# Background task state
_generation_state = {
    'running': False,
    'progress': None,
    'result': None,
    'error': None
}


def _get_predictions_conn():
    c = sqlite3.connect(PREDICTIONS_DB, timeout=15.0)
    c.row_factory = sqlite3.Row
    return c


def _run_generation_async(start_date, end_date, markets):
    """تشغيل التوليد في خلفية"""
    global _generation_state
    try:
        from historical_prediction_generator import HistoricalPredictionGenerator
        generator = HistoricalPredictionGenerator()

        def progress_callback(info):
            _generation_state['progress'] = info

        result = generator.generate_historical(
            start_date=start_date,
            end_date=end_date,
            markets=markets,
            progress_callback=progress_callback
        )

        _generation_state['result'] = result
        _generation_state['running'] = False

    except Exception as e:
        _generation_state['error'] = str(e)
        _generation_state['running'] = False
        print(f"[SmartConfluence] Background error: {e}")


# ============================================================================
# ENDPOINTS
# ============================================================================

@smart_bp.route('/status', methods=['GET'])
def get_status():
    """حالة نظام التوليد"""
    try:
        conn = _get_predictions_conn()

        # Check if table exists
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='platform_recommendations'"
        ).fetchall()]

        if 'platform_recommendations' not in tables:
            conn.close()
            return jsonify({
                'success': True,
                'table_exists': False,
                'message': 'الجدول لم يتم إنشاؤه بعد. قم بتوليد التوقعات أولاً.',
                'generation_state': _generation_state
            })

        total = conn.execute("SELECT COUNT(*) as c FROM platform_recommendations").fetchone()['c']
        active = conn.execute("SELECT COUNT(*) as c FROM platform_recommendations WHERE status='ACTIVE'").fetchone()['c']
        evaluated = conn.execute("SELECT COUNT(*) as c FROM platform_recommendations WHERE status!='ACTIVE'").fetchone()['c']

        wins = conn.execute(
            "SELECT COUNT(*) as c FROM platform_recommendations WHERE status IN ('HIT_TARGET','WIN')"
        ).fetchone()['c']
        losses = conn.execute(
            "SELECT COUNT(*) as c FROM platform_recommendations WHERE status IN ('HIT_STOP','LOSS')"
        ).fetchone()['c']
        expired = conn.execute(
            "SELECT COUNT(*) as c FROM platform_recommendations WHERE status='EXPIRED'"
        ).fetchone()['c']

        win_rate = round(wins / evaluated * 100, 1) if evaluated > 0 else 0

        # By market
        markets_data = conn.execute(
            "SELECT market, COUNT(*) as count, "
            "SUM(CASE WHEN status IN ('HIT_TARGET','WIN') THEN 1 ELSE 0 END) as wins "
            "FROM platform_recommendations GROUP BY market"
        ).fetchall()

        # By signal
        signals_data = conn.execute(
            "SELECT signal, COUNT(*) as count, "
            "SUM(CASE WHEN status IN ('HIT_TARGET','WIN') THEN 1 ELSE 0 END) as wins "
            "FROM platform_recommendations GROUP BY signal"
        ).fetchall()

        # Date range
        date_range = conn.execute(
            "SELECT MIN(predicted_date) as min_date, MAX(predicted_date) as max_date "
            "FROM platform_recommendations"
        ).fetchone()

        conn.close()

        return jsonify({
            'success': True,
            'table_exists': True,
            'generation_state': _generation_state,
            'stats': {
                'total': total,
                'active': active,
                'evaluated': evaluated,
                'wins': wins,
                'losses': losses,
                'expired': expired,
                'win_rate': f"{win_rate}%",
                'date_range': {
                    'start': date_range['min_date'],
                    'end': date_range['max_date']
                }
            },
            'by_market': {r['market']: {'count': r['count'], 'wins': r['wins']} for r in markets_data},
            'by_signal': {r['signal']: {'count': r['count'], 'wins': r['wins']} for r in signals_data}
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_bp.route('/generate', methods=['POST'])
def generate_predictions():
    """
    توليد التوقعات التاريخية
    POST body: { "start_date": "2026-01-01", "end_date": "2026-06-15", "markets": ["السعودية"] }
    """
    global _generation_state

    if _generation_state['running']:
        return jsonify({
            'success': False,
            'message': 'التوليد قيد التنفيذ بالفعل',
            'progress': _generation_state['progress']
        })

    data = request.get_json() or {}
    start_date = data.get('start_date', '2026-01-01')
    end_date = data.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    markets = data.get('markets', ['السعودية'])

    # Reset state
    _generation_state = {
        'running': True,
        'progress': None,
        'result': None,
        'error': None
    }

    # Start in background thread
    thread = threading.Thread(
        target=_run_generation_async,
        args=(start_date, end_date, markets),
        daemon=True
    )
    thread.start()

    return jsonify({
        'success': True,
        'message': f'بدء توليد التوقعات من {start_date} إلى {end_date}',
        'params': {
            'start_date': start_date,
            'end_date': end_date,
            'markets': markets
        }
    })


@smart_bp.route('/progress', methods=['GET'])
def get_progress():
    """متابعة تقدم التوليد"""
    return jsonify({
        'success': True,
        'running': _generation_state['running'],
        'progress': _generation_state['progress'],
        'result': _generation_state['result'],
        'error': _generation_state['error']
    })


@smart_bp.route('/evaluate', methods=['POST'])
def evaluate_predictions():
    """تقييم التوقعات النشطة"""
    try:
        from historical_prediction_generator import HistoricalPredictionGenerator
        generator = HistoricalPredictionGenerator()
        generator._evaluate_all_predictions()
        final_stats = generator._get_final_stats()

        return jsonify({
            'success': True,
            'message': 'تم تقييم التوقعات بنجاح',
            'stats': final_stats
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_bp.route('/predictions', methods=['GET'])
def list_predictions():
    """عرض التوقعات"""
    try:
        conn = _get_predictions_conn()

        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 50))
        market = request.args.get('market', None)
        status = request.args.get('status', None)
        signal = request.args.get('signal', None)

        where_parts = []
        params = []

        if market:
            where_parts.append("market = ?")
            params.append(market)
        if status:
            where_parts.append("status = ?")
            params.append(status)
        if signal:
            where_parts.append("signal = ?")
            params.append(signal)

        where_clause = " AND ".join(where_parts)
        if where_clause:
            where_clause = "WHERE " + where_clause

        offset = (page - 1) * limit

        rows = conn.execute(
            f"SELECT * FROM platform_recommendations {where_clause} "
            f"ORDER BY predicted_date DESC, confidence DESC "
            f"LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()

        total = conn.execute(
            f"SELECT COUNT(*) as c FROM platform_recommendations {where_clause}",
            params
        ).fetchone()['c']

        conn.close()

        return jsonify({
            'success': True,
            'predictions': [dict(r) for r in rows],
            'total': total,
            'page': page,
            'limit': limit,
            'total_pages': (total + limit - 1) // limit
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_bp.route('/clear', methods=['POST'])
def clear_predictions():
    """مسح كل التوقعات"""
    try:
        conn = _get_predictions_conn()
        count = conn.execute("SELECT COUNT(*) as c FROM platform_recommendations").fetchone()['c']
        conn.execute("DELETE FROM platform_recommendations")
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': f'تم حذف {count} توقع'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@smart_bp.route('/analysis/<symbol>', methods=['GET'])
def analyze_stock(symbol):
    """تحليل فوري لسهم واحد"""
    try:
        from smart_confluence_engine import get_engine
        engine = get_engine()

        target_date = request.args.get('date', None)
        result = engine.analyze(symbol, target_date)

        if not result:
            return jsonify({'success': False, 'message': f'لم يتم العثور على بيانات لـ {symbol}'}), 404

        return jsonify({'success': True, 'analysis': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


print("✓ Smart Confluence Routes registered (/api/smart-confluence/*)")