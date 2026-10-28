# 02 — قواعد البيانات والبيانات (Databases & Data Layer)

> **آخر تحديث:** 2026-10-27 | **Branch:** `bravo/docs-consolidation` | **Agent:** Bravo V2
> **الأساس:** فحص فعلي لـ `db/` + `vps-service/utils/db_paths.py` + `vps-service/core/db_manager.py`
> + `data_engine/scrapers/tradingview_scanner_live.py` + `scripts/migrate_data_engine_to_stocks.py`
> + `scripts/reconcile_and_clean_historical_data.py` + `vps-service/analyzers/indicators/`.

---

## 0. TL;DR — القاعدة الذهبية

> **مصدر السعر الواحد:** `stocks.db.stock_daily_prices` هو المصدر الأساسي للأسعار اليومية.
> `price_history.db` معزول (WAVE 1-3) ويُستخدم فقط كـ **fallback أخير**.
> `db_manager._DB_ALIASES['price_history'] → STOCKS_DB` يعمل redirect شفاف
> فأي كود قديم بيكتب `db_manager.query('price_history', ...)` بينزل فعلياً على `stocks.db`.

---

## 1. استراتيجية الطبقات (Tiered Strategy)

| Tier | DBs | الدور | الـ Writer الأساسي |
|------|-----|-------|--------------------|
| **Write-Heavy (Raw)** | `data_engine.db`, `intraday.db`, `news.db`, `crypto.db`, `metrics.db` | بيانات أولية من scrapers + قياسات النظام | `data_engine/scrapers/*`, `intraday_aggregator.py`, `news_scraper.py` |
| **Read-Heavy (Synced)** | `stocks.db` | metadata + الأسعار اليومية الحية (آخر 30-90 يوم) | `tradingview_scanner_live.py` + `daily_price_updater.py` |
| **Brain Output** | `predictions.db`, `decision_log.db` | مخرجات المحركات + القرارات + التعلم | `daily_predictor.py` + `prediction_tracker.py` + `daily_closer.py` |
| **User State** | `auth.db` | المستخدمون + الاشتراكات + المحفظة | NextAuth (Node) + `persona_db.py` |
| **Archive (Frozen)** | `price_history.db`, `historical_snapshot_*.db` | تاريخ مجمّد (25 سنة) — للـ backtest فقط | read-only |

القاعدة: **كل DB لها كاتب واحد وقرّاء متعددون.** الكتابة المتزامنة من مصدرين
بتسبب `SQLITE_BUSY` + WAL corruption. لذلك `db_manager.py` بيفرض
`busy_timeout=30000` + `journal_mode=WAL` + `wal_autocheckpoint=1000`.

---

## 2. قائمة الـ DBs الكاملة

| # | DB | الحجم (sandbox) | الجداول | الدور |
|---|----|-----------------|---------|-------|
| 1 | **`auth.db`** | 0 KB (مهاجر لاحقاً) | User, SubscriptionPlan, PromoCode, api_tokens, portfolio_assets, session, account, verification_token, task_runs, user_stock_watchlists | المستخدمون + الاشتراكات + المحفظة الشخصية |
| 2 | **`stocks.db`** | 180 KB | `stocks` (66 col), `stock_daily_prices`, `analytics_events`, `sqlite_sequence` | metadata الأسهم + الأسعار اليومية الحية + analytics |
| 3 | **`predictions.db`** | 290 MB | 33 جدول (راجع §4) | كل مخرجات المحركات: توقعات + تعلم + نتائج + محفظة |
| 4 | **`data_engine.db`** | 0 KB (sandbox) — معبأ على الإنتاج | 27+ جدول (rاجع §5) | مصادر تاريخية + egksco + tab_* (fundamentals) + metals/forex + crypto |
| 5 | **`intraday.db`** | 0 KB (sandbox) — ~1.1M rows على الإنتاج | `stock_intraday`, `crypto_intraday`, `commodity_intraday`, `intraday_meta` | بيانات tick-level لحظية |
| 6 | **`metrics.db`** | 127 KB | `pm2_process_snapshot`, `resource_snapshot_5min`, `resource_snapshot_1h`, `resource_snapshot_raw`, `resource_alert` | قياسات النظام (CPU/RAM/PM2) |
| 7 | **`news.db`** | 0 KB (sandbox) — 1,019 rows على الإنتاج | `market_news` (canonical — renamed per Rule 44), `scraping_status`, `tracked_channels` | أخبار السوق من RSS + Telegram |
| 8 | **`crypto.db`** | 0 KB (legacy) | جداول crypto قديمة — معظمها مهاجر لـ `data_engine.db.crypto_prices` | legacy — لا يُكتب عليه |
| 9 | **`decision_log.db`** | 0 KB | `decision_log` (12 col) + idx_decision_symbol + idx_decision_reason | سجل قرارات الـ reject_entry + force_exit |
| 10 | **`price_history.db`** | 0 KB (sandbox) — ~1.4M rows على الإنتاج — **معزول WAVE 1-3** | `price_history` (10 col, 25 سنة OHLCV) | fallback أخير للأسعار التاريخية |
| 11 | **`historical_snapshot_*.db`** | ملفات مؤقتة | نسخة من snapshots تاريخية للاختبار | read-only — مثال: `db/historical_snapshot_2026-10-18.db` |
| 12 | **`custom.db`** | 24 KB | جداول مساعدة | إعدادات محفوظة محلياً |

