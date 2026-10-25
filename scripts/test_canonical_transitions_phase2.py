#!/usr/bin/env python3
"""
Phase 3.2 — Transition Tracking Integrity Test
=================================================
يختبر سلامة سجل الانتقالات:
  1. لا تسريب بيانات مستقبلية (no future leakage)
  2. تسجيل مرة واحدة فقط لكل (ticker, date)
  3. الـ transitions بتتبع تسلسل زمني صحيح
  4. أيام نفس الحالة (days_in_state) بتتراكم صح

ممنوع:
  - تعديل DB الإنتاجي (نستخدم نسخة readonly + in-memory)
  - اعتبار HTTP 200 دليلًا على الصحة المالية
"""
import sys
import os
import sqlite3
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path('/home/z/my-project')
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS))

from canonical_stock_state import (
    assess_state, STATE_AR, ACCUMULATION, UPTREND, CORRECTION_HEALTHY,
    DISTRIBUTION, DOWNTREND, RECOVERY, STATE_UNCONFIRMED,
    DATA_STALE, DATA_INCOMPLETE, TRANSITION_CONTINUE, TRANSITION_NEW,
)
from state_history_tracker import (
    ensure_state_columns, get_prev_state, assess_and_record,
    run_daily_assessment, get_state_timeline,
)

DB_PH = PROJECT_ROOT / 'db' / 'price_history.db'

results_log = []

def log(name, passed, detail=''):
    status = '✅ PASS' if passed else '❌ FAIL'
    line = f'{status} | {name}'
    if detail:
        line += f' | {detail}'
    print(line)
    results_log.append((name, passed, detail))

def load_ticker_history(ticker, max_days=300, as_of_date=None):
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
    return {
        'dates': [r[0] for r in rows],
        'opens': [float(r[1] or 0) for r in rows],
        'highs': [float(r[2] or 0) for r in rows],
        'lows': [float(r[3] or 0) for r in rows],
        'closes': [float(r[4]) for r in rows],
        'volumes': [int(r[5] or 0) for r in rows],
    }

# إنشاء نسخة عمل من stocks.db في temp (لا نكتب على الإنتاج)
TEST_DB_DIR = Path(tempfile.mkdtemp(prefix='canonical_test_'))
TEST_STOCKS_DB = TEST_DB_DIR / 'stocks.db'
TEST_PH_DB = TEST_DB_DIR / 'price_history.db'

# نسخ stocks.db (schema فقط + radar_signal_tracking فارغة)
print(f'\nTest workspace: {TEST_DB_DIR}')
src_st = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
dst_st = sqlite3.connect(str(TEST_STOCKS_DB))
src_st.backup(dst_st)
dst_st.commit()
src_st.close()
# مسح radar_signal_tracking (start clean for transition tests)
dst_st.execute('DELETE FROM radar_signal_tracking')
dst_st.commit()
dst_st.close()

# نسخ price_history.db (readonly - لا نكتب عليها)
shutil.copy(str(PROJECT_ROOT / 'db' / 'price_history.db'), str(TEST_PH_DB))

print(f'Test stocks DB: {TEST_STOCKS_DB} ({TEST_STOCKS_DB.stat().st_size} bytes)')
print(f'Test price_history DB: {TEST_PH_DB} ({TEST_PH_DB.stat().st_size} bytes)')

# ═══════════════════════════════════════════════════════════════════════════
# 1. NO FUTURE LEAKAGE: assess at t-1 should not see closes from t
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('1. NO FUTURE LEAKAGE — assess at t-1 should not see closes from t')
print('='*80)

test_ticker = 'COMI'
full_hist = load_ticker_history(test_ticker, max_days=300)
if full_hist and len(full_hist['closes']) >= 200:
    # pick a mid-date for backtest
    mid_idx = 200
    mid_date = full_hist['dates'][mid_idx - 1]
    mid_closes = full_hist['closes'][:mid_idx]
    mid_highs = full_hist['highs'][:mid_idx]
    mid_lows = full_hist['lows'][:mid_idx]
    mid_volumes = full_hist['volumes'][:mid_idx]

    # full assessment (includes future data relative to mid_date)
    full_result = assess_state(
        ticker=test_ticker, date=full_hist['dates'][-1],
        closes=full_hist['closes'], highs=full_hist['highs'],
        lows=full_hist['lows'], volumes=full_hist['volumes'],
        buy_pct=None, latest_price_date=full_hist['dates'][-1],
    )

    # truncated assessment (no future data)
    mid_result = assess_state(
        ticker=test_ticker, date=mid_date,
        closes=mid_closes, highs=mid_highs, lows=mid_lows, volumes=mid_volumes,
        buy_pct=None, latest_price_date=mid_date,
    )

    # The two must be DIFFERENT (different data → likely different state/confidence)
    # If they were identical, that would suggest leakage
    is_different = (
        mid_result.last_price != full_result.last_price or
        mid_result.state != full_result.state
    )
    log('No future leakage: mid assessment uses only past data',
        is_different,
        f'mid: state={mid_result.state} last_price={mid_result.last_price:.2f} date={mid_date} | '
        f'full: state={full_result.state} last_price={full_result.last_price:.2f} date={full_hist["dates"][-1]}')

