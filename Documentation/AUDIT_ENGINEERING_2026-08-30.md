# 🏗️ تقرير الـ Audit الهندسي الشامل — 30 أغسطس 2026

> **الموقع:** `Documentation/AUDIT_ENGINEERING_2026-08-30.md`
> **الفريق:** Senior Full-Stack Engineer + Backend Engineer + Frontend Engineer + UX Designer
> **المنهجية:** 4 audit بالتوازي بمنظور مختلف لكل واحد
> **الهدف:** ترتيب المشروع كـ **نظام واحد متكامل** (مش موديولات منفصلة)

---

## 📊 الملخص التنفيذي

المشروع بني على معمارية رباعية سليمة (Next.js + Python + Data Engine + WS) مع قاعدة دستورية واضحة (35 قاعدة). فيه **نظام سليم متكامل** (V40.2 + daily_closer + screener + TelegramNotifier) مكتوب بـ ~3,000 LOC Python + Node proxy نظيف.

**لكن** فيه **نظام موازي كامل** اتبنى حديثاً (tomorrow_*) بـ ~1,400 LOC إضافي + **6,000 LOC** من Node logic مخالف لـ Rule 20 + **31 مشكلة UX** تخدش شخصية المشروع.

| النوع | العدد | الخطورة |
|------|------|---------|
| 🔴 P0 (حرج) | 16 | فورية |
| 🟠 P1 (مهم) | 22 | هيكلية |
| 🟡 P2 (تحسين) | 14 | جودة |
| **الإجمالي** | **52** | — |

---

## 🚨 القسم 1: الأنظمة الموازية (أكبر مشكلة)

### النظام الموازي لتوقعات الغد (بـ ~1,400 LOC)

| # | المكوّن | المكوّن الموازي (مخالف) | المكوّن الموجود (canonical) | القواعد المخالفة |
|---|---|---|---|---|
| **A** | مولّد التوقعات | `tomorrow_predictions_generator.py` (896 LOC) | `v40_2_daily_generator.py` (1466 LOC) | Rule 4, 21, 28, 29 |
| **B** | جدول التوقعات | `tomorrow_predictions` table (3 صفوف) | `predictions` table | Rule 28, 29 |
| **C** | حالة الأسهم النشطة | `tomorrow_active_status` table (0 صفوف) | `predictions WHERE outcome_date IS NULL` | Rule 28, 29 |
| **D** | أسهم تحت المراقبة | `tomorrow_watchlist` table (15 صف) | `stocks` table + `advanced_screener_routes.py` | Rule 28, 29 |
| **E** | تتبع التوقعات (4→3) | `/api/predictions/honest-tracking/*` (Node direct SQLite) | `/api/stored-analysis/live-tracking` (Python proxy) | Rule 20, 28 |
| **F** | إرسال تليجرام | `/api/tomorrow-predictions/send-telegram` (Node يبني الرسالة) | `TelegramNotifier.notify_daily_report()` (Python L79) | Rule 20, 28 |

### أنظمة تتبع متوازية (Rule 28 §1):
```
/api/predictions/tracking/*         (Python proxy ✅)
/api/predictions/honest-tracking/*  (Node direct SQLite ❌ — 6 endpoints, 2099 LOC)
/api/stored-analysis/live-tracking  (Python proxy ✅ — canonical)
/api/tomorrow-predictions           (Node direct SQLite ❌ — جديد)
```

---

## ⚠️ القسم 2: الانكسارات الهندسية

### مخالفة Rule 20 (Python = العقل، Node = العرض)
**13+ Node route فيها logic حقيقي** (~4,516 LOC):
- `/api/tomorrow-predictions/route.ts` (214 LOC) — SQLite مباشرة + stats
- `/api/tomorrow-predictions/send-telegram/route.ts` (229 LOC) — بناء رسالة Telegram في Node
- `/api/predictions/honest-tracking/*` (6 endpoints, 2099 LOC) — SQLite + aggregations
- `/api/maestro/logic-panel/route.ts` (574 LOC) — SQLite + توزيع إشارات
- `/api/predictions/credibility/route.ts` (489 LOC) — SQLite + dedup
- `/api/predictions/expert-consensus/route.ts` (449 LOC) — SQLite مزدوج
- `/api/predictions/price-verify/route.ts` (373 LOC) — SQLite writable + UPDATE
- `/api/predictions/live/route.ts` (197 LOC) — SQLite + aggregations

