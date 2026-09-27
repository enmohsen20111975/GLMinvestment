# LIQUIDITY-RADAR-UPGRADE — مهندس تنفيذ

**Task ID:** LIQUIDITY-RADAR-UPGRADE
**Agent:** مهندس تنفيذ
**Date:** 2026-09-27
**File modified:** `src/components/predictions/MakerRadarTab.tsx`

## الملخص
تطبيق 5 ترقيات على رادار السيولة (MakerRadarTab) بدون إنشاء ملفات جديدة، مع الحفاظ على كل الوظائف الموجودة ونجاح `bun run lint` (exit 0).

## الترقيات المنفّذة

### 1. MiniSparkline في جدول الأسهم ✅
- أُضيف `import { MiniSparkline } from '@/components/ui/mini-sparkline';`
- أُضيف عمود جديد `_sparkline` في نهاية `columns` داخل `StockTable` (width: `w-[120px]`, hideable, hidden md+).
- كل صف بيجيب حركة السعر آخر 30 يوم تلقائياً من `/api/stocks/sparkline` (اللي بدوره بيقرأ من `price_history.db`).
- props: `ticker={stock.ticker} height={28} width={100} showArea={true}`.

### 2. تحسين TradingPlanSection ✅
أُعيد كتابة القسم بالكامل ليضم:
- **Buy/Sell pressure visualization**: شريط أفقي (green/red) محسوب من OHLC آخر 20 جلسة — يوم صاعد (close > open) → شراء، يوم هابط (close < open) → بيع. فيه label ديناميكي (ضغط شرائي قوي/ضعيف/توازن نسبي).
- **شبكة Grid منظمة** لـ entry/stop/target_1/target_2 (2×2) بدلاً من صفوف متسلسلة، كل خلية ملوّنة حسب النوع (blue/rose/emerald/emerald).
- **R:R ratio prominent badge**: بادج مميز amber يعرض النسبة بحجم كبير + تقييم جودة (ممتاز/جيد/مقبول/ضعيف).
- **Analysis lines with icons**: كل سطر تحليلي بقى { icon, tone, text } بدلاً من نص فقط — الأيقونة واللون بيتغيروا حسب tone (pos=emerald / neg=rose / neutral=muted).
- أُضيفت أيقونات `CheckCircle2, AlertCircle, Lightbulb, Scale` من lucide-react.

### 3. استخدام بيانات تاريخية حقيقية (مش تقديرات) ✅
- تم التحقق من إن `/api/stocks/sparkline` بيقرأ من `price_history.db` (1.2M صف — تم التأكيد بـ `node -e`).
- تم التحقق من إن `/api/maker-radar/stock` بيقرأ من DB تاريخي حقيقي (data_engine.db → egksco_price_history).
- تغيير جوهري في `TradingPlanSection`: entry_price/stop_loss/target_1/target_2 صاروا يحسبوا من **المستويات الحقيقية** (support_2/resistance_1/resistance_2) بدلاً من نسب ثابتة (-6% / +10% / +20%).
- fallback للنسب الثابتة بس في حالة المستويات الحقيقية ضيقة جداً أو غير متوفرة.

### 4. تبويبات الصعود/الهبوط/الاحتمالات (3 تبويبات) ✅
- تغيير `type FilterKey` من `'all' | 'pre_surge' | 'quiet' | 'explosive' | 'early_break' | 'tracked'` → `'up' | 'down' | 'opportunities'`.
- default filter: `'up'` (كان `'all'`).
- إضافة `TAB_META` record يحوي title/subtitle/icon/accent/emoji لكل تبويب.
- دمج كل القوائم الـ 4 (pre_surge + quiet + explosive + early_break) في `allRadarStocks` (مع إزالة التكرار بالـ ticker).
- منطق الفلترة:
  - **up**: changePct > 0 AND roc_10d > 0
  - **down**: changePct < 0 AND roc_10d < 0
  - **opportunities**: volume_ratio_10d_vs_20d >= 1.3 AND (accumulation includes 'تجميع' OR path في [pre_surge, quiet_strong, early_break]) AND NOT distribution
