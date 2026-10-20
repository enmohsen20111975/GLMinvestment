# رؤية إعادة تنظيم الشاشات — SCREENS-REORG-VISION

> **Task:** SCREENS-REORG-VISION
> **Scope:** Research-only — NO code changes. Client-focused reorganization vision.
> **Reviewers:** سارة (Sarah, 28 — retail + UX designer) + عم رشاد (Uncle Rashad, 62 — retired bank VP + 30-yr trader)
> **Sources reviewed:**
> - `/home/z/my-project/SCREENS-INVENTORY-FULL.md` (304 LOC — full inventory of 28 unique screens)
> - `/home/z/my-project/src/components/layout/TopBar.tsx` (537 LOC — current 5-portal top nav)
> - `/home/z/my-project/src/components/layout/MobileNav.tsx` (86 LOC — 5-icon bottom bar)
> - `/home/z/my-project/src/components/layout/MobileMoreSheet.tsx` (242 LOC — extra mobile sheet)
> - `/home/z/my-project/src/app/page.tsx` lines 548-804 (`renderView()` switch — 55 cases → 40 components → 28 canonical screens)
> - `/home/z/my-project/src/modules/dashboard/components/DashboardView.tsx` line 295 (confirms InvestorsFlow explicitly removed)
> - `/home/z/my-project/src/modules/dashboard/components/InvestorsFlowPanel.tsx` (557 LOC — the EGX-only investor-flow widget)

---

## الباب 1: رؤية سارة (من وجهة نظر المستثمرة اليومية)

### 1.1 أنا سارة — يومي العادي على المنصة

أنا بفتح المنصة من الموبايل 80% من الوقت، ومن اللابتوب باقي الوقت. دي حاجاتي اليومية:

| الكليك | الشاشة | ليه؟ |
|---|---|---|
| 1 | `#dashboard` (MobileNav: الرئيسية) | بصّ لو السوق أحمر ولا أخضر، والـ EGX30 |
| 2 | `#stocks` (MobileNav: الأسهم) | بصّ أسعاري اللحظية وأراقب الـ flashing |
| 3 | `#recommendations` (MobileNav: التوصيات) | أبص التوصيات الجديدة من الفريق |
| 4 | `#portfolio` (MobileNav: المحفظة) | أشوف P&L بتاعتي |
| 5 | `#liquidity-radar` (MobileNav: الرادار) | أبص إيه اللي بيتدفع فيه فلوس دلوقتي |

**ده بدوره يومياً 5 كليك.** لو محتاجة حاجة تانية، بضطر أدور — وده اللي بيضايقني.

### 1.2 إيه اللي ناقصني وبدور عليه كل يوم؟

- **سيولة المستثمرين (أجانب/عرب)** — أنا كمصرية بـ trade على EGX، بحب أعرف الأجانب بيشتروا ولا ببيعوا. **أدور عليها ومش لاقيها.** آخر مرة فتكرتها كانت على الـ Dashboard — اختفت.
- **لما أبغى أحلّل سهم معين بشكل كامل** — بضغط على السهم في `#stocks`، بيفتح Drawer فيه charts ومؤشرات، **بس فين الاستشارة الكاملة المفصّلة؟** ما فيش زر واضح "تحليل كامل لهذا السهم".
- **أكاديمية المحاكاة** — لما أكون عاوزة أجرّب استراتيجية، بفتح `#simulation`. بس هي مش في الـ TopBar خالص على الديسكتوب! بضطر أفتح الموبايل أو أكتب `#simulation` في الـ URL.

### 1.3 إيه اللي اختفى وعاوزاه يرجع؟

1. ** InvestorsFlowPanel على الـ Dashboard** — كانت هناك. دلوقتي مكانها `#market-depth` بس (`page.tsx` line 656)، **والـ `#market-depth` مش في الـ TopBar ولا الـ MobileNav ولا الـ MobileMoreSheet.** يعني: لازم أعرف الـ URL عشان أوصلها.
2. **شاشة الشريعة** (`#sharia`) — على الموبايل موجودة في MobileMoreSheet (line 46)، على الديسكتوب **مش موجودة خالص في الـ TopBar** (TopBar.tsx line 106 comment صراحةً بيقول `sharia → Settings section or deep-link`).
3. **شاشة المحاكاة** (`#simulation`) — على الديسكتوب **مش في الـ TopBar** (TopBar.tsx line 105 comment بيقول `simulation → deep-link`). على الموبايل موجودة في MobileMoreSheet.
4. **التحليل الكامل لسهم** — عندي 5 شاشات مختلفة (SpecialistAnalysis / UnifiedAnalysis / SmartConfluence / V82 / TradingChart) و**ولا واحدة فيهم في الـ TopBar** (TopBar.tsx line 101 comment: `specialist-analysis → tab/drawer inside StockDetail (mandate)`).

### 1.4 اقتراح سارة للترتيب الجديد

**الـ MobileNav (5 أيقونات) — تتغير لتشمل الأكثر استخداماً يومياً:**

```
1. الرئيسية (dashboard)
2. الأسهم (stocks)
3. توصيات (recommendations)
4. محفظتي (portfolio)
5. سيولة (market-depth) ← بدلاً من liquidity-radar (الرادار ده فقط سيولة المؤسسات)
```

> **سارة:** أنا عاوزة الـ"سيولة" اللي بتجاوب على السؤال "الأجانب بيشتروا ولا ببيعوا؟" — مش بس الـ institution flows. الـ `liquidity-radar` الحالي = تدفقات المؤسسات بس. الـ `market-depth` = تدفقات الأجانب/العرب/المصريين. ده اللي محتاجاه يومياً.

