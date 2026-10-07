# Engines Skipped (Not Archived) — Phase 5 §5.2

> Per **Rule 16 (VERIFY-BEFORE-DELETE)**, the following engines recommended
> for archival by the audit could NOT be archived because they have
> **active production importers**. The grep results below show that
> removing them would break the V40.2 prediction pipeline (canonical per
> Rule 21) — directly contradicting the goal of Phase 5.
>
> The audit's classification of these as "inactive" was incorrect. They
> are not standalone engines, but they ARE actively called as helpers
> by V40.2 itself.

## 1. `vps-service/analyzers/v73_sniper.py` (220 LOC) — SKIP

### Active importers found by grep:
- `vps-service/jobs/v40_2_daily_generator.py:1595` — V40.2 (CANONICAL) calls
  `detect_desert_phase` and `detect_auction_trap` inside a `try/except`
  block. The functions are actually called and their results are used
  to reject "clinically dead" stocks (BB squeeze + volume < 0.5×MA).
- `vps-service/analyzers/unified_analysis.py:278` — `analyze_stock_unified`
  calls the same two functions for the unified-analysis API endpoint.

### Verdict:
SKIP. Archiving would break V40.2's V73 sniper filters, which the
canonical engine actively uses (per Phase 6 update notes inside
`v40_2_daily_generator.py` lines 1590-1614).

---

## 2. `vps-service/analyzers/v76_golden_hunter.py` (410 LOC) — SKIP

### Active importers found by grep:
- `vps-service/jobs/v40_2_daily_generator.py:1635` — V40.2 (CANONICAL)
  calls `analyze_v76` gated by env var `V76_GOLDEN_HUNTER` (default `'1'`
  = enabled). Two signals are extracted: `PUMP_FROM_DESERT` (boost +15,
  proven +26.7% return) and `GOLDEN_RETEST` (boost +10, 63.3% WR).
- `vps-service/jobs/v40_2_intraday_scanner.py:40` — V40.2 (CANONICAL,
  cron `*/5 10-14 * * 0-4` in root crontab.txt line 18) — top-level
  import `from analyzers.v76_golden_hunter import analyze_v76`.

### Verdict:
SKIP. Archiving would break BOTH the V40.2 daily generator AND the
V40.2 intraday scanner (the canonical real-time engine running every
5 minutes during EGX market hours).

---

## 3. `vps-service/analyzers/fusion_engine.py` (724 LOC) — SKIP

### Active importers found by grep:
- `vps-service/analyzers/master_analyzer.py:150` — top-level import
  `from analyzers.fusion_engine import FusionEngineV20, calculate_fusion_metrics`.
  `master_analyzer.py` is itself called by `vps-service/jobs/market_scheduler.py:826`
  (an active job).
- `vps-service/api/chart_routes.py:3036` — chart API route uses
  `calculate_fusion_metrics` to enrich chart responses.
- `vps-service/jobs/crypto_lab_scheduler.py:280` — crypto lab job uses
  `FusionEngineV20`.
- `vps-service/tests/test_v20_fusion.py:32` — unit test (test code,
  but still actively asserting fusion behaviour).

### Verdict:
SKIP. Archiving would break the master analyzer, the chart API, and
the crypto lab scheduler.

---

## Summary

| Engine | Audit said | Actual grep | Decision |
|---|---|---|---|
| `v4_predictive_detector.py` | archive | 1 legacy backtest importer (no cron) | ✅ ARCHIVED (commit 7c226de) |
| `v73_sniper.py` | archive | 2 active V40.2 importers | ⏭️ SKIP (would break V40.2) |
| `v76_golden_hunter.py` | archive | 2 active V40.2 importers | ⏭️ SKIP (would break V40.2) |
| `unified_analyzer.py` | archive | 0 importers (only path-string refs) | ✅ ARCHIVED (commit 62a96b2) |
| `fusion_engine.py` | archive | 4 active production importers | ⏭️ SKIP (would break master_analyzer + chart API + crypto lab) |

**Net result:** 2 of 5 archived (1,447 LOC removed from active code path);
3 of 5 skipped with documented evidence to prevent future re-attempts.
