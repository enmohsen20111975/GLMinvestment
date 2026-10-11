"""
apply_guard_triggers — DEV-13 §3 SQLite safety net (BEFORE INSERT + UPDATE)
============================================================================

Installs 3 SQLite TRIGGERs on the predictions table:

1. ``trg_prevent_invalid_prices_insert``  (BEFORE INSERT)
   ABORTs any INSERT where entry_price / target_price / stop_loss is NULL or <= 0.

2. ``trg_prevent_invalid_prices_update``   (BEFORE UPDATE OF entry_price,
   target_price, stop_loss)
   Same check on UPDATE — catches any code path that tries to overwrite a
   valid price with NULL / 0 / negative.

3. ``trg_prevent_wrong_direction``         (BEFORE INSERT)
   ABORTs any INSERT where signal is BUY/STRONG_BUY/ACCUMULATE but
   target_price <= entry_price (BUY requires target > entry).

This is the database-level last line of defense — even if a future bug
bypasses Python-level guards (validate_prediction_evidence,
safe_insert_prediction, PredictionTracker.record_prediction), the TRIGGERs
block the bad row from ever reaching the table.

Pre-apply report
----------------
Before installing, the script counts rows that would VIOLATE each trigger
(if the trigger were active). This gives an early warning — if the count is
non-zero, the existing data is already dirty and needs cleanup before the
triggers can be safely installed (otherwise future UPDATEs to those rows
may fail).

Idempotent
----------
All triggers use ``CREATE TRIGGER IF NOT EXISTS`` — safe to re-run on every
deploy.

Usage
-----
    python3 vps-service/scripts/apply_guard_triggers.py
    python3 vps-service/scripts/apply_guard_triggers.py --db /custom/path.db
    python3 vps-service/scripts/apply_guard_triggers.py --verify
    python3 vps-service/scripts/apply_guard_triggers.py --dry-run

References
----------
- Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
- Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
- agent-ctx/DEV-11-14-lead-technical-implementer.md §3
- worklog.md DEV-13
"""
from __future__ import annotations

import argparse
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


# ════════════════════════════════════════════════════════════════════════════
# DEV-13 §1 — Trigger SQL: reject NULL / ≤0 prices on INSERT
# ════════════════════════════════════════════════════════════════════════════
TRIGGER_INSERT_PRICES_SQL = """
CREATE TRIGGER IF NOT EXISTS trg_prevent_invalid_prices_insert
BEFORE INSERT ON predictions
FOR EACH ROW
WHEN NEW.entry_price IS NULL OR NEW.entry_price <= 0
   OR NEW.target_price IS NULL OR NEW.target_price <= 0
   OR NEW.stop_loss IS NULL OR NEW.stop_loss <= 0
BEGIN
    SELECT RAISE(ABORT, 'DEV-13: Invalid prices on INSERT — NULL or <= 0');
END;
"""

# ════════════════════════════════════════════════════════════════════════════
# DEV-13 §1 — Trigger SQL: reject NULL / ≤0 prices on UPDATE
# ════════════════════════════════════════════════════════════════════════════
TRIGGER_UPDATE_PRICES_SQL = """
CREATE TRIGGER IF NOT EXISTS trg_prevent_invalid_prices_update
BEFORE UPDATE OF entry_price, target_price, stop_loss ON predictions
FOR EACH ROW
WHEN NEW.entry_price IS NULL OR NEW.entry_price <= 0
   OR NEW.target_price IS NULL OR NEW.target_price <= 0
   OR NEW.stop_loss IS NULL OR NEW.stop_loss <= 0
BEGIN
    SELECT RAISE(ABORT, 'DEV-13: Invalid prices on UPDATE — NULL or <= 0');
END;
"""