**الـ TopBar (ديسكتوب) — أقترح 6 بوابات (موافقة مع طلب الأونر "التعليم والمحاكاة قائمة لوحدها"):**

```
1. الرئيسية (home) → dashboard, market-depth (سيولة المستثمرين)
2. السوق (market) → stocks, stock-filters, liquidity-radar, trading-chart
3. التحليل (analysis) → recommendations, specialist-analysis, unified-analysis, smart-confluence, seasonality, v82, dual-track, prediction-tracking, reports, backtesting
4. محفظتي (portfolio) → portfolio, watchlist, alerts-center, live-monitor, bagholder-rescue, trading-journal, trading-memory, publishing, wealth
5. التعلّم (education) ← جديد → academy, simulation [الأونر صراحةً طلب القائمة دي]
6. المزيد (more) → news, sharia (مصري), zakat, tithes, subscription, settings, about, auth
```

---

## الباب 2: رؤية عم رشاد (من وجهة نظر المحترف)

### 2.1 أنا عم رشاد — أدواتي التحليلية

أنا بفتح المنصة من الديسكتوب بشكل رئيسي. بحب أحلّل عميق. دي أدواتي اللي محتاجها كل يوم:

| الأداة | المسار | الحالة دلوقتي | المشكلة |
|---|---|---|---|
| تحليل المتخصصين العميق | `#specialist-analysis` (`SpecialistAnalysisView` 2916 LOC) | مش في TopBar، مش في MobileMoreSheet | لازم أعرف الـ URL. ومش clear هل ده نفسه "الاستشارة الكاملة" ولا لأ |
| التحليل الموحّد | `#unified-analysis` (`UnifiedAnalysisView` 562 LOC) | مش في TopBar | نفس المشكلة — 5 شاشات تحليل مختلفة ولا واحدة في القائمة |
| المساعد الذكي (confluence) | `#smart-confluence` (`SmartConfluenceView` 276 LOC) | مش في TopBar | نفس المشكلة |
| قرار V82 المؤسسي | `#v82` (`V82DecisionPanel` 294 LOC) | مش في TopBar | نفس المشكلة |
| التوقعات المزدوجة | `#dual-track` (`DualTrackPredictionsView` 633 LOC) | مش في TopBar | لازم أعرف الـ URL |
| الموسمية | `#seasonality` (`SeasonalityDashboard` 300 LOC) | مش في TopBar | لازم أعرف الـ URL |
| تقارير PDF احترافية | `#reports` (`ReportsView` 955 LOC) | مش في TopBar | لازم أعرف الـ URL |
| اختبار الاستراتيجيات | `#backtesting` (`EGXBacktestDashboard` 443 LOC) | مش في TopBar | لازم أعرف الـ URL |
| يوميات التداول | `#trading-journal` (`TradingJournalView` 586 LOC) | مش في TopBar | لازم أعرف الـ URL |
| ذاكرة التداول | `#trading-memory` (`TradingMemoryView` 326 LOC) | مش في TopBar | لازم أعرف الـ URL |
| إنقاذ سهم خاسر | `#bagholder-rescue` (`BagHolderRescuePanel` 1124 LOC) | مش في TopBar، موجود في MobileMoreSheet | على الديسكتوب لازم URL |
| عيادة الإنقاذ | `#rescue` (`RescuePage` 407 LOC) | مش في TopBar | لازم أعرف الـ URL |

**الخلاصة:** عم رشاد محتاج **12 أداة تحليلية**، و**7 منهم مش موجودين خالص في الـ TopBar**. لازم يحفظ URLs. ده غير احترافي لمنصة استثمارية.

### 2.2 فين الـ flow المنطقي؟

#### أ) سيولة المستثمرين (أجانب/عرب/مصريين) — EGX only

- **الأصل:** `src/modules/dashboard/components/InvestorsFlowPanel.tsx` (557 LOC) — كان widget على الـ Dashboard (`DashboardView.tsx` line 295 comment صراحةً: "InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel اتشالوا" — أُزيلت من الداشبورد).
- **دلوقتي:** موجودة **فقط** جوّه case 'market-depth' في `page.tsx` lines 656-698.
- **والمفارقة:** الـ `#market-depth` نفسه مش في `navSections` في `TopBar.tsx` (line 100 comment: `market-depth → deep-link #market-depth`)، ولا في `bottomNavItems` في `MobileNav.tsx`، ولا في `moreNavItems` في `MobileMoreSheet.tsx`.
- **النتيجة:** المستثمر اللي عاوز يشوف "الأجانب ببيعوا ولا بيشروا" لازم:
  1. يعرف إن الشاشة موجودة أصلاً
  2. يكتب `#market-depth` في الـ URL manually
  3. **وده محال لأي عميل جديد يكتشفها.**

#### ب) الشريعة للأسهم — خاص بالمصريين

- **الأصل:** `src/modules/sharia/components/ShariaView.tsx` (1490 LOC) — `#sharia` route في `page.tsx` line 777.
- **دلوقتي:** **مش في الـ TopBar** خالص (`TopBar.tsx` line 106 comment: `sharia/rescue/zakat/tithes/about → Settings section or deep-link`). بس(Settings ما فيهاش link ليها فعلياً).
- **على الموبايل:** موجودة في `MobileMoreSheet.tsx` line 46 (`'التوافق الشرعي'`).
- **المشكلة:** مستخدم الديسكتوب محروم منها تماماً. مستخدم الموبايل يلاقيها بعد كليكين. **عدم تكافؤ desktop/mobile.**

#### ج) التعليم + المحاكاة

