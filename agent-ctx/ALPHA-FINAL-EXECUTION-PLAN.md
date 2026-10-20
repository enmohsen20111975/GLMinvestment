# 📋 [ALPHA FINAL EXECUTION PLAN — تقفيل وتطهير الواجهات والنظام البصري]
> **الموجّه:** المعلم جيمي (Jimmy)  
> **الجهة المنفذة:** فريق ALPHA (مهندسو الواجهات وتجربة المستخدم)  
> **النطاق الصارم:** مجلد `src/` فقط. ممنوع لمس البايثون، وممنوع المساس بالمنطق الرياضي أو الحسابات.  
> **بروتوكول العمل:** هذا الملف هو عقد تنفيذي تفصيلي ثنائي الاتجاه (Two-Way Interactive Contract). تقوم بتنفيذ المهام بالترتيب، وتعليم الـ Checklists بـ `[x]`، وتدوين نتائج الاختبارات والـ Diff في الأقسام المخصصة أسفل كل مهمة قبل عمل Commit و Push.

---

## 🎯 الأهداف الأساسية للتقفيل (The 5 Milestones):
1. **حل كراش `isDefensive is not defined` فوراً وتأمين الشاشات ضد الـ ReferenceErrors.**
2. **تصحيح خديعة زرار "حي" الأخضر وفصل تنبيهات الروبوت عن حالة جلسة السوق الرسمية.**
3. **تفعيل لوجوهات وأيقونات الأسهم في كل الشاشات وربطها بالـ URLs المباشرة مع Fallback احترافي.**
4. **توحيد مصدر البيانات في الفرونت إند ومنع تضارب الأسعار بين الشاشات (Single Source of Truth).**
5. **إعادة هيكلة وترتيب القوائم والشاشات لتوفير تجربة مستثمر محترف تليق بالمنصة.**

---

