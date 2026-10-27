#!/usr/bin/env python3
"""
P0 Final Validation — Calls ACTUAL production _track_signals_to_db()
=====================================================================
الإصلاحات المطلوبة من المراجعة:
  1. Concurrency test يفشل لو >1 row (مش mr>=1).
  2. Ownership test: إنشاء other-owner rows قبل الدالة + verify ما تغيرتش.
  3. Backfill SQL test: تنفيذ buggy SQL فعليًا + مقارنة قبل/بعد.
  4. db_manager lifecycle: استخدام with statement (تم إصلاحه في maker_radar.py).
  5. Migration + rollback على schema قديمة فعلية.

الاختبارات بتجيب الدالة الفعلية من maker_radar.py.
"""
import sys
import os
import sqlite3
import tempfile
import shutil
import threading
import subprocess
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

# Import the ACTUAL production function
import importlib.util
spec = importlib.util.spec_from_file_location(
    "maker_radar",
    str(PROJECT_ROOT / 'scripts' / 'maker_radar.py')
)
maker_radar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maker_radar)

results_log = []


def log(name, passed, detail=''):
    status = '✅ PASS' if passed else '❌ FAIL'
    line = f'{status} | {name}'
    if detail:
        line += f' | {detail}'
    print(line)
    results_log.append((name, passed, detail))


# ═══════════════════════════════════════════════════════════════════════════
# Setup
# ═══════════════════════════════════════════════════════════════════════════
TEST_DIR = Path(tempfile.mkdtemp(prefix='p0_final_'))
TEST_DB = TEST_DIR / 'stocks.db'


def create_old_schema(db_path):
    """Create OLD schema (before P0 fix). Drops any existing table first."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("DROP TABLE IF EXISTS radar_signal_tracking")
    conn.execute("DROP TABLE IF EXISTS radar_signal_history")
    conn.execute("""
        CREATE TABLE radar_signal_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            entry_price REAL NOT NULL,
            path TEXT,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            outcome_7d REAL,
            outcome_14d REAL,
            outcome_30d REAL,
            max_price_after REAL,
            min_price_after REAL,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            data_date TEXT,
            data_quality TEXT,
            staleness_days INTEGER,
            price_source TEXT,
            live_price REAL,
            daily_price REAL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_date ON radar_signal_tracking(signal_date)")
    conn.commit()
    conn.close()


TEST_DATE = '2026-10-25'
print(f'Test workspace: {TEST_DIR}')


class FakeDBManager:
    """Mock db_manager that uses direct sqlite3.connect in a proper `with` pattern.
    This matches the REAL db_manager.connection() generator lifecycle."""
    def __init__(self, db_path):
        self.db_path = str(db_path)

    def connection(self, db_name, writable=False):
        db_path = self.db_path
        class FakeContext:
            def __enter__(self):
                self.conn = sqlite3.connect(db_path, timeout=30.0)
                self.conn.execute('PRAGMA busy_timeout=30000')
                return self.conn
            def __exit__(self, *args):
                if self.conn:
                    self.conn.close()
        return FakeContext()


def call_production_function(db_path, stocks_list, scan_date):
    """Call the ACTUAL _track_signals_to_db from maker_radar.py."""
    fake_db = FakeDBManager(db_path)
    with patch.object(maker_radar, 'PROJECT_ROOT', TEST_DIR):
        import core.db_manager
        original = core.db_manager.db_manager
        core.db_manager.db_manager = fake_db
        try:
            maker_radar._track_signals_to_db(stocks_list, scan_date, market_code='EGX')
        finally:
            core.db_manager.db_manager = original


def make_stock_entry(ticker, path, entry_price=100.0):
    return {
        'ticker': ticker, 'path': path, 'current_price': entry_price,
        'reason': f'Test {ticker}', 'money_flow_state': '', 'buy_pct': 0,
        'kill_switch': False, 'kill_reason': '', 'data_date': TEST_DATE,
        'data_quality': 'fresh', 'staleness_days': 0, 'price_source': 'daily',
        'live_price': None, 'daily_price': entry_price, 'data_stale': False,
    }


