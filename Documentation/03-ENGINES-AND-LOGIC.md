# 03 — المحركات والمنطق الاستثماري

> **آخر تحديث:** 2026-10-29 | **Commit:** `22a1126`
> **هذا الملف هو المرجع الموحّد لكل المحركات والمنطق والمسارات والأوزان.**
> **مبني على فحص الكود الفعلي — مش افتراضات.**

---

## الفهرس

1. [فلسفة النظام](#1-فلسفة-النظام)
2. [المحرك المركزي: V40.2 (backtest_engine.py)](#2-المحرك-المركزي-v402)
3. [المنسّق (Orchestrator)](#3-المنسق-orchestrator)
4. [المنفّذ (Executor)](#4-المنفذ-executor)
5. [CoreScoringEngine — طبقة التحليل المستمر](#5-corescoringengine)
6. [محرك حالة السوق (MarketRegimeEngine)](#6-محرك-حالة-السوق-marketregimeengine)
7. [نظام السيولة والرادار (shared_liquidity.py)](#7-نظام-السيولة-والرادار-shared_liquidityEngine)
8. [محرك التدفق (FlowSystemEngine)](#8-محرك-التدفق-flowsystemengine)
9. [فلتر السيولة (liquidity_filter.py)](#9-فلتر-السيولة-liquidity_filterpy)
10. [محرك الإغلاق اليومي (daily_closer.py)](#10-محرك-الإغلاق-اليومي-daily_closerpy)
11. [مصفوفة الأوزان الديناميكية](#11-مصفوفة-الأوزان-الديناميكية)
12. [قواعد الخروج التفصيلية (9 قواعد)](#12-قواعد-الخروج-التفصيلية-9-قواعد)
13. [عتبات الإشارة + الفلاتر القاتلة](#13-عتبات-الإشارة--الفلاتر-القاتلة)
14. [المؤشرات الفنية (Canonical)](#14-المؤشرات-الفنية-canonical)
15. [المسار الإنتاجي الفعلي](#15-المسار-الإنتاجي-الفعلي)
16. [قواعد المخاطر المعتمدة](#16-قواعد-المخاطر-المعتمدة)
17. [الـ Incremental Engine](#17-الـ-incremental-engine)

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:

1. **Rule-Based** (110+ محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama — للـ sentiment فقط)

### القواعد الذهبية الثمانية (Hard Veto Layer)

| # | القاعدة | الوصف |
|---|---------|------|
| 1 | **Liquidity First** | تخطّى التحليل لو السهم غير قابل للتداول (dynamic thresholds) |
| 2 | **Market Regime Filter** | تعديل الثقة + الأحجام حسب حالة السوق |
| 3 | **Sector-Relative Fundamentals** | مقارنة داخل القطاع |
| 4 | **Session Dynamics** | ديناميكية الجلسة |
| 5 | **Unified Scoring** | Weighted combination (V38 + Core + SMC + VP) |
| 6 | **Strict Thresholds** | STRONG_BUY ≥ 75, BUY ≥ 65 |
| 7 | **Risk Profile** | Position + Stop + Target + Time لكل إشارة |
| 8 | **Feedback Loop** | التعلّم من الأخطاء (learned_lessons) |

---

## 2. المحرك المركزي: V40.2

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/engines/backtest_engine.py` (2,373 سطر) |
| **الـ class** | `V38BacktestEngine` (use_v393=True → V40.2) |
| **المدخلات** | `ticker, dates, opens, highs, lows, closes, volumes, day_idx, sector_change` |
| **المخرجات** | `{signal, score, entry_price, target_price, stop_loss, risk_reward, ...}` |

### عتبات الإشارة

```python
if maker.maker_bullish and flight_code == 'flight_up':
    signal = 'STRONG_BUY'   # was: INSTITUTIONAL_BUY (KILLED — WR=0%)
elif score >= self.buy_threshold:  # default 75
    signal = 'STRONG_BUY'
elif score <= int(get_setting('tech_score_base', default=50) - 20):  # ≤ 30
    signal = 'AVOID'
else:
    signal = 'WAIT'
```

### حساب الـ Risk Profile

```python
entry = closes[-1]
sl = entry - (atr × 1.5)                 # default stop
tp1 = entry + (risk × rr1)               # rr1 = 1.5
tp2 = entry + (risk × rr2)               # rr2 = 3.0
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

### ENGINE_SETS (حسب حالة السوق)

| حالة السوق | المحركات المختارة |
|------------|-------------------|
| **DEFENSIVE** | liquidity_filter, market_regime, technical, fundamental, risk |
| **NORMAL** | liquidity_filter, market_regime, technical, fundamental, confluence, risk |
| **AGGRESSIVE** | liquidity_filter, market_regime, technical, fundamental, confluence, breakout, momentum, risk |
| **UNKNOWN** | liquidity_filter, market_regime, technical, fundamental, risk |

> **تحذير:** الـ orchestrator/executor فيه محركات placeholder (fundamental, confluence, breakout, momentum). المسار الإنتاجي الفعلي يستخدم `V38BacktestEngine.analyze_single_day()` مباشرة.

---

## 4. المنفّذ (Executor)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/core/executor.py` (235 سطر) |
| **الدور** | ينفذ خطة المنسّق — يشغّل المحركات + يجمع النتائج |

### المحركات الحرجة (critical)

```python
critical_engines = {'liquidity_filter', 'technical', 'risk'}
# لو أي محرك حرج فشل → final_signal = 'NO_TRADE'
```

---

## 5. CoreScoringEngine

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/core_scoring_engine.py` |
| **الدور** | طبقة تحليل مستمر (0-100) — مكملة لـ V38 |
| **الوزن** | 0.35 (default `V402_CORE_WEIGHT`) |

### عائلات التحليل السبع

| العائلة | الدور |
|---------|------|
| **TREND** | اتجاه (SMA alignment + ADX) |
| **MOM** | زخم (RSI + MACD + rate of change) |
| **MR** | Mean Reversion (Bollinger + RSI extremes) |
| **BRK** | Breakout (Donchian + range compression) |
| **FLOW** | تدفق السيولة (volume_ratio + money_flow) |
| **FUND** | أساسيات (Piotroski + Altman + sector-relative) |
| **EVENT** | أحداث (earnings + dividends + news) |

### تكامل V40.2

```python
_V38_W  = 0.40   # V38BacktestEngine
_CORE_W = 0.35   # CoreScoringEngine
_SMC_W  = 0.15   # Smart Money Concepts
_VP_W   = 0.10   # Volume Profile
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

الـ engine بـ يطبّق **2-3 day hysteresis** — مش بيغيّر الـ regime فورًا.

---

## 7. نظام السيولة والرادار (shared_liquidity.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/utils/shared_liquidity.py` (1,179 سطر) |
| **الدور** | **الرادار الفعلي** — كشف نشاط غير طبيعي + تصنيف + درجة سيولة |
| **يُستخدم بواسطة** | `maker_radar.py` + `daily_predictor.py` + `liquidity_filter.py` |

> **مهم:** ده مش مجرد "بوابة رفض بدائية" — ده نظام رادار كامل بـ 4 مسارات كشف + 6 طبقات تحليل تدفق + 6 مراحل دورة حياة.

### 7.1 المسار أ: كشف التجميع الهادئ (Quiet Accumulation)

| | |
|---|---|
| **الدالة** | `detect_quiet_accumulation()` |
| **الـ lookback** | 18 يوم |
| **عدد الإشارات** | 6 (مطلوب 5/6) |
| **position size** | 1.5% |

**الإشارات الـ 6:**

1. **Volume high recurring** — حجم أعلى من المتوسط بشكل متكرر (≥3 من 10 أيام، volume > 1.1× avg_20d)
2. **Buy pressure** — close قريب من high (≥4 من 10 أيام، close ≥ 75% من range)
3. **Compressed** — range 10d < 14%
4. **Volume not low** — avg_10d ≥ 70% من avg_20d
5. **Not explosive** — ROC 10d < 12%
6. **No distribution** — ≤3 أيام distribution

**تكييف الـ Regime:**
- في DEFENSIVE: `vol_days_high_req=2` + `buy_pressure_req=2` (الميكر بـ يجمع على هبوط)

**فلاتر الرفض المسبقة:**
- Trend filter: ROC20 < -12% → هبوط قوي → مش تجميع
- Trend filter: ROC10 < -8% → هبوط حاد → مش تجميع
- Pump filter: move > +50% + volume < 30% avg → pump مشبوه
- Liquidity floor: turnover < 50K → سيولة ميتة
- Relative strength: ROC10 < -5% (أو -8% في DEFENSIVE) → ضعف نسبي

### 7.2 المسار ب: كشف ما قبل الانفجار (Pre-Surge)

| | |
|---|---|
| **الدالة** | `detect_pre_surge()` |
| **الـ lookback** | 18 يوم |
| **عدد الإشارات** | 4 (مطلوب 3/4) |
| **position size** | 1.5% (أعلى مخاطرة) |

**الإشارات الـ 4:**

1. **Volume gradient** — حجم بيزيد تدريج (gradient ≥ 15%)
2. **Range compressed** — range 10d < 10% (محبوس)
3. **Buy days** — 4 من 7 أيام شراء (2 في DEFENSIVE)
4. **Near MA10** — خلال 3% من MA10

### 7.3 المسار ج: الانفجار (Explosive Surge)

| | |
|---|---|
| **الدالة** | `is_explosive_surge()` |
| **position size** | 2% |

**الشروط (كلها مع بعض):**

1. **Volume surge** — max(last 3d) ≥ 1.7× base_20d (BRAVO-EXPLOSIVE-MULTIDAY)
2. **Price > SMA20** — السعر فوق متوسط 20 يوم
3. **Range compressed** — range 20 يوم (قبل الـ surge) < 18%

### 7.4 المسار د: الارتداد بعد الهبوط (Bounce After Decline)

| | |
|---|---|
| **الحالة** | detection only (NOT a buy recommendation) |
| **signal** | HOLD (مراقبة فقط) |
| **position** | 0 |

**الشروط:**

1. price_action = BOUNCE_AFTER_DECLINE
2. drop_from_peak بين -8% و -25%
3. volume support: avg(volumes[-3:]) ≥ 1.2× avg_20d
4. bounce magnitude: last_close ≥ recent_low × 1.03
5. no strong distribution: buy_pct > 35

### 7.5 تحليل التدفق المالي (Money Flow) — 6 طبقات

| | |
|---|---|
| **الدالة** | `compute_money_flow()` |
| **المخرجات** | `buy_pct` (0-100), `sell_pct`, `net_flow_egp`, `money_flow_state` |

**الطبقة 1: CLV (Close Location Value)** — لكل يوم في آخر 5 أيام (weighted)
```
CLV = ((close - low) - (high - close)) / (high - low)
```

**الطبقة 2: CMF (Chaikin Money Flow)** — على 20 يوم
```
CMF = Σ(CLV × volume) / Σ(volume)
```

**الطبقة 3: Volume confirmation**
- volume > 1.5× avg → تأكيد قوي (1.0)
- volume < 0.5× avg → مش مؤكد (0.0)

**الطبقة 4: Trend filter (trend penalty)**
- ROC20 < -15% → penalty = -25
- ROC20 < -10% → penalty = -18
- ROC20 < -5% → penalty = -10
- ROC20 > +10% → bonus = +5

**الطبقة 5: Dead volume filter**
- volume < 30% avg → cap buy_pct at 40%

**الطبقة 6: SMA alignment**
- close > SMA10 → 1.0 (صعود)
- close < SMA10 → 0.0 (هبوط)

**المعادلة النهائية:**
```python
# لو اليوم صاعد بحجم قوي:
raw_buy_pct = (today_clv_score × 0.60) + (body_score × 0.40)
# else (legacy):
raw_buy_pct = (clv_score × 0.35) + (cmf_score × 0.30) + (vol_score × 0.20) + (sma_score × 0.15)
```

**طبقات الحماية النهائية:**
- ROC20 < -15% → buy ≤ 35% (sell=65%)
- ROC20 < -10% → buy ≤ 45% (sell=55%)
- Dead volume → buy ≤ 40%
- Flat stock (range < 2%) → buy = 50% (متوازن)

### 7.6 دورة حياة السهم (Life Cycle)

| | |
|---|---|
| **الدالة** | `detect_life_cycle()` |
| **المخرجات** | 6 مراحل |

| المرحلة | الشرط |
|---------|------|
| 🟡 **نعاس** | ATR < 60% من avg + volume < 50% median |
| 🚀 **انفجار** | شمعة خضراء + body > 70% range + volume > 2× median |
| 🟢 **جني أرباح** | شمعة حمراء + range < 50% ATR + volume < 80% median |
| 🚨 **توزيع قاتل** | شمعة حمراء + range > 150% ATR + volume > 2× median |
| ⚠️ **تدوير وهمي** | volume > 2× median + range < 50% ATR |
| 🚫 **حبس (Limit Up)** | daily change > 9.5% + volume < median |
| عادي | حركة طبيعية |

### 7.7 Kill Switch

| | |
|---|---|
| **الدالة** | `check_kill_switch()` |
| **الـ triggers** | توزيع قاتل + حبس (Limit Up) + تدوير وهمي |

### 7.8 الـ Dynamic Thresholds (مش ثابتة!)

```python
DYNAMIC_TURNOVER_THRESHOLDS = {
    'low_price': 80_000,     # price < 5
    'mid_price': 200_000,    # 5 ≤ price ≤ 15
    'high_price': 400_000,   # price > 15
}
DEAD_MARKET_CEILING = 700_000   # لو السوق ميت
```

**استثناءات:**
- Volume spike > 2.5× → اقبل 300K (الزخم يبرر)
- السوق ميت (turnover < 70% avg) → ارفع لـ 700K

---

## 8. محرك التدفق (FlowSystemEngine)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/engines/flow_system.py` (1,335 سطر) |
| **الدور** | تحليل تدفق السيولة على 3 مستويات: macro + sector + stock |
| **المخرجات** | `FlowScore` (0-100) + label + action |

### الـ 4 طبقات

| الطبقة | الدالة | المدخلات |
|--------|--------|---------|
| **Macro Flow** | `calculate_macro_flow()` | EGX30 change |
| **Sector Flow** | `calculate_sector_flow()` | sector + stock_change |
| **Stock Flow** | `calculate_stock_flow()` | ticker (volume + price + RSI) |
| **Cross Validation** | `calculate_cross_validation()` | stock vs sector vs market |

### FlowScore

```python
@dataclass
class FlowScore:
    ticker: str
    flow_score: float        # 0-100
    label: str               # "نار" / "شرارة" / "رماد" / "بارد"
    label_en: str            # FIRE / SPARK / ASH / COLD
    macro_flow: float        # 0-100
    sector_flow: float       # 0-100
    stock_flow: float        # 0-100
    cross_validation: float  # 0-100
    volume_ratio: float      # volume / 20-day avg
    action: str              # "دخول قوي" / "دخول حذر" / "استنى" / "ماتدخلش"
    position_size: float     # % من رأس المال
    stop_loss: float         # %
    target: float            # %
```

### Labels

| Label | flow_score | المعنى |
|-------|------------|--------|
| 🔴 نار (FIRE) | ≥ 75 | تدفق قوي جدًا |
| 🟠 شرارة (SPARK) | 55-74 | تدفق إيجابي |
| ⚪ رماد (ASH) | 35-54 | متوازن |
| 🔵 بارد (COLD) | < 35 | تدفق ضعيف |

---

## 9. فلتر السيولة (liquidity_filter.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/liquidity_filter.py` (1,111 سطر) |
| **الدور** | بوابة الرفض الإجبارية (Kill Filters) — قبل أي تحليل |

### Kill Filters الخمسة

| # | الفلتر | الشرط | الإجراء |
|---|--------|------|---------|
| 1 | **السيولة** | turnover < dynamic_min_turnover(price) | EXCLUDED |
| 2 | **السعر** | price < 1.0 EGP | EXCLUDED |
| 3 | **تذبذب الحجم** | std/avg > 3.0 (تلاعب) | EXCLUDED |
| 4 | **البيانات** | bars < 20 | EXCLUDED |
| 5 | **القوة النسبية** | (stock_roc - benchmark) < -2.0 | EXCLUDED |

### Dynamic Min Turnover (مش ثابت!)

```python
# مبني على سعر السهم:
price < 5      → 80K EGP
5 ≤ price ≤ 15 → 200K EGP
price > 15     → 400K EGP

# استثناءات:
volume_spike > 2.5× → 300K (الزخم يبرر)
market_dead        → 700K (تجنب أسهم السوق الراكد)
```

### Liquidity Bypass

```python
# لو السهم فاشل في السيولة بس فيه volume_surge ≥ 1.5× + سعر فوق MA20
# → اقبل بـ position size أصغر (2.5% بدل 8%)
LIQUIDITY_BYPASS_POSITION_SIZE = 0.025
LIQUIDITY_BYPASS_THRESHOLD_REDUCTION = 0.5  # خفّض threshold لـ 50%
```

### Free Float Thresholds

```python
FREE_FLOAT_CRITICAL = 5.0     # % — خطير جداً (mult=0.2)
FREE_FLOAT_RISKY = 15.0       # % — مخاطرة عالية (mult=0.5)
```

---

## 10. محرك الإغلاق اليومي (daily_closer.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/daily_closer.py` (3,789 سطر) |
| **الدور** | يقفل التوقعات المعلّقة بناءً على تاريخ الأسعار |
| **الـ max holding** | 90 يوم |

### مسارات الإغلاق

| المسار | الدور |
|--------|------|
| `_close_with_dynamic_exit` | **المسار الرئيسي** — 9 قواعد خروج |
| `_close_explosive_trend_follow` | للأسهم الانفجارية |
| `_close_with_partial_trailing` | خروج جزئي + trailing |
| `_mark_expired` | انتهاء الصلاحية (90 يوم) |

---

## 11. مصفوفة الأوزان الديناميكية

### V40.2 Weights

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
| range | 1.5 |
| weak_bear | 1.0 |
| strong_bear | 0.0 (NO TRADING) |

---

## 12. قواعد الخروج التفصيلية (9 قواعد)

| القاعدة | الشرط | الإجراء |
|---------|------|---------|
| **1. HARD/DYNAMIC STOP** | `low ≤ current_stop` | إغلاق عند current_stop |
| **1.5. PROFIT_LOCK** | `gain ≥ 7%` (balanced) | إغلاق كـ trailing_profit |
| **1.7. T1/T2 MULTI-TARGET** | `high ≥ target_price` + T2 + زخم | رفع target لـ T2 |
| **1.8. T2_HIT** | `high ≥ target_price_2` | إغلاق كـ TARGET_HIT |
| **2. BREAKEVEN** | `peak_gain ≥ 10%` | حط stop عند entry |
| **3. TRAILING LOCK** | `peak_gain ≥ 40%` | trail عند highest × 0.70 |
| **4. TARGET+MOMENTUM** | `high ≥ target` + زخم قوي | HOLD + ارفع target |
| **5. DIP+ANALYSIS-OK** | `gain < 0` + trend intact | HOLD |
| **6. TREND-BREAK** | `days_below_sma20 ≥ 2` + `gain ≥ 5%` | EXIT |
| **7. MOMENTUM-DEAD** | `m5 < -5%` + `m20 < -3%` | EXIT |
| **8. EXTREME-PROFIT** | `gain ≥ 100%` | EXIT عند entry × 2.0 |
| **9. TIME** | `j - entry_idx ≥ 90` | EXPIRED |

---

## 13. عتبات الإشارة + الفلاتر القاتلة

### V40.2 Thresholds

| الإشارة | الشرط |
|---------|------|
| `STRONG_BUY` | `score ≥ 75` |
| `STRONG_BUY` | `maker_bullish AND flight_up` |
| `AVOID` | `score ≤ 30` |
| `WAIT` | غير ذلك |

### Kill Filters

| الفلتر | الشرط | الإجراء |
|--------|------|---------|
| Penny Stock | `price < 1.0` | skip |
| Dead Volume | `volume < 1000` | skip |
| Toxic Blocklist | ticker في blocklist | skip |
| B1 Price Sanity | USD contamination / impossible OHLC | skip |
| Whale Distributing | whale guard | `BUY → HOLD` |
| Liquidity | turnover < dynamic threshold | skip |
| Volume Volatility | std/avg > 3.0 | skip |
| Relative Strength | (stock_roc - benchmark) < -2.0 | skip |
| Data Bars | bars < 20 | skip |

### R:R Floor Gate

```python
if r_mult < 1.5:
    continue  # لا تدخل توقع لو R:R < 1.5
```

---

## 14. المؤشرات الفنية (Canonical)

| المؤشر | الملف | الصيغة |
|--------|------|--------|
| **RSI** | `analyzers/indicators/rsi.py` | Wilder's smoothing |
| **MACD** | `analyzers/indicators/ma.py` | EMA-12/26 + signal EMA-9 |
| **SMA** | `analyzers/indicators/ma.py` | Simple Moving Average |
| **ATR** | `analyzers/indicators/atr.py` | Wilder's (14 period) |
| **Bollinger** | `analyzers/indicators/bollinger.py` | SMA20 ± 2σ |
| **Stochastic RSI** | `analyzers/indicators/srsi.py` | — |
| **MFI** | `analyzers/indicators/mfi.py` | Money Flow Index |
| **VWAP** | `analyzers/indicators/vwap.py` | Volume Weighted Average Price |
| **ADX** | `analyzers/indicators/adx.py` | Trend strength |
| **Volume Profile** | `analyzers/indicators/volume_profile.py` | POC/VAH/VAL |

> **Rule 67:** `analyzers/indicators/` هو المصدر الوحيد للمؤشرات.

---

## 15. المسار الإنتاجي الفعلي

```
1. tradingview_scanner_live.py → يسحب أسعار + مؤشرات من TV → stocks.db
2. fetch_tv_indices.py → يسحب قيم المؤشرات الرسمية → market_indices
3. daily_predictor.py:
   a. get_tickers(market)
   b. pre_cache_price_history()
   c. لكل ticker:
      - B1 Price Sanity Gate
      - Kill Filters (liquidity + price + volume + RS + data)
      - V38BacktestEngine.analyze_single_day()
      - CoreScoringEngine (layer إضافي)
      - SMC + Volume Profile
      - Weighted combination (V38 0.40 + Core 0.35 + SMC 0.15 + VP 0.10)
      - Kill filters (R:R floor, whale, toxic)
      - INSERT → predictions + stored_analyses
4. daily_closer.py → 9 exit rules → يقفل
5. Next.js API + UI → يعرض
```

---

## 16. قواعد المخاطر المعتمدة

### Hard Loss Ceiling

| القاعدة | القيمة |
|---------|--------|
| `hard_loss_ceiling_pct` | 7.0% — ممنوع تسجيل خسارة < -7% |
| `split_drop_threshold_pct` | 35.0% — لو < -35% → `split_excluded` |

### Position Sizing

| Persona | profit_lock | default |
|---------|------------|---------|
| gambler | 4% | — |
| **balanced** | **7%** (أو 1.8R) | ✅ default |
| conservative | 12% | — |

> **UNIFIED-BALANCED-ONLY:** كل التوقعات بتستخدم balanced بس.

---

## 17. الـ Incremental Engine

### محرك التوقعات التزايدي

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/predictor_modules/incremental.py` |
| **الجدول** | `prediction_scan_log` |
| **الـ fingerprint** | SHA1 of OHLCV from entry_idx to day_idx |
| **الـ engine_hash** | SHA1 of (engine_version + buy_threshold + market + regime + strict_kill) |

### محرك الإغلاق التزايدي

| الخاصية | القيمة |
|---|---|
| **الـ checkpoint version** | 2 |
| **الحالة المحفوظة** | 7 متغيرات: current_stop, current_target, highest, lowest, notified_breakeven, notified_hold, days_below_sma20_running |
| **الـ fingerprint** | SHA1 of OHLCV from entry_idx to last_j |
| **الـ save** | ذري (state + last_checked_date في transaction واحدة) |

---

## المراجع

| الملف | الدور | السطور |
|------|------|--------|
| `vps-service/engines/backtest_engine.py` | V40.2 engine | 2,373 |
| `vps-service/core/orchestrator.py` | المنسّق | 127 |
| `vps-service/core/executor.py` | المنفّذ | 235 |
| `vps-service/analyzers/core_scoring_engine.py` | CoreScoringEngine | 2,500+ |
| `vps-service/analyzers/market_regime_engine.py` | MarketRegimeEngine | — |
| **`vps-service/utils/shared_liquidity.py`** | **نظام السيولة + الرادار** | **1,179** |
| **`vps-service/engines/flow_system.py`** | **FlowSystemEngine** | **1,335** |
| **`vps-service/analyzers/liquidity_filter.py`** | **فلتر السيولة + Kill Filters** | **1,111** |
| `vps-service/jobs/daily_closer.py` | الإغلاق اليومي | 3,789 |
| `vps-service/jobs/daily_predictor.py` | توليد التوقعات | 4,744 |
| `vps-service/jobs/predictor_modules/incremental.py` | Incremental engine | — |
| `vps-service/analyzers/engine_settings.py` | الإعدادات | — |
| `vps-service/analyzers/indicators/` | المؤشرات Canonical | — |
