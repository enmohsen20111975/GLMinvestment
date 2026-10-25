# P0 Analysis — `maker_radar.py:752` Unscoped DELETE Impact
> **Date:** 2026-10-25 (post-recovery analysis).
> **Source:** Production audit `upload/db_audit_20261025_124944.txt` + code inspection.
> **Scope:** What does the DELETE actually wipe on production?

## The exact SQL (file:line confirmed)

```python
# scripts/maker_radar.py:752
conn.execute("DELETE FROM radar_signal_tracking WHERE signal_date = ?", (scan_date,))
```

- **Table affected:** `stocks.db.radar_signal_tracking` (only this one — single-table DELETE).
- **WHERE clause:** `signal_date = ?` (only the date, no ticker/signal_type/path/scope filter).
- **Parameter:** `scan_date` = today's date (passed from CLI `--today` or default `datetime.now()`).

## What the DELETE wipes (per run)

**ALL rows in `radar_signal_tracking` where `signal_date = scan_date`, regardless of:**
- `signal_type` (would wipe canonical_state rows IF they existed — but they don't on production).
- `path` (would wipe frontend/manual picks IF they set path).
- `status` (would wipe verified/assessed/pending rows alike).
- `data_quality` (would wipe fresh/stale/very_stale rows alike).

## Production data state (from audit)

| Aspect | Production value |
|---|---|
| Total rows | 1287 |
| signal_type values | `quiet_accumulation_strong` (523), `pre_surge` (382), `A_pre_surge` (238), `B_quiet_accumulation_strong` (111), `D_explosive_surge` (14), `disqualified_illiquid` (14), `explosive_surge` (5) |
| canonical_state rows | **0** (column does not exist) |
| Frontend/manual picks | **0** (no rows with `signal_type` outside the 7 radar types above) |
| Verification rows | Likely present (UPDATEs from `verify_radar_signals.py`) — but the DELETE removes the whole row, not just the verification fields |

## Cron execution frequency

```cron
*/5 8-14 * * 0-4 cd /home/meme/my_apps/GLMinvestment && .venv/bin/python scripts/maker_radar.py --market EGX --min-quiet-signals 5 --min-price 1.0 --json-only
```

- **Frequency:** every 5 minutes, 08:00-14:00 UTC, Sun-Thu.
- **Per trading day:** ~72 runs (6 hours × 12/hour).
- **Per run:** wipes ALL rows for `signal_date=today`, then re-inserts current `under_microscope` picks.

## What the DELETE actually destroys per run

Since production has **NO canonical_state rows** and **NO frontend picks** (per audit signal_type distribution), the DELETE currently:

1. **Wipes today's radar history** — every 5 minutes, the previous 5-minute radar picks are deleted before the new ones are inserted. This means:
   - You CANNOT track how a stock's radar signal evolved during the day (e.g., did it start as `pre_surge` at 10:00 then become `quiet_accumulation_strong` at 12:00?).
   - The DB only keeps the LAST radar snapshot per day (the final run at 14:00).
2. **Wipes any verification fields** — if `verify_radar_signals.py` or `backfill_stale_radar_signals.py` ran earlier in the day and UPDATEd rows with `outcome_7d`/`verified_at`, those updates are lost when the row is deleted.
3. **Wipes historical intraday signals** — if a stock was a `pre_surge` at 10:00 but not at 14:00, the morning signal is gone.

## What the DELETE does NOT destroy (current production state)

- **canonical_state rows** — none exist (column missing).
- **Frontend manual picks** — none exist (no such signal_type in production).
- **Other tables** — DELETE is scoped to `radar_signal_tracking` only.

## Severity reassessment

**Original V1 claim:** "wipes canonical_state + frontend picks".

**Production reality:** The DELETE is less severe than originally claimed BECAUSE canonical_state and frontend picks don't exist on production. However, it is STILL harmful because:

1. **Intraday radar history is lost** — only the last snapshot survives.
2. **Verification data is lost** — `outcome_7d`, `verified_at`, etc. from earlier same-day runs are wiped.
3. **If canonical_state OR frontend picks are EVER activated**, they WILL be wiped 72x/day.

## The duplicate rows (111 extra) — different root cause

The audit shows 111 extra rows under `(ticker, signal_date)` but **0 extra under `(ticker, signal_date, signal_type)`**. This means:

- The duplicates are pairs like `(ABUK, 2026-10-07, pre_surge)` + `(ABUK, 2026-10-07, A_pre_surge)` — same ticker+date, DIFFERENT signal_type.
- This is the **rename issue** (V7 in original report): `pre_surge` → `A_pre_surge` happened on 2026-10-07, and the same day's run created both names.
- **NOT the INSERT OR REPLACE issue (V2)** — V2 doesn't exist on production.

## Conclusion

The DELETE is **real and runs 72x/day**, but its current production impact is limited to:
1. Loss of intraday radar evolution history.
2. Loss of same-day verification updates.

It does NOT currently wipe canonical_state (doesn't exist) or frontend picks (don't exist).

**However**, the unscoped DELETE is still a **design violation**: a component should only delete rows it owns. `maker_radar.py` owns radar-path rows (7 signal_types), but the DELETE wipes ALL signal_types.

## Recommended fix (deferred — needs owner approval)

```python
# CURRENT (scripts/maker_radar.py:752):
conn.execute("DELETE FROM radar_signal_tracking WHERE signal_date = ?", (scan_date,))

# PROPOSED FIX — scope to radar-owned signal_types only:
RADAR_OWNED_SIGNAL_TYPES = (
    'pre_surge', 'A_pre_surge',
    'quiet_accumulation_strong', 'B_quiet_accumulation_strong',
    'explosive_surge', 'D_explosive_surge',
    'disqualified_illiquid',
)
placeholders = ','.join(['?'] * len(RADAR_OWNED_SIGNAL_TYPES))
conn.execute(
    f"DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type IN ({placeholders})",
    [scan_date] + list(RADAR_OWNED_SIGNAL_TYPES)
)
```

**Trade-off:** This is a static list (owner previously objected to static lists). Alternative: add a `source` column (schema change — needs migration).

**This fix does NOT touch canonical_state** — because canonical_state doesn't exist on production, it doesn't need protection right now. But the design should still be correct for future.

## What this analysis does NOT resolve

- Whether `maker_radar.py` should preserve intraday history (every 5-min snapshot) vs. only the final daily summary.
- Whether verification data (from `verify_radar_signals.py`) should survive the radar re-run.
- Whether the rename duplicates (111 rows) should be cleaned up.

These are **product decisions** for the owner, not engineering decisions.
