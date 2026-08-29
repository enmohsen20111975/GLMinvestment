# 🗺️ Data Flow Map — GLMinvestment

> **آخر تحديث**: 2026-08-29 (PHASE-2-DB-UNIFY)
> **المؤلف**: Z.ai Code
> **الحالة**: Production reference document

---

## 📋 ملخص تنفيذي

النظام بـ يتكون من **3 layers** متصلة:

1. **Data Engine** (ingestion) — بـ يجيب البيانات من مصادر خارجية ويـ write للـ DBs
2. **Analytics Engine** (Python backend) — بـ يـ read الأسعار، يـ generate signals، ويـ write التوقعات
3. **Frontend** (Next.js) — بـ يـ read من Python API + Direct SQLite + Prisma

---

## 📊 خريطة الـ DBs (الوضع الحالي على الإنتاج)

### ✅ DBs نشطة وفيها بيانات حقيقية

| DB | الحجم | الصفوف | الوصف | التحديث |
|---|---|---|---|---|
| `price_history.db` | 298 MB | 1,248,257 | **الـ canonical price history** (25 سنة، 1,267 tickers) | ✅ 4 كُتاب نشطين |
| `data_engine.db` | 1,540 MB | 0 (egksco_price_history) | fundamentals (tab_*) + live quotes (crypto/gold) | ✅ active (live quotes) |
| `stocks.db` | 12 MB | 29,781 | stocks metadata + stock_daily_prices (آخر 30 يوم) | ✅ active (sync.py) |
| `intraday.db` | 427 MB | 1,136,904 | tick-level data (stock_intraday) | ✅ active |
| `predictions.db` | 173 MB | 184 (predictions) | التوقعات + التعلم + النتائج | ✅ active (V40.2) |
| `auth.db` | 0.2 MB | 99 (User) | المستخدمين + الاشتراكات | ✅ active |
| `content.db` | 12.5 MB | 7,894 (news) | الأخبار + التليجرام | ✅ active |

### ⚠️ DBs "هدف نهائي" لكن لسه فاضية

| DB | الحجم | الحالة | السبب |
|---|---|---|---|
| `market.db` | 0 بايت | ❌ فاضي | `migrate_to_4_dbs.py` اشتغل على لابتوب المالك مش الإنتاج |

### ❌ DBs ميتة (ما تتـ updateش)

- `data_engine.db.egksco_price_history` (0 rows على الإنتاج)
- `data_engine.db.historical_data` (99K rows بس ticker format رقمي — مش حرفي)
- `crypto.db`, `macro.db`, `news.db`, `telegram_data.db` (تم دمجها في content.db)

---

## 🔄 Layer 1: Data Engine (Ingestion)

### 1.1 — الـ writers النشطين لـ `price_history.db.price_history`

| الكاتب | الـ source | التردد | الـ schedule | الـ trigger |
|---|---|---|---|---|
| `daily_price_updater.py` | `tradingview_live` | مرتين يومياً | cron `0 7,13 * * 0-4` | crontab |
| `intraday_aggregator.py` | `intraday_aggregated` | كل 30 دقيقة | MarketScheduler (python-backend) | PM2 |
| `price_history_safetynet.py` | `yahoo_safetynet` | كل 60 دقيقة | MarketScheduler | PM2 |
| `egksco_scraper.py` | `egksco` | كل 15 دقيقة (09:00-14:30) | EgyptScheduler | PM2 |

**النتيجة**: `price_history.db.price_history` بـ تـ update بـ استمرار طول النهار ✅

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
| Read: dates + tickers | `price_history.db.price_history` (PHASE-2) → `data_engine.db.egksco_price_history` → `stocks.db.stock_daily_prices` | — |
| Read: prices (per ticker) | `v38_backtest_engine.get_price_data()` (PHASE-2) | — |
| Read: fundamentals | `data_engine.db.tab_*` | — |
| Read: tickers + sector | `stocks.db.stocks` | — |
| Read: benchmark (EGX30ETF) | V38 engine (lazy) | — |
| **Write: predictions** | — | `predictions.db.predictions` + `persona_predictions` |

