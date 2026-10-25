#!/usr/bin/env python3
"""
Phase C.3 — Proposed UNIQUE Key Validation
============================================
يختبر المفتاح المقترح (ticker, signal_date, signal_type) على نسخة معزولة
تشمل جميع أنماط الكتابة ذات الصلة:
  - maker_radar INSERT (radar paths)
  - state_history_tracker INSERT (canonical_state)
  - frontend TS INSERT (manual_user_pick with optional path)

يختبر:
  1. هل UNIQUE(ticker, signal_date, signal_type) بيسمح بالتعايش الشرعي (radar + canonical_state في نفس اليوم)?
  2. هل INSERT OR REPLACE بـ UNIQUE شغّال صح (replace فعلي بدل duplicate)?
  3. هل الـ duplicates الحاليين (A_pre_surge + pre_surge بنفس path) هيتلموا?
  4. هل frontend TS dedup logic (SELECT before INSERT) لسه شغّال تحت UNIQUE?

ممنوع:
  - تعديل DB الإنتاجي.
  - إضافة UNIQUE INDEX على الـ DB الإنتاجي.
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

from canonical_stock_state import assess_state, UPTREND
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


# ═══════════════════════════════════════════════════════════════════════════
# Setup: test DB with proposed UNIQUE INDEX
# ═══════════════════════════════════════════════════════════════════════════
TEST_DIR = Path(tempfile.mkdtemp(prefix='unique_key_test_'))
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

import state_history_tracker as sht
sht.DB_DIR = TEST_DIR

conn_ph = sqlite3.connect(str(TEST_PH), timeout=30)
conn_st = sqlite3.connect(str(TEST_ST), timeout=30)
ensure_state_columns(conn_st)

# Add proposed UNIQUE INDEX
conn_st.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_unique_key
    ON radar_signal_tracking(ticker, signal_date, signal_type)
""")
conn_st.commit()
print('Added proposed UNIQUE INDEX: (ticker, signal_date, signal_type)')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: radar + canonical_state في نفس اليوم (التعايش الشرعي)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: radar + canonical_state coexistence under UNIQUE(ticker, signal_date, signal_type)')
print('='*80)

test_date = '2026-10-21'
ticker = 'COMI'

# write canonical_state
hist = load_hist = None
import sqlite3 as s
ph_conn = s.connect(f'file:{TEST_PH}?mode=ro', uri=True, timeout=30)
rows = ph_conn.execute("""
    SELECT date, open_price, high_price, low_price, close_price, volume
    FROM price_history WHERE ticker=? AND close_price>0 AND high_price>0
    ORDER BY date DESC LIMIT 300
""", (ticker,)).fetchall()
ph_conn.close()
rows = list(reversed(rows))
closes = [float(r[4]) for r in rows]
highs = [float(r[2] or 0) for r in rows]
lows = [float(r[3] or 0) for r in rows]
volumes = [int(r[5] or 0) for r in rows]
dates = [r[0] for r in rows]

result = assess_and_record(conn_ph, conn_st, ticker, test_date)
canonical_count = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker=?",
    (test_date, ticker)
).fetchone()[0]
print(f'  canonical_state rows: {canonical_count}')

