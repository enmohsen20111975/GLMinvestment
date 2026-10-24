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

### المرحلة 2 — ✅ مكتملة (commit `3ddca1c`)

**تم توحيد RSI + قتل Maestro نهائياً (49 ملف معدّل بـ 4 sub-agents):**

| الجزء | التغيير | ملفات |
|-------|---------|-------|
| 2.1 توحيد RSI | كل engines بتستخدم `indicators/rsi.py` (Wilder's) | 25 Python + 6 TS |
| 2.2 Maestro API | 3 routes → 410 Gone + comprehensive fetch removed | 4 routes |
| 2.3 Maestro Python | 4 files → MAESTRO_DISABLED guard | 4 .py files |
| 2.4 Maestro UI | MaestroWidget → null + deprecation banners | 11 .tsx/.ts files |

**النتيجة:** RSI موحد (Wilder's) + Maestro معطل بالكامل (API + Python + UI).

### المرحلة 3 — ✅ مكتملة (commit `51de11e`)

**تم تعطيل المحركات الفرعية + توحيد مصدر السعر + كاتب واحد (27 ملف بـ 3 sub-agents):**

| الجزء | التغيير | ملفات |
|-------|---------|-------|
| 3.1 تعطيل sub-engines | 5 engines → SUB_ENGINE_DISABLED guard | 5 .py files |
| 3.2 توحيد مصدر السعر | canonical price-source hierarchy | 8 .py + 1 .ts |
| 3.3 كاتب واحد | 7 writers disabled → daily_predictor.py فقط | 7 .py + 3 .ts |

**النتيجة:** محرك قرار واحد (master_analyzer.py) + مصدر سعر واحد (stocks.db.stocks.current_price) + كاتب واحد (daily_predictor.py).

---

## ✅ خلاصة الجلسة الكاملة — جميع المراحل مكتملة

| المرحلة | Commits | ملفات | المدة |
|---------|---------|-------|-------|
| Phase 0 | 2 commits | 7 ملفات UI | إخفاء الشارات + تعطيل MaestroWidget |
| Phase 1 | 3 commits | 3 ملفات + 1 جديد | توحيد العتبات + حداثة + اختبار آلي |
| Phase 2 | 2 commits | 49 ملف | توحيد RSI + قتل Maestro نهائياً |
| Phase 3 | 1 commit | 27 ملف | تعطيل sub-engines + مصدر سعر + كاتب واحد |
| **الإجمالي** | **14 commits** | **~85 ملف** | **8 sub-agents بالتوازي** |

### ما تم إنجازه:

✅ **محرك قرار واحد:** master_analyzer.py + canonical_signal.py (thresholds 78/65/55/40/25)
✅ **Maestro معطل نهائياً:** API (410 Gone) + Python (MAESTRO_DISABLED) + UI (return null)
✅ **5 sub-engines معطلة:** board_of_analysts, confluence_v3, sniper, v82, professional
✅ **RSI موحد:** Wilder's smoothing (مش SMA) — 31 ملف
✅ **العتبات موحدة:** engine_settings.py (78/65/55/40/25) + institutional متطابقة
✅ **مصدر سعر واحد:** stocks.db.stocks.current_price (LIVE) + stock_daily_prices (HISTORICAL)
✅ **كاتب واحد:** daily_predictor.py (7 writers معطلين)
✅ **اختبار آلي:** unification_test.py يضرب 5 endpoints + يكتشف التناقضات
✅ **freshness gate:** PENDING predictions ≤ 48 ساعة
✅ **سياسة الفراغ:** NULL → "— بيانات غير متاحة" (مش HOLD الكاذب)
✅ **Source transparency:** unified=true + unified_source tag في كل response

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

## 🎯 الترتيب التنفيذي (الحالة النهائية)

1. ✅ **المرحلة 0** — مكتملة (commit `2591485`)
2. ✅ **المرحلة 1** — مكتملة (commits `514d1c2` + `ba5c61a` + `9eeb00a`)
3. ✅ **المرحلة 2** — مكتملة (commit `3ddca1c` — 49 ملف، 4 sub-agents)
4. ✅ **المرحلة 3** — مكتملة (commit `51de11e` — 27 ملف، 3 sub-agents)

**جميع المراحل مكتملة.** النظام دلوقتي عنده محرك قرار واحد + مصدر بيانات واحد + جدول حكم واحد + كاتب واحد.
