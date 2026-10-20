# 📚 الوثائق الشاملة — GLMinvestment

# كل الشاشات والعناصر والمكونات و API Connections

> **المالك**: Z.ai Code (الفاحص التقني)
> **التاريخ**: 2026-10-20
> **المرجع**: آخر commit `dae1968` (HEAD after Phase 3.1)
> **المصدر**: 4 deep audit agents (DEEP-AUDIT-1/2/3/4) — full reports in `/home/z/my-project/worklog.md` (5276 lines)
> **حجم المشروع**: 3213 ملف، 924 ملف TypeScript، 454 API route، 156 module component

---

## 📋 الفهرس

1. [Executive Summary](#1-executive-summary)
2. [Project Overview](#2-project-overview)
3. [Architecture — 4-Tier Hierarchy](#3-architecture--4-tier-hierarchy)
4. [Screens Inventory — 49 cases → 43 components](#4-screens-inventory)
5. [Shared Components — 83 components](#5-shared-components)
6. [Feature Modules — 18 modules, 156 components](#6-feature-modules)
7. [API Routes — 454 routes in 27 domains](#7-api-routes)
8. [Component → API Dependency Map](#8-component--api-dependency-map)
9. [Critical Findings + Recommendations](#9-critical-findings--recommendations)

---

## 1. Executive Summary

### 📊 الأرقام الإجمالية

| المقياس | العدد |
|---------|------|
| إجمالي الملفات | 3,213 |
| ملفات TypeScript | 924 |
| API routes | 454 (في 27 domain) |
| Screen cases في renderView | 49 (مع 7 fallthrough) |
| Unique screen components | 43 |
| Shared UI components (Tier 2) | 20 + 13 = 33 |
| shadcn/ui primitives (Tier 1) | 50 |
| Feature modules | 18 |
| Module components | 156 |
| إجمالي LOC في screens | 43,638 |
| إجمالي LOC في modules | ~127,000 |
| `fetch('/api/...')` calls في modules | 251 |
| `useApiQuery` usages | **0** (مـعـرّف بس مش متـستخدم) |

### 🎯 الـ 4 Layers

```
Tier 4: PAGES (src/app/*)                    → page.tsx renderView switch (49 cases)
Tier 3: FEATURE COMPONENTS (src/modules/*)   → 156 components in 18 modules
Tier 2: SHARED BUSINESS (src/components/shared/*) → 33 components
Tier 1: UI PRIMITIVES (src/components/ui/*)  → 50 shadcn components
```

---

## 2. Project Overview

### 🏗️ Stack التقني
- **Framework**: Next.js 14.2.28 (App Router)
- **Language**: TypeScript 5 (strict mode disabled by default)
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York style)
- **Database**: SQLite (predictions.db + stocks.db + intraday.db + custom.db + news.db)
- **ORM**: Prisma 5.22 (3 schemas: main + auth + predictions)
- **Auth**: NextAuth.js v4
- **State**: Zustand (5 stores — useAppStore = 1,573 LOC mega-store)
- **Server State**: TanStack Query v5.82.0 (**installed but 0 usages!**)
- **Backend**: Python Flask on port 8010 (vps-service) + port 8012 (stock-screener)

### 📁 الهيكل الرئيسي
```
src/
├── app/                    # Tier 4 — Pages (1 page.tsx + 454 API routes)
│   ├── page.tsx            # 1111 LOC — renderView switch
│   ├── layout.tsx          # Root layout with Providers
│   ├── globals.css         # Design tokens (HSL variables)
│   └── api/               # 454 routes in 27 domains
├── components/
│   ├── ui/                 # Tier 1 — 50 shadcn primitives
│   └── shared/             # Tier 2 — 33 shared business components
│       ├── ui/             # 20 unified UI components
│       └── *.tsx           # 13 other shared (LiquidityRadarView, etc.)
├── modules/                # Tier 3 — 18 feature modules
│   ├── market-analysis/   # 23 components, 18.3K LOC (BIGGEST consumer)
│   ├── admin/              # 36+ components, 33.9K LOC (BIGGEST by files)
│   ├── stock-analysis/    # 15 components
│   ├── portfolio/          # 12 components
│   ├── dashboard/          # 21 components
│   ├── education/          # 10 components
│   ├── radar/              # 10 components
│   ├── predictions/        # 4 components
│   ├── reports/            # 5 components
│   ├── publishing/         # 7 components
│   ├── crypto/             # 2 components
│   ├── sharia/             # 3 components
│   ├── subscription/       # 3 components
│   ├── simulation/         # 1 component
│   ├── news/               # 1 component
│   ├── auth/               # 1 component
│   ├── screener/           # 1 component
│   └── personalized/       # 0 components (lib only)
├── hooks/                  # 7 shared hooks
├── lib/                    # ~40 lib files (utils, format, api-client, store, etc.)
└── types/                  # Global TypeScript types
```

---

## 3. Architecture — 4-Tier Hierarchy

### Tier 1: UI Primitives (`src/components/ui/`)
- 50 shadcn/ui components (Button, Card, Dialog, Table, Badge, etc.)
- 2 custom additions: `stat-card.tsx`, `mini-sparkline.tsx`
- **Rule**: Never modify these — consume as-is

### Tier 2: Shared Business Components (`src/components/shared/`)

#### Part A: `shared/ui/` — Unified Component Library (20 components)

| Component | Lines | Purpose | Used By | Status |
|-----------|-------|---------|---------|--------|
| **SignalBadge** | 115 | BUY/SELL/HOLD signal badge | N files | ✅ Active |
| **PriceDisplay** | 118 | Price + change + arrow | N files | ✅ Active |
| **RiskRewardBadge** | 67 | R/R ratio badge | N files | ✅ Active |
| **FlowPhaseTag** | — | Liquidity flow phase tag | — | ✅ Active |
| **UnifiedEmptyState** | 105 | Empty/loading/error state | 9 files | ✅ Active |
| **FilterDrawer** | — | Filter side drawer | — | ✅ Active |
| **StockDetailDrawer** | — | Stock detail side drawer | — | ✅ Active |
| **ActionMenu** | — | Dropdown action menu | — | ✅ Active |
| **DeltaBadge** | 72 | +/- delta with arrow | — | ✅ Active |
| **LiquidityFlashCell** | — | Flashing liquidity cell | — | ✅ Active |
| **LifecycleBadge** | 90 | proven/testing/closed badge | 0 files | ⚠️ Dormant |
| **StatusBadge** | 160 | TARGET_HIT/STOPPED/EXPIRED badge | 12 files | ✅ Active |
| **UnifiedPagination** | 154 | RTL pagination (السابق/التالي) | 3 files | ✅ Active |
| **Skeleton** (4 variants) | 200 | SkeletonRow + TabSkeleton + TableSkeleton + CardSkeleton | 0 files | ⚠️ Dormant |
| **AsyncBoundary** | 150 | Loading+error+empty+success wrapper | 0 files | ⚠️ Dormant |
| **ChangePill** | 90 | +/- value with color + arrow | 0 files | ⚠️ Dormant |
| **PriceText** | 80 | Canonical price text | 0 files | ⚠️ Dormant |
| **SeverityBadge** | 120 | critical/high/medium/low/info badge | 0 files | ⚠️ Dormant |
| **ConfidenceMeter** | 90 | Horizontal bar + value (0-100) | 0 files | ⚠️ Dormant |
| **PersonaEmptyState** | 70 | Persona-themed empty state | 0 files | ⚠️ Dormant |

**Note**: 11 of 20 components are **dormant** — created in Phase 1 of P0-COMPONENT-UNIFICATION but never adopted by consumers (Phase 2 migration was partial).

#### Part B: `shared/` (non-ui) — Other Shared (13 components)

| Component | Lines | Purpose | API Calls |
|-----------|-------|---------|-----------|
| **UnifiedTable** | 2,933 | Excel-like grid with calculated columns, AutoFilter, drag-resize, copy/paste, saved presets | None |
| **PredictionCard** | 525 | Canonical prediction card | None (but has local `detectSignalKind` + `formatPrice` — duplicates) |
| **LiquidityRadarView** | 770 | Liquidity radar with filters + buckets | `fetch('/api/v2/liquidity-radar')` (60s polling) |
| **ExpertIntelligencePanel** | 700+ | Expert consensus intelligence | 4 fetch calls (predictions/sectors/consensus) |
| **StockFeelCard** | — | STOCK-FEEL API display | None (receives data via props) |
| **MarketSelector** | — | Market dropdown | None |
| **StockSearchSelector** | — | Stock search input | None |
| **LazyTabLoader** | — | Lazy tab loading wrapper | None |
| **ErrorBoundary** | 290 | React error boundary | None |
| **FlashingPriceCell** | — | Flashing price cell | None |
| **FlashingChangeCell** | — | Flashing change cell | None |
| **FormulaEngine** | — | Formula evaluation engine | None |
| **ChartToggle** | — | Chart toggle button | None |

---

## 4. Screens Inventory

### 📊 إجمالي الـ Screens

- **49 case branches** في `page.tsx` renderView switch
- **43 unique component files** (بعض cases aliases/fallthroughs)
- **49,638 LOC** إجمالي في الـ screen components
- **0 screens use TanStack Query** — كلهم بـ `useEffect + fetch + useState`

### 🗺️ خريطة الـ Screens (per category)

#### 🇪🇬 البورصة المصرية (EGX) — 14 screens

| # | Case | Component | File | Lines | APIs |
|---|------|-----------|------|-------|------|
| 1 | `dashboard` | `<DashboardView />` | `modules/dashboard/components/DashboardView.tsx` | 603 | `/api/market-pulse` |
| 2 | `stocks` / `stock-detail` / `crypto-live` | `<StocksView />` | `modules/stock-analysis/components/StocksView.tsx` | 2,330 | `/api/stocks`, `/api/unified` |
| 3 | `stock-filters` / `crypto-screener` | `<StockScreenerAdvancedView />` | `modules/screener/components/StockScreenerAdvancedView.tsx` | 2,723 | `/api/screener/advanced` |
| 4 | `top-performers` | `<StockScreenerAdvancedView initialTab="top-performers" />` | same | — | same |
| 5 | `screener` / `trading-chart` / `crypto-trading-chart` | `<TradingChartView />` | `modules/market-analysis/components/TradingChartView.tsx` | 1,000+ | `/api/stocks/[ticker]` |
| 6 | `portfolio` / `finance` | `<EnhancedPortfolioView />` | `modules/portfolio/components/EnhancedPortfolioView.tsx` | 3,369 | 14+ endpoints |
| 7 | `watchlist` / `crypto-watchlist` | `<EnhancedWatchlistView />` | `components/watchlist/EnhancedWatchlistView.tsx` | 1,215+ | `/api/watchlist` |
| 8 | `recommendations` / `analysis` / `crypto-recommendations` | `<MarketAnalysisView />` | `modules/market-analysis/components/MarketAnalysisView.tsx` | 2,000+ | `/api/unified` |
| 9 | `market-status` | `<MarketStatusView />` | `modules/market-analysis/components/MarketStatusTab.tsx` | 1,100+ | `/api/market-status` |
| 10 | `historical-trades` | `<HistoricalTradesTable />` | `modules/market-analysis/components/HistoricalTradesTable.tsx` | 557 | `/api/historical-trades` |
| 11 | `sectors` | `<SectorTrackingTab />` | `modules/market-analysis/components/SectorTrackingTab.tsx` | 714 | `/api/sectors` |
| 12 | `market-depth` | `<MarketDepthLiquidityWidget />` | `modules/market-analysis/components/MarketDepthLiquidityWidget.tsx` | 500+ | `/api/market-depth` |
| 13 | `liquidity-radar` | `<LiquidityRadarView />` | `components/shared/LiquidityRadarView.tsx` | 770 | `/api/v2/liquidity-radar` (60s) |
| 14 | `news` | `<NewsFeedView />` | `modules/news/components/NewsFeedView.tsx` | — | `/api/news` |

#### 🪙 الكريبتو — 11 screens (بعد Phase 3.1 simplification)

| # | Case | Component | Notes |
|---|------|-----------|-------|
| 15 | `crypto` | `<DashboardView />` | Same as `dashboard` + CRYPTO market |
| 16 | `crypto-portfolio` | `<CryptoPortfolioView />` | Unique component (different from `portfolio`) |
| 17 | `crypto-analysis` | `<SmartConfluenceView />` | Different from `analysis` |
| 18 | `crypto-prediction-tracking` | `<CryptoPredictionTrackingView />` | Unique |
| (7 fallthrough) | `crypto-live`, `crypto-recommendations`, `crypto-trading-chart`, `crypto-screener`, `crypto-watchlist`, `crypto-simulation`, `crypto-learning` | (fallthrough to non-crypto cases) | Phase 3.1 — shell handles CRYPTO market |

#### 📊 التحليلات المتقدمة — 8 screens

| # | Case | Component | File |
|---|------|-----------|------|
| 19 | `advanced-analysis` | `<SpecialistAnalysisView />` | `modules/advanced-analysis/components/SpecialistAnalysisView.tsx` | 2,916 |
| 20 | `unified-analysis` | `<UnifiedAnalysisView />` | `modules/market-analysis/components/UnifiedAnalysisView.tsx` | 600+ |
| 21 | `smart-confluence` | `<SmartConfluenceView />` | `modules/market-analysis/components/SmartConfluenceView.tsx` | — |
| 22 | `seasonality` | `<SeasonalityDashboard />` | `modules/market-analysis/components/SeasonalityDashboard.tsx` | — |
| 23 | `prediction-tracking` | `<PredictionTrackingView />` | `modules/predictions/components/PredictionTrackingDashboard.tsx` | — |
| 24 | `picks-management` | `<PicksManagementView />` | `modules/predictions/components/PicksManagementView.tsx` | — |
| 25 | `bagholder-rescue` | `<BagHolderRescueView />` | `modules/portfolio/components/BagHolderRescueView.tsx` | — |
| 26 | `expert-recommendations` | `<ExpertRecommendationsPanel />` | `modules/market-analysis/components/ExpertRecommendationsPanel.tsx` | — |

#### 📚 التعليم + المحفظة المتقدمة — 5 screens

| # | Case | Component | File |
|---|------|-----------|------|
| 27 | `academy` / `crypto-learning` | `<AcademyView />` | `modules/education/components/AcademyView.tsx` | 2,483 |
| 28 | `simulation` / `crypto-simulation` | `<SimulationView />` | `modules/simulation/components/SimulationView.tsx` | 2,131 |
| 29 | `advanced-portfolio` | `<AdvancedPortfolioManager />` | `modules/portfolio/components/AdvancedPortfolioManager.tsx` | — |
| 30 | `reports` | `<ReportsView />` | `modules/reports/components/ReportsView.tsx` | — |
| 31 | `specialist-analysis` | `<SpecialistAnalysisView />` | (same as #19) |

#### 💰 الحسابات الدينية — 3 screens

| # | Case | Component | File |
|---|------|-----------|------|
| 32 | `zakat` | `<ZakatView />` | `components/zakat/ZakatView.tsx` | — |
| 33 | `tithes` | `<TithesView />` | `components/tithes/TithesView.tsx` | — |
| 34 | `sharia` | `<ShariaView />` | `modules/sharia/components/ShariaView.tsx` | 1,480 |

#### ⚙️ الإعدادات + الاشتراك + المصادقة — 3 screens

| # | Case | Component | File |
|---|------|-----------|------|
| 35 | `subscription` | `<SubscriptionView />` | `modules/subscription/components/SubscriptionView.tsx` | — |
| 36 | `settings` | `<SettingsView />` | `components/settings/SettingsView.tsx` | — |
| 37 | `auth` | `<AuthView />` | `modules/auth/components/AuthView.tsx` | — |

#### 👨‍💼 الإدارة — 1 screen (الأضخم)

| # | Case | Component | File | Lines | APIs |
|---|------|-----------|------|-------|-------|
| 38 | `admin` | `<AdminView />` | `modules/admin/components/AdminView.tsx` | 2,083 | **13 fetch endpoints** (most of any screen) |

#### 🔧 شاشات standalone أخرى — 5 screens

| # | Case | Component | File |
|---|------|-----------|------|
| 39 | `market-status` (standalone) | `<MarketStatusView />` | (same as #9) |
| 40 | `historical-trades` (standalone) | `<HistoricalTradesTable />` | (same as #10) |
| 41 | `live-dashboard` | `<LiveDashboard />` | `modules/dashboard/components/LiveDashboard.tsx` |
| 42 | `live-tracking` | `<LiveTrackingTab />` | `modules/market-analysis/components/LiveTrackingTab.tsx` |
| 43 | ` landing` | `<LandingPage />` | `app/landing/page.tsx` |

### ⚠️ Anomalies (مـن DEEP-AUDIT-1)

1. **3 switch cases NOT in VALID_VIEWS** (`stock-detail`, `prediction-performance`, `prediction-credibility`) — unreachable via URL hash
2. **Stale comment** في `valid-views.ts` عن `crypto-watchlist` (اتـوحد في Phase 3.1)
3. **`ReportsView`** rendered standalone AND as sub-component of `MarketAnalysisView`
4. **`SubscriptionView`** rendered standalone AND inside `SettingsView` — duplicate fetches
5. **Default case** silently renders `DashboardView` for invalid hashes
6. **0 screens use TanStack Query** — `useApiQuery` hook موجود بس مش متـستخدم
7. **`AdminView`** = heaviest screen (13 fetch endpoints, 2,083 LOC)

---

## 5. Shared Components

(see Section 3 above for full table)

### 📊 Shared Component Statistics

| Category | Count | Active | Dormant |
|----------|-------|--------|---------|
| `shared/ui/` unified components | 20 | 9 | 11 |
| `shared/` other components | 13 | 13 | 0 |
| `components/ui/` shadcn primitives | 50 | 50 | 0 |
| **Total** | **83** | **72** | **11** |

---

## 6. Feature Modules

### 📊 إجمالي الـ Modules

| Module | Components | LOC | fetch() calls | Notes |
|--------|-----------|-----|---------------|-------|
| **admin** | 36+1 nested | 33,900 | **137** (55% of total!) | Biggest by files + fetches |
| **market-analysis** | 23 | 18,300 | 38 | Biggest consumer-facing module |
| **dashboard** | 21 | — | — | — |
| **stock-analysis** | 15 | — | — | — |
| **portfolio** | 12 | — | — | — |
| **education** | 10 | — | — | — |
| **radar** | 10 | — | — | — |
| **publishing** | 7 | — | — | — |
| **reports** | 5 | — | — | — |
| **predictions** | 4 | — | — | — |
| **sharia** | 3 | 1,480 | — | — |
| **subscription** | 3 | — | — | — |
| **crypto** | 2 | — | — | — |
| **news** | 1 | — | — | — |
| **auth** | 1 | — | — | — |
| **screener** | 1 | 2,723 | — | — |
| **simulation** | 1 | 2,131 | — | — |
| **personalized** | 0 (lib only) | — | — | lib/personalized-radar.ts |
| **Total** | **156** | **~127,000** | **251** | — |

### 🔴 Critical Module Findings

1. **`useApiQuery` NEVER USED** — كل 251 API calls في modules بـ raw `fetch()` + `useEffect` + `useState`
2. **admin module = 137 fetch calls (55%)** — concentrated risk surface
3. **17 of 25 canonical Tier 2 shared components NOT used** by any module
4. **`market-analysis` is the hub** — producer + consumer (imports from publishing/sharia/stock-analysis/reports)
5. **Missing modules**: `zakat`, `tithes`, `notifications` (live in `src/components/` not `src/modules/`)

### 📦 Top 5 Largest Module Components (refactor candidates)

| Component | Module | Lines |
|-----------|--------|-------|
| MakerRadarTab | radar | 3,907 |
| EnhancedPortfolioView | portfolio | 3,369 |
| DatabaseManagerFull | admin | 3,291 |
| SpecialistAnalysisView | advanced-analysis | 2,916 |
| AcademyView | education | 2,483 |

---

## 7. API Routes

### 📊 إجمالي الـ API Routes

- **454 route.ts files** in `src/app/api/`
- **27 domains** (grouped by path prefix)
- **DBs accessed**: predictions.db, stocks.db, intraday.db, custom.db, news.db
- **Python services**: port 8010 (vps-service), port 8012 (stock-screener)

### 🗺️ API Domains (27 domains)

| # | Domain | Routes | Purpose | DB | Python |
|---|--------|--------|---------|-----|--------|
| 1 | `/api/auth/*` | 3 | NextAuth + session | predictions.db | — |
| 2 | `/api/stocks/*` | ~15 | Stocks list + detail + search | stocks.db | 8012 (some) |
| 3 | `/api/predictions/*` | ~20 | Predictions + tracking | predictions.db | 8010 (some) |
| 4 | `/api/portfolio/*` | ~16 | Portfolio CRUD | predictions.db | 8010 (2 routes) |
| 5 | `/api/market*` | ~10 | Market pulse + status + regime | stocks.db | — |
| 6 | `/api/admin/*` | ~50 | Admin (engines, users, content, DB) | all DBs | 8010 (some) |
| 7 | `/api/v2/*` | ~15 | V2 APIs (liquidity-radar, live-analysis, pipeline) | stocks.db | 8010 (some) |
| 8 | `/api/v4/*` | 1 | V4 stats | — | — |
| 9 | `/api/v82` | 1 | V82 decision engine | — | 8010 |
| 10 | `/api/notifications` | 1 | Notifications | predictions.db | — |
| 11 | `/api/keepalive` | 1 | Keepalive ping | — | — |
| 12 | `/api/track` | 1 | Analytics tracking | predictions.db | — |
| 13 | `/api/subscription/*` | ~5 | Subscription plans + status | predictions.db | — |
| 14 | `/api/expert-recommendations` | 5 | Expert recs (DUPLICATE of /recommendations/expert) | predictions.db | — |
| 15 | `/api/crypto/*` | 17 | Crypto (3 namespaces — DUPLICATE) | — | 8010 |
| 16 | `/api/screener/*` | ~3 | Stock screener | stocks.db | 8012 |
| 17 | `/api/news/*` | 5 | News (DUPLICATE — same DB table) | news.db | — |
| 18 | `/api/reports/*` | ~3 | Reports generation | — | — |
| 19 | `/api/maker-radar/*` | ~5 | Maker radar + footprint | stocks.db | 8012 |
| 20 | `/api/stored-analysis/*` | ~3 | Stored analyses | predictions.db | — |
| 21 | `/api/unified/*` | ~2 | Unified predictions/analyze | — | 8010 |
| 22 | `/api/walk-forward/*` | 2 | Walk-forward test | — | 8010 |
| 23 | `/api/watchlist*` | 2 | Watchlist CRUD | predictions.db | — |
| 24 | `/api/zakat/*` | 1 | Zakat calculator | — | — |
| 25 | `/api/proxy/*` | ~5 | Python proxy (alias of /api/python/*) | — | 8010 |
| 26 | `/api/python/*` | ~5 | Python direct | — | 8010 |
| 27 | `/api/mobile/*` | ~20 | Mobile-specific (DUPLICATE of desktop) | all | 8010 (some) |

### 🔴 Critical API Findings

#### Finding #1: 23 broken no-op thin proxies (🔴 CRITICAL)
23 routes هي عبارة عن thin proxies بتـ redirect لـ `/api/market-pulse` بدون ما تـعمل actual work:
- `/api/mobile/zakat-calculator`
- `/api/recommendations`
- `/api/walk-forward-test`
- ... (20+ other routes)

كلهم بـ يـرجّعوا market-breadth data بدل ما يـرجّعوا الـ namesake data بتوعهم — bugs صامتة.

#### Finding #2: 6 same-Python-endpoint duplicate proxies (🟠 HIGH)
- `/api/flow` + `/api/confluence/daily-picks` → كلاهما بيـhit `/api/flow/summary`
- `/api/crypto` + `/api/crypto/live` + `/api/crypto-lab` → 3-way duplicate لـ `/api/crypto/live`
- `/api/admin/engines-status` + `/api/admin/system-topology` → كلاهما بيـhit `/api/admin/system-topology`

#### Finding #3: 12 same-DB-table duplicate routes (🟠 HIGH)
- `/api/expert-recommendations` vs `/api/recommendations/expert` (header says "same table")
- `/api/metals/gold` vs `/api/market/gold` vs `/api/mobile/gold` (header says "نفس")
- + 10+ mobile-vs-desktop pairs

#### Finding #4: 4 deprecated/disabled routes (🟡 MED)
- `/api/stocks/[ticker]/professional-analysis` (410 Gone)
- `/api/admin/generate-predictions` (DISABLED)
- `/api/predictions/tracking/*` (4 routes, superseded by `/api/predictions/honest-tracking/*`)
- `/api/egxpilot/news` (stub)

#### Finding #5: Inconsistent Python service env vars (🟡 MED)
6 env vars بـ تـعمل نفس الشيء (port 8010):
- `EGXPY_SERVICE_URL`
- `PYTHON_BACKEND_URL`
- `EGX_VPS_API_URL`
- `PYTHON_API_URL`
- `VPS_API_URL`
- `PYTHON_PORT`

#### Finding #6: Port 8012 hardcoded (🟡 MED)
2 routes فيها port 8012 hardcoded (مـفروض يبقى في `@/lib/python-backend`):
- `/api/maker-radar/stock-analysis`
- `/api/stock-screener/analyze`

---

## 8. Component → API Dependency Map

### 🗺️ الـ Top 20 Components بـ أكتر API calls

| Component | Module | Fetch Count | Top APIs |
|-----------|--------|-------------|----------|
| **AdminView** | admin | **13** | /api/admin/* (engines, users, content, DB, system) |
| **EnhancedPortfolioView** | portfolio | **14+** | /api/portfolio/holdings, /api/portfolio/holdings/[id], /api/stocks, etc. |
| **MakerRadarTab** | radar | ~10 | /api/maker-radar/*, /api/stock-screener/analyze (port 8012) |
| **LiquidityRadarView** | shared | 1 (60s polling) | /api/v2/liquidity-radar |
| **ExpertIntelligencePanel** | shared | 4 | /api/predictions/*, /api/sectors/*, /api/consensus/* |
| **PersonaTab** | market-analysis | ~5 | /api/unified/predictions, /api/stocks/[ticker], /api/market/regime |
| **PredictionsTab** | market-analysis | ~3 | /api/unified/predictions, /api/predictions/previous |
| **StocksView** | stock-analysis | ~4 | /api/stocks, /api/unified, /api/stocks/[ticker] |
| **StockScreenerAdvancedView** | screener | ~2 | /api/screener/advanced, /api/stock-screener/analyze |
| **DashboardView** | dashboard | ~2 | /api/market-pulse, /api/market/regime |
| **EnhancedWatchlistView** | watchlist | ~3 | /api/watchlist, /api/watchlist-enhanced |
| **MarketAnalysisView** | market-analysis | ~3 | /api/unified, /api/expert-recommendations |
| **MarketStatusTab** | market-analysis | ~2 | /api/market-status, /api/market/sectors |
| **HistoricalTradesTable** | market-analysis | ~1 | /api/historical-trades |
| **SectorTrackingTab** | market-analysis | ~1 | /api/sectors |
| **MarketDepthLiquidityWidget** | market-analysis | ~1 | /api/market-depth |
| **SimulationView** | simulation | ~2 | /api/simulation/* |
| **AcademyView** | education | ~3 | /api/education/* |
| **ReportsView** | reports | ~2 | /api/reports/* |
| **ShariaView** | sharia | ~2 | /api/sharia/*, /api/gold-silver |

### 📊 API Coverage by Module

| Module | Components | Total fetch() | Unique APIs |
|--------|-----------|---------------|-------------|
| admin | 36+ | 137 | ~30 unique |
| market-analysis | 23 | 38 | ~15 unique |
| portfolio | 12 | ~20 | ~10 unique |
| stock-analysis | 15 | ~15 | ~8 unique |
| dashboard | 21 | ~10 | ~5 unique |
| radar | 10 | ~15 | ~8 unique |
| education | 10 | ~10 | ~5 unique |
| Other modules | 38 | ~6 | ~10 unique |
| **Total** | **156** | **251** | **~91 unique APIs** |

---

## 9. Critical Findings + Recommendations

### 🔴 Critical Issues (3)

#### Issue #1: TanStack Query installed but 0 usages
- **Impact**: 251 manual `useEffect + fetch + setState` patterns — كلهم بدون caching/retry/dedup
- **Fix**: Wire `useApiQuery` hook (مـوجود في `src/hooks/use-api-query.ts`) في كل الـ 251 fetch sites
- **Priority**: HIGH — أكبر single source of duplication

#### Issue #2: 23 broken no-op API routes
- **Impact**: 23 routes بـ تـرجّع market-breadth data بدل namesake data (silent bugs)
- **Fix**: اـrestore real implementations OR replace بـ 410 Gone + deprecation header
- **Priority**: CRITICAL — bugs صامتة

#### Issue #3: `useAppStore` mega-store (1,573 LOC)
- **Impact**: ~50 field covering nav+auth+data+CRUD+UI+personalization+currency+persona
- **Fix**: Split لـ 5 focused stores (useNavStore + useAuthStore + useMarketDataStore + useUIStore + useNotificationStore)
- **Priority**: HIGH — maintenance + re-render performance

### 🟠 High-Impact Issues (5)

1. **17 of 25 Tier 2 shared components dormant** — created in Phase 1 بس مش adopted
2. **6 duplicate Python proxies** — same endpoint، paths مختلفة
3. **12 duplicate DB-table routes** — same table، paths مختلفة
4. **6 inconsistent Python env vars** — كلها بـ تـresolve لـ port 8010
5. **admin module = 137 fetch calls (55%)** — concentrated risk

### 🟡 Medium Issues (5)

1. Port 8012 hardcoded في 2 routes (مـفروض يبقى في lib)
2. 4 deprecated routes متـسيكين بـ Rule 4 (NO-DELETION)
3. `ReportsView` rendered standalone + sub-component (duplicate fetches)
4. `SubscriptionView` rendered standalone + inside `SettingsView`
5. 3 switch cases NOT in VALID_VIEWS (unreachable via URL hash)

### ✅ Recommendations (مرتبة بـ الأولوية)

| # | Recommendation | Impact | Effort |
|---|----------------|--------|-------|
| 1 | Wire `useApiQuery` في الـ 251 fetch sites (start بـ admin) | عالي جداً | متوسط |
| 2 | Fix الـ 23 broken no-op routes | عالي | متوسط |
| 3 | Split `useAppStore` لـ 5 focused stores | عالي | عالي |
| 4 | Adopt الـ 17 dormant Tier 2 components | متوسط | متوسط |
| 5 | Consolidate 6 duplicate Python proxies | متوسط | بسيط |
| 6 | Consolidate 12 duplicate DB-table routes | متوسط | متوسط |
| 7 | Unify 6 Python env vars → 1 canonical | بسيط | بسيط |
| 8 | Move port 8012 لـ `@/lib/python-backend` | بسيط | بسيط |
| 9 | Split largest components (MakerRadarTab 3,907 + EnhancedPortfolioView 3,369) | متوسط | عالي |
| 10 | Remove dead switch cases + fix stale comments | بسيط | بسيط |

---

## 📚 المراجع

- **Worklog (full audit data)**: `/home/z/my-project/worklog.md` (5,276 lines)
- **DEEP-AUDIT-1 section**: starts at line 1366 (screens)
- **DEEP-AUDIT-2 section**: starts at line 2381 (shared components)
- **DEEP-AUDIT-3 section**: starts at line 2757 (feature modules)
- **DEEP-AUDIT-4 section**: starts at line 2042 (API routes)
- **Plan**: `/home/z/my-project/PLAN-COMPONENT-UNIFICATION.md`
- **Constitution**: `/home/z/my-project/Documentation/00-CONSTITUTION.md`
- **Architecture**: `/home/z/my-project/Documentation/01-ARCHITECTURE.md`
- **Databases**: `/home/z/my-project/Documentation/02-DATABASES-AND-DATA.md`
- **Engines**: `/home/z/my-project/Documentation/03-ENGINES-AND-LOGIC.md`
- **Team**: `/home/z/my-project/Documentation/04-TEAM.md`

---

## 📝 الـ Head التاريخي

- **آخر commit**: `dae1968` (Phase 3.1 — page.tsx renderView simplification)
- **Commits إجمالي في الـ unification work**: 11 commits
- **LOC changed**: +8,015 / -5,060
- **التاريخ**: 2026-10-20

---

> **هذا الـ documentation شامل بـ كل الشاشات + المكونات + API connections.**
> **مبني على deep audit من 4 parallel agents (DEEP-AUDIT-1/2/3/4).**
> **الـ full data في `/home/z/my-project/worklog.md` (5,276 lines).**
