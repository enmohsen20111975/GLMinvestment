# 02 — قواعد البيانات والداتا

> **مصدر الحقيقة:** الكود الفعلي (`.prisma` + `.ts` + `.py` + grep على أسماء الـ DBs). آخر مراجعة: 2026-10-19.
>
> ⚠️ هذا الملف يكشف **17 قاعدة بيانات** + **تعارضات حقيقية** في الكود. أي توثيق قديم بيقول رقم أقل = كاذب.

---

## 🗄️ الـ Prisma Schemas (3 ملفات)

### 1. `prisma/auth-schema.prisma` — قاعدة بيانات المصادقة
- **Datasource**: `provider = "sqlite"`, `url = "file:../db/auth.db"`
- **Generator**: `prisma-client-js` → `output = "../node_modules/@prisma/auth-client"`
- **المالك**: Next.js (Prisma-managed). Python بـ reads via raw SQL (`core/auth_middleware.py`).
- **19 model**:

| Model | المفتاح | الوظيفة |
|---|---|---|
| `User` | id @cuid, email @unique, username @unique | المستخدم — subscription_tier default "free", trial_ends_at, last_active_at |
| `Account` | @@unique([provider, providerAccountId]) | OAuth accounts |
| `Session` | sessionToken @unique | NextAuth sessions |
| `VerificationToken` | @@unique([identifier, token]) | NextAuth tokens |
| `SubscriptionPlan` | name @unique | price, trial_days, max_watchlist, max_portfolio, max_alerts, ai_analysis, deep_analysis |
| `UserSubscription` | user_id @unique → SubscriptionPlan | status, trial_started_at, trial_ends_at, auto_renew |
| `ApiToken` | token @unique (@@map "api_tokens") | API tokens للموبايل |
| `UserTelegramLink` | user_id @unique, telegram_chat_id @unique (@@map "user_telegram_links") | BOT-SUBSCRIPTION-GATE |
| `AdvancedAnalysisResult` | @@unique([ticker, scan_date]) (@@map "advanced_analysis_results") | نتايج التحليل المتقدم |
| `DailyAnalysisSummary` | scan_date @unique (@@map "daily_analysis_summaries") | ملخص يومي |
| `PromoCode` | code @unique | premium_days, plan_tier |
| `Watchlist` | @@unique([user_id, ticker]) (@@map "watchlist") | قائمة المتابعة |
| `PortfolioItem` | (@@map "portfolio_items") | asset_type, symbol, shares, purchase_price |
| `PortfolioHistory` | (@@map "portfolio_history") | date, total_value, profit_loss |
| `MarketPricing` | @@unique([tier, market, billing_cycle]) | multi-market pricing |
| `Referral` | referred_id @unique | code, bonus_days |
| `UsageDaily` | @@unique([user_id, date]) | usage limits يومي |
| `B2bApiKey` | key @unique | monthly_limit |

### 2. `prisma/predictions-schema.prisma` — قاعدة بيانات التوقعات
- **Datasource**: `provider = "sqlite"`, `url = "file:../db/predictions.db"`
- **Generator**: `prisma-client-js` → `output = "../node_modules/@prisma/predictions-client"`
- **المالك**: Next.js-owned (Prisma-managed)، Python بـ writes عبر `core/analysis_runner.py` + `core/persona_db.py`.
- **10 model**:

