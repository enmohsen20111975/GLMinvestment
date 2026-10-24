# 📋 تقرير Phase 0 + Phase 1 (معدّل v3) — V38 Orchestrator Design

**برافو (Backend Lead)** · **التاريخ:** 2026-10-24 · **الإصدار:** 3.0 (بعد المراجعة الثانية لمحسن)
**الحالة:** مستني النسخة المحدثة من price_history.db + الموافقة النهائية

---

## 📌 ملخص التعديلات (3 ثقوب جديدة فوق v2)

| # | التعديل | السبب |
|---|---|---|
| 🔴 6 | `regime_filter`: hard gate → **soft score** | hard gate بيرفض 49% من الأيام → رجوع لمشكلة V38 (0 إشارات في Bear) |
| 🔴 7 | `whale_guard`: soft → **hard gate** | التصريف = veto أخلاقي. مينفعش ندخل والحيتان بتبيع |
| 🔴 8 | إضافة `no regression` clause في KEEP | يمنع "trade-off features" (تحسن PF وتضر WR) |
| ⏳ 9 | Holdout: انتظار نسخة محدثة من السيرفر | 17 يوم (May18-Jun10) غير كافي علمياً. لو وصلت → Jul-Oct = 88 يوم |

---

## 📊 PHASE 0 — Inventory (محدّث)

### فحص البيانات — Data Quality شهري (كما في v2)

| Month | Tickers | Rows | Days | Gaps% | OK |
|---|---|---|---|---|---|
| Jan 2026 | 750 | 15,750 | 21 | 0.0% | ✅ |
| Feb 2026 | 750 | 15,000 | 20 | 0.0% | ✅ |
| Mar 2026 | 750 | 17,250 | 23 | 0.0% | ✅ |
| Apr 2026 | 750 | 16,500 | 22 | 0.0% | ✅ |
| May 2026 | 750 | 15,750 | 21 | 0.0% | ✅ |
| Jun 2026 | 762 | 3,074 | 7 | 42.4% | ⚠️ PARTIAL |

### 🔬 فحص تجريبي: سلوك `regime_filter` على 2026 (إثبات للتعديل 6)

شغّلت `passes_regime_filter(closes, mode='A')` على 50 ticker × Q1+Q2 2026 = **3,032 يوم**:

| الناتج | Count | % |
|---|---|---|
| PASS (bullish) | 1,540 | **50.8%** |
| REJECT (bearish) | 1,492 | 49.2% |

**الاستنتاج:** لو `regime_filter` hard gate → بنقطع ~نصف الإشارات المحتملة. مش بنعمل veto كامل، بس بنـ bias بقوة نحو bullish days. ده ممكن يكسر الـ strategy في bear market.

**التعديل المعتمد:** `regime_filter` يبقى **soft score** (وزن 0.20) — في Bull: score عالي، في Bear: score أقل، بس مش veto.

### التقسيم المعتمد — scenario-based

#### 🔵 السيناريو A (مفضل): النسخة المحدثة توصل

| Set | الفترة | Days | Tickers | الاستخدام |
|---|---|---|---|---|
| **DEV** | Jan–Mar 2026 (Q1) | 64 | 750 | ✅ ablation كله |
| **VAL** | Apr–Jun 2026 (Q2 كامل) | 49 | 750 | ✅ تأكيد features |
| **HOLDOUT** | Jul–Oct 2026 (Q3+Q4) | ~88 | 750+ | 🔒 مقفول، مرة واحدة |

**الشرط:** محسن يرفع نسخة محدثة من `price_history.db` على GitHub Releases (يحتوي على بيانات لحد أكتوبر 2026).

#### 🟡 السيناريو B (احتياطي): النسخة ما وصلتش

| Set | الفترة | Trading Days | Calendar Days | الاستخدام |
|---|---|---|---|---|
| **DEV** | Jan 1 – Feb 28 | 41 | 59 | ✅ ablation كله |
| **VAL** | Mar 1 – Apr 30 | 45 | 61 | ✅ تأكيد features |
| **HOLDOUT** | May 1 – Jun 10 | 28 | 41 | 🔒 مقفول، مرة واحدة |

**ملاحظة:** السيناريو B أضعف علمياً (28 يوم تداول holdout)، لكن أفضل من 17 يوم الأصلية.

**التزام برافو:** في كلتا الحالتين، الـ universe = **250 tickers مستمرة في كل periods** (gaps → 0%).

### جرد الـ 10 Features (كما في v2 — بدون تعديل)

الـ 8 entry features + exit_logic + rr_gate مدموج في `risk`.

---

## 📐 PHASE 1 — Design Proposal (معدّل v3)

