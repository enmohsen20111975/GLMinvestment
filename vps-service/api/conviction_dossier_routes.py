#!/usr/bin/env python3
"""
conviction_dossier_routes.py — ملف الأدلة والبراهين (Conviction Dossier)
=================================================================================
Task BRAVO-CONVICTION-DOSSIER (Owner Directive 2026-10-15)

المشكلة: شاشة التوقعات بترمي "شراء فوري" للعميل من غير ما تقوله مين الحوت
اللي اشترى، والمنصة كسبت في السهم ده كام مرة، وإيه الدليل الفني والحسابي.

الحل: كل كارت توصية يكون فيه زرار "ملف الأدلة والبراهين 📂" يفتح Drawer
يعرض 4 طبقات:
  1. برهان سيولة الحيتان: آخر 5 جلسات (التاريخ، صافي الكاش، الحجم).
  2. سجل النزاهة: نسبة نجاح توصيات المنصة السابقة على نفس السهم.
  3. هندسة المخاطرة: الدخول، الوقف، الأهداف، R/R، المخاطرة والمكافأة بالجنيه.
  4. التفسير المؤسسي: جملتان صريحتان بلغة السوق.

Endpoint (Blueprint `conviction_dossier_bp`):
    GET /api/recommendations/dossier/<ticker>

Rule 20: Python = brain. Next.js route is a thin proxy.
Rule 27: NO-FAKE-DATA — كل رقم من DB؛ لو ناقص → null + reason واضح.
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify

_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from utils.db_paths import DBPaths  # noqa: E402
from api.canonical_flow import classify_liquidity_bucket  # noqa: E402

logger = logging.getLogger(__name__)

conviction_dossier_bp = Blueprint('conviction_dossier_bp', __name__)


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
    cur = conn.execute(sql, params)
    row = cur.fetchone()
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return {cols[i]: row[i] for i in range(len(cols))}


def _fetch_latest_trade_setup(conn: sqlite3.Connection, ticker: str) -> Optional[Dict[str, Any]]:
    return _query_row(
        conn,
        """
        SELECT ticker, signal, entry_price, target_price, stop_loss,
               risk_reward, master_score, analysis_json, analysis_date, updated_at
        FROM cached_analysis
        WHERE ticker = ?
        ORDER BY COALESCE(updated_at, analysis_date, '0') DESC
        LIMIT 1
        """,
        (ticker,),
    )


def _compute_historical_win_rate(conn: sqlite3.Connection, ticker: str) -> Dict[str, Any]:
    """Win rate from real_evaluated_predictions (hit_target=1 → win, hit_stop=1 → loss)."""
    try:
        row = _query_row(
            conn,
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) AS losses
            FROM real_evaluated_predictions
            WHERE ticker = ?
            """,
            (ticker,),
        )
    except sqlite3.Error as e:
        logger.warning(f'[dossier] win_rate query failed for {ticker}: {e}')
        return {
            'total_recommendations': 0, 'wins': 0, 'losses': 0,
            'win_rate_pct': 0.0, 'last_outcome': None, 'last_outcome_date': None,
        }

    if not row:
        return {
            'total_recommendations': 0, 'wins': 0, 'losses': 0,
            'win_rate_pct': 0.0, 'last_outcome': None, 'last_outcome_date': None,
        }

    total = int(row.get('total') or 0)
    wins = int(row.get('wins') or 0)
    losses = int(row.get('losses') or 0)
    win_rate = round((wins / total) * 100.0, 1) if total > 0 else 0.0

    # Last outcome
    last_outcome: Optional[str] = None
    last_outcome_date: Optional[str] = None
    try:
        last = _query_row(
            conn,
            """
            SELECT hit_target, hit_stop, return_pct, evaluated_at
            FROM real_evaluated_predictions
            WHERE ticker = ?
            ORDER BY evaluated_at DESC
            LIMIT 1
            """,
            (ticker,),
        )
        if last:
            if last.get('hit_target') == 1:
                last_outcome = 'win'
            elif last.get('hit_stop') == 1:
                last_outcome = 'loss'
            else:
                last_outcome = 'open'
            last_outcome_date = last.get('evaluated_at')
    except sqlite3.Error:
        pass

    return {
        'total_recommendations': total,
        'wins': wins,
        'losses': losses,
        'win_rate_pct': win_rate,
        'last_outcome': last_outcome,
        'last_outcome_date': last_outcome_date,
    }


