#!/usr/bin/env python3
"""
Chart Data Routes (v2 - Multi-Asset)
=====================================
API لبيانات الرسم البياني - يدعم أسهم/عملات رقمية/سلع.

Endpoints:
  GET /api/chart/<ticker>?period=1d|1w|1m&asset=stock|crypto|commodity
  GET /api/chart/full-analysis?ticker=X&timeframe=1D&limit=120

Features:
  - Smart fallback: لو مفيش بيانات intraday، يرجع للبيانات اليومية
  - 3 أنواع أصول معزولة في جداول منفصلة
  - Period 1d/1w → بيانات 5 دقائق (intraday)
  - Period 1m → بيانات يومية (fallback من price_history)
  - Stats محسوبة (open/high/low/close/change%)
  - Metadata عن مصدر البيانات (intraday / daily_fallback / daily)
  - Full Analysis: بيانات حقيقية من قواعد البيانات مع كل المؤشرات
"""

import os
from core.auth_middleware import require_admin
import sys
import math
import sqlite3
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from pathlib import Path

# BRAVO INDICATOR-UNIFY (2026-10-19): توحيد كل المؤشرات على canonical library
# Rule 54 (CALCULATION-CANONICAL): analyzers/indicators/ = المصدر الوحيد
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
from analyzers.indicators.atr import calc_atr as _canonical_calc_atr
from analyzers.indicators.ma import sma as _canonical_sma, ema as _canonical_ema, macd as _canonical_macd

logger = logging.getLogger(__name__)

# Add data_engine to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'data_engine'))

# Add analyzers to path
sys.path.insert(0, str(Path(__file__).parent.parent))

chart_bp = Blueprint('chart', __name__, url_prefix='/api/chart')


def _is_egx_intraday_now() -> bool:
    """هل السوق المصري مفتوح الآن (intraday session)؟

    P16-DELAY-COMPENSATION: helper لقرار تعويض تأخير البيانات 5 دقايق.
    EGX hours: الأحد-الخميس، 10:00-14:30 توقيت القاهرة (Africa/Cairo).
    بيحسب توقيت القاهرة من UTC (+2 شتاءً / +3 صيفاً DST) من غير dependency
    على pytz عشان يشتغل في أي بيئة.
    """
    try:
        from datetime import datetime, timedelta
        utc_now = datetime.utcnow()
        # Egypt DST: تقريباً آخر جمعة أبريل → آخر خميس أكتوبر
        is_dst = 4 <= utc_now.month <= 10
        cairo_offset = 3 if is_dst else 2
        cairo_dt = utc_now + timedelta(hours=cairo_offset)
        wd = cairo_dt.weekday()  # Mon=0..Sun=6
        # EGX opens Sun-Thu → weekday in [6, 0, 1, 2, 3]; Fri=4, Sat=5 closed
        if wd in (4, 5):
            return False
        minutes = cairo_dt.hour * 60 + cairo_dt.minute
        return 600 <= minutes < 870  # 10:00 (600) → 14:30 (870)
    except Exception:
        return False


# INTRADAY-FIX-054: Memory cache for chart full-analysis (60s revalidation)
# يمنع DB I/O bottleneck لو 100 عميل فتحوا نفس السهم في نفس الدقيقة
_chart_cache: dict = {}  # {cache_key: {time: datetime, data: dict}}

# ============================================================================
# STOCK-DNA-001 & CANDLE-PROB-001: محرك بصمة السهم + محرك احتمالات الشمعة
# ============================================================================
# P42-STOCK-DNA: بصمة السهم — ملخص سردي لسلوك السهم (مواسم، مدى، تذبذب)
# P42-CANDLE-PROB: احتمالات الشمعة الجاية — Port of TradingView V26 indicator
try:
    from analyzers.stock_dna_analyzer import analyze_stock_dna
    HAS_STOCK_DNA = True
except Exception as _dna_import_err:
    logger.warning(f"[chart_routes] stock_dna_analyzer import failed: {_dna_import_err}")
    HAS_STOCK_DNA = False

try:
    from analyzers.candle_probability_engine import calculate_candle_probabilities
    HAS_CANDLE_PROB = True
except Exception as _cprob_import_err:
    logger.warning(f"[chart_routes] candle_probability_engine import failed: {_cprob_import_err}")
    HAS_CANDLE_PROB = False


# ============================================================================
# INDICATOR CALCULATION FUNCTIONS (Array-based for chart display)
# ============================================================================

def _rolling_sma(data, period):
    """SMA as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma per point."""
    result = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(None)
        else:
            val = _canonical_sma(data[:i+1], period)
            result.append(val)
    return result


def _rolling_ema(data, period):
    """EMA as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.ema per point."""
    result = []
    if not data:
        return result
    for i, val in enumerate(data):
        if val is None or val <= 0:
            result.append(None)
            continue
        if i < period - 1:
            result.append(None)
            continue
        ema_val = _canonical_ema(data[:i+1], period)
        result.append(ema_val)
    return result


def _rolling_rsi(closes, period=14):
    """RSI as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.rsi.calc_rsi per point."""
    result = []
    if len(closes) < period + 1:
        return [50.0] * len(closes)
    for i in range(len(closes)):
        if i < period:
            result.append(50.0)
        else:
            val = _canonical_calc_rsi(closes[:i+1], period)
            result.append(val if val is not None else 50.0)
    return result


def _rolling_atr(highs, lows, closes, period=14):
    """ATR as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr per point."""
    result = []
    for i in range(len(closes)):
        if i < 1:
            result.append(None)
        else:
            val = _canonical_calc_atr(highs[:i+1], lows[:i+1], closes[:i+1], period)
            result.append(val)
    return result


def _rolling_std(data, period):
    """Rolling standard deviation"""
    result = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(None)
        else:
            window = data[i - period + 1:i + 1]
            mean = sum(window) / period
            variance = sum((x - mean) ** 2 for x in window) / period
            result.append(math.sqrt(variance))
    return result


def _rolling_bollinger(closes, period=20, mult=2.0):
    """Bollinger Bands as arrays"""
    sma = _rolling_sma(closes, period)
    std = _rolling_std(closes, period)
    upper, middle, lower = [], [], []
    for i in range(len(closes)):
        if sma[i] is None:
            upper.append(None)
            middle.append(None)
            lower.append(None)
        else:
            upper.append(round(sma[i] + mult * std[i], 4))
            middle.append(round(sma[i], 4))
            lower.append(round(sma[i] - mult * std[i], 4))
    return upper, middle, lower


def _calc_cmf(highs, lows, closes, volumes, period=20):
    """Chaikin Money Flow as array"""
    cmf = []
    for i in range(len(closes)):
        if i < period - 1 or len(volumes) <= i:
            cmf.append(0.0)
            continue
        sum_cmf_vol = 0.0
        sum_vol = 0.0
        for j in range(i - period + 1, i + 1):
            h, l, c = highs[j], lows[j], closes[j]
            v = volumes[j] if j < len(volumes) else 0
            denom = h - l
            if denom == 0 or denom < 0.0001:
                denom = 0.0001
            mfm = ((c - l) - (h - c)) / denom
            sum_cmf_vol += mfm * v
            sum_vol += v
        cmf.append(round(sum_cmf_vol / sum_vol, 6) if sum_vol > 0 else 0.0)
    return cmf


def _detect_bos(closes, highs, lows, lookback=5):
    """Break of Structure detection"""
    if len(closes) < lookback * 2 + 1:
        return []

    swing_highs = []
    swing_lows = []

    for i in range(lookback, len(highs) - lookback):
        window = highs[i - lookback:i + lookback + 1]
        if highs[i] == max(window):
            swing_highs.append((i, highs[i]))
        window_l = lows[i - lookback:i + lookback + 1]
        if lows[i] == min(window_l):
            swing_lows.append((i, lows[i]))

    events = []
    for idx in range(1, len(closes)):
        # BOS Up: price crosses above recent swing high
        for sh_idx, sh_val in swing_highs:
            if sh_idx < idx and closes[idx - 1] <= sh_val and closes[idx] > sh_val:
                events.append({'index': idx, 'type': 'bos_up', 'price': round(closes[idx], 4), 'level': round(sh_val, 4)})
                break
        # BOS Down: price crosses below recent swing low
        for sl_idx, sl_val in swing_lows:
            if sl_idx < idx and closes[idx - 1] >= sl_val and closes[idx] < sl_val:
                events.append({'index': idx, 'type': 'bos_down', 'price': round(closes[idx], 4), 'level': round(sl_val, 4)})
                break

    return events


def _detect_bb_squeeze(bb_upper, bb_lower, closes, highs=None, lows=None, period=20, kc_mult=1.5):
    """BB Squeeze: Bollinger Bands inside Keltner Channels"""
    if len(closes) < period:
        return {'state': 'normal', 'color': '#6b7280', 'text': 'بيانات غير كافية'}

    sub_highs = highs[-period * 3:] if highs and len(highs) > period * 3 else (highs or closes)
    sub_lows = lows[-period * 3:] if lows and len(lows) > period * 3 else (lows or closes)
    sub_closes = closes[-period * 3:] if len(closes) > period * 3 else closes
    atr_arr = _rolling_atr(sub_highs, sub_lows, sub_closes, period)

    # Use last available ATR
    atr_val = None
    for a in reversed(atr_arr):
        if a is not None:
            atr_val = a
            break
    if atr_val is None:
        atr_val = closes[-1] * 0.02

    sma_val = sum(closes[-period:]) / period
    kc_upper = sma_val + kc_mult * atr_val
    kc_lower = sma_val - kc_mult * atr_val

    bb_u = bb_upper[-1] if bb_upper[-1] is not None else sma_val + 2 * atr_val
    bb_l = bb_lower[-1] if bb_lower[-1] is not None else sma_val - 2 * atr_val

    if bb_l > kc_lower and bb_u < kc_upper:
        return {'state': 'squeeze_on', 'color': '#f97316', 'text': 'انضغاط (انفجار قادم) ⚡'}
    elif bb_l < kc_lower and bb_u < kc_upper:
        return {'state': 'squeeze_release', 'color': '#22c55e', 'text': 'بدء الانفجار السعري 🚀'}
    else:
        return {'state': 'normal', 'color': '#6b7280', 'text': 'طبيعي'}


# ============================================================================
# TOOLKIT-UNIFY-010: MACD + Candlestick Patterns (unify with maestro)
# ============================================================================

def _ema_seeded(values, period):
    """EMA as array — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.ema per point."""
    n = len(values)
    if n < period:
        return [None] * n
    result = []
    for i in range(n):
        if i < period - 1:
            result.append(None)
        else:
            val = _canonical_ema(values[:i+1], period)
            result.append(val)
    return result


def _calc_macd(closes, fast=12, slow=26, signal=9):
    """MACD as arrays — BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.macd per point.

    Returns: (macd_line, signal_line, histogram) — each same length as closes.
    """
    n = len(closes)
    if n < slow + signal:
        return [None] * n, [None] * n, [None] * n
    macd_line = []
    signal_line = []
    histogram = []
    for i in range(n):
        if i < slow + signal - 1:
            macd_line.append(None)
            signal_line.append(None)
            histogram.append(None)
        else:
            result = _canonical_macd(closes[:i+1], fast, slow, signal)
            if result is not None:
                ml = result.get('line')
                sl = result.get('signal')
                hg = result.get('histogram')
                macd_line.append(ml)
                signal_line.append(sl)
                histogram.append(hg)
            else:
                macd_line.append(None)
                signal_line.append(None)
                histogram.append(None)
    return macd_line, signal_line, histogram


def _detect_candlestick_patterns(ohlcv):
    """كشف أنماط الشموع اليابانية على آخر شمعتين.

    يُرجع قائمة من dicts: {name, name_ar, signal, strength}.
    signal: 'bullish' | 'bearish' | 'neutral'
    strength: 'weak' | 'medium' | 'strong'
    """
    patterns = []
    if len(ohlcv) < 2:
        return patterns
    last = ohlcv[-1]
    prev = ohlcv[-2]

    o, c = float(last.get('open', 0)), float(last.get('close', 0))
    h, l = float(last.get('high', 0)), float(last.get('low', 0))
    po, pc = float(prev.get('open', 0)), float(prev.get('close', 0))

    body = abs(c - o)
    range_ = h - l
    if range_ <= 0:
        return patterns

    lower_wick = min(o, c) - l
    upper_wick = h - max(o, c)

    # Doji (تردد)
    if body / range_ < 0.1:
        patterns.append({'name': 'Doji', 'name_ar': 'دوجي',
                         'signal': 'neutral', 'strength': 'weak'})

    # Hammer (مطرقة - إيجابي عند القاع)
    if body > 0 and lower_wick > 2 * body and upper_wick < body * 0.5:
        patterns.append({'name': 'Hammer', 'name_ar': 'مطرقة',
                         'signal': 'bullish', 'strength': 'medium'})

    # Shooting Star (نجم هابط - سلبي عند القمة)
    if body > 0 and upper_wick > 2 * body and lower_wick < body * 0.5:
        patterns.append({'name': 'Shooting Star', 'name_ar': 'نجم هابط',
                         'signal': 'bearish', 'strength': 'medium'})

    # Bullish Engulfing (ابتلاع صعودي)
    if po > 0 and pc < po and c > o:
        if c >= po and o <= pc:
            patterns.append({'name': 'Bullish Engulfing', 'name_ar': 'ابتلاع صعودي',
                             'signal': 'bullish', 'strength': 'strong'})

    # Bearish Engulfing (ابتلاع هبوطي)
    if po > 0 and pc > po and c < o:
        if o >= pc and c <= po:
            patterns.append({'name': 'Bearish Engulfing', 'name_ar': 'ابتلاع هبوطي',
                             'signal': 'bearish', 'strength': 'strong'})

    return patterns


# ============================================================================
# TOOLKIT-UNIFY-013: Fibonacci + Fundamental Score + Multi-TF (unify maestro)
# ============================================================================

def _calc_fibonacci_levels(closes, highs, lows, lookback=30):
    """حساب مستويات فيبوناتشي (0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%).

    يحدد آخر swing high/low خلال آخر `lookback` شمعة ثم يحسب المستويات بينهما.
    لو مفيش بيانات كافية → يرجع None.
    المستويات تُحسب نسبةً للاتجاه (up/down):
      - لو close[-1] > close[-lookback] → uptrend: low=0%, high=100%
      - عكسه → downtrend: high=0%, low=100%
    """
    n = len(closes)
    if n < 5 or not highs or not lows:
        return None
    window = min(lookback, n)
    sub_highs = highs[-window:]
    sub_lows = lows[-window:]
    swing_high = max(sub_highs) if sub_highs else None
    swing_low = min(sub_lows) if sub_lows else None
    if swing_high is None or swing_low is None or swing_high <= swing_low:
        return None

    diff = swing_high - swing_low
    # Determine direction: if last close > midpoint → uptrend (retracement from high)
    last_close = closes[-1]
    direction = 'up' if last_close >= (swing_high + swing_low) / 2.0 else 'down'

    # Standard fib retracement levels
    fib_ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    levels = {}
    for r in fib_ratios:
        # In uptrend: 0% = swing_high (target), 100% = swing_low (support)
        # In downtrend: 0% = swing_low (target), 100% = swing_high (resistance)
        if direction == 'up':
            price = swing_high - diff * r
        else:
            price = swing_low + diff * r
        levels[f'{int(r * 1000) / 10}%'] = round(price, 4)
    # Also include the absolute levels for convenience
    levels['swing_high'] = round(swing_high, 4)
    levels['swing_low'] = round(swing_low, 4)
    levels['direction'] = direction
    levels['lookback_window'] = window
    return levels


def _compute_fundamental_score(fundamentals):
    """حساب fundamental_score (0-100) من الـ fundamentals dict.

    يجمع نقاط من 5 محاور:
      - Valuation (PE/PB): حتى 25 نقطة (PE<8 → 15، PE 8-15 → 10، PE 15-25 → 5، PE>25 → 0)
      - Solvency (Assets/Liabilities): حتى 20 نقطة (ratio>2 → 20، >1.5 → 15، >1 → 10، <=1 → 0)
      - Profitability (ROE/Profit Margin): حتى 25 نقطة (ROE>15 → 15، >8 → 10؛ Margin>10 → 10، >3 → 5)
      - Dividend Yield: حتى 15 نقطة (Yield>5 → 15، >2 → 10، >0 → 5)
      - Performance: حتى 15 نقطة (3m>10 → 8، >0 → 4؛ 1m>5 → 4، >0 → 2؛ 1w>0 → 1)
    """
    breakdown = {}
    score = 0.0

    # Valuation
    val = fundamentals.get('valuation', {}) or {}
    pe = val.get('pe_ratio')
    pb = val.get('pb_ratio')
    v_pts = 0.0
    v_detail = []
    if pe is not None:
        if pe < 8:
            v_pts += 15; v_detail.append(f'P/E={pe:.1f} (<8 — رخيص جداً) +15')
        elif pe < 15:
            v_pts += 10; v_detail.append(f'P/E={pe:.1f} (8-15 — منطقي) +10')
        elif pe < 25:
            v_pts += 5; v_detail.append(f'P/E={pe:.1f} (15-25 — عادل) +5')
        else:
            v_detail.append(f'P/E={pe:.1f} (>25 — مرتفع) +0')
    if pb is not None:
        if pb < 1:
            v_pts += 10; v_detail.append(f'P/B={pb:.2f} (<1 — تحت قيمة كتابية) +10')
        elif pb < 3:
            v_pts += 5; v_detail.append(f'P/B={pb:.2f} (1-3 — مقبول) +5')
        else:
            v_detail.append(f'P/B={pb:.2f} (>3 — مرتفع) +0')
    v_pts = min(v_pts, 25)
    score += v_pts
    breakdown['valuation'] = {'points': round(v_pts, 2), 'max': 25, 'detail': ' | '.join(v_detail) if v_detail else 'لا توجد بيانات تقييم'}

    # Solvency
    bs = fundamentals.get('balance_sheet', {}) or {}
    sr = bs.get('solvency_ratio')
    if sr is not None:
        if sr > 2:
            s_pts = 20; s_d = f'نسبة الملاءة={sr:.2f} (>2 — ممتازة) +20'
        elif sr > 1.5:
            s_pts = 15; s_d = f'نسبة الملاءة={sr:.2f} (1.5-2 — جيدة) +15'
        elif sr > 1:
            s_pts = 10; s_d = f'نسبة الملاءة={sr:.2f} (1-1.5 — مقبولة) +10'
        else:
            s_pts = 0; s_d = f'نسبة الملاءة={sr:.2f} (<1 — خطر) +0'
    else:
        s_pts = 0; s_d = 'لا توجد بيانات ملاءة'
    score += s_pts
    breakdown['solvency'] = {'points': round(s_pts, 2), 'max': 20, 'detail': s_d}

    # Profitability
    prof = fundamentals.get('profitability', {}) or {}
    roe = prof.get('roe')
    pm = prof.get('profit_margin')
    p_pts = 0.0
    p_detail = []
    if roe is not None:
        if roe > 15:
            p_pts += 15; p_detail.append(f'ROE={roe:.1f}% (>15% — ممتاز) +15')
        elif roe > 8:
            p_pts += 10; p_detail.append(f'ROE={roe:.1f}% (8-15% — جيد) +10')
        else:
            p_detail.append(f'ROE={roe:.1f}% (<8% — ضعيف) +0')
    if pm is not None:
        if pm > 10:
            p_pts += 10; p_detail.append(f'هامش صافي={pm:.1f}% (>10% — ممتاز) +10')
        elif pm > 3:
            p_pts += 5; p_detail.append(f'هامش صافي={pm:.1f}% (3-10% — جيد) +5')
        else:
            p_detail.append(f'هامش صافي={pm:.1f}% (<3% — ضعيف) +0')
    p_pts = min(p_pts, 25)
    score += p_pts
    breakdown['profitability'] = {'points': round(p_pts, 2), 'max': 25, 'detail': ' | '.join(p_detail) if p_detail else 'لا توجد بيانات ربحية'}

    # Dividends
    div = fundamentals.get('dividends', {}) or {}
    dy = div.get('dividend_yield')
    if dy is not None:
        if dy > 5:
            d_pts = 15; d_d = f'عائد توزيع={dy:.1f}% (>5% — مرتفع) +15'
        elif dy > 2:
            d_pts = 10; d_d = f'عائد توزيع={dy:.1f}% (2-5% — متوسط) +10'
        elif dy > 0:
            d_pts = 5; d_d = f'عائد توزيع={dy:.1f}% (<2% — منخفض) +5'
        else:
            d_pts = 0; d_d = f'عائد توزيع={dy:.1f}% (0) +0'
    else:
        d_pts = 0; d_d = 'لا توجد بيانات توزيعات'
    score += d_pts
    breakdown['dividends'] = {'points': round(d_pts, 2), 'max': 15, 'detail': d_d}

    # Performance
    perf = fundamentals.get('performance', {}) or {}
    p1w = perf.get('1w')
    p1m = perf.get('1m')
    p3m = perf.get('3m')
    pf_pts = 0.0
    pf_detail = []
    if p3m is not None:
        if p3m > 10:
            pf_pts += 8; pf_detail.append(f'3m={p3m:.1f}% (>10% — قوي) +8')
        elif p3m > 0:
            pf_pts += 4; pf_detail.append(f'3m={p3m:.1f}% (>0% — إيجابي) +4')
        else:
            pf_detail.append(f'3m={p3m:.1f}% (<=0% — سلبي) +0')
    if p1m is not None:
        if p1m > 5:
            pf_pts += 4; pf_detail.append(f'1m={p1m:.1f}% (>5% — قوي) +4')
        elif p1m > 0:
            pf_pts += 2; pf_detail.append(f'1m={p1m:.1f}% (>0% — إيجابي) +2')
        else:
            pf_detail.append(f'1m={p1m:.1f}% (<=0%) +0')
    if p1w is not None:
        if p1w > 0:
            pf_pts += 1; pf_detail.append(f'1w={p1w:.1f}% (>0%) +1')
        else:
            pf_detail.append(f'1w={p1w:.1f}% (<=0%) +0')
    pf_pts = min(pf_pts, 15)
    score += pf_pts
    breakdown['performance'] = {'points': round(pf_pts, 2), 'max': 15, 'detail': ' | '.join(pf_detail) if pf_detail else 'لا توجد بيانات أداء'}

    return round(min(score, 100), 2), breakdown