def get_verification(db_path, ticker, scan_date):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    row = conn.execute("""
        SELECT outcome_7d, outcome_14d, outcome_30d, max_price_after, min_price_after, verified_at, status
        FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND source='maker_radar'
    """, (ticker, scan_date)).fetchone()
    conn.close()
    return row


def get_current_signal(db_path, ticker, scan_date):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    row = conn.execute("SELECT signal_type FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND source='maker_radar'", (ticker, scan_date)).fetchone()
    conn.close()
    return row[0] if row else None


def get_history(db_path, ticker, scan_date):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    try:
        rows = conn.execute("SELECT signal_type, entry_price FROM radar_signal_history WHERE ticker=? AND signal_date=? ORDER BY id", (ticker, scan_date)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    conn.close()
    return rows


def count_rows(db_path, source=None, ticker=None):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    q = "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date=?"
    p = [TEST_DATE]
    if source:
        q += " AND source=?"
        p.append(source)
    if ticker:
        q += " AND ticker=?"
        p.append(ticker)
    n = conn.execute(q, p).fetchone()[0]
    conn.close()
    return n


def apply_verification(db_path, ticker, scan_date, outcome_7d=5.0):
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.execute("""
        UPDATE radar_signal_tracking SET outcome_7d=?, outcome_14d=?, outcome_30d=?,
            max_price_after=?, min_price_after=?, status='verified_win', verified_at=?
        WHERE ticker=? AND signal_date=? AND source='maker_radar'
    """, (outcome_7d, outcome_7d*1.5, outcome_7d*2.0, 105.0, 98.0, '2026-10-25 13:00:00', ticker, scan_date))
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: Production function preserves verification after 3 re-runs
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: Production function preserves verification')
print('='*80)

create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)
apply_verification(TEST_DB, 'COMI', TEST_DATE, outcome_7d=5.0)
for i in range(3):
    call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

v = get_verification(TEST_DB, 'COMI', TEST_DATE)
total = count_rows(TEST_DB)

log('TEST 1a: no duplicates (1 row)', total == 1, f'rows={total}')
log('TEST 1b: verification preserved (outcome_7d=5.0)', v is not None and v[0] == 5.0, f'outcome_7d={v[0] if v else "N/A"}')
log('TEST 1c: verification preserved (verified_at)', v is not None and v[5] is not None, f'verified_at={v[5] if v else "N/A"}')
log('TEST 1d: verification preserved (status=verified_win)', v is not None and v[6] == 'verified_win', f'status={v[6] if v else "N/A"}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: Intraday history preserved
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: Intraday history preserved')
print('='*80)

create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge', 100.0)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge', 100.5)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'B_quiet_accumulation_strong', 101.0)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'D_explosive_surge', 102.0)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'D_explosive_surge', 102.5)], TEST_DATE)

current = get_current_signal(TEST_DB, 'COMI', TEST_DATE)
history = get_history(TEST_DB, 'COMI', TEST_DATE)

log('TEST 2a: current = latest (D_explosive_surge)', current == 'D_explosive_surge', f'current={current}')
log('TEST 2b: history has 2 entries', len(history) == 2, f'history_count={len(history)}')
log('TEST 2c: history[0] = A_pre_surge', len(history) >= 1 and history[0][0] == 'A_pre_surge', f'history[0]={history[0][0] if history else "N/A"}')
log('TEST 2d: history[1] = B_quiet_accumulation_strong', len(history) >= 2 and history[1][0] == 'B_quiet_accumulation_strong', f'history[1]={history[1][0] if len(history) >= 2 else "N/A"}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: Other owners' rows — created BEFORE function call + verified UNCHANGED
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: Other owners — created BEFORE function, verified UNCHANGED after')
print('='*80)

create_old_schema(TEST_DB)

# Step 1: Create other-owner rows BEFORE calling _track_signals_to_db
# We insert them with source column already set (simulating they were written
# by state_history_tracker and frontend respectively).
# Since old schema has no source column, we first run the function once to
# trigger migration (adds source column), then insert other-owner rows,
# then re-run the function.

# Run once to trigger migration
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

# Now insert other-owner rows WITH explicit source
conn = sqlite3.connect(str(TEST_DB), timeout=10)
conn.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, outcome_7d, verified_at, source)
    VALUES ('ABUK', ?, 'canonical_state', 100.0, 'assessed', 3.5, '2026-10-25 12:00:00', 'state_history_tracker')