# ════════════════════════════════════════════════════════════════════════════
# DEV-13 §2 — Trigger SQL: reject BUY with target <= entry
# ════════════════════════════════════════════════════════════════════════════
TRIGGER_WRONG_DIRECTION_SQL = """
CREATE TRIGGER IF NOT EXISTS trg_prevent_wrong_direction
BEFORE INSERT ON predictions
FOR EACH ROW
WHEN NEW.signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE')
    AND NEW.target_price <= NEW.entry_price
BEGIN
    SELECT RAISE(ABORT, 'DEV-13: BUY requires target > entry');
END;
"""


# All triggers as (name, sql, description) tuples for iteration
ALL_TRIGGERS = (
    ('trg_prevent_invalid_prices_insert', TRIGGER_INSERT_PRICES_SQL,
     'Reject NULL/<=0 prices on INSERT (DEV-13 §1)'),
    ('trg_prevent_invalid_prices_update', TRIGGER_UPDATE_PRICES_SQL,
     'Reject NULL/<=0 prices on UPDATE of price columns (DEV-13 §1)'),
    ('trg_prevent_wrong_direction', TRIGGER_WRONG_DIRECTION_SQL,
     'Reject BUY with target <= entry on INSERT (DEV-13 §2)'),
)


def log(msg: str) -> None:
    print(f"[DEV-13] {msg}", flush=True)


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    """Return True if `table` exists in the database."""
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name=?",
            (table,),
        )
        return cur.fetchone() is not None
    except sqlite3.Error:
        return False


def trigger_exists(conn: sqlite3.Connection, name: str) -> bool:
    """Return True if trigger `name` exists."""
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='trigger' AND name=?",
            (name,),
        )
        return cur.fetchone() is not None
    except sqlite3.Error:
        return False


def count_price_violations(conn: sqlite3.Connection) -> int:
    """Count rows where entry/target/stop is NULL or <= 0."""
    try:
        cur = conn.execute(
            "SELECT COUNT(*) FROM predictions "
            "WHERE entry_price IS NULL OR entry_price <= 0 "
            "   OR target_price IS NULL OR target_price <= 0 "
            "   OR stop_loss IS NULL OR stop_loss <= 0"
        )
        return cur.fetchone()[0]
    except sqlite3.Error:
        return -1


def count_direction_violations(conn: sqlite3.Connection) -> int:
    """Count BUY/STRONG_BUY/ACCUMULATE rows where target <= entry."""
    try:
        cur = conn.execute(
            "SELECT COUNT(*) FROM predictions "
            "WHERE signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE') "
            "  AND target_price <= entry_price"
        )
        return cur.fetchone()[0]
    except sqlite3.Error:
        return -1


def pre_apply_report(conn: sqlite3.Connection) -> dict:
    """Count existing violations BEFORE applying the triggers."""
    report = {
        'price_violations': count_price_violations(conn),
        'direction_violations': count_direction_violations(conn),
    }
    return report


