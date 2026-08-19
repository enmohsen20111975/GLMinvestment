# Task 3-B — Market-awareness for SingleStockAnalysisView + TradingChartView + StocksView

**Agent**: full-stack-developer
**Date**: 2026-07-30
**Task ID**: 3-B

## Mission
Make three existing analysis components market-aware so they serve crypto identically to stocks. The store (`src/lib/store.ts`) already supports `'CRYPTO'` in `MarketType`, exports `MARKET_CURRENCY_LABEL`, and has `loadCryptoList()` which adapts coins into the same `Stock[]` shape used by stocks. A new API route `/api/crypto/full-analysis` returns the SAME `FullAnalysisResponse` shape as `/api/v2/chart/full-analysis`.

## Files Modified
1. `src/components/analysis/SingleStockAnalysisView.tsx` (825 → 831 lines)
2. `src/components/analysis/TradingChartView.tsx` (351 lines, net 0)
3. `src/components/stocks/StocksView.tsx` (1886 → 1934 lines)

## Changes Summary

### PART 1 — SingleStockAnalysisView
- Added `currentMarket` to `useAppStore()` destructure (line 191)
- Added `currencyLabel` (`'$'` for crypto, `'ج.م'` for stocks) and `isCrypto` flag (lines 192-193)
- `fetchData` now branches on `isCrypto`:
  - **CRYPTO**: `GET /api/crypto/full-analysis?ticker=X&timeframe=Y&limit=Z&_t=...` (no `user_id`, no `state`)
  - **Stocks**: existing `/api/v2/chart/full-analysis?ticker=X&timeframe=Y&limit=Z&user_id=U&state=S&_t=...`
- Added `isCrypto` to `fetchData` dependency array (line 266)
- Replaced ALL 6 hardcoded `ج.م` JSX occurrences with `{currencyLabel}`:
  - Live price badge (line 363)
  - Trade Plan: entry / TP1 / SL (lines 712, 716, 720)
  - SMC Order Block price (line 749)
  - Fundamental EPS fallback (line 815)
- The existing `FullAnalysisResponse` interface already had `smc_analysis?` and `fusion_metrics?` as optional, so crypto's null values simply cause those panels to be skipped (`{data.smc_analysis && ...}` / `{data.fusion_metrics && ...}`).

### PART 2 — TradingChartView
- Added `currentMarket` to `useAppStore()` destructure (line 40)
- Added `isCrypto` flag and `defaultTicker` constant (lines 41-42): `(initialTicker || (isCrypto ? 'BTC' : 'PHDC')).toUpperCase()`
- Replaced inline `defaultTicker` declarations in both `useState` initializer (line 49) and `handleResetWorkspace` (line 90) with the shared constant
- Telegram publish caption `market:` field now sends `'CRYPTO'` or `'EGX'` based on `isCrypto` (line 125)
- Preset ticker chips now conditional: `['BTC', 'ETH', 'SOL', 'BNB']` for crypto, `['COMI', 'JUFO', 'SWDY', 'MFPC']` for stocks (line 206)

### PART 3 — StocksView
- Added `loadCryptoList` to `useAppStore()` destructure (line 774)
- Added `isCrypto` flag and `currencyLabel` constant (lines 783-784)
- Mount effect branches on `isCrypto`: calls `loadCryptoList()` for crypto, `loadStocks('')` for stocks (lines 813-818). Also resets `stockTab` to `'stocks'` on market change.
- New crypto auto-refresh effect: every 60s, calls `loadCryptoList()` (lines 843-850). EGX 30s refresh unchanged.
- Bonds tab toggle button wrapped in `{isEGX && ...}` (line 1230) — crypto users see only the "العملات الرقمية" / stocks tab.
- Stocks tab label switches to "العملات الرقمية" when `isCrypto` (line 1228)
- `<PresetButtonsRow>` wrapped in `{!isCrypto && ...}` — `/api/stocks/presets` doesn't serve crypto
- Sector filter `<Select>` wrapped in `{!isCrypto && ...}` (line 1378)
- Table header: 6 EGX-only `<TableHead>` cells wrapped in `{!isCrypto && ...}`:
  - القطاع (Sector)
  - شهر % (Month %)
  - حجم الأسبوع (Week volume)
  - القيمة العادلة (Fair value)
  - الفرصة % (Upside %)
  - مكرر الربحية (P/E)
- Table body: matching 6 `<TableCell>` cells wrapped in `{!isCrypto && ...}` (preserves column alignment)
- Price column header now shows currency: `السعر {currencyLabel}` (line 1564)
- Currency label changes:
  - `PRICE_RANGE_OPTIONS` labels: removed `ج.م` suffix (currency-agnostic buckets)
  - `StockCard` "جنيه مصري" → conditional: `stock.market === 'CRYPTO' ? 'دولار' : 'جنيه مصري'` (line 415)
  - `AdvancedFilters` "نطاق السعر (ج.م)" → "نطاق السعر" (currency-agnostic placeholder)
- Mobile view (card layout) left unchanged — shows "—" for null fields, sector chip shows "عملات رقمية" for crypto (acceptable).

## Verification
- `bun run lint`: ✅ 0 errors, 0 warnings
- `dev.log`: Next.js compiles cleanly, GET / returns HTTP 200

## Architectural Notes
- No new dependencies, no API routes touched, no layout/UI redesign
- `SingleStockAnalysisView` is now self-contained market-aware: parent doesn't need to pass market prop
- `TradingChartView` defers to `SingleStockAnalysisView`'s internal market detection — only customizes default ticker, presets, and telegram caption
- `StocksView` is the heaviest change: table column visibility is the main concern, plus data loading branch
- The unused `formatTurnover` function still has `ج.م` literals — left as-is because it's dead code (no callers found via grep). Future callers for crypto would need to handle currency differently.

## Backwards Compatibility
- All existing exports preserved (`SingleStockAnalysisView`, `TradingChartView`, `StocksView`)
- All existing props unchanged (`SingleStockAnalysisViewProps`, `TradingChartViewProps`)
- EGX behavior is identical to before (only added conditionals that default to original behavior)
- Other markets (TADAWUL, KSE, QSE) continue to use stock-style display (not crypto), which is correct