### مخالفة Rule 21 (V40.2 = مصدر التوقعات الوحيد)
`tomorrow_predictions_generator.py` بيستخدم:
1. `MaestroOrchestrator.analyze()` (مسار persona، أقل صرامة)
2. `simple_analysis()` fallback (RSI-only، بدون kill filters ولا evidence)
3. **مفيش** `institutional_decision_engine.build_institutional_decision()`
4. **مفيش** `liquidity_filter.set_strict_kill_filters(True)`
5. **مفيش** ATR clamp [3%, 9%]

---

## 🎨 القسم 3: مشاكل شخصية المشروع

### عبارات تحميسية + إيموجي زينة (Rule 30/31)
**25+ انتهاك صريح** في user-facing UI:

| الموقع | المخالفة |
|---|---|
| `AuthGate.tsx:108` | `🚀 سجل مجاناً للوصول لكل المميزات` |
| `AboutView.tsx:155` | `🚀 ورا كل شمعة على الشارت..` + عامية مصرية |
| `LearningView.tsx:271` | `+10 XP 🎉` |
| `MarketAnalysisView.tsx:4272` | `شاركها الآن على تليجرام / فيسبوك! 🚀` |
| `PredictionTrackingDashboard.tsx:4-8` | `LUXURY EDITION` / `ملوكية فائقة الفخامة` |
| `MaestroCommandCenter.tsx` | `🧠 محركات التوقع الأربعة` / `⚡ مراحل التحليل الست` |
| `StockScreener.tsx:87` | `🚀 اختراق` |
| `BottomPanel.tsx:310` | `🚀 استراتيجيات الصيد بنقرة واحدة` |

### مصطلحات تقنية مكشوفة للعميل (Rule 32)
- **"نظام المايسترو"** + `6 Phases` badge + "regime confidence" (MaestroWidget على الـ dashboard)
- **"نظام الـ 8 طبقات"** (MarketAnalysisView.tsx:534, 557, 600)
- **"V39 · Full Dynamic Adaptive"** (InstitutionalDecisionPanel.tsx:330)
- **"V20 Ultimate Fusion"** (SingleStockAnalysisView.tsx:1263)
- **"V40"** (PredictionTrackingDashboard.tsx:1476)
- **AboutView كاملاً**: عناوين فرعية إنجليزية تقنية + Veto/Boost/T+2/MACD/RSI/V20 + عامية مصرية + indigo/blue

### ألوان indigo/blue ممنوعة (في 10+ ملف)
- `ZakatView.tsx` (استخدام مكثف)
- `AboutView.tsx` (indigo في Core Engine node)
- `MaestroCommandCenter.tsx`
- `RealtimeTicker.tsx`
- `SmartConfluenceView.tsx`
- `SubscriptionView.tsx`
- `app/legal/privacy/page.tsx`
- + 4 ملفات تانية

---

## 🔧 القسم 4: مشاكل Frontend + UX

### تكرار في الـ components (Rule 28)
- **`StatCard`** مكررة في 10 نسخ
- **`formatPrice`/`formatNumber`/`formatPct`** مكررة في 20+ نسخة
- **`stocksMap` useMemo** مكررة في 3 نسخ في MarketAnalysisView
- **`fetchData` useCallback** مكررة في 5 نسخ
- **`VIEW_TO_NAV_MAP`** معرفة مرتين في Sidebar.tsx

