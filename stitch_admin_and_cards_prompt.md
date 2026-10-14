# 🎨 Google Stitch Prompt — GLM Investment Platform Admin & Cards Design System

> **مرسل إلى:** Google Stitch (AI Design Generator)
> **المنصة:** GLM Investment Terminal — منصة استثمارية مؤسسية (Next.js 14 + TypeScript)
> **نظام التصميم:** Sovereign Terminal (Material Design 3 + Emerald-Mint Dark Theme)
> **اللغة:** عربي (RTL) + أرقام إنجليزية (tabular-nums)

---

## 📋 التعليمات العامة لـ Stitch

### نظام الألوان (Color Tokens) — استخدمه بالكامل
```
Primary:        #4edea3 (emerald-mint) — للأرقام الإيجابية والنمو
Primary-Container: #10b981 (emerald-600) — للأزرار الفعالة والشارات
On-Primary:     #003824 (dark green text on primary)
Secondary:      #80d5cb (mint-teal) — للعناصر الثانوية
Error:          #ffb4ab (coral) — للخسائر والتحذيرات
Error-Container: #93000a (dark red bg)

Surface Palette (Dark Mode):
  surface-container-lowest:  #0c0f0e (الأعمق — خلفية رئيسية)
  surface-container-low:     #191c1b (كروت)
  surface-container:         #1d201f (حاويات)
  surface-container-high:    #282b29 (hover)
  surface-container-highest:  #323534 (محدد)

On-Surface:          #e1e3e1 (نص رئيسي)
On-Surface-Variant:  #bbcabf (نص ثانوي)
Outline:             #86948a (حدود خفيفة)
Outline-Variant:     #3c4a42 (حدود كروت)
```

### نظام الخطوط (Typography)
```
Headlines/Display:  Outfit (400-700)
Body/Arabic:        Cairo (400-700)
Financial Numbers:  JetBrains Mono (400-700) + tabular-nums
Labels/Tickers:     JetBrains Mono + letter-spacing 0.05em
```

### قواعد صارمة
1. **RTL**: كل التصميمات من اليمين لليسار (dir="rtl")
2. **الأرقام المالية**: كل سعر/نسبة/كمية يحمل `font-financial tabular-nums`
3. **ممنوع أزرق/نيلي**: فقط زمردي/مينت/كهرماني/فحمي
4. **Glassmorphism**: استخدم `backdrop-blur` + خلفيات شفافة `surface-container-low/80`
5. **Material Symbols**: استخدم Material Symbols Outlined للأيقونات
6. **اللغة العربية**: كل النصوص بالعربي الفصحى، المصطلحات المالية: دخول/هدف/وقف/ثقة

---

## 🏛️ القسم 1: لوحة الأدمن الكاملة (Admin Dashboard)

### 1.1 — لوحة الأدمن الرئيسية (Admin Home)
**الموقع في المشروع:** `src/modules/admin/components/AdminView.tsx`
**الوظيفة:** الصفحة الرئيسية للأدمن — نظرة عامة على المنصة

**العناصر المطلوبة:**
- شريط علوي: شعار "لوحة تحكم المدير" + اسم الأدمن + زر خروج
- 4 KPI Cards في صف واحد:
  - "إجمالي المستخدمين" (رقم كبير + أيقونة Users + % نمو)
  - "الإيرادات الشهرية" (ج.م + أيقونة Wallet + % نمو)
  - "التوقعات النشطة" (رقم + أيقونة TrendingUp)
  - "معدل الدقة" (% + أيقونة Target + لون زمردي)
- 2 Tabs: "نظرة عامة" | "تنبيهات النظام"
- جدول "آخر النشاطات" (5 صفوف: مستخدم/إجراء/وقت/حالة)
- بطاقة "صحة النظام" (مؤشرات: Python Backend / Database / Cron Jobs / WebSocket)
- كل الأرقام `font-financial tabular-nums`

---

### 1.2 — لوحة التدقيق الصادق (Honest Audit Dashboard)
**الموقع:** `src/modules/admin/components/platform-performance/PlatformPerformanceView.tsx`
**الوظيفة:** تدقيق أداء التوقعات — win rate حقيقي + profit factor

