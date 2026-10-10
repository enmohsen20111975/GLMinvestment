# Round 2: DB Audit

**Audit ID**: TEAM-2-DB-R2
**Date**: 2026-10-09 (post sandbox-reset #2)
**Scope**: `/home/z/my-project/db/*.db` — re-verification of Round 1 findings
**Mode**: PURE RESEARCH — no code or DB modified
**Tools**: `python3 sqlite3` (readonly) + `rg` (ripgrep) + Prisma schema parsing + `git log`

---

## 0. Executive Summary — Sandbox Reset Nuked the DBs

**Headline finding**: Between Round 1 (2026-10-09 morning) and Round 2, a **sandbox reset #2** occurred
(worklog line 67535 — `Task ID: RECOVERY-AFTER-RESET-2`). The 10 production DBs from
Round 1 (104 tables, 1.22M rows, 284 MB total) are **GONE**. Round 2 inherits a near-empty
DB layer:

| Metric | Round 1 | Round 2 | Δ |
|---|---:|---:|---:|
| DB files | 10 | 4 | **−6** |
| Tables | 104 | 5 | **−99** |
| Total rows | 1,222,868 | 0 | **−1,222,868** |
| Total size | 284.78 MB | 0.07 MB | **−99.98%** |
| Code refs to missing DBs | n/a | 875 | NEW |

**Current DB inventory** (Round 2):

| DB | Size | Tables | Rows | Status |
|---|---:|---:|---:|---|
| `auth.db` | 0 B | 0 (file empty) | 0 | 🔴 EMPTY — Prisma client will throw on every query |
| `custom.db` | 24 KB | 2 (`User`, `Post`) | 0 | 🔴 Default Prisma scaffold — STILL not deleted (Round 1 P0 missed) |
| `news.db` | 0 B | 0 (file empty) | 0 | 🔴 EMPTY — created during audit window (18:19 UTC) |
| `predictions.db` | 45 KB | 3 (`predictions`, `stored_analyses`, `prediction_lessons`) | 0 | 🟠 Schema exists, no data |
| ~~`data_engine.db`~~ | — | — | — | 🔴 MISSING (was 58 MB / 419,730 rows) |
| ~~`historical.db`~~ | — | — | — | 🔴 MISSING (was 41 MB / 175,409 rows) |
| ~~`intraday.db`~~ | — | — | — | 🔴 MISSING (was 74 MB / 285,483 rows) |
| ~~`paper_trading.db`~~ | — | — | — | 🔴 MISSING (was 0.03 MB / 1 row) |
| ~~`price_history.db`~~ | — | — | — | 🔴 MISSING (was 52 MB / 274,574 rows) |
| ~~`stocks.db`~~ | — | — | — | 🔴 MISSING (was 33 MB / 34,784 rows) |

**Conclusion**: Most Round 1 findings are **moot** because the DBs they reference don't exist
anymore. This is **NOT a fix** — it's a data-loss regression. Round 1's "27 orphaned tables",
"25+ tables with 0 indexes", "20+ tables missing FK" are technically "gone" but only because
the DBs themselves are gone. As soon as the missing DBs are re-seeded (via
`scripts/setup-all-dbs.ts`, `scripts/init-databases.py`, or `unify-predictions-db.py`), the
old issues will re-surface because the **fix scripts were not committed to runtime startup**
— they are one-shot manual scripts that must be run after a fresh DB restore.

---

## 1. Fixed from Round 1

### ✅ Fixed #1: `predictions.db.aiPrediction` table is DROPPED

Round 1 flagged `aiPrediction` as an **exact duplicate** of `predictions` (9,339 rows each,
same date range, same market distribution). Round 2 confirms it is **gone**:

```python
# predictions.db tables (Round 2):
['predictions', 'stored_analyses', 'prediction_lessons', 'sqlite_sequence']
# aiPrediction: ABSENT ✅
```

The `scripts/unify-predictions-db.py` (lines 100-122) Phase 2 `DROP TABLE IF EXISTS aiPrediction`
ran successfully. Also dropped `aiPredictionStats` (orphan sibling). Schema comment in
`prisma/predictions-schema.prisma:9` now reads: `aiPrediction: DROPPED (was 0 rows, dead table)`.

### ✅ Fixed #2: `stocks.db.predictions` duplicate is GONE (with the DB)

Round 1 flagged `stocks.db.predictions` (4,172 rows, 22 cols) as duplicate of
`predictions.db.predictions` (9,339 rows, 78 cols). Round 2 confirms: **stocks.db does not
exist**, so the duplicate is gone. (Note: this is by accident — the whole DB was nuked, not
just the table.)

### ✅ Fixed #3: `stocks.db.prediction_logs` duplicate is GONE (with the DB)

Round 1 flagged `stocks.db.prediction_logs` (80 rows) as duplicate of
`predictions.db.prediction_logs` (80 rows). Round 2: stocks.db is missing, so the duplicate
is gone. The `unify-predictions-db.py` Phase 3-4 was designed to migrate then DROP this table.

### ✅ Fixed #4: `stocks.db.cached_analysis` duplicate is GONE (with the DB)

Round 1 flagged 275-row cached_analysis in BOTH predictions.db (16 cols) and stocks.db (33
cols). Round 2: stocks.db missing, so duplicate is gone. (Predictions.db.cached_analysis also
missing now — only 3 tables exist.)

### ✅ Fixed #5: `stocks.db.gold_prices` duplicate is GONE (with the DB)

Round 1 flagged 3-row `stocks.db.gold_prices` as duplicate of `data_engine.db.gold_prices`
(129,251 rows). Round 2: both DBs missing.

### ✅ Fixed #6: `news.db.news_articles` migration leftover is GONE (with the DB)

Round 1 flagged `news_articles` as a migration leftover with same 4,428 rows as `market_news`.
Round 2: `news.db` is 0 bytes (empty file, just created at 18:19 UTC). Neither table exists.

### ✅ Fixed #7: `stocks.db.ExpertRecommendation` casing duplicate is GONE (with the DB)

Round 1 flagged `stocks.db.ExpertRecommendation` (PascalCase, 42 rows) vs
`predictions.db.expertRecommendation` (camelCase, 115 rows). Round 2: stocks.db missing,
predictions.db has NO ExpertRecommendation table at all (only `predictions`, `stored_analyses`,
`prediction_lessons`).

### ✅ Fixed #8: `predictions.db.predictions` schema drift REDUCED (78 → 43 cols)

Round 1 reported 78 actual cols vs ~44 Prisma-declared → **+34 cols drift**. Round 2: 43
actual cols vs 44 Prisma-declared → **1 col drift** (only `morning_bell` declared in Prisma
line 100 but absent from DB). Massive improvement, mostly because the table was recreated
fresh by `ensureSchema()` in `src/lib/honest-tracking/maestro.ts:408-491`.

### ✅ Fixed #9: `predictions.db.predictions` row count back to 0 (was 9,339)

The duplicated/orphaned predictions data is gone. This is a clean slate, but **also means
no historical predictions exist** for the UI to display.

---

## 2. Still Broken

### 🔴 Still #1: 3 Prisma-declared indexes on `predictions.db.predictions` STILL MISSING

Round 1 said: *"MISSING: `signal`, `master_score`, `was_published` — 3/5 Prisma indexes absent"*

Round 2 — `PRAGMA index_list(predictions)` returns:

```
idx_predictions_ticker    — ticker               (matches @@index([ticker]) ✅)
idx_predictions_date      — prediction_date      (matches @@index([prediction_date]) ✅)
idx_predictions_market     — market               (NOT in Prisma 🟡)
idx_predictions_outcome    — outcome_date         (NOT in Prisma 🟡)
idx_predictions_status     — outcome_date+hit_target+hit_stop  (NOT in Prisma 🟡)
```

MISSING (declared in `prisma/predictions-schema.prisma:122-126` but absent from DB):

- `@@index([signal])` — still absent 🔴
- `@@index([master_score])` — still absent 🔴
- `@@index([was_published])` — **STILL ABSENT** 🔴 — this is the most critical because
  `stats` and `missed-opportunities` endpoints filter on this column. With 0 rows today,
  no impact; but as soon as data flows back, full table scans will resume.

EXTRA (present but not in Prisma):

- `idx_predictions_market` — present but Prisma doesn't declare
- `idx_predictions_outcome` — present but Prisma doesn't declare
- `idx_predictions_status` — compound index, present but Prisma doesn't declare

The root cause is `src/lib/honest-tracking/maestro.ts:110-114` — `ensureSchema()` only
creates 5 specific indexes (ticker/market/date/outcome/status), and **never** creates
the 3 Prisma-declared indexes. Even on a fresh DB restore, these 3 indexes will be missing.

### 🔴 Still #2: `predictions.db.predictions` schema drift — `morning_bell` col missing

`prisma/predictions-schema.prisma:100` declares `morning_bell Int @default(0)`. The DB
column list (43 cols) does NOT contain `morning_bell`. `ensureSchema()` in
`src/lib/honest-tracking/maestro.ts:436-491` does NOT add this column. If `prisma db push`
ever runs, it will try to ADD `morning_bell`; if it ever ran before with `--accept-data-loss`,
it would have dropped it. Status: drift unresolved.

### 🔴 Still #3: `custom.db` + `prisma/schema.prisma` + `DATABASE_URL` STILL NOT cleaned

Round 1 P0 #1: *"Delete `custom.db` entirely + delete `prisma/schema.prisma` (default
scaffold) + update `DATABASE_URL`."*

