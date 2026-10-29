# 03 — المحركات والمنطق الاستثماري (تفاصيل كاملة)

> **آخر تحديث:** 2026-10-29 | **Commit:** `d4ac285`
> **كل معادلة + كل threshold + كل branch logic موثّق من الكود الفعلي.**

---

## الفهرس

1. [فلسفة النظام + القواعد الذهبية](#1-فلسفة-النظام)
2. [V40.2 Engine (backtest_engine.py)](#2-v402-engine)
3. [Orchestrator + Executor](#3-orchestrator--executor)
4. [CoreScoringEngine](#4-corescoringengine)
5. [MarketRegimeEngine](#5-marketregimeengine)
6. [نظام السيولة والرادار (shared_liquidity.py)](#6-نظام-السيولة-والرادار)
7. [FlowSystemEngine (flow_system.py)](#7-flowsystemengine)
8. [فلتر السيولة (liquidity_filter.py)](#8-فلتر-السيولة)
9. [محرك الإغلاق (daily_closer.py)](#9-محرك-الإغلاق)
10. [الأوزان + العتبات + الفلاتر](#10-الأوزان-والعتبات)
11. [المؤشرات الفنية Canonical](#11-المؤشرات-الفنية)
12. [المسار الإنتاجي + قواعد المخاطر](#12-المسار-الإنتاجي)

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:
1. **Rule-Based** (110+ محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama — للـ sentiment فقط)

### القواعد الذهبية الثمانية (Hard Veto Layer)

| # | القاعدة | التفصيل |
|---|---------|---------|
| 1 | **Liquidity First** | تخطّى التحليل لو السهم غير قابل للتداول (dynamic thresholds حسب السعر) |
| 2 | **Market Regime Filter** | تعديل الثقة + الأحجام + max_picks حسب حالة السوق (DEFENSIVE/NORMAL/AGGRESSIVE) |
| 3 | **Sector-Relative Fundamentals** | مقارنة داخل القطاع (مش قيم مطلقة) |
| 4 | **Session Dynamics** | ديناميكية الجلسة (مش "أفضل ساعات") |
| 5 | **Unified Scoring** | Weighted combination: V38(0.40) + Core(0.35) + SMC(0.15) + VP(0.10) |
| 6 | **Strict Thresholds** | STRONG_BUY ≥ 75, AVOID ≤ 30 |
| 7 | **Risk Profile** | Position + Stop + Target + Time لكل إشارة |
| 8 | **Feedback Loop** | التعلّم من الأخطاء (learned_lessons table) |

---

## 2. V40.2 Engine

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/engines/backtest_engine.py` (2,373 سطر) |
| **الـ class** | `V38BacktestEngine(use_v393=True)` → V40.2 |
| **المدخلات** | `ticker, dates, opens, highs, lows, closes, volumes, day_idx, sector_change` |
| **المخرجات** | `{signal, score, entry_price, target_price, stop_loss, risk_reward, ...}` |

### عتبات الإشارة (مفصلة)

```python
# 1. لو maker_bullish + flight_up → STRONG_BUY (أقوى إشارة)
if maker.maker_bullish and flight_code == 'flight_up':
    signal = 'STRONG_BUY'

# 2. لو score ≥ buy_threshold (default 75) → STRONG_BUY
elif score >= self.buy_threshold:
    signal = 'STRONG_BUY'

# 3. لو score ≤ (tech_score_base - 20) = 30 → AVOID
elif score <= int(get_setting('tech_score_base', default=50) - 20):
    signal = 'AVOID'

# 4. غير كده → WAIT
else:
    signal = 'WAIT'
```

> **ملاحظة:** `INSTITUTIONAL_BUY` تم قتله (BRAVO-KILL-INST-BUY) لأن WR=0% (13 توقع كلهم STOPPED).

### حساب الـ Risk Profile (مفصلة)

```python
# Entry = آخر إغلاق
entry = closes[-1]

# Stop loss = entry - ATR × multiplier
if ob_state.active_ob > 0 and ob_state.active_ob < entry:
    sl = ob_state.active_ob - (atr × 0.5)   # Order Block stop (أضيق)
else:
    sl = entry - (atr × 1.5)                 # default stop

# لو sl ≥ entry (غلط) → استخدم default
if sl >= entry:
    sl = entry - (atr × 1.5)

# Targets
risk = entry - sl
tp1 = entry + (risk × rr1)   # rr1 = 1.5
tp2 = entry + (risk × rr2)   # rr2 = 3.0

# Override TP1 with DNA target if better
if dna.get('bullish') and dna.get('target_price') and dna['target_price'] > entry:
    tp1 = dna['target_price']
```

### ATR Stop Bounds (حسب السوق)

| السوق | atr_stop_min_pct | atr_stop_max_pct | السبب |
|-------|-----------------|-----------------|-------|
| EGX | 5.0% | 9.0% | تذبذب عالي |
| TADAWUL | 3.0% | 7.0% | تذبذب متوسط |
| US | 2.0% | 5.0% | تذبذب منخفض |

### ATR Stop Multipliers (حسب الترند)

| الترند | atr_stop_mult | السبب |
|--------|--------------|-------|
| strong_bull | 3.0 | stops واسعة، targets كبيرة |
| weak_bull | 2.5 | normal |
| bull | 2.5 | المحرك بـ يستخدم 'bull'/'bear'/'range' |
| range | 1.5 | tight — مفيش ترند واضح |
| weak_bear | 1.0 | very tight — defensive |
| bear | 1.0 | defensive |
| strong_bear | 0.0 | **NO TRADING** — لا تداول |

---

## 3. Orchestrator + Executor

### Orchestrator (`vps-service/core/orchestrator.py` — 127 سطر)

**الدور:** يخطط مسار التحليل — **لا يحسب مؤشرات، لا يصدر توصيات**

```python
def create_plan(ticker, market, data_quality, market_state):
    # Gate 1: data insufficient → NO_TRADE
    if data_quality == 'insufficient':
        return EnginePlan(decision_policy='no_trade')

    # Gate 2: حدد المحركات حسب الـ regime
    engine_set = ENGINE_SETS[market_state]

    # Gate 3: فلتر حسب السوق (crypto مثلاً)
    if market == 'CRYPTO':
        selected.append('crypto')
        skipped.append({'name': 'fundamental', 'reason': 'not applicable'})

    return EnginePlan(
        selected_engines=selected,
        decision_policy='full' if data_quality == 'fresh' else 'partial_allowed'
    )
```

### ENGINE_SETS

| Regime | المحركات المختارة | المتخطاة |
|--------|-------------------|---------|
| **DEFENSIVE** | liquidity_filter, market_regime, technical, fundamental, risk | breakout, momentum, crypto |
| **NORMAL** | liquidity_filter, market_regime, technical, fundamental, confluence, risk | — |
| **AGGRESSIVE** | liquidity_filter, market_regime, technical, fundamental, confluence, breakout, momentum, risk | — |
| **UNKNOWN** | liquidity_filter, market_regime, technical, fundamental, risk | breakout, momentum |

### ENGINE_SETS Weights

| Regime | technical | fundamental | confluence | breakout | momentum | liquidity | risk |
|--------|-----------|-------------|------------|----------|----------|-----------|------|
| DEFENSIVE | 0.35 | 0.35 | — | — | — | 0.15 | 0.15 |
| NORMAL | 0.25 | 0.25 | 0.25 | — | — | 0.10 | 0.15 |
| AGGRESSIVE | 0.20 | 0.20 | 0.20 | 0.15 | 0.10 | — | 0.15 |
| UNKNOWN | 0.30 | 0.30 | — | — | — | 0.15 | 0.25 |

### Executor (`vps-service/core/executor.py` — 235 سطر)

```python
# المحركات الحرجة — لو فشلت → NO_TRADE
critical_engines = {'liquidity_filter', 'technical', 'risk'}

failed_critical = [e for e in failed_engines if e['name'] in critical_engines]
if failed_critical:
    result.final_signal = 'NO_TRADE'
    result.complete = False
```

> **تحذير:** المحركات الفرعية (fundamental, confluence, breakout, momentum) بتـ return placeholders (`{score: 50.0}`). المسار الإنتاجي الفعلي يستخدم `V38BacktestEngine.analyze_single_day()` مباشرة.

---

## 4. CoreScoringEngine

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/core_scoring_engine.py` |
| **الوزن** | 0.35 (`V402_CORE_WEIGHT`) |
| **المدخلات** | price_data (OHLCV) + market profile + volume_ratio |

### عائلات التحليل السبع

| العائلة | الدور | المنطق |
|---------|------|--------|
| **TREND** | اتجاه | SMA alignment + ADX strength |
| **MOM** | زخم | RSI + MACD + rate of change |
| **MR** | Mean Reversion | Bollinger bands + RSI extremes |
| **BRK** | Breakout | Donchian breakout + range compression |
| **FLOW** | تدفق السيولة | volume_ratio (≥2.0× = قوي) + money_flow |
| **FUND** | أساسيات | Piotroski + Altman + sector-relative |
| **EVENT** | أحداث | earnings + dividends + news sentiment |

### تكامل V40.2 (مفصّل)

```python
# الأوزان (env vars للـ tuning)
_V38_W  = float(os.environ.get('V402_V38_WEIGHT', '0.40'))   # V38BacktestEngine
_CORE_W = float(os.environ.get('V402_CORE_WEIGHT', '0.35'))  # CoreScoringEngine
_SMC_W  = float(os.environ.get('V402_SMC_WEIGHT', '0.15'))   # Smart Money Concepts
_VP_W   = float(os.environ.get('V402_VP_WEIGHT', '0.10'))    # Volume Profile
_total_w = _V38_W + _CORE_W + _SMC_W + _VP_W  # = 1.0

# Fallback: لو CoreScoring فشل → زوّد وزن V38
if core_failed:
    _V38_W += _CORE_W
    logger.warning(f"→ fallback: V38 وزن {_V38_W:.2f}")
```

---

## 5. MarketRegimeEngine

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/market_regime_engine.py` |
| **المدخلات** | 6 مؤشرات |
| **المخرجات** | `Regime.DEFENSIVE` | `Regime.NORMAL` | `Regime.AGGRESSIVE` |

### المؤشرات الـ 6

1. **SMA20/50/200** — اتجاه المؤشر
2. **Breadth** — % أسهم صاعدة
3. **ATR ratio** — تذبذب
4. **Turnover ratio** — سيولة
5. **Loss streak** — أيام خسارة متتالية
6. **Short-term drawdown** — هبوط قصير المدى

### عتبات الـ Regime (مفصّلة)

| Regime | min_rr | min_score | position_size | max_picks | max_open_positions |
|--------|--------|-----------|---------------|-----------|-------------------|
| **DEFENSIVE** | 1.8 | 65 | 0.5× (50%) | 5 | (from config) |
| **NORMAL** | 1.5 | 65 | 1.0× | 10 | (from config) |
| **AGGRESSIVE** | 1.2 | 55 | 1.5× | 15 | (from config) |

### الـ Hysteresis

الـ engine بـ يطبّق **2-3 day hysteresis**:
- مش بيغيّر الـ regime فورًا
- لازم الـ candidate regime يستمر 2-3 أيام
- بـ يـ persist في `system_settings` + `market_regime_log`

### Safe Fallback

```python
# لو الـ regime engine فشل → NORMAL defaults
except Exception as _regime_err:
    print(f"⚠️ [REGIME] engine failed — using NORMAL defaults")
    _regime_cfg = REGIME_CONFIG[Regime.NORMAL]
```

---

## 6. نظام السيولة والرادار (shared_liquidity.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/utils/shared_liquidity.py` (1,179 سطر) |
| **الدور** | **الرادار الفعلي** — كشف نشاط غير طبيعي + تصنيف + درجة سيولة |
| **يُستخدم بواسطة** | `maker_radar.py` + `daily_predictor.py` + `liquidity_filter.py` |

### 6.1 كل الثوابت (Constants)

```python
# ── Dynamic Turnover Thresholds (حسب السعر) ──
DYNAMIC_TURNOVER_THRESHOLDS = {
    'low_price': 80_000,     # price < 5
    'mid_price': 200_000,    # 5 ≤ price ≤ 15
    'high_price': 400_000,   # price > 15
}
DEAD_MARKET_CEILING = 700_000           # لو السوق ميت

# ── Volume Surge (للـ bypass العادي) ──
VOLUME_SURGE_RATIO = 1.5               # × متوسط 20d
VOLUME_SURGE_LOOKBACK = 5              # آخر 5 شموع
VOLUME_BASE_LOOKBACK = 20              # متوسط 20 شمعة
VOLUME_SURGE_MA_PERIOD = 20            # MA20 للسعر
LIQUIDITY_BYPASS_POSITION_SIZE = 0.025 # 2.5%
LIQUIDITY_BYPASS_THRESHOLD_REDUCTION = 0.5  # خفّض threshold لـ 50%

# ── Explosive Surge (أقوى من bypass) ──
EXPLOSIVE_SURGE_VOLUME_RATIO = 1.7     # max(last 3d) / base_20d
EXPLOSIVE_SURGE_LOOKBACK = 5
EXPLOSIVE_SURGE_BASE = 20
EXPLOSIVE_SURGE_SMA_PERIOD = 20
EXPLOSIVE_SURGE_RANGE_MAX_PCT = 18.0   # range 20d < 18%
EXPLOSIVE_SURGE_RANGE_WINDOW = 20
EXPLOSIVE_SURGE_POSITION_SIZE = 0.02   # 2%

# ── Quiet Accumulation ──
QUIET_ACCUM_LOOKBACK = 10
QUIET_ACCUM_VOLUME_DAYS_HIGH = 3       # 3 من 10 أيام
QUIET_ACCUM_VOLUME_RATIO_MIN = 1.1     # volume > 1.1× avg_20d
QUIET_ACCUM_BUY_PRESSURE_DAYS = 4      # 4 من 10 أيام
QUIET_ACCUM_CLOSE_TO_HIGH_PCT = 75.0   # close ≥ 75% من range
QUIET_ACCUM_RANGE_MAX_PCT = 14.0       # range 10d < 14%
QUIET_ACCUM_AVG_VOL_RATIO_MIN = 0.7    # avg_10d ≥ 70% من avg_20d
QUIET_ACCUM_ROC_10D_MAX = 12.0         # ROC 10d < 12%
QUIET_ACCUM_DIST_DAYS_MAX = 3          # ≤3 أيام distribution
QUIET_ACCUMULATION_MIN_SIGNALS = 5     # 5 من 6
QUIET_ACCUMULATION_POSITION_SIZE = 0.015  # 1.5%

# ── Pre-Surge ──
PRE_SURGE_LOOKBACK = 10
PRE_SURGE_MIN_SIGNALS = 3              # 3 من 4
PRE_SURGE_VOLUME_GRADIENT_MIN = 0.15   # gradient ≥ 15%
PRE_SURGE_RANGE_MAX_PCT = 10.0         # range 10d < 10%
PRE_SURGE_BUY_DAYS_MIN = 4            # 4 من 7 أيام
PRE_SURGE_MA_PROXIMITY_PCT = 3.0      # خلال 3% من MA10
PRE_SURGE_POSITION_SIZE = 0.015       # 1.5%
```

### 6.2 classify_price_bucket + dynamic_min_turnover

```python
def classify_price_bucket(price):
    if price <= 0:   return 'unknown'
    if price < 5:    return 'low_price'
    if price <= 15:  return 'mid_price'
    return 'high_price'

def dynamic_min_turnover(price, market_dead=False):
    if market_dead:
        return 700_000                    # DEAD_MARKET_CEILING
    bucket = classify_price_bucket(price)
    if bucket == 'unknown':
        return 400_000                    # احتياط (الحد الأعلى)
    return DYNAMIC_TURNOVER_THRESHOLDS[bucket]
    # low_price → 80K, mid_price → 200K, high_price → 400K
```

### 6.3 has_volume_surge (للـ bypass العادي)

```python
def has_volume_surge(volumes, closes, surge_ratio=1.5, ...):
    # الشرط 1: non-overlapping baseline (ممنوع fallback)
    required_len = 5 + 20  # = 25
    if len(volumes) < 25:
        return False, 'بيانات غير كافية'

    # الشرط 2: recent_avg / base_avg ≥ 1.5
    recent_avg = avg(volumes[-5:])
    base_avg = avg(volumes[-25:-5])
    ratio = recent_avg / base_avg
    if ratio < 1.5:
        return False, f'ratio={ratio:.2f} < 1.5'

    # الشرط 3: close > MA20
    ma20 = avg(closes[-20:])
    if close[-1] <= ma20:
        return False, 'السعر تحت MA20'

    return True, 'volume_surge + فوق MA20'
```

### 6.4 is_explosive_surge (أقوى من bypass)

```python
def is_explosive_surge(volumes, closes, ...):
    # الشرط 1: max(last 3d) / base_20d ≥ 1.7
    recent_peak = max(volumes[-3:])
    base_avg = avg(volumes[-25:-5])
    vol_ratio = recent_peak / base_avg
    if vol_ratio < 1.7:
        return False, f'vol_surge {vol_ratio:.2f} < 1.7'

    # الشرط 2: close > SMA20
    sma20 = avg(closes[-20:])
    if close[-1] <= sma20:
        return False, 'السعر ≤ SMA20'

    # الشرط 3: range 20d (قبل الـ surge) < 18%
    pre_window = closes[-25:-5]
    range_pct = (max(pre_window) - min(pre_window)) / min(pre_window) × 100
    if range_pct >= 18.0:
        return False, f'range {range_pct:.1f}% ≥ 18%'

    return True, 'EXPLOSIVE_SURGE — vol + SMA20 + range منضغط'
```

### 6.5 should_reject_by_liquidity (القرار النهائي)

```python
def should_reject_by_liquidity(avg_turnover, current_price, volumes, closes, market_dead):
    # 1. Pump-and-dump guard
    if avg_turnover <= 0:
        return (True, 'turnover=0', False, 0, False)

    # 2. احسب threshold
    threshold = dynamic_min_turnover(current_price, market_dead)
    # low_price → 80K, mid → 200K, high → 400K, dead_market → 700K

    # 3. لو فوق threshold → اقبل عادي
    if avg_turnover >= threshold:
        return (False, 'ok', False, threshold, False)

    # 4. فحص EXPLOSIVE_SURGE (أقوى، position 2%)
    explosive, _, _ = is_explosive_surge(volumes, closes)
    if explosive:
        return (False, 'EXPLOSIVE_SURGE', False, threshold, True)

    # 5. فحص VOLUME_SURGE_BYPASS (position 2.5%)
    bypass, _ = has_volume_surge(volumes, closes)
    if bypass:
        reduced_threshold = threshold × 0.5   # خفّض لـ 50%
        if avg_turnover >= reduced_threshold:
            return (False, 'BYPASS', True, reduced_threshold, False)

    # 6. سيولة ميتة → ارفض
    return (True, 'سيولة ميتة', False, threshold, False)
```

### 6.6 detect_quiet_accumulation (6 إشارات)

```python
# الفلاتر المسبقة (pre-rejection):
# - ROC20 < -12% → هبوط قوي → مش تجميع
# - ROC10 < -8% → هبوط حاد → مش تجميع
# - turnover < 50K → سيولة ميتة
# - move > +50% + volume < 30% avg → pump مشبوه
# - ROC10 < -5% (أو -8% DEFENSIVE) → ضعف نسبي

# الإشارات الـ 6 (مطلوب 5/6):
# 1. Volume high recurring: ≥3 من 10 أيام volume > 1.1× avg_20d
#    (DEFENSIVE: ≥2 من 10)
# 2. Buy pressure: ≥4 من 10 أيام close ≥ 75% من range
#    (DEFENSIVE: ≥2 من 10)
# 3. Compressed: range 10d < 14%
# 4. Volume not low: avg_10d ≥ 70% من avg_20d
# 5. Not explosive: ROC 10d < 12%
# 6. No distribution: ≤3 أيام distribution
#    (DEFENSIVE: ≤3)

# position size: 1.5% (paper mode)
```

### 6.7 detect_pre_surge (4 إشارات)

```python
# الفلاتر المسبقة: نفس quiet_accumulation

# الإشارات الـ 4 (مطلوب 3/4):
# 1. Volume gradient: (late_5_vol - early_5_vol) / early_5_vol ≥ 0.15 (15%)
# 2. Range compressed: range 10d < 10%
# 3. Buy days: 4 من 7 أيام شراء (DEFENSIVE: 2 من 7)
# 4. Near MA10: |close - MA10| / MA10 × 100 ≤ 3%

# position size: 1.5% (أعلى مخاطرة — أعلى مكافأة)
```

### 6.8 compute_money_flow (6 طبقات)

```python
# ── الطبقة 1: CLV (Close Location Value) — لآخر 5 أيام (weighted) ──
# weights = [0.10, 0.15, 0.20, 0.25, 0.30]  (أقدم → أحدث)
# CLV = ((close - low) - (high - close)) / (high - low)  → -1..1
# clv_5d_weighted = weighted average
# clv_score = (clv_5d_weighted + 1) / 2 × 100  → 0..100

# ── الطبقة 2: CMF (Chaikin Money Flow) — 20 يوم ──
# لكل يوم: CLV × volume
# CMF = Σ(CLV × volume) / Σ(volume)  → -1..1
# cmf_score = (CMF + 1) / 2 × 100  → 0..100

# ── الطبقة 3: Volume confirmation ──
# vol_ratio = last_vol / avg_20d
# vol_confirmation = clamp((vol_ratio - 0.5) / 1.0, 0, 1)
#   vol_ratio ≥ 1.5 → 1.0 (تأكيد قوي)
#   vol_ratio ≤ 0.5 → 0.0 (مش مؤكد)
# vol_score = vol_confirmation × 100

# ── الطبقة 4: Trend filter (trend penalty) ──
# roc_20d = (close[-1] - close[-20]) / close[-20] × 100
# لو roc_20d < -15% → penalty = -25
# لو roc_20d < -10% → penalty = -18
# لو roc_20d < -5%  → penalty = -10
# لو roc_20d > +10% → penalty = +5

# ── الطبقة 5: Dead volume filter ──
# is_dead = vol_ratio < 0.3

# ── الطبقة 6: SMA alignment ──
# sma10 = avg(closes[-10:])
# close > sma10 → price_above_sma = 1.0
# close < sma10 → price_above_sma = 0.0
# sma_score = price_above_sma × 100

# ── الحساب النهائي ──
is_today_strong_up = (close[-1] > close[-2])
if is_today_strong_up and vol_ratio >= 1.0:
    # لو اليوم صاعد بحجم قوي → استخدم شمعة اليوم
    body_pressure = (|close - open| / (high - low)) × sign
    body_score = ((body_pressure + 1) / 2) × 100
    today_clv = ((close - low) - (high - close)) / (high - low)
    today_clv_score = ((today_clv + 1) / 2) × 100
    raw_buy_pct = (today_clv_score × 0.60) + (body_score × 0.40)
    trend_penalty = max(0, trend_penalty)  # لا penalty للانفجار
else:
    # legacy formula
    raw_buy_pct = (clv_score × 0.35) + (cmf_score × 0.30) + (vol_score × 0.20) + (sma_score × 0.15)

buy_pct = clamp(raw_buy_pct + trend_penalty, 0, 100)

# ── طبقات الحماية النهائية ──
# لو roc_20d < -15% → buy ≤ 35% (sell=65%)
# لو roc_20d < -10% → buy ≤ 45% (sell=55%)
# لو is_dead → buy ≤ 40%
# لو range_10d < 2% (flat) → buy = 50% (متوازن)

sell_pct = 100 - buy_pct
```

### 6.9 detect_life_cycle (6 مراحل)

```python
# ATR proxy: متوسط المدى اليومي في آخر 14 يوم
# atr_sma: متوسط مدى الـ 14 يوم السابقة (مستقل)

# 1. 🟡 نعاس: atr < 60% من atr_sma + volume < 50% median
# 2. 🚀 انفجار: شمعة خضراء + body > 70% range + volume > 2× median
# 3. 🟢 جني أرباح: شمعة حمراء + range < 50% ATR + volume < 80% median
# 4. 🚨 توزيع قاتل: شمعة حمراء + range > 150% ATR + volume > 2× median
# 5. ⚠️ تدوير وهمي: volume > 2× median + range < 50% ATR
# 6. 🚫 حبس (Limit Up): daily change > 9.5% + volume < median
# 7. عادي: غير كده
```

### 6.10 check_kill_switch

```python
def check_kill_switch(closes, volumes, highs, lows):
    life_cycle = detect_life_cycle(closes, volumes, highs, lows)
    if life_cycle == '🚨 توزيع قاتل':
        return True, 'توزيع قاتل — إغلاق فوري'
    if life_cycle == '🚫 حبس (Limit Up)':
        return True, 'حبس — متدخلش'
    if life_cycle == '⚠️ تدوير وهمي':
        return True, 'تدوير وهمي — احذر'
    return False, ''
```

### 6.11 check_limit_up_trap

```python
def check_limit_up_trap(closes, volumes):
    daily_change = (close[-1] - close[-2]) / close[-2] × 100
    if daily_change <= 9.5:
        return False
    # لو volume حقيقي (أكبر من 1M أو ≥ 1× avg) → مش فخ
    if last_vol > 1_000_000 or (last_vol / avg_10d) >= 1.0:
        return False  # سيولة حقيقية
    return True  # فخ
```

---

## 7. FlowSystemEngine (flow_system.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/engines/flow_system.py` (1,335 سطر) |
| **الدور** | تحليل تدفق السيولة على 3 مستويات + cross-validation |
| **المخرجات** | `FlowScore` (0-100) + label + action + position + stop + target |

### 7.1 الـ 4 طبقات + الأوزان

```python
total_score = (
    macro['score'] × 0.25 +       # Macro Flow (EGX30)
    sector_flow['score'] × 0.30 + # Sector Flow
    stock_flow['score'] × 0.25 +  # Stock Flow
    cross['score'] × 0.20         # Cross Validation
)
# + fundamentals bonus (up to +10)
total_score = min(100, total_score + fundamentals_bonus)
```

### 7.2 Layer 1: Macro Flow (25%)

```python
score = 50  # neutral start
if egx30_change > 1.0:    score += 15  # صاعد قوي
elif egx30_change > 0.2:  score += 8   # صاعد
elif egx30_change > -0.2: score += 0   # محايد
elif egx30_change > -1.0: score -= 8   # هابط
else:                     score -= 15  # هابط قوي
score = clamp(score, 0, 100)
```

### 7.3 Layer 2: Sector Flow (30%)

```python
score = 50

# 1. Turnover vs 20-day avg (30 points max)
if turnover_ratio > 2.0:  score += 15  # سيولة عالية جداً
elif turnover_ratio > 1.5: score += 10 # سيولة عالية
elif turnover_ratio > 1.0: score += 5  # فوق المتوسط
elif turnover_ratio < 0.5: score -= 10 # سيولة ضعيفة

# 2. Sector direction (25 points)
if sector_avg > 1.0:   score += 12  # قيادي
elif sector_avg > 0:   score += 5   # صاعد
elif sector_avg < -1.0: score -= 12 # هابط
elif sector_avg < 0:   score -= 5   # ضعيف

# 3. Sector breadth (20 points)
if breadth > 70:  score += 10  # اتساع قوي
elif breadth > 50: score += 5  # اتساع جيد
elif breadth < 30: score -= 10 # اتساع ضعيف

score = clamp(score, 0, 100)
```

### 7.4 Layer 3: Stock Flow (25%)

```python
score = 50

# 1. Volume vs avg (25 points)
if volume_ratio > 2.0:  score += 15  # سيولة عالية جداً
elif volume_ratio > 1.5: score += 10 # سيولة عالية
elif volume_ratio > 1.0: score += 5  # فوق المتوسط
elif volume_ratio < 0.3: score -= 10 # سيولة ضعيفة جداً

# 2. RSI (15 points)
if rsi < 30:        score += 10  # تشبع بيعي (فرصة)
elif rsi > 70:      score -= 10  # تشبع شرائي (خطر)
elif 40 <= rsi <= 60: score += 5 # محايد (صحي)

# 3. Near support/resistance (15 points)
if |dist_to_support| < 3%:    score += 10  # قريب من الدعم
elif |dist_to_resistance| < 3%: score -= 8  # قريب من المقاومة

# 4. Price momentum (10 points)
if change > 2.0:   score += 8   # زخم قوي
elif change > 0.5: score += 4   # صاعد
elif change < -2.0: score -= 8  # هابط قوي
elif change < -0.5: score -= 4  # هابط

score = clamp(score, 0, 100)
```

### 7.5 Layer 4: Cross Validation (20%)

```python
score = 50

# 1. Stock = Sector direction TODAY (25 points)
if (stock > 0 and sector > 0) or (stock < 0 and sector < 0):
    score += 15  # نفس الاتجاه ✓
elif stock > 3 and sector < -0.5:
    score -= 15  # ⚠️ مضاربة/فخ
elif stock > 1 and sector < 0:
    score -= 8   # مراقبة
else:
    score -= 5   # عكس

# 2. Sector 7-day trend (25 points)
if sector_7d > 5:   score += 15  # زخم قوي
elif sector_7d > 0: score += 8   # صاعد
elif sector_7d < -5: score -= 15 # ابعد
elif sector_7d < 0: score -= 5   # هابط

# 3. Sector breadth (20 points)
if breadth > 70:  score += 10
elif breadth > 50: score += 5
elif breadth < 30: score -= 10

# 4. Sector = Market direction (15 points)
if same_direction(sector, market): score += 8
else: score -= 5

# 5. Triple confirmation (15 points bonus)
if all_same_direction(stock, sector, market):
    score += 10  # تأكيد ثلاثي ✓✓✓
elif stock > 2 and sector < -0.5:
    score -= 10  # ⚠️ تناقض خطير = فخ

score = clamp(score, 0, 100)
```

### 7.6 FlowScore Labels + Actions

```python
if total_score >= 75:
    label = "نار" (FIRE), color=red
    action = "دخول قوي" (STRONG_ENTRY)
    position = 2%  # أقصى حجم
elif total_score >= 60:
    label = "شرارة" (SPARK), color=orange
    action = "دخول حذر" (CAUTIOUS_ENTRY)
    position = 2.5%  # أقصى حجم
elif total_score >= 40:
    label = "رماد" (ASH), color=gray
    action = "استنى" (WAIT)
    position = 0
else:
    label = "بارد" (COLD), color=blue
    action = "ماتدخلش" (AVOID)
    position = 0

# Stop/Target: ديناميكي من ATR (Wilder's) + clamp [5%, 9%]
# target = stop_dist × 1.8 (R/R ≥ 1.8)
# لو مفيش ATR → stop=5%, target=9%
```

---

## 8. فلتر السيولة (liquidity_filter.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/liquidity_filter.py` (1,111 سطر) |
| **الدور** | بوابة الرفض الإجبارية (Kill Filters) |

### 8.1 Kill Filters الخمسة (مفصّلة)

```python
def evaluate_kill_filters(ticker, closes, volumes, current_price, avg_turnover, ...):
    # 1. السيولة (dynamic, مش ثابت!)
    threshold = dynamic_min_turnover(current_price)
    # low_price → 80K, mid → 200K, high → 400K
    # + bypass: لو surge ≥ 1.5× → اقبل بـ 50% threshold (position 2.5%)
    # + explosive: لو surge ≥ 1.7× + SMA20 + range < 18% → اقبل (position 2%)
    if avg_turnover < threshold and not bypass and not explosive:
        EXCLUDED

    # 2. السعر (penny stock)
    if current_price < 1.0:
        EXCLUDED

    # 3. تذبذب الحجم (تلاعب)
    vol_std = stdev(volumes[-20:])
    vol_avg = avg(volumes[-20:])
    if vol_std / vol_avg > 3.0:
        EXCLUDED

    # 4. البيانات
    if data_bars_count < 20:
        EXCLUDED
    # استثناء: السوق المقفول → خفّف لـ 8 (15% من 20)

    # 5. القوة النسبية
    rs = stock_roc - benchmark_change
    if rs < -2.0:
        EXCLUDED
```

### 8.2 LiquidityFilter Class Thresholds

```python
MIN_VOLUME = 100_000              # 100K shares (legacy)
MIN_TURNOVER = 3_000_000          # LEGACY FALLBACK (dynamic بـ يحل محله)
MIN_VOLUME_CLOSED = 50_000        # 50K (نص الحد في السوق المقفول)
MIN_TURNOVER_CLOSED = 500_000     # LEGACY
MIN_STOCK_PRICE = 1.00            # penny stock

# Dynamic Turnover
DYNAMIC_TURNOVER_VOLUME_SPIKE_THRESHOLD = 2.5  # ×
DYNAMIC_TURNOVER_SPIKE_FLOOR = 300_000         # 300K لو فيه spike
DYNAMIC_TURNOVER_DEAD_MARKET_RATIO = 0.7       # < 70% = سوق ميت
DYNAMIC_TURNOVER_DEAD_MARKET_CEILING = 700_000 # 700K لو السوق ميت

# Free Float
FREE_FLOAT_CRITICAL = 5.0         # % — خطير جداً (mult=0.2)
FREE_FLOAT_RISKY = 15.0           # % — مخاطرة عالية (mult=0.5)
```

---

## 9. محرك الإغلاق (daily_closer.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/daily_closer.py` (3,789 سطر) |
| **الـ max holding** | 90 يوم |

### 9.1 الـ 9 قواعد خروج (مفصّلة بالمعادلات)

```
لكل يوم j من entry_idx+1 لـ entry_idx+90:

  Rule 1: HARD/DYNAMIC STOP
    لو low ≤ current_stop:
      actual_return = (current_stop - entry) / entry × 100
      لو current_stop ≥ entry × 0.99 → exit_label='breakeven', status='CLOSED'
      لو current_stop > stop_orig and < entry × 1.10 → 'trailing_lock', 'CLOSED'
      else → 'stop_loss', 'STOPPED'
      → إغلاق عند current_stop

  Rule 1.5: PROFIT_LOCK
    gain_pct = (close - entry) / entry × 100
    _profit_lock_pct = 1.8 × stop_distance_pct  (EGX-STRATEGY)
    لو gain_pct ≥ _profit_lock_pct:
      → إغلاق كـ 'trailing_profit'

  Rule 1.7: T1/T2 MULTI-TARGET
    لو target_price_2 > 0 and high ≥ target_price and current_target < target_price_2
       and momentum_strong and trend_intact:
      current_target = target_price_2
      لو target_price > current_stop: current_stop = target_price  # حمي T1

  Rule 1.8: T2_HIT
    لو target_price_2 > 0 and high ≥ target_price_2:
      → إغلاق كـ 'TARGET_HIT' عند target_price_2

  Rule 2: BREAKEVEN
    peak_gain_pct = (highest - entry) / entry × 100
    لو peak_gain_pct ≥ 10% and current_stop < entry and not notified_breakeven:
      current_stop = entry  # حمي رأس المال
      notified_breakeven = True

  Rule 3: TRAILING LOCK
    لو peak_gain_pct ≥ 40%:
      trail_candidate = highest × 0.70
      لو trail_candidate > current_stop: current_stop = trail_candidate

  Rule 4: TARGET+MOMENTUM
    لو high ≥ current_target and momentum_strong and trend_intact:
      new_target = max(close × 1.15, entry × 1.50)
      لو new_target > current_target: current_target = new_target

  Rule 5: DIP+ANALYSIS-OK
    لو gain_pct < 0 and trend_intact and m5 > -2.0 and not notified_hold:
      notified_hold = True  # "ثبّت"
    لو gain_pct ≥ 3.0: notified_hold = False  # reset

  Rule 6: TREND-BREAK
    days_below_sma20_running ≥ 2 and gain_pct ≥ 5%
    → إغلاق كـ 'CLOSED' (trend_break)

  Rule 7: MOMENTUM-DEAD
    m5 < -5% and m20 < -3% and gain_pct ≥ 0
    → إغلاق كـ 'CLOSED' (momentum_dead)

  Rule 8: EXTREME-PROFIT
    gain_pct ≥ 100%
    → إغلاق كـ 'TARGET_HIT' عند entry × 2.0 (cap +100%)

  Rule 9: TIME
    j - entry_idx ≥ 90
    → إغلاق كـ 'EXPIRED'
```

### 9.2 Hard Loss Ceiling + Split Guard

```python
# في _mark_closed():
# 1. Split Guard: لو actual_return < -35% → تجزئة سهم
if actual_return < -35:
    _split_excluded = True
    actual_return = 0
    exit_type = 'split_excluded'
    data_quality = 'split_excluded'

# 2. Hard Loss Ceiling: لو actual_return < -7% → cap
elif actual_return < -7:
    _capped_loss = True
    actual_return = -7.0
```

---

## 10. الأوزان والعتبات

### V40.2 Weights

| المحرك | الوزن | env var |
|--------|-------|---------|
| V38BacktestEngine | 0.40 | `V402_V38_WEIGHT` |
| CoreScoringEngine | 0.35 | `V402_CORE_WEIGHT` |
| Smart Money Concepts | 0.15 | `V402_SMC_WEIGHT` |
| Volume Profile | 0.10 | `V402_VP_WEIGHT` |

### FlowSystemEngine Weights

| الطبقة | الوزن |
|--------|-------|
| Macro Flow | 0.25 |
| Sector Flow | 0.30 |
| Stock Flow | 0.25 |
| Cross Validation | 0.20 |
| + Fundamentals bonus | up to +10 |

### Position Sizing

| المسار | position size |
|--------|--------------|
| QUIET_ACCUMULATION | 1.5% |
| PRE_SURGE | 1.5% |
| EXPLOSIVE_SURGE | 2.0% |
| LIQUIDITY_BYPASS | 2.5% |
| FlowScore FIRE (≥75) | 2.0% |
| FlowScore SPARK (60-74) | 2.5% |
| FlowScore ASH/COLD | 0% |

### R:R Floor Gate

```python
if r_mult < 1.5:
    continue  # لا تدخل توقع لو R:R < 1.5
```

---

## 11. المؤشرات الفنية (Canonical)

| المؤشر | الملف | الصيغة |
|--------|------|--------|
| **RSI** | `analyzers/indicators/rsi.py` | Wilder's smoothing: `avg_gain = (avg_gain × (period-1) + gain) / period` |
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

### RSI Wilder's Formula (مفصّل)

```python
def calc_rsi(closes, period=14):
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    # Initial average = SMA of first `period` gains/losses
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # Wilder's smoothing
    for i in range(period, len(gains)):
        avg_gain = (avg_gain × (period - 1) + gains[i]) / period
        avg_loss = (avg_loss × (period - 1) + losses[i]) / period

    if avg_loss == 0: return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)
```

---

## 12. المسار الإنتاجي + قواعد المخاطر

### المسار الكامل

```
1. tradingview_scanner_live.py → أسعار + مؤشرات من TV → stocks.db
2. fetch_tv_indices.py → مؤشرات رسمية → market_indices
3. daily_predictor.py:
   a. get_tickers(market)
   b. pre_cache_price_history() — تحميل مجمّع (180× speedup)
   c. لكل ticker:
      - B1 Price Sanity Gate (USD contamination + impossible OHLC + stale)
      - Kill Filters:
        * Penny: price < 1.0
        * Dead volume: volume < 1000
        * Liquidity: turnover < dynamic_min_turnover(price)
        * Volume volatility: std/avg > 3.0
        * Data bars: < 20
        * Relative strength: (stock_roc - benchmark) < -2.0
      - V38BacktestEngine.analyze_single_day()
      - CoreScoringEngine (continuous 0-100)
      - SMC + Volume Profile
      - Weighted: V38(0.40) + Core(0.35) + SMC(0.15) + VP(0.10)
      - R:R floor gate (r_mult < 1.5 → skip)
      - Whale distribution guard (BUY → HOLD)
      - INSERT → predictions + stored_analyses
4. daily_closer.py → 9 exit rules → يقفل
5. Next.js API + UI → يعرض
```

### قواعد المخاطر

| القاعدة | القيمة | التفصيل |
|---------|--------|---------|
| Hard Loss Ceiling | 7.0% | ممنوع تسجيل خسارة < -7% |
| Split Drop Threshold | 35.0% | لو < -35% → `split_excluded` (actual_return=0) |
| Max Holding Days | 90 | بعد كده → EXPIRED |
| Position Cap | 2-3% | Rule 19 — حماية رأس المال |
| R:R Floor | 1.5 | ممنوع دخول لو R:R < 1.5 |
| ATR Stop Clamp | [5%, 9%] | stop distance بين 5% و 9% (EGX) |
| Target R/R | 1.8 | target = stop_dist × 1.8 |

### Persona Profit Lock

| Persona | profit_lock | default |
|---------|------------|---------|
| gambler | 4% | — |
| **balanced** | **7%** (أو 1.8R) | ✅ default |
| conservative | 12% | — |

> **UNIFIED-BALANCED-ONLY:** كل التوقعات بتستخدم balanced بس.

---

## المراجع

| الملف | الدور | السطور |
|------|------|--------|
| `vps-service/engines/backtest_engine.py` | V40.2 engine | 2,373 |
| `vps-service/core/orchestrator.py` | المنسّق | 127 |
| `vps-service/core/executor.py` | المنفّذ | 235 |
| `vps-service/analyzers/core_scoring_engine.py` | CoreScoringEngine | 2,500+ |
| `vps-service/analyzers/market_regime_engine.py` | MarketRegimeEngine | — |
| `vps-service/utils/shared_liquidity.py` | **نظام السيولة + الرادار** | **1,179** |
| `vps-service/engines/flow_system.py` | **FlowSystemEngine** | **1,335** |
| `vps-service/analyzers/liquidity_filter.py` | **Kill Filters + Dynamic Thresholds** | **1,111** |
| `vps-service/jobs/daily_closer.py` | الإغلاق اليومي | 3,789 |
| `vps-service/jobs/daily_predictor.py` | توليد التوقعات | 4,744 |
| `vps-service/jobs/predictor_modules/incremental.py` | Incremental engine | — |
| `vps-service/analyzers/engine_settings.py` | الإعدادات | — |
| `vps-service/analyzers/indicators/` | المؤشرات Canonical | — |
