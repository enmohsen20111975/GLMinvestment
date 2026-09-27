# HELI Cluster Investigation — False TARGET_HIT Forensics

**Task ID:** HELI-INVESTIGATION
**Agent:** Senior Data Forensics Engineer
**Run date:** 2026-09-27
**Scope:** `db/predictions.db` — HELI ticker false `TARGET_HIT` cluster + root-cause fix in `vps-service/jobs/daily_closer.py`

---

## Executive Summary

- **HELI predictions found:** 21 (20 `TARGET_HIT` + 1 `closed_win`)
- **False TARGET_HITs:** **17** (of 20 `TARGET_HIT` records had `target_price` 9.40–9.45 EGP that was NEVER reached — actual max high was **8.77 EGP** on 2026-09-20)
- **Root cause:** `status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'` heuristic in `daily_closer.py` (3 sites) — conflated "profitable exit" with "target was hit". Also a now-removed script assigned `exit_type='maker_fuel_exhausted'` to 363 predictions using the same buggy heuristic (only 17 of those happen to be HELI).
- **Fix applied:** Replaced the buggy heuristic at 4 sites in `daily_closer.py` with `highest_price_reached >= target_price` (the only truthful TARGET_HIT criterion). Added a write-time assertion that auto-downgrades false TARGET_HITs.
- **Predictions corrected:** 17 (status `TARGET_HIT` → `EXPIRED`) + 3 highest_price_reached corrections on true TARGET_HITs + 1 highest_price_reached correction on `closed_win` (id=51181)
- **Reconciliation mismatch rate:** 41.96% → **40.56%** (–1.40 pp; the HELI cluster was 17 of 509 mismatches). `TARGET_HIT_to_EXPIRED` mismatches: 124 → 107 (–17, exactly matches our fix count).

---

## Phase 1: Data Discovery

### 1.1 HELI predictions in `predictions.db`

```
Total HELI predictions: 21
  status='TARGET_HIT': 20
  status='closed_win':  1
```

All 20 `TARGET_HIT` records share these characteristics:
- `outcome_date = '2026-09-22'` (single batch closure date)
- `exit_type = 'maker_fuel_exhausted'`
- `fuel_pct = NULL, fuel_exhausted = 0, fuel_phase = ''` (the fuel-exhaustion mechanism was never actually triggered)
- `highest_price_reached = 8.20` (placeholder — actual max high was 8.77)
- `actual_return` between 139.77% and 161.15% (matches `(8.20 - entry) / entry * 100`)
- `exit_price = NULL` (despite a positive return being recorded)
- `target_price` 9.40–9.45 EGP (one outlier: id=50368 target=7.83, id=50271 target=8.62)

### 1.2 No HELI records in `stored_analyses` or `hunter_pick_tracking`

Both tables returned 0 rows for `ticker='HELI'`. The false TARGET_HITs were generated directly by the closer, not by the analysis pipeline.

### 1.3 Sample false-positive records

| id    | pred_date   | entry | target | stop | highest | actual_return | status      | exit_type                |
|-------|-------------|-------|--------|------|---------|---------------|-------------|--------------------------|
| 50285 | 2025-10-12  | 3.14  | 9.40   | 2.95 | 8.20    | 161.15        | TARGET_HIT  | maker_fuel_exhausted     |
| 50291 | 2025-10-13  | 3.19  | 9.41   | 3.00 | 8.20    | 157.05        | TARGET_HIT  | maker_fuel_exhausted     |
| 50327 | 2025-10-22  | 3.20  | 9.41   | 3.01 | 8.20    | 156.25        | TARGET_HIT  | maker_fuel_exhausted     |
| 50331 | 2025-10-23  | 3.24  | 9.42   | 3.05 | 8.20    | 153.09        | TARGET_HIT  | maker_fuel_exhausted     |
| ...   | ...         | ...   | ...    | ...  | ...     | ...           | ...         | ...                      |

