# DATA_LINEAGE.md — Radar Data Source Inventory (D1)
> **Task:** RADAR-CLOSURE-01 / Phase D1 | **Branch:** fix/radar-forensic-minimal

## Price Data Tables

| DB | Table | Rows | Date Range | Ticker Col | Close Col | Market Col | Used By Radar |
|---|---|---|---|---|---|---|---|
| stocks.db | stock_daily_prices | 90,232 | 2025-09-22..2026-10-25 | ticker | close | market (DEFAULT 'US') | YES — radar_accuracy_report.py |
| price_history.db | price_history | 1,402,254 | 2000-11-27..2026-10-25 | ticker | close_price | market | YES — verify_radar_signals.py |
| data_engine.db | historical_data | 197,423 | 2021-06-08..2026-10-22 | symbol | close | market | YES — radar_accuracy_report.py |
| data_engine.db | egksco_price_history | 60,097 | 2025-09-22..2026-10-25 | symbol | close_price | market | YES — verify_radar_signals.py (unified #1) |

## Writers of stock_daily_prices (the contaminated table)

| Writer | Line | INSERT type | Specifies market? | Bug? |
|---|---|---|---|---|
| eodhd_fetcher.py | 195 | INSERT OR REPLACE | NO | ❌ DEFAULT 'US' applies |
| daily_price_updater.py | 165 | INSERT | NO | ❌ DEFAULT 'US' applies |
| price_unification.py | 98 | INSERT OR IGNORE | YES (or 'EGX') | ✅ |
| gap_filler.py | 151 | INSERT OR IGNORE | YES | ✅ |

## Schema Root Cause
```sql
CREATE TABLE stock_daily_prices (
    ... market TEXT DEFAULT 'US',  -- ← BUG: should be 'EGX'
    UNIQUE(ticker, price_date)      -- ← BUG: market NOT in key
);
```

## Consumers (all affected by no-market-filter)
- maker_radar.py (entry_price lookup) — no filter
- verify_radar_signals.py (outcome calc) — no filter (FIXED in C2)
- radar_accuracy_report.py (outcome calc, merges 4 sources) — no filter
- verify/route.ts (TS API) — no filter
- shared_liquidity.py (volume surge) — no filter

## Corporate Action Handling
None found in radar pipeline. POUL/ORHD entry_price not adjusted.
