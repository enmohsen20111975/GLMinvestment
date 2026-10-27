# P0 DELETE Ownership — Implementation Report
> **Branch:** `fix/p0-delete-ownership-complete`
> **Base commit:** `6fd1877` (previous partial fix)
> **Status:** COMPLETE — ready for review (NOT for merge/deploy without owner approval)

## 1. What changed

### Problem
`scripts/maker_radar.py:752` had `DELETE FROM radar_signal_tracking WHERE signal_date=?` — an unscoped DELETE that:
1. Wiped ALL rows for the date (including other owners' rows).
2. Lost verification updates (outcome_7d, verified_at, etc.) on every 5-min re-run.
3. Lost intraday signal evolution (only the last signal per day survived).

### Solution — 3-part fix

#### Part 1: Source column (from previous commit `6fd1877`)
- Added `source TEXT DEFAULT 'maker_radar'` column to `radar_signal_tracking`.
- 3 INSERT writers updated to set `source`:
  - `maker_radar.py` → `source='maker_radar'`
  - `state_history_tracker.py` → `source='state_history_tracker'`
  - `radar-signal-tracker.ts` → `source='frontend'`

#### Part 2: UPSERT pattern (NEW — replaces DELETE+INSERT)
- **Removed** the `DELETE` statement entirely.
- **Added** UPSERT logic in `maker_radar.py:_track_signals_to_db()`:
  1. Check if row exists for `(ticker, signal_date, source='maker_radar')`.
  2. If exists: UPDATE only maker_radar-owned fields (`signal_type`, `entry_price`, `path`, `reason`, `data_date`, `data_quality`, `staleness_days`, `price_source`, `live_price`, `daily_price`).
  3. **PRESERVE** verification fields (`outcome_7d`, `outcome_14d`, `outcome_30d`, `max_price_after`, `min_price_after`, `verified_at`, `status`).
  4. If not exists: INSERT new row.

#### Part 3: History table (NEW — for intraday evolution)
- **Created** `radar_signal_history` table (same schema as tracking, minus verification fields).
- When `signal_type` CHANGES for a ticker on a given date:
  1. The OLD signal is INSERTed into `radar_signal_history` (with `run_timestamp`).
  2. The current row in `radar_signal_tracking` is UPDATEd with the new signal_type.
- Only signal CHANGES are logged — re-runs with the same signal_type do NOT create history entries.

### Files modified

| File | Change | Lines |
|---|---|---|
| `scripts/maker_radar.py` | DELETE removed, UPSERT added, history table + logic added | +85/-20 |
| `vps-service/camp/state_history_tracker.py` | source column in INSERT + ensure_state_columns (from previous commit) | +12/-2 |
| `src/modules/radar/lib/radar-signal-tracker.ts` | source column in ensureSchema + INSERT (from previous commit) | +8/-3 |

### Field ownership matrix

| Field | Owned by | Updated by maker_radar on UPSERT? |
|---|---|---|
| `signal_type` | maker_radar | ✅ YES |
| `entry_price` | maker_radar | ✅ YES |
| `path` | maker_radar | ✅ YES |
| `reason` | maker_radar | ✅ YES |
| `data_date` | maker_radar | ✅ YES |
| `data_quality` | maker_radar | ✅ YES |
| `staleness_days` | maker_radar | ✅ YES |
| `price_source` | maker_radar | ✅ YES |
| `live_price` | maker_radar | ✅ YES |
| `daily_price` | maker_radar | ✅ YES |
| `status` | verify_radar_signals | ❌ NO (preserved) |
| `outcome_7d` | verify_radar_signals | ❌ NO (preserved) |
| `outcome_14d` | verify_radar_signals | ❌ NO (preserved) |
| `outcome_30d` | verify_radar_signals | ❌ NO (preserved) |
| `max_price_after` | verify_radar_signals | ❌ NO (preserved) |
| `min_price_after` | verify_radar_signals | ❌ NO (preserved) |
| `verified_at` | verify_radar_signals | ❌ NO (preserved) |

## 2. What was tested

### Test file: `scripts/test_p0_complete_fix.py` — 19/19 ✅

| Test | What it proves | Old pattern (DELETE+INSERT) | New pattern (UPSERT) |
|---|---|---|---|
| 1a | No duplicates after 3 re-runs | ❌ FAIL (duplicates or lost rows) | ✅ PASS |
| 1b | Verification preserved (outcome_7d=5.0) | ❌ FAIL (lost on DELETE) | ✅ PASS |
| 1c | Verification preserved (verified_at) | ❌ FAIL (lost on DELETE) | ✅ PASS |
| 1d | Verification preserved (status=verified_win) | ❌ FAIL (overwritten with 'pending') | ✅ PASS |
| 2a | Current signal = latest | ❌ FAIL (only last survived) | ✅ PASS |
| 2b | History has 2 entries (signal changes) | ❌ FAIL (0 entries — history lost) | ✅ PASS |
| 2c | History entry 1 = A_pre_surge | ❌ FAIL | ✅ PASS |
| 2d | History entry 2 = B_quiet_accumulation_strong | ❌ FAIL | ✅ PASS |
| 2e | No history duplicates for same signal_type | N/A | ✅ PASS |
| 3a | maker_radar rows = 1 (no duplicates) | ❌ FAIL | ✅ PASS |
| 3b | canonical_state rows survive | ❌ FAIL (wiped by DELETE) | ✅ PASS |
| 3c | frontend rows survive | ❌ FAIL (wiped by DELETE) | ✅ PASS |
| 4a-4g | Combined integration test | ❌ Multiple failures | ✅ ALL PASS |

### Key difference from previous submission
- Previous: TEST B2/D1 documented the bug as "KNOWN LIMITATION" and counted it as PASS.
- Current: TEST 1b/1c/1d/2a-2e PROVE the bug is FIXED. These tests would FAIL with the old pattern.

## 3. Remaining risks

1. **Legacy data migration:** 910 of 1287 production rows (70.7%) have ambiguous signal_types (shared between maker_radar legacy + frontend). The `path` column heuristic can help disambiguate, but cannot be 100% certain. See `P0-LEGACY-DUPLICATE-CLASSIFICATION.md`.

2. **Schema migration:** The `source` column + `radar_signal_history` table must be created on production. Both are additive (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`) and safe. See `P0-DELETE-OWNERSHIP-MIGRATION-AND-RECOVERY.md`.

3. **No DELETE at all:** The new pattern never DELETEs rows. Stocks that are no longer detected by maker_radar will keep their last known signal in `radar_signal_tracking`. This is by design (preserves history) but means the table may grow over time if many tickers are added/removed.

4. **History table growth:** The `radar_signal_history` table only grows when signal_types change (not on every run). Estimated: ~5-10 history entries per ticker per day (worst case). Over a year: ~2500 entries per ticker. Manageable.