| Model | المفتاح | الوظيفة |
|---|---|---|
| `Prediction` | id @id autoincrement, ticker, signal, signal_type, prediction_date (@@map "predictions") | entry_price, target_price, stop_loss, master_score, technical/fundamental/ai_pattern/sentiment scores, outcome_date, exit_price, actual_return, hit_target, hit_stop, holding_days, market default "EGX", confidence, exit_reason, persona, target_price_2, status, pnl_pct, morning_bell, published_at, telegram_message_id, was_published, target_hit_at, stop_hit_at |
| `PersonaPrediction` | id String @id, persona_type, signal_type, status default "PENDING" (@@map "persona_predictions") | dual-persona predictions |
| `PredictionLog` | (@@map "prediction_logs") | 40+ عمود — verification 5d/10d/20d — مهاجَر من stocks.db |
| `ExpertRecommendation` | stock_symbol, expert_name, action | entry/target/stop, status default "PENDING" |
| `ExpertTrackRecord` | expert_name @unique | success_rate, avg_return |
| `CachedAnalysis` | stock_symbol @unique | cache |
| `StoredAnalysis` | @@unique([ticker, market]) (@@map "stored_analyses") | Background Engine |
| `AnalysisJob` | job_type, status default "pending" (@@map "analysis_jobs") | jobs queue |
| `AnalysisEngineStatus` | id @default("main") (@@map "analysis_engine_status") | engine status |
| `TechnicalIndicator` | @@unique([stock_symbol, indicator_name, timestamp]) | technical indicators |

> **ملاحظة**: `src/lib/honest-tracking/maestro.ts:ensureSchema()` بيـ ALTER TABLE يضيف أعمدة وقت الـ runtime — DB هو source of truth.
> **Header comment** يوضح: `predictions` (5000+ rows), `persona_predictions` (686 rows), `prediction_logs` (43 rows). `aiPrediction` و `platform_recommendations` اتـ DROPPED.

### 3. `prisma/schema.prisma` — **placeholder وليس active**
- بيحتوي على `User` + `Post` بس (scaffold افتراضي من `prisma init`).
- `datasource db { url = env("DATABASE_URL") }` — يعتمد على `.env` (`DATABASE_URL=file:./db/auth.db`).
- **لا generator output مخصص** → يستخدم default Prisma Client.
- **الخلاصة**: placeholder. الـ operational schemas الفعلية هما `auth-schema.prisma` + `predictions-schema.prisma`.

### `prisma/seed-subscriptions.ts`
بيـ connect بـ `db` (auth client → auth.db) من `../src/lib/db`. بيـ delete كل SubscriptionPlan الموجودة، ثم بـ insert **3 plans**:

| Plan | price (EGP) | trial_days | watchlist | portfolio | alerts | ملاحظات |
|---|---|---|---|---|---|---|
| `free` (مجاني) | 0 | 14 | 5 | 1 | 3 | RESTRUCT-A-P2.5: كان 0 → 14 |
| `normal` (عادى) | 99/mo (990 yearly) | 7 | 25 | 5 | unlimited | |
| `premium` (مميز) | 199/mo (1990 yearly) | 14 | unlimited | unlimited | unlimited | + AI + priority |

> `MarketPricing` model يدعم b2b_starter/pro/enterprise وعملات متعددة (EGP/SAR/KWD/QAR/USD) — لكن الـ seed بـ يزرع 3 plans بـ EGP بس. الـ B2B/multi-market pricing لازم يتـ seed بشكل منفصل.

---

## 📦 كل ملفات `.db` المستخدمة في الكود (17 DB)

### 1. `stocks.db` — canonical stocks + technicals + finance
- **المالك**: Python (writer عبر `data_engine/sync.py`)، Next.js (reader).
- **Read-Write (Next.js)**: `src/lib/shared-db.ts`, `src/lib/egx-db.ts`, `src/lib/data-engine-db.ts`, `src/lib/finance-db.ts`.
- **Read-only (Next.js)**: `src/lib/unified-stock-data.ts`, `src/lib/honest-tracking/maestro.ts`, `src/lib/market-data-access.ts`, عشرات API routes.
- **Python**: `vps-service/config.py` (DATABASE_PATH default = stocks.db)، `vps-service/core/database.py`, `vps-service/core/db_manager.py` (alias 'stocks').
- **Tables**: `stocks` (PK ticker)، `stock_daily_prices` (UNIQUE ticker+price_date)، `stock_adaptive_profiles`، `market_indices`، `market_indices_history`، `portfolio_assets`، `user_stock_watchlists`، `user_notifications`، `price_alerts`، `financial_transactions`، `outcome_logs`، `conjunction_patterns`، `context_logs`، `indicator_trust_scores`، `learned_lessons`، `cached_analysis`، `news_items`، `macro_indicators`، `gold_prices` (**LEGACY** — 3 stale rows 2026-06-03)، `price_history` (view)، `stock_price_history` (view).

