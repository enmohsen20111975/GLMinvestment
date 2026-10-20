#!/usr/bin/env python3
"""
Daily Picks & Position Management API
======================================
Endpoints جديده لفن إدارة التوصيات:

  GET  /api/predictions/daily-picks         — أعلى 5 توصيات لليوم (أو تاريخ محدد)
  GET  /api/predictions/daily-picks/history  — آخر 7 أيام من التوصيات
  GET  /api/predictions/active-management   — إدارة كل المراكز المفتوحة
  GET  /api/predictions/{id}/management     — إدارة مركز واحد
  POST /api/predictions/management/refresh  — إعادة حساب الإدارة لكل المراكز

Author: GLMinvestment v3.4.43 — Confidence + Position Management
"""

import os
import sys
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path

from flask import Blueprint, jsonify, request

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

# ----------------------------------------------------------------------------
# Blueprint
# ----------------------------------------------------------------------------
picks_mgmt_bp = Blueprint('picks_management', __name__)


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _get_db_conn():
    return sqlite3.connect(PREDICTIONS_DB, timeout=30.0)


def _get_current_price(ticker: str) -> tuple:
    """يجلب السعر الحالي + آخر المؤشرات للسهم."""
    try:
        conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=10.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT close_price, high_price, low_price, volume, date "
            "FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 30",
            (ticker.upper(),)
        )
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return 0.0, {}
        closes = [float(r[0] or 0) for r in rows if r[0]]
        highs = [float(r[1] or 0) for r in rows if r[1]]
        lows = [float(r[2] or 0) for r in rows if r[2]]
        vols = [float(r[3] or 0) for r in rows if r[3] is not None]
        closes.reverse()
        highs.reverse()
        lows.reverse()
        vols.reverse()
        if not closes:
            return 0.0, {}
        current_price = closes[-1]
        # RSI
        period = min(14, len(closes) - 1)
        rsi = 50.0
        if period >= 5:
            gains, losses = [], []
            for i in range(-period, 0):
                ch = closes[i] - closes[i - 1]
                gains.append(max(0, ch))
                losses.append(max(0, -ch))
            avg_g = sum(gains) / period
            avg_l = sum(losses) / period
            rsi = 100.0 if avg_l == 0 else 100 - (100 / (1 + avg_g / avg_l))
        ma20 = sum(closes[-20:]) / min(20, len(closes)) if len(closes) >= 5 else current_price
        ma50 = sum(closes[-50:]) / min(50, len(closes)) if len(closes) >= 10 else current_price
        trend = 'BULLISH' if ma20 > ma50 * 1.01 else ('BEARISH' if ma20 < ma50 * 0.99 else 'NEUTRAL')
        return current_price, {
            'close': current_price,
            'rsi': round(rsi, 2),
            'ma20': round(ma20, 4),
            'ma50': round(ma50, 4),
            'trend': trend,
            'history_len': len(closes),
            'highest': max(highs) if highs else current_price,
            'lowest': min(lows) if lows else current_price,
        }
    except Exception as e:
        return 0.0, {'error': str(e)}


def _row_to_dict(row: tuple, columns: list) -> Dict:
    return {col: row[i] for i, col in enumerate(columns)}


def _get_prediction_columns() -> list:
    return [
        'id', 'ticker', 'signal', 'signal_type', 'prediction_date',
        'entry_price', 'target_price', 'target_price_2', 'stop_loss',
        'master_score', 'technical_score', 'fundamental_score',
        'confidence', 'risk_reward', 'persona', 'status',
        'pnl_pct', 'actual_return', 'closed_at', 'outcome_date',
        'highest_price_reached', 'lowest_price_reached',
        'atr_at_entry', 'trailing_stop_atr_mult',
        'explosive_score', 'explosive_label',
        'holding_days', 'days_to_close', 'exit_type', 'exit_reason',
        'notes', 'created_at', 'market',
    ]


