# 02 — قواعد البيانات ومصادر الحقيقة

> **آخر تحديث:** 2026-10-29 | **Commit:** `0291a18`
> **هذا الملف هو المرجع الموحّد لكل قواعد البيانات ومصادرها وجداولها.**

---

## الفهرس

1. [استراتيجية الطبقات](#1-استراتيجية-الطبقات)
2. [قواعد البيانات الرئيسية](#2-قواعد-البيانات-الرئيسية)
3. [مخطط stocks.db الكامل](#3-مخطط-stocksdb-الكامل)
4. [مخطط predictions.db الكامل](#4-مخطط-predictionsdb-الكامل)
5. [مخطط data_engine.db الكامل](#5-مخطط-data_enginedb-الكامل)
6. [مخطط intraday.db](#6-مخطط-intradaydb)
7. [مصادر البيانات الخارجية](#7-مصادر-البيانات-الخارجية)
8. [قواعد الملكية (Writers vs Readers)](#8-قواعد-الملكية-writers-vs-readers)
9. [تدفق البيانات (Data Flow)](#9-تدفق-البيانات-data-flow)
10. [النسخ الاحتياطية](#10-النسخ-الاحتياطية)
11. [المشاكل المعروفة + الإصلاحات](#11-المشاكل-المعروفة--الإصلاحات)

---

## 1. استراتيجية الطبقات

| Tier | DB | الدور | الوصف |
|------|-----|------|-------|
| **Write-Heavy (Raw)** | `data_engine.db`, `intraday.db` | بيانات أولية من scrapers | بيانات خام من مصادر خارجية |
| **Read-Heavy (Synced)** | `stocks.db`, `price_history.db` | متزامنة من data_engine | الـ SSOT اللي بيقرأها الموقع |
| **Brain Output** | `predictions.db` | كل مخرجات المحركات | توقعات + نتائج + تعلّم |
| **User State** | `auth.db`, `news.db` | مستخدمون + أخبار | بيانات تشغيلية |

---

## 2. قواعد البيانات الرئيسية

| DB | الحجم (تقريبي) | الجداول | الدور |
|----|----------------|---------|------|
| `stocks.db` | 25-26 MB | ~53 جدول | الـ SSOT الأساسي — أسعار + أساسيات + مؤشرات |
| `predictions.db` | 277-300 MB | ~33 جدول | التوقعات + النتائج + التعلم |
| `data_engine.db` | 531 MB | ~29 جدول | بيانات خام من scrapers |
| `intraday.db` | 125 MB | 3 جداول | بيانات لحظية (intraday) |
| `auth.db` | صغير | NextAuth tables | مستخدمون + sessions |
| `news.db` | متغير | market_news | أخبار + sentiment |

---

## 3. مخطط stocks.db الكامل

### 3.1 الجدول الرئيسي: `stocks`

```sql
CREATE TABLE stocks (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    name_ar TEXT,
    market TEXT DEFAULT 'EGX',          -- EGX | TADAWUL | KSE | QSE | US | america
    sector TEXT,
    industry TEXT,
    current_price REAL,
    previous_close REAL,
    change REAL,
    change_percent REAL,
    volume INTEGER,
    value_traded REAL,
    turnover_egp REAL,
    is_active INTEGER DEFAULT 1,
    last_updated TEXT,
    last_update TEXT,
    pe_ratio REAL, pb_ratio REAL, roe REAL,
    market_cap REAL, shares_outstanding REAL,
    dividend_yield REAL,
    currency TEXT DEFAULT 'EGP',
    exchange TEXT DEFAULT 'EGX',
    created_at TEXT, updated_at TEXT
);
-- UNIQUE INDEX on (symbol) أو (ticker)
```

**الأعمدة الإضافية** (تُضاف ديناميكيًا بواسطة `tradingview_scanner_live.py`):
`rsi`, `macd`, `macd_signal`, `sma20`, `sma50`, `sma200`, `atr`,
`recommend_all`, `recommend_ma`, `recommend_other`,
`volatility_daily`, `volatility_weekly`,
`avg_volume_30d`, `avg_volume_10d`, `avg_volume_90d`,
`relative_volume_10d`, `high_52w`, `low_52w`, `beta_1y`,
`high_price`, `low_price`, `open_price`, `change_value`, `logoid`,
`is_egx30`, `is_egx70`, `is_egx100`, `is_egx`, `is_suspended`

### 3.2 جدول الأسعار اليومية: `stock_daily_prices`

```sql
CREATE TABLE stock_daily_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    price_date TEXT NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    turnover REAL,
    change_percent REAL,
    market TEXT,                        -- يُضاف بواسطة scanner
    fetch_time TEXT,
    open REAL, high REAL, low REAL, close REAL,  -- أسماء بديلة
    UNIQUE(ticker, price_date),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
);
```

> **ملاحظة مهمة:** الجدول فيه أعمدة مكررة (`open`/`open_price`, `high`/`high_price`, etc.) لأن مصادر مختلفة بتكتب بأسماء مختلفة. الـ scanner الحالي بـ يكتب في `open_price/high_price/low_price/close_price` + `open/high/low/close`.

### 3.3 جدول المؤشرات الفنية: `stock_indicators` (جديد)

```sql
CREATE TABLE stock_indicators (
    ticker TEXT NOT NULL,
    market TEXT,
    date TEXT NOT NULL,                 -- YYYY-MM-DD
    rsi REAL, macd REAL, macd_signal REAL,
    sma20 REAL, sma50 REAL, sma200 REAL, atr REAL,
    recommend_all REAL, recommend_ma REAL, recommend_other REAL,
    volatility_daily REAL, volatility_weekly REAL,
    avg_volume_30d REAL, avg_volume_10d REAL, avg_volume_90d REAL,
    relative_volume_10d REAL,
    high_52w REAL, low_52w REAL, beta_1y REAL,
    fetch_time TEXT,
    source TEXT DEFAULT 'tradingview',
    PRIMARY KEY (ticker, date)
);
```

**المصدر:** `data_engine/scrapers/tradingview_scanner_live.py` → `persist_indicators()`
**القارئ:** `data_engine/scrapers/indicators_reader.py` (helper للـ engines)

### 3.4 جدول المؤشرات السوقية: `market_indices`

```sql
CREATE TABLE market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT UNIQUE,                 -- EGX30, EGX70, TASI, ^GSPC, etc.
    name TEXT,
    name_ar TEXT,
    current_value REAL,
    value REAL,                         -- = current_value (API reads `value`)
    previous_close REAL,
    change REAL,
    change_percent REAL,
    high REAL, low REAL, volume REAL,
    is_shariah INTEGER,
    last_update TEXT,
    source TEXT                         -- tradingview_official | sync_live | tradingview_rest
);
```

**المصادر:**
1. `scripts/fetch_tv_indices.py` → قيم رسمية من صفحات TV (الأولوية)
2. `scripts/sync_market_indices_live.py` → حساب محلي من أسعار الأسهم

### 3.5 جدول الأسعار اليومية للمؤشرات: `index_daily_prices`

```sql
CREATE TABLE index_daily_prices (
    symbol TEXT,
    price_date TEXT,
    open REAL, high REAL, low REAL, close REAL,
    volume REAL, change_percent REAL
);
```

### 3.6 جدول DNA السهم: `stock_adaptive_profiles`

```sql
CREATE TABLE stock_adaptive_profiles (
    ticker TEXT PRIMARY KEY,
    sector TEXT,
    volatility_percentile_90d REAL,
    avg_atr_pct REAL,
    avg_volume_20d REAL,
    volume_spike_threshold REAL,
    typical_move_1d REAL, typical_move_5d REAL, typical_move_15d REAL,
    reaction_to_market_crashes TEXT
    -- + أعمدة إضافية
);
```

**المصدر:** `scripts/build_stock_profiles.py` (بيقرأ price_history.db)

### 3.7 جداول أخرى في stocks.db

| الجدول | الدور |
|--------|------|
| `investors_data` | بيانات المستثمرين (EGX) |
| `macro_indicators` | CPI + تضخم (World Bank) |
| `daily_analytics_summary` | ملخص تحليلي يومي |
| `gold_prices` | أسعار المعادن + الفوركس |

---

## 4. مخطط predictions.db الكامل

### 4.1 الجدول الرئيسي: `predictions`

```sql
CREATE TABLE predictions (
    id TEXT PRIMARY KEY,                -- random 16-byte hex
    ticker TEXT NOT NULL,
    stock_ticker TEXT,
    market TEXT DEFAULT 'EGX',
    signal TEXT,                        -- BUY | STRONG_BUY | HOLD | SELL | WAIT
    direction TEXT,
    score REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    entry_price REAL, target_price REAL, stop_loss REAL,
    risk_reward REAL, horizon TEXT,
    persona TEXT DEFAULT 'balanced',
    status TEXT DEFAULT 'active',       -- active | TARGET_HIT | STOPPED | EXPIRED | CLOSED
    prediction_date TEXT,
    outcome_date TEXT,
    hit_target INTEGER DEFAULT 0,
    hit_stop INTEGER DEFAULT 0,
    pnl_percent REAL,
    closed_at DATETIME,
    analysis_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**الأعمدة الإضافية** (تُضاف ديناميكيًا):
`exit_type`, `actual_return`, `actual_exit_price`, `highest_price_reached`,
`lowest_price_reached`, `holding_days`, `is_trend_following`,
`target_price_2`, `exit_policy`, `partial_exit_price`, `partial_exit_date`,
`data_quality`, `exit_reason`, `regime`, `score`,
`last_checked_date`, `exit_checkpoint_json`, `checkpoint_version`

### 4.2 جدول التحليلات المخزنة: `stored_analyses`

```sql
CREATE TABLE stored_analyses (
    id TEXT PRIMARY KEY,                -- v40_{ticker}_{market}
    ticker TEXT, market TEXT,
    maestro_score REAL, recommendation TEXT,
    entry_price REAL, target_price REAL, stop_loss REAL,
    risk_reward REAL, regime TEXT,
    analysis_json TEXT,
    ai_reason TEXT, ai_narrative TEXT,
    created_at TEXT
);
```

**الكاتب الوحيد:** `vps-service/jobs/daily_predictor.py` (Rule 73: SINGLE-WRITER)

### 4.3 جدول إشعارات الخروج: `exit_notifications`

```sql
CREATE TABLE exit_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    notification_type TEXT NOT NULL,    -- EXIT_STOP | EXIT_PROFIT_LOCK | T1_HIT_T2_RAISE | etc.
    message TEXT,
    current_price REAL, gain_pct REAL,
    momentum_5d REAL, momentum_20d REAL, sma20 REAL, rsi REAL,
    old_target REAL, new_target REAL,
    day_number INTEGER,
    created_at TEXT
);
```

### 4.4 جدول سجل المعالجة التزايدي: `prediction_scan_log`

```sql
CREATE TABLE prediction_scan_log (
    ticker TEXT NOT NULL,
    market TEXT NOT NULL,
    scan_date TEXT NOT NULL,
    engine_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,          -- SHA1 of OHLCV
    had_signal INTEGER DEFAULT 0,
    signal TEXT, entry_price REAL, target_price REAL,
    stop_loss REAL, score REAL,
    status TEXT DEFAULT 'completed',
    processed_at TEXT,
    PRIMARY KEY (ticker, market, scan_date, engine_hash)
);
```

**المصدر:** `vps-service/jobs/predictor_modules/incremental.py`
**الغرض:** منع إعادة حساب (ticker × scan_date) لو البيانات + الإعدادات مطابقة

### 4.5 جداول أخرى في predictions.db

| الجدول | الدور |
|--------|------|
| `prediction_outcomes` | نتائج التوقعات (FK → predictions) |
| `persona_predictions` | توقعات الـ persona (gambler/balanced/conservative) |
| `learned_lessons` | دروس من الفشل (feedback loop) |
| `historical_trades` | صفقات تاريخية |
| `trade_journal_entries` | يوميات التداول |
| `morning_bell_signals` | إشارات صباحية |
| `liquidity_signal_outcomes` | نتائج إشارات السيولة |
| `optimizer_params_history` | تاريخ تحسين المعاملات |
| `sniper_performance` | أداء الـ sniper engine |

---

## 5. مخطط data_engine.db الكامل

| الجدول | الأعمدة الرئيسية | المصدر |
|--------|-------------------|---------|
| `egksco_price_history` | symbol, price_date, open_price, high_price, low_price, close_price, volume | EGKSCO scraper (EGX رسمي) |
| `egksco_stocks` | symbol, name, sector, market_cap | EGKSCO |
| `historical_data` | symbol, date, open, high, low, close, volume, market | Yahoo + مصادر |
| `crypto_prices` | symbol, date, open, high, low, close, volume | CoinGecko |
| `gold_prices` | symbol, date, price | Metals/Forex fetcher |
| `tab_*` | جداول أساسيات EGX | EGKSCO |

**ملاحظة:** `data_engine.db` هو مصدر خام — بياناته بتنسخ لـ `stocks.db` عبر `scripts/sync_missing_prices.py`

---

## 6. مخطط intraday.db

| الجدول | الأعمدة | الدور |
|--------|---------|------|
| `stock_intraday` | ticker, timestamp, price, volume | بيانات لحظية EGX/TADAWUL/KSE/QSE |
| `crypto_intraday` | symbol, timestamp, price, volume | بيانات لحظية كريبتو (24/7) |
| `commodity_intraday` | symbol, timestamp, price | ذهب/فضة/نفط/فوركس (24/5) |

**الاحتفاظ:** 7 أيام (retention)

---

## 7. مصادر البيانات الخارجية

| المصدر | البيانات | التخزين | الأداة | الحالة |
|--------|---------|---------|--------|--------|
| **TradingView Scanner** | أسعار + مؤشرات فنية + أساسيات | stocks.db (stocks + stock_indicators) | `data_engine/scrapers/tradingview_scanner_live.py` | ✅ نشط |
| **TradingView Symbol Pages** | قيم المؤشرات الرسمية | stocks.db (market_indices) | `scripts/fetch_tv_indices.py` | ✅ نشط |
| **EGKSCO** | أسعار + أساسيات EGX | data_engine.db (egksco_*) | `data_engine/scrapers/egksco_scraper.py` | ✅ نشط |
| **Yahoo Finance** | أسعار تاريخية (كل الأسواق) | data_engine.db (historical_data) | `data_engine/scrapers/historical_fetcher_5years.py` | ✅ نشط |
| **CoinGecko** | BTC/ETH OHLCV | data_engine.db (crypto_prices) | `data_engine/scrapers/crypto_fetcher.py` | ✅ نشط |
| **Metals/Forex** | XAU, XAG, Oil, EUR/USD | data_engine.db (gold_prices) | `data_engine/scrapers/metals_forex_fetcher.py` | ✅ نشط |
| **World Bank** | Egypt CPI | stocks.db (macro_indicators) | `vps-service/scripts/fetch_inflation_worldbank.py` | ✅ يدوي |
| **RSS (EGX)** | أخبار | news.db (market_news) | news fetcher | ✅ نشط |
| **Ollama LLM** | تحليل أخبار + sentiment | في الذاكرة | `vps-service/analyzers/ai_sentiment.py` | ✅ نشط |

### الأسواق المدعومة

| السوق | رمز الـ scanner | رمز الـ DB | المؤشرات |
|-------|-----------------|-----------|----------|
| مصر | `egypt` | `EGX` | EGX30, EGX70EWI, EGX100EWI, TAMAYUZ |
| السعودية | `ksa` | `TADAWUL` | TASI |
| الكويت | `kuwait` | `KSE` | KSE_COMPOSITE |
| قطر | `qatar` | `QSE` | QEAS |
| أمريكا | `america` | `US` | ^GSPC, ^IXIC, ^DJI |
| كريبتو | `crypto` | `CRYPTO` | BTC, ETH (من CoinGecko) |

---

## 8. قواعد الملكية (Writers vs Readers)

| DB | الكاتب الوحيد (Writer) | القرّاء (Readers) |
|----|----------------------|-------------------|
| `stocks.db` | `data_engine` scrapers + `sync_missing_prices.py` + `fetch_tv_indices.py` | كل الـ API routes + الـ engines |
| `predictions.db` → `predictions` | `daily_predictor.py` (V40.2) | `daily_closer.py` + UI APIs |
| `predictions.db` → `stored_analyses` | `daily_predictor.py` فقط (Rule 73) | UI APIs |
| `predictions.db` → `prediction_scan_log` | `predictor_modules/incremental.py` | `daily_predictor.py` |
| `predictions.db` → `exit_notifications` | `daily_closer.py` | UI APIs |
| `intraday.db` | `intraday_aggregator.py` + scrapers | UI + engines |
| `auth.db` | NextAuth | API routes |

### قاعدة ذهبية
> **كل DB لها كاتب واحد (writer) وقرّاء متعددون (readers).** لو محرك بيقرأ من DB ويكتب فيها → ده bug.

---

## 9. تدفق البيانات (Data Flow)

```
┌─────────────────────────────────────────────────────────────────┐
│                    المصادر الخارجية                              │
│  TradingView │ EGKSCO │ Yahoo │ CoinGecko │ Metals/Forex        │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              data_engine.db (Tier 1 — Raw)                       │
│  egksco_price_history │ historical_data │ crypto_prices │ ...    │
└──────────┬──────────────────────────────────────────────────────┘
           │ sync_missing_prices.py (UPSERT)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              stocks.db (Tier 2 — SSOT)                           │
│  stocks │ stock_daily_prices │ stock_indicators │ market_indices │
│  stock_adaptive_profiles │ index_daily_prices │ ...              │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              daily_predictor.py (V40.2 Engine)                   │
│  يقرأ stocks.db → يحلل → يكتب predictions.db                    │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              predictions.db (Tier 3 — Brain Output)              │
│  predictions │ stored_analyses │ prediction_scan_log │ ...       │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              daily_closer.py (Exit Engine)                       │
│  يقرأ predictions (pending) → يقفل → يكتب outcome               │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Next.js API + UI (Tier 4 — Readers)                 │
│  يقرأ stocks.db + predictions.db → يعرض للمستخدم                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. النسخ الاحتياطية

| النوع | الموقع | الحجم | ملاحظة |
|------|-------|-------|--------|
| DB snapshot | `db_release_20261025/` | ~1.5 GB (مضغوط) | split archives (.aa, .ab, ...) |
| Weekly backup | `data/db_backup_*` | متغير | نسخ أسبوعية |
| Code backup | `db/code_backup_*` | ~50 MB | نسخة من الكود |
| Production DB | `upload/predictions.db.zip` | ~277 MB | backup tag |

### استرجاع DB من archive

```bash
# stocks.db (part واحد)
tar xzf db_release_20261025/stocks.db.tar.gz.aa -C /tmp/
cp /tmp/root/GLMinvestment/db/stocks.db db/

# predictions.db (جزئين)
cat db_release_20261025/predictions.db.tar.gz.aa db_release_20261025/predictions.db.tar.gz.ab > /tmp/pred.tar.gz
tar xzf /tmp/pred.tar.gz -C /tmp/
cp /tmp/root/GLMinvestment/db/predictions.db db/

# data_engine.db (5 أجزاء)
cat db_release_20261025/data_engine.db.tar.gz.{aa,ab,ac,ad,ae} > /tmp/de.tar.gz
tar xzf /tmp/de.tar.gz -C /tmp/
cp /tmp/root/GLMinvestment/db/data_engine.db db/
```

---

## 11. المشاكل المعروفة + الإصلاحات

### 11.1 ✅ تم إصلاحه: `value` vs `current_value` في market_indices

**المشكلة:** `sync_market_indices_live.py` بيكتب في `current_value` بس، الـ API بـ يقرا `value` → المؤشرات بترجع null.

**الإصلاح:** `upsert_index()` بـ يكتب في العمودين (commit `1de0189`).

### 11.2 ✅ تم إصلاحه: `symbol` column في persist_to_daily_prices

**المشكلة:** `tradingview_scanner_live.py` كان بـ INSERT بعمود `symbol` مش موجود في الـ schema الفعلي.

**الإصلاح:** شيلنا `symbol` من INSERT (commit `fd31ddb`).

### 11.3 ✅ تم إصلاحه: المؤشرات محسوبة محلي بدل سحبها من TV

**المشكلة:** EGX30 محسوب = 52,251 vs الرسمي من TV = 49,281 (فرق 878 نقطة).

**الإصلاح:** `scripts/fetch_tv_indices.py` بـ يسحب القيم الرسمية من صفحات TV (commit `fd31ddb`).

### 11.4 ✅ تم إصلاحه: الشاشة الرئيسية عالقة على EGX

**المشكلة:** `DashboardView.tsx` useEffect ناقص `currentMarket` في deps → الداتا ما بتتحدث لما السوق يتغير.

**الإصلاح:** أضفنا `currentMarket` لـ deps (commit `0291a18`).

### 11.5 ⚠️ معروفة: أسعار flat في EGX

**المشكلة:** ~83 سهم EGX عندهم أسعار flat (نفس السعر مكرر) في `stock_daily_prices`.

**السبب:** مصدر egksco نفسه فيه أسعار flat في الفترة الأخيرة. مش مشكلة في الـ sync.

**الحل المقترح:** سحب أسعار EGX من TradingView scanner مباشرة (بدل egksco).

### 11.6 ⚠️ معروفة: 82 ملف بـ يستخدموا `sqlite3.connect` مباشرة

**المشكلة:** 82 ملف في `vps-service/` بـ يفتحوا `sqlite3.connect` بدل ما يمروا على `db_manager` (DAL).

**التأثير:** بـ bypass WAL mode + busy_timeout + connection pooling.

**الحل:** ألفا بدأت في الـ DAL migration (Phase 8.2 — commit `1cf19c4`).

---

## المراجع

- **الـ DAL:** `vps-service/core/db_manager.py` + `vps-service/core/db_helpers.py`
- **الـ migrator:** `vps-service/core/migrator.py`
- **الـ scanner:** `data_engine/scrapers/tradingview_scanner_live.py`
- **الـ indices fetcher:** `scripts/fetch_tv_indices.py`
- **الـ indices sync:** `scripts/sync_market_indices_live.py`
- **الـ price sync:** `scripts/sync_missing_prices.py`
- **الـ data quality:** `scripts/check_data_quality.py`