**العناصر المطلوبة:**
- Header: "لوحة التدقيق الصادقة" + زر تحديث
- 4 KPI Cards: "نسبة النجاح الحقيقية" / "معامل الربحية" / "متوسط العائد" / "إجمالي الصفقات المغلقة"
- فلتر: Select للسوق (EGX/TADAWUL/KSE/QSE) + Select للفترة (يومي/أسبوعي/شهري)
- جدول "آخر الصفقات المغلقة" (UnifiedTable):
  - الأعمدة: السهم | تاريخ الدخول | تاريخ الخروج | سعر الدخول | سعر الخروج | العائد % | النتيجة
  - Status badge: ✅حقق الهدف (زمردي) / 🛑ضرب الوقف (أحمر) / ⏳منتهي (كهرماني)
- بطاقة "أفضل 5 صفقات" + بطاقة "أسوأ 5 صفقات"
- بطاقة "توزيع الأسواق" (نسب كل سوق)
- كل الأرقام `font-financial tabular-nums`

---

### 1.3 — مدير توقعات التليجرام (Telegram Predictions Manager)
**الموقع:** `src/app/api/admin/telegram-predictions/route.ts` + UI في AdminView
**الوظيفة:** نشر التوقعات على قناة التليجرام

**العناصر المطلوبة:**
- Header: "مدير نشر التليجرام" + زر "نشر توقع جديد"
- قائمة التوقعات المنتظرة (3-5 كروت):
  - كل كرت: السهم + الإشارة + سعر الدخول + الهدف + الوقف + الثقة + زر "نشر" + زر "رفض"
- سجل النشر (جدول: السهم | تاريخ النشر | المشاهدات | التفاعل | الحالة)
- إعدادات القناة (bot token + channel ID + توقيت النشر التلقائي)

---

### 1.4 — بوابة الذكاء الاصطناعي (AI Gatekeeper Queue)
**الموقع:** `src/app/api/admin/ai-gatekeeper/route.ts` + UI في AdminView
**الوظيفة:** اعتماد رفض توقعات الـ AI قبل النشر

**العناصر المطلوبة:**
- Header: "بوابة اعتماد الذكاء الاصطناعي"
- قائمة انتظار (5-7 كروت):
  - كل كرت: السهم + إشارة AI + الثقة % + السبب + زر "اعتماد" (زمردي) + زر "رفض" (أحمر)
- إحصائيات: "معتمد اليوم" / "مرفوض اليوم" / "في الانتظار"
- سجل القرارات (جدول: السهم | القرار | الأدمن | الوقت)

---

### 1.5 — إعدادات المحركات والأوزان (Engine Settings)
**الموقع:** `src/app/api/admin/engine-settings/route.ts` + UI في AdminView
**الوظيفة:** ضبط أوزان محركات التحليل (V40.2)

**العناصر المطلوبة:**
- Header: "إعدادات المحركات" + زر "حفظ التغييرات"
- 6 شرائح تمرير (sliders) للأوزان:
  - "وزن التحليل الفني" (0-100%)
  - "وزن التحليل الأساسي" (0-100%)
  - "وزن تدفق السيولة" (0-100%)
  - "وزن تحليل المشاعر" (0-100%)
  - "وزن نموذج HMM" (0-100%)
  - "وزن تحليل الحيتان" (0-100%)
- بطاقة "حدود التصفية":
  - "أدنى R:R" (1.0-3.0)
  - "أدنى نسبة الثقة" (50-90%)
  - "أقصى خسارة يومية" (ج.م)
- زر "إعادة تعيين للافتراضي"

---

### 1.6 — مدير قاعدة البيانات (DB Manager)
**الموقع:** `src/app/api/admin/db/[db]/route.ts` + UI في AdminView
**الوظيفة:** إدارة قواعد البيانات (backup/repair/vacuum)