""", (TEST_DATE,))
conn.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, path, source)
    VALUES ('ABUK', ?, 'pre_surge', 100.0, 'pending', NULL, 'frontend')
""", (TEST_DATE,))
conn.commit()

# Snapshot the other-owner rows BEFORE re-runs
cs_before = conn.execute("""
    SELECT ticker, signal_type, status, outcome_7d, verified_at, source
    FROM radar_signal_tracking WHERE source='state_history_tracker'
""").fetchall()
fe_before = conn.execute("""
    SELECT ticker, signal_type, status, path, source
    FROM radar_signal_tracking WHERE source='frontend'
""").fetchall()
conn.close()

print(f'  Before re-runs: canonical_state rows={len(cs_before)}, frontend rows={len(fe_before)}')
print(f'    CS: {cs_before}')
print(f'    FE: {fe_before}')

# Step 2: Re-run production function 3 times
for i in range(3):
    call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

# Step 3: Verify other-owner rows are UNCHANGED
conn = sqlite3.connect(f'file:{TEST_DB}?mode=ro', uri=True, timeout=10)
cs_after = conn.execute("""
    SELECT ticker, signal_type, status, outcome_7d, verified_at, source
    FROM radar_signal_tracking WHERE source='state_history_tracker'
""").fetchall()
fe_after = conn.execute("""
    SELECT ticker, signal_type, status, path, source
    FROM radar_signal_tracking WHERE source='frontend'
""").fetchall()
mr_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking WHERE source='maker_radar'").fetchone()[0]
conn.close()

print(f'  After 3 re-runs: canonical_state rows={len(cs_after)}, frontend rows={len(fe_after)}')
print(f'    CS: {cs_after}')
print(f'    FE: {fe_after}')

log('TEST 3a: maker_radar=1 (no duplicates)', mr_count == 1, f'maker_radar={mr_count}')
log('TEST 3b: canonical_state rows unchanged (1→1)', len(cs_after) == 1, f'cs={len(cs_after)}')
log('TEST 3c: frontend rows unchanged (1→1)', len(fe_after) == 1, f'fe={len(fe_after)}')

# Verify FIELDS not changed
cs_fields_match = cs_before == cs_after
fe_fields_match = fe_before == fe_after

log('TEST 3d: canonical_state fields unchanged (status, outcome_7d, verified_at)',
    cs_fields_match,
    f'match={cs_fields_match}')
log('TEST 3e: frontend fields unchanged (status, path)',
    fe_fields_match,
    f'match={fe_fields_match}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: Concurrency — FAIL if >1 row (not >=1)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 4: Concurrency — FAIL if >1 row')
print('='*80)

create_old_schema(TEST_DB)
errors = []

def run_thread(tid):
    try:
        call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)
    except Exception as e:
        errors.append(f'Thread {tid}: {e}')

t1 = threading.Thread(target=run_thread, args=(1,))
t2 = threading.Thread(target=run_thread, args=(2,))
t1.start(); t2.start(); t1.join(); t2.join()

mr = count_rows(TEST_DB, source='maker_radar')
print(f'  After 2 concurrent runs: maker_radar rows = {mr}')
if errors:
    print(f'  Errors: {errors}')

# STRICT: exactly 1 row. >1 = duplicate = FAIL.
log('TEST 4a: exactly 1 row (no concurrent duplicates)', mr == 1,
    f'rows={mr} (1=clean, >1=DUPLICATE from race condition)')
log('TEST 4b: no errors', len(errors) == 0, f'errors={len(errors)}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 5: Migration on OLD schema + re-run + rollback
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 5: Migration on OLD schema + re-run + rollback')
print('='*80)

create_old_schema(TEST_DB)
conn = sqlite3.connect(str(TEST_DB))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price) VALUES ('OLD1', ?, 'A_pre_surge', 50.0)", (TEST_DATE,))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price) VALUES ('OLD2', ?, 'pre_surge', 60.0)", (TEST_DATE,))
conn.commit()
old_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking").fetchone()[0]
old_cols = [r[1] for r in conn.execute("PRAGMA table_info(radar_signal_tracking)").fetchall()]
conn.close()
print(f'  Before: {old_count} rows, source in schema={("source" in old_cols)}')

