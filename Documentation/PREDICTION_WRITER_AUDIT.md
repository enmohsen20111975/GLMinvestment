# Prediction Writer Audit — Field Ownership Matrix

> **Date:** 2026-10-28 | **Branch:** `bravo/remediation-v3` | **Agent:** Bravo
> **Scope:** All INSERT/UPDATE/DELETE operations targeting `predictions` table

---

## Active Production Writers (3)

### 1. `prediction_tracker.py` (CREATOR + UPDATER)

**Entry point:** Imported by `daily_predictor.py` (cron: 03:00 + 15:00 UTC)

**Operations:**

| Op | Function | Fields Written | Can Overwrite? |
|----|----------|----------------|----------------|
| INSERT | `create_prediction()` | signal, signal_type, prediction_date, entry_price, target_price, stop_loss, master_score, technical_score, fundamental_score, ai_pattern_score, sentiment_score, notes, persona, market, status='active', risk_reward, who_is_buying | Creates new — no overwrite |
| UPDATE | `update_prediction()` | signal, signal_type, master_score, technical_score, fundamental_score, ai_pattern_score, sentiment_score, notes, atr_at_entry (COALESCE), target_price_2, explosive_score, explosive_label, risk_reward (COALESCE), who_is_buying (COALESCE), kill_filter_result (COALESCE), update_count | Does NOT touch: entry_price, prediction_date, status |

**Key safety:** UPDATE uses `COALESCE(?, field)` for nullable fields — won't wipe existing values with NULL. Does NOT overwrite `entry_price` or `prediction_date` or `status`.

---

### 2. `intraday_scanner.py` (CREATOR + UPDATER)

**Entry point:** cron `*/5 8-12 * * 0-4` (every 5 min during EGX session)

**Operations:**

| Op | Fields Written | Can Overwrite? |
|----|----------------|----------------|
| INSERT | Creates intraday predictions (RADAR_PROMOTED track) | Creates new |
| UPDATE | Updates existing predictions: status, outcome_date, exit_price, actual_return, hit_target, hit_stop, is_correct, holding_days, highest_price_reached | Overwrites **status** + **outcome fields** — this is the intraday tracking path |

**Key safety:** The UPDATE targets predictions by `id` and only updates outcome/tracking fields. Does NOT overwrite `entry_price`, `prediction_date`, or `signal`.

**Potential conflict with daily_closer:** Both write `status` and `outcome_date`. If intraday_scanner closes a prediction at 11:00 and daily_closer tries to close the same prediction at 15:15, daily_closer should check if status is already closed. **This needs verification.**

---

### 3. `daily_closer.py` (CLOSER)

**Entry point:** cron `13:15 * * 0-4` (15:15 Cairo, post-market)

**Operations:**

| Op | Fields Written | Can Overwrite? |
|----|----------------|----------------|
| UPDATE | status='closed', outcome_date, exit_price, actual_return, hit_target, hit_stop, is_correct, holding_days, highest_price_reached, lowest_price_reached, exit_type, exit_reason, partial_exit_price, partial_exit_date, partial_return_pct, exit_policy, data_quality | Overwrites **status** + **all outcome fields** |

**Key safety:** Does NOT overwrite `entry_price`, `prediction_date`, `signal`, `target_price`, `stop_loss`.

**Conflict risk:** If intraday_scanner already closed a prediction (status='closed'), daily_closer might try to close it again. **Needs status check before closing.**

---

## Non-Production Writers (3 — classified)

### 4. `close_predictions.py` (STANDALONE CLOSER — NOT IN CRON)

**Status:** Has `main()` — runnable as CLI script. Imported by `market_scheduler.py`.

**But:** `market_scheduler.py` is NOT in crontab. It was replaced by direct `daily_closer.py` cron entry.

**Risk:** If someone runs `python3 close_predictions.py` manually, it writes to `predictions` table (status, outcome_date, exit_price, etc.). But it's not automated.