- **Academy:** `src/modules/education/...` (`AcademyView` 2483 LOC, `#academy`) — على الديسكتوب في بوابة "المزيد"، على الموبايل في MobileMoreSheet line 48.
- **Simulation:** `src/modules/simulation/components/SimulationView.tsx` (2130 LOC, `#simulation`) — **على الديسكتوب مش في TopBar** (TopBar.tsx line 105: `simulation → deep-link #simulation`). على الموبايل في MobileMoreSheet line 47.
- **المشكلة:** مفيش قائمة "تعلّم" مستقلة. الأونر طلب صراحةً قائمة لوحدها. ده كمان منطقي لأن الأكاديمية + المحاكاة = رحلة تعليمية متكاملة (تعلم → جرّب → صفقة حقيقية).

#### د) الاستشارة الكاملة لسهم — فين؟

عندي **5 شاشات مختلفة** كلها تقدم "تحليل لسهم واحد"، **ولا واحدة فيهم في الـ TopBar**:

| # | الشاشة | المسار | LOC | وظيفتها |
|---|---|---|---|---|
| 1 | `SpecialistAnalysisView` | `#specialist-analysis` | 2916 | التقرير المالي الاحترافي العميق — momentum + institutions + price action |
| 2 | `UnifiedAnalysisView` | `#unified-analysis` | 562 | تحليل موحّد لسهم واحد (multiple data sources merged) |
| 3 | `SmartConfluenceView` | `#smart-confluence` | 276 | confluence signal for symbol |
| 4 | `V82DecisionPanel` | `#v82` | 294 | BUY/SELL/WAIT/AVOID + 9-Condition Gate + Entry/SL/TP1/TP2 |
| 5 | `TradingChartView` | `#trading-chart` / `#screener` | 309 | تقرير مالي احترافي لسهم واحد (8 أقسام منظمة) |
| 6 | `BagHolderRescuePanel` | `#bagholder-rescue` | 1124 | للأسهم الخاسرة — persona-scaled rescue advice |

**الـ TopBar.tsx line 101 comment** بيقول: `specialist-analysis → tab/drawer inside StockDetail (mandate)`. يعني النية إن التحليل الكامل يفتح من الـ Drawer بتاع السهم، **بس مفيش UI فعلي بتعرض الـ drawer ده بشكل واضح.** عم رشاد بيضطر يحفظ 5 URLs.

### 2.3 إيه اللي اختفى وبيقلقني؟

1. **InvestorsFlowPanel اتشال من Dashboard** (line 295 explicit removal) — كان تحت بصي، دلوقتي محتاج URL.
2. **LiquidityFlowPanel** (نفس المصير) — كانت معاه، اتمسحت برضه.
3. **IntradayPressurePanel** (نفس المصير) — كانت بتدي "ضغط الجلسة" اللحظي.
4. **5 شاشات تحليل لسهم من غير قائمة موحّدة** — مفيش mental model واضح "أبدأ فين لو عاوز أحلل سهم؟"
5. **الشريعة على الديسكتوب** — مفقودة تماماً.
6. **المحاكاة على الديسكتوب** — مفقودة تماماً.
7. **التقارير، الباكتست، الموسمية، يوميات التداول، ذاكرة التداول** — كلهم URL-only.

### 2.4 اقتراح عم رشاد للترتيب الجديد

```
TopBar (6 بوابات — لأن الأونر طلب قائمة تعليم لوحدها):

1. الرئيسية → dashboard, market-depth
2. السوق → stocks, stock-filters, liquidity-radar, trading-chart, screener
3. التحليل ← هنا كل أدواتي التحليلية:
   - recommendations (توصيات)
   - specialist-analysis ← الاستشارة الكاملة لسهم
   - unified-analysis
   - smart-confluence
   - v82 (قرار V82)
   - dual-track (التوقعات المزدوجة)
   - prediction-tracking (تتبّع التوقعات)
   - seasonality (الموسمية)
   - reports (تقارير PDF)
   - backtesting (اختبار الاستراتيجيات)
4. محفظتي → portfolio, watchlist, alerts-center, live-monitor, bagholder-rescue,
   trading-journal, trading-memory, publishing, wealth, advanced-portfolio
5. التعلّم ← جديد: academy, simulation
6. المزيد → news, sharia (مصري), zakat, tithes, subscription, settings, about, auth
```

**MobileNav (5 أيقونات — تأخذ في الاعتبار إن الرادار هو الأهم للمضاربة اليومية):**

```
1. الرئيسية → dashboard
2. الأسهم → stocks
3. التحليل → recommendations (ينفتح منه drawer فيه: specialist / unified / smart-confluence / v82)
4. المحفظة → portfolio
5. سيولة → market-depth (أجانب/عرب/مصريين) ← بدلاً من liquidity-radar اللي هو مؤسسات بس
```

**MobileMoreSheet (يتوسّع ليضم بقية الأدوات التحليلية):**
- يُضاف: `market-depth`, `specialist-analysis`, `unified-analysis`, `smart-confluence`, `seasonality`, `reports`, `backtesting`, `trading-journal`, `trading-memory`, `bagholder-rescue`
- يبقى: `watchlist`, `sharia`, `simulation`, `academy`, `about`, `settings`

---

## الباب 3: التصور الموحّد (The Consensus)

### 3.1 الهيكل الجديد المقترح

**نوافق على 6 بوابات في الـ TopBar** (بدلاً من 5) — احتراماً لطلب الأونر صراحةً: "التعليم والمحاكاة المفروض يكون في قائمة لوحدهم".

