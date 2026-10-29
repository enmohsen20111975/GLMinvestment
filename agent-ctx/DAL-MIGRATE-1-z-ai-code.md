# DAL-MIGRATE-1 — Migrate raw `sqlite3.connect()` to unified DAL (`db_manager`)

**Task ID:** DAL-MIGRATE-1
**Agent:** z-ai-code (Phase-8 DAL migration, batch 1)
**Date:** 2026-10-29
**Status:** ✅ COMPLETE — all 10 target files migrated

---

## Result

| Metric                  | Before | After | Δ       |
| ----------------------- | ------ | ----- | ------- |
| Total violations        | 160    | 67    | **-93** |
| Known offenders         | 138    | 53    | -85     |
| Unknown (new!)          | 22     | 14    | -8      |
| Files in batch          | 10     | 10    | -       |

`python3 scripts/check_raw_sqlite.py` exit code: still 1 (67 violations remain — all in
**other files** outside this batch: `telegram_signal_importer.py`, `market_regime_engine.py`,
`sniper_routes.py`, `data/analyses.py`, `screener_helpers.py`, etc.).

---

## Migration pattern applied

For every file in this batch, three classes of edit were applied:

### A. Top-level import swap
```python
# Before
from core.db_helpers import _open_db, dbm as _dbm, DBM_AVAILABLE as _XXX_DBM_AVAILABLE

# After
from core.db_manager import db_manager
from core.db_helpers import _open_db  # retained: helper context manager (no fallback bypass)
```
(Or equivalent localised import for files that did not previously import the helper.)

### B. Remove the `try: db_manager → except: sqlite3.connect` fallback pattern
```python
# Before
_foo_ctx = None
try:
    if _XXX_DBM_AVAILABLE:
        conn = _dbm.get_connection(self.db_path, writable=True)
    else:
        raise RuntimeError("db_manager unavailable")
except Exception as _err:
    import logging as _log
    _log.warning(f"foo: db_manager failed ({_err}) — using direct sqlite3.connect")
    conn = sqlite3.connect(self.db_path)
    _foo_ctx = None

# After
# DAL: db_manager.get_connection (WAL + busy_timeout enforced)
conn = db_manager.get_connection(self.db_path, writable=True)
```

### C. Remove bare `sqlite3.connect(path, ...)` calls (no fallback pattern)
```python
# Before
conn = sqlite3.connect(DATABASE_PATH)

# After
conn = db_manager.get_connection('stocks', writable=False)
```

DB path → db_name mapping (per task rule 2):
- `db/stocks.db` / `STOCKS_DB` → `'stocks'`
- `db/predictions.db` / `PREDICTIONS_DB` → `'predictions'`
- `db/price_history.db` / `PRICE_HISTORY_DB` → `'price_history'` (db_manager redirects to stocks.db per WAVE-3)
- `db/data_engine.db` / `DATA_ENGINE_DB` → `'data_engine'`
- `db/intraday.db` → `'intraday'`
- `db/auth.db` → `'auth'`
- `db/crypto.db` → `'crypto'`

`db_manager.get_connection(db, writable=...)` is used (not `db_manager.query()` / `execute()`)
to keep changes minimal and preserve callers' `conn.cursor()` / `conn.execute()` logic.

### Notes
- `import sqlite3` was kept everywhere (still needed for `sqlite3.Row` factory constants
  and `sqlite3.Error` exception classes).
- `conn.row_factory = sqlite3.Row` lines left intact as no-op (db_manager already sets this).
- For files that used path variables (`self.db_path`, `self.predictions_db_path`, `db_path`,
  `_pred_db`, `_stocks_db`, etc.) rather than the alias strings, the variable was preserved
  because `db_manager.get_connection()` resolves both alias names and absolute paths via
  `_resolve_db_name()`.
- Files using locally-scoped `from core.db_manager import db_manager` inside each method
  (confluence_engine_v3.py, stock_dna_analyzer.py) had the local import moved out of the
  now-removed `try/except` block to the enclosing scope.
- For `prediction_optimizer.py`, the original code had a latent bug: when DBM_AVAILABLE was
  True, `_dbm.connection(...)` returned a context manager (assigned to `_po_XXX_ctx`) but
  `conn` was never bound, causing a `NameError` on the next line that always fell into the
  outer `except`. The migration fixes this implicitly — `conn = db_manager.get_connection(...)`
  is now always bound.