### bugs حقيقية
1. **`StockScreenerAdvanced.tsx` duplicate `teal` key** (line 827 vs 835) — JS silent override
2. **`page.tsx` duplicate `VALID_VIEWS`** — 5 routes موجودة في array واحد بس مش في Set التاني = deep-linking مكسور
3. **`CryptoPortfolioView` محفظة في localStorage** بدل backend = مش متزامنة بين الأجهزة
4. **`PredictionPerformanceView` limit=5000** بدون virtualization = خطر OOM
5. **4 dynamic imports مش مستخدمة** في `page.tsx` (lines 103, 104, 153, 161) = ~200KB زايد

### مشاكل Sidebar (31 عنصر nav)
- **تكرار فعلي**: "متابعة التوقعات" + "إدارة التوقعات" + "تتبع التوقعات" (كريبتو)
- **تكرار فعلي**: "مركز التعلم" + "أكاديمية M2y"
- **تكرار فعلي**: "المحاكاة" + "محاكاة الكريبتو"
- **تكرار فعلي**: "فلاتر الأسهم" + "فلاتر الكريبتو"
- قسم "العملات الرقمية" بيتعرض مع قسم "السوق الحالي" في نفس الوقت (مفروض تبديل عبر ExchangeSelector)

### مشاكل السرعة
- **6 polling mechanisms** شغالة في نفس اللحظة على الـ dashboard
- **4 large lists** بدون virtualization (أخطرها limit=5000)
- **missing React.memo** على table rows في 4 ملفات كبيرة
- **5 fetchData بدون AbortController** = race conditions

### مشاكل mobile
- **زر إغلاق DisclaimerBanner** = 24px (تحت 44px المطلوب)
- **أزرار pagination** = 32px (تحت 44px)
- **tabs على الموبايل** = 5-6 أيقونات بلا نصوص = غير مفهوم

### تكرار الـ disclaimers (4 مستويات!)
1. `DisclaimerBanner` (sticky top, dismissable)
2. `LegalDisclaimerFooter` (footer ثابت)
3. `InlineDisclaimer` (جوه البطاقات)
4. `Footer.tsx` (نص رابع)

= **4 نصوص قانونية متكررة في نفس الصفحة** → ضوضاء بصرية + إضعاف الرسالة

---

## 🛠️ خطة الترتيب الهندسي

### 🔴 المرحلة 1 (P0) — حذف الأنظمة الموازية + إصلاح bugs

| # | المهمة | LOC | التأثير |
|---|---|---|---|
| P0-1 | حذف `tomorrow_predictions_generator.py` بالكامل | -896 | إزالة نظام موازي مخالف لـ Rule 21 |
| P0-2 | DROP 3 جداول من `predictions.db` (`tomorrow_*`) | -3 tables | إزالة تكرار DB |
| P0-3 | حذف `/api/tomorrow-predictions/route.ts` | -214 | إزالة Node direct SQLite |
| P0-4 | حذف `/api/tomorrow-predictions/send-telegram/route.ts` | -229 | إزالة logic من Node |
| P0-5 | حذف `/api/tomorrow-predictions/generate/route.ts` | -103 | إزالة spawn سكربت محذوف |
| P0-6 | حذف `vps-service/telegram/send_message.py` | -84 | إزالة relay مكرر |
| P0-7 | إعادة توصيل `LiveTrackingTab` → `/api/stored-analysis/live-tracking` | re-wire | تكامل مع canonical |
| P0-8 | إعادة توصيل `TomorrowPredictionsPanel` → `/api/unified/predictions` | re-wire | تكامل مع canonical |
| P0-9 | إصلاح `duplicate teal key` في StockScreenerAdvanced | bug fix | إزالة JS silent override |
| P0-10 | توحيد `VALID_VIEWS` في ملف واحد | bug fix | إصلاح deep-linking |
| P0-11 | حذف 4 dynamic imports مش مستخدمة في page.tsx | -200KB | تقليل bundle |
| P0-12 | إصلاح `CryptoPortfolioView` → backend بدل localStorage | architecture | مزامنة بين الأجهزة |
| P0-13 | تقليل `PredictionPerformanceView` limit=5000 → 100 + pagination | performance | منع OOM |

