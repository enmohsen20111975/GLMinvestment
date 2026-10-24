# 📖 الموسوعة الشاملة للمحركات — مرآة الكود الحالي

> **الإصدار:** 5.0 (مدمج من ENGINES-AND-TOOLS-MAP + ENGINES-ENCYCLOPEDIA + 03-ENGINES-AND-LOGIC + master_architectural_blueprint)
> **التاريخ:** 2026-10-22 (محدّث بعد Phase 5b/6 + scraper validation)
> **227 ملف Python | 175,167 سطر | 5 أسواق | 14 مؤشر**

## الإحصائيات: 227 ملف | 175K LOC | engines(15) + analyzers(116) + core(14) + jobs(15) + api(37) + utils(19) | 13 canonical indicators | 406+ endpoints

> **ملاحظة:** هذا الملف هو **المصدر الموحد** لكل توثيق المحركات. الملفات التالية تم دمجها هنا وأصبحت في `archive/`:
> - `03-ENGINES-AND-LOGIC.md` (421 سطر)
> - `ENGINES-AND-TOOLS-MAP.md` (439 سطر)
> - `ENGINES-ENCYCLOPEDIA.md` (770 سطر)
> - `master_architectural_blueprint.md` (352 سطر)

---

## آخر التحديثات (2026-10-22)

### Phase 5b: liquidity_radar_v2 يقرا من price_history.db
- أضيف `PRICE_HISTORY_DB` constant في `scripts/liquidity_radar_v2.py`.
- `scan_ticker()` بيقرا candles من price_history.db كـ PRIMARY + stock_daily_prices كـ FALLBACK.
- 8/8 verification checks PASS.

### Phase 6: cron بيملا price_history.db يومياً
- `price_history_safetynet.py` موجود ومتوصّل بـ cron (`0 6 * * 0-4`).
- بيملا price_history.db من Yahoo Finance (yfinance).
- 8/8 verification checks PASS.

### TEXT-FIX: نص التوقعات طازج من price_history.db
- `_load_price_history_metrics_batch()` بتحسب `change_1d` + `turnover_egp` ديناميكياً.
- الـ text دلوقتي بيتـ generate من بيانات طازجة (مش متجمدة).

### SCAN-FILTER: رفض HOLD/ILLIQUID في WHALE_RADAR
- `sync_scanner_to_stored_analyses()` بتـ reject أي stock مش BUY/STRONG_BUY.
- بتـ reject الـ tracks: ILLIQUID, FALLING_KNIFE_VETO, DISTRIBUTION_VETO, LOW_RR, إلخ.

### SCRAPER-VALIDATION: منع creation الـ UBEEU من المصدر
- `data_engine/scrapers/ticker_validator.py` — centralized validation.
- تطبّق على: `egksco_scraper.py`, `tradingview_rest.py`, `data_engine/main.py`.
- ترفض: ISIN codes, pollution merge (UBEEU), name_starts_lowercase.

### PURGE: 74 corrupted ticker تم deactivatation
- `scripts/purge_corrupted_tickers.py` ديـactivated 74 سهم مشوه.
- `maker_radar.py` بيـ filter بـ `is_active=1`.
- `auto_poster.py` بيـ filter بـ `is_active=1` قبل الـ publish.

### DAL Plan: خطة طبقة الوصول للبيانات
- شوف `05-DATA-ACCESS-LAYER-PLAN.md` للخطة الكاملة.
- الهدف: single entry point لكل DB access + centralized validation.

---

## الطبقة 1: المحركات الأساسية (Core Engines)

### 1.1 backtest_engine.py — V38 (2,375 LOC, 4 callers, ✅ CORE)
9 أنظمة: زخم + ميكرز + DNA + أساسيات + قطاع + 5 إثباتات + تعلم + VWAP + أخطار. يستورد canonical indicators.

### 1.2 master_analyzer.py — THE BRAIN (5,764 LOC, 25 callers, ⚠️ PARTIAL)
يدمج كل analyzers + Golden Rules. `load_merged_history()` = المصدر الوحيد للأسعار (Rule 12).

### 1.3 core_scoring_engine.py — (2,576 LOC, 8 callers, ⚠️ PARTIAL)
Classes: TechnicalScorer + VolumeScorer + CandlestickScorer + FundamentalScorer + RiskCalculator.

## الطبقة 2: المحركات المربوطة (WIRED)

