# Task ID: MOBILE-API-FIX
**Agent:** Subagent C (Mobile API Fix)
**Date:** 2026-09-25
**Status:** ✅ COMPLETED

## Problem
17 Flutter mobile app API routes returned HTTP 503 because they proxied to a
Python backend (`http://127.0.0.1:8010`) that is NOT running in the sandbox.
The user reported: "كل الى فية كان شغال الان معظم الوصلات API مش شغالة"
(everything was working, now most API connections are not working).

## Fix Pattern (established by `/api/market/overview/route.ts`)
For each broken route:
1. **Try Python first** — `fetch(targetUrl, { signal: AbortSignal.timeout(5000) })`
   (5 s timeout instead of 30 s, mobile-friendly)
2. **On failure** — fall back to SQLite (better-sqlite3, readonly) and return
   real data with `source: 'sqlite_fallback'` flag
3. Keep `export const dynamic = 'force-dynamic'` + add `export const runtime = 'nodejs'`
4. NO mock data — every number comes from SQLite

## Routes Fixed (18 total — task spec said 17 but mobile/crypto/portfolio was added as #18)
All modified in-place; no new route paths created.

### Public market routes (return 200):
1. `src/app/api/mobile/summary/route.ts` → stocks.db: total/advancing/declining + top gainers/losers
2. `src/app/api/mobile/recommendations/route.ts` → stocks.db summary + predictions.db latest BUY
3. `src/app/api/mobile/dashboard/route.ts` → stocks.db summary + indices + top movers + latest predictions
4. `src/app/api/mobile/market/overview/route.ts` → market_indices + top stocks (mirrors /api/market/overview)
5. `src/app/api/mobile/market/morning-bell/route.ts` → predictions.db `morning_bell=1` LEFT JOIN morning_bell_signals
6. `src/app/api/mobile/market/recommendations/ai-insights/route.ts` → predictions.db aggregate stats (win_rate, by_signal, by_market, by_status)
7. `src/app/api/mobile/predictions/route.ts` → predictions.db latest 50
8. `src/app/api/mobile/predictions/exit-status/route.ts` → predictions.db WHERE status IN ('TARGET_HIT','STOPPED','CLOSED') + action classification
9. `src/app/api/mobile/risk/route.ts` → predictions.db active BUY with entry/stop/target distance + R:R + risk_flag
10. `src/app/api/mobile/reports/route.ts` → stocks.db market report (breadth + sector turnover + indices + top movers)
11. `src/app/api/mobile/seasonality/route.ts` → stock_daily_prices monthly avg returns (per-ticker or market-aggregate)
12. `src/app/api/mobile/crypto/route.ts` → data_engine.db crypto_prices latest snapshot
13. `src/app/api/mobile/crypto/analysis/route.ts` → crypto_prices + computed momentum classification (signal from change_24h/7d)
14. `src/app/api/mobile/ai/recommendations/route.ts` → predictions.db top BUY ranked by master_score DESC

### Auth-required routes (return 401 without token, 200 with):
15. `src/app/api/mobile/portfolio/route.ts` (GET only) → Prisma PortfolioItem enriched with stocks.db current_price + computed P&L
16. `src/app/api/mobile/portfolio/analyze/route.ts` → Prisma holdings + concentration HHI + sector breakdown + risk_level (LOW/MEDIUM/HIGH)
17. `src/app/api/mobile/portfolio/intelligence/route.ts` → Prisma holdings + predictions.db linked signals + bullish/bearish count + avg_risk_reward
18. `src/app/api/mobile/crypto/portfolio/route.ts` → Prisma holdings (asset_type='crypto') + crypto_prices current price enrichment

## Verification

### Lint:
```
$ bun run lint
$ eslint .
exit 0  (no errors, no warnings)
```

