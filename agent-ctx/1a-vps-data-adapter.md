# Task 1a — VPS Data Adapter

**Agent**: Main Agent  
**Task**: Create VPS data adapter module as primary data source for EGX platform

## Work Log

### Step 1: Environment Variable
- Added `EGXPY_SERVICE_URL=http://72.61.137.86:8010` to `/home/z/my-project/.env`

### Step 2: VPS Adapter Module (`src/lib/vps-adapter.ts`)
- Created standalone module with **zero dependencies** on existing codebase
- Defined typed interfaces for all VPS API responses:
  - `VpsBaseResponse<T>` — generic wrapper with `cached` and `source` fields
  - `VpsStockQuote` — individual stock quote (price, OHLC, volume, market cap, ratios)
  - `VpsHistoryPoint` — historical price point (date, OHLCV, adjusted_close)
  - `VpsMarketOverview` — market-wide data (stocks, stats, indices)
  - `VpsPremiumAnalysis` — composite analysis (fundamentals, financials, valuation, dividends, analyst targets, earnings)
  - `VpsFundamentals` — fundamental metrics (market cap, ratios, ROE, debt, EPS, etc.)
  - `VpsFinancials` — financial statements (income, balance sheet, cash flow)
- Implemented 9 exported functions:
  1. `getVpsServiceUrl()` — reads `EGXPY_SERVICE_URL` env var
  2. `isVpsAvailable()` — health check with 3s timeout
  3. `fetchStockQuote(ticker)` — single stock quote, 5s timeout
  4. `fetchStockHistory(ticker, days)` — historical prices, 5s timeout
  5. `fetchBatchQuotes(tickers)` — batch quotes with auto-chunking (25 per request), 10s timeout, 4 concurrent chunks
  6. `fetchMarketOverview(tickers?)` — full market overview, 10s timeout
  7. `fetchPremiumAnalysis(ticker)` — premium analytics, 8s timeout
  8. `fetchFundamentals(ticker)` — fundamentals only, 5s timeout
  9. `fetchFinancials(ticker)` — financials only, 5s timeout
- Added `vpsQuotesToLiveStocks()` convenience converter (VPS format → existing `LiveStock` format)
- Generic `vpsFetch<T>()` internal wrapper with `AbortController` timeouts
- All functions: never throw, return `null` on failure, log errors to console

### Step 3: Updated `sync-live/route.ts`
- Added VPS adapter as **Strategy 1 (primary)** in the fetch chain
- Fetch order: **VPS → Mubasher → Database**
- VPS strategy:
  1. Checks VPS availability via `isVpsAvailable()` (3s health check)
  2. Tries `fetchMarketOverview()` first (most comprehensive)
  3. Falls back to `fetchBatchQuotes()` with all known DB tickers
  4. Converts VPS quotes to `LiveStock` format via `vpsQuotesToLiveStocks()`
- Added `getKnownTickersFromDb()` helper for batch VPS requests
- Added `fetchFromDatabase()` as Strategy 3 (stale data fallback)
- When source is `'database'`, skips DB writes (data already exists)
- Response now includes `source: 'vps' | 'mubasher' | 'database'`
- Preserved 15-minute cache, Mubasher parsing, and all existing DB update logic

### Step 4: Updated `sync-historical/route.ts`
- Added VPS adapter as **Strategy 1** per-stock fetch chain
- Fetch order per stock: **VPS → Mubasher → Database**
- VPS strategy:
  1. Single upfront `isVpsAvailable()` check at route start (logged)
  2. Per stock: parallel fetch of `fetchStockHistory(ticker, 90)` + `fetchStockQuote(ticker)`
  3. Converts VPS history to `ParsedStockPrice[]` and quote to `StockCurrentData`
- Added helper functions:
  - `vpsHistoryToParsedStockPrice()` — converts VPS history points
  - `vpsQuoteToStockCurrentData()` — converts VPS quote to StockCurrentData
  - `fetchFromDatabase()` — reads existing DB price history as last resort
- New `StockSyncResult` fields: `historical_from_vps`, `historical_from_page`, `source_used`
- Summary message now includes source breakdown: `(VPS: X, Mubasher: Y, DB: Z)`
- When source is `'database'`, skips DB writes (data already exists)
- Preserved all Mubasher scraping logic and DB update transactions

## Testing
- ESLint: 0 errors on all 3 new/modified files
- Pre-existing lint errors in `daemon-dev.js` (not related)
- Dev server: compiled successfully, no runtime errors
- No frontend components modified (as required)
