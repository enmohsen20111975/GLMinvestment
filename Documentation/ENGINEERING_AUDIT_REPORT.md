# 🔍 التقرير الهندسي الشامل — Comprehensive Engineering Audit

> **التاريخ:** 2026-10-05
> **النطاق:** كل الـ codebase (vps-service Python + Next.js frontend + data_engine + news-agent)
> **المنهجية:** 3 parallel research-only agents فحصوا 10 فئات حسابات + 10 فئات أنظمة + مصادر بيانات + مكونات frontend
> **الهدف:** الإجابة على سؤال المالك: «هل في مكان واحد بس لكل حاجة، ولا في حسابات/أنظمة/مكونات متداخلة أو مكررة؟»

---

## 📊 الخلاصة التنفيذية (Executive Summary)

### الإجابة المختصرة على سؤال المالك:

| السؤال | الإجابة |
|--------|---------|
| هل في مكان واحد بس لكل حساب؟ | ❌ **لا** — كل حساب له 3-20+ نسخ مختلفة |
| هل في أنظمة متعددة لنفس المهمة؟ | ❌ **نعم** — 9+ محركات توقعات، 38 backtest runner، 4 RiskManager classes |
| هل مصادر البيانات متداخلة؟ | ❌ **نعم** — 8 جداول أسعار في 3 DBs، 5 جداول أخبار في 3 DBs |
| هل في مكونات مكررة بأشكال مختلفة؟ | ❌ **نعم** — 22 prediction card، 7 chart components، 6 image cards |
| هل بنكتب الكود كل مرة بشكل مختلف ولا بننده المكون؟ | ❌ **بنكتبه من الصفر** — ~190 ملف inline stat-card مع وجود shared component |

### الأرقام الكلية:

| المقياس | العدد |
|---------|------|
| فئات الحسابات بدون canonical | 10/10 |
| إجمالي مواقع الحسابات المكررة | ~150+ |
| محركات التوقعات (active + dormant) | 9+ |
| backtest runners | 38 (15 active + 23 archived) |
| ملفات telegram | 25 |
| TS DB modules | 21 |
| raw `sqlite3.connect` calls | 1,106 |
| API routes | 653 |
| مكونات prediction card | 22 |
| مكونات chart | 7 |
| مكونات ImageCard | 6 |

---

## 🟥 Part 1: تدقيق الحسابات (Calculation Logic Audit)

### ملخص الفئات العشر:

| # | الحساب | Canonical؟ | نسخ مكررة | الخطر |
|---|--------|-----------|-----------|------|
| 1 | ATR | ❌ لا | 12 نسخة | CRITICAL — Wilder vs SMA (5-15% فرق) |
| 2 | RSI | ❌ لا | 20 نسخة | CRITICAL — Wilder vs SMA (10-20 نقطة فرق) |
| 3 | Position Sizing | ❌ لا | 10+ نسخ | CRITICAL — risk% من 0.5% لـ 15% |
| 4 | R:R | ❌ partial (TS بس) | 11+ Python | HIGH — `Math.abs` bug في exit-status route |
| 5 | Stop/Target | ❌ لا | 15+ صيغ | CRITICAL — 1.5×ATR vs 2×ATR vs 8% flat |
| 6 | WR/PF | ❌ لا | 30+ نسخة | CRITICAL — fallback = 999 / 0 / 0.25 / infinity |
| 7 | master_score | ❌ لا | 3 صيغ | CRITICAL — V40.2 بيكتب tech_score كمان! |
| 8 | VWAP/Volume | ❌ لا | 15+ نسخة | HIGH — cumulative vs 20-period rolling |
| 9 | SMA/EMA/MACD | ❌ لا | 27+ نسخة | CRITICAL — `sma200` = `ema200` (مسمى غلط!) |
| 10 | Sector/Regime | ❌ partial | 8+ نسخ | HIGH — `load_sector_heat()` مختلف في V40.2 |

### تفاصيل الخطر الأكبر:

