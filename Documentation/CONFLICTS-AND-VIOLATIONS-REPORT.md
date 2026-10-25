# Conflicts & Violations Report — GLMinvestment
> **Status:** Based on STATIC CODE ANALYSIS of sandbox HEAD `c270eb5`.
> **Method:** Grep + Read across `vps-service/`, `src/`, `scripts/`, `news-agent/`.
> **Scope:** Violations documented here are CONFIRMED IN CODE only. Whether they manifest on production is UNVERIFIED — the production audit script (`scripts/production_db_audit.py`) has been created and pushed to GitHub but NOT YET EXECUTED on the VPS.
> **Evidence classification:** Each violation below states explicitly whether its impact is (a) proven in code, (b) proven in sandbox test, or (c) requires production verification.

## Severity scale
- 🔴 **HIGH** — data integrity risk, potential data loss, multi-writer without coordination.
- 🟠 **MEDIUM** — bypasses sanctioned interface, env override ignored, schema gap.
- 🟡 **LOW** — dead/orphaned data, documentation drift, non-blocking but should clean up.

## Evidence classification per violation

| # | Proven in code | Proven in sandbox test | Requires production verification |
|---|---|---|---|
| V1 | ✅ (file:line) | ✅ (test_radar_delete_impact_phase2.py) | Does `maker_radar` actually run after `state_history_tracker` on same day? |
| V2 | ✅ (file:line + schema) | ✅ (16 dup rows in sandbox) | Actual duplicate count on production DB |
| V3 | ✅ (file:line) | ❌ (not testable without VPS env config) | Does production use `STOCKS_DB` env override? |
| V4 | ✅ (file:line both writers) | ❌ (no concurrent test) | Actual race conditions, DELETE-all execution |
| V5 | ✅ (file:line, 5 UPDATEs) | ❌ | None — bypass is certain, impact on business logic only |
| V6 | ✅ (table exists, no writer) | ✅ (1238 rows in sandbox) | Whether production still has the table |
| V7 | ✅ (file:line, logic flow) | ✅ (0 rows path='distribution' in sandbox) | None — code flow is certain |
| V8 | ✅ (5 tables, 0 rows) | ✅ (sandbox) | Whether production has same empty tables |
| V9 | ✅ (db_paths.py comment) | ✅ (3 stale rows in sandbox stocks.db) | Whether P0-8-DB-UNIFY cleaned it on production |

---

## V1 — 🔴 HIGH: `maker_radar.py:752` unscoped DELETE wipes other writers' rows

**Evidence (file:line):**
```python
# scripts/maker_radar.py:752
conn.execute("DELETE FROM radar_signal_tracking WHERE signal_date = ?", (scan_date,))
```

**What it does:** Deletes ALL rows for `signal_date` regardless of `signal_type`, `path`, or ownership.

**Affected owners:**
- `state_history_tracker.py` — canonical_state rows (signal_type='canonical_state', path=NULL) are wiped.
- `src/modules/radar/lib/radar-signal-tracker.ts` — frontend/manual picks are wiped.
- Verification rows (from `verify_radar_signals.py`, `backfill_stale_radar_signals.py`) — their UPDATE fields are lost when the parent row is deleted.

**Test evidence:** `scripts/test_radar_delete_impact_phase2.py` TEST 1 — confirmed that after the DELETE, canonical_state rows = 0 (were 1 before). 4/4 ✅.

**Production impact (NOT verified):** If `maker_radar` runs after `state_history_tracker` on the same day, canonical_state data is lost. Whether this actually happens depends on VPS cron schedule (not in repo).

**Root cause:** The DELETE was written when `maker_radar` was the only writer. New writers (`state_history_tracker`, frontend TS) were added without updating the DELETE scope.

---

## V2 — 🔴 HIGH: `state_history_tracker.py:138` INSERT OR REPLACE without UNIQUE creates duplicates

