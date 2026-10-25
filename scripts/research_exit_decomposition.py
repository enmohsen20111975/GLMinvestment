#!/usr/bin/env python3
"""
BATCH-6 — RESEARCH ONLY: Exit Decomposition.
=============================================

Question: هل الخروج (TP/SL) يقتل الـ selection؟
            Does the exit (TP/SL) kill the selection?

We take the SAME entry (prediction_date, entry_price) for every closed
trade, and replay it through 5 different exit strategies. If the selection
is good, then any exit (including buy&hold) should produce positive
expectancy; if exit is the *only* thing producing a positive expectancy,
then the selection is weak and the exit is "rescuing" it; if NO exit
produces positive expectancy, the selection is bad.

The script is READ-ONLY w.r.t. both DBs (sqlite URI = ?mode=ro).

Channels (per morning_bell):
    - balanced    : morning_bell == 0
    - morning_bell: morning_bell == 1

Simulations
-----------
1. fixed_tp_sl (CURRENT)
   - hit_target=1 -> return = (target-entry)/entry*100
   - hit_stop  =1 -> return = (stop  -entry)/entry*100
   - HARD cap |return| <= 50

2. buy_hold_N (N = 10, 20, 30 trading days)
   - entry = close at prediction_date
   - exit  = close after N trading days
   - HARD cap

3. time_exit_N  (N = 10, 20, 30 trading days) -- identical math to buy_hold
   but reported separately because it answers a different question
   ("does a time-stop alone, ignoring TP/SL, beat fixed-TP/SL?").

4. trailing_atr2
   - ATR(14) on daily candles at entry; if < 14 pre-entry candles →
     fall back to 3% of entry as proxy.
   - trail = max_close_so_far - 2*ATR
   - exit on first close <= trail (else exit at last candle of window).

5. partial_t1_50_20
   - R = (target - entry) ; risk = (entry - stop)  [per-leg risk]
   - If price reaches 1.5R (= entry + 1.5*(target-entry)) → sell 50%.
   - Remaining 50% is held for 20 trading days (close-exit).
   - Weighted avg = 0.5*r1 + 0.5*r2  (HARD cap applied to each leg).

For each simulation × channel we compute:
    n_valid, win_rate, profit_factor, expectancy,
    avg_win, avg_loss, max_loss, max_win

Output: scripts/research_exit_decomposition.json
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta

# ──────────────────────────────────────────────────────────────────────────────
# Paths & constants
# ──────────────────────────────────────────────────────────────────────────────
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PRED_DB = os.path.join(ROOT, 'db', 'predictions.db')
PH_DB = os.path.join(ROOT, 'db', 'price_history.db')
OUT_JSON = os.path.join(ROOT, 'scripts', 'research_exit_decomposition.json')

HARD_CAP = 50.0  # ABS(return) <= 50%
ATR_PERIOD = 14
ATR_FALLBACK_PCT = 0.03  # 3 % of entry if ATR can't be computed
BUY_HOLD_DAYS = (10, 20, 30)
TIME_EXIT_DAYS = (10, 20, 30)
PARTIAL_R_MULT = 1.5
PARTIAL_HOLD_DAYS = 20
TRAIL_ATR_MULT = 2.0
DATE_FORMATS = ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%Y/%m/%d')


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def parse_date(s):
    if not s:
        return None
    s = str(s).strip()
    short = s[:10] if ' ' not in s and 'T' not in s else s[:19]
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(short, fmt)
        except ValueError:
            continue
    return None


def cap(r: float) -> float:
    """Apply HARD cap |r| <= 50."""
    if r > HARD_CAP:
        return HARD_CAP
    if r < -HARD_CAP:
        return -HARD_CAP
    return r


def is_clean_ticker(t: str) -> bool:
    """ticker must be a non-empty alpha-numeric token (no spaces, no junk)."""
    if not t:
        return False
    t = str(t).strip().upper()
    if not t:
        return False
    return all(c.isalnum() or c in ('.', '_', '-') for c in t) and len(t) <= 16


# ──────────────────────────────────────────────────────────────────────────────
# Load predictions (EXPIRED, clean, deduped by (ticker, prediction_date))
# ──────────────────────────────────────────────────────────────────────────────
def load_trades():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRED_DB, writable=False).__enter__()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, ticker, prediction_date, entry_price, target_price,
               stop_loss, hit_target, hit_stop, outcome_date, morning_bell
        FROM predictions
        WHERE status = 'EXPIRED'
        ORDER BY id
    """)
    rows = cur.fetchall()
    conn.close()

    seen = {}
    out = []
    rejected = defaultdict(int)
    for r in rows:
        _id, ticker, pdate_s, entry, target, stop, hit_t, hit_s, odate_s, mbell = r
        # quality filter
        if not is_clean_ticker(ticker):
            rejected['bad_ticker'] += 1
            continue
        if not entry or entry <= 0:
            rejected['bad_entry'] += 1
            continue
        if not target or target <= 0 or not stop or stop <= 0:
            rejected['bad_target_stop'] += 1
            continue
        pdate = parse_date(pdate_s)
        if pdate is None:
            rejected['bad_pdate'] += 1
            continue
        odate = parse_date(odate_s) if odate_s else None
        # dedup key
        key = (str(ticker).strip().upper(), pdate_s[:10])
        if key in seen:
            rejected['dup'] += 1
            continue
        seen[key] = True
        out.append({
            'id': _id,
            'ticker': str(ticker).strip().upper(),
            'prediction_date': pdate,
            'pdate_s': pdate_s[:10],
            'entry': float(entry),
            'target': float(target),
            'stop': float(stop),
            'hit_target': int(hit_t or 0),
            'hit_stop': int(hit_s or 0),
            'outcome_date': odate,
            'outcome_s': odate_s[:10] if odate_s else None,
            'morning_bell': int(mbell or 0),
        })
    return out, rejected


