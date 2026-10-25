#!/usr/bin/env python3
"""
Phase 3.4 — Isolated Test: maker_radar DELETE impact on canonical_state
=========================================================================
يختبر أن إعادة تشغيل maker_radar (الـ DELETE WHERE signal_date=?) بتحذف
canonical_state rows المكتوبة من state_history_tracker.

الاختبار:
  1. ينسخ stocks.db + price_history.db إلى temp dir.
  2. يكتب canonical_state rows لـ ticker في تاريخ معين (مثلاً COMI, 2026-10-21).
  3. يحاكي سلوك maker_radar: DELETE FROM radar_signal_tracking WHERE signal_date=?
  4. يتحقق إن canonical_state rows اتمسحت (مش لازم تتمسح).
  5. يقترح scope الإصلاح.

ممنوع:
  - تعديل DB الإنتاجي.
  - اعتبار HTTP 200 دليل.
"""
import sys
import os
import sqlite3
import tempfile
import shutil
from pathlib import Path

PROJECT_ROOT = Path('/home/z/my-project')
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS))

from canonical_stock_state import (
    assess_state, ACCUMULATION, UPTREND, DOWNTREND, RECOVERY,
    CORRECTION_HEALTHY, DISTRIBUTION, STATE_UNCONFIRMED,
)
from state_history_tracker import assess_and_record, ensure_state_columns

DB_PH = PROJECT_ROOT / 'db' / 'price_history.db'

results_log = []

def log(name, passed, detail=''):
    status = '✅ PASS' if passed else '❌ FAIL'
    line = f'{status} | {name}'
    if detail:
        line += f' | {detail}'
    print(line)
    results_log.append((name, passed, detail))