### 2. `predictions.db` — Prisma-managed, Next.js-owned
- **Python writers**: `vps-service/core/db_manager.py` (alias 'predictions')، `vps-service/core/persona_db.py`، `vps-service/core/analysis_runner.py`.
- **Next.js**: `src/lib/db-predictions.ts`، `src/lib/shared-db.ts` (NO_CACHE_DB_NAMES — re-opened each time لأن Python writes تـ invalidate cached Node connections).
- **Tables**: الـ 10 models في predictions-schema.prisma + `prediction_lessons` + `learned_lessons_predictions`.

### 3. `auth.db` — Prisma-managed, Next.js-owned
- **Next.js**: `src/lib/db-auth.ts`، `src/lib/last-active-helper.ts` (read-write updates last_active_at)، `src/lib/bot-link-db.ts` (read-write raw SQL على UserTelegramLink).
- **Python reader**: `vps-service/core/auth_middleware.py` (subscription_tier lookup)، `vps-service/core/db_manager.py` (alias 'auth').
- **Tables**: كل models في auth-schema.prisma + `user_telegram_links`.

### 4. `data_engine.db` — Python-owned (data_engine scrapers write)
- **Next.js readers**: `src/lib/data-engine-db.ts` (read-write WAL)، `src/lib/data-engine-db-sqljs.ts` (read-only sql.js)، `src/lib/shared-db.ts`، `src/lib/market-data-access.ts`، `src/lib/gold-history-helper.ts`، `src/lib/unified-db.ts`.
- **Python**: `vps-service/core/db_manager.py` (alias 'data_engine')، `vps-service/scripts/update_metals_and_forex.py` (writes gold/silver/forex)، scripts متعددة.
- **Writers (data_engine/scrapers/)**: tradingview_scraper, tradingview_rest, tradingview_market_movers, tradingview_screener_lists, egksco_scraper, egxpilot_scraper, yahoo_scraper, metals_forex_fetcher, crypto_fetcher, update_fundamentals, fetch_logos, fallback_chain, historical_fetcher, historical_fetcher_5years, sharia_compliance_scraper.
- **Tables**: `stocks` (live — symbol/name/price/change_percent/volume/market_cap/market — Arabic market names)، `egksco_price_history` (EGX historical — migrated from price_history.db)، `historical_data` (TADAWUL/US/Forex/Gold multi-market)، `crypto_prices`، `gold_prices` (canonical live — written by metals_forex_fetcher كل 5 دقايق، Arabic "عيار N")، `silver_prices`، `exchange_rates`، `screener_lists`، `market_movers_tabs`، `tab_valuation`، `tab_profitability`، `egksco_stocks`.

### 5. `price_history.db` — ⚠️ LEGACY (تعارض — مخازن متوازية)
- **Next.js**: `src/lib/new-db.ts`، `src/lib/egx-db.ts` (read-write)، `src/lib/shared-db.ts`، `src/lib/honest-tracking/maestro.ts` (PRICE_DB_PATH)، `src/app/api/finance/calculate-values/route.ts`.
- **Python PRIMARY**: `vps-service/config.py` (PRICE_HISTORY_DB_PATH)، `vps-service/core/database.py` (PRIMARY read — table `price_history`, 1.24M rows)، `vps-service/core/db_manager.py` (alias 'price_history').
- **Writer**: `data_engine/scrapers/us_stock_scraper.py` (Yahoo OHLCV).
- ⚠️ **CONFLICT موثّق**: `data-engine-db.ts:50` بيقول "price_history.db was removed. Now reads from data_engine.db.egksco_price_history." بس `vps-service/core/database.py:608-634` لسه بـ يستخدمها كـ PRIMARY، و `stocks.db.stock_daily_prices` كـ Fallback 1، و `egypt_stocks.db.historical_data` كـ Fallback 3. **أربع مخازن متوازية لنفس البيانات**.

