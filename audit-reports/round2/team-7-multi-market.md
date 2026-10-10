# Team 7 — Multi-Market Audit · Round 2 (Fix Verification)

> **Task ID**: TEAM-7-MARKET-R2
> **Scope**: Verify Round 1 multi-market fixes
> **Mode**: PURE RESEARCH (no code changes)
> **Date**: 2026-10-09 (post Phase 1-4 audit fixes)
> **Reference**: Round 1 report at `audit-reports/team-7-multi-market.md`

---

## Executive Summary

Round 2 verification of 8 Round-1 findings:

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| 1 | SQL injection in `/api/maker-radar` | ✅ **FIXED** | Parameterized query (commit `76accf9`) |
| 2 | News filter broken | ✅ **FIXED** | Now filters on `market_code` column (commit `4f1acca`) |
| 3 | No radar cache files | ❌ **NOT FIXED** | 0 `maker_radar_*.json` files; cache status = `failed` |
| 4 | TADAWUL `persona_predictions = 0` | ❌ **NOT FIXED** | Generator disabled; daily_predictor still EGX-only |
| 5 | No US MarketProfile in Python | ⚠ **PARTIAL** | Added to `market_config.py` only; `unified_config.py:MARKET_PROFILES` still missing `US` |
| 6 | Trading hours drift (TS vs Python) | ⚠ **PARTIAL** | EGX now synced to 14:30; KSE/QSE still drift |
| 7 | Hardcoded `WHERE market = 'EGX'` in live-monitor | ✅ **FIXED** | Parameterized `market` filter (commit `4f1acca`) |
| 8 | 5 duplicate alias maps | ❌ **NOT FIXED** | All 5 maps + 5 inline `KSA→TADAWUL` hacks still present |

**Net result: 3 fixed, 2 partially fixed, 3 not fixed.**

---

## Detailed Verifications

### #1 — SQL injection in `/api/maker-radar/route.ts` ✅ FIXED

**Round 1 finding**: Line 109 used unsanitized string interpolation:
```ts
const marketFilter = market === 'EGX'
  ? `AND market IN ('EGX','مصر')`
  : `AND market = '${market}'`;  // ⚠ injection risk
```

**Round 2 verification**: `src/app/api/maker-radar/route.ts:108-117` now uses parameterized queries:
```ts
// SECURITY-FIX + DEEP-MARKET-SEPARATION: parameterized query بدل interpolation
let liveRows: any[];
if (market === 'EGX') {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market IN ('EGX','مصر')`).all() as any[];
} else if (market) {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market = ?`).all(market) as any[];
} else {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0`).all() as any[];
}
```

**Fix commit**: `76accf9` ("fix(security): P0+P1 audit fixes — IDOR + SQL injection + auth gaps").

**Residual**: The fix uses raw `market = ?` rather than the canonical helper `buildMarketFilter(normalizeMarket(market))` from `src/lib/market-utils.ts`. This means alias handling (`KSA` → `TADAWUL`) is still NOT applied — sending `?market=KSA` will still return 0 rows from `stocks.db` (which stores `'TADAWUL'`). Security issue is closed; alias-handling issue is not.

---

### #2 — News filter broken ✅ FIXED

**Round 1 finding**: `news.db.market_news.market` was always `'general'` for all 4,428 rows. The `/api/news` route filtered on `market = ?` (line 130), returning 0 rows for any market-specific query.

**Round 2 verification**: `src/app/api/news/route.ts:129-135` now filters on both columns:
```ts
if (market) {
  // FIX (2026-10-09, Team 7): market_code هو الـ column اللي فيه السوق الحقيقي
  // قبل كده: conditions.push('market = ?') ← الـ market column = 'general' دائماً
  // دلوقتي: بنفلتر بـ market_code (EGX, TADAWUL, KSE, QSE, US, CRYPTO)
  conditions.push('(market_code = ? OR market = ?)');
  params.push(market, market);
}
```

Same fix applied to the COUNT query (lines 166-170).

**Schema change**: `ensureNewsTable()` now defaults `market TEXT DEFAULT 'EGX'` (line 77) instead of `'general'` — but this only affects new inserts; existing rows are unchanged.

**Residual**:
- Cannot verify production data (news.db missing in sandbox after reset).
- Aliases (`KSA`, `السعودية`) are NOT normalized before being passed to the filter — only literal market codes (`TADAWUL`, `EGX`) will match. A `?market=KSA` query still returns 0 rows because `market_code = 'KSA'` is false (the actual `market_code` value is `'TADAWUL'`).

---

### #3 — No radar cache files ❌ NOT FIXED

**Round 1 finding**: 0 `maker_radar_*.json` cache files on disk in `scripts/output/`. Only `.md` summary files existed. Radar endpoint always returned `503 warming_up: true`.

**Round 2 verification**:

```
$ find /home/z/my-project -name "maker_radar_*.json"
(empty)

