# P0 #8 — Database Table Unification Report

**Task ID:** P0-8-DB-UNIFY
**Agent:** Database Architect (unify duplicate tables)
**Date:** 2026-09-27
**Backups:** `db/stocks.db.bak-unify`, `db/predictions.db.bak-unify`, `db/auth.db.bak-unify`, `db/data_engine.db.bak-unify`
**Dropped-row sidecars:** `scripts/output/db_unify_dropped_*.json` (4 files)
**Drop log:** `scripts/output/db_unify_drops_20260927T164538Z.json`

---

## Executive Summary

- **Duplicate tables inventoried:** 12 (per AUDIT_DATABASES report)
- **Tables safely DROPPED:** 9 (across 4 DBs)
- **Tables that needed NO drop:** 3 (`portfolios`, `User`, `Post`, `user_trades` — only existed in one DB; the audit report counted them as duplicates but they were already consolidated)
- **DBs backed up:** 4 (`stocks.db`, `predictions.db`, `auth.db`, `data_engine.db`)
- **Total rows dropped:** 333 (3 + 0 + 0 + 0 + 0 + 17 + 17 + 0 + 296)
- **Total rows preserved as JSON sidecars:** 333 (every dropped row with data was dumped before DROP)
- **Code files updated:** 2 (`src/lib/cache/precomputed-cache.ts`, `vps-service/utils/db_paths.py`)
- **Lint status:** ✅ `bun run lint` exit 0
- **App health:** ⚠️ HTTP 500 on `/` (pre-existing `middleware.ts` edge-runtime crypto issue from P0-11-AUTH, NOT caused by this task — confirmed below)
- **Verification:** ✅ All 9 dropped tables confirmed absent; all 11 canonical tables confirmed present with expected row counts

---

## Per-Table Decisions

