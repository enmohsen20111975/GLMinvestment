# Production Audit Findings — 2026-10-25
> **Source:** `db_audit_20261025_124944.txt` from VPS (`/home/meme/my_apps/GLMinvestment`).
> **Audit script:** `scripts/production_db_audit.py` (committed at `75470a7`).
> **Status:** CRITICAL FINDINGS — production state differs significantly from sandbox.

---

## 🚨 CRITICAL FINDING: `canonical_state` NEVER RAN ON PRODUCTION

### Evidence
The production `radar_signal_tracking` table schema (from audit line 538-554) has **16 columns only**:

```
id, ticker, signal_date, signal_type, entry_price, path, reason, status,
outcome_7d, outcome_14d, outcome_30d, max_price_after, min_price_after,
verified_at, created_at, data_date, data_quality, staleness_days,
price_source, live_price, daily_price
```

**MISSING columns (that sandbox has):**
- `canonical_state`
- `prev_state`
- `transition_type`
- `days_in_state`
- `confidence`
- `direction_up`
- `direction_down`
- `evidence_json`
- `invalidation_json`
- `data_freshness`

### What this means
1. `state_history_tracker.py::ensure_state_columns()` was **NEVER executed** on production. If it had run, it would have `ALTER TABLE ADD COLUMN` for all 10 canonical_state columns.
2. The 42 canonical_state rows in sandbox are **sandbox-only artifacts** — they do NOT exist on production.
3. **V2 (duplicates) does NOT exist on production** — because the source writer (`state_history_tracker.py`) never ran.
4. The entire `canonical_state` engine — the subject of weeks of investigation — **has zero footprint on production**.

### Why this happened
- **No cron job for `state_history_tracker.py`** (confirmed: production crontab lines 132-153 do NOT include it).
- The script exists in the repo but was never scheduled.

---

## Confirmed production state (vs sandbox)

| DB / Table | Production | Sandbox | Match? |
|---|---|---|---|
| `stocks.db` size | 25.86 MB | 23.86 MB | ~ |
| `stocks.db` tables | 51 | 50 | +1 (index_daily_prices) |
| `radar_signal_tracking` rows | 1287 | 1301 | ~ |
| `radar_signal_tracking` columns | 16 (no canonical_state) | 25 (with canonical_state) | ❌ DIFFERENT |
| `predictions.db` predictions rows | 2422 | 2256 | ~ |
| `price_history.db` rows | 1,401,859 | 1,311,000 | production larger |
| `news.db.market_news` rows | 1709 | 1351 | production larger |
| `data_engine.db` size | 524 MB | 496 MB | ~ |
| `stock_phase` rows | 1238 | 1238 | identical (frozen) |
| `auth.db.User` rows | 129 | 0 | sandbox empty |
| `auth.db.api_tokens` rows | 45 | 0 | sandbox empty |

---

## Re-evaluated violations (production-confirmed)

| # | Violation | Production status | Action needed |
|---|---|---|---|
| V1 | maker_radar unscoped DELETE | ✅ EXISTS (cron runs every 5 min) | Fix still needed (scope DELETE) |
| V2 | INSERT OR REPLACE without UNIQUE | ❌ DOES NOT EXIST (state_history_tracker never ran) | **No action needed** — but if we ever activate state_history_tracker, V2 will manifest |
| V3 | state_history_tracker bypasses env override | ❌ DOES NOT EXIST (script never ran) | Same as V2 |
| V4 | news.db multi-writer | ✅ EXISTS (news-agent + admin route both write to 1709 rows) | Fix still needed |
| V5 | daily_closer bypasses PredictionTracker | ✅ EXISTS (cron runs daily) | Fix still needed |
| V6 | stock_phase orphaned | ✅ EXISTS (1238 rows, frozen) | Cleanup needed |
| V7 | distribution events never recorded | ✅ EXISTS (maker_radar runs, 0 distribution rows) | Fix still needed |
| V8 | 5 empty tables in predictions.db | ✅ EXISTS (all 5 empty on production) | Cleanup needed |
| V9 | gold_prices stale rows in stocks.db | ✅ EXISTS (3 rows on production) | Cleanup needed |

---

## New findings from production audit

