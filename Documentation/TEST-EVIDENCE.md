# Test Evidence — Phase 1 Forensic Audit
> **Environment:** Z.ai Sandbox, HEAD `280d47b`, branch `main`.
> **Date:** 2026-10-25.
> **Scope:** All tests are sandbox-only. They prove code behavior in isolation, NOT production correctness.

## Test results summary

| # | Test file | Pass | Fail | Total | Notes |
|---|---|---|---|---|---|
| 1 | `scripts/test_canonical_state_phase2.py` | 21 | 0 | 21 | MA200 + freshness + calendar + buy_pct |
| 2 | `scripts/test_canonical_transitions_phase2.py` | 11 | 1 | 12 | 1 "fail" is a documented FINDING (V2) |
| 3 | `scripts/test_radar_ownership_phase2.py` | 9 | 0 | 9 | Scoped DELETE alternatives |
| 4 | `scripts/test_radar_delete_impact_phase2.py` | 4 | 0 | 4 | V1 bug confirmation |
| 5 | `scripts/test_unique_key_phase2.py` | 6 | 1 | 7 | 1 "fail" is a documented FINDING (V2) |
| 6 | `scripts/test_shadow_mode_phase2.py` | 24 | 0 | 24 | Shadow Mode lifecycle + audit |
| **Total** | | **75** | **2** | **77** | 2 "failures" are intentional findings, not bugs |

---

## What each test proves (and what it does NOT prove)

### Test 1: `test_canonical_state_phase2.py` (21/21 ✅)
**Proves:**
- MA200 fix: 100-day data does NOT force DATA_INCOMPLETE (E2/E3 skipped gracefully).
- MA200 present: ≥200-day data generates E2/E3 evidence.
- Data freshness: `as_of_date` parameter works (no more `datetime.now()`).
- Market calendar: EGX (Sun-Thu), US (Mon-Fri), CRYPTO (24/7) all correct.
- buy_pct=None: E6 evidence skipped, no fabricated default.
- Transition tracking: NEW → CONTINUE works correctly.
- Real data classification: 5 tickers classified with confidence 0.40-0.72.

**Does NOT prove:**
- canonical_state is useful for predictions (no historical comparison done).
- The market parameter actually reaches `assess_state()` from the production call path (it's a parameter, but the caller `state_history_tracker.py` does NOT pass it — it uses default 'EGX').

### Test 2: `test_canonical_transitions_phase2.py` (11/12, 1 FINDING)
**Proves:**
- No future leakage: assess at t-1 uses only past data.
- Timeline: 3 consecutive dates produce correct transitions.
- days_in_state: accumulates 1→2→3 correctly.
- Real data: 5 tickers recorded in test DB.

**The 1 "failure" is a FINDING (V2):**
- TEST 2: "Single record per (ticker, date)" returns 2 rows instead of 1.
- This is the INSERT OR REPLACE without UNIQUE bug (V2 in conflicts report).
- The test is designed to DOCUMENT this behavior, not to pass.

**Does NOT prove:**
- The same duplicates exist on production (sandbox only).

### Test 3: `test_radar_ownership_phase2.py` (9/9 ✅)
**Proves:**
- `signal_type != 'canonical_state'` DELETE scope preserves canonical_state but wipes manual picks (TEST 2 — documented limitation).
- `path IS NOT NULL` DELETE scope preserves canonical_state (path=NULL) and manual picks (path=NULL).
- Re-running maker_radar with scoped DELETE creates no duplicates.
- canonical_state survives maker_radar re-runs.

**Does NOT prove:**
- The scoped DELETE is safe for production (frontend TS may set path in some cases — untested).

### Test 4: `test_radar_delete_impact_phase2.py` (4/4 ✅)
**Proves:**
- V1 bug CONFIRMED: `DELETE WHERE signal_date=?` wipes canonical_state rows.
- Fix proposal verified: scoped DELETE preserves canonical_state.
- Coexistence: radar + canonical_state in same date works.
- Scoped DELETE removes only radar rows.

**Does NOT prove:**
- The fix is deployed to production (it's not — needs owner approval).

### Test 5: `test_unique_key_phase2.py` (6/7, 1 FINDING)
**Proves:**
- UNIQUE(ticker, signal_date, signal_type) allows radar + canonical_state coexistence.
- INSERT OR REPLACE under UNIQUE actually replaces.
- Frontend TS dedup logic still works under UNIQUE.
- UNIQUE raises IntegrityError on duplicate INSERT (good — prevents silent duplicates).

**The 1 "failure" is a FINDING (V2):**
- TEST 5: production 1301 rows have 10 duplicate triples (26 rows) that block UNIQUE INDEX creation.
- This confirms V2 needs cleanup before migration.

**Does NOT prove:**
- (ticker, signal_date, signal_type) is the correct key for ALL cases (rename duplicates like pre_surge + A_pre_surge are NOT prevented — they have different signal_types).

### Test 6: `test_shadow_mode_phase2.py` (24/24 ✅)
**Proves:**
- Audit table creation (CREATE TABLE IF NOT EXISTS works).
- activate/deactivate lifecycle works.
- record_prediction with shadow = audit record created.
- Fail-safe: missing canonical_state → audit logged with NULL + prediction succeeds.
- No decision modification (predictions table unchanged).
- Analysis queries work.

**Does NOT prove:**
- Shadow Mode is loaded in production (it's NOT — no production file imports it).
- Performance under load (1000+ predictions).
- SQLite lock contention with concurrent writers.
- Lookahead bias is fixed (tests use same-date matches which have the bias).

---

## Test environment limitations

1. **Sandbox DBs are samples, not production.** Row counts, ticker sets, and date ranges differ from production.
2. **No production cron/scheduler simulation.** Tests run synchronously, not via cron.
3. **No concurrent writer simulation.** Tests are single-threaded.
4. **No WAL/SHM behavior testing.** Tests use `mode=ro` URI but don't simulate WAL checkpoints.
5. **Mock objects used for Shadow Mode test.** `PredictionTracker` is mocked, not the real class.

---

## What the tests collectively prove

1. **canonical_stock_state.py logic is sound** (MA200, freshness, calendar, buy_pct, transitions).
2. **The radar_signal_tracking ownership violations are real** (V1 unscoped DELETE, V2 duplicates).
3. **The proposed fixes work in isolation** (scoped DELETE, UNIQUE INDEX).
4. **Shadow Mode module is functional** (audit, fail-safe, no decision modification).

## What the tests do NOT prove

1. **canonical_state improves prediction quality** (no historical comparison with overlapping data).
2. **The fixes are safe for production** (no production data tested).
3. **Shadow Mode is ready for production activation** (not loaded in any production path).
4. **The UNIQUE key is correct for all cases** (rename duplicates not prevented).
5. **No race conditions exist** (no concurrent testing).

---

## Recommendation

- Tests are sufficient for **code-level confidence** in the canonical_state engine and the violation findings.
- Tests are **NOT sufficient** for production deployment decisions.
- Production deployment requires: (1) `production_db_audit.py` output from VPS, (2) Shadow Mode activation under controlled conditions, (3) 2-4 weeks of observation data.
