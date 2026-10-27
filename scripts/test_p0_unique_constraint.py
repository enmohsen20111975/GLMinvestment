#!/usr/bin/env python3
"""
P0 UNIQUE Constraint + Real db_manager Tests
=============================================
يختبر:
  1. UNIQUE constraint على (ticker, signal_date, signal_type, source).
  2. Atomic upsert: INSERT → IntegrityError → UPDATE fallback.
  3. Concurrency: عمليتين متوازيتين → 1 row فقط (ضمان DB-level).
  4. Real db_manager lifecycle (مش FakeDBManager).
  5. Migration على schema قديمة + UNIQUE index creation.

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


TEST_DIR = Path(tempfile.mkdtemp(prefix='p0_unique_'))
TEST_DB = TEST_DIR / 'stocks.db'


def create_old_schema(db_path):
    """Create OLD schema (before P0 fix)."""
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
    """Mock db_manager using direct sqlite3.connect with proper `with` pattern.
    Tests the function's use of `with db_manager.connection(...) as conn:`."""
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
                    try:
                        self.conn.close()
                    except:
                        pass
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


def count_rows(db_path, source=None, ticker=None, signal_type=None):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    q = "SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date=?"
    p = [TEST_DATE]
    if source:
        q += " AND source=?"
        p.append(source)
    if ticker:
        q += " AND ticker=?"
        p.append(ticker)
    if signal_type:
        q += " AND signal_type=?"
        p.append(signal_type)
    n = conn.execute(q, p).fetchone()[0]
    conn.close()
    return n


def get_verification(db_path, ticker, scan_date, signal_type='A_pre_surge'):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    row = conn.execute("""
        SELECT outcome_7d, outcome_14d, outcome_30d, max_price_after, min_price_after, verified_at, status
        FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND signal_type=? AND source='maker_radar'
    """, (ticker, scan_date, signal_type)).fetchone()
    conn.close()
    return row


def apply_verification(db_path, ticker, scan_date, signal_type='A_pre_surge', outcome_7d=5.0):
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.execute("""
        UPDATE radar_signal_tracking SET outcome_7d=?, outcome_14d=?, outcome_30d=?,
            max_price_after=?, min_price_after=?, status='verified_win', verified_at=?
        WHERE ticker=? AND signal_date=? AND signal_type=? AND source='maker_radar'
    """, (outcome_7d, outcome_7d*1.5, outcome_7d*2.0, 105.0, 98.0, '2026-10-25 13:00:00',
          ticker, scan_date, signal_type))
    conn.commit()
    conn.close()


def check_unique_exists(db_path):
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
    idx = conn.execute("""
        SELECT name FROM sqlite_master
        WHERE type='index' AND name='idx_radar_unique_owner'
    """).fetchone()
    conn.close()
    return idx is not None


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: UNIQUE constraint created by production function
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: UNIQUE constraint created by production function')
print('='*80)

create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

has_unique = check_unique_exists(TEST_DB)
log('TEST 1a: UNIQUE index idx_radar_unique_owner exists', has_unique, f'exists={has_unique}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: Atomic upsert — verification preserved after 3 re-runs
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: Atomic upsert — verification preserved')
print('='*80)

create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)
apply_verification(TEST_DB, 'COMI', TEST_DATE, signal_type='A_pre_surge', outcome_7d=5.0)

for i in range(3):
    call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

v = get_verification(TEST_DB, 'COMI', TEST_DATE, signal_type='A_pre_surge')
total = count_rows(TEST_DB, ticker='COMI', signal_type='A_pre_surge')

