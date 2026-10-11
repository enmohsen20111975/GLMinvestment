#!/usr/bin/env python3
"""
AI Predictions Routes
=====================
توليد وتقييم توقعات الذكاء الاصطناعي

هذا الملف يحتوي على كل المنطق والحسابات الخاصة بتوقعات AI
Next.js للعرض فقط - كل المنطق هنا

Endpoints:
- GET  /api/ai-predictions/info - معلومات التحليلات المتاحة
- POST /api/ai-predictions/generate - توليد توقعات جديدة
- POST /api/ai-predictions/evaluate - تقييم التوقعات
- GET  /api/ai-predictions/stats - إحصائيات التوقعات
"""

import os
import json
import uuid
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

# (أغسطس 2026 — PRODUCTION-PREDICTION-KILLER FIX)
# Flask is used ONLY for the HTTP route decorators in this module. The server
# itself is FastAPI (main.py runs Uvicorn), so these Flask routes are dead code
# at runtime. However, the scheduler (jobs/market_scheduler.py) imports the
# *internal* functions below (generate_predictions_internal,
# evaluate_all_pending_predictions_internal, cleanup_invalidated_predictions)
# to regenerate predictions after live-price updates. A hard `from flask import`
# made every such import raise `ModuleNotFoundError: No module named 'flask'`,
# which silently killed prediction regeneration on production.
# Fix: make Flask optional. When absent, route decorators become no-ops and
# jsonify falls back to json.dumps — the internal functions work unchanged.
try:
    from flask import Blueprint, jsonify, request
    _FLASK_AVAILABLE = True