Round 2:

- `db/custom.db` — STILL exists (24 KB, 2 tables `User` + `Post`, 0 rows)
- `prisma/schema.prisma` — STILL the default Prisma scaffold (794 bytes, dated 2026-10-08,
  unchanged)
- `.env` line 1: `DATABASE_URL=file:/home/z/my-project/db/custom.db` — STILL points to
  the scaffold DB

**Impact**: This DB is referenced by `prisma-client-js` (the default Prisma client, NOT
the `@prisma/auth-client` or `@prisma/predictions-client`). Any code path that imports
`@prisma/client` directly will read from this empty scaffold DB and silently return empty
results.

### 🔴 Still #4: `predictions.db` has only 3 of 10 Prisma-declared tables

`prisma/predictions-schema.prisma` declares 10 models → 10 tables:

| Prisma Model | @@map / Table name | Status in DB |
|---|---|---|
| `Prediction` | `predictions` | ✅ exists |
| `PersonaPrediction` | `persona_predictions` | 🔴 MISSING |
| `PredictionLog` | `prediction_logs` | 🔴 MISSING |
| `ExpertRecommendation` | (default name) | 🔴 MISSING |
| `ExpertTrackRecord` | (default name) | 🔴 MISSING |
| `CachedAnalysis` | (default name) | 🔴 MISSING |
| `StoredAnalysis` | `stored_analyses` | ✅ exists |
| `AnalysisJob` | `analysis_jobs` | 🔴 MISSING |
| `AnalysisEngineStatus` | `analysis_engine_status` | 🔴 MISSING |
| `TechnicalIndicator` | (default name) | 🔴 MISSING |

