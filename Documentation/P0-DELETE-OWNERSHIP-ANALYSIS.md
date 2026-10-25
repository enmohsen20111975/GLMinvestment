# Radar Signal Tracking — Ownership Analysis & Fix Design
> **Date:** 2026-10-25 (post-recovery).
> **Source:** Production audit + code inspection (HEAD `61c44f8`).
> **Scope:** Complete inventory of writers + comparison of fix options + test design.

---

## 1. Complete writer inventory

Every file that performs INSERT/UPDATE/DELETE on `radar_signal_tracking`, with the exact operation and signal_types it owns.

### INSERT writers (3 total)

| # | File | Line | signal_type written | Owner? | Notes |
|---|---|---|---|---|---|
| W1 | `scripts/maker_radar.py` | 799 | `path or 'unknown'` where path ∈ {A_pre_surge, B_quiet_accumulation_strong, C_quiet_accumulation_weak, D_explosive_surge, E_early_break, distribution, unknown} | **maker_radar** | Bulk INSERT after DELETE (line 752). Loops over `under_microscope` list. |
| W2 | `vps-service/camp/state_history_tracker.py` | 138 | `'canonical_state'` (literal string, hardcoded) | **state_history_tracker** | INSERT OR REPLACE (no UNIQUE → inserts duplicate). NOT run on production (no cron). |
| W3 | `src/modules/radar/lib/radar-signal-tracker.ts` | 152 | `input.signal_type` ∈ VALID_SIGNAL_TYPES = {explosive_surge, quiet_accumulation_strong, quiet_accumulation_weak, pre_surge, early_break} | **frontend/admin** | Has dedup check (SELECT before INSERT). Called from admin API routes. |

### UPDATE writers (4 total)

| # | File | Line | Columns updated | Owner? | Notes |
|---|---|---|---|---|---|
| U1 | `src/app/api/maker-radar/signal-tracker/verify/route.ts` | 262 | outcome_7d, outcome_14d, outcome_30d, max_price_after, min_price_after, status, verified_at | **verification** | Updates by `id` (PK-scoped). Safe. |
| U2 | `scripts/backfill_stale_radar_signals.py` | 179, 215, 233 | status, data_date, data_quality, staleness_days, price_source, daily_price, live_price, reason | **maintenance** | Updates by `id` (PK-scoped). Marks stale data. |
| U3 | `scripts/radar_accuracy_report.py` | 315 | outcome_7d, outcome_14d, outcome_30d, status | **reporting** | Updates by `id` (PK-scoped). Sets verification status. |
| U4 | `scripts/verify_radar_signals.py` | 178 | (dynamic — outcome_*, status, verified_at) | **verification** | Updates by `id` (PK-scoped). General-purpose verifier. |

### DELETE writers (1 total)

| # | File | Line | WHERE clause | Owner? | Notes |
|---|---|---|---|---|---|
| D1 | `scripts/maker_radar.py` | 752 | `signal_date = ?` (no scope by signal_type/path/owner) | **maker_radar** | **THE VIOLATION** — wipes ALL rows for the date, including rows owned by W2, W3, and rows already UPDATEd by U1-U4. |

---

## 2. Signal-type ownership matrix

| signal_type | Written by | Updated by | Deleted by | Owner |
|---|---|---|---|---|
| `A_pre_surge` | W1 (maker_radar) | U1-U4 | D1 (maker_radar) | maker_radar |
| `B_quiet_accumulation_strong` | W1 | U1-U4 | D1 | maker_radar |
| `C_quiet_accumulation_weak` | W1 | U1-U4 | D1 | maker_radar |
| `D_explosive_surge` | W1 | U1-U4 | D1 | maker_radar |
| `E_early_break` | W1 | U1-U4 | D1 | maker_radar |
| `distribution` | W1 (as path) | U1-U4 | D1 | maker_radar |
| `unknown` | W1 (fallback) | U1-U4 | D1 | maker_radar |
| `pre_surge` (legacy) | W1 (old name) + W3 (frontend) | U1-U4 | D1 | shared (maker_radar legacy + frontend) |
| `quiet_accumulation_strong` (legacy) | W1 (old name) + W3 (frontend) | U1-U4 | D1 | shared |
| `explosive_surge` (legacy) | W1 (old name) + W3 (frontend) | U1-U4 | D1 | shared |
| `quiet_accumulation_weak` | W3 (frontend) | U1-U4 | D1 | frontend |
| `early_break` | W3 (frontend) | U1-U4 | D1 | frontend |
| `canonical_state` | W2 (state_history_tracker) | — | D1 (if activated) | state_history_tracker |