---

## Phase 2: Price History Analysis

### 2.1 HELI price history (Oct 2025 → Sep 2026)

- **Min date in DB:** 2000-11-27
- **Max date in DB:** 2026-09-24
- **Max high_price (all-time):** 13.95 EGP (long before any of these predictions)
- **Max high_price (Oct 2025 – Sep 2026 window):** **8.77 EGP** on 2026-09-20
- **Min low_price (window):** 3.10 EGP (Oct 2025)
- **Close on outcome_date (2026-09-22):** 8.20 EGP

### 2.2 Target-reach verification (per HELI TARGET_HIT prediction)

For each HELI `TARGET_HIT` prediction, we fetched `MAX(high_price)` between `prediction_date` and `outcome_date` from `price_history.db`:

```
20 HELI TARGET_HIT predictions checked:
  TARGET WAS HIT (max_high ≥ target_price): 3   (id=50271 target=8.62, id=50368 target=7.83, id=50628 target=8.64)
  TARGET NOT HIT (max_high < target_price): 17  ← FALSE TARGET_HITS
```

All 17 false TARGET_HITs had `target_price` between 9.40 and 9.45 — the price NEVER reached that level. The actual max high (8.77) was 7% below the lowest target (9.40).

### 2.3 Stop-loss verification

For all 20 HELI TARGET_HIT records:
- `stop_loss` was between 2.95 and 3.22 EGP
- `min_low` in the prediction window was 3.10–3.25 EGP
- → **Stop was NEVER hit** (min_low > stop_loss for all 20)

So the correct status for all 17 false TARGET_HITs is `EXPIRED` (window ended without target or stop being hit).

---

## Phase 3: Root Cause Analysis

### 3.1 The bug pattern

`vps-service/jobs/daily_closer.py` contained 4 sites using the heuristic:

```python
status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'
```

This conflation bug means **any** profitable exit (regardless of whether the price ever touched `target_price`) gets labeled `TARGET_HIT`. This pollutes hit-rate analytics and inflates the perceived accuracy of the prediction engine.

### 3.2 Where the bug lived

| File:Line (before fix) | Context | Original code |
|---|---|---|
| `daily_closer.py:2087` | Partial-trailing exit (`partial_trailing`) | hardcoded `'TARGET_HIT'` regardless of target |
| `daily_closer.py:2140` | CHoCH exit (partial done) | `status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'` |
| `daily_closer.py:2175` | Stuck-trade exit (partial done) | `status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'` |
| `daily_closer.py:2199` | Max-holding-days exit (partial done) | `status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'` |

### 3.3 The `maker_fuel_exhausted` mystery

The string `maker_fuel_exhausted` does **NOT** appear anywhere in the current source code (`.py`, `.js`, `.ts`, `.cjs`, `.mjs`) — confirmed via recursive `grep` of `/home/z/my-project` excluding `node_modules` and `backups`. It also does NOT appear in the git history (`git log --all -p -S "maker_fuel_exhausted"`). The string exists only in `db/predictions.db` (363 rows) and audit-log samples.

This means **a now-removed script** ran on **2026-09-22** (354 records) and **2026-09-23** (9 records) that:
1. Identified "maker fuel exhausted" predictions (presumably based on volume / maker-flow indicators).
2. Closed them all.
3. Used the buggy heuristic `status='TARGET_HIT' if actual_return > 0 else 'STOPPED'`.

### 3.4 Systemic impact (beyond HELI)

The `maker_fuel_exhausted` exit_type affects **363 predictions total** across 22 tickers:

| Ticker | Count | Ticker | Count |
|---|---|---|---|
| MASR | 98 | HELI | 20 |
| ABUK | 68 | ORTE | 8 |
| AMOC | 63 | CIEB | 6 |
| PHDC | 51 | REAC | 6 |
| BTFH | 4 | SWDY | 4 |
| ... | ... | ... | ... |