**الـ MobileNav يبقى 5 أيقونات** (مع تغيير `liquidity-radar` → `market-depth` لأن الأخير أعمق وأهم لـ EGX).

**الـ MobileMoreSheet يتوسّع** ليضم كل الأدوات التحليلية المفقودة.

### 3.2 خريطة كل شاشة → فين لازم تكون (أي بوابة)

| الشاشة الحالية | المسار | البوابة الحالية | البوابة المقترحة | السبب |
|---|---|---|---|---|
| DashboardView | `#dashboard` | home | home ✅ | صحيح |
| StocksView | `#stocks` | market | market ✅ | صحيح |
| StockScreenerAdvanced | `#stock-filters` | (URL only) | market | ضروري يرجع للقائمة |
| TradingChartView | `#trading-chart` | (URL only) | market | ضروري يرجع للقائمة |
| LiquidityRadarView | `#liquidity-radar` | market | market ✅ | صحيح |
| **market-depth (InvestorsFlowPanel)** | `#market-depth` | **(URL only — لا في TopBar ولا MobileNav ولا MobileMoreSheet)** | **market + MobileNav #5** | **الأونر صراحةً طلبه — سيولة المستثمرين أجانب/عرب** |
| MarketAnalysisView (recommendations) | `#recommendations` | predictions | analysis ✅ | صحيح |
| DualTrackPredictionsView | `#dual-track` | (URL only) | analysis | ضروري يرجع |
| PredictionTrackingView | `#prediction-tracking` | (URL only) | analysis | ضروري يرجع |
| UnifiedAnalysisView | `#unified-analysis` | (URL only) | analysis | ضروري — الاستشارة الكاملة |
| **SpecialistAnalysisView** | `#specialist-analysis` | **(URL only — مفروض drawer جوّه StockDetail لكن مفيش UI بيفتحه)** | **analysis + StockDetail drawer** | **الأونر صراحةً طلب "استشارة كاملة مفصلة لسهم"** |
| V82DecisionPanel | `#v82` | (URL only) | analysis | ضروري يرجع |
| ReportsView | `#reports` | (URL only) | analysis | ضروري يرجع |
| SmartConfluenceView | `#smart-confluence` | (URL only) | analysis | ضروري يرجع |
| SeasonalityDashboard | `#seasonality` | (URL only) | analysis | ضروري يرجع |
| EGXBacktestDashboard | `#backtesting` | (URL only) | analysis | ضروري يرجع |
| EnhancedPortfolioView | `#portfolio` | finance | portfolio ✅ | صحيح |
| EnhancedWatchlistView | `#watchlist` | finance | portfolio ✅ | صحيح |
| BagHolderRescuePanel | `#bagholder-rescue` | (URL only على desktop, MobileMoreSheet على mobile) | portfolio | ضروري يرجع للديسكتوب |
| AdvancedPortfolioManager | `#advanced-portfolio` | (URL only) | portfolio | ضروري يرجع |
| AlertsCenterView | `#alerts-center` | (URL only) | portfolio | ضروري يرجع |
| LiveMonitor | `#live-monitor` | (URL only) | portfolio | ضروري يرجع |
| WealthCharts | `#wealth` | (URL only) | portfolio | ضروري يرجع |
| TradingMemoryView | `#trading-memory` | (URL only) | portfolio | ضروري يرجع |
| TradingJournalView | `#trading-journal` | (URL only) | portfolio | ضروري يرجع |
| UserPublishingView | `#publishing` | (URL only) | portfolio | ضروري يرجع |
| NewsFeedView | `#news` | more | more ✅ | صحيح |
| **SimulationView** | `#simulation` | **(URL only على desktop, MobileMoreSheet على mobile)** | **education (جديد)** | **الأونر طلبها مع الأكاديمية** |
| **AcademyView** | `#academy` | more | **education (جديد)** | **الأونر طلبها في قائمة لوحدها** |
| **ShariaView** | `#sharia` | **(URL only على desktop, MobileMoreSheet على mobile)** | **more (مع لافتة بصرية "خاص بالمصريين")** | **الأونر صراحةً طلبها — خاص بالمصريين** |
| ZakatView | `#zakat` | (URL only) | more | ضروري يرجع |
| TithesView | `#tithes` | (URL only) | more | ضروري يرجع |
| SubscriptionView | `#subscription` | more | more ✅ | صحيح |
| SettingsView | `#settings` | more | more ✅ | صحيح |
| AuthView | `#auth` | (URL only) | more | ضروري يرجع |
| AboutView | `#about` | (URL only) | more | ضروري يرجع |
| AdminView | `#admin` | (URL only) | admin (مخفي) | يبقى في user menu فقط |
| RescuePage | `#rescue` | (URL only) | portfolio (مع bagholder-rescue) | ضروري يرجع |

### 3.3 الجداول التفصيلية لكل بوابة مقترحة

#### 🏠 البوابة 1: الرئيسية (home)

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | نظرة عامة | `#dashboard` | `DashboardView` (590 LOC) | لوحة نظرة عامة على السوق — index cards, market pulse, top movers, multi-market | home (موجود ✅) | نقطة البداية الصحيحة |
| 2 | **عمق السوق / سيولة المستثمرين** | `#market-depth` | inline composite (page.tsx 656-698) + `InvestorsFlowPanel` (557 LOC) + `MultiMarketWidget` (610 LOC) | لوحة تدفقات السيولة — أجانب/عرب/مصريين + عملات/ذهب | **home (جديد — كان URL only)** | الأونر طلبه صراحةً — EGX only، لازم يكون متاح من الـ home |

