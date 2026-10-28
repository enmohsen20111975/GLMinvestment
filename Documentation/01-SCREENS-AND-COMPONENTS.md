# 01 — الشاشات والمكونات (Screens & Components)

> **الفرع:** `bravo/docs-consolidation` | **Task ID:** `DOCS-3`
> **تاريخ التوثيق:** 2026-10-28
> **المرجع:** `src/modules/*` + `src/app/page.tsx` + `src/lib/db-manager.ts`
> **القاعدة الأم (Rule 27 — NO-FAKE-DATA):** كل الأرقام من الـ backend. الـ frontend بيعرض فقط.

---

## 1. الإحصائيات السريعة (At a Glance)

| المقياس | القيمة |
|---------|--------|
| عدد المكونات (`*.tsx`) | **351** component |
| عدد الـ modules | **19** module |
| الشاشة الرئيسية | `src/app/page.tsx` (1,200+ LOC) |
| آلية الـ routing | **Hash routes** (`window.location.hash`) |
| الـ Data Access Layer | `DbManager` (`src/lib/db-manager.ts`) — البوابة الموحدة |
| حسابات الـ frontend | ممنوعة (كل الأرقام من الـ backend) |
| canonical signal libs | `canonical-rsi.ts` + `canonical-signal.ts` |

### 1.1 توزيع المكونات على الـ modules

| Module | # tsx | المختصر |
|--------|-------|---------|
| `admin` | 104 | لوحة الأدمن (5 hubs × 18 tab) + db-manager + engine-control + telegram |
| `market-analysis` | 44 | تحليل السوق + persona + single-stock + expert-recommendations |
| `education` | 37 | الأكاديمية + academy-encyclopedia + strategy-sandbox + paper-trading-ws |
| `stock-analysis` | 28 | شاشة الأسهم + trading-view-chart + stock-detail + stocks-view |
| `dashboard` | 25 | لوحة التحكم الرئيسية (25 widget موزّعة) |
| `predictions` | 22 | تتبّع التوقعات + prediction-dashboard + maker-radar |
| `portfolio` | 20 | المحفظة + enhanced-portfolio (AssetsTab/ReportsTab/IncomeExpenseTab…) |
| `reports` | 13 | التقارير (Executive/Daily/Stock/DataManager) |
| `publishing` | 12 | منصة النشر + trade-templates + StockInfographicCard |
| `radar` | 11 | الرادار (Incubator + CompanyFundamentals + Exit + Multi-market) |
| `screener` | 11 | الفلاتر المتقدمة (screener-advanced) |
| `sharia` | 10 | التوافق الشرعي + حاسبة التطهير |
| `simulation` | 6 | محاكاة التداول (useSimulationEngine) |
| `subscription` | 3 | PricingView + TrialCountdownBanner + TrialExpiredModal |
| `crypto` | 2 | CryptoPortfolioView + CryptoPredictionTrackingView |
| `auth` | 1 | DevLoginForm |
| `index-detail` | 1 | IndexDetailView (EGX30/70/100/33) |
| `news` | 1 | NewsFeedView |
| `personalized` | 0 (lib only) | `lib/personalized-radar.ts` — منطق فقط (no UI) |

---

## 2. الشاشة الرئيسية (`src/app/page.tsx`)

المنصة **Single-Page App (SPA)** — مفيش `pages/` routes. كل الشاشات بتـ render جوّه `AppShell` بناءً على `currentView` في الـ zustand store. الـ URL hash بيتـ sync مع الـ store عبر `UrlHashSync` + `useEffect` listener.

### 2.1 آلية الـ Hash Routes

```
URL:  https://invist.m2y.net/#recommendations
                            └──────────┘
                              currentView (zustand)
```

| الميكانيكية | الملف | الوصف |
|-------------|------|-------|
| `VALID_VIEWS` | `src/lib/valid-views.ts` | المصدر الموحد لكل الـ routes المسموح بيها (63 view) |
| `UrlHashSync` | `src/app/page.tsx` | بيسمع `hashchange` + `popstate` وبيـ update الـ store |
| `AuthGate` | `src/components/auth/AuthGate.tsx` | Route guard — بيمنع Guest من الـ views المقفولة |
| `GuestLockedView` | `src/app/page.tsx` | placeholder للـ Guest لما يحاول يفتح view مقفول |
| `CRYPTO_VIEW_REDIRECTS` | `src/lib/valid-views.ts` | redirect table للكريبتو → unified views |
| `LEGACY_VIEW_REDIRECTS` | `src/lib/valid-views.ts` | redirect table للشاشات المحذوفة → البديل الموحّد |

### 2.2 الـ switch الكامل (40+ case)