def apply_triggers(db_path: str, dry_run: bool = False) -> bool:
    """Apply all 3 triggers. Returns True on success.

    Args:
        db_path: absolute path to predictions.db
        dry_run: if True, only print what would be done — do not write.
    """
    db_path = str(db_path)
    log(f"DB: {db_path}")

    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')

            if not table_exists(conn, 'predictions'):
                log("predictions table not yet created at this DB — skipping.")
                log("Re-run this script after PredictionTracker._init_table() creates it.")
                return False

            # ── Pre-apply report ───────────────────────────────────────────
            log("")
            log("═" * 70)
            log("Pre-apply report — existing rows that would VIOLATE each trigger:")
            log("═" * 70)
            price_v = count_price_violations(conn)
            dir_v = count_direction_violations(conn)
            log(f"  Rows with NULL/<=0 prices (would be blocked by INSERT trigger):  {price_v}")
            log(f"  BUY rows with target <= entry (would be blocked by direction trigger): {dir_v}")
            log("")
            if price_v > 0 or dir_v > 0:
                log("⚠️  WARNING: existing data already violates the trigger rules.")
                log("   These rows are NOT blocked by triggers (triggers fire on INSERT/UPDATE")
                log("   only — not retroactively). But future UPDATEs to these rows may fail.")
                log("   Run scripts/unified_prediction_cleanup.py to mark them as INVALID.")
                log("")

            # ── Show which triggers already exist ───────────────────────────
            log("Existing triggers:")
            existing_count = 0
            for name, _sql, _desc in ALL_TRIGGERS:
                if trigger_exists(conn, name):
                    log(f"  ✓ {name} — already exists")
                    existing_count += 1
                else:
                    log(f"  ✗ {name} — missing")
            if existing_count == len(ALL_TRIGGERS):
                log("")
                log("All triggers already installed — no-op.")
                return True

            if dry_run:
                log("")
                log("--dry-run: not executing CREATE TRIGGER.")
                return True

            # ── Apply triggers ──────────────────────────────────────────────
            log("")
            log("Applying triggers...")
            for name, sql, desc in ALL_TRIGGERS:
                try:
                    conn.execute(sql)
                    conn.commit()
                    log(f"  ✓ {name} installed ({desc})")
                except sqlite3.Error as e:
                    log(f"  ✗ {name} FAILED: {e}")
                    return False

            # ── Verify all triggers exist ───────────────────────────────────
            log("")
            log("Verification:")
            ok = True
            for name, _sql, _desc in ALL_TRIGGERS:
                if trigger_exists(conn, name):
                    log(f"  ✓ {name} present")
                else:
                    log(f"  ✗ {name} MISSING — schema issue?")
                    ok = False
            return ok
        finally:
            conn.close()
    except sqlite3.Error as e:
        log(f"ERROR: {e}")
        return False


