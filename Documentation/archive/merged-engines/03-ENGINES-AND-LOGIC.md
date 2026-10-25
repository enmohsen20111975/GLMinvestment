# 03 — المحركات والمنطق

> **مصدر الحقيقة:** الكود الفعلي في `vps-service/` + `data_engine/` + `src/lib/canonical-signal.ts`. آخر مراجعة: 2026-10-19.
>
> هذا الملف يفصّل **محرك V40.2** (العقل) + كل المحللات + إدارة المخاطر + الباك تست + عتبات الإشارة.

---

## 🧠 المحرك الرئيسي: V40.2 Prediction Engine

### الحقيقة الأولى: V40.2 مش ملف واحد
محرك V40.2 اتبنى كـ **pipeline** في `vps-service/jobs/daily_predictor.py` (4425 سطر). بـ يستورد:
- `from engines.backtest_engine import V38BacktestEngine, Trade, simulate_trade, calc_atr` — **محرك التنفيذ V38**.
- `from analyzers.liquidity_filter import set_strict_kill_filters` — strict kill-filter.
- `from analyzers.prediction_tracker import PredictionTracker`.
- `from liquidity_radar_v2 import compute_whale_flow` (من `scripts/liquidity_radar_v2.py` — مش في vps-service).
- Helper modules: `utils/expert_memory_v402.py` + `utils/daily_opportunities_v402.py`.

### خيارات التشغيل
`--today-only`, `--yesterday-only`, `--start/--end`, `--dry-run`, `--keep-old`.

### V40.2 changes vs V40.1
- **strict kill-filter** (no market-open relaxation).
- **real EGX30ETF benchmark**.
- **tightened entry**.
- `partial_exit_at_rr=1.5`.

### الجدولة (Cron)
- `daily_predictor.py` بيشتغل يومي 14:30 (توقيت القاهرة) عبر `EgyptScheduler.setup_nightly_quant_job`.
- الـ nightly quant job بيشتغل 03:00 القاهرة.

---

## ⚙️ V38 Backtest Engine — محرك التنفيذ
**File**: `vps-service/engines/backtest_engine.py` (2402 سطر).

- **V38 Institutional Decision Engine — Backtester**. محاكاة شاملة لكل أسهم EGX.
- بيجمع: ATB + RSI + Bollinger + Makers + DNA + Fundamentals + Sector + **5 Proofs** + Adaptive Threshold + VWAP + Order Blocks.
- **مهم**: `daily_predictor.py` بـ يستورد منه `V38BacktestEngine, Trade, simulate_trade, calc_atr` — V40.2 بـ يستخدم V38 كمحرك تنفيذ.

### `engines/market_regime.py`
- EGX30/EGX100 Stage Detection (Minervini stages 1-4) من `price_history.db`.

---

## 🏗️ engine/ — محركات متخصصة

| الملف | الوظيفة |
|---|---|
| `flow_system.py` | **Flow System** — 4 طبقات: Macro 25% + Sector 30% + Stock 25% + Cross-validation 20% |
| `persona_engine.py` | **7 شخصيات مستثمرة** (conservative→gambler→hedger) + `get_adjusted_threshold` |
| `crypto_engine.py` | محرك كريبتو مخفف (يقرأ من `db/data_engine.db`) |
| `explosive_scanner.py` | ماسح القنابل: Volume_Surge×25% + Price×30% + Sector×20% + SmartMoney×15% + Market×10% |
| `stock_fundamentals.py` | يجمع 9 جداول من data-engine.db + stocks.db |
| `historical_backfill_engine.py` | تعلم من 180 يوم → prediction_logs + outcome_logs + learned_lessons + regime_indicator_weights |
| `paper_trade_tracker.py` | تتبع صفقات افتراضية + قياس بعد 1/5/10/20 يوم |

---

## 📊 glminvestment_engines/ — Minervini/Turtle-style (منفصل منطقياً)