#### 📊 البوابة 2: السوق (market)

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | الأسهم | `#stocks` | `StocksView` (2319 LOC) | جدول أسعار لحظي + detail drawer | market (موجود ✅) | نقطة الدخول للأسهم |
| 2 | فلاتر الأسهم | `#stock-filters` | `StockScreenerAdvanced` (2723 LOC) | فلاتر متقدمة + top performers | **market (يرجع — كان URL only)** | ضروري للمضاربة اليومية |
| 3 | الشارت التفاعلي | `#trading-chart`, `#screener` | `TradingChartView` (309 LOC) | تقرير مالي احترافي لسهم واحد (8 أقسام) | **market (يرجع — كان URL only)** | أدوات charting احترافية |
| 4 | رادار السيولة | `#liquidity-radar` | `LiquidityRadarView` (657 LOC) | جدول تدفقات السيولة المؤسسية | market (موجود ✅) | يكمل عمق السوق |
| 5 | أعلى الأرباح/الخسائر | `#top-performers` | `StockScreenerAdvanced` (initialTab=`top-performers`) | redirect للتاب | **market (اختياري)** | ممكن يندمج مع #2 |

#### 🎯 البوابة 3: التحليل (analysis) — renamed من "predictions"

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | التوصيات | `#recommendations`, `#analysis` | `MarketAnalysisView` (332 LOC) | 6 تابات: توقعات، حالة السوق، قطاعات، تداولات تاريخية، net-picks، تقارير | analysis (موجود ✅) | نقطة الدخول للتحليل |
| 2 | **التحليل المتخصص — استشارة كاملة لسهم** | `#specialist-analysis` | `SpecialistAnalysisView` (2916 LOC) | التقرير المالي العميق لسهم واحد (momentum + institutions + price action) | **analysis (يرجع — كان URL only) + drawer من StockDetail** | **الأونر صراحةً طلب "استشارة كاملة مفصلة لسهم"** |
| 3 | التحليل الموحّد | `#unified-analysis` | `UnifiedAnalysisView` (562 LOC) | تحليل موحّد لسهم واحد (multiple data sources merged) | **analysis (يرجع — كان URL only)** | مهم كـ"نظرة شاملة" |
| 4 | المساعد الذكي | `#smart-confluence` | `SmartConfluenceView` (276 LOC) | confluence signal for symbol | **analysis (يرجع — كان URL only)** | أدوات AI للقرار |
| 5 | قرار V82 | `#v82` | `V82DecisionPanel` (294 LOC) | BUY/SELL/WAIT/AVOID + 9-Condition Gate + Entry/SL/TP1/TP2 | **analysis (يرجع — كان URL only)** | قرار مؤسسي منظم |
| 6 | التوقعات المزدوجة | `#dual-track` | `DualTrackPredictionsView` (633 LOC) | combined_efficiency stats + 3 تابات تحليل | **analysis (يرجع — كان URL only)** | أدوات توقعات |
| 7 | تتبّع التوقعات | `#prediction-tracking`, `#picks-management` | `PredictionTrackingView` (718 LOC) | كروت إحصائية + جدول + "تحقق الآن" | **analysis (يرجع — كان URL only)** | ضروري للمتابعة |
| 8 | الموسمية | `#seasonality` | `SeasonalityDashboard` (300 LOC) | seasonal patterns | **analysis (يرجع — كان URL only)** | أدوات توقعات موسمية |
| 9 | التقارير | `#reports` | `ReportsView` (955 LOC) | تقارير PDF احترافية | **analysis (يرجع — كان URL only)** | عم رشاد محتاجاه |
| 10 | اختبار الاستراتيجيات | `#backtesting` | `EGXBacktestDashboard` (443 LOC) | backtest على بيانات EGX التاريخية | **analysis (يرجع — كان URL only)** | عم رشاد محتاجاه |

#### 💼 البوابة 4: محفظتي (portfolio)

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | المحفظة | `#portfolio`, `#finance` | `EnhancedPortfolioView` (3369 LOC) | 5 تابات: أصول، دخل/مصروف، التزامات، تقارير، تنبيهات | portfolio (موجود ✅) | نقطة الدخول للمحفظة |
| 2 | قائمة المتابعة | `#watchlist` | `EnhancedWatchlistView` (1356 LOC) | flashing prices + alerts | portfolio (موجود ✅) | ضروري |
| 3 | إنقاذ سهم خاسر | `#bagholder-rescue` | `BagHolderRescuePanel` (1124 LOC) | 5 تابات: technical, fundamentals, scenarios, rescue plan, decision journal | **portfolio (يرجع للديسكتوب — حالياً URL only على desktop, MobileMoreSheet على mobile)** | مهم لكل مستثمر خاسر |
| 4 | عيادة الإنقاذ | `#rescue` | `RescuePage` (407 LOC) | rescue clinic | **portfolio (يرجع — كان URL only)** | مكمّل لـ #3 |
| 5 | المحفظة المتقدمة | `#advanced-portfolio` | `AdvancedPortfolioManager` (578 LOC) | risk metrics + multi-portfolio | **portfolio (يرجع — كان URL only)** | عم رشاد محتاجاه |
| 6 | مركز التنبيهات | `#alerts-center` | `AlertsCenterView` (689 LOC) | multi-stage alerts + scheduler | **portfolio (يرجع — كان URL only)** | ضروري |
| 7 | المراقبة الحية | `#live-monitor` | `LiveMonitor` (1357 LOC) | جلب كل 10 ثوانٍ + حالة السوق + EGX30 + محفظة مباشرة | **portfolio (يرجع — كان URL only)** | عم رشاد محتاجاه |
| 8 | رسوم الثروة | `#wealth` | `WealthCharts` (465 LOC) | 4 شارتات: line/pie/area/bar | **portfolio (يرجع — كان URL only)** | مهم لإدارة الأموال |
| 9 | ذاكرة التداول | `#trading-memory` | `TradingMemoryView` (326 LOC) | ProfessionalWatchlistView sub-component | **portfolio (يرجع — كان URL only)** | عم رشاد محتاجاه |
| 10 | يوميات التداول | `#trading-journal` | `TradingJournalView` (586 LOC) | trade log + stats | **portfolio (يرجع — كان URL only)** | ضروري |
| 11 | منصة النشر | `#publishing` | `UserPublishingView` (739 LOC) | نشر التوقعات + نقاط المستخدمين | **portfolio (يرجع — كان URL only)** | مهم للمستثمر الناشط |