### 6. `news.db` — Python-owned (single source of truth)
- **Next.js readers**: `src/lib/flutter-sqlite-fallback.ts`، `src/app/api/news/route.ts` (read-write)، `src/app/api/news/latest/route.ts`، `src/app/api/news-feed/route.ts`، `src/app/api/mobile/news/route.ts`، `src/app/api/admin/news/route.ts`، `src/app/api/data-engine/control/route.ts`.
- **Python**: `vps-service/analyzers/news_fetcher_analyzer.py` (PRIMARY read)، `vps-service/core/migrator.py` (DDL).
- **Writer**: `data_engine/scrapers/news_scraper.py` + `news-agent/`.
- **Tables**: `market_news` (**canonical** — Rule 44 NEWS-DB-SOT، renamed from `news_articles` 2026-09-02)، legacy `news_articles` (مهاجَر).

### 7. `intraday.db` — Python-owned (intraday_storage writes)
- **Next.js readers**: `src/app/api/market/intraday-pressure/route.ts`، `src/app/api/stocks/[ticker]/depth/route.ts`، `src/app/api/live-monitor/route.ts`، `src/app/api/chart/[ticker]/route.ts`، `src/app/api/maker-radar/market-intelligence/route.ts`.
- **Python**: `data_engine/intraday_storage.py` (writer, 5-min snapshots)، `vps-service/scripts/backfill_intraday.py`، `vps-service/scripts/dual_track_generator.py`.
- **Tables**: `stock_intraday` (340K+ rows, 970 tickers)، `crypto_intraday`، `commodities_intraday`.
- ⚠️ **schema drift**: `vps-service/core/migrator.py:628` بـ يعرف `intraday_prices` table مختلفة — يحتمل إنها superseded بـ `stock_intraday`.

### 8. `historical.db` — multi-market historical
- **Next.js**: `src/lib/market-data-access.ts`، `src/lib/shared-db.ts`.
- **Python**: `data_engine/sync.py` (writes)، `data_engine/scrapers/historical_fetcher.py` (writes)، `vps-service/align_production_symbols.py`.
- **Tables**: `historical_prices` (richest multi-market source — TADAWUL, EGX, KSE, QSE, Crypto, Forex, Metals, Indices).

### 9. `crypto.db` — ⚠️ partial legacy (live prices moved out)
- **Python**: `vps-service/core/crypto_database.py` (read-write)، `vps-service/lightweight_server.py` (crypto watchlist + portfolio)، `vps-service/core/db_manager.py` (alias 'crypto').
- **Tables**: `cryptos` (**LEGACY** — superseded by data_engine.db.crypto_prices)، `crypto_prediction_logs`، `crypto_watchlist`، `crypto_portfolio`، `user_crypto_trades`.
- ⚠️ **CONFLICT**: `src/app/api/crypto/simulation/route.ts` و `src/app/api/unified-stocks/route.ts` بيقولوا "RESTRUCT-CLEANUP-1: was crypto.db.cryptos → now data_engine.db.crypto_prices". live prices اتـ migration لـ data_engine.db؛ **crypto.db لسه بـ يحتفظ بـ watchlist/portfolio tables**. تقسيم غير موثّق في مكان واحد.

