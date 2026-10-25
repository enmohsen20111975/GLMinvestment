#!/usr/bin/env python3
"""
Shadow Mode Tests — canonical_state_shadow.py
==============================================
يختبر:
  1. activate/deactivate lifecycle.
  2. audit table creation.
  3. record_prediction مع shadow mode = prediction_id صحيح + audit record.
  4. fail-safe: لو canonical_state غير متاح → audit بسجل NULL + prediction ناجح.
  5. لا تغيير في قرار التوقع (priority_delta مقترح بس، مش مُطبّق).
  6. تحليل: get_shadow_summary + get_shadow_audits.

ممنوع:
  - لمس DBs الإنتاجية (كل الاختبارات على نسخة temp).
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

# Set env vars BEFORE importing shadow module
os.environ['CANONICAL_STATE_SHADOW_MODE'] = '1'
os.environ.pop('V40_2_BACKTEST_MODE', None)

import canonical_state_shadow as shadow

results_log = []

def log(name, passed, detail=''):
    status = '✅ PASS' if passed else '❌ FAIL'
    line = f'{status} | {name}'
    if detail:
        line += f' | {detail}'
    print(line)
    results_log.append((name, passed, detail))


# ═══════════════════════════════════════════════════════════════════════════
# Setup: temp DBs
# ═══════════════════════════════════════════════════════════════════════════
TEST_DIR = Path(tempfile.mkdtemp(prefix='shadow_test_'))
TEST_PRED_DB = TEST_DIR / 'predictions.db'
TEST_STOCKS_DB = TEST_DIR / 'stocks.db'

# Create predictions.db with predictions table (minimal schema)
conn = sqlite3.connect(str(TEST_PRED_DB))
conn.execute("""
    CREATE TABLE predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        prediction_date TEXT NOT NULL,
        signal TEXT,
        entry_price REAL,
        target_price REAL,
        stop_loss REAL,
        master_score REAL,
        evidence_count INTEGER DEFAULT 0,
        persona TEXT DEFAULT 'balanced'
    )
""")
conn.commit()
conn.close()

# Create stocks.db with radar_signal_tracking + canonical_state rows
src = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
dst = sqlite3.connect(str(TEST_STOCKS_DB))
src.backup(dst)
dst.commit()
src.close()
# Clear radar_signal_tracking to start clean
dst.execute('DELETE FROM radar_signal_tracking')
dst.commit()
# Insert a few canonical_state rows
dst.execute("""
    INSERT INTO radar_signal_tracking
        (ticker, signal_date, signal_type, canonical_state, confidence,
         prev_state, transition_type, days_in_state, data_freshness, entry_price, status)
    VALUES
        ('COMI', '2026-10-21', 'canonical_state', 'DOWNTREND', 0.62,
         'DOWNTREND', 'CONTINUE', 3, 'fresh', 100.0, 'assessed'),
        ('AAPL', '2026-10-21', 'canonical_state', 'UPTREND', 0.72,
         'UPTREND', 'CONTINUE', 5, 'fresh', 150.0, 'assessed'),
        ('ABUK', '2026-10-21', 'canonical_state', 'DATA_INCOMPLETE', 0.0,
         '', 'NEW', 0, 'incomplete', 0.0, 'assessed')