#### 1️⃣ RSI — أكبر خطر
- **11 نسخة Python + 4 نسخ TypeScript = 15 نسخة مختلفة**
- **Wilder's smoothing** (الصحيح): `avg_gain = (avg_gain × (period-1) + gain) / period`
- **SMA of last 14** (الغلط): `avg_gain = sum(gains[-14:])/14`
- **النتيجة:** RSI ممكن يختلف 10-20 نقطة بين admin cache و live chart لنفس السهم
- **المتأثرة:** `core_scoring_engine.py:43`, `v40_2_build_predictions.py:134`, `precomputed-cache.ts:335`, `admin/advanced-analysis/run/route.ts:207`, `advanced-analysis/scan-all/route.ts:295`

#### 2️⃣ Position Sizing — فوضى عارمة
- **ملفين بنفس الاسم `position_sizing.py` بصيغ مختلفة:**
  - `vps-service/utils/position_sizing.py` — risk-based: `position_value = (capital × risk_pct) / stop_distance_pct`
  - `vps-service/analyzers/position_sizing.py` — volatility-based: `position_size_mult` (0.55/1.0)
- **قيم risk% مختلفة:** 0.5%, 0.7%, 1.0%, 1.2%, 1.5%, 2.0%, 2.5%, 4.5%, 5%, 8%, 15%
- **نتيجة:** نفس السهم + نفس رأس المال + نفس الـ stop = 3× مختلفة في عدد الأسهم

#### 3️⃣ master_score — مكتوب بـ 3 صيغ مختلفة
- `master_analyzer.py:2258` — 10-component weighted sum (MASTER_WEIGHTS dict)
- `core_scoring_engine.py:1811` — 6-component weighted sum (config.weights dict)
- `daily_predictor.py:2355-2356` — `master_score = technical_score` (نفس القيمة في العمودين!)
- **النتيجة:** عمود `predictions.master_score` مش معناه واحد — BUY≥65 threshold مختلف حسب الـ generator

#### 4️⃣ Win Rate / Profit Factor — fallback مختلف
- `999.0` في `v38_backtest_engine.py:1990`, `stored_analysis_routes.py:1906`, `ExecutiveReportView.tsx:649`
- `999.99` في `backtest/page.tsx:319`
- `0.0` في `sniper_routes.py:1029`
- `0.25` في `live-tracking/route.ts:81` (bug موثّق)
- `float('inf')` في `optimized_backtest.py:154`

#### 5️⃣ Stop Loss — 6 صيغ مختلفة
- `entry - 1.5×ATR` (opportunity_quality.py:670)
- `entry - 2.0×ATR` (default persona)
- `entry - 2.5×ATR` (high-vol persona)
- `entry - 3.0×ATR` (production_backtest_tf.py:68)
- `entry × 0.92` (8% flat — portfolio_routes.py:430)
- `entry × 0.93` (7% flat — retroactive_radar_test.py:247)

### Bugs صريحة مؤكدة (مش بس duplication):
1. `src/app/api/market/exit-status/route.ts:73` — `Math.abs(target-entry)/Math.abs(entry-stop)` بيفشل في SELL setups
2. `v38_backtest_engine.py:1500-1501` — `calc_ema(closes, 200)` متسند لـ `sma200` (mislabeled)
3. `core_scoring_engine.py:43` — RSI يستخدم SMA بدل Wilder
4. `precomputed-cache.ts:414` — ATR يستخدم SMA بدل Wilder
5. `daily_predictor.py:2355-2356` — `master_score = technical_score` بيلغي الـ 10-component weighted sum

---

## 🟥 Part 2: تدقيق الأنظمة المكررة (Duplicate Systems Audit)

### 1. محركات التوقعات — أزمة هوية (Identity Crisis)

**3 مصادر بتختلف على مين المحرك النشط:**

