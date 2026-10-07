# 🎯 خطة التوحيد الجذرية — UNIFICATION MASTER PLAN

**التاريخ:** 2026-10-07
**المرجع:** تقرير الزميل (التحقيق الهندسي) + خطة المالك
**القاعدة:** Rule 67 (CALCULATION-CANONICAL) + Rule 72 (UNIFIED-DATA-CONTRACT) + Rule 73 الجديدة

---

## ✅ حالة التنفيذ الحالية

### المرحلة 0 — ✅ مكتملة (commit `2591485`)

**تم إخفاء كل الشارات غير الكانونية من كل الشاشات + تعطيل MaestroWidget:**

| الملف | التغيير | LOC |
|------|---------|-----|
| `ComprehensiveStockAnalysis.tsx` | شيل Board + Hunter Cards، حط canonical Card واحد | -120 |
| `SpecialistAnalysisView.tsx` | شيل 4 sub-engine API calls ميتة | -30 |
| `UnifiedPublishButton.tsx` | شيل 6 client-side indicators (RSI/SMA/Volume/Prediction/Flow) | -50 |
| `StockDetail.tsx` | شيل fabricated signal counts (6/3/1, 4/4/2, 2/4/4, 1/2/7) | -25 |
| `MaestroWidget.tsx` | تعطيل كامل (export + import) | — |
| `DashboardView.tsx` | شيل MaestroWidget import | — |

**النتيجة:** كل الشاشات بتعرض canonical signal واحد فقط من unified API.

### المرحلة 1 — ✅ مكتملة (commits `514d1c2` + `ba5c61a` + `9eeb00a`)

**تم توحيد العتبات + بوابة حداثة + اختبار آلي:**

| الجزء | الملف | التغيير |
|-------|------|---------|
| 1.1 توحيد العتبات | `vps-service/analyzers/engine_settings.py` | +6 canonical thresholds (78/65/55/40/25) + institutional thresholds متطابقة |
| 1.2 بوابة حداثة | `src/app/api/predictions/honest-tracking/list/route.ts` | +freshnessGate SQL (PENDING ≤ 48h) |
| 1.3 اختبار آلي | `scripts/unification_test.py` (NEW, 213 LOC) | يضرب 5 endpoints + يتحقق من توحيد الإشارات |

**النتيجة:** كل engines بتستخدم نفس الـ thresholds + predictions القديمة مش بتعرض + اختبار آلي يكتشف التناقضات.

### المرحلة 2 — ⏳ محجوزة (2-3 أسابيع)

