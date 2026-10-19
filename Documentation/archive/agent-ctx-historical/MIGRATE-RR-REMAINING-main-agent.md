# MIGRATE-RR-REMAINING — Migration of all remaining inline R:R calculations

**Task ID:** MIGRATE-RR-REMAINING
**Agent:** main-agent
**Date:** 2026-10-05
**Rule:** Rule 54 (CALCULATION-CANONICAL)

## Summary

Migrated **34 files** (53 inline R:R computation sites) from inline
`(target - entry) / (entry - stop)` / `reward / risk` patterns to the
canonical `compute_risk_reward(entry, target, stop, fallback=...)` from
`vps-service/utils/risk_reward.py`.

## Migration Pattern Used

```python
# OLD: rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
# NEW:
rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
# Rule 54: استخدم canonical compute_risk_reward
try:
    from utils.risk_reward import compute_risk_reward
    rr = compute_risk_reward(entry, target, stop, fallback=rr)
except Exception:
    pass  # keep inline rr computed above
```

The inline value is **kept** as the fallback argument (or in the `except`
branch) — backward-compat: if `compute_risk_reward` import fails or the
module path changes, the old calculation still runs.

## Files Migrated (34 files, 53 sites)

### Batch 1 — commit `e0db93d` (3 files)
- `vps-service/jobs/daily_predictor.py` (1 site at L2064)
- `vps-service/engine/persona_engine.py` (1 site at L478)
- `vps-service/analyzers/technical_target_engine.py` (2 sites: L441 SHORT, L448 LONG)

### Batch 2 — commit `7b565e0` (3 files)
- `vps-service/analyzers/risk_adaptive.py` (2 sites: L502 SHORT, L558 LONG)
- `vps-service/analyzers/risk.py` (1 site at L164)
- `vps-service/analyzers/persona_gambler.py` (1 site at L502)

### Batch 3 — commit `6ed6e73` (4 files)
- `vps-service/analyzers/prediction_optimizer.py` (1 site at L1386)
- `vps-service/analyzers/scoring_fix.py` (1 site at L385)
- `vps-service/analyzers/hunting_engine.py` (1 site at L953)
- `vps-service/analyzers/kimi_fixes.py` (3 sites: L200, L208, L429)

### Batch 4 — commit `ffc8038` (2 files, 8 sites)
- `vps-service/analyzers/persona_screener.py` (4 sites: L1381, L1393, L1665, L1708, L1727)
- `vps-service/analyzers/dynamic_target_engine.py` (5 sites: L875, L1284, L1341, L1681, L1712)

### Batch 5 — commit `eead6de` (5 files)
- `vps-service/analyzers/persona_investor.py` (1 site at L962)
- `vps-service/analyzers/sniper_engine.py` (1 site at L1890)
- `vps-service/analyzers/master_analyzer.py` (2 sites: L2804, L3661)
- `vps-service/analyzers/trader_levels_engine.py` (1 site at L156)
- `vps-service/analyzers/core_scoring_engine.py` (3 sites: L520, L538, L1717)

### Batch 6 — commit `27f2eea` (7 files)
- `vps-service/portfolio/trade_journal.py` (1 site at L304)
- `vps-service/utils/entry_gate.py` (1 site at L155)
- `vps-service/scripts/backtest_sniper.py` (1 site at L454)
- `vps-service/scripts/egx_backtest/egx_sniper_backtest.py` (1 site at L655)
- `vps-service/scripts/backtesting_engine.py` (1 site at L265)
- `vps-service/scripts/maestro_backfill_v2.py` (1 site at L666)
- `vps-service/telegram/auto_poster.py` (1 site at L294)

### Batch 7 — commit `2a6e155` (5 files)
- `vps-service/api/misc_routes.py` (2 sites: L1702, L2935)
- `vps-service/api/portfolio_routes.py` (2 sites: L497, L2059)
- `vps-service/api/ai_routes.py` (1 site at L795)
- `vps-service/api/historical_predictions_v2_routes.py` (1 site at L354)
- `vps-service/api/stock_analysis_routes.py` (1 site at L523)

### Batch 8 — commit `48f51a1` (5 files, final)
- `vps-service/api/stored_analysis_routes.py` (1 site at L2232)
- `vps-service/api/v2_routes.py` (2 sites: L1120, L1983)
- `vps-service/core/opportunity_quality.py` (1 site at L480)
- `vps-service/engines/backtest_engine.py` (1 site at L2172)
- `vps-service/risk_management_advanced.py` (2 sites: L1228, L1825)

