# 🗺️ Data Flow Map — GLMinvestment

> **آخر تحديث**: 2026-09-03 (WAVE-1+2+3 DB Cleanup: حذف 3 DBs + migration price_history → data_engine.db.egksco_price_history + إسقاط 9 جداول فاضية)
> **آخر تحديث سابق**: 2026-09-01 (Stock Notebook + Disclosure + Decision Logger + Unified Exit + News Fetcher + 10 Feature Flags)
> **المؤلف**: Z.ai Code
> **الحالة**: Production reference document

---

## 📋 ملخص تنفيذي

النظام بـ يتكون من **3 layers** متصلة:

1. **Data Engine** (ingestion) — بـ يجيب البيانات من مصادر خارجية ويـ write للـ DBs
2. **Analytics Engine** (Python backend) — بـ يـ read الأسعار، يـ generate signals، ويـ write التوقعات
3. **Frontend** (Next.js) — بـ يـ read من Python API + Direct SQLite + Prisma

---

## 📊 خريطة الـ DBs (الوضع الحالي بعد WAVE-1+2+3 Cleanup — 2026-09-03)

### ✅ DBs نشطة وفيها بيانات حقيقية (7 DBs بعد التنظيف)

| DB | الحجم | الصفوف | الوصف | التحديث |
|---|---|---|---|---|
| `data_engine.db` | 125 MB | 162,946 (egksco_price_history) + 429,649 (crypto) + 220,598 (gold) + 858-866 (tab_*) | **الـ canonical price history + fundamentals + live quotes** (بعد WAVE-2 migration) | ✅ active (live quotes + egksco) |
| `intraday.db` | 120 MB | 266,259 (stock_intraday) + 151,792 (crypto_intraday) + 22,795 (commodity) | tick-level data | ✅ active |
| `news.db` | 13 MB | 7,806 (market_news) + 7,894 (news_articles) | الأخبار (بعد news migration) | ✅ active |
| `stocks.db` | 10 MB | 1,047 (stocks) + 46,001 (stock_daily_prices) + 256 (egksco_stocks) | stocks metadata + stock_daily_prices (آخر 30 يوم) | ✅ active (sync.py) |
| `predictions.db` | 1.5 MB | 80 (predictions) + 8,544 (outcome_logs) + 494 (learned_lessons) | التوقعات + التعلم + النتائج | ✅ active (V40.2) |
| `auth.db` | 0.18 MB | 90 (User) + 5 (api_tokens) + 75 (task_runs) | المستخدمين + الاشتراكات | ✅ active |
| `price_history.db` | 16 MB | 162,946 (price_history) | **safety net فقط** — الكود بـ reads من data_engine.db.egksco_price_history (الـ canonical) | ⚠️ محتفظ بيه للأمان |

### ❌ DBs تم حذفها في WAVE-1 (2026-09-03)

| DB | الحجم | السبب |
|---|---|---|
| `custom.db` | 24 KB | default Prisma DB — ما كانش بيستخدم (كل الـ references كانت deprecated stubs بتـ route لـ stocks.db) |
| `prices.db` | 21 MB | صفر references في الكود — البيانات كلها مكررة في data_engine.db |
| `crypto.db` | 32 KB | 0 rows + dead code (unified-db.ts كان بـ query جدول `crypto_coins` مش موجود أصلاً) |

### 📊 جداول تم إسقاطها في WAVE-3 (2026-09-03)

**9 جداول فاضية (0 rows + 0 code references) اتشالت:**
- `stocks.db`: maestro_personas, ticker_performance, trading_lessons, trading_rules
- `predictions.db`: CachedAnalysis, TechnicalIndicator (camelCase duplicates)
- `auth.db`: optimized_parameters, platform_recommendations, user_trades

---

## 🔄 Layer 1: Data Engine (Ingestion)

### 1.1 — الـ writers النشطين لـ `data_engine.db.egksco_price_history` (بعد WAVE-2 migration)

> **ملاحظة مهمة (2026-09-03):** قبل WAVE-2، كان فيه 4 writers بـ يكتبوا في `price_history.db.price_history`.
> بعد الـ migration، الكود بـ reads من `data_engine.db.egksco_price_history` (162,946 rows).
> `price_history.db` محتفظ بيه كـ safety net فقط — الكود في الواقع بـ reads من data_engine.db.