### 10. `gold_prices.db` — ⚠️ PHANTOM (never existed as real file!)
- **References**: `src/lib/sqlite-admin.ts`، `src/app/api/admin/db-backup/route.ts` (في backup list)، `src/modules/admin/components/SystemControlPanel.tsx`.
- ⚠️ **CONFLICT موثّق**: `vps-service/core/db_manager.py:108-110` بيقول "gold_prices canonical = data_engine.db (live). OLD: pointed at GOLD_PRICES_DB which defaulted to non-existent `gold_prices.db`." يعني **gold_prices.db مش ملف حقيقي**. الـ canonical = `data_engine.db.gold_prices`.

### 11. `community.db` — ⚠️ layer mismatch
- **Next.js**: `src/lib/community-db.ts` (read-write مباشر على db/community.db).
- ⚠️ **CONFLICT**: `vps-service/core/db_manager.py:112` بـ يـ alias 'community' → STOCKS_DB (consolidated July 2026). بس Next.js لسه بـ يفتح community.db كملف منفصل. **Layer mismatch** بين الـ sideين.

### 12. `market.db` — legacy / sharia scraper
- **References**: `data_engine/scrapers/sharia_compliance_scraper.py` (read-write للـ harvest ticker matches)، `src/app/api/admin/db-backup/route.ts`.
- **Status**: غير واضح — يمكن deprecated.

### 13. `bot-link.db` — ⚠️ غير موجود (تسمية مضللة)
- `src/lib/bot-link-db.ts` بـ يفتح **`auth.db`** مباشرة (line 101) ويـ query/update جدول `user_telegram_links`. **مفيش ملف bot-link.db منفصل.**

### 14. `custom.db` — REMOVED
- **Deprecation comments**: `src/lib/new-db.ts`، `src/lib/finance-db.ts`، `src/lib/egx-db.ts`. "custom.db has been removed. Use Prisma with auth.db for user data or stocks.db for stock data."
- Still listed in `src/lib/sqlite-admin.ts` as "Prisma default schema (DATABASE_URL)".

### 15. `egypt_stocks.db` — sandbox/dev fallback (غير رسمي)
- **References**: `src/lib/honest-tracking/maestro.ts`، `src/lib/sqlite-admin.ts`، `vps-service/core/database.py:685-696` (Fallback 3 — comment صريح: "egypt_stocks.db مش قاعدة بيانات رسمية للمشروع — أضيفت كـ fallback للساندبوكس بس").
- **الخلاصة**: مش DB رسمية — sandbox/dev fallback.

### 16. `crypto_learning.db` — small learning store
- **References**: `vps-service/core/db_manager.py` (alias 'crypto_learning')، `src/lib/sqlite-admin.ts`، `src/lib/crypto-learning-store.ts`.

### 17. `unified_stocks.db` — legacy name only
- **References**: `src/lib/unified-db.ts`. الكود دلوقتي بـ يفتح `stocks.db` (line 82-83: "Use stocks.db (contains 1,298 stocks with real data)"). اسم `unified_stocks.db` بيظهر بس في log strings — **مش ملف فعلي**.

---

## 🗺️ الخريطة الكنسية للداتا (Canonical Data Map)