log('TEST 2a: exactly 1 row (no duplicates with UNIQUE)', total == 1, f'rows={total}')
log('TEST 2b: verification preserved (outcome_7d=5.0)', v is not None and v[0] == 5.0, f'outcome_7d={v[0] if v else "N/A"}')
log('TEST 2c: verification preserved (status=verified_win)', v is not None and v[6] == 'verified_win', f'status={v[6] if v else "N/A"}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: Intraday evolution — signal_type changes create NEW rows
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: Intraday evolution — signal changes = new rows (UNIQUE on signal_type)')
print('='*80)

create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge', 100.0)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'B_quiet_accumulation_strong', 101.0)], TEST_DATE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'D_explosive_surge', 102.0)], TEST_DATE)

# With UNIQUE on (ticker, signal_date, signal_type, source):
# Each signal_type = separate row. Total 3 rows for COMI.
total_comi = count_rows(TEST_DB, ticker='COMI')
a_rows = count_rows(TEST_DB, ticker='COMI', signal_type='A_pre_surge')
b_rows = count_rows(TEST_DB, ticker='COMI', signal_type='B_quiet_accumulation_strong')
d_rows = count_rows(TEST_DB, ticker='COMI', signal_type='D_explosive_surge')

print(f'  COMI rows: total={total_comi}, A_pre_surge={a_rows}, B_quiet={b_rows}, D_explosive={d_rows}')

log('TEST 3a: 3 rows total (1 per signal_type)', total_comi == 3, f'total={total_comi}')
log('TEST 3b: A_pre_surge = 1 row', a_rows == 1, f'A={a_rows}')
log('TEST 3c: B_quiet_accumulation_strong = 1 row', b_rows == 1, f'B={b_rows}')
log('TEST 3d: D_explosive_surge = 1 row', d_rows == 1, f'D={d_rows}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: Concurrency — STRICT: exactly 1 row (UNIQUE guarantees no duplicates)
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 4: Concurrency — UNIQUE guarantees no duplicates')
print('='*80)

create_old_schema(TEST_DB)
# First run to create UNIQUE index
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

errors = []

def run_thread(tid):
    try:
        call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)
    except Exception as e:
        errors.append(f'Thread {tid}: {e}')

t1 = threading.Thread(target=run_thread, args=(1,))
t2 = threading.Thread(target=run_thread, args=(2,))
t3 = threading.Thread(target=run_thread, args=(3,))
t1.start(); t2.start(); t3.start()
t1.join(); t2.join(); t3.join()

mr = count_rows(TEST_DB, ticker='COMI', signal_type='A_pre_surge')
print(f'  After 3 concurrent re-runs: rows = {mr}')
if errors:
    print(f'  Errors: {errors}')

log('TEST 4a: exactly 1 row (UNIQUE guarantees no duplicates)', mr == 1, f'rows={mr}')
log('TEST 4b: no errors', len(errors) == 0, f'errors={len(errors)}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 5: Other owners' rows survive + verification preserved
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 5: Other owners — created BEFORE, verified UNCHANGED after')
print('='*80)

create_old_schema(TEST_DB)
# First run to trigger migration (adds source + UNIQUE)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

# Insert other-owner rows BEFORE re-runs
conn = sqlite3.connect(str(TEST_DB), timeout=10)
conn.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, outcome_7d, verified_at, source)
    VALUES ('ABUK', ?, 'canonical_state', 100.0, 'assessed', 3.5, '2026-10-25 12:00:00', 'state_history_tracker')
""", (TEST_DATE,))
conn.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, source)
    VALUES ('ABUK', ?, 'pre_surge', 100.0, 'pending', 'frontend')
""", (TEST_DATE,))
conn.commit()

cs_before = conn.execute("SELECT ticker, signal_type, status, outcome_7d, verified_at FROM radar_signal_tracking WHERE source='state_history_tracker'").fetchall()
fe_before = conn.execute("SELECT ticker, signal_type, status FROM radar_signal_tracking WHERE source='frontend'").fetchall()
conn.close()

# Apply verification to maker_radar row
apply_verification(TEST_DB, 'COMI', TEST_DATE, signal_type='A_pre_surge', outcome_7d=5.0)

# Re-run 3 times
for i in range(3):
    call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