**العناصر المطلوبة:**
- Header: "مدير قواعد البيانات"
- 3 Tabs: "النسخ الاحتياطي" | "الإصلاح" | "الاستعلام"
- قائمة الـ DBs (8 قواعد): stocks.db / predictions.db / data_engine.db / news.db / etc.
- لكل DB: حجمها + عدد الصفوف + آخر backup + أزرار (نسخ/إصلاح/تفريغ)
- محرر SQL (textarea + زر تنفيذ + جدول نتائج)

---

### 1.7 — مراقب صحة النظام (System Health Monitor)
**الموقع:** `src/app/api/admin/system-health/route.ts` + UI في AdminView
**الوظيفة:** مراقبةCPU/RAM/Disk/Services

**العناصر المطلوبة:**
- 4 KPI Cards: "استخدام CPU" / "استخدام RAM" / "مساحة القرص" / "حالة Python" (مع أيقونات + ألوان: زمردي=صحي/كهرماني=تحذير/أحمر=حرج)
- مخطط زمني (line chart) لاستخدام CPU خلال آخر 24 ساعة
- قائمة العمليات (5-8 صفوف: اسم العملية + PID + CPU% + RAM + زر "إنهاء")
- سجل الأخطاء (آخر 10 أخطاء + مستوى الخطأ + الوقت)

---

## 🃏 القسم 2: الكروت القابلة لإعادة الاستخدام (Reusable Component Cards)

> **ملاحظة:** كل كرت يجب أن يكون مكون React مستقل قابل للزرع في أي شاشة.

### 2.1 — كرت الإشارة الحية (SignalCard)
**الموقع:** `src/components/shared/cards/SignalCard.tsx`
**الاستخدام:** في VIPLiveSignalsFeed + MarketAnalysisView + Telegram publish

**التصميم:**
```
┌─────────────────────────────────────────┐
│  [COMI]  [STRONG_BUY]        الثقة: 87% │
│  التجاري الدولي                          │
│  البنوك                                  │
├─────────────────────────────────────────┤
│  🎯 الدخول    →    الهدف    🛑 الوقف    │
│   84.50         92.00       79.00        │
│                (+8.9%)     (-6.5%)      │
├─────────────────────────────────────────┤
│  R:R 1:1.4    ⚡يومية                    │
├─────────────────────────────────────────┤
│  🔥 الدافع: اختراق مقاومة + حجم استثنائي │
├─────────────────────────────────────────┤
│  [📋 نسخ للتليجرام/واتساب]              │
└─────────────────────────────────────────┘
```
- زمردي للدخول/الهدف، أحمر للوقف، كهرماني للدافع
- `font-financial tabular-nums` على كل الأرقام
- glass-panel خلفية + border-outline-variant

---

### 2.2 — كرت التوقع (PredictionCard)
**الموقع:** `src/components/shared/cards/PredictionCard.tsx`
**الاستخدام:** في تتبع التوقعات + القائمة الشخصية

**التصميم:**
- Header: السهم + التاريخ + حالة التوقع (نشط/محقق/خاسر)
- Body: سعر الدخول + الهدف + الوقف + R:R + الثقة
- Progress bar: كم تبقى للهدف (0% → 100%)
- Footer: زر "عرض التفاصيل" + زر "متابعة"

---

### 2.3 — كرت السهم المختصر (StockMiniCard)
**الموقع:** `src/components/shared/cards/StockMiniCard.tsx`
**الاستخدام:** في قوائم الأسهم + نتائج البحث + قائمة المراقبة

**التصميم:**
- صف واحد: [أيقونة السهم] + الرمز + الاسم + السعر + التغير %
- التغير: زمردي للموجب، أحمر للسالب
- Sparkline مصغر (28×120px)
- `font-financial tabular-nums`

---

### 2.4 — كرت الخبر (NewsCard)
**الموقع:** `src/components/shared/cards/NewsCard.tsx`
**الاستخدام:** في NewsFeedView + لوحة الأدمن

**التصميم:**
- Header: المصدر + الوقت + شارة الأهمية (عالية/متوسطة/منخفضة)
- العنوان (سطرين كحد أقصى)
- ملخص (3 أسطر)
- Footer: الأسهم المتأثرة (chips) + شارة المشاعر (إيجابي/سلبي/محايد)
- `font-financial tabular-nums` على الأسعار إن وُجدت

