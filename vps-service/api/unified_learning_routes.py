# P1.7 (REFACTORING_REPORT §12): سُجّل الـ blueprint ده في lightweight_server.py
# بعد ما كان marked DEPRECATED بالغلط. الـ frontend بيستخدم 12+ endpoints على
# /api/unified-learning/* (شوف src/lib/use-python-api.ts). الـ variable name
# `learning_bp` مطابق لـ learning_routes.py لكن ده مش collision فعلي — كل
# module بـ يستورد blueprint مختلف (url_prefix مختلف: /api/learning vs /api/unified-learning).
"""
Unified Learning API Routes
===========================

API endpoints for the Unified Learning Engine.
All learning logic is in Python - Node.js is just the display layer.

Endpoints (actual URL prefix: /api/unified-learning):
- GET  /api/unified-learning/status           - حالة التعلم
- POST /api/unified-learning/iterative        - تشغيل التعلم التكراري
- POST /api/unified-learning/intelligent      - تشغيل التعلم الذكي
- GET  /api/unified-learning/indicators       - درجات الثقة للمؤشرات
- POST /api/unified-learning/mirror/:trade_id - تحليل المرآة لصفقة
- GET  /api/unified-learning/patterns         - الأنماط المكتشفة
- GET  /api/unified-learning/expectancy       - القيمة المتوقعة
- POST /api/unified-learning/mine-lessons     - تعدين الدروس
- GET  /api/unified-learning/summary          - ملخص شامل
- POST /api/unified-learning/stop             - إيقاف التعلم
- GET  /api/unified-learning/personas         - الشخصيات
- GET  /api/unified-learning/storage/*        - إدارة التخزين
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    # PHASE-3-DB-UNIFY (2026-08-29): unified_learning يستخدم predictions.db مباشرة
    # مش عبر config.DATABASE_PATH (الذي يرجع stocks.db للـ market data)
    from pathlib import Path as _P
    _base_dir = _P(__file__).parent.parent.parent.resolve()
    LEARNING_DB = os.environ.get('PREDICTIONS_DB', str(_base_dir / 'db' / 'predictions.db'))
except Exception:
    LEARNING_DB = str(_base_dir / 'db' / 'predictions.db')

from analyzers.unified_learning_engine import (
    UnifiedLearningEngine,
    LearningParameters,
    PERSONA_PARAMETERS
)
from analyzers.learning_file_storage import get_storage, LearningFileStorage

# Create Blueprint (using /api/unified-learning to avoid conflict)
unified_learning_bp = Blueprint('unified_learning', __name__, url_prefix='/api/unified-learning')

# Global engine instance
_engine = None

def get_engine():
    """Get or create engine instance"""
    global _engine
    if _engine is None:
        _engine = UnifiedLearningEngine(LEARNING_DB)
    return _engine


@learning_bp.route('/status', methods=['GET'])
def get_status():
    """
    حالة نظام التعلم
    
    Returns:
        - indicator_scores: درجات الثقة
        - patterns_count: عدد الأنماط
        - lessons_count: عدد الدروس
    """
    try:
        import sqlite3
        
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(LEARNING_DB, writable=False).__enter__()
        cursor = conn.cursor()
        
        # Helper function to safely get count
        def safe_count(table_name):
            try:
                cursor.execute(f'SELECT COUNT(*) FROM {table_name}')
                return cursor.fetchone()[0]
            except:
                return 0
        
        # Helper function to check if table exists
        def table_exists(table_name):
            cursor.execute('''
                SELECT name FROM sqlite_master WHERE type='table' AND name=?
            ''', (table_name,))
            return cursor.fetchone() is not None
        
        # Get counts with safe fallbacks
        lessons_count = safe_count('learned_lessons')
        signals_count = safe_count('signal_logs')
        outcomes_count = safe_count('outcome_logs')
        reliable_patterns = safe_count('conjunction_patterns') if table_exists('conjunction_patterns') else 0
        
        # Get indicator scores safely
        indicator_scores = []
        active_indicators = 0
        reflection_indicators = 0
        disabled_indicators = 0
        
        try:
            engine = get_engine()
            scores = engine.get_indicator_trust_scores()
            indicator_scores = scores
            active_indicators = len([s for s in scores if s.status == 'active'])
            reflection_indicators = len([s for s in scores if s.status == 'reflection'])
            disabled_indicators = len([s for s in scores if s.status == 'disabled'])
        except Exception as e:
            print(f'[Learning] Could not get indicator scores: {e}')
        
        # Get patterns safely
        patterns_count = 0
        try:
            engine = get_engine()
            patterns = engine.detect_patterns(1)
            patterns_count = len(patterns)
        except Exception as e:
            print(f'[Learning] Could not detect patterns: {e}')
        
        conn.close()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "indicator_scores_count": len(indicator_scores),
                "active_indicators": active_indicators,
                "reflection_indicators": reflection_indicators,
                "disabled_indicators": disabled_indicators,
                "patterns_detected": patterns_count,
                "lessons_learned": lessons_count,
                "total_signals": signals_count,
                "total_outcomes": outcomes_count,
                "reliable_patterns": reliable_patterns
            }
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "indicator_scores_count": 0,
                "active_indicators": 0,
                "reflection_indicators": 0,
                "disabled_indicators": 0,
                "patterns_detected": 0,
                "lessons_learned": 0,
                "total_signals": 0,
                "total_outcomes": 0,
                "reliable_patterns": 0
            },
            "error": str(e),
            "traceback": traceback.format_exc()
        })


@learning_bp.route('/iterative', methods=['POST'])
def run_iterative():
    """
    تشغيل التعلم التكراري
    
    Request Body:
        - persona: نوع الشخصية (default: balanced)
        - target_win_rate: الهدف (default: 75)
        - max_iterations: أقصى دورات (default: 30)
    """
    try:
        data = request.get_json() or {}
        
        persona = data.get('persona', 'balanced')
        target_win_rate = data.get('target_win_rate', 75.0)
        max_iterations = data.get('max_iterations', 30)
        
        engine = get_engine()
        
        result = engine.run_iterative_learning(
            persona=persona,
            target_win_rate=target_win_rate,
            max_iterations=max_iterations
        )
        
        # Convert iterations to JSON-serializable format
        iterations_data = []
        for iter in result.get('iterations', []):
            iterations_data.append({
                "iteration": iter.iteration,
                "win_rate": iter.win_rate,
                "total_trades": iter.total_trades,
                "total_return": iter.total_return,
                "parameters": {
                    "rsi_oversold": iter.parameters.rsi_oversold,
                    "rsi_overbought": iter.parameters.rsi_overbought,
                    "rsi_weight": iter.parameters.rsi_weight,
                    "macd_weight": iter.parameters.macd_weight,
                    "ma_weight": iter.parameters.ma_weight,
                    "confidence_threshold": iter.parameters.confidence_threshold,
                    "stop_loss_min": iter.parameters.stop_loss_min,
                    "stop_loss_max": iter.parameters.stop_loss_max,
                },
                "changes": iter.changes,
                "lessons": iter.lessons,
                "timestamp": iter.timestamp
            })

        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "result": {
                "success": result['success'],
                "target_achieved": result['target_achieved'],
                "final_win_rate": result['final_win_rate'],
                "total_iterations": result['total_iterations'],
                "iterations": iterations_data,
                "best_parameters": {
                    "rsi_oversold": result['best_parameters'].rsi_oversold,
                    "rsi_overbought": result['best_parameters'].rsi_overbought,
                    "rsi_weight": result['best_parameters'].rsi_weight,
                    "macd_weight": result['best_parameters'].macd_weight,
                    "ma_weight": result['best_parameters'].ma_weight,
                    "confidence_threshold": result['best_parameters'].confidence_threshold,
                    "stop_loss_min": result['best_parameters'].stop_loss_min,
                    "stop_loss_max": result['best_parameters'].stop_loss_max,
                }
            }
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/intelligent', methods=['POST'])
def run_intelligent():
    """
    تشغيل التعلم الذكي (Bayesian Optimization)
    
    Request Body:
        - target_win_rate: الهدف (default: 75)
        - max_iterations: أقصى دورات (default: 50)
        - custom_params: بارامترات مخصصة (optional)
    """
    try:
        data = request.get_json() or {}
        
        target_win_rate = data.get('target_win_rate', 75.0)
        max_iterations = data.get('max_iterations', 50)
        custom_params = data.get('custom_params')
        
        engine = get_engine()
        
        initial_params = None
        if custom_params:
            initial_params = LearningParameters(**custom_params)
        
        result = engine.run_intelligent_learning(
            target_win_rate=target_win_rate,
            max_iterations=max_iterations,
            custom_initial_params=initial_params
        )
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "result": {
                "success": result['success'],
                "target_achieved": result['target_achieved'],
                "final_win_rate": result['final_win_rate'],
                "total_iterations": result['total_iterations'],
                "best_parameters": {
                    "rsi_oversold": result['best_parameters'].rsi_oversold,
                    "rsi_overbought": result['best_parameters'].rsi_overbought,
                    "confidence_threshold": result['best_parameters'].confidence_threshold,
                }
            }
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/indicators', methods=['GET'])
def get_indicators():
    """
    درجات الثقة للمؤشرات
    """
    try:
        engine = get_engine()
        scores = engine.get_indicator_trust_scores()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": [
                {
                    "indicator": s.indicator_name,
                    "current_score": s.current_score,
                    "base_score": s.base_score,
                    "total_signals": s.total_signals,
                    "successful_signals": s.successful_signals,
                    "failed_signals": s.failed_signals,
                    "consecutive_losses": s.consecutive_losses,
                    "status": s.status,
                    "win_rate": (s.successful_signals / s.total_signals * 100) if s.total_signals > 0 else 0
                }
                for s in scores
            ]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/mirror/<int:trade_id>', methods=['POST'])
def run_mirror(trade_id):
    """
    تحليل المرآة لصفقة
    
    Returns:
        - 6 أسئلة مع إجاباتها
    """
    try:
        engine = get_engine()
        results = engine.run_mirror_analysis(trade_id)
        
        return jsonify({
            "success": True,
            "trade_id": trade_id,
            "timestamp": datetime.now().isoformat(),
            "analysis": [
                {
                    "question": r.question,
                    "answer": r.answer,
                    "insight": r.insight,
                    "severity": r.severity
                }
                for r in results
            ]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/patterns', methods=['GET'])
def get_patterns():
    """
    الأنماط المكتشفة
    
    Query Params:
        - months_back: عدد الشهر (default: 1)
    """
    try:
        months_back = request.args.get('months_back', 1, type=int)
        
        engine = get_engine()
        patterns = engine.detect_patterns(months_back)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "count": len(patterns),
            "patterns": [
                {
                    "pattern_name": p.pattern_name,
                    "occurrences": p.occurrences,
                    "win_rate": p.win_rate,
                    "suggested_lesson": p.suggested_lesson,
                    "suggested_action": p.suggested_action
                }
                for p in patterns
            ]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/expectancy', methods=['GET'])
def get_expectancy():
    """
    القيمة المتوقعة للمؤشرات
    
    Query Params:
        - regime: حالة السوق (optional)
    """
    try:
        regime = request.args.get('regime', None)
        
        engine = get_engine()
        results = engine.calculate_expectancy(regime)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "count": len(results),
            "expectancy": [
                {
                    "indicator": e.indicator,
                    "regime": e.regime,
                    "total_trades": e.total_trades,
                    "win_rate": round(e.win_rate, 2),
                    "avg_win_percent": round(e.avg_win_percent, 2),
                    "avg_loss_percent": round(e.avg_loss_percent, 2),
                    "expectancy": round(e.expectancy, 2),
                    "recommendation": e.recommendation
                }
                for e in results
            ]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/mine-lessons', methods=['POST'])
def mine_lessons():
    """
    تعدين الدروس من البيانات التاريخية
    """
    try:
        engine = get_engine()
        lessons = engine.mine_lessons()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "lessons_mined": len(lessons),
            "lessons": lessons
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/summary', methods=['GET'])
def get_summary():
    """
    ملخص شامل لحالة التعلم
    """
    try:
        engine = get_engine()
        
        # Get all data
        scores = engine.get_indicator_trust_scores()
        patterns = engine.detect_patterns(1)
        expectancy = engine.calculate_expectancy()
        lessons = engine.mine_lessons()
        
        # Calculate overall stats
        active_indicators = [s for s in scores if s.status == 'active']
        avg_score = sum(s.current_score for s in active_indicators) / len(active_indicators) if active_indicators else 100
        
        # Best/worst indicators
        sorted_exp = sorted(expectancy, key=lambda x: x.expectancy, reverse=True)
        best_indicator = sorted_exp[0].indicator if sorted_exp else None
        worst_indicator = sorted_exp[-1].indicator if sorted_exp else None
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "indicators": {
                    "total": len(scores),
                    "active": len(active_indicators),
                    "average_score": round(avg_score, 2),
                    "best_indicator": best_indicator,
                    "worst_indicator": worst_indicator
                },
                "patterns": {
                    "total": len(patterns),
                    "winning": len([p for p in patterns if p.win_rate > 65]),
                    "losing": len([p for p in patterns if p.win_rate < 40])
                },
                "lessons": {
                    "mined": len(lessons)
                },
                "recommendations": [
                    f"زيادة وزن {best_indicator}" if best_indicator else None,
                    f"تقليل وزن {worst_indicator}" if worst_indicator else None,
                ]
            }
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/stop', methods=['POST'])
def stop_learning():
    """
    إيقاف التعلم الجاري
    """
    try:
        engine = get_engine()
        engine.stop()
        
        return jsonify({
            "success": True,
            "message": "Learning stopped"
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/personas', methods=['GET'])
def get_personas():
    """
    الحصول على الشخصيات المتاحة
    """
    try:
        personas = {}
        for name, params in PERSONA_PARAMETERS.items():
            personas[name] = {
                "rsi_oversold": params.rsi_oversold,
                "rsi_overbought": params.rsi_overbought,
                "confidence_threshold": params.confidence_threshold,
                "stop_loss_min": params.stop_loss_min,
                "stop_loss_max": params.stop_loss_max,
            }
        
        return jsonify({
            "success": True,
            "personas": personas
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# FILE STORAGE ENDPOINTS - تخزين الملفات الخارجي
# ============================================================================

@learning_bp.route('/storage/stats', methods=['GET'])
def get_storage_stats():
    """
    إحصائيات التخزين الخارجي
    """
    try:
        storage = get_storage()
        stats = storage.get_storage_stats()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "stats": stats
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/storage/iterative-sessions', methods=['GET'])
def list_iterative_sessions():
    """
    قائمة جلسات التعلم التكراري المحفوظة في ملفات
    """
    try:
        storage = get_storage()
        limit = request.args.get('limit', 20, type=int)
        sessions = storage.list_iterative_sessions(limit)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "count": len(sessions),
            "sessions": sessions
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/storage/intelligent-sessions', methods=['GET'])
def list_intelligent_sessions():
    """
    قائمة جلسات التعلم الذكي المحفوظة في ملفات
    """
    try:
        storage = get_storage()
        limit = request.args.get('limit', 20, type=int)
        sessions = storage.list_intelligent_sessions(limit)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "count": len(sessions),
            "sessions": sessions
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/storage/session/<session_type>/<session_id>', methods=['GET'])
def get_session(session_type, session_id):
    """
    تحميل جلسة محددة
    
    Args:
        session_type: 'iterative' أو 'intelligent'
        session_id: معرف الجلسة
    """
    try:
        storage = get_storage()
        
        if session_type == 'iterative':
            data = storage.load_iterative_session(session_id)
        elif session_type == 'intelligent':
            data = storage.load_intelligent_session(session_id)
        else:
            return jsonify({"success": False, "error": "Invalid session type"}), 400
        
        if not data:
            return jsonify({"success": False, "error": "Session not found"}), 404
        
        return jsonify({
            "success": True,
            "session": data
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/storage/cleanup', methods=['POST'])
def cleanup_old_files():
    """
    تنظيف الملفات القديمة
    
    Request Body:
        - days_to_keep: عدد الأيام للاحتفاظ (default: 30)
    """
    try:
        storage = get_storage()
        data = request.get_json() or {}
        days_to_keep = data.get('days_to_keep', 30)
        
        deleted_count = storage.cleanup_old_files(days_to_keep)
        
        return jsonify({
            "success": True,
            "message": f"تم حذف {deleted_count} ملف قديم",
            "deleted_count": deleted_count
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/iterative-with-file', methods=['POST'])
def run_iterative_with_file():
    """
    تشغيل التعلم التكراري مع حفظ النتائج في ملف خارجي
    
    هذا يقلل الضغط على قاعدة البيانات ويحفظ فقط النتائج النهائية
    """
    try:
        data = request.get_json() or {}
        
        persona = data.get('persona', 'balanced')
        target_win_rate = data.get('target_win_rate', 75.0)
        max_iterations = data.get('max_iterations', 30)
        
        engine = get_engine()
        storage = get_storage()
        
        # Create session ID
        session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Progress callback - save to file
        def on_progress_file(iteration):
            storage.append_iteration_log({
                'iteration': iteration.iteration,
                'win_rate': iteration.win_rate,
                'total_trades': iteration.total_trades,
                'parameters': {
                    'rsi_oversold': iteration.parameters.rsi_oversold,
                    'rsi_overbought': iteration.parameters.rsi_overbought,
                    'confidence_threshold': iteration.parameters.confidence_threshold,
                },
                'changes': iteration.changes,
                'lessons': iteration.lessons
            }, session_id)
        
        # Run learning
        result = engine.run_iterative_learning(
            persona=persona,
            target_win_rate=target_win_rate,
            max_iterations=max_iterations,
            on_progress=on_progress_file
        )
        
        # Save final result to file
        final_data = {
            'success': result['success'],
            'target_achieved': result['target_achieved'],
            'final_win_rate': result['final_win_rate'],
            'total_iterations': result['total_iterations'],
            'best_parameters': {
                'rsi_oversold': result['best_parameters'].rsi_oversold,
                'rsi_overbought': result['best_parameters'].rsi_overbought,
                'rsi_weight': result['best_parameters'].rsi_weight,
                'macd_weight': result['best_parameters'].macd_weight,
                'confidence_threshold': result['best_parameters'].confidence_threshold,
            }
        }
        storage.save_iterative_session(final_data, session_id)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
            "result": final_data
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/intelligent-with-file', methods=['POST'])
def run_intelligent_with_file():
    """
    تشغيل التعلم الذكي مع حفظ النتائج في ملف خارجي
    """
    try:
        data = request.get_json() or {}
        
        target_win_rate = data.get('target_win_rate', 75.0)
        max_iterations = data.get('max_iterations', 50)
        custom_params = data.get('custom_params')
        
        engine = get_engine()
        storage = get_storage()
        
        session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        initial_params = None
        if custom_params:
            initial_params = LearningParameters(**custom_params)
        
        result = engine.run_intelligent_learning(
            target_win_rate=target_win_rate,
            max_iterations=max_iterations,
            custom_initial_params=initial_params
        )
        
        # Save to file
        final_data = {
            'success': result['success'],
            'target_achieved': result['target_achieved'],
            'final_win_rate': result['final_win_rate'],
            'total_iterations': result['total_iterations'],
            'best_parameters': {
                'rsi_oversold': result['best_parameters'].rsi_oversold,
                'rsi_overbought': result['best_parameters'].rsi_overbought,
                'confidence_threshold': result['best_parameters'].confidence_threshold,
            }
        }
        storage.save_intelligent_session(final_data, session_id)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
            "result": final_data
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/apply', methods=['POST'])
def apply_parameters():
    """
    تطبيق وحفظ الإعدادات المحسنة
    """
    try:
        data = request.get_json() or {}
        market = data.get('market', 'EGX').upper()
        persona = data.get('persona', 'balanced').lower()
        parameters = data.get('parameters', {})
        
        if not parameters:
            return jsonify({"success": False, "error": "No parameters provided"}), 400
            
        import json
        from config.unified_config import load_active_settings, ACTIVE_SETTINGS_PATH
        settings = load_active_settings()
        
        if "markets" not in settings:
            settings["markets"] = {}
        if market not in settings["markets"]:
            settings["markets"][market] = {}
            
        if "personas" not in settings:
            settings["personas"] = {}
        if persona not in settings["personas"]:
            settings["personas"][persona] = {}
            
        # Map parameters from LearningParameters keys to Profile keys
        market_mapping = {
            'rsi_oversold': 'rsi_oversold',
            'rsi_overbought': 'rsi_overbought',
            'min_rr': 'min_rr',
            'stop_loss_min': 'stop_min_pct',
            'stop_loss_max': 'stop_max_pct',
            'target_multiplier': 'target_rr_mult'
        }
        
        persona_mapping = {
            'confidence_threshold': 'score_threshold_boost',
            'position_size_pct': 'position_size_pct',
            'max_concurrent_trades': 'max_concurrent_trades'
        }
        
        for p_key, p_val in parameters.items():
            if p_key in market_mapping:
                m_key = market_mapping[p_key]
                settings["markets"][market][m_key] = float(p_val)
            elif p_key in persona_mapping:
                pers_key = persona_mapping[p_key]
                if pers_key == 'score_threshold_boost':
                    settings["personas"][persona][pers_key] = float(p_val) - 65.0
                else:
                    settings["personas"][persona][pers_key] = float(p_val)
            else:
                if "custom" not in settings:
                    settings["custom"] = {}
                if market not in settings["custom"]:
                    settings["custom"][market] = {}
                settings["custom"][market][p_key] = p_val

        # Save to file
        with open(ACTIVE_SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
            
        return jsonify({
            "success": True,
            "message": f"تم تطبيق وحفظ المعلمات المحسنة للسوق {market} وشخصية {persona}",
            "active_settings": settings
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@learning_bp.route('/learn-from-errors', methods=['POST'])
def run_learn_from_errors():
    """
    التعلم وتصحيح المسار من الأخطاء السابقة
    """
    try:
        data = request.get_json() or {}
        market = data.get('market', 'EGX').upper()
        persona = data.get('persona', 'balanced').lower()
        
        engine = get_engine()
        result = engine.learn_from_errors(market=market, persona=persona)
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

