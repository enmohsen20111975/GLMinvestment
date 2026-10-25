# 12-Month Experiments — Final Results

Generated: 2026-10-24T13:06:57.893770

## Setup

- Train: 2025-01-01 → 2025-08-31 (8 months)
- Test: 2025-09-01 → 2025-12-31 (4 months — Out-of-Sample)
- Tickers: 250
- Min signals: 30 | Min PF: 1.3 | Min Sharpe: 1.0 | Max DD: 20.0%

## Results

| # | Experiment | Train Sig | Test Sig | Train PF | Test PF | Train WR | Test WR | Stability | Test DD | Test Sharpe | Verdict |
|---|-----------|-----------|----------|----------|---------|----------|---------|-----------|---------|-------------|---------|
| 0 | V38 Baseline | 678 | 482 | 0.63 | 1.15 | 32.9% | 47.1% | 1.83 | -37.8% | 1.47 | REJECT |
| 1 | BullOnly | 193 | 271 | 0.6 | 1.15 | 32.6% | 46.9% | 1.92 | -38.1% | 1.1 | REJECT |
| 2 | RSI 40-70 | 368 | 286 | 0.59 | 1.17 | 31.8% | 47.2% | 1.98 | -30.7% | 1.31 | REJECT |
| 3 | Vol 1.2x | 150 | 83 | 0.74 | 1.21 | 37.3% | 47.0% | 1.64 | -18.6% | 0.85 | REJECT |
| 4 | Bull+RSI | 114 | 168 | 0.67 | 1.27 | 36.0% | 48.8% | 1.9 | -25.7% | 1.53 | REJECT |
| 5 | Bull+Vol | 48 | 42 | 0.73 | 2.13 | 37.5% | 59.5% | 2.92 | -5.2% | 2.41 | KEEP |
| 6 | RSI+Vol | 81 | 50 | 0.74 | 1.1 | 37.0% | 44.0% | 1.49 | -12.7% | 0.31 | REJECT |
| 7 | Bull+RSI+Vol | 30 | 25 | 0.8 | 1.82 | 40.0% | 56.0% | 2.27 | -3.3% | 1.44 | KEEP |

## Reason per experiment

- V38 Baseline: Test PF=1.15 < 1.3
- BullOnly: Test PF=1.15 < 1.3
- RSI 40-70: Test PF=1.17 < 1.3
- Vol 1.2x: Test PF=1.21 < 1.3
- Bull+RSI: Test PF=1.27 < 1.3
- Bull+Vol: Stable: PF=2.13, DD=-5.2%
- RSI+Vol: Test PF=1.1 < 1.3
- Bull+RSI+Vol: Stable: PF=1.82, DD=-3.3%
