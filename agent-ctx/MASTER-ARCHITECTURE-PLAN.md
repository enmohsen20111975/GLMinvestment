# 🏛️ Master Architecture Plan — Module System
## تحويل المشروع من مشاريع متفرقة إلى موديولات قياسية مترابطة

> **Date:** 2026-09-30
> **Status:** Approved by General Manager
> **Based on:** AUDIT-FE-MODULES (3,820 lines) + AUDIT-BE-DATA-GEMS (2,405 lines)
> **Principle:** NO new code/files/screens. Only MOVE + WIRE + DELETE dead code.

---

## 📊 Current State (As-Is)

| Layer | Files | LOC | Problem |
|-------|-------|-----|---------|
| Frontend (src/) | 1,060 | 190K | 16 domains scattered, 17 duplicates, 30+ disconnects |
| Backend (vps-service/) | 507 | 298K | 148 analyzers (68 orphan), 4 confluence engines, 7 fundamental modules |
| Scripts | 291 | 81K | 97 archived, many useful scripts not cron'd |
| Data Engine | 13+19 | 11K | 3 server entry points (only 1 active) |
| **Total** | **~1,870** | **~580K** | **~21,500 LOC dead frontend + ~41,500 LOC dead backend** |

---

## 🎯 Target State (To-Be)

### Frontend Module Structure

```
src/
├── modules/                    ← NEW: canonical module home
│   ├── stock-analysis/         ← single stock deep analysis
│   │   ├── components/         (StockDetail, ComprehensiveStockAnalysis, ...)
│   │   ├── lib/                (analysis helpers)
│   │   └── index.ts            (public interface)
│   ├── predictions/            ← V40.2 predictions tracking
│   │   ├── components/         (PredictionTrackingView, PersonaTab, DualTrackView, ...)
│   │   ├── lib/                (prediction helpers)
│   │   └── index.ts
│   ├── radar/                  ← liquidity radar (entry + exit + multi-market)
│   │   ├── components/         (MakerRadarTab, ExitRadarTab, MultiMarketRadarTab, ...)
│   │   ├── lib/                (radar-cache, radar-db, radar-signal-tracker)
│   │   └── index.ts
│   ├── portfolio/              ← user portfolio
│   │   ├── components/         (EnhancedPortfolioView, RoboAdvisorPanel, ...)
│   │   └── index.ts
│   ├── screener/               ← stock screening
│   │   ├── components/         (StockScreenerAdvanced, ...)
│   │   └── index.ts
│   ├── market-analysis/        ← market-wide analysis
│   │   ├── components/         (MarketAnalysisView, SectorTrackingTab, ...)
│   │   └── index.ts
│   ├── news/                   ← news feed + impact
│   │   ├── components/         (NewsFeedView, ...)
│   │   └── index.ts
│   ├── publishing/             ← share/publish components
│   │   ├── components/         (StockPublisher, UnifiedPublishButton, ShareButton)
│   │   ├── lib/                (stock-publish-text, official-links)
│   │   └── index.ts
│   ├── admin/                  ← admin panel
│   │   ├── components/         (DatabaseManagerFull, SystemTopologyTab, ...)
│   │   └── index.ts
│   ├── crypto/                 ← crypto-specific
│   │   ├── components/         (CryptoAdvancedAnalysisView, ...)
│   │   └── index.ts
│   ├── education/              ← academy + learning
│   │   ├── components/         (AcademyView, LearningView, ...)
│   │   └── index.ts
│   ├── reports/                ← PDF reports + weekly report
│   │   ├── components/         (ReportsView, WeeklyReportTab, ...)
│   │   └── index.ts
│   └── dashboard/              ← home dashboard
│       ├── components/         (DashboardView, widgets)
│       └── index.ts
├── shared/                     ← truly reusable (moved from components/shared + ui)
│   ├── ui/                     (shadcn primitives — 51 components)
│   ├── UnifiedTable/           (table + types)
│   ├── StockPublisher/         (publishing)
│   ├── MiniSparkline/          (chart)
│   ├── SignalStrengthMeter/    (radar)
│   ├── MarketSelector/         (market switcher)
│   ├── LazyTabLoader/          (loading state)
│   ├── ErrorBoundary/          (error handling)
│   └── SafeWidget/             (widget wrapper)
├── lib/                        ← cross-cutting concerns (KEEP)
│   ├── store.ts                (Zustand)
│   ├── auth/                   (auth helpers)
│   ├── db/                     (consolidated DB helpers)
│   ├── logger.ts               (structured logging)
│   ├── admin-guard.ts          (auth guard)
│   └── utils.ts                (cn, safeNum, etc.)
└── app/                        ← Next.js App Router (KEEP)
    ├── page.tsx                (entry point)
    ├── api/                    (API routes — thin proxies)
    └── layout.tsx
```

### Backend Module Structure

