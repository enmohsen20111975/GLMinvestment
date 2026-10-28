# Task FIX-FRONTEND-MARKET — Frontend market-code bugs fix

**Agent**: Bravo (fullstack TS/React engineer)
**Task ID**: FIX-FRONTEND-MARKET
**Date**: 2026-10-27 (approx)
**Status**: ✅ Complete — `bun run lint` passes with exit code 0; dev server renders `/` 200 OK with no new errors.

---

## Summary

Fixed the silent EGX-downgrade bug pattern that was sending `MARKET_CODES[market] = 'KSA'`
to API routes for Saudi Arabia (TADAWUL), even though the database stores the market as
`'TADAWUL'` (390 rows). The canonical remap pattern is:

```ts
const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
```

Also appended `?market=` (or `&market=`) to per-ticker endpoints so the backend can
disambiguate cross-market ticker collisions (e.g. `COMI` in EGX vs US), and gated EGX-only
widgets so non-EGX markets no longer fire EGX-only Python scripts.

---

## Files modified (22 source files)

### Priority 1 — Critical silent EGX-downgrade

1. **`src/modules/market-analysis/components/LiveTrackingTab.tsx`**
   - `LiveTrackingTab` (line ~112): `marketCode` now uses the KSA→TADAWUL remap instead of
     the literal `market === 'CRYPTO' ? 'CRYPTO' : 'EGX'` that silently downgraded every
     non-EGX/non-CRYPTO market to EGX.
   - `TomorrowPredictionsPanel` (line ~251): same remap applied (same bug pattern in an
     unused sub-component, fixed defensively).

2. **`src/modules/predictions/components/maker-radar/MakerRadarTab.tsx`**
   - Imported `MARKET_CODES` from `@/lib/store` (was only importing `useAppStore`).
   - `<IncubatorSection market=…>` (line ~425) now passes the real market code instead of
     `'TADAWUL' || 'EGX'` ternary that downgraded KSE/QSE/US/CRYPTO to EGX.

3. **`src/modules/market-analysis/components/MarketStatusTab.tsx`**
   - `fetchData` (line ~256): `marketCode` now uses the same KSA→TADAWUL remap already
     present in `fetchMarketStatus` (line 235). Fixes `/api/stocks?market=KSA` →
     `/api/stocks?market=TADAWUL` for Saudi.

4. **`src/modules/market-analysis/components/MarketAnalysisView.tsx`**
   - Top-level `marketCode` (line 102) now uses the remap. Cascades to all 3 fetches
     (`/api/stocks`, `/api/unified/predictions`, `/api/stored-analysis/results`) AND to
     the cache key (`setMarket(marketCode)` + `cache.market === marketCode`).

5. **`src/modules/market-analysis/components/ExpertPredictionsTab.tsx`**
   - `fetchPredictions` (lines 156 + 167): `marketCode` now uses the remap.
   - `useEffect` cache check (line 188): same remap so cache hit behavior is preserved
     (was 'KSA' vs `cache.market = 'TADAWUL'` mismatch after P1.4 fix).

6. **`src/components/market/MarketStatusExport.tsx`**
   - `fetchData` (line ~63): extracted `marketCode` once and applied the remap. The
     `/api/stocks?market=…` call now sends `TADAWUL` for Saudi.

### Priority 2 — Missing market param

7. **`src/modules/dashboard/components/PriorityNotificationsWidget.tsx`**
   - Appended `&market=${encodeURIComponent(currentMarket)}` to the
     `/api/notifications/priority` URL.
   - Verified `GET /api/notifications` already filters by market (lines 235-248 of
     `src/app/api/notifications/route.ts`) using bound params — no backend changes
     needed (per the "do NOT touch `src/app/api/`" rule).

8. **`src/modules/predictions/components/DualTrackPredictionsView.tsx`**
   - `fetchStats` GET (line ~169): appended `?market=…`.
   - `onRecalcThreshold` POST (line ~215): added `market` to JSON body.
   - `onRunBacktest` POST (line ~227): appended `&market=…` to URL.

9. **`src/modules/predictions/components/prediction-dashboard/PredictionTrackingDashboard.tsx`**
   - `handleVerifyPending` POST body now includes `market` alongside `limit:500`.
   - Added `market` to the `useCallback` deps array.

10. **`src/components/watchlist/EnhancedWatchlistView.tsx`**
    - Stock-search dialog (line ~142): appended `&market=${encodeURIComponent(currentMarket)}`
      to `/api/stocks?query=…`.

