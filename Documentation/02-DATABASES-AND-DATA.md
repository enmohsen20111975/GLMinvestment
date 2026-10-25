<div dir="rtl" lang="ar">

# 02 — قواعد البيانات والبيانات (Databases & Data Layer)

> **المصدر الموحّد للحقيقة:** الكود الفعلي فقط — `prisma/*.prisma` + `src/lib/db*.ts` + `vps-service/core/db_manager.py` + `vps-service/core/database.py` + `data_engine/scrapers/*` + `grep` على أسماء الـ DBs.
> **آخر تحديث:** 2026-10-24 (إعادة كتابة شاملة بواسطة Bravo+GLM).
> **القاعدة الحاكمة:** Rule 1 — لا تُلمس DBs الإنتاج. Rule 17 — مسارات نسبية فقط. Rule 67 — كل حساب له canonical file واحد.

---

## 📑 جدول المحتويات

1. [نظرة عامة (Overview)](#1-نظرة-عامة-overview)
2. [Prisma Schemas الثلاثة](#2-prisma-schemas-الثلاثة)
3. [الـ 9 قواعد بيانات الفعلية (Active DBs)](#3-الـ-9-قواعد-بيانات-الفعلية-active-dbs)
4. [جداول كل DB بالتفصيل](#4-جداول-كل-db-بالتفصيل)
5. [الـ DBs المُلغاة أو الوهمية (Legacy / Phantom)](#5-الـ-dbs-المُلغاة-أو-الوهمية-legacy--phantom)
6. [Data Access Layer — DAL (Python)](#6-data-access-layer--dal-python)
7. [DB Client Layer — Node.js / Next.js](#7-db-client-layer--nodejs--nextjs)
8. [WAL Mode + Locking Protocol](#8-wal-mode--locking-protocol)
9. [مصادر البيانات الخارجية (Data Sources)](#9-مصادر-البيانات-الخارجية-data-sources)
10. [الـ 27 scraper في data_engine/scrapers/](#10-الـ-27-scraper-في-data_enginescrapers)
11. [تدفق البيانات الكامل (Data Flow)](#11-تدفق-البيانات-الكامل-data-flow)
12. [الخريطة الكنسية للداتا (Canonical Data Map)](#12-الخريطة-الكنسية-للداتا-canonical-data-map)
13. [التعارضات الموثّقة (Documented Conflicts)](#13-التعارضات-الموثّقة-documented-conflicts)
14. [بروتوكولات النسخ الاحتياطي والاسترجاع](#14-بروتوكولات-النسخ-الاحتياطي-والاسترجاع)
15. [better-sqlite3 vs sql.js](#15-better-sqlite3-vs-sqljs)
16. [اختبارات الصحة و cron jobs](#16-اختبارات-الصحة-و-cron-jobs)

---

## 1. نظرة عامة (Overview)

GLMinvestment مبني على معمارية **SQLite متعددة الـ DBs** (multi-database architecture). كل DB لها مالك (writer) ومستهلك (reader) محدّدين بدقّة. مفيش DB واحدة عملاقة — بدلاً من ذلك فيه **9 DBs نشطة** مقسّمة على Domain مسؤوليات واضحة:

| # | DB | المالك (Writer) | المُستهلك (Reader) | الحجم تقريباً |
|---|----|-----------------|---------------------|---------------|
| 1 | `stocks.db` | Python (`data_engine/sync.py`) | Next.js + Python | ~0.3 MB (metadata) — bigger with stock_daily_prices |
| 2 | `predictions.db` | Python (`analysis_runner.py`) + Next.js (`honest-tracking/maestro.ts`) | الاثنان | متغيّر (~5000+ rows) |
| 3 | `auth.db` | Next.js (Prisma) | Next.js + Python (auth_middleware) | ~0.6 MB |
| 4 | `data_engine.db` | Python (`data_engine/scrapers/*`) | Next.js + Python | ~18 MB |
| 5 | `price_history.db` | Python (`us_stock_scraper.py` + `price_history_safetynet.py`) | Next.js + Python | ~58 MB (1.31M rows, latest 2026-10-21) |
| 6 | `intraday.db` | Python (`data_engine/intraday_storage.py`) | Next.js + Python | 340K+ rows, 970 tickers, 5-min snapshots |
| 7 | `news.db` | Python (`news_scraper.py` + `news-agent/`) | Next.js + Python | متغيّر |
| 8 | `crypto.db` | Python (`crypto_database.py`) | Next.js + Python | small (watchlist/portfolio only — live prices migrated) |
| 9 | `metrics.db` | Next.js (`src/lib/metrics-db.ts`) | Next.js admin | صغير |

> **قاعدة:** كل DB لها **كاتب واحد (single writer)** ومتعدد القرّاء. الكتابة المتزامنة على نفس الـ DB من مصدرين = خطر WAL contention — موثّق في §8.

### لماذا SQLite وليس PostgreSQL؟

- **Zero-config**: لا حاجة لـ DB server على الـ VPS (4GB RAM فقط).
- **WAL mode**: يدعم القراءة المتزامنة مع الكتابة (readers لا يحجبون writer والعكس).
- **File-based**: الـ backup = نسخ ملفات. الـ restore = استبدال ملفات.
- **Cross-process**: Python و Node.js يقرآن نفس الملف بأمان (مع `busy_timeout=30000`).
- **Cross-platform**: الساندبوكس والإنتاج يشتغلان على نفس الـ schema.

---

## 2. Prisma Schemas الثلاثة

المشروع فيه 3 ملفات `.prisma` في `prisma/`:

### 2.1 — `prisma/auth-schema.prisma` (Active — primary auth schema)

| البند | القيمة |
|---|---|
| **Datasource** | `provider = "sqlite"`, `url = "file:../db/auth.db"` |
| **Generator** | `prisma-client-js`, output → `../node_modules/@prisma/auth-client` |
| **المالك** | Next.js (Prisma-managed). Python يقرأ عبر raw SQL في `core/auth_middleware.py`. |
| **Number of models** | 19 |

**الـ 19 model بالترتيب الأبجدي:**

| Model | المفتاح الأساسي | @@map (اسم الجدول الفعلي) | الوظيفة |
|---|---|---|---|
| `User` | `id @cuid`, `email @unique`, `username @unique` | (default: `User`) | المستخدم — subscription_tier default "free", trial_ends_at, last_active_at |
| `Account` | `id String @id`, `@@unique([provider, providerAccountId])` | (default: `Account`) | OAuth accounts (Google, GitHub, ...) |
| `Session` | `sessionToken @unique` | (default: `Session`) | NextAuth sessions |
| `VerificationToken` | `@@unique([identifier, token])` | (default: `VerificationToken`) | NextAuth tokens |
| `SubscriptionPlan` | `name @unique` | (default: `SubscriptionPlan`) | price, trial_days, max_watchlist, max_portfolio, max_alerts, ai_analysis, deep_analysis |
| `UserSubscription` | `user_id @unique` | (default: `UserSubscription`) | status, trial_started_at, trial_ends_at, auto_renew |
| `ApiToken` | `token @unique` | `api_tokens` | API tokens للموبايل |
| `UserTelegramLink` | `user_id @unique`, `telegram_chat_id @unique` | `user_telegram_links` | BOT-SUBSCRIPTION-GATE — ربط حساب تليجرام بحساب موقع |
| `AdvancedAnalysisResult` | `@@unique([ticker, scan_date])` | `advanced_analysis_results` | نتايج التحليل المتقدم (RSI/MACD/BB/Stochastic/ patterns) |
| `DailyAnalysisSummary` | `scan_date @unique` | `daily_analysis_summaries` | ملخص يومي (total_stocks, alive_stocks, buy_opportunities, ...) |
| `PromoCode` | `code @unique` | (default: `PromoCode`) | premium_days, plan_tier |
| `Watchlist` | `@@unique([user_id, ticker])` | `watchlist` | قائمة متابعة المستخدم (مع alert_price_above/below) |
| `PortfolioItem` | `id @cuid` | `portfolio_items` | asset_type (stock/gold/realestate/deposit/certificate/currency), shares, purchase_price |
| `PortfolioHistory` | `id @cuid` | `portfolio_history` | date, total_value, profit_loss |
| `MarketPricing` | `@@unique([tier, market, billing_cycle])` | `market_pricing` | multi-market pricing (tier × market × billing_cycle) |
| `Referral` | `referred_id @unique` | `referrals` | code, bonus_days, reward_given |
| `UsageDaily` | `@@unique([user_id, date])` | `usage_daily` | usage limits يومي (ai_messages_used, watchlist_count, ...) |
| `B2bApiKey` | `key @unique` | `b2b_api_keys` | monthly_limit, requests_this_month |

**الحقول المهمة في `User`:**
- `subscription_tier String @default("free")` — `free` / `normal` / `premium` / `developer` / `b2b_starter` / `b2b_pro` / `b2b_enterprise`
- `default_risk_tolerance String @default("medium")` — `low` / `medium` / `high`
- `trial_ends_at DateTime?` — نهاية فترة التجربة المجانية
- `trial_warning_sent_at DateTime?` — هل أُرسل تنبيه قرب انتهاء التجربة؟
- `trial_deletion_scheduled_at DateTime?` — هل تمت جدولة حذف الحساب بعد انتهاء التجربة؟
- `last_active_at DateTime?` — آخر نشاط للمستخدم (تحديث كل 5 دقايق عبر `/api/track` + `auth-helper.ts`)

### 2.2 — `prisma/predictions-schema.prisma` (Active — primary predictions schema)

| البند | القيمة |
|---|---|
| **Datasource** | `provider = "sqlite"`, `url = "file:../db/predictions.db"` |
| **Generator** | `prisma-client-js`, output → `../node_modules/@prisma/predictions-client` |
| **المالك** | Next.js-owned (Prisma-managed)، Python بـ writes عبر `core/analysis_runner.py` + `core/persona_db.py`. |
| **Number of models** | 10 |

**الـ 10 model بالترتيب:**

| Model | @@map | LOC | الوظيفة |
|---|---|---|---|
| `Prediction` | `predictions` | ~60+ columns | التواصل بين Python و Next.js. يشمل: ticker, signal, signal_type, entry_price, target_price, stop_loss, master_score, technical_score, fundamental_score, ai_pattern_score, sentiment_score, outcome_date, exit_price, actual_return, hit_target, hit_stop, is_correct, holding_days, market, confidence, exit_reason, risk_reward, atr_at_entry, highest_price_reached, lowest_price_reached, is_trend_following, trailing_stop_atr_mult, initial_stop_atr_mult, exit_type, persona, target_price_2, status, pnl_pct, closed_at, morning_bell, published_at, telegram_message_id, was_published, target_hit_at, stop_hit_at |
| `PersonaPrediction` | `persona_predictions` | ~14 columns | dual-persona (gambler + investor) — persona_type, signal_type, entry/target/stop, profit_loss_percent |
| `PredictionLog` | `prediction_logs` | 40+ columns | verification 5d/10d/20d — مهاجَر من stocks.db |
| `ExpertRecommendation` | (default name) | ~25 columns | stock_symbol, expert_name, action, entry/target/stop, technical_analysis, fundamental_analysis, expected_duration_days |
| `ExpertTrackRecord` | (default name) | ~12 columns | expert_name @unique, total_recommendations, successful_recommendations, success_rate, avg_return |
| `CachedAnalysis` | (default name) | 3 columns | stock_symbol @unique, analysis_data (JSON), last_updated |
| `StoredAnalysis` | `stored_analyses` | ~20 columns | Background Engine — maestro_score, recommendation, confidence, entry_price, target_price, stop_loss, risk_reward, regime, regime_score, regime_confidence, timeframe_score, timeframe_aligned, volume_ratio, liquidity_rating, news_risk_level, has_cbe_news, analysis_json, analysis_type, analysis_version |
| `AnalysisJob` | `analysis_jobs` | ~12 columns | job_type, market, ticker, priority, status (pending/running/completed/failed), progress, total, result, error |
| `AnalysisEngineStatus` | `analysis_engine_status` | ~10 columns | is_running, current_market, current_ticker, total_analyzed, total_pending, last_full_analysis, last_run, next_scheduled_run, error_count, last_error |
| `TechnicalIndicator` | (default name) | 6 columns | stock_symbol, indicator_name, indicator_value, signal, timestamp — `@@unique([stock_symbol, indicator_name, timestamp])` |

> **ملاحظة هامة:** `src/lib/honest-tracking/maestro.ts:ensureSchema()` بـ يضيف أعمدة وقت الـ runtime عبر `ALTER TABLE` للـ migration compatibility. **DB هو source of truth**، Prisma model للـ typing فقط. الـ schema drift بين الـ Prisma model و الـ DB الفعلي متوقّع ومدعوم بـ fallback columns.

### 2.3 — `prisma/schema.prisma` (⚠️ Placeholder — غير مستخدم فعلياً)

| البند | القيمة |
|---|---|
| **Datasource** | `provider = "sqlite"`, `url = env("DATABASE_URL")` |
| **Generator** | `prisma-client-js` (default output — لا output مخصص) |
| **Number of models** | 2 (`User` + `Post` — scaffold افتراضي من `prisma init`) |
| **Status** | placeholder. الـ operational schemas الفعلية هما `auth-schema.prisma` + `predictions-schema.prisma`. |

> **تحذير:** Rule 128 — ممنوع لمس `schema.prisma` بدون موافقة المالك. الـ file ده موجود لأسباب تاريخية + environment variable resolution. لا تضيف ولا تحذف منه.

### 2.4 — `prisma/seed-subscriptions.ts`

سكربت seeding لـ `auth.db` بـ يـ connect بـ `db` (auth client → auth.db) من `../src/lib/db`. بيـ delete كل SubscriptionPlan الموجودة، ثم بـ insert **3 plans**:

| Plan | price (EGP) | trial_days | watchlist | portfolio | alerts | ملاحظات |
|---|---|---|---|---|---|---|
| `free` (مجاني) | 0 | 14 | 5 | 1 | 3 | RESTRUCT-A-P2.5: كان 0 → 14 |
| `normal` (عادى) | 99/mo (990 yearly) | 7 | 25 | 5 | unlimited | |
| `premium` (مميز) | 199/mo (1990 yearly) | 14 | unlimited | unlimited | unlimited | + AI + priority_support |

> `MarketPricing` model يدعم b2b_starter / b2b_pro / b2b_enterprise وعملات متعددة (EGP/SAR/KWD/QAR/USD) — لكن الـ seed بـ يزرع 3 plans بـ EGP بس. الـ B2B/multi-market pricing لازم يتـ seed بشكل منفصل عبر Admin UI.

---

## 3. الـ 9 قواعد بيانات الفعلية (Active DBs)

كل ملفات `.db` نشطة موجودة في `db/` (مع `.db-wal` و `.db-shm` لـ WAL mode). المسار النسبي من جذر المشروع = `db/<name>.db`.

### 3.1 — `stocks.db` — canonical stocks + technicals + finance

| البند | القيمة |
|---|---|
| **المسار** | `db/stocks.db` |
| **المالك (Writer)** | Python — `data_engine/sync.py` (يحدّث `stocks`, `stock_daily_prices`), `vps-service/jobs/daily_predictor.py` (يحدّث `indicator_weights`, `learned_lessons`) |
| **القرّاء Next.js** | `src/lib/shared-db.ts`, `src/lib/egx-db.ts`, `src/lib/data-engine-db.ts`, `src/lib/finance-db.ts`, `src/lib/unified-stock-data.ts`, `src/lib/honest-tracking/maestro.ts`, `src/lib/market-data-access.ts`, عشرات API routes |
| **القرّاء Python** | `vps-service/config.py` (DATABASE_PATH default = stocks.db), `vps-service/core/database.py`, `vps-service/core/db_manager.py` (alias `'stocks'`) |
| **DB Alias in db_manager** | `'stocks'`, `'telegram_data'` → stocks, `'analytics'` → stocks, `'community'` → stocks |
| **الحجم** | متغيّر — أكبر جزء `stock_daily_prices` (~1.3M rows) |

**الجداول الأساسية (verified via `PRAGMA table_info`):**

| Table | الوظيفة | حجم تقريبي |
|---|---|---|
| `stocks` | PK `ticker`. آخر سعر، sector, market_cap, pe_ratio, roe, debt_to_equity, is_active | ~1,298-1,350 صف |
| `stock_daily_prices` | UNIQUE(ticker, price_date). OHLCV يومي لكل سهم | ~1.3M صف |
| `stock_adaptive_profiles` | ملف تكيّفي لكل سهم (volatility_class, atr_pct, ...) | per-ticker |
| `market_indices` | EGX30, EGX70, EGX100, TADAWUL, ... | ~20 صف |
| `market_indices_history` | EOD indices history | 100K+ |
| `portfolio_assets` | أصول المحفظة (per-user snapshot) | متغيّر |
| `user_stock_watchlists` | قوائم متابعة قديمة (superseded by auth.db.Watchlist) | legacy |
| `user_notifications` | إشعارات المستخدمين | متغيّر |
| `price_alerts` | تنبيهات الأسعار (above/below) | متغيّر |
| `financial_transactions` | حركات مالية | متغيّر |
| `outcome_logs` | سجلات النتائج | متغيّر |
| `conjunction_patterns` | أنماط اقتران المؤشرات (Learning Engine output) | learning artifacts |
| `context_logs` | سجلات سياق التحليل | debug logs |
| `indicator_trust_scores` | درجة ثقة كل مؤشر (0-1) | per-indicator |
| `learned_lessons` | دروس مستفادة (Learning Engine output) | learning artifacts |
| `indicator_weights` | أوزان المؤشرات الحالية (per-indicator) | per-indicator |
| `regime_indicator_weights` | أوزان لكل ريجيم (BULL/BEAR/SIDEWAYS) | per-regime × per-indicator |
| `cached_analysis` | كاش تحليل قديم | legacy |
| `news_items` | أخبار قديمة (superseded by news.db.market_news) | legacy |
| `macro_indicators` | مؤشرات كلية (inflation, interest rate, ...) | متغيّر |
| `system_settings` | Key-Value لكل إعدادات المحرك (`engine_settings.py`) | ~100 key |
| `gold_prices` | ⚠️ **LEGACY** — 3 stale rows 2026-06-03، disabled في `unified-db.ts:460-461` | 3 صفوف |
| `price_history` (view) | view على `stock_daily_prices` للـ backward compat | view |
| `stock_price_history` (view) | view آخر للـ backward compat | view |

### 3.2 — `predictions.db` — Prisma-managed, Next.js-owned

| البند | القيمة |
|---|---|
| **المسار** | `db/predictions.db` |
| **المالك** | Next.js (Prisma) + Python (writes عبر `core/analysis_runner.py` + `core/persona_db.py`) |
| **القرّاء Next.js** | `src/lib/db-predictions.ts`, `src/lib/shared-db.ts` (NO_CACHE_DB_NAMES — re-opened each time لأن Python writes تـ invalidate cached Node connections) |
| **القرّاء Python** | `vps-service/core/db_manager.py` (alias `'predictions'`), `vps-service/analyzers/prediction_tracker.py` |
| **DB Alias** | `'predictions'` |

**الجداول:** الـ 10 models في `predictions-schema.prisma` (راجع §2.2) + الجداول الإضافية التالية المضافة وقت الـ runtime:

| Table | المصدر | الوظيفة |
|---|---|---|
| `prediction_lessons` | `vps-service/jobs/learning_engine.py` | دروس مستفادة لكل توقع |
| `learned_lessons_predictions` | `learning_engine.py` | mirror قديم (legacy) |
| `optimizer_params` | `vps-service/jobs/learning_engine.py` | معاملات الـ optimizer (atomic file-based storage) |
| `morning_bell_signals` | `vps-service/jobs/daily_predictor.py` | إشارات الجرس الصباحي (top picks) |

### 3.3 — `auth.db` — Prisma-managed, Next.js-owned

| البند | القيمة |
|---|---|
| **المسار** | `db/auth.db` |
| **المالك (Writer)** | Next.js (Prisma) — login, register, subscription updates, watchlist CRUD |
| **القرّاء Next.js** | `src/lib/db-auth.ts`, `src/lib/last-active-helper.ts` (read-write updates `last_active_at`), `src/lib/bot-link-db.ts` (read-write raw SQL على `user_telegram_links`) |
| **القرّاء Python** | `vps-service/core/auth_middleware.py` (subscription_tier lookup), `vps-service/core/db_manager.py` (alias `'auth'`) |
| **DB Alias** | `'auth'` |

**الجداول:** كل الـ 19 models في `auth-schema.prisma` (راجع §2.1).

> **ملاحظة:** Python بـ يـ READ فقط من `auth.db`. لا Python writer. الـ subscription gating بـ يحصل في Next.js (`auth-helper.ts`) + يـ proxy القرارات لـ Python عبر JWT claims.

### 3.4 — `data_engine.db` — Python-owned (data_engine scrapers write)

| البند | القيمة |
|---|---|
| **المسار** | `db/data_engine.db` |
| **المالك (Writer)** | Python — `data_engine/scrapers/*` (27 ملف), `data_engine/sync.py`, `vps-service/scripts/update_metals_and_forex.py` |
| **القرّاء Next.js** | `src/lib/data-engine-db.ts` (read-write WAL), `src/lib/data-engine-db-sqljs.ts` (read-only sql.js), `src/lib/shared-db.ts`, `src/lib/market-data-access.ts`, `src/lib/gold-history-helper.ts`, `src/lib/unified-db.ts` |
| **القرّاء Python** | `vps-service/core/db_manager.py` (alias `'data_engine'` + alias `'gold_prices'` → data_engine), `vps-service/data/egksco_scraper.py`, scripts متعددة |
| **DB Alias** | `'data_engine'`, `'gold_prices'` → data_engine |
| **الحجم** | ~18 MB |

**الجداول:**

| Table | الوظيفة |
|---|---|
| `stocks` | أسعار أسهم حية — symbol, name, price, change_percent, volume, market_cap, market — أسماء عربية للأسواق |
| `egksco_price_history` | تاريخ EGX — migrated من `price_history.db` (BRAVO-FIX 2026-10-21) |
| `historical_data` | تاريخ متعدد الأسواق — TADAWUL/US/Forex/Gold |
| `crypto_prices` | أسعار الكريبتو الحية — CoinGecko/Binance/CoinCap |
| `gold_prices` | أسعار الذهب الحية — metals.dev + Daleelak كل 5 دقايق (Arabic "عيار N") |
| `silver_prices` | أسعار الفضة الحية |
| `exchange_rates` | أسعار صرف العملات — Frankfurter/exchangerate-api/Daleelak |
| `screener_lists` | قوائم TradingView screener exports |
| `market_movers_tabs` | top gainers/losers/active |
| `tab_valuation` | بيانات التقييم (P/E, P/B, ROE, ...) — من TradingView |
| `tab_profitability` | بيانات الربحية (margins, ROA, ...) — من TradingView |
| `egksco_stocks` | بيانات EGKSCO الأساسية |

### 3.5 — `price_history.db` — Canonical historical OHLCV (1.31M rows)

| البند | القيمة |
|---|---|
| **المسار** | `db/price_history.db` |
| **المالك (Writer)** | Python — `data_engine/scrapers/us_stock_scraper.py` (Yahoo OHLCV), `vps-service/jobs/price_history_safetynet.py` (yfinance backfill — cron `0 6 * * 0-4`) |
| **القرّاء Next.js** | `src/lib/new-db.ts`, `src/lib/egx-db.ts` (read-write), `src/lib/shared-db.ts`, `src/lib/honest-tracking/maestro.ts` (PRICE_DB_PATH), `src/app/api/finance/calculate-values/route.ts` |
| **القرّاء Python** | `vps-service/config.py` (PRICE_HISTORY_DB_PATH), `vps-service/core/database.py` (PRIMARY read), `vps-service/core/db_manager.py` (alias `'price_history'` + alias `'historical'` → price_history), `vps-service/engines/market_regime.py`, `vps-service/engines/backtest_engine.py`, `vps-service/scripts/liquidity_radar_v2.py` |
| **DB Alias** | `'price_history'`, `'historical'` |
| **الحجم** | ~58 MB (1.31M rows, latest 2026-10-21) |
| **BRAVO-FIX (2026-10-21)** | RESTORED — كان redirect لـ `data_engine.db.egksco_price_history` (0 rows — broken). دلوقتي canonical source. |

**الجداول:**

| Table | الوظيفة |
|---|---|
| `price_history` | PK (id autoincrement), UNIQUE(ticker, date) — OHLCV يومي لكل الأسواق. **1.31M صف.** آخر تحديث 2026-10-21. |
| `egx30_indices` | تاريخ مؤشر EGX30 (لـ market_regime.py Minervini stage analysis) |

### 3.6 — `intraday.db` — Python-owned (5-min snapshots)

| البند | القيمة |
|---|---|
| **المسار** | `db/intraday.db` |
| **المالك (Writer)** | Python — `data_engine/intraday_storage.py` (5-min snapshots), `vps-service/scripts/backfill_intraday.py`, `vps-service/scripts/dual_track_generator.py` |
| **القرّاء Next.js** | `src/app/api/market/intraday-pressure/route.ts`, `src/app/api/stocks/[ticker]/depth/route.ts`, `src/app/api/live-monitor/route.ts`, `src/app/api/chart/[ticker]/route.ts`, `src/app/api/maker-radar/market-intelligence/route.ts` |
| **القرّاء Python** | `vps-service/core/db_manager.py` (alias `'intraday'`) |
| **DB Alias** | `'intraday'` |
| **الحجم** | 340K+ rows, 970 tickers, 5-min snapshots |

**الجداول:**

| Table | الوظيفة | ملاحظة |
|---|---|---|
| `stock_intraday` | 5-min OHLCV لكل سهم EGX | PRIMARY — 340K+ rows |
| `crypto_intraday` | 5-min OHLCV للكريبتو | متغيّر |
| `commodities_intraday` | 5-min OHLCV للدهب/المعادن | متغيّر |
| `intraday_prices` | ⚠️ **schema drift** — مُعرّف في `migrator.py:628` بشكل مختلف | يحتمل superseded بـ `stock_intraday` |

### 3.7 — `news.db` — Python-owned (single source of truth)

| البند | القيمة |
|---|---|
| **المسار** | `db/news.db` |
| **المالك (Writer)** | Python — `data_engine/scrapers/news_scraper.py` (5 sources), `news-agent/` (RSS + Telegram + mubasher + egx_news + tradingview + daleelak + marketmaker) |
| **القرّاء Next.js** | `src/lib/flutter-sqlite-fallback.ts`, `src/app/api/news/route.ts` (read-write), `src/app/api/news/latest/route.ts`, `src/app/api/news-feed/route.ts`, `src/app/api/mobile/news/route.ts`, `src/app/api/admin/news/route.ts`, `src/app/api/data-engine/control/route.ts` |
| **القرّاء Python** | `vps-service/analyzers/news_fetcher_analyzer.py` (PRIMARY read), `vps-service/core/migrator.py` (DDL), `vps-service/core/db_manager.py` (alias `'news'`) |
| **DB Alias** | `'news'` |
| **Rule 44 — NEWS-DB-SOT** | canonical source للأخبار — كل المحركات تقرأ منها |

**الجداول:**

| Table | الوظيفة | ملاحظة |
|---|---|---|
| `market_news` | الأخبار canonical | Rule 44 — renamed من `news_articles` في 2026-09-02 |
| `news_articles` | ⚠️ legacy | مهاجَر — بس للـ backward compat |

### 3.8 — `crypto.db` — split (live migrated, watchlist/portfolio remain)

| البند | القيمة |
|---|---|
| **المسار** | `db/crypto.db` |
| **المالك (Writer)** | Python — `vps-service/core/crypto_database.py` (read-write), `vps-service/lightweight_server.py` (crypto watchlist + portfolio), `vps-service/core/db_manager.py` (alias `'crypto'`) |
| **القرّاء Next.js** | عبر `/api/crypto/*` routes → Python upstream |
| **DB Alias** | `'crypto'` |
| **⚠️ CONFLICT موثّق** | `RESTRUCT-CLEANUP-1`: live prices اتـ migration لـ `data_engine.db.crypto_prices`. بس `crypto.db` لسه بـ يحتفظ بـ watchlist/portfolio tables. تقسيم غير موثّق في مكان واحد. |

**الجداول:**

| Table | الوظيفة | ملاحظة |
|---|---|---|
| `cryptos` | ⚠️ LEGACY — superseded by `data_engine.db.crypto_prices` | 0 active writes |
| `crypto_prediction_logs` | سجلات توقعات الكريبتو | active |
| `crypto_watchlist` | قوائم متابعة الكريبتو (per-user) | active |
| `crypto_portfolio` | محفظة الكريبتو (per-user) | active |
| `user_crypto_trades` | صفقات الكريبتو للمستخدمين | active |

### 3.9 — `metrics.db` — Next.js admin metrics

| البند | القيمة |
|---|---|
| **المسار** | `db/metrics.db` |
| **المالك (Writer)** | Next.js — `src/lib/metrics-db.ts` |
| **القرّاء Next.js** | Admin dashboard routes, `src/modules/admin/components/*` |
| **DB Alias** | (none in Python — Next.js only) |
| **الحجم** | ~168 KB |

**الجداول:**

| Table | الوظيفة |
|---|---|
| `page_views` | view counts per page |
| `active_users` | active users per minute |
| `api_response_times` | API latency metrics |

---

## 4. جداول كل DB بالتفصيل

> راجع §3 لكل DB. هنا نعرض الـ schema snippets الأكثر أهمية للـ reference السريع.

### 4.1 — `predictions.db.predictions` (الـ schema الكامل)

```prisma
model Prediction {
  id                Int      @id @default(autoincrement())
  ticker            String
  signal            String         // BUY | STRONG_BUY | HOLD | SELL | STRONG_SELL | SHORT
  signal_type       String         // V40.2 | persona | WHALE_RADAR
  prediction_date   String         // ISO date
  entry_price       Float
  target_price      Float?
  stop_loss         Float?
  master_score      Float?
  technical_score   Float?   @default(50)
  fundamental_score Float?   @default(50)
  ai_pattern_score  Float?   @default(50)
  sentiment_score   Float?   @default(50)
  outcome_date      String?
  exit_price        Float?
  actual_return     Float?
  hit_target        Int      @default(0)
  hit_stop          Int      @default(0)
  is_correct        Int?
  holding_days      Int      @default(0)
  notes             String?
  market            String?  @default("EGX")
  confidence        Float?
  created_at        String?  @default("datetime('now')")

  // ── Columns added by ensureSchema() (maestro.ts) ──
  exit_reason            String?    // target_hit | stop_loss | expired | trailing_stop
  risk_reward            Float?
  atr_at_entry           Float?
  highest_price_reached  Float?
  lowest_price_reached   Float?
  is_trend_following     Int      @default(0)
  trailing_stop_atr_mult Float?
  initial_stop_atr_mult  Float?
  exit_type              String?
  persona                String?    // balanced | gambler | conservative
  target_price_2         Float?
  status                 String?    // PENDING | CLOSED
  pnl_pct                Float?
  closed_at              String?
  morning_bell           Int      @default(0)

  // ── AUDIT-1-PREDICTIONS (FIX-P2-PREDICTIONS) ──
  published_at        String?      // ISO datetime
  telegram_message_id String?
  was_published       Int      @default(0)
  target_hit_at       String?
  stop_hit_at         String?

  @@index([ticker])
  @@index([prediction_date])
  @@index([signal])
  @@index([was_published])
  @@map("predictions")
}
```

### 4.2 — `stocks.db.stocks` (الـ schema الأساسي)

```sql
CREATE TABLE stocks (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    is_active INTEGER DEFAULT 1,
    current_price REAL,
    previous_close REAL,
    change_percent REAL,
    volume REAL,
    value_traded REAL,
    market_cap REAL,
    pe_ratio REAL,
    pb_ratio REAL,
    roe REAL,
    roa REAL,
    debt_to_equity REAL,
    dividend_yield REAL,
    market TEXT DEFAULT 'EGX',
    currency TEXT DEFAULT 'EGP',
    is_sharia_compliant INTEGER,
    last_update TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
```

### 4.3 — `stocks.db.system_settings` (Key-Value لكل إعدادات المحرك)

```sql
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,           -- JSON-encoded value (float/int/string/bool)
    description TEXT,
    category TEXT,        -- 'liquidity' | 'volume' | 'rsi' | 'risk' | 'regime' | ...
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT
);
```

يقرأها `vps-service/analyzers/engine_settings.py::get_setting(key, default)` مع cache 60 ثانية. الأدمن يقدر يعدّل القيم عبر `POST /api/admin/engine-settings` بدون ما يلمس الكود.

### 4.4 — `data_engine.db.egksco_price_history` (EGX historical)

```sql
CREATE TABLE egksco_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    price_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
    open REAL,
    high REAL,
    low REAL,
    close REAL NOT NULL,
    volume REAL,
    value_traded REAL,
    change_percent REAL,
    UNIQUE(ticker, price_date)
);
CREATE INDEX idx_egksco_price_history_ticker ON egksco_price_history(ticker);
CREATE INDEX idx_egksco_price_history_date ON egksco_price_history(price_date);
```

### 4.5 — `intraday.db.stock_intraday` (5-min bars)

```sql
CREATE TABLE stock_intraday (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    timestamp TEXT NOT NULL,        -- ISO datetime
    open REAL,
    high REAL,
    low REAL,
    close REAL NOT NULL,
    volume REAL,
    UNIQUE(ticker, timestamp)
);
CREATE INDEX idx_stock_intraday_ticker ON stock_intraday(ticker);
CREATE INDEX idx_stock_intraday_ts ON stock_intraday(timestamp);
```

### 4.6 — `news.db.market_news` (canonical news)

```sql
CREATE TABLE market_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT,
    url TEXT,
    source TEXT,           -- 'newsapi' | 'gnews' | 'alphavantage' | 'mediastack' | 'rss' | 'telegram'
    category TEXT,         -- 'EGX' | 'crypto' | 'forex' | 'metals' | 'world'
    sentiment REAL,        -- -1 to +1
    impact_score REAL,     -- 0 to 100
    published_at TEXT NOT NULL,
    fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(url)
);
CREATE INDEX idx_market_news_published ON market_news(published_at);
CREATE INDEX idx_market_news_category ON market_news(category);
```

---

## 5. الـ DBs المُلغاة أو الوهمية (Legacy / Phantom)

| # | DB | الحالة | السبب / التفاصيل |
|---|----|-------|-----------------|
| 1 | `custom.db` | **REMOVED** | Deprecation comments في `src/lib/new-db.ts`, `src/lib/finance-db.ts`, `src/lib/egx-db.ts`. "custom.db has been removed. Use Prisma with auth.db for user data or stocks.db for stock data." |
| 2 | `gold_prices.db` | **PHANTOM** | مذكور في `src/lib/sqlite-admin.ts` و `src/app/api/admin/db-backup/route.ts` بس **مش ملف حقيقي**. Canonical فعلي = `data_engine.db.gold_prices` (per `db_manager.py:108-110`). |
| 3 | `egypt_stocks.db` | **sandbox/dev fallback** | مش DB رسمية. `vps-service/core/database.py:685-696` comment صريح: "أضيفت كـ fallback للساندبوكس بس". |
| 4 | `community.db` | **layer mismatch** | Next.js بـ يفتح `community.db` كملف (`src/lib/community-db.ts`). بس Python `db_manager.py:112` بـ يـ alias `'community'` → STOCKS_DB (consolidated July 2026). **Layer mismatch.** |
| 5 | `market.db` | **unclear / legacy** | مذكور في `data_engine/scrapers/sharia_compliance_scraper.py` و `db-backup` list. Status غير واضح — يحتمل deprecated. |
| 6 | `bot-link.db` | **misnomer** | `src/lib/bot-link-db.ts` بـ يفتح **`auth.db`** مباشرة (line 101) ويـ query/update جدول `user_telegram_links`. **مفيش ملف bot-link.db منفصل.** |
| 7 | `unified_stocks.db` | **legacy name only** | الكود دلوقتي بـ يفتح `stocks.db` (line 82-83: "Use stocks.db (contains 1,298 stocks with real data)"). اسم `unified_stocks.db` بيظهر بس في log strings — مش ملف فعلي. |
| 8 | `historical.db` | **multi-market historical** | `historical_prices` table (TADAWUL/EGX/KSE/QSE/Crypto/Forex/Metals/Indices). في الساندبوكس ممكن مش موجود — fallback لـ price_history.db. |
| 9 | `crypto_learning.db` | **small learning store** | `vps-service/core/db_manager.py` alias `'crypto_learning'`, `src/lib/sqlite-admin.ts`, `src/lib/crypto-learning-store.ts`. |
| 10 | `learned.db` | **referenced in egx-db.ts comments** | مذكور كـ "ML lessons store" بس مش موجود كملف فعلي — الـ learning artifacts بـ تتخزّن في `stocks.db.learned_lessons` + `predictions.db.prediction_lessons`. |

---

## 6. Data Access Layer — DAL (Python)

الـ DAL هو **البوابة المركزية الموحّدة** لكل عمليات الـ SQLite في الـ Python backend. كل المحركات بتمرّ منه — ممنوع `sqlite3.connect()` مباشر خارج الـ whitelist (5 ملفات).

### 6.1 — `vps-service/core/db_manager.py` (487 LOC)

**Singleton thread-safe** — كل المحركات بتستخدم نفس الـ instance عبر:

```python
from core.db_manager import db_manager

# قراءة (readonly, immutable fallback)
rows = db_manager.query('stocks', "SELECT ticker, name FROM stocks WHERE is_active=1")

# كتابة (WAL + busy_timeout + auto-checkpoint)
db_manager.execute('predictions',
    "INSERT INTO predictions (ticker, signal) VALUES (?, ?)",
    ('COMI', 'BUY'))

# connection context (للـ transactions المعقدة)
with db_manager.connection('stocks', writable=True) as conn:
    conn.execute("UPDATE stocks SET current_price = ? WHERE ticker = ?", (price, ticker))
    conn.commit()
```

#### API Surface

| Method | Signature | Returns | الوظيفة |
|---|---|---|---|
| `query(db, sql, params)` | `(str, str, tuple)` | `List[Dict[str, Any]]` | SELECT → list of dicts |
| `query_one(db, sql, params)` | `(str, str, tuple)` | `Optional[Dict[str, Any]]` | SELECT → single dict (or None) |
| `execute(db, sql, params)` | `(str, str, tuple)` | `int` (rowcount) | INSERT/UPDATE/DELETE |
| `execute_many(db, sql, params_list)` | `(str, str, list[tuple])` | `int` (rowcount) | Batch INSERT/UPDATE في transaction واحد |
| `transaction(db)` | `(str)` | `ContextManager[Connection]` | BEGIN/COMMIT/ROLLBACK تلقائي |
| `connection(db, writable=False)` | `(str, bool)` | `ContextManager[Connection]` | Raw connection context |
| `get_connection(db, writable=False)` | `(str, bool)` | `Connection` | Raw connection (caller must close) |
| `table_exists(db, table_name)` | `(str, str)` | `bool` | exists check |
| `table_columns(db, table_name)` | `(str, str)` | `List[str]` | PRAGMA table_info |
| `ensure_column(db, table, column_def)` | `(str, str, str)` | `bool` (added=True) | safe ALTER TABLE migration |
| `get_stats()` | `()` | `Dict[str, int]` | {reads, writes, errors} |

#### Connection Settings (ضمانات الـ connection)

**Writable connection:**
- `PRAGMA journal_mode=WAL`
- `PRAGMA busy_timeout=30000` (30 ثانية)
- `PRAGMA synchronous=NORMAL`
- `PRAGMA wal_autocheckpoint=1000`
- `PRAGMA foreign_keys=ON`
- Auto `PRAGMA wal_checkpoint(PASSIVE)` بعد كل write

**Readonly connection:**
- `mode=ro` (مع `immutable=1` fallback لو الـ WAL/-shm فاسد)
- `PRAGMA busy_timeout=30000`
- `PRAGMA query_only=1` (ضمان إضافي: قراءة فقط)

#### الـ DB Aliases (خريطة الأسماء المختصرة → مسارات DB مطلقة)

```python
_DB_ALIASES = {
    # الـ 8 المعتمدة رئيسياً
    'stocks':           DBPaths.STOCKS_DB,
    'predictions':     DBPaths.PREDICTIONS_DB,
    'price_history':    DBPaths.PRICE_HISTORY_DB,
    'data_engine':      DBPaths.DATA_ENGINE_DB,
    'intraday':         DBPaths.INTRADAY_DB,
    'auth':             DBPaths.AUTH_DB,
    'crypto':           DBPaths.CRYPTO_DB,
    'crypto_learning':  DBPaths.CRYPTO_LEARNING_DB,
    # أسماء شائعة (aliasing للقواعد المدمجة)
    'news':             DBPaths.NEWS_DB,        # Rule 44 NEWS-DB-SOT
    'telegram_data':    DBPaths.STOCKS_DB,      # Consolidated July 2026
    'analytics':        DBPaths.STOCKS_DB,      # Consolidated July 2026
    'gold_prices':      DBPaths.DATA_ENGINE_DB, # canonical live
    'historical':       DBPaths.PRICE_HISTORY_DB,
    'community':        DBPaths.STOCKS_DB,
}
```

### 6.2 — `vps-service/core/database.py` (legacy DAL — 1,223 LOC)

الـ legacy DAL — backward compat. الـ functions اللي لسه شغّالة:

| Function | الوظيفة |
|---|---|
| `parse_market_cap(value)` | تحويل "377.55 M" → 377_550_000.0 — معالجة thin-space + commas + currency markers |
| `parse_numeric(value, default=None)` | تحويل مرن — بدون K/M/B multipliers (للأسعار) |
| `safe_connect(db_path, readonly=False, timeout=30.0)` | sqlite3.connect wrapper — يضمن timeout + busy_timeout |

### 6.3 — الـ Whitelist (5 ملفات مسموح لها بـ `sqlite3.connect()` مباشر)

| File | السبب |
|---|---|
| `vps-service/core/db_manager.py` | الـ DAL نفسه |
| `vps-service/core/database.py` | Legacy DAL (backward compat) |
| `vps-service/lightweight_server.py` | Standalone Flask server (لا يستورد db_manager في كل المسارات) |
| `vps-service/core/migrator.py` | Schema migration tool (يحتاج raw SQL) |
| `vps-service/jobs/wal_checkpoint.py` | WAL checkpoint utility |

أي ملف تاني بـ يستخدم `sqlite3.connect()` مباشر = **CATEGORY B VIOLATION** يمنعه `scripts/check_architecture.py` من الـ commit.

---

## 7. DB Client Layer — Node.js / Next.js

### 7.1 — Prisma Clients (3)

| Client | الملف | الـ DB | Generator output |
|---|---|---|---|
| `authDb` | `src/lib/db-auth.ts` | `auth.db` | `../node_modules/@prisma/auth-client` |
| `predictionsDb` | `src/lib/db-predictions.ts` | `predictions.db` | `../node_modules/@prisma/predictions-client` |
| `db` (default) | `src/lib/db.ts` | `auth.db` (re-export من db-auth) | default Prisma Client (placeholder) |

#### Pattern (singleton with global cache)

```typescript
// src/lib/db-auth.ts
const globalForAuth = globalThis as unknown as { authDb: PrismaClient | undefined }
const dbPath = path.join(process.cwd(), 'db', 'auth.db')

export const authDb =
  globalForAuth.authDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    datasourceUrl: `file:${dbPath}`
  })

if (process.env.NODE_ENV !== 'production') globalForAuth.authDb = authDb
```

> **لماذا global cache؟** Next.js dev mode بـ reload الـ modules باستمرار. بدون `globalThis` cache، Prisma بـ تفتح connection جديد في كل reload — تسرّب handles + تسبب `SQLITE_BUSY`.

### 7.2 — better-sqlite3 Clients (84 ملف في `src/`)

الـ DB driver الأساسي لـ Node-side. أبرز الـ central openers:

| File | الوظيفة | DBs |
|---|---|---|
| `src/lib/shared-db.ts` | WAL-safe opener مع retry + readonly/immutable fallback | كل DBs |
| `src/lib/data-engine-db.ts` | data_engine.db (read-write WAL) + price_history.db (read-only) + stocks.db (read-write WAL) | 3 DBs |
| `src/lib/egx-db.ts` | native (better-sqlite3) → SqliteDatabase adapter — wrap shared-db | stocks.db + price_history.db + data_engine.db |
| `src/lib/finance-db.ts` | ⚠️ deprecated — custom.db REMOVED، دلوقتي بـ route لـ stocks.db | stocks.db |
| `src/lib/new-db.ts` | price_history.db + new schema helpers | price_history.db |
| `src/lib/db-predictions.ts` | predictions.db (Prisma layered) | predictions.db |
| `src/lib/db-auth.ts` | auth.db (Prisma layered) | auth.db |
| `src/lib/bot-link-db.ts` | raw SQL على auth.db.user_telegram_links | auth.db |
| `src/lib/community-db.ts` | ⚠️ layer mismatch — بـ يفتح community.db كملف (مش alias) | community.db |
| `src/lib/metrics-db.ts` | metrics.db admin metrics | metrics.db |
| `src/lib/unified-db.ts` | unified stock data facade | stocks.db + data_engine.db |
| `src/lib/market-data-access.ts` | market data cache layer | stocks.db + data_engine.db + historical.db |
| `src/lib/honest-tracking/maestro.ts` | V40.2 prediction tracker | predictions.db + stocks.db |
| `src/lib/sqlite-admin.ts` | admin DB backup/restore helper | كل DBs |
| `src/lib/admin-db-manager.ts` | admin DB manager | كل DBs |

### 7.3 — sql.js Clients (1 ملف)

`src/lib/data-engine-db-sqljs.ts` — WebAssembly SQLite. بديل لـ better-sqlite3 لـ تجنب مشاكل native module مع Next.js bundler.

| Function | الوظيفة |
|---|---|
| `getDataEngineDbSqlJs()` | read-only على `data_engine.db` |
| `getPriceHistoryDbSqlJs()` | backward-compat wrapper بـ يـ route لـ `data_engine.db` |
| `getStocksDbSqlJs()` | read-only على `stocks.db` |
| `DbCompat` wrapper | بـ يحول async `SqlJsDatabase` لـ mock sync API |

---

## 8. WAL Mode + Locking Protocol

### 8.1 — لماذا WAL؟

**WAL (Write-Ahead Logging)** هو SQLite journal mode. مزاياه:

1. **Readers لا يحجبون writer** — readers بـ يشوفوا آخر committed snapshot، writer بـ يكتب في الـ WAL file.
2. **Writer لا يحجبون readers** — على عكس الـ rollback journal mode.
3. **أداء أعلى** — fsync أقل، خاصة مع `synchronous=NORMAL`.
4. **Cross-process safe** — Python و Node.js بـ يقرآن نفس الملف بأمان.

### 8.2 — Locking Protocol (Python side — `db_manager.py`)

| الاتصال | الإعدادات |
|---|---|
| **Writable** | `journal_mode=WAL` + `busy_timeout=30000` (30s) + `synchronous=NORMAL` + `wal_autocheckpoint=1000` + `foreign_keys=ON` + auto `wal_checkpoint(PASSIVE)` بعد كل write |
| **Readonly** | `mode=ro` + `busy_timeout=30000` + `query_only=1` + fallback `immutable=1` لو الـ WAL/-shm فاسد |

**Readonly fallback chain:**
1. `file:<path>?mode=ro` — يحترم الـ WAL (بيشوف آخر commits)
2. لو فشل → `file:<path>?immutable=1` — bypasses WAL (safe for cold reads — بيجيب آخر checkpoint)

### 8.3 — Locking Protocol (Node.js side — `shared-db.ts`)

```typescript
// WAL-safe opener: حاول read-write الأول، fallback لـ readonly، fallback لـ immutable
function openDb(dbPath: string): Database.Database {
  const busyTimeout = 10000
  try {
    const db = new Database(dbPath, { timeout: busyTimeout })
    db.pragma(`busy_timeout = ${busyTimeout}`)
    return db
  } catch (e) {
    // Fallback 1: readonly
    const db = new Database(dbPath, { readonly: true, timeout: busyTimeout })
    db.pragma(`busy_timeout = ${busyTimeout}`)
    return db
  }
}
```

### 8.4 — لماذا Next.js بـ يفتح DBs بـ read-write WAL؟

Python (data_engine) بـ يكتب في الـ WAL journal. لو Node.js بـ يفتح بـ readonly صرف، بـ يشتغل بس بـ يفوّت آخر commits (لأن الـ WAL `-shm` لسه مش merged). الحل: Next.js بـ يفتح بـ read-write عشان **reconcile** الـ WAL مع آخر commits — بس ما بـ يكتبش فعلياً.

> **⚠️ WAL contention:** shared DBs (`data_engine`, `stocks`, `price_history`, `historical`, `intraday`) بـ يفتحها Next.js READ-WRITE (shared-db.ts) بس عشان reconcile Python's WAL journal — **Next.js never actually writes لهم**. لو حصل write من Next.js عن طريق الخطأ = خطر على البيانات.

### 8.5 — `wal_checkpoint` Job

```bash
# Cron يومي: wal_checkpoint(TRUNCATE) على كل DBs
0 3 * * *   cd /home/z/my-project && /root/.venv/bin/python3 \
  vps-service/jobs/wal_checkpoint.py --truncate \
  >> logs/wal_checkpoint.log 2>&1
```

`wal_checkpoint(TRUNCATE)` بـ يـ merge الـ WAL file مع الـ main DB file + بـ يـ truncate الـ WAL لـ 0 bytes. ده ضروري عشان الـ WAL ما يكبرش بلا حدود.

---

## 9. مصادر البيانات الخارجية (Data Sources)

### 9.1 — EGX Stocks Live (multi-source fallback chain)

| Source | Endpoint | File | الأولوية |
|---|---|---|---|
| **EGKSCO** (PRIMARY EGX HTML) | `https://egksco-online.com/etrade/Sectors.aspx` + `Stock.aspx?Code={symbol}.CA` | `data_engine/scrapers/egksco_scraper.py` | 1 (PRIMARY) |
| **EGXPilot** (EGX REST API) | `https://egxpilot.com/api/stocks/all` | `data_engine/scrapers/egxpilot_scraper.py` (لو موجود), `vps-service/analyzers/production_data_client.py` | 2 |
| **Yahoo Finance (yfinance)** | yfinance lib، ticker suffix `.CA` for EGX | `data_engine/scrapers/yahoo_scraper.py` (لو موجود), `data_engine/scrapers/historical_fetcher.py` | 3 (historical) |
| **TradingView scanner** | `https://scanner.tradingview.com/{market}/scan` (egypt/saudi/kuwait/qatar/global) | `data_engine/scrapers/tradingview_rest.py`, `update_fundamentals.py` | 4 |
| **TradingView symbols page** | `https://www.tradingview.com/symbols/EGX-{ticker}/` | `data_engine/scrapers/technical_fetcher.py` | 5 |
| **TradingView market movers** | `https://ar.tradingview.com/markets/stocks-egypt/market-movers-{gainers,losers,active,unusual-volume,high-dividend}/` | `data_engine/scrapers/tradingview_market_movers.py` | 6 |
| **Fallback chain orchestrator** | circuit-breaker على egksco/yahoo/egxpilot | `data_engine/scrapers/fallback_chain.py` | fallback |

### 9.2 — US Stocks & Multi-Market

| Source | Endpoint | File |
|---|---|---|
| **Yahoo Finance yfinance** | OHLCV → `price_history.db.price_history` | `data_engine/scrapers/us_stock_scraper.py` |
| **Yahoo query1 API** | `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}` | `vps-service/scripts/egx_backtest/fetch_egx_data.py`, `vps-service/analyzers/production_data_client.py` |
| **TradingView REST** | `https://scanner.tradingview.com/global/scan` | `data_engine/scrapers/tradingview_rest.py` |
| **Multi-market scraper** | `https://scanner.tradingview.com/{market}/scan` لـ TADAWUL/KSE/QSE/US | `data_engine/scrapers/multi_market_scraper.py` |

### 9.3 — Crypto

| Source | Endpoint | File |
|---|---|---|
| **CoinGecko** | `https://api.coingecko.com/api/v3/{coins/markets, simple/price, coins/{id}/ohlc, coins/{id}/market_chart, global, status_updates}` | `data_engine/scrapers/crypto_fetcher.py`, `vps-service/core/crypto_database.py` |
| **Binance** | `https://api.binance.com/api/v3/ticker/24hr` | `data_engine/scrapers/crypto_fetcher.py` |
| **CoinCap** | `https://api.coincap.io/v2/assets` | `data_engine/scrapers/crypto_fetcher.py` |

### 9.4 — Metals (Gold/Silver)

| Source | Endpoint | File |
|---|---|---|
| **metals.dev** | `https://api.metals.dev/v1/latest?api_key={key}&currency=USD&unit=toz` | `data_engine/scrapers/metals_forex_fetcher.py` |
| **Daleelak** (Egypt-local EGP gold, "عيار N") | `https://getdaleelak.com/api/v1/feed.json?category=metals` | `data_engine/scrapers/metals_forex_fetcher.py` |

### 9.5 — Forex

| Source | Endpoint | File |
|---|---|---|
| **Frankfurter** | `https://api.frankfurter.dev/v2/rates?base=USD` | `data_engine/scrapers/metals_forex_fetcher.py` |
| **exchangerate-api** | `https://api.exchangerate-api.com/v4/latest/USD` | `data_engine/scrapers/crypto_fetcher.py` |
| **Daleelak currencies** | `https://getdaleelak.com/api/v1/feed.json?category=currencies` | `data_engine/scrapers/metals_forex_fetcher.py` |

### 9.6 — News

| Source | Endpoint | File |
|---|---|---|
| **NewsAPI** | `https://newsapi.org/v2/everything` | `data_engine/scrapers/news_scraper.py` |
| **GNews** | `https://gnews.io/api/v4/search` | `data_engine/scrapers/news_scraper.py` |
| **AlphaVantage** | `https://www.alphavantage.co/query` | `data_engine/scrapers/news_scraper.py` |
| **mediastack** | `http://api.mediastack.com/v1/news` | `data_engine/scrapers/news_scraper.py` |
| **News Agent collectors** | RSS / Telegram / mubasher / investing (disabled) / egx_news / tradingview / daleelak / marketmaker | `news-agent/collectors/` |

### 9.7 — Sharia Compliance

| Source | Endpoint | File |
|---|---|---|
| **templatesnippet.com** (static JSON) | `https://stocks.templatesnippet.com/data/stocks_merged.json` | `data_engine/scrapers/sharia_compliance_scraper.py` |
| **Harvest references** | halalbourse.com, musaffa.com, kashif.app, halalinvest.com, fib.com.eg, osoul-securities.com, thndr.net | `data_engine/scrapers/sharia_compliance_scraper.py` |

### 9.8 — Internal Cross-Service URLs

| From | To | Purpose | File |
|---|---|---|---|
| `data_engine/sync.py` | `http://localhost:3005/broadcast` | WS service broadcast | `data_engine/sync.py:29` |
| `data_engine/realtime_sync.py` | `http://localhost:3000/api/data-engine/reload` | Next.js webhook | `data_engine/realtime_sync.py:13` |

---

## 10. الـ 27 scraper في `data_engine/scrapers/`

```bash
$ ls data_engine/scrapers/
auto_refresh_scheduler.py
crypto_fetcher.py
egksco_scraper.py
egx_indices_live.py
egx_investors_beta_parser.py
egx_investors_diag.py
egx_investors_playwright.py
egx_investors_scraper.py
egx_market_scraper.py
fallback_chain.py
fetch_logos.py
historical_fetcher.py
historical_fetcher_5years.py
metals_forex_fetcher.py
metals_forex_fetcher.py.original
multi_market_scraper.py
news_scraper.py
sharia_compliance_scraper.py
smart_scheduler.py
technical_fetcher.py
ticker_validator.py
tradingview_market_movers.py
tradingview_rest.py
tradingview_scraper.py
tradingview_screener_lists.py
update_fundamentals.py
us_stock_scraper.py
```

### جدول الـ 27 scraper بالتفصيل

| # | Scraper | الوظيفة | Output DB | Schedule | Validation |
|---|---|---|---|---|---|
| 1 | `auto_refresh_scheduler.py` | جدولة auto-refresh لـ scraper مختلفة | — | continuous | — |
| 2 | `crypto_fetcher.py` | أسعار الكريبتو (CoinGecko/Binance/CoinCap) | `data_engine.db.crypto_prices` | every 5 min | — |
| 3 | `egksco_scraper.py` | أسعار EGX الرسمية (EGKSCO HTML) | `data_engine.db.stocks` + `egksco_price_history` | daily + intraday | ✅ `validate_ticker()` (SCRAPER-VALIDATION-FIX) |
| 4 | `egx_indices_live.py` | قيم EGX30/EGX70/EGX100 الحية | `stocks.db.market_indices` | every 5 min | — |
| 5 | `egx_investors_beta_parser.py` | معاملات بيتا (beta coefficients) | `stocks.db.stocks` (beta column) | weekly | — |
| 6 | `egx_investors_diag.py` | diagnostic tool لمصدر EGX investors | — | manual | — |
| 7 | `egx_investors_playwright.py` | تدفقات المستثمرين عبر Playwright (heavy) | `stocks.db.foreign_flows` | weekly | — |
| 8 | `egx_investors_scraper.py` | تدفقات المستثمرين الرسمية (EGX website) | `stocks.db.foreign_flows` | weekly | — |
| 9 | `egx_market_scraper.py` | scraping عام لـ EGX website | `data_engine.db.stocks` | daily | — |
| 10 | `fallback_chain.py` | orchestrator multi-source fallback (circuit-breaker) | — | per-ticker | — |
| 11 | `fetch_logos.py` | شعارات الشركات (TradingView) | `data_engine.db.stocks` (logo_url) | weekly | — |
| 12 | `historical_fetcher.py` | OHLCV تاريخي (Yahoo/TV) | `price_history.db.price_history` | weekly | — |
| 13 | `historical_fetcher_5years.py` | OHLCV 5 سنوات backfill | `price_history.db.price_history` | manual / quarterly | — |
| 14 | `metals_forex_fetcher.py` | دهب + فضة + عملات (metals.dev + Daleelak + Frankfurter) | `data_engine.db.{gold_prices, silver_prices, exchange_rates}` | every 5 min | — |
| 15 | `metals_forex_fetcher.py.original` | ⚠️ original copy — for diff/reference | — | — | — |
| 16 | `multi_market_scraper.py` | scraping متعدد الأسواق (TADAWUL/KSE/QSE/US) | `data_engine.db.stocks` | daily | ❌ (needs validation) |
| 17 | `news_scraper.py` | أخبار من 4 sources (NewsAPI/GNews/AlphaVantage/mediastack) | `news.db.market_news` | every 30 min | — |
| 18 | `sharia_compliance_scraper.py` | شارات الشريعة + harvest references | `stocks.db.stocks` (is_sharia_compliant) + `market.db` | monthly | — |
| 19 | `smart_scheduler.py` | smart scheduler لـ scheduling optimal لـ scrapers | — | continuous | — |
| 20 | `technical_fetcher.py` | بيانات تقنية من TradingView (symbols page) | `data_engine.db.stocks` (technical indicators) | weekly | — |
| 21 | `ticker_validator.py` | ⭐ **centralized ticker validation** — يرفض ISIN codes + pollution merge | — | (used by other scrapers) | ✅ Source of truth |
| 22 | `tradingview_market_movers.py` | top gainers/losers/active من TradingView | `data_engine.db.market_movers_tabs` | every 15 min | — |
| 23 | `tradingview_rest.py` | TradingView REST API (real-time prices) | `data_engine.db.stocks` | every 5 min | ✅ `validate_ticker()` (SCRAPER-VALIDATION-FIX) |
| 24 | `tradingview_scraper.py` | TradingView web scraper (fallback) | `data_engine.db.stocks` | hourly | ✅ `_is_polluted_scrape_record()` |
| 25 | `tradingview_screener_lists.py` | TradingView screener exports | `data_engine.db.screener_lists` | daily | — |
| 26 | `update_fundamentals.py` | P/E, ROE, debt ratios من TradingView | `stocks.db.stocks` (pe_ratio, roe, debt_to_equity) + `data_engine.db.{tab_valuation, tab_profitability}` | weekly | — |
| 27 | `us_stock_scraper.py` | US stocks OHLCV (Yahoo yfinance) | `price_history.db.price_history` | daily | ❌ (needs validation) |

### Centralized Ticker Validation

| البند | القيمة |
|---|---|
| **File** | `data_engine/scrapers/ticker_validator.py` |
| **Function** | `validate_ticker(symbol, name) → (is_valid, reason)` |
| **Detects** | ISIN codes (EGS3I0S1C019), pollution merge (UBEEU), name_starts_lowercase, invalid format |
| **Whitelist** | FAITA, CCAPP, EGSA (real preferred shares) |
| **Applied to** | `egksco_scraper.py`, `tradingview_rest.py`, `data_engine/main.py` |

---

## 11. تدفق البيانات الكامل (Data Flow)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SOURCES                                    │
│  EGX website (EGKSCO) · TradingView · Yahoo · metals.dev · Daleelak ·         │
│  Frankfurter · CoinGecko · Binance · CoinCap · NewsAPI · GNews ·             │
│  AlphaVantage · mediastack · templatesnippet · news-agent RSS/TG             │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DATA ENGINE LAYER (Python)                                │
│  data_engine/main.py (orchestrator) → scrapers/* → validation → sync.py      │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│  data_engine.db   │  │  price_history.db │  │   intraday.db     │
│  (live + multi-   │  │  (historical     │  │   (5-min bars)    │
│   market)         │  │   OHLCV 1.31M)   │  │                   │
└─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘
          │                       │                      │
          └───────────┬───────────┴──────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SYNC LAYER (Python → Canonical DBs)                       │
│  data_engine/sync.py:                                                         │
│  • copy live prices → stocks.db.stocks (current_price)                       │
│  • copy EOD OHLCV → stocks.db.stock_daily_prices                             │
│  • copy news → news.db.market_news                                            │
│  • broadcast event → ws-service:3005 (WebSocket push to frontend)             │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              ENGINE LAYER (Python — vps-service/engines + analyzers)         │
│  master_analyzer.py + v38_backtest_engine.py + institutional_decision_engine │
│  + flow_system + market_regime + liquidity_filter + ... (119 analyzer)       │
│  Inputs: stocks.db + price_history.db + intraday.db + news.db + auth.db       │
│  Outputs: predictions.db.predictions + stored_analyses + persona_predictions │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       API LAYER (Python + Node.js)                           │
│  Python: vps-service/lightweight_server.py (Flask 8010) — 30+ blueprints    │
│  Python: vps-service/main.py (FastAPI)                                        │
│  Node.js: src/app/api/* (588 routes — 257 proxy لـ Python)                   │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (Next.js + React)                              │
│  src/app/page.tsx (single-page shell with hash routing)                       │
│  src/components/ (328 ملف، 56 مجلد فرعي)                                      │
│  src/lib/api-client.ts (unified fetch wrapper — retry/timeout/auth)          │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  USER (Web + Flutter + Telegram Bot)                          │
│  Web: https://invist.m2y.net (Next.js)                                        │
│  Flutter: github.com/enmohsen20111975/flutter_investment_App                  │
│  Telegram: auto_poster.py → daily BUY picks                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. الخريطة الكنسية للداتا (Canonical Data Map)

| Domain | Canonical source | ملاحظات |
|---|---|---|
| **أسعار أسهم تاريخية (EGX)** | `data_engine.db.egksco_price_history` (Next.js side) **+** `price_history.db.price_history` (Python side, 1.31M rows, BRAVO-FIX 2026-10-21) **+** `stocks.db.stock_daily_prices` **+** `historical.db.historical_prices` | ⚠️ 4 مخازن متوازية — CONFLICT موثّق (راجع §13) |
| **أسعار أسهم live (EGX)** | `data_engine.db.stocks` (scrape target) → synced لـ `stocks.db.stocks` بـ `data_engine/sync.py` | data_engine.db = scrape target؛ stocks.db = consumed snapshot |
| **أسعار كريبتو** | `data_engine.db.crypto_prices` (live — CoinGecko/Binance/CoinCap) | migrated من `crypto.db.cryptos` (RESTRUCT-CLEANUP-1) |
| **أسعار دهب/معادن** | `data_engine.db.gold_prices` + `silver_prices` (live — metals.dev/Daleelak كل 5 دقايق) | ⚠️ `gold_prices.db` phantom (مش ملف حقيقي)؛ `stocks.db.gold_prices` stale (3 rows 2026-06-03، disabled) |
| **forex** | `data_engine.db.exchange_rates` (Frankfurter/exchangerate-api/Daleelak) | `historical.db.historical_prices` بيحتفظ بـ Forex historical |
| **intraday data** | `intraday.db.stock_intraday` (340K+ rows, 970 tickers, 5-min snapshots) + `crypto_intraday` + `commodities_intraday` | source: `data_engine.db` snapshots |
| **أخبار** | `news.db.market_news` (Rule 44 NEWS-DB-SOT) | Writers: News Agent + `news_scraper.py` |
| **توقعات** | `predictions.db.predictions` (Prisma-managed) + `persona_predictions` + `prediction_logs` | Writers: Python (`analysis_runner.py`) + Next.js (`honest-tracking/maestro.ts`) — Both layers share the DB |
| **مستخدمين + اشتراكات** | `auth.db` (Prisma-managed) | custom.db REMOVED — كل user data في auth.db |
| **إعدادات المحرك** | `stocks.db.system_settings` (Key-Value) | Readers: `engine_settings.py::get_setting()` + cache 60s |
| **أوزان المؤشرات** | `stocks.db.indicator_weights` + `regime_indicator_weights` + `indicator_trust_scores` | Writers: `learning_engine.py` |
| **دروس مستفادة** | `stocks.db.learned_lessons` + `predictions.db.prediction_lessons` | Writers: `learning_engine.py` |
| **message queue** | `predictions.db.analysis_jobs` | Job queue للتحليل غير المتزامن |
| **admin metrics** | `metrics.db.{page_views, active_users, api_response_times}` | Writer: `metrics-db.ts` |

---

## 13. التعارضات الموثّقة (Documented Conflicts)

| # | التعارض | الخطورة | التفاصيل |
|---|---|---|---|
| 1 | **price_history.db vs data_engine.db.egksco_price_history** | 🔴 CRITICAL | Next.js هاجر لـ data_engine.db لكن Python لسه بـ يعامل price_history.db كـ PRIMARY. **مخازن متوازية** — تقرأ من الاثنين، risk drift. |
| 2 | **gold_prices.db phantom** | 🟠 HIGH | مذكور في `sqlite-admin.ts` و db-backup list بس **مش ملف حقيقي**. Canonical فعلي = `data_engine.db.gold_prices`. |
| 3 | **stocks.db.gold_prices stale** | 🟡 MEDIUM | 3 rows من 2026-06-03 — disabled صراحة في `unified-db.ts:460-461`. |
| 4 | **crypto.db split** | 🟠 HIGH | live prices → `data_engine.db.crypto_prices`؛ watchlist/portfolio → `crypto.db`. تقسيم غير موثّق. |
| 5 | **schema.prisma (root) placeholder** | 🟡 MEDIUM | User+Post بس. الـ operational schemas هما auth + predictions بـ generator outputs منفصلة. |
| 6 | **custom.db removed** | 🟢 LOW | deprecated عبر finance-db.ts, new-db.ts, egx-db.ts. user data → auth.db؛ stock data → stocks.db. |
| 7 | **egypt_stocks.db** | 🟢 LOW | مش DB رسمي — sandbox/dev fallback. |
| 8 | **community.db layer mismatch** | 🟠 HIGH | Next.js بـ يفتح community.db كملف؛ Python db_manager.py بـ alias `'community'` → STOCKS_DB. |
| 9 | **market.db** | 🟡 MEDIUM | مذكور في sharia_compliance_scraper.py + db-backup list. Status غير واضح. |
| 10 | **WAL contention** | 🟡 MEDIUM | shared DBs (data_engine, stocks, price_history, historical, intraday) بتـ يفتحها Next.js READ-WRITE بس عشان reconcile Python's WAL journal — Next.js never actually writes لهم. |
| 11 | **bot-link-db.ts تسمية مضللة** | 🟢 LOW | الاسم بـ يشير لـ bot-link.db، بس فعلياً بـ يفتح auth.db. |
| 12 | **intraday.db schema drift** | 🟡 MEDIUM | `migrator.py:628` بـ يعرف `intraday_prices` table مختلفة عن `stock_intraday` اللي بـ يستخدمها intraday_storage.py. |
| 13 | **prisma schema drift** | 🟡 MEDIUM | predictions-schema.prisma أقل بـ 7 أعمدة من predictions.db الفعلي (`ai_reason`, `gambler_rank_score`, `investor_rank_score`, `is_gambler_opportunity`, `is_investor_opportunity`, `prediction_date`, `signal` on `stored_analyses`). حلها `maestro.ts:ensureSchema()` بـ ALTER TABLE وقت الـ runtime. |

---

## 14. بروتوكولات النسخ الاحتياطي والاسترجاع

### 14.1 — سكربتات "لا تكسر الإنتاج" (4)

| Script | الوظيفة |
|---|---|
| `scripts/init_db_safety.py` | WAL + busy_timeout على كل DBs |
| `scripts/repair_all_dbs.py` | إصلاح DBs تالفة (REINDEX + dump/rebuild) |
| `scripts/daily_db_health_check.py` | فحص يومي + إصلاح تلقائي + تقرير JSON |
| `scripts/setup-daily-health-cron.sh` | تثبيت/إزالة cron job |

### 14.2 — الـ Backup Policy

| النوع | Frequency | الـ Format |
|---|---|---|
| **Daily snapshot** | يومي بعد الإغلاق | `db/backups/restore_YYYYMMDD_HHMMSS/<db>.db` |
| **Weekly compressed** | أسبوعي | `data/<db>.zip` + git tag `db-snapshot-YYYY-MM-DD` |
| **GitHub Release** | عند الحاجة | GitHub Release assets (limit 2GB/file) — مع restorable instructions |

### 14.3 — الـ Restore Policy

| الأداة | الحالة | الاستخدام |
|---|---|---|
| `vps-service/tools/restore_from_local.py` | ✅ آمن | `--from-git --check` ثم `--from-git` (يعمل backup تلقائي) |
| `vps-service/tools/restore_dbs.py` | ⚠️ خطر — ممنوع | يكتب فوق DBs إنتاجية بدون backup |

### 14.4 — GitHub Backup (DB-RECOVERY 2026-10-21)

الـ DBs مش tracked في git (لأنها كبيرة ~500MB) — لكن الـ snapshots متاحة كـ **GitHub Releases** + **git tags**:

```bash
# Download a snapshot
gh release download db-snapshot-2026-10-21 -R enmohsen20111975/GLMinvestment \
  -D /tmp/db-restore/

# Restore
unzip /tmp/db-restore/stocks.db.zip -d db/
unzip /tmp/db-restore/predictions.db.zip -d db/
# ... الخ

# Verify
sqlite3 db/stocks.db "SELECT COUNT(*) FROM stocks;"
```

### 14.5 — الـ ULTRA-RESTORE policy (من 2026-08-11)

| الحماية | القيمة |
|---|---|
| Cap على الخسائر | `-20%` في `daily_closer.py` + `historical_prediction_generator.py` لمنع الشذوذ الرياضي |
| SELL expiry calculation | إلزامي: `profit_loss = (entry - exit) / entry × 100` (مش BUY formula) |
| Double negation check | ممنوع في `historical_prediction_generator.py` (كان بـ يضرب الموجب مرتين) |

---

## 15. better-sqlite3 vs sql.js

### 15.1 — better-sqlite3 (84 ملف في `src/`)

| البند | القيمة |
|---|---|
| **Type** | Native C++ addon (Node.js binding) |
| **Speed** | أسرع 5-10x من sql.js |
| **Limitations** | يتطلب native compilation (node-gyp) — مشكلة مع Next.js bundler |
| **Use case** | Server-side routes (`src/app/api/*/route.ts`), server-side libraries (`src/lib/*`) |
| **Installation** | `bun add better-sqlite3` + prebuilt binary (موجود في `node_modules/`) |

### 15.2 — sql.js (1 ملف فقط)

| البند | القيمة |
|---|---|
| **Type** | WebAssembly (WASM) |
| **Speed** | أبطأ 5-10x من better-sqlite3 |
| **Limitations** | read-only فعلياً (الكتابة ممكنة بس in-memory مش persistent) |
| **Use case** | Edge runtime, standalone scripts, environments where native compilation غير متاح |
| **File** | `src/lib/data-engine-db-sqljs.ts` |
| **Setup scripts** | `scripts/copy-sqljs-to-standalone.js` + `scripts/edit-sqljs.py` (WASM for standalone) |

### 15.3 — متى نستخدم أيهما؟

| Use case | Recommended |
|---|---|
| API route handler (Node.js runtime) | `better-sqlite3` |
| API route handler (Edge runtime) | `sql.js` (read-only) |
| Standalone script | `better-sqlite3` (إذا الـ native binary متاح) أو `sql.js` |
| Browser-side (rare) | `sql.js` (read-only) |

---

## 16. اختبارات الصحة و cron jobs

### 16.1 — Cron Jobs (الجدول الكامل)

```bash
# Pre-market full sync (06:00 Cairo)
0 6 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 data_engine/main.py >> logs/data_engine.log 2>&1

# Price history safetynet (Yahoo backfill — 06:00 Cairo)
0 6 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/price_history_safetynet.py >> logs/price_history.log 2>&1

# Intraday scraper (every 5 min during market hours 10:00-14:30)
*/5 10-14 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 data_engine/scrapers/tradingview_rest.py --intraday >> logs/intraday.log 2>&1

# Intraday aggregator (every 2 min)
*/2 * * * *   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/intraday_aggregator.py >> logs/intraday_agg.log 2>&1

# Daily predictor (after market close + 30 min)
30 14 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/daily_predictor.py --yesterday-only >> logs/v40_2_daily.log 2>&1

# Daily closer (after predictor)
35 14 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/daily_closer.py >> logs/daily_closer.log 2>&1

# Learning engine (after closer)
0 16 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/learning_engine.py >> logs/learning.log 2>&1

# Intraday scanner (every 5 min during market hours)
*/5 10-14 * * 0-4   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/intraday_scanner.py >> logs/intraday_scanner.log 2>&1

# Hot candidate detector (continuous)
* * * * *   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/hot_candidate_detector.py >> logs/hot_candidate.log 2>&1

# Stale price monitor (every 6h)
0 */6 * * *   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/price_history_stale_monitor.py >> logs/stale_monitor.log 2>&1

# DB health check (daily 03:00)
0 3 * * *   cd /home/z/my-project && /root/.venv/bin/python3 scripts/daily_db_health_check.py >> logs/db_health.log 2>&1

# WAL checkpoint (daily 03:30)
30 3 * * *   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/wal_checkpoint.py --truncate >> logs/wal_checkpoint.log 2>&1

# Corporate actions fetch (weekly Saturday 06:00)
0 6 * * 6   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/fetch_corporate_actions.py >> logs/corp_actions.log 2>&1

# Inflation WorldBank (monthly 1st)
0 6 1 * *   cd /home/z/my-project && /root/.venv/bin/python3 vps-service/jobs/fetch_inflation_worldbank.py >> logs/inflation.log 2>&1

# Sharia compliance (monthly Saturday 15:30)
30 15 * * 6   cd /home/z/my-project && /root/.venv/bin/python3 data_engine/scrapers/sharia_compliance_scraper.py >> logs/sharia.log 2>&1
```

### 16.2 — Health Check Endpoints

| Endpoint | الفحص | Expected Response |
|---|---|---|
| `GET /api/health` (Next.js) | كل الـ DBs متصلة؟ + row counts | `{"status": "ok", "dbs": {"stocks": 1298, "predictions": 5000, ...}}` |
| `GET /health` (Python lightweight_server) | Flask server alive | `{"status": "ok", "version": "..."}` |
| `GET /api/data-engine/health` | data_engine service alive | `{"status": "ok", "last_sync": "..."}` |

### 16.3 — Daily DB Health Check Report

`scripts/daily_db_health_check.py` بـ يـ generate JSON report يومي:

```json
{
  "date": "2026-10-24",
  "dbs": {
    "stocks.db": {
      "size_mb": 12.4,
      "tables": 24,
      "integrity_check": "ok",
      "journal_mode": "wal",
      "page_count": 3168,
      "freelist_count": 12,
      "last_row_added": "2026-10-24T14:35:00"
    },
    "predictions.db": {...},
    "data_engine.db": {...}
  },
  "issues": [],
  "auto_fixed": []
}
```

### 16.4 — صيغة الـ cron schedules (Egypt timezone)

| Schedule | المعنى |
|---|---|
| `0 6 * * 0-4` | 06:00 صباحاً من الأحد للخميس (EGX weekend = Friday+Saturday) |
| `*/5 10-14 * * 0-4` | كل 5 دقايق بين 10:00 و 14:30 من الأحد للخميس (market hours) |
| `30 14 * * 0-4` | 14:30 (market close + 0 min) |
| `0 16 * * 0-4` | 16:00 (post-close + 90 min) |
| `0 3 * * *` | 03:00 صباحاً يومياً (low-traffic) |

> **ملاحظة:** الـ cron تشتغل بـ Africa/Cairo timezone (UTC+2). على VPS لازم `TZ=Africa/Cairo` في `/etc/environment` أو `crontab -e` بـ `CRON_TZ=Africa/Cairo`.

---

## 📚 مراجع إضافية

| المرجع | المحتوى |
|---|---|
| `Documentation/00-CONSTITUTION.md` | Rule 1 (لا تلمس DBs الإنتاج) + Rule 6 (مصدر موحّد للداتا) + Rule 17 (مسارات نسبية) + Rule 44 (NEWS-DB-SOT) + Rule 67 (CALCULATION-CANONICAL) |
| `Documentation/01-ARCHITECTURE.md` | المعمارية العامة + الـ 4 services + الـ 4 logical engines |
| `Documentation/03-ENGINES-AND-LOGIC.md` | المحركات + الـ analyzers + الـ prediction lifecycle |
| `Documentation/05-DATA-ACCESS-LAYER-PLAN.md` | خطة الـ DAL المستقبلية (centralization) |
| `vps-service/core/db_manager.py` | الـ DAL الفعلي (487 LOC) |
| `vps-service/core/database.py` | الـ legacy DAL (1,223 LOC) |
| `prisma/auth-schema.prisma` + `predictions-schema.prisma` | Prisma schemas الكاملة |
| `data_engine/scrapers/` | الـ 27 scraper |
| `crontab.txt` | الجدول الكامل للـ cron jobs (Egypt timezone) |

</div>
