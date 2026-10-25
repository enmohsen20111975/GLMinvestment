# Shadow Mode Safety Assessment — canonical_state_shadow.py
> **Status:** Engineering review. NOT approved for production activation.
> **Decision required from owner:** whether to activate on VPS.

## 1. What was actually built

`vps-service/camp/canonical_state_shadow.py` (499 lines) implements an Observer pattern:
- Monkey-patches `PredictionTracker.record_prediction` when `CANONICAL_STATE_SHADOW_MODE=1` env var is set.
- After each successful `record_prediction`, fetches the canonical_state for the (ticker, prediction_date) from `radar_signal_tracking`.
- Inserts an audit record into `shadow_canonical_state_audit` table (in `predictions.db`).
- Does NOT modify the original prediction, does NOT change any decision.

## 2. Is it loaded in the production path?

**NO.** Verified by grep across the entire repo:
- `canonical_state_shadow` is referenced in only 3 files:
  1. The module itself (`vps-service/camp/canonical_state_shadow.py`)
  2. `scripts/test_shadow_mode_phase2.py` (test)
  3. `scripts/test_historical_validation_phase2.py` (test)
- `daily_predictor.py` does NOT import it (verified: 0 matches for `shadow` in that file).
- No cron job, no scheduler, no API route imports it.

**Conclusion:** Shadow Mode is a standalone module + tests. It is NOT wired into any production path. Activating it would require adding an import + `shadow.activate()` call in `daily_predictor.py` (a protected file per task constraints) — which is NOT permitted in this phase.

## 3. Engineering safety analysis

### ✅ What it does safely
- **Fail-safe design:** every external call (DB read, DB write, fetch canonical_state) is wrapped in try/except. If anything fails, the original `record_prediction` still returns its `prediction_id`. No prediction is lost due to shadow logging.
- **No schema migration on production:** the `shadow_canonical_state_audit` table is created via `CREATE TABLE IF NOT EXISTS` — safe, idempotent.
- **Read-only on `radar_signal_tracking`:** uses `file:...?mode=ro` URI for the canonical_state fetch.
- **No decision modification:** the wrapper returns the original `prediction_id` unchanged. No priority delta, no action override is applied.
- **Activation is explicit:** requires `CANONICAL_STATE_SHADOW_MODE=1` env var. Default = off.
- **Backtest protection:** skips if `V40_2_BACKTEST_MODE=1` (prevents polluting backtest data).
- **Deactivation:** `shadow.deactivate()` restores the original `record_prediction` cleanly.

### ⚠️ Risks if activated on production

1. **Monkey-patch timing:** `shadow.activate()` must be called BEFORE any `PredictionTracker` is instantiated. If `daily_predictor.py` imports `PredictionTracker` at module load (line 104), the patch must happen at import time or before `tracker = PredictionTracker()` (line 3747). This requires modifying `daily_predictor.py` — a protected file.

2. **SQLite write contention:** the audit INSERT happens inside the same `record_prediction` call. If `daily_predictor.py` runs in a tight loop (1000+ predictions), and `daily_closer.py` is also writing to `predictions.db` concurrently, SQLite may hit `database is locked` errors. The `try/except` swallows these, but the audit record is lost. **No data corruption risk, but audit coverage may be incomplete.**

3. **Audit table growth:** each prediction adds 1 audit row. At ~100 predictions/day (rough estimate), the audit table grows ~3K rows/month. Manageable, but needs a retention/cleanup policy eventually.

4. **`fetch_canonical_state_for_ticker` query cost:** one SQL query per prediction, hitting `radar_signal_tracking` with `WHERE ticker=? AND signal_date<=? ORDER BY signal_date DESC LIMIT 1`. The table has an index on `ticker` (`idx_radar_sig_ticker`), so this is fast (~1ms). But 1000 predictions × 1ms = 1 second of added latency. Acceptable for daily cron, NOT acceptable for real-time.

5. **Lookahead bias risk:** if `state_history_tracker` runs AFTER `daily_predictor` on the same day, the canonical_state fetched at audit time may include data not available at prediction time. **Mitigation:** the audit records `canonical_state` as-of the prediction date, but the query uses `signal_date <= prediction_date`. If `state_history_tracker` writes a row with `signal_date = prediction_date` AFTER the prediction, the audit would pick it up. **This is a real lookahead bias risk that must be addressed before any historical comparison.**

6. **No transaction atomicity:** the audit INSERT is in a separate connection from the prediction INSERT. If the process crashes between the two, you get a prediction without an audit (or vice versa, though the wrapper only audits after prediction succeeds).

## 4. Required changes before activation (NOT permitted in this phase)

1. **Import + activate in `daily_predictor.py`** (protected file — needs owner approval):
   ```python
   # At top of daily_predictor.py, after PredictionTracker import:
   import os
   if os.environ.get('CANONICAL_STATE_SHADOW_MODE') == '1':
       try:
           from camp.canonical_state_shadow import activate as _shadow_activate
           _shadow_activate()
       except Exception:
           pass  # fail-safe — don't break predictions
   ```

2. **Lookahead bias fix:** change `fetch_canonical_state_for_ticker` to use `signal_date < prediction_date` (strictly less than) instead of `<=`. This ensures the canonical_state was computed BEFORE the prediction.

3. **Retention policy:** add a cron job to delete audit rows older than N days (e.g., 90 days).

4. **Monitoring:** add a metric/log line when shadow mode activates/deactivates, so it's visible in production logs.

## 5. Test coverage

`scripts/test_shadow_mode_phase2.py` — 24/24 ✅. Covers:
- Audit table creation.
- activate/deactivate lifecycle.
- record_prediction with shadow = audit logged.
- fail-safe for missing canonical_state.
- no decision modification (predictions table unchanged).
- analysis queries (get_shadow_audits, get_shadow_summary).

### What the tests do NOT cover
- Production-like load (1000+ predictions in a tight loop).
- Concurrent writes from `daily_closer.py`.
- SQLite lock contention behavior.
- The monkey-patch actually loading when `daily_predictor.py` runs (because `daily_predictor.py` doesn't import it).
- Lookahead bias (tests use same-date matches, which have the bias).

## 6. Conclusion

**Engineering verdict: NOT READY for production activation.**

The module is well-designed (fail-safe, no decision modification, explicit activation). But:
- It is NOT wired into any production path (would require modifying protected `daily_predictor.py`).
- It has a lookahead bias risk that must be fixed before any historical comparison.
- It has not been tested under production load or concurrency.

**Recommendation to owner:**
1. Approve the single-line import addition to `daily_predictor.py` (line ~105, after `PredictionTracker` import).
2. Approve the lookahead bias fix (change `<=` to `<` in `fetch_canonical_state_for_ticker`).
3. Deploy with `CANONICAL_STATE_SHADOW_MODE=1` on VPS for a 2-4 week observation period.
4. After observation, analyze `shadow_canonical_state_audit` using the pre-defined methodology in `scripts/test_historical_v2_phase2.py`.
5. Decide whether to promote canonical_state to an active input (requires separate approval + entry_gate modification).
