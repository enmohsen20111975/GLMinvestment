# 🎯 خطة التوحيد الجذرية — UNIFICATION MASTER PLAN

**التاريخ:** 2026-10-07
**المرجع:** تقرير الزميل (التحقيق الهندسي) + خطة المالك
**القاعدة:** Rule 67 (CALCULATION-CANONICAL) + Rule 72 (UNIFIED-DATA-CONTRACT) + Rule جديدة

---

## 🚨 الكارثة الموثّقة (من تقرير الزميل)

**15 محرك قرار** بيعيشوا مع بعض، كل واحد بيقول رأيه على نفس السهم:
- MasterAnalyzer (78/65)
- Confluence (75/65)
- Professional (65/55/48) — عليها تعليق "مُوحدة" وهي كاذبة!
- Maestro (42-58) — **مطلوب تعطيله نهائياً**
- Sniper (50-70)
- وأربعة مفاتيح إعدادات متوازية في engine_settings.py

**على شاشة السهم الواحدة:** 7 شارات قرار من 7 محركات مختلفة معروضة جنب بعض.

---

## 📋 المراحل الأربع (بالترتيب بالظبط)

### المرحلة 0 — يومان: إخفاء الشارات غير الكانونية ⚡ (نبدأ فوراً)
**الهدف:** إخفاء كل الشارات غير الكانونية من الشاشات + شيل نداءات الـ endpoints الميتة + منع عرض الأهداف المخترعة.
**المخاطرة:** صفر (عرض فقط).

**الملفات المستهدفة (5-6 ملفات UI):**
1. `src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx` — إخفاء board/maestro/professional badges
2. `src/components/advanced-analysis/SpecialistAnalysisView.tsx` — إخفاء sub-engine signals
3. `src/modules/publishing/components/UnifiedPublishButton.tsx` — إخفاء gauge_score fallback
4. `src/modules/stock-analysis/components/StockDetail.tsx` — إخفاء signal counts المختلقة
5. `src/modules/dashboard/components/MaestroWidget.tsx` — إخفاء أو تعطيل كامل

### المرحلة 1 — أسبوع: فرض المصدر الموحد على كل عائلات القرار
- توحيد العتبات الأربعة في مفتاح واحد (engine_settings.py)
- بوابة حداثة على stored_analyses (لا عرض predictions أقدم من 48 ساعة)
- اختبار آلي يومي يضرب 5 endpoints يرجعوا نفس القرار لنفس السهم

### المرحلة 2 — 2-3 أسابيع: توحيد RSI + مصدر سعر واحد + قتل Maestro
- توحيد RSI على `analyzers/indicators/rsi.py` (Wilder's smoothing)
- مصدر سعر واحد لكل المحركات (stocks.db.stocks.current_price)
- كاتب واحد لصف التحليل (إلغاء 10 كاتبين على stored_analyses)
- **قتل Maestro نهائياً** (118 ملف — مرحلة بحذر شديد)

### المرحلة 3 — شهر: محرك قرار واحد (V40.2)
- V40.2 يكتب في جدول حكم واحد (predictions.db.predictions)
- كل الشاشات تقرأ منه حصراً
- المحركات التانية تبقى "مؤشرات مساندة" بلا لغة قرار

---

## 🔴 القرارات الستة المطلوبة من المالك (قبل أي تنفيذ)

1. ✅ **إذن المرحلة 0** — تعديل عرض في 5-6 ملفات واجهة (أسرع مكسب)
2. ⏳ **اعتماد V40.2 هو محرك القرار الوحيد** على مستوى العرض
3. ⏳ **قاعدة دستورية جديدة:** "مصدر عرض واحد للقرار"
4. ✅ **تعطيل Maestro كلياً** — المالك وافق: "أمسح كل حاجة ليها علاقة بالمايسترو"
5. ⏳ **سياسة الفراغ:** عرض "— بيانات غير متاحة" بدل المحايد الكاذب
6. ⏳ **إذن أرشفة جدول الأسعار الثالث المخالف** (بعد VERIFY-BEFORE-DELETE)

---

## 📊 إحصائيات Maestro (المطلوب مسحه)

- **118 ملف** فيها Maestro references في `src/` + `vps-service/`
- **3 API routes:** `/api/maestro/`, `/api/maestro/overview/`, `/api/maestro/stock/[ticker]/`
- **4 Python analyzers:** `maestro_orchestrator.py`, `unified_maestro.py`, `crypto_maestro.py`, `maestro_routes.py`
- **2 UI components:** `MaestroWidget.tsx`, `MaestroWidget` references في `DashboardView.tsx`
- **2 helper files:** `src/lib/honest-tracking/maestro.ts`, `src/modules/market-analysis/components/helpers.ts`
- **5 backfill scripts:** في `scripts/` + `vps-service/scripts/`

---

## ⚠️ قاعدة جديدة مقترحة: Rule 73 — SINGLE-DISPLAY-SOURCE

> **أي شاشة/UI** تعرض signal/master_score/RSI/support/resistance لازم تقرأ من **مصدر عرض واحد** (unified API). أي sub-engine signal معروض جنب الـ canonical = bug. أي fabrication للفراغ (HOLD/محايد/متوازنة) = bug.

---

## 🎯 الترتيب التنفيذي (نبدأ فوراً)

1. **الآن:** المرحلة 0 — إخفاء الشارات في ComprehensiveStockAnalysis.tsx
2. **بعدين:** مسح MaestroWidget.tsx + إزالته من DashboardView
3. **بعدين:** مسح /api/maestro/ routes (3 routes)
4. **بعدين:** مسح Python Maestro files (4 files + imports في 118 ملف)
5. **بعدين:** المرحلة 1 — توحيد العتبات
6. **بعدين:** المرحلة 2 — توحيد RSI + مصدر السعر
7. **بعدين:** المرحلة 3 — V40.2 canonical engine