**Key findings:**
1. **maker_radar owns 7 signal_types** (the A/B/C/D/E prefix names + distribution + unknown).
2. **frontend owns 5 signal_types** (the legacy non-prefixed names + quiet_accumulation_weak + early_break).
3. **state_history_tracker owns 1 signal_type** (`canonical_state`).
4. **The DELETE (D1) wipes ALL of them** — including signal_types it doesn't own.

---

## 3. Fix option comparison

### Option 1: Static list of radar-owned signal_types

**Implementation:**
```python
RADAR_OWNED_SIGNAL_TYPES = (
    'A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak',
    'D_explosive_surge', 'E_early_break', 'distribution', 'unknown',
    # legacy names (for backward compat):
    'pre_surge', 'quiet_accumulation_strong', 'explosive_surge',
)
placeholders = ','.join(['?'] * len(RADAR_OWNED_SIGNAL_TYPES))
conn.execute(
    f"DELETE FROM radar_signal_tracking WHERE signal_date = ? AND signal_type IN ({placeholders})",
    [scan_date] + list(RADAR_OWNED_SIGNAL_TYPES)
)
```

**Pros:**
- Minimal change (1 line → 5 lines).
- No schema migration.
- Backward compatible (includes legacy names).

**Cons:**
- Static list — must be updated when new signal_types are added.
- Does not distinguish maker_radar's legacy `pre_surge` from frontend's `pre_surge` (same name, different owner).
- Does not prevent frontend from being wiped (frontend's `quiet_accumulation_weak` is NOT in the list, so it survives — but frontend's `pre_surge` IS in the list, so it gets wiped).

**Legacy rows impact:** Old rows with legacy names (`pre_surge`, `quiet_accumulation_strong`, `explosive_surge`) will be deleted if they match the date. This is the current behavior, so no regression.

**Reader compatibility:** All readers (U1-U4) read by `id` or by signal_type — no change needed.

---

### Option 2: `source` column (explicit ownership)

**Implementation:**

Step 1: Add column (safe, additive):
```sql
ALTER TABLE radar_signal_tracking ADD COLUMN source TEXT DEFAULT 'maker_radar';
```

Step 2: Update existing rows (one-time migration):
```sql
-- All existing rows get 'maker_radar' (they were all written by maker_radar on production)
UPDATE radar_signal_tracking SET source = 'maker_radar' WHERE source IS NULL;
-- canonical_state rows (if any exist after future activation) get 'state_history_tracker'
UPDATE radar_signal_tracking SET source = 'state_history_tracker' WHERE signal_type = 'canonical_state';
-- Frontend-written rows get 'frontend' — but we can't distinguish them from maker_radar rows with the same signal_type name.
```

Step 3: Update writers to set `source`:
- `maker_radar.py:799` — add `source='maker_radar'` to INSERT.
- `state_history_tracker.py:138` — add `source='state_history_tracker'`.
- `radar-signal-tracker.ts:152` — add `source='frontend'`.

Step 4: Scope DELETE:
```python
conn.execute(
    "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND source = 'maker_radar'",
    (scan_date,)
)
```

**Pros:**
- Explicit ownership — no ambiguity.
- Scalable — new writers just set their `source`.
- DELETE is clean and unambiguous.
- Distinguishes maker_radar's `pre_surge` from frontend's `pre_surge`.

**Cons:**
- Schema migration (additive — safe, but needs backup).
- Cannot retroactively distinguish existing rows (all existing rows get `source='maker_radar'` as default, even if some were written by frontend — but production audit shows 0 frontend rows, so this is not an issue on production).
- All 3 INSERT writers must be updated to set `source`.

**Legacy rows impact:** All existing rows get `source='maker_radar'` (default). This is correct for production (no frontend rows exist). The migration is safe.

**Reader compatibility:** All readers (U1-U4) read by `id` — no change needed. They don't care about `source`.

---

## 4. Recommendation

**Option 2 (`source` column) is recommended** for the following reasons:

1. **Owner's objection to static lists is valid** — a new signal_type added in the future would be silently wiped by the static list approach.
2. **The frontend/maker_radar signal_type name collision** (both write `pre_surge`) cannot be resolved by a static list — only by `source`.
3. **The migration is safe** — additive column, default value, no data loss.
4. **Production has 0 frontend rows** — so the retroactive `source='maker_radar'` default is correct for all existing rows.
5. **Future-proofs** for canonical_state activation and any new writers.