# write radar row for same ticker+date (different signal_type)
try:
    conn_st.execute("""
        INSERT INTO radar_signal_tracking
            (ticker, signal_date, signal_type, entry_price, status, path)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (ticker, test_date, 'A_pre_surge', 100.0, 'pending', 'A_pre_surge'))
    conn_st.commit()
    radar_count = conn_st.execute(
        "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker=?",
        (test_date, ticker)
    ).fetchone()[0]
    print(f'  radar rows: {radar_count}')
    log('TEST 1: UNIQUE allows radar + canonical_state coexistence',
        canonical_count == 1 and radar_count == 1,
        f'canonical={canonical_count} radar={radar_count}')
except Exception as e:
    log('TEST 1: UNIQUE allows radar + canonical_state coexistence', False, f'INSERT failed: {e}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: INSERT OR REPLACE with UNIQUE — replaces existing (not duplicate)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: INSERT OR REPLACE with UNIQUE — replaces, not duplicates')
print('='*80)

# write canonical_state again (same ticker+date+signal_type)
result2 = assess_and_record(conn_ph, conn_st, ticker, test_date)
canonical_count_2 = conn_st.execute(
    "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='canonical_state' AND signal_date=? AND ticker=?",
    (test_date, ticker)
).fetchone()[0]
print(f'  canonical_state rows after 2nd write: {canonical_count_2}')

# But: assess_and_record uses INSERT OR REPLACE — under UNIQUE this should
# REPLACE the existing row, NOT add a new one. However, since the PK is `id`,
# SQLite's INSERT OR REPLACE will DELETE the old row and INSERT a new one
# with a new id. The COUNT should still be 1.
log('TEST 2: INSERT OR REPLACE with UNIQUE → count stays 1 (no duplicate)',
    canonical_count_2 == 1,
    f'canonical_count_after_2nd_write={canonical_count_2} (expected 1, was {canonical_count} before)')

# Also test radar INSERT OR REPLACE
try:
    conn_st.execute("""
        INSERT OR REPLACE INTO radar_signal_tracking
            (ticker, signal_date, signal_type, entry_price, status, path)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (ticker, test_date, 'A_pre_surge', 105.0, 'pending', 'A_pre_surge'))
    conn_st.commit()
    radar_count_2 = conn_st.execute(
        "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='A_pre_surge' AND signal_date=? AND ticker=?",
        (test_date, ticker)
    ).fetchone()[0]
    print(f'  radar rows after INSERT OR REPLACE: {radar_count_2}')
    log('TEST 2b: INSERT OR REPLACE radar row → count stays 1',
        radar_count_2 == 1,
        f'radar_count={radar_count_2} (expected 1)')