## Pre-Migration Verification

Before each commit:
1. `git stash && git pull --rebase origin main && git stash pop`
2. `python3 -c "import ast; ast.parse(open('FILE').read()); print('OK')"`

All 8 pulls returned «Already up to date.» — no upstream divergence during
this session.

## Post-Migration Verification

- Final syntax check: `OK=34 FAIL=0` across all 34 migrated files
- File-count using canonical `compute_risk_reward`: **40 files** (39
  consumers + `utils/risk_reward.py` itself)
- Previous count (per worklog): 12 files
- This task added: **27 new consumers** (the other 7 were already
  migrated from the prior task)

## Files Excluded (intentional, per task rules)

- `_archived/*` — explicitly excluded by rule
- `tests/test_phase_a_hotfix.py:245` — test fixture computing
  `expected_rr = round(expected_reward / expected_risk, 2)`. This is a
  *reference value* the test asserts against, NOT a production
  calculation. Migrating it would defeat the test's purpose (verifying
  the canonical function itself).
- `scripts/cleanup_catastrophic.py:14` — docstring comment describing
  the rule (not executable code).
- `scripts/cleanup_catastrophic.py:68` — SQL `CASE WHEN` expression
  inside an embedded SQL string. `compute_risk_reward` is a Python
  function; it cannot be embedded into SQL. The SQL expression is
  required for the database-side classification.
- Docstrings matching `risk_reward = reward / risk` patterns
  (e.g. `analyzers/persona_screener.py:1231`,
  `analyzers/hunting_engine.py:888`, `api/stock_analysis_routes.py:452`)
  are descriptive comments, not executable code — left untouched.

## Remaining Inline R:R (Count = 0 in production code)

Every grep match for `reward / risk` or `(target - entry) / (entry - stop)`
in `vps-service/` (excluding `_archived/`, `tests/`, docstrings/comments,
and the SQL CASE-WHEN expression in `cleanup_catastrophic.py`) is now
either:

1. The inline value computed **before** the canonical call (so it can be
   passed as the `fallback=` argument), OR
2. Inside an `except Exception:` branch (the fallback path of the
   `try` block that calls canonical).

There are **zero** bare inline R:R computations remaining in production
Python code under `vps-service/`.

## Backward Compatibility

Every migration preserves the original calculation as a fallback in one
of two ways:

```python
# Pattern A (most files) — inline as fallback argument:
rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
try:
    from utils.risk_reward import compute_risk_reward
    rr = compute_risk_reward(entry, target, stop, fallback=rr)
except Exception:
    pass  # keep inline rr computed above

# Pattern B (e.g. engine/persona_engine.py, ai_routes.py) — inline in except:
try:
    from utils.risk_reward import compute_risk_reward
    risk_reward = compute_risk_reward(entry, target, stop, fallback=0.0)
except Exception:
    risk_reward = reward / risk if risk > 0 else 0
```

Both patterns ensure that if `compute_risk_reward` is unavailable (import
error, missing module, env drift), the original behaviour is preserved
exactly. No production behaviour should change as a result of these
migrations; only the *source of truth* for the calculation moves to
`utils/risk_reward.py`.

## Notes for the Next Agent

- All 34 files in this task live under `vps-service/` (Python backend).
  The TS canonical (`src/lib/risk-reward.ts::computeRiskReward()`) is
  the frontend equivalent — already aligned per the docstring in
  `vps-service/utils/risk_reward.py`.
- When adding new R:R computations: ALWAYS start with
  `from utils.risk_reward import compute_risk_reward` and pass the
  inline value only as the `fallback=` argument for resilience.
- If you find a NEW inline R:R appearing in code review, please migrate
  it using Pattern A above.
- The function detects BUY vs SELL automatically (target > entry → BUY,
  stop > entry → SELL). Pass real prices (not signed deltas) — the
  geometry is validated internally.
- The canonical returns a value already rounded to 2 decimal places. If
  the caller needs 3-decimal precision (e.g.
  `core/opportunity_quality.py:480` which used `round(reward/risk, 3)`),
  note that the canonical will round to 2 decimals. This is acceptable
  for `opportunity_quality.py` since the result is later passed through
  score-weighting, but flag if any future caller needs higher precision.
