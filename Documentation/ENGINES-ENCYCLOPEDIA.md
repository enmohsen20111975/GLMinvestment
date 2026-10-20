# 📖 موسوعة المحركات — تفاصيل كل محرك + تفكيره + ملفاته + ارتباطاته

> **Task ID:** BRAVO-ENGINES-ENCYCLOPEDIA
> **Agent:** برافو (تنين الباك إند والكم المجنح)
> **التاريخ:** 2026-10-20
> **المنهج:** قراءة كل docstring + كل class/function + كل import + رسم خريطة الـ connections

---

## 📑 جدول المحتويات

1. [الخريطة الكاملة (Overview)](#1-الخريطة-الكاملة-overview)
2. [المحركات الرئيسية (engines/)](#2-المحركات-الرئيسية-engines)
3. [المحركات التحليلية (analyzers/)](#3-المحركات-التحليلية-analyzers)
4. [المحركات المساعدة (jobs/ + core/)](#4-المحركات-المساعدة-jobs--core)
5. [كيفية ارتباط المحركات ببعضها (Data Flow)](#5-كيفية-ارتباط-المحركات-ببعضها-data-flow)
6. [مصفوفة الـ Dependencies الكاملة](#6-مصفوفة-the-dependencies-الكاملة)

---

## 1) الخريطة الكاملة (Overview)

النظام بيتكون من **4 طبقات محركات** بتشتغل مع بعض في pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│  الطبقة 4: ORCHESTRATION (jobs/)                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │  daily_predictor    │  │  daily_closer       │                   │
│  │  (المُنسّق الرئيسي)  │  │  (إغلاق الصفقات)   │                   │
│  └──────────┬──────────┘  └─────────────────────┘                   │
└─────────────┼───────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  الطبقة 3: ANALYZERS (analyzers/) — THE BRAIN                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ master_analyzer │  │ core_scoring    │  │ sniper_engine   │     │
│  │  (الدماغ الأكبر) │  │  (التسجيل)      │  │  (القناص)       │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                     │               │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐     │
│  │ persona_screener│  │ enhanced_indicators │ │ flow_system   │     │
│  │ (7 شخصيات)      │  │ (مؤشرات محسّنة)     │ │ (تدفقات)      │     │
│  └─────────────────┘  └─────────────────────┘  └───────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  الطبقة 2: ENGINES (engines/) — DOMAIN LOGIC                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ backtest   │ │ market_    │ │ atr_risk   │ │ stage2     │        │
│  │ _engine    │ │ regime     │ │ _engine    │ │ _filter    │        │
│  │ (V38)      │ │ (Minervini)│ │ (Wilder)   │ │ (SEPA)     │        │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ vcp_       │ │ donchian_  │ │ take_      │ │ explosive  │        │
│  │ detector   │ │ breakout   │ │ profit_tiers│ │ _scanner  │        │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ flow_system│ │ persona_   │ │ paper_trade│ │ historical │        │
│  │ (تدفقات)   │ │ _engine    │ │ _tracker   │ │ _backfill  │        │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘        │
│  ┌────────────┐ ┌────────────┐                                     │
│  │ crypto_    │ │ stock_     │                                     │
│  │ engine     │ │ fundamentals│                                    │
│  └────────────┘ └────────────┘                                     │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  الطبقة 1: INFRASTRUCTURE (core/ + utils/ + data/)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│  │ db_manager │ │ engine_    │ │ indicators │ │ validation │        │
│  │            │ │ settings   │ │ (canonical)│ │            │        │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2) المحركات الرئيسية (engines/)

### 2.1 `backtest_engine.py` — V38 Institutional Decision Engine (المحرك الأكبر)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/backtest_engine.py` |
| **الحجم** | 2,375 LOC (أكبر محرك) |
| **الاستيرادات** | 4 direct callers (daily_predictor + admin_routes + v38_backtest_routes + scripts) |

**طريقة التفكير:**
محرك القرار المؤسسي V38 — محاكاة شاملة على كل أسهم البورصة المصرية. مبني على نفس منطق TradingView Pine Script V38. بيجمع 9 أنظمة فرعية:
1. محرك البيانات والزخم (ATR, RSI, Bollinger Bands, Squeeze/Expansion)
2. محرك الميكرز (تجميع/تصريف/سحب سيولة/لا عرض)
3. محرك البصمة المستقبلية (DNA Pattern Matching)
4. محرك الأساسيات (P/E, ROE)
5. محرك القطاع
6. نظام الإثباتات الخمسة (5 Proofs)
7. التعلم الديناميكي (Adaptive Threshold)
8. القيمة العادلة (VWAP)
9. محرك الأخطار والسحب (Order Blocks & Liquidity Sweeps)

**الملفات المرتبطة:**
- `analyzers/indicators/` (RSI, ATR, Bollinger, SMA, EMA — canonical)
- `utils/fair_value.py` (VWAP fair_value)
- `db/price_history.db` (البيانات التاريخية)
- `db/predictions.db` (تخزين التوقعات)

---

### 2.2 `flow_system.py` — نظام التدفقات (Flow Score)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/flow_system.py` |
| **الحجم** | 1,304 LOC |
| **الاستيرادات** | 8 direct callers (أكثر محرك مستخدم!) |

**طريقة التفكير:**
"النظام اللي بينيك السوق" — بيحلل 4 طبقات وبيدي Flow Score واحد:

- **Layer 1: MACRO FLOWS (25%)** — USD/EGP, CBE Interest Rate, Foreign Inflows, Oil, Global markets
- **Layer 2: SECTOR FLOWS (30%)** — Sector turnover, Sector vs EGX30, Sector leader momentum, Sector breadth
- **Layer 3: STOCK FLOWS (25%)** — Volume vs avg, Price vs sector, Block trades, RSI, Support/resistance
- **Layer 4: CROSS-VALIDATION (20%)** — Stock=Sector=Market direction, Volume confirms price

**Interpretation:**
- ≥ 80 → "نار" (دخول قوي)
- 60-79 → "شرارة" (دخول حذر)
- 40-59 → "رماد" (استنى)
- < 40 → "بارد" (ماتدخلش)

**Callers:** `daily_predictor`, `lightweight_server`, `chart_routes`, `admin_routes`, `sector_tracking_routes`, `liquidity_alerts`, `decision_engine`, `background_analyzer`

---

### 2.3 `market_regime.py` — كشف حالة السوق (Minervini)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/market_regime.py` |
| **الحجم** | 560 LOC |
| **الاستيرادات** | 3 callers |

**طريقة التفكير:**
بيستخدم بيانات EGX30/EGX100 index لتحديد مرحلة السوق (Minervini 1-4):
- **Stage 1:** تجميع (السعر حول SMA200، slope منخفض)
- **Stage 2:** سوق صاعد (السعر > SMA200، SMA50 > SMA200، slope موجب) ← **الشراء هنا فقط**
- **Stage 3:** توزيع (السعر > SMA200 بس بيضعف)
- **Stage 4:** سوق هابط (السعر < SMA200، slope سالب) ← **ممنوع المسه**

**Output:** `RegimeResult(stage, stage_name, price, sma50, sma200, slope_50, slope_200, adx, confidence, trading_allowed)`

**مصدر البيانات:** `price_history.db` (EGX30/EGX100 ticker, 2021-2026)

---

### 2.4 `atr_risk_engine.py` — إدارة المخاطر بالـ ATR (Wilder)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/atr_risk_engine.py` |
| **الحجم** | 264 LOC |
| **الاستيرادات** | 1 caller (glminvestment_engines.engines package) |

**طريقة التفكير:**
الوقف الثابت (-8%) غلط لأنه ضيق جداً للأسهم المتقلبة وواسع جداً للهادية. الحل:
```
stop_loss = entry - (multiplier × ATR)
```
- **scalper** → multiplier = 2.0 (وقف ضيق، صفقات سريعة)
- **investor** → multiplier = 3.0 (وقف واسع، يتحمل التذبذب)

**Position Sizing:**
```
position_size = (capital × risk_pct) / risk_per_share
```
- مخاطرة افتراضية: 2% للمستثمر، 1% للمضارب

**Exports:** `analyze()`, `ATRRiskConfig`, `compute_risk_plan()`, `RiskPlan`, `TakeProfitTier`

---

### 2.5 `stage2_filter.py` — فلتر المرحلة الثانية (Minervini SEPA)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/stage2_filter.py` |
| **الحجم** | 266 LOC |
| **الاستيرادات** | 0 direct (بيشتغل من glminvestment_engines package) |

**طريقة التفكير:**
Minervini بيقسّم دورة حياة السهم لـ 4 مراحل. **السر: 80% من الأسهم بتتحرك مع السوق**، وأكتر الخسائر بتيجي من شراء سهم في Stage 4 بدافع "رخص".

**قواعد Stage 2 الصارمة (كلها لازم تتحقق):**
1. السعر > متوسط 200 يوم
2. متوسط 200 يوم صاعد (slope موجب آخر 20 يوم)
3. متوسط 50 يوم > متوسط 200 يوم (Golden Cross)
4. السعر ضمن 25% من أعلى 52 أسبوع (نشتري القوة مش الضعف)
5. السعر مش مفرط في الصعود (≤ 70% فوق متوسط 200 — بتجنّب الفقاعات)

**النتيجة:** لو مش Stage 2 → AVOID | لو Stage 2 → BUY/STRONG_BUY حسب قوة الاتجاه

---

### 2.6 `vcp_detector.py` — اكتشاف نموذج تقلص التقلب (Minervini)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/vcp_detector.py` |
| **الحجم** | 337 LOC |
| **الاستيرادات** | 0 direct (من package) |

**طريقة التفكير:**
VCP (Volatility Contraction Pattern) هو السر الأكبر لمينيرفيني. قبل أي انفجار سعري كبير، بتحصل سلسلة من الانكماشات:
```
25% → 10% → 5% → 2-3%
```
كل انكماش أضيق من اللي قبله، والحجم بيجفّ في الآخر. معناه: البائعين خلصوا، التذبذب هيدّي، والسهم جاهز للانطلاق.

**خوارزمية الكشف:**
1. حدّد نافذة 4-6 شهور (90-150 شمعة يومية)
2. لقّي القمة المرجعية (pivot high)
3. قسّم التحركات لانكماشات متتالية (swing highs/lows)
4. شوف الأرقام بتقلّ (contraction ratios متناقصة)
5. الحجم بيجفّ في آخر انكماش
6. السعر الحالي قريب من القمة (within 10%)

---

### 2.7 `donchian_breakout.py` — اختراق قنوات دونشيان (Turtle Traders)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/donchian_breakout.py` |
| **الحجم** | 224 LOC |
| **الاستيرادات** | 0 direct (من package) |

**طريقة التفكير:**
Richard Donchian + Turtle Traders + Michael Covel "Trend Following". الفلسفة: "السعر هو الحقيقة الوحيدة." ببساطة: اتبع الاتجاه.

**القواعد الأصلية للـ Turtles:**
- دخول: اختراق أعلى 20 يوم (System 1) أو 55 يوم (System 2)
- خروج: كسر أدنى 10 يوم
- تأكيد: حجم فوق المتوسط

**ملاحظة:** دونشيان لحاله بيطلع إشارات كاذبة كتير. القوة بتظهر لما يتلاقى مع Stage 2 + VCP (في الـ Confluence Engine).

---

### 2.8 `take_profit_tiers.py` — جني الأرباح التدريجي (Mark Douglas)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/take_profit_tiers.py` |
| **الحجم** | 265 LOC |
| **الاستيرادات** | 0 direct (من package) |

**طريقة التفكير:**
Mark Douglas — "Trading in the Zone". "التداول لعبة احتمالات." تنفيذ الآلة بلا مشاعر. لما السعر يتحرك لصالحك:
1. بِع ثلث المركز بمجرد ما توصل 1R (مخاطرة واحدة) ← "free trade"
2. حرّك الوقف لـ breakeven ← مفيش خسارة ممكنة بعد كده
3. بِع ثلث ثاني عند 2R ← تأمين الربح
4. الباقي (ثلث) سيبه يركض بـ trailing stop ← للهدف الكبير

**السيكولوجيا:** لما تاخد جزء من الربح، عقلك يهدا، وتبقى قادر تسيب الباقي يتحرك بدون توتر.

**Exports:** `evaluate_position()`, `TakeProfitConfig`, `ManagementDecision`, `PositionAction`, `position_from_risk_plan()`

---

### 2.9 `explosive_scanner.py` — ماسح القنابل (Volume + Price)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/explosive_scanner.py` |
| **الحجم** | 688 LOC |
| **الاستيرادات** | 2 callers |

**طريقة التفكير:**
"الصايع الحقيقي" — bulletproof ضد أي بيانات + منطق الشارع الحقيقي:

1. لو الحجم عالي والسعر ثابت = **"تجميع خفي"** (الكنز)
2. لو الحجم عالي والسعر طالع = **"انفجار"** (شراء)
3. لو الحجم عالي والسعر نازل = **"تصريف"** (بيع - فخ!)
4. لو الحجم عالي عند الدعم = **"شراء ذكي"**
5. لو الحجم عالي عند المقاومة = **"فخ"** (بيع للعربان)

**المعادلة:**
```
EXPLOSIVE_SCORE = Volume_Surge(25%) + Price_Position(30%) + Sector_Heat(20%) + Smart_Money(15%) + Market(10%)
```

---

### 2.10 `historical_backfill_engine.py` — محرك التعلم من الماضي

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/historical_backfill_engine.py` |
| **الحجم** | 1,214 LOC |
| **الاستيرادات** | 2 callers |

**طريقة التفكير:**
تعليم النظام من البيانات التاريخية (6 شهور فاتوا).

**المراحل:**
1. قراءة stock_price_history (آخر 180 يوم)
2. لكل سهم + كل يوم:
   - حساب المؤشرات الفنية (RSI, MACD, MA, Volume, Bollinger)
   - تحديد الإشارة اللي النظام كان هيديها
   - مراقبة اللي حصل بعد 1/5/20 يوم
3. تخزين في `prediction_logs` + `outcome_logs`
4. استخراج الدروس وتخزينها في `learned_lessons`
5. حساب Win Rate لكل مؤشر في كل قطاع → `regime_indicator_weights`

**الجداول:** `stock_price_history` (108K+ سجل) + `prediction_logs` + `outcome_logs` + `learned_lessons` + `regime_indicator_weights`

---

### 2.11 `paper_trade_tracker.py` — متتبع الصفقات الافتراضية

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/paper_trade_tracker.py` |
| **الحجم** | 1,170 LOC |
| **الاستيرادات** | 1 caller |

**طريقة التفكير:**
بيدمج نوعين من التعلم:

- **التعلم التاريخي (Historical):** بيطبق الاستراتيجيات على بيانات الماضي (6 شهور فاتوا)، يحسب كيف كان النظام سيتصرف، يستخرج دروس. شغّال مرة واحدة أو عند طلب التحديث.

- **التعلم التكراري (Iterative):** بيضع توقعات اليوم للأسابيع القادمة، يتتبع النتائج الفعلية مع مرور الوقت، يعدل الأوزان بناءً على الأداء الفعلي. شغّال بشكل مستمر (يومي/أسبوعي).

**الـ tracker:** بيسمح بتتبع صفقات افتراضية من أي تاريخ، يقيس النتائج بعد 1/5/10/20 يوم، يغذي النتائج في نظام التعلم.

---

### 2.12 `persona_engine.py` — محرك الشخصيات المستثمرة (7 شخصيات)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/persona_engine.py` |
| **الحجم** | 986 LOC |
| **الاستيرادات** | 2 callers |

**طريقة التفكير:**
7 شخصيات مختلفة بناءً على `ANALYSIS_STRATEGY_BIBLE_v1.0.md`:

| Persona | الوصف |
|---------|-------|
| `CONSERVATIVE` | المحافظ |
| `CAUTIOUS` | المتوسط الحذر |
| `BALANCED` | المتوازن |
| `ACTIVE_TRADER` | المضارب المنتظم |
| `ADVENTURER` | المغامر |
| `GAMBLER` | المقامر المحسن |
| `HEDGER` | المتحوط المؤسسي |

**RiskParameters لكل persona:**
- `max_position_pct` — أقصى نسبة للصفقة الواحدة
- `default_stop_loss_pct` — Stop Loss الافتراضي
- `default_target_pct` — Target الافتراضي
- `time_stop_days` — Time Stop بالأيام
- `leverage_allowed` — الرافعة المسموحة
- `daily_loss_limit_pct` — حد الخسارة اليومي
- `egx_allocation` / `crypto_allocation` / `gold_allocation` — توزيع المحفظة

---

### 2.13 `stock_fundamentals.py` — محرك البيانات الأساسية

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/stock_fundamentals.py` |
| **الحجم** | 648 LOC |
| **الاستيرادات** | 1 caller |

**طريقة التفكير:**
بيجمع البيانات من `data_engine.db` (9 جداول) + `stocks.db` وبيدي صورة كاملة لكل سهم: مالية + تقييم + ربحية + تقني + أرباح.

**data_engine.db tables (866 سهم لكل جدول):**
- `tab_balance_sheet` — ميزانية عمومية
- `tab_income_statement` — قائمة الدخل
- `tab_cash_flow` — التدفقات النقدية
- `tab_valuation` — التقييم (P/E, PEG, P/S)
- `tab_profitability` — الربحية (margins, ROE)
- `tab_performance` — الأداء (1W, 1M, 3M)
- `tab_dividends` — الأرباح (DPS, yield)
- `tab_technical_analysis` — التحليل الفني (rating, trend)
- `historical_data` (99K سجل) — بيانات تاريخية

---

### 2.14 `crypto_engine.py` — محرك العملات الرقمية (مخفف)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/engines/crypto_engine.py` |
| **الحجم** | 395 LOC |
| **الاستيرادات** | 1 caller |

**طريقة التفكير:**
محرك مخفف للعملات الرقمية — ما بيفتحش connections كتيرة. بيقرأ من `data_engine.db` وبيحلل crypto prices + volumes.

**Exports:** `CryptoFlowScore` dataclass + analysis functions.

---

## 3) المحركات التحليلية (analyzers/)

### 3.1 `master_analyzer.py` — THE BRAIN (الدماغ الأكبر)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/analyzers/master_analyzer.py` |
| **الحجم** | 5,764 LOC (أكبر ملف في المشروع!) |
| **الاستيرادات** | 25 callers |

**طريقة التفكير:**
"الدمج الموحد - THE BRAIN". المحرك الرئيسي اللي بيدمج كل الـ analyzers بـ weights مناسبة + بيطبق الـ Golden Rules لقرارات الاستثمار في EGX.

**Golden Rules:**
1. **Liquidity First** — Skip analysis if not tradeable
2. **Market Regime Filter** — Adjust confidence based on market condition
3. **Sector-Relative Fundamentals** — Compare within sector
4. **Session Dynamics** — Not "best hours"
5. **Unified Scoring** — Weighted combination
6. **Strict Thresholds** — STRONG_BUY ≥ 55, BUY ≥ 50 (optimized via real backtesting: 61.5%+ / 68.4% win rates)
7. **Risk Profile** — Position, Stop, Target, Time for each signal
8. **Feedback Loop** — Learn from mistakes

**Key function:** `load_merged_history(ticker, db_path, limit)` — المصدر الوحيد لبيانات الأسعار (Rule 12)

---

### 3.2 `core_scoring_engine.py` — محرك التسجيل الموحد (القلب النابض)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/analyzers/core_scoring_engine.py` |
| **الحجم** | 2,573 LOC |
| **الاستيرادات** | 8 callers |

**طريقة التفكير:**
"هذا هو القلب النابض للنظام الجديد." بيسقبل بيانات السهم + MarketProfile + PersonaProfile وبيدي نتيجة موحدة `UnifiedSignalResult`.

**الميزات:**
1. نظام أوزان مرن حسب السوق
2. إصلاحات Kimi مدمجة (RSI Override + R/R Validation)
3. ATR Stop Loss ديناميكي
4. يدعم كل الأسواق بنفس المحرك

**Classes:** `TechnicalScorer`, `VolumeScorer`, `CandlestickScorer`, `FundamentalScorer`, `RiskCalculator`

---

### 3.3 `sniper_engine.py` — محرك القناص ("قناص مش رشاش")

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/analyzers/sniper_engine.py` |
| **الحجم** | 2,019 LOC |
| **الاستيرادات** | متعددة |

**طريقة التفكير:**
"قناص مش رشاش" — تصويب دقيق على الأسهم اللي فعلاً تستاهل.

**المكونات:**
- مؤشرات فنية صحيحة (RSI Wilder, MACD EMA-9, ATR, Bollinger, SMA, VWAP)
- نقاط الدعم/المقاومة الحقيقية (من Swing Pivots)
- تحليل السيولة وجودة الحجم
- درجة أساسية (P/E, ROE, Piotroski)
- حالة السوق (Market Regime)
- أنماط الشموع اليابانية
- 5 بوابات جودة (Gates) — لازم تعدي كلهم أو معظمهم

**المعادلة:**
```
sniper_score = (
    technical_score * 0.25 +
    sr_position_score * 0.25 +
    volume_quality_score * 0.15 +
    fundamental_score * 0.20 +
    market_regime_score * 0.10 +
    candlestick_score * 0.05
) * liquidity_multiplier
```

---

### 3.4 `persona_screener.py` — مففص الشخصيات (parent)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/analyzers/persona_screener.py` |
| **الحجم** | 1,940 LOC |
| **الاستيرادات** | 1 caller (api/persona_routes) |

**طريقة التفكير:**
**Parent module** بيـ orchestrate الـ persona sub-modules:
- `persona_investor.py` (1,152 LOC) — تحليل المستثمر
- `persona_gambler.py` (837 LOC) — تحليل المقامر

بيستوردهم وبيـ integrate نتائجهم بـ conditions (Score ≥ threshold).

---

## 4) المحركات المساعدة (jobs/ + core/)

### 4.1 `jobs/daily_predictor.py` — المُنسّق الرئيسي (V40.2)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/jobs/daily_predictor.py` |
| **الحجم** | 2,919 LOC |
| **الـ role** | Orchestrator |

**طريقة التفكير:**
V40.2 Historical/Daily Prediction Generator. بيـ orchestrate كل المحركات عشان يولّد توقعات يومية.

**الـ modes:**
- `--today-only` (للكرون اليومي)
- `--yesterday-only` (بعد إغلاق السوق)
- `--start X --end Y` (فترة مخصصة)
- `--dry-run` (جاف، ما يكتبش في DB)

**V40.2 changes vs V40.1:**
- Strict kill-filter mode (no market-open relaxation)
- Real EGX30ETF benchmark (loaded lazily)
- Tightened entry conditions (real benchmark + mapping fix + absorption 1.5)
- `partial_exit_at_rr = 1.5` (let winners run further)

**الكرون المقترح:**
```bash
30 14 * * 0-4 python3 vps-service/jobs/daily_predictor.py --yesterday-only >> logs/v40_2_daily.log 2>&1
```

---

### 4.2 `jobs/daily_closer.py` — مُغلق الصفقات

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/jobs/daily_closer.py` |
| **الحجم** | 3,453 LOC |
| **الـ role** | Exit management |

**طريقة التفكير:**
بيقفل الصفقات المفتوحة بناءً على EXIT_POLICY_MODE = `partial_1r_trailing` (Rule 10):
- 50% عند 1R (=`partial_exit_at_rr=1.5`) + breakeven + trail الباقي
- Trailing stop = FLOOR not CAP (Rule 9) — بـ ratchet up مع highest وما بـ ينزلش تحت entry

---

### 4.3 `analyzers/engine_settings.py` — مصدر الحقيقة للعتبات (Rule 11)

| الخاصية | القيمة |
|---------|--------|
| **المسار** | `vps-service/analyzers/engine_settings.py` |
| **الحجم** | ~1,482 LOC |
| **الـ role** | Single source of truth للإعدادات |

**طريقة التفكير:**
~100 مفتاح إعدادات. **ممنوع** كتابة `tech_score = 50` hardcoded في كود جديد — استخدم `get_setting('tech_score_base', 50)`.

**Examples:**
- `atr_stop_min_pct = 5.0`, `atr_stop_max_pct = 9.0` (Rule 8)
- `trailing_stop_activation_gain = 2.0` (Rule 9)
- `partial_exit_at_rr = 1.5` (Rule 10)

---

## 5) كيفية ارتباط المحركات ببعضها (Data Flow)

### 5.1 الـ Pipeline الرئيسي (V40.2 Daily Prediction)

```
الـ cron بيـ شغل daily_predictor.py --yesterday-only
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ daily_predictor (orchestrator)                           │
│   ├─ يقرأ قائمة الأسهم من stocks.db                     │
│   ├─ لكل سهم:                                            │
│   │   ├─ load_merged_history() [master_analyzer]        │
│   │   │   └─ price_history.db → price_history table     │
│   │   ├─ MarketRegime.determine() [engines/market_regime]│
│   │   │   └─ EGX30 index → Stage 1/2/3/4                │
│   │   ├─ FlowSystemEngine.score() [engines/flow_system]  │
│   │   │   └─ 4 layers → Flow Score 0-100                │
│   │   ├─ MasterAnalyzer.analyze() [analyzers/master]    │
│   │   │   ├─ LiquidityFilter.filter()                   │
│   │   │   ├─ CoreScoringEngine.score() [analyzers/core] │
│   │   │   │   ├─ TechnicalScorer (RSI/MACD/Bollinger)   │
│   │   │   │   ├─ VolumeScorer                            │
│   │   │   │   ├─ CandlestickScorer                       │
│   │   │   │   └─ FundamentalScorer [engines/stock_fund] │
│   │   │   ├─ SniperEngine.evaluate() [analyzers/sniper] │
│   │   │   │   └─ 5 Gates (quality checks)               │
│   │   │   ├─ PersonaEngine.adjust() [engines/persona]   │
│   │   │   │   └─ 7 personas (risk params)               │
│   │   │   └─ AdaptiveWeights [analyzers/adaptive]       │
│   │   ├─ ATRRiskEngine.compute_risk_plan() [engines/atr]│
│   │   │   ├─ stop_loss = entry - (mult × ATR)           │
│   │   │   └─ TakeProfitTier[] (1R, 2R, trail)           │
│   │   ├─ Stage2Filter.check() [engines/stage2_filter]   │
│   │   │   └─ AVOID لو مش Stage 2                        │
│   │   ├─ VCPDetector.detect() [engines/vcp_detector]    │
│   │   │   └─ VCP pattern (contraction ratios)           │
│   │   ├─ DonchianBreakout.detect() [engines/donchian]   │
│   │   │   └─ 20-day breakout                            │
│   │   ├─ ExplosiveScanner.scan() [engines/explosive]    │
│   │   │   └─ Volume + Price + Smart Money               │
│   │   └─ يخزن التوقع في predictions.db                  │
│   └─ يطلع report                                        │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ daily_closer (exit management)                           │
│   ├─ يقرأ predictions المفتوحة                           │
│   ├─ لكل prediction:                                     │
│   │   ├─ TakeProfitTiers.evaluate() [engines/take_profit]│
│   │   │   └─ HOLD / SELL_TIER / TRAIL / EXIT             │
│   │   ├─ EXIT_POLICY_MODE = partial_1r_trailing (Rule 10)│
│   │   │   ├─ 50% عند 1R + breakeven                     │
│   │   │   └─ trail الباقي                                │
│   │   └─ Trailing stop = FLOOR (Rule 9)                  │
│   └─ يحدّث outcome_logs                                  │
└──────────────────────────────────────────────────────────┘
```

### 5.2 الـ Confluence Engine (دمج المحركات المؤسسية)

المحركات الـ 5 المؤسسية (atr_risk + stage2 + vcp + donchian + take_profit) بتشتغل مع بعض في **Confluence** pattern:

```
Stage2Filter.check(stock)
       │
       ├─ AVOID → ارفض الإشارة (مش Stage 2)
       │
       └─ Stage 2 ✓
            │
            ▼
       VCPDetector.detect(stock)
            │
            ├─ VCP قوي → BOOST (+10/+20 للـ score)
            │
            └─ VCP ضعيف → continue
                 │
                 ▼
            DonchianBreakout.detect(stock)
                 │
                 ├─ breakout ↑ → BUY signal
                 │
                 └─ no breakout → continue
                      │
                      ▼
                 ATRRiskEngine.compute_risk_plan()
                      │
                      ├─ stop_loss = entry - (mult × ATR)
                      ├─ target = entry + (2 × risk)
                      └─ TakeProfitTier[] (1R, 2R, trail)
                      │
                      ▼
                 TakeProfitTiers.evaluate() (وقت التشغيل)
                      │
                      ├─ price < 1R → HOLD
                      ├─ price = 1R → SELL_TIER 1 + breakeven
                      ├─ price = 2R → SELL_TIER 2
                      └─ price > 2R → TRAIL (let it run)
```

### 5.3 الـ Learning Loop (الحلقة التعليمية)

```
historical_backfill_engine (ماضي)
       │
       ▼
  prediction_logs + outcome_logs
       │
       ▼
  learned_lessons (دروس)
       │
       ▼
  regime_indicator_weights (أوزان حسب القطاع)
       │
       ▼
  AdaptiveWeights (في master_analyzer)
       │
       ▼
  paper_trade_tracker (تتبع الصفقات الافتراضية)
       │
       ▼
 daily_closer (إغلاق + outcome)
       │
       ▼
  outcome_logs (نتائج فعلية)
       │
       ▼
  (ترجع لـ historical_backfill_engine للـ cycle الجاي)
```

---

## 6) مصفوفة الـ Dependencies الكاملة

### 6.1 مين بـ يستورد مين (Top callers)

| المحرك | Direct Callers | الـ callers الرئيسيين |
|--------|---------------:|----------------------|
| `flow_system` | 8 | daily_predictor, lightweight_server, chart_routes, admin_routes, sector_tracking, liquidity_alerts, decision_engine, background_analyzer |
| `backtest_engine` | 4 | daily_predictor, admin_routes, v38_backtest_routes, scripts |
| `market_regime` | 3 | daily_predictor, lightweight_server, admin_routes |
| `persona_engine` | 2 | daily_predictor, master_analyzer |
| `historical_backfill` | 2 | scripts, admin_routes |
| `explosive_scanner` | 2 | lightweight_server, chart_routes |
| `stock_fundamentals` | 1 | lightweight_server |
| `paper_trade_tracker` | 1 | admin_routes |
| `crypto_engine` | 1 | lightweight_server |
| `atr_risk` | 1 | glminvestment_engines package |
| `vcp_detector` | 0* | من package |
| `take_profit_tiers` | 0* | من package |
| `stage2_filter` | 0* | من package |
| `donchian_breakout` | 0* | من package |

*المحركات الـ 4 الأخيرين بيشتغلوا من `glminvestment_engines.engines` package shim (بيـ re-export من `engines/`).

### 6.2 المحركات التحليلية (الأكثر استيراداً)

| المحرك | LOC | Callers |
|--------|----:|--------:|
| `master_analyzer` (THE BRAIN) | 5,764 | 25 |
| `core_scoring_engine` | 2,573 | 8 |
| `engine_settings` (Rule 11) | ~1,482 | 25 |
| `sniper_engine` | 2,019 | متعددة |
| `enhanced_indicators` | 515 | متعددة |
| `indicators/` (canonical, Rule 67) | 1,100+ | 30+ |

### 6.3 الـ Infrastructure Layer

| المكتب | الوصف |
|--------|-------|
| `core/db_manager.py` | connection pooling + context manager |
| `core/database.py` | general DB infrastructure (1,223 LOC) |
| `utils/db_paths.py` | single source of truth لمسارات DBs (Rule 12) |
| `utils/risk_reward.py` | canonical R:R (Rule 67) |
| `utils/fair_value.py` | canonical fair_value (Rule 67) |
| `utils/position_sizing.py` | canonical position sizing (Rule 67) |
| `utils/backtest_stats.py` | canonical WR/PF (Rule 67) |
| `data/validation.py` | طبقة التحقق من البيانات (Rule 65) |
| `data/source_authority.py` | سلطة المصادر (Rule 66) |
| `analyzers/indicators/` | canonical technical indicators (Rule 67) |

---

## 📂 المرجعية

- **الدستور:** `Documentation/00-CONSTITUTION.md` (76 قاعدة)
- **التشريح:** `Documentation/01-PROJECT_ANATOMY.md`
- **الشاشات:** `Documentation/02-SCREENS_AND_COMPONENTS.md`
- **المنطق:** `Documentation/SYSTEM_HOW_IT_THINKS.md`
- **خريطة المحركات (السابقة):** `Documentation/ENGINES-AND-TOOLS-MAP.md`

---

**هذه الموسوعة هي المرجع الموحّد لكل محرك في المشروع — تفكيره + ملفاته + ارتباطاته.**
