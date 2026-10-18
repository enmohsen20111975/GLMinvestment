
## 2026-10-18 — DATA-LAYER-1 (BRAVO): Rule 46 Amendment — egksco DEPRECATED

**Changed:**
- `vps-service/data/prices.py`: `load_price_history()` now reads from `price_history.db.price_history` (canonical, 1.3M rows) instead of `data_engine.db.egksco_price_history` (deprecated, 59K rows, stale schema).
- `Documentation/00-CONSTITUTION.md`: Rule 46 amended — egksco_price_history = DEPRECATED. New per-domain canonical map added.

**Added:**
- `vps-service/core/canonical_sources.py`: SSOT per-domain data source map (stock/crypto/gold/forex/intraday/commodity).

**Rationale:**
- Owner directive (2026-10-18): egksco_price_history was 59K rows but stale schema (price_date) + split-brain with price_history.db (1.3M rows, 2000-2026).
- 10 files checked egksco FIRST → wasted I/O + inconsistent results.

**Migration:**
- All code should route via `core.canonical_sources.CanonicalSources`.
- `egksco_price_history` DROP on sandbox copy only (after verify 0 usage).
- 10 files need follow-up refactor (daily_predictor, daily_closer, learning_engine, etc.).
