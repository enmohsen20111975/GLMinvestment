# MARKET-DEPTH-VIEW + REMOVE-PUBLISHER — main-agent

**Task ID:** MARKET-DEPTH-VIEW + REMOVE-PUBLISHER
**Agent:** main-agent
**Date:** 2026-10-05
**Commit:** `e77adb2` — `feat: market-depth view + remove publisher from screener`

## Goal
Two related cleanup tasks:
- **A.** Create `#market-depth` view (شاشة منفصلة) holding the 4 widgets: MultiMarketWidget, InvestorsFlowPanel, LiquidityFlowPanel, IntradayPressurePanel. Remove them from DashboardView so dashboard is clean.
- **B.** Remove StockPublisher button from the screener `ticker` column (owner: "حاط زرار للنشر جنب كل سهم ده وحش جدا").

## Approach
Rule 4 compliance (NO new component files): the new view is inlined as JSX directly in `src/app/page.tsx` inside `case 'market-depth':`. The 4 widgets are wrapped in lazy-loaded `dynamicImport` chunks + `withErrorBoundary` (same pattern as `BagHolderRescueView`, `LiquidityRadarView`). Each is then wrapped in `SafeWidget` inside the JSX block so any runtime error in one widget doesn't crash the others.

## Files changed (6)

### 1. `src/types/index.ts`
- Added `| 'market-depth'` to the `AppView` union type, alongside `trading-chart` and `liquidity-radar` (the EGX/Market section).

### 2. `src/lib/valid-views.ts`
- Added `'market-depth'` to `VALID_VIEWS` array (between `liquidity-radar` and `dual-track`). Deep-link `#market-depth` now resolves correctly.

### 3. `src/app/page.tsx`
- **Imports added (top of file):**
  - `SafeWidget` from `@/modules/dashboard/components/SafeWidget`
  - `Header` from `@/components/layout/Header`
  - `Alert, AlertDescription` from `@/components/ui/alert`
  - `Info` icon from `lucide-react`
- **AppShell destructure:** added `const selectedTicker = useAppStore((s) => s.selectedTicker);` so the IntradayPressurePanel can pick up the user's currently-selected ticker (defaults to `'COMI'`).
- **Lazy chunks (4 new dynamic imports)** — `MarketDepthMultiMarket`, `MarketDepthInvestorsFlow`, `MarketDepthLiquidityFlow`, `MarketDepthIntradayPressure`. Each is `withErrorBoundary(dynamicImport(...), label)` with a `<LazyTabLoader />` skeleton.
- **`case 'market-depth':` block in `renderView`:**
  - Uses `Header` + `<main className="flex-1 p-3 md:p-4 space-y-4" dir="rtl">`.
  - Always renders `MarketDepthMultiMarket` (multi-market widget works for all markets).
  - For `currentMarket === 'EGX'`: renders InvestorsFlow (full-width), then LiquidityFlow + IntradayPressure in a 2-col grid (lg:grid-cols-2). IntradayPressure uses `initialTicker={selectedTicker || 'COMI'}`.
  - For non-EGX markets: renders an amber `Alert` explaining that intraday data is EGX-only and the user should switch market from the TopBar dropdown.

### 4. `src/components/layout/TopBar.tsx`
- Added `{ id: 'market-depth', label: 'عمق السوق', icon: BarChart3, highlight: true }` to the `market` section nav items (right after `liquidity-radar`).
- `BarChart3` was already imported.
- Mobile menu and desktop dropdown both pick it up automatically (they share `navSections`).

### 5. `src/modules/dashboard/components/DashboardView.tsx`
- Removed imports: `InvestorsFlowPanel`, `LiquidityFlowPanel`, `IntradayPressurePanel`, `MultiMarketWidget`.
- Removed `selectedTicker` from the `useAppStore()` destructure (no longer used).
- Removed the `'multi-market'` widget from the `widgets` registry array (was rendered as section 5).
- Removed the section 5 render block (`{(() => { ... multi-market ... })()}`).
- Removed the EGX-only `<details>` block (section 7) that hosted InvestorsFlow + LiquidityFlow + IntradayPressure.
- Removed unused `showMarketFlowPanels` flag (was `currentMarket !== 'CRYPTO'`).
- Left explanatory comments at each removal point so future agents understand why the dashboard layout is now lighter.

### 6. `src/modules/screener/components/StockScreenerAdvanced.tsx`
- Removed the `import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher'` import (was the only consumer of `StockPublisher` in this file).
- Removed the entire `<StockPublisher ... />` JSX from inside the `ticker` column's `render` function. The column now renders just `ticker` + `name_ar` + `sector` (matching the radar table style, as the owner requested).

## Lint + HTTP verification
- `bun run lint` → EXIT=0 (clean, no warnings).
- `curl http://localhost:3000/` → HTTP=200 (gateway routes to next dev on :3001).
- `curl http://localhost:3001/` → HTTP=200 (direct dev server).
- Dev server running: `next-server (v14.2.28)` on port 3001.

## Push workflow
- `git stash && git pull --rebase origin main && git stash pop` → "Already up to date." (no upstream divergence).
- `git add ... && git commit -m "feat: market-depth view + remove publisher from screener"` → `e77adb2`.
- `git push origin main` → `8438273..e77adb2 main -> main` (clean push, no force).

## Rules compliance
- ✅ Rule 4 (no new component files) — `#market-depth` view is inlined as JSX inside `page.tsx`. No new files in `src/modules` or `src/components` for this view.
- ✅ Rule 28 (no duplication) — VALID_VIEWS is the single source of truth; AppView type added exactly once; no duplicated nav arrays.
- ✅ Rule 67 (backwards compat) — `#market-depth` is a brand-new hash; existing hashes untouched. Removed `StockPublisher` from the screener only (publisher still works elsewhere if needed).
- ✅ Existing components reused: `SafeWidget`, `Header`, `Alert`, `Info`, `LazyTabLoader`, `withErrorBoundary`, `BarChart3` icon (already imported), `MultiMarketWidget`, `InvestorsFlowPanel`, `LiquidityFlowPanel`, `IntradayPressurePanel`.
- ✅ EGX-only notice for non-EGX markets (per task spec: "EGX-only components should show a notice for non-EGX markets").
- ✅ MultiMarketWidget shows for all markets (per task spec).
- ✅ Read each file BEFORE editing (Read tool, then Edit/MultiEdit).
- ✅ Lint + HTTP 200 checks done after edits.
- ✅ `git stash` + `git pull --rebase` + `git stash pop` before push.

## Notes for the next agent
- The new `MarketDepthMultiMarket`, `MarketDepthInvestorsFlow`, `MarketDepthLiquidityFlow`, `MarketDepthIntradayPressure` lazy chunks are the SOLE consumers of those 4 component files now. Don't be tempted to delete the component files — they're still live.
- The dashboard's `widgets` registry no longer has the `'multi-market'` entry. If you re-add it, also re-add the section block in the JSX (currently just a placeholder comment at line ~543).
- The `selectedTicker` value is now read in AppShell scope of page.tsx (added to the destructuring). Future views that need the selected ticker can use the same pattern.
- The amber Alert for non-EGX markets in `#market-depth` uses Tailwind amber palette (consistent with `DevelopmentNotice.tsx` pattern) — not the `Alert` `variant="default"` (which is gray) or `variant="destructive"` (red).
- The screener `ticker` column render now matches the radar table render pattern (ticker + name_ar + sector in a `<div>` stack with `font-mono font-bold text-sm`).
