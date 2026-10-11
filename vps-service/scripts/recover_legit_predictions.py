#!/usr/bin/env python3
"""
Recover Legit Predictions (DEV-05 — DUAL-TRACK)
=================================================

Identifies and validates legit V40.2 predictions as Golden Reference Records.
These are predictions that pass ALL quality checks:
  - evidence_count >= 3 (V40.2 evidence pipeline ran)
  - kill_filter_result non-empty (V40.2 kill filters ran)
  - kill_filter_result starts with 'V40 evidence=' or 'INTRADAY-5M'
  - entry_price > 0 and target_price > 0 and stop_loss > 0
  - For BUY: target > entry, stop < entry
  - master_score is not 50.0 (placeholder)
  - risk_reward > 0

This script does NOT modify the database. It only reports + validates.

Usage:
    python3 vps-service/scripts/recover_legit_predictions.py

Rule 35 (ENGINE-UNIFY): V40.2 is the only sanctioned writer.
Rule 27 (NO-FAKE-DATA): Only validated predictions are legit.
"""
import sqlite3
import sys
import os
from pathlib import Path

DB_PATH = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')


def main():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] DB not found: {DB_PATH}")
        sys.exit(1)

    print("=" * 70)
    print("RECOVER LEGIT PREDICTIONS (DEV-05 — DUAL-TRACK)")
    print("Golden Reference Records Validation")
    print("=" * 70)
    print(f"DB: {DB_PATH}")
    print()

    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ── STEP 1: Find all candidates (evidence>=3 + kill_filter non-empty) ──
    candidates = cur.execute("""
        SELECT id, ticker, signal, persona, market, prediction_date,
               entry_price, target_price, stop_loss, target_price_2,
               risk_reward, evidence_count, kill_filter_result,
               technical_score, master_score, status,
               outcome_date, exit_price, actual_return, hit_target, hit_stop,
               exit_type, holding_days
        FROM predictions
        WHERE evidence_count >= 3
          AND kill_filter_result IS NOT NULL
          AND kill_filter_result != ''
          AND status != 'INVALID'
        ORDER BY prediction_date DESC
    """).fetchall()

    print(f"Candidates (evidence>=3 + kill_filter non-empty + not INVALID): {len(candidates)}")
    print()

    # ── STEP 2: Validate each candidate ──────────────────────────────────
    golden = []
    rejected = []

    for r in candidates:
        issues = []

        # Check 1: kill_filter starts with V40 evidence= or INTRADAY-5M
        kf = r['kill_filter_result'] or ''
        if not (kf.startswith('V40 evidence=') or kf.startswith('INTRADAY-5M')):
            issues.append(f"kill_filter doesn't start with V40/INTRADAY signature: '{kf[:50]}'")

        # Check 2: entry_price > 0
        entry = float(r['entry_price'] or 0)
        if entry <= 0:
            issues.append(f"entry_price <= 0: {entry}")

        # Check 3: target_price > 0
        target = float(r['target_price'] or 0)
        if target <= 0:
            issues.append(f"target_price <= 0: {target}")

        # Check 4: stop_loss > 0
        stop = float(r['stop_loss'] or 0)
        if stop <= 0:
            issues.append(f"stop_loss <= 0: {stop}")

        # Check 5: Direction (BUY: target > entry, stop < entry)
        sig = (r['signal'] or '').upper()
        if sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
            if entry > 0 and target > 0 and target <= entry:
                issues.append(f"BUY: target ({target}) <= entry ({entry})")
            if entry > 0 and stop > 0 and stop >= entry:
                issues.append(f"BUY: stop ({stop}) >= entry ({entry})")

        # Check 6: master_score not 50.0 (placeholder)
        score = r['master_score']
        if score is not None:
            try:
                if abs(float(score) - 50.0) < 0.01:
                    issues.append(f"master_score = 50.0 (placeholder)")
            except (TypeError, ValueError):
                issues.append(f"master_score invalid: {score}")

        # Check 7: risk_reward > 0 (if set)
        rr = r['risk_reward']
        if rr is not None:
            try:
                if float(rr) <= 0:
                    issues.append(f"risk_reward <= 0: {rr}")
            except (TypeError, ValueError):
                pass

        if issues:
            rejected.append((r, issues))
        else:
            golden.append(r)

    # ── STEP 3: Report ───────────────────────────────────────────────────
    print(f"{'=' * 70}")
    print(f"GOLDEN REFERENCE RECORDS (fully validated): {len(golden)}")
    print(f"{'=' * 70}")
    for r in golden:
        print(f"  id={r['id']:>6} {r['ticker']:8s} {r['signal']:12s} "
              f"entry={r['entry_price']:>10} target={r['target_price']:>10} stop={r['stop_loss']:>10} "
              f"R:R={r['risk_reward']:>5} ev={r['evidence_count']} "
              f"score={r['master_score']} status={r['status']}")
        print(f"    kill_filter: {r['kill_filter_result'][:80]}")

    print(f"\n{'=' * 70}")
    print(f"REJECTED (failed validation): {len(rejected)}")
    print(f"{'=' * 70}")
    for r, issues in rejected:
        print(f"  id={r['id']:>6} {r['ticker']:8s} {r['signal']:12s} — REJECTED:")
        for issue in issues:
            print(f"    ❌ {issue}")

    print(f"\n{'=' * 70}")
    print("SUMMARY")
    print(f"{'=' * 70}")
    print(f"  Total candidates:  {len(candidates)}")
    print(f"  Golden (valid):    {len(golden)}")
    print(f"  Rejected:          {len(rejected)}")
    print()
    print("Golden records are the ONLY predictions that should appear")
    print("in honest-tracking stats, league-report, and user-facing displays.")
    print("All others should be status='INVALID' (cleaned by unified_prediction_cleanup.py).")
    print()
    print("✅ No database changes made — read-only validation.")

    conn.close()


if __name__ == '__main__':
    main()