| # | Table | Canonical DB | Drop From | Rows (canonical) | Rows (duplicate) | Action | Reason |
|---|-------|-------------|----------|-------------------|------------------|--------|--------|
| 1 | `gold_prices` | `data_engine.db` | `stocks.db` | 187,153 (live, 2026-09-26) | 3 (default seed, 2026-06-03) | ✅ DROPPED | 3 rows are `source='default'` placeholder values from June 2-3; data_engine.db is written every 5 min by `metals_forex_fetcher.py`. Query in `precomputeGoldData()` was already failing because the stocks.db schema has no `change` column — code now reads from data_engine via `getLiveEgyptGoldPrices()`. |
| 2 | `cached_analysis` | `stocks.db` | `predictions.db` | 143 (fresh, 2026-09-26) | 0 | ✅ DROPPED | Different schema (18 vs 39 cols). predictions.db version is an intentionally-different fallback cache (`migrator.py:749-776`); recreated on schema-build. Wrapped in try/except in `ai_predictions_routes.py:611` (existence-check at `:407`). |
| 3 | `learned_lessons` | `predictions.db` | `stocks.db` | 19,464 (2026-09-24) | 0 | ✅ DROPPED | Different schema (8 vs 10 cols). Empty table; canonical has all the AI lessons. No code reads `stocks.db.learned_lessons`. |
| 4 | `ExpertRecommendation` (auth) | `stocks.db` | `auth.db` | 127 (fresh, 2026-09-07) | 17 (stale seed, 2026-06-03) | ✅ DROPPED | 17 rows with `exp001-exp017` ids (different from stocks.db's UUID ids). 16/17 are direct duplicates by (symbol, recommendation_date). 1 unique (FWRY @ 2026-06-03) preserved to JSON. No code references `auth.db.ExpertRecommendation`. |
| 5 | `ExpertRecommendation` (pred) | `stocks.db` | `predictions.db` | 127 (fresh, 2026-09-07) | 17 (stale seed, 2026-06-03) | ✅ DROPPED | Identical 17 rows to auth.db version (17/17 overlap by id+symbol+date). `unified_learning_engine.py:1224` uses `'ExpertRecommendation' in tables` existence check — gracefully skipped when missing. |
| 6 | `egksco_price_history` | `data_engine.db` | `stocks.db` | 13,246 (2026-09-08) | 0 | ✅ DROPPED | Empty table. All readers (`v38_backtest_engine.py`, `daily_closer.py`, `learning_engine.py`, `v40_2_daily_generator.py`) already use `data_engine.db.egksco_price_history` as primary source. |
| 7 | `egksco_stocks` | `stocks.db` | `data_engine.db` | 250 (2026-07-23) | 0 | ✅ DROPPED | Empty table. `live_price.py:_price_from_data_engine()` catches `sqlite3.OperationalError` and falls back to `_price_from_stocks_egksco()` — safe to drop. (Note: expected mapping said data_engine was canonical, but actual verification showed stocks.db has all the data — used the data, not the assumption.) |
| 8 | `portfolios` | `stocks.db` | `auth.db` | 3 (2026-07-22) | NOT FOUND | ⊙ NO ACTION | `auth.db` doesn't have this table. Only `stocks.db` has it (3 rows). Audit report counted it as duplicate but the duplicate side was already gone. |
| 9 | `User` | `auth.db` | `stocks.db` | 101 (2026-07-30) | NOT FOUND | ⊙ NO ACTION | `stocks.db` doesn't have this table. Only `auth.db` has it (101 rows). |
| 10 | `Post` | — | — | NOT FOUND | — | ⊙ NO ACTION | `stocks.db` doesn't have this table either. `custom.db` was already removed (deprecated). |
| 11 | `telegram_news` | `stocks.db` | `predictions.db` | 6 (2026-06-18) | 0 | ✅ DROPPED | Empty table. Different schema (8 vs 10 cols). `TelegramSignalImporter._ensure_schema()` recreates it on init (`telegram_signal_importer.py:116`). |
| 12 | `user_trades` | `predictions.db` | `stocks.db` | 0 | NOT FOUND | ⊙ NO ACTION | `stocks.db` doesn't have this table. Only `predictions.db` has it (0 rows). |
| 13 | `stocks` | `stocks.db` | `data_engine.db` | 976 (2026-09-26, 58 cols) | 296 (2026-09-08, 16 cols) | ✅ DROPPED | Different schemas (egksco-style raw scrape vs full metadata). Verified all 296 symbols in data_engine.db.stocks exist in stocks.db.stocks; all 296 rows are stale (>7 days old). `smart_confluence_engine.py:96-116` has a fallback path that reads stocks.db.stocks when data_engine.db.stocks is unavailable — switching to that path. |

**Totals:** 9 dropped, 3 no-action, 1 skip-not-found = 13 line-items for the 12 duplicate groups (ExpertRecommendation counted as one group with 2 drop targets).

---

## Code Updates

### 1. `src/lib/cache/precomputed-cache.ts` — precomputeGoldData() rewritten (lines 716-794)

**Before:** Queried `stocks.db.gold_prices` with `SELECT karat, price_per_gram, change FROM gold_prices WHERE karat NOT LIKE 'silver%'`. The query was **already broken** because the stocks.db.gold_prices schema (id, karat, price_per_gram, currency, source, last_update) has NO `change` column. Verified with Node REPL: `Error: no such column: change`. The thrown error propagated up to `updateAllCache()`'s catch block (line 877), causing the ENTIRE cache update to fail and return `success: false` — meaning stocks + market + currency caches were never updated either.

**After:** Now uses `getLiveEgyptGoldPrices()` from `data-engine-db.ts` (the canonical data_engine.db source). Wrapped in try/catch with explicit warning log on failure. If gold prices are unavailable, the function returns early (gold cache skipped) instead of throwing — so `updateAllCache()` continues to update stocks/market/currency caches successfully. Added 8-line comment block explaining the P0-8-DB-UNIFY context.

**Impact:** Fixes a latent bug — `updateAllCache()` will now actually complete and populate all caches instead of aborting at the gold step.

### 2. `vps-service/utils/db_paths.py` — get_db_for_table() + aliases refreshed (lines 76-227)

**Before:** `get_db_for_table()` routed consolidated tables to the future-state 4-DB architecture (e.g. `gold_prices` → `MARKET_DB` = `market.db`, which is 0 bytes empty on production). This meant any code calling `get_db_for_table('gold_prices')` would get a path to an empty DB.

**After:** Each consolidated table now routes to its actual canonical DB in the current production state:
- `gold_prices`, `egksco_price_history`, `tab_*`, `crypto_prices`, `macro_*` → `DATA_ENGINE_DB`
- `stocks`, `egksco_stocks`, `cached_analysis`, `ExpertRecommendation`, `telegram_news`, `portfolios`, `stock_*` → `STOCKS_DB`
- `learned_lessons`, `predictions`, `outcome_logs`, `user_trades` → `PREDICTIONS_DB`
- `User`, `PromoCode`, `SubscriptionPlan` → `AUTH_DB`
- Default (unknown) → `STOCKS_DB` (was `MARKET_DB`)

Aliases updated: `TELEGRAM_DATA_DB`, `NEWS_DB` now point to `STOCKS_DB` (was `CONTENT_DB`); `GOLD_PRICES_DB`, `ANALYTICS_DB` retain canonical routing with refreshed comments. 14/14 verification tests pass.

---

## Verification

### Drop verification (all 20 checks pass)

```
✅ stocks.gold_prices                  ABSENT (was 3 rows)
✅ stocks.learned_lessons              ABSENT (was 0 rows)
✅ stocks.egksco_price_history         ABSENT (was 0 rows)
✅ predictions.cached_analysis         ABSENT (was 0 rows)
✅ predictions.telegram_news           ABSENT (was 0 rows)
✅ predictions.ExpertRecommendation    ABSENT (was 17 rows)
✅ auth.ExpertRecommendation           ABSENT (was 17 rows)
✅ data_engine.egksco_stocks           ABSENT (was 0 rows)
✅ data_engine.stocks                  ABSENT (was 296 rows)
✅ data_engine.gold_prices             PRESENT (187,153 rows — canonical)
✅ predictions.learned_lessons         PRESENT (19,464 rows — canonical)
✅ data_engine.egksco_price_history    PRESENT (13,246 rows — canonical)
✅ stocks.cached_analysis              PRESENT (143 rows — canonical)
✅ stocks.telegram_news                PRESENT (6 rows — canonical)
✅ stocks.ExpertRecommendation          PRESENT (127 rows — canonical)
✅ stocks.egksco_stocks                PRESENT (250 rows — canonical)
✅ stocks.stocks                       PRESENT (976 rows — canonical)
✅ stocks.portfolios                   PRESENT (3 rows — was never duplicated)
✅ auth.User                           PRESENT (101 rows — was never duplicated)
✅ predictions.user_trades             PRESENT (0 rows — was never duplicated)
```

### Lint

```
$ bun run lint
$ eslint .
EXITCODE=0
```

### App health

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
500
```

**Root cause:** The 500 is NOT caused by the DB consolidation. It is a **pre-existing** bug in `src/middleware.ts:2` (`import { randomUUID } from 'crypto'`) — the Next.js edge runtime does not support Node.js `crypto` module. This was introduced by the P0-11-AUTH-REPORT task (per worklog) and affects EVERY route (the middleware runs on every request). All routes return the same error:

```
"The edge runtime does not support Node.js 'crypto' module.
  at Object.middleware [as handler] (webpack-internal:///(middleware)/./src/middleware.ts:63:112)"
```

Verified by hitting 3 unrelated endpoints (`/`, `/api/health`, `/api/expert-recommendations`) — all return the same middleware error. None of these endpoints touch the DB tables I dropped. This bug pre-dates my changes and requires a separate fix (replacing `crypto.randomUUID()` with `crypto.webcrypto.randomUUID()` or using the `next/headers` API instead — out of scope for P0-8-DB-UNIFY).

### DB sanity check (post-consolidation)

```
[stocks.db]        50 tables, 14.2 MB   (was 53 tables — dropped 3 duplicates)
[predictions.db]   43 tables, 224.3 MB  (was 46 tables — dropped 3 duplicates)
[data_engine.db]   21 tables, 272.5 MB  (was 23 tables — dropped 2 duplicates)
[auth.db]          13 tables, 0.2 MB    (was 14 tables — dropped 1 duplicate)
```

### Backups created

```
db/stocks.db.bak-unify        14.2 MB
db/predictions.db.bak-unify  224.3 MB
db/auth.db.bak-unify            0.2 MB
db/data_engine.db.bak-unify   272.5 MB
Total:                       511.2 MB
```

### JSON sidecars (preserved rows from non-empty drops)

```
scripts/output/db_unify_dropped_stocks_db_gold_prices_<ts>.json                      3 rows
scripts/output/db_unify_dropped_predictions_db_ExpertRecommendation_<ts>.json      17 rows
scripts/output/db_unify_dropped_auth_db_ExpertRecommendation_<ts>.json             17 rows
scripts/output/db_unify_dropped_data_engine_db_stocks_<ts>.json                   296 rows
Total:                                                                            333 rows preserved
```

---

## Files Modified

1. **`src/lib/cache/precomputed-cache.ts`** — `precomputeGoldData()` rewritten (+78/-57 LOC). Switched from broken `stocks.db.gold_prices` query to `data_engine.db` via `getLiveEgyptGoldPrices()`. Fixes latent bug where entire `updateAllCache()` was failing due to this query.
2. **`vps-service/utils/db_paths.py`** — `get_db_for_table()` rewritten (+85/-52 LOC). Each consolidated table now routes to its actual canonical DB in current production state. 4 aliases refreshed with P0-8-DB-UNIFY comments. 14/14 routing tests pass.

## Files Created

1. **`scripts/db_unify_inventory.js`** — Phase 1 read-only inventory script (Node + better-sqlite3 readonly).
2. **`scripts/db_unify_verify_expert.js`** — ExpertRecommendation overlap verification (auth vs predictions vs stocks).
3. **`scripts/db_unify_verify_expert2.js`** — Per-row duplicate check for the 17 stale auth/predictions rows.
4. **`scripts/db_unify_verify_gold.js`** — stocks.db.gold_prices 3 rows content inspection (proves they're default seed data).
5. **`scripts/db_unify_verify_stocks.js`** — data_engine.db.stocks symbol-overlap + staleness check (proves all 296 symbols exist in stocks.db, all 296 rows stale >7d).
6. **`scripts/db_unify_verify_drops.js`** — Post-drop verification (20 checks all pass).
7. **`scripts/unify_duplicate_tables.py`** — The Phase 4 drop script with backup + JSON-sidecar + sanity-check logic (296 LOC).
8. **`scripts/output/db_unify_inventory.json`** — Phase 1 inventory JSON.
9. **`scripts/output/db_unify_drops_20260927T164522Z.json`** — Dry-run results.
10. **`scripts/output/db_unify_drops_20260927T164538Z.json`** — Live-run results.
11. **`scripts/output/db_unify_dropped_*.json`** — 4 sidecars with preserved rows from non-empty drops.

---

## Remaining Duplicates / Manual Review

**None at the SQL level.** All 9 confirmed duplicate tables across DBs have been dropped. The 3 tables in the original list (`portfolios`, `User`, `Post`, `user_trades`) were already single-DB-only — they were never actually duplicated in production.

### Follow-up items (out of scope but flagged)

1. **`src/middleware.ts:2` edge-runtime crypto bug (P0 #15 follow-up)** — The `import { randomUUID } from 'crypto'` line throws in the edge runtime and breaks every route with HTTP 500. This is the highest-priority fix to restore app health. Replace with `crypto.webcrypto.randomUUID()` or move the request-id generation to a Node.js runtime route handler.

2. **`predictions.db.cached_analysis` and `predictions.db.telegram_news` will be recreated** by the migrator and `TelegramSignalImporter._ensure_schema()` respectively. They have intentionally different schemas (fallback-cache + AI-pipeline variants). If the project wants to fully eliminate these duplicates, those code paths must be refactored to use `stocks.db` as the single source. Out of scope for this task — they're currently empty so dropping them has zero data impact.

3. **`smart_confluence_engine.py:96-116`** now uses the stocks.db fallback path for `get_all_stocks()` / `get_stock_full_data()` instead of preferring data_engine.db.stocks. The fallback was already there — it now becomes the primary path. A future refactor could simplify this code to query stocks.db directly and remove the dead data_engine.db.stocks fallback (now permanently unreachable since the table is dropped).

4. **`unified_learning_engine.py:1224`** — `'ExpertRecommendation' in tables` check is now permanently False when querying predictions.db. The code gracefully skips the branch but logs nothing. A future refactor could either (a) ATTACH stocks.db and read ExpertRecommendation from there, or (b) remove the dead branch entirely.

5. **Backup retention** — The 4 `.bak-unify` files total 511 MB. After a week of stable production, they can be removed. Suggested: keep through 2026-10-04, then delete.

---

## Recommendations

1. **Deploy `src/middleware.ts` fix ASAP** — restore app health (independent of this task).
2. **Run `updateAllCache()` after deploy** — the cache has been silently failing for months due to the precomputeGoldData bug; first successful run will populate the gold cache with real data.
3. **Update the AUDIT_DATABASES report** to reflect the 9 drops — re-run the audit script to confirm 0 remaining duplicates.
4. **Add a CI guard** that runs `scripts/db_unify_verify_drops.js` after every DB migration — catches future duplicate-table regressions.