| المحرك | LOC | Callers | الفلسفة |
|--------|----:|--------:|---------|
| flow_system.py | 1,304 | 8 | 4 طبقات: MACRO(25%)+SECTOR(30%)+STOCK(25%)+CROSS(20%) |
| market_regime.py | 529 | 3 | Minervini Stage 1-4 |
| atr_risk_engine.py | 264 | 1 | Wilder ATR stop: scalper=2×, investor=3× |
| stage2_filter.py | 266 | 0* | SEPA: 5 شروط صارمة للـ Stage 2 |
| vcp_detector.py | 337 | 0* | Volatility Contraction Pattern |
| donchian_breakout.py | 224 | 0* | Turtle Traders 20/55 يوم |
| take_profit_tiers.py | 265 | 0* | Mark Douglas: 1R→ثلث + BE + 2R→ثلث + trail |
| explosive_scanner.py | 688 | 2 | Volume(25%)+Price(30%)+Sector(20%)+SmartMoney(15%)+Market(10%) |
| historical_backfill_engine.py | 1,216 | 2 | تعلم من 180 يوم |
| paper_trade_tracker.py | 1,170 | 1 | Historical + Iterative learning |
| persona_engine.py | 986 | 2 | 7 شخصيات: محافظ→مقامر |
| stock_fundamentals.py | 648 | 1 | 9 جداول من data_engine.db |
| crypto_engine.py | 395 | 1 | crypto مخفف |

(* = من package shim، بيشتغلوا عبر glminvestment_engines)

## الطبقة 3: المحركات التحليلية

| المحرك | LOC | الفلسفة |
|--------|----:|---------|
| sniper_engine.py | 2,026 | "قناص مش رشاش" — 5 Gates + 6 عوامل |
| persona_screener.py | 1,945 | parent: investor + gambler |
| institutional_decision_engine.py | 1,507 | AXIS-4 veto + V40 evidence-count gate |
| prediction_optimizer.py | 1,589 | تحسين التوقعات |
| market_regime_engine.py | 1,374 | DEFENSIVE/NORMAL/AGGRESSIVE |
| confluence_engine_v3.py | 1,233 | Confluence دمج المحركات |
| smc_engine.py | 452 | Smart Money: OB + FVG + Sweeps |
| volume_profile.py | 344 | VWAP + OBV + تجميع/توزيع |
| v68_oracle.py | 734 | V68 Oracle |
| golden_hunter.py | 411 | V76 Golden Hunter |
| strict_entry_filters.py | 829 | تجميع أو Liquidity Grab فقط |
| short_holding_exit.py | 609 | إخراج قصير المدى |
| egx_disclosure_engine.py | 928 | 12 نوع إفصاح EGX |
| adaptive_weights.py | 789 | أوزان ديناميكية حسب الريجيم |
| liquidity_filter.py | 1,101 | MIN_TURNOVER=500K (strict=3M) |

## الطبقة 4: Canonical Indicators (Rule 67) — 13 functions

| المؤشر | الملف | LOC | الصيغة |
|--------|------|----:|--------|
| calc_rsi | rsi.py | 66 | Wilder's smoothing |
| calc_atr | atr.py | 74 | Wilder's smoothing |
| calc_srsi | srsi.py | 125 | Stochastic RSI |
| sma | ma.py | 125 | Simple MA |
| ema | ma.py | 125 | Exponential MA |
| macd | ma.py | 125 | MACD(12,26,9) |
| calc_bollinger | bollinger.py | 119 | BB + bandwidth + %b |
| calc_mfi | mfi.py | 98 | Money Flow Index |
| calc_adx | adx.py | 143 | ADX/DMI Wilder's |
| calc_vwap | vwap.py | 103 | VWAP session/rolling |
| calc_vwap_premium | vwap.py | 103 | VWAP premium % |
| calc_volume_profile | volume_profile.py | 132 | POC/VAH/VAL |
| calc_bollinger_series | bollinger.py | 119 | BB series للرسوم |

كلهم Pure Functions — 60/66 inline functions تم delegation (91%).

## الطبقة 5: Core Infrastructure (NEW)

| الملف | LOC | الوظيفة |
|------|----:|---------|
| core/unified_scanner.py | 525 | محرك فحص موحد — quad-score (30/30/20/20) |
| core/real_liquidity_radar.py | 231 | سيولة واقعي: Wick + Dryness + Effort + Trajectory |
| core/stock_rescue_engine.py | 160 | إنقاذ محبوس: KILL / GOLDEN_DIP_RECOVERY / HOLD |
| core/sync_scanner_to_db.py | 218 | تطهير ميت + R/R≥2.0 + stop invariant + SCAN-FILTER (reject HOLD/ILLIQUID) |
| core/database.py | 1,223 | general DB |
| core/db_manager.py | 487 | connection pooling |
| core/opportunity_quality.py | 2,114 | quality gates + ATR stop [5%,9%] |
| core/db_paths.py | 349 | SSOT لمسارات DBs |
| market_master_endpoints.py | 484 | 5 endpoints: pressure + flows + metals + radar + indices |

## الطبقة 6: Jobs + Cron

| Job | LOC | الوظيفة | Cron |
|-----|----:|---------|------|
| daily_predictor.py | 4,960 | V40.2 predictions + TP1 + user_advice_ar + WHALE_RADAR integrator | 30 14 * * 0-4 |
| daily_closer.py | 3,501 | TP1 exit + Time Stop 5D + trailing 2.5% | بعد الإغلاق |
| market_scheduler.py | 2,780 | جدولة السوق | مستمر |
| intraday_scanner.py | 652 | scan + promote incubator | كل 5 دقايق |
| learning_engine.py | 1,413 | تعلم iterative | يومي |
| intraday_aggregator.py | 390 | تجميع intraday | كل 2 دقيقة |
| price_history_safetynet.py | ~400 | ملء price_history.db من Yahoo | 0 6 * * 0-4 |

