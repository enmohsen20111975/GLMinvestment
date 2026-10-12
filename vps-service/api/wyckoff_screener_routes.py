#!/usr/bin/env python3
"""
Wyckoff Screener API Routes
============================
Blueprint: `wyckoff_screener_bp`
Endpoint: GET /api/wyckoff-screener

P0-ALPHA-WYCKOFF-SCREENER-API (2026-10-12):
- يفحص كل أسهم EGX (is_active=1) عبر `detect_wyckoff_accumulation` من
  `utils.shared_liquidity` (Rule 67 — CALCULATION-CANONICAL).
- يرجع JSON {success, market, stocks[], phase_distribution, computed_at}.
- whale_flow_egp = SUM(volume * price) FROM intraday.db.stock_intraday
  لليوم (Rule 27 — NO-FAKE-DATA: لو لا يوجد data = 0).

Rule 20 (Python = brain): كل الـ computation هنا. الـ Node route مجرد thin proxy.
Rule 27 (NO-FAKE-DATA): لو لا يوجد data لسهم → skipه (مش اختلاق).
Rule 67 (CALCULATION-CANONICAL): استخدم `detect_wyckoff_accumulation` من
       shared_liquidity.py — ما يلعبش بـ logic مكرر.
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify

# ─── Path setup ─────────────────────────────────────────────────────────────
# Lightweight server runs from /vps-service, but if imported standalone, the
# parent of /vps-service must be on sys.path so `utils.*` resolves.
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from utils.db_paths import DBPaths  # noqa: E402
from utils.helpers import parse_volume  # noqa: E402
# Rule 67: canonical Wyckoff detector — single source of truth.
from utils.shared_liquidity import (  # noqa: E402
    detect_wyckoff_accumulation,
    WYCKOFF_LOOKBACK_DEFAULT,
    WYCKOFF_AVG_VOLUME_WINDOW,
)

logger = logging.getLogger(__name__)

wyckoff_screener_bp = Blueprint('wyckoff_screener', __name__)


# ─── Constants ───────────────────────────────────────────────────────────────

# All known Wyckoff phases returned by `detect_wyckoff_accumulation`.
ALL_PHASES: List[str] = [
    'A_SC', 'B_CAUSE', 'C_SPRING', 'D_SOS', 'CHURNING_WASH_TRADE', 'NONE',
]

# Phase → Arabic label ( Rule 73: single display source).
PHASE_LABEL_AR: Dict[str, str] = {
    'A_SC': 'هزة البيع القصوى (Selling Climax)',
    'B_CAUSE': 'بناء القاعدة (Cause Building)',
    'C_SPRING': 'هز الشجرة (Spring)',
    'D_SOS': 'إشارة قوة (Sign of Strength)',
    'CHURNING_WASH_TRADE': 'تدوير وتصريف (Wash Trade)',
    'NONE': 'لا توجد مرحلة واضحة',
}

# Sort priority (lower = first when ALL). CHURNING/NONE last so actionable
# phases surface to the top of the screener.
PHASE_SORT_PRIORITY: Dict[str, int] = {
    'D_SOS': 0,
    'C_SPRING': 1,
    'B_CAUSE': 2,
    'A_SC': 3,
    'NONE': 4,
    'CHURNING_WASH_TRADE': 5,
}

# We fetch a few extra days beyond the lookback so the Wyckoff detector has
# headroom for its internal windows (Spring detection window = 5 days, etc.).
_FETCH_DAYS = max(WYCKOFF_LOOKBACK_DEFAULT, WYCKOFF_AVG_VOLUME_WINDOW + 5) + 10

# Hard cap on `limit` query param (Rule 27: respect the spec's max).
_MAX_LIMIT = 50
_DEFAULT_LIMIT = 20


# ─── DB helpers ──────────────────────────────────────────────────────────────

def _get_stocks_conn() -> sqlite3.Connection:
    """Open a fresh read-only connection to stocks.db."""
    conn = sqlite3.connect(DBPaths.STOCKS_DB, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _get_intraday_conn() -> sqlite3.Connection:
    """Open a fresh read-only connection to intraday.db."""
    conn = sqlite3.connect(DBPaths.INTRADAY_DB, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_market(market: str) -> Tuple[str, str, List[str]]:
    """Resolve (sql_filter, label, extra_params).

    Returns (WHERE_clause_fragment, label, params).
    Uses IN clause so legacy values like 'مصر' match 'EGX' (production data
    has both). For `market=EGX30|EGX70|EGX100`, also adds the matching
    `is_egx30|is_egx70|is_egx100 = 1` filter so the caller can scope to the
    index constituents.
    """
    m = (market or 'EGX').strip().upper()
    base = "market IN ('EGX', 'مصر')"
    if m in ('EGX', 'EGX30', 'EGX70', 'EGX100'):
        if m == 'EGX30':
            where = f"{base} AND is_egx30 = 1"
        elif m == 'EGX70':
            where = f"{base} AND is_egx70 = 1"
        elif m == 'EGX100':
            where = f"{base} AND is_egx100 = 1"
        else:  # EGX (default — all EGX stocks)
            where = base
        return (where, 'EGX', [])
    # Other markets (e.g. 'TASI') → exact match.
    return ("market = ?", m, [m])


def _fetch_active_tickers(conn: sqlite3.Connection, market: str) -> List[Dict[str, Any]]:
    """Read active stocks for a given market. Rule 27: skip is_active=0."""
    where, label, extra_params = _normalize_market(market)
    # Read both `ticker` and `name_ar`. Note `name_ar` may be NULL on some rows —
    # we coerce to '' at the call site (Rule 27: never invent a name).
    rows = conn.execute(
        f"""
        SELECT ticker, name_ar
        FROM stocks
        WHERE is_active = 1
          AND current_price > 0
          AND {where}
        ORDER BY ticker ASC
        """,
        tuple(extra_params),
    ).fetchall()
    return [{'ticker': r['ticker'], 'name_ar': r['name_ar'] or ''} for r in rows]


def _fetch_ohlcv(
    conn: sqlite3.Connection,
    ticker: str,
    days: int = _FETCH_DAYS,
) -> Tuple[List[float], List[float], List[float], List[float]]:
    """Read last `days` of OHLCV from stock_daily_prices (ASC).

    Returns (closes, highs, lows, volumes). Filters out rows where close or
    volume is NULL/zero (Rule 27: don't fabricate candles).
    """
    # Pre-allocate, then walk through rows in order. The Wyckoff detector
    # falls back to a proxy (max/min of consecutive closes) ONLY when the
    # whole highs/lows list is None or short — but if any single candle has
    # high=NULL it would mix types and crash `min(lows)`. We apply the same
    # proxy per-candle here so the lists are always fully populated.
    closes: List[float] = []
    highs: List[Optional[float]] = []
    lows: List[Optional[float]] = []
    volumes: List[float] = []

    raw_rows = conn.execute(
        """
        SELECT close, high, low, volume
        FROM stock_daily_prices
        WHERE ticker = ?
          AND close IS NOT NULL
          AND close > 0
          AND volume IS NOT NULL
        ORDER BY price_date ASC
        LIMIT ?
        """,
        (ticker, days),
    ).fetchall()

    for r in raw_rows:
        try:
            c = float(r['close'])
        except (TypeError, ValueError):
            continue
        v = parse_volume(r['volume'])
        if v <= 0:
            # Rule 27: skip candles with no volume (can't be used by the detector).
            continue
        try:
            h = float(r['high']) if r['high'] is not None else None
        except (TypeError, ValueError):
            h = None
        try:
            l = float(r['low']) if r['low'] is not None else None
        except (TypeError, ValueError):
            l = None
        closes.append(c)
        highs.append(h)
        lows.append(l)
        volumes.append(float(v))

    # Substitute per-candle None highs/lows with the same proxy the detector
    # uses for the whole-list-None case (max/min of consecutive closes). This
    # prevents `min(lows)` / `max(highs)` from crashing on mixed types.
    if closes:
        for i in range(len(closes)):
            if highs[i] is None:
                highs[i] = max(closes[i], closes[i - 1]) if i > 0 else closes[i]
            if lows[i] is None:
                lows[i] = min(closes[i], closes[i - 1]) if i > 0 else closes[i]

    return closes, highs, lows, volumes  # type: ignore[return-value]


def _fetch_whale_flow_egp(ticker: str, today_str: str) -> float:
    """Compute today's whale-flow EGP = SUM(volume * price) from intraday.db.

    Rule 27: returns 0.0 when no intraday data (e.g. before market open or
    on holidays). Never fabricated.
    """
    try:
        conn = _get_intraday_conn()
        try:
            row = conn.execute(
                """
                SELECT SUM(CAST(volume AS REAL) * CAST(price AS REAL)) AS flow
                FROM stock_intraday
                WHERE ticker = ?
                  AND substr(timestamp, 1, 10) = ?
                """,
                (ticker, today_str),
            ).fetchone()
        finally:
            conn.close()
        if not row or row['flow'] is None:
            return 0.0
        try:
            return float(row['flow'])
        except (TypeError, ValueError):
            return 0.0
    except sqlite3.Error as e:
        logger.warning(f"[wyckoff] intraday.db read failed for {ticker}: {e}")
        return 0.0


# ─── Confidence scoring ─────────────────────────────────────────────────────

def _compute_confidence(details: Dict[str, Any], phase: str) -> int:
    """Compute a 0-100 confidence score from the detector's `details` dict.

    Weighting:
      +25  in_support_zone (price near support)
      +25  vsa_confirmed (up-volume > down-volume = accumulation)
      +20  phase != NONE (a real Wyckoff phase was detected)
      +15  phase == D_SOS (strongest actionable signal)
      +15  phase == C_SPRING (Spring / Shakeout)
      +10  phase == B_CAUSE (Cause Building)
      +5   phase == A_SC (Selling Climax)
      +5   per signal detected (max +15)
       0   if phase == CHURNING_WASH_TRADE (wash = exit/warn, not accumulate)
    Clamped to [0, 100].
    """
    if phase == 'CHURNING_WASH_TRADE':
        return 0
    score = 0
    if details.get('in_support_zone'):
        score += 25
    if details.get('vsa_confirmed'):
        score += 25
    if phase != 'NONE':
        score += 20
    score += {
        'D_SOS': 15,
        'C_SPRING': 15,
        'B_CAUSE': 10,
        'A_SC': 5,
        'NONE': 0,
    }.get(phase, 0)
    sig_count = int(details.get('signal_count') or 0)
    score += min(sig_count * 5, 15)
    return max(0, min(100, score))


# ─── Endpoint ────────────────────────────────────────────────────────────────

@wyckoff_screener_bp.route('/api/wyckoff-screener', methods=['GET'])
def wyckoff_screener():
    """GET /api/wyckoff-screener?market=EGX&phase_filter=C_SPRING&limit=20

    Query params:
      - market       (default 'EGX')  — EGX | EGX30 | EGX70 | EGX100 | <any>
      - phase_filter (default 'ALL')   — ALL | A_SC | B_CAUSE | C_SPRING | D_SOS |
                                         CHURNING_WASH_TRADE | NONE
      - limit        (default 20, max 50)

    Returns JSON:
      {
        success: True,
        market: 'EGX',
        stocks: [ {ticker, name_ar, phase, phase_label_ar, confidence,
                   whale_flow_egp, support, resistance, in_support_zone,
                   vsa_confirmed, wash_trade_detected, signal_count}, ... ],
        phase_distribution: {A_SC: N, B_CAUSE: N, ...},
        computed_at: ISO8601,
        scanned_count: N,
      }

    Rule 20: This is the brain. Node route is a thin proxy.
    Rule 27: stocks with insufficient data are skipped (not invented).
    Rule 67: uses `detect_wyckoff_accumulation` from shared_liquidity.py.
    """
    market = (request.args.get('market') or 'EGX').strip() or 'EGX'
    phase_filter = (request.args.get('phase_filter') or 'ALL').strip().upper() or 'ALL'
    try:
        limit_raw = int(request.args.get('limit') or _DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit_raw = _DEFAULT_LIMIT
    limit = max(1, min(_MAX_LIMIT, limit_raw))

    if phase_filter not in ('ALL', *ALL_PHASES):
        return jsonify({
            'success': False,
            'error': 'invalid_phase_filter',
            'error_ar': f'phase_filter لازم يكون ALL أو واحد من {ALL_PHASES}',
            'received': phase_filter,
        }), 400

    try:
        conn = _get_stocks_conn()
        try:
            active = _fetch_active_tickers(conn, market)
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.error(f"[wyckoff] stocks.db read failed: {e}")
        return jsonify({
            'success': False,
            'error': 'db_unavailable',
            'error_ar': 'تعذّر قراءة قاعدة بيانات الأسهم. حاول لاحقاً.',
            'detail': str(e),
        }), 503

    today_str = datetime.now().strftime('%Y-%m-%d')
    scanned = 0
    skipped = 0
    stocks_out: List[Dict[str, Any]] = []
    phase_distribution: Dict[str, int] = {p: 0 for p in ALL_PHASES}

    try:
        stocks_conn = _get_stocks_conn()
        try:
            for s in active:
                ticker = s['ticker']
                name_ar = s.get('name_ar') or ''
                scanned += 1

                closes, highs, lows, volumes = _fetch_ohlcv(stocks_conn, ticker)
                # Rule 27: insufficient data → skip (do NOT invent candles).
                needed = max(WYCKOFF_LOOKBACK_DEFAULT, WYCKOFF_AVG_VOLUME_WINDOW + 5)
                if len(closes) < needed:
                    skipped += 1
                    # Still count under NONE for distribution transparency.
                    phase_distribution['NONE'] += 1
                    continue

                try:
                    is_signal, reason, details = detect_wyckoff_accumulation(
                        closes, volumes, highs, lows,
                        lookback=WYCKOFF_LOOKBACK_DEFAULT,
                    )
                except Exception as det_err:
                    logger.warning(
                        f"[wyckoff] detector raised for {ticker}: {det_err}"
                    )
                    skipped += 1
                    phase_distribution['NONE'] += 1
                    continue

                phase = details.get('phase', 'NONE')
                phase_distribution[phase] = phase_distribution.get(phase, 0) + 1

                # Apply phase_filter BEFORE building the per-stock payload so we
                # don't waste a whale_flow lookup on a filtered-out ticker.
                if phase_filter != 'ALL' and phase != phase_filter:
                    continue

                whale_flow_egp = _fetch_whale_flow_egp(ticker, today_str)

                confidence = _compute_confidence(details, phase)
                item = {
                    'ticker': ticker,
                    'name_ar': name_ar,
                    'phase': phase,
                    'phase_label_ar': PHASE_LABEL_AR.get(phase, phase),
                    'confidence': confidence,
                    'whale_flow_egp': int(round(whale_flow_egp)),
                    'support': details.get('support'),
                    'resistance': details.get('resistance'),
                    'range_pct': details.get('range_pct'),
                    'midpoint': details.get('midpoint'),
                    'lower_third': details.get('lower_third'),
                    'in_support_zone': bool(details.get('in_support_zone')),
                    'vsa_confirmed': bool(details.get('vsa_confirmed')),
                    'wash_trade_detected': bool(details.get('wash_trade_detected')),
                    'signal_count': int(details.get('signal_count') or 0),
                    'is_signal': bool(is_signal),
                    'reason': reason,
                    'avg_up_volume': details.get('avg_up_volume'),
                    'avg_down_volume': details.get('avg_down_volume'),
                    'avg_20d_volume': details.get('avg_20d_volume'),
                }
                stocks_out.append(item)
        finally:
            stocks_conn.close()
    except sqlite3.Error as e:
        logger.error(f"[wyckoff] mid-scan DB error: {e}")
        # Return what we have so far + the error as a non-fatal warning.
        return jsonify({
            'success': True,
            'market': market,
            'stocks': stocks_out,
            'phase_distribution': phase_distribution,
            'scanned_count': scanned,
            'skipped_count': skipped,
            'computed_at': datetime.now().isoformat(),
            'warning': f'db_error_mid_scan: {e}',
        })

    # Sort: phase priority ASC, then confidence DESC.
    stocks_out.sort(key=lambda x: (
        PHASE_SORT_PRIORITY.get(x['phase'], 99),
        -x['confidence'],
    ))

    # Apply limit AFTER sort (so we get the top-N actionable phases).
    truncated = len(stocks_out) > limit
    stocks_out = stocks_out[:limit]

    return jsonify({
        'success': True,
        'market': market,
        'phase_filter': phase_filter,
        'limit': limit,
        'stocks': stocks_out,
        'phase_distribution': phase_distribution,
        'scanned_count': scanned,
        'skipped_count': skipped,
        'returned_count': len(stocks_out),
        'truncated': truncated,
        'computed_at': datetime.now().isoformat(),
    })


__all__ = ['wyckoff_screener_bp', 'PHASE_LABEL_AR', 'ALL_PHASES']