**Evidence (file:line):**
```python
# vps-service/camp/state_history_tracker.py:138
conn_st.execute("""
    INSERT OR REPLACE INTO radar_signal_tracking
        (ticker, signal_date, signal_type, entry_price, status, ...)
    VALUES (?, ?, ?, ?, ?, ...)
""", ...)
```

**Schema (no UNIQUE on natural key):**
```sql
-- From maker_radar.py:709-725 (CREATE TABLE) + ALTER TABLE ADD COLUMN additions
CREATE TABLE radar_signal_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- only PK, no UNIQUE on (ticker, signal_date, signal_type)
    ticker TEXT NOT NULL,
    signal_date TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    ...
);
```

**What it does:** `INSERT OR REPLACE` in SQLite only triggers REPLACE when a UNIQUE/PK constraint conflicts. Since `id AUTOINCREMENT` always generates a new id, there is never a conflict → it always INSERTs a new row.

**Test evidence:**
- `scripts/test_canonical_transitions_phase2.py` TEST 2 — running `assess_and_record` twice for same (ticker, date) produces 2 rows (expected 1). Documented as FINDING.
- `scripts/test_unique_key_phase2.py` TEST 5 — attempted to add UNIQUE INDEX on production-copy of 1301 rows; blocked by 10 duplicate triples (26 rows total).

**Sandbox data evidence:** 16 duplicate canonical_state rows on 2026-10-21 (ABUK ×4, COMI ×4, ETEL ×3, TMGH ×3, + 6 tickers ×2).

**Production impact (NOT verified):** Duplicates may be more numerous if `state_history_tracker` runs multiple times per day on VPS. The audit script `production_db_audit.py` will reveal the actual count.

---

## V3 — 🟠 MEDIUM: `state_history_tracker.py:163` bypasses env override / db_manager

**Evidence (file:line):**
```python
# vps-service/camp/state_history_tracker.py:163
conn_st = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=30)
# DB_DIR = PROJECT_ROOT / 'db'  (line 23)
```

**What it does:** Connects directly to `stocks.db` using a hardcoded path derived from `PROJECT_ROOT / 'db'`. Does NOT use `db_manager.get_connection(DBPaths.STOCKS_DB, writable=True)` (the sanctioned interface).

**Impact:** If VPS is configured with `STOCKS_DB=/var/lib/glm/stocks.db` (env override), this writer writes to `<cwd>/db/stocks.db` instead — a different file. Other components using `DBPaths` would read/write the env-overridden path, creating a split-brain.

**Contrast with sanctioned path:**
```python
# scripts/maker_radar.py:702-705 (CORRECT pattern)
db_path = PROJECT_ROOT / 'db' / 'stocks.db'
from core.db_manager import db_manager
conn = db_manager.connection(str(db_path), writable=True).__enter__()
```
Even `maker_radar` uses a hardcoded path but goes through `db_manager`. `state_history_tracker` skips both `db_manager` AND `DBPaths`.

**Test evidence:** Not directly testable without VPS env config. Confirmed by code inspection (Grep: `state_history_tracker.py` has 0 references to `db_manager` or `DBPaths`).

---

## V4 — 🔴 HIGH: `news.db.market_news` multi-writer (Python + Node.js) without coordination

**Evidence:**

Python writer (news-agent):
```python
# news-agent/main.py:66, 161
# DATA-ENGINE-UNIFY-1 / News Stage 1: bypass Node.js — write directly to news.db.market_news
# 1. كتابة مباشرة في news.db.market_news (بايثون — بدون Node.js)
```

Node.js writer (Next.js API route):
```typescript
// src/app/api/admin/news/route.ts
// line 225: INSERT INTO market_news (...)
// line 311: UPDATE market_news
// line 382: DELETE FROM market_news WHERE id = ?
// line 395: DELETE FROM market_news WHERE id IN (...)
// line 410: DELETE FROM market_news WHERE source = ?
// line 419: DELETE FROM market_news  (DELETE ALL!)
```

