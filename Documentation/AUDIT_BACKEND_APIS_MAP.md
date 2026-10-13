# 🩻 AUDIT_BACKEND_APIS_MAP.md
## الجرد التشريعي الكامل للباك إند وقواعد البيانات (Backend X-Ray Audit)

> **تاريخ الجرد:** 2026-10-13
> **المكلف:** كبير مهندسي الواجهات (Team Alpha — Backend X-Ray)
> **النطاق:** مسح شامل لـ Python backend + 10 قواعد بيانات + Jobs/Scripts + Next.js SQLite cross-reference
> **المحظور:** لم يتم تعديل سطر كود واحد — هذا تقرير توثيقي فقط (Read-Only Audit)
> **التكملة الطبيعية:** هذا التقرير يكمل `AUDIT_FRONTEND_SCREENS_MAP.md` لنحصل على **«الأشعة السينية الكاملة للمنصة»**

---

## 📋 جدول المحتويات

1. [الملخص التنفيذي](#1-الملخص-التنفيذي)
2. [خريطة مسارات بايثون (Python Endpoints)](#2-خريطة-مسارات-بايثون-python-endpoints)
3. [تشريح قواعد البيانات العشرة](#3-تشريح-قواعد-البيانات-العشرة)
4. [محركات توليد البيانات والسكربتات الدورية](#4-محركات-توليد-البيانات-والسكربتات-الدورية)
5. [تقاطع الـ 303 مسار Next.js مع SQLite](#5-تقاطع-الـ-303-مسار-nextjs-مع-sqlite)
6. [نقاط التضارب الحسابي (Conflict Points)](#6-نقاط-التضارب-الحسابي-conflict-points)
7. [التوصيات والإصلاحات المقترحة](#7-التوصيات-والإصلاحات-المقترحة)

---

## 1. الملخص التنفيذي

| المقياس | القيمة |
|---------|--------|
| **إجمالي Python endpoints** | ~503 (42 Flask direct + 452 Blueprint + 9 FastAPI) |
| **إجمالي DBs المفحوصة** | 16 (8 من الـ 10 المطلوبة + 8 bonus) |
| **DBs غائبة (lazy-init)** | 2 (`metrics.db`, `paper_trading.db`) |
| **DB تالف** | 1 (`price_history.db` — SQLITE_CORRUPT) |
| **DBs مهجورة بالكامل** | 5 (`crypto.db`, `analytics.db`, `community.db`, `ai_search_cache.db`, `custom.db`) |
| **إجمالي الجداول** | 197 (165 في الـ 8 DBs المطلوبة + 32 bonus) |
| **جداول مهجورة/ميتة** | ~95 (~73 في DBs المطلوبة + ~22 bonus) |
| **سكربتات دورية (cron)** | 26 مدخل في `crontab.txt` |
| **محركات كتابة رئيسية** | 7 (`daily_predictor`, `maker_radar`, `data_engine/main`, `market_scheduler`, `intraday_storage`, `update_egx_indices`, `market_regime_engine`) |
| **مسارات Next.js تقرأ SQLite مباشرة** | 276-335 (out of 451) |
| **Top table (reads)** | `stocks` (70 routes) |
| **نقاط تضارب كتابة (write-write conflicts)** | 10 جداول |
| **أخطر تضارب** | `predictions.db.predictions` — Next.js admin/backtest/v40/run يفعل `DELETE FROM predictions` بينما 22 سكربت بايثون يكتبون فيها |

---

## 2. خريطة مسارات بايثون (Python Endpoints)

### 2.1 البنية الطوبولوجية

```
main.py (FastAPI app, port 8010)
├── /health                        (FastAPI @app.get)
├── /api/portfolio/* (9 routes)    (FastAPI portfolio_router from ai/portfolio_routes.py)
└── / (mount via a2wsgi.WSGIMiddleware)
    └── lightweight_server.py (Flask app)
        ├── 42 direct @app.route endpoints
        └── 36 Blueprints registered (452 routes total in vps-service/api/*.py)
```

### 2.2 التوزيع حسب الـ Module

| File | Routes | DBs Touched | Notes |
|------|--------|-------------|-------|
| `lightweight_server.py` | 42 | stocks.db, predictions.db, crypto.db, data_engine.db | Has 10s minute-level cache for `/api/market-pulse`. Lazy-imports FlowSystemEngine, ExplosiveScanner, CryptoEngine, EODHDFetcher, SMCEngine, LiveAIMonitor, HistoricalTradeGenerator. |
| `admin_routes.py` | ~60 | stocks.db, predictions.db, price_history.db, data_engine.db, auth.db | All wrapped in `@require_admin`; uses `_get_db_path` helper with `db_manager.connection()` fallback pattern (Rule 54 / Phase 3). |
| `telegram_routes.py` | ~54 | content.db (telegram_messages, telegram_news, telegram_recommendations), stocks.db | Massive Telegram scraping/posting/ai-classify surface. |
| `portfolio_routes.py` | ~55 | stocks.db (portfolios, portfolio_assets), predictions.db | Blueprint registered BEFORE misc_bp so its `/api/portfolio/bag-holder-rescue` takes priority. Overlaps with FastAPI portfolio_router. |
| `misc_routes.py` | ~22 | stocks.db, predictions.db, price_history.db, data_engine.db | Many admin/trigger/rebuild endpoints. Has `/api/daily/rebuild-predictions` and `/api/predictions/generate-all` aliased. |
| `v2_routes.py` | ~17 | stocks.db, predictions.db | Persona/scanner/cached-analysis/morning-recommendations. Has `execute_db` for predictions writes. |
| `unified_learning_routes.py` | 21 | predictions.db (LEARNING_DB alias) | Iterative/intelligent learning + storage + mirror. |
| `ai_routes.py` | 21 | predictions.db (`PREDICTIONS_DB` from `ai.glm_finance_agent`) | Has `/api/ai/premium/predictions` (confluence_score = maestro×0.6 + ai×0.4). Note: `ai_router` not registered (see findings). |
| `risk_routes.py` | 22 | mostly stateless (computed risk plans) | Dynamic stop-loss/targets/trailing/decision-table. |
| `maestro_routes.py` | 14 | stocks.db (DATABASE_PATH env-overridable) | Maestro orchestrator endpoints; /status /regime /stock /persona /run /signals /circuit-breaker /news-check /overview /quick-scan /daily-opportunities /results |
| `sniper_routes.py` | 13 | price_history.db, predictions.db, data_engine.db | Includes /closer/run, /learning/* (uses PredictionTracker). |
| `stored_analysis_routes.py` | 12 (incl. market_bp) | predictions.db (stored_analyses, morning_bell_signals), stocks.db, data_engine.db | The famous `/api/stored-analysis/live-tracking` + `/api/market/morning-bell`. |
| `chart_routes.py` | 4 | stocks.db (DB_PATH), data_engine.db, predictions.db (in /full-analysis backtest) | Routes: `/<ticker>`, `/stats/intraday`, `/collect/now`, `/full-analysis`. |
| `public_routes.py` | 16 | stocks.db | Public stock listing, history, prices, analysis, indicators, predict, patterns, fibonacci, timing, market overview, sync, export. |
| `news_routes.py` | 9 | stocks.db (DATABASE_PATH), `NEWS_AGENT_DB` (content.db alias) | News CRUD + EGX scraping + AI agent. |
| `prediction_tracking_routes.py` | 11 (split across 2 bps) | predictions.db (writes), stocks.db, data_engine.db | /save, /list, /stats, /verify, /legacy-stats, /history, /pending, /evaluate, /check, /export, /summary. |
| `ai/portfolio_routes.py` (FastAPI) | 9 | finance.db (FINANCE_DB), predictions.db, stocks.db | Equity curve, state, cashflow, holdings, watchlists, risk-summary, smart-monitor/signals, real-return, bag-holder-rescue. |
| `v38_backtest_routes.py` | 6 | price_history.db, stocks.db | V38 institutional decision engine backtest. |
| `historical_predictions_v2_routes.py` | 4 | predictions.db, price_history.db, stocks.db | Heavy SSE per-stock persona backfill — used by /admin/honest-predictions. |
| `confluence_routes.py` | 5 | stocks.db (STOCKS_DB), predictions.db (writes in /generate-predictions) | ConfluenceEngineV3 + clean-signals. |
| `unified_v2_routes.py` | 7 | varies (calls underlying engines) | /markets, /personas, /config, /analyze, /scan, /compare-personas, /market-summary. |
| `learning_routes.py` | 5 | predictions.db (via unified_learning_engine) | /status, /run-backfill, /lessons, /regime-weights, /prediction-stats. |
| `ai_predictions_routes.py` | 7 | predictions.db | /info, /status, /generate, /evaluate, /stats, /list, /clear. |
| `analytics.py` | 7 | stocks.db (analytics.db → consolidated) | Track + admin/overview/page-views/feature-usage/sessions/resources + generate-daily-summary. |
| `optimizer_params_routes.py` | 4 | predictions.db (via prediction_optimizer.py) | /params GET/POST, /params/reset, /backtest. |
| `picks_management_routes.py` | 6 | predictions.db (daily-picks, active-management) | Daily Top-5 + HOLD/TRAIL/EXIT. |
| `notebook_routes.py` | 7 | stocks.db + analysis cache | List, stats, per-symbol, refresh, build-all, lesson, summary. |
| `persona_routes.py` | 4 | predictions.db (via PersonaEngine) | /investor, /gambler, /compare, /stock/<ticker>. |
| `reports_routes.py` | 11 | predictions.db + stocks.db (via reports_engine) | Daily/weekly/monthly summary + generate + list + publish/approve/reject. |
| `stocks.py` | 3 | stocks.db (DBPaths.STOCKS_DB) | /api/stocks/presets/list, /presets, /computed. |
| `sector_tracking_routes.py` | 2 | stocks.db (DBPaths.STOCKS_DB + FlowSystemEngine) | /api/sectors/tracking, /api/sectors/<name>/stocks. |
| `top_performers_routes.py` | 1 | data_engine.db (egksco_price_history) + stocks.db | /api/stocks/top-performers. |
| `professional_analysis_routes.py` | 1 | stocks.db (via ProfessionalAnalyzer) | /api/professional-analysis/<ticker>. |
| `advanced_screener_routes.py` | 1 | stocks.db (DBPaths.STOCKS_DB) | /api/screener/advanced (TradingView-style filter). |
| `stock_analysis_routes.py` | 1 | varies | /api/stock/deep-analysis only. |
| `screener_routes.py` | 3 | stocks.db (DBPaths.STOCKS_DB) | presets, scan, run-all. |
| `scanner_routes.py` | 3 | stocks.db (DATABASE_PATH env var) | /api/scanner/quick + /api/advanced-scanner/status + /run. |
| `regime_routes.py` | 3 | stocks.db + data_engine.db | /market, /stock/<ticker>, /overview. |
| `admin_engine_settings_routes.py` | 3 | predictions.db (active_settings.json + sys_config) | GET/POST/reset engine settings. |

### 2.3 الاكتشافات الرئيسية (Key Findings)

| # | Finding | Impact |
|---|---------|--------|
| 1 | `main.py:132` tries `from ai.api_routes import ai_router` but **`ai/api_routes.py` does not exist** → ImportError silently caught. `ai_router` is never mounted. | Dead import — non-fatal, but signals refactoring debt. |
| 2 | `main.py` defines `@app.get("/health")` (FastAPI), then later mounts Flask on `/`. Flask also defines `/health` (Flask `health_root`) → the FastAPI route wins (mounted first). | Could be confusing — same path, two implementations. |
| 3 | `prediction_tracking_routes.py` registers **two** blueprints (`prediction_tracking_bp` + `tracking_bp`) both at prefix `/api/predictions/tracking`. | No collision (different paths per bp), but unusual. |
| 4 | `v4_bp` (`expert_memory_v4_routes`) registration commented out in `lightweight_server.py:93-101` because the file was never created. Frontend has Next.js SQLite fallback. | Orphaned analyzer at `vps-service/analyzers/expert_memory_v4.py`. |

### 2.4 مطابقة الـ 144 Proxy Routes في Next.js

الـ 144 مسار Python-proxy في Next.js (موثقة في `AUDIT_FRONTEND_SCREENS_MAP.md`) تتوزع كالتالي:

| Next.js Proxy Pattern | Python Target | Count |
|------------------------|---------------|-------|
| `/api/proxy/[...path]` | Flask + FastAPI (admin-gated) | ~40 |
| `/api/python/[...path]` | Flask + FastAPI (transparent alias) | ~60 |
| `/api/python/v2/*` | `v2_routes.py` + `unified_v2_routes.py` | ~15 |
| `/api/maker-radar/*` | `maker_radar.py` + Flask endpoints | ~16 |
| `/api/predictions/*` (non-honest-tracking) | `prediction_tracking_routes.py` + `ai_predictions_routes.py` | ~13 |
| `/api/maestro/*` | `maestro_routes.py` | ~14 |
| `/api/sniper/*` | `sniper_routes.py` | ~13 |
| `/api/admin/*` (engine triggers) | `admin_routes.py` + `admin_engine_settings_routes.py` | ~20 |
| `/api/reports/proxy` | `reports_routes.py` | ~3 |
| `/api/v2/chart/full-analysis` | `chart_routes.py` | ~1 |
| `/api/flow/[ticker]` | `lightweight_server.py` (FlowSystemEngine) | ~1 |
| `/api/market-pulse` | `lightweight_server.py` (cached) | ~1 |
| `/api/rescue/analyze` | `bag_holder_rescue.py` (spawn) | ~1 |

---

## 3. تشريح قواعد البيانات العشرة

> **ملاحظة مهمة:** الـ `.db` files الحية موجودة فعلياً في `/tmp/my-project/db/` (وليس `/home/z/my-project/db/` الذي يحتوي JSON files + `custom.db` stub فقط لأن `.db` files في `.gitignore`).

### 3.1 الجدول الإجمالي

| # | DB | File Size | Tables | Active | Empty | Status |
|---|----|-----------|--------|--------|-------|--------|
| 1 | `predictions.db` | 280MB | 45 | 25 | 20 | ⚠️ 1 DEAD_LEGACY: `prediction_outcomes_old` |
| 2 | `stocks.db` | 29MB | 67 | 33 | 34 | ⚠️ 1 LEGACY-WITH-DATA: `stocks_backup` (345 rows) |
| 3 | `data_engine.db` | 58MB | 17 | 17 | 0 | ✅ CLEANEST — every table has data |
| 4 | `price_history.db` | 28MB | 2 | ? | ? | 🔴 CORRUPT (SQLITE_CORRUPT) |
| 5 | `intraday.db` | 448MB | 5 | 3 | 2 | ⚠️ stock-side intraday tables empty |
| 6 | `news.db` | 3.4MB | 3 | 1 | 2 | ⚠️ `news_api_keys`, `news_articles` orphaned |
| 7 | `auth.db` | 360KB | 22 | 11 | 11 | ⚠️ 11 orphaned incl. Session, VerificationToken, watchlist |
| 8 | `crypto.db` | 44KB | 4 | 0 | 4 | 🔴 ENTIRELY ORPHANED |
| 9 | `metrics.db` | — | — | — | — | ❌ ABSENT (lazy/auto-created) |
| 10 | `paper_trading.db` | — | — | — | — | ❌ ABSENT (lazy/auto-created) |

### 3.2 تفاصيل كل قاعدة

#### 3.2.1 `predictions.db` (280MB — 45 tables)

**Active tables (25):**
| Table | Rows | Notes |
|-------|------|-------|
| `predictions` | 651 | canonical — Python V40.2 writes here |
| `stored_analyses` | ~large | SINGLE-WRITER: `daily_predictor.py` (Rule 73) |
| `persona_predictions` | moderate | gambler/balanced/conservative personas |
| `prediction_logs` | moderate | execution audit |
| `outcome_logs` | moderate | trade outcomes |
| `learned_lessons` | moderate | iterative learning |
| `conjunction_patterns` | moderate | pattern recognition |
| `indicator_trust_scores` | moderate | per-indicator reliability |
| `morning_bell_signals` | moderate | daily morning report |
| `exit_notifications` | moderate | trade exit alerts |
| `backtest_results` | moderate | backtest snapshots |
| `optimizer_params_history` | moderate | optimizer state |
| `crypto_predictions_log` | moderate | crypto lab |
| `aiPredictionStats` | moderate | AI predictions stats |
| `telegram_recommendations` | low | telegram-bot picks |
| `telegram_signals` | low | telegram signal log |
| `user_trades` | low | user trade journal |
| + 8 more active tables | various | |

**Dead/orphaned tables (20):**
| Table | Rows | Status |
|-------|------|--------|
| `prediction_outcomes_old` | 0 | 🔴 DEAD_LEGACY — matches `_old` pattern |
| `aiPrediction` | 0 | 🔴 DEAD — legacy AI predictions (BREAKS production forecasts if queried) |
| + 18 more empty tables | 0 | ⚠️ legacy/never-written |

#### 3.2.2 `stocks.db` (29MB — 67 tables)

**Active tables (33):**
| Table | Rows | Notes |
|-------|------|-------|
| `stocks` | ~200+ | canonical — 66 cols incl. `is_egx30/70/100`, `smc_signal`, `turnover_egp` |
| `market_indices` | ~10 | EGX30/70/100/50/33 + indices |
| `stock_daily_prices` | ~large | daily OHLCV |
| `radar_signal_tracking` | moderate | 20 cols incl. `outcome_7d/14d/30d`, `data_quality`, `staleness_days` |
| `market_pulse_cache` | moderate | 21 cols incl. `regime_5`, `breadth` |
| `cached_analysis` | moderate | analyzer cache |
| `news` / `news_items` | moderate | news storage |
| `system_settings` | low | key-value config |
| `telegram_news` | low | telegram-scraped news |
| `market_regime_log` | moderate | 19-col audit (INSERT OR REPLACE) |
| `analytics_events` | ~919 | user analytics |
| `portfolio_assets` | moderate | user portfolios |
| `screener_presets` / `screener_results` | moderate | screener cache |
| `egx_fundamentals` | moderate | fundamental data |
| `egx_indices` | low | index metadata |
| + 17 more active tables | various | |

**Dead/orphaned tables (34):**
| Table | Rows | Status |
|-------|------|--------|
| `stocks_backup` | 345 | ⚠️ LEGACY-WITH-DATA — latest 2026-06-04, review for retirement |
| + 33 more empty tables | 0 | ⚠️ legacy/never-written |

#### 3.2.3 `data_engine.db` (58MB — 17 tables) — ✅ CLEANEST

كل الـ 17 tables نشطة (row count > 0):
| Table | Rows | Notes |
|-------|------|-------|
| `stocks` | moderate | data_engine copy |
| `stock_prices` | large | price cache |
| `crypto_prices` | large | crypto cache |
| `gold_prices` | ~129k | gold 24k/21k/18k history |
| `tab_balance_sheet` | moderate | fundamental |
| `tab_cash_flow` | moderate | fundamental |
| `tab_dividends` | moderate | fundamental |
| `tab_income_statement` | moderate | fundamental |
| `tab_performance` | moderate | fundamental |
| `tab_profitability` | moderate | fundamental |
| `tab_technical_analysis` | moderate | fundamental |
| `tab_valuation` | moderate | fundamental |
| `exchange_rates` | moderate | forex |
| `macro_indicators` | moderate | macro |
| `historical_data` | moderate | archive |
| `screener_presets` / `screener_results` / `screener_lists` | moderate | screener |
| `sync_status` | low | sync audit |

#### 3.2.4 `price_history.db` (28MB — 2 tables) — 🔴 CORRUPT

| Table | Status |
|-------|--------|
| `screener_daily` | 🔴 CORRUPT — `SQLITE_CORRUPT` on every query |
| `price_history` | 🔴 CORRUPT — 1.24M rows expected (25-year price history) |
| `sqlite_sequence` | recovered via raw byte scan |

**Cause:** Truncated WAL (`.db-wal` is 0 bytes while `.db-shm` is 32KB). Header is valid SQLite but B-tree pages damaged.
**Impact:** `chart_routes.py` /full-analysis backtest reads this → fails silently.
**Fix:** Run `sqlite3 .recover` or restore from backup.

#### 3.2.5 `intraday.db` (448MB — 5 tables)

| Table | Rows | Notes |
|-------|------|-------|
| `crypto_intraday` | large | 2-min candles (24/7) — ACTIVE |
| `commodity_intraday` | moderate | 15-min candles (24/7) — ACTIVE |
| `intraday_meta` | low | metadata — ACTIVE |
| `intraday_prices` | 0 | 🔴 EMPTY — stock-side intraday never written |
| `stock_intraday` | 0 | 🔴 EMPTY — stock-side intraday never written |

**Impact:** `IntradayPressurePanel.tsx` + `MarketDepthPanel.tsx` fetch `/api/market/intraday-pressure?ticker=COMI` → returns empty for EGX stocks.

#### 3.2.6 `news.db` (3.4MB — 3 tables)

| Table | Rows | Status |
|-------|------|--------|
| `market_news` | moderate | ACTIVE |
| `news_api_keys` | 0 | 🔴 ORPHANED |
| `news_articles` | 0 | 🔴 ORPHANED |

#### 3.2.7 `auth.db` (360KB — 22 tables)

**Active tables (11):**
| Table | Rows | Notes |
|-------|------|-------|
| `User` | ~moderate | 17 cols incl. `trial_ends_at`, `trial_deletion_scheduled_at` |
| `Account` | moderate | NextAuth OAuth accounts |
| `api_tokens` | moderate | API keys |
| `SubscriptionPlan` | low | 16 cols |
| `UserSubscription` | low | subscription tracking |
| `PromoCode` | low | promo codes |
| `PromoRedemption` | low | promo redemptions |
| `task_runs` | low | task audit |
| `ExpertRecommendation` | moderate | expert picks |
| `ExpertTrackRecord` | moderate | expert performance |
| `portfolio_items` / `portfolio_history` / `watchlist` / `price_alerts` / `market_pricing` / `analytics_events` / `user_telegram_links` / `bot_link_tokens` / `user_trades` | various | |

**Dead/orphaned tables (11):**
| Table | Rows | Status |
|-------|------|--------|
| `Session` | 0 | 🔴 NextAuth sessions (using JWT, not DB) |
| `VerificationToken` | 0 | 🔴 NextAuth email verify |
| `Post` | 0 | 🔴 legacy |
| + 8 more empty tables | 0 | ⚠️ legacy |

#### 3.2.8 `crypto.db` (44KB — 4 tables) — 🔴 ENTIRELY ORPHANED

| Table | Rows | Status |
|-------|------|--------|
| `crypto_watchlist` | 0 | 🔴 EMPTY |
| `crypto_portfolio` | 0 | 🔴 EMPTY |
| `crypto_simulation` | 0 | 🔴 EMPTY |
| `cryptos` | 0 | 🔴 EMPTY |

**Note:** Real crypto data lives in `data_engine.db.crypto_prices` + `predictions.db.crypto_predictions_log`. This DB is a dead stub from early schema init.

#### 3.2.9 `metrics.db` — ❌ ABSENT

**Reason:** Auto-created on first use by `src/lib/metrics-db.ts:5`. Doesn't exist in this environment because the feature hasn't been triggered yet.

#### 3.2.10 `paper_trading.db` — ❌ ABSENT

**Reason:** Auto-created on first use by `src/lib/paper-trading-v2-db.ts`. Doesn't exist because paper trading feature hasn't been used yet.

### 3.3 Cross-DB Fragmentation (consolidation opportunities)

| Table | DBs containing it | Recommended action |
|-------|-------------------|-------------------|
| `gold_prices` | data_engine.db (129k rows), gold_prices.db (6), stocks.db (3) | Consolidate to data_engine.db |
| `telegram_news` | telegram_data.db (11), stocks.db (6), predictions.db (0) | Consolidate to stocks.db |
| `analytics_events` | stocks.db (919), analytics.db (0), auth.db (0) | Consolidate to stocks.db |
| `Post` / `User` | auth.db + custom.db | Drop from custom.db |

### 3.4 Bonus DBs Discovered (8)

| DB | Tables | Status |
|----|--------|--------|
| `analytics.db` | 0 tables active | 🔴 entirely orphaned |
| `community.db` | 0 tables active | 🔴 entirely orphaned |
| `ai_search_cache.db` | 0 tables active | 🔴 entirely orphaned |
| `custom.db` | 0 tables active | 🔴 entirely orphaned (Prisma migrations stub) |
| `crypto_learning.db` | 9 active | mixed |
| `gold_prices.db` | 6 rows | redundant (see fragmentation) |
| `historical.db` | 8 active | mixed |
| `telegram_data.db` | 11 active | mixed |

---

## 4. محركات توليد البيانات والسكربتات الدورية

### 4.1 المصدر الكنسي للـ cron

**`/home/z/my-project/crontab.txt`** — 26 مدخل موثق (single source of truth per Rule 21 + Rule 35). `vps-service/crontab.txt` deprecated.

### 4.2 الأسئلة الثمانية الرئيسية + الإجابات

| # | السؤال | السكربت | DBs WRITES | Trigger |
|---|--------|---------|------------|---------|
| 1 | من يحسب التوقعات ويحفظها؟ | `vps-service/jobs/daily_predictor.py` (V40.2) | `predictions.db.predictions` (DELETE+INSERT via PredictionTracker) + `predictions.db.stored_analyses` (UPSERT — SINGLE-WRITER Rule 73) | cron #1 03:00 UTC + cron #1b 13:30 UTC + `market_scheduler.run_v40_2_generation` كل 15 دقيقة |
| 2 | من يشغل رادار الميكرز؟ | `scripts/maker_radar.py` | `stocks.db.radar_signal_tracking` (CREATE+DELETE+INSERT) + JSON cache `scripts/output/maker_radar_<MARKET>_<DATE>.json` | cron #26 — `*/5 8-14 UTC` EGX/TADAWUL/KSE/QSE/US + `*/5 24/7` CRYPTO/GOLD |
| 3 | من يحدّث الأسعار اللحظية والشموع اليومية؟ | `data_engine/main.py` (Flask + while-loop) + `tradingview_scraper.py` (cron #7) + `daily_price_updater.py` (cron #6) + `market_scheduler.run_intraday_prices` (15 min) + `update_egx_indices.py` (15:05 Cairo) | `data_engine.db.stocks` (UPDATE/INSERT), `stocks.db.stocks` (UPDATE), `stocks.db.stock_daily_prices` (UPSERT), `price_history.db.price_history` (write_guarded source='tradingview_live'), `stocks.db.egx_indices` | layered cron + pm2 scheduler |
| 4 | من يحدّث بيانات intraday؟ | `data_engine/intraday_storage.py` (called from `data_engine/main.py`) | `intraday.db.stock_intraday` (5 min, market hrs), `crypto_intraday` (2 min, 24/7), `commodity_intraday` (15 min, 24/7), `intraday_meta`, daily DELETE cleanup (7-day retention) | internal scheduler loop (time.sleep 60) |
| 5 | من يحدّث EGX30/70/100؟ | `vps-service/scripts/update_egx_indices.py` | `price_history.db.price_history` (EGX30+EGX100 tickers), `stocks.db.egx_indices` (metadata) | `market_scheduler.run_egx_indices_update` يومياً 15:05 Cairo. ⚠️ **EGX70 غير متغطّى** (INDICES = ['EGX30','EGX100'] فقط) |
| 6 | من يشغل محرك الميز (Market Regime)? | `vps-service/analyzers/market_regime_engine.py` (MarketRegimeEngine) | `stocks.db.system_settings` (UPSERT current regime), `stocks.db.market_regime_log` (INSERT OR REPLACE — 19-col audit) | cron #15 daily 02:50 UTC + cron #15b weekly Sat 02:55 UTC (`--all`) + `run_morning_regime_check` on startup |
| 7 | من يولّد Wyckoff screener؟ | `scripts/maker_radar.py` (primary — detects Quiet Accumulation / Explosive Surge / Early Break via `utils/shared_liquidity.py`) + `hmm_market_regime.py` (secondary HMM-based, READ-ONLY) | `stocks.db.radar_signal_tracking` (CREATE+DELETE+INSERT) | cron #26 (5-min radar) |
| 8 | من يشغل عيادة الإنقاذ؟ | `vps-service/analyzers/bag_holder_rescue.py` (BagHolderRescue class) — **READ-ONLY تماماً** (mode=ro URI). Actual DB writes of alerts come from `market_scheduler._run_bag_holder_alerts` (P31, every 15 min) → `stocks.db.user_notifications` (CREATE+INSERT, type='bag_holder_alert', idempotent per user+ticker+day) | on-demand API + scheduler |

### 4.3 مخطط الكتابة الإجمالي (DB Write Inventory)

| DB | Writers | Tables Written |
|----|---------|-----------------|
| `stocks.db` | 13 writers | stocks, stock_daily_prices, egx_indices, radar_signal_tracking, macro_indicators, wealth_tracking, portfolio_assets, system_settings, market_regime_log, screener_results, screener_presets, market_pulse_cache, user_notifications, egx_fundamentals, cached_analysis |
| `predictions.db` | 9 writers | predictions, stored_analyses, exit_notifications, learned_lessons, sniper_performance, corporate_actions, hunter_pick_tracking, crypto_predictions_log |
| `price_history.db` | 5 writers | (all via `write_guarded` — sources: `tradingview_live`, `yahoo_safetynet`, `intraday_aggregated`, `yahoo_us`, plus EGX30/100 index inserts) |
| `intraday.db` | 1 writer (`intraday_storage.py` only) | stock_intraday, crypto_intraday, commodity_intraday, intraday_meta |
| `data_engine.db` | 6 writers | stocks, crypto_prices, btc_local_prices, gold_prices, silver_prices, exchange_rates, sharia_* × 6 tables |
| `disclosures.db` | 1 writer (`egx_disclosure_engine.py` only) | egx_disclosures |
| `auth.db` | 1 writer (`scripts/downgrade-expired-subscriptions.ts` via Prisma/bun, cron #24) | User (subscription_tier updates) |

### 4.4 الأنماط المعمارية المكتشفة

1. **SINGLE-WRITER (Rule 73)** — `daily_predictor.py` is the only writer to `predictions.db.stored_analyses`. `intraday_scanner.py` and `market_scheduler.run_live_trailing_stop_update` both have `SKIP_STORED_ANALYSES_WRITE = True` guards to prevent last-writer-wins conflicts.

2. **write_guarded (Rule 66)** — All `price_history.db` writes go through `data/source_authority.py::write_guarded()` which enforces one canonical source per market.

3. **db_manager (Rule 54)** — Most jobs use `db_manager.connection(writable=True)` with fallback to raw `sqlite3.connect`. Forces WAL + busy_timeout=30000 + foreign_keys=ON.

4. **READ-ONLY analyzers** (compute in-memory, return via API):
   - `bag_holder_rescue.py` (rescue clinic)
   - `hmm_market_regime.py` (HMM regime detection)
   - `nightly_quant_job.py` (nightly quant analysis)
   - `price_history_stale_monitor.py` (stale data monitor)
   - `data_heartbeat_checker.py` (data heartbeat)
   - `post_market_feedback.py` (post-market feedback)
   - `weekly_radar_report.py` (weekly radar report)
   - `telegram_comprehensive_report.py` (telegram report)

5. **Three main schedulers** (independent processes):
   - `market_scheduler.py` (Python, 60s tick loop)
   - `data_engine/main.py` (Flask + 60s loop)
   - `scripts/master_scheduler.py` (legacy, `schedule.every`)

### 4.5 الـ 26 cron entries (from `crontab.txt`)

| # | Schedule | Script | Purpose |
|---|----------|--------|---------|
| 1 | 03:00 UTC | `daily_predictor.py` | V40.2 predictions generation |
| 1b | 13:30 UTC | `daily_predictor.py` | Midday V40.2 refresh |
| 2 | 02:50 UTC | `market_regime_engine.py` | Daily regime analysis |
| 6 | daily | `daily_price_updater.py` | Daily candle updates |
| 7 | 5min | `tradingview_scraper.py` | Live price scraping |
| 15 | 02:50 UTC | `market_regime_engine.py` | Daily regime |
| 15b | Sat 02:55 UTC | `market_regime_engine.py --all` | Weekly full regime scan |
| 24 | daily | `downgrade-expired-subscriptions.ts` | Subscription expiry |
| 26 | `*/5 8-14 UTC` | `maker_radar.py` | 5-min radar scan (EGX + multi-market) |
| + 17 more entries | various | various | See `crontab.txt` for full list |

---

## 5. تقاطع الـ 303 مسار Next.js مع SQLite

### 5.1 إحصائيات إجمالية

| Access method | Count |
|---------------|-------|
| Direct `better-sqlite3` import | 103 routes |
| Direct `new Database(` call | 95 routes |
| Prisma Client (auth.db) | 4 routes |
| Via shared lib helper module | 215 routes |
| **Total SQLite-touching routes** | **276-335** (lower bound 276 pure, upper bound 335 hybrid) |

### 5.2 Top 10 helper modules مستخدمة من Next.js

| Helper Module | Routes |
|---------------|--------|
| `@auth-helper` | 39 |
| `@db` (Prisma auth.db re-export) | 35 |
| `@finance-db` | 32 |
| `@flutter-sqlite-fallback` | 23 |
| `@egx-db` | 20 |
| `@admin-db-manager` | 14 |
| `@data-engine-db` | 9 |
| `@db-auth` | 6 |
| `@paper-trading-v2-db` | 6 |
| `@honest-tracking/maestro` | 5 |

### 5.3 Top 10 أكثر الجداول قراءة من Next.js مباشرة

| Rank | Table | Routes | Read/Write split |
|------|-------|--------|------------------|
| 1 | `stocks` | 70 | 65 read / 5 write |
| 2 | `predictions` | 38 | 35 read / 3 write |
| 3 | `portfolio_assets` | 23 | 20 read / 3 write |
| 4 | `user_stock_watchlists` | 14 | 8 read / 6 write (auth.db, Next.js-only) |
| 5 | `crypto` | 12 | read-only |
| 6 | `price_history` | 11 | 10 read / 1 write |
| 7 | `gold_prices` | 11 | read-only (Python writes via daleelak_api.py) |
| 8 | `stock_price_history` | 8 | 7 read / 1 write |
| 9 | `market_news` | 8 | 7 read / 1 write |
| 10 | `stock_daily_prices` | 7 | read-only (Python writes via data_engine/sync.py) |

### 5.4 أمثلة على مسارات Next.js تـ WRITE إلى SQLite

| Route | Operation | DB | Table | Risk |
|-------|-----------|-----|-------|------|
| `src/app/api/admin/backtest/v40/run/route.ts` | **DELETE FROM predictions** | predictions.db | predictions | ⚠️ DESTRUCTIVE WIPE |
| `src/app/api/sniper/track/route.ts` | INSERT INTO predictions | predictions.db | predictions | ⚠️ violates Rule 35 (only daily_predictor should write) |
| `src/app/api/telegram/publish-stock/route.ts` | UPDATE predictions | predictions.db | predictions | audit trail |
| `src/app/api/admin/sync-vps/route.ts` | INSERT INTO stocks + stock_price_history | stocks.db | stocks, stock_price_history | admin sync |
| `src/app/api/admin/scrape-stocks/route.ts` | INSERT INTO stocks | stocks.db | stocks | admin scrape |
| `src/app/api/admin/import-stocks/route.ts` | INSERT INTO stocks | stocks.db | stocks | admin import |
| `src/app/api/market/sync/route.ts` | UPDATE currency_rates | stocks.db | currency_rates | market sync |
| `src/app/api/market/scheduled-sync/route.ts` | UPDATE stocks | stocks.db | stocks | scheduled sync |
| `src/app/api/market/sync-live/route.ts` | UPDATE stocks | stocks.db | stocks | live sync |
| `src/app/api/maker-radar/signal-tracker/verify/route.ts` | UPDATE radar_signal_tracking | data_engine.db + stocks.db | radar_signal_tracking | verify |
| `src/app/api/watchlist/route.ts` + `[id]/route.ts` | INSERT/UPDATE/DELETE user_stock_watchlists | auth.db | user_stock_watchlists | Next.js-only (no Python conflict) |
| `src/app/api/finance/transactions/route.ts` | INSERT INTO financial_transactions | auth.db | financial_transactions | finance |
| `src/app/api/admin/purge-cache/route.ts` | DELETE FROM cached_analysis, prediction_logs, signal_logs, stored_analyses | multiple | multiple | admin purge |
| `src/app/api/auth/login/route.ts` + `auth/google/route.ts` | INSERT INTO api_tokens | auth.db | api_tokens | auth |

---

## 6. نقاط التضارب الحسابي (Conflict Points)

### 6.1 WRITE-WRITE Conflicts (10 tables written by BOTH Next.js AND Python)

| Table | NX routes | PY files | Severity |
|-------|-----------|----------|----------|
| **stocks** | 5 | 32 | ⚠️ CRITICAL |
| **predictions** | 3 | 22 | ⚠️ CRITICAL |
| `prediction_logs` | 1 | 6 | High |
| `portfolio_assets` | 3 | 3 | High |
| `price_history` | 1 | 4 | High |
| `radar_signal_tracking` | 1 | 4 | High |
| `stored_analyses` | 1 | 3 | Medium |
| `ExpertRecommendation` | 2 | 1 | Medium |
| `market_news` | 1 | 1 | Low |
| `cached_analysis` | 1 | 1 | Low |

### 6.2 6 DB files at risk (shared between Next.js + Python writers)

| DB | Risk | Mitigation |
|----|------|------------|
| `db/stocks.db` | ⚠️ 5 NX writers + 32 PY writers | Only `predictions.db` in `NO_CACHE_DB_NAMES` currently |
| `db/predictions.db` | ⚠️ 3 NX writers + 22 PY writers | ✅ In `NO_CACHE_DB_NAMES` (safe) |
| `db/price_history.db` | ⚠️ 1 NX writer + 4 PY writers (write_guarded) + 🔴 CORRUPT | Needs recovery first |
| `db/data_engine.db` | ⚠️ NX reads + 6 PY writers | Add to `NO_CACHE_DB_NAMES` |
| `db/news.db` | ⚠️ 1 NX writer + 1 PY writer | Add to `NO_CACHE_DB_NAMES` |
| `db/intraday.db` | ⚠️ NX reads + 1 PY writer (intraday_storage) | Add to `NO_CACHE_DB_NAMES` |

### 6.3 أخطر 3 تضاربات

#### 🔴 1. `predictions.db.predictions` (CRITICAL)
- **Next.js:** `admin/backtest/v40/run` يفعل `DELETE FROM predictions` (destructive wipe) + `sniper/track` يفعل INSERT (يخالف Rule 35) + `telegram/publish-stock` يفعل UPDATE
- **Python:** 22 سكربت يكتبون بما فيها `daily_predictor.py` (SINGLE-WRITER لـ `stored_analyses` لكن ليس لـ `predictions`)
- **Impact:** Backtest run قد يمسح توقعات إنتاجية حقيقية أثناء عمل الـ daily_predictor

#### 🔴 2. `stocks.db.stocks` (CRITICAL)
- **Next.js:** 5 routes تـ UPDATE/INSERT (admin/sync-vps, admin/scrape-stocks, admin/import-stocks, market/sync, market/scheduled-sync, market/sync-live)
- **Python:** 32 سكربت يكتبون (data_engine/main, sync.py, daily_price_updater, tradingview_scraper, update_egx_indices، إلخ)
- **Impact:** WAL mode يستخدم لكن لا يوجد coordination → 70 reading routes قد ترى stale data

#### 🟠 3. `stocks.db.radar_signal_tracking` (HIGH — three-way conflict)
- **Next.js:** `maker-radar/signal-tracker/verify` + `radar-signal-tracker.ts` (internal helper)
- **Python:** `verify_radar_signals.py` + `maker_radar.py`
- **Impact:** verify operations قد تتعارض مع CREATE+DELETE+INSERT من `maker_radar.py` أثناء الـ 5-min scan

---

## 7. التوصيات والإصلاحات المقترحة

### 7.1 إصلاحات عاجلة (Critical)

1. **استعادة `price_history.db`** من backup أو تشغيل `sqlite3 .recover` — غير قابل للاستخدام حالياً (SQLITE_CORRUPT). يؤثر على `chart_routes.py` /full-analysis backtest.

2. **حماية `predictions.db.predictions` من الكتابة العشوائية:**
   - `admin/backtest/v40/run` يجب ألا يفعل `DELETE FROM predictions` على قاعدة الإنتاج — استخدم DB منفصلة للـ backtest
   - `sniper/track` يجب أن يتوقف عن INSERT إلى predictions — يخالف Rule 35 المعلن في نفس الملف
   - `telegram/publish-stock` يجب أن يستخدم audit table منفصلة (مثل `telegram_signals` الموجودة بالفعل)

3. **إضافة الـ 5 DBs المشتركة إلى `NO_CACHE_DB_NAMES`** في `src/lib/shared-db.ts`:
   - `db/stocks.db`
   - `db/data_engine.db`
   - `db/price_history.db`
   - `db/news.db`
   - `db/intraday.db`
   - (مخاطرة segfault عند reuse connection لو Python كاتب的同时)

### 7.2 إصلاحات متوسطة (High)

4. **حذف أو إعادة توظيف الـ 5 DBs المهجورة بالكامل:**
   - `crypto.db` (4 tables كلها فارغة — real crypto في data_engine.db)
   - `analytics.db` (0 tables active)
   - `community.db` (0 tables active)
   - `ai_search_cache.db` (0 tables active)
   - `custom.db` (0 tables active — Prisma migrations stub)

5. **حذف الجداول المهجورة:**
   - `predictions.db.prediction_outcomes_old` (rows=0, matches `_old` pattern)
   - `predictions.db.aiPrediction` (rows=0 — يكسر التوقعات في الإنتاج لو اُستعلم)
   - `stocks.db.stocks_backup` (345 rows, stale 2026-06-04 — archivable)

6. **تغطية EGX70:** `update_egx_indices.py` لا يحدّث EGX70 (INDICES = ['EGX30','EGX100'] فقط). يجب إضافة 'EGX70' للقائمة.

7. **تنشيط intraday stock tables:** `intraday.db.stock_intraday` و `intraday_prices` فارغة. `IntradayPressurePanel.tsx` + `MarketDepthPanel.tsx` يفشلان في عرض بيانات EGX intraday.

### 7.3 إصلاحات منخفضة (Medium/Low)

8. **توحيد الـ env vars للـ Python backend:** 6 env vars مختلفة (`PYTHON_BACKEND_URL`, `VPS_API_URL`, `PYTHON_API_URL`, `EGXPY_SERVICE_URL`, `EGX_VPS_API_URL`, `EGXPY_BRIDGE_URL`). توحيد كل المسارات لاستيراد `PYTHON_BACKEND_URL` من `@/lib/python-backend` (~50 مسار لا يزال يستخدم الأنماط القديمة).

9. **توحيد الجداول المبعثرة:**
   - `gold_prices` موجود في 3 DBs (data_engine=129k, gold_prices.db=6, stocks.db=3) → consolidate إلى data_engine.db
   - `telegram_news` موجود في 3 DBs (telegram_data=11, stocks=6, predictions=0) → consolidate إلى stocks.db
   - `analytics_events` موجود في 3 DBs (stocks=919, analytics=0, auth=0) → consolidate إلى stocks.db

10. **إصلاح dead imports في `main.py`:**
    - `from ai.api_routes import ai_router` → الملف غير موجود (ImportError silenced)
    - `v4_bp` registration معلق (file never created)
    - توثيق أو حذف هذه الـ dead paths

11. **تنشيط أو حذف `metrics.db` + `paper_trading.db`:** lazy/auto-created — إما تشغيل الميزة مرة لإنشائها أو توثيق لماذا هي مؤجلة.

12. **مراجعة orphaned analyzer:** `vps-service/analyzers/expert_memory_v4.py` — الـ blueprint معلق، لكن الـ analyzer موجود. إما استكمال أو حذف.

### 7.4 خريطة الإصلاح المقترحة (Roadmap)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Restore price_history.db | Low (1h) | Critical (backtest) |
| P0 | Protect predictions.db from NX writes | Medium (4h) | Critical (data integrity) |
| P0 | Add 5 DBs to NO_CACHE_DB_NAMES | Low (30min) | Critical (segfault prevention) |
| P1 | Drop 5 orphaned DBs | Low (1h) | High (cleanup) |
| P1 | Drop dead tables (aiPrediction, _old) | Low (1h) | High (prevent production bugs) |
| P1 | Add EGX70 to update_egx_indices | Low (15min) | High (missing index) |
| P2 | Consolidate fragmented tables | Medium (1d) | Medium (consistency) |
| P2 | Unify Python env vars | Medium (4h) | Medium (maintainability) |
| P3 | Activate intraday stock tables | High (1w) | Medium (feature completion) |
| P3 | Fix dead imports in main.py | Low (1h) | Low (code hygiene) |

---

## 📊 الملخص النهائي

| المقياس | القيمة |
|---------|--------|
| **Python endpoints** | ~503 (42 Flask + 452 Blueprint + 9 FastAPI) |
| **DBs المفحوصة** | 16 (8 مطلوبة + 8 bonus) |
| **DBs غائبة** | 2 (metrics.db, paper_trading.db — lazy) |
| **DB تالف** | 1 (price_history.db — SQLITE_CORRUPT) |
| **DBs مهجورة بالكامل** | 5 (crypto.db, analytics.db, community.db, ai_search_cache.db, custom.db) |
| **إجمالي الجداول** | 197 |
| **جداول مهجورة/ميتة** | ~95 |
| **سكربتات دورية** | 26 cron entries |
| **محركات كتابة رئيسية** | 7 |
| **مسارات Next.js تقرأ SQLite** | 276-335 |
| **Top table (reads)** | `stocks` (70 routes) |
| **نقاط تضارب كتابة** | 10 tables |
| **أخطر تضارب** | `predictions.db.predictions` (CRITICAL) |
| **DBs في NO_CACHE_DB_NAMES** | 1 فقط (predictions.db) — يجب إضافة 5 آخرين |

---

*نهاية التقرير — الجرد التشريعي الكامل للباك إند وقواعد البيانات*
*يكمل هذا التقرير `AUDIT_FRONTEND_SCREENS_MAP.md` لنحصل على **«الأشعة السينية الكاملة للمنصة»***
