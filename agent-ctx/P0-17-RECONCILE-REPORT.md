# P0 #17 — hit_target Reconciliation Report

## Summary
- Total closed predictions checked: **1,213**
- ✅ Match (recorded = actual): **667** (54.99%)
- ❌ Mismatch (recorded != actual): **509** (41.96%)
- ⚠️ Insufficient data: **37** (3.05%)

> **Mismatch rate is significantly higher than the AUDIT_BACKTEST's 17% estimate.**
> The audit was based on a 30-row manual sample; applying the strict algorithm
> (max_high ≥ target → TARGET_HIT, else min_low ≤ stop → STOPPED, else window
> expired → EXPIRED) to **all** 1,213 closed predictions reveals a substantially
> larger data-integrity problem than the audit's sample suggested.

## Mismatches by type (recorded_to_actual)

| recorded → actual        | count | meaning |
|--------------------------|------:|---------|
| EXPIRED_to_STOPPED       |   183 | prediction recorded as EXPIRED but price actually hit the stop_loss |
| TARGET_HIT_to_EXPIRED    |   124 | recorded as TARGET_HIT but price never reached target and window expired |
| EXPIRED_to_TARGET_HIT    |    90 | recorded as EXPIRED but price actually hit target |
| TARGET_HIT_to_STOPPED    |    61 | recorded as TARGET_HIT but price hit stop_loss first |
| STOPPED_to_EXPIRED       |    28 | recorded as STOPPED but window expired without hitting stop |
| STOPPED_to_TARGET_HIT    |    23 | recorded as STOPPED but price actually hit target |
| **Total mismatches**     | **509** | |

Two failure modes dominate:
1. **EXPIRED → STOPPED (183)** — the prediction pipeline marked these as
   "expired" after max-days, but the stop loss was actually breached earlier
   in the window. Stop-loss detection is not triggering when it should.
2. **TARGET_HIT → EXPIRED (124)** — the pipeline claimed a target hit but the
   price never actually reached the target. These are the focus of the
   AUDIT_BACKTEST concern, and they're the highest-impact mismatches by
   recorded return (e.g., HELI id=50285 recorded +161% but actually never
   hit its 9.40 target — high-water was only 8.77).

## Top mismatches (top 10 by absolute recorded actual_return)

| id     | ticker | pred_date  | recorded   | actual   | entry  | target | stop  | max_high | min_low | recorded ret% |
|--------|--------|------------|------------|----------|-------:|-------:|------:|---------:|--------:|--------------:|
| 50285  | HELI   | 2025-10-12 | TARGET_HIT | EXPIRED  |  3.14  |  9.40  | 2.95  |    8.77  |   3.11  |       +161.15 |
| 50291  | HELI   | 2025-10-13 | TARGET_HIT | EXPIRED  |  3.19  |  9.41  | 3.00  |    8.77  |   3.12  |       +157.05 |
| 50327  | HELI   | 2025-10-22 | TARGET_HIT | EXPIRED  |  3.20  |  9.41  | 3.01  |    8.77  |   3.19  |       +156.25 |
| 50331  | HELI   | 2025-10-23 | TARGET_HIT | EXPIRED  |  3.24  |  9.42  | 3.05  |    8.77  |   3.20  |       +153.09 |
| 50312  | HELI   | 2025-10-19 | TARGET_HIT | EXPIRED  |  3.25  |  9.42  | 3.06  |    8.77  |   3.18  |       +152.31 |
| 50363  | HELI   | 2025-11-02 | TARGET_HIT | EXPIRED  |  3.25  |  9.42  | 3.06  |    8.77  |   3.22  |       +152.31 |
| 50337  | HELI   | 2025-10-26 | TARGET_HIT | EXPIRED  |  3.27  |  9.42  | 3.08  |    8.77  |   3.22  |       +150.76 |
| 50388  | HELI   | 2025-11-09 | TARGET_HIT | EXPIRED  |  3.27  |  9.42  | 3.08  |    8.77  |   3.25  |       +150.76 |
| 50346  | HELI   | 2025-10-28 | TARGET_HIT | EXPIRED  |  3.28  |  9.42  | 3.09  |    8.77  |   3.22  |       +150.00 |
| 50376  | HELI   | 2025-11-05 | TARGET_HIT | EXPIRED  |  3.28  |  9.42  | 3.09  |    8.77  |   3.25  |       +150.00 |