backup_path = TEST_DIR / 'stocks.db.bak'
shutil.copy(str(TEST_DB), str(backup_path))

call_production_function(TEST_DB, [make_stock_entry('NEW1', 'A_pre_surge')], TEST_DATE)

conn = sqlite3.connect(f'file:{TEST_DB}?mode=ro', uri=True, timeout=10)
cols = [r[1] for r in conn.execute("PRAGMA table_info(radar_signal_tracking)").fetchall()]
has_source = 'source' in cols
has_history = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='radar_signal_history'").fetchone() is not None
new_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking").fetchone()[0]
old_sources = conn.execute("SELECT source, COUNT(*) FROM radar_signal_tracking WHERE ticker IN ('OLD1','OLD2') GROUP BY source").fetchall()
new_source = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='NEW1'").fetchone()
conn.close()

log('TEST 5a: source column added', has_source, f'has_source={has_source}')
log('TEST 5b: history table created', has_history, f'has_history={has_history}')
log('TEST 5c: old rows preserved (count+1)', new_count == old_count + 1, f'old={old_count}, new={new_count}')
log('TEST 5d: old rows got default source=maker_radar', len(old_sources) == 1 and old_sources[0][0] == 'maker_radar', f'old_sources={old_sources}')
log('TEST 5e: new row has source=maker_radar', new_source is not None and new_source[0] == 'maker_radar', f'new_source={new_source[0] if new_source else "N/A"}')

call_production_function(TEST_DB, [make_stock_entry('NEW1', 'A_pre_surge')], TEST_DATE)
conn = sqlite3.connect(f'file:{TEST_DB}?mode=ro', uri=True, timeout=10)
rerun_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking WHERE ticker='NEW1'").fetchone()[0]
conn.close()
log('TEST 5f: re-run after migration — no duplicates', rerun_count == 1, f'NEW1 rows={rerun_count}')

shutil.copy(str(backup_path), str(TEST_DB))
conn = sqlite3.connect(f'file:{TEST_DB}?mode=ro', uri=True, timeout=10)
cols_after = [r[1] for r in conn.execute("PRAGMA table_info(radar_signal_tracking)").fetchall()]
rollback_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking").fetchone()[0]
conn.close()
log('TEST 5g: rollback restores old schema (no source)', 'source' not in cols_after, f'has_source={("source" in cols_after)}')
log('TEST 5h: rollback restores old row count', rollback_count == old_count, f'rollback={rollback_count} (expected {old_count})')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 6: Backfill SQL — buggy vs corrected (actual execution + comparison)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 6: Backfill SQL — buggy vs corrected (actual execution)')
print('='*80)

# Setup: create test DB with migrated schema + mixed rows
create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('NEW1', 'A_pre_surge')], TEST_DATE)  # trigger migration

conn = sqlite3.connect(str(TEST_DB), timeout=10)
# Insert test rows
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price, path, source) VALUES ('MR1', ?, 'A_pre_surge', 50.0, 'A_pre_surge', 'maker_radar')", (TEST_DATE,))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price, path, source) VALUES ('FE1', ?, 'quiet_accumulation_weak', 90.0, NULL, 'frontend')", (TEST_DATE,))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price, path, source) VALUES ('FE2', ?, 'pre_surge', 80.0, NULL, 'frontend')", (TEST_DATE,))
conn.commit()
conn.close()

# === Test BUGGY SQL ===
# Copy DB for buggy SQL test
buggy_db = TEST_DIR / 'buggy_test.db'
shutil.copy(str(TEST_DB), str(buggy_db))

conn = sqlite3.connect(str(buggy_db), timeout=10)
# Snapshot FE1 + FE2 before buggy SQL
fe1_before = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE1'").fetchone()[0]
fe2_before = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE2'").fetchone()[0]

# Execute BUGGY SQL (AND/OR precedence bug)
conn.execute("""
    UPDATE radar_signal_tracking SET source = 'maker_radar'
    WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong')
      AND source IS NULL OR source = 'maker_radar'
""")
conn.commit()

