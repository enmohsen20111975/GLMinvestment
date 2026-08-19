# P23-CRYPTO-LAB-FUSION — Work Record

**Task ID**: P23-CRYPTO-LAB-FUSION
**Agent**: full-stack-developer (subagent)
**Date**: 2026-07-30
**Parent task**: P23 (Crypto 24/7 Live Lab + Fix Lagging Indicators in Fusion Engine)

## Scope

Two-part task in `/home/z/my-project/vps-service/`:
1. **Task 2 — Crypto 24/7 Live Lab**: analyze BTC + ETH every 15 minutes (24/7, NOT gated by EGX market hours), log to `crypto_predictions_log` in `predictions.db`.
2. **Task 3 — Fix Lagging Indicators**: reduce MACD/SMA weights (lagging) and increase Volume Profile/Order Blocks/RSI divergence weights (leading) in the fusion engine.

## Files Created (1)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `vps-service/jobs/crypto_lab_scheduler.py` | ~530 | NEW — `CryptoLabScheduler` class. Fetches BTC+ETH OHLCV from CoinGecko (with `data_engine.db.crypto_prices` fallback), runs SMC + FusionEngineV20, logs to `crypto_predictions_log`. Singleton `get_crypto_lab_scheduler()`. Standalone `main()` for testing. |

## Files Modified (5)

| # | File | Changes |
|---|------|---------|
| 1 | `vps-service/jobs/market_scheduler.py` | Added `'crypto_lab': None` to `last_run` dict; added `run_crypto_lab()` method (15-min, 24/7); called from `tick()` in BOTH `trading_paused` branch AND end-of-tick block. |
| 2 | `vps-service/main.py` | Registered `CryptoLabScheduler` with central SchedulerManager via `register_interval('crypto_lab_15min', ..., seconds=900, trading_hours_only=False, timeout_seconds=120)`. Triggers initial run on boot. |
| 3 | `vps-service/analyzers/fusion_engine.py` | Rebalanced score POINTS: trend_up 30→21 (−30%), BOS 40→56 (+40%), sweep 35→49 (+40%), SMA20 fb 15→10 (−30%), vol 15→22 (+50%), RSI 15→20 (+30%), premium ±10→±15 (+50%). BigBeluga + Golden Pocket unchanged. Bilingual AR/EN comments explain lagging vs leading. |
| 4 | `vps-service/analyzers/master_analyzer.py` | MASTER_WEIGHTS rebalanced: smc 0.22→0.26 (+18%, capped from +40%), technical 0.06→0.042 (−30%), enhanced_indicators 0.04→0.024 (−40%), volume_profile 0.03→0.043 (+43%), timing 0.02→0.015 (−25%). Sum=1.014. Detailed comments document capping rationale. |
| 5 | `vps-service/analyzers/live_indicator_engine.py` | RSI divergence bonus +5 → +7 (+40%). Comment explains RSI divergence is a LEADING reversal-prediction indicator. |

## Key Decisions

1. **Crypto data source**: CoinGecko `/markets` + `/ohlc` (primary) → `data_engine.db.crypto_prices` (fallback). Verified reachable from sandbox (BTC=$64,810 + 180 4h candles). Per-candle volume synthesized as `24h_volume / 6` since CoinGecko's `/ohlc` endpoint returns OHLC without volume.

2. **Engine reuse (not LiveIndicatorEngine directly)**: `LiveIndicatorEngine` is tightly coupled to `stocks.db` schema (cached_analysis + stocks + stock_daily_prices tables). Rather than polluting stocks.db with crypto data, built `CryptoLabScheduler` to use the schema-agnostic `FusionEngineV20` + `calculate_smc_score` — the SAME engines `master_analyzer.py` uses for stocks. This gives crypto predictions the same V20 fusion quality without coupling to EGX DB schema. The scheduler still produces a prediction dict in the same shape as `LiveIndicatorEngine` output (signal, score, confidence, entry/target/stop).