**Pattern:** All top 10 are the same ticker (HELI), all recorded as `TARGET_HIT`
with ~150%+ return, but actual price high in window (8.77) is consistently
below the target (9.40–9.42). This is a single-ticker systemic false-positive
issue and likely points to a stale/wrong target_price calculation for HELI
in the prediction generator.

## Recommended action
- **Review the SQL file** at `scripts/output/hit_target_fixes_20260927T143118Z.sql`
- Each UPDATE statement is **commented out** — uncomment individually before applying
- All statements set `actual_return=NULL` so the reviewer is forced to recompute
  the correct return from the actual price data (do NOT blindly apply)
- **Priority order** for review (highest impact first):
  1. The 124 `TARGET_HIT_to_EXPIRED` mismatches — these are the audit's
     originally-flagged "17% problem"; the largest recorded returns are in
     this group (HELI false positives)
  2. The 61 `TARGET_HIT_to_STOPPED` mismatches — recorded as wins but were
     actually stop-loss exits; these inflate win-rate metrics
  3. The 183 `EXPIRED_to_STOPPED` mismatches — predicted returns likely
     understated
- **Root-cause investigation** — the HELI cluster suggests a single bug in the
  prediction generator that is repeatedly producing target_price values the
  underlying asset cannot reach. Worth auditing the target_price calculation
  for HELI (and any other ticker with >5 mismatches).
- **Pipeline fix** — separately, the stop-loss detector is missing real
  stop hits (183 cases). Investigate whether the close-predictions cron is
  preferring "max_days" expiry over stop-loss checks.

## Methodology
- **Script:** `scripts/reconcile_hit_targets.py`
- **DBs:** `db/predictions.db` (read-only via `?mode=ro` URI) +
  `db/price_history.db` (read-only via `?mode=ro` URI)
- **No writes** — script is strictly read-only. SQL file is for manual review.
- **Algorithm** (per task spec):
  1. Query all closed predictions: `status IN ('TARGET_HIT','STOPPED','closed_win','closed_stop','EXPIRED','expired')`
  2. For each prediction:
     - Skip if entry_price/target_price/stop_loss is null or ≤0 → INSUFFICIENT_DATA
     - Window = `[prediction_date, outcome_date]` (falls back to `closed_at`, then
       `prediction_date + 30 calendar days` if both are null)
     - Determine actual outcome from price_history:
       - `max_high ≥ target_price` → `TARGET_HIT`
       - else `min_low ≤ stop_loss` → `STOPPED`
       - else window expired (end < today) → `EXPIRED`
       - else → `PENDING` (treated as mismatch — shouldn't be in closed set)
  3. Normalize recorded statuses: `closed_win`→`TARGET_HIT`, `closed_stop`→`STOPPED`
  4. Compare normalized recorded vs actual → MATCH / MISMATCH / INSUFFICIENT_DATA
- **Batching:** price_history is fetched once per distinct ticker (80 tickers),
  cached in memory, then sliced per-prediction by date window in Python — avoids
  1-query-per-prediction overhead.
- **Ticker case normalization:** both DBs already use uppercase; the script
  enforces `.upper()` defensively on both sides.
- **Float tolerance:** `PRICE_EPS = 1e-4` to absorb sub-tick float noise when
  comparing `max_high >= target_price`.
- **Anomalies logged:** zero `outcome_date < prediction_date` cases detected.

## Output artifacts
- `scripts/reconcile_hit_targets.py` — the script (Python stdlib only)
- `scripts/output/hit_target_reconciliation_20260927T143118Z.json` — full JSON report
  (top 50 + all 509 mismatches + all 37 insufficient + anomalies + summary stats)
- `scripts/output/hit_target_fixes_20260927T143118Z.sql` — 509 commented-out
  UPDATE statements for manual review
- This report: `agent-ctx/P0-17-RECONCILE-REPORT.md`