```
vps-service/
├── modules/                    ← NEW: canonical module home
│   ├── stock-analysis/         ← single stock analyzers
│   │   ├── analyzers/          (technical, fundamental, smc, flow_score, ...)
│   │   ├── api/                (analysis routes)
│   │   └── __init__.py
│   ├── predictions/            ← V40.2 + daily_closer + learning
│   │   ├── jobs/               (v40_2_daily_generator, daily_closer, learning_engine)
│   │   ├── api/                (prediction routes)
│   │   └── __init__.py
│   ├── radar/                  ← liquidity radar (entry + exit)
│   │   ├── scripts/            (maker_radar, exit_radar)
│   │   ├── api/                (radar routes)
│   │   └── __init__.py
│   ├── market-regime/          ← MarketRegimeEngine
│   │   ├── analyzers/          (market_regime_engine)
│   │   └── __init__.py
│   ├── market-data/            ← data engine + scrapers
│   │   ├── scrapers/           (tradingview, yahoo, crypto, metals, us_stock)
│   │   ├── scheduler/          (smart_scheduler)
│   │   └── __init__.py
│   ├── telegram/               ← Telegram bot + publishers
│   │   ├── bot/                (auto_post_scheduler, radar_card_publisher)
│   │   ├── publishers/         (all publisher modules)
│   │   └── __init__.py
│   ├── ai/                     ← AI agent + news analyzer
│   │   ├── agents/             (glm_finance_agent, nightly_analysis)
│   │   └── __init__.py
│   ├── portfolio/              ← position management
│   │   ├── managers/           (position_manager, stop_manager, smart_exit)
│   │   └── __init__.py
│   └── admin/                  ← admin tools
│       ├── tools/              (evaluate_predictions, diagnose, restore)
│       └── __init__.py
├── shared/                     ← cross-cutting (moved from utils/ + config/ + core/)
│   ├── db/                     (db_paths, database helpers)
│   ├── config/                 (sys_config, constants)
│   ├── utils/                  (calendar, gates, helpers)
│   └── __init__.py
├── services/                   ← entry points
│   ├── main.py                 (FastAPI)
│   ├── lightweight_server.py   (Flask)
│   └── ws-service/             (socket.io)
└── tests/                      ← tests (KEEP)
```

---

## 🔧 Execution Plan (7 Phases)

### Phase 1: Delete Dead Code (Day 1)
**Target:** Remove ~63,000 LOC of dead/orphan code

**Frontend deletions:**
- `src/components/studio/` (9 files, 3,200 LOC) — orphan React Flow editor
- `src/lib/analysis-engine.ts` (3,126 LOC) — 0 importers
- `src/lib/cache/precomputed-cache.ts` (1,022 LOC) — 0 importers
- `src/lib/data-adapter.ts` (1,342 LOC) — 0 importers
- `src/lib/use-python-api.ts` (451 LOC) — 0 importers
- `src/lib/seed-historical-data.ts` (622 LOC) — 0 importers
- `src/lib/technical-analysis.ts` (488 LOC) — duplicate of analysis-engine
- `src/lib/persona-matrix.ts` (196 LOC) — 0 importers
- `src/lib/paymob.ts` (425 LOC) — 0 importers
- 10 dead components (sniper, 2× screener, watchlist pro, etc.)
- Total: ~21,500 LOC

**Backend deletions:**
- 68 orphan analyzers (~41,500 LOC)
- 3 stale data_engine servers (keep main.py only)
- 6 dead-on-arrival analyzers (crypto_mr_signal, crypto_prediction_engine, etc.)
- `strategies_merge/` (7 files, 557 LOC) — 0 callers
- Total: ~41,500 LOC

### Phase 2: Consolidate Duplicates (Day 2)
**Target:** Merge duplicate modules

**Frontend:**
- Merge `share/ShareButton` + `shared/ShareButton` → keep `shared/`
- Merge `portfolio/WealthCharts` + `admin/WealthCharts` → keep `admin/`
- Merge `StockScreener` (legacy) + `StockScreenerAdvanced` → keep Advanced
- Delete `stock-movement-classification.ts` + `stock-movement-classifier.ts` (both orphan)

**Backend:**
- Merge 4 confluence engines → keep `confluence_engine_v3.py` (most complete)
- Merge 7 fundamental modules → keep `fundamental_data_provider.py` + `fundamental_scorer.py`
- Merge 4 technical modules → keep `technical.py` + `technical_target_engine.py`
- Merge 2 market_regime engines → keep `analyzers/market_regime_engine.py` (canonical)

### Phase 3: Create Module Structure (Day 3)
**Target:** Move files into module directories

- Create `src/modules/` directory
- Create `vps-service/modules/` directory
- Use `git mv` to move files (preserve history)
- Update all import paths

### Phase 4: Wire Hidden Gems (Day 4)
**Target:** Connect disconnected pieces

