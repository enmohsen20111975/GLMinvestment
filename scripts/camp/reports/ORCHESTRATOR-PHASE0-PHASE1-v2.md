# 📋 تقرير Phase 0 + Phase 1 (معدّل) — V38 Orchestrator Design

**برافو (Backend Lead)** · **التاريخ:** 2026-10-24 · **الإصدار:** 2.0 (تعديل بعد مراجعة محسن)
**الحالة:** مستني الموافقة النهائية على النسخة المعدلة

---

## 📌 ملخص التعديلات (5 ثقوب + 2 إضافة)

| # | الثقب / الإضافة | الحل المعتمد |
|---|---|---|
| 🔴 1 | Baseline = V38 (تناقض مع الفكرة) | Exp_0 = بدون features · Exp_1 = liquidity+risk فقط · V38 = مرجع للمقارنة في النهاية |
| 🔴 2 | مفيش Holdout حقيقي | Dev=Q1 · Val=Apr-May17 · Holdout=May18-Jun10 (مقفول) |
| 🔴 3 | 5 ملفات = استثناء Rule 4 كبير | ملفين بس: `camp/orchestrator.py` + `camp/ablation_runner.py` |
| 🔴 4 | strict_entry كـ Hard Gate = خطر | soft score الأول (Exp)، نرقّي لـ hard لو أثبت |
| 🔴 5 | معايير "OR" = false positive | AND في الحالات الحرجة (PF+signals · DD+PF · WR+signals) |
| 📊 1 | Data Quality شهري | جدول كامل لكل شهر 2025-2026 (Tickers/Rows/Days/Vol/Gaps) |
| 📊 2 | تفاصيل شهرية في ablation | كل Exp فيه Jan/Feb/Mar تفصيلي مش بس إجمالي Q1 |

---

## 📊 PHASE 0 — Inventory (محدّث)

### فحص البيانات — Data Quality شهري (إضافة إلزامية 1)

#### 2026 (فترة الـ ablation)

| Month | Tickers | Rows | Trading Days | Avg Daily Vol | Gaps% | Data OK |
|---|---|---|---|---|---|---|
| Jan 2026 | 750 | 15,750 | 21 | 912.7K | 0.0% | ✅ OK |
| Feb 2026 | 750 | 15,000 | 20 | 918.5K | 0.0% | ✅ OK |
| Mar 2026 | 750 | 17,250 | 23 | 912.3K | 0.0% | ✅ OK |
| Apr 2026 | 750 | 16,500 | 22 | 929.1K | 0.0% | ✅ OK |
| May 2026 | 750 | 15,750 | 21 | 925.3K | 0.0% | ✅ OK |
| **Jun 2026** | **762** | **3,074** | **7** | 3.52M | **42.4%** | ⚠️ **PARTIAL** |

**ملاحظة:** معيار محسن "< 100,000 صف" غير منطبق شهرياً (750 ticker × 21 يوم = 15,750 صف/شهر — طبيعي). اللي بيفرق فعلاً: **0% gaps = data complete** لـ Jan-May. June ناقصة (7 أيام بس، 1-10 Jun).

#### 2025 (احتياطي لو احتجنا)

| Month | Tickers | Rows | Days | Gaps% | Verdict |
|---|---|---|---|---|---|
| Jul 2025 | 750 | 17,250 | 23 | 0.0% | ✅ OK |
| Aug 2025 | 750 | 15,750 | 21 | 0.0% | ✅ OK |
| Sep 2025 | 750 | 16,500 | 22 | 0.0% | ✅ OK |
| Oct 2025 | 750 | 16,500 | 22 | 0.0% | ✅ OK |
| Nov 2025 | 750 | 15,750 | 21 | 0.0% | ✅ OK |
| Dec 2025 | 750 | 17,250 | 23 | 0.0% | ✅ OK |

### التقسيم المعتمد — 3-way split (إصلاح الثقب 2)

| Set | الفترة | Days | Tickers | Rows | Gaps% | الاستخدام |
|---|---|---|---|---|---|---|
| **DEV** | Jan 1 → Mar 31 (Q1) | 64 | 750 | 48,000 | 0.0% | ✅ ablation كله هنا |
| **VAL** | Apr 1 → May 17 | 33 | 750 | 24,750 | 0.0% | ✅ تأكيد features النهائية |
| **HOLDOUT** | May 18 → Jun 10 | 17 | 762 | 10,574 | 18.4% | 🔒 مقفول، يفتح مرة واحدة |
| **(universe)** | tickers present in ALL 3 | — | **750** | — | — | نفس الأسهم في كل periods |