**صافي المرحلة 1:** -1,526 LOC + إصلاح 4 bugs

### 🟠 المرحلة 2 (P1) — نقل logic من Node لـ Python + إصلاح شخصية المشروع

| # | المهمة | التفاصيل |
|---|---|---|
| P1-1 | نقل `/api/predictions/honest-tracking/*` لـ Python | 6 endpoints (2099 LOC) → Python blueprints + Node pure proxies |
| P1-2 | إضافة Python endpoint `/api/telegram/send-daily-report` | يستخدم `TelegramNotifier.notify_daily_report()` الموجود |
| P1-3 | Node proxy للـ endpoint الجديد | 5 LOC proxy بدل 229 LOC logic |
| P1-4 | توحيد 3 أنظمة تتبع على `/api/stored-analysis/live-tracking` | حسب Rule 28 §1 |
| P1-5 | إعادة كتابة `AboutView.tsx` | إزالة إيموجي + عامية + مصطلحات تقنية + indigo |
| P1-6 | إزالة `🚀` + `🎉` من 10+ ملف | استبدال بنصوص احترافية |
| P1-7 | إزالة مصطلحات تقنية من UI | "نظام المايسترو" → "حالة السوق"، "V20/V39/V40" → تشال |
| P1-8 | استبدال indigo/blue بـ emerald/teal/amber في 10+ ملف | امتثال لقاعدة الألوان |
| P1-9 | توحيد `StatCard` في مكون واحد | استبدال 10 نسخ |
| P1-10 | توحيد `formatPrice`/`formatNumber`/`formatPct` في `src/lib/format.ts` | استبدال 20+ نسخة |
| P1-11 | نقل `adaptStock`/`adaptCryptoToStock` من store لـ `src/lib/adapters/` | فصل الـ adapters |
| P1-12 | نقل RSI/MA calculation من `CryptoAdvancedAnalysisView` لـ Python | Rule 20 |
| P1-13 | دمج قسم "العملات الرقمية" في Sidebar مع تبديل عبر ExchangeSelector | إزالة التكرار |
| P1-14 | توحيد آلية التنبيهات (إزالة `RoboNotifierToggle` العائم) | دمج في NotificationCenter |
| P1-15 | تقليل polling (دمج 6 mechanisms في واحد) | useVisibilityAwarePolling موحد |
| P1-16 | تكبير touch targets (h-6/h-8 → h-9) | 4 ملفات |
| P1-17 | إصلاح tabs على الموبايل (scrollable بدل grid) | MarketAnalysisView |
| P1-18 | جعل التبويب الافتراضي لـ `#recommendations` = `balanced` (التوقعات) | بدل `tracking` |
| P1-19 | إضافة `React.memo` على table rows في 4 ملفات كبيرة | performance |
| P1-20 | إضافة `AbortController` على 5 fetchData في MarketAnalysisView | منع race conditions |
| P1-21 | نقل `presets` array في StockScreenerAdvanced لـ `db/screener_lists.json` | configuration |
| P1-22 | إزالة `useEffect(loadDashboard)` المكرر في DashboardView | bug fix |

### 🟡 المرحلة 3 (P2) — تحسينات جودة + تقسيم