VALID_PERIODS = ['1d', '1w', '1m']
VALID_ASSETS = ['stock', 'crypto', 'commodity']


# ── P33 TASK 1: Backend UNIX Timestamp Fix ─────────────────────────────────
# The frontend (lightweight-charts) requires numeric UNIX-seconds timestamps
# for intraday timeframes. Previously the daily-fallback path sent 'yyyy-mm-dd'
# strings which caused "Invalid date string=26/07 09:00" crashes when mixed
# with intraday numeric timestamps. This helper guarantees EVERY timestamp
# leaving get_chart_data is an int (UNIX seconds).
def _to_unix_ts(raw):
    """Convert any date representation to UNIX seconds (int). Returns 0 on failure."""
    from datetime import datetime as _dt
    if raw is None:
        return 0
    # Already a number → assume seconds (or millis if huge)
    if isinstance(raw, (int, float)):
        try:
            v = float(raw)
            return int(v / 1000) if v > 1e12 else int(v)
        except (TypeError, ValueError):
            return 0
    s = str(raw).strip()
    if not s:
        return 0
    # Numeric string
    try:
        v = float(s)
        if v > 1e12:
            return int(v / 1000)
        return int(v)
    except (TypeError, ValueError):
        pass
    # Strip timezone suffixes for parsing
    clean = s.replace('+00:00', '').replace('+03:00', '').split('+')[0].strip()
    # Try full datetime formats first
    for fmt in (
        '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M',
        '%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M',
        '%Y/%m/%d %H:%M:%S', '%Y/%m/%d %H:%M',
    ):
        try:
            return int(_dt.strptime(clean, fmt).timestamp())
        except ValueError:
            continue
    # Try dd/MM HH:mm (intraday string without year — use current year)
    for fmt in ('%d/%m %H:%M:%S', '%d/%m %H:%M'):
        try:
            dt = _dt.strptime(clean, fmt).replace(year=_dt.now().year)
            return int(dt.timestamp())
        except ValueError:
            continue
    # Try pure date formats
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return int(_dt.strptime(clean, fmt).timestamp())
        except ValueError:
            continue
    # Last resort: ISO parser
    try:
        return int(_dt.fromisoformat(clean).timestamp())
    except Exception:
        pass
    return 0


@chart_bp.route('/<ticker>', methods=['GET'])
def get_chart_data(ticker):
    """
    الحصول على بيانات الرسم البياني لأي أصل.

    Query params:
      - period: 1d (يوم), 1w (أسبوع), 1m (شهر) [default: 1w]
      - asset: stock | crypto | commodity [auto-detect if not specified]
    """
    try:
        from intraday_storage import get_intraday_data, get_intraday_stats, _detect_asset_type

        period = request.args.get('period', '1w').lower()
        if period not in VALID_PERIODS:
            period = '1w'

        # Support explicit timeframe / interval (e.g. 5m, 15m, 30m, 1h, 60m)
        interval = request.args.get('interval') or request.args.get('timeframe') or ''
        interval = interval.lower().strip()

        asset = request.args.get('asset', '').lower()
        if asset and asset not in VALID_ASSETS:
            asset = ''
        if not asset:
            try:
                asset = _detect_asset_type(ticker)
            except Exception as e:
                logger.error(f"[chart_routes] DB error in get_chart_data (_detect_asset_type): {e}")
                asset = 'stock'

        ticker_clean = ticker.upper().strip()
        try:
            data = get_intraday_data(ticker_clean, period, asset)

            # ── Smart Chart intraday aggregation frequencies ──
            if data and len(data) > 0 and (period in ('1d', '1w', '1m') or interval):
                freq_minutes = 5
                if interval == '5m':
                    freq_minutes = 5
                elif interval == '15m':
                    freq_minutes = 15
                elif interval == '30m':
                    freq_minutes = 30
                elif interval in ('1h', '60m'):
                    freq_minutes = 60
                elif period == '1m':
                    freq_minutes = 60      # 1-hour candles for 1M
                elif period == '1w':
                    freq_minutes = 30      # 30-min candles for 1W

                aggregated = _aggregate_intraday_snapshots(data, freq_minutes)

                new_data = []
                for b in aggregated:
                    # P33 TASK 1: force UNIX seconds int (never a string)
                    _ts = _to_unix_ts(b.get('date'))
                    if _ts <= 0:
                        continue
                    _o = float(b.get('open') or 0)
                    _h = float(b.get('high') or 0)
                    _l = float(b.get('low') or 0)
                    _c = float(b.get('close') or 0)
                    # P33 TASK 2 (backend side): drop null/NaN OHLC candles
                    if _o <= 0 and _h <= 0 and _l <= 0 and _c <= 0:
                        continue
                    new_data.append({
                        'timestamp': _ts,
                        'price': _c,
                        'open': _o,
                        'high': _h,
                        'low': _l,
                        'close': _c,
                        'volume': int(b.get('volume', 0) or 0),
                        'source': 'intraday'
                    })
                data = new_data
        except Exception as e:
            logger.error(f"[chart_routes] DB error in get_chart_data (get_intraday_data): {e}")
            data = None

        # ── P31 TASK 3: Daily fallback when intraday is empty ──
        # Previously: if intraday.db had no snapshots for the ticker (common outside
        # market hours or for tickers the intraday collector hasn't reached), the
        # endpoint returned "لا توجد بيانات لهذا الرمز" and the chart went blank.
        # Now: fall back to load_merged_history (daily yahoo_clean) so the chart at
        # least shows the historical daily candles with a clear source label.
        if not data:
            try:
                from analyzers.master_analyzer import load_merged_history
                from pathlib import Path as _P
                _base = _P(__file__).resolve().parent.parent.parent
                _db_file = os.environ.get('DATABASE_PATH', str(_base / 'db' / 'stocks.db'))
                # Map period to a sensible daily limit
                _daily_limit = 30 if period == '1d' else (90 if period == '1w' else 180)
                daily_history = load_merged_history(ticker_clean, _db_file, limit=_daily_limit)
                if daily_history:
                    data = []
                    for h in daily_history:
                        _close = float(h.get('close', 0) or 0)
                        if _close <= 0:
                            continue
                        # P33 TASK 1: convert yyyy-mm-dd string → UNIX seconds int
                        _ts = _to_unix_ts(h.get('date', ''))
                        if _ts <= 0:
                            continue
                        _o = float(h.get('open', _close) or _close)
                        _h = float(h.get('high', _close) or _close)
                        _l = float(h.get('low', _close) or _close)
                        data.append({
                            'timestamp': _ts,
                            'price': _close,
                            'open': _o,
                            'high': _h,
                            'low': _l,
                            'close': _close,
                            'volume': int(h.get('volume', 0) or 0),
                            'source': 'daily_fallback'
                        })
                    logger.info(f"[chart_routes] {ticker_clean}: intraday empty -> fell back to daily yahoo_clean ({len(data)} candles, timestamps=UNIX)")
            except Exception as _fb_err:
                logger.error(f"[chart_routes] daily fallback error for {ticker_clean}: {_fb_err}")
                data = None

        if not data:
            return jsonify({
                "success": False,
                "error": "لا توجد بيانات لهذا الرمز",
                "ticker": ticker_clean,
                "period": period,
                "asset": asset,
                "data": []
            })

        # Calculate stats
        prices = [d['price'] for d in data if d.get('price', 0) > 0]
        if not prices:
            return jsonify({
                "success": False,
                "error": "لا توجد أسعار صالحة",
                "data": []
            })

        first_price = prices[0]
        last_price = prices[-1]
        max_price = max(prices)
        min_price = min(prices)
        change_pct = ((last_price - first_price) / first_price * 100) if first_price > 0 else 0

        # Determine data source
        sources = set(d.get('source', 'intraday') for d in data)
        if 'daily_fallback' in sources:
            source_label = 'daily_fallback'
            note = 'البيانات اللحظية غير متوفرة بعد - يتم عرض البيانات اليومية كبديل'
        elif 'daily' in sources:
            source_label = 'daily'
            note = 'بيانات يومية (إغلاق اليوم)'
        else:
            source_label = 'intraday'
            note = 'بيانات لحظية (5 دقائق)'

        return jsonify({
            "success": True,
            "ticker": ticker_clean,
            "period": period,
            "asset": asset,
            "source": source_label,
            "note": note,
            "count": len(data),
            "data": data,
            "stats": {
                "first_price": round(first_price, 4),
                "last_price": round(last_price, 4),
                "max_price": round(max_price, 4),
                "min_price": round(min_price, 4),
                "change_pct": round(change_pct, 2),
                "avg_price": round(sum(prices) / len(prices), 4),
            }
        })

    except Exception as e:
        import traceback
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc() if os.environ.get('DEBUG') else None,
            "data": []
        }), 500


