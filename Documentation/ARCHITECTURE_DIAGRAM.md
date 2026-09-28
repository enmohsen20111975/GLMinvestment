# 🏛️ Architecture Diagram — المخطط المعماري

> **آخر تحديث:** 2026-09-30
> **المرجع:** `agent-ctx/MASTER-ARCHITECTURE-PLAN.md` + `Documentation/MODULE_CATALOG.md` + `01-PROJECT_ANATOMY.md` §1.8.
> **القاعدة الدستورية:** Rule 60 (MODULE-SYSTEM — 2026-09-30).

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                Next.js Frontend (port 3001 — dev)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/modules/ (15 modules — see MODULE_CATALOG.md)        │  │
│  │  ├── radar/              (liquidity radar — 8 components)  │  │
│  │  ├── publishing/         (3 components + 2 lib)           │  │
│  │  ├── personalized/       (1 lib)                          │  │
│  │  ├── stock-analysis/     (15 components — StockDetail)     │  │
│  │  ├── predictions/        (5 components — V40.2 tracking)   │  │
│  │  ├── portfolio/          (15 components — RoboAdvisor)     │  │
│  │  ├── screener/           (1 component — Advanced)          │  │
│  │  ├── market-analysis/    (24 components — SectorTracking)  │  │
│  │  ├── news/               (1 component — NewsFeedView)     │  │
│  │  ├── admin/              (34 components — DB Manager)      │  │
│  │  ├── crypto/             (8 components)                    │  │
│  │  ├── education/          (9 components — Academy+Learning)│  │
│  │  ├── reports/            (5 components — Weekly Report)    │  │
│  │  ├── dashboard/          (21 widgets — home dashboard)    │  │
│  │  └── simulation/         (1 component)                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/lib/db/index.ts (canonical DB access — Rule 5)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/app/api/ (653 routes — thin proxies to Python)       │  │
│  │  • 257 proxy لـ Python (port 8010)                         │  │
│  │  • ~331 direct (SQLite reads)                              │  │
│  │  • 30 routes secured (P0-11-AUTH — Rule 55)                │  │
│  │  • 7 SQLi sites fixed (P0-12-SQLI — Rule 56)               │  │
│  │  • 24 routes async-refactored (P0-14-ASYNC — Rule 57)      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕ HTTP (localhost:8010)
┌─────────────────────────────────────────────────────────────────┐
│              Python Backend (port 8010 — Flask/FastAPI)         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  vps-service/modules/ (8 placeholders — Phase 3.2)         │  │
│  │  ├── radar/             (maker_radar + exit_radar)          │  │
│  │  ├── predictions/       (V40.2 generator + daily_closer)    │  │
│  │  ├── market_regime/     (MarketRegimeEngine)               │  │
│  │  ├── market_data/       (scrapers — TV/Yahoo/crypto/metals)│  │
│  │  ├── telegram/          (auto_poster + card_publisher)      │  │
│  │  ├── ai/                (glm_finance_agent + nightly)       │  │
│  │  ├── portfolio/         (position_manager + stop_manager)  │  │
│  │  └── admin/             (tools — diagnose + restore)        │  │
│  └───────────────────────────────────────────────────────────┘  │
│  Current Python code locations (pre-migration):                  │
│  • vps-service/analyzers/  (~50 files — technical/fundamental)  │
│  • vps-service/jobs/       (V40.2 generator + daily_closer)     │
│  • vps-service/api/        (Flask blueprints — 53 registered)   │
└─────────────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────────────┐
│                       Data Layer (SQLite)                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │ stocks.db    │ │predictions.db│ │data_engine.db│ │auth.db │ │
│  │ (14 MB)      │ │ (235 MB)     │ │ (285 MB)     │ │(0.2 MB)│ │
│  │ radar tables │ │ predictions  │ │ screener_lists│ │Prisma  │ │
│  │ finance      │ │ outcome_logs │ │ egksco_price │ │User... │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
│  ┌──────────────────┐ ┌──────────────────────────────────────┐  │
│  │ price_history.db │ │ intraday.db (448 MB)                 │  │
│  │ (307 MB)          │ │ (intraday tick data)                  │  │
│  └──────────────────┘ └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Dependencies

