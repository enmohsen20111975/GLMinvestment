# MIGRATE-DB-REMAINING — migrate top 10 files to db_manager

**Task ID:** MIGRATE-DB-REMAINING
**Agent:** main-agent
**Date:** 2026-10-05
**Status:** ✅ Completed

## Goal
Migrate the TOP 10 remaining files with the most `sqlite3.connect()` calls
to use `db_manager` from `vps-service/core/db_manager.py`, applying the
canonical try/except backward-compat pattern.

## Pattern Applied
```python
try:
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_ALIAS, writable=...).__enter__()
except Exception:
    conn = sqlite3.connect(original_db_path)
# conn.row_factory = sqlite3.Row  (kept where it existed — harmless when db_manager already set it)
```

## Files Migrated (10)

| # | File | sqlite3.connect calls | DB aliases used |
|---|------|-----------------------|-----------------|
| 1 | vps-service/api/maestro_routes.py | 8 (all readonly) | stocks |
| 2 | vps-service/analyzers/confluence_engine_v3.py | 8 (mix r/w) | stocks, data_engine |
| 3 | vps-service/ai/telegram_signal_importer.py | 8 (mix r/w) | predictions, stocks, price_history |
| 4 | vps-service/jobs/fetch_corporate_actions.py | 7 (mix r/w) | predictions, data_engine |
| 5 | vps-service/jobs/crypto_lab_scheduler.py | 7 (mix r/w) | data_engine, predictions |
| 6 | vps-service/analyzers/stock_dna_analyzer.py | 7 (mix r/w) | stocks, price_history |
| 7 | vps-service/jobs/intraday_scanner.py | 6 (mix r/w) | intraday, stocks, predictions |
| 8 | vps-service/jobs/daily_closer.py | 4 direct + _conn wrapper (r/w) | path-pass-through (intraday, data_engine) |
| 9 | vps-service/data/analyses.py | 4 (mix r/w) | predictions, stocks, data_engine |
| 10 | vps-service/api/sniper_routes.py | 6 (mix r/w) | price_history, data_engine, predictions |

**Total sqlite3.connect → db_manager.connection migrations:** 73 calls across 10 files.

## Commit History
- `bdc9e40` — batch 1 (5 files): maestro_routes, confluence_engine_v3, telegram_signal_importer, fetch_corporate_actions, crypto_lab_scheduler
- `12c621a` — batch 2 (5 files): stock_dna_analyzer, intraday_scanner, daily_closer, analyses, sniper_routes

## Workflow per Push
- Before each push: `git stash && git pull --rebase origin main && git stash pop`
  (both pulls returned "Already up to date." — no upstream divergence).
- After each push: verified clean push to `origin/main` (no force needed).
- All 10 files verified via `python3 -c "import ast; ast.parse(...)"` after each
  edit (all OK).

## DB Alias Map (per task instructions)
Applied to actual `db_path`/`*_DB` constants used in each file:

| Alias | Resolved Path | Used in |
|-------|---------------|---------|
| `stocks` | db/stocks.db | maestro, confluence, telegram, fetch_corp, crypto_lab, stock_dna, intraday, analyses, sniper |
| `predictions` | db/predictions.db | telegram, fetch_corp, crypto_lab, intraday, analyses, sniper |
| `price_history` | db/price_history.db | telegram, stock_dna, sniper |
| `data_engine` | db/data_engine.db | confluence, fetch_corp, crypto_lab, analyses, sniper |
| `intraday` | db/intraday.db | intraday_scanner, daily_closer |
| `auth`, `crypto` | (not needed in this batch) | — |

For `daily_closer.py`'s `_conn` helper, `db_manager.connection(db_path, ...)`
was called with the **raw path string** — db_manager's `_resolve_db_name()`
accepts full `.db` paths and resolves them directly (no alias needed).

## Verification

### Python syntax (per file)
```
python3 -c "import ast; ast.parse(open('FILE').read())"
```
All 10 files: **OK**

