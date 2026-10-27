# Strategy Optimization Results

Generated: 2026-10-24T00:58:10.327405

## Parameters

| Parameter | Values |
|---|---|
| vol_mult | [1.0, 1.2, 1.5, 1.8, 2.0] |
| momentum_pct | [2, 3, 5, 7, 10] |
| target_pct | [6, 8, 10, 12, 15] |
| stop_pct | [3, 4, 5, 6, 7] |
| holding_days | [5, 10, 15, 20, 30] |

## Train/Test Split

- TRAIN: 2025-10-01 → 2026-03-31
- TEST: 2026-04-01 → 2026-06-10

## Acceptance Criteria

- Min trades: 30
- Min Profit Factor: 1.3
- Min Win Rate: 35.0%

## Results

- Total combinations tested: 3125
- Accepted (pass filters): 10
- Passed out-of-sample: 0

## Top 10 Strategies

| # | vol_mult | mom% | tgt% | stp% | hold | TRAIN trades | TRAIN WR% | TRAIN PF | TEST trades | TEST WR% | TEST PF | Passed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.2 | 2 | 10 | 7 | 30 | 3420 | 39.8 | 1.03 | 1517 | 25.6 | 0.89 | ❌ |
| 2 | 1.2 | 2 | 6 | 7 | 30 | 3420 | 54.0 | 1.02 | 1517 | 41.1 | 0.94 | ❌ |
| 3 | 1.2 | 2 | 6 | 7 | 20 | 3420 | 52.7 | 1.02 | 1517 | 40.1 | 0.94 | ❌ |
| 4 | 1.2 | 2 | 12 | 7 | 30 | 3420 | 33.8 | 1.03 | 1517 | 22.3 | 0.94 | ❌ |
| 5 | 1.2 | 7 | 12 | 4 | 30 | 1194 | 25.1 | 1.06 | 728 | 14.8 | 0.92 | ❌ |
| 6 | 1.2 | 2 | 8 | 7 | 20 | 3420 | 43.2 | 1.02 | 1517 | 31.6 | 0.94 | ❌ |
| 7 | 1.2 | 7 | 12 | 3 | 30 | 1194 | 20.4 | 1.07 | 728 | 12.4 | 0.93 | ❌ |
| 8 | 1.2 | 2 | 8 | 7 | 15 | 3420 | 39.6 | 1.02 | 1517 | 29.2 | 0.94 | ❌ |
| 9 | 1.2 | 2 | 15 | 7 | 30 | 3420 | 25.9 | 1.03 | 1517 | 16.7 | 0.95 | ❌ |
| 10 | 1.2 | 3 | 10 | 7 | 30 | 2904 | 39.5 | 1.02 | 1327 | 24.9 | 0.88 | ❌ |

## ⚠️ No strategy passed out-of-sample validation

