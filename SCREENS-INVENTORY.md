# SCREENS INVENTORY — GLMinvestment (Next.js 14.2.28)

> **Task ID:** SCREENS-MAP-1
> **Author:** Explore sub-agent (for Alpha — frontend dragon)
> **Methodology:** Read `src/app/page.tsx` (1028 LOC) + `src/lib/valid-views.ts` + `src/components/layout/TopBar.tsx`, then walked every `case` branch and inspected each view component for tabs + dialogs.

## How navigation works

1. **AppShell** (`src/app/page.tsx`) is the single Next.js route — `/`.
2. **Hash routing**: `currentView` lives in the zustand store. `window.location.hash = view` is set on every nav click. `UrlHashSync` reads the hash on mount + on `popstate`/`hashchange` and calls `setCurrentViewFromHash`.
3. **TopBar** (`src/components/layout/TopBar.tsx`) renders 5 dropdown sections (الرئيسية / السوق / التوقعات / أموالي / المزيد) using `navSections: NavSection[]`.
4. **MobileNav** (`src/components/layout/MobileNav.tsx`) renders the same items for mobile.
5. **renderView()** is a `switch(currentView)` with **58 explicit case branches** (incl. 2-case aliases like `'stocks' | 'stock-detail'`) + 1 default that returns `<DashboardView />`.
6. **AuthGate**: unauthenticated users see `AuthView` instead of AppShell (except `?dev=1` → `DevLoginForm`, or `?bot_link=TOKEN` → AuthView inside a wrapper).
7. **Admin** has no top-level menu link — reachable via `#admin` hash + role-check inside `AdminView`.

---

# Root Menu (5 TopBar sections)

## 🏠 1. الرئيسية (Home)

### Dashboard
- **File:** `src/modules/dashboard/components/DashboardView.tsx` (591 LOC)
- **Type:** Main View (TopBar "Home" → "نظرة عامة")
- **Parent:** Root (menu)
- **Hash:** `#dashboard` (also `#crypto` → same component with `currentMarket='CRYPTO'`)
- **Function:** Default landing page — market overview + personal briefing.
- **Description:** Renders `MarketSummary`, `IndexCards`, `TopMovers`, `MarketSentiment`, `CryptoSignalsWidget`, `SeasonalitySignalsWidget`, `EidPredictionsWidget`, `AutoAnalysisWidget`, `LiveStockTicker`, `MarketPulseWidget`, `LiveMonitor`, `MyStocksBriefing`, `AssetPreferenceOnboarding` (Dialog), `PinnableWidget`. NO internal shadcn tabs (uses grid layout).
- **Dialog:** `AssetPreferenceOnboarding` (first-visit onboarding survey)
- **Used:** ✅ (in TopBar "Home")

---

## 📊 2. السوق (Market)