Only 2 of 10 declared tables exist (plus 1 extra `prediction_lessons` not in Prisma).
The runtime `ensureSchema()` in `maestro.ts:79-147` only creates 3 tables
(`predictions`, `stored_analyses`, `prediction_lessons`). Any code path that calls
`prisma.predictionLog.findMany()` or `prisma.expertRecommendation.findMany()` will throw
`no such table: prediction_logs` at runtime.

### 🔴 Still #5: Code references to dropped `aiPrediction` table

`aiPrediction` was dropped from `predictions.db` (Round 2 confirmed), but code still
references it:

- `scripts/mine_learned_lessons.py:125` — `cur.execute('PRAGMA table_info(aiPrediction)')`
- `scripts/mine_learned_lessons.py:133` — `FROM aiPrediction`
- `scripts/mine_learned_lessons.py:142` — `FROM aiPrediction`
- `scripts/daily_result_checker.py:307,341,368,405,420` — `SELECT * FROM aiPrediction` +
  `UPDATE aiPrediction`

If anyone runs these scripts (they're cron-style prediction verifiers), they'll throw
`no such table: aiPrediction`.

### 🔴 Still #6: `prisma/schema.prisma` default scaffold `User` + `Post` (the wrong User)

Round 1 flagged: *"All refs are to `auth.db.User`, not `custom.db.User`"* for the 13 refs
to `User` from the scaffold `prisma/schema.prisma`. Round 2: scaffold unchanged, refs
unaffected. As soon as any code path imports the default `@prisma/client`, it will use
`custom.db.User` (5 cols) instead of `auth.db.User` (17+ cols).

### 🔴 Still #7: 7 of 10 Round 1 DBs are MISSING entirely

Per Round 1 §1 inventory, these DBs should exist:

| DB | Round 1 size | Round 1 rows | Round 2 status |
|---|---:|---:|---|
| `data_engine.db` | 58.12 MB | 419,730 | 🔴 MISSING |
| `historical.db` | 41.12 MB | 175,409 | 🔴 MISSING |
| `intraday.db` | 73.98 MB | 285,483 | 🔴 MISSING |
| `paper_trading.db` | 0.03 MB | 1 | 🔴 MISSING |
| `price_history.db` | 51.71 MB | 274,574 | 🔴 MISSING |
| `stocks.db` | 33.24 MB | 34,784 | 🔴 MISSING |
| `news.db` | 17.32 MB | 8,856 | 🔴 EMPTY FILE (0 B) |
| `auth.db` | 0.28 MB | 8 | 🔴 EMPTY FILE (0 B) |

Total missing/empty: **1,222,868 rows** of data + 6 entire DB files.

### 🔴 Still #8: 875 code references in `src/` to MISSING DBs

Static analysis (`rg "data_engine\.db|intraday\.db|historical\.db|price_history\.db|paper_trading\.db|news\.db|stocks\.db" src/`)
returns **875 matches** across the codebase. Examples:

- `src/lib/unified-db.ts:83` — `path.join(process.cwd(), 'db', 'stocks.db')`
- `src/lib/data-engine-db.ts:29` — `path.join(process.cwd(), 'db', 'data_engine.db')`
- `src/lib/data-engine-db.ts:66` — `path.join(process.cwd(), 'db', 'stocks.db')`
- `src/__tests__/db/integrity.test.ts:37,61,73,85,96,107,129` — references `stocks.db`,
  `data_engine.db`, `price_history.db` (tests will all fail)

Every API route that touches stocks/news/intraday/historical/price data will throw
`SQLITE_ERROR: no such table: <name>` or silently fall back to empty results.

### 🔴 Still #9: `auth.db` is 0 bytes — Prisma client cannot start

`prisma/auth-schema.prisma:12` declares `url = "file:../db/auth.db"`. The file exists but
is 0 bytes (empty). Prisma Client initialization typically validates schema; if
`prisma db push` hasn't been run, the file stays empty and any `db.user.findMany()` call
throws "no such table: User". Worklog confirms the auth.db was restored at sandbox reset
#2 (commit aca19f9) but the file is empty — restore was incomplete or the schema was
never pushed.

### 🔴 Still #10: 27 orphaned tables NOT actually fixed — just hidden because DBs are gone

Round 1 listed 27 orphaned tables. Round 2 cannot verify any of them because their host
DBs are missing. The orphans are NOT "fixed" — they're "latent" and will re-appear if
`scripts/setup-all-dbs.ts` or `scripts/init-databases.py` is run, because those scripts
create the same legacy schema including:

- `auth.db`: `PromoCode`, `VerificationToken`, `b2b_api_keys`, `portfolio_history`,
  `portfolio_items`, `referrals`, `usage_daily`, `daily_analysis_summaries`,
  `advanced_analysis_results` (9 orphans)
- `data_engine.db`: `tab_balance_sheet`, `tab_cash_flow`, `tab_income_statement` (3 orphans)
- `historical.db`: `daily_prices` (1 orphan)
- `predictions.db`: `aiPredictionStats`, `ai_predictions`, `analysis_engine_status`,
  `analysis_jobs`, `crypto_predictions`, `educational_cards`, `expertTrackRecord`,
  `reports` (8 orphans)
- `stocks.db`: `conjunction_patterns`, `context_logs`, `egksco_sync_status`,
  `maestro_personas`, `telegram_news` (5 orphans)
- `custom.db`: `Post`, `User` (2 orphans — scaffold leftover)

The only orphan that was ACTUALLY fixed (dropped from the live schema): `aiPrediction`
via `unify-predictions-db.py`.

### 🔴 Still #11: 20+ tables with missing FK relationships

Round 1 listed 22 tables that should have FKs but don't (cross-DB FK impossible in
SQLite). Round 2: ALL these tables are missing because the DBs are missing. Will
re-surface on DB restore. **No architectural fix has been applied** — the
recommendation was "consolidate `auth.db` + `stocks.db` + `predictions.db` into ONE db"
(Round 1 P3 #20) but this was not done.

---

## 3. New Issues (introduced or revealed after Round 1)

### 🆕 NEW #1: Sandbox Reset #2 wiped all production data (CRITICAL REGRESSION)

Worklog line 67698: *"Sandbox reset #2 recovery (commit aca19f9) — DBs re-installed via
GitHub API blob (MD5 verified)."* The "MD5 verified" claim is suspect — Round 1 reported
1.22M rows; Round 2 has 0 rows. Either the restore failed silently, or the GitHub blob
itself was empty (the backup zip `data/db_backup_2026-10-09T17-19-31.zip` is only 832
bytes and contains only `crypto.db` 32 KB).

Backup file inspection:

- `data/db_backup_2026-10-08T10-08-10_part1.zip` (43 KB) — contains only `auth.db` 356 KB
- `data/db_backup_2026-10-08T10-08-10_part7.zip` (7.19 MB) — contains only `stocks.db` 29 MB
- `data/db_backup_2026-10-09T17-19-31.zip` (832 B) — contains only `crypto.db` 32 KB

None of these backups covers `data_engine.db`, `historical.db`, `intraday.db`,
`paper_trading.db`, `price_history.db`, `news.db`, or `predictions.db`. **The backup
strategy is incomplete** — only 2-3 DBs are being backed up.

### 🆕 NEW #2: `news.db` was created empty mid-audit (18:19 UTC)

During the audit window, the file `db/news.db` appeared as 0 bytes at timestamp
`Oct 9 18:19`. This indicates that some code path (likely an API route or scheduler)
attempts to open news.db, and SQLite creates an empty file if `fileMustExist: false`
(default). The result is an empty news.db that has zero tables but satisfies `existsSync()`
checks. This is a silent failure mode.

### 🆕 NEW #3: `prediction_lessons` table not declared in Prisma schema

`predictions.db` has 3 tables: `predictions`, `stored_analyses`, `prediction_lessons`.
The first two have matching Prisma models (`Prediction`, `StoredAnalysis`). The third,
`prediction_lessons`, is created by `maestro.ts:141-146` but is **NOT declared** in
`prisma/predictions-schema.prisma`. This is a new schema drift in the opposite direction
— DB has a table Prisma doesn't know about. If `prisma db push` ever runs, it may drop
this table (depending on `--accept-data-loss` flag).

### 🆕 NEW #4: `prisma/schema.prisma` and Prisma Client fragmentation

Three Prisma schemas exist:

- `prisma/schema.prisma` — default scaffold (User + Post), datasource = `env("DATABASE_URL")`
  → `db/custom.db`. Used by `@prisma/client`.
- `prisma/auth-schema.prisma` — 16 models (User, Account, Session, ApiToken, etc.),
  datasource = `file:../db/auth.db`. Used by `@prisma/auth-client`.
- `prisma/predictions-schema.prisma` — 10 models (Prediction, StoredAnalysis, etc.),
  datasource = `file:../db/predictions.db`. Used by `@prisma/predictions-client`.

This 3-Prisma-client setup is unusual and means `prisma db push` must be run 3 times
with 3 different schema files. None of the 3 schemas declares `prediction_lessons`
(which exists in the DB). All 3 Prisma clients are silently inconsistent.

### 🆕 NEW #5: `auth.db` is empty (0 bytes) — Prisma Client cannot start

Round 1 reported `auth.db` with 18 tables and 8 rows. Round 2: file is 0 bytes (empty).
This is a NEW critical issue. `@prisma/auth-client` cannot query anything until
`prisma db push --schema prisma/auth-schema.prisma` is run. The auth system is
**non-functional** at the DB layer.

### 🆕 NEW #6: Code paths reference 4 tables not in any Prisma schema

Round 2 code grep for tables referenced in `src/` but not declared in any Prisma schema:

- `prediction_lessons` — created by `maestro.ts`, not in Prisma
- `learned_lessons` — referenced in `src/lib/` (stocks.db legacy table), no Prisma model
- `signal_logs` / `outcome_logs` — referenced in stocks.db code, no Prisma model
- `tab_*` (8 tables) — referenced in `data_engine.db` code, no Prisma model

The Prisma schema coverage is partial — only `auth.db` and `predictions.db` have schemas,
and even those don't cover every table.

### 🆕 NEW #7: Backup strategy is incomplete (CRITICAL)

Per the worklog (line 67698): *"DBs re-installed via GitHub API blob (MD5 verified)."*
But:

- `data/db_backup_2026-10-09T17-19-31.zip` (832 bytes) contains only `crypto.db` 32 KB
- No backup exists for `data_engine.db`, `historical.db`, `intraday.db`,
  `paper_trading.db`, `price_history.db`, `predictions.db`
- The Oct 8 backup zips cover only `auth.db` (356 KB) + `stocks.db` (29 MB)

**The 1.22M rows of production data Round 1 audited are LOST**. Recovery requires
re-running all the scrapers / backfill scripts (`scripts/backfill_yahoo_history.py`,
`scripts/import_egx30.py`, `scripts/consolidate_prices.py`, etc.) which is days of work.

### 🆕 NEW #8: `unify-predictions-db.py` migration script exists but is NOT idempotent

The script (392 lines) was created on 2026-10-08 09:49:43 (per `stat`). It was
apparently run once (since `aiPrediction` is dropped from predictions.db), but:

- It assumes `stocks.db` exists (Phase 3-4 reads from it) — will fail with
  `sqlite3.OperationalError: unable to open database file` on a fresh sandbox
- It assumes `predictions.db` exists with a `predictions` table (Phase 1 ALTERs it) —
  will fail if predictions.db is empty
- It's NOT in any startup script (`package.json` scripts, `predev`, `prebuild`)
- Re-running it after the sandbox reset would crash

### 🆕 NEW #9: Live DB-creation race condition during audit

The audit observed `news.db` being created mid-audit at `Oct 9 18:19` (0 bytes).
This indicates the running app is silently opening DBs that don't exist, creating empty
files, and continuing — without surfacing the missing-DB problem to operators. The
app's "graceful fallback" pattern (`src/lib/sqlite-wrapper.ts`, `flutter-sqlite-fallback.ts`)
masks the data-loss situation behind silent empty results.

---

## 4. Recommendations

### Priority 1 — Restore the missing data (CRITICAL, owner action)

1. **Restore the 6 missing DBs** from a complete backup or production server. The
   Oct 8 backup zips only cover `auth.db` and `stocks.db`. Need fresh backups of
   `data_engine.db`, `historical.db`, `intraday.db`, `paper_trading.db`,
   `price_history.db`, `news.db`, `predictions.db` from production.

2. **Fix the backup strategy** — current `data/db_backup_*.zip` files are tiny (832 B
   to 7 MB) and cover only 1-2 DBs each. Either:
   - Backup ALL `*.db` files in `db/` to a single zip with a manifest
   - OR commit them to the `databases` branch (per worklog line 49003 strategy)
   - The current strategy lost 1.22M rows of data with no recovery path

3. **Re-run `prisma db push` for all 3 schemas** after restore:
   ```
   npx prisma db push --schema prisma/auth-schema.prisma
   npx prisma db push --schema prisma/predictions-schema.prisma
   # Skip the default prisma/schema.prisma — see P2 below
   ```

### Priority 2 — Apply Round 1 fixes that were NOT applied

4. **Delete `custom.db`** + **delete `prisma/schema.prisma`** + **update `.env`** to
   point `DATABASE_URL` at `db/auth.db` (Round 1 P0 #1, still not done). This
   eliminates the wrong-User table confusion.

5. **Add the 3 missing Prisma-declared indexes** on `predictions.db.predictions`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_predictions_signal ON predictions(signal);
   CREATE INDEX IF NOT EXISTS idx_predictions_master_score ON predictions(master_score);
   CREATE INDEX IF NOT EXISTS idx_predictions_was_published ON predictions(was_published);
   ```
   Wire them into `ensureSchema()` in `src/lib/honest-tracking/maestro.ts:110-114`
   (add 3 lines) so they're created on every fresh DB.

6. **Update `ensureSchema()` to also create the 7 missing Prisma-declared tables**
   (persona_predictions, prediction_logs, ExpertRecommendation, ExpertTrackRecord,
   CachedAnalysis, AnalysisJob, AnalysisEngineStatus, TechnicalIndicator). Either:
   - Add CREATE TABLE statements to `SCHEMA_SQL` in `maestro.ts:79-147`, OR
   - Run `npx prisma db push --schema prisma/predictions-schema.prisma` as part of
     startup (e.g., `predev` npm script)

7. **Add `morning_bell` column to `predictions` table** OR remove it from Prisma schema.
   Current drift: Prisma line 100 declares it, DB doesn't have it. Add to
   `ensureColumns('predictions', [...])` in `maestro.ts:436-491`:
   ```ts
   ['morning_bell', 'ALTER TABLE predictions ADD COLUMN morning_bell INTEGER DEFAULT 0'],
   ```

8. **Declare `prediction_lessons` in `prisma/predictions-schema.prisma`** to match
   the runtime schema. Add a `PredictionLesson` model.

### Priority 3 — Architectural fixes

9. **Consolidate DBs** per Round 1 P3 #20: merge `auth.db` + `stocks.db` +
   `predictions.db` into ONE db so cross-DB FKs work. SQLite ATTACH DATABASE pattern
   documented in worklog line 39603.

10. **Add Prisma schemas for ALL DBs** — Round 1 P3 #17: only `auth.db` and
    `predictions.db` have schemas. Add `prisma/stocks-schema.prisma`,
    `prisma/news-schema.prisma`, `prisma/intraday-schema.prisma`,
    `prisma/historical-schema.prisma`, `prisma/data-engine-schema.prisma`.

11. **Make `unify-predictions-db.py` idempotent** — currently it crashes on a fresh
    sandbox (assumes stocks.db exists). Wrap each phase in `if table_exists(...)`
    guards and add a `--dry-run` flag.

12. **Fix code refs to dropped `aiPrediction` table**:
    - `scripts/mine_learned_lessons.py:125,133,142` — change `aiPrediction` → `predictions`
    - `scripts/daily_result_checker.py:307,341,368,405,420` — change `aiPrediction` → `predictions`
    - OR archive these scripts as dead code

13. **Add a startup DB health check** — a script that runs on app boot, verifies all
    expected DBs/tables/indexes exist, and surfaces missing ones in the admin dashboard.
    Currently the app silently opens empty DBs and returns empty results.

### Quick Wins (can do today, <30 min each)

- ✅ Run `npx prisma db push --schema prisma/auth-schema.prisma` to populate `auth.db`
- ✅ Run `npx prisma db push --schema prisma/predictions-schema.prisma` to create the 7 missing tables
- ✅ Delete `db/custom.db` + `prisma/schema.prisma`
- ✅ Update `.env`: `DATABASE_URL=file:/home/z/my-project/db/auth.db`
- ✅ Add 3 lines to `ensureSchema()` in `maestro.ts` to create the 3 missing indexes
- ✅ Add `prediction_lessons` model to `prisma/predictions-schema.prisma`

---

## 5. Verification Matrix — Round 1 Findings vs Round 2 Reality

| # | Round 1 Finding | Round 2 Status | Notes |
|---|---|---|---|
| 1 | 6 cross-DB duplicate tables | 5 N/A (DBs gone); 1 (User) moot | No duplicates because data is gone, not because tables were dropped |
| 2 | 3 exact duplicates (aiPrediction etc.) | ✅ FIXED via `unify-predictions-db.py` | aiPrediction dropped; stocks.db.predictions gone with the DB |
| 3 | 27 orphaned tables | 🔴 LATENT — DBs missing | Will re-surface on DB restore; only `aiPrediction` was actually dropped |
| 4 | 25+ tables with 0 indexes | 🔴 LATENT — DBs missing | `predictions.db.predictions` STILL missing 3 Prisma-declared indexes |
| 5 | 8 tables with schema drift | 🟡 PARTIAL — `predictions` drift reduced 34→1 cols | `morning_bell` col drift persists; 3 indexes drift persists |
| 6 | 20+ tables missing FK | 🔴 LATENT — DBs missing | Architectural issue not addressed |
| NEW-1 | 7 DBs MISSING entirely | 🔴 NEW CRITICAL | Sandbox reset wiped 1.22M rows; backup strategy incomplete |
| NEW-2 | `auth.db` empty (0 bytes) | 🔴 NEW CRITICAL | Prisma client cannot start |
| NEW-3 | `prediction_lessons` not in Prisma | 🟡 NEW DRIFT | Reverse drift: DB has table Prisma doesn't declare |
| NEW-4 | 875 code refs to missing DBs | 🔴 NEW CRITICAL | Will throw runtime errors when APIs are called |
| NEW-5 | `unify-predictions-db.py` not idempotent | 🟡 NEW RISK | Crashes on fresh sandbox |
| NEW-6 | Code refs to dropped `aiPrediction` | 🟡 NEW RISK | `mine_learned_lessons.py`, `daily_result_checker.py` will throw |

---

## 6. Methodology

- Opened each `db/*.db` with `python3 -c "import sqlite3; ..."` (readonly inspection)
- Compared actual tables + cols + indexes against `prisma/*.prisma` schema files
- Grepped `src/` for code refs to: missing DBs (875 matches), dropped `aiPrediction`
  table (5 matches), `news_articles` table (renamed 2026-09-02)
- Inspected backup zip contents via `unzip -l`
- Verified file sizes via `ls -la db/` + `stat`
- Cross-referenced worklog.md (line 67698: sandbox reset #2 mention) for context
- NO code or DB was modified during this audit (PURE RESEARCH mode)

### Limitations

- The audit observed `news.db` being created mid-audit at 18:19 UTC, suggesting the
  running app is opening DBs that don't exist. The DB state is therefore **dynamic**
  and may change during the audit window.
- The Round 1 audit was performed on production data (1.22M rows). Round 2 is performed
  on an empty sandbox state. The drift analysis for `predictions` table is therefore
  NOT comparable apples-to-apples — Round 2 sees a fresh `ensureSchema()`-created table
  with 0 rows, not the drifted production schema.
- Row counts in Round 1 were point-in-time. Round 2 reports all zeros because the data
  is gone.
- Code-reference counts include test files (`src/__tests__/`) which may not run in
  production. The 875 figure includes ~30 test-file refs.

---

## 7. Files produced

- `/home/z/my-project/audit-reports/round2/team-2-db.md` — This report
- (Round 1 report preserved at `/home/z/my-project/audit-reports/team-2-db.md`)

**End of Round 2 DB Audit.**