---

### 2.5 — كرت المؤشر (KPI Card)
**الموقع:** `src/components/shared/cards/KPICard.tsx`
**الاستخدام:** في كل الـ dashboards (أدمن + مستخدم)

**التصميم:**
```
┌──────────────────────────┐
│  [icon]  القيمة           │
│          87.5%            │
│  التسمية         +2.3% ▲  │
└──────────────────────────┘
```
- القيمة: `font-financial tabular-nums` كبيرة (text-2xl)
- التغير: زمردي للموجب، أحمر للسالب
- خلفية: `dark:bg-surface-container-low` + `border-outline-variant/30`

---

### 2.6 — كرت الصفقة المغلقة (ClosedTradeCard)
**الموقع:** `src/components/shared/cards/ClosedTradeCard.tsx`
**الاستخدام:** في سجل الأداء + التقارير

**التصميم:**
- Header: السهم + تاريخ الإغلاق + شارة النتيجة (✅/🛑/⏳)
- Body: دخول → خروج + العائد %
- العائد: زمردي للموجب، أحمر للسالب، `font-financial tabular-nums`
- مدة الاحتفاظ (أيام)

---

### 2.7 — كرت حالة السوق (MarketRegimeCard)
**الموقع:** `src/components/shared/cards/MarketRegimeCard.tsx`
**الاستخدام:** في الـ Dashboard + لوحة الأدمن

**التصميم:**
- شريط ملون حسب النظام (DEFENSIVE=أحمر / NORMAL=كهرماني / AGGRESSIVE=زمردي)
- نص: "السوق دفاعي — قلل الحجم وركّز على وقف الخسارة"
- مؤشر EGX30 + التغير %

---

### 2.8 — كرت الدافع الفني (CatalystCard)
**الموقع:** `src/components/shared/cards/CatalystCard.tsx`
**الاستخدام:** داخل SignalCard + شاشة تفاصيل السهم

**التصميم:**
- أيقونة 🔥 + خلفية `bg-amber-500/5` + `border-amber-500/20`
- نص الدافع (سطرين كحد أقصى)
- `text-amber-700 dark:text-amber-300`

---

## 📱 القسم 3: كروت التليجرام (Telegram Publish Cards)

> **ملاحظة:** كل كرت يجب أن يولّد نص منسق جاهز للنسخ + صورة PNG (1080×1350px portrait) للنشر.

### 3.1 — كرت توصية سهم للتليجرام (Stock Recommendation Card)
**الموقع:** `src/components/telegram/cards/StockRecommendationCard.tsx`
**الوظيفة:** كرت بصري يُنسخ كنص + يُصدر كصورة

**النص المنسق:**
```
📊 توصية استثمارية — منصة دليل الاستثمار
━━━━━━━━━━━━━━━━━━━━
السهم: COMI (التجاري الدولي)
الإشارة: شراء قوي 🔥
💰 سعر الدخول: 84.50
🎯 الهدف الأول: 92.00 (+8.9%)
🎯 الهدف الثاني: 98.00 (+16.0%)
🛑 وقف الخسارة: 79.00 (-6.5%)
⚖️ نسبة العائد/المخاطرة: 1:1.4
🔐 نسبة الثقة: 87%
🔥 الدافع الفني: اختراق مقاومة + حجم استثنائي
━━━━━━━━━━━━━━━━━━━━
⚠️ إخلاء مسؤولية: التوصيات للأغراض التعليمية فقط
```

