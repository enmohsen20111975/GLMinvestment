# 🩻 AUDIT_BACKEND_APIS_MAP.md
## الجرد التشريعي الكامل للباك إند وقواعد البيانات (Backend X-Ray Audit)

> **تاريخ الجرد:** 2026-10-13
> **المكلف:** كبير مهندسي الواجهات (Team Alpha — Backend X-Ray)
> **النطاق:** مسح شامل لـ Python backend + 10 قواعد بيانات + Jobs/Scripts + Next.js SQLite cross-reference
> **المحظور:** لم يتم تعديل سطر كود واحد في Python أو حذف أي جدول — هذا تقرير توثيقي فقط (Read-Only Audit)
> **التكملة الطبيعية:** هذا التقرير يكمل `AUDIT_FRONTEND_SCREENS_MAP.md` لنحصل على **«الأشعة السينية الكاملة للمنصة»**

---

## 📋 جدول المحتويات

1. [الملخص التنفيذي](#1-الملخص-التنفيذي)
2. [الجدول التفصيلي الرئيسي (6 أعمدة)](#2-الجدول-التفصيلي-الرئيسي-6-أعمدة)
3. [تحليل الجداول المشبوهة والمكررة](#3-تحليل-الجداول-المشبوهة-والمكررة)
4. [السكربتات الدورية المسؤولة عن كل جدول](#4-السكربتات-الدورية-المسؤولة-عن-كل-جدول)
5. [الجداول الميتة/المهجورة (Dead Tables)](#5-الجداول-الميتةالمهجورة-dead-tables)
6. [خريطة مسارات بايثون الشاملة](#6-خريطة-مسارات-بايثون-الشاملة)
7. [التوصيات والإصلاحات المقترحة](#7-التوصيات-والإصلاحات-المقترحة)

---

## 1. الملخص التنفيذي

| المقياس | القيمة |
|---------|--------|
| **Python endpoints** | ~503 (42 Flask direct + 452 Blueprint + 9 FastAPI) |
| **DBs المفحوصة** | 16 (8 مطلوبة موجودة + 2 غائبة lazy + 6 bonus) |
| **DB تالف** | 1 (`price_history.db` — SQLITE_CORRUPT "database disk image is malformed") |
| **DBs مهجورة بالكامل** | 1 (`crypto.db` — كل 5 tables فارغة) |
| **إجمالي الجداول المفحوصة** | 168 (عبر 8 DBs قابلة للقراءة) |
| **جداول حية (Active)** | 105 |
| **جداول ميتة (Dead/Empty)** | 63 |
| **سكربتات دورية (cron)** | 26 مدخل في `crontab.txt` |
| **محركات كتابة رئيسية** | 7 |
| **مسارات Next.js تقرأ SQLite** | 276-335 |
| **نقاط تضارب كتابة** | 10 جداول |
| **أخطر تضارب** | `predictions.db.predictions` (Next.js DELETE FROM + 22 Python writers) |
| **مخالفة Rule 27** | `GateAnalysisView` (price-derived defaults — موثقة في Frontend audit) |

---

## 2. الجدول التفصيلي الرئيسي (6 أعمدة)

> الصفوف الفعلية تم جمعها عبر `better-sqlite3` readonly mode من `/tmp/my-project/db/*.db`.
> الجداول الميتة = 0 صفوف. الجداول الحية = > 0 صفوف.

### 2.1 مسارات التوقعات (Predictions Endpoints)

| مسار الـ Endpoint وطريقة الـ HTTP | ملف البايثون واسم الدالة | قاعدة البيانات | اسم الجدول | عدد الصفوف | الحالة |
|---|---|---|---|---|---|
| `GET /api/v2/predictions` | `vps-service/api/v2_routes.py` (`get_predictions_v2`) | `db/predictions.db` | `predictions` | 1,551 | ✅ حي (Active — canonical V40.2) |
| `GET /api/ai/predictions` | `vps-service/api/ai_predictions_routes.py` (`get_ai_predictions`) | `db/predictions.db` | `aiPrediction` | 2,613 | ⚠️ حي لكنه **legacy** (مشروع الإيقاف) |
| `GET /api/ai/predictions/stats` | `vps-service/api/ai_predictions_routes.py` (`get_ai_predictions_stats`) | `db/predictions.db` | `aiPrediction` + `aiPredictionStats` | 2,613 + 1 | ⚠️ حي لكنه **legacy** |
| `POST /api/ai/predictions/generate` | `vps-service/api/ai_predictions_routes.py` (`generate_ai_predictions`) | `db/predictions.db` | `aiPrediction` (INSERT) | 2,613 | ⚠️ يكتب في legacy table |
| `GET /api/persona/investor` | `vps-service/api/persona_routes.py` (`get_investor_persona`) | `db/predictions.db` | `persona_predictions` | 1,669 | ✅ حي (Active) |
| `GET /api/persona/gambler` | `vps-service/api/persona_routes.py` (`get_gambler_persona`) | `db/predictions.db` | `persona_predictions` | 1,669 | ✅ حي (Active) |
| `GET /api/persona/compare` | `vps-service/api/persona_routes.py` (`compare_personas`) | `db/predictions.db` | `persona_predictions` | 1,669 | ✅ حي (Active) |
| `GET /api/stored-analysis/live-tracking` | `vps-service/api/stored_analysis_routes.py` (`live_tracking`) | `db/predictions.db` | `stored_analyses` | 13 | ✅ حي (SINGLE-WRITER: daily_predictor.py فقط — Rule 73) |
| `POST /api/predictions/tracking/save` | `vps-service/api/prediction_tracking_routes.py` (`save_tracking`) | `db/predictions.db` | `predictions` (INSERT) | 1,551 | ✅ حي (Active) |
| `GET /api/predictions/tracking/list` | `vps-service/api/prediction_tracking_routes.py` (`list_tracking`) | `db/predictions.db` | `predictions` | 1,551 | ✅ حي (Active) |
| `POST /api/predictions/tracking/verify` | `vps-service/api/prediction_tracking_routes.py` (`verify_tracking`) | `db/predictions.db` | `predictions` (UPDATE) | 1,551 | ✅ حي (Active) |
| `GET /api/predictions/tracking/stats` | `vps-service/api/prediction_tracking_routes.py` (`tracking_stats`) | `db/predictions.db` | `predictions` | 1,551 | ✅ حي (Active) |
| `GET /api/confluence/generate-predictions` | `vps-service/api/confluence_routes.py` (`generate_predictions`) | `db/predictions.db` | `aiPrediction` (INSERT) | 2,613 | ⚠️ يكتب في legacy table |
| `GET /api/historical-predictions-v2` | `vps-service/api/historical_predictions_v2_routes.py` | `db/predictions.db` | `historical_trades` | 22,292 | ✅ حي (Active) |
| `GET /api/predictions/honest-tracking/list` | Next.js SQLite direct (no Python) | `db/predictions.db` | `predictions` | 1,551 | ✅ حي (Active — Next.js bypass) |
| `GET /api/predictions/honest-tracking/live-tracking` | Next.js SQLite direct (no Python) | `db/predictions.db` | `predictions` | 1,551 | ✅ حي (Active — Next.js bypass) |
| `GET /api/exit-notifications` | `vps-service/api/stored_analysis_routes.py` | `db/predictions.db` | `exit_notifications` | 3,939 | ✅ حي (Active) |
| `GET /api/learned-lessons` | `vps-service/api/learning_routes.py` | `db/predictions.db` | `learned_lessons` | 19,636 | ✅ حي (Active) |
| `GET /api/morning-bell/signals` | `vps-service/api/stored_analysis_routes.py` (market_bp) | `db/predictions.db` | `morning_bell_signals` | 82 | ✅ حي (Active) |
| `GET /api/optimizer/params` | `vps-service/api/optimizer_params_routes.py` | `db/predictions.db` | `optimizer_params_history` | 18 | ✅ حي (Active) |
| `GET /api/sniper/performance` | `vps-service/api/sniper_routes.py` | `db/predictions.db` | `sniper_performance` | 30 | ✅ حي (Active) |
| `GET /api/hunter/tracking` | `vps-service/api/sniper_routes.py` | `db/predictions.db` | `hunter_pick_tracking` | 8 | ✅ حي (Active) |
| `GET /api/liquidity/signal-outcomes` | `vps-service/api/` (FlowSystemEngine) | `db/predictions.db` | `liquidity_signal_outcomes` | 1,308 | ✅ حي (Active) |
| `GET /api/liquidity/backtest-results` | `vps-service/api/` | `db/predictions.db` | `liquidity_backtest_results` | 10 | ✅ حي (Active) |
| `GET /api/live-ai/signals` | `vps-service/api/ai_routes.py` | `db/predictions.db` | `live_ai_signals` | 1,636 | ✅ حي (Active) |
| `GET /api/stock-stories` | `vps-service/api/notebook_routes.py` | `db/predictions.db` | `stock_stories` | 1,245 | ✅ حي (Active) |
| `GET /api/reports/daily` | `vps-service/api/reports_routes.py` | `db/predictions.db` | `reports` | 6 | ✅ حي (Active) |
| `GET /api/crypto/predictions-log` | `vps-service/api/` (CryptoEngine) | `db/predictions.db` | `crypto_predictions_log` | 180,269 | ✅ حي (Active) |
| `GET /api/corporate-actions` | `vps-service/api/` | `db/predictions.db` | `corporate_actions` | 118 | ✅ حي (Active) |
| `GET /api/prediction-lessons` | `vps-service/api/` | `db/predictions.db` | `prediction_lessons` | 4 | ✅ حي (Active) |
| `GET /api/quant/cache` | `vps-service/api/` | `db/predictions.db` | `quant_cache` | 531 | ✅ حي (Active) |
| `GET /api/expert-recommendations` | `vps-service/api/` | `db/predictions.db` | `ExpertRecommendation` | 17 | ✅ حي (Active) |

### 2.2 مسارات الأسعار والشموع (Chart & History Endpoints)

| مسار الـ Endpoint وطريقة الـ HTTP | ملف البايثون واسم الدالة | قاعدة البيانات | اسم الجدول | عدد الصفوف | الحالة |
|---|---|---|---|---|---|
| `GET /api/chart/<ticker>` | `vps-service/api/chart_routes.py` (`get_chart_data`) | `db/stocks.db` | `stock_daily_prices` | 100,619 | ✅ حي (Active — canonical OHLCV) |
| `GET /api/chart/full-analysis` | `vps-service/api/chart_routes.py` (`get_full_analysis`) | `db/stocks.db` + `db/data_engine.db` | `stock_daily_prices` + `tab_*` | 100,619 | ✅ حي (Active) |
| `GET /api/chart/stats/intraday` | `vps-service/api/chart_routes.py` | `db/intraday.db` | `stock_intraday` | **0** | 🔴 **ميت** (Empty — never written) |
| `POST /api/chart/collect/now` | `vps-service/api/chart_routes.py` | `db/price_history.db` | `price_history` | **CORRUPT** | 🔴 **DB تالف** (SQLITE_CORRUPT) |
| `GET /api/stocks/<ticker>/history` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stock_daily_prices` | 100,619 | ✅ حي (Active) |
| `GET /api/stocks/prices` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stocks` | 1,240 | ✅ حي (Active) |
| `GET /api/stocks/indicators` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stocks` + `stock_daily_prices` | 1,240 + 100,619 | ✅ حي (Active) |
| `GET /api/stocks/patterns` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stock_daily_prices` | 100,619 | ✅ حي (Active) |
| `GET /api/stocks/fibonacci` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stock_daily_prices` | 100,619 | ✅ حي (Active) |
| `GET /api/data-engine/stocks` | `data_engine/main.py` | `db/data_engine.db` | `stocks` + `stock_prices` | 2,205 + 2,493 | ✅ حي (Active) |
| `GET /api/data-engine/gold` | `data_engine/main.py` | `db/data_engine.db` | `gold_prices` | 129,251 | ✅ حي (Active) |
| `GET /api/data-engine/crypto` | `data_engine/main.py` | `db/data_engine.db` | `crypto_prices` | 128,040 | ✅ حي (Active) |
| `GET /api/data-engine/exchange-rates` | `data_engine/main.py` | `db/data_engine.db` | `exchange_rates` | 21,490 | ✅ حي (Active) |
| `GET /api/intraday/stock` | `data_engine/intraday_storage.py` | `db/intraday.db` | `stock_intraday` | **0** | 🔴 **ميت** (Empty — never written) |
| `GET /api/intraday/crypto` | `data_engine/intraday_storage.py` | `db/intraday.db` | `crypto_intraday` | 632,233 | ✅ حي (Active) |
| `GET /api/intraday/commodity` | `data_engine/intraday_storage.py` | `db/intraday.db` | `commodity_intraday` | 75,659 | ✅ حي (Active) |
| `GET /api/stocks/top-performers` | `vps-service/api/top_performers_routes.py` | `db/data_engine.db` | `egksco_price_history` | **0** | 🔴 **ميت** (Empty — use data_engine instead) |

### 2.3 مسارات رادار السيولة وصانع السوق (Radar & Maker Endpoints)

| مسار الـ Endpoint وطريقة الـ HTTP | ملف البايثون واسم الدالة | قاعدة البيانات | اسم الجدول | عدد الصفوف | الحالة |
|---|---|---|---|---|---|
| `GET /api/maker-radar` | `scripts/maker_radar.py` (via lightweight_server) | `db/stocks.db` | `radar_signal_tracking` | 1,102 | ✅ حي (Active — CREATE+DELETE+INSERT كل 5 دقائق) |
| `GET /api/maker-radar/multi-market` | `scripts/maker_radar.py` | `db/stocks.db` | `radar_signal_tracking` | 1,102 | ✅ حي (Active) |
| `GET /api/maker-radar/stock` | `scripts/maker_radar.py` | `db/stocks.db` | `radar_signal_tracking` | 1,102 | ✅ حي (Active) |
| `GET /api/maker-radar/signal-tracker` | Next.js SQLite direct | `db/stocks.db` | `radar_signal_tracking` | 1,102 | ✅ حي (Active) |
| `POST /api/maker-radar/signal-tracker/verify` | Next.js SQLite direct + `scripts/verify_radar_signals.py` | `db/stocks.db` | `radar_signal_tracking` (UPDATE) | 1,102 | ✅ حي (Active — 3-way conflict) |
| `POST /api/maker-radar/track` | Next.js SQLite direct | `db/stocks.db` | `radar_signal_tracking` (UPDATE) | 1,102 | ✅ حي (Active) |
| `POST /api/maker-radar/warmup` | `scripts/maker_radar.py` | `db/stocks.db` | `radar_signal_tracking` | 1,102 | ✅ حي (Active) |
| `GET /api/maker-radar/sector-treemap` | `vps-service/api/` (FlowSystemEngine) | `db/stocks.db` | `stocks` + `radar_signal_tracking` | 1,240 + 1,102 | ✅ حي (Active) |
| `GET /api/maker-radar/entry-timing` | `vps-service/api/` | `db/stocks.db` | `stocks` + `stock_daily_prices` | 1,240 + 100,619 | ✅ حي (Active) |
| `GET /api/maker-radar/market-intelligence` | `vps-service/api/` | `db/stocks.db` | `stocks` | 1,240 | ✅ حي (Active) |
| `GET /api/flow/<ticker>` | `vps-service/lightweight_server.py` (FlowSystemEngine) | `db/stocks.db` (computed) | `stock_daily_prices` (read-only) | 100,619 | ✅ حي (Active — compute_money_flow) |
| `GET /api/explosive/<ticker>` | `vps-service/lightweight_server.py` (ExplosiveScanner) | `db/stocks.db` | `stocks` + `stock_daily_prices` | 1,240 + 100,619 | ✅ حي (Active) |
| `GET /api/stocks/delta-volume` | Next.js SQLite direct | `db/stocks.db` | `stock_daily_prices` | 100,619 | ✅ حي (Active) |
| `GET /api/market/intraday-pressure` | `vps-service/api/` | `db/intraday.db` | `stock_intraday` | **0** | 🔴 **ميت** (Empty — EGX intraday never written) |
| `GET /api/market/liquidity-flow` | `vps-service/api/` (FlowSystemEngine) | `db/stocks.db` | `stocks` + `stock_daily_prices` | 1,240 + 100,619 | ✅ حي (Active) |
| `GET /api/screener/advanced` | `vps-service/api/advanced_screener_routes.py` | `db/stocks.db` | `stocks` + `screener_presets` + `screener_results` | 1,240 + 2,175 + 173 | ✅ حي (Active) |
| `GET /api/screener/presets` | `vps-service/api/screener_routes.py` | `db/stocks.db` | `screener_presets` | 2,175 | ✅ حي (Active) |
| `GET /api/screener/scan` | `vps-service/api/screener_routes.py` | `db/stocks.db` | `stocks` | 1,240 | ✅ حي (Active) |
| `GET /api/sectors/tracking` | `vps-service/api/sector_tracking_routes.py` | `db/stocks.db` | `stocks` | 1,240 | ✅ حي (Active) |

### 2.4 مسارات مؤشرات السوق (Pulse & Regime Endpoints)

| مسار الـ Endpoint وطريقة الـ HTTP | ملف البايثون واسم الدالة | قاعدة البيانات | اسم الجدول | عدد الصفوف | الحالة |
|---|---|---|---|---|---|
| `GET /api/market-pulse` | `vps-service/lightweight_server.py` (`market_pulse`) | `db/stocks.db` | `market_pulse_cache` + `market_indices` + `stocks` | 5,405 + 5 + 1,240 | ✅ حي (Active — minute-level cache) |
| `GET /api/live-monitor` | `vps-service/lightweight_server.py` (`live_monitor`) | `db/stocks.db` | `stocks` + `portfolio_assets` | 1,240 + 26 | ✅ حي (Active) |
| `GET /api/market/regime` | `vps-service/api/regime_routes.py` | `db/stocks.db` | `system_settings` + `market_regime_log` | 6 + 46 | ✅ حي (Active — INSERT OR REPLACE) |
| `GET /api/market/regime/stock/<ticker>` | `vps-service/api/regime_routes.py` | `db/stocks.db` | `stocks` + `system_settings` | 1,240 + 6 | ✅ حي (Active) |
| `GET /api/market/regime/overview` | `vps-service/api/regime_routes.py` | `db/stocks.db` + `db/data_engine.db` | `system_settings` + `market_regime_log` | 6 + 46 | ✅ حي (Active) |
| `GET /api/market/indices` | `vps-service/api/public_routes.py` | `db/stocks.db` | `market_indices` | 5 | ✅ حي (Active — EGX30/70/100/50/33) |
| `GET /api/market/overview` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stocks` + `market_indices` | 1,240 + 5 | ✅ حي (Active) |
| `GET /api/market/sync` | `vps-service/api/public_routes.py` | `db/stocks.db` | `stocks` (UPDATE) | 1,240 | ✅ حي (Active) |
| `GET /api/maestro/status` | `vps-service/api/maestro_routes.py` | `db/stocks.db` | `system_settings` | 6 | ✅ حي (Active) |
| `GET /api/maestro/regime` | `vps-service/api/maestro_routes.py` | `db/stocks.db` | `system_settings` + `market_regime_log` | 6 + 46 | ✅ حي (Active) |
| `GET /api/maestro/daily-opportunities` | `vps-service/api/maestro_routes.py` | `db/predictions.db` | `stored_analyses` | 13 | ✅ حي (Active) |
| `GET /api/maestro/overview` | `vps-service/api/maestro_routes.py` | `db/stocks.db` | `system_settings` | 6 | ✅ حي (Active) |
| `GET /api/stocks/presets` | `vps-service/api/stocks.py` | `db/stocks.db` | `stocks` + `screener_presets` | 1,240 + 2,175 | ✅ حي (Active) |
| `GET /api/health` | `vps-service/main.py` (`health_check`) | `db/stocks.db` + `db/predictions.db` + `db/price_history.db` + `db/data_engine.db` | (integrity check) | — | ✅ حي (Active — 4-DB verify) |

### 2.5 مسارات عيادة الإنقاذ (Rescue Endpoints)

| مسار الـ Endpoint وطريقة الـ HTTP | ملف البايثون واسم الدالة | قاعدة البيانات | اسم الجدول | عدد الصفوف | الحالة |
|---|---|---|---|---|---|
| `GET /api/rescue/analyze` | `vps-service/analyzers/bag_holder_rescue.py` (`analyze_clinic`) — **READ-ONLY** (`mode=ro` URI) | `db/stocks.db` + `db/predictions.db` | `stocks` + `stock_daily_prices` + `predictions` (read-only) | 1,240 + 100,619 + 1,551 | ✅ حي (Active — Python brain Rule 20) |
| `GET /api/portfolio/bag-holder-rescue` | `vps-service/api/portfolio_routes.py` | `db/stocks.db` + `db/predictions.db` | `portfolio_assets` + `stocks` | 26 + 1,240 | ✅ حي (Active) |
| `GET /api/portfolio/state` | `vps-service/api/portfolio_routes.py` (FastAPI `portfolio_router`) | `db/finance.db` | `equity_curve_snapshots` | 0 | 🔴 **ميت** (Empty — finance.db barely used) |
| `GET /api/portfolio/holdings` | `vps-service/api/portfolio_routes.py` (FastAPI) | `db/stocks.db` + `db/auth.db` | `portfolio_assets` + `portfolio_items` | 26 + 1 | ✅ حي (Active) |
| `GET /api/portfolio/risk-summary` | `vps-service/api/portfolio_routes.py` (FastAPI) | `db/stocks.db` | `portfolio_assets` + `stocks` | 26 + 1,240 | ✅ حي (Active) |
| `POST /api/trading-journal` | Next.js SQLite direct | `db/predictions.db` | `trade_journal_entries` | **0** | 🔴 **ميت** (Empty — feature not used yet) |

---

## 3. تحليل الجداول المشبوهة والمكررة

### 3.1 ⚠️ `predictions` vs `aiPrediction` vs `predictions_history` (في `predictions.db`)

| الجدول | الصفوف | الـ Schema | الكاتب (Writer) | القارئ (Reader) | الحكم |
|--------|--------|------------|-----------------|-----------------|-------|
| `predictions` | 1,551 | 65 cols (ticker, signal, entry_price, target_price, stop_loss, risk_reward, persona, master_score, exit_type, trailing_stop, etc.) | `daily_predictor.py` V40.2 (DELETE + INSERT — SINGLE-WRITER Rule 73) + `prediction_tracking_routes.py` (save/verify) | Next.js `/api/predictions/honest-tracking/*` + `prediction_tracking_routes.py` | ✅ **CANONICAL** — الإنتاج الفعلي |
| `aiPrediction` | 2,613 | 25 cols (id TEXT, stock_symbol, signal_source_id, phase_scores JSON, profit_loss_percent, days_to_target) | `confluence_routes.py:558` (INSERT) + `ai_predictions_routes.py` (generate) | `ai_predictions_routes.py` (stats/list) + `ai_routes.py:667` | ⚠️ **LEGACY** — schema مختلف، أكبر من canonical بـ 1,062 صف (بيانات قديمة لم تُحدّث) |
| `persona_predictions` | 1,669 | (persona-specific columns) | `daily_predictor.py` + `persona_routes.py` | `persona_routes.py` | ✅ **ACTIVE** — توقعات الشخصيات (gambler/balanced/conservative) |
| `prediction_outcomes` | 0 | (outcome tracking) | (no writer) | (no reader) | 🔴 **DEAD** — لم يُكتب فيه أبداً |
| `prediction_outcomes_old` | 0 | (legacy outcomes) | (no writer) | (no reader) | 🔴 **DEAD** — matches `_old` pattern |
| `historical_trades` | 22,292 | (trade history) | `generate_historical_predictions.py` + `daily_result_checker.py` | `historical_predictions_v2_routes.py` | ✅ **ACTIVE** — أرشيف الصفقات التاريخية |

**التناقض الحسابي:** `aiPrediction` (2,613) > `predictions` (1,551) بـ 1,062 صف. السبب: `aiPrediction` تتراكم بدون تنظيف، بينما `predictions` يُعمل لها `DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%'` في `daily_predictor.py:542`.

**الخطر:** لو الواجهة (Frontend) قرأت من `aiPrediction` بدلاً من `predictions`، ستعرض توقعات قديمة/ملغاة. حالياً `ai_predictions_routes.py` هو الوحيد الذي يقرأها — لكن لو حدث خطأ routing، ستظهر توقعات وهمية.

### 3.2 ⚠️ `stock_daily_prices` vs `stock_price_history` vs `price_history` (في `stocks.db`)

| الجدول | الصفوف | الـ Schema (أول 8 أعمدة) | الكاتب (Writer) | القارئ (Reader) | الحكم |
|--------|--------|--------------------------|-----------------|-----------------|-------|
| `stock_daily_prices` | 100,619 | id, ticker, **price_date**, open, high, low, close, volume | `data_engine/sync.py` + `daily_price_updater.py` + `tradingview_scraper.py` | `chart_routes.py` + `public_routes.py` + Next.js `/api/chart/{ticker}` | ✅ **CANONICAL** — الاسم الرسمي |
| `stock_price_history` | 100,619 | id, ticker, **date** (بدلاً من price_date), open, high, low, close, volume | (unknown — duplicate writer) | Next.js `/api/stocks/{ticker}/history` fallback | ⚠️ **DUPLICATE** — نفس البيانات بالضبط (100,619 صف)، schema مطابق عدا اسم العمود (`date` vs `price_date`) |
| `price_history` | 100,619 | (identical to stock_price_history) | (unknown — duplicate writer) | (legacy readers) | ⚠️ **DUPLICATE** — ثالث نسخة من نفس البيانات |
| `egksco_price_history` | 0 | (EGX schema) | (no writer) | `top_performers_routes.py` (فارغ) | 🔴 **DEAD** — لم يُكتب فيه |

**التناقض:** 3 جداول تحتوي على نفس الـ 100,619 صف بالضبط. هذا مضيعة مساحة + خطر تضارب لو أحدهما حُدّث والآخر لا.

**الـ DB المنفصل `price_history.db`** يحتوي على جدول `price_history` آخر (1.24M rows متوقع — 25 سنة تاريخ) لكنه **تالف** (SQLITE_CORRUPT) وغير قابل للقراءة. هذا مختلف عن `stocks.db.price_history`.

### 3.3 ⚠️ جداول مكررة عبر DBs مختلفة (Cross-DB Fragmentation)

| الجدول | DB 1 | DB 2 | DB 3 | التوصية |
|--------|------|------|------|---------|
| `gold_prices` | data_engine.db (129,251 rows) | gold_prices.db (6 rows) | stocks.db (3 rows) | توحيد في data_engine.db |
| `stocks` | stocks.db (1,240) | data_engine.db (2,205) | egksco_stocks في stocks.db (256) | توحيد في stocks.db |
| `predictions` | predictions.db (1,551) | stocks.db (0 — DEAD) | — | حذف `stocks.db.predictions` |
| `ExpertRecommendation` | predictions.db (17) | auth.db (17) | stocks.db (48) | توحيد في predictions.db |
| `portfolio_assets` | stocks.db (26) | auth.db (1 — portfolio_items) | — | توحيد في stocks.db |
| `learned_lessons` | predictions.db (19,636) | stocks.db (0 — DEAD) | — | حذف `stocks.db.learned_lessons` |

---

## 4. السكربتات الدورية المسؤولة عن كل جدول

### 4.1 المصدر الكنسي للـ cron: `/home/z/my-project/crontab.txt` (26 مدخل)

### 4.2 خريطة الكتابة (Table → Writer Script → Schedule)

| الجدول | الـ DB | السكربت الكاتب | الجدولة (Schedule) | نوع العملية |
|-------|-------|----------------|-------------------|-------------|
| `predictions` | predictions.db | `vps-service/jobs/daily_predictor.py` (V40.2) | cron #1 03:00 UTC + cron #1b 13:30 UTC + `market_scheduler.run_v40_2_generation` كل 15 دقيقة | DELETE + INSERT (SINGLE-WRITER) |
| `stored_analyses` | predictions.db | `vps-service/jobs/daily_predictor.py` | cron #1 + #1b + every 15 min | UPSERT (SINGLE-WRITER Rule 73 — `SKIP_STORED_ANALYSES_WRITE=True` في nightly_analysis.py) |
| `aiPrediction` | predictions.db | `vps-service/api/confluence_routes.py:558` (on-demand API) | on-demand (no cron) | INSERT |
| `persona_predictions` | predictions.db | `vps-service/jobs/daily_predictor.py` | cron #1 + #1b | INSERT |
| `historical_trades` | predictions.db | `scripts/generate_historical_predictions.py` + `scripts/daily_result_checker.py` | manual + daily checker | INSERT + UPDATE |
| `exit_notifications` | predictions.db | `vps-service/jobs/market_scheduler.py` | every 15 min | INSERT |
| `learned_lessons` | predictions.db | `vps-service/analyzers/` (unified_learning_engine) | cron #2 + on-demand | INSERT |
| `morning_bell_signals` | predictions.db | `vps-service/jobs/daily_predictor.py` | cron #1 03:00 UTC | INSERT |
| `crypto_predictions_log` | predictions.db | `vps-service/jobs/market_scheduler.py` (Crypto Lab) | every 15 min (gated by `SKIP_CRYPTO_LAB=1`) | INSERT |
| `stocks` | stocks.db | `data_engine/main.py` + `daily_price_updater.py` + `tradingview_scraper.py` + `update_egx_indices.py` | cron #6 daily + cron #7 5min + 15:05 Cairo + 60s loop | UPDATE + INSERT |
| `stock_daily_prices` | stocks.db | `data_engine/sync.py` + `daily_price_updater.py` | cron #6 daily + 60s loop | UPSERT |
| `stock_price_history` | stocks.db | (duplicate writer — unknown) | (same as stock_daily_prices?) | UPSERT |
| `price_history` (table in stocks.db) | stocks.db | (duplicate writer — unknown) | (same?) | UPSERT |
| `radar_signal_tracking` | stocks.db | `scripts/maker_radar.py` | cron #26 `*/5 8-14 UTC` (EGX/TADAWUL/KSE/QSE/US) + `*/5 24/7` (CRYPTO/GOLD) | CREATE + DELETE + INSERT |
| `market_pulse_cache` | stocks.db | `vps-service/lightweight_server.py` (`_cache_set`) | every request (minute-level cache, 10s TTL) | INSERT + DELETE (OrderedDict cap 1000) |
| `market_regime_log` | stocks.db | `vps-service/analyzers/market_regime_engine.py` (MarketRegimeEngine) | cron #15 daily 02:50 UTC + cron #15b weekly Sat 02:55 UTC (`--all`) | INSERT OR REPLACE (19-col audit) |
| `system_settings` | stocks.db | `vps-service/analyzers/market_regime_engine.py` | cron #15 + startup (`run_morning_regime_check`) | UPSERT (key-value) |
| `market_indices` | stocks.db | `vps-service/scripts/update_egx_indices.py` | `market_scheduler.run_egx_indices_update` يومياً 15:05 Cairo | UPDATE + INSERT |
| `screener_presets` / `screener_results` | stocks.db | `vps-service/api/screener_routes.py` + `advanced_screener_routes.py` | on-demand | INSERT + UPDATE |
| `stock_intraday` | intraday.db | `data_engine/intraday_storage.py` | (should be 5min during market hrs) | INSERT — **لكن الجدول فارغ!** (0 rows) |
| `crypto_intraday` | intraday.db | `data_engine/intraday_storage.py` | 2 min, 24/7 | INSERT + daily DELETE (7-day retention) |
| `commodity_intraday` | intraday.db | `data_engine/intraday_storage.py` | 15 min, 24/7 | INSERT + daily DELETE (7-day retention) |
| `gold_prices` | data_engine.db | `data_engine/main.py` (daleelak_api.py) | 60s loop | INSERT |
| `crypto_prices` | data_engine.db | `data_engine/main.py` | 60s loop | INSERT |
| `exchange_rates` | data_engine.db | `data_engine/main.py` | 60s loop | INSERT |
| `tab_*` (8 fundamental tables) | data_engine.db | `data_engine/sync.py` | daily sync | INSERT + UPDATE |
| `user_notifications` | stocks.db | `vps-service/jobs/market_scheduler.py` (`_run_bag_holder_alerts`) | P31 every 15 min | INSERT (idempotent per user+ticker+day, type='bag_holder_alert') |
| `analytics_events` | stocks.db | Next.js routes (analytics) | on-demand | INSERT |
| `api_tokens` | auth.db | Next.js auth routes (`/api/auth/login`, `/api/auth/google`) | on-demand | INSERT |

### 4.3 المحركات السبعة الرئيسية (The 7 Main Writer Engines)

| المحرك | الملف | الـ DBs التي يكتب فيها | الجدولة |
|--------|------|----------------------|---------|
| **1. daily_predictor** | `vps-service/jobs/daily_predictor.py` (V40.2) | predictions.db (`predictions` + `stored_analyses` + `persona_predictions` + `morning_bell_signals`) | cron #1 + #1b + every 15 min |
| **2. maker_radar** | `scripts/maker_radar.py` | stocks.db (`radar_signal_tracking`) | cron #26 (5-min) |
| **3. data_engine** | `data_engine/main.py` (Flask + while-loop) | data_engine.db (stocks, crypto_prices, gold_prices, exchange_rates) + stocks.db (stocks, stock_daily_prices) | 60s loop + layered cron |
| **4. market_scheduler** | `vps-service/jobs/market_scheduler.py` (60s tick) | stocks.db (user_notifications, exit_notifications) + predictions.db (crypto_predictions_log) | 60s tick loop |
| **5. intraday_storage** | `data_engine/intraday_storage.py` | intraday.db (crypto_intraday, commodity_intraday — stock_intraday فارغ) | 2/15 min |
| **6. update_egx_indices** | `vps-service/scripts/update_egx_indices.py` | price_history.db (EGX30+EGX100 — **تالف**) + stocks.db (egx_indices) | daily 15:05 Cairo |
| **7. market_regime_engine** | `vps-service/analyzers/market_regime_engine.py` (MarketRegimeEngine) | stocks.db (system_settings + market_regime_log) | cron #15 daily + #15b weekly |

### 4.4 المحركات الـ READ-ONLY (تحسب في الذاكرة فقط)

| المحرك | الملف | يقرأ من | لا يكتب شيئاً |
|--------|------|----------|---------------|
| `bag_holder_rescue` | `vps-service/analyzers/bag_holder_rescue.py` | stocks.db + predictions.db (`mode=ro` URI) | ✅ READ-ONLY تماماً |
| `hmm_market_regime` | `vps-service/analyzers/hmm_market_regime.py` | stocks.db | ✅ READ-ONLY |
| `nightly_quant_job` | `vps-service/jobs/` | predictions.db | ✅ READ-ONLY |
| `price_history_stale_monitor` | `vps-service/jobs/` | price_history.db | ✅ READ-ONLY |
| `data_heartbeat_checker` | `vps-service/jobs/` | multiple | ✅ READ-ONLY |
| `post_market_feedback` | `vps-service/jobs/` | predictions.db | ✅ READ-ONLY |
| `weekly_radar_report` | `vps-service/jobs/` | stocks.db | ✅ READ-ONLY |
| `telegram_comprehensive_report` | `vps-service/jobs/` | multiple | ✅ READ-ONLY |

---

## 5. الجداول الميتة/المهجورة (Dead Tables)

### 5.1 جداول ميتة في `predictions.db` (20 جدول فارغ)

| الجدول | الصفوف | السبب |
|--------|--------|-------|
| `prediction_outcomes` | 0 | لم يُكتب فيه أبداً (يستخدم `predictions.actual_return` بدلاً منه) |
| `prediction_outcomes_old` | 0 | 🔴 DEAD_LEGACY — matches `_old` pattern |
| `analysis_jobs` | 0 | لم يُستخدم |
| `cached_analysis` | 0 | (يوجد نسخة أخرى في stocks.db — 23 rows) |
| `cash_transactions` | 0 | ميزة غير مفعّلة |
| `crypto_lessons` | 0 | ميزة غير مفعّلة |
| `crypto_predictions` | 0 | (يستخدم `crypto_predictions_log` بدلاً منه — 180,269 rows) |
| `equity_snapshots` | 0 | (ميزة finance.db منفصلة) |
| `platform_recommendations` | 0 | مهجور |
| `portfolio_pnl_history` | 0 | ميزة غير مفعّلة |
| `portfolio_positions` | 0 | ميزة غير مفعّلة |
| `portfolio_state` | 0 | ميزة غير مفعّلة |
| `session_event_sent_log` | 0 | ميزة غير مفعّلة |
| `session_events` | 0 | ميزة غير مفعّلة |
| `telegram_news` | 0 | (يستخدم stocks.db.telegram_news — 6 rows) |
| `telegram_signals` | 0 | ميزة غير مفعّلة |
| `trade_journal_entries` | 0 | ميزة غير مفعّلة |
| `trade_journal_reflections` | 0 | ميزة غير مفعّلة |
| `trade_outcomes` | 0 | ميزة غير مفعّلة |
| `user_trades` | 0 | ميزة غير مفعّلة |

### 5.2 جداول ميتة في `stocks.db` (34 جدول فارغ)

أبرزها:
| الجدول | الصفوف | السبب |
|--------|--------|-------|
| `predictions` | 0 | 🔴 DEAD — يجب استخدام predictions.db.predictions (1,551 rows) |
| `prediction_logs` | 0 | 🔴 DEAD — يجب استخدام predictions.db |
| `learned_lessons` | 0 | 🔴 DEAD — يجب استخدام predictions.db (19,636 rows) |
| `egksco_price_history` | 0 | 🔴 DEAD — لم يُكتب |
| `news` | 0 | (يستخدم news.db.market_news — 905 rows) |
| `news_items` | 0 | مكرر |
| `alert_history` / `alert_settings` | 0 | ميزة غير مفعّلة |
| `daily_analytics_summary` | 0 | (يستخدم analytics_events — 919 rows) |
| `financial_obligations` / `financial_transactions` | 0 | (تستخدم auth.db) |
| `gold_alerts` | 0 | ميزة غير مفعّلة |
| `maestro_personas` | 0 | (KILL-MAESTRO directive) |
| `morning_reports` | 0 | (يستخدم predictions.db.reports — 6 rows) |
| `paper_trades` | 0 | ميزة غير مفعّلة |
| `price_alerts` | 0 | ميزة غير مفعّلة |
| `telegram_images` / `telegram_messages` | 0 | (يستخدم telegram_data.db) |
| `telegram_recommendations` | 0 | ميزة غير مفعّلة |
| `ticker_performance` | 0 | ميزة غير مفعّلة |
| `tracked_channels` | 0 | ميزة غير مفعّلة |
| `trading_lessons` / `trading_rules` | 0 | ميزة غير مفعّلة |
| + 14 more empty tables | 0 | legacy/never-written |

### 5.3 `stocks_backup` (⚠️ LEGACY-WITH-DATA)

| الجدول | الصفوف | آخر تحديث | الحكم |
|--------|--------|-----------|-------|
| `stocks_backup` | 345 | 2026-06-04 (stale 4+ months) | ⚠️ مرشح للحذف/الأرشفة — لا يُقرأ من أي route |

### 5.4 DBs مهجورة بالكامل

| DB | Tables | الحالة |
|----|--------|--------|
| `crypto.db` | 5 tables (كلها 0 rows) | 🔴 ENTIRELY ORPHANED — real crypto data في data_engine.db + predictions.db |
| `analytics.db` | 0 tables active | 🔴 ENTIRELY ORPHANED |
| `community.db` | 0 tables active | 🔴 ENTIRELY ORPHANED |
| `ai_search_cache.db` | 0 tables active | 🔴 ENTIRELY ORPHANED |
| `custom.db` | 0 tables active | 🔴 ENTIRELY ORPHANED (Prisma migrations stub) |

### 5.5 DB تالف

| DB | الخطأ | السبب المحتمل | التأثير |
|----|-------|--------------|---------|
| `price_history.db` | `database disk image is malformed` (SQLITE_CORRUPT) | Truncated WAL (`.db-wal` = 0 bytes, `.db-shm` = 32KB) | `chart_routes.py` /full-analysis backtest يفشل في قراءة 1.24M rows من تاريخ الأسعار |

### 5.6 DBs غائبة (Lazy-Init)

| DB | الحالة | السبب |
|----|--------|-------|
| `metrics.db` | ❌ ABSENT | Auto-created on first use by `src/lib/metrics-db.ts:5` |
| `paper_trading.db` | ❌ ABSENT | Auto-created on first use by `src/lib/paper-trading-v2-db.ts` |

---

## 6. خريطة مسارات بايثون الشاملة

### 6.1 البنية الطوبولوجية

```
main.py (FastAPI app, port 8010)
├── /health                        (FastAPI @app.get)
├── /api/portfolio/* (9 routes)    (FastAPI portfolio_router from ai/portfolio_routes.py)
└── / (mount via a2wsgi.WSGIMiddleware)
    └── lightweight_server.py (Flask app)
        ├── 42 direct @app.route endpoints
        └── 36 Blueprints registered (452 routes total in vps-service/api/*.py)
```

**إجمالي Python endpoints:** ~503 (42 Flask direct + 452 Blueprint + 9 FastAPI)

### 6.2 التوزيع حسب الـ Module (أبرز الملفات)

| File | Routes | DBs Touched | Notes |
|------|--------|-------------|-------|
| `lightweight_server.py` | 42 | stocks.db, predictions.db, crypto.db, data_engine.db | Has 10s minute-level cache for `/api/market-pulse`. Lazy-imports engines. |
| `admin_routes.py` | ~60 | stocks.db, predictions.db, price_history.db, data_engine.db, auth.db | All `@require_admin`; uses `_get_db_path` + `db_manager.connection()` (Rule 54). |
| `telegram_routes.py` | ~54 | content.db, stocks.db | Massive Telegram scraping/posting/ai-classify. |
| `portfolio_routes.py` | ~55 | stocks.db, predictions.db | Overlaps with FastAPI portfolio_router. |
| `misc_routes.py` | ~22 | stocks.db, predictions.db, price_history.db, data_engine.db | Admin/trigger/rebuild endpoints. |
| `v2_routes.py` | ~17 | stocks.db, predictions.db | Persona/scanner/cached-analysis/morning-recommendations. |
| `unified_learning_routes.py` | 21 | predictions.db (LEARNING_DB) | Iterative/intelligent learning. |
| `ai_routes.py` | 21 | predictions.db | `/api/ai/premium/predictions` (confluence = maestro×0.6 + ai×0.4). |
| `risk_routes.py` | 22 | stateless | Dynamic stop-loss/targets/trailing. |
| `maestro_routes.py` | 14 | stocks.db | Maestro orchestrator. |
| `sniper_routes.py` | 13 | price_history.db, predictions.db, data_engine.db | `/closer/run`, `/learning/*`. |
| `stored_analysis_routes.py` | 12 | predictions.db, stocks.db, data_engine.db | `/api/stored-analysis/live-tracking` + `/api/market/morning-bell`. |
| `chart_routes.py` | 4 | stocks.db, data_engine.db, predictions.db | `/<ticker>`, `/stats/intraday`, `/collect/now`, `/full-analysis`. |
| `public_routes.py` | 16 | stocks.db | Public stock listing, history, prices, analysis, indicators. |
| `news_routes.py` | 9 | stocks.db, content.db | News CRUD + EGX scraping + AI agent. |
| `prediction_tracking_routes.py` | 11 | predictions.db, stocks.db, data_engine.db | /save, /list, /stats, /verify, /history, /pending. |
| `ai/portfolio_routes.py` (FastAPI) | 9 | finance.db, predictions.db, stocks.db | Equity curve, holdings, risk-summary, bag-holder-rescue. |
| `v38_backtest_routes.py` | 6 | price_history.db, stocks.db | V38 institutional decision engine. |
| `historical_predictions_v2_routes.py` | 4 | predictions.db, price_history.db, stocks.db | SSE per-stock persona backfill. |
| `confluence_routes.py` | 5 | stocks.db, predictions.db (writes aiPrediction) | ConfluenceEngineV3 + clean-signals. |
| `unified_v2_routes.py` | 7 | varies | /markets, /personas, /config, /analyze, /scan. |
| `learning_routes.py` | 5 | predictions.db | /status, /run-backfill, /lessons, /regime-weights. |
| `ai_predictions_routes.py` | 7 | predictions.db (aiPrediction) | /info, /status, /generate, /evaluate, /stats, /list, /clear. |
| `analytics.py` | 7 | stocks.db | Track + admin/overview + generate-daily-summary. |
| `optimizer_params_routes.py` | 4 | predictions.db | /params GET/POST, /reset, /backtest. |
| `picks_management_routes.py` | 6 | predictions.db | Daily Top-5 + HOLD/TRAIL/EXIT. |
| `notebook_routes.py` | 7 | stocks.db + analysis cache | List, stats, per-symbol, refresh, build-all. |
| `persona_routes.py` | 4 | predictions.db | /investor, /gambler, /compare, /stock/<ticker>. |
| `reports_routes.py` | 11 | predictions.db + stocks.db | Daily/weekly/monthly + generate + publish. |
| `stocks.py` | 3 | stocks.db | /api/stocks/presets/list, /presets, /computed. |
| `sector_tracking_routes.py` | 2 | stocks.db | /api/sectors/tracking, /api/sectors/<name>/stocks. |
| `top_performers_routes.py` | 1 | data_engine.db (egksco_price_history — EMPTY) + stocks.db | /api/stocks/top-performers. |
| `professional_analysis_routes.py` | 1 | stocks.db | /api/professional-analysis/<ticker>. |
| `advanced_screener_routes.py` | 1 | stocks.db | /api/screener/advanced. |
| `stock_analysis_routes.py` | 1 | varies | /api/stock/deep-analysis only. |
| `screener_routes.py` | 3 | stocks.db | presets, scan, run-all. |
| `scanner_routes.py` | 3 | stocks.db | /api/scanner/quick + /api/advanced-scanner/status + /run. |
| `regime_routes.py` | 3 | stocks.db + data_engine.db | /market, /stock/<ticker>, /overview. |
| `admin_engine_settings_routes.py` | 3 | predictions.db | GET/POST/reset engine settings. |

### 6.3 مطابقة الـ 144 Proxy Routes في Next.js

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

## 7. التوصيات والإصلاحات المقترحة

### 7.1 إصلاحات عاجلة (P0 — Critical)

1. **استعادة `price_history.db`** من backup أو تشغيل `sqlite3 .recover` — غير قابل للاستخدام حالياً (SQLITE_CORRUPT). يؤثر على `chart_routes.py` /full-analysis backtest.

2. **حماية `predictions.db.predictions` من الكتابة العشوائية في Next.js:**
   - `admin/backtest/v40/run` يفعل `DELETE FROM predictions` على قاعدة الإنتاج — استخدم DB منفصلة
   - `sniper/track` يفعل INSERT — يخالف Rule 35 المعلن في نفس الملف
   - `telegram/publish-stock` يفعل UPDATE — استخدم audit table منفصلة

3. **إضافة 5 DBs مشتركة إلى `NO_CACHE_DB_NAMES`** في `src/lib/shared-db.ts`:
   - `db/stocks.db`, `db/data_engine.db`, `db/price_history.db`, `db/news.db`, `db/intraday.db`
   - (مخاطرة segfault عند reuse connection لو Python كاتب في نفس الوقت)

### 7.2 إصلاحات متوسطة (P1 — High)

4. **توحيد الجداول المكررة في `stocks.db`:**
   - `stock_daily_prices` (100,619) = `stock_price_history` (100,619) = `price_history` (100,619) → احتفظ بـ `stock_daily_prices` فقط
   - `egksco_price_history` (0) → احذف (DEAD)

5. **حذف الجداول الميتة:**
   - `predictions.db.prediction_outcomes_old` (0 rows, `_old` pattern)
   - `predictions.db.prediction_outcomes` (0 rows — unused)
   - `stocks.db.predictions` (0 rows — should use predictions.db)
   - `stocks.db.prediction_logs` (0 rows — should use predictions.db)
   - `stocks.db.learned_lessons` (0 rows — should use predictions.db)
   - `stocks_backup` (345 rows, stale 2026-06-04 — archivable)

6. **مراجعة `aiPrediction` (2,613 rows legacy):**
   - إما ترحيل البيانات إلى `predictions` (canonical) أو حذفها
   - `confluence_routes.py:558` يجب أن يتوقف عن INSERT إلى `aiPrediction`
   - `ai_predictions_routes.py` يجب أن يقرأ من `predictions` بدلاً منه

7. **تغطية EGX70:** `update_egx_indices.py` يحدّث EGX30+EGX100 فقط (INDICES = ['EGX30','EGX100']). أضف 'EGX70'.

8. **تنشيط `intraday.db.stock_intraday`:** الجدول فارغ (0 rows) — `IntradayPressurePanel.tsx` + `MarketDepthPanel.tsx` يفشلان في عرض بيانات EGX intraday.

9. **حذف DBs المهجورة بالكامل:** `crypto.db` (5 tables all empty), `analytics.db`, `community.db`, `ai_search_cache.db`, `custom.db`.

### 7.3 إصلاحات منخفضة (P2 — Medium/Low)

10. **توحيد الـ env vars للـ Python backend:** 6 env vars مختلفة. توحيد لاستيراد `PYTHON_BACKEND_URL` من `@/lib/python-backend` (~50 مسار يستخدم الأنماط القديمة).

11. **توحيد الجداول المبعثرة:**
    - `gold_prices` في 3 DBs → data_engine.db فقط
    - `ExpertRecommendation` في 3 DBs (predictions=17, auth=17, stocks=48) → predictions.db فقط

12. **إصلاح dead imports في `main.py`:**
    - `from ai.api_routes import ai_router` → الملف غير موجود (ImportError silenced)
    - `v4_bp` registration معلق (file never created)

---

## 📊 الملخص النهائي

| المقياس | القيمة |
|---------|--------|
| **Python endpoints** | ~503 (42 Flask + 452 Blueprint + 9 FastAPI) |
| **DBs المفحوصة** | 16 (8 قابلة للقراءة + 1 تالفة + 2 غائبة + 5 مهجورة) |
| **DB تالف** | 1 (`price_history.db` — SQLITE_CORRUPT) |
| **DBs مهجورة بالكامل** | 5 |
| **إجمالي الجداول** | 168 (8 DBs قابلة للقراءة) |
| **جداول حية (Active)** | 105 |
| **جداول ميتة (Dead/Empty)** | 63 |
| **سكربتات دورية (cron)** | 26 مدخل |
| **محركات كتابة رئيسية** | 7 |
| **محركات READ-ONLY** | 8 |
| **مسارات Next.js تقرأ SQLite** | 276-335 |
| **Top table (reads)** | `stocks` (70 routes) |
| **نقاط تضارب كتابة** | 10 جداول |
| **أخطر تضارب** | `predictions.db.predictions` (Next.js DELETE FROM + 22 Python writers) |
| **جداول مكررة** | 3 نسخ من `stock_daily_prices` (كلها 100,619 صف) |
| **جداول legacy مشبوهة** | `aiPrediction` (2,613 rows — أكبر من canonical بـ 1,062) |
| **DBs في NO_CACHE_DB_NAMES** | 1 فقط (predictions.db) — يجب إضافة 5 آخرين |

---

*نهاية التقرير — الجرد التشريعي الكامل للباك إند وقواعد البيانات*
*يكمل هذا التقرير `AUDIT_FRONTEND_SCREENS_MAP.md` لنحصل على **«الأشعة السينية الكاملة للمنصة»***
