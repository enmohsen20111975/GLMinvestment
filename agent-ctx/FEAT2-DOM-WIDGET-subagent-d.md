# Task ID: FEAT2-DOM-WIDGET
# Agent: Subagent D (Z.ai Code)

## Summary
Rebuilt the missing `MarketDepthLiquidityWidget` (دفتر الأوامر / Market Depth) with real
SQLite data — no mock. Reconstructed a Level-2-style depth view from
`db/intraday.db.stock_intraday` (340K+ rows) since no real `order_book` table exists.

## Files
- **CREATE** `src/app/api/stocks/[ticker]/depth/route.ts` (311 lines)
- **CREATE** `src/components/analysis/MarketDepthLiquidityWidget.tsx` (~340 lines)
- **MODIFY** `src/components/predictions/MakerRadarTab.tsx` (imports + integration in StockDetailDrawer)

## API contract
`GET /api/stocks/[ticker]/depth?levels=5`
Returns: `success, ticker, current_price, bids[], asks[], spread, total_bid_volume,
total_ask_volume, imbalance, interpretation (buy_pressure|sell_pressure|balanced),
source="stock_intraday_aggregated", generated_at`.

## Approach (Liquidity Depth reconstruction)
1. Pull last ~600 ticks from `stock_intraday` (covers latest trading session).
2. Reverse to chronological order; compute `delta_volume = vol[i] - vol[i-1]` because
   `stock_intraday.volume` is cumulative session volume.
3. Handle session resets (when vol drops between consecutive ticks).
4. Bucket size: 0.5% of current_price if > 100 EGP; else 0.25 EGP flat.
5. Buckets above current → asks; buckets below → bids; ticks within ±half-bucket → skipped.
6. Top N each side sorted by proximity; spread = best_ask - best_bid.
7. `imbalance = (bid - ask) / (bid + ask)`. `>0.1` → buy_pressure, `<-0.1` → sell_pressure.
8. Empty state: `success=true, bids=[], asks=[]` + Arabic note.

## Component features
- RTL Arabic, shadcn/ui Card + Badge + Button + Skeleton.
- 2-column DOM grid (asks red / bids green) with proportional volume bars.
- Cyan center band showing current price.
- Stacked liquidity imbalance bar + summary stats (total_bid/spread/total_ask).
- Loading skeleton, empty state, error state with retry button.
- `compact` prop for drawer use.
- Wrapped with `SafeWidget` in MakerRadarTab StockDetailDrawer (after TradingPlanSection).

## Verification
- `curl /api/stocks/COMI/depth?levels=5` → 200 OK with real data:
  current_price=139.28, 4 asks + 1 bid, imbalance=-0.72 → sell_pressure.
- `curl /api/stocks/HRHO/depth` → 200 OK (bucket=0.25 EGP, 5 asks).
- `curl /api/stocks/UNKNOWNXXX/depth` → 200 OK empty state.
- `bun run lint` → 0 errors.
- Page `/` → HTTP 200.

## No mock data
Every number in the response comes from SQLite (intraday.db.stock_intraday + stocks.db.stocks).
Source attribution shown in UI: "stock_intraday (مُجمّع من تداولات اللحظي)".