| # | المهمة | التفاصيل |
|---|---|---|
| P2-1 | توحيد الـ disclaimers (4 → 1) | حذف DisclaimerBanner العلوي + الاكتفاء بـ Footer |
| P2-2 | تقسيم `MarketAnalysisView.tsx` (7700 LOC) لـ `analysis/tabs/` folder | كل tab ملف منفصل |
| P2-3 | توحيد ألوان accent للأقسام (4 → 3) | emerald (سوق) + teal (كريبتو) + amber (أموال) |
| P2-4 | نقل قسم "حسابات دينية" تحت "إدارة الأموال" | إزالة قسم لعنصرين فقط |
| P2-5 | تبسيط Footer (9 عناصر → 4) | إزالة روابط زايدة |
| P2-6 | إضافة skeleton لـ MaestroWidget + MarketSummary + IndexCards | منع layout shift |
| P2-7 | إضافة empty state بدل `return null` | 3 ملفات |
| P2-8 | دمج `PredictionTrackingView` + `PredictionTrackingDashboard` | إزالة تكرار |
| P2-9 | تحديث `Documentation/01-PROJECT_ANATOMY.md` | إزالة إشارات tomorrow_* + تحديث §10.1 G9 |
| P2-10 | إضافة guard ضد Node direct SQLite في CI | منع تكرار المخالفة |
| P2-11 | إزالة `console.log([V20] 🚀)` من InteractiveChart | تنظيف console العميل |
| P2-12 | نقل display currency + FX rates لـ `/api/currency` | بدل store state ثابت |
| P2-13 | نقل user preferences لـ `/api/user/preferences` | بدل localStorage |
| P2-14 | إزالة `LIVE · {liveCountdown}s` badge | أسلوب تحميسي |

---

## 📊 الأثر المتوقع

| المقياس | قبل | بعد | التغيير |
|---|---|---|---|
| إجمالي LOC | ~85,000 | ~82,000 | **-3,000 LOC** |
| Node routes فيها logic | 13+ | 0 | **-4,516 LOC** |
| جداول DB مكررة | 3 | 0 | **-3 tables** |
| أنظمة تتبع متوازية | 4 | 1 | **توحيد** |
| عبارات تحميسية | 25+ | 0 | **امتثال Rule 31** |
| ألوان indigo/blue | 10+ ملفات | 0 | **امتثال قاعدة الألوان** |
| disclaimers متكررة | 4 | 1 | **توحيد** |
| Sidebar items | 31 | ~20 | **-35%** |
| polling mechanisms | 6 | 1 | **-83%** |
| bugs حقيقية | 4 | 0 | **إصلاح كامل** |

---

## ✅ القواعد اللي اتنفذت صح (نماذج تحتذى بها)

1. **V40.2 canonical pipeline** (`v40_2_daily_generator.py` + `institutional_decision_engine.py` + `liquidity_filter.py`) — 6 proofs + R:R floor + ATR clamp + closed-loop. ده المرجع.
2. **`/api/stored-analysis/live-tracking`** — Node pure proxy + Python blueprint. نموذج للـ Rule 20.
3. **`/api/screener/advanced`** — Node pure proxy + Python blueprint. نموذج للـ Rule 20.
4. **`TelegramNotifier.notify_target_hit()`** في `daily_closer.py:2769` — Python closed-loop بيستدعي TelegramNotifier مباشرة. نموذج للترابط.
5. **`PredictionTracker.record_prediction()`** — canonical entry point لأي توقع.
6. **`ErrorBoundary` + `SafeWidget` + `LazyTabLoader`** — بنية تحميل وأخطاء احترافية.
7. **`MarketPulseWidget`** — skeleton + error state + retry button = نموذج يحتذى به.
8. **`MobileNav`** بـ 5 عناصر فقط = نموذجي للموبايل.

---

## 🎯 الخلاصة

المشروع فيه **نظام سليم متكامل** (V40.2 + daily_closer + screener + TelegramNotifier) مكتوب بـ ~3,000 LOC Python + Node proxy نظيف. فوقه اتبنى **نظام موازي كامل** (tomorrow_*) + **6,000 LOC Node logic** + **31 مشكلة UX** تخدش شخصية المشروع.

**الخطوة الأولى الواجبة:** المرحلة 1 (P0) — حذف الأنظمة الموازية + إصلاح bugs. ده وحده بيلغي 80% من الانكسارات.

**الخطوة الثانية:** المرحلة 2 (P1) — نقل logic من Node لـ Python + إصلاح شخصية المشروع.

**الخطوة الثالثة:** المرحلة 3 (P2) — تحسينات جودة + تقسيم.

---

**انتهى التقرير.**