| Route | Component | الـ API | ملاحظات |
|-------|-----------|--------|---------|
| `#dashboard` | `DashboardView` | `/api/market/*` | الشاشة الافتراضية |
| `#stocks` / `#stock-detail` / `#crypto-live` | `StocksView` | `/api/stocks/*` | UI-Mirror (crypto fallthrough) |
| `#stock-filters` / `#screener` / `#crypto-screener` | `StockScreenerAdvanced` | `/api/screener/advanced` (Python proxy) | Python screener |
| `#top-performers` | `StockScreenerAdvanced` (initialTab) | نفسه | tab 2 — أعلى الأرباح/الخسائر |
| `#trading-chart` / `#crypto-trading-chart` | `TradingChartView` | `/api/v2/chart/full-analysis` | شارت تفاعلي |
| `#portfolio` / `#finance` | `EnhancedPortfolioView` | `/api/portfolio/*` | محفظة متعددة الأصول |
| `#watchlist` / `#crypto-watchlist` | `EnhancedWatchlistView` | `/api/watchlist/*` | قائمة متابعة |
| `#recommendations` / `#analysis` / `#crypto-recommendations` | `MarketAnalysisView` | `/api/v2/recommend` + `/api/market/regime` | التوصيات الموحدة |
| `#market-status` | inline (IndexCards + IndexDetailView + MarketRegimeBanner + IntradayPressure) | `/api/indices/*` | EGX only |
| `#incubator` | `IncubatorSection` (standalone) | `/api/incubator?market=EGX` | الفحص الحي |
| `#historical-trades` | `HistoricalTradesTable` | `/api/historical-trades` | الصفقات التاريخية |
| `#unified-analysis` | `UnifiedAnalysisView` | `/api/v2/chart/full-analysis` | تحليل موحّد |
| `#specialist-analysis` | `SpecialistAnalysisView` | `/api/expert-analysis/*` | تحليل المتخصصين |
| `#prediction-tracking` | `PredictionTrackingView` | `/api/predictions/honest-tracking` | تتبّع التوقعات |
| `#dual-track` | `DualTrackPredictionsView` | `/api/predictions/daily-picks` | توقعات مزدوجة |
| `#v82` | placeholder (محرك متوقف) | — | SUB_ENGINE_DISABLED |
| `#reports` | `ReportsView` | `/api/reports/*` | التقارير |
| `#news` | `NewsFeedView` | `/api/news?tickers=…` | أخبار مفلترة |
| `#simulation` / `#crypto-simulation` | `SimulationView` | client-only (no DB) | محاكاة التداول |
| `#academy` / `#crypto-learning` | `AcademyView` | static (lessons.ts) | الأكاديمية الموحّدة |
| `#bagholder-rescue` | `BagHolderRescuePanel` | `/api/portfolio/rescue` | إنقاذ سهم خسران |
| `#advanced-portfolio` | `AdvancedPortfolioManager` | `/api/portfolio/master` | محفظة متقدمة |
| `#seasonality` | `SeasonalityDashboard` | `/api/seasonality/*` | الموسمية |
| `#smart-confluence` / `#crypto-analysis` | `SmartConfluenceView` | `/api/smart-assistant/*` | المساعد الذكي |
| `#liquidity-radar` | `LiquidityRadarView` (initialTab="radar") | `/api/v2/liquidity-radar` | رادار السيولة |
| `#sectors` | `LiquidityRadarView` (initialTab="sectors") | نفسه | حركة القطاعات |
| `#market-depth` | inline (MultiMarketWidget + InvestorsFlowPanel) | `/api/market-depth/*` | EGX-only panels |
| `#alerts-center` | `AlertsCenterView` | `/api/alerts/*` | مركز التنبيهات |
| `#live-monitor` | `LiveMonitor` | WebSocket | المراقبة الحية |
| `#wealth` | `WealthCharts` | `/api/wealth/*` | رسوم الثروة |
| `#trading-memory` | `TradingMemoryView` | `/api/memory/*` | ذاكرة التداول |
| `#trading-journal` | `TradingJournalView` | `/api/journal/*` | يوميات التداول |
| `#publishing` | `UserPublishingView` | `/api/publishing/*` | منصة النشر |
| `#crypto` | `DashboardView` + `setCurrentMarket('CRYPTO')` | نفس dashboard | UI-Mirror |
| `#crypto-portfolio` | `CryptoPortfolioView` | `/api/crypto/portfolio` | محفظة الكريبتو |
| `#crypto-prediction-tracking` | `CryptoPredictionTrackingView` | `/api/crypto/predictions` | تتبّع توقعات الكريبتو |
| `#zakat` / `#tithes` / `#sharia` | `ShariaView` (مدمجة) | `/api/sharia/*` | حسابات شرعية موحّدة |
| `#subscription` | `SubscriptionView` | `/api/subscription/*` | الاشتراك |
| `#settings` | `SettingsView` | client-only | الإعدادات |
| `#auth` | `AuthView` | NextAuth | تسجيل الدخول |
| `#admin` | `AdminView` (18 tabs) | `/api/admin/*` | لوحة الأدمن |
| `#about` | `AboutView` | static | من نحن |
| `#backtesting` | `EGXBacktestDashboard` | `/api/backtest/*` | لوحة الـ Backtest |
| `#rescue` | `RescuePage` (`/app/rescue/page`) | `/api/rescue/*` | عيادة الإنقاذ |

### 2.3 مكونات الـ shell الثابتة

| المكوّن | الوصف |
|---------|-------|
| `TopBar` | القائمة العلوية الموحّدة (بديل الـ Sidebar القديم) |
| `MobileNav` | القائمة السفلية على الموبايل |
| `RealtimeTicker` | شريط أسعار لحظي أعلى الصفحة |
| `CentralAlertMonitor` | جرس مركزي بيراقب `/api/sniper/scan` كل 60 ثانية |
| `RoboNotifierToggle` | زر التنبيهات الحية العائم |
| `PaywallListener` | بيسمع `paywall:blocked` من api-client (402/403) |
| `TrialExpiredModal` + `TrialCountdownBanner` | UI الـ trial (soft paywall) |
| `DbSchemaInit` | بـ POST `/api/finance/schema` مرة واحدة/session |
| `SessionSync` | بيربط NextAuth session في zustand store |
| `BotLinkHandler` | بيتفعّل لما `?bot_link=TOKEN` في URL — Dialog تأكيد ربط البوت |

---

## 3. الـ Data Access Layer (DAL)

> **المصدر:** `src/lib/db-manager.ts`
> **القاعدة (Rule 27 — DAL-ONLY):** ممنوع `new Database()` أو `SELECT` مباشر في أي صفحة أو كومبوننت أو مسار API. كل القراءات لازم تمرّ عبر `DbManager`.

### 3.1 الـ DbManager namespace

```typescript
// src/lib/db-manager.ts
export const DbManager = {
  openDb,                 // readonly connection (returns null لو الملف مش موجود)
  openDbWritable,         // writable connection (WAL journal)
  columnExists,           // PRAGMA table_info check (defensive)
  getLiveSparkline,       // sparkline لسهم/مؤشر (stocks.db FIRST)
  getLiveSparklines,      // batch (50 ticker max)
  getIncubatorData,       // مرشحو الحاضنة من maker_radar_{market}_*.json
  getUnifiedLogos,        // كاش الأيقونات (logo_url + logoUrl)
  getLogoUrl,             // logo_url لسهم واحد
  enrichWithUnifiedLogos, // حقن الأيقونات في array (root casing fix)
  getActivePredictions,   // توقعات نظيفة (dedup + anomaly filter)
  getCompanyFundamentals, // 8 تبويبات مالية من stocks.db + data_engine fallback
  getMarketTabData,       // تبويبات السوق (performance/valuation/…)
};
```

### 3.2 الأولويات (per owner directive)