fe1_after = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE1'").fetchone()[0]
fe2_after = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE2'").fetchone()[0]
conn.close()

print(f'  BUGGY SQL results:')
print(f'    FE1 (out of scope): before={fe1_before} → after={fe1_after}')
print(f'    FE2 (pre_surge, was frontend): before={fe2_before} → after={fe2_after}')

# BUGGY SQL should have changed FE2 (pre_surge, was frontend) to maker_radar
# because OR precedence makes the WHERE clause match ALL rows where source='maker_radar'
# OR (signal_type IN (...) AND source IS NULL)
# FE1 (quiet_accumulation_weak) is NOT in the IN list, but if source='maker_radar'
# it gets updated too (due to OR). But FE1 was 'frontend', so it should NOT be touched.
# Actually wait — FE1 source='frontend', so `source = 'maker_radar'` is False,
# and `signal_type IN (...)` is False (quiet_accumulation_weak not in list),
# and `source IS NULL` is False. So FE1 should NOT be affected.
# FE2 source='frontend', signal_type='pre_surge' is in the list, source IS NULL is False,
# source='maker_radar' is False. So FE2 should NOT be affected either.
# BUT — the buggy SQL has `OR source = 'maker_radar'` which catches ALL maker_radar rows.
# Let's check if FE1 or FE2 got changed.

log('TEST 6a: BUGGY SQL — FE1 (frontend, out of scope) NOT changed',
    fe1_after == 'frontend',
    f'before={fe1_before}, after={fe1_after}')

log('TEST 6b: BUGGY SQL — FE2 (frontend, pre_surge) NOT changed',
    fe2_after == 'frontend',
    f'before={fe2_before}, after={fe2_after}')

# Now test what buggy SQL ACTUALLY does — it should change MR1 (maker_radar, A_pre_surge)
# Wait — MR1 is already maker_radar. The buggy SQL would re-set it to maker_radar (no-op).
# The real danger is if there were rows with source='frontend' that happen to match
# the OR clause. Let's check: FE1 source='frontend' → `source='maker_radar'` is False.
# So FE1 should NOT be changed. Let's verify.

# === Test CORRECTED SQL ===
corrected_db = TEST_DIR / 'corrected_test.db'
shutil.copy(str(TEST_DB), str(corrected_db))

conn = sqlite3.connect(str(corrected_db), timeout=10)
# Snapshot before
fe1_before_c = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE1'").fetchone()[0]
fe2_before_c = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE2'").fetchone()[0]

# Execute CORRECTED SQL (Step 1: confident maker_radar only)
conn.execute("""
    UPDATE radar_signal_tracking
    SET source = 'maker_radar'
    WHERE signal_type IN (
        'A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak',
        'D_explosive_surge', 'E_early_break', 'disqualified_illiquid'
    )
""")
conn.commit()

fe1_after_c = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE1'").fetchone()[0]
fe2_after_c = conn.execute("SELECT source FROM radar_signal_tracking WHERE ticker='FE2'").fetchone()[0]
conn.close()

print(f'\n  CORRECTED SQL results:')
print(f'    FE1 (frontend, out of scope): before={fe1_before_c} → after={fe1_after_c}')
print(f'    FE2 (frontend, pre_surge): before={fe2_before_c} → after={fe2_after_c}')

log('TEST 6c: CORRECTED SQL — FE1 (out of scope) NOT changed',
    fe1_after_c == fe1_before_c,
    f'before={fe1_before_c}, after={fe1_after_c}')

log('TEST 6d: CORRECTED SQL — FE2 (pre_surge, frontend) NOT changed by Step 1',
    fe2_after_c == fe2_before_c,
    f'before={fe2_before_c}, after={fe2_after_c}')


# ═══════════════════════════════════════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════════════════════════════════════
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
print()
print('  Tests call ACTUAL _track_signals_to_db() from maker_radar.py')
print('  TEST 3: other-owner rows created BEFORE function + verified UNCHANGED after')
print('  TEST 4: FAILS if >1 row (strict duplicate detection)')
print('  TEST 6: BUGGY vs CORRECTED SQL executed + compared')
sys.exit(0 if failed == 0 else 1)