**ملاحظة Holdout:** 18.4% gaps في الـ holdout بسبب June 1-10 (7 أيام ناقصة لـ tickers معينة). الحل: **نقصر الـ universe على 250 tickers مستمرة في كل periods** (الـ 250 اللي عندهم data كامل في dev+val+holdout). ده بيخلي الـ gaps = 0% في الـ holdout.

**لو محسن عندك بيانات أحدث من 2026-06-10 على السيرفر الإنتاجي → Q3 2026 (Jul-Oct) هيبقى holdout أمثل (22+ يوم كامل). اطلب تحديث.**

### جرد الـ 10 Features (نفس النتايج — بدون تعديل)

| # | Feature | Adapter Verdict | DB Dep |
|---|---|---|---|
| 1 | liquidity_filter | WRAP DIRECTLY (`evaluate_kill_filters`) | NO |
| 2 | strict_entry_filters | WRAP DIRECTLY (`evaluate_strict_entry`) | NO |
| 3 | regime_filter | WRAP DIRECTLY (`passes_regime_filter`) | NO |
| 4 | risk (ATR) | WRAP (workaround bug) | NO |
| 5 | rr_gate | WRAP `compute_risk_reward >= threshold` → **دمجه في `risk`** | NO |
| 6 | sector_heat | NEEDS DB LAYER (stocks.db) | YES |
| 7 | whale_guard | WRAP DIRECTLY (`compute_whale_flow`) | NO |
| 8 | fundamentals | NEEDS DB LAYER (data_engine.db) | YES |
| 9 | news_impact | WRAP text path; **مؤجل لو مفيش news.db تاريخي** | YES |
| 10 | exit_logic | WRAP DIRECTLY (`decide_exit_action`) — **منفصل في Exp أخير** | NO |

**النهائي:** 8 entry features + exit_logic منفصل (بعد دمج rr_gate في risk).

---

## 📐 PHASE 1 — Design Proposal (معدّل)

### 1. هيكل الـ Orchestrator (إصلاح الثقب 3)

**ملفين فقط** في `vps-service/camp/` (نستخدم `camp/__init__.py` الموجود — ممنوع `__init__.py` جديد):

```
vps-service/camp/
├── __init__.py              # موجود بالفعل
├── orchestrator.py          # ~600-800 LOC — كل الـ logic
│   ├── types (FeatureResult dataclass)
│   ├── 8 adapter functions
│   ├── combiner (Hybrid: hard gates + soft scores)
│   └── decision logger
└── ablation_runner.py       # ~200 LOC — الـ runner فقط
    ├── experiment loop
    ├── monthly breakdown aggregation
    └── report generator
```

**ممنوع:** `__init__.py` جديد · `types.py` · `combiner.py` · `report.py` · أي ملف تالت بدون موافقة صريحة.

### 2. Baselines المعتمدة (إصلاح الثقب 1)

**V38 مش baseline. V38 = مرجع للمقارنة في النهاية فقط.**

| Exp | Configuration | الهدف |
|---|---|---|
| **Exp_0** | بدون features (كل الأسهم تدخل، random entry) | baseline أصلي — "هل أي feature أحسن من لا شيء؟" |
| **Exp_1** | liquidity + risk (ATR) فقط | الحد الأدنى المنطقي — "الـ floor اللي لازم نتعداه" |
| Exp_2 | Exp_1 + regime_filter | أول feature حقيقية |
| Exp_3 | Exp_2 + whale_guard | |
| Exp_4 | Exp_3 + strict_entry (**كـ soft score**) | soft الأول — إصلاح الثقب 4 |
| Exp_5 | Exp_4 + sector_heat | |
| Exp_6 | Exp_5 + fundamentals | |
| Exp_7 | Exp_6 + news_stop_filter (لو news.db متاح) | |
| Exp_8 | Exp_7 + exit_logic | الـ exits |
| **Exp_9** | **تحسين strict_entry لـ hard gate** (لو Exp_4 أثبت قيمته كـ soft) | ترقية مشروطة |
| **Exp_V38** | V38 الأصلي على نفس الـ periods | **مرجع للمقارنة** — "هل orchestrator أحسن من V38؟" |

