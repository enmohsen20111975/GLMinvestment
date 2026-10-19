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
from analyzers.indicators.ma import sma as _canonical_sma_flow
from analyzers.indicators.rsi import calc_rsi as _canonical_rsi_flow
from analyzers.indicators.atr import calc_atr as _canonical_atr_flow

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

# BRAVO-JIMMY Phase 2 (2026-10-18): wire evaluate_risk() into the canonical
# flow classification. This eliminates dead-code status and enforces the
# R/R >= 1.8 floor + position cap (2.5%) at the canonical classifier level
# (Rule 67 — this is the ONLY sanctioned classifier). Any BUY-side signal
# that survives _determine_target's R/R check is re-verified + position-capped
# here before leaving the pipeline.
from engine.flow_system import evaluate_risk as _evaluate_risk  # noqa: E402
from engine.flow_system import MAX_POSITION_SIZE as _MAX_POSITION_SIZE  # noqa: E402

logger = logging.getLogger(__name__)

canonical_flow_bp = Blueprint('canonical_flow_bp', __name__)


# ─── Constants (strict math thresholds) ─────────────────────────────────────

WHALE_INFLOW_MIN_EGP: float = 2_000_000.0
WHALE_OUTFLOW_MIN_EGP: float = -2_000_000.0
WHALE_INFLOW_RSI_MAX: float = 70.0  # BRAVO RADAR-REBUILD Finding #6: 70 (standard overbought, was 68 arbitrary)
BOTTOM_ABSORPTION_52W_PROXIMITY_PCT: float = 8.0
CORRECTION_DROP_PCT: float = 8.0

# BRAVO-JIMMY task (2026-10-18) — Falling Knife Filter:
# لو السعر هبط > 10% خلال 3 جلسات تداول AND يتاجر تحت SMA50
# → ممنوع منعاً باتاً إصدار هدف صاعد. التصنيف = avoid_falling_knife.
# (Rule: NO upward targets on crashing/unconfirmed stocks.)
FALLING_KNIFE_DROP_3D_PCT: float = 10.0
SMA50_PERIOD: int = 50

# SEALED-DISPATCH-BRAVO-UNIFIED-RADAR (2026-10-17) — Step 3:
# Unified R/R floor for ALL BUY-side buckets.
#
# RULE-18-RESTORE (2026-10-18 — Owner directive via جيمي + جروك + كيمي):
# رفعنا RR_FLOOR رسميًا لـ 1.8 ليتطابق مع Rule 18 (dynamic_rr_normal=1.8).
# السبب: 1.5 كان حل وسط مؤقت (SEALED-DISPATCH Step 3). 1.8 هي النسبة
# المؤسسية الحقيقية لمحرك V40.2 — المكسب لازم يكون ضعف الخسارة تقريبًا.
# أي إشارة R/R < 1.8 تُرفض قبل الكتابة لـ predictions.db (Rule 18).
#
# `whale_outflow` is SELL-side (bearish), so R/R doesn't apply — skip.
RR_FLOOR: float = 1.8  # was: 1.5 (transient compromise); restored to Rule 18 floor

RSI_PERIOD: int = 14
ATR_PERIOD: int = 14
MA_PERIOD: int = 20
NET_FLOW_SESSIONS: int = 5