**Frontend wiring:**
- Wire `AccuracyDashboard` → MarketAnalysisView tab
- Wire `PersonalizedRadarTab` → MarketAnalysisView tab
- Wire `MultiMarketRadarTab` → MarketAnalysisView tab
- Wire `LiquidityFlowPanel` → Dashboard widget
- Wire `IntradayPressurePanel` → Dashboard widget
- Wire `SystemTopologyGraph` → Admin tab
- Wire `PredictionsBacktestTable` → Dashboard widget

**Backend wiring:**
- Wire `mine_learned_lessons.py` → weekly cron
- Wire `exit_policy_optimizer.py` → monthly cron
- Wire `post_market_feedback.py` → daily cron
- Wire `hot_candidate_detector.py` → intraday cron
- Wire `telegram_marketing_engine.py` → replace smaller publishers

### Phase 5: Consolidate DB Layer (Day 5)
**Target:** Unify DB access

- Merge 20+ DB helper files into 4-5 canonical:
  - `lib/db/stocks.ts` (stocks.db access)
  - `lib/db/predictions.ts` (predictions.db access)
  - `lib/db/data-engine.ts` (data_engine.db access)
  - `lib/db/auth.ts` (auth.db access)
  - `lib/db/radar.ts` (radar cache + tracking)
- Update all imports

### Phase 6: Standardize Module Interfaces (Day 6)
**Target:** Each module exports a clean interface

- Each `modules/*/index.ts` exports the public API
- Internal files are private
- Cross-module imports go through `index.ts`

### Phase 7: Document (Day 7)
**Target:** Full documentation

- Module catalog (each module: purpose, interface, dependencies)
- Migration guide
- Architecture diagram
- Update all 4 cornerstone docs

---

## 📋 Module Catalog (Proposed)

### Frontend Modules

| Module | Purpose | Key Components | LOC |
|--------|---------|----------------|-----|
| stock-analysis | Deep single-stock analysis | StockDetail, ComprehensiveStockAnalysis | ~15K |
| predictions | V40.2 predictions tracking | PredictionTrackingView, PersonaTab, DualTrackView | ~20K |
| radar | Liquidity radar | MakerRadarTab, ExitRadarTab, MultiMarketRadarTab, PersonalizedRadarTab | ~15K |
| portfolio | User portfolio | EnhancedPortfolioView, RoboAdvisorPanel | ~12K |
| screener | Stock screening | StockScreenerAdvanced | ~8K |
| market-analysis | Market-wide analysis | MarketAnalysisView, SectorTrackingTab, AccuracyDashboard | ~10K |
| news | News feed | NewsFeedView | ~5K |
| publishing | Share/publish | StockPublisher, UnifiedPublishButton | ~3K |
| admin | Admin panel | DatabaseManagerFull, SystemTopologyTab | ~15K |
| crypto | Crypto-specific | CryptoAdvancedAnalysisView | ~8K |
| education | Academy + learning | AcademyView, LearningView | ~5K |
| reports | PDF reports | ReportsView, WeeklyReportTab | ~5K |
| dashboard | Home dashboard | DashboardView + widgets | ~8K |

### Backend Modules

| Module | Purpose | Key Files | LOC |
|--------|---------|-----------|-----|
| stock-analysis | Single stock analyzers | technical, fundamental, smc, flow_score | ~30K |
| predictions | V40.2 pipeline | v40_2_daily_generator, daily_closer, learning_engine | ~20K |
| radar | Liquidity radar | maker_radar, exit_radar, signal_tracker | ~5K |
| market-regime | Regime detection | market_regime_engine | ~2K |
| market-data | Data scrapers | tradingview, yahoo, crypto, metals, us_stock | ~11K |
| telegram | Telegram bot | auto_post_scheduler, radar_card_publisher | ~13K |
| ai | AI agent | glm_finance_agent, nightly_analysis | ~7K |
| portfolio | Position management | position_manager, stop_manager, smart_exit | ~5K |
| admin | Admin tools | evaluate_predictions, diagnose, restore | ~3K |

---

## ⚠️ Constraints

1. **NO new code** — only move, wire, delete
2. **NO new screens** — only reorganize existing
3. **NO new functionality** — only connect existing
4. **Preserve git history** — use `git mv`
5. **Update all imports** — no broken paths
6. **Tests must pass** — `bun run lint` + `bun run test` after each phase
7. **App must stay up** — `curl localhost:3001/` must return 200

---

## 🎯 Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Total LOC | ~580K | ~500K (delete 80K dead) |
| Frontend modules | 0 (scattered) | 13 |
| Backend modules | 0 (scattered) | 9 |
| Shared components | 9 | 15 (consolidate) |
| Dead LOC | ~63K | 0 |
| Duplicate groups | 17 | 0 |
| Wiring disconnects | 30+ | 0 |
| Tests passing | 187+ | 187+ (preserve) |
