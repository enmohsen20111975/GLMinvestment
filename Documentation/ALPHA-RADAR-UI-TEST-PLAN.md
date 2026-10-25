# ALPHA — Liquidity Radar UI Test Plan (RADAR-CLOSURE-01 Phase 6)
> **Status:** READY TO EXECUTE (pending Bravo's code fix delivery)
> **Owner:** Alpha (Frontend/UI)
> **Date:** 2026-10-25
> **Branch:** fix/radar-forensic-minimal (awaiting Bravo's commits)

---

## 1. Screens & API Endpoints Inventory

### Active Screens Displaying Radar Data:

| # | Screen | Route | Component | API Endpoint(s) |
|---|--------|-------|-----------|-----------------|
| 1 | Liquidity Radar | `#liquidity-radar` | `LiquidityRadarView.tsx` | `/api/v2/liquidity-radar?market=EGX` |
| 2 | Maker Radar (predictions) | `#recommendations` → radar tab | `MakerRadarTab.tsx` | `/api/maker-radar/track` |
| 3 | Accuracy Dashboard | inside MakerRadarTab | `AccuracyDashboard.tsx` | `/api/radar/accuracy?market=EGX&days=90` |
| 4 | Personalized Radar | inside MakerRadarTab | `PersonalizedRadarTab.tsx` | `/api/radar/personalized` |

### API Endpoints Summary:

| Endpoint | Purpose | Fields Returned |
|----------|---------|-----------------|
| `/api/v2/liquidity-radar?market=EGX` | Primary radar display | ticker, name, current_price, change_percent, net_flow_egp, phase, entry_defense, volume, correction_status |
| `/api/maker-radar/track` | Signal tracking | tracked signals + stats |
| `/api/radar/accuracy?market=EGX&days=90` | Accuracy metrics | total_signals, verified, avg_outcome_7d/14d/30d, by_signal_type |
| `/api/radar/personalized` | Personalized radar | radar_status, radar_cache_file, stocks[] |
| `/api/maker-radar/signal-tracker` | Signal CRUD | insert/list radar_signal_tracking rows |
| `/api/maker-radar/signal-tracker/verify` | Signal verification | updates outcome_7d/14d/30d + verified_at |

### Data Storage:
- `radar_signal_tracking` table in `stocks.db` (or `data_engine.db` fallback)
- Fields: ticker, signal_date, signal_type, entry_price, status, outcome_7d, outcome_14d, outcome_30d, verified_at, source
- Cache files: `scripts/output/maker_radar_{MARKET}_{YYYYMMDD}.json`
- Status file: `db/radar_cache_status.json`

---

## 2. Seven Test Cases — Ready to Execute

### Test 1: Radar display matches API response

**Source:** `/api/v2/liquidity-radar?market=EGX` → `LiquidityRadarView.tsx`

**Steps:**
1. `curl -s "http://localhost:3000/api/v2/liquidity-radar?market=EGX" | python3 -m json.tool`
2. Open `http://localhost:3000/#liquidity-radar` in browser
3. Compare first 5 stocks: ticker, current_price, net_flow_egp, phase
4. Verify displayed values === API JSON values (no rounding, no fabrication)

**Expected:** Every displayed value matches API response exactly. NULL in API → "—" in UI (not 0 or fabricated).

**PASS criteria:** 0 mismatches across 5 stocks × 4 fields = 20 checks
**FAIL criteria:** Any mismatch or fabricated value

---

### Test 2: Price/Date/Market match canonical source

**Source:** `/api/v2/liquidity-radar` → `radar-cache.ts::readRadarCache()` → `scripts/output/maker_radar_EGX_*.json`

**Steps:**
1. Find latest cache file: `ls -t scripts/output/maker_radar_EGX_*.json | head -1`
2. Read cache JSON: `python3 -c "import json; d=json.load(open('FILE')); print(d['stocks'][0])"`
3. Compare cache fields with API response fields
4. Verify `signal_date` in cache matches `signal_date` in tracking table
5. Verify `market` field = "EGX" (not mixed with US/TADAWUL)

**Expected:** Cache → API → UI chain is consistent. No cross-market data leakage.

**PASS criteria:** Cache date = API date = UI date; market = EGX throughout
**FAIL criteria:** Any date mismatch or market contamination

---

### Test 3: Signal status and outcome consistency

**Source:** `/api/radar/accuracy` → `AccuracyDashboard.tsx` + `radar_signal_tracking` table

**Steps:**
1. Query DB: `sqlite3 db/stocks.db "SELECT status, COUNT(*) FROM radar_signal_tracking GROUP BY status"`
2. Call API: `curl -s "http://localhost:3000/api/radar/accuracy?market=EGX&days=90"`
3. Compare: API `total_signals` = DB count; API `verified` = DB count WHERE status='verified'
4. Verify `stale_data` signals are NOT counted as `verified` in accuracy stats
5. Verify `avg_outcome_7d` only includes signals with non-NULL `outcome_7d`

**Expected:** DB counts = API counts. No stale/unverified signals counted in accuracy metrics.

**PASS criteria:** All counts match; no inflation of accuracy by including stale signals
**FAIL criteria:** Any count mismatch or stale signals counted as verified

---

### Test 4: Unverified results not shown as verified

**Source:** `AccuracyDashboard.tsx` + `/api/radar/accuracy`

**Steps:**
1. Find signals with status='pending' or status='stale_data' in DB
2. Check if any of these have non-NULL outcome_7d (should NOT happen — if stale, outcome should be NULL or flagged)
3. Open Accuracy Dashboard in browser
4. Verify: unverified signals don't appear in "verified" accuracy metrics
5. Verify: UI shows separate "pending" or "stale" count if applicable

**Expected:** Unverified/stale signals are visually separate from verified results. No confusion.

**PASS criteria:** Unverified signals NOT counted in verified accuracy %
**FAIL criteria:** Any stale signal counted in verified metrics

---

### Test 5: No display discrepancy between screens

**Source:** `LiquidityRadarView.tsx` vs `MakerRadarTab.tsx` vs `AccuracyDashboard.tsx`

**Steps:**
1. Open `#liquidity-radar` — note COMI price + phase
2. Open `#recommendations` → radar tab — note COMI price + signal_type
3. Call `/api/v2/liquidity-radar?market=EGX` — note COMI
4. Call `/api/maker-radar/track` — note COMI signal
5. Compare: same ticker should show same price + same signal across all screens

**Expected:** No discrepancy. Same stock = same data across all screens.

**PASS criteria:** 0 discrepancies for 3 sample tickers across 4 sources
**FAIL criteria:** Any ticker shows different price/signal/status on different screens

---

### Test 6: Loading/Error/Empty states

**Source:** `LiquidityRadarView.tsx` + `MakerRadarTab.tsx`

**Steps:**
1. **Empty state:** Stop Python backend → call `/api/v2/liquidity-radar` → should return `stocks: []` with clear message
2. **Error state:** Simulate API error (corrupt cache file) → UI should show error, not blank
3. **Loading state:** Check skeleton/spinner appears during fetch
4. **Stale cache:** Set cache file mtime to 1 hour ago → verify "stale" indicator appears

**Expected:** Each state has clear, non-confusing UI. No silent failures.

**PASS criteria:** All 4 states handled with clear messages
**FAIL criteria:** Blank screen, silent error, or misleading "success" on failure

---

### Test 7: No side-effect regression from Bravo's fix

**Source:** All radar screens + non-radar screens

**Steps:**
1. Before Bravo's fix: screenshot `#liquidity-radar` + `#recommendations`
2. After Bravo's fix: screenshot same screens
3. Compare: layout, navigation, colors, fonts must be identical
4. Verify: non-radar screens (`#dashboard`, `#stocks`, `#portfolio`) still work
5. Verify: no new console errors in browser DevTools

**Expected:** Only radar data changes — no UI/layout/ navigation regression.

**PASS criteria:** 0 visual regressions; 0 new console errors
**FAIL criteria:** Any layout break, navigation issue, or new error

---

## 3. Missing Prerequisites

| # | Prerequisite | Status | Needed For |
|---|-------------|--------|------------|
| 1 | DBs extracted from `db_release_20261025/` | ❌ NOT extracted | All tests (DBs not available on sandbox) |
| 2 | Radar cache file exists (`scripts/output/maker_radar_EGX_*.json`) | ❌ NOT found | Tests 1, 2, 5 |
| 3 | `radar_signal_tracking` table populated | ❌ Unknown (DB missing) | Tests 3, 4 |
| 4 | Python backend running (`:8010`) | ❌ Not running | Tests requiring live data |
| 5 | Bravo's code fix delivered | ❌ Pending | Test 7 (regression check) |

### Tests that CAN run now (without DBs):
- Test 6 (Loading/Error/Empty states) — can test with missing cache
- Test 7 (pre-fix baseline screenshots) — capture current state

### Tests that NEED DBs first:
- Tests 1, 2, 3, 4, 5 — all require extracted DBs + populated cache

---

## 4. Execution Plan

**Phase A (NOW — parallel with Bravo):**
1. Capture baseline screenshots of current radar screens
2. Test empty/error/loading states (Test 6)
3. Verify API response shape matches interface types

**Phase B (after DBs extracted):**
1. Run Tests 1, 2, 3, 4, 5
2. Document PASS/FAIL for each

**Phase C (after Bravo's fix):**
1. Run Test 7 (regression check)
2. Re-run Tests 1-5 to verify fixes
3. Deliver final PASS/FAIL report

---

*This test plan is executable. No exploration needed — just run the steps and record results.*