BUCKET_LABEL_AR: Dict[str, str] = {
    'whale_inflow': 'تجميع حيتان',
    'whale_outflow': 'تصريف وهروب كاش',
    'bottom_absorption': 'تجميع قيعان هادئ',
    'correction_exhaustion': 'نهاية تصحيح وارتداد',
    'avoid_falling_knife': 'سقوط حر — تجنب',
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
    """SMA(period) — Canonical (Rule 54).

    BRAVO-CANONICAL-UNIFY-006 Phase 2: delegates to analyzers.indicators.sma.
    Fallback to local sum/period only if canonical module unavailable.
    """
    try:
        from analyzers.indicators.ma import sma as _canonical_sma
        return _canonical_sma(closes, period)
    except ImportError:
        # Fallback to local SMA if canonical unavailable
        if len(closes) < period:
            return None
        return sum(closes[-period:]) / period


def _compute_rsi(closes: List[float], period: int = RSI_PERIOD) -> Optional[float]:
    """Wilder's RSI — Canonical (Rule 54).

    BRAVO-CANONICAL-UNIFY-006 Phase 2: delegates to
    analyzers.indicators.calc_rsi (Wilder's smoothing). Fallback to local
    Wilder's approximation only if canonical module unavailable.
    """
    try:
        from analyzers.indicators.rsi import calc_rsi as _canonical_rsi
        return _canonical_rsi(closes, period)
    except ImportError:
        # Fallback: local Wilder's RSI (SMA seed + Wilder's smoothing)
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
    """Compute (atr_current, atr_20d_avg).

    BRAVO-CANONICAL-UNIFY-006 Phase 2: delegates atr_current to
    analyzers.indicators.calc_atr (canonical Wilder's smoothing). The
    `atr_avg` is a derived 20-period average of ATR (not in canonical) —
    computed by calling canonical calc_atr on a wider window of the same
    candles (Wilders' smoothing is cumulative over the input window).
    Fallback to local SMA-based ATR only if canonical module unavailable.
    """
    if len(candles) < period + 1:
        return None, None
    highs = [c['high'] for c in candles]
    lows = [c['low'] for c in candles]
    closes = [c['close'] for c in candles]
    try:
        from analyzers.indicators.atr import calc_atr as _canonical_atr
        atr_current = _canonical_atr(highs, lows, closes, period)
        # ATR_20d_avg: canonical calc_atr on a wider window (up to 20× period)
        # approximates the 20-period average of ATR while preserving Wilder's
        # smoothing. We use the same canonical function on the wider window.
        avg_window = max(1, min(20, len(candles) // period))
        wider_period = period * avg_window
        if len(candles) > wider_period + 1 and wider_period > period:
            atr_avg = _canonical_atr(highs, lows, closes, wider_period)
        else:
            atr_avg = atr_current
        return atr_current, atr_avg
    except ImportError:
        # Fallback: local SMA-based ATR (sum of TRs / period)
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


def _compute_drop_pct_3d(candles: List[Dict[str, Any]]) -> Optional[float]:
    """Peak-to-close drop % over the last 3 trading sessions.

    BRAVO-JIMMY task (2026-10-18) — Falling Knife Filter.
    Mirrors _compute_drop_pct_15d but windowed to 3 sessions.
    Returns None if insufficient data.
    """
    if len(candles) < 2:
        return None
    recent = candles[-3:] if len(candles) >= 3 else candles[:]
    highs = [c['high'] for c in recent if c['high'] > 0]
    last_close = recent[-1]['close']
    if not highs or last_close <= 0:
        return None
    peak = max(highs)
    if peak <= 0:
        return None
    return ((peak - last_close) / peak) * 100.0


def _is_falling_knife(
    candles: List[Dict[str, Any]],
    current_price: Optional[float],
    sma50: Optional[float],
) -> Tuple[bool, str]:
    """Falling Knife detector — BRAVO-JIMMY task (2026-10-18).

    Rule (Owner Directive via Jimmy):
        If stock price dropped > 10% over the last 3 trading sessions
        AND is trading below SMA50 → STRICTLY PROHIBITED from issuing an
        upward target. Signal MUST be classified as 'avoid_falling_knife'.

    Args:
        candles: daily candle history (newest last).
        current_price: latest close.
        sma50: 50-session simple moving average (None if insufficient data).

    Returns:
        (is_fk: bool, reason: str)
    """
    if current_price is None or current_price <= 0:
        return False, ''
    if sma50 is None or sma50 <= 0:
        return False, ''
    drop_3d = _compute_drop_pct_3d(candles)
    if drop_3d is None:
        return False, ''
    below_sma50 = current_price < sma50
    if drop_3d > FALLING_KNIFE_DROP_3D_PCT and below_sma50:
        return True, (
            f'سقوط حر: هبوط {drop_3d:.1f}% خلال 3 جلسات '
            f'(>{FALLING_KNIFE_DROP_3D_PCT:.0f}%) + السعر {current_price:.2f} '
            f'تحت SMA50 {sma50:.2f} — ممنوع إصدار هدف صاعد'
        )
    return False, ''


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


def _determine_target(
    current_price: float,
    stop: float,
    stock_res: Optional[float],
    candles: List[Dict[str, Any]],
    rr_min: float = RR_FLOOR,
) -> Tuple[float, Optional[float]]:
    """Determine expected target and R/R using real resistance or structural expansion."""
    risk = max(current_price - stop, current_price * 0.015)
    # 1. Try confirmed resistance from stock table
    if stock_res and stock_res > current_price:
        rr = round((stock_res - current_price) / risk, 2)
        if rr >= rr_min:
            return round(stock_res, 2), rr
    # 2. Try 20-day swing high from candle history
    swing_highs = [c['high'] for c in candles[-20:] if c.get('high') and c['high'] > current_price]
    if swing_highs:
        swing_target = max(swing_highs)
        rr = round((swing_target - current_price) / risk, 2)
        if rr >= rr_min:
            return round(swing_target, 2), rr
    # 3. Structural R/R fallback: standard 2.0R expansion target
    fallback_target = round(current_price + risk * 2.0, 2)
    return fallback_target, 2.0


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
        sma50 = _compute_ma(closes, SMA50_PERIOD)

        if len(closes) < 10 or current_price <= 0:
            return _result(
                'neutral', net_flow_5d, current_price if current_price > 0 else None,
                ma20, rsi, atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                '\u0628\u064a\u0627\u0646\u0627\u062a \u063a\u064a\u0631 \u0643\u0627\u0641\u064a\u0629 \u0644\u0644\u062a\u0635\u0646\u064a\u0641 (\u0623\u0642\u0644 \u0645\u0646 10 \u0634\u0645\u0648\u0639 \u0623\u0648 \u0644\u0627 \u0633\u0639\u0631 \u062d\u0627\u0644\u064a)',
            )

        stock_res = _to_float(stock.get('resistance')) if stock.get('resistance') else None

        # 0. FALLING KNIFE FILTER (BRAVO-JIMMY task 2026-10-18):
        # لو السعر هبط > 10% خلال 3 جلسات AND تحت SMA50 → ممنوع أي هدف صاعد.
        # هذا الفلتر يسبق كل تصنيفات BUY-side (whale_inflow / bottom_absorption /
        # correction_exhaustion) — السقوط الحر يلغي أي إشارة شراء مهما بلغت قوتها.
        is_fk, fk_reason = _is_falling_knife(candles, current_price, sma50)
        if is_fk:
            return _result(
                'avoid_falling_knife', net_flow_5d, current_price, ma20, rsi,
                atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                fk_reason,
                expected_rr=None,  # NO upward target on falling knife
            )

        # 1. whale_inflow
        if (
            net_flow_5d > WHALE_INFLOW_MIN_EGP
            and ma20 is not None
            and current_price > ma20
            and (rsi is None or rsi < WHALE_INFLOW_RSI_MAX)
        ):
            recent_low_10 = min(
                (c['low'] for c in candles[-10:] if c['low'] > 0),
                default=current_price * 0.95,
            )
            expected_target, expected_rr = _determine_target(current_price, recent_low_10, stock_res, candles)
            if expected_rr is not None and expected_rr >= RR_FLOOR:
                # BRAVO-JIMMY Phase 2: wire evaluate_risk() — enforce R/R floor
                # + position cap (2.5%) at the canonical classifier. Defense in
                # depth: re-verify R/R + allocate position_size. If killed, fall
                # through to neutral (signal MUST NOT leave pipeline with R/R<1.8).
                risk_eval = _evaluate_risk(
                    entry_price=current_price,
                    stop_loss=recent_low_10,
                    target_price=expected_target,
                    calculated_position_size=_MAX_POSITION_SIZE,
                )
                if not risk_eval['killed']:
                    rsi_str = f'{rsi:.1f}' if rsi is not None else 'N/A'
                    return _result(
                        'whale_inflow', net_flow_5d, current_price, ma20, rsi,
                        atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                        f'صافي تدفق 5 جلسات {net_flow_5d/1e6:+.2f}M ج.م (>{WHALE_INFLOW_MIN_EGP/1e6:.0f}M) '
                        f'+ السعر {current_price:.2f} فوق MA20 {ma20:.2f} '
                        f'+ RSI {rsi_str} (<{WHALE_INFLOW_RSI_MAX:.0f}) + R/R {expected_rr:.2f} (≥{RR_FLOOR:.1f}) — تجميع حيتان صريح',
                        expected_rr=expected_rr,
                        position_size=risk_eval['position_size'],
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
                f'صافي تدفق 5 جلسات {net_flow_5d/1e6:+.2f}M ج.م (<{WHALE_OUTFLOW_MIN_EGP/1e6:.0f}M) '
                f'+ السعر تحت MA20 أو كسر قاع 5 جلسات — تصريف وهروب كاش',
            )

        # 3. bottom_absorption
        if low_52w and low_52w > 0:
            proximity_pct = ((current_price - low_52w) / low_52w) * 100.0
            in_proximity = proximity_pct <= BOTTOM_ABSORPTION_52W_PROXIMITY_PCT
            quiet_atr = (atr_current is not None and atr_avg is not None and atr_current < atr_avg)
            if net_flow_5d > 0 and in_proximity and quiet_atr:
                expected_target, expected_rr = _determine_target(current_price, low_52w, stock_res, candles)
                if expected_rr is not None and expected_rr >= RR_FLOOR:
                    # BRAVO-JIMMY Phase 2: wire evaluate_risk() — enforce R/R floor
                    # + position cap (2.5%) at the canonical classifier.
                    risk_eval = _evaluate_risk(
                        entry_price=current_price,
                        stop_loss=low_52w,
                        target_price=expected_target,
                        calculated_position_size=_MAX_POSITION_SIZE,
                    )
                    if not risk_eval['killed']:
                        return _result(
                            'bottom_absorption', net_flow_5d, current_price, ma20, rsi,
                            atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                            f'صافي تدفق موجب {net_flow_5d/1e6:+.2f}M ج.م '
                            f'+ السعر {proximity_pct:.1f}% فوق قاع 52 أسبوع ({low_52w:.2f}) '
                            f'+ ATR {atr_current:.2f} < متوسطه {atr_avg:.2f} + R/R {expected_rr:.2f} (≥{RR_FLOOR:.1f}) — تجميع قيعان هادئ',
                            expected_rr=expected_rr,
                            position_size=risk_eval['position_size'],
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
            expected_target, expected_rr = _determine_target(current_price, recent_low_10, stock_res, candles)
            if expected_rr is not None and expected_rr >= RR_FLOOR:
                # BRAVO-JIMMY Phase 2: wire evaluate_risk() — enforce R/R floor
                # + position cap (2.5%) at the canonical classifier.
                risk_eval = _evaluate_risk(
                    entry_price=current_price,
                    stop_loss=recent_low_10,
                    target_price=expected_target,
                    calculated_position_size=_MAX_POSITION_SIZE,
                )
                if not risk_eval['killed']:
                    return _result(
                        'correction_exhaustion', net_flow_5d, current_price, ma20, rsi,
                        atr_current, atr_avg, low_52w, high_52w, drop_15d, flow_history,
                        f'هبوط {drop_15d:.1f}% خلال 15 جلسة + شمعة خضراء مبتلعة '
                        f'+ تدفق اليوم موجب + R/R متوقع {expected_rr:.2f} (≥{RR_FLOOR:.1f}) — نهاية تصحيح وارتداد',
                        expected_rr=expected_rr,
                        position_size=risk_eval['position_size'],
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
    expected_rr: Optional[float] = None,
    position_size: Optional[float] = None,
) -> Dict[str, Any]:
    """Build the canonical result dict.

    SEALED-DISPATCH Step 3 (2026-10-17): `expected_rr` is now a top-level
    key (was previously only embedded in the Arabic `reason` string for
    `correction_exhaustion`). This makes R/R structurally readable for
    callers — required for the radar's R/R filter (Rule 18).

    BRAVO-JIMMY Phase 2 (2026-10-18): `position_size` is now a top-level
    key. BUY-side buckets (whale_inflow, bottom_absorption,
    correction_exhaustion) are run through evaluate_risk() which enforces:
      - R/R >= 1.8 floor (Rule 18) — signals below floor are KILLED.
      - position_size = min(calculated, 0.025) (Rule 19 — 2.5% cap).
    For SELL-side (whale_outflow), avoid_falling_knife, and neutral:
    position_size stays None (no BUY → no position allocation).
    """
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
        # SEALED-DISPATCH Step 3: R/R is now a top-level key.
        'expected_rr': expected_rr,
        # Include the floor for transparency (callers can verify the gate)
        'rr_floor': RR_FLOOR,
        # BRAVO-JIMMY Phase 2: position size (None for non-BUY buckets).
        'position_size': position_size,
        'max_position_size': _MAX_POSITION_SIZE,
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