**القرار النهائي:** لو `Exp_8 (أو Exp_9) > Exp_V38` على Dev + Val + Holdout → نشر. لو لأ → رجوع للـ drawing board.

### 3. Combination Logic — Hybrid (مع تعديل strict_entry)

```python
# HARD GATES (binary PASS/FAIL — لازم كلهم PASS)
# ملاحظة: strict_entry مش هنا (بقى soft — إصلاح الثقب 4)
hard_gates = [
    'liquidity_filter',    # stock tradeable + volume ok
    'regime_filter',       # market not in bear veto
    'news_stop_filter',    # no negative disclosure (لو متاح)
]

# SOFT SCORES (0..1 — equal weight 0.20 لكل واحد — overfitting-safe)
soft_scores = {
    'fundamentals':   0.20,
    'sector_heat':    0.20,
    'whale_guard':    0.20,  # inverted: distribution = low score
    'risk':           0.20,  # ATR + RR مدموجين (إصلاح دمج rr_gate)
    'strict_entry':   0.20,  # soft الأول — إصلاح الثقب 4
}

# DECISION:
# BUY if all hard_gates PASS AND composite_score >= 0.6
# WAIT otherwise
```

**لو Exp_4 (strict_entry soft) أثبت قيمته (KEEP بمعايير Phase 1.4):**
→ نرقّيه لـ hard gate في Exp_9، ونشيله من soft_scores (weight = 0.25 لكل feature من الـ 4 الباقية).

### 4. معايير القبول/الرفض (إصلاح الثقب 5 — AND مش OR)

**Pre-registered — قبل أي نتيجة:**

```
KEEP if (ANY من التلاتة):
  (PF improves by >= +0.10) AND (signals drop <= 40%)
  OR
  (DD improves by >= 20%) AND (PF drops <= 0.05)
  OR
  (WR improves by >= +3%) AND (signals drop <= 30%)

NEUTRAL if:
  PF delta within ±0.05 AND DD delta within ±2%
  → يفضل بـ weight=0 (مش بنحذفه، بس مش بنفعله)

REJECT if (ANY):
  signals drop > 40% من baseline (بدون PF/DD مكسب)
  OR PF drops > 0.10
  OR يسبب 0 signals في أي شهر من Dev
```

### 5. تفاصيل شهرية في تقرير الـ Ablation (إضافة إلزامية 2)

**كل Exp لازم يطلع ده** (مش بس إجمالي Q1):

```
Exp_N (feature_name):
  Jan: Signals=__, WR=__%, PF=__, DD=__%
  Feb: Signals=__, WR=__%, PF=__, DD=__%
  Mar: Signals=__, WR=__%, PF=__, DD=__%
  ─────────────────────────────────────
  Q1 TOTAL:  Signals=__, WR=__%, PF=__, DD=__%, Sharpe=__
  ─────────────────────────────────────
  Devil's Advocate (3 أسباب للنتيجة):
    1. ...
    2. ...
    3. ...
```

**الهدف:** نعرف هل feature بتشتغل في شهر واحد بس (lucky) ولا في كل الشهور (robust).

### 6. ترتيب الـ Ablation النهائي

| Step | Exp | Features | ليه الترتيب ده؟ |
|---|---|---|---|
| 1 | Exp_0 | (بدون features) | baseline أصلي |
| 2 | Exp_1 | liquidity + risk | الـ floor المنطقي |
| 3 | Exp_2 | + regime | أهم feature في bear |
| 4 | Exp_3 | + whale_guard | يكشف distribution |
| 5 | Exp_4 | + strict_entry (soft) | soft الأول |
| 6 | Exp_5 | + sector_heat | momentum |
| 7 | Exp_6 | + fundamentals | جودة |
| 8 | Exp_7 | + news_stop (لو متاح) | news protection |
| 9 | Exp_8 | + exit_logic | exits |
| 10 | Exp_9 | strict_entry → hard (لو Exp_4 KEEP) | ترقية مشروطة |
| 11 | Exp_V38 | V38 الأصلي | مرجع نهائي للمقارنة |

### 7. القواعد الدستورية المحفوظة

