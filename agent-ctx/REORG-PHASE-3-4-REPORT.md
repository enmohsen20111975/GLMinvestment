# REORG-PHASE-3-4 — Module Structure + Wire Hidden Gems

> **Task ID:** REORG-PHASE-3-4
> **Agent:** Senior Software Engineer (reorganization Phase 3+4)
> **Date:** 2026-09-30
> **Predecessor:** REORG-PHASE-1-2 (deleted 21,321 LOC of dead code + merged 4 duplicate groups)
> **Successor:** REORG-PHASE-5 (DB consolidation) + REORG-PHASE-6 (module interfaces)

---

## 🎯 Mission Recap

Execute Phase 3 (Create Module Structure — Modules 1-3 only: radar + publishing + personalized) + Phase 4 (Wire Hidden Gems). NO new code — only `git mv` + import path updates + wiring of existing-but-unrendered components + cron jobs.

---

## ✅ Phase 3 — Module Structure Created

### 3.1 Frontend Modules (3 created)

#### Module 1: `src/modules/radar/` — ✅

| Old path | New path |
|----------|----------|
| `src/components/predictions/radar/AccuracyDashboard.tsx` | `src/modules/radar/components/AccuracyDashboard.tsx` |
| `src/components/predictions/radar/ExitRadarTab.tsx` | `src/modules/radar/components/ExitRadarTab.tsx` |
| `src/components/predictions/radar/MultiMarketRadarTab.tsx` | `src/modules/radar/components/MultiMarketRadarTab.tsx` |
| `src/components/predictions/radar/PersonalizedRadarTab.tsx` | `src/modules/radar/components/PersonalizedRadarTab.tsx` |
| `src/components/predictions/radar/RadarStatsCards.tsx` | `src/modules/radar/components/RadarStatsCards.tsx` |
| `src/components/predictions/radar/SignalStrengthMeter.tsx` | `src/modules/radar/components/SignalStrengthMeter.tsx` |
| `src/components/predictions/radar/SignalTrackingTimeline.tsx` | `src/modules/radar/components/SignalTrackingTimeline.tsx` |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | `src/modules/radar/components/WeeklyReportTab.tsx` |
| `src/lib/radar-cache.ts` | `src/modules/radar/lib/radar-cache.ts` |
| `src/lib/radar-db.ts` | `src/modules/radar/lib/radar-db.ts` |
| `src/lib/radar-signal-tracker.ts` | `src/modules/radar/lib/radar-signal-tracker.ts` |

**Public API:** `src/modules/radar/index.ts` exports the 8 components (4 stat cards + SignalStrengthMeter + ExitRadarTab + SignalTrackingTimeline + WeeklyReportTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab). Internal lib files are accessed directly by API routes via `@/modules/radar/lib/*`.

#### Module 2: `src/modules/publishing/` — ✅

| Old path | New path |
|----------|----------|
| `src/components/shared/StockPublisher.tsx` | `src/modules/publishing/components/StockPublisher.tsx` |
| `src/components/shared/UnifiedPublishButton.tsx` | `src/modules/publishing/components/UnifiedPublishButton.tsx` |
| `src/components/shared/ShareButton.tsx` | `src/modules/publishing/components/ShareButton.tsx` |
| `src/lib/official-links.ts` | `src/modules/publishing/lib/official-links.ts` |
| `src/lib/stock-publish-text.ts` | `src/modules/publishing/lib/stock-publish-text.ts` |

**Public API:** `src/modules/publishing/index.ts` re-exports the 3 components + 5 lib helpers (`OFFICIAL_LINKS`, `OFFICIAL_LINKS_SHORT`, `OFFICIAL_LINKS_BLOCK`, `COMMUNITY_PROMPT`, `withOfficialLinks`, `RECOMMENDATION_TEXT`, `MARKET_REGIME_AR`, `generatePublishText`, `generatePublishPayload`, `escapeHtmlForTelegram`).

#### Module 3: `src/modules/personalized/lib/` — ✅

| Old path | New path |
|----------|----------|
| `src/lib/personalized-radar.ts` | `src/modules/personalized/lib/personalized-radar.ts` |

No `index.ts` (single file, no public API surface beyond the file itself).

### 3.2 Backend Modules (lighter touch — directory placeholders only)

