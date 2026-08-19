# DEPRECATED: This route is not registered in lightweight_server.py
"""
Backtest API Routes
====================
مسارات API للاختبار الخلفي وتتبع التوقعات

Endpoints:
- POST /api/backtest/run - تشغيل اختبار على تاريخ محدد
- POST /api/backtest/multi-period - اختبار فترة طويلة
- GET /api/backtest/stats - إحصائيات التوقعات
- GET /api/backtest/pending - التوقعات المعلقة
- POST /api/backtest/update-outcome - تحديث نتيجة توقع
"""

from flask import Blueprint, request, jsonify
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.real_backtester import RealBacktester
from analyzers.prediction_tracker import PredictionTracker

# Create blueprint
backtest_bp = Blueprint('backtest', __name__)

# Database paths
from pathlib import Path as _Path
_PROJECT_ROOT = _Path(__file__).resolve().parent.parent.parent
# P0 fix (يوليو 2026): توحيد predictions table في predictions.db بس
# كان قبل كده stocks.db → ده كان بيسبب split-brain + double-counting
DB_PATH = str(_PROJECT_ROOT / 'db' / 'predictions.db')
HISTORY_DB_PATH = str(_PROJECT_ROOT / 'db' / 'price_history.db')


@backtest_bp.route('/run', methods=['POST'])
def run_backtest():
    """
    تشغيل اختبار خلفي على تاريخ محدد
    
    Body:
        prediction_date: str (YYYY-MM-DD)
        holding_days: int (default: 10)
        min_liquidity: int (default: 100000)
        top_n: int (default: 30)
    
    Returns:
        Dict: نتائج الاختبار
    """
    try:
        data = request.get_json() or {}
        
        prediction_date = data.get('prediction_date')
        if not prediction_date:
            return jsonify({'error': 'prediction_date is required'}), 400
        
        holding_days = data.get('holding_days', 10)
        min_liquidity = data.get('min_liquidity', 100000)
        top_n = data.get('top_n', 30)
        
        backtester = RealBacktester(DB_PATH, HISTORY_DB_PATH)
        result = backtester.run_backtest(
            prediction_date=prediction_date,
            holding_days=holding_days,
            min_liquidity=min_liquidity,
            top_n=top_n
        )
        
        return jsonify({
            'success': True,
            'data': result
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backtest_bp.route('/multi-period', methods=['POST'])
def run_multi_period_backtest():
    """
    تشغيل اختبار خلفي على فترة زمنية
    
    Body:
        start_date: str (YYYY-MM-DD)
        end_date: str (YYYY-MM-DD)
        interval_days: int (default: 7)
        holding_days: int (default: 10)
    
    Returns:
        Dict: نتائج الاختبار المجمعة
    """
    try:
        data = request.get_json() or {}
        
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        
        if not start_date or not end_date:
            return jsonify({'error': 'start_date and end_date are required'}), 400
        
        interval_days = data.get('interval_days', 7)
        holding_days = data.get('holding_days', 10)
        
        backtester = RealBacktester(DB_PATH, HISTORY_DB_PATH)
        result = backtester.run_multi_period_backtest(
            start_date=start_date,
            end_date=end_date,
            interval_days=interval_days,
            holding_days=holding_days
        )
        
        return jsonify({
            'success': True,
            'data': result
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backtest_bp.route('/stats', methods=['GET'])
def get_prediction_stats():
    """
    الحصول على إحصائيات التوقعات
    
    Query params:
        days: int (default: 30) - عدد الأيام للتحليل
    
    Returns:
        Dict: إحصائيات التوقعات
    """
    try:
        days = request.args.get('days', 30, type=int)
        
        tracker = PredictionTracker(DB_PATH)
        stats = tracker.get_accuracy_stats(days)
        
        return jsonify({
            'success': True,
            'data': stats
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backtest_bp.route('/pending', methods=['GET'])
def get_pending_predictions():
    """
    الحصول على التوقعات المعلقة (لم يتم التحقق منها بعد)
    
    Returns:
        List: قائمة التوقعات المعلقة
    """
    try:
        tracker = PredictionTracker(DB_PATH)
        predictions = tracker.get_pending_predictions()
        
        return jsonify({
            'success': True,
            'data': [p.__dict__ for p in predictions],
            'count': len(predictions)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backtest_bp.route('/update-outcome', methods=['POST'])
def update_prediction_outcome():
    """
    تحديث نتيجة توقع
    
    Body:
        prediction_id: int
        exit_price: float
        notes: str (optional)
    
    Returns:
        Dict: نتيجة التحديث
    """
    try:
        data = request.get_json() or {}
        
        prediction_id = data.get('prediction_id')
        exit_price = data.get('exit_price')
        
        if not prediction_id or not exit_price:
            return jsonify({'error': 'prediction_id and exit_price are required'}), 400
        
        notes = data.get('notes', '')
        
        tracker = PredictionTracker(DB_PATH)
        result = tracker.update_outcome(prediction_id, exit_price, notes)
        
        return jsonify({
            'success': True,
            'data': result
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@backtest_bp.route('/batch-update-outcomes', methods=['POST'])
def batch_update_outcomes():
    """
    تحديث نتائج التوقعات المعلقة تلقائياً
    
    يفحص كل التوقعات المعلقة ويحدثها بالأسعار الحالية
    
    Returns:
        Dict: نتائج التحديث
    """
    try:
        import sqlite3
        from datetime import datetime, timedelta
        
        tracker = PredictionTracker(DB_PATH)
        pending = tracker.get_pending_predictions()
        
        updated = 0
        errors = 0
        
        # Get current prices from database
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        for pred in pending:
            # Check if prediction is old enough (at least 10 days)
            try:
                pred_date = datetime.strptime(pred.prediction_date.split()[0], '%Y-%m-%d')
                days_old = (datetime.now() - pred_date).days
                
                if days_old >= 10:
                    # Get current price
                    cursor.execute('SELECT current_price FROM stocks WHERE ticker = ?', (pred.ticker,))
                    row = cursor.fetchone()
                    
                    if row and row[0]:
                        tracker.update_outcome(pred.id, row[0])
                        updated += 1
            except Exception as e:
                errors += 1
                continue
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'total_pending': len(pending),
                'updated': updated,
                'errors': errors
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Register with Flask app
def register_backtest_routes(app):
    """Register backtest routes with Flask app."""
    app.register_blueprint(backtest_bp, url_prefix='/api/backtest')
    print("[API] Backtest routes registered")
