#!/usr/bin/env python3
"""
PHASE-1A — Stock Alive Filter retrospective (v2, candle-driven).
=================================================================

WHY v2
------
v1 read `avg_atr_pct` from `stock_adaptive_profiles` and `volume_ratio` from
`stored_analyses`. On a production DB where those tables are empty (DNA not
built, maestro not persisted), v1 fed zeros into `evaluate_stock_alive` → the
percentiles collapsed to 0 → the floors (atr≥0.8%, vr≥1.0) rejected 100% of
trades. Useless.

v2 computes EVERY metric directly from `price_history` candles, per trade, at
the entry date. No dependency on profiles / stored_analyses / stocks.db. This
is the ground truth: "was this stock actually alive when we entered?"

Per closed EGX prediction it computes, FROM CANDLES:
  - ATR%(14) at entry   : ATR(14) on the 15 candles ending at entry_date,
                          divided by entry_price × 100.
  - volume_ratio        : entry-day volume ÷ mean(prior 20-day volume).
  - change_5d           : (close[entry] / close[entry-5] - 1) × 100.
  - change_1d           : (close[entry] / close[entry-1] - 1) × 100.
  - high%               : from highest_price_reached (if backfilled) else
                          max(high) over [entry, outcome] from candles.

Then it builds batch_funds, calls `set_dynamic_thresholds` (percentiles), and
evaluates each trade through the real `evaluate_stock_alive` gate.

Three categories:
  - PASSED       : alive=True
  - REJECTED     : alive=False
  - INSUFFICIENT : < 20 pre-entry candles (can't compute ATR/volume_ratio
                   reliably) — EXCLUDED from the acceptance test.

Acceptance (on PASSED+REJECTED only):
  avg_high_passed > avg_high_rejected   AND   0 < passed% < 100

Usage
-----
    python3 scripts/phase1a_retrospective.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db

    # --stocks-db is accepted for backward compat but no longer used by the
    # alive filter (everything is computed from candles now).
    python3 scripts/phase1a_retrospective.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --stocks-db db/stocks.db \\
        --out db/backups/phase1a_retrospective_report.json
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta

# Add vps-service to path so we import the REAL gate the live system uses.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VPS_DIR = os.path.join(SCRIPT_DIR, '..', 'vps-service')
sys.path.insert(0, VPS_DIR)

from core.opportunity_quality import (  # noqa: E402
    evaluate_stock_alive,
    set_dynamic_thresholds,
    get_dynamic_thresholds,
)

# DATA-QUALITY: clean-only filter + ticker variants (fixes Eligible=0)
try:
    from data_quality_rules import (  # noqa: E402
        ticker_variants as _ticker_variants,
        normalize_ticker as _normalize_ticker,
        MIN_ENTRY_PRICE as _MIN_ENTRY_PRICE,
        MAX_REASONABLE_RETURN as _MAX_RET,
    )
    _DQ_AVAILABLE = True
except Exception as _dq_err:
    _DQ_AVAILABLE = False
    _MIN_ENTRY_PRICE = 0.05
    _MAX_RET = 50.0

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
# Tuning
# ──────────────────────────────────────────────────────────────────────────────
MIN_PRE_ENTRY_CANDLES = 20   # below this → INSUFFICIENT (ATR needs 15, vol-ratio needs 20)
ATR_PERIOD = 14              # classic Wilder ATR window
VOL_RATIO_LOOKBACK = 20      # entry-day volume vs prior 20-day mean
CHANGE_LOOKBACK = 5          # change_5d
# How many calendar days before entry to pull candles (60 cal ≈ 40 trading days,
# comfortably more than the 20 we need).
PRE_ENTRY_CALENDAR_LOOKBACK = 90

# Acceptance threshold (median-based — قرار المالك بعد تقرير الإنتاج):
#   primary = median_high_passed > median_high_rejected  AND  gap ≥ +1.0pp
#   avg للتوضيح فقط (حساس للذيل زي DMNH +20%…+32%).
# الـ avg بيتسجل وبيتطبع بس مش بيباش الحكم.
ACCEPTANCE_MEDIAN_GAP_PP = 1.0
# Data-anomaly guard: |high%| > ده = stock-split/feed artifact (MFPC, SCTS).
ANOMALY_HIGH_PCT = 500.0


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
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


def compute_atr(candles, period=ATR_PERIOD):
    """Simple ATR (SMA of True Range) over the last `period` TRs.

    Args:
        candles: list of dicts/rows with high_price, low_price, close_price,
                 ordered ascending by date. Needs >= period+1 candles.
        period: ATR window (default 14).

    Returns:
        (atr_value, n_trs_used) or (None, 0) if insufficient.
    """
    if len(candles) < period + 1:
        return None, 0
    trs = []
    # True Range needs prev_close, so start at index 1.
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
    """
    entry_dt = parse_date(entry_date_str)
    if not entry_dt:
        return []
    since_str = (entry_dt - timedelta(days=PRE_ENTRY_CALENDAR_LOOKBACK)).strftime('%Y-%m-%d')
    end_str = outcome_date_str or entry_date_str
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
    """Split candles into (pre_entry, entry_candle, trade_window).

    pre_entry   : candles strictly before entry_date (for ATR / vol-ratio / chg)
    entry_candle: the candle ON entry_date (or None)
    trade_window: candles from entry_date onward (for high% if not backfilled)
    """
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


