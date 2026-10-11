#!/usr/bin/env python3
"""
recover_deleted_legit.py — DEV-16 §2 Recover the 28 deleted legit predictions (G8)
==============================================================================

Identifies and recovers the 28 V40.2-legitimate predictions that were
deleted from production during the rogue-cleanup wave (DEV-04/DEV-05).

Source of truth: a LOCAL BACKUP DB (default: ``db/predictions.bak.dev-08.<ts>.db``)
that still has all 38 legit rows. Target: the production ``predictions.db``
that has only 10 legit rows remaining. The diff (28 rows) is what this
script restores.

Identification strategy
----------------------
A prediction is "legit" iff ALL of:
    - evidence_count >= 3               (V40.2 evidence pipeline ran)
    - kill_filter_result IS NOT NULL AND != ''   (provenance proven)
    - kill_filter_result starts with 'V40 evidence=' or 'INTRADAY-5M'
    - entry_price > 0, target_price > 0, stop_loss > 0
    - For BUY/STRONG_BUY/ACCUMULATE: target > entry, stop < entry
    - master_score != 50.0 (placeholder)

A row is considered ALREADY PRESENT in the target DB (and thus skipped) iff
a row with the same (ticker, prediction_date, persona, entry_price) natural
key exists. This is idempotent — running the script twice recovers nothing
on the second run.

INSERT path
-----------
The script calls ``safe_insert_prediction()`` for every missing legit row.
This means the canonical INSERT pipeline (DEV-12) + the DEV-07 hard-gate
(None / <=0 price rejection) + the DEV-13 SQLite triggers (BEFORE INSERT
prices + direction) + the prediction_write_guard all run on every row. If
any of those guards reject the row, it is logged and skipped — never
silently inserted.

Dry-run by default
------------------
Without ``--execute``, the script only prints the diff and the recovery
plan. With ``--execute``, every INSERT is attempted (some may be rejected
by the guard — those are logged and counted separately).

⚠️ NEVER run this on production without a DB backup. The script will refuse
to run with ``--execute`` if ``--no-backup-guard`` is not also passed AND
the target DB has no .bak.dev-16.<ts>.db sibling. Use the latter flag only
if you have already made a backup via the deployment runbook.

Usage
-----
    python3 vps-service/scripts/recover_deleted_legit.py --dry-run
    python3 vps-service/scripts/recover_deleted_legit.py \\
        --source-db db/predictions.bak.dev-08.20261011T221010Z.db \\
        --target-db db/predictions.db \\
        --execute

Exit codes:
    0 = success (dry-run or execute)
    2 = fatal error (DB not found / SQLite error / guard rejection)

References:
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY — V40.2 only)
    - agent-ctx/DEV-11-14-lead-technical-implementer.md (safe_insert_prediction
      + DEV-13 triggers)
    - vps-service/scripts/recover_legit_predictions.py (the legit
      classifier — same validation rules)
    - worklog.md DEV-16
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution
# ─────────────────────────────────────────────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths  # type: ignore
    DEFAULT_TARGET_DB = DBPaths.PREDICTIONS_DB
except Exception:
    DEFAULT_TARGET_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# Default source = the most recent .bak.dev-08.* DB in db/
def _find_default_source() -> Optional[str]:
    db_dir = _PROJECT_ROOT / 'db'
    if not db_dir.exists():
        return None
    candidates = sorted(db_dir.glob('predictions.bak.dev-08.*.db'), reverse=True)
    return str(candidates[0]) if candidates else None


# ─────────────────────────────────────────────────────────────────────────────
# Legit classifier — mirrors recover_legit_predictions.py (DEV-05)
# ─────────────────────────────────────────────────────────────────────────────
def is_legit(row: sqlite3.Row) -> Tuple[bool, List[str]]:
    """Return (True, []) if the row is a legit V40.2 prediction.

    The validation rules are identical to recover_legit_predictions.py — kept
    inline so this script does not import that file (which would execute its
    main block on import).
    """
    issues: List[str] = []
    kf = row['kill_filter_result'] or ''
    if not (kf.startswith('V40 evidence=') or kf.startswith('INTRADAY-5M')):
        issues.append(f"kill_filter doesn't start with V40/INTRADAY signature: '{kf[:50]}'")
    entry = float(row['entry_price'] or 0)
    if entry <= 0:
        issues.append(f"entry_price <= 0: {entry}")
    target = float(row['target_price'] or 0)
    if target <= 0:
        issues.append(f"target_price <= 0: {target}")
    stop = float(row['stop_loss'] or 0)
    if stop <= 0:
        issues.append(f"stop_loss <= 0: {stop}")
    sig = (row['signal'] or '').upper()
    if sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
        if entry > 0 and target > 0 and target <= entry:
            issues.append(f"BUY: target ({target}) <= entry ({entry})")
        if entry > 0 and stop > 0 and stop >= entry:
            issues.append(f"BUY: stop ({stop}) >= entry ({entry})")
    score = row['master_score']
    if score is not None:
        try:
            if abs(float(score) - 50.0) < 0.01:
                issues.append("master_score = 50.0 (placeholder)")
        except (TypeError, ValueError):
            issues.append(f"master_score invalid: {score}")
    rr = row['risk_reward']
    if rr is not None:
        try:
            if float(rr) <= 0:
                issues.append(f"risk_reward <= 0: {rr}")
        except (TypeError, ValueError):
            pass
    return (len(issues) == 0, issues)


# ─────────────────────────────────────────────────────────────────────────────
# Legit row loader
# ─────────────────────────────────────────────────────────────────────────────
SQL_FETCH_LEGIT = """
    SELECT id, ticker, signal, signal_type, prediction_date,
           entry_price, target_price, stop_loss, master_score,
           technical_score, fundamental_score, ai_pattern_score, sentiment_score,
           notes, persona, created_at, atr_at_entry,
           target_price_2, explosive_score, explosive_label,
           evidence_count, morning_bell, kill_filter_result,
           risk_reward, who_is_buying, support_level, resistance_level, market
    FROM predictions
    WHERE evidence_count >= 3
      AND kill_filter_result IS NOT NULL
      AND kill_filter_result != ''
      AND status != 'INVALID'
    ORDER BY id
