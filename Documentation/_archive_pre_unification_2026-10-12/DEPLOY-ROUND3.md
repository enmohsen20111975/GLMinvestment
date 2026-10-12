# Deployment Runbook — Round 3

**Date:** 2026-10-13
**Scope:** DEV-15 (rebuild DEV-08 from root — price-verified hit timestamps) +
DEV-16 (recover 28 deleted legit predictions) + DEV-17 (this runbook).
**Goal:** Eliminate the fake-hit-timestamp + fake-TARGET_HIT/STOPPED pollution
left by DEV-02 / DEV-08, and restore the 28 V40.2-legit predictions that were
deleted from production during the rogue-cleanup wave.

---

## Pre-Deployment

1. **Backup both DBs** — mandatory before any round-3 migration step:

    ```bash
    cd /path/to/GLMinvestment/db
    cp predictions.db predictions.db.bak.round3
    cp stocks.db      stocks.db.bak.round3
    ```

2. **Pull the latest main:**

    ```bash
    cd /path/to/GLMinvestment
    git pull origin main
    ```

3. **CI gate 1 — no hard DELETE on predictions:**

    ```bash
    python3 scripts/check_no_hard_delete.py
    ```
    → expected: `✅ PASS: 0 active DELETE FROM predictions`

4. **CI gate 2 — no raw INSERT on predictions outside canonical writer:**

    ```bash
    python3 scripts/check_no_raw_insert.py
    ```
    → expected: `✅ PASS: 0 active INSERT INTO predictions outside canonical writers`
    → canonical writer: `vps-service/core/safe_insert_prediction.py`

5. **Pytest — 16 acceptance tests on safe_insert_prediction:**

    ```bash
    cd vps-service
    python3 -m pytest tests/test_safe_insert_prediction.py -v
    ```
    → expected: `16 passed`

---

## Migration

6. **Add the `prev_status` column** (DEV-11 §2 — needed for DEV-15 fake-hit
   conversions to record the prior status, so `restore_archived.py` can revert
   if needed):

    ```bash
    python3 vps-service/scripts/add_prev_status_column.py --dry-run
    python3 vps-service/scripts/add_prev_status_column.py
    ```
    → idempotent: re-running prints `✓ Column 'prev_status' already exists — no-op.`

7. **Install / verify the 3 SQLite triggers** (DEV-13 — already installed in
   Round 2; verify they are still firing):

    ```bash
    python3 vps-service/scripts/apply_guard_triggers.py --dry-run
    python3 vps-service/scripts/apply_guard_triggers.py
    python3 vps-service/scripts/apply_guard_triggers.py --verify
    ```
    → expected: 3 triggers FIRED (trg_prevent_invalid_prices_insert +
    trg_prevent_invalid_prices_update + trg_prevent_wrong_direction)

---

## Cleanup (dry-run first!)

8. **Unified cleanup — dry-run** (DEV-04 — marks rogue predictions as INVALID
   but does NOT delete them; idempotent):

    ```bash
    python3 vps-service/scripts/unified_prediction_cleanup.py --dry-run
    ```
    → review the printed counts: rogue predictions by status + by source
    pattern. Take a screenshot or save the output for the audit trail.

9. **Unified cleanup — execute**:

    ```bash
    python3 vps-service/scripts/unified_prediction_cleanup.py --execute
    ```
    → backup table `predictions_rogue_backup_<ts>` is created inside the DB
    → affected rows get `status='INVALID'` + notes appended
    → idempotent: re-running the dry-run prints `✅ DB is clean.`

---

## Backfill hit timestamps (DEV-15)

10. **Backfill — dry-run** (price-verified — scans `stock_daily_prices` for the
    first candle that crossed the target/stop level):

    ```bash
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    ```
    → review the 3-category report per side:
      - (a) `confirmed_by_prices` — found a candle that crossed the level
      - (b) `no_price_data`     — no `stock_daily_prices` rows between the dates
      - (c) 🚨 `fake_hit`        — had prices but none crossed → will be converted

11. **Backfill — execute**:

    ```bash
    python3 vps-service/scripts/backfill_hit_timestamps.py --execute
    ```
    → backup `db/predictions.bak.dev-15.<UTC-ts>.db` is created automatically
    → confirmed rows: `target_hit_at` / `stop_hit_at` overwritten with the
       actual candle date (idempotent on re-run)
    → 🚨 fake rows converted:
        - `TARGET_HIT` → `closed_win` (if `actual_return > 0`) or `EXPIRED`
        - `STOPPED`    → `EXPIRED`
      with `prev_status` recorded + a `DEV-15-FAKE-*` marker appended to notes

    → idempotent: re-running `--dry-run` afterward should print `0` for both
       scan counts (because converted rows are no longer `TARGET_HIT`/`STOPPED`).

---

## Recover the 28 deleted legit predictions (DEV-16)

12. **Recover — dry-run** (identifies the diff between the local backup DB
    with all 38 legit rows and the production target with only 10 legit
    remaining):

    ```bash
    python3 vps-service/scripts/recover_deleted_legit.py --dry-run \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```
    → review the printed plan: number of missing legit rows to recover,
       sample list (id + ticker + prediction_date + persona + entry/target).

