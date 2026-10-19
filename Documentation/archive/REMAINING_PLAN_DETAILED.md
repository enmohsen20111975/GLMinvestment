# 📋 خطة العمل المتبقية — تفصيلية وقابلة للتنفيذ الفوري

> **التاريخ:** 2026-10-05
> **الأساس:** ملاحظات المالك المباشرة
> **المبدأ:** قرأ وفهم قبل ما تلمس أي حاجة. مفيش ملفات جديدة.

---

## 🔴 المهام الحرجة (تنفيذ فوري)

### 1️⃣ نبض السوق + ملخص السوق + توقعات اليوم — مش بـ تتغير مع السوق
**المشكلة:** لما المستخدم يبدل السوق من EGX لـ TADAWUL/KSE/QSE/CRYPTO، الـ 3 أقسام دول في الـ Dashboard بتفضل تعرض بيانات EGX.

**السبب الجذري:** المكونات داخل الـ widgets بتـ fetch من APIs بدون `?market=currentMarket`.

**التنفيذ:**
- [ ] **MarketSummary** — قرأ الكود، لقي فين الـ fetch، ضيف `?market=currentMarket`
- [ ] **IndexCards** — نفس الحاجة
- [ ] **MarketPulseWidget** — اتصلح قبل كده (يستخدم `useAppStore.getState().currentMarket`) — تحقق
- [ ] **MarketSentiment** — قرأ الكود، ضيف `?market=currentMarket`
- [ ] **EidPredictionsWidget** — قرأ الكود، الـ fetch URL محتاج `?market=currentMarket`

**الملفات المتأثرة:**
- `src/modules/dashboard/components/MarketSummary.tsx`
- `src/modules/dashboard/components/IndexCards.tsx`
- `src/modules/dashboard/components/MarketSentiment.tsx`
- `src/components/eid-predictions-widget.tsx`

**التوقف:** `bun run lint` + `curl http://localhost:3000/` + تبديل السوق والتحقق

---

### 2️⃣ إعادة: حركة العملات/الذهب + السيولة/المستثمرين + ضغط الجلسة — شاشة منفصلة
**المشكلة:** المالك طلبها في شاشة منفصلة يمكن الوصول إليها من القائمة العلوية. حالياً:
- "حركة العملات والذهب" موجود في الـ Dashboard (section 5)
- "حركة السيولة + المستثمرين + ضغط الجلسة" موجود في collapsible `<details>` (EGX فقط)

**المطلوب:** تجميعهم في **تبويب منفصل** يمكن الوصول إليه من القائمة العلوية (TopBar).

**التنفيذ:**
- [ ] قرأ `src/app/page.tsx` — لقي فين الـ hash routes بتاعة القائمة
- [ ] ضيف hash route جديد: `#market-depth` (أو اسم مناسب)
- [ ] انقل الـ 3 مكونات من الـ Dashboard للـ view الجديد:
  - `MultiMarketWidget` (عملات + ذهب)
  - `InvestorsFlowPanel` (تدفّق المستثمرين — EGX فقط)
  - `LiquidityFlowPanel` (حركة السيولة القطاعية)
  - `IntradayPressurePanel` (ضغط الشراء/البيع)
- [ ] ضيف زر في القائمة العلوية (TopBar) للوصول للتبويب
- [ ] خلّي الـ Dashboard نظيف بدونهم

**الملفات المتأثرة:**
- `src/app/page.tsx` (إضافة route)
- `src/components/layout/TopBar.tsx` (إضافة زر)
- `src/modules/dashboard/components/DashboardView.tsx` (إزالة الأقسام)

---

### 3️⃣ شيل زرار النشر من جدول الفلاتر المتقدمة
**المشكلة:** في `#stock-filters`، فيه زرار نشر (StockPublisher) جنب كل سهم. المالك بيقول "ده وحش جدا" — يشيله زي ما في رادار السيولة.

**التنفيذ:**
- [ ] قرأ `src/modules/screener/components/StockScreenerAdvanced.tsx`
- [ ] لقي الـ `StockPublisher` component في عمود `ticker` (جنب اسم السهم)
- [ ] شيله من العمود (خلي العمود نظيف: ticker + name + sector فقط)
- [ ] لو محتاج النشر، ضيفه في صف منفصلة (Row click → فتح تفاصيل السهم)

**الملف المتأثر:**
- `src/modules/screener/components/StockScreenerAdvanced.tsx`

---

### 4️⃣ توحيد StockInfographicCard + بطاقة التحليل — مكون نشر عام واحد
**المشكلة:** فيه مكون `StockInfographicCard` جميل جداً (فيه كل المعلومات). المالك عايز:
- هذا يكون **المكون العام للنشر والصور**
- ياخد منه بيانات النشر
- يستعمله في النشر على التليجرام

**المطلوب:**
- [ ] قرأ `src/components/market/StockInfographicCard.tsx` بعمق شديد
- [ ] فهم كل البيانات اللي بـ يعرضها (مفيش جديد — استعمل الموجود)
- [ ] تأكد إنه بيـ accept props شاملة (entry, target, stop, signal, technical_explanation, SMC, patterns, etc.)
- [ ] لو ناقصه props — وسّعه (من غير ما تعمل ملف جديد)
- [ ] خلّيه الـ canonical component لـ:
  - عرض السهم في الشاشة العامة
  - بطاقة التحليل اللي بتيجي من التحليل التفصيلي
  - تصدير PNG للنشر
  - بيانات النشر على التليجرام
- [ ] ربطه مع `StockPublisher` بحيث يستعمل بيانات الـ InfographicCard

**الملفات المتأثرة:**
- `src/components/market/StockInfographicCard.tsx` (توسيع)
- `src/modules/publishing/components/StockPublisher.tsx` (ربط)
- `src/modules/publishing/lib/stock-publish-text.ts` (استخدام بيانات الـ InfographicCard)

---

## 🟡 مهام متابعة (بعد الحرجة)

### 5️⃣ باقي الكوارث المتبقية (من الـ AUDIT)
- [ ] مهاجرة باقي 17 prediction card components لـ PredictionCard
- [ ] مهاجرة باقي raw sqlite3.connect (292 ملف لسه)
- [ ] توحيد 38 backtest runner في shared framework
- [ ] دمج 653 API route لـ prefixes أقل
- [ ] توحيد 12+ scanner implementations

### 6️⃣ تحسينات UI عامة
- [ ] توحيد الألوان والتنسيق عبر كل المكونات
- [ ] فلاش أخضر/أحمر عند تغير الأسعار (live updates)
- [ ] ترتيب ذكي افتراضي في كل جدول

---

## 📊 ترتيب التنفيذ

| # | المهمة | الأولوية | الملفات | الوقت |
|---|--------|---------|---------|------|
| 1 | نبض+ملخص+توقعات تتبع السوق | 🔴 حرج | 4 | ساعة |
| 2 | شاشة منفصلة للسيولة+المستثمرين+العملات | 🔴 حرج | 3 | ساعتين |
| 3 | شيل زرار النشر من الفلاتر | 🔴 حرج | 1 | نصف ساعة |
| 4 | توحيد InfographicCard + Publisher | 🔴 حرج | 3 | 3 ساعات |
| 5 | باقي الكوارث | 🟡 متابعة | ~50 | أيام |

---

*تم الإنشاء: 2026-10-05 — مبني على ملاحظات المالك المباشرة*