| الكاتب | الـ source | الـ destination | الـ schedule |
|---|---|---|---|
| `egksco_scraper.py` | `egksco` | `data_engine.db.egksco_price_history` | كل 15 دقيقة (09:00-14:30) |
| `daily_price_updater.py` (legacy) | `tradingview_live` | `price_history.db.price_history` (safety net) | cron `0 7,13 * * 0-4` |
| `intraday_aggregator.py` (legacy) | `intraday_aggregated` | `price_history.db.price_history` (safety net) | كل 30 دقيقة |
| `price_history_safetynet.py` (legacy) | `yahoo_safetynet` | `price_history.db.price_history` (safety net) | كل 60 دقيقة |

### 1.1b — news-agent scrapers (مدerged من news repo)

> **الـ module:** `news-agent/` (submodule from https://github.com/enmohsen20111975/news/)
> **التكامل:** 2026-09-03 (Rule 47: NEWS-AGENT-INTEGRATION)

| Scraper | المصدر | الـ destination | الحالة |
|---|---|---|---|
| `tradingview_rest.py` | scanner.tradingview.com (REST API) | `db/data_engine.db.stocks` | ✅ نشط (urllib فقط) |
| `tradingview_screener_lists.py` | TradingView screener | `db/data_engine.db.screener_lists` | ✅ نشط |
| `tradingview_market_movers.py` | TradingView 9 tabs | `db/data_engine.db.market_movers_tabs` | ✅ نشط |
| `egx_news_scraper.py` | EGX official site | `db/news.db.market_news` | ✅ نشط |
| `marketmaker_news_scraper.py` | MarketMaker | `db/news.db.market_news` | ✅ نشط |
| `telegram_collector.py` | Telegram channels | `db/news.db.market_news` | ⚠️ محتاج telethon |
| `tradingview_scraper.py` | TradingView (Playwright) | `db/data_engine.db.stocks` | ⚠️ محتاج Playwright |
| `web_scraper.py` | Web scraping | `db/news.db.market_news` | ⚠️ محتاج trafilatura |
| `rss_collector.py.disabled` | RSS feeds | — | 🚫 معطّل (feedparser) |
| `investing_scraper.py.disabled` | sa.investing.com | — | 🚫 معطّل (Playwright) |
| `investing_news_collector.py.disabled` | sa.investing.com/news | — | 🚫 معطّل (Playwright) |

**Rule 28 (NO-DUPLICATION):** كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical).
**Rule 29 (UNIFIED-SYSTEM):** `news-agent/config/paths.py` بيوفّر مسارات موحدة.
**news merge:** 212 خبر من news-agent القديم ادمجت في `db/news.db.market_news` (الإجمالي 8,012 خبر).

### 1.2 — الـ writers لـ `data_engine.db` (live quotes)

| الكاتب | الـ destination | التردد |
|---|---|---|
| `data_engine/main.py::run_scheduler` | `data_engine.db.stocks` | كل 5 دقائق |
| `crypto_fetcher.py` | `data_engine.db.crypto_prices` + `btc_local_prices` | كل 2 دقيقة |
| `metals_forex_fetcher.py` | `data_engine.db.gold_prices` + `silver_prices` + `exchange_rates` | كل 15 دقيقة |
| `news_fetcher` | `news.db.news_articles` (→ `content.db.news_articles`) | كل 6 ساعات |
| `data_engine/sync.py` | `stocks.db.stocks` + `stocks.db.stock_daily_prices` | عند كل تحديث |
| `intraday_storage.py` | `intraday.db.stock_intraday` + `crypto_intraday` + `commodity_intraday` | عند كل tick |

### 1.3 — الـ cron jobs (من `vps-service/crontab.txt`)

```
*/5 8-12 * * 0-4   tradingview_scraper  (كل 5 دقائق، 08:00-12:00 UTC)
0 7,13 * * 0-4     daily_price_updater  (مرتين يومياً)
5 13 * * 0-4       v40_2_daily_generator (يومي 13:05 UTC)
30 13 * * 0-4      daily_closer          (يومي 13:30 UTC)
40 13 * * 6        learning_engine       (سبتي أسبوعي)
0 14 * * 6         egx_fundamental_fetcher (سبتي أسبوعي)
0 1 * * *          daily_db_health_check (يومي 01:00)
30 1 * * *         daily_backup          (يومي 01:30)
0 3 * * *          smart_db_backup       (يومي 03:00)
0 * * * *          data_heartbeat_checker (كل ساعة)
```

---

## 🔄 Layer 2: Analytics Engine (Python backend)

