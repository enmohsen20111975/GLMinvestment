# UX_SCREEN_DESIGN_PACKAGE — حزمة مواصفات تصميم واجهات GLMinvestment الكاملة

> **هذا الملف وثيقة تنفيذية موحّدة** تضم كل المراحل التحليلية (A + B + C + D + E + الملحق FX) في ملف واحد قابل للاستخدام المباشر في Google Stitch وللتسليم لفريق البرمجة.
>
> **المُعدّ**: سوسو (CEO Agent — الرئيس التنفيذي التقني)
> **تاريخ الإعداد**: 2026-10-14
> **الإصدار**: 1.0
> **المنصة المستهدفة**: https://stitch.withgoogle.com/
> **المشروع**: GLMinvestment v3.4.41 — https://invist.m2y.net
> **المصدر المعتمد للجرد**: GitHub HEAD `2fc94134` — `src/lib/valid-views.ts` (SSOT)
>
> **كيف تستخدم هذا الملف؟**
> - للمالك: اقرأ "الملخص التنفيذي" ثم انتقل لـ "حزمة Google Stitch" لنسخ البرومبتات مباشرةً.
> - لمصمم Stitch: ابدأ بـ "PROJECT_DESIGN_BRIEF" ثم "DESIGN_SYSTEM_BRIEF" ثم البرومبت المناسب لكل شاشة.
> - لفريق البرمجة: انتقل لـ "HANDOFF_TO_DEVELOPMENT" لربط المعرفات بالملفات الفعلية.
> - لـ QA: استخدم "DESIGN_REVIEW_CHECKLIST" لمراجعة المخرجات.

---

## 📑 الفهرس

