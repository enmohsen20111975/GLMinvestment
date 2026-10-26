# BACKTEST METHODOLOGY
> **Task:** BRAVO MISSION CRITICAL — Phase 3
> **Date:** 2026-10-26

---

## 1. Window
- **Start:** 2026-06-25
- **End:** 2026-10-25
- **Duration:** ~4 months (17 weeks)
- **Market tested:** EGX (primary)
- **Markets BLOCKED:** US (EGX collisions), CRYPTO (intraday schema)

## 2. Look-Ahead Bias Prevention
- **Signal generation:** at time T, only prices with `date <= T` are passed to `MasterAnalyzer.analyze()`
- **Entry price:** last close at signal date (conservative — no future open used)
- **Exit:** future 7 sessions checked for stop/target, but these are POST-signal (outcome, not input)
- **No future data** in regime detection, indicator calculation, or engine selection

## 3. Trading Model
| Parameter | Value |
|---|---|
| Entry | Close at signal date |
| Stop loss | from risk_profile (default 5% below entry) |
| Target | from risk_profile (default 10% above entry) |
| Holding period | max 7 sessions |
| Commission | 0.1% per trade (buy + sell = 0.2%) |
| Slippage | 0.05% per trade (buy + sell = 0.1%) |
| Position size | 5% of capital |
| Initial capital | 10,000 EGP |

## 4. Exit Rules
1. Stop loss hit (low ≤ stop) → exit at stop price
2. Target hit (high ≥ target) → exit at target price
3. Holding expired (7 sessions) → exit at close
4. If both hit same session → conservative: stop loss first

## 5. Cost Calculation
```
gross_return = (exit_price - entry) / entry * 100
costs = commission_pct * 2 + slippage_pct * 2  (0.3% total)
net_return = gross_return - costs
pnl = position_value * (net_return / 100)
```

## 6. Limitations
1. **Sample size:** 20 tickers × 4 months = limited sample
2. **Entry assumption:** entry at close (not next-day open) — slightly optimistic
3. **No partial fills:** assumes full position executed
4. **No gap handling:** if price gaps below stop, exit at stop (not actual gap price)
5. **No concurrent positions limit:** unlimited simultaneous trades
6. **Risk gate NOT connected:** backtest uses raw signals (risk gate not in production path)
7. **Orchestrator/Executor NOT implemented:** backtest calls MasterAnalyzer directly (monolithic path)
8. **US market BLOCKED:** US tickers in DB are EGX collisions, not real US stocks
9. **CRYPTO BLOCKED:** intraday data schema, not daily OHLCV

## 7. Reproducibility
- **Code version:** `9c68237`
- **DB snapshot:** price_history.db (post-cleanup, 2026-10-26)
- **Command:** `python3 scripts/run_historical_backtest.py`
- **Output:** `backtest_results/trade_ledger.csv` + `market_summary.csv` + `weekly_results/`
