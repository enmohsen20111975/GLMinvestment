# ORCHESTRATOR-EXECUTOR-SPEC
> **Phase 5B:** Design specification for Coordinator (المنسّق) + Executor (المنفّذ)
> **Status:** SPEC APPROVED (design only — NOT implemented per owner directive)
> **Date:** 2026-10-26
> **Rule:** لا برمجة قبل اعتماد المسار الفعلى + حسم مصدر القرار + قواعد المخاطر

---

## 1. المنسّق (Orchestrator)

### 1.1 الدور
المنسّق لا يحسب المؤشرات ولا يصدر توصيات. يختار المحركات المناسبة لكل حالة سوق، وينتج خطة تشغيل للمنفّذ.

### 1.2 العقد (Contract)

```python
class OrchestratorPlan:
    # Inputs snapshot
    ticker: str
    market_state: str          # DEFENSIVE | NORMAL | AGGRESSIVE | UNKNOWN
    data_quality: str          # fresh | stale | very_stale | insufficient
    available_engines: List[str]
    
    # Selection result
    selected_engines: List[str]    # engines to run
    skipped_engines: List[Dict]     # [{name, reason}]
    weights: Dict[str, float]      # engine → weight (from approved config)
    thresholds: Dict[str, float]   # decision thresholds (from approved config)
    
    # Metadata
    plan_id: str
    created_at: str
    config_version: str             # which weights/thresholds set used
    decision_policy: str            # "full" | "partial_allowed" | "no_trade"
```

### 1.3 القيود الإلزامية
- ❌ لا يحسب المؤشرات الفنية بنفسه
- ❌ لا ينشئ توصية مالية مستقلة
- ❌ لا يغيّر الأوزان أو العتبات ذاتيًا
- ✅ يكتشف البيانات غير الصالحة قبل بدء التحليل
- ✅ ينتج خطة واضحة قابلة للاختبار
- ✅ كل قرار تشغيل له سبب قابل للتدقيق

### 1.4 منطق الاختيار
```
IF data_quality == 'insufficient':
    → NO_TRADE (skip all engines)
ELIF market_state == 'DEFENSIVE':
    → skip high-risk engines (crypto, breakout)
    → raise thresholds (+5 to STRONG_BUY/BUY)
    → selected = [technical, fundamental, liquidity, risk]
ELIF market_state == 'AGGRESSIVE':
    → include breakout + momentum engines
    → selected = [technical, fundamental, liquidity, breakout, momentum, risk]
ELSE:  # NORMAL or UNKNOWN
    → standard engine set
    → selected = [technical, fundamental, liquidity, confluence, risk]
```

### 1.5 الاختبارات الإلزامية
| الاختبار | ما يثبت |
|---|---|
| Market state known → correct engines selected | selection logic works |
| Market state UNKNOWN → safe default | no crash on unknown |
| Data insufficient → NO_TRADE | data gate works |
| Engine failure → skipped + logged | fault tolerance |
| Same inputs → same plan | determinism |
| Unapproved weights → rejected | config safety |

---

## 2. المنفّذ (Executor)

### 2.1 الدور
ينفّذ خطة المنسّق حرفيًا. يشغّل المحركات بالترتيب، يوحّد شكل النتائج، يطبّق بوابات المخاطر، يسلم للقرار النهائى.

### 2.2 العقد (Contract)

```python
class ExecutorResult:
    # Plan reference
    plan_id: str
    
    # Engine outputs
    engine_results: Dict[str, Dict]   # engine → its output dict
    failed_engines: List[Dict]        # [{name, error, timestamp}]
    
    # Final decision (from master_analyzer only)
    final_signal: str                 # STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL | NO_TRADE
    master_score: float
    risk_profile: Dict                # entry, stop, target, R:R, position_size
    
    # Audit trail
    execution_id: str
    started_at: str
    completed_at: str
    code_version: str                 # git SHA
    config_version: str
    warnings: List[str]
    errors: List[str]
```