### 2.1 — V40.2 Generator (`vps-service/jobs/v40_2_daily_generator.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: dates + tickers | **`data_engine.db.egksco_price_history`** (canonical) → `stocks.db.stock_daily_prices` (fallback) | — |
| Read: prices (per ticker) | `v38_backtest_engine.get_price_data()` (PRIMARY: data_engine.db) | — |
| Read: fundamentals | `data_engine.db.tab_*` (858-866 rows) + `stocks.db.stocks` (330 with ROE) | — |
| Read: screener lists | `data_engine.db.screener_lists` (1,459 entries: most_active, top_gainers, unusual_volume, high_dividend) | — |
| Read: tickers + sector | `stocks.db.stocks` | — |
| Read: news impact | `predictions.db.outcome_logs` + live news from `/api/proxy-prod/news-feed` | — |
| Read: benchmark (EGX30ETF) | V38 engine (lazy) | — |
| **Write: predictions** | — | `predictions.db.predictions` + `persona_predictions` |

### 2.2 — Daily Closer (`vps-service/jobs/daily_closer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: pending predictions | `predictions.db.predictions` (WHERE actual_return IS NULL) | — |
| Read: current prices | **`data_engine.db.egksco_price_history`** (canonical) → `stocks.db.stock_daily_prices` (fallback) | — |
| **Write: outcome** | — | `predictions.db.predictions` (UPDATE actual_return + exit_type) |

### 2.3 — Learning Engine (`vps-service/jobs/learning_engine.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: closed predictions | `predictions.db.predictions` (WHERE actual_return IS NOT NULL) | — |
| **Write: lessons** | — | `predictions.db.learned_lessons` + `sniper_performance` |
| **Write: optimizer params** | — | `vps-service/config/optimizer_params.json` |

### 2.4 — V38 Backtest Engine (`vps-service/engines/v38_backtest_engine.py`)

| العملية | المصدر |
|---|---|
| Read: prices (per ticker) | **`data_engine.db.egksco_price_history`** (PRIMARY, 162,946 rows) → `stocks.db.stock_daily_prices` (fallback, 46,001 rows) |
| Read: fundamentals | `data_engine.db.tab_*` + `stocks.db.stocks` (330 with ROE) |
| Read: sector info | `stocks.db.stocks` |

**ملاحظة**: الـ engine ما بـ writeش أي حاجة — بـ يحلل فقط.

### 2.5 — Master Analyzer (`vps-service/analyzers/master_analyzer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: prices | **`data_engine.db.egksco_price_history`** (canonical) | — |
| Read: intraday | `intraday.db.*` | — |
| Read: metadata | `stocks.db.*` | — |
| Read: fundamentals | `data_engine.db.tab_*` | — |
| **Write: cached analysis** | — | `stocks.db.cached_analysis` |

### 2.6 — Top Performers API (`vps-service/api/top_performers_routes.py`)

| العملية | المصدر |
|---|---|
| Read: prices | **`data_engine.db.egksco_price_history`** (canonical) |
| Read: metadata | `stocks.db.stocks` |

### 2.7 — Prediction Tracker (`vps-service/analyzers/prediction_tracker.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: predictions | `predictions.db.predictions` + `persona_predictions` | — |
| **Write: predictions** | — | `predictions.db.predictions` (CREATE/INSERT/UPDATE) |

### 2.8 — Screener Integration (`vps-service/analyzers/screener_integration.py`)

> **الكنز المدفون #1** — مربوط في V40.2 generator (line 1036-1120)

| العملية | المصدر |
|---|---|
| Read: screener tags | `data_engine.db.screener_lists` (most_active, unusual_volume, top_gainers, high_dividend, top_losers) |
| Read: fundamentals boost | `data_engine.db.tab_valuation` + `tab_profitability` |
| Read: bid/ask spread | `intraday.db.*` (bid/ask columns) |
| Apply: VETO / BOOST | → modifies V40.2 score |

### 2.9 — News Impact Integration (`vps-service/analyzers/live_news_integration.py`)

> **الكنز المدفون #2** — 5 levels: STRONG_POSITIVE / POSITIVE / NEUTRAL / NEGATIVE / STRONG_NEGATIVE

| العملية | المصدر |
|---|---|
| Read: news | `predictions.db.outcome_logs` + live `/api/proxy-prod/news-feed` |
| Classify impact | 5 levels → score_delta (+15/+8/0/-8/-15) |
| Apply: combined_score | → modifies V40.2 score + signal |

### 2.10 — Position Sizing (`vps-service/analyzers/position_sizing.py`)

> **الكنز المدفون #3** — volatility-based position sizing

| العملية | المصدر |
|---|---|
| Read: ATR | `v38_backtest_engine.get_price_data()` |
| Classify volatility | LOW (<3%) / NORMAL (3-6%) / HIGH (≥6%) |
| Apply: position_size_mult | HIGH=0.55, NORMAL=0.80, LOW=1.00 |

