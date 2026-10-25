# Database & Table Ownership Registry — GLMinvestment
> **Status:** Living document. Last updated: 2026-10-25 (Sandbox HEAD `8b0a870`).
> **Scope:** This registry covers the *actual* write/read paths found in the codebase.
> Anything not in this registry is "unowned" and must not be written to without owner approval.

## Reading guide

- **Write owner** = the single component that owns logical writes (INSERT/UPDATE/DELETE) for this table.
- **Authorized interface** = the only sanctioned entry point for writes (function, route, script).
- **Readers** = components allowed to read.
- **Key semantics** = what uniquely identifies a row.
- **Legacy status**: canonical / legacy / duplicate / unresolved.
- **Validation** = test or check that proves ownership is respected.

Multiple writers via different paths = a **violation** to be remediated, not a documented design.

---

## 1. predictions.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `predictions` | trade predictions | `analyzers/prediction_tracker.py::PredictionTracker` (Python) | `PredictionTracker.record_prediction()` (INSERT), `PredictionTracker.set_verified_outcome()` (UPDATE outcome) | UI `/api/predictions/*` (read-only), `daily_closer.py` (UPDATE — **VIOLATION**) | `id AUTOINCREMENT` (no UNIQUE on ticker+date+signal) | canonical | needs test |
| `persona_predictions` | persona-tagged predictions | `daily_predictor.py` (Python) via `PredictionTracker` | direct INSERT | UI persona routes (read) | `id AUTOINCREMENT` | canonical | needs test |
| `historical_trades` | backtest trades | `daily_predictor.py` (backtest mode) | direct INSERT | UI backtest routes (read) | `id AUTOINCREMENT` | canonical | needs test |
| `learned_lessons` | ML lessons store | `analyzers/unified_learning_engine.py` | `lesson_store.py` interface | `daily_predictor.py` (read) | `id AUTOINCREMENT` | canonical | needs test |
| `crypto_predictions_log` | crypto prediction log | `daily_predictor.py` (crypto path) | direct INSERT | UI crypto routes (read) | `id AUTOINCREMENT` | canonical | needs test |
| `exit_notifications` | exit triggers log | `jobs/daily_closer.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `morning_bell_signals` | morning bell picks | `daily_predictor.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `stored_analyses` | cached analyses | `daily_predictor.py` | UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `hunter_pick_tracking` | hunter pick log | `scripts/hunt_great_trades.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `liquidity_backtest_results` | backtest results | `scripts/deep_backtest_4months.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `liquidity_signal_outcomes` | signal outcome log | `jobs/daily_closer.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `live_ai_signals` | AI signals | `ai/glm_finance_agent.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `quant_cache` | quant cache | `analyzers/quant_engine.py` | direct INSERT | analyzers (read) | `id AUTOINCREMENT` | canonical | needs test |
| `corporate_actions` | corp actions | `jobs/fetch_corporate_actions.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `cached_analysis` | cached analyses | `analyzers/master_analyzer.py` | direct UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `aiPrediction` | AI predictions | `ai/ai_predictions_routes.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | legacy | needs review |
| `aiPredictionStats` | AI stats | `ai/ai_predictions_routes.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | legacy | needs review |
| `expert_memory_v402` | expert memory | `analyzers/expert_memory_v402.py` | direct UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `prediction_outcomes` | outcome tracking | (empty — 0 rows) | — | — | — | unresolved | unused? |
| `trade_outcomes` | trade outcome | (empty — 0 rows) | — | — | — | unresolved | unused? |
| `user_trades` | user trade journal | (empty — 0 rows) | — | — | — | unresolved | unused? |
| `sniper_performance` | sniper perf | (empty — 0 rows) | — | — | — | unresolved | unused? |
| `prediction_lessons` | pred lessons | (empty — 0 rows) | — | — | — | unresolved | unused? |

---

## 2. news.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `market_news` | market news articles | `news-agent/main.py` (Python) | direct INSERT | UI `/api/admin/news/route.ts` (read-only), Python analyzers (read) | `id AUTOINCREMENT` | canonical | needs test |
| `news_articles` | news articles (legacy) | (empty — 0 rows) | — | — | — | legacy (dead) | unused |
| `news_api_keys` | API keys | (empty — 0 rows) | — | — | `service UNIQUE` | unresolved | unused |

**VIOLATION:** `src/app/api/admin/news/route.ts` writes (INSERT/UPDATE/DELETE) directly to `market_news` from Node.js (lines 225, 311, 382, 395, 410, 419). This is a multi-writer violation: Python `news-agent` + Node.js admin route both write to the same table from different runtimes. No coordination protocol exists.

---

## 3. stocks.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `stocks` | stock metadata | `scripts/sync_stocks_metadata.py` | direct UPSERT | many (read) | `ticker` | canonical | needs test |
| `stock_daily_prices` | last 30d prices | `data_engine/sync.py` | direct INSERT | `daily_predictor.py`, `load_merged_history()` (read) | `id AUTOINCREMENT` | canonical | needs test |
| `radar_signal_tracking` | radar + canonical_state tracking | **multiple** (see §4) | **VIOLATION — multiple paths** | UI, `daily_predictor.py` (read via JSON, not SQL) | `id AUTOINCREMENT` (no UNIQUE on logical key) | canonical (table), unresolved (ownership) | needs test |
| `cached_analysis` | cached analyses | `analyzers/master_analyzer.py` | UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `real_evaluated_predictions` | evaluated preds | `daily_closer.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `outcome_logs` | outcome logs | `daily_closer.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `system_settings` | system config | `analyzers/market_regime_engine.py`, `analyzers/engine_settings.py` | direct UPSERT | many (read) | `key` | canonical | needs test |
| `market_regime_log` | regime log | `market_regime_engine.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `stock_phase` | 12-state phase | (1238 rows, frozen at 2026-10-07 per worklog audit E13) | — | — | — | legacy (orphaned) | unused? |
| `egksco_stocks` | EGKSCO stocks | `scripts/sync_stocks_metadata.py` | direct UPSERT | UI (read) | `ticker` | legacy (deprecated per Rule 46) | needs review |
| `egksco_sync_status` | sync status | `data_engine/sync.py` | direct INSERT | maintenance (read) | `id AUTOINCREMENT` | legacy | needs review |
| `stock_adaptive_profiles` | adaptive profiles | `analyzers/adaptive_weights.py` | direct UPSERT | analyzers (read) | `ticker` | canonical | needs test |
| `analytics_events` | analytics | UI `/api/analytics` (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `ExpertRecommendation` | expert recs | `scripts/seed-expert-recommendations.{js,py}` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `investors_data` | investor data | `scripts/update_stocks_from_csv.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | unresolved | needs review |
| `screener_presets` | screener presets | UI admin (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `screener_results` | screener results | `scripts/liquidity_backtest_engine.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `portfolios` | portfolios | UI `/api/portfolio/*` (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `portfolio_assets` | portfolio assets | UI (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `user_sessions` | user sessions | UI auth (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `user_stock_watchlists` | watchlists | UI (Node.js) | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `ticker_registry` | ticker registry | `scripts/sync_stocks_metadata.py` | direct UPSERT | analyzers (read) | `ticker` | canonical | needs test |
| `news_agent_articles` | news agent articles | `news-agent/main.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `conjunction_patterns` | patterns | `analyzers/unified_learning_engine.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `indicator_trust_scores` | indicator trust | `analyzers/unified_learning_engine.py` | direct UPSERT | analyzers (read) | `indicator_name` | canonical | needs test |
| `macro_indicators` | macro data | `scripts/update_macro_indicators.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `market_indices` | market indices | `scripts/sync_market_indices_live.py` | direct UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `gold_prices` | gold prices (legacy) | (3 rows — stale, per db_paths.py docs) | — | — | — | legacy (dropped in P0-8-DB-UNIFY) | should be removed |

---

## 4. radar_signal_tracking (multiple writers — VIOLATION)

This table has the most complex ownership situation in the project.

| Writer | File | Operation | What it writes | What it deletes | Owner of which rows |
|---|---|---|---|---|---|
| `scripts/maker_radar.py` | line 752, 799 | DELETE (global) + INSERT | `signal_type = path` (radar paths like A_pre_surge, B_quiet_accumulation_strong, etc.) | **ALL rows for signal_date (including canonical_state and frontend picks)** | radar path rows |
| `vps-service/camp/state_history_tracker.py` | line 138 | INSERT OR REPLACE | `signal_type = 'canonical_state'`, `path = NULL`, `canonical_state` column populated | (none — no DELETE) | canonical_state rows |
| `src/modules/radar/lib/radar-signal-tracker.ts` | line 152 | INSERT (with manual dedup) | `signal_type = input.signal_type` (e.g., manual_user_pick), `path = input.path ?? null` | (none) | frontend/manual picks |
| `src/app/api/maker-radar/signal-tracker/verify/route.ts` | line 262 | UPDATE | verification fields (outcome_7d, etc.) | (none) | verification updates (cross-cutter) |
| `scripts/backfill_stale_radar_signals.py` | lines 179, 215, 233 | UPDATE | freshness fields | (none) | maintenance updates |
| `scripts/radar_accuracy_report.py` | line 315 | UPDATE | accuracy fields | (none) | reporting (read-mostly) |
| `scripts/verify_radar_signals.py` | line 178 | UPDATE | verification | (none) | verification updates |

### Confirmed violations

1. **DELETE in `maker_radar.py:752` is unscoped** — wipes all rows for `signal_date`, including rows owned by `state_history_tracker` and frontend. Confirmed by test `test_radar_delete_impact_phase2.py` (4/4 ✅).

2. **`INSERT OR REPLACE` in `state_history_tracker.py:138` without UNIQUE constraint** — actually inserts a new row each time (no replace). Confirmed in sandbox: 16 duplicate canonical_state rows on 2026-10-21.

3. **`state_history_tracker.py:163` does not respect env override** — uses `sqlite3.connect(DB_DIR / 'stocks.db')` directly, bypassing `db_manager` / `DBPaths.STOCKS_DB`. If VPS is configured with `STOCKS_DB=/var/lib/glm/stocks.db`, this writer writes to the wrong file.

4. **`news.db.market_news` multi-writer** — `news-agent/main.py` (Python) + `src/app/api/admin/news/route.ts` (Node.js) both INSERT/UPDATE/DELETE without coordination. No documented protocol.

5. **`daily_closer.py` UPDATEs `predictions` directly** — bypasses `PredictionTracker` (the sanctioned interface). Lines 886, 2352, 3079, 3167, 3205.

### Unresolved questions

- **`signal_type='distribution'` rows never written** — confirmed in worklog (audit E16): `maker_radar.py` overrides `winner_path='distribution'` and sets `under_microscope=False` BEFORE tracking, so distribution events are never recorded.
- **`stock_phase` table (1238 rows, frozen 2026-10-07)** — no writer in production (per worklog audit E13). Either drop or revive with a fresh writer.

---

## 5. price_history.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `price_history` | OHLCV historical (25 years) | `data_engine/sync.py` + `data_engine/scrapers/historical_fetcher.py` | direct INSERT | `load_merged_history()` (canonical reader per Rule 12), `state_history_tracker.py`, `daily_predictor.py` (read) | `(ticker, date)` should be UNIQUE — needs check | canonical | needs test |
| `screener_daily` | screener snapshot | `scripts/liquidity_backtest_engine.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |

---

## 6. data_engine.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `crypto_prices` | crypto prices | `data_engine/scrapers/crypto_fetcher.py` | direct INSERT | UI (read), analyzers (read) | `id AUTOINCREMENT` | canonical | needs test |
| `gold_prices` | gold prices (canonical) | `data_engine/scrapers/metals_forex_fetcher.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `exchange_rates` | forex rates | `data_engine/scrapers/metals_forex_fetcher.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `tab_*` (8 tables) | fundamentals | `scripts/update_fundamentals.py` | direct UPSERT | `daily_predictor.py` (read) | `ticker` (production) / `symbol` (sandbox legacy) | canonical | needs test (PK auto-detect via `detect_tab_pk_column`) |
| `historical_data` | historical (numeric ticker) | `data_engine/scrapers/historical_fetcher.py` | direct INSERT | analyzers (read) | `id AUTOINCREMENT` | legacy | needs review |
| `btc_local_prices` | BTC in Arab currencies | `data_engine/scrapers/crypto_fetcher.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `screener_lists` | screener lists | `data_engine/scrapers/tradingview_screener_lists.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `sharia_*` (4 tables) | sharia compliance | `data_engine/scrapers/sharia_compliance_scraper.py` | direct UPSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |

---

## 7. intraday.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `stock_intraday` | stock ticks | `data_engine/intraday_storage.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `crypto_intraday` | crypto ticks | `data_engine/intraday_storage.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `commodity_intraday` | commodity ticks | `data_engine/intraday_storage.py` | direct INSERT | UI (read) | `id AUTOINCREMENT` | canonical | needs test |
| `intraday_meta` | intraday metadata | `data_engine/intraday_storage.py` | direct UPSERT | maintenance (read) | `id AUTOINCREMENT` | canonical | needs test |

---

## 8. auth.db

| Table | Domain | Write owner | Authorized interface | Readers | Key semantics | Legacy | Validation |
|---|---|---|---|---|---|---|---|
| `User` | users | NextAuth (Node.js) via Prisma | Prisma `user.create()` / `user.update()` | UI (read) | `id` | canonical | needs test |
| `PromoCode`, `SubscriptionPlan`, etc. | subscriptions | UI admin (Node.js) via Prisma | Prisma | UI (read) | `id` | canonical | needs test |
| `account`, `session`, `verification_token` | NextAuth internal | NextAuth (Node.js) | Prisma adapter | (internal) | NextAuth-defined | canonical | needs test |

---

## 9. metrics.db + crypto.db + custom.db

| Table | Domain | Write owner | Authorized interface | Readers | Legacy | Validation |
|---|---|---|---|---|---|---|
| `metrics.db.*` | runtime metrics | `instrumentation.ts` (Node.js) | direct INSERT | internal | canonical | needs test |
| `crypto.db.*` | crypto (legacy) | (almost empty) | — | — | legacy | needs review |
| `custom.db.*` | runtime scratch (Rule: must not use) | — | — | — | forbidden (per Rule 44) | must remain empty |

---

## Summary of confirmed violations

| # | Violation | Severity | Affects | Remediation (deferred — needs owner approval) |
|---|---|---|---|---|
| V1 | `maker_radar.py:752` DELETE unscoped | HIGH | canonical_state + frontend picks wiped | Scope DELETE by ownership marker (needs `source` column or equivalent) |
| V2 | `state_history_tracker.py:138` INSERT OR REPLACE without UNIQUE | HIGH | creates duplicates | Add UNIQUE on (ticker, signal_date, signal_type) — needs migration + backup |
| V3 | `state_history_tracker.py:163` bypasses env override | MEDIUM | writes to wrong DB if VPS uses env paths | Switch to `DBPaths.STOCKS_DB` via `db_manager` |
| V4 | `news.db.market_news` multi-writer (Python + Node.js) | HIGH | data integrity, race conditions | Define single owner; the other becomes read-only or uses an API |
| V5 | `daily_closer.py` UPDATEs `predictions` directly (bypasses PredictionTracker) | MEDIUM | bypasses sanctioned interface | Route updates through `PredictionTracker.set_verified_outcome()` |
| V6 | `stock_phase` table orphaned (no writer in production) | LOW | dead data | Drop or revive with explicit owner |
| V7 | `distribution` events never recorded (audit E16) | MEDIUM | radar history incomplete | Reorder: track BEFORE override |

---

## What this registry does NOT prove

- It does not prove production schema matches sandbox schema (production may have extra columns from manual migrations).
- It does not prove the listed writers actually run on production (cron/scheduler config is on VPS, not in repo).
- It does not prove read paths are exhaustive (some readers may exist in untested code paths).
- It does not validate that the "authorized interface" is actually enforced (no architectural guard exists yet — see §6 Architecture Enforcement Plan).