#### 🎓 البوابة 5: التعلّم (education) — جديدة حسب طلب الأونر

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | الأكاديمية | `#academy` | `AcademyView` (2483 LOC) | 8 تابات: encyclopedia, paper-trading, candle-sim, strategy-lab, advanced-lessons, trading-floor, practical-tools, advanced-lab | **education (جديد — حالياً في "more")** | الأونر طلبها مع المحاكاة |
| 2 | المحاكاة | `#simulation` | `SimulationView` (2130 LOC) | محاكاة تداول لحظية لكل الأسواق | **education (جديد — حالياً URL only على desktop, MobileMoreSheet على mobile)** | الأونر طلبها مع الأكاديمية |

#### ☰ البوابة 6: المزيد (more)

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | الأخبار | `#news` | `NewsFeedView` (890 LOC) | أخبار مالية + investment insights + social sharing | more (موجود ✅) | صحيح |
| 2 | **التوافق الشرعي** | `#sharia` | `ShariaView` (1490 LOC) | 253 سهماً + حاسبة تطهير + 8 مصادر (طراز مالي إسلامي emerald+gold) | **more (يرجع للديسكتوب — حالياً URL only على desktop, MobileMoreSheet على mobile)** | **الأونر صراحةً طلبه — خاص بالمصريين** |
| 3 | الزكاة | `#zakat` | `ZakatView` (1143 LOC) | حاسبة الزكاة الإسلامية | **more (يرجع — كان URL only)** | مهم للمصريين |
| 4 | العشور | `#tithes` | `TithesView` (757 LOC) | حاسبة العشور المسيحية | **more (يرجع — كان URL only)** | مهم للأقباط |
| 5 | الاشتراك | `#subscription` | `SubscriptionView` (1791 LOC) | خطط الاشتراك + trial + payment | more (موجود ✅) | صحيح |
| 6 | الإعدادات | `#settings` | `SettingsView` (232 LOC) | إعدادات المستخدم + التطبيق | more (موجود ✅) | صحيح |
| 7 | من نحن | `#about` | `AboutView` (384 LOC) | صفحة تعريفية بالمنصة | **more (يرجع — كان URL only)** | ضروري للهوية |
| 8 | تسجيل الدخول | `#auth` | `AuthView` (650 LOC) | OAuth + email + bot-link | **more (يرجع — كان URL only — يكفي أنه في user menu)** | ضروري للضيوف |

#### 🔐 مخفي: Admin

| # | الاسم | المسار | المكون | الوصف | لازم تكون فين | السبب |
|---|---|---|---|---|---|---|
| 1 | لوحة الأدمن | `#admin` | `AdminView` (2083 LOC) | 30+ sub-tab للمشرف | **user menu فقط (مخفي)** | مفيش داعي يكون ظاهر للعميل |

### 3.4 الشاشات اللي اختفت — لازم ترجع فين

| الشاشة | دلوقتي | لازم ترجع فين | الأولوية |
|---|---|---|---|
| `#market-depth` (InvestorsFlowPanel) | URL only — مفيش أي way للوصول | home + MobileNav #5 (بدلاً من liquidity-radar) | 🔴 P0 |
| `#sharia` | MobileMoreSheet only على الموبايل، URL only على الديسكتوب | more (TopBar) — مع لافتة بصرية | 🔴 P0 |
| `#simulation` | MobileMoreSheet على الموبايل، URL only على الديسكتوب | education (جديد) | 🔴 P0 |
| `#specialist-analysis` | URL only | analysis (TopBar) + drawer من StockDetail | 🔴 P0 |
| `#unified-analysis` | URL only | analysis | 🟡 P1 |
| `#smart-confluence` | URL only | analysis | 🟡 P1 |
| `#v82` | URL only | analysis | 🟡 P1 |
| `#dual-track` | URL only | analysis | 🟡 P1 |
| `#prediction-tracking` | URL only | analysis | 🟡 P1 |
| `#seasonality` | URL only | analysis | 🟡 P1 |
| `#reports` | URL only | analysis | 🟡 P1 |
| `#backtesting` | URL only | analysis | 🟡 P1 |
| `#bagholder-rescue` | URL only على desktop | portfolio (TopBar) | 🟡 P1 |
| `#alerts-center` | URL only | portfolio | 🟡 P1 |
| `#live-monitor` | URL only | portfolio | 🟡 P1 |
| `#trading-journal` | URL only | portfolio | 🟡 P1 |
| `#trading-memory` | URL only | portfolio | 🟡 P1 |
| `#wealth` | URL only | portfolio | 🟡 P1 |
| `#publishing` | URL only | portfolio | 🟡 P1 |
| `#zakat` | URL only | more | 🟢 P2 |
| `#tithes` | URL only | more | 🟢 P2 |
| `#about` | URL only | more | 🟢 P2 |