> **ملاحظة:** الـ 4-DB target architecture (`market.db` + `predictions.db` + `auth.db` + `content.db`)
> في `db_paths.py` هو **هدف نهائي** لم يكتمل بعد. حالياً كل alias بـ points
> للـ DB الأصلي اللي فيه بيانات حقيقية.

---

## 3. `stocks.db` — المصدر الأساسي للأسعار والميتاداتا

### 3.1 جدول `stocks` (66 عمود)

**الكاتب الوحيد:** `data_engine/scrapers/tradingview_scanner_live.py`
(POST `https://scanner.tradingview.com/{market}/scan`).

**الـ 60 field من TradingView Scanner API** (موثقة حياً 2026-10-27):

| المجموعة | الأعمدة (API field → DB column) |
|---------|----------------------------------|
| **Session + Liquidity (10)** | `name → symbol`, `close → current_price`, `change → change_percent`, `change_abs → change_value`, `volume`, `Value.Traded → value_traded`, `relative_volume_10d_calc → relative_volume_10d`, `high → high_price`, `low → low_price`, `open → open_price` |
| **Valuation (7)** | `market_cap_basic → market_cap`, `enterprise_value_fq → enterprise_value`, `price_earnings_ttm → pe_ratio`, `price_sales_current → ps_ratio`, `price_book_fq → pb_ratio`, `enterprise_value_to_revenue_ttm → ev_to_revenue`, `enterprise_value_to_ebitda_ttm → ev_to_ebitda` |
| **Earnings/Dividends (5)** | `earnings_per_share_basic_ttm → eps`, `earnings_per_share_diluted_ttm → eps_diluted`, `dividends_yield_current → dividend_yield`, `dps_common_stock_prim_issue_fy → dps_ttm`, `payout_ratio_ttm_fq → payout_ratio` |
| **Profitability (6)** | `gross_margin`, `operating_margin`, `net_margin → profit_margin`, `return_on_assets → roa`, `return_on_equity → roe`, `return_on_invested_capital → roic` |
| **Balance Sheet (7)** | `total_assets`, `total_current_assets`, `cash_n_cash_equivalents_fq → cash_and_equivalents`, `total_liabilities`, `total_debt`, `total_equity`, `total_shares_outstanding_fundamental → shares_outstanding` |
| **Income (4)** | `total_revenue`, `gross_profit`, `operating_income`, `net_income` |
| **Cash Flow (4)** | `cash_f_operating_activities → cash_flow_operating`, `cash_f_investing_activities → cash_flow_investing`, `cash_f_financing_activities → cash_flow_financing`, `free_cash_flow` |
| **Technicals (10)** | `Recommend.All → recommend_all`, `Recommend.MA → recommend_ma`, `Recommend.Other → recommend_other`, `RSI → rsi`, `MACD.macd → macd`, `MACD.signal → macd_signal`, `ATR → atr`, `SMA20 → sma20`, `SMA50 → sma50`, `SMA200 → sma200` |
| **Description (6)** | `description → name_ar`, `sector`, `industry`, `currency`, `exchange`, `logoid` |
| **Meta (5)** | `logo_url` (مبني من `logoid`), `tabs_data` (JSON — من migration), `market`, `turnover_egp`, `last_updated`, `is_active`, `id` |

**Performance المثبتة حياً:** 1,480 سهم عبر 5 أسواق في **3.3 ثانية** (egypt ~230ms).
الكود بيعمل `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` idempotent
عشان يتأقلم مع schema drift.

**Pollution guard** (منع رموز ملوثة من الـ legacy merge):
- Latin: `symbol='LUTSL'`, `name='LUTSLotus For Agricultural...D'` → rejected
- Arabic: `symbol='COMI'`, `name='COMIالبنك'` → rejected
- Rule: لو `name.startswith(symbol)` والباقي حروف كبيرة/عربية → skip.

### 3.2 جدول `stock_daily_prices` (12 عمود)

**المصدر الأساسي للأسعار اليومية الحية.**

```sql
CREATE TABLE stock_daily_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    symbol TEXT,        -- mirror of ticker (added by reconcile_and_clean_historical_data.py)
    price_date TEXT,
    open REAL, high REAL, low REAL, close REAL,
    volume TEXT,        -- legacy: text ('1.36 M'). Reconciler بيحوّله REAL.
    change_percent REAL,
    fetch_time TEXT,
    market TEXT DEFAULT 'US'  -- ⚠️ BUG معروف: المفروض 'EGX'
);
```

