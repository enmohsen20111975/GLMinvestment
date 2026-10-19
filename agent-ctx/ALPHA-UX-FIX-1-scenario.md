# سيناريو الاختبار الكامل + تكليف ألفا

> **من:** جون (المدير التنفيذي)
> **إلى:** المالك (محسن) + فريق ألفا
> **التاريخ:** 2026-10-19
> **الهدف:** اختبار شامل للمنصة من وجهة نظر مستخدم + تكليف ألفا بـ fixes

---

## 📋 سيناريو الاختبار (للمالك على الابتوب/الإنتاج)

### المرحلة 1: مستخدم غير مسجل (Guest)
1. افتح الموقع → هل الـ dashboard بـ show data حقيقية؟ (مش 0.00)
2. هل الـ nav الجديد ظاهر؟ (6 بوابات: الرئيسية/السوق/التحليل/محفظتي/التعلّم/المزيد)
3. هل InvestorsFlow widget ظاهر على الـ dashboard؟
4. اضغط "السوق" → هل بتشوف الأسهم؟ ولا "تسجيل الدخول"؟
5. اضغط "التعلّم" → هل الأكاديمية شغالة؟
6. اضغط "المزيد" → هل الأخبار شغالة؟
7. ابحث عن "COMI" → هل النتايج صحيحة؟
8. هل فيه أي إغراء واضح يسجّل؟

### المرحلة 2: مستخدم مسجل (mohseny)
1. سجل دخول بـ mohseny / M2y@01287644099
2. هل الـ dashboard بـ show data حقيقية؟
3. اضغط "السوق" → هل الأسهم شغالة؟
4. اضغط على سهم (COMI) → هل التفاصيل شغالة؟ (سعر/شارت/تحليل)
5. اضغط "التحليل" → هل التوصيات شغالة؟
6. اضغط "محفظتي" → هل المحفظة شغالة؟
7. اضغط "التعلّم" → هل الأكاديمية شغالة؟
8. هل فيه حد واضح بين الـ free + الـ paid؟

### المرحلة 3: إغراءات الاشتراك
1. هل فيه شاشة "اشترك الآن" واضحة؟
2. هل فيه limits واضحة للـ free user؟ (مثلاً: 3 توقعات/يوم)
3. لما توصل للـ limit → هل بيقولك "اشترك للمزيد"؟
4. هل الخطط واضحة؟ (free/normal/premium + الأسعار)
5. هل عملية الدفع شغالة؟

---

## 🔴 المشكلة الكبرى: Dashboard = 0.00

### الحقيقة من الاختبار:
- **الـ APIs كلها شغالة + بترجع data حقيقية:**
  - `/api/market/overview` → stocks=100, adv=11, dec=86 ✅
  - `/api/market-pulse` → EGX50=7877, change=34.59% ✅
  - `/api/predictions/eid` → 4 توقعات ✅
  - `/api/stocks/COMI` → price=124.97 ✅
  - `/api/news` → 53 خبر ✅

- **بس الـ dashboard بـ show 0.00 لكل القيم.**
- ده **frontend bug** — الـ widgets مش بـ parse/render الـ API response صح.

### الـ root cause المحتمل:
1. الـ fetch بـ fail (CORS / timeout / auth gate).
2. الـ response shape مختلف عن اللي الـ frontend متوقع.
3. الـ state management (zustand) مش بـ update بعد الـ fetch.
4. الـ widget بـ render قبل ما الـ data توصل (race condition).

---

## 📋 تكليف ألفا (سيناريو اللازم تنفذه)

### ALPHA-UX-FIX-1: Dashboard 0.00 Bug

**المشكلة:** الـ dashboard بـ show 0.00 لكل القيم رغم إن الـ APIs بترجع data حقيقية.

**الخطوات:**
1. افتح `src/modules/dashboard/components/MarketPulseWidget.tsx`
   - تحقق إن الـ fetch من `/api/market-pulse` بـ parse الـ response صح.
   - الـ response shape: `{success, source, data: {index: {value, change_percent, symbol}, ...}}`
   - هل الـ widget بـ read `data.index.value` ولا `index.value`؟

2. افتح `src/modules/dashboard/components/IndexCards.tsx`
   - تحقق إن الـ index cards بـ render القيم من الـ API.
   - هل الـ indices بـ fetch من `/api/market/indices` ولا `/api/market/overview`؟

3. افتح `src/modules/dashboard/components/DashboardView.tsx`
   - تحقق إن الـ widgets بـ initialize + fetch data عند mount.
   - هل فيه auth gate بيـ block الـ fetch للـ guest؟

4. افتح `src/lib/store.ts` (zustand)
   - تحقق إن الـ market overview state بـ update بعد الـ fetch.
   - هل فيه race condition بين الـ auth check + الـ data fetch؟

5. **الاختبار:**
   - افتح الموقع كـ guest → الـ dashboard لازم يـ show EGX50=7877 (مش 0.00).
   - افتح كـ user مسجل → نفس النتيجة.
   - الـ API calls في الـ Network tab → كلها HTTP 200.

### ALPHA-UX-FIX-2: Guest Experience + إغراءات التسجيل

**المشكلة:** الـ guest مش بيشوف أي value → مفيش سبب يسجّل.

**المطلوب:**
1. الـ dashboard لازم يـ show data حقيقية للـ guest (مش 0.00).
2. شاشة "السوق" لازم تـ show الأسهم للـ guest (بـ limit — مثلاً أول 50 سهم).
3. شاشة "التوقعات" لازم تـ show 3 توقعات للـ guest (باقي التوقعات = "سجّل للمزيد").
4. شاشة "التحليل" لازم تـ show تحليل basic للـ guest (advanced = "اشترك").
5. لما الـ guest يوصل limit → رسالة واضحة: "سجّل مجاناً للمزيد" + زر تسجيل.

### ALPHA-UX-FIX-3: Modals تلخبطة

**المشكلة:** 3-4 modals بيظهروا فوراً (help center + onboarding + notifications + login).

**المطلوب:**
1. مودال واحد بس عند الـ first visit (onboarding "ما نوع الأصول").
2. باقي الـ modals تتأجل لحد ما المستخدم يـ interact.
3. الـ login modal ما يظهرش فوراً — بس لما المستخدم يضغط على feature مقفول.

---

## 📊 ملخص حالة المشروع (من جون)

| المحرك | الحالة | المسؤول |
|---|---|---|
| **الفرونت (ألفا)** | ✅ شغل ألفا جديد (6 بوابات + InvestorsFlow) — بس dashboard 0.00 bug | ألفا |
| **محرك التوقعات (برافو)** | ✅ شغال (V40.2 + SMC + Mean Reversion) | برافو |
| **محرك البيانات (جون)** | ✅ خلص (tab_* fix + scraper fix + unify script) | جون |
| **محرك الأخبار (جون)** | ✅ خلص (bypass Node + ticker extraction + readers fix) | جون |
| **التليجرام (جون)** | ✅ Phase 1 خلص (4 modules restored + 2 bugs fixed) | جون |
| **الـ dashboard** | 🔴 0.00 bug — APIs شغالة بس frontend مش بـ render | ألفا |
| **الـ guest experience** | 🔴 مفيش إغراء للتسجيل | ألفا |

---

**جون — الـ APIs شغالة + بترجع data حقيقية. المشكلة في الـ frontend. ألفا لازم تـ fix الـ dashboard 0.00 bug الأول. ده الـ root cause لكل مشاكل الـ UX.**
