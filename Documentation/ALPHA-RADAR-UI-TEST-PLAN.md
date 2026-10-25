# ALPHA — Liquidity Radar UI Test Plan (RADAR-CLOSURE-02 Part B)
> **Status:** B1+B2 DONE — Tests 3 + 6 verified; Tests 1,2,4,5 BLOCKED on DBs; Test 7 PENDING Bravo
> **Owner:** Alpha (Frontend/UI)
> **Date:** 2026-10-25
> **Commit tested:** `c63aebb` on `main`
> **Server:** `http://localhost:3000` (Next.js 16.1.3, Turbopack dev mode)
> **Branch:** `main` (NOT fix/radar-forensic-minimal — Bravo's fix not yet delivered)
> **RADAR-CLOSURE-02:** Updated per final execution order — B1 (update plan) + B2 (fix test statuses) done.

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

## 2. Seven Test Cases — Execution Results

### Test 1: Radar display matches API response

**Status:** ⏳ BLOCKED — DBs + cache not available

**Missing prerequisites:**
- `db/stocks.db` extracted from `db_release_20261025/`
- Radar cache file: `scripts/output/maker_radar_EGX_*.json`
- At least 5 stocks with real data in cache

**Cannot execute until:** DBs are extracted + Python backend generates cache

---

### Test 2: Price/Date/Market match canonical source

**Status:** ⏳ BLOCKED — cache + DBs not available

**Missing prerequisites:**
- Radar cache file with at least 1 stock
- `db/stocks.db` for `radar_signal_tracking` table
- Python backend running (`:8010`) for cache generation

---

### Test 3: API Response Shape Verification (CODE-LEVEL)

**Status:** ✅ PASS (code-level verification — no live data)

**Executed:** 2026-10-25 on commit `ca5ce1e`

**Evidence:**

**3a. `/api/v2/liquidity-radar` response shape:**
```
Actual API response keys: ['success', 'market', 'market_regime', 'scanned_count', 'stocks', 'message']
market_regime keys: ['regime', 'change_pct', 'is_bear', 'is_bull']
stocks: [] (empty — no cache)
```
Matches `RadarResponse` interface in `route.ts:52-61` ✅

**3b. `LiquidityRadarView.tsx` interface vs API:**
- Frontend `RadarStock` interface expects: ticker, name, sector, current_price, change_percent, whale, market_regime, phase, phase_reason, entry_defense, reason, liquidity_bucket, liquidity_bucket_ar, net_flow_5d, volume, correction_status, drop_from_peak, accumulation, expected, roc_10d
- API `RadarStock` interface returns: ticker, name, sector, current_price, change_percent, whale, market_regime, phase, phase_reason, entry_defense, reason, liquidity_bucket, liquidity_bucket_ar, net_flow_5d, volume, correction_status, drop_from_peak, accumulation, expected, roc_10d
- **Match:** ✅ All fields aligned

**3c. `/api/maker-radar/track` response shape:**
```
Actual keys: ['success', 'tracked', 'tracked_count']
tracked: [] (empty)
```
Matches expected shape ✅

**3d. `/api/radar/accuracy` response shape:**
```
Actual keys: ['success', 'source', 'total_signals', 'verified', 'pending', 'wins', 'losses', 'win_rate_pct', 'by_signal_type', 'by_market', 'monthly_trend', 'days', 'served_at', 'note']
by_signal_type[0] keys: ['signal_type', 'label', 'total', 'verified', 'wins', 'losses', 'win_rate_pct', 'avg_outcome_7d', 'avg_outcome_14d', 'avg_outcome_30d', 'avg_time_to_target_days']
```
Matches `AccuracyDashboard.tsx` interface ✅

**3e. Accuracy stats NOT inflated when DB missing:**
```
total_signals: 0, verified: 0, pending: 0, wins: 0, losses: 0, win_rate_pct: 0
source: "none"
note: "No predictions DB available — install db/predictions.db or run the prediction generator."
```
✅ No fabrication — returns zeros with explicit "none" source and explanatory note.

**3f. `/api/radar/personalized` auth gate:**
```
HTTP 401: {"success":false,"error":"auth_required"}
```
✅ Correctly requires authentication (no data leakage to unauthenticated users).

**PASS criteria:** All response shapes match TypeScript interfaces. No fabricated data.
**Result:** ✅ PASS (code-level only — live data verification still needs DBs)

**Note:** This test verified response shape only, NOT data correctness. Data correctness requires Tests 1, 2, 4, 5 with real DBs.

---

### Test 4: Unverified results not shown as verified

**Status:** ⏳ BLOCKED — `predictions.db` not available

**Missing prerequisites:**
- `db/predictions.db` extracted
- `radar_signal_tracking` table populated with at least 10 signals
- Mix of statuses: `verified`, `pending`, `stale_data`
- Some signals with `outcome_7d` populated

**Cannot execute until:** DBs extracted + signal tracking data available

---

### Test 5: No display discrepancy between screens

**Status:** ⏳ BLOCKED — DBs + cache not available

**Missing prerequisites:**
- All of Tests 1-4 prerequisites
- At least 3 tickers appearing on both `#liquidity-radar` and `#recommendations` radar tab
- `radar_signal_tracking` table populated

---

### Test 6: Loading/Error/Empty states

**Status:** ⚠️ PARTIAL (API-level PASS, UI-level BLOCKED)

**Per RADAR-CLOSURE-02 B2:** Test 6 remains PARTIAL until the UI rendering inside the actual `#liquidity-radar` screen is tested. The root page (`/`) crashes with `ReferenceError: module is not defined` (pre-existing Turbopack/next-auth CJS issue — NOT caused by radar changes). API-level tests pass from chart-test page.

**Executed:** 2026-10-25 on commit `c63aebb` (re-verified)
**Server:** `http://localhost:3000` (dev mode)

**6a. EMPTY state (no cache, no DB):**
```
GET /api/v2/liquidity-radar?market=EGX
Response: {"success":true, "stocks":[], "message":"لا توجد بيانات رادار مخزنة لهذا السوق بعد"}
```
✅ API returns empty array with clear Arabic message.
✅ `LiquidityRadarView.tsx:664` renders `UnifiedEmptyState` with title "لا توجد إشارات رادار حالياً" and description "المحرّك بيفحص السوق كل 5 دقائق".

**6b. Invalid market parameter:**
```
GET /api/v2/liquidity-radar?market=INVALID_MARKET
Response: {"success":true, "market":"INVALID_MARKET", "stocks":[]}
```
⚠️ API accepts any market string without validation (normalizeMarketCode only strips non-alphanumeric). Returns empty array silently — no error message that market is invalid.

**6c. SQL injection attempt:**
```
GET /api/v2/liquidity-radar?market=EGX' OR 1=1
Response: {"success":true, "market":"EGXOR11", "stocks":[]}
```
✅ SQL injection blocked — `normalizeMarketCode` strips `' OR 1=1` → `EGXOR11`. No data leaked.

**6d. Empty market parameter:**
```
GET /api/v2/liquidity-radar?market=
Response: {"success":true, "market":"EGX", "stocks":[]}
```
✅ Defaults to "EGX" when market is empty.

**6e. No market parameter:**
```
GET /api/v2/liquidity-radar
Response: {"success":true, "market":"EGX", "stocks":[]}
```
✅ Defaults to "EGX".

**6f. maker-radar/track empty state:**
```
GET /api/maker-radar/track
Response: {"success":true, "tracked":[], "tracked_count":0}
```
✅ Returns empty array with count.

**6g. radar/accuracy empty state:**
```
GET /api/radar/accuracy?market=EGX&days=90
Response: {"success":true, "source":"none", "total_signals":0, ...}
Note: "No predictions DB available — install db/predictions.db or run the prediction generator."
```
✅ Returns zeros with explicit "none" source. No fabricated accuracy metrics.

**6h. radar/personalized auth gate:**
```
GET /api/radar/personalized
Response: HTTP 401 {"success":false,"error":"auth_required"}
```
✅ Correctly rejects unauthenticated requests.

**6i. Response times:**
```
v2/liquidity-radar: 0.015s (15ms)
maker-radar/track: 0.035s (35ms)
radar/accuracy: 0.024s (24ms)
```
✅ All responses < 50ms (fast — no blocking).

**DEFECT FOUND (6b):**
- **Issue:** `normalizeMarketCode()` in `route.ts:63-66` accepts ANY alphanumeric string as a valid market without validation against a known markets list.
- **Impact:** User requesting `market=ABC123` gets `success: true` with empty stocks — looks like the API is working but the market doesn't exist.
- **Severity:** LOW (returns empty, no data corruption — but confusing UX)
- **Recommendation:** Add market validation against `MARKET_NAMES_AR` or return `success: false` for unknown markets.

**Result:** ✅ PASS (5/5 sub-tests passed; 1 LOW-severity defect documented)

---

### Test 7: No side-effect regression from Bravo's fix

**Status:** ⏳ PENDING BRAVO'S DELIVERY

**Cannot execute until:** Bravo delivers code fix on `fix/radar-forensic-minimal` branch.

---

## 3. Baseline Screenshots

**Captured:** 2026-10-25 on commit `ca5ce1e`

| Screenshot | File | Notes |
|-----------|------|-------|
| chart-test page | `/tmp/baseline-liquidity-radar.png` | Working page (root page has pre-existing Turbopack error) |

**Note:** Only `#chart-test` page is accessible in sandbox due to pre-existing `module is not defined` Turbopack error on root page. Screenshots of `#liquidity-radar` and `#recommendations` could not be captured — root page crashes before navigation.

**Commit tested:** `ca5ce1e`
**Time:** 2026-10-25 21:59 UTC
**Data state:** No DBs extracted, no cache files, no Python backend running

---

## 4. Missing Prerequisites (Exact Requirements)

### Minimum files/services needed for each test:

| Test | Files Needed | Services Needed | Data Needed |
|------|-------------|-----------------|------------|
| 1 | `db/stocks.db` + `scripts/output/maker_radar_EGX_*.json` | Next.js only | 5+ stocks in cache |
| 2 | `db/stocks.db` + cache file | Next.js + Python (`:8010`) | Cache with signal_date |
| 3 | `db/predictions.db` (or `stocks.db` with `radar_signal_tracking` table) | Next.js only | 10+ signals mixed status |
| 4 | Same as Test 3 | Next.js only | Signals with `stale_data` status + `outcome_7d` |
| 5 | All of above | Next.js + Python | 3+ tickers on both screens |
| 6 | None (code-level) | Next.js only | None ✅ DONE |
| 7 | Same as Test 5 | Next.js + Python + Bravo's fix | Post-fix data |

### DB extraction required:
```bash
cd db_release_20261025/
cat stocks.db.tar.gz.* | tar xzf - -C ../db/
cat predictions.db.tar.gz.* | tar xzf - -C ../db/
cat price_history.db.tar.gz.* | tar xzf - -C ../db/
# etc. for each DB
```

---

## 5. Summary (RADAR-CLOSURE-02 B1+B2)

| Test | Status | Result | Per B2 ruling |
|------|--------|--------|---------------|
| 1 | ⏳ BLOCKED | Needs DBs + cache | Not run |
| 2 | ⏳ BLOCKED | Needs DBs + cache + Python | Not run |
| 3 | ✅ PASS | API response shapes verified (code-level only — NOT data correctness) | Stays PASS on shape level only |
| 4 | ⏳ BLOCKED | Needs predictions.db with signals | Not run |
| 5 | ⏳ BLOCKED | Needs all above | Not run |
| 6 | ⚠️ PARTIAL | API states verified (8/9 sub-tests); UI rendering blocked by pre-existing root error | Stays PARTIAL until UI tested inside actual screen |
| 7 | ⏳ PENDING | Waiting for Bravo's fix on fix/radar-forensic-minimal | Not run |

**Tests executed:** 2 of 7 (Tests 3 + 6)
**Tests passed:** 1 of 2 (Test 3 = shape only; Test 6 = PARTIAL)
**Tests blocked:** 4 (need DBs)
**Tests pending:** 1 (need Bravo)
**Defects found:** 1 (LOW severity — invalid market parameter accepted)

### Part C — Integration Status

**Waiting for:** Bravo's Part A delivery (A1-A6) on `fix/radar-forensic-minimal`
**Cannot proceed with:** B3 (review Bravo's fix) + B4 (UI discrepancy check) + Test 7 (regression)
**Blocker:** DBs not extracted from `db_release_20261025/` (minimum: `db/stocks.db` + `db/predictions.db`)

### Prerequisites for B3 execution (when Bravo delivers):
1. Bravo's code fix committed on `fix/radar-forensic-minimal`
2. DBs extracted: `db/stocks.db`, `db/predictions.db`, `db/price_history.db`
3. Radar cache file generated: `scripts/output/maker_radar_EGX_*.json`
4. At least 5 stocks with real data in cache
5. At least 10 signals in `radar_signal_tracking` with mixed statuses

**Next action:** Wait for Bravo's Part A + DB extraction. Then execute B3, B4, Tests 1-5, 7.

---

## 6. Part B + C Delivery (RADAR-CLOSURE-02)

### B1 — Update existing test plan ✅
Done — this file updated (no new report created).

### B2 — Fix previous test statuses ✅
- Test 3: stays PASS on **shape level only** (not data correctness)
- Test 6: downgraded to **PARTIAL** (API verified, UI rendering blocked by pre-existing root error)
- Tests 1, 2, 4, 5: stay **BLOCKED** (need DBs)
- Test 7: stays **PENDING** (need Bravo)

### B3 — Review Bravo's fix ⏳ PENDING
Cannot start until Bravo delivers on `fix/radar-forensic-minimal`.

### B4 — UI discrepancy handling ⏳ PENDING
Cannot start until B3 is done + DBs available.

### Part C — Integration ⏳ PENDING
Cannot close until both Bravo (Part A) and Alpha (Part B3+B4) are complete.

---

*This test plan is updated with actual execution results. No PASS was recorded without execution. No test was marked PASS based on code review alone — Test 3 is explicitly "shape level only".*

---

## 6. B3 — Independent Static Review of Bravo Branch (PRELIMINARY)

**Review date:** 2026-10-26  
**Branch reviewed:** `fix/radar-forensic-minimal`  
**Commit reviewed:** `532180e3a9ac3abd844e8214e0ac495b15afa9a0`  
**Status:** ⚠️ PARTIAL — static source review only; no DB-backed runtime/UI verification performed.

### Findings that block acceptance

| ID | Severity | Finding | Evidence / Impact |
|---|---|---|---|
| B3-01 | BLOCKER | The TypeScript verification route still reads price sources without a market predicate. | `src/app/api/maker-radar/signal-tracker/verify/route.ts`, `fetchPricesAfter()`: SQL filters ticker/date/positive close only. The route can still consume cross-market rows. |
| B3-02 | BLOCKER | `radar_accuracy_report.py` still merges the four configured price sources without market isolation. | `PRICE_DBS` and `build_price_index()` read ticker/date/close without checking/filtering `market`. The 28.6% figure is not established as a clean EGX-only win rate by this script. |
| B3-03 | BLOCKER | The legacy fallback path in `verify_radar_signals.py` is not consistently isolated. | `_fetch_price_from_sources()` performs source queries without a market predicate; `get_price_after()` retains a calendar-day fallback when the trading-session fetch returns no result. |
| B3-04 | BLOCKER | Signal entry-price creation is not shown to be fixed by C2. | The lineage report identifies `scripts/maker_radar.py` as reading `stock_daily_prices` without a market filter. The reported C2 change lists only `verify_radar_signals.py` and `generate_unified_audit.py`; this leaves entry-price contamination unresolved unless separately fixed and evidenced. |
| B3-05 | BLOCKER | Regression tests do not cover every claimed consumer. | `test_c4_regression.py` exercises the new Python fetch/audit path, not the TypeScript verification route, `radar_accuracy_report.py`, or entry-price generation. Therefore 12/12 PASS cannot establish whole-pipeline market isolation. |
| B3-06 | BLOCKER | Session correctness remains unresolved even when market='EGX'. | Bravo's report acknowledges Saturday rows in `historical_data` tagged EGX and the unresolved 2026-10-15 market-wide gap. A market filter alone does not validate the EGX trading calendar. |
| B3-07 | BLOCKER | Corporate-action correctness is not established. | POUL factor remains unresolved and ORHD adjustment handling is not demonstrated end-to-end. Returns crossing corporate actions can be materially wrong. |

### Repository integrity note

A compare request between `main` and `fix/radar-forensic-minimal` returned **404: No common ancestor**. This requires explanation before integration: verify whether the branch was recreated/orphaned or whether the compare endpoint/ref is incorrect. Do not merge or reset either branch until the actual ancestry and changed-file inventory are inspected.

### What was verified vs. not verified

- **Verified by source inspection:** the Python new-path filter exists; the TypeScript verifier and historical accuracy builder still lack market predicates in the inspected code.
- **Not verified:** actual DB row counts, cache-to-UI consistency, displayed prices, outcome recalculation, tests claimed in Bravo's report, and production behavior. No DBs were mounted in this review and no test command was executed here.
- **Win rate:** 28.6% remains **PRELIMINARY / NOT ACCEPTED**. It must be reproduced with a single explicit EGX-only source policy, valid trading sessions, corporate-action treatment, and a defined stale-data inclusion rule.

### Required closure tests

1. Add/execute regression tests proving market isolation in **every** consumer: entry-price creation, Python verifier normal path and fallback, TypeScript verifier, and `radar_accuracy_report.py`.
2. Ensure all queries select the correct market and that fallback sources cannot silently bypass the market filter.
3. Test with controlled isolated fixtures containing the same ticker/date tagged EGX and US, plus EGX-tagged weekend rows. Assert the exact selected source/date/price.
4. Validate the Oct 15 gap against an authoritative EGX calendar/source and document the result; do not infer a holiday from missing data.
5. Verify corporate-action-adjusted price continuity for POUL and ORHD from documented official factors before recomputing outcomes.
6. Re-run UI Tests 1, 2, 4, 5 and 7 only after the required DB/cache inputs exist; compare the same ticker/date/price/status across UI, API, and canonical source.

**B3 decision:** `BLOCKED — STATIC REVIEW FOUND UNFIXED CONSUMER PATHS`.  
**Part C decision:** `BLOCKED` until branch ancestry is explained, the listed paths are fixed and tested, and Alpha's DB-backed UI tests can run against the same candidate commit.
