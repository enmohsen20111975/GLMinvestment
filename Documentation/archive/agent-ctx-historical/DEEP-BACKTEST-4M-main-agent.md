# Task: DEEP-BACKTEST-4M — Deep Backtest 4 Months Validation

**Agent:** Main Agent (Z.ai Code)
**Started:** 2026-10-05
**Status:** ✅ COMPLETED + COMMITTED + PUSHED (commit `bc2e845`)

## What was built
- `scripts/deep_backtest_4months.py` (605 lines, 0 inline indicator copies)
- Validates that Phase 2 canonical unification (Rule 54) did NOT regress the backtest.

## Canonical modules exercised (all from vps-service/)
- `analyzers/indicators/__init__.py` → `calc_atr`, `calc_rsi`, `sma`, `ema`, `macd`
- `utils/risk_reward.py::compute_risk_reward()` (SELL-aware, fallback=0.0)
- `utils/backtest_stats.py::compute_win_rate() + compute_profit_factor()`
  (Rule 7 HARD cap ±50%, Rule 22 dedup-by-ticker, PF fallback=999.0)

## Real DB data exercised
- `db/predictions.db` → 105 closed predictions (2026-01-01 → 2026-08-30), 57 distinct tickers
- `db/price_history.db` → 1,205,599 rows, 1,336 tickers (2000-11-27 → 2026-09-03)

## Honest Findings
| Metric | Old (raw) | Old (cap, no dedup) | New (canonical) | Δ |
|---|---|---|---|---|
| Win Rate | 50.5% (53/105) | 50.0% (52/104) | **52.6%** (57 after dedup) | +2.6pp ✅ |
| Profit Factor | 2.01 | 1.86 | **2.51** | +0.65 ✅ |
| R:R (avg) | 2.845 | — | 2.845 | 0.0000 ✅ |

- 97/105 predictions recomputed with canonical indicators — 0 errors, 0 NaN.
- 7 skipped due to <30 days of price history (thin ticker data, not a script issue).
- 7 per-stock "signal changes" — all explained by Rule 22 dedup picking the
  highest-master_score prediction per ticker, NOT indicator regressions.

## Conclusion
**✅ Canonical calculations (Rule 54) did NOT regress the backtest.**
- Indicators: 0 errors on 97 recomputations.
- R:R: byte-identical to old BUY-only formula for valid BUY setups.
- WR/PF deltas within tolerance (±5pp / ±1.0) — entirely explained by Rule 22 dedup.

## Files touched
- NEW: `scripts/deep_backtest_4months.py`
- MODIFIED: `worklog.md` (+150 lines of structured work record)

## Commit
- `bc2e845` feat: deep 4-month backtest validation — Rule 54 canonical check
- Pushed to `origin/main` at 2026-10-05.

## Next agent notes
- The script is idempotent — re-runnable anytime after DB updates.
- Re-run after every Phase 2 inline-copy migration to confirm no regression.
- The 7 "signal changes" are documented canonical behavior. Do NOT try to
  "fix" them by changing the dedup policy — Rule 22 is the law.