## الطبقة 7: Scrapers + Validation (NEW)

| Scraper | الوظيفة | Validation |
|---------|---------|------------|
| tradingview_scraper.py | TradingView DOM scraper | ✅ `_is_polluted_scrape_record()` |
| tradingview_rest.py | TradingView REST API | ✅ `validate_ticker()` (SCRAPER-VALIDATION-FIX) |
| egksco_scraper.py | EGX official prices | ✅ `validate_ticker()` (SCRAPER-VALIDATION-FIX) |
| data_engine/main.py | Main data engine sync | ✅ `validate_ticker()` (SCRAPER-VALIDATION-FIX) |
| us_stock_scraper.py | US stocks | ❌ (needs validation) |
| multi_market_scraper.py | Multi-market | ❌ (needs validation) |

### Centralized Ticker Validation
- **File:** `data_engine/scrapers/ticker_validator.py`
- **Function:** `validate_ticker(symbol, name) → (is_valid, reason)`
- **Detects:** ISIN codes (EGS3I0S1C019), pollution merge (UBEEU), name_starts_lowercase, invalid format
- **Whitelist:** FAITA, CCAPP, EGSA (real preferred shares)

## الطبقة 8: Dead/Archived

### DEAD (موجود بس مش مربوط):
conviction_engine(498) + fusion_engine(745) + unified_maestro(607) + v82_analyzer(769) + quant_engine(316) + quant_overdrive(381) + fundamental_scorer(567) + technical(613) + technical_weighted(542) + scoring_fix(513)

### archive/old-scripts/ (34 script مؤرشف):
- 15 backtest → unified_scanner
- 8 backfill → canonical delegation
- 11 dead → 0 callers

## Data Flow

```
daily_predictor → master_analyzer → CoreScoringEngine → canonical indicators
  → ATRRiskEngine → Stage2Filter → VCPDetector → ExplosiveScanner
  → unified_scanner (quad-score: VP 30% + SMC 30% + Liq 20% + Season 20%)
  → tracker.record_prediction (TP1=+6.5% + trailing=2.5% + time_stop=5d)

daily_closer → TP1 hit? → partial 50% + breakeven + trailing
  → holding_days >= 5? → no new high? → EXIT (TIME_STOP_5D_EXPIRED)

WHALE_RADAR integrator:
  maker_radar.py → maker_radar_EGX_YYYYMMDD.json
  daily_predictor._integrate_whale_radar_predictions() → reads JSON
  → filters: path=B_quiet_accumulation_strong + signals>=5 + turnover>=5M + no_distribution
  → INSERT into stored_analyses (signal='WHALE_RADAR_BUY')
  → sync_scanner_to_stored_analyses() → injects BUY picks only (rejects HOLD/ILLIQUID)

Telegram publish:
  auto_poster.py → reads stored_analyses
  → filters: is_active=1 (PURGE-FIX) + recommendation='buy' + confidence>=min_score
  → publishes to Telegram
```

## قواعد المخاطر

| القاعدة | القيمة |
|---------|--------|
| ATR stop | [5%, 9%] (Rule 8) |
| Trailing | FLOOR not CAP (Rule 9) |
| EXIT_POLICY | partial_1r_trailing (Rule 10) |
| R/R | ≥ 1.8 (Rule 18, upgraded) |
| TP1 | entry × 1.065 (+6.5%) |
| Trailing stop | 2.5% |
| Time stop | 5 أيام |
| RVOL dryness | ≤0.60 large / ≤0.50 small |
| RVOL explosion | ≥1.80 |
| Turnover min | 1.5M EGP (3M large caps) |
| WHALE_RADAR min turnover | 5M EGP (EXPERIMENTAL — was 10M) |

## الـ 5 Pillars (من الدستور)

1. **Liquidity First** — liquidity_filter.py
2. **Market Regime** — market_regime_engine.py
3. **Sector-Relative Fundamentals** — fundamental_relative.py
4. **Session Dynamics** — session_timing.py
5. **Unified Scoring** — master_analyzer.py
6. **Risk Profile** — opportunity_quality.py
7. **Feedback Loop** — feedback_loop.py + learning_engine.py

## المرجعية

- الدستور: `00-CONSTITUTION.md` (76 قاعدة)
- التشريح: `01-ARCHITECTURE.md`
- الـ DBs: `02-DATABASES-AND-DATA.md`
- خطة الطبقات: `05-DATA-ACCESS-LAYER-PLAN.md`
- المؤشرات: `vps-service/data/all_markets_indices.json` (5 أسواق + 14 مؤشر + 1876 constituent)
- archive/INDEX.md: فهرس المؤرشف