### Stocks View
- **File:** `src/modules/stock-analysis/components/StocksView.tsx` (2306 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#stocks` / `#stock-detail` / `#crypto-live` (unified with CRYPTO market)
- **Function:** Unified stock/crypto table view + detail drill-down.
- **Description:** Big unified table (UnifiedTable) with search, sector filter, index preset filter (EGX30/70/100/…), price-range filter, change filter. Has an inline **button-based tab switcher** (`stockTab`) with 2 values: `'stocks'` (StocksView) | `'bonds'` (TreasuryBondsView). When `showDetail === true`, renders `<StockDetail />` (full stock report — uses GateAnalysisView, SingleStockAnalysisView, StockAdvancedAnalysisView, DealAdvisorPanel).
- **Tabs (button-based):** `stocks` (الأسهم) · `bonds` (السندات) — bonds only for non-CRYPTO markets
- **Used:** ✅

### Stock Detail (internal alias)
- **File:** `src/modules/stock-analysis/components/StockDetail.tsx`
- **Type:** Sub-view (rendered inside StocksView when `showDetail=true`)
- **Parent:** Stocks View
- **Hash:** `#stock-detail` (alias of `#stocks`)
- **Function:** Deep-dive report for one ticker
- **Description:** Composes `ProfessionalTradingChart`, `GateAnalysisView`, `SingleStockAnalysisView`, `StockAdvancedAnalysisView`, `DealAdvisorPanel`, `InstitutionalDecisionPanel`, `CanonicalWhoIsBuyingBanner`
- **Used:** ✅ (via row-click in StocksView)

### Stock Filters (StockScreenerAdvanced)
- **File:** `src/modules/screener/components/StockScreenerAdvanced.tsx` (2724 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#stock-filters` (also `#top-performers` → same with `initialTab="top-performers"`, and `#crypto-screener` unified)
- **Function:** Advanced Python-backed stock screener + top gainers/losers.
- **Description:** Filters (sector, market cap, P/E, RSI, MA, volume, etc.) — backed by `/api/screener` Python proxy. Has 2 internal shadcn Tabs.
- **Tabs:** `advanced` (الفلاتر المتقدمة) · `top-performers` (أعلى الأرباح/الخسائر)
- **Used:** ✅

### Trading Chart (Interactive)
- **File:** `src/modules/market-analysis/components/TradingChartView.tsx` (310 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#trading-chart` / `#screener` (alias) / `#crypto-trading-chart` (unified)
- **Function:** Multi-column interactive trading chart workstation.
- **Description:** Uses `ProfessionalTradingChart` for each selected ticker. Supports 1- or 2-column layout, add/remove tickers, publish all to Telegram via `UnifiedPublishButton`.
- **Tabs:** None (uses 1|2 column layout switcher)
- **Used:** ✅

### Liquidity Radar
- **File:** `src/components/shared/LiquidityRadarView.tsx` (617 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#liquidity-radar`
- **Function:** Whale / maker flow radar — the most important daily service.
- **Description:** UnifiedTable with 10 columns (ticker, last, change, net flow EGP, whale present, flow strength, buy/sell %, MiniSparkline, publish button, row-click). Click row → `StockDetailDrawer` (Dialog). Uses `LockModal` for trial-gated rows. EGX-only (other markets get a notice).
- **Dialog:** `StockDetailDrawer` (Drawer from MakerRadarTab) · `LockModal`
- **Used:** ✅

### Market Depth
- **File:** `src/app/page.tsx` (inline composite view — case `'market-depth'` at lines 592-634)
- **Type:** Main View (composite — no dedicated file)
- **Parent:** Root (menu)
- **Hash:** `#market-depth`
- **Function:** Standalone "market depth" screen — currencies/gold + investors flow + liquidity + session pressure.
- **Description:** Inline JSX in page.tsx wraps 2 widgets:
  - `MarketDepthMultiMarket` (`src/modules/dashboard/components/MultiMarketWidget.tsx`, 610 LOC) — currencies + gold for all markets.
  - `MarketDepthInvestorsFlow` (`src/modules/dashboard/components/InvestorsFlowPanel.tsx`, 557 LOC) — EGX-only intraday flow. Non-EGX shows an Alert notice.
- **Used:** ✅

---

## 🎯 3. التوقعات (Predictions)

### Recommendations (Market Analysis View)
- **File:** `src/modules/market-analysis/components/MarketAnalysisView.tsx` (298 LOC — thin orchestrator)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#recommendations` / `#analysis` (alias) / `#advanced-analysis` (alias) / `#v2-analysis` (alias) / `#crypto-recommendations` (unified)
- **Function:** Main predictions hub — 5 tabs covering predictions, market status, sector tracking, historical trades, net picks.
- **Tabs (5):**
  - `predictions` — `UnifiedPredictionsTab` (itself has 3 ToggleGroup sub-views: `current`/`performance`/`summary` which render PersonaTab/PredictionTrackingDashboard/ExecutiveReportView)
  - `status` — `MarketStatusTab`
  - `sectors-tracking` — `SectorTrackingTab`
  - `historical-trades` — `HistoricalTradesTable`
  - `net-picks` — `NetPicksTab`
- **Used:** ✅

### Specialist Analysis
- **File:** `src/components/advanced-analysis/SpecialistAnalysisView.tsx` (2915 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#specialist-analysis`
- **Function:** Deep 16-section professional financial report for one stock.
- **Description:** Pulls from `/api/maker-radar/stock`, `/api/maker-radar/footprint`, `/api/predictions?ticker=`. Renders 16 sections: Header Card, Price Summary, 30-Day Candlestick SVG, Liquidity Footprint, Technical Indicators, Fundamentals, Momentum, Prediction History, Recommendation, 52-Week, Flow/Explosive, Comprehensive, Position Sizing Calculator, Price Ladder, Score Dashboard, Disclaimer.
- **Tabs:** None (single-page report)
- **Used:** ✅

### Reports
- **File:** `src/modules/reports/components/ReportsView.tsx` (956 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#reports`
- **Function:** Professional financial reports (Python-backed via `/api/reports/proxy`).
- **Tabs (4):** `daily` (DailyMarketReport) · `stock` (StockAnalysisReport) · `sector` (SectorReport) · `predictions` (PredictionsReport)
- **Description:** Dark navy theme + amber accent + export to PNG / print via `html-to-image` + `window.print()`.
- **Used:** ✅

---

## 💼 4. أموالي (Finance)

### Enhanced Portfolio View (Unified)
- **File:** `src/modules/portfolio/components/EnhancedPortfolioView.tsx` (3362 LOC — largest view)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#portfolio` / `#finance` (alias)
- **Function:** Unified portfolio manager — assets + income/expense + obligations + reports + (merged) Wealth + BagHolder rescue.
- **Tabs (4 shadcn Tabs):** `assets` (الأصول) · `income-expense` (الدخل والمصروفات) · `obligations` (الالتزامات) · `reports` (التقارير)
- **Dialogs (8+):**
  - `addDialogOpen` — add asset (stock/crypto/gold/bank/cert/fund)
  - `editDialogOpen` — edit existing asset
  - `deleteId` — delete confirmation
  - `profilerOpen` — `DynamicRiskProfilerModal` (P39 persona quiz)
  - `paymentDialogOpen` — subscribe-to-continue
  - `addDialogOpen` (×2 more for income/expense + obligations)
- **Sub-components:** `MultiPortfolioSelector`, `MasterPortfolioSummary`, `RealReturnPanel`, `BagHolderRescuePanel`, `TopUpRecommendationsPanel`, `V82DecisionPanel`, `RiskProfilerQuiz`, `RoboAdvisorPanel`
- **Used:** ✅

### Watchlist (Enhanced)
- **File:** `src/components/watchlist/EnhancedWatchlistView.tsx` (1357 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#watchlist` (also `#crypto-watchlist` unified)
- **Function:** User watchlists with add/edit/delete + intelligence section.
- **Dialogs (3):** `AddDialog` (add stock to watchlist) · `EditDialog` (edit item) · `DeleteDialog` (delete confirm)
- **Sub-components:** `WatchlistIntelligenceSection`, `UnifiedPublishButton`, `StockPublisher`
- **Tabs:** None
- **Used:** ✅

### Alerts Center
- **File:** `src/components/alerts/AlertsCenterView.tsx` (690 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#alerts-center`
- **Function:** Unified alerts hub for price / portfolio / market / obligations alerts.
- **Tabs (4):** `price` (تنبيهات الأسعار) · `portfolio` (تنبيهات المحفظة) · `market` (تنبيهات السوق) · `obligations` (تنبيهات الالتزامات)
- **Used:** ✅

### Live Monitor
- **File:** `src/modules/dashboard/components/LiveMonitor.tsx` (1358 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#live-monitor`
- **Function:** Real-time EGX market monitor (10s polling).
- **Description:** Market status + EGX30 + system health + live portfolio + movers. Cairo clock. Manual trigger button (POST `/api/live-monitor/trigger`).
- **Tabs:** None
- **Used:** ✅

### Trading Memory
- **File:** `src/components/memory/TradingMemoryView.tsx` (327 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#trading-memory`
- **Function:** Personal trading patterns memory + expert memory + smart alerts.
- **Description:** Composes `ExpertMemoryPanel`, `PortfolioIntelligencePanel`, `SmartAssistantPanel`, `SmartAlertsPanel`, `ProfessionalWatchlistView`.
- **Tabs:** None (composite)
- **Used:** ✅

---

## ☰ 5. المزيد (More)

### News Feed
- **File:** `src/modules/news/components/NewsFeedView.tsx` (891 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#news`
- **Function:** Financial news feed with sentiment + share.
- **Description:** 2-column layout, sentiment tagging (positive/negative/neutral), share buttons (FB/X/LinkedIn/WhatsApp/Telegram), `UnifiedPublishButton`.
- **Tabs:** None
- **Used:** ✅

### Simulation
- **File:** `src/modules/simulation/components/SimulationView.tsx` (2131 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#simulation` (also `#crypto-simulation` unified)
- **Function:** Trading simulator with virtual money (paper trading).
- **Tabs (5):** `dashboard` (اللوحة) · `trading` (التداول) · `portfolio` (المحفظة) · `transactions` (المعاملات) · `watchlist` (قائمة المتابعة)
- **Dialogs:** `tradeDialogOpen` (Dialog) + `confirmDialogOpen` + `resetDialogOpen` (AlertDialog × 2)
- **Used:** ✅

### Academy
- **File:** `src/modules/education/components/AcademyView.tsx` (2484 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#academy` (also `#crypto-learning` unified — Rule 63 unification)
- **Function:** Education hub — 8 learning pillars in one screen.
- **Tabs (8):**
  - `encyclopedia` — `AcademyEncyclopedia`
  - `paper-trading` — `PaperTradingWorkstation`
  - `candle-sim` — `CandlestickSimulator`
  - `strategy-lab` — `StrategySandbox`
  - `advanced-lessons` — `AdvancedLessonsTab` (inline) — reads `content/education/*.md` (12 institutional lessons)
  - `trading-floor` — Trading floor visuals (LossAversionCurve, SopPipelineFlow, etc.)
  - `practical-tools` — `PortfolioSimulator` + `EntryTimingSimulator`
  - `advanced-lab` — Visual labs (MarketStagesVisual, OrderFlowVisual, etc.)
- **Sheet (1):** `analysis.open` — Sheet for lesson detail
- **Used:** ✅

### Sharia View
- **File:** `src/modules/sharia/components/ShariaView.tsx` (1491 LOC)
- **Type:** Main View (explicit exception to Rule 4 NO-NEW-SCREENS)
- **Parent:** Root (menu)
- **Hash:** `#sharia`
- **Function:** Sharia-compliance screen — 253 EGX stocks + purification calculator.
- **Tabs (3):** `stocks` (الأسهم) · `single` (تطهير صفقة) · `portfolio` (تطهير المحفظة)
- **Description:** Emerald + gold Islamic-finance aesthetic.
- **Used:** ✅

### Rescue Page (Standalone Next.js route)
- **File:** `src/app/rescue/page.tsx` (408 LOC)
- **Type:** Main View (Next.js page, not part of AppShell)
- **Parent:** Root (menu) — link in TopBar "More"
- **Hash:** N/A (URL `/rescue`) — also wrapped via `case 'rescue'` in page.tsx
- **Function:** Disaster stock rescue clinic (ALPHA-P0).
- **Description:** Inputs: ticker + buy price + qty. Calls rescue API → returns: decision (Hold/Average/Cut), autopsy (bought_near_peak, falling_knife, ignored_stop_loss), asset_health (PE, institutional_flow, support).
- **Tabs:** None
- **Used:** ✅ (also at `/#rescue` via AppShell)

### Zakat Calculator
- **File:** `src/components/zakat/ZakatView.tsx` (1144 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#zakat`
- **Function:** Islamic zakat calculator.
- **Tabs (2):** `calculator` (الحاسبة) · `methods` (طرق الحساب)
- **Used:** ✅

### Tithes Calculator (العُشر)
- **File:** `src/components/tithes/TithesView.tsx` (758 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#tithes`
- **Function:** Christian tithes calculator.
- **Tabs (2):** `calculator` (الحاسبة) · `guide` (دليل)
- **Used:** ✅

### Subscription / Pricing
- **File:** `src/components/subscription/SubscriptionView.tsx` (1792 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#subscription`
- **Function:** Pricing + subscription plans + Paymob checkout.
- **Tabs:** None (long scroll)
- **Used:** ✅

### About
- **File:** `src/components/about/AboutView.tsx` (385 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#about`
- **Function:** "About us" page — markets covered + methodology + features.
- **Tabs:** None
- **Used:** ✅

### Settings
- **File:** `src/components/settings/SettingsView.tsx` (233 LOC)
- **Type:** Main View
- **Parent:** Root (menu)
- **Hash:** `#settings`
- **Function:** User settings — language, persona, theme, subscription management.
- **Description:** Inline-renders `SubscriptionView` if `showSubscription=true`. Uses `PersonaSelector`, `DataManager`.
- **Tabs:** None (sections)
- **Used:** ✅

---

# Hidden / Deep-link-only Views (in switch but NOT in TopBar menu)

### Unified Analysis
- **File:** `src/modules/market-analysis/components/UnifiedAnalysisView.tsx` (563 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#unified-analysis`
- **Function:** Unified multi-market ticker analysis with persona config.
- **Used:** ✅ (URL hash only — no menu link)

### Prediction Tracking
- **File:** `src/modules/predictions/components/PredictionTrackingView.tsx` (719 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#prediction-tracking` (also `#picks-management` redirect here)
- **Function:** Tracking pending/closed picks + verify-now button.
- **Tabs:** None (uses market filter Select + status filter)
- **Used:** ✅ (URL hash only)

### Dual Track Predictions
- **File:** `src/modules/predictions/components/DualTrackPredictionsView.tsx` (634 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#dual-track`
- **Function:** Dual-track predictions (full analysis vs liquidity-only) with combined efficiency stats.
- **Tabs (3):** `all` (الكل) · `full_analysis` (تحليل كامل) · `liquidity` (تحليل سيولة)
- **Used:** ✅ (URL hash only)

### V82 Decision Panel (Institutional)
- **File:** `src/components/v82/V82DecisionPanel.tsx` (295 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only) — also embedded inside EnhancedPortfolioView
- **Hash:** `#v82`
- **Function:** V82 institutional decision panel (BUY/SELL/WAIT/AVOID + 9-condition gate + Entry/SL/TP1/TP2 + Money Flow + Position Sizing + Fuel Gauge + Kill Switch).
- **Used:** ✅ (URL hash + embedded in portfolio)

### BagHolder Rescue (standalone hash)
- **File:** `src/modules/portfolio/components/BagHolderRescuePanel.tsx` (1118 LOC)
- **Type:** Main View (thin wrapper in page.tsx)
- **Parent:** Root (deep-link only) — also a sub-tab inside EnhancedPortfolioView
- **Hash:** `#bagholder-rescue`
- **Function:** Deep rescue analysis for losing positions.
- **Tabs (5):** `technical` · `fundamentals` · `scenarios` · `plan` · `journal`
- **Used:** ✅ (URL hash + as portfolio sub-tab — Task 40-B merge)

### Advanced Portfolio Manager
- **File:** `src/modules/portfolio/components/AdvancedPortfolioManager.tsx` (579 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#advanced-portfolio`
- **Function:** Advanced portfolio manager — Python-backed (port 8010 via Caddy).
- **Tabs:** None
- **Used:** ✅ (URL hash only — Task 40-B removed from menu)

### Seasonality Dashboard
- **File:** `src/components/seasonality/SeasonalityDashboard.tsx` (301 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#seasonality`
- **Function:** Seasonality signals scan (strong_buy/buy/accumulate).
- **Tabs:** None
- **Used:** ✅ (URL hash only)

### Smart Confluence (Smart Assistant)
- **File:** `src/components/smart-assistant/SmartConfluenceView.tsx`
- **Type:** Main View
- **Parent:** Root (deep-link only — was in menu, removed per TopBar comment)
- **Hash:** `#smart-confluence` (also `#crypto-analysis` unified)
- **Function:** Smart assistant confluence picks.
- **Tabs (3):** `predictions` (التوقعات) · `buy` (شراء) · `sell` (بيع)
- **Used:** ✅ (URL hash only — user said it lacked purpose, removed from menu)

### Trading Journal
- **File:** `src/components/journal/TradingJournalView.tsx` (587 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#trading-journal`
- **Function:** User's trade journal + stats + analysis.
- **Tabs (3):** `trades` (الصفقات) · `stats` (إحصائيات) · `analysis` (تحليل)
- **Dialog:** Add trade Dialog (DialogTrigger)
- **Used:** ✅ (URL hash only)

### Publishing Platform
- **File:** `src/components/publishing/UserPublishingView.tsx` (740 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#publishing`
- **Function:** User-generated predictions feed + create post + points + leaderboard.
- **Tabs (4):** `feed` (التوقعات) · `create` (نشر توقع) · `points` (النقاط) · `leaderboard` (المتصدرين)
- **Used:** ✅ (URL hash only)

### Wealth Charts
- **File:** `src/modules/admin/components/WealthCharts.tsx` (466 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only — Task 40-B merged into Portfolio)
- **Hash:** `#wealth`
- **Function:** Wealth evolution charts (Line + Pie + Area + Bar) using Recharts.
- **Tabs:** None
- **Used:** ✅ (URL hash only — merged into portfolio as sub-tab)

### Backtesting (EGX)
- **File:** `src/components/backtesting/EGXBacktestDashboard.tsx` (444 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#backtesting`
- **Function:** Strategy backtest dashboard.
- **Tabs (3):** `strategies` (الاستراتيجيات) · `walkforward` (Walk-Forward) · `comparison` (المقارنة)
- **Used:** ✅ (URL hash only)

### Crypto Portfolio
- **File:** `src/modules/crypto/components/CryptoPortfolioView.tsx` (642 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#crypto-portfolio`
- **Function:** Crypto holdings manager (add/edit/delete positions).
- **Dialog:** Add position dialog
- **Used:** ✅

### Crypto Prediction Tracking
- **File:** `src/modules/crypto/components/CryptoPredictionTrackingView.tsx` (479 LOC)
- **Type:** Main View
- **Parent:** Root (deep-link only)
- **Hash:** `#crypto-prediction-tracking`
- **Function:** Tracking crypto picks with stats (total / pending / closed).
- **Tabs (3):** `all` (الكل) · `pending` (معلقة) · `closed` (مغلقة)
- **Used:** ✅

### Prediction Performance / Credibility (BLOCKED)
- **File:** N/A — inline JSX in `src/app/page.tsx` lines 531-545
- **Type:** Blocked redirect
- **Parent:** Root
- **Hash:** `#prediction-performance` / `#prediction-credibility`
- **Function:** Shows a "this page is in the admin panel only" message + back-to-dashboard button.
- **Used:** ✅ (admin-only — direct access blocked)

### Auth View
- **File:** `src/components/auth/AuthView.tsx` (651 LOC)
- **Type:** Main View (auth gate)
- **Parent:** Root (deep-link / auth gate)
- **Hash:** `#auth`
- **Function:** Login + register (Tabbed).
- **Tabs (2):** `login` (دخول) · `register` (تسجيل)
- **Used:** ✅ (auth gate + direct hash)

---

## 🔧 6. Admin Group

### Admin Panel
- **File:** `src/modules/admin/components/AdminView.tsx` (2084 LOC)
- **Type:** Admin Main View
- **Parent:** Root (deep-link `#admin` only — no TopBar link, gate by `isAdminUser`)
- **Hash:** `#admin`
- **Function:** Full admin control panel — 26 tabs in 6 hubs.
- **Hubs + Tabs:**

#### Hub: `health` (المراقبة وصحة النظام)
- `dashboard` — لوحة التحكم (overview + system health)
- `system-monitor` — `SystemMonitorPanel` — CPU/RAM/DB
- `problems` — `SystemProblemsTab` — alerts + solutions
- `cron-health` — Cron jobs + last run

#### Hub: `maestro` (المحركات والتعلم الذكي)
- `engine-control-room` — `EngineControlRoomTab` — unified 8 engines + console + start/stop all
- `data-engine` — `DataEngineTab` — Scrapers + Historical
- `general` — `EnginesStatusTab` — engine status + control
- `engine-settings` — `EngineSettingsTab` — weights + parameters
- `learning` — SuperLearningSystem (Tabs: predictions-engine/parameters/config/ai/results/persona-benchmark)
- `backtest` — `BacktestTab`
- `platform-performance` — `PlatformPerformanceView` — Win Rate, PF, Expectancy, Max Loss, Top 20, Worst 10

#### Hub: `data` (البيانات وقواعد البيانات)
- `databases` — `DatabaseManagerFull` (Tabs: overview/tables/sql/backups/daily/maintenance)
- `db-backup` — `DbBackupPanel` — backup/restore
- `system-control` — `SystemControlPanel` — scraper + sync + cron
- `news-control` — `NewsManagementTab`
- `news-health` — News source health (last_fetch + disabled)
- `sharia` — `ShariaManagementTab` (Rule 64)
- `source-authority` — `SourceAuthorityTab` (Rule 66)
- `validation-monitor` — `ValidationMonitorTab` (Rule 65)

#### Hub: `users` (المستخدمين والاشتراكات)
- `user-management` — `UserManagementPanel` / `UsersManagement` — CRUD + plans
- `users` — User analytics + behavior
- `promo-codes` — `PromoCodesAdmin` — CRUD + tracking
- `pricing` — Pricing + paywall gates status (7 paywall gates)
- `feedback` — User feedback + complaints

#### Hub: `telegram` (أدوات التسويق والنشر)
- `marketing-studio` — `MarketingStudio` (video + cards + campaigns + calendar)
- `reports` — Smart reports (daily + weekly + PDF)
- `telegram` — `TelegramTab` (Tabs: auth/dialogs/chat/search/legacy + sub-tabs channels/content/recommendations/news)
- `telegram-predictions` — TG published predictions audit (Task 28-B Fix 7)

**Used:** ✅ (admin-only)

### Admin — Separate Next.js Pages (not in AppShell switch)

#### Admin Redirect Page
- **File:** `src/app/admin/page.tsx` (38 LOC)
- **Type:** Redirect page
- **URL:** `/admin`
- **Function:** Redirects to `/#admin`.
- **Used:** ✅

#### Admin Educational Cards
- **File:** `src/app/admin/educational-cards/page.tsx` (1705 LOC)
- **Type:** Admin Next.js page (standalone)
- **URL:** `/admin/educational-cards`
- **Function:** Manage educational cards (lessons list, generate, publish to Telegram).
- **Dialog:** Preview dialog (line 1505)
- **Used:** ✅ (admin-only)

#### Admin Honest Predictions
- **File:** `src/app/admin/honest-predictions/page.tsx` (1922 LOC)
- **Type:** Admin Next.js page
- **URL:** `/admin/honest-predictions`
- **Function:** Honest predictions audit dashboard.
- **Used:** ✅ (admin-only)

#### Admin Trading Reports Hub
- **File:** `src/app/admin/reports/page.tsx` (121 LOC)
- **Type:** Admin Next.js page
- **URL:** `/admin/reports`
- **Function:** Trading reports hub — StockLeagueImageCard by period (daily/weekly/monthly/quarterly/semi_annual/yearly).
- **Used:** ✅ (admin-only)

### Other Next.js Pages

#### Backtest Page (standalone)
- **File:** `src/app/backtest/page.tsx` (380 LOC)
- **Type:** Standalone Next.js page
- **URL:** `/backtest`
- **Function:** Walk-forward backtest results viewer.
- **Used:** ✅

#### Payment Success
- **File:** `src/app/payment/success/page.tsx` (203 LOC)
- **Type:** Standalone Next.js page
- **URL:** `/payment/success`
- **Function:** Post-Paymob success page — polls `/api/subscription/status` until tier activates (no auto-activate — webhook-driven).
- **Used:** ✅

#### Legal Pages
- **Privacy:** `src/app/legal/privacy/page.tsx` (198 LOC) — `/legal/privacy`
- **Terms:** `src/app/legal/terms/page.tsx` (266 LOC) — `/legal/terms`
- **Disclaimer:** `src/app/legal/disclaimer/page.tsx` (210 LOC) — `/legal/disclaimer`
- **Type:** Static content pages
- **Used:** ✅ (footer links)

---

# Global Dialogs / Modals / Sheets (mounted at AppShell level)

### BotLinkHandler Dialog
- **File:** `src/app/page.tsx` lines 894-1024 (inline `BotLinkHandler` component)
- **Type:** Dialog
- **Parent:** AppShell (mounted globally)
- **Trigger:** `?bot_link=TOKEN` query param
- **Function:** Telegram bot account linking confirmation (POST `/api/bot/link-account`).

### TrialExpiredModal
- **File:** `src/modules/subscription/components/TrialExpiredModal.tsx` (77 LOC)
- **Type:** Modal (blocking overlay)
- **Parent:** AppShell (mounted globally)
- **Function:** Fullscreen block when 14-day trial expired — only escape is to subscribe (renders `PricingView` inside).
- **Used:** ✅

### TrialCountdownBanner
- **File:** `src/modules/subscription/components/TrialCountdownBanner.tsx` (125 LOC)
- **Type:** Banner + embedded Dialog (with `PricingView`)
- **Parent:** AppShell (mounted globally)
- **Function:** Amber/red countdown banner for free trial users — opens Dialog with PricingView on click.
- **Used:** ✅

### SessionExpiredModal (Global)
- **File:** `src/components/auth/SessionExpiredModal.tsx` (146 LOC)
- **Type:** Modal (blocking, non-dismissible)
- **Parent:** `src/components/Providers.tsx` (mounted globally — covers EVERY route)
- **Trigger:** Listens for `auth:session-expired` window event dispatched by `ApiClient` on 401.
- **Used:** ✅

### LoginPromptModal
- **File:** `src/components/auth/LoginPromptModal.tsx` (286 LOC)
- **Type:** Modal
- **Parent:** `AuthGate` (mounted inside gate)
- **Function:** Engaging modal for unauthenticated users hitting protected views.
- **Used:** ✅

### LockModal
- **File:** `src/components/auth/LockModal.tsx` (94 LOC)
- **Type:** Modal
- **Parent:** `LiquidityRadarView` (and possibly other gated widgets)
- **Function:** "Sign up to see full details" — for trial-gated content rows.
- **Used:** ✅

### DynamicRiskProfilerModal
- **File:** `src/components/persona/DynamicRiskProfilerModal.tsx` (326 LOC)
- **Type:** Modal
- **Parent:** `EnhancedPortfolioView` (mounted inside, opened by `profilerOpen` state)
- **Function:** 10-question risk tolerance quiz → sets persona (conservative/balanced/aggressive).
- **Used:** ✅

### AssetPreferenceOnboarding Dialog
- **File:** `src/modules/dashboard/components/AssetPreferenceOnboarding.tsx`
- **Type:** Dialog
- **Parent:** `DashboardView` (first-visit onboarding)
- **Function:** Asset preference survey (stocks/crypto/gold/etc.) shown on first dashboard visit.
- **Used:** ✅

### PlatformGuide Sheet
- **File:** `src/components/help/PlatformGuide.tsx` (503 LOC)
- **Type:** Sheet (right-side drawer)
- **Parent:** AppShell (mounted via `AppGuideAutoOpen` in page.tsx)
- **Function:** Onboarding guide — auto-opens on first visit, manually reopenable.
- **Used:** ✅

### NotificationCenter Sheet
- **File:** `src/components/notifications/NotificationCenter.tsx`
- **Type:** Sheet (left-side drawer)
- **Parent:** `TopBar` (bell icon)
- **Function:** Notification feed.
- **Used:** ✅

### StockInfographicModal
- **File:** `src/modules/publishing/components/StockInfographicModal.tsx` (335 LOC)
- **Type:** Modal
- **Parent:** `UnifiedPublishButton` (and possibly others)
- **Function:** Stock infographic card preview + export PNG + Telegram publish + clipboard copy.
- **Used:** ✅

### StockPublisher Dialog
- **File:** `src/modules/publishing/components/StockPublisher.tsx` (1129 LOC)
- **Type:** Dialog
- **Parent:** Used in `StocksView`, `EnhancedPortfolioView`, `EnhancedWatchlistView`, `PredictionTrackingView`, `DualTrackPredictionsView`, `BagHolderRescuePanel`, etc.
- **Function:** Unified stock publishing card — composes prediction + trading plan + liquidity + technicals + fundamentals into a publishable card + Arabic text + PNG export.
- **Tabs (3):** Card preview · Text · Image
- **Used:** ✅

### UnifiedPublishButton Dialog
- **File:** `src/modules/publishing/components/UnifiedPublishButton.tsx`
- **Type:** Dialog
- **Parent:** Many views (StocksView, DashboardView, etc.)
- **Function:** Generic publish button → opens Dialog with share options.
- **Sub-Dialog:** `TradeResultsGenerator` (open)
- **Sub-Modal:** `StockInfographicModal`
- **Used:** ✅

### MultiPortfolioSelector Dialog
- **File:** `src/modules/portfolio/components/MultiPortfolioSelector.tsx`
- **Type:** Dialog (×2)
- **Parent:** `EnhancedPortfolioView`
- **Function:** Add new portfolio + edit existing portfolio.
- **Used:** ✅

### FeedbackWidget Dialog
- **File:** `src/components/FeedbackWidget.tsx`
- **Type:** Dialog (floating)
- **Parent:** AppShell (mounted globally — visible as floating button)
- **Function:** User feedback form (suggestion/bug/complaint).
- **Used:** ✅

### PersonaSelector AlertDialog (Gambler Warning)
- **File:** `src/components/persona/PersonaSelector.tsx`
- **Type:** AlertDialog (Gambler Warning)
- **Parent:** Settings / portfolio
- **Function:** Warns aggressive persona users about over-trading.
- **Used:** ✅

### QuickPublishButton Dialog
- **File:** `src/components/publishing/QuickPublishButton.tsx` (336 LOC)
- **Type:** Dialog
- **Function:** Quick publish a prediction post.
- **Used:** ✅

---

# 🗑️ Orphaned / Removed Views (referenced in comments, files DELETED)

These views existed historically but were archived/deleted. They appear as comments in `page.tsx` but are NOT in the switch anymore.

| View | Status | File Location (archived) | Reason |
|------|--------|--------------------------|--------|
| `LearningView` | ❌ Removed | `archive/education-duplicate-2026-10-01/LearningView.tsx` | Rule 63 — unified into AcademyView |
| `CryptoLearningView` | ❌ Removed | `archive/dead-components-2026-10-08/crypto/CryptoLearningView.tsx` | Rule 63 — unified into AcademyView |
| `CryptoSimulationView` | ❌ Removed | `archive/simulation-crypto-duplicate-2026-10-01/CryptoSimulationView.tsx` | SimulationView now serves all markets |
| `CryptoScreenerView` | ❌ Removed | `archive/dead-components-2026-10-08/crypto/CryptoScreenerView.tsx` | Set to `null` in page.tsx; unified into StockScreenerAdvancedView |
| `CryptoTradingChartView` | ❌ Removed | `archive/dead-components-2026-10-08/crypto/CryptoTradingChartView.tsx` | Set to `null`; unified into TradingChartView |
| `CryptoAdvancedAnalysisView` | ❌ Removed | `archive/dead-components-2026-10-08/crypto/CryptoAdvancedAnalysisView.tsx` | Set to `null`; unified into SpecialistAnalysisView |
| `CryptoRecommendationsView` | ❌ Removed | `archive/_archived_v404/` | Unified into MarketAnalysisView via `initialMarket` prop |
| `CryptoAnalysisView` | ❌ Removed | `archive/_archived_v404/` | Unified into SmartConfluenceView |
| `SniperView` | ❌ Removed | (deleted) | Merged into MarketAnalysisView persona tabs |
| `PicksManagementView` | ❌ Removed | `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/PicksManagementView.tsx` | Features merged into PredictionTrackingView |
| `StoredAnalysisView` | ❌ Removed | (deleted) | Features distributed to #recommendations + #specialist-analysis |
| `IterativeLearningView` | ❌ Disabled | (not in switch — comment only) | Not used |
| `SimpleRecommendationsView` | ❌ Disabled | (not in switch — comment only) | Not used |
| `PredictionPerformanceView` | ❌ Admin-only | (file deleted; case still in switch but blocked) | Locked behind admin gate |
| `PredictionCredibilityTable` | ❌ Admin-only | (file deleted; case still in switch but blocked) | Locked behind admin gate |
| `MaestroWidget` | ❌ Disabled (Rule 73) | `src/modules/dashboard/components/MaestroWidget.tsx` (file still exists, import commented out in DashboardView) | Rule 73: SINGLE-DISPLAY-SOURCE |
| `MaestroCommandCenter` / `MaestroDashboard` | ❌ Deleted | (deleted in FIX-P3-P5-P6) | Replaced by AdminView hubs |

---

# Sub-components used inside parent views (NOT screens — listed for traceability)

These are large view-shaped components that exist as files but are always rendered INSIDE another view, never directly via the switch.

| Component | File | Rendered inside |
|-----------|------|-----------------|
| `TreasuryBondsView` | `src/modules/stock-analysis/components/TreasuryBondsView.tsx` | `StocksView` (when `stockTab === 'bonds'`) |
| `StockDetail` | `src/modules/stock-analysis/components/StockDetail.tsx` | `StocksView` (when `showDetail === true`) |
| `GateAnalysisView` | `src/modules/stock-analysis/components/GateAnalysisView.tsx` (267 LOC) | `StockDetail` |
| `StockAdvancedAnalysisView` | `src/modules/stock-analysis/components/StockAdvancedAnalysisView.tsx` (701 LOC) | `StockDetail` |
| `SingleStockAnalysisView` | `src/modules/market-analysis/components/SingleStockAnalysisView.tsx` (1467 LOC) | `StockDetail` |
| `ProfessionalTradingChart` | `src/modules/market-analysis/components/ProfessionalTradingChart.tsx` | `TradingChartView` + `StockDetail` |
| `ExecutiveReportView` | `src/modules/reports/components/ExecutiveReportView.tsx` (2089 LOC) | `UnifiedPredictionsTab` (subView `summary`) |
| `PredictionTrackingDashboard` | `src/modules/predictions/components/PredictionTrackingDashboard.tsx` | `UnifiedPredictionsTab` (subView `performance`) |
| `PersonaTab` | `src/modules/market-analysis/components/PersonaTab.tsx` | `UnifiedPredictionsTab` (subView `current`) |
| `PricingView` | `src/modules/subscription/components/PricingView.tsx` | `TrialExpiredModal` + `TrialCountdownBanner` Dialog |
| `PlatformPerformanceView` | `src/modules/admin/components/platform-performance/PlatformPerformanceView.tsx` (907 LOC) | `AdminView` (`platform-performance` tab) |
| `ProfessionalWatchlistView` | `src/components/watchlist/ProfessionalWatchlistView.tsx` (473 LOC) | `TradingMemoryView` |
| `MultiMarketWidget` | `src/modules/dashboard/components/MultiMarketWidget.tsx` | `Market Depth` screen + Dashboard |
| `InvestorsFlowPanel` | `src/modules/dashboard/components/InvestorsFlowPanel.tsx` | `Market Depth` screen |
| `LiveMonitor` | `src/modules/dashboard/components/LiveMonitor.tsx` | `#live-monitor` view + Dashboard (PinnableWidget) |
| `BagHolderRescuePanel` | `src/modules/portfolio/components/BagHolderRescuePanel.tsx` | `#bagholder-rescue` view + Portfolio sub-tab |
| `V82DecisionPanel` | `src/components/v82/V82DecisionPanel.tsx` | `#v82` view + Portfolio |
| `MultiPortfolioSelector` | `src/modules/portfolio/components/MultiPortfolioSelector.tsx` | `EnhancedPortfolioView` |
| `RoboAdvisorPanel` | `src/modules/portfolio/components/RoboAdvisorPanel.tsx` | `EnhancedPortfolioView` |
| `TopUpRecommendationsPanel` | `src/modules/portfolio/components/TopUpRecommendationsPanel.tsx` | `EnhancedPortfolioView` |
| `RealReturnPanel` | `src/modules/portfolio/components/RealReturnPanel.tsx` | `EnhancedPortfolioView` |
| `SmartAssistantPanel` | `src/modules/portfolio/components/SmartAssistantPanel.tsx` | `TradingMemoryView` |
| `PortfolioIntelligencePanel` | `src/modules/portfolio/components/PortfolioIntelligencePanel.tsx` | `TradingMemoryView` |
| `ExpertMemoryPanel` | `src/components/memory/ExpertMemoryPanel.tsx` | `TradingMemoryView` |
| `SmartAlertsPanel` | `src/components/alerts/SmartAlertsPanel.tsx` | `TradingMemoryView` |
| `DealAdvisorPanel` | `src/components/deal-advisor/DealAdvisorPanel.tsx` | `StockDetail` |
| `InstitutionalDecisionPanel` | `src/modules/market-analysis/components/InstitutionalDecisionPanel.tsx` | `SingleStockAnalysisView` |
| `ExpertRecommendationsPanel` | `src/modules/market-analysis/components/ExpertRecommendationsPanel.tsx` | `SingleStockAnalysisView` |
| `AlertPanel` | `src/modules/market-analysis/components/AlertPanel.tsx` | `SingleStockAnalysisView` |
| `MarketDepthPanel` | `src/modules/stock-analysis/components/MarketDepthPanel.tsx` | `SingleStockAnalysisView` |
| `ExpertAnalysisPanel` | `src/modules/stock-analysis/components/ExpertAnalysisPanel.tsx` | `SingleStockAnalysisView` |
| `MakerRadarTab` | `src/modules/predictions/components/MakerRadarTab.tsx` (3908 LOC — has 6 internal sub-tabs) | `LiquidityRadarView` (via `StockDetailDrawer`) |

### MakerRadarTab Internal Tabs (6)
This sub-component is huge and has its own Tabs structure:
- `maker` (الرادار)
- `exit-radar` (رادار الخروج)
- `weekly-report` (التقرير الأسبوعي)
- `multi-market-radar` (رادار متعدد الأسواق)
- `radar-accuracy` (دقة الرادار)
- `personalized-radar` (الرادار الشخصي)

---

# SUMMARY STATISTICS

| Category | Count |
|----------|-------|
| Top-level menu items (TopBar) | 21 |
| Switch cases in `renderView()` | 58 explicit + 1 default = 59 |
| Distinct main view components rendered by switch | 38 (some aliases point to same component) |
| Standalone Next.js pages (`src/app/**/page.tsx`) | 11 |
| Admin tabs (inside `AdminView`) | 26 across 6 hubs |
| Internal shadcn Tabs in main views | 14 views with Tabs (total ~60 tab values) |
| Global modals/sheets/dialogs (AppShell level) | 9 |
| View-level dialogs (inside main views) | ~15 across all views |
| Removed/archived views (orphans in comments) | 16 |
| Sub-view components (rendered inside parents) | 30+ |

## Navigation Reachability Map

```
Root (URL /)
├── AuthGate
│   └── AuthView (when unauthenticated)
│       ├── DevLoginForm (?dev=1)
│       └── BotLinkHandler Dialog (?bot_link=TOKEN)
│
├── TopBar (5 sections, 21 menu items)
│   ├── 🏠 Home
│   │   └── DashboardView (#dashboard / #crypto)
│   ├── 📊 Market
│   │   ├── StocksView (#stocks / #stock-detail / #crypto-live)
│   │   ├── StockScreenerAdvanced (#stock-filters / #top-performers / #crypto-screener)
│   │   ├── TradingChartView (#trading-chart / #screener / #crypto-trading-chart)
│   │   ├── LiquidityRadarView (#liquidity-radar)
│   │   └── Market Depth inline composite (#market-depth)
│   ├── 🎯 Predictions
│   │   ├── MarketAnalysisView (#recommendations / #analysis / #advanced-analysis / #v2-analysis / #crypto-recommendations)
│   │   ├── SpecialistAnalysisView (#specialist-analysis)
│   │   └── ReportsView (#reports)
│   ├── 💼 Finance
│   │   ├── EnhancedPortfolioView (#portfolio / #finance)
│   │   ├── EnhancedWatchlistView (#watchlist / #crypto-watchlist)
│   │   ├── AlertsCenterView (#alerts-center)
│   │   ├── LiveMonitor (#live-monitor)
│   │   └── TradingMemoryView (#trading-memory)
│   └── ☰ More
│       ├── NewsFeedView (#news)
│       ├── SimulationView (#simulation / #crypto-simulation)
│       ├── AcademyView (#academy / #crypto-learning)
│       ├── ShariaView (#sharia)
│       ├── RescuePage (/rescue + #rescue)
│       ├── ZakatView (#zakat)
│       ├── TithesView (#tithes)
│       ├── SubscriptionView (#subscription)
│       ├── AboutView (#about)
│       └── SettingsView (#settings)
│
├── Hidden hash-only views
│   ├── UnifiedAnalysisView (#unified-analysis)
│   ├── PredictionTrackingView (#prediction-tracking / #picks-management)
│   ├── DualTrackPredictionsView (#dual-track)
│   ├── V82DecisionPanel (#v82)
│   ├── BagHolderRescuePanel (#bagholder-rescue)
│   ├── AdvancedPortfolioManager (#advanced-portfolio)
│   ├── SeasonalityDashboard (#seasonality)
│   ├── SmartConfluenceView (#smart-confluence / #crypto-analysis)
│   ├── TradingJournalView (#trading-journal)
│   ├── UserPublishingView (#publishing)
│   ├── WealthCharts (#wealth)
│   ├── EGXBacktestDashboard (#backtesting)
│   ├── CryptoPortfolioView (#crypto-portfolio)
│   ├── CryptoPredictionTrackingView (#crypto-prediction-tracking)
│   ├── PredictionPerformance/Credibility BLOCKED (#prediction-performance / #prediction-credibility)
│   └── AuthView (#auth)
│
├── Admin (#admin — no menu link, role-gated)
│   └── AdminView (26 tabs / 6 hubs)
│
├── Standalone Next.js routes
│   ├── /admin (redirect → /#admin)
│   ├── /admin/educational-cards
│   ├── /admin/honest-predictions
│   ├── /admin/reports
│   ├── /backtest
│   ├── /payment/success
│   ├── /rescue (also #rescue)
│   ├── /legal/privacy
│   ├── /legal/terms
│   └── /legal/disclaimer
│
└── Global overlays (mounted in AppShell or Providers)
    ├── BotLinkHandler Dialog (?bot_link=TOKEN)
    ├── TrialExpiredModal (blocking)
    ├── TrialCountdownBanner (banner + Dialog)
    ├── SessionExpiredModal (global, 401-driven)
    ├── LoginPromptModal (AuthGate)
    ├── PlatformGuide Sheet (AppGuideAutoOpen)
    ├── RoboNotifierToggle (floating)
    ├── CentralAlertMonitor (background poller, no UI)
    ├── DesktopNotificationPrompt (background, no UI)
    ├── RealtimeTicker (top strip)
    └── FeedbackWidget (floating button + Dialog)
```

---

**END OF INVENTORY**