except Exception as e:
    log('TEST 2b: INSERT OR REPLACE radar row', False, f'failed: {e}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: radar with renamed signal_type (pre_surge + A_pre_surge same path)
# This is the historical rename case — UNIQUE on signal_type allows BOTH
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: renamed signal_type (pre_surge + A_pre_surge) under UNIQUE')
print('='*80)

# Clear COMI rows for clean test
conn_st.execute("DELETE FROM radar_signal_tracking WHERE ticker='COMI' AND signal_date=?", (test_date,))
conn_st.commit()

# Insert with old name
conn_st.execute("""INSERT INTO radar_signal_tracking
    (ticker, signal_date, signal_type, entry_price, status, path)
    VALUES (?, ?, ?, ?, ?, ?)""",
    (ticker, test_date, 'pre_surge', 100.0, 'pending', 'A_pre_surge'))
conn_st.commit()

# Insert with new name (same path)
try:
    conn_st.execute("""INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (ticker, test_date, 'A_pre_surge', 100.0, 'pending', 'A_pre_surge'))
    conn_st.commit()
    both_count = conn_st.execute(
        "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date=? AND ticker=? AND signal_type IN ('pre_surge', 'A_pre_surge')",
        (test_date, ticker)
    ).fetchone()[0]
    print(f'  rows with signal_type in (pre_surge, A_pre_surge): {both_count}')
    # FINDING: UNIQUE on (ticker, date, signal_type) ALLOWS both because
    # signal_type differs. This is the limitation the owner raised.
    log('TEST 3: UNIQUE(ticker, date, signal_type) allows renamed signal_type rows',
        both_count == 2,
        f'both_count={both_count} — FINDING: rename duplicates NOT prevented by this key; '
        f'would require UNIQUE on (ticker, signal_date, path) instead, but path can be NULL')
except Exception as e:
    log('TEST 3: UNIQUE allows renamed signal_type', False, f'failed: {e}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: frontend TS dedup logic (SELECT before INSERT) still works
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 4: frontend TS dedup logic (SELECT before INSERT) under UNIQUE')
print('='*80)

# Step 1: SELECT (frontend dedup check)
existing = conn_st.execute(
    "SELECT id FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND signal_type=? LIMIT 1",
    (ticker, test_date, 'manual_pick')
).fetchone()
print(f'  Step 1 (SELECT existing): {existing}')

if existing:
    # Would skip INSERT (dedup hit)
    log('TEST 4a: frontend dedup — SELECT finds existing → skip INSERT', True, f'existing_id={existing[0]}')
else:
    # Step 2: INSERT
    try:
        conn_st.execute("""INSERT INTO radar_signal_tracking
            (ticker, signal_date, signal_type, entry_price, path, reason, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
            (ticker, test_date, 'manual_pick', 100.0, None, 'manual entry'))
        conn_st.commit()
        manual_count = conn_st.execute(
            "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='manual_pick' AND signal_date=? AND ticker=?",
            (test_date, ticker)
        ).fetchone()[0]
        print(f'  Step 2 (INSERT): manual_count={manual_count}')
        log('TEST 4a: frontend dedup — INSERT succeeds when no existing', manual_count == 1, f'manual_count={manual_count}')
    except Exception as e:
        log('TEST 4a: frontend INSERT', False, f'failed: {e}')

# Step 3: try INSERT again — should fail with UNIQUE constraint (or dedup catches it)
try:
    conn_st.execute("""INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, path, reason, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
        (ticker, test_date, 'manual_pick', 105.0, None, 'second manual entry'))
    conn_st.commit()
    manual_count_2 = conn_st.execute(
        "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_type='manual_pick' AND signal_date=? AND ticker=?",
        (test_date, ticker)
    ).fetchone()[0]
    print(f'  Step 3 (2nd INSERT without dedup check): manual_count={manual_count_2}')
    log('TEST 4b: UNIQUE prevents duplicate INSERT (without dedup check)',
        manual_count_2 == 1,
        f'manual_count={manual_count_2} (expected 1 — UNIQUE blocked duplicate)')
except sqlite3.IntegrityError as e:
    print(f'  Step 3: IntegrityError raised: {e}')
    log('TEST 4b: UNIQUE raises IntegrityError on duplicate INSERT', True, f'error: {type(e).__name__}: {str(e)[:50]}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 5: existing 1301 production rows — would they fit under UNIQUE?
# (simulate by copying production rows and trying to add UNIQUE INDEX)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 5: production 1301 rows — can UNIQUE be added?')
print('='*80)

# Copy production radar_signal_tracking into test DB
src = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
src_rows = src.execute("""
    SELECT ticker, signal_date, signal_type, entry_price, path, reason, status, created_at
    FROM radar_signal_tracking
""").fetchall()
src.close()

# Clear test DB and try to insert production rows + add UNIQUE
conn_st.execute("DELETE FROM radar_signal_tracking")
conn_st.execute("DROP INDEX IF EXISTS idx_radar_unique_key")
conn_st.commit()

# Insert all production rows
inserted = 0
failed = 0
for r in src_rows:
    try:
        conn_st.execute("""
            INSERT INTO radar_signal_tracking
                (ticker, signal_date, signal_type, entry_price, path, reason, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, r)
        inserted += 1
    except Exception as e:
        failed += 1
conn_st.commit()
print(f'  Inserted {inserted}/{len(src_rows)} production rows (failed: {failed})')

# Now try to add UNIQUE INDEX
try:
    conn_st.execute("""
        CREATE UNIQUE INDEX idx_radar_unique_key
        ON radar_signal_tracking(ticker, signal_date, signal_type)
    """)
    conn_st.commit()
    print(f'  ✅ UNIQUE INDEX created successfully — no conflicts in production data')
    log('TEST 5: production 1301 rows accept UNIQUE(ticker, date, signal_type)',
        True,
        f'inserted={inserted}, UNIQUE added without error')
except sqlite3.IntegrityError as e:
    print(f'  ❌ UNIQUE INDEX failed: {e}')
    # Count how many duplicates would block it
    dup_count = conn_st.execute("""
        SELECT COUNT(*) FROM (
            SELECT ticker, signal_date, signal_type
            FROM radar_signal_tracking
            GROUP BY ticker, signal_date, signal_type
            HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    total_dup_rows = conn_st.execute("""
        SELECT SUM(c) FROM (
            SELECT COUNT(*) as c
            FROM radar_signal_tracking
            GROUP BY ticker, signal_date, signal_type
            HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    print(f'  Duplicate (ticker, date, signal_type) triples: {dup_count}')
    print(f'  Total rows in those triples: {total_dup_rows}')
    log('TEST 5: production data has duplicates blocking UNIQUE',
        False,
        f'duplicate_triples={dup_count} total_rows_in_dups={total_dup_rows} — '
        f'would need cleanup before UNIQUE INDEX can be added')


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