```
                       ┌─────────────────────────────────────┐
                       │       src/app/page.tsx (SPA shell)   │
                       │       (45 hash views / 35 active)   │
                       └────────────────┬────────────────────┘
                                        │ dynamic imports
          ┌─────────────────────────────┼───────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
┌──────────────────┐        ┌──────────────────┐         ┌──────────────────┐
│ modules/dashboard │        │ modules/         │         │ modules/         │
│   (home widgets)  │        │  stock-analysis  │         │  market-analysis │
└────────┬─────────┘        └────────┬─────────┘         └────────┬─────────┘
         │ imports from               │ imports from                │ imports from
         │ modules/radar              │ modules/publishing          │ modules/radar
         │ modules/dashboard           │ modules/dashboard            │ modules/predictions
         │ modules/stock-analysis      │                              │ modules/stock-analysis
         │ modules/market-analysis    │                              │
         ▼                            ▼                              ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       SHARED DEPENDENCIES (bottom of graph)                │
│  • src/lib/db/index.ts (DB access — Rule 5)                                │
│  • src/lib/store.ts (Zustand — currentMarket state)                       │
│  • src/lib/auth/ (NextAuth + admin-guard)                                  │
│  • src/lib/logger.ts (structured logging — P0-7-15)                        │
│  • src/components/ui/ (shadcn primitives — 51 components)                  │
│  • src/components/shared/ (UnifiedTable + ErrorBoundary + SafeWidget + ...)│
└───────────────────────────────────────────────────────────────────────────┘
```

**Cross-module imports observed (Phase 6 audit):**

| From | To | What |
|---|---|---|
| `modules/dashboard/DashboardView` | `modules/stock-analysis/StockSelector` | Symbol picker |
| `modules/dashboard/DashboardView` | `modules/dashboard/{LiquidityFlowPanel, IntradayPressurePanel, InvestorsFlowPanel, ...}` | Widgets |
| `modules/predictions/MakerRadarTab` | `modules/dashboard/SafeWidget` | Error boundary |
| `modules/predictions/MakerRadarTab` | `modules/stock-analysis/StockIcon` | Ticker icon |
| `modules/market-analysis/PersonaTab` | `modules/stock-analysis/StockIcon` | Ticker icon |
| `modules/market-analysis/PredictionsTab` | `modules/stock-analysis/StockIcon` | Ticker icon |
| `modules/admin/AdminView` | `modules/admin/platform-performance/PlatformPerformanceView` | Sub-tab |
| `modules/admin/SystemTopologyTab` | `modules/admin/SystemTopologyGraph` | Wraps graph |
| `modules/education/PaperTradingWorkstation` | `modules/portfolio/StockSearchDropdown` | Symbol search |
| `modules/memory/TradingMemoryView` | `modules/portfolio/{PortfolioIntelligencePanel, SmartAssistantPanel}` | Portfolio widgets |

---

## Data Flow

### Stock Prices Flow

```
Yahoo Finance / TradingView  →  scrapers (vps-service/analyzers/*_scraper.py)
                              ↓
                              data_engine.db.egksco_price_history (162,946 rows)
                              + price_history.db.price_history (1,206,981 rows)
                              ↓
                              /api/stocks/[ticker]/price-history  ← Next.js thin proxy
                              ↓
                              modules/stock-analysis/StockDetail → TradingViewChart widget
                              modules/dashboard/RealtimeTicker
                              modules/market-analysis/InteractiveChart
```

### Predictions Flow

```
vps-service/jobs/v40_2_daily_generator.py  (Phase A: multi-market — market_code EGX/KSA/KSE/QSE/CRYPTO)
                              ↓ (Phase B: liquidity_filter.py primary gate)
                              ↓ (Phase C: dynamic thresholds via get_setting())
                              predictions.db.predictions (1,359 rows)
                              + persona_predictions (946 rows)
                              + aiPrediction (2,459 rows)
                              ↓
                              daily_closer.py (Closed-Loop — 5-state)
                              ↓
                              /api/predictions/honest-tracking/* (7 endpoints — 2,545 LOC)
                              ↓
                              modules/predictions/PredictionTrackingView + DualTrackPredictionsView + MakerRadarTab + PicksManagementView
                              modules/market-analysis/PredictionsTab + PersonaTab + LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab
```

### Radar Flow