def compute_trade_metrics(pre, entry_candle, window, entry_price, highest_reached):
    """Compute ATR%, volume_ratio, change_5d, change_1d, high% from candles.

    Returns (metrics_dict, None) on success, or (None, reason_str) if data is
    insufficient for a reliable computation. The reason is surfaced in the
    INSUFFICIENT category so the operator knows the true cause.
    """
    if len(pre) < MIN_PRE_ENTRY_CANDLES:
        return None, f'pre_candles={len(pre)}<{MIN_PRE_ENTRY_CANDLES}'

    # Reference close at entry: entry candle's close if present, else last pre.
    ref_close = _f(entry_candle['close_price']) if entry_candle else 0
    if ref_close <= 0 and pre:
        ref_close = _f(pre[-1]['close_price'])
    denom_price = entry_price if entry_price and entry_price > 0 else ref_close
    if denom_price <= 0:
        return None, 'no_entry_price'

    # ATR(14) on the 15 candles ending at the entry candle (include entry day
    # if present, else the last 15 pre-entry candles).
    atr_series = pre[-(ATR_PERIOD + 1):] if entry_candle is None else (
        pre[-(ATR_PERIOD):] + [entry_candle]
    )
    if len(atr_series) > ATR_PERIOD + 1:
        atr_series = atr_series[-(ATR_PERIOD + 1):]
    atr, n_trs = compute_atr(atr_series, ATR_PERIOD)
    if atr is None or atr <= 0:
        return None, f'atr_uncomputable(trs={n_trs})'
    atr_pct = atr / denom_price * 100

    # Volume ratio: entry-day volume ÷ mean(prior 20-day volume).
    # Require at least 10 valid volumes out of the last 20 (tolerates a few
    # missing days without throwing the whole trade away).
    prior_vols = [_f(c['volume']) for c in pre[-VOL_RATIO_LOOKBACK:] if _f(c['volume']) > 0]
    if len(prior_vols) < max(10, VOL_RATIO_LOOKBACK // 2):
        return None, f'prior_vols={len(prior_vols)}/{VOL_RATIO_LOOKBACK}'
    avg_vol = sum(prior_vols) / len(prior_vols)
    if avg_vol <= 0:
        return None, 'avg_vol_zero'
    entry_vol = _f(entry_candle['volume']) if entry_candle else 0
    if entry_vol <= 0 and window:
        # No candle on entry day → use the first window candle as proxy.
        entry_vol = _f(window[0]['volume'])
    if entry_vol <= 0:
        return None, 'no_entry_volume'
    volume_ratio = entry_vol / avg_vol

    # change_5d / change_1d: close[entry] vs close N candles before.
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

    # Cap volume_ratio at 50.0 — matches evaluate_stock_alive's internal cap so
    # the reported avg reflects what the filter actually "saw" (a raw vr of
    # 11000 from a stock-split data bug would otherwise wreck the average).
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
        'entry_volume': int(entry_vol),
        'avg_vol_20d': int(avg_vol),
        'close_at_entry': round(close_entry, 5),
        'n_pre_candles': len(pre),
        'n_window_candles': len(window),
    }, None


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description='Phase 1a Stock Alive Filter retrospective (candle-driven)')
    p.add_argument('--pred-db', required=True, help='Path to predictions.db')
    p.add_argument('--ph-db', required=True, help='Path to price_history.db')
    p.add_argument('--stocks-db', default=None,
                   help='(Optional, unused by alive filter — kept for backward compat)')
    p.add_argument('--out', default='db/backups/phase1a_retrospective_report.json',
                   help='Output JSON report path')
    args = p.parse_args()

    print(f"=== PHASE-1A Retrospective (candle-driven v2) ===")
    print(f"  predictions:   {args.pred_db}")
    print(f"  price_history: {args.ph_db}")
    if args.stocks_db:
        print(f"  stocks:        {args.stocks_db}  (note: alive filter ignores this; computed from candles)")

    pred = sqlite3.connect(args.pred_db)
    pred.row_factory = sqlite3.Row
    ph = sqlite3.connect(args.ph_db)
    ph.row_factory = sqlite3.Row

    # 1. Load closed EGX predictions (signal BUY only — the alive filter gates BUY entries).
    #    DATA-QUALITY: clean-only filter افتراضي (data_quality='clean' لو العمود موجود،
    #    وإلا شروط CLEAN اليدوية). ده بـ يضمن إن القياس على بيانات نظيفة بس.
    _has_dq = _has_column(pred, 'predictions', 'data_quality')
    _has_st = _has_column(pred, 'predictions', 'signal_type')
    _sig_col = 'COALESCE(signal, signal_type)' if _has_st else 'signal'
    _where = "outcome_date IS NOT NULL AND market='EGX'"
    if _has_dq:
        _where += " AND data_quality = 'clean'"
    else:
        _where += (f" AND entry_price > {_MIN_ENTRY_PRICE}"
                   f" AND target_price > 0 AND stop_loss > 0"
                   f" AND ABS(actual_return) <= {_MAX_RET}")
    rows = pred.execute(f"""
        SELECT id, ticker, persona, {_sig_col} AS signal, entry_price, target_price, stop_loss,
               prediction_date, created_at, outcome_date, actual_return,
               highest_price_reached, atr_at_entry
        FROM predictions
        WHERE {_where}
    """).fetchall()
    print(f"\n  Closed EGX predictions (clean-only): {len(rows)}"
          + (f"  [data_quality column active]" if _has_dq else f"  [fallback CLEAN conditions]"))

    # 2. Compute per-trade metrics from candles.
    #    Two-pass: (a) find the min-entry / max-outcome per ticker so we load
    #    ONE generous candle window per ticker; (b) slice that window per trade.
    #    This fixes the v1 cache bug where the 2nd+ trade for a ticker reused a
    #    stale window that didn't cover its own entry/outcome dates.
    ticker_dates = {}  # ticker -> (min_entry_str, max_outcome_str)
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

    candle_cache = {}  # ticker -> [candles] covering ALL its trades
    for t, (min_entry, max_outcome) in ticker_dates.items():
        candle_cache[t] = load_ticker_candles(ph, t, min_entry, max_outcome)

    enriched = []      # trades with full metrics (eligible for PASS/REJECT)
    insufficient = []  # trades where metrics couldn't be computed reliably
    insufficient_reasons = {}  # reason -> count (for the summary)

    for r in rows:
        t = r['ticker']
        entry_date_str = str(r['prediction_date'] or str(r['created_at'])[:10])[:10]
        outcome_date_str = str(r['outcome_date'])[:10] if r['outcome_date'] else entry_date_str
        candles = candle_cache.get(t, [])

        pre, entry_candle, window = split_pre_entry_and_window(candles, entry_date_str)
        m, reason = compute_trade_metrics(pre, entry_candle, window,
                                          _f(r['entry_price']),
                                          _f(r['highest_price_reached']))
        if m is None:
            short_reason = reason.split('(')[0].split('=')[0]
            insufficient_reasons[short_reason] = insufficient_reasons.get(short_reason, 0) + 1
            insufficient.append({
                'id': r['id'], 'ticker': t, 'persona': r['persona'],
                'entry': _f(r['entry_price']),
                'actual_return': _f(r['actual_return']),
                'n_pre_candles': len(pre),
                'reason': f'INSUFFICIENT({reason})',
            })
            continue
        enriched.append({
            'id': r['id'], 'ticker': t, 'persona': r['persona'], 'signal': r['signal'],
            'entry': _f(r['entry_price']),
            'target': _f(r['target_price']),
            'stop': _f(r['stop_loss']),
            'actual_return': _f(r['actual_return']),
            **m,
        })

    print(f"  Eligible (≥{MIN_PRE_ENTRY_CANDLES} pre-entry candles): {len(enriched)}")
    print(f"  Insufficient (excluded from acceptance): {len(insufficient)}")

    if not enriched:
        print("\n  [FATAL] no eligible trades — cannot evaluate. Check price_history coverage.")
        return 2

    # 3. Build batch_funds + set dynamic thresholds (percentiles over the batch).
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
    print(f"\n  Dynamic thresholds (from candles):")
    print(f"    atr_pct_p40       = {dyn['atr_pct_p40']:.2f}")
    print(f"    volume_ratio_p60  = {dyn['volume_ratio_p60']:.2f}")
    print(f"    market_change_5d  = {dyn['market_change_5d']:+.2f}")

    # 4. Evaluate each eligible trade through the REAL gate.
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
        if result['alive']:
            passed.append(e)
        else:
            rejected.append(e)

    # 5. Statistics.
    def avg(lst, key):
        vals = [x.get(key) for x in lst if x.get(key) is not None]
        return sum(vals) / len(vals) if vals else 0.0

    def median(lst, key):
        vals = sorted(x.get(key) for x in lst if x.get(key) is not None)
        n = len(vals)
        if n == 0:
            return 0.0
        return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2

    # Data-anomaly guard: a real EGX stock does not move +500% / -90% inside a
    # single trade window. Such rows are stock-split / data-feed artifacts
    # (e.g. MFPC 0.4 → 43). They stay in the PASS/REJECT count (the filter
    # decision is valid) but are excluded from the high% stats used for the
    # acceptance test so one bad row can't manufacture a pass. (Threshold is
    # the module-level ANOMALY_HIGH_PCT.)
    anomalies = [e for e in enriched if abs(e['high_pct']) > ANOMALY_HIGH_PCT]
    anomaly_ids = {e['id'] for e in anomalies}
    passed_clean = [x for x in passed if x['id'] not in anomaly_ids]
    rejected_clean = [x for x in rejected if x['id'] not in anomaly_ids]

    n_eligible = len(enriched)
    n_total = len(rows)

    print(f"\n=== RESULTS (acceptance set = PASSED + REJECTED = {n_eligible}) ===")
    print(f"  PASSED (alive)      : {len(passed)} ({len(passed)/n_eligible*100:.1f}%)")
    print(f"  REJECTED (dead)     : {len(rejected)} ({len(rejected)/n_eligible*100:.1f}%)")
    print(f"  INSUFFICIENT (skip) : {len(insufficient)} (excluded from acceptance)")
    if anomalies:
        print(f"  DATA ANOMALIES      : {len(anomalies)} (|high%|>{ANOMALY_HIGH_PCT:.0f}% — kept in "
              f"count, excluded from high% mean)")
        for a in anomalies:
            print(f"    - {a['ticker']:8} {a['persona']:12} high%={a['high_pct']:+10.2f}% "
                  f"(entry={a['entry']:.3f} high={a['high']:.3f}) [likely stock-split / feed artifact]")
    if insufficient:
        print(f"\n  --- INSUFFICIENT reason breakdown ---")
        for reason, cnt in sorted(insufficient_reasons.items(), key=lambda kv: -kv[1]):
            print(f"    {reason:24}: {cnt}")

    print(f"\n  --- PASSED group (alive) ---")
    print(f"    avg high%         = {avg(passed_clean, 'high_pct'):+.2f}%   (median {median(passed_clean, 'high_pct'):+.2f}%)")
    print(f"    avg actual_return = {avg(passed, 'actual_return'):+.2f}%")
    print(f"    avg atr%          = {avg(passed, 'atr_at_entry_pct'):.2f}%")
    print(f"    avg volume_ratio  = {avg(passed, 'volume_ratio'):.2f}")

    print(f"\n  --- REJECTED group (dead) ---")
    print(f"    avg high%         = {avg(rejected_clean, 'high_pct'):+.2f}%   (median {median(rejected_clean, 'high_pct'):+.2f}%)")
    print(f"    avg actual_return = {avg(rejected, 'actual_return'):+.2f}%")
    print(f"    avg atr%          = {avg(rejected, 'atr_at_entry_pct'):.2f}%")
    print(f"    avg volume_ratio  = {avg(rejected, 'volume_ratio'):.2f}")

    print(f"\n  --- BY PERSONA (acceptance set, clean high%) ---")
    for persona in ['gambler', 'balanced', 'conservative']:
        p_ = [x for x in passed_clean if x['persona'] == persona]
        rj = [x for x in rejected_clean if x['persona'] == persona]
        tp = len([x for x in passed if x['persona'] == persona]) + len([x for x in rejected if x['persona'] == persona])
        if tp == 0:
            continue
        print(f"    {persona:12}: pass={len([x for x in passed if x['persona']==persona]):3d} "
              f"reject={len([x for x in rejected if x['persona']==persona]):3d} "
              f"| pass_high%={avg(p_, 'high_pct'):+6.2f}% reject_high%={avg(rj, 'high_pct'):+6.2f}%")

    print(f"\n  --- SAMPLE 10 PASSED ---")
    for x in passed[:10]:
        flag = ' [ANOMALY]' if x['id'] in anomaly_ids else ''
        print(f"    {x['ticker']:8} {x['persona']:12} atr%={x['atr_at_entry_pct']:5.2f} "
              f"vr={x['volume_ratio']:5.2f} chg5d={x['change_5d']:+6.2f} "
              f"high%={x['high_pct']:+8.2f}% ret={x['actual_return']:+6.2f}%{flag}")

    print(f"\n  --- SAMPLE 10 REJECTED ---")
    for x in rejected[:10]:
        print(f"    {x['ticker']:8} {x['persona']:12} atr%={x['atr_at_entry_pct']:5.2f} "
              f"vr={x['volume_ratio']:5.2f} chg5d={x['change_5d']:+6.2f} "
              f"high%={x['high_pct']:+6.2f}% ret={x['actual_return']:+6.2f}% {x['reason']}")

    if insufficient:
        print(f"\n  --- SAMPLE 10 INSUFFICIENT ---")
        for x in insufficient[:10]:
            print(f"    {x['ticker']:8} {x['persona']:12} pre_candles={x['n_pre_candles']:3d} "
                  f"ret={x['actual_return']:+6.2f}% {x['reason']}")

    # 6. Acceptance test — MEDIAN-based (قرار المالك بعد تقرير الإنتاج).
    #    primary: median_high_passed > median_high_rejected  AND  gap ≥ +1.0pp
    #    avg للتوضيح فقط (حساس للذيل: DMNH +20%…+32% بيخلي avg المرفوض أعلى).
    #    الـ anomalies (|high%|>500%) بتتستبعد من median/avg بس مش من العدّ.
    avg_high_p = avg(passed_clean, 'high_pct')
    avg_high_r = avg(rejected_clean, 'high_pct')
    med_high_p = median(passed_clean, 'high_pct')
    med_high_r = median(rejected_clean, 'high_pct')
    median_gap = med_high_p - med_high_r
    pass_pct = len(passed) / n_eligible * 100 if n_eligible else 0
    acc_median = med_high_p > med_high_r
    acc_gap = median_gap >= ACCEPTANCE_MEDIAN_GAP_PP
    acc_mixed = 0 < pass_pct < 100
    accepted = acc_median and acc_gap and acc_mixed
    # avg بيتطبع للتوضيح بس (مش بيباش الحكم).
    avg_ret_p = avg(passed, 'actual_return')
    avg_ret_r = avg(rejected, 'actual_return')

    print(f"\n=== ACCEPTANCE (median-based, gap ≥ +{ACCEPTANCE_MEDIAN_GAP_PP:.1f}pp; "
          f"{len(anomalies)} anomaly/anomalies excluded from high% stats) ===")
    print(f"  median_high_passed   = {med_high_p:+.2f}%")
    print(f"  median_high_rejected = {med_high_r:+.2f}%")
    print(f"  median gap (P − R)   = {median_gap:+.2f}pp   (need ≥ +{ACCEPTANCE_MEDIAN_GAP_PP:.1f}pp)")
    print(f"  pass%                = {pass_pct:.1f}%")
    print(f"  --- avg (illustration only — tail-sensitive) ---")
    print(f"  avg_high_passed      = {avg_high_p:+.2f}%")
    print(f"  avg_high_rejected    = {avg_high_r:+.2f}%")
    print(f"  avg_ret_passed       = {avg_ret_p:+.2f}%")
    print(f"  avg_ret_rejected     = {avg_ret_r:+.2f}%")
    print(f"  --- checks ---")
    print(f"  median P > R ? {'✓' if acc_median else '✗'}")
    print(f"  gap ≥ +{ACCEPTANCE_MEDIAN_GAP_PP:.1f}pp ? {'✓' if acc_gap else '✗'}")
    print(f"  0 < pass% < 100 ? {'✓' if acc_mixed else '✗'}")
    if accepted:
        print(f"\n  ✓ ACCEPTANCE PASSED (median gap {median_gap:+.2f}pp ≥ +{ACCEPTANCE_MEDIAN_GAP_PP:.1f}pp)")
    else:
        why = []
        if not acc_median:
            why.append('median P ≤ R')
        if not acc_gap:
            why.append(f'gap {median_gap:+.2f}pp < +{ACCEPTANCE_MEDIAN_GAP_PP:.1f}pp')
        if not acc_mixed:
            why.append('pass% not in (0,100)')
        print(f"\n  ✗ ACCEPTANCE FAILED — {'; '.join(why)}")

    # 7. Save JSON report.
    report = {
        'run_at': datetime.now().isoformat(),
        'version': 'v2-candle-driven',
        'databases': {
            'predictions': args.pred_db,
            'price_history': args.ph_db,
            'stocks': args.stocks_db,
        },
        'tuning': {
            'min_pre_entry_candles': MIN_PRE_ENTRY_CANDLES,
            'atr_period': ATR_PERIOD,
            'vol_ratio_lookback': VOL_RATIO_LOOKBACK,
            'change_lookback': CHANGE_LOOKBACK,
            'pre_entry_calendar_lookback': PRE_ENTRY_CALENDAR_LOOKBACK,
            'anomaly_high_pct_threshold': ANOMALY_HIGH_PCT,
        },
        'dynamic_thresholds': {k: v for k, v in dyn.items() if k != 'populated'},
        'summary': {
            'total_closed_egx': n_total,
            'eligible': n_eligible,
            'insufficient': len(insufficient),
            'insufficient_reasons': insufficient_reasons,
            'anomalies': len(anomalies),
            'passed': len(passed),
            'rejected': len(rejected),
            'pass_pct': round(pass_pct, 2),
            'avg_high_passed': round(avg_high_p, 4),
            'avg_high_rejected': round(avg_high_r, 4),
            'median_high_passed': round(med_high_p, 4),
            'median_high_rejected': round(med_high_r, 4),
            'median_gap_pp': round(median_gap, 4),
            'acceptance_median_gap_threshold': ACCEPTANCE_MEDIAN_GAP_PP,
            'avg_ret_passed': round(avg_ret_p, 4),
            'avg_ret_rejected': round(avg_ret_r, 4),
            'avg_atr_passed': round(avg(passed, 'atr_at_entry_pct'), 4),
            'avg_atr_rejected': round(avg(rejected, 'atr_at_entry_pct'), 4),
            'acceptance': accepted,
            'acceptance_criterion': 'median_high_passed > median_high_rejected AND gap >= +1.0pp AND 0<pass%<100 (avg illustration only)',
        },
        'anomalies': [{'id': a['id'], 'ticker': a['ticker'], 'persona': a['persona'],
                       'high_pct': a['high_pct'], 'entry': a['entry'], 'high': a['high']}
                      for a in anomalies],
        'by_persona': {},
        'samples': {
            'passed': [{k: v for k, v in e.items() if k != 'metrics'} for e in passed[:20]],
            'rejected': [{k: v for k, v in e.items() if k != 'metrics'} for e in rejected[:20]],
            'insufficient': insufficient[:20],
        },
    }
    for persona in ['gambler', 'balanced', 'conservative']:
        p_ = [x for x in passed_clean if x['persona'] == persona]
        rj = [x for x in rejected_clean if x['persona'] == persona]
        report['by_persona'][persona] = {
            'passed': len([x for x in passed if x['persona'] == persona]),
            'rejected': len([x for x in rejected if x['persona'] == persona]),
            'avg_high_passed': round(avg(p_, 'high_pct'), 4),
            'avg_high_rejected': round(avg(rj, 'high_pct'), 4),
        }

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n  Report saved -> {args.out}")

    pred.close()
    ph.close()
    return 0 if accepted else 1


if __name__ == '__main__':
    sys.exit(main())
