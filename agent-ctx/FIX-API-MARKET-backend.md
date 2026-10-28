# FIX-API-MARKET — Backend Agent Work Record

**Task ID:** FIX-API-MARKET
**Agent:** Backend (TypeScript/Next.js API)
**Scope:** Fix 16 API routes that mishandle the `market` query parameter — either silently downgrading to EGX, hardcoding `WHERE market = 'EGX'`, or accepting `market` without applying it to the SQL query.

## Summary

All 16 fixes applied successfully. ESLint passes with exit code 0 (0 errors). Dev server still runs (port 3000) — no restart required.

## Shared helpers used

`src/lib/market-utils.ts` exports:
- `normalizeMarket(input)` — alias → canonical (`'KSA'` → `'TADAWUL'`, `'NYSE'` → `'US'`, etc.)
- `sqlMarketVariants(canonical)` — list of SQL-stored values to bind (`'TADAWUL'` → `['TADAWUL','KSA','السعودية']`)
- `CanonicalMarket` type — `'EGX'|'TADAWUL'|'KSE'|'QSE'|'US'|'CRYPTO'`

All 16 routes now import `normalizeMarket` + `sqlMarketVariants` (and use bound `?` params — never string-interpolate user input).

## Files modified

### API route files (14)

1. `src/app/api/market/liquidity-flow/route.ts` — FIX #1
   - Dropped `['EGX','TADAWUL','KSE','QSE'].includes(marketParam) ? marketParam : 'EGX'` whitelist (silently dropped US/CRYPTO).
   - Now uses `normalizeMarket(marketParam) || 'EGX'` for canonicalisation.
   - SQL `WHERE market = ?` → `WHERE market IN (?, ?, ?)` with `sqlMarketVariants()` so Arabic aliases (e.g. `'السعودية'`) match.

2. `src/app/api/mobile/dashboard/route.ts` — FIX #2
   - Removed local `MARKET_MAP` constant (was missing US/CRYPTO).
   - Now uses shared `normalizeMarket()` + `sqlMarketVariants()`.
   - Both `stocks` and `predictions` queries use `market IN (?, ?, ?)`.

3. `src/app/api/mobile/recommendations/route.ts` — FIX #3
   - Same pattern as #2 — removed local `MARKET_MAP`, shared helpers applied to stocks + predictions queries.

4. `src/app/api/predictions/backtest-list/route.ts` — FIX #4
   - Whitelist expanded from `['EGX','CRYPTO','ALL']` to support all canonical markets via `normalizeMarket()`.
   - 'ALL' preserved as special value (no market filter).
   - SQL changed from `market = ?` to `market IN (?, ?, ?) OR market IS NULL` using `sqlMarketVariants()`.

5. `src/app/api/unified-stocks/route.ts` — FIX #5
   - Dropped whitelist — now uses `normalizeMarket(marketRaw) || 'EGX'`.
   - 'CRYPTO' and 'GOLD' preserved as special asset-class markers (not stock markets with aliases).
   - Stocks query changed from `market = ?` to `market IN (?, ?, ?)` with `sqlMarketVariants()`.

6. `src/app/api/live-monitor/route.ts` — FIX #6
   - `GET()` signature changed to `GET(req: NextRequest)` (was parameter-less).
   - Reads `?market=` (default EGX), normalises, builds `marketVariants`.
   - Forwards `market` param to Python backend too (forwarded for future use).
   - SQL `WHERE market = 'EGX'` (hardcoded!) → `WHERE market IN (?, ?, ?)` with `sqlMarketVariants()`.

7. `src/app/api/maker-radar/signal-tracker/verify/route.ts` — FIX #7
   - POST handler now reads `market` from JSON body (default EGX).
   - `fetchPricesAfter()` accepts an optional `market: CanonicalMarket = 'EGX'` arg.
   - SQL `AND market = 'EGX'` (hardcoded) → `AND market IN (?, ?, ?)` with `sqlMarketVariants()` (only when the table actually has a `market` column — detected via PRAGMA).
   - Bound params spread conditionally via `...(hasMarketCol ? marketVariants : [])`.

8. `src/app/api/market/morning-bell/route.ts` — FIX #8
   - Reads `?market=` (default EGX) and forwards to Python as `&market=${encodeURIComponent(marketParam)}`.
   - Added comment `// Python endpoint currently EGX-only — param forwarded for future use.`

9. `src/app/api/market/live-data/route.ts` — FIX #9
   - Reads `?market=` (default EGX, normalised).
   - `fetchFromDatabase(limit, offset, market)` signature updated to take the canonical market.
   - SQL `WHERE is_active = 1 AND current_price > 0` → `... AND market IN (?, ?, ?)` with `sqlMarketVariants()`.
   - Cache key changed from hardcoded `'egx-live-data'` to `egx-live-data-${market}` so different markets don't shadow each other.

10. `src/app/api/market/exit-status/route.ts` — FIX #10
    - Reads `?market=` (no default — `undefined` means "no market filter" preserves existing behaviour).
    - Forwards to Python backend as `params.set('market', market)`.
    - Passes through to `getPredictionsFallback(parseInt(limit,10), 'active', market)`.

