# Architecture Enforcement Plan — GLMinvestment
> **Status:** Design document. Tests not yet wired into CI.
> **Goal:** Prevent the violations documented in `DATABASE-OWNERSHIP-REGISTRY.md` from recurring.

## 1. What these checks can and cannot detect

### CAN detect (static analysis)
- A new `.db` file or table referenced in code without an entry in `DATABASE-OWNERSHIP-REGISTRY.md`.
- A direct `sqlite3.connect()` call from a component not listed as the write owner of the target table.
- An `INSERT INTO` / `UPDATE` / `DELETE FROM` statement on a table owned by another component.
- A `DELETE FROM <table> WHERE <col> = ?` without a ticker/scope qualifier (unscoped delete).
- A new file that duplicates the function of an existing module (heuristic: same primary class name or same purpose).
- An `INSERT OR REPLACE` on a table without a `UNIQUE` constraint covering the natural key.

### CANNOT detect
- Runtime concurrency issues (race conditions between Python and Node.js writers).
- Schema drift between sandbox and production.
- Whether a "writer" actually runs on production (cron config is on VPS).
- Whether a reader violates read permissions (too noisy to enforce statically).
- Business logic correctness (e.g., is `canonical_state` actually useful?).

## 2. Proposed checks (Python, AST-based)

### Check 1: `check_db_write_ownership.py`
Scans all `.py` and `.ts/.tsx` files for `INSERT INTO`, `UPDATE`, `DELETE FROM` on tracked tables. For each match, verifies the file is listed as write owner in the registry. Reports violations.

```python
# Pseudocode (not yet implemented)
TRACKED_TABLES = load_registry()  # {table_name: [allowed_writers]}
for file in scan_src_files():
    for match in find_sql_writes(file):
        table = match.table_name
        if table in TRACKED_TABLES:
            if file not in TRACKED_TABLES[table].allowed_writers:
                report_violation(file, table, match.line)
```

**Test cases (positive = should pass, negative = should fail):**
- ✅ `prediction_tracker.py` writing to `predictions` → PASS (it's the owner)
- ❌ `daily_closer.py` writing to `predictions` → FAIL (bypasses PredictionTracker)
- ❌ `src/app/api/admin/news/route.ts` writing to `market_news` → FAIL (news-agent is the owner)
- ❌ any new file writing to `predictions` → FAIL

### Check 2: `check_unscoped_deletes.py`
Scans for `DELETE FROM <table> WHERE <col> = ?` where `<col>` is not a primary key or unique identifier (e.g., `WHERE signal_date = ?` without `AND ticker = ?` AND ownership scope).

**Test cases:**
- ❌ `maker_radar.py:752` `DELETE FROM radar_signal_tracking WHERE signal_date = ?` → FAIL (unscoped)
- ✅ `DELETE FROM radar_signal_tracking WHERE id = ?` → PASS (PK-scoped)

### Check 3: `check_insert_or_replace_without_unique.py`
For each `INSERT OR REPLACE INTO <table>`, verifies the table has a UNIQUE constraint (PRIMARY KEY alone is insufficient — `INSERT OR REPLACE` only triggers replace on UNIQUE/PK conflict, and `id AUTOINCREMENT` will never conflict).

**Test cases:**
- ❌ `state_history_tracker.py:138` `INSERT OR REPLACE INTO radar_signal_tracking` → FAIL (no UNIQUE on natural key)
- ✅ `INSERT OR REPLACE INTO stocks (ticker, ...)` → PASS (if `ticker` has UNIQUE)

### Check 4: `check_direct_sqlite_connect.py`
Scans for `sqlite3.connect('...stocks.db')` or `sqlite3.connect('...predictions.db')` direct calls from components not authorized to write. The sanctioned path is `db_manager.get_connection(DBPaths.X, writable=...)`.

**Test cases:**
- ❌ `state_history_tracker.py:163` direct connect → FAIL (should use `db_manager`)
- ✅ `db_manager.py` internal connect → PASS

### Check 5: `check_new_db_files.py`
Scans for `*.db` files in `db/` not listed in the registry. Prevents silent creation of new databases.

### Check 6: `check_env_override_respect.py`
Scans for hardcoded DB paths like `'stocks.db'` or `'predictions.db'` that bypass `DBPaths` / env overrides.

### Check 7: `check_duplicate_modules.py`
Heuristic: detects two files with the same primary class name or same docstring purpose (e.g., `canonical_signal.py` vs `canonical_stock_state.py`).

## 3. What to wire these into

- Pre-commit hook (`.git/hooks/pre-commit`) — runs `check_db_write_ownership.py` + `check_unscoped_deletes.py` on staged files.
- CI check (GitHub Actions) — full scan on PR.
- `scripts/check_architecture.py` (existing) — extend with these checks.

**Not yet implemented.** This is the design. Implementation requires owner approval (adds files + CI config).

## 4. Limitations

These checks will not catch:
- A writer that exists but is not invoked (dead code).
- A reader that should be a writer (under-permissioned).
- Business logic violations (e.g., wrong R:R, wrong ATR).
- Production-only schema drift.

They will catch the **mechanical** violations that caused the issues documented in the registry.