def _build_technical_rationale(
    stock: Optional[Dict[str, Any]],
    classification: Dict[str, Any],
    trade: Optional[Dict[str, Any]],
) -> str:
    """Two-sentence Arabic rationale built from real DB values (Rule 27)."""
    if not stock:
        return '\u0628\u064a\u0627\u0646\u0627\u062a \u063a\u064a\u0631 \u0643\u0627\u0641\u064a\u0629 \u0644\u062a\u0641\u0633\u064a\u0631 \u0645\u0641\u0635\u0644.'

    current_price = _to_float(stock.get('current_price'))
    support = _to_float(stock.get('support'))
    resistance = _to_float(stock.get('resistance'))
    rsi = _to_float(stock.get('rsi')) if stock.get('rsi') else None
    net_flow = classification.get('net_flow_5d', 0.0)
    bucket_ar = classification.get('bucket_ar', '\u062d\u064a\u0627\u062f')

    parts: List[str] = []
    if support > 0 and current_price > 0:
        dist = ((current_price - support) / support) * 100.0 if support > 0 else 0.0
        parts.append(
            f'\u0627\u0644\u0633\u0639\u0631 {current_price:.2f} \u064a\u0628\u0639\u062f {dist:.1f}% \u0639\u0646 \u062f\u0639\u0645 {support:.2f}'
        )
    if net_flow != 0:
        sign = '\u062f\u062e\u0648\u0644' if net_flow > 0 else '\u062e\u0631\u0648\u062c'
        parts.append(
            f'\u0635\u0627\u0641\u064a \u062a\u062f\u0641\u0642 \u062d\u064a\u0627\u0646 5 \u062c\u0644\u0633\u0627\u062a {abs(net_flow)/1e6:.1f}M \u062c.\u0645 ({sign})'
        )
    if rsi is not None and rsi > 0:
        parts.append(f'RSI \u0639\u0646\u062f {rsi:.1f}')

    sentence1 = '\u060c '.join(parts) + '.' if parts else '\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a \u0641\u0646\u064a\u0629 \u0643\u0627\u0641\u064a\u0629.'

    # Sentence 2: bucket + trade context
    signal = (trade or {}).get('signal') or '\u0644\u0627 \u0625\u0634\u0627\u0631\u0629'
    rr = (trade or {}).get('risk_reward')
    rr_str = f'R/R {float(rr):.2f}' if rr is not None else '\u0644\u0627 R/R'
    sentence2 = f'\u0627\u0644\u062a\u0635\u0646\u064a\u0641 \u0627\u0644\u0643\u0646\u0633\u064a: {bucket_ar} \u2014 \u0625\u0634\u0627\u0631\u0629 {signal} \u0645\u0639 {rr_str}.'

    return sentence1 + ' ' + sentence2


def _build_trade_math(
    trade: Optional[Dict[str, Any]],
    stock: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Risk-engineering math: entry, stop, targets, RR, per-share risk/reward."""
    if not trade:
        return {
            'entry_price': None, 'stop_loss': None, 'target_1': None, 'target_2': None,
            'rr_ratio': None, 'signal': None,
            'risk_egp_per_share': None, 'reward_egp_per_share': None,
        }
    entry = _to_float(trade.get('entry_price'))
    stop = _to_float(trade.get('stop_loss'))
    target = _to_float(trade.get('target_price'))
    rr_raw = trade.get('risk_reward')
    signal = (trade.get('signal') or '').strip().upper()

    rr: Optional[float] = None
    if rr_raw is not None:
        try:
            rr = float(rr_raw)
        except (ValueError, TypeError):
            rr = None
    if rr is None and entry > 0 and stop > 0 and target > 0 and stop < entry and target > entry:
        rr = round((target - entry) / (entry - stop), 2)

    risk_per_share = round(entry - stop, 4) if (entry > 0 and stop > 0 and stop < entry) else None
    reward_per_share = round(target - entry, 4) if (entry > 0 and target > 0 and target > entry) else None

    return {
        'entry_price': round(entry, 4) if entry > 0 else None,
        'stop_loss': round(stop, 4) if stop > 0 else None,
        'target_1': round(target, 4) if target > 0 else None,
        'target_2': None,  # cached_analysis has no target_2; populated when available
        'rr_ratio': rr,
        'signal': signal or None,
        'risk_egp_per_share': risk_per_share,
        'reward_egp_per_share': reward_per_share,
    }


# ─── Endpoint ────────────────────────────────────────────────────────────────

@conviction_dossier_bp.route('/api/recommendations/dossier/<string:ticker>', methods=['GET'])
def conviction_dossier(ticker: str):
    """GET /api/recommendations/dossier/<ticker> — 4-layer evidence dossier."""
    tkr = (ticker or '').strip().upper()
    if not tkr:
        return jsonify({'success': False, 'error': 'missing_ticker'}), 400

    try:
        conn = _get_stocks_conn()
        try:
            stock = _query_row(
                conn,
                """
                SELECT ticker, name, name_ar, market, sector, current_price,
                       change_percent, support, resistance, rsi, ma_50, ma_200,
                       high_52w, low_52w, volume
                FROM stocks
                WHERE ticker = ?
                LIMIT 1
                """,
                (tkr,),
            )
            if not stock:
                return jsonify({
                    'success': False,
                    'error': 'stock_not_found',
                    'ticker': tkr,
                }), 404

            trade = _fetch_latest_trade_setup(conn, tkr)
            classification = classify_liquidity_bucket(
                tkr, stock.get('market') or 'EGX', conn=conn
            )

            whale_history: List[Dict[str, Any]] = classification.get('whale_flow_history', [])
            # Enrich with cumulative total
            total_inflow = sum(h.get('net_flow_egp', 0) for h in whale_history)

            win_rate = _compute_historical_win_rate(conn, tkr)
            trade_math = _build_trade_math(trade, stock)
            rationale = _build_technical_rationale(stock, classification, trade)

            return jsonify({
                'success': True,
                'ticker': tkr,
                'name_ar': stock.get('name_ar') or stock.get('name') or tkr,
                'sector': stock.get('sector') or '\u0645\u062a\u0641\u0631\u0642\u0627\u062a',
                'liquidity_bucket': classification['bucket'],
                'liquidity_bucket_ar': classification['bucket_ar'],
                'whale_flow_history': whale_history,
                'whale_total_5d_egp': round(total_inflow, 0),
                'historical_win_rate': win_rate,
                'trade_math': trade_math,
                'technical_rationale': rationale,
                'computed_at': _now_iso(),
            })
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.error(f'[dossier] db error for {tkr}: {e}')
        return jsonify({
            'success': False,
            'error': 'db_unavailable',
            'error_ar': '\u062a\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b.',
            'detail': str(e),
        }), 503


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat()


__all__ = ['conviction_dossier_bp']