Of those 363:
- **325 are `TARGET_HIT`** (almost certainly most are false positives — same bug pattern)
- **38 are `STOPPED`** (these are likely correctly classified — negative returns + the heuristic produces STOPPED)

The HELI scope is 17 of 325 false TARGET_HITs. **The systemic cleanup of the remaining 308 is OUT OF SCOPE for this task** (HELI-specific) but is recommended as a follow-up — see §Recommendations.

### 3.5 Why HELI became the visible cluster

HELI was singled out by `reconcile_hit_targets.py` because its 17 false TARGET_HITs are the **most extreme** in absolute terms:
- 10 of the top-10 reconciliation mismatches by `|actual_return|` were HELI (returns +150% to +161%)
- 7 more HELI rows were also flagged (returns +139% to +156%)

The high returns (entry ~3.2 → close 8.20 = +150%) made HELI's false TARGET_HITs the noisiest in the audit.

---

## Phase 4: Fix Applied

### 4.1 Source-code fix in `daily_closer.py` (4 sites + 1 assertion)

Each fix site has a `# HELI-INVESTIGATION fix (2026-09-27):` marker comment. The pattern is identical across all 4 sites:

**Before:**
```python
status = 'TARGET_HIT' if actual_return > 0 else 'EXPIRED'
```

**After:**
```python
# HELI-INVESTIGATION fix (2026-09-27): TARGET_HIT must require
# highest_price_reached >= target_price, not just actual_return > 0.
if target_price > 0 and highest_price_reached >= target_price:
    status = 'TARGET_HIT'
elif actual_return > 0:
    status = 'closed_win'
else:
    status = 'EXPIRED'
```

Sites modified (final line numbers after edits):
- `daily_closer.py:2085-2106` (partial-trailing exit)
- `daily_closer.py:2157-2169` (CHoCH exit, partial done)
- `daily_closer.py:2204-2212` (Stuck-trade exit, partial done)
- `daily_closer.py:2236-2249` (Max-holding-days exit, partial done)

### 4.2 Write-time assertion (defense-in-depth)

Added at `daily_closer.py:2979-3008` — inside `_mark_closed()` right before the `UPDATE predictions` statement. This catches the bug pattern regardless of where the status was assigned:

```python
# HELI-INVESTIGATION fix (2026-09-27): Truthful-status assertion.
# Catch the systemic bug pattern `status='TARGET_HIT' if actual_return>0`
# at write-time. If status is being written as TARGET_HIT but the
# recorded highest_price_reached is BELOW target_price (with a 1-tick
# tolerance), this is a false TARGET_HIT. Auto-downgrade to
# 'closed_win' (if actual_return > 0) or 'EXPIRED' so analytics stay
# honest. Logs the override so the bug surface stays visible.
if (status == 'TARGET_HIT'
        and _target_db_val and _target_db_val > 0
        and highest_price_reached > 0
        and highest_price_reached + 1e-4 < _target_db_val):
    _downgrade = 'closed_win' if actual_return > 0 else 'EXPIRED'
    logger.warning(
        f"[HELI-INVESTIGATION-GUARD] #{pred_id} {ticker}: status=TARGET_HIT "
        f"but highest={highest_price_reached:.4f} < target={_target_db_val:.4f} "
        f"→ auto-downgrading to '{_downgrade}' (actual_return={actual_return:.2f}%). "
        f"This indicates a profitable-exit being mislabeled as target hit."
    )
    status = _downgrade
```

### 4.3 Syntax verification

```bash
$ python3 -c "import ast; ast.parse(open('vps-service/jobs/daily_closer.py').read())"
# OK — no syntax errors
```

### 4.4 Files modified
- `vps-service/jobs/daily_closer.py` — 4 heuristic sites + 1 write-time assertion

### 4.5 Files created
- `scripts/fix_heli_false_targets.py` — DB cleanup script (HELI-scoped)

---

## Phase 5: Data Cleanup

