# PHASE-3-BULK — Migrate TOP 10 sqlite3.connect files to db_manager (Rule 54 Phase 3)

**Agent**: full-stack-developer
**Task ID**: PHASE-3-BULK
**Date**: 2026-10-05
**Task**: Migrate the TOP 10 files with the most `sqlite3.connect()` calls to use `db_manager` from `vps-service/core/db_manager.py`.

## Migration Strategy

**Pattern**: Use the existing `_dbm` / `db_manager` import at module top. For each `sqlite3.connect(X)` block:
- Wrap connection opening with `try: db_manager.connection('alias') ... except: sqlite3.connect fallback`
- Keep all `conn.execute(...)` body intact (db_manager sets `row_factory = sqlite3.Row`, so the patterns work identically)
- Wrap conn.close() in a try/finally so cleanup happens on both paths
- Don't touch _archived files

## Files (in order)

1. `vps-service/api/misc_routes.py` (23 instances)
2. `vps-service/api/admin_routes.py` (22 instances)
3. `vps-service/analyzers/prediction_tracker.py` (11 instances)
4. `vps-service/ai/trade_recorder.py` (11 instances)
5. `vps-service/jobs/v40_2_daily_generator.py` (10 instances)
6. `vps-service/jobs/market_scheduler.py` (9 instances)
7. `vps-service/engines/v38_backtest_engine.py` (9 instances)
8. `vps-service/analyzers/prediction_optimizer.py` (9 instances)
9. `vps-service/analyzers/backtest_engine.py` (9 instances)
10. `vps-service/api/portfolio_routes.py` (8 instances)

## Work Log

(in-progress)