""")
dst.commit()
dst.close()

# Override DEFAULT_SHADOW_DB in shadow module
shadow.DEFAULT_SHADOW_DB = TEST_PRED_DB
shadow._stocks_db_override = str(TEST_STOCKS_DB)

print(f'Test workspace: {TEST_DIR}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: audit table creation
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 1: audit table creation (ensure_audit_table)')
print('='*80)

db_path = shadow.ensure_audit_table(str(TEST_PRED_DB))
log('TEST 1: audit table created',
    db_path == str(TEST_PRED_DB),
    f'db_path={db_path}')

# Verify table exists
conn = sqlite3.connect(str(TEST_PRED_DB))
tables = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_canonical_state_audit'"
).fetchall()]
conn.close()
log('TEST 1b: shadow_canonical_state_audit table exists',
    len(tables) == 1,
    f'tables_found={tables}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: fetch_canonical_state_for_ticker
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 2: fetch_canonical_state_for_ticker')
print('='*80)

# COMI has canonical_state='DOWNTREND' on 2026-10-21
cs_comi = shadow.fetch_canonical_state_for_ticker('COMI', '2026-10-21', stocks_db_path=str(TEST_STOCKS_DB))
log('TEST 2a: COMI canonical_state fetched',
    cs_comi is not None and cs_comi['canonical_state'] == 'DOWNTREND',
    f'state={cs_comi.get("canonical_state") if cs_comi else None} conf={cs_comi.get("confidence") if cs_comi else None}')

# Unknown ticker → None
cs_unknown = shadow.fetch_canonical_state_for_ticker('UNKNOWN', '2026-10-21', stocks_db_path=str(TEST_STOCKS_DB))
log('TEST 2b: unknown ticker returns None',
    cs_unknown is None,
    f'cs={cs_unknown}')

# Date before any canonical_state → None
cs_old = shadow.fetch_canonical_state_for_ticker('COMI', '2026-10-01', stocks_db_path=str(TEST_STOCKS_DB))
log('TEST 2c: date before canonical_state exists returns None',
    cs_old is None,
    f'cs={cs_old}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: activate/deactivate
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 3: activate/deactivate lifecycle')
print('='*80)

# Make sure not active
shadow.deactivate()
log('TEST 3a: initially not active',
    not shadow.is_active(),
    f'active={shadow.is_active()}')

# Activate
activated = shadow.activate(force=True)
log('TEST 3b: activate(force=True) succeeds',
    activated is True,
    f'activated={activated} active={shadow.is_active()}')

# Verify active
log('TEST 3c: is_active() returns True after activate',
    shadow.is_active() is True,
    f'active={shadow.is_active()}')

# Deactivate
shadow.deactivate()
log('TEST 3d: deactivate restores original',
    not shadow.is_active(),
    f'active={shadow.is_active()}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: record_prediction with shadow mode = audit record created
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 4: record_prediction with shadow mode (audit logged)')
print('='*80)

# Activate shadow mode
shadow.activate(force=True)

# Mock PredictionTracker to use our test DB
class MockPredictionTracker:
    """Minimal mock that mimics PredictionTracker.record_prediction."""
    def __init__(self, db_path):
        self.db_path = db_path

    def record_prediction(self, ticker, signal, entry_price, target_price=None,
                          stop_loss=None, master_score=None, prediction_date=None,
                          evidence_count=0, **kwargs):
        # Insert into predictions table
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        try:
            cur = conn.execute("""
                INSERT INTO predictions (ticker, prediction_date, signal, entry_price, target_price, stop_loss, master_score, evidence_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (ticker, prediction_date, signal, entry_price, target_price, stop_loss, master_score, evidence_count))
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


# Create mock tracker instance
mock_tracker = MockPredictionTracker(TEST_PRED_DB)

# Replace _original_record_prediction with the mock's unbound method
# We need to call it as mock_tracker.record_prediction(ticker=..., ...) directly
# but the shadow wrapper calls _original_record_prediction(self, *args, **kwargs)
# So we set _original_record_prediction = a function that takes (self, *args, **kwargs)
# and calls mock_tracker.record_prediction(*args, **kwargs) ignoring self.
def _mock_original(self, *args, **kwargs):
    return mock_tracker.record_prediction(*args, **kwargs)

shadow._original_record_prediction = _mock_original

# Call the shadow wrapper
prediction_id = shadow._shadow_record_prediction(
    mock_tracker,  # self
    ticker='COMI',
    signal='BUY',
    entry_price=100.0,
    target_price=115.0,
    stop_loss=94.0,
    master_score=75.0,
    prediction_date='2026-10-21',
    evidence_count=4,
)

log('TEST 4a: shadow record_prediction returns prediction_id',
    prediction_id > 0,
    f'prediction_id={prediction_id}')

# Verify audit record was created
conn = sqlite3.connect(str(TEST_PRED_DB))
audit_count = conn.execute(
    "SELECT COUNT(*) FROM shadow_canonical_state_audit WHERE ticker='COMI' AND prediction_id=?",
    (prediction_id,)
).fetchone()[0]
audit_row = conn.execute(
    "SELECT canonical_state, proposed_action, proposed_priority_delta FROM shadow_canonical_state_audit WHERE ticker='COMI' AND prediction_id=?",
    (prediction_id,)
).fetchone()
conn.close()