13. **Recover — execute**:

    ```bash
    python3 vps-service/scripts/recover_deleted_legit.py --execute \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```
    → backup `db/predictions.bak.dev-16.<UTC-ts>.db` is created automatically
    → every INSERT goes through `safe_insert_prediction()` (the single
       canonical INSERT site — DEV-12 §1). Rows rejected by the DEV-07 hard
       gate (None / <=0 price) or DEV-12 prediction_write_guard (Rule 35 +
       Rule 21 + Rule 27) or DEV-13 SQLite triggers are logged and skipped.

    → idempotent: re-running `--dry-run` afterward should print
       `✓ Nothing to recover — target already has all legit rows.`

---

## Restart + Verify

14. **Restart the python-backend so the new daily_closer logic takes effect
    for all future closes** (DEV-15 §1 — `datetime.now(timezone.utc)` is
    replaced by a `stock_daily_prices` lookup):

    ```bash
    pm2 restart python-backend
    ```

15. **Verify the active prediction count** — after Round 3, the active set
    should be ~48 (10 already-legit + 28 recovered + new V40.2 predictions
    made since):

    ```bash
    sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE status NOT IN ('INVALID','ARCHIVED');"
    ```
    → expected: ~48 (or higher if new V40.2 predictions were made since the
       backup).

16. **Hit the honest-tracking stats endpoint and verify no placeholders:**

    ```bash
    curl -s https://invest.m2y.net/api/predictions/honest-tracking/stats | jq .
    ```
    → expected: `master_score` distribution has no `50.0` placeholder entries,
       `evidence_count` is `>= 3` for all rows shown, no `kill_filter_result`
       is empty.

17. **Verify idempotency of the whole pipeline** — re-run the dry-run of each
    script in sequence. All of them should report 0 work to do:

    ```bash
    python3 vps-service/scripts/add_prev_status_column.py --dry-run
    python3 vps-service/scripts/apply_guard_triggers.py --dry-run
    python3 vps-service/scripts/unified_prediction_cleanup.py --dry-run
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    python3 vps-service/scripts/recover_deleted_legit.py --dry-run \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```

---

## Rollback (if needed)

If anything goes wrong, the recovery path is:

1. **Restore the converted fake-hit rows** (revert DEV-15 conversions):

    ```bash
    python3 vps-service/scripts/restore_archived.py --dry-run
    python3 vps-service/scripts/restore_archived.py --execute
    ```
    → uses the `prev_status` column (added in step 6) to revert
       `closed_win`/`EXPIRED` → `TARGET_HIT`/`STOPPED`. This handles the
       DEV-15 conversions cleanly because each converted row has
       `prev_status='TARGET_HIT'` or `prev_status='STOPPED'` recorded.

2. **Restore the DB files from the round3 backup** (covers everything else
   — the rogue-cleanup INVALID conversions, the 28 recovered legit rows,
   the trigger installation, the prev_status column):

    ```bash
    cp db/predictions.db.bak.round3 db/predictions.db
    cp db/stocks.db.bak.round3      db/stocks.db
    pm2 restart python-backend
    ```

3. **Verify the rollback** — re-run the idempotency dry-runs from step 17.
   They should report the same state as before Round 3 started.

---

## Audit trail (what to keep)

After a successful Round 3 deployment, retain the following artifacts for the
audit trail (per Rule 27 — NO-FAKE-DATA transparency):

- `db/predictions.db.bak.round3` — pre-round3 state of predictions.db
- `db/stocks.db.bak.round3`      — pre-round3 state of stocks.db
- `db/predictions.bak.dev-15.<UTC-ts>.db` — auto-backup before DEV-15 backfill
- `db/predictions.bak.dev-16.<UTC-ts>.db` — auto-backup before DEV-16 recovery
- `predictions_rogue_backup_<ts>` table inside predictions.db — snapshot of
  the rogue rows that were marked INVALID (DEV-04)
- Output of each `--dry-run` step (saved as a text file in `scripts/output/`)

These artifacts let any future auditor verify:
- which rows were converted from `TARGET_HIT`/`STOPPED` to `closed_win`/`EXPIRED`
- which rows were recovered as new legit predictions
- which rows were marked `INVALID` by the unified cleanup
- the exact `prev_status` of every converted row (so the conversion can be
  reversed deterministically)

---

## References

- `Documentation/00-CONSTITUTION.md` §27 (NO-FAKE-DATA) + §35 (ENGINE-UNIFY)
- `agent-ctx/DEV-08-lead-technical-implementer.md` (the wrong implementation
  being replaced by DEV-15)
- `agent-ctx/DEV-11-14-lead-technical-implementer.md` (DEV-11 prev_status +
  DEV-12 safe_insert_prediction + DEV-13 triggers + DEV-14 CI gates)
- `agent-ctx/DEV-15-17-lead-technical-implementer.md` (this round — full
  work record)
- `vps-service/jobs/daily_closer.py::_mark_closed` (DEV-15 §1 —
  price-aware hit-timestamp writer for future closes)
- `vps-service/scripts/backfill_hit_timestamps.py` (DEV-15 §2 —
  retroactive equivalent for legacy rows)
- `vps-service/scripts/recover_deleted_legit.py` (DEV-16 —
  recover 28 deleted legit predictions)
- `vps-service/scripts/restore_archived.py` (DEV-11 §5 — rollback path)