---

## 🔄 Layer 3: Frontend (Next.js)

### 3.1 — أنماط الوصول للـ data

| النمط | عدد الـ routes | الوصف |
|---|---|---|
| **Python proxy** | 250 route | `/api/proxy/*` و `/api/python/*` → `localhost:8010` (Flask) |
| **Direct SQLite** | 53 route | `better-sqlite3` reads مباشرة من DBs |
| **Prisma** | 10 route | `auth.db` + `predictions.db` |

### 3.2 — الـ Prisma clients

```typescript
// src/lib/db.ts
authDb       → auth.db (User, Session, Subscription, Watchlist, Portfolio)
predictionsDb → predictions.db (Prediction, PersonaPrediction, ExpertRecommendation)
```

### 3.3 — أهم الـ routes + مصادرها

| Route | النمط | المصدر |
|---|---|---|
| `/api/stocks/top-performers` | Python proxy | **`data_engine.db.egksco_price_history`** (canonical after WAVE-2) |
| `/api/stocks/screener` | Python proxy | `stocks.db.screener_results` |
| `/api/predictions/honest-tracking/{list,stats,live-tracking}` | Direct SQLite | `predictions.db.predictions` |
| `/api/predictions/honest-tracking/verify-pending` | Python proxy | `predictions.db.hunter_pick_tracking` |
| `/api/stocks/sparkline` | Direct SQLite | **`data_engine.db.egksco_price_history`** → `stocks.db.stock_daily_prices` (fallback) |
| `/api/chart/[ticker]` | Direct SQLite | `stocks.db.stock_daily_prices` + fallback **`data_engine.db.egksco_price_history`** |
| `/api/news` | Direct SQLite | `news.db.market_news` (7,806 rows — migrated from news_articles) |
| `/api/data-engine/health` | Direct SQLite | `data_engine.db.egksco_price_history` (probe table) |
| `/api/admin/db-health` | Direct SQLite | `data_engine.db` + `stocks.db` + `predictions.db` |
| `/api/auth/*` | Prisma | `auth.db` |
| `/api/subscription/*` | Prisma | `auth.db` |

---

## 🎯 WAVE-1+2+3 DB Cleanup (2026-09-03) — التنظيف الشامل

### المشكلة

قبل التنظيف كان فيه **10 DBs** بإجمالي ~345 MB، فيها:
- 3 DBs مش مستخدمة خالص (custom, prices, crypto)
- price_history.db فيه 162,946 rows (نفس البيانات موجودة في data_engine.db.egksco_price_history)
- 9 جداول فاضية (0 rows) منتشرة في stocks.db + predictions.db + auth.db
- 123 سطر كود ميت في unified-db.ts (getCryptoDb + CryptoCoin interface)
- dead endpoint /api/unified-crypto

### الحل — 3 موجات منفصلة

#### WAVE-1: حذف 3 DBs (توفير ~37 MB + 123 lines dead code)
- `custom.db` (24 KB) — default Prisma DB، الـ stubs كلها deprecated (بتـ route لـ stocks.db)
- `prices.db` (21 MB) — صفر references في الكود، البيانات كلها مكررة في data_engine.db
- `crypto.db` (32 KB) — 0 rows + dead code (unified-db.ts بـ query جدول مش موجود)

كمان اتعمل cleanup لـ `src/lib/unified-db.ts` (شيل 124 سطر كود ميت) + حذف dead endpoint `/api/unified-crypto/route.ts`.

#### WAVE-2: migration price_history readers لـ data_engine.db.egksco_price_history

**الـ migration rules:**
- `FROM price_history` → `FROM egksco_price_history`
- `ticker` → `symbol`
- `date` → `price_date`
- شيل أي filter على `source` (egksco_price_history مفيهاش source column)

**الـ files اللي اتعملها migration (10 files):**

| File | التعديل |
|---|---|
| `src/lib/data-engine-db.ts` | `getPriceHistoryDb()` بقى alias لـ `getDataEngineDb()` + 3 SQL queries rewritten |
| `src/lib/data-engine-db-sqljs.ts` | `getPriceHistoryDbSqlJs()` بقى alias + `getLastCleanClose()` + `getHistoricalData()` rewritten |
| `src/lib/market-data-access.ts` | Source 3 في `getAvailableTickers()` + `getPriceHistory()` rewritten |
| `src/lib/new-db-queries.ts` | DB_PATHS + `getPriceHistoryFromNewDb()` + `areNewDbsAvailable()` + `getNewDbHealth()` rewritten |
| `src/app/api/health/route.ts` | check على `data_engine.db` بدل `price_history.db` |
| `src/app/api/admin/db-health/route.ts` | probe `egksco_price_history` بدل `price_history` |
| `src/app/api/admin/engines-status/route.ts` | `MAX(price_date)` من `egksco_price_history` |
| `src/app/api/data-engine/health/route.ts` | probe table `egksco_price_history` |
| `src/app/api/data-engine/status/route.ts` | `COUNT(*) FROM egksco_price_history` |
| `src/app/api/chart/[ticker]/route.ts` | fallback query rewritten |