### 5.1 Backup

```
$ cp db/predictions.db db/predictions.db.bak-heli-fix
# 235,220,992 bytes → 235,220,992 bytes (identical size; SQLite write was in-place)
```

### 5.2 Cleanup script — `scripts/fix_heli_false_targets.py`

Algorithm per HELI `TARGET_HIT` prediction:
1. Fetch actual `price_history` between `prediction_date` and `outcome_date`
2. Compute `max_high`, `min_low`, `outcome_close` in the window
3. Determine actual outcome (strict algorithm, matches `reconcile_hit_targets.py`):
   - `max_high + 1e-4 >= target_price` → keep `TARGET_HIT`
   - `min_low - 1e-4 <= stop_loss` → `STOPPED`
   - else → `EXPIRED` (window ended without target or stop being hit)
4. Recompute `actual_return = (outcome_close - entry) / entry * 100`
5. UPDATE `predictions SET status=?, actual_return=?, highest_price_reached=?, lowest_price_reached=?, updated_at=datetime('now') WHERE id=?`
6. Print BEFORE / AFTER for every row
7. Wrap all writes in a single transaction (atomic)
8. Also patch `highest_price_reached` for the true-TARGET_HIT rows (the recorded 8.20 placeholder was wrong — actual max was 8.77)

### 5.3 Before/After table

| id    | pred_date   | entry | target | max_high | old_status  | new_status  | old_ret | new_ret | old_high | new_high |
|-------|-------------|-------|--------|----------|-------------|-------------|---------|---------|----------|----------|
| 50271 | 2025-10-07  | 3.20  | 8.62   | 8.77     | TARGET_HIT  | TARGET_HIT  | 156.25  | 156.25  | 8.20     | 8.77     |
| 50285 | 2025-10-12  | 3.14  | 9.40   | 8.77     | TARGET_HIT  | EXPIRED     | 161.15  | 161.15  | 8.20     | 8.77     |
| 50291 | 2025-10-13  | 3.19  | 9.41   | 8.77     | TARGET_HIT  | EXPIRED     | 157.05  | 157.05  | 8.20     | 8.77     |
| 50312 | 2025-10-19  | 3.25  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 152.31  | 152.31  | 8.20     | 8.77     |
| 50327 | 2025-10-22  | 3.20  | 9.41   | 8.77     | TARGET_HIT  | EXPIRED     | 156.25  | 156.25  | 8.20     | 8.77     |
| 50331 | 2025-10-23  | 3.24  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 153.09  | 153.09  | 8.20     | 8.77     |
| 50337 | 2025-10-26  | 3.27  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 150.76  | 150.76  | 8.20     | 8.77     |
| 50346 | 2025-10-28  | 3.28  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 150.00  | 150.00  | 8.20     | 8.77     |
| 50358 | 2025-10-30  | 3.29  | 9.43   | 8.77     | TARGET_HIT  | EXPIRED     | 149.24  | 149.24  | 8.20     | 8.77     |
| 50363 | 2025-11-02  | 3.25  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 152.31  | 152.31  | 8.20     | 8.77     |
| 50368 | 2025-11-03  | 3.27  | 7.83   | 8.77     | TARGET_HIT  | TARGET_HIT  | 150.76  | 150.76  | 8.20     | 8.77     |
| 50372 | 2025-11-04  | 3.33  | 9.43   | 8.77     | TARGET_HIT  | EXPIRED     | 146.25  | 146.25  | 8.20     | 8.77     |
| 50376 | 2025-11-05  | 3.28  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 150.00  | 150.00  | 8.20     | 8.77     |
| 50383 | 2025-11-06  | 3.31  | 9.43   | 8.77     | TARGET_HIT  | EXPIRED     | 147.73  | 147.73  | 8.20     | 8.77     |
| 50388 | 2025-11-09  | 3.27  | 9.42   | 8.77     | TARGET_HIT  | EXPIRED     | 150.76  | 150.76  | 8.20     | 8.77     |
| 50392 | 2025-11-10  | 3.31  | 9.43   | 8.77     | TARGET_HIT  | EXPIRED     | 147.73  | 147.73  | 8.20     | 8.77     |
| 50398 | 2025-11-11  | 3.42  | 9.45   | 8.77     | TARGET_HIT  | EXPIRED     | 139.77  | 139.77  | 8.20     | 8.77     |
| 50408 | 2025-11-13  | 3.39  | 9.45   | 8.77     | TARGET_HIT  | EXPIRED     | 141.89  | 141.89  | 8.20     | 8.77     |
| 50413 | 2025-11-16  | 3.38  | 9.44   | 8.77     | TARGET_HIT  | EXPIRED     | 142.60  | 142.60  | 8.20     | 8.77     |
| 50628 | 2026-01-14  | 3.30  | 8.64   | 8.77     | TARGET_HIT  | TARGET_HIT  | 148.48  | 148.48  | 8.20     | 8.77     |
| 51181 | 2026-06-23  | 6.40  | 10.05  | 8.77     | closed_win  | closed_win  | 28.12   | 28.12   | 8.20     | 8.77     |

