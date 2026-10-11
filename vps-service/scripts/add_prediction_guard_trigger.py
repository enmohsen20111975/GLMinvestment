"""
add_prediction_guard_trigger.py — DEV-07 §4 SQLite safety net (BEFORE INSERT)
=============================================================================

Installs a SQLite TRIGGER on the predictions table that ABORTs any INSERT
where entry_price / target_price / stop_loss is NULL or <= 0.

This is the database-level last line of defense — even if a future bug
bypasses Python-level guards (validate_prediction_evidence,
safe_insert_prediction, PredictionTracker.record_prediction), the TRIGGER
blocks the bad row from ever reaching the table.

Idempotent: CREATE TRIGGER IF NOT EXISTS — safe to re-run on every deploy.

Acceptance (DEV-07 §5):
    INSERT INTO predictions (entry_price=0) → ABORT ✅
    INSERT INTO predictions (entry_price=NULL) → ABORT ✅

References:
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - worklog.md DEV-07 §4
"""
import sqlite3
import sys
from pathlib import Path

# Resolve project root for DB path discovery (Rule 17 + Rule 61)
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths
    DEFAULT_DB_PATH = DBPaths.PREDICTIONS_DB
except Exception:
    DEFAULT_DB_PATH = str(_PROJECT_ROOT / 'db' / 'predictions.db')


TRIGGER_SQL = """
CREATE TRIGGER IF NOT EXISTS trg_prevent_invalid_prices
BEFORE INSERT ON predictions
FOR EACH ROW
WHEN NEW.entry_price <= 0 OR NEW.target_price <= 0 OR NEW.stop_loss <= 0
   OR NEW.entry_price IS NULL OR NEW.target_price IS NULL OR NEW.stop_loss IS NULL
BEGIN
    SELECT RAISE(ABORT, 'DEV-07: Invalid prices — entry/target/stop must be > 0');
END;
"""


def apply_trigger(db_path: str = DEFAULT_DB_PATH) -> bool:
    """Install the trigger on the predictions table.

    Returns:
        True if trigger installed (or already present), False on error.

    Errors:
        - 'no such table: predictions' → SKIP (table not created yet; will be
          created by PredictionTracker._init_table() on first record_prediction
          call). Re-run this script after that.
        - Other sqlite3.Error → log + return False
    """
    db_path = str(db_path)
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        cur = conn.cursor()
        cur.execute(TRIGGER_SQL)
        conn.commit()

        # Verify trigger exists
        row = cur.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='trigger' AND name='trg_prevent_invalid_prices'"
        ).fetchone()
        conn.close()

        if row:
            print(
                f"[DEV-07] trigger 'trg_prevent_invalid_prices' installed on {db_path}",
                flush=True,
            )
            return True
        print(
            f"[DEV-07] ERROR: trigger not found after CREATE — schema issue? ({db_path})",
            flush=True,
        )
        return False
    except sqlite3.Error as e:
        msg = str(e).lower()
        if 'no such table' in msg and 'predictions' in msg:
            print(
                f"[DEV-07] predictions table not yet created at {db_path} — "
                f"skipping trigger install. Re-run this script after the table "
                f"is created by PredictionTracker._init_table().",
                flush=True,
            )
            return False
        print(f"[DEV-07] ERROR installing trigger at {db_path}: {e}", flush=True)
        return False


def verify_trigger(db_path: str = DEFAULT_DB_PATH) -> bool:
    """Smoke-test the trigger: attempt an INSERT with entry_price=0.

    Returns:
        True if the trigger correctly ABORTed the bad INSERT.
        False if the trigger was bypassed (bad!) or the table is missing.
    """
    db_path = str(db_path)
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        cur = conn.cursor()
        # Try to insert a row with entry_price=0 — should ABORT
        try:
            cur.execute(
                "INSERT INTO predictions "
                "(ticker, signal, signal_type, prediction_date, entry_price, "
                " target_price, stop_loss) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ('__DEV07_TEST__', 'BUY', 'BUY', '1970-01-01', 0, 0, 0),
            )
            conn.commit()
            # If we get here → trigger did NOT fire. BAD.
            # Clean up the bad row (shouldn't be there if trigger is healthy)
            cur.execute(
                "DELETE FROM predictions WHERE ticker='__DEV07_TEST__'"
            )
            conn.commit()
            conn.close()
            print(
                f"[DEV-07-VERIFY] ⚠️ TRIGGER BYPASS: INSERT with entry=0 succeeded "
                f"({db_path}). Trigger is missing or broken!",
                flush=True,
            )
            return False
        except sqlite3.IntegrityError as e:
            # Expected: 'DEV-07: Invalid prices — entry/target/stop must be > 0'
            conn.rollback()
            conn.close()
            print(
                f"[DEV-07-VERIFY] ✅ TRIGGER FIRED: bad INSERT ABORTed with: {e}",
                flush=True,
            )
            return True
    except sqlite3.Error as e:
        if 'no such table' in str(e).lower():
            print(
                f"[DEV-07-VERIFY] predictions table missing at {db_path} — "
                f"cannot verify trigger. Apply trigger first.",
                flush=True,
            )
            return False
        print(f"[DEV-07-VERIFY] ERROR: {e}", flush=True)
        return False


if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser(
        description='DEV-07 §4 — Install SQLite BEFORE-INSERT trigger on predictions',
    )
    ap.add_argument(
        '--db',
        default=DEFAULT_DB_PATH,
        help=f'Path to predictions.db (default: {DEFAULT_DB_PATH})',
    )
    ap.add_argument(
        '--verify',
        action='store_true',
        help='After applying, smoke-test the trigger by attempting a bad INSERT',
    )
    args = ap.parse_args()

    ok = apply_trigger(args.db)
    if not ok:
        sys.exit(1)

    if args.verify:
        verify_ok = verify_trigger(args.db)
        sys.exit(0 if verify_ok else 2)

    sys.exit(0)