**الـ writers (4):**
| Writer | Line | INSERT type | يحدد market؟ | Bug؟ |
|--------|------|-------------|---------------|------|
| `data/egksco_fetcher.py` (eodhd_fetcher) | 195 | `INSERT OR REPLACE` | ❌ لا | ✅ DEFAULT 'US' between |
| `vps-service/scripts/daily_price_updater.py` | 165 | `INSERT` | ❌ لا | ✅ DEFAULT 'US' between |
| `vps-service/scripts/price_unification.py` | 98 | `INSERT OR IGNORE` | ✅ 'EGX' | ❌ |
| `vps-service/data/gap_filler.py` | 151 | `INSERT OR IGNORE` | ✅ | ❌ |

**الـ consumers (كلهم بيتأثروا لو مفيش market filter):**
- `scripts/maker_radar.py` (entry_price lookup)
- `vps-service/utils/shared_liquidity.py` (volume surge)
- `src/app/api/maker-radar/verify/route.ts` (TS API)
- `core/real_liquidity_radar.py`
- `analyzers/radar_accuracy_report.py` (merges 4 sources)

### 3.3 جدول `analytics_events` (11 عمود)

أحداث الـ analytics اللي بـ تـ trackها الـ frontend (clicks, views, signal dismissals).
الـ schema بسيط: `event_type`, `event_data` (JSON), `user_id`, `ticker`, `timestamp`.

---

## 4. `predictions.db` — Brain Output (33 جدول)

**الحجم:** 290 MB | **الـ Writers:** `daily_predictor.py` + `prediction_tracker.py`
+ `intraday_scanner.py` + `daily_closer.py` + `nightly_analysis.py`.

### 4.1 الجداول الرئيسية

| Table | Rows | Cols | الوصف |
|-------|------|------|-------|
| **`predictions`** | **1,349** (بعد التنظيف) | 75 | التوقعات الرئيسية — كل توقع BUY/SELL/HOLD بيدخل هنا. فيه `idx_predictions_dedup` (B2 migration) |
| `stored_analyses` | 0 (sandbox) — مُعبأ على الإنتاج | 50 | نسخة سريعة للـ frontend (Rule 73: SINGLE-WRITER = `daily_predictor.py` بس) |
| `crypto_predictions_log` | 187,345 | 16 | توقعات الكريبتو المنفصلة |
| `learned_lessons` | 20,031 | 10 | دروس مستخرجة من outcomes (feedback loop) |
| `historical_trades` | 22,650 | 17 | صفقات تاريخية للـ backtest |
| `persona_predictions` | 1,669 | 25 | توقعات per-persona (conservative/balanced/gambler) |
| `aiPrediction` | 2,613 | 24 | توقعات الـ AI agent |
| `exit_notifications` | 4,064 | 15 | إشارات الخروج المُرسلة |
| `live_ai_signals` | 1,650 | 10 | إشارات AI لحظية |
| `corporate_actions` | 131 | 7 | إجراءات شركات (splits/dividends) — للـ price sanity |
| `quant_cache` | 538 | 10 | كاش SMFI + Monte Carlo (nightly 03:00) |
| `morning_bell_signals` | 82 | 21 | توقعات Morning Bell (STRONG_BUY 78+) |
| `ExpertRecommendation` | 17 | 24 | توصيات خبراء بشر (Expert Memory Bridge) |
| `hunter_pick_tracking` | 46 | 16 | تتبع أسهم الـ explosive hunter |
| `liquidity_signal_outcomes` | 1,308 | 11 | نتائج إشارات السيولة |
| `stock_stories` | 1,285 | 8 | سرد صحفي للسهم |
| `sniper_performance` | 42 | 16 | أداء الـ sniper engine |
| `optimizer_params_history` | 20 | 9 | سجل تغييرات الـ optimizer |
| `liquidity_backtest_results` | 10 | 15 | نتائج backtest الـ liquidity |
| `liquidity_dynamic_threshold` | 5 | 8 | عتبات السيولة الديناميكية |
| `prediction_outcomes` | 0 | 10 | نتائج التوقعات (pending population) |
| `aiPredictionStats` | 1 | 9 | إحصائيات شاملة |
| `portfolios` | 4 | 10 | محفظة افتراضية للـ paper trading |
| `analysis_engine_status` | 1 | 13 | حالة الـ engine الحي |
| `analysis_jobs` | 0 | 13 | طابور التحليلات |
| `cached_analysis` | 0 | 18 | كاش تحليلات قديم |
| `prediction_lessons` | 4 | 9 | دروس مخصصة للتوقعات |
| `reports` | 8 | 10 | تقارير محفوظة |
| `trade_journal_entries` | 0 | 28 | يومية الصفقات |
| `trade_journal_reflections` | 0 | 11 | تأملات على الصفقات |
| `trade_outcomes` | 0 | 20 | نتائج الصفقات |
| `user_trades` | 0 | 9 | صفقات المستخدم الحقيقية |

### 4.2 جدول `predictions` (75 عمود) — الأعمدة الرئيسية