11. `src/app/api/market/sectors/intelligence/route.ts` — FIX #11
    - Reads `?market=` (default EGX, normalised).
    - SQL `WHERE is_active = 1 AND sector IS NOT NULL ...` → `... AND market IN (?, ?, ?)` with `sqlMarketVariants()`.
    - Response `params.market` echo changed from hardcoded `'EGX'` to the actual canonical market.
    - Updated stale doc comment that said `stocks.db is EGX-only`.

12. `src/app/api/market/report/daily/route.ts` — FIX #12
    - Passes `market` (already read at top) to `getTopMoversFallback(10, market)`.

13. `src/app/api/market/report/weekly/route.ts` — FIX #13
    - Passes `market` to `getTopMoversFallback(20, market)`.

14. `src/app/api/market/recommendations/ai-insights/route.ts` — FIX #14
    - Reads `?market=` (no default) and passes to `getPredictionsFallback(50, 'active', market)`.

15. `src/app/api/news-feed/route.ts` — FIX #15
    - `fetchNewsSignals(limit, market?)` signature updated.
    - Detects `market` column on `market_news` and `news_signals` tables via PRAGMA (defensive — schema varies).
    - When `market` provided AND column exists: SQL adds `AND market IN (?, ?, ?)` with `sqlMarketVariants()`.
    - Cache key changed from `'all'`/`'crypto'` to per-market (e.g. `'TADAWUL'`) so different markets don't shadow each other.

16. `src/app/api/notifications/route.ts` — FIX #16
    - Replaced `String(marketParam).trim().toUpperCase()` with `normalizeMarket(marketParam)`.
    - `stocks` lookup query: `UPPER(market) = ?` → `market IN (?, ?, ?)` with `sqlMarketVariants()`.
    - `user_notifications` filter clause: `UPPER(market) = ?` → `market IN (?, ?, ?)` with `sqlMarketVariants()` (so notifications tagged 'KSA' or 'السعودية' also match a TADAWUL request).
    - Removed unused `normalizedMarket` shim variable (lint clean-up).

### Shared lib file (1)

17. `src/lib/flutter-sqlite-fallback.ts` — supports FIXES #10/#12/#13/#14
    - Imports `normalizeMarket` + `sqlMarketVariants`.
    - `getTopMoversFallback(limit, market?)` — was `UPPER(market) = UPPER(?)` (missed Arabic aliases). Now `market IN (?, ?, ?)` with `sqlMarketVariants()` when `market` is provided.
    - `getPredictionsFallback(limit, status?, market?)` — was `UPPER(market) = ?` with hardcoded EGX special-case. Now uses `sqlMarketVariants()` for ALL canonical markets (incl. TADAWUL→['TADAWUL','KSA','السعودية'], EGX→['EGX','مصر'], etc.). Preserves the EGX-specific `ticker NOT GLOB '[0-9]*'` filter.

## Lint result

- `bun run lint` exit code: **0** (pass)
- Errors: 0
- Warnings: 0 (related to my changes)

## Things I noticed but didn't fix (out of scope)

- **`src/app/api/maker-radar/signal-tracker/verify/route.ts` line 144** has a pre-existing bug: `src.dbPath.split('/').pop()` references a non-existent property `dbPath` (should be `dbFile`). The `.split()` on `undefined` would throw, but the surrounding try/catch swallows the error and the function returns `{prices:[], source:null}`. This means the price-source resolver effectively always returns empty. NOT fixed per task scope ("Don't fix unrelated lint errors / bugs"). Worth follow-up: this likely breaks radar-signal verification entirely.

- **`src/lib/flutter-sqlite-fallback.ts` `getPredictionsFallback`** uses `UPPER(market) IN (?, ?)` with `variants.map(v => v.toUpperCase())`. SQLite `UPPER()` only uppercases ASCII characters, so Arabic aliases like `'السعودية'` won't be uppercased. The bound params are uppercased versions of the variants — `'TADAWUL'.toUpperCase()` = `'TADAWUL'` (matches `UPPER('TADAWUL')` = `'TADAWUL'` ✓), but `'السعودية'.toUpperCase()` = `'السعودية'` (Arabic chars unchanged) and `UPPER('السعودية')` = `'السعودية'` (also unchanged) — so they DO match. No fix needed; documented for clarity.

- **`predictions.db` is still EGX-only** (per agent-ctx `STOCKS-DEDUP-A-1-bravo.md` notes). The non-EGX routes will return empty results rather than wrong data, which is the desired behaviour per Rule 27 (NO-FAKE-DATA).

- **`src/app/api/market/sectors/intelligence/route.ts`** — the audit description mentioned a Python call with hardcoded `market: 'EGX'` at line ~262, but the file doesn't actually have a Python call. The hardcoded 'EGX' was in the response's `params` echo field, and the SQL query had no market filter at all. I applied the spirit of the fix (read market, filter SQL, fix stale doc comment).

- **`marketParam` unused variable in `market/morning-bell/route.ts`** — the variable is actually used in the Python URL, so no issue.

## Verification

- Lint: `bun run lint` → exit 0 (pass)
- Dev server still running on port 3000 (no restart needed)
- All imports use `@/lib/market-utils` path alias
- All SQL filters use bound `?` params (no string interpolation of user input)
- All canonical markets (EGX/TADAWUL/KSE/QSE/US/CRYPTO) now flow through without silent downgrades
- Arabic aliases (`مصر`/`السعودية`/`الكويت`/`قطر`) now match in DB queries via `sqlMarketVariants()`

No frontend files touched. No `prisma/schema.prisma` modifications. No `db:push` run.
