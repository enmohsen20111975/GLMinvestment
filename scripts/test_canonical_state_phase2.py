#!/usr/bin/env python3
"""
Phase 2 Validation Tests — canonical_stock_state.py + state_history_tracker.py
=============================================================================
تختبر إصلاحات المرحلة الثانية ببيانات حقيقية من price_history.db.

يغطي:
  1. MA200 fix: بيانات 50-199 يوم → DATA_INCOMPLETE (مش MA200 وهمي)
  2. Data freshness: assessment_date قديم → DATA_STALE
  3. buy_pct=None: E6 skipped, state من price/volume فقط
  4. Transition tracking: run twice → CONTINUE في المرة الثانية
  5. بيانات حقيقية من price_history.db (مش مصطنعة)

ممنوع:
  - تعديل daily_predictor.py أو entry_gate.py
  - كتابة في DB الإنتاجي
  - اعتبار HTTP 200 دليلًا على الصحة المالية
"""
import sys
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path('/home/z/my-project')
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS / 'camp'))

from canonical_stock_state import (
    assess_state, STATE_AR,
    ACCUMULATION, UPTREND, CORRECTION_HEALTHY,
    DISTRIBUTION, DOWNTREND, RECOVERY,
    STATE_UNCONFIRMED, DATA_STALE, DATA_INCOMPLETE,
    TRANSITION_CONTINUE, TRANSITION_UPGRADE, TRANSITION_DOWNGRADE, TRANSITION_NEW,
    _sma, _is_data_stale, _trading_days_between,
)

DB_PH = PROJECT_ROOT / 'db' / 'price_history.db'
DB_ST = PROJECT_ROOT / 'db' / 'stocks.db'

results_log = []

def log(name, passed, detail=''):
    status = '✅ PASS' if passed else '❌ FAIL'
    line = f'{status} | {name}'
    if detail:
        line += f' | {detail}'
    print(line)
    results_log.append((name, passed, detail))

def load_ticker_history(ticker, max_days=300, as_of_date=None):
    """Load real OHLCV from price_history.db for a ticker (oldest→newest)."""
    conn = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True, timeout=30)
    if as_of_date:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker=? AND date<=? AND close_price>0 AND high_price>0
            ORDER BY date DESC LIMIT ?
        """, (ticker, as_of_date, max_days)).fetchall()
    else:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker=? AND close_price>0 AND high_price>0
            ORDER BY date DESC LIMIT ?
        """, (ticker, max_days)).fetchall()
    conn.close()
    rows = list(reversed(rows))
    if not rows:
        return None
    d = [r[0] for r in rows]
    o = [float(r[1] or 0) for r in rows]
    h = [float(r[2] or 0) for r in rows]
    l = [float(r[3] or 0) for r in rows]
    c = [float(r[4]) for r in rows]
    v = [int(r[5] or 0) for r in rows]
    return {'dates': d, 'opens': o, 'highs': h, 'lows': l, 'closes': c, 'volumes': v}

# ═══════════════════════════════════════════════════════════════════════════
# 1. MA200 FIX (point a): بيانات قصيرة (50-199 يوم) → يستمر التصنيف
#    MA200 بس اللي يتعطل، مش التحليل كله. لازم state ≠ DATA_INCOMPLETE.
print('\n' + '='*80)
print('1. MA200 FIX (point a) — بيانات 50-199 يوم → التصنيف يستمر (مش DATA_INCOMPLETE)')
print('='*80)

test_ticker = 'COMI'
hist = load_ticker_history(test_ticker, max_days=300)
if hist and len(hist['closes']) >= 200:
    short_closes = hist['closes'][-100:]
    short_highs = hist['highs'][-100:]
    short_lows = hist['lows'][-100:]
    short_volumes = hist['volumes'][-100:]
    short_date = hist['dates'][-1]

    result = assess_state(
        ticker=test_ticker + '_SHORT',
        date=short_date,
        closes=short_closes, highs=short_highs, lows=short_lows, volumes=short_volumes,
        buy_pct=None,
        latest_price_date=short_date,
    )
    real_or_unconfirmed = [ACCUMULATION, UPTREND, CORRECTION_HEALTHY,
                           DISTRIBUTION, DOWNTREND, RECOVERY, STATE_UNCONFIRMED]
    log('MA200 fix: 100-day data → state continues (not DATA_INCOMPLETE)',
        result.state in real_or_unconfirmed,
        f'state={result.state} (expected real state, not {DATA_INCOMPLETE}), closes={len(short_closes)} '
        f'evidence_support={len(result.evidence_supporting)} evidence_oppose={len(result.evidence_opposing)}')

    all_ev = result.evidence_supporting + result.evidence_opposing
    ma200_evidence = [e for e in all_ev if 'ma200' in e.name.lower() or 'golden_cross' in e.name.lower() or 'death_cross' in e.name.lower()]
    log('MA200 fix: E2/E3 (MA200-dependent) skipped when ma200=None',
        len(ma200_evidence) == 0,
        f'ma200_evidence_count={len(ma200_evidence)} (expected 0)')