```sql
CREATE TABLE predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    signal TEXT,           -- BUY | STRONG_BUY | ACCUMULATE | HOLD | REDUCE | SELL | STRONG_SELL | NO_TRADE
    signal_type TEXT,      -- mirror of signal (legacy)
    prediction_date TEXT,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    master_score REAL,     -- 0-100
    technical_score REAL,
    fundamental_score REAL,
    ai_pattern_score REAL,
    sentiment_score REAL,
    outcome_date TEXT,
    exit_price REAL,
    actual_return REAL,
    hit_target INTEGER,
    hit_stop INTEGER,
    is_correct INTEGER,
    holding_days INTEGER,
    -- ... 56 column إضافي (atr_at_entry, target_price_2, explosive_score,
    --     explosive_label, who_is_buying, kill_filter_result, persona, market,
    --     track, notes, updated_at, update_count, evidence_count, morning_bell, ...)
);

-- Indexes
CREATE INDEX idx_predictions_ticker  ON predictions(ticker);
CREATE INDEX idx_predictions_market  ON predictions(market);
CREATE INDEX idx_predictions_date    ON predictions(prediction_date);
CREATE INDEX idx_predictions_outcome ON predictions(outcome_date);
CREATE INDEX idx_predictions_status  ON predictions(outcome_date, hit_target, hit_stop);
CREATE INDEX idx_predictions_created ON predictions(created_at DESC);
```

### 4.3 `predictions_duplicates_archive` + dedup

**B2 migration** أنشأت UNIQUE INDEX:

```sql
CREATE UNIQUE INDEX idx_predictions_dedup
ON predictions(ticker, substr(prediction_date,1,10), persona, market, track);
```

**الـ dedup logic** (في `prediction_tracker.py:640-759`):
1. قبل أي `INSERT`، `SELECT` على نفس المفتاح (ticker, day, persona, market, track).
2. لو موجود → `UPDATE` فقط الحقول الـ mutable (`signal`, `master_score`, `notes`, ...)
   مع **حفظ** `entry_price` و `target_price` و `stop_loss` الأصلية + `update_count = COALESCE(update_count, 0) + 1`.
3. لو مفيش → `INSERT` جديد.
4. **IntegrityError retry**: لو سباق (race) حصل بين الـ SELECT والـ INSERT،
   الـ UNIQUE INDEX بيرمي `sqlite3.IntegrityError` → الـ caller (`intraday_scanner.py:799`)
   بيعمل retry كـ UPDATE.

الـ rows المرفوضة (لو الـ archive table موجود) بتتحفظ في `predictions_duplicates_archive`.

### 4.4 `radar_signal_tracking` (في نفس الـ DB على الإنتاج)

كاتبها: `vps-service/camp/state_history_tracker.py`.
الـ schema: `ticker, canonical_state, signal_date, days_in_state, transition_*`.
بيُقرأ من: `camp/canonical_state_shadow.py` + `analyzers/institutional_levels.py`
(marker radar لصانع السوق).

---

## 5. `data_engine.db` — المصادر التاريخية والأساسيات

> **ملاحظة:** على الساندبوكس المجلد فاضي (0 KB). كل البيانات الفعلية على الإنتاج.
> الـ schema موثق في `vps-service/utils/db_paths.py:192-203` + `Documentation/DATA_LINEAGE.md`.

### 5.1 الجداول (27+ جدول)

| المجموعة | الجداول |
|---------|---------|
| **الأسعار التاريخية** | `egksco_price_history` (DEPRECATED per Rule 46 amended — استخدم `stock_daily_prices`), `historical_data` (ticker رقمي، multi-market) |
| **الأساسيات (tab_*)** | `tab_balance_sheet`, `tab_cash_flow`, `tab_dividends`, `tab_income_statement`, `tab_performance`, `tab_profitability`, `tab_technical_analysis`, `tab_valuation` |
| **Crypto** | `crypto_prices`, `crypto_price_history`, `cryptos`, `crypto_metrics`, `crypto_fetch_log` |
| **Metals/Forex** | `gold_prices` (canonical: 187K rows), `gold_prices_clean`, `silver_prices`, `exchange_rates`, `btc_local_prices` |
| **Macro** | `macro_indicators`, `macro_prices`, `macro_fetch_log` |
| **Screener** | `screener_presets`, `screener_results`, `screener_lists` |
| **Sync** | `sync_status`, `egksco_sync_status` |

### 5.2 الـ tab_* tables — PK auto-detection

الـ schema مختلف بين الساندبوكس والإنتاج ( Rule 67 — Root cause):
- **الساندبوكس (snapshot قديم):** `symbol` PK + TEXT metrics + 8 tables
- **الإنتاج (laptop + VPS):** `ticker` PK + REAL metrics + 3 tables (valuation/profitability/balance_sheet)

`utils/db_paths.py:detect_tab_pk_column()` بـ auto-detect الـ PK column
(`ticker` أو `symbol`) per (db_path, table) — cached per process.

### 5.3 `egksco_price_history` (DEPRECATED)

| الخاصية | القيمة |
|---------|--------|
| الكاتب | `data_engine/scrapers/egksco_scraper.py` |
| الـ rows على الإنتاج | ~60K (2025-09-22..2026-10-25) |
| الـ columns | `symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover, market` |
| الحالة | **DEPRECATED** per Rule 46 — استخدم `stocks.db.stock_daily_prices` |
| يستخدمه | `market_regime_engine.py` (EGX index), `maker_radar.py` (fallback EGX) |