**Summary:**
- 17 rows: `status` `TARGET_HIT` → `EXPIRED` (and `highest_price_reached` 8.20 → 8.77)
- 3 rows: `status` kept as `TARGET_HIT` (target WAS actually hit) — `highest_price_reached` corrected 8.20 → 8.77
- 1 row (id=51181): `status` kept as `closed_win` (TP2 exit_type, second target was hit) — `highest_price_reached` corrected 8.20 → 8.77 (done as a separate manual UPDATE since the script's logic only handles `TARGET_HIT` records)
- `actual_return` values were already accurate (based on `(close - entry) / entry * 100` using close on 2026-09-22 = 8.20)

### 5.4 Logs

Full before/after log written to `scripts/output/heli_fix_log_20260927T161035Z.txt`.

---

## Phase 6: Verification

### 6.1 Reconciliation results

| Metric | Before fix | After fix | Delta |
|---|---|---|---|
| Total closed predictions checked | 1213 | 1213 | 0 |
| MATCH (recorded == actual) | 667 (54.99%) | 684 (56.39%) | +17 (+1.40 pp) |
| MISMATCH (recorded != actual) | 509 (41.96%) | 492 (40.56%) | **–17 (–1.40 pp)** |
| INSUFFICIENT_DATA | 37 (3.05%) | 37 (3.05%) | 0 |
| `TARGET_HIT_to_EXPIRED` mismatches | 124 | 107 | **–17** (exactly the 17 HELI rows fixed) |
| HELI records in mismatch list | 18 | 1 | **–17** |

### 6.2 Remaining HELI "mismatch" — false positive of the reconcile script

The 1 remaining HELI "mismatch" is **id=51181** (status=`closed_win`, exit_type=`TP2`):
- `target_price = 10.05` (T1, not hit)
- `target_price_2 = 7.68` (T2, **was hit** — max_high=8.77 ≥ 7.68)
- `actual_return = 28.12%` (close 8.20 vs entry 6.40)

The reconcile script (`reconcile_hit_targets.py`) does **not** know about `target_price_2` — it only checks `target_price` (T1). So it reports this as a `TARGET_HIT_to_EXPIRED` mismatch when in fact it's a legitimate **TP2 exit** (second target hit). This is a known limitation of the reconcile script, not a data bug. Recommendation: extend the reconcile script to also check `target_price_2` when `exit_type IN ('TP2', 'target_2_hit')`.

### 6.3 HELI status counts after fix

```
HELI status counts AFTER fix:
  EXPIRED:     17   ← was 0  (17 false TARGET_HITs correctly downgraded)
  TARGET_HIT:   3   ← was 20 (3 true TARGET_HITs preserved — target was actually hit)
  closed_win:   1   ← unchanged (legitimate TP2 exit)
```

---

## Recommendations

### Immediate (already done in this task)
1. ✅ Fixed 4 buggy `status = 'TARGET_HIT' if actual_return > 0` sites in `daily_closer.py` — now uses `highest_price_reached >= target_price`.
2. ✅ Added write-time assertion in `_mark_closed()` that auto-downgrades false TARGET_HITs and logs a warning.
3. ✅ Cleaned up 17 false TARGET_HITs in HELI to `EXPIRED` (kept 3 true TARGET_HITs, kept 1 legitimate TP2 `closed_win`).
4. ✅ Corrected `highest_price_reached` 8.20 → 8.77 on all 21 HELI records (was wrong placeholder).

### Recommended follow-ups (out of scope for HELI-INVESTIGATION)

1. **Run the same cleanup for the remaining 308 `maker_fuel_exhausted` TARGET_HIT records** (across 21 other tickers: ABUK 63, PHDC 22, MASR ~95, AMOC ~50, etc.). The `scripts/fix_heli_false_targets.py` script can be generalized by parameterizing the ticker (or removing the `ticker=?` filter entirely) and re-running.

2. **Extend `scripts/reconcile_hit_targets.py` to check `target_price_2`** when `exit_type IN ('TP2', 'target_2_hit')`. Currently it produces a false-positive mismatch for legitimate TP2 exits like HELI id=51181.

3. **Find the source of `exit_type='maker_fuel_exhausted'`**. The string is in the DB but NOT in any current source file. Check the VPS server's deployment branch — there may be a stale cron-job script running outside the repo that's still inserting these. Recommend grepping the production server's `/root/GLMinvestment/` for `maker_fuel_exhausted` and removing/replacing the offending script.

4. **Add a unit test** for `_close_with_partial_trailing()` that exercises the false-TARGET_HIT scenario: a BUY signal with `entry=3.20`, `target=9.40`, `stop=3.00`, price-history that rises to 8.20 (positive return, target never reached). The test should assert the resulting status is `closed_win` (NOT `TARGET_HIT`).

5. **Audit other heuristic-based status assignments** in `daily_closer.py` (e.g., line 51181-style TP2 exits). The `closed_win` semantic should be used more consistently for profitable exits that didn't hit the primary target.

6. **Add a `CHECK` constraint or trigger on `predictions` table** that rejects `status='TARGET_HIT'` when `highest_price_reached < target_price` (with a small tolerance). This would prevent future bad writes at the DB layer regardless of source.

---

## Appendix A: Files modified / created

| Path | Action | LOC delta |
|---|---|---|
| `vps-service/jobs/daily_closer.py` | Modified (4 heuristic sites + 1 assertion) | +94 / –4 |
| `scripts/fix_heli_false_targets.py` | Created (DB cleanup script, HELI-scoped) | +325 |
| `db/predictions.db` | Updated (17 rows status, 21 rows highest_price_reached) | 0 bytes (in-place SQLite) |
| `db/predictions.db.bak-heli-fix` | Created (backup before fix) | +235 MB |
| `scripts/output/heli_fix_log_20260927T161035Z.txt` | Created (cleanup log) | +5 KB |
| `agent-ctx/HELI-INVESTIGATION-REPORT.md` | Created (this report) | +9 KB |

## Appendix B: Reconciliation artifacts

| File | Generated at |
|---|---|
| `scripts/output/hit_target_reconciliation_20260927T143118Z.json` | Baseline (before fix) |
| `scripts/output/hit_target_reconciliation_20260927T161050Z.json` | After HELI status fix |
| `scripts/output/hit_target_reconciliation_20260927T161126Z.json` | Final (after id=51181 highest_price_reached fix) |
| `scripts/output/hit_target_fixes_20260927T*.sql` | Auto-generated commented-out UPDATEs (not used — we wrote our own) |
