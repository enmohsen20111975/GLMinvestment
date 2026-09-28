# 📚 Module Catalog — دليل الموديولات القياسية

> **آخر تحديث:** 2026-09-30
> **المرجع:** `agent-ctx/MASTER-ARCHITECTURE-PLAN.md` + `worklog.md` entries `REORG-PHASE-1-2` + `REORG-PHASE-3-4` + `REORG-PHASE-5` + `REORG-PHASE-6` + `REORG-PHASE-7-DOCS` (this task).
> **المرحلة:** Phase 7 (Reorganization Complete) — Final phase of the 7-Phase Module Reorganization.
> **القاعدة الدستورية:** Rule 60 (MODULE-SYSTEM — 2026-09-30) في `00-CONSTITUTION.md`.

---

## نظرة عامة

المشروع اتعاد تنظيمه من مشاريع صغيرة متفرقة إلى **15 موديول قياسي** في `src/modules/` + **9 موديولات backend placeholders** في `vps-service/modules/`.

كل موديول:
- بيحتوي على components + lib الخاصة بـ domain واحد.
- ليه `index.ts` كـ public interface (للـ frontend) أو `__init__.py` (للـ backend placeholders).
- internal files private، external imports عبر الـ index فقط.

> **ملاحظة تاريخية:** الـ 7 phases اتـ executedت في الفترة من 2026-09-25 لـ 2026-09-30.
> - Phase 1-2: حذف ~21,321 LOC من الـ dead code + دمج 4 duplicate groups.
> - Phase 3-4: إنشاء 3 frontend modules (radar + publishing + personalized) + 8 backend module placeholders + wiring 7 hidden gems.
> - Phase 5: توحيد DB layer + حذف 22K LOC إضافية من الـ dead DB helpers.
> - Phase 6: إنشاء 12 frontend modules إضافية (الـ total دلوقتي 15).
> - Phase 7 (هذه): توثيق كامل للـ module architecture الجديدة.

---

## Frontend Modules (`src/modules/`)

| # | Module | Purpose | Components | Lib | LOC (approx) |
|---|--------|---------|------------|-----|--------------|
| 1 | `radar/` | رادار السيولة + Exit Radar + Multi-Market + Accuracy + Personalized + Weekly Report + Signal Tracking | 8 components | 3 lib | ~6K |
| 2 | `publishing/` | StockPublisher + UnifiedPublishButton + ShareButton + official links | 3 components | 2 lib | ~3K |
| 3 | `personalized/` | Personalized Radar logic | — | 1 lib | ~1K |
| 4 | `stock-analysis/` | تحليل سهم فردي (StockDetail + ComprehensiveStockAnalysis + TreasuryBondsView + ...) | 15 components | — | ~15K |
| 5 | `predictions/` | تتبع التوقعات + PersonaTab + DualTrack + MakerRadarTab + PicksManagement | 5 components | — | ~20K |
| 6 | `portfolio/` | المحفظة + RoboAdvisor + BagHolderRescue + Risk Profiler Quiz + ... | 15 components | — | ~12K |
| 7 | `screener/` | فلترة الأسهم المتقدمة (StockScreenerAdvanced) | 1 component | — | ~8K |
| 8 | `market-analysis/` | تحليل السوق + SectorTracking + MarketAnalysisView + PersonaTab + PredictionsTab + ... | 24 components | — | ~10K |
| 9 | `news/` | الأخبار + التحليلات (NewsFeedView) | 1 component | — | ~5K |
| 10 | `admin/` | الأدمن (DB Manager + Topology + Users + Backtest + Notebook + Telegram + ... + live-chart/ + platform-performance/) | 34 components | — | ~15K |
| 11 | `crypto/` | الكريبتو (Trading Chart + Additional Views + Prediction Tracking + Advanced Analysis + Simulation + Screener + Learning + Portfolio) | 8 components | — | ~8K |
| 12 | `education/` | الأكاديمية + التعلم (AcademyView + LearningView + CandlestickSimulator + StrategySandbox + PaperTradingWorkstation + MathRenderer + ...) | 9 components | — | ~5K |
| 13 | `reports/` | التقارير + Weekly Report (ReportsView + DataManager + StockAnalysisReport + DailyMarketReport + ExecutiveReportView) | 5 components | — | ~5K |
| 14 | `dashboard/` | الرئيسية + widgets (DashboardView + 21 widgets: LiquidityFlow + IntradayPressure + InvestorsFlow + LiveMonitor + TopMovers + MaestroWidget + ...) | 21 components | — | ~8K |
| 15 | `simulation/` | المحاكاة (SimulationView) | 1 component | — | ~3K |

