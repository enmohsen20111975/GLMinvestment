# Phased Remediation Plan — GLMinvestment Database Governance
> **Status:** Plan only. No execution without owner approval per phase.
> **Dependency graph:** Each phase lists what it unblocks.

## Principles
1. **Backup before any schema change.** Use `sqlite3 db/X.db ".backup '/path/X.db.bak-TIMESTAMP'"`.
2. **Test on isolated copy first.** Use `production_db_audit.py` output to build a test fixture.
3. **One phase at a time.** Do not combine phases — each needs its own verification window.
4. **Rollback plan mandatory.** Every phase has a rollback procedure documented.
5. **No phase touches production data without owner sign-off.**

---

## Phase 0: Evidence gathering (NO code change, NO schema change)

**Goal:** Collect production data to confirm which violations actually exist on VPS.

**Actions:**
1. Run `scripts/production_db_audit.py` on VPS (read-only, safe).
2. Share the output.
3. Update `DATABASE-OWNERSHIP-REGISTRY.md` with production numbers (not sandbox estimates).

**Unblocks:** All subsequent phases — without production evidence, we cannot size the cleanup.

**Risk:** None (read-only).

**Rollback:** N/A.

**Owner decision needed:** None. Just run the script and share output.

---

## Phase 1: Fix V7 — `distribution` events never recorded (LOW RISK, code-only)

**Goal:** Record distribution events in `radar_signal_tracking` so transition monitoring works.

**Change:** In `scripts/maker_radar.py`, reorder the tracking logic:
- BEFORE: override `winner_path='distribution'` → remove from `under_microscope` → track only `under_microscope`.
- AFTER: track ALL classified stocks (including distribution) → then override for UI display.

**Files touched:** `scripts/maker_radar.py` (lines ~670-760).

**Risk:** LOW — code-only change. No schema change. No data migration.

**Test:**
- Run `maker_radar` on sandbox with sample data.
- Verify `SELECT COUNT(*) FROM radar_signal_tracking WHERE path='distribution'` returns > 0.
- Verify bullish paths still tracked correctly.

**Rollback:** `git revert <commit>`.