3. **Score combination**: `final_score = fusion_score × 0.40 + smc_score × 0.60` — mirrors the 60/40 SMC/traditional blend in `master_analyzer.py` line 1879. Keeps crypto predictions consistent with stock predictions.

4. **Schedule integration**: registered via central SchedulerManager (preferred path — single APScheduler instance, no extra thread). Added `run_crypto_lab()` to MarketScheduler as fallback path that runs from `tick()` every 15 min (works even if SchedulerManager unavailable). `_should_run('crypto_lab', 15)` check prevents overlap.

5. **Weight budget for Task 3**: applied the task's requested % changes as closely as possible while keeping MASTER_WEIGHTS sum ≈ 1.0. Documented each capping decision (e.g., "task asked for +40% → 0.308, but capped at +18% to preserve sum budget"). Sum=1.014 is acceptable — scores can reach ~101.4/100, well within THRESHOLDS range (max=80 for STRONG_BUY).

6. **RSI divergence boost location**: applied in `live_indicator_engine.py` (where `detect_bullish_divergence` already exists with a +5 bonus). Boosted to +7. Cleanest place because `live_indicator_engine` is the per-tick live analyzer; boost applies to all live analyses (stocks + crypto via CryptoLabScheduler's RSI input).

7. **Bilingual comments**: all P23 comments are bilingual (Arabic + English) matching the surrounding code style. Each weight change has a clear "WHY" explanation referencing the lagging-vs-leading distinction.

## Verification

- `python3 -m py_compile` on all 6 modified/created files → EXIT=0 for all.
- `FusionEngineV20` with synthetic 150-candle uptrend + BOS signal → score=100.0 (STRONG_BUY) ✅
- `FusionEngineV20` without SMC (fallback) + low volume → score=36.0 (WAIT) ✅
- `MASTER_WEIGHTS` sum = 1.014 ✅
- `live_indicator_engine.calculate_live_score` source contains `is_bullish_div` and `score += 7` ✅
- `CryptoLabScheduler.run_once()` with mocked CoinGecko data → logged BTC + ETH predictions to `crypto_predictions_log` (verified DB rows) ✅
- `CryptoLabScheduler.run_once()` with rate-limited CoinGecko + empty data_engine.db → graceful skip with WARNING (no crash) ✅

## Golden Rules Respected

- Did NOT touch `.env`
- Did NOT touch `ecosystem.config.js`
- Did NOT modify `data_engine/sync.py` (P22 fix preserved)
- Used existing code patterns (SchedulerManager registration, singleton accessor, bilingual comments)
- `py_compile` verified on every modified file

## Deploy Notes

After `git push`, on the VPS:
1. `git pull origin main`
2. `pm2 restart python-backend` — picks up all 6 files
3. First cycle (within 15 min of restart): BTC + ETH predictions will appear in `crypto_predictions_log` table.
4. Verify with: `sqlite3 /home/z/my-project/db/predictions.db "SELECT symbol, signal, confidence, entry_price, created_at FROM crypto_predictions_log ORDER BY id DESC LIMIT 10;"`
5. The rebalanced fusion weights take effect immediately on the next analysis cycle for both stocks (EGX) and crypto (BTC/ETH). Expect: more weight on SMC + Volume Profile signals, less on MACD + SMA crossovers.

## Future Work (Out of Scope)

- Wire up the new MASTER_WEIGHTS `rsi_divergence` bucket (currently the boost is in `live_indicator_engine.py` as a +7 score bonus). A future task could extract RSI divergence into its own weighted component in the master_score formula.
- Add more coins to the Live Lab (currently BTC + ETH only — extending is trivial: add to `CRYPTO_LAB_COINS` dict in `crypto_lab_scheduler.py`).
- Add a UI panel for crypto predictions (frontend — separate task).
- Backtest the rebalanced fusion weights against historical crypto data to validate the lagging→leading shift improves win rate.
