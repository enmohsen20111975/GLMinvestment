#!/usr/bin/env python3
"""
Prediction Tracking Routes
==========================
نظام تتبع وتقييم توقعات الصياد (Hunter Picks Tracking)

هذا الملف يوفر API endpoints لتتبع وتقييم توصيات الـ Hunting Engine V2.2.1:
- POST /api/predictions/tracking/save     — حفظ توصية صياد جديدة
- GET  /api/predictions/tracking/list     — قائمة التوصيات المتتبعة
- GET  /api/predictions/tracking/stats    — إحصائيات نسبة النجاح
- POST /api/predictions/tracking/verify   — التحقق اليومي من التوصيات المعلقة

الجدول: hunter_pick_tracking (في db/predictions.db)

Author: GLMinvestment Platform — Feature 3: Prediction Tracking System
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from flask import Blueprint, jsonify, request, Response

# ============================================================
# Database Paths
# ============================================================
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
STOCKS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')


# ============================================================
# Legacy Blueprint (EnhancedPredictionTracker on aiPrediction table)
# محفوظ للتوافق مع الـ legacy callers — /stats اتغيّر لـ /legacy-stats
# لتجنب التعارض مع stats الـ hunter_pick_tracking الجديدة
# ============================================================
try:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from analyzers.enhanced_prediction_tracker import EnhancedPredictionTracker
    _LEGACY_TRACKER = EnhancedPredictionTracker()
    _LEGACY_AVAILABLE = True
except Exception as _e:  # pragma: no cover
    _LEGACY_TRACKER = None
    _LEGACY_AVAILABLE = False
    _LEGACY_ERROR = str(_e)

tracking_bp = Blueprint('prediction_tracking_legacy', __name__, url_prefix='/api/predictions/tracking')


# ============================================================
# NEW Blueprint: Hunter Pick Tracking (Feature 3)
# ============================================================
prediction_tracking_bp = Blueprint(
    'prediction_tracking',
    __name__,
    url_prefix='/api/predictions/tracking'
)


# ============================================================
# Database Helpers
# ============================================================

def _connect(db_path: str) -> Optional[sqlite3.Connection]:
    """اتصال آمن بـ SQLite مع WAL و busy_timeout."""
    if not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA busy_timeout=30000;')
        return conn
    except Exception:
        return None


def _ensure_tracking_table(conn: sqlite3.Connection) -> None:
    """ينشئ جدول hunter_pick_tracking لو مش موجود."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hunter_pick_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT NOT NULL,
            entry_price REAL NOT NULL,
            stop_loss REAL NOT NULL,
            target_price REAL NOT NULL,
            risk_reward REAL NOT NULL,
            pick_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            current_price REAL,
            verification_date TEXT,
            profit_loss_pct REAL,
            narrative TEXT,
            personas TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_hpt_ticker_date
        ON hunter_pick_tracking(ticker, pick_date)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_hpt_market_status
        ON hunter_pick_tracking(market, status)
    """)
    conn.commit()


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == '':
            return default
        return float(v)
    except Exception:
        return default


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """يحوّل الـ row لـ dict مع فك الـ JSON fields."""
    d = dict(row)
    # فك الـ JSON fields
    if d.get('narrative'):
        try:
            d['narrative'] = json.loads(d['narrative'])
        except Exception:
            d['narrative'] = []
    else:
        d['narrative'] = []
    if d.get('personas'):
        try:
            d['personas'] = json.loads(d['personas'])
        except Exception:
            d['personas'] = {}
    else:
        d['personas'] = {}
    return d


# ============================================================
# Current Price Lookup — يجيب السعر الحالي للسهم من stocks.db
# ============================================================

def _get_current_price(ticker: str, market: str) -> Optional[float]:
    """يجيب السعر الحالي للسهم من stocks.db.

    يجرّب:
    1. stocks.db → stocks.current_price (where ticker = ? AND market = ?)
    2. data_engine.db → crypto_prices.price_usd (لو market == CRYPTO)
    """
    # محاولة 1: stocks.db
    conn = _connect(STOCKS_DB)
    if conn:
        try:
            # محاولة بالـ ticker والـ market
            row = conn.execute(
                "SELECT current_price, close, last FROM stocks WHERE ticker = ? AND market = ? LIMIT 1",
                (ticker, market)
            ).fetchone()
            if row is None:
                # محاولة بالـ ticker فقط
                row = conn.execute(
                    "SELECT current_price, close, last FROM stocks WHERE ticker = ? LIMIT 1",
                    (ticker,)
                ).fetchone()
            if row:
                for v in row:
                    if v is not None and _safe_float(v, 0) > 0:
                        conn.close()
                        return _safe_float(v)
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # محاولة 2: data_engine.db للـ CRYPTO
    if str(market).upper() == 'CRYPTO':
        conn2 = _connect(DATA_ENGINE_DB)
        if conn2:
            try:
                row2 = conn2.execute(
                    "SELECT price_usd FROM crypto_prices WHERE symbol = ? OR symbol = ? LIMIT 1",
                    (ticker, ticker.upper())
                ).fetchone()
                if row2 and row2['price_usd']:
                    return _safe_float(row2['price_usd'])
            except Exception:
                pass
            finally:
                try:
                    conn2.close()
                except Exception:
                    pass

    return None


# ============================================================
# PUBLIC HELPER: save_pick — يستوردها hunter_routes.py
# ============================================================

def save_pick(pick: Dict[str, Any]) -> Dict[str, Any]:
    """يحفظ توصية صياد واحدة في جدول hunter_pick_tracking.

    Args:
        pick: dict يحتوي على ticker, market, entry, stop_loss, target,
              risk_reward, narrative (list), personas (dict)
              يقبل كمان entry_price بدل entry و target_price بدل target.

    Returns:
        dict: {saved: bool, id: int|None, reason: str}
    """
    ticker = str(pick.get('ticker', '')).strip()
    market = str(pick.get('market', 'EGX')).strip().upper() or 'EGX'

    entry = _safe_float(pick.get('entry_price', pick.get('entry', 0)))
    stop = _safe_float(pick.get('stop_loss', 0))
    target = _safe_float(pick.get('target_price', pick.get('target', 0)))
    risk_reward = _safe_float(pick.get('risk_reward', 0))

    if not ticker or entry <= 0 or stop <= 0 or target <= 0:
        return {'saved': False, 'id': None, 'reason': 'invalid_fields'}

    pick_date = datetime.now().strftime('%Y-%m-%d')
    narrative = pick.get('narrative', [])
    personas = pick.get('personas', {})
    if not isinstance(narrative, list):
        narrative = [str(narrative)] if narrative else []
    if not isinstance(personas, dict):
        personas = {}

    conn = _connect(PREDICTIONS_DB)
    if not conn:
        return {'saved': False, 'id': None, 'reason': 'db_unavailable'}

    try:
        _ensure_tracking_table(conn)

        # تجنب التكرار: نفس ticker + نفس pick_date
        existing = conn.execute(
            "SELECT id FROM hunter_pick_tracking WHERE ticker = ? AND pick_date = ? LIMIT 1",
            (ticker, pick_date)
        ).fetchone()
        if existing:
            return {'saved': False, 'id': None, 'reason': 'duplicate_today'}

        conn.execute(
            """INSERT INTO hunter_pick_tracking
               (ticker, market, entry_price, stop_loss, target_price, risk_reward,
                pick_date, status, narrative, personas)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (
                ticker, market, entry, stop, target, risk_reward,
                pick_date,
                json.dumps(narrative, ensure_ascii=False),
                json.dumps(personas, ensure_ascii=False),
            )
        )
        conn.commit()
        new_id = conn.execute(
            "SELECT last_insert_rowid() as lid"
        ).fetchone()['lid']
        return {'saved': True, 'id': int(new_id), 'reason': 'created'}
    except Exception as e:
        return {'saved': False, 'id': None, 'reason': f'error: {e}'}
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ============================================================
# VERIFY HELPER: يتحقق من التوصيات المعلقة
# ============================================================

