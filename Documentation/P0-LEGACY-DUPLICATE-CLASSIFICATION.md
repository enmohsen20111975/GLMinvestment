# P0 — Legacy Duplicate Classification
> **Source:** Production audit `upload/db_audit_20261025_124944.txt`.
> **Date:** 2026-10-25.
> **Scope:** Classification of existing 1287 rows in `radar_signal_tracking` for `source` column backfill.

## 1. Production signal_type distribution

| signal_type | Rows | Written by | Confidence |
|---|---|---|---|
| `quiet_accumulation_strong` | 523 | maker_radar (legacy name) + frontend | 🟡 AMBIGUOUS |
| `pre_surge` | 382 | maker_radar (legacy name) + frontend | 🟡 AMBIGUOUS |
| `A_pre_surge` | 238 | maker_radar (new name) | ✅ CONFIDENT |
| `B_quiet_accumulation_strong` | 111 | maker_radar (new name) | ✅ CONFIDENT |
| `D_explosive_surge` | 14 | maker_radar (new name) | ✅ CONFIDENT |
| `disqualified_illiquid` | 14 | maker_radar | ✅ CONFIDENT |
| `explosive_surge` | 5 | maker_radar (legacy name) + frontend | 🟡 AMBIGUOUS |
| **Total** | **1287** | | |

## 2. Classification summary

| Category | Rows | % | Action |
|---|---|---|---|
| Confident maker_radar | 377 | 29.3% | Set `source='maker_radar'` |
| Ambiguous (shared signal_type names) | 910 | 70.7% | Use `path` heuristic (see §3) |
| Total | 1287 | 100% | |

## 3. Disambiguation heuristic for ambiguous rows

The `path` column can help distinguish:

### maker_radar pattern (from `scripts/maker_radar.py:760-765`):
```python
path = stock.get('path', '')  # always a non-empty string (A_pre_surge, etc.)
signal_type = path or 'unknown'
```
→ maker_radar **always** sets `path` to a non-null value.

### Frontend pattern (from `src/modules/radar/lib/radar-signal-tracker.ts:156`):
```typescript
.run(ticker, signalDate, input.signal_type, input.entry_price, input.path ?? null, ...)
```
→ Frontend sets `path` to `input.path ?? null` — could be `null`.

### Heuristic:
- If `path IS NOT NULL` → likely maker_radar → set `source='maker_radar'`.
- If `path IS NULL` → likely frontend → set `source='frontend'`.
- If `path IS NULL AND signal_type='disqualified_illiquid'` → maker_radar (frontend doesn't write this type).

### Limitations:
1. This is a **heuristic**, not proof. A frontend user could have passed a non-null path.
2. We cannot verify without checking the actual `path` values on production (the audit didn't capture this detail).
3. For 100% certainty, the owner should run a query on production:
   ```sql
   SELECT signal_type, path IS NOT NULL as has_path, COUNT(*)
   FROM radar_signal_tracking
   WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
   GROUP BY signal_type, has_path
   ORDER BY signal_type, has_path;
   ```

## 4. Duplicate rows (from audit)

### Key 1: (ticker, signal_date) — 10 pairs, 111 extra rows
These are **rename duplicates** (not INSERT OR REPLACE duplicates):
- `ABUK 2026-10-07`: `pre_surge` + `A_pre_surge` (same ticker, same date, different signal_type names).
- Same pattern for ACAMD, ACGC, ADCI, AFMC, etc.

### Key 2: (ticker, signal_date, signal_type) — 0 duplicates, 0 extra rows
**No true duplicates.** The 111 extra rows are all from rename pairs (same ticker+date, different signal_type).

### Root cause:
On 2026-10-07, the signal_type naming changed from `pre_surge` → `A_pre_surge` (etc.). The same day's radar run created rows with BOTH names (old code + new code ran in transition).

## 5. Recommended backfill SQL

```sql
-- Step 1: Confident maker_radar rows (377 rows)
UPDATE radar_signal_tracking
SET source = 'maker_radar'
WHERE signal_type IN (
    'A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak',
    'D_explosive_surge', 'E_early_break', 'disqualified_illiquid'
);

-- Step 2: Ambiguous rows — use path heuristic
-- maker_radar sets path = signal_type (non-null)
UPDATE radar_signal_tracking
SET source = 'maker_radar'
WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
  AND path IS NOT NULL;

-- frontend sets path = null
UPDATE radar_signal_tracking
SET source = 'frontend'
WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
  AND path IS NULL;

-- Step 3: Verify
SELECT source, COUNT(*) FROM radar_signal_tracking GROUP BY source;
-- Expected: mostly 'maker_radar' (since production has 0 frontend rows per audit signal_type distribution).
```

## 6. What NOT to do

- ❌ **Do NOT** blindly set all rows to `source='maker_radar'` without checking `path`.
- ❌ **Do NOT** delete the 111 rename duplicate rows — they are historical data from a naming transition.
- ❌ **Do NOT** run the backfill before backing up the DB.

## 7. Production verification query

Before running the backfill, the owner should verify the `path` distribution on production:
```sql
SELECT
    CASE WHEN signal_type IN ('A_pre_surge', 'B_quiet_accumulation_strong',
                               'D_explosive_surge', 'disqualified_illiquid')
         THEN 'confident_maker_radar'
         ELSE 'ambiguous'
    END as category,
    CASE WHEN path IS NOT NULL THEN 'has_path' ELSE 'no_path' END as path_status,
    COUNT(*) as cnt
FROM radar_signal_tracking
GROUP BY category, path_status
ORDER BY category, path_status;
```

This will show how many ambiguous rows have `path IS NULL` (likely frontend) vs `path IS NOT NULL` (likely maker_radar).