#### WAVE-3: drop 9 جداول فاضية + VACUUM (توفير ~4.5 MB)

| DB | الجداول اللي اتمسحت |
|---|---|
| `stocks.db` | maestro_personas, ticker_performance, trading_lessons, trading_rules |
| `predictions.db` | CachedAnalysis, TechnicalIndicator (camelCase duplicates) |
| `auth.db` | optimized_parameters, platform_recommendations, user_trades |

VACUUM اتعمل لـ 3 DBs (stocks.db, predictions.db, auth.db).

### النتيجة النهائية

- **7 DBs** بدل 10 (توفير ~41.5 MB)
- **9 جداول أقل**
- **123 سطر كود ميت أقل**
- `price_history.db` محتفظ بيه كـ **safety net فقط** (الكود بـ reads من data_engine.db.egksco_price_history)
- كل الـ API routes بـ 200 OK
- Lint بدون أخطاء
- Backtest محترم اشتغل بـ 68 trade (PF=1.19, Return=+1.35%)

### news.db migration (إضافي)

بعد استرجاع الـ DBs من `data/all.zip`، `news.db` كان فيه `news_articles` (7,894 rows) بس الكود بـ reads من `market_news`. اتعمل migration script:
- `scripts/migrate-news-table.py`
- `news_articles` (7,894) → `market_news` (7,806) — schema mapping كامل

---