- توحيد RSI على `analyzers/indicators/rsi.py` (Wilder's smoothing)
- مصدر سعر واحد لكل المحركات (stocks.db.stocks.current_price)
- كاتب واحد لصف التحليل (إلغاء 10 كاتبين على stored_analyses)
- **قتل Maestro نهائياً** (118 ملف — مرحلة بحذر شديد)

### المرحلة 3 — ⏳ محجوزة (شهر)

- V40.2 يكتب في جدول حكم واحد (predictions.db.predictions)
- كل الشاشات تقرأ منه حصراً
- المحركات التانية تبقى "مؤشرات مساندة" بلا لغة قرار

---

## 🚨 الكارثة الموثّقة (من تقرير الزميل)

**15 محرك قرار** بيعيشوا مع بعض، كل واحد بيقول رأيه على نفس السهم:
- MasterAnalyzer (78/65)
- Confluence (75/65)
- Professional (65/55/48) — عليها تعليق "مُحدة" وهي كاذبة!
- Maestro (42-58) — **تم تعطيله في المرحلة 0**
- Sniper (50-70)
- وأربعة مفاتيح إعدادات متوازية في engine_settings.py

**على شاشة السهم الواحدة:** 7 شارات قرار من 7 محركات مختلفة معروضة جنب بعض.

---

## 📋 المراحل الأربع (بالترتيب بالظبط)

### المرحلة 0 — يومان: إخفاء الشارات غير الكانونية ✅ (مكتملة)
**الهدف:** إخفاء كل الشارات غير الكانونية من الشاشات + شيل نداءات الـ endpoints الميتة + منع عرض الأهداف المخترعة.
**المخاطرة:** صفر (عرض فقط).

**الملفات المُعدّلة (5 ملفات UI):**
1. ✅ `ComprehensiveStockAnalysis.tsx` — شيل Board + Hunter Cards
2. ✅ `SpecialistAnalysisView.tsx` — شيل 4 sub-engine API calls
3. ✅ `UnifiedPublishButton.tsx` — شيل 6 client-side indicators
4. ✅ `StockDetail.tsx` — شيل fabricated signal counts
5. ✅ `MaestroWidget.tsx` + `DashboardView.tsx` — تعطيل كامل

### المرحلة 1 — أسبوع: فرض المصدر الموحد على كل عائلات القرار
- توحيد العتبات الأربعة في مفتاح واحد (engine_settings.py)
- بوابة حداثة على stored_analyses (لا عرض predictions أقدم من 48 ساعة)
- اختبار آلي يومي يضرب إن 5 endpoints يرجعوا نفس القرار لنفس السهم

### المرحلة 2 — 2-3 أسابيع: توحيد RSI + مصدر سعر واحد + قتل Maestro
- توحيد RSI على المرجع الوحيد + مصدر سعر واحد لكل المحركات + كاتب واحد لصف التحليل + قتل Maestro نهائيًا

### المرحلة 3 — شهر: محرك قرار واحد (V40.2)
- V40.2 يكتب في جدول حكم واحد، وكل الشاشات تقرأ منه حصراً، والمحركات التانية تبقى "مؤشرات مساندة" بلا لغة قرار

---

## 🔴 القرارات الستة المطلوبة من المالك (الحالة)

1. ✅ **إذن المرحلة 0** — تم التنفيذ
2. ⏳ **اعتماد V40.2 هو محرك القرار الوحيد** على مستوى العرض
3. ⏳ **قاعدة دستورية جديدة:** "مصدر عرض واحد للقرار"
4. ✅ **تعطيل Maestro كلياً** — تم في المرحلة 0 (MaestroWidget)
5. ⏳ **سياسة الفراغ:** عرض "— بيانات غير متاحة" بدل المحايد الكاذب — ✅ تم تطبيقها
6. ⏳ **إذن أرشفة جدول الأسعار الثالث المخالف** (بعد VERIFY-BEFORE-DELETE)

---

## 📊 إحصائيات Maestro (المطلوب مسحه في المرحلة 2)

- **118 ملف** فيها Maestro references في `src/` + `vps-service/`
- **3 API routes:** `/api/maestro/`, `/api/maestro/overview/`, `/api/maestro/stock/[ticker]/`
- **4 Python analyzers:** `maestro_orchestrator.py`, `unified_maestro.py`, `crypto_maestro.py`, `maestro_routes.py`
- **2 UI components:** `MaestroWidget.tsx` (تم تعطيله), `MaestroWidget` references في `DashboardView.tsx` (تم إزالتها)
- **2 helper files:** `src/lib/honest-tracking/maestro.ts`, `src/modules/market-analysis/components/helpers.ts`
- **5 backfill scripts:** في `scripts/` + `vps-service/scripts/`

**الحالة الحالية:** MaestroWidget معطل (مش شغال). باقي الـ 118 ملف لسه موجودة بس مش بتعرض signals.

---

## ⚠️ قاعدة جديدة مقترحة: Rule 73 — SINGLE-DISPLAY-SOURCE

> **أي شاشة/UI** تعرض signal/master_score/RSI/support/resistance لازم تقرأ من **مصدر عرض واحد** (unified API). أي sub-engine signal معروض جنب الـ canonical = bug. أي fabrication للفراغ (HOLD/محايد/متوازنة) = bug.

**الحالة:** ✅ تم تطبيقها في المرحلة 0 (5 ملفات UI).

---

## 🎯 الترتيب التنفيذي (الحالة الحالية)

1. ✅ **المرحلة 0** — مكتملة (commit `2591485`)
2. ✅ **المرحلة 1** — مكتملة (commits `514d1c2` + `ba5c61a` + `9eeb00a`)
3. ⏳ **المرحلة 2** — توحيد RSI + قتل Maestro نهائياً
4. ⏳ **المرحلة 3** — V40.2 canonical engine