| المصدر | بيقول إيه؟ |
|--------|-----------|
| `crontab.txt:3-4` (root) | "V40.2 هو العقل الوحيد — Maestro مات" |
| `vps-service/crontab.txt:20-25` | "Maestro هو المصدر الوحيد — V40.2 معطّل" |
| `background_analyzer.py:1379-1382` | "V40.2 هو العقل الوحيد — Maestro disabled (`return None`)" |

**9+ محركات لسه موجودة في الكود:**
1. `jobs/daily_predictor.py` (V40.2 — active حسب root crontab)
2. `analyzers/master_analyzer.py` (5,026 سطر — مستخدم بواسطة Maestro + chart_routes)
3. `analyzers/core_scoring_engine.py` (2,548 سطر — مستخدم بواسطة unified_v2_routes)
4. `analyzers/confluence_engine_v3.py` (1,211 سطر — مستخدم بواسطة confluence_routes)
5. `analyzers/sniper_engine.py` (2,049 سطر — بيدّعي إنه replacement للـ فوقه بس الأصلي لسه شغال)
6. `analyzers/v4_predictive_detector.py` (346 سطر)
7. `analyzers/v82_analyzer.py` (741 سطر)
8. `analyzers/v73_sniper.py` (220 سطر — A/B test)
9. `analyzers/v76_golden_hunter.py` (410 سطر — A/B test)
10. `analyzers/unified_analyzer.py` (3,736 سطر)
11. `analyzers/maestro_orchestrator.py` (4,365 سطر — "KILL-MAESTRO" comments)
12. `analyzers/fusion_engine.py` (724 سطر)
13. `engines/smart_confluence_engine.py` (742 سطر)
14. `glminvestment_engines/` (5 engines منفصلة)

**12 مسار كتابة مختلف لـ `predictions` table!**

### 2. Backtest Engines — 38 runner بدون shared framework

- **15 active + 23 archived**
- كل script بيـ reimplement walk-forward loop + indicator calc + P&L tracker
- مش موجود base class مشترك
- أمثلة: `backtest_full.py`, `backtest_unified_pipeline.py`, `backtest_momentum_uncap.py`, `backtest_with_risk_management.py`, `backtest_sniper.py`, `honest_backtest_egx.py`, `honest_backtest_regime.py`, `honest_backtest_trend.py`, `comprehensive_ab_backtest.py`, `production_backtest_tf.py`, `multi_target_backtest.py`, `v40_4_multi_market_backtest.py`, etc.

### 3. Telegram — 25 ملف Python + 2 senders متنافسين

- **`TelegramService`** (telegram_client.py) — Telethon (user account)
- **`TelegramNotifier`** (telegram_notifier.py) — HTTP Bot API
- الاتنين شغالين، مفيش توحيد
- `telegram/database.py` (414 سطر) DB layer منفصل عن `core/db_manager.py`

### 4. Database Access — فوضى كاملة

| النوع | العدد |
|------|------|
| TS DB modules | 21 |
| Python DB managers | 4 (database.py + db_manager.py + crypto_database.py + persona_db.py) |
| Telegram DB layer | 1 منفصل |
| Raw `sqlite3.connect` في Python | 669 occurrence في 250 ملف |
| Raw SQLite في TS | 437 occurrence في 215 ملف |
| SQLite engines مختلفة | 3 (better-sqlite3 + bun:sqlite + sql.js) |
| ORMs مختلفة | 2 (Prisma auth client + Prisma predictions client) |

### 5. API Routes — 653 route مع تكرار ضخم

- **35 prediction route** عبر **7 prefixes مختلفة:**
  - `/api/predictions/*`
  - `/api/admin/{ai-predictions, clean-predictions, generate-predictions, ...}/`
  - `/api/ai-predictions/`
  - `/api/analyst/predictions/`
  - `/api/cron/predictions/`
  - `/api/mobile/predictions/`
  - `/api/unified/predictions/`
  - `/api/real-predictions/`
  - `/api/global-predictions/`
  - `/api/crypto-predictions/`
  - `/api/crypto-lab/predictions/`