### 3.5 الشاشات اللي تتدمج

| الدمج المقترح | الشاشات | السبب |
|---|---|---|
| Stock Screener + Top Performers | `#stock-filters` + `#top-performers` | فعلياً نفس المكون (StockScreenerAdvanced بـ initialTab مختلف) — ✅ ده معمول أصلاً |
| BagHolderRescue + Rescue Page | `#bagholder-rescue` + `#rescue` | الاتنين بنفس الهدف — ممكن `#rescue` يحوّل لـ `#bagholder-rescue` |
| Specialist Analysis + Trading Chart | `#specialist-analysis` + `#trading-chart` | الاتنين "تقرير احترافي لسهم واحد" — ممكن `#trading-chart` يصبح tab داخل Specialist |
| Unified Analysis + Smart Confluence | `#unified-analysis` + `#smart-confluence` | الاتنين "تحليل موحّد لسهم" — ممكن يدمجوا |
| Wealth → sub-tab in Portfolio | `#wealth` (465 LOC) | ✅ ده معمول أصلاً (Task 40-B) — موجود كـ sub-tab في EnhancedPortfolioView |

### 3.6 شاشات جديدة لازم تتضاف

| الشاشة الجديدة | الوصف | السبب |
|---|---|---|
| **"الاستشارة الكاملة لسهم"** (entry point موحّد) | زر واحد في `StockDetailDrawer` بيفتح drawer فيه تابات: Specialist / Unified / Smart Confluence / V82 / Trading Chart / BagHolder Rescue | عم رشاد محتاج نقطة دخول واحدة بدل 5 URLs |
| **قائمة "أدوات تحليل السهم"** | قائمة منسدلة في `analysis` portal | تجمع كل أدوات تحليل السهم في مكان واحد |
| **EGX-only flag على الـ TopBar** | أيقونة بصرية لما currentMarket === 'EGX' تظهر "أدوات EGX متاحة" | لأن InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel = EGX only |

---

## الباب 4: الحاجات اللي اختفت (Critical Findings)

### 4.1 حركة سيولة المستثمرين (أجانب/عرب) — 🔴 P0 CRITICAL

> الأونر قال: "حركة السيولة مع المستثمرين (أجانب/عرب) خاصة بالسوق المصري (EGX فقط). فين دلوقتي؟"

#### فين كانت؟

- **الأصل:** `src/modules/dashboard/components/InvestorsFlowPanel.tsx` (557 LOC) — كان widget على الـ Dashboard.
- **دليل الإزالة:** `src/modules/dashboard/components/DashboardView.tsx` line 295 comment صراحةً:
  > "InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel اتشالوا"

#### فين دلوقتي؟

- موجودة **فقط** جوّه `case 'market-depth'` في `src/app/page.tsx` lines 656-698.
- الـ `#market-depth` نفسه:
  - **مش في `navSections`** في `src/components/layout/TopBar.tsx` (line 100 comment: `market-depth → deep-link #market-depth`).
  - **مش في `bottomNavItems`** في `src/components/layout/MobileNav.tsx`.
  - **مش في `moreNavItems`** في `src/components/layout/MobileMoreSheet.tsx` (lines 40-50 — موجود: bagholder-rescue, watchlist, sharia, simulation, academy, about — مفيش market-depth).

#### لازم ترجع فين؟

| المكان | الإجراء |
|---|---|
| **الـ TopBar (home portal)** | يُضاف `market-depth` كـ "سيولة المستثمرين" (لأهميته لأي EGX trader) |
| **الـ MobileNav #5** | يستبدل `liquidity-radar` بـ `market-depth` (لأن الأخير أعمق — يشمل المؤسسات + الأجانب/العرب/المصريين) |
| **الـ MobileMoreSheet** | يُضاف `market-depth` كـ entry واضح (لو تم الإبقاء على `liquidity-radar` في bottom bar) |
| **الـ DashboardView** | يُرجع InvestorsFlowPanel + LiquidityFlowPanel + IntradayPressurePanel widgets (line 295) — مفيش سبب يخليها URL only |

#### التأثير

- **بدون الإصلاح:** أي مستثمر EGX جديد لا يمكنه اكتشاف تدفقات الأجانب/العرب. هذا = losing money on bad timing.
- **مع الإصلاح:** في كليك واحد من الـ home، المستثمر يشوف: العملات/الذهب (للجميع) + تدفقات الأجانب/العرب (EGX) + ضغط الجلسة (EGX).

### 4.2 الشريعة للأسهم — 🔴 P0

> الأونر قال: "الشريعة للأسهم خاصة بالمصريين. فين؟"

#### فين؟

- **الأصل:** `src/modules/sharia/components/ShariaView.tsx` (1490 LOC) — `#sharia` route في `src/app/page.tsx` line 777.
- **الوصول على الديسكتوب:** URL only — مش في `navSections` (`TopBar.tsx` line 106 comment: `sharia → Settings section or deep-link`). لكن `SettingsView` (232 LOC) مفيهاش فعلياً link للشريعة.
- **الوصول على الموبايل:** موجود في `MobileMoreSheet.tsx` line 46 (`'التوافق الشرعي'`).

#### لازم تكون فين؟

| المكان | الإجراء |
|---|---|
| **الـ TopBar (more portal)** | يُضاف `sharia` كـ "التوافق الشرعي" مع لافتة "🇪🇬 خاص بالمصريين" |
| **الـ MobileMoreSheet** | يُبقى (موجود ✅) |
| **الـ StockDetailDrawer** | يُضاف tag "شريعي" / "غير شريعي" لكل سهم في الـ drawer |

