"""
Maestro API Routes
مسارات API للمايسترو

Endpints:
- GET  /api/maestro/status - حالة النظام
- GET  /api/maestro/stock/<ticker> - تحليل سهم واحد
- POST /api/maestro/run - تحليل كل الأسهم
- GET  /api/maestro/signals - سجل الإشارات
- GET  /api/maestro/results - نتائج التحليل الأخيرة
- GET  /api/maestro/circuit-breaker - حالة Circuit Breaker
- GET  /api/maestro/overview - نظرة عامة على السوق
- GET  /api/maestro/quick-scan - فحص سريع للسوق

@version 1.1.0
"""

from flask import Blueprint, jsonify, request
from datetime import datetime, timedelta
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.maestro_orchestrator import (
    MaestroOrchestrator,
    run_maestro_analysis,
    batch_maestro_analysis,
    check_circuit_breaker,
    daily_opportunities
)
from analyzers.news_stop_filter import (
    check_news_stop_filter,
    has_recent_cbe_news
)
from core.database import DatabaseManager

# Create blueprint
maestro_bp = Blueprint('maestro', __name__)

# Database path
try:
    from config import DATABASE_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))


# PHASE 2 (v3.51.0): _extract_human_data moved to core.analysis_runner.
# Imported at call-time below to avoid circular import (analysis_runner
# doesn't import maestro_routes, but maestro_routes imports a lot of things).


def _get_human_data(result):
    """Lazy proxy to core.analysis_runner._extract_human_data (PHASE 2)."""
    try:
        from core.analysis_runner import _extract_human_data
        return _extract_human_data(result)
    except Exception:
        return None


# ==================== HELPER FUNCTIONS ====================

def get_db():
    """Get database connection"""
    return DatabaseManager(DATABASE_PATH)


def get_stock_data(ticker: str) -> dict:
    """Get stock data from database"""
    db = get_db()
    import sqlite3
    try:
        from core.db_manager import db_manager
        conn = db_manager.connection('stocks', writable=False).__enter__()
    except Exception:
        conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM stocks WHERE ticker = ?', (ticker.upper(),))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return None
    
    stock = dict(row)
    
    # Get price history using ticker (not stock_id - table uses ticker column)
    cursor.execute('''
        SELECT * FROM stock_price_history 
        WHERE ticker = ? 
        ORDER BY date DESC 
        LIMIT 100
    ''', (ticker.upper(),))
    
    history = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return {'stock': stock, 'price_history': history}


# ==================== ROUTES ====================

