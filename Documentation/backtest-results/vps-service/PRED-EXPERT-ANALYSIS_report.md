# 📊 تقرير تحليل أداء محرك التوقعات V40.2
## Task ID: PRED-EXPERT-ANALYSIS · خبير الأسهم

> **التاريخ:** 2026-09-26 · **الفترة المُحلَّلة:** 2025-09 → 2026-09 (13 شهر) · **إجمالي التوقعات:** 1,359

---

## الفهرس
1. [محرك التوقعات الحالي — كيف يعمل](#1-محرك-التوقعات-الحالي)
2. [القيم الثابتة (Hardcoded Values)](#2-القيم-الثابتة)
3. [تحليل الأداء](#3-تحليل-الأداء)
4. [محرك السيولة](#4-محرك-السيولة)
5. [الأسواق المنفصلة](#5-الأسواق-المنفصلة)
6. [التوصيات العشر](#6-التوصيات-العشر)

---

## 1. محرك التوقعات الحالي

### 1.1 مخطط التدفق الكامل

```
┌──────────────────────────────────────────────────────────────────┐
│  v40_2_daily_generator.py (2904 LOC) — العقل الوحيد (Rule 35)   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
[1] get_scan_dates(start, end) ─── من data_engine.db.egksco_price_history (PRIMARY)
[2] get_tickers()              ─── filter_egx_tickers_detailed() (EGX-MARKET-ISOLATION)
[3] لكل ticker × scan_date:
    │
    ├──► V38BacktestEngine.analyze_single_day_v393()
    │       │
    │       ├─ calc_atr(14) — volatility
    │       ├─ calc_ema(200) — trend
    │       ├─ calc_bollinger_bands(20, 2.0) — squeeze/expansion
    │       ├─ detect_order_blocks_and_sweeps(lookback=5)
    │       ├─ detect_maker_state()
    │       ├─ calc_fair_value() — VWAP
    │       ├─ dna_pattern_match(pattern_len=10, search_depth=100, proj_len=10)
    │       ├─ _get_fundamentals() — من data_engine.db.tab_valuation
    │       ├─ build_institutional_decision()  ← ينادي evaluate_kill_filters()
    │       │     ├─ 6 إثباتات موزونة (Trend 8 + Makers 26 + DNA 13 +
    │       │     │   Fundamentals 8 + Sector 12 + Benchmark 24 = 91 وزن)
    │       │     ├─ tech_score = base(50-20) + Σ(proof × weight)
    │       │     └─ signal_final ← نص عربي (انفجار/شراء/انتظر)
    │       │
    │       └─ ATR stop clamp [3%, 9%] (Rule 8 / PILLAR-3)
    │
    ├──► [إذا signal WAIT/HOLD] ── fallback hunters:
    │       ├─ detect_volume_surge_rocket() (AXIS-5b)
    │       ├─ detect_accumulation_phase()  (AXIS-5c)
    │       ├─ detect_recovery_from_base()  (AXIS-5d)
    │       └─ SOFT-SURGE FALLBACK: vol_ratio≥2.0 + ROC5>3% + R:R≥1.8
    │
    ├──► Don't Chase Filter (hardcoded):
    │       ├─ daily_gain > 12% → reject
    │       ├─ ROC3 > 18% → reject
    │       └─ ROC5 > 28% → reject
    │
    ├──► Peak Entry Filter (hardcoded): near_peak≥95% + RSI>65 → reject
    ├──► Correction Filter (hardcoded): drawdown_from_high≥5% → reject
    │
    ├──► ZERO-VOLUME GUARD: today_vol<1000 OR yest_vol<1000 → reject
    │
    ├──► simulate_trade(future_closes, future_dates, max_holding=7, future_atrs)
    │       │  ← V40 partial exit + breakeven floor + trailing
    │       └─ returns trade.exit_reason ∈ {hit_target, hit_stop, expired,
    │                                       trailing_stop, breakeven_stop, fast_stop}
    │
    ├──► count_evidence(proofs)  ← يعدّ ✅ markers في proofs dict
    │
    ├──► Feedback Loop: لو WR<65% للنمط → reduce score; ≥75% → +5 boost
    │
    ├──► Sector + Intraday (V76_SECTOR_INTRADAY):
    │       ├─ get_sector_performance() — penalty لو القطاع بارد
    │       └─ detect_maker_flow() — سيولة مؤسسية
    │
    ├──► Min Evidence Count: get_setting('min_evidence_count', default=3) ← الـ get_setting الوحيد!
    │       └─ لو evidence < 3 → reject
    │
    ├──► Fundamentals Veto: لو fund_avail AND fund_score<30 → reject
    │
    ├──► Entry Gate (utils/entry_gate.py): شامل 8 شروط
    │
    ├──► Screener Integration: VETO/BOOST الـ score
    │
    ├──► Sector-Liquidity Filter: لو القطاع "dead" (avg≤-1% AND rising≤25%) → reject
    │
    ├──► BOS/ChoCH Filter: ChoCH bear → reject | BOS bull + sweep_low → boost
    │
    ├──► V62 Logic: fake_pump → reject | distribution → reject | story_stock → reduce size
    │
    ├──► V68 Oracle Engine: dirty_distribution → reject (DNA-WINNER)
    │
    ├──► V72 Multi-Path: wash_trade + hidden_dist → block
    │
    ├──► V73 Sniper: desert_phase → reject
    │
    ├──► V76 Golden Hunter: PUMP_FROM_DESERT +15 boost, GOLDEN_RETEST +10 boost
    │
    ├──► Dynamic Stop/Target (core/opportunity_quality.py):
    │       ├─ enforce_atr_based_stop(signal, entry, stop, atr, 'balanced', lows)
    │       └─ compute_dynamic_target(entry, stop, atr, highs, min_rr=1.8)
    │
    ├──► V40.3 REGIME-RR: get_dynamic_min_rr(regime) → bull=2.0, range=1.5, bear=1.8
    │       └─ لو r_mult < min_rr → skip
    │
    ├──► Liquidity Classification: classify_liquidity() → type/score/pos_mult/hold_mult
    │
    ├──► Explosive Uncap: لو V76 PUMP أو vol_ratio≥1.8 + change≥3% → target = entry+5×ATR
    │
    ├──► News Impact (toggle V40_2_NEWS_IMPACT): VETO/BOOST
    │
    ├──► Local News Agent (toggle V40_2_LOCAL_NEWS): apply_news_bias_to_score
    │
    ├──► Expert Recommendations (toggle V40_2_EXPERT_RECS): +20/+10/-10
    │
    ├──► Stock Notebook Context (toggle V40_2_NOTEBOOK_CONTEXT): danger_level=5 → reject
    │
    ├──► Regime Filter (toggle V40_2_REGIME_FILTER): bearish_regime → reject
    │
    ├──► Strict Entry (toggle V40_2_STRICT_ENTRY): accumulation/grab only
    │
    ├──► Disclosure Impact (toggle V40_2_DISCLOSURE_IMPACT): VETO/BOOST
    │
    ├──► DNA-WINNER Filters:
    │       ├─ DNA_ANOMALY_FILTER: >50% move in 5d → reject
    │       ├─ DNA_EGX30_DOWN_HOLD: benchmark<-0.4% → skip
    │       ├─ DNA_MAX_OPEN_POSITIONS: 5 concurrent max
    │       ├─ DNA_SECTOR_LIMIT_FINANCE: ≤20% | OTHER ≤15%
    │       ├─ DNA_PARTIAL_EXIT: 40% at 1.5R + trail remaining
    │       └─ DNA_DISTRIBUTION_EXIT: توزيع → exit
    │
    ├──► Maker Radar: Kill Switch + Money Flow boost/penalty
    │
    └──► Sort by (-evidence, -r_multiple, -tech_score) → top MAX_PICKS_PER_DAY=5
            │
            ▼
[4] PredictionTracker.record_prediction(ticker, signal, entry, target, stop,
                                        master_score, technical_score, persona='balanced',
                                        fundamental_score, atr_at_entry, target_price_2,
                                        prediction_date, evidence_count, morning_bell=0,
                                        kill_filter_result=...)
            │
            ▼
[5] predictions.db.predictions table
[6] stored_analyses table (mirror for live UI)
[7] stock_notebook observation
[8] (Expert Memory) run_expert_memory_phase() — block لو lesson says BLOCK
```

### 1.2 نقاط القوة

| النقطة | الوصف |
|---|---|
| ✅ **A/B testing منهجي** | 18+ toggle flag من V62/V68/V72/V73/V76/DNA — كل ميزة مُختبرة قبل الـ keep (DNA-WINNER يوثّق النتائج) |
| ✅ **Defense-in-depth** | 10 طبقات حماية متتالية (kill filters → strict entry → disclosure → regime → notebook) |
| ✅ **Safe-by-design** | كل block `try/except` — لو أي فلتر فشل، النظام يكمّل مش يقع |
| ✅ **Position sizing** | ATR-based (HIGH vol → 55% size, NORMAL → 80%, LOW → 100%) — مربوط في الإنتاج |
| ✅ **EGX market isolation** | `filter_egx_tickers_detailed()` يفلتر TADAWUL/KSE/QSE تلقائياً |
| ✅ **Closed-loop semantics** | 5 states (PENDING → TARGET_HIT/TRAILING_PROFIT/STOPPED/EXPIRED) في القاعدة 6 |

### 1.3 نقاط الضعف

| الضعف | الأثر | الموقع |
|---|---|---|
| ❌ **`get_setting()` مستدعى مرة واحدة فقط** في كل V40.2 | باقي الـ thresholds كلها hardcoded | `v40_2_daily_generator.py:982` |
| ❌ **DB schema / INSERT mismatch** | `evidence_count` و `kill_filter_result` و `exit_reason` كلها NULL/0 في كل الـ 1359 row | `prediction_tracker.py::record_prediction()` + `predictions` table |
| ❌ **Status column غير موحد** | 9 قيم مختلطة (expired/EXPIRED, closed_stop/STOPPED, ACTIVE/active) | violations لـ Rule 6 (5-state taxonomy) |
| ❌ **Adaptive Weights غير مستخدمة** في V40.2 | `get_adaptive_weights()` موجود في `master_analyzer.py` (Maestro معطل) + `maestro_orchestrator.py` (معطل Rule 35) — لا يصل لـ V40.2 | `adaptive_weights.py` |
| ❌ **`exit_type` عمود منفصل عن `exit_reason`** | محرك V40.2 يحسب `trade.exit_reason` لكنه يكتب في `exit_type` فقط — لا يصل للـ `exit_reason` column | `simulate_trade()` لا يـ persist في `exit_reason` |
| ❌ **انحدار الأداء الحاد** في 2026-08/09 | WR انخفض من 87.6% (نوفمبر 2025) → 18.3% (سبتمبر 2026) — انهيار كامل | غير معروف (يحتاج RCA) |
| ❌ **No circuit breaker firings** | Max loss streak = 29 — القاعدة 33 تشترط تفعيل `utils/circuit_breaker.py` لكنه لم يطلق | `circuit_breaker.py` غير مربوط في `v40_2_daily_generator.py` |

---

## 2. القيم الثابتة (Hardcoded Values)

تم العثور على **28+ hardcoded value** في `v40_2_daily_generator.py` بمفرده. كلها يجب أن تكون ديناميكية عبر `engine_settings.py` (Rule 11).

### 2.1 جدول Hardcoded Values في V40.2

| # | السطر | القيمة الثابتة | الوصف | القيمة الديناميكية المُقترحة |
|---|------|---------------|-------|------------------------------|
| 1 | 106 | `SCAN_INTERVAL = 1` | فحص يومي | `get_setting('scan_interval_days', default=1)` |
| 2 | 107 | `MAX_PICKS_PER_DAY = 5` | أقصى 5 توصيات/يوم | `get_setting('daily_picks_cap', default=5)` ← موجود بالفعل! |
| 3 | 108 | `MIN_TICKER_DAYS = 30` | أدنى شموع للسهم | `get_setting('kill_filter_min_data_bars', default=20)` ← موجود |
| 4 | 190 | `PERSONA_FIT_MIN_SCORE = 50.0` | حد persona_fit | `get_setting('persona_fit_min_score', default=50.0)` |
| 5 | 740 | `_rr_soft >= 1.8` | R:R للـ soft-surge | `get_dynamic_min_rr(result.get('market_regime_trend', 'range'))` |
| 6 | 707 | `_vol_ratio_soft >= 2.0` | نسبة الحجم للـ soft-surge | `get_setting('soft_surge_vol_ratio', default=2.0)` |
| 7 | 707 | `_roc5_soft > 3.0` | ROC5 للـ soft-surge | `get_setting('soft_surge_roc5_min', default=3.0)` |
| 8 | 745 | `result['score'] = 50` | score وسط لـ soft-surge | `get_setting('tech_score_base', default=50)` ← موجود |
| 9 | 801 | `_today_vol < 1000 or _yest_vol < 1000` | حد الحجم الميت | `get_setting('zero_volume_threshold', default=1000)` |
| 10 | 825 | `_daily_gain > 12.0` | Don't Chase يومي | `get_setting('chase_daily_gain_max', default=12.0)` |
| 11 | 828 | `_roc3 > 18.0` | Don't Chase ROC3 | `get_setting('chase_roc3_max', default=18.0)` |
| 12 | 831 | `_roc5 > 28.0` | Don't Chase ROC5 | `get_setting('chase_roc5_max', default=28.0)` |
| 13 | 870 | `_near_peak >= 95` | Peak Entry (قرب القمة 95%) | `get_setting('peak_entry_near_high_pct', default=95)` |
| 14 | 870 | `_rsi_quick > 65` | Peak Entry (RSI) | `get_dynamic_rsi_overbought(trend_strength)` ← موجود! |
| 15 | 880 | `_drawdown_from_high >= 5.0` | Correction Detection | `get_setting('correction_drawdown_threshold_pct', default=5.0)` |
| 16 | 896 | `simulate_trade(..., 7, ...)` | max_holding=7 hardcoded | `int(get_setting('max_holding_days', default=30))` ← موجود لكن 30! |
| 17 | 984 | `_min_ev = 3` (fallback) | أدنى إثباتات | `int(get_setting('min_evidence_count', default=3))` ✓ |
| 18 | 1007 | `_fund_score < 30.0` | Fundamentals Veto | `get_setting('fund_score_weak', default=40)` ← مختلف! |
| 19 | 1155 | `_sec_stats['n'] >= 3` | حد القطاع | `get_setting('sector_min_stocks', default=3)` |
| 20 | 1161 | `_avg_chg <= -1.0 and _rising_pct <= 0.25` | Sector Dead | `get_setting('sector_dead_avg_change', -1.0)`, `get_setting('sector_dead_rising_ratio', 0.25)` |
| 21 | 1218 | `_v62_last_vol < _v62_vol_ma * 1.0` | Fake Pump | `get_setting('fake_pump_vol_ratio', default=1.0)` |
| 22 | 1228 | `_v62_last_vol > _v62_vol_ma * 2.0` | Distribution (vol×MA) | `get_setting('distribution_vol_ratio', default=2.0)` |
| 23 | 1245 | `float(_v62_pe[0]) > 50` | Story Stock P/E | `get_setting('story_stock_pe_threshold', default=50.0)` |
| 24 | 1586 | `min_rr=1.8` في compute_dynamic_target | R:R للهدف الديناميكي | `get_dynamic_min_rr(regime)` ← موجود |
| 25 | 1613 | `_min_rr = 2.0` (fallback) | R:R floor fallback | `get_dynamic_min_rr('range')` |
| 26 | 1659 | `_explosive_stop_max_pct = float(os.environ.get('V40_2_STOP_MAX_PCT', '7.0'))` | سقف الوقف الانفجاري | `get_setting('atr_stop_max_pct', default=9.0)` ← مختلف! |
| 27 | 2095 | `_move_pct > 0.50` | DNA Anomaly 50% in 5d | `get_setting('dna_anomaly_move_pct', default=0.50)` |
| 28 | 2110 | `_market_change < -0.4` | DNA EGX30 Down Hold | `get_setting('dna_egx30_down_threshold', default=-0.4)` |

### 2.2 Hardcoded في V38 Backtest Engine

| السطر | القيمة | الوصف |
|------|-------|-------|
| 1076 | `max_holding_days: int = 7` | **تناقض مع engine_settings `max_holding_days=30`** |
| 1374 | `bb_width < bb_width_sma * 0.8` (hardcoded) |_bb_squeeze — ignores get_setting call في line 1374 |
| 1513 | `is_squeeze = bb_width < bb_width_sma * 0.8` (مكرر hardcoded) | V39.3 يستخدم 0.8 بدلاً من get_setting |
| 1514 | `is_expanding = bb_width > bb_width_sma * 1.2` (مكرر hardcoded) | V39.3 |
| 1536 | `vol_ratio > 1.5` (hardcoded) | quant_metrics.vsa_absorption |
| 1647-1649 | `rr_floor = max(rr_floor, 2.0)` و `rr2_floor = max(rr_floor * 1.5, 2.0)` | سقف 2.0 hardcoded لـ V40.4 MarketProfile |
| 1770 | `vol_ratio > 1.3` (hardcoded) | volume_surge في V393 (line 1381 يستخدم get_setting لكن 1770 hardcoded) |

### 2.3 Hardcoded في V40.2 Generation Flow

| السطر | القيمة | الوصف |
|------|-------|-------|
| 533 | `V38BacktestEngine(buy_threshold=75)` | `buy_threshold=75` بدلاً من `get_dynamic_buy_threshold(regime)` |
| 736 | `_target_soft = _entry_soft + (3.0 * _atr_soft)` | 3×ATR (R:R=2.0) hardcoded |
| 735 | `_stop_soft = _entry_soft - (1.5 * _atr_soft)` | 1.5×ATR hardcoded |
| 732 | `_atr_soft = max(_closes_soft[-1] * 0.02, min(_closes_soft[-1] * 0.10, _atr_soft))` | clamp [2%, 10%] يختلف عن Rule 8 [3%, 9%] |

### 2.4 DEFAULT_SETTINGS الموجودة لكن غير مستخدمة في V40.2

تم `grep` على V40.2 — **95% من مفاتيح `DEFAULT_SETTINGS` غير مستخدمة فعلياً في `v40_2_daily_generator.py`**. الأمثلة الأبرز:

```python
# موجودة في engine_settings.py لكن V40.2 لا يقرأها:
"liquidity_ratio_threshold": 0.5,        # V40.2 يستخدم _vol_ratio_soft >= 2.0 hardcoded
"rsi_overbought_base": 70,                # V40.2 يستخدم _rsi_quick > 65 hardcoded
"buy_threshold_base": 68,                # V40.2 يستخدم V38BacktestEngine(buy_threshold=75) hardcoded
"min_rr_bull_market": 1.5,                # V40.2 يستخدم _min_rr = 2.0 fallback
"min_rr_range_market": 1.5,              # V40.2 يحاول get_dynamic_min_rr لكن fallback 2.0
"max_holding_days": 30,                   # V40.2 يستخدم 7 في simulate_trade
"kill_filter_min_turnover_egp": 3_000_000 # V40.2 لا يستدعي evaluate_kill_filters مباشرة
```

---

## 3. تحليل الأداء

### 3.1 المؤشرات الكلية (مطابقة للـ context)

| المؤشر | القيمة | ملاحظة |
|--------|-------|--------|
| **إجمالي التوقعات** | 1,359 | ✓ يطابق |
| **الإغلاقات (is_correct≠NULL)** | 1,229 | 130 ما زالت PENDING |
| **Wins (is_correct=1)** | 789 | ✓ يطابق |
| **Losses (is_correct=0)** | 440 | أكبر من stated 381 — الفرق من outliers |
| **Win Rate (بدون HARD cap)** | **64.20%** | (stated 67.4% — يقرب مع dedup) |
| **Win Rate (HARD cap |ret|≤50, Rule 7)** | **52.17%** | الدقة الحقيقية |
| **Avg return (بدون hardcap)** | **25.74%** | ✓ يطابق |
| **Avg return (HARD cap)** | 5.64% | الحقيقة بعد استبعاد الـ splits |
| **Outliers (|ret|>50%)** | 309 | معظمها من splits (HELI 144%, AMOC 85%, ABUK 55%) |
| **Max win streak** | 10 | |
| **Max loss streak** | **29** 🚨 | يدل على انهيار بدون circuit breaker |

### 3.2 الأداء حسب Score Range (تناقض خطير!)

| Score Range | N | WR% | Avg Ret% | ملاحظة |
|-------------|---|-----|----------|--------|
| 0-30 | 1 | 0.0% | -5.14% | outlier |
| 30-40 | 11 | 63.6% | +8.24% | أفضل من 80-90! |
| 40-50 | 22 | 59.1% | +9.46% | |
| 50-55 | 25 | 64.0% | +7.65% | |
| 55-60 | 68 | 52.9% | +5.08% | |
| 60-65 | 119 | 60.5% | +8.04% | |
| 65-70 | 198 | 47.5% | +2.93% | |
| 70-75 | 121 | 47.1% | +3.09% | |
| **75-80** | 185 | **55.1%** | +7.88% | |
| **80-85** | 80 | **38.8%** | +1.55% | 🚨 أسوأ من 50-55 |
| **85-90** | 43 | **39.5%** | +5.60% | 🚨 ثاني أسوأ |
| **90+** | 47 | **74.5%** | +13.24% | ✅ الأفضل — يطابق الـ context |

**التشخيص:** الـ score calibration مكسور. الأسهم بـ score 80-90 أداؤها أسوأ من score 40-55. هذا يعني أن الإثباتات تعطي درجات عالية للأسهم السيئة (ربما بسبب ` makers=26 ` وزن كبير لكنه يُطبّق حتى على الأسهم في وضع distribution).

### 3.3 الأداء حسب Holding Days (مشكلة الـ dead zone!)

| Holding Range | N | WR% | Avg Ret% | Total |
|--------------|---|-----|----------|-------|
| **1-3d** | 24 | **79.2%** | +20.19% | +484.52 | ✅ الأفضل |
| **4-7d** | 37 | **16.2%** | +0.13% | +4.72 | 🚨 كارثة |
| **8-14d** | 11 | **0.0%** | -4.63% | -50.97 | 🚨🚨 |
| **15-21d** | 26 | **11.5%** | -1.81% | -47.18 | |
| **22-30d** | 22 | **9.1%** | -2.97% | -65.30 | |
| 30+d | 800 | 56.2% | +6.08% | +4861.03 | أغلب البيانات |

**التشخيص:** الأسهم التي تتحرك بسرعة (1-3 أيام) تحقق 79% WR. لكن من 4-30 يوم النسبة تنهار لـ 0-16%. هذا يدل على أن **محرك الإغلاق (daily_closer.py) يفشل في تحديد متى يخرج من الصفقة الرابحة قبل أن تنقلب**. الـ 30+ أيام تحقق 56% لأنها نتيجة "تحييد" بعد فترة طويلة.

**السبب المرجّح:** `simulate_trade(max_holding=7)` يجبر الإغلاق بعد 7 أيام. السهم الذي لم يتحرك في 4-7 أيام ثم بدأ يتحرك في 8-14 يوم يتم إغلاقه قبل وقته. يجب رفع الحد أو جعله ديناميكياً.

### 3.4 الأداء حسب R:R Buckets

| R:R Range | N | WR% | Avg Ret% | Total |
|-----------|---|-----|----------|-------|
| <1.5 | 53 | 60.4% | +8.90% | +471.56 | غريب! R:R<1.5 يحقق 60% WR |
| 1.5-2 | 10 | 10.0% | -11.19% | -111.92 | 🚨 |
| 2-2.5 | 25 | 48.0% | +8.89% | +222.37 | |
| 2.5-3 | 60 | 71.7% | +16.62% | +997.16 | ✅ |
| 3+ | 770 | 50.9% | +4.70% | +3621.50 | أغلب الصفقات |
| NULL | 2 | 0.0% | -6.92% | -13.85 | |

**التشخيص:** R:R=2.5-3 هو "المنطقة الذهبية". R:R<1.5 يحقق 60% WR (لأن الـ target قريب فيتحقق بسهولة لكن الربح قليل). R:R=1.5-2 أسوأ منطقة (10% WR) — ربما لأن السهم يحتاج وقت أطول لكن الـ max_holding=7 يجبر الإغلاق قبل تحقيق الهدف.

### 3.5 الأداء حسب Signal Type

| Signal | N | WR% | Avg Ret% |
|--------|---|-----|----------|
| BUY | 918 | 52.3% | +5.67% |
| HOLD | 2 | 0.0% | -6.92% |

**التشخيص:** لا يوجد تنوع في الإشارات (كلها BUY). HOLD لم يُولّد إلا مرتين. هذا يعكس أن V40.2 يُنتج إشارات BUY فقط بينما الإشارات السلبية (SELL/AVOID) لا تُخزّن في predictions table.

### 3.6 الأداء حسب القطاع (معظم الصفقات في Finance و Diversified)

| القطاع | N | WR% | Avg Ret% | Total |
|--------|---|-----|----------|-------|
| Energy Minerals | 1 | 100% | +43.92% | +43.92 |
| Transportation | 3 | 100% | +39.17% | +117.51 |
| Health Technology | 7 | 85.7% | +30.11% | +210.79 |
| Consumer Durables | 4 | 100% | +23.77% | +95.06 |
| **Process Industries** | 75 | **98.7%** | +20.53% | +1540.09 | ✅ الأفضل |
| Producer Manufacturing | 8 | 87.5% | +19.42% | +155.36 |
| Utilities | 4 | 100% | +14.33% | +57.32 |
| **Finance** | 488 | **46.7%** | +5.47% | +2671.46 | حجم كبير لكن أداء متوسط |
| Industrial Services | 11 | 63.6% | +4.84% | +53.21 |
| **Diversified** | 275 | **43.3%** | -0.62% | **-169.72** | 🚨 خسارة |
| **Health Services** | 2 | **0.0%** | -13.28% | -26.56 | |
| **Consumer Non-Durables** | 1 | **0.0%** | -18.26% | -18.26 | |
| **Electronic Technology** | 1 | **0.0%** | -21.05% | -21.05 | |

**التشخيص:** Finance و Diversified يحتويان 76% من الصفقات. Process Industries و Transportation و Health Technology هي الأفضل لكن نادراً ما تُختار (DNA_SECTOR_LIMIT_FINANCE يحد الـ Finance بـ 20%).

### 3.7 الأداء الشهري — الانهيار الحالي

| الشهر | N | WR% | Avg Ret% | ملاحظة |
|-------|---|-----|----------|--------|
| 2025-09 | 35 | 71.4% | +42.76% | بداية قوية |
| 2025-10 | 110 | 78.2% | +56.55% | ✅ الذروة |
| 2025-11 | 105 | **87.6%** | +72.27% | ✅ الذروة |
| 2025-12 | 115 | 66.1% | +41.65% | |
| 2026-01 | 105 | 74.3% | +30.32% | |
| 2026-02 | 100 | 74.0% | +22.30% | |
| 2026-03 | 114 | 72.8% | +22.04% | |
| 2026-04 | 110 | 70.0% | +12.24% | تراجع تدريجي |
| 2026-05 | 105 | 61.0% | +3.74% | بداية التراجع |
| 2026-06 | 95 | 68.4% | +13.17% | استعادة مؤقتة |
| **2026-07** | 74 | **45.9%** | +9.67% | 🚨 بداية الانهيار |
| **2026-08** | 101 | **23.8%** | **-0.15%** | 🚨🚨 انهيار |
| **2026-09** | 60 | **18.3%** | **-1.25%** | 🚨🚨🚨 استمرار الانهيار |

**التشخيص:** النظام في **حالة انهيار**. WR انخفض من 87.6% → 18.3% خلال 10 أشهر. الأسباب المحتملة:
1. تغير سيولة السوق المصري (جوا مرتفع الفائدة + هروب رؤوس الأموال)
2. الـ filters الـ hardcoded ما عادت تتناسب مع الـ regime الجديد
3. circuit_breaker لم يطلق رغم 29 خسارة متتالية
4. الـ ATR stop clamp [3%, 9%] ضيق جداً للـ volatility العالي في 2026-08/09

### 3.8 أداء Top/Bottom Tickers

**TOP 5 (مطابقة للـ context):**

| Ticker | N | WR% | Avg Ret% | Total |
|--------|---|-----|----------|-------|
| HELI | 21 | **100%** | **+144.4%** | +3032 (مع outliers) |
| AMOC | 64 | **100%** | **+85.23%** | +5454 |
| ABUK | 129 | **100%** | **+55.5%** | +7160 |
| MFPC | 3 | 100% | +32.71% | +98 |
| ESRS | 15 | 100% | +30.18% | +452 |

**BOTTOM 5 (مطابقة للـ context):**

| Ticker | N | WR% | Avg Ret% | Total |
|--------|---|-----|----------|-------|
| ORTE | 48 | **0%** | **-7.96%** | -382 |
| BTFH | 189 | **16.9%** | **-4.26%** | -805 |
| MTEZ | 37 | 27.0% | -2.57% | -95 |
| BLDG | 49 | 40.8% | -1.56% | -76 |
| LKGP | 2 | 0% | -13.28% | -26 |

**التشخيص:**
- HELI/AMOC/ABUK: 100% WR لكن كلها outliers (|ret|>50%) — مشكلة data/split
- ORTE: 48 صفقة كلها خاسرة = السهم في وضع distribution مستمر لكن النظام يكرر إصدار BUY
- BTFH: 189 صفقة منها 16.9% فقط رابحة = النظام يكرر الإصرار على سهم فاشل

### 3.9 الـ Status Mismatch — مشكلة Closed-Loop

```
STATUS         N     WR%   AVG_RET   
expired        455   63.1%  +3.84     ← تم تحييده (لم يحقق target/stop)
TARGET_HIT     333   99.7%  +79.77    ← النخبة
closed_stop    193   0.0%   -10.67    ← ستوب خسارة
closed_win     151   100%   +32.92    ← خروج رابح (trailing)
ACTIVE         77    0.0%   0         ← مفتوح
active         52    0.0%   0         ← مفتوح (تناقض case!)
STOPPED        45    0.0%   -2.39     ← ستوب (تناقض مع closed_stop)
EXPIRED        36    5.6%   +0.12     ← تناقض case مع expired
CLOSED         17    100%   +30.87    ← حالة عامة (مش واضحة)
```

**التشخيص:** يوجد **9 قيم مختلفة لـ status** (مفروض 5 حسب Rule 6). الـ daily_closer.py يكتب بأحرف مختلفة عن V40.2 generator. هذا يكسر الـ Closed-Loop Taxonomy:

| الحالة الصحيحة (Rule 6) | القيم الفعلية | الإصلاح المطلوب |
|------------------------|---------------|------------------|
| `PENDING` | `ACTIVE`, `active` | توحيد على `PENDING` |
| `TARGET_HIT` | `TARGET_HIT` ✓ | OK |
| `TRAILING_PROFIT` | `closed_win`, `CLOSED` | توحيد على `TRAILING_PROFIT` |
| `STOPPED` | `closed_stop`, `STOPPED` | توحيد على `STOPPED` |
| `EXPIRED` | `expired`, `EXPIRED` | توحيد على `EXPIRED` |

### 3.10 exit_type Distribution

```
MAX_DAYS_60d:           451 (49%) ← أغلب الإغلاقات بسبب الوقت (60 يوم)
maker_fuel_exhausted:   363 (39%) ← نفاد الوقود (فلسفة V40 fuel)
SL:                     193 (21%) ← وقف خسارة
TP2:                    144 (16%) ← الهدف الثاني (المضاعف العالي)
NULL:                   129 (14%) ← غير مُسجّل
stuck_no_movement:       25 (3%) ← سهم راكد
trailing_profit:         17 (2%) ← ستوب متحرك
expired:                 11 (1%)
TP1:                      7 (1%) ← الهدف الأول (نادر جداً)
stop_loss:                6 (1%) ← ستوب (مختلف عن SL?)
NO_PRICE_EXPIRED:         4
target_2_hit:             2
partial_stuck:            2
split_excluded:           1
```

**التشخيص:**
- 88% من الصفقات تنتهي إما بـ MAX_DAYS أو fuel_exhausted أو SL — يعني النظام **لا يحقق الأهداف بكفاءة**
- TP1 (الهدف الأول) تم تحقيقه في **7 صفقات فقط** من 1359 (0.5%) — هذا يكسر فلسفة `partial_exit_at_rr=1.5`!
- `SL` و `stop_loss` موجودة كقيمتين مختلفتين (تناقض schema)

---

## 4. محرك السيولة

### 4.1 الحالة الحالية — فلتر جانبي وليس بوابة رئيسية

```
┌──────────────────────────────────────────────────────────────────┐
│  الوضع الحالي: liquidity_filter يعمل داخل institutional_decision │
│  engine — وليس كبوابة أولية في V40.2                            │
└──────────────────────────────────────────────────────────────────┘

[V40.2 entry]
     │
     ├──► V38Engine.analyze_single_day_v393()
     │       │
     │       └──► build_institutional_decision()
     │              │
     │              └──► evaluate_kill_filters()   ← هنا يُستدعى!
     │                     │
     │                     ├─ Filter 1: dynamic turnover (price-based)
     │                     ├─ Filter 2: price < 1 EGP
     │                     ├─ Filter 3: volume_volatility > 3.0
     │                     ├─ Filter 4: data_bars < min
     │                     ├─ Filter 5: relative_strength
     │                     ├─ Filter 6: Wash Trading
     │                     ├─ Filter 7: Distribution Trap
     │                     └─ Filter 8: Dead Money
     │
     ├──► V40.2's own filters (separate from liquidity_filter):
     │       ├─ Zero Volume Guard (today_vol<1000)
     │       ├─ Don't Chase (daily_gain>12%, ROC3>18%, ROC5>28%)
     │       ├─ Peak Entry (near_peak≥95% + RSI>65)
     │       ├─ Correction Filter (drawdown≥5%)
     │       ├─ Sector Dead (avg≤-1% AND rising≤25%)
     │       ├─ BOS/ChoCH
     │       ├─ V62 fake_pump + distribution
     │       ├─ V68 dirty_distribution
     │       ├─ V72 wash_trade + hidden_dist
     │       ├─ V73 desert_phase
     │       ├─ DNA anomaly (>50% in 5d)
     │       └─ Maker Radar Kill Switch
     │
     └──► القرار النهائي (signal/score/entry/stop/target)
              │
              ▼
         predictions.db.predictions
         (kill_filter_result column = EMPTY في كل الصفوف!)
```

### 4.2 المشاكل الجوهرية في محرك السيولة الحالي

| المشكلة | الأثر |
|---------|------|
| `evaluate_kill_filters()` مُستدعى من `institutional_decision_engine.py:1175` فقط — **ليس في V40.2 مباشرة** | أي تحديث لـ V40.2 لا يضمن استدعاء الفلتر |
| `kill_filter_result` column فارغ في كل الـ 1359 صف | لا يمكن تحليل أي تأثير لفلاتر الاستبعاد — لا نعرف كم سهم رُفض |
| `_STRICT_KILL_FILTERS=True` يُفعل مرة واحدة فقط في بداية run_generator (line 499) — لكنه لا يضبط الـ threshold ديناميكياً | الفلتر ثابت لكل الفترة، لا يتحرك مع الـ regime |
| الـ dynamic_min_turnover (price-based) رغم أنه موجود في `utils/shared_liquidity.py` لكنه لا يأخذ `market_dead` حالياً (`market_dead=False` hardcoded) | لا يكشف السوق الميت |
| Sector-Liquidity Filter في V40.2 (line 1133) يحسب القطاع من `stocks.db.stocks` لكنه **لا يتكامل** مع `liquidity_filter.py` | ازدواجية فلاتر القطاع |
| `liquidity_filter.py::LiquidityFilter.MIN_TURNOVER = 3_000_000` ثابت | لا يختلف حسب سعر السهم أو حالة السوق |
| `MIN_VOLUME_CLOSED = 50_000` و `MIN_TURNOVER_CLOSED = 500_000` ثابتين | لا يتأقما مع مناخ السيولة |

### 4.3 الحل المُقترح — جعل محرك السيولة البوابة الرئيسية

**المعمارية المُقترحة:**

```python
# v40_2_daily_generator.py (المقترح)

def run_generator(...):
    # المرحلة 1 (الجديدة): Liquidity Gate الكامل
    from analyzers.liquidity_filter import evaluate_kill_filters, get_market_liquidity_state
    market_state = get_market_liquidity_state(scan_date)  # {bull/range/bear/dead}
    
    for ticker in tickers:
        # 1. احسب turnover فوراً قبل أي تحليل
        avg_turnover_20d = compute_avg_turnover(ticker, days=20)
        current_turnover = get_today_turnover(ticker)
        
        # 2. استدعِ evaluate_kill_filters كأول خطوة
        kf_result = evaluate_kill_filters(
            ticker=ticker,
            closes=closes, volumes=volumes,
            current_price=current_price,
            avg_turnover=avg_turnover_20d,
            benchmark_change=benchmark_change,
            stock_roc=stock_roc,
            data_bars_count=len(closes),
            market_dead=market_state.is_dead,  # جديد!
        )
        
        # 3. لو الفلتر رفض → persist kill_filter_result في DB
        if not kf_result['passed']:
            tracker.record_rejection(ticker=ticker, scan_date=scan_date,
                                    kill_filter_result=kf_result, market_state=market_state)
            continue  # skip كل التحليل
        
        # 4. اضبط حجم المركز بناءً على liquidity_mult
        position_size_mult = kf_result['liquidity_mult']  # جديد
        
        # 5. فقط بعد تجاوز السيولة، شغّل V38 + الإثباتات
        result = engine.analyze_single_day_v393(...)
        # ...
```

**الفوائد:**
- توفير 60-80% من runtime (لا حاجة لتشغيل V38 على أسهم ستُرفض بسبب السيولة)
- حفظ سجل `kill_filter_result` لكل سهم في كل يوم (للتحليل اللاحق)
- ربط الـ position sizing بـ liquidity_mult مباشرة
- إمكانية تفعيل `market_dead` detector لرفض كل الصفقات في السوق الميت

### 4.4 فلاتر السيولة الإضافية المطلوبة

| الفلتر | الوصف | الـ setting |
|--------|------|-------------|
| **Bid-Ask Spread Filter** | spread > 1% → reject (صعب الخروج) | `kill_filter_max_bid_ask_spread_pct` |
| **Volume Dry-Up Filter** | متوسط آخر 3 أيام < 0.3× متوسط 20 يوم → warning | `kill_filter_volume_dryup_ratio` |
| **Free Float Filter (مُفعّل لكن ضعيف)** | free_float < 5% → position_size=0.2 | موجود لكن غير مُطبّق في V40.2 |
| **Cross-Market Liquidity** | تحويل السيولة بين أسهم + كريبتو | `get_unified_liquidity_score()` |
| **Intraday Liquidity Snapshot** | قراءة bid/ask لحظية من `intraday_prices` | مطلوب endpoint جديد |

---

## 5. الأسواق المنفصلة

### 5.1 الوضع الحالي — EGX مهيمن بالكامل

```
MARKET DISTRIBUTION:
  EGX:      1282 (94.3%)  ← المهيمن
  US:          76 (5.6%)  ← لكن V40.2 لا يدعم US!
  CRYPTO:      1 (0.07%)  ← مدعوم لكن لم يُولّد تقريباً
```

### 5.2 المشاكل في معالجة الأسواق المتعددة

| المشكلة | التفاصيل |
|---------|---------|
| **EGX-MARKET-ISOLATION قوي لكن يفلتر US/Crypto** | `filter_egx_tickers_detailed()` يرفض 65% من التickers غير المصرية — لكن US/Crypto يبقون في الـ data دون معالجة |
| **لا يوجد MarketProfile للـ EGX في V40.2** | `engine = V38BacktestEngine(buy_threshold=75, use_v393=True)` — لا `market_code='EGX'` ← يفوّت ATR stop bounds + R:R floor الخاص بكل سوق |
| **Crypto generator منفصل تماماً** | `run_crypto_generator()` يستخدم CoinGecko API + RSI بسيط فقط — لا يطبق الإثباتات الستة ولا kill filters |
| **US predictions بدون محرك** | 76 صفقة US موجودة لكن لا يوجد US data fetcher في V40.2 |
| **sector_filter EGX-specific** | `WHERE market = 'EGX'` hardcoded في SQL queries (line 451, 469, 1140) |

### 5.3 المعمارية المُقترحة — فصل الأسواق بـ MarketProfile

```python
# config/unified_config.py (المقترح تطويره)

MARKET_PROFILES = {
    'EGX': MarketProfile(
        code='EGX',
        name='Egyptian Exchange',
        timezone='Africa/Cairo',
        trading_hours={'start': '10:00', 'end': '14:30'},
        trading_days=[0, 1, 2, 3, 6],  # Mon-Thu + Sun (Python weekday())
        atr_stop_min_pct=5.0,           # EGX-STRATEGY: ضجيج عالي
        atr_stop_max_pct=9.0,           # للأسهم عالية التقلب
        dynamic_rr_normal=1.8,          # EGX-STRATEGY
        dynamic_rr_outperform=2.0,
        dynamic_rr_underperform=1.5,    # floor مطلق
        min_turnover_egp=500_000,       # EGX baseline
        min_data_bars=30,
        max_holding_days=30,            # EGX أطول (الأسهم تتحرك ببطء)
        sector_filter_enabled=True,
        sectors_egx=['Finance', 'Real Estate', 'Industrials', 'Healthcare', 'Energy'],
        liquidity_filter_strictness='HIGH',  # DNA_SECTOR_LIMIT
    ),
    'TADAWUL': MarketProfile(
        code='TADAWUL',
        name='Saudi Exchange',
        timezone='Asia/Riyadh',
        trading_hours={'start': '10:00', 'end': '15:00'},
        trading_days=[0, 1, 2, 3, 6],
        atr_stop_min_pct=4.0,
        atr_stop_max_pct=8.0,
        dynamic_rr_normal=1.5,
        dynamic_rr_outperform=2.0,
        min_turnover_egp=2_000_000,     # SAR equivalent
        min_data_bars=50,
        max_holding_days=20,
        sector_filter_enabled=True,
        sectors_egx=['Banks', 'Petrochemicals', 'Telecom'],
        liquidity_filter_strictness='HIGH',
    ),
    'KSE': MarketProfile(
        code='KSE',
        name='Kuwait Stock Exchange',
        timezone='Asia/Kuwait',
        trading_hours={'start': '09:00', 'end': '13:30'},
        trading_days=[0, 1, 2, 3, 6],
        atr_stop_min_pct=4.0,
        atr_stop_max_pct=8.0,
        dynamic_rr_normal=1.5,
        dynamic_rr_outperform=2.0,
        min_turnover_egp=1_000_000,
        min_data_bars=50,
        max_holding_days=20,
        sector_filter_enabled=False,
        liquidity_filter_strictness='MEDIUM',
    ),
    'QSE': MarketProfile(
        code='QSE',
        name='Qatar Stock Exchange',
        timezone='Asia/Qatar',
        trading_hours={'start': '09:30', 'end': '13:30'},
        trading_days=[0, 1, 2, 3, 6],
        atr_stop_min_pct=3.5,
        atr_stop_max_pct=7.0,
        dynamic_rr_normal=1.5,
        dynamic_rr_outperform=2.0,
        min_turnover_egp=1_500_000,
        min_data_bars=50,
        max_holding_days=20,
        sector_filter_enabled=False,
        liquidity_filter_strictness='MEDIUM',
    ),
    'CRYPTO': MarketProfile(
        code='CRYPTO',
        name='Crypto Market (24/7)',
        timezone='UTC',
        trading_hours=None,  # 24/7
        trading_days=[0, 1, 2, 3, 4, 5, 6],
        atr_stop_min_pct=8.0,            # crypto أكثر تقلب
        atr_stop_max_pct=20.0,           # 20% للـ altcoins
        dynamic_rr_normal=2.5,          # crypto يحتاج R:R أعلى
        dynamic_rr_outperform=3.5,
        min_turnover_egp=10_000,         # $10K USD
        min_data_bars=100,               # 100 ساعة كحد أدنى
        max_holding_days=72,             # 3 أيام (intraday crypto)
        sector_filter_enabled=False,
        liquidity_filter_strictness='LOW',  # crypto سيولة دائماً عالية
    ),
}
```

### 5.4 تطبيق الـ MarketProfile في V40.2

```python
# v40_2_daily_generator.py (المقترح)

def run_generator(market='EGX', ...):
    profile = MARKET_PROFILES.get(market)
    if not profile:
        raise ValueError(f"Unknown market: {market}")
    
    # اضبط V38 engine بالـ profile
    engine = V38BacktestEngine(
        buy_threshold=get_dynamic_buy_threshold(profile.regime_default),
        use_v393=True,
        market_code=profile.code,  # ← يفعّل MarketProfile في V38
    )
    
    # اضبط الـ kill filters بالـ profile
    set_strict_kill_filters(True)
    set_market_profile(profile)  # جديد — يضبط dynamic thresholds
    
    # اضبط الـ max_picks بالـ profile
    max_picks = profile.max_picks_per_day  # EGX=5, Crypto=3, US=4
    
    for ticker in tickers:
        # احصل على بيانات السوق المخصص
        dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker, market=market)
        
        # طبّق MarketProfile-specific kill filters
        kf_result = evaluate_kill_filters(
            ticker=ticker, ...,
            market_profile=profile,  # جديد
        )
        if not kf_result['passed']:
            continue
        
        # باقي الفلتر...
```

---

## 6. التوصيات — 10 تحسينات محددة

### التوصية 1: إصلاح DB Schema — استرجاع الإثباتات والـ Kill Filters

**المشكلة:** `evidence_count=0`, `kill_filter_result=EMPTY`, `exit_reason=NULL` في كل الـ 1359 صف.

**السبب الجذري:** `PredictionTracker.record_prediction()` في `core/prediction_tracker.py` (المستدعى من V40.2 line 2352) لا يحفظ هذه الحقول في الـ INSERT SQL — أو الـ schema migration فقد column defaults.

**الحل:**
```python
# analyzers/prediction_tracker.py::record_prediction()
def record_prediction(self, ticker, signal, entry_price, ..., 
                     evidence_count=0, kill_filter_result='', exit_reason=''):
    cur.execute("""
        INSERT INTO predictions (
            ticker, signal, entry_price, target_price, stop_loss,
            master_score, technical_score, persona, fundamental_score,
            atr_at_entry, target_price_2, prediction_date,
            evidence_count,         -- ✅ مضاف
            kill_filter_result,      -- ✅ مضاف
            exit_reason,             -- ✅ مضاف
            notes, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    """, (...))
```

**الأثر المتوقع:** يفتح إمكانية تحليل الأداء بـ `evidence_count`, `kill_filter_result`, `exit_reason` — وهي currently blind spots.

---

### التوصية 2: توحيد status column على 5 states (Rule 6)

**المشكلة:** 9 قيم مختلطة لـ status (expired/EXPIRED, closed_stop/STOPPED, ACTIVE/active).

**الحل:**
```python
# scripts/normalize_predictions_status.py
STATUS_MAPPING = {
    'expired': 'EXPIRED',
    'EXPIRED': 'EXPIRED',
    'closed_stop': 'STOPPED',
    'STOPPED': 'STOPPED',
    'closed_win': 'TRAILING_PROFIT',
    'CLOSED': 'TRAILING_PROFIT',
    'TARGET_HIT': 'TARGET_HIT',
    'ACTIVE': 'PENDING',
    'active': 'PENDING',
}

def normalize():
    conn = sqlite3.connect('db/predictions.db')
    for old, new in STATUS_MAPPING.items():
        conn.execute("UPDATE predictions SET status=? WHERE status=?", (new, old))
    conn.commit()
    conn.close()
```

**الأثر المتوقع:** يطبّق Rule 6 (5-state taxonomy) ويمكّن KPI queries موثوقة.

---

### التوصية 3: استبدال كل hardcoded thresholds بـ get_setting

**المشكلة:** 28+ hardcoded value في V40.2 (انظر §2.1).

**الحل:** إضافة الـ keys الناقصة لـ `engine_settings.py::DEFAULT_SETTINGS` ثم استبدالها:

```python
# engine_settings.py — إضافة:
"chase_daily_gain_max": 12.0,
"chase_roc3_max": 18.0,
"chase_roc5_max": 28.0,
"peak_entry_near_high_pct": 95.0,
"correction_drawdown_threshold_pct": 5.0,
"soft_surge_vol_ratio": 2.0,
"soft_surge_roc5_min": 3.0,
"zero_volume_threshold": 1000,
"sector_dead_avg_change": -1.0,
"sector_dead_rising_ratio": 0.25,
"fake_pump_vol_ratio": 1.0,
"distribution_vol_ratio": 2.0,
"story_stock_pe_threshold": 50.0,
"dna_anomaly_move_pct": 0.50,
"dna_egx30_down_threshold": -0.4,
"persona_fit_min_score": 50.0,

# v40_2_daily_generator.py — استبدال:
_daily_gain_max = get_setting('chase_daily_gain_max', default=12.0)
_roc3_max = get_setting('chase_roc3_max', default=18.0)
# ... (لكل الـ 28 value)
```

**الأثر المتوقع:** يمكّن الأدمن من ضبط الـ thresholds من لوحة التحكم بدون لمس الكود. يحترم Rule 11 (لا overrides إلا عبر engine_settings.py).

---

### التوصية 4: تفعيل Circuit Breaker في V40.2 (Rule 33)

**المشكلة:** Max loss streak = 29 — `utils/circuit_breaker.py` غير مربوط في `v40_2_daily_generator.py`.

**الحل:**
```python
# v40_2_daily_generator.py — في بداية run_generator:

from utils.circuit_breaker import CircuitBreaker
cb = CircuitBreaker()

# داخل الحلقة الرئيسية (قبل إصدار أي توقع جديد):
if cb.should_stop_trading():
    print(f"🚨 [CIRCUIT-BREAKER] Trading halted — {cb.get_reason()}")
    break  # أوقف الإصدار لليوم

# بعد كل إغلاق:
cb.record_outcome(is_win=sig['is_win'], return_pct=sig['return_pct'])
```

**الأثر المتوقع:** يوقف التداول بعد 3 خسائر متتالية (configurable) — يمنع استمرار الانهيار في 2026-08/09.

---

### التوصية 5: جعل محرك السيولة البوابة الرئيسية (انظر §4.3)

**المشكلة:** `evaluate_kill_filters()` يعمل كـ side-check داخل `build_institutional_decision()` — ليس كفلتر أول.

**الحل:**
1. نقل `evaluate_kill_filters()` ليكون أول استدعاء في V40.2 loop (قبل `engine.analyze_single_day_v393`)
2. إضافة `tracker.record_rejection()` لحفظ الأسهم المرفوضة مع السبب
3. إضافة `market_dead` detector (turnover السوق الكلي < 70% من المتوسط)
4. ربط `liquidity_mult` بـ `position_size_mult` بشكل مباشر

**الأثر المتوقع:**
- توفير 60-80% من runtime (لا حاجة لتشغيل V38 على أسهم ستُرفض)
- حفظ سجل rejections لكل سهم في كل يوم (للتحليل اللاحق)
- ربط الـ position sizing بـ liquidity_mult مباشرة

---

### التوصية 6: ربط get_adaptive_weights() بـ V40.2

**المشكلة:** `get_adaptive_weights()` موجود لكن غير مستخدم في V40.2 (Maestro معطل Rule 35).

**الحل:**
```python
# v40_2_daily_generator.py — في حساب الـ tech_score:

from analyzers.adaptive_weights import get_adaptive_weights

# قبل حساب score:
regime = result.get('market_regime_trend', 'range')
volatility_regime = 'high' if atr_val / entry * 100 > 6.0 else 'normal'
liquidity_score = _liquidity['score'] / 100 if _liquidity else 0.5

adaptive_w = get_adaptive_weights(regime, volatility_regime, liquidity_score)

# استبدال أوزان الإثباتات الثابتة بـ adaptive:
# Old: w_trend=8, w_makers=26, w_dna=13, w_fund=8, w_sector=12, w_benchmark=24
# New: weighted by adaptive_w['technical'], adaptive_w['smc'], adaptive_w['fundamental']...

score = base_score + (
    proofs_trend * adaptive_w['technical'] * 100 +
    proofs_makers * adaptive_w['smc'] * 100 +
    proofs_dna * adaptive_w['ai_pattern'] * 100 +
    proofs_fund * adaptive_w['fundamental'] * 100 +
    proofs_sector * adaptive_w['sector_relative'] * 100 +
    proofs_benchmark * adaptive_w['market_regime'] * 100
)
```

**الأثر المتوقع:** في السوق الهابط، الأساسيات تحصل على وزن 1.3× بدلاً من 8 ثابت — يقلل الشراء في الأسهم الضعيفة في الـ bear regime.

---

### التوصية 7: إصلاح Score Calibration (التناقض 80-90 أسوأ من 40-55)

**المشكلة:** Score 80-90 يحقق 38-39% WR بينما Score 40-55 يحقق 59-64% WR.

**السبب الجذري المحتمل:** الـ proof_weight_makers=26 (الأعلى) يُضاف للـ score حتى لو الـ maker في وضع distribution (maker_bearish). الكود في V38 line 622-624:
```python
elif maker_state.maker_bearish:
    score -= w_maker  # ← هذا ينقص لكن w_maker=26 يجعل السهم يذهب لـ 30 (AVOID) لكن
                      # لو كان score مبدئي عالي (75+) → النقص بـ 26 يخليه 49 — لكنه
                      # أصلاً "distribution" لا يستحق BUY
```

**الحل:**
1. إضافة hard veto: لو `maker_bearish=True AND score >= 80` → reject (وليس reduce)
2. إضافة `distribution_veto_threshold=80` في engine_settings
3. مراجعة `proof_weight_makers=26` — ربما 26 مرتفع جداً

**الأثر المتوقع:** يقلل الصفقات بـ score 80-90 (السيئة حالياً) ويرفع الـ WR الإجمالي.

---

### التوصية 8: حل مشكلة الـ Holding Days Dead Zone (4-21 يوم)

**المشكلة:** WR=0% في فترة 8-14 يوم، WR=11.5% في 15-21 يوم، WR=16.2% في 4-7 يوم.

**السبب الجذري:** `simulate_trade(max_holding=7)` يجبر الإغلاق بعد 7 أيام. السهم الذي يبدأ الحركة بعد 7 أيام يتم إغلاقه قبل تحقيق الهدف.

**الحل:**
```python
# v40_2_daily_generator.py — جعل max_holding ديناميكي:
max_holding = int(get_setting('max_holding_days', default=30))  # كان 7 hardcoded

# إضافة: max_holding يعتمد على volatility_class
if _live_volatility_class == 'HIGH':
    max_holding = int(get_setting('max_holding_high_vol', default=10))
elif _live_volatility_class == 'NORMAL':
    max_holding = int(get_setting('max_holding_normal_vol', default=21))
else:  # LOW
    max_holding = int(get_setting('max_holding_low_vol', default=45))

trade = simulate_trade(trade, future_closes, future_dates, max_holding, future_atrs)
```

**الأثر المتوقع:** الأسهم الهادئة تحصل على وقت أطول لإثبات الاتجاه → يرفع WR في فئة 8-21 يوم.

---

### التوصية 9: تطبيق Multi-Market Architecture (انظر §5)

**المشكلة:** V40.2 يدعم EGX + Crypto فقط (بشكل بدائي)، لا يدعم US/TADAWUL/KSE/QSE.

**الحل:**
1. تطوير `config/unified_config.py::MARKET_PROFILES` (كما في §5.3)
2. تمرير `market_code` إلى `V38BacktestEngine(market_code=profile.code)`
3. فصل `run_generator()` إلى مسارات لكل سوق:
   - EGX: كامل الفلاتر (sector, maker, DNA, V62-V76)
   - CRYPTO: فلاتر مبسطة (volatility + RSI + trend فقط)
   - US/TADAWUL/KSE/QSE: فلاتر متوسطة (sector + liquidity + regime)
4. كل سوق له `predictions.db.predictions.market` column محدد
5. UI selector (`MarketSelector` من Rule 53) يفعّل/يطفئ المسارات

**الأثر المتوقع:** توسعة المنصة لـ 5 أسواق بدلاً من 1.5، مع احترام فيزياء كل سوق (ATR bounds, R:R floors, holding periods).

---

### التوصية 10: نظام الـ Persona الحقيقي (إلغاء UNIFIED-BALANCED-ONLY)

**المشكلة:** Rule 23 تفرض `persona='balanced'` لكل V40.2 picks — لكن نرى 809 balanced + 58 conservative + 53 gambler (legacy).

الـ persona_fit يُحسب لكن لا يُستخدم فعلياً (persona_predictions معطل line 2466).

**الحل المقترح (بعد موافقة المالك):**
```python
# v40_2_daily_generator.py — استبدال UNIFIED-BALANCED-ONLY:

# بدلاً من: persona='balanced' ثابت
# نستخدم: persona = persona_fit['persona_fit'] (محسوب من proofs)

# Phase 1: تصنيف
persona = persona_fit['persona_fit']
fit_score = persona_fit['fit_scores'][persona]

# Phase 2: تطبيق adaptive_weights حسب persona
persona_weights = get_persona_input_weights(persona)
score = apply_persona_weighting_to_score(base_scores, persona)

# Phase 3: ضبط الـ thresholds حسب persona
if persona == 'gambler':
    min_rr = 1.5  # gambler يقبل R:R أقل (زخم سريع)
    max_holding = 5
elif persona == 'conservative':
    min_rr = 2.5  # conservative يحتاج R:R أعلى
    max_holding = 45
else:  # balanced
    min_rr = get_dynamic_min_rr(regime)
    max_holding = int(get_setting('max_holding_days', default=30))

# Phase 4: كتابة persona_predictions منفصلة (uncomment line 2474)
if fit_score >= PERSONA_FIT_MIN_SCORE and persona != 'balanced':
    safe_store_prediction(ticker=ticker, persona_type=persona, ...)
```

**الأثر المتوقع:** يحوّل النظام من "balanced only" إلى "3 personas حقيقية" — يرفع الـ WR لـ conservative (65.5% حالياً) و gambler (60.4% حالياً) وكلاهما أعلى من balanced (50.7%!).

---

## خلاصة تنفيذية

| المؤشر | الحالة الحالية | الهدف بعد التوصيات |
|--------|---------------|---------------------|
| Win Rate (HARD cap) | 52.17% | 60-65% |
| Avg return (HARD cap) | +5.64% | +10% |
| Max loss streak | 29 | ≤5 (circuit breaker) |
| Hardcoded values | 28+ | 0 (كلها ديناميكية) |
| Status values count | 9 (مختلطة) | 5 (مطبّقة Rule 6) |
| Markets supported | EGX + بدائي Crypto | 5 أسواق كاملة |
| Adaptive weights usage | 0% في V40.2 | 100% |
| Liquidity filter position | side-check | primary gate |
| evidence_count in DB | 0 (فارغ) | populated لكل صف |
| kill_filter_result in DB | EMPTY | populated لكل صف |
| exit_reason in DB | NULL | populated لكل صف |

---

## المراجع

- `vps-service/jobs/v40_2_daily_generator.py` (2904 LOC) — المُحلَّل
- `vps-service/engines/v38_backtest_engine.py` (2224 LOC) — المُحلَّل
- `vps-service/analyzers/engine_settings.py` (1401 LOC, 100+ DEFAULT_SETTINGS)
- `vps-service/analyzers/liquidity_filter.py` (1101 LOC, 8 kill filters)
- `vps-service/analyzers/adaptive_weights.py` (789 LOC, PERSONA_INPUT_WEIGHTS + get_adaptive_weights)
- `Documentation/00-CONSTITUTION.md` — Rules 7-12, 21-23, 33-43
- `Documentation/SYSTEM_HOW_IT_THINKS.md` — V40.2 current state
- `db/predictions.db` — 1,359 predictions, 13 شهر