| الدالة | الأولوية | الـ fallback | الحماية |
|--------|---------|--------------|---------|
| `getLiveSparkline(ticker, days=30)` | `stocks.db.stock_daily_prices` (LIVE) | `stocks.db.index_daily_prices` (للمؤشرات) → `price_history.db` (EMERGENCY ONLY) | cache 60s — Rule 27: empty `source: 'none'` لو مفيش بيانات |
| `getIncubatorData(market='EGX')` | أحدث `maker_radar_{market}_*.json` | empty + `is_fresh: false` | بيفلتر المرشحين اللي `data_date` أقدم من اليوم (Cairo tz) |
| `getUnifiedLogos()` | `stocks.db.stocks.logo_url` (post-merge) | `data_engine.db.stocks.logo_url` | cache 5 دقايق |
| `getActivePredictions(market, limit=5)` | `predictions.db.predictions WHERE status='active'` | empty array | dedup by ticker + 4 safety filters (entry>0, stop≥0, stop<entry للـ BUY, deviation ≤15%) |
| `getCompanyFundamentals(ticker)` | `stocks.db.stocks WHERE ticker=?` (66 عمود) | `data_engine.db.tab_*` (8 tables) | direct WHERE (no LIKE) |

### 3.3 sparkline route (thin wrapper)

> **الملف:** `src/app/api/stocks/sparkline/route.ts`

```typescript
// المسار ده thin wrapper — كل الـ DB access بيحصل جوه DbManager.
import { getLiveSparkline, getLiveSparklines } from '@/lib/db-manager';

// GET /api/stocks/sparkline?ticker=COMI&days=30
// GET /api/stocks/sparkline?tickers=COMI,ABUK,CRMB&days=30  (max 50)
```

**الاستجابة:**
```json
{
  "success": true,
  "ticker": "COMI",
  "prices": [12.5, 12.7, 12.6, ...],
  "min": 12.1, "max": 13.2,
  "first": 12.5, "last": 13.0,
  "change_pct": 4.0,
  "days": 30,
  "source": "stocks.db.stock_daily_prices",
  "latest_date": "2026-10-27"
}
```

---

## 4. الـ logo-helper + StockIcon

### 4.1 الـ ROOT FIX (casing mismatch)

المشكلة التاريخية: الـ Python API بيرجع `logo_url` (snake_case) بس الـ components بتقرأ `logoUrl` (camelCase) → undefined → الدايرة الحمرا الفاضية.

**الحل:** `enrichWithLogos` بيحقن **الخاصيتين معاً**:

```typescript
// src/lib/logo-helper.ts + src/lib/db-manager.ts::enrichWithUnifiedLogos
record['logo_url'] = logo;  // snake_case
record['logoUrl']   = logo;  // camelCase
```

ده بيخلّي أي component بيقرأ أي casing يلاقي الأيقونة. الـ `logo-helper.ts` دلوقتي بـ delegate لـ `DbManager.getUnifiedLogos()` (backward-compat).

### 4.2 StockIcon / StockIconMini

> **الملف:** `src/modules/stock-analysis/components/StockIcon.tsx`

| المكوّن | الاستخدام | الـ fallback |
|---------|---------|-------------|
| `StockIcon` | أيقونة كبيرة (size: sm/md/lg) | دايرة بحرفين الـ ticker + sector emoji |
| `StockIconMini` | أيقونة صغيرة لصفوف الجداول (w-6 h-6) | دايرة whale-color بأول حرفين |

**أولوية عرض الأيقونة:**
1. API-provided `logoUrl` (highest priority — لو http URL)
2. Local SVG: `/public/stock-icons/{ticker}.svg` (لو في `KNOWN_ICONS`)
3. TradingView CDN: `https://s3-symbol-logo.tradingview.com/{ticker}--big.svg`
4. fallback badge (حرفين الـ ticker)

الـ StockIcon بيدعم `logoUrl` + `logo_url` معاً (ALPHA-FIX Task 3) — بيتفادى casing mismatch جوّه الـ component نفسه.

---

## 5. الـ Modules الرئيسية

### 5.1 `radar` — رادار السيولة والفحص الحي

> **11 tsx** — Canonical home for the liquidity radar.

| المكوّن | الوصف | الـ API |
|---------|------|---------|
| **`IncubatorSection`** | خلية فحص الأسهم — **3-zone layout**: (A) status bar + (B) candidate list + (C) analysis panel. Auto-advance كل 4 ثواني (يوقف عند user interaction). Real sparkline من `/api/stocks/sparkline`. بيتعرض في `#incubator` (standalone) و جوّه `PersonaTab`. | `/api/incubator?market=EGX` + `/api/stocks/sparkline` |
| **`CompanyFundamentalsCard`** | بيانات الشركة المالية من **8 تبويبات**: valuation, profitability, balance_sheet, income_statement, cash_flow, dividends, performance, technical_analysis. بيستعمل `getCompanyFundamentals` من DAL. | `/api/stocks/{ticker}/fundamentals` |
| `ExitRadarTab` | رادار الخروج — 5 exit paths (X1 distribution / X2 volume_divergence / X3 resistance_rejection / X4 exhaustion_gap / X5 kill_switch). | `/api/maker-radar/exit-radar?market=EGX` |
| `MultiMarketRadarTab` | رادار متعدد الأسواق | `/api/v2/liquidity-radar?market=…` |
| `PersonalizedRadarTab` | رادار شخصي (based on user profile) | `/api/personalized/radar` |
| `AccuracyDashboard` | لوحة دقة الرادار التاريخية | `/api/radar/accuracy` |
| `SignalTrackingTimeline` | تتبّع الإشارات timeline | `/api/radar/signals` |
| `SignalStrengthMeter` | مقياس قوة الإشارة | inline |
| `WeeklyReportTab` | تقرير أسبوعي للرادار | `/api/radar/weekly-report` |
| `NetPicksTab` | لقطات صافية | `/api/radar/net-picks` |
| `RadarStatsCards` | 4 بطاقات إحصائية (RadarSignalStatsCard, SectorTreemapCard, EntryTimingCard, LiquidityFootprintCard) | inline |

**الـ lib:**
- `radar-signal-tracker.ts` — تتبّع الإشارات persistent.
- `radar-cache.ts` — كاش layer للرادار.
- `radar-db.ts` — DAL access للرادار (بيستعمل `DbManager.openDb`).

### 5.2 `market-analysis` — تحليل السوق + Persona

> **44 tsx** — أكبر module بعد admin.