- **3 tracking systems متنافسة:**
  - `/api/predictions/honest-tracking/*` (7 routes)
  - `/api/predictions/tracking/*` (4 routes)
  - `/api/mobile/predictions/*` (3 routes)

- **20 health check endpoint!**

### 6. Caches — 7 modules متنافسة

| الملف | النوع | TTL |
|------|------|-----|
| `src/lib/api-cache.ts` | In-memory Map | 30s |
| `src/lib/cache/api-cache.ts` | **different** Map | 5min |
| `src/lib/cache/precomputed-cache.ts` | SQLite-persisted | 30min |
| `src/lib/radar-cache.ts` | File-based JSON | 15min |
| `vps-service/core/cache.py` | Singleton | 5min |
| `vps-service/core/cache_manager.py` | Different singleton | 60s |
| `vps-service/analyzers/quant_cache.py` | DB-persisted | 24h |

### 7. Scanners/Hunters — 12+ implementation

`screener.py`, `persona_screener.py`, `day_trading_scanner.py`, `v40_2_intraday_scanner.py`, `explosive_scanner.py`, `hunting_engine.py` (اللي بيقول صراحة "مبني جنب القديم")، `v4_predictive_detector.py`, `hot_stocks_detector.py`, `hot_candidate_detector.py`, `v76_golden_hunter.py`, `explosive_opportunity_hunter.py`, `volume_surge_hunter_test.py`, `rocket_detector_final.py`, `rocket_detector_tuned.py`, `rocket_detector_final_v2.py`, `sniper_engine.py`, `sniper_filter.py`, `v73_sniper.py` + 3 Flask blueprints منفصلة.

### 8. Risk Management — 4 RiskManager classes + 2 circuit_breaker

- `analyzers/risk.py` (280 سطر) — RiskAssessment dataclass
- `analyzers/risk_adaptive.py` (691 سطر) — AdaptiveRiskManager
- `analyzers/risk_manager.py` (690 سطر) — PositionSizingResult
- `risk_management_advanced.py` (1,866 سطر)
- `dynamic_risk_engine.py` (592 سطر)
- `core/circuit_breaker.py` (631 سطر) — **data source** circuit breaker
- `utils/circuit_breaker.py` (181 سطر) — **trading** circuit breaker (نفس الاسم، غرض مختلف!)
- `portfolio/*.py` — 8 ملفات إضافية (hard_protection, multi_target_exit, portfolio_heat, position_manager, smart_exit_engine, stop_manager, trade_journal, strategies)

---

## 🟥 Part 3: تدقيق مصادر البيانات (Data Sources Audit)

### 1. مصادر الأسعار — 8 جداول في 3 DBs

| # | الجدول | الـ DB | الاستخدام |
|---|--------|--------|---------|
| 1 | `stock_daily_prices` | stocks.db | Daily candles |
| 2 | `egksco_price_history` | data_engine.db | 162K rows |
| 3 | `price_history` | price_history.db | 1.24M rows (25 سنة) |
| 4 | `yahoo_clean` | price_history.db | Clean Yahoo history |
| 5 | `egksco_stocks.last_price` | data_engine.db + stocks.db (mirror) | Live quote cache |
| 6 | `stocks.current_price` | stocks.db | ملوّث (COMI=140 vs 20 issue) |
| 7 | `stock_intraday` | intraday.db | 5-min tick data |
| 8 | `intraday_prices` | intraday.db | Bid/ask spread |
| 9 | `historical_data` | data_engine.db | Numeric-ticker format (KSA) |

**130 ملف في vps-service بـ bypass الـ canonical readers ويعملوا raw SQL على الجداول دي.**

### 2. مصادر الأخبار — 5 جداول في 3 DBs + تعارض canonical

| المصدر | بيقول إيه؟ |
|--------|-----------|
| Constitution Rule 44 | `db/news.db/market_news` هو canonical |
| `db_paths.py:112` | `NEWS_DB = CONTENT_DB = content.db` (مش موجود!) |
| `api/news_routes.py` | بينشئ `stocks.db.news` + `news.db.news_agent_articles` + بيقرأ `news.db/market_news` |
| `predictions.db/news_signals` | جدول رابع |