- `core/base.py` — أنواع موحدة: `SignalType` (STRONG_BUY→STRONG_AVOID), `Timeframe`, `EngineResult`.
- `core/indicators.py` — مؤشرات فنية.
- `engines/vcp_detector.py` — **Volatility Contraction Pattern** (Minervini).
- `engines/donchian_breakout.py`, `engines/atr_risk_engine.py`, `engines/take_profit_tiers.py`, `engines/stage2_filter.py`.
- `confluence/confluence_scorer.py` — **Confluence v4**: Donchian 30% + ATR 25% + Stage2 20% + VCP 10% + Persona 15%، مع EGX30 Hard Gate (SMA200).
- `backtest/strategy_backtester.py` — محاكاة بار ببار (Win Rate / Avg R / Profit Factor / Max DD / Expectancy).
- `integration/expert_gate_patch.py` + `integration/risk_engine_patch.py`.
- `cli_analyze.py` + `examples/demo_confluence.py`.

---

## 🔬 analyzers/ — 30+ محلل

> **maestro_orchestrator.py اتمسح** فعلياً (MAESTRO-CANCER-1). `unified_maestro.py` موجود كبديل. `maestro_bp` معطّل (410 Gone) في `lightweight_server.py`.

### المحللات الرئيسية

| المحلل | الوظيفة |
|---|---|
| `master_analyzer.py` | **"THE BRAIN"** — دمج كل المحللات بأوزان |
| `core_scoring_engine.py` | **"القلب النابض"** — محرك التسجيل الموحد |
| `sniper_engine.py` | SniperEngine الموحد — يحل محل 3 محركات متضاربة |
| `sniper_detector.py` | V73 EGX Oracle Sniper (Pine→Python، V40.2 integration) |
| `confluence_engine_v3.py` | Confluence v3 production-safe |
| `v82_analyzer.py` | V82 Ultimate EGX (Pine→Python) |
| `v68_oracle.py` | V68 Oracle — البصمة المستقبلية والاحتمالات (Pine→Python) |
| `multi_path_detector.py` | V72 Multi-Path Engine (Pine→Python) |
| `golden_hunter.py` | V76 Golden Hunter (golden_retest + choch_bull) |
| `institutional_decision_engine.py` | V39 Full Dynamic Adaptive (SMC+VSA+Fusion+DNA+Candle) |

### السيولة والرادار

| المحلل | الوظيفة |
|---|---|
| `liquidity_filter.py` | **"السيولة أولًا، التحليل تانيًا"** — أول خطوة قبل أي تحليل |
| `smc_engine.py` | **Smart Money Concepts** (كشف الحيتان) |
| `volume_profile.py` | VWAP + تحليل الحجم |
| `institutional_levels.py` | مستويات السيولة المؤسسية + **Falling Knife Guard** (BRAVO-P0-QUANT-LOGIC) |
| `radar_integration.py` | الربط العكسي (آخر تعديل BRAVO-RADAR-GATE-UPDATE-1: phase/bucket + old paths) |

