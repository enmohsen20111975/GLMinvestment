# 🗺️ Data Flow Map — GLMinvestment

> **آخر تحديث**: 2026-09-01 (إضافة Stock Notebook Flow + Disclosure Engine Flow + Decision Logger Flow + Unified Exit Engine Flow + News Fetcher/Ingest Flow + 10 Feature Flags data gating)
> **آخر تحديث سابق**: 2026-08-29 (PHASE-2-DB-UNIFY)
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