### 3. EGXPilot — declared dead لأسعار بس لسه canonical للأساسيات!

- `fallback_chain.py:140-149` بيقول "EGXPilot deprecated in Phase 1 (dead source)"
- بس `egx_fundamental_fetcher.py:58-61` لسه بيستخدم `egxpilot.com/api/stocks/all` كـ **primary fundamental fetcher** لكل `tab_valuation`, `tab_profitability`, `tab_balance_sheet`!
- يعني الأساسيات ممكن تكون بتوقفت تحديث من غير ما حد يلاحظ

### 4. Ticker Mapping — 6 أنظمة منفصلة

1. `egx_ticker_sector_map.py` (Python dict)
2. `egx_official_sectors.py` (Python dict)
3. `stock-names.ts` (875 سطر TS dict — frontend mirror)
4. `stocks.db.stocks` table (DB)
5. `directMap` hardcoded في `chart/[ticker]/route.ts:27-32`
6. Ticker aliases في `data/prices.py:207-220`

**النتيجة:** frontend ممكن يعرض sector "Financials" و backend يعرض "بنوك" لنفس السهم.

### 5. Sector Classification — 4 أنظمة

1. EGKSCO official (HTML scrape)
2. `egx_official_sectors.py` (hardcoded mirror)
3. TradingView sector field (English)
4. `stock-names.ts` (English labels)
5. `chain-reaction-engine.ts:33-38` (manual Arabic hardcoded)

### 6. Intraday — جدولين بـ schemas مختلفة في نفس الـ DB

- `stock_intraday(ticker, market, timestamp, price, volume, high, low)` — OHLCV
- `intraday_prices(ticker, bid, ask, price_time)` — bid/ask only

### 7. Macro — تعارض db_paths.py

- `fetch_inflation_worldbank.py:6` بيكتب في `stocks.db.macro_indicators`
- `db_paths.py:147` بيقول `macro_indicators` في `MARKET_DB` (= `market.db` فاضي!)

---

## 🟥 Part 4: تدقيق مكونات الـ Frontend

### 1. Prediction Cards — 22 مكون بدون shared primitive!

كل ملف بيعرّف TS interface خاص بيه لنفس الشكل (entry_price, target_price, stop_loss):

| # | المكون | الموقع |
|---|--------|--------|
| 1 | `AiRecommendations.tsx` | recommendations/ |
| 2 | `PublishedPredictions.tsx` | recommendations/ |
| 3 | `RecommendationHistory.tsx` | recommendations/ |
| 4 | `RecommendationMonitoring.tsx` | recommendations/ |
| 5 | `SocialPostView.tsx` | recommendations/ |
| 6 | `PredictionTrackingView.tsx` | predictions/ |
| 7 | `DualTrackPredictionsView.tsx` | predictions/ |
| 8 | `PredictionTrackingDashboard.tsx` | predictions/ |
| 9 | `MakerRadarTab.tsx` | predictions/ (مع inline math) |
| 10 | `PicksManagementView.tsx` | predictions/ |
| 11 | `CryptoPredictionTrackingView.tsx` | crypto/ |
| 12 | `PredictionsImageCard.tsx` | market/ (PNG export) |
| 13 | `ExpertPredictionsImageCard.tsx` | market/ (PNG export) |
| 14 | `PredictionsTab.tsx` | analysis/market-analysis/ |
| 15 | `ExpertPredictionsTab.tsx` | analysis/market-analysis/ |
| 16 | `CryptoPredictionsTab.tsx` | analysis/market-analysis/ |
| 17 | `EidPredictionsWidget.tsx` | components/ |
| 18 | `AutoAnalysisWidget.tsx` | components/ |
| 19 | `OpportunityCard.tsx` | sniper/ |
| 20 | `V82DecisionPanel.tsx` | v82/ |
| 21 | `DeepAnalysis.tsx` | stocks/ |
| 22 | `PredictionsBacktestTable.tsx` | dashboard/ |

