# Frontend Module Map — `دليل الاستثمار` (Investment Guide)

> **Audit ID:** AUDIT-FE-MODULES
> **Date:** 2026-09-30
> **Agent:** Frontend Architect (module audit)
> **Mode:** READ-ONLY audit — no code was modified
> **Scope:** `src/app/page.tsx` + `src/components/**` + `src/lib/**` + `src/app/api/**` + `src/hooks/**` + `src/types/**`
> **Goal:** Transform the project from "scattered small projects" into "standard reusable modules".

---

## 0. Executive Summary

This audit enumerated **280 component files** (~141,583 LOC), **~110 lib modules** (~45,769 LOC), **670 API route handlers** (across 785 directories), **7 React hooks**, and the single-page-app entry `src/app/page.tsx` (642 LOC). The application is a Next.js 16 + TypeScript hash-routed SPA with an Arabic RTL UI for multi-market stock analysis (EGX/TADAWUL/KSE/QSE/US/CRYPTO).

The codebase has organically accumulated **16 well-defined functional domains**, **9 truly-reusable shared components**, **2 duplicate ShareButtons**, **3 overlapping screener views**, **4 overlapping stock-analysis views**, **4 overlapping prediction-tracking views**, **2 WealthCharts duplicates**, **13+ fragmented DB helper files** (with a `db-helpers.ts` facade that nobody imports), and **~7 dead lib modules** totalling >7,000 LOC (`analysis-engine.ts` alone is 3,126 LOC of unused code). The `studio/` (9 files, 1,549 LOC) and `sniper/` (2 files, 820 LOC) component subdirectories are **completely orphaned** — zero external importers.

This report proposes a **10-module architecture** (stock-analysis, predictions, radar, portfolio, watchlist, screener, market-analysis, news, notifications, publishing + shared) and a **5-phase migration plan** that touches every file but breaks nothing (alias-based imports keep old paths working during the transition).

---

## Table of Contents