#### التأثير

- **بدون الإصلاح:** مستخدمو الديسكتوب (وهم غالباً الأكثر احترافية مثل عم رشاد) محرومون من 253 سهماً شريعياً + حاسبة التطهير.
- **مع الإصلاح:** في كليك واحد من "المزيد"، المستثمر المصري يصل لكل أدواته الشرعية.

### 4.3 التعليم + المحاكاة — 🔴 P0 (الأونر طلب قائمة لوحدها)

> الأونر قال: "التعليم والمحاكاة المفروض يكون في قائمة لوحده."

#### فين دلوقتي؟

| الشاشة | المكون | الديسكتوب (TopBar) | الموبايل (MobileMoreSheet) |
|---|---|---|---|
| Academy | `AcademyView` (2483 LOC) | ✅ في "more" | ✅ line 48 |
| Simulation | `SimulationView` (2130 LOC) | ❌ URL only (`TopBar.tsx` line 105 comment) | ✅ line 47 |

#### لازم يكونوا فين؟

| المكان | الإجراء |
|---|---|
| **بوابة جديدة "التعلّم" (education)** في الـ TopBar | تجمع `academy` + `simulation` |
| **الـ MobileMoreSheet** | يُضاف section header "التعلّم" فوق `academy` + `simulation` |
| **داخل AcademyView** | يُضاف link واضح للمحاكاة ("جرّب ما تعلمته في المحاكاة") |

#### التأثير

- **بدون الإصلاح:** مستخدمو الديسكتوب لا يمكنهم الوصول للمحاكاة أصلاً (URL only). رحلة التعلم محبوسة.
- **مع الإصلاح:** رحلة التعلم الواضحة: تعلم في الأكاديمية → جرّب في المحاكاة → ادخل المحفظة.

### 4.4 الاستشارة الكاملة لسهم — 🔴 P0

> الأونر قال: "استشارة كاملة مفصلة لسهم. فين؟"

#### فين؟

عندي **5 شاشات** كلها "تحليل مفصّل لسهم واحد"، **ولا واحدة في الـ TopBar**:

| # | الشاشة | المسار | LOC | الوظيفة | الـ TopBar |
|---|---|---|---|---|---|
| 1 | `SpecialistAnalysisView` | `#specialist-analysis` | 2916 | التقرير المالي العميق — momentum + institutions + price action | ❌ |
| 2 | `UnifiedAnalysisView` | `#unified-analysis` | 562 | تحليل موحّد (multiple data sources merged) | ❌ |
| 3 | `SmartConfluenceView` | `#smart-confluence` | 276 | confluence signal | ❌ |
| 4 | `V82DecisionPanel` | `#v82` | 294 | BUY/SELL/WAIT/AVOID + 9-Condition Gate | ❌ |
| 5 | `TradingChartView` | `#trading-chart` | 309 | تقرير مالي احترافي (8 أقسام) | ❌ |
| 6 | `BagHolderRescuePanel` | `#bagholder-rescue` | 1124 | للأسهم الخاسرة | ❌ (URL only على desktop) |

#### النية الأصلية (per `TopBar.tsx` line 101 comment):

> `specialist-analysis → tab/drawer inside StockDetail (mandate)`

يعني النية إن التحليل الكامل يفتح من الـ Drawer بتاع السهم، **بس الـ UI الفعلي مش بيعمل ده بشكل واضح.** عم رشاد بيضطر يحفظ 5 URLs.

#### لازم تكون فين؟

| المكان | الإجراء |
|---|---|
| **الـ TopBar (analysis portal)** | يُضاف `specialist-analysis` كـ "الاستشارة الكاملة لسهم" |
| **الـ StockDetailDrawer** (في `StocksView`) | يُضاف زر واضح "📊 استشارة كاملة" بيفتح drawer فيه تابات: Specialist / Unified / Smart Confluence / V82 / Trading Chart / BagHolder Rescue |
| **الـ MobileMoreSheet** | يُضاف `specialist-analysis` كـ entry |

#### التأثير

- **بدون الإصلاح:** مستثمر جديد يحلل سهم = مش لاقي الطريق. 5 شاشات بدون mental model.
- **مع الإصلاح:** في كليك واحد من `StocksView` → detail drawer → "استشارة كاملة" → كل أدوات التحليل في تابات منظمة.

---

## الخلاصة التنفيذية

**3 مشاكل P0 حرجة (الأونر وسمّاها بنفسه):**

1. **حركة سيولة المستثمرين (أجانب/عرب)** — مفقودة تماماً من أي قائمة. موجودة URL only في `#market-depth`. لازم ترجع للـ home + MobileNav #5.
2. **الشريعة** — على الديسكتوب مفقودة. على الموبايل في MobileMoreSheet. لازم تترجع للـ TopBar (more).
3. **التعليم + المحاكاة** — الأونر طلب قائمة لوحدها. لازم بوابة "التعلّم" جديدة في الـ TopBar.
4. **الاستشارة الكاملة لسهم** — 5 شاشات مختلفة بدون entry point واضح. لازم drawer موحّد في StockDetail + entry في analysis portal.

**عدد الشاشات المفقودة من الـ TopBar دلوقتي:** 20 من 28 شاشة canonical (71%) — URL only.

**التوصية:** تنفيذ الترتيب الجديد المُقترح في الباب 3 يقلل عدد الشاشات URL only من 20 → 0، ويضيف بوابة "التعلّم" السادسة حسب طلب الأونر.

---

*End of SCREENS-REORG-VISION. Research-only. No code changes.*