### 2. Chart Components — 7 مكونات (3,813 LOC مكررة)

| المكون | LOC | المكتبة |
|--------|-----|---------|
| `TradingViewChart.tsx` | 1,821 | lightweight-charts |
| `InteractiveChart.tsx` | 1,677 | lightweight-charts |
| `TradingChartView.tsx` | 315 | wrapper |
| `CryptoTradingChartView.tsx` | 275 | lightweight-charts (crypto) |
| `ChartCard.tsx` | ? | screener |
| `ComparisonChartCard.tsx` | ? | screener |
| `admin/live-chart/index.tsx` | ? | admin |

### 3. ImageCard Components — 6 مكونات (3,162 LOC مكررة)

كلهم بـ يعيدوا كتابة نفس الـ `forwardRef + html-to-image + Card layout` boilerplate:

| المكون | LOC |
|--------|-----|
| `MarketStatusImageCard.tsx` | 766 |
| `PersonaImageCard.tsx` | 603 |
| `ExpertPredictionsImageCard.tsx` | 525 |
| `PredictionsImageCard.tsx` | 434 |
| `StockLeagueImageCard.tsx` | 326 |
| `TopTradesImageCard.tsx` | 208 |
| (shared wrapper) `ImageCardExport.tsx` | 228 |

### 4. Reusable Patterns غير مستخدمة

| النمط | Shared component موجود؟ | استخدام | inline duplicates |
|-------|------------------------|---------|-------------------|
| Stat card | `ui/stat-card.tsx` (مبني عشان يقتل 10 نسخ) | 11 ملف فقط | ~190 ملف (1,289 occurrence) |
| Loading spinner | `shared/LazyInlineLoader` | 1 ملف فقط | 67 ملف (174 occurrence) |
| Stock search dropdown | `shared/StockSearchSelector.tsx` | قليل | 2 نسخ إضافية (582 LOC) |
| ImageCard → PNG | `market/ImageCardExport.tsx` | قليل | 6 ImageCards (3,162 LOC) |

### 5. مكونات admin مكررة

| الزوج | المشكلة |
|-------|---------|
| `UsersManagement.tsx` (1,086) + `UserManagementPanel.tsx` (599) | نفس الغرض، اسم شبه متطابق |
| `admin/WealthCharts.tsx` (465) + `portfolio/WealthCharts.tsx` (346) | نفس الكود في مكانين |
| `EnhancedWatchlistView.tsx` (1,244) + `ProfessionalWatchlistView.tsx` (472) | نفس الـ UX |
| `EnhancedPortfolioView.tsx` (3,106) + `AdvancedPortfolioManager.tsx` (578) | نفس الغرض |
| `share/ShareButton.tsx` + `shared/ShareButton.tsx` | ملفين بنفس الاسم |
| `StockSearchDropdown.tsx` (122) + `StockSelector.tsx` (460) + `shared/StockSearchSelector.tsx` | 3 نسخ |

### 6. Admin tabs — 26 tab (مفروض 10)

6 hubs فيها 26 tab كمان. أمثلة على التكرار:
- `BacktestTab` + `SuperLearningSystem` + `EngineSettingsTab` + `EnginesStatusTab` + `SystemControlPanel` + `SystemMonitorPanel` + `SystemProblemsTab` — 7 "system/monitoring" panels
- `GoldSilverTab` + `ForexTab` + `MultiMarketTab` — ممكن يندمجوا في "Markets" tab واحد

---

## 🎯 TOP 5 مشاكل حرجة (Ranked)

### 🥇 #1 — أزمة هوية محرك التوقعات
3 مصادر بتختلف على مين المحرك النشط. root crontab بيقول V40.2، vps-service crontab بيقول Maestro، `background_analyzer.py` بيقول V40.2 بس. **ده أعلى خطر في الـ codebase كله.**

