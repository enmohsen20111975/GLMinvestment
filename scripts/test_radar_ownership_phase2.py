#!/usr/bin/env python3
"""
Phase B.4 — Radar Tracking Ownership Isolated Test
====================================================
يختبر تصميم ملكية سجلات الرادار بدون الاعتماد على قائمة signal_type ثابتة.

التصميم المقترح:
  - canonical_state writer يمتلك الصفوف اللي signal_type='canonical_state'.
  - maker_radar writer يمتلك كل الصفوف اللي signal_type != 'canonical_state'.
  - DELETE في maker_radar يقتصر على `WHERE signal_date = ? AND signal_type != 'canonical_state'`.

الاختبارات:
  1. كتابة radar row + canonical_state row في نفس اليوم، ثم تشغيل DELETE المصمم.
  2. التأكد إن canonical_state لسه موجودة.
  3. التأكد إن radar row اتمسح (تم استبداله).
  4. محاكاة كاتب تالت (frontend TS-style INSERT) + التأكد إنه مش بيتلمح.
  5. محاكاة إعادة تشغيل maker_radar مرتين + التأكد إن مفيش duplicates.

ممنوع:
  - تعديل DB الإنتاجي (كل الاختبارات على نسخة temp).
  - اعتبار HTTP 200 دليل.
"""
import sys
import sqlite3
import tempfile
import shutil
from pathlib import Path

PROJECT_ROOT = Path('/home/z/my-project')
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS))

from canonical_stock_state import (
    assess_state, STATE_UNCONFIRMED, DATA_INCOMPLETE,
    UPTREND, DOWNTREND,
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
TEST_DIR = Path(tempfile.mkdtemp(prefix='ownership_test_'))
TEST_ST = TEST_DIR / 'stocks.db'
TEST_PH = TEST_DIR / 'price_history.db'

src = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
dst = sqlite3.connect(str(TEST_ST))
src.backup(dst); dst.commit(); src.close()
dst.execute('DELETE FROM radar_signal_tracking')
dst.commit()
dst.close()

shutil.copy(str(DB_PH), str(TEST_PH))

print(f'Test workspace: {TEST_DIR}')

# override DB_DIR for state_history_tracker
import state_history_tracker as sht
sht.DB_DIR = TEST_DIR

conn_ph = sqlite3.connect(str(TEST_PH), timeout=30)
conn_st = sqlite3.connect(str(TEST_ST), timeout=30)
ensure_state_columns(conn_st)


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: radar + canonical_state coexist; scoped DELETE preserves canonical
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: scoped DELETE (signal_type != canonical_state) preserves canonical')
print('='*80)

# Step 1: write canonical_state row (mimics state_history_tracker)
test_date = '2026-10-21'
hist = load_ticker_history('COMI', 300)
result = assess_and_record(conn_ph, conn_st, 'COMI', test_date)
canonical_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
print(f'  Step 1: wrote canonical_state row(s): {canonical_count}')

# Step 2: simulate maker_radar INSERT (radar row for same ticker+date)
conn_st.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)
""", ('COMI', test_date, 'A_pre_surge', 100.0, 'pending', 'A_pre_surge'))
conn_st.commit()
radar_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
print(f'  Step 2: wrote radar row(s): {radar_count}')

# Step 3: simulate PROPOSED maker_radar DELETE — scope by signal_type != canonical_state
# This is the design proposal: not a hardcoded list, just exclude canonical_state
conn_st.execute(
    "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type != 'canonical_state'",
    (test_date,)
)
conn_st.commit()

canonical_after = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
radar_after = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
print(f'  Step 3: after scoped DELETE: canonical={canonical_after} radar={radar_after}')

log('TEST 1a: scoped DELETE preserves canonical_state rows',
    canonical_after == canonical_count and canonical_after > 0,
    f'canonical_before={canonical_count} canonical_after={canonical_after}')

log('TEST 1b: scoped DELETE removes radar rows',
    radar_after == 0 and radar_count > 0,
    f'radar_before={radar_count} radar_after={radar_after}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: third-party writer (frontend TS-style INSERT) is NOT touched
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: third-party writer (frontend TS-style) not touched by scoped DELETE')
print('='*80)

# Step 1: insert a row from "frontend" (signal_type='manual_user_pick' for example)
conn_st.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)
""", ('COMI', test_date, 'manual_user_pick', 100.0, 'pending', None))
conn_st.commit()

# Step 2: re-run scoped DELETE
conn_st.execute(
    "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type != 'canonical_state'",
    (test_date,)
)
conn_st.commit()

