# 03 — المحركات والمنطق الاستثماري والمعمارية الكاملة

> **آخر تحديث:** 2026-10-26 | **Commit:** `49493ab`
> **هذا الملف هو المرجع الموحّد لكل المحركات والمنطق والمسارات والأوزان.**

---

## الفهرس

1. [فلسفة النظام](#1-فلسفة-النظام)
2. [المحرك المركزي: master_analyzer.py](#2-المحرك-المركزي-master_analyzerpy)
3. [جرد المحركات الفعلي (116 محرك)](#3-جرد-المحركات-الفعلي)
4. [عائلات التحليل السبع والمحركات المرتبطة بها](#4-عائلات-التحليل-السبع)
5. [المنسّق (Orchestrator V3)](#5-المنسّق-orchestrator-v3)
6. [المنفّذ (Executor V3)](#6-المنفّذ-executor-v3)
7. [بوابة المخاطر (Risk Gate)](#7-بوابة-المخاطر-risk-gate)
8. [سجل القرارات (Decision Logger)](#8-سجل-القرارات-decision-logger)
9. [مصفوفة حالات السوق والسهم](#9-مصفوفة-حالات-السوق-والسهم)
10. [مصفوفة الأوزان الديناميكية V1](#10-مصفوفة-الأوزان-الديناميكية-v1)
11. [ترتيب التنفيذ (Pipeline)](#11-ترتيب-التنفيذ-pipeline)
12. [قواعد التعارض والفشل](#12-قواعد-التعارض-والفشل)
13. [جدول القرار النهائي](#13-جدول-القرار-النهائي)
14. [المسار الإنتاجي الفعلي](#14-المسار-الإنتاجي-الفعلي)
15. [قواعد المخاطر المعتمدة](#15-قواعد-المخاطر-المعتمدة)
16. [ملفات النظام المرجعية](#16-ملفات-النظام-المرجعية)

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:
1. **Rule-Based** (110+ محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama glm-fast:latest — 40% وزن فقط)

### القواعد الذهبية الثمانية (Hard Veto Layer)
1. **Liquidity First** — تخطّى التحليل لو السهم غير قابل للتداول
2. **Market Regime Filter** — تعديل الثقة حسب حالة السوق
3. **Sector-Relative Fundamentals** — مقارنة داخل القطاع
4. **Session Dynamics** — ليس "أفضل ساعات"
5. **Unified Scoring** — Weighted combination
6. **Strict Thresholds** — STRONG_BUY ≥ 78, BUY ≥ 65
7. **Risk Profile** — Position, Stop, Target, Time لكل إشارة
8. **Feedback Loop** — التعلّم من الأخطاء

---

## 2. المحرك المركزي: master_analyzer.py

| الخاصية | القيمة |
|---|---|
| الملف | `vps-service/analyzers/master_analyzer.py` |
| الحجم | 5,793 سطر |
| الدور | المحرك المركزى — يجمع 8 محركات فرعية |
| المدخلات | `ticker, prices[], volumes[], market_pulse, history` |
| المخرجات | `MasterAnalysis(signal, master_score, risk_profile, suggested_position_size)` |

### عتبات الإشارة
```python
THRESHOLDS = {
    'STRONG_BUY': 78,
    'BUY': 65,
    'ACCUMULATE': 55,
    'REDUCE': 40,
    'STRONG_SELL': 25,
}
```

### خط الإنتاج الداخلى لـ master_analyzer
```
1. Liquidity Filter → filter illiquid stocks
2. Market Regime Check → DEFENSIVE? Cut size
3. Sector Strength → vs EGX30/100
4. Session Timing → pre-market/intraday/close
5. Technical Analysis → RSI, MACD, ADX, BB
6. Fundamental Score → Piotroski + Altman
7. News Sentiment → from news.db
8. AI Pattern Detection → candlestick + chart patterns
9. Multi-Timeframe → 1D + 1W + 1M alignment
10. Volume Profile → POC, VAH, VAL
→ Confluence Score 0-100 → Persona Suitability → Dynamic Targets
```

### مخرجات MasterAnalysis (الحقول الأساسية)
| الحقل | النوع | الوصف |
|---|---|---|
| `signal` | str | STRONG_BUY / BUY / ACCUMULATE / HOLD / SELL / STRONG_SELL |
| `signal_ar` | str | التوصية بالعربية |
| `master_score` | float | 0-100 درجة موزونة |
| `risk_profile` | dict | entry_price, stop_loss, target_price, risk_reward_ratio |
| `suggested_position_size` | float | % من رأس المال |
| `confidence` | float | 0-100 |
| `confluence_score` | float | 0-100 (8 طبقات) |
| `confluence_signal` | str | إشارة الـ confluence |
| `conviction_level` | str | HIGH / MEDIUM / LOW |
| `market_regime_ar` | str | حالة السوق بالعربية |
| `is_tradeable` | bool | هل السهم قابل للتداول |
| `reason` | str | تفسير الإشارة |

---

## 3. جرد المحركات الفعلي

المشروع يحتوى على **116 محرك** موزّعة كالتالى:

| الفئة | العدد | أمثلة |
|---|---|---|
| Trend/Technical | 5 | technical, technical_weighted, technical_target_engine |
| Momentum/Breakout | 3 | breakout_signal, sniper_engine |
| Pattern/Structure | 7 | candlestick, fibonacci, smc_engine, support_resistance |
| Volume/Liquidity | 2 | liquidity_filter, volume_profile |
| Fundamental | 8 | fundamental, fundamental_scorer, fair_value_calculator |
| News/Sentiment | 6 | news_fetcher_analyzer, sentiment_analyzer |
| Scoring/Confluence | 6 | confluence_engine_v3, conviction_engine |
| Regime/Macro | 5 | market_regime_engine, hmm_market_regime |
| Risk/Position | 5 | risk, risk_adaptive, position_sizing, position_manager |
| Crypto-specific | 6 | crypto_analyzer, crypto_maestro |
| Prediction/Tracking | 5 | prediction_tracker, backtest_engine |
| Filter/Utility | 8 | ticker_cooldown, session_timing, screener |
| Other | 56 | adaptive_weights, background_analyzer, etc. |

الجرد الكامل موجود فى: `Documentation/ORCHESTRATOR_ENGINE_INVENTORY.md`

---

## 4. عائلات التحليل السبع والمحركات المرتبطة بها

| العائلة | الرمز | المحركات الفعلية | الملفات |
|---|---|---|---|
| **الاتجاه** | TREND | technical, technical_weighted, technical_target_engine, multi_timeframe_engine | `vps-service/analyzers/technical.py` إلخ |
| **الزخم** | MOM | breakout_signal, sniper_engine | `vps-service/analyzers/breakout_signal.py` إلخ |
| **الارتداد والنطاق** | MR | candlestick, candle_probability_engine, fibonacci, support_resistance_calculator | `vps-service/analyzers/candlestick.py` إلخ |
| **الاختراق وبنية السعر** | BRK | smc_engine, ai_pattern_analyzer, institutional_levels | `vps-service/analyzers/smc_engine.py` إلخ |
| **الحجم وتدفق التداول** | FLOW | liquidity_filter, volume_profile | `vps-service/analyzers/liquidity_filter.py` إلخ |
| **التحليل المالي** | FUND | fundamental, fundamental_engine, fundamental_scorer, fair_value_calculator, dividend_checker | `vps-service/analyzers/fundamental.py` إلخ |
| **الأخبار والأحداث** | EVENT | news_fetcher_analyzer, news_impact_scorer, sentiment_analyzer | `vps-service/analyzers/news_fetcher_analyzer.py` إلخ |

### قواعد إلزامية للعائلات
- **TREND** و **MOM** لا يعنيان تلقائيًا توصية شراء؛ يجب تحديد اتجاه الإشارة.
- **MR** لا يُستخدم كإشارة شراء لمجرد انخفاض السعر.
- **BRK** لا يعتمد على تجاوز مستوى سعري دون شروط تأكيد.
- **FLOW** لا يجوز أن يحوّل حجم تداول مرتفعًا وحده إلى توصية.
- **FUND** و **EVENT** لا يُشغّلان إذا لم تتوفر بيانات موثوقة وحديثة.
- إذا كانت عدة محركات تقيس العامل نفسه، تُعامل كأدلة مترابطة (ليست مستقلة).

---

## 5. المنسّق (Orchestrator V3)

| الخاصية | القيمة |
|---|---|
| الملف | `vps-service/core/orchestrator_v3.py` |
| الدور | يخطط مسار التحليل — يحدد الحالة، يختار المحركات، ينتج Plan |
| لا يحسب مؤشرات | ✅ |
| لا يصدر توصيات | ✅ |

### العقد (EnginePlan)
```python
@dataclass
class V3Plan:
    plan_id: str           # UUID
    ticker: str
    market: str             # EGX
    state_code: str         # S1-S11 (من مصفوفة الحالات)
    market_regime: str      # BULL_STABLE / BEAR_ACC / SIDEWAYS / etc.
    normalized_weights: Dict[str, float]  # عائلة → وزن (مجموع=1.0)
    selected_engines: List[str]
    skipped_engines: List[Dict]
    execution_order: List[str]
    decision_policy: str   # full / partial / no_trade
    config_version: str    # v3.0-owner-policy
```

### المنطق
1. يستقبل `ticker, prices, volumes`
2. يصنّف حالة السوق + حالة السهم → `state_code` (S1-S11)
3. يختار المحركات المناسبة من `ENGINE_FAMILIES`
4. يطبّع الأوزان (مجموع=1.0) على العائلات المتاحة فقط
5. ينتج `V3Plan` للمنفّذ

### حالات الرفض (NO_TRADE)
- بيانات غير كافية (< 50 جلسة)
- سيولة حرجة
- هبوط متسارع
- تذبذب مرتفع جدًا
- إشارات متعارضة بثقة منخفضة

---

## 6. المنفّذ (Executor V3)

| الخاصية | القيمة |
|---|---|
| الملف | `vps-service/core/executor_v3.py` |
| الدور | ينفذ خطة المنسّق — يشغّل المحركات، يدمج النتائج |
| لا يصدر قرارًا مستقلاً | ✅ |
| لا يتجاوز المخاطر | ✅ |

### العقد (ExecutorResult)
```python
@dataclass
class V3Result:
    execution_id: str
    engine_scores: Dict[str, float]    # عائلة → درجة موحدة (-100..+100)
    engine_signals: Dict[str, str]      # عائلة → اتجاه الإشارة
    signal_score: float                 # الدرجة الموزونة (-100..+100)
    confidence: float                    # 0-100
    final_signal: str
    risk_profile: Dict
    failed_engines: List[Dict]
    complete: bool
```

### كيف يعمل
1. يستقبل `V3Plan` من المنسّق
2. يشغّل محرك واحد من كل عائلة مختارة:
   - **TREND** → `master_analyzer` (يحسب RSI, MACD, ADX, BB)
   - **MOM** → RSI(14) داخلى
   - **MR** → price vs SMA20
   - **BRK** → price vs 20-day high/low
   - **FLOW** → volume ratio (recent vs 20d avg)
   - **FUND** → placeholder (يحتاج بيانات مالية)
   - **EVENT** → placeholder (يحتاج بيانات أخبار)
3. يوحّد الدرجات إلى مقياس -100..+100
4. يحسب `signal_score` موزون بالأوزان V1
5. يحسب `confidence` من اتفاق المحركات
6. يتحقق من التعارض

### معادلة الدمج
```
S = Σ(wᵢ × sᵢ) / Σ(wᵢ)
```
حيث `sᵢ` درجة المحرك بعد التوحيد، `wᵢ` وزنه الفعلى بعد استبعاد المحركات غير المؤهلة.

---

## 7. بوابة المخاطر (Risk Gate)

| الخاصية | القيمة |
|---|---|
| الملف | `vps-service/core/risk_gate.py` |
| الدور | يطبّق 6 قواعد مخاطر إلزامية قبل إصدار القرار النهائى |
| مستقلة | ✅ لا يمكن لأى محرك تجاوزها |
| متصل بالإنتاج | ✅ `scanner_routes.py` line 217 |

### القواعد الست
| # | القاعدة | الشرط | النتيجة |
|---|---|---|---|
| 1 | Liquidity blocked | سيولة حرجة | NO_TRADE + position=0 |
| 2 | R:R < 1.0 | نسبة العائد للمخاطرة أقل من 1 | Downgrade مستوى |
| 3 | Position > 25% | حجم مركز يتجاوز 25% | Clamp إلى 25% |
| 4 | Conviction LOW | ثقة منخفضة | Downgrade مستوى |
| 5 | Stale data | بيانات قديمة | Flag "stale recommendation" |
| 6 | Critical engine failure | محرك حرج فشل | NO_TRADE (no fake) |

### التوقيع (الإصدار الصحيح)
```python
def apply_risk_gate(signal, master_score, risk_profile, ...) -> Tuple[str, list, float]:
    # Returns: (final_signal, warnings, final_position_size)
```
**مهم:** `position_size` يرجع للمخرج (كان local-only قبل الإصلاح).

---

## 8. سجل القرارات (Decision Logger)

| الخاصية | القيمة |
|---|---|
| الملف | `vps-service/analyzers/decision_logger.py` (موجود بالفعل فى المشروع) |
| قاعدة البيانات | `db/decision_log.db` |
| متصل بالإنتاج | ✅ `scanner_routes.py` line 228/239 |

### الـ API
```python
def log_decision(
    symbol: str,
    decision_type: str,      # 'reject_entry' | 'accept_entry' | 'force_exit'
    reason_code: str,        # 'risk_gate_blocked' | 'risk_gate_passed' | etc
    reason_text: str = '',
    flag_active: str = '',   # 'RISK_GATE'
    score_before: int = None,
    score_after: int = None,
) -> bool:
```

### مخطط الجدول
```sql
CREATE TABLE decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT DEFAULT 'STOCKS',
    decision_type TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_text TEXT,
    flag_active TEXT,
    notebook_summary TEXT,
    score_before INTEGER,
    score_after INTEGER,
    scan_date TEXT
);
```

---

## 9. مصفوفة حالات السوق والسهم

### حالة السوق العام EGX
| الكود | الحالة | الاتجاه | الزخم | التذبذب | السيولة |
|---|---|---|---|---|---|
| R1 | صاعد مستقر | صاعد | قوى | منخفض | كافية |
| R2 | صاعد يضعف | صاعد | متراجع | متوسط | كافية |
| R3 | هابط مستقر | هابط | ضعيف | متوسط | كافية |
| R4 | هابط متسارع | هابط | سلبى | مرتفع | ضعيفة |
| R5 | عرضي | عرضي | ضعيف | منخفض | كافية |
| R6 | اختراق صاعد محتمل | عرضي→صاعد | متزايد | متوسط | كافية |
| R8 | تذبذب مرتفع | متغير | متغير | مرتفع | متغيرة |
| R9 | سيولة ضعيفة | أى | أى | أى | حرجة |
| R10 | متضارب | غير واضح | متضارب | متوسط | كافية |
| R11 | بيانات ناقصة | — | — | — | — |

### حالة السهم الفردى
| الكود | الحالة |
|---|---|
| S1 | اتجاه صاعد قوي + زخم |
| S2 | اتجاه صاعد + زخم متراجع |
| S3 | عرضي داخل نطاق |
| S4 | اختراق مقاومة محتمل |
| S5 | هابط واضح |
| S6 | ارتداد من دعم محتمل |
| S7 | تذبذب مرتفع / فجوات |
| S8 | سيولة ضعيفة |
| S9 | إشارات متعارضة |
| S10 | حالة غير معروفة |
| S11 | بيانات ناقصة |

### المصفوفة المشتركة (State Code)
| State | Market | Stock | سياسة التحليل |
|---|---|---|---|
| S1 | R1 | S1 | TREND + MOM + FLOW |
| S2 | R2 | S2 | TREND + MOM + FLOW + BRK |
| S3 | R5 | S3 | MR + FLOW + BRK |
| S4 | R6 | S4 | BRK + FLOW + TREND + MOM |
| S5 | R3 | S5 | TREND + MOM + FLOW |
| S6 | R4 | S6 | TREND + MOM + FLOW + تشديد مخاطر |
| S7 | R8 | S7 | تحليل + تشديد شروط التنفيذ |
| S8 | R9 | S8 | فحص صلاحية التنفيذ أولًا |
| S9 | R10 | S9 | أدلة تأكيد أو NO_TRADE |
| S10 | UNKNOWN | أى | مسار محافظ أو NO_TRADE |
| S11 | أى | S11 | رفض القرار |

---

## 10. مصفوفة الأوزان الديناميكية V1

الأوزان المعتمدة من المالك (مصفوفة جروك V1). كل صف مجموعه 100%.

| الحالة | TREND | MOM | MR | BRK | FLOW | FUND | EVENT |
|---|---|---|---|---|---|---|---|
| S1 صعود مستقر | 30% | 25% | 5% | 10% | 20% | 5% | 5% |
| S2 صعود يضعف | 25% | 15% | 10% | 5% | 25% | 10% | 10% |
| S3 عرضي | 10% | 10% | 30% | 5% | 25% | 10% | 10% |
| S4 اختراق صاعد | 15% | 15% | 0% | 25% | 30% | 5% | 10% |
| S5 هبوط مستقر | 30% | 20% | 5% | 5% | 20% | 10% | 10% |
| S6 هبوط متسارع | 25% | 20% | 0% | 5% | 25% | 10% | 15% |
| S7 تذبذب مرتفع | 20% | 10% | 5% | 5% | 30% | 15% | 15% |
| S8 سيولة ضعيفة | 10% | 5% | 5% | 5% | 50% | 15% | 10% |
| S9 أدلة متعارضة | 15% | 15% | 10% | 10% | 30% | 10% | 10% |

### قواعد تطبيق الأوزان
1. **تطبيع برمجي:** إذا كانت عائلة غير متاحة (FUND/EVENT)، يُعاد توزيع الوزن على المتاح فقط بشرط كفاية الأدلة.
2. **FLOW لا يعوّض عن بوابة السيولة التنفيذية.** وزن FLOW العالى فى S8 لا يسمح بشراء سهم غير قابل للتداول.
3. **الحد الأدنى لتغطية الأدلة:** إذا كانت العائلات المتاحة أقل من 3، ينتج `NO_TRADE`.
4. **لا تُعطى أوزان لمحرك FUND أو EVENT** إذا لم تتوفر له بيانات فعلية.
5. **الأوزان تخص دمج الأدلة** وليست احتمالات ربح.

### الكود المرجعى
```python
# vps-service/core/orchestrator_v3.py
RAW_WEIGHTS = {
    'S1': {'TREND':30,'MOM':25,'MR':5,'BRK':10,'FLOW':20,'FUND':5,'EVENT':5},
    'S2': {'TREND':25,'MOM':15,'MR':10,'BRK':5,'FLOW':25,'FUND':10,'EVENT':10},
    # ... (كل الصفوف)
}

def normalize_weights(raw, available_families):
    """يطبّع الأوزان على العائلات المتاحة فقط. مجموع=1.0."""
    filtered = {k: v for k, v in raw.items() if k in available_families and v > 0}
    total = sum(filtered.values())
    return {k: v / total for k, v in filtered.items()} if total > 0 else {}
```

---

## 11. ترتيب التنفيذ (Pipeline)

```
P0: فحص صحة البيانات وحداثتها
    ↓ (إذا ناقصة → NO_TRADE)
P1: تصنيف حالة السوق (R1-R11)
    ↓
P2: تصنيف حالة السهم (S1-S14)
    ↓
P3: اختيار المحركات والأوزان (Orchestrator V3)
    ↓
P4: تشغيل محركات التحليل الأساسية (Executor V3)
    ├── TREND: master_analyzer → RSI, MACD, ADX, BB
    ├── MOM: RSI(14)
    ├── MR: price vs SMA20
    ├── BRK: price vs 20-day high/low
    └── FLOW: volume ratio
    ↓
P5: تشغيل محركات التأكيد (عند الاختراق أو التعارض)
    ↓
P6: توحيد المخرجات وإزالة ازدواج الأدلة
    ↓ (درجات موحدة -100..+100)
P7: حساب Signal Score و Confidence
    ↓ (S = Σ(wᵢ × sᵢ) / Σ(wᵢ))
P8: تطبيق Risk Gate (6 قواعد إلزامية)
    ↓ (إذا رفض → NO_TRADE)
P9: تحديد أهلية التداول وحجم المركز
    ↓
P10: تسجيل القرار النهائى (Decision Logger) وإخراجه
```

### المسار الإنتاجى الفعلى
```
scanner_routes.py:197  → analyzer.analyze(ticker)
scanner_routes.py:217  → apply_risk_gate(signal, score, risk_profile)
scanner_routes.py:228  → log_decision(reject_entry) أو log_decision(accept_entry)
scanner_routes.py:331  → "recommendation": analysis.signal  ← risk-gated
```

---

## 12. قواعد التعارض والفشل

| الحالة | التصرف الإلزامى |
|---|---|
| TREND إيجابى و MOM سلبى | لا تُخفِ التعارض بالمتوسط؛ اطلب تأكيدًا أو ارفض |
| BRK إيجابى و FLOW ضعيف | لا تعتمد الاختراق وحده |
| MR إيجابى فى هبوط متسارع | لا تصدر شراء تلقائيًا؛ سياسة S6 |
| محرك أساسى فشل | الخطة غير صالحة للقرار القابل للتداول |
| محرك ثانوى فشل | متابعة مشروطة بتغطية الأدلة |
| بيانات قديمة أو غير صالحة | رفض القرار |
| حالة السوق UNKNOWN | مسار محافظ أو NO_TRADE |
| تذبذب يتجاوز حدود المخاطر | Risk Gate يرفض |
| سيولة غير كافية | رفض الصفقة |
| تجاوز حد المركز أو Split Guard أو Cooldown | الرفض وفق قواعد المخاطر |
| اختلاف السجل عن المخرج | فشل اختبار |
| تكرار القرار لنفس المدخلات | منع التكرار (idempotency) |

---

## 13. جدول القرار النهائي

| Signal Score | Confidence | النتيجة |
|---|---|---|
| ≥ +60 | ≥ 70 | مرشح شراء، بعد اجتياز المخاطر |
| +30 إلى +60 | ≥ 60 | يحتاج تأكيد؛ لا شراء تلقائى |
| −30 إلى +30 | أى | NO_TRADE |
| −30 إلى −60 | ≥ 60 | إشارة سلبية؛ لا بيع تلقائى |
| ≤ −60 | ≥ 70 | إشارة سلبية قوية |
| أى درجة | < 60 | NO_TRADE |
| أى درجة | بيانات غير صالحة | NO_TRADE |
| أى درجة | خرق مخاطرة إلزامى | NO_TRADE |

---

## 14. المسار الإنتاجى الفعلى

### المسار A: API (scanner_routes.py)
```
طلب API → scanner_routes.py:197 → MasterAnalyzer.analyze(ticker)
    → MasterAnalysis(signal, score, risk_profile)
    → [NEW] Risk Gate (apply_risk_gate) — line 217
    → [NEW] Decision Logger (log_decision) — line 228/239
    → API Response: "recommendation": analysis.signal
```

### المسار B: التنبؤ اليومى (daily_predictor.py)
```
Cron 03:00 → daily_predictor.py → flow_system.py
    → FlowScore (0-100)
    → predictions.db → prediction_tracker → outcomes
```

### تكامل Risk Gate مع الإنتاج
```python
# scanner_routes.py — بعد analyzer.analyze(ticker):
from core.risk_gate import apply_risk_gate

_final_sig, _risk_warns, _final_pos = apply_risk_gate(
    signal=_raw_sig, master_score=_score,
    risk_profile={'risk_reward_ratio': _rr},
    position_size_pct=_pos,
)

if _final_sig == 'NO_TRADE':
    analysis.signal = 'NO_TRADE'
    analysis.signal_ar = 'لا تتداول'
    log_decision(symbol=ticker, decision_type='reject_entry', ...)
else:
    log_decision(symbol=ticker, decision_type='accept_entry', ...)
```

---

## 15. قواعد المخاطر المعتمدة

| القاعدة | القيمة | المصدر |
|---|---|---|
| Hard Loss | 7% | `position_sizing.py:18`, `prediction_tracker.py:154` |
| ATR clamp | 5-9% | `v2_routes.py:2014`, `crypto_strict_filters.py:8` |
| Split Guard | 35% | `bag_holder_rescue.py:801` |
| Ticker Cooldown | configurable | `ticker_cooldown.py` |
| Position max | 25% of capital | `risk_gate.py` (متصل بالإنتاج) |
| R:R minimum | 1.0 (downgrade if <) | `risk_gate.py` |
| Liquidity gate | turnover < threshold → NO_TRADE | `risk_gate.py` |
| Data stale | staleness > 3d → flag | `risk_gate.py` |

---

## 16. ملفات النظام المرجعية

### المحركات الأساسية
| الملف | الحجم | الدور |
|---|---|---|
| `vps-service/analyzers/master_analyzer.py` | 5,793 LOC | المحرك المركزى — يجمع 8 محركات |
| `vps-service/analyzers/technical.py` | 613 LOC | RSI, MACD, ADX, Bollinger |
| `vps-service/analyzers/fundamental.py` | 178 LOC | Piotroski, Altman Z-Score |
| `vps-service/analyzers/liquidity_filter.py` | 1,111 LOC | فلترة السيولة |
| `vps-service/analyzers/market_regime_engine.py` | 1,380 LOC | كشف حالة السوق |
| `vps-service/analyzers/confluence_engine_v3.py` | 1,233 LOC | 8-layer scoring |
| `vps-service/analyzers/conviction_engine.py` | 433 LOC | مستوى الثقة |
| `vps-service/analyzers/position_sizing.py` | 179 LOC | حساب حجم المركز |
| `vps-service/analyzers/risk_adaptive.py` | 715 LOC | مخاطر تكيفية |
| `vps-service/analyzers/ticker_cooldown.py` | 168 LOC | منع تكرار الإشارة |
| `vps-service/analyzers/decision_logger.py` | 348 LOC | سجل القرارات |
| `vps-service/engines/flow_system.py` | 1,050 LOC | Flow Score (4 طبقات) |

### المنسّق والمنفّذ وبوابة المخاطر
| الملف | الحجم | الدور |
|---|---|---|
| `vps-service/core/orchestrator_v3.py` | 281 LOC | المنسّق — يصنّف الحالة + يختار المحركات + أوزان V1 |
| `vps-service/core/executor_v3.py` | 267 LOC | المنفّذ — يشغّل المحركات + يدمج النتائج |
| `vps-service/core/risk_gate.py` | 108 LOC | بوابة المخاطر — 6 قواعد إلزامية |
| `vps-service/core/orchestrator.py` | 132 LOC | المنسّق V1 (قديم — للاختبار) |
| `vps-service/core/executor.py` | 313 LOC | المنفّذ V1 (قديم — للاختبار) |

### مسار الإنتاج
| الملف | الحجم | الدور |
|---|---|---|
| `vps-service/api/scanner_routes.py` | 388 LOC | نقطة دخول API — تحليل + Risk Gate + Decision Log |
| `vps-service/jobs/daily_predictor.py` | 4,730 LOC | التنبؤ اليومى V40.2 |
| `vps-service/main.py` | 370 LOC | خادم uvicorn (port 8010) |

### الاختبارات
| الملف | عدد الاختبارات | الدور |
|---|---|---|
| `scripts/test_orchestrator_v3.py` | 42 | اختبارات المنسّق V3 + الأوزان + القرار |
| `scripts/test_bravo_fixes_v2.py` | 25 | اختبارات F1/F3 + market filter |
| `scripts/test_c4_regression.py` | 12 | اختبارات عزل الأسواق |
| `scripts/test_integration_behavioral.py` | 33 | اختبارات تكامل سلوكية |
| `scripts/test_financial_math.py` | 24 | اختبارات RSI/ATR/MA/R:R/position |
| `scripts/test_engine_pipeline.py` | 25 | اختبارات عقد المحركات |
| `scripts/test_historical_backtest.py` | 13 | اختبارات Backtest تاريخى |
| `scripts/test_system_integration.py` | 15 | اختبارات تكامل النظام |

### سكربتات الاختبار التاريخى
| الملف | الدور |
|---|---|
| `scripts/run_b0b4_full.py` | مقارنة B0-B4 على 20 سهم × 4 شهور |
| `scripts/run_staged_optimization.py` | تحسين مرحلى (6 مراحل) |
| `scripts/run_backtest_new_architecture.py` | Backtest على المسار الجديد |

### التوثيق المرجعى
| الملف | الدور |
|---|---|
| `Documentation/00-CONSTITUTION.md` | الدستور — القواعد الحاكمة |
| `Documentation/02-DATABASES-AND-DATA.md` | قواعد البيانات + مصادر الحقيقة |
| `Documentation/ORCHESTRATOR_ENGINE_INVENTORY.md` | جرد المحركات (116) |
| `Documentation/ENGINE_FAMILY_MAPPING.md` | ربط العائلات بالمحركات |
| `Documentation/MARKET_AND_STOCK_REGIME_MATRIX.md` | مصفوفة الحالات |
| `Documentation/REGIME_WEIGHT_POLICY.md` | سياسة الأوزان |
| `Documentation/ORCHESTRATOR-EXECUTOR-SPEC.md` | مواصفات المنسّق والمنفّذ |
| `Documentation/PROJECT_ARCHITECTURE_AUDIT.md` | تدقيق المعمارية |
| `Documentation/SYSTEM-BRAIN-HOW-IT-THINKS.md` | المرجع المعمارى الشامل |