### 🥈 #2 — RSI/ATR formula divergence
Wilder vs SMA produces 10-20% different values لنفس السهم في صفحات مختلفة. admin cache بيشوف RSI مختلف عن live chart.

### 🥉 #3 — `master_score` مكتوب بـ 3 صيغ مختلفة
V40.2 بـ يكتب `master_score = technical_score` (نفس القيمة في العمودين!) — بيكسد الـ 10-component weighted sum اللي `master_analyzer.py` بيعمله. الـ BUY/HOLD/SELL thresholds بقت بلا معنى.

### 🏅 #4 — 1,106 raw `sqlite3.connect` calls
Rule 32 (Node=display only) موثّقة بس مش enforced. 130 ملف vps-service بـ bypass الـ canonical readers ويعملوا raw SQL على 8 جداول أسعار مختلفة.

### 🎖️ #5 — 22 prediction card بدون shared primitive
كل view بـ يعرف TS interface خاص بيه لنفس الشكل. مفيش `<PredictionCard>` مشترك. 3,813 LOC من duplicate chart logic + 3,162 LOC من duplicate ImageCard boilerplate.

---

## 🛠️ خطة العمل المقترحة (5 Phases)

### Phase 1: إعلان canonical (Documentation فقط — 1 يوم)
- اعمل `config/ACTIVE_ENGINE.md` فيه قرار رسمي: V40.2 هو المحرك الوحيد
- امسح `vps-service/crontab.txt` المتناقض
- أعلن canonical formulas في `00-CONSTITUTION.md` (Rule 67):
  - ATR = Wilder's smoothing
  - RSI = Wilder's smoothing
  - Position sizing = risk-based من `utils/position_sizing.py`
  - Stop = `entry - stop_atr_mult × ATR` (من engine_settings)
  - PF fallback = 999.0 (TradingView convention)
  - master_score = 10-component weighted (MASTER_WEIGHTS)
  - VWAP = rolling 20-period
  - SMA200 = sum/200 (مش EMA!)

### Phase 2: بناء shared calculation libs (3-5 أيام)
- `vps-service/analyzers/indicators/atr.py` — Wilder's smoothing
- `vps-service/analyzers/indicators/rsi.py` — Wilder's smoothing
- `vps-service/analyzers/indicators/ma.py` — `sma()`, `ema()`, `macd()`
- `vps-service/utils/risk_reward.py` — `compute_risk_reward()`
- `vps-service/utils/backtest_stats.py` — `compute_win_rate()`, `compute_profit_factor()`
- امسح الـ 150+ inline copies وادي الـ canonical

