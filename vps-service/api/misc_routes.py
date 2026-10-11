"""
Miscellaneous API
=================

API endpoints for seasonality signals, cache status, admin tasks, and stats.
Combined miscellaneous routes for the دليل الاستثمار.

Author:M2yDevelopers Team
Version: 1.0.0
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import time
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from utils.trading_calendar import get_prediction_date_str
except Exception:
    def get_prediction_date_str(dt=None, market='EGX'):
        return datetime.now().strftime('%Y-%m-%d')

# Create blueprint (no url_prefix - each route has full path)
misc_bp = Blueprint('miscellaneous', __name__)

# Try to import config
try:
    from config import DATABASE_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))

# Import database manager
try:
    from core.database import DatabaseManager
    DB_AVAILABLE = True
    db = DatabaseManager()
except ImportError as e:
    print(f"Warning: DatabaseManager not available: {e}")
    DB_AVAILABLE = False

# Phase 8 — Single Source of Truth gates:
#   - data.prices.load_price_history  → أي قراءة لأسعار (candles)
#   - data.analyses.persist_analysis_with_persona → أي كتابة لتحليل
#   - core.db_manager.db_manager → أي استعلامات تانية (WAL + busy_timeout)
# ممنوع sqlite3.connect() مباشر في الـ routes ده (Phase 8: Stability & Data Hygiene).
try:
    from core.db_manager import db_manager as _dbm
    _DBM_AVAILABLE = True
except Exception as _e:
    _DBM_AVAILABLE = False
    print(f"[misc_routes] Warning: db_manager not available ({_e}) — falling back to legacy sqlite3")

try:
    from data.prices import load_price_history as _load_price_history
    _PRICES_GATE = True
except Exception as _e:
    _PRICES_GATE = False
    print(f"[misc_routes] Warning: data.prices gate not available ({_e})")

try:
    from data.analyses import persist_analysis_with_persona as _persist_analysis
    _ANALYSES_GATE = True
except Exception as _e:
    _ANALYSES_GATE = False
    print(f"[misc_routes] Warning: data.analyses gate not available ({_e})")

# Module-level logger (إصلاح bug: live_refresh كان بيستخدم logger بدون تعريف)
import logging as _logging
_logger = _logging.getLogger('misc_routes')


# ─── Rule 54 / Phase 3: db_manager helper (WAL + busy_timeout + fallback) ───
# غلاف مركزي لفتح connection عبر db_manager.connection() مع fallback sqlite3.connect.
# الـ fallback بيحافظ على نفس الـ row_factory (sqlite3.Row) عشان الكود اللي بـ
# يستخدم row['column'] / dict(row) يفضل شغّال بدون تعديل.
from contextlib import contextmanager as _ctxmgr


@_ctxmgr
def _open_db(db_alias: str, db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect.

    Args:
        db_alias: اسم الـ DB المختصر ('stocks', 'predictions', 'data_engine', 'intraday', ...)
        db_path: مسار الـ DB على القرص (للـ fallback)
        writable: True للكتابة (WAL)، False للقراءة (readonly/immutable)

    Yields:
        sqlite3.Connection مع row_factory = sqlite3.Row (موحّد على المسارين).
    """
    ctx = None
    conn = None
    try:
        if _DBM_AVAILABLE:
            ctx = _dbm.connection(db_alias, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        # fallback: raw sqlite3.connect (backward compat)
        import sqlite3 as _sqlite3_fb
        conn = _sqlite3_fb.connect(db_path, timeout=30.0)
        conn.row_factory = _sqlite3_fb.Row
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass


# ─── Stock names cache (يوليو 2026) ──────────────────────────────────
# المستخدم طلب إضافة أسماء الأسهم بجانب الرموز في عرض التحليلات.
# بنجيب الأسماء من:
#   1. stocks.db (لو فيه ticker + name/name_ar columns)
#   2. stocks_full_data.json (fallback — فيه symbol + name)
# الـ cache بيتحمّل ويتحدّث كل ساعة (P2 fix: TTL بدل loading مرة واحدة)
_STOCK_NAMES_CACHE = None
_STOCK_NAMES_LOADED_AT = None
_STOCK_NAMES_TTL = 3600  # 1 ساعة بالثواني


def _load_stock_names() -> dict:
    """يحمّل أسماء الأسهم من stocks.db + data_engine.db + stocks_full_data.json.
    يرجع dict: {ticker: {'name': str, 'name_ar': str, 'sector': str, 'logo_url': str}}
    P2 fix: بيتحدّث كل ساعة (TTL) بدل loading مرة واحدة للأبد.
    FIX-RECOMMENDATIONS (يوليو 2026): أضفنا logo_url من data_engine.db.
    """
    global _STOCK_NAMES_CACHE, _STOCK_NAMES_LOADED_AT
    import time as _time
    now = _time.time()

    # لو الـ cache صالح (أقل من ساعة من آخر تحميل)، استخدمه
    if _STOCK_NAMES_CACHE is not None and _STOCK_NAMES_LOADED_AT is not None:
        if (now - _STOCK_NAMES_LOADED_AT) < _STOCK_NAMES_TTL:
            return _STOCK_NAMES_CACHE

    _STOCK_NAMES_CACHE = {}
    _STOCK_NAMES_LOADED_AT = now  # تحديث وقت التحميل

    def _ensure_entry(t: str) -> dict:
        """يضمن وجود entry للسهم في الكاش مع كل الحقول (logo_url = '' افتراضياً)."""
        t = (t or '').upper().strip()
        if not t:
            return {}
        if t not in _STOCK_NAMES_CACHE:
            _STOCK_NAMES_CACHE[t] = {
                'name': t, 'name_ar': t, 'sector': '', 'logo_url': '',
            }
        else:
            _STOCK_NAMES_CACHE[t].setdefault('logo_url', '')
        return _STOCK_NAMES_CACHE[t]

    # 1. جرب stocks.db
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _stocks_db = str(_root / 'db' / 'stocks.db')
        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('stocks', _stocks_db) as conn:
            # جرب columns مختلفة (stocks.db الـ schema بتختلف)
            try:
                rows = conn.execute("""
                    SELECT ticker, name, name_ar, sector FROM stocks
                    WHERE ticker IS NOT NULL
                """).fetchall()
                for r in rows:
                    t = (r['ticker'] or '').upper().strip()
                    if t:
                        _STOCK_NAMES_CACHE[t] = {
                            'name': r['name'] or t,
                            'name_ar': r['name_ar'] or r['name'] or t,
                            'sector': r['sector'] or '',
                            'logo_url': '',
                        }
            except Exception:
                # لو الـ columns مش موجودة، جرّب name بس
                try:
                    rows = conn.execute("SELECT name FROM stocks LIMIT 1").fetchall()
                    # لو فيه column name بس مفيش ticker، skip
                except Exception as e:
                    print(f"[Warning] stock names cache column check failed: {e}")
    except Exception as e:
        print(f"[Warning] stock names cache load from DB failed: {e}")

    # 2. data_engine.db — جلب logo_url + name + sector من جدول stocks (symbol column)
    #    المصدر الأساسي للأيقونات حسب fetch_logos.py.
    try:
        import sqlite3 as _de_sql
        from pathlib import Path as _de_path
        _root = _de_path(__file__).resolve().parent.parent.parent
        _de_db = str(_root / 'db' / 'data_engine.db')
        if os.path.exists(_de_db):
            # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
            with _open_db('data_engine', _de_db) as de_conn:
                try:
                    # جدول stocks في data_engine.db بـ schema:
                    # (id, symbol, name, price, ..., sector, ..., logo_url, last_update)
                    de_rows = de_conn.execute("""
                        SELECT symbol, name, sector, logo_url FROM stocks
                        WHERE symbol IS NOT NULL
                    """).fetchall()
                    merged_logos = 0
                    for r in de_rows:
                        sym = (r['symbol'] or '').upper().strip()
                        if not sym:
                            continue
                        entry = _ensure_entry(sym)
                        # نحدّث name / name_ar / sector بس لو فاضية في الكاش
                        if (not entry.get('name') or entry['name'] == sym) and r['name']:
                            entry['name'] = r['name']
                            # data_engine.db فيها الاسم العربي بالأساس
                            if not entry.get('name_ar') or entry['name_ar'] == sym:
                                entry['name_ar'] = r['name']
                        if not entry.get('sector') and r['sector']:
                            entry['sector'] = r['sector']
                        # logo_url نحدّثه دايماً (المصدر الأساسي)
                        if r['logo_url']:
                            entry['logo_url'] = r['logo_url']
                            merged_logos += 1
                    print(f"[Info] stock names cache: merged {merged_logos} logos from data_engine.db")
                except Exception as e:
                    print(f"[Warning] data_engine.db stocks query failed: {e}")
    except Exception as e:
        print(f"[Warning] data_engine.db logo load failed: {e}")

    # 3. fallback: stocks_full_data.json
    try:
        import json
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _json_path = _root / 'db' / 'stocks_full_data.json'
        if _json_path.exists():
            with open(_json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                for item in data:
                    sym = (item.get('symbol') or '').upper().strip()
                    if sym and sym not in _STOCK_NAMES_CACHE:
                        _STOCK_NAMES_CACHE[sym] = {
                            'name': item.get('name') or sym,
                            'name_ar': item.get('name') or sym,
                            'sector': item.get('sector') or '',
                            'logo_url': '',
                        }
    except Exception as e:
        print(f"[Warning] stock names cache JSON fallback failed: {e}")

    return _STOCK_NAMES_CACHE


def _get_stock_name(ticker: str) -> dict:
    """بيرجع {'name': str, 'name_ar': str, 'sector': str, 'logo_url': str} للسهم.
    لو السهم مش موجود → {'name': ticker, 'name_ar': ticker, 'sector': '', 'logo_url': ''}
    FIX-RECOMMENDATIONS (يوليو 2026): أضفنا logo_url للحقل اللي بيرجع.
    """
    if not ticker:
        return {'name': '', 'name_ar': '', 'sector': '', 'logo_url': ''}
    names = _load_stock_names()
    t = ticker.upper().strip()
    return names.get(t, {'name': ticker, 'name_ar': ticker, 'sector': '', 'logo_url': ''})


# Import MasterAnalyzer
try:
    from analyzers.master_analyzer import MasterAnalyzer
    MASTER_ANALYZER_AVAILABLE = True
    master_analyzer = MasterAnalyzer(DATABASE_PATH)
except ImportError as e:
    print(f"Warning: MasterAnalyzer not available: {e}")
    MASTER_ANALYZER_AVAILABLE = False
    master_analyzer = None

# Track start time for uptime
START_TIME = time.time()

# Check if Kimi's fixes are available
try:
    from analyzers.kimi_fixes import (
        validate_and_adjust_signal,
        apply_rsi_override,
        RSI_OVERBOUGHT,
        MIN_RISK_REWARD,
    )
    KIMI_FIXES_AVAILABLE = True
    print("✓ Kimi's fixes loaded successfully in misc_routes")
except ImportError as e:
    KIMI_FIXES_AVAILABLE = False
    print(f"Warning: Kimi's fixes not available in misc_routes: {e}")


# ============================================================================
# DIAGNOSTIC ENDPOINT
# ============================================================================

@misc_bp.route('/api/debug/kimi-fixes', methods=['GET'])
def check_kimi_fixes():
    """
    التحقق من تحميل Kimi's fixes
    """
    import sys
    import os
    
    # Check if file exists
    kimi_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'analyzers', 'kimi_fixes.py')
    file_exists = os.path.exists(kimi_file_path)
    
    # Check if master_analyzer has KIMI_FIXES_AVAILABLE
    master_analyzer_status = "unknown"
    if master_analyzer:
        # Try to check the KIMI_FIXES_AVAILABLE flag
        try:
            from analyzers import master_analyzer as ma_module
            master_analyzer_status = getattr(ma_module, 'KIMI_FIXES_AVAILABLE', 'not_found')
        except Exception:
            master_analyzer_status = "import_failed"
    
    return jsonify({
        "success": True,
        "timestamp": datetime.now().isoformat(),
        "kimi_fixes": {
            "file_exists": file_exists,
            "file_path": kimi_file_path,
            "imported": KIMI_FIXES_AVAILABLE,
            "rsi_overbought": RSI_OVERBOUGHT if KIMI_FIXES_AVAILABLE else None,
            "min_risk_reward": MIN_RISK_REWARD if KIMI_FIXES_AVAILABLE else None,
        },
        "master_analyzer": {
            "available": MASTER_ANALYZER_AVAILABLE,
            "kimi_fixes_flag": master_analyzer_status
        },
        "python_path": sys.path[:5]  # First 5 paths
    })


# ============================================================================
# SEASONALITY SIGNALS ENDPOINT
# ============================================================================

@misc_bp.route('/api/seasonality-signals', methods=['GET'])
def seasonality_signals():
    """
    إشارات الموسمية - Seasonality First Engine
    
    Returns signals based on:
    - Seasonality: 35% (EGX validated patterns)
    - Fundamental: 30% (Piotroski + Altman)
    - Sector Relative: 20%
    - Dividend: 15%
    """
    try:
        from analyzers.seasonality_first_engine import SeasonalityFirstEngine
        
        # Get parameters
        limit = request.args.get('limit', 20, type=int)
        action = request.args.get('action', 'signals')
        
        # Initialize engine
        engine = SeasonalityFirstEngine(DATABASE_PATH)
        
        if action == 'signals':
            # Scan market for signals
            signals = engine.scan_market(limit=limit)
            
            # Format response
            formatted_signals = []
            for sig in signals:
                formatted_signals.append({
                    "ticker": sig.ticker,
                    "signal": sig.signal,
                    "signal_ar": sig.signal_ar,
                    "confidence": sig.confidence,
                    "total_score": sig.total_score,
                    "seasonality_score": sig.seasonality_score,
                    "fundamental_score": sig.fundamental_score,
                    "sector_score": sig.sector_score,
                    "dividend_score": sig.dividend_score,
                    "risk_level": sig.risk_level,
                    "suggested_position_pct": sig.suggested_position_pct,
                    "recommendations": sig.recommendations[:3] if sig.recommendations else [],
                    "warnings": sig.warnings[:2] if sig.warnings else [],
                    "timestamp": sig.timestamp
                })
            
            return jsonify({
                "status": "success",
                "source": "seasonality_first_engine",
                "scan_date": datetime.now().strftime("%Y-%m-%d"),
                "scan_timestamp": datetime.now().isoformat(),
                "summary": {
                    "total_signals": len(formatted_signals),
                    "strong_buy": len([s for s in formatted_signals if s['signal'] == 'STRONG_BUY']),
                    "buy": len([s for s in formatted_signals if s['signal'] == 'BUY']),
                    "accumulate": len([s for s in formatted_signals if s['signal'] == 'ACCUMULATE']),
                    "avg_total_score": round(sum(s['total_score'] for s in formatted_signals) / len(formatted_signals), 1) if formatted_signals else 0,
                    "avg_confidence": round(sum(s['confidence'] for s in formatted_signals) / len(formatted_signals), 2) if formatted_signals else 0
                },
                "signals": formatted_signals
            })
        
        elif action == 'analyze':
            ticker = request.args.get('ticker')
            if not ticker:
                return jsonify({"error": "ticker parameter required"}), 400
            
            signal = engine.analyze(ticker.upper())
            if signal:
                return jsonify({
                    "status": "success",
                    "signal": signal.to_dict()
                })
            else:
                return jsonify({
                    "status": "success",
                    "signal": None,
                    "message": "لا توجد بيانات كافية للتحليل"
                })
        
        else:
            return jsonify({"error": "Invalid action"}), 400
            
    except ImportError as e:
        return jsonify({
            "status": "error",
            "error": "SeasonalityFirstEngine not available",
            "detail": str(e)
        }), 503
    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500


# ============================================================================
# ADMIN DAILY ANALYSIS ENDPOINT
# ============================================================================

@misc_bp.route('/api/admin/run-daily-analysis', methods=['POST'])
def run_daily_analysis():
    """
    تشغيل التحليل اليومي لكل الأسهم وحفظه في الكاش
    هذا الـ endpoint يُستدعى من الأدمن مرة واحدة يومياً
    """
    try:
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        if not db:
            return jsonify({
                "success": False,
                "error": "DatabaseManager not available"
            }), 503
        
        # Initialize cache table
        db.init_cached_analysis_table()
        
        # Get all tickers
        tickers = master_analyzer._get_all_tickers()
        total_tickers = len(tickers)
        
        # Analyze all stocks
        results = []
        errors = []
        today = get_prediction_date_str()
        
        for i, ticker in enumerate(tickers):
            try:
                analysis = master_analyzer.analyze(ticker)
                analysis_dict = analysis.to_dict()
                
                # Save to cache
                db.save_cached_analysis(ticker, analysis_dict, today)
                results.append(analysis_dict)
                
            except Exception as e:
                errors.append({"ticker": ticker, "error": str(e)})
        
        # Get summary
        buy_count = len([r for r in results if r.get('signal') in ['STRONG_BUY', 'BUY', 'ACCUMULATE']])
        sell_count = len([r for r in results if r.get('signal') in ['SELL', 'STRONG_SELL', 'REDUCE']])
        hold_count = len([r for r in results if r.get('signal') == 'HOLD'])
        excluded_count = len([r for r in results if r.get('signal') in ['EXCLUDED', 'INSUFFICIENT_DATA']])
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "analysis_date": today,
            "summary": {
                "total_tickers": total_tickers,
                "analyzed": len(results),
                "errors": len(errors),
                "buy_signals": buy_count,
                "sell_signals": sell_count,
                "hold_signals": hold_count,
                "excluded": excluded_count
            },
            "errors": errors[:10] if errors else []  # First 10 errors only
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# CACHE STATUS ENDPOINT
# ============================================================================

@misc_bp.route('/api/cache/status', methods=['GET'])
def get_cache_status():
    """الحصول على حالة الكاش"""
    try:
        if not db:
            return jsonify({
                "success": False,
                "error": "DatabaseManager not available"
            }), 503
            
        status = db.get_cache_status()
        return jsonify({
            "success": True,
            "cache": status
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# SYSTEM STATS ENDPOINT
# ============================================================================

@misc_bp.route('/api/stats/dashboard', methods=['GET'])
def get_dashboard_stats():
    """
    إحصائيات النظام للوحة التحكم
    System statistics for dashboard
    """
    try:
        import sqlite3
        
        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('stocks', DATABASE_PATH) as conn:
            cursor = conn.cursor()
            
            # Stocks count
            cursor.execute('SELECT COUNT(*) as count FROM stocks')
            stocks_count = cursor.fetchone()['count']
            
            # Stocks with prices
            cursor.execute('SELECT COUNT(*) as count FROM stocks WHERE current_price IS NOT NULL AND current_price > 0')
            stocks_with_prices = cursor.fetchone()['count']
            
            # History count
            cursor.execute('SELECT COUNT(*) as count FROM stock_price_history')
            history_count = cursor.fetchone()['count']
            
            # Predictions count — PREDICTIONS-DB-ONLY (يوليو 2026):
            # كان بيتقرأ من stocks.db.prediction_logs (قديم/فاضي).
            # دلوقتي بنقرأ من predictions.db.prediction_logs (المصدر الطازج).
            predictions_count = 0
            try:
                from pathlib import Path as _P
                _pred_db_path = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                with _open_db('predictions', _pred_db_path) as _pconn:
                    _pcur = _pconn.execute('SELECT COUNT(*) as count FROM prediction_logs')
                    _prow = _pcur.fetchone()
                    predictions_count = _prow['count'] if _prow else 0
            except Exception as _pe:
                print(f"[dashboard_stats] prediction_logs read from predictions.db failed: {_pe}")
                predictions_count = 0
            
            # Recommendations count
            cursor.execute('SELECT COUNT(*) as count FROM recommendations WHERE date(created_at) = date("now")')
            today_recommendations = cursor.fetchone()['count']
            
            # Gainers/Losers
            cursor.execute('SELECT COUNT(*) as count FROM stocks WHERE change_percent > 0')
            gainers = cursor.fetchone()['count']
            
            cursor.execute('SELECT COUNT(*) as count FROM stocks WHERE change_percent < 0')
            losers = cursor.fetchone()['count']
            
            # EGX30 members
            cursor.execute('SELECT COUNT(*) as count FROM stocks WHERE egx30_member = 1')
            egx30_count = cursor.fetchone()['count']
            
            # Last update
            cursor.execute('SELECT MAX(last_update) as last_update FROM stocks')
            last_update = cursor.fetchone()['last_update']
            
            # Prediction accuracy — PREDICTIONS-DB-ONLY (يوليو 2026):
            # كان بيتقرأ من stocks.db.prediction_logs (الأعمدة validated/direction_correct_5d
            # غير موجودة هناك → استعلام مكسور يرجّع 0 دايماً).
            # دلوقتي بنقرأ من predictions.db.prediction_logs (الـ schema الكاملة 50+ عمود).
            accuracy = 0
            try:
                from pathlib import Path as _P2
                _pred_db_path2 = str(_P2(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                with _open_db('predictions', _pred_db_path2) as _pconn2:
                    _acc_row = _pconn2.execute('''
                        SELECT
                            COUNT(*) as total,
                            SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct
                        FROM prediction_logs
                        WHERE validated = 1 AND direction_correct_5d IS NOT NULL
                    ''').fetchone()
                    if _acc_row and _acc_row['total'] and _acc_row['total'] > 0:
                        accuracy = round((_acc_row['correct'] / _acc_row['total']) * 100, 2)
            except Exception as _ae:
                print(f"[dashboard_stats] prediction accuracy read from predictions.db failed: {_ae}")
                accuracy = 0
        
        # System health
        uptime = time.time() - START_TIME
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "system": {
                "uptime_seconds": round(uptime, 0),
                "uptime_hours": round(uptime / 3600, 2),
                "status": "healthy",
                "version": "7.0.0",
                "architecture": "Python = BRAIN, Node.js = DISPLAY"
            },
            "database": {
                "stocks_count": stocks_count,
                "stocks_with_prices": stocks_with_prices,
                "history_count": history_count,
                "predictions_count": predictions_count,
                "today_recommendations": today_recommendations,
                "last_update": last_update
            },
            "market": {
                "gainers": gainers,
                "losers": losers,
                "unchanged": stocks_with_prices - gainers - losers,
                "egx30_members": egx30_count
            },
            "performance": {
                "prediction_accuracy": accuracy,
                "data_coverage": round((stocks_with_prices / stocks_count * 100), 2) if stocks_count > 0 else 0
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRADING TIME ADVISOR ENDPOINT
# ============================================================================

@misc_bp.route('/api/trading/time', methods=['GET'])
def get_trading_time():
    """
    نصيحة وقت التداول - Trading Time Advisor
    
    EGX Trading Hours:
    - Pre-opening: 09:30 - 10:00 (لا تداول)
    - Opening: 10:00 - 10:30 (تقلب عالي - تجنب)
    - Morning: 10:30 - 11:30 (استقرار نسبي - حذر)
    - Best Time: 11:30 - 13:00 (أفضل وقت للدخول)
    - Pre-close: 13:00 - 14:00 (للمضاربة السريعة)
    - Closing: 14:00 - 14:30 (تجنب)
    
    Crypto: 24/7 - أفضل الأوقات حسب السيولة
    """
    try:
        market = request.args.get('market', 'egx').lower()
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        current_day = now.strftime("%A")
        
        # EGX Market Hours (Cairo Time)
        EGX_OPEN = "10:00"
        EGX_CLOSE = "14:30"
        EGX_BEST_START = "11:30"
        EGX_BEST_END = "13:00"
        
        result = {
            "market": market,
            "current_time": current_time,
            "current_day": current_day,
            "timezone": "Africa/Cairo",
            "date": now.strftime("%Y-%m-%d"),
        }
        
        if market == 'egx':
            # Check if weekend (Friday, Saturday in Egypt - but EGX trades Sat-Thu)
            # EGX Trading Days: Saturday to Thursday
            is_weekend = current_day in ['Friday']
            
            # Parse times
            current_minutes = int(current_time.split(':')[0]) * 60 + int(current_time.split(':')[1])
            open_minutes = int(EGX_OPEN.split(':')[0]) * 60 + int(EGX_OPEN.split(':')[1])
            close_minutes = int(EGX_CLOSE.split(':')[0]) * 60 + int(EGX_CLOSE.split(':')[1])
            best_start_minutes = int(EGX_BEST_START.split(':')[0]) * 60 + int(EGX_BEST_START.split(':')[1])
            best_end_minutes = int(EGX_BEST_END.split(':')[0]) * 60 + int(EGX_BEST_END.split(':')[1])
            
            # Determine market status
            if is_weekend:
                market_status = "closed"
                status_ar = "مغلق (عطلة نهاية الأسبوع)"
                advice = "السوق مغلق - الجمعة عطلة"
                advice_ar = "السوق مغلق - الجمعة عطلة"
                day_score = 0
            elif current_minutes < open_minutes:
                market_status = "pre_market"
                status_ar = "قبل الجلسة"
                advice = "Market not open yet - wait for 10:00"
                advice_ar = "السوق لم يفتح بعد - انتظر حتى 10:00"
                day_score = 50
            elif current_minutes >= close_minutes:
                market_status = "closed"
                status_ar = "مغلق"
                advice = "Market closed for today"
                advice_ar = "السوق مغلق اليوم"
                day_score = 0
            elif open_minutes <= current_minutes < open_minutes + 30:
                market_status = "open"
                status_ar = "مفتوح - الافتتاح"
                advice = "⚠️ High volatility - Avoid trading in first 30 minutes"
                advice_ar = "⚠️ تقلب عالي - تجنب التداول في أول 30 دقيقة"
                day_score = 30
            elif best_start_minutes <= current_minutes < best_end_minutes:
                market_status = "open"
                status_ar = "مفتوح - أفضل وقت"
                advice = "✅ BEST TIME - Ideal for entry"
                advice_ar = "✅ أفضل وقت - مثالي للدخول"
                day_score = 90
            elif open_minutes + 30 <= current_minutes < best_start_minutes:
                market_status = "open"
                status_ar = "مفتوح - الصباح"
                advice = "⏳ Market stabilizing - Trade with caution"
                advice_ar = "⏳ السوق يستقر - تداول بحذر"
                day_score = 60
            elif best_end_minutes <= current_minutes < close_minutes - 30:
                market_status = "open"
                status_ar = "مفتوح - قبل الإغلاق"
                advice = "⏳ Good for quick trades only"
                advice_ar = "⏳ جيد للمضاربة السريعة فقط"
                day_score = 50
            else:  # Last 30 minutes
                market_status = "open"
                status_ar = "مفتوح - الإغلاق"
                advice = "⚠️ Avoid - Market closing soon"
                advice_ar = "⚠️ تجنب - السوق سيغلق قريباً"
                day_score = 20
            
            # Day of week score (Sunday best, Thursday worst for buying)
            day_scores = {
                'Saturday': 60,  # بداية الأسبوع - حذر
                'Sunday': 90,    # أفضل يوم
                'Monday': 70,    # جيد
                'Tuesday': 60,   # متوسط
                'Wednesday': 50, # أقل فرص
                'Thursday': 30,  # بيع فقط
                'Friday': 0      # مغلق
            }
            day_score = day_scores.get(current_day, 50)
            
            result.update({
                "market_status": market_status,
                "status_ar": status_ar,
                "is_open": market_status == "open",
                "advice": advice,
                "advice_ar": advice_ar,
                "day_score": day_score,
                "best_time": f"{EGX_BEST_START} - {EGX_BEST_END}",
                "trading_hours": f"{EGX_OPEN} - {EGX_CLOSE}",
                "day_tip": {
                    'Saturday': "بداية الأسبوع - تداول بحذر",
                    'Sunday': "أفضل يوم للتداول",
                    'Monday': "يوم جيد للتداول",
                    'Tuesday': "فرص متوسطة",
                    'Wednesday': "راقب فقط",
                    'Thursday': "بيع فقط - لا تشتري",
                    'Friday': "السوق مغلق"
                }.get(current_day, "")
            })
            
        elif market == 'crypto':
            # Crypto is 24/7
            result.update({
                "market_status": "open",
                "status_ar": "مفتوح 24/7",
                "is_open": True,
                "advice": "Crypto markets are open 24/7",
                "advice_ar": "أسواق العملات الرقمية مفتوحة 24/7",
                "day_score": 70,
                "trading_hours": "24/7",
                "best_time": "09:00 - 17:00 UTC (highest liquidity)",
                "note": "Watch for US market open (14:30 Cairo) for volatility"
            })
        else:
            return jsonify({
                "success": False,
                "error": f"Unknown market: {market}. Use 'egx' or 'crypto'"
            }), 400
        
        result["success"] = True
        result["timestamp"] = now.isoformat()
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Endpoints ناقصة — أضيفت يوليو 2026
# ============================================================
# الـ frontend بينادي على endpoints مش موجودة في Python.
# ده بيسبب 502/503/405 errors. أضفناها هنا عشان الـ proxy يشتغل.
# ============================================================

@misc_bp.route('/api/fundamentals/fetch', methods=['POST'])
def fetch_egx_fundamentals():
    """يجيب fundamentals لأسهم EGX من EGXPilot (مجاني) ويخزنها في data_engine.db.

    Body:
      limit — عدد الأسهم (0 = كل الأسهم، افتراضي 5 للـ test)
      source — 'egxpilot' (افتراضي) أو 'tradingview' (كل الأسواق)
    """
    try:
        data = request.get_json(silent=True) or {}
        limit = int(data.get('limit', 5))
        source = data.get('source', 'egxpilot')

        if source == 'tradingview':
            # TradingView scraper — بيسحب كل الأسواق (مصر/السعودية/الكويت/قطر)
            # محتاج Playwright + Chrome
            import subprocess
            import asyncio
            from pathlib import Path
            _root = Path(__file__).resolve().parent.parent.parent

            scraper_path = str(_root / 'data_engine' / 'scrapers' / 'tradingview_scraper.py')

            # شغّل الـ scraper في background process (بياخد وقت طويل)
            try:
                process = subprocess.Popen(
                    ['python3', scraper_path],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(_root)
                )

                return jsonify({
                    'success': True,
                    'source': 'tradingview',
                    'message': 'TradingView scraper بدأ في الـ background — هياخد 10-15 دقيقة',
                    'pid': process.pid,
                    'note': 'الـ scraper بيسحب 4 أسواق × 8 تبويباتfundamental'
                })
            except Exception as e:
                return jsonify({
                    'success': False,
                    'source': 'tradingview',
                    'error': f'فشل تشغيل scraper: {e}',
                    'hint': 'تأكد إن playwright + chromium متثبتين: pip install playwright && playwright install chromium'
                }), 200

        # default: EGXPilot (سريع — 1 طلب)
        from data.egx_fundamental_fetcher import EGXFundamentalFetcher
        fetcher = EGXFundamentalFetcher()
        result = fetcher.fetch_all_egx_fundamentals(limit=limit)

        return jsonify({
            'success': True,
            'source': 'egxpilot',
            **result,
            'message': f"تم جلب {result.get('fetched', 0)} سهم — {result.get('stored', 0)} مخزّن",
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 200


@misc_bp.route('/api/fundamentals/tradingview/status', methods=['GET'])
def tradingview_scraper_status():
    """فحص حالة TradingView scraper + البيانات المتاحة."""
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'data_engine.db')

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('data_engine', _db) as conn:
            stats = {}
            # tab tables (اللي بيسحبها TradingView scraper)
            tab_tables = [
                'tab_technical_analysis', 'tab_profitability', 'tab_valuation',
                'tab_dividends', 'tab_performance', 'tab_balance_sheet',
                'tab_income_statement', 'tab_cash_flow'
            ]

            for table in tab_tables:
                try:
                    count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    stats[table] = count
                except Exception:
                    stats[table] = 0

            # stocks table (بيانات أساسية من TradingView)
            try:
                stocks_count = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
                by_market = conn.execute(
                    "SELECT market, COUNT(*) as cnt FROM stocks GROUP BY market"
                ).fetchall()
                stats['stocks_total'] = stocks_count
                stats['stocks_by_market'] = {r['market']: r['cnt'] for r in by_market}
            except Exception:
                stats['stocks_total'] = 0
                stats['stocks_by_market'] = {}

            # egx_fundamentals (من EGXPilot)
            try:
                stats['egx_fundamentals'] = conn.execute(
                    "SELECT COUNT(*) FROM egx_fundamentals"
                ).fetchone()[0]
            except Exception:
                stats['egx_fundamentals'] = 0

        # JSON file (outside DB context — doesn't need DB)
        json_path = _root / 'data_engine' / 'data' / 'stocks_full_data.json'
        stats['json_file_exists'] = json_path.exists()
        if json_path.exists():
            stats['json_file_size'] = f"{json_path.stat().st_size / 1024:.0f} KB"

        # Playwright available?
        try:
            import subprocess
            result = subprocess.run(
                ['python3', '-c', 'import playwright; print("ok")'],
                capture_output=True, text=True, timeout=5
            )
            stats['playwright_available'] = 'ok' in result.stdout
        except Exception:
            stats['playwright_available'] = False

        return jsonify({
            'success': True,
            'stats': stats,
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 200


@misc_bp.route('/api/fundamentals/<ticker>', methods=['GET'])
def get_stock_fundamentals(ticker):
    """يجيب fundamentals لسهم واحد (من data_engine.db أو EGXPilot)."""
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'data_engine.db')

        # الأول من DB
        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('data_engine', _db) as conn:
            try:
                row = conn.execute(
                    "SELECT * FROM egx_fundamentals WHERE ticker = ?",
                    (ticker.upper(),)
                ).fetchone()
                if row:
                    return jsonify({
                        'success': True,
                        'source': 'database',
                        'fundamentals': dict(row),
                    })
            except Exception as e:
                print(f"[Warning] EGX fundamentals DB query failed for {ticker}: {e}")

        # fallback: EGXPilot live
        from data.egx_fundamental_fetcher import EGXFundamentalFetcher
        fetcher = EGXFundamentalFetcher()
        fund = fetcher.get_fundamentals(ticker)

        if fund:
            return jsonify({
                'success': True,
                'source': 'egxpilot_live',
                'fundamentals': fund,
            })

        return jsonify({
            'success': False,
            'error': f'مفيش fundamentals لـ {ticker}',
        }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 200


@misc_bp.route('/api/fundamentals/stats', methods=['GET'])
def fundamentals_stats():
    """إحصائيات الـ fundamentals في data_engine.db."""
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'data_engine.db')

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('data_engine', _db) as conn:
            try:
                total = conn.execute("SELECT COUNT(*) FROM egx_fundamentals").fetchone()[0]
                avg_score = conn.execute("SELECT AVG(fundamental_score) FROM egx_fundamentals").fetchone()[0]
                top_stocks = conn.execute("""
                    SELECT ticker, name, fundamental_score, pe_ratio, roe, net_margin
                    FROM egx_fundamentals
                    ORDER BY fundamental_score DESC
                    LIMIT 10
                """).fetchall()
            except Exception:
                total = 0
                avg_score = 0
                top_stocks = []

        return jsonify({
            'success': True,
            'total_stocks': total,
            'avg_fundamental_score': round(avg_score, 1) if avg_score else 0,
            'top_stocks': [dict(r) for r in top_stocks],
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 200


@misc_bp.route('/api/admin/trigger-analysis', methods=['POST'])
def trigger_analysis_manual():
    """تحليل فوري لـ N أسهم — بغضّ النظر عن حالة السوق.

    المستخدم لما يفتح Maestro Dashboard ويدوس "تشغيل التحليل"، الـ BackgroundAnalyzer
    بيرفض يشغل لو السوق مقفل. الـ endpoint ده بيتخطّى الشرط ده وبيحلّل فوراً.

    P21-PERSONA-CONSTRAINTS (Aug 2026): بقى يقبل `persona` في الـ body عشان
    يطبّق قيود الـ persona المناسبة:
      - persona=gambler (default): عتبات منخفضة → BUY signals كتير للمضارب
      - persona=balanced: عتبات وسطى
      - persona=conservative: عتبات عالية → HOLD لحماية رأس المال

    SELECTION-FIX (v3.56.0): إصلاح اختيار الأسهم. قبل كده كان الـ endpoint بـ:
      (1) يتجاهل `tickers`/`symbols` في الـ body
      (2) يرتب بـ `ORDER BY volume DESC` على عمود TEXT (قيم زي '988.35K' بتطلع
          lexical sort → TWSATA فوق COMI)
      (3) ما بـ يفلترش الأسهم اللي ليها 1 bar بس → run_analysis_batch بـ يـ skip
          الكل → analyzed=0
    دلوقتي:
      (1) لو `tickers` موجود → نحلّلهم بالظبط (request order)
      (2) لو لأ → نرتب بـ turnover_egp (numeric) + is_egx30/70/100 flags
      (3) نفلتر بـ filter_tickers_by_history_depth(min_bars=10) عشان نضمن إن
          كل سهم في الـ batch عنده history كافي للتحليل

    Body:
      market — السوق (افتراضي EGX)
      limit — عدد الأسهم (افتراضي 20)
      persona — نوع الشخصية (افتراضي gambler)
      tickers / symbols — قائمة اختيارية بـ tickers محددّة (list أو comma-string)
    """
    try:
        data = request.get_json(silent=True) or {}
        market = data.get('market', 'EGX').upper()
        limit = min(int(data.get('limit', 20)), 500)  # رفع الحد الأقصى إلى 500 بعد تسريع الكاش
        # P21: persona من الـ body، default='gambler' عشان buy_signals > 0 دايماً
        persona = (data.get('persona') or 'gambler').lower().strip()
        if persona not in ('gambler', 'balanced', 'conservative', 'investor', 'active_trader'):
            persona = 'gambler'

        # SELECTION-FIX (v3.56.0): tickers/symbols من الـ body
        tickers_req = data.get('tickers') or data.get('symbols') or []
        if isinstance(tickers_req, str):
            tickers_req = [t.strip() for t in tickers_req.split(',') if t.strip()]
        tickers_req = [str(t).strip().upper() for t in tickers_req if str(t).strip()]

        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _stocks_db = str(_root / 'db' / 'stocks.db')

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('stocks', _stocks_db) as conn:
            # P26-MARKET-ISOLATION (Aug 2026): فلتر الأسهم حسب السوق المطلوب إجباري.
            # KSA بـتتخزن في الـ stocks table كـ 'TADAWUL' — نعمل mapping.
            _db_market = 'TADAWUL' if market == 'KSA' else market

            # ── SELECTION-FIX (v3.56.0): Path A — explicit tickers ──
            if tickers_req:
                placeholders = ','.join(['?'] * len(tickers_req))
                try:
                    rows = conn.execute(f"""
                        SELECT ticker, name, name_ar, current_price, change_percent,
                               volume, sector, market, turnover_egp, is_active
                        FROM stocks
                        WHERE UPPER(ticker) IN ({placeholders})
                          AND current_price IS NOT NULL AND current_price > 0
                    """, tickers_req).fetchall()
                    rows_by_ticker = {r['ticker'].upper(): dict(r) for r in rows}
                    # Preserve request order (skip unknown tickers silently)
                    stocks = [rows_by_ticker[t] for t in tickers_req if t in rows_by_ticker]
                except Exception:
                    # fallback لو الـ columns مش موجودة
                    try:
                        rows = conn.execute(f"""
                            SELECT ticker, name, current_price, market FROM stocks
                            WHERE UPPER(ticker) IN ({placeholders})
                              AND current_price > 0
                        """, tickers_req).fetchall()
                        rows_by_ticker = {r['ticker'].upper(): dict(r) for r in rows}
                        stocks = [rows_by_ticker[t] for t in tickers_req if t in rows_by_ticker]
                    except Exception:
                        stocks = []
            # ── SELECTION-FIX (v3.56.0): Path B — auto-select by turnover + EGX index ──
            else:
                # نfetch limit*5 candidates، فلتر بـ history depth، trim لـ limit.
                # كده لو فيه junk بـ turnover عالي بس 1 bar، نقدر نوفّر limit سهم صالح.
                _fetch_n = max(limit * 5, 50)
                try:
                    rows = conn.execute("""
                        SELECT ticker, name, name_ar, current_price, change_percent,
                               volume, sector, market, turnover_egp, is_active
                        FROM stocks
                        WHERE (market = ? OR (market IS NULL AND ? = 'EGX'))
                          AND current_price IS NOT NULL AND current_price > 0
                          AND COALESCE(is_active, 1) = 1
                        ORDER BY
                          COALESCE(is_egx30, 0) DESC,
                          COALESCE(is_egx70, 0) DESC,
                          COALESCE(is_egx100, 0) DESC,
                          COALESCE(turnover_egp, 0) DESC,
                          COALESCE(value_traded, 0) DESC,
                          LENGTH(ticker) ASC
                        LIMIT ?
                    """, (_db_market, _db_market, _fetch_n)).fetchall()
                    candidates = [dict(r) for r in rows]
                except Exception:
                    # fallback لو is_egx* / turnover_egp / value_traded مش موجودة
                    try:
                        rows = conn.execute("""
                            SELECT ticker, name, name_ar, current_price, change_percent,
                                   volume, sector, market, turnover_egp, is_active
                            FROM stocks
                            WHERE (market = ? OR (market IS NULL AND ? = 'EGX'))
                              AND current_price IS NOT NULL AND current_price > 0
                            ORDER BY LENGTH(ticker) ASC
                            LIMIT ?
                        """, (_db_market, _db_market, _fetch_n)).fetchall()
                        candidates = [dict(r) for r in rows]
                    except Exception:
                        candidates = []

                # فلتر بـ history depth (skip 1-bar junk)
                try:
                    from data.prices import filter_tickers_by_history_depth
                    candidate_tickers = [c.get('ticker', '') for c in candidates]
                    valid_tickers = filter_tickers_by_history_depth(
                        candidate_tickers, min_bars=10
                    )
                    valid_set = set(valid_tickers)
                    stocks = [c for c in candidates if c.get('ticker', '').upper() in valid_set]
                    stocks = stocks[:limit]
                    # لو فلتر الـ history رفض الكل (مثلاً price_history.db فاضي)،
                    # نرجّع أول limit من candidates (batch هيـ skip ويظهر analyzed=0
                    # بـ error واضح بدل ما يرجّع "مفيش أسهم")
                    if not stocks and candidates:
                        stocks = candidates[:limit]
                except Exception:
                    # filter module مش متاح — نرجّع candidates[:limit]
                    stocks = candidates[:limit] if candidates else []

        if not stocks:
            return jsonify({
                'success': False,
                'error': 'مفيش أسهم بأسعار صالحة في stocks.db',
                'analyzed': 0,
            }), 200

        # ── PHASE 2 (v3.51.0): مسار كتابة موحد — core.analysis_runner ──
        # قبل كده: الـ loop (history → analyze → persist) كان مكرر في:
        #   - trigger_analysis_manual (هنا)
        #   - maestro_routes.run_full_analysis
        #   - background_analyzer._analyze_batch
        # كل واحد كان فيه اختلافات صغيرة (history limit، gate threshold، error
        # handling) سببت bugs على الإنتاج (trigger استخدم fallback قصير، maestro
        # استخدم canonical طويل → نتائج مختلفة).
        # دلوقتي: loop واحد في core.analysis_runner.run_analysis_batch.
        # الـ caller بياخد الـ stocks (بفلتره الخاص) وبيمرّرها + persona + market.
        # الـ runner بيتولّد: history load + gate + analyze + persist + optional predictions.
        try:
            from core.analysis_runner import run_analysis_batch
            run = run_analysis_batch(
                stocks=stocks,
                persona=persona,
                market=market,
                limit=120,
                min_bars=10,
                generate_predictions=False,  # trigger-style: ممنوع السيميوليشن التاريخي في اللحظي
                log_prefix="trigger",
                stocks_db=_stocks_db,
                max_buy_recommendations=5,
            )
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'analysis_runner failed: {e}',
                'analyzed': 0,
            }), 200

        summary = run.to_summary()
        return jsonify({
            'success': True,
            'market': market,
            'persona': persona,
            'analyzed': summary['analyzed'],
            'buy_signals': summary['buy_signals'],
            'errors': summary['errors'],
            'total_stocks': summary['total_stocks'],
            'predictions_generated': summary['predictions_generated'],
            'persisted': summary['persisted'],
            'duration_seconds': summary['duration_seconds'],
            'insert_errors': summary['insert_errors'],
            'message': f'[{persona}] تم تحليل {summary["analyzed"]} سهم — {summary["buy_signals"]} إشارة شراء — {summary["predictions_generated"]} توقع في aiPrediction',
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'analyzed': 0,
        }), 200


@misc_bp.route('/api/admin/refresh-persona-flags', methods=['POST'])
def refresh_persona_flags():
    """أعد حساب persona flags لكل صف في stored_analyses — بدون إعادة Maestro كاملة.

    PROD-HOTFIX (P1): بعد أي deploy أو بعد ماtrigger-analysis يبقى شغّال، ممكن
    نحتاج نحدّث flags (is_gambler_opportunity, is_investor_opportunity, ranks)
    من غير ما نشغّل التحليل الفني من جديد. الـ endpoint ده بياخد كل صف في
    stored_analyses، يقرأ fundamentals من stocks.db، يعيد حساب flags عبر
    compute_persona_flags، ويعمل UPDATE.

    مفيد لما:
      - الـ live filter بيتغيّر (volume/turnover اتحدّث في stocks.db)
      - بعد deploy فيه تحديث لـ opportunity_quality thresholds
      - التحقّق من إن flags مش بصفر بعد إصلاح trigger-analysis

    Body (اختياري):
      market — فلتر بالسوق (افتراضي: الكل)
      limit — حد أقصى للصفوف (افتراضي: 2000)

    Returns:
      { success, total, updated, gambler_count, investor_count,
        both_count, skipped, errors }

    # SINGLE-WRITER (Task PHASE-3, Rule 73) — DISABLED. daily_predictor.py is the
    # canonical writer. This endpoint now returns a skip response without touching
    # stored_analyses. Set SKIP_STORED_ANALYSES_WRITE = False to re-enable.
    """
    # SINGLE-WRITER (Task PHASE-3, Rule 73)
    # Only daily_predictor.py is allowed to write to stored_analyses.
    # This writer is disabled to prevent conflicting decisions (last-writer-wins).
    SKIP_STORED_ANALYSES_WRITE = True
    if SKIP_STORED_ANALYSES_WRITE:
        try:
            _logger.info('[SINGLE-WRITER] Skipping refresh_persona_flags stored_analyses writes — use daily_predictor.py')
        except Exception:
            pass
        return jsonify({
            'success': True,
            'skipped': True,
            'updated': 0,
            'message': 'SINGLE-WRITER (PHASE-3 Rule 73) — disabled; daily_predictor.py is canonical',
        })

    try:
        data = request.get_json(silent=True) or {}
        market_filter = (data.get('market') or '').upper() or None
        limit = min(int(data.get('limit', 2000)), 5000)

        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _stocks_db = str(_root / 'db' / 'stocks.db')
        _predictions_db = str(_root / 'db' / 'predictions.db')

        # 1) تأكّد إن أعمدة persona موجودة
        try:
            from analyzers.background_analyzer import _ensure_stored_analyses_columns
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            with _open_db('predictions', _predictions_db, writable=True) as _conn_init:
                _ensure_stored_analyses_columns(_conn_init)
        except Exception as _e:
            print(f"[refresh-flags] ensure columns: {_e}")

        # 2) اقرأ كل صفوف stored_analyses + حدّثهم في نفس الـ connection
        # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
        with _open_db('predictions', _predictions_db, writable=True) as conn:
            if market_filter:
                rows = conn.execute("""
                    SELECT ticker, market, maestro_score, recommendation,
                           risk_reward, confidence, entry_price, volume_ratio
                    FROM stored_analyses
                    WHERE market = ?
                    ORDER BY maestro_score DESC NULLS LAST
                    LIMIT ?
                """, (market_filter, limit)).fetchall()
            else:
                rows = conn.execute("""
                    SELECT ticker, market, maestro_score, recommendation,
                           risk_reward, confidence, entry_price, volume_ratio
                    FROM stored_analyses
                    ORDER BY maestro_score DESC NULLS LAST
                    LIMIT ?
                """, (limit,)).fetchall()

            if not rows:
                return jsonify({
                    'success': True,
                    'total': 0,
                    'updated': 0,
                    'message': 'مفيش صفوف في stored_analyses',
                })

            # 3) حمّل fundamentals من stocks.db (cached)
            try:
                from analyzers.background_analyzer import (
                    _load_stocks_fundamentals_for_persona,
                    _compute_persona_opportunity_flags,
                )
            except Exception as _e:
                return jsonify({
                    'success': False,
                    'error': f'background_analyzer imports failed: {_e}',
                }), 200

            fund_map = _load_stocks_fundamentals_for_persona() or {}

            # 4) أعيد حساب flags لكل صف و UPDATE
            updated = 0
            skipped = 0
            errors = []
            gambler_count = 0
            investor_count = 0
            both_count = 0

            for r in rows:
                ticker = (r['ticker'] or '').upper()
                if not ticker:
                    skipped += 1
                    continue
                try:
                    rec = {
                        'ticker': ticker,
                        'recommendation': r['recommendation'] or 'hold',
                        'maestro_score': float(r['maestro_score'] or 0),
                        'risk_reward': float(r['risk_reward'] or 0),
                        'confidence': float(r['confidence'] or 0),
                    }
                    stored_vol_ratio = float(r['volume_ratio'] or 0)
                    flags = _compute_persona_opportunity_flags(
                        ticker, stored_vol_ratio, rec=rec,
                    )
                    conn.execute("""
                        UPDATE stored_analyses SET
                            is_gambler_opportunity = ?,
                            is_investor_opportunity = ?,
                            gambler_rank_score = ?,
                            investor_rank_score = ?,
                            pe_ratio = ?,
                            roe = ?,
                            change_1d = ?,
                            change_1m = ?,
                            volatility = ?,
                            fair_value_upside = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE ticker = ? AND (market = ? OR ? = '')
                    """, (
                        int(flags.get('is_gambler', 0)),
                        int(flags.get('is_investor', 0)),
                        float(flags.get('gambler_rank', 0.0) or 0),
                        float(flags.get('investor_rank', 0.0) or 0),
                        flags.get('pe_ratio'),
                        flags.get('roe'),
                        flags.get('change_1d'),
                        flags.get('change_1m'),
                        flags.get('volatility'),
                        flags.get('fair_value_upside'),
                        ticker,
                        r['market'] or '',
                        r['market'] or '',
                    ))
                    updated += 1
                    if flags.get('is_gambler'):
                        gambler_count += 1
                    if flags.get('is_investor'):
                        investor_count += 1
                    if flags.get('is_gambler') and flags.get('is_investor'):
                        both_count += 1
                except Exception as _e:
                    errors.append(f'{ticker}: {_e}')

            conn.commit()

            # 5) إحصائيات نهائية من DB (للتأكيد)
            try:
                stats = conn.execute("""
                    SELECT
                        SUM(is_gambler_opportunity) AS g,
                        SUM(is_investor_opportunity) AS i,
                        COUNT(*) AS total
                    FROM stored_analyses
                """).fetchone()
                db_gambler = int(stats['g'] or 0) if stats else 0
                db_investor = int(stats['i'] or 0) if stats else 0
                db_total = int(stats['total'] or 0) if stats else 0
            except Exception:
                db_gambler = gambler_count
                db_investor = investor_count
                db_total = len(rows)

        return jsonify({
            'success': True,
            'total': len(rows),
            'updated': updated,
            'skipped': skipped,
            'gambler_count': gambler_count,
            'investor_count': investor_count,
            'both_count': both_count,
            'db_gambler_total': db_gambler,
            'db_investor_total': db_investor,
            'db_stored_total': db_total,
            'errors': errors[:5],
            'market_filter': market_filter,
            'message': (
                f'تم تحديث {updated} صف — gambler={gambler_count}، '
                f'investor={investor_count} (DB total: g={db_gambler}, i={db_investor})'
            ),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 200


@misc_bp.route('/api/daily/rebuild-predictions', methods=['GET', 'POST'])
@misc_bp.route('/api/predictions/generate-all', methods=['GET', 'POST'])
def rebuild_predictions():
    """Rebuild predictions — للـ /api/prediction-performance في الـ frontend.

    GET: يرجّع إحصائيات التوقعات الحالية
    POST: يمسح القديم + يولّد توقعات جديدة (من زر "توليد التوقعات")

    الـ frontend بيتوقع schema محددة:
      {
        success: bool,
        performance: {
          total_predictions, active_predictions, closed_predictions,
          successful, stopped, expired,
          success_rate, avg_return, best_return, worst_return,
          high_confidence_rate, medium_confidence_rate, low_confidence_rate
        },
        activePredictions: [...],
        closedPredictions: [...],
        stats: { today, weekly, monthly, totalProfitLoss }
      }

    بنجيب البيانات من:
    - stored_analyses (التحليلات الحالية)
    - predictions (التوقعات المتقيّمة — لو موجودة)
    """
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')
        
        # Fix: Initialize counters at function scope (win_count scope bug)
        win_count = 0
        loss_count = 0
        pnl_sum = 0.0

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('predictions', _db) as conn:

            # إذا كان الطلب POST: نقوم بتشغيل محرك V40.2 الموحد أو الفحص اللحظي فوراً
            if request.method == 'POST':
                import subprocess, sys
                mode = request.args.get('type') or request.args.get('mode') or 'daily'
                python_bin = sys.executable or '/home/meme/my_apps/GLMinvestment/.venv/bin/python3'
                env = os.environ.copy()
                env['BYPASS_PRED_CAP'] = '1'
                env['V76_SECTOR_INTRADAY'] = '1'
                env['V40_EXPLOSIVE_UNCAP'] = '1'
                cmd = [python_bin, str(_root / 'vps-service' / 'jobs' / 'daily_predictor.py'), '--today-only', '--max-picks', '10']
                try:
                    subprocess.run(cmd, env=env, timeout=60)
                except Exception as _e:
                    logger.error(f"[rebuild-predictions] Error running daily generator: {_e}")
                if mode == 'intraday':
                    cmd_intra = [python_bin, str(_root / 'vps-service' / 'jobs' / 'intraday_scanner.py'), '--limit', '5']
                    try:
                        subprocess.run(cmd_intra, env=env, timeout=30)
                    except Exception as _e:
                        logger.error(f"[rebuild-predictions] Error running intraday scanner: {_e}")

            # 1. جلب آخر التوقعات النشطة من stored_analyses و predictions
            active_predictions = []
            try:
                # أولاً: توقعات V40.2 النشطة من جدول predictions
                pred_rows = conn.execute("""
                    SELECT ticker, signal, signal_type, entry_price, target_price,
                           stop_loss, confidence, maestro_score, created_at,
                           prediction_date, kill_filter_result
                    FROM predictions
                    WHERE status = 'PENDING'
                    ORDER BY id DESC
                    LIMIT 30
                """).fetchall()
                seen_tickers = set()
                for pr in pred_rows:
                    prd = dict(pr)
                    pticker = prd.get('ticker') or ''
                    if pticker and pticker not in seen_tickers:
                        pinfo = _get_stock_name(pticker)
                        active_predictions.append({
                            'ticker': pticker,
                            'symbol': pticker,
                            'name': pinfo['name'],
                            'name_ar': pinfo['name_ar'],
                            'sector': pinfo['sector'],
                            'logo_url': pinfo.get('logo_url', ''),
                            'signal': (prd.get('signal') or 'BUY').upper(),
                            'signal_type': (prd.get('signal_type') or 'BUY').upper(),
                            'entry_price': prd.get('entry_price') or 0,
                            'target_price': prd.get('target_price') or 0,
                            'stop_loss': prd.get('stop_loss') or 0,
                            'confidence': prd.get('confidence') or 80,
                            'maestro_score': prd.get('maestro_score') or 80,
                            'status': 'active',
                            'prediction_date': prd.get('prediction_date') or prd.get('created_at'),
                            'created_at': prd.get('created_at'),
                            'notes': prd.get('kill_filter_result') or 'V40.2 Unified Hunter'
                        })
                        seen_tickers.add(pticker)

                # ثانياً: استكمال من stored_analyses
                rows = conn.execute("""
                    SELECT ticker, recommendation, maestro_score, target_price,
                           stop_loss, entry_price, confidence, updated_at,
                           ai_decision, ai_confidence
                    FROM stored_analyses
                    ORDER BY updated_at DESC
                    LIMIT 100
                """).fetchall()
                for r in rows:
                    d = dict(r)
                    ticker = d.get('ticker') or ''
                    if ticker and ticker not in seen_tickers:
                        stock_info = _get_stock_name(ticker)
                        active_predictions.append({
                            'ticker': ticker,
                            'symbol': ticker,
                            'name': stock_info['name'],
                            'name_ar': stock_info['name_ar'],
                            'sector': stock_info['sector'],
                            'logo_url': stock_info.get('logo_url', ''),
                            'signal': (d.get('recommendation') or 'hold').upper(),
                            'signal_type': 'BUY' if 'buy' in (d.get('recommendation') or '').lower()
                                           else 'SELL' if 'sell' in (d.get('recommendation') or '').lower()
                                           else 'HOLD',
                            'entry_price': d.get('entry_price') or 0,
                            'target_price': d.get('target_price') or 0,
                            'stop_loss': d.get('stop_loss') or 0,
                            'confidence': d.get('confidence') or d.get('ai_confidence') or 50,
                            'maestro_score': d.get('maestro_score') or d.get('master_score') or 50,
                            'status': 'active',
                            'prediction_date': d.get('updated_at'),
                            'created_at': d.get('updated_at'),
                        })
                        seen_tickers.add(ticker)
            except Exception as e:
                logger.error(f"[rebuild-predictions] Error fetching active predictions: {e}")

            # 2. جلب التوقعات المغلقة + حساب الأداء الحقيقي
            closed_predictions = []
            total_predictions = len(active_predictions)
            successful = 0
            stopped = 0
            expired = 0
            returns = []

            try:
                # predictions table (لو موجودة) — فيها التوقعات المتقيّمة فعلاً
                # 🔥 P0-fix v2: schema-safe data_quality + HARD return cap (defense-in-depth).
                # الـ toxic rows (actual_return ≈ -10814%) بقت تـ exclude من win/loss COUNT
                # + averages عبر HARD cap |actual_return| <= 50 في WHERE نفسها. data_quality
                # clause اختياري (schema-aware) — لو العمود مش موجود الـ route ما بـ يكسرش.
                try:
                    _has_dq = 'data_quality' in {
                        r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()
                    }
                except Exception:
                    _has_dq = False
                _dq_sel = ", data_quality" if _has_dq else ""
                _dq_where = " AND (data_quality = 'clean' OR data_quality IS NULL)" if _has_dq else ""
                _cap_where = " AND (actual_return IS NULL OR ABS(actual_return) <= 50)"
                closed_rows = conn.execute(f"""
                    SELECT ticker, signal, signal_type, prediction_date,
                           entry_price, target_price, stop_loss, master_score,
                           outcome_date, exit_price, actual_return,
                           hit_target, hit_stop, is_correct, holding_days{_dq_sel}
                    FROM predictions
                    WHERE outcome_date IS NOT NULL{_dq_where}{_cap_where}
                    ORDER BY outcome_date DESC
                    LIMIT 100
                """).fetchall()
                for r in closed_rows:
                    d = dict(r)
                    ticker = d.get('ticker') or ''
                    stock_info = _get_stock_name(ticker)
                    ret = d.get('actual_return') or 0
                    returns.append(ret)
                    if d.get('hit_target') or (d.get('is_correct') and d.get('is_correct') > 0):
                        successful += 1
                        status = 'successful'
                    elif d.get('hit_stop'):
                        stopped += 1
                        status = 'stopped'
                    else:
                        expired += 1
                        status = 'expired'
                    closed_predictions.append({
                        'ticker': ticker,
                        'symbol': ticker,
                        'name': stock_info['name'],
                        'name_ar': stock_info['name_ar'],
                        'sector': stock_info['sector'],
                        'logo_url': stock_info.get('logo_url', ''),
                        'signal': d.get('signal') or 'HOLD',
                        'signal_type': d.get('signal_type') or 'BUY',
                        'entry_price': d.get('entry_price') or 0,
                        'target_price': d.get('target_price') or 0,
                        'stop_loss': d.get('stop_loss') or 0,
                        'exit_price': d.get('exit_price') or d.get('entry_price') or 0,
                        'actual_return': ret,
                        'status': status,
                        'prediction_date': d.get('prediction_date'),
                        'outcome_date': d.get('outcome_date'),
                        'holding_days': d.get('holding_days') or 0,
                    })
            except Exception:
                # الـ table مش موجودة — مفيش توقعات مغلقة
                pass

            closed_count = len(closed_predictions)
            total_predictions += closed_count

            # 3. حساب الـ performance object بالظبط زي ما الـ frontend بيتوقع
            success_rate = round((successful / closed_count * 100), 1) if closed_count > 0 else 0
            avg_return = round(sum(returns) / len(returns), 2) if returns else 0
            best_return = max(returns) if returns else 0
            worst_return = min(returns) if returns else 0

            # HEDGE-FUND-036: Hedge Fund-grade metrics
            # Profit Factor = gross_profit / gross_loss (إجمالي الأرباح / إجمالي الخسائر)
            # Avg R/R = متوسط الـ Risk/Reward لكل التوصيات المغلقة
            gross_profit = round(sum(r for r in returns if r > 0), 2)
            gross_loss = round(abs(sum(r for r in returns if r < 0)), 2)
            profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (float('inf') if gross_profit > 0 else 0)
            # profit_factor = inf لو مفيش خسائر (نعرضه كـ 99.9 في الـ JSON عشان الـ frontend يقدر يتعامل معاه)
            profit_factor_display = 99.9 if profit_factor == float('inf') else profit_factor
            losing_trades = sum(1 for r in returns if r < 0)
            winning_trades = sum(1 for r in returns if r > 0)
            # Avg R/R: من التوقعات المغلقة اللي فيها target + stop + entry
            rr_values = []
            for cp in closed_predictions:
                entry = cp.get('entry_price') or 0
                target = cp.get('target_price') or 0
                stop = cp.get('stop_loss') or 0
                if entry > 0 and target > entry and entry > stop:
                    risk = entry - stop
                    reward = target - entry
                    if risk > 0:
                        # Rule 54: استخدم canonical compute_risk_reward
                        try:
                            from utils.risk_reward import compute_risk_reward
                            rr_values.append(compute_risk_reward(entry, target, stop, fallback=reward / risk))
                        except Exception:
                            rr_values.append(reward / risk)
            avg_rr = round(sum(rr_values) / len(rr_values), 2) if rr_values else 0

            # confidence distribution (من active predictions)
            high_conf = sum(1 for p in active_predictions if (p.get('confidence') or 0) >= 75)
            med_conf = sum(1 for p in active_predictions if 50 <= (p.get('confidence') or 0) < 75)
            low_conf = sum(1 for p in active_predictions if (p.get('confidence') or 0) < 50)
            total_active = len(active_predictions) or 1
            high_confidence_rate = round(high_conf / total_active * 100, 1)
            medium_confidence_rate = round(med_conf / total_active * 100, 1)
            low_confidence_rate = round(low_conf / total_active * 100, 1)

            # 4. stats (today/weekly/monthly)
            try:
                today = conn.execute("""
                    SELECT COUNT(*) FROM stored_analyses
                    WHERE date(updated_at) = date('now')
                """).fetchone()[0]
            except Exception:
                today = 0
            try:
                weekly = conn.execute("""
                    SELECT COUNT(*) FROM stored_analyses
                    WHERE updated_at >= datetime('now', '-7 days')
                """).fetchone()[0]
            except Exception:
                weekly = 0
            try:
                monthly = conn.execute("""
                    SELECT COUNT(*) FROM stored_analyses
                    WHERE updated_at >= datetime('now', '-30 days')
                """).fetchone()[0]
            except Exception:
                monthly = 0

            total_pl = sum(returns)

            # TOP-TRADES-037: أفضل 5 صفقات الشهر (للـ Image Card الإعلانية)
            # نختار الصفقات المغلقة بناءً على أعلى actual_return (ROI)
            from datetime import datetime as _dt
            current_month = _dt.now().strftime('%Y-%m')
            top_monthly_trades = []
            try:
                for cp in closed_predictions:
                    # فلتر: الصفقات الرابحة فقط (actual_return > 0)
                    ret = cp.get('actual_return') or 0
                    if ret <= 0:
                        continue
                    # فلتر: الشهر الحالي فقط (بناءً على outcome_date أو prediction_date)
                    date_str = cp.get('outcome_date') or cp.get('prediction_date') or ''
                    if date_str and not date_str.startswith(current_month):
                        continue
                    top_monthly_trades.append({
                        'ticker': cp.get('ticker') or '',
                        'name_ar': cp.get('name_ar') or cp.get('name') or cp.get('ticker') or '',
                        'entry_price': round(float(cp.get('entry_price') or 0), 2),
                        'exit_price': round(float(cp.get('exit_price') or 0), 2),
                        'profit_pct': round(float(ret), 2),
                        'holding_days': int(cp.get('holding_days') or 0),
                        'signal': cp.get('signal') or 'BUY',
                        'outcome_date': cp.get('outcome_date') or '',
                    })
                # رتّب تنازلياً حسب profit_pct، وخد أعلى 5
                top_monthly_trades.sort(key=lambda x: x['profit_pct'], reverse=True)
                top_monthly_trades = top_monthly_trades[:5]
            except Exception as _tm_err:
                _logger.debug(f"top_monthly_trades build failed: {_tm_err}")
                top_monthly_trades = []


        return jsonify({
            'success': True,
            'performance': {
                'total_predictions': total_predictions,
                'active_predictions': len(active_predictions),
                'closed_predictions': closed_count,
                'successful': successful,
                'stopped': stopped,
                'expired': expired,
                'success_rate': success_rate,
                'avg_return': avg_return,
                'best_return': round(best_return, 2),
                'worst_return': round(worst_return, 2),
                'high_confidence_rate': high_confidence_rate,
                'medium_confidence_rate': medium_confidence_rate,
                'low_confidence_rate': low_confidence_rate,
                # HEDGE-FUND-036: Hedge Fund-grade metrics
                'total_trades': closed_count,
                'winning_trades': winning_trades,
                'losing_trades': losing_trades,
                'gross_profit': gross_profit,
                'gross_loss': gross_loss,
                'profit_factor': profit_factor_display,
                'avg_rr': avg_rr,
                'sample_size_small': closed_count < 10,
            },
            # TOP-TRADES-037: أفضل صفقات الشهر (للـ Image Card الإعلانية)
            'predictions_count': total_predictions or len(active_predictions) or today or 0,
            'top_monthly_trades': top_monthly_trades,
            'activePredictions': active_predictions,
            'closedPredictions': closed_predictions,
            'stats': {
                'today': today,
                'weekly': weekly,
                'monthly': monthly,
                'totalProfitLoss': f"{total_pl:+.2f}%",
            },
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'performance': {
                'total_predictions': 0,
                'active_predictions': 0,
                'closed_predictions': 0,
                'successful': 0,
                'stopped': 0,
                'expired': 0,
                'success_rate': 0,
                'avg_return': 0,
                'best_return': 0,
                'worst_return': 0,
                'high_confidence_rate': 0,
                'medium_confidence_rate': 0,
                'low_confidence_rate': 0,
                # HEDGE-FUND-036: Hedge Fund-grade metrics (zeros for fallback)
                'total_trades': 0,
                'winning_trades': 0,
                'losing_trades': 0,
                'gross_profit': 0,
                'gross_loss': 0,
                'profit_factor': 0,
                'avg_rr': 0,
                'sample_size_small': True,
            },
            'activePredictions': [],
            'closedPredictions': [],
            'top_monthly_trades': [],
            'stats': {'today': 0, 'weekly': 0, 'monthly': 0, 'totalProfitLoss': '0%'},
            'error': str(e),
        }), 200  # 200 مش 500 عشان الـ frontend ما يفصلش


    # ===== POST: إعادة بناء التوقعات =====
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        clear_existing = data.get('clearExisting', True)
        start_date = data.get('startDate', '2026-01-01')
        end_date = data.get('endDate', get_prediction_date_str())
        tickers_per_market = data.get('tickersPerMarket', 0)  # 0 = كل الأسهم
        sample_every = data.get('sampleEveryDays', 7)
        tech_params = data.get('technicalParams', {})
        holding_days = tech_params.get('holdingDays', 10)

        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _stocks_db = str(_root / 'db' / 'stocks.db')
        _pred_db = str(_root / 'db' / 'predictions.db')
        _price_db = str(_root / 'db' / 'price_history.db')

        # 1. مسح القديم لو طُلب
        # FIX (Aug 2026): لا نمسح stored_analyses ولا aiPrediction نهائياً.
        # السبب: لما السوق يقفل يوم الخميس وال rebuild يمسح الجداول،
        # الشاشة بتفضي تماماً يومي السبت والأحد والمستخدم مش بيلاقي توقعات.
        # الحل: التوقعات الجديدة بتعمل UPSERT (INSERT OR REPLACE) عن طريق
        # UNIQUE(ticker, market) فبتستبدل القديم تلقائياً. التوقعات القديمة
        # بتفضل ظاهرة لحد ما تتولد توقعات جديدة تحل محلها.
        # بنمسح جدول predictions بس (سجل الـ backtest التاريخي) لأنه بيتعمله
        # regenerate كامل في كل rebuild.
        deleted_count = 0
        if clear_existing:
            try:
                # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
                with _open_db('predictions', _pred_db, writable=True) as conn:
                    try:
                        conn.execute("DELETE FROM predictions WHERE 1=1")
                        deleted_count += conn.total_changes
                    except Exception:
                        pass
                    # لا تمسح stored_analyses — الـ UPSERT بيستبدل تلقائياً
                    # لا تمسح aiPrediction — بتفضل ظاهرة كأرشيف
                    conn.commit()
            except Exception:
                pass

        # 2. تشغيل RealBacktester (الـ backtest engine الموجود)
        # RealBacktester(db_path=stocks.db, history_db_path=price_history.db)
        # db_path = stocks.db (فيها جدول stocks بالـ tickers + current_price)
        # history_db_path = price_history.db (فيها تاريخ الأسعار)
        try:
            from analyzers.real_backtester import RealBacktester
            backtester = RealBacktester(_stocks_db, _price_db)

            # تشغيل multi-period backtest
            result = backtester.run_multi_period_backtest(
                start_date=start_date,
                end_date=end_date,
                interval_days=sample_every,
                holding_days=holding_days,
            )

            # حساب الإحصائيات
            total_preds = result.get('total_predictions', 0)
            total_correct = result.get('total_correct', 0)
            total_incorrect = result.get('total_incorrect', 0)
            win_rate = result.get('overall_win_rate', 0)
            avg_return = result.get('overall_avg_return', 0)

            return jsonify({
                'success': True,
                'stats': {
                    'total_predictions': total_preds,
                    'wins': total_correct,
                    'losses': total_incorrect,
                    'win_rate': win_rate,
                    'avg_return': avg_return,
                    'deleted_old': deleted_count,
                    'markets_covered': ['EGX'],
                    'real_win_rate': win_rate,
                    'periods_tested': result.get('periods_tested', 0),
                    'date_range': f'{start_date} → {end_date}',
                },
                'message': f'تم اختبار {total_preds} توقع — نسبة النجاح {win_rate}% — متوسط العائد {avg_return}%',
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Backtest engine error: {e}',
                'deleted_old': deleted_count,
            }), 200


@misc_bp.route('/api/predictions/league-report', methods=['GET'])
def league_report():
    """REPORTS-HUB-039: مركز تقارير التداول — الدوري حسب الفترة.

    GET /api/predictions/league-report?period=monthly
    period يمكن أن يكون: daily, weekly, monthly, quarterly, semi_annual, yearly.

    يحسب start_date و end_date بناءً على الفترة، ثم يجلب أفضل 10 صفقات مغلقة.

    Response:
      {
        "success": true,
        "period": "monthly",
        "period_name": "شهري",
        "start_date": "2026-07-01",
        "end_date": "2026-07-31",
        "period_label": "يوليو 2026",
        "league": [...],
        "count": 10
      }
    """
    try:
        from datetime import datetime as _dt, timedelta as _td
        from pathlib import Path as _Path
        import sqlite3 as _sqlite3

        period = request.args.get('period', 'monthly').strip().lower()
        now = _dt.now()

        # حساب start_date و end_date بناءً على الفترة
        if period == 'daily':
            # اليوم الحالي (من 00:00 لـ 23:59)
            start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = now.replace(hour=23, minute=59, second=59)
            period_name = 'يومي'
            # اسم اليوم بالعربي
            day_names = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
            period_label = f'{day_names[start_date.weekday()]} {start_date.strftime("%d %B %Y")}'

        elif period == 'weekly':
            # الأسبوع: من السبت للخميس (EGX trading week)
            # في مصر الأسبوع يبدأ من السبت. لو الجمعة → ناخد الأسبوع السابق.
            days_since_saturday = (now.weekday() - 5) % 7  # السبت=5 في Python
            if days_since_saturday == 0 and now.weekday() == 5:
                # يوم السبت بالظبط → ابدأ من اليوم
                start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                start_date = (now - _td(days=days_since_saturday)).replace(hour=0, minute=0, second=0, microsecond=0)
            # النهاية = الخميس (4 أيام بعد السبت) أو اليوم لو لسه ما وصلناش
            thursday = start_date + _td(days=5)  # الخميس
            end_date = min(thursday.replace(hour=23, minute=59, second=59), now)
            period_name = 'أسبوعي'
            period_label = f'{start_date.strftime("%d/%m")} - {end_date.strftime("%d/%m/%Y")}'

        elif period == 'monthly':
            # الشهر الحالي
            start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            # آخر يوم في الشهر
            if now.month == 12:
                end_date = now.replace(day=31, hour=23, minute=59, second=59)
            else:
                next_month = now.replace(month=now.month + 1, day=1) - _td(seconds=1)
                end_date = next_month
            period_name = 'شهري'
            ARABIC_MONTHS = [
                'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
            ]
            period_label = f'{ARABIC_MONTHS[now.month - 1]} {now.year}'

        elif period == 'quarterly':
            # الربع الحالي (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
            quarter = (now.month - 1) // 3  # 0, 1, 2, 3
            start_month = quarter * 3 + 1
            start_date = now.replace(month=start_month, day=1, hour=0, minute=0, second=0, microsecond=0)
            end_month = start_month + 2
            if end_month == 12:
                end_date = now.replace(month=12, day=31, hour=23, minute=59, second=59)
            else:
                end_date = now.replace(month=end_month + 1, day=1) - _td(seconds=1)
            period_name = 'ربع سنوي'
            period_label = f'Q{quarter + 1} {now.year}'

        elif period == 'semi_annual':
            # نص سنوي: النصف الأول (Jan-Jun) أو الثاني (Jul-Dec)
            if now.month <= 6:
                start_date = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
                end_date = now.replace(month=6, day=30, hour=23, minute=59, second=59)
                half = 1
            else:
                start_date = now.replace(month=7, day=1, hour=0, minute=0, second=0, microsecond=0)
                end_date = now.replace(month=12, day=31, hour=23, minute=59, second=59)
                half = 2
            period_name = 'نص سنوي'
            period_label = f'H{half} {now.year}'

        elif period == 'yearly':
            # السنة الحالية
            start_date = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            end_date = now.replace(month=12, day=31, hour=23, minute=59, second=59)
            period_name = 'سنوي'
            period_label = f'سنة {now.year}'

        else:
            # default: monthly
            period = 'monthly'
            start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            if now.month == 12:
                end_date = now.replace(day=31, hour=23, minute=59, second=59)
            else:
                end_date = now.replace(month=now.month + 1, day=1) - _td(seconds=1)
            period_name = 'شهري'
            period_label = f'{now.strftime("%B %Y")}'

        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')

        _root_path = _Path(__file__).resolve().parent.parent.parent
        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('predictions', str(_root_path / 'db' / 'predictions.db')) as conn:
            league = []

            try:
                # RULE22-DEDUP (2026-10-12 — LEAGUE-DEDUP-FIX):
                # السبب الجذري لتكرار نفس السهم (MMAT) مرتين في الـ top 10:
                # الـ predictions table بتحفظ 3 rows لكل سهم (3 personas: gambler/
                # balanced/conservative). بدون GROUP BY ticker، السهم بـ يظهر 3 مرات.
                #
                # الحل: GROUP BY ticker + MAX(actual_return) — يرجّع أحسن نتيجة لكل سهم.
                # Rule 22 (dedup-by-ticker): السهم الواحد = صفقة واحدة.
                # Rule 67 (CALCULATION-CANONICAL): المنطق في Python، مش Node.
                #
                # CTE logic:
                #   1. ranked = رتّب كل rows per ticker بـ actual_return DESC
                #   2. top_per_ticker = خد row واحد لكل ticker (rn = 1)
                #   3. رتّب الـ top_per_ticker بـ actual_return DESC واخد أعلى 10
                rows = conn.execute("""
                    WITH ranked AS (
                        SELECT ticker, signal, signal_type, prediction_date,
                               entry_price, target_price, stop_loss,
                               outcome_date, exit_price, actual_return,
                               hit_target, hit_stop, is_correct, holding_days,
                               ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY actual_return DESC) as rn
                        FROM predictions
                        WHERE outcome_date IS NOT NULL
                          AND date(outcome_date) >= date(?)
                          AND date(outcome_date) <= date(?)
                          AND actual_return IS NOT NULL
                    )
                    SELECT ticker, signal, signal_type, prediction_date,
                           entry_price, target_price, stop_loss,
                           outcome_date, exit_price, actual_return,
                           hit_target, hit_stop, is_correct, holding_days
                    FROM ranked
                    WHERE rn = 1
                    ORDER BY actual_return DESC
                    LIMIT 10
                """, (start_str, end_str)).fetchall()

                for i, r in enumerate(rows):
                    d = dict(r)
                    ticker = d.get('ticker') or ''
                    stock_info = _get_stock_name(ticker)
                    ret = d.get('actual_return') or 0
                    league.append({
                        'rank': i + 1,
                        'ticker': ticker,
                        'name_ar': stock_info.get('name_ar') or stock_info.get('name') or ticker,
                        'profit_pct': round(float(ret), 2),
                        'current_price': round(float(d.get('exit_price') or d.get('entry_price') or 0), 2),
                        'exit_price': round(float(d.get('exit_price') or 0), 2),
                        'entry_price': round(float(d.get('entry_price') or 0), 2),
                        'holding_days': int(d.get('holding_days') or 0),
                        'signal': d.get('signal') or 'BUY',
                        'outcome_date': d.get('outcome_date') or '',
                    })
            except Exception as _e:
                _logger.debug(f"league_report query failed: {_e}")
                league = []


        return jsonify({
            'success': True,
            'period': period,
            'period_name': period_name,
            'start_date': start_str,
            'end_date': end_str,
            'period_label': period_label,
            'league': league,
            'count': len(league),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'period': period if 'period' in dir() else '',
            'period_name': '',
            'start_date': '',
            'end_date': '',
            'period_label': '',
            'league': [],
            'count': 0,
        }), 200


@misc_bp.route('/api/predictions/monthly-league', methods=['GET'])
def monthly_league():
    """STOCK-LEAGUE-038: الدوري الممتاز للسوق — أفضل 10 أسهم/صفقات في الشهر.

    GET /api/predictions/monthly-league?month=YYYY-MM
    يرجّع أفضل 10 نتائج (بناءً على profit_pct) من التوقعات المغلقة في الشهر المحدد.
    لو month مش متمرر → يستخدم الشهر الحالي.

    Response:
      {
        "success": true,
        "month": "2026-07",
        "month_name": "يوليو",
        "league": [
          {
            "rank": 1,
            "ticker": "OFH",
            "name_ar": "أوراسكوم",
            "profit_pct": 18.5,
            "current_price": 12.5,
            "exit_price": 14.8,
            "holding_days": 5,
            "signal": "BUY"
          },
          ...
        ],
        "count": 10
      }
    """
    try:
        from datetime import datetime as _dt
        from pathlib import Path as _Path
        import sqlite3 as _sqlite3
        # تحديد الشهر (default: الشهر الحالي)
        month = request.args.get('month', '').strip()
        if not month:
            month = _dt.now().strftime('%Y-%m')
        _root_path = _Path(__file__).resolve().parent.parent.parent

        # استخراج اسم الشهر بالعربي
        ARABIC_MONTHS = [
            'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
            'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
        ]
        try:
            month_num = int(month.split('-')[1])
            month_name = ARABIC_MONTHS[month_num - 1] if 1 <= month_num <= 12 else month
        except (ValueError, IndexError):
            month_name = month

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('predictions', str(_root_path / 'db' / 'predictions.db')) as conn:
            league = []

            try:
                # اقرأ التوقعات المغلقة في الشهر المحدد
                rows = conn.execute("""
                    SELECT ticker, signal, signal_type, prediction_date,
                           entry_price, target_price, stop_loss,
                           outcome_date, exit_price, actual_return,
                           hit_target, hit_stop, is_correct, holding_days
                    FROM predictions
                    WHERE outcome_date IS NOT NULL
                      AND strftime('%Y-%m', outcome_date) = ?
                    ORDER BY actual_return DESC
                    LIMIT 10
                """, (month,)).fetchall()

                for i, r in enumerate(rows):
                    d = dict(r)
                    ticker = d.get('ticker') or ''
                    stock_info = _get_stock_name(ticker)
                    ret = d.get('actual_return') or 0
                    league.append({
                        'rank': i + 1,
                        'ticker': ticker,
                        'name_ar': stock_info.get('name_ar') or stock_info.get('name') or ticker,
                        'profit_pct': round(float(ret), 2),
                        'current_price': round(float(d.get('exit_price') or d.get('entry_price') or 0), 2),
                        'exit_price': round(float(d.get('exit_price') or 0), 2),
                        'entry_price': round(float(d.get('entry_price') or 0), 2),
                        'holding_days': int(d.get('holding_days') or 0),
                        'signal': d.get('signal') or 'BUY',
                        'outcome_date': d.get('outcome_date') or '',
                    })
            except Exception as _e:
                _logger.debug(f"monthly_league query failed: {_e}")
                league = []


        return jsonify({
            'success': True,
            'month': month,
            'month_name': month_name,
            'league': league,
            'count': len(league),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'month': month if 'month' in dir() else '',
            'league': [],
            'count': 0,
        }), 200


# ============================================================================
# CASCADING-FALLBACK-031: التدرج في القبول عشان الشاشة ماتفضيش أبداً
# ============================================================================
# المشكلة: بعد القوانين الصارمة (R/R>1.5, confidence>70), الأسهم القيادية
# الهادية (زي COMI, TAQA, CIRA) بتيجي بدرجة 55-60% → العقل بيرفضها →
# الشاشة بتفضي فاضية والعميل بيفقد الثقة في المنصة.
#
# الحل (Cascading Confidence Fallback):
#   Tier 1 (Strict):       score>=70, R/R>=1.5  — أعلى جودة
#   Tier 2 (Moderate):     score>=60, R/R>=1.3  — أسهم قيادية هادية
#   Tier 3 (Survival):     score>=50, R/R>=1.2  — الحد الأدنى المقبول
#   Tier 4 (Last-Resort):  أعلى المتبقين         — ضمان 5 عناصر (أقل ثقة)
#
# القاعدة الذهبية: حتى في الـ Fallback، فلاتر الـ "Blood Filter" (السيولة<3M)
# والـ "Penny Stock" (<1 جنيه) لازم تفضل شغالة. إحنا بنخفف درجة الثقة
# والـ R/R، بس إحنا مش بنفتح باب الأسهم الميتة تاني!
# ============================================================================

_CASCADE_PENNY_THRESHOLD = 1.0  # جنيه مصري — تحتها سهم بنسة

def _is_dead_stock(item):
    """Blood Filter + Penny Stock — دايماً شغالة حتى في أقل tier.
    بيرجع True لو السهم ميت (يتطفى نهائياً مهما كان الـ fallback)."""
    # Penny stock: السعر أقل من 1 جنيه مصري
    try:
        entry = float(item.get('entry_price') or item.get('current_price') or 0)
    except (TypeError, ValueError):
        entry = 0.0
    if 0 < entry < _CASCADE_PENNY_THRESHOLD:
        return True
    # Blood filter: إشارة رفض السيولة أو الاستبعاد (بتتخزن من master_analyzer)
    sig = str(item.get('signal') or '').upper()
    rec = str(item.get('recommendation') or '').lower()
    if any(k in sig for k in ('REJECTED', 'EXCLUDED', 'LIQUIDITY', 'DEAD')):
        return True
    if any(k in rec for k in ('reject', 'excluded', 'liquidity', 'dead')):
        return True
    return False


def _cascading_fallback_select(items, target=5):
    """التدرج في القبول: Strict → Moderate → Survival → Last-Resort.

    بيرجع لحد target عنصر. كل عنصر بيتعمله tag بـ _fallback_tier
    ('strict' | 'moderate' | 'survival' | 'last_resort') عشان الواجهة
    تقدر تعرض شارة الثقة المناسبة.

    الأسهم الميتة (penny / rejected_liquidity) بتتطفى في كل الـ tiers.
    """
    # 1) فلتر الأسهم الميتة دايماً (القاعدة الذهبية)
    alive = [it for it in items if not _is_dead_stock(it)]

    # 2) ترتيب بالـ master_score تنازلي (أحسن سهم الأول)
    def _score_of(it):
        try:
            return float(it.get('master_score') or it.get('score') or 0)
        except (TypeError, ValueError):
            return 0.0
    alive.sort(key=_score_of, reverse=True)

    selected = []
    seen_tickers = set()

    def _tier_pass(min_score, min_rr, tier_name):
        for it in alive:
            if len(selected) >= target:
                break
            tkr = (it.get('ticker') or '').upper()
            if tkr in seen_tickers:
                continue
            sc = _score_of(it)
            try:
                rr = float(it.get('risk_reward') or it.get('risk_reward_ratio') or 0)
            except (TypeError, ValueError):
                rr = 0.0
            if sc >= min_score and rr >= min_rr:
                it['_fallback_tier'] = tier_name
                selected.append(it)
                seen_tickers.add(tkr)

    # Tier 1: Strict (score>=70, R/R>=1.5)
    _tier_pass(70, 1.5, 'strict')
    # Tier 2: Moderate (score>=60, R/R>=1.3) — الأسهم القيادية الهادية
    if len(selected) < target:
        _tier_pass(60, 1.3, 'moderate')
    # Tier 3: Survival (score>=50, R/R>=1.2) — الحد الأدنى المقبول
    if len(selected) < target:
        _tier_pass(50, 1.2, 'survival')
    # Tier 4: Last-Resort fill — أعلى المتبقين (بس مش أسهم ميتة)
    # ده ضمان إن الشاشة متفضيش أبداً (حتى لو السوق هادي جداً)
    if len(selected) < target:
        for it in alive:
            if len(selected) >= target:
                break
            tkr = (it.get('ticker') or '').upper()
            if tkr in seen_tickers:
                continue
            it['_fallback_tier'] = 'last_resort'
            selected.append(it)
            seen_tickers.add(tkr)

    return selected[:target]


_CASCADE_TIER_LABELS_AR = {
    'strict':      '🏆 جودة عالية (ثقة صارمة)',
    'moderate':    '🥈 جودة متوسطة (زخم هادي)',
    'survival':    '🥉 الحد الأدنى (سوق هادي)',
    'last_resort': '⚠️ أعلى المتاح (ثقة منخفضة)',
}


@misc_bp.route('/api/unified/predictions', methods=['GET', 'POST'])
def unified_predictions():
    """Unified predictions — للـ MaestroDashboard.

    GET: يرجع آخر التوقعات (مع فلتر market)
    POST: يعمل rebuild سريع للـ predictions (trigger analysis)
    """
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')

        market = None
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            market = data.get('market')
        else:
            market = request.args.get('market')

        # Fix: Initialize at function scope before any try block
        win_count = 0
        loss_count = 0
        pnl_sum = 0.0

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect.
        # ملاحظة: مش بنستخدم `with` عشان الـ function طويلة جداً وفيها early returns.
        # الـ conn.close() اللي موجودة في الـ body بتشتغل على الاتنين (sqlite3.Connection
        # هو الـ type الموحّد على المسارين).
        _unified_ctx = None
        try:
            if _DBM_AVAILABLE:
                _unified_ctx = _dbm.connection('predictions')
                conn = _unified_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_db)
            conn.row_factory = sqlite3.Row
            _unified_ctx = None

        try:
            # فلترة حسب market لو موجود
            # ملاحظة: stored_analyses فيها entry_price (مش current_price)
            # فلازم نستخدم entry_price في الـ SELECT
            # Schema-Fix (يوليو 2026): ai_decision / ai_confidence مش موجودة كأعمدة
            # في stored_analyses — نجيبها من analysis_json لاحقاً.
            #
            req_limit = request.args.get('limit', 100, type=int) if request.method != 'POST' else 100
            limit = max(1, min(req_limit, 200))

            m_param = (market or 'ALL').upper().strip()
            m_where = ""
            m_args = []
            _pred_m_cond = ""
            if m_param not in ('ALL', ''):
                if m_param in ('EGX', 'EGYPT', 'مصر'):
                    m_where = "WHERE (market IN ('EGX', 'EGYPT', 'مصر') OR (market IS NULL AND ticker NOT GLOB '[0-9]*')) AND ticker NOT GLOB '[0-9]*'"
                    _pred_m_cond = "((market IN ('EGX', 'EGYPT', 'مصر') OR (market IS NULL AND ticker NOT GLOB '[0-9]*')) AND ticker NOT GLOB '[0-9]*')"
                elif m_param in ('TADAWUL', 'KSA', 'SAUDI', 'السعودية'):
                    m_where = "WHERE (market IN ('TADAWUL', 'KSA', 'SAUDI', 'السعودية') OR ticker GLOB '[0-9]*')"
                    _pred_m_cond = "(market IN ('TADAWUL', 'KSA', 'SAUDI', 'السعودية') OR ticker GLOB '[0-9]*')"
                elif m_param in ('KSE', 'KWT', 'KUWAIT', 'الكويت'):
                    m_where = "WHERE market IN ('KSE', 'KWT', 'KUWAIT', 'الكويت')"
                    _pred_m_cond = "market IN ('KSE', 'KWT', 'KUWAIT', 'الكويت')"
                elif m_param in ('QSE', 'QATAR', 'قطر'):
                    m_where = "WHERE market IN ('QSE', 'QATAR', 'قطر')"
                    _pred_m_cond = "market IN ('QSE', 'QATAR', 'قطر')"
                elif m_param in ('CRYPTO', 'BINANCE'):
                    m_where = "WHERE market IN ('CRYPTO', 'BINANCE')"
                    _pred_m_cond = "market IN ('CRYPTO', 'BINANCE')"
                elif m_param in ('US', 'USA', 'NASDAQ', 'NYSE'):
                    m_where = "WHERE market IN ('US', 'USA', 'NASDAQ', 'NYSE')"
                    _pred_m_cond = "market IN ('US', 'USA', 'NASDAQ', 'NYSE')"
                else:
                    m_where = "WHERE market = ?"
                    m_args.append(m_param)
                    _pred_m_cond = f"market = '{m_param}'"

            query_sql = f"""
                SELECT ticker, market, recommendation, maestro_score,
                       target_price, stop_loss, entry_price, confidence,
                       updated_at, analysis_json, risk_reward,
                       volume_ratio, liquidity_rating, regime
                FROM stored_analyses
                {m_where}
                ORDER BY updated_at DESC, confidence DESC
                LIMIT ?
            """
            m_args.append(limit)
            rows = conn.execute(query_sql, tuple(m_args)).fetchall()

            # FIX: Include historical active predictions from predictions table
            # stored_analyses only has the latest run (overwritten daily).
            # Historical active (PENDING) predictions from previous days
            # are also queried so the user sees predictions from all days,
            # not just today when "الكل" (all) is selected.
            #
            # FIX (Aug 2026): الـ predictions table مفيهاش عمود prediction_date
            # ولا master_score ولا outcome_date ولا exit_price. الأعمدة الصحيحة:
            #   created_at (بدل prediction_date)
            #   score (بدل master_score)
            #   closed_at (بدل outcome_date)
            # كان الـ query بـ error صامت (try/except) ويرجع قائمة فاضية،
            # فالشاشة كانت تفضل فاضية حتى لو فيه بيانات تاريخية.
            #
            # FIX (Aug 2026, post-migrator): حتى بعد إصلاح الـ migrator، أول
            # restart ممكن يلاقي الـ table بنسخة قديمة قبل ما الـ _ensure_columns
            # يخلص. عشان كده بنفحص الأعمدة الفعلية بالـ PRAGMA ونختار بس اللي
            # موجودين، وبنخلي كل عمود اختياري. ده بيمنع الـ "no such column:
            # score" crash وبيخلي الـ query دايماً يرجع نتيجة (حتى لو ناقصة)
            # بدل ما يرجع فاضي ويسيب الشاشة فاضية.
            _today_str_h = datetime.now().strftime("%Y-%m-%d")
            _hist_active = []
            try:
                # Discover which columns actually exist in the predictions table
                # — this makes the query resilient to schema drift on legacy DBs
                # that haven't been fully healed by the migrator yet.
                _pred_cols = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(predictions)").fetchall()
                }
                # Build the SELECT list from desired columns, keeping only the
                # ones that actually exist. Missing columns are simply omitted
                # (the downstream dict() will just lack those keys, which the
                # UI handles gracefully via .get()).
                _desired = [
                    "ticker", "signal", "signal_type",
                    "entry_price", "target_price", "stop_loss", "score",
                    "created_at", "actual_return",
                    "hit_target", "hit_stop", "holding_days",
                    "highest_price_reached", "lowest_price_reached",
                ]
                _select_cols = [c for c in _desired if c in _pred_cols]
                if not _select_cols:
                    # Table exists but has none of the columns we need — skip
                    # silently rather than crash.
                    _hist_rows = []
                else:
                    _select_sql = ", ".join(_select_cols)
                    # Build WHERE clause defensively — only filter on columns
                    # that exist, so we don't crash on legacy schemas.
                    _where_parts = ["created_at IS NOT NULL"]
                    _where_args = []
                    if _pred_m_cond:
                        _where_parts.append(_pred_m_cond)
                    if "created_at" in _pred_cols:
                        _where_parts.append("date(created_at) < date(?)")
                        _where_args.append(_today_str_h)
                    if "hit_target" in _pred_cols:
                        _where_parts.append("(hit_target != 1 OR hit_target IS NULL)")
                    if "hit_stop" in _pred_cols:
                        _where_parts.append("(hit_stop != 1 OR hit_stop IS NULL)")
                    _where_sql = " AND ".join(_where_parts)
                    _order_col = "created_at" if "created_at" in _pred_cols else "rowid"
                    _hist_rows = conn.execute(
                        f"SELECT {_select_sql} "
                        f"FROM predictions "
                        f"WHERE {_where_sql} "
                        f"ORDER BY {_order_col} DESC "
                        f"LIMIT 200",
                        tuple(_where_args)
                    ).fetchall()
                for _hr in _hist_rows:
                    _htkr = (_hr["ticker"] or "").upper().strip() if "ticker" in _hr.keys() else ""
                    # HOTFIX: sqlite3.Row has no .get() method — must use key indexing.
                    # Previously `r.get("ticker")` crashed with
                    # "'sqlite3.Row' object has no attribute 'get'" which emptied
                    # the historical predictions list and left the UI blank.
                    _existing_tickers = {
                        r["ticker"].upper().strip()
                        for r in rows
                        if "ticker" in r.keys() and r["ticker"]
                    }
                    if _htkr and _htkr not in _existing_tickers:
                        _hist_active.append(dict(_hr))
            except Exception as _hae:
                print(f"[Warning] historical active predictions query failed: {_hae}")
                _hist_active = []

            # ═══════════════════════════════════════════════════════════════
            # P6-PREDICTIONS: Helper لجلب أعلى/أقل سعر تاريخي منذ التوقع
            # ═══════════════════════════════════════════════════════════════
            # stored_analyses بتحط التحليل بس من غير tracking. عشان نعرف أعلى/أقل
            # سعر وصلهم السهم منذ التوقع، بنعمل lookup في جدول predictions
            # (نفس الـ DB) على أعمدة highest_price_reached / lowest_price_reached
            # اللي بيتم تعبئتها يومياً عن طريق daily_closer.
            # =================================================================
            def _fetch_historical_extremes(ticker, prediction_date):
                """Fetch historical max high / min low since prediction date from predictions.db."""
                try:
                    _tk = (ticker or '').upper().replace('.CA', '').replace('.SR', '').strip()
                    if not _tk:
                        return None, None
                    # prediction_date ممكن يكون datetime كامل أو تاريخ فقط
                    _date_str = ''
                    if prediction_date:
                        _date_str = str(prediction_date).split('T')[0].split(' ')[0]
                    if _date_str:
                        _row = conn.execute("""
                            SELECT highest_price_reached, lowest_price_reached
                            FROM predictions
                            WHERE UPPER(REPLACE(REPLACE(ticker, '.CA', ''), '.SR', '')) = ?
                              AND prediction_date IS NOT NULL
                              AND prediction_date != ''
                              AND date(substr(prediction_date, 1, 10)) <= date(?)
                            ORDER BY prediction_date DESC
                            LIMIT 1
                        """, (_tk, _date_str)).fetchone()
                    else:
                        _row = conn.execute("""
                            SELECT highest_price_reached, lowest_price_reached
                            FROM predictions
                            WHERE UPPER(REPLACE(REPLACE(ticker, '.CA', ''), '.SR', '')) = ?
                            ORDER BY prediction_date DESC
                            LIMIT 1
                        """, (_tk,)).fetchone()
                    if _row:
                        _mh = float(_row['highest_price_reached']) if _row['highest_price_reached'] else None
                        _ml = float(_row['lowest_price_reached']) if _row['lowest_price_reached'] else None
                        return _mh, _ml
                    return None, None
                except Exception as _he_err:
                    print(f"[Warning] _fetch_historical_extremes failed for {ticker}: {_he_err}")
                    return None, None

            # جلب أسعار الأسهم اللحظية وأعلى/أقل سعر من db/stocks.db و db/intraday.db
            stock_prices = {}
            stock_peaks = {}
            try:
                sdb = str(_root / 'db' / 'stocks.db')
                if os.path.exists(sdb):
                    # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
                    with _open_db('stocks', sdb) as sconn:
                        srows = sconn.execute("SELECT ticker, current_price, high_price, low_price, close FROM stocks").fetchall()
                        for sr in srows:
                            stk = (sr['ticker'] or '').upper().replace('.CA', '').replace('.SR', '').strip()
                            price = float(sr['current_price'] or sr['close'] or 0)
                            high_p = float(sr['high_price'] or price or 0)
                            low_p = float(sr['low_price'] or price or 0)
                            if price > 0:
                                stock_prices[stk] = price
                                stock_peaks[stk] = {'high': high_p, 'low': low_p}
            except Exception as se:
                print(f"[Warning] failed to load live prices in unified_predictions: {se}")

            # دمج أعلى/أقل سعر لحظي من db/intraday.db أثناء الجلسات
            try:
                idb = str(_root / 'db' / 'intraday.db')
                if os.path.exists(idb):
                    # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
                    with _open_db('intraday', idb) as iconn:
                        irows = iconn.execute("SELECT ticker, MAX(price) as max_p, MIN(price) as min_p, MAX(high) as max_h, MIN(low) as min_l FROM stock_intraday WHERE price > 0 GROUP BY ticker").fetchall()
                        for ir in irows:
                            stk = (ir['ticker'] or '').upper().replace('.CA', '').replace('.SR', '').strip()
                            mx = max(filter(None, [ir['max_p'], ir['max_h']]), default=0)
                            mn = min(filter(None, [ir['min_p'], ir['min_l']]), default=0)
                            if stk in stock_peaks:
                                stock_peaks[stk]['high'] = max(stock_peaks[stk]['high'], mx)
                                if mn > 0:
                                    stock_peaks[stk]['low'] = min(stock_peaks[stk]['low'], mn)
                            else:
                                stock_peaks[stk] = {'high': mx, 'low': mn}
            except Exception as ie:
                print(f"[Warning] failed to load intraday peaks in unified_predictions: {ie}")

            # PREDICTIONS-DB-ONLY (يوليو 2026 — إصلاح خطير):
            # تم إلغاء fallback لـ stocks.db.predictions نهائياً.
            # السبب: stocks.db.predictions كانت فيها بيانات قديمة (47 يوم)
            # و كانت بتظهر للمستخدم بدل ما يشتغل pipeline التوليد الطازج.
            # التوجيه: كل التوقعات من predictions.db فقط (stored_analyses).
            # لو فاضية → نرجّع نتيجة فاضية نظيفة (مش بيانات قديمة مضللة).
            # التوليد بيحصل عبر MarketScheduler كل دورة أو زر "توليد التوقعات".
            #
            # FIX (Aug 2026): لما stored_analyses تكون فاضية (زي أيام الإجازة
            # السبت/الأحد)، كنا بنرجّع predictions: [] فالشاشة كانت تفضي.
            # دلوقتي بنعمل fallback لجدول predictions (آخر 14 يوم) وبنحطه
            # في الـ predictions list الرئيسي عشان المستخدم يشوفه على الشاشة.
            # كمان اتصلحت أسماء الأعمدة (prediction_date → created_at,
            # master_score → score) لأن الـ query القديم كان بـ error صامت.
            if not rows or len(rows) == 0:
                _empty_prev = []
                _fallback_predictions = []
                try:
                    _today_str_e = datetime.now().strftime('%Y-%m-%d')
                    _ep_m_sql = f"AND {_pred_m_cond}" if _pred_m_cond else ""
                    _ep = conn.execute(f"""
                        SELECT ticker, signal, signal_type, created_at,
                               entry_price, target_price, stop_loss, score,
                               closed_at, actual_return,
                               hit_target, hit_stop, holding_days,
                               highest_price_reached, lowest_price_reached
                        FROM predictions
                        WHERE created_at IS NOT NULL
                          {_ep_m_sql}
                          AND date(created_at) >= date(?, '-14 days')
                        ORDER BY created_at DESC LIMIT 80
                    """, (_today_str_e,)).fetchall()
                    _seen_e = set()
                    for pr in _ep:
                        _tk = (pr['ticker'] or '').upper().strip()
                        if _tk in _seen_e:
                            continue
                        _seen_e.add(_tk)
                        _ht = int(pr['hit_target'] or 0); _hs = int(pr['hit_stop'] or 0)
                        if _ht == 1:
                            _st, _st_ar = 'TARGET_HIT', '✅ تم تحقيق الهدف'
                        elif _hs == 1:
                            _st, _st_ar = 'STOPPED', '❌ ضرب وقف'
                        else:
                            _st, _st_ar = 'PENDING', '⏳ لسه معلقة'
                        _si = _get_stock_name(pr['ticker'] or '')
                        _sr = (pr['signal'] or 'hold').lower()
                        if 'strong_buy' in _sr: _sg, _sg_ar = 'STRONG_BUY', 'شراء قوي'
                        elif 'buy' in _sr or 't1' in _sr or 'swing' in _sr: _sg, _sg_ar = 'BUY', 'شراء'
                        elif 'strong_sell' in _sr: _sg, _sg_ar = 'STRONG_SELL', 'بيع قوي'
                        elif 'sell' in _sr: _sg, _sg_ar = 'SELL', 'بيع'
                        elif 'accumulate' in _sr: _sg, _sg_ar = 'ACCUMULATE', 'تجميع'
                        else: _sg, _sg_ar = 'HOLD', 'انتظار'
                        # P6-PREDICTIONS: نقرأ أعلى/أقل سعر تاريخي بأمان
                        try:
                            _ep_max_h = float(pr['highest_price_reached']) if pr['highest_price_reached'] else None
                        except (KeyError, TypeError, ValueError):
                            _ep_max_h = None
                        try:
                            _ep_min_l = float(pr['lowest_price_reached']) if pr['lowest_price_reached'] else None
                        except (KeyError, TypeError, ValueError):
                            _ep_min_l = None
                        _entry = round(float(pr['entry_price'] or 0), 2)
                        _target = round(float(pr['target_price'] or 0), 2) if pr['target_price'] else None
                        _stop = round(float(pr['stop_loss'] or 0), 2) if pr['stop_loss'] else None
                        _score = float(pr['score'] or 0)
                        _entry_obj = {
                            'ticker': pr['ticker'], 'symbol': pr['ticker'],
                            'name': _si['name'], 'name_ar': _si['name_ar'],
                            'sector': _si.get('sector', ''),
                            'signal': _sg, 'signal_ar': _sg_ar,
                            'entry_price': _entry,
                            'target_price': _target,
                            'stop_loss': _stop,
                            'master_score': _score,
                            'confidence': _score if _score > 0 else 50,
                            'score': _score,
                            'prediction_date': pr['created_at'],
                            'created_at': pr['created_at'],
                            'outcome_date': pr['closed_at'],
                            'actual_return': round(float(pr['actual_return']), 2) if pr['actual_return'] is not None else None,
                            'holding_days': int(pr['holding_days'] or 0),
                            'status': _st, 'status_ar': _st_ar,
                            # P6-PREDICTIONS: القيم التاريخية المُتتبَعة
                            'max_high_since_pred': round(_ep_max_h, 2) if _ep_max_h else None,
                            'min_low_since_pred': round(_ep_min_l, 2) if _ep_min_l else None,
                            'highest_price_reached': round(_ep_max_h, 2) if _ep_max_h else None,
                            'lowest_price_reached': round(_ep_min_l, 2) if _ep_min_l else None,
                        }
                        _empty_prev.append(_entry_obj)
                        # FIX: أي توقع لسه معلق (مش hit_target ولا hit_stop)
                        # نحطه في الـ predictions list الرئيسي عشان يظهر على الشاشة.
                        if _ht != 1 and _hs != 1:
                            _fallback_predictions.append(_entry_obj)
                        if len(_empty_prev) >= 30:
                            break
                except Exception as _epe:
                    print(f"[Warning] empty-branch previous_predictions: {_epe}")
                conn.close()
                return jsonify({
                    'success': True,
                    # FIX: نرجّع الـ fallback predictions في القائمة الرئيسية
                    # عشان الـ frontend يعرضها لما stored_analyses تكون فاضية.
                    'predictions': _fallback_predictions,
                    'active_predictions': _fallback_predictions,
                    'previous_predictions': _empty_prev,
                    'closed_predictions': [],
                    'total': len(_fallback_predictions),
                    'closed_count': 0,
                    'open_count': len(_fallback_predictions),
                    'previous_count': len(_empty_prev),
                    'market': market or 'ALL',
                    'stats': {'total': len(_fallback_predictions), 'win_count': 0, 'loss_count': 0, 'win_rate': 0.0, 'avg_pnl': 0.0},
                    'source': 'predictions_fallback' if _fallback_predictions else 'predictions_db_empty',
                    'note': 'عرض آخر التوقعات المتاحة (stored_analyses فارغ — الأرشيف من جدول predictions)' if _fallback_predictions else 'لا توجد توقعات متاحة',
                    'timestamp': datetime.now().isoformat(),
                })

            rows = list(rows) + _hist_active
            predictions = []

            # ─── RULE-2 (إلزامي): حمّل الإغلاقات الرسمية من predictions ──────
            # عشان نعلن WIN/LOSS فقط من outcome_date المحفوظ (مش على الهواء
            # من peak/trough). ده بـ يطبّق القاعدة 2 على كل الـ endpoints.
            # المطابقة لاحقاً بـ ticker + entry_price (±2%) عشان نتجنّب إسناد
            # إغلاق قديم لتوصية جديدة.
            _closed_outcomes = {}
            try:
                _co_cols = {row[1] for row in conn.execute("PRAGMA table_info(predictions)").fetchall()}
                if 'outcome_date' in _co_cols:
                    _co_select = [c for c in ['ticker','entry_price','exit_type','actual_return','outcome_date'] if c in _co_cols]
                    _co_m_sql = f"AND {_pred_m_cond}" if _pred_m_cond else ""
                    _co_sql = (f"SELECT {', '.join(_co_select)} FROM predictions "
                               f"WHERE outcome_date IS NOT NULL {_co_m_sql} ORDER BY outcome_date DESC LIMIT 500")
                    for _cor in conn.execute(_co_sql).fetchall():
                        _ctk = (_cor['ticker'] or '').upper().replace('.CA','').replace('.SR','').strip()
                        if _ctk:
                            _closed_outcomes.setdefault(_ctk, []).append(dict(_cor))
            except Exception as _coe:
                print(f"[Warning] closed outcomes lookup failed: {_coe}")

            for r in rows:
                d = dict(r)
                ticker = d.get('ticker') or ''
                clean_t = ticker.upper().replace('.CA', '').replace('.SR', '').strip()
                stock_info = _get_stock_name(ticker)
                rec = (d.get('recommendation') or d.get('signal') or 'hold').lower()

                # Schema-Fix (يوليو 2026): استخراج ai_decision / ai_confidence /
                # current_price / risk_reward من analysis_json (مش موجودة كأعمدة).
                _aj = {}
                if d.get('analysis_json'):
                    try:
                        import json as _json
                        _aj = _json.loads(d['analysis_json']) or {}
                    except Exception:
                        _aj = {}
                _ai_decision = _aj.get('ai_decision')
                _ai_confidence = _aj.get('ai_confidence')
                _aj_current_price = _aj.get('current_price')
                _aj_risk_reward = _aj.get('risk_reward') or d.get('risk_reward')
                # P29-V20-TARGETS: استخرج target_price_2 (الـ 3.0R) من risk_profile
                # اللي بيطبعه الـ V20 Fusion engine. ده بيدل على الهدف الاستثماري الحقيقي.
                _aj_risk_profile = _aj.get('risk_profile') or {}
                _aj_target_price_2 = float(_aj_risk_profile.get('target_price_2') or _aj.get('target_price_2') or 0)

                if 'strong_buy' in rec:
                    signal = 'STRONG_BUY'
                    signal_ar = 'شراء قوي'
                elif 'buy' in rec or 't1' in rec or 'swing' in rec:
                    signal = 'BUY'
                    signal_ar = 'شراء'
                elif 'strong_sell' in rec:
                    signal = 'STRONG_SELL'
                    signal_ar = 'بيع قوي'
                elif 'sell' in rec:
                    signal = 'SELL'
                    signal_ar = 'بيع'
                elif 'accumulate' in rec:
                    signal = 'ACCUMULATE'
                    signal_ar = 'تجميع'
                else:
                    signal = 'HOLD'
                    signal_ar = 'انتظار'

                entry_price = float(d.get('entry_price') or 0)
                target_price = float(d.get('target_price') or 0)
                stop_loss = float(d.get('stop_loss') or 0)
                # السعر الحالي: نفضّل live من stocks.db، ثم analysis_json، ثم entry_price
                current_price = stock_prices.get(clean_t, _aj_current_price or entry_price)

                peaks = stock_peaks.get(clean_t, {})
                peak_high = max(current_price, peaks.get('high', current_price))
                trough_low = min(current_price, peaks.get('low', current_price)) if peaks.get('low') else current_price

                # اتجاه الإشارة: بيع أم شراء؟ (يحدد اتجاه الهدف والوقف)
                is_sell_signal = signal in ('SELL', 'STRONG_SELL')

                # ─── BACKEND-025: ضمان منطقية الأهداف حسب اتجاه الإشارة ──────────
                # الإصلاح ده في العقل (Backend) مش في الواجهة — عشان الداتا تفضل
                # صح حتى لو الواجهة غلطت. العقل هو مصدر الحقيقة.
                #   - شراء (BUY/STRONG_BUY/ACCUMULATE): الهدف فوق الدخول، الوقف تحت الدخول
                #   - بيع  (SELL/STRONG_SELL): الهدف تحت الدخول، الوقف فوق الدخول
                # ----------------------------------------------------------------
                if entry_price > 0:
                    if is_sell_signal:
                        # بيع: الهدف تحت سعر الدخول (-10%)، الوقف فوق سعر الدخول (+8%)
                        if target_price == 0 or target_price >= entry_price:
                            target_price = round(entry_price * 0.90, 2)
                        if stop_loss == 0 or stop_loss <= entry_price:
                            stop_loss = round(entry_price * 1.08, 2)
                    else:
                        # شراء: الهدف فوق سعر الدخول (+10%)، الوقف تحت سعر الدخول (-8%)
                        if target_price == 0 or target_price <= entry_price:
                            target_price = round(entry_price * 1.10, 2)
                        if stop_loss == 0 or stop_loss >= entry_price:
                            stop_loss = round(entry_price * 0.92, 2)

                if is_sell_signal:
                    # بيع: المكسب لما السعر ينزل → (entry - target) موجب
                    target_pct_gain = round(((entry_price - target_price) / entry_price) * 100.0, 2) if entry_price > 0 else 10.0
                    stop_pct_loss = round(((stop_loss - entry_price) / entry_price) * 100.0, 2) if entry_price > 0 else 8.0
                else:
                    # شراء: المكسب لما السعر يطلع → (target - entry) موجب
                    target_pct_gain = round(((target_price - entry_price) / entry_price) * 100.0, 2) if entry_price > 0 else 10.0
                    stop_pct_loss = round(((stop_loss - entry_price) / entry_price) * 100.0, 2) if entry_price > 0 else -8.0

                # ─── REALITY-CHECK-023: إصلاح كذبة الـ 100% نجاح ─────────────
                # ---------------------------------------------------------------------
                # الكذبة القديمة كانت:
                #   if (peak_high >= target_price OR current_price >= entry_price):
                #       status = TARGET_HIT, pnl = target_pct_gain
                # يعني لو السهم طلع 1% بس فوق سعر الدخول → الكود بقول "TARGET_HIT"
                # وبيحسب الربح = 10% (الهدف الكامل)! دي كذب رياضي.
                #
                # الحقيقة الجديدة:
                # 1. TARGET_HIT: فقط لو الـ peak_high وصل أو عدى الـ target_price
                #    والربح = (current_price - entry_price) / entry_price * 100 (الفعلي)
                # 2. STOPPED: فقط لو الـ trough_low كسر الـ stop_loss
                #    والخسارة = (current_price - entry_price) / entry_price * 100 (الفعلي)
                # 3. PENDING (جاري التنفيذ): لو مفيش لا target ولا stop اتلمس
                #    والـ pnl = الربح/الخسارة الفعلية الحالية (ممكن تكون سالبة)
                # 4. EXPIRED: لو عدد الأيام عدى الـ max_holding (بيتعمل في daily_closer)
                # ---------------------------------------------------------------------
                # ─── RULE-2 (إلزامي): WIN/LOSS نهائي فقط من outcome_date ──────
                # ممنوع إعلان TARGET_HIT/STOPPED على الهواء من peak/trough.
                # الـ status النهائي يأتي فقط من الإغلاق الرسمي (daily_closer
                # بـ يكتب outcome_date + exit_type + actual_return). لو مفيش
                # إغلاق → PENDING مع live pnl للعرض فقط (preview).
                # ----------------------------------------------------------------
                status = 'PENDING'
                hit_target = False
                hit_stop = False
                # live pnl للعرض فقط (مش إعلان WIN/LOSS)
                if is_sell_signal and entry_price > 0:
                    _live_pnl = round(((entry_price - current_price) / entry_price) * 100.0, 2)
                else:
                    _live_pnl = round(((current_price - entry_price) / entry_price) * 100.0, 2) if entry_price > 0 else 0.0

                # ابحث عن إغلاق رسمي يطابق السهم + سعر الدخول (±2%)
                _matched_closed = None
                for _co in (_closed_outcomes.get(clean_t) or []):
                    _co_entry = float(_co.get('entry_price') or 0)
                    if _co_entry > 0 and entry_price > 0 and abs(_co_entry - entry_price) / entry_price <= 0.02:
                        _matched_closed = _co
                        break

                if _matched_closed:
                    _et = (_matched_closed.get('exit_type') or '').strip().lower()
                    _saved_ret = round(float(_matched_closed.get('actual_return') or 0), 2)
                    if _et == 'target_hit':
                        status = 'TARGET_HIT'
                        hit_target = True
                        win_count += 1
                        pnl = _saved_ret
                    elif _et == 'stop_loss':
                        status = 'STOPPED'
                        hit_stop = True
                        loss_count += 1
                        pnl = _saved_ret
                    elif _et == 'expired':
                        status = 'EXPIRED'
                        pnl = _saved_ret
                    else:
                        status = 'PENDING'
                        pnl = _live_pnl
                else:
                    # لا يوجد إغلاق رسمي → PENDING فقط (ممنوع WIN/LOSS على الهواء)
                    status = 'PENDING'
                    pnl = _live_pnl

                pnl_sum += pnl

                # ═══════════════════════════════════════════════════════════════════
                # AGILE-PHASE3-036: Dynamic Live Prices — Override التوصية لتصبح "Live"
                # ═══════════════════════════════════════════════════════════════════
                # العميل بيشوف سعر الدخول ثابت ومش بيتحدث مع السعر الحالي. لازم
                # نعمل Override لـ entry_price ونحط مكانها current_price (السعر
                # اللحظي من محرك البيانات)، ونعيد حساب target/stop بنفس النسب
                # المئوية الأصلية. كده التوصية بتبقى "Live" دايماً على السعر الحالي.
                #
                # مثال: BUY Entry=100, Target=110 (+10%), Stop=95 (-5%)
                #       والسعر اللحظي 102 → Entry=102, Target=112.2, Stop=96.9
                #
                # ملاحظة: كشف الإصابة (TARGET_HIT/STOPPED) اتعمل فوق بالأسعار الأصلية
                # علشان نتابع رحلة التوصية الأصلية صح. الـ Override هنا بيأثر على
                # القيم المعروضة للعميل بس (entry/target/support/target_price_2).
                # ----------------------------------------------------------------
                original_entry_price = float(entry_price)
                entry_price = round(original_entry_price, 2) if original_entry_price > 0 else round(current_price, 2)
                is_live_rebased = False

                pred_date = d.get('prediction_date') or d.get('updated_at') or datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                # ─── Schema-Fix (يوليو 2026) ─────────────────────────────
                # SimpleRecommendationsView بيقرأ: risk_reward, technical_score, rsi,
                # support_level, target_price_2, investment_target, risk_reward_ratio,
                # change_percent. لو ناقصين → بيبقى فيه أعمدة فاضية في الـ UI.
                # ===========================================================

                # ─── BACKEND-025: R/R ratio + الأهداف حسب اتجاه الإشارة ─────────
                # Schema-Fix: نفضّل risk_reward المخزّن في stored_analyses أو analysis_json.
                # لو مش موجود، نحسبه صح حسب الاتجاه:
                #   شراء: reward = target - entry ، risk = entry - stop
                #   بيع:  reward = entry - target ، risk = stop - entry
                # ----------------------------------------------------------------
                if is_sell_signal:
                    _risk_amt = (stop_loss - entry_price) if (entry_price > 0 and stop_loss > 0 and stop_loss > entry_price) else 0
                    _reward_amt = (entry_price - target_price) if (entry_price > 0 and target_price > 0 and entry_price > target_price) else 0
                else:
                    _risk_amt = (entry_price - stop_loss) if (entry_price > 0 and stop_loss > 0 and entry_price > stop_loss) else 0
                    _reward_amt = (target_price - entry_price) if (entry_price > 0 and target_price > 0 and target_price > entry_price) else 0
                _calc_rr = round(_reward_amt / _risk_amt, 2) if (_risk_amt > 0 and _reward_amt > 0) else 2.0
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    _calc_rr = compute_risk_reward(entry_price, target_price, stop_loss, fallback=_calc_rr)
                except Exception:
                    pass  # keep inline _calc_rr computed above
                # الأولوية: المخزّن > المحسوب
                try:
                    _stored_rr = float(_aj_risk_reward or 0)
                except (TypeError, ValueError):
                    _stored_rr = 0.0
                risk_reward_v = _stored_rr if _stored_rr > 0 else _calc_rr

                # P29-V20-TARGETS: target_price_2 + investment_target من الـ V20 Fusion engine
                # قبل كده كنا بنحسبها بنسب ثابتة (+10%/+15%) — ده كان بيتجاهل الـ 3.0R
                # اللي بيطبعه المحرك الجديد. دلوقتي بنفضّل قيمة الـ V20، وبنستخدم
                # النسب الثابتة كـ fallback أخير بس لو الـ V20 ما طبعتش قيمة.
                if is_sell_signal:
                    # بيع: الأهداف تحت سعر الدخول، الدعم (المقاومة) فوق
                    target_price_2_v = round(_aj_target_price_2, 2) if _aj_target_price_2 > 0 else (round(entry_price * 0.90, 2) if entry_price > 0 else 0)
                    investment_target_v = round(_aj_target_price_2, 2) if _aj_target_price_2 > 0 else (round(entry_price * 0.85, 2) if entry_price > 0 else 0)
                    support_level_v = stop_loss if stop_loss > 0 else (round(entry_price * 1.03, 2) if entry_price > 0 else 0)
                else:
                    # شراء: الأهداف فوق سعر الدخول، الدعم تحت
                    target_price_2_v = round(_aj_target_price_2, 2) if _aj_target_price_2 > 0 else (round(entry_price * 1.10, 2) if entry_price > 0 else 0)
                    investment_target_v = round(_aj_target_price_2, 2) if _aj_target_price_2 > 0 else (round(entry_price * 1.15, 2) if entry_price > 0 else 0)
                    support_level_v = stop_loss if stop_loss > 0 else (round(entry_price * 0.97, 2) if entry_price > 0 else 0)

                # technical_score + rsi (محاولة جلب من stocks.db)
                technical_score_v = float(d.get('maestro_score') or d.get('master_score') or _aj.get('score') or 50)
                rsi_v = 50  # default
                try:
                    _sdb = str(_root / 'db' / 'stocks.db')
                    if os.path.exists(_sdb):
                        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                        try:
                            if _DBM_AVAILABLE:
                                _sr_row = _dbm.query_one(
                                    'stocks',
                                    'SELECT rsi FROM stocks WHERE ticker = ? LIMIT 1',
                                    (ticker,),
                                )
                                if _sr_row and _sr_row.get('rsi'):
                                    rsi_v = float(_sr_row['rsi'])
                            else:
                                raise RuntimeError("db_manager unavailable")
                        except Exception:
                            _sc = sqlite3.connect(_sdb)
                            _sc.row_factory = sqlite3.Row
                            _sr = _sc.execute('SELECT rsi FROM stocks WHERE ticker = ? LIMIT 1', (ticker,)).fetchone()
                            if _sr and _sr['rsi']:
                                rsi_v = float(_sr['rsi'])
                            _sc.close()
                except Exception:
                    pass

                # change_percent: من current_price vs original_entry_price
                # (AGILE-PHASE3-036): نستخدم سعر الدخول الأصلي علشان العميل يشوف
                # إزاي السهم تحرك من لحظة التوصية الأصلية — مش من السعر اللحظي المعاد حسابه.
                change_pct_v = round(((current_price - original_entry_price) / original_entry_price) * 100.0, 2) if original_entry_price > 0 else 0

                # P6-PREDICTIONS: نجيب أعلى/أقل سعر تاريخي منذ التوقع من جدول predictions
                # دول القيم اللي بيتم تتبعها يومياً (highest_price_reached / lowest_price_reached).
                # الـ frontend بياخدهم كـ PRIMARY source لتحديد حالة التوقع (TARGET_HIT/STOPPED).
                _hist_max_high, _hist_min_low = _fetch_historical_extremes(ticker, pred_date)

                predictions.append({
                    'ticker': ticker,
                    'symbol': ticker,
                    'name': stock_info['name'],
                    'name_ar': stock_info['name_ar'],
                    'sector': stock_info['sector'],
                    'logo_url': stock_info.get('logo_url', ''),
                    'score': d.get('maestro_score') or d.get('master_score') or 50,
                    'master_score': d.get('maestro_score') or d.get('master_score') or 50,  # alias
                    'maestro_score': d.get('maestro_score') or 50,
                    'technical_score': technical_score_v,
                    'signal': signal,
                    'signal_ar': signal_ar,
                    'recommendation': rec,
                    'entry_price': entry_price,
                    'is_live_rebased': is_live_rebased,
                    'original_entry_price': round(original_entry_price, 2) if original_entry_price > 0 else entry_price,
                    'current_price': current_price,
                    'high_price': round(peak_high, 2) if peak_high else current_price,
                    'low_price': round(trough_low, 2) if trough_low else current_price,
                    'target_price': target_price,
                    'target_price_2': target_price_2_v,
                    'investment_target': investment_target_v,
                    'support_level': support_level_v,
                    'stop_loss': stop_loss,
                    'risk_reward': risk_reward_v,
                    'risk_reward_ratio': risk_reward_v,  # alias
                    'change_percent': change_pct_v,
                    'profit_loss_percent': round(pnl, 2),
                    'status': status,
                    'status_ar': {
                        'TARGET_HIT': '✅ وصل للهدف',
                        'STOPPED': '❌ ضرب وقف الخسارة',
                        'PENDING': '⏳ جاري التنفيذ',
                        'EXPIRED': '⌛ انتهت المدة',
                    }.get(status, status),
                    'hit_target': hit_target,
                    'hit_stop_loss': hit_stop,
                    'peak_high': round(peak_high, 2) if peak_high else None,
                    'trough_low': round(trough_low, 2) if trough_low else None,
                    # P6-PREDICTIONS: القيم التاريخية المُتتبَعة (الأولوية في الواجهة)
                    'max_high_since_pred': round(_hist_max_high, 2) if _hist_max_high else (round(peak_high, 2) if peak_high else current_price),
                    'min_low_since_pred': round(_hist_min_low, 2) if _hist_min_low else (round(trough_low, 2) if trough_low else current_price),
                    'highest_price_reached': round(_hist_max_high, 2) if _hist_max_high else (round(peak_high, 2) if peak_high else current_price),
                    'lowest_price_reached': round(_hist_min_low, 2) if _hist_min_low else (round(trough_low, 2) if trough_low else current_price),
                    'confidence': d.get('confidence') or _ai_confidence or 50,
                    'rsi': rsi_v,
                    'regime': d.get('regime') or 'range',
                    'prediction_date': pred_date,
                    'created_at': pred_date,
                    'updated_at': d.get('updated_at'),
                    'ai_decision': _ai_decision,
                    'ai_confidence': _ai_confidence,
                })
        except Exception as e:
            print(f"[Error] unified_predictions exception: {e}")
            predictions = []

        # ─── PERSONA-CURATION-029: الخمس بتوع المستثمر والخمس بتوع المضارب لكل يوم ───
        # اختيار دقيق لأعلى 5 توقعات للمستثمر وأعلى 5 توقعات للمضارب (خلط بين الشراء والبيع)
        # ----------------------------------------------------------------------------
        def _pick_persona_top5(items_list, persona_key):
            actionable = ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'SWING_BUY', 'T1_BUY', 'STRONG_SELL', 'SELL', 'REDUCE', 'HOLD']
            valid = []
            for item in items_list:
                aj = item.get('analysis_json') or {}
                p_data = aj.get(persona_key) or {}
                score = float(p_data.get('score') if p_data.get('score') is not None else item.get('score') or 50)
                sig = str(p_data.get('signal') or item.get('signal') or 'HOLD').upper()
                valid.append({
                    'item': item,
                    'score': score,
                    'signal': sig,
                })
            valid.sort(key=lambda x: x['score'], reverse=True)

            buys = [x for x in valid if x['signal'] in ('BUY', 'STRONG_BUY', 'ACCUMULATE')]
            sells = [x for x in valid if x['signal'] in ('SELL', 'STRONG_SELL', 'REDUCE')]

            buy_count = min(3, len(buys))
            sell_count = min(2, len(sells))
            chosen = [x['item'] for x in buys[:buy_count]] + [x['item'] for x in sells[:sell_count]]

            # تكملة إلى 5 عناصر لو مفيش شراء/بيع كفاية
            for v in valid:
                if len(chosen) >= 5:
                    break
                if v['item'] not in chosen:
                    chosen.append(v['item'])

            return chosen[:5]

        investor_top5 = _pick_persona_top5(predictions, 'investor')
        trader_top5 = _pick_persona_top5(predictions, 'gambler')

        # دمج التوقعات المنقاة (5 مستثمر + 5 مضارب بدون تكرار)
        curated_dict = {}
        for item in investor_top5 + trader_top5:
            tkr = item.get('ticker')
            if tkr and tkr not in curated_dict:
                curated_dict[tkr] = item

        # ─── CASCADING-FALLBACK-031: التدرج في القبول عشان الشاشة ماتفضيش ───
        # القائمة الرئيسية (predictions) بتيجي من Cascading Fallback:
        #   Strict (>=70/1.5) → Moderate (>=60/1.3) → Survival (>=50/1.2)
        #   → Last-Resort fill (ضمان 5 عناصر دايماً).
        # فلاتر Blood Filter + Penny Stock شغالة في كل الـ tiers (القاعدة
        # الذهبية: بنخفف الثقة والـ R/R، بس مانفتحش باب الأسهم الميتة).
        # persona lists (investor/trader) لسه متاحة للتويبات الفرعية.
        # ==================================================================
        open_predictions = _cascading_fallback_select(predictions, target=5)
        # إضافة fallback_tier + fallback_tier_ar لكل توقع في القائمة الرئيسية
        for p in open_predictions:
            _tier = p.pop('_fallback_tier', 'strict')
            p['fallback_tier'] = _tier
            p['fallback_tier_ar'] = _CASCADE_TIER_LABELS_AR.get(_tier, _tier)

        closed_predictions = [p for p in predictions if p.get('status') in ('TARGET_HIT', 'STOPPED', 'EXPIRED')][:5]

        # ═══════════════════════════════════════════════════════════════════
        # ROBO-ADVISOR-P1: أرشيف التوقعات السابقة + وسم الجديد/المستمر
        # ═══════════════════════════════════════════════════════════════════
        # لما العقل يطلع 5 توصيات جديدة، القديمة متتمسحش! بنرجّع قائمة
        # previous_predictions من جدول predictions التاريخي (آخر 14 يوم،
        # باستثناء التيكرات النشطة دلوقتي) مع حالتها:
        #   ✅ تم تحقيق الهدف (hit_target=1)
        #   ❌ ضرب وقف (hit_stop=1)
        #   ⏳ لسه معلقة (الباقي)
        # كمان بنوسّم كل توقع نشط: is_new (🆕) لو مفيش توقع قديم لنفس
        # التيكر، is_continuous (🔄) لو فيه توقع سابق.
        # =================================================================
        # RL-FIX-9 (BUG #3): وسّعنا الـ window من 14 يوم لـ 220 يوم (يغطي
        # 1/1/2026 للآن) ورفعنا LIMIT من 80 لـ 500 + شيلنا الـ per-ticker
        # dedup (اللي كان بيخفي كل الأيام ما عدا أحدث واحد لكل سهم) وبدلناه
        # بـ per-(ticker,date) dedup. ده علشان المستخدم يشوف توقعات من كل
        # الأيام، مش بس يوم 08-10. كمان أضفنا فلتر persona اختياري.
        # RL-FIX-9 (BUG #1+2): أضفنا حالة TRAILING_PROFIT (خرج بربح قبل الهدف)
        # و أصلحنا حساب _actual_ret للـ PENDING rows (ما عادش يحسب من exit_price).
        # =================================================================
        previous_predictions = []
        active_tickers = set((p.get('ticker') or '').upper().strip() for p in open_predictions)
        _today_str = datetime.now().strftime('%Y-%m-%d')

        # RL-FIX-9: اقرأ persona من query params (لو الـ caller عايز يفلتر)
        _persona_filter = (request.args.get('persona') or request.args.get('persona_filter') or '').strip().lower() if request else ''
        _persona_clause = ""
        _persona_params = ()
        if _persona_filter in ('gambler', 'balanced', 'conservative', 'investor'):
            # 'investor' في الـ frontend بـ يقابل 'conservative' في الـ DB
            _db_persona = 'conservative' if _persona_filter == 'investor' else _persona_filter
            _persona_clause = " AND persona = ? "
            _persona_params = (_db_persona,)

        try:
            # ملاحظة: جدول predictions مفيهوش عمود confidence (الـ Prisma schema
            # غير متزامن مع الـ DB الفعلي). بنستخدم master_score كـ proxy ونحط
            # confidence افتراضي 50.
            # RL-FIX-9: أضفنا exit_type + persona في الـ SELECT علشان الـ status mapping الجديد.
            _prev_m_sql = f"AND {_pred_m_cond}" if _pred_m_cond else ""
            _prev_rows = conn.execute(f"""
                SELECT ticker, signal, signal_type, prediction_date, persona,
                       entry_price, target_price, stop_loss, master_score,
                       outcome_date, exit_price, actual_return, exit_type,
                       hit_target, hit_stop, holding_days,
                       highest_price_reached, lowest_price_reached
                FROM predictions
                WHERE prediction_date IS NOT NULL
                  AND prediction_date != ''
                  AND date(prediction_date) >= date(?, '-220 days')
                  {_persona_clause}
                  {_prev_m_sql}
                ORDER BY prediction_date DESC
                LIMIT 500
            """, (_today_str, *_persona_params)).fetchall()

            # RL-FIX-9: per-(ticker,date) dedup بدل per-ticker — علشان نحافظ
            # على تنوع التواريخ (أحدث توقع لكل سهم في كل يوم).
            _seen_ticker_date = set()
            for pr in _prev_rows:
                _ptkr = (pr['ticker'] or '').upper().strip()
                _pdate = (pr['prediction_date'] or '')[:10]
                _td_key = (_ptkr, _pdate)
                # استثني التيكرات النشطة دلوقتي (مش نكررها في الأرشيف)
                # بس بس لو التوقع بتاريخ اليوم — لو قديم، اعرضه.
                if _ptkr in active_tickers and _pdate == _today_str:
                    continue
                # تجنب التكرار: أول توقع لكل (ticker, date) بس
                if _td_key in _seen_ticker_date:
                    continue
                _seen_ticker_date.add(_td_key)

                _ht = int(pr['hit_target'] or 0)
                _hs = int(pr['hit_stop'] or 0)
                _exit_type = (pr['exit_type'] or '').strip().lower() if pr['exit_type'] else ''
                _is_closed = pr['outcome_date'] is not None

                # RL-FIX-9 (BUG #1): status mapping جديد بـ exit_type + outcome_date
                # علشان نميّز بين:
                #   - TARGET_HIT: الهدف الكامل اتحقق
                #   - TRAILING_PROFIT: خرج بربح جزئي قبل الهدف (جني أرباح)
                #   - STOPPED: ضرب وقف فعلي (خسارة)
                #   - EXPIRED: انتهى الوقت
                #   - PENDING: لسه مفتوحة
                # كمان بنـ catch الحالات القديمة المتناقضة (hit_stop=1 + actual_return>0)
                # علشان الـ UI يعرضها صح حتى لو الـ migration script ما اشتغلش على الـ VPS بعد.
                _actual_ret_check = float(pr['actual_return'] or 0)
                if _is_closed and _exit_type == 'trailing_profit':
                    _pstatus = 'TRAILING_PROFIT'
                    _pstatus_ar = '💰 خرج بربح'
                elif _ht == 1:
                    _pstatus = 'TARGET_HIT'
                    _pstatus_ar = '✅ تم تحقيق الهدف'
                elif _hs == 1 and _actual_ret_check > 0:
                    # RL-FIX-9 (BUG #1 catch): hit_stop=1 بس العائد موجب → trailing profit
                    _pstatus = 'TRAILING_PROFIT'
                    _pstatus_ar = '💰 خرج بربح'
                elif _hs == 1:
                    _pstatus = 'STOPPED'
                    _pstatus_ar = '❌ ضرب وقف'
                elif _is_closed and _exit_type == 'expired':
                    _pstatus = 'EXPIRED'
                    _pstatus_ar = '⌛ انتهت المدة'
                elif _is_closed:
                    # مقفولة بدون exit_type واضح — بنعتمد على علامة العائد
                    if _actual_ret_check > 0:
                        _pstatus = 'TRAILING_PROFIT'
                        _pstatus_ar = '💰 خرج بربح'
                    elif _actual_ret_check < 0:
                        _pstatus = 'STOPPED'
                        _pstatus_ar = '❌ ضرب وقف'
                    else:
                        _pstatus = 'EXPIRED'
                        _pstatus_ar = '⌛ انتهت المدة'
                else:
                    _pstatus = 'PENDING'
                    _pstatus_ar = '⏳ لسه معلقة'

                # تعيين الإشارة بالعربي
                _sig_raw = (pr['signal'] or 'hold').lower()
                if 'strong_buy' in _sig_raw:
                    _psig, _psig_ar = 'STRONG_BUY', 'شراء قوي'
                elif 'buy' in _sig_raw or 't1' in _sig_raw or 'swing' in _sig_raw:
                    _psig, _psig_ar = 'BUY', 'شراء'
                elif 'strong_sell' in _sig_raw:
                    _psig, _psig_ar = 'STRONG_SELL', 'بيع قوي'
                elif 'sell' in _sig_raw:
                    _psig, _psig_ar = 'SELL', 'بيع'
                elif 'accumulate' in _sig_raw:
                    _psig, _psig_ar = 'ACCUMULATE', 'تجميع'
                else:
                    _psig, _psig_ar = 'HOLD', 'انتظار'

                _pentry = float(pr['entry_price'] or 0)
                _ptarget = float(pr['target_price'] or 0)
                _pstop = float(pr['stop_loss'] or 0)
                _stock_info_pp = _get_stock_name(pr['ticker'] or '')

                # P6-PREDICTIONS: نقرأ أعلى/أقل سعر تاريخي من الأعمدة المُتتبَعة
                # (highest_price_reached / lowest_price_reached) — لو العمود غير
                # موجود (DB قديم) نرجّع None بأمان.
                try:
                    _pmax_high = float(pr['highest_price_reached']) if pr['highest_price_reached'] else None
                except (KeyError, TypeError, ValueError):
                    _pmax_high = None
                try:
                    _pmin_low = float(pr['lowest_price_reached']) if pr['lowest_price_reached'] else None
                except (KeyError, TypeError, ValueError):
                    _pmin_low = None

                # RL-FIX-9 (BUG #2): حساب نسبة التحقيق الفعلية.
                # - لو actual_return موجود في DB → استخدمه مباشرة.
                # - لو actual_return = NULL بس الصفقة مقفولة (outcome_date NOT NULL)
                #   → نحسب من exit_price (مع SELL sign-flip).
                # - لو الصفقة PENDING (outcome_date NULL) → _actual_ret = None
                #   (ما عدناش نحسب من exit_price للـ PENDING لأن ده كان بـ ينتج
                #   أرقام متناقضة زي "معلقة | -4.4%").
                _actual_ret = None
                if pr['actual_return'] is not None:
                    try:
                        _actual_ret = round(float(pr['actual_return']), 2)
                    except (TypeError, ValueError):
                        _actual_ret = None
                elif _is_closed and _pentry > 0 and pr['exit_price']:
                    try:
                        _sig_type = (pr['signal_type'] or pr['signal'] or 'BUY').upper()
                        _is_sell = 'SELL' in _sig_type
                        _exit = float(pr['exit_price'])
                        if _is_sell:
                            # SELL: ربحنا لو السعر نزل → (entry - exit) / entry
                            _actual_ret = round(((_pentry - _exit) / _pentry) * 100.0, 2)
                        else:
                            # BUY: ربحنا لو السعر طلع → (exit - entry) / entry
                            _actual_ret = round(((_exit - _pentry) / _pentry) * 100.0, 2)
                    except (TypeError, ValueError, ZeroDivisionError):
                        _actual_ret = None
                # للـ PENDING: _actual_ret يفضل None → الـ UI بـ يعرض "—"

                # RL-FIX-9: للـ PENDING rows، احسب live return من highest/lowest
                # لو متاحين (علشان المستخدم يشوف أداء الصفقة المفتوحة دلوقتي).
                _live_return = None
                if not _is_closed and _pentry > 0:
                    try:
                        _sig_type = (pr['signal_type'] or pr['signal'] or 'BUY').upper()
                        _is_sell = 'SELL' in _sig_type
                        # للـ BUY: استخدم highest_price_reached كـ current
                        # للـ SELL: استخدم lowest_price_reached كـ current
                        _live_price = _pmin_low if _is_sell else _pmax_high
                        if _live_price and _live_price > 0:
                            if _is_sell:
                                _live_return = round(((_pentry - _live_price) / _pentry) * 100.0, 2)
                            else:
                                _live_return = round(((_live_price - _pentry) / _pentry) * 100.0, 2)
                    except (TypeError, ValueError, ZeroDivisionError):
                        _live_return = None

                # استخدم live_return للـ PENDING لو actual_return فاضي
                _display_return = _actual_ret if _actual_ret is not None else _live_return

                previous_predictions.append({
                    'ticker': pr['ticker'],
                    'symbol': pr['ticker'],
                    'name': _stock_info_pp['name'],
                    'name_ar': _stock_info_pp['name_ar'],
                    'sector': _stock_info_pp.get('sector', ''),
                    'signal': _psig,
                    'signal_ar': _psig_ar,
                    'entry_price': round(_pentry, 2),
                    'target_price': round(_ptarget, 2) if _ptarget else None,
                    'stop_loss': round(_pstop, 2) if _pstop else None,
                    'master_score': float(pr['master_score'] or 0),
                    'confidence': float(pr['master_score'] or 50),
                    'prediction_date': pr['prediction_date'],
                    'outcome_date': pr['outcome_date'],
                    'exit_price': float(pr['exit_price']) if pr['exit_price'] else None,
                    'actual_return': _display_return,
                    'is_live_return': _live_return is not None and _actual_ret is None,
                    'holding_days': int(pr['holding_days'] or 0),
                    'status': _pstatus,
                    'status_ar': _pstatus_ar,
                    'exit_type': _exit_type or None,
                    'persona': pr['persona'] if 'persona' in pr.keys() else None,
                    # P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع
                    'max_high_since_pred': round(_pmax_high, 2) if _pmax_high else None,
                    'min_low_since_pred': round(_pmin_low, 2) if _pmin_low else None,
                    'highest_price_reached': round(_pmax_high, 2) if _pmax_high else None,  # alias
                    'lowest_price_reached': round(_pmin_low, 2) if _pmin_low else None,    # alias
                })
                if len(previous_predictions) >= 60:
                    break
        except Exception as _pp_err:
            print(f"[Warning] previous_predictions query failed: {_pp_err}")
            previous_predictions = []

        # وسم التوقعات النشطة: 🆕 جديدة / 🔄 مستمرة
        try:
            _active_with_prior = set()
            if active_tickers:
                _ph = conn.execute(
                    "SELECT DISTINCT UPPER(ticker) as t FROM predictions WHERE prediction_date < ?",
                    (_today_str,)
                ).fetchall()
                _active_with_prior = set((r['t'] or '').strip() for r in _ph if r['t'])
            for p in open_predictions:
                _tk = (p.get('ticker') or '').upper().strip()
                if _tk and _tk in _active_with_prior:
                    p['is_new'] = False
                    p['is_continuous'] = True
                else:
                    p['is_new'] = True
                    p['is_continuous'] = False
        except Exception as _tag_err:
            print(f"[Warning] prediction tagging failed: {_tag_err}")
            for p in open_predictions:
                p.setdefault('is_new', True)
                p.setdefault('is_continuous', False)

        total_preds = len(open_predictions) + len(closed_predictions)
        closed_count_real = len(closed_predictions)
        win_count = sum(1 for p in closed_predictions if p.get('status') == 'TARGET_HIT')
        loss_count = sum(1 for p in closed_predictions if p.get('status') == 'STOPPED')
        win_rate = (win_count / closed_count_real * 100.0) if closed_count_real > 0 else 0.0
        avg_pnl = (sum(p.get('profit_loss_percent', 0) for p in open_predictions + closed_predictions) / total_preds) if total_preds > 0 else 0.0

        # إحصاء الـ cascade tiers (للشفافية في الواجهة)
        _tier_counts = {}
        for p in open_predictions:
            _t = p.get('fallback_tier', 'strict')
            _tier_counts[_t] = _tier_counts.get(_t, 0) + 1
        _dominant_tier = max(_tier_counts, key=_tier_counts.get) if _tier_counts else 'strict'
        _cascade_note_ar = {
            'strict':      'السوق نار — أعلى 5 توقعات بثقة صارمة (>=70%).',
            'moderate':    'السوق متوسط — بتعرض أسهم قيادية هادية بزخم معتدل.',
            'survival':    'السوق هادي — بتعرض الحد الأدنى المقبول (>=50%).',
            'last_resort': 'السوق ضعيف جداً — بتعرض أعلى المتاح عشان الشاشة متفضيش.',
        }.get(_dominant_tier, 'التدرج في القبول شغّال.')

        conn.close()

        if request.method == 'POST':
            return jsonify({
                'success': True,
                'message': 'Predictions rebuild triggered',
                'total': total_preds,
                'timestamp': datetime.now().isoformat(),
            })

        return jsonify({
            'success': True,
            'predictions': open_predictions,
            'active_predictions': open_predictions,
            'previous_predictions': previous_predictions,
            'investor_predictions': investor_top5,
            'trader_predictions': trader_top5,
            'closed_predictions': closed_predictions,
            'open_predictions': open_predictions,
            'total': total_preds,
            'closed_count': closed_count_real,
            'open_count': len(open_predictions),
            'previous_count': len(previous_predictions),
            'market': market or 'ALL',
            'cascade': {
                'dominant_tier': _dominant_tier,
                'tier_counts': _tier_counts,
                'note_ar': _cascade_note_ar,
                'tiers': {
                    'strict':      {'min_score': 70, 'min_rr': 1.5, 'label_ar': '🏆 جودة عالية'},
                    'moderate':    {'min_score': 60, 'min_rr': 1.3, 'label_ar': '🥈 جودة متوسطة'},
                    'survival':    {'min_score': 50, 'min_rr': 1.2, 'label_ar': '🥉 الحد الأدنى'},
                    'last_resort': {'min_score': 0,  'min_rr': 0,   'label_ar': '⚠️ أعلى المتاح'},
                },
            },
            'stats': {
                'total': total_preds,
                'win_count': win_count,
                'loss_count': loss_count,
                'closed_count': closed_count_real,
                'open_count': len(open_predictions),
                'win_rate': round(win_rate, 1),
                'avg_pnl': round(avg_pnl, 2),
                'note': _cascade_note_ar,
            },
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'predictions': [],
            'closed_predictions': [],
            'total': 0,
            'error': str(e),
        }), 200


# ============================================================================
# ROBO-ADVISOR-P4: Bag-Holder Rescue Engine — محرك إنقاذ الأسهم المزنوقة
# ============================================================================
# العميل اللي لبس سهم بخسارة محتاج قرار مصمت: اصبر / اعمل متوسط / اقطع.
# الـ AI بيبص على 3 حاجات:
#   1. المقارنة التاريخية: سعر الشراء vs القمة التاريخية
#   2. الأساسيات: هل الشركة لسه ربحانية؟
#   3. التوصية الديناميكية: تقرير مفصل بأسلوب بشري
# ============================================================================

@misc_bp.route('/api/portfolio/bag-holder-rescue', methods=['GET'])
def bag_holder_rescue():
    """محرك إنقاذ الأسهم المزنوقة.

    GET /api/portfolio/bag-holder-rescue?ticker=COMI&buy_price=150&quantity=100
    يرجّع تقرير إنقاذ مفصل.
    """
    try:
        import sqlite3
        from pathlib import Path
        _root = Path(__file__).resolve().parent.parent.parent

        ticker = (request.args.get('ticker') or '').upper().strip()
        buy_price = float(request.args.get('buy_price') or 0)
        quantity = float(request.args.get('quantity') or 0)

        if not ticker or buy_price <= 0:
            return jsonify({'success': False, 'error': 'ticker و buy_price مطلوبين'}), 400

        # 1. جلب السعر الحالي + القمة/القاع التاريخي
        # PHASE 8: قراءة الأسعار عبر data.prices (البوابة الموحّدة) بدل
        # sqlite3.connect مباشر. قبل كده كان الكود بيقرأ من جدول `prices`
        # غير موجود في price_history.db (الجدول الحقيقي `price_history` بأعمدة
        # lowercase) → كان بيفشل بصمت. دلوقتي بنجيب الـ candles كلها ونحسب.
        current_price = buy_price
        all_time_high = buy_price
        all_time_low = buy_price
        price_history_count = 0

        try:
            if _PRICES_GATE:
                # البوابة الموحّدة — بترجّع candles oldest-first: [{date,open,high,low,close,volume}]
                candles = _load_price_history(ticker, limit=2000)
                closes = [float(c['close']) for c in candles if c.get('close') and float(c['close']) > 0]
                if closes:
                    all_time_high = max(closes)
                    all_time_low = min(closes)
                    price_history_count = len(closes)
                    current_price = closes[-1]  # آخر شمعة = الأحدث
        except Exception as pe:
            print(f"[rescue] price_history (prices gate) error: {pe}")

        # من stocks.db (السعر اللحظي + 52w high/low) عبر db_manager (WAL+busy_timeout)
        # PHASE 8: قبل كده كان بيقرأ أعمدة high_price/low_price/close غير موجودة
        # في stocks (الصح high_52w/low_52w) → كان بيفشل بصمت. دلوقتي الأعمدة صح.
        try:
            if _DBM_AVAILABLE:
                srow = _dbm.query_one(
                    'stocks',
                    "SELECT current_price, high_52w, low_52w FROM stocks "
                    "WHERE ticker = ? OR ticker LIKE ?",
                    (ticker, f"{ticker}%"),
                )
                if srow:
                    cp = float(srow.get('current_price') or 0)
                    if cp > 0:
                        current_price = cp
                    hp = float(srow.get('high_52w') or 0)
                    lp = float(srow.get('low_52w') or 0)
                    if hp > all_time_high:
                        all_time_high = hp
                    if lp > 0 and (all_time_low == buy_price or lp < all_time_low):
                        all_time_low = lp
        except Exception as se:
            print(f"[rescue] stocks.db (db_manager) error: {se}")

        # 2. الأساسيات (الربحانية) — من data_engine.db عبر db_manager
        # PHASE 8: قبل كده كان بيقرأ من جدول `stock_fundamentals` غير موجود.
        # الصح: tab_profitability (roe, net_margin). is_profitable من net_margin>0.
        is_profitable = None
        fundamentals_note = ''
        try:
            if _DBM_AVAILABLE:
                frow = _dbm.query_one(
                    'data_engine',
                    "SELECT roe, net_margin FROM tab_profitability "
                    "WHERE ticker LIKE ? ORDER BY last_updated DESC LIMIT 1",
                    (f"{ticker}%",),
                )
                if frow:
                    net_margin = frow.get('net_margin')
                    roe = frow.get('roe')
                    if net_margin is not None:
                        try:
                            is_profitable = float(net_margin) > 0
                        except (TypeError, ValueError):
                            is_profitable = None
                    elif roe is not None:
                        try:
                            is_profitable = float(roe) > 0
                        except (TypeError, ValueError):
                            is_profitable = None
                    fundamentals_note = f"ROE={roe}, NetMargin={net_margin}" if (roe is not None or net_margin is not None) else ''
        except Exception as fe:
            print(f"[rescue] fundamentals (db_manager) error: {fe}")

        # 3. حسابات
        loss_pct = round(((current_price - buy_price) / buy_price) * 100, 2) if buy_price > 0 else 0
        # مكان الشراء بالنسبة للقمة التاريخية
        peak_ratio = round((buy_price / all_time_high) * 100, 1) if all_time_high > 0 else 100
        if peak_ratio >= 90:
            buy_zone = 'peak'
            buy_zone_ar = '🚨 عند القمة التاريخية'
        elif peak_ratio >= 60:
            buy_zone = 'upper'
            buy_zone_ar = '⚠️ في النص العلوي'
        elif peak_ratio >= 30:
            buy_zone = 'middle'
            buy_zone_ar = '✅ في النص (سعر معقول)'
        else:
            buy_zone = 'lower'
            buy_zone_ar = '🟢 قرب القاع التاريخي'

        # نسبة الاسترداد المطلوبة للوصول للـ break-even
        recovery_needed = round(((buy_price - current_price) / current_price) * 100, 1) if current_price > 0 and current_price < buy_price else 0

        # 4. التوصية الديناميكية
        recommendation = 'HOLD'
        recommendation_ar = 'اصبر'
        reasoning = ''
        urgency = 'low'

        severe_loss = loss_pct <= -20
        moderate_loss = -20 < loss_pct <= -10

        if buy_zone == 'peak' and severe_loss:
            recommendation = 'CUT_LOSS'
            recommendation_ar = 'اقطع الخسارة'
            urgency = 'high'
            reasoning = f"أنت اشتريت {ticker} عند {buy_price:.2f} — ده كان قرب القمة التاريخية ({all_time_high:.2f}). السهم نزل {abs(loss_pct):.1f}% والشراء كان مرتفع. لو الشركة لسه ربحانية ممكن تصبر، بس القمة التاريخية بتقول إن السهم ممكن ياخد وقت طويل يرجع. الأفضل تقطع الخسارة وتحط الفلوس في سهم تاني بفرصة أحسن."
        elif buy_zone == 'peak' and is_profitable == False:
            recommendation = 'CUT_LOSS'
            recommendation_ar = 'اقطع الخسارة'
            urgency = 'high'
            reasoning = f"أنت اشتريت {ticker} عند القمة ({buy_price:.2f}) والشركة مش ربحانية. دي علامة خطر مزدوجة — السهم غالي والشركة بتخسر. اقطع الخسارة فوراً قبل ما الوضع يزيد."
        elif severe_loss and is_profitable == True and buy_zone != 'peak':
            recommendation = 'AVERAGE_DOWN'
            recommendation_ar = 'اعمل متوسط (Average Down)'
            urgency = 'medium'
            reasoning = f"أنت خسران {abs(loss_pct):.1f}% في {ticker}، بس الشركة لسه ربحانية وسعر الشراء ({buy_price:.2f}) كان في منطقة معقولة (مش القمة). ده سهم صح تحته ضغط مؤقت. ممكن تعمل متوسط — تشتري كمية تانية بسعر أقل عشان تخفض متوسط التكلفة. بس خلي بالك: متعملش متوسط لو في ديون على الشركة أو أخبار سلبية جاية."
        elif moderate_loss and buy_zone != 'peak':
            recommendation = 'HOLD'
            recommendation_ar = 'اصبر'
            urgency = 'low'
            reasoning = f"الخسارة في {ticker} لسه معتدلة ({abs(loss_pct):.1f}%) وسعر الشراء ({buy_price:.2f}) في منطقة معقولة. لو السهم من شركة قوية، اصبر — التذبذب ده طبيعي. راجع السهم بعد أسبوع-أسبوعين."
        elif loss_pct >= 0:
            recommendation = 'HOLD'
            recommendation_ar = 'اصبر / احقق ربح'
            urgency = 'low'
            reasoning = f"أنت رابح في {ticker} ({loss_pct:+.1f}%). لو السهم لسه بيبقى فرصة، ممكن تصبر للهدف. لو وصلت لهدفك، احقق ربح جزئي وحط وقف خسارة تحت سعر الدخول."
        else:
            recommendation = 'HOLD'
            recommendation_ar = 'اصبر'
            urgency = 'low'
            reasoning = f"الوضع في {ticker} لسه مش واضح. الخسارة {abs(loss_pct):.1f}% وسعر الشراء {buy_zone_ar}. راجع السهم بعد فترة — لو زاد الخسارة فوق 20% وأنت عند القمة، فكر تقطع."

        # القيمة السوقية الحالية + الخسارة بالجنيه
        market_value = current_price * quantity
        invested = buy_price * quantity
        loss_egp = (current_price - buy_price) * quantity

        return jsonify({
            'success': True,
            'ticker': ticker,
            'buy_price': round(buy_price, 2),
            'current_price': round(current_price, 2),
            'quantity': quantity,
            'invested_egp': round(invested, 2),
            'market_value_egp': round(market_value, 2),
            'loss_pct': loss_pct,
            'loss_egp': round(loss_egp, 2),
            'recovery_needed_pct': recovery_needed,
            'all_time_high': round(all_time_high, 2),
            'all_time_low': round(all_time_low, 2),
            'buy_zone': buy_zone,
            'buy_zone_ar': buy_zone_ar,
            'peak_ratio': peak_ratio,
            'price_history_count': price_history_count,
            'is_profitable': is_profitable,
            'fundamentals_note': fundamentals_note,
            'recommendation': recommendation,
            'recommendation_ar': recommendation_ar,
            'urgency': urgency,
            'reasoning': reasoning,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 200


# ============================================================================
# LIVE REFRESH — تحديث فوري لـ stored_analyses خلال الجلسة
# ============================================================================

_refresh_running = False

@misc_bp.route('/api/daily/live-refresh-analyses', methods=['POST'])
def live_refresh_analyses():
    """
    يُشغّل التحليل التقني الفوري لأهم الأسهم (top 80 by score)
    ويُحدّث stored_analyses في background thread.
    يُرجع استجابة فورية (لا ينتظر اكتمال التحليل).
    """
    import threading
    import sqlite3
    from pathlib import Path
    from datetime import datetime as _dt

    global _refresh_running

    if _refresh_running:
        return jsonify({
            'success': True,
            'message': 'التحليل جارٍ بالفعل في الخلفية',
            'running': True,
        })

    # SINGLE-WRITER (Task PHASE-3, Rule 73)
    # Only daily_predictor.py is allowed to write to stored_analyses.
    # This writer is disabled to prevent conflicting decisions (last-writer-wins).
    SKIP_STORED_ANALYSES_WRITE = True
    if SKIP_STORED_ANALYSES_WRITE:
        try:
            _logger.info('[SINGLE-WRITER] Skipping live_refresh_analyses stored_analyses writes — use daily_predictor.py')
        except Exception:
            pass
        return jsonify({
            'success': True,
            'skipped': True,
            'running': False,
            'message': 'SINGLE-WRITER (PHASE-3 Rule 73) — disabled; daily_predictor.py is canonical',
        })

    def _run_background_refresh():
        global _refresh_running
        _refresh_running = True
        try:
            _root = Path(__file__).resolve().parent.parent.parent
            _pdb  = str(_root / 'db' / 'predictions.db')
            _sdb  = str(_root / 'db' / 'stocks.db')

            # PHASE 8: قراءة عبر db_manager (WAL + busy_timeout) بدل sqlite3.connect.
            if not _DBM_AVAILABLE:
                _logger.warning("live_refresh: db_manager unavailable — aborting")
                return
            rows = _dbm.query(
                'predictions',
                "SELECT ticker, market FROM stored_analyses "
                "WHERE maestro_score IS NOT NULL "
                "ORDER BY maestro_score DESC LIMIT 80",
            )

            if not master_analyzer:
                _logger.warning("live_refresh: MasterAnalyzer not available")
                return

            today = _dt.now().strftime('%Y-%m-%d')
            updated_count = 0

            # ── AGILE-PHASE2-035 (C): CPU breath — تأخير قابل للضبط ─────────
            try:
                _scan_sleep = float(os.environ.get('SCAN_SLEEP_SECONDS', '0.2') or '0.2')
            except Exception:
                _scan_sleep = 0.2

            # EgyptScheduler reference للتحقق من ساعات التداول (skip logic)
            _sched_ref = None
            try:
                from core.egypt_scheduler import get_scheduler as _get_sched
                _sched_ref = _get_sched()
            except Exception:
                _sched_ref = None

            for row in rows:
                ticker = row['ticker']

                # ── AGILE-PHASE2-035 (B): Price-Change Skip ──────────────────
                # لو السعر ما تحرّكش أكتر من 0.5% منذ آخر تحليل مخزّن (والتحليل
                # من اليوم، ومنت خلال ساعات الجلسة)، اتخطّى إعادة التحليل.
                try:
                    _skip_row = _dbm.query_one(
                        'predictions',
                        "SELECT entry_price, updated_at FROM stored_analyses WHERE ticker = ?",
                        (ticker,),
                    )

                    if _skip_row is not None:
                        _entry_price = float(_skip_row.get('entry_price') or 0)
                        _updated_at_str = str(_skip_row.get('updated_at') or '')

                        # السعر الحالي من stocks.db
                        _live_price = 0.0
                        try:
                            _s_row = _dbm.query_one(
                                'stocks',
                                "SELECT current_price FROM stocks WHERE ticker = ?",
                                (ticker,),
                            )
                            if _s_row and _s_row.get('current_price'):
                                _live_price = float(_s_row['current_price'])
                        except Exception:
                            pass

                        # حساب نسبة الحركة
                        _price_moved_pct = 1.0  # default: skip-safe
                        if _entry_price > 0 and _live_price > 0:
                            _price_moved_pct = abs(_live_price - _entry_price) / _entry_price

                        # هل آخر تحليل من اليوم؟
                        _is_fresh = False
                        try:
                            if _updated_at_str:
                                _updated_date = _updated_at_str.split(' ')[0].split('T')[0]
                                _today_date = _dt.now().strftime('%Y-%m-%d')
                                _is_fresh = (_updated_date == _today_date)
                        except Exception:
                            _is_fresh = False

                        # هل نحن في ساعات التداول؟
                        _in_trading_hours = False
                        if _sched_ref is not None:
                            try:
                                _in_trading_hours = _sched_ref.is_trading_hours()
                            except Exception:
                                _in_trading_hours = False

                        if (_price_moved_pct < 0.005 and _is_fresh and _in_trading_hours):
                            _logger.info(
                                f"live_refresh: [SKIP] {ticker}: price moved <0.5% "
                                f"since last analysis — using cached"
                            )
                            if _scan_sleep > 0:
                                time.sleep(_scan_sleep)
                            continue
                except Exception as _skip_err:
                    # الـ skip اختياري — لو فشل، كمّل عادي
                    pass

                try:
                    analysis = master_analyzer.analyze(ticker)
                    if not analysis:
                        # تنفّس بين الأسهم حتى لو فشل التحليل
                        if _scan_sleep > 0:
                            time.sleep(_scan_sleep)
                        continue

                    ad = analysis.to_dict() if hasattr(analysis, 'to_dict') else {}

                    # PHASE 8: الكتابة عبر db_manager (WAL + busy_timeout=30000)
                    # بدل sqlite3.connect مباشر — ده اللي بـ يمنع "database is locked".
                    _dbm.execute(
                        'predictions',
                        """UPDATE stored_analyses SET
                            recommendation   = ?,
                            maestro_score    = ?,
                            technical_score  = ?,
                            confidence       = ?,
                            target_price     = ?,
                            stop_loss        = ?,
                            entry_price      = ?,
                            updated_at       = datetime('now')
                        WHERE ticker = ?""",
                        (
                            (ad.get('signal') or ad.get('recommendation') or 'hold').lower(),
                            float(ad.get('master_score') or ad.get('maestro_score') or 50),
                            float(ad.get('technical_score') or 50),
                            float(ad.get('confidence') or 50),
                            float((ad.get('risk_profile') or {}).get('target_price') or 0),
                            float((ad.get('risk_profile') or {}).get('stop_loss_price') or 0),
                            float((ad.get('risk_profile') or {}).get('entry_price') or 0),
                            ticker,
                        ),
                    )
                    updated_count += 1

                    # حفظ في cache المحلل إن وُجد
                    if db:
                        try:
                            db.save_cached_analysis(ticker, ad, today)
                        except Exception:
                            pass

                except Exception as _e:
                    _logger.warning(f"live_refresh: failed for {ticker}: {_e}")
                    # تنفّس حتى لو فشل السهم
                    if _scan_sleep > 0:
                        time.sleep(_scan_sleep)
                    continue

                # ── AGILE-PHASE2-035 (C): CPU breath — تنفّس بين الأسهم ─────
                try:
                    if _scan_sleep > 0:
                        time.sleep(_scan_sleep)
                except Exception:
                    pass

            _logger.info(f"live_refresh: updated {updated_count} stocks in stored_analyses")

        except Exception as _ex:
            _logger.error(f"live_refresh background failed: {_ex}")
        finally:
            _refresh_running = False

    thread = threading.Thread(target=_run_background_refresh, daemon=True)
    thread.start()

    # حساب الإحصائيات الحالية لإرجاعها فوراً
    try:
        _root2 = Path(__file__).resolve().parent.parent.parent
        _pdb2 = str(_root2 / 'db' / 'predictions.db')
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        try:
            if _DBM_AVAILABLE:
                _count_row = _dbm.query_one('predictions', "SELECT COUNT(*) as cnt FROM stored_analyses")
                count = _count_row['cnt'] if _count_row else 0
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn3 = sqlite3.connect(_pdb2)
            count = conn3.execute("SELECT COUNT(*) FROM stored_analyses").fetchone()[0]
            conn3.close()
    except Exception:
        count = 0

    return jsonify({
        'success': True,
        'message': f'جاري تحديث أفضل 80 سهم في الخلفية',
        'predictions_count': count,
        'running': True,
        'timestamp': datetime.now().isoformat(),
    })


# ============================================================================
# REALITY-CHECK-023: Health Check & Alert System (نظام الإنذارات)
# ============================================================================

@misc_bp.route('/api/admin/health', methods=['GET'])
def admin_health_check():
    """فحص صحة المنصة — للوحة الأدمن.

    بيرجع:
    - data_engine_health: هل الأسعار حديثة؟
    - alert_level: none | warning | critical
    - alert_message: رسالة الإنذار (لو موجود)
    - timestamp: وقت الفحص
    """
    try:
        from analyzers.alert_system import check_data_health
        health = check_data_health()
        return jsonify({
            'success': True,
            'data_engine_health': health,
            'alert_level': health.get('alert_level', 'none'),
            'alert_message': health.get('alert_message', ''),
            'is_healthy': health.get('is_healthy', True),
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'is_healthy': False,
            'alert_level': 'critical',
            'alert_message': f'خطأ في فحص الصحة: {e}',
        }), 500


@misc_bp.route('/api/admin/alerts/test', methods=['POST'])
def test_alert():
    """اختبار نظام الإنذارات — بيably إرسال إنذار للتليجرام."""
    try:
        from analyzers.alert_system import send_warning_alert
        data = request.get_json(silent=True) or {}
        message = data.get('message', 'اختبار نظام الإنذارات')
        result = send_warning_alert(message, context='test_alert_endpoint')
        return jsonify({
            'success': True,
            'result': result,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500





# ════════════════════════════════════════════════════════════════════════════
# RULE20-PURE-PROXY (2026-10-12): Liquidity Flow + Finance Screener
# ════════════════════════════════════════════════════════════════════════════
# These 2 endpoints replace the Node-side business logic that was previously
# in src/app/api/market/liquidity-flow/route.ts (472 lines) and
# src/app/api/finance/screener/route.ts (306 lines).
#
# Per Rule 20 (Python = brain, Node = display only) + Rule 27 (NO-FAKE-DATA)
# + Rule 67 (CALCULATION-CANONICAL), all computation MUST happen in Python.
# The Node routes are now pure thin proxies (10-15 lines each): fetch + return.
# ════════════════════════════════════════════════════════════════════════════

import sqlite3 as _sqlite3
from pathlib import Path as _Path
from datetime import datetime as _dt, timedelta as _td

_STOCKS_DB = str(_Path(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')


def _parse_volume_val(v) -> float:
    """يحوّل قيمة حجم/قيمة التداول لرقم صافي (الـ scraper أحياناً بيرجّع نصوص مثل '317.39 K')."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    import re
    m = re.match(r'^([\d.,]+)\s*([KMBT]?)$', s, re.IGNORECASE)
    if not m:
        cleaned = re.sub(r'[^0-9.\-]', '', s)
        try:
            return float(cleaned) if cleaned else 0.0
        except ValueError:
            return 0.0
    try:
        num = float(m.group(1).replace(',', ''))
    except ValueError:
        return 0.0
    mult = (m.group(2) or '').upper()
    factor = {'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, '': 1.0}[mult]
    return num * factor


def _day_price(row: dict, fallback: float) -> float:
    """يرجّع سعر اليوم: close → close_price → fallback لـ current_price."""
    close = row.get('close')
    if close is not None:
        try:
            v = float(close)
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
    cp = row.get('close_price')
    if cp is not None:
        try:
            v = float(cp)
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
    return fallback


@misc_bp.route('/api/market/liquidity-flow', methods=['GET'])
def get_liquidity_flow():
    """GET /api/market/liquidity-flow — Rule 20 compliant liquidity flow endpoint.

    Replaces Node-side computation in market/liquidity-flow/route.ts (472 lines):
      - sector_flow (top 12 sectors by turnover)
      - top_inflow_stocks / top_outflow_stocks (top 10 each)
      - investor_type_estimate (institutional vs retail)
      - summary (net direction, advancing/declining sectors)

    Query params:
      - market (default EGX)
      - days (default 30, max 180)
    """
    try:
        market = (request.args.get('market') or 'EGX').upper().strip()
        if market not in ('EGX', 'TADAWUL', 'KSE', 'QSE'):
            market = 'EGX'
        try:
            days = max(1, min(180, int(request.args.get('days', 30))))
        except (ValueError, TypeError):
            days = 30

        if not os.path.exists(_STOCKS_DB):
            return jsonify({
                'success': False,
                'error': 'stocks.db not found',
                'market': market,
                'days': days,
            }), 503

        conn = _sqlite3.connect(_STOCKS_DB, timeout=30.0)
        conn.row_factory = _sqlite3.Row
        cur = conn.cursor()

        # 1) tickers + metadata للسوق
        cur.execute("""
            SELECT ticker, name_ar, name, sector, current_price
            FROM stocks
            WHERE market = ? AND is_active = 1
        """, (market,))
        stock_rows = [dict(r) for r in cur.fetchall()]
        if not stock_rows:
            conn.close()
            return jsonify({
                'success': True,
                'market': market,
                'days': days,
                'sector_flow': [],
                'top_inflow_stocks': [],
                'top_outflow_stocks': [],
                'investor_type_estimate': None,
                'summary': {'total_turnover': 0, 'total_volume': 0,
                            'net_flow_direction': 'neutral',
                            'advancing_sectors': 0, 'declining_sectors': 0},
                'note': 'no stocks for this market',
            })

        ticker_to_meta = {s['ticker']: s for s in stock_rows}
        tickers = list(ticker_to_meta.keys())

        # 2) cutoff date: نثبّت النافذة على آخر يوم تداول فعلي
        placeholders = ','.join(['?'] * len(tickers))
        cur.execute(f"""
            SELECT MAX(price_date) AS latest_date
            FROM stock_daily_prices
            WHERE ticker IN ({placeholders})
        """, tickers)
        latest_date_row = cur.fetchone()
        latest_date_str = latest_date_row['latest_date'] if latest_date_row else None
        if not latest_date_str:
            conn.close()
            return jsonify({
                'success': True,
                'market': market,
                'days': days,
                'sector_flow': [],
                'top_inflow_stocks': [],
                'top_outflow_stocks': [],
                'investor_type_estimate': None,
                'summary': {'total_turnover': 0, 'total_volume': 0,
                            'net_flow_direction': 'neutral',
                            'advancing_sectors': 0, 'declining_sectors': 0},
                'note': 'no price history available for this market',
            })

        # current: [latest - days, latest] / previous: [latest - 2*days, latest - days)
        latest_date = _dt.strptime(latest_date_str, '%Y-%m-%d')
        cutoff = latest_date - _td(days=days)
        cutoff_str = cutoff.strftime('%Y-%m-%d')
        prev_cutoff = cutoff - _td(days=days)
        prev_cutoff_str = prev_cutoff.strftime('%Y-%m-%d')

        # 3) اسحب كل صفوف الأسعار للنافذتين
        cur.execute(f"""
            SELECT ticker, price_date, close, close_price, volume, change_percent
            FROM stock_daily_prices
            WHERE ticker IN ({placeholders})
              AND price_date IS NOT NULL
              AND price_date >= ?
            ORDER BY ticker, price_date DESC
        """, (*tickers, prev_cutoff_str))
        all_rows = [dict(r) for r in cur.fetchall()]

        # 4) رتّب per ticker + افصل current/previous
        by_ticker = {}
        for r in all_rows:
            t = r['ticker']
            if t not in by_ticker:
                by_ticker[t] = {'current': [], 'previous': []}
            if r['price_date'] >= cutoff_str:
                by_ticker[t]['current'].append(r)
            else:
                by_ticker[t]['previous'].append(r)

        # 5) اجمع per-stock + per-sector
        stock_flow_list = []
        sector_map = {}
        grand_turnover = 0.0
        grand_volume = 0.0
        avg_trade_values = []
        large_blocks = []

        for meta in stock_rows:
            entry = by_ticker.get(meta['ticker'])
            if not entry or not entry['current']:
                continue
            fallback_price = float(meta.get('current_price') or 0)

            stock_turnover = 0.0
            stock_volume = 0.0
            change_sum = 0.0
            change_count = 0
            latest_change = 0.0
            latest_price = fallback_price
            for r in entry['current']:
                price = _day_price(r, fallback_price)
                vol = _parse_volume_val(r.get('volume'))
                day_turnover = price * vol
                stock_turnover += day_turnover
                stock_volume += vol
                cp = r.get('change_percent')
                if cp is not None:
                    try:
                        cp_v = float(cp)
                        change_sum += cp_v
                        change_count += 1
                        latest_change = cp_v
                        if price > 0:
                            latest_price = price
                    except (TypeError, ValueError):
                        pass
            if stock_turnover <= 0:
                continue

            avg_change_pct = change_sum / change_count if change_count > 0 else 0.0
            sector = (meta.get('sector') or '').strip() or 'متفرقات'
            stock_flow = {
                'ticker': meta['ticker'],
                'name_ar': meta.get('name_ar') or meta.get('name') or meta['ticker'],
                'sector': sector,
                'total_turnover': stock_turnover,
                'total_volume': stock_volume,
                'avg_change_pct': avg_change_pct,
                'latest_change_pct': latest_change,
                'latest_price': latest_price,
            }
            stock_flow_list.append(stock_flow)

            # aggregate per sector
            sec_agg = sector_map.setdefault(sector, {
                'sector': sector, 'total_turnover': 0.0, 'total_volume': 0.0,
                'stocks_count': 0, 'change_sum': 0.0, 'change_count': 0,
                'prev_turnover': 0.0,
            })
            sec_agg['total_turnover'] += stock_turnover
            sec_agg['total_volume'] += stock_volume
            sec_agg['stocks_count'] += 1
            sec_agg['change_sum'] += avg_change_pct
            sec_agg['change_count'] += 1

            avg_trade_value = stock_turnover / stock_volume if stock_volume > 0 else 0
            avg_trade_values.append(avg_trade_value)
            if stock_turnover >= 1_000_000:
                large_blocks.append({
                    'ticker': meta['ticker'],
                    'name_ar': stock_flow['name_ar'],
                    'estimated_value': stock_turnover,
                    'sector': sector,
                })

            # previous window per-sector turnover
            if entry['previous']:
                prev_turn = 0.0
                for r in entry['previous']:
                    price = _day_price(r, fallback_price)
                    prev_turn += price * _parse_volume_val(r.get('volume'))
                sec_agg['prev_turnover'] += prev_turn

            grand_turnover += stock_turnover
            grand_volume += stock_volume

        conn.close()

        if not stock_flow_list:
            return jsonify({
                'success': True,
                'market': market,
                'days': days,
                'sector_flow': [],
                'top_inflow_stocks': [],
                'top_outflow_stocks': [],
                'investor_type_estimate': {
                    'institutional_pct': 0, 'retail_pct': 0,
                    'block_trades_count': 0, 'avg_trade_value': 0, 'large_blocks': [],
                },
                'summary': {
                    'total_turnover': 0, 'total_volume': 0,
                    'net_flow_direction': 'neutral',
                    'advancing_sectors': 0, 'declining_sectors': 0,
                },
                'note': 'no liquidity data for this market in the selected window',
            })

        # 6) sector_flow — top 12 sectors
        sector_flow = []
        for s in sector_map.values():
            avg_change_pct = s['change_sum'] / s['change_count'] if s['change_count'] > 0 else 0
            if avg_change_pct > 0.5:
                flow_dir = 'inflow'
            elif avg_change_pct < -0.5:
                flow_dir = 'outflow'
            else:
                flow_dir = 'neutral'
            change_in_turnover_pct = (
                ((s['total_turnover'] - s['prev_turnover']) / s['prev_turnover']) * 100
                if s['prev_turnover'] > 0 else 0
            )
            sector_flow.append({
                'sector': s['sector'],
                'total_turnover': round(s['total_turnover'], 2),
                'total_volume': round(s['total_volume']),
                'stocks_count': s['stocks_count'],
                'avg_change_pct': round(avg_change_pct, 2),
                'flow_direction': flow_dir,
                'change_in_turnover_pct': round(change_in_turnover_pct, 2),
            })
        sector_flow.sort(key=lambda x: x['total_turnover'], reverse=True)
        sector_flow = sector_flow[:12]

        # 7) top_inflow / top_outflow stocks
        top_inflow = sorted(
            [s for s in stock_flow_list if s['latest_change_pct'] > 0],
            key=lambda x: x['total_turnover'], reverse=True,
        )[:10]
        top_inflow = [{
            'ticker': s['ticker'], 'name_ar': s['name_ar'], 'sector': s['sector'],
            'total_turnover': round(s['total_turnover'], 2),
            'total_volume': round(s['total_volume']),
            'latest_change_pct': round(s['latest_change_pct'], 2),
            'latest_price': round(s['latest_price'], 2),
        } for s in top_inflow]

        top_outflow = sorted(
            [s for s in stock_flow_list if s['latest_change_pct'] < 0],
            key=lambda x: x['total_turnover'], reverse=True,
        )[:10]
        top_outflow = [{
            'ticker': s['ticker'], 'name_ar': s['name_ar'], 'sector': s['sector'],
            'total_turnover': round(s['total_turnover'], 2),
            'total_volume': round(s['total_volume']),
            'latest_change_pct': round(s['latest_change_pct'], 2),
            'latest_price': round(s['latest_price'], 2),
        } for s in top_outflow]

        # 8) investor_type_estimate
        institutional_threshold = 1_000_000
        institutional_stocks = [
            s for s in stock_flow_list
            if (s['total_volume'] > 0 and
                (s['total_turnover'] / s['total_volume']) * s['latest_price'] >= institutional_threshold)
            or s['total_turnover'] >= institutional_threshold
        ]
        institutional_pct = round(
            (len(institutional_stocks) / len(stock_flow_list)) * 100, 2
        ) if stock_flow_list else 0
        retail_pct = round(100 - institutional_pct, 2)
        overall_avg_trade_value = (
            round(sum(avg_trade_values) / len(avg_trade_values), 2)
            if avg_trade_values else 0
        )
        large_blocks_sorted = sorted(large_blocks, key=lambda x: x['estimated_value'], reverse=True)[:8]
        large_blocks_out = [{
            'ticker': b['ticker'], 'name_ar': b['name_ar'], 'sector': b['sector'],
            'estimated_value': round(b['estimated_value'], 2),
        } for b in large_blocks_sorted]

        # 9) summary
        advancing_sectors = sum(1 for s in sector_flow if s['flow_direction'] == 'inflow')
        declining_sectors = sum(1 for s in sector_flow if s['flow_direction'] == 'outflow')
        if advancing_sectors > declining_sectors + 1:
            net_flow_dir = 'inflow'
        elif declining_sectors > advancing_sectors + 1:
            net_flow_dir = 'outflow'
        else:
            net_flow_dir = 'neutral'

        return jsonify({
            'success': True,
            'market': market,
            'days': days,
            'generated_at': _dt.now().isoformat(),
            'sector_flow': sector_flow,
            'top_inflow_stocks': top_inflow,
            'top_outflow_stocks': top_outflow,
            'investor_type_estimate': {
                'institutional_pct': institutional_pct,
                'retail_pct': retail_pct,
                'block_trades_count': len(large_blocks),
                'avg_trade_value': overall_avg_trade_value,
                'large_blocks': large_blocks_out,
            },
            'summary': {
                'total_turnover': round(grand_turnover, 2),
                'total_volume': round(grand_volume),
                'net_flow_direction': net_flow_dir,
                'advancing_sectors': advancing_sectors,
                'declining_sectors': declining_sectors,
            },
            'source': 'python-canonical-liquidity-flow',
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': _tb.format_exc().splitlines()[-5:],
        }), 500


@misc_bp.route('/api/finance/screener', methods=['GET'])
def get_finance_screener():
    """GET /api/finance/screener — Rule 20 compliant finance screener endpoint.

    Replaces Node-side computation in finance/screener/route.ts (306 lines):
      - Multi-table JOIN (stocks + stock_daily_prices + fundamentals + sectors)
      - Post-filter by sector/market_cap/pe_ratio/dividend_yield/volume
      - Sort by multiple fields
      - Limit + offset pagination

    Query params:
      - market (default EGX)
      - sector (filter)
      - min_market_cap / max_market_cap
      - min_pe / max_pe
      - min_dividend_yield
      - min_volume
      - sort_by (default: market_cap)
      - sort_dir (asc/desc, default: desc)
      - limit (default 50, max 200)
      - offset (default 0)
    """
    try:
        market = (request.args.get('market') or 'EGX').upper().strip()
        sector = request.args.get('sector', '').strip()
        try:
            min_mc = float(request.args.get('min_market_cap', 0))
        except (ValueError, TypeError):
            min_mc = 0
        try:
            max_mc = float(request.args.get('max_market_cap', 0))
        except (ValueError, TypeError):
            max_mc = 0
        try:
            min_pe = float(request.args.get('min_pe', 0))
        except (ValueError, TypeError):
            min_pe = 0
        try:
            max_pe = float(request.args.get('max_pe', 0))
        except (ValueError, TypeError):
            max_pe = 0
        try:
            min_div = float(request.args.get('min_dividend_yield', 0))
        except (ValueError, TypeError):
            min_div = 0
        try:
            min_vol = float(request.args.get('min_volume', 0))
        except (ValueError, TypeError):
            min_vol = 0
        sort_by = (request.args.get('sort_by') or 'market_cap').strip().lower()
        sort_dir = (request.args.get('sort_dir') or 'desc').strip().lower()
        try:
            limit = min(max(1, int(request.args.get('limit', 50))), 200)
        except (ValueError, TypeError):
            limit = 50
        try:
            offset = max(0, int(request.args.get('offset', 0)))
        except (ValueError, TypeError):
            offset = 0

        if not os.path.exists(_STOCKS_DB):
            return jsonify({
                'success': False,
                'error': 'stocks.db not found',
                'market': market,
            }), 503

        conn = _sqlite3.connect(_STOCKS_DB, timeout=30.0)
        conn.row_factory = _sqlite3.Row
        cur = conn.cursor()

        # Check which tables exist (schema-aware — Rule 6)
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        has_fundamentals = 'stocks_fundamentals' in tables or 'tab_valuation' in tables
        has_sectors = 'sectors' in tables

        # Build query dynamically based on available tables
        select_cols = ['s.ticker', 's.name_ar', 's.name', 's.sector', 's.market',
                       's.current_price', 's.volume', 's.market_cap']
        join_clauses = []
        where_clauses = ['s.market = ?', 's.is_active = 1']
        params = [market]

        # Latest price data per ticker (subquery)
        if 'stock_daily_prices' in tables:
            select_cols.append('sdp.close as latest_close')
            select_cols.append('sdp.volume as latest_volume')
            select_cols.append('sdp.change_percent as latest_change_pct')
            join_clauses.append("""
                LEFT JOIN (
                    SELECT ticker, close, volume, change_percent
                    FROM stock_daily_prices
                    WHERE (ticker, price_date) IN (
                        SELECT ticker, MAX(price_date) FROM stock_daily_prices GROUP BY ticker
                    )
                ) sdp ON sdp.ticker = s.ticker
            """)

        # Fundamentals (PE, PB, dividend_yield, market_cap)
        if has_fundamentals:
            if 'stocks_fundamentals' in tables:
                select_cols.append('sf.pe_ratio')
                select_cols.append('sf.pb_ratio')
                select_cols.append('sf.dividend_yield')
                select_cols.append('sf.market_cap as fund_market_cap')
                join_clauses.append('LEFT JOIN stocks_fundamentals sf ON sf.ticker = s.ticker')
            elif 'tab_valuation' in tables:
                select_cols.append('tv.pe as pe_ratio')
                select_cols.append('tv.pb as pb_ratio')
                select_cols.append('tv.dividend_yield')
                select_cols.append('tv.market_cap as fund_market_cap')
                join_clauses.append('LEFT JOIN tab_valuation tv ON tv.symbol = s.ticker')

        if sector:
            where_clauses.append('s.sector = ?')
            params.append(sector)
        if min_mc > 0:
            where_clauses.append('COALESCE(s.market_cap, sf.market_cap, 0) >= ?')
            params.append(min_mc)
        if max_mc > 0:
            where_clauses.append('COALESCE(s.market_cap, sf.market_cap, 0) <= ?')
            params.append(max_mc)
        if min_pe > 0:
            where_clauses.append('COALESCE(sf.pe_ratio, tv.pe, 0) >= ?')
            params.append(min_pe)
        if max_pe > 0:
            where_clauses.append('COALESCE(sf.pe_ratio, tv.pe, 0) <= ?')
            params.append(max_pe)
        if min_div > 0:
            where_clauses.append('COALESCE(sf.dividend_yield, tv.dividend_yield, 0) >= ?')
            params.append(min_div)
        if min_vol > 0:
            where_clauses.append('COALESCE(s.volume, sdp.volume, 0) >= ?')
            params.append(min_vol)

        # Validate sort_by (whitelist to prevent SQL injection — Rule 56)
        valid_sorts = {'ticker', 'name_ar', 'sector', 'current_price', 'volume',
                       'market_cap', 'pe_ratio', 'pb_ratio', 'dividend_yield',
                       'latest_change_pct', 'latest_close'}
        if sort_by not in valid_sorts:
            sort_by = 'market_cap'
        sort_dir_final = 'DESC' if sort_dir == 'desc' else 'ASC'

        query = f"""
            SELECT {', '.join(select_cols)}
            FROM stocks s
            {(' '.join(join_clauses)) if join_clauses else ''}
            WHERE {' AND '.join(where_clauses)}
            ORDER BY {sort_by} {sort_dir_final} NULLS LAST
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])

        cur.execute(query, params)
        rows = [dict(r) for r in cur.fetchall()]

        # Also get total count for pagination
        count_query = f"""
            SELECT COUNT(*) as total
            FROM stocks s
            {(' '.join(join_clauses)) if join_clauses else ''}
            WHERE {' AND '.join(where_clauses)}
        """
        cur.execute(count_query, params[:-2])
        total = cur.fetchone()['total']

        conn.close()

        # Format results
        results = []
        for r in rows:
            results.append({
                'ticker': r.get('ticker', ''),
                'name_ar': r.get('name_ar') or r.get('name') or r.get('ticker'),
                'name': r.get('name', ''),
                'sector': r.get('sector', ''),
                'market': r.get('market', market),
                'current_price': float(r.get('current_price') or 0),
                'latest_close': float(r.get('latest_close') or 0),
                'volume': int(r.get('volume') or r.get('latest_volume') or 0),
                'market_cap': float(r.get('market_cap') or r.get('fund_market_cap') or 0),
                'pe_ratio': float(r.get('pe_ratio') or 0),
                'pb_ratio': float(r.get('pb_ratio') or 0),
                'dividend_yield': float(r.get('dividend_yield') or 0),
                'latest_change_pct': float(r.get('latest_change_pct') or 0),
            })

        return jsonify({
            'success': True,
            'results': results,
            'pagination': {
                'total': total,
                'limit': limit,
                'offset': offset,
                'has_more': (offset + limit) < total,
            },
            'filters': {
                'market': market, 'sector': sector,
                'min_market_cap': min_mc, 'max_market_cap': max_mc,
                'min_pe': min_pe, 'max_pe': max_pe,
                'min_dividend_yield': min_div, 'min_volume': min_vol,
                'sort_by': sort_by, 'sort_dir': sort_dir,
            },
            'source': 'python-canonical-finance-screener',
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': _tb.format_exc().splitlines()[-5:],
        }), 500


@misc_bp.route('/api/radar/accuracy', methods=['GET'])
def get_radar_accuracy():
    """GET /api/radar/accuracy — Rule 20 compliant radar accuracy endpoint.

    Replaces Node-side computation in radar/accuracy/route.ts (740 lines):
      - classifyRadarPath (5 radar paths classification)
      - computeWinRate (win_rate_pct calculation)
      - buildFromPredictionsTable (per-signal-type + per-market + monthly-trend)
      - buildFromRadarTrackingTable (fallback to radar_signal_tracking)

    Note: Paywall gating (applyAccuracyGate) stays in Node — that's auth/subscription
    logic which is allowed in Node per Rule 20 exception.

    Query params:
      - market (filter by market, default = all)
      - days (window, default 90, max 365)
    """
    try:
        market_filter = (request.args.get('market') or '').strip().upper() or None
        try:
            days = min(max(int(request.args.get('days', 90)), 7), 365)
        except (ValueError, TypeError):
            days = 90

        predictions_db = str(_Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
        if not os.path.exists(predictions_db):
            return jsonify({
                'success': True,
                'source': 'none',
                'total_signals': 0,
                'verified': 0,
                'pending': 0,
                'wins': 0,
                'losses': 0,
                'win_rate_pct': 0,
                'by_signal_type': [
                    {'signal_type': 'pre_surge', 'label': '🚀 Pre-Surge',
                     'total': 0, 'verified': 0, 'wins': 0, 'losses': 0, 'win_rate_pct': 0,
                     'avg_outcome_7d': None, 'avg_outcome_14d': None, 'avg_outcome_30d': None,
                     'avg_time_to_target_days': None},
                    {'signal_type': 'quiet_accumulation_strong', 'label': '🎯 تجميع قوي',
                     'total': 0, 'verified': 0, 'wins': 0, 'losses': 0, 'win_rate_pct': 0,
                     'avg_outcome_7d': None, 'avg_outcome_14d': None, 'avg_outcome_30d': None,
                     'avg_time_to_target_days': None},
                    {'signal_type': 'explosive_surge', 'label': '💥 انفجار حجمي',
                     'total': 0, 'verified': 0, 'wins': 0, 'losses': 0, 'win_rate_pct': 0,
                     'avg_outcome_7d': None, 'avg_outcome_14d': None, 'avg_outcome_30d': None,
                     'avg_time_to_target_days': None},
                    {'signal_type': 'early_break', 'label': '⚡ اختراق مبكر',
                     'total': 0, 'verified': 0, 'wins': 0, 'losses': 0, 'win_rate_pct': 0,
                     'avg_outcome_7d': None, 'avg_outcome_14d': None, 'avg_outcome_30d': None,
                     'avg_time_to_target_days': None},
                    {'signal_type': 'quiet_accumulation_weak', 'label': '🔍 تجميع ضعيف',
                     'total': 0, 'verified': 0, 'wins': 0, 'losses': 0, 'win_rate_pct': 0,
                     'avg_outcome_7d': None, 'avg_outcome_14d': None, 'avg_outcome_30d': None,
                     'avg_time_to_target_days': None},
                ],
                'by_market': [],
                'monthly_trend': [],
                'days': days,
                'served_at': _dt.now().isoformat(),
                'note': 'No predictions DB available — install db/predictions.db or run the prediction generator.',
            })

        conn = _sqlite3.connect(predictions_db, timeout=30.0)
        conn.row_factory = _sqlite3.Row
        cur = conn.cursor()

        # Check which tables exist
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        has_radar_tracking = 'radar_signal_tracking' in tables
        has_predictions = 'predictions' in tables

        if not has_radar_tracking and not has_predictions:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'No usable table found in predictions DB',
                'source': 'predictions_db',
            }), 500

        # RADAR_PATHS — mirror Node-side definitions
        radar_paths = [
            {'signal_type': 'pre_surge', 'label': '🚀 Pre-Surge',
             'matchers': ['pre_surge', 'pre-surge', 'presurge']},
            {'signal_type': 'quiet_accumulation_strong', 'label': '🎯 تجميع قوي',
             'matchers': ['quiet_strong', 'quiet_accumulation_strong', 'b_quiet']},
            {'signal_type': 'explosive_surge', 'label': '💥 انفجار حجمي',
             'matchers': ['explosive', 'd_explosive', 'explosive_surge']},
            {'signal_type': 'early_break', 'label': '⚡ اختراق مبكر',
             'matchers': ['early_break', 'e_early', 'early-break', 'breakout']},
            {'signal_type': 'quiet_accumulation_weak', 'label': '🔍 تجميع ضعيف',
             'matchers': ['quiet_weak', 'quiet_accumulation_weak', 'c_quiet']},
        ]

        def classify_radar_path(row: dict) -> str:
            """Classify a prediction row into a radar path."""
            signal_type = (str(row.get('signal_type') or '') + ' ' +
                           str(row.get('notes') or '') + ' ' +
                           str(row.get('explosive_label') or '')).lower()
            for p in radar_paths:
                for m in p['matchers']:
                    if m in signal_type:
                        return p['signal_type']
            return 'general'

        def compute_win_rate(wins: int, verified: int) -> float:
            if verified == 0:
                return 0.0
            return round((wins / verified) * 100, 1)

        def month_key(date_str):
            if not date_str:
                return None
            try:
                return str(date_str)[:7]  # YYYY-MM
            except Exception:
                return None

        if has_radar_tracking:
            # Use radar_signal_tracking table (preferred)
            cur.execute("""
                SELECT ticker, signal_type, signal_date, outcome_date, outcome,
                       hit_target, hit_stop, return_pct, market
                FROM radar_signal_tracking
                WHERE signal_date >= date('now', ?)
                ORDER BY signal_date DESC
            """, (f'-{days} days',))
            rows = [dict(r) for r in cur.fetchall()]
            source = 'predictions_db'
        else:
            # Fallback to predictions table
            where_clauses = ["prediction_date >= date('now', ?)"]
            params_list = [f'-{days} days']
            if market_filter:
                where_clauses.append('market = ?')
                params_list.append(market_filter)
            cur.execute(f"""
                SELECT ticker, signal, signal_type, prediction_date, outcome_date,
                       outcome, exit_price, return_pct, market, notes, explosive_label
                FROM predictions
                WHERE {' AND '.join(where_clauses)}
                ORDER BY prediction_date DESC
            """, params_list)
            rows = [dict(r) for r in cur.fetchall()]
            source = 'predictions_db'

        conn.close()

        # Aggregate by signal_type
        by_signal = {}
        by_market_map = {}
        by_month = {}
        total_signals = len(rows)
        verified = 0
        pending = 0
        wins = 0
        losses = 0

        for r in rows:
            sig_type = classify_radar_path(r) if not has_radar_tracking else (r.get('signal_type') or 'general')
            outcome = (r.get('outcome') or '').upper()
            market = r.get('market') or 'EGX'
            date_str = r.get('signal_date') or r.get('prediction_date')
            ret_pct = float(r.get('return_pct') or 0)

            if sig_type not in by_signal:
                by_signal[sig_type] = {
                    'signal_type': sig_type,
                    'total': 0, 'verified': 0, 'wins': 0, 'losses': 0,
                    'returns_7d': [], 'returns_14d': [], 'returns_30d': [],
                    'time_to_target': [],
                }
                # Find label from radar_paths
                for p in radar_paths:
                    if p['signal_type'] == sig_type:
                        by_signal[sig_type]['label'] = p['label']
                        break
                else:
                    by_signal[sig_type]['label'] = '📋 عام' if sig_type == 'general' else sig_type

            by_signal[sig_type]['total'] += 1

            # Per-market aggregation
            if market not in by_market_map:
                by_market_map[market] = {'total': 0, 'verified': 0, 'wins': 0}
            by_market_map[market]['total'] += 1

            # Per-month aggregation
            mk = month_key(date_str)
            if mk:
                if mk not in by_month:
                    by_month[mk] = {'total': 0, 'verified': 0, 'wins': 0}
                by_month[mk]['total'] += 1

            if outcome in ('WIN', 'TARGET_HIT', 'target_hit'):
                verified += 1
                wins += 1
                by_signal[sig_type]['verified'] += 1
                by_signal[sig_type]['wins'] += 1
                by_signal[sig_type]['returns_7d'].append(ret_pct)
                by_signal[sig_type]['returns_14d'].append(ret_pct)
                by_signal[sig_type]['returns_30d'].append(ret_pct)
                by_market_map[market]['verified'] += 1
                by_market_map[market]['wins'] += 1
                if mk:
                    by_month[mk]['verified'] += 1
                    by_month[mk]['wins'] += 1
            elif outcome in ('LOSS', 'STOP_HIT', 'stop_hit'):
                verified += 1
                losses += 1
                by_signal[sig_type]['verified'] += 1
                by_signal[sig_type]['losses'] += 1
                by_signal[sig_type]['returns_7d'].append(ret_pct)
                by_signal[sig_type]['returns_14d'].append(ret_pct)
                by_signal[sig_type]['returns_30d'].append(ret_pct)
                by_market_map[market]['verified'] += 1
                if mk:
                    by_month[mk]['verified'] += 1
            elif outcome in ('EXPIRED', 'expired'):
                verified += 1
                by_signal[sig_type]['verified'] += 1
                by_market_map[market]['verified'] += 1
                if mk:
                    by_month[mk]['verified'] += 1
            else:
                pending += 1

        # Format by_signal_type
        by_signal_type = []
        for p in radar_paths:
            sig = p['signal_type']
            if sig in by_signal:
                s = by_signal[sig]
                avg_7d = round(sum(s['returns_7d']) / len(s['returns_7d']), 2) if s['returns_7d'] else None
                avg_14d = round(sum(s['returns_14d']) / len(s['returns_14d']), 2) if s['returns_14d'] else None
                avg_30d = round(sum(s['returns_30d']) / len(s['returns_30d']), 2) if s['returns_30d'] else None
                by_signal_type.append({
                    'signal_type': sig,
                    'label': s['label'],
                    'total': s['total'],
                    'verified': s['verified'],
                    'wins': s['wins'],
                    'losses': s['losses'],
                    'win_rate_pct': compute_win_rate(s['wins'], s['verified']),
                    'avg_outcome_7d': avg_7d,
                    'avg_outcome_14d': avg_14d,
                    'avg_outcome_30d': avg_30d,
                    'avg_time_to_target_days': None,
                })

        by_market = [{
            'market': m,
            'total': v['total'],
            'verified': v['verified'],
            'wins': v['wins'],
            'win_rate_pct': compute_win_rate(v['wins'], v['verified']),
        } for m, v in sorted(by_market_map.items(), key=lambda x: -x[1]['total'])]

        monthly_trend = [{
            'month': mk,
            'total': v['total'],
            'verified': v['verified'],
            'wins': v['wins'],
            'win_rate_pct': compute_win_rate(v['wins'], v['verified']),
        } for mk, v in sorted(by_month.items())]

        return jsonify({
            'success': True,
            'source': source,
            'market': market_filter,
            'days': days,
            'total_signals': total_signals,
            'verified': verified,
            'pending': pending,
            'wins': wins,
            'losses': losses,
            'win_rate_pct': compute_win_rate(wins, verified),
            'by_signal_type': by_signal_type,
            'by_market': by_market,
            'monthly_trend': monthly_trend,
            'served_at': _dt.now().isoformat(),
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': _tb.format_exc().splitlines()[-5:],
        }), 500


# ════════════════════════════════════════════════════════════════════════
# RULE20-P1-FIX (2026-10-12): 4 NEW Python endpoints — replace Node-side
# computation that was violating Rule 20 (Python=brain, Node=display only).
#
# Routes being proxied:
#   1. /api/v4/stats                       ← v4/stats/route.ts (250 → ~55 lines proxy)
#   2. /api/admin/platform-performance     ← admin/platform-performance/route.ts (646 → ~70 lines proxy)
#   3. /api/predictions/performance-dashboard ← predictions/performance-dashboard/route.ts (334 → ~55 lines proxy)
#
# Note: /api/chart/<ticker> already exists in chart_routes.py (chart_bp).
# Rule 27 (NO-FAKE-DATA): NO placeholder zeros when DB is missing — return
# honest empty arrays/zero counts and explicit error notes only.
# Rule 67 (CALCULATION-CANONICAL): All math (win_rate, profit_factor, etc.)
# now lives in Python — Node just forwards.
# ════════════════════════════════════════════════════════════════════════


@misc_bp.route('/api/v4/stats', methods=['GET'])
def v4_stats():
    """GET /api/v4/stats — Rule 20 canonical endpoint.

    Replaces Node-side SQLite fallback in v4/stats/route.ts (250 lines).
    Reads from predictions.db.predictions and computes:
      - overall stats (total_predictions, wins, losses, pending, win_rate, avg_return)
      - by_signal breakdown
      - by_persona breakdown (count + win_rate per persona)
      - top_tickers (top 5 by prediction count, with win_rate)

    Response shape (mirrors the legacy Node response):
      {
        "success": true,
        "source": "python-canonical-v4-stats",
        "data": {
          "stats": {...},
          "by_persona": [...],
          "top_tickers": [...]
        },
        "generated_at": "..."
      }
    """
    try:
        from pathlib import Path as _Path
        predictions_db = str(_Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
        if not os.path.exists(predictions_db):
            return jsonify({
                'success': False,
                'error': 'predictions.db not found',
                'source': 'python-canonical-v4-stats',
            }), 500, {'Cache-Control': 'no-store, no-cache, must-revalidate'}

        with _open_db('predictions', predictions_db) as conn:
            # Overall aggregates
            overall = conn.execute("""
                SELECT
                    COUNT(*) AS total_predictions,
                    SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
                    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS pending,
                    AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
                FROM predictions
            """).fetchone()
            overall = dict(overall) if overall else {}

            total = int(overall.get('total_predictions') or 0)
            wins = int(overall.get('wins') or 0)
            losses = int(overall.get('losses') or 0)
            pending = int(overall.get('pending') or 0)
            closed = wins + losses
            win_rate = round((wins / closed) * 100, 2) if closed > 0 else 0
            avg_return = round(float(overall.get('avg_return') or 0), 2) if overall.get('avg_return') is not None else 0

            # by_signal
            by_signal_rows = conn.execute("""
                SELECT signal, COUNT(*) AS total
                FROM predictions
                GROUP BY signal
                ORDER BY total DESC
            """).fetchall()
            by_signal = [
                {'signal': str(r['signal'] or ''), 'total': int(r['total'])}
                for r in by_signal_rows
            ]

            # by_persona
            persona_rows = conn.execute("""
                SELECT
                    COALESCE(NULLIF(persona, ''), 'unspecified') AS persona,
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
                    AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
                FROM predictions
                GROUP BY COALESCE(NULLIF(persona, ''), 'unspecified')
                ORDER BY total DESC
            """).fetchall()
            by_persona = []
            for r in persona_rows:
                p_wins = int(r['wins'] or 0)
                p_losses = int(r['losses'] or 0)
                p_closed = p_wins + p_losses
                by_persona.append({
                    'persona': str(r['persona']),
                    'total': int(r['total']),
                    'wins': p_wins,
                    'losses': p_losses,
                    'win_rate': round((p_wins / p_closed) * 100, 2) if p_closed > 0 else 0,
                    'avg_return': round(float(r['avg_return']), 2) if r['avg_return'] is not None else 0,
                })

            # top_tickers (top 5 by total)
            ticker_rows = conn.execute("""
                SELECT
                    ticker,
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) AS losses,
                    AVG(CASE WHEN actual_return IS NOT NULL THEN actual_return END) AS avg_return
                FROM predictions
                GROUP BY ticker
                ORDER BY total DESC
                LIMIT 5
            """).fetchall()
            top_tickers = []
            for r in ticker_rows:
                t_wins = int(r['wins'] or 0)
                t_losses = int(r['losses'] or 0)
                t_closed = t_wins + t_losses
                top_tickers.append({
                    'ticker': str(r['ticker']),
                    'total': int(r['total']),
                    'wins': t_wins,
                    'losses': t_losses,
                    'win_rate': round((t_wins / t_closed) * 100, 2) if t_closed > 0 else 0,
                    'avg_return': round(float(r['avg_return']), 2) if r['avg_return'] is not None else 0,
                })

        return jsonify({
            'success': True,
            'source': 'python-canonical-v4-stats',
            'data': {
                'stats': {
                    'total_predictions': total,
                    'wins': wins,
                    'losses': losses,
                    'pending': pending,
                    'win_rate': win_rate,
                    'avg_return': avg_return,
                    'by_signal': by_signal,
                },
                'by_persona': by_persona,
                'top_tickers': top_tickers,
            },
            'generated_at': _dt.now().isoformat(),
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': _tb.format_exc().splitlines()[-5:],
            'source': 'python-canonical-v4-stats',
        }), 500


@misc_bp.route('/api/predictions/performance-dashboard', methods=['GET'])
def predictions_performance_dashboard():
    """GET /api/predictions/performance-dashboard — Rule 20 canonical endpoint.

    Replaces Node-side computation in predictions/performance-dashboard/route.ts
    (334 lines of SQLite + WIN_STATUSES classification + Math.round).

    Reads from predictions.db.predictions and computes:
      - overall stats (total, wins, losses, expired, pending, win_rate, avg_return)
      - by_market breakdown
      - by_signal breakdown
      - top_tickers (top 10, filtered to total >= 3)
      - timeseries (per-day for last N days)

    Query params:
      - days (default 30, max 365)
      - market (default EGX; 'all' = all markets)
    """
    try:
        from pathlib import Path as _Path
        from datetime import datetime as _dt2, timedelta as _td2

        days_raw = request.args.get('days', '30')
        try:
            days = max(1, min(365, int(days_raw)))
        except (ValueError, TypeError):
            days = 30
        market = (request.args.get('market') or 'EGX').upper()

        predictions_db = str(_Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
        if not os.path.exists(predictions_db):
            return jsonify({
                'success': False,
                'error': 'predictions.db not found',
                'source': 'python-canonical-performance-dashboard',
                'stats': {
                    'total': 0, 'resolved': 0, 'wins': 0, 'losses': 0,
                    'expired': 0, 'pending': 0, 'win_rate': 0,
                    'avg_return': 0, 'avg_holding_days': 0,
                },
                'by_market': [],
                'by_signal': [],
                'top_tickers': [],
                'timeseries': [],
            }), 500, {'Cache-Control': 'no-store, no-cache, must-revalidate'}

        cutoff_date = _dt2.now() - _td2(days=days)
        cutoff_str = cutoff_date.strftime('%Y-%m-%d')

        with _open_db('predictions', predictions_db) as conn:
            # Detect schema (signal vs signal_type column)
            cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
            has_signal = 'signal' in cols
            has_signal_type = 'signal_type' in cols
            signal_col = 'signal' if has_signal else ('signal_type' if has_signal_type else "'unknown'")

            if market == 'ALL' or not market:
                rows = conn.execute(f"""
                    SELECT ticker, {signal_col} AS signal, status, market,
                           prediction_date, actual_return, entry_price, target_price, stop_loss
                    FROM predictions
                    WHERE prediction_date IS NOT NULL AND prediction_date >= ?
                    ORDER BY prediction_date DESC
                    LIMIT 5000
                """, (cutoff_str,)).fetchall()
            else:
                rows = conn.execute(f"""
                    SELECT ticker, {signal_col} AS signal, status, market,
                           prediction_date, actual_return, entry_price, target_price, stop_loss
                    FROM predictions
                    WHERE (market = ? OR market IS NULL)
                      AND prediction_date IS NOT NULL AND prediction_date >= ?
                    ORDER BY prediction_date DESC
                    LIMIT 5000
                """, (market, cutoff_str)).fetchall()

            # Status classification sets (mirror Node)
            WIN_STATUSES = {'TARGET_HIT', 'closed_win', 'WIN', 'win'}
            LOSS_STATUSES = {'closed_stop', 'STOPPED', 'LOSS', 'loss'}
            EXPIRED_STATUSES = {'EXPIRED', 'expired', 'CLOSED'}

            def classify(status):
                s = (status or '').strip()
                if s in WIN_STATUSES:
                    return 'win'
                if s in LOSS_STATUSES:
                    return 'loss'
                if s in EXPIRED_STATUSES:
                    return 'expired'
                return 'pending'

            def safe_num(v):
                try:
                    n = float(v)
                    import math as _m
                    return n if _m.isfinite(n) else 0
                except (ValueError, TypeError):
                    return 0

            # Aggregate stats
            total = 0
            wins = 0
            losses = 0
            expired = 0
            pending = 0
            returns_sum = 0.0
            returns_count = 0
            by_market_map = {}
            by_signal_map = {}
            top_ticker_map = {}
            ts_map = {}

            for r in rows:
                r = dict(r)
                total += 1
                status = (r.get('status') or '').strip()
                ret = safe_num(r.get('actual_return'))
                if ret != 0:
                    returns_sum += ret
                    returns_count += 1

                bucket = classify(status)
                if bucket == 'win':
                    wins += 1
                elif bucket == 'loss':
                    losses += 1
                elif bucket == 'expired':
                    expired += 1
                else:
                    pending += 1

                # by_market
                m_key = (r.get('market') or 'unknown').strip() or 'unknown'
                bm = by_market_map.setdefault(m_key, {
                    'total': 0, 'wins': 0, 'losses': 0, 'expired': 0,
                    'returns_sum': 0.0, 'returns_count': 0,
                })
                bm['total'] += 1
                if ret != 0:
                    bm['returns_sum'] += ret
                    bm['returns_count'] += 1
                if bucket == 'win':
                    bm['wins'] += 1
                elif bucket == 'loss':
                    bm['losses'] += 1
                elif bucket == 'expired':
                    bm['expired'] += 1

                # by_signal
                sig_key = (r.get('signal') or 'unknown').strip() or 'unknown'
                bs = by_signal_map.setdefault(sig_key, {
                    'total': 0, 'wins': 0, 'losses': 0, 'expired': 0,
                    'returns_sum': 0.0, 'returns_count': 0,
                })
                bs['total'] += 1
                if ret != 0:
                    bs['returns_sum'] += ret
                    bs['returns_count'] += 1
                if bucket == 'win':
                    bs['wins'] += 1
                elif bucket == 'loss':
                    bs['losses'] += 1
                elif bucket == 'expired':
                    bs['expired'] += 1

                # top_tickers
                tk = (r.get('ticker') or '').strip()
                if tk:
                    tt = top_ticker_map.setdefault(tk, {
                        'total': 0, 'wins': 0, 'losses': 0,
                        'returns_sum': 0.0, 'returns_count': 0,
                    })
                    tt['total'] += 1
                    if ret != 0:
                        tt['returns_sum'] += ret
                        tt['returns_count'] += 1
                    if bucket == 'win':
                        tt['wins'] += 1
                    elif bucket == 'loss':
                        tt['losses'] += 1

                # timeseries
                pd = (r.get('prediction_date') or '')
                if pd:
                    d = str(pd)[:10]
                    if d >= cutoff_str:
                        ts = ts_map.setdefault(d, {'total': 0, 'wins': 0, 'losses': 0, 'expired': 0})
                        ts['total'] += 1
                        if bucket == 'win':
                            ts['wins'] += 1
                        elif bucket == 'loss':
                            ts['losses'] += 1
                        elif bucket == 'expired':
                            ts['expired'] += 1

        resolved = wins + losses
        stats = {
            'total': total,
            'resolved': resolved,
            'wins': wins,
            'losses': losses,
            'expired': expired,
            'pending': pending,
            'win_rate': round((wins / resolved) * 100, 2) if resolved > 0 else 0,
            'avg_return': round(returns_sum / returns_count, 4) if returns_count > 0 else 0,
            'avg_holding_days': 0,
        }

        by_market_list = []
        for mk, e in by_market_map.items():
            closed_m = e['wins'] + e['losses']
            by_market_list.append({
                'market': mk,
                'total': e['total'],
                'wins': e['wins'],
                'losses': e['losses'],
                'expired': e['expired'],
                'win_rate': round((e['wins'] / closed_m) * 100, 2) if closed_m > 0 else 0,
                'avg_return': round(e['returns_sum'] / e['returns_count'], 4) if e['returns_count'] > 0 else 0,
            })

        by_signal_list = []
        for sk, e in by_signal_map.items():
            closed_s = e['wins'] + e['losses']
            by_signal_list.append({
                'signal': sk,
                'total': e['total'],
                'wins': e['wins'],
                'losses': e['losses'],
                'expired': e['expired'],
                'win_rate': round((e['wins'] / closed_s) * 100, 2) if closed_s > 0 else 0,
                'avg_return': round(e['returns_sum'] / e['returns_count'], 4) if e['returns_count'] > 0 else 0,
            })

        top_tickers_list = []
        for tk, e in top_ticker_map.items():
            if e['total'] < 3:
                continue
            closed_t = e['wins'] + e['losses']
            top_tickers_list.append({
                'ticker': tk,
                'total': e['total'],
                'wins': e['wins'],
                'losses': e['losses'],
                'win_rate': round((e['wins'] / closed_t) * 100, 2) if closed_t > 0 else 0,
                'avg_return': round(e['returns_sum'] / e['returns_count'], 4) if e['returns_count'] > 0 else 0,
            })
        top_tickers_list.sort(key=lambda x: (-x['wins'], -x['win_rate']))
        top_tickers_list = top_tickers_list[:10]

        timeseries_list = []
        for d, e in ts_map.items():
            closed_d = e['wins'] + e['losses']
            timeseries_list.append({
                'date': d,
                'total': e['total'],
                'wins': e['wins'],
                'losses': e['losses'],
                'expired': e['expired'],
                'win_rate': round((e['wins'] / closed_d) * 100, 2) if closed_d > 0 else 0,
            })
        timeseries_list.sort(key=lambda x: x['date'])

        return jsonify({
            'success': True,
            'source': 'python-canonical-performance-dashboard',
            'market': market,
            'days': days,
            'filter': {
                'days': days,
                'market': market,
                'cutoff_date': cutoff_str,
            },
            'stats': stats,
            'by_market': by_market_list,
            'by_signal': by_signal_list,
            'top_tickers': top_tickers_list,
            'timeseries': timeseries_list,
            'generated_at': _dt.now().isoformat(),
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': _tb.format_exc().splitlines()[-5:],
            'source': 'python-canonical-performance-dashboard',
            'stats': {
                'total': 0, 'resolved': 0, 'wins': 0, 'losses': 0,
                'expired': 0, 'pending': 0, 'win_rate': 0,
                'avg_return': 0, 'avg_holding_days': 0,
            },
            'by_market': [],
            'by_signal': [],
            'top_tickers': [],
            'timeseries': [],
        }), 500


@misc_bp.route('/api/admin/platform-performance', methods=['GET'])
def admin_platform_performance():
    """GET /api/admin/platform-performance — Rule 20 canonical endpoint.

    Replaces Node-side computation in admin/platform-performance/route.ts
    (646 lines with KPIs: Win Rate + Profit Factor + Expectancy + Max Loss +
    TP1/Stop hit rates + by_channel + by_market + readiness box).

    Reads from predictions.db.predictions and applies the same logic:
      - HARD cap: ABS(actual_return) <= 50 (Constitution Rule 7)
      - MAX_RETURN_RATIO = 5.0 (suspicious if |exit/entry| > 5x)
      - Validation: entry_price > 0, ticker clean, dedup, market known
      - KPIs computed on valid + measured trades only

    Query params:
      - period: today | 7d | 30d | all (default 30d)
      - channel: all | balanced | morning_bell (default all)
      - market: all | <market_name> (default all)
      - min_return: threshold for "respectable trade" (default 8.0)

    Note: Admin auth gate is preserved in the Node route (Rule 20 exception).
    This Python endpoint does NOT re-check auth — Node is responsible for it.
    """
    try:
        from pathlib import Path as _Path
        from datetime import datetime as _dt2, timedelta as _td2
        import math as _math

        period = (request.args.get('period') or '30d').strip().lower()
        channel = (request.args.get('channel') or 'all').strip().lower()
        market_filter = (request.args.get('market') or 'all').strip()
        try:
            min_return = float(request.args.get('min_return') or '8.0')
        except (ValueError, TypeError):
            min_return = 8.0

        # Compute date range
        now = _dt2.now()
        date_from = None
        if period == 'today':
            date_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == '7d':
            date_from = now - _td2(days=7)
        elif period == '30d':
            date_from = now - _td2(days=30)
        # 'all' → date_from = None

        date_from_str = date_from.strftime('%Y-%m-%d') if date_from else None
        date_to_str = now.strftime('%Y-%m-%d')

        HARD_CAP = 50.0
        MAX_RETURN_RATIO = 5.0

        predictions_db = str(_Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
        if not os.path.exists(predictions_db):
            return jsonify({
                'success': False,
                'error': 'predictions.db not found',
                'source': 'python-canonical-platform-performance',
                'generated_at': now.isoformat(),
                'filters': {
                    'period': period, 'channel': channel,
                    'market': market_filter, 'min_return': min_return,
                    'date_from': date_from_str, 'date_to': date_to_str,
                },
                'kpis': None,
                'top_trades': [], 'worst_trades': [], 'target_hits': [],
                'by_channel': [], 'by_market': [],
                'excluded_examples': [], 'readiness': None,
                'data_sources': [], 'data_missing': ['predictions_db_missing'],
                'sample_note_ar': 'تعذر تحميل البيانات — predictions.db غير موجود',
            }), 500, {'Cache-Control': 'no-store, no-cache, must-revalidate'}

        with _open_db('predictions', predictions_db) as conn:
            sql = """
                SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
                       target_price, target_price_2, stop_loss, exit_price, actual_exit_price,
                       actual_return, hit_target, hit_stop, status, holding_days,
                       outcome_date, closed_at, highest_price, lowest_price, signal, market
                FROM predictions
                WHERE 1=1
            """
            params = []
            if date_from_str:
                sql += " AND prediction_date >= ?"
                params.append(date_from_str)
            if period != 'all':
                sql += " AND prediction_date <= ?"
                params.append(date_to_str)
            if channel == 'morning_bell':
                sql += " AND morning_bell = 1"
            elif channel == 'balanced':
                sql += " AND (morning_bell = 0 OR morning_bell IS NULL)"
            if market_filter != 'all':
                sql += " AND UPPER(market) = ?"
                params.append(market_filter.upper())
            sql += " ORDER BY prediction_date DESC"

            rows = conn.execute(sql, params).fetchall()

        # Helpers (mirror Node logic exactly)
        def safe_num(v):
            if v is None:
                return None
            try:
                n = float(v)
                return n if _math.isfinite(n) else None
            except (ValueError, TypeError):
                return None

        def compute_actual_return_raw(row):
            entry = safe_num(row.get('entry_price'))
            if not entry or entry <= 0:
                return {'ret': None, 'capped': False, 'suspicious': False}
            raw_ret = None
            exit_used = None
            ar = safe_num(row.get('actual_return'))
            if ar is not None and _math.isfinite(ar):
                raw_ret = ar
                exit_used = entry * (1 + ar / 100)
            if raw_ret is None:
                exit_price = safe_num(row.get('exit_price'))
                if exit_price is None:
                    exit_price = safe_num(row.get('actual_exit_price'))
                if exit_price is not None and exit_price > 0:
                    raw_ret = ((exit_price - entry) / entry) * 100
                    exit_used = exit_price
            if raw_ret is None:
                hit_target = int(row.get('hit_target') or 0)
                target = safe_num(row.get('target_price'))
                if hit_target == 1 and target is not None and target > 0:
                    raw_ret = ((target - entry) / entry) * 100
                    exit_used = target
            if raw_ret is None:
                hit_stop = int(row.get('hit_stop') or 0)
                stop = safe_num(row.get('stop_loss'))
                if hit_stop == 1 and stop is not None and stop > 0:
                    raw_ret = ((stop - entry) / entry) * 100
                    exit_used = stop
            if raw_ret is None:
                return {'ret': None, 'capped': False, 'suspicious': False}
            ratio = abs(exit_used / entry) if exit_used else 1
            suspicious = ratio > MAX_RETURN_RATIO
            capped = abs(raw_ret) > HARD_CAP
            ret = max(-HARD_CAP, min(HARD_CAP, raw_ret))
            return {'ret': ret, 'capped': capped, 'suspicious': suspicious}

        def validate_trade(row, seen_keys):
            ticker = (str(row.get('ticker') or '')).strip().upper()
            entry = safe_num(row.get('entry_price'))
            if not entry or entry <= 0:
                return {'valid': False, 'reason': 'entry_price_zero'}
            if not ticker or ' ' in ticker or len(ticker) > 12:
                return {'valid': False, 'reason': 'ticker_invalid'}
            persona = str(row.get('persona') or 'balanced')
            morning_bell = int(row.get('morning_bell') or 0)
            ch = 'morning_bell' if morning_bell == 1 else 'balanced'
            prediction_date = str(row.get('prediction_date') or '')
            dedup_key = f"{ticker}|{prediction_date}|{ch}|{entry:.4f}"
            if dedup_key in seen_keys:
                return {'valid': False, 'reason': 'duplicate'}
            seen_keys.add(dedup_key)
            market = str(row.get('market') or '').upper()
            if not market:
                return {'valid': False, 'reason': 'market_unknown'}
            return {'valid': True, 'reason': None}

        def compute_holding_days(row):
            hd = safe_num(row.get('holding_days'))
            if hd is not None and hd > 0:
                return int(round(hd))
            pred_date = row.get('prediction_date')
            outcome_date = row.get('outcome_date')
            closed_at = row.get('closed_at')
            end_date = outcome_date or closed_at
            if pred_date and end_date:
                try:
                    start = _dt2.fromisoformat(str(pred_date).replace('Z', ''))
                    end = _dt2.fromisoformat(str(end_date).replace('Z', ''))
                    days = (end - start).days
                    return days if days >= 0 else None
                except Exception:
                    return None
            return None

        # Build trades list
        seen_keys = set()
        trades = []
        for r in rows:
            r = dict(r)
            ret_info = compute_actual_return_raw(r)
            actual_return = ret_info['ret']
            capped = ret_info['capped']
            suspicious = ret_info['suspicious']
            is_morning_bell = int(r.get('morning_bell') or 0) == 1
            validation = validate_trade(r, seen_keys)
            valid = validation['valid']
            exclusion_reason = validation['reason']
            if valid and suspicious:
                valid = False
                exclusion_reason = 'exit_price_unrealistic'

            trades.append({
                'id': int(r.get('id') or 0),
                'ticker': str(r.get('ticker') or ''),
                'persona': r.get('persona') or 'balanced',
                'is_morning_bell': is_morning_bell,
                'channel': 'morning_bell' if is_morning_bell else 'balanced',
                'prediction_date': str(r.get('prediction_date') or ''),
                'entry_price': safe_num(r.get('entry_price')) or 0,
                'target_price': safe_num(r.get('target_price')),
                'target_price_2': safe_num(r.get('target_price_2')),
                'stop_loss': safe_num(r.get('stop_loss')),
                'exit_price': safe_num(r.get('exit_price')) or safe_num(r.get('actual_exit_price')),
                'actual_return': actual_return if actual_return is not None else 0,
                'hit_target': int(r.get('hit_target') or 0),
                'hit_stop': int(r.get('hit_stop') or 0),
                'status': str(r.get('status') or ''),
                'holding_days': compute_holding_days(r),
                'outcome_date': r.get('outcome_date'),
                'highest_price': safe_num(r.get('highest_price')),
                'lowest_price': safe_num(r.get('lowest_price')),
                'market': str(r.get('market') or 'UNKNOWN').upper(),
                'capped': capped,
                'valid': valid,
                'exclusion_reason': exclusion_reason,
            })

        # KPI computation
        def compute_kpis(all_trades):
            n_raw = len(all_trades)
            valid_trades = [t for t in all_trades if t['valid']]
            measured = [t for t in valid_trades if t['actual_return'] is not None and t['actual_return'] != 0]
            n_valid = len(measured)
            excluded = [t for t in all_trades if not t['valid']]
            n_open = sum(1 for t in all_trades if t['status'] in ('active', 'ACTIVE', 'PENDING'))

            exclusion_breakdown = {}
            for t in excluded:
                reason = t['exclusion_reason'] or 'unknown'
                exclusion_breakdown[reason] = exclusion_breakdown.get(reason, 0) + 1

            if n_valid == 0:
                return {
                    'n_raw': n_raw, 'n_valid': 0, 'n_excluded': len(excluded), 'n_open': n_open,
                    'win_rate': 0, 'profit_factor': 0, 'expectancy_pct': 0,
                    'avg_win_pct': 0, 'avg_loss_pct': 0, 'max_loss_pct': 0, 'max_win_pct': 0,
                    'tp1_hit_rate': 0, 'stop_hit_rate': 0, 'expired_rate': 0,
                    'hard_capped_count': 0, 'exclusion_breakdown': exclusion_breakdown,
                }

            wins = [t for t in measured if t['actual_return'] > 0]
            losses = [t for t in measured if t['actual_return'] < 0]
            expired = [t for t in all_trades if t['status'] == 'EXPIRED' and t['hit_target'] == 0 and t['hit_stop'] == 0]
            tp_hits = [t for t in valid_trades if t['hit_target'] == 1]
            stop_hits = [t for t in valid_trades if t['hit_stop'] == 1]
            hard_capped = [t for t in measured if t['capped']]

            gross_profit = sum(t['actual_return'] for t in wins)
            gross_loss_amount = sum(abs(t['actual_return']) for t in losses)
            if gross_loss_amount > 0:
                pf = gross_profit / gross_loss_amount
            elif gross_profit > 0:
                pf = 0  # Mirror Node: Infinity → 0 (avoid JSON serialization issues)
            else:
                pf = 0

            avg_win = gross_profit / len(wins) if wins else 0
            avg_loss = -(gross_loss_amount / len(losses)) if losses else 0
            expectancy = sum(t['actual_return'] for t in measured) / n_valid
            max_loss = min((t['actual_return'] for t in losses), default=0)
            max_win = max((t['actual_return'] for t in wins), default=0)

            return {
                'n_raw': n_raw, 'n_valid': n_valid, 'n_excluded': len(excluded), 'n_open': n_open,
                'win_rate': (len(wins) / n_valid) * 100,
                'profit_factor': pf,
                'expectancy_pct': expectancy,
                'avg_win_pct': avg_win,
                'avg_loss_pct': avg_loss,
                'max_loss_pct': max_loss,
                'max_win_pct': max_win,
                'tp1_hit_rate': (len(tp_hits) / len(valid_trades)) * 100 if valid_trades else 0,
                'stop_hit_rate': (len(stop_hits) / len(valid_trades)) * 100 if valid_trades else 0,
                'expired_rate': (len(expired) / n_raw) * 100 if n_raw > 0 else 0,
                'hard_capped_count': len(hard_capped),
                'exclusion_breakdown': exclusion_breakdown,
            }

        kpis = compute_kpis(trades)

        # by_channel
        by_channel = []
        for ch in ('balanced', 'morning_bell'):
            ch_trades = [t for t in trades if t['channel'] == ch]
            if not ch_trades:
                continue
            ch_kpis = compute_kpis(ch_trades)
            by_channel.append({
                'channel': ch,
                'n': ch_kpis['n_valid'],
                'win_rate': ch_kpis['win_rate'],
                'profit_factor': ch_kpis['profit_factor'],
                'expectancy_pct': ch_kpis['expectancy_pct'],
                'max_loss_pct': ch_kpis['max_loss_pct'],
            })

        # by_market
        by_market_list = []
        markets_seen = []
        for t in trades:
            if t['market'] and t['market'] not in markets_seen:
                markets_seen.append(t['market'])
        for mk in markets_seen:
            mk_trades = [t for t in trades if t['market'] == mk]
            if not mk_trades:
                continue
            mk_kpis = compute_kpis(mk_trades)
            by_market_list.append({
                'market': mk,
                'n_raw': mk_kpis['n_raw'],
                'n_valid': mk_kpis['n_valid'],
                'win_rate': mk_kpis['win_rate'],
                'profit_factor': mk_kpis['profit_factor'],
                'expectancy_pct': mk_kpis['expectancy_pct'],
                'max_loss_pct': mk_kpis['max_loss_pct'],
            })
        by_market_list.sort(key=lambda x: -x['n_valid'])

        # Readiness box
        n_sufficient = kpis['n_valid'] >= 30
        pf_passes = kpis['profit_factor'] >= 1.3
        max_loss_reasonable = kpis['max_loss_pct'] >= -20
        notes = []
        if not n_sufficient:
            notes.append(f"العينة صغيرة ({kpis['n_valid']} < 30) — النتائج غير حاسمة")
        if not pf_passes:
            notes.append(f"Profit Factor {round(kpis['profit_factor'], 2)} < 1.3 — الـ edge ضعيف")
        if not max_loss_reasonable:
            notes.append(f"Max Loss {round(kpis['max_loss_pct'], 1)}% خارج نطاق الوقف المعقول")
        candidate = n_sufficient and pf_passes and max_loss_reasonable
        readiness = {
            'n_sufficient': n_sufficient,
            'pf_passes': pf_passes,
            'max_loss_reasonable': max_loss_reasonable,
            'recommendation': 'candidate' if candidate else 'internal',
            'recommendation_ar': 'مرشح لنسخة عميل لاحقاً' if candidate else 'يبقى داخلي',
            'notes_ar': notes if notes else ['كل المؤشرات ضمن الحدود المعقولة'],
        }

        # Top/worst/target hits/excluded examples
        valid_measured = [t for t in trades if t['valid'] and t['actual_return'] is not None and t['actual_return'] != 0]
        top_trades = [t for t in valid_measured if t['actual_return'] >= min_return]
        top_trades.sort(key=lambda x: -x['actual_return'])
        top_trades = top_trades[:20]
        worst_trades = [t for t in valid_measured if t['actual_return'] < 0]
        worst_trades.sort(key=lambda x: x['actual_return'])
        worst_trades = worst_trades[:10]
        target_hits = [t for t in valid_measured if t['hit_target'] == 1]
        target_hits.sort(key=lambda x: -x['actual_return'])
        target_hits = target_hits[:20]
        excluded_examples = [t for t in trades if not t['valid']][:10]

        # Sample note
        sample_note = f"بيانات بعد فلتر الجودة: n={kpis['n_valid']} من أصل {kpis['n_raw']}"
        if kpis['n_excluded'] > 0:
            reasons = '، '.join(f"{v} {k}" for k, v in kpis['exclusion_breakdown'].items())
            sample_note += f" (مستبعد: {kpis['n_excluded']} — {reasons})"
        if kpis['n_valid'] < 30:
            sample_note += ". العينة أقل من 30 — النتائج إرشادية فقط."

        data_sources = ['predictions.db.predictions']
        data_missing = []
        if not trades:
            data_missing.append('no_predictions_in_period')

        return jsonify({
            'success': True,
            'source': 'python-canonical-platform-performance',
            'generated_at': now.isoformat(),
            'filters': {
                'period': period,
                'channel': channel,
                'market': market_filter,
                'min_return': min_return,
                'date_from': date_from_str,
                'date_to': date_to_str,
            },
            'kpis': kpis,
            'top_trades': top_trades,
            'worst_trades': worst_trades,
            'target_hits': target_hits,
            'by_channel': by_channel,
            'by_market': by_market_list,
            'excluded_examples': excluded_examples,
            'readiness': readiness,
            'data_sources': data_sources,
            'data_missing': data_missing,
            'sample_note_ar': sample_note,
        }, 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'})

    except Exception as e:
        import traceback as _tb
        return jsonify({
            'success': False,
            'error': f'فشل تحميل البيانات: {e}',
            'traceback': _tb.format_exc().splitlines()[-5:],
            'source': 'python-canonical-platform-performance',
            'generated_at': _dt.now().isoformat(),
            'filters': {
                'period': '30d', 'channel': 'all', 'market': 'all',
                'min_return': 8.0, 'date_from': None, 'date_to': None,
            },
            'kpis': None,
            'top_trades': [], 'worst_trades': [], 'target_hits': [],
            'by_channel': [], 'by_market': [],
            'excluded_examples': [], 'readiness': None,
            'data_sources': [], 'data_missing': ['query_error'],
            'sample_note_ar': 'تعذر تحميل البيانات',
        }), 500


# ============================================================================
# P2-FALLBACK-REMOVAL — New canonical Python endpoints
# ----------------------------------------------------------------------------
# Two new endpoints created to replace Node-side fallback chains that violated
# Rule 20 (Python = brain, Node = display only) + Rule 27 (NO-FAKE-DATA).
#
# 1. /api/fomo/missed-opportunities — top 5 winning closed predictions (FOMO)
# 2. /api/market/recommendations/ai-insights — top 20 active predictions
#    sorted by master_score (AI Insights panel)
#
# Both endpoints replicate the EXACT response shape the previous Node fallback
# returned so the Flutter frontend continues to work unchanged.
# ============================================================================


@misc_bp.route('/api/fomo/missed-opportunities', methods=['GET'])
def fomo_missed_opportunities():
    """GET /api/fomo/missed-opportunities — Rule 20 canonical endpoint.

    PAYWALL-043: FOMO Engine — الأرباح الفائتة.

    Replaces Node-side computation in fomo/missed-opportunities/route.ts
    (117 lines with direct SQLite reads via getPredictionsFallback + filtering
    + sorting + ticker obscuring + Arabic FOMO message construction).

    Reads from predictions.db.predictions and applies the same logic:
      - Filter: closed winning predictions (status='successful' OR
        hit_target=1 OR pnl_percent > 0 OR actual_return > 0)
      - Sort: by pnl_percent / actual_return DESC
      - Limit: top 5
      - Build FOMO message: "🔥 كان فيه N فرص بنسبة نجاح 100% بمكاسب تصل لـ X%..."

    The Node route applies the paywall gate (premium users see empty array)
    + obscures tickers (🔒) for non-premium users. This Python endpoint returns
    the RAW missed opportunities (with REAL tickers) — paywall enforcement is
    the Node route's responsibility (Rule 20 exception: auth/paywall gates).
    """
    try:
        from pathlib import Path as _P
        _root = _P(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')

        today_str = datetime.now().strftime('%Y-%m-%d')

        # Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
        with _open_db('predictions', _db) as conn:
            # Schema-aware: detect which columns exist (resilient to schema drift)
            try:
                _cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
            except Exception:
                _cols = set()

            # Build the SELECT with COALESCE for forward-compatibility
            _pnl_expr = 'COALESCE(pnl_percent, actual_return, 0)' if (
                'pnl_percent' in _cols and 'actual_return' in _cols
            ) else (
                'pnl_percent' if 'pnl_percent' in _cols else (
                    'actual_return' if 'actual_return' in _cols else '0'
                )
            )
            _outcome_expr = 'COALESCE(outcome_date, closed_at, prediction_date, created_at, "")'
            _master_expr = 'COALESCE(master_score, maestro_score, score, 0)' if (
                'maestro_score' in _cols and 'score' in _cols
            ) else (
                'COALESCE(master_score, maestro_score, 0)'
            )
            _holding_expr = 'COALESCE(holding_days, days_to_close, 0)' if (
                'days_to_close' in _cols
            ) else 'COALESCE(holding_days, 0)'

            # Filter: closed winning predictions
            # (status='successful' OR hit_target=1 OR pnl/actual_return > 0)
            _where_parts = []
            _where_args = []
            if 'status' in _cols:
                _where_parts.append("status = 'successful'")
            if 'hit_target' in _cols:
                _where_parts.append("hit_target = 1")
            _where_parts.append(f"CAST({_pnl_expr} AS REAL) > 0")
            _where_clause = ' OR '.join(f"({p})" for p in _where_parts)

            # Optional today filter: prefer today's wins, fall back to recent
            # (mirror the Node route's behavior: today's wins OR recent wins)
            _outcome_today_clause = ''
            if 'outcome_date' in _cols:
                _outcome_today_clause = f"AND (date(outcome_date) = date('now') OR outcome_date IS NOT NULL)"
            elif 'closed_at' in _cols:
                _outcome_today_clause = f"AND (date(closed_at) = date('now') OR closed_at IS NOT NULL)"

            sql = f"""
                SELECT ticker,
                       signal,
                       signal_ar,
                       signal_type,
                       prediction_date,
                       entry_price,
                       target_price,
                       stop_loss,
                       {_master_expr} AS master_score,
                       risk_reward,
                       persona,
                       status,
                       market,
                       confidence,
                       {_pnl_expr} AS profit_pct,
                       {_outcome_expr} AS outcome_date,
                       {_holding_expr} AS holding_days
                FROM predictions
                WHERE ({_where_clause})
                  {_outcome_today_clause}
                ORDER BY CAST({_pnl_expr} AS REAL) DESC
                LIMIT ?
            """
            _where_args.append(5)
            try:
                rows = conn.execute(sql, tuple(_where_args)).fetchall()
            except Exception as _qe:
                _logger.warning(f"[fomo:missed-opportunities] primary query failed: {_qe} — falling back to simpler query")
                # Fallback simpler query (no COALESCE chaining)
                _simple_sql = f"""
                    SELECT ticker, signal, signal_ar, signal_type, prediction_date,
                           entry_price, target_price, stop_loss, master_score,
                           risk_reward, persona, status, market, confidence,
                           COALESCE(pnl_percent, actual_return, 0) AS profit_pct,
                           COALESCE(outcome_date, closed_at, prediction_date, '') AS outcome_date,
                           COALESCE(holding_days, 0) AS holding_days
                    FROM predictions
                    WHERE (status = 'successful' OR hit_target = 1
                           OR COALESCE(pnl_percent, actual_return, 0) > 0)
                    ORDER BY COALESCE(pnl_percent, actual_return, 0) DESC
                    LIMIT ?
                """
                try:
                    rows = conn.execute(_simple_sql, (5,)).fetchall()
                except Exception as _qe2:
                    _logger.error(f"[fomo:missed-opportunities] fallback query also failed: {_qe2}")
                    rows = []

            missed = []
            for r in rows:
                d = dict(r)
                profit = float(d.get('profit_pct') or 0)
                missed.append({
                    'ticker': d.get('ticker') or '',
                    'signal': d.get('signal') or 'BUY',
                    'signal_ar': d.get('signal_ar') or '',
                    'entry_price': float(d.get('entry_price') or 0),
                    'target_price': float(d.get('target_price') or 0),
                    'stop_loss': float(d.get('stop_loss') or 0),
                    'risk_reward': float(d.get('risk_reward') or 0),
                    'master_score': float(d.get('master_score') or 0),
                    'confidence': float(d.get('confidence') or 0),
                    'persona': d.get('persona') or 'balanced',
                    'status': d.get('status') or 'successful',
                    'market': d.get('market') or 'EGX',
                    'prediction_date': d.get('prediction_date') or '',
                    'outcome_date': d.get('outcome_date') or '',
                    'profit_pct': round(profit, 2),
                    'holding_days': int(d.get('holding_days') or 0),
                })

        # Compute max_gain_pct
        max_gain = max((m['profit_pct'] for m in missed), default=0.0)

        # Build FOMO message (Arabic)
        if missed:
            message = (
                f"🔥 كان فيه {len(missed)} فرص بنسبة نجاح 100% "
                f"بمكاسب تصل لـ {max_gain:.1f}%. "
                f"اشترك الآن لتلقي فرص قادمة."
            )
        else:
            message = ''

        return jsonify({
            'success': True,
            'source': 'python-canonical-fomo-missed-opportunities',
            'is_premium': False,  # Node route will overwrite after paywall check
            'missed_count': len(missed),
            'missed_opportunities': missed,
            'max_gain_pct': round(max_gain, 1),
            'message': message,
            'generated_at': datetime.now().isoformat(),
        }), 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'}

    except Exception as e:
        import traceback as _tb
        _logger.error(f"[fomo:missed-opportunities] ERROR: {e}\n{_tb.format_exc()}")
        return jsonify({
            'success': False,
            'error': f'python-fomo-internal-error: {e}',
            'source': 'python-canonical-fomo-missed-opportunities',
            'is_premium': False,
            'missed_count': 0,
            'missed_opportunities': [],
            'max_gain_pct': 0,
            'message': '',
        }), 500


@misc_bp.route('/api/market/recommendations/ai-insights', methods=['GET'])
def market_recommendations_ai_insights():
    """GET /api/market/recommendations/ai-insights — Rule 20 canonical endpoint.

    Replaces Node-side computation in market/recommendations/ai-insights/route.ts
    (65 lines with direct SQLite reads via getPredictionsFallback + filtering
    + sorting by master_score DESC + mapping into ai_insights shape).

    Reads from predictions.db.predictions (active predictions) and applies
    the same logic:
      - Filter: status='active' (or PENDING for legacy schema) + master_score NOT NULL
      - Sort: by master_score DESC
      - Limit: top 20

    Returns the SAME response shape the Node route returned:
      {
        success: bool,
        source: 'python-canonical-ai-insights',
        ai_insights: [...],     # primary key (Flutter expects this)
        insights: [...],        # alias for compatibility
        recommendations: [...], # alias for compatibility
        count: int,
        timestamp: ISO8601
      }
    """
    try:
        from pathlib import Path as _P
        _root = _P(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'predictions.db')

        with _open_db('predictions', _db) as conn:
            # Schema-aware: detect which columns exist
            try:
                _cols = {r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()}
            except Exception:
                _cols = set()

            _master_expr = 'COALESCE(master_score, maestro_score, score, 0)' if (
                'maestro_score' in _cols and 'score' in _cols
            ) else 'COALESCE(master_score, maestro_score, 0)'

            # Active predictions filter: status='active' OR status='PENDING'
            # (predictions.db uses 'active' in newer rows + 'PENDING' in legacy)
            _status_filter = "status IN ('active', 'PENDING', 'Active')"
            if 'status' not in _cols:
                # No status column → fall back to outcome_date IS NULL (active)
                _status_filter = "(outcome_date IS NULL OR outcome_date = '')" if 'outcome_date' in _cols else "1=1"

            sql = f"""
                SELECT ticker,
                       signal,
                       signal_ar,
                       signal_type,
                       prediction_date,
                       entry_price,
                       target_price,
                       stop_loss,
                       {_master_expr} AS master_score,
                       risk_reward,
                       persona,
                       status,
                       market,
                       confidence
                FROM predictions
                WHERE {_status_filter}
                  AND {_master_expr} IS NOT NULL
                  AND CAST({_master_expr} AS REAL) > 0
                ORDER BY CAST({_master_expr} AS REAL) DESC
                LIMIT ?
            """
            try:
                rows = conn.execute(sql, (20,)).fetchall()
            except Exception as _qe:
                _logger.warning(f"[ai-insights] primary query failed: {_qe}")
                # Simpler fallback
                _simple_sql = """
                    SELECT ticker, signal, signal_ar, signal_type, prediction_date,
                           entry_price, target_price, stop_loss, master_score,
                           risk_reward, persona, status, market, confidence
                    FROM predictions
                    WHERE status IN ('active', 'PENDING', 'Active')
                      AND master_score IS NOT NULL
                    ORDER BY master_score DESC
                    LIMIT ?
                """
                try:
                    rows = conn.execute(_simple_sql, (20,)).fetchall()
                except Exception as _qe2:
                    _logger.error(f"[ai-insights] fallback query failed: {_qe2}")
                    rows = []

            insights = []
            for r in rows:
                d = dict(r)
                insights.append({
                    'ticker': d.get('ticker') or '',
                    'signal': d.get('signal') or 'BUY',
                    'signal_ar': d.get('signal_ar') or '',
                    'entry_price': float(d.get('entry_price') or 0),
                    'target_price': float(d.get('target_price') or 0),
                    'stop_loss': float(d.get('stop_loss') or 0),
                    'risk_reward': float(d.get('risk_reward') or 0),
                    'master_score': float(d.get('master_score') or 0),
                    'confidence': float(d.get('confidence') or 0),
                    'persona': d.get('persona') or 'balanced',
                    'status': d.get('status') or 'active',
                    'prediction_date': d.get('prediction_date') or '',
                })

        return jsonify({
            'success': True,
            'source': 'python-canonical-ai-insights',
            'ai_insights': insights,
            'insights': insights,
            'recommendations': insights,
            'count': len(insights),
            'timestamp': datetime.now().isoformat(),
        }), 200, {'Cache-Control': 'no-store, no-cache, must-revalidate'}

    except Exception as e:
        import traceback as _tb
        _logger.error(f"[ai-insights] ERROR: {e}\n{_tb.format_exc()}")
        return jsonify({
            'success': False,
            'error': f'python-ai-insights-internal-error: {e}',
            'source': 'python-canonical-ai-insights',
            'ai_insights': [],
            'insights': [],
            'recommendations': [],
            'count': 0,
            'timestamp': datetime.now().isoformat(),
        }), 500
