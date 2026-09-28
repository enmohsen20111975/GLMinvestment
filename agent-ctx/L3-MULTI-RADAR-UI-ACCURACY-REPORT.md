# L3-MULTI-RADAR-UI-ACCURACY — Report

**Task ID:** L3-MULTI-RADAR-UI-ACCURACY
**Agent:** Full-stack Engineer (multi-market UI + accuracy score)
**Date:** 2026-09-28

## Summary

Built (1) the **Unified Multi-Market Radar UI** that shows all 7 markets (EGX + TADAWUL + KSE + QSE + US + CRYPTO + GOLD) in one panel, and (2) the **Historical Accuracy Score** dashboard that shows the win rate of radar signals by type, market, and monthly trend. Both tabs are wired into `MarketAnalysisView.tsx` as new tab triggers (`multi-market-radar` and `radar-accuracy`).

## New Components Created

### 1. `src/components/predictions/radar/MultiMarketRadarTab.tsx`
Unified multi-market radar UI:
- **Header card** with green gradient + Globe icon + market count + open count + last-updated time + refresh button.
- **Market toggle row** — 7 badge-style toggles (🇪🇬 EGX, 🇸🇦 TADAWUL, 🇰🇼 KSE, 🇶🇦 QSE, 🇺🇸 US, ₿ CRYPTO, 🥇 GOLD). Defaults to all 7 selected; can deselect but never empties (minimum 1).
- **Market summary cards** (grid 1/2/3/4 cols) — one per selected market showing:
  - Flag + market code + Arabic name
  - LIVE / مقفول badge
  - 3 mini-stats: stock count, top picks count, currency
  - Regime badge (DEFENSIVE / NORMAL / AGGRESSIVE / صاعد / هابط / عرضي) with color
  - Cache age + warming_up indicator
- **Unified Top 5 table** — best 5 picks across all selected markets (from `unified_top_5` in API). Shows market flag + ticker + path label + entry → target + change %.
- **Collapsible per-market detail sections** — expand to see the full top picks table for that market.
- **Footer** with auto-refresh info (every 60s).
- API: `GET /api/maker-radar/multi-market?markets=EGX,TADAWUL,KSE,QSE,US,CRYPTO,GOLD`
- 60s auto-polling via `setInterval`.

### 2. `src/components/predictions/radar/AccuracyDashboard.tsx`
Historical accuracy score UI:
- **Header card** with overall stats:
  - 4 stat boxes: Total Signals, Verified (+ pending), Win Rate %, Wins/Losses count
  - Win-rate progress bar (colored: green ≥60%, amber 40-60%, rose <40%)
  - Note banner if no DB available
- **Monthly Trend card** with:
  - Recharts `BarChart` showing win rate per month (color-coded per bar)
  - Monthly summary table (month / total / verified / wins / win rate badge)
- **By Signal Type card** — table of all 5 radar paths + a `general` fallback row:
  - Pre-Surge, تجميع قوي, انفجار حجمي, اختراق مبكر, تجميع ضعيف
  - Columns: total / verified / wins-losses / win rate badge + mini bar / avg 30d outcome / avg time-to-target
- **By Market card** — per-market accuracy with flag + win rate badge + horizontal progress bar
- **Footer** with source + served_at + auto-refresh (every 5 minutes)
- API: `GET /api/radar/accuracy?market={market}&days=90`

## New API Endpoint

### `src/app/api/radar/accuracy/route.ts`
`GET /api/radar/accuracy?market=EGX&days=90`

- **DB discovery**: tries `db/predictions.db` first, falls back to `db/predictions.db.original` (sandbox snapshot), then returns empty stats if neither exists.
- **Source priority**: if `radar_signal_tracking` table exists → uses it; otherwise falls back to `predictions` table (V40.2 outcomes) and classifies rows into radar paths using a heuristic on `signal_type` + `notes` + `explosive_label` columns.
- **Aggregations**:
  - Overall: total_signals, verified, pending, wins, losses, win_rate_pct
  - by_signal_type (5 radar paths + general fallback): total/verified/wins/losses/win_rate_pct/avg_outcome_7d/14d/30d/avg_time_to_target_days
  - by_market: total/verified/wins/win_rate_pct per market
  - monthly_trend: per-month stats sorted ascending
- **Read-only** (Rule 32) — uses better-sqlite3 in readonly mode; never CREATE/INSERT.
- **Color coding** (matches UI): green ≥60%, amber 40-60%, rose <40% (computed client-side).
- Response: `success`, `source` (`predictions_db` / `predictions_db_original` / `none`), `market`, `days`, `total_signals`, `verified`, `pending`, `wins`, `losses`, `win_rate_pct`, `by_signal_type[]`, `by_market[]`, `monthly_trend[]`, `served_at`.

## Tests Added

