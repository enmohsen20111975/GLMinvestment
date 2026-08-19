# R:R-FIX Before/After Simulation Report v2 (Fair Comparison)

**Archive:** `active_databases_20260817_full.zip`
**Timestamp:** 20260817_123125
**Methodology:** before=archive actual_return | after=re-simulated with ORIGINAL simulate_trade() (close-price + partial exits + trailing)

## Data Inventory

| Metric | Value |
|---|---|
| closed_trades | 148 |
| simulated | 148 |
| skipped | 0 |
| outperforming | 141 |
| outperforming_pct | 95.27 |
| atr_clamp_fired | 0 |

## Three-Way Comparison

| Metric | BEFORE (archive) | AFTER-A (dynamic 1.5/2.0) | AFTER-B (fixed 1.5) |
|---|---:|---:|---:|
| n | 148 | 148 | 148 |
| win_rate | 52.7 | 43.24 | 43.24 |
| profit_factor | 1.513 | 1.453 | 1.398 |
| avg_win | 8.304 | 11.437 | 11.002 |
| avg_loss | -6.117 | -5.996 | -5.996 |
| expectancy | 1.483 | 1.543 | 1.354 |
| total_return | 219.56 | 228.29 | 200.45 |
| max_gain | 50.0 | 50.0 | 50.0 |
| max_loss | -7.59 | -7.59 | -7.59 |

## AFTER-A: Outperforming vs Normal Breakdown

- **Outperforming (R:R=2.0):** N=141 | WR=43.97% | PF=1.511 | Exp=1.71%
- **Normal (R:R=1.5):** N=7 | WR=28.57% | PF=0.597 | Exp=-1.835%

## Exit Reasons (AFTER-A)

- hit_stop: 81
- hit_target: 46
- expired: 11
- trailing_stop: 10

## Sample Trades (first 20)

| Ticker | Date | Outperf | R:R | Ret Before | Ret After-A | Ret After-B | Exit A | Exit B |
|---|---|---|---:|---:|---:|---:|---|---|
| 1302 | 2026-01-01 | ✅ | 2.0 | -6.57% | -6.57% | -6.57% | hit_stop | hit_stop |
| 1321 | 2026-01-01 | ✅ | 2.0 | 6.7% | 9.23% | 7.96% | hit_target | hit_target |
| 2190 | 2026-01-01 | ✅ | 2.0 | 6.72% | 4.36% | 7.63% | trailing_stop | hit_target |
| 1120 | 2026-01-06 | ✅ | 2.0 | 9.44% | 9.04% | 11.6% | expired | hit_target |
| 1302 | 2026-01-06 | ✅ | 2.0 | -5.99% | -5.99% | -5.99% | hit_stop | hit_stop |
| 2190 | 2026-01-06 | ✅ | 2.0 | 6.99% | 7.09% | 8.98% | expired | hit_target |
| 1030 | 2026-01-11 | ✅ | 2.0 | 8.7% | 12.46% | 10.8% | hit_target | hit_target |
| 1120 | 2026-01-11 | ✅ | 2.0 | 8.84% | 11.5% | 9.86% | hit_target | hit_target |
| 1321 | 2026-01-11 | ✅ | 2.0 | 3.95% | -4.92% | -4.92% | hit_stop | hit_stop |
| 1321 | 2026-01-14 | ✅ | 2.0 | -5.66% | -5.66% | -5.66% | hit_stop | hit_stop |
| 1323 | 2026-01-14 | ✅ | 2.0 | -6.09% | -6.09% | -6.09% | hit_stop | hit_stop |
| 2190 | 2026-01-14 | ✅ | 2.0 | 3.19% | 9.23% | 7.91% | hit_target | hit_target |
| 1030 | 2026-01-19 | ✅ | 2.0 | 9.6% | 7.52% | 11.25% | trailing_stop | hit_target |
| 1120 | 2026-01-19 | ✅ | 2.0 | -6.07% | -6.07% | -6.07% | hit_stop | hit_stop |
| 1302 | 2026-01-19 | ✅ | 2.0 | 4.51% | 3.62% | 3.62% | expired | expired |
| 1321 | 2026-01-19 | ✅ | 2.0 | -5.04% | -5.04% | -5.04% | hit_stop | hit_stop |
| 1323 | 2026-01-19 | ✅ | 2.0 | 9.33% | 14.16% | 12.35% | hit_target | hit_target |
| 1030 | 2026-01-22 | ✅ | 2.0 | 7.99% | 7.28% | 10.04% | trailing_stop | hit_target |
| 1120 | 2026-01-22 | ✅ | 2.0 | 3.71% | -6.31% | -6.31% | hit_stop | hit_stop |
| 1302 | 2026-01-22 | ✅ | 2.0 | -5.7% | -5.7% | -5.7% | hit_stop | hit_stop |

## Key Findings

1. **BEFORE (archive):** PF=1.513, WR=52.7%, Exp=1.483%/trade
2. **AFTER-A (dynamic R:R 1.5/2.0):** PF=1.453, WR=43.24%, Exp=1.543%/trade
3. **AFTER-B (fixed R:R=1.5 + ATR clamp):** PF=1.398, WR=43.24%, Exp=1.354%/trade
4. **Outperforming ratio:** 95.27% of trades get R:R=2.0 in AFTER-A
5. **ATR clamp fired:** 0 trades had stop outside [3%, 9%]

## Recommendation

⚠️ **AFTER-A (dynamic R:R=2.0 for outperforming) HURTS profitability.**
   - PF dropped from 1.513 to 1.453
   - Reason: 95.27% of trades get R:R=2.0 (too many in bull market)
   - Higher targets are rarely reached → WR drops → PF drops

**Recommended fix:**
1. ✅ Fix key mismatch (unlocks ATR-percentile stops) — DONE
2. ✅ Add R:R >= 1.5 floor gate — DONE
3. ✅ Add ATR stop clamp [3%, 9%] — DONE
4. ⚠️ Set `dynamic_rr_outperform = 1.5` (disable the 2.0 tier) — COUNTERPRODUCTIVE in bull markets