def _verify_pending(conn: sqlite3.Connection, market: Optional[str] = None) -> Dict[str, Any]:
    """يتحقق من كل التوصيات المعلقة ويحدّث حالتها."""
    now = datetime.now()
    expire_threshold = now - timedelta(days=30)

    # جلب التوصيات المعلقة
    if market:
        rows = conn.execute(
            "SELECT * FROM hunter_pick_tracking WHERE status = 'pending' AND market = ? ORDER BY pick_date ASC",
            (market,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM hunter_pick_tracking WHERE status = 'pending' ORDER BY pick_date ASC"
        ).fetchall()

    results = {
        'total_evaluated': 0,
        'target_hit': 0,
        'stop_hit': 0,
        'expired': 0,
        'still_pending': 0,
        'errors': 0,
        'details': [],
    }

    for row in rows:
        results['total_evaluated'] += 1
        d = _row_to_dict(row)
        ticker = d['ticker']
        mkt = d['market']
        entry = d['entry_price']
        stop = d['stop_loss']
        target = d['target_price']
        pick_date_str = d['pick_date']

        # محاولة parse تاريخ الـ pick
        try:
            pick_dt = datetime.strptime(pick_date_str[:10], '%Y-%m-%d')
        except Exception:
            pick_dt = now

        # انتهاء الصلاحية: أكتر من 30 يوم
        if pick_dt < expire_threshold:
            conn.execute(
                """UPDATE hunter_pick_tracking
                   SET status = 'expired',
                       verification_date = ?,
                       updated_at = datetime('now', 'localtime')
                   WHERE id = ?""",
                (now.isoformat(), d['id'])
            )
            results['expired'] += 1
            results['details'].append({
                'id': d['id'], 'ticker': ticker, 'market': mkt,
                'action': 'expired', 'pick_date': pick_date_str,
            })
            continue

        # جلب السعر الحالي
        current = _get_current_price(ticker, mkt)
        if current is None or current <= 0:
            results['still_pending'] += 1
            results['details'].append({
                'id': d['id'], 'ticker': ticker, 'market': mkt,
                'action': 'no_price', 'pick_date': pick_date_str,
            })
            continue

        # تحديث السعر الحالي دائماً
        new_status = 'pending'
        pnl_pct = None

        if current >= target:
            new_status = 'target_hit'
            pnl_pct = round(((target - entry) / entry) * 100, 2) if entry > 0 else 0
            results['target_hit'] += 1
            action = 'target_hit'
        elif current <= stop:
            new_status = 'stop_hit'
            pnl_pct = round(((stop - entry) / entry) * 100, 2) if entry > 0 else 0
            results['stop_hit'] += 1
            action = 'stop_hit'
        else:
            results['still_pending'] += 1
            action = 'updated_price'

        conn.execute(
            """UPDATE hunter_pick_tracking
               SET status = ?, current_price = ?, profit_loss_pct = ?,
                   verification_date = ?, updated_at = datetime('now', 'localtime')
               WHERE id = ?""",
            (new_status, current, pnl_pct, now.isoformat(), d['id'])
        )
        results['details'].append({
            'id': d['id'], 'ticker': ticker, 'market': mkt,
            'action': action, 'current_price': current,
            'entry': entry, 'stop': stop, 'target': target,
            'profit_loss_pct': pnl_pct,
        })

    conn.commit()
    return results


# ============================================================
# ENDPOINTS: prediction_tracking_bp (Feature 3)
# ============================================================

@prediction_tracking_bp.route('/save', methods=['POST'])
def save_pick_endpoint():
    """POST /api/predictions/tracking/save — حفظ توصية صياد.

    Body: {ticker, market, entry_price, stop_loss, target_price,
           risk_reward, narrative, personas}
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        result = save_pick(data)
        return jsonify({
            'success': result['saved'],
            'data': result,
            'timestamp': datetime.now().isoformat(),
        }), 200 if result['saved'] else 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat(),
        }), 500


@prediction_tracking_bp.route('/list', methods=['GET'])
def list_picks_endpoint():
    """GET /api/predictions/tracking/list — قائمة التوصيات المتتبعة.

    Query: market=EGX, status=pending, limit=50
    """
    try:
        market = request.args.get('market')
        status = request.args.get('status')
        try:
            limit = int(request.args.get('limit', 50))
        except Exception:
            limit = 50
        limit = max(1, min(limit, 500))

        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return jsonify({
                'success': False,
                'error': 'predictions.db unavailable',
                'data': [],
            }), 500

        try:
            _ensure_tracking_table(conn)
            sql = "SELECT * FROM hunter_pick_tracking"
            clauses: List[str] = []
            params: List[Any] = []
            if market:
                clauses.append("market = ?")
                params.append(market.upper())
            if status:
                clauses.append("status = ?")
                params.append(status)
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY pick_date DESC, id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, params).fetchall()
            data = [_row_to_dict(r) for r in rows]
            return jsonify({
                'success': True,
                'data': data,
                'count': len(data),
                'timestamp': datetime.now().isoformat(),
            })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'data': [],
        }), 500


@prediction_tracking_bp.route('/stats', methods=['GET'])
def stats_endpoint():
    """GET /api/predictions/tracking/stats — إحصائيات نسبة نجاح توصيات الصياد.

    Query: market=EGX, days=30
    Returns: total, pending, target_hit, stop_hit, expired, success_rate
    """
    try:
        market = request.args.get('market')
        try:
            days = int(request.args.get('days', 30))
        except Exception:
            days = 30
        since = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return jsonify({
                'success': False,
                'error': 'predictions.db unavailable',
                'data': {},
            }), 500

        try:
            _ensure_tracking_table(conn)
            clauses = ["pick_date >= ?"]
            params: List[Any] = [since]
            if market:
                clauses.append("market = ?")
                params.append(market.upper())
            where = " WHERE " + " AND ".join(clauses)

            total = conn.execute(
                f"SELECT COUNT(*) as c FROM hunter_pick_tracking{where}", params
            ).fetchone()['c']
            pending = conn.execute(
                f"SELECT COUNT(*) as c FROM hunter_pick_tracking{where} AND status = 'pending'", params
            ).fetchone()['c']
            target_hit = conn.execute(
                f"SELECT COUNT(*) as c FROM hunter_pick_tracking{where} AND status = 'target_hit'", params
            ).fetchone()['c']
            stop_hit = conn.execute(
                f"SELECT COUNT(*) as c FROM hunter_pick_tracking{where} AND status = 'stop_hit'", params
            ).fetchone()['c']
            expired = conn.execute(
                f"SELECT COUNT(*) as c FROM hunter_pick_tracking{where} AND status = 'expired'", params
            ).fetchone()['c']

            # متوسط العائد للتوصيات المغلقة
            avg_row = conn.execute(
                f"""SELECT AVG(profit_loss_pct) as avg_pnl
                    FROM hunter_pick_tracking{where}
                    AND status IN ('target_hit','stop_hit')""",
                params
            ).fetchone()
            avg_pnl = _safe_float(avg_row['avg_pnl'], 0.0) if avg_row else 0.0

            # نسبة النجاح = target_hit / (target_hit + stop_hit)
            resolved = target_hit + stop_hit
            success_rate = round((target_hit / resolved) * 100, 2) if resolved > 0 else 0.0
            failure_rate = round((stop_hit / resolved) * 100, 2) if resolved > 0 else 0.0

            # إحصائيات حسب السوق (لو مفيش فلتر سوق)
            by_market: Dict[str, Dict[str, int]] = {}
            if not market:
                mkt_rows = conn.execute(
                    """SELECT market,
                              SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                              SUM(CASE WHEN status='target_hit' THEN 1 ELSE 0 END) as target_hit,
                              SUM(CASE WHEN status='stop_hit' THEN 1 ELSE 0 END) as stop_hit,
                              SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired,
                              COUNT(*) as total
                       FROM hunter_pick_tracking WHERE pick_date >= ?
                       GROUP BY market""",
                    (since,)
                ).fetchall()
                for r in mkt_rows:
                    by_market[r['market']] = {
                        'total': r['total'],
                        'pending': r['pending'],
                        'target_hit': r['target_hit'],
                        'stop_hit': r['stop_hit'],
                        'expired': r['expired'],
                    }

            stats = {
                'total': total,
                'pending': pending,
                'target_hit': target_hit,
                'stop_hit': stop_hit,
                'expired': expired,
                'resolved': resolved,
                'success_rate': success_rate,
                'failure_rate': failure_rate,
                'avg_return': round(avg_pnl, 2),
                'days': days,
                'market': market or 'ALL',
                'by_market': by_market,
            }
            return jsonify({
                'success': True,
                'data': stats,
                'timestamp': datetime.now().isoformat(),
            })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'data': {},
        }), 500


@prediction_tracking_bp.route('/verify', methods=['POST'])
def verify_endpoint():
    """POST /api/predictions/tracking/verify — التحقق من التوصيات المعلقة.

    Body (optional): {market: "EGX"}
    """
    try:
        data = request.get_json(silent=True) or {}
        market = data.get('market')

        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return jsonify({
                'success': False,
                'error': 'predictions.db unavailable',
            }), 500

        try:
            _ensure_tracking_table(conn)
            results = _verify_pending(conn, market=market)
            return jsonify({
                'success': True,
                'data': results,
                'timestamp': datetime.now().isoformat(),
            })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 500


# ============================================================
# LEGACY ENDPOINTS (tracking_bp) — EnhancedPredictionTracker
# محفوظة للتوافق مع الـ legacy callers
# /stats اللي كانت هنا اتغير مسارها لـ /legacy-stats
# ============================================================

@tracking_bp.route('/legacy-stats', methods=['GET'])
def legacy_stats():
    """إحصائيات الـ aiPrediction (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({
            'success': False,
            'error': f'Legacy tracker not available: {_LEGACY_ERROR}',
        }), 500
    try:
        market = request.args.get('market')
        try:
            days = int(request.args.get('days', 30))
        except Exception:
            days = 30
        stats = _LEGACY_TRACKER.get_performance_stats(market=market, days=days)
        return jsonify({
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 500


@tracking_bp.route('/history', methods=['GET'])
def legacy_history():
    """سجل التوقعات (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available', 'data': []}), 500
    try:
        market = request.args.get('market')
        try:
            days = int(request.args.get('days', 30))
        except Exception:
            days = 30
        try:
            limit = int(request.args.get('limit', 100))
        except Exception:
            limit = 100
        history = _LEGACY_TRACKER.get_prediction_history(market=market, days=days)
        if limit:
            history = history[:limit]
        return jsonify({
            'success': True,
            'data': history,
            'count': len(history),
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'data': []}), 500


@tracking_bp.route('/pending', methods=['GET'])
def legacy_pending():
    """التوقعات المعلقة (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available', 'data': []}), 500
    try:
        market = request.args.get('market')
        try:
            limit = int(request.args.get('limit', 100))
        except Exception:
            limit = 100
        pending = _LEGACY_TRACKER.get_pending_predictions(market=market, limit=limit)
        return jsonify({
            'success': True,
            'data': pending,
            'count': len(pending),
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'data': []}), 500


@tracking_bp.route('/evaluate', methods=['POST'])
def legacy_evaluate():
    """تقييم التوقعات (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available'}), 500
    try:
        data = request.get_json() or {}
        market = data.get('market')
        symbol = data.get('symbol')
        if symbol:
            result = _LEGACY_TRACKER.evaluate_prediction(symbol)
            return jsonify({
                'success': True,
                'data': {
                    'symbol': result.symbol,
                    'status': result.status,
                    'hit_target': result.hit_target,
                    'hit_stop': result.hit_stop,
                    'actual_return': result.actual_return,
                    'holding_days': result.holding_days,
                },
                'timestamp': datetime.now().isoformat(),
            })
        else:
            results = _LEGACY_TRACKER.batch_evaluate_predictions(market=market)
            return jsonify({
                'success': True,
                'data': results,
                'timestamp': datetime.now().isoformat(),
            })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@tracking_bp.route('/check/<prediction_id>', methods=['GET'])
def legacy_check(prediction_id):
    """التحقق من توقع محدد (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available'}), 500
    try:
        result = _LEGACY_TRACKER.check_target_hit(prediction_id)
        if 'error' in result:
            return jsonify({'success': False, 'error': result['error']}), 404
        return jsonify({
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@tracking_bp.route('/export', methods=['GET'])
def legacy_export():
    """تصدير تقرير التوقعات (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available'}), 500
    try:
        market = request.args.get('market')
        try:
            days = int(request.args.get('days', 30))
        except Exception:
            days = 30
        fmt = request.args.get('format', 'json')
        report = _LEGACY_TRACKER.export_report(market=market, days=days, format=fmt)
        if fmt == 'csv':
            return Response(
                report,
                mimetype='text/csv',
                headers={
                    'Content-Disposition': f'attachment; filename=predictions_report_{datetime.now().strftime("%Y%m%d")}.csv'
                }
            )
        else:
            return Response(
                report,
                mimetype='application/json',
                headers={
                    'Content-Disposition': f'attachment; filename=predictions_report_{datetime.now().strftime("%Y%m%d")}.json'
                }
            )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@tracking_bp.route('/summary', methods=['GET'])
def legacy_summary():
    """ملخص سريع للتوقعات (legacy)."""
    if not _LEGACY_AVAILABLE:
        return jsonify({'success': False, 'error': 'Legacy tracker not available'}), 500
    try:
        stats_30d = _LEGACY_TRACKER.get_performance_stats(days=30)
        stats_7d = _LEGACY_TRACKER.get_performance_stats(days=7)
        return jsonify({
            'success': True,
            'data': {
                'last_30_days': stats_30d,
                'last_7_days': stats_7d,
                'summary': {
                    'total_predictions': stats_30d['total_predictions'],
                    'pending': stats_30d['pending'],
                    'win_rate_30d': stats_30d['win_rate'],
                    'win_rate_7d': stats_7d['win_rate'],
                    'avg_return_30d': stats_30d['avg_return'],
                    'avg_return_7d': stats_7d['avg_return'],
                }
            },
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# REGISTER HELPER
# ============================================================

def register_tracking_routes(app):
    """Register both tracking blueprints with the Flask app."""
    app.register_blueprint(prediction_tracking_bp)
    app.register_blueprint(tracking_bp)
    print("✅ Hunter pick tracking routes registered at /api/predictions/tracking (save/list/stats/verify)")
    print("✅ Legacy prediction tracking routes at /api/predictions/tracking (legacy-stats/history/pending/...)")


# ============================================================
# MAIN (test)
# ============================================================

if __name__ == '__main__':
    print("=" * 60)
    print("Prediction Tracking Routes — Hunter Pick Tracking (Feature 3)")
    print("=" * 60)
    print("Available endpoints (prediction_tracking_bp):")
    print("  POST /api/predictions/tracking/save   — حفظ توصية صياد")
    print("  GET  /api/predictions/tracking/list   — قائمة التوصيات")
    print("  GET  /api/predictions/tracking/stats  — إحصائيات النجاح")
    print("  POST /api/predictions/tracking/verify — التحقق من المعلقة")
    print()
    print("Legacy endpoints (tracking_bp):")
    print("  GET  /api/predictions/tracking/legacy-stats")
    print("  GET  /api/predictions/tracking/history")
    print("  GET  /api/predictions/tracking/pending")
    print("  POST /api/predictions/tracking/evaluate")
    print("  GET  /api/predictions/tracking/check/<id>")
    print("  GET  /api/predictions/tracking/export")
    print("  GET  /api/predictions/tracking/summary")