def load_ticker_history(ticker, max_days=300):
    conn = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True, timeout=30)
    rows = conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND close_price>0 AND high_price>0
        ORDER BY date DESC LIMIT ?
    """, (ticker, max_days)).fetchall()
    conn.close()
    rows = list(reversed(rows))
    return {
        'dates': [r[0] for r in rows],
        'opens': [float(r[1] or 0) for r in rows],
        'highs': [float(r[2] or 0) for r in rows],
        'lows': [float(r[3] or 0) for r in rows],
        'closes': [float(r[4]) for r in rows],
        'volumes': [int(r[5] or 0) for r in rows],
    }

# ═══════════════════════════════════════════════════════════════════════════
# Setup: test DB
# ═══════════════════════════════════════════════════════════════════════════
TEST_DIR = Path(tempfile.mkdtemp(prefix='radar_delete_test_'))
TEST_ST = TEST_DIR / 'stocks.db'
TEST_PH = TEST_DIR / 'price_history.db'

# copy stocks.db (with schema + radar_signal_tracking empty)
src = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
dst = sqlite3.connect(str(TEST_ST))
src.backup(dst); dst.commit(); src.close()
dst.execute('DELETE FROM radar_signal_tracking')
dst.commit()
dst.close()

# copy price_history.db
shutil.copy(str(DB_PH), str(TEST_PH))

print(f'Test workspace: {TEST_DIR}')

# ═══════════════════════════════════════════════════════════════════════════
# Test 1: اكتب canonical_state لـ COMI في 2026-10-21، ثم احاكي DELETE maker_radar
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: maker_radar DELETE يحذف canonical_state rows')
print('='*80)

import state_history_tracker as sht
sht.DB_DIR = TEST_DIR

conn_ph = sqlite3.connect(str(TEST_PH), timeout=30)
conn_st = sqlite3.connect(str(TEST_ST), timeout=30)
ensure_state_columns(conn_st)

# Step 1: write canonical_state for COMI on 2026-10-21
hist = load_ticker_history('COMI', 300)
test_date = '2026-10-21'
result = assess_and_record(conn_ph, conn_st, 'COMI', test_date)

canonical_before = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  Step 1: wrote canonical_state for COMI on {test_date} → {canonical_before} row(s)')

# Step 2: simulate maker_radar's DELETE WHERE signal_date=?
# This is EXACTLY what scripts/maker_radar.py:752 does
conn_st.execute("DELETE FROM radar_signal_tracking WHERE signal_date = ?", (test_date,))
conn_st.commit()

canonical_after = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  Step 2: simulated maker_radar DELETE WHERE signal_date={test_date}')
print(f'  → canonical_state rows after DELETE: {canonical_after}')

# This is the BUG: canonical_state got wiped by maker_radar's global delete
log('BUG CONFIRMED: maker_radar DELETE wipes canonical_state rows',
    canonical_after == 0 and canonical_before > 0,
    f'before={canonical_before} after={canonical_after} (expected: canonical_state should survive)')

# ═══════════════════════════════════════════════════════════════════════════
# Test 2: اقتراح scope الإصلاح — DELETE محدود بـ signal_type
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: اقتراح الإصلاح — DELETE محدود بـ signal_type')
print('='*80)

# re-write canonical_state
result = assess_and_record(conn_ph, conn_st, 'COMI', test_date)
canonical_rewritten = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  Step 1 (rewrite): canonical_state rows = {canonical_rewritten}')

# Step 2: simulate CORRECTED maker_radar DELETE — scoped by signal_type
# This is the proposed fix: maker_radar should only delete its OWN rows
corrected_signal_types = (
    'pre_surge', 'A_pre_surge',
    'quiet_accumulation_strong', 'B_quiet_accumulation_strong',
    'explosive_surge', 'D_explosive_surge',
    'early_break', 'E_early_break',
    'disqualified_illiquid', 'unknown',
)
placeholders = ','.join(['?'] * len(corrected_signal_types))
conn_st.execute(
    f"DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type IN ({placeholders})",
    [test_date] + list(corrected_signal_types)
)
conn_st.commit()

canonical_after_fix = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  Step 2 (corrected DELETE): canonical_state rows = {canonical_after_fix}')

log('FIX PROPOSAL: scoped DELETE preserves canonical_state rows',
    canonical_after_fix == canonical_rewritten and canonical_after_fix > 0,
    f'before_delete={canonical_rewritten} after_scoped_delete={canonical_after_fix} '
    f'(proposed fix: scope DELETE by signal_type IN radar_paths)')

# ═══════════════════════════════════════════════════════════════════════════
# Test 3: اختبار آخر — إذا كان فيه صفوف radar (path) + canonical_state في نفس اليوم
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: radar + canonical_state rows في نفس اليوم')
print('='*80)

# Add a fake radar row (simulating maker_radar INSERT)
conn_st.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)
""", ('COMI', test_date, 'pre_surge', 100.0, 'pending', 'A_pre_surge'))
conn_st.commit()

radar_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='pre_surge' AND signal_date=?",
    (test_date,)
).fetchone()[0]
canonical_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  radar rows: {radar_count}, canonical_state rows: {canonical_count}')

log('Coexistence: radar + canonical_state rows in same date',
    radar_count == 1 and canonical_count == 1,
    f'radar={radar_count} canonical={canonical_count} (multi-signal pattern is by design)')

# scoped DELETE should only remove radar rows, preserve canonical_state
conn_st.execute(
    f"DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type IN ({placeholders})",
    [test_date] + list(corrected_signal_types)
)
conn_st.commit()

radar_after = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='pre_surge' AND signal_date=?",
    (test_date,)
).fetchone()[0]
canonical_after = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=?",
    (test_date,)
).fetchone()[0]
print(f'  After scoped DELETE: radar={radar_after} canonical={canonical_after}')

log('Coexistence: scoped DELETE preserves canonical_state, removes only radar rows',
    radar_after == 0 and canonical_after == 1,
    f'radar_after={radar_after} (expected 0) canonical_after={canonical_after} (expected 1)')

conn_ph.close()
conn_st.close()
shutil.rmtree(TEST_DIR)
print(f'\n🧹 Test workspace cleaned: {TEST_DIR}')

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