def verify_triggers(db_path: str) -> bool:
    """Smoke-test each trigger by attempting a bad INSERT/UPDATE.

    Returns True if all 3 triggers correctly ABORT their bad operations.
    """
    db_path = str(db_path)
    log(f"Verifying triggers on {db_path}...")

    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        try:
            # ── Verify INSERT prices trigger ────────────────────────────────
            # Try INSERT with entry_price=0 — should ABORT
            try:
                conn.execute(
                    "INSERT INTO predictions "
                    "(ticker, signal, signal_type, prediction_date, "
                    " entry_price, target_price, stop_loss) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ('__DEV13_TEST__', 'BUY', 'BUY', '1970-01-01', 0, 0, 0),
                )
                conn.commit()
                # If we get here → trigger did NOT fire. BAD.
                # DEV-14 (2026-10-13 — CI cleanup): use UPDATE→ARCHIVED instead of
                # DELETE so check_no_hard_delete.py CI gate stays clean.
                conn.execute(
                    "UPDATE predictions SET status='ARCHIVED', "
                    "notes=COALESCE(notes,'') || ' | DEV-13-VERIFY-TEST' "
                    "WHERE ticker='__DEV13_TEST__'"
                )
                conn.commit()
                log("  ✗ trg_prevent_invalid_prices_insert BYPASS: bad INSERT succeeded")
                return False
            except sqlite3.IntegrityError as e:
                if 'DEV-13' in str(e):
                    log(f"  ✓ trg_prevent_invalid_prices_insert FIRED: {e}")
                else:
                    log(f"  ? trg_prevent_invalid_prices_insert fired with unexpected message: {e}")

            # ── Verify UPDATE prices trigger ───────────────────────────────
            # Insert a valid row first, then try to UPDATE entry_price=0
            try:
                conn.execute(
                    "INSERT INTO predictions "
                    "(ticker, signal, signal_type, prediction_date, "
                    " entry_price, target_price, stop_loss) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ('__DEV13_TEST__', 'BUY', 'BUY', '1970-01-01', 10.0, 12.0, 9.0),
                )
                conn.commit()

                try:
                    conn.execute(
                        "UPDATE predictions SET entry_price=0 "
                        "WHERE ticker='__DEV13_TEST__'"
                    )
                    conn.commit()
                    log("  ✗ trg_prevent_invalid_prices_update BYPASS: bad UPDATE succeeded")
                    # Cleanup — DEV-14: UPDATE→ARCHIVED instead of DELETE.
                    conn.execute(
                        "UPDATE predictions SET status='ARCHIVED', "
                        "notes=COALESCE(notes,'') || ' | DEV-13-VERIFY-TEST' "
                        "WHERE ticker='__DEV13_TEST__'"
                    )
                    conn.commit()
                    return False
                except sqlite3.IntegrityError as e:
                    if 'DEV-13' in str(e):
                        log(f"  ✓ trg_prevent_invalid_prices_update FIRED: {e}")
                    else:
                        log(f"  ? trg_prevent_invalid_prices_update fired with unexpected message: {e}")
            finally:
                # Cleanup the test row — DEV-14: UPDATE→ARCHIVED instead of DELETE.
                try:
                    conn.execute(
                        "UPDATE predictions SET status='ARCHIVED', "
                        "notes=COALESCE(notes,'') || ' | DEV-13-VERIFY-TEST' "
                        "WHERE ticker='__DEV13_TEST__' AND status != 'ARCHIVED'"
                    )
                    conn.commit()
                except Exception:
                    pass

            # ── Verify direction trigger ───────────────────────────────────
            # Try INSERT with BUY but target <= entry — should ABORT
            try:
                conn.execute(
                    "INSERT INTO predictions "
                    "(ticker, signal, signal_type, prediction_date, "
                    " entry_price, target_price, stop_loss) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ('__DEV13_TEST__', 'BUY', 'BUY', '1970-01-01', 10.0, 9.0, 8.0),
                )
                conn.commit()
                # If we get here → trigger did NOT fire. BAD.
                # DEV-14: UPDATE→ARCHIVED instead of DELETE.
                conn.execute(
                    "UPDATE predictions SET status='ARCHIVED', "
                    "notes=COALESCE(notes,'') || ' | DEV-13-VERIFY-TEST' "
                    "WHERE ticker='__DEV13_TEST__'"
                )
                conn.commit()
                log("  ✗ trg_prevent_wrong_direction BYPASS: bad INSERT succeeded")
                return False
            except sqlite3.IntegrityError as e:
                if 'DEV-13' in str(e):
                    log(f"  ✓ trg_prevent_wrong_direction FIRED: {e}")
                else:
                    log(f"  ? trg_prevent_wrong_direction fired with unexpected message: {e}")

            return True
        finally:
            # Final cleanup — DEV-14: UPDATE→ARCHIVED instead of DELETE.
            try:
                conn.execute(
                    "UPDATE predictions SET status='ARCHIVED', "
                    "notes=COALESCE(notes,'') || ' | DEV-13-VERIFY-TEST' "
                    "WHERE ticker='__DEV13_TEST__' AND status != 'ARCHIVED'"
                )
                conn.commit()
            except Exception:
                pass
            conn.close()
    except sqlite3.Error as e:
        if 'no such table' in str(e).lower():
            log(f"predictions table missing at {db_path} — cannot verify.")
            return False
        log(f"ERROR: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(
        description='DEV-13 §3 — Install SQLite BEFORE-INSERT/UPDATE triggers on predictions',
    )
    ap.add_argument(
        '--db',
        default=DEFAULT_DB_PATH,
        help=f'Path to predictions.db (default: {DEFAULT_DB_PATH})',
    )
    ap.add_argument(
        '--dry-run',
        action='store_true',
        help='Print the pre-apply report only — do not write.',
    )
    ap.add_argument(
        '--verify',
        action='store_true',
        help='After applying, smoke-test each trigger by attempting a bad INSERT/UPDATE.',
    )
    args = ap.parse_args()

    ok = apply_triggers(args.db, dry_run=args.dry_run)
    if not ok:
        return 1

    if args.verify:
        verify_ok = verify_triggers(args.db)
        return 0 if verify_ok else 2

    return 0


if __name__ == '__main__':
    sys.exit(main())