**Owner decision needed:** Approve the reorder (changes `maker_radar.py` behavior — adds rows that weren't there before).

**Unblocks:** Transition monitoring (accumulation→distribution) becomes possible.

---

## Phase 2: Fix V3 — `state_history_tracker.py` respects env override (LOW RISK, code-only)

**Goal:** Make `state_history_tracker.py` use the sanctioned `db_manager` / `DBPaths` interface.

**Change:**
```python
# BEFORE (line 163):
conn_st = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=30)

# AFTER:
from core.db_manager import db_manager
from utils.db_paths import DBPaths
conn_st = db_manager.connection(DBPaths.STOCKS_DB, writable=True).__enter__()
```

Same for `conn_ph` (line 162) → `DBPaths.PRICE_HISTORY_DB`.

**Files touched:** `vps-service/camp/state_history_tracker.py` (lines 162-163).

**Risk:** LOW — uses existing sanctioned interface. No schema change.

**Test:**
- Set `STOCKS_DB=/tmp/test_stocks.db` env var.
- Run `state_history_tracker.py`.
- Verify it writes to `/tmp/test_stocks.db`, not `db/stocks.db`.

**Rollback:** `git revert <commit>`.

**Owner decision needed:** Approve the interface switch (changes which DB file the tracker writes to if env is set — but on production without env override, behavior is identical).

**Unblocks:** V2 fix (UNIQUE INDEX) becomes safe — all writers now respect the same DB path.

---

## Phase 3: Fix V5 — `daily_closer.py` routes through `PredictionTracker` (MEDIUM RISK)

**Goal:** Eliminate direct `UPDATE predictions` in `daily_closer.py`.

**Change:** Replace 5 direct SQL UPDATEs with calls to `PredictionTracker.set_verified_outcome()` (or add new methods if needed).

**Files touched:**
- `vps-service/jobs/daily_closer.py` (lines 886, 2352, 3079, 3167, 3205).
- Possibly `vps-service/analyzers/prediction_tracker.py` (add methods if missing).

**Risk:** MEDIUM — changes the outcome-update path. If `PredictionTracker` methods have different logic (e.g., triggering learning engine), behavior changes.

**Test:**
- Run `daily_closer` on sandbox with sample predictions.
- Verify outcomes are written correctly.
- Verify any side-effects (learning engine triggers) fire as expected.

**Rollback:** `git revert <commit>`.

**Owner decision needed:** Approve the routing change + any new methods in `PredictionTracker`.

**Unblocks:** Single ownership of `predictions` table writes.

---

## Phase 4: Fix V1 — scoped DELETE in `maker_radar.py` (MEDIUM RISK, needs ownership marker)

**Goal:** `maker_radar.py` DELETE only its own rows, not canonical_state or frontend picks.

**Problem:** Currently no reliable ownership marker exists. Options:
- (A) `WHERE signal_type != 'canonical_state'` — too broad (wipes frontend picks).
- (B) `WHERE path IS NOT NULL` — risky if frontend sets path.
- (C) `WHERE signal_type IN (radar_paths_list)` — fragile list.
- (D) Add `source` column (schema change) — cleanest but needs migration.

**Recommended approach:** (D) — add `source TEXT DEFAULT 'maker_radar'` column (safe `ALTER TABLE ADD COLUMN`), then scope DELETE by `WHERE signal_date=? AND source='maker_radar'`.

**Files touched:**
- `scripts/maker_radar.py` (line 752 + INSERT statements to set `source`).
- `vps-service/camp/state_history_tracker.py` (set `source='canonical_state'`).
- `src/modules/radar/lib/radar-signal-tracker.ts` (set `source='frontend'`).

**Risk:** MEDIUM — schema change (additive, safe) + behavior change in DELETE.

**Test:**
- Add column on sandbox copy.
- Run `maker_radar` → verify canonical_state rows survive.
- Run `state_history_tracker` → verify `source='canonical_state'` is set.
- Test DELETE scope.

**Rollback:** 
- Code: `git revert <commit>`.
- Schema: column is additive (DEFAULT), dropping it is safe but needs `ALTER TABLE DROP COLUMN` (SQLite 3.35+).

**Owner decision needed:** Approve additive schema change + behavior change.

**Unblocks:** V2 (UNIQUE INDEX) can be added safely — all writers now identify themselves.

---

## Phase 5: Fix V2 — UNIQUE INDEX on `(ticker, signal_date, signal_type, source)` (HIGH RISK, needs migration)

**Goal:** Prevent duplicate rows. Make `INSERT OR REPLACE` actually replace.

**Prerequisites:** Phase 4 must be complete (so `source` column exists and is populated).

**Steps:**
1. **Backup:** `sqlite3 db/stocks.db ".backup '/root/stocks.db.bak-UNIQUE-TIMESTAMP'"`
2. **Audit duplicates:** Run `production_db_audit.py` SECTION 8 — confirm exact duplicate count.
3. **Clean duplicates:** Keep `MIN(id)` per `(ticker, signal_date, signal_type, source)`, delete the rest.
   ```sql
   DELETE FROM radar_signal_tracking
   WHERE id NOT IN (
       SELECT MIN(id) FROM radar_signal_tracking
       GROUP BY ticker, signal_date, signal_type, source
   );
   ```
4. **Add UNIQUE INDEX:**
   ```sql
   CREATE UNIQUE INDEX idx_radar_unique_owner
   ON radar_signal_tracking(ticker, signal_date, signal_type, source);
   ```
5. **Verify:** Re-run audit script, confirm 0 duplicates.

**Files touched:** None (schema only).

**Risk:** HIGH — schema migration on production data. If duplicate cleanup deletes the wrong rows, data is lost.

**Test:**
- Perform steps 1-5 on sandbox copy first.
- Verify row count before/after matches expectation.
- Verify `INSERT OR REPLACE` now replaces instead of inserting.

**Rollback:** Restore from backup: `cp /root/stocks.db.bak-UNIQUE-TIMESTAMP db/stocks.db`.

**Owner decision needed:** 
- Approve the UNIQUE key definition (is `(ticker, signal_date, signal_type, source)` correct?).
- Approve the duplicate cleanup (which rows to keep).
- Approve the migration window (offline? maintenance mode?).

**Unblocks:** `INSERT OR REPLACE` in `state_history_tracker.py` works correctly.

---

## Phase 6: Fix V4 — `news.db.market_news` single-writer (HIGH RISK, architecture change)

**Goal:** Eliminate multi-writer conflict on `market_news`.

**Options:**
- (A) Make `news-agent` (Python) the sole writer. Node.js admin route becomes read-only or calls a Python API.
- (B) Make Node.js admin route the sole writer. `news-agent` posts via HTTP API to Next.js.
- (C) Introduce a message queue (overkill for this project).

**Recommended:** (A) — `news-agent` is the canonical writer (per `db_paths.py` comments). Node.js admin route should POST to a Python endpoint instead of writing directly.

**Files touched:**
- `src/app/api/admin/news/route.ts` — replace direct SQL with `fetch(PYTHON_BACKEND + '/api/news/admin', ...)`.
- `vps-service/api/news_routes.py` — add admin endpoints (INSERT/UPDATE/DELETE) if not existing.
- `news-agent/main.py` — no change (already the writer).

**Risk:** HIGH — changes admin UI behavior. If Python endpoint is down, admin can't manage news.

**Test:**
- Verify admin route still works (create/update/delete news via UI).
- Verify `news-agent` writes are not affected.
- Verify no race conditions.

**Rollback:** `git revert <commit>` (Node.js route reverts to direct SQL).

**Owner decision needed:** Approve architecture change (Node.js → Python API for news admin).

**Unblocks:** Single ownership of `market_news`.

---

## Phase 7: Cleanup (LOW RISK, deferred)

**Goal:** Remove dead data.

**Actions:**
- V6: Drop `stock_phase` table (after verifying no reader exists).
- V8: Drop 5 empty unresolved tables in `predictions.db` (after verifying unused).
- V9: Drop `gold_prices` from `stocks.db` (canonical is in `data_engine.db`).

**Risk:** LOW — dropping empty/dead tables.

**Owner decision needed:** Approve each drop (Rule 16: VERIFY-BEFORE-DELETE).

---

## Dependency graph

```
Phase 0 (evidence) → all phases
Phase 1 (V7 distribution) → independent (code-only)
Phase 2 (V3 env override) → Phase 5 (V2 UNIQUE)
Phase 3 (V5 daily_closer) → independent (code-only)
Phase 4 (V1 scoped DELETE) → Phase 5 (V2 UNIQUE)
Phase 5 (V2 UNIQUE INDEX) → needs Phase 2 + Phase 4
Phase 6 (V4 news single-writer) → independent (architecture)
Phase 7 (cleanup) → independent (low priority)
```

**Recommended execution order:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.

**Each phase is independently reversible.** No phase depends on another being irreversible.

---

## What this plan does NOT cover

- Business logic fixes (e.g., is `canonical_state` useful? — needs Shadow Mode evidence).
- Performance optimization (e.g., SQLite lock contention under load).
- Production monitoring/alerting.
- Backup strategy review (separate concern).
- The `canonical_state` → prediction engine integration (separate, larger effort).