| Domain | Canonical source | ملاحظات |
|---|---|---|
| **أسعار أسهم تاريخية (EGX)** | `data_engine.db.egksco_price_history` (Next.js side) **+** `price_history.db.price_history` (Python side, 1.24M rows) **+** `stocks.db.stock_daily_prices` **+** `historical.db.historical_prices` | ⚠️ **4 مخازن متوازية** — CONFLICT موثّق |
| **أسعار أسهم live (EGX)** | `data_engine.db.stocks` (scrape target) → synced لـ `stocks.db.stocks` بـ `data_engine/sync.py` | data_engine.db = scrape target؛ stocks.db = consumed snapshot |
| **أسعار كريبتو** | `data_engine.db.crypto_prices` (live — CoinGecko/Binance/CoinCap) | migrated من `crypto.db.cryptos` (RESTRUCT-CLEANUP-1) |
| **أسعار دهب/معادن** | `data_engine.db.gold_prices` + `silver_prices` (live — metals.dev/Daleelak كل 5 دقايق) | ⚠️ `gold_prices.db` phantom (مش ملف حقيقي)؛ `stocks.db.gold_prices` stale (3 rows 2026-06-03، disabled) |
| **forex** | `data_engine.db.exchange_rates` (Frankfurter/exchangerate-api/Daleelak) | `historical.db.historical_prices` بيحتفظ بـ Forex historical |
| **intraday data** | `intraday.db.stock_intraday` (340K+ rows, 970 tickers, 5-min snapshots) + `crypto_intraday` + `commodities_intraday` | source: `data_engine.db` snapshots |
| **أخبار** | `news.db.market_news` (Rule 44 NEWS-DB-SOT) | Writers: News Agent + `news_scraper.py` |
| **توقعات** | `predictions.db.predictions` (Prisma-managed) + `persona_predictions` + `prediction_logs` | Writers: Python (`analysis_runner.py`) + Next.js (`honest-tracking/maestro.ts`) — Both layers share the DB |
| **مستخدمين + اشتراكات** | `auth.db` (Prisma-managed) | custom.db REMOVED — كل user data في auth.db |

---

## ⚠️ التعارضات المعروفة (موثّقة من الكود)

| # | التعارض | الخطورة | التفاصيل |
|---|---|---|---|
| 1 | **price_history.db vs data_engine.db.egksco_price_history** | 🔴 CRITICAL | Next.js هاجر لـ data_engine.db لكن Python لسه بـ يعامل price_history.db كـ PRIMARY. **مخازن متوازية**. |
| 2 | **gold_prices.db phantom** | 🟠 HIGH | مذكور في `sqlite-admin.ts` و db-backup list بس **مش ملف حقيقي**. Canonical فعلي = `data_engine.db.gold_prices`. |
| 3 | **stocks.db.gold_prices stale** | 🟡 MEDIUM | 3 rows من 2026-06-03 — disabled صراحة في `unified-db.ts:460-461`. |
| 4 | **crypto.db split** | 🟠 HIGH | live prices → `data_engine.db.crypto_prices`؛ watchlist/portfolio → `crypto.db`. تقسيم غير موثّق. |
| 5 | **schema.prisma (root) placeholder** | 🟡 MEDIUM | User+Post بس. الـ operational schemas هما auth + predictions بـ generator outputs منفصلة. |
| 6 | **custom.db removed** | 🟢 LOW | deprecated عبر finance-db.ts, new-db.ts, egx-db.ts. user data → auth.db؛ stock data → stocks.db. |
| 7 | **egypt_stocks.db** | 🟢 LOW | مش DB رسمي — sandbox/dev fallback. |
| 8 | **community.db layer mismatch** | 🟠 HIGH | Next.js بـ يفتح community.db كملف؛ Python db_manager.py بـ alias 'community' → STOCKS_DB. |
| 9 | **market.db** | 🟡 MEDIUM | مذكور في sharia_compliance_scraper.py + db-backup list. Status غير واضح. |
| 10 | **WAL contention** | 🟡 MEDIUM | shared DBs (data_engine, stocks, price_history, historical, intraday) بتـ يفتحها Next.js READ-WRITE (shared-db.ts) بس عشان reconcile Python's WAL journal — Next.js never actually writes لهم. |
| 11 | **bot-link-db.ts تسمية مضللة** | 🟢 LOW | الاسم بـ يشير لـ bot-link.db، بس فعلياً بـ يفتح auth.db. |
| 12 | **intraday.db schema drift** | 🟡 MEDIUM | `migrator.py:628` بـ يعرف `intraday_prices` table مختلفة عن `stock_intraday` اللي بـ يستخدمها intraday_storage.py. |

---

## 🔌 better-sqlite3 + sql.js usage