### 1. هيكل الـ Orchestrator (كما في v2)

```
vps-service/camp/
├── __init__.py              # موجود
├── orchestrator.py          # ~600-800 LOC (types + 8 adapters + combiner + logger)
└── ablation_runner.py       # ~200 LOC (loop + monthly aggregation + report)
```

### 2. Baselines المعتمدة (كما في v2)

| Exp | Configuration | الهدف |
|---|---|---|
| Exp_0 | بدون features | baseline أصلي |
| Exp_1 | liquidity + risk (ATR) | الـ floor المنطقي |
| Exp_2 → Exp_8 | إضافة features تدريجياً | ablation |
| Exp_9 | strict_entry → hard (لو KEEP) | ترقية مشروطة |
| **Exp_V38** | V38 الأصلي | **مرجع نهائي للمقارنة** |

### 3. Combination Logic — Hybrid (معدّل بالتعديلات 6 + 7)

```python
# HARD GATES (binary PASS/FAIL — لازم كلهم PASS)
# تعديل: regime شيلناه من هنا (بقى soft)
# تعديل: whale_guard أضفناه هنا (veto أخلاقي)
hard_gates = [
    'liquidity_filter',     # stock tradeable + volume ok
    'whale_guard',          # 🔴 جديد — كشف التصريف = veto فوري
    'news_stop_filter',     # no negative disclosure (لو متاح)
]

# SOFT SCORES (0..1 — equal weight 0.20 — overfitting-safe)
# تعديل: regime أضفناه هنا (مش hard بعد كده)
# تعديل: whale_guard شيلناه من هنا (بقى hard)
soft_scores = {
    'regime':         0.20,  # 🔴 من hard لـ soft
    'fundamentals':   0.20,
    'sector_heat':    0.20,
    'risk':           0.20,  # ATR + RR مدموجين
    'strict_entry':   0.20,  # soft الأول (Exp_4)، نرقّي لـ hard في Exp_9 لو KEEP
}

# DECISION:
# BUY if all hard_gates PASS AND composite_score >= 0.6
# WAIT otherwise
```

**المنطق:**
- `whale_guard` hard gate = **رفض فوري لو في distribution** (حتى لو fundamentals قوية). ده منطق أخلاقي (Rule 27).
- `regime` soft score = في Bull: score عالي. في Bear: score أقل بس مش veto. الـ strategy يقدر يدخل في Bear لو باقي features قوية.
- `liquidity_filter` + `news_stop_filter` = الحد الأدنى من الحماية (tradeable + لا أخبار سلبية).

### 4. معايير القبول/الرفض (معدّل بالتعديل 8 — no regression)

```
KEEP if (ANY من التلاتة) AND **no regression**:

  (PF improves by >= +0.10) AND (signals drop <= 40%)
  OR
  (DD improves by >= 20%) AND (PF drops <= 0.05)
  OR
  (WR improves by >= +3%)  AND (signals drop <= 30%)

  + **no regression**: مفيش تدهور > 2% في أي مقياس تاني
    (مثلاً: PF +0.12 بس WR -5% → REJECT، لأنها كسبت PF وخسرت WR)

NEUTRAL if:
  PF delta within ±0.05 AND DD delta within ±2%
  → يفضل بـ weight=0 (مش بنحذفه، بس مش بنفعله)

REJECT if (ANY):
  signals drop > 40% من baseline (بدون PF/DD مكسب)
  OR PF drops > 0.10
  OR يسبب 0 signals في أي شهر من Dev
  OR regression > 2% في أي مقياس تاني (مثلاً WR drops 5% مع PF +0.12)
```

**الـ "no regression" clause** بيمنع "trade-off features" اللي بتحسن مقياس وتضر تاني. ده يحمي الـ orchestrator من الـ false positives.

### 5. ترتيب الـ Ablation النهائي (معدّل)

| Step | Exp | Features المضافة | ليه الترتيب ده؟ |
|---|---|---|---|
| 1 | Exp_0 | (بدون features) | baseline أصلي |
| 2 | Exp_1 | liquidity + risk | الـ floor المنطقي |
| 3 | Exp_2 | + regime (soft) | أول feature — بس مش veto |
| 4 | Exp_3 | + whale_guard (hard) | veto أخلاقي ضد التصريف |
| 5 | Exp_4 | + strict_entry (soft) | soft الأول |
| 6 | Exp_5 | + sector_heat | momentum |
| 7 | Exp_6 | + fundamentals | جودة |
| 8 | Exp_7 | + news_stop_filter | news protection |
| 9 | Exp_8 | + exit_logic | exits |
| 10 | Exp_9 | strict_entry → hard (لو Exp_4 KEEP) | ترقية مشروطة |
| 11 | **Exp_V38** | V38 الأصلي | **مرجع نهائي للمقارنة** |

