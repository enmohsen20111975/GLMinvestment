#!/usr/bin/env python3
"""
phase1a_common.py — Shared candle-driven metric loader for Phase-1a analyses.
================================================================================

WHY
---
`phase1a_retrospective.py`, `phase1a_exit_simulation.py`, and
`phase1a_bucket_compare.py` all need the SAME ground-truth per-trade metrics
computed from `price_history` candles (ATR%, volume_ratio, change_5d, change_1d,
high%). Duplicating ~200 lines of candle logic across three scripts is brittle.

This module centralizes:
  - Candle loading + slicing (two-pass, fixes the stale-cache bug from v1).
  - Per-trade metric computation (ATR14, vol-ratio, chg5d/1d, high%).
  - Clean-trade filtering (excludes INSUFFICIENT + ANOMALY |high%|>500%).
  - Batch percentile helpers (median, p40, p60, …).
  - `classify_alive()` — runs the REAL `evaluate_stock_alive` gate on enriched
    trades after `set_dynamic_thresholds`, returning (passed, rejected).

Everything is computed FROM CANDLES — no dependency on stock_adaptive_profiles /
stored_analyses / stocks.db (those were empty on production and broke v1).

Usage
-----
    from phase1a_common import load_clean_trades, classify_alive, percentile

    data = load_clean_trades(pred_db, ph_db)
    enriched = data['enriched']          # eligible trades with metrics
    anomalies = data['anomalies']        # |high%|>500% (excluded from stats)
    clean = [e for e in enriched if e not in anomalies-by-id]

    passed, rejected, dyn = classify_alive(enriched)
"""
import os
import sqlite3
import sys
from datetime import datetime, timedelta

# Add vps-service to path so we import the REAL gate the live system uses.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VPS_DIR = os.path.join(SCRIPT_DIR, '..', 'vps-service')
if VPS_DIR not in sys.path:
    sys.path.insert(0, VPS_DIR)

from core.opportunity_quality import (  # noqa: E402
    evaluate_stock_alive,
    set_dynamic_thresholds,
    get_dynamic_thresholds,
)

# DATA-QUALITY: استيراد قواعد الـ clean + ticker variants.
# - ticker_variants: بـ يحل مشكلة Eligible=0 (مطابقة الشموع فاشلة بسبب ticker
#   format mismatch بين predictions و price_history).
# - CLEAN / CLEAN_WHERE: فلتر clean-only افتراضي للقياس الصادق.
try:
    from data_quality_rules import (  # noqa: E402
        ticker_variants as _ticker_variants,
        normalize_ticker as _normalize_ticker,
        CLEAN as _CLEAN,
        MIN_ENTRY_PRICE as _MIN_ENTRY_PRICE,
        MAX_REASONABLE_RETURN as _MAX_RET,
        KNOWN_SIGNALS as _KNOWN_SIGNALS,
    )
    _DQ_AVAILABLE = True
except Exception as _dq_err:
    _DQ_AVAILABLE = False
    # fallback محلي لو data_quality_rules مش متاح
    _MIN_ENTRY_PRICE = 0.05
    _MAX_RET = 50.0
    _KNOWN_SIGNALS = ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY',
                      'SELL', 'REDUCE', 'HOLD')

    def _normalize_ticker(t):
        return (str(t or '').strip().upper())

    def _ticker_variants(ticker):
        base = _normalize_ticker(ticker)
        if not base:
            return []
        variants = [base]
        for suf in ('.CA', '.CAIRO', '_E', '-E', '.EG', '.EX'):
            if base.endswith(suf):
                variants.append(base[:-len(suf)])
        for pre in ('EGX', 'EGS'):
            if base.startswith(pre) and len(base) > len(pre):
                variants.append(base[len(pre):])
        seen = set()
        out = []
        for v in variants:
            if v and v not in seen:
                seen.add(v)
                out.append(v)
        return out