### 2.3 القيود الإلزامية
- ❌ لا يعيد تفسير الخطة من تلقاء نفسه
- ❌ لا يتجاوز حدود المخاطر
- ❌ لا يخفى فشل المحركات (يحوّل النتيجة المفقودة إلى NULL، مش محايد)
- ❌ لا يخرج قرارًا مكتملًا عند نقص الأدلة الحرجة
- ❌ لا يكتب على DB الإنتاج فى مرحلة الاختبار
- ✅ يمكن تتبع كل قرار إلى نتائجه ومدخلاته
- ✅ يطبّق بوابات المخاطر قبل إخراج القرار

### 2.4 بوابة المخاطر (Risk Gate)
```
BEFORE emitting final_signal:
1. IF liquidity_filter blocked → NO_TRADE
2. IF risk_reward_ratio < 1.0 → downgrade one level
3. IF position_size > 25% capital → clamp to 25%
4. IF conviction_level == 'LOW' → downgrade one level
5. IF data_quality in ('stale', 'very_stale') → flag as "stale recommendation"
6. IF any critical engine failed → NO_TRADE (not faked)
```

### 2.5 الاختبارات الإلزامية
| الاختبار | ما يثبت |
|---|---|
| Full successful run | pipeline works end-to-end |
| Single engine failure | fault tolerance |
| Critical engine failure | NO_TRADE (no fake) |
| Invalid engine output | rejected, not converted to neutral |
| Duplicate request | no double-write |
| Conflicting engine signals | conflict resolution works |
| Timeout | handled gracefully |
| Plan ↔ Result ↔ Decision match | contract consistency |

---

## 3. الترتيب والاعتماديات

```
Orchestrator → produces Plan
    ↓
Executor ← receives Plan
    ↓
Executor runs engines (per plan)
    ↓
Executor applies Risk Gate
    ↓
Executor emits final_signal (from master_analyzer)
    ↓
Decision Log (audit trail)
```

### 3.1 ما لا يفعله المنسّق
- لا يشغّل المحركات (ده شغل المنفّذ)
- لا يحسب الأوزان (يقرأها من config معتمد)
- لا يصدر recommendation

### 3.2 ما لا يفعله المنفّذ
- لا يختار المحركات (ده شغل المنسّق)
- لا يغيّر الأوزان أو العتبات
- لا يصدر recommendation مستقل (يستخدم master_analyzer)

---

## 4. سجل القرار (Decision Log)

كل قرار يُسجّل:
```json
{
  "execution_id": "uuid",
  "timestamp": "2026-10-26T...",
  "ticker": "COMI",
  "plan_id": "uuid",
  "selected_engines": ["technical", "fundamental", "liquidity", "risk"],
  "skipped_engines": [{"name": "crypto", "reason": "not crypto market"}],
  "engine_results": {...},
  "final_signal": "BUY",
  "master_score": 68.5,
  "risk_profile": {"entry": 124.5, "stop": 119.0, "target": 135.0, "R:R": 2.1, "position_size": 5.0},
  "code_version": "d4a551a",
  "config_version": "v1.0",
  "warnings": ["high_52w invalid (stale)"],
  "errors": []
}
```

---

## 5. شرط الإغلاق

المواصفات deprecation:
- ✅ المنسّق: عقد + قيود + منطق اختيار + اختبارات
- ✅ المنفّذ: عقد + قيود + بوابة مخاطر + اختبارات
- ✅ الترتيب + الاعتماديات
- ✅ سجل القرار

**لا تنفّذ برمجيًا** قبل:
1. اعتماد المالك على المواصفات
2. حسم مصدر القرار النهائى (master_analyzer confirmed)
3. حسم قواعد المخاطر (risk gate rules approved)
4. اختبار على بيانات ثابتة (historical snapshot)

---

## 6. علاقة المواصفات بالكود الحالى

| العنصر | موجود حاليًا؟ | المطلوب |
|---|---|---|
| master_analyzer كـ decision source | ✅ نعم | تأكيد أنه المصدر الوحيد |
| Engine weights | ⚠️ موزّعة | توحيد فى config واحد |
| Risk gate | ⚠️ جزئي | توحيد + اختبار |
| Decision log | ❌ غير موجود | إنشاء |
| Orchestrator | ❌ غير موجود | تصميم معتمد (هذا الملف) |
| Executor | ⚠️ master_analyzer يعمل كليهما | فصل لاحقًا (بعد اعتماد المالك) |