### 2.2 — Daily Closer (`vps-service/jobs/daily_closer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: pending predictions | `predictions.db.predictions` (WHERE actual_return IS NULL) | — |
| Read: current prices | `price_history.db.price_history` → `data_engine.db.egksco_price_history` → `stocks.db.stock_daily_prices` | — |
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
| Read: prices (per ticker) | `price_history.db.price_history` (PHASE-2) → `data_engine.db.egksco_price_history` → `stocks.db.stock_daily_prices` |
| Read: fundamentals | `data_engine.db.tab_*` |
| Read: sector info | `stocks.db.stocks` |

**ملاحظة**: الـ engine ما بـ writeش أي حاجة — بـ يحلل فقط.

### 2.5 — Master Analyzer (`vps-service/analyzers/master_analyzer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: prices | `price_history.db.price_history` (canonical) | — |
| Read: intraday | `intraday.db.*` | — |
| Read: metadata | `stocks.db.*` | — |
| Read: fundamentals | `data_engine.db.tab_*` | — |
| **Write: cached analysis** | — | `stocks.db.cached_analysis` |

### 2.6 — Top Performers API (`vps-service/api/top_performers_routes.py`)

| العملية | المصدر |
|---|---|
| Read: prices (PHASE-2) | `price_history.db.price_history` → `data_engine.db.egksco_price_history` |
| Read: metadata | `stocks.db.stocks` |

### 2.7 — Prediction Tracker (`vps-service/analyzers/prediction_tracker.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: predictions | `predictions.db.predictions` + `persona_predictions` | — |
| **Write: predictions** | — | `predictions.db.predictions` (CREATE/INSERT/UPDATE) |

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
| `/api/stocks/top-performers` | Python proxy | `price_history.db.price_history` (PHASE-2) → fallback `data_engine.db` |
| `/api/stocks/screener` | Python proxy | `stocks.db.screener_results` |
| `/api/predictions/honest-tracking/{list,stats,live-tracking}` | Direct SQLite | `predictions.db.predictions` |
| `/api/predictions/honest-tracking/verify-pending` | Python proxy | `predictions.db.hunter_pick_tracking` |
| `/api/stocks/sparkline` | Direct SQLite | `price_history.db.price_history` (PHASE-2) → `data_engine.db` → `stocks.db` |
| `/api/chart/[ticker]` | Direct SQLite | `stocks.db.stock_daily_prices` + fallback `price_history.db.price_history` |
| `/api/auth/*` | Prisma | `auth.db` |
| `/api/subscription/*` | Prisma | `auth.db` |

---

## 🎯 PHASE-2-DB-UNIFY (2026-08-29) — الإصلاح

### المشكلة

`data_engine.db.egksco_price_history` = **0 rows** على الإنتاج (1540 MB فاضي بسبب free pages).
لكن `price_history.db.price_history` = **1,248,257 rows** (25 سنة بيانات، 30K للأسهم الانفجارية).

الـ V38 engine بـ يـ hardcoded يقرا من `data_engine.db.egksco_price_history` → كل tickers بـ skip → **0 signals**.

### الحل

تم تعديل 4 ملفات:

1. **`vps-service/engines/v38_backtest_engine.py`**:
   - `PRICE_HISTORY_DB_LEGACY` constant لـ `price_history.db`
   - `get_price_data()`: price_history.db first → data_engine.db fallback → stocks.db fallback

2. **`vps-service/jobs/v40_2_daily_generator.py`**:
   - `get_scan_dates()`: price_history.db first → data_engine.db fallback → stocks.db
   - `get_tickers()`: نفس الـ order

3. **`vps-service/api/top_performers_routes.py`**:
   - `_get_price_history_conn()` helper جديد
   - الـ query بـ try price_history.db first (schema: ticker, date, close_price)
   - Fallback لـ data_engine.db.egksco_price_history (schema: symbol, price_date, close_price)

4. **`src/app/api/stocks/sparkline/route.ts`**:
   - 3-tier fallback: price_history.db → data_engine.db → stocks.db
   - الـ response بـ include `source` field للـ debugging

