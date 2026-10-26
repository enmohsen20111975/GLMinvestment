# PROJECT_ARCHITECTURE_AUDIT
> **Phase 1:** فهم المشروع ككل + خريطة تنفيذ فعلية
> **Commit:** `6330ab0` | **Date:** 2026-10-26

---

## 1. البنية الحقيقية قبل التعديل

### 1.1 مسار الإنتاج الفعلى (من الكود)

يوجد **مساران منفصلان** لإنتاج القرار، كل منهما يستخدم محركات مختلفة:

#### المسار A: التحليل الفورى (API)
```
طلب API → scanner_routes.py:182 → MasterAnalyzer.analyze(ticker)
  ↓
  master_analyzer.py (5,794 LOC — المحرك المركزى القديم)
    - يجمع 8 محركات فرعية (technical, fundamental, confluence, etc.)
    - يطبّق Golden Rules الـ8
    - ينتج MasterAnalysis(signal, score, risk_profile)
  ↓
  scanner_routes.py:271 → API response {"recommendation": signal}
```

#### المسار B: التنبؤ اليومى (Cron)
```
Cron 03:00 → daily_predictor.py (V40.2 generator)
  ↓
  flow_system.py (FlowSystemEngine — محرك مختلف تمامًا)
    - 4 طبقات: Inflow + Accumulation + Validation + Cross-validation
    - ينتج FlowScore (0-100)
    - evaluate_risk() — دالة مخاطر منفصلة
  ↓
  predictions.db → prediction_tracker → outcomes
```

### 1.2 الفجوة الجوهرية المكتشفة

| العنصر | المسار A (API) | المسار B (Cron) |
|---|---|---|
| المحرك | master_analyzer.py | flow_system.py |
| نوع القرار | `signal` (STRONG_BUY/BUY/HOLD/SELL) | `flow_score` (0-100) |
| نقطة الدخول | scanner_routes.py | daily_predictor.py |
| إدارة المخاطر | inline (غير موحدة) | evaluate_risk() |
| Decision Log | ❌ غير متصل | ⚠️ decision_logger.py (جزئي) |
| Risk Gate | ❌ غير متصل | ❌ غير متصل |
| الهدف | تحليل فورى لسهم | تنبؤات يومية |

**هذا يعنى أن النظام يحتوى على محركين منفصلين ينتجان قرارات مختلفة دون منسّق موحد.**

---

## 2. دور master_analyzer الفعلى

`master_analyzer.py` هو:
- ✅ **محرك تحليل مركزى** — يجمع 8 محركات فرعية
- ✅ **مصدر القرار للمسار A** (API)
- ❌ **ليس المنسّق الجديد** — لا يخطط مسار التحليل ديناميكيًا
- ❌ **ليس المنفّذ الجديد** — لا يستقبل خطة من منسّق
- ❌ **ليس متصلًا بـ Risk Gate** — لا يستدعى apply_risk_gate()
- ❌ **ليس متصلًا بـ Decision Log** — لا يستدعى log_decision()

`master_analyzer` محرك قديم صالح للاستخدام كمكوّن متخصص، لكنه **لا يحقق مسؤوليات المنسّق أو المنفّذ**.

---

## 3. المحركات القديمة — تقييم

| المحرك | الدور | صالح؟ | توصية |
|---|---|---|---|
| master_analyzer.py | تحليل شامل (8 محركات) | ✅ كمحرك متخصص | استخدام من المنفّذ |
| flow_system.py | Flow Score (4 طبقات) | ✅ كمحرك متخصص | استخدام من المنفّذ |
| technical.py | RSI/MACD/ADX | ✅ | استخدام من المنفّذ |
| fundamental.py | Piotroski/Altman | ✅ | استخدام من المنفّذ |
| confluence_engine_v3.py | 8-layer scoring | ✅ | استخدام من المنفّذ |
| conviction_engine.py | confidence level | ✅ | استخدام من المنفّذ |
| liquidity_filter.py | tradeable filter | ✅ | استخدام من المنسّق (gate) |
| market_regime_engine.py | regime detection | ✅ | استخدام من المنسّق |
| position_sizing.py | size calculation | ✅ | استخدام من المنفّذ |
| risk_adaptive.py | adaptive risk | ✅ | استخدام من Risk Gate |
| ticker_cooldown.py | repeat prevention | ✅ | استخدام من Risk Gate |

---

## 4. قواعد المخاطر المعتمدة (من الكود)

