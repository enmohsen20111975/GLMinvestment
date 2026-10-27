# P0 — UNIQUE Constraint Design (Atomic Upsert Guarantee)
> **Status:** Design + test. NOT executed on production.
> **Goal:** Eliminate race condition risk by adding database-level UNIQUE constraint.

## 1. Why UNIQUE is needed

The current UPSERT pattern in `maker_radar.py` does:
1. `SELECT` to check if row exists.
2. `UPDATE` if exists, `INSERT` if not.

Without a UNIQUE constraint, two concurrent runs can both find "row doesn't exist" and both INSERT, creating a duplicate. This is a classic race condition.

A UNIQUE constraint on `(ticker, signal_date, source)` makes the INSERT fail atomically if a row already exists, eliminating the race.

## 2. Production duplicate analysis (from actual audit)

| Key | Duplicates | Extra rows | Root cause |
|---|---|---|---|
| `(ticker, signal_date)` | 10 pairs | 111 | Rename (pre_surge + A_pre_surge same day) |
| `(ticker, signal_date, signal_type)` | **0** | **0** | No true duplicates |
| `(ticker, signal_date, source)` | 10 pairs | 111 | All rows have source='maker_radar' (default) → same as Key 1 |

**Key finding:** `(ticker, signal_date, signal_type)` has ZERO duplicates. This means the proposed UNIQUE key `(ticker, signal_date, source)` would ALSO have zero duplicates IF each (ticker, signal_date) has only ONE source — which is the case on production (all rows are maker_radar).

BUT: the 111 extra rows are from RENAME pairs where the same ticker+date has two different signal_types (e.g., `pre_surge` + `A_pre_surge`). These are NOT duplicates under `(ticker, signal_date, signal_type, source)` — they are legitimate historical data from a naming transition.

## 3. The correct UNIQUE key

**Option A: `(ticker, signal_date, source)`** — too restrictive.
- Problem: blocks maker_radar from recording multiple signal_types for the same ticker on the same day (e.g., A_pre_surge in the morning, B_quiet_accumulation_strong in the afternoon).
- The current UPSERT logic uses `(ticker, signal_date, source)` as the identity — but this assumes only ONE signal per ticker per day per source, which is wrong.

**Option B: `(ticker, signal_date, signal_type, source)`** — correct.
- Allows multiple signal_types per ticker per day per source.
- Blocks exact duplicates (same ticker + date + signal_type + source).
- Production has 0 duplicates under this key → migration is safe.

## 4. Migration plan (safe, additive)

### Step 1: Backup
```bash
sqlite3 db/stocks.db ".backup 'db/backups/stocks.db.bak-unique-TIMESTAMP'"
```

### Step 2: Add UNIQUE index (safe — 0 duplicates exist)
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_unique_owner
ON radar_signal_tracking(ticker, signal_date, signal_type, source);
```

### Step 3: Verify
```sql
-- Should return 0 (no duplicates blocked the index creation):
SELECT ticker, signal_date, signal_type, source, COUNT(*)
FROM radar_signal_tracking
GROUP BY ticker, signal_date, signal_type, source
HAVING COUNT(*) > 1;
```

### Step 4: Update UPSERT logic in maker_radar.py
The current UPSERT does `SELECT id, signal_type WHERE ticker=? AND signal_date=? AND source='maker_radar'`.
This needs to change to `WHERE ticker=? AND signal_date=? AND signal_type=? AND source='maker_radar'` — because with the UNIQUE on (ticker, signal_date, signal_type, source), the identity is the full tuple, not just (ticker, signal_date, source).

**Current (wrong):**
```python
existing = conn.execute(
    "SELECT id, signal_type FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND source='maker_radar'",
    (ticker, scan_date)
).fetchone()
```

**Corrected:**
```python
existing = conn.execute(
    "SELECT id FROM radar_signal_tracking WHERE ticker=? AND signal_date=? AND signal_type=? AND source='maker_radar'",
    (ticker, scan_date, signal_type)
).fetchone()
```

This change means: if signal_type CHANGES (A_pre_surge → B_quiet_accumulation_strong), a NEW row is INSERTed (not UPDATE). The old row stays. This preserves intraday evolution naturally (no need for history table for this case).

Wait — but the history table was designed for exactly this. Let me reconsider.

Actually, the correct design depends on the product decision:
- **Option X:** One row per (ticker, date, signal_type, source). Signal changes = new row. History table tracks transitions.
- **Option Y:** One row per (ticker, date, source). Signal changes = UPDATE same row. History table tracks old signals.

The current code implements Option Y. With UNIQUE on (ticker, signal_date, source), Option Y is enforced at DB level.

But the production data shows 111 pairs where the same (ticker, date, source) has 2 different signal_types — these are the rename pairs. If we add UNIQUE on (ticker, signal_date, source), these 111 rows would BLOCK the index creation.

Wait — let me re-check. The 111 extra rows are:
- (ABUK, 2026-10-07, pre_surge, maker_radar)
- (ABUK, 2026-10-07, A_pre_surge, maker_radar)

Under (ticker, signal_date, source): (ABUK, 2026-10-07, maker_radar) appears TWICE → DUPLICATE.

So Option A `(ticker, signal_date, source)` WOULD be blocked by these 111 rows.

Under (ticker, signal_date, signal_type, source): (ABUK, 2026-10-07, pre_surge, maker_radar) and (ABUK, 2026-10-07, A_pre_surge, maker_radar) are DIFFERENT → no duplicate.

**Conclusion: Use `(ticker, signal_date, signal_type, source)` as the UNIQUE key.**

## 5. Impact on UPSERT logic

With UNIQUE on `(ticker, signal_date, signal_type, source)`:

### Current behavior (Option Y):
1. Check if row exists for (ticker, date, source='maker_radar').
2. If exists AND signal_type changed → log old to history, UPDATE current.
3. If exists AND same signal_type → UPDATE current.
4. If not exists → INSERT.

### New behavior with UNIQUE:
The UNIQUE key is `(ticker, date, signal_type, source)`. If signal_type changes, the INSERT of the new signal_type would NOT conflict (different key). So:

1. Check if row exists for (ticker, date, signal_type, source='maker_radar').
2. If exists (same signal_type) → UPDATE (e.g., entry_price changed).
3. If not exists → INSERT new row (signal_type changed = new row naturally).

This means: signal changes create NEW rows, not UPDATEs. The history table becomes less critical (but still useful for tracking when the change happened via `created_at` timestamps).

### Race condition handling:
With UNIQUE, if two concurrent runs try to INSERT the same (ticker, date, signal_type, source):
- One succeeds.
- The other gets `IntegrityError` → caught → falls back to UPDATE.

```python
try:
    conn.execute("INSERT INTO radar_signal_tracking (...) VALUES (...)")
    inserted += 1
except sqlite3.IntegrityError:
    # Row already exists (race condition or re-run) → UPDATE instead
    conn.execute("UPDATE radar_signal_tracking SET ... WHERE ticker=? AND signal_date=? AND signal_type=? AND source='maker_radar'")
    updated += 1
```

This is the atomic upsert pattern that eliminates the race condition.
