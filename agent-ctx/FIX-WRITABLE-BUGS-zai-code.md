# Task: FIX-WRITABLE-BUGS — Fix 27 `writable=False` write-path bugs

**Agent:** Z.ai Code (direct execution, no subagents delegated)
**Date:** 2026-10-28
**Scope:** One-line fixes changing `writable=False` → `writable=True` in 27 functions
across the `vps-service` codebase that perform WRITE operations (CREATE TABLE /
INSERT / UPDATE / DELETE / ALTER / commit). With `writable=False`, `db_manager`
sets `PRAGMA query_only=1`, so every write silently raised
`sqlite3.OperationalError: attempt to write a readonly database`.

## Root cause
Previous dev ("Bravo") ran a Phase 7.1 migration replacing `sqlite3.connect()`
with `db_manager.get_connection(..., writable=False)` everywhere, without
checking whether each function actually performs writes. Result: 27 functions
broke on every write.

## Files modified (17 files, 27 fixes)

| # | File | Line (after edit) | Original line | Function / context |
|---|------|-------------------|---------------|--------------------|
| 1 | `vps-service/jobs/learning_engine.py` | 109 | 108 | `LearningEngine._conn` (used by `_ensure_tables` → CREATE TABLE) |
| 2 | `vps-service/jobs/market_scheduler.py` | 1646 | 1645 | EGXPilot live-price path → UPDATE stocks + commit |
| 3 | `vps-service/jobs/market_scheduler.py` | 1758 | 1756 | TradingView fallback → UPDATE stocks + commit |
| 4 | `vps-service/jobs/market_scheduler.py` | 1894 | 1891 | screener_presets builder → CREATE TABLE + INSERT + commit |
| 5 | `vps-service/jobs/market_scheduler.py` | 2092 | 2088 | `_update_portfolio_live_prices` → UPDATE portfolio_assets + commit |
| 6 | `vps-service/jobs/price_history_safetynet.py` | 279 | 278 | gap-fill → CREATE TABLE + INSERT + commit |
| 7 | `vps-service/jobs/intraday_aggregator.py` | 235 | 234 | `ph_conn` → CREATE TABLE + INSERT + commit (line 224 `intraday_conn` left read-only) |
| 8 | `vps-service/api/admin_routes.py` | 4998 | 4997 | `admin_reset_user_trial` → UPDATE User SET trial_ends_at + commit |
| 9 | `vps-service/api/admin_routes.py` | 5059 | 5057 | `admin_extend_user_trial` → UPDATE User SET trial_ends_at + commit |
| 10 | `vps-service/api/historical_predictions_v2_routes.py` | 487 | 486 | `_insert_prediction` → INSERT INTO predictions + commit |
| 11 | `vps-service/api/historical_predictions_v2_routes.py` | 542 | 540 | `_clear_existing_for_tickers` → DELETE FROM predictions + commit |
| 12 | `vps-service/analyzers/screener.py` | 68 | 67 | `_get_stocks_conn` (only caller = `save_results` → DELETE + INSERT + commit) |
| 13 | `vps-service/analyzers/trader_levels_engine.py` | 217 | 216 | → UPDATE predictions SET entry_price_min + commit |
| 14 | `vps-service/analyzers/engine_settings.py` | 1314 | 1313 | `update_setting` → CREATE TABLE + INSERT + commit (line 511 `get_setting` left read-only) |
| 15 | `vps-service/engines/paper_trade_tracker.py` | 226 | 225 | `connect()` → `self.conn` used for ALL writes |
| 16 | `vps-service/utils/win_lesson_store.py` | 229 | 228 | → INSERT INTO learned_lessons + commit |
| 17 | `vps-service/telegram/telegram_db.py` | 36 | 35 | `get_connection` ctxmgr → CREATE TABLE + INSERT + UPDATE + commit |
| 18 | `vps-service/data/egksco_scraper.py` | 666 | 665 | → UPDATE stocks + INSERT + commit |
| 19 | `vps-service/data/egksco_scraper.py` | 733 | 731 | `conn_hist` → ALTER TABLE + INSERT + commit |
| 20 | `vps-service/data/egksco_scraper.py` | 817 | 814 | `conn_de` → ALTER TABLE + INSERT + commit |
| 21 | `vps-service/data/eodhd_fetcher.py` | 112 | 111 | → UPDATE stocks + INSERT + commit |
| 22 | `vps-service/data/eodhd_fetcher.py` | 191 | 189 | → INSERT OR REPLACE stock_daily_prices + UPDATE stocks + commit |
| 23 | `vps-service/data/eodhd_fetcher.py` | 328 | 325 | → UPDATE stocks + commit |
| 24 | `vps-service/data/gap_filler.py` | 99 | 98 | `s_conn` → INSERT OR IGNORE + UPDATE + commit |
| 25 | `vps-service/data/gap_filler.py` | 103 | 101 | `ph_conn` → INSERT OR IGNORE + UPDATE + commit |
| 26 | `vps-service/api/portfolio_routes.py` | 129 | 128 | `_get_portfolio_conn` (used by `_save_portfolio_state` → INSERT + DELETE + INSERT + commit) |
| 27 | `vps-service/telegram/telegram_target_hit_tracker.py` | 918 | 917 | → UPDATE predictions SET status='TARGET_HIT' + commit (line 248 `con_p` left read-only) |