| المكوّن الرئيسي | الوصف | الـ API |
|-----------------|------|---------|
| **`PersonaTableView`** | جدول التوصيات بـ **3 شخصيات**: `conservative` (المستثمر، أفق 6-12 شهر) / `balanced` (المتوازن، 2-6 أسبوع) / `gambler` (المضارب، 1-5 يوم). جدول 13 عمود. فيه DEDUP + ANOMALY FILTER (انحراف >10% عن سعر الدخول → إخفاء). Stage filter chips: 🛡️ نهاية تصحيح / ⚡ بداية انطلاق / 💎 تجميع قيعان / ⏳ جاري التصحيح. | `/api/v2/recommend` + `/api/stored-analysis/results` + `/api/stocks/{ticker}` |
| `PersonaTab` | container للـ persona (render-only — fetches في `usePersonaTabData`). 4 view branches: image / cards / table / text. | نفسه |
| `PersonaCard` | بطاقة سهم للـ persona (image view) | inline |
| `MarketAnalysisView` | شاشة التحليل الموحّدة (بتخدم EGX + crypto) | `/api/v2/recommend` |
| `TradingChartView` | شارت تفاعلي (PremiumChart بـ 10 أدوات) | `/api/v2/chart/full-analysis` |
| `HistoricalTradesTable` | الصفقات التاريخية | `/api/historical-trades` |
| `SingleStockAnalysisView` | تحليل سهم منفرد (ExecutiveSummary + InsightCards + AdvancedBreakdown + ChartContent) | `/api/stocks/{ticker}` |
| `SectorLiquidityTreemap` | Treemap للسيولة القطاعية | `/api/v2/liquidity-radar` |
| `InstitutionalDecisionPanel` | لوحة القرار المؤسسي | `/api/v2/liquidity-radar` |
| `CanonicalWhoIsBuyingBanner` | بانر "مين بـ يشتري" (canonical) | inline |
| `MarketStatusTab` | تبويب حالة السوق | inline |
| `LearnedLessonsDashboard` | لوحة الدروس المستفادة | `/api/learned-lessons` |

**الـ lib:**
- `lifecycle.ts` — تصنيف طور حياة السهم (تجميع/تصاعد/توزيع/تخفيض).
- `sector-map.ts` — خريطة القطاعات.
- `signals.ts` — helpers للإشارات (بتستعمل `canonical-signal`).

### 5.3 `predictions` — التوقعات

> **22 tsx** — تتبّع التوقعات + prediction-dashboard + maker-radar.

| المكوّن | الوصف | الـ API |
|---------|------|---------|
| `PredictionTrackingView` | شاشة تتبّع التوقعات الرئيسية | `/api/predictions/honest-tracking` |
| `PredictionTrackingDashboard` | dashboard كامل (KpiCards + DailyPicksPanel + CumulativeProfitChart + PersonaCards + ProofModal) | نفسه |
| `DualTrackPredictionsView` | توقعات مزدوجة | `/api/predictions/daily-picks` |
| `MakerRadarTab` | رادار الميكرز + sector heat strip | `/api/maker-radar/scan` |

### 5.4 `portfolio` — المحفظة

> **20 tsx** — محفظة متعددة الأصول.

| المكوّن | الوصف | الـ API |
|---------|------|---------|
| `EnhancedPortfolioView` | المحفظة الموحّدة (5 تبويبات: Assets / Reports / IncomeExpense / Obligations / WealthAllocation) | `/api/portfolio/*` |
| `AdvancedPortfolioManager` | محفظة متقدمة | `/api/portfolio/master` |
| **`BagHolderRescuePanel`** | إنقاذ السهم الخسران (Task 31-C) | `/api/portfolio/rescue` |
| `MasterPortfolioSummary` | ملخص المحفظة | `/api/portfolio/master` |
| `PortfolioIntelligencePanel` | لوحة ذكاء المحفظة | نفسه |
| `RealReturnPanel` | العائد الحقيقي (معدّل بالتضخم) | نفسه |
| `SmartAssistantPanel` | مساعد ذكي للمحفظة | `/api/smart-assistant` |
| `RoboAdvisorPanel` | مستشار روبوت | `/api/robo-advisor` |
| `RiskProfilerQuiz` | اختبار تحمّل المخاطر | inline |
| `TopUpRecommendationsPanel` | توصيات زيادة المراكز | `/api/portfolio/top-up` |
| `StockSearchDropdown` | بحث سهم لإضافته | `/api/stocks/search` |
| `MultiPortfolioSelector` | selector متعدد المحافظ | `/api/portfolio/list` |

### 5.5 `stock-analysis` — شاشة الأسهم

> **28 tsx** — شاشة الأسهم الرئيسية + شارت + تفاصيل.

| المكوّن | الوصف | الـ API |
|---------|------|---------|
| `StocksView` | شاشة الأسهم الموحّدة (بتخدم EGX + crypto via `currentMarket`) | `/api/stocks/*` |
| `stocks-view/*` | sub-components: StockCard, StocksTable, MobileStocksList, AdvancedFilters, PresetButtonsRow, OverviewSummary, Skeletons, useStocksViewState | نفسه |
| `TradingViewChart` | شارت TradingView بـ overlay-config + series-config + indicators | `/api/v2/chart/full-analysis` |
| `StockDetail` | تفاصيل سهم (cards + flow-score + sub-components) | `/api/stocks/{ticker}` |
| `StockAdvancedAnalysisView` | تحليل متقدم | نفسه |
| `GateAnalysisView` | تحليل البوابات | `/api/stocks/{ticker}/gate` |
| `DeltaVolumeBar` | شريط حجم الدلتا | inline |
| `MarketDepthPanel` | لوحة عمق السوق | `/api/stocks/{ticker}/depth` |
| `StockSelector` | selector سهم | `/api/stocks/search` |
| `ComprehensiveStockAnalysis` | تحليل شامل | نفسه |
| `DeepAnalysis` | تحليل عميق | نفسه |
| `ExpertAnalysisPanel` | لوحة تحليل خبراء | `/api/expert-analysis` |
| `TreasuryBondsView` | شاشة سندات الخزانة | `/api/bonds/*` |
| `CalculationBreakdown` | تفكيك الحسابات (display only — الحسابات في backend) | inline |
| `StockNews` | أخبار سهم | `/api/news?tickers=…` |

### 5.6 `dashboard` — لوحة التحكم الرئيسية