### 5.4 `historical_data` (multi-market)

| الخاصية | القيمة |
|---------|--------|
| الكاتب | `data_engine/scrapers/historical_fetcher.py` |
| الـ rows على الإنتاج | ~197K (2021-06-08..2026-10-22) |
| الـ columns | `symbol (رقمي), date, open, high, low, close, volume, market` |
| يستخدمه | `maker_radar.py` لـ TADAWUL/KSE/QSE/US |

---

## 6. `price_history.db` — معزول WAVE 1-3 (fallback أخير فقط)

| الخاصية | القيمة |
|---------|--------|
| الـ rows على الإنتاج | **1,402,254** (25 سنة — 2000-11-27..2026-10-25) |
| الـ columns | `ticker, date, open_price, high_price, low_price, close_price, volume, market` |
| الحالة | **معزول WAVE 1-3** — لا يُكتب عليه |
| الاستخدام الحالي | **fallback أخير فقط** (لو `stock_daily_prices` فاضي تماماً) |

### 6.1 آلية العزل في `db_manager.py`

```python
# vps-service/core/db_manager.py:96-117
_DB_ALIASES: Dict[str, str] = {
    'stocks':        DBPaths.STOCKS_DB,
    'predictions':   DBPaths.PREDICTIONS_DB,
    'price_history': DBPaths.STOCKS_DB,  # WAVE-3: redirect to stocks.db (live)
                                          # price_history.db is stale Sept 2026
    'data_engine':   DBPaths.DATA_ENGINE_DB,
    'intraday':      DBPaths.INTRADAY_DB,
    'auth':          DBPaths.AUTH_DB,
    'crypto':        DBPaths.CRYPTO_DB,
    'crypto_learning': DBPaths.CRYPTO_LEARNING_DB,
    'news':          DBPaths.NEWS_DB,
    'analytics':     DBPaths.STOCKS_DB,            # cached_analysis canonical
    'gold_prices':   DBPaths.DATA_ENGINE_DB,        # canonical 187K rows
    'historical':    DBPaths.STOCKS_DB,             # WAVE-3 redirect
    'community':     DBPaths.COMMUNITY_DB,
    'telegram_data': DBPaths.STOCKS_DB,
}
```

**النتيجة:** أي كود قديم بيكتب `db_manager.query('price_history', ...)`
بينزل فعلياً على `stocks.db.stock_daily_prices` شفافياً — مفيش refactor مطلوب.

### 6.2 الاستخدام الوحيد المسموح لـ `price_history.db` مباشرة

في `src/app/api/portfolio/rescue/route.ts` (WAVE 2):
- الـ PRIMARY: `stocks.db.stock_daily_prices` (via `openDb('stocks.db')`).
- الـ EMERGENCY FALLBACK: `price_history.db.price_history` (مكشوف صراحةً كـ comment).
مفيش أي ملف تاني مسموح له يفتح `price_history.db` مباشرة.

---

## 7. `decision_log.db` — سجل القرارات

| الخاصية | القيمة |
|---------|--------|
| الـ Writer | `analyzers/decision_logger.py:log_decision()` (via `db_manager.get_connection(writable=True)`) |
| الـ Reader | `analyzers/decision_logger.py:get_decision_stats()` |
| الـ columns | `id, timestamp, symbol, market, decision_type, reason_code, reason_text, flag_active, notebook_summary, score_before, score_after, scan_date` |
| Indexes | `idx_decision_symbol (symbol, timestamp DESC)`, `idx_decision_reason (reason_code, decision_type)` |

**الـ REASON_CODES (19 موثق في `decision_logger.py:85-110`):**

| المجموعة | الأكواد |
|---------|---------|
| Entry rejections | `late_entry`, `not_accumulation`, `danger_level_5`, `avoid_chase_chasing`, `disclosure_veto`, `news_veto`, `crypto_disclosure_veto`, `crypto_news_veto`, `data_invalid` (B1), `expert_veto`, `bearish_regime`, `risk_gate_blocked`, `risk_gate_passed` |
| Force exits | `distribution_exit`, `max_holding`, `max_holding_7d`, `no_move`, `no_move_3d`, `early_drop` |

**الـ call sites (13 موقع):** راجع `Documentation/02-HOW-IT-THINKS.md` §6.

---

## 8. `metrics.db` — قياسات النظام

| Table | Rows | Cols | الوصف |
|-------|------|------|-------|
| `pm2_process_snapshot` | 580 | 10 | snapshot لكل عملية PM2 (CPU/MEM/uptime) |
| `resource_snapshot_raw` | 75 | 19 | قياسات خام للنظام (CPU/RAM/disk/network) |
| `resource_snapshot_5min` | 14 | 14 | aggregate كل 5 دقايق |
| `resource_snapshot_1h` | 18 | 14 | aggregate كل ساعة |
| `resource_alert` | 43 | 7 | تنبيهات تجاوز thresholds (CPU > 80%, etc.) |

**الـ Writer:** `vps-service/scripts/data_heartbeat_checker.py` + admin endpoints.
**الـ Reader:** `src/app/api/admin/system-resources/route.ts` (via `DbManager.openDbWritable`).

