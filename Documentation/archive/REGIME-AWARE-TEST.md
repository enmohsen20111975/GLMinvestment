# Regime-Aware V38 Test

Generated: 2026-10-24T11:02:06.366329

## Table 1: V38 Performance by Market Regime

| Regime | Signals | WR | PF | Max DD | Avg Return | Sharpe |
|--------|---------|-----|-----|--------|------------|--------|
| Bull | 109 | 49.5% | 1.2 | -69.6% | 0.85% | 0.96 |
| Sideways | 206 | 45.1% | 1.05 | -94.7% | 0.21% | 0.33 |
| Bear | 107 | 39.3% | 0.88 | -92.8% | -0.52% | -0.62 |
| All (baseline) | 422 | 44.8% | 1.04 | -99.2% | 0.19% | 0.43 |

## Table 2: V38 + Regime Filter Comparison

| Config | Signals | WR | PF | Max DD | Avg Return |
|--------|---------|-----|-----|--------|------------|
| V38 baseline (all) | 422 | 44.8% | 1.04 | -99.2% | 0.19% |
| V38 + Bull only | 109 | 49.5% | 1.2 | -69.6% | 0.85% |
| V38 + No Bear | 315 | 46.7% | 1.1 | -93.7% | 0.43% |