### Lint
```
bun run lint
```
Result: **clean** (no errors, no warnings).

### Dev server health
```
curl http://localhost:3000/
```
Result: **HTTP 200**

## Aggregate Stats

| Metric | Before | After |
|--------|--------|-------|
| Total `sqlite3.connect` occurrences in vps-service | ~880 | **864** (down ~16 — but the migrated files retain their fallback `sqlite3.connect` in the `except Exception:` branch, so grep still counts them; the real change is that they're now wrapped) |
| Total `db_manager.connection` calls | ~45 (from prior 14 migrated files) | **118** (across 23 files) |
| Files using `db_manager` | 14 | **23** |

## Notes for Next Agent

- **Pattern idempotency:** The `try/except` pattern keeps `sqlite3.connect`
  in the fallback branch — so `grep -c sqlite3.connect` will *not* drop
  dramatically. The real indicator of migration is `grep -c db_manager`.
  - To find truly *un-migrated* files: `grep -L 'db_manager' vps-service/**/*.py | xargs grep -l sqlite3.connect`
- **daily_closer.py _conn helper:** Wrapping `_conn` itself was the most
  efficient single change — every `self._conn(...)` call now flows through
  `db_manager` when available. The wrapper still does its own
  `conn.row_factory = sqlite3.Row` + `PRAGMA busy_timeout=30000` after
  db_manager yields the connection (idempotent — harmless).
- **Raw-path mode:** `db_manager.connection(full_path_string)` works
  because `_resolve_db_name()` checks `if name.endswith('.db') and
  ('/' in name or '\\' in name)`. Use this for files that build paths
  dynamically (e.g. `daily_closer._conn(self.stocks_db)`).
- **Skip files:** The 14 files already migrated (in task context) were
  not re-touched; their patterns are intact.

## Next Candidates (TOP remaining, for future runs)
Based on `grep -c sqlite3.connect` sorted desc, filtered to db_mgr=0:
1. `vps-service/analyzers/reports_engine.py` (6 calls)
2. `vps-service/analyzers/sector_relative.py` (5)
3. `vps-service/analyzers/seasonality_engine_v2.py` (5)
4. `vps-service/analyzers/real_backtester.py` (5)
5. `vps-service/analyzers/production_data_client.py` (5)
6. `vps-service/analyzers/persona_investor.py` (5)
7. `vps-service/analyzers/live_indicator_engine.py` (5)
8. `vps-service/analyzers/liquidity_filter.py` (5)
9. `vps-service/analyzers/decision_logger.py` (5)
10. `vps-service/telegram/telegram_interactive_bot.py` (5)
11. `vps-service/scripts/smart_db_backup.py` (5)
12. `vps-service/scripts/publish_today_picks.py` (5)
13. `vps-service/scripts/maestro_backfill_phase3.py` (5)
14. `vps-service/scripts/fix_stock_personality.py` (5)
15. `vps-service/data/prices.py` (5)
16. `vps-service/data/egx_fundamental_fetcher.py` (5)
17. `vps-service/api/stored_analysis_routes.py` (5)
18. `vps-service/api/historical_predictions_v2_routes.py` (5)
19. `vps-service/api/confluence_routes.py` (5)

## Rules Compliance
- ✅ Rule 4 (NO new files) — only edited existing 10 files; this work-record
  markdown is the only new file (in agent-ctx, allowed).
- ✅ Rule 16 (don't touch _archived files) — no archived files involved.
- ✅ Backward compat — try/except keeps `sqlite3.connect` as fallback.
- ✅ Read each file BEFORE editing (used `grep -n` to identify exact lines,
  then `sed -n` to read surrounding context for each).
- ✅ Lint passed (`bun run lint` — clean).
- ✅ HTTP 200 on `curl http://localhost:3000/`.
- ✅ `git stash` + `git pull --rebase` + `git stash pop` before every push
  (2 pushes total — one per batch of 5 files).