**Option 1 is acceptable as a temporary stopgap** if the owner wants to fix the DELETE immediately without waiting for migration approval. But it should be replaced with Option 2 before any new writer is added.

---

## 5. Test design — proves the fix works

The existing tests (`test_radar_ownership_phase2.py`, `test_radar_delete_impact_phase2.py`) test the CONCEPT but use sandbox data. The owner asked for tests that "prove that deleting radar records does not touch any other component's records, and that re-running the task does not lose evolution history or verification updates."

### Required tests (to be written after owner approves Option 2)

#### Test A: DELETE does not wipe non-maker_radar rows
**Setup:** Insert rows with `source='maker_radar'`, `source='state_history_tracker'`, `source='frontend'` for the same date.
**Action:** Run the scoped DELETE (`WHERE signal_date=? AND source='maker_radar'`).
**Assert:**
- `source='maker_radar'` rows → deleted.
- `source='state_history_tracker'` rows → survive.
- `source='frontend'` rows → survive.

#### Test B: Re-running maker_radar does not lose verification updates
**Setup:** Insert a `source='maker_radar'` row. Simulate `verify_radar_signals.py` UPDATE (set `outcome_7d`, `verified_at`).
**Action:** Re-run maker_radar (DELETE + INSERT) for the same date.
**Assert:**
- The OLD row (with verification) is deleted.
- A NEW row is inserted (without verification).
- **This is the current behavior** — verification is lost on re-run.
- **To preserve verification, the fix should UPDATE existing rows instead of DELETE+INSERT.** This is a separate design decision (see §6).

#### Test C: Re-running maker_radar does not create duplicates
**Setup:** Insert a `source='maker_radar'` row for (ticker, date, signal_type).
**Action:** Re-run maker_radar (DELETE scoped + INSERT) for the same date.
**Assert:**
- Only 1 row exists for (ticker, date, signal_type, source='maker_radar') after re-run.
- No duplicates.

#### Test D: Intraday evolution history
**Setup:** Run maker_radar at 10:00 (inserts row A). Run maker_radar at 10:05 (DELETEs row A, inserts row B).
**Assert (current behavior):**
- Only row B exists (row A was deleted).
- **This is the current behavior** — intraday evolution is lost.
- **To preserve evolution, the fix should NOT DELETE previous same-day rows.** This is a separate design decision (see §6).

---

## 6. Open design questions (need owner decision)

The scoped DELETE (Option 2) fixes the **ownership violation** but does NOT address:

### Q1: Should maker_radar preserve intraday evolution?
- **Current:** Every 5-min run wipes the previous run's data.
- **Alternative:** Keep all intraday runs (append-only) — but then the table grows 72x faster.
- **Alternative:** Keep only the first and last run of the day.
- **Decision needed from owner.**

### Q2: Should maker_radar preserve verification updates?
- **Current:** If `verify_radar_signals.py` runs at 13:00 and updates `outcome_7d`, then maker_radar runs at 13:05 and deletes the row, the verification is lost.
- **Alternative:** maker_radar should UPDATE existing rows (not DELETE+INSERT) if a row with the same (ticker, date, signal_type) already exists.
- **Decision needed from owner.**

### Q3: Should the 111 legacy rename duplicates be cleaned up?
- **Current:** 111 rows with paired names (`pre_surge` + `A_pre_surge` for same ticker+date).
- **These are not V2 duplicates** — they are rename artifacts from 2026-10-07.
- **Decision needed from owner:** keep as historical, or clean up?

---

## 7. What this analysis does NOT do

- Does not execute any fix (awaiting owner approval).
- Does not modify production data.
- Does not modify schema (the `source` column proposal is a design, not a migration).
- Does not prove the fix improves prediction quality (that's a separate question).

---

## 8. Next action

**Owner decision required:**
1. Approve Option 2 (`source` column) as the fix approach?
2. Decide Q1 (intraday evolution: keep/wipe/keep-first-and-last)?
3. Decide Q2 (verification preservation: UPDATE vs DELETE+INSERT)?
4. Decide Q3 (legacy duplicate cleanup: keep/remove)?

**After approval, Bravo will:**
1. Write the migration script (additive `source` column + backfill).
2. Update the 3 INSERT writers to set `source`.
3. Update the DELETE to scope by `source`.
4. Write the 4 tests (A, B, C, D).
5. Test on isolated copy of production DB.
6. Submit for owner review before any production deployment.