> **25 tsx** — 25 widget موزّعة (PinnableWidget registry — Rule 52).

| المكوّن | الوصف | الـ API |
|---------|------|---------|
| `DashboardView` | container (631 LOC) — بيرص الـ widgets | multiple |
| `MarketSummary` | ملخص السوق | `/api/market/summary` |
| `IndexCards` | بطاقات المؤشرات (EGX30/70/100/33) | `/api/indices/*` |
| `TopMovers` | أعلى المتحركين | `/api/market/movers` |
| `MarketSentiment` | معنويات السوق | `/api/market/sentiment` |
| `MarketPulseWidget` | نبض السوق | `/api/market/pulse` |
| `InvestorsFlowPanel` | تدفّق المستثمرين (أجانب/عرب/مصريين) — EGX only | `/api/investors/flow` |
| `LiquidityFlowPanel` | لوحة حركة السيولة | `/api/liquidity/flow` |
| `IntradayPressurePanel` | ضغط الجلسة اللحظي | `/api/intraday/pressure` |
| `MyStocksBriefing` | الـ widget الشخصي (محفظة + توقعات + أخبار) | `/api/portfolio/unified-watch` |
| `LiveStockTicker` | شريط أسعار لحظي | WebSocket |
| `LiveMonitor` | المراقبة الحية | WebSocket |
| `MultiMarketWidget` | عملات + ذهب + أسهم عالمية | `/api/multi-market` |
| `SovereignMetalsDesk` | مكتب الذهب والعملات المستقل | `/api/sovereign-metals` |
| `CryptoSignalsWidget` | إشارات كريبتو | `/api/crypto/signals` |
| `SeasonalitySignalsWidget` | إشارات موسمية | `/api/seasonality` |
| `OpportunityCalculatorWidget` | حاسبة الفرص | `/api/opportunity` |
| `TrackRecordWidget` | سجل النجاحات | `/api/track-record` |
| `PriorityNotificationsWidget` | تنبيهات ذات أولوية | `/api/notifications/priority` |
| `SafeWidget` | wrapper بيـ isolate الـ errors (error boundary لكل widget) | inline |
| `PinnableWidget` | wrapper بيخلّي الـ widget pinnable | inline |

### 5.7 `admin` — لوحة الأدمن

> **104 tsx** — أكبر module (5 hubs × 18 tab + db-manager + engine-control + telegram).

| المكوّن الرئيسي | الوصف |
|-----------------|------|
| `AdminView` | container رئيسي (5 hubs: مراقبة / محركات / بيانات / مستخدمين / تسويق) |
| `admin-view/AdminHeader` + `AdminNav` + `QuickAccessBar` | layout |
| `DashboardTab` + `SystemMonitorPanel` + `SystemHealthCard` | المراقبة |
| `EngineControlRoomTab` + `engine-control/*` | غرفة التحكم بالمحركات (6 deep-views: DataEngine / Cron / Sharia / Predictions / News / Console) |
| `EngineSettingsTab` + `SuperLearningSystem` + `super-learning/*` | إعدادات المحركات + AI learning (6 tabs: AI / Config / Results / Parameters / PredictionsEngine / PersonaBenchmark) |
| `DataHealthTab` + `DataScraperControl` + `ValidationMonitorTab` + `SourceAuthorityTab` | جودة البيانات |
| `DatabaseManagerFull` + `db-manager/*` | مدير قواعد البيانات (Overview + Tables + SQL Console + Maintenance + Backups + Recovery) |
| `UsersManagement` + `users-mgmt/*` + `users-management/*` | إدارة المستخدمين (filters + dialogs + list card) |
| `MarketingStudio` + `ContentStudioHub` + `MarketingHub` | استوديو التسويق |
| `TelegramTab` + `telegram-tab/*` | تكامل تليجرام (Auth + Chats + Dialogs + Search + Members + LegacyBot) |
| `NewsManagementTab` + `NewsHealthTab` + `CronHealthTab` | إدارة الأخبار + الـ cron |
| `PricingEditorTab` + `PromoCodesAdmin` + `SubscriptionView` | التسعير + الاكواد الترويجية |
| `ShariaManagementTab` | إدارة التوافق الشرعي |
| `BacktestTab` | لوحة الـ Backtest |
| `WealthCharts` | رسوم الثروة (shipped in page.tsx as `#wealth`) |
| `VideoEditor` | محرر فيديو للتسويق |
| `InvestorsDataEntryTab` | إدخال بيانات المستثمرين |
| `SystemControlPanel` + `SystemProblemsTab` | تحكم + مشاكل النظام |
| `RegimeDetectionWidget` | widget كشف الـ regime |
| `DbBackupPanel` + `ProcessResourceHistory` + `ResourceAlerts` + `ResourceHistoryChart` | نسخ احتياطي + موارد |
| `PurgeCacheButton` | زر مسح الكاش |
| `PlatformPerformanceView` | منصة الأداء |
| `TelegramPredictionsTab` | توقعات تليجرام |

### 5.8 باقي الـ modules (مختصر)