11. **`src/modules/market-analysis/components/UnifiedAnalysisView.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Added `const currentMarket = useAppStore((s) => s.currentMarket)`.
    - `selectedMarket` state now initializes from `currentMarket` (was hardcoded `'EGX'`)
      so the analyze/scan/compare POSTs inherit the global market on first render. The
      existing `market: selectedMarket` body fields now correctly default to the global
      market while still letting the user override via the local selector.

12. **`src/components/shared/ExpertIntelligencePanel.tsx`**
    - `fetchSectorIntel` (line ~194): appended `&market=…`.
    - `fetchConsensusList` (line ~208): appended `&market=…`.
    - `fetchSingleConsensus` (line ~225): appended `&market=…`.
    - Added `marketCode` to each `useCallback` deps array.

### Priority 3 — EGX-only widgets gated

13. **`src/modules/dashboard/components/InvestorsFlowPanel.tsx`**
    - **Left alone** — parent (`src/app/page.tsx` line 778 `isEGX` ternary, plus
      `DashboardView.tsx` line 240 `visible: () => currentMarket === 'EGX'`) already gates
      it. Per task instructions: "if the parent already gates it, leave it alone."

14. **`src/modules/dashboard/components/SeasonalitySignalsWidget.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Added early-return `if (currentMarket !== 'EGX') return null;` before the
      `useApiQuery('/api/seasonality-signals')` call.

15. **`src/components/seasonality/SeasonalityDashboard.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Added early-return AFTER all hook calls (Rules of Hooks compliance) rendering a
      small Arabic "بيانات الموسمية متاحة لسوق EGX فقط" placeholder for non-EGX.

16. **`src/components/shared/IntradayPulseBar.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - `fetchPulse` early-returns when `currentMarket !== 'EGX'`.
    - Component early-returns `null` for non-EGX (after hook calls).
    - Added `currentMarket` to deps array.

17. **`src/components/shared/LiquidityRadarView.tsx`** (local `IntradayPulseBar`)
    - Local `IntradayPulseBar` function now reads `market` from the store.
    - `fetchPulse` early-returns when `market !== 'EGX'`.
    - Component early-returns `null` for non-EGX.
    - Rest of the view (radar / sectors tabs) unaffected.

### Priority 4 — News feed market filter

18. **`src/modules/news/components/NewsFeedView.tsx`**
    - Added `const currentMarket = useAppStore((s) => s.currentMarket)`.
    - Appended `?market=${encodeURIComponent(currentMarket)}` to `/api/news-feed`.
    - Added `currentMarket` to `fetchNews` useCallback deps.
    - No POST exists in this file — only the GET fetch.

### Priority 5 — Per-ticker fetches missing market

19. **`src/modules/stock-analysis/components/StockDetail.tsx`**
    - Hoisted `const mkt = encodeURIComponent(currentMarket);` to the top of the main
      `StockDetail` component so all per-ticker fetches share it.
    - `FlowScoreCard` sub-component (lines ~518, 521): added `useAppStore` +
      appended `?market=${mkt}` to `/api/flow/${ticker}` and `/api/explosive/${ticker}`.
    - `FundamentalsCard` sub-component (line ~573): same pattern for `/api/stock-profile/${ticker}`.
    - Main component (line ~1082): appended `&market=${mkt}` to
      `/api/stock-screener/analyze?ticker=…`.
    - Main component (line ~1107): appended `?market=${mkt}` to
      `/api/flow/${encodeURIComponent(selectedTicker)}`.
    - Updated all relevant `useCallback`/`useEffect` deps arrays to include
      `currentMarket`/`mkt`.

20. **`src/modules/stock-analysis/components/stock-detail/cards.tsx`** and
    **`sub-components.tsx`** — dead/orphaned duplicates of the StockDetail sub-components
    (no imports anywhere in the codebase). Fixed defensively so a future revival doesn't
    reintroduce the bug:
    - Added `import { useState, useEffect } from 'react'` + `import { useAppStore }`.
    - Same `FlowScoreCard` / `FundamentalsCard` fixes as StockDetail.tsx.

21. **`src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx`**
    - Unified fetch (line ~243): appended `?market=${encodeURIComponent(market)}` (the
      component already receives a `market` prop with default `'EGX'`).
    - Added `market` to the useEffect deps array.

22. **`src/modules/stock-analysis/components/TradingViewChart.tsx`** +
    **`trading-view-chart/overlay-config.ts`** (parallel implementations)
    - History fallback fetch (line ~742 / ~142): appended
      `&market=${encodeURIComponent(currentMarket)}` (uses `&` because there's already a
      `?days=`).
    - Added `currentMarket` to the useEffect deps array.