**Classification:** **Inactive — not in cron, not in API, not in any active service.**

---

### 5. `dual_track_generator.py` (BACKTEST UTILITY — NOT IN CRON)

**Status:** Referenced by `liquidity_backtest_engine.py` (print statement only — not imported).

**Risk:** Can be run manually but not automated.

**Classification:** **Inactive — not in cron, not imported by any production code.**

---

### 6. `populate_history_fast.py` (DISABLED BACKFILL)

**Status:** Has explicit guard at top:
```python
# Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
# V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
# to write predictions. This one-off backfill script is disabled.
```

**Classification:** **Explicitly disabled — cannot write without code change.**

---

## Field Ownership Matrix

| Field | Created by | Updated by | Closed by | Overwrite risk |
|-------|-----------|------------|-----------|----------------|
| `entry_price` | prediction_tracker | ❌ never | ❌ never | None — immutable after creation |
| `prediction_date` | prediction_tracker | ❌ never | ❌ never | None — immutable |
| `signal` | prediction_tracker | prediction_tracker (UPDATE) | ❌ never | Low — only tracker updates signal |
| `target_price` | prediction_tracker | ❌ never | ❌ never | None |
| `stop_loss` | prediction_tracker | ❌ never | ❌ never | None |
| `status` | prediction_tracker ('active') | ❌ never | daily_closer ONLY | None — sole closer |
| `outcome_date` | ❌ never | ❌ never | daily_closer ONLY | None — sole closer |
| `exit_price` | ❌ never | ❌ never | daily_closer ONLY | None |
| `actual_return` | ❌ never | ❌ never | daily_closer ONLY | None |
| `hit_target` | ❌ never | ❌ never | daily_closer ONLY | None |
| `hit_stop` | ❌ never | ❌ never | daily_closer ONLY | None |
| `highest_price_reached` | ❌ never | ❌ never | daily_closer ONLY | None |

**CORRECTION (2026-10-28 V3):** Previous version incorrectly listed intraday_scanner
as writing to `status`, `outcome_date`, `exit_price`, etc. This was WRONG.
Verified by examining actual SQL: intraday_scanner UPDATEs only touch
`signal`, `signal_type`, `risk_reward`, `confidence`, `notes`, `updated_at`,
`update_count`, `kill_filter_result`, `entry_price_min/max`, `support/resistance levels`.
It NEVER writes `status`, `outcome_date`, `exit_price`, `actual_return`,
`hit_target`, `hit_stop`, or `highest_price_reached`. Daily_closer is the SOLE closer.

---

## Conflict Risk: intraday_scanner vs daily_closer

**The only real conflict risk** is between intraday_scanner (closes during session) and daily_closer (closes post-market). Both write `status`, `outcome_date`, `exit_price`, etc.

**Mitigation needed:** daily_closer should check `WHERE status = 'active'` before closing — if intraday_scanner already closed it, daily_closer should skip it.

**Verification:** Check if daily_closer already has this guard.

---

## Conflict Analysis Result

**NO conflict exists between intraday_scanner and daily_closer.**

- `intraday_scanner` does NOT close predictions. It only:
  1. INSERTs new predictions (track='RADAR_PROMOTED')
  2. UPDATEs signal/confidence/notes on existing predictions
  3. Never sets `outcome_date` or `status='closed'` (verified: 0 matches)

- `daily_closer` is the SOLE closer:
  1. SELECTs `WHERE outcome_date IS NULL` (finds pending only)
  2. UPDATEs `outcome_date` + `status='closed'` + all outcome fields
  3. Once `outcome_date` is set, the prediction is excluded from future closes

**Conclusion:** The prediction lifecycle is safe:
1. Created by: prediction_tracker (daily_predictor) or intraday_scanner
2. Updated by: prediction_tracker (scores) or intraday_scanner (signal refresh)
3. Closed by: daily_closer ONLY (post-market, 15:15 Cairo)
4. No writer overwrites `entry_price` or `prediction_date` after creation