else:
    log('MA200 fix: setup', False, f'could not load >=200 days for {test_ticker}')

# ═══════════════════════════════════════════════════════════════════════════
# 1b. MA200 PRESENT: بيانات ≥ 200 يوم → E2/E3 evidence يجب أن تظهر
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('1b. MA200 PRESENT — بيانات ≥ 200 يوم → E2/E3 evidence يجب أن تظهر')
print('='*80)

if hist and len(hist['closes']) >= 200:
    full_date = hist['dates'][-1]
    result_full = assess_state(
        ticker=test_ticker,
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        latest_price_date=full_date,
    )
    real_states = [ACCUMULATION, UPTREND, CORRECTION_HEALTHY, DISTRIBUTION, DOWNTREND, RECOVERY,
                   STATE_UNCONFIRMED]
    log('MA200 present: ≥200-day data → real state',
        result_full.state in real_states and result_full.state != DATA_INCOMPLETE,
        f'state={result_full.state} conf={result_full.confidence:.2f} '
        f'closes={len(hist["closes"])} last_date={full_date} last_price={result_full.last_price:.2f}')

    all_ev_full = result_full.evidence_supporting + result_full.evidence_opposing
    ma200_ev_full = [e for e in all_ev_full if 'ma200' in e.name.lower() or 'golden_cross' in e.name.lower() or 'death_cross' in e.name.lower()]
    log('MA200 present: E2/E3 evidence generated',
        len(ma200_ev_full) >= 1,
        f'ma200_evidence_count={len(ma200_ev_full)} (expected >=1)')
else:
    log('MA200 present: setup', False, 'no ≥200-day data available')

# ═══════════════════════════════════════════════════════════════════════════
# 2. MA200 FIX: بيانات ≥ 200 يوم لازم تشتغل وتُرجع state حقيقي
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('2. MA200 FIX — بيانات ≥ 200 يوم → state حقيقي')
print('='*80)

if hist and len(hist['closes']) >= 200:
    full_date = hist['dates'][-1]
    result_full = assess_state(
        ticker=test_ticker,
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        latest_price_date=full_date,
    )
    real_states = [ACCUMULATION, UPTREND, CORRECTION_HEALTHY, DISTRIBUTION, DOWNTREND, RECOVERY,
                   STATE_UNCONFIRMED]
    log('MA200 fix: ≥200-day data → real state',
        result_full.state in real_states and result_full.state != DATA_INCOMPLETE,
        f'state={result_full.state} conf={result_full.confidence:.2f} '
        f'closes={len(hist["closes"])} last_date={full_date} last_price={result_full.last_price:.2f}')

# ═══════════════════════════════════════════════════════════════════════════
# 3. DATA FRESHNESS FIX: assessment_date قديم → DATA_STALE
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('3. DATA FRESHNESS — last_close + 10 trading days → DATA_STALE')
print('='*80)

if hist:
    last_close_date = hist['dates'][-1]
    last_dt = datetime.strptime(last_close_date, '%Y-%m-%d')
    future_assessment = (last_dt + timedelta(days=14)).strftime('%Y-%m-%d')

    result_stale = assess_state(
        ticker=test_ticker + '_STALE',
        date=future_assessment,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        latest_price_date=last_close_date,
    )
    log('Freshness: last_close + 14 calendar days → DATA_STALE',
        result_stale.state == DATA_STALE,
        f'state={result_stale.state} (expected {DATA_STALE}), '
        f'last_close={last_close_date} assessment={future_assessment}')

# ═══════════════════════════════════════════════════════════════════════════
# 4. _trading_days_between helper unit tests
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('4. _trading_days_between — اختبارات الوحدة')
print('='*80)

gap = _trading_days_between('2026-10-23', '2026-10-26')  # Fri → Mon
# EGX calendar (Sun-Thu trading): Sat skipped, Sun+Mon trading → 2 days
log('trading_days: EGX Fri→Mon = 2 (Sat non-trading, Sun+Mon trading)', gap == 2, f'got {gap}')

gap = _trading_days_between('2026-10-19', '2026-10-26')  # Mon → Mon
# EGX calendar: Tue+Wed+Thu (week) + Fri+Sat skipped + Sun+Mon = 5 days
log('trading_days: EGX Mon→Mon = 5 (Tue+Wed+Thu+Sun+Mon)', gap == 5, f'got {gap}')

gap = _trading_days_between('2026-10-26', '2026-10-26')
log('trading_days: same day = 0', gap == 0, f'got {gap}')

gap = _trading_days_between('2026-10-30', '2026-10-26')
log('trading_days: future latest = 0', gap == 0, f'got {gap}')

