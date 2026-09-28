# Backend + Data Module Map — `دليل الاستثمار` (GLMinvestment)

> **Audit ID:** AUDIT-BE-DATA-GEMS
> **Date:** 2026-09-30
> **Agent:** Backend + Data Architect (READ-ONLY audit)
> **Mode:** READ-ONLY — no code was modified, no files were created (except this report).
> **Scope:** `vps-service/**` + `scripts/**` + `data_engine/**` + `news-agent/**` + `db/**` + `src/lib/db-*.ts` + `ecosystem.config.js` + `crontab.txt`
> **Goal:** Map the backend + data layer, find hidden gems, propose module boundaries + DB consolidation.

---

## 0. Executive Summary

The GLMinvestment backend is a **Python-first system** (per Constitution Rule 32) where Python is THE BRAIN (predictions, analyzers, scrapers, Telegram bot) and Next.js is DISPLAY ONLY. The current backend inventory:

| Layer | Files | LOC | Notes |
|---|---:|---:|---|
| `vps-service/` (Python) | 507 .py + 1 .ts | **297,803** | Main backend (FastAPI + Flask + jobs + analyzers + Telegram + AI) |
| `scripts/` (root, Python/TS/JS/SH) | 291 files | **81,256** | Operational scripts (migrations, backtests, audits, cron jobs) |
| `scripts/_archived/` | 97 files | — | Historical backtests + diagnostics (kept for reference) |
| `data_engine/` (Python) | 13 .py + 19 scrapers | **11,130** | Multi-market data scrapers + 24/7 scheduler |
| `news-agent/` (Python) | 30+ .py | **6,519** | Ollama-powered EGX news collector + analyzer |
| **Total audited LOC** | — | **~396,900** | |

### Top-level findings

1. **4 canonical SQLite DBs** (stocks, predictions, data_engine, auth) + 2 historical (`custom.db`, `price_history.db`) — `auth.db` and `data_engine.db` are 0 bytes on the sandbox (production VPS has the real data). The 4-DB target architecture (`market.db` + `predictions.db` + `auth.db` + `content.db`) is documented in `utils/db_paths.py` but **`market.db` and `content.db` are not yet populated in production** — `data_engine.db` and `stocks.db` remain the canonical sources.

2. **V40.2 pipeline is the canonical brain**: `v40_2_daily_generator.py` (3,054 LOC) → reads from `data_engine.db.egksco_price_history` + `stocks.db` + `price_history.db` → writes `predictions.db.predictions` + `predictions.db.stored_analyses`. Wired into cron at 03:00 UTC (morning) + 13:30 UTC (evening).

3. **148 analyzer files** (108,857 LOC) — **80 active** (used by API/Jobs/Engine/Telegram/AI), **68 orphan** (~41,500 LOC of orphan analyzers, including the empty `trade_level_validator.py`). Top orphan: `unified_analyzer.py` (3,736 LOC, 0 callers).

4. **416 Flask routes** across **38 blueprints** + **17 data_engine routes** + **670 Next.js route handlers** (mostly thin proxies or SQLite readers — only 136 of these use `better-sqlite3` directly).

