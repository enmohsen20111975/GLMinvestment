# Task ID: UNIFIED-MARKET-VIEW
# Agent: Full-Stack Developer (Subagent)

## Summary
بناء شاشة عرض موحدة للأسواق + تحسين الـ Dashboard + مكون نشر موحّد.

## Previous Agents' Work (Reference)
- `MarketType` + `currentMarket` + `setCurrentMarket` موجودة في `src/lib/store.ts` (line 535+)
- `TopBar.tsx` فيه Market Switcher dropdown (5 أسواق: EGX/TADAWUL/KSE/QSE/CRYPTO)
- `MARKET_NAMES_AR` + `MARKET_CURRENCY_LABEL` موجودة في store
- `InvestorsFlowPanel.tsx` + `MarketDepthPanel.tsx` كانوا موجودين بس مش مربوطين في Dashboard
- `UnifiedHoldingsTable.tsx` موجود في `src/components/portfolio/` — جدول محفظة موحّد
- `mini-sparkline.tsx` موجود في `src/components/ui/` — بيتستخدم في StocksView بالفعل
- `html-to-image` مثبّت في package.json

## My Changes

### 1. InvestorsFlowPanel — market-aware
- Modified `src/components/dashboard/InvestorsFlowPanel.tsx`
- Now reads `currentMarket` from `useAppStore`
- Tries `/api/${market.toLowerCase()}/investors` per market
- Graceful empty state for non-EGX markets (no mock data)
- Shows market badge + currency label dynamically

### 2. DashboardView — wired panels
- Modified `src/components/dashboard/DashboardView.tsx`
- Added new section 3.5 between pulse and predictions
- InvestorsFlowPanel + MarketDepthPanel in a 2-column grid
- Hidden entirely when `currentMarket === 'CRYPTO'`
- MarketDepthPanel uses `selectedTicker` → first loaded stock → market-specific default
  (COMI/EGX، 2222/TADAWUL، MBRK/KSE، QNB/QSE)
- Wrapped in SafeWidget for error isolation

### 3. UnifiedPublishButton — new shared component
- Created `src/components/shared/UnifiedPublishButton.tsx` (348 lines)
- Single dropdown with 6 actions: Telegram + Facebook + WhatsApp + Twitter + Copy + Image
- Props: content + title + image (React ref) + filename + hashtags + url + variant + size
- Uses `withOfficialLinks()` to append official links to shared content
- Uses `html-to-image` for PNG export (pixelRatio=2, white background)
- Uses `sonner` for toast notifications
- Supports `split` mode for separate buttons (publish / copy / image)

### 4. StocksView — fully market-aware
- Modified `src/components/stocks/StocksView.tsx`
- Page title/subtitle adapts to `currentMarket` (crypto vs stocks)
- Sector single-select dropdown uses dynamic `availableSectors` for TADAWUL/KSE/QSE
  (was hardcoded EGX English sectors before — wrong for non-EGX markets)
- Sparkline column verified (already wired in desktop + mobile)
- `loadStocks` passes market param to API → real TADAWUL/KSE/QSE stocks load
- `loadCryptoList` adapts coins into stocks array for CRYPTO market

## Verification
- ✅ `bun run lint` exit 0 after every file change
- ✅ git commit + push after every task (4 commits total)
- ✅ All committed to `https://github.com/enmohsen20111975/GLMinvestment.git` on `main` branch
- ✅ No mock data — all data fetched from real API endpoints
- ✅ TypeScript strict + shadcn/ui + RTL + Arabic

## Commits
1. `db030275` feat(unified-market): make InvestorsFlowPanel market-aware
2. `18476e70` feat(unified-market): wire InvestorsFlowPanel + MarketDepthPanel into Dashboard (Task 1b)
3. `cbecf500` feat(unified-publish): add UnifiedPublishButton shared component (Task 2)
4. `d4152b9c` feat(unified-market): StocksView market-aware page header + dynamic sectors (Task 3)

## Notes for Next Agents
- `UnifiedPublishButton` is ready to use anywhere — just import from `@/components/shared/UnifiedPublishButton`
- For non-EGX markets, the `/api/{market}/investors` endpoint doesn't exist yet — the panel gracefully shows empty state. If you want real data for TADAWUL/KSE/QSE, you'd need to create that endpoint following the pattern in `src/app/api/egx/investors/route.ts`.
- The `MarketDepthPanel` uses `/api/stocks/${ticker}/orderbook` — works for EGX. For TADAWUL/KSE/QSE, it would need market-aware endpoints if data is missing.