Created `vps-service/modules/` with 8 subdirectories + `__init__.py` in each. **No file moves** — actual moves deferred to a later phase pending Python import-graph analysis (per task instructions). The directories mark the package boundaries:

```
vps-service/modules/
├── __init__.py
├── admin/__init__.py
├── ai/__init__.py
├── market_data/__init__.py
├── market_regime/__init__.py
├── portfolio/__init__.py
├── predictions/__init__.py
├── radar/__init__.py
└── telegram/__init__.py
```

Each `__init__.py` is a docstring placeholder noting the planned scope. No runtime impact (no Python code imports these yet).

### 3.3 Deferred Modules (TODO for next phase)

Modules 4-13 (stock-analysis, predictions, portfolio, screener, market-analysis, news, admin, crypto, education, reports, dashboard) — **DEFERRED** per task instructions ("LARGER moves that affect many files"). Will be executed in a subsequent reorg phase after the 3 self-contained modules stabilize.

---

## ✅ Phase 4 — Hidden Gems Wired

### 4.1 Three "almost-dead" radar tabs wired into `MarketAnalysisView.tsx` — ✅

Added 3 dynamic-imported tabs at the end of the existing 8-tab grid (total now 11):

| Tab value | Arabic label | Icon | Component | Props |
|-----------|--------------|------|-----------|-------|
| `multi-market-radar` | الرادار الموحّد | `<Radar>` violet | `<MultiMarketRadarTab />` | none |
| `radar-accuracy` | دقة الرادار | `<Gauge>` amber | `<AccuracyDashboard market={currentMarket} />` | `market` |
| `personalized-radar` | الرادار المخصّص | `<UserCircle>` cyan | `<PersonalizedRadarTab />` | none |

TabsList grid layout adjusted from `sm:grid-cols-4 lg:grid-cols-8` → `sm:grid-cols-6 lg:grid-cols-11` to accommodate the new tabs. All 3 are lazy-loaded (`ssr: false` + `<Skeleton>` fallback) so they ship as separate JS chunks.

### 4.2 Four backend cron jobs wired into `crontab.txt` — ✅

Added entries 19-22 (existing crontab had 1-18):

| # | Job | Schedule (UTC) | Schedule (Cairo) | Target script | Output log |
|---|-----|----------------|-------------------|---------------|------------|
| 19 | Mine Learned Lessons | `0 4 * * 0` (weekly Sunday) | 06:00 Sun | `scripts/mine_learned_lessons.py` | `/tmp/learned_lessons.log` |
| 20 | Exit Policy Optimizer | `0 5 1 * *` (monthly 1st) | 07:00 on 1st | `scripts/exit_policy_optimizer.py` | `/tmp/exit_optimizer.log` |
| 21 | Post-Market Feedback | `30 14 * * 0-4` (Sun-Thu) | 16:30 daily after EGX close | `scripts/post_market_feedback.py` | `/tmp/post_market_feedback.log` |
| 22 | Hot Candidate Detector | `*/15 8-12 * * 0-4` (Sun-Thu) | every 15min during EGX session | `vps-service/jobs/hot_candidate_detector.py` | `/tmp/hot_candidate.log` |

All 4 target scripts verified to exist on disk. The cron jobs wire previously-orphan Python scripts into the production scheduler.

### 4.3 `LiquidityFlowPanel` + `IntradayPressurePanel` to dashboard — ✅ (already wired by P1-GEMS-WIRING)

Audit-verification: these were ALREADY wired in a prior task ("P1-GEMS-WIRING §3.6" comments present in `DashboardView.tsx` lines 432-447). No re-wiring needed — verified the render block exists:

```tsx
{showMarketFlowPanels && (
  <section aria-label="حركة السيولة وضغط الجلسة" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <SafeWidget name="حركة السيولة القطاعية"><LiquidityFlowPanel /></SafeWidget>
    <SafeWidget name="ضغط الشراء والبيع داخل الجلسة"><IntradayPressurePanel initialTicker={selectedTicker || 'COMI'} /></SafeWidget>
  </section>
)}
```

