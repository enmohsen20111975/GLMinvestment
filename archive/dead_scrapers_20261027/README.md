# Dead Scrapers Archive (2026-10-27)

These scrapers were archived because they had **ZERO production callers** and
were superseded by `data_engine/scrapers/tradingview_scanner_live.py` (the
unified TradingView Scanner API engine).

## Archived files

| File | Reason |
|---|---|
| `tradingview_market_movers.py` | ZERO callers. Used Playwright (slow, fragile). Superseded by Scanner API which returns all 9 tabs' fields in one HTTP call. |
| `tradingview_screener_lists.py` | ZERO callers. Used Playwright. Only fetched symbol+name+rank (no fundamentals). Scanner API returns full data. |

## Replacement

`data_engine/scrapers/tradingview_scanner_live.py`:
- 5 markets (egypt, saudi, kuwait, qatar, america)
- 60 API fields → 64 DB columns
- 3.3 seconds total (vs 120s with Playwright)
- No browser, no RAM overhead

## Date

Archived: 2026-10-27
Task ID: SCANNER-LIVE-2
Branch: bravo/scanner-live