| Module | المكوّنات الرئيسية | الـ API |
|--------|---------------------|---------|
| `auth` | `DevLoginForm` (login تطوير) | NextAuth |
| `crypto` | `CryptoPortfolioView` + `CryptoPredictionTrackingView` | `/api/crypto/*` |
| `education` | `AcademyView` + `AcademyEncyclopedia` (lessons + quiz + diagrams) + `StrategySandbox` (TA + SMC + FA charts) + `PaperTradingWorkstation` (OpenPositions + OrderExecution + HistoryAndPerformance) + `MathRenderer` + `EntryTimingSimulator` + `CandlestickSimulator` + `PortfolioSimulator` | static + `/api/paper-trading/*` |
| `index-detail` | `IndexDetailView` (IndexHeaderBar + IndexPriceChart + ConstituentEffectBreakdown + TopMoversList) — EGX30/70/100/33 | `/api/indices/{symbol}/history` + `/api/indices/{symbol}/breakdown` |
| `news` | `NewsFeedView` (أخبار مفلترة بالـ tickers) | `/api/news?tickers=…` |
| `personalized` | **lib only** — `personalized-radar.ts` (buildUserProfile من portfolio + watchlist + trade history + preferred tickers → sectors / risk / holding period / price range / markets / win rate) | `/api/personalized/*` |
| `publishing` | `StockPublisher` + `StockInfographicCard` + `StockInfographicModal` + `TradeResultsGenerator` + `TradeResultsTemplates` (Daily/Weekly/Monthly) + `UnifiedPublishButton` + `ShareButton` | `/api/publishing/*` |
| `reports` | `ReportsView` + `ExecutiveReportView` (KpiCard + HighlightCard + MissedOppCard + PersonaCard + FiltersToolbar + ControlBar + ReportBody) + `DailyMarketReport` + `StockAnalysisReport` + `DataManager` | `/api/reports/*` |
| `screener` | `StockScreenerAdvanced` (AdvancedFiltersTab + TopPerformersTab + ExportDropdown + KPIBox + StateBadge + CollapsibleSection + screenerColumns + topPerformerColumns) | `/api/screener/advanced` (Python proxy via DbManager) |
| `sharia` | `ShariaView` (ShariaStocksListTab + ShariaStockDetailModal + ShariaStockRowCard + PortfolioPurificationCalculator + SingleTradePurificationCalculator + ShariaBadge + ShariaStockCard) — 253 سهماً شرعياً | `/api/sharia/*` |
| `simulation` | `SimulationView` (useSimulationEngine + ReportSection + tabs + dialogs + columns) — محاكاة تداول لكل الأسواق | client-only |
| `subscription` | `PricingView` + `TrialCountdownBanner` + `TrialExpiredModal` | `/api/subscription/*` |

---

## 6. المكوّنات الحرجة (Deep Dive)

### 6.1 `IncubatorSection` — خلية فحص الأسهم

> **الملف:** `src/modules/radar/components/IncubatorSection.tsx` (1,284 LOC)
> **الشاشة:** `#incubator` (standalone) + tab جوّه `PersonaTab`.

**الـ 3-zone layout:**

```
┌─────────────────────────────────────────────────┐
│ Zone A: Status Bar                              │
│  - is_fresh indicator (أحمر/أخضر)               │
│  - total_candidates + timestamp                 │
│  - refresh + auto-advance controls              │
├─────────────────────────────────────────────────┤
│ Zone B: Candidate List  │ Zone C: Analysis     │
│  - ticker + logo        │  Panel                │
│  - readiness_pct bar    │  - sparkline (real)   │
│  - stage badge          │  - passed_reasons[]   │
│  - trigger type icon    │  - trigger{} info     │
│                         │  - target + stop      │
│                         │  - risk_reward        │
└─────────────────────────┴───────────────────────┘
```

**الميزات:**
- Auto-advance كل 4 ثواني (يوقف عند user interaction).
- Real sparkline من `/api/stocks/sparkline` (بيستعمل `DbManager.getLiveSparkline`).
- Condition panel من real `passed_reasons[]` + `trigger{}` — **no fabrication** (Rule 27).
- بـ يحترم `prefers-reduced-motion`.
- 3 view modes: `panel` (default) / `grid` / `table`.

**الـ API:** `GET /api/incubator?market=EGX` → `DbManager.getIncubatorData(market)`.

**الـ props:**
```typescript
interface IncubatorSectionProps {
  market?: string;          // default 'EGX'
  refreshIntervalMs?: number;
  maxDisplay?: number;      // 0 = no limit
  className?: string;
  defaultViewMode?: 'panel' | 'grid' | 'table';
  autoAdvanceMs?: number;   // 0 = disabled, default 4000
}
```

### 6.2 `CompanyFundamentalsCard` — 8 تبويبات مالية

> **الملف:** `src/modules/radar/components/CompanyFundamentalsCard.tsx` (254 LOC)

**التبويبات الـ 8:**

| # | tab key | الـ label | الحقول |
|---|---------|----------|--------|
| 1 | `tab_valuation` | التقييم | P/E, P/B, P/S, Market Cap, EV/EBITDA, EPS, Dividend Yield |
| 2 | `tab_profitability` | الربحية | ROE, ROA, Net Margin, Gross Margin, Operating Margin |
| 3 | `tab_balance_sheet` | المركز المالي | Total Cash, Total Debt, Total Equity, Total Assets, D/E, Current Ratio, BVPS |
| 4 | `tab_income_statement` | قائمة الدخل | Revenue, Net Income, EPS, Gross Margin, Net Margin, P/E |
| 5 | `tab_cash_flow` | التدفقات النقدية | Operating CF, Investing CF, FCF, DPS |
| 6 | `tab_dividends` | التوزيعات | Dividend Yield, DPS TTM, Payout Ratio |
| 7 | `tab_performance` | الأداء | 52w High/Low, Change %, Volume, Avg Volume, Cash Traded, Rel Vol 10d, Beta |
| 8 | `tab_technical_analysis` | التحليل الفني | RSI, MACD, MACD Signal, SMA20/50/200, EMA20, ATR, Support, Resistance, Trend, Signal |

**الـ API:** `GET /api/stocks/{ticker}/fundamentals` → `DbManager.getCompanyFundamentals(ticker)`.

**القاعدة:** الـ card بيعرض فقط — كل القيم من `stocks.db.stocks` (66 عمود من TradingView Scanner) + fallback من `data_engine.db.tab_*` (8 tables). **مفيش أي حسابات في الـ frontend.**

### 6.3 `PersonaTableView` — جدول التوصيات (3 شخصيات)

> **الملف:** `src/modules/market-analysis/components/persona/PersonaTableView.tsx` (414 LOC)

**الـ 3 شخصيات:**

| Persona | الـ label | الأفق | الـ backend key |
|---------|----------|------|-----------------|
| `conservative` | المستثمر | 6-12 شهر | `investor` |
| `balanced` | المتوازن | 2-6 أسبوع | `gambler` (approximation — مفيش `balanced` في الـ backend) |
| `gambler` | المضارب | 1-5 يوم | `gambler` |

**الأعمدة الـ 13:**
```
# / السهم / المرحلة / الاسم / السعر وقت التحليل / أعلى-أقل /
التقييم / النتيجة / الدخول / الهدف / الوقف / R/R / أفق الاستثمار / السبب
```

**الحمايات:**
- **DEDUP:** منع تكرار نفس السهم (keep first occurrence only).
- **ANOMALY FILTER:** لو `abs(current - entry) / current > 0.10` → إخفاء الصف (safety net client-side + backend-side).
- **Stage filter chips:** 🛡️ نهاية تصحيح / ⚡ بداية انطلاق / 💎 تجميع قيعان / ⏳ جاري التصحيح.
- **PRICE INVARIANT GUARD:** بـ يـ flag الصفوف اللي stopped-out / target-hit / stale.