---

## 9. `news.db` + `crypto.db` + `intraday.db` + `auth.db`

### 9.1 `news.db`
- **الـ Writer:** `data_engine/scrapers/news_scraper.py` + `ai/news_agent.py` (db_writer).
- **الـ canonical table:** `market_news` (1,019 rows على الإنتاج) — renamed from `news_articles` per Rule 44.
- جداول إضافية: `scraping_status`, `tracked_channels`, `telegram_messages` (target architecture).

### 9.2 `crypto.db`
- **legacy** — معظم الجداول هاجرت لـ `data_engine.db.crypto_prices`.
- لا يُكتب عليه. مفيش migration جديدة.

### 9.3 `intraday.db`
- **الـ Writer:** `vps-service/jobs/intraday_aggregator.py`.
- الجداول: `stock_intraday`, `crypto_intraday`, `commodity_intraday`, `intraday_meta`.
- الـ rows على الإنتاج: ~1.1M (tick-level).
- يُقرأ من `analyzers/intraday_reader.py` + `core/real_liquidity_radar.py`.

### 9.4 `auth.db`
- **الـ Writer الأساسي:** NextAuth.js (Node.js — Prisma).
- جداول: `User`, `SubscriptionPlan`, `PromoCode`, `api_tokens`, `portfolio_assets`,
  `session`, `account`, `verification_token`, `task_runs`, `user_stock_watchlists`.
- الـ Python side بـ يقرأ فقط عبر `db_manager.get_connection('auth', writable=False)`.

---

## 10. TradingView Scanner Live — المصدر الرئيسي للـ stocks.db

**الملف:** `data_engine/scrapers/tradingview_scanner_live.py` (451 LOC).

### 10.1 المعطيات