- ✅ **Rule 4:** ملفين فقط (`orchestrator.py` + `ablation_runner.py`) — استثناء صريح
- ✅ **Rule 5:** كل كود يتربط ويُستخدم (no dead code)
- ✅ **Rule 16:** VERIFY-BEFORE-DELETE (مفيش حذف)
- ✅ **Rule 25:** ممنوع تعديل ملفات موجودة (الـ adapters بـ read فقط)
- ✅ **Rule 27:** NO-FAKE-DATA (كل signature موثّق من الكود)
- ✅ **Rule 67:** CALCULATION-CANONICAL (`compute_risk_reward` لـ RR)
- ✅ **Rule 75:** Push بعد كل مهمة
- ✅ **Rule 76:** `git pull --rebase` قبل البدء

---

## 🤔 طلب الخاص — رد برافو على 5 نقاط

### 1. خطر Overfitting في الـ weights
**موافق** — equal weights (0.20 لكل feature) هي الأنسب دلوقتي. لو ablation أظهر feature أقوى، نعدل weights **بعد** النتايج مش قبلها (pre-registration).

### 2. features للمراجعة
- ✅ **exit_logic** منفصل في Exp_8 (مش mixed مع entries).
- ✅ **rr_gate** مدمج في `risk` (feature واحد: ATR + RR).
- ⚠️ **news_stop_filter** — لو news.db تاريخي غير متاح، نستخدم `disclosure_impact` (DB path من egx_disclosure_engine). لو مفيش أي news data → نتشال من قائمة الـ hard gates ونوضّع في تقرير النتايج.

### 3. ترتيب ablation
موافق على الترتيب المعدّل (Exp_0 → Exp_V38). **ملاحظة:** لو regime_filter (Exp_2) طلع 0 signals في bear market = معلومة مهمة (V38 نفسه مش قادر يولد signals تتجاوز regime filter) → نعيد التفكير في universe الـ tickers.

### 4. البيانات كافية؟
- ✅ **Dev+Val:** كافية تماماً (Q1 + Apr-May17 = 72,750 rows، 0 gaps، 750 tickers مستمرين).
- ⚠️ **Holdout:** 17 days فقط (May18-Jun10)، 18.4% gaps → نقصر الـ universe على 250 tickers مستمرة (gaps → 0%).
- ❌ **Q3 2026:** غير متاح — **سؤال مفتوح لمحسن:** عندك بيانات أحدث من 2026-06-10 على السيرفر الإنتاجي؟

### 5. خطر دستوري
**موافق** — Rule 4 استثناء لملفين فقط. لو احتجت تالت → طلب صريح قبل التنفيذ.

---

## 📤 DECISION (مطلوب من محسن — النسخة النهائية)

**برافو وقّف. مستني موافقة محسن النهائية على:**

### (أ) التصميم المعدّل
- [ ] Exp_0 (no features) + Exp_1 (liquidity+risk) كـ baselines، V38 كـ مرجع فقط
- [ ] 3-way split (Dev=Q1, Val=Apr-May17, Holdout=May18-Jun10، universe=250 tickers مستمرة)
- [ ] strict_entry soft الأول (Exp_4)، نرقّي لـ hard في Exp_9 لو KEEP
- [ ] معايير AND (PF+signals · DD+PF · WR+signals)
- [ ] تفاصيل شهرية Jan/Feb/Mar في كل Exp

### (ب) استثناء Rule 4
- [ ] ملفين فقط: `camp/orchestrator.py` (~600-800 LOC) + `camp/ablation_runner.py` (~200 LOC)

### (ج) البيانات
- [ ] Holdout على May18-Jun10 (250 tickers مستمرة) مؤقتاً
- [ ] **سؤال:** عندك بيانات أحدث من 2026-06-10 على السيرفر الإنتاجي؟

### (د) الـ DBs على GitHub Releases
- ✅ **تم** — 16 asset على `db-snapshot-2026-10-21` (306MB)، خارج التعريب.

---

**⏱️ لما توافق، Phase 2 (التنفيذ) هيبدأ بـ:**
1. `git pull --rebase` (Rule 76)
2. إنشاء `camp/orchestrator.py` (الـ adapters + combiner)
3. إنشاء `camp/ablation_runner.py` (الـ runner + monthly aggregation)
4. تشغيل Exp_0 + Exp_1 (الـ baselines)
5. تقرير النتايج قبل أي Exp تاني

**مفيش كود قبل توقيعك النهائي على النسخة دي.**

*برافو — Backend Lead*