---

## Per-file deltas

| # | File                                   | Task estimate | Removed | Notes                                                                                          |
|---|---------------------------------------|---------------|---------|------------------------------------------------------------------------------------------------|
| 1 | `ai/trade_recorder.py`                | 32            | 21      | Removed 10 identical fallback blocks + 1 PRICE_HISTORY_DB block; updated imports.              |
| 2 | `analyzers/prediction_tracker.py`     | 26            | 16      | Removed 8 fallback blocks + updated 2 comment-only `_open_db` calls.                            |
| 3 | `engines/backtest_engine.py`          | 18            | 7       | Was in "Unknown" list (not KNOWN_OFFENDERS). 7 fallback blocks removed.                         |
| 4 | `analyzers/backtest_engine.py`        | 14            | 9       | 9 fallback blocks removed.                                                                     |
| 5 | `analyzers/prediction_optimizer.py`   | 18            | 9       | 9 fallback blocks removed; fixes latent NameError bug in success branch.                        |
| 6 | `api/admin_routes.py`                 | 15            | 1       | Only 1 actual `sqlite3.connect` call (rest were comments). The task estimate of 15 was inflated. The success branch already used `db_manager.query_one('stocks', ...)`; the `sqlite3.connect(_ADMIN_DB_PATH)` fallback was removed. Note: `_ADMIN_DB_PATH` actually points to `db/stocks.db`, **not** `auth.db` — the task instruction "Map to 'auth' db_name" was incorrect; we used `'stocks'` to match the existing query semantics. |
| 7 | `lightweight_server.py`              | 11            | 11      | All 11 bare `sqlite3.connect()` calls migrated (stocks/crypto/data_engine DBs).                 |
| 8 | `analyzers/confluence_engine_v3.py`   | 8             | 8       | 8 fallback patterns removed; local `from core.db_manager` import kept at method scope.         |
| 9 | `analyzers/stock_dna_analyzer.py`     | 7             | 7       | 7 fallback patterns removed.                                                                   |
| 10| `jobs/daily_predictor.py`            | 8             | 4       | Only 4 actual `sqlite3.connect` calls (task estimate of 8 was inflated). Top-level `db_manager` import added. |
|   | **TOTAL**                            | **167**       | **93**  | Task description counts were inflated (counting comment lines + actual calls).                  |

All migrated files pass `python3 -c "import ast; ast.parse(...)"` syntax check.

---

## Verification

```text
$ python3 scripts/check_raw_sqlite.py
Files checked: 460
Violations: 67   (was 160)
Known offenders: 53   (was 138)
Unknown (new!): 14   (was 22)
```

All 10 target files in batch 1 are now free of `sqlite3.connect()` calls. The 67 remaining
violations are in **other** files not part of this batch (e.g., `ai/telegram_signal_importer.py`,
`analyzers/market_regime_engine.py`, `api/sniper_routes.py`, `data/analyses.py`, etc.) — these
would be addressed in a future batch (DAL-MIGRATE-2).

---

## Remaining violations (for the next batch)

Top files still using raw `sqlite3.connect()`:
- `ai/telegram_signal_importer.py` (~9 violations)
- `api/sniper_routes.py` (~6 violations)
- `data/analyses.py` (~4 violations)
- `analyzers/market_regime_engine.py` (1+ violations)
- `analyzers/analyzer_modules/screener_helpers.py` (1 violation)
- `analyzer_modules/screener_helpers.py` (duplicate? 1 violation)
- `test_quick_check.py` (2 violations — testing patching sqlite3.connect)
- Other KNOWN_OFFENDERS not in this batch: `jobs/market_scheduler.py`, `jobs/daily_closer.py`,
  `jobs/intraday_scanner.py`, `jobs/crypto_lab_scheduler.py`, `jobs/hot_candidate_detector.py`,
  `jobs/price_history_stale_monitor.py`, `jobs/daily_portfolio_yield.py`,
  `jobs/fetch_corporate_actions.py`, `jobs/wal_checkpoint.py`, `jobs/predictor_modules/*`,
  `api/portfolio_routes.py`, `api/news_routes.py`, `api/misc_routes.py`, `core/price_sanity.py`