## 📅 خريطة الـ data flow المتكاملة

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  External Sources                                                            │
│  (TradingView, EGKSCO, Yahoo, Crypto APIs, Gold APIs, News, Telegram)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 1: Data Engine (PM2: data-engine, python-backend)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  CANONICAL: data_engine.db.egksco_price_history (162,946 rows, 1047 tickers):│
│   • egksco_scraper.py         (15 min, 09:00-14:30) → source=egksco           │
│                                                                              │
│  SAFETY NET: price_history.db.price_history (162,946 rows — duplicate):     │
│   • daily_price_updater.py    (cron, legacy) → source=tradingview_live       │
│   • intraday_aggregator.py    (30 min, legacy) → source=intraday_aggregated │
│   • price_history_safetynet.py (60 min, legacy) → source=yahoo_safetynet     │
│                                                                              │
│  Live quotes → data_engine.db (stocks, crypto_prices, gold_prices, ...):    │
│   • stocks كل 5 دقائق  • crypto كل 2 دقيقة  • metals كل 15 دقيقة             │
│                                                                              │
│  sync.py → stocks.db.stocks + stocks.db.stock_daily_prices                   │
│  intraday_storage.py → intraday.db.* (tick-level, 440K rows)                 │
│  news_fetcher → news.db.market_news (7,806 rows — migrated)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 2: Analytics Engine (PM2: python-backend, port 8010)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  V40.2 generator    → read: data_engine.db.egksco_price_history (canonical) │
│                       + screener_lists + tab_* + stocks.db                   │
│                       + news impact (live_news_integration)                  │
│                       + position sizing (volatility-based)                   │
│                       write: predictions.db.predictions                       │
│                                                                              │
│  daily_closer       → read: predictions.db (pending) + data_engine.db prices │
│                       write: predictions.db (outcome)                         │
│                                                                              │
│  learning_engine    → read: predictions.db (closed)                           │
│                       write: predictions.db.learned_lessons                   │
│                                                                              │
│  master_analyzer    → read: data_engine.db + intraday.db + stocks.db         │
│                       write: stocks.db.cached_analysis                        │
│                                                                              │
│  top_performers API → read: data_engine.db.egksco_price_history (canonical) │
│                                                                              │
│  Treasures (3 modules):                                                      │
│   • screener_integration.py → VETO/BOOST based on screener lists             │
│   • live_news_integration.py → 5 levels news impact (+15/-15)                │
│   • position_sizing.py → volatility-based size (55%/80%/100%)                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 3: Frontend (PM2: nextjs, port 3000)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  3 access patterns:                                                          │
│   • Python proxy (250 routes): /api/proxy/* → localhost:8010                │
│   • Direct SQLite (53 routes): better-sqlite3 reads                         │
│   • Prisma (10 routes): auth.db + predictions.db                            │
│                                                                              │
│  Key routes (post-WAVE-2 migration):                                         │
│   • /api/stocks/top-performers → Python → data_engine.db.egksco_price_history│
│   • /api/stocks/sparkline      → Direct SQLite data_engine.db.egksco_price  │
│   • /api/chart/[ticker]        → stocks.db + fallback data_engine.db        │
│   • /api/news                   → Direct SQLite news.db.market_news           │
│   • /api/predictions/*         → Direct SQLite predictions.db                │
│   • /api/auth/*                → Prisma auth.db                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  User Browser (React UI)                                                      │
│  /  → UnifiedScreener + MarketAnalysis + PredictionTrackingDashboard        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Known Issues (post-WAVE-1+2+3 Cleanup)

1. **`price_history.db` محتفظ بيه كـ safety net** — الكود بـ reads من data_engine.db.egksco_price_history، لكن الـ file لسه موجود عشان لو حصل أي مشكلة. ممكن يتشال لاحقاً بعد مراقبة الإنتاج لفترة.

2. **`data_engine.db.historical_data` = 99K rows بس ticker format رقمي** (1010, 1020, ...)
   — مش مفيد للـ analytics اللي بـ تستخدم ticker symbols حرفية.

3. **`learning_routes.py` (legacy)** بـ يـ read من `stocks.db` بينما الـ lessons فعلية
   في `predictions.db.learned_lessons`. Inconsistency (low priority).

4. **`live_indicator_engine._get_recent_ohlcv()`** بـ query `price_history` table
   جوه `stocks.db` — dead code path (الجدول مش موجود في stocks.db).

5. **Python backend bug (anyio + starlette)** — `/api/stocks/top-performers` بيرجع 502 بسبب تعارض إصدارات في Python stack. مش متعلق بالـ DBs.

6. **`tab_profitability` لمصر فاضي** — الـ ROE/ROA فيه `None` لكل الـ stocks المصرية. الكود بيـ fallback لـ `stocks.db.stocks.roe` (اللي فيه 330 سهم بـ ROE).

---

## 📚 مراجع

- `Documentation/00-CONSTITUTION.md` — قواعد النظام (40 قاعدة + عهد الوكيل 30 بند)
- `scripts/audit_backtest.py` — فحص الـ 0 signals
- `scripts/audit_dbs_deep.py` — فحص كل الجداول في كل الـ DBs
- `scripts/migrate_to_4_dbs.py` — سكربت الترحيل (PHASE-4 — لم يكتمل على الإنتاج)
- `vps-service/crontab.txt` — الـ cron jobs الكاملة
- `ecosystem.config.js` — PM2 services

---

## 🆕 V40.2 Subsystem Flows (2026-09-01)

> أُضيفت بعد إضافة الـ modules الستة (Stock Notebook + Disclosure + Strict Entry + Distribution Exit + News Fetcher + Decision Logger + Unified Exit Engine) + 10 Feature Flags. كلها default OFF عشان نحافظ على الـ baseline الإنتاجي.

### 📒 Stock Notebook Flow

```
notebooks/EGX/*.json (259 ملف JSON)
   ↓ load_stock_notebook(symbol) / get_machine_summary(symbol)
V40.2 generator (per ticker)
   ↓ apply_notebook_context(current_score, stop_distance_pct, ...)
   ↓ toggle: V40_2_NOTEBOOK_CONTEXT=1
   ↓ لو danger_level=5 → تقليل الحجم
   ↓ لو typical_correction_pct → مراجعة مسافة الوقف
decision_logger.log_decision() ← سجل: notebook_summary, flag_active
```

### 🏛️ Disclosure Engine Flow

```
EGX/EGKSCO disclosures (HTML)
   ↓ fetch_disclosures() (cron كل ساعتين 10:00-14:00)
   ↓ classify_disclosure(text) → 12 نوع
   ↓ score_disclosure(event_type) → -2 لـ +2
db/disclosures.db.egx_disclosures (dedup: ticker + event_type + date + title)
   ↓ get_disclosure_impact(ticker)
V40.2 generator
   ↓ toggle: V40_2_DISCLOSURE_IMPACT=1
   ↓ VETO (-2) → continue (hard reject)
   ↓ REDUCE (-1) → score -= 10
   ↓ BOOST (+1/+2) → score += 10/20
decision_logger.log_decision() ← سجل: reason_code='disclosure_veto', flag_active
```

### 🚷 Strict Entry Flow

```
V40.2 generator (per BUY signal)
   ↓ is_in_accumulation(closes, highs, lows, volumes) → range <12% + volume <1.2×
   ↓ is_liquidity_grab(highs, lows, closes, volumes) → sweep + reclaim + volume ≥1.8×
   ↓ is_late_entry(closes, highs, rsi) → near 20d high <6% OR RSI >65 OR +15% in 5d
   ↓ toggle: V40_2_STRICT_ENTRY=1
   ↓ لو is_late_entry → REJECT (Don't Chase)
   ↓ لو is_in_accumulation OR is_liquidity_grab → ACCEPT
   ↓ غير كده → REJECT
decision_logger.log_decision() ← سجل: reason_code='late_entry', flag_active
```

### 📊 Distribution Exit Flow (daily_closer)

```
daily_closer (per open prediction)
   ↓ detect_distribution(opens, highs, lows, closes, volumes, rsi)
   ↓ 5 شروط: red candle + upper_wick≥body + volume>1.8×MA + near 20d high ≤8% + RSI>65
   ↓ toggle: V40_2_DISTRIBUTION_EXIT=1
   ↓ لو is_distribution → force exit (priority 1)
   ↓ exit_type = 'distribution_exit'
   ↓ UPDATE predictions SET exit_type='distribution_exit', outcome=...
decision_logger.log_decision() ← سجل: reason_code='distribution_exit', flag_active
```

### 🚪 Short Holding Exit (هيكلي — مش زمني) Flow

```
daily_closer (per open prediction)
   ↓ should_force_exit_by_time(entry_date, current_date, entry_price, current_price,
                                typical_correction_pct, rsi, recent_closes)
   ↓ toggle: V40_2_SHORT_HOLDING=1
   ↓
   ↓ 1. early_drop: نزول ≤ -7% في أول 3 أيام → exit
   ↓ 2. compound_breakdown: بعد 10 أيام + نزول ×1.3 من typical_correction + RSI<30 + 5 شموع حمراء → exit
   ↓ 3. review_alert: بعد 7 أيام + نزول خارج التصحيح → تنبيه (NOT exit)
   ↓
   ↓ typical_correction_pct جاي من notebooks/EGX/<ticker>.json
   ↓ is_within_typical_correction() + is_breakdown_not_correction()
   ↓ UPDATE predictions SET exit_type='early_drop'/'compound_breakdown_exit'
decision_logger.log_decision() ← سجل: reason_code='early_drop'/'compound_breakdown', flag_active
```

### 📰 News Fetcher Flow

```
DuckDuckGo HTML search (مجاني)
   ↓ news_fetcher_analyzer.fetch_news_for_ticker(ticker)
   ↓ keyword-based sentiment: +2/+1/0/-1/-2
   ↓ news.db (fallback)
V40.2 generator
   ↓ toggle: V40_2_NEWS_IMPACT=1
   ↓ score +2 → BOOST_STRONG (+20)
   ↓ score +1 → BOOST (+10)
   ↓ score -1 → REDUCE (-10)
   ↓ score -2 → VETO (hard reject)
decision_logger.log_decision() ← سجل: reason_code='news_veto', flag_active
```

### 📰 News Signals Ingest Flow (إضافة المبرمج الآخر)

```
External News Agent (local)
   ↓ HTTP POST /api/news/ingest
   ↓ src/app/api/news/ingest/route.ts
   ↓ يكتب في news.db (أو content.db.news_articles)
vps-service/ai/news_signals_reader.py
   ↓ get_news_bias(ticker) → يقرأ من news.db
   ↓ apply_news_bias_to_score(score, ticker) — يطبّق bias على القرار في V40.2
   ↓ يُستدعى من v40_2_daily_generator.py + v40_2_intraday_scanner.py
```

### 📝 Decision Logger Flow

```
أي مسار (V40.2 + daily_closer + strict_entry + disclosure + news + notebook)
   ↓ log_decision(symbol, market, decision_type, reason_code, reason_text, flag_active, notebook_summary)
db/decision_log.db.decision_log (table)
   ↓ get_decision_stats() → analytics لمعرفة هل الفلاتر بتساعد أم بتقتل الإشارات
Admin UI (#admin) ← يعرض stats
```

### 🚪 Unified Exit Engine Flow

```
daily_closer (per open prediction)
   ↓ evaluate_unified_force_exit(market='STOCKS'/'CRYPTO', ...)
   ↓ toggle: V40_2_UNIFIED_EXIT=1
   ↓
   ↓ MARKET_PROFILES['STOCKS']: 7 أيام max, no_move 3d +3%, early -5%, dist wick ≥1.0×
   ↓ MARKET_PROFILES['CRYPTO']: 72h max, no_move 24h +5%, early -8%, dist wick ≥1.2×
   ↓
   ↓ priority: Veto (1) → Distribution (2) → Max holding (3) → No move (4) → Early adverse (5)
   ↓ exit_code = 'veto'/'distribution_exit'/'max_holding'/'no_move'/'early_adverse'
   ↓ UPDATE predictions SET exit_type=exit_code
decision_logger.log_decision() ← سجل: reason_code, flag_active
```

### 🚦 Feature Flags Matrix (10 flags — كلها OFF افتراضياً)

| Flag | الـ module | التأثير لو ON |
|---|---|---|
| `V40_2_STRICT_ENTRY` | strict_entry_filters.py | قبول تراكم/liquidity grab فقط — Don't Chase |
| `V40_2_DISCLOSURE_IMPACT` | egx_disclosure_engine.py | تأثير الإفصاحات على القرار (-2/+2) |
| `V40_2_NOTEBOOK_CONTEXT` | stock_notebook.py | تطبيق سياق النوتبوك (danger_level, typical_correction) |
| `V40_2_SHORT_HOLDING` | short_holding_exit.py | خروج هيكلي (early_drop, compound_breakdown) |
| `V40_2_DISTRIBUTION_EXIT` | short_holding_exit.py::detect_distribution() | شمعة التوزيع → خروج (priority 1) |
| `V40_2_NEWS_IMPACT` | news_fetcher_analyzer.py | تأثير الأخبار + sentiment (-2/+2) |
| `V40_2_CRYPTO_STRICT_ENTRY` | crypto_strict_filters.py | نسخة الكريبتو |
| `V40_2_CRYPTO_DISCLOSURE_IMPACT` | crypto_disclosure_engine.py | نسخة الكريبتو |
| `V40_2_CRYPTO_NEWS_IMPACT` | crypto_news_fetcher.py | نسخة الكريبتو |
| `V40_2_UNIFIED_EXIT` | unified_exit_engine.py | توحيد قرارات الخروج (أسهم + كريبتو) |

> **الترتيب في V40.2 (per BUY signal):** strict_entry (1) → disclosure (2) → notebook_context (3) → news (4). كل خطوة بـ يستدعي `decision_logger.log_decision()` لو رفض.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `DATA_FLOW_MAP.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "V40.2 Subsystem Flows (2026-09-01)" يحتوي على 8 flow diagrams: Stock Notebook, Disclosure Engine, Strict Entry, Distribution Exit, Short Holding Exit (هيكلي), News Fetcher, News Signals Ingest, Decision Logger, Unified Exit Engine. إضافة Feature Flags Matrix (10 flags). تحديث مراجع لـ "40 قاعدة + عهد الوكيل 30 بند". |

---

## 🆕 Screener + Fundamentals + Bid/Ask Integration (2026-09-03)

**الـ module:** `vps-service/analyzers/screener_integration.py`

يربط 3 مصادر بيانات مدفونة بـ V40.2:

### 1. screener_lists (data_engine.db)
- الكاتب: `data_engine/scrapers/tradingview_screener_lists.py`
- 8 قوائم: most_active, unusual_volume, high_dividend, high_net_income, undervalued, top_losers, penny, top_gainers
- التأثير على V40.2: boost/veto score (+10 لـ unusual_volume, -8 + VETO لـ penny)

### 2. tab_valuation + tab_profitability (data_engine.db)
- الكاتب: `data_engine/scrapers/tradingview_market_movers.py`
- بيانات: P/E, P/B, ROE, net_margin
- التأثير: ROE>15% + P/E<15 → +5 pts, P/E>100 → VETO (bubble)

### 3. intraday_prices bid/ask (intraday.db)
- الكاتب: `data_engine/intraday_storage.py` (schema موجود بس أعمدة bid/ask كانت فاضية)
- التأثير: spread < 0.5% → +3 pts (سيولة عالية)

### مكان الربط في V40.2:
```
V40.2 analyze_single_day_v393()
    ↓
entry_gate (8 شروط)
    ↓
screener_integration ← جديد (screener + fundamentals + bid/ask)
    ↓
sector-liquidity filter
    ↓
BOS/ChoCH filter
    ↓
V68/V72/V73 kill filters
    ↓
signals_by_date.append()
```

### الـ logs:
```
[SCREENER-BOOST] ABUK: score 90→100 (unusual_volume +10pts | undervalued +9pts)
[SCREENER-VETO] XYZ: penny → VETO (فخ قرشية)
```
