#!/usr/bin/env python3
"""
canonical_flow.py — المصنّف الكنسي للسيولة (Mutually Exclusive)
=================================================================================
Task BRAVO-CANONICAL-FLOW (Owner Directive 2026-10-15)

المشكلة: السهم الواحد كان بيظهر في "تجميع" و"تصريف" في نفس اليوم لأن كل
سكريبت بيصنّف بطريقته. الحل: دالة مركزية واحدة classify_liquidity_bucket()
هي الوحيدة اللي تصنّف. التصنيف حصري ومانع للتداخل — أول تطابق يكفي.

  1. whale_inflow          (تجميع حيتان)
  2. whale_outflow         (تصريف وهروب كاش)
  3. bottom_absorption     (تجميع قيعان هادئ)
  4. correction_exhaustion (نهاية تصحيح وارتداد)
  5. neutral               (حياد)

الشروط الرياضية الصارمة (Rule 67):
    whale_inflow:        net_flow_5d > +2,000,000 EGP AND current_price > MA20 AND RSI < 68
    whale_outflow:       net_flow_5d < -2,000,000 EGP AND (price < MA20 OR price < min(low_5d))
    bottom_absorption:   net_flow_5d > 0 AND price within 8% of 52w_low AND ATR < ATR_20d_avg
    correction_exhaustion: drop_15d >= 8% AND green engulfing AND today flow>0 AND RR>=1.8
    neutral:             else

Rule 20: Python = brain. Next.js route is a thin proxy.
Rule 27: NO-FAKE-DATA — بيانات ناقصة → neutral + reason.
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify

# ─── Path setup (so utils.* resolves) ───────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from utils.db_paths import DBPaths  # noqa: E402

logger = logging.getLogger(__name__)

canonical_flow_bp = Blueprint('canonical_flow_bp', __name__)


# ─── Constants (strict math thresholds) ─────────────────────────────────────

WHALE_INFLOW_MIN_EGP: float = 2_000_000.0
WHALE_OUTFLOW_MIN_EGP: float = -2_000_000.0
WHALE_INFLOW_RSI_MAX: float = 68.0
BOTTOM_ABSORPTION_52W_PROXIMITY_PCT: float = 8.0
CORRECTION_DROP_PCT: float = 8.0
CORRECTION_MIN_RR: float = 1.8
RSI_PERIOD: int = 14
ATR_PERIOD: int = 14
MA_PERIOD: int = 20
NET_FLOW_SESSIONS: int = 5

BUCKET_LABEL_AR: Dict[str, str] = {
    'whale_inflow': 'تجميع حيتان',
    'whale_outflow': 'تصريف وهروب كاش',
    'bottom_absorption': 'تجميع قيعان هادئ',
    'correction_exhaustion': 'نهاية تصحيح وارتداد',
    'neutral': 'حياد',
}
ALL_BUCKETS: List[str] = list(BUCKET_LABEL_AR.keys())


# ─── DB helpers ──────────────────────────────────────────────────────────────

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


def _fetch_stock_row(conn: sqlite3.Connection, ticker: str) -> Optional[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT ticker, name, name_ar, market, sector, current_price,
               change_percent, volume, avg_volume, support, resistance,
               ma_50, ma_200, rsi, high_52w, low_52w, signal
        FROM stocks
        WHERE ticker = ?
        LIMIT 1
        """,
        (ticker,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return {cols[i]: row[i] for i in range(len(cols))}


def _fetch_daily_candles(conn: sqlite3.Connection, ticker: str, days: int = 60) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT price_date, open, high, low, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date ASC
        LIMIT ?
        """,
        (ticker, days),
    )
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        d = {cols[i]: r[i] for i in range(len(cols))}
        out.append({
            'date': d['price_date'],
            'open': _to_float(d['open']),
            'high': _to_float(d['high']) if d['high'] is not None else _to_float(d['close']),
            'low': _to_float(d['low']) if d['low'] is not None else _to_float(d['close']),
            'close': _to_float(d['close']),
            'volume': _to_float(d['volume']),
        })
    return out


# ─── Indicators (Rule 67 — canonical math, no external libs) ────────────────

def _compute_ma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _compute_rsi(closes: List[float], period: int = RSI_PERIOD) -> Optional[float]:
    """Wilder's RSI."""
    if len(closes) < period + 1:
        return None
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            return 100.0
    rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
    return 100.0 - (100.0 / (1.0 + rs))


def _compute_atr(candles: List[Dict[str, Any]], period: int = ATR_PERIOD) -> Tuple[Optional[float], Optional[float]]:
    """Compute (atr_current, atr_20d_avg)."""
    if len(candles) < period + 1:
        return None, None
    trs: List[float] = []
    for i in range(1, len(candles)):
        h = candles[i]['high']
        l = candles[i]['low']
        pc = candles[i - 1]['close']
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return None, None
    atr_current = sum(trs[-period:]) / period
    avg_window = max(1, min(20, len(trs) // period))
    atr_avg = sum(trs[-period * avg_window:]) / max(1, period * avg_window)
    return atr_current, atr_avg


def _compute_net_flow_5d(candles: List[Dict[str, Any]]) -> Tuple[float, List[Dict[str, Any]]]:
    if not candles:
        return 0.0, []
    recent = candles[-NET_FLOW_SESSIONS:] if len(candles) >= NET_FLOW_SESSIONS else candles[:]
    total = 0.0
    history: List[Dict[str, Any]] = []
    for c in recent:
        close = c['close']
        open_ = c['open']
        vol = c['volume']
        if close <= 0 or vol <= 0:
            history.append({'date': c.get('date'), 'net_flow_egp': 0.0, 'volume': 0.0})
            continue
        value = vol * close
        if close > open_:
            flow = value
        elif close < open_:
            flow = -value
        else:
            flow = 0.0
        total += flow
        history.append({'date': c.get('date'), 'net_flow_egp': round(flow, 0), 'volume': round(vol, 0)})
    history.reverse()
    return round(total, 0), history


def _compute_drop_pct_15d(candles: List[Dict[str, Any]]) -> Optional[float]:
    if len(candles) < 2:
        return None
    recent = candles[-15:] if len(candles) >= 15 else candles[:]
    highs = [c['high'] for c in recent if c['high'] > 0]
    last_close = recent[-1]['close']
    if not highs or last_close <= 0:
        return None
    peak = max(highs)
    if peak <= 0:
        return None
    return ((peak - last_close) / peak) * 100.0


def _is_green_engulfing(candles: List[Dict[str, Any]]) -> bool:
    if len(candles) < 2:
        return False
    today = candles[-1]
    yesterday = candles[-2]
    if today['close'] <= today['open']:
        return False
    return (today['open'] <= yesterday['close'] and today['close'] >= yesterday['open'])


def _compute_expected_rr(entry: float, stop: Optional[float], target: Optional[float]) -> Optional[float]:
    if entry <= 0 or stop is None or stop <= 0 or target is None or target <= 0:
        return None
    if stop >= entry or target <= entry:
        return None
    risk = entry - stop
    reward = target - entry
    if risk <= 0:
        return None
    return round(reward / risk, 2)


def _normalize_market(market: str) -> Tuple[str, List[Any]]:
    m = (market or 'EGX').strip().upper()
    base = "market IN ('EGX', '\u0645\u0635\u0631')"  # 'EGX', 'مصر'
    if m in ('EGX', 'EGX30', 'EGX70', 'EGX100'):
        if m == 'EGX30':
            return (base + " AND is_egx30 = 1", [])
        if m == 'EGX70':
            return (base + " AND is_egx70 = 1", [])
        if m == 'EGX100':
            return (base + " AND is_egx100 = 1", [])
        return (base, [])
    return ("market = ?", [m])


# ─── The canonical classifier (single source of truth) ──────────────────────

def classify_liquidity_bucket(
    ticker: str,
    market: str,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    """Mutually-exclusive liquidity classification. First match wins.

    Rule 67: This is the ONLY sanctioned classifier.
    Rule 27: Insufficient data -> 'neutral' with a clear reason. Never fabricated.
    """
    own_conn = conn is None
    if own_conn:
        conn = _get_stocks_conn()
    try:
        stock = _fetch_stock_row(conn, ticker)
        if not stock:
            return _result(
                'neutral', 0.0, None, None, None, None, None, None, None, None, [],
                f'\u0627\u0644\u0633\u0647\u0645 {ticker} \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
            )

        candles = _fetch_daily_candles(conn, ticker, days=60)
        closes = [c['close'] for c in candles if c['close'] > 0]

        current_price = _to_float(stock.get('current_price'))
        low_52w = _to_float(stock.get('low_52w')) if stock.get('low_52w') else None
        high_52w = _to_float(stock.get('high_52w')) if stock.get('high_52w') else None
        db_rsi = _to_float(stock.get('rsi')) if stock.get('rsi') else None

        ma20 = _compute_ma(closes, MA_PERIOD)
        rsi = _compute_rsi(closes) or db_rsi
        atr_current, atr_avg = _compute_atr(candles)
        net_flow_5d, flow_history = _compute_net_flow_5d(candles)
        drop_15d = _compute_drop_pct_15d(candles)

        if len(closes) < 10 or current_price <= 0:
            return _result(
                'neutral', net_flow_5d, current_price if current_price > 0 else None,
                ma20, rsi, atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                '\u0628\u064a\u0627\u0646\u0627\u062a \u063a\u064a\u0631 \u0643\u0627\u0641\u064a\u0629 \u0644\u0644\u062a\u0635\u0646\u064a\u0641 (\u0623\u0642\u0644 \u0645\u0646 10 \u0634\u0645\u0648\u0639 \u0623\u0648 \u0644\u0627 \u0633\u0639\u0631 \u062d\u0627\u0644\u064a)',
            )

        # 1. whale_inflow
        if (
            net_flow_5d > WHALE_INFLOW_MIN_EGP
            and ma20 is not None
            and current_price > ma20
            and (rsi is None or rsi < WHALE_INFLOW_RSI_MAX)
        ):
            rsi_str = f'{rsi:.1f}' if rsi is not None else 'N/A'
            return _result(
                'whale_inflow', net_flow_5d, current_price, ma20, rsi,
                atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                f'\u0635\u0627\u0641\u064a \u062a\u062f\u0641\u0642 5 \u062c\u0644\u0633\u0627\u062a {net_flow_5d/1e6:+.2f}M \u062c.\u0645 (>{WHALE_INFLOW_MIN_EGP/1e6:.0f}M) '
                f'+ \u0627\u0644\u0633\u0639\u0631 {current_price:.2f} \u0641\u0648\u0642 MA20 {ma20:.2f} '
                f'+ RSI {rsi_str} (<{WHALE_INFLOW_RSI_MAX:.0f}) \u2014 \u062a\u062c\u0645\u064a\u0639 \u062d\u064a\u062a\u0627\u0646 \u0635\u0631\u064a\u062d',
            )

        # 2. whale_outflow
        recent_lows = [c['low'] for c in candles[-5:] if c['low'] > 0]
        min_low_5d = min(recent_lows) if recent_lows else None
        broke_below = (min_low_5d is not None and current_price < min_low_5d)
        if (
            net_flow_5d < WHALE_OUTFLOW_MIN_EGP
            and ((ma20 is not None and current_price < ma20) or broke_below)
        ):
            return _result(
                'whale_outflow', net_flow_5d, current_price, ma20, rsi,
                atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                f'\u0635\u0627\u0641\u064a \u062a\u062f\u0641\u0642 5 \u062c\u0644\u0633\u0627\u062a {net_flow_5d/1e6:+.2f}M \u062c.\u0645 (<{WHALE_OUTFLOW_MIN_EGP/1e6:.0f}M) '
                f'+ \u0627\u0644\u0633\u0639\u0631 \u062a\u062d\u062a MA20 \u0623\u0648 \u0643\u0633\u0631 \u0642\u0627\u0639 5 \u062c\u0644\u0633\u0627\u062a \u2014 \u062a\u0635\u0631\u064a\u0641 \u0648\u0647\u0631\u0648\u0628 \u0643\u0627\u0634',
            )

        # 3. bottom_absorption
        if low_52w and low_52w > 0:
            proximity_pct = ((current_price - low_52w) / low_52w) * 100.0
            in_proximity = proximity_pct <= BOTTOM_ABSORPTION_52W_PROXIMITY_PCT
            quiet_atr = (atr_current is not None and atr_avg is not None and atr_current < atr_avg)
            if net_flow_5d > 0 and in_proximity and quiet_atr:
                return _result(
                    'bottom_absorption', net_flow_5d, current_price, ma20, rsi,
                    atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                    f'\u0635\u0627\u0641\u064a \u062a\u062f\u0641\u0642 \u0645\u0648\u062c\u0628 {net_flow_5d/1e6:+.2f}M \u062c.\u0645 '
                    f'+ \u0627\u0644\u0633\u0639\u0631 {proximity_pct:.1f}% \u0641\u0648\u0642 \u0642\u0627\u0639 52 \u0623\u0633\u0628\u0648\u0639 ({low_52w:.2f}) '
                    f'+ ATR {atr_current:.2f} < \u0645\u062a\u0648\u0633\u0637\u0647 {atr_avg:.2f} \u2014 \u062a\u062c\u0645\u064a\u0639 \u0642\u064a\u0639\u0627\u0646 \u0647\u0627\u062f\u0626',
                )

        # 4. correction_exhaustion
        if (
            drop_15d is not None and drop_15d >= CORRECTION_DROP_PCT
            and _is_green_engulfing(candles)
            and net_flow_5d > 0
        ):
            recent_low_10 = min(
                (c['low'] for c in candles[-10:] if c['low'] > 0),
                default=current_price * 0.95,
            )
            expected_target = current_price + (current_price - recent_low_10)
            expected_rr = _compute_expected_rr(current_price, recent_low_10, expected_target)
            if expected_rr is not None and expected_rr >= CORRECTION_MIN_RR:
                return _result(
                    'correction_exhaustion', net_flow_5d, current_price, ma20, rsi,
                    atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                    f'\u0647\u0628\u0648\u0637 {drop_15d:.1f}% \u062e\u0644\u0627\u0644 15 \u062c\u0644\u0633\u0629 + \u0634\u0645\u0639\u0629 \u062e\u0636\u0631\u0627\u0621 \u0645\u0628\u062a\u0644\u0639\u0629 '
                    f'+ \u062a\u062f\u0641\u0642 \u0627\u0644\u064a\u0648\u0645 \u0645\u0648\u062c\u0628 + R/R \u0645\u062a\u0648\u0642\u0639 {expected_rr:.2f} \u2014 \u0646\u0647\u0627\u064a\u0629 \u062a\u0635\u062d\u064a\u062d \u0648\u0627\u0631\u062a\u062f\u0627\u062f',
                )

        # 5. neutral
        rsi_str = f'{rsi:.1f}' if rsi is not None else 'N/A'
        ma_str = f'{ma20:.2f}' if ma20 is not None else 'N/A'
        return _result(
            'neutral', net_flow_5d, current_price, ma20, rsi,
            atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
            f'\u0644\u0627 \u062a\u0646\u0637\u0628\u0642 \u0634\u0631\u0648\u0637 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a \u0627\u0644\u0623\u0631\u0628\u0639\u0629 \u0628\u0634\u062f\u0629 '
            f'(\u062a\u062f\u0641\u0642 {net_flow_5d/1e6:+.2f}M, MA20 {ma_str}, RSI {rsi_str}) \u2014 \u062d\u064a\u0627\u062f',
        )
    finally:
        if own_conn:
            conn.close()


def _result(
    bucket: str, net_flow_5d: float, current_price: Optional[float],
    ma20: Optional[float], rsi: Optional[float],
    atr: Optional[float], atr_avg: Optional[float],
    low_52w: Optional[float], high_52w: Optional[float],
    drop_15d: Optional[float], flow_history: List[Dict[str, Any]],
    reason: str,
) -> Dict[str, Any]:
    return {
        'bucket': bucket,
        'bucket_ar': BUCKET_LABEL_AR[bucket],
        'net_flow_5d': net_flow_5d,
        'reason': reason,
        'current_price': current_price,
        'ma20': ma20,
        'rsi': rsi,
        'atr': atr,
        'atr_20d_avg': atr_avg,
        'low_52w': low_52w,
        'high_52w': high_52w,
        'drop_15d_pct': drop_15d,
        'whale_flow_history': flow_history,
    }


# ─── Endpoint ────────────────────────────────────────────────────────────────

@canonical_flow_bp.route('/api/liquidity/buckets', methods=['GET'])
def liquidity_buckets():
    """GET /api/liquidity/buckets?market=EGX — 5 mutually-exclusive bucket lists."""
    market = (request.args.get('market') or 'EGX').strip() or 'EGX'
    try:
        conn = _get_stocks_conn()
        try:
            where, params = _normalize_market(market)
            rows = conn.execute(
                f"""
                SELECT ticker, name_ar, name, sector, market, current_price, change_percent, volume
                FROM stocks
                WHERE is_active = 1 AND current_price > 0 AND {where}
                ORDER BY ticker ASC
                """,
                tuple(params),
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.error(f'[canonical_flow] stocks.db read failed: {e}')
        return jsonify({
            'success': False, 'error': 'db_unavailable',
            'error_ar': '\u062a\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0642\u0627\u0639\u062f\u0629 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0623\u0633\u0647\u0645. \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b.',
            'detail': str(e),
        }), 503

    buckets: Dict[str, List[Dict[str, Any]]] = {b: [] for b in ALL_BUCKETS}
    scanned = 0
    try:
        conn = _get_stocks_conn()
        try:
            for r in rows:
                scanned += 1
                ticker = r['ticker']
                classification = classify_liquidity_bucket(ticker, market, conn=conn)
                buckets[classification['bucket']].append({
                    'ticker': ticker,
                    'name_ar': r['name_ar'] or r['name'] or ticker,
                    'sector': r['sector'] or '\u0645\u062a\u0641\u0631\u0642\u0627\u062a',
                    'market': r['market'],
                    'current_price': _to_float(r['current_price']),
                    'change_pct': _to_float(r['change_percent']),
                    'volume': _to_float(r['volume']),
                    'net_flow_5d': classification['net_flow_5d'],
                    'bucket_reason': classification['reason'],
                })
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.error(f'[canonical_flow] mid-scan DB error: {e}')
        return jsonify({
            'success': True, 'market': market, 'scanned_count': scanned,
            'whale_inflow': buckets['whale_inflow'],
            'whale_outflow': buckets['whale_outflow'],
            'bottom_absorption': buckets['bottom_absorption'],
            'correction_exhaustion': buckets['correction_exhaustion'],
            'neutral': buckets['neutral'],
            'counts': {b: len(buckets[b]) for b in ALL_BUCKETS},
            'computed_at': datetime.now().isoformat(),
            'warning': f'db_error_mid_scan: {e}',
        })

    for b in ALL_BUCKETS:
        buckets[b].sort(key=lambda x: -abs(x.get('net_flow_5d', 0)))

    return jsonify({
        'success': True, 'market': market, 'scanned_count': scanned,
        'whale_inflow': buckets['whale_inflow'],
        'whale_outflow': buckets['whale_outflow'],
        'bottom_absorption': buckets['bottom_absorption'],
        'correction_exhaustion': buckets['correction_exhaustion'],
        'neutral': buckets['neutral'],
        'counts': {b: len(buckets[b]) for b in ALL_BUCKETS},
        'computed_at': datetime.now().isoformat(),
    })


__all__ = [
    'canonical_flow_bp',
    'classify_liquidity_bucket',
    'BUCKET_LABEL_AR',
    'ALL_BUCKETS',
]
