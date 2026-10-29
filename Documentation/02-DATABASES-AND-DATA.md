# 02 — قواعد البيانات ومصادر الحقيقة

> **آخر تحديث:** 2026-10-29 | **BRAVO-DATA-LAYER (`data_engine/data_layer.py`)**
> **هذا الملف هو المرجع الموحّد لكل قواعد البيانات ومصادرها وجداولها.**
> **الـ architecture الجديد: كل البيانات بـ تمر عبر `data_engine/data_layer.py` — مفيش أي ملف بـ يقرا/يكتب في DB مباشرة.**

---

## الفهرس

1. [استراتيجية الطبقات](#1-استراتيجية-الطبقات)
2. [قواعد البيانات الرئيسية](#2-قواعد-البيانات-الرئيسية)
3. [طبقة البيانات الموحدة (data_layer.py) — BRAVO-DATA-LAYER](#3-طبقة-البيانات-الموحدة-data_layerpy--bravo-data-layer)
4. [مخطط data_engine.db الكامل](#4-مخطط-data_enginedb-الكامل)
5. [مخطط stocks.db (Legacy — fallback)](#5-مخطط-stocksdb-legacy--fallback)
6. [مخطط predictions.db الكامل](#6-مخطط-predictionsdb-الكامل)
7. [مخطط intraday.db](#7-مخطط-intradaydb)
8. [مصادر البيانات الخارجية](#8-مصادر-البيانات-الخارجية)
9. [قواعد الملكية (Writers vs Readers)](#9-قواعد-الملكية-writers-vs-readers)
10. [تدفق البيانات (Data Flow)](#10-تدفق-البيانات-data-flow)
11. [تطبيع الـ Market Slug](#11-تطبيع-ال-market-slug)
12. [النسخ الاحتياطية](#12-النسخ-الاحتياطية)
13. [المشاكل المعروفة + الإصلاحات](#13-المشاكل-المعروفة--الإصلاحات)

---

## 1. استراتيجية الطبقات

| Tier | DB | الدور | الوصف |
|------|-----|------|-------|
| **Canonical Source** | `data_engine.db` | **المصدر الوحيد للبيانات** | كل scrapers بـ تكتب هنا عبر `data_layer` |
| **Brain Output** | `predictions.db` | كل مخرجات المحركات | توقعات + نتائج + تعلّم |
| **Legacy (Fallback)** | `stocks.db`, `price_history.db` | بيانات قديمة + fallback | الـ data_layer بيـ fallback ليهم لو الـ canonical مش متاح |
| **User State** | `auth.db`, `news.db` | مستخدمون + أخبار | بيانات تشغيلية |
| **Intraday** | `intraday.db` | بيانات لحظية | retention 7 أيام |

> **BRAVO-DATA-LAYER (2026-10-29):** قبل كده كان `stocks.db` هو الـ SSOT الأساسي.
> دلوقتي `data_engine.db` هو المصدر الوحيد، وكل الـ engines بـ تقرا عبر `data_engine/data_layer.py`.
> `stocks.db` لسه موجود كـ fallback للـ APIs اللي لسه مش مهاجرة.

---

## 2. قواعد البيانات الرئيسية

| DB | الحجم (تقريبي) | الجداول | الدور |
|----|----------------|---------|------|
| **`data_engine.db`** | **531 MB** | **29 جدول + 2 جداد (tv_snapshot, tv_indicators)** | **المصدر الوحيد — كل scrapers بـ تكتب هنا** |
| `predictions.db` | 277-300 MB | ~33 جدول | التوقعات + النتائج + التعلم |
| `stocks.db` | 25-26 MB | ~53 جدول | Legacy SSOT — fallback للـ APIs |
| `intraday.db` | 125 MB | 3 جداول | بيانات لحظية (intraday) |
| `auth.db` | صغير | NextAuth tables | مستخدمون + sessions |
| `news.db` | متغير | market_news | أخبار + sentiment |

---

## 3. طبقة البيانات الموحدة (data_layer.py) — BRAVO-DATA-LAYER

> **Owner directive (2026-10-29):**
> "البيانات الى بتيجى من محرك البيانات تروح على data_engine.db مش stocks.db"
> "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة داخل البايثون"
> "لازم كل البيانات تكون حاضرة وجاهزة لاى ملف يطلبها"
> "انت لما تسحب انت الى عارف بتسحب من انهى سوق فلازم انت الى تحط اسم السوق"

### 3.1 الملف

| الخاصية | القيمة |
|---|---|
| **المسار** | `data_engine/data_layer.py` (~450 سطر) |
| **الـ DB** | `db/data_engine.db` (531 MB) |
| **Connection** | Thread-local + WAL mode + busy_timeout 30s |
| **Singleton** | `data = DataLayer()` — استيراد واحد لكل ملف |

### 3.2 الـ API الكامل

#### READ — قراءات الـ engines

| الدالة | المخرجات | الوصف |
|--------|----------|--------|
| `get_snapshot(ticker)` | `dict` أو `None` | snapshot كامل (price, volume, OHLC, RSI, SMA, ATR, market_cap, ...) — يقرا من `tv_snapshot` مع fallback لـ `stocks` |
| `get_market_stocks(market)` | `list[str]` | قائمة tickers لسوق معين |
| `get_market_snapshots(market)` | `list[dict]` | كل snapshots لسوق معين (batch read) |
| `get_history(ticker, days, market)` | `list[dict]` | تاريخ OHLCV يومي (oldest→newest) — بـ يدمج 3 مصادر |
| `get_history_lists(ticker, days, market)` | `(closes, volumes, highs, lows, opens)` | نفس `get_history` بس بـ lists منفصلة |
| `get_indicators(ticker, date)` | `dict` أو `None` | TV indicators (RSI, MACD, SMA, ATR, ...) |
| `get_market_cap(ticker)` | `float` أو `None` | القيمة السوقية الحالية |
| `stats()` | `dict` | إحصائيات سريعة (counts + freshness + markets) |

#### WRITE — كتابات الـ scrapers

| الدالة | المدخلات | الوصف |
|--------|----------|--------|
| `upsert_snapshot(rows)` | `list[dict]` من TV scanner | upsert في `tv_snapshot` (UNIQUE on ticker) — backfills `symbol` لو NULL |
| `upsert_indicators(rows)` | `list[dict]` من TV scanner | upsert في `tv_indicators` (PK: ticker+date) |
| `append_daily_prices(rows)` | `list[dict]` من TV scanner | append اليوم في `historical_data` (يخلّي التاريخ طازج) |

#### Helpers

| الدالة | المخرجات | الوصف |
|--------|----------|--------|
| `normalize_market(alias)` | `str` أو `None` | يحوّل أي slug للـ canonical (`egypt`→`EGX`, `مصر`→`EGX`, `ksa`→`TADAWUL`, ...) |

### 3.3 مصادر `get_history` (3 مصادر مدمجة)

```python
def get_history(ticker, days, market):
    # 1. historical_data (canonical daily OHLCV — 197K rows, 2021-2026)
    #    - كل الأسواق (EGX, TADAWUL, KSE, QSE, US, GOLD, FOREX)
    #    - مصادر: Yahoo + TV scanner + EGKSCO
    
    # 2. egksco_price_history (EGX only — 60K rows)
    #    - daily OHLCV + buy/sell pressure + delta_volume
    #    - بـ يـ supplement الـ historical_data للـ EGX
    
    # 3. tv_snapshot (today's fresh close)
    #    - لو اليوم مش موجود في historical_data → ضيف snapshot اللحظي
    #    - بيضمن إن التاريخ بـ ينتهي بالسعر الطازج
    
    # النتيجة: list of dicts (oldest → newest)
    # كل dict فيه: date, open, high, low, close, volume, source, (buy_volume, sell_volume, pressure لو EGX)
```

### 3.4 الاستيراد

```python
# في أي engine:
import sys
sys.path.insert(0, '/home/z/my-project')  # أو PROJECT_ROOT
from data_engine.data_layer import data

# قراءة
snap = data.get_snapshot('COMI')                    # → dict
hist = data.get_history('COMI', days=60)            # → list[dict]
closes, vols, highs, lows, opens = data.get_history_lists('COMI', days=60)
ind = data.get_indicators('COMI')                   # → dict (RSI, SMA, MACD, ATR)
tickers = data.get_market_stocks('EGX')             # → list[str]
snaps = data.get_market_snapshots('EGX')            # → list[dict]

# كتابة (للـ scrapers فقط)
data.upsert_snapshot(rows)
data.upsert_indicators(rows)
data.append_daily_prices(rows)

# تطبيع slug
canonical = data.normalize_market('egypt')  # → 'EGX'
```

---

## 4. مخطط data_engine.db الكامل

### 4.1 `tv_snapshot` (جديد — BRAVO-DATA-LAYER 2026-10-29)

```sql
CREATE TABLE tv_snapshot (
    -- identity
    symbol TEXT, ticker TEXT,
    name_ar TEXT, market TEXT,             -- EGX | TADAWUL | KSE | QSE | US | crypto
    sector TEXT, industry TEXT,
    currency TEXT, exchange TEXT, logoid TEXT, logo_url TEXT,
    -- session
    current_price REAL, change_percent REAL, change_value REAL,
    volume REAL, value_traded REAL, turnover_egp REAL,
    relative_volume_10d REAL,
    high_price REAL, low_price REAL, open_price REAL,
    -- valuation
    market_cap REAL, enterprise_value REAL,
    pe_ratio REAL, ps_ratio REAL, pb_ratio REAL,
    ev_to_revenue REAL, ev_to_ebitda REAL,
    -- earnings
    eps REAL, eps_diluted REAL,
    dividend_yield REAL, dps_ttm REAL, payout_ratio REAL,
    -- profitability
    gross_margin REAL, operating_margin REAL, profit_margin REAL,
    roa REAL, roe REAL, roic REAL,
    -- balance sheet
    total_assets REAL, total_current_assets REAL, cash_and_equivalents REAL,
    total_liabilities REAL, total_debt REAL, total_equity REAL, shares_outstanding REAL,
    -- income
    total_revenue REAL, gross_profit REAL, operating_income REAL, net_income REAL,
    -- cash flow
    cash_flow_operating REAL, cash_flow_investing REAL,
    cash_flow_financing REAL, free_cash_flow REAL,
    -- technicals (current snapshot)
    recommend_all REAL, recommend_ma REAL, recommend_other REAL,
    rsi REAL, macd REAL, macd_signal REAL,
    atr REAL, sma20 REAL, sma50 REAL, sma200 REAL,
    -- radar/pulse extras
    avg_volume_30d REAL, avg_volume_10d REAL, avg_volume_90d REAL,
    volatility_daily REAL, volatility_weekly REAL,
    high_52w REAL, low_52w REAL, beta_1y REAL,
    -- meta
    last_updated TEXT, is_active INTEGER DEFAULT 1,
    id INTEGER PRIMARY KEY AUTOINCREMENT
);
CREATE UNIQUE INDEX idx_tv_snap_ticker ON tv_snapshot(ticker);
CREATE INDEX idx_tv_snap_market ON tv_snapshot(market);
```

**الكاتب:** `data_layer.upsert_snapshot()` (بـ يستدعيها `tradingview_scanner_live.py`)
**القارئ:** كل الـ engines عبر `data_layer.get_snapshot()` / `get_market_snapshots()`

### 4.2 `tv_indicators` (جديد — BRAVO-DATA-LAYER 2026-10-29)

```sql
CREATE TABLE tv_indicators (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    market TEXT,
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
CREATE INDEX idx_tv_ind_date ON tv_indicators(date);
CREATE INDEX idx_tv_ind_ticker ON tv_indicators(ticker);
```

**الكاتب:** `data_layer.upsert_indicators()`
**القارئ:** `data_layer.get_indicators()`

### 4.3 `historical_data` (موجود — بـ يتغذى من data_layer)

```sql
CREATE TABLE historical_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT, name TEXT, market TEXT,
    date TEXT,                             -- YYYY-MM-DD
    open REAL, high REAL, low REAL, close REAL,
    volume INTEGER,
    last_fetch TEXT,
    close_price REAL,                      -- legacy column
    ticker TEXT,
    change_percent REAL
);
```

**الكاتب:** `data_layer.append_daily_prices()` (يضيف اليوم من الـ scanner)
**القارئ:** `data_layer.get_history()` (مصدر 1 من 3)
**التغطية:** 197K+ rows, 2021-2026, كل الأسواق

### 4.4 `egksco_price_history` (موجود — EGX رسمي)

```sql
CREATE TABLE egksco_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT, price_date TEXT,
    open_price REAL, high_price REAL, low_price REAL, close_price REAL,
    volume INTEGER, turnover REAL,
    market TEXT, source TEXT,              -- yahoo
    buy_volume INTEGER, sell_volume INTEGER,
    delta_volume INTEGER, delta_pct REAL, pressure TEXT
);
```

**الكاتب:** `data_engine/scrapers/egksco_scraper.py`
**القارئ:** `data_layer.get_history()` (مصدر 2 من 3 — EGX only)
**التغطية:** 60K+ rows, EGX daily + buy/sell pressure

### 4.5 جداول `tab_*` (fundamentals — EGX)

| الجدول | الأعمدة الرئيسية | المصدر |
|--------|-------------------|---------|
| `tab_balance_sheet` | total_assets, total_liabilities, total_equity | EGKSCO |
| `tab_income_statement` | total_revenue, gross_profit, operating_income, net_income | EGKSCO |
| `tab_cash_flow` | operating, investing, financing | EGKSCO |
| `tab_valuation` | pe_ratio, pb_ratio, ps_ratio, ev, ev_ebitda | EGKSCO |
| `tab_profitability` | gross_margin, operating_margin, net_margin, roe, roa | EGKSCO |
| `tab_performance` | 1w, 1m, 3m, 6m, 1y returns | EGKSCO |
| `tab_technical_analysis` | rsi, macd, stoch, adx, atr, technical_rating | EGKSCO |
| `tab_dividends` | dps, ex_date, pay_date | EGKSCO |

> **ملاحظة:** جداول `tab_*` فيها مشاكل في الـ schema (market field بيحتوي على rating بدل slug). حالياً V3 بـ يقرا fundamentals من `tv_snapshot` (أدق).

### 4.6 جداول أخرى في data_engine.db

| الجدول | الدور |
|--------|------|
| `stocks` | snapshot قديم (legacy fallback في `get_snapshot`) |
| `crypto_prices` | BTC/ETH OHLCV (CoinGecko) |
| `gold_prices` / `gold_prices_clean` | XAU/USD |
| `silver_prices` | XAG/USD |
| `exchange_rates` | forex |
| `btc_local_prices` | BTC بأسعار محلية |
| `screener_lists` | قوائم الـ screener |
| `sharia_*` | بيانات الشريعة (6 جداول) |

---

## 5. مخطط stocks.db (Legacy — fallback)

> **مهم:** `stocks.db` لسه موجود كـ fallback للـ APIs اللي لسه مش مهاجرة لـ `data_layer`.
> الـ data_layer بـ يـ fallback لـ `stocks` table لو `tv_snapshot` فاضي.
> الـ scanner **مش بـ يكتب في stocks.db دلوقتي** — بـ يكتب في `data_engine.db` فقط.

### 5.1 الجدول الرئيسي: `stocks` (legacy)

```sql
CREATE TABLE stocks (
    ticker TEXT PRIMARY KEY,
    name TEXT, name_ar TEXT,
    market TEXT DEFAULT 'EGX',
    sector TEXT, industry TEXT,
    current_price REAL, previous_close REAL,
    change REAL, change_percent REAL,
    volume INTEGER, value_traded REAL, turnover_egp REAL,
    is_active INTEGER DEFAULT 1,
    last_updated TEXT, last_update TEXT,
    pe_ratio REAL, pb_ratio REAL, roe REAL,
    market_cap REAL, shares_outstanding REAL,
    dividend_yield REAL,
    currency TEXT DEFAULT 'EGP', exchange TEXT DEFAULT 'EGX',
    -- + أعمدة ديناميكية (rsi, macd, sma*, atr, ...)
    created_at TEXT, updated_at TEXT
);
```

### 5.2 `stock_daily_prices` (legacy)

```sql
CREATE TABLE stock_daily_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL, price_date TEXT NOT NULL,
    open_price REAL, high_price REAL, low_price REAL, close_price REAL,
    volume INTEGER, turnover REAL, change_percent REAL,
    market TEXT, fetch_time TEXT,
    open REAL, high REAL, low REAL, close REAL,  -- أسماء بديلة
    UNIQUE(ticker, price_date)
);
```

> **ملاحظة:** الجدول فيه أعمدة مكررة (`open`/`open_price`, `high`/`high_price`, ...) لأن مصادر مختلفة بتكتب بأسماء مختلفة.
> **BRAVO-DATA-LAYER:** الـ scanner مش بـ يكتب هنا دلوقتي. الجدول لسه موجود للـ legacy APIs.

### 5.3 `stock_indicators` (legacy)

```sql
CREATE TABLE stock_indicators (
    ticker TEXT, market TEXT, date TEXT,
    rsi REAL, macd REAL, macd_signal REAL,
    sma20 REAL, sma50 REAL, sma200 REAL, atr REAL,
    recommend_all REAL, recommend_ma REAL, recommend_other REAL,
    volatility_daily REAL, volatility_weekly REAL,
    avg_volume_30d REAL, avg_volume_10d REAL, avg_volume_90d REAL,
    relative_volume_10d REAL,
    high_52w REAL, low_52w REAL, beta_1y REAL,
    fetch_time TEXT, source TEXT DEFAULT 'tradingview',
    PRIMARY KEY (ticker, date)
);
```

> **BRAVO-DATA-LAYER:** السكرابر مش بـ يكتب هنا دلوقتي — بـ يكتب في `data_engine.db.tv_indicators` بدلاً من ذلك.

### 5.4 جداول أخرى في stocks.db (legacy)

| الجدول | الدور |
|--------|------|
| `market_indices` | مؤشرات السوق (EGX30, TASI, ...) |
| `index_daily_prices` | أسعار يومية للمؤشرات |
| `stock_adaptive_profiles` | DNA السهم (volatility, typical_move, ...) |
| `investors_data` | بيانات المستثمرين (EGX) |
| `macro_indicators` | CPI + تضخم |
| `gold_prices` | أسعار المعادن + الفوركس |
| `radar_signal_tracking` | تتبع إشارات الرادار |
| `real_evaluated_predictions` | توقعات مُقيَّمة |

---

## 6. مخطط predictions.db الكامل

### 6.1 الجدول الرئيسي: `predictions`

```sql
CREATE TABLE predictions (
    id TEXT PRIMARY KEY,                   -- random 16-byte hex
    ticker TEXT NOT NULL,
    stock_ticker TEXT,
    market TEXT DEFAULT 'EGX',
    signal TEXT,                           -- BUY | STRONG_BUY | HOLD | SELL | WAIT
    direction TEXT,
    score REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    entry_price REAL, target_price REAL, stop_loss REAL,
    risk_reward REAL, horizon TEXT,
    persona TEXT DEFAULT 'balanced',
    status TEXT DEFAULT 'active',
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

**الكاتب الوحيد:** `vps-service/jobs/new_daily_predictor.py` (V3 — Rule 73: SINGLE-WRITER)
**الـ persona:** `v3_smart` لكل توقعات V3

### 6.2 `stored_analyses`

```sql
CREATE TABLE stored_analyses (
    id TEXT PRIMARY KEY,
    ticker TEXT, market TEXT,
    maestro_score REAL, recommendation TEXT,
    entry_price REAL, target_price REAL, stop_loss REAL,
    risk_reward REAL, regime TEXT,
    analysis_json TEXT,
    ai_reason TEXT, ai_narrative TEXT,
    created_at TEXT
);
```

### 6.3 جداول أخرى في predictions.db

| الجدول | الدور |
|--------|------|
| `prediction_outcomes` | نتائج التوقعات (FK → predictions) |
| `persona_predictions` | توقعات الـ persona |
| `learned_lessons` | دروس من الفشل (feedback loop) |
| `exit_notifications` | إشعارات الخروج |
| `prediction_scan_log` | منع إعادة حساب (ticker × scan_date) |
| `historical_trades` | صفقات تاريخية |

---

## 7. مخطط intraday.db

| الجدول | الأعمدة | الدور |
|--------|---------|------|
| `stock_intraday` | ticker, timestamp, price, volume | بيانات لحظية EGX/TADAWUL/KSE/QSE |
| `crypto_intraday` | symbol, timestamp, price, volume | بيانات لحظية كريبتو (24/7) |
| `commodity_intraday` | symbol, timestamp, price | ذهب/فضة/نفط/فوركس (24/5) |

**الاحتفاظ:** 7 أيام (retention)

---

## 8. مصادر البيانات الخارجية

| المصدر | البيانات | التخزين | الأداة | الحالة |
|--------|---------|---------|--------|--------|
| **TradingView Scanner** | أسعار + مؤشرات فنية + أساسيات | **data_engine.db (tv_snapshot + tv_indicators + historical_data)** | `data_engine/scrapers/tradingview_scanner_live.py` → `data_layer` | ✅ نشط |
| **TradingView Symbol Pages** | قيم المؤشرات الرسمية | stocks.db (market_indices) | `scripts/fetch_tv_indices.py` | ✅ نشط (legacy) |
| **EGKSCO** | أسعار + أساسيات EGX | data_engine.db (egksco_*) | `data_engine/scrapers/egksco_scraper.py` | ✅ نشط |
| **Yahoo Finance** | أسعار تاريخية | data_engine.db (historical_data) | `data_engine/scrapers/historical_fetcher_5years.py` | ✅ نشط |
| **CoinGecko** | BTC/ETH OHLCV | data_engine.db (crypto_prices) | `data_engine/scrapers/crypto_fetcher.py` | ✅ نشط |
| **Metals/Forex** | XAU, XAG, Oil, EUR/USD | data_engine.db (gold_prices) | `data_engine/scrapers/metals_forex_fetcher.py` | ✅ نشط |
| **World Bank** | Egypt CPI | stocks.db (macro_indicators) | `vps-service/scripts/fetch_inflation_worldbank.py` | ✅ يدوي |
| **RSS (EGX)** | أخبار | news.db (market_news) | news fetcher | ✅ نشط |
| **Ollama LLM** | تحليل أخبار + sentiment | في الذاكرة | `vps-service/analyzers/ai_sentiment.py` | ✅ نشط |

### الأسواق المدعومة + الـ Slug Mapping

| السوق | API slug (TV) | DB slug (canonical) | المؤشرات |
|-------|---------------|---------------------|----------|
| مصر | `egypt` | `EGX` | EGX30, EGX70EWI, EGX100EWI |
| السعودية | `ksa` | `TADAWUL` | TASI |
| الكويت | `kuwait` | `KSE` | KSE_COMPOSITE |
| قطر | `qatar` | `QSE` | QEAS |
| أمريكا | `america` | `US` | ^GSPC, ^IXIC, ^DJI |
| كريبتو | `crypto` | `crypto` | BTC, ETH |

> **BRAVO-SCANNER-DBSLUG-FIX (2026-10-29):** السكرابر بـ يحط الـ DB slug صراحةً (`EGX`/`TADAWUL`/...) — مش بـ يعتمد على الـ API slug.
> Owner: "انت الى تحط اسم السوق مش البيانات هاتيجى بأسم السوق بتاعها"

---

## 9. قواعد الملكية (Writers vs Readers)

| DB / Table | الكاتب الوحيد (Writer) | القرّاء (Readers) |
|----|----------------------|-------------------|
| `data_engine.db` → `tv_snapshot` | `data_layer.upsert_snapshot()` (بـ يستدعيها الـ scanner) | كل الـ engines عبر `data_layer.get_snapshot()` |
| `data_engine.db` → `tv_indicators` | `data_layer.upsert_indicators()` | كل الـ engines عبر `data_layer.get_indicators()` |
| `data_engine.db` → `historical_data` | `data_layer.append_daily_prices()` + `historical_fetcher` | `data_layer.get_history()` |
| `data_engine.db` → `egksco_price_history` | `egksco_scraper.py` | `data_layer.get_history()` |
| `predictions.db` → `predictions` | `new_daily_predictor.py` (V3) | `daily_closer.py` + UI APIs |
| `predictions.db` → `stored_analyses` | `daily_predictor.py` فقط (Rule 73) | UI APIs |
| `predictions.db` → `exit_notifications` | `daily_closer.py` | UI APIs |
| `intraday.db` | `intraday_aggregator.py` + scrapers | UI + engines |
| `stocks.db` (legacy) | ❌ مفيش كتاب جداد — الـ scanner وقف الكتابة هنا | الـ APIs اللي لسه مش مهاجرة لـ data_layer |
| `auth.db` | NextAuth | API routes |

### القاعدة الذهبية
> **كل DB لها كاتب واحد (writer) وقرّاء متعددون (readers).** لو محرك بيقرأ من DB ويكتب فيها → ده bug.
> **BRAVO-DATA-LAYER:** كل الـ engines بـ تقرا عبر `data_engine/data_layer.py` — مفيش أي ملف بـ يفتح `sqlite3.connect` مباشرة لقراءة بيانات السوق.

---

## 10. تدفق البيانات (Data Flow)

```
┌─────────────────────────────────────────────────────────────────────┐
│              المصادر الخارجية                                        │
│  TradingView │ EGKSCO │ Yahoo │ CoinGecko │ Metals/Forex            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  data_engine/scrapers/tradingview_scanner_live.py                   │
│  (بـ يحط market slug صراحة: EGX/TADAWUL/KSE/QSE/US/crypto)         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ upsert_snapshot() + upsert_indicators()
                             │ + append_daily_prices()
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│            data_engine/data_layer.py (طبقة البيانات الموحدة)        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  data_engine.db (المصدر الوحيد — 531 MB)                   │    │
│  │  • tv_snapshot (snapshot)                                   │    │
│  │  • tv_indicators (RSI/SMA/MACD/ATR time-series)             │    │
│  │  • historical_data (daily OHLCV 2021-2026)                  │    │
│  │  • egksco_price_history (EGX + buy/sell pressure)           │    │
│  │  • tab_* (fundamentals)                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  API:                                                               │
│    get_snapshot(ticker) → price + RSI + SMA + ATR + market_cap      │
│    get_history(ticker, days) → merged OHLCV (oldest→newest)         │
│    get_indicators(ticker) → RSI/MACD/SMA/ATR                        │
│    get_market_stocks(market) → [tickers]                            │
│    get_market_snapshots(market) → [snapshots]                       │
│    normalize_market(alias) → canonical slug                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ قراءة موحدة (engines مش بـ تفتح DB مباشرة)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              V3 Predictor (new_daily_predictor.py)                  │
│  → orchestrator_v3 + executor_v3 → 7 عائلات تحليل                   │
│  → save_prediction() → predictions.db                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              predictions.db (Brain Output)                          │
│  predictions │ stored_analyses │ prediction_scan_log │ ...          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              daily_closer.py (Exit Engine)                          │
│  يقرأ predictions (pending) → يقفل → يكتب outcome                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Next.js API + UI (Readers)                             │
│  يقرأ data_engine.db (عبر data_layer) + predictions.db → يعرض      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. تطبيع الـ Market Slug

> **BRAVO-SCANNER-DBSLUG-FIX (2026-10-29):** الـ data layer بـ يطبّع أي slug للـ canonical.

### 11.1 الـ Canonical Slugs (6)

```
EGX       — مصر
TADAWUL   — السعودية
KSE       — الكويت
QSE       — قطر
US        — أمريكا
crypto    — كريبتو
```

### 11.2 الـ Aliases المدعومة (11+)

| Input | Output |
|-------|--------|
| `egypt` | `EGX` |
| `مصر` | `EGX` |
| `EGX` | `EGX` |
| `ksa` | `TADAWUL` |
| `saudi` | `TADAWUL` |
| `السعودية` | `TADAWUL` |
| `TADAWUL` | `TADAWUL` |
| `kuwait` | `KSE` |
| `الكويت` | `KSE` |
| `qatar` | `QSE` |
| `america` | `US` |
| `US` | `US` |
| `crypto` | `crypto` |

### 11.3 الاستخدام

```python
from data_engine.data_layer import normalize_market

# في أي ملف:
canonical = normalize_market('egypt')       # → 'EGX'
canonical = normalize_market('مصر')         # → 'EGX'
canonical = normalize_market('ksa')         # → 'TADAWUL'
canonical = normalize_market(None)          # → None
canonical = normalize_market('')            # → None
```

> الـ `data_layer` بـ يستخدمها داخلياً في كل الـ reads + writes. الـ caller مش محتاج يطبّع.

---

## 12. النسخ الاحتياطية

| النوع | الموقع | الحجم | ملاحظة |
|------|-------|-------|--------|
| DB snapshot | `db_release_20261025/` | ~1.5 GB (مضغوط) | split archives (.aa, .ab, ...) |
| Weekly backup | `data/db_backup_*` | متغير | نسخ أسبوعية |
| Code backup | `db/code_backup_*` | ~50 MB | نسخة من الكود |
| Production DB | `upload/predictions.db.zip` | ~277 MB | backup tag |

### استرجاع DB من archive

```bash
# data_engine.db (5 أجزاء) — المصدر الأساسي
mkdir -p db_release_20261025/out
cat db_release_20261025/data_engine.db.tar.gz.{aa,ab,ac,ad,ae} > db_release_20261025/out/de.tar.gz
cd db_release_20261025/out
tar -xzf de.tar.gz
cd /home/z/my-project
mv db/data_engine.db db/data_engine.db.old.bak 2>/dev/null || true
mv db_release_20261025/out/root/GLMinvestment/db/data_engine.db db/data_engine.db
rm -rf db_release_20261025/out

# stocks.db (part واحد — legacy)
tar xzf db_release_20261025/stocks.db.tar.gz.aa -C /tmp/
cp /tmp/root/GLMinvestment/db/stocks.db db/

# predictions.db (جزئين)
cat db_release_20261025/predictions.db.tar.gz.{aa,ab} > /tmp/pred.tar.gz
tar xzf /tmp/pred.tar.gz -C /tmp/
cp /tmp/root/GLMinvestment/db/predictions.db db/

# بعد استرجاع data_engine.db: أنشئ جداول tv_snapshot + tv_indicators
python3 scripts/create_tv_tables.py
```

---

## 13. المشاكل المعروفة + الإصلاحات

### 13.1 ✅ تم إصلاحه: data_engine.db فاضي (0 بايت)

**المشكلة:** `db/data_engine.db` كان فاضي تماماً (0 بايت) لأنه ما اتسحبش من الـ archive.

**الإصلاح (BRAVO-DATA-LAYER 2026-10-29):** تجميع الـ 5 أجزاء من `db_release_20261025/data_engine.db.tar.gz.*` + فك الضغط → 531 MB DB حقيقي فيه 197K+ rows.

### 13.2 ✅ تم إصلاحه: تباين الـ Market Slug

**المشكلة:** السكرابر كان بـ يكتب `market='egypt'` (API slug lowercase) لكن كل الـ engines بتقرا `market='EGX'` (DB slug uppercase) → الـ engines مش بتشوف البيانات الجديدة.

**الإصلاح (BRAVO-SCANNER-DBSLUG-FIX):**
- إضافة `DB_MARKET_MAP` في السكرابر: `egypt→EGX`, `ksa→TADAWUL`, ...
- السكرابر بـ يحط الـ DB slug صراحةً (مش بـ يعتمد على الـ API)
- `data_layer.normalize_market()` بـ يطبّع أي alias في الـ reads

### 13.3 ✅ تم إصلاحه: symbol = NULL في stocks table

**المشكلة:** 1,240 row في `stocks` كان عندهم `symbol=NULL` لأن `save_to_db` كان بـ يستثني `symbol` من الـ UPDATE.

**الإصلاح:** `symbol = COALESCE(stocks.symbol, excluded.symbol)` في الـ upsert → backfill لو NULL.

### 13.4 ✅ تم إصلاحه: كل ملف بـ يقرا stocks.db بمزاجه

**المشكلة:** 82+ ملف في `vps-service/` بـ يفتحوا `sqlite3.connect` مباشرة بدل ما يمروا على طبقة موحدة.

**الإصلاح (BRAVO-DATA-LAYER):** إنشاء `data_engine/data_layer.py` كطبقة بيانات موحدة. V3 predictor اتعمل migration كامل لقراءة كل بياناته عبر الـ data layer (0 قراءات مباشرة لـ stocks.db).

### 13.5 ✅ تم إصلاحه: أسعار flat في EGX

**المشكلة:** ~83 سهم EGX عندهم أسعار flat في `stock_daily_prices` (نفس السعر مكرر).

**الإصلاح:** الـ data layer بـ يدمج `historical_data` + `egksco_price_history` + `tv_snapshot` → تاريخ نظيف non-flat ينتهي بالسعر اللحظي الطازج.

### 13.6 ✅ تم إصلاحه: المؤشرات محسوبة محلي بدل سحبها من TV

**المشكلة:** EGX30 محسوب = 52,251 vs الرسمي من TV = 49,281 (فرق 878 نقطة).

**الإصلاح:** `scripts/fetch_tv_indices.py` بـ يسحب القيم الرسمية من صفحات TV.

### 13.7 ⚠️ معروفة: جداول `tab_*` فيها schema مش ظابط

**المشكلة:** جداول `tab_technical_analysis` و `tab_valuation` فيها الـ `market` field بيحتوي على rating (مثل `شراء قوي`) بدل slug — بيكسر أي query بـ يستخدم `WHERE market=...`.

**الحل المؤقت:** V3 بـ يقرا fundamentals من `tv_snapshot` (أدق) بدل `tab_*`.

**الحل المستقبلي:** إعادة بناء جداول `tab_*` بـ schema صحيح + slug canonical.

### 13.8 ⚠️ معروفة: APIs لسه بتقرا من stocks.db

**المشكلة:** بعض الـ Next.js API routes لسه بتقرا من `stocks.db` مباشرة بدل ما تستخدم `data_layer`.

**الحل:** Migration تدريجي للـ APIs لاستخدام `data_layer`.

---

## المراجع

| الملف | الدور | الحالة |
|------|------|--------|
| **`data_engine/data_layer.py`** | **طبقة البيانات الموحدة (BRAVO-DATA-LAYER)** | ✅ نشط |
| **`data_engine/scrapers/tradingview_scanner_live.py`** | **TV Scanner — بـ يكتب لـ data_engine.db عبر data_layer** | ✅ نشط |
| **`vps-service/jobs/new_daily_predictor.py`** | **V3 predictor — بـ يقرا عبر data_layer** | ✅ نشط |
| `scripts/create_tv_tables.py` | إنشاء tv_snapshot + tv_indicators | ✅ نشط |
| `scripts/run_all_bravo_commands.sh` | سكربت تشغيل كامل لكل المراحل | ✅ نشط |
| `scripts/migrate_bravo_dbslug.py` | migration: 'egypt' → 'EGX' + symbol backfill | ✅ نشط |
| `vps-service/core/db_manager.py` | الـ DAL القديم (legacy) | ⚠️ Legacy |
| `data_engine/scrapers/egksco_scraper.py` | EGKSCO scraper (EGX رسمي) | ✅ نشط |
| `data_engine/scrapers/historical_fetcher_5years.py` | Yahoo historical | ✅ نشط |
| `scripts/fetch_tv_indices.py` | مؤشرات رسمية من TV | ✅ نشط |
| `scripts/sync_missing_prices.py` | sync قديم (legacy) | ⚠️ Legacy |