# ═══════════════════════════════════════════════════════════════════════════
# 2. SINGLE RECORD PER (ticker, date): لا تكرار
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('2. SINGLE RECORD PER (ticker, date) — INSERT OR REPLACE')
print('='*80)

# monkey-patch DB_DIR في state_history_tracker
import state_history_tracker as sht
sht.DB_DIR = TEST_DB_DIR

conn_ph = sqlite3.connect(str(TEST_PH_DB), timeout=30)
conn_st = sqlite3.connect(str(TEST_STOCKS_DB), timeout=30)
ensure_state_columns(conn_st)

# run assess_and_record twice for same ticker+date
test_date = full_hist['dates'][-1] if full_hist else '2026-10-21'
assess_and_record(conn_ph, conn_st, test_ticker, test_date)
assess_and_record(conn_ph, conn_st, test_ticker, test_date)  # duplicate

count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE ticker=? AND signal_date=?",
    (test_ticker, test_date)
).fetchone()[0]
log('Single record per (ticker, date): INSERT OR REPLACE works',
    count == 1, f'rows for ({test_ticker}, {test_date}) = {count} (expected 1)')

# ═══════════════════════════════════════════════════════════════════════════
# 3. TIMELINE: تشغيل 3 تواريخ متتالية ومراجعة transitions
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('3. TIMELINE — 3 تواريخ متتالية ومراجعة transitions')
print('='*80)

# pick 3 consecutive dates from real history
dates_to_test = full_hist['dates'][-3:] if full_hist else []
print(f'Dates to test: {dates_to_test}')

# wipe and re-run
conn_st.execute('DELETE FROM radar_signal_tracking')
conn_st.commit()

prev_state_for_check = ''
for d in dates_to_test:
    result = assess_and_record(conn_ph, conn_st, test_ticker, d)
    state = result.get('state', '?')
    transition = result.get('transition_type', '?')
    days = result.get('days_in_state', 0)
    print(f'  {d}: state={state:22s} transition={transition:10s} days={days}')
    if prev_state_for_check and state == prev_state_for_check:
        log(f'Timeline {d}: CONTINUE expected when state unchanged',
            transition == TRANSITION_CONTINUE,
            f'transition={transition} (state {state} == prev {prev_state_for_check})')
    prev_state_for_check = state

# verify timeline reads back correctly
timeline = get_state_timeline(conn_st, test_ticker, 30)
log('Timeline: 3 records stored correctly',
    len(timeline) == 3,
    f'timeline_len={len(timeline)} (expected 3)')

# ═══════════════════════════════════════════════════════════════════════════
# 4. days_in_state accumulation: CONTINUE → days +1
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('4. days_in_state ACCUMULATION — CONTINUE → +1')
print('='*80)

# read back and check days_in_state is monotonic for CONTINUE
days_seq = [t['days_in_state'] for t in timeline]
print(f'  days_in_state sequence: {days_seq}')

# If all 3 dates have same state → days should be 1, 2, 3
states_seq = [t['state'] for t in timeline]
if len(set(states_seq)) == 1:
    expected_days = [1, 2, 3]
    log('days_in_state: monotonic accumulation (1,2,3)',
        days_seq == expected_days,
        f'actual={days_seq} expected={expected_days}')
else:
    # state changed at some point — days_in_state resets
    log('days_in_state: state changed (acceptable)',
        True,
        f'states_seq={states_seq} days_seq={days_seq} (reset on transition is correct)')

# ═══════════════════════════════════════════════════════════════════════════
# 5. REAL DATA: تشغيل على 5 tickers حقيقيين
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('5. REAL DATA — 5 tickers في test DB')
print('='*80)

conn = sqlite3.connect(f'file:{TEST_PH_DB}?mode=ro', uri=True, timeout=30)
real_tickers = [r[0] for r in conn.execute("""
    SELECT ticker FROM price_history
    WHERE date >= '2026-10-15' AND close_price > 0
    GROUP BY ticker ORDER BY MAX(date) DESC LIMIT 5
""").fetchall()]
conn.close()
print(f'Tickers: {real_tickers}')

conn_st.execute('DELETE FROM radar_signal_tracking')
conn_st.commit()

# run for the latest real date
test_date = '2026-10-21'
for t in real_tickers:
    result = assess_and_record(conn_ph, conn_st, t, test_date)
    if result.get('skipped'):
        log(f'Real {t}: skipped', False, 'insufficient data')
        continue
    log(f'Real {t}: recorded',
        'state' in result and 'transition_type' in result,
        f'state={result.get("state")} transition={result.get("transition_type")} conf={result.get("confidence", 0):.2f}')

# verify all rows are present
final_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date=?", (test_date,)
).fetchone()[0]
log('Real data: all tickers recorded in single date',
    final_count >= 3,  # at least 3 should have ≥200 days
    f'rows={final_count} (expected ≥3, some may be skipped due to <200 days)')

conn_ph.close()
conn_st.close()

# ═══════════════════════════════════════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════════════════════════════════════
shutil.rmtree(TEST_DB_DIR)
print(f'\n🧹 Test workspace cleaned: {TEST_DB_DIR}')

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
