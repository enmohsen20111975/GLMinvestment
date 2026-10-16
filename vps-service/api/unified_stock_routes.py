#!/usr/bin/env python3
"""
unified_stock_routes.py — العرض الموحّد للسهم (State Machine)
=================================================================================
Task BRAVO-UNIFIED-STOCK (Owner Directive 2026-10-15)

الهدف: إنهاء كارثة كارت ACFR (الشُرَط الفاضية والكروت المكررة). الشيت له
حالتان لا ثالث لهما:

  (أ) has_active_trade === true:
      صفقة نشطة مكتملة الشروط (entry>0, stop<entry, target>entry, R/R>=1.5,
      signal BUY, current_price > low_52w). يُرجع trade_setup كامل.

  (ب) has_active_trade === false:
      كاش وانتظار ومراقبة. يُرجع observation_status + observation_reason.
      ممنوع إرجاع أرقام دخول/وقف/هدف وهمية.

Rule 78 (IRON): لو السهم يكسر قاعه السنوي (current_price <= low_52w) →
                has_active_trade = false منعاً باتاً.

Endpoint (Blueprint `unified_stock_bp`):
    GET /api/stocks/<ticker>/unified

Rule 20: Python = brain. Next.js route is a thin proxy + local fallback.
Rule 27: NO-FAKE-DATA — كل رقم من DB؛ لو ناقص → null + reason.
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify

_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from utils.db_paths import DBPaths  # noqa: E402
from api.canonical_flow import (  # noqa: E402
    classify_liquidity_bucket,
    BUCKET_LABEL_AR,
)

logger = logging.getLogger(__name__)

unified_stock_bp = Blueprint('unified_stock_bp', __name__)


# ─── Trade-setup thresholds (Rule 78 + owner directive) ─────────────────────
MIN_RR_RATIO: float = 1.5
ACTIVE_SIGNALS = {'BUY', 'STRONG_BUY', 'ACCUMULATE', 'STRONG BUY'}


# ─── DB helpers (robust to any connection — no row_factory dependency) ───────

def _get_stocks_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DBPaths.STOCKS_DB, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('\u2212', '-').replace('\u060c', '').strip())
    except (ValueError, TypeError):
        return default


def _query_row(conn: sqlite3.Connection, sql: str, params: tuple) -> Optional[Dict[str, Any]]:
    """Run a SELECT and return the first row as a dict (robust to row_factory)."""
    cur = conn.execute(sql, params)
    row = cur.fetchone()
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return {cols[i]: row[i] for i in range(len(cols))}


def _fetch_stock_info(conn: sqlite3.Connection, ticker: str) -> Optional[Dict[str, Any]]:
    return _query_row(
        conn,
        """
        SELECT ticker, name, name_ar, market, sector, current_price,
               change_percent, volume, avg_volume, support, resistance,
               ma_50, ma_200, rsi, high_52w, low_52w, signal, previous_close
        FROM stocks
        WHERE ticker = ?
        LIMIT 1
        """,
        (ticker,),
    )


def _fetch_latest_trade_setup(conn: sqlite3.Connection, ticker: str) -> Optional[Dict[str, Any]]:
    """Latest trade setup from cached_analysis (entry/target/stop/RR/signal)."""
    return _query_row(
        conn,
        """
        SELECT ticker, signal, entry_price, target_price, stop_loss,
               risk_reward, target_price as target_1, target_price as target_2,
               master_score, analysis_json, analysis_date, updated_at
        FROM cached_analysis
        WHERE ticker = ?
        ORDER BY COALESCE(updated_at, analysis_date, '0') DESC
        LIMIT 1
        """,
        (ticker,),
    )


# ─── State machine ──────────────────────────────────────────────────────────

def _evaluate_active_trade(
    trade: Optional[Dict[str, Any]],
    current_price: float,
    low_52w: Optional[float],
) -> Dict[str, Any]:
    """Decide has_active_trade + build trade_setup OR observation fields.

    Rule 78: if current_price <= low_52w → NEVER active (falling knife guard).
    """
    # Default = observation mode
    observation_default = {
        'has_active_trade': False,
        'trade_setup': None,
        'observation_status': '\u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629: \u0643\u0627\u0634 \u0648\u0627\u0646\u062a\u0638\u0627\u0631 \u23f8\ufe0f',
        'observation_reason': '\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u0642\u0637\u0629 \u062f\u062e\u0648\u0644 \u0622\u0645\u0646\u0629 \u0628\u0634\u0631\u0648\u0637 \u0627\u0644\u0645\u0646\u0635\u0629 \u062d\u0627\u0644\u064a\u0627\u064b (\u0644\u0627 \u0635\u0641\u0642\u0629 \u0645\u062e\u0632\u0651\u0646\u0629 \u0645\u0643\u062a\u0645\u0644\u0629 \u0627\u0644\u0634\u0631\u0648\u0637).',
    }

    # Rule 78: breaking 52w low → NEVER active
    if low_52w is not None and low_52w > 0 and current_price <= low_52w:
        return {
            'has_active_trade': False,
            'trade_setup': None,
            'observation_status': '\u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629: \u0643\u0627\u0634 \u0648\u0627\u0646\u062a\u0638\u0627\u0631 \u23f8\ufe0f',
            'observation_reason': (
                f'\u0627\u0644\u0633\u0639\u0631 {current_price:.2f} \u0643\u0633\u0631 \u0642\u0627\u0639 52 \u0623\u0633\u0628\u0648\u0639 ({low_52w:.2f}) \u2014 '
                f'\u0633\u0643\u064a\u0646 \u0633\u0627\u0642\u0637 (Rule 78): \u0645\u0645\u0646\u0648\u0639 \u0625\u0637\u0644\u0627\u0642 \u062a\u0648\u0635\u064a\u0629 \u0634\u0631\u0627\u0621.'
            ),
        }

    if not trade:
        return observation_default

    entry = _to_float(trade.get('entry_price'))
    stop = _to_float(trade.get('stop_loss'))
    target = _to_float(trade.get('target_price'))
    target_2_raw = trade.get('target_price_2')
    target_2 = _to_float(target_2_raw) if target_2_raw is not None else None
    rr = trade.get('risk_reward')
    signal = (trade.get('signal') or '').strip().upper()

    # Compute R/R if missing but levels are valid
    rr_val: Optional[float] = None
    if rr is not None:
        try:
            rr_val = float(rr)
        except (ValueError, TypeError):
            rr_val = None
    if rr_val is None and entry > 0 and stop > 0 and target > 0 and stop < entry and target > entry:
        rr_val = round((target - entry) / (entry - stop), 2)

    # Validate ALL conditions for an active trade
    conditions_met = (
        entry > 0
        and stop > 0
        and target > 0
        and stop < entry
        and target > entry
        and rr_val is not None
        and rr_val >= MIN_RR_RATIO
        and signal in ACTIVE_SIGNALS
    )

    if not conditions_met:
        # Build a precise observation reason
        reasons = []
        if entry <= 0:
            reasons.append('\u0644\u0627 \u0633\u0639\u0631 \u062f\u062e\u0648\u0644')
        if stop <= 0:
            reasons.append('\u0644\u0627 \u0648\u0642\u0641')
        if target <= 0:
            reasons.append('\u0644\u0627 \u0647\u062f\u0641')
        if entry > 0 and stop > 0 and stop >= entry:
            reasons.append('\u0627\u0644\u0648\u0642\u0641 \u0641\u0648\u0642 \u0627\u0644\u062f\u062e\u0648\u0644')
        if entry > 0 and target > 0 and target <= entry:
            reasons.append('\u0627\u0644\u0647\u062f\u0641 \u062a\u062d\u062a \u0627\u0644\u062f\u062e\u0648\u0644')
        if rr_val is not None and rr_val < MIN_RR_RATIO:
            reasons.append(f'R/R \u063a\u064a\u0631 \u0645\u062c\u0632\u064a\u0629 ({rr_val:.2f} < {MIN_RR_RATIO:.1f})')
        if signal and signal not in ACTIVE_SIGNALS:
            reasons.append(f'\u0625\u0634\u0627\u0631\u0629 {signal} \u063a\u064a\u0631 \u0635\u0627\u0644\u062d\u0629 \u0644\u0644\u0634\u0631\u0627\u0621')
        if not signal:
            reasons.append('\u0644\u0627 \u0625\u0634\u0627\u0631\u0629')
        reason_str = '\u060c '.join(reasons) if reasons else '\u0634\u0631\u0648\u0637 \u063a\u064a\u0631 \u0645\u0643\u062a\u0645\u0644\u0629'
        return {
            'has_active_trade': False,
            'trade_setup': None,
            'observation_status': '\u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629: \u0643\u0627\u0634 \u0648\u0627\u0646\u062a\u0638\u0627\u0631 \u23f8\ufe0f',
            'observation_reason': reason_str + '.',
        }

    # Active trade — build trade_setup
    return {
        'has_active_trade': True,
        'trade_setup': {
            'entry_price': round(entry, 4),
            'stop_loss': round(stop, 4),
            'target_1': round(target, 4),
            'target_2': round(target_2, 4) if target_2 and target_2 > target else None,
            'rr_ratio': rr_val,
            'signal': signal,
        },
        'observation_status': None,
        'observation_reason': None,
    }


# ─── Endpoint ────────────────────────────────────────────────────────────────

@unified_stock_bp.route('/api/stocks/<string:ticker>/unified', methods=['GET'])
def unified_stock(ticker: str):
    """GET /api/stocks/<ticker>/unified

    Returns the state-machine shape:
      { success, ticker, has_active_trade, observation_status, observation_reason,
        trade_setup, stock_info }
    """
    tkr = (ticker or '').strip().upper()
    if not tkr:
        return jsonify({'success': False, 'error': 'missing_ticker'}), 400

    try:
        conn = _get_stocks_conn()
        try:
            stock = _fetch_stock_info(conn, tkr)
            if not stock:
                return jsonify({
                    'success': False,
                    'error': 'stock_not_found',
                    'ticker': tkr,
                    'has_active_trade': False,
                    'observation_status': '\u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f',
                    'observation_reason': f'\u0627\u0644\u0633\u0647\u0645 {tkr} \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.',
                    'trade_setup': None,
                    'stock_info': None,
                }), 404

            trade = _fetch_latest_trade_setup(conn, tkr)

            current_price = _to_float(stock.get('current_price'))
            low_52w = _to_float(stock.get('low_52w')) if stock.get('low_52w') else None
            high_52w = _to_float(stock.get('high_52w')) if stock.get('high_52w') else None

            # Canonical liquidity classification (mutually-exclusive bucket + 5d flow + history)
            classification = classify_liquidity_bucket(tkr, stock.get('market') or 'EGX', conn=conn)

            trade_state = _evaluate_active_trade(trade, current_price, low_52w)

            stock_info = {
                'name_ar': stock.get('name_ar') or stock.get('name') or tkr,
                'name': stock.get('name') or tkr,
                'sector': stock.get('sector') or '\u0645\u062a\u0641\u0631\u0642\u0627\u062a',
                'market': stock.get('market') or 'EGX',
                'current_price': round(current_price, 4) if current_price > 0 else None,
                'change_pct': round(_to_float(stock.get('change_percent')), 4),
                'fair_value': None,  # Rule 27: not in stocks.db; data_engine.db absent in this env
                'sharia_compliant': None,  # Rule 27: not in stocks.db schema
                'whale_net_flow_5d': classification['net_flow_5d'],
                'liquidity_bucket': classification['bucket'],
                'liquidity_bucket_ar': classification['bucket_ar'],
                'support_level': round(_to_float(stock.get('support')), 4) if stock.get('support') else None,
                'resistance_level': round(_to_float(stock.get('resistance')), 4) if stock.get('resistance') else None,
                'low_52w': round(low_52w, 4) if low_52w else None,
                'high_52w': round(high_52w, 4) if high_52w else None,
                'volume': _to_float(stock.get('volume')),
                'avg_volume': _to_float(stock.get('avg_volume')) if stock.get('avg_volume') else None,
            }

            return jsonify({
                'success': True,
                'ticker': tkr,
                'has_active_trade': trade_state['has_active_trade'],
                'observation_status': trade_state['observation_status'],
                'observation_reason': trade_state['observation_reason'],
                'trade_setup': trade_state['trade_setup'],
                'stock_info': stock_info,
                'liquidity_reason': classification['reason'],
                'whale_flow_history': classification.get('whale_flow_history', []),
                'computed_at': _now_iso(),
            })
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.error(f'[unified_stock] db error for {tkr}: {e}')
        return jsonify({
            'success': False,
            'error': 'db_unavailable',
            'error_ar': '\u062a\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b.',
            'detail': str(e),
        }), 503


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat()


__all__ = ['unified_stock_bp']