manual_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='manual_user_pick' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
print(f'  manual_user_pick rows after scoped DELETE: {manual_count}')

# Hmm — this is a problem: scoped DELETE by `!= canonical_state` would
# ALSO remove legitimate frontend/manual picks. This test reveals the
# limitation of the proposed design.
log('TEST 2: scoped DELETE wipes third-party (manual_user_pick) rows',
    manual_count == 0,
    f'manual_count={manual_count} — FINDING: `signal_type != canonical_state` '
    f'is too broad; removes legitimate non-radar non-canonical signals too')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: ALTERNATIVE DESIGN — scope by `source` column or explicit marker
# Idea: add `source` column ('maker_radar' | 'canonical_state' | 'frontend' | 'maintenance')
# But adding a column is a schema change — needs owner approval.
# Alternative: scope by `signal_type IN (canonical_state's complement)` is risky.
# Best alternative: maker_radar should DELETE only its OWN paths.
# But path can be NULL or renamed (we saw pre_surge → A_pre_surge).
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: alternative — DELETE only rows WHERE path IS NOT NULL')
print('='*80)

# Re-insert radar + canonical + manual rows
conn_st.execute("DELETE FROM radar_signal_tracking WHERE signal_date=?", (test_date,))
conn_st.commit()
result = assess_and_record(conn_ph, conn_st, 'COMI', test_date)  # canonical
conn_st.execute("""INSERT INTO radar_signal_tracking
    (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)""",
    ('COMI', test_date, 'A_pre_surge', 100.0, 'pending', 'A_pre_surge'))
conn_st.execute("""INSERT INTO radar_signal_tracking
    (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)""",
    ('COMI', test_date, 'manual_user_pick', 100.0, 'pending', None))
conn_st.commit()

# Use path IS NOT NULL as the scope marker
conn_st.execute(
    "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND path IS NOT NULL",
    (test_date,)
)
conn_st.commit()

canonical_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
radar_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
manual_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='manual_user_pick' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
print(f'  After DELETE WHERE path IS NOT NULL: canonical={canonical_count} radar={radar_count} manual={manual_count}')

log('TEST 3a: DELETE WHERE path IS NOT NULL preserves canonical_state (path=NULL)',
    canonical_count > 0,
    f'canonical={canonical_count}')
log('TEST 3b: DELETE WHERE path IS NOT NULL preserves manual_user_pick (path=NULL)',
    manual_count > 0,
    f'manual={manual_count}')
log('TEST 3c: DELETE WHERE path IS NOT NULL removes radar rows (path set)',
    radar_count == 0,
    f'radar={radar_count}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: re-running maker_radar doesn't create duplicates (with proposed DELETE)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 4: re-running maker_radar with proposed DELETE creates no duplicates')
print('='*80)

conn_st.execute("DELETE FROM radar_signal_tracking WHERE signal_date=?", (test_date,))
conn_st.commit()

# Simulate maker_radar running TWICE on the same date
for run_idx in [1, 2]:
    # Proposed maker_radar behavior:
    # 1. DELETE only its own rows (WHERE path IS NOT NULL AND signal_date=?)
    conn_st.execute(
        "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND path IS NOT NULL",
        (test_date,)
    )
    # 2. INSERT its radar rows
    conn_st.execute("""INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path)
        VALUES (?, ?, ?, ?, ?, ?)""",
        ('COMI', test_date, 'A_pre_surge', 100.0 + run_idx, 'pending', 'A_pre_surge'))
    conn_st.commit()

# Also write canonical_state in between
result = assess_and_record(conn_ph, conn_st, 'COMI', test_date)
conn_st.commit()

radar_final = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
canonical_final = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]
total_for_comi = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date=? AND ticker='COMI'",
    (test_date,)
).fetchone()[0]

print(f'  After 2 maker_radar runs + 1 canonical_state: radar={radar_final} canonical={canonical_final} total={total_for_comi}')

log('TEST 4a: re-running maker_radar creates no radar duplicates',
    radar_final == 1,
    f'radar_final={radar_final} (expected 1, not 2)')
log('TEST 4b: canonical_state row preserved across maker_radar re-runs',
    canonical_final >= 1,
    f'canonical_final={canonical_final}')
log('TEST 4c: total rows for (COMI, date) = 2 (1 radar + 1 canonical)',
    total_for_comi == 2,
    f'total={total_for_comi} (expected 2)')


# ═══════════════════════════════════════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════════════════════════════════════
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
