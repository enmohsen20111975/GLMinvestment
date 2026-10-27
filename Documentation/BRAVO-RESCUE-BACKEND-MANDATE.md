# BRAVO — BagHolder Rescue Backend: Complete 4-Module Implementation Mandate

> **Author:** Alpha (Frontend Engineer)
> **Date:** 2026-10-25
> **For:** Bravo (Backend Engineer)
> **Status:** AWAITING IMPLEMENTATION — DO NOT DEPLOY TO PRODUCTION
> **Branch:** Create isolated branch `bravo/rescue-backend-modules` from `main`

---

## 0. Mission

أنت المسؤول التنفيذي عن إكمال **4 modules ناقصة بالكامل** في الـ BagHolder Rescue backend. الـ frontend جاهز يستقبل الـ outputs الجديدة، بس الباك إند فيه فجوات حرجة.

**القاعدة الذهبية:** "النزول لوحده مش سبب للشراء. الأولوية: حماية رأس المال المتبقي > استعادة تدريجية لو فيه فرصة حقيقية."

أكمل الـ modules دي، اربطها بـ `BagHolderRescue.analyze_clinic()`، واختبرها فعلياً. لا توقف عند كتابة الكود — شغّل الاختبارات ووثّق النتائج.

---

## 1. Context: What Already Exists (DO NOT DUPLICATE)

قبل ما تبدأ، اقرأ الملفات دي عشان متكررش:

### Already Implemented (4 modules — partial):

| # | Module | Existing File | LOC | Coverage | Gaps |
|---|--------|--------------|-----|----------|------|
| 1 | Market Regime | `vps-service/analyzers/market_regime_engine.py` | 1380 | 60% | EGX70/EGX100 indices, foreign flow, trading halt |
| 2 | Portfolio Ingester | `src/app/api/portfolio/bag-holder-rescue/route.ts` | 308 | 50% | Explicit data validator |
| 3 | Fundamental Scorer | `vps-service/analyzers/fundamental_scorer.py` | 569 | 50% | revenue_growth, OCF, disclosure_quality dims missing |
| 6 | Averaging Simulator | `vps-service/analyzers/bag_holder_rescue.py::analyze_clinic` | 1195 | 25% | Single scenario only; needs 5×5 grid |

### Missing Entirely (4 modules — 0% — YOUR SCOPE):

| # | Module | Status |
|---|--------|--------|
| 4 | **Loss Attribution** | ❌ NONE |
| 5 | **Classification Engine (A/B/C/D + INSUFFICIENT_DATA)** | ❌ NONE |
| 7 | **Liquidity Allocator** | ❌ NONE |
| 8 | **Monitoring Plan** | ❌ NONE |

### Structural Issues (FIX THESE TOO):

1. **`vps-service/core/stock_rescue_engine.py` (160 LOC)** — قديم ومكرر. وثّق لو محتاج deprecation.
2. **3 fundamental analyzers مختلفة** — `fundamental_scorer.py` + `confluence_engine_v3.py::FundamentalAnalyzer` + `rescue/route.ts` inline. وثّق أيه الـ SSOT.
3. **4 classification taxonomies مختلفة** — HOLD/AVG/CUT, KILL/GOLDEN_DIP/HOLD_WAIT, etc. الـ A/B/C/D الجديد لازم يكون الـ SSOT.

---

## 2. Strict Rules (NON-NEGOTIABLE)

### ✅ Authorized:
- Inspect all existing rescue/market/fundamental code
- Create new Python modules in `vps-service/analyzers/`
- Modify `bag_holder_rescue.py` to wire new modules
- Run tests against temporary test databases
- Commit/push to isolated branch `bravo/rescue-backend-modules`