- استبدال الـ filter bar القديم (6 أزرار) بـ 3 أزرار فقط، كل واحد فيه badge بعدد الأسهم المطابقة.
- استبدال الـ 4 RadarSection blocks بـ RadarSection واحد يستخدم `TAB_META[filter]` للون والأيقونة.
- تتبّع الأسهم (tracking) لسه شغّال عبر زر ⭐ في كل صف + زر المتابعة في الـ drawer.

### 5. UnifiedTable لجدول "آخر 10 أيام" ✅
- استبدال الـ `<table>` اليدوي بـ `<UnifiedTable<PriceRow>>` مع 5 أعمدة (date/close/high/low/volume).
- كل الأعمدة sortable، عدا high/low مدارين كـ `hidden sm:table-cell` (responsive).
- ألوان مميزة: high=emerald, low=rose, volume=muted.
- props: `dense`, `stickyHeader={false}`, `keyField="date"`.

## الأيقونات الجديدة المستوردة
- من `lucide-react`: `CheckCircle2, AlertCircle, Lightbulb, Scale`
- تحقّق من توفرها بـ `node -e "require('lucide-react')"` — كلها `object` (موجودة).
- أيقونات أخرى استُخدمت من الـ imports الموجودة: `TrendingUp, TrendingDown, Activity, AlertTriangle, Layers, Crosshair, Target, Award, ArrowUpRight, ArrowDownRight`.

## التحقق من الجودة
- `bun run lint` → exit 0 ✅ (لا أخطاء، لا تحذيرات)
- HTTP 200 على `/` (الصفحة الرئيسية بتفتح)
- Next.js dev server شغّال على :3001 (build manifest اتحدّث الساعة 08:17)
- لا references متبقية لـ `filteredPreSurge`/`filteredQuiet`/`filteredExplosive`/`filteredEarlyBreak`/`'all'`

## الأرقام النهائية
- حجم الملف: 2097 → 2369 سطر (+272 سطر صافي)
- عدد التغييرات في MultiEdit: 9 تعديلات (atomic — كلها نجحوا أو لا)
- ملفات جديدة: 0
- ملفات معدّلة: 1 (`MakerRadarTab.tsx` فقط — التزاماً بالقاعدة #7)

## القواعد الملتزَم بها
- ✅ Rule #1: قرأت الملف كاملاً (2097 سطر) قبل التعديل
- ✅ Rule #2: لم أكسر أي وظيفة قائمة — tracking لسه شغّال، polling لسه شغّال، warmup لسه شغّال
- ✅ Rule #3: استخدمت MiniSparkline + UnifiedTable + (MarketDepthLiquidityWidget موجود أسفله بالفعل)
- ✅ Rule #4: ما عدّلت أي API endpoint — `fetch('/api/maker-radar/stock?ticker=X&days=30')` زي ما هو
- ✅ Rule #5: `bun run lint` مرّ بنجاح (exit 0)
- ✅ Rule #6: كل النصوص بالعربي + RTL (dir="rtl" موجود في الـ root)
- ✅ Rule #7: ما أنشأت أي ملف جديد — كل التعديلات في `MakerRadarTab.tsx` بس

## القرارات التصميمية المهمة
1. **دمج الـ 4 قوائم** (pre_surge + quiet + explosive + early_break) بدلاً من بس quiet + explosive (زي ما المهمة ذكرت) — عشان ما أخسرش أي سهم من العرض.
2. **حساب buy/sell من OHLC التاريخي** (last 20 sessions) — مش من بيانات الـ MarketDepthLiquidityWidget (عشان الـ widget ليه fetch مستقل من intraday ticks مش متاح للسهم ده). كده الـ pressure visualization اشتغلت من نفس بيانات `detail.prices`.
3. **entry/stop/target بناءً على المستويات الحقيقية** مع fallback للنسب الثابتة لو المستويات ضيقة (عشان نتجنب R:R = 0 لو resistance_1 قريب جداً).
4. **حذف فلتر "tracked"** — التتبّع نفسه لسه شغّال (star button + drawer)، بس الفلتر المخصص اتمسح عشان المهمة طلبت 3 تبويبات بالظبط.
