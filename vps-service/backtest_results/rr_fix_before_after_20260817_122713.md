# R:R-FIX Before/After Simulation Report

**Archive:** `active_databases_20260817_full.zip`
**Timestamp:** 20260817_122713
**Methodology:** before=archive actual_return | after=re-simulated with dynamic R:R + ATR clamp

## Settings Used

| Setting | Value |
|---|---|
| dynamic_rr_normal | 1.5 |
| dynamic_rr_outperform | 2.0 |
| atr_stop_min_pct | 3.0 |
| atr_stop_max_pct | 9.0 |
| hard_cap | 50.0 |
| max_holding_days | 30 |
| benchmark_ticker | EGX30ETF |
| roc_window | 14 |

## Data Inventory

| Metric | Value |
|---|---|
| closed_trades_in_archive | 148 |
| simulated | 148 |
| skipped | 0 |
| date_range | 2026-01-01 → 2026-05-28 |
| benchmark_dates | 351 |

## BEFORE vs AFTER Metrics

| Metric | BEFORE (archive) | AFTER (fix) | Δ |
|---|---:|---:|---:|
| n | 148 | 148 | 0 |
| win_rate | 52.7 | 34.46 | -18.24 |
| profit_factor | 1.513 | 1.05 | -0.463 |
| avg_win | 8.304 | 11.968 | 3.664 |
| avg_loss | -6.117 | -5.993 | 0.124 |
| avg_return | 1.483 | 0.196 | -1.287 |
| expectancy | 1.483 | 0.196 | -1.287 |
| total_return | 219.56 | 29.03 | -190.53 |
| max_gain | 50.0 | 16.36 | -33.64 |
| max_loss | -7.59 | -7.59 | 0.0 |

## R:R Distribution

| Bucket | BEFORE | AFTER |
|---|---:|---:|
| R:R=1.5 | 148 | 7 |
| R:R=2.0 | 0 | 141 |
| R:R=other | 0 | 0 |

## Outperforming vs Normal (AFTER)

- **Outperforming (R:R=2.0):** 141 trades (95.27%)
  - WR=34.75% | PF=1.078 | AvgWin=+12.084% | AvgLoss=-5.973% | Exp=0.302%
- **Normal (R:R=1.5):** 7 trades
  - WR=28.57% | PF=0.573 | AvgWin=+9.13% | AvgLoss=-6.368% | Exp=-1.94%

## Monthly Breakdown

| Month | N | BEFORE Avg | AFTER Avg | BEFORE Total | AFTER Total |
|---|---:|---:|---:|---:|---:|
| 2026-01 | 27 | 1.943% | 1.712% | 52.46% | 46.22% |
| 2026-02 | 25 | -0.581% | -2.26% | -14.52% | -56.49% |
| 2026-03 | 31 | 0.31% | -0.542% | 9.61% | -16.81% |
| 2026-04 | 39 | -0.154% | -1.176% | -6.0% | -45.86% |
| 2026-05 | 26 | 6.867% | 3.922% | 178.55% | 101.97% |

## Sample Trades (first 20)

| Ticker | Date | Outperf | Stock ROC | Bench ROC | R:R Before | R:R After | Ret Before | Ret After | Exit |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1302 | 2026-01-01 | ✅ | 7.36% | 2.04% | 1.5 | 2.0 | -6.57% | -6.57% | stop_loss |
| 1321 | 2026-01-01 | ✅ | 3.92% | 2.04% | 1.5 | 2.0 | 6.7% | 10.16% | target_hit |
| 2190 | 2026-01-01 | ✅ | 10.95% | 2.04% | 1.5 | 2.0 | 6.72% | 10.06% | target_hit |
| 1120 | 2026-01-06 | ✅ | 11.91% | -6.22% | 1.5 | 2.0 | 9.44% | 14.21% | target_hit |
| 1302 | 2026-01-06 | ✅ | 11.12% | -6.22% | 1.5 | 2.0 | -5.99% | -5.99% | stop_loss |
| 2190 | 2026-01-06 | ✅ | 12.99% | -6.22% | 1.5 | 2.0 | 6.99% | -5.43% | stop_loss |
| 1030 | 2026-01-11 | ✅ | 3.06% | -11.09% | 1.5 | 2.0 | 8.7% | 13.24% | target_hit |
| 1120 | 2026-01-11 | ✅ | 9.47% | -11.09% | 1.5 | 2.0 | 8.84% | 13.14% | target_hit |
| 1321 | 2026-01-11 | ✅ | 7.06% | -11.09% | 1.5 | 2.0 | 3.95% | -4.92% | stop_loss |
| 1321 | 2026-01-14 | ✅ | 8.33% | -16.04% | 1.5 | 2.0 | -5.66% | -5.66% | stop_loss |
| 1323 | 2026-01-14 | ✅ | 4.8% | -16.04% | 1.5 | 2.0 | -6.09% | -6.09% | stop_loss |
| 2190 | 2026-01-14 | ✅ | 4.02% | -16.04% | 1.5 | 2.0 | 3.19% | 10.54% | target_hit |
| 1030 | 2026-01-19 | ✅ | 12.73% | -16.01% | 1.5 | 2.0 | 9.6% | 14.3% | target_hit |
| 1120 | 2026-01-19 | ✅ | 18.52% | -16.01% | 1.5 | 2.0 | -6.07% | -6.07% | stop_loss |
| 1302 | 2026-01-19 | ✅ | -13.18% | -16.01% | 1.5 | 2.0 | 4.51% | -5.86% | stop_loss |
| 1321 | 2026-01-19 | ✅ | 11.92% | -16.01% | 1.5 | 2.0 | -5.04% | -5.04% | stop_loss |
| 1323 | 2026-01-19 | ✅ | -5.71% | -16.01% | 1.5 | 2.0 | 9.33% | 14.42% | target_hit |
| 1030 | 2026-01-22 | ✅ | 6.46% | -15.13% | 1.5 | 2.0 | 7.99% | 12.39% | target_hit |
| 1120 | 2026-01-22 | ✅ | 16.67% | -15.13% | 1.5 | 2.0 | 3.71% | -6.31% | stop_loss |
| 1302 | 2026-01-22 | ✅ | -3.64% | -15.13% | 1.5 | 2.0 | -5.7% | -5.7% | stop_loss |

## Methodology Notes

- **BEFORE:** archive `actual_return` (from original V40.2 simulation, all R:R=1.5)
- **AFTER:** re-simulated with dynamic R:R (1.5 normal / 2.0 outperforming) + ATR stop clamp [3%, 9%]
- **outperforming_market:** stock 14-day ROC > EGX30ETF 14-day ROC on entry date
- **Re-simulation:** scan forward prices; stop checked before target on same day (conservative)
- **HARD cap:** ABS(return) <= 50% applied to all metrics (CONSTITUTION Rule 7)
- **Holding period:** max 30 trading days; time_exit uses close at day 30
- **Equal-weight:** 100% per trade notional (no position sizing)