# ──────────────────────────────────────────────────────────────────────────────
# Tuning (must match phase1a_retrospective.py exactly)
# ──────────────────────────────────────────────────────────────────────────────
MIN_PRE_ENTRY_CANDLES = 20   # below this → INSUFFICIENT (ATR needs 15, vol-ratio needs 20)
ATR_PERIOD = 14              # classic Wilder ATR window
VOL_RATIO_LOOKBACK = 20      # entry-day volume vs prior 20-day mean
CHANGE_LOOKBACK = 5          # change_5d
PRE_ENTRY_CALENDAR_LOOKBACK = 90  # cal days before entry to pull candles
ANOMALY_HIGH_PCT = 500.0     # |high%| > this = stock-split / feed artifact


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def parse_date(s):
    if not s:
        return None
    s = str(s).strip()
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(s[:19] if (' ' in s or 'T' in s) else s[:10], fmt)
        except ValueError:
            continue
    try:
        return datetime.strptime(s[:10], '%Y-%m-%d')
    except Exception:
        return None


def _f(v, default=0.0):
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def percentile(values, p):
    """Linear-interpolation percentile (p in 0..100). Empty → 0."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return 0.0
    if len(vals) == 1:
        return float(vals[0])
    k = (len(vals) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(vals) - 1)
    frac = k - lo
    return float(vals[lo] + (vals[hi] - vals[lo]) * frac)


def median(values):
    vals = sorted(v for v in values if v is not None)
    n = len(vals)
    if n == 0:
        return 0.0
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2


def avg(values):
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else 0.0


def compute_atr(candles, period=ATR_PERIOD):
    """Simple ATR (SMA of True Range) over the last `period` TRs.

    Returns (atr_value, n_trs_used) or (None, 0) if insufficient.
    """
    if len(candles) < period + 1:
        return None, 0
    trs = []
    for i in range(1, len(candles)):
        h = _f(candles[i]['high_price'])
        lo = _f(candles[i]['low_price'])
        pc = _f(candles[i - 1]['close_price'])
        if h <= 0 or lo <= 0 or pc <= 0:
            continue
        tr = max(h - lo, abs(h - pc), abs(lo - pc))
        trs.append(tr)
    if len(trs) < period:
        return None, len(trs)
    atr = sum(trs[-period:]) / period
    return atr, period


def load_ticker_candles(ph, ticker, entry_date_str, outcome_date_str):
    """Load candles for [entry - lookback, outcome] sorted ascending by date.

    FIX (Eligible=0): بـ يجرب كل ticker variants (raw/upper/strip suffixes)
    عشان يطابق price_history حتى لو الـ ticker format مختلف بين الـ DBs.
    ده كان سبب Eligible=0 على الإنتاج (تيكرز موجودة بس الـ join فاشل).
    """
    entry_dt = parse_date(entry_date_str)
    if not entry_dt:
        return []
    since_str = (entry_dt - timedelta(days=PRE_ENTRY_CALENDAR_LOOKBACK)).strftime('%Y-%m-%d')
    end_str = outcome_date_str or entry_date_str

    # جرّب كل variants لحد ما نلاقي match
    for cand in _ticker_variants(ticker):
        rows = ph.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date >= ? AND date <= ?
            ORDER BY date ASC
        """, (cand, since_str, end_str)).fetchall()
        if rows:
            return [dict(r) for r in rows]
    return []


def split_pre_entry_and_window(candles, entry_date_str):
    """Split candles into (pre_entry, entry_candle, trade_window)."""
    pre = []
    entry_candle = None
    window = []
    for c in candles:
        d = str(c['date'])[:10]
        if d < entry_date_str:
            pre.append(c)
        elif d == entry_date_str:
            entry_candle = c
            window.append(c)
        else:
            window.append(c)
    return pre, entry_candle, window


