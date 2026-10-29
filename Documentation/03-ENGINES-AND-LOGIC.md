# 03 — المحركات والمنطق الاستثماري

> **آخر تحديث:** 2026-10-29 | **Commit:** `0291a18`
> **هذا الملف هو المرجع الموحّد لكل المحركات والمنطق والمسارات والأوزان.**

---

## الفهرس

1. [فلسفة النظام](#1-فلسفة-النظام)
2. [المحرك المركزي: V40.2 (backtest_engine.py)](#2-المحرك-المركزي-v402)
3. [المنسّق (Orchestrator)](#3-المنسق-orchestrator)
4. [المنفّذ (Executor)](#4-المنفذ-executor)
5. [CoreScoringEngine — طبقة التحليل المستمر](#5-corescoringengine)
6. [محرك حالة السوق (MarketRegimeEngine)](#6-محرك-حالة-السوق-marketregimeengine)
7. [محرك الإغلاق اليومي (daily_closer.py)](#7-محرك-الإغلاق-اليومي-daily_closerpy)
8. [مصفوفة الأوزان الديناميكية](#8-مصفوفة-الأوزان-الديناميكية)
9. [قواعد الخروج التفصيلية (9 قواعد)](#9-قواعد-الخروج-التفصيلية-9-قواعد)
10. [عتبات الإشارة + الفلاتر](#10-عتبات-الإشارة--الفلاتر)
11. [المؤشرات الفنية (Canonical)](#11-المؤشرات-الفنية-canonical)
12. [المسار الإنتاجي الفعلي](#12-المسار-الإنتاجي-الفعلي)
13. [قواعد المخاطر المعتمدة](#13-قواعد-المخاطر-المعتمدة)
14. [الـ Incremental Engine (جديد)](#14-الـ-incremental-engine-جديد)

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:

1. **Rule-Based** (110+ محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama — للـ sentiment فقط)

### القواعد الذهبية الثمانية (Hard Veto Layer)

| # | القاعدة | الوصف |
|---|---------|------|
| 1 | **Liquidity First** | تخطّى التحليل لو السهم غير قابل للتداول |
| 2 | **Market Regime Filter** | تعديل الثقة + الأحجام حسب حالة السوق |
| 3 | **Sector-Relative Fundamentals** | مقارنة داخل القطاع |
| 4 | **Session Dynamics** | ليس "أفضل ساعات" بل ديناميكية الجلسة |
| 5 | **Unified Scoring** | Weighted combination (V38 + Core + SMC + VP) |
| 6 | **Strict Thresholds** | STRONG_BUY ≥ 75, BUY ≥ 65 |
| 7 | **Risk Profile** | Position + Stop + Target + Time لكل إشارة |
| 8 | **Feedback Loop** | التعلّم من الأخطاء (learned_lessons) |

---

## 2. المحرك المركزي: V40.2

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/engines/backtest_engine.py` |
| **الحجم** | 2,373 سطر |
| **الـ class** | `V38BacktestEngine` (use_v393=True → V40.2) |
| **المدخلات** | `ticker, dates, opens, highs, lows, closes, volumes, day_idx, sector_change` |
| **المخرجات** | `{signal, score, entry_price, target_price, stop_loss, risk_reward, ...}` |

### عتبات الإشارة

```python
# من backtest_engine.py line 1538-1542
if maker.maker_bullish and flight_code == 'flight_up':
    signal = 'STRONG_BUY'   # was: INSTITUTIONAL_BUY (KILLED — WR=0%)
elif score >= self.buy_threshold:  # default 75
    signal = 'STRONG_BUY'
elif score <= int(get_setting('tech_score_base', default=50) - 20):  # ≤ 30
    signal = 'AVOID'
else:
    signal = 'WAIT'
```

> **ملاحظة:** `INSTITUTIONAL_BUY` تم قتله (BRAVO-KILL-INST-BUY) لأن WR=0% (13 توقع كلهم STOPPED).

### حساب الـ Risk Profile

```python
entry = closes[-1]
# Stop loss = entry - ATR × multiplier
if ob_state.active_ob > 0 and ob_state.active_ob < entry:
    sl = ob_state.active_ob - (atr × 0.5)   # Order Block stop
else:
    sl = entry - (atr × 1.5)                 # default stop

risk = entry - sl
tp1 = entry + (risk × rr1)   # rr1 = 1.5
tp2 = entry + (risk × rr2)   # rr2 = 3.0
```

### ATR Stop Bounds (حسب السوق)

| السوق | atr_stop_min_pct | atr_stop_max_pct |
|-------|-----------------|-----------------|
| EGX | 5.0% | 9.0% |
| TADAWUL | 3.0% | 7.0% |
| US | 2.0% | 5.0% |

---

## 3. المنسّق (Orchestrator)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/core/orchestrator.py` (127 سطر) |
| **الدور** | يخطط مسار التحليل — **لا يحسب مؤشرات، لا يصدر توصيات** |
| **الـ config version** | `v1.0` |

### ENGINE_SETS (حسب حالة السوق)

| حالة السوق | المحركات المختارة | المحركات المتخطاة |
|------------|-------------------|-------------------|
| **DEFENSIVE** | liquidity_filter, market_regime, technical, fundamental, risk | breakout, momentum, crypto |
| **NORMAL** | liquidity_filter, market_regime, technical, fundamental, confluence, risk | — |
| **AGGRESSIVE** | liquidity_filter, market_regime, technical, fundamental, confluence, breakout, momentum, risk | — |
| **UNKNOWN** | liquidity_filter, market_regime, technical, fundamental, risk | breakout, momentum |

### منطق الـ plan

```python
def create_plan(ticker, market, data_quality, market_state):
    if data_quality == 'insufficient':
        return EnginePlan(decision_policy='no_trade')  # لا تداول
    
    engine_set = ENGINE_SETS[market_state]
    return EnginePlan(
        selected_engines=engine_set['selected'],
        decision_policy='full' if data_quality == 'fresh' else 'partial_allowed'
    )
```

---

## 4. المنفّذ (Executor)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/core/executor.py` (235 سطر) |
| **الدور** | ينفذ خطة المنسّق — يشغّل المحركات + يجمع النتائج |
| **المحرك الرئيسي** | `master_analyzer` (يستخدم `V38BacktestEngine` داخليًا) |

### المحركات الفرعية

| المحرك | الدور | الحالة |
|--------|------|--------|
| `master_analyzer` / `technical` | التحليل الفني الرئيسي | ✅ فعال |
| `flow_system` | Flow Score | ✅ فعال |
| `liquidity_filter` | فلتر السيولة | ✅ فعال |
| `market_regime` | حالة السوق | ✅ فعال |
| `risk` | بوابة المخاطر | ✅ فعال |
| `fundamental` | الأساسيات | ⚠️ placeholder (`{score: 50.0}`) |
| `confluence` | Confluence | ⚠️ placeholder (`{score: 50.0}`) |
| `breakout` | Breakout | ⚠️ placeholder (`{detected: False}`) |
| `momentum` | Momentum | ⚠️ placeholder (`{score: 50.0}`) |

> **تحذير:** المحركات الفرعية placeholder — لا تعتمد عليها كقرارات حقيقية. الـ المسار الإنتاجي الفعلي يستخدم `V38BacktestEngine.analyze_single_day()` مباشرة.

### منطق الفشل

```python
critical_engines = {'liquidity_filter', 'technical', 'risk'}
failed_critical = [e for e in failed_engines if e['name'] in critical_engines]

if failed_critical:
    result.final_signal = 'NO_TRADE'  # فشل محرك حرج → لا تداول
```

---

## 5. CoreScoringEngine

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/core_scoring_engine.py` |
| **الدور** | طبقة تحليل مستمر (0-100) — مكملة لـ V38 |
| **الوزن** | 0.35 (default `V402_CORE_WEIGHT`) |

### المنطق

`CoreScoringEngine.analyze()` بـ يحسب score مستمر (مش boolean زي V38) بناءً على:
- TREND (اتجاه)
- MOM (زخم)
- MR (mean reversion)
- BRK (breakout)
- FLOW (تدفق السيولة)
- FUND (أساسيات)
- EVENT (أحداث)

### تكامل V40.2

```python
# من daily_predictor.py line 3643-3646
_V38_W  = 0.40   # V38BacktestEngine (boolean conditions)
_CORE_W = 0.35   # CoreScoringEngine (continuous 0-100)
_SMC_W  = 0.15   # Smart Money Concepts
_VP_W   = 0.10   # Volume Profile

# Fallback: لو CoreScoring فشل → زوّد وزن V38
if core_failed:
    _V38_W += _CORE_W
```

---

## 6. محرك حالة السوق (MarketRegimeEngine)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/market_regime_engine.py` |
| **المدخلات** | 6 مؤشرات: SMA20/50/200, breadth, ATR, turnover, loss streak |
| **المخرجات** | `Regime.DEFENSIVE` | `Regime.NORMAL` | `Regime.AGGRESSIVE` |

### عتبات الـ Regime

| Regime | min_rr | min_score | position_size | max_picks |
|--------|--------|-----------|---------------|-----------|
| **DEFENSIVE** | 1.8 | 65 | 0.5× (50%) | 5 |
| **NORMAL** | 1.5 | 65 | 1.0× | 10 |
| **AGGRESSIVE** | 1.2 | 55 | 1.5× | 15 |

### الـ Hysteresis

الـ engine بـ يطبّق **2-3 day hysteresis** — مش بيغيّر الـ regime فورًا، لازم يتأكد إن الحالة الجديدة مستمرة.

---

## 7. محرك الإغلاق اليومي (daily_closer.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/daily_closer.py` (3,789 سطر) |
| **الدور** | يقفل التوقعات المعلّقة (pending) بناءً على تاريخ الأسعار |
| **الـ cron** | بعد إغلاق السوق (15:30 Cairo) |
| **الـ max holding** | 90 يوم |

### مسارات الإغلاق

| المسار | الدور |
|--------|------|
| `_close_with_dynamic_exit` | **المسار الرئيسي** — 9 قواعد خروج ديناميكية |
| `_close_explosive_trend_follow` | للأسهم الانفجارية (trend-following) |
| `_close_with_partial_trailing` | خروج جزئي + trailing |
| `_mark_expired` | انتهاء الصلاحية (90 يوم) |

### الـ Incremental Checkpoint (جديد)

```python
# من daily_closer.py (bravo/closer-incremental)
_CHECKPOINT_VERSION = 2

# قبل كل يوم:
_cp = self._load_checkpoint(pred_id, full_history, entry_idx)
if _cp is not None:
    # استرجع الحالة + ابدأ من آخر يوم مُعالج
    current_stop = _cp['current_stop']
    highest = _cp['highest']
    # ... (7 state vars)
    _loop_start = _cp['last_j'] + 1
else:
    # full rebuild من entry_idx + 1

# بعد كل يوم:
self._save_checkpoint(pred_id, state, last_j, last_date)
```

---

## 8. مصفوفة الأوزان الديناميكية

### V40.2 Weights (افتراضي)

| المحرك | الوزن | env var |
|--------|-------|---------|
| V38BacktestEngine | 0.40 | `V402_V38_WEIGHT` |
| CoreScoringEngine | 0.35 | `V402_CORE_WEIGHT` |
| Smart Money Concepts | 0.15 | `V402_SMC_WEIGHT` |
| Volume Profile | 0.10 | `V402_VP_WEIGHT` |

### ATR Stop Multipliers (حسب الترند)

| الترند | atr_stop_mult |
|--------|--------------|
| strong_bull | 3.0 |
| weak_bull | 2.5 |
| bull | 2.5 |
| range | 1.5 |
| weak_bear | 1.0 |
| bear | 1.0 |
| strong_bear | 0.0 (NO TRADING) |

---

## 9. قواعد الخروج التفصيلية (9 قواعد)

من `daily_closer.py` → `_close_with_dynamic_exit()`:

| القاعدة | الشرط | الإجراء |
|---------|------|---------|
| **1. HARD/DYNAMIC STOP** | `low ≤ current_stop` | إغلاق عند `current_stop` (stop_loss / breakeven / trailing_lock) |
| **1.5. PROFIT_LOCK** | `gain ≥ persona_profit_lock` (balanced=7%) | إغلاق كـ `trailing_profit` |
| **1.7. T1/T2 MULTI-TARGET** | `high ≥ target_price` + T2 موجود + زخم قوي | رفع `current_target` لـ T2 + رفع stop لـ T1 |
| **1.8. T2_HIT** | `high ≥ target_price_2` | إغلاق كـ `TARGET_HIT` عند T2 |
| **2. BREAKEVEN** | `peak_gain ≥ 10%` + `current_stop < entry` | حط stop عند entry (حمي رأس المال) |
| **3. TRAILING LOCK** | `peak_gain ≥ 40%` | trail عند `highest × 0.70` |
| **4. TARGET+MOMENTUM** | `high ≥ current_target` + زخم قوي | HOLD + ارفع target + NOTIFY "كمل" |
| **5. DIP+ANALYSIS-OK** | `gain < 0` + trend intact + `m5 > -2` | HOLD + NOTIFY "ثبّت" |
| **6. TREND-BREAK** | `days_below_sma20 ≥ 2` + `gain ≥ 5%` | EXIT (lock profit) |
| **7. MOMENTUM-DEAD** | `m5 < -5%` + `m20 < -3%` + `gain ≥ 0` | EXIT |
| **8. EXTREME-PROFIT** | `gain ≥ 100%` | EXIT عند `entry × 2.0` |
| **9. TIME** | `j - entry_idx ≥ 90` | EXPIRED |

### تأجيل الوقف (Defer Stop)

```python
# Rule: لو السهم قرب ينهي التصحيح → أجل الـ stop ليوم واحد
if _should_defer_stop_for_correction_end(pred_id, ticker, day_date, close, ...):
    continue  # skip stop-loss check for today
# R4.2: فقط مرة واحدة per prediction (persistent في exit_notifications)
```

---

## 10. عتبات الإشارة + الفلاتر

### V40.2 Thresholds

| الإشارة | الشرط |
|---------|------|
| `STRONG_BUY` | `score ≥ 75` (buy_threshold) |
| `STRONG_BUY` | `maker_bullish AND flight_up` |
| `AVOID` | `score ≤ 30` (tech_score_base - 20) |
| `WAIT` | غير ذلك |

### الفلاتر (Kill Filters)

| الفلتر | الشرط | الإجراء |
|--------|------|---------|
| **Penny Stock** | `price < 1.0` | skip |
| **Dead Volume** | `volume < 1000` | skip |
| **Toxic Blocklist** | ticker في blocklist | skip |
| **B1 Price Sanity** | USD contamination / impossible OHLC / stale data | skip + log `data_invalid` |
| **Whale Distributing** | whale guard بـ يكتشف تصريف | `BUY → HOLD` |
| **Liquidity** | `avg_turnover_20d < threshold` | skip |

### الـ R:R Floor Gate

```python
if r_mult < 1.5:
    continue  # لا تدخل توقع لو R:R < 1.5
```

---

## 11. المؤشرات الفنية (Canonical)

| المؤشر | الملف | الصيغة |
|--------|------|--------|
| **RSI** | `analyzers/indicators/rsi.py` | Wilder's smoothing (مش SMA) |
| **MACD** | `analyzers/indicators/ma.py` | EMA-12/26 + signal EMA-9 |
| **SMA** | `analyzers/indicators/ma.py` | Simple Moving Average |
| **ATR** | `analyzers/indicators/atr.py` | Wilder's (14 period) |
| **Bollinger** | `analyzers/indicators/bollinger.py` | SMA20 ± 2σ |
| **Stochastic RSI** | `analyzers/indicators/srsi.py` | — |
| **MFI** | `analyzers/indicators/mfi.py` | Money Flow Index |
| **VWAP** | `analyzers/indicators/vwap.py` | Volume Weighted Average Price |
| **ADX** | `analyzers/indicators/adx.py` | Trend strength |
| **Volume Profile** | `analyzers/indicators/volume_profile.py` | POC/VAH/VAL |

> **Rule 67:** `analyzers/indicators/` هو المصدر الوحيد للمؤشرات. ممنوع حساب RSI/MACD/ATR في أي ملف تاني.

### مؤشرات TradingView (جديد)

من `data_engine/scrapers/tradingview_scanner_live.py` → `stock_indicators` table:
- RSI, MACD, MACD signal, ATR, SMA20/50/200
- Recommend.All/MA/Other
- Volatility (daily/weekly)
- avg_volume (10/30/90d)
- high/low 52w, beta

**القارئ:** `data_engine/scrapers/indicators_reader.py`

---

## 12. المسار الإنتاجي الفعلي

```
┌─────────────────────────────────────────────────────────────┐
│ 1. data_engine/scrapers/tradingview_scanner_live.py         │
│    يسحب أسعار + مؤشرات من TV → stocks.db                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. scripts/fetch_tv_indices.py                              │
│    يسحب قيم المؤشرات الرسمية → market_indices               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. vps-service/jobs/daily_predictor.py                      │
│    يقرأ stocks.db → V40.2 analysis → يكتب predictions.db    │
│                                                              │
│    التدفق الداخلي:                                           │
│    a. get_tickers(market) → قائمة الأسهم                    │
│    b. pre_cache_price_history() → تحميل مجمّع                │
│    c. لكل ticker:                                            │
│       - B1 Price Sanity Gate                                 │
│       - Liquidity Filter (penny + dead volume)               │
│       - V38BacktestEngine.analyze_single_day()               │
│       - CoreScoringEngine (layer إضافي)                      │
│       - SMC + Volume Profile                                 │
│       - Weighted combination (V38 0.40 + Core 0.35 + ...)    │
│       - Kill filters (R:R floor, whale, toxic)               │
│       - INSERT → predictions + stored_analyses               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. vps-service/jobs/daily_closer.py                         │
│    يقرأ predictions (pending) → 9 exit rules → يقفل         │
│                                                              │
│    الـ Incremental Checkpoint:                               │
│    - يحفظ الحالة (7 vars) بعد كل يوم                         │
│    - يسترجعها في التشغيل التالي → skip الأيام المعالجة       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Next.js API + UI                                         │
│    يقرأ predictions + stored_analyses → يعرض للمستخدم       │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. قواعد المخاطر المعتمدة

### Hard Loss Ceiling

| القاعدة | القيمة |
|---------|--------|
| `hard_loss_ceiling_pct` | 7.0% — ممنوع تسجيل خسارة < -7% |
| `split_drop_threshold_pct` | 35.0% — لو actual_return < -35% → `split_excluded` |

### Split Guard

```python
# من daily_closer.py → _mark_closed()
if actual_return < -35:
    # تجزئة سهم → استبعاد من P&L
    _split_excluded = True
    actual_return = 0
    exit_type = 'split_excluded'
elif actual_return < -7:
    # cap عند -7%
    _capped_loss = True
    actual_return = -7.0
```

### Position Sizing

| Persona | profit_lock | default |
|---------|------------|---------|
| gambler | 4% | — |
| **balanced** | **7%** (أو 1.8R) | ✅ default |
| conservative | 12% | — |

> **UNIFIED-BALANCED-ONLY:** كل التوقعات بتستخدم balanced بس (تعطيل تعدد الشخصيات).

---

## 14. الـ Incremental Engine (جديد)

### 14.1 محرك التوقعات التزايدي

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/predictor_modules/incremental.py` |
| **الجدول** | `prediction_scan_log` |
| **الدور** | منع إعادة حساب (ticker × scan_date) لو البيانات + الإعدادات مطابقة |

**المنطق:**
```python
fingerprint = SHA1(OHLCV from entry_idx to day_idx)
engine_hash = SHA1(engine_version + buy_threshold + market + regime + strict_kill)

if should_skip(ticker, scan_date, engine_hash, fingerprint):
    continue  # نتيجة سابقة صالحة → skip
else:
    result = engine.analyze_single_day(...)
    record_result(ticker, scan_date, engine_hash, fingerprint, result)
```

### 14.2 محرك الإغلاق التزايدي

| الخاصية | القيمة |
|---|---|
| **الـ checkpoint version** | 2 |
| **الحالة المحفوظة** | 7 متغيرات: current_stop, current_target, highest, lowest, notified_breakeven, notified_hold, days_below_sma20_running |
| **الـ fingerprint** | SHA1 of OHLCV from entry_idx to last_j (يكشف تعديل الأسعار التاريخية) |

**الأمان:**
- `data_fingerprint` إلزامي في V2 (غيابه → reject → full rebuild)
- `last_date` لازم يطابق `full_history[last_j]['date']`
- الـ save ذري (state + last_checked_date في transaction واحدة)
- `_mark_closed` بـ يمسح checkpoint في نفس transaction الإغلاق

### 14.3 الإشعارات Idempotent

```python
# pre-insert check (non-destructive)
SELECT 1 FROM exit_notifications
WHERE prediction_id = ? AND day_number = ? AND notification_type = ?
# لو موجود → skip (no duplicate)
```

**Concurrency:** `fcntl.flock` (LOCK_EX) في `run()` يمنع تشغيل نسختين متعارضتين.

---

## المراجع

- **V40.2 engine:** `vps-service/engines/backtest_engine.py`
- **Orchestrator:** `vps-service/core/orchestrator.py`
- **Executor:** `vps-service/core/executor.py`
- **CoreScoringEngine:** `vps-service/analyzers/core_scoring_engine.py`
- **MarketRegimeEngine:** `vps-service/analyzers/market_regime_engine.py`
- **Daily Closer:** `vps-service/jobs/daily_closer.py`
- **Daily Predictor:** `vps-service/jobs/daily_predictor.py`
- **Incremental (predictor):** `vps-service/jobs/predictor_modules/incremental.py`
- **Engine Settings:** `vps-service/analyzers/engine_settings.py`
- **Canonical Indicators:** `vps-service/analyzers/indicators/`
- **Decision Logger:** `vps-service/analyzers/decision_logger.py`