5. **`vps-service/utils/db_paths.py`**:
   - `PRICE_HISTORY_DB` → `price_history.db` (مش `market.db` الفاضي)
   - `DATA_ENGINE_DB` → `data_engine.db` (fundamentals + live quotes)
   - `STOCKS_DB` → `stocks.db` (metadata + stock_daily_prices)
   - `INTRADAY_DB` → `intraday.db`
   - `MARKET_DB` → `market.db` (هدف نهائي، لسه فاضي)

### النتيجة المتوقعة

- V40.2 backtest هيـ generate signals بدل 0
- الأسهم الانفجارية (BIOC/NIPH/AMES/GPIM/AFMC/GTWL/CRST) هـ تـ appear في predictions
- Top performers endpoint هـ يشتغل (مش 500)
- Sparklines هـ تظهر بـ بيانات حقيقية

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
│  4 writers → price_history.db.price_history (1.24M rows, 25 سنة):           │
│   • daily_price_updater.py    (cron)    → source=tradingview_live             │
│   • intraday_aggregator.py    (30 min) → source=intraday_aggregated          │
│   • price_history_safetynet.py (60 min) → source=yahoo_safetynet             │
│   • egksco_scraper.py         (15 min)  → source=egksco                       │
│                                                                              │
│  Live quotes → data_engine.db (stocks, crypto_prices, gold_prices, ...):    │
│   • stocks كل 5 دقائق  • crypto كل 2 دقيقة  • metals كل 15 دقيقة             │
│                                                                              │
│  sync.py → stocks.db.stocks + stocks.db.stock_daily_prices                   │
│  intraday_storage.py → intraday.db.* (tick-level, 1.1M rows)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 2: Analytics Engine (PM2: python-backend, port 8010)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  V40.2 generator    → read: price_history.db (PHASE-2) + data_engine.db      │
│                       write: predictions.db.predictions                       │
│                                                                              │
│  daily_closer       → read: predictions.db (pending) + prices                │
│                       write: predictions.db (outcome)                         │
│                                                                              │
│  learning_engine    → read: predictions.db (closed)                           │
│                       write: predictions.db.learned_lessons                   │
│                                                                              │
│  master_analyzer    → read: price_history.db + intraday.db + data_engine.db  │
│                       write: stocks.db.cached_analysis                        │
│                                                                              │
│  top_performers API → read: price_history.db (PHASE-2) → data_engine.db      │
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
│  Key routes:                                                                 │
│   • /api/stocks/top-performers → Python → price_history.db (PHASE-2)          │
│   • /api/stocks/sparkline      → Direct SQLite price_history.db (PHASE-2)    │
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

## ⚠️ Known Issues (post-PHASE-2)

1. **`market.db` = 0 بايت** — الـ 4-DB target architecture لم يكتمل. خلينا نـ stick
   مع الـ 7 DBs النشطة لحد ما نـ run الـ migration على الإنتاج.

2. **`data_engine.db.egksco_price_history` = 0 rows** — الجدول بـ يتـ create تلقائياً
   بس مفيش كاتب نشط بـ يـ populateه. كل الـ readers بـ fallback لـ price_history.db.

3. **`data_engine.db.historical_data` = 99K rows بس ticker format رقمي** (1010, 1020, ...)
   — مش مفيد للـ analytics اللي بـ تستخدم ticker symbols حرفية.

4. **`learning_routes.py` (legacy)** بـ يـ read من `stocks.db` بينما الـ lessons فعلية
   في `predictions.db.learned_lessons`. Inconsistency (low priority).

5. **`live_indicator_engine._get_recent_ohlcv()`** بـ query `price_history` table
   جوه `stocks.db` — dead code path (الجدول مش موجود في stocks.db).

---

## 📚 مراجع

- `Documentation/00-CONSTITUTION.md` — قواعد النظام (32 قاعدة)
- `scripts/audit_backtest.py` — فحص الـ 0 signals
- `scripts/audit_dbs_deep.py` — فحص كل الجداول في كل الـ DBs
- `scripts/migrate_to_4_dbs.py` — سكربت الترحيل (PHASE-4 — لم يكتمل على الإنتاج)
- `vps-service/crontab.txt` — الـ cron jobs الكاملة
- `ecosystem.config.js` — PM2 services