### 6. تفاصيل شهرية (كما في v2)

كل Exp لازم يطلع Jan/Feb/Mar تفصيلي + Devil's Advocate (3 أسباب).

### 7. القواعد الدستورية المحفوظة

- ✅ **Rule 4:** ملفين فقط (`orchestrator.py` + `ablation_runner.py`)
- ✅ **Rule 5:** كل كود يتربط ويُستخدم
- ✅ **Rule 16:** VERIFY-BEFORE-DELETE
- ✅ **Rule 25:** ممنوع تعديل ملفات موجودة
- ✅ **Rule 27:** NO-FAKE-DATA (whale_guard hard gate = منطق أخلاقي)
- ✅ **Rule 67:** CALCULATION-CANONICAL
- ✅ **Rule 75:** Push بعد كل مهمة
- ✅ **Rule 76:** `git pull --rebase` قبل البدء

---

## 🤔 طلب الخاص — رد برافو على 3 ثقوب

### ثقب 1: البيانات الأحدث (حرج — يحتاج قرار محسن)
**محسن حيحاول يرفع نسخة محدثة من price_history.db على GitHub Releases.**

**التزام برافو:**
- أنتظر إشعار محسن برابط النسخة الجديدة.
- لما النسخة توصل: `git pull --rebase` → استخراج الـ DB → Data Quality recheck → تأكيد Jul-Oct 2026 موجودة → ابعت الجدول المعدل قبل أي كود.
- لو النسخة ما وصلتش في خلال 24 ساعة: نمشي **السيناريو B** (60/60/41 calendar days split).

### ثقب 2: regime_filter كـ hard gate
**موافق** — شغّلت اختبار عملي على 50 ticker × Q1+Q2 2026:
- 50.8% PASS (bullish) / 49.2% REJECT (bearish).
- لو hard gate → بنقطع نصف الإشارات → رجوع لمشكلة V38.
- `regime_filter` بقى **soft score** (وزن 0.20).

### ثقب 3: whale_guard كـ soft score
**موافق** — كشف التصريف = veto أخلاقي. `whale_guard` بقى **hard gate**.
- لو `compute_whale_flow` رجع `net_flow_egp < 0` (distribution) → **رفض فوري**.
- ده مش "تحفظ" — ده منطق أخلاقي (Rule 27 مش بنخدع العميل).

### إضافة: no-regression clause
**موافق** — أضفته في معايير KEEP. بمنع "trade-off features" اللي بتحسن مقياس وتضر تاني.

---

## 📤 خطوات ما بعد وصول النسخة المحدثة

```text
1. git pull --rebase origin main  (Rule 76)
2. تحميل db_backup الجديد من GitHub Release الجديد
3. استخراج الـ DBs (cat .part files + unzip)
4. تشغيل Data Quality recheck على price_history.db الجديد
5. تأكيد Jul-Oct 2026 موجودة (88+ يوم تداول)
6. ابعت الجدول المعدل على محسن قبل أي كود
7. لما محسن يوافق → ابدأ Phase 2 (إنشاء orchestrator.py + ablation_runner.py)
8. تشغيل Exp_0 + Exp_1 (baselines)
9. تقرير النتايج قبل أي Exp تاني
```

---

## 📤 DECISION (مطلوب من محسن — النسخة النهائية v3)

**برافو وقّف. مستني:**

### (أ) الموافقة على النسخة v3 النهائية
- [ ] `regime_filter` soft (مش hard)
- [ ] `whale_guard` hard (مش soft)
- [ ] `no-regression` clause في معايير KEEP
- [ ] باقي التصميم من v2 مقبول كما هو

### (ب) النسخة المحدثة من price_history.db
- [ ] محسن حيحاول يرفعها على GitHub Releases
- [ ] برافو ينتظر الإشعار، ولو ما وصلتش في 24 ساعة → السيناريو B (60/60/41)

### (ج) استثناء Rule 4
- [ ] ملفين فقط: `camp/orchestrator.py` + `camp/ablation_runner.py`

### (د) الـ DBs على GitHub Releases
- ✅ **تم** — snapshot 2026-10-21 متاح (16 asset، 306MB)

---

**⏱️ مفيش كود قبل:**
1. وصول النسخة المحدثة من price_history.db، أو انتهاء الـ 24 ساعة بدونها
2. الموافقة النهائية على v3

**التقرير الكامل في:** `scripts/camp/reports/ORCHESTRATOR-PHASE0-PHASE1-v3.md`

*برافو — Backend Lead · مستني إشعار محسن*