### `src/__tests__/radar/MultiMarketRadarTab.test.tsx` (9 tests)
1. Renders market toggles for all 7 markets
2. Deselects a market when its toggle is clicked (but never empties)
3. Shows unified top 5 picks with market flags
4. Shows empty state for unified top 5 when no picks
5. Shows regime badges on market summary cards (defensive/normal/aggressive)
6. Expands and collapses per-market detail sections (data-state=open/closed)
7. Shows the per-market top picks when expanded
8. Fetches from `/api/maker-radar/multi-market` with the selected markets
9. Re-fetches when the selected markets change

### `src/__tests__/radar/AccuracyDashboard.test.tsx` (12 tests)
1. Renders overall stats: total signals, verified, win rate
2. Shows pending count as subtitle of verified stat
3. Shows signal type table with all radar paths
4. Shows win/loss counts per signal type
5. Color-codes win rates: green for >60%, amber for 40-60%, rose for <40%
6. Uses rose color for win rate below 40%
7. Overall win rate progress bar uses emerald color for ≥60%
8. Renders monthly trend chart and table
9. Shows empty state for monthly trend when no data
10. Fetches from `/api/radar/accuracy` with market and days params
11. Omits market param when not provided
12. Renders by-market table with flag + win rate

**Total: 21 new tests, all passing.**

## Files Modified

### `src/components/analysis/MarketAnalysisView.tsx`
- Added 2 imports: `MultiMarketRadarTab`, `AccuracyDashboard` + `Globe`, `BarChart3` icons.
- Added 2 new `TabsTrigger` buttons in `TabsList`: `multi-market-radar` ("الرادار الموحّد") and `radar-accuracy` ("دقة الرادار").
- Added 2 new `TabsContent` blocks rendering the new components.
- Updated grid classes from `lg:grid-cols-6` to `lg:grid-cols-6 xl:grid-cols-8` so all 8 tabs fit on wide screens.

### `src/components/shared/MarketSelector.tsx` (verified)
- US market already present (`{ id: 'US', label: '🇺🇸 أمريكا', currency: 'USD' }`) — added by the L3-US-MARKET-BACKEND task. No changes needed.

## Verification

### Lint
```
$ bun run lint
$ eslint .
EXIT=0
```
✅ Exit 0 — no ESLint errors.

### Tests
```
$ bun run test
Test Files  5 passed (5)
Tests       96 passed (96)
EXIT=0
```
✅ All 96 tests pass (75 pre-existing + 21 new).

### API endpoints
```
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
ROOT=200

$ curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/maker-radar/multi-market?markets=EGX,US,CRYPTO"
MULTI=200

$ curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/radar/accuracy?market=EGX"
ACCURACY=200
```

### Multi-market API response shape
```bash
curl "http://localhost:3001/api/maker-radar/multi-market?markets=EGX,US,CRYPTO" | python3 -m json.tool | head
{
  "success": true,
  "markets": {
    "EGX": { "market": "EGX", "name_ar": "البورصة المصرية", "currency": "EGP", "is_open": false, "regime": "sideways", "regime_ar": "عرضي", "market_score": 50, "count": 0, "top_picks": [], "warming_up": true, "cached": false, ... },
    "US": { "market": "US", "name_ar": "البورصة الأمريكية", "currency": "USD", ... },
    "CRYPTO": { "market": "CRYPTO", "name_ar": "سوق العملات الرقمية", "currency": "USD", "is_open": true, ... }
  },
  "unified_top_5": [],
  "served_at": "2026-09-28T07:00:13.603Z",
  "supported_markets": ["CRYPTO","EGX","GOLD","KSE","QSE","TADAWUL","US"]
}
```

### Accuracy API response shape
```bash
curl "http://localhost:3001/api/radar/accuracy?market=EGX&days=180" | python3 -m json.tool | head -20
{
  "success": true,
  "source": "predictions_db_original",
  "market": "EGX",
  "days": 180,
  "total_signals": 651,
  "verified": 643,
  "pending": 8,
  "wins": 322,
  "losses": 321,
  "win_rate_pct": 50.1,
  "by_signal_type": [ ... 6 rows (5 radar paths + general fallback) ... ],
  "by_market": [ { "market": "EGX", "total": 651, "verified": 643, "wins": 322, "win_rate_pct": 50.1 } ],
  "monthly_trend": [ 4 months: 2026-05, 06, 07, 08 ],
  "served_at": "2026-09-28T07:06:02.835Z"
}
```

### Agent Browser verification
- Opened `http://localhost:3001/#recommendations`
- Tab list contains all 8 tabs: متابعة التوقعات, ملخص التوقعات, حالة السوق, التوقعات, تتبع القطاعات, رادار الميكرز, **الرادار الموحّد**, **دقة الرادار**.
- Clicked "الرادار الموحّد" → Multi-Market Radar renders:
  - `data-testid=multi-market-radar` present
  - `data-testid=market-toggles` present
  - All 7 market cards rendered (EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD)
  - All 7 market toggles present with `aria-pressed=true`
  - Headings: "الرادار الموحّد متعدد الأسواق", "ملخص الأسواق", "تفصيل كل سوق"