**التصميم البصري (للصورة):**
- خلفية: `surface-container-lowest` (#0c0f0e) + glassmorphism
- شعار "دليل الاستثمار" أعلى يمين + خط فرعي "GLM INVESTMENT TERMINAL"
- جدول: الدخول/الهدف/الوقف بألوان زمردية/حمراء
- شريط الثقة (progress bar زمردي)
- أيقونة 🔥 بجانب الدافع
- ختم "توصية موثقة" في الأسفل
- كل الأرقام `JetBrains Mono tabular-nums`

---

### 3.2 — كرت التقرير اليومي (Daily Report Card)
**الموقع:** `src/components/telegram/cards/DailyReportCard.tsx`
**الوظيفة:** ملخص يومي للسوق يُنشر كل صباح

**النص المنسق:**
```
📋 التقرير اليومي — البورصة المصرية
━━━━━━━━━━━━━━━━━━━━
📅 التاريخ: 14 أكتوبر 2026

📊 حالة السوق:
  EGX 30: 24,150 (+1.42%) 🟢
  EGX 70: 4,820 (+0.85%) 🟢
  السيولة: 1.2 مليار ج.م

🔥 أقوى 3 فرص اليوم:
  1. COMI — شراء قوي (87% ثقة)
  2. FWRY — شراء (75% ثقة)
  3. EAST — شراء (68% ثقة)

📈 الأكثر ارتفاعاً: ESRS (+3.5%)
📉 الأكثر انخفاضاً: HRHO (-0.5%)

💡 التوصية: السوق صاعد — ركّز على الأسهم القيادية
━━━━━━━━━━━━━━━━━━━━
⚠️ إخلاء مسؤولية: التقرير للأغراض التعليمية فقط
```

**التصميم البصري:**
- Header: "التقرير اليومي" + التاريخ + شعار المنصة
- 3 KPI boxes: EGX30 / EGX70 / السيولة (أرقام كبيرة زمردية)
- قائمة الفرص (3 صفوف مع شارات الإشارة)
- Footer: إخلاء المسؤولية

---

### 3.3 — كرت سجل الأداء (Track Record Card)
**الموقع:** `src/components/telegram/cards/TrackRecordCard.tsx`
**الوظيفة:** شهادة أداء شهرية تُنشر للإثبات

**النص المنسق:**
```
🏆 سجل الأداء الموثق — أكتوبر 2026
━━━━━━━━━━━━━━━━━━━━
📊 إحمالي الصفقات المغلقة: 24

✅ صفقات رابحة: 17 (70.8%)
🛑 صفقات خاسرة: 7 (29.2%)
⏳ منتهية بدون هدف: 0

💰 متوسط العائد: +3.2% لكل صفقة
📈 أفضل صفقة: COMI +8.9%
📉 أسوأ صفقة: HRHO -2.1%

⚖️ معامل الربحية: 2.34
💵 إجمالي الربح: +76.8%
━━━━━━━━━━━━━━━━━━━━
🔍 تم تدقيق كل صفقة بواسطة محرك Python الكنسي
```

**التصميم البصري:**
- خلفية: `surface-container-lowest` + إطار ذهبي خفيف
- 4 KPIs كبيرة في الأعلى: إجمالي / نسبة النجاح / متوسط العائد / معامل الربحية
- شارت دائري (donut chart) يوضح نسبة الفوز/الخسارة
- جدول آخر 5 صفقات (مختصر)
- ختم "موثق" بزاوية

---

### 3.4 — كرت التنبيه السعري (Price Alert Card)
**الموقع:** `src/components/telegram/cards/PriceAlertCard.tsx`
**الوظيفة:** إشعار فوري عند ضرب سعر محدد

**النص المنسق:**
```
🔔 تنبيه سعري — منصة دليل الاستثمار
━━━━━━━━━━━━━━━━━━━━
السهم: COMI (التجاري الدولي)
السعر الحالي: 92.05 ج.م 🎯
الهدف المحقق: 92.00 ج.م

📈 العائد منذ التوصية: +8.9%
⏰ الوقت: 14:32 — 14 أكتوبر 2026

💡 إجراء مقترح: جني أرباح جزئي (50%)
━━━━━━━━━━━━━━━━━━━━
```

**التصميم البصري:**
- خلفية زمردية احتفالية (`bg-primary-container/10`)
- أيقونة 🔔 كبيرة في الوسط
- السعر الحالي بحجم كبير `font-financial`
- شريط تقدم يوضح المسافة من الدخول للهدف

---

## 📣 القسم 4: كروت الدعايا والإعلانات (Advertisement Cards)

> **ملاحظة:** كل كرت يجب أن يكون بصرياً جذاباً للسوشيال ميديا (Instagram/Twitter/Facebook) بمقاس 1080×1080px (square) أو 1080×1350px (portrait).

### 4.1 — كرت صفقة ناجحة (Successful Trade Card)
**الموقع:** `src/components/ads/cards/SuccessfulTradeCard.tsx`
**الوظيفة:** عرض صفقة رابحة كدعاية للمنصة

**التصميم البصري:**
```
┌───────────────────────────────────────┐
│  [شعار دليل الاستثمار]  ✅ صفقة ناجحة │
├───────────────────────────────────────┤
│                                       │
│         COMI                          │
│    التجاري الدولي                      │
│                                       │
│    الدخول: 84.50                      │
│    الهدف: 92.00  🎯                   │
│    العائد: +8.9%  🟢                  │
│                                       │
│    ⏱️ خلال 5 أيام                     │
│                                       │
│  📊 منصة دليل الاستثمار              │
│  [رابط المنصة]                        │
└───────────────────────────────────────┘
```
- خلفية: gradient زمردي خفيف `from-emerald-500/10 to-teal-500/10`
- العائد بحجم ضخم `text-6xl font-financial tabular-nums text-primary`
- شارة "✅ صفقة ناجحة" في الأعلى
- زر CTA في الأسفل: "ابدأ تجربتك المجانية"

---

### 4.2 — كرت درس تعليمي (Educational Lesson Card)
**الموقع:** `src/components/ads/cards/EducationalLessonCard.tsx`
**الوظيفة:** دعاية لأكاديمية الاستثمار

**التصميم البصري:**
```
┌───────────────────────────────────────┐
│  📚 أكاديمية الاستثمار               │
├───────────────────────────────────────┤
│                                       │
│  🕯️ مدرسة الشموع اليابانية            │
│                                       │
│  "الشمعة الانكماجية تسبق الانفجار"    │
│                                       │
│  3 مستويات: مبتدئ / متوسط / محترف    │
│  +50 درس تفاعلي                       │
│  +20 اختبار                           │
│                                       │
│  [ابدأ التعلم الآن]                   │
└───────────────────────────────────────┘
```
- خلفية: كهرماني دافئ `bg-amber-500/5`
- أيقونة شمعة كبيرة في المنتصف
- نص الدرس بخط Cairo bold
- مستويات كـ chips

---

### 4.3 — كرت حالة السوق اليومية (Market Pulse Card)
**الموقع:** `src/components/ads/cards/MarketPulseCard.tsx`
**الوظيفة:** ملخص سريع لحالة السوق — يُنشر يومياً

**التصميم البصري:**
```
┌───────────────────────────────────────┐
│  📊 نبض السوق — 14 أكتوبر 2026        │
├───────────────────────────────────────┤
│                                       │
│  EGX 30    24,150   +1.42% 🟢        │
│  EGX 70     4,820   +0.85% 🟢        │
│  السيولة   1.2 مليار ج.م              │
│                                       │
│  🔥 الأقوى: ESRS +3.5%               │
│  📉 الأضعف: HRHO -0.5%               │
│                                       │
│  💡 السوق صاعد — فرص شراء متاحة       │
│                                       │
│  [تداول الآن →]                      │
└───────────────────────────────────────┘
```
- خلفية: `surface-container-lowest`
- الأرقام: `font-financial tabular-nums`
- الأسهم: زمردي/أحمر حسب التغير
- شعار المنصة في الأسفل

---

### 4.4 — كرت عرض ترويجي (Promo Offer Card)
**الموقع:** `src/components/ads/cards/PromoOfferCard.tsx`
**الوظيفة:** عرض اشتراك مخفض

**التصميم البصري:**
```
┌───────────────────────────────────────┐
│  🎉 عرض لفترة محدودة                  │
├───────────────────────────────────────┤
│                                       │
│    الباقة المؤسسية                    │
│                                       │
│    299 ج.م / شهر                      │
│    بدلاً من 499 ج.م                   │
│                                       │
│    ✅ توقعات يومية                    │
│    ✅ رادار السيولة                    │
│    ✅ تحليل أساسي                      │
│    ✅ أكاديمية الاستثمار               │
│                                       │
│    ⏰ ينتهي خلال 48 ساعة               │
│                                       │
│  [اشترك الآن]                         │
└───────────────────────────────────────┘
```
- خلفية: gradient زمردي `from-primary-container/20 to-secondary/10`
- السعر القديم مشطوب (`line-through`) + الجديد بزردي ضخم
- شريط عد تنازلي (48 ساعة)
- قائمة المزايا بأيقونات ✅ زمردية

---

### 4.5 — كرت شهادة المستخدم (Testimonial Card)
**الموقع:** `src/components/ads/cards/TestimonialCard.tsx`
**الوظيفة:** آراء العملاء

**التصميم البصري:**
```
┌───────────────────────────────────────┐
│  💬 آراء عملائنا                       │
├───────────────────────────────────────┤
│                                       │
│  "المنصة غيرت طريقة تداولي تماماً.    │
│   التوقعات دقيقة جداً والرادار       │
│   بيحددلي الفرص قبل ما تحصل."         │
│                                       │
│  — أحمد محمد، مستثمر                  │
│    عضوية: 8 أشهر                      │
│                                       │
│  ⭐⭐⭐⭐⭐ (4.9/5)                    │
└───────────────────────────────────────┘
```
- خلفية: `surface-container-low` + border زمردي
- نجوم التقييم زمردية
- نص الشهادة بخط Cairo
- صورة العميل (دائرة) + اسمه

---

## 📁 خريطة الملفات (File Location Map)

> **هذا القسم مرجعي لي (Alpha) عند بناء المكونات لاحقاً.**

### لوحة الأدمن
| المكون | المسار | المصدر Stitch |
|--------|--------|----------------|
| AdminView (main) | `src/modules/admin/components/AdminView.tsx` | admin dashboard |
| PlatformPerformanceView | `src/modules/admin/components/platform-performance/PlatformPerformanceView.tsx` | admin_honest_audit |
| Telegram Predictions | `src/modules/admin/components/TelegramPredictionsPanel.tsx` | (new — create) |
| AI Gatekeeper | `src/modules/admin/components/AIGatekeeperPanel.tsx` | (new — create) |
| Engine Settings | `src/modules/admin/components/EngineSettingsPanel.tsx` | (new — create) |
| DB Manager | `src/modules/admin/components/DBManagerPanel.tsx` | (new — create) |
| System Health | `src/modules/admin/components/SystemHealthPanel.tsx` | (new — create) |

### الكروت القابلة لإعادة الاستخدام
| المكون | المسار | الاستخدام |
|--------|--------|-----------|
| SignalCard | `src/components/shared/cards/SignalCard.tsx` | VIPLiveSignalsFeed, MarketAnalysis |
| PredictionCard | `src/components/shared/cards/PredictionCard.tsx` | PredictionTracking, Watchlist |
| StockMiniCard | `src/components/shared/cards/StockMiniCard.tsx` | Search results, lists |
| NewsCard | `src/components/shared/cards/NewsCard.tsx` | NewsFeedView |
| KPICard | `src/components/shared/cards/KPICard.tsx` | All dashboards |
| ClosedTradeCard | `src/components/shared/cards/ClosedTradeCard.tsx` | Track record, reports |
| MarketRegimeCard | `src/components/shared/cards/MarketRegimeCard.tsx` | Dashboard, admin |
| CatalystCard | `src/components/shared/cards/CatalystCard.tsx` | Inside SignalCard |

### كروت التليجرام
| المكون | المسار | المقاس |
|--------|--------|--------|
| StockRecommendationCard | `src/components/telegram/cards/StockRecommendationCard.tsx` | 1080×1350 portrait |
| DailyReportCard | `src/components/telegram/cards/DailyReportCard.tsx` | 1080×1350 portrait |
| TrackRecordCard | `src/components/telegram/cards/TrackRecordCard.tsx` | 1080×1350 portrait |
| PriceAlertCard | `src/components/telegram/cards/PriceAlertCard.tsx` | 1080×1080 square |

### كروت الدعايا
| المكون | المسار | المقاس |
|--------|--------|--------|
| SuccessfulTradeCard | `src/components/ads/cards/SuccessfulTradeCard.tsx` | 1080×1080 square |
| EducationalLessonCard | `src/components/ads/cards/EducationalLessonCard.tsx` | 1080×1080 square |
| MarketPulseCard | `src/components/ads/cards/MarketPulseCard.tsx` | 1080×1080 square |
| PromoOfferCard | `src/components/ads/cards/PromoOfferCard.tsx` | 1080×1350 portrait |
| TestimonialCard | `src/components/ads/cards/TestimonialCard.tsx` | 1080×1080 square |

---

## ✅ قائمة التحقق النهائية لكل كرت/شاشة

لكل تصميم تُنتجه Stitch، تأكد من:

- [ ] **RTL**: كل النصوص من اليمين لليسار
- [ ] **الألوان**: فقط زمردي (#4edea3) / مينت (#80d5cb) / كهرماني / فحمي — **صفر أزرق**
- [ ] **الخطوط**: Outfit للعناوين، Cairo للعربي، JetBrains Mono للأرقام
- [ ] **tabular-nums**: كل الأرقام المالية
- [ ] **Glassmorphism**: backdrop-blur + خلفيات شفافة
- [ ] **Material Symbols**: أيقونات Material Design 3
- [ ] **Responsive**: يعمل على موبايل (375px) + ديسكتوب (1920px)
- [ ] **Dark Mode**: التصميم الأساسي للوضع الداكن
- [ ] **خلفية**: `surface-container-lowest` (#0c0f0e) كخلفية رئيسية
- [ ] **الحدود**: `border-outline-variant/30` للكروت
- [ ] **شعار المنصة**: "دليل الاستثمار" + "GLM INVESTMENT TERMINAL" في كل كرت تليجرام/دعايا

---

## 🎯 التعليمات النهائية لـ Stitch

**أرجو إنتاج:**
1. **7 شاشات أدمن** كاملة (code.html لكل واحدة)
2. **8 كروت قابلة لإعادة الاستخدام** (code.html لكل واحد)
3. **4 كروت تليجرام** (code.html + screen.png لكل واحد)
4. **5 كروت دعايا** (code.html + screen.png لكل واحد)

**المجموع:** 24 تصميم في ملفات منفصلة

**لكل تصميم:**
- ملف `code.html` يحتوي على HTML + Tailwind CSS (مع CDN tailwindcss)
- ملف `screen.png` كمعاينة بصرية
- استخدم نفس نظام الألوان والخطوط في كل التصميمات
- التزم بـ RTL + tabular-nums + Material Symbols

**بنية المجلدات المقترحة:**
```
stitch_admin_and_cards/
├── admin/
│   ├── 01_admin_home/
│   ├── 02_honest_audit/
│   ├── 03_telegram_manager/
│   ├── 04_ai_gatekeeper/
│   ├── 05_engine_settings/
│   ├── 06_db_manager/
│   └── 07_system_health/
├── cards/
│   ├── 01_signal_card/
│   ├── 02_prediction_card/
│   ├── 03_stock_mini/
│   ├── 04_news_card/
│   ├── 05_kpi_card/
│   ├── 06_closed_trade/
│   ├── 07_market_regime/
│   └── 08_catalyst/
├── telegram/
│   ├── 01_stock_recommendation/
│   ├── 02_daily_report/
│   ├── 03_track_record/
│   └── 04_price_alert/
└── ads/
    ├── 01_successful_trade/
    ├── 02_educational_lesson/
    ├── 03_market_pulse/
    ├── 04_promo_offer/
    └── 05_testimonial/
```

**رسالة الالتزام:**
> كل تصميم يجب أن يطابق الهوية البصرية للـ Sovereign Terminal: زمردي فاخر على فحمي عميق، أرقام JetBrains Mono دقيقة، واتساق كامل مع نظام Material Design 3.