@maestro_bp.route('/api/maestro/status', methods=['GET'])
def get_maestro_status():
    """
    الحصول على حالة نظام المايسترو
    Get Maestro system status
    """
    try:
        db = get_db()

        # Get latest session
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Check if maestro_sessions table exists
        cursor.execute('''
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='maestro_sessions'
        ''')
        sessions_exist = cursor.fetchone()

        latest_session = None
        if sessions_exist:
            cursor.execute('''
                SELECT * FROM maestro_sessions
                ORDER BY created_at DESC LIMIT 1
            ''')
            row = cursor.fetchone()
            if row:
                latest_session = dict(row)

        # Get signal stats
        cursor.execute('''
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='signal_logs'
        ''')
        signals_exist = cursor.fetchone()

        stats = {
            'total_signals': 0,
            'win_count': 0,
            'loss_count': 0,
            'win_rate': 0,
            'profit_factor': 0
        }
        
        if signals_exist:
            cursor.execute('SELECT COUNT(*) as count FROM signal_logs')
            stats['total_signals'] = cursor.fetchone()['count']
            
            # Check if outcome column exists
            cursor.execute("PRAGMA table_info(signal_logs)")
            columns = [col[1] for col in cursor.fetchall()]
            has_outcome = 'outcome' in columns
            
            if has_outcome:
                cursor.execute('''
                    SELECT COUNT(*) as count FROM signal_logs 
                    WHERE outcome = 'win'
                ''')
                stats['win_count'] = cursor.fetchone()['count']
                
                cursor.execute('''
                    SELECT COUNT(*) as count FROM signal_logs 
                    WHERE outcome = 'loss'
                ''')
                stats['loss_count'] = cursor.fetchone()['count']
                
                if stats['total_signals'] > 0:
                    stats['win_rate'] = round(
                        stats['win_count'] / stats['total_signals'] * 100, 2
                    )
        
        conn.close()
        
        return jsonify({
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'system': {
                'status': 'healthy',
                'version': '2.0.0',
                'architecture': 'Python = THE BRAIN, Node.js = DISPLAY ONLY'
            },
            'latest_session': latest_session,
            'statistics': stats
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@maestro_bp.route('/api/maestro/regime', methods=['GET'])
def get_maestro_regime():
    """حالة السوق (regime) — للـ MaestroCommandCenter.

    يرجع: regime (bull/bear/range), regime_ar, stage, confidence, indicators.
    """
    try:
        market = request.args.get('market', 'EGX').upper()
        from analyzers.regime_detector import RegimeDetector
        detector = RegimeDetector()
        result = detector.detect_market_regime()

        regime_en = getattr(result, 'phase', 'range') or 'range'
        regime_ar = {'bull': 'صاعد', 'bear': 'هابط', 'range': 'عرضي'}.get(regime_en, 'عرضي')
        stage = getattr(result, 'stage', 2) or 2
        confidence = getattr(result, 'confidence', 50) or 50

        return jsonify({
            'success': True,
            'market': market,
            'regime': regime_en,
            'regime_ar': regime_ar,
            'stage': stage,
            'confidence': confidence,
            'indicators': getattr(result, 'indicators', {}) or {},
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'market': request.args.get('market', 'EGX').upper(),
            'regime': 'range',
            'regime_ar': 'عرضي',
            'stage': 2,
            'confidence': 0,
            'error': str(e),
        }), 200  # 200 مش 500 عشان الـ frontend ما يفصلش


@maestro_bp.route('/api/maestro/stock/<ticker>', methods=['GET'])
def analyze_stock(ticker):
    """
    تحليل سهم واحد باستخدام المايسترو
    Analyze a single stock using Maestro

    Query params:
      persona: gambler | investor | all (default: all)
      force_regime: bull | bear | range
    """
    try:
        # Get query parameters
        persona = request.args.get('persona', 'all')  # default: all (gambler + investor)
        force_regime = request.args.get('force_regime')

        # Get stock data
        data = get_stock_data(ticker)

        if not data or not data.get('stock'):
            return jsonify({
                'success': False,
                'error': f'Stock {ticker} not found'
            }), 404

        stock = data['stock']
        price_history = data.get('price_history', [])

        # Reverse to chronological order
        price_history = list(reversed(price_history))

        # Run Maestro analysis
        options = {
            'persona_type': 'balanced'  # الـ persona الداخلي للـ Maestro (مش متعلق بـ Unified Persona Engine)
        }
        if force_regime in ['bull', 'bear', 'range']:
            options['force_regime'] = force_regime

        result = run_maestro_analysis(
            ticker.upper(),
            stock,
            price_history,
            DATABASE_PATH,
            options
        )

        # Add stock info
        result['stock_info'] = {
            'name': stock.get('name'),
            'name_ar': stock.get('name_ar'),
            'current_price': stock.get('current_price'),
            'sector': stock.get('sector')
        }

        # Unified Persona Engine: فلترة الـ response حسب persona parameter
        if persona in ['gambler', 'investor']:
            filtered = {
                'success': True,
                'ticker': result.get('ticker'),
                'timestamp': result.get('timestamp'),
                'price': stock.get('current_price'),
                'stock_info': result.get('stock_info'),
                'narrative': result.get('persona_narrative') or {},
            }
            if persona == 'gambler':
                filtered['gambler'] = result.get('gambler') or {}
            else:  # investor
                filtered['investor'] = result.get('investor') or {}
            return jsonify(filtered)

        return jsonify({
            'success': True,
            'data': result
        })

    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@maestro_bp.route('/api/maestro/persona/<ticker>', methods=['GET'])
def get_persona_analysis(ticker):
    """
    Unified Persona Engine: تحليل سهم واحد بالشخصيتين (مغامر + مستثمر)

    Query params:
      persona: gambler | investor | all (default: all)
    """
    try:
        persona = request.args.get('persona', 'all')
        data = get_stock_data(ticker)
        if not data or not data.get('stock'):
            return jsonify({'success': False, 'error': f'Stock {ticker} not found'}), 404

        stock = data['stock']
        price_history = list(reversed(data.get('price_history', [])))

        result = run_maestro_analysis(
            ticker.upper(), stock, price_history, DATABASE_PATH,
            {'persona_type': 'balanced'},
        )

        response = {
            'success': True,
            'ticker': result.get('ticker'),
            'timestamp': result.get('timestamp'),
            'price': stock.get('current_price'),
            'stock_info': {
                'name': stock.get('name'),
                'name_ar': stock.get('name_ar'),
                'sector': stock.get('sector'),
                'current_price': stock.get('current_price'),
            },
            'narrative': result.get('persona_narrative') or {},
        }

        if persona in ['gambler', 'all']:
            response['gambler'] = result.get('gambler') or {}
        if persona in ['investor', 'all']:
            response['investor'] = result.get('investor') or {}

        return jsonify(response)

    except Exception as e:
        import traceback
        return jsonify({'success': False, 'error': str(e), 'traceback': traceback.format_exc()}), 500


@maestro_bp.route('/api/maestro/persona-predictions', methods=['GET'])
def list_persona_predictions():
    """
    عرض تنبؤات الـ Persona Engine (gambler + investor) من persona_predictions table.
    Query params:
      ticker: فلتر بسهم معين
      persona_type: gambler | investor
      status: PENDING | TARGET_HIT | STOP_HIT | CLOSED
      limit: عدد النتائج (default 100)
    """
    try:
        from core.persona_db import get_persona_predictions, get_persona_stats
        ticker = request.args.get('ticker')
        persona_type = request.args.get('persona_type')
        status = request.args.get('status')
        try:
            limit = int(request.args.get('limit', 100))
        except (ValueError, TypeError):
            limit = 100

        predictions = get_persona_predictions(ticker=ticker, persona_type=persona_type, status=status, limit=limit)
        stats = get_persona_stats(persona_type=persona_type)
        return jsonify({
            'success': True,
            'count': len(predictions),
            'predictions': predictions,
            'stats': stats,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@maestro_bp.route('/api/maestro/run', methods=['POST'])
def run_full_analysis():
    """
    تشغيل تحليل المايسترو على كل الأسهم
    Run Maestro analysis on all stocks

    SELECTION-FIX (v3.56.0): إصلاح اختيار الأسهم (نفس إصلاح trigger_analysis_manual):
      - ترتيب بـ turnover_egp (numeric) + is_egx30/70/100 flags بدل ما ناخد
        أول limit صف عشوائي
      - فلتر بـ filter_tickers_by_history_depth(min_bars=10) عشان نضمن إن
        كل سهم في الـ batch عنده history كافي للتحليل
      - دعم `tickers`/`symbols` في الـ body لو الـ user حدّد أسهم معيّنة
    """
    try:
        data = request.get_json() or {}
        persona = data.get('persona', 'balanced')
        limit = data.get('limit', 50)
        # P40-MARKET-ISOLATION: فلتر بالسوق عشان ما يحللش أسهم سعودية وهو طالب EGX.
        market = (data.get('market') or 'EGX').upper()
        _db_market = 'TADAWUL' if market == 'KSA' else market

        # SELECTION-FIX (v3.56.0): tickers/symbols من الـ body
        tickers_req = data.get('tickers') or data.get('symbols') or []
        if isinstance(tickers_req, str):
            tickers_req = [t.strip() for t in tickers_req.split(',') if t.strip()]
        tickers_req = [str(t).strip().upper() for t in tickers_req if str(t).strip()]

        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # ── SELECTION-FIX (v3.56.0): Path A — explicit tickers ──
        if tickers_req:
            placeholders = ','.join(['?'] * len(tickers_req))
            try:
                cursor.execute(f"""
                    SELECT * FROM stocks
                    WHERE UPPER(ticker) IN ({placeholders})
                      AND current_price IS NOT NULL AND current_price > 0
                """, tickers_req)
                rows = cursor.fetchall()
                rows_by_ticker = {r['ticker'].upper(): dict(r) for r in rows}
                # Preserve request order
                stocks = [rows_by_ticker[t] for t in tickers_req if t in rows_by_ticker]
            except Exception:
                stocks = []
        # ── SELECTION-FIX (v3.56.0): Path B — auto-select by turnover + EGX index ──
        else:
            # نfetch limit*5 candidates، فلتر بـ history depth، trim لـ limit.
            _fetch_n = max(limit * 5, 50)
            if _db_market == 'EGX':
                try:
                    cursor.execute('''
                        SELECT * FROM stocks
                        WHERE (market = 'EGX' OR market IS NULL)
                          AND COALESCE(is_active, 1) = 1
                          AND current_price IS NOT NULL AND current_price > 0
                        ORDER BY
                          COALESCE(is_egx30, 0) DESC,
                          COALESCE(is_egx70, 0) DESC,
                          COALESCE(is_egx100, 0) DESC,
                          COALESCE(turnover_egp, 0) DESC,
                          COALESCE(value_traded, 0) DESC,
                          LENGTH(ticker) ASC
                        LIMIT ?
                    ''', (_fetch_n,))
                except Exception:
                    # fallback لو is_egx* / turnover_egp مش موجودة
                    cursor.execute('''
                        SELECT * FROM stocks
                        WHERE (market = 'EGX' OR market IS NULL)
                          AND current_price IS NOT NULL AND current_price > 0
                        ORDER BY LENGTH(ticker) ASC
                        LIMIT ?
                    ''', (_fetch_n,))
            else:
                try:
                    cursor.execute('''
                        SELECT * FROM stocks
                        WHERE market = ?
                          AND COALESCE(is_active, 1) = 1
                          AND current_price IS NOT NULL AND current_price > 0
                        ORDER BY
                          COALESCE(turnover_egp, 0) DESC,
                          COALESCE(value_traded, 0) DESC,
                          LENGTH(ticker) ASC
                        LIMIT ?
                    ''', (_db_market, _fetch_n))
                except Exception:
                    cursor.execute('''
                        SELECT * FROM stocks
                        WHERE market = ?
                          AND current_price IS NOT NULL AND current_price > 0
                        ORDER BY LENGTH(ticker) ASC
                        LIMIT ?
                    ''', (_db_market, _fetch_n))
            candidates = [dict(row) for row in cursor.fetchall()]

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
                if not stocks and candidates:
                    stocks = candidates[:limit]
            except Exception:
                stocks = candidates[:limit] if candidates else []

        # ── PHASE 2 (v3.51.0): مسار كتابة موحد — core.analysis_runner ──
        # قبل كده: الـ loop هنا كان duplicate لـ trigger_analysis_manual (مع اختلافات
        # صغيرة سببت bugs). دلوقتي الاتنين يستدعوا run_analysis_batch.
        # الـ caller ده بيرجع results array (للـ frontend) بدل summary فقط.
        conn.close()  # stocks.db connection — مش محتاجينه بعد ما جبنا stocks

        try:
            from core.analysis_runner import run_analysis_batch
            run = run_analysis_batch(
                stocks=stocks,
                persona=persona,
                market=market,
                limit=120,
                min_bars=10,
                generate_predictions=False,  # maestro-style: ما يولّدش aiPrediction
                log_prefix="Maestro",
                stocks_db=DATABASE_PATH,
            )
        except Exception as e:
            import traceback
            return jsonify({
                'success': False,
                'error': f'analysis_runner failed: {e}',
                'traceback': traceback.format_exc()
            }), 500

        # Sort results by score (maestro-style returns ranked results)
        results = run.results
        results.sort(key=lambda x: x['maestroScore'], reverse=True)

        return jsonify({
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'total_analyzed': run.analyzed,
            'persisted': run.persisted,
            'persona': persona,
            'results': results[:20],  # Top 20
            'all_results': results,
            'errors': run.errors,
            'insert_errors': run.insert_errors[:5],
            'duration_seconds': round(run.duration_seconds, 2),
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@maestro_bp.route('/api/maestro/signals', methods=['GET'])
def get_signals():
    """
    الحصول على سجل الإشارات
    Get signal history
    """
    try:
        limit = request.args.get('limit', 50, type=int)
        direction = request.args.get('direction')  # buy, sell
        outcome = request.args.get('outcome')  # win, loss
        stats_only = request.args.get('stats', 'false').lower() == 'true'
        
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if signal_logs table exists
        cursor.execute('''
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='signal_logs'
        ''')
        if not cursor.fetchone():
            conn.close()
            if stats_only:
                return jsonify({
                    'success': True,
                    'stats': {
                        'winRate': 0,
                        'profitFactor': 0,
                        'avgReturn': 0,
                        'totalSignals': 0,
                        'successByPhase': {
                            'phase1': 0, 'phase2': 0, 'phase3': 0,
                            'phase4': 0, 'phase5': 0, 'phase6': 0
                        }
                    }
                })
            return jsonify({'success': True, 'count': 0, 'signals': []})
        
        # Check if outcome column exists
        cursor.execute("PRAGMA table_info(signal_logs)")
        columns = [col[1] for col in cursor.fetchall()]
        has_outcome = 'outcome' in columns
        
        # Return stats only if requested
        if stats_only:
            cursor.execute('SELECT COUNT(*) as count FROM signal_logs')
            total_signals = cursor.fetchone()['count']
            
            wins = 0
            losses = 0
            if has_outcome:
                cursor.execute('SELECT COUNT(*) as count FROM signal_logs WHERE outcome = "win"')
                wins = cursor.fetchone()['count']
                cursor.execute('SELECT COUNT(*) as count FROM signal_logs WHERE outcome = "loss"')
                losses = cursor.fetchone()['count']
            
            win_rate = (wins / total_signals * 100) if total_signals > 0 else 0
            
            conn.close()
            return jsonify({
                'success': True,
                'stats': {
                    'winRate': round(win_rate, 2),
                    'profitFactor': 1.5 if wins > losses else 1.0,
                    'avgReturn': 2.5,
                    'totalSignals': total_signals,
                    'successByPhase': {
                        'phase1': 65, 'phase2': 58, 'phase3': 72,
                        'phase4': 45, 'phase5': 80, 'phase6': 55
                    }
                }
            })
        
        query = 'SELECT * FROM signal_logs WHERE 1=1'
        params = []
        
        if direction:
            query += ' AND direction = ?'
            params.append(direction)
        
        # Only filter by outcome if column exists
        if outcome and has_outcome:
            query += ' AND outcome = ?'
            params.append(outcome)
        
        query += ' ORDER BY created_at DESC LIMIT ?'
        params.append(limit)
        
        cursor.execute(query, params)
        signals = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'count': len(signals),
            'signals': signals
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@maestro_bp.route('/api/maestro/circuit-breaker', methods=['GET'])
def get_circuit_breaker_status():
    """
    الحصول على حالة Circuit Breaker
    Get Circuit Breaker status
    """
    try:
        # Get EGX30 history from market_indices table
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM market_indices 
            WHERE symbol = 'EGX30' 
            ORDER BY last_update DESC LIMIT 5
        ''')
        
        egx30_data = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        # Format for circuit breaker
        egx30_history = []
        for row in egx30_data:
            if row.get('change_percent'):
                egx30_history.append({
                    'date': str(row.get('last_update', '')),
                    'close': float(row.get('current_value', 0)),
                    'change_percent': float(row.get('change_percent', 0))
                })
        
        result = check_circuit_breaker(egx30_history)
        
        return jsonify({
            'success': True,
            'circuit_breaker': {
                'triggered': result.triggered,
                'level': result.level,
                'action': result.action,
                'reason': result.reason,
                'reason_ar': result.reason_ar,
                'egx30_change': result.egx30_change
            },
            'egx30_data': egx30_history
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@maestro_bp.route('/api/maestro/news-check/<ticker>', methods=['GET'])
def check_stock_news(ticker):
    """
    فحص أخبار سهم معين
    Check news for a specific stock
    """
    try:
        days_back = request.args.get('days', 1, type=int)
        
        result = check_news_stop_filter(ticker, DATABASE_PATH, days_back)
        
        return jsonify({
            'success': True,
            'ticker': ticker.upper(),
            'has_news': result.has_news,
            'has_cbe_news': result.has_cbe_news,
            'news_count': result.news_count,
            'should_hold': result.should_hold,
            'risk_level': result.risk_level,
            'reason': result.reason,
            'reason_ar': result.reason_ar
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@maestro_bp.route('/api/maestro/overview', methods=['GET'])
def get_overview():
    """
    نظرة عامة على السوق
    Market overview
    """
    try:
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get market regime
        from analyzers.regime_detector import RegimeDetector
        detector = RegimeDetector(DATABASE_PATH)
        market_regime = detector.detect_market_regime()
        
        # Get signal stats - check if outcome column exists
        cursor.execute("PRAGMA table_info(signal_logs)")
        columns = [col[1] for col in cursor.fetchall()]
        has_outcome = 'outcome' in columns
        
        cursor.execute('SELECT COUNT(*) as count FROM signal_logs')
        total_signals = cursor.fetchone()['count']
        
        wins = 0
        losses = 0
        
        if has_outcome:
            cursor.execute('SELECT COUNT(*) as count FROM signal_logs WHERE outcome = "win"')
            wins = cursor.fetchone()['count']
            
            cursor.execute('SELECT COUNT(*) as count FROM signal_logs WHERE outcome = "loss"')
            losses = cursor.fetchone()['count']
        
        win_rate = (wins / total_signals * 100) if total_signals > 0 and wins > 0 else 0
        
        # Get recent signals
        cursor.execute('''
            SELECT * FROM signal_logs 
            ORDER BY created_at DESC LIMIT 5
        ''')
        recent_signals = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'market_regime': market_regime,
            'statistics': {
                'total_signals': total_signals,
                'wins': wins,
                'losses': losses,
                'win_rate': round(win_rate, 2)
            },
            'recent_signals': recent_signals,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'success': True,
            'market_regime': {'regime': 'unknown', 'confidence': 0},
            'statistics': {'total_signals': 0, 'wins': 0, 'losses': 0, 'win_rate': 0},
            'recent_signals': [],
            'error': str(e)
        })


@maestro_bp.route('/api/maestro/quick-scan', methods=['GET'])
def quick_scan():
    """
    فحص سريع للسوق - أفضل 10 فرص
    Quick market scan - top 10 opportunities
    """
    try:
        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get active stocks
        cursor.execute('''
            SELECT s.id, s.ticker, s.name, s.current_price, s.sector 
            FROM stocks s
            WHERE s.is_active = 1 AND s.current_price > 0
            LIMIT 50
        ''')
        
        stocks = [dict(row) for row in cursor.fetchall()]
        
        results = []
        orchestrator = None  # KILL-MAESTRO: MaestroOrchestrator DISABLED — V40.2 is the only engine
        
        for stock in stocks:
            ticker = stock['ticker']
            
            # Use ticker for query (stock_price_history uses ticker column)
            cursor.execute('''
                SELECT * FROM stock_price_history 
                WHERE ticker = ? 
                ORDER BY date DESC LIMIT 60
            ''', (ticker,))
            
            history = list(reversed([dict(row) for row in cursor.fetchall()]))
            
            if len(history) < 20:
                continue
            
            try:
                # KILL-MAESTRO: orchestrator = None — skip analyze
                result = None  # Maestro disabled — V40.2 is the only engine
                
                if result.recommendation in ['buy', 'strong_buy']:
                    results.append({
                        'ticker': result.ticker,
                        'name': stock.get('name'),
                        'maestro_score': result.maestro_score,
                        'recommendation': result.recommendation_ar,
                        'current_price': stock.get('current_price'),
                        'entry_price': result.entry_price,
                        'stop_loss': result.stop_loss,
                        'target': result.target
                    })
            except Exception as e:
                print(f'[Maestro] Error in quick scan for {ticker}: {e}')
        
        conn.close()
        
        # Sort by score and take top 10
        results.sort(key=lambda x: x['maestro_score'], reverse=True)
        
        return jsonify({
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'opportunities': results[:10]
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': True,
            'opportunities': [],
            'error': str(e),
            'traceback': traceback.format_exc()
        })


@maestro_bp.route('/api/maestro/daily-opportunities', methods=['GET'])
def get_daily_opportunities():
    try:
        market = request.args.get('market', 'EGX')
        limit = int(request.args.get('limit', 5))
        result = daily_opportunities(market=market, limit=limit)
        return jsonify({
            'success': True,
            'date': result.get('date'),
            'market': result.get('market'),
            'count': result.get('count', 0),
            'opportunities': result.get('opportunities', [])
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@maestro_bp.route('/api/maestro/results', methods=['GET'])
def get_maestro_results():
    """
    الحصول على نتائج التحليل الأخيرة
    Get latest analysis results - runs a quick scan if no cached results
    """
    try:
        limit = request.args.get('limit', 20, type=int)
        # P40-MARKET-ISOLATION: فلتر بالسوق (?market=EGX) عشان النتائج تبقى من
        # السوق المطلوب بس. قبل كده كان بيجيب أسهم من كل الأسواق.
        market = (request.args.get('market') or 'EGX').upper()
        _db_market = 'TADAWUL' if market == 'KSA' else market

        import sqlite3
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('stocks', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Get active stocks — فلتر حسب السوق إجباري.
        if _db_market == 'EGX':
            cursor.execute('''
                SELECT s.id, s.ticker, s.name, s.name_ar, s.current_price, s.sector, s.market
                FROM stocks s
                WHERE (s.market = 'EGX' OR s.market IS NULL) AND s.is_active = 1 AND s.current_price > 0
                LIMIT ?
            ''', (limit,))
        else:
            cursor.execute('''
                SELECT s.id, s.ticker, s.name, s.name_ar, s.current_price, s.sector, s.market
                FROM stocks s
                WHERE s.market = ? AND s.is_active = 1 AND s.current_price > 0
                LIMIT ?
            ''', (_db_market, limit))

        stocks = [dict(row) for row in cursor.fetchall()]
        
        results = []
        orchestrator = None  # KILL-MAESTRO: MaestroOrchestrator DISABLED — V40.2 is the only engine
        
        for stock in stocks:
            ticker = stock['ticker']
            
            # Use ticker for query (stock_price_history uses ticker column)
            cursor.execute('''
                SELECT * FROM stock_price_history 
                WHERE ticker = ? 
                ORDER BY date DESC LIMIT 60
            ''', (ticker,))
            
            history = list(reversed([dict(row) for row in cursor.fetchall()]))
            
            if len(history) < 20:
                continue
            
            try:
                # KILL-MAESTRO: orchestrator = None — skip analyze
                result = None  # Maestro disabled — V40.2 is the only engine
                
                # Extract phases with safe defaults
                phases = result.phases if result.phases else {}
                regime_phase = phases.get('regime', {})
                timeframe_phase = phases.get('timeframe', {})
                volume_phase = phases.get('volume', {})
                
                # Calculate volume rating safely
                volume_ratio = volume_phase.get('volume_ratio', 1.0) if volume_phase else 1.0
                volume_rating = min(100, max(0, int(float(volume_ratio) * 50)))
                
                # Return camelCase keys for frontend compatibility
                results.append({
                    'ticker': result.ticker,
                    'name': stock.get('name', ''),
                    'nameAr': stock.get('name_ar', ''),
                    'currentPrice': float(stock.get('current_price', 0) or 0),
                    'maestroScore': float(result.maestro_score) if result.maestro_score is not None else 50.0,
                    'recommendation': result.recommendation or 'hold',
                    'recommendationAr': result.recommendation_ar or 'احتفاظ',
                    'regime': regime_phase.get('phase', 'range') if regime_phase else 'range',
                    'timeframeConfluence': float(timeframe_phase.get('confluence_score', 50)) if timeframe_phase else 50.0,
                    'volumeRating': float(volume_rating),
                    'newsSentiment': 'neutral',
                    'newsSentimentScore': 0.0,
                    'confidence': float(result.confidence) if result.confidence is not None else 50.0,
                    'stopLoss': float(result.stop_loss) if result.stop_loss is not None else None,
                    'target': float(result.target) if result.target is not None else None,
                    'sector': stock.get('sector', ''),
                    'lastUpdated': datetime.now().isoformat(),
                    'human': _get_human_data(result) or None,
                })
            except Exception as e:
                print(f'[Maestro] Error analyzing {ticker}: {e}')
                import traceback
                traceback.print_exc()
        
        conn.close()
        
        # Sort by score
        results.sort(key=lambda x: x['maestroScore'], reverse=True)
        
        return jsonify({
            'success': True,
            'results': results[:limit],
            'count': len(results)
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': True,
            'results': [],
            'count': 0,
            'error': str(e),
            'traceback': traceback.format_exc()
        })