### better-sqlite3 (84 ملف في src/)
الـ DB driver الأساسي لـ Node-side. أبرز الملفات:
- **Central openers**: `shared-db.ts` (WAL-safe opener with retry + immutable fallback snapshot)، `data-engine-db.ts`، `egx-db.ts`، `finance-db.ts`، `new-db.ts`، `db-predictions.ts`، `db-auth.ts` (Prisma layered on top — بعض raw SQL paths بـ يستخدم better-sqlite3).
- **Specialized**: `bot-link-db.ts`، `community-db.ts`، `metrics-db.ts`، `paper-trading-v2-db.ts`، `last-active-helper.ts`، `sqlite-admin.ts`، `admin-db-manager.ts`، `honest-tracking/maestro.ts`، `trade-results-engine.ts`، `unified-stock-data.ts`، `flutter-sqlite-fallback.ts`، `market-data-access.ts`.
- **API routes**: ~50+ route في `src/app/api/`.
- **Modules**: `radar/lib/radar-db.ts`، `radar-signal-tracker.ts`، `personalized/lib/personalized-radar.ts`.

### sql.js (1 ملف فقط)
- **`src/lib/data-engine-db-sqljs.ts`**: WebAssembly SQLite. بديل لـ better-sqlite3 لـ تجنب مشاكل native module مع Next.js bundler.
  - `getDataEngineDbSqlJs()` — read-only على data_engine.db.
  - `getPriceHistoryDbSqlJs()` — backward-compat wrapper بـ يـ route لـ data_engine.db.
  - `getStocksDbSqlJs()` — read-only على stocks.db.
  - `DbCompat` wrapper بـ يحول async SqlJsDatabase لـ mock sync API.
- Setup: `scripts/copy-sqljs-to-standalone.js` + `scripts/edit-sqljs.py` (WASM for standalone).

---

## 🌐 مصادر البيانات الخارجية (scrapers/APIs)

### EGX stocks live (multi-source fallback chain)
| Source | Endpoint | File |
|---|---|---|
| **EGKSCO** (PRIMARY EGX HTML) | `https://egksco-online.com/etrade/Sectors.aspx` + `Stock.aspx?Code={symbol}.CA` | `data_engine/scrapers/egksco_scraper.py` |
| **EGXPilot** (EGX REST API) | `https://egxpilot.com/api/stocks/all` | `data_engine/scrapers/egxpilot_scraper.py`، `vps-service/analyzers/production_data_client.py` |
| **Yahoo Finance (yfinance)** | yfinance lib، ticker suffix `.CA` for EGX | `data_engine/scrapers/yahoo_scraper.py` |
| **TradingView scanner** | `https://scanner.tradingview.com/{market}/scan` (egypt/saudi/kuwait/qatar/global) | `data_engine/scrapers/tradingview_rest.py`، `update_fundamentals.py` |
| **TradingView symbols page** | `https://www.tradingview.com/symbols/EGX-{ticker}/` | `data_engine/scrapers/technical_fetcher.py` |
| **TradingView market movers** | `https://ar.tradingview.com/markets/stocks-egypt/market-movers-{gainers,losers,active,unusual-volume,high-dividend}/` | `data_engine/scrapers/tradingview_market_movers.py` |
| **TradingView logos** | `https://ar.tradingview.com/markets/stocks-{ksa,egypt,kuwait,qatar}/market-movers-all-stocks/` | `data_engine/scrapers/fetch_logos.py` |
| **Fallback chain orchestrator** | circuit-breaker على egksco/yahoo/egxpilot | `data_engine/scrapers/fallback_chain.py` |

### US stocks & multi-market
| Source | Endpoint | File |
|---|---|---|
| **Yahoo Finance yfinance** | OHLCV → price_history.db.price_history | `data_engine/scrapers/us_stock_scraper.py` |
| **Yahoo query1 API** | `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}` | `vps-service/scripts/egx_backtest/fetch_egx_data.py`، `vps-service/analyzers/production_data_client.py` |

