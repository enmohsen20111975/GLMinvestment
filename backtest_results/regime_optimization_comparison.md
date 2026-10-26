# Regime Optimization Comparison (B0-B4)

**Window:** 2026-06-25 to 2026-10-25
**Market:** EGX
**Sample:** 20 tickers
**Executor:** V3 (weighted engine combination)
**Weights:** Owner-approved V1 (Grok matrix)
**Commission:** 0.1% | **Slippage:** 0.05%
**Position size:** 5.0% | **Max holding:** 7 sessions

| Variant | Description | Trades | Wins | Losses | WR | PF | P&L | Return | Avg Win | Avg Loss | Expectancy | Max DD | Max Streak | NO_TRADE | Decisions | Time(s) |
|---------|-------------|--------|------|--------|----|----|-----|--------|---------|---------|------------|--------|------------|----------|-----------|---------|
| B0 | Baseline (master_analyzer direct) | 10 | 2 | 6 | 20% | 0.60 | -54.61 | -0.55% | +8.77% | -4.84% | -2.12% | 1.26% | 3 | 0 | 0 | 85.4 |
| B1 | Regime classification + executor_v3 | 6 | 3 | 2 | 50% | 2.14 | 62.81 | +0.63% | +7.57% | -5.30% | +1.14% | 0.51% | 1 | 791 | 797 | 91.8 |
| B2 | B1 + weights V1 applied | 6 | 3 | 2 | 50% | 2.14 | 62.81 | +0.63% | +7.57% | -5.30% | +1.14% | 0.51% | 1 | 791 | 797 | 80.6 |
| B3 | B2 + conflict resolution | 8 | 2 | 5 | 25% | 0.87 | -12.13 | -0.12% | +9.70% | -4.44% | -0.91% | 1.06% | 4 | 789 | 797 | 50.6 |
| B4 | Full package + decision table | 0 | 0 | 0 | N/A | N/A | 0 | 0% | N/A | N/A | N/A | N/A | 0 | 797 | 797 | 11.7 |