def _detect_market_from_ticker(ticker: str) -> str:
    """كشف السوق من الـ ticker — نسخة محلية."""
    ticker = (ticker or '').upper().strip()
    if not ticker:
        return 'UNKNOWN'
    # Crypto
    if any(x in ticker for x in ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'XRP']):
        return 'CRYPTO'
    # Saudi: 4-digit numbers or .SR suffix
    if '.SR' in ticker or (ticker.isdigit() and len(ticker) == 4):
        return 'KSA'
    # Kuwait
    if '.KW' in ticker:
        return 'KSE'
    # Qatar
    if '.QA' in ticker:
        return 'QSE'
    # Dubai
    if '.AE' in ticker:
        return 'DFM'
    # Default EGX
    return 'EGX'


# ----------------------------------------------------------------------------
# GET /api/predictions/daily-picks
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/daily-picks', methods=['GET'])
def get_daily_picks():
    """
    أعلى 5 توصيات لليوم (أو تاريخ محدد).

    Query params:
        date: str (default: today) — YYYY-MM-DD
        persona: str (default: balanced)
        limit: int (default: 5, max: 20)
        min_confidence: float (default: 50)

    Returns: {
        date, persona, picks: [{id, ticker, signal, confidence, tier, ...}],
        stats: {total_for_day, avg_confidence, by_signal}
    }
    """
    try:
        target_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
        persona = request.args.get('persona', 'balanced')
        limit = min(20, max(1, int(request.args.get('limit', 5))))
        min_confidence = float(request.args.get('min_confidence', 50))

        conn = _get_db_conn()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        market = request.args.get('market', 'EGX')

        # Filter by date + persona + confidence + market (status active/PENDING/WAITING)
        # We query stored_analyses because trigger-analysis generates intraday live predictions here.
        query = f"""
            SELECT * FROM stored_analyses
            WHERE date(created_at) = ?
              AND confidence >= ?
              AND entry_price > 0
        """
        params = [target_date, min_confidence]
        if market and market != 'all':
            if market == 'EGX':
                query += " AND (market = 'EGX' OR market IS NULL OR market = '')"
            else:
                query += " AND market = ?"
                params.append(market)
        if persona and persona != 'all':
            # Persona is stored as flags in stored_analyses
            if persona == 'gambler':
                query += " AND is_gambler_opportunity = 1"
            elif persona == 'investor':
                query += " AND is_investor_opportunity = 1"
            # balanced could be inferred, or we just allow anything if it's high confidence
        query += " ORDER BY confidence DESC, risk_reward DESC LIMIT ?"
        params.append(limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]
        picks = [_row_to_dict(r, cols) for r in rows]

        # فلترة إضافية: استبعاد الأسهم غير المصرية إذا السوق EGX
        if market == 'EGX':
            picks = [p for p in picks if _detect_market_from_ticker(p.get('ticker', '')) == 'EGX']

        # Get stats for the day
        cur.execute("""
            SELECT
                COUNT(*) as total,
                AVG(confidence) as avg_conf,
                SUM(CASE WHEN signal IN ('BUY','STRONG_BUY','ACCUMULATE') THEN 1 ELSE 0 END) as buy_count,
                SUM(CASE WHEN signal IN ('SELL','REDUCE') THEN 1 ELSE 0 END) as sell_count,
                SUM(CASE WHEN signal = 'HOLD' THEN 1 ELSE 0 END) as hold_count
            FROM stored_analyses
            WHERE date(created_at) = ?
        """, (target_date,))
        stat_row = cur.fetchone()
        stats = {
            'total_for_day': stat_row[0] or 0,
            'avg_confidence': round(stat_row[1] or 0, 1),
            'buy_count': stat_row[2] or 0,
            'sell_count': stat_row[3] or 0,
            'hold_count': stat_row[4] or 0,
        }
        conn.close()

        # Add tier + format
        for p in picks:
            conf = p.get('confidence') or 0
            if conf >= 80:
                p['tier'] = 'TOP_PICK'
                p['tier_ar'] = '🔥 اختيار مميز'
            elif conf >= 65:
                p['tier'] = 'STRONG'
                p['tier_ar'] = '⭐ قوي'
            elif conf >= 50:
                p['tier'] = 'WATCH'
                p['tier_ar'] = '👁️ متابعة'
            else:
                p['tier'] = 'SKIP'
                p['tier_ar'] = '⏭️ تجاهل'
            # Arabic signal
            sig = p.get('signal', '')
            sig_map = {
                'BUY': 'شراء', 'STRONG_BUY': 'شراء قوي', 'ACCUMULATE': 'تجميع',
                'SELL': 'بيع', 'REDUCE': 'تخفيف', 'HOLD': 'انتظار',
            }
            p['signal_ar'] = sig_map.get(sig, sig)

        return jsonify({
            'success': True,
            'date': target_date,
            'persona': persona,
            'picks': picks,
            'stats': stats,
            'limit': limit,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------------
# GET /api/predictions/daily-picks/history
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/daily-picks/history', methods=['GET'])
def get_daily_picks_history():
    """آخر N أيام من أعلى التوصيات."""
    try:
        days = min(30, max(1, int(request.args.get('days', 7))))
        persona = request.args.get('persona', 'all')
        limit_per_day = min(10, max(1, int(request.args.get('limit', 5))))

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        conn = _get_db_conn()
        cur = conn.cursor()
        cols = _get_prediction_columns()
        col_str = ', '.join(cols)

        # Get one row per (date) ranked by confidence
        query = f"""
            SELECT {col_str}, ROW_NUMBER() OVER (
                PARTITION BY prediction_date ORDER BY confidence DESC, risk_reward DESC
            ) as rn
            FROM predictions
            WHERE prediction_date >= ?
              AND prediction_date <= ?
              AND confidence IS NOT NULL
        """
        params = [start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')]
        if persona != 'all':
            query += " AND persona = ?"
            params.append(persona)
        query = f"SELECT * FROM ({query}) WHERE rn <= ?"
        params.append(limit_per_day)
        query += " ORDER BY prediction_date DESC, confidence DESC"

        cur.execute(query, params)
        rows = cur.fetchall()
        all_cols = cols + ['rn']
        history = [_row_to_dict(r, all_cols) for r in rows]

        # Group by date
        by_date = {}
        for p in history:
            d = p['prediction_date']
            if d not in by_date:
                by_date[d] = []
            by_date[d].append(p)

        conn.close()
        return jsonify({
            'success': True,
            'days': days,
            'persona': persona,
            'history': by_date,
            'total_picks': len(history),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------------
# GET /api/predictions/active-management
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/active-management', methods=['GET'])
def get_active_management():
    """
    إدارة كل المراكز المفتوحة — يعرض لكل توقع نشط:
    - السعر الحالي
    - نسبة الربح/الخسارة الحالية
    - نسبة التقدم نحو الهدف
    - توصية الإدارة (HOLD/TRAILING_STOP/TAKE_PROFIT_T1/T2/ADD/REDUCE/EXIT)
    - السبب بالعربي
    - مستوى الإلحاح

    Query params:
        persona: str (default: all)
        market: str (default: EGX) — فلترة السوق
        limit: int (default: 100)
    """
    try:
        persona = request.args.get('persona', 'all')
        market = request.args.get('market', 'EGX')
        limit = min(500, max(10, int(request.args.get('limit', 100))))

        conn = _get_db_conn()
        cur = conn.cursor()
        cols = _get_prediction_columns()
        col_str = ', '.join(cols)

        # فلترة حسب السوق + استبعاد التوقعات بدون بيانات
        query = f"""
            SELECT {col_str} FROM predictions
            WHERE (status IN ('active', 'PENDING', 'WAITING')
               OR (status IS NULL AND outcome_date IS NULL))
              AND entry_price > 0
        """
        params = []

        # فلترة السوق
        if market and market != 'all':
            # بعض التوقعات القديمة ليس لها عمود market أو قيمته NULL
            # نفلتر على مستويين: market column + ticker pattern
            if market == 'EGX':
                # EGX = market='EGX' أو market IS NULL (افتراضي)
                query += " AND (market = 'EGX' OR market IS NULL OR market = '')"
            else:
                query += " AND market = ?"
                params.append(market)

        if persona != 'all':
            query += " AND persona = ?"
            params.append(persona)
        query += " ORDER BY prediction_date DESC LIMIT ?"
        params.append(limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        active = [_row_to_dict(r, cols) for r in rows]
        conn.close()

        # فلترة إضافية: استبعاد الأسهم غير المصرية إذا السوق EGX
        # بعض التوقعات القديمة ليس لها market صحيح — نكشف من الـ ticker
        if market == 'EGX':
            active = [p for p in active if _detect_market_from_ticker(p.get('ticker', '')) == 'EGX']

        # استبعاد التوقعات بدون بيانات سعرية حقيقية
        active = [p for p in active if float(p.get('entry_price') or 0) > 0]

        if not active:
            return jsonify({
                'success': True,
                'count': 0,
                'management': [],
                'summary': {'total': 0, 'high_urgency': 0, 'medium_urgency': 0, 'low_urgency': 0},
            })

        # Import position_manager
        try:
            from analyzers.position_manager import manage_all_active
        except Exception as e:
            return jsonify({'success': False, 'error': f'position_manager import failed: {e}'}), 500

        # Build price lookup function
        _price_cache = {}

        def price_lookup(ticker):
            if ticker in _price_cache:
                return _price_cache[ticker]
            price, ind = _get_current_price(ticker)
            _price_cache[ticker] = (price, ind)
            return price, ind

        management = manage_all_active(active, price_lookup_fn=price_lookup)

        # Summary stats
        summary = {
            'total': len(management),
            'high_urgency': sum(1 for m in management if m.get('urgency') == 'high'),
            'medium_urgency': sum(1 for m in management if m.get('urgency') == 'medium'),
            'low_urgency': sum(1 for m in management if m.get('urgency') == 'low'),
            'avg_progress': round(sum(m.get('target_progress_pct', 0) for m in management) / max(1, len(management)), 1),
            'avg_return': round(sum(m.get('current_return_pct', 0) for m in management) / max(1, len(management)), 2),
            'actions': {},
        }
        for m in management:
            a = m.get('action', 'HOLD')
            summary['actions'][a] = summary['actions'].get(a, 0) + 1

        return jsonify({
            'success': True,
            'count': len(management),
            'management': management,
            'summary': summary,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------------
# GET /api/predictions/<int:pred_id>/management
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/<int:pred_id>/management', methods=['GET'])
def get_single_management(pred_id: int):
    """إدارة مركز واحد بناءً على prediction ID."""
    try:
        conn = _get_db_conn()
        cur = conn.cursor()
        cols = _get_prediction_columns()
        col_str = ', '.join(cols)
        cur.execute(f"SELECT {col_str} FROM predictions WHERE id = ?", (pred_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({'success': False, 'error': 'prediction not found'}), 404

        pred = _row_to_dict(row, cols)
        current_price, ind = _get_current_price(pred['ticker'])

        try:
            from analyzers.position_manager import manage_position
        except Exception as e:
            return jsonify({'success': False, 'error': f'position_manager import failed: {e}'}), 500

        advice = manage_position(pred, current_price, ind)
        return jsonify({
            'success': True,
            'prediction': pred,
            'current_price': current_price,
            'management': advice,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------------
# POST /api/predictions/management/refresh
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/management/refresh', methods=['POST'])
def refresh_management():
    """إعادة حساب الإدارة لكل المراكز المفتوحة (يقبل optional persona)."""
    try:
        data = request.get_json(silent=True) or {}
        persona = data.get('persona', 'all')
        # Reuse the active-management logic
        from flask import current_app
        with current_app.test_request_context(
            f'/api/predictions/active-management?persona={persona}&limit=500'
        ):
            return get_active_management()
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------
@picks_mgmt_bp.route('/api/predictions/management/health', methods=['GET'])
def health():
    return jsonify({
        'success': True,
        'service': 'picks_management',
        'version': '1.0.0',
        'endpoints': [
            '/api/predictions/daily-picks',
            '/api/predictions/daily-picks/history',
            '/api/predictions/active-management',
            '/api/predictions/<id>/management',
            '/api/predictions/management/refresh',
        ],
    })