log('TEST 4b: audit record created for COMI',
    audit_count == 1,
    f'audit_count={audit_count}')

if audit_row:
    log('TEST 4c: COMI audit has canonical_state=DOWNTREND',
        audit_row[0] == 'DOWNTREND',
        f'canonical_state={audit_row[0]}')

    log('TEST 4d: COMI audit proposed_action=WARN (DOWNTREND policy)',
        audit_row[1] == 'WARN',
        f'proposed_action={audit_row[1]}')

    log('TEST 4e: COMI audit proposed_priority_delta=-5 (DOWNTREND policy)',
        audit_row[2] == -5,
        f'proposed_priority_delta={audit_row[2]}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 5: fail-safe — ticker without canonical_state
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 5: fail-safe — ticker without canonical_state')
print('='*80)

prediction_id_2 = shadow._shadow_record_prediction(
    mock_tracker,
    ticker='UNKNOWN',
    signal='BUY',
    entry_price=50.0,
    prediction_date='2026-10-21',
    master_score=60.0,
)

log('TEST 5a: prediction still succeeds without canonical_state',
    prediction_id_2 > 0,
    f'prediction_id={prediction_id_2}')

conn = sqlite3.connect(str(TEST_PRED_DB))
audit_row_2 = conn.execute(
    "SELECT canonical_state, proposed_action, proposed_priority_delta FROM shadow_canonical_state_audit WHERE ticker='UNKNOWN' AND prediction_id=?",
    (prediction_id_2,)
).fetchone()
conn.close()

if audit_row_2:
    log('TEST 5b: audit logged with NULL canonical_state',
        audit_row_2[0] is None,
        f'canonical_state={audit_row_2[0]}')

    log('TEST 5c: proposed_action=LOG_ONLY for missing canonical_state',
        audit_row_2[1] == 'LOG_ONLY',
        f'proposed_action={audit_row_2[1]}')

    log('TEST 5d: proposed_priority_delta=0 for missing canonical_state',
        audit_row_2[2] == 0,
        f'proposed_priority_delta={audit_row_2[2]}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 6: no decision change — shadow doesn't modify predictions table
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 6: no decision change — predictions table untouched')
print('='*80)

conn = sqlite3.connect(str(TEST_PRED_DB))
# Count predictions and audits
pred_count = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
audit_count = conn.execute("SELECT COUNT(*) FROM shadow_canonical_state_audit").fetchone()[0]
# Check predictions table has no extra columns
cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
has_canonical_col = 'canonical_state' in cols or 'shadow_state' in cols
conn.close()

log('TEST 6a: predictions table has no canonical_state column',
    not has_canonical_col,
    f'cols={cols}')

log('TEST 6b: predictions count = 2 (COMI + UNKNOWN), audits count = 2',
    pred_count == 2 and audit_count == 2,
    f'preds={pred_count} audits={audit_count}')


# ═══════════════════════════════════════════════════════════════════════════
# TEST 7: analysis queries
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '='*80)
print('TEST 7: analysis queries (get_shadow_audits + get_shadow_summary)')
print('='*80)

audits = shadow.get_shadow_audits(limit=10, db_path=str(TEST_PRED_DB))
log('TEST 7a: get_shadow_audits returns 2 records',
    len(audits) == 2,
    f'audits_count={len(audits)}')

audits_comi = shadow.get_shadow_audits(limit=10, ticker='COMI', db_path=str(TEST_PRED_DB))
log('TEST 7b: get_shadow_audits filter by ticker=COMI returns 1',
    len(audits_comi) == 1,
    f'comi_audits={len(audits_comi)}')

summary = shadow.get_shadow_summary(db_path=str(TEST_PRED_DB))
log('TEST 7c: get_shadow_summary total_audits=2',
    summary.get('total_audits') == 2,
    f'summary={summary}')

log('TEST 7d: summary missing_canonical_state_count=1 (UNKNOWN ticker)',
    summary.get('missing_canonical_state_count') == 1,
    f'missing={summary.get("missing_canonical_state_count")}')


# ═══════════════════════════════════════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════════════════════════════════════
shadow.deactivate()
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