def compute_trade_metrics(pre, entry_candle, window, entry_price, highest_reached,
                          lowest_reached=0.0):
    """Compute ATR%, volume_ratio, change_5d, change_1d, high%, low% from candles.

    Returns (metrics_dict, None) on success, or (None, reason_str) if data is
    insufficient for a reliable computation.
    """
    if len(pre) < MIN_PRE_ENTRY_CANDLES:
        return None, f'pre_candles={len(pre)}<{MIN_PRE_ENTRY_CANDLES}'

    ref_close = _f(entry_candle['close_price']) if entry_candle else 0
    if ref_close <= 0 and pre:
        ref_close = _f(pre[-1]['close_price'])
    denom_price = entry_price if entry_price and entry_price > 0 else ref_close
    if denom_price <= 0:
        return None, 'no_entry_price'

    atr_series = pre[-(ATR_PERIOD + 1):] if entry_candle is None else (
        pre[-(ATR_PERIOD):] + [entry_candle]
    )
    if len(atr_series) > ATR_PERIOD + 1:
        atr_series = atr_series[-(ATR_PERIOD + 1):]
    atr, n_trs = compute_atr(atr_series, ATR_PERIOD)
    if atr is None or atr <= 0:
        return None, f'atr_uncomputable(trs={n_trs})'
    atr_pct = atr / denom_price * 100

    prior_vols = [_f(c['volume']) for c in pre[-VOL_RATIO_LOOKBACK:] if _f(c['volume']) > 0]
    if len(prior_vols) < max(10, VOL_RATIO_LOOKBACK // 2):
        return None, f'prior_vols={len(prior_vols)}/{VOL_RATIO_LOOKBACK}'
    avg_vol = sum(prior_vols) / len(prior_vols)
    if avg_vol <= 0:
        return None, 'avg_vol_zero'
    entry_vol = _f(entry_candle['volume']) if entry_candle else 0
    if entry_vol <= 0 and window:
        entry_vol = _f(window[0]['volume'])
    if entry_vol <= 0:
        return None, 'no_entry_volume'
    volume_ratio = entry_vol / avg_vol

    close_entry = ref_close if ref_close > 0 else denom_price
    change_5d = 0.0
    if len(pre) >= CHANGE_LOOKBACK:
        close_5d_ago = _f(pre[-CHANGE_LOOKBACK]['close_price'])
        if close_5d_ago > 0:
            change_5d = (close_entry / close_5d_ago - 1) * 100
    change_1d = 0.0
    if pre:
        close_1d_ago = _f(pre[-1]['close_price'])
        if close_1d_ago > 0:
            change_1d = (close_entry / close_1d_ago - 1) * 100

    # high% : prefer backfilled highest_price_reached, else max(high) in window.
    high = _f(highest_reached)
    if high <= 0 and window:
        highs = [_f(c['high_price']) for c in window if _f(c['high_price']) > 0]
        if highs:
            high = max(highs)
    high_pct = ((high - entry_price) / entry_price * 100) if (high > 0 and entry_price > 0) else 0.0

    # low% : prefer backfilled lowest_price_reached, else min(low) in window.
    low = _f(lowest_reached)
    if low <= 0 and window:
        lows = [_f(c['low_price']) for c in window if _f(c['low_price']) > 0]
        if lows:
            low = min(lows)
    low_pct = ((low - entry_price) / entry_price * 100) if (low > 0 and entry_price > 0) else 0.0

    vr_capped = min(volume_ratio, 50.0)

    return {
        'atr_at_entry': round(atr, 5),
        'atr_at_entry_pct': round(atr_pct, 4),
        'volume_ratio': round(vr_capped, 4),
        'volume_ratio_raw': round(volume_ratio, 4),
        'change_5d': round(change_5d, 4),
        'change_1d': round(change_1d, 4),
        'high': round(high, 5),
        'high_pct': round(high_pct, 4),
        'low': round(low, 5),
        'low_pct': round(low_pct, 4),
        'entry_volume': int(entry_vol),
        'avg_vol_20d': int(avg_vol),
        'close_at_entry': round(close_entry, 5),
        'n_pre_candles': len(pre),
        'n_window_candles': len(window),
    }, None


# ──────────────────────────────────────────────────────────────────────────────
# High-level loader
# ──────────────────────────────────────────────────────────────────────────────

def _has_column(conn, table, column):
    """Check if a column exists in a table (graceful schema tolerance)."""
    try:
        cur = conn.execute(f"PRAGMA table_info({table})")
        for row in cur.fetchall():
            if row[1].lower() == column.lower():
                return True
    except Exception:
        pass
    return False


def load_clean_trades(pred_db, ph_db, include_buy_only=True, include_window=False):
    """Load closed EGX predictions and compute per-trade candle metrics.

    Two-pass candle loading (per-ticker full range → slice per trade) fixes the
    v1 stale-cache bug where the 2nd+ trade for a ticker reused a window that
    didn't cover its own dates.

    Args:
        pred_db: path to predictions.db
        ph_db:   path to price_history.db
        include_buy_only: if True, only load BUY signals (the alive filter gates
            BUY entries). Default True.
        include_window: if True, include the post-entry candle window in each
            enriched trade (key 'window'). Needed for day-by-day exit simulations
            (partial+trailing). Default False (saves memory for scripts that
            only need aggregate metrics).

    Returns dict:
        'enriched'     : list of trade dicts with full metrics (eligible)
                         each has: id, ticker, persona, signal, entry, target,
                         stop, actual_return, + all metrics keys.
        'insufficient' : list of {id, ticker, persona, entry, actual_return,
                                   n_pre_candles, reason}
        'anomalies'    : list of enriched trades with |high%|>ANOMALY_HIGH_PCT
        'n_total'      : total closed EGX predictions scanned
        'databases'    : {predictions, price_history}
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    pred = db_manager.connection(pred_db, writable=False).__enter__()
    pred.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    ph = db_manager.connection(ph_db, writable=False).__enter__()
    ph.row_factory = sqlite3.Row

    # Graceful: include lowest_price_reached only if the column exists.
    has_low = _has_column(pred, 'predictions', 'lowest_price_reached')
    low_col = 'lowest_price_reached' if has_low else 'NULL'

    # ── DATA-QUALITY: clean-only filter افتراضي للقياس الصادق ──
    # لو data_quality column موجود (بعد الـ purge) → فلتر بـ 'clean' بس.
    # لو لأ (DB قديم قبل الـ purge) → استخدم شروط CLEAN اليدوية.
    has_dq = _has_column(pred, 'predictions', 'data_quality')
    # signal fallback: COALESCE(signal, signal_type) — الإنتاج ممكن يخزّن في signal_type
    has_signal_type = _has_column(pred, 'predictions', 'signal_type')
    sig_col = 'COALESCE(signal, signal_type)' if has_signal_type else 'signal'

    where = "outcome_date IS NOT NULL AND market='EGX'"
    if has_dq:
        where += " AND data_quality = 'clean'"
    else:
        # fallback: شروط CLEAN اليدوية (entry>0.05, target>0, stop>0, |ret|≤50, signal معروف)
        where += (
            f" AND entry_price > {_MIN_ENTRY_PRICE}"
            f" AND target_price > 0"
            f" AND stop_loss > 0"
            f" AND ABS(actual_return) <= {_MAX_RET}"
        )

    rows = pred.execute(f"""
        SELECT id, ticker, persona, {sig_col} AS signal, entry_price, target_price, stop_loss,
               prediction_date, created_at, outcome_date, actual_return,
               highest_price_reached, atr_at_entry, {low_col} AS lowest_price_reached
        FROM predictions
        WHERE {where}
    """).fetchall()

    if include_buy_only:
        # The alive filter gates BUY entries; keep SELL/HOLD out of the analysis.
        buy_signals = ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
        rows = [r for r in rows if (str(r['signal'] or '').upper().strip() in buy_signals)]

    # Two-pass: per-ticker min-entry / max-outcome → one generous candle window.
    ticker_dates = {}
    for r in rows:
        t = r['ticker']
        ed = str(r['prediction_date'] or str(r['created_at'])[:10])[:10]
        od = str(r['outcome_date'])[:10] if r['outcome_date'] else ed
        if t not in ticker_dates:
            ticker_dates[t] = [ed, od]
        else:
            if ed < ticker_dates[t][0]:
                ticker_dates[t][0] = ed
            if od > ticker_dates[t][1]:
                ticker_dates[t][1] = od

    candle_cache = {}
    for t, (min_entry, max_outcome) in ticker_dates.items():
        candle_cache[t] = load_ticker_candles(ph, t, min_entry, max_outcome)

    enriched = []
    insufficient = []
    for r in rows:
        t = r['ticker']
        entry_date_str = str(r['prediction_date'] or str(r['created_at'])[:10])[:10]
        candles = candle_cache.get(t, [])
        pre, entry_candle, window = split_pre_entry_and_window(candles, entry_date_str)
        m, reason = compute_trade_metrics(
            pre, entry_candle, window,
            _f(r['entry_price']),
            _f(r['highest_price_reached']),
            _f(r['lowest_price_reached']),
        )
        if m is None:
            short_reason = reason.split('(')[0].split('=')[0]
            insufficient.append({
                'id': r['id'], 'ticker': t, 'persona': r['persona'],
                'entry': _f(r['entry_price']),
                'actual_return': _f(r['actual_return']),
                'n_pre_candles': len(pre),
                'reason': f'INSUFFICIENT({reason})',
                'short_reason': short_reason,
            })
            continue
        enriched.append({
            'id': r['id'], 'ticker': t, 'persona': r['persona'], 'signal': r['signal'],
            'entry': _f(r['entry_price']),
            'target': _f(r['target_price']),
            'stop': _f(r['stop_loss']),
            'actual_return': _f(r['actual_return']),
            **m,
            **({'window': window} if include_window else {}),
        })

    anomalies = [e for e in enriched if abs(e['high_pct']) > ANOMALY_HIGH_PCT]

    pred.close()
    ph.close()
    return {
        'enriched': enriched,
        'insufficient': insufficient,
        'anomalies': anomalies,
        'n_total': len(rows),
        'databases': {'predictions': pred_db, 'price_history': ph_db},
    }


def clean_trades(data):
    """Return enriched trades MINUS anomalies (the acceptance set)."""
    anomaly_ids = {e['id'] for e in data['anomalies']}
    return [e for e in data['enriched'] if e['id'] not in anomaly_ids]


def classify_alive(enriched):
    """Run the REAL evaluate_stock_alive gate on enriched trades.

    Builds batch_funds, calls set_dynamic_thresholds (percentiles over the
    batch), then evaluates each trade. Mutates each trade dict to add
    'alive', 'reason', 'metrics'.

    Returns (passed, rejected, dyn).
    """
    batch_funds = [{
        'ticker': e['ticker'],
        'avg_atr_pct': e['atr_at_entry_pct'],
        'atr_at_entry_pct': e['atr_at_entry_pct'],
        'volume_ratio': e['volume_ratio'],
        'change_5d': e['change_5d'],
        'change_1d': e['change_1d'],
        'volume': e['entry_volume'],
        'turnover_egp': e['entry_volume'] * e['close_at_entry'],
    } for e in enriched]
    set_dynamic_thresholds(batch_funds)
    dyn = get_dynamic_thresholds()

    market_chg_5d = dyn['market_change_5d']
    passed, rejected = [], []
    for e in enriched:
        fund = {
            'avg_atr_pct': e['atr_at_entry_pct'],
            'change_5d': e['change_5d'],
            'change_1d': e['change_1d'],
            'market_change_5d': market_chg_5d,
            'volume_ratio': e['volume_ratio'],
            'volume': e['entry_volume'],
            'turnover_egp': e['entry_volume'] * e['close_at_entry'],
        }
        stored = {
            'atr_at_entry_pct': e['atr_at_entry_pct'],
            'avg_atr_pct': e['atr_at_entry_pct'],
            'volume_ratio': e['volume_ratio'],
            'change_5d': e['change_5d'],
        }
        result = evaluate_stock_alive(fund, stored)
        e['alive'] = result['alive']
        e['reason'] = result['reason']
        e['metrics'] = result['metrics']
        (passed if result['alive'] else rejected).append(e)
    return passed, rejected, dyn