@chart_bp.route('/stats/intraday', methods=['GET'])
def get_intraday_stats_route():
    """إحصائيات قاعدة بيانات intraday - للتشخيص"""
    try:
        from intraday_storage import get_intraday_stats
        try:
            stats = get_intraday_stats()
        except Exception as e:
            logger.error(f"[chart_routes] DB error in get_intraday_stats_route: {e}")
            stats = {}
        return jsonify({
            "success": True,
            "stats": stats
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@require_admin
@chart_bp.route('/collect/now', methods=['POST'])
def trigger_collection():
    """تشغيل جمع البيانات يدوياً (للاختبار/Admin)"""
    try:
        from intraday_storage import store_intraday_snapshot, store_stocks_snapshot, store_crypto_snapshot, store_commodities_snapshot

        target = request.args.get('target', 'all')  # all|stocks|crypto|commodities

        try:
            if target == 'stocks':
                n = store_stocks_snapshot()
            elif target == 'crypto':
                n = store_crypto_snapshot()
            elif target == 'commodities':
                n = store_commodities_snapshot()
            else:
                n = store_intraday_snapshot()
        except Exception as e:
            logger.error(f"[chart_routes] DB error in trigger_collection (store snapshot): {e}")
            n = 0

        return jsonify({
            "success": True,
            "target": target,
            "stored": n,
            "message": f"تم جمع {n} سجل"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================================
# FULL ANALYSIS ENDPOINT - Real data from databases
# ============================================================================

def _aggregate_ohlcv(ohlcv, indicators, period='W'):
    """
    CHART-UX-030: Aggregates daily OHLCV + indicators to weekly (W) or monthly (M).

    For each period bucket:
      - open  = first day's open in the bucket
      - high  = max of highs in the bucket
      - low   = min of lows in the bucket
      - close = last day's close in the bucket
      - volume = sum of volumes in the bucket
      - indicator value = last non-None value in the bucket (for SMA, RSI, MACD, etc.)
      - time  = last day's date in the bucket (for lightweight-charts x-axis)

    Args:
      ohlcv: list of {time, open, high, low, close, volume} (daily)
      indicators: dict of {key: list of {time, value}} (daily)
      period: 'W' for weekly (ISO week), 'M' for monthly

    Returns:
      (new_ohlcv, new_indicators) aggregated to the requested period.
    """
    from datetime import datetime

    if not ohlcv:
        return ohlcv, indicators

    # Group by (year, week_num) or (year, month)
    buckets = {}        # key → bucket dict
    bucket_order = []   # ordered list of keys

    for i, bar in enumerate(ohlcv):
        try:
            dt = datetime.strptime(bar['time'], '%Y-%m-%d')
        except (ValueError, KeyError, TypeError):
            continue

        if period == 'W':
            iso = dt.isocalendar()
            key = (iso[0], iso[1])  # (ISO year, week number)
        else:  # 'M'
            key = (dt.year, dt.month)

        if key not in buckets:
            buckets[key] = {
                'time': bar['time'],      # last day's date (updated below)
                'open': bar['open'],      # first day's open
                'high': bar['high'],
                'low': bar['low'],
                'close': bar['close'],
                'volume': bar['volume'],
                'indices': [],
            }
            bucket_order.append(key)
        else:
            b = buckets[key]
            b['high'] = max(b['high'], bar['high'])
            b['low'] = min(b['low'], bar['low'])
            b['close'] = bar['close']     # last day's close
            b['volume'] += bar['volume']
            b['time'] = bar['time']       # last day's date

        buckets[key]['indices'].append(i)

    # Build aggregated OHLCV
    new_ohlcv = []
    for key in bucket_order:
        b = buckets[key]
        new_ohlcv.append({
            'time': b['time'],
            'open': round(b['open'], 4),
            'high': round(b['high'], 4),
            'low': round(b['low'], 4),
            'close': round(b['close'], 4),
            'volume': int(b['volume']) if b['volume'] else 0,
        })

    # Aggregate indicators: take last non-None value in each bucket
    new_indicators = {}
    for ind_key, ind_arr in indicators.items():
        new_ind_arr = []
        for key in bucket_order:
            indices = buckets[key]['indices']
            last_val = None
            for idx in indices:
                if idx < len(ind_arr):
                    v = ind_arr[idx].get('value') if isinstance(ind_arr[idx], dict) else None
                    if v is not None:
                        last_val = v
            new_ind_arr.append({'time': buckets[key]['time'], 'value': last_val})
        new_indicators[ind_key] = new_ind_arr

    return new_ohlcv, new_indicators

def _aggregate_intraday_snapshots(raw_intraday, freq_minutes=15):
    """
    Groups flat price snapshots into OHLC candles of the given frequency.
    """
    from datetime import datetime as _dt
    import math

    if not raw_intraday:
        return []

    buckets = {}
    bucket_order = []

    for row in raw_intraday:
        raw_ts = row.get('timestamp') or row.get('date') or row.get('time')
        try:
            date_val = int(raw_ts) if raw_ts is not None else 0
        except (TypeError, ValueError):
            try:
                date_val = int(float(raw_ts))
            except (TypeError, ValueError):
                date_val = 0
                s = str(raw_ts).strip()
                clean = s.replace('+00:00', '').replace('+03:00', '').split('+')[0].strip()
                for fmt in (
                    '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S',
                    '%Y-%m-%d %H:%M', '%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M',
                    '%Y/%m/%d %H:%M:%S', '%Y/%m/%d %H:%M', '%Y-%m-%d'
                ):
                    try:
                        date_val = int(_dt.strptime(clean, fmt).timestamp())
                        break
                    except ValueError:
                        continue
                if date_val == 0:
                    for fmt in ('%d/%m %H:%M:%S', '%d/%m %H:%M'):
                        try:
                            dt = _dt.strptime(clean, fmt).replace(year=_dt.now().year)
                            date_val = int(dt.timestamp())
                            break
                        except ValueError:
                            continue
        
        if date_val == 0:
            continue

        # Group by freq_minutes (e.g. 15 mins = 900 seconds)
        bucket_ts = (date_val // (freq_minutes * 60)) * (freq_minutes * 60)
        
        price = row.get('price')
        if price is None:
            price = row.get('open') or row.get('close') or 0
            
        vol = row.get('volume', 0)

        if bucket_ts not in buckets:
            buckets[bucket_ts] = {
                'date': bucket_ts,
                'open': price,
                'high': price,
                'low': price,
                'close': price,
                'volume': vol
            }
            bucket_order.append(bucket_ts)
        else:
            b = buckets[bucket_ts]
            b['high'] = max(b['high'], price)
            b['low'] = min(b['low'], price)
            b['close'] = price
            b['volume'] += vol

    # Return grouped OHLC
    aggregated = []
    for ts in bucket_order:
        aggregated.append(buckets[ts])
        
    return aggregated


def _build_egx_recommendations(master_score: float, signal: str, rsi: float,
                                  current_price: float, stop_loss: float) -> dict:
    """Phase 8.1: EGX Tuned Recommendations - توصيات مصرية واقعية"""
    buyer_reco = ""
    holder_reco = ""
    rsi_overbought = rsi > 80  # Phase 8.1: 80 بدل 70

    if master_score >= 80:
        buyer_reco = "🟢 شراء مباشر! السهم فيه تدفق مؤسسي قوي وجاهز يكمل صعود."
    elif master_score >= 60:
        buyer_reco = "🟡 تجميع على دفعات. السهم بيلمع، ادخل بـ 50% وانتظر تأكيد الكسر."
    elif master_score >= 45:
        buyer_reco = "🔵 السهم في اتجاه صاعد عام، ممكن تدخل مضاربة سريعة مع وقف محكم."
    else:
        buyer_reco = "🟠 انتظار حتى ظهور كسر هيكلي (BOS) أو ابتلاع سيولة (Sweep)."

    if stop_loss > 0 and current_price <= stop_loss:
        holder_reco = "🔴 خروج طارئ! السعر كسر الوقف الهيكري، السيولة المؤسسية خرجت."
    elif rsi_overbought:
        holder_reco = "🟠 احتفظ بالسهم، ولكنه وصل لتشبع شرائي قوي. بِع جزء وارفع الستوب."
    elif master_score >= 60:
        holder_reco = "🟢 امسك وانت مطمن. الزخم المؤسسي معاك، استمتع بالارتفاع."
    else:
        holder_reco = "🟡 السهم بيرتفع بس بدون سيولة قوية. خد أرباحك على دفعات."

    return {"buyer": buyer_reco, "holder": holder_reco}


@chart_bp.route('/full-analysis', methods=['GET'])
def chart_full_analysis():
    """
    تحليل شامل للشارت التفاعلي - بيانات حقيقية 100% من قواعد البيانات.

    Query params:
      - ticker: رمز السهم [default: PHDC]
      - timeframe: 1D [default: 1D]
      - limit: عدد الشموع [default: 120]

    Returns: OHLCV + indicators + levels + confluence + risk + regime
    """
    import traceback

    # Phase 9: STALE DATA CHECK
    try:
        import sqlite3 as _sq_stale
        _stale_db = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'data_engine.db')
        if os.path.exists(_stale_db):
            _sconn = _sq_stale.connect(_stale_db)
            _scur = _sconn.cursor()
            _stale_ticker = request.args.get('ticker', 'PHDC').upper().strip()
            _srow = _scur.execute(
                "SELECT last_update FROM stocks WHERE symbol = ? ORDER BY last_update DESC LIMIT 1",
                (_stale_ticker,)
            ).fetchone()
            _sconn.close()
            if _srow and _srow[0]:
                from datetime import datetime as _dt_s
                for _sfmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
                    try:
                        _sp = _dt_s.strptime(str(_srow[0])[:19], _sfmt)
                        _sh = (datetime.now() - _sp).total_seconds() / 3600
                        if _sh > 24:
                            logger.warning(f"[STALE] {_stale_ticker}: data {_sh:.0f}h old")
                    except ValueError:
                        continue
    except Exception:
        pass

    # Fix: Define DB_PATH at function scope (was causing 'cannot access local variable')
    _base_path = Path(__file__).parent.parent.parent.resolve()
    DB_PATH = os.environ.get('DATABASE_PATH', str(_base_path / 'db' / 'stocks.db'))

    try:
        ticker = request.args.get('ticker', 'PHDC').upper().strip()
        timeframe = request.args.get('timeframe', '1D').upper()
        limit = min(int(request.args.get('limit', 120)), 500)
        user_persona = request.args.get('persona', 'مضارب سريع')
        # CHART-UX-030: User State Toggle (buyer = looking to buy, owner = already holding)
        user_state = request.args.get('state', 'buyer').lower()
        if user_state not in ('buyer', 'owner'):
            user_state = 'buyer'

        _adjustment_reason = None

        # =====================================================================
        # 1. LOAD REAL OHLCV DATA FROM DATABASE
        # INTRADAY-FIX-054: Caching (60s) + Index safety + Timeframe-aware indicators
        # =====================================================================
        # INTRADAY-FIX-054: Memory cache — 1 minute revalidation
        # لو 100 عميل فتحوا نفس السهم في نفس الدقيقة → DB read واحدة بس
        _cache_key = f"{ticker}_{timeframe}_{limit}_{user_state}"
        # V34-PORTFOLIO: cache key بيشمل entry_price/entry_qty عشان كل مركز يجيب portfolio_advice خاص بيه
        _ep = request.args.get('entry_price', '0')
        _eq = request.args.get('entry_qty', '0')
        if _ep and _ep != '0':
            _cache_key += f"_ep{_ep}_eq{_eq}"
        _cached = _chart_cache.get(_cache_key)
        if _cached and (datetime.now() - _cached['time']).total_seconds() < 60:
            logger.info(f"[chart_routes] {ticker}: Cache HIT (age={int((datetime.now() - _cached['time']).total_seconds())}s)")
            return jsonify(_cached['data'])

        try:
            # BRIEF-049: أضفنا 5M, 15M, 1H للفريمات اللحظية
            # كل الفريمات اللحظية بتقرأ من intraday.db (5-min snapshots)
            # و بتتعملها resampling للفريم المطلوب
            if timeframe in ('5M', '15M', '1H', 'TODAY', 'WEEK', 'MONTH'):
                # Fetch intraday data directly from intraday_storage
                from intraday_storage import get_intraday_data, _detect_asset_type
                asset = _detect_asset_type(ticker)

                freq_minutes = 15
                if timeframe == '5M':
                    period = '1d'  # آخر يوم
                    intra_limit = 10000
                    freq_minutes = 5      # BRIEF-049: شموع 5 دقايق
                elif timeframe == '15M':
                    period = '1d'  # آخر يوم
                    intra_limit = 10000
                    freq_minutes = 15     # BRIEF-049: شموع 15 دقيقة
                elif timeframe == '1H':
                    period = '1w'  # آخر أسبوع
                    intra_limit = 10000
                    freq_minutes = 60     # BRIEF-049: شموع ساعة
                elif timeframe == 'MONTH':
                    period = '1m'
                    intra_limit = 10000  # DYNAMIC-061: no truncation, show all available
                    freq_minutes = 120    # 2-hour candles for MONTH
                elif timeframe == 'WEEK':
                    period = '1w'
                    intra_limit = 10000  # DYNAMIC-061: no truncation, show all available
                    freq_minutes = 60     # 1-hour candles for WEEK
                else:
                    period = '1d'
                    intra_limit = 10000  # DYNAMIC-061: no truncation, show all available
                    freq_minutes = 15     # 15-min candles for TODAY

                raw_intraday = get_intraday_data(ticker, period, asset)
                
                # Aggregate raw snapshots into OHLC candles
                history = _aggregate_intraday_snapshots(raw_intraday, freq_minutes)

                # Limit to the requested limit (e.g. 120 candles)
                if len(history) > intra_limit:
                    history = history[-intra_limit:]
                    
                # Graceful fallback: If intraday data doesn't have enough history for WEEK/MONTH 
                # (e.g. less than 3 candles), fallback to daily history.
                if timeframe == 'MONTH' and len(history) < 3:
                    history = []
                elif timeframe == 'WEEK' and len(history) < 3:
                    history = []
                    
                if len(history) == 0:
                    # Fallback to load_merged_history if no valid intraday data
                    from analyzers.master_analyzer import load_merged_history
                    try:
                        from config import DATABASE_PATH as DB_PATH
                    except ImportError:
                        _base = Path(__file__).parent.parent.parent.resolve()
                        DB_PATH = os.environ.get('DATABASE_PATH', str(_base / 'db' / 'stocks.db'))
                    history = load_merged_history(ticker, DB_PATH, limit=limit)
                    # Tell UI we fell back
                    _adjustment_reason = f"تم عرض بيانات يومية لعدم توفر بيانات لحظية كافية لـ {timeframe}"
            else:

                from analyzers.master_analyzer import load_merged_history
                try:
                    from config import DATABASE_PATH as DB_PATH
                except ImportError:
                    _base = Path(__file__).parent.parent.parent.resolve()
                    DB_PATH = os.environ.get('DATABASE_PATH', str(_base / 'db' / 'stocks.db'))

                history = load_merged_history(ticker, DB_PATH, limit=limit)
        except Exception as e:
            logger.error(f"[chart_routes] DB error in chart_full_analysis: {e}")
            return jsonify({
                'success': False,
                'error': f'خطأ في تحميل البيانات: {str(e)}',
                'ticker': ticker
            }), 500

        if not history or len(history) < 3:
            return jsonify({
                'success': False,
                'error': f'لا توجد بيانات كافية لـ {ticker} (وجد {len(history) if history else 0} شمعة)',
                'ticker': ticker
            }), 404

        # Extract price arrays
        dates = [h.get('date', '') for h in history]
        opens = [float(h.get('open', h.get('open_price', 0))) for h in history]
        highs = [float(h.get('high', h.get('high_price', 0))) for h in history]
        lows = [float(h.get('low', h.get('low_price', 0))) for h in history]
        closes = [float(h.get('close', h.get('close_price', 0))) for h in history]
        volumes = [float(h.get('volume', 0)) for h in history]

        # Filter out zero prices
        valid_indices = [i for i in range(len(closes)) if closes[i] > 0]
        if len(valid_indices) < 3:
            return jsonify({
                'success': False,
                'error': f'أسعار غير صالحة لـ {ticker}',
                'ticker': ticker
            }), 404

        # INTRADAY-FIX-054: Timeframe Mismatch flag
        # لو الـ timeframe = TODAY/WEEK/Month → الداتا intraday (15m/5m)
        # المؤشرات (RSI, MACD, SMA) محسوبة على نفس الـ closes (intraday) مش EOD
        # بس لو الـ history قليلة (< 14 شمعة) → الـ RSI/MACD مش هتبان صح
        # BRIEF-049: أضفنا 5M, 15M, 1H للـ intraday timeframes
        _is_intraday = timeframe in ('5M', '15M', '1H', 'TODAY', 'WEEK', 'MONTH')

        # =====================================================================
        # 2. SPLIT ADJUSTMENT (fix unadjusted historical prices)
        # =====================================================================
        def _adjust_for_splits(opens, highs, lows, closes, volumes):
            """
            كشف وتعديل انقسامات الأسهم والقفزات الناتجة عن اختلاط مصادر البيانات.

            القاعدة (DATA-FIX-001):
            - كشف القفزات في الاتجاهين:
              * Forward split: السعر نزل (closes[i-1] / closes[i]) بين 1.8x و 10x
              * Reverse split / source jump: السعر طلع (closes[i] / closes[i-1]) بين 1.8x و 10x
            - يتم تعديل الأسعار القديمة لتتطابق مع مقياس الأسعار الحديثة.
            - القفزات > 10x تُعتبر بيانات ملوثة ويجب تجاهلها في load_merged_history
              (لا نحاول إصلاحها هنا لأن التعديل سيكون غير دقيق).
            - القفزات > 5x تُحافظ على السلوك القديم (forward split detection).
            """
            if len(closes) < 2:
                return opens, highs, lows, closes, volumes
            split_idx = -1
            split_ratio = 1.0
            split_direction = 'forward'  # 'forward' = سعر نزل، 'reverse' = سعر طلع
            for i in range(1, len(closes)):
                if closes[i - 1] > 0 and closes[i] > 0:
                    fwd_ratio = closes[i - 1] / closes[i]  # forward split (نزول)
                    rev_ratio = closes[i] / closes[i - 1]   # reverse split / قفزة (صعود)
                    # كشف القفزات في الاتجاهين، في النطاق [1.8, 10]
                    # نبدأ بـ forward للحفاظ على التوافق مع السلوك القديم (> 5x)
                    if 1.8 <= fwd_ratio <= 10:
                        split_idx = i
                        split_ratio = fwd_ratio
                        split_direction = 'forward'
                        break
                    if 1.8 <= rev_ratio <= 10:
                        split_idx = i
                        split_ratio = rev_ratio
                        split_direction = 'reverse'
                        break
            if split_idx > 0:
                for i in range(split_idx):
                    if split_direction == 'forward':
                        # السعر نزل بعد الانقسام → نقسم الأسعار القديمة
                        opens[i] = opens[i] / split_ratio
                        highs[i] = highs[i] / split_ratio
                        lows[i] = lows[i] / split_ratio
                        closes[i] = closes[i] / split_ratio
                        volumes[i] = volumes[i] * split_ratio
                    else:
                        # السعر طلع (reverse split / قفزة مصدر) → نضرب الأسعار القديمة
                        opens[i] = opens[i] * split_ratio
                        highs[i] = highs[i] * split_ratio
                        lows[i] = lows[i] * split_ratio
                        closes[i] = closes[i] * split_ratio
                        if split_ratio > 0:
                            volumes[i] = volumes[i] / split_ratio
                print(f"[ChartRoutes] ✅ Split adjustment at idx={split_idx} ({dates[split_idx] if split_idx < len(dates) else '?'}): direction={split_direction}, ratio={split_ratio:.4f}, adjusted {split_idx} candles")
            return opens, highs, lows, closes, volumes

        opens, highs, lows, closes, volumes = _adjust_for_splits(opens, highs, lows, closes, volumes)

        # =====================================================================
        # 3. CALCULATE ALL INDICATORS (Real calculations, no mock)
        # =====================================================================
        sma20_arr = _rolling_sma(closes, 20)
        sma50_arr = _rolling_sma(closes, 50)
        sma200_arr = _rolling_sma(closes, 200)
        rsi_arr = _rolling_rsi(closes, 14)
        atr_arr = _rolling_atr(highs, lows, closes, 14)
        bb_upper_arr, bb_middle_arr, bb_lower_arr = _rolling_bollinger(closes, 20, 2.0)
        cmf_arr = _calc_cmf(highs, lows, closes, volumes, 20)

        # TOOLKIT-UNIFY-010: MACD (12, 26, 9) — unify with maestro
        macd_line_arr, macd_signal_arr, macd_hist_arr = _calc_macd(closes, 12, 26, 9)

        # TOOLKIT-UNIFY-013: EMA 9/21 + Fibonacci — unify with maestro
        # EMA9/21 (using _ema_seeded helper from TOOLKIT-UNIFY-010)
        ema9_arr = _ema_seeded(closes, 9)
        ema21_arr = _ema_seeded(closes, 21)

        # Fibonacci levels based on last swing high/low
        fibonacci_levels = _calc_fibonacci_levels(closes, highs, lows, lookback=30)

        # CHART-V2-044: Volume Z-Score (كاشف السيولة الطارئة)
        vol_z_score_arr = []
        vol_z_score_latest = 0.0
        try:
            import statistics as _stats
            vol_period = 20
            for i in range(len(volumes)):
                if i < vol_period:
                    vol_z_score_arr.append(None)
                    continue
                vol_window = [v for v in volumes[i-vol_period:i] if v > 0]
                if len(vol_window) < 5:
                    vol_z_score_arr.append(None)
                    continue
                vol_mean = _stats.mean(vol_window)
                vol_stdev = _stats.stdev(vol_window) if len(vol_window) > 1 else 0
                if vol_stdev > 0:
                    z = (volumes[i] - vol_mean) / vol_stdev
                else:
                    z = 0
                vol_z_score_arr.append(round(z, 2))
            vol_z_score_latest = vol_z_score_arr[-1] if vol_z_score_arr and vol_z_score_arr[-1] is not None else 0.0
        except Exception:
            vol_z_score_arr = [None] * len(volumes)

        # CHART-V2-044: LinReg Projection for MACD (مرآة المستقبل)
        macd_projection_arr = []
        try:
            import numpy as _np
            macd_recent = [v for v in macd_line_arr[-21:] if v is not None]
            if len(macd_recent) >= 10:
                x = _np.arange(len(macd_recent))
                y = _np.array(macd_recent)
                coeffs = _np.polyfit(x, y, 1)  # Linear regression (degree=1)
                # 10 قيم null متبوعة بقيم الانحدار (متقدمة 10 شموع)
                macd_projection_arr = [None] * 10
                for j in range(10):
                    projected = coeffs[0] * (len(macd_recent) + j) + coeffs[1]
                    macd_projection_arr.append(round(float(projected), 6))
            else:
                macd_projection_arr = [None] * 20
        except Exception:
            macd_projection_arr = [None] * 20

        # CHART-V2-044: News Confirmation (Z-Score + Telegram)
        news_confirmed = False
        news_title = ''
        news_source = ''
        if vol_z_score_latest > 2.5:
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                _conn_news = db_manager.connection(DB_PATH, writable=False).__enter__()
                _conn_news.row_factory = sqlite3.Row
                from datetime import datetime as _dt_news, timedelta as _td_news
                _news_cutoff = (_dt_news.now() - _td_news(hours=3)).isoformat()
                _news_row = _conn_news.execute(
                    """SELECT summary, channel_name FROM telegram_news
                       WHERE symbols LIKE ? AND created_at >= ?
                       ORDER BY created_at DESC LIMIT 1""",
                    (f'%{ticker}%', _news_cutoff),
                ).fetchone()
                if _news_row:
                    news_confirmed = True
                    news_title = _news_row['summary'][:200] if _news_row['summary'] else ''
                    news_source = _news_row['channel_name'] or ''
                _conn_news.close()
            except Exception:
                pass

        # =====================================================================
        # 3. FORMAT DATE HELPER (Robust UNIX Timestamp & Daily Formatter)
        # =====================================================================
        def _fmt_date(raw):
            # P35 CHART-FINAL-FIX: ALWAYS return a UNIX int timestamp (seconds).
            # lightweight-charts REQUIRES numeric time. Returning 'yyyy-mm-dd'
            # or 'dd/MM HH:mm' strings causes "Invalid date string" crashes.
            # We reuse the module-level _to_unix_ts() helper which handles all
            # formats (int, float, ISO, 'yyyy-mm-dd', 'dd/MM HH:mm', etc.).
            ts = _to_unix_ts(raw)
            if ts > 0:
                return ts
            # Last resort: current time as UNIX int (never a string)
            from datetime import datetime as _dt
            return int(_dt.now().timestamp())

        # CHART-V2-044: Smart Markers (broke_r1, smart_money_in, news_confirmed, vol_spike)
        smart_markers = []
        try:
            resistance_1 = levels.get('resistance')
            support_1 = levels.get('support')
            for i in range(max(1, len(closes) - 30), len(closes)):
                if i < 1 or closes[i] <= 0:
                    continue
                # كسر مقاومة
                if resistance_1 and closes[i] > resistance_1 and closes[i-1] <= resistance_1:
                    smart_markers.append({
                        'time': _fmt_date(dates[i]),
                        'type': 'broke_r1',
                        'position': 'belowBar',
                        'color': '#22c55e',
                        'shape': 'arrowUp',
                        'text': 'كسر مقاومة',
                    })
                # تجميع مبكر (volume spike + price up + not above resistance)
                if i < len(vol_z_score_arr) and vol_z_score_arr[i] is not None:
                    if vol_z_score_arr[i] > 2.0 and closes[i] > closes[i-1] and (not resistance_1 or closes[i] < resistance_1):
                        smart_markers.append({
                            'time': _fmt_date(dates[i]),
                            'type': 'smart_money_in',
                            'position': 'belowBar',
                            'color': '#a855f7',
                            'shape': 'circle',
                            'text': 'تجميع مؤسسي',
                        })
                # خبر مؤكد
                if news_confirmed and i == len(closes) - 1:
                    smart_markers.append({
                        'time': _fmt_date(dates[i]),
                        'type': 'news_confirmed',
                        'position': 'aboveBar',
                        'color': '#facc15',
                        'shape': 'circle',
                        'text': f'خبر: {news_title[:30]}' if news_title else 'خبر مؤكد',
                    })
                # سيولة طارئة بلا خبر
                elif i < len(vol_z_score_arr) and vol_z_score_arr[i] is not None and vol_z_score_arr[i] > 2.5 and not news_confirmed:
                    smart_markers.append({
                        'time': _fmt_date(dates[i]),
                        'type': 'vol_spike_no_news',
                        'position': 'aboveBar',
                        'color': '#fde047',
                        'shape': 'circle',
                        'text': f'سيولة طارئة (Z={vol_z_score_arr[i]:.1f})',
                    })
        except Exception:
            pass

        # Get last valid values
        def _last_valid(arr):
            for v in reversed(arr):
                if v is not None:
                    return v
            return arr[-1] if arr else 0





        last_atr = _last_valid(atr_arr) or closes[-1] * 0.02
        last_rsi = rsi_arr[-1] if rsi_arr else 50.0
        last_sma20 = _last_valid(sma20_arr) or closes[-1]
        last_sma50 = _last_valid(sma50_arr) or closes[-1]
        last_sma200 = _last_valid(sma200_arr) or closes[-1]

        # MACD summary (for sidebar/quick indicators)
        last_macd = _last_valid(macd_line_arr)
        last_macd_signal = _last_valid(macd_signal_arr)
        last_macd_hist = _last_valid(macd_hist_arr)
        if last_macd is None or last_macd_signal is None:
            last_macd = last_macd or 0.0
            last_macd_signal = last_macd_signal or 0.0
            last_macd_hist = last_macd or 0.0
            macd_trend = 'neutral'
            macd_trend_ar = 'محايد'
            macd_color = '#6b7280'
        else:
            last_macd_hist = last_macd - last_macd_signal
            if last_macd > last_macd_signal and last_macd > 0:
                macd_trend = 'bullish'
                macd_trend_ar = 'صعودي 🟢'
                macd_color = '#22c55e'
            elif last_macd < last_macd_signal and last_macd < 0:
                macd_trend = 'bearish'
                macd_trend_ar = 'هبوطي 🔴'
                macd_color = '#ef4444'
            elif last_macd > last_macd_signal:
                macd_trend = 'bullish_weak'
                macd_trend_ar = 'صعودي ضعيف 🟡'
                macd_color = '#eab308'
            elif last_macd < last_macd_signal:
                macd_trend = 'bearish_weak'
                macd_trend_ar = 'هبوطي ضعيف 🟠'
                macd_color = '#f97316'
            else:
                macd_trend = 'neutral'
                macd_trend_ar = 'محايد'
                macd_color = '#6b7280'



        # =====================================================================
        # 4. BUILD OHLCV + INDICATOR ARRAYS (lightweight-charts format)
        # =====================================================================
        ohlcv = []
        ind = {k: [] for k in ['sma20', 'sma50', 'sma200', 'rsi', 'atr',
                                'bb_upper', 'bb_middle', 'bb_lower', 'cmf',
                                'macd', 'macd_signal', 'macd_histogram',
                                # TOOLKIT-UNIFY-013: EMA9/21 added to indicators arrays
                                'ema9', 'ema21']}

        arrs = {
            'sma20': sma20_arr, 'sma50': sma50_arr, 'sma200': sma200_arr,
            'rsi': rsi_arr, 'atr': atr_arr,
            'bb_upper': bb_upper_arr, 'bb_middle': bb_middle_arr, 'bb_lower': bb_lower_arr,
            'cmf': cmf_arr,
            'macd': macd_line_arr, 'macd_signal': macd_signal_arr, 'macd_histogram': macd_hist_arr,
            # TOOLKIT-UNIFY-013: EMA9/21 arrays for lightweight-charts
            'ema9': ema9_arr, 'ema21': ema21_arr,
        }

        for i in range(len(dates)):
            if closes[i] <= 0:
                continue
            # P35 CHART-FINAL-FIX: skip candles with null/NaN/zero OHLC (backend null filter)
            # so lightweight-charts never receives a "Value is null" candle.
            _o = opens[i] if opens[i] is not None and opens[i] == opens[i] else 0
            _h = highs[i] if highs[i] is not None and highs[i] == highs[i] else 0
            _l = lows[i] if lows[i] is not None and lows[i] == lows[i] else 0
            _c = closes[i] if closes[i] is not None and closes[i] == closes[i] else 0
            if _o <= 0 and _h <= 0 and _l <= 0 and _c <= 0:
                continue
            tv = _fmt_date(dates[i])
            ohlcv.append({
                'time': tv, 'open': round(_o, 4),
                'high': round(_h, 4), 'low': round(_l, 4),
                'close': round(_c, 4), 'volume': int(volumes[i]) if volumes[i] else 0
            })
            for key, arr in arrs.items():
                val = arr[i]
                ind[key].append({'time': tv, 'value': round(val, 4) if val is not None else None})

        # P35 CHART-FINAL-FIX: Defensive backend null filter — drop any candle
        # that still has None in open/high/low/close or a non-numeric time.
        # This is the LAST line of defense before the response leaves the server.
        _valid_times = set()
        _filtered_ohlcv = []
        for _candle in ohlcv:
            _t = _candle.get('time')
            _o = _candle.get('open')
            _h = _candle.get('high')
            _l = _candle.get('low')
            _cl = _candle.get('close')
            if (_t is None or not isinstance(_t, (int, float))) \
               or _o is None or _h is None or _l is None or _cl is None:
                continue
            if _o != _o or _h != _h or _l != _l or _cl != _cl:  # NaN check
                continue
            _valid_times.add(_t)
            _filtered_ohlcv.append(_candle)
        ohlcv = _filtered_ohlcv
        # Drop indicator points whose time was filtered out
        for _key in ind:
            ind[_key] = [p for p in ind[_key] if p.get('time') in _valid_times]
        # Drop smart_markers whose time was filtered out (convert marker times too)
        if smart_markers:
            _filtered_markers = []
            for _m in smart_markers:
                _mt = _m.get('time')
                _mt_int = _to_unix_ts(_mt)
                if _mt_int > 0 and _mt_int in _valid_times:
                    _m['time'] = _mt_int
                    _filtered_markers.append(_m)
            smart_markers = _filtered_markers

        # =====================================================================
        # 4b. CHART-UX-030: TIMEFRAME AGGREGATION (Weekly / Monthly)
        # =====================================================================
        # If the requested timeframe is WEEK or MONTH, aggregate the daily
        # OHLCV + indicators into weekly or monthly candles.
        # - DAY / 3MONTH / 6MONTH / YEAR / ALL → daily candles (no aggregation)
        # - WEEK → aggregate daily → weekly (ISO week)
        # - MONTH → aggregate daily → monthly (calendar month)
        _aggregated_period = None
        # V2.3: User explicitly requested intraday data for WEEK and MONTH.
        # We skip aggregation and plot the detailed intraday candles.
        # if timeframe == 'WEEK':
        #     ohlcv, ind = _aggregate_ohlcv(ohlcv, ind, period='W')
        #     _aggregated_period = 'WEEK'
        # elif timeframe == 'MONTH':
        #     ohlcv, ind = _aggregate_ohlcv(ohlcv, ind, period='M')
        #     _aggregated_period = 'MONTH'

        # =====================================================================
        # 5. SUPPORT / RESISTANCE (from real calculator + local fallback)
        # =====================================================================
        levels = {'support': None, 'resistance': None, 'pivot': None,
                  'support_levels': [], 'resistance_levels': [],
                  'far_support': None, 'far_resistance': None,
                  'zone_type': '', 'accumulation_zone': False, 'distribution_zone': False}

        def _local_support_resistance(closes, highs, lows, lookback=5):
            swing_highs = []
            swing_lows = []
            for i in range(lookback, len(closes) - lookback):
                if highs[i] == max(highs[i - lookback:i + lookback + 1]):
                    swing_highs.append(highs[i])
                if lows[i] == min(lows[i - lookback:i + lookback + 1]):
                    swing_lows.append(lows[i])
            support = min(swing_lows) if swing_lows else None
            resistance = max(swing_highs) if swing_highs else None
            far_support = min(swing_lows) if len(swing_lows) >= 2 else support
            far_resistance = max(swing_highs) if len(swing_highs) >= 2 else resistance
            pivot = (support + resistance) / 2.0 if support and resistance else (support or resistance or closes[-1])
            return {
                'support': round(support, 4) if support else None,
                'resistance': round(resistance, 4) if resistance else None,
                'far_support': round(far_support, 4) if far_support else None,
                'far_resistance': round(far_resistance, 4) if far_resistance else None,
                'pivot': round(pivot, 4),
                'support_levels': [{'price': round(p, 4), 'strength': 'weak'} for p in sorted(set(swing_lows), reverse=True)[:3]],
                'resistance_levels': [{'price': round(p, 4), 'strength': 'weak'} for p in sorted(set(swing_highs))[:3]],
                'zone_type': '',
                'accumulation_zone': False,
                'distribution_zone': False,
            }

        try:
            from analyzers.support_resistance_calculator import calculate_support_resistance
            try:
                sr = calculate_support_resistance(ticker, days=90, db_path=DB_PATH)
            except Exception as e:
                logger.error(f"[chart_routes] DB error in chart_full_analysis (calculate_support_resistance): {e}")
                sr = None
            if not sr:
                sr = _local_support_resistance(closes, highs, lows)
        except Exception as e:
            logger.error(f"[chart_routes] DB error in chart_full_analysis (S/R import): {e}")
            sr = _local_support_resistance(closes, highs, lows)

        if sr:
            levels = {
                'support': round(sr['support'], 4) if sr.get('support') else None,
                'resistance': round(sr['resistance'], 4) if sr.get('resistance') else None,
                'far_support': round(sr['far_support'], 4) if sr.get('far_support') else None,
                'far_resistance': round(sr['far_resistance'], 4) if sr.get('far_resistance') else None,
                'pivot': round(sr['pivot'], 4) if sr.get('pivot') else None,
                'support_levels': [{'price': round(l['price'], 4), 'strength': l.get('strength', 'unknown')}
                                   for l in (sr.get('support_levels') or [])],
                'resistance_levels': [{'price': round(l['price'], 4), 'strength': l.get('strength', 'unknown')}
                                      for l in (sr.get('resistance_levels') or [])],
                'zone_type': sr.get('zone_type', ''),
                'accumulation_zone': sr.get('accumulation_zone', False),
                'distribution_zone': sr.get('distribution_zone', False),
            }

        # =====================================================================
        # 6. MARKET REGIME (from RegimeDetector)
        # =====================================================================
        market_regime = {'regime': 'unknown', 'regime_ar': 'غير محدد ⚪', 'confidence': 0, 'color': '#6b7280'}
        try:
            from analyzers.regime_detector import RegimeDetector
            try:
                detector = RegimeDetector(DB_PATH)
            except Exception as e:
                logger.error(f"[chart_routes] DB error in chart_full_analysis (RegimeDetector init): {e}")
                detector = None
            if detector:
                try:
                    regime_data = detector.detect_regime(ticker)
                except Exception:
                    try:
                        regime_data = detector.detect_market_regime()
                    except Exception as e:
                        logger.error(f"[chart_routes] DB error in chart_full_analysis (detect_market_regime): {e}")
                        regime_data = None
                if regime_data:
                    rv = regime_data.get('regime', 'unknown')
                    rm = {'bull_trend': ('صعودي 🟢', '#22c55e'), 'bear_trend': ('هبوطي 🔴', '#ef4444'),
                          'ranging': ('عرضي 🟡', '#eab308'), 'volatile': ('متقلب 🟠', '#f97316'),
                          'squeeze': ('منضغط ⚡', '#a855f7')}
                    ar, clr = rm.get(rv, ('غير محدد ⚪', '#6b7280'))
                    market_regime = {'regime': rv, 'regime_ar': regime_data.get('regime_ar', ar),
                                     'confidence': regime_data.get('confidence', 0), 'color': clr}
        except Exception as e:
            logger.error(f"[chart_routes] DB error in chart_full_analysis (RegimeDetector import): {e}")

        # =====================================================================
        # 7. CONFLUENCE SCORE (5-layer Pine Script logic)
        # =====================================================================
        score = 0
        breakdown = {}
        cp = closes[-1]

        # Layer 1: Macro Trend (25 pts)
        if market_regime['regime'] == 'bull_trend':
            score += 25; breakdown['macro_trend'] = {'passed': True, 'points': 25, 'max': 25,
                'detail': f'السوق صعودي (ثقة {market_regime["confidence"]}%)'}
        elif market_regime['regime'] == 'ranging':
            score += 10; breakdown['macro_trend'] = {'passed': False, 'points': 10, 'max': 25, 'detail': 'السوق عرضي - محايد'}
        elif market_regime['regime'] == 'bear_trend':
            score += 0; breakdown['macro_trend'] = {'passed': False, 'points': 0, 'max': 25,
                'detail': f'السوق هبوطي (ثقة {market_regime["confidence"]}%)'}
        else:
            score += 12; breakdown['macro_trend'] = {'passed': False, 'points': 12, 'max': 25, 'detail': 'نظام غير محدد'}

        # Layer 2: Price vs SMA50 (15 pts)
        if cp > last_sma50:
            score += 15; breakdown['price_vs_sma50'] = {'passed': True, 'points': 15, 'max': 15,
                'detail': f'السعر ({cp:.2f}) > SMA50 ({last_sma50:.2f})'}
        else:
            score += 3; breakdown['price_vs_sma50'] = {'passed': False, 'points': 3, 'max': 15,
                'detail': f'السعر ({cp:.2f}) < SMA50 ({last_sma50:.2f})'}

        # Layer 3: RSI (20 pts)
        if 40 <= last_rsi <= 65:
            rp = 20; rd = f'RSI = {last_rsi:.1f} (منطقة مثالية)'
        elif 30 <= last_rsi < 40:
            rp = 15; rd = f'RSI = {last_rsi:.1f} (قرب التشبع البيعي)'
        elif 65 < last_rsi <= 75:
            rp = 10; rd = f'RSI = {last_rsi:.1f} (قرب التشبع الشرائي)'
        elif last_rsi < 30:
            rp = 12; rd = f'RSI = {last_rsi:.1f} (تشبع بيعي - فرصة ارتداد)'
        else:
            rp = 3; rd = f'RSI = {last_rsi:.1f} (تشبع شرائي شديد)'
        score += rp; breakdown['rsi'] = {'passed': rp >= 15, 'points': rp, 'max': 20, 'detail': rd}

        # Layer 4: Volume (20 pts)
        avg_vol = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0
        recent_vol = sum(volumes[-5:]) / min(5, len(volumes)) if volumes else 0
        vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
        if vol_ratio >= 1.3:
            vp = 20; vd = f'حجم مرتفع ({vol_ratio:.1f}x المتوسط)'
        elif vol_ratio >= 1.0:
            vp = 14; vd = f'حجم طبيعي ({vol_ratio:.1f}x المتوسط)'
        else:
            vp = 6; vd = f'حجم منخفض ({vol_ratio:.1f}x المتوسط)'
        score += vp; breakdown['volume'] = {'passed': vp >= 14, 'points': vp, 'max': 20, 'detail': vd}

        # Layer 5: Bollinger (10 pts — TUNING-V3: cut from 20→10, hit_rate 35% underperforming)
        bb_l = bb_lower_arr[-1]; bb_u = bb_upper_arr[-1]
        if bb_l is not None and bb_u is not None:
            bb_range = bb_u - bb_l
            if bb_range > 0:
                bb_pos = (cp - bb_l) / bb_range
                if 0.2 <= bb_pos <= 0.5:
                    bp = 10; bd = f'قرب الباند السفلي (فرصة شراء) - {bb_pos:.0%}'
                elif 0.5 < bb_pos <= 0.7:
                    bp = 5; bd = f'في النصف العلوي - {bb_pos:.0%}'
                elif bb_pos > 0.7:
                    bp = 2; bd = f'قرب الباند العلوي (خطر) - {bb_pos:.0%}'
                else:
                    bp = 7; bd = f'أسفل الباند السفلي (تشبع بيعي) - {bb_pos:.0%}'
            else:
                bp = 5; bd = 'لا يمكن حساب موقع البولنجر'
        else:
            bp = 5; bd = 'بيانات Bollinger غير كافية'
        score += bp; breakdown['bollinger'] = {'passed': bp >= 7, 'points': bp, 'max': 10, 'detail': bd}

        # Build OHLCV tail for candlestick pattern detection (last 3 candles)
        _ohlcv_tail = []
        for _i in range(max(0, len(closes) - 3), len(closes)):
            if closes[_i] > 0:
                _ohlcv_tail.append({
                    'open': opens[_i], 'high': highs[_i],
                    'low': lows[_i], 'close': closes[_i],
                })

        # Layer 6: MACD (23 pts — TUNING-V3: boosted from 15→23, hit_rate 77% top layer)
        # ضبط MACD لـ ABUK: فلتر volume لتأكيد التقاطع (يمنع false crossovers)
        last_macd_hist = macd_hist_arr[-1] if macd_hist_arr else None
        last_macd_line = macd_line_arr[-1] if macd_line_arr else None
        last_macd_sig = macd_signal_arr[-1] if macd_signal_arr else None
        if last_macd_hist is not None and last_macd_line is not None and last_macd_sig is not None:
            # فلتر volume: MACD crossover يتأكد فقط لو volume_ratio >= 1.0
            vol_confirmed = vol_ratio >= 1.0
            if last_macd_hist > 0 and last_macd_line > last_macd_sig:
                if vol_confirmed:
                    mp = 23; md = f'MACD صعودي مؤكد (hist={last_macd_hist:.4f}, vol={vol_ratio:.1f}x)'
                else:
                    mp = 12; md = f'MACD صعودي ضعيف الإشارة (vol={vol_ratio:.1f}x < 1.0x)'
            elif last_macd_hist > 0:
                mp = 12; md = f'MACD يتعافى (hist={last_macd_hist:.4f})'
            elif last_macd_hist < 0 and last_macd_line < last_macd_sig:
                mp = 0; md = f'MACD هبوطي (hist={last_macd_hist:.4f})'
            else:
                mp = 6; md = f'MACD يتعافى من هبوط (hist={last_macd_hist:.4f})'
        else:
            mp = 7; md = 'MACD غير محسوب (بيانات غير كافية)'
        score += mp; breakdown['macd'] = {'passed': mp >= 15, 'points': mp, 'max': 23, 'detail': md}

        # Layer 7: Candlestick Patterns (10 pts) — TOOLKIT-UNIFY-013
        candlestick_patterns = _detect_candlestick_patterns(_ohlcv_tail) if _ohlcv_tail else []
        if candlestick_patterns:
            # ابحث عن أقوى نمط
            best_pattern = None
            for p in candlestick_patterns:
                if p.get('signal') == 'bullish' and p.get('strength') == 'strong':
                    best_pattern = p; break
                elif p.get('signal') == 'bullish' and p.get('strength') == 'medium':
                    if not best_pattern or best_pattern.get('strength') != 'strong':
                        best_pattern = p
                elif p.get('signal') == 'neutral' and not best_pattern:
                    best_pattern = p
                elif p.get('signal') == 'bearish' and not best_pattern:
                    best_pattern = p
            if best_pattern:
                if best_pattern.get('signal') == 'bullish':
                    cp_pts = 10 if best_pattern.get('strength') == 'strong' else 7
                    cp_detail = f'نمط صعودي: {best_pattern.get("name_ar", best_pattern.get("name"))}'
                elif best_pattern.get('signal') == 'neutral':
                    cp_pts = 3; cp_detail = f'نمط محايد: {best_pattern.get("name_ar", best_pattern.get("name"))}'
                else:
                    cp_pts = 0; cp_detail = f'نمط هبوطي: {best_pattern.get("name_ar", best_pattern.get("name"))}'
            else:
                cp_pts = 3; cp_detail = 'لا يوجد نمط واضح'
        else:
            cp_pts = 3; cp_detail = 'لا يوجد نمط شموع واضح'
        score += cp_pts; breakdown['candlestick'] = {'passed': cp_pts >= 7, 'points': cp_pts, 'max': 10, 'detail': cp_detail}

        # Layer 8: Fibonacci Confluence (10 pts) — TOOLKIT-UNIFY-013
        fib_618 = fibonacci_levels.get('61.8%') if fibonacci_levels else None
        if fib_618 and cp > 0:
            dist_pct = abs(cp - fib_618) / cp * 100
            if dist_pct < 2.0:
                fp = 10; fd = f'السعر قرب 61.8% فيبوناتشي ({fib_618:.2f}) — دعم قوي'
            elif dist_pct < 5.0:
                fp = 5; fd = f'السعر قرب 61.8% فيبوناتشي ({fib_618:.2f}) — دعم متوسط'
            else:
                fp = 2; fd = f'السعر بعيد عن 61.8% فيبوناتشي ({fib_618:.2f})'
        else:
            fp = 3; fd = 'فيبوناتشي غير محسوب'
        score += fp; breakdown['fibonacci'] = {'passed': fp >= 5, 'points': fp, 'max': 10, 'detail': fd}

        # Signal from score (8 layers, max ~135 pts)
        if score >= 80:
            base_sig, base_sig_c = 'دخول فائق الأمان 🔥', '#22c55e'
        elif score >= 65:
            base_sig, base_sig_c = 'فرصة شراء قوية ✅', '#16a34a'
        elif score >= 50:
            base_sig, base_sig_c = 'إشارة إيجابية 📈', '#84cc16'
        elif score >= 35:
            base_sig, base_sig_c = 'محايد - انتظر ⏳', '#eab308'
        elif score >= 20:
            base_sig, base_sig_c = 'إشارة سلبية ⚠️', '#f97316'
        else:
            base_sig, base_sig_c = 'خطر - تجنب ❌', '#ef4444'

        confluence = {'score': score, 'breakdown': breakdown, 'signal': base_sig, 'signal_color': base_sig_c}

        # =====================================================================
        # 7b. CHART-UX-030: USER STATE TOGGLE (Buyer vs Owner)
        # =====================================================================
        is_uptrend = (closes[-1] > (last_sma50 or closes[-1])) and (last_rsi > 50)
        signal_adjusted = True
        adjustment_reason = _adjustment_reason + " | " if _adjustment_reason else ''

        # =====================================================================
        # Task BRAVO-CHART-HARD-CAP: Bear Trend Hard Cap (Owner Directive)
        # =====================================================================
        # منع إصدار إشارات شراء للأسهم المنهارة (Falling Knives).
        # لو السهم في مسار هابط هيكلي → يُحظر "فرصة شراء قوية" و "دخول فائق الأمان"
        # مهما بلغت نقاطه من التشبع البيعي أو فيبوناتشي.
        # =====================================================================
        is_structural_downtrend = (
            market_regime.get('regime') == 'bear_trend' or
            (last_sma50 and cp < last_sma50 * 0.95)
        )

        if is_structural_downtrend and user_state != 'owner':
            # Hard Cap: السهم في مسار هابط → لا إشارات شراء إطلاقاً
            if score >= 35:
                confluence['signal'] = 'محايد - ارتداد في مسار هابط ⏳'
                confluence['signal_color'] = '#eab308'
            else:
                confluence['signal'] = 'خطر - ابتعد ❌'
                confluence['signal_color'] = '#ef4444'
            adjustment_reason = (
                'وضع المشتري: السهم يتداول تحت المتوسطات الرئيسية في مسار هابط. '
                'يُمنع الشراء أو التقاط السكاكين الساقطة.'
            )
            signal_adjusted = True
            # Risk Profile Gate: لا أهداف صعودية للأسهم الساقطة
            # (يتم تطبيقه في قسم risk أدناه)

        if user_state == 'owner':
            if last_rsi > 75 and is_uptrend:
                confluence['signal'] = 'بيع جزئي / جني أرباح 💰'
                confluence['signal_color'] = '#f59e0b'
                adjustment_reason = f'وضع المالك: السهم في اتجاه صاعد قوي ولكن مع تشبع شرائي (RSI={last_rsi:.1f}). يُنصح بجني 30-50% من الأرباح والاحتفاظ بالباقي.'
            elif score >= 65:
                confluence['signal'] = 'احتفاظ - اتجاه صاعد 📈'
                confluence['signal_color'] = '#22c55e'
                adjustment_reason = 'وضع المالك: السهم في مسار صاعد قوي ومؤشراته إيجابية. يُنصح بالاحتفاظ بالكمية مع رفع مستوى وقف الخسارة تدريجياً.'
            elif score >= 50:
                confluence['signal'] = 'احتفاظ ومراقبة ⏳'
                confluence['signal_color'] = '#84cc16'
                adjustment_reason = 'وضع المالك: السهم في مسار إيجابي ولكن بانتظار تأكيد إضافي (مثل زيادة السيولة). احتفظ بالسهم مع المتابعة المستمرة.'
            elif score >= 35:
                confluence['signal'] = 'مراقبة حذرة / جني أرباح ⚠️'
                confluence['signal_color'] = '#f97316'
                adjustment_reason = 'وضع المالك: السهم فقد الزخم الإيجابي وأصبح في مسار عرضي أو ضعيف. راقب مستويات الدعم وفكر في جني جزء من الأرباح.'
            else:
                confluence['signal'] = 'تفعيل الوقف / بيع 🛑'
                confluence['signal_color'] = '#ef4444'
                adjustment_reason = 'وضع المالك: مؤشرات السهم سلبية للغاية وهناك ضغط بيعي. يُنصح بتفعيل وقف الخسارة أو التخفيف لحماية رأس المال.'
        else:
            if last_rsi > 75:
                confluence['signal'] = 'ابتعد / تشبع شرائي ⛔'
                confluence['signal_color'] = '#ef4444'
                adjustment_reason = f'وضع المشتري: السهم صعد بقوة وهو الآن في منطقة تشبع شرائي (RSI={last_rsi:.1f}). الدخول الآن يعتبر مخاطرة عالية، يُفضل انتظار تصحيح سعري.'
            elif score >= 80:
                confluence['signal'] = 'دخول فائق الأمان 🔥'
                confluence['signal_color'] = '#22c55e'
                adjustment_reason = 'وضع المشتري: فرصة ممتازة للدخول. تتوافق مؤشرات الزخم والسيولة والاتجاه لدعم قرار الشراء بأمان كبير.'
            elif score >= 65:
                confluence['signal'] = 'فرصة شراء قوية ✅'
                confluence['signal_color'] = '#16a34a'
                adjustment_reason = 'وضع المشتري: إشارات الشراء قوية ومكتملة. يمكن الدخول الآن مع الالتزام الصارم بنقاط وقف الخسارة أسفل مناطق الدعم.'
            elif score >= 50:
                confluence['signal'] = 'دخول حذر / تجميع 📈'
                confluence['signal_color'] = '#84cc16'
                adjustment_reason = 'وضع المشتري: السهم يُظهر بوادر تعافي وإيجابية. يمكن بناء مركز مالي تدريجي (شراء على دفعات) مع مراقبة اختراق المقاومات.'
            elif score >= 35:
                confluence['signal'] = 'محايد - انتظر فرصة ⏳'
                confluence['signal_color'] = '#eab308'
                adjustment_reason = 'وضع المشتري: السهم في مسار غير واضح (عرضي) أو يفتقر للزخم. الأفضل التريث والانتظار حتى تظهر إشارة تأكيد قوية للاختراق أو الارتداد.'
            else:
                confluence['signal'] = 'خطر - ابتعد ❌'
                confluence['signal_color'] = '#ef4444'
                adjustment_reason = 'وضع المشتري: المسار العام هابط والمؤشرات سلبية جداً. لا تحاول التقاط السكين الساقط، ابتعد تماماً عن السهم حالياً.'

        # =====================================================================
        # 8. DYNAMIC RISK PARAMETERS (regime + volatility + score aware)
        # =====================================================================
        entry = cp

        if entry <= 0:
            entry = 1.0

        safe_atr = last_atr if last_atr and last_atr > 0 else entry * 0.02
        max_atr = entry * 0.15
        if safe_atr > max_atr:
            safe_atr = max_atr
            logger.warning(f"[chart_routes] ATR {last_atr:.4f} > 15% of entry {entry:.2f}, clamped to {safe_atr:.4f}")

        atr_pct = (safe_atr / entry) * 100 if entry > 0 else 0

        # ---- Helpers ----
        def _swing_lows(highs, lows, lookback=5):
            sl = []
            for i in range(lookback, len(lows) - lookback):
                if lows[i] == min(lows[i - lookback:i + lookback + 1]):
                    sl.append(lows[i])
            return sl

        def _swing_highs(highs, lows, lookback=5):
            sh = []
            for i in range(lookback, len(highs) - lookback):
                if highs[i] == max(highs[i - lookback:i + lookback + 1]):
                    sh.append(highs[i])
            return sh

        # ---- Dynamic ATR multipliers by regime (port from prediction_optimizer.py) ----
        REGIME_ATR_MULTIPLIERS = {
            'strong_bull': {'stop': 3.0, 'target': 5.0},
            'bull_trend': {'stop': 2.5, 'target': 4.0},
            'ranging': {'stop': 1.5, 'target': 2.5},
            'bear_trend': {'stop': 1.0, 'target': 2.0},
            'strong_bear': {'stop': 0.5, 'target': 1.0},
            'volatile': {'stop': 2.0, 'target': 3.0},
            'squeeze': {'stop': 2.0, 'target': 3.5},
            'unknown': {'stop': 1.5, 'target': 2.5},
        }

        regime_key = market_regime.get('regime', 'unknown')
        mults = REGIME_ATR_MULTIPLIERS.get(regime_key, REGIME_ATR_MULTIPLIERS['unknown'])

        # Volatility override: high ATR% → widen stop, low ATR% → tighten
        if atr_pct > 8:
            mults = {'stop': mults['stop'] * 1.3, 'target': mults['target'] * 1.2}
        elif atr_pct < 1.5:
            mults = {'stop': mults['stop'] * 0.7, 'target': mults['target'] * 0.8}

        # Score override: high score → wider targets, low score → tighter
        if score >= 70:
            mults = {'stop': mults['stop'] * 1.1, 'target': mults['target'] * 1.3}
        elif score < 35:
            mults = {'stop': mults['stop'] * 0.8, 'target': mults['target'] * 0.7}

        # Persona override
        if user_persona == 'مستثمر طويل الأجل':
            mults = {'stop': mults['stop'] * 1.4, 'target': mults['target'] * 1.5}

        stop_mult = mults['stop']
        target_mult = mults['target']
        target2_mult = target_mult * 1.5

        # ---- 4-Layer Stop Selection (port from dynamic_target_engine.py) ----
        swing_lows_list = _swing_lows(highs, lows)
        nearest_swing_low = min(swing_lows_list) if swing_lows_list else None
        support_price = levels.get('support')
        sl_candidates = []

        # L1: Support-based (confidence 1.0)
        if support_price and support_price > 0 and support_price < entry:
            sl_candidates.append((support_price * 0.99, 1.0, 'support'))
        # L2: Swing Low (confidence 0.9)
        if nearest_swing_low and nearest_swing_low > 0 and nearest_swing_low < entry:
            sl_candidates.append((nearest_swing_low * 0.99, 0.9, 'swing_low'))
        # L3: ATR-based (confidence 0.85)
        sl_candidates.append((entry - safe_atr * stop_mult, 0.85, 'atr'))
        # L4: Fallback (confidence 0.3)
        sl_candidates.append((entry * 0.90, 0.3, 'fallback'))

        sl = max(sl_candidates, key=lambda x: x[1])[0]
        sl = round(sl, 4)
        if sl >= entry:
            sl = round(entry * 0.97, 4)

        # ---- 5-Layer Target Selection ----
        swing_highs_list = _swing_highs(highs, lows)
        nearest_swing_high = max(swing_highs_list) if swing_highs_list else None
        resistance_price = levels.get('resistance')
        far_resistance = levels.get('far_resistance')
        t1_candidates = []

        # L1: Resistance (confidence 1.0)
        if resistance_price and resistance_price > entry:
            t1_candidates.append((resistance_price * 0.99, 1.0))
        # L2: Swing High (confidence 0.85)
        if nearest_swing_high and nearest_swing_high > entry:
            t1_candidates.append((nearest_swing_high * 0.99, 0.85))
        # L3: ATR-based (confidence 0.75)
        t1_candidates.append((entry + safe_atr * target_mult, 0.75))
        # L4: R/R enforced (confidence 0.7)
        risk_dist = entry - sl
        if risk_dist > 0:
            min_rr = 1.5 if score >= 50 else 1.2
            t1_candidates.append((entry + risk_dist * min_rr, 0.7))
        # L5: Fallback (confidence 0.3)
        t1_candidates.append((entry * 1.10, 0.3))

        t1 = max(t1_candidates, key=lambda x: x[1])[0]
        t1 = round(t1, 4)

        # Target 2: extend from t1 or use far_resistance
        t2_candidates = []
        if far_resistance and far_resistance > t1:
            t2_candidates.append((far_resistance * 0.98, 1.0))
        if resistance_price and resistance_price > t1:
            t2_candidates.append((resistance_price * 0.98, 0.9))
        t2_candidates.append((entry + safe_atr * target2_mult, 0.6))
        t2_candidates.append((t1 * 1.05, 0.4))
        t2 = max(t2_candidates, key=lambda x: x[1])[0]
        t2 = round(t2, 4)

        # ---- R/R calculation ----
        rr = round((t1 - entry) / (entry - sl), 2) if (entry - sl) > 0 else 0
        risk = {'entry': round(entry, 4), 'target': t1, 'target_2': t2,
                'stop_loss': sl, 'rr_ratio': rr, 'atr': round(safe_atr, 4),
                'atr_pct': round(atr_pct, 2)}

        # =====================================================================
        # P0-KILLSWITCH-050: Target Validation Gate (منع الأهداف الخرافية)
        # =====================================================================
        # كارثة: target < entry في إشارة شراء = العميل بيشتري وبيبيع برخس!
        # الحل: Kill Switch صارم يمنع الداتا الخرافية من الخروج للعميل.
        _ks_signal = confluence.get('signal', '').lower()
        _ks_is_buy = 'شراء' in _ks_signal or 'buy' in _ks_signal or 'دخول' in _ks_signal
        _ks_is_sell = 'بيع' in _ks_signal or 'sell' in _ks_signal or 'ابعد' in _ks_signal

        if _ks_is_buy:
            # target لازم يكون > entry
            if risk['target'] <= risk['entry']:
                risk['target'] = round(risk['entry'] * 1.015, 4)
                logger.warning(f"[KILLSWITCH] {ticker}: target was <= entry for BUY! Fixed to {risk['target']}")
            # stop_loss لازم يكون < entry
            if risk['stop_loss'] >= risk['entry']:
                risk['stop_loss'] = round(risk['entry'] * 0.985, 4)
                logger.warning(f"[KILLSWITCH] {ticker}: stop_loss was >= entry for BUY! Fixed to {risk['stop_loss']}")
            # target_2 لازم يكون > target
            if risk['target_2'] <= risk['target']:
                risk['target_2'] = round(risk['target'] * 1.05, 4)
                logger.warning(f"[KILLSWITCH] {ticker}: target_2 was <= target! Fixed to {risk['target_2']}")
        elif _ks_is_sell:
            # في البيع: target لازم يكون < entry
            if risk['target'] >= risk['entry']:
                risk['target'] = round(risk['entry'] * 0.985, 4)
                logger.warning(f"[KILLSWITCH] {ticker}: target was >= entry for SELL! Fixed to {risk['target']}")
            # stop_loss لازم يكون > entry (في البيع الوقف فوق)
            if risk['stop_loss'] <= risk['entry']:
                risk['stop_loss'] = round(risk['entry'] * 1.015, 4)
                logger.warning(f"[KILLSWITCH] {ticker}: stop_loss was <= entry for SELL! Fixed to {risk['stop_loss']}")

        # إعادة حساب R/R بعد الـ Kill Switch
        _ks_denom = risk['entry'] - risk['stop_loss']
        risk['rr_ratio'] = round((risk['target'] - risk['entry']) / _ks_denom, 2) if _ks_denom > 0 else 0

        # =====================================================================
        # Task BRAVO-CHART-HARD-CAP: Risk Profile Gate (Owner Directive)
        # =====================================================================
        # حظر توليد خطط صعودية للأسهم الساقطة.
        # لو السهم في مسار هابط (is_structural_downtrend) وليست إشارة شراء
        # حقيقية مؤكدة → لا تصدير أهداف صعودية عشوائية (target, target_2).
        # القمم = مقاومات خروج فقط (resistance_exit)، NOT أهداف ربح.
        # =====================================================================
        _signal_text = confluence.get('signal', '').lower()
        _is_confirmed_buy = ('شراء' in _signal_text or 'buy' in _signal_text or 'دخول' in _signal_text) and 'ابتعد' not in _signal_text

        if is_structural_downtrend and not _is_confirmed_buy:
            # امسح الأهداف الصعودية الوهمية
            risk['target'] = None
            risk['target_2'] = None
            risk['rr_ratio'] = None
            risk['risk_profile_note'] = (
                'السهم في مسار هابط — لا توجد أهداف صعودية. '
                'القمم السابقة = مقاومات خروج/تصريف، NOT أهداف ربح.'
            )
            logger.info(f"[HARD-CAP] {ticker}: Risk Profile Gate active — targets nulled (downtrend)")

        # =====================================================================
        # P16-DELAY-COMPENSATION: تعويض تأخير البيانات 5 دقايق (EGX intraday)
        # ---------------------------------------------------------------------
        # العميل بيشوف توصية شراء متأخرة 5 دقايق. عشان نحميه:
        # - نقلّل المسافة بين entry و stop_loss بنسبة 15% (الوقف يقرب ناحية الدخول
        #   → لو السهم رجع بعد ما العميل دخل، ما يتقفلش وهو ماسك).
        # - نوسّع المسافة بين entry و target بنسبة 5% (نعوّض الـ slippage).
        # بيشتغل بس لو: السوق المصري مفتوح الآن (intraday) + التوصية BUY/STRONG_BUY.
        # الـ flag `delay_compensation_applied` بيروح للـ frontend عشان يعرض البادج.
        # =====================================================================
        _delay_comp = False
        try:
            _dc_signal = confluence.get('signal', '').lower()
            _dc_is_buy = ('شراء' in _dc_signal or 'buy' in _dc_signal
                          or 'دخول' in _dc_signal or 'accumulat' in _dc_signal)
            if _dc_is_buy and _is_egx_intraday_now():
                _dc_entry = risk['entry']
                _dc_sl = risk['stop_loss']
                _dc_t1 = risk['target']
                _dc_t2 = risk['target_2']
                # نقلّل المسافة للوقف بنسبة 15% (المسافة → 85%)
                if _dc_entry > 0 and _dc_sl > 0 and _dc_sl < _dc_entry:
                    _risk_dist = _dc_entry - _dc_sl
                    risk['stop_loss'] = round(_dc_entry - (_risk_dist * 0.85), 4)
                # نوسّع المسافة للهدف بنسبة 5% (المسافة → 105%)
                if _dc_entry > 0 and _dc_t1 > _dc_entry:
                    _reward_dist = _dc_t1 - _dc_entry
                    risk['target'] = round(_dc_entry + (_reward_dist * 1.05), 4)
                if _dc_entry > 0 and _dc_t2 > _dc_entry:
                    _reward2_dist = _dc_t2 - _dc_entry
                    risk['target_2'] = round(_dc_entry + (_reward2_dist * 1.05), 4)
                # إعادة حساب R/R بعد التعويض
                _dc_denom = risk['entry'] - risk['stop_loss']
                if _dc_denom > 0:
                    risk['rr_ratio'] = round((risk['target'] - risk['entry']) / _dc_denom, 2)
                _delay_comp = True
                logger.info(f"[chart_routes] {ticker}: ⏱️ delay compensation applied "
                            f"(EGX intraday BUY) — SL tightened 15%, target widened 5%")
        except Exception as _dc_err:
            logger.warning(f"[chart_routes] delay compensation error for {ticker}: {_dc_err}")
        risk['delay_compensation_applied'] = _delay_comp

        # =====================================================================
        # 8b. PORTFOLIO-PRICE-FIX-005 + HUMANIZE-034: Defensive validation
        # =====================================================================
        # لضمان أن ناتج التحليل منطقي دائماً حتى لو فيه خلل في حسابات الإدخال.
        # HUMANIZE-034: يُمنع استخدام النسب الثابتة (entry * 1.10 / entry * 0.95).
        # بدلاً من ذلك: استخدم S/R الحقيقي، أو swing high/low، أو ATR.
        # لو الـ R/R الناتج < 1.0 → التوصية تتغير إلى "انتظار".
        try:
            _entry = risk.get('entry')
            if _entry is None or _entry <= 0:
                _entry = float(closes[-1]) if closes and closes[-1] > 0 else 1.0
                _entry = round(_entry, 4)
                risk['entry'] = _entry
                logger.warning(f"[chart_routes] {ticker}: entry was 0/NULL, set to closes[-1]={_entry}")

            _target = risk.get('target')
            if _target is None or _target <= 0 or _target <= _entry:
                # HUMANIZE-034: استخدم مقاومة حقيقية أو swing high أو ATR (مش entry * 1.10)
                _resistance = levels.get('resistance')
                _swing_hi = max(_swing_highs(highs, lows)) if _swing_highs(highs, lows) else None
                if _resistance and _resistance > _entry:
                    _target = round(_resistance * 0.99, 4)
                elif _swing_hi and _swing_hi > _entry:
                    _target = round(_swing_hi * 0.99, 4)
                else:
                    # آخر خيار: ATR-based (مش نسبة ثابتة)
                    _target = round(_entry + (safe_atr * target_mult), 4)
                risk['target'] = _target
                logger.warning(f"[chart_routes] {ticker}: target invalid, set to S/R/ATR-based={_target}")

            _stop = risk.get('stop_loss')
            # نتأكد إن stop_loss موجب وأقل من entry
            if _stop is None or _stop <= 0 or _stop >= _entry:
                # HUMANIZE-034: استخدم دعم حقيقي أو swing low أو ATR (مش entry * 0.95)
                _support = levels.get('support')
                _swing_lo = min(_swing_lows(highs, lows)) if _swing_lows(highs, lows) else None
                if _support and _support > 0 and _support < _entry:
                    _stop = round(_support * 0.99, 4)
                elif _swing_lo and _swing_lo > 0 and _swing_lo < _entry:
                    _stop = round(_swing_lo * 0.99, 4)
                else:
                    # آخر خيار: ATR-based (مش نسبة ثابتة)
                    _stop = round(_entry - (safe_atr * stop_mult), 4)
                risk['stop_loss'] = _stop
                logger.warning(f"[chart_routes] {ticker}: stop_loss invalid, set to S/R/ATR-based={_stop}")

            # target_2 defensive: لو مفقود أو <= target
            _t2 = risk.get('target_2')
            if _t2 is None or _t2 <= _target:
                _far_res = levels.get('far_resistance')
                if _far_res and _far_res > _target:
                    _t2 = round(_far_res * 0.98, 4)
                else:
                    _t2 = round(_target * 1.05, 4)
                risk['target_2'] = _t2

            # R/R recalc
            _denom = _entry - _stop
            risk['rr_ratio'] = round((_target - _entry) / _denom, 2) if _denom > 0 else 0

            # Confluence score clamp (0-100)
            _score = confluence.get('score')
            if _score is None or not isinstance(_score, (int, float)):
                _score = 0
            if _score < 0:
                _score = 0
                logger.warning(f"[chart_routes] {ticker}: score was negative, clamped to 0")
            elif _score > 100:
                _score = 100
                logger.warning(f"[chart_routes] {ticker}: score > 100, clamped to 100")
            confluence['score'] = int(_score)

            # HUMANIZE-034: لو R/R < 1.0 → غيّر الإشارة إلى "انتظار"
            # (المخاطرة أكبر من الربح — مفيش قيمة للتوصية)
            _rr = risk.get('rr_ratio', 0)
            if _rr < 1.0 and _score < 80:
                # فقط لو مش إشارة قوية جداً (score >= 80 ممكن نسمح بـ R/R أقل)
                _orig_signal = confluence.get('signal', '')
                if 'شراء' in _orig_signal:
                    confluence['signal'] = 'انتظر - R/R ضعيف ⏳'
                    confluence['signal_color'] = '#eab308'
                    logger.info(f"[chart_routes] {ticker}: R/R={_rr} < 1.0, downgraded BUY → HOLD")

            # BRIEF-042-FIX: R/R Realism — لو R/R > 4:1، قسمه لـ هدف 1 + هدف 2
            # المشكلة: R/R = 9.8:1 رقم خرافي بس السهم مش بيروح من 72 لـ 114 في يوم.
            # الحل: target_1 = entry + (risk * 4) (بيع 50% عند 4:1)
            #        target_2 = الـ target الأصلي (الباقي للـ 9:1)
            if _rr > 4.0 and _denom > 0:
                _entry_val = risk.get('entry', _entry)
                _target_orig = risk.get('target', _target)
                # هدف 1: entry + (risk × 4) = R/R = 4:1
                _target_1 = round(_entry_val + (_denom * 4), 4)
                # هدف 2: الـ target الأصلي (R/R الأصلي)
                _target_2 = round(_target_orig, 4)
                risk['target'] = _target_1  # الهدف الأساسي بقى هدف 1
                risk['target_2'] = _target_2  # target_2 بقى الهدف البعيد
                risk['rr_ratio'] = 4.0  # R/R الظاهر = 4:1 (الواقعي)
                risk['partial_exit_note'] = (
                    f'بيع 50% عند {_target_1:.2f} (R/R 4:1) '
                    f'والباقي عند {_target_2:.2f} (R/R {_rr:.1f}:1)'
                )
                logger.info(
                    f"[chart_routes] {ticker}: R/R={_rr:.1f} > 4 → "
                    f"target_1={_target_1} (4:1), target_2={_target_2} ({_rr:.1f}:1)"
                )
        except Exception as _ve:
            logger.error(f"[chart_routes] {ticker}: validation block failed: {_ve}")

        # =====================================================================
        # 9. BOS & BB SQUEEZE
        # =====================================================================
        bos_events = _detect_bos(closes, highs, lows, lookback=5)
        bb_squeeze = _detect_bb_squeeze(bb_upper_arr, bb_lower_arr, closes, highs=highs, lows=lows)

        # =====================================================================
        # 9b. CANDLESTICK PATTERNS (TOOLKIT-UNIFY-010)
        # =====================================================================
        candlestick_patterns = []
        try:
            # Build a small OHLCV slice (last 3 candles) for pattern detection
            _ohlcv_tail = []
            for i in range(max(0, len(closes) - 3), len(closes)):
                if closes[i] <= 0:
                    continue
                _ohlcv_tail.append({
                    'open': opens[i], 'high': highs[i],
                    'low': lows[i], 'close': closes[i],
                })
            candlestick_patterns = _detect_candlestick_patterns(_ohlcv_tail)
        except Exception as _ce:
            logger.debug(f"[chart_routes] candlestick_patterns failed for {ticker}: {_ce}")
            candlestick_patterns = []

        # =====================================================================
        # 10. PROJECT SIGNALS (Flow System - best effort)
        # =====================================================================
        project_signals = {'maestro_signal': None, 'persona_investor': None, 'persona_gambler': None, 'ai_confidence': None}
        try:
            # TOOLKIT-UNIFY-013: fixed import path — flow_system is in engine/ not analyzers/
            try:
                from engine.flow_system import FlowSystemEngine
            except ImportError:
                from analyzers.flow_system import FlowSystemEngine  # legacy path (silently fails)
            try:
                fe = FlowSystemEngine(DB_PATH)
            except Exception as e:
                logger.error(f"[chart_routes] DB error in chart_full_analysis (FlowSystemEngine init): {e}")
                fe = None
            if fe:
                try:
                    fl = fe.calculate_flow_score(ticker)
                    if fl:
                        project_signals['maestro_signal'] = {
                            'signal': fl.label_en or fl.label, 'label_ar': fl.label,
                            'score': fl.flow_score, 'color': fl.color, 'action': fl.action_en,
                        }
                    else:
                        # TOOLKIT-UNIFY-013: stub fallback (flow_score None when stocks table lacks data)
                        project_signals['maestro_signal'] = {
                            'signal': 'UNKNOWN', 'label_ar': 'غير مُقيّم',
                            'score': 0, 'color': '#6b7280', 'action': 'WAIT',
                        }
                except Exception as e:
                    logger.error(f"[chart_routes] DB error in chart_full_analysis (calculate_flow_score): {e}")
                    project_signals['maestro_signal'] = {
                        'signal': 'ERROR', 'label_ar': 'خطأ في الحساب',
                        'score': 0, 'color': '#ef4444', 'action': 'WAIT',
                    }
        except Exception as e:
            logger.error(f"[chart_routes] DB error in chart_full_analysis (FlowSystemEngine import): {e}")
            # Stub fallback so the response always has the key
            project_signals['maestro_signal'] = {
                'signal': 'UNAVAILABLE', 'label_ar': 'محرك التدفقات غير متاح',
                'score': 0, 'color': '#6b7280', 'action': 'WAIT',
            }

        # =====================================================================
        # 11. FUNDAMENTALS FROM data_engine.db (best effort)
        # =====================================================================
        fundamentals = {}
        try:
            _DATA_ENGINE_DB = os.environ.get('DATA_ENGINE_DB', str(Path(__file__).parent.parent.parent / 'db' / 'data_engine.db'))
            if Path(_DATA_ENGINE_DB).exists():
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                fe_conn = db_manager.connection(_DATA_ENGINE_DB, writable=False).__enter__()
                fe_cur = fe_conn.cursor()

                def _safe_num(val):
                    if val is None:
                        return None
                    s = str(val).strip()
                    if not s or s.lower() in ('none', 'nan', '-'):
                        return None
                    s = s.replace('%', '').replace(',', '').replace('−', '-').replace(' ', '')
                    try:
                        return float(s)
                    except ValueError:
                        return None

                def _safe_str(val):
                    if val is None:
                        return None
                    s = str(val).strip()
                    return s if s and s.lower() not in ('none', 'nan', '-') else None

                # valuation — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                try:
                    fe_cur.execute("SELECT pe_ratio, pb_ratio, peg_ratio FROM tab_valuation WHERE symbol = ? LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row:
                        pe = _safe_num(row[0])
                        pb = _safe_num(row[1])
                        peg = _safe_num(row[2])
                        val = {'pe_ratio': pe, 'pb_ratio': pb, 'peg_ratio': peg}
                        insights = []
                        if pe is not None:
                            if pe < 8:
                                insights.append({'field': 'P/E', 'value': pe, 'verdict': 'مغري', 'color': 'green', 'text': 'السهم مقيم بأقل من قيمته الحقيقية'})
                            elif pe < 18:
                                insights.append({'field': 'P/E', 'value': pe, 'verdict': 'منطقي', 'color': 'yellow', 'text': 'تقييم السهم في النطاق المنطقي'})
                            else:
                                insights.append({'field': 'P/E', 'value': pe, 'verdict': 'مرتفع', 'color': 'red', 'text': 'السهم مقيم بأعلى من قيمته — احتمال تصحيح هبوطي'})
                        if pb is not None:
                            if pb < 1:
                                insights.append({'field': 'P/B', 'value': pb, 'verdict': 'أقل من 1', 'color': 'green', 'text': 'السهم يتداول تحت قيمة كتابية — فرصة قيمة'})
                            elif pb < 3:
                                insights.append({'field': 'P/B', 'value': pb, 'verdict': 'منطقي', 'color': 'yellow', 'text': 'P/B في النطاق المقبول'})
                            else:
                                insights.append({'field': 'P/B', 'value': pb, 'verdict': 'مرتفع', 'color': 'red', 'text': 'P/B مرتفع — السهم مبالغ في تقييمه'})
                        fundamentals['valuation'] = val
                        if insights:
                            fundamentals['valuation_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals valuation query failed: {e}")

                # balance sheet — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                # DATA-ENGINE-UNIFY-1 Stage 2b: ORDER BY id DESC (last_updated column not in schema)
                try:
                    fe_cur.execute("SELECT total_assets, total_liabilities FROM tab_balance_sheet WHERE symbol = ? ORDER BY id DESC LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row and row[0] and row[1]:
                        ta = _safe_num(row[0])
                        tl = _safe_num(row[1])
                        if ta and tl and tl > 0:
                            sr = round(ta / tl, 2)
                            bs = {'total_assets': ta, 'total_liabilities': tl, 'solvency_ratio': sr}
                            insights = []
                            if sr > 2:
                                insights.append({'field': 'نسبة الملاءة', 'value': sr, 'verdict': 'ممتازة', 'color': 'green', 'text': 'الشركة تغطي التزاماتها بأصولها بسهولة'})
                            elif sr > 1:
                                insights.append({'field': 'نسبة الملاءة', 'value': sr, 'verdict': 'جيدة', 'color': 'yellow', 'text': 'الملاءة مقبولة لكن تحتاج مراقبة'})
                            else:
                                insights.append({'field': 'نسبة الملاءة', 'value': sr, 'verdict': 'خطر', 'color': 'red', 'text': 'نسبة ملاءة أقل من 1 — الشركة قد تعاني من سيولة'})
                            fundamentals['balance_sheet'] = bs
                            fundamentals['balance_sheet_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals balance_sheet query failed: {e}")

                # profitability — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                try:
                    fe_cur.execute("SELECT roe, net_margin FROM tab_profitability WHERE symbol = ? LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row:
                        roe = _safe_num(row[0])
                        pm = _safe_num(row[1])
                        prof = {'roe': roe, 'profit_margin': pm}
                        insights = []
                        if roe is not None:
                            if roe > 15:
                                insights.append({'field': 'ROE', 'value': roe, 'verdict': 'ممتاز', 'color': 'green', 'text': 'الشركة تحقق عائد مرتفع على حقوق الملكية'})
                            elif roe > 8:
                                insights.append({'field': 'ROE', 'value': roe, 'verdict': 'جيد', 'color': 'yellow', 'text': 'ROE في النطاق المقبول'})
                            else:
                                insights.append({'field': 'ROE', 'value': roe, 'verdict': 'ضعيف', 'color': 'red', 'text': 'العائد على حقوق الملكية ضعيف'})
                        if pm is not None:
                            if pm > 10:
                                insights.append({'field': 'هامش الربح', 'value': pm, 'verdict': 'ممتاز', 'color': 'green', 'text': 'هامش صافي مرتفع — كفاءة تشغيلية جيدة'})
                            elif pm > 3:
                                insights.append({'field': 'هامش الربح', 'value': pm, 'verdict': 'جيد', 'color': 'yellow', 'text': 'هامش ربح مقبول'})
                            else:
                                insights.append({'field': 'هامش الربح', 'value': pm, 'verdict': 'ضعيف', 'color': 'red', 'text': 'هامش ربح منخفض — ضغوط على هوامش الشركة'})
                        fundamentals['profitability'] = prof
                        fundamentals['profitability_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals profitability query failed: {e}")

                # dividends — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                try:
                    fe_cur.execute("SELECT div_yield FROM tab_dividends WHERE symbol = ? LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row:
                        dy = _safe_num(row[0])
                        div = {'dividend_yield': dy}
                        insights = []
                        if dy is not None:
                            if dy > 5:
                                insights.append({'field': 'Dividend Yield', 'value': dy, 'verdict': 'مرتفع', 'color': 'green', 'text': 'عائد توزيع مرتفع — جيد للمستثمر الدخل'})
                            elif dy > 2:
                                insights.append({'field': 'Dividend Yield', 'value': dy, 'verdict': 'جيد', 'color': 'yellow', 'text': 'عائد توزيع متوسط'})
                            else:
                                insights.append({'field': 'Dividend Yield', 'value': dy, 'verdict': 'منخفض', 'color': 'red', 'text': 'العائد على التوزيع منخفض'})
                        fundamentals['dividends'] = div
                        fundamentals['dividends_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals dividends query failed: {e}")

                # performance — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                try:
                    fe_cur.execute("SELECT perf_1w, perf_1m, perf_3m FROM tab_performance WHERE symbol = ? LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row:
                        perf = {'1w': _safe_num(row[0]), '1m': _safe_num(row[1]), '3m': _safe_num(row[2])}
                        insights = []
                        vals = [('أسبوع', perf['1w']), ('شهر', perf['1m']), ('3 أشهر', perf['3m'])]
                        for label, v in vals:
                            if v is not None:
                                if v > 5:
                                    insights.append({'field': f'أداء {label}', 'value': v, 'verdict': 'قوي', 'color': 'green', 'text': f'أداء قوي آخر {label}'})
                                elif v > 0:
                                    insights.append({'field': f'أداء {label}', 'value': v, 'verdict': 'إيجابي', 'color': 'yellow', 'text': f'أداء إيجابي آخر {label}'})
                                else:
                                    insights.append({'field': f'أداء {label}', 'value': v, 'verdict': 'سلبي', 'color': 'red', 'text': f'أداء سلبي آخر {label}'})
                        fundamentals['performance'] = perf
                        fundamentals['performance_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals performance query failed: {e}")

                # technical analysis — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
                try:
                    fe_cur.execute("SELECT technical_rating, ma_rating, oscillators_rating FROM tab_technical_analysis WHERE symbol = ? LIMIT 1", (ticker,))
                    row = fe_cur.fetchone()
                    if row:
                        tr = _safe_str(row[0])
                        ma = _safe_str(row[1])
                        osc = _safe_num(row[2])
                        ta = {'overall_rating': tr, 'ma_rating': ma, 'oscillators_rating': osc}
                        insights = []
                        if tr:
                            if 'شراء' in tr and 'قوي' in tr:
                                insights.append({'field': 'التقييم الفني', 'value': tr, 'verdict': 'شراء قوي', 'color': 'green', 'text': 'إشارات فنية قوية للشراء'})
                            elif 'شراء' in tr:
                                insights.append({'field': 'التقييم الفني', 'value': tr, 'verdict': 'شراء', 'color': 'yellow', 'text': 'إشارة شراء فنية'})
                            elif 'بيع' in tr and 'قوي' in tr:
                                insights.append({'field': 'التقييم الفني', 'value': tr, 'verdict': 'بيع قوي', 'color': 'red', 'text': 'إشارات فنية قوية للبيع'})
                            elif 'بيع' in tr:
                                insights.append({'field': 'التقييم الفني', 'value': tr, 'verdict': 'بيع', 'color': 'red', 'text': 'إشارة بيع فنية'})
                            else:
                                insights.append({'field': 'التقييم الفني', 'value': tr, 'verdict': 'حيادي', 'color': 'yellow', 'text': 'السوق في حالة حيادية'})
                        fundamentals['technical_analysis'] = ta
                        fundamentals['technical_insights'] = insights
                except Exception as e:
                    logger.debug(f"[chart_routes] fundamentals technical_analysis query failed: {e}")

                fe_conn.close()
        except Exception as e:
            logger.debug(f"[chart_routes] fundamentals block failed: {e}")

        # =====================================================================
        # 11b. FUNDAMENTAL SCORE (TOOLKIT-UNIFY-013 — unify with maestro)
        # =====================================================================
        # 0-100 composite score from the fundamentals dict.
        # Returns (score, breakdown) — breakdown details per-pillar points.
        try:
            fundamental_score, fundamentals_breakdown = _compute_fundamental_score(fundamentals)
        except Exception as _fs_err:
            logger.debug(f"[chart_routes] fundamental_score failed for {ticker}: {_fs_err}")
            fundamental_score, fundamentals_breakdown = 0.0, {}

        # =====================================================================
        # 11c. MULTI-TIMEFRAME (TOOLKIT-UNIFY-013 — unify with maestro)
        # =====================================================================
        # Calls MultiTimeframeEngine (same as maestro) on the full OHLCV history.
        # Returns {day, week, month} each with {trend, rsi, score, signals}.
        multi_timeframe = {
            'day': {'trend': 'neutral', 'rsi': 50.0, 'score': 50.0, 'signals': []},
            'week': {'trend': 'neutral', 'rsi': 50.0, 'score': 50.0, 'signals': []},
            'month': {'trend': 'neutral', 'rsi': 50.0, 'score': 50.0, 'signals': []},
            'confluence_score': 50.0, 'aligned': False, 'signal': 'neutral',
        }
        try:
            from analyzers.multi_timeframe_engine import MultiTimeframeEngine
            try:
                _mtf_engine = MultiTimeframeEngine()
                _mtf_res = _mtf_engine.analyze(history)
                if _mtf_res:
                    multi_timeframe = {
                        'day': {
                            'trend': _mtf_res.daily_trend,
                            'score': round(_mtf_res.daily_score, 2),
                            'signals': _mtf_res.signals[:1] if _mtf_res.signals else [],
                        },
                        'week': {
                            'trend': _mtf_res.weekly_trend,
                            'score': round(_mtf_res.weekly_score, 2),
                            'signals': [],
                        },
                        'month': {
                            'trend': _mtf_res.monthly_trend,
                            'score': round(_mtf_res.monthly_score, 2),
                            'signals': [],
                        },
                        'confluence_score': round(_mtf_res.confluence_score, 2),
                        'aligned': bool(_mtf_res.aligned),
                        'signal': _mtf_res.signal,
                    }
            except Exception as _mtf_err:
                logger.debug(f"[chart_routes] MultiTimeframeEngine analyze failed for {ticker}: {_mtf_err}")
        except Exception as _mtf_imp:
            logger.debug(f"[chart_routes] MultiTimeframeEngine import failed: {_mtf_imp}")

        # =====================================================================
        # 11d. NEWS PHASE (TOOLKIT-UNIFY-013 — unify with maestro)
        # =====================================================================
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        # Reads market_news from news.db (via news_stop_filter, which resolves the
        # canonical news.db internally regardless of the db_path passed here).
        # Phase mapping:
        #   has_cbe_news → 'distribution' (high risk → expect selling pressure)
        #   has_news (no CBE) → 'neutral' (medium risk → wait)
        #   no news → 'accumulation' (low risk → safe to enter)
        news_phase = {
            'phase': 'accumulation', 'risk_level': 'low', 'has_news': False,
            'has_cbe_news': False, 'news_count': 0, 'reason_ar': 'لا توجد أخبار حديثة — استمر في التحليل',
        }
        try:
            from analyzers.news_stop_filter import check_news_stop_filter
            try:
                _nsf = check_news_stop_filter(ticker, DB_PATH, days_back=1)
                if _nsf:
                    if _nsf.has_cbe_news:
                        _phase = 'distribution'
                    elif _nsf.has_news:
                        _phase = 'neutral'
                    else:
                        _phase = 'accumulation'
                    news_phase = {
                        'phase': _phase,
                        'risk_level': _nsf.risk_level,
                        'has_news': bool(_nsf.has_news),
                        'has_cbe_news': bool(_nsf.has_cbe_news),
                        'news_count': int(_nsf.news_count or 0),
                        'reason_ar': _nsf.reason_ar or 'لا توجد أخبار حديثة',
                    }
            except Exception as _nsf_err:
                logger.debug(f"[chart_routes] news_stop_filter failed for {ticker}: {_nsf_err}")
        except Exception as _nsf_imp:
            logger.debug(f"[chart_routes] news_stop_filter import failed: {_nsf_imp}")

        # =====================================================================
        # 11e. PERSONA ENGINE (TOOLKIT-UNIFY-013 — unify with maestro)
        # =====================================================================
        # Calls persona_gambler.analyze_gambler + persona_investor.analyze_investor.
        # Both take (ticker, stock_dict, context_dict). We build a minimal stock
        # dict from current chart data + DB lookup, and an empty context.
        personas = {'gambler': None, 'investor': None}
        try:
            # Build minimal stock dict — fetch from stocks.db for full fields
            _stock_dict = {}
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                _conn_p = db_manager.connection(DB_PATH, writable=False).__enter__()
                _conn_p.row_factory = sqlite3.Row
                _cur_p = _conn_p.cursor()
                _cur_p.execute('SELECT * FROM stocks WHERE ticker = ? LIMIT 1', (ticker,))
                _row_p = _cur_p.fetchone()
                if _row_p:
                    _stock_dict = dict(_row_p)
                _conn_p.close()
            except Exception as _sd_err:
                logger.debug(f"[chart_routes] persona stock_dict fetch failed: {_sd_err}")

            # Fallback: ensure current_price is set from chart data
            if not _stock_dict:
                _stock_dict = {
                    'ticker': ticker, 'current_price': closes[-1],
                    'change_percent': ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) >= 2 and closes[-2] > 0 else 0,
                    'volume': volumes[-1] if volumes else 0,
                    'rsi': round(last_rsi, 2),
                    'support': levels.get('support') or 0,
                    'resistance': levels.get('resistance') or 0,
                    'sector': '',
                }
            else:
                # Ensure rsi/support/resistance reflect latest chart calc (DB may be stale)
                _stock_dict['rsi'] = round(last_rsi, 2)
                _stock_dict['support'] = levels.get('support') or _stock_dict.get('support') or 0
                _stock_dict['resistance'] = levels.get('resistance') or _stock_dict.get('resistance') or 0

            # Gambler persona (short-term)
            try:
                from analyzers.persona_gambler import analyze_gambler
                _g = analyze_gambler(ticker, _stock_dict, {})
                if _g:
                    personas['gambler'] = {
                        'signal': _g.signal, 'verdict': _g.verdict, 'score': _g.score,
                        'reason': _g.reason, 'conditions': _g.conditions or [],
                    }
            except Exception as _g_err:
                logger.debug(f"[chart_routes] persona_gambler failed for {ticker}: {_g_err}")

            # Investor persona (long-term)
            try:
                from analyzers.persona_investor import analyze_investor
                _inv = analyze_investor(ticker, _stock_dict, {})
                if _inv:
                    personas['investor'] = {
                        'signal': _inv.signal, 'verdict': _inv.verdict, 'score': _inv.score,
                        'reason': _inv.reason, 'conditions': _inv.conditions or [],
                    }
            except Exception as _inv_err:
                logger.debug(f"[chart_routes] persona_investor failed for {ticker}: {_inv_err}")
        except Exception as _pe_err:
            logger.debug(f"[chart_routes] persona engine block failed for {ticker}: {_pe_err}")

        # =====================================================================
        # 11f. FREE FLOAT (FREE-FLOAT-023)
        # =====================================================================
        # نعرض free_float_percentage و free_float_warning في الـ response
        # عشان الواجهة تقدر تورّي المستخدم مخاطر التلاعب بالسعر.
        # لو free_float_percentage IS NULL أو = 0 → لا تحذر (النظام يقرأه لكنه ساكن).
        free_float_info = {
            'percentage': None,
            'shares': None,
            'warning': None,
            'level': 'unknown',  # 'ok' | 'risky' | 'critical' | 'unknown'
        }
        try:
            _ff_pct_raw = None
            _ff_shares_raw = None
            # نفضّل _stock_dict لو اتقرأ من DB
            if _stock_dict:
                _ff_pct_raw = _stock_dict.get('free_float_percentage')
                _ff_shares_raw = _stock_dict.get('free_float_shares')
            # fallback: نقرأ مباشرة من DB لو _stock_dict مفيهوش القيمة
            if _ff_pct_raw is None:
                try:
                    # Phase 7.1: migrated to db_manager (writable=False)
                    from core.db_manager import db_manager
                    _conn_ff = db_manager.connection(DB_PATH, writable=False).__enter__()
                    _conn_ff.row_factory = sqlite3.Row
                    _cur_ff = _conn_ff.cursor()
                    _cur_ff.execute(
                        "SELECT free_float_percentage, free_float_shares "
                        "FROM stocks WHERE ticker = ? LIMIT 1",
                        (ticker,),
                    )
                    _ff_row = _cur_ff.fetchone()
                    if _ff_row:
                        _ff_pct_raw = _ff_row['free_float_percentage']
                        _ff_shares_raw = _ff_row['free_float_shares']
                    _conn_ff.close()
                except sqlite3.Error as _ff_db_err:
                    logger.debug(f"[chart_routes] free_float DB read failed for {ticker}: {_ff_db_err}")

            # تحويل آمن (NULL/0 → None)
            try:
                _ff_pct = float(_ff_pct_raw) if (_ff_pct_raw is not None and float(_ff_pct_raw) > 0) else None
            except (TypeError, ValueError):
                _ff_pct = None
            try:
                _ff_shares = int(_ff_shares_raw) if (_ff_shares_raw is not None and int(_ff_shares_raw) > 0) else None
            except (TypeError, ValueError):
                _ff_shares = None

            free_float_info['percentage'] = _ff_pct
            free_float_info['shares'] = _ff_shares

            # تطبيق منطق التحذير (متوافق مع liquidity_filter.py)
            if _ff_pct is not None:
                if _ff_pct < 5.0:
                    free_float_info['warning'] = (
                        f"🚨 أسهم حرة حرجة جداً - تجنب التداول "
                        f"(free float = {_ff_pct:.1f}% < 5%)"
                    )
                    free_float_info['level'] = 'critical'
                elif _ff_pct < 15.0:
                    free_float_info['warning'] = (
                        f"⚠️ أسهم حرة قليلة - مخاطرة عالية "
                        f"(free float = {_ff_pct:.1f}% < 15%)"
                    )
                    free_float_info['level'] = 'risky'
                else:
                    free_float_info['level'] = 'ok'
        except Exception as _ff_err:
            logger.debug(f"[chart_routes] free_float block failed for {ticker}: {_ff_err}")

        # Last EMA values for current_indicators
        last_ema9 = _last_valid(ema9_arr)
        last_ema21 = _last_valid(ema21_arr)
        if last_ema9 is None:
            last_ema9 = closes[-1]
        if last_ema21 is None:
            last_ema21 = closes[-1]

        analysis_text = _build_analysis_text(
            ticker=ticker,
            score=confluence['score'],
            signal=confluence['signal'],
            signal_color=confluence['signal_color'],
            market_regime=market_regime,
            bos_events=bos_events[-3:] if bos_events else [],
            volume_analysis={'avg_20d': round(avg_vol, 0), 'recent_5d': round(recent_vol, 0), 'ratio': round(vol_ratio, 2)},
            bb_squeeze=bb_squeeze,
            fundamentals=fundamentals,
            risk=risk,
            current_indicators={
                'rsi': round(last_rsi, 2), 'atr': round(last_atr, 4),
                'sma20': round(last_sma20, 4) if last_sma20 is not None else 0,
                'sma50': round(last_sma50, 4) if last_sma50 is not None else 0,
                'sma200': round(last_sma200, 4) if last_sma200 is not None else 0,
                # TOOLKIT-UNIFY-013: EMA9/21 added
                'ema9': round(last_ema9, 4) if last_ema9 is not None else 0,
                'ema21': round(last_ema21, 4) if last_ema21 is not None else 0,
                'cmf': round(cmf_arr[-1], 4) if cmf_arr and cmf_arr[-1] is not None else 0,
                'macd': round(last_macd, 4) if last_macd is not None else 0,
                'macd_signal': round(last_macd_signal, 4) if last_macd_signal is not None else 0,
                'macd_histogram': round(last_macd_hist, 4) if last_macd_hist is not None else 0,
                'macd_trend': macd_trend, 'macd_trend_ar': macd_trend_ar,
            },
            candlestick_patterns=candlestick_patterns,
            fibonacci_levels=fibonacci_levels,
            multi_timeframe=multi_timeframe,
            news_phase=news_phase,
            personas=personas,
            fundamental_score=fundamental_score,
        )

        # ⚡ Screener Lists tags — تصنيف السهم اليوم من قوائم TradingView المسائية
        try:
            from analyzers.master_analyzer import get_screener_tags
            screener_tags = get_screener_tags(ticker, market='مصر')
        except Exception as e:
            logger.debug(f"[chart_routes] screener_tags failed for {ticker}: {e}")
            screener_tags = {}

        # =====================================================================
        # POSITION-SIZING-024: حساب suggested_position_size_pct + position_warning
        # =====================================================================
        # لو user_id متاح في query params نستخدمه لحساب السيولة المتاحة (T+2)
        # لو غير متاح نستخدم default portfolio_value = 100000 و available_cash = 30000
        _position_sizing_info = {'suggested_position_size_pct': None,
                                  'position_warning': None,
                                  'available_cash': None}
        try:
            _ps_user_id = request.args.get('user_id', '').strip()
            _ps_entry = float(risk.get('entry') or 0)
            _ps_stop = float(risk.get('stop_loss') or 0)
            _ps_target = float(risk.get('target') or 0)

            if _ps_entry > 0 and _ps_stop > 0 and _ps_stop < _ps_entry:
                if _ps_user_id:
                    # استخدم hard_protection لحساب السيولة المتاحة (T+2)
                    try:
                        from portfolio.hard_protection import calculate_available_cash
                        _cash_info = calculate_available_cash(_ps_user_id)
                        _ps_portfolio_value = float(_cash_info.get('portfolio_value', 0)) or 100000.0
                        _ps_available_cash = float(_cash_info.get('available_cash', 0))
                    except Exception as _ps_err:
                        logger.debug(f"[chart_routes] position-sizing cash lookup failed: {_ps_err}")
                        _ps_portfolio_value = 100000.0
                        _ps_available_cash = 30000.0
                else:
                    _ps_portfolio_value = 100000.0
                    _ps_available_cash = 30000.0

                _ps_risk_amount = _ps_portfolio_value * 0.02
                _ps_risk_per_share = _ps_entry - _ps_stop
                _ps_shares = _ps_risk_amount / _ps_risk_per_share if _ps_risk_per_share > 0 else 0
                _ps_position_value = _ps_shares * _ps_entry
                _ps_pct = (_ps_position_value / _ps_portfolio_value * 100) if _ps_portfolio_value > 0 else 0

                # cap 5% per ticker
                if _ps_pct > 5.0:
                    _ps_pct = 5.0
                # cap 30% total exposure (لا نملك بيانات المراكز بدون user_id)
                if _ps_pct > 30.0:
                    _ps_pct = 30.0

                _ps_position_warning = None
                if _ps_available_cash < (_ps_portfolio_value * (_ps_pct / 100.0)):
                    _ps_position_warning = (
                        f"سيولة غير كافية - انتظر تسوية T+2 "
                        f"(مطلوب {_ps_portfolio_value * (_ps_pct / 100.0):.2f}، "
                        f"متاح {_ps_available_cash:.2f})"
                    )

                _position_sizing_info = {
                    'suggested_position_size_pct': round(_ps_pct, 2),
                    'position_warning': _ps_position_warning,
                    'available_cash': round(_ps_available_cash, 2),
                    'portfolio_value': round(_ps_portfolio_value, 2),
                    'risk_amount': round(_ps_risk_amount, 2),
                    'risk_per_share': round(_ps_risk_per_share, 4),
                    'shares': round(_ps_shares, 2),
                    'position_value': round(_ps_position_value, 2),
                }
        except Exception as _ps_e:
            logger.debug(f"[chart_routes] position-sizing block failed: {_ps_e}")

        # =====================================================================
        # 11g. HUMANIZE-034: Humanized Reason + Recommendation Message
        # =====================================================================
        # ولّد سبب بشري واقعي + رسالة التوصية الكاملة بالـ template الجديد.
        _humanized_reason = ''
        _recommendation_message = ''
        try:
            from analyzers.narrative_generator import (
                build_humanized_reason,
                build_humanized_signal_message,
            )
            _indicators_for_narrative = {
                'rsi': last_rsi,
                'macd_hist': (last_macd - last_macd_signal) if last_macd is not None and last_macd_signal is not None else 0,
                'volume_ratio': vol_ratio,
                'bb_lower': bb_lower_arr[-1] if bb_lower_arr and bb_lower_arr[-1] else None,
                'bb_upper': bb_upper_arr[-1] if bb_upper_arr and bb_upper_arr[-1] else None,
                'sma50': last_sma50,
                'sma200': last_sma200,
            }
            _pine_flags_for_narrative = {
                'is_golden_pullback': False,  # Pine Script بيتحسب في الـ Live Engine
                'is_dead_cat': False,
                'is_bullish_divergence': False,
            }
            _sr_for_narrative = {
                'support': levels.get('support'),
                'resistance': levels.get('resistance'),
                'far_support': levels.get('far_support'),
                'far_resistance': levels.get('far_resistance'),
            }
            _humanized_reason = build_humanized_reason(
                ticker=ticker,
                indicators=_indicators_for_narrative,
                pine_flags=_pine_flags_for_narrative,
                sr_levels=_sr_for_narrative,
                score=confluence.get('score', 0),
                regime=market_regime.get('regime', 'unknown'),
            )

            # رسالة التوصية الكاملة (template جديد)
            _rec_name = _stock_dict.get('name_ar') or _stock_dict.get('name') or ticker if _stock_dict else ticker
            _recommendation_message = build_humanized_signal_message(
                ticker=ticker,
                name=_rec_name,
                signal=confluence.get('signal', 'HOLD'),
                signal_ar=confluence.get('signal', ''),
                reason=_humanized_reason,
                entry=risk.get('entry', 0),
                stop_loss=risk.get('stop_loss', 0),
                target=risk.get('target', 0),
                rr_ratio=risk.get('rr_ratio', 0),
            )
        except Exception as _hr_e:
            logger.debug(f"[chart_routes] humanized reason build failed: {_hr_e}")
            _humanized_reason = confluence.get('signal', '')

        # =====================================================================
        # 11h. CHART-UX-030: STOCK NAME (fix duplicate ticker issue)
        # =====================================================================
        # The frontend was showing the ticker twice (as both ticker and name)
        # because the response didn't include a `name`/`name_ar` field.
        # We fetch it from stocks.db (preferred) or fall back to _stock_dict.
        _stock_name = ''
        _stock_name_ar = ''
        try:
            if _stock_dict and (_stock_dict.get('name') or _stock_dict.get('name_ar')):
                _stock_name = _stock_dict.get('name', '') or ''
                _stock_name_ar = _stock_dict.get('name_ar', '') or ''
            if not _stock_name and not _stock_name_ar:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                _conn_n = db_manager.connection(DB_PATH, writable=False).__enter__()
                _conn_n.row_factory = sqlite3.Row
                _cur_n = _conn_n.cursor()
                _cur_n.execute('SELECT name, name_ar FROM stocks WHERE ticker = ? LIMIT 1', (ticker,))
                _n_row = _cur_n.fetchone()
                if _n_row:
                    _stock_name = _n_row['name'] or ''
                    _stock_name_ar = _n_row['name_ar'] or ''
                _conn_n.close()
        except Exception as _n_err:
            logger.debug(f"[chart_routes] name fetch failed for {ticker}: {_n_err}")

        # =====================================================================
        # PHASE 8: QUANT ENGINE (Z-Score + VSA + TTM Squeeze)
        # =====================================================================
        _quant_metrics = {'z_score': 0.0, 'stat_anomaly': False, 'vsa_absorption': False, 'ttm_squeeze': False, 'quant_score': 0}
        try:
            from analyzers.quant_engine import QuantEngine
            if ohlcv and len(ohlcv) >= 20:
                _quant_eng = QuantEngine(ohlcv)
                if _quant_eng.ready:
                    _quant_metrics = _quant_eng.get_all_metrics()
                    _quant_metrics['quant_score'] = _quant_eng.calculate_quant_score()
                    logger.info(f"[PHASE-8] {ticker}: Z={_quant_metrics['z_score']}, "
                                f"VSA={_quant_metrics['vsa_absorption']}, Squeeze={_quant_metrics['ttm_squeeze']}")
        except Exception as _qe:
            logger.warning(f"[PHASE-8] Quant error for {ticker}: {_qe}")

        # =====================================================================
        # SMC-ENGINE-066: Smart Money Concepts (Order Blocks + FVG + Liquidity Sweep)
        # محرك الحيتان - يكشف مناطق المؤسسات و سحب السيولة
        # =====================================================================
        _smc_data = {'order_blocks': [], 'fvgs': [], 'sweeps': [], 'score': 0, 'signals': []}
        try:
            from analyzers.smc_engine import calculate_smc_score
            _smc_result = calculate_smc_score(
                ohlcv,
                current_price=closes[-1] if closes else 0,
                volume_ratio=vol_ratio,
                rsi=last_rsi if last_rsi is not None else 50,
                sma200=last_sma200 if last_sma200 is not None else 0,
            )
            _smc_data = {
                'order_blocks': [{'type': b['type'], 'top': b['top'], 'bottom': b['bottom'], 'time': b.get('time', 0)}
                                 for b in _smc_result['order_blocks'][-3:]],  # آخر 3 بس
                'fvgs': [{'type': f['type'], 'top': f['top'], 'bottom': f['bottom'], 'time': f.get('time', 0)}
                         for f in _smc_result['fvgs'][-3:]],
                'sweeps': [{'type': s['type'], 'level': s['level'], 'time': s.get('time', 0)}
                           for s in _smc_result['sweeps'][-2:]],
                'score': _smc_result['score'],
                'signals': _smc_result['signals'],
                'ready': True,
                # BRIEF-045 Pillar 4: smc_zones للـ Frontend (للرسم كمربعات)
                'smc_zones': [
                    {'type': b['type'], 'top': b['top'], 'bottom': b['bottom'], 'zone_type': 'order_block'}
                    for b in _smc_result['order_blocks'][-3:]
                ] + [
                    {'type': f['type'], 'top': f['top'], 'bottom': f['bottom'], 'zone_type': 'fvg'}
                    for f in _smc_result['fvgs'][-3:]
                ],
            }
            logger.info(f"[SMC] {ticker}: score={_smc_result['score']}, OBs={len(_smc_result['order_blocks'])}, "
                        f"FVGs={len(_smc_result['fvgs'])}, Sweeps={len(_smc_result['sweeps'])}")
        except Exception as _smc_err:
            logger.warning(f"[SMC] Error for {ticker}: {_smc_err}")
            _smc_data['ready'] = False

        # =====================================================================
        # PHASE 11: V20 ULTIMATE FUSION ENGINE (LuxAlgo + BigBeluga + SMC)
        # =====================================================================
        # المرجعية: Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §19 (Phase 11)
        #
        # بيدمج 3 محركات في score واحد (0-100):
        #   1. LuxAlgo: القنوات السعرية (basis + upper/lower bands)
        #   2. BigBeluga: الفيبوناتشي + الجيب الذهبي (0.618 - 0.786)
        #   3. SMC: الهيكل والسيولة (Order Blocks + FVG + Sweeps)
        #
        # بيحسب كمان:
        #   - fair_value (VWAP) + fair_premium (Premium/Discount %)
        #   - Risk Profile (1.5R / 3.0R): entry, sl, tp1, tp2
        # =====================================================================
        _fusion_metrics = {
            'score': 0, 'signal': 'WAIT', 'signal_ar': 'انتظار',
            'fair_value': 0, 'fair_premium': 0,
            'bigbeluga': {'trend': 0, 'in_pocket': False, 'fib_618': 0, 'fib_786': 0,
                          'basis': 0, 'upper_band': 0, 'lower_band': 0},
            'risk': {'entry': 0, 'sl': 0, 'tp1': 0, 'tp2': 0, 'risk_amount': 0,
                     'rr_ratio_tp1': 0, 'rr_ratio_tp2': 0},
            'ready': False,
        }
        try:
            from analyzers.fusion_engine import calculate_fusion_metrics
            if ohlcv and len(ohlcv) >= 20:
                # جهّز SMC data للـ Fusion Engine من الـ _smc_data اللي اتحسب فوق
                _fusion_smc_data = {
                    'broke_resist': _smc_data.get('score', 0) >= 60,
                    'sweep_low': any(s.get('type') == 'bullish_sweep' for s in _smc_data.get('sweeps', [])),
                    'active_ob_low': next(
                        (float(b.get('bottom', 0)) for b in _smc_data.get('order_blocks', [])
                         if b.get('type') == 'bullish_ob'),
                        0.0,
                    ),
                }

                # ATR fallback: استخدم last_atr لو موجود، وإلا احسبه من البيانات
                _fusion_atr = float(last_atr) if last_atr is not None and last_atr > 0 else 0.0
                if _fusion_atr <= 0 and len(highs) >= 14 and len(lows) >= 14:
                    try:
                        import statistics as _stats
                        _ranges = [h - l for h, l in zip(highs[-14:], lows[-14:])]
                        _fusion_atr = float(sum(_ranges) / len(_ranges)) if _ranges else 0.0
                    except Exception:
                        _fusion_atr = 0.0

                # trend_up: السعر فوق SMA50
                _fusion_trend_up = False
                if last_sma50 is not None and last_sma50 > 0 and closes and closes[-1] > 0:
                    _fusion_trend_up = closes[-1] > last_sma50

                _fusion_metrics = calculate_fusion_metrics(
                    ohlcv=ohlcv,
                    smc_data=_fusion_smc_data,
                    rsi=float(last_rsi) if last_rsi is not None else 50.0,
                    vol_ratio=float(vol_ratio) if vol_ratio else 1.0,
                    trend_up=_fusion_trend_up,
                    atr_val=_fusion_atr,
                    current_price=float(closes[-1]) if closes else 0.0,
                )
                logger.info(
                    f"[PHASE-11] {ticker}: V20 Fusion Score={_fusion_metrics['score']}, "
                    f"signal={_fusion_metrics['signal']}, "
                    f"fair_premium={_fusion_metrics['fair_premium']:.1f}%, "
                    f"in_pocket={_fusion_metrics['bigbeluga'].get('in_pocket')}"
                )
        except Exception as _fusion_err:
            logger.warning(f"[PHASE-11] V20 Fusion error for {ticker}: {_fusion_err}")

        # =====================================================================
        # STOCK-DNA-001 & CANDLE-PROB-001: بصمة السهم + احتمالات الشمعة
        # =====================================================================
        # P42-CANDLE-PROB: احسب احتمالات الشمعة الجاية (TradingView V26 port)
        _candle_probabilities = None
        if HAS_CANDLE_PROB:
            try:
                _candle_probabilities = calculate_candle_probabilities(history)
                if _candle_probabilities:
                    logger.info(
                        f"[CANDLE-PROB] {ticker}: up={_candle_probabilities['up_prob']}% "
                        f"dn={_candle_probabilities['dn_prob']}% "
                        f"bias={_candle_probabilities['bias']}"
                    )
            except Exception as _cp_err:
                logger.warning(f"[CANDLE-PROB] {ticker} calc error: {_cp_err}")

        # P42-STOCK-DNA: احسب بصمة السهم (نستخدم history المُحمّل بالفعل)
        _stock_dna = None
        if HAS_STOCK_DNA:
            try:
                _stock_dna = analyze_stock_dna(ticker, history=history)
                if _stock_dna:
                    logger.info(
                        f"[STOCK-DNA] {ticker}: {_stock_dna.get('personality_type', 'unknown')} "
                        f"| tags={len(_stock_dna.get('behavioral_tags', []))}"
                    )
            except Exception as _dna_err:
                logger.warning(f"[STOCK-DNA] {ticker} analyze error: {_dna_err}")

        # =====================================================================
        # V34-INSTITUTIONAL-DECISION: محرك القرار المؤسسي (LuxAlgo + BigBeluga style)
        # =====================================================================
        # بيوحّد كل المحركات (SMC + VSA + Fusion + DNA + Candle Prob + Fundamentals
        # + Sector + Market Regime) في لوحة قرار واحدة بأسلوب TradingView V34:
        #   1. Maker State  (تجميع / تصريف / هدوء)
        #   2. Flight State (طائر للأعلى / واقع للأسفل / عرضي)
        #   3. 5 Proofs     (ترند / ميكرز / بصمة / أساسي / قطاع)
        #   4. Tech Score   (0-100)
        #   5. Signal Final (شراء انفجار مؤسسي / شراء قوي / انتظر / بيع وتجنب)
        #   6. Portfolio Advice (امسك / زود / بيع / بيع جزئي) — حسب المركز المفتوح
        # =====================================================================
        _institutional_decision = None
        try:
            from analyzers.institutional_decision_engine import build_institutional_decision

            # اقرأ بيانات مركز المستخدم من query params (اختياري)
            _user_entry_price = float(request.args.get('entry_price', 0) or 0)
            _user_entry_qty = float(request.args.get('entry_qty', 0) or 0)

            # V39: حساب ROC السهم (14 يوم)
            _stock_roc = 0.0
            if len(closes) >= 15 and closes[-15] > 0:
                _stock_roc = ((closes[-1] - closes[-15]) / closes[-15]) * 100

            # V39: تغير المؤشر العام (benchmark) من market_regime
            _benchmark_change = 0.0
            if isinstance(market_regime, dict):
                _benchmark_change = float(market_regime.get('benchmark_change', 0) or 0)

            # V39: هدف البصمة المستقبلية من stock_dna
            _dna_target_price = None
            if isinstance(_stock_dna, dict):
                _dna_tp_val = _stock_dna.get('dna_target_price')
                if _dna_tp_val:
                    _dna_target_price = float(_dna_tp_val)

            # V39: إحصائيات الباكتست من predictions DB
            _backtest_stats = None
            try:
                _pred_db = str(Path(__file__).parent.parent.parent / 'db' / 'predictions.db')
                if os.path.exists(_pred_db):
                    # Phase 7.1: migrated to db_manager (writable=False)
                    from core.db_manager import db_manager
                    _bt_conn = db_manager.connection(_pred_db, writable=False).__enter__()
                    _bt_conn.row_factory = sqlite3.Row
                    _bt_cur = _bt_conn.execute(
                        "SELECT COUNT(*) as total, "
                        "SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) as wins, "
                        "AVG(CASE WHEN is_correct=1 THEN actual_return ELSE NULL END) as avg_win, "
                        "AVG(CASE WHEN is_correct=0 THEN ABS(actual_return) ELSE NULL END) as avg_loss "
                        "FROM predictions WHERE ticker=? AND outcome_date IS NOT NULL AND actual_return IS NOT NULL",
                        (ticker,)
                    )
                    _bt_row = _bt_cur.fetchone()
                    if _bt_row and _bt_row['total'] > 0:
                        _bt_total = _bt_row['total']
                        _bt_wins = _bt_row['wins'] or 0
                        _bt_avg_win = float(_bt_row['avg_win'] or 0)
                        _bt_avg_loss = float(_bt_row['avg_loss'] or 0.001)
                        _bt_win_rate = (_bt_wins / _bt_total) * 100 if _bt_total > 0 else 0
                        _bt_pf = (_bt_avg_win * _bt_wins) / (_bt_avg_loss * (_bt_total - _bt_wins)) if (_bt_total - _bt_wins) > 0 and _bt_avg_loss > 0 else (999.0 if _bt_wins > 0 else 0.0)
                        _backtest_stats = {
                            'win_rate': round(_bt_win_rate, 1),
                            'profit_factor': round(min(_bt_pf, 999.0), 2),
                            'total_trades': _bt_total,
                            'winning_trades': _bt_wins,
                            'net_return': round(_bt_avg_win * _bt_wins - _bt_avg_loss * (_bt_total - _bt_wins), 2),
                        }
                    _bt_conn.close()
            except Exception as _bt_err:
                logger.debug(f"[V39] backtest stats lookup failed for {ticker}: {_bt_err}")

            _institutional_decision = build_institutional_decision(
                ticker=ticker,
                closes=closes, highs=highs, lows=lows, opens=opens, volumes=volumes,
                rsi=float(last_rsi) if last_rsi is not None else 50.0,
                atr=float(last_atr) if last_atr is not None else 0.0,
                sma20=float(last_sma20) if last_sma20 is not None else 0.0,
                sma50=float(last_sma50) if last_sma50 is not None else 0.0,
                sma200=float(last_sma200) if last_sma200 is not None else 0.0,
                smc_data=_smc_data,
                fusion_metrics=_fusion_metrics,
                quant_metrics=_quant_metrics,
                candle_probabilities=_candle_probabilities,
                stock_dna=_stock_dna,
                fundamental_score=float(fundamental_score) if fundamental_score else 0.0,
                market_regime=market_regime or {},
                bb_squeeze=bb_squeeze or {},
                levels=levels or {},
                sector_change=0.0,  # TODO: ربط بقطاع السهم الفعلي لاحقاً
                risk_params=risk if isinstance(risk, dict) else {},
                user_entry_price=_user_entry_price,
                user_entry_qty=_user_entry_qty,
                # V39 new params
                benchmark_change=_benchmark_change,
                stock_roc=_stock_roc,
                dna_target_price=_dna_target_price,
                backtest_stats=_backtest_stats,
            )
            logger.info(
                f"[V39] {ticker}: maker={_institutional_decision.get('maker_state', {}).get('state')} | "
                f"flight={_institutional_decision.get('flight_state', {}).get('state')} | "
                f"score={_institutional_decision.get('tech_score')} | "
                f"signal={_institutional_decision.get('signal_final')} | "
                f"dyn_thresh={_institutional_decision.get('dynamic_thresh')} | "
                f"model={_institutional_decision.get('model_quality')}"
            )
        except Exception as _v39_err:
            logger.warning(f"[V39] Institutional decision error for {ticker}: {_v39_err}")
            _institutional_decision = {'ready': False, 'error': str(_v39_err)}

        response_data = {
            'success': True, 'ticker': ticker, 'timeframe': timeframe,
            # CHART-UX-030: stock name fields (fix duplicate ticker display)
            'name': _stock_name,
            'name_ar': _stock_name_ar,
            # CHART-UX-030: aggregation metadata
            'aggregated_period': _aggregated_period,
            # CHART-UX-030: user state + signal adjustment
            'user_state': user_state,
            'signal_adjusted': signal_adjusted,
            'adjustment_reason': adjustment_reason,
            'data_points': len(ohlcv), 'ohlcv': ohlcv, 'indicators': ind,
            'levels': levels, 'confluence': confluence, 'risk': risk,
            'market_regime': market_regime,
            'bos_events': bos_events[-5:] if bos_events else [],
            'bb_squeeze': bb_squeeze,
            'project_signals': project_signals,
            'volume_analysis': {'avg_20d': round(avg_vol, 0), 'recent_5d': round(recent_vol, 0), 'ratio': round(vol_ratio, 2)},
            'current_indicators': {
                'rsi': round(last_rsi, 2) if last_rsi is not None else 50,
                'atr': round(last_atr, 4) if last_atr is not None else 0,
                'sma20': round(last_sma20, 4) if last_sma20 is not None else 0,
                'sma50': round(last_sma50, 4) if last_sma50 is not None else 0,
                'sma200': round(last_sma200, 4) if last_sma200 is not None else 0,
                # TOOLKIT-UNIFY-013: EMA9/21 added for sidebar/chart display
                'ema9': round(last_ema9, 4) if last_ema9 is not None else 0,
                'ema21': round(last_ema21, 4) if last_ema21 is not None else 0,
                'bb_width': round((bb_u - bb_l) / bb_middle_arr[-1] * 100, 2)
                    if bb_u and bb_l and bb_middle_arr and bb_middle_arr[-1] and bb_middle_arr[-1] > 0 else 0,
                'cmf': round(cmf_arr[-1], 4) if cmf_arr and cmf_arr[-1] is not None else 0,
                'macd': round(last_macd, 4) if last_macd is not None else 0,
                'macd_signal': round(last_macd_signal, 4) if last_macd_signal is not None else 0,
                'macd_histogram': round(last_macd_hist, 4) if last_macd_hist is not None else 0,
                'macd_trend': macd_trend, 'macd_trend_ar': macd_trend_ar,
                'macd_color': macd_color,
            },
            'candlestick_patterns': candlestick_patterns,
            'fundamentals': fundamentals,
            # TOOLKIT-UNIFY-013: new unified fields (chart ← maestro)
            'fibonacci_levels': fibonacci_levels,
            'multi_timeframe': multi_timeframe,
            'news_phase': news_phase,
            'personas': personas,
            'fundamental_score': fundamental_score,
            'fundamentals_breakdown': fundamentals_breakdown,
            'analysis_text': analysis_text,
            'screener_tags': screener_tags,
            # FREE-FLOAT-023: عرض الأسهم الحرة + التحذير في الـ response
            'free_float': free_float_info,
            'free_float_percentage': free_float_info.get('percentage'),
            'free_float_warning': free_float_info.get('warning'),
            # POSITION-SIZING-024: optional position sizing hint + T+2 warning
            'suggested_position_size_pct': _position_sizing_info.get('suggested_position_size_pct'),
            'position_warning': _position_sizing_info.get('position_warning'),
            'available_cash': _position_sizing_info.get('available_cash'),
            # HUMANIZE-034: سبب بشري واقعي + رسالة التوصية الكاملة
            'humanized_reason': _humanized_reason,
            'recommendation_message': _recommendation_message,
            # CHART-V2-044: Advanced indicators
            # P35: use filtered ind['cmf'] (already time-aligned with ohlcv)
            'cmf_data': ind.get('cmf', []),
            'vol_z_score': vol_z_score_latest,
            'vol_z_score_arr': [{'time': ohlcv[i]['time'], 'value': None} for i in range(len(ohlcv))],
            'macd_projection': macd_projection_arr,
            'news_confirmed': news_confirmed,
            'news_title': news_title,
            'news_source': news_source,
            'smart_markers': smart_markers,
            # INTRADAY-FIX-054: Timeframe mismatch info
            'is_intraday': _is_intraday,
            'indicator_timeframe_note': 'المؤشرات محسوبة على نفس الـ timeframe (intraday)' if _is_intraday else 'المؤشرات محسوبة على الـ daily EOD',
            # SMC-ENGINE-066: Smart Money Concepts data
            'smc_data': _smc_data,
            # PHASE 8.1: EGX Tuned Recommendations (buyer vs holder)
            'recommendations': _build_egx_recommendations(
                master_score=round(master_score, 2) if 'master_score' in dir() else 50,
                signal=signal if 'signal' in dir() else 'HOLD',
                rsi=float(last_rsi) if last_rsi else 50,
                current_price=closes[-1] if closes else 0,
                stop_loss=risk_params.get('stop_loss', 0) if 'risk_params' in dir() else 0,
            ),
            # PHASE 8: Quant Engine metrics
            'quant_metrics': _quant_metrics,
            # PHASE 11: V20 Ultimate Fusion Engine (LuxAlgo + BigBeluga + SMC)
            # مع البيانات دي الواجهة بترسم:
            #   - خط VWAP (القيمة العادلة) — بنفسجي
            #   - خطوط الفيبوناتشي 0.618 و 0.786 (الجيب الذهبي) — برتقالي
            #   - تلوين منطقة الجيب الذهبي لو السعر داخلها
            'fusion_metrics': _fusion_metrics,
            # STOCK-DNA-001: بصمة السهم — ملخص سردي لسلوك السهم
            'stock_dna': _stock_dna,
            # CANDLE-PROB-001: احتمالات الشمعة الجاية (TradingView V26 port)
            'candle_probabilities': _candle_probabilities,
            # V34-INSTITUTIONAL-DECISION: محرك القرار المؤسسي الموحّد
            # (Maker State + Flight State + 5 Proofs + Tech Score + Signal Final + Portfolio Advice)
            'institutional_decision': _institutional_decision,
        }

        # INTRADAY-FIX-054: احفظ النتيجة في الـ cache (60s)
        _chart_cache[_cache_key] = {'time': datetime.now(), 'data': response_data}
        # نظّف الـ cache القديم (أكتر من 5 دقايق)
        _now = datetime.now()
        _keys_to_del = [k for k, v in _chart_cache.items() if (_now - v['time']).total_seconds() > 300]
        for k in _keys_to_del:
            del _chart_cache[k]

        return jsonify(response_data)

    except Exception as e:
        import traceback
        print(f"[chart_routes] full-analysis ERROR: {traceback.format_exc()}")
        return jsonify({
            'success': False, 'error': str(e),
            'traceback': traceback.format_exc() if os.environ.get('DEBUG') else None,
        }), 500


def _build_analysis_text(
    ticker: str,
    score: int,
    signal: str,
    signal_color: str,
    market_regime: dict,
    bos_events: list,
    volume_analysis: dict,
    bb_squeeze: dict,
    fundamentals: dict,
    risk: dict,
    current_indicators: dict,
    candlestick_patterns: list = None,
    fibonacci_levels: dict = None,
    multi_timeframe: dict = None,
    news_phase: dict = None,
    personas: dict = None,
    fundamental_score: float = None,
) -> str:
    candlestick_patterns = candlestick_patterns or []
    fibonacci_levels = fibonacci_levels or {}
    multi_timeframe = multi_timeframe or {}
    news_phase = news_phase or {}
    personas = personas or {}
    lines = []
    lines.append(f"🔍 تحليل {ticker} — {signal} ({score}%)")
    lines.append("")

    # regime + macro
    regime_ar = market_regime.get('regime_ar') or market_regime.get('regime', 'غير محدد')
    confidence = market_regime.get('confidence', 0)
    lines.append(f"الاتجاه الماكرو: {regime_ar} (ثقة {confidence}%)")

    # MACD (TOOLKIT-UNIFY-010)
    macd_val = current_indicators.get('macd')
    macd_sig = current_indicators.get('macd_signal')
    macd_trend_ar = current_indicators.get('macd_trend_ar', 'محايد')
    if macd_val is not None and macd_sig is not None:
        lines.append(f"MACD: {macd_trend_ar} (line={macd_val:.4f}, signal={macd_sig:.4f})")

    # Candlestick patterns (TOOLKIT-UNIFY-010)
    if candlestick_patterns:
        names_ar = '، '.join(p.get('name_ar', p.get('name', '')) for p in candlestick_patterns)
        sigs = [p.get('signal', 'neutral') for p in candlestick_patterns]
        if any(s == 'bullish' for s in sigs) and not any(s == 'bearish' for s in sigs):
            emoji = '🟢'
        elif any(s == 'bearish' for s in sigs) and not any(s == 'bullish' for s in sigs):
            emoji = '🔴'
        else:
            emoji = '⚠️'
        lines.append(f"أنماط الشموع: {names_ar} {emoji}")
    else:
        lines.append("أنماط الشموع: لا يوجد نمط واضح في آخر شمعة.")

    # BOS
    if bos_events:
        up = any(b.get('type') == 'bos_up' for b in bos_events)
        down = any(b.get('type') == 'bos_down' for b in bos_events)
        if up and not down:
            lines.append("بنية السوق: BOS صاعد ✅ — السعر كسر مقاومة هيكلية.")
        elif down and not up:
            lines.append("بنية السوق: BOS هابط ❌ — السعر كسر دعم هيكلي.")
        else:
            lines.append("بنية السوق: مختلطة — حذر.")
    else:
        lines.append("بنية السوق: مستقرة نسبياً.")

    # volume / CMF
    cmf = current_indicators.get('cmf', 0)
    vol_ratio = volume_analysis.get('ratio', 1)
    if cmf and cmf > 0.05:
        lines.append("السيولة: دخول مؤسسي واضح (CMF إيجابي).")
    elif cmf and cmf < -0.05:
        lines.append("السيولة: تصريف مؤسسي (CMF سلبي).")
    elif vol_ratio >= 1.3:
        lines.append(f"السيولة: حجم مرتفع ({vol_ratio}x المتوسط).")
    else:
        lines.append("السيولة: حجم عادي/منخفض.")

    # squeeze
    if bb_squeeze and bb_squeeze.get('state') == 'squeeze_on':
        lines.append("الانضغاط السعري: Bollinger داخل Keltner — انفجار قادم ⚡.")
    elif bb_squeeze and bb_squeeze.get('state') == 'squeeze_release':
        lines.append("الانفجار السعري: بدء انفجار.price action نشط.")

    # fundamentals
    val = fundamentals.get('valuation', {})
    bs = fundamentals.get('balance_sheet', {})
    prof = fundamentals.get('profitability', {})
    div = fundamentals.get('dividends', {})
    perf = fundamentals.get('performance', {})

    fundamental_verdicts = []
    if val:
        pe = val.get('pe_ratio')
        pb = val.get('pb_ratio')
        if pe is not None and pe < 8:
            fundamental_verdicts.append("P/E مغري جداً.")
        elif pe is not None and pe > 20:
            fundamental_verdicts.append("P/E مرتفع — السهم مبالغ في تقييمه.")
        if pb is not None and pb < 1:
            fundamental_verdicts.append("P/B تحت 1 — فرصة قيمة.")
    if bs:
        sr = bs.get('solvency_ratio')
        if sr is not None:
            if sr > 2:
                fundamental_verdicts.append("نسبة ملاءة ممتازة.")
            elif sr < 1:
                fundamental_verdicts.append("نسبة ملاءة ضعيفة — مخاطرة تمويلية.")
    if prof:
        roe = prof.get('roe')
        pm = prof.get('profit_margin')
        if roe is not None and roe > 15:
            fundamental_verdicts.append("ROE ممتاز.")
        if pm is not None and pm < 3:
            fundamental_verdicts.append("هامش ربح ضعيف.")
    if div:
        dy = div.get('dividend_yield')
        if dy is not None and dy > 5:
            fundamental_verdicts.append("Dividend Yield مرتفع.")
    if perf:
        p1m = perf.get('1m')
        p3m = perf.get('3m')
        if p3m is not None and p3m > 10:
            fundamental_verdicts.append("أداء 3 أشهر قوي.")
        elif p3m is not None and p3m < -10:
            fundamental_verdicts.append("أداء 3 أشهر ضعيف.")

    if fundamental_verdicts:
        lines.append("التحليل المالي: " + " | ".join(fundamental_verdicts))

    # TOOLKIT-UNIFY-013: Fundamental Score (composite 0-100)
    if fundamental_score is not None and fundamental_score > 0:
        if fundamental_score >= 75:
            lines.append(f"النتيجة الأساسية: {fundamental_score:.0f}/100 — أساسيات ممتازة 💎.")
        elif fundamental_score >= 50:
            lines.append(f"النتيجة الأساسية: {fundamental_score:.0f}/100 — أساسيات مقبولة.")
        else:
            lines.append(f"النتيجة الأساسية: {fundamental_score:.0f}/100 — أساسيات ضعيفة ⚠️.")

    # TOOLKIT-UNIFY-013: Multi-Timeframe Confluence
    mtf_day = (multi_timeframe.get('day') or {}).get('trend', 'neutral')
    mtf_week = (multi_timeframe.get('week') or {}).get('trend', 'neutral')
    mtf_month = (multi_timeframe.get('month') or {}).get('trend', 'neutral')
    mtf_aligned = multi_timeframe.get('aligned', False)
    mtf_signal = multi_timeframe.get('signal', 'neutral')
    _mtf_trend_ar = {'bullish': 'صاعد', 'bearish': 'هابط', 'neutral': 'محايد'}
    if mtf_aligned:
        lines.append(
            f"الأطر الزمنية: يومي {_mtf_trend_ar.get(mtf_day, '?')} + أسبوعي {_mtf_trend_ar.get(mtf_week, '?')} + شهري {_mtf_trend_ar.get(mtf_month, '?')} — متوافقة ({mtf_signal}) ✅."
        )
    else:
        lines.append(
            f"الأطر الزمنية: يومي {_mtf_trend_ar.get(mtf_day, '?')} + أسبوعي {_mtf_trend_ar.get(mtf_week, '?')} + شهري {_mtf_trend_ar.get(mtf_month, '?')} — غير متوافقة."
        )

    # TOOLKIT-UNIFY-013: News Phase
    n_phase = news_phase.get('phase', 'unknown')
    n_risk = news_phase.get('risk_level', 'low')
    _n_phase_ar = {'accumulation': 'تجميع', 'distribution': 'تصريف', 'neutral': 'محايد', 'unknown': 'غير محدد'}
    if n_phase == 'distribution':
        lines.append(f"الأخبار: مرحلة {_n_phase_ar.get(n_phase, '?')} — مخاطرة {n_risk} (قرار بنك مركزي أو خبر قوي) ⚠️.")
    elif n_phase == 'neutral':
        lines.append(f"الأخبار: مرحلة {_n_phase_ar.get(n_phase, '?')} — مخاطرة {n_risk} (أخبار متوسطة) 📰.")
    else:
        lines.append(f"الأخبار: مرحلة {_n_phase_ar.get(n_phase, '?')} — مخاطرة {n_risk} (لا أخبار حديثة).")

    # TOOLKIT-UNIFY-013: Persona Engine verdicts
    _persona_parts = []
    if personas.get('gambler'):
        _g = personas['gambler']
        _persona_parts.append(f"المغامر: {_g.get('verdict', '?')}")
    if personas.get('investor'):
        _inv = personas['investor']
        _persona_parts.append(f"المستثمر: {_inv.get('verdict', '?')}")
    if _persona_parts:
        lines.append("الشخصيات: " + " | ".join(_persona_parts))

    # TOOLKIT-UNIFY-013: Fibonacci Levels
    if fibonacci_levels and 'direction' in fibonacci_levels:
        _fib_dir = 'صاعد' if fibonacci_levels['direction'] == 'up' else 'هابط'
        _fib_618 = fibonacci_levels.get('61.8%')
        lines.append(f"فيبوناتشي ({_fib_dir}): 0%={fibonacci_levels.get('0.0%')}, 38.2%={fibonacci_levels.get('38.2%')}, 50%={fibonacci_levels.get('50.0%')}, 61.8%={_fib_618}.")

    # risk
    if risk:
        entry = risk.get('entry')
        target = risk.get('target')
        sl = risk.get('stop_loss')
        rr = risk.get('rr_ratio')
        if all(v is not None for v in [entry, target, sl, rr]):
            lines.append(f"الخطة الفنية: دخول ~{entry} | هدف {target} | وقف {sl} | R:R {rr}")

    # final summary by score
    lines.append("")
    if score >= 80:
        lines.append("🔥 الخلاصة: السهم في وضع فائق الأمان — ثقة عالية في الاستمرار.")
    elif score >= 65:
        lines.append("✅ الخلاصة: فرصة شراء قوية — فكر في الدخول مع إدارة مخاطر.")
    elif score >= 50:
        lines.append("📈 الخلاصة: إشارة إيجابية — راقب السهم لحد ما يتأكد.")
    elif score >= 35:
        lines.append("⏳ الخلاصة: محايل — استنى إشارة أوضح.")
    elif score >= 20:
        lines.append("⚠️ الخلاصة: إشارة سلبية — احذر من التمسك بالسهم.")
    else:
        lines.append("❌ الخلاصة: خطر — تجنب الشراء وطبق الوقف فوراً.")

    return "\n".join(lines)