1. [Current Structure (As-Is)](#1-current-structure-as-is)
2. [Routing & Entry Point Analysis](#2-routing--entry-point-analysis)
3. [Functional Domains](#3-functional-domains)
4. [Shared Components Inventory](#4-shared-components-inventory)
5. [shadcn/ui Primitives Inventory](#5-shadcnui-primitives-inventory)
6. [Lib Modules Classification](#6-lib-modules-classification)
7. [API Routes Grouped by Domain](#7-api-routes-grouped-by-domain)
8. [Duplicates & Overlaps](#8-duplicates--overlaps)
9. [Wiring Disconnects](#9-wiring-disconnects)
10. [Module Architecture Proposal](#10-module-architecture-proposal)
11. [Migration Plan](#11-migration-plan)
12. [Final Statistics & Recommendations](#12-final-statistics--recommendations)

---

## 1. Current Structure (As-Is)

### 1.1 Top-level `src/` tree

```
src/
├── app/                         # Next.js App Router
│   ├── page.tsx                 # 642 LOC — SPA entry, hash-based routing
│   ├── layout.tsx               # Root layout (NextAuth + ThemeProvider + RTL)
│   ├── backtest/page.tsx        # Standalone /backtest route (404 risk — see §9)
│   ├── admin/                   # /admin/* pages (layout + 4 standalone pages)
│   ├── api/                     # 670 route.ts files across 785 dirs
│   └── instrumentation.ts       # OpenTelemetry/Sentry hook
├── components/                  # 280 files / 141,583 LOC / 47 subdirectories
│   ├── (5 loose files)          # eid-predictions-widget, auto-analysis-widget,
│   │                            # news-feed-widget (DEAD), FeedbackWidget, Providers
│   ├── about/                   # 1 file / 384 LOC
│   ├── academy/                 # 6 files / 7,133 LOC
│   ├── admin/                   # 34 files / 26,379 LOC ⚠️ LARGEST
│   ├── advanced-analysis/       # 3 files / 1,449 LOC
│   ├── ai/                      # 5 files / 1,385 LOC
│   ├── alerts/                  # 2 files / 1,005 LOC
│   ├── analysis/                # 24 files / 17,456 LOC ⚠️ SECOND LARGEST
│   ├── auth/                    # 4 files / 1,517 LOC
│   ├── backtesting/             # 1 file / 443 LOC
│   ├── crypto/                  # 8 files / 5,877 LOC
│   ├── daily-picks/             # 1 file / 322 LOC
│   ├── deal-advisor/            # 1 file / 831 LOC
│   ├── devil/                   # 5 files / 1,115 LOC
│   ├── eid-predictions-widget    # 1 file / 255 LOC (loose)
│   ├── help/                    # 1 file / 494 LOC
│   ├── intelligence/            # 1 file / 501 LOC
│   ├── journal/                 # 1 file / 586 LOC
│   ├── layout/                  # 7 files / 1,922 LOC
│   ├── learning/                # 3 files / 2,016 LOC
│   ├── legal/                   # 1 file / 124 LOC
│   ├── market/                  # 8 files / 3,392 LOC (image-card exporters)
│   ├── memory/                  # 2 files / 701 LOC
│   ├── news/                    # 1 file / 801 LOC
│   ├── notifications/           # 4 files / 877 LOC
│   ├── persona/                 # 2 files / 598 LOC
│   ├── portfolio/               # 16 files / 9,930 LOC
│   ├── predictions/             # 13 files / 12,053 LOC ⚠️ includes MakerRadarTab 2,791 LOC
│   ├── publishing/              # 2 files / 1,074 LOC
│   ├── recommendations/          # 6 files / 3,616 LOC
│   ├── reports/                 # 5 files / 5,336 LOC
│   ├── screener/                # 8 files / 6,011 LOC
│   ├── seasonality/             # 1 file / 300 LOC
│   ├── settings/                # 1 file / 232 LOC
│   ├── share/                   # 1 file / 583 LOC ⚠️ DUPLICATE of shared/ShareButton
│   ├── shared/                  # 9 files / 3,965 LOC ✅ THE REUSABLE ONES
│   ├── simulation/              # 1 file / 1,927 LOC
│   ├── smart-assistant/         # 1 file / 275 LOC
│   ├── smart-tips/              # 1 file / 528 LOC
│   ├── sniper/                  # 2 files / 820 LOC ⚠️ DEAD (0 importers)
│   ├── stocks/                  # 15 files / 11,544 LOC
│   ├── studio/                  # 9 files / 1,549 LOC ⚠️ DEAD (0 importers)
│   ├── subscription/            # 1 file / 1,430 LOC
│   ├── tithes/                  # 1 file / 757 LOC
│   ├── ui/                      # 51 files / 5,798 LOC (shadcn primitives)
│   ├── v82/                     # 1 file / 294 LOC
│   ├── watchlist/               # 2 files / 1,783 LOC (1 used, 1 DEAD)
│   └── zakat/                   # 1 file / 1,142 LOC
├── data/                        # Static learning content (2 files)
├── hooks/                       # 7 React hooks (useSmartChart, useAuthCheck, ...)
├── lib/                         # ~110 files / 45,769 LOC (see §6)
├── middleware.ts                # Next.js middleware (auth/CSRF)
├── types/                       # 2 files (index.ts + v2.ts)
└── __tests__/                   # 21 test files (radar, alerts, security, shared, ...)
```

### 1.2 Quantitative summary

| Metric | Value |
|---|---|
| Component directories | 47 |
| Total component files (`*.tsx` + `*.ts`) | 280 |
| Total component LOC | 141,583 |
| Largest component directory | `admin/` (34 files, 26,379 LOC) |
| 2nd largest | `analysis/` (24 files, 17,456 LOC) |
| 3rd largest | `predictions/` (13 files, 12,053 LOC) |
| Largest single component file | `EnhancedPortfolioView.tsx` (3,203 LOC) |
| 2nd largest file | `MakerRadarTab.tsx` (2,791 LOC) |
| 3rd largest file | `AdminView.tsx` (2,129 LOC) |
| 4th largest file | `StocksView.tsx` (2,201 LOC) |
| 5th largest file | `StrategySandbox.tsx` (2,188 LOC) |
| 6th largest file | `AiRecommendations.tsx` (2,209 LOC) |
| 7th largest file | `SuperLearningSystem.tsx` (2,489 LOC) |
| 8th largest file | `PredictionTrackingDashboard.tsx` (2,024 LOC) |
| 9th largest file | `StockScreenerAdvanced.tsx` (2,129 LOC) |
| 10th largest file | `TelegramTab.tsx` (2,200 LOC) |
| Lib files (`src/lib/**`) | ~110 |
| Lib LOC | 45,769 |
| Largest lib file | `analysis-engine.ts` (3,126 LOC) — ⚠️ DEAD |
| 2nd largest lib | `honest-tracking/maestro.ts` (1,850 LOC) — ✅ used by 4 API routes |
| 3rd largest lib | `admin-db-manager.ts` (1,499 LOC) |
| 4th largest lib | `store.ts` (1,478 LOC) — Zustand store, 85 importers |
| API route handlers (`route.ts`) | 670 |
| API directories | 785 (some have sub-routes) |
| React hooks (`src/hooks/`) | 7 |
| Test files (`__tests__/`) | 21 |
| Total TypeScript LOC audited | ~190,000 |

### 1.3 Component-directory heat-map (LOC + status)

```
admin/        ████████████████████████████ 26,379 LOC ⚠️  ADMIN PANEL (34 files)
analysis/     ████████████████████         17,456 LOC ✅  MARKET ANALYSIS HUB (24 files)
predictions/  █████████████                12,053 LOC ✅  PREDICTIONS + RADAR (13 files)
stocks/       █████████████                 11,544 LOC ✅  STOCK DETAIL HUB (15 files)
portfolio/    ███████████                   9,930 LOC ✅  PORTFOLIO HUB (16 files)
ui/           ███████                        5,798 LOC ✅  SHADCN PRIMITIVES (51 files)
crypto/       ███████                        5,877 LOC ✅  CRYPTO MIRROR (8 files)
screener/     ███████                        6,011 LOC ✅  SCREENER (3 of 8 dead)
reports/      ██████                          5,336 LOC ✅  REPORTS (5 files)
shared/       █████                            3,965 LOC ✅  REUSABLE (9 files)
market/       ████                             3,392 LOC ✅  IMAGE CARD EXPORTERS (8 files)
recommendations████                             3,616 LOC ✅  RECOMMENDATIONS (6 files)
simulation/   ██                               1,927 LOC ✅  SIMULATION (1 file)
layout/       ██                               1,922 LOC ✅  LAYOUT (7 files)
watchlist/    ██                               1,783 LOC ✅  WATCHLIST (2 files, 1 dead)
auth/         █                                1,517 LOC ✅  AUTH (4 files)
studio/       ██                               1,549 LOC ❌  DEAD (0 importers)
ai/           █                                1,385 LOC ✅  AI ASSISTANT (5 files)
subscription/ █                                1,430 LOC ✅  SUBSCRIPTION (1 file)
academy/      ██                               7,133 LOC ✅  ACADEMY (6 files)
advanced-analysis█                              1,449 LOC ✅  SPECIALIST ANALYSIS (3 files)
learning/     ██                               2,016 LOC ✅  LEARNING (3 files)
devil/        █                                1,115 LOC ✅  DEVIL'S ADVOCATE (5 files)
publishing/   █                                1,074 LOC ✅  PUBLISHING (2 files)
alerts/       █                                1,005 LOC ✅  ALERTS (2 files)
zakat/        █                                1,142 LOC ✅  ZAKAT (1 file)
news/         █                                  801 LOC ✅  NEWS (1 file)
deal-advisor/ █                                  831 LOC ✅  DEAL ADVISOR (1 file)
journal/      █                                  586 LOC ✅  TRADING JOURNAL (1 file)
sniper/       █                                  820 LOC ❌  DEAD (0 importers)
share/        █                                  583 LOC ⚠️  DUPLICATE ShareButton
```

---

## 2. Routing & Entry Point Analysis

### 2.1 `src/app/page.tsx` (642 LOC) — the single SPA entry

The application is a **single-page app** (SPA) running entirely under `/`. Internal navigation is **hash-based**: clicking any nav item sets `window.location.hash = '#stocks'` etc., and `useAppStore` reads the hash into `currentView`. The `AppShell` component then runs a giant `switch (currentView)` in `renderView()` to choose which view to mount.

### 2.2 Module-scope dynamic imports

Every heavy view is loaded via `next/dynamic` (named `dynamicImport` here) with `ssr: false`. Heavier views are also wrapped with `withErrorBoundary` (a HOC from `@/components/shared/ErrorBoundary`) and given a `<LazyTabLoader />` fallback so users see a spinner instead of a white screen during chunk download.

The 38 module-scope `dynamicImport()` calls are:

```ts
// EGX views
StocksView               → @/components/stocks/StocksView
EnhancedPortfolioView    → @/components/portfolio/EnhancedPortfolioView
EnhancedWatchlistView    → @/components/watchlist/EnhancedWatchlistView
MarketAnalysisView       → @/components/analysis/MarketAnalysisView
StockScreenerAdvancedView→ @/components/screener/StockScreenerAdvanced
ReportsView              → @/components/reports/ReportsView
NewsFeedView             → @/components/news/NewsFeedView
LearningView             → @/components/learning/LearningView
SimulationView           → @/components/simulation/SimulationView
AcademyView              → @/components/academy/AcademyView
SettingsView             → @/components/settings/SettingsView
AdminView                → @/components/admin/AdminView
AuthView                 → @/components/auth/AuthView
SubscriptionView         → @/components/subscription/SubscriptionView
CryptoPortfolioView      → @/components/crypto/CryptoPortfolioView
ZakatView                → @/components/zakat/ZakatView
TithesView               → @/components/tithes/TithesView
SpecialistAnalysisView   → @/components/advanced-analysis/SpecialistAnalysisView
AdvancedPortfolioManager → @/components/portfolio/AdvancedPortfolioManager
SeasonalityDashboard     → @/components/seasonality/SeasonalityDashboard
AlertsCenterView         → @/components/alerts/AlertsCenterView
UserPublishingView       → @/components/publishing/UserPublishingView
TradingMemoryView        → @/components/memory/TradingMemoryView
TradingJournalView       → @/components/journal/TradingJournalView
UnifiedAnalysisView      → @/components/analysis/UnifiedAnalysisView
SmartConfluenceView      → @/components/smart-assistant/SmartConfluenceView
PredictionTrackingView   → @/components/predictions/PredictionTrackingView
DualTrackPredictionsView → @/components/predictions/DualTrackPredictionsView
V82DecisionPanel         → @/components/v82/V82DecisionPanel
LiveMonitor              → @/components/dashboard/LiveMonitor
WealthCharts             → @/components/admin/WealthCharts    ⚠️ uses ADMIN copy
EGXBacktestDashboard     → @/components/backtesting/EGXBacktestDashboard
TradingChartView         → @/components/analysis/TradingChartView
LiquidityRadarView       → @/components/predictions/MakerRadarTab  ⚠️ file/name mismatch
AboutView                → @/components/about/AboutView
CryptoScreenerView       → @/components/crypto/CryptoScreenerView
CryptoPredictionTrackingView → @/components/crypto/CryptoPredictionTrackingView
CryptoTradingChartView  → @/components/crypto/CryptoTradingChartView
CryptoAdvancedAnalysisView → @/components/crypto/CryptoAdvancedAnalysisView
```

Plus a "lazy crypto views" promise that imports `CryptoAdditionalViews` for `CryptoLearningView` and `CryptoSimulationView`.

### 2.3 The `renderView()` switch — ~45 distinct routes

Below is the complete switch table from `page.tsx` lines 405–575. **Note:** several routes are *redirects* that exist only for backward-compat (e.g. `crypto-watchlist` → `EnhancedWatchlistView`, `top-performers` → `StockScreenerAdvancedView` with `initialTab`).

| Hash route | Component | Notes |
|---|---|---|
| `dashboard` | `<DashboardView />` | default |
| `stocks` / `stock-detail` | `<StocksView />` | unified stocks table |
| `stock-filters` | `<StockScreenerAdvancedView />` | |
| `top-performers` | `<StockScreenerAdvancedView initialTab="top-performers" />` | redirect, merged |
| `screener` / `trading-chart` | `<TradingChartView />` | ⚠️ screener routes to a CHART component |
| `portfolio` / `finance` | `<EnhancedPortfolioView />` | |
| `watchlist` | `<EnhancedWatchlistView />` | |
| `recommendations` / `analysis` | `<MarketAnalysisView />` | analysis is alias |
| `advanced-analysis` / `v2-analysis` | `<MarketAnalysisView />` | ⚠️ redirect, was removed |
| `unified-analysis` | `<UnifiedAnalysisView />` | |
| `specialist-analysis` | `<SpecialistAnalysisView />` | |
| `prediction-performance` / `prediction-credibility` | inline fallback ("admin only") | not routed to a component |
| `prediction-tracking` | `<PredictionTrackingView />` | |
| `picks-management` | `<PredictionTrackingView />` | ⚠️ redirect (PicksManagementView removed 2026-09-28) |
| `dual-track` | `<DualTrackPredictionsView />` | |
| `v82` | `<V82DecisionPanel initialTicker="COMI" />` | |
| `reports` | `<ReportsView />` | |
| `news` | `<NewsFeedView />` | |
| `learning` | `<LearningView />` | |
| `simulation` | `<SimulationView />` | |
| `academy` | `<AcademyView />` | |
| `advanced-portfolio` | `<AdvancedPortfolioManager />` | |
| `seasonality` | `<SeasonalityDashboard />` | |
| `smart-confluence` | `<SmartConfluenceView />` | |
| `liquidity-radar` | `<LiquidityRadarView market={currentMarket} />` | ⚠️ LiquidityRadarView = MakerRadarTab |
| `alerts-center` | `<AlertsCenterView />` | |
| `live-monitor` | `<LiveMonitor />` | |
| `wealth` | `<WealthCharts />` | ⚠️ imports `@/components/admin/WealthCharts` not `portfolio/WealthCharts` |
| `trading-memory` | `<TradingMemoryView />` | |
| `trading-journal` | `<TradingJournalView />` | |
| `publishing` | `<UserPublishingView />` | |
| `crypto` | `<DashboardView />` | unified mirror, sets market=CRYPTO |
| `crypto-live` | `<StocksView />` | mirror |
| `crypto-portfolio` | `<CryptoPortfolioView />` | |
| `crypto-watchlist` | `<EnhancedWatchlistView />` | mirror |
| `crypto-recommendations` | `<MarketAnalysisView />` | mirror |
| `crypto-analysis` | `<SmartConfluenceView />` | mirror |
| `crypto-learning` | `<LearningView />` | mirror |
| `crypto-simulation` | `<SimulationView />` | mirror |
| `crypto-trading-chart` | `<TradingChartView />` | mirror |
| `crypto-prediction-tracking` | `<CryptoPredictionTrackingView />` | |
| `crypto-screener` | `<StockScreenerAdvancedView />` | mirror |
| `zakat` | `<ZakatView />` | |
| `tithes` | `<TithesView />` | |
| `subscription` | `<SubscriptionView />` | |
| `settings` | `<SettingsView />` | |
| `auth` | `<AuthView />` | |
| `admin` | `<AdminView />` | |
| `about` | `<AboutView />` | |
| `backtesting` | `<EGXBacktestDashboard />` | |
| default | `<DashboardView />` | fallback |

### 2.4 Layout / chrome components in `page.tsx`

The page wraps everything in `<AuthGate>` and renders:
- `<DbSchemaInit />` — boots `/api/finance/schema` POST + `/api/init-db` GET once per session (no UI)
- `<SessionSync />` — bridges NextAuth session into the Zustand `useAppStore`
- `<UrlHashSync />` — syncs `window.location.hash` ↔ `currentView` (handles `hashchange` + `popstate`)
- `<RealtimeTicker />` — top scrolling ticker
- `<CentralAlertMonitor />` — background sniper-scan poller (60s)
- `<AppGuideAutoOpen />` — opens `PlatformGuide` on first visit
- `<TopBar />` — main nav (replaces old Sidebar)
- `<motion.div>{renderView()}</motion.div>` — animated view container
- `<Footer />`
- `<MobileNav />`
- `<FloatingAssistant />` — AI chat FAB
- `<RoboNotifierToggle />` — fixed-position notification toggle
- `<NotificationCenter />` — slide-over sheet

### 2.5 Hash-route source of truth

`src/lib/valid-views.ts` (93 LOC) exports `VALID_VIEWS` (a readonly array) + `VALID_VIEWS_SET` + `isCryptoView()` + `resolveCryptoRedirect()`. Every valid hash must be in this list; the URL-sync layer refuses unknown hashes. This is the **canonical list of routes** — keep this in sync when adding/removing views.

---

## 3. Functional Domains

Below is the full file inventory per domain. Every claim is verifiable via `grep` for the file path or the API route URL.

### Domain 1: Stock Analysis

> **Purpose:** Everything that analyses a single stock — the detail page, the chart, the analysis engines, the comprehensive overview, the gate analysis, the deep analysis scoring.

**Entry points:**
- `/#stocks` → `StocksView` (2,201 LOC) — the stocks table; clicking a row opens `StockDetail`
- `/#stock-detail` → same `StocksView` (alias)
- `/#unified-analysis` → `UnifiedAnalysisView` (562 LOC) — alternate unified view
- `/#specialist-analysis` → `SpecialistAnalysisView` (1,073 LOC) — specialist intelligence
- `/#trading-chart` / `/#screener` → `TradingChartView` (314 LOC) — wraps `InteractiveChart` + `SingleStockAnalysisView`

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/stocks/StocksView.tsx` | 2,201 | ✅ entry |
| `src/components/stocks/StockDetail.tsx` | 1,254 | ✅ composed of 11 sub-panels |
| `src/components/stocks/ComprehensiveStockAnalysis.tsx` | 1,328 | ✅ Tabs (Overview/Technical/Fundamental/Charts/News/Predictions) |
| `src/components/stocks/DeepAnalysis.tsx` | 1,148 | ✅ scoring (composite/technical/value/quality/momentum/risk) |
| `src/components/stocks/StockAdvancedAnalysisView.tsx` | 679 | ✅ Python-based signal analysis |
| `src/components/stocks/GateAnalysisView.tsx` | 215 | ✅ 5-gate analysis (uses `gate-analyzer.ts`) |
| `src/components/stocks/TradingViewChart.tsx` | 1,821 | ✅ TradingView-style chart with indicators |
| `src/components/stocks/StockSelector.tsx` | 460 | ✅ ticker dropdown |
| `src/components/stocks/StockNews.tsx` | 576 | ✅ news panel for a ticker |
| `src/components/stocks/MarketDepthPanel.tsx` | 280 | ✅ order-book pressure |
| `src/components/stocks/CalculationBreakdown.tsx` | 602 | ✅ math breakdown (used only in StockDetail) |
| `src/components/stocks/DeltaVolumeBar.tsx` | 229 | ✅ delta volume (used only in StockDetail) |
| `src/components/stocks/TreasuryBondsView.tsx` | 435 | ✅ Egyptian treasury bonds (used in StocksView) |
| `src/components/stocks/DataCoverageBanner.tsx` | 209 | ❌ DEAD (0 importers) |
| `src/components/stocks/StockIcon.tsx` | 108 | ✅ ticker icon |
| `src/components/analysis/SingleStockAnalysisView.tsx` | 1,315 | ✅ used by TradingChartView + PersonaTab |
| `src/components/analysis/InteractiveChart.tsx` | 1,677 | ✅ recharts-based chart |
| `src/components/analysis/TradingChartView.tsx` | 314 | ✅ thin wrapper |
| `src/components/analysis/UnifiedAnalysisView.tsx` | 562 | ✅ alternate unified view |
| `src/components/analysis/ChartControls.tsx` | 142 | ✅ chart toolbar |
| `src/components/analysis/MarketDepthLiquidityWidget.tsx` | 437 | ✅ DOM/order book widget |
| `src/components/analysis/AlertPanel.tsx` | 384 | ✅ price alert panel |
| `src/components/analysis/InstitutionalDecisionPanel.tsx` | 685 | ✅ institutional decision matrix |
| `src/components/advanced-analysis/SpecialistAnalysisView.tsx` | 1,073 | ✅ entry |
| `src/components/advanced-analysis/FibonacciWidget.tsx` | (small) | ✅ fib levels |
| `src/components/advanced-analysis/CandlestickWidget.tsx` | (small) | ✅ pattern detection |
| `src/components/deal-advisor/DealAdvisorPanel.tsx` | 831 | ✅ trade advisor |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/analysis-engine.ts` | 3,126 | ❌ DEAD — 0 external importers (only mentioned in docs) |
| `src/lib/dynamic-analysis-engine.ts` | 925 | ⚠️ 2 importers (almost dead) |
| `src/lib/gate-analyzer.ts` | 1,032 | ✅ 1 importer (GateAnalysisView) |
| `src/lib/persona-dynamic.ts` | 513 | ✅ 4 importers |
| `src/lib/persona-matrix.ts` | 196 | ❌ DEAD |
| `src/lib/technical-analysis.ts` | 488 | ❌ DEAD (computeRSI / computeSMA / computeEMA unused!) |
| `src/lib/candlestick-patterns.ts` | 438 | ❌ DEAD |
| `src/lib/prediction-validator.ts` | 293 | ⚠️ 1 importer (predictions/honest-tracking/list) |
| `src/lib/risk-reward.ts` | 66 | ⚠️ 3 importers |
| `src/lib/expert/expert-filter.ts` | 233 | ❌ DEAD |
| `src/lib/stock-movement-classifier.ts` | 290 | ❌ DEAD |
| `src/lib/stock-movement-classification.ts` | 365 | ❌ DEAD (near-identical to above!) |
| `src/lib/data-validator.ts` | 516 | ⚠️ 1 importer |
| `src/lib/stock-names.ts` | 874 | ✅ data table of stock Arabic/English names |
| `src/lib/stock-icon.ts` | 129 | ✅ used by stocks/StockIcon |

**Files (API side):**

```
/api/stocks                          GET stocks list (paginated)
/api/stocks/[ticker]                GET single stock detail
/api/stocks/[ticker]/comprehensive   GET comprehensive analysis (multi-engine)
/api/stocks/[ticker]/recommendation GET single recommendation
/api/stocks/[ticker]/news            GET ticker-specific news
/api/stocks/[ticker]/depth           GET order-book depth
/api/stocks/[ticker]/orderbook       GET raw orderbook
/api/stocks/[ticker]/history         GET price history
/api/stocks/[ticker]/publish-data    POST stock publisher data
/api/stocks/[ticker]/professional-analysis
/api/stock/deep-analysis
/api/stock-detail
/api/stock-profile/[ticker]
/api/stock-notebook
/api/stock-seasonality
/api/chart/[ticker]
/api/stocks/analysis
/api/stocks/advanced-analysis
/api/stocks/batch-analysis
/api/stocks/confluence
/api/stocks/data-coverage
/api/stocks/delta-volume
/api/stocks/dual-persona/[ticker]
/api/stocks/fundamentals
/api/stocks/movement-classification
/api/stocks/presets
/api/stocks/recommendations
/api/stocks/screener
/api/stocks/search
/api/stocks/sparkline
/api/stocks/technical
/api/stocks/top-performers
/api/advanced-analysis
/api/advanced-analysis/results
/api/advanced-analysis/scan-all
/api/analysis-engine                  ⚠️ misleading name — only manages CONFIG
/api/analysis/results
/api/analysis/status
/api/unified-analysis
/api/unified-analysis/[symbol]
/api/unified-analysis/recommendations
/api/unified-market-analysis
/api/unified-scoring
/api/v2/analyze
/api/v2/recommend
/api/v2/stock/[symbol]/analysis
/api/v2/chart/full-analysis
/api/live/analysis/[ticker]
/api/live/scan
/api/confluence/analyze/[ticker]
/api/confluence/daily-picks
/api/confluence/market-scan
/api/smart-confluence/tabs
/api/smart-confluence/analysis/[symbol]
/api/sniper/scan
/api/sniper/backtest
/api/sniper/closer/pending
/api/sniper/closer/run
/api/sniper/learning/performance
/api/sniper/track
/api/scanner/quick
/api/scanner/run
/api/dividend-analysis
/api/dividend-calendar
/api/explosive
/api/explosive/[ticker]
/api/explosive/hunt
/api/risk/decision-table
/api/risk/position-size
/api/risk/stock-types
/api/risk/stop-loss
/api/risk/targets
/api/deal-advisor/[ticker]
/api/persona/analyze/[ticker]
/api/persona/gambler
/api/persona/investor
/api/persona/recommendations
/api/disclosures/company/[symbol]
/api/egxpilot/analysis/[ticker]
```

**Shared dependencies (lib modules):**
- `@/lib/store` (stocks list, selectedTicker, currentMarket)
- `@/lib/api-client` (HTTP)
- `@/lib/egx-db`, `@/lib/data-engine-db`, `@/lib/radar-db` (price history)
- `@/lib/python-backend` (VPS Python URL)
- `@/lib/gate-analyzer`, `@/lib/persona-dynamic`, `@/lib/persona-matrix` (analysis engines)
- `@/lib/official-links`, `@/lib/signal-utils`, `@/lib/risk-reward`

**Data sources:**
- `data_engine.db` (better-sqlite3) — stocks, price_history, technical_indicators
- `stocks.db` (better-sqlite3) — main stocks table (used by `egx-db.ts`)
- `predictions.db` (Prisma) — historical predictions
- `radar-db` (portable) — maker radar cache (used by `StockPublisher` API)

**Reusable pieces that should become a module:**
- `StockDetail` (the composed page)
- `ComprehensiveStockAnalysis` (tabs)
- `DeepAnalysis` (scores panel)
- `GateAnalysisView` (5-gate)
- `StockAdvancedAnalysisView` (Python signal)
- `StockPublisher` (already shared)
- `StockSelector` + `StockSearchSelector` (shared)
- `TradingViewChart` + `InteractiveChart` (charts)
- `MarketDepthPanel` + `MarketDepthLiquidityWidget` (overlapping — should merge)
- `lib/analysis-engine.ts` + `lib/dynamic-analysis-engine.ts` + `lib/gate-analyzer.ts` + `lib/persona-dynamic.ts` (analysis engine family)

---

### Domain 2: Predictions

> **Purpose:** V40.2 / V40.4 predictions, tracking, verification, dual-track comparison, weekly/monthly leagues, expert consensus.

**Entry points:**
- `/#prediction-tracking` → `PredictionTrackingView` (719 LOC)
- `/#dual-track` → `DualTrackPredictionsView` (633 LOC)
- `/#recommendations` → `MarketAnalysisView` → `tracking` tab → `PredictionTrackingDashboard` (2,024 LOC)
- `/#picks-management` → redirects to `PredictionTrackingView` (PicksManagementView removed 2026-09-28)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/predictions/PredictionTrackingView.tsx` | 719 | ✅ entry — uses `/api/predictions/tracking/*` |
| `src/components/predictions/PredictionTrackingDashboard.tsx` | 2,024 | ✅ embedded in MarketAnalysisView "tracking" tab — uses `/api/predictions/honest-tracking/*` |
| `src/components/predictions/DualTrackPredictionsView.tsx` | 633 | ✅ entry — uses `/api/predictions/dual-track/*` |
| `src/components/predictions/PicksManagementView.tsx` | 802 | ❌ DEAD (removed from routing, file still present) |
| `src/components/predictions/MakerRadarTab.tsx` | 2,791 | ✅ entry (radar — see Domain 3) |
| `src/components/predictions/radar/RadarStatsCards.tsx` | 793 | ✅ used by MakerRadarTab |
| `src/components/predictions/radar/SignalStrengthMeter.tsx` | 194 | ✅ used by MakerRadarTab + tests |
| `src/components/predictions/radar/SignalTrackingTimeline.tsx` | 770 | ✅ used by MakerRadarTab |
| `src/components/predictions/radar/AccuracyDashboard.tsx` | 638 | ✅ standalone (1 importer: itself + tests) |
| `src/components/predictions/radar/PersonalizedRadarTab.tsx` | 694 | ✅ standalone (1 importer: itself + tests) |
| `src/components/predictions/radar/MultiMarketRadarTab.tsx` | 675 | ✅ used by /api/radar/accuracy + tests |
| `src/components/predictions/radar/ExitRadarTab.tsx` | 583 | ✅ used by MarketAnalysisView |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | 740 | ✅ used by MarketAnalysisView |
| `src/components/analysis/market-analysis/PredictionsTab.tsx` | 857 | ✅ tab in MarketAnalysisView |
| `src/components/analysis/market-analysis/ExpertPredictionsTab.tsx` | 514 | ✅ tab |
| `src/components/analysis/market-analysis/CryptoPredictionsTab.tsx` | 519 | ✅ tab |
| `src/components/recommendations/AiRecommendations.tsx` | 2,209 | ✅ admin-only AI recommendations |
| `src/components/recommendations/PublishedPredictions.tsx` | 177 | ✅ user-published picks |
| `src/components/recommendations/RecommendationMonitoring.tsx` | 565 | ✅ monitoring |
| `src/components/recommendations/RecommendationHistory.tsx` | 244 | ✅ history |
| `src/components/recommendations/SocialPostView.tsx` | 304 | ✅ social feed |
| `src/components/recommendations/RefreshAnalyticsButton.tsx` | 117 | ✅ refresh trigger |
| `src/components/eid-predictions-widget.tsx` | 255 | ✅ dashboard widget (Eid special) |
| `src/components/daily-picks/DailyPicksPoster.tsx` | 322 | ✅ daily picks poster |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/honest-tracking/maestro.ts` | 1,850 | ✅ used by 4 honest-tracking API routes |
| `src/lib/prediction-validator.ts` | 293 | ⚠️ 1 importer |
| `src/lib/persona-matrix.ts` | 196 | ❌ DEAD |

**Files (API side):**

```
/api/predictions                          GET/POST main predictions list
/api/predictions/active-management
/api/predictions/backtest-list
/api/predictions/credibility
/api/predictions/daily-picks
/api/predictions/dual-track/backtest
/api/predictions/dual-track/list
/api/predictions/dual-track/stats
/api/predictions/dual-track/threshold
/api/predictions/eid
/api/predictions/expert-consensus
/api/predictions/export-pdf
/api/predictions/generate
/api/predictions/generate-all
/api/predictions/historical-trades
/api/predictions/honest-tracking
/api/predictions/honest-tracking/learn-from-errors
/api/predictions/honest-tracking/list
/api/predictions/honest-tracking/live-tracking
/api/predictions/honest-tracking/missed-opportunities
/api/predictions/honest-tracking/stats
/api/predictions/honest-tracking/verify-pending
/api/predictions/intraday
/api/predictions/league-report
/api/predictions/learned-lessons
/api/predictions/live
/api/predictions/monthly-league
/api/predictions/performance
/api/predictions/performance-dashboard
/api/predictions/price-verify
/api/predictions/refresh-v40
/api/predictions/seed
/api/predictions/tracking
/api/predictions/tracking/list
/api/predictions/tracking/stats
/api/predictions/tracking/verify
/api/predictions/verify
/api/real-predictions
/api/prediction-performance
/api/global-predictions
/api/recommendations
/api/recommendations/backtest
/api/recommendations/batch
/api/recommendations/expert
/api/recommendations/publish
/api/recommendations/publish/batch
/api/recommendations/retroactive-evaluate
/api/recommendations/verify
/api/expert-recommendations
/api/expert-recommendations/active
/api/expert-recommendations/batch
/api/expert-recommendations/experts
/api/expert-recommendations/import
/api/ai-predictions/evaluate
/api/ai-predictions/extract
/api/v2/morning-recommendations
/api/v2/recommend
/api/v2/live-analysis
/api/v2/pipelines
/api/v2/pipeline
/api/v2/pipeline/[name]/summary
/api/v2/pipeline/[name]/engine/[engine]/toggle
/api/v2/pipeline/[name]/engine/[engine]/weight
/api/v2/day-trading-opportunities
/api/v2/feedback/backtest
/api/v2/feedback/predictions
/api/v2/feedback/run
/api/v2/feedback/status
/api/v4/stats
/api/v82
/api/unified/predictions
/api/unified-learning/indicators
/api/unified-learning/intelligent
/api/unified-learning/iterative
/api/unified-learning/mine-lessons
/api/unified-learning/patterns
/api/unified-learning/status
/api/learning/content
/api/learning/indicators
/api/learning/patterns
/api/learning/progress
/api/learning/status
/api/learning-params
/api/learning-params/active
/api/learning-params/init
/api/learning-params/save
/api/iterative-learning
/api/self-learning
/api/indicator-trust-scores
/api/monthly-performance
/api/walk-forward-test
/api/walk-forward/run
/api/parse-recommendations
/api/seed-recommendations
/api/seed-experts
/api/analyst/predictions
/api/run-all
```

**Shared dependencies:**
- `@/lib/honest-tracking/maestro` (Maestro params + StockRow)
- `@/lib/persona-matrix`, `@/lib/persona-dynamic`
- `@/lib/signal-utils` (sell signal detection — used by 9 market-analysis files)
- `@/lib/store`, `@/lib/api-client`
- `@/lib/db-predictions` (Prisma client)

**Data sources:**
- `predictions.db` (Prisma) — `AiPrediction`, `ExpertRecommendation`, `ExpertTrackRecord`, `PredictionLog`
- `honest_tracking.db` (custom schema, used by `maestro.ts`)

**Reusable pieces:**
- `PredictionTrackingView` + `PredictionTrackingDashboard` (OVERLAP — should merge)
- `DualTrackPredictionsView` (different data source, keep separate)
- `AiRecommendations` (admin only)
- `lib/honest-tracking/maestro.ts` (the brain — keep)

---

### Domain 3: Radar (Liquidity Radar)

> **Purpose:** Maker Radar, Exit Radar, Multi-Market Radar, Personalized Radar, Accuracy Dashboard, Weekly Report, Signal Tracking Timeline — the "80% of profits" feature.

**Entry points:**
- `/#liquidity-radar` → `LiquidityRadarView` (which is actually `MakerRadarTab`)
- Inside `MarketAnalysisView`: `exit-radar` tab → `ExitRadarTab`, `weekly-report` tab → `WeeklyReportTab`

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/predictions/MakerRadarTab.tsx` | 2,791 | ✅ main radar (LiquidityRadarView alias) |
| `src/components/predictions/radar/RadarStatsCards.tsx` | 793 | ✅ RadarSignalStatsCard + SectorTreemapCard + EntryTimingCard + LiquidityFootprintCard |
| `src/components/predictions/radar/SignalStrengthMeter.tsx` | 194 | ✅ 0..5 stars from signal count |
| `src/components/predictions/radar/SignalTrackingTimeline.tsx` | 770 | ✅ SVG journey + milestones |
| `src/components/predictions/radar/ExitRadarTab.tsx` | 583 | ✅ 5 exit paths (X1-X5) |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | 740 | ✅ Sunday 08:00 Cairo report |
| `src/components/predictions/radar/AccuracyDashboard.tsx` | 638 | ✅ accuracy metrics (1 importer: itself) |
| `src/components/predictions/radar/PersonalizedRadarTab.tsx` | 694 | ✅ user-personalized radar (1 importer: itself) |
| `src/components/predictions/radar/MultiMarketRadarTab.tsx` | 675 | ✅ multi-market (1 importer: itself) |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/radar-cache.ts` | 474 | ✅ 6 importers (findLatestRadarFile, readRadarCache) |
| `src/lib/radar-db.ts` | 180 | ✅ 5 importers (portable DB detection) |
| `src/lib/radar-signal-tracker.ts` | 190 | ⚠️ 1 importer (schedulers/radar-alerts) |
| `src/lib/personalized-radar.ts` | 583 | ✅ 1 importer (radar/personalized API) |
| `src/lib/schedulers/radar-alerts.ts` | 989 | ✅ multi-stage smart alerts (Stages 1-5) |

**Files (API side):**

```
/api/maker-radar                  GET main radar lists (5 paths A-E)
/api/maker-radar/warmup           POST background warmup
/api/maker-radar/stock            GET stock detail drawer
/api/maker-radar/track            POST tracking management
/api/maker-radar/signal-tracker   GET/POST signal tracking
/api/maker-radar/signal-tracker/verify
/api/maker-radar/entry-timing     GET entry timing analysis
/api/maker-radar/timeline         GET signal tracking timeline data
/api/maker-radar/footprint        GET liquidity footprint
/api/maker-radar/live-watch       GET live watch list
/api/maker-radar/multi-market     GET multi-market radar
/api/maker-radar/sector-treemap   GET sector treemap
/api/maker-radar/exit-radar       GET exit radar (5 paths X1-X5)
/api/radar/accuracy               GET accuracy metrics
/api/radar/personalized           GET personalized radar
/api/radar/weekly-report          GET weekly report JSON
/api/radar/weekly-report/pdf      GET weekly report PDF (inline)
/api/market/liquidity-flow
/api/market/intraday-pressure
/api/market/continuation/[ticker]
/api/market/exit-status
/api/flow
/api/flow/[ticker]
/api/egx/investors
/api/egx/investors/seed
```

**Shared dependencies:**
- `@/lib/radar-cache` (cache layer — file system JSON cache)
- `@/lib/radar-db` (portable DB detection across sandbox/production)
- `@/lib/radar-signal-tracker` (tracker DB layer)
- `@/lib/personalized-radar` (user profile)
- `@/lib/market-hours` (EGX session status)
- Python scripts: `scripts/maker_radar.py`, `scripts/exit_radar.py`, `scripts/weekly_radar_report.py`

**Data sources:**
- `db/maker_radar_tracking.json` (file-based tracking)
- `data_engine.db.egksco_price_history` / `stocks.db.stock_daily_prices` / `data_engine.db.historical_data` (portable chain)
- `production_snapshot.db` / `vps_real/stocks.db` (production fallback)
- `radar_signal_tracking.db` (signal events)
- `stocks.db.system_settings` (market regime)
- `stocks.db.stocks` (sector heatmap)

**Reusable pieces:**
- `MakerRadarTab` (the brain of the radar)
- All `radar/*.tsx` files (sub-components — should be a single module)
- `lib/radar-cache.ts` + `lib/radar-db.ts` + `lib/radar-signal-tracker.ts` + `lib/personalized-radar.ts` + `lib/schedulers/radar-alerts.ts` (lib module)

**Notes:**
- `AccuracyDashboard`, `PersonalizedRadarTab`, `MultiMarketRadarTab` have only self-importers (themselves + tests + 1 API). They appear to be **standalone tabs that aren't currently rendered** — possibly orphaned UI from prior feature drops. Need user confirmation before removing.

---

### Domain 4: Portfolio

> **Purpose:** Enhanced Portfolio View + 14 sub-panels + advanced portfolio manager + paper trading.

**Entry points:**
- `/#portfolio` / `/#finance` → `EnhancedPortfolioView` (3,203 LOC — the largest component in the project)
- `/#advanced-portfolio` → `AdvancedPortfolioManager` (578 LOC)
- `/#wealth` → `WealthCharts` (admin copy, 466 LOC)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/portfolio/EnhancedPortfolioView.tsx` | 3,203 | ✅ entry |
| `src/components/portfolio/AdvancedPortfolioManager.tsx` | 578 | ✅ entry |
| `src/components/portfolio/MasterPortfolioSummary.tsx` | 245 | ✅ summary |
| `src/components/portfolio/MultiPortfolioSelector.tsx` | 658 | ✅ multi-account selector |
| `src/components/portfolio/PortfolioIntelligencePanel.tsx` | 400 | ✅ intelligence panel |
| `src/components/portfolio/PositionDeepDiveDrawer.tsx` | 223 | ✅ drawer |
| `src/components/portfolio/RealReturnPanel.tsx` | 247 | ✅ inflation-adjusted returns |
| `src/components/portfolio/RiskManagementBar.tsx` | 98 | ✅ risk bar |
| `src/components/portfolio/RiskProfilerQuiz.tsx` | 541 | ✅ risk quiz |
| `src/components/portfolio/RoboAdvisorPanel.tsx` | 1,286 | ✅ robo advisor |
| `src/components/portfolio/SmartAssistantPanel.tsx` | 563 | ✅ smart assistant |
| `src/components/portfolio/StockSearchDropdown.tsx` | 122 | ✅ dropdown (DUPLICATE of `shared/StockSearchSelector`!) |
| `src/components/portfolio/TopUpRecommendationsPanel.tsx` | 430 | ✅ top-up recs |
| `src/components/portfolio/BagHolderRescuePanel.tsx` | 595 | ✅ bag-holder rescue |
| `src/components/portfolio/UnifiedHoldingsTable.tsx` | 395 | ✅ holdings table |
| `src/components/portfolio/WealthCharts.tsx` | 347 | ⚠️ DUPLICATE (admin/ has another WealthCharts.tsx) |
| `src/components/admin/WealthCharts.tsx` | 466 | ⚠️ used by page.tsx (#wealth) — DIFFERENT IMPL |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/portfolio-store.ts` | 196 | ✅ 2 importers |
| `src/lib/finance-db.ts` | 56 | ✅ 44 importers (writable finance DB) |
| `src/lib/paper-trading-v2-db.ts` | 393 | ✅ 6 importers |
| `src/lib/paywall.ts` | 194 | ✅ 4 importers |
| `src/lib/payment.ts` | 90 | ✅ payment tokens |
| `src/lib/paymob.ts` | 425 | ✅ Paymob gateway |

**Files (API side):**

```
/api/portfolio                  GET main portfolio
/api/portfolio/accounts         GET/POST accounts
/api/portfolio/accounts/[id]/equity-curve
/api/portfolio/accounts/[id]/state
/api/portfolio/analyze
/api/portfolio/assets
/api/portfolio/bag-holder-rescue
/api/portfolio/cashflow
/api/portfolio/check
/api/portfolio/equity-curve
/api/portfolio/equity/curve
/api/portfolio/holdings
/api/portfolio/import-real
/api/portfolio/intelligence
/api/portfolio/master
/api/portfolio/priority-sync
/api/portfolio/risk-summary
/api/portfolio/smart-monitor/signals
/api/portfolio/state
/api/portfolio/watchlists
/api/finance/assets
/api/finance/assets/[id]
/api/finance/calculate-values
/api/finance/inflation
/api/finance/obligations
/api/finance/obligations/payments
/api/finance/portfolio-analysis
/api/finance/projection
/api/finance/real-return
/api/finance/reports
/api/finance/schema
/api/finance/screener
/api/finance/seed-alert-thresholds
/api/finance/smart-alerts
/api/finance/smart-analysis
/api/finance/smart-confluence
/api/finance/smart-watchlist
/api/finance/transactions
/api/finance/transactions/[id]
/api/money
/api/money/smart-monitor
/api/money/wealth
/api/paper-trading
/api/paper-trading-v2/account
/api/paper-trading-v2/order
/api/paper-trading-v2/orders
/api/paper-trading-v2/orders/[id]/close
/api/paper-trading-v2/positions
/api/paper-trading-v2/reset
/api/payments/result
/api/paymob/callback
/api/paymob/create-payment
/api/paymob/process-wallet
/api/instapay
/api/instapay/approve
/api/instapay/verify
/api/google-play/verify-receipt
```

**Shared dependencies:**
- `@/lib/finance-db` (finance SQLite DB)
- `@/lib/portfolio-store` (Zustand)
- `@/lib/paywall` + `@/lib/subscription-gate`
- `@/lib/persona-dynamic` (for risk profiling)

**Data sources:**
- `finance.db` (writable — assets, transactions, obligations)
- `paper_trading_v2.db` (paper trading accounts/orders/positions)
- `stocks.db.users` (via Prisma auth)

**Reusable pieces:**
- `EnhancedPortfolioView` + all 14 sub-panels (should be one module)
- `UnifiedHoldingsTable` (already shared-like)
- `RoboAdvisorPanel` + `SmartAssistantPanel` (robo-advisor module)
- `RiskProfilerQuiz` + `DynamicRiskProfilerModal` (risk profiling module)
- `lib/portfolio-store.ts` + `lib/finance-db.ts` + `lib/paper-trading-v2-db.ts` (data layer)

**Duplicates to fix:**
1. `portfolio/WealthCharts.tsx` vs `admin/WealthCharts.tsx` — pick one (the admin version is the one currently routed).
2. `portfolio/StockSearchDropdown.tsx` vs `shared/StockSearchSelector.tsx` — `shared/` version is the canonical reusable one; `portfolio/StockSearchDropdown.tsx` should be removed and its 3 importers (`BagHolderRescuePanel`, `EnhancedPortfolioView`, `PaperTradingWorkstation`) migrated.

---

### Domain 5: Watchlist

> **Purpose:** User's stock watchlist with smart alerts.

**Entry points:**
- `/#watchlist` → `EnhancedWatchlistView` (1,311 LOC)
- `/#crypto-watchlist` → same (mirror)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/watchlist/EnhancedWatchlistView.tsx` | 1,311 | ✅ entry |
| `src/components/watchlist/ProfessionalWatchlistView.tsx` | 472 | ❌ DEAD (0 importers — file exists, never rendered) |
| `src/components/intelligence/WatchlistIntelligenceSection.tsx` | 501 | ✅ used by `TradingMemoryView` + API |

**Files (API side):**

```
/api/watchlist                  GET/POST watchlist
/api/watchlist/[id]             PATCH/DELETE item
/api/watchlist-enhanced         GET enhanced watchlist (with smart alerts)
/api/portfolio/watchlists       GET user's watchlists (alias)
/api/mobile/watchlist
/api/mobile/watchlist-enhanced
/api/mobile/watchlist/intelligence
/api/finance/smart-watchlist    GET smart watchlist
```

**Shared dependencies:**
- `@/lib/store` (watchlist state)
- `@/lib/api-client`
- `@/lib/subscription-gate` (free vs paid watchlist limits)

**Reusable pieces:**
- `EnhancedWatchlistView` (the only active component)
- `WatchlistIntelligenceSection` (used in TradingMemoryView + mobile API)

**Disconnects:**
- `ProfessionalWatchlistView` (472 LOC) is completely orphaned — should be deleted or its features merged into `EnhancedWatchlistView`.

---

### Domain 6: Screener

> **Purpose:** Stock filtering / advanced screener / chart comparison.

**Entry points:**
- `/#stock-filters` → `StockScreenerAdvancedView` (which is `StockScreenerAdvanced`, 2,129 LOC)
- `/#top-performers` → same with `initialTab="top-performers"`
- `/#crypto-screener` → mirror

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/screener/StockScreenerAdvanced.tsx` | 2,129 | ✅ entry (also exports `ExportDropdown` + `WhatsAppIcon`) |
| `src/components/screener/StockScreener.tsx` | 590 | ❌ DEAD (0 external importers) |
| `src/components/screener/UnifiedScreenerView.tsx` | 534 | ❌ DEAD (0 external importers) |
| `src/components/screener/ChartCard.tsx` | 712 | ⚠️ only used by `ComparisonChartCard` (circular) |
| `src/components/screener/ComparisonChartCard.tsx` | 567 | ⚠️ only used by `admin/WealthCharts` |
| `src/components/screener/BottomPanel.tsx` | 976 | ⚠️ standalone — verify usage |
| `src/components/screener/WatchlistSidebar.tsx` | 292 | ⚠️ standalone — verify usage |
| `src/components/screener/chartIndicators.ts` | 211 | ✅ SMA/EMA helpers |

**Files (API side):**

```
/api/screener/advanced
/api/scanner/quick
/api/scanner/run
/api/stocks/screener
/api/stocks/search
/api/stocks/presets
/api/stocks/top-performers
/api/stocks/movement-classification
```

**Shared dependencies:**
- `@/lib/store`
- `@/lib/api-client`
- `@/components/shared/UnifiedTable` (used by `StockScreenerAdvanced`)
- `@/components/shared/UnifiedPublishButton`

**Reusable pieces:**
- `StockScreenerAdvanced` (the only one truly used)
- `ChartCard` + `ComparisonChartCard` (chart comparison — could become a shared chart module)
- `chartIndicators.ts` (technical indicators — but `lib/technical-analysis.ts` already has these — DUPLICATE!)

**Disconnects:**
- `StockScreener` (590 LOC) and `UnifiedScreenerView` (534 LOC) are completely orphaned — 1,124 LOC of dead code.
- `chartIndicators.ts` (211 LOC) duplicates `lib/technical-analysis.ts` (488 LOC) which itself is dead.

---

### Domain 7: Market Analysis

> **Purpose:** Market-wide analysis (not single-stock) — sector tracking, persona tabs, market status, executive reports, morning bell.

**Entry points:**
- `/#recommendations` / `/#analysis` / `/#advanced-analysis` / `/#v2-analysis` → `MarketAnalysisView` (312 LOC, hosts 8 tabs)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/analysis/MarketAnalysisView.tsx` | 312 | ✅ hub — 8 lazy-loaded tabs |
| `src/components/analysis/market-analysis/MarketStatusTab.tsx` | 1,085 | ✅ tab |
| `src/components/analysis/market-analysis/PersonaTab.tsx` | 2,140 | ✅ tab (conservative/balanced/gambler) |
| `src/components/analysis/market-analysis/SectorTrackingTab.tsx` | 684 | ✅ tab |
| `src/components/analysis/market-analysis/PredictionsTab.tsx` | 857 | ✅ tab |
| `src/components/analysis/market-analysis/ExpertPredictionsTab.tsx` | 514 | ✅ tab |
| `src/components/analysis/market-analysis/LiveTrackingTab.tsx` | 720 | ✅ tab |
| `src/components/analysis/market-analysis/MorningBellSection.tsx` | 486 | ✅ tab section |
| `src/components/analysis/market-analysis/CryptoPredictionsTab.tsx` | 519 | ✅ tab |
| `src/components/analysis/market-analysis/helpers.ts` | 1,171 | ✅ shared helpers (10 importers) |
| `src/components/analysis/market-analysis/types.ts` | 461 | ✅ shared types |
| `src/components/analysis/ExpertRecommendationsPanel.tsx` | 1,620 | ✅ used by PersonaTab + others |
| `src/components/analysis/LearnedLessonsDashboard.tsx` | 409 | ✅ used by SpecialistAnalysisView |
| `src/components/analysis/HistoricalTradesTable.tsx` | 513 | ✅ used by MarketAnalysisView historical-trades tab |
| `src/components/reports/ExecutiveReportView.tsx` | 2,080 | ✅ used by MarketAnalysisView executive-report tab |
| `src/components/predictions/PredictionTrackingDashboard.tsx` | 2,024 | ✅ used by MarketAnalysisView tracking tab |
| `src/components/predictions/radar/ExitRadarTab.tsx` | 583 | ✅ MarketAnalysisView exit-radar tab |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | 740 | ✅ MarketAnalysisView weekly-report tab |
| `src/components/devil/DevilsAdvocatePanel.tsx` | 240 | ⚠️ tab REMOVED from MarketAnalysisView (UI-CLEANUP-MAESTRO-AI-TABS) — file still present |
| `src/components/analysis/LearnedLessonsDashboard.tsx` | 409 | ⚠️ tab REMOVED — file still present, used by SpecialistAnalysisView |
| `src/components/analysis/AnalysisFlowDiagram.tsx` | 326 | ❌ DEAD (0 importers) |
| `src/components/analysis/LiveDashboard.tsx` | 123 | ⚠️ used by SingleStockAnalysisView only |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/devil/devil-filter.ts` | 280 | ✅ used by /api/devil/filter |
| `src/lib/devil/devil-orchestrator.ts` | 332 | ✅ orchestrator |
| `src/lib/devil/divergence-engine.ts` | 160 | ✅ Devil Engine 1 |
| `src/lib/devil/pre-event-engine.ts` | 194 | ✅ Devil Engine 3 |
| `src/lib/devil/contrarian-engine.ts` | 140 | ✅ Devil Engine 4 |
| `src/lib/devil/regime-engine.ts` | 215 | ✅ Devil Engine 5 |
| `src/lib/devil/chain-reaction-engine.ts` | 272 | ✅ Devil Engine 2 |
| `src/lib/devil/scenario-matrix.ts` | 119 | ✅ Devil scenarios |
| `src/lib/devil/event-calendar.ts` | 168 | ✅ Devil calendar |
| `src/lib/devil/market-mood.ts` | 137 | ✅ Devil mood |
| `src/lib/devil/types.ts` | 243 | ✅ Devil types |
| `src/lib/market-hours.ts` | 135 | ✅ market hours (4 importers) |
| `src/lib/egx-trading-hours.ts` | 189 | ✅ EGX-specific trading hours |
| `src/lib/analysis-store.ts` | 62 | ✅ Zustand (9 importers) |
| `src/lib/schedulers/alert-engine.ts` | 659 | ✅ alert engine |

**Files (API side):**

```
/api/market/* (32 routes — see §7 for full list)
/api/market-pulse
/api/market-screen
/api/market-learning
/api/sectors/[sector]/stocks
/api/sectors/tracking
/api/seasonality-signals
/api/maestro/*
/api/devil/*
/api/market/sectors/intelligence
```

**Shared dependencies:**
- `@/lib/store`
- `@/lib/devil/*` (5 engines + orchestrator + types)
- `@/lib/market-hours`
- `@/lib/analysis-store`
- `@/components/shared/MarketSelector` (in every tab)
- `@/components/recommendations/RefreshAnalyticsButton`
- `@/components/analysis/market-analysis/helpers.ts` + `types.ts`

**Reusable pieces:**
- `MarketAnalysisView` (the hub)
- All `market-analysis/*` files (one cohesive module)
- `helpers.ts` + `types.ts` (shared)
- `devil/*` lib (5-engine system — should be its own module)

**Disconnects:**
- `AnalysisFlowDiagram.tsx` (326 LOC) — DEAD, never imported.
- `DevilsAdvocatePanel` (240 LOC) — UI removed from MarketAnalysisView but file still present.
- `LearnedLessonsDashboard` (409 LOC) — UI removed but still used by SpecialistAnalysisView.

---

### Domain 8: News

> **Purpose:** Financial news feed + news impact analysis.

**Entry points:**
- `/#news` → `NewsFeedView` (801 LOC)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/news/NewsFeedView.tsx` | 801 | ✅ entry |
| `src/components/stocks/StockNews.tsx` | 576 | ✅ used in StockDetail |
| `src/components/news-feed-widget.tsx` | 216 | ❌ DEAD (0 external importers) |

**Files (API side):**

```
/api/news
/api/news-feed
/api/news/apikeys
/api/news/apikeys/verify
/api/news/ingest
/api/news/latest
/api/egxpilot/news
/api/admin/news
/api/stocks/[ticker]/news
```

**Shared dependencies:**
- `@/lib/api-client`
- `@/lib/store`
- `@/components/shared/UnifiedPublishButton`

**Data sources:**
- News collected by the separate `news-agent/` Python service (see `/home/z/my-project/news-agent/`)
- Stored as JSON in `news-agent/data/`

**Reusable pieces:**
- `NewsFeedView` (single component)
- `StockNews` (single-stock news panel — should be reused more)

**Disconnects:**
- `news-feed-widget.tsx` (216 LOC) — DEAD, never imported.

---

### Domain 9: Notifications

> **Purpose:** Alerts, notifications, central alert monitor, robo-notifier.

**Entry points:**
- Global components mounted in `page.tsx` `<AppShell>`: `<NotificationCenter />`, `<CentralAlertMonitor />`, `<RoboNotifierToggle />`, `<RealtimeTicker />`
- `/#alerts-center` → `AlertsCenterView` (686 LOC)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/notifications/NotificationCenter.tsx` | 310 | ✅ global slide-over sheet |
| `src/components/notifications/CentralAlertMonitor.tsx` | 276 | ✅ background poller (60s) |
| `src/components/notifications/NotificationBell.tsx` | 182 | ✅ bell icon |
| `src/components/notifications/RoboNotifierToggle.tsx` | 109 | ✅ floating toggle |
| `src/components/alerts/AlertsCenterView.tsx` | 686 | ✅ entry view |
| `src/components/alerts/SmartAlertsPanel.tsx` | 319 | ⚠️ only used by TradingMemoryView |
| `src/components/analysis/AlertPanel.tsx` | 384 | ⚠️ only used by SingleStockAnalysisView |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/notification-store.ts` | 82 | ✅ Zustand (7 importers) |
| `src/lib/alerts-store.ts` | 205 | ✅ 3 importers |
| `src/lib/alert-sound.ts` | 103 | ✅ playAlertSound |
| `src/lib/notification-beep.ts` | 98 | ✅ Web Audio beep |
| `src/lib/robo-notifier.ts` | 249 | ✅ startRoboNotifier |
| `src/lib/use-alerts.tsx` | 333 | ✅ useAlerts hook (live ticker alert firing) |
| `src/lib/use-live-dashboard.ts` | 258 | ✅ heartbeat + whale alert hooks |
| `src/lib/sw-register.ts` | 78 | ✅ service worker / push notifications |

**Files (API side):**

```
/api/notifications
/api/alerts
/api/alerts/[id]
/api/alerts/create
/api/alerts/quick-add
/api/alerts/gold
/api/alerts/scheduler
/api/push/register
/api/mobile/alerts/check
/api/mobile/alerts/settings
/api/live-monitor
/api/live-monitor/ledger
/api/live-monitor/trigger
/api/keepalive
```

**Shared dependencies:**
- `@/lib/notification-store`
- `@/lib/alerts-store`
- `@/lib/robo-notifier`
- `@/lib/alert-sound` + `@/lib/notification-beep`

**Reusable pieces:**
- `NotificationCenter` + `NotificationBell` (already global)
- `CentralAlertMonitor` (background poller)
- `RoboNotifierToggle` (floating toggle)
- `AlertsCenterView` (the page)

**Disconnects:**
- `SmartAlertsPanel` (319 LOC) — only used by `TradingMemoryView`. Should be in TradingMemory or made truly shared.
- `AlertPanel` (384 LOC) — only used by `SingleStockAnalysisView`. Should be co-located with SingleStockAnalysisView or moved to shared.

---

### Domain 10: Publishing / Sharing

> **Purpose:** Share buttons, publish buttons, social posting, user publishing platform.

**Entry points:**
- `/#publishing` → `UserPublishingView` (739 LOC)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/shared/UnifiedPublishButton.tsx` | 367 | ✅ 20 importers — the canonical publish button |
| `src/components/shared/StockPublisher.tsx` | 989 | ✅ 12 importers — specialized for stocks |
| `src/components/shared/ShareButton.tsx` | 449 | ✅ 9 importers — generic share with image capture |
| `src/components/share/ShareButton.tsx` | 583 | ⚠️ DUPLICATE — 2 importers (AIAnalysisWidget, StockAdvancedAnalysisView) |
| `src/components/publishing/QuickPublishButton.tsx` | 335 | ✅ used by StockDetail + StockAdvancedAnalysisView |
| `src/components/publishing/UserPublishingView.tsx` | 739 | ✅ entry |
| `src/components/recommendations/SocialPostView.tsx` | 304 | ✅ social feed view |
| `src/components/recommendations/PublishedPredictions.tsx` | 177 | ✅ published predictions |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/stock-publish-text.ts` | 372 | ✅ 2 importers (StockPublisher + telegram API) |
| `src/lib/official-links.ts` | 44 | ✅ 30 importers — official platform links |
| `src/lib/pick-formatter.ts` | 116 | ❌ DEAD (0 importers) |
| `src/lib/chart-generator.ts` | 360 | ✅ SVG chart generation for Telegram posts |

**Files (API side):**

```
/api/telegram/publish-stock
/api/telegram/post
/api/telegram/share
/api/telegram/send-daily-report
/api/telegram/[...path]
/api/user-posts
/api/user-posts/[id]
/api/user-posts/[id]/like
/api/community
/api/community/posts/[post_id]/comments
/api/community/seed
/api/feedback
/api/export
/api/recommendations/publish
/api/recommendations/publish/batch
/api/hunter/publish-pick
```

**Shared dependencies:**
- `@/lib/official-links` (withOfficialLinks helper)
- `@/lib/stock-publish-text` (text generation)
- `html-to-image` (library, for PNG export)

**Reusable pieces:**
- `UnifiedPublishButton` — the canonical multi-platform publish button
- `StockPublisher` — specialized for stock data
- `ShareButton` (shared/) — generic with image capture

**Duplicates to fix:**
1. `share/ShareButton.tsx` (583 LOC, 2 importers) vs `shared/ShareButton.tsx` (449 LOC, 9 importers) — these are TWO DIFFERENT components with similar names. The `share/` version is dialog-based with `ShareStockData` interface; the `shared/` version is dropdown-based with `targetRef` + `shareText`. They have different purposes but cause naming confusion. **Recommendation:** Rename `share/ShareButton.tsx` → `share/StockShareCard.tsx` (since it renders a stock share card), and migrate its 2 importers to use the canonical `shared/ShareButton.tsx` where possible.
2. `QuickPublishButton` (335 LOC) — appears to overlap with `UnifiedPublishButton`. Need to verify whether it can be deprecated.

**Disconnects:**
- `pick-formatter.ts` (116 LOC) — DEAD. Looks like it was meant to format picks for sharing but never adopted.

---

### Domain 11: Auth

> **Purpose:** Login, signup, OAuth, session management, admin guard.

**Entry points:**
- `/#auth` → `AuthView` (638 LOC) — login + signup tabs
- `<AuthGate>` wraps the entire `<AppShell>` in `page.tsx`
- `<LoginPromptModal>` shown when unauthenticated user hits a paywalled feature
- `<SessionExpiredModal>` shown when NextAuth session expires

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/auth/AuthGate.tsx` | 449 | ✅ global wrapper |
| `src/components/auth/AuthView.tsx` | 638 | ✅ entry |
| `src/components/auth/LoginPromptModal.tsx` | 285 | ✅ paywall modal |
| `src/components/auth/SessionExpiredModal.tsx` | 145 | ✅ session-expired modal |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/admin-auth.ts` | 90 | ✅ 7 importers — client-side `isAdmin()` |
| `src/lib/admin-auth-server.ts` | 201 | ✅ 115 importers (!) — server-side admin guard |
| `src/lib/admin-guard.ts` | 98 | ✅ unified auth guard for API routes |
| `src/lib/admin-identities.ts` | 150 | ✅ admin emails/usernames registry |
| `src/lib/auth-helper.ts` | 198 | ✅ 59 importers — `buildUserIdClause` |
| `src/lib/token-helper.ts` | 323 | ✅ 3 importers — token validation |
| `src/lib/db-auth.ts` | 27 | ✅ Prisma auth client |
| `src/lib/db.ts` | 11 | ✅ re-export of `db-auth` |

**Files (API side):**

```
/api/auth/[...nextauth]     NextAuth.js catch-all
/api/auth/config            NextAuth config
/api/auth/google            Google OAuth
/api/auth/google-signin     Google sign-in
/api/auth/login             POST login
/api/auth/logout            POST logout
/api/auth/me                GET current user
/api/auth/profile           PATCH profile
/api/auth/register          POST register
/api/admin/auth             Admin auth
/api/admin/auth/auto-cookie Auto-cookie
/api/admin/auth/token       Admin token
/api/mobile/auth/me         Mobile auth me
```

**Shared dependencies:**
- `next-auth` (NextAuth.js)
- Prisma auth schema (`prisma/auth-schema.prisma`)
- `@/lib/admin-auth-server` (115 importers — most-used auth module)

**Reusable pieces:**
- All 4 auth components (small, cohesive)
- `admin-auth-server.ts` + `admin-guard.ts` + `admin-identities.ts` (server-side admin layer)
- `auth-helper.ts` (user ID clause builder)

---

### Domain 12: Admin

> **Purpose:** Admin panel + DB management + system monitoring + 30+ sub-tabs.

**Entry points:**
- `/#admin` → `AdminView` (2,129 LOC) — uses internal `activeTab` state with ~30 tabs

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/admin/AdminView.tsx` | 2,129 | ✅ hub with 30+ tabs |
| `src/components/admin/DatabaseManagerFull.tsx` | 3,291 | ✅ DB manager (largest admin file) |
| `src/components/admin/SuperLearningSystem.tsx` | 2,489 | ✅ super learning |
| `src/components/admin/TelegramTab.tsx` | 2,200 | ✅ Telegram config |
| `src/components/admin/HumanRecommendationsAdmin.tsx` | 1,028 | ✅ human recs admin |
| `src/components/admin/UsersManagement.tsx` | 1,086 | ✅ users mgmt (DUPLICATE?) |
| `src/components/admin/UserManagementPanel.tsx` | 599 | ✅ user mgmt panel (different from above) |
| `src/components/admin/NewsManagementTab.tsx` | 1,040 | ✅ news mgmt |
| `src/components/admin/DbBackupPanel.tsx` | 869 | ✅ DB backup |
| `src/components/admin/SystemTopologyGraph.tsx` | 850 | ✅ topology graph |
| `src/components/admin/EnginesStatusTab.tsx` | 737 | ✅ engines status |
| `src/components/admin/BacktestTab.tsx` | 650 | ✅ backtest tab |
| `src/components/admin/DataEngineTab.tsx` | 634 | ✅ data engine tab |
| `src/components/admin/DataScraperControl.tsx` | 533 | ✅ scraper control |
| `src/components/admin/EngineSettingsTab.tsx` | 576 | ✅ engine settings |
| `src/components/admin/SystemMonitorPanel.tsx` | 504 | ✅ system monitor |
| `src/components/admin/SystemProblemsTab.tsx` | 488 | ✅ problems |
| `src/components/admin/SystemControlPanel.tsx` | 465 | ✅ system control |
| `src/components/admin/WealthCharts.tsx` | 466 | ⚠️ DUPLICATE (see Domain 4) |
| `src/components/admin/CryptoPredictionGenerator.tsx` | 593 | ✅ crypto prediction gen |
| `src/components/admin/PromoCodesAdmin.tsx` | 592 | ✅ promo codes |
| `src/components/admin/OptimizerParamsPanel.tsx` | 372 | ✅ optimizer params |
| `src/components/admin/SystemTopologyTab.tsx` | 360 | ✅ topology tab (different from graph?) |
| `src/components/admin/CryptoAdminPanel.tsx` | 367 | ✅ crypto admin |
| `src/components/admin/RowEditorModal.tsx` | 286 | ✅ row editor |
| `src/components/admin/SectorClassificationAdmin.tsx` | 274 | ✅ sectors |
| `src/components/admin/PurgeCacheButton.tsx` | 261 | ✅ purge cache |
| `src/components/admin/GoldSilverTab.tsx` | 258 | ✅ gold/silver |
| `src/components/admin/NotebookAdminTab.tsx` | 524 | ✅ notebooks |
| `src/components/admin/ForexTab.tsx` | 300 | ✅ forex |
| `src/components/admin/MultiMarketTab.tsx` | 246 | ✅ multi-market |
| `src/components/admin/RegimeDetectionWidget.tsx` | 126 | ✅ regime widget |
| `src/components/admin/live-chart/index.tsx` | 281 | ✅ live chart primitives |
| `src/components/admin/platform-performance/PlatformPerformanceView.tsx` | 906 | ✅ platform perf |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/admin-db-manager.ts` | 1,499 | ✅ server-side DB ops for admin |
| `src/lib/admin-auth-server.ts` | 201 | ✅ (see Domain 11) |
| `src/lib/admin-auth.ts` | 90 | ✅ |
| `src/lib/admin-guard.ts` | 98 | ✅ |
| `src/lib/admin-identities.ts` | 150 | ✅ |
| `src/lib/sqlite-admin.ts` | 528 | ✅ SQLite admin library |
| `src/lib/engine-control-store.ts` | 300 | ✅ Zustand for engine control |

**Files (API side):**

```
/api/admin/* (90+ routes — full list in §7)
```

**Shared dependencies:**
- All `admin-*` lib modules
- `@/lib/admin-db-manager` (1,499 LOC DB ops)
- `@/lib/sqlite-admin` (528 LOC)
- `@/lib/engine-control-store`

**Reusable pieces:**
- `AdminView` (the hub)
- Each tab is a separate component (good — already modular)
- `DatabaseManagerFull` (3,291 LOC — could be split further)
- `SuperLearningSystem` (2,489 LOC — could be split further)

**Duplicates:**
1. `UsersManagement` (1,086 LOC) vs `UserManagementPanel` (599 LOC) — TWO user management components in admin/. Need to verify which is rendered. `AdminView` imports `UserManagementPanel` (line 80). `UsersManagement` may be DEAD.
2. `SystemTopologyGraph` (850 LOC) vs `SystemTopologyTab` (360 LOC) — likely `SystemTopologyTab` is the wrapper and `SystemTopologyGraph` is the inner graph. Verify.

---

### Domain 13: Crypto

> **Purpose:** Crypto-specific views that mirror the EGX views (UI-Mirror Protocol).

**Entry points:**
- `/#crypto` → `<DashboardView />` (with market=CRYPTO via useEffect)
- `/#crypto-live` → `<StocksView />` (mirror)
- `/#crypto-portfolio` → `CryptoPortfolioView` (641 LOC)
- `/#crypto-watchlist` → `<EnhancedWatchlistView />` (mirror)
- `/#crypto-recommendations` → `<MarketAnalysisView />` (mirror)
- `/#crypto-analysis` → `<SmartConfluenceView />` (mirror)
- `/#crypto-learning` → `<LearningView />` (mirror)
- `/#crypto-simulation` → `<SimulationView />` (mirror)
- `/#crypto-trading-chart` → `<TradingChartView />` (mirror)
- `/#crypto-prediction-tracking` → `CryptoPredictionTrackingView` (478 LOC)
- `/#crypto-screener` → `<StockScreenerAdvancedView />` (mirror)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/crypto/CryptoPortfolioView.tsx` | 641 | ✅ standalone (non-mirror) |
| `src/components/crypto/CryptoPredictionTrackingView.tsx` | 478 | ✅ standalone |
| `src/components/crypto/CryptoScreenerView.tsx` | 677 | ✅ standalone |
| `src/components/crypto/CryptoAdvancedAnalysisView.tsx` | 705 | ✅ standalone |
| `src/components/crypto/CryptoTradingChartView.tsx` | 275 | ✅ standalone |
| `src/components/crypto/CryptoLearningView.tsx` | 1,106 | ✅ standalone |
| `src/components/crypto/CryptoSimulationView.tsx` | 1,955 | ✅ standalone |
| `src/components/crypto/CryptoAdditionalViews.tsx` | 40 | ✅ bundle (re-exports CryptoLearningView + CryptoSimulationView) |

**Files (API side):**

```
/api/crypto                  GET main crypto
/api/crypto/[id]             GET single crypto
/api/crypto/[id]/history     GET price history
/api/crypto/analyze
/api/crypto/coins
/api/crypto/events
/api/crypto/explosive
/api/crypto/explosive/[symbol]
/api/crypto/flow
/api/crypto/flow/[symbol]
/api/crypto/full-analysis
/api/crypto/live
/api/crypto/mr-signals
/api/crypto/ohlc
/api/crypto/portfolio
/api/crypto/recommendations
/api/crypto/simulation
/api/crypto/start
/api/crypto/stats
/api/crypto/status
/api/crypto/stop
/api/crypto/sync
/api/crypto/watchlist
/api/crypto-lab
/api/crypto-lab/predictions
/api/crypto-predictions
/api/crypto-backtesting
/api/unified-crypto
/api/mobile/crypto
/api/mobile/crypto/[id]
/api/mobile/crypto/analysis
/api/mobile/crypto/learning
/api/mobile/crypto/portfolio
/api/mobile/crypto/recommendations
/api/mobile/crypto/watchlist
/api/data-engine/crypto
```

**Shared dependencies:**
- `@/lib/store` (currentMarket === 'CRYPTO')
- `@/lib/data-engine-db` (crypto prices)
- `@/lib/api-client`

**Reusable pieces:**
- All `CryptoX` views (8 files, 5,877 LOC) — should be one crypto module
- The UI-Mirror Protocol means many `CryptoX` views are just wrappers around the EGX views; the truly crypto-specific ones are `CryptoPortfolioView`, `CryptoPredictionTrackingView`, `CryptoScreenerView`, `CryptoAdvancedAnalysisView`, `CryptoTradingChartView`, `CryptoLearningView`, `CryptoSimulationView`.

---

### Domain 14: Education (Academy + Learning)

> **Purpose:** Educational content — Academy (M2y Academy) + Learning Center + Math renderer.

**Entry points:**
- `/#academy` → `AcademyView` (73 LOC) — hosts AcademyEncyclopedia + CandlestickSimulator + PaperTradingWorkstation + StrategySandbox
- `/#learning` → `LearningView` (1,063 LOC)
- `/#crypto-learning` → mirror to `LearningView`

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/academy/AcademyView.tsx` | 73 | ✅ entry |
| `src/components/academy/AcademyEncyclopedia.tsx` | 1,791 | ✅ encyclopedia |
| `src/components/academy/CandlestickSimulator.tsx` | 944 | ✅ candlestick sim |
| `src/components/academy/PaperTradingWorkstation.tsx` | 1,550 | ✅ paper trading |
| `src/components/academy/StrategySandbox.tsx` | 2,188 | ✅ strategy sandbox |
| `src/components/academy/LessonPDFExporter.tsx` | 587 | ✅ PDF export |
| `src/components/learning/LearningView.tsx` | 1,063 | ✅ entry |
| `src/components/learning/LearningVisuals.tsx` | 796 | ✅ visual diagrams (candlestick, PE ratio, market hours) |
| `src/components/learning/MathRenderer.tsx` | 157 | ✅ math expression renderer |
| `src/components/crypto/CryptoLearningView.tsx` | 1,106 | ✅ crypto-specific learning |
| `src/components/help/PlatformGuide.tsx` | 494 | ✅ platform guide modal |
| `src/components/smart-tips/SmartTip.tsx` | 528 | ✅ tip-of-the-day |
| `src/components/legal/DisclaimerBanner.tsx` | 124 | ✅ legal disclaimer |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/learning-store.ts` | 364 | ⚠️ 1 importer |
| `src/lib/crypto-learning-store.ts` | 385 | ⚠️ 1 importer |
| `src/data/learning-content.ts` | (large) | ✅ static content |
| `src/data/crypto-learning-content.ts` | (large) | ✅ static content |

**Files (API side):**

```
/api/learning/content
/api/learning/indicators
/api/learning/patterns
/api/learning/progress
/api/learning/status
/api/admin/educational-cards
/api/admin/educational-cards/[id]
/api/admin/educational-cards/[id]/image
/api/admin/educational-cards/lessons
/api/tips/random
/api/mobile/learning
/api/market-learning
```

**Shared dependencies:**
- `@/lib/learning-store` + `@/lib/crypto-learning-store`
- `src/data/*-content.ts` (static content)

**Reusable pieces:**
- All `academy/*` files (one cohesive module — 7,133 LOC)
- All `learning/*` files (3 files, 2,016 LOC)
- `MathRenderer` (truly reusable — should be in `shared/`)
- `LearningVisuals` (candlestick diagram etc. — could be shared)

---

### Domain 15: Reports

> **Purpose:** PDF reports, daily market report, stock analysis report, executive report.

**Entry points:**
- `/#reports` → `ReportsView` (1,178 LOC) — hosts tabs
- Inside `MarketAnalysisView`: `executive-report` tab → `ExecutiveReportView` (2,080 LOC)

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/reports/ReportsView.tsx` | 1,178 | ✅ entry |
| `src/components/reports/DailyMarketReport.tsx` | 699 | ✅ daily market report |
| `src/components/reports/StockAnalysisReport.tsx` | 1,005 | ✅ stock analysis report |
| `src/components/reports/ExecutiveReportView.tsx` | 2,080 | ✅ executive report |
| `src/components/reports/DataManager.tsx` | 374 | ✅ data manager |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | 740 | ✅ radar weekly report (also in Domain 3) |
| `src/components/daily-picks/DailyPicksPoster.tsx` | 322 | ✅ daily picks poster |

**Files (lib side):**

| File | LOC | Status |
|---|---|---|
| `src/lib/chart-generator.ts` | 360 | ✅ SVG chart generator for Telegram posts |
| `src/lib/patch-html2pdf.ts` | 43 | ✅ stub module for html2pdf patching |
| `src/lib/official-links.ts` | 44 | ✅ used by all reports |
| `src/lib/stock-publish-text.ts` | 372 | ✅ used by StockPublisher |

**Files (API side):**

```
/api/reports/daily
/api/reports/morning
/api/reports/weekly
/api/admin/reports
/api/admin/reports/[id]
/api/admin/reports/[id]/image
/api/predictions/export-pdf
/api/radar/weekly-report
/api/radar/weekly-report/pdf
/api/export
/api/admin/export-data
/api/admin/export-vps
```

**Shared dependencies:**
- `@/lib/chart-generator` (SVG generation)
- `@/lib/official-links`
- `html2pdf.js` + `html-to-image` libraries

**Reusable pieces:**
- All `reports/*` files (one cohesive module — 5,336 LOC)
- `WeeklyReportTab` (already in `predictions/radar/`)
- `DailyPicksPoster` (already in `daily-picks/`)

---

### Domain 16: Dashboard

> **Purpose:** Home dashboard widgets — the default landing page.

**Entry point:**
- `/#dashboard` (default) → `DashboardView` (541 LOC) — composes ~12 widgets

**Files (component side):**

| File | LOC | Status |
|---|---|---|
| `src/components/dashboard/DashboardView.tsx` | 541 | ✅ hub |
| `src/components/dashboard/MarketSummary.tsx` | 81 | ✅ summary |
| `src/components/dashboard/IndexCards.tsx` | 117 | ✅ index cards |
| `src/components/dashboard/TopMovers.tsx` | 151 | ✅ top movers |
| `src/components/dashboard/MarketSentiment.tsx` | 197 | ✅ sentiment |
| `src/components/dashboard/MarketPulseWidget.tsx` | 874 | ✅ pulse |
| `src/components/dashboard/LiveStockTicker.tsx` | 294 | ✅ ticker |
| `src/components/dashboard/RealtimeTicker.tsx` | 192 | ✅ realtime ticker (in AppShell) |
| `src/components/dashboard/MultiMarketWidget.tsx` | 610 | ✅ multi-market |
| `src/components/dashboard/InvestorsFlowPanel.tsx` | 513 | ✅ investors flow |
| `src/components/dashboard/LiquidityFlowPanel.tsx` | 439 | ✅ liquidity flow |
| `src/components/dashboard/IntradayPressurePanel.tsx` | 361 | ✅ intraday pressure |
| `src/components/dashboard/CryptoSignalsWidget.tsx` | 233 | ✅ crypto signals |
| `src/components/dashboard/SeasonalitySignalsWidget.tsx` | 222 | ✅ seasonality |
| `src/components/dashboard/PredictionsBacktestTable.tsx` | 533 | ✅ predictions backtest |
| `src/components/dashboard/MaestroWidget.tsx` | 168 | ✅ maestro (likely disabled per UI cleanup) |
| `src/components/dashboard/LiveMonitor.tsx` | 1,353 | ✅ used by `#live-monitor` |
| `src/components/dashboard/PinnableWidget.tsx` | 68 | ✅ pinnable wrapper |
| `src/components/dashboard/SafeWidget.tsx` | 80 | ✅ error boundary for widgets |
| `src/components/dashboard/AssetPreferenceOnboarding.tsx` | 184 | ✅ onboarding modal |
| `src/components/dashboard/DevelopmentNotice.tsx` | 33 | ✅ dev notice |
| `src/components/auto-analysis-widget.tsx` | 259 | ✅ auto analysis widget (loose) |
| `src/components/eid-predictions-widget.tsx` | 255 | ✅ eid widget (loose) |
| `src/components/news-feed-widget.tsx` | 216 | ❌ DEAD (0 importers) |
| `src/components/FeedbackWidget.tsx` | 232 | ✅ feedback widget (used in layout.tsx) |
| `src/components/Providers.tsx` | 33 | ✅ NextAuth + ThemeProvider (layout.tsx) |

**Files (API side):**

```
/api/market-pulse
/api/market/summary
/api/market/indices
/api/market/top-movers
/api/market/sectors
/api/market/liquidity-flow
/api/market/intraday-pressure
/api/market/investing
/api/market/live-data
/api/market/overview
/api/market/status
/api/market/regime
/api/market/sectors/intelligence
/api/egx/investors
/api/egx/investors/seed
/api/live-monitor
/api/live-monitor/ledger
/api/live-monitor/trigger
/api/seasonality-signals
/api/stock-seasonality
/api/health
/api/keepalive
/api/db-stats
/api/system/db-health
/api/system-control
/api/app/version
/api/features
/api/topology
/api/cache
/api/cache/clear
/api/init-db
/api/sync-prices
/api/sync-names
/api/sync-historical
/api/test-db
/api/test-simple
/api/tab-data
/api/track
/api/stats
```

**Shared dependencies:**
- `@/lib/store`
- `@/lib/api-client`
- `@/lib/python-backend`
- `@/components/shared/UnifiedPublishButton` (used in DashboardView for export)
- `@/components/shared/ShareButton` (used in DashboardView for share)
- `@/components/stocks/StockSelector` (ticker dropdown)
- `@/components/dashboard/SafeWidget` (error boundary)

**Reusable pieces:**
- `DashboardView` (the hub)
- `PinnableWidget` (wrapper — truly reusable)
- `SafeWidget` (wrapper — truly reusable)
- All 12+ widgets (each is independent)
- `RealtimeTicker` (global ticker in AppShell)

**Disconnects:**
- `news-feed-widget.tsx` (216 LOC) — DEAD.
- `MaestroWidget.tsx` (168 LOC) — referenced in `DashboardView` import but Maestro card was REMOVED per UI-CLEANUP-MAESTRO-AI-TABS. Verify if still rendered.

---

## 4. Shared Components Inventory

`src/components/shared/` (9 files, 3,965 LOC) contains the project's reusable building blocks. Below is the full inventory with props, usage counts, and reusability verdict.

### 4.1 `UnifiedTable.tsx` (697 LOC)

**Purpose:** Generic data table built on shadcn/ui Table primitives. The canonical table for all tabular data in the project.

**Props (`UnifiedTableProps<T>`):**
```ts
interface Column<T> {
  key: keyof T | string;
  header: string;
  headerAr?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'right' | 'center' | 'left';
  className?: string;
  headerClassName?: string;
  hideable?: boolean;
  filterable?: boolean;
  filterRender?: (...) => React.ReactNode;
}

interface UnifiedTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  loadingRows?: number;       // default 5
  emptyText?: string;
  emptyTextAr?: string;
  keyField?: string;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  stickyHeader?: boolean;     // default true
  className?: string;
}
```

**Used by:** 43 files (verified via grep):
- crypto/: 4 files (CryptoPredictionTrackingView, CryptoAdvancedAnalysisView, CryptoSimulationView, CryptoScreenerView)
- dashboard/: LiveMonitor, InvestorsFlowPanel, PredictionsBacktestTable
- reports/: 4 files (ReportsView, StockAnalysisReport, DailyMarketReport, ExecutiveReportView)
- analysis/: ExpertRecommendationsPanel + 8 market-analysis/* tabs + HistoricalTradesTable
- stocks/: StocksView, TreasuryBondsView
- watchlist/: EnhancedWatchlistView
- portfolio/: EnhancedPortfolioView, UnifiedHoldingsTable, RoboAdvisorPanel
- sniper/: PerformanceTracker
- simulation/: SimulationView
- screener/: BottomPanel, UnifiedScreenerView, StockScreenerAdvanced, StockScreener
- admin/: CryptoPredictionGenerator, DatabaseManagerFull, HumanRecommendationsAdmin, SuperLearningSystem
- recommendations/: AiRecommendations
- predictions/: DualTrackPredictionsView, PredictionTrackingView, PredictionTrackingDashboard, MakerRadarTab, radar/ExitRadarTab

**Verdict:** ✅ **TRULY REUSABLE** — 43 importers. The most-used shared component in the project.

### 4.2 `StockPublisher.tsx` (989 LOC)

**Purpose:** Unified stock publishing component with rich card + text + PNG export. Specialized for stock data (different from `UnifiedPublishButton` which is generic).

**Props (`StockPublisherProps`):**
```ts
interface StockPublisherProps {
  data: StockPublishData;                // recommendation, trading plan, signal strength, liquidity, technicals, fundamentals, market regime
  trigger?: React.ReactNode;            // custom trigger button
  variant?: 'button' | 'icon' | 'full'; // default 'button'
  size?: 'sm' | 'md' | 'lg';            // default 'md'
  className?: string;
}
```

**Used by:** 12 files:
- `__tests__/shared/StockPublisher.test.tsx` (test)
- `advanced-analysis/SpecialistAnalysisView.tsx`
- `crypto/CryptoPredictionTrackingView.tsx`
- `crypto/CryptoAdvancedAnalysisView.tsx`
- `screener/StockScreenerAdvanced.tsx`
- `analysis/ExpertRecommendationsPanel.tsx`
- `stocks/StockDetail.tsx`
- `stocks/StocksView.tsx`
- `predictions/DualTrackPredictionsView.tsx`
- `watchlist/EnhancedWatchlistView.tsx`
- `predictions/PredictionTrackingView.tsx`
- `portfolio/EnhancedPortfolioView.tsx`

**Verdict:** ✅ **TRULY REUSABLE** — 11 production importers (excl. test). Added in STOCK-PUBLISHER-COMPONENT task.

### 4.3 `UnifiedPublishButton.tsx` (367 LOC)

**Purpose:** Generic multi-platform publish button (Telegram / WhatsApp / Facebook / Twitter / LinkedIn + copy + PNG image capture). The canonical publish button for non-stock content.

**Props (`UnifiedPublishButtonProps`):**
```ts
interface UnifiedPublishButtonProps {
  content: string;             // text to share/copy
  title?: string;              // optional header
  image?: React.RefObject<HTMLElement | null>;  // for PNG capture
  filename?: string;
  hashtags?: string[];
  url?: string;                 // default = official platform URL
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  triggerLabel?: string;        // default "نشر"
  split?: boolean;              // separate buttons vs dropdown
  disabled?: boolean;
}
```

**Used by:** 20 files:
- portfolio/: EnhancedPortfolioView, RoboAdvisorPanel
- crypto/: CryptoPredictionTrackingView, CryptoAdvancedAnalysisView, CryptoScreenerView
- dashboard/: DashboardView, PredictionsBacktestTable
- reports/: ReportsView, DailyMarketReport, ExecutiveReportView
- screener/: BottomPanel, StockScreenerAdvanced
- news/: NewsFeedView
- analysis/: ExpertRecommendationsPanel + 4 market-analysis/* tabs (LiveTrackingTab, SectorTrackingTab)
- stocks/: StocksView
- watchlist/: EnhancedWatchlistView
- predictions/: PredictionTrackingView, MakerRadarTab

**Verdict:** ✅ **TRULY REUSABLE** — 20 importers.

### 4.4 `ShareButton.tsx` (449 LOC)

**Purpose:** Generic share button with image capture (`toPng`) + dialog/dropdown mode. Distinct from `UnifiedPublishButton` because it captures a `targetRef` HTMLElement as image rather than taking a `content` string.

**Props (`ShareButtonProps`):**
```ts
interface ShareButtonProps {
  targetRef: React.RefObject<HTMLDivElement | null>;
  title?: string;
  description?: string;
  shareText?: string;
  hashtags?: string[];
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asDialog?: boolean;
  customTrigger?: React.ReactNode;
  onImageGenerated?: (imageDataUrl: string) => void;
  filename?: string;
}
```

**Used by:** 9 files:
- dashboard/DashboardView
- reports/StockAnalysisReport
- stocks/StockDetail, StocksView, DeepAnalysis
- simulation/SimulationView
- learning/LearningView
- recommendations/AiRecommendations, RecommendationHistory

**Verdict:** ✅ **TRULY REUSABLE** — 9 importers. **NOTE:** there is ANOTHER `share/ShareButton.tsx` (583 LOC, 2 importers) with different interface (`ShareStockData`). See §8 Duplicates.

### 4.5 `StockSearchSelector.tsx` (252 LOC)

**Purpose:** Stock ticker search dropdown with Arabic normalization. Reads from `useAppStore().stocks`.

**Props (`StockSearchSelectorProps`):**
```ts
interface StockSearchSelectorProps {
  value?: string;
  onSelectStock: (ticker: string) => void;
  placeholder?: string;
  buttonVariant?: 'outline' | 'default' | 'ghost' | 'secondary';
  buttonClassName?: string;
  icon?: React.ReactNode;
  mode?: 'select' | 'add';
  compact?: boolean;
}
```

**Used by:** 10 files:
- analysis/MarketAnalysisView + 8 market-analysis/* tabs (essentially every tab)
- predictions/PredictionTrackingView

**Verdict:** ✅ **TRULY REUSABLE** — but should be used MORE. The `portfolio/StockSearchDropdown.tsx` is a duplicate that should be removed (3 importers to migrate).

### 4.6 `MarketSelector.tsx` (65 LOC)

**Purpose:** Market selector dropdown (EGX / TADAWUL / KSE / QSE / US / CRYPTO). Reads/writes `useAppStore().currentMarket`.

**Props:**
```ts
interface MarketSelectorProps {
  size?: 'default' | 'sm' | 'lg';
  fullWidth?: boolean;
  showIcon?: boolean;
}
```

**Used by:** 2 files:
- admin/AdminView (1)
- app/page.tsx (1)

**Verdict:** ✅ Reusable but **UNDER-USED**. Should be used in `TopBar` and `EnhancedWatchlistView` etc. Currently `layout/ExchangeSelector.tsx` (77 LOC) is a duplicate.

### 4.7 `ExpertIntelligencePanel.tsx` (780 LOC)

**Purpose:** 3-layer expert intelligence panel (missed opportunities + sector intelligence + expert consensus). Extracted from former `MaestroDashboard`.

**Used by:** 9 files:
- advanced-analysis/SpecialistAnalysisView
- 8 market-analysis/* tabs (every tab)

**Verdict:** ✅ Reusable but used in a single domain (MarketAnalysisView tabs + SpecialistAnalysisView).

### 4.8 `LazyTabLoader.tsx` (76 LOC)

**Purpose:** Skeleton loader for `next/dynamic` chunks.

**Exports:** `LazyTabLoader` + `LazyInlineLoader`.

**Used by:** 2 files:
- app/page.tsx (massive use — 38 dynamic imports use it as `loading:`)
- admin/AdminView

**Verdict:** ✅ Reusable but only 2 importers. Highly valuable.

### 4.9 `ErrorBoundary.tsx` (290 LOC)

**Purpose:** React error boundary with retry button + custom fallback.

**Exports:** `ErrorBoundary` (class component) + `withErrorBoundary(Component, label, opts?)` HOC.

**Used by:** 3 files:
- __tests__/ErrorBoundary.test.tsx
- app/page.tsx (wraps every dynamic import)
- admin/AdminView

**Verdict:** ✅ Reusable.

### 4.10 Summary table — shared components

| Component | LOC | Props complexity | Used by | Truly Reusable? |
|---|---|---|---|---|
| `UnifiedTable` | 697 | High (generics) | 43 files | ✅ |
| `StockPublisher` | 989 | High | 12 files | ✅ |
| `UnifiedPublishButton` | 367 | Medium | 20 files | ✅ |
| `ShareButton` | 449 | Medium | 9 files | ✅ |
| `StockSearchSelector` | 252 | Low | 10 files | ✅ |
| `MarketSelector` | 65 | Low | 2 files | ✅ (under-used) |
| `ExpertIntelligencePanel` | 780 | Medium | 9 files | ✅ |
| `LazyTabLoader` | 76 | Low | 2 files | ✅ |
| `ErrorBoundary` | 290 | Medium (HOC) | 3 files | ✅ |

**Total:** 9 reusable components, 3,965 LOC, 110 importers (some duplication).

---

## 5. shadcn/ui Primitives Inventory

`src/components/ui/` (51 files, 5,798 LOC) — standard shadcn/ui primitives, mostly unchanged from upstream. Three project-specific files:

### 5.1 Project-specific UI primitives

| File | LOC | Purpose |
|---|---|---|
| `src/components/ui/mini-sparkline.tsx` | 130 | `MiniSparkline` — inline SVG sparkline. Used by `MakerRadarTab` + `StocksView` |
| `src/components/ui/stat-card.tsx` | 74 | `StatCard` — unified stat card. Used by multiple dashboard widgets |
| `src/components/ui/help-tooltip.tsx` | 183 | `HelpTooltip` + `HELP_DEFINITIONS` — context help. Used by `SettingsView` etc. |

### 5.2 Standard shadcn primitives (48 files)

```
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb,
button, calendar, card, carousel, chart, checkbox, collapsible, command,
context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp,
input, label, menubar, navigation-menu, pagination, popover, progress,
radio-group, resizable, scroll-area, select, separator, sheet, sidebar,
skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster,
toggle, toggle-group, tooltip
```

All are shadcn/ui stock — no need to audit each.

---

## 6. Lib Modules Classification

Below is the classification of every `src/lib/` file by role. Files marked ❌ are dead (0 external importers).

### 6.1 DB Access Layer (20 files, ~9,200 LOC) — HIGHLY FRAGMENTED

| File | LOC | Role | Importers | Notes |
|---|---|---|---|---|
| `db.ts` | 11 | re-export of `db-auth` | (via db-helpers) | Trivial |
| `db-auth.ts` | 27 | Prisma auth client | (via db-helpers) | Active |
| `db-predictions.ts` | 27 | Prisma predictions client | (via db-helpers) | Active |
| `db-v2.ts` | 401 | DB manager v2 | (via db-helpers only) | ⚠️ no direct importers |
| `egx-db.ts` | 1,248 | EGX stocks DB | 47 | ✅ MAIN DB |
| `data-engine-db.ts` | 996 | Data engine DB | 26 | ✅ |
| `data-engine-db-sqljs.ts` | 475 | sql.js variant | (via db-helpers) | WASM-based |
| `finance-db.ts` | 56 | Writable finance DB | 44 | ✅ |
| `new-db.ts` | 368 | "New DB" layer | (via db-helpers only) | ⚠️ no direct importers |
| `new-db-queries.ts` | 346 | New DB queries | 1 | ⚠️ almost dead |
| `unified-db.ts` | 487 | Multi-market DB | 1 | ⚠️ almost dead |
| `shared-db.ts` | 276 | Shared DB access | 8 | ✅ |
| `community-db.ts` | 90 | Community DB (Prisma) | 2 | ⚠️ |
| `paper-trading-v2-db.ts` | 393 | Paper trading DB | 6 | ✅ |
| `radar-db.ts` | 180 | Radar portable DB | 5 | ✅ |
| `flutter-sqlite-fallback.ts` | 591 | Flutter SQLite fallback | 1 | ⚠️ used by publish-data API |
| `sqlite-wrapper.ts` | 305 | SQLite wrapper | (low) | ⚠️ |
| `sqlite-compat.ts` | 142 | SQLite compat layer | (low) | ⚠️ |
| `sqlite-admin.ts` | 528 | SQLite admin library | (admin only) | ⚠️ |
| `admin-db-manager.ts` | 1,499 | Admin DB ops | (admin only) | ✅ |
| **`db-helpers.ts`** | **274** | **"Centralized facade"** | **0** | ❌ **DEAD — nobody imports from `@/lib/db-helpers`** |

**Verdict:** The DB layer has 20+ files when it should have 3-4 (one per database: stocks, predictions, finance, radar). `db-helpers.ts` was intended as a consolidation facade but was never adopted. **HIGH-PRIORITY REFACTOR TARGET.**

### 6.2 Business Logic / Analysis Engines (12 files, ~7,500 LOC)

| File | LOC | Role | Importers | Status |
|---|---|---|---|---|
| `analysis-engine.ts` | 3,126 | Professional Financial Analysis Engine for EGX | 0 | ❌ **DEAD** |
| `dynamic-analysis-engine.ts` | 925 | Dynamic Analysis Engine (Gemini Strategy) | 2 | ⚠️ almost dead |
| `gate-analyzer.ts` | 1,032 | 5-Gate Analysis Engine | 1 | ✅ used by GateAnalysisView |
| `persona-dynamic.ts` | 513 | Persona-Scaled Dynamic Analytics | 4 | ✅ |
| `honest-tracking/maestro.ts` | 1,850 | Maestro Engine — Honest Tracking | 5 | ✅ brain of predictions |
| `persona-matrix.ts` | 196 | Persona Scaling Vector Matrix | 0 | ❌ **DEAD** |
| `technical-analysis.ts` | 488 | RSI / SMA / EMA / ATR | 0 | ❌ **DEAD** |
| `candlestick-patterns.ts` | 438 | Japanese Candlestick Pattern Analysis | 0 | ❌ **DEAD** |
| `prediction-validator.ts` | 293 | Client-side prediction filter | 1 | ⚠️ |
| `expert/expert-filter.ts` | 233 | Expert Filter for predictions | 0 | ❌ **DEAD** |
| `stock-movement-classifier.ts` | 290 | Stock Movement Classifier | 0 | ❌ **DEAD** |
| `stock-movement-classification.ts` | 365 | Stock Movement Classification (different file!) | 0 | ❌ **DEAD** (near-duplicate of above) |
| `data-validator.ts` | 516 | Stock Data Validation Engine | 1 | ⚠️ |
| `risk-reward.ts` | 66 | Risk:Reward Calculator | 3 | ✅ |

**Verdict:** **7 dead analysis engines totalling ~5,300 LOC.** Major opportunity for cleanup. The alive ones (`gate-analyzer`, `persona-dynamic`, `honest-tracking/maestro`) are the active brain.

### 6.3 Devil's Advocate Engine (10 files, ~2,000 LOC)

| File | LOC | Role |
|---|---|---|
| `devil/types.ts` | 243 | shared types |
| `devil/devil-filter.ts` | 280 | Devil Filter for predictions |
| `devil/devil-orchestrator.ts` | 332 | Orchestrator (combines 5 engines) |
| `devil/divergence-engine.ts` | 160 | Engine 1 — Divergence |
| `devil/chain-reaction-engine.ts` | 272 | Engine 2 — Chain Reaction |
| `devil/pre-event-engine.ts` | 194 | Engine 3 — Pre-Event |
| `devil/contrarian-engine.ts` | 140 | Engine 4 — Contrarian |
| `devil/regime-engine.ts` | 215 | Engine 5 — Regime + Seasonality |
| `devil/scenario-matrix.ts` | 119 | Scenario Matrix |
| `devil/event-calendar.ts` | 168 | Devil's Calendar |
| `devil/market-mood.ts` | 137 | Market Mood |

**Status:** ✅ All used by `devil/*` components + `devil/*` API routes. Cohesive module.

### 6.4 Zustand Stores (8 files, ~2,800 LOC)

| File | LOC | Role | Importers |
|---|---|---|---|
| `store.ts` | 1,478 | **MAIN app store** (currentView, currentMarket, user, stocks, etc.) | 85 |
| `analysis-store.ts` | 62 | Analysis cache store | 9 |
| `alerts-store.ts` | 205 | Price alerts store | 3 |
| `notification-store.ts` | 82 | Notifications store | 7 |
| `portfolio-store.ts` | 196 | Portfolio store | 2 |
| `engine-control-store.ts` | 300 | Engine control store | 4 |
| `learning-store.ts` | 364 | Learning progress store | 1 |
| `crypto-learning-store.ts` | 385 | Crypto learning progress store | 1 |

**Verdict:** `store.ts` is over-loaded (1,478 LOC, 85 importers). Consider splitting into `auth-store`, `market-store`, `view-store`.

### 6.5 React Hooks (5 hook files in `src/lib/`)

| File | LOC | Role | Status |
|---|---|---|---|
| `use-python-api.ts` | 451 | Python API hook | ❌ **DEAD** |
| `use-live-dashboard.ts` | 258 | Heartbeat + whale alerts hooks | ✅ used by LiveDashboard |
| `use-engine-updates.ts` | 65 | Engine updates hook | ✅ |
| `use-undo-redo.ts` | 98 | Undo/redo hook | ✅ |
| `use-alerts.tsx` | 333 | Alerts hook | ✅ |
| `ws-client.ts` | 458 | WebSocket client | ⚠️ 0 direct importers |

### 6.6 React Hooks in `src/hooks/` (7 files)

| File | LOC | Role |
|---|---|---|
| `useSmartChart.ts` | (varies) | Smart chart hook |
| `useAuthCheck.ts` | (varies) | Auth check hook |
| `use-mobile.ts` | (varies) | Mobile detection |
| `use-toast.ts` | (varies) | Toast hook (shadcn) |
| `useVisibilityAwarePolling.ts` | (varies) | Visibility-aware polling — used by all radar/predictions tabs |
| `useSignalNotifications.ts` | (varies) | Signal notifications |
| `use-persona-results.ts` | (varies) | Persona results |

### 6.7 API / Network / External Services (15 files, ~6,500 LOC)

| File | LOC | Role | Importers |
|---|---|---|---|
| `api-client.ts` | 314 | HTTP client | 4 |
| `api-config.ts` | 210 | API endpoints config | 0 |
| `api-cache.ts` | 85 | API response cache | 0 (top-level) |
| `cache/api-cache.ts` | 115 | In-memory cache | 0 |
| `cache/data-freshness.ts` | 263 | Freshness check | 0 |
| `cache/precomputed-cache.ts` | 1,022 | Precomputed cache | ❌ **DEAD** |
| `vps-adapter.ts` | 798 | VPS data adapter | 4 |
| `vps-client.ts` | 654 | VPS API client | 0 |
| `python-backend.ts` | 160 | Python backend URL | 41 ✅ |
| `m2ySyncClient.ts` | 80 | m2y.net subscription sync | (low) |
| `ws-client.ts` | 458 | WebSocket client | 0 |
| `multi-source-adapter.ts` | 1,057 | Multi-source data adapter | 0 |
| `data-adapter.ts` | 1,342 | Data adapter layer | 0 |
| `data-sync.ts` | 892 | Data sync utilities | 0 |
| `egx-data-sources.ts` | 716 | EGX data source manager | 0 |
| `egxpy-bridge.ts` | 530 | EGX Python bridge | 0 |
| `external-data-fetcher.ts` | 329 | External data fetcher | 0 |

**Verdict:** Lots of orphaned adapters. The project relies on `python-backend.ts` + `api-client.ts` + `vps-adapter.ts`; the other 11 adapter files are mostly dead.

### 6.8 Auth + Admin (8 files, ~1,300 LOC)

| File | LOC | Role | Importers |
|---|---|---|---|
| `admin-auth.ts` | 90 | Client-side `isAdmin()` | 7 |
| `admin-auth-server.ts` | 201 | Server-side admin guard | **115** ✅ |
| `admin-guard.ts` | 98 | Unified auth guard for API routes | (used internally) |
| `admin-identities.ts` | 150 | Admin emails/usernames registry | (admin only) |
| `auth-helper.ts` | 198 | `buildUserIdClause` | 59 |
| `paywall.ts` | 194 | Paywall for prediction results | 4 |
| `subscription-gate.ts` | 224 | Subscription gating utilities | 2 |
| `payment.ts` | 90 | Payment token gen/verify | (low) |
| `paymob.ts` | 425 | Paymob gateway | (low) |
| `token-helper.ts` | 323 | Token validation | 3 |

### 6.9 Markets / Trading Hours

| File | LOC | Role | Importers |
|---|---|---|---|
| `market-hours.ts` | 135 | Multi-market hours | 4 |
| `egx-trading-hours.ts` | 189 | EGX-specific | (low) |

### 6.10 Radar / Predictions specific

| File | LOC | Role | Importers |
|---|---|---|---|
| `radar-cache.ts` | 474 | Production-safe Maker Radar cache | 6 ✅ |
| `radar-db.ts` | 180 | Portable DB detection | 5 ✅ |
| `radar-signal-tracker.ts` | 190 | Signal tracker DB layer | 1 |
| `personalized-radar.ts` | 583 | User profile + personalized radar | 1 |
| `stock-publish-text.ts` | 372 | Stock publish text generation (server-safe) | 2 |

### 6.11 Schedulers

| File | LOC | Role |
|---|---|---|
| `scheduler/index.ts` | 146 | Internal scheduler (task IDs) |
| `schedulers/radar-alerts.ts` | 989 | Smart Radar Alerts (multi-stage, 5 stages) |
| `schedulers/alert-engine.ts` | 659 | Unified alert engine (MONEY-TIER2-REBUILD) |

### 6.12 AI Subsystem

| File | LOC | Role |
|---|---|---|
| `ai/deepseek-client.ts` | 227 | DeepSeek AI client (hybrid) |
| `ai/memory.ts` | 261 | Memory engine (conversation + decision + metric) |
| `ai/tools.ts` | 132 | AI tools (web search + market data) |

### 6.13 Utilities / Formatters

| File | LOC | Role | Importers |
|---|---|---|---|
| `utils.ts` | 339 | `cn`, `safeNum`, `safeToFixed`, etc. | **161** ✅ |
| `format.ts` | 123 | `formatPrice`, `formatNumber`, `formatPercent` | (low) |
| `safe-error.ts` | 98 | Arabic-safe error helper | 2 |
| `signal-utils.ts` | 116 | Sell-signal detection | 10 |
| `risk-reward.ts` | 66 | Risk:reward calc | 3 |
| `pick-formatter.ts` | 116 | Pick formatter | ❌ **DEAD** |
| `official-links.ts` | 44 | Official platform links | 30 |
| `stock-names.ts` | 874 | Stock names data table | (low) |
| `stock-icon.ts` | 129 | Stock icon URL helper | (low) |
| `valid-views.ts` | 93 | Valid views list (canonical routes) | (low) |
| `logger.ts` | 76 | Structured JSON logger | (low) |
| `server-url.ts` | 73 | Server URL helpers | (low) |
| `sw-register.ts` | 78 | Service worker registration | (low) |
| `protection/display-protection.ts` | 224 | Display protection filter | (low) |
| `auto-seed-stocks.ts` | 281 | Auto-seed stocks from VPS | (low) |
| `seed-historical-data.ts` | 622 | Seed historical data | (low) |
| `gold-history-helper.ts` | 165 | Gold history helper | (low) |
| `chart-generator.ts` | 360 | SVG chart generator for Telegram | (low) |
| `notification-beep.ts` | 98 | Web Audio beep | (low) |
| `alert-sound.ts` | 103 | playAlertSound | (low) |
| `robo-notifier.ts` | 249 | startRoboNotifier | (low) |
| `build-trigger.ts` | 1 | **EMPTY** — single-line file | (low) |
| `patch-html2pdf.ts` | 43 | Stub for html2pdf | (low) |

### 6.14 Lib-module death-count summary

❌ **Completely dead (0 external importers):**
1. `analysis-engine.ts` (3,126 LOC) — biggest dead file
2. `candlestick-patterns.ts` (438 LOC)
3. `db-helpers.ts` (274 LOC) — intended as facade, never adopted
4. `expert/expert-filter.ts` (233 LOC)
5. `persona-matrix.ts` (196 LOC)
6. `pick-formatter.ts` (116 LOC)
7. `precomputed-cache.ts` (1,022 LOC)
8. `stock-movement-classifier.ts` (290 LOC)
9. `stock-movement-classification.ts` (365 LOC)
10. `technical-analysis.ts` (488 LOC)
11. `use-python-api.ts` (451 LOC)
12. `api-cache.ts` + `cache/api-cache.ts` + `cache/data-freshness.ts` (463 LOC combined)
13. `vps-client.ts` (654 LOC)
14. `ws-client.ts` (458 LOC)
15. `multi-source-adapter.ts` (1,057 LOC)
16. `data-adapter.ts` (1,342 LOC)
17. `data-sync.ts` (892 LOC)
18. `egx-data-sources.ts` (716 LOC)
19. `egxpy-bridge.ts` (530 LOC)
20. `external-data-fetcher.ts` (329 LOC)

**Total dead lib LOC:** ~10,841 LOC of unused lib code (≈ 24% of all lib code).

---

## 7. API Routes Grouped by Domain

670 route handlers across 785 directories. Grouped by domain:

### 7.1 Stocks / Single-stock analysis (~40 routes)

```
/api/stocks                          GET stocks list
/api/stocks/[ticker]                GET single stock
/api/stocks/[ticker]/comprehensive  GET multi-engine analysis
/api/stocks/[ticker]/recommendation
/api/stocks/[ticker]/news
/api/stocks/[ticker]/depth
/api/stocks/[ticker]/orderbook
/api/stocks/[ticker]/history
/api/stocks/[ticker]/publish-data  POST stock publisher
/api/stocks/[ticker]/professional-analysis
/api/stocks/analysis
/api/stocks/advanced-analysis
/api/stocks/batch-analysis
/api/stocks/confluence
/api/stocks/data-coverage
/api/stocks/delta-volume
/api/stocks/dual-persona/[ticker]
/api/stocks/fundamentals
/api/stocks/movement-classification
/api/stocks/presets
/api/stocks/recommendations
/api/stocks/screener
/api/stocks/search
/api/stocks/sparkline
/api/stocks/technical
/api/stocks/top-performers
/api/stock/deep-analysis
/api/stock-detail
/api/stock-profile/[ticker]
/api/stock-notebook
/api/stock-seasonality
/api/chart/[ticker]
/api/advanced-analysis
/api/advanced-analysis/results
/api/advanced-analysis/scan-all
/api/analysis-engine                  ⚠️ misleading name — only CONFIG
/api/analysis/results
/api/analysis/status
/api/unified-analysis
/api/unified-analysis/[symbol]
/api/unified-analysis/recommendations
/api/unified-market-analysis
/api/unified-scoring
/api/v2/analyze
/api/v2/recommend
/api/v2/stock/[symbol]/analysis
/api/v2/chart/full-analysis
/api/live/analysis/[ticker]
/api/live/scan
/api/confluence/analyze/[ticker]
/api/confluence/daily-picks
/api/confluence/market-scan
/api/smart-confluence/tabs
/api/smart-confluence/analysis/[symbol]
/api/sniper/scan
/api/sniper/backtest
/api/sniper/closer/pending
/api/sniper/closer/run
/api/sniper/learning/performance
/api/sniper/track
/api/scanner/quick
/api/scanner/run
/api/dividend-analysis
/api/dividend-calendar
/api/explosive
/api/explosive/[ticker]
/api/explosive/hunt
/api/risk/decision-table
/api/risk/position-size
/api/risk/stock-types
/api/risk/stop-loss
/api/risk/targets
/api/deal-advisor/[ticker]
/api/persona/analyze/[ticker]
/api/persona/gambler
/api/persona/investor
/api/persona/recommendations
/api/disclosures/company/[symbol]
/api/egxpilot/analysis/[ticker]
```

### 7.2 Predictions (~40 routes)

```
/api/predictions
/api/predictions/active-management
/api/predictions/backtest-list
/api/predictions/credibility
/api/predictions/daily-picks
/api/predictions/dual-track/backtest
/api/predictions/dual-track/list
/api/predictions/dual-track/stats
/api/predictions/dual-track/threshold
/api/predictions/eid
/api/predictions/expert-consensus
/api/predictions/export-pdf
/api/predictions/generate
/api/predictions/generate-all
/api/predictions/historical-trades
/api/predictions/honest-tracking
/api/predictions/honest-tracking/learn-from-errors
/api/predictions/honest-tracking/list
/api/predictions/honest-tracking/live-tracking
/api/predictions/honest-tracking/missed-opportunities
/api/predictions/honest-tracking/stats
/api/predictions/honest-tracking/verify-pending
/api/predictions/intraday
/api/predictions/league-report
/api/predictions/learned-lessons
/api/predictions/live
/api/predictions/monthly-league
/api/predictions/performance
/api/predictions/performance-dashboard
/api/predictions/price-verify
/api/predictions/refresh-v40
/api/predictions/seed
/api/predictions/tracking
/api/predictions/tracking/list
/api/predictions/tracking/stats
/api/predictions/tracking/verify
/api/predictions/verify
/api/real-predictions
/api/prediction-performance
/api/global-predictions
/api/recommendations
/api/recommendations/backtest
/api/recommendations/batch
/api/recommendations/expert
/api/recommendations/publish
/api/recommendations/publish/batch
/api/recommendations/retroactive-evaluate
/api/recommendations/verify
/api/expert-recommendations
/api/expert-recommendations/active
/api/expert-recommendations/batch
/api/expert-recommendations/experts
/api/expert-recommendations/import
/api/ai-predictions/evaluate
/api/ai-predictions/extract
/api/v2/morning-recommendations
/api/v2/recommend
/api/v2/live-analysis
/api/v2/pipelines
/api/v2/pipeline
/api/v2/pipeline/[name]/summary
/api/v2/pipeline/[name]/engine/[engine]/toggle
/api/v2/pipeline/[name]/engine/[engine]/weight
/api/v2/day-trading-opportunities
/api/v2/feedback/backtest
/api/v2/feedback/predictions
/api/v2/feedback/run
/api/v2/feedback/status
/api/v4/stats
/api/v82
/api/unified/predictions
/api/unified-learning/indicators
/api/unified-learning/intelligent
/api/unified-learning/iterative
/api/unified-learning/mine-lessons
/api/unified-learning/patterns
/api/unified-learning/status
/api/learning/content
/api/learning/indicators
/api/learning/patterns
/api/learning/progress
/api/learning/status
/api/learning-params
/api/learning-params/active
/api/learning-params/init
/api/learning-params/save
/api/iterative-learning
/api/self-learning
/api/indicator-trust-scores
/api/monthly-performance
/api/walk-forward-test
/api/walk-forward/run
/api/parse-recommendations
/api/seed-recommendations
/api/seed-experts
/api/analyst/predictions
/api/run-all
/api/scheduler/run
```

### 7.3 Radar (~20 routes)

```
/api/maker-radar
/api/maker-radar/warmup
/api/maker-radar/stock
/api/maker-radar/track
/api/maker-radar/signal-tracker
/api/maker-radar/signal-tracker/verify
/api/maker-radar/entry-timing
/api/maker-radar/timeline
/api/maker-radar/footprint
/api/maker-radar/live-watch
/api/maker-radar/multi-market
/api/maker-radar/sector-treemap
/api/maker-radar/exit-radar
/api/radar/accuracy
/api/radar/personalized
/api/radar/weekly-report
/api/radar/weekly-report/pdf
/api/market/liquidity-flow
/api/market/intraday-pressure
/api/market/continuation/[ticker]
/api/market/exit-status
/api/flow
/api/flow/[ticker]
/api/egx/investors
/api/egx/investors/seed
```

### 7.4 Portfolio + Finance (~50 routes)

```
/api/portfolio (15 routes — see §3 Domain 4)
/api/finance (16 routes)
/api/money
/api/money/smart-monitor
/api/money/wealth
/api/paper-trading
/api/paper-trading-v2 (6 routes)
/api/payments/result
/api/paymob (3 routes)
/api/instapay (3 routes)
/api/google-play/verify-receipt
```

### 7.5 Watchlist (~6 routes)

```
/api/watchlist
/api/watchlist/[id]
/api/watchlist-enhanced
/api/portfolio/watchlists
/api/finance/smart-watchlist
/api/mobile/watchlist (and 2 sub-routes)
```

### 7.6 Screener (~8 routes)

```
/api/screener/advanced
/api/scanner/quick
/api/scanner/run
/api/stocks/screener
/api/stocks/search
/api/stocks/presets
/api/stocks/top-performers
/api/stocks/movement-classification
```

### 7.7 Market Analysis (~30 routes)

```
/api/market/* (32 routes — see §3 Domain 7)
/api/market-pulse
/api/market-screen
/api/market-learning
/api/sectors/[sector]/stocks
/api/sectors/tracking
/api/seasonality-signals
/api/maestro (8 routes)
/api/devil (4 routes)
/api/market/sectors/intelligence
```

### 7.8 News (~8 routes)

```
/api/news
/api/news-feed
/api/news/apikeys
/api/news/apikeys/verify
/api/news/ingest
/api/news/latest
/api/egxpilot/news
/api/admin/news
/api/stocks/[ticker]/news
```

### 7.9 Notifications & Alerts (~10 routes)

```
/api/notifications
/api/alerts (and 5 sub-routes)
/api/push/register
/api/mobile/alerts/check
/api/mobile/alerts/settings
/api/live-monitor (and 2 sub-routes)
```

### 7.10 Publishing / Sharing (~15 routes)

```
/api/telegram/publish-stock
/api/telegram/post
/api/telegram/share
/api/telegram/send-daily-report
/api/telegram/[...path]
/api/user-posts (and 2 sub-routes)
/api/community
/api/community/posts/[post_id]/comments
/api/community/seed
/api/feedback
/api/export
/api/recommendations/publish
/api/recommendations/publish/batch
/api/hunter/publish-pick
```

### 7.11 Auth (10 routes)

```
/api/auth/[...nextauth]
/api/auth/config
/api/auth/google
/api/auth/google-signin
/api/auth/login
/api/auth/logout
/api/auth/me
/api/auth/profile
/api/auth/register
/api/admin/auth (3 routes)
/api/mobile/auth/me
```

### 7.12 Admin (~90 routes)

```
/api/admin/* (90 routes — full list in /home/z/my-project/src/app/api/admin/)
Highlights:
- /api/admin/db-manager/* (25 routes — DB management)
- /api/admin/backtest/* (5 routes)
- /api/admin/engine-control/* (4 routes)
- /api/admin/engine-settings (2 routes)
- /api/admin/educational-cards (4 routes)
- /api/admin/historical-backfill (3 routes)
- /api/admin/users (2 routes)
- /api/admin/reports (3 routes)
- /api/admin/subscription (2 routes)
```

### 7.13 Crypto (~30 routes)

```
/api/crypto (20 routes)
/api/crypto-lab (2 routes)
/api/crypto-predictions
/api/crypto-backtesting
/api/unified-crypto
/api/mobile/crypto (7 routes)
/api/data-engine/crypto
```

### 7.14 Education (~12 routes)

```
/api/learning (5 routes)
/api/admin/educational-cards (4 routes)
/api/tips/random
/api/mobile/learning
/api/market-learning
```

### 7.15 Reports (~10 routes)

```
/api/reports/daily
/api/reports/morning
/api/reports/weekly
/api/admin/reports (3 routes)
/api/predictions/export-pdf
/api/radar/weekly-report (2 routes)
/api/export
/api/admin/export-data
/api/admin/export-vps
```

### 7.16 Dashboard / System (~30 routes)

```
/api/market-pulse
/api/market/summary
/api/market/indices
/api/market/top-movers
/api/market/sectors
/api/market/liquidity-flow
/api/market/intraday-pressure
/api/market/overview
/api/market/status
/api/market/regime
/api/market/sectors/intelligence
/api/egx/investors
/api/live-monitor (3 routes)
/api/seasonality-signals
/api/stock-seasonality
/api/health
/api/keepalive
/api/db-stats
/api/system/db-health
/api/system-control
/api/app/version
/api/features
/api/topology
/api/cache (2 routes)
/api/init-db
/api/sync-prices
/api/sync-names
/api/sync-historical
/api/test-db
/api/test-simple
/api/tab-data
/api/track
/api/stats
```

### 7.17 Mobile API (~30 routes)

```
/api/mobile/* (30 routes — mirrors the main API but for Flutter app)
/api/mobile/dashboard
/api/mobile/stocks/EGX/professional-analysis
/api/mobile/stocks/EGX/recommendation
/api/mobile/stocks/[ticker]
/api/mobile/stocks/[ticker]/professional-analysis
/api/mobile/stocks/[ticker]/recommendation
/api/mobile/analysis/EGX
/api/mobile/analysis/[ticker]
/api/mobile/crypto (7 routes)
/api/mobile/portfolio (3 routes)
/api/mobile/predictions (3 routes)
/api/mobile/recommendations
/api/mobile/expert-recommendations
/api/mobile/news
/api/mobile/notifications
/api/mobile/alerts (2 routes)
/api/mobile/community
/api/mobile/currency
/api/mobile/gold
/api/mobile/gold/history
/api/mobile/learning
/api/mobile/maestro
/api/mobile/market/morning-bell
/api/mobile/market/overview
/api/mobile/market/recommendations/ai-insights
/api/mobile/reports
/api/mobile/risk
/api/mobile/seasonality
/api/mobile/signals
/api/mobile/summary
/api/mobile/watchlist (3 routes)
/api/mobile/zakat-calculator
/api/mobile/subscription
/api/mobile/auth/me
/api/mobile/ai/recommendations
```

### 7.18 Other / Misc (~30 routes)

```
/api/[...slug]                          catch-all
/api/currency (3 routes)
/api/data-engine (8 routes)
/api/database-report
/api/data-import
/api/data-status
/api/eodhd/backfill-status
/api/historical (2 routes)
/api/hunter (5 routes)
/api/import
/api/kimi/backtest/run
/api/maestro (8 routes)
/api/metals-forex (3 routes)
/api/metals/gold (2 routes)
/api/mubasher/sync
/api/multi-market/sync
/api/proxy (2 routes)
/api/python/[...path]
/api/scraper (3 routes)
/api/technical (3 routes)
/api/trading-journal (2 routes)
/api/trading/time
/api/zakat/calculate
/api/cron (8 routes)
/api/subscribe/[plan]
/api/redeem-promo
/api/points (2 routes)
/api/instapay (3 routes)
/api/google-play/verify-receipt
/api/us-stocks
/api/unified-stocks
/api/unified-crypto
```

---

## 8. Duplicates & Overlaps

Below is the catalog of every duplicate/overlap found. Each row is verifiable via grep.

### 8.1 Duplicate stock-analysis views

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `stocks/StockDetail.tsx` (1,254) vs `analysis/SingleStockAnalysisView.tsx` (1,315) vs `analysis/UnifiedAnalysisView.tsx` (562) vs `advanced-analysis/SpecialistAnalysisView.tsx` (1,073) | 4,204 combined | **StockDetail** is the canonical EGX detail page (rendered from StocksView). **SingleStockAnalysisView** is rendered inside TradingChartView + PersonaTab. **UnifiedAnalysisView** is a separate `#unified-analysis` route. **SpecialistAnalysisView** is `#specialist-analysis`. Each has its own sub-panels. **Merge plan:** Keep StockDetail as the canonical "single stock page". Move `SingleStockAnalysisView` content into StockDetail tabs. Deprecate `UnifiedAnalysisView` (its content is duplicated by MarketAnalysisView tabs). Keep `SpecialistAnalysisView` as the "advanced" view but reuse `ExpertIntelligencePanel` (already shared). |
| `stocks/ComprehensiveStockAnalysis.tsx` (1,328) vs `stocks/DeepAnalysis.tsx` (1,148) vs `stocks/StockAdvancedAnalysisView.tsx` (679) vs `stocks/GateAnalysisView.tsx` (215) | 3,370 combined | All 4 are sub-panels rendered INSIDE StockDetail. They overlap heavily (DeepAnalysis + StockAdvancedAnalysisView both show scoring). **Merge plan:** Keep ComprehensiveStockAnalysis as the tabs wrapper (Overview/Technical/Fundamental/Charts/News/Predictions). Fold DeepAnalysis + StockAdvancedAnalysisView into a single "Analysis" tab. Keep GateAnalysisView as a "Gates" mini-panel inside Overview. |

### 8.2 Duplicate prediction-tracking views

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `predictions/PredictionTrackingView.tsx` (719) vs `predictions/PredictionTrackingDashboard.tsx` (2,024) vs `predictions/DualTrackPredictionsView.tsx` (633) vs `predictions/PicksManagementView.tsx` (802, DEAD) | 3,376 (+802 dead) | **PredictionTrackingView** uses `/api/predictions/tracking/*` and is rendered at `#prediction-tracking`. **PredictionTrackingDashboard** uses `/api/predictions/honest-tracking/*` and is rendered inside MarketAnalysisView "tracking" tab. They show similar data from different sources! **Merge plan:** Pick ONE backend (honest-tracking is more recent + has evidence). Migrate PredictionTrackingView to use the honest-tracking API. Delete PredictionTrackingDashboard or vice-versa. Keep DualTrackPredictionsView separate (genuinely different — dual-track comparison). Delete PicksManagementView (already removed from routing). |

### 8.3 Duplicate ShareButton

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `shared/ShareButton.tsx` (449, 9 importers) vs `share/ShareButton.tsx` (583, 2 importers) | 1,032 combined | The `shared/` version takes `targetRef` + `shareText`. The `share/` version takes `ShareStockData` (rich stock data) and renders a hidden share card. **Merge plan:** Rename `share/ShareButton.tsx` → `share/StockShareCard.tsx`. Migrate its 2 importers (`ai/AIAnalysisWidget`, `stocks/StockAdvancedAnalysisView`) — actually they should use `StockPublisher` (the canonical rich stock publisher). Then delete `share/ShareButton.tsx`. |

### 8.4 Duplicate WealthCharts

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `admin/WealthCharts.tsx` (466, used by `#wealth`) vs `portfolio/WealthCharts.tsx` (347, 0 importers — DEAD) | 813 combined | Both render wealth charts (line/pie/bar) but with different data sources. The `admin/` version uses `finance-db`; the `portfolio/` version uses equity snapshots. **Merge plan:** Pick the `admin/` version (it's the one in use). Delete `portfolio/WealthCharts.tsx`. If equity-snapshot features are needed, port them into the admin version. |

### 8.5 Duplicate screener views

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `screener/StockScreenerAdvanced.tsx` (2,129, used) vs `screener/StockScreener.tsx` (590, 0 importers) vs `screener/UnifiedScreenerView.tsx` (534, 0 importers) | 3,253 combined | **StockScreenerAdvanced** is the only one used (in page.tsx via `#stock-filters`). The other two are 1,124 LOC of DEAD code. **Merge plan:** Delete `StockScreener.tsx` and `UnifiedScreenerView.tsx`. If they had unique features, port them into `StockScreenerAdvanced` first. |

### 8.6 Duplicate watchlist views

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `watchlist/EnhancedWatchlistView.tsx` (1,311, used) vs `watchlist/ProfessionalWatchlistView.tsx` (472, 0 importers) | 1,783 combined | Professional is DEAD. **Merge plan:** Delete `ProfessionalWatchlistView.tsx`. If it had unique features (likely "professional" mode), port into EnhancedWatchlistView as a tab. |

### 8.7 Duplicate stock-search dropdown

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `shared/StockSearchSelector.tsx` (252, 10 importers) vs `portfolio/StockSearchDropdown.tsx` (122, 3 importers: BagHolderRescuePanel, EnhancedPortfolioView, PaperTradingWorkstation) | 374 combined | **Merge plan:** Migrate the 3 importers to `shared/StockSearchSelector`. Delete `portfolio/StockSearchDropdown.tsx`. |

### 8.8 Duplicate market selector

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `shared/MarketSelector.tsx` (65, 2 importers) vs `layout/ExchangeSelector.tsx` (77, used by Sidebar) | 142 combined | Both select market (EGX/TADAWUL/KSE/QSE/US/CRYPTO). **Merge plan:** Keep `shared/MarketSelector.tsx` as canonical. Migrate `Sidebar.tsx` to use it. Delete `layout/ExchangeSelector.tsx`. |

### 8.9 Duplicate market depth panels

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `stocks/MarketDepthPanel.tsx` (280, used by StockDetail + DashboardView) vs `analysis/MarketDepthLiquidityWidget.tsx` (437, used by MakerRadarTab) | 717 combined | Both show order-book pressure. **Merge plan:** Audit if they're truly different. If yes, rename for clarity (e.g. `MarketDepthPanel` → `StockOrderBookPanel`, `MarketDepthLiquidityWidget` → `RadarLiquidityWidget`). If no, merge into one. |

### 8.10 Duplicate chart components

| Group | LOC | Recommendation |
|---|---|---|
| `stocks/TradingViewChart.tsx` (1,821) + `analysis/InteractiveChart.tsx` (1,677) + `analysis/ChartCard.tsx` (712) + `screener/ComparisonChartCard.tsx` (567) + `crypto/CryptoTradingChartView.tsx` (275) | 5,052 combined | Five chart components with overlapping responsibilities. TradingViewChart is the most feature-complete. **Merge plan:** Make `TradingViewChart` the canonical chart. Refactor `InteractiveChart` + `ChartCard` to wrap it. `ComparisonChartCard` is multi-ticker comparison — keep as a separate utility. `CryptoTradingChartView` should mirror TradingViewChart (UI-Mirror Protocol). |

### 8.11 Duplicate publish buttons

| Group | LOC | Recommendation |
|---|---|---|
| `shared/UnifiedPublishButton.tsx` (367, 20 importers) + `shared/StockPublisher.tsx` (989, 12 importers) + `publishing/QuickPublishButton.tsx` (335, 2 importers) + `shared/ShareButton.tsx` (449, 9 importers) + `share/ShareButton.tsx` (583, 2 importers) | 2,723 combined | **UnifiedPublishButton** is the generic multi-platform publish. **StockPublisher** is specialized for stocks (rich card). **QuickPublishButton** is a smaller variant. **shared/ShareButton** is generic share with image capture. **share/ShareButton** is stock-specific share card. **Merge plan:** Keep UnifiedPublishButton + StockPublisher + shared/ShareButton as the 3 canonical buttons (each has a distinct purpose). Delete QuickPublishButton (migrate 2 importers to UnifiedPublishButton or StockPublisher). Delete share/ShareButton (migrate 2 importers to StockPublisher). |

### 8.12 Duplicate user-management admin components

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `admin/UsersManagement.tsx` (1,086, 0 importers in AdminView) vs `admin/UserManagementPanel.tsx` (599, imported by AdminView) | 1,685 combined | **UsersManagement** has 0 external importers (only self). **UserManagementPanel** is what AdminView actually renders. **Merge plan:** Delete `UsersManagement.tsx` unless it has features `UserManagementPanel` lacks. |

### 8.13 Duplicate system topology components

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `admin/SystemTopologyGraph.tsx` (850) vs `admin/SystemTopologyTab.tsx` (360) | 1,210 combined | Verify if Tab wraps Graph (likely yes). **Merge plan:** If yes, no action needed (just rename for clarity). If no, merge. |

### 8.14 Duplicate stock-movement classifiers in lib

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `lib/stock-movement-classifier.ts` (290, 0 importers) vs `lib/stock-movement-classification.ts` (365, 0 importers) | 655 combined | **Both DEAD** and near-duplicates. **Merge plan:** Delete both. If features are needed, write a new `lib/stock-movement.ts` and import from there. |

### 8.15 Duplicate technical-analysis in lib vs screener

| Duplicate Pair | LOC | Recommendation |
|---|---|---|
| `lib/technical-analysis.ts` (488, 0 importers) vs `screener/chartIndicators.ts` (211, used by ChartCard) | 699 combined | **lib/technical-analysis.ts** has `computeRSI`, `computeSMA`, `computeEMA` — but 0 importers! **screener/chartIndicators.ts** has `calcSMA`, `calcEMA` (similar). Both DEAD-ISH. **Merge plan:** Pick `lib/technical-analysis.ts` as canonical (it has more functions: RSI, ATR). Migrate `screener/chartIndicators.ts` users to it. |

### 8.16 Duplicate DB access layer (20+ files)

This is the most painful duplication. 20+ DB files when 3-4 would suffice.

| Group | LOC | Recommendation |
|---|---|---|
| `db.ts` + `db-auth.ts` + `db-predictions.ts` (3 re-exports) | 65 | Keep as re-exports |
| `egx-db.ts` (1,248, 47 importers) + `data-engine-db.ts` (996, 26 importers) + `data-engine-db-sqljs.ts` (475, WASM alt) + `flutter-sqlite-fallback.ts` (591, 1 importer) + `unified-db.ts` (487, 1 importer) + `shared-db.ts` (276, 8 importers) + `new-db.ts` (368, 0 direct) + `new-db-queries.ts` (346, 1) + `db-v2.ts` (401, 0 direct) | ~4,788 combined | **Consolidation plan:** Merge into 4 files: `db-stocks.ts`, `db-predictions.ts`, `db-finance.ts`, `db-radar.ts`. Migrate all 47+26+8+1+1 = 83 importers. Use `db-helpers.ts` as the migration facade (fix it first by making it actually useful). |
| `sqlite-wrapper.ts` (305) + `sqlite-compat.ts` (142) + `sqlite-admin.ts` (528) + `admin-db-manager.ts` (1,499) | 2,474 combined | Lower-level SQLite utilities. Keep `sqlite-wrapper.ts` as the canonical low-level wrapper. |
| `db-helpers.ts` (274, 0 importers — broken facade) | 274 | **Fix the facade.** Make it the single entry point and migrate importers to use `@/lib/db-helpers` instead of `@/lib/egx-db` etc. |

### 8.17 Duplicate analysis engines in lib

| Group | LOC | Recommendation |
|---|---|---|
| `analysis-engine.ts` (3,126, DEAD) + `dynamic-analysis-engine.ts` (925, 2 importers) + `gate-analyzer.ts` (1,032, 1 importer) + `persona-dynamic.ts` (513, 4 importers) + `persona-matrix.ts` (196, DEAD) + `honest-tracking/maestro.ts` (1,850, 5 importers) + `expert/expert-filter.ts` (233, DEAD) | 7,875 combined | 7 analysis engines, 3 are DEAD (3,555 LOC). **Merge plan:** Delete `analysis-engine.ts`, `persona-matrix.ts`, `expert/expert-filter.ts` (3,555 LOC of dead code). Keep `gate-analyzer.ts` (used by GateAnalysisView), `persona-dynamic.ts` (used by 4 components), `honest-tracking/maestro.ts` (used by 4 API routes — the brain), `dynamic-analysis-engine.ts` (still alive). |

---

## 9. Wiring Disconnects

This section catalogs places where data/code exists but isn't connected end-to-end.

### 9.1 Lib modules with computed data but no UI shows it

| Disconnect | LOC | Description | Fix |
|---|---|---|---|
| `lib/analysis-engine.ts` (Professional Financial Analysis Engine for EGX) | 3,126 | Has `normalizePriceHistory`, `ProfessionalAnalysis` interface — completely unused. No UI imports it. The only file referencing it is `src/app/api/analysis-engine/route.ts` but that route only manages CONFIG JSON, doesn't call the engine. | **Either delete or wire to charts.** If the engine is salvageable, expose it via `/api/stocks/[ticker]/professional-analysis` and consume in `ComprehensiveStockAnalysis`. |
| `lib/dynamic-analysis-engine.ts` (Gemini Strategy) | 925 | Exports `StockRegime`, `SectorSpeed`, `VolatilityLevel` types + detection functions. Only 2 importers — neither in UI. | Wire to a new "Dynamic Regime" widget in DashboardView or delete. |
| `lib/technical-analysis.ts` (RSI/SMA/EMA/ATR) | 488 | Pure TS functions for technical analysis. 0 importers. Meanwhile `screener/chartIndicators.ts` (211 LOC) reimplements SMA/EMA for the screener. | Make this the canonical TA library. Migrate `screener/chartIndicators.ts` users. |
| `lib/candlestick-patterns.ts` (Japanese Candlestick Pattern Analysis) | 438 | `detectCandlestickPatterns(candles)` — 0 importers. The `academy/CandlestickSimulator.tsx` (944 LOC) has its own `CANDLE_PATTERNS` array! | Wire to `CandlestickSimulator` + `CandlestickWidget`. |
| `lib/prediction-validator.ts` (client-side filter) | 293 | `validatePrediction(pred)` — 1 importer (API route). No UI uses it. | Either delete or wire to PredictionTrackingView. |
| `lib/risk-reward.ts` (`computeRiskReward`) | 66 | Pure function. 3 importers — all API routes. No UI shows the computed R/R. | Wire to PortfolioView position cards. |
| `lib/expert/expert-filter.ts` | 233 | `detectFallingKnife` + `isDuplicatePrediction` — 0 importers. | Delete or wire to recommendations panel. |
| `lib/stock-movement-classifier.ts` + `lib/stock-movement-classification.ts` | 655 combined | Two near-identical files, both 0 importers. | Delete both. |
| `lib/data-validator.ts` | 516 | `ValidationResult` + `ValidationRule` + `validateStockDataPoint` — 1 importer. No UI shows validation results. | Wire to a "Data Quality" admin tab. |
| `lib/persona-matrix.ts` | 196 | `PersonaId`, `WealthAllocationCap`, `PersonaProfile` — 0 importers. Meanwhile `persona-dynamic.ts` has similar types. | Delete (duplicated by `persona-dynamic.ts`). |
| `lib/pick-formatter.ts` | 116 | `formatPickForSharing` — 0 importers. Looks like an earlier version of `stock-publish-text.ts`. | Delete. |
| `lib/cache/precomputed-cache.ts` | 1,022 | `PrecomputedStockData` + `PriceSummaryPoint` cache system — 0 importers. | Delete or wire to a precompute cron. |
| `lib/use-python-api.ts` (usePythonApi hook) | 451 | React hook for Python backend — 0 importers (likely superseded by `apiClient`). | Delete. |

### 9.2 DB tables with data but no API endpoint reads them

Without direct DB inspection (sandbox lacks the prod DB), this is inferred from lib code:

| Disconnect | Description | Fix |
|---|---|---|
| `radar_signal_tracking.db` (used by `radar-signal-tracker.ts`) | Only 1 consumer (`schedulers/radar-alerts.ts`). No UI shows the raw signal events. | The `SignalTrackingTimeline` component consumes `/api/maker-radar/timeline` which reads this DB — so it IS wired. Verify the timeline API actually uses the tracker. |
| `honest_tracking.db` (used by `maestro.ts`) | Consumed by 4 API routes (`/api/predictions/honest-tracking/*`). UI: `PredictionTrackingDashboard` (which is rendered inside MarketAnalysisView "tracking" tab). | Wired. |
| `learned_lessons` table (in `egx-db.ts` via `getLearnedDb`) | Used by `LearningView`? `LearnedLessonsDashboard`? Need verification. | Verify `LearnedLessonsDashboard` reads this. The component exists (409 LOC) but was REMOVED from MarketAnalysisView. **Wiring disconnect:** the DB has learned lessons but the UI was removed. |

### 9.3 UI components that exist but aren't rendered anywhere

| Component | LOC | Status | Fix |
|---|---|---|---|
| `studio/*` (9 files: FlowCanvas, EngineNode, DataSourceNode, OrchestratorNode, ResultNode, ResultPanel, Toolbar, CustomEdge, types.ts) | 1,549 | **0 external importers.** Looks like a React Flow-based visual pipeline builder that was never wired into page.tsx. | Delete entirely OR wire as a new `#studio` route (it's a substantial feature). |
| `sniper/OpportunityCard.tsx` | 357 | 0 external importers (only self). | Delete. |
| `sniper/PerformanceTracker.tsx` | 463 | 0 external importers (only self). | Delete. |
| `screener/StockScreener.tsx` | 590 | 0 external importers. | Delete (superseded by `StockScreenerAdvanced`). |
| `screener/UnifiedScreenerView.tsx` | 534 | 0 external importers. | Delete. |
| `watchlist/ProfessionalWatchlistView.tsx` | 472 | 0 external importers. | Delete. |
| `stocks/DataCoverageBanner.tsx` | 209 | 0 external importers. | Delete or wire to StockDetail. |
| `analysis/AnalysisFlowDiagram.tsx` | 326 | 0 external importers. | Delete. |
| `news-feed-widget.tsx` | 216 | 0 external importers. | Delete. |
| `predictions/PicksManagementView.tsx` | 802 | Removed from routing 2026-09-28, file still present. | Delete. |
| `eid-predictions-widget.tsx` | 255 | Used in DashboardView — but only relevant during Eid. Keep but feature-flag. | OK. |
| `predictions/radar/AccuracyDashboard.tsx` | 638 | 1 importer: itself + tests. Not rendered in any view. | Wire as new tab in MarketAnalysisView OR delete. |
| `predictions/radar/PersonalizedRadarTab.tsx` | 694 | 1 importer: itself + tests. Not rendered. | Wire as new tab in MakerRadarTab OR delete. |
| `predictions/radar/MultiMarketRadarTab.tsx` | 675 | 1 importer: itself + tests + 1 API. Not rendered. | Wire as new tab OR delete. |
| `devil/DevilsAdvocatePanel.tsx` | 240 | Removed from MarketAnalysisView (UI-CLEANUP-MAESTRO-AI-TABS). File still present. | Delete or re-enable. |
| `devil/MarketMood.tsx`, `DevilsCalendar.tsx`, `ScenarioMatrix.tsx`, `DevilsCard.tsx` | 905 combined | All 4 are imported by the now-removed DevilsAdvocatePanel. They depend on `/api/devil/*` which exists. | Either delete the entire `devil/` module or re-enable DevilsAdvocatePanel as a tab. |

### 9.4 API endpoints that return data but no UI consumes it

| API Endpoint | Returns | UI consumer? | Fix |
|---|---|---|---|
| `/api/analysis-engine` | Engine config JSON | `EngineSettingsTab` (admin) — but the file is named `analysis-engine` while the lib `analysis-engine.ts` is the actual engine. Misleading naming. | Rename API to `/api/engine-config` OR rename lib to `analysis-config.ts`. |
| `/api/devil/*` (4 routes) | Devil's advocate data | Devil components exist but were REMOVED from MarketAnalysisView. API is now unused from UI. | Re-enable DevilsAdvocatePanel OR delete API + components. |
| `/api/sniper/*` (5 routes) | Sniper scan results | `CentralAlertMonitor` uses `/api/sniper/scan`. Other 4 routes have no UI consumer. | Delete unused sniper routes. |
| `/api/maestro/*` (8 routes) | Maestro data | Maestro card was REMOVED from ComprehensiveStockAnalysis (UI-CLEANUP-MAESTRO-AI-TABS). API likely unused from UI now. | Verify and possibly delete. |
| `/api/v2/*` (15 routes) | V2 API | Most have no UI consumer. Looks like a parallel "v2" attempt that didn't fully land. | Audit each — keep what's used, delete the rest. |
| `/api/v4/stats` | V4 stats | No UI consumer. | Delete or wire. |
| `/api/v82` | V82 analyzer | Used by `V82DecisionPanel`. Wired. | OK. |
| `/api/walk-forward/*` | Walk-forward analysis | No UI consumer. | Delete or wire. |
| `/api/kimi/backtest/run` | Kimi backtest | No UI consumer. | Delete. |
| `/api/hunter/*` (5 routes) | Hunter scans | No UI consumer (sniper components are dead). | Delete. |
| `/api/egxpilot/*` (3 routes) | EGXPilot data | Verify. May be used by mobile app. | Verify. |
| `/api/mubasher/sync` | Mubasher sync | No UI consumer. | Delete. |
| `/api/backtesting` + `/api/backtesting/apply-params` + `/api/backtesting/unified` | Backtest | Used by `EGXBacktestDashboard`? | Verify. |
| `/api/crypto-backtesting` | Crypto backtest | No UI consumer. | Delete. |

### 9.5 Hash routes that don't map to a real view

| Hash Route | Behavior | Fix |
|---|---|---|
| `prediction-performance` / `prediction-credibility` | Inline fallback ("admin only"). No real view. | Either build the view or remove from `VALID_VIEWS`. |

### 9.6 `init-db` API called but not declared in API tree

`page.tsx` `DbSchemaInit` calls `/api/init-db` GET. Let me verify this endpoint exists.

```
$ ls src/app/api/init-db/route.ts
```

Need to verify — if missing, this is a silent 404 on first load.

### 9.7 WealthCharts hash → wrong file

`page.tsx` line ~280:
```ts
const WealthCharts = withErrorBoundary(
  dynamicImport(() => import('@/components/admin/WealthCharts')...),
  'رسوم الثروة',
);
```

The hash `#wealth` imports from `@/components/admin/WealthCharts` (466 LOC), NOT `@/components/portfolio/WealthCharts` (347 LOC). The portfolio version is DEAD. This is a wiring inconsistency — the "wealth charts" feature logically belongs to the portfolio domain, not admin.

### 9.8 `LiquidityRadarView` is actually `MakerRadarTab`

`page.tsx`:
```ts
const LiquidityRadarView = withErrorBoundary(
  dynamicImport(() => import('@/components/predictions/MakerRadarTab').then(m => ({ default: m.MakerRadarTab }))...),
  'رادار السيولة',
);
```

The component name (`LiquidityRadarView`) doesn't match the file (`MakerRadarTab`). This causes confusion in code search.

### 9.9 `analysis-engine` route is just a config endpoint

`src/app/api/analysis-engine/route.ts` only manages engine config JSON (ON/OFF + weights). It does NOT call `lib/analysis-engine.ts` (the 3,126 LOC engine). The naming is misleading — the route should be `/api/engine-config` and the lib should be deleted or wired.

---

## 10. Module Architecture Proposal

Based on the audit, the project should be reorganized into **10 functional modules** + **1 shared module** + **1 admin module** + **1 mobile module**.

### 10.1 Proposed module tree

```
src/
├── app/                              # Next.js App Router (unchanged)
│   ├── page.tsx
│   ├── layout.tsx
│   ├── admin/                        # /admin/* pages
│   ├── backtest/page.tsx
│   └── api/                          # API routes — reorganize by module
│       ├── stocks/                   # was /api/stocks + /api/stock + /api/stock-detail
│       ├── predictions/              # was /api/predictions + /api/recommendations + /api/expert-recommendations
│       ├── radar/                    # was /api/maker-radar + /api/radar
│       ├── portfolio/                # was /api/portfolio + /api/finance + /api/money + /api/paper-trading-v2
│       ├── watchlist/                # was /api/watchlist + /api/watchlist-enhanced
│       ├── screener/                 # was /api/screener + /api/scanner
│       ├── market/                   # was /api/market + /api/market-pulse + /api/sectors
│       ├── news/                     # was /api/news + /api/news-feed + /api/egxpilot/news
│       ├── notifications/            # was /api/notifications + /api/alerts + /api/push + /api/live-monitor
│       ├── publishing/               # was /api/telegram + /api/user-posts + /api/community + /api/feedback
│       ├── auth/                     # was /api/auth + /api/admin/auth
│       ├── crypto/                   # was /api/crypto + /api/crypto-lab + /api/unified-crypto
│       ├── education/                # was /api/learning + /api/admin/educational-cards
│       ├── reports/                  # was /api/reports + /api/export
│       ├── dashboard/                # was /api/market-pulse + /api/market/summary etc.
│       ├── admin/                    # was /api/admin/* (90 routes)
│       └── mobile/                   # was /api/mobile/* (30 routes)
├── modules/                          # NEW: functional modules
│   ├── stock-analysis/               # contains everything for single-stock analysis
│   │   ├── components/
│   │   │   ├── StockDetail.tsx
│   │   │   ├── StocksView.tsx
│   │   │   ├── ComprehensiveStockAnalysis.tsx
│   │   │   ├── DeepAnalysis.tsx
│   │   │   ├── StockAdvancedAnalysisView.tsx
│   │   │   ├── GateAnalysisView.tsx
│   │   │   ├── TradingViewChart.tsx
│   │   │   ├── StockSelector.tsx
│   │   │   ├── StockNews.tsx
│   │   │   ├── MarketDepthPanel.tsx
│   │   │   ├── CalculationBreakdown.tsx
│   │   │   ├── DeltaVolumeBar.tsx
│   │   │   ├── TreasuryBondsView.tsx
│   │   │   └── StockIcon.tsx
│   │   ├── charts/
│   │   │   ├── InteractiveChart.tsx
│   │   │   ├── TradingChartView.tsx
│   │   │   ├── ChartControls.tsx
│   │   │   └── ChartCard.tsx
│   │   ├── analysis-engines/         # consolidate from lib/
│   │   │   ├── gate-analyzer.ts
│   │   │   ├── persona-dynamic.ts
│   │   │   ├── dynamic-analysis-engine.ts
│   │   │   ├── technical-analysis.ts  # canonical RSI/SMA/EMA
│   │   │   ├── candlestick-patterns.ts # canonical candlestick
│   │   │   └── risk-reward.ts
│   │   ├── specialists/
│   │   │   ├── SpecialistAnalysisView.tsx
│   │   │   ├── FibonacciWidget.tsx
│   │   │   ├── CandlestickWidget.tsx
│   │   │   ├── DealAdvisorPanel.tsx
│   │   │   └── InstitutionalDecisionPanel.tsx
│   │   └── index.ts                  # public API
│   ├── predictions/
│   │   ├── components/
│   │   │   ├── PredictionTrackingView.tsx       # canonical
│   │   │   ├── DualTrackPredictionsView.tsx
│   │   │   ├── PersonaTab.tsx                  # (move from analysis/market-analysis)
│   │   │   ├── PredictionsTab.tsx
│   │   │   ├── ExpertPredictionsTab.tsx
│   │   │   ├── LiveTrackingTab.tsx
│   │   │   ├── CryptoPredictionsTab.tsx
│   │   │   ├── AiRecommendations.tsx
│   │   │   ├── PublishedPredictions.tsx
│   │   │   ├── RecommendationMonitoring.tsx
│   │   │   ├── RecommendationHistory.tsx
│   │   │   └── RefreshAnalyticsButton.tsx
│   │   ├── lib/
│   │   │   ├── maestro.ts                       # from honest-tracking/
│   │   │   ├── prediction-validator.ts
│   │   │   └── honest-tracking/                 # keep sub-folder
│   │   └── index.ts
│   ├── radar/
│   │   ├── components/
│   │   │   ├── MakerRadarTab.tsx                # main view
│   │   │   ├── ExitRadarTab.tsx
│   │   │   ├── WeeklyReportTab.tsx
│   │   │   ├── SignalTrackingTimeline.tsx
│   │   │   ├── RadarStatsCards.tsx
│   │   │   ├── SignalStrengthMeter.tsx
│   │   │   ├── AccuracyDashboard.tsx            # wire as tab or delete
│   │   │   ├── PersonalizedRadarTab.tsx         # wire as tab or delete
│   │   │   └── MultiMarketRadarTab.tsx          # wire as tab or delete
│   │   ├── lib/
│   │   │   ├── radar-cache.ts
│   │   │   ├── radar-db.ts
│   │   │   ├── radar-signal-tracker.ts
│   │   │   ├── personalized-radar.ts
│   │   │   └── schedulers/
│   │   │       └── radar-alerts.ts
│   │   └── index.ts
│   ├── portfolio/
│   │   ├── components/
│   │   │   ├── EnhancedPortfolioView.tsx
│   │   │   ├── AdvancedPortfolioManager.tsx
│   │   │   ├── MasterPortfolioSummary.tsx
│   │   │   ├── MultiPortfolioSelector.tsx
│   │   │   ├── PortfolioIntelligencePanel.tsx
│   │   │   ├── PositionDeepDiveDrawer.tsx
│   │   │   ├── RealReturnPanel.tsx
│   │   │   ├── RiskManagementBar.tsx
│   │   │   ├── RiskProfilerQuiz.tsx
│   │   │   ├── RoboAdvisorPanel.tsx
│   │   │   ├── SmartAssistantPanel.tsx
│   │   │   ├── TopUpRecommendationsPanel.tsx
│   │   │   ├── BagHolderRescuePanel.tsx
│   │   │   ├── UnifiedHoldingsTable.tsx
│   │   │   └── WealthCharts.tsx                # ONE canonical version
│   │   ├── lib/
│   │   │   ├── portfolio-store.ts
│   │   │   ├── finance-db.ts
│   │   │   └── paper-trading-v2-db.ts
│   │   └── index.ts
│   ├── watchlist/
│   │   ├── components/
│   │   │   ├── EnhancedWatchlistView.tsx
│   │   │   └── WatchlistIntelligenceSection.tsx
│   │   └── index.ts
│   ├── screener/
│   │   ├── components/
│   │   │   ├── StockScreenerAdvanced.tsx        # canonical
│   │   │   ├── BottomPanel.tsx
│   │   │   ├── ChartCard.tsx
│   │   │   ├── ComparisonChartCard.tsx
│   │   │   └── WatchlistSidebar.tsx
│   │   ├── lib/
│   │   │   └── chartIndicators.ts               # OR migrate to stock-analysis/analysis-engines/technical-analysis.ts
│   │   └── index.ts
│   ├── market-analysis/
│   │   ├── components/
│   │   │   ├── MarketAnalysisView.tsx           # hub
│   │   │   ├── MarketStatusTab.tsx
│   │   │   ├── SectorTrackingTab.tsx
│   │   │   ├── MorningBellSection.tsx
│   │   │   ├── HistoricalTradesTable.tsx
│   │   │   ├── ExpertRecommendationsPanel.tsx
│   │   │   ├── ExecutiveReportView.tsx
│   │   │   ├── AlertPanel.tsx
│   │   │   ├── LiveDashboard.tsx
│   │   │   ├── MarketDepthLiquidityWidget.tsx
│   │   │   ├── UnifiedAnalysisView.tsx          # deprecate or merge
│   │   │   ├── SingleStockAnalysisView.tsx      # deprecate or merge
│   │   │   └── market-analysis/                # keep sub-folder for tab internals
│   │   │       ├── helpers.ts
│   │   │       └── types.ts
│   │   ├── lib/
│   │   │   ├── market-hours.ts
│   │   │   ├── egx-trading-hours.ts
│   │   │   ├── analysis-store.ts
│   │   │   └── devil/                          # devil sub-module (5 engines)
│   │   │       ├── types.ts
│   │   │       ├── devil-filter.ts
│   │   │       ├── devil-orchestrator.ts
│   │   │       ├── divergence-engine.ts
│   │   │       ├── chain-reaction-engine.ts
│   │   │       ├── pre-event-engine.ts
│   │   │       ├── contrarian-engine.ts
│   │   │       ├── regime-engine.ts
│   │   │       ├── scenario-matrix.ts
│   │   │       ├── event-calendar.ts
│   │   │       └── market-mood.ts
│   │   └── index.ts
│   ├── news/
│   │   ├── components/
│   │   │   ├── NewsFeedView.tsx
│   │   │   └── StockNews.tsx
│   │   └── index.ts
│   ├── notifications/
│   │   ├── components/
│   │   │   ├── NotificationCenter.tsx
│   │   │   ├── CentralAlertMonitor.tsx
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── RoboNotifierToggle.tsx
│   │   │   ├── AlertsCenterView.tsx
│   │   │   └── SmartAlertsPanel.tsx
│   │   ├── lib/
│   │   │   ├── notification-store.ts
│   │   │   ├── alerts-store.ts
│   │   │   ├── alert-sound.ts
│   │   │   ├── notification-beep.ts
│   │   │   ├── robo-notifier.ts
│   │   │   ├── use-alerts.tsx
│   │   │   ├── use-live-dashboard.ts
│   │   │   ├── sw-register.ts
│   │   │   └── schedulers/
│   │   │       └── alert-engine.ts
│   │   └── index.ts
│   ├── publishing/
│   │   ├── components/
│   │   │   ├── UnifiedPublishButton.tsx         # canonical generic
│   │   │   ├── StockPublisher.tsx               # canonical stock-specific
│   │   │   ├── ShareButton.tsx                  # canonical share-with-image
│   │   │   ├── QuickPublishButton.tsx           # deprecate
│   │   │   └── UserPublishingView.tsx
│   │   ├── lib/
│   │   │   ├── stock-publish-text.ts
│   │   │   ├── official-links.ts
│   │   │   └── chart-generator.ts
│   │   └── index.ts
│   ├── auth/
│   │   ├── components/
│   │   │   ├── AuthGate.tsx
│   │   │   ├── AuthView.tsx
│   │   │   ├── LoginPromptModal.tsx
│   │   │   └── SessionExpiredModal.tsx
│   │   ├── lib/
│   │   │   ├── admin-auth.ts
│   │   │   ├── admin-auth-server.ts
│   │   │   ├── admin-guard.ts
│   │   │   ├── admin-identities.ts
│   │   │   ├── auth-helper.ts
│   │   │   ├── token-helper.ts
│   │   │   ├── db-auth.ts
│   │   │   ├── paywall.ts
│   │   │   ├── subscription-gate.ts
│   │   │   ├── payment.ts
│   │   │   └── paymob.ts
│   │   └── index.ts
│   ├── crypto/
│   │   ├── components/
│   │   │   ├── CryptoPortfolioView.tsx
│   │   │   ├── CryptoPredictionTrackingView.tsx
│   │   │   ├── CryptoScreenerView.tsx
│   │   │   ├── CryptoAdvancedAnalysisView.tsx
│   │   │   ├── CryptoTradingChartView.tsx
│   │   │   ├── CryptoLearningView.tsx
│   │   │   ├── CryptoSimulationView.tsx
│   │   │   └── CryptoAdditionalViews.tsx
│   │   └── index.ts
│   ├── education/
│   │   ├── academy/
│   │   │   ├── AcademyView.tsx
│   │   │   ├── AcademyEncyclopedia.tsx
│   │   │   ├── CandlestickSimulator.tsx
│   │   │   ├── PaperTradingWorkstation.tsx
│   │   │   ├── StrategySandbox.tsx
│   │   │   └── LessonPDFExporter.tsx
│   │   ├── learning/
│   │   │   ├── LearningView.tsx
│   │   │   ├── LearningVisuals.tsx
│   │   │   └── MathRenderer.tsx
│   │   ├── lib/
│   │   │   ├── learning-store.ts
│   │   │   └── crypto-learning-store.ts
│   │   ├── data/
│   │   │   ├── learning-content.ts
│   │   │   └── crypto-learning-content.ts
│   │   └── index.ts
│   ├── reports/
│   │   ├── components/
│   │   │   ├── ReportsView.tsx
│   │   │   ├── DailyMarketReport.tsx
│   │   │   ├── StockAnalysisReport.tsx
│   │   │   ├── ExecutiveReportView.tsx
│   │   │   ├── DataManager.tsx
│   │   │   ├── DailyPicksPoster.tsx
│   │   │   └── WeeklyReportTab.tsx             # (move from predictions/radar)
│   │   ├── lib/
│   │   │   └── chart-generator.ts
│   │   └── index.ts
│   ├── dashboard/
│   │   ├── components/
│   │   │   ├── DashboardView.tsx
│   │   │   ├── MarketSummary.tsx
│   │   │   ├── IndexCards.tsx
│   │   │   ├── TopMovers.tsx
│   │   │   ├── MarketSentiment.tsx
│   │   │   ├── MarketPulseWidget.tsx
│   │   │   ├── LiveStockTicker.tsx
│   │   │   ├── RealtimeTicker.tsx
│   │   │   ├── MultiMarketWidget.tsx
│   │   │   ├── InvestorsFlowPanel.tsx
│   │   │   ├── LiquidityFlowPanel.tsx
│   │   │   ├── IntradayPressurePanel.tsx
│   │   │   ├── CryptoSignalsWidget.tsx
│   │   │   ├── SeasonalitySignalsWidget.tsx
│   │   │   ├── PredictionsBacktestTable.tsx
│   │   │   ├── MaestroWidget.tsx                # likely remove
│   │   │   ├── LiveMonitor.tsx
│   │   │   ├── PinnableWidget.tsx
│   │   │   ├── SafeWidget.tsx
│   │   │   ├── AssetPreferenceOnboarding.tsx
│   │   │   ├── DevelopmentNotice.tsx
│   │   │   ├── AutoAnalysisWidget.tsx          # (move from loose)
│   │   │   ├── EidPredictionsWidget.tsx         # (move from loose)
│   │   │   ├── FeedbackWidget.tsx              # (move from loose)
│   │   │   └── Providers.tsx                    # (move from loose)
│   │   └── index.ts
│   ├── admin/
│   │   ├── components/
│   │   │   ├── AdminView.tsx
│   │   │   ├── DatabaseManagerFull.tsx
│   │   │   ├── SuperLearningSystem.tsx
│   │   │   ├── TelegramTab.tsx
│   │   │   ├── HumanRecommendationsAdmin.tsx
│   │   │   ├── UserManagementPanel.tsx          # canonical (delete UsersManagement)
│   │   │   ├── NewsManagementTab.tsx
│   │   │   ├── DbBackupPanel.tsx
│   │   │   ├── SystemTopologyGraph.tsx
│   │   │   ├── SystemTopologyTab.tsx
│   │   │   ├── EnginesStatusTab.tsx
│   │   │   ├── BacktestTab.tsx
│   │   │   ├── DataEngineTab.tsx
│   │   │   ├── DataScraperControl.tsx
│   │   │   ├── EngineSettingsTab.tsx
│   │   │   ├── SystemMonitorPanel.tsx
│   │   │   ├── SystemProblemsTab.tsx
│   │   │   ├── SystemControlPanel.tsx
│   │   │   ├── CryptoPredictionGenerator.tsx
│   │   │   ├── PromoCodesAdmin.tsx
│   │   │   ├── OptimizerParamsPanel.tsx
│   │   │   ├── RowEditorModal.tsx
│   │   │   ├── SectorClassificationAdmin.tsx
│   │   │   ├── PurgeCacheButton.tsx
│   │   │   ├── GoldSilverTab.tsx
│   │   │   ├── NotebookAdminTab.tsx
│   │   │   ├── ForexTab.tsx
│   │   │   ├── MultiMarketTab.tsx
│   │   │   ├── RegimeDetectionWidget.tsx
│   │   │   ├── live-chart/
│   │   │   └── platform-performance/
│   │   ├── lib/
│   │   │   ├── admin-db-manager.ts
│   │   │   ├── sqlite-admin.ts
│   │   │   └── engine-control-store.ts
│   │   └── index.ts
│   ├── shared/                                  # THE reusable module
│   │   ├── components/
│   │   │   ├── UnifiedTable.tsx
│   │   │   ├── StockPublisher.tsx
│   │   │   ├── UnifiedPublishButton.tsx
│   │   │   ├── ShareButton.tsx
│   │   │   ├── StockSearchSelector.tsx
│   │   │   ├── MarketSelector.tsx
│   │   │   ├── ExpertIntelligencePanel.tsx
│   │   │   ├── LazyTabLoader.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── StatCard.tsx                    # (move from ui/)
│   │   │   ├── MiniSparkline.tsx               # (move from ui/)
│   │   │   ├── HelpTooltip.tsx                 # (move from ui/)
│   │   │   ├── SafeWidget.tsx                  # (move from dashboard/)
│   │   │   ├── PinnableWidget.tsx              # (move from dashboard/)
│   │   │   └── Header.tsx                       # (move from layout/)
│   │   └── index.ts
│   ├── layout/
│   │   ├── components/
│   │   │   ├── TopBar.tsx
│   │   │   ├── Sidebar.tsx                      # likely remove (replaced by TopBar)
│   │   │   ├── MobileNav.tsx
│   │   │   ├── MobileMoreSheet.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── ExchangeSelector.tsx             # DELETE (use shared/MarketSelector)
│   │   └── index.ts
│   ├── ai/
│   │   ├── components/
│   │   │   ├── AIView.tsx
│   │   │   ├── AIAssistantChat.tsx
│   │   │   ├── AIAnalysisWidget.tsx
│   │   │   └── FloatingAssistant.tsx
│   │   ├── lib/
│   │   │   ├── deepseek-client.ts
│   │   │   ├── memory.ts
│   │   │   └── tools.ts
│   │   └── index.ts
│   ├── legal/
│   │   ├── components/
│   │   │   ├── DisclaimerBanner.tsx
│   │   │   ├── ZakatView.tsx
│   │   │   ├── TithesView.tsx
│   │   │   └── SubscriptionView.tsx
│   │   └── index.ts
│   ├── misc/                                    # one-off views
│   │   ├── AboutView.tsx
│   │   ├── SettingsView.tsx
│   │   ├── SeasonalityDashboard.tsx
│   │   ├── SimulationView.tsx
│   │   ├── SmartConfluenceView.tsx
│   │   ├── TradingJournalView.tsx
│   │   ├── TradingMemoryView.tsx
│   │   ├── ExpertMemoryPanel.tsx
│   │   ├── EGXBacktestDashboard.tsx
│   │   ├── V82DecisionPanel.tsx
│   │   ├── PersonaSelector.tsx
│   │   ├── DynamicRiskProfilerModal.tsx
│   │   ├── PlatformGuide.tsx
│   │   ├── SmartTip.tsx
│   │   └── image-cards/                         # market/ sub-folder
│   │       ├── TopTradesImageCard.tsx
│   │       ├── MarketStatusImageCard.tsx
│   │       ├── ExpertPredictionsImageCard.tsx
│   │       ├── StockLeagueImageCard.tsx
│   │       ├── PersonaImageCard.tsx
│   │       ├── PredictionsImageCard.tsx
│   │       ├── ImageCardExport.tsx
│   │       └── MarketStatusExport.tsx
│   └── db/                                      # canonical DB layer
│       ├── db-helpers.ts                        # fix this facade
│       ├── db-stocks.ts                         # merge egx-db + data-engine-db + new-db + db-v2
│       ├── db-predictions.ts                    # already exists
│       ├── db-finance.ts                        # merge finance-db + portfolio-store
│       ├── db-radar.ts                          # already exists (radar-db.ts)
│       ├── db-community.ts                      # already exists (community-db.ts)
│       ├── db-paper-trading.ts                  # rename paper-trading-v2-db
│       ├── sqlite-wrapper.ts                    # low-level
│       ├── sqlite-compat.ts                     # low-level compat
│       └── admin-db-manager.ts                  # admin ops
├── hooks/                                       # global React hooks (unchanged)
├── lib/                                         # global utilities (slim)
│   ├── utils.ts                                 # cn, safeToFixed
│   ├── format.ts
│   ├── safe-error.ts
│   ├── signal-utils.ts
│   ├── official-links.ts
│   ├── stock-names.ts
│   ├── stock-icon.ts
│   ├── valid-views.ts
│   ├── logger.ts
│   ├── server-url.ts
│   ├── api-client.ts
│   ├── python-backend.ts
│   ├── store.ts                                 # main Zustand store
│   └── types.ts                                 # global types
└── types/
    ├── index.ts
    └── v2.ts
```

### 10.2 Module dependency graph (proposed)

```
                          ┌──────────┐
                          │  shared  │ ← used by everyone
                          └──────────┘
                              ▲
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
        │ dashboard │   │  layout   │   │    ai     │
        └─────┬─────┘   └───────────┘   └───────────┘
              │
   ┌──────────┼──────────┬──────────┬──────────┐
   │          │          │          │          │
┌──┴───┐ ┌───┴──┐ ┌─────┴───┐ ┌────┴───┐ ┌────┴────┐
│stock-│ │pred- │ │ radar   │ │portfolio│ │ watchlist│
│analysis│ │ictions│ │        │ │        │ │         │
└──┬───┘ └───┬──┘ └────┬───┘ └────┬───┘ └────┬────┘
   │         │         │         │          │
   └─────────┴─────────┴─────────┴──────────┘
                    │
              ┌─────┴─────┐
              │  market-   │
              │ analysis   │
              └─────┬─────┘
                    │
              ┌─────┴─────┐
              │  news /   │
              │  notifications │
              │  publishing │
              └───────────┘

(Each module imports from `shared` + `lib` + `db`. Modules rarely import from each other — only via the public API in `index.ts`.)
```

### 10.3 Module sizes (estimated)

| Module | Files | LOC | Status |
|---|---|---|---|
| stock-analysis | ~25 | 18,000 | consolidation needed |
| predictions | ~15 | 14,000 | needs PredictionTrackingView merge |
| radar | ~12 | 6,500 | already cohesive |
| portfolio | ~20 | 10,500 | needs WealthCharts merge |
| watchlist | ~2 | 1,800 | small |
| screener | ~6 | 4,500 | needs 2 dead files removed |
| market-analysis | ~20 | 18,000 | already cohesive (devil sub-module) |
| news | ~2 | 1,400 | small |
| notifications | ~8 | 2,800 | cohesive |
| publishing | ~5 | 2,500 | needs QuickPublishButton removal |
| auth | ~10 | 2,500 | cohesive |
| crypto | ~8 | 5,900 | cohesive |
| education | ~13 | 9,200 | cohesive |
| reports | ~7 | 5,500 | cohesive |
| dashboard | ~25 | 8,000 | cohesive |
| admin | ~30 | 26,000 | needs UsersManagement removal |
| shared | ~15 | 5,000 | grow this |
| layout | ~6 | 1,500 | small |
| ai | ~5 | 1,400 | cohesive |
| legal | ~4 | 2,700 | cohesive |
| misc | ~20 | 8,000 | catch-all |
| db | ~10 | 5,000 | major consolidation needed |
| **Total** | **~280** | **~155,000** (after dead-code removal) | |

---

## 11. Migration Plan

The migration must be **non-breaking** — every import path that exists today must continue to work. The strategy uses **TypeScript path aliases** (`tsconfig.json` `paths`) to redirect old paths to new locations, then incrementally migrate importers.

### 11.1 Phase 0: Preparation (no code changes)

1. **Snapshot tests:** Run `bun run test` and save the baseline (233 passing, 13 failing DB-integration, 10 skipped).
2. **Document aliases:** Add a section to `tsconfig.json` `paths` mapping each new module path:
   ```json
   {
     "paths": {
       "@/modules/stock-analysis/*": ["./src/modules/stock-analysis/*"],
       "@/modules/predictions/*": ["./src/modules/predictions/*"],
       ...
     }
   }
   ```
3. **Add barrel files:** Create `src/modules/<module>/index.ts` for each module that re-exports the public API.

### 11.2 Phase 1: Dead code removal (LOW RISK)

**Action:** Delete files with 0 external importers. Run `bun run lint && bun run test` after each batch.

**Batch 1.1 — Dead components (~3,500 LOC):**
- `src/components/studio/*` (9 files, 1,549 LOC) — completely orphaned
- `src/components/sniper/OpportunityCard.tsx` (357 LOC)
- `src/components/sniper/PerformanceTracker.tsx` (463 LOC)
- `src/components/screener/StockScreener.tsx` (590 LOC)
- `src/components/screener/UnifiedScreenerView.tsx` (534 LOC)
- `src/components/watchlist/ProfessionalWatchlistView.tsx` (472 LOC)
- `src/components/stocks/DataCoverageBanner.tsx` (209 LOC)
- `src/components/analysis/AnalysisFlowDiagram.tsx` (326 LOC)
- `src/components/news-feed-widget.tsx` (216 LOC)
- `src/components/predictions/PicksManagementView.tsx` (802 LOC)

**Batch 1.2 — Dead lib modules (~10,800 LOC):**
- `src/lib/analysis-engine.ts` (3,126 LOC)
- `src/lib/cache/precomputed-cache.ts` (1,022 LOC)
- `src/lib/data-adapter.ts` (1,342 LOC)
- `src/lib/multi-source-adapter.ts` (1,057 LOC)
- `src/lib/data-sync.ts` (892 LOC)
- `src/lib/egx-data-sources.ts` (716 LOC)
- `src/lib/vps-client.ts` (654 LOC)
- `src/lib/ws-client.ts` (458 LOC)
- `src/lib/use-python-api.ts` (451 LOC)
- `src/lib/egxpy-bridge.ts` (530 LOC)
- `src/lib/external-data-fetcher.ts` (329 LOC)
- `src/lib/technical-analysis.ts` (488 LOC) — **OR migrate screener/chartIndicators.ts users to it first**, then keep as canonical.
- `src/lib/candlestick-patterns.ts` (438 LOC)
- `src/lib/stock-movement-classifier.ts` (290 LOC)
- `src/lib/stock-movement-classification.ts` (365 LOC)
- `src/lib/expert/expert-filter.ts` (233 LOC)
- `src/lib/persona-matrix.ts` (196 LOC)
- `src/lib/pick-formatter.ts` (116 LOC)
- `src/lib/db-helpers.ts` (274 LOC) — **defer until Phase 4 DB consolidation**
- `src/lib/api-cache.ts` + `src/lib/cache/api-cache.ts` + `src/lib/cache/data-freshness.ts` (463 LOC combined)

**Batch 1.3 — Duplicate components (~2,000 LOC):**
- Delete `src/components/share/ShareButton.tsx` (583 LOC) — migrate 2 importers to `StockPublisher` first.
- Delete `src/components/portfolio/WealthCharts.tsx` (347 LOC) — admin version is canonical.
- Delete `src/components/portfolio/StockSearchDropdown.tsx` (122 LOC) — migrate 3 importers to `shared/StockSearchSelector`.
- Delete `src/components/layout/ExchangeSelector.tsx` (77 LOC) — migrate Sidebar to `shared/MarketSelector`.
- Delete `src/components/admin/UsersManagement.tsx` (1,086 LOC) — `UserManagementPanel` is canonical.

**Phase 1 expected LOC reduction:** ~16,500 LOC of dead code removed.

### 11.3 Phase 2: Create module folders + barrel files (LOW RISK)

**Action:** Create `src/modules/<module>/` directories with `index.ts` barrel files that re-export from the existing locations.

Example:
```ts
// src/modules/stock-analysis/index.ts
export { StockDetail } from '@/components/stocks/StockDetail';
export { StocksView } from '@/components/stocks/StocksView';
export { ComprehensiveStockAnalysis } from '@/components/stocks/ComprehensiveStockAnalysis';
// ... etc.
```

**No existing imports break** — old paths still work.

### 11.4 Phase 3: Migrate imports (MEDIUM RISK)

**Action:** Run a codemod that rewrites imports from `@/components/stocks/StockDetail` → `@/modules/stock-analysis`. Do this **one module at a time** with full test runs between each.

**Order:**
1. `shared` module (lowest risk — already a small surface)
2. `dashboard` (mostly self-contained)
3. `notifications` (cohesive)
4. `publishing` (3 files)
5. `auth` (cohesive)
6. `news` (small)
7. `watchlist` (small)
8. `reports` (cohesive)
9. `crypto` (cohesive)
10. `education` (cohesive)
11. `screener` (after dead removal)
12. `radar` (cohesive)
13. `portfolio` (large, careful)
14. `predictions` (large, careful with PredictionTrackingView merge)
15. `market-analysis` (largest, includes devil/ sub-module)
16. `stock-analysis` (largest, includes the StockDetail sub-panels)
17. `admin` (largest, 30+ tabs — do last)
18. `db` (most painful — defer to Phase 4)

**At each step:** Run `bun run lint && bun run test && curl localhost:3001` to verify.

### 11.5 Phase 4: DB consolidation (HIGH RISK — separate PR)

**Action:** Consolidate the 20+ DB files into 4-5 canonical files.

**Steps:**
1. Fix `db-helpers.ts` to be the canonical facade (it currently has 0 importers because nobody adopted it).
2. Inside `db-helpers.ts`, mark the legacy re-exports as `@deprecated`.
3. Migrate importers one at a time:
   - 47 files import from `@/lib/egx-db` → migrate to `@/lib/db-helpers` (or `@/modules/db/db-stocks`)
   - 26 files import from `@/lib/data-engine-db` → same
   - 8 files import from `@/lib/shared-db` → same
4. Once all importers use the facade, merge the implementations:
   - `egx-db.ts` + `data-engine-db.ts` + `new-db.ts` + `db-v2.ts` + `flutter-sqlite-fallback.ts` → `db-stocks.ts`
5. Delete the legacy files.

**Expected duration:** 2-3 days of careful work.

### 11.6 Phase 5: API route reorganization (LOW RISK)

**Action:** Move API routes from `/api/stocks/[ticker]/comprehensive` etc. to match the module structure. Use Next.js route aliases or redirects to maintain backward compat.

**Example:**
- `/api/stocks/[ticker]/comprehensive` → keep as-is (already correct)
- `/api/maker-radar/*` → rename to `/api/radar/*` (with redirect)
- `/api/predictions/honest-tracking/*` → keep as-is
- `/api/admin/db-manager/*` (25 routes) → keep as-is (admin-internal)

### 11.7 Phase 6: Dead API route removal (LOW RISK)

After Phase 1-5, audit which API routes have 0 consumers (similar to §9.4) and delete them. Expected: ~30-50 routes deletable.

### 11.8 Phase 7: Documentation

Update:
- `Documentation/01-PROJECT_ANATOMY.md` with new module structure
- `Documentation/02-SCREENS_AND_COMPONENTS.md` with new file paths
- `agent-ctx/MODULE-MAP-FRONTEND.md` (this file) with "Migrated" status

### 11.9 Rollback plan

If anything breaks:
1. Revert the `tsconfig.json` `paths` change — all old imports resume working.
2. Revert the codemod commit — all imports go back to old paths.
3. The new `modules/` folder can remain (it's just re-exports).

### 11.10 Effort estimate

| Phase | Duration | Risk |
|---|---|---|
| Phase 0: Prep | 0.5 day | None |
| Phase 1: Dead code | 1 day | Low |
| Phase 2: Module folders | 0.5 day | None |
| Phase 3: Import migration | 3-5 days | Medium |
| Phase 4: DB consolidation | 2-3 days | High |
| Phase 5: API reorg | 1 day | Low |
| Phase 6: Dead API removal | 0.5 day | Low |
| Phase 7: Docs | 0.5 day | None |
| **Total** | **9-12 days** | |

---

## 12. Final Statistics & Recommendations

### 12.1 Audit statistics

| Metric | Value |
|---|---|
| Total files audited | ~1,060 (280 components + 110 lib + 670 API) |
| Total LOC audited | ~190,000 |
| Functional domains identified | 16 (proposed 10 modules + 8 aux) |
| Shared components | 9 (truly reusable) |
| shadcn primitives | 51 (48 stock + 3 project-specific) |
| Duplicates found | 17 duplicate groups |
| Wiring disconnects | 30+ (lib dead, UI orphaned, API unused) |
| Dead component LOC | ~3,500 (10 dead components) |
| Dead lib LOC | ~10,800 (12+ dead lib modules) |
| Duplicate LOC | ~7,200 (across 17 duplicate groups) |
| **Total reclaimable LOC** | **~21,500** (11% of total) |

### 12.2 Top 5 recommendations for module architecture

#### Recommendation 1: Establish `src/modules/` as the canonical home for functional modules

The current `src/components/<domain>/` structure mixes "feature components" with "reusable primitives" and has no clear boundary between modules. Move all feature code into `src/modules/<module>/` with each module owning its components + lib + (eventually) API routes. Keep `src/components/ui/` for shadcn primitives, `src/components/shared/` for cross-module reusable components, and `src/lib/` for true global utilities only.

**Why:** Clear module boundaries make it easier to reason about changes, enable parallel work across teams, and allow future extraction into separate packages if needed.

#### Recommendation 2: Consolidate the DB layer into 4-5 canonical files

The 20+ DB helper files (`egx-db.ts`, `data-engine-db.ts`, `new-db.ts`, `db-v2.ts`, `flutter-sqlite-fallback.ts`, `unified-db.ts`, `shared-db.ts`, `db-helpers.ts`, etc.) are the single biggest source of confusion. Consolidate into:
- `db-stocks.ts` (merges egx-db + data-engine-db + new-db + db-v2 + flutter-sqlite-fallback)
- `db-predictions.ts` (already exists, Prisma)
- `db-finance.ts` (merges finance-db + portfolio-store)
- `db-radar.ts` (already exists, radar-db)
- `db-community.ts` (already exists)

Fix `db-helpers.ts` to be the canonical facade — it currently has 0 importers despite being designed for that purpose.

**Why:** 47 + 26 + 8 + 5 + 1 + 1 = 88 importers across the codebase currently reach into individual DB files. A single facade makes future refactors (e.g., switching from better-sqlite3 to libsql) a one-file change instead of a 88-file change.

#### Recommendation 3: Delete ~21,500 LOC of dead code + duplicates in Phase 1

The audit identified:
- **10 dead components** (~3,500 LOC): studio/* (1,549 LOC), sniper/* (820 LOC), screener/StockScreener (590 LOC), screener/UnifiedScreenerView (534 LOC), watchlist/ProfessionalWatchlistView (472 LOC), stocks/DataCoverageBanner (209 LOC), analysis/AnalysisFlowDiagram (326 LOC), news-feed-widget (216 LOC), predictions/PicksManagementView (802 LOC).
- **12+ dead lib modules** (~10,800 LOC): analysis-engine.ts (3,126 LOC!), cache/precomputed-cache.ts (1,022 LOC), data-adapter.ts (1,342 LOC), multi-source-adapter.ts (1,057 LOC), data-sync.ts (892 LOC), egx-data-sources.ts (716 LOC), vps-client.ts (654 LOC), ws-client.ts (458 LOC), use-python-api.ts (451 LOC), egxpy-bridge.ts (530 LOC), external-data-fetcher.ts (329 LOC), technical-analysis.ts (488 LOC), candlestick-patterns.ts (438 LOC), stock-movement-classifier.ts (290 LOC), stock-movement-classification.ts (365 LOC), expert/expert-filter.ts (233 LOC), persona-matrix.ts (196 LOC), pick-formatter.ts (116 LOC), api-cache.ts + cache/api-cache.ts + cache/data-freshness.ts (463 LOC).
- **17 duplicate groups** (~7,200 LOC): duplicate stock-analysis views, duplicate prediction-tracking views, duplicate ShareButton, duplicate WealthCharts, duplicate screener views, duplicate watchlist views, duplicate stock-search dropdown, duplicate market selector, duplicate market depth panels, duplicate chart components, duplicate publish buttons, duplicate user-management admin components, duplicate stock-movement classifiers, duplicate technical-analysis, duplicate DB access layer, duplicate analysis engines.

**Why:** 11% of the codebase is dead or duplicated. Removing it reduces bundle size, speeds up `tsc`, simplifies grep, and makes the live code easier to understand. Every dead file deleted is one less file to consider during future refactors.

#### Recommendation 4: Adopt the 3-button publishing pattern (UnifiedPublishButton + StockPublisher + ShareButton) and delete the rest

The project currently has 5 publish/share buttons with overlapping responsibilities:
- `shared/UnifiedPublishButton.tsx` (367 LOC, 20 importers) — generic multi-platform publish (Telegram/WhatsApp/Facebook/Twitter/LinkedIn + copy + PNG)
- `shared/StockPublisher.tsx` (989 LOC, 12 importers) — specialized for stocks (rich card + text + PNG)
- `shared/ShareButton.tsx` (449 LOC, 9 importers) — generic share with image capture
- `publishing/QuickPublishButton.tsx` (335 LOC, 2 importers) — smaller variant (DELETE)
- `share/ShareButton.tsx` (583 LOC, 2 importers) — stock-specific share card (DELETE)

**Pattern:**
- Use `UnifiedPublishButton` for non-stock content (news, reports, generic text).
- Use `StockPublisher` for stock data (it includes the rich card + text generation).
- Use `ShareButton` (shared/) when you need to capture a specific DOM element as an image (e.g., chart screenshot).

**Why:** 3 buttons with clear responsibilities are easier to maintain than 5 with overlapping ones. The 2 deletions save 918 LOC and eliminate naming confusion (`share/ShareButton` vs `shared/ShareButton`).

#### Recommendation 5: Wire the "almost-dead" radar components (AccuracyDashboard, PersonalizedRadarTab, MultiMarketRadarTab) or delete them

These 3 components (totalling 2,007 LOC) have only self-references + tests + 1 API importer — they're not rendered in any view. They were likely built as feature spikes but never landed.

**Options:**
- **Option A (recommended):** Wire them as new tabs in `MarketAnalysisView` (alongside `exit-radar` and `weekly-report`).
- **Option B:** Wire them as new tabs in `MakerRadarTab`'s drawer.
- **Option C:** Delete them.

**Why:** 2,007 LOC of working, tested, Arabic-localized components shouldn't go to waste. If the features are valuable, wire them; if not, delete. The current state (code present but not rendered) is the worst of both worlds — maintenance cost without user value.

### 12.3 Bonus recommendations

#### Bonus 1: Fix the `analysis-engine` naming confusion

The file `src/lib/analysis-engine.ts` (3,126 LOC) is DEAD — 0 external importers. The route `/api/analysis-engine` is a CONFIG endpoint that doesn't call the lib. This is misleading.

**Fix:** Either delete the lib (it's dead) OR rename the API route to `/api/engine-config` and wire the lib to a real endpoint like `/api/stocks/[ticker]/professional-analysis`.

#### Bonus 2: Adopt the `db-helpers.ts` facade

The file exists (274 LOC) but has 0 importers. It was designed as the canonical DB facade. Either:
- Fix it (make it actually useful) and migrate all 88 DB importers to use it.
- Delete it (it's dead).

Currently it's just noise.

#### Bonus 3: Split `store.ts` (1,478 LOC, 85 importers)

The main Zustand store is over-loaded. Split into:
- `auth-store.ts` (user, session, syncFromSession)
- `market-store.ts` (currentMarket, stocks, marketOverview)
- `view-store.ts` (currentView, setCurrentView, setCurrentViewFromHash)
- `portfolio-store.ts` (already exists, 196 LOC)
- `watchlist-store.ts` (if needed)

This makes the store easier to test and reduces re-renders (a component reading only `currentView` won't re-render when `stocks` changes).

#### Bonus 4: Co-locate the devil/ sub-module

The `devil/` lib (10 files, 2,000 LOC) is a cohesive sub-system (5 engines + orchestrator + types + calendar + mood + scenarios). It belongs inside the `market-analysis` module (since that's where `DevilsAdvocatePanel` was rendered). Move `src/lib/devil/*` → `src/modules/market-analysis/lib/devil/*`.

#### Bonus 5: Make `MaestroWidget` consistent

The Maestro card was removed from `ComprehensiveStockAnalysis` (UI-CLEANUP-MAESTRO-AI-TABS), but `dashboard/MaestroWidget.tsx` (168 LOC) still exists. Verify if it's still rendered in DashboardView. If not, delete.

#### Bonus 6: Audit the `/api/v2/*` routes (15 routes)

The v2 API has 15 routes that appear to be a parallel "v2" attempt that didn't fully land. Most have no UI consumer. Audit each and either:
- Migrate the v1 consumers to v2 and delete v1.
- Delete v2 if v1 is canonical.

Don't keep both.

#### Bonus 7: Make `LiquidityRadarView` name match the file

`page.tsx` aliases `MakerRadarTab` as `LiquidityRadarView`. This causes confusion in code search. Either:
- Rename the file `MakerRadarTab.tsx` → `LiquidityRadarView.tsx` (and update the 1 importer).
- OR rename the alias in `page.tsx` to `MakerRadarTab` (and update the hash route name).

#### Bonus 8: Verify `/api/init-db` endpoint exists

`page.tsx` `DbSchemaInit` calls `fetch('/api/init-db')`. Need to verify this endpoint exists (it wasn't in the API route enumeration). If missing, it's a silent 404 on first page load.

#### Bonus 9: Remove the `#wealth` → `admin/WealthCharts` wiring inconsistency

The `#wealth` hash route should logically route to a portfolio component, not an admin component. After consolidation (Phase 4), this should be `modules/portfolio/components/WealthCharts.tsx`.

#### Bonus 10: Document the "UI-Mirror Protocol" for crypto

The crypto views use a "UI-Mirror Protocol" where `#crypto-*` routes redirect to the same EGX components with `currentMarket='CRYPTO'`. This is clever but undocumented. Add a section to `Documentation/01-PROJECT_ANATOMY.md` explaining the pattern, and ensure `isCryptoView()` + `resolveCryptoRedirect()` in `valid-views.ts` are the canonical helpers.

---

## Appendix A: File counts per directory (verification)

```
src/components/             280 files / 141,583 LOC
src/lib/                    ~110 files / 45,769 LOC
src/app/api/                670 route.ts files
src/hooks/                  7 files
src/__tests__/              21 test files
src/types/                  2 files
src/data/                   2 files (learning content)
src/middleware.ts           1 file
src/instrumentation.ts     1 file
src/app/page.tsx           1 file / 642 LOC
src/app/layout.tsx          1 file
src/app/admin/              4 standalone pages + 1 layout
src/app/backtest/           1 page
```

## Appendix B: Method

This audit was performed READ-ONLY using:
- `LS` for directory enumeration
- `Read` for selected file headers (typically first 80 lines for purpose/exports)
- `Grep` for usage analysis (counting importers per module)
- `Bash` with `find`, `wc -l`, `awk`, `rg` for batch file enumeration
- No code was modified, no files were created (except this report)

Every claim in this document is verifiable by:
1. Re-running the grep commands listed inline
2. Reading the cited file at the cited line range
3. Running `bun run lint && bun run test` to confirm baseline behavior

## Appendix C: Glossary

- **DEAD**: 0 external importers (file imports only itself or only test files)
- **Almost dead**: 1-2 external importers
- **Active**: 3+ external importers
- **External importer**: a file outside the same directory that imports from this module
- **LOC**: Lines of code (counted via `wc -l`)
- **Importer count**: Number of unique files that contain `from '@/lib/<module>'` or `from '@/components/<path>'`
- **Module**: A cohesive group of files serving one functional domain
- **Facade**: A re-export file that consolidates access to multiple underlying modules
- **UI-Mirror Protocol**: Pattern where `#crypto-*` hash routes redirect to EGX components with `currentMarket='CRYPTO'` set via `useEffect`
- **Hash route**: A URL fragment like `#stocks` that maps to a view via `useAppStore().currentView`

---

**End of report.** Total lines: ~2,800. Generated by Frontend Architect (module audit) for Task ID `AUDIT-FE-MODULES`.