| الخاصية | القيمة |
|---------|--------|
| Endpoint | `POST https://scanner.tradingview.com/{market}/scan` |
| الأسواق المدعومة | `egypt, saudi (ksa), kuwait, qatar, america` (5 أسواق) |
| الحقول | **60 field** (10 session + 7 valuation + 5 earnings + 6 profitability + 7 balance + 4 income + 4 cash flow + 10 technicals + 6 description + 1 logoid) |
| السرعة المثبتة | **3.3 ثانية لكل الـ 5 أسواق** (egypt ~230ms وحده) |
| الـ range | `[0, 1000]` لكل سوق — max 1,000 سهم/سوق |
| الـ sort | `Value.Traded DESC` (الأكثر سيولة الأول) |
| اللغة | `lang: 'ar'` (للوصف العربي) |
| HTTP timeout | 20 ثانية |
| User-Agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36` |

### 10.2 الـ mapping (API field → DB column)

كل الـ 60 field بـ يحصلوا mapping لـ snake_case + semantic names (راجع §3.1).
مثال: `total_revenue → total_revenue`, `RSI → rsi`, `Recommend.All → recommend_all`.

### 10.3 Logo URL

```python
LOGO_URL_TEMPLATE = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"
```
الـ scraper بـ يبني `logo_url` من `logoid` ويخزنه في عمود منفصل.

### 10.4 CLI

```bash
python3 data_engine/scrapers/tradingview_scanner_live.py              # كل الأسواق
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt
python3 data_engine/scrapers/tradingview_scanner_live.py --dry-run
```

---

## 11. Migration Scripts

### 11.1 `scripts/migrate_data_engine_to_stocks.py` (SCANNER-LIVE-3)

**الهدف:** ترحيل كل `stocks, name_ar, sector, logo_url, tabs_data` من
`data_engine.db.stocks` (legacy) إلى `stocks.db.stocks` (الموحّد).

**الـ pipeline (idempotent — safe لـ re-run):**
1. Copy `logo_url`, `name_ar`, `sector`, `industry` من data_engine → stocks
   (فقط لو stocks.db عنده NULL/missing — **يحافظ على scanner data**).
2. Clean polluted symbols (LUTSL, COMIالبنك, trailing 'D' badges).
3. Merge `tabs_data` (JSON) من data_engine.db → stocks.db.tabs_data.
4. Idempotent: `INSERT OR IGNORE` + `UPDATE` — **مفيش DELETE أبداً**.

```bash
python3 scripts/migrate_data_engine_to_stocks.py --dry-run
python3 scripts/migrate_data_engine_to_stocks.py --source db/data_engine.db --target db/stocks.db
```

### 11.2 `scripts/reconcile_and_clean_historical_data.py` (SCANNER-LIVE-4)

**الهدف:** استخدام الـ "Ground Truth" النظيف من
`tradingview_scanner_live.py` (1,480 سهم، symbols إنجليزية نقية) لتنظيف
كل الـ historical data الـ legacy.

**4-stage pipeline (idempotent — production-safe):**

| Stage | الوصف |
|-------|-------|
| 1 | Build Rosetta mapping (`clean symbol → {name_ar, logo_url, sector, ...}`) من `stocks.db` |
| 2 | Clean `stock_daily_prices` في `stocks.db`:<br>• Add `symbol` column (mirror of `ticker`)<br>• Convert text volume (`'1.36 M'`, `'500 K'`) → REAL numbers<br>• Clean polluted tickers (`COMIالبنك → COMI`, `LUTSL → LUTS`) |
| 3 | Clean `tab_*` tables في `data_engine.db`:<br>• Split Arabic من symbol → `name_ar` (symbol يفضل pure)<br>• Map legacy tickers لـ clean symbols via Rosetta |
| 4 | Inject `logo_url` في `stocks.db.stocks` لكل row ناقصة |

```bash
python3 scripts/reconcile_and_clean_historical_data.py --dry-run
python3 scripts/reconcile_and_clean_historical_data.py --stocks-db db/stocks.db --data-engine-db db/data_engine.db
```

---

## 12. Canonical Technical Indicators (`analyzers/indicators/`)

**Rule 67 — CALCULATION-CANONICAL:** ده المصدر الوحيد لكل المؤشرات الفنية في المشروع.
**ممنوع** inline copies. كل analyzer لازم يستورد من هنا.

| File | Function | الصيغة |
|------|----------|--------|
| `atr.py` | `calc_atr(highs, lows, closes, period=14)` | **Wilder's smoothing** (مش SMA): `atr = (atr × (period-1) + tr) / period` |
| `rsi.py` | `calc_rsi(closes, period=14)` | **Wilder's smoothing**: `avg_gain = (avg_gain × (period-1) + gain) / period` |
| `srsi.py` | `calc_srsi(...)` | Stochastic RSI (Chande & Kroll 1994) — مكمّل لـ RSI |
| `bollinger.py` | `calc_bollinger(closes, period=20, std_dev=2.0)` + `calc_bollinger_series(...)` | middle=SMA, upper/lower=±std_dev×std, bandwidth, percent_b |
| `mfi.py` | `calc_mfi(...)` | Money Flow Index (volume-weighted RSI) |
| `adx.py` | `calc_adx(...)` | ADX/DMI (Wilder's) — قوة الترند |
| `vwap.py` | `calc_vwap(...)` + `calc_vwap_premium(...)` | VWAP (session أو rolling) + premium % |
| `volume_profile.py` | `calc_volume_profile(...)` | Volume Profile (POC/VAH/VAL) |
| `ma.py` | `sma(data, period)` + `ema(data, period)` + `macd(closes, 12, 26, 9)` | SMA=sum/period, EMA recursive `k=2/(period+1)`, MACD=EMA(fast)-EMA(slow) |
| `flow_indicators.py` | (multiple) | مؤشرات التدفق (CMF, OBV, etc.) |

### 12.1 لماذا Wilder's smoothing (مش SMA)؟

| المؤشر | SMA (غلط) | Wilder's (صح) |
|--------|-----------|---------------|
| ATR | `sum(TR[-14:])/14` — أسرع تغيّر | `(atr × 13 + tr) / 14` — أبطأ وأكثر استقراراً |
| RSI | `sum(gains[-14:])/14` — 10-20 نقطة فرق | `(avg_gain × 13 + gain) / 14` — industry standard (Wilder 1978) |

**المرجعية:**
- `00-CONSTITUTION.md` Rule 67 (CALCULATION-CANONICAL)
- `Documentation/ENGINEERING_AUDIT_REPORT.md` Bug #1 (ATR/RSI Wilder vs SMA)
- النسخ الأصلية: `analyzers/technical_analyzer.py:81` (RSI), `:206` (ATR)

### 12.2 كيف تستخدمها

```python
from analyzers.indicators import calc_atr, calc_rsi, calc_bollinger, sma, ema, macd

