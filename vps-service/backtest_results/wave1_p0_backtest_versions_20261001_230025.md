# Wave 1 P0 Fix 2 — V40.2 4-config backtest (RETRACTION)

- **Retracted claim:** lost commit `0b4f2f1` — "4 backtest versions, v4 winner PF=1.31"
- **Why retracted:** the commit added only 36 lines of markdown to `worklog.md` describing
  a result that was never produced. NO backtest script existed — the PF=1.31 figure was fabricated.
- **Rule 21 compliance:** V40.2 is the SOLE source of truth. This script runs the canonical
  `V38BacktestEngine` (with `use_v393=True` — the V40.2 institutional_decision_engine path)
  under FOUR DIFFERENT PARAMETER CONFIGS, NOT four competing engines.
- **Sandbox-only (Rule 1):** writes only to `db/price_history.db` + `db/stocks.db` + `db/data_engine.db`.
- **Deterministic:** synthetic price data uses a fixed random seed (20261001) for reproducibility.

## Real PF numbers (replacing the fabricated PF=1.31)

| Config | Buy Thresh | R:R (rr1/rr2) | Hold (d) | Trades | Win% | Gross Profit | Gross Loss | **PF** | MaxDD% | Sharpe |
|---|---|---|---|---|---|---|---|---|---|---|
| v40.2-baseline | 75 | 2.0/3.0 | 7 | 278 | 65.1079 | 211.5197 | 79.4299 | **2.663** | 6.0495 | 6.1803 |
| v40.2-aggressive | 65 | 2.5/3.5 | 10 | 353 | 61.1898 | 312.0632 | 128.0252 | **2.4375** | 13.2854 | 5.7849 |
| v40.2-conservative | 85 | 1.5/2.5 | 5 | 200 | 58.5 | 124.8505 | 56.4714 | **2.2109** | 6.456 | 4.7628 |
| v40.2-balanced | 70 | 2.0/3.0 | 14 | 222 | 63.0631 | 245.0529 | 87.1287 | **2.8125** | 10.8291 | 7.0665 |

## Notes on the data

- 10 synthetic EGX tickers (`TESTA`..`TESTJ`) × ~280 days of synthetic price history
- Deterministic GBM with positive drift (so the engine has uptrends to detect)
- Production data is the owner's responsibility — this script does NOT touch prod

- JSON results: `vps-service/backtest_results/wave1_p0_backtest_versions_20261001_230025.json`
- Generated at: 2026-10-01T23:00:25.632048+00:00