5. **22 cron jobs** (entries #1–#18, some are sub-entries) — the schedule is comprehensive: V40.2 generator + intraday scanner + daily_closer + learning_engine + market_regime_engine + radar signal tracker + weekly radar report + multi-market scrapers + US stock scraper + heartbeat + backup + fundamentals + disclosures.

6. **5 hidden gems** worth wiring:
   - `scripts/mine_learned_lessons.py` (691 LOC) — mines `learned_lessons` from `aiPrediction` table; not in cron but should run weekly.
   - `scripts/exit_policy_optimizer.py` (597 LOC) — proven optimizer for exit policies; not in cron.
   - `scripts/post_market_feedback.py` (372 LOC) — sends Telegram alerts when ≥80% of BUY signals hit SL; not in cron.
   - `vps-service/jobs/hot_candidate_detector.py` (299 LOC) — intraday maker activity detector; not in cron.
   - `vps-service/analyzers/educational_cards_engine.py` (1,560 LOC) — generates PNG + MP4 educational content via Playwright/FFmpeg; orphan.

7. **6 dead-on-arrival analyzers** (zero callers anywhere in repo): `crypto_mr_signal`, `crypto_prediction_engine`, `crypto_risk`, `live_autonomous_monitor`, `macro_veto`, `mean_reversion_signal`, `prediction_sanity`, `trade_level_validator` (empty), `unified_exit_engine`.

8. **3 stale telegram publishers**: `telegram_marketing_engine.py` (225 LOC, the comprehensive publisher that orchestrates 6 features: interactive bot + morning bell + intraday alerts + closing scorecard + breaking news + daily lessons) is itself an orphan (0 callers, not in PM2 or cron). It would replace several smaller publishers if wired.

9. **Major duplicate analyzers**:
   - `analyzers/market_regime_engine.py` (62 KB, canonical) vs `engines/market_regime.py` (20 KB, only 5 callers). Both classes called `MarketRegimeEngine` — high confusion risk.
   - `analyzers/confluence_engine.py` (459 LOC) + `analyzers/confluence_engine_v3.py` (1,211 LOC) + `analyzers/crypto_confluence_engine.py` (727 LOC) + `engines/smart_confluence_engine.py` (742 LOC) — 4 separate confluence implementations.
   - `analyzers/fundamental.py` + `fundamental_engine.py` + `fundamental_enhanced.py` + `fundamental_scorer.py` + `fundamental_quality_gate.py` + `fundamental_data_provider.py` + `fundamental_relative.py` — 7 fundamental modules.
   - `analyzers/technical.py` + `technical_analyzer.py` + `technical_weighted.py` + `technical_target_engine.py` — 4 technical modules.

10. **3 data_engine servers** (`main.py` 1158 LOC, `engine_server.py` 93 LOC, `simple_server.py` 92 LOC) — only `main.py` is referenced by PM2 (via `ecosystem.config.js`). The other two are stale alternates.

---

## Table of Contents

1. [Backend Structure (As-Is)](#1-backend-structure-as-is)
2. [Analyzers Inventory](#2-analyzers-inventory)
3. [API Routes Inventory](#3-api-routes-inventory)
4. [Jobs + Cron Inventory](#4-jobs--cron-inventory)
5. [Scrapers Inventory](#5-scrapers-inventory)
6. [Database Inventory](#6-database-inventory)
7. [Data Flow Maps](#7-data-flow-maps)
8. [Hidden Gems](#8-hidden-gems)
9. [Module Architecture Proposal (Backend)](#9-module-architecture-proposal-backend)
10. [Data Layer Consolidation Proposal](#10-data-layer-consolidation-proposal)

---

## 1. Backend Structure (As-Is)

### 1.1 Top-level tree

```
/home/z/my-project/
├── vps-service/                # ✅ Python backend (THE BRAIN) — PM2 service "python-backend" on :8010
│   ├── main.py                 # FastAPI entry (366 LOC) — mounts Flask lightweight_server via a2wsgi
│   ├── lightweight_server.py   # Flask app (1,899 LOC) — registers 40 blueprints
│   ├── analysis_engine_v2.py   # Legacy analyzer wrapper (983 LOC, 2 callers)
│   ├── config.py               # 267 LOC — paths + constants
│   ├── lightweight_server.py   # Flask app (1,899 LOC) — registers 40 blueprints
│   ├── analyzers/              # 148 files / 108,857 LOC — analysis engines (technical, fundamental, regime, etc.)
│   ├── api/                    # 38 files / 40,640 LOC — Flask blueprints (416 routes total)
│   ├── jobs/                   # 17 files / 15,323 LOC — scheduled jobs (V40.2, daily_closer, learning_engine, etc.)
│   ├── data/                   # 16 files / 8,676 LOC — EGX fetchers + fundamentals + analyses
│   ├── utils/                  # 15 files / 5,957 LOC — DB paths, helpers, calendar, gates
│   ├── engines/                # 6 files / 4,372 LOC — v38_backtest, market_regime, smart_confluence, etc.
│   ├── engine/                 # 10 files / 7,235 LOC — flow_system, persona_engine, explosive_scanner, etc.
│   ├── telegram/               # 26 files / 13,182 LOC — auto_poster + 25 publisher modules
│   ├── tools/                  # 8 files / 3,004 LOC — admin CLI tools (evaluate_predictions, restore_dbs, etc.)
│   ├── ai/                     # 17 files / 6,981 LOC — AI agent, news analyzer, decision engine
│   ├── core/                   # 18 files / 11,705 LOC — database, migrator, scheduler_manager, egypt_scheduler
│   ├── portfolio/              # 9 files / 5,470 LOC — position manager, stop manager, smart_exit, multi_target_exit
│   ├── strategies_merge/       # 7 files / 557 LOC — chase/correction/merged strategies (only used by archived backtests)
│   ├── glminvestment_engines/  # 20 files / 3,763 LOC — VCP detector + Donchian + Stage2 + ATR risk (used by maestro)
│   ├── scripts/                # 104 files / 42,714 LOC — internal admin scripts (backfill, init, etc.)
│   ├── tests/                  # 22 files / 8,116 LOC — pytest tests (13 top-level + 8 unit)
│   ├── ws-service/             # 1 file / 621 LOC — Bun/TypeScript socket.io server on :3005
│   ├── core/                   # 18 files / 11,705 LOC — shared infra
│   ├── live_signals/           # 3 files (recorder.py + 2 JSON) — orphan (0 callers)
│   ├── paper_trading/          # 3 JSON state files — orphan (only used by scripts/paper_trading.py)
│   ├── scrappers/              # 1 file (egx_investors_scraper.py) — duplicate of data_engine/scrapers/
│   ├── Dockerfile + docker-compose.yml + deploy.sh + requirements.txt + README.md
│   └── ...several standalone root .py files (cleanup_corrupted_symbols, scanner_cron, etc.)
├── data_engine/                # ✅ Data Engine (Python) — PM2 service "data-engine" on :5000
│   ├── main.py                 # Flask app (1,158 LOC) — 17 routes
│   ├── sync.py                 # Real-time sync (774 LOC) — pushes to ws-service :3005/broadcast
│   ├── intraday_storage.py     # 1,122 LOC — stock/crypto/commodity intraday → intraday.db
│   ├── realtime_sync.py        # 175 LOC — incremental sync
│   ├── engine_server.py        # 93 LOC — orphan alternate server
│   ├── simple_server.py        # 92 LOC — orphan alternate server
│   └── scrapers/               # 20 files / 7,222 LOC — TV/Yahoo/crypto/metals/news scrapers
├── news-agent/                 # ✅ News Agent (Python) — PM2 service "news-agent"
│   ├── main.py                 # Async agent runner
│   ├── collectors/             # 8 .py files + 8 scrappers/ — Telegram + Web + RSS + Egyptian sources
│   ├── analyzer/               # 3 .py files — news_analyzer + recommendation_aggregator + vision_analyzer
│   ├── sender/                 # production_sender.py — POSTs to /api/news on Next.js backend
│   ├── data/                   # news_store.py + JSON caches
│   └── ui/dashboard.py         # Streamlit UI (orphan)
├── telegram-events/            # ✅ Bun/TypeScript socket.io relay — PM2 service on :3003
│   └── index.ts + package.json + bun.lock
├── scripts/                    # ✅ Operational scripts (root) — 291 files / 81,256 LOC
│   ├── _archived/              # 97 historical files (backtests + audit JSONs)
│   ├── output/                 # 49 output files (radar JSON + cleanup logs + SQL dumps)
│   ├── maker_radar.py          # 701 LOC — Maker Radar generator (warmup target)
│   ├── exit_radar.py           # 657 LOC — Exit Radar generator
│   ├── weekly_radar_report.py   # 1,289 LOC — Weekly Report PDF/PNG/JSON generator (in cron)
│   ├── mine_learned_lessons.py # 691 LOC — HIDDEN GEM (not in cron)
│   ├── exit_policy_optimizer.py # 597 LOC — HIDDEN GEM (not in cron)
│   ├── ...285 more scripts (mostly one-off migrations + audits)
├── db/                         # ✅ 4 canonical SQLite DBs + 2 historical + 16 JSON state files
│   ├── stocks.db               # 80 KB (sandbox) / canonical source on production
│   ├── predictions.db          # 44 KB (sandbox) / V40.2 + learning writes here
│   ├── data_engine.db         # 0 bytes (sandbox) / scrapers write here
│   ├── auth.db                 # 0 bytes (sandbox) / Prisma users
│   ├── price_history.db       # 264 KB (sandbox) / 25-year price history (1.24M rows on prod)
│   ├── custom.db               # 24 KB / Prisma tutorial default — should be deleted (deprecated)
│   ├── *.db-shm + *.db-wal    # WAL files
│   ├── schemas/                # 2 .sql files (legacy schema docs)
│   ├── *.json                  # 16 state files (radar_cache_status, maker_radar_tracking, etc.)
│   └── screener_cards/         # Pre-generated card images
├── ecosystem.config.js         # PM2 config — 7 services
├── crontab.txt                 # 18 cron entries (Sun-Thu trading days)
├── src/                        # Next.js 16 frontend (separate audit)
└── prisma/                     # 3 Prisma schemas (schema.prisma + auth-schema.prisma + predictions-schema.prisma)
```

### 1.2 PM2 services (from `ecosystem.config.js`)

| # | Name | Script | Port | Purpose |
|---|---|---|---:|---|
| 1 | `python-backend` | `vps-service/main.py` | 8010 | The Brain — Flask + FastAPI mounted via a2wsgi |
| 2 | `data-engine` | `data_engine/main.py` | 5000 | Data scrapers + sync |
| 3 | `nextjs` | `next start -p 3000` | 3000 | Display-only frontend |
| 4 | `ws-service` | `vps-service/ws-service/index.ts` (Bun) | 3005 | Real-time socket.io push |
| 5 | `telegram-poster` | `vps-service/telegram/auto_post_scheduler.py` | — | Continuous Telegram auto-posting |
| 6 | `telegram-events` | `telegram-events/index.ts` (Bun) | 3003 | Socket.io relay for live Telegram events |
| 7 | `news-agent` | `news-agent/main.py` | — | Ollama-powered news collector (P0 #7 fix 2026-09-27) |

Plus `ollama` (systemd on :11434, providing `qwen2.5:1.5b` + `glm-fast` models for RAG).

### 1.3 Directory LOC summary (Python files only)

| Directory | Files | LOC | Avg LOC/file |
|---|---:|---:|---:|
| `vps-service/analyzers/` | 148 | 108,857 | 736 |
| `vps-service/scripts/` | 104 | 42,714 | 411 |
| `vps-service/api/` | 38 | 40,640 | 1,069 |
| `vps-service/jobs/` | 17 | 15,323 | 901 |
| `vps-service/telegram/` | 26 | 13,182 | 507 |
| `vps-service/core/` | 18 | 11,705 | 650 |
| `vps-service/engine/` | 10 | 7,235 | 724 |
| `vps-service/ai/` | 17 | 6,981 | 411 |
| `vps-service/portfolio/` | 9 | 5,470 | 608 |
| `vps-service/utils/` | 15 | 5,957 | 397 |
| `vps-service/engines/` | 6 | 4,372 | 729 |
| `vps-service/glminvestment_engines/` | 20 | 3,763 | 188 |
| `vps-service/tools/` | 8 | 3,004 | 375 |
| `vps-service/tests/` | 22 | 8,116 | 369 |
| `vps-service/strategies_merge/` | 7 | 557 | 80 |
| `vps-service/data/` | 16 | 8,676 | 542 |
| `vps-service/` (root .py) | 17 | ~5,500 | ~325 |
| `vps-service/ws-service/` (TS) | 1 | 621 | 621 |
| `scripts/` (root) | 291 | 81,256 | 279 |
| `data_engine/` | 13 | 3,548 | 273 |
| `data_engine/scrapers/` | 20 | 7,582 | 379 |
| `news-agent/` | 30 | 6,519 | 217 |
| **TOTAL** | **824** | **~397,000** | — |

### 1.4 Key entry points

- **`vps-service/main.py`** (366 LOC): FastAPI app on :8010. Mounts `ai.portfolio_routes.portfolio_router` + `ai.api_routes.ai_router` + mounts Flask `lightweight_server` via `a2wsgi.WSGIMiddleware` at `/`. Starts `MarketScheduler.tick` + `EgyptScheduler.tick_once` + `wal_checkpoint` (hourly) + `crypto_lab_scheduler` (15-min) via the central `core.scheduler_manager`. Auto-runs `core.migrator.run_migrations()` at boot.
- **`vps-service/lightweight_server.py`** (1,899 LOC): Flask app registering **40 blueprints** (one was removed in P0 #5 fix). Catches ImportError per blueprint so a missing module doesn't kill the whole server.
- **`data_engine/main.py`** (1,158 LOC): Flask app on :5000 with 17 routes (`/trigger/stocks`, `/trigger/crypto`, `/trigger/metals`, `/control/start`, etc.). Monkey-patches `sqlite3.connect` globally to enforce `journal_mode=WAL` + 30s timeout + 30s busy_timeout + `foreign_keys=ON`.
- **`news-agent/main.py`**: Async agent that collects from Telegram + Web + RSS, analyzes via local Ollama (`qwen2.5-coder:7b`), POSTs to `/api/news/receive-from-news-agent` on Next.js. PM2 service added in P0 #7 fix (2026-09-27).
- **`ecosystem.config.js`**: PM2 config for all 7 services.
- **`crontab.txt`**: 18-cron schedule (install with `crontab crontab.txt`).
- **`src/app/api/proxy/[...path]/route.ts` + `src/app/api/python/[...path]/route.ts`**: Next.js reverse proxy to Python `:8010` (admin paths require `requireAdminAsync`).

---

## 2. Analyzers Inventory

### 2.1 Status definitions

- **ACTIVE** — imported by ≥1 of: API, jobs, main.py, lightweight_server, engine/, engines/, telegram/, ai/ (or referenced in `crontab.txt`).
- **ORPHAN** — exists but no importers found in the union of those directories.
- **DEAD** — empty file (0 LOC) or contains only a docstring + `pass`.

### 2.2 Active analyzers (80 files, 67,245 LOC)

| File | LOC | Purpose | Called By |
|---|---:|---|---|
| `master_analyzer.py` | 5,026 | Master analyzer orchestrator — V20 fusion + dip buying | `market_scheduler.py`, `chart_routes.py`, `misc_routes.py`, `stock_analysis_routes.py`, `professional_analysis_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `admin_routes.py`, `prediction_tracking_routes.py`, `top_performers_routes.py`, `public_routes.py`, `confluence_routes.py`, `stored_analysis_routes.py`, `unified_learning_routes.py`, `risk_routes.py`, `engine/master_backfill_adapter.py`, `engine/historical_backfill_engine.py`, `engine/persona_engine.py`, `engine/historical_prediction_generator.py`, `portfolio/position_manager.py`, `engines/smart_confluence_engine.py` |
| `maestro_orchestrator.py` | 4,366 | Maestro orchestration (Phase 5 retired in favor of V40.2, but still referenced) | `v40_2_daily_generator.py`, `chart_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `stored_analysis_routes.py`, `historical_predictions_v2_routes.py`, `prediction_tracking_routes.py`, `maestro_routes.py`, `reports_routes.py`, `prediction_optimizer.py`, `engine/master_backfill_adapter.py`, `engine/historical_backfill_engine.py`, `ai/portfolio_routes.py`, `engines/smart_confluence_engine.py`, `engines/master_backfill_adapter.py` |
| `unified_analyzer.py` ⚠️ | 3,736 | Unified Financial Analysis Engine (Phase 3) | **ORPHAN — listed in active set by my grep, but actually 0 callers** (see §8 Hidden Gems) |
| `background_analyzer.py` | 2,725 | Background analysis (news + fundamentals + technical) | `market_scheduler.py`, `nightly_quant_job.py`, `chart_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `risk_routes.py`, `prediction_tracking_routes.py` |
| `core_scoring_engine.py` | 2,548 | Core scoring (volume surge rocket + accumulation + recovery) | `v40_2_daily_generator.py`, `chart_routes.py`, `professional_analysis_routes.py`, `prediction_tracking_routes.py`, `misc_routes.py`, `unified_v2_routes.py`, `engine/master_backfill_adapter.py`, `engines/smart_confluence_engine.py`, `portfolio/position_manager.py` |
| `sniper_engine.py` | 2,049 | Sniper opportunity scanner | `market_scheduler.py`, `sniper_routes.py`, `misc_routes.py`, `v2_routes.py` |
| `persona_screener.py` | 1,910 | Persona screener (gambler + conservative + balanced) | `persona_routes.py`, `chart_routes.py`, `public_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `portfolio/position_manager.py` |
| `dynamic_target_engine.py` | 1,823 | Dynamic target calculator (ATR + volatility-based) | `chart_routes.py`, `prediction_tracking_routes.py`, `engine/master_backfill_adapter.py` |
| `reports_engine.py` | 1,764 | Daily/weekly/monthly reports engine | `auto_post_scheduler.py`, `auto_poster.py`, `telegram_routes.py`, `reports_routes.py`, `api/admin_routes.py`, `v2_routes.py`, `unified_v2_routes.py` |
| `educational_cards_engine.py` ⚠️ | 1,560 | Generates PNG + MP4 educational content via Playwright/FFmpeg | **ORPHAN — 0 callers** (see §8) |
| `prediction_optimizer.py` | 1,509 | Optimizes prediction params (target/stop/confidence) | `optimizer_params_routes.py`, `v40_2_daily_generator.py`, `prediction_tracking_routes.py`, `engine/master_backfill_adapter.py`, `misc_routes.py`, `ai/portfolio_routes.py`, `learning_routes.py` |
| `engine_settings.py` | 1,450 | Dynamic engine settings (per-market thresholds) | 27 callers (almost every job + analyzer + API) — most-imported analyzer |
| `crypto_event_tracker.py` | 1,447 | Tracks crypto events (forks, burns, listings) | **ORPHAN — 0 callers in active set** (verified separately) |
| `unified_learning_engine.py` | 1,371 | Unified learning engine (lessons + patterns + indicators) | `unified_learning_routes.py`, `learning_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `ai/continuous_learning.py` |
| `institutional_decision_engine.py` | 1,365 | Institutional decision (V38) | `v38_backtest_routes.py`, `admin_routes.py`, `engine/master_backfill_adapter.py`, `engines/smart_confluence_engine.py`, `prediction_tracking_routes.py`, `risk_routes.py`, `v2_routes.py` |
| `market_regime_engine.py` | 1,340 (62 KB) | Market regime detector (DEFENSIVE/NORMAL/AGGRESSIVE) | `v40_2_daily_generator.py`, `maker_radar.py`, `auto_post_scheduler.py`, `chart_routes.py`, `admin_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `prediction_optimizer.py` |
| `crypto_quality_gate.py` | 1,229 | Quality gate for crypto predictions | **ORPHAN — 0 callers in active set** (verified separately) |
| `hunting_engine.py` | 1,226 | Hunting engine (smart-money detection) | `chart_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `misc_routes.py`, `engine/explosive_scanner.py`, `portfolio/position_manager.py`, `engine/master_backfill_adapter.py` |
| `confluence_engine_v3.py` | 1,211 | Confluence engine v3 | `confluence_routes.py`, `prediction_tracking_routes.py` |
| `stock_dna_analyzer.py` | 1,157 | Stock DNA (behavioral fingerprint) | `chart_routes.py`, `prediction_tracking_routes.py`, `admin_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `misc_routes.py` |
| `persona_investor.py` | 1,157 | Persona investor (long-term holder) | `persona_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `portfolio/position_manager.py`, `engine/persona_engine.py`, `portfolio/strategies.py` |
| `backtest_engine.py` | 1,145 | Backtest engine | `chart_routes.py`, `prediction_tracking_routes.py`, `admin_routes.py`, `v2_routes.py` |
| `crypto_analyzer.py` | 1,139 | Crypto analyzer | **ORPHAN — 0 callers in active set** (verified separately) |
| `live_indicator_engine.py` | 1,125 | Live indicator engine (real-time RSI/MACD/VWAP) | `market_scheduler.py`, `chart_routes.py`, `misc_routes.py`, `prediction_tracking_routes.py`, `engine/live_prediction_engine.py` |
| `liquidity_filter.py` | 1,101 | Liquidity filter (kill_switch + turnover) | `v40_2_daily_generator.py`, `maker_radar.py`, `exit_radar.py`, `chart_routes.py`, `prediction_tracking_routes.py`, `misc_routes.py`, `risk_routes.py`, `v2_routes.py`, `engine/master_backfill_adapter.py` |
| `stock_notebook.py` | 1,065 | Stock notebook (per-ticker context) | `v40_2_daily_generator.py`, `daily_closer.py`, `prediction_tracking_routes.py`, `admin_routes.py`, `misc_routes.py`, `chart_routes.py` |
| `expert_quality_gate.py` | 1,036 | Expert quality gate (veto on BUY signals) | `chart_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `engine/master_backfill_adapter.py`, `engines/smart_confluence_engine.py` |
| `enhanced_prediction_tracker.py` | 1,021 | Enhanced prediction tracker | `prediction_tracking_routes.py`, `engine/master_backfill_adapter.py` |
| `expert_memory_v4.py` ⚠️ | 1,013 | Expert memory V4 (personal trading memory) | **ORPHAN — 0 callers in active set** (see §8) |
| `news_fetcher_analyzer.py` | 979 | News analyzer with impact scoring | `v40_2_daily_generator.py`, `prediction_tracking_routes.py`, `news_routes.py`, `chart_routes.py` |
| `support_resistance_calculator.py` | 938 | Support/resistance calculator | 10 callers — `chart_routes.py`, `prediction_tracking_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `risk_routes.py`, `engine/master_backfill_adapter.py`, `engine/live_prediction_engine.py`, `engine/historical_backfill_engine.py`, `engines/smart_confluence_engine.py`, `engine/explosive_scanner.py` |
| `fundamental_quality_gate.py` ⚠️ | 910 | Fundamental quality gate | **ORPHAN — 0 callers in active set** |
| `social_card_generator.py` ⚠️ | 902 | Social card generator (HTML→PNG via Playwright) | **ORPHAN — 0 callers in active set** |
| `market_daily_report.py` | 899 | Market daily report generator | `auto_post_scheduler.py`, `auto_poster.py` |
| `seasonality_engine_v2.py` ⚠️ | 891 | Seasonality engine v2 | **ORPHAN — 0 callers in active set** |
| `technical_target_engine.py` ⚠️ | 874 | Technical target engine | **ORPHAN — 0 callers in active set** |
| `dynamic_analysis_engine.py` ⚠️ | 849 | Dynamic analysis engine | **ORPHAN — 0 callers in active set** |
| `devil_quality_gate.py` ⚠️ | 819 | Devil's advocate quality gate | **ORPHAN — 0 callers in active set** |
| `ai_pattern_analyzer.py` ⚠️ | 780 | AI pattern analyzer (candlestick + chart + ML) | **ORPHAN — 0 callers in active set** |
| `v82_analyzer.py` ⚠️ | 741 | V82 analyzer (multi-path) | **ORPHAN — 0 callers in active set** |
| `event_impact_tracker.py` ⚠️ | 735 | Event impact tracker | **ORPHAN — 0 callers in active set** |
| `crypto_confluence_engine.py` ⚠️ | 727 | Crypto confluence engine | **ORPHAN — 0 callers in active set** |
| `risk_adaptive.py` ⚠️ | 691 | Risk adaptive engine | **ORPHAN — 0 callers in active set** |
| `risk_manager.py` ⚠️ | 690 | Risk manager | **ORPHAN — 0 callers in active set** |
| `sniper_filter.py` ⚠️ | 672 | Sniper filter | **ORPHAN — 0 callers in active set** |
| `fundamental_enhanced.py` ⚠️ | 646 | Fundamental enhanced | **ORPHAN — 0 callers in active set** |
| `expert_memory.py` ⚠️ | 637 | Expert memory (legacy V3) | **ORPHAN — 0 callers in active set** |
| `news_impact_scorer.py` ⚠️ | 618 | News impact scorer | **ORPHAN — 0 callers in active set** |
| `unified_maestro.py` ⚠️ | 592 | Unified maestro (legacy) | **ORPHAN — 0 callers in active set** |
| `dynamic_risk_engine.py` ⚠️ | 592 | Dynamic risk engine | **ORPHAN — 0 callers in active set** |
| `production_data_client.py` ⚠️ | 583 | Production data client | **ORPHAN — 0 callers in active set** |
| `sentiment_analyzer.py` ⚠️ | 577 | Sentiment analyzer | **ORPHAN — 0 callers in active set** |
| `fundamental_scorer.py` ⚠️ | 567 | Fundamental scorer | **ORPHAN — 0 callers in active set** |
| `crypto_prediction_engine.py` ⚠️ | 567 | Crypto prediction engine | **ORPHAN — 0 callers anywhere** |
| `live_autonomous_monitor.py` ⚠️ | 550 | Live autonomous monitor | **ORPHAN — 0 callers anywhere** |
| `technical_weighted.py` ⚠️ | 527 | Technical weighted | **ORPHAN — 0 callers in active set** |
| `unified_exit_engine.py` ⚠️ | 518 | Unified exit engine | **ORPHAN — 0 callers anywhere** |
| `enhanced_indicators.py` ⚠️ | 515 | Enhanced indicators | **ORPHAN — 0 callers in active set** |
| `crypto_risk.py` ⚠️ | 515 | Crypto risk | **ORPHAN — 0 callers anywhere** |
| `scoring_fix.py` ⚠️ | 507 | Scoring fix | **ORPHAN — 0 callers in active set** |
| `quant_cache.py` ⚠️ | 501 | Quant cache | **ORPHAN — 0 callers in active set** |
| `candlestick.py` ⚠️ | 492 | Candlestick patterns | **ORPHAN — 0 callers in active set** |
| `market_manager.py` ⚠️ | 489 | Market manager (OOP inheritance) | **ORPHAN — 0 callers in active set** |
| `correlation_filter.py` ⚠️ | 484 | Correlation filter | **ORPHAN — 0 callers in active set** |
| `sector_relative.py` ⚠️ | 460 | Sector relative | **ORPHAN — 0 callers in active set** |
| `confluence_engine.py` ⚠️ | 459 | Confluence engine (v1, legacy) | **ORPHAN — 0 callers in active set** |
| `dynamic_context_engine.py` ⚠️ | 455 | Dynamic context engine | **ORPHAN — 0 callers in active set** |
| `crypto_maestro.py` ⚠️ | 452 | Crypto maestro | **ORPHAN — 0 callers in active set** |
| `prediction_validator.py` ⚠️ | 448 | Prediction validator | **ORPHAN — 0 callers in active set** |
| `seasonality_scorer.py` ⚠️ | 438 | Seasonality scorer | **ORPHAN — 0 callers in active set** |
| `trend_following_analyzer.py` ⚠️ | 437 | Trend following analyzer | **ORPHAN — 0 callers in active set** |
| `conviction_engine.py` ⚠️ | 433 | Conviction engine ("is NOW the right time?") | **ORPHAN — 0 callers in active set** |
| `crypto_mr_signal.py` ⚠️ | 432 | Crypto mean-reversion signal | **ORPHAN — 0 callers anywhere** |
| `crypto_short_holding_exit.py` ⚠️ | 412 | Crypto short-holding exit | **ORPHAN — 0 callers in active set** |
| `trend_following_paper_trading.py` ⚠️ | 406 | Trend following paper trading | **ORPHAN — 0 callers in active set** |
| `quant_overdrive.py` ⚠️ | 381 | Quant overdrive (SMFI + Monte Carlo + Blood Filter) | **ORPHAN — 0 callers in active set** |
| `mean_reversion_signal.py` ⚠️ | 378 | Mean reversion signal | **ORPHAN — 0 callers anywhere** |
| `fundamental_engine.py` ⚠️ | 372 | Fundamental engine | **ORPHAN — 0 callers in active set** |
| `technical_analyzer.py` ⚠️ | 371 | Technical analyzer (CLI wrapper) | **ORPHAN — 0 callers in active set** |
| `fundamental_relative.py` ⚠️ | 362 | Fundamental relative | **ORPHAN — 0 callers in active set** |
| `day_trading_scanner.py` ⚠️ | 361 | Day trading scanner | **ORPHAN — 0 callers in active set** |
| `v4_predictive_detector.py` ⚠️ | 346 | V4 predictive detector | **ORPHAN — 0 callers in active set** |
| `dividend_checker.py` ⚠️ | 340 | Dividend checker | **ORPHAN — 0 callers in active set** |
| `volume_profile.py` ⚠️ | 337 | Volume profile | **ORPHAN — 0 callers in active set** |
| `session_timing.py` ⚠️ | 327 | Session timing | **ORPHAN — 0 callers in active set** |
| `market_regime_detector.py` ⚠️ | 322 | Market regime detector (legacy, replaced by `market_regime_engine`) | **ORPHAN — 0 callers in active set** |
| `explosive_uncap_engine.py` ⚠️ | 272 | Explosive uncap engine | **ORPHAN — 0 callers in active set** |
| `crypto_regime.py` ⚠️ | 268 | Crypto regime | **ORPHAN — 0 callers in active set** |
| `ai_sentiment.py` ⚠️ | 261 | AI sentiment | **ORPHAN — 0 callers in active set** |
| `crypto_circuit.py` ⚠️ | 260 | Crypto circuit | **ORPHAN — 0 callers in active set** |
| `base_engine.py` ⚠️ | 199 | Base engine class | **ORPHAN — 0 callers in active set** |
| `prediction_sanity.py` ⚠️ | 181 | Prediction sanity gate (hard limits) | **ORPHAN — 0 callers anywhere** |
| `macro_veto.py` ⚠️ | 180 | Macro veto (USD + interest rate) | **ORPHAN — 0 callers anywhere** |
| `egx_arabic_lookup.py` ⚠️ | 159 | EGX Arabic lookup (duplicate of `telegram/egx_arabic_lookup.py` + `data/egx_arabic_lookup.py`) | **ORPHAN — 0 callers in active set** |
| `indicator_trust_scores.py` ⚠️ | 147 | Indicator trust scores | **ORPHAN — 0 callers in active set** |
| `trade_level_validator.py` ⚠️ | 0 | Empty file | **DEAD — should be deleted** |

### 2.3 Active analyzers — top 30 by call count (verified)

| File | LOC | Called By (count) |
|---|---:|---:|
| `engine_settings.py` | 1,450 | 27 |
| `master_analyzer.py` | 5,026 | 24 |
| `maestro_orchestrator.py` | 4,366 | 15 |
| `fundamental.py` | — | 12 |
| `support_resistance_calculator.py` | 938 | 10 |
| `core_scoring_engine.py` | 2,548 | 10 |
| `prediction_tracker.py` | 1,131 | 9 |
| `liquidity_filter.py` | 1,101 | 9 |
| `technical.py` | 569 | 7 |
| `regime_detector.py` | — | 7 |
| `prediction_optimizer.py` | 1,509 | 7 |
| `persona_investor.py` | 1,157 | 7 |
| `persona_gambler.py` | 803 | 7 |
| `institutional_decision_engine.py` | 1,365 | 7 |
| `background_analyzer.py` | 2,725 | 7 |
| `stock_dna_analyzer.py` | 1,157 | 6 |
| `smc_engine.py` | 452 | 6 |
| `risk.py` | — | 6 |
| `fundamental_data_provider.py` | 768 | 6 |
| `adaptive_weights.py` | 789 | 6 |
| `v68_oracle.py` | 737 | 5 |
| `stock_notebook.py` | 1,065 | 5 |
| `regime_filter.py` | 527 | 5 |
| `fusion_engine.py` | 724 | 5 |
| `expert_memory_bridge.py` | 556 | 5 |
| `multi_timeframe_engine.py` | — | 4 |
| `live_indicator_engine.py` | 1,125 | 4 |
| `narrative_generator.py` | — | 4 |
| `strict_entry_filters.py` | 834 | 4 |
| `position_sizing.py` | — | 4 |
| `news_stop_filter.py` | — | 4 |

### 2.4 V40.2 pipeline analyzers (the canonical brain)

`v40_2_daily_generator.py` imports 25 analyzers dynamically:

```
adaptive_weights
core_scoring_engine
crypto_disclosure_engine
crypto_news_fetcher
crypto_strict_filters
decision_logger
egx_disclosure_engine
engine_settings
feedback_loop
intraday_reader
liquidity_filter
live_news_integration
maestro_orchestrator
market_regime_engine
news_fetcher_analyzer
position_sizing
prediction_tracker
regime_filter
screener_integration
stock_notebook
strict_entry_filters
v68_oracle
v72_multi_path
v73_sniper
v76_golden_hunter
```

### 2.5 Analyzers summary stats

| Metric | Value |
|---|---:|
| Total analyzer files | **147** (+ 1 `__init__.py` = 148) |
| Total analyzer LOC | **108,857** |
| Active analyzers (in API/Jobs/Engine/TG/AI) | **80** |
| Active analyzer LOC | **67,245** |
| Orphan analyzers | **68** |
| Orphan analyzer LOC | **41,538** (38% of analyzers LOC!) |
| Dead (empty) analyzers | **1** (`trade_level_validator.py` — 0 LOC) |
| Analyzers with 0 callers anywhere in repo | **9** (the truly dead) |
| Largest analyzer | `master_analyzer.py` (5,026 LOC) |
| Largest orphan | `unified_analyzer.py` (3,736 LOC) |
| Most-imported analyzer | `engine_settings.py` (27 callers) |

### 2.6 Duplicate analyzer families

| Family | Files | Total LOC | Active? | Recommendation |
|---|---|---:|---|---|
| **Market regime** | `analyzers/market_regime_engine.py` (1,340) + `analyzers/market_regime_detector.py` (322) + `engines/market_regime.py` (556) | 2,218 | Mixed: market_regime_engine = ACTIVE (8 callers); market_regime (engines) = ACTIVE (5 callers); market_regime_detector = ORPHAN | Consolidate to ONE `market_regime_engine.py` |
| **Confluence** | `analyzers/confluence_engine.py` (459) + `analyzers/confluence_engine_v3.py` (1,211) + `analyzers/crypto_confluence_engine.py` (727) + `engines/smart_confluence_engine.py` (742) | 3,139 | Mixed: confluence_engine_v3 = ACTIVE; smart_confluence_engine = ACTIVE; confluence_engine (v1) + crypto_confluence_engine = ORPHAN | Delete v1 + crypto variant; keep v3 + smart_confluence |
| **Fundamental** | `fundamental.py` + `fundamental_engine.py` (372) + `fundamental_enhanced.py` (646) + `fundamental_scorer.py` (567) + `fundamental_quality_gate.py` (910) + `fundamental_data_provider.py` (768) + `fundamental_relative.py` (362) | 3,627+ | Mixed: fundamental + fundamental_data_provider = ACTIVE; rest = ORPHAN | Keep `fundamental.py` + `fundamental_data_provider.py`; archive the rest |
| **Technical** | `technical.py` (569) + `technical_analyzer.py` (371) + `technical_weighted.py` (527) + `technical_target_engine.py` (874) | 2,341 | Mixed: `technical.py` = ACTIVE (7 callers); others = ORPHAN | Keep `technical.py`; archive others |
| **Persona** | `persona_screener.py` (1,910) + `persona_investor.py` (1,157) + `persona_gambler.py` (803) | 3,870 | All ACTIVE | Consolidate into single `persona_engine.py` (already exists in `engine/persona_engine.py` — 972 LOC, 1 caller) |
| **Risk** | `risk.py` + `risk_manager.py` (690) + `risk_adaptive.py` (691) + `dynamic_risk_engine.py` (592) + `crypto_risk.py` (515) | 3,488 | `risk.py` = ACTIVE; rest = ORPHAN | Keep `risk.py`; archive others |
| **Sniper** | `sniper_engine.py` (2,049) + `sniper_filter.py` (672) + `v73_sniper.py` (432) + `v76_golden_hunter.py` (?) | 3,153+ | sniper_engine + v73_sniper + v76_golden_hunter = ACTIVE; sniper_filter = ORPHAN | Keep sniper_engine + v73 + v76; archive sniper_filter |
| **Exit** | `short_holding_exit.py` (614) + `unified_exit_engine.py` (518) + `crypto_short_holding_exit.py` (412) | 1,544 | short_holding_exit = ACTIVE (in daily_closer); unified_exit_engine + crypto_short_holding_exit = ORPHAN | Keep short_holding_exit; archive the rest |
| **Trend following** | `trend_following_analyzer.py` (437) + `trend_following_paper_trading.py` (406) | 843 | Both ORPHAN | Archive both (paper trading only) |

**Total reclaimable from duplicate family consolidation:** ~10,000 LOC

---

## 3. API Routes Inventory

### 3.1 Route count per blueprint

| Blueprint file | Routes | LOC | URL prefix | Domain |
|---|---:|---:|---|---|
| `admin_routes.py` | 74 | 4,939 | `/api/admin/*` | Admin (auth-protected) |
| `telegram_routes.py` | 54 | 1,860 | `/api/telegram/*` | Telegram publishing |
| `portfolio_routes.py` | 54 | 2,912 | `/api/portfolio/*` | Portfolio management |
| `risk_routes.py` | 22 | 899 | `/api/risk/*` | Risk analysis |
| `misc_routes.py` | 21 | 3,869 | `/api/*` (misc) | Mixed endpoints |
| `unified_learning_routes.py` | 20 | 873 | `/api/unified-learning/*` | Unified learning engine |
| `ai_routes.py` | 20 | 806 | `/api/ai/*` | AI analysis |
| `public_routes.py` | 15 | 660 | `/api/public/*` | Public endpoints |
| `maestro_routes.py` | 13 | 1,037 | `/api/maestro/*` | Maestro (legacy Phase 5) |
| `reports_routes.py` | 12 | 518 | `/api/reports/*` | Daily/weekly/monthly reports |
| `sniper_routes.py` | 11 | 1,321 | `/api/sniper/*` | Sniper scanner |
| `prediction_tracking_routes.py` | 11 | 1,084 | `/api/prediction-tracking/*` | Prediction tracking |
| `stored_analysis_routes.py` | 10 | 2,798 | `/api/stored-analysis/*` + `/api/market/*` | Stored analyses + morning bell |
| `news_routes.py` | 9 | 720 | `/api/news/*` | News |
| `notebook_routes.py` | 7 | 124 | `/api/notebook/*` | Stock notebook |
| `analytics.py` | 7 | 692 | `/api/analytics/*` | Analytics |
| `ai_predictions_routes.py` | 7 | 1,672 | `/api/ai-predictions/*` | AI predictions |
| `picks_management_routes.py` | 6 | 519 | `/api/picks-management/*` | Daily picks + position mgmt |
| `learning_routes.py` | 5 | 328 | `/api/learning/*` | Learning |
| `confluence_routes.py` | 5 | 604 | `/api/confluence/*` | Confluence |
| `persona_routes.py` | 4 | 498 | `/api/persona/*` | Persona |
| `optimizer_params_routes.py` | 4 | 364 | `/api/prediction-optimizer/*` | Optimizer params |
| `chart_routes.py` | 4 | 3,547 | `/api/chart/*` | Charts |
| `stocks.py` | 3 | 578 | `/api/stocks/*` | Stocks screener presets |
| `screener_routes.py` | 3 | 217 | `/api/screener/*` | Screener |
| `scanner_routes.py` | 3 | 323 | `/api/scanner/*` | Scanner |
| `regime_routes.py` | 3 | 94 | `/api/regime/*` | Regime detection |
| `admin_engine_settings_routes.py` | 3 | 269 | `/api/admin/engine-settings/*` | Engine settings admin |
| `sector_tracking_routes.py` | 2 | 392 | `/api/sector-tracking/*` | Sector tracking |
| `top_performers_routes.py` | 1 | 349 | `/api/stocks/top-performers` | Top performers |
| `stock_analysis_routes.py` | 1 | 872 | `/api/stock-analysis/*` | Stock analysis |
| `professional_analysis_routes.py` | 1 | 476 | `/api/professional-analysis/<ticker>` | Professional analysis |
| `advanced_screener_routes.py` | 1 | 431 | `/api/advanced-screener/*` | Advanced screener |
| `historical_predictions_v2_routes.py` | — | 1,012 | `/api/historical-predictions-v2/*` | Historical predictions v2 |
| `picks_management_routes.py` | 6 | 519 | `/api/picks/*` | Picks management |
| `v38_backtest_routes.py` | 6 | 361 | `/api/v38-backtest/*` | V38 institutional backtest |
| `v2_routes.py` | — | 2,116 | `/api/v2/*` | V2 unified API |
| `unified_v2_routes.py` | — | 464 | `/api/unified-v2/*` | Unified V2 |
| **TOTAL** | **416** | **40,640** | — | — |

### 3.2 Routes grouped by domain

| Domain | Blueprints | Routes | Notes |
|---|---|---:|---|
| Admin | `admin_routes` + `admin_engine_settings_routes` | 77 | All `@require_admin` protected |
| Stock analysis | `stocks` + `stock_analysis_routes` + `professional_analysis_routes` + `chart_routes` + `stored_analysis_routes` | ~30 | Stock detail + chart + stored analysis |
| Predictions | `prediction_tracking_routes` + `ai_predictions_routes` + `historical_predictions_v2_routes` + `picks_management_routes` | ~25 | Prediction tracking + AI preds |
| Market analysis | `misc_routes` + `sector_tracking_routes` + `top_performers_routes` + `regime_routes` + `confluence_routes` | ~30 | Market-wide analysis |
| Screener / Scanner | `screener_routes` + `scanner_routes` + `advanced_screener_routes` | ~7 | Stock screeners |
| Risk | `risk_routes` + `v38_backtest_routes` | 28 | Risk + V38 backtest |
| News | `news_routes` | 9 | News (consumes news-agent POSTs) |
| Learning | `learning_routes` + `unified_learning_routes` | 25 | Learning engine |
| Telegram | `telegram_routes` | 54 | Telegram publishing |
| Portfolio | `portfolio_routes` | 54 | Portfolio management |
| Reports | `reports_routes` | 12 | Daily/weekly/monthly reports |
| Sniper | `sniper_routes` | 11 | Sniper scanner |
| Persona | `persona_routes` | 4 | Persona |
| Public / Health | `public_routes` + `analytics` | 22 | Public endpoints |
| Notebook | `notebook_routes` | 7 | Stock notebook |
| AI | `ai_routes` | 20 | AI analysis |
| Maestro (legacy) | `maestro_routes` | 13 | Maestro (Phase 5 retired, still has routes) |
| V2 / Unified V2 | `v2_routes` + `unified_v2_routes` | ~30 | V2 unified API |
| Optimizer | `optimizer_params_routes` | 4 | Optimizer params admin |

### 3.3 Top API consumers (Next.js side)

The Next.js frontend calls Python via `/api/proxy/*` (admin-protected) and `/api/python/*` (public). Most callers per domain:

| Domain | Frontend consumers (Next.js routes + components) | Notes |
|---|---|---|
| `/api/admin/*` | 113 route.ts files + many `Admin*` components | Most-called domain |
| `/api/stocks/*` | 26 routes + many `stocks/*` components | Second-most |
| `/api/market/*` | 32 routes (proxied to Python) | Mostly market analysis |
| `/api/v2/*` | 24 routes — **only 5 unique callers in src/components** | **WIRING DISCONNECT: 19 v2 routes unused by frontend** |
| `/api/crypto/*` | 23 routes | All consumed |
| `/api/portfolio/*` | 20 routes | All consumed |
| `/api/finance/*` | 19 routes | All consumed |
| `/api/subscription/*` | 13 routes | All consumed (Paymob) |
| `/api/maker-radar/*` | 13 routes | All consumed (radar tab) |
| `/api/mobile/*` | 48 routes | All consumed (Flutter + Android app) |
| `/api/data-engine/*` | 12 routes | All consumed (admin DataEngineTab) |
| `/api/auth/*` | 9 routes | All consumed |
| `/api/sniper/*` | 6 routes — **5 callers in components** | ACTIVE |
| `/api/maestro/*` | 9 routes — **only 2 callers** | Most are dead (Phase 5 retired) |
| `/api/v4/stats` | 1 route — **0 callers** | Dead |
| `/api/walk-forward/run` | 1 route — **0 callers** | Dead |
| `/api/kimi/backtest/run` | 1 route — **0 callers** | Dead |
| `/api/hunter/*` | 5 routes — **1 caller** | Mostly dead |
| `/api/mubasher/sync` | 1 route — **0 callers** | Dead |

### 3.4 Routes registered but no Python blueprint exists

| Route path | Frontend callers | Python blueprint | Status |
|---|---|---|---|
| `/api/v4/stats` | 0 | None — was supposed to be `expert_memory_v4_routes.py` (P0 #5 fix: blueprint was never created, file deleted from BLUEPRINTS list). Frontend `/api/v4/stats/route.ts` has SQLite fallback that computes the same stats. | Dead Python side, active SQLite fallback |
| `/api/walk-forward/run` | 0 | None | Orphan route |
| `/api/kimi/backtest/run` | 0 | None | Orphan route |
| `/api/mubasher/sync` | 0 | None | Orphan route |

---

## 4. Jobs + Cron Inventory

### 4.1 Cron entries (from `crontab.txt`)

| # | Schedule (UTC) | Script | Logs to | Status | Purpose |
|---:|---|---|---|---|---|
| 1a | `0 3 * * 1-5` | `vps-service/jobs/v40_2_daily_generator.py --today-only --max-picks 5` | `/tmp/v40_2_morning.log` | ✅ ACTIVE | Morning V40.2 generator (05:00 Cairo) |
| 1b | `30 13 * * 1-5` | `vps-service/jobs/v40_2_daily_generator.py --yesterday-only --max-picks 5` | `/tmp/v40_2_evening.log` | ✅ ACTIVE | Evening V40.2 generator (15:30 Cairo) |
| 2 | `*/5 8-12 * * 0-4` | `vps-service/jobs/v40_2_intraday_scanner.py --limit 5` | `/tmp/v40_2_intraday.log` | ✅ ACTIVE | Intraday scanner (5-min, market hours) |
| 3 | `0 14 * * 0-4` | `vps-service/jobs/daily_closer.py` | `/tmp/daily_closer.log` | ✅ ACTIVE | Daily closer (16:00 Cairo) |
| 4 | `0 15 * * 0-4` | `vps-service/jobs/learning_engine.py` | `/tmp/learning_engine.log` | ✅ ACTIVE | Learning engine (17:00 Cairo) |
| 5 | `0 4 * * 0-4` | `vps-service/jobs/fetch_corporate_actions.py` | `/tmp/corporate_actions.log` | ✅ ACTIVE | Corporate actions (06:00 Cairo) |
| 6a | `0 7 * * 0-4` | `vps-service/scripts/daily_price_updater.py` | `/tmp/price_updater_morning.log` | ✅ ACTIVE | Price updater (09:00 Cairo — pre-open) |
| 6b | `0 13 * * 0-4` | `vps-service/scripts/daily_price_updater.py` | `/tmp/price_updater_evening.log` | ✅ ACTIVE | Price updater (15:00 Cairo — post-close) |
| 7 | `*/5 8-12 * * 0-4` | `data_engine/scrapers/tradingview_scraper.py` | `/tmp/tradingview.log` | ✅ ACTIVE | TradingView scraper (5-min during market) |
| 8 | `0 6 * * 0-4` | `vps-service/jobs/price_history_safetynet.py` | `/tmp/price_safetynet.log` | ✅ ACTIVE | Yahoo Finance fallback (08:00 Cairo) |
| 9 | `0 1 * * *` | `vps-service/scripts/data_heartbeat_checker.py` | `/tmp/heartbeat.log` | ✅ ACTIVE | DB heartbeat (03:00 Cairo) |
| 10 | `30 1 * * *` | `vps-service/scripts/smart_db_backup.py` | `/tmp/backup.log` | ✅ ACTIVE | Daily backup (03:30 Cairo) |
| 11 | `0 14 * * 6` | `vps-service/data/egx_fundamental_fetcher.py` | `/tmp/fundamentals.log` | ✅ ACTIVE | Weekly fundamentals (Saturday 16:00 Cairo) |
| 12 | `0 8-12/2 * * 0-4` | `python3 -c "from analyzers.egx_disclosure_engine import fetch_and_store_disclosures; print(fetch_and_store_disclosures(50))"` | `/tmp/disclosures.log` | ✅ ACTIVE | EGX disclosures (every 2h market hours) |
| 13 | `35 13 * * 0-4` | `scripts/sync_hunter_pick_tracking.py` | `/tmp/sync_hunter_pick.log` | ✅ ACTIVE | Sync V40.2 → hunter_pick_tracking (15:35 Cairo) |
| 14 | `0 2 * * *` | `curl -X POST http://localhost:3000/api/maker-radar/signal-tracker/verify -d '{"max_age_days": 45}'` | `/tmp/radar_signal_verify.log` | ✅ ACTIVE | Radar signal verify (04:00 Cairo) |
| 15a | `50 2 * * 0-4` | `python3 -c "from analyzers.market_regime_engine import MarketRegimeEngine; MarketRegimeEngine('EGX').update_regime()"` | `/tmp/regime_engine.log` | ✅ ACTIVE | Daily EGX regime update (04:50 Cairo) |
| 15b | `55 2 * * 6` | `vps-service/analyzers/market_regime_engine.py --all` | `/tmp/regime_engine_weekly.log` | ✅ ACTIVE | Weekly multi-market regime (Saturday 04:55) |
| 16 | `0 6 * * 0` | `scripts/weekly_radar_report.py --market EGX --send-telegram` | `/tmp/weekly_report.log` | ✅ ACTIVE | Weekly radar report (Sunday 08:00 Cairo) |
| 17 | `0 22 * * 1-5` | `data_engine/scrapers/us_stock_scraper.py` | `/tmp/us_scraper.log` | ✅ ACTIVE | US stocks (00:00 Cairo — after US close) |
| 18 | `0 9-22 * * *` | `data_engine/scrapers/multi_market_scraper.py` | `/tmp/multi_scraper.log` | ✅ ACTIVE | Multi-market scraper (hourly 11:00-00:00 Cairo) |

### 4.2 Jobs scheduled internally (by `market_scheduler.tick` / `main.py` startup)

| Job | Schedule | Trigger | Status |
|---|---|---|---|
| `market_scheduler.tick` | every 60s | `scheduler_manager.wrap_legacy_scheduler` in main.py | ✅ ACTIVE |
| `egypt_scheduler.tick_once` | every 60s | `scheduler_manager.wrap_legacy_scheduler` in main.py | ✅ ACTIVE |
| `wal_checkpoint` | hourly | `scheduler_manager.register_interval` in main.py | ✅ ACTIVE |
| `crypto_lab_scheduler` | every 15min | `get_crypto_lab_scheduler().start(use_scheduler_manager=True)` in main.py | ✅ ACTIVE (when SKIP_CRYPTO_LAB != 1) |
| `nightly_quant_job` | 03:00 Cairo daily | `egypt_scheduler.setup_nightly_quant_job()` in main.py | ✅ ACTIVE |
| `egksco_sync` | 09:00-14:30 Cairo | `egypt_scheduler.setup_egksco_scheduler()` in main.py | ✅ ACTIVE |
| `daily_closer` | triggered by market_scheduler | `from jobs.daily_closer import DailyCloser` in market_scheduler.py | ✅ ACTIVE (also cron #3) |
| `learning_engine` | triggered by market_scheduler | `from jobs.learning_engine import LearningEngine` in market_scheduler.py | ✅ ACTIVE (also cron #4) |
| `fetch_inflation_worldbank` | triggered by market_scheduler | `from jobs.fetch_inflation_worldbank import main` in market_scheduler.py | ✅ ACTIVE |
| `daily_portfolio_yield` | triggered by market_scheduler | `from jobs.daily_portfolio_yield import run` in market_scheduler.py | ✅ ACTIVE |
| `price_history_safetynet` | triggered by market_scheduler | `from jobs.price_history_safetynet import fill_price_history_gap` in market_scheduler.py | ✅ ACTIVE (also cron #8) |
| `intraday_aggregator` | triggered by market_scheduler | `from jobs.intraday_aggregator import aggregate_intraday_to_daily` in market_scheduler.py | ✅ ACTIVE |
| `price_history_stale_monitor` | triggered by market_scheduler | `from jobs.price_history_stale_monitor import check_price_history_stale` in market_scheduler.py | ✅ ACTIVE |

### 4.3 Orphan jobs (NOT scheduled anywhere)

| File | LOC | Purpose | Recommendation |
|---|---:|---|---|
| `jobs/hot_candidate_detector.py` | 299 | Intraday maker activity detector (reads `stock_intraday` from `intraday.db`) | **WIRE** — should run every 5 min during market hours, before V40.2 intraday scanner. Currently 0 callers. |
| `jobs/fetch_earnings_calendar.py` | 244 | Weekly earnings + dividends from TradingView | **WIRE** — schedule weekly Sunday (the docstring suggests `0 6 * * 0`). Currently 0 callers. |
| `jobs/daily_gainer_scan.py` | 186 | Daily post-close: top 10 gainers analysis (was V40.2 missing them?) | **WIRE** — schedule after daily_closer. Currently 0 callers. |
| `jobs/price_history_stale_monitor.py` | 182 | Detects stale price history | ACTIVE via market_scheduler |
| `jobs/market_scheduler.py` | 2,751 | Central market scheduler | ACTIVE via main.py |

### 4.4 Standalone root .py files (orphan check)

| File | LOC | Purpose | Status |
|---|---:|---|---|
| `main.py` | 366 | FastAPI entry | ✅ ACTIVE (PM2 service) |
| `lightweight_server.py` | 1,899 | Flask app | ✅ ACTIVE (mounted in main.py) |
| `analysis_engine_v2.py` | 983 | Legacy analyzer wrapper | ⚠️ LOW USE (2 callers) |
| `config.py` | 267 | Config constants | ✅ ACTIVE (211 callers — referenced as "config" string everywhere) |
| `scanner_cron.py` | 54 | Scanner cron wrapper | ❌ DEAD (0 callers, 0 cron) |
| `risk_management_advanced.py` | — | Advanced risk mgmt | ⚠️ LOW USE (7 callers, all comments) |
| `crypto_live_predictions.py` | — | Crypto live predictions | ❌ DEAD (0 callers, 0 cron) |
| `crypto_predictions_reset.py` | — | Reset crypto predictions | ❌ DEAD (0 callers, 0 cron) |
| `import_egx30_production.py` | — | EGX30 import script | ⚠️ ONE-OFF (2 callers) |
| `repair_data_engine.py` | — | Repair data_engine.db | ⚠️ ONE-OFF (2 callers) |
| `reset_predictions.py` | — | Reset predictions.db | ❌ DEAD (1 caller — itself) |
| `cleanup_corrupted_symbols.py` | — | Cleanup corrupted symbols | ⚠️ ONE-OFF (2 callers) |
| `align_production_symbols.py` | — | Align production symbols | ⚠️ ONE-OFF (2 callers) |
| `test_db_connection.py` | — | DB connection test | ❌ DEAD (0 callers) |
| `test_maestro_direct.py` | — | Direct maestro test | ❌ DEAD (0 callers) |
| `test_phase3.py` | — | Phase 3 test | ❌ DEAD (0 callers) |
| `test_quick_check.py` | — | Quick check | ❌ DEAD (0 callers) |

---

## 5. Scrapers Inventory

### 5.1 `data_engine/scrapers/` files (20 scrapers, 7,582 LOC)

| Scraper | LOC | Source | Target DB | Target Table | Status | Frequency |
|---|---:|---|---|---|---|---|
| `tradingview_scraper.py` | 298 | TradingView (Playwright) | `data_engine.db` | `stocks` + `egksco_price_history` | ✅ ACTIVE | every 5min (cron #7) + multi_market_scraper |
| `yahoo_scraper.py` | 315 | Yahoo Finance (fallback) | `data_engine.db` | `stocks` | ⚠️ FALLBACK | Called by multi_market_scraper as fallback |
| `us_stock_scraper.py` | 694 | Yahoo Finance (US) | `price_history.db` | `price_history` (source='yahoo_us', market='US') | ✅ ACTIVE | daily 22:00 UTC (cron #17) |
| `multi_market_scraper.py` | 348 | Orchestrates EGX + US + Crypto + Metals | Multiple | Multiple | ✅ ACTIVE | hourly 09:00-22:00 UTC (cron #18) |
| `crypto_fetcher.py` | 307 | CryptoCompare + Coinbase | `data_engine.db` | `crypto_prices` + `btc_local_prices` | ✅ ACTIVE | via multi_market_scraper |
| `metals_forex_fetcher.py` | 653 | GoldAPI + exchangerate.host | `data_engine.db` | `gold_prices` + `gold_prices_clean` + `silver_prices` + `exchange_rates` | ✅ ACTIVE | via multi_market_scraper |
| `news_scraper.py` | 550 | Web scraping | `stocks.db` | `news` | ⚠️ LOW USE (2 callers) | Manual trigger |
| `historical_fetcher.py` | 530 | EODHD API | `price_history.db` + `data_engine.db` | `historical_data` | ⚠️ LOW USE | Manual (one-off backfill) |
| `historical_fetcher_5years.py` | 377 | EODHD API (5-year) | `price_history.db` | `price_history` | ❌ ORPHAN (0 callers) | — |
| `egksco_scraper.py` | 437 | EGX official (egksco.com) | `data_engine.db` | `egksco_stocks` + `egksco_price_history` | ✅ ACTIVE | via egypt_scheduler.setup_egksco_scheduler |
| `egxpilot_scraper.py` | 342 | EGXPilot | `data_engine.db` | `stocks` (live quotes) | ❌ ORPHAN (0 callers) | — |
| `tradingview_rest.py` | 461 | TradingView REST API | `data_engine.db` | `stocks` (live) | ⚠️ LOW USE (1 caller — multi_market_scraper maybe) | — |
| `tradingview_market_movers.py` | 435 | TradingView market movers | `data_engine.db` | `screener_results` | ❌ ORPHAN (0 callers) | — |
| `tradingview_screener_lists.py` | 245 | TradingView screener lists | `data_engine.db` | `screener_lists` | ⚠️ LOW USE (3 callers) | — |
| `fallback_chain.py` | 450 | Orchestrates TV → Yahoo → EODHD | `data_engine.db` | Multiple | ✅ ACTIVE (4 callers) | — |
| `technical_fetcher.py` | 245 | Computes technical indicators | `data_engine.db` | `enhanced_indicators` | ❌ ORPHAN (0 callers) | — |
| `smart_scheduler.py` | 328 | Smart scheduler | N/A | N/A | ❌ ORPHAN (0 callers) | — |
| `auto_refresh_scheduler.py` | 180 | Auto refresh scheduler | N/A | N/A | ❌ ORPHAN (0 callers) | — |
| `fetch_logos.py` | 104 | Fetches stock logos | Filesystem | `assets/logos/` | ❌ ORPHAN (0 callers) | — |
| `metals_forex_fetcher.py.original` | — | Backup of metals_forex_fetcher | — | — | ❌ BACKUP FILE (should be deleted) | — |

### 5.2 `vps-service/data/` files (16 fetchers, 8,676 LOC)

| File | LOC | Purpose | Status |
|---|---:|---|---|
| `analyses.py` | 1,304 | Analysis data layer | ✅ ACTIVE (30 callers) |
| `egksco_scraper.py` | 962 | EGX official scraper (duplicate of `data_engine/scrapers/egksco_scraper.py`) | ⚠️ DUPLICATE (1 caller) |
| `enhanced_multi_market.py` | 1,001 | Enhanced multi-market fetcher | ⚠️ LOW USE (1 caller) |
| `egx_fetcher.py` | 927 | EGX fetcher | ✅ ACTIVE (3 callers) |
| `eodhd_fetcher.py` | 774 | EODHD API fetcher | ✅ ACTIVE (2 callers) |
| `egx_stocks_complete.py` | 718 | Complete EGX stocks list | ✅ ACTIVE (3 callers) |
| `egx_fundamental_fetcher.py` | 573 | EGX fundamentals (writes `egx_fundamentals` table) | ✅ ACTIVE (2 callers + cron #11) |
| `egx_official_sectors.py` | 348 | EGX official sectors | ✅ ACTIVE (5 callers) |
| `prices.py` | 402 | Price helpers | ✅ ACTIVE (30 callers) |
| `multi_market_fetcher.py` | 337 | Multi-market fetcher | ❌ ORPHAN (0 callers — replaced by `data_engine/scrapers/multi_market_scraper.py`) |
| `us_stocks_fetcher.py` | 545 | US stocks fetcher | ❌ ORPHAN (0 callers — replaced by `data_engine/scrapers/us_stock_scraper.py`) |
| `egx_ticker_sector_map.py` | 287 | Ticker→sector mapping | ⚠️ LOW USE (2 callers) |
| `egx_arabic_lookup.py` | 159 | Arabic name lookup (3 duplicates exist!) | ⚠️ DUPLICATE — also in `analyzers/` + `telegram/` |
| `crypto_fetcher.py` | 144 | Crypto fetcher (lightweight) | ⚠️ LOW USE (1 caller) |
| `gap_filler.py` | 181 | Price gap filler | ⚠️ LOW USE (1 caller) |
| `__init__.py` | 0 | — | — |

### 5.3 `news-agent/collectors/` + `news-agent/collectors/scrappers/`

| Collector | Source | Status |
|---|---|---|
| `telegram_collector.py` | Telegram channels (via Telethon) | ✅ ACTIVE |
| `web_scraper.py` | Web scraping (generic) | ✅ ACTIVE |
| `rss_collector.py` | RSS feeds | ❌ DISABLED (.disabled extension) |
| `rss_collector.py.disabled` | RSS (disabled) | — |
| `investing_news_collector.py.disabled` | Investing.com (disabled) | — |
| `mubasher_scraper.py` | Mubasher news | ✅ ACTIVE |
| `egyptian_sources.py` | Egyptian news sources list | ✅ ACTIVE |
| `keyword_filter.py` | Keyword filter | ✅ ACTIVE |
| `scrappers/egx_news_scraper.py` | EGX news scraper | ✅ ACTIVE |
| `scrappers/marketmaker_news_scraper.py` | MarketMaker news | ✅ ACTIVE |
| `scrappers/daleelak_api.py` | Daleelak API | ✅ ACTIVE |
| `scrappers/tradingview_market_movers.py` | TV market movers | ✅ ACTIVE |
| `scrappers/tradingview_scraper.py` | TradingView | ✅ ACTIVE |
| `scrappers/tradingview_screener_lists.py` | TV screener lists | ✅ ACTIVE |
| `scrappers/tradingview_rest.py` | TV REST API | ✅ ACTIVE |
| `scrappers/investing_scraper.py.disabled` | Investing.com (disabled) | — |

### 5.4 Scraper status summary

| Metric | Value |
|---|---:|
| Scrapers in `data_engine/scrapers/` | 20 |
| Scrapers in `vps-service/data/` | 16 |
| Scrapers in `news-agent/collectors/` + `scrappers/` | 16 |
| Total scrapers | **52** |
| ACTIVE scrapers (in cron or called by multi_market_scraper) | **~18** |
| ORPHAN scrapers (0 callers) | **~12** |
| Duplicate scrapers (`egksco_scraper.py` exists in 2 places) | 1 |
| Duplicate `egx_arabic_lookup.py` (exists in 3 places) | 1 |

---

## 6. Database Inventory

### 6.1 Sandbox DB state (current `/home/z/my-project/db/*.db`)

| DB | Sandbox size | Production size (est.) | Status on sandbox |
|---|---:|---:|---|
| `stocks.db` | 80 KB | ~50 MB | ✅ Has 50 stock rows + 8 schema tables (mostly empty) |
| `predictions.db` | 44 KB | ~30 MB | ⚠️ Empty (0 predictions, 0 lessons, 0 stored_analyses) |
| `data_engine.db` | 0 bytes | ~150 MB | ❌ Empty file on sandbox |
| `auth.db` | 0 bytes | ~5 MB | ❌ Empty file on sandbox (Prisma-managed) |
| `price_history.db` | 264 KB | ~150 MB | ✅ Has 1,500 rows + 1,336 tickers (sandbox) / 1.24M rows (prod) |
| `custom.db` | 24 KB | — | ❌ Prisma tutorial default — **should be deleted** (P0 #8 fix lists it as deprecated) |

### 6.2 Sandbox tables + row counts (via Python `sqlite3`)

#### `stocks.db` (8 tables)

| Table | Rows | Latest record | Purpose |
|---|---:|---|---|
| `stocks` | 50 | 2026-09-28 08:41 | Stock metadata (ticker + name + sector + market) |
| `financial_obligations` | 0 | — | User financial obligations |
| `financial_transactions` | 0 | — | User financial transactions |
| `investors_data` | 0 | — | EGX investors data |
| `macro_indicators` | 0 | — | Macro indicators (inflation, interest rates) |
| `obligation_payments` | 0 | — | Obligation payments |
| `portfolio_assets` | 0 | — | User portfolio assets |
| `user_stock_watchlists` | 0 | — | User stock watchlists |
| `sqlite_sequence` | 0 | — | SQLite internal |

#### `predictions.db` (3 tables)

| Table | Rows | Latest record | Purpose |
|---|---:|---|---|
| `predictions` | 0 | — | V40.2 predictions |
| `prediction_lessons` | 0 | — | Lessons (legacy — replaced by `learned_lessons`) |
| `stored_analyses` | 0 | — | Stored analyses (V40.2 daily writes here) |
| `sqlite_sequence` | 0 | — | SQLite internal |

#### `price_history.db` (2 tables)

| Table | Rows | Latest record | Purpose |
|---|---:|---|---|
| `price_history` | 1,500 | 2026-09-25 | Canonical 25-year price history (1.24M rows on prod) |
| `sqlite_sequence` | 1 | — | SQLite internal |

#### `custom.db` (2 tables)

| Table | Rows | Purpose |
|---|---:|---|
| `Post` | 0 | Prisma tutorial (deprecated) |
| `User` | 0 | Prisma tutorial (deprecated — real users in `auth.db`) |

### 6.3 Production-canonical DB tables (per `utils/db_paths.py`)

The `DBPaths.get_db_for_table()` method encodes which DB is canonical for each table. Below is the full canonical mapping (after P0-8-DB-UNIFY on 2026-09-27):

#### `data_engine.db` (canonical — 22 tables)

| Table | Purpose | Writer | Reader(s) | Status |
|---|---|---|---|---|
| `egksco_price_history` | EGX daily OHLCV | `egksco_scraper.py` | V40.2 + daily_closer + learning_engine + v38_backtest | ✅ CANONICAL (13K rows on prod) |
| `gold_prices` | Live gold prices (EGP) | `metals_forex_fetcher.py` | Market regime + reports_engine + smart_confluence | ✅ CANONICAL (187K rows) |
| `gold_prices_clean` | Cleaned gold prices | `metals_forex_fetcher.py` | Reports | ✅ CANONICAL |
| `silver_prices` | Live silver prices | `metals_forex_fetcher.py` | Reports | ✅ CANONICAL |
| `tab_balance_sheet` | Fundamentals: balance sheet | `egx_fundamental_fetcher.py` | Fundamental analyzers | ✅ CANONICAL |
| `tab_cash_flow` | Fundamentals: cash flow | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ **NO API READER** |
| `tab_dividends` | Fundamentals: dividends | `egx_fundamental_fetcher.py` | `dividend_checker.py` (orphan) | ⚠️ LOW USE |
| `tab_income_statement` | Fundamentals: income statement | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ **NO API READER** |
| `tab_performance` | Fundamentals: performance | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ LOW USE |
| `tab_profitability` | Fundamentals: profitability | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ LOW USE |
| `tab_technical_analysis` | Fundamentals: technical | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ LOW USE |
| `tab_valuation` | Fundamentals: valuation | `egx_fundamental_fetcher.py` | Fundamental analyzers | ⚠️ LOW USE |
| `crypto_prices` | Live crypto prices | `crypto_fetcher.py` | Crypto analyzers (most orphans) | ✅ ACTIVE |
| `crypto_price_history` | Crypto historical | `crypto_fetcher.py` | Crypto analyzers | ⚠️ **NO API READER** |
| `cryptos` | Crypto metadata | `crypto_fetcher.py` | — | ⚠️ **NO API READER** |
| `crypto_metrics` | Crypto metrics | `crypto_fetcher.py` | — | ⚠️ **NO API READER** |
| `crypto_fetch_log` | Crypto fetch log | `crypto_fetcher.py` | — | ⚠️ LOG ONLY |
| `sync_status` | Sync status | `data_engine/sync.py` | — | ⚠️ LOG ONLY |
| `exchange_rates` | Forex rates | `metals_forex_fetcher.py` | Reports | ✅ ACTIVE |
| `btc_local_prices` | BTC in local currencies | `crypto_fetcher.py` | — | ⚠️ **NO API READER** |
| `macro_indicators` | Macro (inflation, interest) | `fetch_inflation_worldbank.py` | `macro_veto.py` (orphan) | ⚠️ LOW USE |
| `macro_prices` | Macro prices | `fetch_inflation_worldbank.py` | — | ⚠️ **NO API READER** |
| `macro_fetch_log` | Macro fetch log | `fetch_inflation_worldbank.py` | — | ⚠️ LOG ONLY |
| `historical_data` | Historical data (numeric ticker format) | `historical_fetcher.py` | `market-data-access.ts` (Next.js) | ✅ ACTIVE |
| `screener_presets` | Screener presets | `tradingview_screener_lists.py` | `stocks.py` API | ✅ ACTIVE |
| `screener_results` | Screener results | `tradingview_market_movers.py` (orphan) | `screener.py` API | ⚠️ LOW USE |
| `screener_lists` | Screener lists (JSON cache) | `tradingview_screener_lists.py` | — | ⚠️ **NO API READER** (consumed via JSON file `db/screener_lists.json`) |

#### `stocks.db` (canonical — 22 tables)

| Table | Purpose | Writer | Reader(s) | Status |
|---|---|---|---|---|
| `stocks` | Stock metadata | `tradingview_scraper.py` + `egksco_scraper.py` + seed scripts | Almost every analyzer + API | ✅ CANONICAL (976 rows on prod) |
| `egksco_stocks` | EGX official stock list | `egksco_scraper.py` | `live_price.py` fallback | ✅ CANONICAL (250 rows) |
| `cached_analysis` | Cached analysis JSON | `master_analyzer.py` | Various | ✅ CANONICAL (143 rows) |
| `ExpertRecommendation` | Expert recommendations | `maestro_orchestrator.py` | `ai_predictions_routes.py` | ✅ CANONICAL (127 rows) |
| `telegram_news` | Telegram news cache | `telegram_signal_importer.py` | news routes | ✅ CANONICAL (6 rows) |
| `portfolios` | User portfolios | `portfolio_routes.py` | portfolio API | ✅ CANONICAL (3 rows) |
| `stock_daily_prices` | Daily prices (last 30 days, fast) | `data_engine/sync.py` + `daily_price_updater.py` | V40.2 + chart_routes | ✅ ACTIVE |
| `stock_phase` | Stock phase (Minervini 1-4) | `engines/market_regime.py` | — | ⚠️ LOW USE |
| `stocks_backup` | Stocks backup | Manual | — | ⚠️ BACKUP |
| `stock_prices` | Stock prices (legacy alias) | — | — | ⚠️ LEGACY |
| `stock_intraday` | Intraday 5-min (stocks) | `data_engine/intraday_storage.py` | `hot_candidate_detector.py` (orphan) | ⚠️ LOW USE |
| `crypto_intraday` | Intraday 5-min (crypto) | `data_engine/intraday_storage.py` | — | ⚠️ **NO API READER** |
| `commodity_intraday` | Intraday commodities | `data_engine/intraday_storage.py` | — | ⚠️ **NO API READER** |
| `intraday_meta` | Intraday metadata | `data_engine/intraday_storage.py` | — | ⚠️ LOG ONLY |
| `egksco_sync_status` | Egksco sync status | `egksco_scraper.py` | — | ⚠️ LOG ONLY |
| `market_indices` | Market indices (EGX30, EGX70, etc.) | `import_egx_indices.py` | reports | ✅ ACTIVE |
| `market_regime_log` | Regime change log | `market_regime_engine.py` | — | ⚠️ **NO API READER** |
| `system_settings` | System key-value settings | `market_regime_engine.py` + various | Almost everything | ✅ ACTIVE |
| `tuned_predictions_summary` | Tuned predictions | `prediction_optimizer.py` | — | ⚠️ **NO API READER** |
| `real_evaluated_predictions` | Evaluated predictions | `evaluate_predictions.py` (tool) | — | ⚠️ **NO API READER** |
| `analytics_events` | Analytics events | Various | `analytics.py` API | ✅ ACTIVE |
| `gold_price_history` | Historical gold prices (legacy) | `migrate-from-egx-investment.ts` | — | ⚠️ LEGACY (replaced by `data_engine.db.gold_prices`) |
| `currency_rates` | Currency rates (legacy) | — | — | ⚠️ LEGACY |
| `news` | News (legacy alias) | — | news routes | ⚠️ LEGACY |
| `news_items` | News items (legacy) | — | — | ⚠️ LEGACY |

#### `predictions.db` (canonical — 17 tables)

| Table | Purpose | Writer | Reader(s) | Status |
|---|---|---|---|---|
| `predictions` | V40.2 predictions | `v40_2_daily_generator.py` + `maestro_orchestrator.py` + `prediction_tracker.py` | prediction_tracking_routes + daily_closer | ✅ CANONICAL |
| `persona_predictions` | Persona-specific predictions | `v40_2_daily_generator.py` | — | ⚠️ **NO API READER** |
| `prediction_logs` | Prediction logs | `prediction_tracker.py` | — | ⚠️ **NO API READER** |
| `outcome_logs` | Outcome logs | `daily_closer.py` + `learning_engine.py` | learning routes | ✅ ACTIVE |
| `learned_lessons` | AI-mined lessons | `learning_engine.py` + `mine_learned_lessons.py` (orphan) | learning routes + unified_learning_routes | ✅ CANONICAL (19K rows on prod) |
| `conjunction_patterns` | Conjunction patterns | `unified_learning_engine.py` | — | ⚠️ **NO API READER** |
| `indicator_trust_scores` | Indicator trust scores | `unified_learning_engine.py` | — | ⚠️ **NO API READER** |
| `quant_cache` | Quant cache | `quant_cache.py` (orphan) | — | ⚠️ ORPHAN |
| `stored_analyses` | Stored analyses | `v40_2_daily_generator.py` + `v40_2_intraday_scanner.py` + `market_scheduler.py` + `persona_db.py` + `misc_routes.py` | stored_analysis_routes | ✅ CANONICAL |
| `morning_bell_signals` | Morning bell signals | `v40_2_daily_generator.py` | stored_analysis_routes `/api/market/morning-bell` | ✅ ACTIVE |
| `exit_notifications` | Exit notifications | `daily_closer.py` | — | ⚠️ **NO API READER** |
| `backtest_results` | Backtest results | `backtest_engine.py` | — | ⚠️ LOW USE |
| `optimizer_params_history` | Optimizer params history | `prediction_optimizer.py` | optimizer_params_routes | ✅ ACTIVE |
| `crypto_predictions_log` | Crypto predictions log | `crypto_lab_scheduler.py` | crypto routes | ✅ ACTIVE |
| `aiPredictionStats` | AI prediction stats | `ai/` modules | — | ⚠️ **NO API READER** |
| `user_trades` | User trades | — | — | ⚠️ EMPTY |
| `telegram_recommendations` | Telegram recommendations | `telegram_routes.py` | — | ⚠️ LOW USE |
| `telegram_signals` | Telegram signals | `telegram_signal_importer.py` | — | ⚠️ LOW USE |
| `prediction_lessons` | Legacy lessons (replaced by `learned_lessons`) | — | — | ⚠️ LEGACY |

#### `auth.db` (canonical — 9 tables)

| Table | Purpose | Writer | Reader(s) | Status |
|---|---|---|---|---|
| `User` | Users | Prisma (`auth-schema.prisma`) | Auth API | ✅ CANONICAL (101 rows on prod) |
| `PromoCode` | Promo codes | Prisma | Subscription API | ⚠️ **NO Python API READER** |
| `SubscriptionPlan` | Subscription plans | Prisma | Subscription API | ⚠️ **NO Python API READER** |
| `api_tokens` | API tokens | Prisma / admin | auth_middleware | ✅ ACTIVE |
| `task_runs` | Background task runs | Various | — | ⚠️ LOW USE |
| `user_stock_watchlists` | User watchlists | watchlist API | watchlist API | ✅ ACTIVE |
| `portfolio_assets` | User portfolio assets | portfolio API | portfolio API | ✅ ACTIVE |
| `session` | NextAuth sessions | NextAuth | NextAuth | ✅ ACTIVE |
| `account` | NextAuth accounts | NextAuth | NextAuth | ✅ ACTIVE |
| `verification_token` | NextAuth verification tokens | NextAuth | NextAuth | ✅ ACTIVE |

#### `content.db` (target — not yet on production)

| Table | Purpose | Status |
|---|---|---|
| `news_articles` | News articles | ⏳ NOT YET MIGRATED (still in `stocks.db.news`) |
| `telegram_messages` | Telegram messages | ⏳ NOT YET MIGRATED |
| `scraping_status` | Scraping status | ⏳ NOT YET MIGRATED |
| `tracked_channels` | Tracked channels | ⏳ NOT YET MIGRATED |

### 6.4 JSON state files (`db/*.json`)

| File | Purpose | Writer | Reader | Status |
|---|---|---|---|---|
| `maker_radar_tracking.json` | Tracked maker radar stocks | `signal_tracker` API | `weekly_radar_report.py` + timeline API | ✅ ACTIVE |
| `radar_cache_status.json` | Radar cache warmup status | `radar-cache.ts` | maker-radar API | ✅ ACTIVE |
| `radar_alerts_state.json` | Radar alerts state | `schedulers/radar-alerts.ts` | alerts API | ✅ ACTIVE |
| `v40_generation_status.json` | V40.2 generation status | `v40_2_daily_generator.py` | admin UI | ✅ ACTIVE |
| `historical_status.json` | Historical backfill status | `historical_fetcher.py` | admin UI | ✅ ACTIVE |
| `production_snapshot_progress.json` | Production snapshot progress | `export_vps_data_for_sandbox.py` | admin | ⚠️ ONE-OFF |
| `paper_mode_v2.json` | Paper trading mode | `paper_trading-v2-db.ts` | paper-trading-v2 API | ✅ ACTIVE |
| `paper_test_v2.json` | Paper test state | `paper_trading.py` | paper_trading API | ⚠️ LOW USE |
| `screener_lists.json` | Screener lists cache (Arabic) | `tradingview_screener_lists.py` | screener API + UI | ✅ ACTIVE |
| `display_protection.example.json` | Display protection example | manual | display_protection.ts | ⚠️ EXAMPLE |
| `retrospective_analysis.json` | Retrospective analysis | `phase1a_retrospective.py` | admin | ⚠️ ONE-OFF |
| `unified_logic_whatif_results.json` | What-if results | `unified_logic_backtest.py` (archived) | — | ⚠️ ARCHIVED |
| `balanced_only_backtest_results.json` | Balanced-only backtest | `balanced_only_backtest.py` (archived) | — | ⚠️ ARCHIVED |
| `backtest_risk_management_results.json` | Risk mgmt backtest | `backtest_with_risk_management.py` | — | ⚠️ ONE-OFF |
| `migration-consolidate-2026-09-26T09-50-16.json` | Migration log | `consolidate-db-duplicates.js` | — | ⚠️ ONE-OFF |
| `migration-consolidate-2026-09-26T09-50-25.json` | Migration log | `consolidate-db-duplicates.js` | — | ⚠️ ONE-OFF |

### 6.5 DB reader/writer counts (across whole repo)

| DB | Readers (files) | Notes |
|---|---:|---|
| `stocks.db` | 353 | Most-used DB |
| `data_engine.db` | 215 | Second-most |
| `predictions.db` | 204 | Third-most |
| `price_history.db` | 193 | Price history |
| `intraday.db` | 63 | Intraday tick data (not present on sandbox) |
| `auth.db` | 49 | User data (mostly Prisma-managed) |

### 6.6 DB summary stats

| Metric | Value |
|---|---:|
| Active SQLite DBs in `/db/` | **6** (stocks + predictions + data_engine + auth + price_history + custom) |
| Empty DBs on sandbox | **3** (auth + data_engine + custom) |
| Deprecated DBs (per P0 #8) | **1** (`custom.db` — should be deleted) |
| Target architecture DBs (per `db_paths.py`) | **4** (market + predictions + auth + content) |
| Target DBs not yet populated | **2** (market + content) |
| Total tables across all DBs | **~70** (canonical) |
| Tables with no API reader | **~20** (mostly legacy + intraday + macros) |
| Total JSON state files | **16** |

---

## 7. Data Flow Maps

### 7.1 Stock Prices Flow

```
Sources (EGX):
  • TradingView (Playwright) → data_engine/scrapers/tradingview_scraper.py
       ↓ (every 5 min during market hours, cron #7)
  • EGX Official (egksco.com) → data_engine/scrapers/egksco_scraper.py
       ↓ (via egypt_scheduler 09:00-14:30 Cairo)
  • Yahoo Finance (fallback) → data_engine/scrapers/yahoo_scraper.py
       ↓ (via multi_market_scraper fallback chain)

Target: data_engine.db.egksco_price_history (13K rows on prod)
  ↓
data_engine/sync.py:sync_current_prices()
  ↓ UPSERT
stocks.db.stock_daily_prices (last 30 days, fast lookup)
  ↓
data_engine/sync.py:broadcast_prices()
  ↓ POST http://localhost:3005/broadcast
ws-service (port 3005) → market:update event → frontend

API (Python):
  • /api/stocks/<ticker>/history → reads price_history.db or stocks.db.stock_daily_prices
  • /api/chart/<ticker> → reads data_engine.db.egksco_price_history
  • /api/stocks/top-performers → reads data_engine.db.egksco_price_history
  • /api/sector-tracking/* → reads stocks.db.stock_daily_prices

API (Next.js proxy):
  • /api/stocks/[ticker]/history/route.ts → proxies to Python
  • /api/stocks/[ticker]/route.ts → proxies to Python
  • /api/stocks/sparkline/route.ts → reads stocks.db directly (better-sqlite3)

UI:
  • src/components/stocks/StockDetail.tsx
  • src/components/analysis/InteractiveChart.tsx
  • src/components/screener/StockScreenerAdvanced.tsx
```

### 7.2 Fundamentals Flow

```
Source: EGX official (Mubasher) + EODHD
  ↓
vps-service/data/egx_fundamental_fetcher.py
  ↓ (weekly Saturday 14:00 UTC, cron #11)
Target: data_engine.db (tab_balance_sheet, tab_cash_flow, tab_dividends,
                          tab_income_statement, tab_performance, tab_profitability,
                          tab_technical_analysis, tab_valuation)

API (Python):
  • /api/stocks/<ticker>/comprehensive → reads tab_* tables
  • /api/professional-analysis/<ticker> → reads tab_* tables
  • /api/chart/<ticker> → reads tab_technical_analysis

UI:
  • src/components/stocks/ComprehensiveStockAnalysis.tsx (Fundamental tab)
  • src/components/analysis/SingleStockAnalysisView.tsx
  • src/components/stocks/DeepAnalysis.tsx

Gap:
  • tab_cash_flow + tab_income_statement + tab_valuation + tab_performance +
    tab_profitability + tab_technical_analysis have NO direct API reader
    (consumed only via the comprehensive endpoint which returns all of them as a bundle)
```

### 7.3 Predictions Flow (V40.2 — canonical brain)

```
Generator: vps-service/jobs/v40_2_daily_generator.py (3,054 LOC)
  ↓ scheduled cron #1a (03:00 UTC = 05:00 Cairo) + cron #1b (13:30 UTC = 15:30 Cairo)
  ↓ also triggered by market_scheduler every 60 min for intraday mode

Inputs:
  • data_engine.db.egksco_price_history (latest day)
  • stocks.db.stocks + stock_daily_prices
  • price_history.db.price_history (25y history)
  • analyzers.market_regime_engine (regime = DEFENSIVE/NORMAL/AGGRESSIVE)
  • 25 analyzers dynamically imported (see §2.4)

Processing:
  • For each ticker (272 EGX-canonical):
    - Compute indicators (RSI, MACD, MA, SMFI, ATR)
    - Run V68 Oracle + V72 Multi-path + V73 Sniper + V76 Golden Hunter
    - Apply strict_entry_filters + regime_filter + news_stop_filter
    - Score with core_scoring_engine + adaptive_weights
    - Veto via expert_quality_gate
    - Generate prediction (BUY/STRONG_BUY + entry/target/stop/confidence)
    - Log rejection via stock_notebook + decision_logger

Outputs:
  • predictions.db.predictions (main predictions table)
  • predictions.db.stored_analyses (full analysis JSON per ticker)
  • predictions.db.morning_bell_signals (top pick for morning bell)
  • predictions.db.persona_predictions (per-persona variants)

Closers:
  • vps-service/jobs/daily_closer.py (3,436 LOC) — cron #3 (14:00 UTC)
    - Checks each prediction: did price hit target or stop?
    - Writes predictions.db.exit_notifications
    - Updates predictions.data_quality = 'toxic' for bad ones
  • vps-service/jobs/learning_engine.py (1,408 LOC) — cron #4 (15:00 UTC)
    - Mines predictions.db.learned_lessons from closed predictions
    - Writes predictions.db.sniper_performance

API (Python):
  • /api/prediction-tracking/* — reads predictions + outcome_logs
  • /api/ai-predictions/* — reads predictions + aiPredictionStats
  • /api/stored-analysis/* — reads stored_analyses
  • /api/market/morning-bell — reads morning_bell_signals + stored_analyses
  • /api/picks-management/* — reads predictions for daily picks

API (Next.js proxy):
  • /api/predictions/* (37 routes) — proxies + reads predictions.db directly
  • /api/mobile/predictions/continuation — for Flutter app
  • /api/stocks/[ticker]/comprehensive — reads predictions for ticker

UI:
  • src/components/predictions/PredictionTrackingView.tsx
  • src/components/predictions/PredictionTrackingDashboard.tsx
  • src/components/predictions/DualTrackPredictionsView.tsx
  • src/components/analysis/market-analysis/MorningBellSection.tsx
  • src/components/analysis/market-analysis/PredictionsTab.tsx
  • src/components/analysis/market-analysis/ExpertPredictionsTab.tsx
  • src/components/analysis/market-analysis/LiveTrackingTab.tsx
  • src/components/recommendations/AiRecommendations.tsx
  • src/components/recommendations/PublishedPredictions.tsx
```

### 7.4 Radar Signals Flow (Maker Radar + Exit Radar)

```
Generator: scripts/maker_radar.py (701 LOC)
  ↓ NOT in cron — triggered on-demand via radar-cache warmup
  ↓ (radar-cache.ts spawns `python3 scripts/maker_radar.py --json-only`)
  ↓ Triggered by: GET /api/maker-radar (if cache stale, fire-and-forget warmup)
  ↓ Triggered by: POST /api/maker-radar/warmup (synchronous)

Inputs:
  • db/production_snapshot.db (or fallback chain: data_engine.db.egksco_price_history
     → stocks.db.stock_daily_prices → data_engine.db.historical_data →
     production_snapshot.db → vps_real/stocks.db)
  • analyzers.market_regime_engine (regime-aware liquidity rules)
  • utils.shared_liquidity (detect_quiet_accumulation + detect_pre_surge + detect_life_cycle + ...)

5 detection paths:
  • A_pre_surge (Explosive Surge) — position 2%
  • B_quiet_accumulation_strong (Quiet Accumulation) — position 2%
  • C (Early Break) — position 2.5%
  • D — position 2.5%
  • E — position 2.5%

Output: scripts/output/maker_radar_<date>.json + .md

Cache status: db/radar_cache_status.json (written by radar-cache.ts)

API (Next.js):
  • /api/maker-radar (GET — reads cache instant <50ms + triggers bg warmup if stale)
  • /api/maker-radar/warmup (POST — synchronous warmup)
  • /api/maker-radar/stock/<ticker> (GET — single ticker detail)
  • /api/maker-radar/track (POST — start tracking a stock)
  • /api/maker-radar/signal-tracker/verify (POST — cron #14)
  • /api/maker-radar/timeline (GET — SignalTrackingTimeline)
  • /api/maker-radar/exit-radar (GET — Exit Radar cache)
  • /api/maker-radar/multi-market (GET — across EGX/US/CRYPTO/GOLD/TADAWUL/KSE/QSE)
  • /api/radar/weekly-report (GET — Sunday weekly report)
  • /api/radar/weekly-report/pdf (GET — PDF download)

Tracking state: db/maker_radar_tracking.json (entry_price + targets + status)

UI:
  • src/components/predictions/MakerRadarTab.tsx (rendered in MarketAnalysisView)
  • src/components/predictions/radar/ExitRadarTab.tsx
  • src/components/predictions/radar/WeeklyReportTab.tsx
  • src/components/predictions/radar/SignalTrackingTimeline.tsx
  • src/components/predictions/radar/SignalStrengthMeter.tsx
  • src/components/predictions/radar/RadarStatsCards.tsx
  • src/components/predictions/radar/MultiMarketRadarTab.tsx (orphan per FE audit)
  • src/components/predictions/radar/PersonalizedRadarTab.tsx (orphan per FE audit)
  • src/components/predictions/radar/AccuracyDashboard.tsx (orphan per FE audit)
```

### 7.5 News Flow

```
Sources:
  • Telegram channels (via Telethon in news-agent/collectors/telegram_collector.py)
  • Web scraping (news-agent/collectors/web_scraper.py + collectors/scrappers/*.py)
  • Egyptian sources (news-agent/collectors/egyptian_sources.py + mubasher_scraper.py)
  • RSS feeds (DISABLED — rss_collector.py.disabled)

Collection:
  news-agent/main.py (async agent runner)
    ↓ (every COLLECTION_INTERVAL_MINUTES=15 min, PM2 service)
    ↓
  news-agent/analyzer/news_analyzer.py + vision_analyzer.py
    ↓ analyzes with local Ollama (qwen2.5-coder:7b) + LLaVA for images
    ↓ outputs: tickers + sentiment + importance_score + arabic_summary
    ↓
  news-agent/sender/production_sender.py
    ↓ POSTs to http://localhost:3000/api/news/receive-from-news-agent

Target: stocks.db.news (or news_articles per content.db target)

API (Python):
  • /api/news (GET — list news)
  • /api/news (POST — create news)
  • /api/news/<id> (DELETE)
  • /api/news/ticker/<ticker> (GET — news for ticker)
  • /api/news/bulk (POST — bulk insert)
  • /api/news/egx (GET — EGX-specific news)
  • /api/news/agent (POST — receive from news-agent)
  • /api/news/agent/list (GET)
  • /api/news/agent/stats (GET)

API (Next.js):
  • /api/news-feed (GET — public news feed)
  • /api/news/latest (GET)
  • /api/news/ingest (POST — manual ingestion)
  • /api/news/apikeys (admin)
  • /api/admin/news/* (admin routes)

UI:
  • src/components/news/NewsFeedView.tsx
  • src/components/news-feed-widget.tsx
  • src/components/stocks/StockNews.tsx (per-ticker news)
```

### 7.6 Crypto Prices Flow

```
Source: CryptoCompare + Coinbase
  ↓
data_engine/scrapers/crypto_fetcher.py
  ↓ (via multi_market_scraper, hourly cron #18)
Target: data_engine.db.crypto_prices + btc_local_prices + crypto_price_history

Crypto Lab (predictions):
  vps-service/jobs/crypto_lab_scheduler.py (1,416 LOC)
    ↓ (every 15 min, 24/7, registered in main.py)
    ↓ Runs BTC + ETH analysis using LiveIndicatorEngine + FusionEngineV20 + SMC
  Output: predictions.db.crypto_predictions_log

API (Python):
  • /api/crypto/* (no separate crypto blueprint — handled via chart_routes + misc_routes + portfolio_routes)

API (Next.js):
  • /api/crypto/* (23 routes — all consumed by crypto components)
  • /api/crypto-lab (predictions)
  • /api/crypto-lab/predictions
  • /api/unified-crypto (unified crypto data)

UI:
  • src/components/crypto/CryptoTradingChartView.tsx
  • src/components/crypto/CryptoAdditionalViews.tsx
  • src/components/crypto/CryptoPredictionTrackingView.tsx
  • src/components/crypto/CryptoAdvancedAnalysisView.tsx
  • src/components/crypto/CryptoSimulationView.tsx
  • src/components/crypto/CryptoScreenerView.tsx
  • src/components/crypto/CryptoLearningView.tsx
  • src/components/crypto/CryptoPortfolioView.tsx
  • src/components/dashboard/CryptoSignalsWidget.tsx
```

### 7.7 Gold/Metals Flow

```
Source: GoldAPI.io + exchangerate.host
  ↓
data_engine/scrapers/metals_forex_fetcher.py (653 LOC)
  ↓ (via multi_market_scraper, hourly cron #18)
Target: data_engine.db
  • gold_prices (187K rows on prod — live)
  • gold_prices_clean (cleaned)
  • silver_prices
  • exchange_rates (forex)

API (Python):
  • /api/chart/<ticker> (gold charts)
  • /api/reports/* (gold in reports)
  • Used by analyzers/market_regime_engine.py + analyzers/reports_engine.py

API (Next.js):
  • /api/admin/currency (admin)
  • /api/alerts/gold (gold alerts)
  • /api/admin/gold-silver (admin GoldSilverTab.tsx)

UI:
  • src/components/admin/GoldSilverTab.tsx
  • src/components/dashboard/MarketPulseWidget.tsx (gold price)
  • src/components/portfolio/RealReturnPanel.tsx (gold-adjusted returns)
```

### 7.8 User Data Flow

```
Auth:
  • Next.js Auth.js (NextAuth) → auth.db (User, session, account, verification_token)
  • Prisma schema: prisma/auth-schema.prisma

API (Next.js):
  • /api/auth/login (POST)
  • /api/auth/register (POST)
  • /api/auth/google-signin (POST)
  • /api/auth/[...nextauth] (NextAuth catch-all)
  • /api/auth/profile (GET)
  • /api/auth/me (GET)
  • /api/auth/logout (POST)

Subscriptions:
  • /api/subscribe/[plan] (POST)
  • /api/paymob/create-payment (POST)
  • /api/paymob/callback (POST)
  • /api/paymob/process-wallet (POST)
  • /api/payments/result (GET)
  • /api/google-play/verify-receipt (POST)

Portfolio:
  • /api/finance/transactions (GET/POST/DELETE)
  • /api/finance/assets (GET/POST/DELETE)
  • /api/finance/obligations (GET/POST)
  • /api/finance/obligations/payments (GET/POST)
  • /api/finance/portfolio-analysis (GET)
  • /api/finance/projection (GET)
  • /api/finance/real-return (GET)
  • /api/finance/reports (GET)
  • /api/finance/schema (GET)
  • /api/finance/seed-alert-thresholds (POST)
  • /api/finance/smart-alerts (GET)
  • /api/finance/smart-confluence (GET)
  • /api/finance/smart-watchlist (GET)
  • /api/finance/screener (GET)
  • /api/finance/inflation (GET)
  • /api/finance/calculate-values (POST)

Watchlists:
  • /api/watchlist-enhanced (GET/POST)
  • stocks.db.user_stock_watchlists

UI:
  • src/components/auth/AuthView.tsx
  • src/components/auth/AuthGate.tsx
  • src/components/portfolio/EnhancedPortfolioView.tsx
  • src/components/watchlist/EnhancedWatchlistView.tsx
  • src/components/subscription/SubscriptionView.tsx
  • src/components/admin/UsersManagement.tsx + UserManagementPanel.tsx
```

### 7.9 Data Disconnects (cross-cutting)

| Disconnect | Impact | Recommendation |
|---|---|---|
| `predictions.db.persona_predictions` — no API reader | V40.2 writes persona-specific predictions but no UI shows them | Add `/api/predictions/persona/<ticker>` endpoint |
| `predictions.db.conjunction_patterns` — no API reader | `unified_learning_engine` mines patterns but no UI | Add `/api/unified-learning/conjunctions` endpoint |
| `predictions.db.exit_notifications` — no API reader | `daily_closer` writes exit notifications but no UI | Add to `/api/prediction-tracking/exit-notifications` |
| `predictions.db.indicator_trust_scores` — no API reader | `unified_learning_engine` computes but no UI | Surface in admin |
| `predictions.db.backtest_results` — no API reader | `backtest_engine` writes but only accessible via `v38_backtest_routes` | Add `/api/admin/backtest-results` (already covered partially) |
| `predictions.db.crypto_predictions_log` — only via `/api/crypto-lab/predictions` | Limited exposure | Add to admin crypto panel |
| `predictions.db.aiPredictionStats` — no API reader | AI prediction stats not surfaced | Add `/api/admin/ai-prediction-stats` |
| `data_engine.db.tab_cash_flow + tab_income_statement` — no direct API reader | Fundamentals only available via bundled comprehensive endpoint | Add `/api/fundamentals/<ticker>/<statement>` |
| `data_engine.db.crypto_intraday + commodity_intraday + intraday_meta` — no API reader | Intraday tick data not exposed | Add `/api/intraday/<ticker>` |
| `data_engine.db.macro_indicators + macro_prices` — no API reader | Macro data not surfaced | Add `/api/admin/macro` |
| `data_engine.db.screener_lists` — only via JSON file | DB table is essentially unused | Drop the table or wire the API |
| `stocks.db.market_regime_log` — no API reader | Regime history not surfaced | Add `/api/regime/log` |
| `stocks.db.tuned_predictions_summary` — no API reader | Tuned predictions not surfaced | Add `/api/admin/tuned-predictions` |
| `stocks.db.real_evaluated_predictions` — no API reader | Evaluated predictions not surfaced | Add `/api/admin/evaluated-predictions` |
| `stocks.db.stock_phase` — low use | Phase classification not surfaced | Add `/api/stocks/<ticker>/phase` |
| `auth.db.PromoCode + SubscriptionPlan` — no Python API reader | Only Prisma accesses these (Next.js side) | Acceptable — Prisma owns |
| 19 Next.js `/api/v2/*` routes unused by frontend | V2 API surface mostly dead | Audit + delete or wire |
| `/api/v4/stats` — 0 frontend callers | Dead route | Delete (SQLite fallback still works) |
| `/api/walk-forward/run` — 0 callers | Dead route | Delete |
| `/api/kimi/backtest/run` — 0 callers | Dead route | Delete |
| `/api/mubasher/sync` — 0 callers | Dead route | Delete |
| `/api/hunter/*` — only 1 caller | Mostly dead | Audit + delete most routes |
| `intraday.db` — referenced 63 times but doesn't exist on sandbox | Production only | Acceptable (sandbox limitation) |

---

## 8. Hidden Gems

### 8.1 Backend Hidden Gems (analyzers + jobs + scripts + engines)

| File | LOC | Value | Why Hidden | Recommendation |
|---|---:|---|---|---|
| `analyzers/unified_analyzer.py` | 3,736 | Comprehensive multi-asset analysis (Financial + Technical + Timing + Event + Learning) | 0 callers — listed in active set by grep but no actual `from analyzers.unified_analyzer import` | **DELETE** — superseded by `master_analyzer.py` (5,026 LOC) which is actively called. This is a stale Phase 3 prototype. |
| `analyzers/educational_cards_engine.py` | 1,560 | Generates PNG (1080×1350) + MP4 educational cards via Playwright + FFmpeg | 0 callers, not in PM2/cron | **WIRE** — should run daily at 18:30 Cairo to produce educational content for Telegram. High marketing value. |
| `analyzers/expert_memory_v4.py` | 1,013 | Personal trading memory (support/resistance + T+1 + similar cases) | 0 callers, superseded by `expert_memory_bridge.py` which IS active | **DELETE** — duplicate of `expert_memory_bridge.py` |
| `analyzers/crypto_quality_gate.py` | 1,229 | Quality gate for crypto predictions | 0 callers — crypto predictions go through `crypto_strict_filters.py` instead | **DELETE** — replaced by `crypto_strict_filters.py` (448 LOC, active in V40.2) |
| `analyzers/crypto_event_tracker.py` | 1,447 | Tracks crypto events (forks, burns, listings) | 0 callers | **AUDIT** — could be valuable for crypto prediction accuracy. Wire or delete. |
| `analyzers/crypto_analyzer.py` | 1,139 | Main crypto analyzer | 0 callers | **DELETE** — superseded by `crypto_lab_scheduler.py` (1,416 LOC, active) |
| `analyzers/social_card_generator.py` | 902 | HTML→PNG social card generator (Playwright) | 0 callers — but `educational_cards_engine.py` (orphan) + `radar_card_publisher.py` (active) both do similar things | **CONSOLIDATE** with `radar_card_publisher.py` (491 LOC, active). Pick one canonical implementation. |
| `analyzers/seasonality_engine_v2.py` | 891 | Seasonality engine v2 | 0 callers — but `seasonality_first_engine.py` (540 LOC) IS active | **DELETE** — superseded |
| `analyzers/technical_target_engine.py` | 874 | Technical target engine | 0 callers — `dynamic_target_engine.py` (1,823 LOC) IS active | **DELETE** — duplicate |
| `analyzers/dynamic_analysis_engine.py` | 849 | Dynamic analysis engine | 0 callers | **DELETE** — frontend has its own `dynamic-analysis-engine.ts` (925 LOC, also dead per FE audit) |
| `analyzers/devil_quality_gate.py` | 819 | Devil's advocate quality gate | 0 callers — Devil's Advocate UI was removed in UI-CLEANUP-MAESTRO-AI-TABS | **DELETE** — UI removed, analyzer should follow |
| `analyzers/ai_pattern_analyzer.py` | 780 | AI pattern analyzer (candlestick + chart + ML) | 0 callers | **AUDIT** — high value (ML-based pattern recognition). Wire or document why disabled. |
| `analyzers/v82_analyzer.py` | 741 | V82 multi-path analyzer | 0 callers — but V40.2 uses `v72_multi_path.py` + `v76_golden_hunter.py` | **DELETE** — superseded by v72/v76 |
| `analyzers/event_impact_tracker.py` | 735 | Event impact tracker | 0 callers | **AUDIT** — could improve prediction accuracy when calendar events hit. |
| `analyzers/crypto_confluence_engine.py` | 727 | Crypto confluence engine | 0 callers — `crypto_quality_gate.py` is also orphan | **DELETE** — crypto prediction goes through `crypto_lab_scheduler.py` |
| `analyzers/risk_adaptive.py` | 691 | Risk adaptive engine | 0 callers — `risk.py` IS active | **DELETE** — duplicate |
| `analyzers/risk_manager.py` | 690 | Risk manager | 0 callers — `risk.py` IS active | **DELETE** — duplicate |
| `analyzers/sniper_filter.py` | 672 | Sniper filter | 0 callers — `sniper_engine.py` (2,049 LOC) IS active | **DELETE** — duplicate |
| `analyzers/fundamental_enhanced.py` | 646 | Fundamental enhanced | 0 callers — `fundamental.py` IS active | **DELETE** — duplicate |
| `analyzers/expert_memory.py` | 637 | Expert memory V3 | 0 callers — replaced by `expert_memory_v4.py` (also orphan) + `expert_memory_bridge.py` (active) | **DELETE** — duplicate |
| `analyzers/news_impact_scorer.py` | 618 | News impact scorer | 0 callers — `news_fetcher_analyzer.py` (979 LOC) IS active | **DELETE** — duplicate |
| `analyzers/unified_maestro.py` | 592 | Unified maestro | 0 callers — `maestro_orchestrator.py` (4,366 LOC) IS active | **DELETE** — duplicate |
| `analyzers/dynamic_risk_engine.py` | 592 | Dynamic risk engine | 0 callers | **DELETE** — duplicate of `risk.py` |
| `analyzers/production_data_client.py` | 583 | Production data client | 0 callers — replaced by `live_price.py` (628 LOC, active) | **DELETE** — duplicate |
| `analyzers/sentiment_analyzer.py` | 577 | Sentiment analyzer | 0 callers — news-agent has its own analyzer | **DELETE** — duplicate |
| `analyzers/fundamental_scorer.py` | 567 | Fundamental scorer | 0 callers | **DELETE** — duplicate |
| `analyzers/crypto_prediction_engine.py` | 567 | Crypto prediction engine | 0 callers anywhere | **DELETE** — replaced by `crypto_lab_scheduler.py` |
| `analyzers/live_autonomous_monitor.py` | 550 | Live autonomous monitor | 0 callers anywhere | **DELETE** — superseded by `v40_2_intraday_scanner.py` |
| `analyzers/technical_weighted.py` | 527 | Technical weighted | 0 callers | **DELETE** — duplicate |
| `analyzers/unified_exit_engine.py` | 518 | Unified exit engine | 0 callers anywhere | **DELETE** — replaced by `daily_closer.py` |
| `analyzers/enhanced_indicators.py` | 515 | Enhanced indicators | 0 callers — `live_indicator_engine.py` IS active | **DELETE** — duplicate |
| `analyzers/crypto_risk.py` | 515 | Crypto risk | 0 callers anywhere | **DELETE** — `crypto_strict_filters.py` IS active |
| `analyzers/scoring_fix.py` | 507 | Scoring fix | 0 callers | **DELETE** — patch file, no longer needed |
| `analyzers/quant_cache.py` | 501 | Quant cache | 0 callers | **DELETE** — duplicate of `quant_engine.py` |
| `analyzers/candlestick.py` | 492 | Candlestick patterns | 0 callers — `candle_probability_engine.py` (498 LOC) IS active | **DELETE** — duplicate |
| `analyzers/market_manager.py` | 489 | Market manager (OOP) | 0 callers | **DELETE** — never wired |
| `analyzers/correlation_filter.py` | 484 | Correlation filter | 0 callers | **AUDIT** — could improve portfolio diversification |
| `analyzers/sector_relative.py` | 460 | Sector relative analysis | 0 callers | **AUDIT** — could surface in screener |
| `analyzers/confluence_engine.py` | 459 | Confluence engine v1 | 0 callers — `confluence_engine_v3.py` IS active | **DELETE** — legacy |
| `analyzers/dynamic_context_engine.py` | 455 | Dynamic context engine | 0 callers | **DELETE** — duplicate |
| `analyzers/crypto_maestro.py` | 452 | Crypto maestro | 0 callers | **DELETE** — duplicate |
| `analyzers/prediction_validator.py` | 448 | Prediction validator | 0 callers — `prediction_sanity.py` (orphan) + `enhanced_prediction_tracker.py` (active) cover this | **DELETE** — duplicate |
| `analyzers/seasonality_scorer.py` | 438 | Seasonality scorer | 0 callers | **DELETE** — duplicate |
| `analyzers/trend_following_analyzer.py` | 437 | Trend following analyzer | 0 callers | **DELETE** — frontend has `trend_following_paper_trading.py` |
| `analyzers/conviction_engine.py` | 433 | Conviction engine ("is NOW the right time?") | 0 callers | **WIRE** — high value: 6 factors → 0-100 score → MAX/NORMAL/SMALL/SKIP position sizing. Should be wired into V40.2 entry decisions. |
| `analyzers/crypto_mr_signal.py` | 432 | Crypto mean-reversion signal | 0 callers anywhere | **DELETE** — `crypto_mr_signal.py` is dead |
| `analyzers/crypto_short_holding_exit.py` | 412 | Crypto short-holding exit | 0 callers | **DELETE** — `short_holding_exit.py` IS active |
| `analyzers/trend_following_paper_trading.py` | 406 | Trend following paper trading | 0 callers | **DELETE** — paper trading only |
| `analyzers/quant_overdrive.py` | 381 | Quant overdrive (SMFI + Monte Carlo + Blood Filter) | 0 callers | **WIRE** — high value: SMFI (Smart Money Flow Index) + Monte Carlo probability. Should be wired into V40.2 scoring. |
| `analyzers/mean_reversion_signal.py` | 378 | Mean reversion signal | 0 callers anywhere | **AUDIT** — could complement V40.2 (which is trend-following) |
| `analyzers/fundamental_engine.py` | 372 | Fundamental engine | 0 callers | **DELETE** — `fundamental.py` IS active |
| `analyzers/technical_analyzer.py` | 371 | Technical analyzer (CLI wrapper) | 0 callers | **DELETE** — CLI tool only |
| `analyzers/fundamental_relative.py` | 362 | Fundamental relative | 0 callers | **DELETE** — duplicate |
| `analyzers/day_trading_scanner.py` | 361 | Day trading scanner | 0 callers | **AUDIT** — could surface in screener |
| `analyzers/v4_predictive_detector.py` | 346 | V4 predictive detector | 0 callers — `v68_oracle.py` + `v72_multi_path.py` + `v76_golden_hunter.py` are active | **DELETE** — superseded |
| `analyzers/dividend_checker.py` | 340 | Dividend checker | 0 callers | **WIRE** — should check dividends before BUY signals (avoid dividend capture traps) |
| `analyzers/volume_profile.py` | 337 | Volume profile | 0 callers | **AUDIT** — high value: institutional accumulation detection |
| `analyzers/session_timing.py` | 327 | Session timing | 0 callers | **DELETE** — `timing.py` IS active |
| `analyzers/market_regime_detector.py` | 322 | Market regime detector (legacy) | 0 callers — `market_regime_engine.py` (1,340 LOC) IS active | **DELETE** — duplicate |
| `analyzers/explosive_uncap_engine.py` | 272 | Explosive uncap engine | 0 callers | **AUDIT** — could improve explosive scanner |
| `analyzers/crypto_regime.py` | 268 | Crypto regime | 0 callers | **DELETE** — `market_regime_engine.py` handles multi-market |
| `analyzers/ai_sentiment.py` | 261 | AI sentiment | 0 callers — news-agent has its own analyzer | **DELETE** — duplicate |
| `analyzers/crypto_circuit.py` | 260 | Crypto circuit breaker | 0 callers | **AUDIT** — could prevent losses during crypto crashes |
| `analyzers/base_engine.py` | 199 | Base engine class | 0 callers | **DELETE** — pattern not adopted |
| `analyzers/prediction_sanity.py` | 181 | Prediction sanity gate (hard limits) | 0 callers anywhere | **WIRE** — high value: enforces MAX_PREDICTIONS_PER_DAY=5, R_R_MAX=10.0, TARGET_MAX_PERCENT=50.0, MIN_PRICE=1.0, RSI must be calculated, etc. Should run BEFORE writing to predictions.db. |
| `analyzers/macro_veto.py` | 180 | Macro veto (USD + interest rate) | 0 callers anywhere | **WIRE** — high value: vetoes import sectors when USD rises, boosts export sectors, etc. Should be wired into V40.2 as a hard veto. |
| `analyzers/egx_arabic_lookup.py` | 159 | EGX Arabic lookup | 0 callers — duplicates in `telegram/egx_arabic_lookup.py` + `data/egx_arabic_lookup.py` | **CONSOLIDATE** — pick one canonical location |
| `analyzers/indicator_trust_scores.py` | 147 | Indicator trust scores | 0 callers | **WIRE** — high value: dynamically weights indicators by historical accuracy |
| `analyzers/trade_level_validator.py` | 0 | Empty file | DEAD | **DELETE** |

#### Backend hidden gems summary

| Action | Count | Total LOC |
|---|---:|---:|
| DELETE (clearly superseded) | 38 | ~21,000 |
| WIRE (high value, should be activated) | 7 | ~3,600 |
| AUDIT (unclear, needs human review) | 9 | ~3,800 |
| CONSOLIDATE (duplicates) | 2 | ~1,000 |
| **Total reclaimable via DELETE** | **38** | **~21,000 LOC** |
| **Total high-value WIRE candidates** | **7** | **~3,600 LOC** |

### 8.2 Engine Hidden Gems (`engine/` + `engines/`)

| File | LOC | Value | Why Hidden | Recommendation |
|---|---:|---|---|---|
| `engines/master_backfill_adapter.py` | 314 | Adapter between `historical_prediction_generator` and `MasterAnalyzer` (uses V20 Fusion + Dip Buying instead of legacy SmartConfluenceEngine) | 0 callers — `historical_prediction_generator.py` (536 LOC) also has 0 callers | **DELETE** both — backfill pipeline is dead |
| `engine/live_prediction_engine.py` | 468 | Live prediction engine (5-step pipeline: fetch live prices → compute indicators → flow score → explosive score → generate BUY/STRONG_BUY) | 0 callers | **DELETE** — superseded by V40.2 + intraday scanner |
| `engines/historical_prediction_generator.py` | 536 | Multi-market historical prediction generator (2-7 analyses/day per market, 1-month monitoring) | 0 callers | **DELETE** — replaced by V40.2 |
| `engine/crypto_full_system.py` | 589 | Full crypto system (scanner + analyzer + predictor) | 0 callers | **DELETE** — replaced by `crypto_lab_scheduler.py` |
| `engines/smart_confluence_engine.py` | 742 | Smart confluence engine (Stage2 + VCP + Donchian + ATR risk) | Used by `sniper_engine.py` (orphan-imports it) + `master_backfill_adapter.py` (orphan) + `test_smart_confluence.py` (test only) | **AUDIT** — may still be valuable, but `glminvestment_engines/` package provides newer implementations |
| `engines/market_regime.py` | 556 | Market regime engine (Minervini Stage 1-4 detection) | 5 callers (maestro_orchestrator + market_scheduler + smart_confluence_engine + glminvestment_engines/confluence + scripts/production_backtest_tf) | **CONSOLIDATE** with `analyzers/market_regime_engine.py` (1,340 LOC) — both are called `MarketRegimeEngine` |
| `engine/persona_engine.py` | 972 | Persona engine | 1 caller (test) | **AUDIT** — `persona_investor.py` + `persona_gambler.py` + `persona_screener.py` all active |
| `engine/paper_trade_tracker.py` | 1,159 | Paper trade tracker | 1 caller (`scripts/paper_trading.py`) | **AUDIT** — paper trading UI was removed in UI-CLEANUP |
| `engine/explosive_scanner.py` | 688 | Explosive scanner | 2 callers (`chart_routes.py` + `engine/master_backfill_adapter.py`) | **ACTIVE** |
| `engine/historical_backfill_engine.py` | 1,240 | Historical backfill engine | 2 callers | **ACTIVE** |
| `engine/crypto_engine.py` | 395 | Crypto engine | 2 callers | **ACTIVE** |
| `engine/stock_fundamentals.py` | 645 | Stock fundamentals | 7 callers | **ACTIVE** |
| `engine/flow_system.py` | 1,079 | Flow system | 9 callers | **ACTIVE** |
| `engines/v38_backtest_engine.py` | 2,224 | V38 institutional backtest engine | 18 callers (most-imported engine) | **ACTIVE** |

#### Engine summary

| Action | Count | Total LOC |
|---|---:|---:|
| DELETE (clearly dead) | 4 | ~1,900 |
| AUDIT (unclear) | 2 | ~1,700 |
| CONSOLIDATE (duplicates) | 1 | ~556 |
| ACTIVE (keep) | 6 | ~7,000 |

### 8.3 Job Hidden Gems (`vps-service/jobs/`)

| File | LOC | Value | Why Hidden | Recommendation |
|---|---:|---|---|---|
| `jobs/hot_candidate_detector.py` | 299 | Intraday maker activity detector (reads `stock_intraday`, computes volume surge + delta + absorption) | 0 callers, not in cron | **WIRE** — should run every 5 min during market hours, before V40.2 intraday scanner. |
| `jobs/fetch_earnings_calendar.py` | 244 | Weekly earnings + dividends from TradingView | 0 callers, not in cron | **WIRE** — schedule weekly Sunday (`0 6 * * 0`) |
| `jobs/daily_gainer_scan.py` | 186 | Daily post-close: top 10 gainers analysis ("did we catch them?") | 0 callers, not in cron | **WIRE** — schedule after daily_closer (`30 14 * * 0-4`) |
| `jobs/price_history_stale_monitor.py` | 182 | Detects stale price history | ACTIVE via market_scheduler (3 triggers) | Keep |
| `jobs/market_scheduler.py` | 2,751 | Central market scheduler | ACTIVE via main.py | Keep |
| `jobs/v40_2_daily_generator.py` | 3,054 | V40.2 brain | ACTIVE via cron | Keep |
| `jobs/v40_2_intraday_scanner.py` | 413 | V40.2 intraday | ACTIVE via cron | Keep |
| `jobs/daily_closer.py` | 3,436 | Daily closer | ACTIVE via cron | Keep |
| `jobs/learning_engine.py` | 1,408 | Learning engine | ACTIVE via cron | Keep |
| `jobs/wal_checkpoint.py` | 341 | WAL checkpoint | ACTIVE via main.py (hourly) | Keep |
| `jobs/crypto_lab_scheduler.py` | 1,416 | Crypto lab | ACTIVE via main.py (15min) | Keep |
| `jobs/price_history_safetynet.py` | 425 | Yahoo fallback | ACTIVE via cron | Keep |
| `jobs/fetch_corporate_actions.py` | 292 | Corporate actions | ACTIVE via cron | Keep |
| `jobs/fetch_inflation_worldbank.py` | 243 | Inflation fetcher | ACTIVE via market_scheduler | Keep |
| `jobs/intraday_aggregator.py` | 377 | Intraday → daily aggregator | ACTIVE via market_scheduler | Keep |
| `jobs/daily_portfolio_yield.py` | 256 | Portfolio yield | ACTIVE via market_scheduler | Keep |
| `jobs/fetch_earnings_calendar.py` | 244 | Earnings calendar | ORPHAN — see above | Wire |

### 8.4 Scripts Hidden Gems (`scripts/` root)

| File | LOC | Value | Why Hidden | Recommendation |
|---|---:|---|---|---|
| `scripts/mine_learned_lessons.py` | 691 | Mines `learned_lessons` from `aiPrediction` table — extracts 5 lesson types (direct specific, direct sector, environmental sector, environmental general, pattern general) with confidence adjustments + expiry dates | 0 cron entries | **WIRE** — should run weekly Sunday to keep `learned_lessons` fresh |
| `scripts/exit_policy_optimizer.py` | 597 | Compares 4 exit policies on real V40.2 explosive stocks — PROVEN that Policy D (trend-follow, 90-day window) turns +6.2% → +13.28% avg win | 0 cron entries | **WIRE** — should run monthly to validate current exit policy |
| `scripts/post_market_feedback.py` | 372 | Sends Telegram alert when ≥80% of BUY signals hit SL on a given day | 0 cron entries | **WIRE** — should run daily after daily_closer (`45 14 * * 0-4`) |
| `scripts/data_hygiene_cron.py` | 421 | Comprehensive data hygiene checks (duplicate detection, stale data, schema validation) | 0 cron entries | **WIRE** — should run weekly Sunday |
| `scripts/delta_volume_calculator.py` | 360 | Calculates delta volume (buy volume - sell volume) for each stock | 0 cron entries | **WIRE** — should run daily after price update |
| `scripts/maker_radar.py` | 701 | Maker Radar generator (5 detection paths) | Not in cron — triggered by `radar-cache.ts` warmup | **WIRE** — should be in cron every 15 min during market hours (currently triggered on-demand by frontend) |
| `scripts/exit_radar.py` | 657 | Exit Radar generator (mirror of maker_radar for exits) | Not in cron — triggered by frontend warmup | **WIRE** — should be in cron every 15 min during market hours |
| `scripts/diagnose_explosive_rejections_v2.py` | 548 | Diagnoses why explosive stocks were rejected by V40.2 | 0 cron entries | **KEEP** — diagnostic, run manually |
| `scripts/diagnose_liquidity_rejections.py` | 484 | Diagnoses liquidity rejections | 0 cron entries | **KEEP** — diagnostic |
| `scripts/diagnose_production_state.py` | 438 | Diagnoses production state | 0 cron entries | **KEEP** — diagnostic |
| `scripts/diagnose_v402_filters.py` | 210 | Diagnoses V40.2 filter rejections | 0 cron entries | **KEEP** — diagnostic |
| `scripts/audit-db-schema.ts` | 242 | Audits DB schemas (crypto.db + custom.db) — **references `crypto.db` which doesn't exist** | 0 cron entries | **FIX** — script references stale DB paths |
| `scripts/check-db-integrity.ts` | — | Checks integrity of all DBs | 0 cron entries | **WIRE** — should run daily |
| `scripts/exit_policy_simulation.py` | 390 | Simulates exit policies (the basis for `exit_policy_optimizer.py`) | 0 cron entries | **KEEP** — research |

### 8.5 Telegram Hidden Gems (`vps-service/telegram/`)

| File | LOC | Value | Why Hidden | Recommendation |
|---|---:|---|---|---|
| `telegram/telegram_marketing_engine.py` | 225 | Comprehensive marketing engine orchestrating 6 features: Interactive Bot + Morning Bell + Intraday Alerts + Closing Scorecard + Breaking News + Daily Lessons | 0 callers, not in PM2/cron | **WIRE** — would replace 6 separate publishers (`telegram_interactive_bot` + `telegram_morning_bell` + `telegram_intraday_alerts` + `telegram_closing_scorecard` + `telegram_breaking_news` + `telegram_daily_lessons`). All 6 are orphans individually. |
| `telegram/telegram_target_hit_tracker.py` | 1,012 | Tracks when predictions hit their targets and sends Telegram alerts | 0 direct callers (referenced by `auto_post_scheduler.py` + `telegram_market_analysis.py` + `telegram_marketing_engine.py` — all of which are themselves low-use) | **WIRE** — high value: should fire alerts when predictions hit T1/T2/SL |
| `telegram/telegram_breaking_news.py` | 742 | Breaking news alerts (every 2 min) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_interactive_bot.py` | 686 | Interactive Telegram bot (responds to user queries with charts + radar levels) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_news_scraper.py` | 617 | Telegram channel news scraper | 0 direct callers | **AUDIT** — news-agent has its own telegram_collector |
| `telegram/telegram_daily_lessons.py` | 499 | Daily educational lessons (18:30 Cairo) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_chart_generator.py` | 495 | Generates charts (PNG via matplotlib) | 0 direct callers | **WIRE** — used by intraday_alerts + closing_scorecard |
| `telegram/radar_card_publisher.py` | 491 | Publishes radar cards (PNG) to Telegram | 0 callers — `auto_post_scheduler.py` doesn't call it | **WIRE** — should be called by auto_post_scheduler after maker_radar warmup |
| `telegram/telegram_morning_bell.py` | 489 | Morning bell alerts (08:30 Cairo) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_report_card.py` | 458 | Report card generator | 0 direct callers | **AUDIT** |
| `telegram/telegram_intraday_alerts.py` | 453 | Intraday breakout alerts (every 5 min during market) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_closing_scorecard.py` | 446 | Closing scorecard (15:00 Cairo) | 0 direct callers (referenced by `telegram_marketing_engine.py` only) | **WIRE via marketing_engine** |
| `telegram/telegram_market_analysis.py` | 356 | Market analysis publisher | 0 direct callers (references `telegram_target_hit_tracker.py`) | **AUDIT** |
| `telegram/telegram_sectors_report.py` | 321 | Sectors report | 0 direct callers | **AUDIT** |
| `telegram/screener_blast.py` | 313 | Screener blast (top opportunities) | 0 direct callers | **WIRE** — should run after screener refresh |
| `telegram/telegram_radar_notifier.py` | 277 | Radar notifier | 0 direct callers | **AUDIT** |
| `telegram/telegram_marketing_engine.py` | 225 | (see above) | — | — |
| `telegram/telegram_branding.py` | 215 | Branding helpers (logos + colors + footer) | 0 direct callers | **KEEP** — utility |
| `telegram/egx_arabic_lookup.py` | 159 | EGX Arabic lookup (duplicate of `analyzers/egx_arabic_lookup.py` + `data/egx_arabic_lookup.py`) | 0 callers | **DELETE** — duplicate |
| `telegram/patch_auto_poster.py` | 133 | Patch script for auto_poster | 0 callers | **DELETE** — one-off patch |

#### Telegram hidden gems summary

| Action | Count | Total LOC |
|---|---:|---:|
| WIRE (via marketing_engine) | 6 | ~3,400 |
| WIRE (standalone) | 2 | ~1,500 |
| DELETE (duplicate) | 2 | ~300 |
| KEEP / AUDIT | 7 | ~2,100 |
| **Total reclaimable via consolidation** | **6→1** | **~3,400 LOC → ~225 LOC** |

### 8.6 Data Hidden Gems

| Table | DB | Rows (prod) | Value | Why Hidden | Recommendation |
|---|---|---:|---|---|---|
| `persona_predictions` | predictions.db | ? | Persona-specific predictions (gambler vs conservative vs balanced) | V40.2 writes them but no API/UI reads them | **WIRE** — add `/api/predictions/persona/<ticker>` |
| `conjunction_patterns` | predictions.db | ? | Indicator conjunction patterns (which indicators fire together) | `unified_learning_engine` writes but no API | **WIRE** — surface in admin |
| `indicator_trust_scores` | predictions.db | ? | Trust scores per indicator (which indicators are reliable) | `unified_learning_engine` writes but no API | **WIRE** — surface in admin + use in V40.2 scoring |
| `exit_notifications` | predictions.db | ? | Exit notifications (when predictions closed) | `daily_closer` writes but no API | **WIRE** — surface in prediction tracking |
| `morning_bell_signals` | predictions.db | ? | Morning bell signals (top pick per day) | `v40_2_daily_generator` writes; consumed by `/api/market/morning-bell` | ✅ ACTIVE |
| `learned_lessons` | predictions.db | 19,464 | AI-mined lessons from past predictions | `learning_engine` writes; consumed by `/api/unified-learning/*` | ✅ ACTIVE (since P1-GEMS-WIRING) |
| `historical_trades` | predictions.db | 13,117 | Historical closed trades | `historical_backfill_engine` writes; consumed by `/api/predictions/historical-trades` | ✅ ACTIVE (since P1-GEMS-WIRING) |
| `backtest_results` | predictions.db | ? | Backtest results | `backtest_engine` writes; only `/api/v38-backtest/results` exposes V38 results | **WIRE** — add `/api/admin/backtest-results` |
| `aiPredictionStats` | predictions.db | ? | AI prediction statistics | `ai/` modules write but no API | **WIRE** — surface in admin |
| `tab_cash_flow + tab_income_statement` | data_engine.db | ? | Fundamentals: cash flow + income statement | `egx_fundamental_fetcher` writes; only via bundled `/api/stocks/<ticker>/comprehensive` | **WIRE** — add `/api/fundamentals/<ticker>/<statement>` |
| `tab_performance + tab_profitability + tab_technical_analysis + tab_valuation` | data_engine.db | ? | Fundamentals | Same as above | **WIRE** — add granular endpoints |
| `crypto_intraday + commodity_intraday + intraday_meta` | stocks.db (or intraday.db) | ? | Intraday tick data | `intraday_storage` writes but no API | **WIRE** — add `/api/intraday/<ticker>` |
| `macro_indicators + macro_prices` | data_engine.db | ? | Macro data (inflation + interest rates) | `fetch_inflation_worldbank` writes; only `macro_veto.py` (orphan) reads | **WIRE** — surface in admin + wire macro_veto |
| `market_regime_log` | stocks.db | ? | Regime change history | `market_regime_engine` writes but no API | **WIRE** — add `/api/regime/log` |
| `tuned_predictions_summary` | stocks.db | ? | Tuned predictions | `prediction_optimizer` writes but no API | **WIRE** — add `/api/admin/tuned-predictions` |
| `real_evaluated_predictions` | stocks.db | ? | Evaluated predictions | `evaluate_predictions.py` (tool) writes but no API | **WIRE** — add `/api/admin/evaluated-predictions` |
| `stock_phase` | stocks.db | ? | Minervini phase (1-4) per stock | `engines/market_regime.py` writes but no API | **WIRE** — add `/api/stocks/<ticker>/phase` |
| `screener_lists` table | data_engine.db | ? | Screener lists (also cached as JSON in `db/screener_lists.json`) | TV scraper writes but only JSON file is consumed | **DROP TABLE** — keep JSON file as canonical |
| `cryptos + crypto_metrics + crypto_price_history` | data_engine.db | ? | Crypto metadata + metrics + history | `crypto_fetcher` writes but no direct API (only via bundled endpoints) | **WIRE** — add `/api/crypto/metadata` |

### 8.7 Algorithm Hidden Gems

| Function / Module | File | LOC | Value | Recommendation |
|---|---|---:|---|---|
| `SMFI` (Smart Money Flow Index) | `analyzers/quant_overdrive.py` | ~50 | Calculates (Volume on Green Candles - Volume on Red Candles) / Total Volume — surfaces whale accumulation invisible to humans | **WIRE** — should be a scoring factor in V40.2 |
| `Monte Carlo probability simulation` | `analyzers/quant_overdrive.py` | ~80 | Bootstrap simulation of 500 price paths over 5 days, returns probability of hitting target | **WIRE** — should replace current static confidence calculation |
| `Blood Filter` (turnover < 3M EGP/day = REJECTED) | `analyzers/quant_overdrive.py` | ~10 | Already in `liquidity_filter.py` but quant_overdrive has a cleaner implementation | **KEEP** in liquidity_filter |
| `Conviction Score` (6 factors → 0-100) | `analyzers/conviction_engine.py` | 433 | Measures "is NOW the right time to enter?" — independent of Master Score | **WIRE** — should be a V40.2 entry decision |
| `Macro Veto` (USD/interest rate aware) | `analyzers/macro_veto.py` | 180 | Vetoes import sectors when USD rises, boosts export sectors | **WIRE** — should be hard veto in V40.2 |
| `Prediction Sanity Gate` (hard limits) | `analyzers/prediction_sanity.py` | 181 | Enforces MAX_PREDICTIONS_PER_DAY=5, R_R_MAX=10.0, TARGET_MAX_PERCENT=50.0, MIN_PRICE=1.0 | **WIRE** — should run before writing to predictions.db |
| `Volume Profile` (institutional accumulation) | `analyzers/volume_profile.py` | 337 | Detects institutional accumulation via volume profile analysis | **AUDIT** — could improve V40.2 |
| `Indicator Trust Scores` (dynamic weighting) | `analyzers/indicator_trust_scores.py` | 147 | Dynamically weights indicators by historical accuracy | **WIRE** — should be used by `adaptive_weights.py` (which IS active) |
| `VCP Detector` (Volatility Contraction Pattern) | `glminvestment_engines/engines/vcp_detector.py` | 337 | Mark Minervini's VCP — detects pre-breakout contractions | **ACTIVE** — already used by `maestro_orchestrator.py` |
| `Donchian Breakout` (Turtle Traders) | `glminvestment_engines/engines/donchian_breakout.py` | 224 | Classic trend-following system | **ACTIVE** — used by `maestro_orchestrator.py` |
| `ATR Risk Engine` | `glminvestment_engines/engines/atr_risk_engine.py` | 264 | Dynamic ATR-based stop loss | **ACTIVE** — used by `expert_quality_gate.py` |
| `Stage 2 Filter` (Minervini) | `glminvestment_engines/engines/stage2_filter.py` | 266 | Filters to Stage 2 (bull market) stocks only | **ACTIVE** — used by `expert_quality_gate.py` |
| `Take Profit Tiers` | `glminvestment_engines/engines/take_profit_tiers.py` | 265 | Multi-tier take profit (1R, 2R, 3R) | **ACTIVE** — used by `expert_quality_gate.py` |
| `Confluence Scorer` | `glminvestment_engines/confluence/confluence_scorer.py` | 496 | Scores confluence of multiple engines | **ACTIVE** — used by `expert_quality_gate.py` |
| `Strategy Backtester` | `glminvestment_engines/backtest/strategy_backtester.py` | 638 | Generic backtesting framework | **AUDIT** — could replace ad-hoc backtest scripts |
| `Exit Policy Optimizer` | `scripts/exit_policy_optimizer.py` | 597 | Compares 4 exit policies (Production, Backtest, Proposed, Aggressive Trend-Follow) | **WIRE** — should run monthly |
| `Mine Learned Lessons` (5 lesson types) | `scripts/mine_learned_lessons.py` | 691 | Extracts direct/specific/sector/general/pattern lessons with confidence adjustments + expiry dates | **WIRE** — should run weekly |
| `Honest Backtest Engine` | `analyzers/real_backtester.py` | 466 | Rigorous trade re-simulation against real price data | **AUDIT** — used by `evaluate_predictions.py` tool |
| `Real Return Engine` (gold-adjusted returns) | `analyzers/real_return_engine.py` | 463 | Calculates real returns adjusted for gold/USD | **ACTIVE** — used by `/api/finance/real-return` |

### 8.8 Hidden gems summary stats

| Category | Total candidates | DELETE | WIRE | AUDIT | CONSOLIDATE |
|---|---:|---:|---:|---:|---:|
| Analyzers | 68 orphans | 38 | 7 | 9 | 2 |
| Engines | 6 | 4 | 0 | 2 | 1 |
| Jobs | 3 orphans | 0 | 3 | 0 | 0 |
| Scripts (high-value) | 14 | 0 | 7 | 6 | 0 |
| Telegram modules | 19 orphans | 2 | 8 | 7 | 2 |
| Data tables | ~16 | 0 | 16 | 0 | 0 |
| Algorithm functions | ~17 | 0 | 7 | 4 | 0 (rest already active) |
| **TOTAL** | **143** | **44** | **48** | **28** | **5** |

**Total reclaimable LOC via DELETE: ~24,000** (38 analyzers + 4 engines + 2 telegram = ~21,000 + 3,000)
**Total high-value LOC to WIRE: ~10,000** (7 analyzers + 3 jobs + 7 scripts + 8 telegram + 16 data tables + 7 algorithms)

---

## 9. Module Architecture Proposal (Backend)

### 9.1 Current state (scattered, ad-hoc)

The current `vps-service/` has 14 top-level subdirectories with overlapping responsibilities:
- `analyzers/` (148 files) — too broad, mixes stock/crypto/fundamental/technical/regime/persona
- `engine/` + `engines/` — two directories with similar names, 16 files total, confusing
- `data/` (16 files) — fetchers, but scrapers live in `data_engine/scrapers/`
- `core/` (18 files) — shared infra (DB, scheduler, auth, migrator)
- `api/` (38 files) — Flask blueprints
- `jobs/` (17 files) — scheduled jobs
- `telegram/` (26 files) — Telegram publishers
- `ai/` (17 files) — AI agent + analyzers
- `portfolio/` (9 files) — portfolio management
- `strategies_merge/` (7 files) — only used by archived backtests
- `glminvestment_engines/` (20 files) — Minervini engines (VCP, Donchian, Stage2, ATR)
- `tools/` (8 files) — admin CLI
- `utils/` (15 files) — shared utilities
- `scripts/` (104 files) — internal admin scripts

### 9.2 Proposed module structure

```
vps-service/
├── modules/
│   ├── stock-analysis/           # Stock analysis (single-stock focus)
│   │   ├── analyzers/
│   │   │   ├── technical.py             # active
│   │   │   ├── fundamental.py           # active
│   │   │   ├── fundamental_data_provider.py  # active
│   │   │   ├── master_analyzer.py       # active (5,026 LOC)
│   │   │   ├── maestro_orchestrator.py  # active (4,366 LOC)
│   │   │   ├── background_analyzer.py   # active (2,725 LOC)
│   │   │   ├── core_scoring_engine.py  # active (2,548 LOC)
│   │   │   ├── support_resistance_calculator.py  # active
│   │   │   ├── stock_dna_analyzer.py    # active
│   │   │   ├── stock_notebook.py        # active
│   │   │   ├── live_indicator_engine.py # active
│   │   │   ├── multi_timeframe_engine.py  # active
│   │   │   ├── flow_system.py           # active (1,079 LOC, moved from engine/)
│   │   │   ├── smc_engine.py            # active
│   │   │   ├── patterns.py              # active
│   │   │   ├── candle_probability_engine.py  # active
│   │   │   ├── enhanced_indicators.py  # DELETE (duplicate)
│   │   │   ├── technical_analyzer.py   # DELETE (CLI wrapper only)
│   │   │   ├── technical_weighted.py   # DELETE (duplicate)
│   │   │   ├── technical_target_engine.py  # DELETE (duplicate)
│   │   │   ├── candlestick.py           # DELETE (duplicate)
│   │   │   ├── unified_analyzer.py     # DELETE (3,736 LOC orphan)
│   │   │   └── dynamic_analysis_engine.py  # DELETE (orphan)
│   │   ├── engines/
│   │   │   ├── hunting_engine.py       # active
│   │   │   ├── explosive_scanner.py    # active (moved from engine/)
│   │   │   ├── explosive_uncap_engine.py  # AUDIT
│   │   │   ├── sniper_engine.py        # active (2,049 LOC)
│   │   │   ├── v68_oracle.py           # active
│   │   │   ├── v72_multi_path.py       # active
│   │   │   ├── v73_sniper.py           # active
│   │   │   ├── v76_golden_hunter.py    # active
│   │   │   ├── v82_analyzer.py         # DELETE (superseded)
│   │   │   ├── v4_predictive_detector.py  # DELETE (superseded)
│   │   │   ├── confluence_engine_v3.py  # active
│   │   │   ├── confluence_engine.py    # DELETE (legacy v1)
│   │   │   ├── smart_confluence_engine.py  # CONSOLIDATE (move from engines/)
│   │   │   ├── expert_quality_gate.py  # active
│   │   │   ├── expert_memory_bridge.py # active
│   │   │   ├── expert_memory.py        # DELETE (legacy V3)
│   │   │   ├── expert_memory_v4.py     # DELETE (orphan)
│   │   │   ├── conviction_engine.py    # WIRE (high value)
│   │   │   ├── confidence_engine.py    # active
│   │   │   ├── adaptive_weights.py     # active
│   │   │   ├── indicator_trust_scores.py  # WIRE
│   │   │   ├── quant_engine.py         # active
│   │   │   ├── quant_overdrive.py      # WIRE (SMFI + Monte Carlo)
│   │   │   ├── quant_cache.py          # DELETE (orphan)
│   │   │   ├── volume_profile.py       # AUDIT
│   │   │   ├── fair_value_calculator.py  # active
│   │   │   ├── real_backtester.py     # active
│   │   │   ├── backtest_engine.py      # active
│   │   │   ├── scoring_fix.py          # DELETE (patch file)
│   │   │   ├── decision_logger.py      # active
│   │   │   ├── stock_notebook.py       # active (already listed)
│   │   │   └── narrative_generator.py  # active
│   │   ├── data/
│   │   │   ├── egx_fetcher.py          # active
│   │   │   ├── egx_stocks_complete.py  # active
│   │   │   ├── egx_official_sectors.py # active
│   │   │   ├── egx_ticker_sector_map.py  # active
│   │   │   ├── egx_arabic_lookup.py    # CONSOLIDATE (3 duplicates → 1)
│   │   │   ├── egx_fundamental_fetcher.py  # active
│   │   │   ├── egksco_scraper.py       # CONSOLIDATE (duplicate in data_engine)
│   │   │   ├── analyses.py             # active
│   │   │   ├── prices.py               # active
│   │   │   ├── eodhd_fetcher.py         # active
│   │   │   ├── enhanced_multi_market.py  # AUDIT
│   │   │   ├── gap_filler.py           # AUDIT
│   │   │   ├── multi_market_fetcher.py # DELETE (replaced by data_engine/scrapers/)
│   │   │   ├── us_stocks_fetcher.py    # DELETE (replaced by data_engine/scrapers/)
│   │   │   └── crypto_fetcher.py       # AUDIT (lightweight version)
│   │   └── api/
│   │       ├── chart_routes.py         # active (3,547 LOC)
│   │       ├── stock_analysis_routes.py  # active
│   │       ├── professional_analysis_routes.py  # active
│   │       ├── stored_analysis_routes.py  # active
│   │       ├── stocks.py               # active
│   │       ├── advanced_screener_routes.py  # active
│   │       ├── screener_routes.py      # active
│   │       ├── top_performers_routes.py  # active
│   │       ├── sector_tracking_routes.py  # active
│   │       ├── scanner_routes.py       # active
│   │       ├── notebook_routes.py      # active
│   │       └── public_routes.py        # active
│   │
│   ├── predictions/              # V40.2 + closers + learning
│   │   ├── generators/
│   │   │   ├── v40_2_daily_generator.py  # active (3,054 LOC)
│   │   │   ├── v40_2_intraday_scanner.py  # active
│   │   │   ├── historical_predictions_v2_routes.py  # active
│   │   │   ├── historical_prediction_generator.py  # DELETE (orphan)
│   │   │   ├── master_backfill_adapter.py  # DELETE (orphan)
│   │   │   └── live_prediction_engine.py  # DELETE (orphan)
│   │   ├── closers/
│   │   │   ├── daily_closer.py         # active (3,436 LOC)
│   │   │   ├── short_holding_exit.py   # active
│   │   │   ├── unified_exit_engine.py  # DELETE (orphan)
│   │   │   ├── crypto_short_holding_exit.py  # DELETE (orphan)
│   │   │   └── exit_policy_optimizer.py  # WIRE (move from scripts/)
│   │   ├── learning/
│   │   │   ├── learning_engine.py      # active (1,408 LOC)
│   │   │   ├── unified_learning_engine.py  # active (1,371 LOC)
│   │   │   ├── mine_learned_lessons.py # WIRE (move from scripts/)
│   │   │   ├── feedback_loop.py        # active
│   │   │   ├── learning_file_storage.py  # active
│   │   │   ├── lesson_store.py        # active (from utils/)
│   │   │   ├── win_lesson_store.py    # active (from utils/)
│   │   │   ├── prediction_tracker.py   # active
│   │   │   ├── enhanced_prediction_tracker.py  # active
│   │   │   ├── prediction_optimizer.py  # active
│   │   │   ├── prediction_validator.py  # DELETE (orphan)
│   │   │   ├── prediction_sanity.py   # WIRE (high value)
│   │   │   ├── expert_memory.py        # DELETE (legacy)
│   │   │   ├── expert_memory_v4.py     # DELETE (orphan)
│   │   │   └── expert_memory_bridge.py  # active (move from engines/)
│   │   └── api/
│   │       ├── prediction_tracking_routes.py  # active
│   │       ├── ai_predictions_routes.py  # active
│   │       ├── picks_management_routes.py  # active
│   │       ├── learning_routes.py      # active
│   │       ├── unified_learning_routes.py  # active
│   │       ├── optimizer_params_routes.py  # active
│   │       └── v38_backtest_routes.py  # active
│   │
│   ├── radar/                    # Maker Radar + Exit Radar + Signal Tracker
│   │   ├── analyzers/
│   │   │   ├── liquidity_filter.py     # active (1,101 LOC)
│   │   │   ├── shared_liquidity.py     # active (from utils/)
│   │   │   ├── strict_entry_filters.py  # active
│   │   │   ├── regime_filter.py        # active
│   │   │   ├── news_stop_filter.py     # active
│   │   │   ├── bag_holder_rescue.py    # active
│   │   │   ├── hot_candidate_detector.py  # WIRE (from jobs/)
│   │   │   ├── day_trading_scanner.py  # AUDIT
│   │   │   └── intraday_reader.py      # active
│   │   ├── generators/
│   │   │   ├── maker_radar.py          # WIRE (move from scripts/)
│   │   │   ├── exit_radar.py           # WIRE (move from scripts/)
│   │   │   └── weekly_radar_report.py  # active (move from scripts/)
│   │   ├── trackers/
│   │   │   ├── signal_tracker.py       # active (Next.js /api/maker-radar/signal-tracker)
│   │   │   └── target_hit_tracker.py   # WIRE (from telegram/)
│   │   └── api/  (Next.js side, see frontend audit)
│   │
│   ├── market-data/              # Scrapers + data_engine
│   │   ├── scrapers/                   # MOVED from data_engine/scrapers/
│   │   │   ├── tradingview_scraper.py  # active
│   │   │   ├── yahoo_scraper.py        # active (fallback)
│   │   │   ├── us_stock_scraper.py     # active
│   │   │   ├── multi_market_scraper.py # active
│   │   │   ├── crypto_fetcher.py       # active
│   │   │   ├── metals_forex_fetcher.py # active
│   │   │   ├── news_scraper.py         # AUDIT
│   │   │   ├── historical_fetcher.py   # active
│   │   │   ├── historical_fetcher_5years.py  # DELETE (orphan)
│   │   │   ├── egksco_scraper.py       # CONSOLIDATE (with vps-service/data/)
│   │   │   ├── egxpilot_scraper.py     # DELETE (orphan)
│   │   │   ├── tradingview_rest.py     # AUDIT
│   │   │   ├── tradingview_market_movers.py  # DELETE (orphan)
│   │   │   ├── tradingview_screener_lists.py  # active
│   │   │   ├── fallback_chain.py       # active
│   │   │   ├── technical_fetcher.py    # DELETE (orphan)
│   │   │   ├── smart_scheduler.py      # DELETE (orphan)
│   │   │   ├── auto_refresh_scheduler.py  # DELETE (orphan)
│   │   │   ├── fetch_logos.py          # DELETE (orphan)
│   │   │   └── metals_forex_fetcher.py.original  # DELETE (backup file)
│   │   ├── storage/
│   │   │   ├── intraday_storage.py     # active (1,122 LOC)
│   │   │   ├── sync.py                 # active (774 LOC)
│   │   │   └── realtime_sync.py        # active
│   │   ├── servers/
│   │   │   └── main.py                 # active (data_engine Flask app)
│   │   ├── engine_server.py            # DELETE (orphan alternate)
│   │   ├── simple_server.py            # DELETE (orphan alternate)
│   │   └── api/
│   │       └── (Next.js /api/data-engine/*)
│   │
│   ├── market-regime/            # Market regime detection
│   │   ├── market_regime_engine.py     # active (1,340 LOC) — CONSOLIDATE engines/market_regime.py here
│   │   ├── market_regime_detector.py   # DELETE (legacy)
│   │   ├── engines/market_regime.py    # DELETE (duplicate, merge into market_regime_engine)
│   │   ├── macro_veto.py               # WIRE (high value)
│   │   ├── seasonality_first_engine.py  # active
│   │   ├── seasonality_engine_v2.py    # DELETE (orphan)
│   │   ├── seasonality_scorer.py       # DELETE (orphan)
│   │   └── api/
│   │       └── regime_routes.py        # active
│   │
│   ├── risk/                     # Risk management
│   │   ├── risk.py                     # active
│   │   ├── risk_manager.py             # DELETE (duplicate)
│   │   ├── risk_adaptive.py            # DELETE (duplicate)
│   │   ├── dynamic_risk_engine.py      # DELETE (duplicate)
│   │   ├── crypto_risk.py              # DELETE (orphan)
│   │   ├── crypto_circuit.py           # AUDIT
│   │   ├── correlation_filter.py      # AUDIT
│   │   ├── position_sizing.py          # active (from analyzers/)
│   │   ├── position_manager.py         # active (from analyzers/)
│   │   ├── stop_manager.py             # active (from portfolio/)
│   │   ├── hard_protection.py          # active (from portfolio/)
│   │   ├── portfolio_heat.py           # active (from portfolio/)
│   │   ├── smart_exit_engine.py         # active (from portfolio/)
│   │   ├── multi_target_exit.py        # active (from portfolio/)
│   │   ├── trade_journal.py            # active (from portfolio/)
│   │   ├── trade_level_validator.py    # DELETE (empty file)
│   │   └── api/
│   │       └── risk_routes.py          # active
│   │
│   ├── crypto/                   # Crypto analysis
│   │   ├── analyzers/
│   │   │   ├── crypto_disclosure_engine.py  # active
│   │   │   ├── crypto_news_fetcher.py  # active
│   │   │   ├── crypto_strict_filters.py  # active
│   │   │   ├── crypto_event_tracker.py  # AUDIT (orphan, 1,447 LOC)
│   │   │   ├── crypto_quality_gate.py  # DELETE (orphan)
│   │   │   ├── crypto_analyzer.py      # DELETE (orphan)
│   │   │   ├── crypto_confluence_engine.py  # DELETE (orphan)
│   │   │   ├── crypto_maestro.py       # DELETE (orphan)
│   │   │   ├── crypto_prediction_engine.py  # DELETE (orphan)
│   │   │   ├── crypto_mr_signal.py     # DELETE (orphan)
│   │   │   ├── crypto_short_holding_exit.py  # DELETE (orphan)
│   │   │   ├── crypto_regime.py        # DELETE (orphan)
│   │   │   ├── crypto_risk.py          # DELETE (orphan)
│   │   │   └── mean_reversion_signal.py  # AUDIT (orphan)
│   │   ├── engine/
│   │   │   ├── crypto_engine.py        # active
│   │   │   ├── crypto_full_system.py   # DELETE (orphan)
│   │   │   └── crypto_database.py     # DELETE (orphan in core/)
│   │   ├── jobs/
│   │   │   └── crypto_lab_scheduler.py  # active
│   │   └── api/  (Next.js side)
│   │
│   ├── persona/                  # Persona analysis
│   │   ├── persona_investor.py         # active
│   │   ├── persona_gambler.py          # active
│   │   ├── persona_screener.py        # active
│   │   ├── persona_engine.py           # AUDIT (1 caller)
│   │   ├── engine/persona_engine.py    # CONSOLIDATE
│   │   └── api/
│   │       └── persona_routes.py       # active
│   │
│   ├── news/                     # News analysis (news-agent is separate)
│   │   ├── analyzers/
│   │   │   ├── news_fetcher_analyzer.py  # active
│   │   │   ├── news_impact_scorer.py  # DELETE (duplicate)
│   │   │   ├── news_stop_filter.py    # active (already in radar/)
│   │   │   ├── live_news_integration.py  # active
│   │   │   ├── sentiment_analyzer.py  # DELETE (duplicate)
│   │   │   ├── ai_sentiment.py        # DELETE (duplicate)
│   │   │   └── ai_pattern_analyzer.py  # AUDIT (ML-based, high value)
│   │   ├── egx_disclosure_engine.py   # active
│   │   └── api/
│   │       └── news_routes.py         # active
│   │
│   ├── fundamentals/             # Fundamentals
│   │   ├── fundamental.py              # active
│   │   ├── fundamental_data_provider.py  # active
│   │   ├── fundamental_engine.py       # DELETE (orphan)
│   │   ├── fundamental_enhanced.py     # DELETE (orphan)
│   │   ├── fundamental_scorer.py       # DELETE (orphan)
│   │   ├── fundamental_quality_gate.py # DELETE (orphan)
│   │   ├── fundamental_relative.py     # DELETE (orphan)
│   │   ├── dividend_checker.py         # WIRE
│   │   ├── fair_value_calculator.py    # active (already in stock-analysis)
│   │   └── stock_fundamentals.py       # active (from engine/)
│   │
│   ├── telegram-bot/             # Telegram publishing
│   │   ├── auto_poster.py              # active (660 LOC)
│   │   ├── auto_post_scheduler.py      # active (1,634 LOC, PM2 service)
│   │   ├── telegram_client.py          # active (1,232 LOC)
│   │   ├── telegram_notifier.py        # active
│   │   ├── telegram_marketing_engine.py  # WIRE (replaces 6 publishers below)
│   │   ├── telegram_interactive_bot.py  # WIRE via marketing_engine
│   │   ├── telegram_morning_bell.py     # WIRE via marketing_engine
│   │   ├── telegram_intraday_alerts.py  # WIRE via marketing_engine
│   │   ├── telegram_closing_scorecard.py  # WIRE via marketing_engine
│   │   ├── telegram_breaking_news.py    # WIRE via marketing_engine
│   │   ├── telegram_daily_lessons.py    # WIRE via marketing_engine
│   │   ├── telegram_target_hit_tracker.py  # WIRE (high value)
│   │   ├── telegram_chart_generator.py  # KEEP (used by alerts)
│   │   ├── telegram_report_card.py      # AUDIT
│   │   ├── telegram_market_analysis.py  # AUDIT
│   │   ├── telegram_sectors_report.py   # AUDIT
│   │   ├── telegram_radar_notifier.py   # AUDIT
│   │   ├── telegram_news_scraper.py     # DELETE (replaced by news-agent)
│   │   ├── screener_blast.py            # WIRE
│   │   ├── radar_card_publisher.py      # WIRE (already wired to radar/)
│   │   ├── telegram_branding.py         # KEEP (utility)
│   │   ├── ai_processor.py              # active
│   │   ├── database.py                  # active
│   │   ├── egx_arabic_lookup.py         # DELETE (duplicate)
│   │   └── patch_auto_poster.py         # DELETE (one-off)
│   │
│   ├── ai/                       # AI subsystem (already exists)
│   │   ├── glm_finance_agent.py        # active
│   │   ├── decision_engine.py          # active
│   │   ├── news_agent.py               # active
│   │   ├── news_signals_reader.py      # active
│   │   ├── live_ai_monitor.py           # active
│   │   ├── hot_stocks_detector.py      # active
│   │   ├── nightly_analysis.py          # active
│   │   ├── telegram_signal_importer.py  # active
│   │   ├── historical_trade_generator.py  # active
│   │   ├── trade_recorder.py            # active
│   │   ├── portfolio_routes.py          # active
│   │   ├── continuous_learning.py       # DELETE (orphan)
│   │   ├── story_generator.py            # DELETE (orphan)
│   │   ├── prompt_templates.py          # DELETE (orphan)
│   │   ├── test_live_rag_analysis.py    # DELETE (test file)
│   │   └── test_rag_decision.py         # DELETE (test file)
│   │
│   ├── auth/                    # User management
│   │   ├── core/auth_middleware.py      # active (move from core/)
│   │   └── api/  (Next.js side handles most)
│   │
│   ├── admin/                   # Admin tools
│   │   ├── api/
│   │   │   ├── admin_routes.py          # active (4,939 LOC, 74 routes)
│   │   │   └── admin_engine_settings_routes.py  # active
│   │   ├── tools/  (move from tools/)
│   │   │   ├── evaluate_predictions.py  # active
│   │   │   ├── diagnose_predictions.py  # active
│   │   │   ├── toggle_protection.py     # active
│   │   │   ├── restore_dbs.py           # DELETE (orphan)
│   │   │   ├── restore_from_local.py    # DELETE (orphan)
│   │   │   ├── migrate_price_history.py # DELETE (orphan)
│   │   │   ├── diagnose_db_structure.py  # DELETE (orphan)
│   │   │   └── price_history_resolver.py  # DELETE (orphan)
│   │   └── scripts/  (move select scripts from vps-service/scripts/)
│   │
│   ├── maestro-legacy/          # Maestro (Phase 5 retired — kept for backtest reference)
│   │   ├── maestro_orchestrator.py      # active (Phase 5 retired but still imported)
│   │   ├── unified_maestro.py           # DELETE (orphan)
│   │   ├── crypto_maestro.py            # DELETE (orphan)
│   │   ├── reports_engine.py            # active (in stock-analysis)
│   │   ├── market_daily_report.py       # active
│   │   ├── social_card_generator.py     # CONSOLIDATE (with radar_card_publisher)
│   │   ├── educational_cards_engine.py   # WIRE (high value)
│   │   └── api/
│   │       └── maestro_routes.py        # active (13 routes, mostly legacy)
│   │
│   └── glminvestment-engines/    # Minervini engines (already exists)
│       ├── engines/
│       │   ├── vcp_detector.py
│       │   ├── donchian_breakout.py
│       │   ├── stage2_filter.py
│       │   ├── atr_risk_engine.py
│       │   └── take_profit_tiers.py
│       ├── confluence/confluence_scorer.py
│       ├── backtest/strategy_backtester.py
│       ├── integration/
│       │   ├── expert_gate_patch.py
│       │   └── risk_engine_patch.py
│       └── cli_analyze.py
│
├── shared/                      # Shared infrastructure (current core/ + utils/)
│   ├── db_paths.py                     # active (DBPaths single source of truth)
│   ├── database.py                     # active (1,177 LOC)
│   ├── db_manager.py                   # active
│   ├── migrator.py                     # active (1,435 LOC)
│   ├── scheduler_manager.py            # active (1,009 LOC)
│   ├── egypt_scheduler.py               # active
│   ├── cache.py                        # active
│   ├── cache_manager.py                # active
│   ├── logging_config.py               # active
│   ├── circuit_breaker.py              # active
│   ├── http_client.py                  # active
│   ├── models.py                       # active
│   ├── analysis_runner.py              # active
│   ├── opportunity_quality.py          # active (2,105 LOC, 19 callers)
│   ├── persona_db.py                   # active
│   ├── crypto_database.py              # DELETE (orphan)
│   ├── router.py                       # AUDIT (1 caller)
│   ├── utils/
│   │   ├── helpers.py                  # active
│   │   ├── live_price.py               # active
│   │   ├── trading_calendar.py         # active
│   │   ├── stock_state.py              # active
│   │   ├── entry_gate.py               # active
│   │   ├── egx_gate.py                 # active
│   │   ├── params_io.py                # active
│   │   ├── position_sizing.py          # active (in risk/)
│   │   ├── data_engine_guard.py        # AUDIT
│   │   ├── lesson_store.py             # active (in predictions/)
│   │   ├── win_lesson_store.py         # active (in predictions/)
│   │   ├── shared_liquidity.py         # active (in radar/)
│   │   └── circuit_breaker.py          # active (duplicate of core/?)
│   └── config/
│       ├── sys_config.py               # active
│       ├── market_config.py            # active
│       ├── unified_config.py           # active
│       ├── active_settings.json        # active
│       ├── optimizer_params.json       # active
│       └── toxic_ticker_blocklist.json # active
│
├── services/                    # Long-running services
│   ├── main.py                         # FastAPI entry (366 LOC)
│   ├── lightweight_server.py          # Flask app (1,899 LOC)
│   └── ws-service/                     # Bun socket.io (621 LOC)
│
├── tests/                       # Tests (keep current structure)
│   ├── conftest.py
│   ├── test_*.py  (13 top-level)
│   └── unit/test_*.py  (8 unit)
│
└── scripts/                     # Operational scripts (current 104 files)
    └── (reorganize + DELETE one-off migration scripts)
```

### 9.3 Migration plan

| Phase | Duration | Risk | Action |
|---|---|---|---|
| 1 | 1 day | LOW | **Delete clear orphans** — 38 analyzers (~21,000 LOC) + 4 engines (~1,900 LOC) + 2 telegram duplicates + 1 empty file. No behavior change. |
| 2 | 2 days | LOW | **Consolidate duplicates** — merge `engines/market_regime.py` into `analyzers/market_regime_engine.py`; consolidate `egx_arabic_lookup.py` (3 copies → 1); consolidate `social_card_generator.py` into `radar_card_publisher.py`. |
| 3 | 3 days | MEDIUM | **Wire high-value orphans** — 7 analyzer WIRE candidates (conviction_engine, prediction_sanity, macro_veto, quant_overdrive, indicator_trust_scores, dividend_checker, educational_cards_engine) + 3 job WIRE candidates (hot_candidate_detector, fetch_earnings_calendar, daily_gainer_scan) + 7 script WIRE candidates (mine_learned_lessons, exit_policy_optimizer, post_market_feedback, data_hygiene_cron, delta_volume_calculator, check-db-integrity, maker_radar/exit_radar in cron). |
| 4 | 2 days | MEDIUM | **Wire Telegram marketing engine** — adopt `telegram_marketing_engine.py` as canonical publisher, retire 6 individual publishers. Update `auto_post_scheduler.py` to delegate. |
| 5 | 5 days | HIGH | **Module boundary migration** — create `modules/` directory, move files (keeping backward-compat aliases via `__init__.py` re-exports). Touch every file but break nothing. |
| 6 | 3 days | MEDIUM | **Data disconnect fixes** — add 16 missing API endpoints for orphan tables (persona_predictions, conjunction_patterns, indicator_trust_scores, exit_notifications, etc.) + surface them in admin UI. |
| 7 | 2 days | LOW | **Documentation update** — update `Documentation/01-PROJECT_ANATOMY.md` with new module structure. |

**Total: ~18 days** (could be parallelized to ~10 days with 2 engineers).

---

## 10. Data Layer Consolidation Proposal

### 10.1 Current state (after P0-8-DB-UNIFY on 2026-09-27)

The project went through several DB consolidation waves:

1. **Pre-v3.65.0** (early 2026): 19+ DBs scattered
2. **v3.65.0** (2026-08-29): Consolidated to 6 DBs (stocks + predictions + data_engine + auth + price_history + intraday)
3. **P0-8-DB-UNIFY** (2026-09-27): Dropped 9 duplicate tables across 4 DBs (333 rows total, all backed up as JSON sidecars)
4. **Target architecture** (per `utils/db_paths.py`): 4 DBs (market + predictions + auth + content) — `market.db` and `content.db` not yet populated on production

### 10.2 Canonical DB → table mapping (post-P0-8-DB-UNIFY)

```
stocks.db (canonical):
  - stocks (976 rows) — stock metadata
  - egksco_stocks (250) — EGX official list
  - cached_analysis (143) — analysis JSON cache
  - ExpertRecommendation (127) — expert recommendations
  - telegram_news (6) — telegram news cache
  - portfolios (3) — user portfolios
  - stock_daily_prices — last 30 days fast lookup
  - stock_intraday / crypto_intraday / commodity_intraday / intraday_meta
  - egksco_sync_status / market_indices / market_regime_log
  - system_settings — key-value settings
  - tuned_predictions_summary / real_evaluated_predictions / analytics_events
  - gold_price_history / currency_rates / news / news_items (legacy aliases)
  - stock_phase / stocks_backup / stock_prices (legacy)

predictions.db (canonical):
  - predictions — V40.2 predictions
  - persona_predictions — per-persona variants
  - prediction_logs / outcome_logs / learned_lessons (19K)
  - conjunction_patterns / indicator_trust_scores / quant_cache
  - stored_analyses / morning_bell_signals / exit_notifications
  - backtest_results / optimizer_params_history
  - crypto_predictions_log / aiPredictionStats
  - user_trades / telegram_recommendations / telegram_signals
  - prediction_lessons (legacy, replaced by learned_lessons)

data_engine.db (canonical):
  - egksco_price_history (13K rows) — EGX daily OHLCV
  - gold_prices (187K) / gold_prices_clean / silver_prices / exchange_rates
  - tab_balance_sheet / tab_cash_flow / tab_dividends / tab_income_statement /
    tab_performance / tab_profitability / tab_technical_analysis / tab_valuation
  - crypto_prices / crypto_price_history / cryptos / crypto_metrics / crypto_fetch_log
  - sync_status / btc_local_prices
  - macro_indicators / macro_prices / macro_fetch_log
  - historical_data / screener_presets / screener_results / screener_lists

auth.db (canonical):
  - User (101 rows) / PromoCode / SubscriptionPlan / api_tokens
  - task_runs / user_stock_watchlists / portfolio_assets
  - session / account / verification_token (NextAuth)

price_history.db (canonical):
  - price_history (1.24M rows on prod) — 25-year price history
  - sqlite_sequence

custom.db (deprecated):
  - Post / User — Prisma tutorial default
  - SHOULD BE DELETED (P0 #8 lists it as deprecated)

intraday.db (production only, not on sandbox):
  - stock_intraday / crypto_intraday / commodity_intraday / intraday_meta
  - 1.1M rows on prod
```

### 10.3 Target architecture (4-DB target — not yet on production)

```
market.db (target — currently 0 bytes):
  - All market data: prices + fundamentals + crypto + metals + indices + macros
  - Migration: data_engine.db + price_history.db + stocks.db (price tables) → market.db

predictions.db (target — partially populated):
  - All predictions + learning + outcomes
  - Migration: predictions.db (current) + stocks.db.{cached_analysis, ExpertRecommendation} → predictions.db

auth.db (target — populated):
  - All user data: users + subscriptions + portfolios + watchlists
  - Migration: auth.db (current) + stocks.db.{portfolios, portfolio_assets, user_stock_watchlists} → auth.db

content.db (target — not yet created):
  - All content: news + telegram + scraping status
  - Migration: stocks.db.{news, news_items, telegram_news} + news-agent data → content.db
```

### 10.4 Recommended consolidation steps

| Step | Risk | Action |
|---|---|---|
| 1 | LOW | **Delete `custom.db`** — Prisma tutorial default, 0 rows, deprecated in P0 #8 |
| 2 | LOW | **Delete `db/screener_lists` table** in data_engine.db — only the JSON file `db/screener_lists.json` is consumed; the table is unused |
| 3 | LOW | **Drop legacy alias tables** in stocks.db: `stock_prices`, `stocks_backup`, `currency_rates`, `news_items`, `news` (legacy aliases for tables that have been moved to data_engine.db or predictions.db) |
| 4 | LOW | **Drop `prediction_lessons`** in predictions.db — replaced by `learned_lessons` |
| 5 | MEDIUM | **Migrate `stocks.db.cached_analysis` → `predictions.db`** — already done in P0-8-DB-UNIFY (predictions.db side was dropped, stocks.db is canonical). Verify no readers reference the wrong side. |
| 6 | MEDIUM | **Migrate `stocks.db.ExpertRecommendation` → `predictions.db`** — predictions side was dropped; verify no readers reference it. |
| 7 | MEDIUM | **Migrate `stocks.db.{portfolios, portfolio_assets, user_stock_watchlists}` → `auth.db`** — these are user-owned data; they belong in auth.db per the 4-DB target |
| 8 | MEDIUM | **Migrate `stocks.db.{news, news_items, telegram_news}` → `content.db`** (when created) — content data belongs in content.db |
| 9 | HIGH | **Create `market.db` and migrate `data_engine.db` + `price_history.db` + `stocks.db` price tables → `market.db`** — large migration; should be done via `migrate-to-unified-db.ts` (already exists, 1,212 LOC) |
| 10 | HIGH | **Create `content.db` and migrate news tables** — should be done via migration script |

### 10.5 DB write path consolidation

Currently, writes are scattered:

| DB | Writers (count of files) | Top writers |
|---|---:|---|
| `stocks.db` | ~50 files | `tradingview_scraper.py`, `egksco_scraper.py`, `master_analyzer.py`, `daily_closer.py`, `market_regime_engine.py`, `data_engine/sync.py`, `daily_price_updater.py` |
| `predictions.db` | ~30 files | `v40_2_daily_generator.py`, `daily_closer.py`, `learning_engine.py`, `prediction_tracker.py`, `maestro_orchestrator.py`, `crypto_lab_scheduler.py` |
| `data_engine.db` | ~30 files | `tradingview_scraper.py`, `egksco_scraper.py`, `crypto_fetcher.py`, `metals_forex_fetcher.py`, `historical_fetcher.py`, `egx_fundamental_fetcher.py`, `intraday_storage.py` |
| `auth.db` | ~5 files | Prisma (Next.js side), `auth_middleware.py` |
| `price_history.db` | ~10 files | `historical_fetcher.py`, `us_stock_scraper.py`, `daily_price_updater.py`, `price_history_safetynet.py`, `intraday_aggregator.py` |

**Recommendation**: Adopt `DBPaths.get_db_for_table()` consistently in all writers. Currently ~353 files reference `stocks.db` directly (hardcoded path) instead of going through `DBPaths`. Migration to `DBPaths` would centralize all path resolution and enable the 4-DB target architecture without code changes when DBs are consolidated.

### 10.6 DB reader consolidation

The Next.js side has **136 files using `better-sqlite3` directly**, plus 20+ `db-*.ts` lib files (per FE audit). The `db-helpers.ts` facade exists but is not adopted.

**Recommendation**: Adopt `src/lib/db-helpers.ts` (existing facade) in all 136 files. This would:
- Centralize DB connection logic
- Enable single-source WAL configuration
- Make the 4-DB target migration transparent to Next.js

### 10.7 Intraday DB

`intraday.db` (1.1M rows on production) is referenced 63 times across the codebase but doesn't exist on the sandbox. It's used by:
- `data_engine/intraday_storage.py` (1,122 LOC) — writes `stock_intraday`, `crypto_intraday`, `commodity_intraday`, `intraday_meta`
- `jobs/hot_candidate_detector.py` (orphan) — reads `stock_intraday`
- `jobs/intraday_aggregator.py` (active) — aggregates intraday → daily
- `analyzers/intraday_reader.py` (active) — reads sector performance + maker flow
- `analyzers/v40_2_intraday_scanner.py` (active) — reads 5-min data

**Recommendation**: Document `intraday.db` in `db_paths.py` as a 5th canonical DB (or merge into `market.db` when created). Add it to `DBPaths` class. Update `get_db_for_table()` to route intraday tables correctly.

### 10.8 JSON state files

16 JSON state files exist in `db/`. These should be organized:

| Category | Files | Recommendation |
|---|---|---|
| **Cache status** | `radar_cache_status.json`, `v40_generation_status.json`, `historical_status.json` | Keep in `db/` (need fast access) |
| **Tracking state** | `maker_radar_tracking.json`, `radar_alerts_state.json`, `paper_mode_v2.json`, `paper_test_v2.json` | Keep in `db/` |
| **Cached data** | `screener_lists.json` | Keep in `db/` |
| **Migration logs** | `migration-consolidate-*.json`, `production_snapshot_progress.json` | Move to `db/migration_logs/` |
| **One-off results** | `retrospective_analysis.json`, `unified_logic_whatif_results.json`, `balanced_only_backtest_results.json`, `backtest_risk_management_results.json` | Move to `scripts/output/` |
| **Examples** | `display_protection.example.json` | Move to `db/examples/` |

### 10.9 Final DB target state (after full consolidation)

```
db/
├── market.db          (target — replaces data_engine.db + price_history.db + stocks.db price tables)
├── predictions.db     (target — adds cached_analysis + ExpertRecommendation from stocks.db)
├── auth.db            (target — adds portfolios + portfolio_assets + user_stock_watchlists from stocks.db)
├── content.db         (target — adds news + telegram_news from stocks.db)
├── intraday.db        (5th canonical — intraday tick data)
├── *.db-shm + *.db-wal
├── *.json             (16 state files — organized per §10.8)
├── schemas/           (canonical schema SQL)
└── backups/           (smart_db_backup.py output)
```

**Total: 5 DBs** (down from current 6, with `custom.db` deleted and `market.db` + `content.db` created).

---

## 11. Final Statistics & Recommendations

### 11.1 Audit statistics

| Metric | Value |
|---|---:|
| Total files audited | **~824** (Python + TS) |
| Total LOC audited | **~397,000** (vps-service 297,803 + scripts 81,256 + data_engine 11,130 + news-agent 6,519) |
| Analyzers total | **148** (108,857 LOC) |
| Analyzers active | **80** (67,245 LOC) |
| Analyzers orphan | **68** (41,538 LOC) |
| Analyzers dead (empty) | **1** (`trade_level_validator.py`) |
| Engines total | **16** (across `engine/` + `engines/`) |
| Engines active | **12** |
| Engines orphan | **4** (~1,900 LOC) |
| Jobs total | **17** |
| Jobs active (in cron or market_scheduler) | **14** |
| Jobs orphan (not scheduled) | **3** |
| API blueprints | **38** (409 routes + 7 in `data_engine/main.py` = 416 total) |
| API routes (Python) | **416** |
| API routes (Next.js) | **670** |
| Scrapers (across `data_engine/scrapers/` + `vps-service/data/` + `news-agent/collectors/`) | **52** |
| Scrapers active | **~18** |
| Scrapers orphan | **~12** |
| Telegram modules | **26** (13,182 LOC) |
| Telegram modules orphan | **19** (8,387 LOC) |
| Cron jobs (in `crontab.txt`) | **18** entries (some are sub-entries) |
| SQLite DBs | **6** (4 canonical + 1 deprecated + 1 historical) |
| DB tables (canonical) | **~70** |
| Tables with no API reader | **~20** |
| JSON state files | **16** |
| PM2 services | **7** (python-backend + data-engine + nextjs + ws-service + telegram-poster + telegram-events + news-agent) |
| Tests (vps-service) | **22** files / **8,116** LOC |
| Hidden gems identified | **143 candidates** (44 DELETE + 48 WIRE + 28 AUDIT + 5 CONSOLIDATE) |

### 11.2 Top 5 recommendations

1. **Delete 38 orphan analyzers + 4 orphan engines + 2 orphan telegram duplicates** — ~24,000 LOC of dead code. This is the single biggest cleanup. None of these have any callers. Verified by strict import-based grep across the whole repo. Safe to delete in one PR. High risk of confusion otherwise (e.g., `unified_analyzer.py` 3,736 LOC vs `master_analyzer.py` 5,026 LOC — same purpose, only one is used).

2. **Wire 7 high-value orphan analyzers into V40.2 pipeline** — `conviction_engine.py` (433 LOC, "is NOW the right time?"), `prediction_sanity.py` (181 LOC, hard limits before DB write), `macro_veto.py` (180 LOC, USD/interest rate aware), `quant_overdrive.py` (381 LOC, SMFI + Monte Carlo), `indicator_trust_scores.py` (147 LOC, dynamic indicator weighting), `dividend_checker.py` (340 LOC, avoid dividend capture traps), `educational_cards_engine.py` (1,560 LOC, generate daily Telegram educational content). Total: ~3,600 LOC of untapped value.

3. **Adopt `telegram_marketing_engine.py` as canonical Telegram publisher** — replaces 6 orphan publishers (`telegram_interactive_bot` + `telegram_morning_bell` + `telegram_intraday_alerts` + `telegram_closing_scorecard` + `telegram_breaking_news` + `telegram_daily_lessons`). Net: -3,175 LOC dead + 1 comprehensive 225-LOC engine. Also wire `telegram_target_hit_tracker.py` (1,012 LOC) for real-time target-hit alerts (currently writes nothing).

4. **Wire 3 orphan jobs into cron** — `hot_candidate_detector.py` (every 5 min during market, before V40.2 intraday scanner), `fetch_earnings_calendar.py` (weekly Sunday `0 6 * * 0`), `daily_gainer_scan.py` (daily after daily_closer `30 14 * * 0-4`). Also wire `scripts/mine_learned_lessons.py` (weekly Sunday), `scripts/exit_policy_optimizer.py` (monthly), `scripts/post_market_feedback.py` (daily `45 14 * * 0-4`), `scripts/data_hygiene_cron.py` (weekly Sunday), `scripts/check-db-integrity.ts` (daily). Total: 8 high-value scripts going unused.

5. **Complete the 4-DB consolidation** — `custom.db` (deprecated, 0 rows) should be deleted. `stocks.db.{portfolios, portfolio_assets, user_stock_watchlists}` should migrate to `auth.db`. `stocks.db.{news, news_items, telegram_news}` should migrate to a new `content.db`. Legacy alias tables (`stock_prices`, `stocks_backup`, `currency_rates`, `news_items`, `prediction_lessons`) should be dropped. Target: 5 canonical DBs (market.db + predictions.db + auth.db + content.db + intraday.db), down from current 6 with significant dead-weight tables. Adopt `DBPaths.get_db_for_table()` consistently in all ~50 writers + 136 Next.js readers.

### 11.3 Bonus recommendations

6. **Consolidate duplicate analyzer families** — market regime (3 files → 1), confluence (4 files → 2), fundamental (7 files → 2), technical (4 files → 1), risk (5 files → 1), sniper (4 files → 3), exit (3 files → 1), trend-following (2 files → 0). Total reclaimable: ~10,000 LOC.

7. **Surface 16 orphan DB tables via new API endpoints** — `persona_predictions`, `conjunction_patterns`, `indicator_trust_scores`, `exit_notifications`, `backtest_results`, `aiPredictionStats`, `tab_cash_flow`, `tab_income_statement`, `crypto_intraday`, `commodity_intraday`, `macro_indicators`, `market_regime_log`, `tuned_predictions_summary`, `real_evaluated_predictions`, `stock_phase`, `cryptos`+`crypto_metrics`. Each is written by an active module but no API exposes it.

8. **Delete 5 dead Next.js routes** — `/api/v4/stats` (0 callers, SQLite fallback works), `/api/walk-forward/run` (0 callers), `/api/kimi/backtest/run` (0 callers), `/api/mubasher/sync` (0 callers), and audit `/api/hunter/*` (only 1 caller).

9. **Add `intraday.db` to `DBPaths`** — currently 63 files reference it directly. Should be a 5th canonical DB.

10. **Adopt `src/lib/db-helpers.ts` facade** in all 136 Next.js files using `better-sqlite3` directly. This enables the 4-DB target migration transparently.

11. **Delete `data_engine/engine_server.py` + `data_engine/simple_server.py`** — both are orphan alternate servers (93 + 92 LOC). Only `main.py` (1,158 LOC) is referenced by PM2.

12. **Delete `vps-service/strategies_merge/`** (7 files, 557 LOC) — only used by archived backtests in `scripts/_archived/`.

13. **Delete `vps-service/live_signals/`** + `vps-service/paper_trading/`** — `recorder.py` has 0 callers; `paper_trading/` is only used by `scripts/paper_trading.py` (orphan).

14. **Delete `vps-service/scrappers/egx_investors_scraper.py`** — duplicate of `data_engine/scrapers/` pattern.

15. **Delete `vps-service/data/{multi_market_fetcher.py, us_stocks_fetcher.py}`** — both 0 callers, replaced by `data_engine/scrapers/`.

16. **Move `scripts/maker_radar.py` + `scripts/exit_radar.py` + `scripts/weekly_radar_report.py`** into `vps-service/modules/radar/generators/` — these are core backend logic, not operational scripts.

17. **Move `scripts/sync_hunter_pick_tracking.py` + `scripts/data_heartbeat_checker.py` + `scripts/smart_db_backup.py` + `scripts/daily_price_updater.py`** into `vps-service/modules/admin/scripts/` — these are core backend operations.

18. **Document `db_paths.py` 4-DB target architecture** in `Documentation/01-PROJECT_ANATOMY.md` — currently the doc says 6 DBs but `db_paths.py` says 4. Reconcile.

19. **Run `bun run lint` + `pytest vps-service/tests/`** after each phase to catch breakages early.

20. **Add integration tests** for the 7 WIRE candidates — each high-value orphan analyzer should have a test before wiring to ensure it doesn't break V40.2.

---

## Appendix A: File counts by directory (verified)

```
vps-service/
├── analyzers/         148 files / 108,857 LOC
├── api/                38 files /  40,640 LOC
├── jobs/               17 files /  15,323 LOC
├── data/               16 files /   8,676 LOC
├── utils/              15 files /   5,957 LOC
├── engines/             6 files /   4,372 LOC
├── engine/              10 files /   7,235 LOC
├── telegram/           26 files /  13,182 LOC
├── tools/               8 files /   3,004 LOC
├── ai/                 17 files /   6,981 LOC
├── core/               18 files /  11,705 LOC
├── portfolio/           9 files /   5,470 LOC
├── strategies_merge/    7 files /     557 LOC
├── glminvestment_engines/  20 files /  3,763 LOC
├── scripts/           104 files /  42,714 LOC
├── tests/              22 files /   8,116 LOC
├── ws-service/          1 file  /     621 LOC (TS)
├── core/               18 files /  11,705 LOC
├── live_signals/        3 files /     ~50 LOC (orphan)
├── paper_trading/       3 JSON files (orphan)
├── scrappers/           1 file  /    ~200 LOC (duplicate)
├── config/              7 files /   ~300 LOC
├── models/              1 file (empty __init__.py)
├── root *.py           17 files /   ~5,500 LOC
└── README.md + Dockerfile + docker-compose.yml + deploy.sh + requirements.txt

data_engine/
├── main.py              1 file  /   1,158 LOC
├── sync.py              1 file  /     774 LOC
├── intraday_storage.py  1 file  /   1,122 LOC
├── realtime_sync.py    1 file  /     175 LOC
├── engine_server.py     1 file  /      93 LOC (orphan)
├── simple_server.py     1 file  /      92 LOC (orphan)
└── scrapers/           20 files /   7,582 LOC

news-agent/
├── main.py              1 file  /   ~300 LOC
├── collectors/          8 files /  ~2,500 LOC
│   └── scrappers/       8 files /  ~1,500 LOC
├── analyzer/            3 files /  ~1,000 LOC
├── sender/              2 files /    ~400 LOC
├── data/                2 files /    ~300 LOC
├── ui/                  2 files /    ~500 LOC
├── doc/                 5 files
└── tests/               2 files

scripts/                291 files /  81,256 LOC
├── _archived/           97 files /  ~30,000 LOC (historical backtests)
├── output/              49 files (recent outputs)
└── *.py + *.ts + *.cjs + *.js + *.sh  291 files

telegram-events/
└── index.ts + package.json + bun.lock

db/
├── *.db                6 files (4 canonical + 1 deprecated + 1 historical)
├── *.db-shm + *.db-wal WAL files
├── *.json             16 state files
└── schemas/            2 SQL files (legacy)
```

---

## Appendix B: Verified hidden gems inventory (sorted by LOC)

| File | LOC | Type | Action | Module (proposed) |
|---|---:|---|---|---|
| `analyzers/unified_analyzer.py` | 3,736 | ORPHAN | DELETE | stock-analysis |
| `analyzers/educational_cards_engine.py` | 1,560 | ORPHAN | WIRE | maestro-legacy |
| `analyzers/crypto_event_tracker.py` | 1,447 | ORPHAN | AUDIT | crypto |
| `analyzers/crypto_quality_gate.py` | 1,229 | ORPHAN | DELETE | crypto |
| `analyzers/crypto_analyzer.py` | 1,139 | ORPHAN | DELETE | crypto |
| `analyzers/expert_memory_v4.py` | 1,013 | ORPHAN | DELETE | predictions |
| `analyzers/fundamental_quality_gate.py` | 910 | ORPHAN | DELETE | fundamentals |
| `analyzers/social_card_generator.py` | 902 | ORPHAN | CONSOLIDATE | maestro-legacy |
| `analyzers/seasonality_engine_v2.py` | 891 | ORPHAN | DELETE | market-regime |
| `analyzers/technical_target_engine.py` | 874 | ORPHAN | DELETE | stock-analysis |
| `analyzers/dynamic_analysis_engine.py` | 849 | ORPHAN | DELETE | stock-analysis |
| `analyzers/devil_quality_gate.py` | 819 | ORPHAN | DELETE | stock-analysis |
| `analyzers/ai_pattern_analyzer.py` | 780 | ORPHAN | AUDIT | stock-analysis |
| `analyzers/v82_analyzer.py` | 741 | ORPHAN | DELETE | stock-analysis |
| `analyzers/event_impact_tracker.py` | 735 | ORPHAN | AUDIT | stock-analysis |
| `analyzers/crypto_confluence_engine.py` | 727 | ORPHAN | DELETE | crypto |
| `analyzers/risk_adaptive.py` | 691 | ORPHAN | DELETE | risk |
| `analyzers/risk_manager.py` | 690 | ORPHAN | DELETE | risk |
| `analyzers/sniper_filter.py` | 672 | ORPHAN | DELETE | stock-analysis |
| `analyzers/fundamental_enhanced.py` | 646 | ORPHAN | DELETE | fundamentals |
| `analyzers/expert_memory.py` | 637 | ORPHAN | DELETE | predictions |
| `analyzers/news_impact_scorer.py` | 618 | ORPHAN | DELETE | news |
| `analyzers/unified_maestro.py` | 592 | ORPHAN | DELETE | maestro-legacy |
| `analyzers/dynamic_risk_engine.py` | 592 | ORPHAN | DELETE | risk |
| `analyzers/production_data_client.py` | 583 | ORPHAN | DELETE | shared |
| `analyzers/sentiment_analyzer.py` | 577 | ORPHAN | DELETE | news |
| `analyzers/fundamental_scorer.py` | 567 | ORPHAN | DELETE | fundamentals |
| `analyzers/crypto_prediction_engine.py` | 567 | ORPHAN | DELETE | crypto |
| `analyzers/live_autonomous_monitor.py` | 550 | ORPHAN | DELETE | predictions |
| `analyzers/technical_weighted.py` | 527 | ORPHAN | DELETE | stock-analysis |
| `analyzers/unified_exit_engine.py` | 518 | ORPHAN | DELETE | predictions |
| `analyzers/enhanced_indicators.py` | 515 | ORPHAN | DELETE | stock-analysis |
| `analyzers/crypto_risk.py` | 515 | ORPHAN | DELETE | crypto |
| `analyzers/scoring_fix.py` | 507 | ORPHAN | DELETE | stock-analysis |
| `analyzers/quant_cache.py` | 501 | ORPHAN | DELETE | stock-analysis |
| `analyzers/candlestick.py` | 492 | ORPHAN | DELETE | stock-analysis |
| `analyzers/market_manager.py` | 489 | ORPHAN | DELETE | shared |
| `analyzers/correlation_filter.py` | 484 | ORPHAN | AUDIT | risk |
| `analyzers/sector_relative.py` | 460 | ORPHAN | AUDIT | stock-analysis |
| `analyzers/confluence_engine.py` | 459 | ORPHAN | DELETE | stock-analysis |
| `analyzers/dynamic_context_engine.py` | 455 | ORPHAN | DELETE | stock-analysis |
| `analyzers/crypto_maestro.py` | 452 | ORPHAN | DELETE | crypto |
| `analyzers/prediction_validator.py` | 448 | ORPHAN | DELETE | predictions |
| `analyzers/seasonality_scorer.py` | 438 | ORPHAN | DELETE | market-regime |
| `analyzers/trend_following_analyzer.py` | 437 | ORPHAN | DELETE | stock-analysis |
| `analyzers/conviction_engine.py` | 433 | ORPHAN | WIRE | stock-analysis |
| `analyzers/crypto_mr_signal.py` | 432 | ORPHAN | DELETE | crypto |
| `analyzers/crypto_short_holding_exit.py` | 412 | ORPHAN | DELETE | crypto |
| `analyzers/trend_following_paper_trading.py` | 406 | ORPHAN | DELETE | stock-analysis |
| `analyzers/quant_overdrive.py` | 381 | ORPHAN | WIRE | stock-analysis |
| `analyzers/mean_reversion_signal.py` | 378 | ORPHAN | AUDIT | crypto |
| `analyzers/fundamental_engine.py` | 372 | ORPHAN | DELETE | fundamentals |
| `analyzers/technical_analyzer.py` | 371 | ORPHAN | DELETE | stock-analysis |
| `analyzers/fundamental_relative.py` | 362 | ORPHAN | DELETE | fundamentals |
| `analyzers/day_trading_scanner.py` | 361 | ORPHAN | AUDIT | radar |
| `analyzers/v4_predictive_detector.py` | 346 | ORPHAN | DELETE | stock-analysis |
| `analyzers/dividend_checker.py` | 340 | ORPHAN | WIRE | fundamentals |
| `analyzers/volume_profile.py` | 337 | ORPHAN | AUDIT | stock-analysis |
| `analyzers/session_timing.py` | 327 | ORPHAN | DELETE | stock-analysis |
| `analyzers/market_regime_detector.py` | 322 | ORPHAN | DELETE | market-regime |
| `analyzers/explosive_uncap_engine.py` | 272 | ORPHAN | AUDIT | stock-analysis |
| `analyzers/crypto_regime.py` | 268 | ORPHAN | DELETE | crypto |
| `analyzers/ai_sentiment.py` | 261 | ORPHAN | DELETE | news |
| `analyzers/crypto_circuit.py` | 260 | ORPHAN | AUDIT | crypto |
| `analyzers/base_engine.py` | 199 | ORPHAN | DELETE | shared |
| `analyzers/prediction_sanity.py` | 181 | ORPHAN | WIRE | predictions |
| `analyzers/macro_veto.py` | 180 | ORPHAN | WIRE | market-regime |
| `analyzers/egx_arabic_lookup.py` | 159 | ORPHAN | CONSOLIDATE | shared |
| `analyzers/indicator_trust_scores.py` | 147 | ORPHAN | WIRE | stock-analysis |
| `analyzers/trade_level_validator.py` | 0 | DEAD | DELETE | — |

**Total orphan analyzer LOC**: 41,538
**Total reclaimable via DELETE**: ~31,000 LOC (after subtracting WIRE + AUDIT candidates)
**Total high-value WIRE candidates**: 7 files / 3,622 LOC
**Total AUDIT candidates**: 9 files / 4,147 LOC

---

## Appendix C: References

- `Documentation/00-CONSTITUTION.md` — Project constitution (59 rules)
- `Documentation/01-PROJECT_ANATOMY.md` — Full architecture reference
- `Documentation/SYSTEM_HOW_IT_THINKS.md` — Analysis logic
- `agent-ctx/MODULE-MAP-FRONTEND.md` — Companion frontend audit (3,820 lines)
- `agent-ctx/P0-8-DB-UNIFY-REPORT.md` — DB unification report (2026-09-27)
- `agent-ctx/P1-GEMS-WIRING-REPORT.md` — Hidden gems wiring report (frontend)
- `agent-ctx/L2-WEEKLY-RADAR-REPORT.md` — Weekly radar report implementation
- `agent-ctx/L3-MULTI-RADAR-UI-ACCURACY-REPORT.md` — Multi-market radar
- `agent-ctx/L3-US-MARKET-REPORT.md` — US market integration
- `vps-service/utils/db_paths.py` — DB path single source of truth
- `crontab.txt` — Production cron schedule
- `ecosystem.config.js` — PM2 services config

---

**End of report.** Total lines: ~2,300 (within the 2,000-4,000 line target).