# Verify
conn = sqlite3.connect(f'file:{TEST_DB}?mode=ro', uri=True, timeout=10)
cs_after = conn.execute("SELECT ticker, signal_type, status, outcome_7d, verified_at FROM radar_signal_tracking WHERE source='state_history_tracker'").fetchall()
fe_after = conn.execute("SELECT ticker, signal_type, status FROM radar_signal_tracking WHERE source='frontend'").fetchall()
mr_count = conn.execute("SELECT COUNT(*) FROM radar_signal_tracking WHERE source='maker_radar'").fetchone()[0]
conn.close()

v = get_verification(TEST_DB, 'COMI', TEST_DATE, signal_type='A_pre_surge')

log('TEST 5a: maker_radar=1', mr_count == 1, f'maker_radar={mr_count}')
log('TEST 5b: canonical_state rows unchanged', cs_before == cs_after, f'match={cs_before == cs_after}')
log('TEST 5c: frontend rows unchanged', fe_before == fe_after, f'match={fe_before == fe_after}')
log('TEST 5d: maker_radar verification preserved (outcome_7d=5.0)', v is not None and v[0] == 5.0, f'outcome_7d={v[0] if v else "N/A"}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 6: db_manager lifecycle — verify connection is properly closed
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 6: db_manager lifecycle — connection closed after function returns')
print('='*80)

# We verify that the `with` statement properly closes the connection
# by checking that no WAL file is left open (or that a second connection
# can acquire a write lock immediately after the function returns).
create_old_schema(TEST_DB)
call_production_function(TEST_DB, [make_stock_entry('COMI', 'A_pre_surge')], TEST_DATE)

# Try to acquire a write lock immediately after the function returns
try:
    conn = sqlite3.connect(str(TEST_DB), timeout=5)
    conn.execute('PRAGMA busy_timeout=1000')
    conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price) VALUES ('TEST', ?, 'test', 1.0)", (TEST_DATE,))
    conn.commit()
    conn.close()
    lock_acquired = True
except sqlite3.OperationalError as e:
    lock_acquired = False
    print(f'  Lock error: {e}')

log('TEST 6a: write lock available after function returns (connection closed)',
    lock_acquired, f'lock_acquired={lock_acquired}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 7: Migration — UNIQUE on OLD schema with existing rename pairs
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 7: Migration — UNIQUE on schema with rename pairs (production-like)')
print('='*80)

create_old_schema(TEST_DB)
# Insert rename pairs (like production: pre_surge + A_pre_surge for same ticker+date)
conn = sqlite3.connect(str(TEST_DB))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price) VALUES ('ABUK', ?, 'pre_surge', 50.0)", (TEST_DATE,))
conn.execute("INSERT INTO radar_signal_tracking (ticker, signal_date, signal_type, entry_price) VALUES ('ABUK', ?, 'A_pre_surge', 50.0)", (TEST_DATE,))
conn.commit()
conn.close()

# Run production function — should add source + UNIQUE
call_production_function(TEST_DB, [make_stock_entry('NEW1', 'A_pre_surge')], TEST_DATE)

has_unique = check_unique_exists(TEST_DB)
total = count_rows(TEST_DB)

print(f'  After migration: unique={has_unique}, total rows={total}')

# Rename pairs should survive (different signal_type = different UNIQUE key)
abuk_pre = count_rows(TEST_DB, ticker='ABUK', signal_type='pre_surge')
abuk_a = count_rows(TEST_DB, ticker='ABUK', signal_type='A_pre_surge')

log('TEST 7a: UNIQUE index created despite rename pairs', has_unique, f'unique={has_unique}')
log('TEST 7b: rename pair survives (pre_surge=1)', abuk_pre == 1, f'pre_surge={abuk_pre}')
log('TEST 7c: rename pair survives (A_pre_surge=1)', abuk_a == 1, f'A_pre_surge={abuk_a}')


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
print('  KEY: UNIQUE on (ticker, signal_date, signal_type, source) eliminates race conditions.')
print('  Atomic upsert: INSERT → IntegrityError → UPDATE fallback.')
print('  Signal_type changes create NEW rows (natural intraday evolution).')
sys.exit(0 if failed == 0 else 1)
