# FOUR-MONTH SUMMARY — EGX Backtest
> **Period:** 2026-06-25 to 2026-10-25
> **Commit:** `9c68237`
> **Command:** `python3 scripts/run_historical_backtest.py`

---

## Overall Results

| Metric | Value |
|---|---|
| Total trades | 10 |
| Wins | 3 |
| Losses | 6 |
| Neutral | 1 |
| Win Rate | 30.0% |
| Total P&L | +0.49 EGP |
| Gross Profit | +145.98 EGP |
| Gross Loss | -146.39 EGP |
| Profit Factor | 1.00 |
| Net Return | +0.00% |
| Avg Win | +9.70% |
| Avg Loss | -4.84% |
| Max Drawdown | 1.28% |
| Initial Capital | 10,000 EGP |
| Final Capital | 10,000.49 EGP |

## Weekly Breakdown

| Week | Trades | Wins | Losses | WR% | P&L (EGP) |
|---|---|---|---|---|---|
| 2026-W37 | 3 | 2 | 0 | 66.7% | +130.21 |
| 2026-W39 | 2 | 0 | 2 | 0.0% | -53.62 |
| 2026-W41 | 1 | 0 | 1 | 0.0% | -26.70 |
| 2026-W42 | 2 | 1 | 1 | 50.0% | -6.86 |
| 2026-W43 | 2 | 0 | 2 | 0.0% | -42.54 |

## Best/Worst Week
- **Best:** W37 (+130.21 EGP, 66.7% WR)
- **Worst:** W39 (-53.62 EGP, 0% WR)

## Interpretation
- **Profit Factor 1.00** = breakeven (profits = losses)
- **30% Win Rate** = low, but avg win (+9.70%) > avg loss (-4.84%) = 2:1 reward:risk
- **Max Drawdown 1.28%** = very low risk (small position sizes)
- **Net Return ~0%** = system is at breakeven after costs

## Market Status Summary
| Market | Status | Reason |
|---|---|---|
| EGX | ✅ TESTED | 4-month backtest completed |
| TADAWUL | ⏳ NOT TESTED | data available but not run (time constraint) |
| KSE | ⏳ NOT TESTED | data available but not run |
| QSE | ⏳ NOT TESTED | data available but not run |
| US | ❌ BLOCKED | US tickers are EGX collisions, not real US stocks |
| CRYPTO | ❌ BLOCKED | intraday schema, not daily OHLCV |

## Key Findings
1. **Orchestrator/Executor NOT implemented** — master_analyzer is monolithic
2. **Risk gate NOT connected** to production decision path
3. **Decision log NOT called** from API path (only from daily_predictor)
4. **System is at breakeven** on EGX after costs (10 trades, PF=1.00)
5. **Small sample** (10 trades) — statistical significance limited

## Recommendation
- **PARTIAL** — specific markets/components blocked
- EGX backtest reproducible, but orchestrator/executor/risk_gate not integrated
- Need owner approval to refactor master_analyzer into orchestrator+executor+risk_gate