Imports at lines 24-25 already use `@/components/dashboard/LiquidityFlowPanel` and `@/components/dashboard/IntradayPressurePanel` (these stay — they're dashboard widgets, not part of the moved radar/publishing modules).

### 4.4 `SystemTopologyGraph` to admin — ✅ (already wired by P1-GEMS-WIRING)

Audit-verification: `SystemTopologyTab` (which wraps `SystemTopologyGraph`) was ALREADY wired as a full admin tab in `AdminView.tsx`:
- Line 408: `AdminTab` type includes `'system-topology'`
- Line 994: Tab registered in tabs list with `id: 'system-topology'`, label `'طوبولوجيا النظام'`, icon `<Network />`
- Lines 213-221: `SystemTopologyTab` lazy-loaded via `next/dynamic` + `withErrorBoundary`
- Lines 1936-1938: Render block `{activeTab === 'system-topology' && (<SystemTopologyTab />)}`

No re-wiring needed.

---

## 📊 Verification Results

| Check | Result |
|-------|--------|
| `bun run lint` | exit 0 ✅ (after every module move + final) |
| `bun run test` | 259 passed / 15 failed / 9 skipped (283 total) — 0 NEW failures ✅ |
| `curl http://localhost:3001/` | HTTP 200 ✅ |
| Stale `@/components/predictions/radar/*` imports | 0 remaining ✅ |
| Stale `@/components/shared/{StockPublisher,UnifiedPublishButton,ShareButton}` imports | 0 remaining ✅ |
| Stale `@/lib/{radar-cache,radar-db,radar-signal-tracker,personalized-radar,official-links,stock-publish-text}` imports | 0 remaining ✅ |
| Old `src/components/predictions/radar/` directory | removed (empty after moves) ✅ |
| New `src/modules/{radar,publishing,personalized}/` structure | 19 files total (3 index.ts + 16 moved files) ✅ |
| New `vps-service/modules/` structure | 9 `__init__.py` files (1 root + 8 subdirs) ✅ |
| MarketAnalysisView new tabs | 3 TabsTrigger + 3 TabsContent added (11 tabs total now) ✅ |
| crontab.txt new entries | 4 jobs added (lines 109-134) ✅ |
| Radar test files (6 files / 79 tests) | all pass except 2 pre-existing WeeklyReportTab failures ✅ |
| StockPublisher test file (21 tests) | all pass ✅ |

The 15 pre-existing test failures are identical to those documented in `REORG-PHASE-1-2-REPORT.md` — all DB-integration tests requiring populated SQLite tables (`historical_trades`, `learned_lessons`, `market_regime_log`, `gold_prices`, `stored_analyses`, `hunter_pick_tracking`) + 2 radar `WeeklyReportTab` UI mock tests. **Zero new failures** introduced by Phase 3-4.

---

## 📈 Statistics

| Metric | Value |
|--------|-------|
| **Files moved via `git mv`** | **17** (8 radar components + 3 radar libs + 3 publishing components + 2 publishing libs + 1 personalized lib) — all R100 (100% history preserved) |
| **Files modified (import updates + wiring)** | **62** |
| **New files created** | 12 (2 frontend `index.ts` + 9 backend `__init__.py` + this report) |
| **Frontend modules created** | 3 (radar, publishing, personalized) |
| **Backend module placeholders created** | 8 (radar, predictions, market_regime, market_data, telegram, ai, portfolio, admin) |
| **Hidden gems wired** | 3 frontend tabs + 4 backend cron jobs = 7 (2 other frontend wirings — LiquidityFlowPanel/IntradayPressurePanel + SystemTopologyGraph — were already done by P1-GEMS-WIRING) |
| **Import paths updated** | ~120+ import sites across 62 files (sed-bulk for radar-lib + publishing-lib + publishing-components + personalized-radar; Edit-per-file for radar-component direct imports in MakerRadarTab + MarketAnalysisView + 6 test files) |
| **Lint status** | exit 0 ✅ |
| **Test status** | 259 passed / 15 pre-existing failures / 9 skipped — 0 NEW failures ✅ |
| **App health** | HTTP 200 ✅ throughout |
| **Git history preservation** | 100% (all `git mv` returned R100 = identical content, no rename detection needed) |

---

## 📋 Files Changed (Complete Inventory)

### Renamed (17 files via `git mv`, all R100):

**Radar components (8):**
- `src/components/predictions/radar/{AccuracyDashboard,ExitRadarTab,MultiMarketRadarTab,PersonalizedRadarTab,RadarStatsCards,SignalStrengthMeter,SignalTrackingTimeline,WeeklyReportTab}.tsx` → `src/modules/radar/components/`

**Radar lib (3):**
- `src/lib/{radar-cache,radar-db,radar-signal-tracker}.ts` → `src/modules/radar/lib/`

**Publishing components (3):**
- `src/components/shared/{StockPublisher,UnifiedPublishButton,ShareButton}.tsx` → `src/modules/publishing/components/`

**Publishing lib (2):**
- `src/lib/{official-links,stock-publish-text}.ts` → `src/modules/publishing/lib/`

**Personalized lib (1):**
- `src/lib/personalized-radar.ts` → `src/modules/personalized/lib/personalized-radar.ts`

### Created (12 new files):
- `src/modules/radar/index.ts`
- `src/modules/publishing/index.ts`
- `vps-service/modules/__init__.py` (root)
- `vps-service/modules/{admin,ai,market_data,market_regime,portfolio,predictions,radar,telegram}/__init__.py` (8 files)
- `agent-ctx/REORG-PHASE-3-4-REPORT.md` (this file)

### Modified (62 files — import path updates + tab wiring):

**Tab wiring (1 file):**
- `src/components/analysis/MarketAnalysisView.tsx` — added 3 TabsTrigger + 3 TabsContent + 3 dynamic imports + 3 lucide-react icons + TabsList grid cols 4/8 → 6/11

**Radar component imports updated (8 files):**
- `src/components/predictions/MakerRadarTab.tsx` — 3 imports (RadarStatsCards + SignalStrengthMeter + SignalTrackingTimeline)
- `src/components/analysis/MarketAnalysisView.tsx` — 2 dynamic imports (ExitRadarTab + WeeklyReportTab)
- 6 test files: `src/__tests__/radar/{WeeklyReportTab,MultiMarketRadarTab,PersonalizedRadarTab,SignalStrengthMeter,AccuracyDashboard,SignalTrackingTimeline}.test.tsx`

**Radar lib imports updated (12 files):**
- `src/lib/schedulers/radar-alerts.ts` — radar-cache + radar-signal-tracker (dynamic import on line 932)
- `src/app/api/radar/personalized/route.ts` — radar-cache
- `src/app/api/stocks/[ticker]/publish-data/route.ts` — radar-db
- `src/app/api/maker-radar/{route,footprint/route,entry-timing/route,warmup/route,timeline/route,sector-treemap/route,exit-radar/route,stock/route}.ts` — radar-cache + radar-db (8 files)

**Publishing component imports updated (14 files):**
- `src/__tests__/shared/StockPublisher.test.tsx`
- `src/components/advanced-analysis/SpecialistAnalysisView.tsx`
- `src/components/ai/AIAnalysisWidget.tsx`
- `src/components/analysis/ExpertRecommendationsPanel.tsx`
- `src/components/crypto/{CryptoAdvancedAnalysisView,CryptoPredictionTrackingView,CryptoScreenerView}.tsx`
- `src/components/dashboard/{DashboardView,PredictionsBacktestTable}.tsx`
- `src/components/predictions/{DualTrackPredictionsView,MakerRadarTab,PredictionTrackingDashboard,PredictionTrackingView}.tsx`
- `src/components/portfolio/{EnhancedPortfolioView,RoboAdvisorPanel}.tsx`
- `src/components/reports/{ReportsView,DailyMarketReport,ExecutiveReportView}.tsx`
- `src/components/screener/StockScreenerAdvanced.tsx`
- `src/components/stocks/{StockDetail,StocksView,StockAdvancedAnalysisView}.tsx`
- `src/components/watchlist/EnhancedWatchlistView.tsx`
- `src/components/analysis/market-analysis/LiveTrackingTab.tsx`
- `src/components/analysis/market-analysis/SectorTrackingTab.tsx`
- `src/components/news/NewsFeedView.tsx`

**Publishing lib imports updated (16 files):**
- 12 market-analysis submodule files (CryptoPredictionsTab, ExpertPredictionsTab, LiveTrackingTab, MarketStatusTab, MorningBellSection, PersonaTab, PredictionsTab, SectorTrackingTab, helpers.ts, ExpertRecommendationsPanel)
- `src/components/layout/Footer.tsx`
- `src/components/market/{TopTradesImageCard,StockLeagueImageCard,MarketStatusExport}.tsx`
- `src/components/news/NewsFeedView.tsx`
- `src/components/recommendations/SocialPostView.tsx`
- `src/components/reports/{ReportsView,DailyMarketReport}.tsx`
- `src/components/sniper/OpportunityCard.tsx`
- `src/components/publishing/QuickPublishButton.tsx`
- `src/components/share/ShareButton.tsx` (note: distinct from `shared/ShareButton.tsx` — this is the rich-Arabic-card variant; it stays in `src/components/share/` per Phase 2 decision)
- `src/app/api/telegram/{publish-stock/route,share/route}.ts`
- `src/components/predictions/PredictionTrackingDashboard.tsx`
- `src/components/predictions/radar/WeeklyReportTab.tsx` (now at `src/modules/radar/components/WeeklyReportTab.tsx`)

**Personalized lib imports updated (1 file):**
- `src/app/api/radar/personalized/route.ts` — personalized-radar

**Cron schedule updated (1 file):**
- `crontab.txt` — 4 new entries (jobs 19-22) appended before the "للتثبيت" footer

---

## ⚠️ Constraints Compliance

| Rule | Status |
|------|--------|
| **NO new code** — only move + wire | ✅ No new logic added. Only `git mv` + sed-bulk import path updates + 3 dynamic-imports (pre-existing components) + 4 cron entries (pre-existing scripts) + 2 `index.ts` files (pure re-export shims) + 9 backend `__init__.py` placeholders (pure docstrings). |
| **NO new screens** | ✅ All 3 new tabs use existing components (MultiMarketRadarTab, AccuracyDashboard, PersonalizedRadarTab — 2,007 LOC of "almost-dead" code per audit). |
| **NO new functionality** | ✅ Only connected existing pieces. |
| **Preserve git history** — use `git mv` | ✅ All 17 file moves done via `git mv`. `git diff --cached -M` reports `R100` for every rename (100% content similarity, no rename-detection heuristics needed). |
| **Update all imports** | ✅ Verified 0 stale imports remain (`@/components/predictions/radar/*`, `@/components/shared/{StockPublisher,UnifiedPublishButton,ShareButton}`, `@/lib/{radar-cache,radar-db,radar-signal-tracker,personalized-radar,official-links,stock-publish-text}` all returned zero grep hits in src/). |
| **Tests must pass** | ✅ 259 passed / 15 pre-existing failures / 9 skipped — **0 new failures** (baseline matches Phase 1-2). |
| **App must stay up** | ✅ `curl localhost:3001/` returned HTTP 200 throughout (one recompile pause observed after the personalized-radar.ts move; recovered after ~30s with no manual intervention). |
| **Lint after every module move** | ✅ Ran `bun run lint` after radar move, after publishing move, after personalized move, and final — all exit 0. |

---

## 🎯 Next Actions (for Phase 5-7)

1. **Phase 5 — DB Consolidation:** Merge 20+ DB helper files into 4-5 canonical files (`lib/db/stocks.ts`, `lib/db/predictions.ts`, `lib/db/data-engine.ts`, `lib/db/auth.ts`, `lib/db/radar.ts`). Update all `@/lib/{db-helpers,egx-db,unified-db,...}` imports.
2. **Phase 6 — Module Interfaces:** Standardize each `modules/*/index.ts` so cross-module imports go through the public API (currently only `radar/` and `publishing/` have index.ts; need to add for stock-analysis, predictions, portfolio, etc. once they're moved in deferred Phase 3 modules 4-13).
3. **Phase 7 — Documentation:** Module catalog + migration guide + architecture diagram. Update the 4 cornerstone docs.
4. **Deferred Phase 3 modules 4-13** (stock-analysis, predictions, portfolio, screener, market-analysis, news, admin, crypto, education, reports, dashboard) — bigger blast radius; each module's importers should be re-routed through the new module index.ts in one PR per module.
5. **Backend Python module migration** — once `vps-service/modules/` directory placeholders stabilize, perform Python import-graph analysis (using `pydeps` or `snakefood`) to plan which analyzer/engine files move into which module. Then `git mv` Python files in batches + update `from analyzers.X import` paths.

---

## 📂 Report Location

`/home/z/my-project/agent-ctx/REORG-PHASE-3-4-REPORT.md` (this file)
