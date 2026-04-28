# Task 5 — Gold & Currency API Agent

## Work Summary

Created two API routes that fetch real-time gold prices and currency exchange rates for the Egyptian market using the `z-ai-web-dev-sdk` web search SDK.

## Files Created/Modified

### `src/app/api/market/gold/route.ts`
- **GET /api/market/gold** — Gold price API endpoint
- Uses web search with Arabic queries to find gold prices
- Multi-strategy parsing: snippets → page reading → derived prices
- Supports 24K, 21K, 18K karats + ounce price
- 30-minute cache, mock data fallback

### `src/app/api/market/currency/route.ts`
- **GET /api/market/currency** — Currency exchange rate API endpoint
- Uses web search with Arabic queries to find exchange rates
- Parses buy/sell rates for USD, EUR, GBP, SAR, AED, KWD
- Central bank rate extraction
- 30-minute cache, mock data fallback

## Key Design Decisions
- Arabic numeral → Western numeral conversion for price parsing
- Context-based rate extraction (±200 chars around currency keyword)
- Karat price derivation (21K = 24K × 21/24, 18K = 24K × 18/24)
- Always returns valid response — never 500 errors
- `no_cache=true` query param for cache bypass