### Phase 3: توحيد DB access (5-7 أيام)
- ادمج 21 TS DB modules في `src/lib/db/index.ts` واحد (better-sqlite3 + Prisma)
- هاجر 1,106 raw `sqlite3.connect` لـ `core/db_manager.py`
- ادمج `telegram/database.py` في `core/db_manager.py`
- صلّح `db_paths.py`NEWS_DB` لـ `news.db` (احذف `content.db`)
- ادمج `stock_intraday` + `intraday_prices` في schema واحد

### Phase 4: توحيد الـ Frontend (5-7 أيام)
- `shared/PredictionCard.tsx` — لـ 22 مكون
- `shared/CandlestickChart.tsx` — لـ 7 chart components
- `shared/ShareableImageCard.tsx` — لـ 6 ImageCards
- enforce `StatCard` usage في CI (grep rule)
- ادمج `UsersManagement` + `UserManagementPanel`
- احذف `ProfessionalWatchlistView` (orphan)
- ادمج `admin/WealthCharts` + `portfolio/WealthCharts`

### Phase 5: أرشفة + تنظيف (2-3 أيام)
- ارشيف 8 محركات توقعات غير نشطة لـ `_archived/engines/`
- احذف 23 archived backtest (موجودة في `scripts/_archived/`)
- ادمج 26 admin tab لـ 10
- ادمج 35 prediction route لـ prefix واحد
- احذف 5 من 7 health endpoints

---

## 📋 مقترحات التوحيد (Canonical Recommendations)

| # | الفئة | الـ canonical المقترح |
|---|------|---------------------|
| 1 | ATR | `vps-service/analyzers/technical_analyzer.py:206` (Wilder) |
| 2 | RSI | `vps-service/analyzers/technical_analyzer.py:81` (Wilder) |
| 3 | Position sizing | `vps-service/utils/position_sizing.py:65` (risk-based) |
| 4 | R:R | `src/lib/risk-reward.ts:27` (TS) + NEW `vps-service/utils/risk_reward.py` (Python) |
| 5 | Stop/Target | `vps-service/core/opportunity_quality.py:543` + engine_settings.stop_atr_mult |
| 6 | WR/PF | NEW `vps-service/utils/backtest_stats.py` (fallback=999.0, 2dp) |
| 7 | master_score | `master_analyzer.py:2258` (MASTER_WEIGHTS — 10-component) |
| 8 | VWAP/OBV | `technical_analyzer.py:226,238` (rolling 20-period) |
| 9 | SMA/EMA/MACD | NEW `vps-service/analyzers/indicators/ma.py` |
| 10 | Sector heat | `core/opportunity_quality.py:1717 compute_sector_heat_map()` |
| 11 | Market regime | `analyzers/technical_analyzer.py:260 detect_regime()` |
| 12 | Price reader (live) | `utils/live_price.py:get_live_price()` |
| 13 | Price reader (history) | `data/prices.py:load_price_history()` |
| 14 | News | `db/news.db/market_news` (Rule 44) |
| 15 | Prediction engine | `jobs/daily_predictor.py` (V40.2 — declared in root crontab) |
| 16 | DB access (Python) | `core/db_manager.py` |
| 17 | DB access (TS) | NEW `src/lib/db/index.ts` (better-sqlite3 + Prisma) |
| 18 | Cache (TS) | `src/lib/cache/api-cache.ts` (احذف `api-cache.ts`) |
| 19 | Cache (Python) | `core/cache.py` (احذف `cache_manager.py`) |
| 20 | Telegram sender | `TelegramService` (telethon) — احذف `TelegramNotifier` |
| 21 | Prediction card UI | NEW `shared/PredictionCard.tsx` |
| 22 | Chart UI | NEW `shared/CandlestickChart.tsx` |
| 23 | ImageCard UI | NEW `shared/ShareableImageCard.tsx` |
| 24 | Stat card UI | `ui/stat-card.tsx` (موجود — enforce usage) |
| 25 | Loading spinner | `shared/LazyInlineLoader` (موجود — enforce usage) |

---

## 📌 الخلاصة للمالك

**الوضع الحالي:** المشروع فيه ثروة هائلة من المحركات والمكونات، بس **مفيش توحيد**. كل حساب ليه 3-20 نسخة، كل نظام ليه 2-12 منافس، كل مكون frontend ليه 6-22 متطابق.

**الخطر الأكبر:** مش بس duplication — ده **correctness bugs** مؤكدة:
- RSI Wilder vs SMA → صفحات مختلفة بتعرض قيم مختلفة
- master_score بيتكتب بـ 3 صيغ → thresholds بقت بلا معنى
- 1,106 raw SQLite bypass → canonical readers bypassed
- EGXPilot declared dead لأسعار بس لسه canonical لأساسيات

**التوصية:** ابدأ بـ **Phase 1 (documentation فقط)** — أعلن القرارات في CONSTITUTION، بعدين ابدأ Phase 2 (shared libs) بشكل تدريجي. مش لازم تعمل الـ 5 phases مرة واحدة — كل phase مستقلة.

---

*تم الإنشاء بواسطة Comprehensive Engineering Audit — 2026-10-05 — 3 parallel research agents (AUDIT-1 + AUDIT-2 + AUDIT-3)*