### Crypto
| Source | Endpoint | File |
|---|---|---|
| **CoinGecko** | `https://api.coingecko.com/api/v3/{coins/markets, simple/price, coins/{id}/ohlc, coins/{id}/market_chart, global, status_updates}` | `data_engine/scrapers/crypto_fetcher.py`، `vps-service/core/crypto_database.py`، متعددة |
| **Binance** | `https://api.binance.com/api/v3/ticker/24hr` | `data_engine/scrapers/crypto_fetcher.py` |
| **CoinCap** | `https://api.coincap.io/v2/assets` | `data_engine/scrapers/crypto_fetcher.py` |

### Metals (gold/silver)
| Source | Endpoint | File |
|---|---|---|
| **metals.dev** | `https://api.metals.dev/v1/latest?api_key={key}&currency=USD&unit=toz` | `data_engine/scrapers/metals_forex_fetcher.py` |
| **Daleelak** (Egypt-local EGP gold, "عيار N") | `https://getdaleelak.com/api/v1/feed.json?category=metals` | `data_engine/scrapers/metals_forex_fetcher.py` |

### Forex
| Source | Endpoint | File |
|---|---|---|
| **Frankfurter** | `https://api.frankfurter.dev/v2/rates?base=USD` | `data_engine/scrapers/metals_forex_fetcher.py` |
| **exchangerate-api** | `https://api.exchangerate-api.com/v4/latest/USD` | `data_engine/scrapers/crypto_fetcher.py` |
| **Daleelak currencies** | `https://getdaleelak.com/api/v1/feed.json?category=currencies` | `data_engine/scrapers/metals_forex_fetcher.py` |

### News
| Source | Endpoint | File |
|---|---|---|
| **NewsAPI** | `https://newsapi.org/v2/everything` | `data_engine/scrapers/news_scraper.py` |
| **GNews** | `https://gnews.io/api/v4/search` | `data_engine/scrapers/news_scraper.py` |
| **AlphaVantage** | `https://www.alphavantage.co/query` | `data_engine/scrapers/news_scraper.py` |
| **mediastack** | `http://api.mediastack.com/v1/news` | `data_engine/scrapers/news_scraper.py` |
| **News Agent collectors** | RSS / Telegram / mubasher / investing (disabled) / egx_news / tradingview / daleelak / marketmaker | `news-agent/collectors/` |

### Sharia compliance
| Source | Endpoint | File |
|---|---|---|
| **templatesnippet.com** (static JSON) | `https://stocks.templatesnippet.com/data/stocks_merged.json` | `data_engine/scrapers/sharia_compliance_scraper.py` |
| **Harvest references** | halalbourse.com, musaffa.com, kashif.app, halalinvest.com, fib.com.eg, osoul-securities.com, thndr.net | `data_engine/scrapers/sharia_compliance_scraper.py` |

### Internal cross-service URLs
- `data_engine/sync.py:29` → `http://localhost:3005/broadcast` (WS service).
- `data_engine/realtime_sync.py:13` → `http://localhost:3000/api/data-engine/reload` (Next.js webhook).

---

## 🔒 سلامة قواعد البيانات (Rule 1 + Rule 6)

- **ممنوع** الكتابة في أي `.db` على الإنتاج (`/root/GLMinvestment/db/*.db`) — `SELECT` بس.
- استرجاع DB يكون **فقط** عبر `vps-service/tools/restore_from_local.py` وبعد تأكيد المالك.
- في الساندبوكس: اسمح بالكتابة في `db/vps_real/` فقط (gitignored).
- أي script/route بقرأ من `predictions.db` **لازم** يفحص الأعمدة بـ `PRAGMA table_info` قبل SELECT (Rule 6 — schema-aware).
- `shared-db.ts` بيفتح shared DBs READ-WRITE بس عشان reconcile WAL journal — **مش بـ يـ write فعلياً**.

---

*هذا الملف مكتوب من الكود الحقيقي. لأي تعديل أو إضافة، ارجع للكود الفعلي أولاً.*