1. [الملخص التنفيذي](#1-الملخص-التنفيذي)
2. [المرحلة A — تثبيت نطاق التصميم (SCREEN_INVENTORY)](#2-المرحلة-a--تثبيت-نطاق-التصميم)
3. [المرحلة B — بناء تجربة المستخدم (USER_FLOWS)](#3-المرحلة-b--بناء-تجربة-المستخدم)
4. [المرحلة C — المواصفات التفصيلية لكل شاشة (SCREEN_SPECIFICATIONS)](#4-المرحلة-c--المواصفات-التفصيلية-لكل-شاشة)
5. [المرحلة D — نظام تصميم موحد (DESIGN_SYSTEM_BRIEF)](#5-المرحلة-d--نظام-تصميم-موحد)
6. [المرحلة E — حزمة Google Stitch الـ 8 ملفات](#6-المرحلة-e--حزمة-google-stitch-الـ-8-ملفات)
   - 6.1 PROJECT_DESIGN_BRIEF
   - 6.2 DESIGN_SYSTEM_BRIEF
   - 6.3 SCREEN_INVENTORY
   - 6.4 USER_FLOWS
   - 6.5 SCREEN_SPECIFICATIONS
   - 6.6 STITCH_PROMPTS (برومبت لكل شاشة)
   - 6.7 DESIGN_REVIEW_CHECKLIST
   - 6.8 HANDOFF_TO_DEVELOPMENT
7. [الملحق FX — التحسينات + المستبعدة + Flutter + المخالفات](#7-الملحق-fx)

---

## 1) الملخص التنفيذي

### 1.1 ما هذه الحزمة؟

حزمة مواصفات تصميم واجهات مستخدم كاملة لمنصة **GLMinvestment** (منصة استثمار البورصة المصرية EGX + أسواق خليجية + كريبتو). تغطي **59 شاشة/حالة** موزّعة على:
- 26 شاشة EGX نشطة.
- 3 شاشات Crypto مستقلة (+ 8 مُدمجة).
- 3 شاشات Islamic.
- 5 شاشات Account/Subscription.
- 5 صفحات قانونية ومساعدة.
- 4 شاشات إدارة (+ 20+ sub-tabs).
- 5 overlays (حالات مصادقة/اشتراك).
- 8 ملفات بنية تحتية.

### 1.2 المنهجية المعتمدة

- **مصدر الجرد الأساسي**: GitHub HEAD `2fc94134` — ملف `src/lib/valid-views.ts` (SSOT).
- **التوثيق المرجعي**: 14 ملف في `Documentation/` (CONSTITUTION + ARCHITECTURE + SCREENS + HOW_IT_THINKS + CURRENT_STATE + PHASE2_SNAPSHOT + ENGINEER_SOUL + MASTER_STRATEGIC_PLAN).
- **82 قاعدة دستورية** تحكم التصميم (76 في CONSTITUTION + 6 في MASTER_STRATEGIC_PLAN).
- **فحص بأربعة وكلاء Explore بالتوازي** (Pages + Modules + API + Docs).
- **لا تخمين**: كل شاشة موثّقة بالأدلة من الكود + التوثيق.

### 1.3 الهوية البصرية المعتمدة

| البند | القيمة |
|---|---|
| اتجاه التصميم | احترافي مالي / Bloomberg terminal feel + عربي فصيح |
| اللون الأساسي | Emerald-600 `#10B981` (hsl 160 84% 39%) |
| ممنوع | blue/indigo (Rule 30 ممارسة) |
| الخط العربي | Cairo (مع Tajawal fallback) |
| خط الأرقام | JetBrains Mono + tabular-nums |
| العناوين اللاتينية | Outfit |
| radius | 0.75rem (12px) |
| Shadows | dual-layer (shadow-sm + ring-1 ring-border/50) |
| RTL | إلزامي (`dir="rtl"`) |
| المكتبة | shadcn/ui (new-york style) + Recharts + lucide-react |

### 1.4 القرارات المعتمدة من المالك (قبل إعداد الحزمة)

| القرار | القيمة |
|---|---|
| Q1 — البيئة المستهدفة | الإنتاج الكاملة + توثيق حالات empty/error |
| Q2 — معرفات الشاشات | `SCR-*` توثيقية فقط (لا تنفيذ برمجي) |
| Q3 — المخالفات التقنية | توثيق فقط (لا إصلاح) |
| Q4 — مصدر الجرد | GitHub HEAD `2fc94134` |
| Q5 — حجم التسليم | ملف واحد شامل |
| Q6 — الشاشات المقترحة | ملحق منفصل (لا تنفيذ) |
| Q7 — الشاشات الميتة | مستبعدة من النطاق |
| Q8 — Flutter | ملاحظة مستقلة (لا مواصفات) |
| Q9 — مزامنة GitHub | لا git pull (فحص مباشر من GitHub API) |
| Q10 — التحقق البصري | من الكود + التوثيق (لا Agent Browser إلزامي) |

### 1.5 الإجمالي

| الفئة | العدد |
|---|---|
| شاشات EGX نشطة | 26 |
| شاشات Crypto مستقلة | 3 |
| شاشات Islamic | 3 |
| شاشات Account/Subscription | 5 |
| صفحات قانونية ومساعدة | 5 |
| شاشات إدارة | 4 (+ 20 sub-tabs) |
| Overlays | 5 |
| بنية تحتية | 8 |
| **الإجمالي للتصميم** | **59** |
| شاشات DEAD مستبعدة | 8 |
| شاشات مقترحة (لا تنفيذ) | 3 |

---

## 2) المرحلة A — تثبيت نطاق التصميم

### 2.1 قائمة الشاشات الموحدة المعتمدة (مصدر: `valid-views.ts` + `page.tsx` switch على GitHub HEAD)

القائمة المعتمدة رسميًا في `VALID_VIEWS` هي **56 اسم view** + **11 صفحة App Router مستقلة**. بعد دمج الـ aliases و الـ crypto redirects، الناتج **43 شاشة فعلية** + 5 overlays + 8 بنية تحتية = **59 شاشة/حالة**.

### 2.2 أ. شاشات المستخدم العادي (EGX) — 26 شاشة

| المعرف | Hash Route | الاسم | الهدف | الجمهور | الأولوية |
|---|---|---|---|---|---|
| **SCR-001** | `#dashboard` | لوحة المعلومات الرئيسية | نقطة الدخول الافتراضية + نظرة عامة على السوق + إشارات + محفظتي | كل المستخدمين (الزائر يرى نسخة محدودة) | P0 |
| **SCR-002** | `#stocks` | قائمة الأسهم | استعراض + بحث + فلترة أسهم السوق | مسجّل + مدفوع | P0 |
| **SCR-003** | `#stock-filters` *(= `#top-performers` = `#screener`)* | الفلترة المتقدمة | فلترة Python screener متعدد المعايير | مسجّل + مدفوع | P1 |
| **SCR-004** | `#trading-chart` | الرسم البياني | TradingView widget بفترات متعددة | مسجّل + مدفوع | P1 |
| **SCR-005** | `#portfolio` | المحفظة | عرض المراكز + P&L + مدير محفظة + robo-advisor | مسجّل + مدفوع | P0 |
| **SCR-006** | `#watchlist` | قائمة المراقبة | أسهم يتابعها المستخدم + إشارات ذكاء | مسجّل + مدفوع | P0 |
| **SCR-007** | `#recommendations` *(= `#analysis` = `#v2-analysis` = `#advanced-analysis` = `#unified-analysis`)* | متابعة التوقعات | 6-7 tabs: توقعات + tracking + summary + missed + learn-from-errors + expert + live | مسجّل + مدفوع | P0 |
| **SCR-008** | `#smart-confluence` | توقعات Confluence | 20 BUY predictions من V40.2 | مدفوع | P1 |
| **SCR-009** | `#specialist-analysis` | التحليل المتخصص | Fibonacci + Candlestick + جداول قرار | مسجّل + مدفوع | P2 |
| **SCR-010** | `#prediction-tracking` *(= `#picks-management`)* | تتبع التوقعات | تتبع أداء توقعات سابقة | مسجّل + مدفوع | P1 |
| **SCR-011** | `#dual-track` | التوقعات المزدوجة | persona predictions (comparison تاريخي رغم إعدام نظام الشخصيات) | مدفوع | P2 |
| **SCR-012** | `#v82` | محرك القرار المؤسسي V82 | لوحة قرار مؤسسي | مدفوع | P2 |
| **SCR-013** | `#reports` | التقارير | بطاقات صور تقارير بفترات | مسجّل + مدفوع | P2 |
| **SCR-014** | `#news` | الأخبار | feed أخبار مفلترة | مسجّل + مدفوع | P1 |
| **SCR-015** | `#simulation` | المحاكاة | paper-trading-v2 | مسجّل + مدفوع | P2 |
| **SCR-016** | `#academy` | الأكاديمية | 5 tabs تعليم + موسوعة + محاكاة | مسجّل + مدفوع | P2 |
| **SCR-017** | `#bagholder-rescue` | إنقاذ سهم خسران | تشخيص + 3 قرارات CUT/AVERAGE/HOLD | مسجّل + مدفوع | P1 |
| **SCR-018** | `#advanced-portfolio` | المحفظة المتقدمة | تحليل عميق + risk quiz | مدفوع | P2 |
| **SCR-019** | `#seasonality` | الموسمية | لوحة أنماط موسمية | مسجّل + مدفوع | P3 |
| **SCR-020** | `#liquidity-radar` | رادار السيولة | 4 أعمدة (الحوت/الحالة/المرحلة/الدخول) | مدفوع | P1 |
| **SCR-021** | `#market-depth` | عمق السوق | تدفق سيولة + intraday pressure + investors flow | مسجّل + مدفوع | P2 |
| **SCR-022** | `#alerts-center` | مركز التنبيهات | smart alerts + sniper scan | مسجّل + مدفوع | P1 |
| **SCR-023** | `#live-monitor` | المراقبة الحية | مراقبة محفظة لحظية | مسجّل + مدفوع | P2 |
| **SCR-024** | `#wealth` *(= `#finance`)* | الثروة | wealth charts + real return + inflation | مسجّل + مدفوع | P2 |
| **SCR-025** | `#trading-memory` | ذاكرة التداول | insights من `/api/python/v4/insight/*` | مدفوع | P3 |
| **SCR-026** | `#publishing` | النشر | نشر سهم + بطاقات إنفوجرافيك | مسجّل + مدفوع | P3 |

### 2.3 ب. شاشات العملات الرقمية (Crypto — UI-Mirror) — 3 شاشات مستقلة

وفقًا لـ `CRYPTO_VIEW_REDIRECTS` في `valid-views.ts`، معظم `crypto-*` views تُدمج في الـ unified views مع `setCurrentMarket('CRYPTO')`. لكن **3 شاشات لها components مستقلة** (لا تُدمج):

| المعرف | Hash Route | الاسم | الهدف | الأولوية |
|---|---|---|---|---|
| **SCR-CR-001** | `#crypto-portfolio` | محفظة الكريبتو | CryptoPortfolioView مستقل | P1 |
| **SCR-CR-002** | `#crypto-watchlist` | قائمة مراقبة كريبتو | EnhancedWatchlistView مع CRYPTO | P1 |
| **SCR-CR-003** | `#crypto-prediction-tracking` | تتبع توقعات الكريبتو | CryptoPredictionTrackingView مستقل | P2 |

*(8 crypto views أخرى تُدمج: `#crypto`, `#crypto-live`, `#crypto-recommendations`, `#crypto-trading-chart`, `#crypto-screener`, `#crypto-analysis`, `#crypto-learning`, `#crypto-simulation` → كلها redirect لـ unified views مع `currentMarket='CRYPTO'`.)*

### 2.4 ج. الشاشات الإسلامية — 3 شاشات

| المعرف | Hash Route | الاسم | الهدف | الأولوية |
|---|---|---|---|---|
| **SCR-IS-001** | `#zakat` | حاسبة الزكاة | حساب زكاة الأموال | P2 |
| **SCR-IS-002** | `#tithes` | حاسبة العشور | حساب العشور | P3 |
| **SCR-IS-003** | `#sharia` | التوافق الشرعي | 3 tabs: قائمة 253 سهم + تطهير صفقة + تطهير محفظة | P2 |

### 2.5 د. شاشات الحساب والاشتراك — 5 شاشات

| المعرف | Hash Route / المسار | الاسم | الهدف | الجمهور | الأولوية |
|---|---|---|---|---|---|
| **SCR-AC-001** | `#auth` | تسجيل الدخول/التسجيل | AuthView: Google + (Credentials في dev) | زائر | P0 |
| **SCR-AC-002** | `#subscription` | الاشتراكات | PricingView + مقارنة + B2B | مسجّل (Free) | P0 |
| **SCR-AC-003** | `#settings` | الإعدادات | تفضيلات + عملة عرض + لغة | مسجّل + مدفوع | P2 |
| **SCR-AC-004** | `#about` | من نحن | تعريف المنصة | كل المستخدمين | P3 |
| **SCR-AC-005** | `#rescue` / `/rescue` | عيادة الإنقاذ | صفحة مستقلة (App Router) لـ BagHolderRescuePanel | مسجّل + مدفوع | P1 |

### 2.6 هـ. الصفحات القانونية والمساعدة — 5 صفحات

| المعرف | المسار | الاسم | الهدف | الأولوية |
|---|---|---|---|---|
| **SCR-LG-001** | `/legal/terms` | شروط الاستخدام | نص قانوني | P2 |
| **SCR-LG-002** | `/legal/disclaimer` | إخلاء المسؤولية | تحذير استثماري | P0 |
| **SCR-LG-003** | `/legal/privacy` | سياسة الخصوصية | حماية البيانات | P2 |
| **SCR-PG-001** | `/payment/success` | نجاح الدفع | polling على status بعد checkout | P0 |
| **SCR-PG-002** | `/backtest` | تحليل walk-forward | عرض نتائج backtest | P2 |

### 2.7 و. شاشات الإدارة — 4 شاشات رئيسية + 20+ sub-tabs

| المعرف | المسار | الاسم | الهدف | الجمهور | الأولوية |
|---|---|---|---|---|---|
| **SCR-AD-001** | `#admin` | لوحة الإدارة الرئيسية | 20+ sub-tabs notebook | أدمن فقط | P1 |
| **SCR-AD-002** | `/admin/honest-predictions` | التوقعات الصادقة | Recharts + جدول + فلاتر (1855 سطر — أكبر صفحة) | أدمن فقط | P1 |
| **SCR-AD-003** | `/admin/educational-cards` | الكروت التعليمية | CRUD كروت | أدمن فقط | P2 |
| **SCR-AD-004** | `/admin/reports` | تقارير الدوري | بطاقات صور بفترات | أدمن فقط | P2 |

### 2.8 ز. حالات المصادقة والاشتراك (Overlays — ليست شاشات منفصلة)

| المعرف | النوع | الاسم | المتطلّب |
|---|---|---|---|
| **SCR-OV-001** | Overlay | LoginPromptModal | يظهر عند محاولة فتح PROTECTED_VIEWS |
| **SCR-OV-002** | Overlay | TrialCountdownBanner | آخر 7 أيام |
| **SCR-OV-003** | Overlay (fullscreen) | TrialExpiredModal | انتهاء الـ trial |
| **SCR-OV-004** | Overlay (non-dismissible) | SessionExpiredModal | 401 من API |
| **SCR-OV-005** | Overlay | InstapayModal | رفع إيصال دفع |

### 2.9 ح. البنية التحتية المشتركة (8 ملفات)

| المعرف | الملف | الوظيفة |
|---|---|---|
| **SCR-IN-001** | `layout.tsx` | Root layout + Providers + RTL + i18n + SEO |
| **SCR-IN-002** | `globals.css` | نظام الألوان + الخطوط + tabular-nums |
| **SCR-IN-003** | `error.tsx` | App-level error boundary |
| **SCR-IN-004** | `global-error.tsx` | Root boundary (⚠️ مخالفة Rule 30 محتملة — موثّقة في الملحق FX-3) |
| **SCR-IN-005** | `not-found.tsx` | 404 عربية |
| **SCR-IN-006** | `loading.tsx` | Suspense skeleton |
| **SCR-IN-007** | `robots.ts` | robots.txt |
| **SCR-IN-008** | `sitemap.ts` | sitemap.xml (⚠️ روابط `?view=` لا تتوافق مع hash routing — موثّقة في الملحق FX-3) |

### 2.10 سجل الشاشات المستبعدة (DEAD — خارج نطاق التصميم)

| المعرف | الاسم | سبب الاستبعاد | الإثبات |
|---|---|---|---|
| ~~SCR-X01~~ | `#maestro` | DELETE-MAESTRO 2026-10-12 — 556KB dead code أرشيف | `archive/` |
| ~~SCR-X02~~ | `#learning` | Archived Wave 3 → موحد في `#academy` | `archive/wave-2-cleanup-2026-10-01/` |
| ~~SCR-X03~~ | `#advanced-analysis` (مستقل) | Redirect لـ `#recommendations` (v3.66.8) — alias | valid-views.ts |
| ~~SCR-X04~~ | `#picks-management` (مستقل) | Alias للـ PredictionTrackingView | valid-views.ts |
| ~~SCR-X05~~ | `#community` | Sidebar removed + orphan (581 LOC) | `archive/dead-components-20261012/` |
| ~~SCR-X06~~ | `#prediction-performance` | Admin-only placeholder | 02-SCREENS §1 |
| ~~SCR-X07~~ | `#prediction-credibility` | Admin-only placeholder | 02-SCREENS §1 |
| ~~SCR-X08~~ | `#trading-journal` (مستقل) | DEAD (موزّع على admin/recommendations/specialist-analysis) | `archive/dead-components-20261012/` |

**إجمالي dead code مؤرشف**: ~9,849 LOC (4,408 LOC orphan + 5,441 LOC wave-2).

---

## 3) المرحلة B — بناء تجربة المستخدم

### 3.1 خريطة التنقل الرئيسية

```
                    ┌─────────────────────────────┐
                    │  نقطة الدخول: / (layout.tsx)  │
                    │  RTL + i18n cookie + SEO     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   useSession() — حالة الجلسة  │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼─────────────────────────┐
          │                        │                         │
   ┌──────▼───────┐         ┌──────▼───────┐          ┌──────▼───────┐
   │ Unauthenticated│      │  Loading     │          │ Authenticated │
   └──────┬───────┘         └──────────────┘          └──────┬───────┘
          │                                                    │
   ┌──────▼─────────────┐                              ┌──────▼──────────────┐
   │ SCR-AC-001 (#auth)  │                              │  AuthGate (guard)    │
   │  - Google login     │                              └──────┬──────────────┘
   │  - Credentials(dev) │                                     │
   │  - LoginPromptModal │                    ┌────────────────┼────────────────┐
   │    (on protected)   │                    │                │                │
   └─────────────────────┘                    │                │                │
                                   ┌──────────▼───┐    ┌──────▼──────┐    ┌──────▼────────┐
                                   │ Free + Trial │    │ Paid/Admin  │    │ Free + Expired│
                                   │ Bannercountdown│    │ Full access │    │ Modal Expired │
                                   └──────────┬───┘    └──────┬──────┘    └───────────────┘
                                              │               │
                                              └───────┬───────┘
                                                      │
                                       ┌──────────────▼──────────────┐
                                       │   AppShell (page.tsx)       │
                                       │   ┌─────────────────────┐   │
                                       │   │ TopBar (desktop)    │   │
                                       │   │ 5 dropdowns + Market │   │
                                       │   │ Switcher + Currency  │   │
                                       │   ├─────────────────────┤   │
                                       │   │ MobileNav (mobile)  │   │
                                       │   │ 5 أيقونات ثابتة     │   │
                                       │   ├─────────────────────┤   │
                                       │   │ renderView() switch │   │
                                       │   │ (50+ hash views)    │   │
                                       │   ├─────────────────────┤   │
                                       │   │ Footer (sticky)     │   │
                                       │   └─────────────────────┘   │
                                       └─────────────────────────────┘
```

### 3.2 التنقل الرئيسي (Desktop — TopBar)

| القسم | يحتوي | الـ views |
|---|---|---|
| **الرئيسية** | dashboard | `#dashboard` |
| **السوق** | stocks / stock-filters / trading-chart / screener / smart-confluence | `#stocks`, `#stock-filters`, `#trading-chart`, `#screener`, `#smart-confluence` |
| **التوقعات** | recommendations / picks-management / specialist-analysis / reports | `#recommendations`, `#picks-management`, `#specialist-analysis`, `#reports` |
| **أموالي** | portfolio / watchlist / alerts-center / live-monitor / trading-memory | `#portfolio`, `#watchlist`, `#alerts-center`, `#live-monitor`, `#trading-memory` |
| **المزيد** | news / learning / simulation / academy / crypto / zakat / settings | `#news`, `#academy`, `#simulation`, `#crypto`, `#zakat`, `#settings` |
| **Market Switcher** | 🇪🇬 EGX / 🇸🇦 TADAWUL / 🇰🇼 KSE / 🇶🇦 QSE / 🪙 CRYPTO | يبدّل `currentMarket` في store |

### 3.3 التنقل الفرعي (Mobile — MobileNav)

5 أيقونات ثابتة (safe-area-inset-bottom):

1. 🏠 الرئيسية → `#dashboard`
2. 📈 التوقعات → `#recommendations`
3. 💰 المحفظة → `#portfolio`
4. 📡 الرادار → `#liquidity-radar`
5. 📊 الشارت → `#trading-chart`

**MobileMoreSheet** (يفتح من Header): إنقاذ سهم / قوائم المراقبة / التوافق الشرعي / المحاكاة / الأكاديمية / من نحن / الإعدادات / حسابي.

### 3.4 رحلات المستخدم الأساسية

#### رحلة 1: زائر → مشترك مدفوع (Conversion Funnel)

```
1. الزائر يدخل / 
   → يرى SCR-001 (Dashboard) بنسخة محدودة (لا بيانات محفظة)
   → TrialCountdownBanner غير ظاهر (لم يسجّل بعد)

2. الزائر يحاول فتح #portfolio (PROTECTED_VIEW)
   → toast warning + LoginPromptModal (SCR-OV-001)
   → زر "سجّل مجاناً" → AuthView tab=register (SCR-AC-001)

3. المستخدم يسجّل عبر Google
   → يدخل #dashboard كـ Free + Trial
   → TrialCountdownBanner يظهر (آخر 7 أيام → amber → red)

4. المستخدم يضغط "اشترك الآن" على الـ banner
   → Dialog ي host PricingView
   → يختار خطة → /api/subscription/checkout → InstapayModal (SCR-OV-005)

5. المستخدم يرفع إيصال Instapay
   → redirect إلى /payment/success (SCR-PG-001)
   → polling على /api/subscription/status كل 2s (حد 30s)
   → status: success → يصبح premium/pro/vip_pass/developer

6. TrialExpiredModal يُغلق تلقائيًا عند نجاح الدفع
```

#### رحلة 2: مستخدم يستكشف سهمًا → يرى توصية → يتابعها

```
1. #dashboard → يرى TopMovers
2. ينقر على سهم → #stock-detail (داخل #stocks view)
   → يرى السعر + المؤشرات + التحليل الفني + شارت TradingView

3. ينقر "التوصية" tab → يرى TradePlanCard (إن كان BUY/STRONG_BUY/ACCUMULATE)
   → Rule 78: لـ SELL/AVOID/HOLD/WAIT يرى شريط تحذيري مؤسسي (لا TradePlanCard)

4. يضيف السهم لقائمة المراقبة → #watchlist

5. ينتقل لـ #recommendations → tab "متابعة التوقعات"
   → يرى التوصية في قائمة التتبع
   → ينقر "تحقق من المعلقة" → يتأكد من hit target / hit stop
```

#### رحلة 3: مستخدم محفظته خاسرة → إنقاذ

```
1. #portfolio → يرى P&L سلبي على سهم
2. ينقر "إنقاذ السهم" (زر ضمن PortfolioItem)
   → redirect إلى /rescue?ticker=...&buy_price=...&quantity=...
3. BagHolderRescuePanel يفتح:
   - تشخيص جذري (لماذا السهم خسران؟)
   - تقييم مؤسسي (regime + money flow)
   - 3 قرارات صارمة:
     A. CUT_LOSS (شريط أحمر)
     B. AVERAGE_DOWN (شريط amber)
     C. HOLD (شريط أخضر)
   - خطة استعادة رأس المال
```

#### رحلة 4: مستخدم يتنقّل بين الأسواق

```
1. #dashboard (EGX)
2. ينقر Market Switcher → يختار 🪎 CRYPTO
   → setCurrentMarket('CRYPTO') في store
3. #dashboard يعرض الآن بيانات CRYPTO (UI-Mirror Protocol)
4. ينقر "التوصيات" → #recommendations مع CRYPTO
5. ينقر "محفظتي" → #crypto-portfolio (component مستقل، SCR-CR-001)
```

#### رحلة 5: أدمن يدير التوقعات

```
1. أدمن يدخل /admin (server gate يتحقق)
2. redirect إلى #admin
3. يفتح NotebookAdminTab → Tab "Predictions management"
4. يضغط "توليد التوقعات" → POST /api/admin/generate-predictions
5. يفتح /admin/honest-predictions (SCR-AD-002)
   → يرى charts + جدول + filters
6. يضغط "إغلاق المعلقة" → POST /api/admin/close-predictions
```

### 3.5 ما الذي يستطيع الزائر فعله؟ (قبل التسجيل)

| الفعل | مسموح؟ | الأثر |
|---|---|---|
| تصفّح `#dashboard` | ✅ نعم (نسخة محدودة) | لا بيانات محفظة/توصية مخصصة |
| فتح `#stocks` / `#screener` | ⚠️ جزئي | يرى قائمة لكن PROTECTED_VIEW يطلبه LoginPromptModal |
| فتح `#portfolio` / `#watchlist` / `#recommendations` | 🚫 لا | LoginPromptModal + redirect لـ `#dashboard` |
| تصفّح `/legal/*` | ✅ نعم | صفحات قانونية مفتوحة |
| فتح `#about` | ✅ نعم | |
| فتح `#subscription` | ✅ نعم | يرى PricingView |

### 3.6 ما الذي يتغير بعد التسجيل/الاشتراك؟

| الحالة | الصلاحيات الإضافية |
|---|---|
| **Free + Trial نشط** | وصول كامل لكل PROTECTED_VIEWS أثناء الـ trial (افتراضيًا 7 أيام) |
| **Free + Trial منتهي** | TrialExpiredModal fullscreen (لا إغلاق) → redirect لـ `#subscription` |
| **Premium** | وصول كامل + سقف استخدام أعلى (ai_messages / watchlist count) |
| **Pro** | + ميزات متقدمة (advanced-portfolio, specialist-analysis) |
| **VIP Pass** | + VIPLiveSignalsFeed + AuditedPerformanceView |
| **Developer** | + B2B API key + limits أعلى |
| **Admin** | + `#admin` + `/admin/*` |

### 3.7 حالات البيانات غير المتاحة والأخطاء

وفقًا لـ Rule 27 (NO-FAKE-DATA)، كل شاشة يجب أن تصمم الحالات التالية:

| الحالة | التصميم المعتمد | النص العربي المقترح |
|---|---|---|
| **تحميل** | LazyTabLoader skeleton (spinner + "بيتحمّل {label}...") | "جارٍ التحميل..." |
| **بيانات فارغة** | EmptyState component (أيقونة + نص + CTA) | "لا توجد بيانات لعرضها" + زر "أضف الآن" إن أمكن |
| **فشل الاتصال بالـ API** | ErrorBoundary Card (AlertTriangle + Retry + Home) | "تعذّر تحميل البيانات. تحقّق من اتصالك." |
| **انتهاء مهلة الطلب (timeout)** | نفس ErrorBoundary + زر "إعادة المحاولة" | "انتهت مهلة الطلب. حاول مرة أخرى." |
| **بيانات قديمة (stale)** | Badge "آخر تحديث: منذ X دقيقة" + زر "تحديث" | "البيانات قد تكون قديمة" |
| **رفض الصلاحية (403)** | redirect لـ `#dashboard` + toast | "لا تملك صلاحية الوصول لهذه الصفحة" |
| **انتهاء الاشتراك** | TrialExpiredModal (fullscreen) | "انتهت فترة التجربة المجانية" |
| **تجاوز حد الاستخدام** | toast + UpgradePrompt | "لقد تجاوزت حد الاستخدام اليومي. اشترك للمتابعة." |
| **فشل الدفع** | ErrorState في `/payment/success` | "فشل التحقق من الدفع. حاول مرة أخرى." |
| **لا نتائج بحث** | EmptyState | "لا توجد نتائج مطابقة لبحثك" |
| **خطأ غير متوقع** | global-error.tsx (root boundary) | "حدث خطأ غير متوقع" |
| **Rule 27 NULL** | "—" (لا 0، لا 50، لا placeholder) | "بيانات غير متاحة" |

### 3.8 نقاط الازدحام والتكرار القابلة للتحسين (دون إضافة وظائف)

| المشكلة | الموقع | التوصية (لا تنفيذ) |
|---|---|---|
| `Header.tsx` يستدعي `toggleSidebar()` بدون Sidebar مُмонتد | dead code | إزالة الاستدعاء (تنظيف) |
| `DisplayCurrencyToggle` function مكررة في Header | inline + function غير مستخدمة | إزالة الـ dead function |
| `ShareButton` في مكانين | components/share + modules/publishing | توحيد في modules/publishing |
| `MaestroWidget` معطّل لكن import قد يبقى | dashboard/index.ts | تأكيد إزالة الـ import |
| `PersonaSelector` معطّل لكن قد يبقى في Header | persona/ | تأكيد إزالة الاستدعاء |
| `StoredAnalysisView` + `LearningView` مؤرشفان لكن في page.tsx تعليق | page.tsx سطور 77-82, 135-141 | إزالة التعليقات |
| `Watchlist` Prisma model في auth-schema غير مستخدم | prisma | توثيق كـ dead schema |
| `price_history.db` في SHARED_DB_NAMES لكن مدمج | shared-db.ts | تحديث القائمة |

---

## 4) المرحلة C — المواصفات التفصيلية لكل شاشة

> كل مواصفة تتبع الهيكل المعتمد: تعريف / هيكل مرئي / مكونات / بيانات / تفاعلات / حالات / تجاوب / RTL / معايير قبول.

### 4.1 P0 — الشاشات الأساسية

#### 4.1.1 SCR-001 — Dashboard (`#dashboard`)

**أ. التعريف**: نقطة الدخول الافتراضية + نظرة شاملة على السوق + إشارات + محفظتي.
- **الجمهور**: كل المستخدمين (الزائر يرى نسخة محدودة).
- **الوصول**: `/#dashboard` (default view).
- **الصلاحيات**: لا تتطلب صلاحية لكن بعض widgets تتطلب تسجيل دخول.
- **الموقع**: الصفحة الرئيسية بعد AppShell.
- **الأولوية**: P0.

**ب. الهيكل المرئي** (عمودي، من الأعلى للأسفل — لا tabs):
1. **MyStocksBriefing** (للمسجّلين فقط — محفظة + توقعات + أخبار مفلترة).
2. **AssetPreferenceOnboarding** (onboarding للمستخدم الجديد).
3. **MarketSummary** (مؤشرات السوق الرئيسية: EGX30/70/100 + ملخص).
4. **IndexCards** (بطاقات المؤشرات الأربعة).
5. **TopMovers** (أعلى ربح/خسارة — Top gainers/losers).
6. **RealtimeTicker** (شريط أسعار متحرك — socket.io).
7. **CryptoSignalsWidget** + **SeasonalitySignalsWidget** + **EidPredictionsWidget** + **AutoAnalysisWidget** (grid 2x2).
8. **LiveStockTicker** (ticker آخر).
9. **MarketPulseWidget** (نبض السوق).
10. **LiveMonitor** (مراقبة محفظة لحظية — للمسجّلين).
11. **StockSelector** (للتبديل السريع لسهم).
12. **ShareButton** + **UnifiedPublishButton** (للنشر).

**ج. المكونات لكل عنصر**:

| Widget | البيانات | المصدر | التفاعل |
|---|---|---|---|
| MyStocksBriefing | محفظتي + توقعاتي + أخباري | `/api/portfolio` + `/api/predictions` + `/api/news` (filtered by user stocks) | لا (معلوماتية) |
| MarketSummary | مؤشرات EGX30/70/100 + تغيّر + volume | `/api/market/summary` | Click على مؤشر → `#stocks` filtrer |
| IndexCards | 4 بطاقات: EGX30/70/100/C20 | `/api/market/indices` | Click → `#trading-chart` |
| TopMovers | جدول top 5 gainers/losers | `/api/stocks/top-performers` | Click على سهم → `#stock-detail` |
| RealtimeTicker | شريط متحرك بأسعار لحظية | WS port 3005 (socket.io) | Click → `#stock-detail` |
| CryptoSignalsWidget | إشارات كريبتو (Bitcoin/Ethereum) | `/api/crypto/live` | Click → `#crypto` |
| SeasonalitySignalsWidget | أنماط موسمية | `/api/seasonality-signals` | Click → `#seasonality` |
| EidPredictionsWidget | توقعات الأعياد | `/api/predictions/eid` | Click → `#predictions` |
| AutoAnalysisWidget | تحليل آلي | `/api/ai/analyze-stock` | Click → `#specialist-analysis` |
| LiveMonitor | مراقبة محفظتي | `/api/portfolio/master` | Click → `#live-monitor` |

**د. البيانات**: 
- مصدر: 10 endpoints مختلفة (مذكورة أعلاه).
- التحديث: polling كل 30s + WS للحظي.
- معالجة NULL: عرض "—" للقيم غير المتاحة (Rule 27).

**هـ. التفاعلات**:
- Click على سهم/مؤشر → `#stock-detail` مع `?ticker=...`.
- Click على "نشر" → UnifiedPublishButton (يعرض dialog اختيار نوع النشر).
- Refresh → `loadDashboard()` (refetch كل widgets).

**و. الحالات**:
- **تحميل**: `DashboardSkeleton` (header + 4 KPI cards + 6 صفوف).
- **widget خطأ**: `SafeWidget` fallback (Card + AlertTriangle + "خطأ في تحميل {name}").
- **بيانات فارغة**: EmptyState "لا توجد بيانات لعرضها" + CTA.
- **محفظة فارغة**: CTA "أضف أول مركز في محفظتك".

**ز. التجاوب**:
- Desktop: `grid-cols-2 lg:grid-cols-4` لـ IndexCards + TopMovers.
- Tablet: `grid-cols-2`.
- Mobile: `grid-cols-1` (stacked).
- RealtimeTicker: horizontal scroll على mobile.

**ح. معايير القبول**:
- ✅ Dashboard يحمّل خلال 3s (initial paint).
- ✅ كل widget له ErrorBoundary مستقل.
- ✅ RealtimeTicker يتحدّث لحظيًا (لو WS متاح).
- ✅ Refresh يعيد fetch كل البيانات.
- ✅ Sticky footer محترَم.

---

#### 4.1.2 SCR-002 — Stocks List (`#stocks`)

**أ. التعريف**: قائمة بكل أسهم السوق المصري مع بحث + فلترة + فرز.
- **الجمهور**: مسجّل + مدفوع.
- **الوصول**: TopBar → "السوق" → "الأسهم" أو `#stocks`.
- **الصلاحيات**: PROTECTED_VIEW (LoginPromptModal للزائر).
- **الأولوية**: P0.

**ب. الهيكل المرئي**:
1. **Header local** (Title: "أسهم السوق المصري" + Description).
2. **StockSearchSelector** (search bar autocomplete).
3. **Filters bar** (segmented buttons): 
   - القطاع (dropdown)
   - التغير (gainers/losers/all)
   - النشاط (active/all)
4. **UnifiedTable** (الجدول الرئيسي):

| العمود | البيانات | المصدر | التنسيق |
|---|---|---|---|
| # | ترتيب | local | رقم |
| السهم | name_ar + ticker | `/api/stocks/route` | نص عربي + ticker إنجليزي |
| السعر | current_price | canonical-price | رقم بـ 2 decimal + عملة |
| التغير | change + change_pct | canonical-price | +X.XX (+X.XX%) - أخضر/أحمر |
| Volume | volume | stocks.db | رقم مختصر (م/ب) |
| القيمة السوقية | market_cap | stocks.db | رقم مختصر + عملة |
| قطاع | sector_ar | sectors dictionary | badge |
| إشارة | signal | canonical-signal | Badge (شراء/بيع/انتظار) |
| إجراءات | Buttons | — | زر "تفاصيل" + زر "إضافة لقائمة المراقبة" |

5. **Pagination** (10 صفحات لكل صفحة).
6. **Export button** (CSV/PDF).

**ج. المكونات**: UnifiedTable (إلزامي Rule 52) + StockSearchSelector + Filters.

**د. البيانات**: 
- `/api/stocks/route` (GET) — قائمة أسهم.
- canonical-price.ts للأسعار (SSOT Rule 67b).
- canonical-signal.ts للإشارات.

**هـ. التفاعلات**:
- Search: debounced 300ms → filter table.
- Filter change → refetch.
- Click على سهم → `#stock-detail?ticker=...`.
- Click "إضافة لقائمة المراقبة" → POST `/api/watchlist` + toast.
- Sort column → toggle asc/desc.

**و. الحالات**:
- **تحميل**: Skeleton صفوف.
- **فارغ**: "لا توجد أسهم مطابقة لبحثك".
- **فشل**: ErrorBoundary + Retry.

**ز. التجاوب**:
- Desktop: كل الأعمدة مرئية.
- Tablet: إخفاء "القيمة السوقية".
- Mobile: بطاقات بدل جدول (ticker + price + change فقط) + scroll horizontal للجدول.

**ح. معايير القبول**:
- ✅ Search debounced.
- ✅ Sort working.
- ✅ Pagination 10/page.
- ✅ Click → stock-detail.
- ✅ Add to watchlist + toast.
- ✅ Rule 52: UnifiedTable مستخدم.

---

#### 4.1.3 SCR-003 — Stock Detail (`#stock-detail` داخل `#stocks`)

**أ. التعريف**: تفاصيل سهم محدد + تحليل فني + شارت + توصية + أخبار.
- **الجمهور**: مسجّل + مدفوع.
- **الوصول**: Click على سهم من أي شاشة → `#stocks?ticker=...` أو `#stock-detail`.
- **الأولوية**: P0.

**ب. الهيكل المرئي** (تبويبات داخل السهم):
1. **Header**: اسم السهم (عربي) + ticker + شعار الشركة + sector badge + "آخر تحديث: منذ X دقيقة".
2. **Price Block** (كبير):
   - السعر الحالي (large, tabular-nums).
   - تغير اليوم (مطلق + نسبي، أخضر/أحمر).
   - سعر الإغلاق السابق (small).
   - Volume + Turnover.
   - شارة "live" (إن كان سعر لحظي).
3. **Tabs bar**:
   - **نظرة عامة** (default)
   - **التحليل الفني**
   - **التوصية**
   - **الأخبار**
   - **العمق** (orderbook)

**ج. محتوى كل Tab**:

**Tab 1 — نظرة عامة**:
- TradingView widget (5m/15m/30m/1h/1D/1W).
- بطاقات KPIs (4): EPS / P/E / Market Cap / 52w high-low.
- Top holders (إن وجد).
- Related stocks (same sector).

**Tab 2 — التحليل الفني** (SpecialistAnalysisView):
- **TradePlanCard** (إن كان BUY/STRONG_BUY/ACCUMULATE per Rule 78):
  - سعر الدخول
  - الهدف الأول + الثاني
  - وقف الخسارة
  - R:R ratio
  - درجة الثقة
- **Rule 78 guards**: 
  - SELL/AVOID → شريط أحمر + تحذير "لا توجد فرصة شراء".
  - REDUCE → شريط amber.
  - HOLD/WAIT → شريط amber خفيف + "انتظر تأكيد الإشارة".
- Fibonacci levels + Support/Resistance (إن مدعوم).
- Candlestick patterns widget.
- Technical indicators table (RSI/MACD/MA50/MA200/VWAP/OBV).

**Tab 3 — التوصية** (from `/api/stocks/[ticker]/unified` per Rule 73):
- **Single Source of Truth**: كل البيانات من endpoint واحد.
- Recommendation badge (شراء/بيع/احتفاظ/مراقبة).
- أسباب التوصية (قائمة).
- المخاطر (قائمة).
- تاريخ إصدار التوصية + حالتها.
- درجة الثقة (0-100).

**Tab 4 — الأخبار**:
- News list filtered by ticker (`/api/news?ticker=...`).
- كل خبر: title + source + time + summary + image (optional).

**Tab 5 — العمق** (Orderbook):
- Bids table (top 5).
- Asks table (top 5).
- Spread visualization.
- Intraday flow (إن مدعوم).

**د. البيانات**: 
- `/api/stocks/[ticker]/unified` (Rule 73 SSOT) للقرار + الإشارة + الأهداف.
- `/api/stocks/[ticker]/history` للـ chart.
- `/api/stocks/[ticker]/news` للأخبار.
- `/api/stocks/[ticker]/orderbook` للعمق.

**هـ. التفاعلات**:
- Tab switch → lazy load content.
- Click "أضف لقائمة المراقبة" → POST `/api/watchlist`.
- Click "أنشئ تنبيه" → `#alerts-center` مع prefilled ticker.
- Click "شارك" → UnifiedPublishButton.
- Click على سهم related → switch context.

**و. الحالات**:
- **تحميل**: Tab skeleton.
- **فارغ**: "لا توجد بيانات لهذا السهم حاليًا".
- **فشل الاتصال**: Retry button.
- **سهم غير موجود**: redirect `#stocks` + toast.
- **Rule 78**: TradePlanCard يظهر/يختفي حسب signal.

**ز. التجاوب**:
- Desktop: TradingView widget full width + KPIs grid 4.
- Tablet: KPIs grid 2.
- Mobile: KPIs stacked + TradingView fixed height 300px.

**ح. معايير القبول**:
- ✅ Rule 73: كل قرار data من `/api/stocks/[ticker]/unified`.
- ✅ Rule 78: TradePlanCard مخفي لـ SELL/AVOID.
- ✅ Rule 27: NULL → "— بيانات غير متاحة".
- ✅ Tabs تعمل مع lazy loading.
- ✅ Add to watchlist + alert creation.

---

#### 4.1.4 SCR-005 — Portfolio (`#portfolio`)

**أ. التعريف**: محفظة المستخدم الموحدة + P&L + robo-advisor + risk quiz.
- **الجمهور**: مسجّل + مدفوع.
- **الأولوية**: P0.

**ب. الهيكل المرئي**:
1. **PortfolioSummary Card**:
   - القيمة الإجمالية (large).
   - إجمالي الربح/الخسارة (مطلق + نسبي).
   - نسبة الربح اليوم.
   - Equity curve chart (AreaChart).
2. **Tabs**:
   - **المراكز** (default): UnifiedTable بالمراكز.
   - **المحفظة المتقدمة** (`#advanced-portfolio`).
   - **روبو-أدفايزر**: RoboAdvisorPanel.
   - **اختبار المخاطر**: RiskQuiz.
   - **Master portfolio**: MasterPortfolio.
3. **UnifiedTable** (Tab 1):
   - ticker / shares / avg_cost / current_price / market_value / P&L / P&L% / weight%.
   - كل صف: زر "إنقاذ" + زر "تفاصيل".
4. **Add position button** → Dialog form.

**ج. المكونات**: UnifiedTable + AreaChart + Tabs + Dialog.

**د. البيانات**: 
- `/api/portfolio/holdings` للمراكز.
- `/api/portfolio/equity-curve` للـ chart.
- `/api/portfolio/risk-summary` للـ risk.
- `/api/portfolio/master` للـ master.
- `/api/portfolio/intelligence` للـ robo-advisor.

**هـ. التفاعلات**:
- Add position → POST `/api/portfolio/holdings`.
- Click "إنقاذ" → `/rescue?ticker=...`.
- Click "تفاصيل" → `#stock-detail`.
- Filter by profit/loss.

**و. الحالات**:
- **محفظة فارغة**: EmptyState + "أضف أول مركز".
- **Rule 50**: كل أرقام حقيقية من DB (لا fabricated).

**ح. معايير القبول**:
- ✅ Rule 50: كل أرقام مالية حقيقية.
- ✅ P&L محسوب من DB.
- ✅ Equity curve يعمل.
- ✅ Add position form.
- ✅ Rule 27: NULL → "—".

---

#### 4.1.5 SCR-006 — Watchlist (`#watchlist`)

**أ. التعريف**: قائمة المراقبة المحسّنة + إشارات ذكاء.
- **الجمهور**: مسجّل + مدفوع.
- **الأولوية**: P0.

**ب. الهيكل المرئي**:
1. **Header** + add button.
2. **WatchlistIntelligenceSection**: تحليل ذكي لقائمة المراقبة.
3. **UnifiedTable**:
   - ticker / current_price / change / signal / target / stop / R:R / alert_price.
   - زر "حذف" + زر "تنبيه" + زر "تفاصيل".
4. **StockSearchSelector** لإضافة سهم.

**ج. المكونات**: EnhancedWatchlistView + StockSearchSelector + UnifiedTable.

**د. البيانات**: 
- `/api/watchlist` (GET) — قائمة.
- `/api/watchlist` (POST) — إضافة.
- `/api/watchlist/[id]` (DELETE) — حذف.
- `/api/watchlist-enhanced` للذكاء.

**هـ. التفاعلات**:
- Add → POST + toast + refresh.
- Delete → AlertDialog تأكيد + DELETE.
- Click → stock-detail.
- Set alert → `#alerts-center`.

**و. الحالات**:
- **فارغة**: "لا توجد أسهم في قائمة المراقبة. ابدأ بإضافة سهم." + CTA.

**ح. معايير القبول**:
- ✅ Add/Delete works.
- ✅ Alert price editable.
- ✅ Rule 52: UnifiedTable.

---

#### 4.1.6 SCR-007 — Recommendations / متابعة التوقعات (`#recommendations`)

**أ. التعريف**: مركز التوقعات + تتبع الأداء + lessons learned.
- **الجمهور**: مسجّل + مدفوع.
- **الأولوية**: P0.

**ب. الهيكل المرئي** (6-7 tabs):
1. **Tabs bar**:
   - التوقعات النشطة (default)
   - تتبع التوقعات
   - ملخص التوقعات
   - الفرص الضائعة
   - دروس من الأخطاء
   - توقعات الخبراء
   - التتبع الحي (new)

**ج. محتوى كل Tab**:

**Tab 1 — التوقعات النشطة**:
- UnifiedTable بالتوقعات النشطة (20 BUY).
- أعمدة: ticker / signal / entry / target / stop / R:R / confidence / date.
- VIPLiveSignalsFeed (للمدفوع VIP): catalyst amber box + copy button + audited banner.

**Tab 2 — تتبع التوقعات**:
- PredictionTrackingDashboard.
- Stats: total / win rate / hit target / hit stop / pending.
- جدول التوقعات الموثّقة.
- زر "تحقق من المعلقة".

**Tab 3 — ملخص التوقعات**:
- AuditedPerformanceView (للـ VIP).
- 4 stat boxes: total / win rate / avg return / avg hold time.
- Audited history table (آخر 20 صفقة).

**Tab 4 — الفرص الضائعة**:
- `/api/predictions/honest-tracking/missed-opportunities`.
- جدول بالفرص التي فاتت.

**Tab 5 — دروس من الأخطاء**:
- `/api/predictions/honest-tracking/learn-from-errors`.
- Cards بالدروس المستفادة.

**Tab 6 — توقعات الخبراء**:
- ExpertRecommendations table.
- Expert track records.

**Tab 7 — التتبع الحي**:
- LiveTracking endpoint.

**د. البيانات**: 
- `/api/predictions/honest-tracking/list|stats|learn-from-errors|live-tracking|verify-pending|missed-opportunities`.
- `/api/expert-recommendations/*`.

**هـ. التفاعلات**:
- Tab switch → lazy load.
- Click توقع → `#stock-detail?ticker=...`.
- Verify pending → POST `/api/predictions/honest-tracking/verify-pending`.

**و. الحالات**:
- **لا توقعات**: EmptyState + "تصفّح الأسهم".
- **VIP locked**: UpgradePrompt للـ non-VIP.

**ح. معايير القبول**:
- ✅ Rule 50: كل أرقام محفظة حقيقية.
- ✅ Rule 73: مصدر عرض واحد للقرار.
- ✅ Tab switching lazy.
- ✅ VIPLiveSignalsFeed gated.

---

#### 4.1.7 SCR-AC-001 — Auth View (`#auth`)

**أ. التعريف**: تسجيل الدخول/التسجيل عبر Google + Credentials (dev).
- **الجمهور**: زائر.
- **الأولوية**: P0.

**ب. الهيكل المرئي** (AuthView ~1500 LOC):
1. **Background**: emerald radial pattern.
2. **Card center**:
   - شعار + "دليل الاستثمار".
   - **Tabs**: login / register.
   - **Login form** (Tab 1):
     - username_or_email (Input).
     - password (Input type=password, min 6).
     - زر "تسجيل الدخول" (Primary).
     - زر "الدخول بحساب Google" (Outline).
   - **Register form** (Tab 2):
     - email (Input).
     - username (Input).
     - password (Input, min 8, regex).
     - confirm password.
     - زر "إنشاء حساب" (Primary).
     - زر "التسجيل بـ Google" (Outline).

**ج. المكونات**: Tabs + Input + Button + react-hook-form + zod.

**د. البيانات**: 
- next-auth `signIn('google')`.
- next-auth `signIn('credentials', {...})`.
- POST `/api/auth/register` للتسجيل.

**هـ. التفاعلات**:
- Submit login → signIn → redirect to dashboard.
- Submit register → POST → auto-login → dashboard.
- Google button → signIn('google').
- Tab switch via sessionStorage.auth_initial_tab.

**و. الحالات**:
- **Validation error**: inline red text.
- **Auth error**: toast "بيانات غير صحيحة".
- **Loading**: spinner on button.

**ح. معايير القبول**:
- ✅ Google login works.
- ✅ Credentials login (dev only if ALLOW_FORM_LOGIN=true).
- ✅ Form validation (zod).
- ✅ Redirect after success.

---

#### 4.1.8 SCR-AC-002 — Subscription / Pricing (`#subscription`)

**أ. التعريف**: باقات الاشتراك + مقارنة + B2B + checkout.
- **الجمهور**: مسجّل (Free).
- **الأولوية**: P0.

**ب. الهيكل المرئي** (SubscriptionView 1792 LOC):
1. **Header**: "اختر خطة الاشتراك المناسبة".
2. **Pricing cards grid** (4 plans × 4 markets):
   - **Premium**: الميزات الأساسية.
   - **Pro**: + advanced-portfolio + specialist-analysis.
   - **VIP Pass**: + VIPLiveSignalsFeed + AuditedPerformance.
   - **Developer**: + B2B API key.
3. **Comparison table**: ميزات × خطط.
4. **B2B section**: plans for businesses.
5. **Telegram bot plans**: plans for bot users.

**ج. المكونات**: PricingView (373 LOC) + InstapayModal + ComparisonTable.

**د. البيانات**: 
- `/api/subscription/plans` (GET).
- `/api/subscription/checkout` (POST) → opens InstapayModal.
- `MARKET_CURRENCY_LABEL` للعملة (EGP/SAR/KWD/QAR).
- Auto-detect market من `navigator.language`.

**هـ. التفاعلات**:
- Click "اشترك" → POST checkout → InstapayModal.
- Select plan → highlight.
- Currency toggle.

**و. الحالات**:
- **Loading plans**: skeleton.
- **Checkout loading**: spinner in modal.
- **Checkout error**: toast + retry.

**ز. التجاوب**: Cards grid 1 (mobile) / 2 (tablet) / 4 (desktop).

**ح. معايير القبول**:
- ✅ Plans تعرض بأسعار صحيحة حسب السوق.
- ✅ InstapayModal يعمل.
- ✅ Auto-detect market.

---

#### 4.1.9 SCR-LG-002 — Disclaimer Page (`/legal/disclaimer`)

**أ. التعريف**: إخلاء المسؤولية الاستثمارية.
- **الجمهور**: كل المستخدمين.
- **الأولوية**: P0 (متطلب قانوني).

**ب. الهيكل المرئي**:
1. Header: amber gradient banner.
2. Prose content (مقال طويل):
   - لا ضمان للأرباح.
   - التوصيات تحليلية وليست نصيحة مالية.
   - المسؤولية على المستخدم.
3. تاريخ آخر تحديث: "مايو 2025".

**ح. معايير القبول**:
- ✅ المحتوى واضح وقانوني.
- ✅ يُربط من Footer.

---

#### 4.1.10 SCR-PG-001 — Payment Success (`/payment/success`)

**أ. التعريف**: صفحة نجاح الدفع — polling على status.
- **الجمهور**: مستخدم بعد checkout.
- **الأولوية**: P0.

**ب. الهيكل المرئي** (4 states):
1. **processing** (default): spinner + "جارٍ التحقق من الدفع...".
2. **success**: ✓ icon + "تم تفعيل اشتراكك بنجاح" + CTA "ابدأ الآن".
3. **still-processing**: ⏳ + "ننتظر تأكيد الدفع. قد يستغرق دقائق.".
4. **error**: ✗ icon + "فشل التحقق من الدفع" + CTA "تواصل مع الدعم".

**ج. المكونات**: Card + Button + spinner.

**د. البيانات**: 
- Polling `/api/subscription/status` كل 2s.
- Max 15 attempts (30s).
- `PAID_TIERS` من subscription-gate.

**هـ. التفاعلات**:
- Success → CTA "ابدأ الآن" → `#dashboard`.
- Error → CTA "تواصل مع الدعم" → mailto/telegram.

**ح. معايير القبول** (Fix CRIT-15):
- ✅ NO auto-activate (أمني).
- ✅ Polling max 30s.
- ✅ 4 states واضحة.

---

### 4.2 P1 — شاشات عالية الأولوية

#### 4.2.1 SCR-008 — Smart Confluence (`#smart-confluence`)

**الهدف**: 20 BUY predictions من V40.2 confluence engine.
**الجمهور**: مدفوع فقط.

**الهيكل المرئي**:
1. Header: "توقعات الـ Confluence الذكية".
2. Stats row: total / avg confidence / avg R:R / market regime.
3. UnifiedTable بالـ 20 توقع:
   - ticker / signal / confidence / entry / target1 / target2 / stop / R:R.
4. Click → stock-detail.

**معايير القبول**: 
- ✅ 20 توقع فقط (top by confidence).
- ✅ كل توقع له Rule 78 guards.

---

#### 4.2.2 SCR-010 — Prediction Tracking (`#prediction-tracking`)

**الهدف**: تتبع أداء التوقعات السابقة.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي**:
1. Stats: total / win rate / hit target / hit stop / pending.
2. UnifiedTable: verified predictions + outcome.
3. Win rate over time chart.

**البيانات**: `/api/predictions/tracking/*`.

**معايير القبول**: ✅ كل أرقام حقيقية ✅ Rule 50 محترَم.

---

#### 4.2.3 SCR-017 / SCR-AC-005 — BagHolder Rescue (`#bagholder-rescue` / `/rescue`)

**الهدف**: إنقاذ الصفقات المتعثرة — 3 قرارات صارمة.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي** (BagHolderRescuePanel ~760 LOC):
1. Header: "عيادة إنقاذ الصفقات".
2. Form: ticker + buy_price + quantity + total_cost (auto).
3. Diagnosis section (after submit):
   - تشخيص جذري (لماذا السهم خسران؟ regime + fundamentals + news).
   - تقييم مؤسسي (institutional analysis).
4. 3 Decisions cards (horizontal):
   - **CUT_LOSS** (red card): "أوقف الخسارة فورًا".
   - **AVERAGE_DOWN** (amber card): "متوسط التكلفة بشروط".
   - **HOLD** (emerald card): "احتفظ وانتظر".
5. Recovery plan + Lessons learned.

**البيانات**: `/api/portfolio/bag-holder-rescue` + query params (auto-fill).

**التفاعلات**:
- Submit → POST → diagnosis.
- Click على قرار → Dialog تأكيد + تفاصيل.
- Auto-fill من query params (deep link من `#portfolio`).

**الحالات**:
- تحميل التشخيص: skeleton.
- لا يمكن إنقاذ: "هذا السهم لا يمكن إنقاذه بسهولة. استشر مختصًا."

**معايير القبول**:
- ✅ 3 قرارات صارمة (CUT/AVERAGE/HOLD).
- ✅ Auto-fill من query params.
- ✅ Rule 78: لا توصية شراء على سهم خسران (إلا AVERAGE_DOWN بشروط).

---

#### 4.2.4 SCR-020 — Liquidity Radar (`#liquidity-radar`)

**الهدف**: رادار سيولة بـ 4 أعمدة لكل سهم.
**الجمهور**: مدفوع.

**الهيكل المرئي** (LiquidityRadarView — 712 LOC):
1. **Market Regime Banner**: حالة السوق العامة (bull/bear/range).
2. **Phase filter chips**: accumulation / markup / distribution / markdown.
3. **4-column grid** لكل سهم:
   - **العمود 1 — الحوت**: Institutional money flow (Wyckoff).
   - **العمود 2 — حالة السوق**: market sentiment.
   - **العمود 3 — المرحلة**: Wyckoff phase.
   - **العمود 4 — الدخول والدفاع**: entry + defense strategy.

**البيانات**: `/api/maker-radar/*` + `/api/market/regime`.

**التفاعلات**:
- Click chip → filter.
- Click سهم → stock-detail.

**الحالات**: EmptyState "لا توجد فرص في هذه المرحلة".

**معايير القبول**:
- ✅ 4 أعمدة واضحة.
- ✅ Phase filter يعمل.
- ✅ Rule 80: لا "سيولة داخلة" لو buy_pct<45% أو net_flow<0.

---

#### 4.2.5 SCR-022 — Alerts Center (`#alerts-center`)

**الهدف**: مركز التنبيهات الذكية + sniper scan polling.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي**:
1. **Stats cards**: active / triggered today / pending.
2. **Tabs**:
   - **التنبيهات النشطة** (default): UnifiedTable.
   - **التنبيهات المُطلقة** (history).
   - **Sniper scan**: قائمة فرص sniper.
3. **Create alert button** → Dialog form (ticker + condition + price).
4. **SmartAlertsPanel** (side panel).

**البيانات**: 
- `/api/alerts` (GET/POST/DELETE).
- `/api/sniper/scan` (polling 60s).
- `/api/alerts/scheduler`.

**التفاعلات**:
- Create → POST + toast.
- Delete → AlertDialog + DELETE.
- Click alert → stock-detail.
- Sniper click → stock-detail.

**الحالات**:
- **لا تنبيهات**: EmptyState + "أنشئ أول تنبيه".
- **Sniper polling**: spinner أثناء التحديث.

**معايير القبول**: 
- ✅ Create/Delete works.
- ✅ Sniper polling كل 60s.
- ✅ Alert sound + desktop notification (إن enabled).

---

#### 4.2.6 SCR-014 — News (`#news`)

**الهدف**: feed أخبار مفلترة.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي**:
1. Header + filters (sector/ticker/source).
2. News list: title + source + time + summary + image (optional).
3. Click → source (external).

**البيانات**: `/api/news` + `/api/news-feed`.

**الحالات**: فارغ: "لا توجد أخبار حاليًا".

---

#### 4.2.7 SCR-003 — Stock Filters (`#stock-filters`, `#top-performers`, `#screener`)

**الهدف**: فلترة Python screener متعدد المعايير.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي**:
1. Filters sidebar: sector / market cap / P/E / dividend yield / volume / RSI / signal.
2. UnifiedTable نتائج.
3. Save preset button.

**البيانات**: `/api/screener/advanced` (Python proxy).

**معايير القبول**: ✅ Filters تعمل ✅ Save preset ✅ Rule 52.

---

#### 4.2.8 SCR-004 — Trading Chart (`#trading-chart`)

**الهدف**: TradingView widget بفترات متعددة.
**الجمهور**: مسجّل + مدفوع.

**الهيكل المرئي**:
1. Stock selector.
2. Timeframe selector: 5m/15m/30m/1h/1D/1W + range bar.
3. TradingView widget (full width).
4. Indicators overlay (RSI/MACD/MA).

**معايير القبول**: ✅ Widget يحمّل ✅ Timeframe switch ✅ Indicators overlay.

---

#### 4.2.9 SCR-AD-001 — Admin Main (`#admin`)

**الهدف**: لوحة إدارة شاملة بـ 20+ sub-tabs.
**الجمهور**: أدمن فقط.
**الصلاحيات**: `subscription_tier='admin'` أو localhost bypass أو `isServerAdmin(email)`.

**الهيكل المرئي** (NotebookAdminTab — tabs عمودية يمين + content يسار):
- **Sidebar tabs** (يمين، 20+):
  1. Dashboard (overview).
  2. Users management.
  3. Predictions management.
  4. Educational cards.
  5. Reports.
  6. Telegram bot.
  7. Crypto management.
  8. Forex management.
  9. System control.
  10. DB manager.
  11. Backup/restore.
  12. Engines status.
  13. PM2 control.
  14. Promo codes.
  15. News management.
  16. Sharia management.
  17. Source authority.
  18. Validation monitor.
  19. Cron health.
  20. Platform performance.
  21. AI analyze.
  22. A/B tests.

**التجاوب**: 
- Desktop: sidebar ثابت + content.
- Mobile: drawer للـ sidebar.

**معايير القبول**:
- ✅ Admin gate على server (admin/layout.tsx).
- ✅ localhost bypass للـ dev.
- ✅ كل sub-tab له loading/error states.

---

#### 4.2.10 SCR-AD-002 — Honest Predictions (`/admin/honest-predictions`)

**الهدف**: لوحة التوقعات الصادقة (1855 سطر — أكبر صفحة).
**الجمهور**: أدمن.

**الهيكل المرئي**:
1. **Stats cards** (4): total / win rate / avg return / active count.
2. **Charts** (Recharts): 
   - AreaChart: performance over time.
   - PieChart: win/loss distribution.
3. **Filters bar**: date range / signal / outcome.
4. **UnifiedTable**: predictions with all fields.
5. **Actions**: 
   - "توليد التوقعات" button.
   - "تصدير" button (CSV/PDF).
   - "إغلاق المعلقة" button.

**معايير القبول**:
- ✅ Rule 50: كل أرقام حقيقية.
- ✅ Recharts rendering صحيح.
- ✅ Filters تعمل.

---

### 4.3 P2 — شاشات متوسطة الأولوية (مكثّف)

#### 4.3.1 SCR-009 — Specialist Analysis (`#specialist-analysis`)
**الهدف**: Fibonacci + Candlestick widgets. **التجاوب**: desktop full / mobile stacked.

#### 4.3.2 SCR-011 — Dual Track (`#dual-track`)
**الهدف**: persona predictions comparison (تاريخي رغم إعدام نظام الشخصيات).

#### 4.3.3 SCR-012 — V82 (`#v82`)
**الهدف**: V82DecisionPanel — لوحة قرار مؤسسي.

#### 4.3.4 SCR-013 — Reports (`#reports`)
**الهدف**: بطاقات صور تقارير بفترات (daily/weekly/monthly/quarterly/yearly). Auth-protected.

#### 4.3.5 SCR-015 — Simulation (`#simulation`)
**الهدف**: paper-trading-v2. Virtual account + orders + positions + Reset.

#### 4.3.6 SCR-016 — Academy (`#academy`)
**الهدف**: 5 tabs تعليم (دروس / موسوعة / محاكاة شموع / توقيت دخول / محاكاة محفظة).

#### 4.3.7 SCR-018 — Advanced Portfolio (`#advanced-portfolio`)
**الهدف**: تحليل عميق + risk quiz.

#### 4.3.8 SCR-021 — Market Depth (`#market-depth`)
**الهدف**: InvestorsFlow + LiquidityFlow + IntradayPressure + MultiMarket widgets.

#### 4.3.9 SCR-023 — Live Monitor (`#live-monitor`)
**الهدف**: مراقبة محفظة لحظية.

#### 4.3.10 SCR-024 — Wealth (`#wealth`)
**الهدف**: wealth charts + real return + inflation + asset allocation.

#### 4.3.11 SCR-AC-003 — Settings (`#settings`)
**الهدف**: تفضيلات المستخدم (لغة / عملة عرض / إشعارات / dark mode / حذف حساب).

#### 4.3.12 SCR-LG-001 — Terms (`/legal/terms`)
**الهدف**: شروط الاستخدام. ⚠️ purple gradient (موثّق في الملحق FX-3).

#### 4.3.13 SCR-LG-003 — Privacy (`/legal/privacy`)
**الهدف**: سياسة الخصوصية.

#### 4.3.14 SCR-PG-002 — Backtest (`/backtest`)
**الهدف**: walk-forward dashboard (phase1/phase2 + durations).

#### 4.3.15 SCR-AD-003 — Educational Cards (`/admin/educational-cards`)
**الهدف**: CRUD كروت تعليمية (1704 سطر).

#### 4.3.16 SCR-AD-004 — Admin Reports (`/admin/reports`)
**الهدف**: تقارير الدوري بفترات (StockLeagueImageCard).

#### 4.3.17 SCR-CR-001 — Crypto Portfolio (`#crypto-portfolio`)
**الهدف**: CryptoPortfolioView مستقل. نفس بنية `#portfolio` لكن مع بيانات CRYPTO. عملة العرض USD افتراضيًا.

#### 4.3.18 SCR-CR-002 — Crypto Watchlist (`#crypto-watchlist`)
**الهدف**: EnhancedWatchlistView مع `currentMarket='CRYPTO'`.

#### 4.3.19 SCR-CR-003 — Crypto Prediction Tracking (`#crypto-prediction-tracking`)
**الهدف**: CryptoPredictionTrackingView مستقل.

#### 4.3.20 SCR-IS-003 — Sharia (`#sharia`)
**الهدف**: 3 tabs (قائمة 253 سهم + تطهير صفقة + تطهير محفظة). emerald + gold aesthetic.

---

### 4.4 P3 — شاشات منخفضة الأولوية (مكثّف)

#### 4.4.1 SCR-019 — Seasonality (`#seasonality`)
**الهدف**: monthly performance heatmap + best/worst months + recurring patterns.

#### 4.4.2 SCR-025 — Trading Memory (`#trading-memory`)
**الهدف**: insights من `/api/python/v4/insight/*` (past trades + mistakes + best setups).

#### 4.4.3 SCR-026 — Publishing (`#publishing`)
**الهدف**: نشر سهم + بطاقات إنفوجرافيك + trade results export.

#### 4.4.4 SCR-IS-001 — Zakat (`#zakat`)
**الهدف**: حاسبة الزكاة (total wealth + nisab → result + breakdown).

#### 4.4.5 SCR-IS-002 — Tithes (`#tithes`)
**الهدف**: حاسبة العشور.

#### 4.4.6 SCR-AC-004 — About (`#about`)
**الهدف**: معلومات المنصة + الفريق + التواصل.

---

### 4.5 Overlays (5)

#### 4.5.1 SCR-OV-001 — LoginPromptModal (Auth Overlay)

**الظهور**: عند محاولة زائر فتح PROTECTED_VIEW.

**الهيكل المرئي** (Dialog):
1. Header متدرّج amber→emerald + شعار + "سجّل مجاناً للوصول الكامل".
2. **5 مميزات** (قائمة بأيقونات):
   - توقعات ذكية (TrendingUp)
   - تحليلات فنية (BarChart3)
   - متابعة محفظة (Wallet)
   - تنبيهات (Bell)
   - قوائم مراقبة (Eye)
3. CTA Primary: "سجّل مجاناً" (UserPlus).
4. CTA Secondary: "دخول" (LogIn).
5. زر X يتطلب تأكيد عبر AlertDialog (للحفاظ على conversion funnel).

**البيانات**: `showLoginPrompt` من useAppStore.

**التفاعلات**:
- Click "سجّل مجاناً" → يفتح AuthView بـ `tab=register` (setSessionStorage).
- Click "دخول" → يفتح AuthView بـ `tab=login`.
- Click X → AlertDialog تأكيد → إذا أكّد → يغلق + redirect لـ `#dashboard`.

**معايير القبول**:
- ✅ يظهر عند محاولة فتح PROTECTED_VIEW.
- ✅ زر الإغلاق يتطلب تأكيد.
- ✅ Redirect محفوظ للرجوع.

---

#### 4.5.2 SCR-OV-002 — TrialCountdownBanner

**الظهور**: آخر 7 أيام من trial.

**الهيكل المرئي**: Sticky banner (z-40, top of AppShell):
- 3 مستويات لونية ديناميكية:
  - daysLeft ≥ 7: أزرق هادئ (sky).
  - daysLeft 3-6: أصفر تحذير (amber).
  - daysLeft 1-2: أحمر حرج (rose) — "آخر فرصة!".
- يعرض: عدد الأيام + تاريخ انتهاء الـ trial.
- زر "اشترك الآن" → يفتح Dialog ي host PricingView.
- زر X للإغلاق (dismissed state يُ reset عند تغيّر daysLeft).
- لا يظهر للمستخدمين المدفوعين.

**معايير القبول**: ✅ 3 مستويات لونية ✅ لا يظهر للمدفوعين.

---

#### 4.5.3 SCR-OV-003 — TrialExpiredModal (Fullscreen, no X)

**الظهور**: Free user منتهي الـ trial.

**الهيكل المرئي** (fullscreen, z-[100]):
1. **Sticky top bar**: "انتهت فترة التجربة المجانية" + زر تسجيل خروج (signOut).
2. **Promo code section**: حقل نص + زر "تفعيل" + states (loading/success/error).
3. **PricingView asModal**: كل خطط الأسعار.

**البيانات**: `isExpired=true` من `/api/subscription/status`.

**التفاعلات**:
- Promo code: POST → success (تفعيل) / error (toast).
- اختر خطة → checkout → InstapayModal.
- لا يمكن الإغلاق بدون اشتراك ناجح.

**معايير القبول**:
- ✅ لا يوجد زر X.
- ✅ يُغلق تلقائيًا عند نجاح الدفع.
- ✅ Promo code يعمل.

---

#### 4.5.4 SCR-OV-004 — SessionExpiredModal

**الظهور**: 401 من API (auth:session-expired event).

**الهيكل المرئي**: Non-dismissible (Escape/outside-click blocked):
- Icon: Lock + AlertTriangle.
- Title: "انتهت جلستك".
- Description: "يجب تسجيل الدخول مرة أخرى للمتابعة."
- زر واحد: "تسجيل الدخول" → `signOut({callbackUrl:'/', redirect:true})`.
- module-level `sessionExpiredShown` guard يمنع تكرار المودال.

**معايير القبول**: ✅ Non-dismissible ✅ module-level guard يمنع التكرار.

---

#### 4.5.5 SCR-OV-005 — InstapayModal

**الظهور**: بعد POST `/api/subscription/checkout`.

**الهيكل المرئي**: Dialog لرفع إيصال Instapay (upload + copy account + paste reference):
- States: upload/copy/check/pending/verified/error.
- POST `/api/subscription/instapay/submit`.

**معايير القبول**: ✅ Upload + preview ✅ States واضحة ✅ POST submit.

---

### 4.6 البنية التحتية (8)

#### 4.6.1 SCR-IN-001 — Root Layout (`layout.tsx`)

**التعريف**: الغلاف الجذري لكل صفحات التطبيق. يحمل Providers + i18n + SEO + RTL.
- **الجمهور**: كل المستخدمين.
- **الوصول**: تلقائي على كل route.

**الهيكل المرئي** (من الأعلى للأسفل):
1. `<!DOCTYPE html>` مع `lang={locale}` و `dir={dir}` (rtl للعربية).
2. `<head>`: metadata (title template `%s | دليل الاستثمار`) + canonical + hreflang (`ar`, `en-US`, `x-default`) + OpenGraph + Twitter + JSON-LD (StructuredDataScripts) + manifest.
3. `<body>` مع `suppressHydrationWarning`:
   - Skip-to-main-content link (`sr-only focus-visible:`).
   - `<Providers>` (SessionProvider + ThemeProvider + I18nProvider + QueryClientProvider).
   - `<SonnerToaster position="top-center" dir={dir} richColors closeButton />`.
   - `<FeedbackWidget>` (زر عائم لرأي المستخدم).
   - `{children}` (محتوى الصفحة).

**البيانات**: `locale` من cookie `NEXT_LOCALE` (default `ar`). `dir` مشتق من locale.

**التفاعلات**: تبديل اللغة عبر `LanguageToggle` (يحدّث cookie + reload).

**الحالات**: 
- Hydration mismatch: `suppressHydrationWarning` على html/body.
- Loading: `loading.tsx` skeleton يعرض أثناء Suspense.

**التجاوب**:
- Desktop: container `max-w-7xl mx-auto`.
- Mobile: `w-full` + safe-area-inset.
- RTL: `dir="rtl"` على html.

**معايير القبول**:
- ✅ `<html lang="ar" dir="rtl">` عند locale=ar.
- ✅ كل metadata موجودة في DOM.
- ✅ Toaster يعمل في كلا الوضعين (light/dark).
- ✅ Skip-link يظهر عند focus بالكيبورد.

---

#### 4.6.2 SCR-IN-002 — globals.css (467 سطر)

نظام الألوان (Light + Dark) + Cairo/Tajawal/Outfit/JetBrains Mono + tabular-nums + body radial gradient (alpha ≤ 0.08).

---

#### 4.6.3 SCR-IN-003 — error.tsx (102 سطر)

App-level boundary: Card + AlertTriangle + "إعادة المحاولة" (reset) + "العودة للرئيسية". Stack trace فقط في dev. لا auto-refresh.

---

#### 4.6.4 SCR-IN-004 — global-error.tsx (151 سطر)

Root boundary: standalone inline-styles + retry + Home. ⚠️ يستخدم `#6366f1` indigo (موثّق في الملحق FX-3).

---

#### 4.6.5 SCR-IN-005 — not-found.tsx (54 سطر)

404 عربية: Card + Compass icon + "٤٠٤" + العودة للرئيسية.

---

#### 4.6.6 SCR-IN-006 — loading.tsx (77 سطر)

Suspense skeleton: header + 4 KPI cards + 6 صفوف جدول + footer.

---

#### 4.6.7 SCR-IN-007 — robots.ts (39 سطر)

robots.txt: يسمح لكل crawlers، يمنع /api/ و /admin/.

---

#### 4.6.8 SCR-IN-008 — sitemap.ts (82 سطر)

sitemap.xml: entries من stocks.db + 15 static route. ⚠️ يولد `?view=` لكن page.tsx يقرأ hash (موثّق في الملحق FX-3).

---

## 5) المرحلة D — نظام تصميم موحد (Design System)

### 5.1 الهوية البصرية المعتمدة

وفقًا لـ `globals.css` على GitHub + `05-PHASE2_SNAPSHOT` + Wave 8 Visual Redesign (2026-10-04):

| البند | القيمة المعتمدة | المصدر |
|---|---|---|
| **اتجاه التصميم** | احترافي مالي / Bloomberg terminal feel + عربي فصيح | Rule 30 + Wave 8 |
| **اللون الأساسي** | Emerald-600 `hsl(160 84% 39%)` ≈ `#10B981` | globals.css |
| **أسلوب الشاشة** | وقور، مباشر، كثيف معلوماتيًا دون ازدحام | Rule 30 |
| **اللهجة** | عربي فصيح (المصرية فقط في tooltips) | Rule 30 |

### 5.2 لوحة الألوان المعتمدة (HEX)

#### ألوان فاتحة (Light `:root`)

```css
--background:          hsl(0 0% 100%)     →  #FFFFFF
--foreground:          hsl(160 5% 10%)    →  #181A1B
--card:                hsl(0 0% 100%)     →  #FFFFFF
--card-foreground:     hsl(160 5% 10%)    →  #181A1B
--popover:             hsl(0 0% 100%)     →  #FFFFFF
--popover-foreground:  hsl(160 5% 10%)    →  #181A1B
--primary:             hsl(160 84% 39%)   →  #10B981  (Emerald-600)
--primary-foreground:   hsl(0 0% 100%)    →  #FFFFFF
--secondary:           hsl(160 5% 96%)   →  #F4F6F5
--secondary-foreground: hsl(160 5% 10%)   →  #181A1B
--muted:               hsl(160 5% 96%)    →  #F4F6F5
--muted-foreground:    hsl(160 5% 45%)    →  #6B7370
--accent:              hsl(160 84% 95%)   →  #DCFCE7
--accent-foreground:   hsl(160 84% 25%)   →  #065F46
--destructive:         hsl(0 84% 60%)     →  #EF4444
--destructive-foreground: hsl(0 0% 100%)  →  #FFFFFF
--border:              hsl(160 5% 90%)    →  #E2E8E6
--input:               hsl(160 5% 90%)    →  #E2E8E6
--ring:                hsl(160 84% 39%)   →  #10B981
--radius:              0.75rem            →  12px

/* Semantic */
--success:             hsl(142 71% 45%)   →  #22C55E  (أخضر صعود)
--warning:             hsl(38 92% 50%)    →  #F59E0B  (amber تحذير)
--danger:              hsl(0 84% 60%)     →  #EF4444  (أحمر هبوط)
--info:                hsl(199 89% 48%)   →  #0EA5E9  (sky — استثناء محدود)

/* Chart palette (Rule 30 — no blue/indigo) */
--chart-1:             hsl(160 84% 39%)   →  #10B981  (emerald)
--chart-2:             hsl(173 80% 40%)   →  #14B8A6  (teal/turquoise)
--chart-3:             hsl(38 92% 50%)    →  #F59E0B  (amber)
--chart-4:             hsl(24 95% 53%)    →  #F97316  (orange)
--chart-5:             hsl(82 81% 52%)    →  #84CC16  (lime)
```

#### ألوان داكنة (Dark `.dark`)

```css
--background:          hsl(160 5% 6%)     →  #0C0F0E  (Bloomberg terminal feel)
--foreground:          hsl(160 5% 90%)    →  #E2E8E6
--card:                hsl(160 5% 9%)     →  #131817
--card-foreground:     hsl(160 5% 90%)    →  #E2E8E6
--popover:             hsl(160 5% 9%)     →  #131817
--popover-foreground:  hsl(160 5% 90%)    →  #E2E8E6
--primary:             hsl(160 84% 45%)   →  #10B981  (أكثر سطوعًا في الداكن)
--primary-foreground:   hsl(160 5% 6%)    →  #0C0F0E
--secondary:           hsl(160 5% 14%)   →  #1F2625
--secondary-foreground: hsl(160 5% 90%)   →  #E2E8E6
--muted:               hsl(160 5% 14%)    →  #1F2625
--muted-foreground:    hsl(160 5% 60%)    →  #8A9290
--accent:              hsl(160 84% 18%)   →  #064E3B
--accent-foreground:   hsl(160 84% 85%)   →  #6EE7B7
--destructive:         hsl(0 70% 55%)     →  #DC2626
--border:              hsl(160 5% 18%)    →  #282F2D
--input:               hsl(160 5% 18%)    →  #282F2D
--ring:                hsl(160 84% 45%)   →  #10B981

/* Body radial gradient (Wave 8 — alpha ≤ 0.08 per Rule 29 NO-HYPE) */
body::before: radial-gradient emerald at top, alpha 0.08
body.dark::before: dual radial gradient (emerald + amber), alpha 0.06
```

#### ملاحظات ألوان مهمة

| القاعدة | التطبيق |
|---|---|
| **Rule 30 (ممارسة)** | ممنوع blue/indigo — استثناء محدود لـ `--info` (#0EA5E9 sky) في حالات خاصة فقط |
| **Wave 8 dual-layer shadows** | البطاقات تستخدم `shadow-sm + ring-1 ring-border/50` (طبقتين) |
| **Rule 29 NO-HYPE** | alpha ≤ 0.08 لأي gradient خلفية |
| **مخالفات موثّقة** | `/legal/terms` (purple) + `global-error.tsx` (indigo) — في الملحق FX-3 |

### 5.3 الخطوط المعتمدة

```css
/* Primary Arabic font — loaded via @import in globals.css (NOT next/font) */
--font-arabic:    'Cairo', 'Tajawal', system-ui, sans-serif;

/* Latin headings */
--font-heading:   'Outfit', system-ui, sans-serif;

/* Tabular figures for financial numbers */
--font-mono:      'JetBrains Mono', monospace;

/* Body default */
body {
  font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;  /* لمحاذاة الأعمدة المالية */
  font-feature-settings: 'tnum' 1, 'cv01' 1;
}
```

### 5.4 أحجام الخطوط ومستويات العناوين

| المستوى | الحجم (Tailwind) | الخط | الوزن | الاستخدام |
|---|---|---|---|---|
| Display | `text-4xl` (36px) | Outfit | 700 | عناوين hero |
| H1 | `text-3xl` (30px) | Outfit | 700 | عنوان الصفحة |
| H2 | `text-2xl` (24px) | Cairo | 600 | عنوان قسم |
| H3 | `text-xl` (20px) | Cairo | 600 | عنوان بطاقة |
| H4 | `text-lg` (18px) | Cairo | 600 | عنوان فرعي |
| Body | `text-base` (16px) | Cairo | 400 | نص افتراضي |
| Body small | `text-sm` (14px) | Cairo | 400 | نص ثانوي |
| Caption | `text-xs` (12px) | Cairo | 400 | تسميات صغيرة |
| Numbers | `text-base` | JetBrains Mono | 500 | أسعار/نسب/أرقام مالية |

### 5.5 المسافات ونظام المحاذاة

| البند | القيمة |
|---|---|
| Grid columns (desktop) | 12 |
| Container max-width | `max-w-7xl` (80rem = 1280px) |
| Gutter (mobile → desktop) | `gap-4` → `gap-6` → `gap-8` |
| Card padding (content) | `p-4` (mobile) / `p-6` (desktop) |
| Section spacing | `gap-6` → `gap-8` |
| Touch target min | 44×44px (A11Y) |
| Min-h for tab bar | 48px |

### 5.6 الزوايا والظلال

| العنصر | radius | shadow |
|---|---|---|
| Card | `rounded-xl` (12px) | `shadow-sm` + `ring-1 ring-border/50` |
| Button | `rounded-lg` (8px) | `shadow-sm` عند hover |
| Input | `rounded-md` (6px) | — |
| Badge | `rounded-full` | — |
| Dialog/Modal | `rounded-lg` | `shadow-2xl` |
| Tooltip | `rounded-md` | `shadow-md` |

### 5.7 الأزرار (Button — shadcn/ui new-york)

| النوع | اللون | الاستخدام |
|---|---|---|
| **Primary** | `bg-primary text-primary-foreground` | الإجراء الرئيسي (تسجيل، اشترك، احفظ) |
| **Secondary** | `bg-secondary text-secondary-foreground` | إجراء ثانوي (إلغاء، إغلاق) |
| **Outline** | `border border-input bg-background` | إجراء محايد (فلتر، ترتيب) |
| **Ghost** | `hover:bg-accent hover:text-accent-foreground` | إجراء خفيف (قائمة) |
| **Destructive** | `bg-destructive text-destructive-foreground` | حذف، إيقاف |
| **Link** | `text-primary underline-offset-4` | رابط نصي |

**أحجام**: `default` (h-10 px-4 py-2) · `sm` (h-9 px-3) · `lg` (h-11 px-8) · `icon` (h-10 w-10)

**حالات**: default → hover → focus (ring-2 ring-ring ring-offset-2) → active → disabled (opacity-50 cursor-not-allowed) → loading (spinner + disabled)

### 5.8 حقول الإدخال

| النوع | الاستخدام |
|---|---|
| `Input` (shadcn) | نص قصير (بحث، اسم) |
| `Textarea` | نص متعدد الأسطر (ملاحظات) |
| `Select` (shadcn) | قائمة منسدلة |
| `Checkbox` | اختيار متعدد |
| `Switch` | تشغيل/إيقاف (إعدادات) |
| `Slider` | نطاق قيمي |
| `Calendar` | اختيار تاريخ |
| `InputOTP` | رمز تحقق |
| `StockSearchSelector` (مخصص) | بحث أسهم مع autocomplete |

**قواعد التحقق**: Zod schemas (موجودة في AuthView) + react-hook-form.

### 5.9 البطاقات (Card)

```tsx
<Card className="p-6 shadow-sm ring-1 ring-border/50 rounded-xl">
  <CardHeader>
    <CardTitle className="text-xl font-semibold">عنوان البطاقة</CardTitle>
    <CardDescription className="text-sm text-muted-foreground">
      وصف مختصر
    </CardDescription>
  </CardHeader>
  <CardContent>
    {/* محتوى */}
  </CardContent>
  <CardFooter className="flex justify-end gap-2">
    {/* أزرار */}
  </CardFooter>
</Card>
```

### 5.10 الجداول (UnifiedTable — إلزامي Rule 52)

```tsx
<UnifiedTable
  data={rows}
  columns={columnDefs}
  enableSorting
  enableFiltering
  enablePagination
  pageSize={10}
  stickyHeader
  rtl
/>
```

**المرجع**: `SectorTrackingTab.tsx` (نموذج موثّق).

### 5.11 الرسوم البيانية (Recharts)

| النوع | الاستخدام | الألوان |
|---|---|---|
| `AreaChart` | أسعار / equity curve | chart-1 (emerald) |
| `LineChart` | مؤشرات / RSI | chart-1 أو chart-2 (teal) |
| `BarChart` | volume / comparison | chart-3 (amber) / chart-4 (orange) |
| `PieChart` | توزيع محفظة | chart-1..5 |
| `ComposedChart` | مختلط | متعدد |

**قواعد**:
- RTL: `reversed` x-axis
- Tooltips عربية + أرقام بتنسيق عربي
- `tabular-nums` للقيم
- لا gradients مفرطة (Rule 29)
- TradingView widget مستقل في `#trading-chart`

### 5.12 الشارات ومؤشرات الحالة

| النوع | اللون | الاستخدام |
|---|---|---|
| `success` | `bg-success/10 text-success border-success/30` | صعود، ربح، نجاح |
| `warning` | `bg-warning/10 text-warning border-warning/30` | تحذير، قرب انتهاء |
| `danger` | `bg-danger/10 text-danger border-danger/30` | هبوط، خسارة، فشل |
| `info` | `bg-info/10 text-info border-info/30` | معلومة محايدة |
| `neutral` | `bg-muted text-muted-foreground border-border` | محايد |

**قاعدة**: لا الاعتماد على اللون وحده — يجب نص عربي معه (Rule 30).

### 5.13 القوائم الجانبية والنوافذ المنبثقة

| المكون | الاستخدام |
|---|---|
| `Sheet` (right side) | MobileMoreSheet (يفتح من يمين الشاشة في RTL) |
| `Dialog` | Modals (InstapayModal, LoginPromptModal) |
| `AlertDialog` | تأكيد عمليات مهمة (حذف، إلغاء) |
| `Drawer` (bottom) | فلاتر سريعة على الموبايل |
| `Popover` | قوائم سريعة (Market Switcher, Display Currency) |
| `DropdownMenu` | TopBar dropdowns |
| `Tooltip` | مساعدة سريعة |

### 5.14 حالات التحميل والفراغ والخطأ

| الحالة | المكون | التصميم |
|---|---|---|
| **تحميل** | `Skeleton` (shadcn) + `LazyTabLoader` | شكل رمادي للهيكل + spinner + نص "بيتحمّل..." |
| **تحميل سطري** | `LazyInlineLoader` | spinner صغير داخل بطاقة |
| **فراغ** | EmptyState (مخصص) | أيقونة + عنوان + وصف + CTA |
| **خطأ في widget** | `SafeWidget` fallback | Card + AlertTriangle + "خطأ في تحميل {name}" |
| **خطأ في الصفحة** | `error.tsx` | Card + Retry + Home |
| **خطأ في root** | `global-error.tsx` | standalone inline-styles |

### 5.15 قواعد RTL (إلزامية)

```html
<html lang="ar" dir="rtl">
```

| القاعدة | التطبيق |
|---|---|
| **الاتجاه** | `dir="rtl"` على `<html>` (layout.tsx) |
| **المحاذاة** | `text-right` افتراضي، `text-left` استثناء للأرقام اللاتينية |
| **الأيقونات** | استخدم `lucide-react` (مع `flip-rtl` إن لزم) |
| **Tabs/Sheets** | تبدأ من اليمين |
| **Sidebar** | (غير مستخدم — TopBar بدلاً منه) |
| **شريط التمرير** | scrollbar-gutter: stable |
| **Numbers** | `tabular-nums` +LTR للأرقام (محاذاة أعمدة) |
| **Margins** | استخدم `ms-2 me-2` (logical) بدل `ml-2 mr-2` |
| **Padding** | استخدم `ps-4 pe-4` (logical) بدل `pl-4 pr-4` |
| **Borders** | استخدم `border-s border-e` بدل `border-l border-r` |

### 5.16 قواعد التجاوب (Responsive)

| Breakpoint | Tailwind | العرض |
|---|---|---|
| Mobile (default) | `:` | < 640px |
| sm | `sm:` | ≥ 640px |
| md | `md:` | ≥ 768px |
| lg | `lg:` | ≥ 1024px |
| xl | `xl:` | ≥ 1280px |
| 2xl | `2xl:` | ≥ 1536px |

**قواعد التحول**:
- Mobile: `grid-cols-1` → Tablet: `sm:grid-cols-2` → Desktop: `lg:grid-cols-4`
- TopBar يختفي على الموبايل → MobileNav (5 أيقونات) يظهر
- Search input يختفي على الموبايل → StockSelector داخل MobileMoreSheet
- Display Currency Toggle: يصبح icon-only على الموبايل
- الجداول العريضة → `overflow-x-auto` + sticky first column
- Charts: min-height `h-[300px]` mobile → `h-[400px]` desktop

### 5.17 المكونات المشتركة المعتمدة (إلزامية الاستخدام)

| المكون | الموقع | الاستخدام الإلزامي |
|---|---|---|
| `UnifiedTable` | `src/components/shared/` | كل جدول (Rule 52) |
| `UnifiedPublishButton` | `src/components/shared/` | كل زر نشر (Rule 52) |
| `StockSearchSelector` | `src/components/shared/` | بحث أسهم |
| `ExchangeSelector` | `src/components/layout/` | مبدّل أسواق |
| `PredictionCard` | `src/components/shared/` | بطاقة توقع |
| `VIPLiveSignalsFeed` | `src/components/shared/` | feed إشارات VIP |
| `AuditedPerformanceView` | `src/components/shared/` | أداء موثّق |
| `TimeHorizonBadge` | `src/components/shared/` | شارة أفق زمني |
| `LiquidityRadarView` | `src/components/shared/` | رادار سيولة |
| `LazyTabLoader` | `src/components/shared/` | skeleton لـ lazy views |
| `SafeWidget` | `src/modules/dashboard/components/` | ErrorBoundary للـ widgets |
| `ErrorBoundary` (HOC) | `src/components/shared/` | حدود أخطاء لكل view |
| `FlashingChangeCell/PriceCell` | `src/components/shared/` | خلايا بأرقام متغيّرة |
| `MarketSelector` | `src/components/shared/` | مبدّل سوق مدمج |
| `StatCard` | `src/components/ui/` | بطاقة KPI |
| `MiniSparkline` | `src/components/ui/` | sparkline صغير |

### 5.18 التعارضات بين التوثيق والكود (موثّقة — لا تعديل)

| التعارض | القرار التصميمي المقترح |
|---|---|
| `global-error.tsx` يستخدم `#6366f1` (indigo) | **افتراض تصميمي**: استخدم emerald في التصميم الموحّد؛ اترك الكود كما هو حتى يُقرّر المالك. |
| `/legal/terms` يستخدم `from-purple-600` gradient | **افتراض تصميمي**: استخدم `from-emerald-600` في التصميم؛ اترك الكود. |
| `sitemap.ts` يولد روابط `?view=` | **افتراض تصميمي**: وثّق أن الـ deep links يجب أن تستخدم `#view` لا `?view=`. |
| `toggleSidebar()` في Header بدون Sidebar | **افتراض تصميمي**: تجاهل في التصميم (لا Sidebar للديسكتوب). |
| `DisplayCurrencyToggle` function مكررة | **افتراض تصميمي**: استخدم نسخة inline. |

---

## 6) المرحلة E — حزمة Google Stitch الـ 8 ملفات

> كل ملف أدناه قابل للنسخ المباشر إلى https://stitch.withgoogle.com/. لا تدّعي أنني اختبرتها داخل Stitch (لم أُجرِ ذلك).

---

### 6.1 الملف 1 من 8 — PROJECT_DESIGN_BRIEF

```markdown
# PROJECT_DESIGN_BRIEF — دليل الاستثمار (GLMinvestment)

## تعريف المنتج
منصة استثمار مؤسسية للبورصة المصرية (EGX) + أسواق خليجية (TADAWUL/KSE/QSE) + العملات الرقمية (CRYPTO) + الذهب. تقدّم توقعات ذكية + إدارة مخاطر + تتبّع صادق للأداء + إنقاذ للصفقات المتعثرة.

**الإنتاج**: https://invist.m2y.net
**الإصدار**: 3.4.41
**المعمارية**: Python = العقل (محرك التحليل)، Next.js = العرض فقط.

## الجمهور المستهدف
1. **زائر غير مسجّل**: يتصفّح نسخة محدودة + LoginPromptModal عند محاولة الوصول للمحتوى المحمي.
2. **مستخدم Free + Trial**: 7 أيام وصول كامل + TrialCountdownBanner.
3. **مشترك مدفوع** (premium/pro/vip_pass/developer): وصول كامل حسب الخطة.
4. **أدمن**: يدير النظام + المستخدمين + البيانات.

## أهداف تجربة المستخدم
- **وضوح**: كل رقم حقيقي من DB (Rule 50/27)، NULL = "— بيانات غير متاحة" (لا fabrication).
- **شفافية استثمارية**: التوصية + أسبابها + مخاطرها + درجة الثقة + Rule 78 (إخفاء TradePlanCard لغير BUY).
- **سرعة**: Initial paint < 3s، lazy loading لكل الـ heavy views.
- **استقرار**: ErrorBoundary لكل view (SafeWidget)، خطأ في شاشة لا يكسر التطبيق.
- **تكامل**: SPA hash routing موحّد + UI-Mirror Protocol للـ crypto.

## الهوية البصرية المعتمدة
- **اتجاه**: احترافي مالي / Bloomberg terminal feel + عربي فصيح.
- **اللون الأساسي**: Emerald-600 `#10B981` (hsl 160 84% 39%).
- **ممنوع**: blue/indigo (Rule 30 ممارسة).
- **الخط العربي**: Cairo (مع Tajawal fallback).
- **خط الأرقام**: JetBrains Mono + tabular-nums.
- **أسلوب**: وقور، مباشر، كثيف معلوماتيًا دون ازدحام، لا hype phrases، لا إيموجي زائد.

## قواعد التصميم المشتركة
1. **RTL إلزامي**: `dir="rtl"` على html.
2. **Sticky footer**: `min-h-screen flex flex-col` على root + `mt-auto` على footer.
3. **UnifiedTable إلزامي** لكل جدول (Rule 52). ممنوع `<Table>` يدوي.
4. **UnifiedPublishButton إلزامي** لكل زر نشر.
5. **SafeWidget** لكل widget في Dashboard.
6. **withErrorBoundary** HOC لكل view ثقيل.
7. **LazyTabLoader** skeleton لكل lazy-loaded view.
8. **Rule 27**: NULL → "— بيانات غير متاحة" (لا 0، لا 50، لا placeholder).
9. **Rule 78**: TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE.
10. **Rule 50**: كل أرقام محفظة/ثروة/تنبيهات حقيقية من DB.
11. **Mobile-first**: `grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-4`.
12. **Touch target**: min 44×44px (A11Y).
13. **No blue/indigo** (استثناء محدود لـ info badge).

## قواعد RTL
- `<html lang="ar" dir="rtl">`.
- استخدم logical properties: `ms-2 me-2` بدل `ml-2 mr-2`، `ps-4 pe-4` بدل `pl-4 pr-4`، `border-s border-e` بدل `border-l border-r`.
- الـ Sidebar (لو استُخدم) يميني.
- شريط التمرير: `scrollbar-gutter: stable`.
- الأرقام: `tabular-nums` + LTR للأرقام اللاتينية (محاذاة أعمدة).
- Tabs تبدأ من اليمين.
- الأيقونات: استخدم `lucide-react` (تتكيّف مع RTL).

## قائمة الشاشات ونطاق المشروع
النطاق المعتمد: **43 شاشة فعلية** (26 EGX + 3 Crypto مستقلة + 3 Islamic + 5 Account + 5 Legal/Help + 4 Admin) + 5 overlays + 8 بنية تحتية. تفاصيل كاملة في SCREEN_INVENTORY.

## القيود الوظيفية
- **Python backend إلزامي** للتوقعات والتحليل (الـ Node = proxy فقط).
- **WebSocket port 3005** للأسعار اللحظية (لو معطّل، RealtimeTicker يعرض آخر قيمة معروفة).
- **3 قواعد بيانات SQLite**: auth.db + predictions.db + stocks.db (+ data_engine.db للأسعار).
- **NextAuth**: Google provider (إلزامي) + Credentials (dev only).

## قواعد عدم اختراع بيانات أو وظائف
- لا تخترع API endpoints أو حقول أو نتائج استثمارية.
- لا تضف شاشات جديدة (Rule 4 + Rule 63.2).
- لا تضف ميزات غير موجودة في valid-views.ts.
- كل بيانات: إما حقيقية من API، أو "— بيانات غير متاحة" (Rule 27).
- كل توصية: لها أسباب + مخاطر + درجة ثقة + تاريخ + حالة.
- لا تضمن الأرباح (إخلاء مسؤولية إلزامي).
- لا تعرض أسعارًا لحظية دون مؤشر "live" + "آخر تحديث".
```

---

### 6.2 الملف 2 من 8 — DESIGN_SYSTEM_BRIEF

```markdown
# DESIGN_SYSTEM_BRIEF — نظام تصميم GLMinvestment

## لوحة الألوان (Light `:root`)

### ألوان أساسية
| المتغير | HSL | HEX | الاستخدام |
|---|---|---|---|
| --background | hsl(0 0% 100%) | #FFFFFF | خلفية الصفحة |
| --foreground | hsl(160 5% 10%) | #181A1B | النص الرئيسي |
| --card | hsl(0 0% 100%) | #FFFFFF | خلفية البطاقات |
| --primary | hsl(160 84% 39%) | #10B981 | اللون الأساسي (emerald-600) |
| --primary-foreground | hsl(0 0% 100%) | #FFFFFF | نص على primary |
| --secondary | hsl(160 5% 96%) | #F4F6F5 | خلفية ثانوية |
| --muted | hsl(160 5% 96%) | #F4F6F5 | خلفية خافتة |
| --muted-foreground | hsl(160 5% 45%) | #6B7370 | نص خافت |
| --accent | hsl(160 84% 95%) | #DCFCE7 | accent (hover) |
| --destructive | hsl(0 84% 60%) | #EF4444 | أحمر (حذف، خسارة) |
| --border | hsl(160 5% 90%) | #E2E8E6 | حدود |
| --ring | hsl(160 84% 39%) | #10B981 | focus ring |
| --radius | 0.75rem | 12px | نصف قطر الزاوية |

### ألوان دلالية (Semantic)
| المتغير | HEX | المعنى |
|---|---|---|
| --success | #22C55E | صعود، ربح، نجاح |
| --warning | #F59E0B | تحذير، قرب انتهاء |
| --danger | #EF4444 | هبوط، خسارة، فشل |
| --info | #0EA5E9 | معلومة محايدة (استثناء محدود) |

### ألوان الـ Charts (لا blue/indigo)
| المتغير | HEX | الاستخدام |
|---|---|---|
| --chart-1 | #10B981 | emerald (أساسي) |
| --chart-2 | #14B8A6 | teal/turquoise |
| --chart-3 | #F59E0B | amber |
| --chart-4 | #F97316 | orange |
| --chart-5 | #84CC16 | lime |

## لوحة الألوان (Dark `.dark`)
| المتغير | HEX | ملاحظة |
|---|---|---|
| --background | #0C0F0E | Bloomberg terminal feel |
| --foreground | #E2E8E6 | |
| --card | #131817 | |
| --primary | #10B981 | أكثر سطوعًا |
| --muted | #1F2625 | |
| --border | #282F2D | |
| --accent | #064E3B | emerald غامق |
| --destructive | #DC2626 | |

**Body gradient**: radial-gradient emerald at top، alpha ≤ 0.08 (Rule 29 NO-HYPE).

## الخطوط
- `--font-arabic: 'Cairo', 'Tajawal', system-ui, sans-serif` — النص العربي
- `--font-heading: 'Outfit', system-ui, sans-serif` — العناوين اللاتينية
- `--font-mono: 'JetBrains Mono', monospace` — الأرقام المالية
- `body { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1, 'cv01' 1; }`

## أحجام الخطوط
| المستوى | الحجم | الوزن | الخط |
|---|---|---|---|
| Display | 36px | 700 | Outfit |
| H1 | 30px | 700 | Outfit |
| H2 | 24px | 600 | Cairo |
| H3 | 20px | 600 | Cairo |
| Body | 16px | 400 | Cairo |
| Numbers | 16px | 500 | JetBrains Mono |

## المسافات
- Container max-width: max-w-7xl (1280px)
- Gutter: gap-4 → gap-6 → gap-8
- Card padding: p-4 (mobile) / p-6 (desktop)
- Touch target min: 44×44px

## الزوايا والظلال
- Card: rounded-xl (12px) + shadow-sm + ring-1 ring-border/50 (dual-layer Wave 8)
- Button: rounded-lg (8px) + shadow-sm (hover)
- Input: rounded-md (6px)

## الأزرار (shadcn/ui new-york)
- Primary / Secondary / Outline / Ghost / Destructive / Link
- أحجام: default (h-10) · sm (h-9) · lg (h-11) · icon (h-10 w-10)
- حالات: default → hover → focus (ring-2) → active → disabled → loading (spinner)

## الجداول (UnifiedTable إلزامي — Rule 52)
ممنوع `<Table>` يدوي. المرجع: `SectorTrackingTab.tsx`.

## الرسوم البيانية (Recharts)
- AreaChart → chart-1 emerald (أسعار/equity)
- LineChart → chart-1 أو chart-2 teal (مؤشرات/RSI)
- BarChart → chart-3 amber / chart-4 orange (volume/مقارنة)
- PieChart → chart-1..5 (توزيع محفظة)
- RTL: `reversed` x-axis + Tooltips عربية + tabular-nums

## الشارات (Badges)
- success / warning / danger / info / neutral
- لا الاعتماد على اللون وحده — يجب نص عربي معه (Rule 30)

## التنقل
- TopBar (desktop): 5 dropdowns + Market Switcher + Currency Toggle
- MobileNav (mobile): 5 أيقونات ثابتة (safe-area-inset)
- MobileMoreSheet: إضافات
- Tabs (shadcn): لتبديل المحتوى داخل الشاشة

## الحالات البصرية الموحّدة
- تحميل: Skeleton + LazyTabLoader
- فراغ: EmptyState (icon + title + CTA)
- خطأ widget: SafeWidget fallback (Card + AlertTriangle)
- خطأ صفحة: error.tsx (Card + Retry + Home)
- خطأ root: global-error.tsx (standalone inline-styles)

## قواعد RTL
- `<html lang="ar" dir="rtl">`
- logical properties: ms/me, ps/pe, border-s/border-e
- شريط التمرير: scrollbar-gutter: stable
- الأرقام: tabular-nums + LTR
- Tabs/Sidebar من اليمين

## قواعد التجاوب
- Mobile: grid-cols-1 → Tablet: sm:grid-cols-2 → Desktop: lg:grid-cols-4
- TopBar يختفي < md → MobileNav يظهر
- Search input يختفي < md → StockSelector داخل MobileMoreSheet
- الجداول العريضة: overflow-x-auto + sticky first column
- Charts: h-[300px] mobile → h-[400px] desktop
```

---

### 6.3 الملف 3 من 8 — SCREEN_INVENTORY

> انظر القسم **2) المرحلة A** أعلاه — يحتوي على نفس محتوى SCREEN_INVENTORY الكامل.

---

### 6.4 الملف 4 من 8 — USER_FLOWS

> انظر القسم **3) المرحلة B** أعلاه — يحتوي على نفس محتوى USER_FLOWS الكامل (خريطة التنقل + 5 رحلات + حالات استثنائية).

---

### 6.5 الملف 5 من 8 — SCREEN_SPECIFICATIONS

> انظر القسم **4) المرحلة C** أعلاه — يحتوي على نفس محتوى SCREEN_SPECIFICATIONS الكامل لكل شاشة (P0 + P1 + P2 + P3 + Overlays + بنية تحتية).

---

### 6.6 الملف 6 من 8 — STITCH_PROMPTS (برومبت لكل شاشة)

> **كيفية الاستخدام**: ابدأ بالـ Master Brief للحفاظ على الهوية المشتركة، ثم استخدم برومبت كل شاشة على حدة في Stitch.

#### MASTER BRIEF (استخدمه كـ context لكل برومبت)

```
أنت مصمم واجهات محترف. صمّم شاشات لمنصة استثمار مؤسسية اسمها "دليل الاستثمار" (GLMinvestment).

## الهوية البصرية الإلزامية
- **اللون الأساسي**: Emerald-600 #10B981 (hsl 160 84% 39%).
- **ممنوع**: blue/indigo (استثناء محدود لـ info badge #0EA5E9).
- **الخط العربي**: Cairo (مع Tajawal fallback).
- **خط الأرقام**: JetBrains Mono + tabular-nums.
- **العناوين اللاتينية**: Outfit.
- **الأسلوب**: احترافي مالي / Bloomberg terminal feel. وقور، مباشر، كثيف معلوماتيًا دون ازدحام. لا hype، لا إيموجي زائد.
- **RTL إلزامي**: dir="rtl" على html. logical properties (ms/me, ps/pe, border-s/border-e).
- **Dark mode**: emerald-tinted dark (#0C0F0E background — Bloomberg terminal feel).
- **radius**: 0.75rem (12px) للبطاقات.
- **shadows**: dual-layer (shadow-sm + ring-1 ring-border/50) — Wave 8.
- **Body gradient**: radial emerald خفيف (alpha ≤ 0.08).

## المكتبة المعتمدة
- shadcn/ui (new-york style) — كل المكونات الأساسية.
- Recharts للرسوم البيانية (chart-1..5: emerald/teal/amber/orange/lime).
- lucide-react للأيقونات.
- UnifiedTable إلزامي لكل جدول (لا <Table> يدوي).
- SafeWidget لكل widget (ErrorBoundary).
- LazyTabLoader skeleton لكل lazy-loaded view.

## قواعد المنصة الاستثمارية
- Rule 27: NULL = "— بيانات غير متاحة" (لا 0، لا 50، لا placeholder).
- Rule 50: كل أرقام محفظة/ثروة/تنبيهات حقيقية من DB.
- Rule 73: مصدر عرض واحد للقرار (/api/stocks/[ticker]/unified).
- Rule 78: TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE. لـ SELL/AVOID شريط أحمر. لـ REDUCE شريط amber. لـ HOLD/WAIT شريط amber خفيف.
- Rule 80: لا "سيولة داخلة" لو buy_pct<45% أو net_flow<0.

## التجاوب
- Mobile-first: grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-4.
- Touch target min 44×44px.
- TopBar يختفي < md → MobileNav (5 أيقونات).
- الجداول: overflow-x-auto + sticky first column على mobile.

## Sticky Footer
- min-h-screen flex flex-col على root.
- mt-auto على footer.
```

#### برومبت SCR-001 — Dashboard

```
صمّم شاشة "لوحة المعلومات الرئيسية" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
نقطة الدخول الافتراضية. نظرة شاملة على السوق المصري + إشارات + محفظتي.

## الجمهور
كل المستخدمين. الزائر يرى نسخة محدودة (لا بيانات محفظة).

## الهيكل (عمودي — لا tabs)
1. MyStocksBriefing (للمسجّلين: محفظتي + توقعاتي + أخباري)
2. AssetPreferenceOnboarding (onboarding للمستخدم الجديد)
3. MarketSummary (مؤشرات EGX30/70/100 + ملخص)
4. IndexCards (4 بطاقات: EGX30/70/100/C20 — كل بطاقة: اسم + قيمة + تغير + change% + mini-sparkline)
5. TopMovers (جدول top 5 gainers/losers — ticker + price + change% + volume)
6. RealtimeTicker (شريط أسعار متحرك — 10-15 بطاقة ticker + price + change)
7. CryptoSignalsWidget + SeasonalitySignalsWidget + EidPredictionsWidget + AutoAnalysisWidget (grid 2x2)
8. LiveStockTicker (ticker آخر)
9. MarketPulseWidget (نبض السوق)
10. LiveMonitor (للمسجّلين)
11. StockSelector (للتبديل السريع)
12. ShareButton + UnifiedPublishButton

## كل widget
- ملفوف بـ SafeWidget (ErrorBoundary): Card + AlertTriangle + "خطأ في تحميل {name}" عند الفشل.
- كل widget له skeleton أثناء التحميل.

## البيانات المعروضة
- IndexCards: current_price + change + change_pct + sparkline.
- TopMovers: ticker + name_ar + price + change% + volume (top 5 gainers + top 5 losers).
- RealtimeTicker: ticker + price + change + flash green/red على الحركة.
- CryptoSignals: Bitcoin + Ethereum + top 3 altcoins.

## التفاعلات
- Click على سهم → stock-detail.
- Click على مؤشر → stocks list filtered.
- Refresh button في Header → refetch كل widgets.

## الحالات
- تحميل: DashboardSkeleton (header + 4 KPI cards + 6 صفوف).
- widget خطأ: SafeWidget fallback.
- بيانات فارغة: EmptyState (icon + title + CTA).
- محفظة فارغة: CTA "أضف أول مركز".

## التجاوب
- Desktop: IndexCards grid-cols-4، TopMovers grid-cols-2 (gainers + losers).
- Tablet: IndexCards grid-cols-2، TopMovers grid-cols-1.
- Mobile: الكل stacked، RealtimeTicker horizontal scroll.

## معايير القبول
- Initial paint < 3s.
- كل widget له ErrorBoundary مستقل.
- RealtimeTicker يتحدّث لحظيًا.
- Sticky footer محترَم.
```

#### برومبت SCR-002 — Stocks List

```
صمّم شاشة "قائمة الأسهم" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
قائمة بكل أسهم السوق المصري + بحث + فلترة + فرز.

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. Header local: Title "أسهم السوق المصري" + Description.
2. StockSearchSelector: search bar autocomplete (يظهر اسم + ticker + sector أثناء الكتابة).
3. Filters bar (segmented buttons): القطاع (dropdown) / التغير (gainers/losers/all) / النشاط (active/all).
4. UnifiedTable:
   - # (ترتيب)
   - السهم (name_ar + ticker + شعار صغير)
   - السعر (current_price — tabular-nums)
   - التغير (change + change_pct — أخضر/أحمر + سهم)
   - Volume (مختصر: م/ب)
   - القيمة السوقية (مختصر + عملة)
   - قطاع (badge)
   - إشارة (Badge: شراء/بيع/انتظار — success/danger/warning)
   - إجراءات (زر "تفاصيل" + زر "إضافة لقائمة المراقبة")
5. Pagination (10/page).
6. Export button (CSV/PDF — أعلى يمين).

## التفاعلات
- Search debounced 300ms → filter table.
- Filter change → refetch.
- Click سهم → stock-detail.
- Click "إضافة لقائمة المراقبة" → POST + toast "تمت الإضافة".
- Sort column → toggle asc/desc.

## الحالات
- تحميل: Skeleton صفوف (5-7 صفوف رمادية).
- فارغ: "لا توجد أسهم مطابقة لبحثك" + Clear filters CTA.
- فشل: ErrorBoundary + Retry button.

## التجاوب
- Desktop: كل الأعمدة مرئية.
- Tablet: إخفاء "القيمة السوقية".
- Mobile: بطاقات بدل جدول (ticker + price + change فقط) + scroll horizontal للجدول الكامل.

## معايير القبول
- Search debounced.
- Sort working.
- Pagination 10/page.
- UnifiedTable مستخدم (Rule 52).
```

#### برومبت SCR-003 — Stock Detail

```
صمّم شاشة "تفاصيل السهم" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
تفاصيل سهم محدد + تحليل فني + شارت + توصية + أخبار + عمق.

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. Header: اسم السهم (عربي) + ticker (إنجليزي) + شعار الشركة + sector badge + "آخر تحديث: منذ X دقيقة" + "live" شارة (إن لحظي).
2. Price Block (كبير):
   - السعر الحالي (large, tabular-nums, JetBrains Mono).
   - تغير اليوم (مطلق + نسبي، أخضر/أحمر + سهم).
   - سعر الإغلاق السابق (small, muted).
   - Volume + Turnover (small).
3. Tabs bar: نظرة عامة / التحليل الفني / التوصية / الأخبار / العمق.

## Tab 1 — نظرة عامة
- TradingView widget (full width, h-[400px] desktop / h-[300px] mobile).
- 4 KPI cards: EPS / P/E / Market Cap / 52w high-low.
- Top holders (إن وجد) — top 5.
- Related stocks (same sector) — horizontal scroll.

## Tab 2 — التحليل الفني
- TradePlanCard (إن BUY/STRONG_BUY/ACCUMULATE — Rule 78):
  - سعر الدخول
  - الهدف الأول + الهدف الثاني
  - وقف الخسارة
  - R:R ratio (large, tabular-nums)
  - درجة الثقة (0-100 progress bar)
- Rule 78 guards (إذا signal غير شراء):
  - SELL/AVOID → شريط أحمر + "لا توجد فرصة شراء"
  - REDUCE → شريط amber
  - HOLD/WAIT → شريط amber خفيف + "انتظر تأكيد الإشارة"
- Fibonacci levels table (إن مدعوم).
- Support/Resistance table.
- Candlestick patterns widget (auto-detected).
- Technical indicators table: RSI / MACD / MA50 / MA200 / VWAP / OBV.

## Tab 3 — التوصية (Rule 73 SSOT — /api/stocks/[ticker]/unified)
- Recommendation badge كبير (شراء/بيع/احتفاظ/مراقبة).
- أسباب التوصية (قائمة بأيقونات).
- المخاطر (قائمة بأيقونات AlertTriangle).
- درجة الثقة (0-100 progress bar).
- تاريخ الإصدار + الحالة (active/expired/closed).

## Tab 4 — الأخبار
- News list filtered by ticker.
- كل خبر: title + source + time + summary + image (optional).
- Click → source (external).

## Tab 5 — العمق (Orderbook)
- Bids table (top 5): price + quantity + total.
- Asks table (top 5): price + quantity + total.
- Spread visualization (م خطي).
- Intraday flow (إن مدعوم).

## التفاعلات
- Tab switch → lazy load content.
- "أضف لقائمة المراقبة" → POST /api/watchlist + toast.
- "أنشئ تنبيه" → #alerts-center مع prefilled ticker.
- "شارك" → UnifiedPublishButton.
- Click على سهم related → switch context.

## الحالات
- تحميل: Tab skeleton.
- فارغ: "لا توجد بيانات لهذا السهم حاليًا".
- فشل: Retry button.
- سهم غير موجود: redirect #stocks + toast.
- Rule 78: TradePlanCard يظهر/يختفي حسب signal.

## التجاوب
- Desktop: TradingView full width + KPIs grid 4.
- Tablet: KPIs grid 2.
- Mobile: KPIs stacked + TradingView h-[300px] + tabs scrollable.

## معايير القبول
- Rule 73: كل قرار data من /api/stocks/[ticker]/unified.
- Rule 78: TradePlanCard مخفي لـ SELL/AVOID.
- Rule 27: NULL → "— بيانات غير متاحة".
- Tabs lazy loading.
```

#### برومبت SCR-005 — Portfolio

```
صمّم شاشة "المحفظة" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
محفظة المستخدم الموحدة + P&L + robo-advisor + risk quiz.

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. PortfolioSummary Card (large):
   - القيمة الإجمالية (large, tabular-nums).
   - إجمالي الربح/الخسارة (مطلق + نسبي، أخضر/أحمر).
   - نسبة الربح اليوم.
   - Equity curve chart (AreaChart — chart-1 emerald).
2. Tabs: المراكز / المحفظة المتقدمة / روبو-أدفايزر / اختبار المخاطر / Master.

## Tab 1 — المراكز
UnifiedTable:
- ticker + name_ar + شعار
- shares (quantity)
- avg_cost (متوسط التكلفة)
- current_price (live)
- market_value (= shares × current_price)
- P&L (مطلق + نسبي، أخضر/أحمر)
- weight% (نسبة من المحفظة)
- إجراءات: زر "إنقاذ" + زر "تفاصيل"

Add position button → Dialog form (ticker + shares + buy_price + date).

## Tab 2 — المحفظة المتقدمة
تحليل عميق + risk quiz + asset allocation pie chart.

## Tab 3 — روبو-أدفايزر
RoboAdvisorPanel: توصيات آلية بناءً على المحفظة الحالية.

## التفاعلات
- Add position → POST + refresh.
- Click "إنقاذ" → /rescue?ticker=XXXX.
- Click "تفاصيل" → #stock-detail.
- Filter by profit/loss.
- Sort columns.

## الحالات
- محفظة فارغة: EmptyState + "أضف أول مركز في محفظتك".
- تحميل: Skeleton.
- Rule 50: كل أرقام حقيقية من DB.
- Rule 27: NULL → "—".

## التجاوب
- Desktop: Summary card full width + Equity curve h-[300px].
- Tablet: grid 2 for KPIs.
- Mobile: stacked.

## معايير القبول
- Rule 50: كل أرقام مالية حقيقية.
- P&L محسوب من DB.
- Equity curve يعمل.
- Add position form valid.
```

#### برومبت SCR-006 — Watchlist

```
صمّم شاشة "قائمة المراقبة" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
قائمة المراقبة المحسّنة + إشارات ذكاء.

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. Header + "إضافة سهم" button.
2. WatchlistIntelligenceSection: تحليل ذكي (top movers في قائمتي + فرص قريبة من target).
3. UnifiedTable:
   - ticker + name_ar
   - current_price (tabular-nums)
   - change + change% (أخضر/أحمر)
   - signal (Badge)
   - target (إن وجد)
   - stop_loss (إن وجد)
   - R:R
   - alert_price (editable inline)
   - إجراءات: زر "حذف" + زر "تنبيه" + زر "تفاصيل"
4. StockSearchSelector لإضافة سهم (autocomplete).

## التفاعلات
- Add → POST /api/watchlist + toast "تمت الإضافة" + refresh.
- Delete → AlertDialog تأكيد + DELETE.
- Click → stock-detail.
- Edit alert_price inline → POST update.
- Set alert → #alerts-center.

## الحالات
- فارغة: "لا توجد أسهم في قائمة المراقبة. ابدأ بإضافة سهم." + CTA → StockSearchSelector.
- تحميل: Skeleton.
- فشل: ErrorBoundary + Retry.

## التجاوب
- Desktop: كل الأعمدة.
- Tablet: إخفاء R:R.
- Mobile: بطاقات (ticker + price + change + signal) + sticky first column.

## معايير القبول
- Add/Delete works.
- Alert price editable inline.
- Rule 52: UnifiedTable.
- Rule 50: أرقام حقيقية.
```

#### برومبت SCR-007 — Recommendations

```
صمّم شاشة "متابعة التوقعات" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
مركز التوقعات + تتبع الأداء + lessons learned.

## الجمهور
مسجّل + مدفوع.

## الهيكل (6-7 tabs)
1. التوقعات النشطة (default):
   - UnifiedTable بالتوقعات النشطة (20 BUY).
   - أعمدة: ticker / signal / entry / target / stop / R:R / confidence / date.
   - VIPLiveSignalsFeed (للـ VIP): catalyst amber box + copy button (Telegram/WhatsApp) + Audited Banner (4 stat boxes).
2. تتبع التوقعات:
   - Stats: total / win rate / hit target / hit stop / pending.
   - UnifiedTable بالتوقعات الموثّقة.
   - زر "تحقق من المعلقة".
3. ملخص التوقعات (VIP):
   - AuditedPerformanceView: 4 stat boxes (total / win rate / avg return / avg hold time).
   - Audited history table (آخر 20 صفقة).
4. الفرص الضائعة: جدول بالفرص التي فاتت.
5. دروس من الأخطاء: Cards بالدروس.
6. توقعات الخبراء: ExpertRecommendations table + expert track records.
7. التتبع الحي: LiveTracking endpoint.

## التفاعلات
- Tab switch → lazy load.
- Click توقع → #stock-detail?ticker=XXXX.
- Verify pending → POST + toast.
- Copy signal (VIP) → clipboard + toast.

## الحالات
- لا توقعات: EmptyState + "تصفّح الأسهم".
- VIP locked: UpgradePrompt للـ non-VIP.
- تحميل: Tab skeleton.

## التجاوب
- Desktop: Tabs bar full.
- Mobile: Tabs scrollable horizontally.

## معايير القبول
- Rule 50: كل أرقام محفظة حقيقية.
- Rule 73: مصدر عرض واحد للقرار.
- Tab switching lazy.
- VIPLiveSignalsFeed gated.
```

#### برومبت SCR-017 / SCR-AC-005 — BagHolder Rescue

```
صمّم شاشة "عيادة إنقاذ الصفقات المتعثرة" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
إنقاذ الصفقات الخاسرة — 3 قرارات صارمة (CUT_LOSS / AVERAGE_DOWN / HOLD).

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. Header: "عيادة إنقاذ الصفقات" + icon (Stethoscope أو LifeBuoy).
2. Form (inline):
   - ticker (StockSearchSelector autocomplete)
   - buy_price (Input number)
   - quantity (Input number)
   - total_cost (auto-calculated = buy_price × quantity)
3. Diagnosis section (after submit):
   - تشخيص جذري: لماذا السهم خسران؟ (regime + fundamentals + news + chart pattern).
   - تقييم مؤسسي: institutional analysis (money flow + Wyckoff phase).
4. 3 Decisions cards (horizontal — grid-cols-3 desktop / stacked mobile):
   - **CUT_LOSS** (red card, bg-danger/10, border-danger):
     - Title: "أوقف الخسارة فورًا"
     - Description: لماذا القطع هو القرار الأفضل.
     - Estimated loss.
     - زر "تنفيذ القطع" → Dialog تأكيد.
   - **AVERAGE_DOWN** (amber card, bg-warning/10, border-warning):
     - Title: "متوسط التكلفة بشروط"
     - الشروط الواجب توفرها.
     - Required additional capital.
     - New avg cost calculation.
     - زر "تنفيذ المتوسط" → Dialog تأكيد.
   - **HOLD** (emerald card, bg-success/10, border-success):
     - Title: "احتفظ وانتظر"
     - الأسباب التي تبرر الانتظار.
     - Target price + expected timeline.
     - زر "احتفظ بالسهم" → toast.
5. Recovery plan section:
   - خطوات استعادة رأس المال.
   - Timeline متوقع.
6. Lessons learned section:
   - دروس من هذه الصفقة.
   - أنماط لتجنّبها مستقبلًا.

## التفاعلات
- Submit form → POST /api/portfolio/bag-holder-rescue → diagnosis.
- Click على قرار → Dialog تأكيد + تفاصيل + تنفيذ.
- Auto-fill من query params (deep link من #portfolio): ?ticker=XXXX&buy_price=XX&quantity=XX&total_cost=XX&auto=1.

## الحالات
- تحميل التشخيص: skeleton (3 cards placeholders).
- لا يمكن إنقاذ: "هذا السهم لا يمكن إنقاذه بسهولة. استشر مختصًا."
- Rule 78: لا توصية شراء على سهم خسران (إلا AVERAGE_DOWN بشروط صارمة).

## التجاوب
- Desktop: 3 cards horizontal grid-cols-3.
- Tablet: 2 cards + 1 full width.
- Mobile: stacked.

## معايير القبول
- 3 قرارات صارمة واضحة (CUT/AVERAGE/HOLD).
- Auto-fill من query params.
- Rule 78 محترَم.
- Recovery plan + Lessons learned.
```

#### برومبت SCR-020 — Liquidity Radar

```
صمّم شاشة "رادار السيولة" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
رادار سيولة بـ 4 أعمدة لكل سهم (الحوت / حالة السوق / المرحلة / الدخول والدفاع).

## الجمهور
مدفوع فقط.

## الهيكل (LiquidityRadarView — 712 LOC)
1. Market Regime Banner (sticky top): حالة السوق العامة (bull/bear/range) + confidence + last update.
2. Phase filter chips (horizontal scroll): accumulation / markup / distribution / markdown / all.
3. 4-column grid لكل سهم (UnifiedTable-like):
   - **العمود 1 — الحوت**: Institutional money flow (Wyckoff). 
     - buy_pct vs sell_pct (progress bar).
     - net_flow (أخضر/أحمر).
     - Rule 80: لو buy_pct<45% أو net_flow<0 → "🔴 ضغط بيعي".
   - **العمود 2 — حالة السوق**: market sentiment (bullish/bearish/neutral).
     - Market regime badge.
     - Sector performance.
   - **العمود 3 — المرحلة**: Wyckoff phase (Phase A/B/C/D/E).
     - Phase badge.
     - Description tooltip.
   - **العمود 4 — الدخول والدفاع**: entry + defense strategy.
     - Entry price.
     - Stop loss.
     - Target.
     - R:R ratio.

## التفاعلات
- Click chip → filter by phase.
- Click سهم → stock-detail.
- Sort columns.

## الحالات
- EmptyState: "لا توجد فرص في هذه المرحلة حاليًا".
- تحميل: Skeleton.

## التجاوب
- Desktop: 4 columns horizontal.
- Tablet: 2 columns grid.
- Mobile: stacked cards (1 column).

## معايير القبول
- 4 أعمدة واضحة لكل سهم.
- Phase filter يعمل.
- Rule 80: لا "سيولة داخلة" لو buy_pct<45% أو net_flow<0.
- Rule 27: NULL → "—".
```

#### برومبت SCR-022 — Alerts Center

```
صمّم شاشة "مركز التنبيهات" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
مركز التنبيهات الذكية + sniper scan polling.

## الجمهور
مسجّل + مدفوع.

## الهيكل
1. Stats cards (3): active / triggered today / pending.
2. Tabs: التنبيهات النشطة / المُطلقة (history) / Sniper scan.
3. Create alert button → Dialog form:
   - ticker (StockSearchSelector)
   - condition (price_above / price_below / signal_change)
   - target_price (Input number)
   - notification_method (in_app / push / email)
4. SmartAlertsPanel (side panel right): تنبيهات ذكية مقترحة.

## Tab 1 — التنبيهات النشطة
UnifiedTable:
- ticker + name_ar
- condition (Badge)
- target_price
- current_price
- distance (كم تبقّى)
- created_at
- status (Badge: active / pending / triggered)
- إجراءات: زر "تعديل" + زر "حذف"

## Tab 2 — المُطلقة (history)
UnifiedTable: triggered alerts في آخر 30 يوم.

## Tab 3 — Sniper scan
Polling كل 60s.
UnifiedTable: فرص sniper (ticker + signal + confidence + entry + target + R:R).
زرة "أضف للمراقبة" لكل صف.

## التفاعلات
- Create → POST /api/alerts + toast.
- Delete → AlertDialog + DELETE.
- Click alert → stock-detail.
- Sniper click → stock-detail.
- Edit → inline edit.

## الحالات
- لا تنبيهات: EmptyState + "أنشئ أول تنبيه".
- Sniper polling: spinner أثناء التحديث.
- Alert triggered: toast + sound + desktop notification (إن enabled).

## التجاوب
- Desktop: Stats grid-cols-3 + table full.
- Mobile: Stats stacked + table cards.

## معايير القبول
- Create/Delete works.
- Sniper polling 60s.
- Alert sound + desktop notification.
- Rule 52: UnifiedTable.
```

#### برومبت SCR-AC-001 — Auth View

```
صمّم شاشة "تسجيل الدخول/التسجيل" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
بوابة دخول المستخدم — Google + Credentials (dev only).

## الجمهور
زائر غير مسجّل.

## الهيكل
1. Background: emerald radial pattern (alpha ≤ 0.08).
2. Card center (max-w-md):
   - شعار + "دليل الاستثمار".
   - Tabs: login / register.

## Login Tab:
- username_or_email (Input — icon User).
- password (Input type=password — icon Lock + show/hide toggle).
- زر "تسجيل الدخول" (Primary, full width).
- Divider "أو".
- زر "الدخول بحساب Google" (Outline, full width + Google icon).

## Register Tab:
- email (Input — icon Mail).
- username (Input — icon User).
- password (Input type=password — icon Lock + show/hide toggle + strength indicator).
- confirm_password (Input type=password).
- زر "إنشاء حساب" (Primary, full width).
- Divider "أو".
- زر "التسجيل بـ Google" (Outline, full width + Google icon).

## التفاعلات
- Submit login → signIn → redirect dashboard.
- Submit register → POST /api/auth/register → auto-login → dashboard.
- Google button → signIn('google').
- Tab switch via sessionStorage.auth_initial_tab.

## الحالات
- Validation error: inline red text below input.
- Auth error: toast "بيانات غير صحيحة".
- Loading: spinner on button + disabled.

## التجاوب
- Desktop: max-w-md centered.
- Mobile: full width + padding.

## معايير القبول
- Google login works.
- Credentials (dev only if ALLOW_FORM_LOGIN=true).
- Form validation (zod).
- Redirect after success.
```

#### برومبت SCR-AC-002 — Subscription

```
صمّم شاشة "الاشتراكات" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
باقات الاشتراك + مقارنة + B2B + checkout.

## الجمهور
Free (يريد الترقية).

## الهيكل
1. Header: "اختر خطة الاشتراك المناسبة" + Description.
2. Currency toggle (ج.م / $ / ر.س / د.ك / ر.ق — ديناميكي حسب السوق).
3. Pricing cards grid (4 plans):
   - **Premium** (emerald border): الميزات الأساسية (توقعات + محفظة + تنبيهات).
     - السعر الشهري + السنوي.
     - "اشترك الآن" button.
   - **Pro** (emerald border thicker): + advanced-portfolio + specialist-analysis.
   - **VIP Pass** (gold border + "الأكثر شعبية" badge): + VIPLiveSignalsFeed + AuditedPerformance.
   - **Developer** (slate border): + B2B API key + limits أعلى.
4. Comparison table (ميزات × خطط):
   - max_watchlist / max_portfolio / ai_messages / advanced features.
   - ✓ / ✗ per plan.
5. B2B section: plans for businesses (custom pricing).
6. Telegram bot plans: plans for bot users.

## التفاعلات
- Click "اشترك الآن" → POST /api/subscription/checkout → InstapayModal.
- Select plan → highlight.
- Currency toggle → recalc prices.
- Monthly/Yearly toggle.

## الحالات
- Loading plans: skeleton cards.
- Checkout loading: spinner in modal.
- Checkout error: toast + retry.

## التجاوب
- Desktop: grid-cols-4.
- Tablet: grid-cols-2.
- Mobile: grid-cols-1 (stacked).

## معايير القبول
- Plans تعرض بأسعار صحيحة حسب السوق.
- InstapayModal يعمل.
- Auto-detect market من navigator.language.
```

#### برومبت SCR-AD-001 — Admin Main

```
صمّم شاشة "لوحة الإدارة" لمنصة استثمار مؤسسية. استخدم Master Brief — لكن أسلوب تقني مسموح هنا (Rule 30 استثناء للأدمن).

## الهدف
لوحة إدارة شاملة بـ 20+ sub-tabs.

## الجمهور
أدمن فقط (subscription_tier='admin' أو localhost bypass).

## الهيكل (NotebookAdminTab — sidebar + content)
1. Sidebar (يمين، 20+ tabs):
   - Dashboard (overview)
   - Users management
   - Predictions management
   - Educational cards
   - Reports
   - Telegram bot
   - Crypto management
   - Forex management
   - System control
   - DB manager
   - Backup/restore
   - Engines status
   - PM2 control
   - Promo codes
   - News management
   - Sharia management
   - Source authority
   - Validation monitor
   - Cron health
   - Platform performance
   - AI analyze
   - A/B tests
2. Content area (يسار):
   - Title + description.
   - محتوى ديناميكي حسب tab.

## التفاعلات
- Click sidebar tab → switch content.
- Search in sidebar.

## الحالات
- تحميل: skeleton.
- خطأ: ErrorBoundary.

## التجاوب
- Desktop: sidebar ثابت (w-64) + content.
- Mobile: drawer للـ sidebar (hamburger menu).

## معايير القبول
- Admin gate على server (admin/layout.tsx).
- localhost bypass للـ dev.
- كل sub-tab له loading/error states.
- أسلوب تقني مسموح (Rule 30 استثناء).
```

#### برومبت SCR-AD-002 — Honest Predictions

```
صمّم شاشة "التوقعات الصادقة" (أكبر صفحة — 1855 سطر) لمنصة استثمار مؤسسية. استخدم Master Brief — أسلوب تقني.

## الهدف
لوحة التوقعات الصادقة + إحصائيات + إدارة.

## الجمهور
أدمن.

## الهيكل
1. Stats cards (4): total / win rate / avg return / active count.
2. Charts (Recharts):
   - AreaChart: performance over time (آخر 30 يوم).
   - PieChart: win/loss distribution.
3. Filters bar: date range / signal / outcome / ticker.
4. UnifiedTable: predictions with all fields:
   - ticker + name_ar
   - signal (Badge)
   - entry / target / stop
   - R:R
   - confidence
   - prediction_date
   - outcome (hit_target / hit_stop / pending)
   - actual_return
   - exit_price
   - exit_type
5. Actions:
   - "توليد التوقعات" button → POST /api/admin/generate-predictions.
   - "تصدير" button → CSV/PDF.
   - "إغلاق المعلقة" button → POST /api/admin/close-predictions.

## التفاعلات
- Filter change → refetch.
- Sort columns.
- Pagination.
- Click prediction → detail modal.
- Export → download file.

## الحالات
- تحميل: skeleton.
- فارغ: "لا توجد توقعات".
- فشل توليد: toast.

## التجاوب
- Desktop: charts side-by-side + table full.
- Tablet: charts stacked.
- Mobile: cards بدل table.

## معايير القبول
- Rule 50: كل أرقام حقيقية.
- Recharts rendering صحيح RTL.
- Filters تعمل.
- Export works.
```

#### برومبت SCR-PG-001 — Payment Success

```
صمّم شاشة "نجاح الدفع" لمنصة استثمار مؤسسية. استخدم Master Brief.

## الهدف
صفحة تأكيد الدفع — polling على status (Fix CRIT-15: لا auto-activate).

## الجمهور
مستخدم بعد checkout.

## الهيكل (4 states — full screen centered)

## State 1 — processing (default):
- Large spinner (Loader2).
- Title: "جارٍ التحقق من الدفع..."
- Description: "قد يستغرق بضع ثوانٍ."

## State 2 — success:
- ✓ icon (large, emerald, animated).
- Title: "تم تفعيل اشتراكك بنجاح".
- Description: "مرحبًا بك في خطة {plan_name}".
- CTA: "ابدأ الآن" → #dashboard.

## State 3 — still-processing:
- ⏳ icon (large, amber).
- Title: "ننتظر تأكيد الدفع".
- Description: "قد يستغرق دقائق. يمكنك إغلاق هذه الصفحة وسنُعلمك عند التأكيد."
- CTA: "العودة للرئيسية".

## State 4 — error:
- ✗ icon (large, red).
- Title: "فشل التحقق من الدفع".
- Description: "حدث خطأ أثناء التحقق. تواصل مع الدعم."
- CTA: "تواصل مع الدعم" → mailto/telegram.
- CTA secondary: "إعادة المحاولة".

## التفاعلات
- Polling /api/subscription/status كل 2s (max 15 attempts = 30s).
- Success → "ابدأ الآن" → #dashboard.
- Error → "تواصل مع الدعم".
- No auto-activate (أمني).

## التجاوب
- Centered full screen على كل الأحجام.

## معايير القبول
- NO auto-activate (Fix CRIT-15).
- Polling max 30s.
- 4 states واضحة.
- PAID_TIERS check.
```

#### برومبت شاشات P2/P3 (مكثّف)

```
صمّم الشاشات التالية لمنصة استثمار مؤسسية. استخدم Master Brief. كل شاشة تتبع نفس النمط: Header + محتوى + Sticky Footer.

## SCR-008 — Smart Confluence (#smart-confluence)
- Header: "توقعات الـ Confluence الذكية".
- Stats row: total / avg confidence / avg R:R / market regime.
- UnifiedTable بالـ 20 توقع (ticker / signal / confidence / entry / target1 / target2 / stop / R:R).
- Click → stock-detail.

## SCR-009 — Specialist Analysis (#specialist-analysis)
- Header: "التحليل المتخصص".
- Tabs: Fibonacci / Candlestick / Patterns.
- Fibonacci: levels table (0/23.6/38.2/50/61.8/78.6/100/161.8).
- Candlestick: auto-detected patterns + chart.
- Patterns: head shoulders / triangles / flags.

## SCR-010 — Prediction Tracking (#prediction-tracking)
- Stats: total / win rate / hit target / hit stop / pending.
- UnifiedTable: verified predictions + outcome.
- Win rate over time chart (AreaChart).

## SCR-011 — Dual Track (#dual-track)
- persona predictions comparison (تاريخي).
- 2 columns: gambler vs investor (رغم إعدام نظام الشخصيات — يعرض comparison تاريخي).

## SCR-012 — V82 (#v82)
- V82DecisionPanel: لوحة قرار مؤسسي.
- Stats + decision matrix + recommendation.

## SCR-013 — Reports (#reports)
- بطاقات صور تقارير بفترات (daily/weekly/monthly/quarterly/yearly).
- Auth-protected. StockLeagueImageCard per period.

## SCR-014 — News (#news)
- Header + filters (sector/ticker/source).
- News list: title + source + time + summary + image.
- Click → source (external).

## SCR-015 — Simulation (#simulation)
- paper-trading-v2: virtual account + orders + positions.
- Balance + Equity curve + Open positions table + Order form.
- Reset button.

## SCR-016 — Academy (#academy)
- 5 tabs: الدروس / الموسوعة / محاكاة الشموع / محاكاة توقيت الدخول / محاكاة محفظة.
- كل tab: list + content.

## SCR-018 — Advanced Portfolio (#advanced-portfolio)
- تحليل عميق + risk quiz + asset allocation pie chart.

## SCR-019 — Seasonality (#seasonality)
- monthly performance heatmap + best/worst months + recurring patterns.

## SCR-021 — Market Depth (#market-depth)
- InvestorsFlow + LiquidityFlow + IntradayPressure + MultiMarket widgets.

## SCR-023 — Live Monitor (#live-monitor)
- مراقبة محفظة لحظية: intraday pressure + market depth + investors flow.

## SCR-024 — Wealth (#wealth)
- wealth charts + real return (after inflation) + asset allocation.

## SCR-025 — Trading Memory (#trading-memory)
- insights: past trades + mistakes patterns + best setups.

## SCR-026 — Publishing (#publishing)
- نشر سهم + بطاقات إنفوجرافيك + trade results export.

## SCR-CR-001 — Crypto Portfolio (#crypto-portfolio)
- نفس بنية #portfolio لكن CRYPTO + USD.

## SCR-CR-002 — Crypto Watchlist (#crypto-watchlist)
- EnhancedWatchlistView + CRYPTO.

## SCR-CR-003 — Crypto Prediction Tracking (#crypto-prediction-tracking)
- CryptoPredictionTrackingView مستقل.

## SCR-IS-001 — Zakat (#zakat)
- حاسبة الزكاة: total wealth + nisab → result + breakdown.

## SCR-IS-002 — Tithes (#tithes)
- حاسبة العشور.

## SCR-IS-003 — Sharia (#sharia)
- 3 tabs: قائمة 253 سهم / تطهير صفقة / تطهير محفظة. emerald + gold aesthetic.

## SCR-AC-003 — Settings (#settings)
- تفضيلات: لغة / عملة عرض / إشعارات / dark mode / حذف حساب.

## SCR-AC-004 — About (#about)
- معلومات المنصة + الفريق + التواصل.

## SCR-LG-001 — Terms (/legal/terms)
- شروط الاستخدام. (ملاحظة: استخدم emerald gradient بدل purple — موثّق في الملحق).

## SCR-LG-002 — Disclaimer (/legal/disclaimer)
- إخلاء المسؤولية الاستثمارية. amber gradient.

## SCR-LG-003 — Privacy (/legal/privacy)
- سياسة الخصوصية. emerald gradient.

## SCR-PG-002 — Backtest (/backtest)
- walk-forward dashboard: phase1 + phase2 results + durations.

## SCR-AD-003 — Educational Cards (/admin/educational-cards)
- CRUD كروت تعليمية.

## SCR-AD-004 — Admin Reports (/admin/reports)
- تقارير الدوري بفترات (StockLeagueImageCard).
```

#### برومبتات Overlays (5)

```
## SCR-OV-001 — LoginPromptModal
Dialog (max-w-md):
- Header: متدرّج amber→emerald + شعار + "سجّل مجاناً للوصول الكامل".
- Body: 5 مميزات (توقعات ذكية / تحليلات فنية / متابعة محفظة / تنبيهات / قوائم مراقبة).
- CTA Primary: "سجّل مجاناً" (UserPlus icon).
- CTA Secondary: "دخول" (LogIn icon).
- زر X يتطلب تأكيد AlertDialog (للحفاظ على conversion funnel).

## SCR-OV-002 — TrialCountdownBanner
Sticky banner (z-40, top of AppShell):
- 3 مستويات لونية:
  - daysLeft ≥ 7: أزرق هادئ (sky).
  - daysLeft 3-6: أصفر تحذير (amber).
  - daysLeft 1-2: أحمر حرج (rose) — "آخر فرصة!".
- Content: "باقي {daysLeft} يوم على انتهاء التجربة. تاريخ الانتهاء: {date}."
- CTA: "اشترك الآن" → Dialog ي host PricingView.
- زر X للإغلاق (dismissed state يُ reset عند تغيّر daysLeft).

## SCR-OV-003 — TrialExpiredModal
Fullscreen overlay (z-[100], لا X button):
- Sticky top bar: "انتهت فترة التجربة المجانية" + زر تسجيل خروج.
- Promo code section: حقل نص + زر "تفعيل" + states (loading/success/error).
- PricingView asModal (كل خطط الأسعار).

## SCR-OV-004 — SessionExpiredModal
Non-dismissible Dialog (Escape/outside-click blocked):
- Icon: Lock + AlertTriangle.
- Title: "انتهت جلستك".
- Description: "يجب تسجيل الدخول مرة أخرى للمتابعة."
- زر واحد فقط: "تسجيل الدخول" → signOut({callbackUrl:'/', redirect:true}).

## SCR-OV-005 — InstapayModal
Dialog (max-w-lg):
- Header: "رفع إيصال الدفع".
- States:
  - upload: drag-drop zone + file input + preview.
  - copy: account number + copy button.
  - check: reference input + submit.
  - pending: spinner + "جارٍ التحقق...".
  - verified: ✓ + "تم تفعيل اشتراكك".
  - error: ✗ + "فشل التحقق" + retry.
```

#### برومبتات البنية التحتية (8)

```
## SCR-IN-001 — layout.tsx
Root layout: <html lang dir> + <body suppressHydrationWarning> + Providers + SonnerToaster + FeedbackWidget + skip-link + StructuredDataScripts (JSON-LD).
force-dynamic + revalidate=0.

## SCR-IN-002 — globals.css
Light/Dark color systems (emerald-based) + Cairo/Tajawal/Outfit/JetBrains Mono fonts + tabular-nums + body radial gradient (alpha ≤ 0.08).

## SCR-IN-003 — error.tsx
App-level boundary: Card + AlertTriangle + "إعادة المحاولة" (reset) + "العودة للرئيسية". Stack trace فقط في dev.

## SCR-IN-004 — global-error.tsx
Root boundary: standalone inline-styles + retry + Home. (ملاحظة: استخدم emerald بدل indigo — موثّق في الملحق).

## SCR-IN-005 — not-found.tsx
404 عربية: Card + Compass icon + "٤٠٤" + "العودة للرئيسية".

## SCR-IN-006 — loading.tsx
Suspense skeleton: header + 4 KPI cards + 6 صفوف جدول + footer.

## SCR-IN-007 — robots.ts
robots.txt: User-agent: * + Allow: / + Disallow: /api/ + Disallow: /admin/.

## SCR-IN-008 — sitemap.ts
sitemap.xml: entries من stocks.db + 15 static route. (ملاحظة: روابط deep يجب أن تستخدم #view لا ?view= — موثّق في الملحق).
```

---

### 6.7 الملف 7 من 8 — DESIGN_REVIEW_CHECKLIST

```markdown
# DESIGN_REVIEW_CHECKLIST — قائمة مراجعة مخرجات Stitch

> استخدم هذه القائمة لمقارنة ما يُنتجه Stitch بالمواصفات المعتمدة. كل بند يجب أن يُجاب عليه بـ ✓ أو ✗ + ملاحظة.

## 1. الهوية البصرية العامة
- [ ] اللون الأساسي Emerald-600 #10B981؟
- [ ] لا blue/indigo (ما عدا info badge #0EA5E9)؟
- [ ] الخط العربي Cairo؟
- [ ] خط الأرقام JetBrains Mono + tabular-nums؟
- [ ] أسلوب احترافي وقور (لا hype، لا إيموجي زائد)؟
- [ ] RTL إلزامي (dir="rtl" على html)؟
- [ ] logical properties مستخدمة (ms/me, ps/pe, border-s/border-e)؟
- [ ] Body radial gradient alpha ≤ 0.08؟

## 2. الـ Components
- [ ] shadcn/ui new-york style مستخدم؟
- [ ] UnifiedTable مستخدم في كل الجداول (لا <Table> يدوي)؟
- [ ] UnifiedPublishButton مستخدم لكل زر نشر؟
- [ ] SafeWidget يحيط بكل widget في Dashboard؟
- [ ] withErrorBoundary HOC يحيط بكل view ثقيل؟
- [ ] LazyTabLoader skeleton لكل lazy-loaded view؟
- [ ] StockSearchSelector للبحث عن أسهم؟
- [ ] ExchangeSelector لمبدّل الأسواق؟

## 3. الأزرار والحقول
- [ ] Button variants صحيحة (Primary/Secondary/Outline/Ghost/Destructive/Link)؟
- [ ] Touch target ≥ 44×44px؟
- [ ] Focus ring ظاهر (ring-2 ring-ring ring-offset-2)؟
- [ ] Disabled state واضح (opacity-50)؟
- [ ] Loading state (spinner + disabled)؟
- [ ] Form validation (zod + react-hook-form)؟

## 4. البطاقات والجداول
- [ ] Card radius rounded-xl (12px)؟
- [ ] Dual-layer shadow (shadow-sm + ring-1 ring-border/50)؟
- [ ] Card padding p-4 (mobile) / p-6 (desktop)؟
- [ ] UnifiedTable enableSorting + enableFiltering + enablePagination؟
- [ ] stickyHeader + rtl؟

## 5. الرسوم البيانية
- [ ] Recharts مستخدم (لا Chart.js)؟
- [ ] chart-1..5 (emerald/teal/amber/orange/lime) فقط؟
- [ ] RTL: reversed x-axis؟
- [ ] Tooltips عربية + tabular-nums؟
- [ ] لا gradients مفرطة (Rule 29)؟

## 6. الشارات (Badges)
- [ ] success/warning/danger/info/neutral variants؟
- [ ] لا الاعتماد على اللون وحده — نص عربي معه (Rule 30)؟

## 7. الحالات الاستثنائية
- [ ] تحميل: Skeleton/LazyTabLoader؟
- [ ] فراغ: EmptyState (icon + title + CTA)؟
- [ ] خطأ widget: SafeWidget fallback (Card + AlertTriangle)؟
- [ ] خطأ صفحة: error.tsx (Card + Retry + Home)؟
- [ ] Rule 27: NULL → "— بيانات غير متاحة" (لا 0، لا 50، لا placeholder)؟

## 8. الاستثمار (قواعد حرجة)
- [ ] Rule 50: كل أرقام محفظة/ثروة/تنبيهات حقيقية من DB؟
- [ ] Rule 73: مصدر عرض واحد للقرار (/api/stocks/[ticker]/unified)؟
- [ ] Rule 78: TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE؟
  - SELL/AVOID → شريط أحمر؟
  - REDUCE → شريط amber؟
  - HOLD/WAIT → شريط amber خفيف؟
- [ ] Rule 80: لا "سيولة داخلة" لو buy_pct<45% أو net_flow<0؟
- [ ] لا ضمان للأرباح؟
- [ ] إخلاء مسؤولية واضح (/legal/disclaimer)؟
- [ ] "آخر تحديث" + مؤشر حداثة البيانات؟
- [ ] شارة "live" للأسعار اللحظية؟

## 9. التنقل
- [ ] TopBar (desktop) بـ 5 dropdowns + Market Switcher + Currency Toggle؟
- [ ] MobileNav (mobile) بـ 5 أيقونات ثابتة فقط؟
- [ ] MobileMoreSheet للإضافات؟
- [ ] Header local مع Search + Dark mode + Notifications + Refresh؟
- [ ] Footer sticky (mt-auto)؟
- [ ] Hash-based routing (#view)؟

## 10. التجاوب
- [ ] Mobile-first (grid-cols-1 → sm:grid-cols-2 → lg:grid-cols-4)؟
- [ ] TopBar يختفي < md → MobileNav يظهر؟
- [ ] Search input يختفي < md → StockSelector في MobileMoreSheet؟
- [ ] الجداول: overflow-x-auto + sticky first column على mobile؟
- [ ] Charts: h-[300px] mobile → h-[400px] desktop؟
- [ ] safe-area-inset محترَم (iOS notch)؟

## 11. RTL
- [ ] <html lang="ar" dir="rtl">؟
- [ ] logical properties (ms/me, ps/pe, border-s/border-e)؟
- [ ] scrollbar-gutter: stable؟
- [ ] الأرقام tabular-nums + LTR؟
- [ ] Tabs/Sidebar من اليمين؟

## 12. الصلاحيات
- [ ] LoginPromptModal يظهر عند PROTECTED_VIEW للزائر؟
- [ ] TrialCountdownBanner يظهر آخر 7 أيام؟
- [ ] TrialExpiredModal fullscreen لا X؟
- [ ] SessionExpiredModal non-dismissible؟
- [ ] Admin gate على server (admin/layout.tsx)؟

## 13. الشاشات الأساسية (P0)
- [ ] SCR-001 Dashboard: 12 widgets + SafeWidget لكل واحد؟
- [ ] SCR-002 Stocks: UnifiedTable + filters + search + pagination؟
- [ ] SCR-003 Stock Detail: 5 tabs + Rule 78 guards + Rule 73 SSOT؟
- [ ] SCR-005 Portfolio: Summary + Equity curve + Tabs + Add position؟
- [ ] SCR-006 Watchlist: UnifiedTable + Intelligence + Add/Delete؟
- [ ] SCR-007 Recommendations: 6-7 tabs + VIP gating؟
- [ ] SCR-AC-001 Auth: Tabs + Google + zod validation؟
- [ ] SCR-AC-002 Subscription: 4 plans + comparison + InstapayModal؟
- [ ] SCR-LG-002 Disclaimer: واضح؟
- [ ] SCR-PG-001 Payment Success: 4 states + polling + NO auto-activate؟

## 14. الشاشات عالية الأولوية (P1)
- [ ] SCR-008 Smart Confluence: 20 توقع + Rule 78؟
- [ ] SCR-010 Prediction Tracking: stats + verified table؟
- [ ] SCR-017/AC-005 Rescue: 3 cards (CUT/AVERAGE/HOLD) + auto-fill؟
- [ ] SCR-020 Liquidity Radar: 4 columns + phase filter + Rule 80؟
- [ ] SCR-022 Alerts Center: tabs + create + sniper polling؟
- [ ] SCR-014 News: filters + list + external links؟
- [ ] SCR-003 Stock Filters: filters sidebar + UnifiedTable؟
- [ ] SCR-004 Trading Chart: TradingView widget + timeframes؟
- [ ] SCR-AD-001 Admin: sidebar 20+ tabs + content؟
- [ ] SCR-AD-002 Honest Predictions: stats + charts + table + actions؟

## 15. الـ Overlays (5)
- [ ] SCR-OV-001 LoginPromptModal: 5 مميزات + X يتطلب تأكيد؟
- [ ] SCR-OV-002 TrialCountdownBanner: 3 مستويات لونية؟
- [ ] SCR-OV-003 TrialExpiredModal: fullscreen + لا X + promo code؟
- [ ] SCR-OV-004 SessionExpiredModal: non-dismissible + زر واحد؟
- [ ] SCR-OV-005 InstapayModal: 6 states (upload/copy/check/pending/verified/error)؟

## 16. البنية التحتية (8)
- [ ] SCR-IN-001 layout.tsx: RTL + Providers + SEO + skip-link؟
- [ ] SCR-IN-002 globals.css: نظام ألوان + خطوط + tabular-nums؟
- [ ] SCR-IN-003 error.tsx: Card + Retry + Home؟
- [ ] SCR-IN-004 global-error.tsx: standalone + retry؟
- [ ] SCR-IN-005 not-found.tsx: 404 عربية؟
- [ ] SCR-IN-006 loading.tsx: skeleton؟
- [ ] SCR-IN-007 robots.ts: allow all + disallow /api/ /admin/؟
- [ ] SCR-IN-008 sitemap.ts: entries + 15 static؟

## 17. اتساق التصميم
- [ ] كل الشاشات تستخدم نفس Design System؟
- [ ] لا تباين بصري غير مبرّر بين الشاشات؟
- [ ] نفس patterns للجدول/البطاقة/الزر في كل مكان؟
- [ ] نفس patterns للحالات الاستثنائية (تحميل/فراغ/خطأ)؟

## 18. معايير القبول لكل شاشة
لكل شاشة، تحقّق من:
- [ ] الهدف واضح؟
- [ ] الجمهور محدد؟
- [ ] الصلاحيات محترَمة؟
- [ ] الهيكل المرئي كامل (من الأعلى للأسفل)؟
- [ ] كل عنصر موصوف (بيانات + تفاعل + حالات)؟
- [ ] التجاوب على 3 أحجام (desktop/tablet/mobile)؟
- [ ] RTL محترَم؟
- [ ] معايير قبول قابلة للاختبار؟

## 19. تحذيرات نهائية
- [ ] لا بيانات مختلقة (أرقام/نتائج/API)؟
- [ ] لا ضمان للأرباح؟
- [ ] لا شاشات جديدة خارج النطاق المعتمد؟
- [ ] لا مكونات مختلفة بصريًا دون سبب؟
- [ ] كل NULL → "— بيانات غير متاحة"؟
```

---

### 6.8 الملف 8 من 8 — HANDOFF_TO_DEVELOPMENT

```markdown
# HANDOFF_TO_DEVELOPMENT — تعليمات تسليم التصميم لفريق البرمجة

> هذا الملف موجّه لفريق البرمجة (Next.js + TypeScript + shadcn/ui). يربط معرفات الشاشات بالملفات الفعلية + يحدّد الحالات + معايير القبول.

## 1. خريطة المعرف → الملف الفعلي

### شاشات EGX (26)
| المعرف | Hash | الملف المرجعي (موجود) | الوحدة |
|---|---|---|---|
| SCR-001 | #dashboard | src/modules/dashboard/components/DashboardView.tsx | dashboard |
| SCR-002 | #stocks | src/modules/stock-analysis/components/StocksView.tsx (إن وجد) | stock-analysis |
| SCR-003 | #stock-filters | src/modules/screener/components/StockScreenerAdvanced.tsx | screener |
| SCR-004 | #trading-chart | src/modules/stock-analysis/components/TradingChartView.tsx | stock-analysis |
| SCR-005 | #portfolio | src/modules/portfolio/components/PortfolioView.tsx | portfolio |
| SCR-006 | #watchlist | src/components/watchlist/EnhancedWatchlistView.tsx | watchlist |
| SCR-007 | #recommendations | src/modules/market-analysis/components/MarketAnalysisView.tsx | market-analysis |
| SCR-008 | #smart-confluence | src/components/smart-assistant/SmartConfluenceView.tsx | smart-assistant |
| SCR-009 | #specialist-analysis | src/components/advanced-analysis/SpecialistAnalysisView.tsx | advanced-analysis |
| SCR-010 | #prediction-tracking | src/modules/predictions/components/PredictionTrackingDashboard.tsx | predictions |
| SCR-011 | #dual-track | src/modules/predictions/components/DualTrackView.tsx | predictions |
| SCR-012 | #v82 | src/components/v82/V82DecisionPanel.tsx | v82 |
| SCR-013 | #reports | src/modules/reports/components/ExecutiveReportView.tsx | reports |
| SCR-014 | #news | src/modules/news/components/NewsFeedView.tsx | news |
| SCR-015 | #simulation | src/modules/simulation/components/SimulationView.tsx | simulation |
| SCR-016 | #academy | src/modules/education/components/AcademyView.tsx | education |
| SCR-017 | #bagholder-rescue | src/modules/portfolio/components/BagHolderRescuePanel.tsx | portfolio |
| SCR-018 | #advanced-portfolio | src/modules/portfolio/components/AdvancedPortfolioView.tsx | portfolio |
| SCR-019 | #seasonality | src/components/seasonality/SeasonalityDashboard.tsx | seasonality |
| SCR-020 | #liquidity-radar | src/components/shared/LiquidityRadarView.tsx | shared |
| SCR-021 | #market-depth | (موزّع: InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel) | market-analysis |
| SCR-022 | #alerts-center | src/components/alerts/AlertsCenterView.tsx | alerts |
| SCR-023 | #live-monitor | src/modules/dashboard/components/LiveMonitor.tsx | dashboard |
| SCR-024 | #wealth | src/modules/finance/FinanceView.tsx (إن وجد) | finance |
| SCR-025 | #trading-memory | src/components/memory/TradingMemoryView.tsx | memory |
| SCR-026 | #publishing | src/components/publishing/UserPublishingView.tsx | publishing |

### شاشات Crypto المستقلة (3)
| المعرف | Hash | الملف |
|---|---|---|
| SCR-CR-001 | #crypto-portfolio | src/modules/crypto/components/CryptoPortfolioView.tsx |
| SCR-CR-002 | #crypto-watchlist | src/components/watchlist/EnhancedWatchlistView.tsx (مع CRYPTO) |
| SCR-CR-003 | #crypto-prediction-tracking | src/modules/crypto/components/CryptoPredictionTrackingView.tsx |

### شاشات Islamic (3)
| المعرف | Hash | الملف |
|---|---|---|
| SCR-IS-001 | #zakat | src/components/zakat/ZakatView.tsx |
| SCR-IS-002 | #tithes | src/components/tithes/TithesView.tsx |
| SCR-IS-003 | #sharia | src/modules/sharia/components/ShariaView.tsx |

### شاشات Account/Subscription (5)
| المعرف | Hash/Path | الملف |
|---|---|---|
| SCR-AC-001 | #auth | src/components/auth/AuthView.tsx |
| SCR-AC-002 | #subscription | src/components/subscription/SubscriptionView.tsx |
| SCR-AC-003 | #settings | src/components/settings/SettingsView.tsx |
| SCR-AC-004 | #about | src/components/about/AboutView.tsx |
| SCR-AC-005 | /rescue | src/app/rescue/page.tsx (lazy BagHolderRescuePanel) |

### صفحات قانونية ومساعدة (5)
| المعرف | Path | الملف |
|---|---|---|
| SCR-LG-001 | /legal/terms | src/app/legal/terms/page.tsx |
| SCR-LG-002 | /legal/disclaimer | src/app/legal/disclaimer/page.tsx |
| SCR-LG-003 | /legal/privacy | src/app/legal/privacy/page.tsx |
| SCR-PG-001 | /payment/success | src/app/payment/success/page.tsx |
| SCR-PG-002 | /backtest | src/app/backtest/page.tsx |

### شاشات الإدارة (4)
| المعرف | Path | الملف |
|---|---|---|
| SCR-AD-001 | #admin | src/modules/admin/components/AdminView.tsx |
| SCR-AD-002 | /admin/honest-predictions | src/app/admin/honest-predictions/page.tsx |
| SCR-AD-003 | /admin/educational-cards | src/app/admin/educational-cards/page.tsx |
| SCR-AD-004 | /admin/reports | src/app/admin/reports/page.tsx |

### Overlays (5)
| المعرف | الملف |
|---|---|
| SCR-OV-001 | src/components/auth/LoginPromptModal.tsx |
| SCR-OV-002 | src/modules/subscription/components/TrialCountdownBanner.tsx |
| SCR-OV-003 | src/modules/subscription/components/TrialExpiredModal.tsx |
| SCR-OV-004 | src/components/auth/SessionExpiredModal.tsx |
| SCR-OV-005 | src/modules/subscription/components/InstapayModal.tsx |

### البنية التحتية (8)
| المعرف | الملف |
|---|---|
| SCR-IN-001 | src/app/layout.tsx |
| SCR-IN-002 | src/app/globals.css |
| SCR-IN-003 | src/app/error.tsx |
| SCR-IN-004 | src/app/global-error.tsx |
| SCR-IN-005 | src/app/not-found.tsx |
| SCR-IN-006 | src/app/loading.tsx |
| SCR-IN-007 | src/app/robots.ts |
| SCR-IN-008 | src/app/sitemap.ts |

## 2. الحالات الموحّدة لكل شاشة

كل شاشة يجب أن تطبّق الحالات التالية (وفقًا لـ DESIGN_SYSTEM_BRIEF):

| الحالة | المكون | الشرط |
|---|---|---|
| تحميل | LazyTabLoader / Skeleton | أثناء fetch البيانات |
| فراغ | EmptyState (icon + title + CTA) | data.length === 0 |
| فشل | SafeWidget fallback (Card + AlertTriangle + "خطأ في تحميل {name}") | API error |
| NULL | "— بيانات غير متاحة" | value === null/undefined (Rule 27) |
| محفظة فارغة | CTA "أضف أول مركز" | portfolio.length === 0 |

## 3. القواعد الإلزامية لكل شاشة

| القاعدة | التطبيق |
|---|---|
| Rule 4 | لا شاشات/ملفات/أنظمة جديدة دون موافقة المالك |
| Rule 20 | Node = proxy فقط، لا logic مالي |
| Rule 27 | NULL = "— بيانات غير متاحة" |
| Rule 30 | أسلوب احترافي وقور (لا hype، لا إيموجي زائد) |
| Rule 50 | كل أرقام محفظة/ثروة/تنبيهات حقيقية من DB |
| Rule 52 | UnifiedTable + UnifiedPublishButton إلزامية |
| Rule 73 | مصدر عرض واحد للقرار (/api/stocks/[ticker]/unified) |
| Rule 78 | TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE |
| Rule 80 | لا "سيولة داخلة" لو buy_pct<45% أو net_flow<0 |
| Rule 30 (ممارسة) | لا blue/indigo (emerald/teal/amber/red/slate فقط) |

## 4. التبعيات المشتركة لكل شاشة

```typescript
// كل شاشة تحتاج:
import { useAppStore } from '@/lib/store';              // Zustand state
import { useSession } from 'next-auth/react';            // Auth state
import { useTranslation } from '@/lib/i18n';             // i18n
import { useTheme } from 'next-themes';                  // Dark mode
import { useToast } from '@/hooks/use-toast';            // Toast notifications
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
```

## 5. نمط تنفيذ View نموذجي

```tsx
'use client';

import dynamic from 'next/dynamic';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';

const MyView = dynamic(() => import('./MyView'), {
  loading: () => <LazyTabLoader label="اسم الشاشة" />,
  ssr: false,
});

export default withErrorBoundary(MyView, { name: 'MyView' });
```

## 6. نمط تنفيذ API endpoint نموذجي

```typescript
// app/api/stocks/[ticker]/unified/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { requireAuthAsync } from '@/lib/auth-helper';

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  try {
    const user = await requireAuthAsync();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // RULE20-PURE-PROXY — Node = proxy فقط
    const data = await pythonFetch(`/api/stocks/${params.ticker}/unified`);

    // Rule 27: NULL = null (NOT 0, NOT 50, NOT placeholder)
    return NextResponse.json(data);
  } catch (error) {
    // Honest error per Rule 27
    return NextResponse.json(
      { error: 'Failed to load stock data', details: null },
      { status: 502 }
    );
  }
}
```

## 7. معايير القبول العامة (لكل شاشة)

- [ ] الملف في المسار الصحيح (انظر خريطة المعرف → الملف).
- [ ] `'use client'` إن كان view تفاعلي.
- [ ] `export const dynamic = 'force-dynamic'` إن كان يحتاج بيانات لحظية.
- [ ] معالجة loading + empty + error states.
- [ ] Rule 27: NULL → "— بيانات غير متاحة".
- [ ] Rule 50: كل أرقام مالية من DB حقيقية.
- [ ] Rule 52: UnifiedTable + UnifiedPublishButton.
- [ ] Rule 73: مصدر عرض واحد للقرار.
- [ ] Rule 78: TradePlanCard guards.
- [ ] لا blue/indigo (Rule 30 ممارسة).
- [ ] RTL + logical properties.
- [ ] Mobile-first responsive.
- [ ] SafeWidget لكل widget.
- [ ] withErrorBoundary لكل view ثقيل.
- [ ] Sticky footer.
- [ ] Touch target ≥ 44×44px.

## 8. الأولويات (للتنفيذ المرحلي)

### Phase 1 (P0 — أساسي):
SCR-001, SCR-002, SCR-003, SCR-005, SCR-006, SCR-007, SCR-AC-001, SCR-AC-002, SCR-LG-002, SCR-PG-001 + كل الـ Overlays + البنية التحتية.

### Phase 2 (P1 — عالي):
SCR-008, SCR-010, SCR-017/AC-005, SCR-020, SCR-022, SCR-014, SCR-003 (filters), SCR-004, SCR-AD-001, SCR-AD-002.

### Phase 3 (P2 — متوسط):
SCR-009, SCR-011, SCR-012, SCR-013, SCR-015, SCR-016, SCR-018, SCR-021, SCR-023, SCR-024, SCR-AC-003, SCR-LG-001, SCR-LG-003, SCR-PG-002, SCR-AD-003, SCR-AD-004, SCR-CR-001/002/003, SCR-IS-003.

### Phase 4 (P3 — منخفض):
SCR-019, SCR-025, SCR-026, SCR-IS-001, SCR-IS-002, SCR-AC-004.

## 9. الاختبار

لكل شاشة، اختبر:
- [ ] Loading state يظهر.
- [ ] Empty state يظهر عند data.length === 0.
- [ ] Error state يظهر عند API failure.
- [ ] NULL → "— بيانات غير متاحة".
- [ ] Rule 78 guards تعمل (اختبر بإشارات BUY/SELL/HOLD).
- [ ] RTL صحيح.
- [ ] Responsive على 3 أحجام (mobile/tablet/desktop).
- [ ] Sticky footer محترَم.
- [ ] Admin gate على /admin/*.
- [ ] LoginPromptModal يظهر للزائر على PROTECTED_VIEWS.

## 10. ملاحظات مهمة

- **لا تنشئ ملفات جديدة** دون موافقة المالك (Rule 4 + Rule 63.2).
- **لا git push --force** (Rule 81).
- **مراجعة شغل الفريق السابق** قبل البدء (Rule 76): اقرأ آخر 200-300 سطر من worklog + آخر 3-5 commits.
- **VERIFY-BEFORE-DELETE** (Rule 16): قبل حذف أي ملف، تحقّق من الاستدعاءات + سجّل blueprint + سجل أداء.
- **VERIFIABLE-PROOF-MANDATE** (Rule 82): لا تقرير إصلاح بدون دليل رقمي.
```

---

## 7) الملحق FX — التحسينات + المستبعدة + Flutter + المخالفات

### FX-1 — الشاشات المقترحة (لا تنفيذ — تحتاج قرار المالك)

| المعرف | الاسم | المشكلة | التوصية |
|---|---|---|---|
| SCR-DM-001 | صفحة `/login` مستقلة | AuthView حالياً داخل `#auth` لا يُفهرسها SEO | موثّقة هنا — لا تنفيذ دون موافقة المالك (Rule 4) |
| SCR-DM-002 | صفحة `/stocks/[ticker]` مستقلة | `#stock-detail` لا SEO لكل سهم | موثّقة هنا — sitemap.ts يولد روابط لكنها لا تعمل (FX-3) |
| SCR-DM-003 | صفحة `/checkout` مستقلة | داخل `#subscription` + InstapayModal | موثّقة هنا |

---

### FX-2 — الشاشات المستبعدة (DEAD — خارج النطاق)

| المعرف | الاسم | سبب الاستبعاد | الإثبات |
|---|---|---|---|
| ~~SCR-X01~~ | `#maestro` | DELETE-MAESTRO 2026-10-12 — 556KB dead code أرشيف | `archive/` |
| ~~SCR-X02~~ | `#learning` | Archived Wave 3 → موحد في `#academy` | `archive/wave-2-cleanup-2026-10-01/` |
| ~~SCR-X03~~ | `#community` | Sidebar removed + orphan (581 LOC) | `archive/dead-components-20261012/` |
| ~~SCR-X04~~ | `#prediction-performance` | Admin-only placeholder | 02-SCREENS §1 |
| ~~SCR-X05~~ | `#prediction-credibility` | Admin-only placeholder | 02-SCREENS §1 |
| ~~SCR-X06~~ | `#trading-journal` (مستقل) | DEAD — موزّع على admin/recommendations/specialist-analysis | `archive/dead-components-20261012/` |
| ~~SCR-X07~~ | `#unified-analysis` | DEAD | `archive/dead-components-20261012/` |
| ~~SCR-X08~~ | `StoredAnalysisView` | DEAD | `archive/dead-components-20261012/` |

**إجمالي dead code مؤرشف**: ~9,849 LOC (4,408 LOC orphan + 5,441 LOC wave-2).

---

### FX-3 — المخالفات التقنية والبصرية المكتشفة (لا إصلاح — موثّقة فقط)

| المخالفة | الموقع | التفاصيل | التوصية (لا تنفيذ) |
|---|---|---|---|
| **Indigo في global-error** | `src/app/global-error.tsx` سطر ~151 | يستعمل `#6366f1` (indigo-500) للزر — مخالفة Rule 30 (ممارسة) | استبدل بـ emerald-600 (#10B981) |
| **Purple في /legal/terms** | `src/app/legal/terms/page.tsx` | `from-purple-600 to-purple-800` gradient — مخالفة محتملة لروح "no blue/indigo" | استبدل بـ `from-emerald-600` |
| **sitemap ↔ hash routing mismatch** | `src/app/sitemap.ts` | يولد روابط `?view=radar` و`?view=predictions` لكن `page.tsx` يقرأ `window.location.hash` فقط — الروابط لن تفتح الـ view الصحيح | غيّر إلى `#view` |
| **Header toggleSidebar dead code** | `src/components/layout/Header.tsx` | يستدعي `toggleSidebar()` لكن لا يوجد Sidebar مُмонتد | إزالة الاستدعاء |
| **DisplayCurrencyToggle function مكررة** | `src/components/layout/Header.tsx` سطور 162-205 | function معرّفة لكن غير مستخدمة (النسخة inline المباشرة هي المستخدمة) | إزالة الـ dead function |
| **ShareButton مكرر** | `src/components/share/ShareButton.tsx` + `src/modules/publishing/components/ShareButton.tsx` | نفس الوظيفة في مكانين | توحيد في modules/publishing |
| **MaestroWidget import قد يبقى** | `src/modules/dashboard/index.ts` | Rule 73 معطّل لكن قد يبقى الـ import مشطوب | تأكيد إزالة الـ import |
| **PersonaSelector معطّل لكن قد يبقى** | `src/components/persona/` + استدعاء في Header | UNIFIED-BALANCED-ONLY | تأكيد إزالة الاستدعاء |
| **StoredAnalysisView + LearningView مؤرشفان** | `src/app/page.tsx` سطور 77-82, 135-141 | تعليقات بدل الكود | إزالة التعليقات |
| **Watchlist Prisma model غير مستخدم** | `prisma/auth-schema.prisma` | `/api/watchlist` يقرأ من `stocks.db.user_stock_watchlists` (جدول مختلف) — الـ Prisma model dead code | توثيق كـ dead schema |
| **price_history.db في SHARED_DB_NAMES** | `src/lib/shared-db.ts` | مذكور لكن مدمج في `data_engine.db.egksco_price_history` (كود قديم) | تحديث القائمة |
| **UserPoints model غير معرّف** | `/api/points`, `/api/points/leaderboard`, `/api/user-posts` (subset) | يستخدم `db.userPoints.findUnique` لكن النموذج غير معرّف → runtime error | إضافة model لـ auth-schema أو إزالة routes |
| **تعليق /api/python/[...path] قديم** | `src/app/api/python/[...path]/route.ts` سطور 35-42 | يقول "SQLite fallback via handleV4Stats()" لكن فعليًا RULE20-PURE-PROXY (لا fallback) | تحديث التعليق |
| **CHANGELOG لا يحدّث لـ Phase 2** | `CHANGELOG.md` | آخر إدخال 2026-10-12، لكن Phase 2 (2026-10-13/14) موثّق فقط في `05-PHASE2_SNAPSHOT` + worklog — مخالفة Rule 70 | تحديث CHANGELOG |

---

### FX-4 — شاشات تستخدم `<Table>` يدوي (تحتاج ترحيل لـ UnifiedTable — Rule 54)

وفقًا لـ `02-SCREENS_AND_COMPONENTS.md` §5.3 و Rule 54، **21 شاشة لسه تستخدم `<Table>` يدوي** وتحتاج ترحيل لـ `UnifiedTable`. القائمة الكاملة موثّقة في `02-SCREENS_AND_COMPONENTS.md`. المرجع الموحّد: `SectorTrackingTab.tsx`.

---

### FX-5 — ملاحظة Flutter (مستقلة عن نطاق هذه المهمة)

تطبيق Flutter منفصل في repo آخر (https://github.com/enmohsen20111975/flutter_investment_App) يستهلك نفس API الـ backend. يؤثّر على تجربة المستخدم المشتركة في نقطتين:

1. **الهوية البصرية**: Flutter ما زال يستخدم Indigo (`#6366F1`) بينما website الآن emerald (`#10B981`) — flag موثّق في `04-CURRENT_STATE.md §17.4 item 9`. يحتاج migration: `AppColors.primary` من `0xFF6366F1` → `0xFF10B981` + `primaryDark` → `0xFF059669` + `primaryLight` → `0xFF34D399`.

2. **توافق API**: Flutter يستهلك `/api/mobile/*` endpoints (subset منفصل عن الـ web routes). لا تعارض مباشر لكن يحتاج توحيد الـ API contracts مستقبليًا.

**هذه المهمة لا تشمل مواصفات شاشات Flutter** — تخص واجهات الويب فقط (وفقًا لتوجيه المالك Q8).

---

### FX-6 — تعارضات توثيقية مكتشفة (موثّقة — لا إصلاح)

| التعارض | المصدر 1 | المصدر 2 | الحقيقة |
|---|---|---|---|
| عدد القواعد الدستورية | `04-CURRENT_STATE.md` line 115: "62 قاعدة" | `00-CONSTITUTION.md`: 76 قاعدة + `MASTER_STRATEGIC_PLAN.md`: +6 = 82 | الفعلي: 82 |
| عدد الوحدات frontend | `04-CURRENT_STATE.md` line 153: "15 module" | `02-SCREENS` line 96 + Rule 60: 17 module | الفعلي: 17 (بعد الفحص) |
| عدد crypto sub-views | `02-SCREENS §5.3`: "8" | `02-SCREENS §2.4`: "4 live بعد ORPHAN-GARAGE-COLLECTOR" | الفعلي: 3 مستقلة + 8 مُدمجة |
| عدد أسطر worklog | `README.md` الجذر: "78,000+ سطر" | الفعلي (قبل تعديلاتي): ~70,738 | الفعلي: ~70,950 |
| أسماء ملفات التوثيق | البرومبت المطلوب: `01-PROJECT_ANATOMY.md`, `SYSTEM_HOW_IT_THINKS.md`, `05-CURRENT_STATE.md`, `AGENTS.md` | الموجود فعليًا: `01-ARCHITECTURE_AND_API.md`, `03-HOW_IT_THINKS.md`, `04-CURRENT_STATE.md`, `SESSION_HANDOFF_JIMMY.md` + `ENGINEER_SOUL_AND_PLAYBOOK.md` | الموجود فعليًا هو الصحيح |
| أرشيف active_databases | البرومبت المطلوب: `data/active_databases_20260817_full.zip` | الموجود فعليًا: `data/db_snapshot_2026-10-10/` (18 جزء zip ~340MB) | الموجود فعليًا |

---

### FX-7 — إفصاح عن التعديلات السابقة (مطلوب من المالك)

في المهام السابقة لهذه المحادثة، قمت بإلحاق الأقسام التالية في `/home/z/my-project/worklog.md` (داخل المستودع):

| القسم | Task ID | الوصف |
|---|---|---|
| CEO-0 | تقييم طلب نقل المستودع | تقييم أولي قبل النقل |
| CEO-1 | تنفيذ الخيار B — نقل GLMinvestment كاملًا | سجل التنفيذ |
| CEO-2 | المهمة التحليلية الكبرى — المرحلة 1 | فحص + جرد |
| P1-a | جرد تفصيلي لـ src/app/ | تقرير وكيل Explore |
| P1-b | جرد تفصيلي لـ src/modules/ و src/components/ | تقرير وكيل Explore |
| P1-c | جرد مصادر البيانات والـ API و Prisma schemas | تقرير وكيل Explore |
| P1-d | مراجعة التوثيق الإلزامي | تقرير وكيل Explore |

**ملاحظة**: هذه الإلحاقات كانت بناءً على التعليمات الأصلية للوكلاء (طلب صريح بإلحاق سجلاتهم في worklog.md). **بعد توجيهك الجديد بعدم الكتابة في المستودع دون إذن صريح، توقفت عن أي كتابة**. هذا الملف (`UX_SCREEN_DESIGN_PACKAGE.md`) هو الاستثناء الوحيد المصرّح به صراحةً من المالك في الطلب الحالي.

**لم أحاول التراجع عن أي تعديل سابق** (وفقًا لتوجيهك: "لا تحاول التراجع عنه أو إصلاحه تلقائيًا").

---

## خاتمة

تم تجميع كل المراحل (A + B + C + D + E + الملحق FX) في ملف واحد شامل قابل للاستخدام المباشر. الملف جاهز للرفع على GitHub.

**المراحل المغطّاة**:
- ✅ المرحلة A: تثبيت نطاق التصميم (59 شاشة + سجل المستبعدة)
- ✅ المرحلة B: بناء تجربة المستخدم (خريطة + 5 رحلات + حالات استثنائية)
- ✅ المرحلة C: المواصفات التفصيلية لكل شاشة (P0/P1/P2/P3 + Overlays + بنية تحتية)
- ✅ المرحلة D: نظام تصميم موحد (ألوان + خطوط + مكونات + RTL + تجاوب)
- ✅ المرحلة E: حزمة Stitch الـ 8 ملفات (Brief + System + Inventory + Flows + Specs + Prompts + Checklist + Handoff)
- ✅ الملحق FX: شاشات مقترحة + مستبعدة + Flutter + مخالفات + تعارضات + إفصاح

**معيار النجاح**: حزمة جاهزة للنسخ إلى Google Stitch + تسليم لفريق البرمجة + مراجعة QA.

— **سوسو**، الرئيس التنفيذي التقني