**الـ API:** `/api/v2/recommend` + `/api/stored-analysis/results` + `/api/stocks/{ticker}`.

### 6.4 `ExitSignalBadge` — شارة إشارات الخروج

> **الملف:** `src/components/shared/ExitSignalBadge.tsx` (425 LOC)
> **الحالة:** معزول ومش مفعّل (UI only — Alpha scope).

**3 حالات إشارة:**

| Signal | اللون | الأيقونة | الـ label |
|--------|------|---------|----------|
| `EXIT` | أحمر (`loss`) | `DoorOpen` | خروج |
| `TAKE_PROFIT` | أخضر (`profit`) | `Target` | جني أرباح |
| `CAUTION` | كهرماني (`warning`) | `AlertTriangle` | تحذير |

**العقد (per owner directive 2026-10-27):**
```typescript
interface ExitSignalData {
  signal?: 'EXIT' | 'TAKE_PROFIT' | 'CAUTION' | null;
  action_ar?: string | null;
  reasons?: { code: string; text: string; evidence?: object }[] | null;
  trailing_stop?: number | null;
  reference_price?: number | null;
  data_timestamp?: string | null;
  status?: 'CONFIRMED' | 'STALE' | 'INSUFFICIENT_DATA' | 'PENDING' | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  position_state?: 'OPEN' | 'CLOSED' | 'NONE' | null;
  ruleset_version?: string | null;
  fixture?: boolean;  // TEST FIXTURE flag
}
```

**ملاحظات:**
- KEY: `TAKE_PROFIT` **لا يلغي** `EXIT` تلقائياً — دول حدثين مستقلين.
- فيه helper functions: `parseExitSignalFromPrediction` + `parseExitSignalFromRadarStock`.
- المكوّن معزول + مش مفعّل في الـ UI دلوقتي (Alpha scope — بيتستنى تفعيل الـ backend).

---

## 7. الـ Canonical Libraries

### 7.1 `canonical-rsi.ts` — حساب RSI (Wilder)

> **الملف:** `src/lib/canonical-rsi.ts` (146 LOC)
> **القاعدة 67 (CALCULATION-CANONICAL):** port مطابق لـ `vps-service/analyzers/indicators/rsi.py::calc_rsi()`.

**الدوال:**

| الدالة | الاستخدام |
|--------|---------|
| `computeRSI(closes, period=14)` | آخر قيمة RSI (0-100) أو null |
| `computeRSISeries(closes, period=14)` | سلسلة RSI كاملة للـ chart rendering |
| `classifyRSIState(rsi)` | تصنيف الحالة: تشبع شرائي (≥70) / إيجابي (55-70) / محايد (45-55) / سلبي (30-45) / تشبع بيعي (<30) |

**الخوارزمية:** Wilder's smoothing (مش SMA بسيط):
```
avgGain[i] = (avgGain[i-1] * (period-1) + gains[i]) / period
avgLoss[i] = (avgLoss[i-1] * (period-1) + losses[i]) / period
RS  = avgGain / avgLoss
RSI = 100 - 100 / (1 + RS)
```

**القاعدة:** الـ file ده client-safe (مفيش imports لـ better-sqlite3). أي component يقدر يستورده بدون ما يكسر الـ SSR.

### 7.2 `canonical-signal.ts` — تصنيف الإشارات

> **الملف:** `src/lib/canonical-signal.ts` (272 LOC)
> **المرجع:** `download/UNIFIED_DATA_CONTRACT.md`

**الدوال:**

| الدالة | الاستخدام | الـ thresholds |
|--------|---------|----------------|
| `classifySignal(masterScore)` | master_score → STRONG_BUY/BUY/ACCUMULATE/HOLD/SELL/STRONG_SELL | ≥78 STRONG_BUY / ≥65 BUY / ≥55 ACCUMULATE / ≥40 HOLD / ≥25 SELL / <25 STRONG_SELL |
| `signalAr(signal)` | ترجمة عربية | شراء قوي / شراء / تجميع / انتظار / تخفيض / بيع / بيع قوي |
| `classifyAccumulation(buyPct)` | buy_pct → تجميع/تصريف label | ≥70 تجميع قوي / ≥60 تجميع / ≥55 تجميع خفيف / ≥45 محايد / ≥40 تصريف خفيف / ≥30 تصريف / <30 تصريف قوي |
| `classifyMoneyFlow(buyPct, sellPct, netFlowEgp?, phase?)` | buy+sell → emoji label | 🟢 سيولة داخلة قوية / 🟢 داخلة / 🟡 متوازنة / 🔴 خارجة / 🔴 خارجة قوية / 🔴 ضغط بيعي قوي |
| `classifyVolumeRatio(entryVol, avgVol20d)` | ratio (capped at 50) أو null | — |
| `classifyStockPhase(buyPct, roc10d)` | طور حياة السهم | تجميع / تصاعد / توزيع / تخفيض / محايد |

**Consistency Gate (BRAVO-QUANT-RESCUE-SMART-FLOW-V2):**
- لو `net_flow < 0` أو `buy_pct < 40%` أو `phase = 'تخفيض'` → تصنيف إلزامي: 🔴 سيولة خارجة قوية / 🔴 ضغط بيعي.
- منطقة 40-45%: سيولة متوازنة فقط (لا "داخلة" بعد).

**Falling Knife Guard (BRAVO-P0-QUANT-LOGIC-NO-FALLING-KNIFE):**
- لو `roc10d < -3` و `buy_pct < 50` → الطور حصرياً "تخفيض / هبوط مستمر".

**Self-test:** فيه `assert` block في آخر الملف — يشتغل بـ `npx tsx src/lib/canonical-signal.ts`.

---

## 8. القواعد الحاكمة (Rules)

