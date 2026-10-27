# P0 DELETE Ownership — Test Evidence
> **Test file:** `scripts/test_p0_complete_fix.py`
> **Environment:** Z.ai Sandbox, branch `fix/p0-delete-ownership-complete`
> **Date:** 2026-10-25
> **Total tests:** 19 (19 pass, 0 fail)

## Test results — actual execution output

```
SUMMARY
================================================================================
  ✅ Passed: 19
  ❌ Failed: 0
  Total:    19
```

## Commands executed

```bash
cd /home/z/my-project
git checkout -b fix/p0-delete-ownership-complete
python3 -m py_compile scripts/maker_radar.py          # → exit 0 ✅
python3 scripts/test_p0_complete_fix.py                # → exit 0, 19/19 ✅
```

## Test-by-test evidence

### TEST 1: Verification preserved after 3 re-runs
**Would FAIL with old DELETE+INSERT pattern.**

| Test | Result | Detail |
|---|---|---|
| 1a: no duplicates after 3 re-runs | ✅ PASS | rows=1 (expected 1) |
| 1b: verification preserved (outcome_7d=5.0) | ✅ PASS | outcome_7d=5.0 |
| 1c: verification preserved (verified_at) | ✅ PASS | verified_at=2026-10-25 13:00:00 |
| 1d: verification preserved (status=verified_win) | ✅ PASS | status=verified_win |

**Scenario:**
1. maker_radar inserts COMI as A_pre_surge.
2. verify_radar_signals updates: outcome_7d=5.0, verified_at='13:00', status='verified_win'.
3. maker_radar re-runs 3 times (same signal_type).
4. All verification fields preserved — not overwritten.

### TEST 2: Intraday evolution history preserved
**Would FAIL with old DELETE+INSERT pattern.**

| Test | Result | Detail |
|---|---|---|
| 2a: current signal = latest (D_explosive_surge) | ✅ PASS | current=D_explosive_surge |
| 2b: history has 2 entries | ✅ PASS | history_count=2 |
| 2c: history[0] = A_pre_surge | ✅ PASS | history[0]=A_pre_surge |
| 2d: history[1] = B_quiet_accumulation_strong | ✅ PASS | history[1]=B_quiet_accumulation_strong |
| 2e: no duplicate for same signal_type re-runs | ✅ PASS | history_count=2 (runs 2+5 don't create entries) |

**Scenario:**
1. Run 1 (10:00): COMI = A_pre_surge → INSERT new row.
2. Run 2 (10:05): COMI = A_pre_surge (same) → UPDATE, no history.
3. Run 3 (10:10): COMI = B_quiet_accumulation_strong (CHANGED) → history: A_pre_surge, then UPDATE.
4. Run 4 (10:15): COMI = D_explosive_surge (CHANGED) → history: B_quiet_accumulation_strong, then UPDATE.
5. Run 5 (10:20): COMI = D_explosive_surge (same) → UPDATE, no history.
6. Current = D_explosive_surge. History = [A_pre_surge, B_quiet_accumulation_strong].

### TEST 3: Other owners survive maker_radar re-runs

| Test | Result | Detail |
|---|---|---|
| 3a: maker_radar rows = 1 | ✅ PASS | maker_radar=1 |
| 3b: canonical_state rows survive | ✅ PASS | canonical_state=1 |
| 3c: frontend rows survive | ✅ PASS | frontend=1 |

### TEST 4: Combined integration (verification + history + other owners)

| Test | Result | Detail |
|---|---|---|
| 4a: current signal = latest | ✅ PASS | current=B_quiet_accumulation_strong |
| 4b: verification preserved (outcome_7d) | ✅ PASS | outcome_7d=5.0 |
| 4c: verification preserved (status) | ✅ PASS | status=verified_win |
| 4d: history has 1 entry | ✅ PASS | history_count=1, history[0]=A_pre_surge |
| 4e: no duplicates | ✅ PASS | maker_radar=1 |
| 4f: canonical_state survives | ✅ PASS | canonical_state=1 |
| 4g: frontend survives | ✅ PASS | frontend=1 |

## What these tests do NOT prove

1. **Production behavior** — tests use synthetic data on temp DB, not production data.
2. **Concurrent access** — tests are single-threaded, no concurrent writer simulation.
3. **Performance under load** — tests don't measure latency with 1000+ tickers.
4. **Schema migration safety** — tests create schema from scratch, don't test ALTER TABLE on existing production DB.

## Comparison with previous submission

| Aspect | Previous (`6fd1877`) | Current |
|---|---|---|
| Total tests | 10 | 19 |
| Verification preserved? | ❌ NO (documented as "KNOWN LIMITATION") | ✅ YES (proved by TEST 1b/1c/1d) |
| Intraday history preserved? | ❌ NO (documented as "KNOWN LIMITATION") | ✅ YES (proved by TEST 2a-2e) |
| Other owners' rows safe? | ✅ YES | ✅ YES |
| Tests that FAIL before fix? | 0 (all documented existing behavior) | 11 (tests 1b-1d, 2a-2e, 4b-4d would fail with old pattern) |