```
vps-service/analyzers/maker_radar.py (Liquidity Radar — Phase B)
                              ↓
                              db/radar_cache.json + db/maker_radar_tracking.json
                              ↓
                              modules/radar/lib/radar-cache.ts → radar-db.ts (stocks.db radar tables)
                              ↓
                              /api/maker-radar/route.ts + /api/maker-radar/sector-treemap/route.ts + /api/maker-radar/timeline/route.ts
                              + /api/maker-radar/entry-timing/route.ts + /api/maker-radar/footprint/route.ts + /api/maker-radar/exit-radar/route.ts
                              + /api/radar/weekly-report/route.ts + /api/radar/weekly-report/pdf/route.ts
                              ↓
                              modules/radar/components/MakerRadarTab + ExitRadarTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab + WeeklyReportTab + SignalTrackingTimeline + SignalStrengthMeter + RadarStatsCards
                              (wired into modules/market-analysis/MarketAnalysisView as 3 new tabs — Phase 4.1)
```

### Auth + User Data Flow

```
Google OAuth / Bearer Token (mobile)
                              ↓
                              NextAuth (src/lib/auth/*)
                              ↓
                              auth.db (Prisma — User + Account + Session + SubscriptionPlan + UserSubscription + ApiToken)
                              ↓
                              src/lib/db/index.ts (canonical entry — Rule 5)
                              ↓
                              src/lib/admin-guard.ts (requireAdminAsync / requireAuthAsync — Rule 55)
                              ↓
                              30 protected API routes (4 admin + 26 non-admin)
```

### News Flow

```
vps-service/modules/telegram/ bot + news-agent (PM2 — 7th service)
                              ↓
                              db/news.db.market_news (7,806 rows)
                              ↓
                              /api/news/feed
                              ↓
                              modules/news/NewsFeedView
                              modules/stock-analysis/StockNews (per-ticker)
```

---

## Module Boundary Rules (Rule 60)

```
   ALLOWED:
   ┌─────────────────────┐         ┌─────────────────────┐
   │  src/app/page.tsx   │ ──────► │ @/modules/<x>       │  (via index.ts)
   └─────────────────────┘         │ @/lib/db             │
                                   └─────────────────────┘

   ALLOWED (transitional):
   ┌─────────────────────┐         ┌─────────────────────┐
   │  api/route.ts       │ ──────► │ @/modules/<x>/lib/* │  (direct lib imports — transitional)
   └─────────────────────┘         └─────────────────────┘

   DISCOURAGED (long-term):
   ┌─────────────────────┐         ┌─────────────────────┐
   │  any file           │ ──────► │ @/modules/<x>/      │  (internal file direct import)
   │                     │         │   components/Internal│
   └─────────────────────┘         └─────────────────────┘

   FORBIDDEN (Rule 4 — no new screens):
   ┌─────────────────────┐         ┌─────────────────────┐
   │  any file           │ ── ✗ ─► │ new src/app/<route> │  (no new pages/routes)
   └─────────────────────┘         └─────────────────────┘
```

---

## Service Topology

```
┌─────────────────────────────────────────────────────────────┐
│              PM2 ecosystem (7 services — Rule 58)             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ nextjs     │ │ python-    │ │ data-engine│ │ ws-service │ │
│  │ (port 3001)│ │ backend    │ │ (port 8020)│ │ (port 3005)│ │
│  │            │ │ (port 8010)│ │            │ │            │ │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │ telegram-  │ │ telegram-  │ │ news-agent │               │
│  │ events     │ │ bot        │ │ (NEW 2026- │               │
│  │ (port 3003)│ │ (port 3004)│ │  09-27)    │               │
│  └────────────┘ └────────────┘ └────────────┘               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Caddy reverse proxy (port 81)               │
│         https://invist.m2y.net → localhost:3001                │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Layout

```
db/ (root)
├── stocks.db          (14.2 MB)  — radar tables + finance tables (Rule 1: read-only in prod)
├── predictions.db     (235 MB)   — predictions + outcome_logs + persona_predictions + aiPrediction + ...
├── auth.db            (0.2 MB)   — Prisma (User + Account + Session + SubscriptionPlan + ...)
├── data_engine.db     (285 MB)   — screener_lists + egksco_price_history (162,946 rows) + ...
├── price_history.db   (307 MB)   — price_history (1,206,981 rows / 1,336 tickers) — safety net
├── intraday.db        (448 MB)   — intraday tick data
├── news.db            (~10 MB)   — market_news (7,806 rows)
├── decision_log.db    (~5 MB)    — Decision Logger output (always ON — not gated)
└── *.bak-unify        (511 MB)   — backups (P0-8-DB-UNIFY — 2026-09-27)
```

---

*تم الإنشاء بواسطة Documentation Secretary — Task ID `REORG-PHASE-7-DOCS` — 2026-09-30*