23. **`src/modules/stock-analysis/components/ExpertAnalysisPanel.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Appended `?market=${encodeURIComponent(currentMarket)}` to
      `/api/stocks/${ticker}/expert-analysis`.
    - Added `currentMarket` to deps.

24. **`src/modules/stock-analysis/components/DeltaVolumeBar.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Appended `&market=${encodeURIComponent(currentMarket)}` to
      `/api/stocks/delta-volume?ticker=…` (uses `&` because there's already `?ticker=…&days=14`).
    - Added `currentMarket` to deps.

25. **`src/modules/market-analysis/components/TradingChartView.tsx`**
    - Unified fetch (line ~540): appended `?market=${encodeURIComponent(currentMarket)}`
      to `/api/stocks/${tk}/unified`.
    - Added `currentMarket` to `fetchData` useCallback deps.

26. **`src/modules/market-analysis/components/single-stock/SingleStockAnalysisView.tsx`**
    - Unified fetch (line ~122): appended `?market=${encodeURIComponent(currentMarket)}`.
    - Added `currentMarket` to `fetchData` useCallback deps.

27. **`src/modules/stock-analysis/components/GateAnalysisView.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Hoisted `const mkt = encodeURIComponent(currentMarket)` to the top of the
      `fetchAndAnalyze` useCallback.
    - Two fetches (lines ~66, 67): appended `?market=${mkt}` to both
      `/api/stocks/${ticker}/unified` and `/api/python/v2/cached-analysis/${ticker}`.
    - Added `currentMarket` to deps.

28. **`src/modules/stock-analysis/components/StockAdvancedAnalysisView.tsx`**
    - Added `import { useAppStore } from '@/lib/store'`.
    - Three fetches (lines ~285, 324, 333): appended `&market=…` to all (uses `&`
      because all three already have `?`).
    - Added `currentMarket` to the useEffect deps array.

---

## Lint result

```
$ bun run lint
$ eslint .
EXIT_CODE: 0
```

✅ **PASS** — zero errors, zero warnings related to the changes.

---

## Dev server status

- Dev server (`bun run dev`) was already running on port 3000; was NOT restarted.
- `GET / 200` (compile: 25.3s, render: 566ms).
- No new errors or warnings in `dev.log` after the changes (only pre-existing i18n
  missing-key warnings, unrelated to this task).

---

## Files I couldn't fix and why

None — all 23 priorities (P1-P5) were applied successfully.

---

## Follow-up items discovered

1. **`stock-detail/cards.tsx` and `sub-components.tsx` are dead/orphaned files** — they
   are exact duplicates of code in `StockDetail.tsx` and are not imported anywhere in the
   codebase. They may have been left over from an incomplete Phase 3 refactor. Consider
   deleting them in a future cleanup pass. (I fixed them defensively per task
   instructions, but they don't actually run.)

2. **`/api/notifications/priority` route doesn't exist** — `PriorityNotificationsWidget`
   fetches this endpoint, but it 404s. The widget already treats 404 as "endpoint not
   ready" (per its catch block). The `&market=` we added is future-proofing for when
   the endpoint is implemented. (Out of scope — backend agent's job.)

3. **The `/api/notifications` GET route at `src/app/api/notifications/route.ts` already
   applies the market filter correctly** (lines 235-248, bound params, with
   `sqlMarketVariants` pattern via the `marketTickers` lookup). The audit's claim about
   "line 192 has no filter" was inaccurate — line 192 is part of the inner
   market-tickers lookup subquery, which IS already filtered by `UPPER(market) = ?`.
   No backend changes were needed (and per task rules, no API changes were allowed).

4. **Cache key consistency**: For files where I changed `marketCode` from `'KSA'` to
   `'TADAWUL'` (MarketAnalysisView, ExpertPredictionsTab, MarketStatusTab), the
   `cache.market` value stored in `useAnalysisStore` will now be `'TADAWUL'` instead of
   `'KSA'`. This is consistent across all 3 files (they all use the same remap), so
   cross-component cache hits/misses still behave correctly. Verified no other
   consumers of `cache.market` exist that depend on the `'KSA'` string.

5. **`UnifiedAnalysisView.tsx` audit was inaccurate** — the audit claimed "five fetches,
   none carry market", but the 3 POSTs to `/api/unified` already passed
   `market: selectedMarket` in the body. The actual bug was that `selectedMarket`
   defaulted to `'EGX'` regardless of the global `currentMarket`. Fixed by initializing
   `selectedMarket` from `currentMarket` (preserves the local selector behavior while
   defaulting to the global market).

6. **`StockAdvancedAnalysisView.tsx` uses `?XTransformPort=8010`** — a Python mini-service
   port routing convention via Caddy gateway. Appending `&market=…` after the
   `?XTransformPort=…` query preserves the gateway routing.

---

## Out-of-scope items deliberately NOT touched

- `prisma/schema.prisma` — untouched per task rules.
- All files under `src/app/api/` — untouched per task rules (other agent's job).
- Dev server process — untouched per task rules.
- The `/api/notifications/route.ts` market-filter check was performed read-only to
  verify no backend change was needed; the file was NOT modified.