$ ls scripts/output/ | grep maker_radar
maker_radar_EGX_20261004.md       ← .md summary, NOT JSON
maker_radar_TADAWUL_20261004.md   ← .md summary, NOT JSON
maker_radar_stock_detail.png
maker_radar_tab.png
```

**Cache status file** (`db/radar_cache_status.json`):
```json
{
  "last_warmup_started_at": "2026-10-09T17:02:40.145Z",
  "last_warmup_finished_at": "2026-10-09T17:02:40.222Z",
  "last_warmup_duration_ms": 54,
  "last_warmup_status": "failed",
  "last_error": "exit code 1",
  "cache_file": null,
  "cache_generated_at": null,
  "cache_age_seconds": null,
  "db_source": null
}
```

**Root cause**: The Python script `scripts/maker_radar.py` fails with exit code 1 in the sandbox because `stocks.db` and `data_engine.db` are missing (sandbox reset side-effect). No code was changed to bootstrap a cache fallback, so the radar feature remains non-functional in the sandbox.

**Note**: In production with full DBs the warmup may succeed, but no defensive fallback was added — if `maker_radar.py` ever fails, the entire radar stays at `warming_up: true` indefinitely.

---

### #4 — TADAWUL `persona_predictions = 0` ❌ NOT FIXED

**Round 1 finding**: `predictions.db.persona_predictions` had 1,514 EGX + 508 KSE + 198 QSE + **0 TADAWUL** rows. Persona tab for TADAWUL users showed empty state.

**Round 2 verification**:

1. **Generator script disabled**: `vps-service/scripts/generate_persona_predictions.py:52-53`:
   ```python
   # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
   print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
   return
   ```
   The script returns immediately without writing any rows. TADAWUL gap not addressed.

2. **Daily predictor EGX-only**: `vps-service/jobs/daily_predictor.py:387-433` still contains the EGX-MARKET-ISOLATION gate:
   ```python
   # EGX-MARKET-ISOLATION (2026-08-30): فلتر صارم لـ EGX canonical فقط.
   if _egx_gate_available:
       result = filter_egx_tickers_detailed(raw_tickers)
       tickers = result['accepted']
   ```
   Filter applied at lines 425, 467, 503 — non-EGX tickers are explicitly rejected.

3. **Persona_predictions writing disabled**: `daily_predictor.py:3470`:
   ```python
   # ── UNIFIED-BALANCED-ONLY (2026-08-30): تعطيل persona_predictions writing ──
   ```
   No persona_predictions are written at all (for any market).

4. **Production DB content**: Sandbox `predictions.db` has 0 rows in `predictions` table and no `persona_predictions` table at all. Cannot verify the production state directly, but the code paths that would generate TADAWUL persona predictions are all disabled or filtered out.

**Residual**: No new generator, no removal of EGX-MARKET-ISOLATION, no re-enable of persona writing. The TADAWUL gap remains structurally impossible to fill with current code.

---

### #5 — No US MarketProfile in Python ⚠ PARTIALLY FIXED

**Round 1 finding**: `vps-service/config/unified_config.py:MARKET_PROFILES` had entries for `EGX, KSA, KSE, QSE, DFM, CRYPTO` — but NOT `US`. The `UnifiedConfig.__init__()` raises `ValueError("سوق غير معروف: US...")` for any US analysis request.

**Round 2 verification**:

| File | Dict | Has `US`? | Used by |
|------|------|-----------|---------|
| `vps-service/config/market_config.py:270-306` | `MARKET_CONFIGS` | ✅ YES (added) | `get_market_config()`, `is_market_open()`, simple display |
| `vps-service/config/unified_config.py:336-624` | `MARKET_PROFILES` | ❌ **NO** (still missing) | `UnifiedConfig`, `get_market_profile()`, `CoreScoringEngine` |

**Critical**: `unified_config.py:865-866`:
```python
def get_market_profile(market_code: str) -> Optional[MarketProfile]:
    return MARKET_PROFILES.get(market_code.upper())