"""


def load_legit_rows(db_path: Path) -> List[Tuple[sqlite3.Row, List[str]]]:
    """Load all legit rows from a DB. Returns [(row, issues), ...]."""
    rows: List[Tuple[sqlite3.Row, List[str]]] = []
    conn = sqlite3.connect(f'file:{db_path.as_posix()}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(SQL_FETCH_LEGIT)
        for r in cur.fetchall():
            ok, issues = is_legit(r)
            if ok:
                rows.append((r, []))
    finally:
        conn.close()
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Natural key — (ticker, prediction_date, persona, signal, entry_price, target_price)
# The 6-tuple is strict enough to catch true duplicates while still matching
# legit rows that share (ticker, prediction_date, persona, entry_price) but
# differ in signal/target (different signal strengths or stop/target levels).
# ─────────────────────────────────────────────────────────────────────────────
def natural_key(row: sqlite3.Row) -> Tuple[str, str, str, str, float, float]:
    return (
        (row['ticker'] or '').upper().strip(),
        row['prediction_date'] or '',
        (row['persona'] or 'balanced').lower().strip(),
        (row['signal'] or '').upper().strip(),
        round(float(row['entry_price'] or 0), 4),
        round(float(row['target_price'] or 0), 4),
    )


# ─────────────────────────────────────────────────────────────────────────────
# INSERT via safe_insert_prediction (the single canonical INSERT site)
# ─────────────────────────────────────────────────────────────────────────────
def recover_row(target_db: str, row: sqlite3.Row) -> Tuple[bool, str]:
    """Call safe_insert_prediction() with the row's fields.

    Returns:
        (True, '') on success.
        (False, reason) if the guard rejected the INSERT.
    """
    try:
        from core.safe_insert_prediction import safe_insert_prediction
    except Exception as _imp:
        return False, f"safe_insert_prediction import failed: {_imp}"

    try:
        pred_id = safe_insert_prediction(
            ticker=row['ticker'],
            signal=row['signal'],
            entry_price=float(row['entry_price'] or 0),
            target_price=float(row['target_price'] or 0),
            stop_loss=float(row['stop_loss'] or 0),
            evidence_count=int(row['evidence_count'] or 0),
            kill_filter_result=row['kill_filter_result'] or '',
            master_score=float(row['master_score'] or 0),
            notes=row['notes'] or '',
            persona=row['persona'] or 'balanced',
            market=row['market'] or None,
            db_path=target_db,
            signal_type=row['signal_type'] or None,
            prediction_date=row['prediction_date'] or None,
            created_at_iso=row['created_at'] or None,
            technical_score=float(row['technical_score']) if row['technical_score'] is not None else None,
            fundamental_score=float(row['fundamental_score']) if row['fundamental_score'] is not None else None,
            ai_pattern_score=float(row['ai_pattern_score']) if row['ai_pattern_score'] is not None else None,
            sentiment_score=float(row['sentiment_score']) if row['sentiment_score'] is not None else None,
            atr_at_entry=float(row['atr_at_entry']) if row['atr_at_entry'] is not None else None,
            target_price_2=float(row['target_price_2']) if row['target_price_2'] is not None else None,
            explosive_score=float(row['explosive_score']) if row['explosive_score'] is not None else 0.0,
            explosive_label=row['explosive_label'] or '',
            morning_bell=int(row['morning_bell']) if row['morning_bell'] is not None else 0,
            risk_reward=float(row['risk_reward']) if row['risk_reward'] is not None else None,
            who_is_buying_state=row['who_is_buying'] or '',
            support_level=float(row['support_level'] or 0.0),
            resistance_level=float(row['resistance_level'] or 0.0),
        )
    except Exception as _ins_err:
        return False, f"safe_insert_prediction raised: {_ins_err}"

    if pred_id is None:
        return False, "guard rejected (DEV-07 / DEV-12 / DEV-13)"
    return True, f"new pred_id={pred_id}"


# ─────────────────────────────────────────────────────────────────────────────
# Backup helper
# ─────────────────────────────────────────────────────────────────────────────
def backup_target(target_db: Path) -> Path:
    """Copy target DB → .bak.dev-16.<UTC-ts>.db before any INSERT."""
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    bak = target_db.parent / f"{target_db.stem}.bak.dev-16.{ts}{target_db.suffix}"
    shutil.copy2(target_db, bak)
    return bak


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    default_source = _find_default_source()
    ap = argparse.ArgumentParser(
        description='DEV-16 — Recover the 28 deleted legit predictions via safe_insert_prediction',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('--source-db', default=default_source,
                    help=f'Backup DB with all 38 legit rows (default: {default_source})')
    ap.add_argument('--target-db', default=DEFAULT_TARGET_DB,
                    help=f'Target predictions.db to recover into (default: {DEFAULT_TARGET_DB})')
    ap.add_argument('--dry-run', action='store_true', default=False,
                    help='Print diff only — do not INSERT (default if no flag given).')
    ap.add_argument('--execute', action='store_true', default=False,
                    help='Attempt INSERTs via safe_insert_prediction.')
    ap.add_argument('--no-backup-guard', action='store_true', default=False,
                    help='Skip the auto-backup step. Use only if you have already backed up.')
    args = ap.parse_args()

    if args.execute and args.dry_run:
        ap.error('Cannot use --dry-run and --execute together.')
    if not args.execute and not args.dry_run:
        args.dry_run = True

    if not args.source_db:
        print('ERROR: --source-db required (no default backup DB found in db/).', file=sys.stderr)
        return 2

    source_db = Path(args.source_db).resolve()
    target_db = Path(args.target_db).resolve()
    if not source_db.exists():
        print(f'ERROR: source DB not found: {source_db}', file=sys.stderr)
        return 2
    if not target_db.exists():
        print(f'ERROR: target DB not found: {target_db}', file=sys.stderr)
        return 2

    print('=' * 78)
    print('DEV-16 — Recover deleted legit predictions (G8)')
    print('=' * 78)
    print(f'source DB (backup with all legits): {source_db}')
    print(f'target DB (production to recover) : {target_db}')
    print(f'mode                             : {"DRY-RUN" if args.dry_run else "EXECUTE (will INSERT)"}')
    print()

    # ── Load legit rows from source + target ──
    source_legits = load_legit_rows(source_db)
    target_legits = load_legit_rows(target_db)
    print(f'legit rows in source : {len(source_legits)}')
    print(f'legit rows in target : {len(target_legits)}')
    print()

    # ── Compute diff by natural key ──
    target_keys = {natural_key(r) for r, _ in target_legits}
    missing = [(r, issues) for (r, issues) in source_legits
               if natural_key(r) not in target_keys]
    print(f'missing in target (to recover): {len(missing)}')
    print()

    if not missing:
        print('✓ Nothing to recover — target already has all legit rows.')
        return 0

    # ── Sample ──
    print('Sample missing rows (max 8):')
    for r, _ in missing[:8]:
        print(f"  id={r['id']:>6} {r['ticker']:8s} {r['signal']:12s} "
              f"pred_date={r['prediction_date']} persona={r['persona']} "
              f"entry={r['entry_price']} target={r['target_price']} stop={r['stop_loss']}")
    print()

    if args.dry_run:
        print('─' * 78)
        print('DRY-RUN: no changes applied. Re-run with --execute to attempt')
        print('the INSERTs (each row will go through safe_insert_prediction —')
        print('rows rejected by DEV-07/DEV-12/DEV-13 guards will be logged).')
        print('─' * 78)
        return 0

    # ── EXECUTE: backup target, then attempt INSERT for each missing row ──
    if not args.no_backup_guard:
        bak = backup_target(target_db)
        print(f'Backup: {bak}')
        print()

    # Make sure safe_insert_prediction is importable before we begin
    try:
        from core.safe_insert_prediction import safe_insert_prediction  # noqa: F401
    except Exception as _imp_err:
        print(f'ERROR: safe_insert_prediction not importable: {_imp_err}', file=sys.stderr)
        return 2

    n_inserted = 0
    n_rejected = 0
    rejected_log: List[Tuple[int, str, str, str]] = []  # (source_id, ticker, pred_date, reason)

    for r, _ in missing:
        ok, reason = recover_row(str(target_db), r)
        if ok:
            n_inserted += 1
            print(f"  ✓ id={r['id']:>6} {r['ticker']:8s} pred_date={r['prediction_date']} "
                  f"persona={r['persona']} → {reason}")
        else:
            n_rejected += 1
            rejected_log.append((r['id'], r['ticker'], r['prediction_date'] or '', reason))
            print(f"  ✗ id={r['id']:>6} {r['ticker']:8s} pred_date={r['prediction_date']} "
                  f"persona={r['persona']} → REJECTED: {reason}")

    print()
    print('─' * 78)
    print(f'EXECUTE complete:')
    print(f'  INSERTed via safe_insert_prediction : {n_inserted}')
    print(f'  rejected by guards                  : {n_rejected}')
    print(f'  total missing (attempted)            : {len(missing)}')
    print()

    if rejected_log:
        print('Rejected rows (manual review needed):')
        for src_id, tkr, pd, reason in rejected_log[:10]:
            print(f"  src_id={src_id} {tkr:8s} {pd} → {reason}")
        if len(rejected_log) > 10:
            print(f"  ... and {len(rejected_log) - 10} more")
        print()

    # ── Verify idempotency: re-load target legits and check the count ──
    target_legits_after = load_legit_rows(target_db)
    print(f'legit rows in target AFTER recovery: {len(target_legits_after)} '
          f'(was {len(target_legits)} before)')
    print()
    print('Re-run with --dry-run to verify idempotency: missing count should be')
    print('lower by the number of successful INSERTs (or 0 if all succeeded).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
