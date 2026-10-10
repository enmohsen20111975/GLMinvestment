# UNIFIED-STOCK-API-1 — main-agent

## Task
Create the CANONICAL unified stock API at `src/app/api/stocks/[ticker]/unified/route.ts` that merges stocks.db + predictions.db + maker_radar cache + canonical-signal.ts into ONE response so all UI screens show the same signal for the same ticker (fixing the ETEL 5-screens-5-signals bug).

## Work log
- Confirmed `better-sqlite3` already installed.
- Inspected `db/stocks.db.stocks` schema — found ETEL row with `signal=0`, `rsi=76.31`, `ma_50=122.24`, `ma_200=116.68`, `support=134.3`, `resistance=147.5`, `trend='صاعد'`.
- Inspected `db/predictions.db.predictions` schema — confirmed columns: `signal, signal_type, entry_price, target_price, target_price_2, stop_loss, master_score, risk_reward, confidence, prediction_date, atr_at_entry, analysis_json, status, market`. Latest ETEL prediction: `signal='HOLD'`, `master_score=50`, `entry_price=148.45`, `target_price=174.7225`, `stop_loss=138.291`, `analysis_json=NULL`.
- Inspected `scripts/output/maker_radar_EGX_20261007.json` — confirmed ETEL entry under `all_results` with `buy_pct=75.7`, `sell_pct=24.3`, `path='B_quiet_accumulation_strong'`, `position_size=0.015`, `roc_10d=13.55`, `roc_30d=29.21`, `money_flow_state='🟢 سيولة داخلة'`, `data_quality='fresh'`, `staleness_days=1`.
- Confirmed `src/lib/canonical-signal.ts` exports: `classifySignal`, `signalAr`, `classifyAccumulation`, `classifyMoneyFlow`, `classifyStockPhase` (+ types `SignalType`, `AccumulationLabel`, `MoneyFlowState`, `StockPhase`).
- Created `/home/z/my-project/src/app/api/stocks/[ticker]/unified/route.ts` (355 LOC):
  - `force-dynamic` + `revalidate=0` to bypass route caching.
  - Step 1: opens `stocks.db` readonly, queries ETEL row in a try/catch. Returns 404 if missing.
  - Step 2: opens `predictions.db` readonly, queries latest prediction `WHERE ticker=? AND market IN ('EGX','مصر') ORDER BY prediction_date DESC LIMIT 1`. Wrapped in try/catch.
  - Step 3: walks `scripts/output/maker_radar_EGX_<YYYYMMDD>.json` for today + 6 days back (graceful if missing). Searches both `all_results` and `under_microscope` arrays.
  - Step 4: computes canonical classifications using `classifySignal` (precedence: predictions.master_score → stocks.signal → null), `classifyAccumulation`, `classifyMoneyFlow`, `classifyStockPhase`.
  - Step 5: parses `analysis_json` (analysis_reason, who_is_buying, hmm_regime, target_price_3, support_level, resistance_level).
  - Step 6: builds unified response with 6 sections: `stock`, `fundamentals`, `technical`, `canonical`, `prediction`, `radar` — every field nullable, never fabricated. Includes `cached_at` ISO timestamp.
  - Computes `position_size_pct = position_size × 100` (radar stores `position_size` as decimal).
- Ran `bun run lint` — passed clean (no errors, no warnings).
- Tested with `curl http://localhost:3000/api/stocks/ETEL/unified`:
  - `canonical.signal = 'HOLD'`, `canonical.signal_ar = 'انتظار'`, `canonical.master_score = 50` (from predictions.db.master_score).
  - `canonical.accumulation = 'تجميع قوي'` (buy_pct=75.7 ≥ 70).
  - `canonical.money_flow = '🟢 سيولة داخلة قوية'` (75.7 − 24.3 = 51.4 ≥ 25).
  - `canonical.phase = 'تصاعد'` (buy_pct=75.7 ≥ 55 AND roc_10d=13.55 > 5).
  - `technical.rsi = 76.31` (from stocks.db — Wilder's pre-computed), `technical.signal_raw = 0`, `technical.atr = null` (predictions.db.atr_at_entry was NULL).
  - `prediction.entry_price = 148.45`, `target_price = 174.7225`, `stop_loss = 138.291`, `target_price_2 = null`, `confidence = null`, `risk_reward = null`, `analysis_reason = null` (analysis_json was NULL).
  - `radar.path = 'B_quiet_accumulation_strong'`, `radar.buy_pct = 75.7`, `radar.sell_pct = 24.3`, `radar.position_size_pct = 1.5`, `radar.data_quality = 'fresh'`, `radar.data_date = '2026-10-06'`.
- Tested graceful degradation: `COMI` (no prediction, no radar) returns `prediction: null`, `radar: null`, but `stock`, `fundamentals`, `technical`, `canonical` all populated; canonical.signal falls back to `STRONG_SELL` (stocks.signal=0).
- Tested 404: `ZZZZ` returns `{"success": false, "error": "stock_not_found", "ticker": "ZZZZ"}`.

## Stage summary
- The CANONICAL unified API is live and verified for ETEL — every screen that reads from `/api/stocks/[ticker]/unified` will show:
  - signal = HOLD (consistent)
  - signal_ar = انتظار (consistent)
  - accumulation = تجميع قوي (consistent)
  - money_flow = 🟢 سيولة داخلة قوية (consistent)
  - phase = تصاعد (consistent)
- All 6 response sections present: `stock`, `fundamentals`, `technical`, `canonical`, `prediction`, `radar`.
- Missing/empty data sources for ETEL: `prediction.analysis_json` was NULL (so analysis_reason, who_is_buying, hmm_regime, target_price_3 all returned null); `prediction.atr_at_entry` was NULL (so `technical.atr` = null); `prediction.risk_reward` and `prediction.confidence` were NULL; `prediction.target_price_2` was NULL. These are real NULLs in the database, NOT fabricated.
- Recommended next step: migrate the 5 conflicting UI screens to fetch from `/api/stocks/[ticker]/unified`:
  1. Predictions list (`signal_ar` should read `canonical.signal_ar`)
  2. Prediction detail (should read `prediction.entry_price`, `target_price`, `stop_loss` from this API)
  3. Stock data view (should read `technical.rsi`, `canonical.signal_ar`, `canonical.accumulation`)
  4. Investment guide (should read `canonical.signal_ar`, `canonical.money_flow`)
  5. Smart analysis (should read `canonical.signal_ar`, `canonical.phase`, `radar.path`)