**What it does:** Both Python (news-agent) and Node.js (admin route) INSERT/UPDATE/DELETE the same `market_news` table from different runtimes. No coordination protocol (no locks, no ownership check, no API gateway).

**Impact:**
- Race conditions: news-agent could INSERT a row while admin route DELETEs by source → silent data loss.
- The admin route line 419 `DELETE FROM market_news` (no WHERE) wipes the entire table — if an admin clicks "delete all", news-agent's writes are lost.
- No transaction spanning both runtimes.

**Test evidence:** `production_db_audit.py` SECTION 10 will show `market_news` grouped by `source` — if multiple sources exist (e.g., 'news_agent' + 'admin' + 'telegram'), it confirms multi-writer activity.

**Root cause:** The comment in `news-agent/main.py:66` says "bypass Node.js — write directly to news.db" — this was an intentional bypass, but the Node.js admin route was never updated to stop writing. Both paths remained active.

---

## V5 — 🟠 MEDIUM: `daily_closer.py` UPDATEs `predictions` directly, bypassing `PredictionTracker`

**Evidence (file:line):**
```python
# vps-service/jobs/daily_closer.py
# line 886:   UPDATE predictions SET ...
# line 2352:  UPDATE predictions
# line 3079:  UPDATE predictions
# line 3167:  UPDATE predictions SET data_quality = ? WHERE id = ?
# line 3205:  UPDATE predictions SET data_quality = 'toxic' WHERE id = ?
```

**Sanctioned interface:**
```python
# vps-service/analyzers/prediction_tracker.py
# line 632, 661, 896, 963: UPDATE predictions SET ... (inside PredictionTracker methods)
```

**What it does:** `daily_closer.py` writes outcome data (actual_return, exit_price, hit_target, hit_stop, outcome_date, data_quality) directly to the `predictions` table via raw SQL, instead of calling `PredictionTracker.set_verified_outcome()`.

**Impact:**
- Bypasses any validation/logging in `PredictionTracker`.
- If `PredictionTracker` adds business logic later (e.g., trigger learning engine on outcome update), `daily_closer.py` won't trigger it.
- No single ownership of the outcome-update path.

**Test evidence:** Grep confirmed: `daily_closer.py` has 5 direct `UPDATE predictions` statements, 0 calls to `PredictionTracker.set_verified_outcome()`.

---

## V6 — 🟡 LOW: `stock_phase` table orphaned (1238 rows, no production writer)

**Evidence:**
- `stocks.db.stock_phase` has 1238 rows (frozen at 2026-10-07 per worklog audit E13).
- Grep for `INSERT INTO stock_phase` in `vps-service/`, `scripts/`: 0 matches in production code (only in archived/maintenance scripts).
- Grep for `SELECT FROM stock_phase` in `vps-service/`: 0 matches (only `audit_production_db.py` lists it as expected).

**Impact:** Dead data occupying space. Could confuse future agents into thinking the table is active.

**Remediation:** Drop the table OR revive it with an explicit writer. Needs owner decision (Rule 16: VERIFY-BEFORE-DELETE).

---

## V7 — 🟠 MEDIUM: `distribution` events never recorded in `radar_signal_tracking`

**Evidence (file:line):**
```python
# scripts/maker_radar.py:515-527
if winner_path in _BULLISH_PATHS and _net_flow < 0:
    _distribution_flag = True
    winner_path = 'distribution'
    winner_position_size = 0.0
    # mark under_microscope = False + clear all bullish flags
    quiet = False
    pre_surge = False
    explosive = False
    early_break = False

# line 675:
'under_microscope': winner_path is not None and winner_path != 'distribution',
```

Then:
```python
# scripts/maker_radar.py:755
for stock in under_microscope:  # distribution stocks are NOT in under_microscope
    ...
    INSERT INTO radar_signal_tracking ...
```