# ──────────────────────────────────────────────────────────────────────────────
# Candle loader (with optional pre-window for ATR)
# ──────────────────────────────────────────────────────────────────────────────
def load_candles(ticker, prediction_date, end_date, pre_window_days=40):
    """Return list of (date, o, h, l, c, v) sorted asc, covering
    [prediction_date - pre_window_days, end_date]."""
    start = prediction_date - timedelta(days=pre_window_days + 15)
    end = end_date + timedelta(days=5)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PH_DB, writable=False).__enter__()
    cur = conn.cursor()
    cur.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ?
          AND date >= ?
          AND date <= ?
        ORDER BY date ASC
    """, (ticker, start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')))
    rows = cur.fetchall()
    conn.close()
    candles = []
    for r in rows:
        try:
            d = parse_date(r[0])
            if d is None:
                continue
            candles.append({
                'date': d,
                'date_s': r[0][:10],
                'o': float(r[1]) if r[1] is not None else None,
                'h': float(r[2]) if r[2] is not None else None,
                'l': float(r[3]) if r[3] is not None else None,
                'c': float(r[4]) if r[4] is not None else None,
                'v': int(r[5]) if r[5] is not None else 0,
            })
        except (TypeError, ValueError):
            continue
    # filter to those with close_price > 0
    candles = [c for c in candles if c['c'] and c['c'] > 0]
    return candles


def compute_atr(candles, idx, period=ATR_PERIOD):
    """Wilder-style ATR at index `idx` using `period` prior candles.
    Returns ATR value (price units) or None if insufficient data."""
    if idx < period:
        return None
    trs = []
    for i in range(idx - period + 1, idx + 1):
        c = candles[i]
        prev_close = candles[i - 1]['c']
        if c['h'] is None or c['l'] is None:
            return None
        tr = max(
            c['h'] - c['l'],
            abs(c['h'] - prev_close),
            abs(c['l'] - prev_close),
        )
        trs.append(tr)
    if not trs:
        return None
    return sum(trs) / len(trs)


def entry_idx(candles, prediction_date):
    """Index of the candle that represents the entry day = first trading day
    on or after prediction_date."""
    for i, c in enumerate(candles):
        if c['date'] >= prediction_date:
            return i
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Simulations
# ──────────────────────────────────────────────────────────────────────────────
def sim_fixed_tp_sl(t):
    """Use DB flags hit_target / hit_stop directly."""
    entry, target, stop = t['entry'], t['target'], t['stop']
    if t['hit_target'] == 1:
        r = (target - entry) / entry * 100
    elif t['hit_stop'] == 1:
        r = (stop - entry) / entry * 100
    else:
        # neither hit -> assume exit at last candle close (outcome_date close)
        # We don't know exit price here without candles. The DB stores
        # outcome but not exit_price reliably; use last candle close as proxy.
        return None  # caller will fill from candles if needed
    return cap(r)


def sim_buy_hold_N(candles, eidx, N):
    """entry close @ eidx, exit close after N trading days."""
    if eidx is None or eidx >= len(candles):
        return None
    entry_close = candles[eidx]['c']
    if entry_close <= 0:
        return None
    exit_idx = eidx + N
    if exit_idx >= len(candles):
        exit_idx = len(candles) - 1
    exit_close = candles[exit_idx]['c']
    if exit_close <= 0:
        return None
    r = (exit_close - entry_close) / entry_close * 100
    return cap(r), exit_idx  # also return exit_idx for downstream


def sim_time_exit_N(candles, eidx, N):
    """Identical math to buy_hold_N; reported separately."""
    res = sim_buy_hold_N(candles, eidx, N)
    if res is None:
        return None
    return res[0]


def sim_trailing_atr2(candles, eidx):
    """Trailing stop = highest close - 2*ATR (or 3% of entry as proxy).
    Exit on first close <= trail. Else exit at last candle of window."""
    if eidx is None or eidx >= len(candles):
        return None
    entry_close = candles[eidx]['c']
    if entry_close <= 0:
        return None
    # window = candles from eidx to (eidx + 30 days) at most,
    # but bounded by data availability
    max_idx = min(len(candles) - 1, eidx + 30)
    atr = compute_atr(candles, eidx, ATR_PERIOD)
    if atr is None or atr <= 0:
        atr = entry_close * ATR_FALLBACK_PCT
    highest_close = entry_close
    trail = highest_close - TRAIL_ATR_MULT * atr
    exit_close = entry_close
    exit_idx = max_idx
    for i in range(eidx + 1, max_idx + 1):
        c_close = candles[i]['c']
        if c_close > highest_close:
            highest_close = c_close
            trail = highest_close - TRAIL_ATR_MULT * atr
        if c_close <= trail:
            exit_close = c_close
            exit_idx = i
            break
    else:
        exit_close = candles[max_idx]['c']
        exit_idx = max_idx
    r = (exit_close - entry_close) / entry_close * 100
    return cap(r)


def sim_partial_t1_50_20(candles, eidx, t):
    """50% exits at 1.5R (R = target-entry); remainder Buy&Hold 20d.
    If 1.5R never reached, the whole position rides to 20d."""
    if eidx is None or eidx >= len(candles):
        return None
    entry_close = candles[eidx]['c']
    if entry_close <= 0:
        return None
    entry = t['entry']
    target = t['target']
    R = target - entry
    if R <= 0:
        # nonsensical target → fall back to Buy&Hold 20
        bh = sim_buy_hold_N(candles, eidx, PARTIAL_HOLD_DAYS)
        if bh is None:
            return None
        return bh[0]
    target_15R_price = entry + PARTIAL_R_MULT * R  # 1.5 * R above entry
    max_idx = min(len(candles) - 1, eidx + 30)

    # First leg: find first close >= target_15R_price
    t1_idx = None
    for i in range(eidx + 1, max_idx + 1):
        if candles[i]['c'] >= target_15R_price:
            t1_idx = i
            break
    if t1_idx is None:
        # never hit 1.5R → entire position exits at 20d
        bh = sim_buy_hold_N(candles, eidx, PARTIAL_HOLD_DAYS)
        if bh is None:
            return None
        return bh[0]
    r1 = (target_15R_price - entry_close) / entry_close * 100
    r1 = cap(r1)

    # second leg: 20 trading days from eidx (absolute, NOT from t1_idx)
    exit_idx = eidx + PARTIAL_HOLD_DAYS
    if exit_idx >= len(candles):
        exit_idx = len(candles) - 1
    exit_close = candles[exit_idx]['c']
    r2 = (exit_close - entry_close) / entry_close * 100
    r2 = cap(r2)

    return 0.5 * r1 + 0.5 * r2


# ──────────────────────────────────────────────────────────────────────────────
# Stats aggregator
# ──────────────────────────────────────────────────────────────────────────────
def stats(returns):
    """Compute n_valid, win_rate, profit_factor, expectancy,
    avg_win, avg_loss, max_loss, max_win."""
    valid = [r for r in returns if r is not None]
    n = len(valid)
    if n == 0:
        return {
            'n_valid': 0, 'win_rate': None, 'profit_factor': None,
            'expectancy': None, 'avg_win': None, 'avg_loss': None,
            'max_loss': None, 'max_win': None,
        }
    wins = [r for r in valid if r > 0]
    losses = [r for r in valid if r < 0]
    flat = [r for r in valid if r == 0]
    n_win = len(wins)
    n_loss = len(losses)
    n_flat = len(flat)
    gross_win = sum(wins) if wins else 0.0
    gross_loss = -sum(losses) if losses else 0.0
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0.0)
    win_rate = n_win / n * 100 if n else 0.0
    expectancy = sum(valid) / n if n else 0.0
    avg_win = (sum(wins) / n_win) if n_win else 0.0
    avg_loss = (sum(losses) / n_loss) if n_loss else 0.0
    max_win = max(valid) if valid else 0.0
    max_loss = min(valid) if valid else 0.0
    return {
        'n_valid': n,
        'n_win': n_win,
        'n_loss': n_loss,
        'n_flat': n_flat,
        'win_rate': round(win_rate, 4),
        'profit_factor': round(pf, 4) if pf != float('inf') else 'inf',
        'expectancy': round(expectancy, 4),
        'avg_win': round(avg_win, 4),
        'avg_loss': round(avg_loss, 4),
        'max_loss': round(max_loss, 4),
        'max_win': round(max_win, 4),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
def main():
    trades, rejected = load_trades()
    print(f'[LOAD] EXPIRED trades after quality+dedup: {len(trades)}')
    print(f'[LOAD] rejected: {dict(rejected)}')
    n_bal = sum(1 for t in trades if t['morning_bell'] == 0)
    n_mb = sum(1 for t in trades if t['morning_bell'] == 1)
    print(f'[LOAD] morning_bell dist: balanced={n_bal}, morning_bell={n_mb}')

    # Pre-build per-trade candle window
    enriched = []
    skip_no_candles = 0
    skip_no_entry_idx = 0
    for t in trades:
        end = t['outcome_date'] or (t['prediction_date'] + timedelta(days=45))
        # ensure end is at least prediction_date + 35 days so we always have
        # enough data for the 30-day sims even if outcome_date was super early
        end_for_window = max(end, t['prediction_date'] + timedelta(days=45))
        candles = load_candles(t['ticker'], t['prediction_date'], end_for_window,
                                pre_window_days=45)
        if not candles:
            skip_no_candles += 1
            continue
        eidx = entry_idx(candles, t['prediction_date'])
        if eidx is None or eidx >= len(candles):
            skip_no_entry_idx += 1
            continue
        t['_candles'] = candles
        t['_eidx'] = eidx
        enriched.append(t)

    print(f'[ENRICH] trades with candles+entry_idx: {len(enriched)}  '
          f'(skip_no_candles={skip_no_candles}, skip_no_entry_idx={skip_no_entry_idx})')

    # Bucket per channel
    channels = {
        'balanced':     [t for t in enriched if t['morning_bell'] == 0],
        'morning_bell': [t for t in enriched if t['morning_bell'] == 1],
        'all':          enriched,
    }

    results = {
        'meta': {
            'script': 'research_exit_decomposition',
            'purpose': 'RESEARCH ONLY — does TP/SL exit kill selection?',
            'pred_db_md5_note': 'See header — provided hash did not match raw file MD5s; '
                                'we used live db/predictions.db (READ-ONLY).',
            'hard_cap_pct': HARD_CAP,
            'atr_period': ATR_PERIOD,
            'atr_fallback_pct': ATR_FALLBACK_PCT,
            'buy_hold_days': list(BUY_HOLD_DAYS),
            'time_exit_days': list(TIME_EXIT_DAYS),
            'partial_r_mult': PARTIAL_R_MULT,
            'partial_hold_days': PARTIAL_HOLD_DAYS,
            'trail_atr_mult': TRAIL_ATR_MULT,
            'n_expired_after_quality': len(trades),
            'n_with_candles': len(enriched),
            'rejected': dict(rejected),
            'skip_no_candles': skip_no_candles,
            'skip_no_entry_idx': skip_no_entry_idx,
            'channels': {ch: len(ts) for ch, ts in channels.items()},
        },
        'results': {},
    }

    sim_keys = (
        ['fixed_tp_sl']
        + [f'buy_hold_{n}' for n in BUY_HOLD_DAYS]
        + [f'time_exit_{n}' for n in TIME_EXIT_DAYS]
        + ['trailing_atr2']
        + ['partial_t1_50_20']
    )

    for ch, ts in channels.items():
        results['results'][ch] = {}
        for sk in sim_keys:
            returns = []
            for t in ts:
                if sk == 'fixed_tp_sl':
                    # use DB flags if either hit; else use last close in window
                    r = sim_fixed_tp_sl(t)
                    if r is None:
                        # neither TP nor SL hit → fall back to close at last
                        # candle of outcome window (or +30 d)
                        candles = t['_candles']
                        eidx = t['_eidx']
                        end_idx = len(candles) - 1
                        entry_close = candles[eidx]['c']
                        exit_close = candles[end_idx]['c']
                        if entry_close > 0:
                            r = cap((exit_close - entry_close) / entry_close * 100)
                elif sk.startswith('buy_hold_'):
                    n = int(sk.split('_')[-1])
                    res = sim_buy_hold_N(t['_candles'], t['_eidx'], n)
                    r = res[0] if res else None
                elif sk.startswith('time_exit_'):
                    n = int(sk.split('_')[-1])
                    r = sim_time_exit_N(t['_candles'], t['_eidx'], n)
                elif sk == 'trailing_atr2':
                    r = sim_trailing_atr2(t['_candles'], t['_eidx'])
                elif sk == 'partial_t1_50_20':
                    r = sim_partial_t1_50_20(t['_candles'], t['_eidx'], t)
                else:
                    r = None
                returns.append(r)
            results['results'][ch][sk] = stats(returns)

    # Write JSON
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f'[OUT] wrote {OUT_JSON}')

    # Pretty print summary table
    print('\n========== EXIT DECOMPOSITION SUMMARY ==========')
    header = (f"{'channel':<13}{'sim':<22}{'n':>5}{'WR%':>8}"
              f"{'PF':>10}{'Exp':>9}{'avgW':>9}{'avgL':>9}"
              f"{'maxL':>9}{'maxW':>9}")
    print(header)
    print('-' * len(header))
    for ch in ('balanced', 'morning_bell', 'all'):
        for sk in sim_keys:
            s = results['results'][ch][sk]
            pf = s['profit_factor']
            pf_s = 'inf' if pf == 'inf' else f'{pf:.2f}'
            print(f"{ch:<13}{sk:<22}{s['n_valid']:>5}"
                  f"{('' if s['win_rate'] is None else round(s['win_rate'],1)):>8}"
                  f"{pf_s:>10}"
                  f"{('' if s['expectancy'] is None else round(s['expectancy'],2)):>9}"
                  f"{('' if s['avg_win'] is None else round(s['avg_win'],2)):>9}"
                  f"{('' if s['avg_loss'] is None else round(s['avg_loss'],2)):>9}"
                  f"{('' if s['max_loss'] is None else round(s['max_loss'],2)):>9}"
                  f"{('' if s['max_win'] is None else round(s['max_win'],2)):>9}")
        print('-' * len(header))


if __name__ == '__main__':
    main()