## Read-only connections intentionally LEFT as `writable=False`
(verified still `writable=False` after edits)
- `vps-service/jobs/intraday_aggregator.py:224` — `intraday_conn` (SELECTs only)
- `vps-service/analyzers/engine_settings.py:511` — `get_setting` (SELECT only)
- `vps-service/api/portfolio_routes.py:656, 2029, 2060, 2086` — read-only paths
- `vps-service/telegram/telegram_target_hit_tracker.py:248` — `con_p` (SELECT only)
- `vps-service/jobs/market_scheduler.py:243` (`conn_stocks`) and `:1724` (ticker SELECT) — read-only, NOT in scope

## screener.py special case (item #12)
Verified `_get_stocks_conn()` is used by **only one caller** within `screener.py`:
`save_results()` (line 544), which performs DELETE + INSERT + commit. The other
`_get_stocks_conn` definitions found by grep live in *different modules*
(`hard_protection.py`, `sector_tracking_routes.py`, `top_performers_routes.py`,
`screener_routes.py`, `advanced_screener_routes.py`) — they are independent
module-level functions, not the same symbol. Therefore no separate
`_get_stocks_writable_conn()` helper was needed; a single in-place
`writable=False → writable=True` flip is correct and safe.

## Lint result
`bun run lint` → **PASS** (ESLint lints JS/TS only; Python files unaffected.
No errors emitted, exit 0.)

## Notes for follow-up tasks (NOT fixed here — out of scope per instructions)
During the audit grep for `writable=False`, additional write-path connections
were observed that are NOT part of this task's 27-item list and were left
untouched ("silent failure bugs" — separate task). Examples spotted:
- `vps-service/jobs/learning_engine.py` lines 454, 1054, 1153 (PREDICTIONS_DB / stocks_db)
- `vps-service/jobs/market_scheduler.py:243` (`conn_stocks`)
- `vps-service/api/admin_routes.py` lines 4688, 4724, 4774, 4833, 4855 (backup/db_file paths)
- `vps-service/api/historical_predictions_v2_routes.py` lines 66, 88, 609
- `vps-service/analyzers/screener.py:60` (`_get_de_conn`)
- `vps-service/utils/win_lesson_store.py:387` (read-only SELECT — confirmed OK)
- `vps-service/data/gap_filler.py:33` (PRICE_HISTORY_DB)
- `vps-service/telegram/telegram_target_hit_tracker.py` lines 163, 320

These should be triaged in a follow-up "silent failure bugs" pass to determine
which are genuine write-path bugs vs. legitimately read-only connections.