> **`liquidity_radar_v2.py` موجود في `scripts/` مش في vps-service/** — مهم لو حد بيدوّر عليه. بـ compute `whale_flow` بـ 4 أعمدة (phase + bucket + MFM + تدفق الحيتان).

### الإعدادات والجودة

| المحلل | الوظيفة |
|---|---|
| `engine_settings.py` | **DYNAMIC-SYSTEM-001** — كل threshold ديناميكي (مفيش رقم ثابت). مصدر الحقيقة الوحيد للإعدادات. |
| `expert_quality_gate.py` | **"50 توصية → الخاجر يطلع 10 بس صح"** |
| `crypto_quality_gate.py` | نفس الباب للكريبتو |
| `prediction_optimizer.py` | يعالج 5 مشاكل جذرية تمنع 60%+ win rate (mean-reversion) |
| `enhanced_prediction_tracker.py` | KPI محاذى مع gold standard في Next.js |

### النظام والاتجاه

| المحلل | الوظيفة |
|---|---|
| `market_regime_engine.py` | 6 مؤشرات → DEFENSIVE/NORMAL/AGGRESSIVE |
| `regime_filter.py` | فلتر اتجاه EGX الإلزامي (قاعدة 29) |
| `hmm_market_regime.py` | **HMM (Hidden Markov Model)** — Rule 71 Quantitative Layer 2 |
| `garch_exit_engine.py` | **GARCH Volatility Forecasting Exit** — Rule 71 Layer 3 |
| `adaptive_weights.py` | أوزان تكييفية حسب market regime |

### الذاكرة والتعلم

| المحلل | الوظيفة |
|---|---|
| `expert_memory.py` + `expert_memory_bridge.py` | ذاكرة الخبير (Conjunction Patterns) + جسر لـ stocks.db |
| `unified_learning_engine.py` | **"THE BRAIN of the learning system in Python"** |
| `feedback_loop.py` | حلقة التغذية الراجعة (قياس أداء التوقعات) |
| `feature_extractor.py` | ML Features لـ Overlay Layer 1 |

### الشخصيات والزمن

| المحلل | الوظيفة |
|---|---|
| `persona_investor.py` / `persona_gambler.py` / `persona_screener.py` | شخصيات المستثمر/المغامر + شاشة فرز |
| `multi_timeframe_engine.py` | تقارب 3 أطر (يومي/أسبوعي/شهري) |
| `live_indicator_engine.py` | Live Delta Calculator (يفصل تاريخي عن لحظي) |
| `seasonality_engine_v2.py` | موسمية data-driven (يستبدل V1 hardcoded) |

### الأساسيات والأخبار

| المحلل | الوظيفة |
|---|---|
| `fundamental_engine.py` / `fundamental_relative.py` | الأساسيات من data_engine.db (سياق قطاعي) |
| `news_impact_scorer.py` / `news_stop_filter.py` / `live_news_integration.py` | تأثير الأخبار + stop filter |

### الكم

| المحلل | الوظيفة |
|---|---|
| `quant_engine.py` + `quant_overdrive.py` | Pine V11→Python + خوارزميات كمية لـ 270 سهم |

---

## 🤖 ML + AI

### `ml_models/` — طبقة overlay واحدة
- **ملف واحد بس**: `ml_overlay_v1.pkl` — sklearn pickled model.
- مفيش `.py` ML model تدريبية حية. التدريب بيحصل عبر `analyzers/train_ml_model.py`.
- الـ overlay بيـ boost/penalize الـ score بناءً على الـ features (Rule 71 Layer 1).

### `ai/` — 11 ملف (AI integration)

| الملف | الوظيفة |
|---|---|
| `portfolio_routes.py` | **Wealth Command Center** endpoints (FastAPI router) |
| `decision_engine.py` + `glm_finance_agent.py` | LLM/agent integration |
| `deepseek_news_service.py` | DeepSeek Financial News AI Service |
| `news_agent.py` | وكيل أخبار بالـ AI المحلي (Ollama) |
| `news_signals_reader.py` | يقرأ أخبار Local News Agent المحقونة |
| `live_ai_monitor.py` | مراقبة AI أثناء الجلسة |
| `nightly_analysis.py` | تحليل ليلي بالـ AI |
| `historical_trade_generator.py` | مولّد صفقات تاريخية |
| `hot_stocks_detector.py` | كاشف أسهم ساخنة |
| `telegram_signal_importer.py` | مستورد توصيات من جروبات Telegram |
| `trade_recorder.py` | مسجّل صفقات + learning loop |

**AI stack**: Ollama محلي (LLM) + DeepSeek API + keyword-based sentiment fallback. **مفيش VLM** في هذا المجلد.

---

## 🧩 core/ — العمود الفقري (16 ملف)

| الملف | الوظيفة |
|---|---|
| `migrator.py` | Central Migration Manager — استبدل 67 CREATE TABLE متكرر |
| `db_manager.py` | البوابة المركزية لكل DBs — aliases: stocks, predictions, auth, data_engine, price_history, crypto, community, crypto_learning |
| `scheduler_manager.py` | APScheduler مركزي (استبدل 3 threads منفصلة) |
| `egypt_scheduler.py` | جدول داخلي لتوقيت مصر (nightly quant 03:00 + egksco 9:00–14:30) |
| `router.py` | **"موحّد العقل"** — Decision Router بين المحركات |
| `analysis_runner.py` | **"THE single write path for stock analysis"** — استبدل duplicate loops |
| `opportunity_quality.py` | فرص المضارب vs المستثمر + فلتر الأسهم الحية + `enforce_atr_based_stop` (Rule 8) |
| `persona_db.py` | Safe storage لـ Unified Persona Engine (ممنوع ALTER TABLE، بس CREATE IF NOT EXISTS) |
| `cache_manager.py` | In-Memory TTL Cache |
| `data_source_circuit_breaker.py` | قاطع دائرة لمحركات البيانات (TradingView/EGKSCO/...) |
| `models.py` | نماذج بيانات موحدة (Phase 9 API standardization) |
| `auth_middleware.py` | `@require_admin` + `@require_role(min_tier, require_trial)` + `@require_trial_or_paid` + `fail_closed` param |
| `http_client.py` | HTTP client مع retry |
| `logging_config.py` | قمع ضجيج المكتبات |
| `database.py` + `crypto_database.py` | connection pooling + DB كريبتو منفصل |

---

## ⏰ jobs/ — 13 cron

| الملف | الوظيفة | الجدولة |
|---|---|---|
| `daily_predictor.py` (4425 سطر) | **V40.2 generator** — المحرك الرئيسي | يومي 14:30 |
| `market_scheduler.py` | الجدول المركزي | tick كل 60ث |
| `daily_closer.py` | إغلاق التوقعات يوميًا (trailing stop = FLOOR) | يومي |
| `intraday_scanner.py` | V40.2 Unified Intraday Engine | كل 5 دقائق |
| `intraday_aggregator.py` | تجميع شموع لحظية → يومية | — |
| `crypto_lab_scheduler.py` | Crypto 24/7 Lab | 15 دقيقة (يُلغى بـ `SKIP_CRYPTO_LAB=1`) |
| `learning_engine.py` | التعلم الذاتي | — |
| `hot_candidate_detector.py` | كاشف المرشحين الساخنين | — |
| `price_history_safetynet.py` + `price_history_stale_monitor.py` | أمان ومراقبة `price_history.db` | — |
| `fetch_corporate_actions.py` | توزيعات + اكتتابات + جمعيات | — |
| `fetch_inflation_worldbank.py` | تضخم من World Bank | — |
| `daily_portfolio_yield.py` | عائد المحفظة اليومي | يومي |
| `wal_checkpoint.py` | PRAGMA wal_checkpoint على 4 DBs | ساعيًا |

### Dead Man's Switch
`scripts/data_heartbeat_checker.py` بيشتغل كل 10 دقايق (P0-KILLSWITCH-050) — لو الـ heartbeat وقع = فيه مشكلة في الـ pipeline.

---

## 💼 portfolio/ — إدارة الصفقات (9 ملف)

| الملف | الوظيفة |
|---|---|
| `position_manager.py` | إدارة المراكز |
| `stop_manager.py` | إدارة الـ stop loss |
| `smart_exit_engine.py` | محرك الخروج الذكي |
| **`multi_target_exit.py`** | T1/T2/T3 + dynamic stop (Rule 10 — partial_1r_trailing) |
| `hard_protection.py` | حماية صارمة |
| `portfolio_heat.py` | حرارة المحفظة |
| **`purification_calculator.py`** | **Tazkiyah** (تطهير الأرباح — Rule 64 SHARIA-COMPLIANCE) |
| `strategies.py` | Entry Strategies |
| `trade_journal.py` | يوميات الصفقات |

---

## 🎯 strategies_merge/ — 4 استراتيجيات A/B-testable

| الملف | الاستراتيجية |
|---|---|
| `correction_strategy.py` | **Strategy A**: Correction-only (WHERE) |
| `chase_strategy.py` | **Strategy B**: Chase-only momentum (WHEN) |
| `merged_strategy.py` | **Strategy C**: MERGED (Correction WHERE + Chase WHEN sequentially) |
| `merged_strict_strategy.py` | **Strategy D**: MERGED-STRICT (the fix attempt بعد ما C فشل) |
| `common.py` | primitives: indicators + structural exit + trade metrics |
| `regime_filter.py` | wrappers لكل strategy |

---

## 🛡️ إدارة المخاطر

### `risk_management_advanced.py` (1901 سطر) — CANONICAL risk API
**Functional** (مش class). يـ expose:
- `calculate_position_size`
- `calculate_stop_loss` + `calculate_dynamic_stop_loss`
- `calculate_targets` + `calculate_dynamic_targets`
- `calculate_trailing_stop` + `calculate_dynamic_trailing_stop`
- `calculate_position_plan`
- `evaluate_buy_safety`
- `enforce_stop_loss` + `get_stop_loss_pct`
- `validate_trade_with_2_percent_rule`
- `calculate_egyptian_confidence`
- `check_psychology_rules`
- `validate_leverage`
- `detect_stock_type`
- `calculate_dynamic_rr`
- `analyze_portfolio`
- **`DECISION_TABLE`**

بديل: `analyzers/risk.py` (بسيط per-trade) + `analyzers/risk_adaptive.py` (adaptive) + `analyzers/risk_manager.py` (portfolio forward-test).

### `analysis_engine_v2.py` (984 سطر) — Plugin-Based
`AnalysisOrchestrator` بيوزع 4 plugins:
- **Fundamental** (ON/OFF + weight)
- **Technical** (ON/OFF + weight)
- **Candlestick** (ON/OFF + weight)
- **MeanReversion** (ON/OFF + weight)

Presets: EGX Conservative / Aggressive / Balanced / Crypto Scalp.

---

## 📏 عتبات الإشارة (Rule 67 — CALCULATION-CANONICAL)

**From `src/lib/canonical-signal.ts`** (TS port لـ `vps-service/utils/canonical_signal.py`):

| Signal | Threshold (master_score) |
|---|---|
| **STRONG_BUY** | ≥ 78 |
| **BUY** | ≥ 65 |
| **ACCUMULATE** | ≥ 55 |
| **REDUCE** | ≥ 40 |
| **STRONG_SELL** | < 25 |

> الـ thresholds دي موحّدة بين الـ Python والـ TS. أي تعديل = مخالفة Rule 67.

---

## 🚦 القواعد الحاكمة للمخاطر (من الدستور)

| القاعدة | المحتوى | المصدر في الكود |
|---|---|---|
| **Rule 7 — HARD cap toxic returns** | `AND (actual_return IS NULL OR ABS(actual_return) <= 50)` في كل KPI query | `live-tracking/route.ts`, `PredictionTrackingDashboard.tsx`, `core/persona_db.py` |
| **Rule 8 — ATR stop [5%, 9%]** | `atr_stop_min_pct=5.0`, `atr_stop_max_pct=9.0` | `engine_settings.py:208`, `core/opportunity_quality.py::enforce_atr_based_stop`, `engines/v38_backtest_engine.py` (ATR clamp) |
| **Rule 9 — Trailing stop = FLOOR** | `trailing_stop = max(trailing_stop, entry_price)` بعد partial exit | `daily_closer.py`, `trailing_stop_activation_gain=2.0` |
| **Rule 10 — EXIT_POLICY partial_1r_trailing** | 50% عند 1R (`partial_exit_at_rr=1.5`) + breakeven + trail الباقي | `portfolio/multi_target_exit.py`, `daily_closer.py` |
| **Rule 18 — R/R ≥ 1.5 (floor) / 1.8 (normal)** | `RR_FLOOR = 1.8` in canonical_flow | `analyzers/canonical_flow.py`, `portfolio/multi_target_exit.py T1_R_MULTIPLE=1.5` |
| **Rule 19 — MAX_POSITION_SIZE = 2.5%** | cap per position | `engine/flow_system.py` |

---

## 📡 الرادار والسيولة

### `liquidity_radar_v2.py` (في `scripts/`)
- **4 أعمدة**: phase + bucket + MFM (Money Flow Multiplier) + تدفق الحيتان.
- `compute_whale_flow` — التدفق بعد خصم حركة السوق (مش مجرد beta).
- **BRAVO-FIX**: التدفق الموجب تحت MA20 = امتصاص خفي مش تصريف.

### `api/canonical_flow.py` — classify_liquidity_bucket()
- **Mutually Exclusive** — دالة مركزية تمنع السهم من الظهور في "تجميع" و"تصريف" معاً.
- `classify_liquidity_bucket()` هو المصدر الوحيد للتصنيف.

### `analyzers/radar_integration.py` — is_radar_strong_accumulation
- **آخر تعديل (BRAVO-RADAR-GATE-UPDATE-1)**: check phase + liquidity_bucket من `liquidity_radar_v2.py`:
  - phase IN ('تراكم مع اتجاه', 'تراكم هادئ') → PASS
  - bucket IN ('strong_whale_inflow', 'moderate_inflow') → PASS
  - phase = 'تصريف' OR bucket = 'whale_outflow' → REJECT
- backward compat: paths القديمة لسه شغّالة.
- safe-by-design: لو مفيش JSON → return False.

### باك تست الربط العكسي (SIMULATION)
| Metric | OLD gate | NEW gate | التغير |
|---|---|---|---|
| عدد التوقعات | 532 | 700 | +168 |
| Win Rate | 46.2% | 72.4% | **+26.2%** |
| Avg Return | 6.87% | 12.62% | +5.75% |

> ⚠️ SIMULATION mode — محتاج production re-run.

---

## 🧪 الباك تست (Backtest)

### السكريبتات الكبرى (في `vps-service/scripts/`)
- `run_backtest.py` / `run_backtest_v2.py` / `run_backtest_v3.py` / `run_all_backtests.py`
- `backtesting_engine.py` — محرك باك تست شامل (يولّد توقعات تاريخية + يقيس النجاح)
- `liquidity_backtest_engine.py` — باك تست السيولة (DUAL-TRACK-PHASE-1)
- `ab_backtest_harness.py` — **A/B قبل/بعد أي تعديل**
- `v40_2_historical_backfill.py` — backfill توقعات V40.2
- `explosive_opportunity_hunter.py` — صائد فرص انفجارية استباقي

### باك تست per-market
- `backtest_egx.py`
- `backtest_crypto.py`
- `backtest_tadawul.py`
- `backtest_kse.py`
- `backtest_qse.py`
- `v40_4_multi_market_backtest.py`
- `v82_backtest.py`
- `comprehensive_ab_backtest.py`

### SMC + Volume Profile (آخر شغل برافو)
**BRAVO-RADAR-ADVANCED-BACKTEST** — قبل (بدون SMC+VP) vs بعد (مع SMC+VP):

| Threshold | Metric | قبل (base) | بعد (SMC+VP) | التغير |
|---|---|---|---|---|
| 65 | Win Rate | 54.5% | 65.9% | +11.3% |
| 65 | Avg Return | 9.38% | 12.61% | +3.23% |
| 70 | Win Rate | 54.6% | 71.1% | +16.5% |
| 70 | Avg Return | 9.47% | 14.30% | +4.83% |

**Score formula**: `new_score = base×75% + SMC×15% + VP×10%`.

> ⚠️ SIMULATION mode (stocks.db backup ناقص stock_daily_prices). محتاج re-run على production DB.
> **النتيجة**: الأسهم اللي SMC+VP بـ boostها أداءها أحسن بـ فرق 53.4% win rate (94.6% vs 41.2%).

---

## 🔁 السكريبتات الكبرى (vps-service/scripts/ + root-level)

### تنظيف + migration
- `db_cleanup.py`, `cleanup_catastrophic.py`, `migrate_*.py`, `smart_db_backup.py`, `daily_backup.py`

### توليد + تعلم
- `paper_trading.py`, `generate_persona_predictions.py`, `build_stock_profiles.py`, `dynamic_exit_optimizer.py`, `optimization_loop.py`, `multi_target_backtest.py`

### root-level scripts في vps-service
- `scanner_cron.py` — Day Trading Scanner كل 15 دقيقة
- `reset_predictions.py` — Production v13 (يضع توقعات عالية الثقة)
- `crypto_predictions_reset.py` + `crypto_live_predictions.py`
- `repair_data_engine.py` — Repair SQLite corruption
- `import_egx30_production.py` — استيراد EGX30 تاريخي
- `align_production_symbols.py` — محاذاة tickers بين DBs
- `cleanup_corrupted_symbols.py`

### root-level scripts/ (339 ملف في `/home/z/my-project/scripts/`)
- backfill, cleanup, utils متعددة.

---

## 📊 الـ 5 Pillars (من الدستور §1)

| Pillar | المحتوى | المصدر في الكود |
|---|---|---|
| **PILLAR-1** | Data Engine (سحب + تنظيف) | `data_engine/` + `vps-service/core/data_source_circuit_breaker.py` |
| **PILLAR-2** | Prediction Engine (V40.2) | `vps-service/jobs/daily_predictor.py` + `engines/backtest_engine.py` |
| **PILLAR-3** | Risk Management (ATR + trailing + partial exit) | `risk_management_advanced.py` + `portfolio/multi_target_exit.py` + `engine_settings.py` |
| **PILLAR-4** | Tracking (honest KPIs + HARD cap) | `analyzers/enhanced_prediction_tracker.py` + `analyzers/feedback_loop.py` + Rule 7 |
| **PILLAR-5** | AI/ML Overlay | `ml_models/ml_overlay_v1.pkl` + `analyzers/feature_extractor.py` + `ai/` |

---

*هذا الملف مكتوب من الكود الحقيقي. لأي تعديل أو إضافة، ارجع للكود الفعلي أولاً. أي توصية بدون دليل أو سند = مرفوضة (Rule 27 — NO-FAKE-DATA).*
