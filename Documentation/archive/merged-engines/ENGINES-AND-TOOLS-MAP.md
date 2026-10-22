# 🗺️ خريطة المحركات والأدوات المتقدمة (Engines & Tools Map)

> **بوكس برافو** — جرد كامل لكل محرك/أداة بتطلع score أو قرار.
> **الفترة:** 2026-10-19
> **الـ goal:** فهم المخ كله قبل أي تعديل.
> **القاعدة:** قراءة الكود الفعلي، مش الكومنتات.

---

## 📊 الإحصائيات الإجمالية

| المؤشر | القيمة |
|--------|--------|
| **إجمالي ملفات analyzers/** | 70+ ملف Python |
| **إجمالي ملفات engines/** | 2 (backtest_engine + market_regime) |
| **إجمالي ملفات jobs/** | 16 (daily_predictor + daily_closer + إلخ) |
| **المحركات المربوطة بـ V40.2 فعلاً** | 21 أداة |
| **المحركات المعطلة (DEAD CODE)** | 14 أداة |
| **المحركات اللي بـ تـ produce score 0-100** | 18 أداة |

---

## 🎯 السؤال الحاسم: مين بـ يـ produce الـ master_score اللي بـ يدخل predictions.db؟

بعد الفحص الفعلي للكود:

```
V40.2 (daily_predictor.py)
   ↓
يستدعي calculate_score_and_proofs() من engines/backtest_engine.py (V38)
   ↓
V38 بـ يـ produce score = 30 + (trend_up?15) + (maker_bullish?20) + (dna_bullish?15)
                       + (fund_strong?15) + (sector>0?10) + (sector>1?5)
   ↓
V40.2 بـ يـ apply 17 boost محتملة (معظمها مش شغّال في الـ backfill)
   ↓
الـ score النهائي بـ يـكتب في predictions.master_score
```

**النتيجة**: V38 هو الـ brain الحقيقي. باقي الأدوات إما filters (reject/accept) أو boosts (مش شغّالة) أو dead code.

---

## 📋 الجرد الكامل لكل أداة

### 🔴 الطبقة 1: المحركات الأساسية (Core Engines)

#### 1. `engines/backtest_engine.py` — **V38 Engine** ⭐ CORE
- **الحجم**: 2,374 سطر
- **بيحسب إيه**: `calculate_score_and_proofs()` — score 0-100 + 5 proofs
- **الـ formula**:
  ```python
  score = 30  # base
  if trend_up:           score += 15   # +15
  if maker_bullish:      score += 20   # +20
  if dna_bullish:        score += 15   # +15
  if fundamentals_strong: score += 15  # +15
  if sector_change > 0:  score += 10   # +10
  if sector_change > 1.0: score += 5   # +5
  # max = 110 → capped at 100
  ```
- **بيانات قديمة/حديثة**: بـ يقرأ من `data_engine.db.egksco_price_history` (HARDCODED) — ضحلة (median=25 صف/ticker)
- **مربوط بـ V40.2**: ✅ نعم — هو الـ score producer الرئيسي
- **آخر تشغيل بجد**: شغّال دلوقتي (لكن بـ بيانات ضحلة)
- **الحكم**: 🔴 **السرطان الأول** — 6 boolean conditions بـ تـ produce 100 بسهولة

#### 2. `analyzers/master_analyzer.py` — **MasterAnalyzer** ⚠️ PARTIAL
- **الحجم**: 5,763 سطر (ضخم جداً)
- **بيحسب إيه**: 8-layer confluence (MACD + Candlestick + Fibonacci + RSI + MA + Bollinger + Volume + Support/Resistance)
- **بيانات قديمة/حديثة**: `load_merged_history()` — price_history.db + yahoo_clean + egksco merge (301 صف لـ COMI)
- **مربوط بـ V40.2**: ⚠️ **PARTIAL** — V40.2 بـ يقول في comment (L1770): "MasterAnalyzer مش بيشتغل كامل — بس نأخذ SMC + VP"
- **آخر تشغيل بجد**: شغّال في chart_routes + misc_routes + risk_routes، بس **مش في V40.2**
- **الحكم**: ⚠️ **كنز مهجور** — 5,763 سطر فيها logic ضخم بس V40.2 مش بـ يستخدمه. فيه `_calc_macd` و `_ema_seeded` مكررة (اتصلحت في التوحيد).

#### 3. `analyzers/core_scoring_engine.py` — **CoreScoringEngine** ⚠️ PARTIAL
- **الحجم**: 2,573 سطر
- **بيحسب إيه**: 4 scorers (Technical + Volume + Candlestick + Fundamental) → 0-100 + RiskCalculator + adaptive_rr + persona overrides
- **بيانات قديمة/حديثة**: بـ يقرأ من caller (مش بـ يجيب بيانات بنفسه)
- **مربوط بـ V40.2**: ⚠️ **PARTIAL** — V40.2 بـ يستدعي بس 3 functions: `detect_volume_surge_rocket` + `detect_accumulation_phase` + `detect_recovery_from_base` (L124, L922-975)
- **آخر تشغيل بجد**: شغّال بس في partial mode (3 functions من 25+)
- **الحكم**: ⚠️ **كنز مهجور** — 2,573 سطر فيها TechnicalScorer + VolumeScorer + CandlestickScorer + FundamentalScorer، V40.2 مش بـ يستخدمهم

---

### 🟢 الطبقة 2: المحركات المربوطة بـ V40.2 فعلاً (21 أداة)

#### 4. `analyzers/smc_engine.py` — **SMC (Smart Money Concepts)** ✅ WIRED
- **الحجم**: 452 سطر
- **بيحسب إيه**: Order Blocks + Fair Value Gaps + Liquidity Sweeps → `calculate_smc_score()` 0-100
- **بيانات قديمة/حديثة**: بـ يقرأ OHLCV من caller
- **مربوط بـ V40.2**: ✅ نعم (L3304) — `calculate_smc_score(candles, current_price)` → 0-100
- **آخر تشغيل بجد**: شغّال في V40.2 (combined_score = base×75% + SMC×15% + VP×10%)
- **الحكم**: ✅ **شغّال** — لكن الوزن 15% بس، ممكن نـزوده

#### 5. `analyzers/volume_profile.py` — **Volume Profile Analyzer** ✅ WIRED
- **الحجم**: 337 سطر
- **بيحسب إيه**: VWAP + OBV + A/D Line + Volume Nodes + spike detection → 0-100
- **بيانات قديمة/حديثة**: بـ يقرأ prices+volumes من caller
- **مربوط بـ V40.2**: ✅ نعم (L3319-3340) — `VolumeProfileAnalyzer().analyze()` → 0-100
- **آخر تشغيل بجد**: شغّال في V40.2 (combined_score weight = 10%)
- **الحكم**: ✅ **شغّال** — لكن الوزن 10% بس

#### 6. `analyzers/v68_oracle.py` — **V68 Oracle** ✅ WIRED (PARTIAL)
- **الحجم**: 737 سطر
- **بيحسب إيه**: Delta Volume + Quiet Accumulation + Dirty Distribution + Liquidity Magnets + Liquidity Grab + Future Fingerprint → probability 0-100
- **بيانات قديمة/حديثة**: بـ يقرأ OHLCV من caller
- **مربوط بـ V40.2**: ✅ نعم (L1891) — `analyze_oracle()` → probability + A+ flag
- **آخر تشغيل بجد**: شغّال، بس فيه A/B toggles (L205-217):
  - ✅ KEEP `V68_DIRTY_DIST_REJECT` (+3.2% WR, +22.5% return)
  - ❌ KILL `V68_NO_CHASE_2D_REJECT` (0 triggers)
  - ❌ KILL `V68_PROOF_PROBABILITY` (avg prob 31.7)
  - ❌ KILL `V68_APLUS_BOOST` (1 trigger, 0 تأثير)
  - ❌ KILL `V68_MAGNETIC_TARGET` (0 triggers)
- **الحكم**: ⚠️ **شغّال بس 4/5 features معطّلة** — الكنز الحقيقي هو dirty_dist_reject

#### 7. `analyzers/multi_path_detector.py` — **Multi-Path Detector** ✅ WIRED
- **الحجم**: 502 سطر
- **بيحسب إيه**: كشف أنماط متعددة (pre_surge + quiet_accumulation)
- **مربوط بـ V40.2**: ✅ نعم (L1999)
- **الحكم**: ✅ شغّال

#### 8. `analyzers/golden_hunter.py` — **V76 Golden Hunter** ✅ WIRED
- **الحجم**: 410 سطر
- **بيحسب إيه**: V76 signals (PUMP_FROM_DESERT + GOLDEN_RETEST)
- **مربوط بـ V40.2**: ✅ نعم (L2136) — `analyze_v76()` → boosts (+15 / +10)
- **الحكم**: ✅ شغّال (boosts مش بـ تـ affect الـ backfill، بس هـ تـ affect production)

#### 9. `analyzers/sniper_detector.py` — **V73 Sniper Detector** ✅ WIRED
- **الحجم**: 220 سطر
- **بيحسب إيه**: Desert Phase + Auction Trap + Kill Switch
- **مربوط بـ V40.2**: ✅ نعم (L2096)
- **الحكم**: ✅ شغّال

#### 10. `analyzers/radar_integration.py` — **Radar Integration** ✅ WIRED (HARD GATE)
- **الحجم**: 393 سطر
- **بيحسب إيه**: HARD GATE — يرفض التوقعات لو السهم مش في accumulation phase
- **مربوط بـ V40.2**: ✅ نعم (L1569, L2910) — `is_radar_confirmed_accumulation()`
- **الحكم**: ✅ **شغّال + مهم** — الـ HARD GATE الوحيد

#### 11. `analyzers/feedback_loop.py` — **Feedback Loop** ✅ WIRED
- **الحجم**: 358 سطر
- **بيحسب إيه**: pattern WR تاريخي → boost/penalty
- **مربوط بـ V40.2**: ✅ نعم (L1274) — `get_pattern_win_rate()`
- **الحكم**: ✅ شغّال (boost +5 لو WR ≥ 75%)

#### 12. `analyzers/stock_notebook.py` — **Stock Notebook** ✅ WIRED
- **الحجم**: 950 سطر
- **بيحسب إيه**: ذاكرة دائمة لكل سهم + score_adjustment
- **مربوط بـ V40.2**: ✅ نعم (L1926, L2030, L2110, L2552)
- **الحكم**: ✅ شغّال

#### 13. `analyzers/intraday_reader.py` — **Intraday Reader** ✅ WIRED
- **بيحسب إيه**: Sector Performance + Maker Flow
- **مربوط بـ V40.2**: ✅ نعم (L1293) — `get_sector_performance()` + `detect_maker_flow()`
- **الحكم**: ✅ شغّال (boost +8 sector hot / +12 maker buying)

#### 14. `analyzers/fundamental_data_provider.py` — **Fundamental Provider** ✅ WIRED
- **الحجم**: 750+ سطر
- **بيحسب إيه**: PE + ROE + PB + Margin + Dividend + Growth → score 0-100
- **مربوط بـ V40.2**: ✅ نعم (L1381) — `get_fundamental_score()`
- **الحكم**: ✅ شغّال

#### 15. `analyzers/market_regime_engine.py` — **Market Regime Engine** ✅ WIRED
- **بيحسب إيه**: Market regime (bull/range/bear) + min_rr per regime
- **مربوط بـ V40.2**: ✅ نعم (L722, L761)
- **الحكم**: ✅ شغّال

#### 16. `analyzers/regime_filter.py` — **Regime Filter** ✅ WIRED
- **بيحسب إيه**: `is_bullish_regime()` filter
- **مربوط بـ V40.2**: ✅ نعم (L2595)
- **الحكم**: ✅ شغّال

#### 17. `analyzers/strict_entry_filters.py` — **Strict Entry Filters** ✅ WIRED
- **بيحسب إيه**: `evaluate_strict_entry()` + `evaluate_average_down()`
- **مربوط بـ V40.2**: ✅ نعم (L2636, L2964)
- **الحكم**: ✅ شغّال

#### 18. `analyzers/egx_disclosure_engine.py` — **EGX Disclosure Engine** ✅ WIRED
- **الحجم**: 1,000+ سطر
- **بيحسب إيه**: Disclosure impact → score ±10..±20
- **مربوط بـ V40.2**: ✅ نعم (L2687) — `get_disclosure_impact_for_ticker()`
- **الحكم**: ✅ شغّال

#### 19. `analyzers/news_fetcher_analyzer.py` — **News + Expert Fetcher** ✅ WIRED
- **بيحسب إيه**: News impact + Expert recommendations → score adjustment
- **مربوط بـ V40.2**: ✅ نعم (L2409, L2493)
- **الحكم**: ✅ شغّال

#### 20. `analyzers/position_sizing.py` — **Position Sizing** ✅ WIRED
- **مربوط بـ V40.2**: ✅ نعم (L2747)
- **الحكم**: ✅ شغّال

#### 21. `analyzers/technical_explainer.py` — **Technical Explainer** ✅ WIRED
- **مربوط بـ V40.2**: ✅ نعم (L1517) — `build_technical_explanation()`
- **الحكم**: ✅ شغّال (display only — مش score)

#### 22. `analyzers/indicators/` — **Canonical Indicators Library** ✅ WIRED
- **بيحسب إيه**: RSI + ATR + MA + MACD (canonical)
- **مربوط بـ V40.2**: ✅ نعم (L1227) — `calc_rsi`
- **الحكم**: ✅ شغّال (SSOT per Rule 54)

#### 23. `analyzers/decision_logger.py` — **Decision Logger** ✅ WIRED
- **مربوط بـ V40.2**: ✅ نعم (L2421, L2506, L2563, L2605, L2654)
- **الحكم**: ✅ شغّال (audit trail)

#### 24. `analyzers/engine_settings.py` — **Engine Settings** ✅ WIRED
- **مربوط بـ V40.2**: ✅ نعم (L169, L695, L2313)
- **الحكم**: ✅ شغّال (SSOT للـ thresholds)

---

### 🔴 الطبقة 3: المحركات المعطلة (DEAD CODE) — 14 أداة

#### 25. `analyzers/confluence_engine_v3.py` — ❌ DISABLED
- **الحجم**: 1,262 سطر
- **بيحسب إيه**: SMC (60%) + Volume (10%) + Technical (15%) + Fundamental (15%) → master_score
- **مربوط بـ V40.2**: ❌ **SUB_ENGINE_DISABLED = True** (L41)
- **السبب**: THRESHOLDS بـ تـتنافس مع canonical (Rule 67 violation)
- **الحكم**: 🔴 **معطّل** — SMC اتـextracted لـ V40.2 مباشرة

#### 26. `analyzers/sniper_engine.py` — ❌ DEAD
- **الحجم**: 2,062 سطر
- **مربوط بـ V40.2**: ❌ **مش مربوط** (V40.2 بـ يستخدم sniper_detector بس)
- **الحكم**: 🔴 **DEAD CODE** — 2,062 سطر مش بـ تـستخدم

#### 27. `analyzers/board_of_analysts.py` — ❌ DEAD
- **الحجم**: 830 سطر
- **بيحسب إيه**: 4 analysts (Technical + Fundamental + Trend + Tape) → consensus
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

#### 28. `analyzers/stock_dna_analyzer.py` — ❌ DEAD
- **الحجم**: 1,185 سطر
- **بيحسب إيه**: Monthly/Weekday performance + volatility + typical range
- **مربوط بـ V40.2**: ❌ **مش مربوط** (V38 بـ يستخدم dna_result من caller، مش من الأداة دي)
- **الحكم**: 🔴 **DEAD CODE**

#### 29. `analyzers/ai_pattern_analyzer.py` — ❌ DEAD
- **الحجم**: 780 سطر
- **بيحسب إيه**: Candlestick patterns + Chart patterns + Support/Resistance → 0-100
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

#### 30. `analyzers/confidence_engine.py` — ❌ DEAD
- **الحجم**: 498 سطر
- **بيحسب إيه**: 7 factors (technical + trend + volume + R/R + volatility + explosive + data quality)
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE** — ممكن يكون مفيد لو ربطناه

#### 31. `analyzers/conviction_engine.py` — ❌ DEAD
- **الحجم**: 433 سطر
- **بيحسب إيه**: 6 scores (technical + volume + S/R + regime + sector + R/R) → conviction level
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE** — ممكن يكون مفيد

#### 32. `analyzers/fusion_engine.py` — ❌ DEAD
- **الحجم**: 745 سطر
- **بيحسب إيه**: BigBeluga Fib + VWAP Premium + fusion score
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

#### 33. `analyzers/expert_quality_gate.py` — ❌ DEAD
- **الحجم**: 1,036 سطر
- **بيحسب إيه**: Falling knife + VWAP + percentile + sector → verdict
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

#### 34. `analyzers/seasonality_engine_v2.py` — ❌ DEAD
- **الحجم**: 891 سطر
- **بيحسب إيه**: Monthly/seasonal patterns → WR per month
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE** — ممكن يكون مفيد جداً (EGX فيه seasonality قوية)

#### 35. `analyzers/unified_maestro.py` — ❌ DEAD
- **الحجم**: 606 سطر
- **بيحسب إيه**: ArabMarketsMaestro + UnifiedMaestroEngine
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE** (بعد MAESTRO-CANCER-1 cleanup)

#### 36. `analyzers/prediction_optimizer.py` — ❌ DEAD
- **الحجم**: 1,643 سطر
- **بيحسب إيه**: OptimizedSignal + regime ATR multipliers
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

#### 37. `analyzers/v82_analyzer.py` — ⚠️ PORTED (DEAD)
- **الحجم**: 767 سطر
- **بيحسب إيه**: V82 signals (account balance + risk per trade)
- **مربوط بـ V40.2**: ⚠️ **Ported** (L2814, L2846) — features اتـport لـ daily_predictor مباشرة
- **الحكم**: ⚠️ **الأصل DEAD بس الـ features عايشة في V40.2**

#### 38. `analyzers/quant_engine.py` + `quant_overdrive.py` — ❌ DEAD
- **الحجم**: 316 + 381 = 697 سطر
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE**

---

### 🟡 الطبقة 4: أدوات مساعدة (Utilities)

#### 39. `analyzers/adaptive_weights.py` — ✅ WIRED (PARTIAL)
- **الحجم**: 789 سطر
- **بيحسب إيه**: persona weights + adaptive weights per regime
- **مربوط بـ V40.2**: ✅ نعم (L123) — `PERSONA_INPUT_WEIGHTS` (لسه تعيين الـ fit score)
- **الحكم**: ⚠️ **PARTIAL** — بـ يستخدم بس PERSONA_INPUT_WEIGHTS، الـ AdaptiveWeightsEngine مش مربوط

#### 40. `analyzers/fundamental_scorer.py` — ❌ DEAD
- **الحجم**: 567 سطر
- **بيحسب إيه**: Piotroski + Altman Z + Magic Formula
- **مربوط بـ V40.2**: ❌ **مش مربوط** (V40.2 بـ يستخدم fundamental_data_provider بدل منه)
- **الحكم**: 🔴 **DEAD CODE** — ممكن يكون مفيد (Piotroski قوي)

#### 41-44. `analyzers/technical*.py` (4 ملفات) — ❌ DEAD
- `technical.py` (600) + `technical_weighted.py` (540) + `technical_target_engine.py` (904) + `enhanced_indicators.py` (515)
- **مربوط بـ V40.2**: ❌ **مش مربوط**
- **الحكم**: 🔴 **DEAD CODE** — 2,559 سطر مش بـ تـستخدم

#### 45. `analyzers/liquidity_filter.py` — ✅ WIRED
- **مربوط بـ V40.2**: ✅ نعم (L121) — `set_strict_kill_filters`
- **الحكم**: ✅ شغّال

#### 46. `analyzers/technical_explainer.py` — ✅ WIRED (display only)
- **مربوط بـ V40.2**: ✅ نعم (L1517)
- **الحكم**: ✅ شغّال (للـ UI بس)

---

## 📊 ملخص الـ Dead Code (الكنوز المهجورة)

| # | الأداة | الحجم | ليه مفيدة |
|---|--------|-------|-----------|
| 1 | `master_analyzer.py` | 5,763 | 8-layer confluence + load_merged_history |
| 2 | `core_scoring_engine.py` | 2,573 | 4 scorers (Tech + Vol + Candle + Fund) |
| 3 | `sniper_engine.py` | 2,062 | Sniper signals كاملة |
| 4 | `stock_dna_analyzer.py` | 1,185 | Monthly/Weekday performance |
| 5 | `prediction_optimizer.py` | 1,643 | Regime ATR multipliers |
| 6 | `confluence_engine_v3.py` | 1,262 | DISABLED بس logic واضح |
| 7 | `expert_quality_gate.py` | 1,036 | Falling knife + VWAP + percentile |
| 8 | `technical_target_engine.py` | 904 | Technical targets |
| 9 | `seasonality_engine_v2.py` | 891 | EGX seasonality |
| 10 | `ai_pattern_analyzer.py` | 780 | Chart patterns |
| 11 | `v82_analyzer.py` | 767 | (ported already) |
| 12 | `fusion_engine.py` | 745 | BigBeluga + VWAP premium |
| 13 | `unified_maestro.py` | 606 | (after maestro cleanup) |
| 14 | `technical.py` | 600 | Technical analysis |
| **الإجمالي** | **14 أداة** | **~21,000 سطر** | **كنوز مهجورة** |

---

## 🎯 ترتيب التجربة المقترح

### المعيار: (الأثر المحتمل × سهولة التفعيل) / المخاطرة

#### 🥇 التجربة 1: **ربط `seasonality_engine_v2`** (الأولوية الأعلى)
- **ليه**: EGX فيه seasonality قوية جداً (Ramadan + Q1 earnings + year-end). الـ engine موجود وكامل (891 سطر) بس مش مربوط.
- **الأثر المحتمل**: +5-10% WR لو اربطناه كـ filter (reject لو السهم في شهر ضعيف تاريخياً)
- **سهولة التفعيل**: عالية (add import + call + filter)
- **المخاطرة**: منخفضة (filter only، مش score producer)
- **الـ trial**: شهر كامل على بيانات price_history (1.3M صف)

#### 🥈 التجربة 2: **ربط `conviction_engine`** (الأولوية الثانية)
- **ليه**: 6 scores بـ تـ produce conviction level (LOW/MEDIUM/HIGH). ممكن نـستخدمه كـ filter (reject لو conviction=LOW).
- **الأثر المحتمل**: +3-5% WR (filter ضعيف)
- **سهولة التفعيل**: عالية
- **المخاطرة**: منخفضة
- **الـ trial**: شهر كامل

#### 🥉 التجربة 3: **ربط `expert_quality_gate`** (الأولوية الثالثة)
- **ليه**: Falling knife + VWAP + percentile + sector → verdict. ممكن نـستخدمه كـ HARD GATE زي radar_integration.
- **الأثر المحتمل**: +5-8% WR (HARD GATE قوي)
- **سهولة التفعيل**: متوسطة (فيه VWAP + percentile محتاجين بيانات)
- **المخاطرة**: متوسطة (ممكن يرفض توقعات كويسة)
- **الـ trial**: شهر كامل

#### 🏅 التجربة 4: **ربط `fundamental_scorer` (Piotroski)** (الأولوية الرابعة)
- **ليه**: Piotroski F-Score مقياس قوي للأساسيات (9 معايير). ممكن نـستخدمه بدل الـ fundamental_data_provider الحالي.
- **الأثر المحتمل**: +3-5% WR (تحسين الأساسيات)
- **سهولة التفعيل**: متوسطة
- **المخاطرة**: منخفضة
- **الـ trial**: شهر كامل

#### 🎖️ التجربة 5: **ربط `confidence_engine`** (الأولوية الخامسة)
- **ليه**: 7 factors بـ تـ produce confidence 0-100. ممكن نـستخدمه كـ overlay على الـ score الحالي.
- **الأثر المحتمل**: +2-4% WR
- **سهولة التفعيل**: متوسطة
- **المخاطرة**: متوسطة (ممكن يـ dilute الـ score)
- **الـ trial**: شهر كامل

---

## 🔥 الاكتشافات الحاسمة

### 1. **V38 هو الـ brain الحقيقي** (مش master_analyzer)
- V40.2 بـ يستخدم `calculate_score_and_proofs()` من backtest_engine (V38)
- V38 بـ produce score=100 بسهولة (6 boolean conditions)
- master_analyzer (5,763 سطر) **مش مربوط بـ V40.2** — ده كنز مهجور

### 2. **21 أداة مربوطة، 14 معطّلة**
- نسبة الـ dead code = 40% من الأدوات
- 21,000 سطر كنوز مهجورة

### 3. **الـ boosts مش شغّالة في الـ backfill**
- 97.9% من التوقعات boost_added=0
- الـ boosts بـ تتـفعّل بس في production (live news + live radar + live maker flow)

### 4. **SMC + VP مربوطين بس بوزن ضعيف**
- SMC = 15% + VP = 10% + base = 75%
- لو زودنا الوزن، الـ score هـ يبقى أدق

### 5. **الـ HARD GATE الوحيد هو radar_integration**
- باقي الأدوات filters بسيطة
- محتاجين HARD GATE تاني (expert_quality_gate مثلاً)

---

## ⚠️ القيود اللي لازم نـراعيها

1. **V40.2 هو الـ sole writer** (Rule 35) — ممنوع نـعدل أي أداة تـكتب في predictions
2. **Rule 27 (NO-FAKE-DATA)** — أي أداة جديدة لازم تـ reject لو مفيش بيانات (مش تـ fabricate)
3. **Rule 54 (SSOT)** — المؤشرات لازم من `analyzers/indicators/`
4. **Rule 17 (relative paths)** — `Path(__file__).resolve().parents[N]`
5. **Rule 67 (canonical_signal)** — signal classification من canonical_signal.py بس
6. **الـ backfill مش بـ يـ activate الـ live features** (news + radar + maker flow)

---

## 📋 الـ Next Steps (محتاجة قرار محسن)

1. **التجربة 1 (seasonality_engine_v2)**: أوافق؟
2. **التجربة 2 (conviction_engine)**: أوافق؟
3. **التجربة 3 (expert_quality_gate)**: أوافق؟
4. **هل نـزود وزن SMC + VP في الـ combined_score؟** (من 15%+10% لـ 25%+15% مثلاً)
5. **هل نـربط master_analyzer.analyze() كـ scoring layer تاني؟** (5,763 سطر مهجورة)

**ممنوع أي تعديل قبل ما تشوف الخريطة دي وتقول رأيك.**

---

**برافو — كل رقم مشتبه فيه حتى يثبت. بالدليل مش بالكلام.**
