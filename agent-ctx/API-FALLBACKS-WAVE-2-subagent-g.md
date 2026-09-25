# API-FALLBACKS-WAVE-2 — Subagent G

## Task
Apply the established SQLite-fallback pattern (from `/api/market/overview/route.ts`) to 7 broken API routes that proxy to a Python backend which is NOT running in the sandbox. 8 routes total (one was a catch-all proxy that needed a `v4/stats` interception).

## Pattern Applied
1. `export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';`
2. Try Python first with `AbortSignal.timeout(5000)`
3. On failure (catch OR !res.ok) → fall back to SQLite via better-sqlite3 (readonly)
4. Return JSON with `source: 'sqlite_fallback'`
5. **NO mock data** — every number from SQLite (Rule 27)

## Routes Fixed (9 files modified/created)

| # | Route | File | Before | After | Notes |
|---|-------|------|--------|-------|-------|
| 1 | `/api/screener/advanced` | `src/app/api/screener/advanced/route.ts` | 500 | **200** | was Python subprocess; now stocks.db.stocks with filters: sector, min_volume, min_turnover, min_market_cap, signal, sort, limit |
| 2 | `/api/finance/smart-confluence` | `src/app/api/finance/smart-confluence/route.ts` | 200 (empty) | **200** (real data) | predictions.db.predictions (BUY/STRONG_BUY + ACTIVE), computes confluence_score = master_score + technical_score + risk_reward*10 |
| 3 | `/api/stocks/top-performers` | `src/app/api/stocks/top-performers/route.ts` | 502 | **200** | stocks.db.stocks: top-10 gainers + losers + most active |
| 4 | `/api/predictions/daily-picks` | `src/app/api/predictions/daily-picks/route.ts` (NEW) | 500 (route missing) | **200** | predictions.db.predictions WHERE market=? ORDER BY prediction_date DESC |
| 5 | `/api/predictions/active-management` | `src/app/api/predictions/active-management/route.ts` (NEW) | 500 (route missing) | **200** | predictions.db.predictions (status='ACTIVE') + stocks.db for current_price + computed unrealized_pnl_pct + urgency |
| 6 | `/api/stored-analysis/results` | `src/app/api/stored-analysis/results/route.ts` | 502 | **200** | predictions.db.stored_analyses (schema-aware — PRAGMA table_info introspection) + fallback to predictions table; paywall preserved |
| 7 | `/api/live-monitor` | `src/app/api/live-monitor/route.ts` | 503 | **200** | intraday.db.stock_intraday (latest 50 ticks) + stocks.db (top 30 active) |
| 8a | `/api/python/v4/stats` | `src/app/api/python/[...path]/route.ts` (modified) | 502 | **200** | catch-all intercepts `v4/stats` specifically, delegates to handleV4Stats |
| 8b | `/api/v4/stats` | `src/app/api/v4/stats/route.ts` (NEW) | n/a | **200** | exports `handleV4Stats` shared with catch-all; computes total/wins/losses/win_rate/avg_return/by_persona/top_tickers |

## Verification
- `bun run lint` → EXIT 0 (clean)
- All 9 endpoint URLs return HTTP 200 via `curl -s -m 10 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/<route>`
- Sample data verified real:
  - screener/advanced: ARAB (0.262 EGP, +4.38%, volume 973M)
  - top-performers: gainers[0] = APPC (+20.44%)
  - v4/stats: 35 total predictions, 11 wins, 19 losses, 3 pending, win_rate=36.67%
  - live-monitor: latest tick ZMID 7.51 EGP -0.66% (2026-08-17 14:35:16)

## Files Modified (9 total)
- `src/app/api/screener/advanced/route.ts` (REWRITTEN)
- `src/app/api/finance/smart-confluence/route.ts` (REWRITTEN)
- `src/app/api/stocks/top-performers/route.ts` (REWRITTEN)
- `src/app/api/predictions/daily-picks/route.ts` (NEW)
- `src/app/api/predictions/active-management/route.ts` (NEW)
- `src/app/api/stored-analysis/results/route.ts` (REWRITTEN — schema-aware)
- `src/app/api/live-monitor/route.ts` (REWRITTEN — removed 5s cache so fallback path can recover immediately)
- `src/app/api/v4/stats/route.ts` (NEW — exports shared handleV4Stats)
- `src/app/api/python/[...path]/route.ts` (modified GET handler — other methods/paths untouched)