### ❌ Prohibited:
- NO production deployment
- NO production database writes
- NO modifying `maestro_orchestrator.py`
- NO changing recommendation logic (signal thresholds, scoring weights)
- NO deleting or merging legacy rows without explicit approval
- NO fabricating data — if a field is unavailable, return `null` or `INSUFFICIENT_DATA`
- NO hardcoded entry*multiplier fabrication (Issue #3 already fixed in frontend; backend must follow same rule)
- NO claiming a test passed unless actually executed

---

## 3. Module #4: Loss Attribution

**File:** `vps-service/analyzers/loss_attribution.py` (NEW)

### Purpose
يفصل سبب الهبوط: هل هو market-wide, company-specific, overvaluation correction, liquidity pressure, أو mixed؟

### Required Taxonomy

```python
class LossCause(str, Enum):
    MARKET_WIDE = "MARKET_WIDE"              # الهبوط مرتبط بالسوق العام
    COMPANY_SPECIFIC = "COMPANY_SPECIFIC"    # مشكلة خاصة بالشركة
    OVERVALUATION_CORRECTION = "OVERVALUATION_CORRECTION"  # التقييم كان مبالغ فيه
    LIQUIDITY_PRESSURE = "LIQUIDITY_PRESSURE" # ضعف سيولة + ضغط بيع
    MIXED = "MIXED"                          # خليط من الأسباب
    UNCLEAR = "UNCLEAR"                       # لا يمكن التحديد
```

### Required Inputs
- `ticker`: str
- `loss_pct`: float (negative for losses)
- `stock_data`: dict (PE, PB, volume, sector, etc.)
- `market_regime`: MarketRegimeData (from Module #1)
- `index_change`: float | null (EGX30 daily change %)
- `sector_change`: float | null (sector index daily change %)
- `price_history`: list[dict] (last 90 days: date, close, volume)

### Required Outputs

```python
@dataclass
class LossAttribution:
    primary_cause: LossCause
    market_contribution_pct: float | None       # % of loss from market
    company_contribution_pct: float | None      # % from company issues
    valuation_contribution_pct: float | None    # % from overvaluation
    liquidity_contribution_pct: float | None     # % from liquidity dry-up
    recovery_catalyst_12_24m: CatalystStatus    # PRESENT / WEAK / ABSENT / UNCLEAR
    catalyst_notes_ar: str                       # Arabic explanation
    confidence: float                             # 0-1 how confident in attribution
```

### Logic

1. **Market contribution**: if index fell X% and stock fell Y%, market_contrib = min(X/Y, 1.0) when Y > X
2. **Company contribution**: if stock fell significantly more than index (>1.5×), company_contrib = 1 - market_contrib
3. **Valuation contribution**: if PE was > 30 before drop AND loss > 15%, valuation_contrib = 20% estimate
4. **Liquidity contribution**: if avg volume last 20d < 30% of avg volume last 90d, liquidity_contrib = 15%
5. **Primary cause**: pick the highest contribution; if two are close (< 15% diff), use MIXED
6. **Recovery catalyst**: MUST be `UNCLEAR` if no forward-looking data — never fabricate

### Tests Required
- `test_loss_attribution.py`:
  - T01: stock fell 20%, index fell 18% → MARKET_WIDE (market_contrib > 70%)
  - T02: stock fell 30%, index fell 5% → COMPANY_SPECIFIC
  - T03: PE was 45, stock fell 25% → OVERVALUATION_CORRECTION component
  - T04: volume dropped 80% → LIQUIDITY_PRESSURE component
  - T05: two causes close (45/40) → MIXED
  - T06: insufficient data → UNCLEAR + confidence=0
  - T07: recovery_catalyst always UNCLEAR without forward data (no fabrication)

---

## 4. Module #5: Classification Engine (A/B/C/D + INSUFFICIENT_DATA)

**File:** `vps-service/analyzers/rescue_classifier.py` (NEW)

### Purpose
يصنّف كل سهم لـ A/B/C/D + INSUFFICIENT_DATA بناءً على الأساسيات + التقييم + سبب الهبوط + سياق السوق.

### Classification Rules

```python
class StockClassification(str, Enum):
    A = "A"                    # احتفاظ أو زيادة محدودة
    B = "B"                    # احتفاظ بدون زيادة
    C = "C"                    # تخفيض تدريجي
    D = "D"                    # خروج أو مراقبة لصيقة
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"  # لا يمكن التقييم
```

### Classification Logic

| Class | Fundamentals | Valuation (after drop) | Loss Attribution | Liquidity | Action |
|-------|-------------|----------------------|-----------------|-----------|--------|
| A | قوي (score ≥ 22/30) | مقبول (PE < 20) | MARKET_WIDE or MIXED | مقبولة (vol > 100K) | احتفاظ أو زيادة محدودة |
| B | متوسط (15-21) | OR قوي لكن PE > 25 | any | any | احتفاظ بدون زيادة |
| C | ضعيف (8-14) | any | COMPANY_SPECIFIC | any | تخفيض تدريجي |
| D | ضعيف + سيولة معدومة | any | any | vol < 10K | خروج محتمل |
| INSUFFICIENT_DATA | score = 0 | any | any | any | مراقبة لصيقة |

### Required Function

```python
def classify_position(
    fundamental_score: FundamentalScore,  # from Module #3
    loss_attribution: LossAttribution,   # from Module #4
    market_regime: MarketRegimeData,     # from Module #1
    current_price: float,
    pe_ratio: float,
) -> tuple[StockClassification, str]:
    """
    Returns (classification, arabic_reason)
    """
```

### Tests Required
- T01: strong fundamentals + reasonable PE + market-wide loss → A
- T02: medium fundamentals → B
- T03: weak fundamentals + company-specific → C
- T04: weak + low liquidity → D
- T05: no data → INSUFFICIENT_DATA
- T06: strong fundamentals BUT overvalued (PE > 30) even after drop → B (not A)
- T07: strong fundamentals + RISK_OFF regime → still A but with "hold" advice

---

## 5. Module #6: Averaging Simulator (5×5 Grid)

**File:** `vps-service/analyzers/averaging_simulator.py` (NEW)

### Purpose
يحسب 5 سيناريوهات ضخ (10k/20k/30k/50k/70k) × 5 سيناريوهات سعر بعد الضخ (baseline/+10%/+20%/-10%/-20%).

### Required Function

```python
def simulate_averaging_grid(
    current_shares: int,
    current_avg: float,
    current_price: float,
    injection_amounts: list[int] = [10000, 20000, 30000, 50000, 70000],
    price_scenarios: list[float] = [1.0, 1.10, 1.20, 0.90, 0.80],  # multipliers
) -> dict[str, AveragingScenario]:
    """
    Returns dict keyed by "{injection_amount}" → AveragingScenario
    """
```

### Required Output per Scenario

```python
@dataclass
class AveragingScenario:
    injection_amount: int
    current_shares: int
    current_avg: float
    new_shares_bought: int
    new_avg: float
    new_total_invested: float
    new_loss_pct: float
    new_loss_egp: float
    breakeven_price: float
    pct_rise_needed_for_breakeven: float
    if_down_10pct: PriceOutcome
    if_down_20pct: PriceOutcome
    if_up_10pct: PriceOutcome
    if_up_20pct: PriceOutcome
    warning_ar: str  # Arabic warning if risk high
    is_recommended: bool  # True only if classification == A and regime allows
```

### Logic

For each injection amount:
1. `new_shares = floor(injection / current_price)`
2. `new_avg = (current_shares * current_avg + new_shares * current_price) / (current_shares + new_shares)`
3. `new_total_invested = current_shares * current_avg + injection`
4. `new_loss_egp = (current_shares + new_shares) * current_price - new_total_invested`
5. `breakeven = new_avg`
6. `pct_rise_needed = ((breakeven - current_price) / current_price) * 100`
7. For each price_scenario: compute profit/loss if price moves to `current_price * scenario`

### Warning Rules (Arabic)
- If `pct_rise_needed > 50%`: "⚠️ لازم السهم يطلع X% عشان توصل breakeven. احتمال ضعيف على المدى القصير. متضخش."
- If `pct_rise_needed > 25%`: "⚠️ لازم السهم يطلع X%. صعب لكن ممكن على مدى طويل."
- If `new_shares > current_shares`: "⚠️ المركز هيكون أكبر من الأصلي. خطر تركيز."
- Else: "السيناريو ضمن الحدود المعقولة، بس مفيش ضمان."

### Tests Required
- T01: 10k injection on 1000 shares @ 10 EGP avg, current 8 EGP → verify new_avg, breakeven
- T02: 70k injection → verify concentration warning
- T03: high pct_rise_needed (>50%) → verify warning
- T04: price drops 20% after injection → verify increased loss
- T05: price rises 20% after injection → verify profit
- T06: current_price = 0 → return null/zero (no division by zero)
- T07: injection = 0 → return current state unchanged

---

## 6. Module #7: Liquidity Allocator

**File:** `vps-service/analyzers/liquidity_allocator.py` (NEW)

### Purpose
يحدد حجم السيولة اللي ممكن تُضخ بناءً على: تصنيف السهم + نظام السوق + حجم المحفظة.

### Required Function

```python
def allocate_liquidity(
    available_cash: float,
    positions: list[PositionAnalysis],  # list of classified positions
    market_regime: MarketRegimeData,
) -> LiquidityAllocation:
```

### Required Output

```python
class LiquidityRecommendation(str, Enum):
    HOLD_ALL_CASH = "HOLD_ALL_CASH"         # default in RISK_OFF/EXTREME_FEAR
    LIMITED_INJECTION = "LIMITED_INJECTION"  # max 20-25% in stable market
    DUAL_INJECTION = "DUAL_INJECTION"        # max 40% with 2+ A candidates
    LARGE_INJECTION = "LARGE_INJECTION"      # max 60% — rare

@dataclass
class LiquidityAllocation:
    recommendation: LiquidityRecommendation
    max_injection_pct: float  # % of available cash
    max_injection_egp: float   # actual EGP amount
    reasoning_ar: str
    candidates: list[str]      # tickers that qualify (A-classified)
    warnings_ar: list[str]
```

### Logic

| Regime | A candidates | Recommendation | Max % |
|--------|-------------|----------------|-------|
| EXTREME_FEAR | any | HOLD_ALL_CASH | 0% |
| RISK_OFF | any | HOLD_ALL_CASH | 0% |
| SIDEWAYS | ≥1 | LIMITED_INJECTION | 20% |
| RISK_ON | 1 | LIMITED_INJECTION | 25% |
| RISK_ON | ≥2 | DUAL_INJECTION | 40% |
| RISK_ON | ≥3 + cash > 100k | LARGE_INJECTION | 60% |
| UNKNOWN | any | HOLD_ALL_CASH | 0% |

### Rules
- NEVER recommend 100% injection
- Always add warning: "مفيش ضمان إن أي سهم هيرجع لمتوسطك"
- If no A candidates: "مفيش أسهم تستحق دراسة زيادة في المحفظة الحالية"

### Tests Required
- T01: RISK_OFF + 2 A candidates → HOLD_ALL_CASH
- T02: RISK_ON + 1 A candidate → LIMITED_INJECTION (25%)
- T03: RISK_ON + 3 A candidates + cash 150k → LARGE_INJECTION (60%)
- T04: SIDEWAYS + 0 A candidates → HOLD_ALL_CASH
- T05: EXTREME_FEAR → HOLD_ALL_CASH regardless of candidates
- T06: max_injection_egp = available_cash * max_injection_pct (verify math)

---

## 7. Module #8: Monitoring Plan

**File:** `vps-service/analyzers/monitoring_plan.py` (NEW)

### Purpose
يبني خطة مراقبة بـ triggers + review frequency + escalation rules.

### Required Function

```python
def build_monitoring_plan(
    positions: list[PositionAnalysis],
    market_regime: MarketRegimeData,
) -> MonitoringPlan:
```

### Required Output

```python
@dataclass
class MonitoringPlan:
    watch_list_ar: list[str]      # what to monitor
    review_frequency: str        # "daily" | "weekly" | "biweekly"
    triggers_ar: list[str]       # when to review
    escalation_ar: str           # escalation rules
    next_review_date: str        # ISO date
```

### Logic

**Review frequency:**
- `daily` if regime == EXTREME_FEAR or RISK_OFF
- `weekly` if any D-classified positions
- `biweekly` otherwise

**Watch list (Arabic):**
- "مستويات المؤشرات الرئيسية (EGX30/70/100) والاتساع"
- "سعر كل سهم محدد مقابل متوسطاته وحجمه"
- "أي إفصاح جوهري (أرباح، دين، زيادة رأس مال، مشاكل)"
- "تغيرات في صافي تعاملات الأجانب"

**Triggers (Arabic):**
- "مؤشرات السوق كسرت مستويات دعم مهمة أو اتحسنت بشكل مستدام"
- "السهم المحدد نزل نسبة إضافية معينة أو طلع وثبت"
- "ظهر إفصاح جوهري (أرباح، دين، زيادة رأس مال، نزاع، تغيير إدارة)"
- "السيولة على السهم اختفت أو زادت بشكل غير طبيعي"
- "العميل احتاج الفلوس فجأة"

**Escalation:**
- If any D positions: "مراقبة لصيقة لـ [tickers] (تصنيف D). استعداد للبيع فوراً لو ظهرت مشكلة جوهرية."
- Else: "مراجعة أسبوعية + إفصاح ربع سنوي"

### Tests Required
- T01: RISK_OFF regime → daily frequency
- T02: D position present → escalation mentions ticker
- T03: normal case → biweekly frequency
- T04: next_review_date is correctly computed

---

## 8. Integration: Wire into BagHolderRescue.analyze_clinic()

**File:** `vps-service/analyzers/bag_holder_rescue.py` (MODIFY — do not rewrite)

### Required Changes

1. Import the 4 new modules
2. In `analyze_clinic()`, after existing logic, add:
   ```python
   # Module #4: Loss Attribution
   loss_attr = attribute_loss(ticker, loss_pct, stock_data, market_regime, index_change, price_history)

   # Module #5: Classification
   classification, class_reason = classify_position(fundamental_score, loss_attr, market_regime, current_price, pe_ratio)

   # Module #6: Averaging Grid (only if classification == A or B)
   averaging_grid = {}
   if classification in [StockClassification.A, StockClassification.B]:
       averaging_grid = simulate_averaging_grid(current_shares, current_avg, current_price)

   # Module #7: Liquidity Allocation (portfolio-level, called once)
   # — called from analyze_portfolio_clinic, not per-stock

   # Module #8: Monitoring Plan
   monitoring = build_monitoring_plan([position_analysis], market_regime)
   ```
3. Add new fields to the returned dict:
   ```python
   return {
       ...existing fields...,
       "loss_attribution": loss_attr.__dict__,
       "classification": classification.value,
       "classification_reason_ar": class_reason,
       "averaging_grid": {k: v.__dict__ for k, v in averaging_grid.items()},
       "monitoring_plan": monitoring.__dict__,
   }
   ```

### For `analyze_portfolio_clinic()` (batch):
- Call `allocate_liquidity()` once with all positions
- Include `liquidity_allocation` in the portfolio-level response

---

## 9. Required Deliverables

### New Files (5 Python modules):
1. `vps-service/analyzers/loss_attribution.py`
2. `vps-service/analyzers/rescue_classifier.py`
3. `vps-service/analyzers/averaging_simulator.py`
4. `vps-service/analyzers/liquidity_allocator.py`
5. `vps-service/analyzers/monitoring_plan.py`

### Modified Files:
1. `vps-service/analyzers/bag_holder_rescue.py` — wire new modules into `analyze_clinic()` + `analyze_portfolio_clinic()`

### Test Files:
1. `vps-service/tests/test_loss_attribution.py` — T01-T07
2. `vps-service/tests/test_rescue_classifier.py` — T01-T07
3. `vps-service/tests/test_averaging_simulator.py` — T01-T07
4. `vps-service/tests/test_liquidity_allocator.py` — T01-T06
5. `vps-service/tests/test_monitoring_plan.py` — T01-T04

### Documentation:
1. `Documentation/BRAVO-RESCUE-BACKEND-IMPLEMENTATION-REPORT.md`:
   - What was built
   - File list + LOC
   - Test results (actual commands + outputs)
   - Integration points
   - Known limitations
   - Confirmation: NO production writes, NO deployment

---

## 10. Acceptance Criteria

| # | Criterion | Required |
|---|-----------|----------|
| 1 | 5 new Python modules created | ✅ |
| 2 | `bag_holder_rescue.py` wired to new modules | ✅ |
| 3 | All 31 tests (T01-T07 × 5 files, some have fewer) executed | ✅ |
| 4 | Test results documented with actual output | ✅ |
| 5 | No fabrication (null/INSUFFICIENT_DATA when data missing) | ✅ |
| 6 | No hardcoded entry*multiplier | ✅ |
| 7 | `maestro_orchestrator.py` untouched | ✅ |
| 8 | No production DB writes | ✅ |
| 9 | Branch `bravo/rescue-backend-modules` (NOT main) | ✅ |
| 10 | Implementation report on GitHub | ✅ |

---

## 11. Final Handoff Format

عند الانتهاء، سلّم:

1. **الحكم:** `COMPLETE` أو `INCOMPLETE — DO NOT MERGE`
2. **Branch:** `bravo/rescue-backend-modules` + commit SHA
3. **قائمة الملفات:** كل ملف جديد/معدّل + السبب
4. **نتائج الاختبارات:** لكل test file، الأمر الفعلي + exit code + ملخص pass/fail
5. **أدلة الـ integration:** screenshot/snippet من `analyze_clinic()` output فيه الـ fields الجديدة
6. **المخاطر المتبقية:** أي حاجة مش متغطّية
7. **تأكيد صريح:** "No production writes. No deployment. Branch isolated."

---

## 12. Do NOT

- ❌ تعتبر المهمة خلصت لمجرد إن الكود اتكتب
- ❌ تعتبر test ناجح لمجرد إنه اتعمل import
- ❌ تخترع بيانات لو الـ input ناقص — رجّع `null` أو `INSUFFICIENT_DATA`
- ❌ تستخدم hardcoded multipliers (entry*0.97, entry*1.05, etc.)
- ❌ تعدّل `maestro_orchestrator.py`
- ❌ تـ merge لـ main
- ❌ تنشر على الإنتاج

---

**ابدأ التنفيذ الآن. سلّم الحزمة الكاملة بعد إنهاء كل العمل. لا تقارير مرحلية. لا تدمج ولا تنشر.**

---

*Reference: Framework provided by owner (Mohsen) — "العقل الجهنمي" rescue framework, 10 sections.*