except ImportError:
    _FLASK_AVAILABLE = False

    class Blueprint:
        """Stub Blueprint — accepts any decorator config, no-op at runtime."""
        def __init__(self, *args, **kwargs):
            self.name = args[0] if args else 'stub'
        def route(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator
        def before_request(self, fn):
            return fn
        def after_request(self, fn):
            return fn
        def errorhandler(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

    def jsonify(obj=None, *args, **kwargs):
        """Fallback jsonify — serialises to a JSON string when Flask is absent."""
        import json as _json
        payload = obj if obj is not None else (kwargs if kwargs else args[0] if args else {})
        return _json.dumps(payload, ensure_ascii=False, default=str)

    class request:  # type: ignore[no-redef]
        """Stub request object — returns empty values when Flask is absent."""
        args = {}
        form = {}
        json = {}
        data = b''
        @staticmethod
        def get_json(force=False, silent=False):
            return {}
        @staticmethod
        def get(*args, **kwargs):
            return None

# v3.29.0: Holiday-aware prediction dates — prevents predictions on Fri/Sat/holidays
try:
    from utils.trading_calendar import get_prediction_date_str, is_trading_day
except ImportError:
    def get_prediction_date_str(dt=None, market='EGX'):
        return (dt or datetime.now()).strftime('%Y-%m-%d')
    def is_trading_day(dt=None, market='EGX'):
        return (dt or datetime.now()).weekday() not in [4, 5]

# Database
import sqlite3
from contextlib import contextmanager

# Create Blueprint
ai_pred_bp = Blueprint('ai_predictions', __name__, url_prefix='/api/ai-predictions')

# ============================================================================
# DATABASE PATHS
# ============================================================================

from pathlib import Path
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()

# Database paths
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')


# ============================================================================
# CONCURRENCY GUARD
# ============================================================================
# generate_predictions_internal() writes to aiPrediction + updates stats.
# It is invoked concurrently from 8 call-sites (background_analyzer x2,
# v2_routes, misc_routes, this file's HTTP endpoint, main.py x2,
# jobs/market_scheduler). Without a guard, overlapping runs duplicate INSERTs,
# race on update_prediction_stats(), and hammer the SQLite WAL.
# Non-blocking acquire: a second caller skips immediately instead of piling up.
_predictions_lock = threading.Lock()


# ============================================================================
# DATABASE HELPERS
# ============================================================================

@contextmanager
def get_db_connection(db_path: str):
    """Get database connection with context manager."""
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def query_db(db_path: str, query: str, params: tuple = ()) -> List[Dict]:
    """Execute query and return results as list of dicts."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def execute_db(db_path: str, query: str, params: tuple = ()) -> int:
    """Execute update/insert and return affected rows."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def calculate_maestro_score(analysis: Dict) -> float:
    """حساب درجة المايسترو من التحليل"""
    score = analysis.get('overall_score', 50) or 50
    
    # Bonus for strong signals
    rsi_signal = analysis.get('rsi_signal', '')
    recommendation = analysis.get('recommendation', '')
    macd_signal = analysis.get('macd_signal', '')
    trend = analysis.get('trend', '')
    
    if rsi_signal == 'OVERSOLD' and 'BUY' in recommendation:
        score += 5
    if rsi_signal == 'OVERBOUGHT' and 'SELL' in recommendation:
        score += 5
    if macd_signal == 'BULLISH':
        score += 3
    if macd_signal == 'BEARISH':
        score -= 3
    if trend == 'UPTREND' and 'BUY' in recommendation:
        score += 5
    if trend == 'DOWNTREND' and 'SELL' in recommendation:
        score += 5
    
    return min(100, max(0, score))


# تحويل أسماء الأسواق
MARKET_MAPPING = {
    'EGX': 'EGX',
    'KSA': 'TADAWUL',
    'TADAWUL': 'TADAWUL',
    'KSE': 'KSE',
    'QSE': 'QSE',
    'DFM': 'DFM',
    'CRYPTO': 'CRYPTO',
}

def map_recommendation_to_signal(recommendation: str) -> str:
    """تحويل التوقعة إلى نوع الإشارة - يدعم uppercase و lowercase"""
    rec_upper = recommendation.upper() if recommendation else 'HOLD'
    
    buy_signals = ['BUY', 'STRONG_BUY', 'ACCUMULATE', 'SWING_BUY', 'T1_BUY']
    sell_signals = ['SELL', 'STRONG_SELL', 'REDUCE', 'STRONG_REDUCE']
    
    if rec_upper in buy_signals:
        return 'BUY'
    if rec_upper in sell_signals:
        return 'SELL'
    return 'HOLD'


def _get_historical_prices(symbol: str, limit: int = 30) -> List[Dict]:
    """جلب الأسعار التاريخية من price_history.db لحساب ATR

    CANONICAL-PRICE (Task PHASE-3, Rule 72):
      - HISTORICAL closes only (for ATR/volatility calc), NOT for live price.
      - For LIVE price use utils.live_price.get_live_price() or stocks.db.stocks.current_price.
    """
    try:
        conn = sqlite3.connect(PRICE_HISTORY_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT date, open_price as open, high_price as high, low_price as low, "
            "close_price as close, volume FROM price_history "
            "WHERE ticker = ? ORDER BY date DESC LIMIT ?",
            (symbol.upper(), limit)
        ).fetchall()
        conn.close()
        return [dict(r) for r in reversed(rows)]
    except Exception:
        return []


def _compute_atr(historical: List[Dict], period: int = 14) -> float:
    """حساب ATR من البيانات التاريخية"""
    if not historical or len(historical) < period + 1:
        return 0.0
    highs = [float(r.get('high', 0) or 0) for r in historical]
    lows = [float(r.get('low', 0) or 0) for r in historical]
    closes = [float(r.get('close', 0) or 0) for r in historical]
    atr_values = []
    for i in range(1, min(period + 1, len(highs))):
        tr = max(
            highs[-i] - lows[-i],
            abs(highs[-i] - (closes[-i - 1] if i < len(closes) else highs[-i])),
            abs(lows[-i] - (closes[-i - 1] if i < len(closes) else lows[-i])),
        )
        atr_values.append(tr)
    return sum(atr_values) / len(atr_values) if atr_values else 0.0


def calculate_target(entry_price: float, signal_type: str, confidence: float, symbol: str = '') -> float:
    """حساب سعر الهدف بشكل ديناميكي بناءً على ATR"""
    atr = _compute_atr(_get_historical_prices(symbol, 30), 14)
    atr_pct = (atr / entry_price * 100) if entry_price > 0 and atr > 0 else 5.0

    if signal_type == 'BUY':
        if atr > 0:
            target_mult = 2.0 if atr_pct > 3 else 1.5
            target_distance = target_mult * atr
        else:
            target_distance = entry_price * 0.07
        return round(entry_price + target_distance, 4)
    elif signal_type == 'SELL':
        if atr > 0:
            target_mult = 2.0 if atr_pct > 3 else 1.5
            target_distance = target_mult * atr
        else:
            target_distance = entry_price * 0.07
        return round(entry_price - target_distance, 4)
    elif signal_type == 'HOLD':
        # P20-FIXES-PART-2 (Aug 2026): HOLD predictions get a conservative
        # upside target (1× ATR or 3%) — "monitor for breakout" zone.
        if atr > 0:
            target_distance = atr
        else:
            target_distance = entry_price * 0.03
        return round(entry_price + target_distance, 4)
    return entry_price


def calculate_stop_loss(entry_price: float, signal_type: str, symbol: str = '') -> float:
    """حساب وقف خسارة ديناميكي بناءً على ATR بدل نسبة ثابتة"""
    atr = _compute_atr(_get_historical_prices(symbol, 30), 14)
    atr_pct = (atr / entry_price * 100) if entry_price > 0 and atr > 0 else 3.0

    if signal_type == 'BUY':
        if atr > 0:
            stop_mult = 2.0
            stop_distance = stop_mult * atr
        else:
            stop_distance = entry_price * 0.05
        stop_price = entry_price - stop_distance
        min_stop = entry_price * 0.97
        return round(max(stop_price, min_stop), 4)
    elif signal_type == 'SELL':
        if atr > 0:
            stop_mult = 2.0
            stop_distance = stop_mult * atr
        else:
            stop_distance = entry_price * 0.05
        stop_price = entry_price + stop_distance
        max_stop = entry_price * 1.03
        return round(min(stop_price, max_stop), 4)
    elif signal_type == 'HOLD':
        # P20-FIXES-PART-2 (Aug 2026): HOLD predictions get a tighter stop
        # (1× ATR or 4%) — "invalidation level" if the monitor thesis fails.
        if atr > 0:
            stop_distance = atr
        else:
            stop_distance = entry_price * 0.04
        stop_price = entry_price - stop_distance
        min_stop = entry_price * 0.96
        return round(max(stop_price, min_stop), 4)
    return entry_price


def get_current_price(symbol: str) -> Optional[float]:
    """الحصول على السعر الحالي للسهم — موحّد عبر utils.live_price.get_live_price.

    Closed-Loop A1: قبل كده كانت الدالة دي بـ تقرأ من stocks.db.stocks.current_price
    مباشرة — وهو المصدر الملوّث (COMI=140.23 بدل 140.5 من egksco). دلوقتي بـ
    تستخدم نفس مسار الشارت (intraday → data_engine → stocks.egksco → stocks.current_price).
    """
    try:
        # مصدر موحّد — نفس اللي بـ يستخدمه daily_closer و /live-tracking
        try:
            from utils.live_price import get_live_price
            _live = get_live_price(symbol)
            if _live and _live > 0:
                return round(float(_live), 4)
        except Exception:
            pass

        # Fallback: stocks table (لو live_price مش متاح)
        # CANONICAL-PRICE (Task PHASE-3, Rule 72) — stocks.db.stocks.current_price is the
        # canonical LIVE source. The chain below (live_price → stocks.current_price →
        # price_history.close_price) implements the hierarchy correctly.
        stocks = query_db(STOCKS_DB,
            "SELECT current_price FROM stocks WHERE ticker = ?",
            (symbol.upper(),))

        if stocks and stocks[0].get('current_price'):
            return float(stocks[0]['current_price'])

        # Try price_history table
        history = query_db(PRICE_HISTORY_DB,
            "SELECT close_price as close FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
            (symbol.upper(),))

        if history and history[0].get('close'):
            return float(history[0]['close'])

        return None
    except Exception as e:
        print(f"[AI Predictions] Error getting price for {symbol}: {e}")
        return None


def update_prediction_stats():
    """تحديث إحصائيات التوقعات"""
    try:
        # Get stats
        stats = query_db(PREDICTIONS_DB, """
            SELECT 
                COUNT(*) as total,
                AVG(maestro_score) as avg_score,
                AVG(profit_loss_percent) as avg_return
            FROM aiPrediction
        """)
        
        successful = query_db(PREDICTIONS_DB,
            "SELECT COUNT(*) as count FROM aiPrediction WHERE hit_target = 1")
        
        failed = query_db(PREDICTIONS_DB,
            "SELECT COUNT(*) as count FROM aiPrediction WHERE hit_stop_loss = 1")
        
        pending = query_db(PREDICTIONS_DB,
            "SELECT COUNT(*) as count FROM aiPrediction WHERE status = 'PENDING'")
        
        total = stats[0]['total'] if stats else 0
        successful_count = successful[0]['count'] if successful else 0
        failed_count = failed[0]['count'] if failed else 0
        pending_count = pending[0]['count'] if pending else 0
        closed = successful_count + failed_count
        success_rate = (successful_count / closed * 100) if closed > 0 else 0
        
        # Upsert stats
        execute_db(PREDICTIONS_DB, """
            INSERT OR REPLACE INTO aiPredictionStats 
            (id, total_predictions, successful_predictions, failed_predictions, 
             pending_predictions, success_rate, avg_return, avg_maestro_score, last_updated)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            total, successful_count, failed_count, pending_count,
            success_rate,
            stats[0]['avg_return'] if stats and stats[0]['avg_return'] else 0,
            stats[0]['avg_score'] if stats and stats[0]['avg_score'] else 0,
            datetime.now().isoformat()
        ))
        
    except Exception as e:
        print(f"[AI Predictions] Error updating stats: {e}")


# ============================================================================
# API ROUTES
# ============================================================================

@ai_pred_bp.route('/info', methods=['GET'])
def get_info():
    """
    الحصول على معلومات التحليلات المتاحة
    
    Query params:
    - min_score: أقل درجة مطلوبة (default: 60)
    """
    try:
        min_score = int(request.args.get('min_score', 60))
        
        # Check if cached_analysis table exists in predictions.db
        try:
            total_cached = query_db(STOCKS_DB,
                "SELECT COUNT(*) as count FROM cached_analysis")
            total_cached_count = total_cached[0]['count'] if total_cached else 0
        except:
            total_cached_count = 0
        
        # Get buy signals from cached_analysis (using confidence column)
        try:
            buy_signals = query_db(STOCKS_DB, """
                SELECT COUNT(*) as count FROM cached_analysis 
                WHERE confidence >= ? AND signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE')
            """, (min_score,))
            buy_count = buy_signals[0]['count'] if buy_signals else 0
        except:
            buy_count = 0
        
        # Get sell signals
        try:
            sell_signals = query_db(PREDICTIONS_DB, """
                SELECT COUNT(*) as count FROM cached_analysis 
                WHERE confidence >= ? AND signal IN ('SELL', 'STRONG_SELL', 'REDUCE')
            """, (min_score,))
            sell_count = sell_signals[0]['count'] if sell_signals else 0
        except:
            sell_count = 0
        
        # Get existing predictions count
        existing = query_db(PREDICTIONS_DB, 
            "SELECT COUNT(*) as count FROM aiPrediction")
        existing_count = existing[0]['count'] if existing else 0
        
        pending = query_db(PREDICTIONS_DB,
            "SELECT COUNT(*) as count FROM aiPrediction WHERE status = 'PENDING'")
        pending_count = pending[0]['count'] if pending else 0
        
        # Get latest scan date
        try:
            latest = query_db(STOCKS_DB,
                "SELECT MAX(created_at) as latest FROM cached_analysis")
            latest_scan = latest[0]['latest'] if latest else None
        except:
            latest_scan = None
        
        return jsonify({
            'success': True,
            'analysis': {
                'total_results': total_cached_count,
                'quality_results': total_cached_count,
                'buy_signals': buy_count,
                'sell_signals': sell_count,
                'latest_scan': latest_scan
            },
            'predictions': {
                'total': existing_count,
                'pending': pending_count
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ai_pred_bp.route('/status', methods=['GET'])
def get_prediction_status():
    """الحصول على حالة محرك التوقعات"""
    try:
        total = query_db(PREDICTIONS_DB, "SELECT COUNT(*) as count FROM aiPrediction")
        total_count = total[0]['count'] if total else 0
        
        pending = query_db(PREDICTIONS_DB, "SELECT COUNT(*) as count FROM aiPrediction WHERE status = 'PENDING'")
        pending_count = pending[0]['count'] if pending else 0
        
        latest = query_db(PREDICTIONS_DB, "SELECT MAX(created_at) as latest FROM aiPrediction")
        latest_date = latest[0]['latest'] if latest else None
        
        return jsonify({
            'success': True,
            'running': True,
            'connection': 'connected',
            'total_predictions': total_count,
            'pending_predictions': pending_count,
            'last_prediction_date': latest_date,
            'error_count': 0,
            'recent_logs': [
                f"محرك التوقعات جاهز. إجمالي التوقعات: {total_count}",
                f"التوقعات المعلقة: {pending_count}",
                f"آخر توقع تم إنشاؤه: {latest_date}"
            ]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'error_count': 1,
            'recent_logs': [f"خطأ في محرك التوقعات: {str(e)}"]
        }), 500


def generate_predictions_internal(
    market: str = 'EGX',
    min_score: float = 60,
    use_cached: bool = True,
    preview_mode: bool = False,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int | None = None,
    clear_old: bool = False,
    all_markets: bool = False,
    persona: str = None,
):
    """
    توليد توقعات جديدة داخلياً بدون الحاجة لطلب HTTP

    يدعم:
    - start_date/end_date: نطاق تاريخي
    - limit: حد أقصى لعدد التوقعات
    """
    # Task REAPPLY-CRITICAL-FIXES — non-canonical writer disabled (Rule 35).
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY writer to
    # predictions.db. This function previously INSERTed prediction rows
    # directly (Rule 35 violation). The original body below is preserved
    # (DO NOT EXECUTE) — the early-return ensures no INSERT runs. Canonical
    # predictions are produced by daily_predictor.py via cron.
    print(
        "[REAPPLY-CRITICAL-FIXES] generate_predictions_internal() DISABLED — "
        "Rule 35: V40.2 (daily_predictor.py) is the ONLY writer. "
        "Returning empty result without writing.",
        flush=True,
    )
    return False, (
        "Disabled by REAPPLY-CRITICAL-FIXES — V40.2 (daily_predictor.py) is "
        "the canonical writer. Use the canonical API: "
        "GET /api/stocks/[ticker]/unified"
    )
    # ─── ORIGINAL CODE BELOW — preserved for rollback reference (DO NOT EXECUTE) ───
    # The body below (re-entry lock + INSERT logic) is preserved verbatim.
    # It is unreachable due to the early-return above.
    # To re-enable: delete the early-return block above (3 lines: print + return + comment).
    # === PRESERVED BLOCK START ===
    """
    # Non-blocking re-entry guard — only one generation run at a time.
    # Concurrent callers (background scheduler + HTTP + cron) skip immediately
    # instead of piling up and racing on the same INSERTs / stats update.
    if not _predictions_lock.acquire(blocking=False):
        print("[AI Generate Internal] Already running — skip")
        return False, "Already running"
    try:
        print(f"[AI Generate Internal] Starting generation... market={market}, min_score={min_score}, preview={preview_mode}")

        # v3.29.0: Holiday-aware prediction date — shifts to next trading day
        # if today is Fri/Sat or an official EGX holiday. Predictions must
        # NEVER be dated on a non-trading day (user requirement).
        prediction_date = get_prediction_date_str(datetime.now(), market)
        if prediction_date != datetime.now().strftime('%Y-%m-%d'):
            print(f"[AI Generate Internal] Today is non-trading day → prediction_date shifted to {prediction_date}")

        # 0. مسح التوقعات القديمة إذا طُلب
        if clear_old and not preview_mode:
            try:
                today = datetime.now().strftime('%Y-%m-%d')
                old_count_ai = query_db(PREDICTIONS_DB, \"""
                    SELECT COUNT(*) as cnt FROM aiPrediction
                    WHERE prediction_date < ?
                \""", (today,))
                deleted_ai = old_count_ai[0]['cnt'] if old_count_ai else 0
                if deleted_ai > 0:
                    execute_db(PREDICTIONS_DB, \"""
                        DELETE FROM aiPrediction WHERE prediction_date < ?
                    \""", (today,))
                    print(f"[AI Generate Internal] Cleared {deleted_ai} old predictions from aiPrediction (before {today})")

                old_count_main = query_db(PREDICTIONS_DB, \"""
                    SELECT COUNT(*) as cnt FROM predictions
                    WHERE prediction_date < ?
                \""", (today,))
                deleted_main = old_count_main[0]['cnt'] if old_count_main else 0
                if deleted_main > 0:
                    execute_db(PREDICTIONS_DB, \"""
                        -- DEV-06 (2026-10-12): Hard DELETE disabled per Rule 21/35 — function already
                        -- disabled via REAPPLY-CRITICAL-FIXES early-return at L548. UPDATE shown below.
                        UPDATE predictions SET status='ARCHIVED', notes=COALESCE(notes,'') || ' | DEV-06-ARCHIVED' WHERE prediction_date < ?
                    \""", (today,))
                    print(f"[AI Generate Internal] Cleared {deleted_main} old predictions from predictions (before {today})")
            except Exception as e_clear:
                print(f"[AI Generate Internal] Error clearing old predictions: {e_clear}")
                errors.append(f"Error clearing old predictions: {str(e_clear)}")

        predictions_created = []
        errors = []
        analysis_data = []

        # ... (rest of original body up to the INSERT INTO predictions + final return)
        # The original INSERT INTO predictions statement at ~line 860 is also
        # part of this preserved block. It is NOT executed due to the early-return.
        return True, predictions_created
    except Exception as e:
        print(f"[AI Generate Internal] Crash: {e}")
        return False, str(e)
    finally:
        _predictions_lock.release()
    """
    # === PRESERVED BLOCK END ===


@ai_pred_bp.route('/generate', methods=['POST'])
def generate_predictions():
    """
    توليد توقعات جديدة من التحليل الموحد
    
    Body:
    - market: السوق المستهدف (EGX, KSA/TADAWUL, KSE, QSE, CRYPTO) أو "ALL" لكل الأسواق
    - start_date: تاريخ البداية (optional)
    - end_date: تاريخ النهاية (optional)
    - min_score: أقل درجة مطلوبة (default: 60)
    - use_cached_analysis: استخدام التحليل المحفوظ (default: true)
    - preview_mode: إرجاع النتائج بدون حفظ (default: false)
    - limit: حد أقصى لعدد التوقعات (default: 5)
    - clear_old: مسح التوقعات القديمة قبل التوليد (default: false)
    """
    try:
        data = request.get_json() or {}
        
        market_input = data.get('market', 'EGX')
        market = MARKET_MAPPING.get(market_input, market_input)
        
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        min_score = data.get('min_score', 60)
        use_cached = data.get('use_cached_analysis', True)
        preview_mode = data.get('preview_mode', False)
        limit = data.get('limit', 5)
        clear_old = data.get('clear_old', False)
        all_markets = data.get('all_markets', False) or market_input == 'ALL'
        
        success, result = generate_predictions_internal(
            market=market,
            min_score=min_score,
            use_cached=use_cached,
            preview_mode=preview_mode,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            clear_old=clear_old,
            all_markets=all_markets,
        )
        
        if success:
            prediction_date = datetime.now().strftime('%Y-%m-%d')
            return jsonify({
                'success': True,
                'message': f'تم {"معاينة" if preview_mode else "إنشاء"} {len(result)} توقع {"جديد" if not preview_mode else ""}',
                'predictions_count': len(result),
                'predictions': result,
                'errors': [],
                'market': market,
                'preview_mode': preview_mode,
                'date_range': {
                    'start': start_date or prediction_date,
                    'end': end_date or prediction_date
                }
            })
        else:
            return jsonify({
                'success': False,
                'error': result
            }), 500
            
    except Exception as e:
        print(f"[AI Generate] Error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ai_pred_bp.route('/evaluate', methods=['POST'])
def evaluate_predictions():
    """
    تقييم التوقعات خلال فترة زمنية محددة
    
    Body:
    - start_date: تاريخ البداية
    - end_date: تاريخ النهاية
    - close_expired: إغلاق التوقعات المنتهية (default: true)
    - max_days: أقصى عدد أيام للتوقع (default: 30)
    """
    try:
        data = request.get_json() or {}
        
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        close_expired = data.get('close_expired', True)
        max_days = data.get('max_days', 30)
        
        if not start_date or not end_date:
            return jsonify({
                'success': False,
                'error': 'يجب تحديد نطاق التاريخ'
            }), 400
        
        print(f"[AI Evaluate] Starting... {start_date} to {end_date}")
        
        # Get predictions in date range
        predictions = query_db(PREDICTIONS_DB, """
            SELECT * FROM aiPrediction 
            WHERE prediction_date >= ? AND prediction_date <= ? AND status = 'PENDING'
        """, (start_date, end_date))
        
        print(f"[AI Evaluate] Found {len(predictions)} pending predictions")
        
        results = {
            'evaluated': 0,
            'target_hit': 0,
            'stopped': 0,
            'expired': 0,
            'still_pending': 0,
            'no_price_data': 0,
            'details': []
        }
        
        now = datetime.now()
        
        for pred in predictions:
            try:
                # Get current price
                current_price = get_current_price(pred['stock_symbol'])
                
                if not current_price:
                    results['no_price_data'] += 1
                    continue
                
                prediction_date = datetime.strptime(pred['prediction_date'], '%Y-%m-%d')
                days_since = (now - prediction_date).days
                
                entry_price = float(pred['entry_price'])
                target_price = float(pred['target_price']) if pred.get('target_price') else None
                stop_loss = float(pred['stop_loss']) if pred.get('stop_loss') else None
                signal_type = pred['signal_type']
                
                new_status = 'PENDING'
                profit_loss_percent = 0
                hit_target = 0
                hit_stop_loss = 0
                
                # For BUY signals
                if signal_type == 'BUY':
                    if target_price and current_price >= target_price:
                        new_status = 'TARGET_HIT'
                        profit_loss_percent = ((current_price - entry_price) / entry_price) * 100
                        hit_target = 1
                        results['target_hit'] += 1
                    elif stop_loss and current_price <= stop_loss:
                        new_status = 'STOPPED'
                        profit_loss_percent = ((current_price - entry_price) / entry_price) * 100
                        hit_stop_loss = 1
                        results['stopped'] += 1
                
                # For SELL signals
                elif signal_type == 'SELL':
                    if target_price and current_price <= target_price:
                        new_status = 'TARGET_HIT'
                        profit_loss_percent = ((entry_price - current_price) / entry_price) * 100
                        hit_target = 1
                        results['target_hit'] += 1
                    elif stop_loss and current_price >= stop_loss:
                        new_status = 'STOPPED'
                        profit_loss_percent = ((entry_price - current_price) / entry_price) * 100
                        hit_stop_loss = 1
                        results['stopped'] += 1
                
                # Check expiration
                if new_status == 'PENDING' and days_since >= max_days and close_expired:
                    new_status = 'EXPIRED'
                    if signal_type == 'SELL':
                        profit_loss_percent = ((entry_price - current_price) / entry_price) * 100
                    else:
                        profit_loss_percent = ((current_price - entry_price) / entry_price) * 100
                    results['expired'] += 1
                
                # Update prediction
                if new_status != 'PENDING':
                    execute_db(PREDICTIONS_DB, """
                        UPDATE aiPrediction SET
                            status = ?,
                            final_price = ?,
                            profit_loss_percent = ?,
                            hit_target = ?,
                            hit_stop_loss = ?,
                            days_to_target = ?,
                            notes = ?,
                            updated_at = ?
                        WHERE id = ?
                    """, (
                        new_status,
                        current_price,
                        profit_loss_percent,
                        hit_target,
                        hit_stop_loss,
                        days_since if hit_target else None,
                        f'تم التقييم - السعر: {current_price:.2f}',
                        datetime.now().isoformat(),
                        pred['id']
                    ))
                    
                    results['evaluated'] += 1
                    results['details'].append({
                        'symbol': pred['stock_symbol'],
                        'old_status': 'PENDING',
                        'new_status': new_status,
                        'current_price': current_price,
                        'profit_loss': f'{profit_loss_percent:.2f}%'
                    })
                else:
                    results['still_pending'] += 1
                
            except Exception as e:
                print(f"[AI Evaluate] Error for {pred.get('stock_symbol')}: {e}")
        
        # Update overall stats
        update_prediction_stats()
        
        print(f"[AI Evaluate] Results: {results}")
        
        return jsonify({
            'success': True,
            'message': f'تم تقييم {results["evaluated"]} توقع',
            'results': {
                'evaluated': results['evaluated'],
                'target_hit': results['target_hit'],
                'stopped': results['stopped'],
                'expired': results['expired'],
                'still_pending': results['still_pending'],
                'no_price_data': results['no_price_data']
            },
            'details': results['details'][:20]
        })
        
    except Exception as e:
        print(f"[AI Evaluate] Error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ai_pred_bp.route('/stats', methods=['GET'])
def get_stats():
    """
    الحصول على إحصائيات التوقعات
    
    Query params:
    - start_date: تاريخ البداية (optional)
    - end_date: تاريخ النهاية (optional)
    """
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        # Build where clause
        where = ""
        params = []
        
        if start_date and end_date:
            where = "WHERE prediction_date >= ? AND prediction_date <= ?"
            params = [start_date, end_date]
        elif start_date:
            where = "WHERE prediction_date >= ?"
            params = [start_date]
        elif end_date:
            where = "WHERE prediction_date <= ?"
            params = [end_date]
        
        # Get statistics
        total = query_db(PREDICTIONS_DB, f"SELECT COUNT(*) as count FROM aiPrediction {where}", tuple(params))
        total_count = total[0]['count'] if total else 0
        
        pending_params = params + ['PENDING']
        pending = query_db(PREDICTIONS_DB, 
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} status = ?", 
            tuple(pending_params))
        pending_count = pending[0]['count'] if pending else 0
        
        target_hit_params = params + ['TARGET_HIT']
        target_hit = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} status = ?",
            tuple(target_hit_params))
        target_hit_count = target_hit[0]['count'] if target_hit else 0
        
        stopped_params = params + ['STOPPED']
        stopped = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} status = ?",
            tuple(stopped_params))
        stopped_count = stopped[0]['count'] if stopped else 0
        
        expired_params = params + ['EXPIRED']
        expired = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} status = ?",
            tuple(expired_params))
        expired_count = expired[0]['count'] if expired else 0
        
        closed = target_hit_count + stopped_count
        success_rate = (target_hit_count / closed * 100) if closed > 0 else 0
        
        # Get average return
        returns = query_db(PREDICTIONS_DB, f"""
            SELECT AVG(profit_loss_percent) as avg_return 
            FROM aiPrediction 
            {where} {'AND' if where else 'WHERE'} profit_loss_percent IS NOT NULL
        """, tuple(params))
        avg_return = returns[0]['avg_return'] if returns and returns[0]['avg_return'] else 0
        
        # Get by signal type
        buy_params = params + ['BUY']
        buy_count = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} signal_type = ?",
            tuple(buy_params))
        buy_signals = buy_count[0]['count'] if buy_count else 0
        
        sell_params = params + ['SELL']
        sell_count = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} signal_type = ?",
            tuple(sell_params))
        sell_signals = sell_count[0]['count'] if sell_count else 0
        
        # Get by maestro score
        high_params = params + [80]
        high_score = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} maestro_score >= ?",
            tuple(high_params))
        high_count = high_score[0]['count'] if high_score else 0
        
        medium_params = params + [60, 80]
        medium_score = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} maestro_score >= ? AND maestro_score < ?",
            tuple(medium_params))
        medium_count = medium_score[0]['count'] if medium_score else 0
        
        low_params = params + [60]
        low_score = query_db(PREDICTIONS_DB,
            f"SELECT COUNT(*) as count FROM aiPrediction {where} {'AND' if where else 'WHERE'} maestro_score < ?",
            tuple(low_params))
        low_count = low_score[0]['count'] if low_score else 0
        
        return jsonify({
            'success': True,
            'date_range': {
                'start': start_date or 'all',
                'end': end_date or 'all'
            },
            'statistics': {
                'total': total_count,
                'pending': pending_count,
                'closed': closed,
                'target_hit': target_hit_count,
                'stopped': stopped_count,
                'expired': expired_count,
                'success_rate': success_rate,
                'avg_return': avg_return
            },
            'by_signal_type': {
                'buy': buy_signals,
                'sell': sell_signals
            },
            'by_score': {
                'high': high_count,
                'medium': medium_count,
                'low': low_count
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ai_pred_bp.route('/list', methods=['GET'])
def list_predictions():
    """
    قائمة التوقعات
    
    Query params:
    - status: فلتر حسب الحالة (optional)
    - limit: عدد النتائج (default: 50)
    """
    try:
        status = request.args.get('status')
        limit = int(request.args.get('limit', 50))
        
        where = "WHERE status = ?" if status else ""
        params = [status] if status else []
        
        predictions = query_db(PREDICTIONS_DB, f"""
            SELECT * FROM aiPrediction 
            {where}
            ORDER BY prediction_date DESC, maestro_score DESC
            LIMIT ?
        """, tuple(params + [limit]))
        
        updated_preds = []
        for pred in predictions:
            pred_dict = dict(pred)
            if pred_dict.get('status') == 'PENDING':
                symbol = pred_dict.get('stock_symbol')
                curr_price = get_current_price(symbol)
                if curr_price is not None:
                    pred_dict['current_price'] = curr_price
                    entry_price = float(pred_dict['entry_price'])
                    target_price = float(pred_dict['target_price']) if pred_dict.get('target_price') else None
                    stop_loss = float(pred_dict['stop_loss']) if pred_dict.get('stop_loss') else None
                    signal_type = pred_dict['signal_type']
                    
                    new_status = 'PENDING'
                    profit_loss_percent = 0.0
                    hit_target = 0
                    hit_stop_loss = 0
                    
                    if signal_type == 'BUY':
                        profit_loss_percent = ((curr_price - entry_price) / entry_price) * 100
                        if target_price and curr_price >= target_price:
                            new_status = 'TARGET_HIT'
                            hit_target = 1
                        elif stop_loss and curr_price <= stop_loss:
                            new_status = 'STOPPED'
                            hit_stop_loss = 1
                    elif signal_type == 'SELL':
                        profit_loss_percent = ((entry_price - curr_price) / entry_price) * 100
                        if target_price and curr_price <= target_price:
                            new_status = 'TARGET_HIT'
                            hit_target = 1
                        elif stop_loss and curr_price >= stop_loss:
                            new_status = 'STOPPED'
                            hit_stop_loss = 1
                    
                    pred_dict['profit_loss_percent'] = round(profit_loss_percent, 2)
                    
                    if new_status != 'PENDING':
                        pred_dict['status'] = new_status
                        pred_dict['hit_target'] = hit_target
                        pred_dict['hit_stop_loss'] = hit_stop_loss
                        pred_dict['final_price'] = curr_price
                        try:
                            execute_db(PREDICTIONS_DB, """
                                UPDATE aiPrediction SET
                                    status = ?,
                                    hit_target = ?,
                                    hit_stop_loss = ?,
                                    final_price = ?,
                                    profit_loss_percent = ?,
                                    updated_at = datetime('now')
                                WHERE id = ?
                            """, (new_status, hit_target, hit_stop_loss, curr_price, round(profit_loss_percent, 2), pred_dict['id']))
                        except Exception as e_db:
                            print(f"[AI Predictions] Error updating prediction status: {e_db}")
            else:
                pred_dict['current_price'] = pred_dict.get('final_price')
            
            # Ensure frontend backward compatibility keys are set
            pred_dict['ticker'] = pred_dict.get('stock_symbol')
            pred_dict['signal'] = pred_dict.get('signal_type')
            updated_preds.append(pred_dict)
        
        return jsonify({
            'success': True,
            'predictions': updated_preds,
            'count': len(updated_preds)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ai_pred_bp.route('/clear', methods=['POST'])
def clear_predictions():
    """
    حذف التوقعات
    
    Body:
    - market: فلتر حسب السوق (optional)
    - status: فلتر حسب الحالة (optional)
    """
    try:
        data = request.get_json() or {}
        market = data.get('market')
        status = data.get('status')
        
        # Build delete query
        where_clauses = []
        params = []
        
        if market:
            where_clauses.append("market = ?")
            params.append(MARKET_MAPPING.get(market, market))
        
        if status:
            where_clauses.append("status = ?")
            params.append(status)
        
        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
        
        # Count before delete
        count_sql = f"SELECT COUNT(*) as cnt FROM aiPrediction WHERE {where_sql}"
        count_result = query_db(PREDICTIONS_DB, count_sql, tuple(params))
        deleted_count = count_result[0]['cnt'] if count_result else 0
        
        # Delete
        delete_sql = f"DELETE FROM aiPrediction WHERE {where_sql}"
        execute_db(PREDICTIONS_DB, delete_sql, tuple(params))
        
        print(f"[AI Predictions] Cleared {deleted_count} predictions")
        
        return jsonify({
            'success': True,
            'message': f'تم حذف {deleted_count} توقع',
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        print(f"[AI Predictions] Error clearing: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# INITIALIZATION - Create tables if not exist
# ============================================================================

def init_tables():
    """Create necessary tables if they don't exist"""
    try:
        # Check if aiPrediction table exists
        tables = query_db(PREDICTIONS_DB,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='aiPrediction'")

        if not tables:
            print("[AI Predictions] Creating aiPrediction table...")
            execute_db(PREDICTIONS_DB, """
                CREATE TABLE aiPrediction (
                    id TEXT PRIMARY KEY,
                    stock_symbol TEXT NOT NULL,
                    stock_name_ar TEXT,
                    maestro_score REAL DEFAULT 50,
                    confidence REAL DEFAULT 50,
                    signal_type TEXT DEFAULT 'BUY',
                    entry_price REAL NOT NULL,
                    target_price REAL,
                    stop_loss REAL,
                    regime TEXT,
                    phase_scores TEXT,
                    prediction_date TEXT NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    final_price REAL,
                    profit_loss_percent REAL,
                    hit_target INTEGER DEFAULT 0,
                    hit_stop_loss INTEGER DEFAULT 0,
                    days_to_target INTEGER,
                    signal_source_id TEXT,
                    notes TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT,
                    market TEXT DEFAULT 'EGX'
                )
            """)

            # Create indexes
            execute_db(PREDICTIONS_DB, "CREATE INDEX IF NOT EXISTS idx_symbol ON aiPrediction(stock_symbol)")
            execute_db(PREDICTIONS_DB, "CREATE INDEX IF NOT EXISTS idx_date ON aiPrediction(prediction_date)")
            execute_db(PREDICTIONS_DB, "CREATE INDEX IF NOT EXISTS idx_status ON aiPrediction(status)")
            execute_db(PREDICTIONS_DB, "CREATE INDEX IF NOT EXISTS idx_score ON aiPrediction(maestro_score)")

            print("[AI Predictions] Table created successfully")

        # ── P20-FIXES-PART-2 (Aug 2026): Heal legacy aiPrediction tables ──
        # PROBLEM: الـ INSERT في generate_predictions_internal بيكتب في عمود
        # `market`، بس الـ tables القديمة (اللي اتعملت قبل ما العمود يتضاف)
        # ما عندهاش العمود ده → OperationalError صامت → predictions_generated=0.
        # الحل: ALTER TABLE آمن (idempotent) يضيف العمود لو مش موجود.
        try:
            _aip_cols = [r['name'] for r in query_db(PREDICTIONS_DB, 'PRAGMA table_info(aiPrediction)')]
            if 'market' not in _aip_cols:
                execute_db(PREDICTIONS_DB, "ALTER TABLE aiPrediction ADD COLUMN market TEXT DEFAULT 'EGX'")
                print("[AI Predictions] ✓ Added missing 'market' column to aiPrediction (legacy heal)")
        except Exception as _aip_heal_err:
            print(f"[AI Predictions] aiPrediction market-column heal failed: {_aip_heal_err}")
        
        # Check if aiPredictionStats table exists
        stats_tables = query_db(PREDICTIONS_DB,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='aiPredictionStats'")
        
        if not stats_tables:
            print("[AI Predictions] Creating aiPredictionStats table...")
            execute_db(PREDICTIONS_DB, """
                CREATE TABLE aiPredictionStats (
                    id INTEGER PRIMARY KEY,
                    total_predictions INTEGER DEFAULT 0,
                    successful_predictions INTEGER DEFAULT 0,
                    failed_predictions INTEGER DEFAULT 0,
                    pending_predictions INTEGER DEFAULT 0,
                    success_rate REAL DEFAULT 0,
                    avg_return REAL DEFAULT 0,
                    avg_maestro_score REAL DEFAULT 0,
                    last_updated TEXT
                )
            """)
            print("[AI Predictions] Stats table created successfully")
            
    except Exception as e:
        print(f"[AI Predictions] Error initializing tables: {e}")


def evaluate_all_pending_predictions_internal():
    """
    Evaluates all pending predictions in the aiPrediction table against the latest prices.
    This is called automatically by the scheduler.
    """
    try:
        predictions = query_db(PREDICTIONS_DB, """
            SELECT * FROM aiPrediction 
            WHERE status = 'PENDING' OR status IS NULL
        """)
        
        evaluated_count = 0
        now = datetime.now()
        
        for pred in predictions:
            try:
                symbol = pred['stock_symbol']
                current_price = get_current_price(symbol)
                if current_price is None or current_price <= 0:
                    continue
                
                try:
                    pred_date = datetime.strptime(pred['prediction_date'][:10], '%Y-%m-%d')
                except:
                    pred_date = datetime.now()
                days_since = (now - pred_date).days
                
                entry_price = float(pred['entry_price'])
                target_price = float(pred['target_price']) if pred.get('target_price') else None
                stop_loss = float(pred['stop_loss']) if pred.get('stop_loss') else None
                signal_type = pred['signal_type']
                
                new_status = 'PENDING'
                profit_loss_percent = 0.0
                hit_target = 0
                hit_stop_loss = 0
                
                if signal_type == 'BUY':
                    profit_loss_percent = ((current_price - entry_price) / entry_price) * 100
                    if target_price and current_price >= target_price:
                        new_status = 'TARGET_HIT'
                        hit_target = 1
                    elif stop_loss and current_price <= stop_loss:
                        new_status = 'STOPPED'
                        hit_stop_loss = 1
                elif signal_type == 'SELL':
                    profit_loss_percent = ((entry_price - current_price) / entry_price) * 100
                    if target_price and current_price <= target_price:
                        new_status = 'TARGET_HIT'
                        hit_target = 1
                    elif stop_loss and current_price >= stop_loss:
                        new_status = 'STOPPED'
                        hit_stop_loss = 1
                
                # Check expiration (e.g. 30 days)
                if new_status == 'PENDING' and days_since >= 30:
                    new_status = 'EXPIRED'
                
                execute_db(PREDICTIONS_DB, """
                    UPDATE aiPrediction SET
                        status = ?,
                        final_price = ?,
                        profit_loss_percent = ?,
                        hit_target = ?,
                        hit_stop_loss = ?,
                        days_to_target = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                """, (
                    new_status,
                    current_price,
                    round(profit_loss_percent, 2),
                    hit_target,
                    hit_stop_loss,
                    days_since if hit_target else None,
                    pred['id']
                ))
                evaluated_count += 1
            except Exception as e_inner:
                print(f"[AI Evaluate Internal] Error evaluating prediction #{pred.get('id')}: {e_inner}")
        
        if evaluated_count > 0:
            update_prediction_stats()
            print(f"[AI Evaluate Internal] Successfully updated {evaluated_count} pending predictions.")
    except Exception as e:
        print(f"[AI Evaluate Internal] Error in evaluate_all_pending_predictions_internal: {e}")


def cleanup_invalidated_predictions():
    """
    بعد كل دورة تحديث: حدّث حالة التوقعات المنتهية بدل مسحها (PHASE-A2).
    - احذف EXPIRED القديمة جداً (أقدم من 90 يوم) فقط — للحفاظ على حجم معقول.
    - حدّث PENDING القديمة → EXPIRED (بدل مسحها) للحفاظ على التاريخ.
    - احذف CANCELLED فقط (إلغاء صريح من المستخدم — لا قيمة تحليلية).
    - حدّث أي status غير نهائي لأيام سابقة → EXPIRED.

    PHASE-A2 (أغسطس 2026): الكود القديم كان بـ DELETE كل التوقعات القديمة غير
    النهائية كل 15 دقيقة → فقدان التاريخ → استحالة حساب accuracy حقيقي.
    دلوقتي بنحافظ على التاريخ بـ UPDATE status='EXPIRED' وممسحش غير الـ EXPIRED
    اللي عمرها +90 يوم (للحفاظ على حجم DB معقول).
    """
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        cutoff_90d = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')

        # Delete EXPIRED predictions older than 90 days (was: older than today)
        r1 = execute_db(PREDICTIONS_DB, """
            DELETE FROM aiPrediction
            WHERE status = 'EXPIRED' AND prediction_date < ?
        """, (cutoff_90d,))
        if r1 > 0:
            print(f"[AI Cleanup] Deleted {r1} EXPIRED predictions older than 90 days")

        # UPDATE stale PENDING → EXPIRED (was: DELETE) — preserve history
        r2 = execute_db(PREDICTIONS_DB, """
            UPDATE aiPrediction
            SET status = 'EXPIRED', updated_at = datetime('now')
            WHERE status = 'PENDING' AND prediction_date < ?
        """, (today,))
        if r2 > 0:
            print(f"[AI Cleanup] Marked {r2} stale PENDING predictions as EXPIRED (preserved)")

        # Delete CANCELLED predictions (explicit user intent — no analytical value)
        r3 = execute_db(PREDICTIONS_DB, """
            DELETE FROM aiPrediction
            WHERE status = 'CANCELLED'
        """)
        if r3 > 0:
            print(f"[AI Cleanup] Deleted {r3} CANCELLED predictions")

        # UPDATE old non-final aiPredictions → EXPIRED (was: DELETE) — preserve history
        r4 = execute_db(PREDICTIONS_DB, """
            UPDATE aiPrediction
            SET status = 'EXPIRED', updated_at = datetime('now')
            WHERE prediction_date < ? AND status NOT IN ('TARGET_HIT', 'STOPPED', 'EXPIRED')
        """, (today,))
        if r4 > 0:
            print(f"[AI Cleanup] Marked {r4} old non-final aiPredictions as EXPIRED (preserved)")

        # UPDATE old non-final predictions → EXPIRED (was: DELETE) — preserve history
        r5 = execute_db(PREDICTIONS_DB, """
            UPDATE predictions
            SET status = 'EXPIRED', updated_at = datetime('now')
            WHERE prediction_date < ? AND status NOT IN ('TARGET_HIT', 'STOPPED', 'EXPIRED')
        """, (today,))
        if r5 > 0:
            print(f"[AI Cleanup] Marked {r5} old predictions as EXPIRED (preserved)")

    except Exception as e:
        print(f"[AI Cleanup] Error cleaning up predictions: {e}")


# Initialize tables on module load
init_tables()

print("✓ AI Predictions API registered (/api/ai-predictions/*)")