### HTTP status codes (all 18 routes via `curl -m 15 -o /dev/null -w "%{http_code}"`):
```
200  /api/mobile/summary
200  /api/mobile/recommendations
200  /api/mobile/dashboard
200  /api/mobile/market/overview
200  /api/mobile/market/morning-bell
200  /api/mobile/market/recommendations/ai-insights
200  /api/mobile/predictions
200  /api/mobile/predictions/exit-status
401  /api/mobile/portfolio                 ← expected (auth)
401  /api/mobile/portfolio/analyze          ← expected (auth)
401  /api/mobile/portfolio/intelligence    ← expected (auth)
200  /api/mobile/risk
200  /api/mobile/reports
200  /api/mobile/seasonality
200  /api/mobile/crypto
200  /api/mobile/crypto/analysis
401  /api/mobile/crypto/portfolio          ← expected (auth)
200  /api/mobile/ai/recommendations
```
14 public routes → 200, 4 auth-required routes → 401. ZERO 503s.

### Real-data sample verification:
- `mobile/summary`: 452 EGX stocks, 146 advancing / 141 declining / 165 unchanged
- `mobile/market/overview`: EGX30 = 10285.60 (-0.25%), 10 top stocks by volume
- `mobile/predictions`: 3 predictions returned with full ticker/signal/entry/target/stop/return
- `mobile/market/recommendations/ai-insights`: total=32, win_rate=28.13%, by_signal STRONG_BUY=20 (35% win), WATCH=12 (16.67% win)
- `mobile/predictions/exit-status`: HOLD=0, TAKE_PROFIT=1, REDUCE=0, EXIT=2
- `mobile/crypto`: 50 cryptos from latest snapshot — BTC $79996 (+1.95%/24h)
- `mobile/crypto/analysis`: 20 coins, market_regime=BULLISH (18 advancing, 2 declining)
- `mobile/seasonality`: 3 months of EGX data — June (win_rate 25.34%), July (22.79%), August (35.46%)
- `mobile/risk`: 20 BUY positions, avg_risk_reward=1.5, avg_risk_percent=8.71%
- `mobile/reports`: 452 stocks, 41 sectors, A/D ratio = 1.04
- `mobile/ai/recommendations`: top by master_score — OCDI score=100, RR=1.5
- `mobile/portfolio` (no auth): 401 "غير مصرح"

## Key Implementation Decisions

1. **Python timeout = 5 s** (not 30 s) — mobile users shouldn't wait 30 s for a fallback.
2. **SQLite opened with `{ readonly: true }`** — never write, avoid locking the Python service's WAL.
3. **Portfolio routes (4 of them) require auth** via `getSessionUserId()` from `@/lib/auth-helper`.
   Without a Bearer token or session cookie → 401 (matches Flutter app expectation).
4. **Crypto signals derived from real change_24h/change_7d** (NOT mock):
   - `change_24h >= 5 && change_7d >= 0` → STRONG_BUY
   - `change_24h >= 2` → BUY
   - `change_24h <= -5` → SELL
   - else → HOLD
5. **Risk levels derived from concentration HHI** (HHI = sum of squared weights × 10000):
   - `max_weight >= 50 || hhi >= 5000` → HIGH
   - `max_weight >= 30 || hhi >= 3000` → MEDIUM
   - else → LOW
6. **Action classification in exit-status** derived from status/hit_target/hit_stop:
   - `STOPPED || hit_stop=1` → EXIT
   - `TARGET_HIT || hit_target=1` → TAKE_PROFIT
   - else → HOLD
7. **Seasonality restricted to EGX** — stock_daily_prices table only has EGX history;
   other markets get an explicit Arabic message rather than empty data.
8. **`force-dynamic` + `runtime = 'nodejs'`** on every route — better-sqlite3 needs the Node runtime.

## Notes for Main Agent
- All 18 routes now use the same pattern as the working `/api/market/overview/route.ts`.
- When the Python backend is restored, the routes will automatically prefer Python again
  (because the fallback only triggers on `!res.ok` or fetch throwing).
- The portfolio GET/POST/DELETE flows continue to use Prisma + auth.db for persistence
  (POST and DELETE were already correct, only GET was broken).
- No new helper files created — every route is self-contained (mirrors the existing
  convention in `/api/market/overview/route.ts`).