| # | القاعدة | التطبيق |
|---|---------|---------|
| 27 | **NO-FAKE-DATA** | لو مفيش بيانات → empty `source: 'none'` (مش اختلاق) |
| 27 | **DAL-ONLY** | ممنوع `new Database()` أو `SELECT` في أي route/component — كل القراءات عبر `DbManager` |
| 67 | **CALCULATION-CANONICAL** | كل المقاييس الفنية من `canonical-rsi.ts` + `canonical-signal.ts` (مش حسابات مكررة) |
| 28 | **NO-DUPLICATION** | `VALID_VIEWS` مصدر واحد لكل الـ routes |
| 4 | **NO-NEW-SCREENS** | ما عملناش routes جديدة — بس cases في الـ switch |
| 52 | **PINNABLE-WIDGET** | كل widgets الـ dashboard في `PinnableWidget` registry |
| 20 | **NO-CALC-IN-FRONTEND** | كل الأرقام من الـ backend — الـ frontend بيعرض فقط |

---

## 9. الـ UI-Mirror Protocol (Crypto Unification)

> **القاعدة:** الكريبتو بيستعمل **نفس** components اللي بيستعملها EGX. الفرق الوحيد هو `currentMarket === 'CRYPTO'` في الـ store.

| Route القديم | الـ redirect | الـ Component |
|--------------|-------------|---------------|
| `#crypto` | → `#dashboard` | `DashboardView` |
| `#crypto-live` | → `#stocks` | `StocksView` |
| `#crypto-recommendations` | → `#recommendations` | `MarketAnalysisView` |
| `#crypto-trading-chart` | → `#trading-chart` | `TradingChartView` |
| `#crypto-screener` | → `#stock-filters` | `StockScreenerAdvanced` |
| `#crypto-analysis` | → `#smart-confluence` | `SmartConfluenceView` |
| `#crypto-learning` | → `#academy` | `AcademyView` |
| `#crypto-simulation` | → `#simulation` | `SimulationView` |

`useEffect` في `AppShell` بيـ detect `isCryptoView(currentView)` وبيـ set `setCurrentMarket('CRYPTO')` تلقائياً.

---

## 10. ملاحظات للمطوّرين

1. **لإضافة شاشة جديدة:** أضف case في `page.tsx` switch + أضف الـ route في `VALID_VIEWS` (`src/lib/valid-views.ts`). **لا تنشئ `pages/` route جديد.**
2. **لإضافة widget للـ dashboard:** استعمل `PinnableWidget` wrapper + سجّل الـ widget في الـ registry.
3. **لقراءة DB:** استدعِ `DbManager.openDb('stocks.db')` — **ممنوع** `new Database()`.
4. **لحساب RSI/Signal:** استورد من `canonical-rsi.ts` / `canonical-signal.ts` — **ممنوع** تكرار الحساب.
5. **لعرض أيقونة سهم:** استعمل `StockIcon` / `StockIconMini` — بيدعم `logoUrl` + `logo_url` تلقائياً.
6. **لإضافة تبويب مالي جديد:** عدّل `getCompanyFundamentals` في `db-manager.ts` + حدّث `CompanyFundamentalsCard`.
7. **لاختيار persona:** استعمل `normalizePersona()` + `personaToAnalysisJsonKey()` من `src/lib/persona-config.ts`.

---

## 11. الـ Index السريع (Quick Reference)

```
src/
├── app/
│   ├── page.tsx                              ← الشاشة الرئيسية (1,200+ LOC, 40+ case)
│   └── api/
│       └── stocks/sparkline/route.ts         ← thin wrapper لـ DbManager.getLiveSparkline
├── lib/
│   ├── db-manager.ts                         ← DAL (DbManager namespace)
│   ├── logo-helper.ts                        ← enrichWithLogos (logo_url + logoUrl)
│   ├── stock-icon.ts                         ← getStockIconUrl + getSectorIcon
│   ├── canonical-rsi.ts                      ← computeRSI (Wilder) + classifyRSIState
│   ├── canonical-signal.ts                   ← classifySignal + classifyAccumulation + classifyMoneyFlow
│   ├── persona-config.ts                     ← 3 personas (conservative/balanced/gambler)
│   └── valid-views.ts                        ← VALID_VIEWS + CRYPTO_VIEW_REDIRECTS
└── modules/
    ├── admin/        (104 tsx) ← 5 hubs × 18 tab + db-manager + engine-control + telegram
    ├── market-analysis/ (44 tsx) ← PersonaTableView + MarketAnalysisView + TradingChartView
    ├── education/    (37 tsx) ← AcademyView + AcademyEncyclopedia + StrategySandbox + PaperTradingWorkstation
    ├── stock-analysis/ (28 tsx) ← StocksView + TradingViewChart + StockDetail + StockIcon
    ├── dashboard/    (25 tsx) ← DashboardView + 20+ widgets (PinnableWidget)
    ├── predictions/  (22 tsx) ← PredictionTrackingView + DualTrackPredictionsView + MakerRadarTab
    ├── portfolio/    (20 tsx) ← EnhancedPortfolioView + BagHolderRescuePanel + RoboAdvisorPanel
    ├── reports/      (13 tsx) ← ReportsView + ExecutiveReportView
    ├── publishing/   (12 tsx) ← StockPublisher + TradeResultsTemplates + UnifiedPublishButton
    ├── radar/        (11 tsx) ← IncubatorSection + CompanyFundamentalsCard + ExitRadarTab
    ├── screener/     (11 tsx) ← StockScreenerAdvanced (screener-advanced/*)
    ├── sharia/       (10 tsx) ← ShariaView + PortfolioPurificationCalculator
    ├── simulation/   (6 tsx)  ← SimulationView (useSimulationEngine)
    ├── subscription/ (3 tsx)  ← PricingView + TrialCountdownBanner + TrialExpiredModal
    ├── crypto/       (2 tsx)  ← CryptoPortfolioView + CryptoPredictionTrackingView
    ├── auth/         (1 tsx)  ← DevLoginForm
    ├── index-detail/ (1 tsx)  ← IndexDetailView (EGX30/70/100/33)
    ├── news/         (1 tsx)  ← NewsFeedView
    └── personalized/ (0 tsx)  ← lib only (personalized-radar.ts)

src/components/shared/
└── ExitSignalBadge.tsx                       ← معزول، مش مفعّل (Alpha scope)
```

---

**نهاية التوثيق.** للتفاصيل الأعمق راجع:
- `Documentation/02-API-DICTIONARY.md` — قاموس الـ APIs.
- `Documentation/03-ENGINES-AND-LOGIC.md` — المحركات ومنطقها.
- `Documentation/05-DATA-ACCESS-LAYER-PLAN.md` — خطة الـ DAL.