| القاعدة | القيمة | المصدر |
|---|---|---|
| Hard Loss | 7% | position_sizing.py:18, prediction_tracker.py:154 |
| ATR clamp | 5-9% | v2_routes.py:2014, crypto_strict_filters.py:8 |
| Split Guard | 35% | bag_holder_rescue.py:801 |
| Ticker Cooldown | (configurable) | ticker_cooldown.py |
| R:R minimum | (implied from ATR clamp) | prediction_tracker.py |
| Position max | 25% of capital | risk_gate.py (NOT connected) |

---

## 5. المعمارية المستهدفة

```
Request (API or Cron)
    ↓
[Orchestrator] — يحدد ما يجب تحليله
    - يتحقق من السوق + البيانات
    - يحدد حالة السوق (regime)
    - يختار المحركات المناسبة
    - ينتج Plan
    ↓
[Executor] — ينفذ الخطة
    - يستدعى المحركات المختارة
    - يجمع النتائج
    - يتحقق من سلامتها
    ↓
[Risk Gate] — يطبق قواعد المخاطر
    - Hard Loss 7%
    - ATR clamp 5-9%
    - Split Guard 35%
    - Ticker Cooldown
    - R:R minimum
    - Position max 25%
    ↓
[Decision Log] — يسجل القرار
    - execution_id, plan, results, signal, risk_profile
    ↓
API Response / Prediction
```

### مكونات جديدة مطلوبة:

1. **Orchestrator** (`vps-service/core/orchestrator.py`) — جديد
2. **Executor** (`vps-service/core/executor.py`) — جديد
3. **Risk Gate** (`vps-service/core/risk_gate.py`) — موجود، يحتاج إصلاح + توصيل
4. **Decision Log** (`vps-service/core/decision_log.py`) — موجود، يحتاج توصيل

### مكونات قديمة تُستخدم (عبر واجهات):
- master_analyzer — كمكوّن تحليل شامل
- flow_system — كمكوّن Flow Score
- liquidity_filter — كبوابة سيولة
- market_regime_engine — لكشف حالة السوق
- position_sizing — لحساب حجم الصفقة
- ticker_cooldown — لمنع التكرار

---

## 6. نقاط التكامل المطلوبة

### 6.1 scanner_routes.py (المسار A)
```python
# الحالى:
analyzer = MasterAnalyzer(DATABASE_PATH)
analysis = analyzer.analyze(ticker)
return {"recommendation": analysis.signal}

# المطلوب:
plan = orchestrator.create_plan(ticker, market, data_quality)
result = executor.execute(plan)  # يستدعى master_analyzer داخليًا
final_signal, risk_profile = risk_gate.apply(result)
decision_log.log(execution_id, plan, result, final_signal, risk_profile)
return {"recommendation": final_signal, "risk_profile": risk_profile}
```

### 6.2 daily_predictor.py (المسار B)
```python
# الحالى:
flow_engine = FlowSystemEngine()
flow_score = flow_engine.calculate_flow_score(ticker)

# المطلوب:
plan = orchestrator.create_plan(ticker, market, data_quality, engine='flow_system')
result = executor.execute(plan)  # يستدعى flow_system داخليًا
final_signal, risk_profile = risk_gate.apply(result)
decision_log.log(...)
```

---

## 7. الفجوات المكتشفة

| # | الفجوة | الأثر | الحل |
|---|---|---|---|
| 1 | مساران منفصلان بلا منسّق | قرارات غير متسقة | تنفيذ Orchestrator |
| 2 | Risk Gate غير متصل | مخاطر غير مطبقة | توصيل apply_risk_gate بالمسارين |
| 3 | Decision Log غير متصل بالـ API | قرارات غير مسجلة | توصيل log_decision بالمسارين |
| 4 | Risk Gate لا يرجع position_size | حجم الصفقة لا يتأثر | إصلاح return signature |
| 5 | لا يوجد فصل بين التخطيط والتنفيذ | صعوبة الصيانة | تنفيذ Executor منفصل |
| 6 | US tickers = EGX collisions | بيانات US خاطئة | فصل namespace |
| 7 | CRYPTO = intraday schema | لا يصلح لـ daily backtest | schema منفصل أو تحويل |

---

## 8. خطة التنفيذ

### المرحلة 2: التصميم التنفيذى
- تحديد واجهات Orchestrator + Executor
- تحديد عقود البيانات
- تحديد موضع Risk Gate + Decision Log

### المرحلة 3: التنفيذ
- إنشاء orchestrator.py
- إنشاء executor.py
- إصلاح risk_gate.py (return position_size)
- توصيل الكل بـ scanner_routes + daily_predictor
- استخدام master_analyzer + flow_system كمكوّنات داخل Executor

### المرحلة 4: اختبارات تكامل
- 14 اختبار سلوكى إلزامى

### المرحلة 5: باك تست
- 4 أشهر على المسار الجديد
- تقارير أسبوعية لكل سوق