### N1: `state_history_tracker.py` is dead code on production
- No cron job schedules it.
- No production file imports it (confirmed by sandbox Grep — same codebase).
- Its `ensure_state_columns()` never ran → production schema lacks its columns.

**Implication:** The entire canonical_state subsystem (engine + tracker + shadow mode) is **theoretical only**. It was never deployed.

### N2: Production uses `daily_predictor.py` directly (not via V40.2)
- Cron line 134: `daily_predictor.py --today-only --max-picks 5`
- Cron line 136: `daily_predictor.py --yesterday-only --max-picks 10`
- Comment line 97-100: "V40.2 cron معطّل — MaestroOrchestrator هو المصدر الوحيد"

**Implication:** The prediction pipeline on production is `daily_predictor.py` (which we identified as the protected file). canonical_state integration would need to hook into THIS path.

### N3: `maker_radar.py` runs every 5 minutes during EGX hours
- Cron line 138: `*/5 8-14 * * 0-4` (Sun-Thu, 08:00-14:00 UTC = 10:00-16:00 Cairo).
- 6 hours × 12 runs/hour = ~72 runs/day per market day.

**Implication:** V1 (unscoped DELETE) executes ~72 times per trading day. Each run wipes all rows for that signal_date. If canonical_state were ever activated, it would be wiped 72 times/day.

### N4: Production env vars confirm NO database path overrides
- `DB_DIR`, `STOCKS_DB`, `PREDICTIONS_DB`, etc. all `<not set>`.
- Production uses default paths (`db/stocks.db`, etc.).
- V3 (env override bypass) would NOT cause issues on THIS production config — but the code is still wrong (latent bug).

### N5: `custom.db` exists on production (forbidden by Rule 44)
- Production has `custom.db` (0.02 MB) with tables `Post` and `User`.
- Rule 44 forbids using `custom.db` (runtime only).
- This is a **NEW violation (V10)** — needs investigation.

### N6: `data_source_index.db` exists on production (not in sandbox)
- 0.02 MB, modified 2026-10-22.
- Not documented in `db_paths.py`.
- **NEW violation (V11)** — undocumented DB file.

### N7: `telegram-interactive-bot` is stopped on production
- PM2 status: `stopped` (restarts=6).
- Other 6 services: online.
- Not a database issue, but worth noting.

---

## 🚨 SECURITY: sensitive data in audit output

The audit output file (`db_audit_20261025_124944.txt`) contains `.env` values that were printed by the audit script's "env vars" section. While the script redacted SECRET/TOKEN/PASSWORD/KEY fields, some values leaked (PAYMOB_HMAC, TELEGRAM_API_ID, GOOGLE_CLIENT_ID, etc.).

**Recommendation:**
1. **Delete the audit file** from any shared location: `rm data/db_audit_*.txt`
2. The audit script should be updated to redact ALL `.env` values (not just keyword-matched ones).
3. Do not share the raw audit file publicly.

---

## Revised remediation priorities

### Drop (no longer needed)
- **V2** (INSERT OR REPLACE duplicates) — does not exist on production. Re-evaluate IF state_history_tracker is ever activated.
- **V3** (env override bypass) — latent bug, not active on current production config. Low priority.

### Keep (still needed)
- **V1** (unscoped DELETE) — runs 72x/day on production. HIGH priority.
- **V4** (news multi-writer) — active on production. HIGH priority.
- **V5** (daily_closer bypass) — runs daily. MEDIUM priority.
- **V7** (distribution not recorded) — runs 72x/day. MEDIUM priority.
- **V6, V8, V9** (cleanup) — LOW priority.

### New
- **N5** (custom.db forbidden use) — investigate.
- **N6** (data_source_index.db undocumented) — document or remove.

---

## Impact on canonical_state integration plan

The entire canonical_state integration discussion was **premature**. Since:
1. `state_history_tracker.py` never ran on production.
2. No cron job schedules it.
3. The production schema doesn't have canonical_state columns.

**Before any integration work, the owner must decide:**
- Should `state_history_tracker.py` be activated on production at all?
- If yes: add cron job + run `ensure_state_columns()` once (schema migration).
- If no: the canonical_state engine is dead code and should be archived or removed.

**This is a strategic decision, not an engineering one.** The engineering work (engine, tests, shadow mode) is complete in sandbox, but production deployment was never authorized or scheduled.