**Total frontend modules:** 15
**Total components:** 150+ (285 components total under `src/components/` + `src/modules/`)
**Total LOC:** ~120K (frontend modules only)

> **Module Architecture Compliance (Rule 60):** كل موديول ليه `index.ts` re-export shim. الـ imports بين الموديولات عبر الـ `index.ts` فقط. الـ `src/components/` legacy شغّال بس يُفضّل ترحيله في الـ future phases.

---

## Backend Modules (`vps-service/modules/` — placeholders)

| # | Module | Purpose | Status |
|---|--------|---------|--------|
| 1 | `radar/` | maker_radar + exit_radar + signal_tracker | placeholder (`__init__.py` docstring only) |
| 2 | `predictions/` | V40.2 generator + daily_closer + learning engine | placeholder |
| 3 | `market_regime/` | MarketRegimeEngine | placeholder |
| 4 | `market_data/` | data_engine + scrapers (TradingView + Yahoo + crypto + metals + us_stock) | placeholder |
| 5 | `telegram/` | auto_poster + card_publisher | placeholder |
| 6 | `ai/` | glm_finance_agent + nightly_analysis | placeholder |
| 7 | `portfolio/` | position_manager + stop_manager + smart_exit | placeholder |
| 8 | `admin/` | admin tools (evaluate_predictions + diagnose + restore) | placeholder |
| 9 | (root) | `vps-service/modules/__init__.py` | placeholder |

**Status:** placeholders only — Python file moves deferred (needs import-graph analysis). الـ Python analyzers/scripts لسه في `vps-service/analyzers/` + `vps-service/jobs/` + `vps-service/api/`. الترحيل الفعلي محتاج import-graph analysis عشان نتجنب كسر الـ 653 routes اللي بتـ import منهم مباشرة.

> **Follow-up (P1 — out of scope):** تنفيذ Phase 3-backend الفعلي — ترحيل الـ Python files لـ `vps-service/modules/<module>/` + تحديث الـ imports. يستحسن يتعمل في task منفصل لأن الـ Python import graph أكثر تعقيداً من الـ TypeScript.

---

## Shared Layer (`src/shared/` — TODO)

سيتم إنشاؤه في المرحلة القادمة لاحتواء الـ truly-reusable components (current target: moved out من `src/components/shared/` + `src/components/ui/`):

- `src/shared/ui/` — shadcn primitives (51 components)
- `src/shared/UnifiedTable/` — table component (Rule 54 — upgraded 2026-09-26)
- `src/shared/MiniSparkline/` — chart component
- `src/shared/SignalStrengthMeter/` — radar signal meter (currently في `src/modules/radar/components/`)
- `src/shared/MarketSelector/` — market switcher (5-market UI-Mirror — Rule 53)
- `src/shared/LazyTabLoader/` — loading state
- `src/shared/ErrorBoundary/` — error handling
- `src/shared/SafeWidget/` — widget wrapper (currently في `src/modules/dashboard/components/`)

> **Status:** NOT moved yet. دلوقتي الـ shared components لسه في `src/components/shared/` + `src/components/ui/`. الترحيل محتاج analysis للأثر على الـ 285+ components.

---

## DB Layer (`src/lib/db/` — Phase 5)

**Single entry point:** `src/lib/db/index.ts`

Exports from:

| Source File | DB / Purpose | Importers |
|---|---|---|
| `db-auth.ts` | `auth.db` — Prisma client (`db`, `authDb`) + User/Account/Session/SubscriptionPlan types | 5,031 importers via `@/lib/db` |
| `db-predictions.ts` | `predictions.db` — `predictionsDb` accessor | 9 importers |
| `modules/radar/lib/radar-db.ts` | `stocks.db` radar tables — `getRadarDb`, `parseVolume`, `computeTurnover`, `getRadarDbConfig` | re-exported via `@/lib/db` |
| `finance-db.ts` | `stocks.db` finance tables — `getFinanceDb`, `isFinanceDbAvailable` | 47 importers |
| `new-db.ts` | user data (Prisma) — `getDb`, `getReadOnlyDb` | 14 importers |
| `egxpy-bridge.ts` | Python backend bridge — `callPython`, `callPythonAsync` | 13 importers |
| `egx-data-sources.ts` | data sources config (TradingView + Yahoo + ...) — `getDataSource`, `listDataSources` | 4 importers |