**What it does:** When a stock is classified as `distribution`, it is removed from `under_microscope` (line 675). The tracking loop (line 755) only iterates over `under_microscope`, so `distribution` stocks are never INSERTed into `radar_signal_tracking`.

**Test evidence (sandbox DB):**
```sql
SELECT COUNT(*) FROM radar_signal_tracking WHERE path = 'distribution';
-- Result: 0
```

**Impact:** The owner's #1 ask (transition monitoring, especially accumulation→distribution) cannot be answered because distribution events are not recorded. The `distribution_list` (line 1492) goes to the UI output only, not to the DB.

**Root cause:** The override (line 520: `winner_path = 'distribution'`) happens BEFORE tracking (line 755), and `under_microscope` is set to False for distribution stocks (line 675). The tracking logic was written before the distribution override was added.

---

## V8 — 🟡 LOW: `predictions.db` has 5 empty/unresolved tables

**Evidence (sandbox):**
| Table | Rows | Status |
|---|---|---|
| `prediction_outcomes` | 0 | unresolved — unused? |
| `trade_outcomes` | 0 | unresolved — unused? |
| `user_trades` | 0 | unresolved — unused? |
| `sniper_performance` | 0 | unresolved — unused? |
| `prediction_lessons` | 0 | unresolved — unused? |

**Impact:** Dead schema. Could confuse agents into writing to them instead of the canonical tables.

**Remediation:** Verify whether these are planned-for-future or abandoned. If abandoned, drop (needs owner approval).

---

## V9 — 🟡 LOW: `gold_prices` table exists in both `stocks.db` (3 stale rows) and `data_engine.db` (canonical)

**Evidence (from `vps-service/utils/db_paths.py:124`):**
```python
GOLD_PRICES_DB: str = DATA_ENGINE_DB  # gold_prices — canonical: data_engine.db (187K rows).
# Dropped: stocks.db (3 stale rows).
```

**Impact:** The 3 stale rows in `stocks.db.gold_prices` are dead data. `DBPaths.get_db_for_table('gold_prices')` correctly routes to `data_engine.db`, but the stale rows in `stocks.db` could confuse a direct query.

**Status:** Documented as "Dropped" in `db_paths.py` comments, but the table physically still exists in `stocks.db` (sandbox). Production may differ (P0-8-DB-UNIFY may have cleaned it).

---

## Summary table

| # | Violation | Severity | Owner to fix | Blocked by |
|---|---|---|---|---|
| V1 | maker_radar unscoped DELETE | 🔴 HIGH | maker_radar.py owner | Needs ownership marker (schema change V2-UNIQUE or `source` column) |
| V2 | INSERT OR REPLACE without UNIQUE | 🔴 HIGH | state_history_tracker.py owner | Needs UNIQUE INDEX + duplicate cleanup (backup first) |
| V3 | state_history_tracker bypasses env override | 🟠 MEDIUM | state_history_tracker.py owner | Switch to db_manager / DBPaths |
| V4 | news.db multi-writer (Python + Node.js) | 🔴 HIGH | news architecture owner | Define single owner, make other read-only or API-based |
| V5 | daily_closer bypasses PredictionTracker | 🟠 MEDIUM | daily_closer.py owner | Route through PredictionTracker methods |
| V6 | stock_phase orphaned | 🟡 LOW | owner decision | Drop or revive |
| V7 | distribution events never recorded | 🟠 MEDIUM | maker_radar.py owner | Reorder: track BEFORE override |
| V8 | 5 empty unresolved tables in predictions.db | 🟡 LOW | owner decision | Verify if planned or abandoned |
| V9 | gold_prices stale rows in stocks.db | 🟡 LOW | maintenance | Drop table from stocks.db (already canonical in data_engine.db) |

**All violations require owner approval for remediation.** None are auto-fixable within current scope (they touch protected files or require schema changes).