```

`unified_config.py:761-762`:
```python
if not base_market:
    raise ValueError(f"سوق غير معروف: {market_code}. الخيارات: {list(MARKET_PROFILES.keys())}")
```

`MARKET_PROFILES.keys()` returns `['EGX', 'KSA', 'KSE', 'QSE', 'DFM', 'CRYPTO']` — no `'US'`. So `UnifiedConfig(market_code='US')` still raises `ValueError`, which surfaces as a 500 error in `/api/v2/unified/analyze`.

**The US MarketProfile was added only to the simpler `market_config.py` (used by display/status helpers), not to the analyzer-critical `unified_config.py`.**

**Residual**: Any US stock analysis request that reaches `CoreScoringEngine` (via `UnifiedConfig`) still crashes. Only `is_market_open('US')` and the simpler display paths work.

---

### #6 — Trading hours drift (TS vs Python) ⚠ PARTIALLY FIXED

**Round 1 finding**: EGX/KSE/QSE had different trading hours in `market-hours.ts` (TS) vs `market_config.py` (Python).

**Round 2 verification** (after commit `4f1acca`):

| Market | `market_config.py` (Python) | `market-hours.ts` (TS, after fix) | Match? |
|--------|------------------------------|-----------------------------------|--------|
| **EGX** | 10:00 - 14:30 Cairo | 10:00 - 14:30 Cairo (line 61) | ✅ **SYNCED** |
| KSA | 10:00 - 15:00 Riyadh | 10:00 - 15:00 Riyadh (line 167) | ✅ |
| **KSE** | 09:00 - 13:30 Kuwait | 08:00 - 12:45 Kuwait (line 191) | ❌ **STILL DRIFT** (1h open + 45m close diff) |
| **QSE** | 09:00 - 13:00 Doha | 09:30 - 13:00 Doha (line 214) | ❌ **STILL DRIFT** (30m open diff) |
| US | 09:30 - 16:00 ET | 09:30 - 16:00 ET (line 236) | ✅ |
| CRYPTO | 24/7 | 24/7 | ✅ |

**Only EGX has been synced** (commit `4f1acca` message: "TS: 10:00-15:00 → 10:00-14:30 (matching Python market_config.py)"). The Phase 4 fix took Python's `14:30` as the truth and synced TS to it.

KSE/QSE drift is the reverse direction: TS was updated in Phase 3 (`b18b3f2`) to use official exchange hours (08:00-12:45 KSE, 09:30-13:00 QSE), but `market_config.py` was NEVER updated to match. The Round 2 fix did not address KSE/QSE either.

**Multi-market radar UTC constants** (`src/app/api/maker-radar/multi-market/route.ts:149-156`) are also unchanged:

| Market | route.ts UTC | TS local → UTC equivalent | Match? |
|--------|--------------|----------------------------|--------|
| EGX | 08:00 - 12:30 | 10:00-14:30 Cairo UTC+2 → 08:00-12:30 UTC | ✅ |
| KSE | 06:00 - 10:30 | 08:00-12:45 Kuwait UTC+3 → 05:00-09:45 UTC | ❌ 1h open drift |
| QSE | 06:00 - 10:00 | 09:30-13:00 Doha UTC+3 → 06:30-10:00 UTC | ❌ 30m open drift |
| US | 14:30 - 21:00 | 09:30-16:00 ET → 14:30-21:00 UTC (EST only) | ⚠ DST not handled — should be 13:30-20:00 during EDT (Mar-Nov) |

**Residual**: KSE/QSE drift between TS and Python remains. Multi-market radar UTC constants are stale and DST-ignorant.

**Cosmetic display bug**: `market-hours.ts:85, 88, 97, 100` still display `"10:00 ص - 3:00 م"` (3:00 PM) in the success path and catch block, despite the actual close at 14:30 (2:30 PM). Display strings are inconsistent with the logic.

---

### #7 — Hardcoded `WHERE market = 'EGX'` in live-monitor ✅ FIXED

**Round 1 finding**: `src/app/api/live-monitor/route.ts:192` had hardcoded `WHERE market = 'EGX'`, showing EGX stocks regardless of selected market.

**Round 2 verification**: `src/app/api/live-monitor/route.ts:117-121, 196-202` now reads the `market` param and builds a parameterized filter:
```ts
// MULTI-MARKET-FIX (2026-10-09, Team 7): إضافة market param بدل hardcoded EGX
const url = request ? new URL(request.url) : null;
const market = url?.searchParams.get('market') || 'EGX';
const marketFilter = market === 'EGX' ? "market IN ('EGX','مصر')" : "market = ?";