## 📌 المهمة 1: إصلاح كراش `ReferenceError: isDefensive is not defined`
### 🔍 أصل المشكلة:
في [PersonaTab.tsx](file:///wsl.localhost/Ubuntu/home/meme/my_apps/GLMinvestment/src/modules/market-analysis/components/PersonaTab.tsx#L2267) تم استخدام المتغير `isDefensive` داخل ريندر `IncubatorSection`، بينما المتغير متعرف محلياً فقط داخل دالة فرعية `if (items.length === 0)` في السطر 1846 وغير مرئي في النطاق العام للمكوّن، مما يسبب انهيار الصفحة وظهور شاشة الخطأ `ErrorBoundary`.

### 🛠️ خطوات التنفيذ المطلوبة:
- [ ] في `src/modules/market-analysis/components/PersonaTab.tsx`، توجه إلى السطر 2267.
- [ ] استبدل الشرط غير المعرف:
  ```tsx
  // ❌ كود خاطئ يسبب ReferenceError:
  <div className={isDefensive ? 'order-first' : ''}>
  ```
  بالشرط الآمن والمباشر:
  ```tsx
  // ✅ كود آمن 100%:
  <div className={marketRegime?.regime === 'DEFENSIVE' ? 'order-first' : ''}>
  ```
  أو عرّف المتغير في قمة مكوّن `PersonaTab` بعد `useState(marketRegime)`:
  ```tsx
  const isDefensive = marketRegime?.regime === 'DEFENSIVE';
  ```

### 📝 [رد وتنفيذ ALPHA للمهمة 1]:
- [ ] **حالة الإنجاز:** تم الإصلاح بنجاح
- **الملفات المعدلة:** 
- **كود الـ Diff:**
- **نتيجة اختبار التشغيل:** 

---

## 📌 المهمة 2: تصحيح زرار "حي" وإظهار حالة جلسة التداول الحقيقية
### 🔍 أصل المشكلة:
زرار التنبيهات في الشريط العلوي [RoboNotifierToggle.tsx](file:///wsl.localhost/Ubuntu/home/meme/my_apps/GLMinvestment/src/components/notifications/RoboNotifierToggle.tsx#L106) يعرض كلمة `حي` بنقطة خضراء نابضة عندما تكون التنبيهات الصوتية مفعلة. العميل يرى "حي" في منتصف الليل فيظن أن البورصة مفتوحة وأن المنصة تكذب!

### 🛠️ خطوات التنفيذ المطلوبة:
- [ ] **تعديل زر التنبيهات:**
  في `src/components/notifications/RoboNotifierToggle.tsx` السطر 106:
  غيّر الـ label ليكون:
  `{running ? 'تنبيهات نشطة' : 'تفعيل التنبيهات'}` أو أيقونة جرس مع كلمة `الرادار الصوتي`. يُمنع استخدام كلمة `حي` وحدها في هذا الزرار.
- [ ] **إضافة بادج جلسة التداول الحقيقية في `TopBar.tsx`:**
  استورد دالة فحص ساعات التداول الرسمية من [src/lib/market-hours.ts](file:///wsl.localhost/Ubuntu/home/meme/my_apps/GLMinvestment/src/lib/market-hours.ts):
  ```typescript
  import { getMarketSessionStatus } from '@/lib/market-hours';
  ```
  أضف كبسولة واضحة في الهيدر العلوي بجانب اختيار السوق:
  - إذا كان السوق مفتوحاً (مثلاً مصر 10:00 ص - 2:30 م): 
    عرض: `🔴 مباشر (جلسة التداول)` بلون أخضر ناعم.
  - إذا كان السوق مغلقاً:
    عرض: `⚪ مغلق (إغلاق الجلسة)` مع توضيح موعد الجلسة القادمة.

### 📝 [رد وتنفيذ ALPHA للمهمة 2]:
- [ ] **حالة الإنجاز:** تم التنفيذ
- **الملفات المعدلة:**
- **مظهر الكبسولة الجديد:**

---

## 📌 المهمة 3: تفعيل أيقونات ولوجوهات الأسهم في كل الجداول والشاشات
### 🔍 أصل المشكلة:
مكوّن `StockIcon.tsx` يعتمد على `KNOWN_ICONS` التي تبحث محلياً في مجلد `public/stock-icons/` عن ملفات SVG محدودة جداً. بالإضافة إلى أن بعض الـ endpoints ترسل `logo_url` وبعضها يرسل `logoUrl` أو لا يرسله، فيفشل المكوّن ويتحول لمربع باهت فارغ.

### 🛠️ خطوات التنفيذ المطلوبة:
- [ ] في `src/lib/stock-icon.ts`:
  تحديث دالة `getStockIconUrl`:
  ```typescript
  export function getStockIconUrl(ticker: string, logoUrl?: string | null): string | null {
    if (logoUrl && logoUrl.trim().startsWith('http')) return logoUrl.trim();
    if (!ticker) return null;
    const clean = ticker.toUpperCase().replace(/\.(CA|SR|KW|QA)$/, '').trim();
    // 1. فحص ملف محلي
    if (KNOWN_ICONS.has(clean)) return `/stock-icons/${clean}.svg`;
    // 2. فحص TradingView CDN المباشر كـ Fallback ذكي
    return `https://s3-symbol-logo.tradingview.com/${clean.toLowerCase()}--big.svg`;
  }
  ```
- [ ] في `src/modules/stock-analysis/components/StockIcon.tsx`:
  - التعامل مع خطأ تحميل الصورة (`onError`) بذكاء: لو فشل الـ CDN يعرض فوراً Fallback دائري أنيق يحمل أول حرفين من رمز السهم بلون خلفية مشتق من كود السهم.
  - دعم كلا الاسمين للحقل: `logoUrl || (props as any).logo_url`.
- [ ] التأكد من ظهور الأيقونات بجانب كل تيكر في:
  - جدول التوقعات النشطة والحاضنة في `PersonaTab.tsx`
  - جدول الأرشيف `PreviousPredictionsArchive` في `PredictionsTab.tsx`
  - جدول رادار السيولة `LiquidityRadarView.tsx`

### 📝 [رد وتنفيذ ALPHA للمهمة 3]:
- [ ] **حالة الإنجاز:** تم تفعيل الأيقونات
- **اختبار عينة أسهم (ABUK, COMI, MFPC):**

---

## 📌 المهمة 4: ترتيب القوائم والشاشات (Navigation Hierarchy)
### 🔍 أصل المشكلة:
تشتت المستخدم بين عشرات التبويبات المتشابهة في `nav-config.ts` (السوق، التحليل، التوقعات، الرادار، المحفظة، التقارير...).

### 🛠️ خطوات التنفيذ المطلوبة:
- [ ] في [src/lib/nav-config.ts](file:///wsl.localhost/Ubuntu/home/meme/my_apps/GLMinvestment/src/lib/nav-config.ts):
  إعادة ترتيب القوائم العلوية والسفلية إلى **4 بوابات استثمارية واضحة**:
  1. **📊 نبض السوق (Market Pulse):** يشمل (الرادار اللحظي، سيولة الحيتان، حركة القطاعات).
  2. **🎯 الفرص والتربص (Picks & Stalking):** يشمل (أفضل 5 فرص مؤكدة، رادار التربص والحاضنة 83%).
  3. **🔬 مجهر الأسهم (Stock Screener & DNA):** يشمل (التحليل المالي والفني الشامل، الشارت، الفلاتر الذكية).
  4. **💼 الصفقات والمحفظة (Portfolio & Track Record):** يشمل (متابعة الصفقات، الأرشيف التاريخي، حاسبة إدارة المخاطر).

### 📝 [رد وتنفيذ ALPHA للمهمة 4]:
- [ ] **حالة الإنجاز:** تم تنظيم الـ Navigation
- **مصفوفة القوائم الجديدة:**

---

## 📌 المهمة 5: فحص شاشة الكريبتو الحية (Live Crypto Verification)
### 🛠️ خطوات التنفيذ المطلوبة:
- [ ] الدخول إلى مسار الكريبتو `src/modules/crypto/` والتأكد من استقبال تحديثات الأسعار اللحظية (WebSocket / Polling).
- [ ] التأكد من أن حركة الأسعار (BTC, ETH, SOL) خضراء/حمراء تومض وتتحرك بشكل حي الآن لإثبات أن الواجهة تتنفس لحظياً 24/7.

---

## 🛑 محظورات Alpha الصارمة (STRICT PROHIBITIONS):
1. ❌ ممنوع تشغيل أي `sed` آلي يغير الكود بالجملة بدون مراجعة بشرية سطر بسطر.
2. ❌ ممنوع استخدام ألوان Tailwind عشوائية؛ الالتزام الصارم بمكون `<StatusBadge>` و `<FinancialBadge>`.
3. ❌ ممنوع اختراع أسعار أو أهداف في الواجهة — كل رقم يُعرض كما يأتي من الـ API.
4. ❌ ممنوع `git push --force`.

---

## 🧪 بروتوكول التسليم والاعتماد النهائي:
```bash
# أوامر الفحص الإلزامية قبل الـ Push:
npm run build     # يجب أن يخرج بـ Exit code 0
pm2 restart all   # إعادة تشغيل الخدمات
```

**توقيع استلام التكليف:**  
فريق Alpha: `[ ] جاري التنفيذ` | التاريخ: 2026-10-20