- Clicked "دقة الرادار" → Accuracy Dashboard renders:
  - `data-testid=accuracy-dashboard` present
  - `data-testid=by-signal-type-card` present (6 signal rows)
  - `data-testid=by-market-card` present (1 market row)
  - `data-testid=monthly-trend-card` present (2 month rows)
  - Body text contains "دقة الرادار التاريخية"
- Screenshots saved to `/tmp/multi-market-radar-tab.png` and `/tmp/accuracy-dashboard-tab.png`.

## Design Notes

1. **Color coding** (consistent across both UIs):
   - 🟢 emerald (≥60%): good signals
   - 🟡 amber (40-60%): warning
   - 🔴 rose (<40%): bad signals

2. **RTL Arabic**: all text in Arabic with `dir="rtl"` on root divs.

3. **Multi-market graceful handling**: the UI handles 7 markets gracefully — even when some markets have `warming_up=true` or `count=0`, the cards still render with the regime badge and warming indicator.

4. **Empty states**: every section has a proper empty-state message (no NaN, no broken layouts) when data is missing.

5. **`radar_signal_tracking` table**: doesn't exist in this sandbox (P0 task wasn't completed). The accuracy endpoint gracefully falls back to the `predictions` table and uses a heuristic classifier (looking at `signal_type`, `notes`, `explosive_label` columns) to bucket rows into the 5 radar paths. When the table is created in a future P0 task, the endpoint will automatically pick it up.

6. **`GOLD` market**: not in `MarketType` union (only EGX, TADAWUL, KSE, QSE, US, CRYPTO are user-selectable in the single-market selector). GOLD is still shown in the multi-market radar as one of the 7 supported markets — it's just not user-selectable for single-market analysis. This is intentional: gold is treated as a commodity overlay, not a stock market.

7. **Polling intervals**:
   - Multi-Market Radar: every 60s (matches task spec)
   - Accuracy Dashboard: every 5 min (accuracy changes slowly — too frequent would waste bandwidth)

## Critical Rules Compliance

1. ✅ **READ before EDIT** — read MarketAnalysisView.tsx (270 lines), MakerRadarTab.tsx (1975 lines), MarketSelector.tsx, multi-market API route, predictions DB schema before editing.
2. ✅ **shadcn/ui components** — Card, CardHeader, CardContent, CardTitle, Badge, Button, Skeleton, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Collapsible, CollapsibleContent, CollapsibleTrigger.
3. ✅ **RTL Arabic** — all visible text in Arabic.
4. ✅ **Multi-market support** — UI handles all 7 markets gracefully.
5. ✅ **Responsive** — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` for cards; `flex-wrap` for toggles; tables have `overflow-x-auto`.
6. ✅ **No mock data** (Rule 27) — all data from real API endpoints.
7. ✅ **Read-only Node** (Rule 32) — accuracy endpoint opens SQLite in readonly mode; never CREATE/INSERT.

## Files Summary

| Path | Action | Lines |
|------|--------|-------|
| `src/components/predictions/radar/MultiMarketRadarTab.tsx` | created | ~510 |
| `src/components/predictions/radar/AccuracyDashboard.tsx` | created | ~620 |
| `src/app/api/radar/accuracy/route.ts` | created | ~430 |
| `src/__tests__/radar/MultiMarketRadarTab.test.tsx` | created | ~270 |
| `src/__tests__/radar/AccuracyDashboard.test.tsx` | created | ~300 |
| `src/components/analysis/MarketAnalysisView.tsx` | modified | +24 lines (2 tabs + 2 contents + 2 imports) |

**Total new code:** ~2,130 lines across 5 new files.

## Next Actions

1. **P0 follow-up**: Create the `radar_signal_tracking` table in `db/predictions.db` (Prisma schema addition) — once done, the accuracy endpoint will automatically start using it.
2. **Radar→Predictions bridge**: When the Python maker_radar.py emits a signal, write a row to `radar_signal_tracking` with `signal_type` = the radar path (`A_pre_surge` / `B_quiet_accumulation_strong` / etc.) so the accuracy dashboard can show real per-path win rates instead of the current heuristic classification.
3. **Multi-market warming**: Currently each market's radar is cached on disk at `scripts/output/maker_radar_*.json`. A future cron job should refresh each market's cache daily so the multi-market UI shows fresh picks (currently shows `warming_up=true` because no Python radar run has happened in sandbox).
4. **GOLD as MarketType**: If GOLD should be user-selectable for single-market analysis, add `'GOLD'` to the `MarketType` union + `MARKET_NAMES_AR` + `MARKET_CODES` + `MARKET_CURRENCY_LABEL` in `src/lib/store.ts` and to `MarketSelector.tsx`.