// ... later in SQL:
const selectSql = `
  SELECT ... FROM stocks
  WHERE ${marketFilter}
  ORDER BY volume DESC LIMIT 30
`;
const stockRows = market === 'EGX'
  ? stocksDb.prepare(selectSql).all()
  : stocksDb.prepare(selectSql).all(market);
```

**Fix commit**: `4f1acca` ("fix(phase1-4): colors + market hours + live-monitor + conflict resolve").

**Residual**: Same pattern as #1 — uses raw `market = ?` rather than the canonical `buildMarketFilter(normalizeMarket(market))`. Aliases like `KSA` are not normalized → query returns 0 rows for `market=KSA` since stocks.db stores `'TADAWUL'`.

---

### #8 — 5 duplicate alias maps ❌ NOT FIXED

**Round 1 finding**: 5 different alias maps existed across the codebase with contradicting canonical forms (some say `TADAWUL → KSA`, others say `TADAWUL → TADAWUL`). Plus 5 inline `KSA → TADAWUL` hacks in 3 components.

**Round 2 verification — ALL 5 MAPS STILL PRESENT**:

| # | File | Symbol | Status |
|---|------|--------|--------|
| 1 | `src/lib/store.ts:586-588` | `MARKET_CODES['TADAWUL'] = 'KSA'` | ❌ Still present (contradiction) |
| 2 | `src/lib/market-data-access.ts:403-405` | `MARKET_ALIASES` (`TADAWUL/KSA/SAUDI` → `'TADAWUL'`) | ❌ Still present (duplicate) |
| 3 | `src/lib/egx-db.ts:449-451` | `FRONTEND_TO_ARABIC_MARKET` (`TADAWUL/KSA` → `'السعودية'`) | ❌ Still present |
| 4 | `src/lib/data-engine-db.ts:216` | `marketCodeToArabic()` (duplicate of #3) | ❌ Still present |
| 5 | `src/app/api/predictions/daily-picks/route.ts:26-29` | `MARKET_MAP` (`KSA → TADAWUL`) | ❌ Still present (inline duplicate) |

**Inline `KSA → TADAWUL` hacks — ALL 5 STILL PRESENT**:

```
src/modules/market-analysis/components/PersonaTab.tsx:1412
src/modules/market-analysis/components/PersonaTab.tsx:1512
src/modules/market-analysis/components/PersonaTab.tsx:1717
src/modules/market-analysis/components/MarketStatusTab.tsx:232
src/modules/market-analysis/components/PredictionsTab.tsx:503
```

All five sites still use the fragile pattern:
```ts
const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
```

**The canonical helper** (`src/lib/market-utils.ts:normalizeMarket()`, `buildMarketFilter()`, `pythonMarketCode()`, `sqlMarketVariants()`) **exists and is correct**, but it is still applied only to the original 5 routes from Phase 3 (`b18b3f2`). No additional routes were migrated in Round 2.

**Contradiction not resolved**: `store.ts:MARKET_CODES['TADAWUL'] = 'KSA'` (sends KSA to APIs) vs `market-utils.ts:normalizeMarket('KSA') = 'TADAWUL'` (canonical form is TADAWUL). The two maps still disagree about what TADAWUL "is".

---

## Additional Observations

### A. `DevelopmentNotice.tsx` still has invalid market codes

`src/modules/dashboard/components/DevelopmentNotice.tsx:9`:
```ts
const DEVELOPMENT_MARKETS: MarketType[] = ['TADAWUL', 'KSE', 'DFM', 'BSE', 'QSE', 'US'];
```

`'DFM'` and `'BSE'` are NOT members of `MarketType` (`'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO'`). This is a TypeScript type error suppressed by the 1,258-error baseline. NOT FIXED (this was Round 1 P2 finding, not in the 8 verification items but related to alias-map issue).

### B. Multi-market radar UTC constants unchanged since Round 1

`src/app/api/maker-radar/multi-market/route.ts:149-156` still has the same wrong UTC constants flagged in Round 1 (KSE/QSE/US DST). No commits touched this section since `b18b3f2` (Phase 3, which only added the file).

### C. `real_predictions` table still lacks `market` column

Cannot verify directly (predictions.db in sandbox has 0 rows / no real_predictions table). No migration script was added to backfill a `market` column. NOT FIXED.

### D. Production DB state in sandbox

After the latest sandbox reset, only `predictions.db` (45KB, 0 rows), `custom.db`, and `auth.db` remain. The original `stocks.db` (34MB), `news.db` (18MB), `price_history.db` (53MB), `data_engine.db` (60MB), `intraday.db` (76MB), and `historical.db` (42MB) are all missing.

Per commit `4f1acca`: "باقي 500/404 = sandbox-specific (DBs مش موجودة في sandbox). الإنتاج عنده بيانات كاملة → هتشتغل صح."

This means verifications #3 and #4 cannot be reproduced at the data level in the sandbox; only the code-level state was inspected. Production-side verification will need to happen on a populated sandbox or live.

---

## Summary Table — What's Left to Fix

| # | Item | Severity | Effort |
|---|------|----------|--------|
| 1 | Apply `buildMarketFilter(normalizeMarket(market))` to `/api/maker-radar` + `/api/live-monitor` instead of raw `market = ?` | 🟠 P1 | Low |
| 2 | Apply `normalizeMarket()` in `/api/news` route to handle `KSA`/`السعودية` aliases | 🟠 P1 | Low |
| 3 | Bootstrap radar cache or add a graceful fallback (currently `warming_up: true` forever on cache miss) | 🔴 P0 | Medium |
| 4 | Re-enable TADAWUL persona_predictions generator (or write a TADAWUL-specific backfill script) | 🔴 P0 | Medium-High |
| 5 | Add `'US'` entry to `unified_config.py:MARKET_PROFILES` (not just `market_config.py`) | 🟠 P1 | Low |
| 6 | Sync KSE/QSE hours in `market_config.py` to match `market-hours.ts` (08:00-12:45 / 09:30-13:00) | 🟠 P1 | Low |
| 7 | Fix multi-market radar UTC constants (compute from local hours + DST-aware) | 🟠 P1 | Medium |
| 8 | Consolidate 5 alias maps → use `market-utils.ts` helpers everywhere | 🟠 P1 | High (touch many files) |
| 9 | Remove 5 inline `KSA→TADAWUL` hacks in `PersonaTab.tsx`/`MarketStatusTab.tsx`/`PredictionsTab.tsx` | 🟡 P2 | Low |
| 10 | Remove `'DFM'`, `'BSE'` from `DevelopmentNotice.tsx:DEVELOPMENT_MARKETS` | 🟡 P2 | Trivial |
| 11 | Fix EGX display strings (`market-hours.ts:85, 88, 97, 100`) — still say "3:00 م" instead of "2:30 م" | 🟡 P2 | Trivial |

---

## Methodology

- **Read** `worklog.md` last 400 lines (Phase 3 + Phase 4 + admin panel + UnifiedTable upgrade).
- **Inspected** code at the specific lines flagged in Round 1 report.
- **Cross-checked** between `src/lib/market-hours.ts` (TS source of truth) and `vps-service/config/market_config.py` (Python) for all 6 markets.
- **Verified** `MARKET_PROFILES` dict contents in `vps-service/config/unified_config.py:336-624` (6 entries: EGX/KSA/KSE/QSE/DFM/CRYPTO — no US).
- **Grepped** for all 5 alias maps and 5 inline `KSA→TADAWUL` hacks — all still present.
- **Inspected** `db/radar_cache_status.json` (warmup_status: failed, cache_file: null).
- **Inspected** `scripts/output/` directory listing — only `.md` summary files, no `.json` cache.
- **Inspected** `generate_persona_predictions.py` (disabled by Rule 35) and `daily_predictor.py` EGX-MARKET-ISOLATION gate (lines 387, 425, 467, 503) + disabled persona writing (line 3470).
- **Git history**: Inspected commits `76accf9` (security), `4f1acca` (Phase 1-4 fixes), `b18b3f2` (Phase 3 segregation), `891f2f8` (audit migration scripts). No commits addressed #3, #4, #5 (in unified_config), #6 (KSE/QSE), or #8.

**Constraints honored**:
- ❌ NO code modifications.
- ❌ NO communication with other teams.
- ✅ Focused exclusively on verifying the 8 Round 1 multi-market findings.