atr = calc_atr(highs, lows, closes, period=14)        # Wilder's
rsi = calc_rsi(closes, period=14)                      # Wilder's
bb = calc_bollinger(closes, period=20, std_dev=2.0)   # {middle, upper, lower, bandwidth, percent_b}
s50 = sma(closes, 50)
e12 = ema(closes, 12)
m = macd(closes)                                       # {line, signal, histogram}
```

---

## 13. Fallback Chain (Live data fetching)

**الترتيب:** `scanner_live → rest → egksco → DB read`

| Tier | المصدر | الملف | الـ threshold للنجاح |
|------|---------|------|----------------------|
| 1 | **TradingView Scanner Live** | `data_engine/scrapers/tradingview_scanner_live.py` | ≥ 50 سهم |
| 2 | **TradingView REST** | `data_engine/scrapers/tradingview_rest.py` | ≥ 50 سهم |
| 3 | **EGKSCO** (EGX only) | `data_engine/scrapers/egksco_scraper.py` | ≥ 30 سهم |
| 4 | **DB read** (fallback أخير) | `stocks.db.stocks` (آخر تحديث) | read-only |

**القواعد الصارمة (`fallback_chain.py`):**
1. لو مصدر واحد وقع، الكود يكمل للمصدر التاني بدون ما يـ crash.
2. لو المصدر رجع `[]` (فاضي)، الكود يعتبرها "فشل" وينتقل للتالي.
3. لو كل المصادر وقعت، الـ Sync **يتوقف فوراً** عشان نحافظ على الأسعار القديمة.

**Circuit Breaker (`vps-service/core/circuit_breaker.py`):**
بيمنع retry storm لما مصدر بيانات يقع — بدل ما كل tick يفتح HTTP request لمصدر ميت،
الـ circuit بيفتح (Open) ويرفض الطلب فوراً (Fail Fast) لمدة 5 دقايق.

---

## 14. قواعد الملكية (Ownership Rules)

| القاعدة | التفاصيل |
|---------|----------|
| **كاتب واحد** | كل DB لها كاتب واحد. الـ concurrent writes بـ تسبب `SQLITE_BUSY`. |
| **`stocks.db`** | `tradingview_scanner_live.py` هو الـ writer الوحيد لـ `stocks`. `daily_price_updater.py` + `price_unification.py` + `gap_filler.py` بيكتبوا `stock_daily_prices`. |
| **`predictions.db`** | `daily_predictor.py` + `prediction_tracker.py` + `intraday_scanner.py` + `daily_closer.py` — كلهم عبر `db_manager.get_connection(writable=True)`. |
| **`auth.db`** | NextAuth.js (Node) هو الـ writer الوحيد. الـ Python side بـ يقرأ فقط. |
| **`stored_analyses`** | `daily_predictor.py` هو الـ **SINGLE-WRITER** (Rule 73). أي ملف تاني بـ يقرأ فقط. |
| **`decision_log.db`** | `log_decision()` هو الـ API الوحيد. مفيش كود يفتح الـ DB مباشرة. |

---

## 15. النسخ الاحتياطية (Backups)

| النوع | الموقع | الحجم | الـ cadence |
|------|-------|-------|-------------|
| DB snapshot (compressed) | `db/stocks_dump.sql.gz` + `db/price_history_dump.sql.gz` | ~28 MB + ~28 MB | per-release |
| Daily backup | `data/db_backup_*/` | متغير | يومي (`vps-service/scripts/daily_backup.py`) |
| Pre-migration backup | `db/<name>.db.bak-unify` | per-DB | قبل كل P0 migration |
| Code backup | `db/code_backup_*/` | ~50 MB | per-release |
| Stale snapshots | `db/predictions.db.bak-20261027-160746` | 290 MB | قبل الـ dedup cleanup |

---

## 16. Canonical Sources Registry (مصدر واحد لكل نوع بيانات)

| النوع | الـ canonical DB.Table | الـ deprecated |
|------|-----------------------|----------------|
| Live price (daily) | `stocks.db.stock_daily_prices` | `data_engine.db.egksco_price_history` |
| Historical price (25y) | `price_history.db.price_history` (معزول — fallback أخير) | — |
| Stock metadata | `stocks.db.stocks` (66 col) | `data_engine.db.stocks` (legacy) |
| Fundamentals (tab_*) | `data_engine.db.tab_*` | — |
| Predictions | `predictions.db.predictions` | — |
| Stored analyses | `predictions.db.stored_analyses` | — |
| News | `news.db.market_news` | `stocks.db.market_news` (phantom) |
| Gold prices | `data_engine.db.gold_prices` (187K rows) | `stocks.db.gold_prices` (3 stale rows — dropped) |
| Crypto prices | `data_engine.db.crypto_prices` | `crypto.db.*` (legacy) |
| Decision log | `decision_log.db.decision_log` | — |
| Resource metrics | `metrics.db.resource_snapshot_*` | — |
| Users | `auth.db.User` | — |

---

## 17. مراجع خارجية

- `Documentation/00-CONSTITUTION.md` — Rule 44 (news table rename), Rule 46 (egksco deprecated), Rule 67 (canonical indicators), Rule 73 (stored_analyses single-writer)
- `Documentation/DATA_LINEAGE.md` — Radar Data Source Inventory (D1)
- `Documentation/DATABASE-OWNERSHIP-REGISTRY.md` — per-table ownership matrix
- `Documentation/DATA-UNIFICATION-PLAN.md` — الـ 4-DB target architecture plan
- `Documentation/P0-UNIQUE-CONSTRAINT-DESIGN.md` — `idx_predictions_dedup` design
- `vps-service/utils/db_paths.py` — SSOT للمسارات + `get_db_for_table()`
- `vps-service/core/db_manager.py` — البوابة المركزية + `_DB_ALIASES`
- `agent-ctx/P0-8-DB-UNIFY-REPORT.md` — per-table consolidation decisions

---

> **الخلاصة:** النظام بيعتمد على `stocks.db` كمصدر أساسي للأسعار والميتاداتا
> (مُغذًى من TradingView Scanner Live — 1,480 سهم في 3.3s)، و`predictions.db`
> كمخزن لمخرجات المحركات (33 جدول، 1,349 توقع نشط بعد التنظيف بـ `idx_predictions_dedup`).
> `price_history.db` معزول WAVE 1-3 وبيـ redirect شفاف لـ `stocks.db` عبر `_DB_ALIASES`.
> كل المؤشرات الفنية بـ تتحسب من `analyzers/indicators/` (Wilder's smoothing — Rule 67).