# New test: US market calendar (Mon-Fri trading, Sat+Sun non-trading)
gap_us = _trading_days_between('2026-10-23', '2026-10-26', market='US')  # Fri → Mon
# US calendar: Sat+Sun skipped, Mon trading → 1 day
log('trading_days: US Fri→Mon = 1 (Sat+Sun non-trading)', gap_us == 1, f'got {gap_us}')

# EGX Sun IS a trading day (key fix)
gap_egx = _trading_days_between('2026-10-22', '2026-10-25', market='EGX')  # Thu → Sun
# EGX: Fri+Sat skipped, Sun trading → 1 day (NOT 0 as old code would do)
log('trading_days: EGX Thu→Sun = 1 (Fri+Sat non-trading, Sun trading)', gap_egx == 1, f'got {gap_egx}')

# ═══════════════════════════════════════════════════════════════════════════
# 5. BUY_PCT=None FIX: E6 skipped
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('5. BUY_PCT=None — E6 skipped entirely')
print('='*80)

if hist and len(hist['closes']) >= 200:
    result_none = assess_state(
        ticker=test_ticker + '_NOBP',
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        latest_price_date=full_date,
    )
    all_evidence = result_none.evidence_supporting + result_none.evidence_opposing
    e6_evidence = [e for e in all_evidence if 'buy_pct' in e.name]
    log('buy_pct=None: no E6 evidence generated',
        len(e6_evidence) == 0,
        f'e6_evidence_count={len(e6_evidence)} total_evidence={len(all_evidence)} '
        f'state={result_none.state}')

    result_bp65 = assess_state(
        ticker=test_ticker + '_BP65',
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=65.0,
        latest_price_date=full_date,
    )
    all_evidence_65 = result_bp65.evidence_supporting + result_bp65.evidence_opposing
    e6_evidence_65 = [e for e in all_evidence_65 if 'buy_pct' in e.name]
    log('buy_pct=65: E6 evidence generated (when conditions met)',
        len(e6_evidence_65) > 0 or result_bp65.state in [DATA_INCOMPLETE, DATA_STALE],
        f'e6_evidence_count={len(e6_evidence_65)} (or state skipped: '
        f'{result_bp65.state in [DATA_INCOMPLETE, DATA_STALE]})')

# ═══════════════════════════════════════════════════════════════════════════
# 6. TRANSITION TRACKING: run twice same date+data → CONTINUE in second
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('6. TRANSITION TRACKING — تكرار نفس التاريخ → CONTINUE')
print('='*80)

if hist and len(hist['closes']) >= 200:
    r1 = assess_state(
        ticker=test_ticker + '_TRANS',
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        latest_price_date=full_date,
    )
    log('Transition: first call → NEW',
        r1.transition_type == TRANSITION_NEW,
        f'transition={r1.transition_type} state={r1.state}')

    r2 = assess_state(
        ticker=test_ticker + '_TRANS',
        date=full_date,
        closes=hist['closes'], highs=hist['highs'], lows=hist['lows'], volumes=hist['volumes'],
        buy_pct=None,
        prev_state=r1.state,
        latest_price_date=full_date,
    )
    log('Transition: second call same state → CONTINUE',
        r2.transition_type == TRANSITION_CONTINUE,
        f'transition={r2.transition_type} state={r2.state} prev={r1.state}')

# ═══════════════════════════════════════════════════════════════════════════
# 7. REAL DATA: فحص عدة tickers
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('7. REAL DATA — فحص 5 tickers من price_history.db')
print('='*80)

conn = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True, timeout=30)
real_tickers = [r[0] for r in conn.execute("""
    SELECT ticker FROM price_history
    WHERE date >= '2026-10-15' AND close_price > 0
    GROUP BY ticker
    ORDER BY MAX(date) DESC
    LIMIT 5
""").fetchall()]
conn.close()
print(f'Tickers selected: {real_tickers}')

state_counts = {}
for t in real_tickers:
    h = load_ticker_history(t, max_days=300)
    if not h or len(h['closes']) < 50:
        log(f'Real data {t}: skipped (insufficient)', False, f'closes={len(h["closes"]) if h else 0}')
        continue
    last_d = h['dates'][-1]
    r = assess_state(
        ticker=t, date=last_d,
        closes=h['closes'], highs=h['highs'], lows=h['lows'], volumes=h['volumes'],
        buy_pct=None, latest_price_date=last_d,
    )
    state_counts[r.state] = state_counts.get(r.state, 0) + 1
    log(f'Real {t}: state classified',
        r.state in real_states + [DATA_INCOMPLETE, DATA_STALE],
        f'state={r.state} conf={r.confidence:.2f} closes={len(h["closes"])} last={last_d}')

print(f'\nState distribution: {state_counts}')

# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('SUMMARY')
print('='*80)
passed = sum(1 for _, p, _ in results_log if p)
failed = sum(1 for _, p, _ in results_log if not p)
print(f'  ✅ Passed: {passed}')
print(f'  ❌ Failed: {failed}')
print(f'  Total:    {len(results_log)}')
sys.exit(0 if failed == 0 else 1)
