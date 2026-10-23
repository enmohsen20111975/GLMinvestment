"""
Learning API Routes
====================
API endpoints for the learning system

Endpoints:
- GET  /api/learning/status - Get learning system status
- POST /api/learning/run-backfill - Run historical backfill
- GET  /api/learning/lessons - Get learned lessons
- GET  /api/learning/regime-weights - Get regime indicator weights
- GET  /api/learning/prediction-stats - Get prediction statistics
"""

from flask import Blueprint, jsonify, request
from core.auth_middleware import require_admin
from datetime import datetime
import sqlite3
import json
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config import DATABASE_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))

# Create Blueprint
learning_bp = Blueprint('learning', __name__, url_prefix='/api/learning')


@learning_bp.route('/status', methods=['GET'])
def get_learning_status():
    """
    الحصول على حالة نظام التعلم
    
    Returns:
        - total_predictions: إجمالي التوقعات
        - validated_predictions: التوقعات الموثقة
        - accuracy: دقة التوقعات
        - lessons_learned: عدد الدروس المستفادة
        - regime_weights: عدد أوزان الأنظمة
    """
    try:
        from engine.historical_backfill_engine import HistoricalBackfillEngine
        
        engine = HistoricalBackfillEngine(DATABASE_PATH)
        summary = engine.get_summary()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": summary
        })
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Historical backfill engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@learning_bp.route('/run-backfill', methods=['POST'])
def run_historical_backfill():
    """
    تشغيل عملية التعلم من الماضي (One-Time Backfill)
    
    هذا الـ endpoint يقوم بـ:
    1. قراءة stock_price_history (آخر 180 يوم)
    2. محاكاة توقعات النظام في كل يوم
    3. حساب النتائج الفعلية
    4. استخراج الدروس المستفادة
    5. حساب أوزان المؤشرات حسب القطاع
    
    Request Body:
        - days_back: عدد الأيام (default: 180)
        - stocks_limit: عدد الأسهم (0 = الكل)
    """
    try:
        from engine.historical_backfill_engine import HistoricalBackfillEngine
        
        data = request.get_json() or {}
        days_back = data.get('days_back', 180)
        stocks_limit = data.get('stocks_limit', 0)
        
        print(f"\n{'='*60}")
        print(" Starting Historical Backfill")
        print(f" Days: {days_back}, Stocks Limit: {stocks_limit if stocks_limit else 'All'}")
        print(f"{'='*60}\n")
        
        engine = HistoricalBackfillEngine(DATABASE_PATH)
        
        # Progress callback
        progress_log = []
        def progress_callback(info):
            msg = f"[{info['current']}/{info['total']}] {info['ticker']}: {info['predictions']} predictions"
            print(msg)
            progress_log.append(msg)
        
        results = engine.run_backfill(
            days_back=days_back,
            stocks_limit=stocks_limit,
            progress_callback=progress_callback
        )
        
        # Get final summary
        summary = engine.get_summary()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "results": results,
            "summary": summary
        })
        
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Historical backfill engine not available"
        }), 503
    except Exception as e:
        print(f"Error in backfill: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/lessons', methods=['GET'])
def get_learned_lessons():
    """
    الحصول على الدروس المستفادة
    
    Query Params:
        - ticker: فلترة حسب السهم
        - lesson_type: فلترة حسب النوع
        - limit: عدد النتائج
    """
    try:
        ticker = request.args.get('ticker', '').upper()
        lesson_type = request.args.get('lesson_type', '')
        limit = request.args.get('limit', 50, type=int)
        
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT * FROM learned_lessons WHERE 1=1"
        params = []
        
        if ticker:
            query += " AND title LIKE ?"
            params.append(f"{ticker}%")
        
        if lesson_type:
            query += " AND lesson_type = ?"
            params.append(lesson_type)
        
        query += f" ORDER BY occurrences DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        
        lessons = []
        for row in rows:
            lessons.append({
                "id": row['id'],
                "lesson_type": row['lesson_type'],
                "title": row['title'],
                "description": row['description'],
                "trigger_conditions": json.loads(row['trigger_conditions']) if row['trigger_conditions'] else {},
                "action": row['action'],
                "confidence_adjustment": row['confidence_adjustment'],
                "occurrences": row['occurrences'],
                "status": row['status'],
            })
        
        return jsonify({
            "success": True,
            "count": len(lessons),
            "lessons": lessons
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/regime-weights', methods=['GET'])
def get_regime_weights():
    """
    الحصول على أوزان المؤشرات حسب حالة السوق والقطاع
    
    Returns weights calculated from historical accuracy
    """
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT indicator_name, regime, weight, expectancy, last_calculated
            FROM regime_indicator_weights
            ORDER BY regime, indicator_name
        ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        weights = {}
        for row in rows:
            regime = row['regime']
            if regime not in weights:
                weights[regime] = {}
            
            weights[regime][row['indicator_name']] = {
                "weight": row['weight'],
                "expectancy": row['expectancy'],
                "last_calculated": row['last_calculated']
            }
        
        return jsonify({
            "success": True,
            "count": len(rows),
            "weights": weights
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/prediction-stats', methods=['GET'])
def get_prediction_stats():
    """
    إحصائيات التوقعات
    
    Returns:
        - By signal type
        - By market regime
        - By direction accuracy
        - Win rate overall
    """
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Overall stats
        cursor.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated,
                SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct_5d,
                SUM(CASE WHEN target_reached = 1 THEN 1 ELSE 0 END) as targets_reached,
                SUM(CASE WHEN stop_hit = 1 THEN 1 ELSE 0 END) as stops_hit,
                AVG(CASE WHEN validated = 1 AND direction_correct_5d IS NOT NULL 
                    THEN direction_correct_5d ELSE NULL END) * 100 as accuracy_5d
            FROM prediction_logs
        ''')
        overall = cursor.fetchone()
        
        # By recommendation
        cursor.execute('''
            SELECT 
                recommendation,
                COUNT(*) as total,
                SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct,
                ROUND(AVG(CASE WHEN direction_correct_5d IS NOT NULL 
                    THEN direction_correct_5d ELSE NULL END) * 100, 2) as accuracy_pct
            FROM prediction_logs
            WHERE validated = 1
            GROUP BY recommendation
            ORDER BY total DESC
        ''')
        by_recommendation = [dict(row) for row in cursor.fetchall()]
        
        # By market regime
        cursor.execute('''
            SELECT 
                market_regime,
                COUNT(*) as total,
                SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct,
                ROUND(AVG(CASE WHEN direction_correct_5d IS NOT NULL 
                    THEN direction_correct_5d ELSE NULL END) * 100, 2) as accuracy_pct
            FROM prediction_logs
            WHERE validated = 1 AND market_regime IS NOT NULL
            GROUP BY market_regime
            ORDER BY total DESC
        ''')
        by_regime = [dict(row) for row in cursor.fetchall()]
        
        # By predicted direction
        cursor.execute('''
            SELECT 
                predicted_direction,
                COUNT(*) as total,
                SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct,
                ROUND(AVG(CASE WHEN direction_correct_5d IS NOT NULL 
                    THEN direction_correct_5d ELSE NULL END) * 100, 2) as accuracy_pct
            FROM prediction_logs
            WHERE validated = 1
            GROUP BY predicted_direction
            ORDER BY total DESC
        ''')
        by_direction = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "overall": {
                "total_predictions": overall['total'],
                "validated": overall['validated'],
                "correct_5d": overall['correct_5d'],
                "targets_reached": overall['targets_reached'],
                "stops_hit": overall['stops_hit'],
                "accuracy_5d": round(overall['accuracy_5d'], 2) if overall['accuracy_5d'] else 0
            },
            "by_recommendation": by_recommendation,
            "by_regime": by_regime,
            "by_direction": by_direction
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