> **Phase 5 deletions:** `db-helpers.ts` + `db-v2.ts` + `egx-trading-hours.ts` — 0 importers (dead facades). حوالي 22K LOC اتـ deletedت في Phase 5 من الـ dead DB helpers الكاملة.

> **Rule 1 (DB Safety):** كل الـ DB access بيحصل عبر `src/lib/db/index.ts`. ما فيش schema changes. ما فيش DB modifications. READ-ONLY access.

---

## Reorganization Stats

| Metric | Before | After | Delta |
|---|---|---|---|
| Frontend modules | 0 (scattered) | 15 | +15 |
| Backend modules | 0 (scattered) | 8 placeholders + root | +9 |
| Dead LOC | ~63,000 (estimated) | 0 in new module layer (legacy dead still in `src/components/`) | ~21,321 deleted (Phase 1-2) + ~22,000 deleted (Phase 5) = ~43,321 LOC removed |
| Duplicate groups | 17 | 4 merged (Phase 2) + remaining targeted in P1 | -4 |
| Wiring disconnects | 30+ | 7 wired (Phase 4) + 2 already wired (verified by audit) | -9 |
| Total LOC | ~580K | ~540K | -40K LOC |
| Tests passing | 187 | 259 passed / 15 pre-existing failures / 9 skipped (283 total) — 0 NEW failures | +72 tests passing |
| Frontend components | 274 (scattered) | 285 in modules + legacy | +11 wired orphan tabs |
| API routes | 653 | 653 (no new routes — Rule 4: NO new screens) | 0 |
| DB access entry points | 20+ scattered helpers | 1 canonical `src/lib/db/index.ts` | consolidated |
| Cron jobs | 18 | 22 (+4 wired in Phase 4.2) | +4 |
| Backend market-analysis tabs wired | 8 | 11 (+3 wired in Phase 4.1: MultiMarket + Accuracy + Personalized) | +3 |

---

## Module Index Files (Public Interfaces)

كل frontend module ليه `index.ts` re-export shim. الأمثلة:

```
src/modules/radar/index.ts          → 8 named exports (4 stat cards + SignalStrengthMeter + ExitRadarTab + SignalTrackingTimeline + WeeklyReportTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab)
src/modules/publishing/index.ts     → 3 components + 5 lib helpers (OFFICIAL_LINKS + OFFICIAL_LINKS_SHORT + RECOMMENDATION_TEXT + withOfficialLinks + ...)
src/modules/stock-analysis/index.ts → 15 components + types
src/modules/market-analysis/index.ts → 22 components + helpers (MARKET_CODES + _isEgxIntradayNow) + types
src/modules/admin/index.ts          → 32 components + 8 live-chart exports + PlatformPerformanceView + SystemIssue type
src/modules/dashboard/index.ts      → 21 components
src/modules/portfolio/index.ts      → 15 components + getPortfolioColorClass helper
... (and 7 more)
```

> **Pattern:** Cross-module imports go through the `index.ts` ONLY.
> Internal files are private — direct imports like `@/modules/<x>/components/InternalFile` are discouraged (though some API routes still use direct `lib/*` imports for transitional reasons).

---

## Migration Path (Future — P1+)

التوصيات للمراحل القادمة (after Phase 7):

1. **Shared layer extraction** — إنشاء `src/shared/` + ترحيل `src/components/shared/` + `src/components/ui/` (51 + 8 components).
2. **Backend module migration** — تحليل Python import graph + ترحيل الـ analyzers/jobs لـ `vps-service/modules/<module>/` + تحديث الـ imports.
3. **Legacy cleanup** — ترحيل الـ remaining `src/components/<domain>/` files لـ `src/modules/`.
4. **Strict module boundary enforcement** — منع direct imports من `@/modules/<x>/components/*` outside the module.

---

*تم الإنشاء بواسطة Documentation Secretary — Task ID `REORG-PHASE-7-DOCS` — 2026-09-30*
