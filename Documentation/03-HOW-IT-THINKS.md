# 02 — كيف يفكر النظام (How It Thinks)

> **آخر تحديث:** 2026-10-28 (v3) | **Branch:** `main` | **Agent:** Bravo V2
> **الأساس:** فحص فعلي لـ `vps-service/jobs/daily_predictor.py` + `vps-service/analyzers/master_analyzer.py`
> + `vps-service/core/risk_gate.py` + `vps-service/core/risk_gate_wrapper.py`
> + `vps-service/analyzers/decision_logger.py` + `vps-service/analyzers/short_holding_exit.py`
> + `vps-service/analyzers/market_regime_engine.py` + `vps-service/engines/persona_engine.py`
> + `scripts/maker_radar.py` (6 paths: A_pre_surge / B_quiet / C_quiet / D_explosive / E_early_break / **F_bounce**)
> + `scripts/intraday_pulse.py` (**نبض لحظي جوه الجلسة — ALERT ONLY**)
> + `vps-service/analyzers/indicators/` + `vps-service/core/db_helpers.py` (DB gate).

---

## 0. TL;DR — المسار التنفيذي

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CRON (after market close + 30min)                                          │
│      ↓                                                                       │
│  daily_predictor.py  ──┬──► [1] B1 Price Sanity Gate (core/price_sanity.py) │
│                        │       ↓ DATA_INVALID → reject_entry + log_decision │
│                        ├──► [2] Liquidity Gate (shared_liquidity.py)        │
│                        │       ↓ REJECTED_LIQUIDITY → blood filter 3M EGP   │
│                        ├──► [3] master_analyzer.py.analyze() (THE BRAIN)    │
│                        │       ├── 14 sub-analyzer (tech/fund/flow/...)     │
│                        │       ├── canonical indicators (Wilder's)          │
│                        │       ├── adaptive weights (P24)                   │
│                        │       └── master_score 0-100                       │
│                        ├──► [4] risk_gate_wrapper.safe_apply_risk_gate()    │
│                        │       ↓ fail-closed → NO_TRADE + log               │
│                        ├──► [5] prediction_tracker.record_prediction()      │
│                        │       ↓ idx_predictions_dedup (B2 UNIQUE)          │
│                        └──► [6] stored_analyses (SINGLE-WRITER, Rule 73)    │
│      ↓                                                                       │
│  predictions.db  ←──────── (insert/update)                                  │
│      ↓                                                                       │
│  daily_closer.py  ─────────► close stale + force_exit (distribution/...)    │
│      ↓                                                                       │
│  decision_log.db ←──────── (audit trail for every reject/exit)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. الفلسفة — كيف يفكر النظام فلسفياً

النظام **لا يستخدم Deep Learning** (لا LSTM، لا Transformer، لا TensorFlow).
بدلاً من ذلك، يعتمد على **3 ركائز فلسفية**:

### 1.1 Rule-Based + Statistical
- **قواعد هندسية** (110+ محرك): كل محرك بيطبق قاعدة معروفة (Wyckoff, Minervini, SMC, VCP, Donchian, etc.)
- **نماذج إحصائية**: Bayesian + HMM + Monte Carlo (500 مسار سعر في 0.1s).
- **تعلّم ذاتي** (Iterative Learning): `learned_lessons` table (20K+ rows) — استخراج دروس من outcomes.

### 1.2 Multi-Layer Confluence
مفيش قرار بيعتمد على مؤشر واحد. كل قرار بيطلع من **دمج موزون** لـ 14+ طبقة تحليل.
لو في تعارض → النظام بـ يفضل الـ LEADING indicators (Volume Profile, SMC) على الـ LAGGING (SMA, MACD).

### 1.3 Reality-Based (Fail-Closed)
- لو في شك → **NO_TRADE** (مش BUY/HOLD).
- لو الـ data invalid → رفض فوري + log.
- لو الـ risk_gate رمى exception → block (fail-closed).
- لو الـ master_score < 55 → مفيش توصية.

---

## 2. المسار التنفيذي الكامل (Pipeline)

### 2.1 Entry point: `daily_predictor.py`

```bash
# Cron: 30 14 * * 0-4 (Sunday-Thursday after EGX close + 30min)
python3 vps-service/jobs/daily_predictor.py --yesterday-only
```

**الـ phases الستة:**

| Phase | الملف/الـ module | المهمة |
|-------|------------------|--------|
| **1. Pre-flight** | `predictor_modules/scan_dates.py` | حدد تواريخ الفحص (holiday-aware) |
| **2. Pre-cache** | `predictor_modules/price_cache.py` | cache الأسعار لكل الـ tickers |
| **3. Per-ticker loop** | (main loop) | لكل ticker: B1 → Liquidity → Master → Risk → Tracker |
| **4. Persona fit** | `predictor_modules/persona_fit.py` | حساب compatibility per persona (conservative/balanced/gambler) |
| **5. Cleanup** | `predictor_modules/cleanup.py` | حذف V40 predictions القديمة في الفترة |
| **6. Summary** | `predictor_modules/summary.py` | حفظ `tuned_predictions_summary` |

**الـ bypass flags:**
- `BYPASS_PRED_CAP=1`: skip الـ 5-pending cap (لكن dedup شغّال دايماً).
- `--dry-run`: لا يكتب في DB (طباعة بس).
- `--keep-old`: لا يحذف V40 predictions القديمة.

### 2.2 Per-ticker flow (7 gates)

```
ticker
  │
  ▼
[1] B1 Price Sanity Gate (core/price_sanity.py)
  │ DATA_INVALID → reject_entry('data_invalid') + continue
  ▼
[2] Liquidity Gate (utils/shared_liquidity.py)
  │ penny/dead/illiquid → continue (silent skip)
  │ REJECTED_LIQUIDITY → blood_filter label (3M EGP/day)
  ▼
[3] Master Analyzer (analyzers/master_analyzer.py:MasterAnalyzer.analyze)
  │ ← 14 sub-analyzer + canonical indicators + adaptive weights
  │ → master_score 0-100, signal (BUY/HOLD/SELL/NO_TRADE), risk_profile
  ▼
[4] News/Disclosure Veto (if applicable)
  │ news_veto / disclosure_veto → reject_entry + continue
  ▼
[5] Risk Gate Wrapper (core/risk_gate_wrapper.py:safe_apply_risk_gate)
  │ fail-closed → NO_TRADE + log('risk_gate_blocked')
  │ R:R<1.0 / conviction LOW / critical engine fail → downgrade
  ▼
[6] Prediction Tracker (analyzers/prediction_tracker.py:record_prediction)
  │ B2 dedup: SELECT existing → UPDATE mutable only (preserve entry_price)
  │ OR INSERT new row → idx_predictions_dedup UNIQUE constraint
  ▼
[7] stored_analyses upsert (SINGLE-WRITER — Rule 73)
  │ INSERT OR REPLACE INTO stored_analyses (...)
  └──── predictions.db updated
```

### 2.3 Exit point: `daily_closer.py`

```bash
# Cron: 0 15 * * 0-4 (after daily_predictor)
python3 vps-service/jobs/daily_closer.py
```

**الـ phases:**
1. قرأ كل التوقعات PENDING من `predictions.db`.
2. امشي يوم بيوم لحد `MAX_HOLDING_DAYS` (30-60 للتتبع).
3. **Trend-following** (.trailing stop = `highest_close - ATR_at_entry × trail_mult`).
4. **Mean-reversion** (لو `high >= target` → TARGET_HIT, `low <= stop` → STOPPED).
5. **Force-exit** (`short_holding_exit.py:evaluate_force_exit`) لو:
   - `distribution_exit` (شمعة توزيع)
   - `max_holding_7d` (تجاوز 7 أيام)
   - `no_move_3d` (3 أيام بلا حركة)
   - `early_drop` (نزول -7% في 3 أيام)
6. لو `MAX_HOLDING_DAYS` عدت → EXPIRED.
7. اكتب النتيجة + `actual_return` في `predictions`.

---

## 3. MasterAnalyzer — THE BRAIN (14 sub-analyzer)

**الملف:** `vps-service/analyzers/master_analyzer.py` (5,794 LOC).

### 3.1 الـ 14 sub-analyzer (مُهيأة في `__init__`)

| # | Sub-Analyzer | الملف | الدور | الوزن الأساسي |
|---|--------------|------|------|---------------|
| 1 | `liquidity_filter` | `analyzers/liquidity_filter.py` (LiquidityFilter) | فحص السيولة (First Priority — Blood Filter 3M EGP) | gate (no score) |
| 2 | `session_analyzer` | `analyzers/session_timing.py` (SessionTimingAnalyzer) | توقيت الجلسة (open/mid/close) | 0.015 (`timing`) |
| 3 | `technical_analyzer` | `analyzers/technical_weighted.py` (TechnicalAnalyzerWeighted) | SMA/EMA/RSI/MACD/Bollinger (canonical) | 0.042 (`technical`) |
| 4 | `fundamental_analyzer` | `analyzers/fundamental_enhanced.py` (EnhancedFundamentalAnalyzer) | P/E, ROE, margins (sector-relative) | 0.40 (`fundamental`) |
| 5 | `fundamental_engine` | `analyzers/fundamental_engine.py` (FundamentalEngine) | البوابة الأساسية (gatekeeper < 40 → reject) | gate |
| 6 | `ai_pattern_analyzer` | `analyzers/ai_pattern_analyzer.py` (AIPatternAnalyzer) | كشف الأنماط (head&shoulders, triangles) | 0.06 (`ai_pattern`) |
| 7 | `sentiment_analyzer` | `analyzers/sentiment_analyzer.py` (SentimentAnalyzer) | أخبار + social sentiment | 0.04 (`sentiment`) |
| 8 | `risk_manager` | `analyzers/risk_adaptive.py` (RiskManagerAdaptive) | adaptive risk profile + SELL signals | risk |
| 9 | `enhanced_indicators` | `analyzers/enhanced_indicators.py` (EnhancedIndicators) | MACD + RSI divergence (LEADING components) | 0.024 |
| 10 | `mtf_engine` | `analyzers/multi_timeframe_engine.py` (MultiTimeframeEngine) | daily/weekly/monthly confluence | 0.03 (`multi_timeframe`) |
| 11 | `volume_analyzer` | `analyzers/volume_profile.py` (VolumeProfileAnalyzer) | VWAP + OBV + Volume Nodes (LEADING) | 0.043 (`volume_profile`) |
| 12 | `adaptive_weights_engine` | `analyzers/adaptive_weights.py` (AdaptiveWeightsEngine) | adaptive weights per regime/sector/vol | meta |
| 13 | `regime_detector` | `analyzers/regime_detector.py` (RegimeDetector) | market regime (bull_trend/bear_trend/ranging) | 0.05 (`market_regime`) |
| 14 | `sector_analyzer` | `analyzers/sector_relative.py` (SectorRelativeAnalyzer) | stock vs sector | 0.05 (`sector_relative`) |
| — | `explosive_scanner` | `engines/explosive_scanner.py` (ExplosiveScanner) | كشف التجميع الخفي + السيولة الانفجارية | bonus |

**إضافي دمج (BLEND):**
- `analyzers/smc_engine.py:calculate_smc_score` — SMC zones (Order Blocks/FVG/Sweep) — TOP PRIORITY (0.26 weight, blend 0.40-0.75 adaptive).
- `analyzers/fusion_engine.py:FusionEngineV20` — LuxAlgo + BigBeluga + SMC fusion (Phase 11).
- `analyzers/quant_overdrive.py:calculate_smfi` — Smart Money Flow Index (500 Monte Carlo paths).
- `analyzers/expert_memory_bridge.py:compute_expert_consensus` — Expert Memory (human expert consensus).

### 3.2 الـ MASTER_WEIGHTS (الأساسية — قبل adaptive overlay)

```python
# master_analyzer.py:481
MASTER_WEIGHTS = {
    'smc':                  0.26,   # LEADING: Order Blocks / FVG / Sweep zones
    'fundamental':          0.40,   # الأساسيات = قلب القرار (FUNDAMENTAL-CATALYST)
    'technical':            0.042,  # LAGGING: SMA/EMA (confirm trend after move)
    'ai_pattern':           0.06,
    'sentiment':            0.04,
    'market_regime':        0.05,
    'sector_relative':      0.05,
    'enhanced_indicators':  0.024,  # MACD/RSI divergence (LAGGING dominant)
    'multi_timeframe':      0.03,
    'volume_profile':       0.043,  # LEADING: hidden accumulation
    'timing':               0.015,
}
# Sum ≈ 1.00 (after normalization)
```

**الـ philosophy:** SMC + Fundamental + Volume Profile = LEADING (يكشفوا النية قبل الحركة).
SMA/EMA/MACD = LAGGING (بـ يأكدوا الحركة بعد ما تبدأ). عشان كده أوزان الـ LEADING أعلى.

### 3.3 Adaptive Weights Overlay (P24 — Aug 2026)

بدل أوزان ثابتة، `AdaptiveWeightsEngine.compute_weights()` بتحسب أوزان ديناميكية من 3 محاور:

| المحور | القيم |
|--------|------|
| `market_regime` | `strong_bull / bull / range / bear / crash` |
| `volatility_regime` | `low / normal / high / extreme` (percentile of volatility_pct: <8%=normal, 8-15%=high, >15%=extreme) |
| `liquidity_score` | `0..1` |

**قواعد المثال:**
- `strong_bull/momentum`: tech×1.8, smc×1.4, vol_profile×1.5, fund×0.6
- `bear/high_vol`: fund×1.3, tech×0.7
- liquidity منخفض → تقليل شامل (cash mode)

**الدمج:** 60% من الـ regime/vol/liquidity-adaptive + 40% من الـ sector-adaptive.

### 3.4 Thresholds (canonical — Rule 72)

```python
# master_analyzer.py:517
THRESHOLDS = {
    'STRONG_BUY':   78,   # Rule 71: was 80 → 78 (surface more STRONG_BUY)
    'BUY':          65,   # optimized: 68.4% win rate backtest
    'ACCUMULATE':   55,   # 61.5% win rate backtest
    'REDUCE':       40,
    'STRONG_SELL':  25,
}
# Source of truth: utils/canonical_signal.py:SIGNAL_THRESHOLDS (mirrored here)
```

### 3.5 8-Layer Confluence (chart_routes parity — MAESTRO-UNIFY-015)

```python
# master_analyzer.py:534
CONFLUENCE_THRESHOLDS = {
    'STRONG_BUY': 80, 'BUY': 55, 'HOLD': 45, 'SELL': 45,
}
# 8 layers (max ~135 pts):
#   Macro + SMA50 + RSI + Volume + Bollinger + MACD + Candlestick + Fibonacci
```

### 3.6 Momentum Override (P14 + P24)

بوابة الأساسيات بترفض لو `fundamental_score < 40`. لكن EGX بيتحكم فيه الزخم اللحظي (pumps).

**Override الشرط (P14 الأصلي):**
- `vol_ratio >= 2.0` (ضعف المتوسط)
- `change_today >= 4%`
- `price > SMA20`

**Override الشرط (P24 البديل — أدق):**
- `momentum_score > 75`
- `volume_spike > 2.0`
- `smc_bullish = True` (higher-low structure)

**Pump & Dump Guard (P15):** لو الـ Override اشتغل، نفحص أحجام الـ 3 أيام السابقة.
لو `avg_3d_vol < 100K` → السهم كان ميت → ارفض الـ Override (تربية دجاج).

---

## 4. Canonical Indicators (`analyzers/indicators/`)

**Rule 67 — CALCULATION-CANONICAL:** ده المصدر الوحيد لكل المؤشرات الفنية. ممنوع inline copies.

| Function | الصيغة | السبب |
|----------|--------|-------|
| `calc_atr(highs, lows, closes, period=14)` | **Wilder's smoothing**: `atr = (atr × (period-1) + tr) / period` | أبطأ تغيّر وأكثر استقراراً من SMA |
| `calc_rsi(closes, period=14)` | **Wilder's smoothing**: `avg_gain = (avg_gain × (period-1) + gain) / period` | industry standard (Wilder 1978) — 10-20 نقطة فرق عن SMA |
| `calc_srsi(...)` | Stochastic RSI (Chande & Kroll 1994) | مكمّل لـ RSI (توقيت الدخول/الخروج) |
| `calc_bollinger(closes, period=20, std_dev=2.0)` | middle=SMA, upper/lower=±std, bandwidth, percent_b | population std (آخر `period` قيمة كاملة) |
| `calc_bollinger_series(...)` | series كاملة للرسوم | للـ charts |
| `calc_mfi(...)` | Money Flow Index (volume-weighted RSI) | بيدخل volume في حساب RSI |
| `calc_adx(...)` | ADX/DMI (Wilder's) | قوة الترند (مش اتجاهه) |
| `calc_vwap(...)` + `calc_vwap_premium(...)` | VWAP (session أو rolling) + premium % | anchor مؤسسي |
| `calc_volume_profile(...)` | POC/VAH/VAL | كشف الـ accumulation zones |
| `sma(data, period)` | `sum(data[-period:]) / period` | بسيط |
| `ema(data, period)` | recursive: `ema = (price - ema_prev) × k + ema_prev`, `k = 2/(period+1)` | يعطي وزن أكبر للأسعار الحديثة |
| `macd(closes, 12, 26, 9)` | `{line, signal, histogram}` | line = EMA(12) - EMA(26), signal = EMA(line, 9) |

### 4.1 لماذا Wilder's smoothing (مش SMA)؟

**Rule 67 (CALCULATION-CANONICAL):**

| المؤشر | SMA (غلط) | Wilder's (صح) |
|--------|-----------|---------------|
| ATR | `sum(TR[-14:])/14` — أسرع تغيّر | `(atr × 13 + tr) / 14` — أبطأ وأكثر استقراراً |
| RSI | `sum(gains[-14:])/14` — 10-20 نقطة فرق | `(avg_gain × 13 + gain) / 14` — industry standard |

**المرجعية:**
- `00-CONSTITUTION.md` Rule 67
- `Documentation/ENGINEERING_AUDIT_REPORT.md` Bug #1 (ATR/RSI Wilder vs SMA)
- النسخ الأصلية: `analyzers/technical_analyzer.py:81` (RSI), `:206` (ATR)

### 4.2 Backward-compat wrappers

بعض الـ modules القديمة بتستخدم wrappers بتـ delegate للـ canonical:

```python
# analyzers/short_holding_exit.py:38-82
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.rsi import calc_rsi as _canonical_rsi

def _sma(values, period):
    return _canonical_sma(values, period)  # delegate

def _rsi(closes, period=14):
    result = _canonical_rsi(closes, period)
    return result if result is not None else 50.0  # neutral fallback
```

---

## 5. محركات السيولة (Liquidity Engines)

### 5.1 `maker_radar.py` (6 paths + 4 intelligence layers)

**الملف:** `scripts/maker_radar.py` (2,847 LOC).

**الـ 6 paths (ترتيب الأولوية):**

| Path | الاسم | شرط التفعيل | حجم الصفقة |
|------|------|--------------|------------|
| **A** | `A_pre_surge` | 4/4 pre-surge signals (regime-aware) | 1.5% (`PRE_SURGE_POSITION_SIZE`) |
| **B** | `B_quiet_accumulation_strong` | Quiet accumulation 5-6/6 signals | 1.5% (`QUIET_ACCUMULATION_POSITION_SIZE`) |
| **C** | `C_quiet_accumulation_weak` | Quiet accumulation 4/6 signals | 1.5% |
| **D** | `D_explosive_surge` | volume spike (max last 3d ≥ 1.7×) + price surge | 2% (`EXPLOSIVE_SURGE_POSITION_SIZE`) |
| **E** | `E_early_break` | breakout above resistance + volume | 2.5% |
| **F** | `F_bounce` | BOUNCE_AFTER_DECLINE (detection only) | **0%** (مراقبة) |

**الـ 5 paths الأولى (A-E) كلها bullish.** لو `net_flow < 0` على مسار bullish → kill switch (reject).

**Path F (BOUNCE) — NEW (2026-10-28):**
- **detection only** — `position_size=0`، `under_microscope=True`، `signal=HOLD`.
- **مش توصية شراء** — مجرد اكتشاف ارتداد بعد هبوط للمراقبة.
- **الشروط (5/5 required):**
  1. `price_action = BOUNCE_AFTER_DECLINE` (from `_classify_price_action`)
  2. `drop_from_peak` بين -8% و -25% (مش سهم مكسور زي KORA -73%)
  3. `vol_support`: 2/3 آخر أيام volume > 1.2× avg_20d (sustained)
  4. `bounce_pct >= 3%` (recovered at least 3% from recent low)
  5. `buy_pct > 25%` (no extreme distribution)
- **Regime filter:** BOUNCE disabled في `DEFENSIVE` regime (54.5% dead-cat rate في backtest).
- **مش في `_BULLISH_PATHS`** → Flow Gate مش بيتأثر.

**Explosive multi-day fix (2026-10-28):**
- قبل: `avg(last 5 days) >= 2.0× avg_20d` → فات ETEL (يوم 27 كان 1.54× بس)
- بعد: `max(last 3 days) >= 1.7× avg_20d` → بـ catch surges اللي بتنطفض بسرعة
- شروط السعر (price > SMA20 + range < 18%) بقاوا كما هم.

### 5.1a الـ 4 Intelligence Layers (وصفية — مش توصية)

**`_add_intelligence_layers()` في `scripts/maker_radar.py`:**

4 طبقات وصفية بـ تتـ calculate لكل سهم عنده تاريخ سعرى كافي (≥15 يوم).
الطبقات دي **مش بتـ تغير** الـ buy/sell signal — بتـ describe الحالة فقط.

| Layer | الدالة | القيم |
|-------|-------|-------|
| **price_action** | `_classify_price_action()` | 14 قيمة: SURGE_UP, SURGE_DOWN, BULLISH_CONTINUATION, BEARISH_CONTINUATION, BREAKOUT, BREAKDOWN, BOUNCE_AFTER_DECLINE, PULLBACK_AFTER_RALLY, MOMENTUM_EXHAUSTION, SIDEWAYS, BULLISH_WAVE_START, BEARISH_WAVE_START, UNCONFIRMED, INSUFFICIENT_DATA |
| **participant_flow** | `_assess_participant_flow()` | INSTITUTIONAL_EVIDENCE, MIXED_PARTICIPATION, SPECULATIVE_PATTERN, UNCONFIRMED, UNAVAILABLE |
| **continuation** | `_assess_continuation()` | SUPPORTIVE, MIXED, WEAK, UNCONFIRMED, INSUFFICIENT_DATA |
| **data_quality** | `_assess_data_quality()` | FRESH, STALE, VERY_STALE, INSUFFICIENT_HISTORY, UNAVAILABLE, INVALID |

**ملاحظة:** مفيش بيانات مؤسسية مباشرة في EGX → `participant_flow` تقديري.
`net_flow < 0` بيـ trigger Flow Gate (يحول المسار لـ `distribution`).

### 5.2 B3 JSON Data Contract — 8 classifications

**`scripts/maker_radar.py:1254`** (Task 2-a — B3 contract):

```python
B3_CLASSIFICATIONS = (
    'quiet_accumulation',    # امتصاص حقيقي (path A/B/C)
    'distribution',          # تصريف مكشوف (بيع حيتان)
    'dead_trap',             # سهم ميت + فخ
    'liquidity_drought',     # سيولة منخفضة جداً
    'rule80_downtrend',      # ترند هابط (Rule 80)
    'unclassified',          # مفيش تصنيف واضح
    'DATA_INVALID',          # بيانات فاسدة (B1 reject)
    'INSUFFICIENT_DATA',     # بيانات غير كافية
)
```

**`B3_DATA_QUALITY_STATUS` (uppercase — new normalized enum):**
- `OK` (= `fresh`)
- `STALE` (= `stale` / `very_stale`)
- `INVALID` (= `invalid`)
- `UNAVAILABLE` (= `unavailable`)

### 5.3 `core/real_liquidity_radar.py` (5 classifications)

**BRAVO-OPERATIONAL:** محرك سيولة واقعي بقراءة OHLCV حقيقية.

**المعادلات الإلزامية:**
1. **Wick Anatomy** (تشريح الذيل): upper_wick_pct, lower_wick_pct, close_location
2. **Dryness Ratio** (نسبة الجفاف): `vol / sma(vol, 20)`
3. **Effort vs Result** (مجهود vs نتيجة): `delta_vol / |delta_price|` (من intraday)
4. **Intraday Low Trajectory**: `HIGHER_LOWS` / `LOWER_LOWS` / `FLAT`

**التصنيف الإلزامي (حالة واحدة فقط لكل سهم):**
- `ACCUMULATION_CONFIRMED` (امتصاص حقيقي)
- `DRY_EXPLOSION_READY` (جفاف عطش قبل انفجار)
- `DIRTY_DISTRIBUTION` (تصريف مكشوف)
- `SUSPICIOUS_WATCH` (مشبوه / مراقبة)
- `FALLING_KNIFE` (سكين ساقطة — حظر تام)

### 5.4 `engines/flow_system.py` (V55 Money Flow)

**4 طبقات + Flow Score واحد:**

| Layer | الوزن | المحتوى |
|-------|------|---------|
| 1. MACRO FLOWS | 25% | USD/EGP inverse, CBE rate, foreign inflows, oil, global |
| 2. SECTOR FLOWS | 30% | sector turnover vs 20d avg, sector vs EGX30, leader momentum, breadth |
| 3. STOCK FLOWS | 25% | volume vs 20d, price vs sector, block trades, RSI not overbought, near support |
| 4. CROSS-VALIDATION | 20% | stock=sector=market direction, volume confirms price, no divergence |

**التفسير:**
- Flow Score ≥ 80 → "نار" (FIRE) — دخول قوي
- 60-79 → "شرارة" (SPARK) — دخول حذر
- 40-59 → "رماد" (ASH) — استنى
- < 40 → "بارد" (COLD) — ماتدخلش

**V55 Money Flow Formula** (`utils/shared_liquidity.py:756`):
```
buy_vol = volume × ((close - low) / (high - low))
```
مستوحى من V55 Pine Script — بيفصل حجم الشراء التقديري عن حجم البيع.

**6-layer Money Flow** (`compute_money_flow` — improved):
1. CLV لكل يوم في آخر 5 أيام
2. اتجاه التدفق (CMF على 20 يوم)
3. تأكيد الحجم (اليومي > متوسط 20 يوم)
4. فلتر الارتداد الوهمي (نزول > 10% في 20 يوم = ارتداد مش شراء)
5. فلتر الموت السريري (حجم < 50% من المتوسط = مش شراء)
6. توافق السعر (close تحت SMA10 = مش شراء قوي)

**Formula النهائية:**
```
weighted_buy_pct = (CLV_5d_avg × 0.35) + (CMF × 0.30) + (vol_confirm × 0.20) + (price_above_sma × 0.15)
```

**Position Cap (Rule 19):** `MAX_POSITION_SIZE = 0.025` (2.5% hard cap).

### 5.5 `engines/explosive_scanner.py`

كشف التجميع الخفي + السيولة الانفجارية. قبل كده كان dead code، دلوقتي متصل بـ `master_score`.
بيكشف "الحوت داخل" مش بس P/E و ROE.

---

## 6. Risk Gate (`core/risk_gate.py` + `core/risk_gate_wrapper.py`)

### 6.1 `apply_risk_gate()` — 6 قواعد

**الـ 6 rules (الترتيب مهم):**

| # | Rule | الإجراء |
|---|------|---------|
| 1 | **Liquidity blocked** → `NO_TRADE` + `position_size=0` | hard reject |
| 2 | **R:R < 1.0** → downgrade one level | مثال: `BUY → ACCUMULATE` |
| 3 | **Position size > 25% capital** → clamp to 25% | hard cap |
| 4 | **Conviction LOW** → downgrade one level | مثال: `STRONG_BUY → BUY` |
| 5 | **Stale data** → flag as "stale recommendation" | warning فقط |
| 6 | **Critical engine failure** → `NO_TRADE` + `position_size=0` | no fake |

**الـ SIGNAL_ORDER (للـ downgrade):**
```python
SIGNAL_ORDER = ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL', 'NO_TRADE']
# downgrade = index += 1 (نحو الأضعف)
```

### 6.2 `safe_apply_risk_gate()` — Fail-closed wrapper

**الـ wrapper (`core/risk_gate_wrapper.py`):**

```python
def safe_apply_risk_gate(signal, master_score, risk_reward, conviction_level,
                          data_quality='fresh', liquidity_blocked=False,
                          critical_engine_failed=False, position_size_pct=5.0,
                          capital=10000.0) -> Tuple[bool, str, str]:
    """Returns (allowed, reason, final_signal)."""
```

**الضمانات:**
1. **`_ACTIONABLE_SIGNALS = {'BUY', 'STRONG_BUY', 'ACCUMULATE', 'WHALE_RADAR_BUY'}`** — فقط الإشارات القابلة للتنفيذ بتمر عالبوابة.
2. **Fail-closed:** أي exception في `apply_risk_gate` → `allowed=False, final_signal='NO_TRADE'`.
3. **No swallowed exceptions:** الـ errors بتـ log مع `exc_info=True` (مش صامتة).
4. **لا تغيير عتبات:** الـ wrapper مش بيغير rules الـ `risk_gate`، بـ يفرض إنه يشتغل بس.

**الاستخدام في `daily_predictor.py`:**
```python
from core.risk_gate_wrapper import safe_apply_risk_gate
allowed, reason, final_signal = safe_apply_risk_gate(
    signal=result['signal'],
    master_score=result['master_score'],
    risk_reward=result['risk_reward'],
    conviction_level=result.get('conviction_level', ''),
    data_quality='fresh' if fresh else 'stale',
)
if not allowed:
    log_decision(ticker, 'reject_entry', 'risk_gate_blocked', reason, ...)
    continue  # skip INSERT
# proceed with final_signal
```

---

## 7. Decision Log (`analyzers/decision_logger.py`)

### 7.1 `log_decision()` — الدالة الموحدة

```python
def log_decision(symbol, decision_type, reason_code, reason_text='',
                 flag_active='', notebook_summary='', market='STOCKS',
                 score_before=None, score_after=None, scan_date='',
                 also_print=True) -> bool:
```

- **الـ DB:** `db/decision_log.db` (via `db_manager.get_connection(writable=True)`)
- **الـ table:** `decision_log` (12 col) + indexes `idx_decision_symbol`, `idx_decision_reason`
- **Defensive writer:** أي خطأ في الكتابة بـ log مع `exc_info=True` بس **مش بـ re-raise**
  (logging مستحيل يكسر الـ prediction pipeline).
- **الـ print:** `[❌ DECISION-LOG] SYMBOL | reject_entry | reason_code | reason_text`

### 7.2 الـ REASON_CODES (19 موثق)

```python
# analyzers/decision_logger.py:85-110
REASON_CODES = {
    # Entry rejections (13)
    'late_entry':              'دخول متأخر (Don\'t Chase)',
    'not_accumulation':        'مش تراكم ولا grab',
    'danger_level_5':          'نوتبوك: danger_level=5',
    'avoid_chase_chasing':     'نوتبوك: avoid_chase + مطاردة',
    'disclosure_veto':         'إفصاح رسمي VETO',
    'news_veto':               'خبر سلبي VETO',
    'crypto_disclosure_veto':  'حدث كريبتو VETO',
    'crypto_news_veto':        'خبر كريبتو VETO',
    'data_invalid':            'بيانات سعرية غير صالحة (B1 Price Sanity)',
    'expert_veto':             'اعتراض خبير (Expert Memory)',
    'bearish_regime':          'حالة سوق هابطة (Bearish Regime)',
    'risk_gate_blocked':       'بوابة المخاطر رفضت الإشارة',
    'risk_gate_passed':        'بوابة المخاطر قبلت الإشارة',
    # Force exits (6)
    'distribution_exit':       'شمعة توزيع',
    'max_holding':             'تجاوز المدة القصوى',
    'max_holding_7d':          'تجاوز 7 أيام (حد التداول)',
    'no_move':                 'لا حركة',
    'no_move_3d':              'لا حركة لـ 3 أيام',
    'early_drop':              'نزول مبكر',
}
```

### 7.3 الـ 13 call site

| # | الملف | السطر | الـ reason_code |
|---|------|------|------------------|
| 1 | `core/price_sanity.py` | 36 | `data_invalid` (B1) |
| 2 | `core/risk_gate_wrapper.py` | 34 | `risk_gate_blocked` |
| 3 | `api/scanner_routes.py` | 228 | (multi) |
| 4 | `api/scanner_routes.py` | 239 | (multi) |
| 5 | `jobs/daily_predictor.py` | 2661 | `news_veto` |
| 6 | `jobs/daily_predictor.py` | 2747 | `expert_veto` |
| 7 | `jobs/daily_predictor.py` | 2804 | `danger_level_5` |
| 8 | `jobs/daily_predictor.py` | 2846 | `bearish_regime` |
| 9 | `jobs/daily_predictor.py` | 2896 | (multi — `_reason_code`) |
| 10 | `jobs/daily_predictor.py` | 2940 | `disclosure_veto` |
| 11 | `jobs/daily_predictor.py` | 4636 | (multi — `_c_reason` for crypto) |
| 12 | `jobs/daily_predictor.py` | 4657 | `crypto_disclosure_veto` |
| 13 | `jobs/daily_predictor.py` | 4681 | `crypto_news_veto` |
| — | `jobs/daily_closer.py` | 737 | `force_exit` (`distribution_exit` / `max_holding_7d` / `no_move_3d` / `early_drop`) |
| — | `jobs/intraday_scanner.py` | 643 | (multi) |

### 7.4 `get_decision_stats()` — تحليل الأسباب

```python
def get_decision_stats(days_back: int = 7) -> Dict[str, Any]:
    """تحليل: كم إشارة رُفضت/خرجت + الأسباب.
    Returns: {total_decisions, rejects, force_exits, by_reason, by_symbol, ...}
    """
```

---

## 8. Exit Logic (3 engines)

### 8.1 `analyzers/short_holding_exit.py` (V40.2)

**الـ logic:**
- `MAX_HOLDING_DAYS = 14` — مراجعة بعد 14 يوم (مش إغلاق إجباري).
- `REVIEW_THRESHOLD_DAYS = 7` — بعد 7 أيام بلا تقدم → مراجعة (تنبيه).
- `EARLY_DROP_THRESHOLD_PCT = -7.0` — نزول -7% في 3 أيام → خروج.
- `COMPOUND_MIN_DAYS = 10` + `COMPOUND_BEYOND_CORRECTION_MULT = 1.3`.

**Distribution detection:**
- `DIST_UPPER_WICK_RATIO = 1.0` — ظل علوي ≥ الجسم
- `DIST_VOLUME_RATIO = 1.8` — حجم ≥ 1.8× متوسط 20 يوم
- `DIST_DIST_FROM_HIGH_MAX_PCT = 8.0` — قريب من قمة 20 يوم
- `DIST_RSI_HIGH_THRESHOLD = 65.0` — RSI مرتفع أو ينزل من >65

**`evaluate_force_exit()` returns:**
```python
{
    'force_exit': bool,
    'exit_code': 'max_holding_7d' | 'no_move_3d' | 'early_drop' | 'distribution_exit' | None,
    'reason': str,
    ...
}
```

### 8.2 `jobs/daily_closer.py` (force_exit)

**الترتيب (أولوية):**
1. `distribution_exit` (1) — شمعة توزيع
2. `max_holding_7d` (2) — تجاوز 7 أيام
3. `no_move_3d` (3) — 3 أيام بلا حركة
4. `early_drop` (4) — نزول مبكر

**الـ flags:**
- `V40_2_SHORT_HOLDING` (default OFF) — for `max_holding_7d` / `no_move_3d` / `early_drop`
- `V40_2_DISTRIBUTION_EXIT` (default OFF) — for `distribution_exit`

**الـ EXIT_POLICY_MODE** (env var):
- `partial_1r_trailing` (default): exit 50% عند 1R + trailing stop 2.0× ATR
- `fixed`: backward compat (fixed targets)

**Exit types (`daily_closer.py:1627-1820`):**
- `EXIT_STOP` — hit stop loss
- `EXIT_PROFIT_LOCK` — partial profit
- `EXIT_T2_HIT` — target 2 hit
- `EXIT_TREND_BREAK` — trend broken
- `EXIT_MOMENTUM_DEAD` — momentum died
- `EXIT_TARGET_100PCT` — full target hit
- `EXIT_FORCE_*` — from `short_holding_exit.py`

### 8.3 `portfolio/smart_exit_engine.py` (V41)

**`ExitReason` enum (9 values):**
```python
class ExitReason(str, Enum):
    TRAILING_STOP    = "trailing_stop"      # الستوب المتحرك وقع
    MOMENTUM_DEATH   = "momentum_death"     # الزخم مات (حجم نزل + مفيش قمم جديدة)
    TARGET_SMART     = "target_smart"       # هدف ذكي (resistance حقيقي مش نسبة ثابتة)
    REGIME_CHANGE    = "regime_change"      # السوق اتغير (bull → bear)
    SECTOR_ROTATION  = "sector_rotation"    # السيولة طلعت من القطاع
    BREAKDOWN        = "breakdown"          # السهم كسر دعم مهم
    HOLD_THROUGH     = "hold_through"       # امسك — لسه بيطير
    SCALE_OUT_PARTIAL= "scale_out_partial"  # جني جزئي عند مقاومة
    NO_EXIT          = "no_exit"            # مفيش سبب للخروج
```

**`TrajectoryType` enum (7 values):**
- `STRONG_UPTREND`, `UPTREND`, `CONSOLIDATION`, `WEAKENING`, `DISTRIBUTION`, `DOWNTREND`, `REVERSAL_RISK`

**الفلسفة:** "لا تبيع سهم بيعمل قمم أعلى وأعلى إلا لما يعمل قمة أقل" — جيسي ليفرمور.

---

## 9. Market Regime Engine (`analyzers/market_regime_engine.py`)

**REGIME-ENGINE (2026-09-27):** الـ canonical للإنتاج.

### 9.1 الـ 3 regimes

```python
class Regime(str, Enum):
    DEFENSIVE  = "DEFENSIVE"   # Risk-Off — cash-mode, half size, very selective
    NORMAL     = "NORMAL"      # Default V40.2 behavior
    AGGRESSIVE = "AGGRESSIVE"  # Trend-riding — wider stops, more picks
```

### 9.2 REGIME_CONFIG (override على V40.2)

| Parameter | DEFENSIVE | NORMAL | AGGRESSIVE |
|-----------|-----------|--------|------------|
| `min_rr` | 1.8 | 1.5 | 1.5 |
| `min_score` | 65 | 60 | 70 |
| `position_size_multiplier` | 0.5 | 0.8 | 1.0 |
| `max_picks_per_day` | 5 | 5 | 7 |
| `atr_stop_multiplier` | 1.5 | 2.0 | 2.0 |
| `falling_knife_threshold` | 0.12 | 0.15 | 0.18 |
| `min_turnover_multiplier` | 1.5 | 1.0 | 0.8 |
| `max_open_positions` | 5 | 5 | 7 |

### 9.3 Detection Rules

**DEFENSIVE — ANY one of these triggers it (with hysteresis):**
- `index_below_sma20_and_sma50` (price < SMA20 AND < SMA50)
- `index_daily_decline_pct >= 0.7%`
- `breadth_up_pct_lt 0.25` (< 25% stocks up)
- `atr_ratio_gt 1.4` (ATR > 1.4× 20-day avg)
- `turnover_drop_pct_gt 0.30`
- `loss_streak_days_gte 3`
- `short_term_drawdown_pct_gt 0.05`

**AGGRESSIVE — ALL must be true (stricter):**
- `index_above_sma20` + `index_above_sma50` + `sma50_above_sma200`
- `breadth_up_pct_gte 0.55` + `turnover_ratio_gte 1.2`
- `atr_stable_or_declining` (ratio ≤ 1.1) + `loss_streak_days_eq 0`

### 9.4 Hysteresis (anti flip-flop)

```python
HYSTERESIS = {
    "to_defensive_days": 2,            # يومين متتاليين عشان تتحول DEFENSIVE
    "to_aggressive_days": 3,           # 3 أيام متتالية عشان تتحول AGGRESSIVE
    "to_normal_from_defensive_days": 2,
    "to_normal_from_aggressive_days": 2,
}
```

### 9.5 Persistence

- الـ regime بيتخزن في `stocks.db.system_settings` (key: `current_regime_<MARKET>`).
- audit history في `stocks.db.market_regime_log`.
- Read by: `daily_predictor.py`, `liquidity_filter.py`, `position_sizing.py`, `/api/market/regime`.

### 9.6 Multi-market support

| Market | Index ticker | Price DB | Price Table |
|--------|--------------|----------|-------------|
| EGX | EGX30 | `data_engine.db` | `egksco_price_history` (DEPRECATED) — fallback basket top-20 |
| TADAWUL | SRXAX (basket) | `data_engine.db` | `historical_data` |
| KSE | KSE-100 (basket) | `data_engine.db` | `historical_data` |
| QATAR | QAT-20 (basket) | `data_engine.db` | `historical_data` |
| US | S&P 500 | `data_engine.db` | `historical_data` |
| CRYPTO | BTC (basket top-10) | `data_engine.db` | `crypto_prices` |
| GOLD | XAU | `data_engine.db` | `gold_prices` |

### 9.7 الـ 13 implementations (legacy divergence)

`scripts/test_regime_parity.py` حدد **13 regime implementations** بـ 11 vocabularies متبادلة غير متوافقة:

| # | Implementation | Vocabulary | Role |
|---|----------------|-----------|------|
| 1 | `analyzers/market_regime_engine.py` | `DEFENSIVE/NORMAL/AGGRESSIVE` | **PRODUCTION** (canonical) |
| 2 | `engines/market_regime.py` | Minervini Stage 1-4 | Legacy chart display |
| 3 | `analyzers/regime_detector.py` | `bull_trend/bear_trend/ranging` | Per-stock regime |
| 4 | `analyzers/regime_filter.py` | `is_bullish True/False` | Entry filter |
| 5 | `analyzers/hmm_market_regime.py` | Wyckoff 4-state | Hidden Markov |
| 6 | `analyzers/adaptive_weights.py` | `bull/bear/range` | Adaptive weights |
| 7 | `analyzers/breakout_signal.py` | `BULL/BEAR/RANGE` | Breakout filter |
| 8 | `core/orchestrator_v2.py` | `R1-R11 + S1-S14` | Orchestrator |
| 9 | `core/orchestrator_v3.py` | `BULL_STABLE/.../CONFLICTING + S1-S11` | Orchestrator v3 |
| 10 | `camp/orchestrator.py` | `Bull/Bear/Sideways` | Backtest breadth |
| 11 | `analyzers/crypto_regime.py` | `BTC_SEASON/...` | Crypto-specific |
| 12 | `scripts/run_backtest.py` | `bull/bear/range` | Backtest tagging |
| 13 | `analyzers/regime_detector.py` (chart-level) | `bull_trend/...` | Chart display |

**التوافق:** الـ production regime = #1 (`analyzers/market_regime_engine.py`). باقي الـ implementations بتخدم أدوار مختلفة (chart display, backtest tagging, per-stock filter). مش ممكن توحيدها بدون كسر contracts.

---

## 10. Persona Engine (`engines/persona_engine.py`)

### 10.1 الـ 7 personas

| Persona | name_ar | emoji | risk_tolerance | target | time_horizon |
|---------|---------|-------|----------------|--------|--------------|
| `CONSERVATIVE` | المحافظ | 🛡️ | 2 | 5-8% سنوياً | 6-12 شهر |
| `CAUTIOUS` | المتوسط الحذر | 🛡️ | 3 | 8-12% سنوياً | 3-6 شهر |
| `BALANCED` | المتوازن | ⚖️ | 5 | 12-18% سنوياً | 2-4 شهر |
| `ACTIVE_TRADER` | المضارب المنتظم | 🎯 | 7 | 18-25% سنوياً | 1-3 شهر |
| `ADVENTURER` | المغامر | 🚀 | 8 | 25-40% سنوياً | 2-8 أسابيع |
| `GAMBLER` | المقامر المحسن | 🎰 | 9 | 40%+ سنوياً | أيام-أسابيع |
| `HEDGER` | المتحوط المؤسسي | 🏛️ | 4 | hedge + 5-8% | مستمر |

### 10.2 RiskParameters (per persona)

كل persona عندها `RiskParameters`:
- `max_position_pct` (محدود بـ 2.5% — Rule 19 cap)
- `default_stop_loss_pct`, `default_target_pct`
- `time_stop_days`
- `leverage_allowed`, `daily_loss_limit_pct`
- allocations: `egx_allocation`, `crypto_allocation`, `gold_allocation`, `forex_allocation`, `cash_allocation`

**Position Cap (BRAVO-RADAR-PRED-AUDIT-001 Fix 2 — Rule 19):**
```python
def __post_init__(self):
    if self.max_position_pct > 2.5:
        self.max_position_pct = 2.5  # hard cap
```

### 10.3 DecisionThresholds (per persona)

| Persona | strong_buy | buy | accumulate | reduce | sell |
|---------|-----------|-----|-----------|--------|------|
| CONSERVATIVE | 85 | 75 | 60 | 25 | 25 |
| CAUTIOUS | 80 | 70 | 55 | 30 | 20 |
| BALANCED | 75 | 65 | 50 | 35 | 20 |
| ACTIVE_TRADER | 70 | 60 | 45 | 30 | 15 |
| ADVENTURER | 65 | 55 | 40 | 25 | 10 |
| GAMBLER | 60 | 50 | 35 | 20 | 10 |
| HEDGER | 78 | 68 | 55 | 30 | 18 |

### 10.4 PersonaScoringWeights

كل persona عندها أوزان مختلفة لـ `master_score`. مثال:
- CONSERVATIVE: `fundamental=0.40, technical=0.15, market_regime=0.15, sentiment=0.10, ai_pattern=0.10, timing=0.10`
- GAMBLER: `technical=0.30, ai_pattern=0.25, fundamental=0.15, sentiment=0.15, timing=0.10, market_regime=0.05`

### 10.5 Threshold Multiplier

```python
threshold_multiplier = {
    CONSERVATIVE: 0.85,   # أصعب — يحتاج درجة أعلى
    CAUTIOUS:     0.92,
    BALANCED:     1.00,
    ACTIVE_TRADER: 1.05,
    ADVENTURER:   1.10,
    GAMBLER:      1.15,   # أسهل — يقبل مخاطر أعلى
    HEDGER:       0.90,
}
# effective_threshold = base_threshold × multiplier
```

### 10.6 الـ 3 personas الأساسية في التوقعات

الـ daily_predictor بـ يولد توقعات per-persona (3 أساسية: `conservative` / `balanced` / `gambler`) → `predictions.db.persona_predictions` (1,669 rows).

---

## 11. الرادار (Radar) — `scripts/maker_radar.py`

### 11.1 B3 Contract (8 classifications)

راجع §5.2 — التصنيفات الـ 8: `quiet_accumulation`, `distribution`, `dead_trap`, `liquidity_drought`, `rule80_downtrend`, `unclassified`, `DATA_INVALID`, `INSUFFICIENT_DATA`.

### 11.2 الـ 6 Paths (ترتيب الأولوية)

| Path | الاسم | شرط التفعيل | حجم الصفقة |
|------|------|--------------|------------|
| **A** | `A_pre_surge` | 3/4 pre-surge signals (regime-aware) | 1.5% |
| **B** | `B_quiet_accumulation_strong` | Quiet 5-6/6 signals | 1.5% |
| **C** | `C_quiet_accumulation_weak` | Quiet 4/6 signals | 1.5% |
| **D** | `D_explosive_surge` | max(last 3d vol) ≥ 1.7× avg_20d + price > SMA20 | 2% |
| **E** | `E_early_break` | breakout + volume | 2.5% |
| **F** | `F_bounce` | BOUNCE_AFTER_DECLINE (detection only) | **0%** |

**Path F (BOUNCE) — NEW (2026-10-28):**
- **detection only** — `position_size=0`، `under_microscope=True`، `signal=HOLD`.
- **مش توصية شراء** — مجرد اكتشاف ارتداد بعد هبوط للمراقبة.
- **5 شروط ALL required:** price_action=BOUNCE_AFTER_DECLINE + drop_from_peak في [-8%,-25%] + vol_support (2/3 أيام > 1.2× avg_20d) + bounce_pct ≥ 3% + buy_pct > 25%.
- **Regime filter:** BOUNCE disabled في `DEFENSIVE` regime (54.5% dead-cat rate في backtest على 5 أسابيع).
- **مش في `_BULLISH_PATHS`** → Flow Gate مش بيتأثر.

### 11.3 Incubator

الـ radar بيـ inject أسهم الـ "Whale Radar" في `predictions.db.stored_analyses` (via `core/sync_scanner_to_db.py`).
لو سهم تحت الـ microscope اشتغل trigger (مثلاً `volume >= 2× avg` + `price > entry`), الـ incubator بيـ promote السهم لـ `predictions` table كـ BUY signal (track=`RADAR_PROMOTED`).

### 11.4 `radar_signal_tracking` (in predictions.db)

كاتبها: `vps-service/camp/state_history_tracker.py`.
Schema: `ticker, canonical_state, signal_date, days_in_state, transition_*`.
يُقرأ من: `camp/canonical_state_shadow.py` + `analyzers/institutional_levels.py` (marker radar).

### 11.5 Intraday Pulse — `scripts/intraday_pulse.py` (NEW 2026-10-28)

**طبقة إنذار لحظي جوه الجلسة، منفصلة عن maker_radar اليومي.**

| الخاصية | القيمة |
|---------|--------|
| المصدر | `db/stocks.db` → جدول `stocks` (يـ update كل دقيقتين من TradingView Scanner) |
| Fallback | `stock_daily_prices.close` (آخر يوم) لو `current_price=0` |
| الـ output | JSON (`--json-only`) أو API (`GET /api/intraday-pulse`) |
| التحديث | كل 30 ثانية في الواجهة |
| الهدف | **جرس إنذار** — مش توصية شراء |

**الـ Flags (وصفية فقط):**

| Flag | الشرط |
|------|-------|
| `SURGE_UP_LIVE` | change_from_open ≥ +3% (مع volume > 0) |
| `SURGE_DOWN_LIVE` | change_from_open ≤ -3% (مع volume > 0) |
| `VOLUME_SPIKE_LIVE` | vol_ratio ≥ 2.0 (مع حركة سعرية) |
| `BREAKING_DAY_HIGH` | current ≥ high × 0.998 (مع volume > 0) |
| `BREAKING_DAY_LOW` | current ≤ low × 1.002 (مع volume > 0) |
| `NO_TRADE_LIVE` | volume = 0 (لا يوجد تداول) |
| `STALE` | last_update > 5 دقائق أو current_price ≤ 0 |
| `SUSPICIOUS_DATA` | change_from_open > ±50% (بيانات فاسدة) |
| `QUIET_LIVE` | مفيش شرط من اللي فوق |

**الربط مع السياق اليومي:**
- `under_microscope` + `SURGE_UP_LIVE` → "حركة لحظية على سهم تحت المراقبة اليومية"
- `rule80_downtrend` + `SURGE_UP_LIVE` → "ارتداد لحظي داخل ترند هابط (تحذير)"
- `distribution` + أي surge → "حركة مع سياق تصريف يومي (تحذير)"

**Volume Gate (مهم):**
لو `volume = 0` → مفيش تداول فعلي → **مفيش SURGE flags**. ده بمنع الإشارات الكاذبة
من الأسهم اللي `current_price=0` (الـ scanner فشل) والـ fallback بياخد سعر أمس.

**فلاتر الجودة:**
- EGS* ISIN codes (سندات) → مفلترة
- Tickers بـ `_` (LUTS_R1) → مفلترة
- `is_suspended=1` → مفلترة
- `open_price=0` → مفلترة (مش نقدر نحسب change)

**الواجهة:** `IntradayPulseBar` component في `LiquidityRadarView.tsx` — بيظهر فوق جدول الرادار، بـ fetch من `/api/intraday-pulse` كل 30 ثانية، وبيعرض بس الأسهم اللي فيها حركة حقيقية (SURGE/VOLUME/BREAKING).

---

## 12. Data Freshness + B1 Price Sanity

### 12.1 B1 Price Sanity Gate (`core/price_sanity.py`)

**Task 1-a (Bravo):** بوابة واحدة قبل أي analyzer يلمس بيانات ticker.

**تكتشف:**
1. **USD-denominated EGX stock** — مثلاً ADP `currency='USD'` و `market='EGX'` (كان بيجيب أسعار NYSE ADP).
2. **Impossible OHLC** — `low=3.7` بجوار `high=269.94` (cross-ticker leakage).
3. **Negative support** — نتيجة ATR-based support سالبة.
4. **Stale data** — آخر سعر أقدم من `max_age_days` (default 4).
5. **History-vs-current mismatch** — مثلاً ADP بيه `close=3.7` و `close=263.855` (50× spread = contamination).

**النتيجة (`SanityResult`):**
- `valid: bool` (True iff status == 'OK')
- `status: 'OK' | 'DATA_INVALID' | 'DATA_UNAVAILABLE' | 'STALE'`
- `reasons: list[str]` (machine+human readable)
- `isolated_fields: list[str]` (الحقول اللي سببت الـ isolation)

**الـ policy:**
- `DATA_INVALID` → **hard NO_TRADE gate** → `log_decision(..., 'data_invalid', ...)` + `continue`.
- `large_candle_range` (> 100%) → flag + note "check corporate actions / splits" (مش silent drop).
- لو الـ gate نفسه رمى exception → **FAIL-OPEN with WARNING** (مش break run).

### 12.2 48h Filter on `stored_analyses`

في `api/misc_routes.py:1765`:
```sql
SELECT ticker, recommendation, maestro_score, target_price, ...
FROM stored_analyses
WHERE date(updated_at) >= date('now', '-2 days')  -- آخر 48 ساعة فقط (BRAVO-STALE-FIX)
ORDER BY updated_at DESC
LIMIT 100
```

**السبب:** لو فيه rows قديمة (أكثر من 48h) في `stored_analyses`، الـ API بيرجعها للمستخدم كأنها recommendations حية — ده خطر. الـ filter بيضمن إن بس الـ analyses الطازجة (آخر يومين) هي اللي بتظهر في الـ frontend.

### 12.3 Canonical sources (لا contamination)

كل الـ analyzers بـ تستخدم `data/source_authority.py`:
```python
from data.source_authority import get_canonical_source, is_source_banned
_canonical = get_canonical_source(market)
# EGX → 'egksco' (or 'scanner_live' post-2026-10-27)
# US → 'tradingview_rest'
# CRYPTO → 'coingecko'
```

---

## 13. TradingView Scanner Live (Live data)

**الملف:** `data_engine/scrapers/tradingview_scanner_live.py`.

| الخاصية | القيمة |
|---------|--------|
| Endpoint | `POST https://scanner.tradingview.com/{market}/scan` |
| الأسواق | `egypt, ksa, kuwait, qatar, america, crypto` (**6 أسواق** — crypto added 2026-10-28) |
| الحقول | **67 field** (60 original + 8 new: avg_volume_30d/10d/90d + Volatility.D/W + high_52w/low_52w + beta_1y) |
| السرعة | ~45 ثانية لـ 6 أسواق (مع 5s delay بين الأسواق) |
| الـ range | `[0, 2000]` لكل سوق (was 1000) |
| الـ sort | `Value.Traded DESC` (الأكثر سيولة الأول) |
| اللغة | `lang: 'ar'` |
| HTTP timeout | 20s |
| Rate limiting | 5 ثواني بين كل سوق + retry على HTTP 429 (3 محاولات: 10s/20s/30s backoff) |
| الـ output | `db/stocks.db.stocks` (97 col — idempotent CREATE + ALTER) + `stock_daily_prices` |
| Smart schedule | `is_market_open_now()` — يـ skip الأسواق المقفولة أوتوماتيك |

**جدول العمل (MARKET_HOURS_UTC):**

| السوق | أيام العمل | ساعات UTC | ساعات محلي |
|-------|-----------|-----------|-----------|
| egypt | Sun-Thu | 08:00-12:30 | 10:00-14:30 Cairo |
| ksa | Sun-Thu | 07:00-12:00 | 10:00-15:00 Riyadh |
| kuwait | Sun-Thu | 06:00-10:00 | 09:00-13:00 Kuwait |
| qatar | Sun-Thu | 06:30-10:15 | 09:30-13:15 Qatar |
| america | Mon-Fri | 14:30-21:00 | 09:30-16:00 ET |
| crypto | 7/7 | 00:00-23:59 | 24 ساعة |

**الـ 8 fields الإضافية (2026-10-28):**

| API field | DB column | الفائدة |
|-----------|-----------|---------|
| `average_volume_30d_calc` | `avg_volume_30d` | حجم نسبي حقيقي (للـ pulse + radar) |
| `average_volume_10d_calc` | `avg_volume_10d` | متوسط حجم 10 أيام |
| `average_volume_90d_calc` | `avg_volume_90d` | متوسط حجم 90 يوم |
| `Volatility.D` | `volatility_daily` | تقلب يومي % (risk assessment) |
| `Volatility.W` | `volatility_weekly` | تقلب أسبوعي % |
| `price_52_week_high` | `high_52w` | قمة 52 أسبوع (drop_from_peak دقيق) |
| `price_52_week_low` | `low_52w` | قاع 52 أسبوع |
| `beta_1_year` | `beta_1y` | بيتا (مخاطرة نسبية للسوق) |

**CLI:**
```bash
python3 data_engine/scrapers/tradingview_scanner_live.py              # كل الأسواق
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt
python3 data_engine/scrapers/tradingview_scanner_live.py --dry-run     # بدون حفظ
python3 data_engine/scrapers/tradingview_scanner_live.py --force       # تجاوز الجدول (للاختبار)
```

**CLI:**
```bash
python3 data_engine/scrapers/tradingview_scanner_live.py              # كل الأسواق
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt
python3 data_engine/scrapers/tradingview_scanner_live.py --dry-run
```

---

## 14. Fallback Chain (Live data fetching)

**الترتيب:** `scanner_live → rest → egksco → DB read`

| Tier | المصدر | الملف | الـ threshold للنجاح |
|------|---------|------|----------------------|
| 1 | **TradingView Scanner Live** | `data_engine/scrapers/tradingview_scanner_live.py` | ≥ 50 سهم |
| 2 | **TradingView REST** | `data_engine/scrapers/tradingview_rest.py` | ≥ 50 سهم |
| 3 | **EGKSCO** (EGX only) | `data_engine/scrapers/egksco_scraper.py` | ≥ 30 سهم |
| 4 | **DB read** (fallback أخير) | `stocks.db.stocks` (آخر تحديث) | read-only |

**القواعد الصارمة (`fallback_chain.py`):**
1. لو مصدر واحد وقع → انتقل للتالي بدون crash.
2. لو المصدر رجع `[]` → اعتبرها "فشل" وانتقل للتالي.
3. لو كل المصادر وقعت → **الـ Sync يتوقف فوراً** (حفاظ على الأسعار القديمة).

**Circuit Breaker (`vps-service/core/circuit_breaker.py`):**
يمنع retry storm لما مصدر بيانات يقع — بدل ما كل tick يفتح HTTP request لمصدر ميت،
الـ circuit بيفتح (Open) ويرفض الطلب فوراً (Fail Fast) لمدة 5 دقايق.

---

## 15. ATR Canonical — Wilder's smoothing (Rule 67)

**`analyzers/indicators/atr.py`:**

```python
def calc_atr(highs, lows, closes, period=14) -> Optional[float]:
    """حساب ATR بصيغة Wilder's smoothing (canonical)."""
    # 1. True Range per bar
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)

    # 2. Initial ATR = SMA of first `period` TRs
    atr = sum(trs[:period]) / period

    # 3. Wilder's smoothing (NOT SMA)
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period

    return round(atr, 4)
```

### 15.1 لماذا Wilder's (مش SMA)؟

| الصيغة | السلوك |
|--------|--------|
| **SMA** (غلط): `atr = sum(TR[-14:]) / 14` | أسرع تغيّر — بـ يتأثر بشمعة واحدة |
| **Wilder's** (صح): `atr = (atr × 13 + tr) / 14` | أبطأ تغيّر وأكثر استقراراً — industry standard منذ 1978 |

**المرجعية:**
- `00-CONSTITUTION.md` Rule 67 (CALCULATION-CANONICAL)
- `Documentation/ENGINEERING_AUDIT_REPORT.md` Bug #1
- النسخة الأصلية: `analyzers/technical_analyzer.py:206`

### 15.2 ATR in 13 implementations

`scripts/test_atr_parity.py` حدد **13 ATR implementations** في المشروع. الـ canonical
هو `analyzers/indicators/atr.py`. باقي الـ implementations بتـ delegate ليه (via backward-compat wrappers)
أو بتـ تستخدم نفس الصيغة (Wilder's) في الـ backtest engines.

---

## 16. الـ Cron Jobs (V3 — 2026-10-28)

**الـ crontab.txt V3:** الـ scanner ذكي — بيـ skip الأسواق المقفولة أوتوماتيك.

### المرحلة 1: صيانة منتصف الليل (01:00-02:30 UTC)

| Time (UTC) | Job | الملف |
|------------|-----|------|
| 01:00 | فحص صحة DBs | `scripts/data_heartbeat_checker.py` |
| 01:30 | نسخة احتياطية | `vps-service/scripts/smart_db_backup.py` |
| 02:00 | تحقق مصير إشارات الرادار | `POST /api/maker-radar/signal-tracker/verify` |

### المرحلة 2: ما قبل الجلسة (02:45-05:00 UTC)

| Time (UTC) | Job | الملف |
|------------|-----|------|
| 02:45 | تحديث Market Regime | `analyzers/market_regime_engine.py` |
| 03:00 | **توليد توقعات اليوم** | `daily_predictor.py --today-only` |
| 03:00 | تخفيض اشتراكات منتهية | `scripts/downgrade-expired-subscriptions.ts` |
| 04:00 | أخبار اكتتابات + توزيعات | `jobs/fetch_corporate_actions.py` |

### المرحلة 3: أثناء الجلسة (الـ scanner ذكي 24/7)

| التوقيت | Job | الملف |
|---------|-----|------|
| **كل 5 دقايق 24/7** | **Scanner ذكي** (يـ skip المقفول) | `tradingview_scanner_live.py` |
| كل دقيقتين (08-12 UTC) | لقطات لحظية في intraday.db | `intraday_storage.py --stocks` |
| كل 5 دقائق (08-12 UTC) | رادار السيولة | `bash scripts/cron_radar.sh` |
| كل 5 دقائق (08-12 UTC) | **نبض لحظي** (ALERT ONLY) | `scripts/intraday_pulse.py` |
| كل 5 دقائق (08-12 UTC) | فحص اختراقات لحظية | `intraday_scanner.py` |
| كل 15 دقيقة (08-12 UTC) | أسهم ساخنة | `hot_candidate_detector.py` |
| كل ساعتين (08-12 UTC) | إفصاحات البورصة | `egx_disclosure_engine.py` |

> **الـ scanner الذكي:** بيشتغل 24/7 بس بيسحب بس الأسواق المفتوحة.
> أمريكا بتتسحب 14:30-21:00 UTC أوتوماتيك.
> الكريبتو بتتسحب 24/7 أوتوماتيك.
> الأسواق العربية بتتسحب في وقتها.
> الأسواق المقفولة بتـ skip في <1ms (مفيش هدر).

### المرحلة 4: بعد الإغلاق (12:45-17:00 UTC)

| Time (UTC) | Job | الملف |
|------------|-----|------|
| 12:45 | تثبيت إغلاقات الجلسة | `tradingview_scanner_live.py` (EOD) |
| 13:00 | رادار ختامي | `bash scripts/cron_radar.sh` |
| 13:15 | **إغلاق الصفقات** | `daily_closer.py` |
| 13:30 | حساب PnL + تحديث الأداء | `post_market_feedback.py` |
| 13:35 | مزامنة Hunter Pick | `sync_hunter_pick_tracking.py` |
| 14:00 | محرك التعلم الذاتي | `learning_engine.py` |
| 14:30 | تقرير تيليجرام | `telegram_comprehensive_report.py` |
| 15:00 | توقعات الغد | `daily_predictor.py --yesterday-only` |

### المرحلة 5: 24/7 (كريبتو + ذهب)

| التوقيت | Job | الملف |
|---------|-----|------|
| كل 5 دقائق 24/7 | رادار كريبتو | `maker_radar.py --market CRYPTO` |
| كل 5 دقائق 24/7 | رادار ذهب | `maker_radar.py --market GOLD` |
| كل ساعة (09-22) | multi-market scraper | `multi_market_scraper.py` |

> **ملاحظة:** `us_stock_scraper.py` اتشال — أمريكا بتيجي من TradingView Scanner مباشرة.
> **ملاحظة:** الـ scanner القديم `*/2 8-12` اتشال — الـ scanner الذكي `*/5 * * * *` 24/7 بديله.

### المرحلة 6: مهام أسبوعية + شهرية

| التوقيت | Job | الملف |
|---------|-----|------|
| Sat 02:55 UTC | Market regime (كل الأسواق) | `market_regime_engine.py --all` |
| Sat 14:00 UTC | Fundamentals | `egx_fundamental_fetcher.py` |
| Sat 15:30 UTC | توافق شرعي | `sharia_compliance_scraper.py` |
| Sun 04:00 UTC | تعدين دروس | `mine_learned_lessons.py` |
| Sun 06:00 UTC | تقرير أسبوعي | `weekly_radar_report.py` |
| يوم 1 كل شهر 05:00 | Exit optimizer | `exit_policy_optimizer.py` |

## 17. مراجع خارجية

- `Documentation/00-CONSTITUTION.md` — Rule 19 (position cap 2.5%), Rule 67 (canonical indicators), Rule 72 (canonical signal), Rule 73 (stored_analyses single-writer)
- `Documentation/02-DATABASES-AND-DATA.md` — قواعد البيانات + canonical sources
- `Documentation/03-HOW-IT-THINKS.md` — نسخة قديمة (Phase 7.4)
- `Documentation/SYSTEM-BRAIN-HOW-IT-THINKS.md` — نسخة تفصيلية شاملة (493 endpoint + 110 محرك)
- `Documentation/ENGINES-MASTER-REFERENCE.md` — فهرس كل المحركات
- `Documentation/ENGINE_CONTRACTS.md` — B3 contract + canonical signals
- `agent-ctx/B4-PIPELINE-INVESTIGATION.md` — تحليل الـ cascading-fallback + defects
- `ORCHESTRATOR_EXECUTOR_FIX_REPORT.md` — 13 ATR + 13 regime implementations
- `scripts/test_regime_parity.py` — regime parity test
- `scripts/test_atr_parity.py` — ATR parity test

---

> **الخلاصة:** النظام بيبدأ من `daily_predictor.py` (cron بعد إغلاق السوق)،
> بيمر بـ **7 gates** (B1 sanity → liquidity → master_analyzer → news/disclosure veto
> → risk_gate → prediction_tracker → stored_analyses). `MasterAnalyzer` بـ يدمج
> **14 sub-analyzer** + canonical indicators (Wilder's smoothing — Rule 67) + adaptive
> weights (P24). الـ risk gate **fail-closed** (أي exception → NO_TRADE). كل قرار
> بيتسجل في `decision_log.db` (13 call site, 19 reason codes). الخروج بيتحكم فيه
> 3 engines: `short_holding_exit` + `daily_closer` + `smart_exit_engine`. الـ market
> regime (`DEFENSIVE/NORMAL/AGGRESSIVE`) بيـ override معايير V40.2 بناءً على 7 مؤشرات
> للسوق (hysteresis 2-3 أيام). الـ persona engine (7 personas) بـ يعدل العتبات
> والأوزان per-persona. الرادار (`maker_radar.py`) بـ يصنف الأسهم في 8 B3 classifications
> عبر **6 paths** (A_pre_surge / B_quiet_strong / C_quiet_weak / D_explosive / E_early_break / **F_bounce**).
> الـ BOUNCE path (detection only, position=0) بـ يـ detect الارتدادات في NORMAL/AGGRESSIVE
> بس (disabled في DEFENSIVE — 54.5% dead-cat rate). الـ 4 intelligence layers (price_action +
> participant_flow + continuation + data_quality) بـ توصف الحالة بدون تغيير التوصية.
>
> **النبض اللحظي** (`intraday_pulse.py`) بـ يـ monitor الحركة جوه الجلسة كل 30 ثانية —
> SURGE_UP/DOWN + VOLUME_SPIKE + BREAKING_HIGH/LOW. **Alert only — مش توصية.**
> Volume gate بيمنع الإشارات الكاذبة من الأسهم اللي مفيشهاش تداول. بيظهر في الواجهة
> كـ `IntradayPulseBar` فوق جدول الرادار.
>
> **بوابة DB:** `core/db_helpers.py` هو الـ canonical helper (Phase 7.3) —
> كل 9 consumers بـ import منه. الـ fallback لـ raw sqlite3.connect اتـ removed تمامًا
> (forensic fix 2026-10-28) — `db_manager` هو البوابة الوحيدة، والفشل بـ fail loud.
>
> **الـ data pipeline:** TradingView Scanner Live (كل دقيقتين) → `stocks.db` (stocks +
> stock_daily_prices) + `intraday.db` (شموع 2-دقيقة). الرادار بـ read آخر 40 يوم.
> الـ MasterAnalyzer بـ read آخر 100 يوم. كل الحسابات على **daily** timeframe.
