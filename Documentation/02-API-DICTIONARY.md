# 02 — API Dictionary

> Every HTTP endpoint exposed by the Python backend (Flask).
> Part of Phase 7.4 architecture documentation.

## 1. Overview

The backend exposes ~80 endpoints across **5 domains**. All routes are
registered as Flask Blueprints in `vps-service/api/*.py` and mounted by
`vps-service/app.py` (the Flask entry point).

Endpoints are grouped by domain:

| Domain | # Endpoints | Primary Files |
|--------|-------------|---------------|
| **Market** | 12 | `public_routes.py`, `market_routes.py`, `market_master_endpoints.py`, `chart_routes.py` |
| **Predictions** | 14 | `prediction_tracking_routes.py`, `historical_predictions_v2_routes.py`, `ai_predictions_routes.py`, `picks_management_routes.py`, `stored_analysis_routes.py`, `v38_backtest_routes.py` |
| **Portfolio** | 10 | `portfolio_routes.py`, `risk_routes.py`, `top_performers_routes.py`, `sector_tracking_routes.py` |
| **Analysis** | 18 | `professional_analysis_routes.py`, `stock_analysis_routes.py`, `confluence_routes.py`, `screener_routes.py`, `advanced_screener_routes.py`, `scanner_routes.py`, `sniper_routes.py`, `v2_routes.py`, `unified_v2_routes.py`, `unified_learning_routes.py`, `regime_routes.py`, `persona_routes.py` |
| **Admin** | 8 | `admin_routes.py`, `admin_engine_settings_routes.py`, `optimizer_params_routes.py`, `learning_routes.py`, `notifications_routes.py`, `news_routes.py`, `reports_routes.py`, `notebook_routes.py`, `misc_routes.py`, `telegram_routes.py` |

---

## 2. Market Domain

### `GET /api/stocks`
- **File**: `vps-service/api/public_routes.py::get_stocks`
- **Auth**: None
- **Params**: `market` (optional — EGX, KSA, KSE, QSE)
- **Returns**: List of all stocks with current prices + indicators

### `GET /api/stocks/<ticker>`
- **File**: `vps-service/api/public_routes.py::get_stock`
- **Auth**: None
- **Returns**: Single stock detail (price, change, RSI, MA50, MA200, trend)

### `GET /api/stocks/<ticker>/history`
- **File**: `vps-service/api/public_routes.py::get_history`
- **Params**: `period` (1M/3M/6M/1Y/5Y), `interval` (1d/1w)
- **Returns**: OHLCV history for charting

### `GET /api/stocks/<ticker>/prices`
- **File**: `vps-service/api/public_routes.py::get_prices`
- **Returns**: Recent price ticks (last 100)

### `GET /api/stocks/<ticker>/local-history`
- **File**: `vps-service/api/public_routes.py::get_local_history`
- **Returns**: Local (cached) historical data

### `GET /api/market/overview`
- **File**: `vps-service/api/public_routes.py::market_overview`
- **Auth**: None
- **Params**: `market` (EGX, KSA, KSE, DFM, BSE, QSE, CRYPTO)
- **Cache**: ApiResponseCache TTL=300s (Phase 8.4), params=`{market or 'all'}`
- **Returns**: `{success, timestamp, data: {total_stocks, advancers, decliners, ...}, market_filter}`

### `GET /api/market/intraday-pressure`
- **File**: `vps-service/api/market_master_endpoints.py::intraday_pressure`
- **Auth**: None
- **Cache**: ApiResponseCache TTL=60s (Phase 8.4) — intraday data changes fast
- **Returns**: `{success, market, timestamp, cumulative_pressure: {total_buy_egp, total_sell_egp, net_pressure_egp, direction, buy_pct, sell_pct}, top_stocks: [{ticker, price, change_pct, buy_pct, sell_pct, net_pressure_egp, volume}]}`

### `GET /api/market/investor-flows`
- **File**: `vps-service/api/market_master_endpoints.py::investor_flows`
- **Auth**: None
- **Params**: `market` (defaults to EGX — other markets return `available: false`)
- **Cache**: ApiResponseCache TTL=300s (Phase 8.4), params=`{market}`
- **Returns**: `{success, market, available, date, total_buys_egp, total_sells_egp, total_net_egp, flows: {by_investor_type, by_nationality}, source}`

### `GET /api/market/metals-forex/summary`
- **File**: `vps-service/api/market_master_endpoints.py::metals_forex_summary`
- **Returns**: Gold (24/21/18 + gold pound) + USD/EGP, EUR/EGP, SAR/EGP exchange rates

### `GET /api/market/liquidity-radar`
- **File**: `vps-service/api/market_master_endpoints.py::liquidity_radar`
- **Returns**: Real liquidity radar — pre-surge + quiet accumulation signals

### `GET /api/market/indices`
- **File**: `vps-service/api/market_master_endpoints.py::indices_constituents`
- **Returns**: EGX30 / EGX70 / EGX100 constituents + last values

### `GET /api/sectors/tracking`
- **File**: `vps-service/api/sector_tracking_routes.py::get_sector_tracking`
- **Auth**: None
- **Params**: `market`, `with_rotation`, `with_stocks`, `sort`, `order`, `min_avg_change`, `heat_level`
- **Cache**: ApiResponseCache TTL=300s (Phase 8.4), params=ALL filter params
- **Returns**: `{success, market, sectors: [...], market_summary: {...}, rotation (optional), filters, cached, cache_ttl}`

### `GET /api/sectors/<sector_name>/stocks`
- **File**: `vps-service/api/sector_tracking_routes.py::get_sector_stocks`
- **Params**: `market`, `limit` (max 500), `sort`, `order`
- **Returns**: Stocks in the specified sector

---

## 3. Predictions Domain

### `GET /api/predictions`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Auth**: None
- **Params**: `ticker`, `date`, `signal`, `limit`
- **Returns**: List of predictions (filtered by V40.2 canonical)

### `GET /api/predictions/<ticker>`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Returns**: All predictions for a single ticker

### `POST /api/predictions/<id>/close`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Auth**: Admin
- **Body**: `exit_price`, `exit_date`, `exit_reason`
- **Returns**: Closed prediction

### `GET /api/predictions/v2/historical`
- **File**: `vps-service/api/historical_predictions_v2_routes.py`
- **Params**: `start_date`, `end_date`, `signal`, `min_evidence`
- **Returns**: Historical predictions with outcomes

### `GET /api/predictions/ai`
- **File**: `vps-service/api/ai_predictions_routes.py`
- **Returns**: AI-generated predictions (model v2)

### `GET /api/picks`
- **File**: `vps-service/api/picks_management_routes.py`
- **Params**: `date`, `market`, `persona`
- **Returns**: Top picks for a given date

### `GET /api/picks/morning-bell`
- **File**: `vps-service/api/picks_management_routes.py`
- **Returns**: Today's morning bell (top pick)

### `GET /api/stored-analyses`
- **File**: `vps-service/api/stored_analysis_routes.py`
- **Returns**: Stored analyses (used by Telegram auto-poster)

### `POST /api/v38-backtest/run`
- **File**: `vps-service/api/v38_backtest_routes.py`
- **Auth**: Admin
- **Body**: `ticker`, `start_date`, `end_date`, `params`
- **Returns**: Backtest results

### `GET /api/predictions/stats`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Params**: `start_date`, `end_date`
- **Returns**: Aggregated stats (win rate, PF, total predictions)

### `POST /api/predictions/<id>/outcome`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Auth**: Admin (called by daily_closer cron)
- **Body**: `exit_price`, `is_win`, `pnl_pct`, `r_multiple`
- **Returns**: Updated prediction with outcome

### `GET /api/predictions/lessons`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Returns**: Learned lessons (from prediction_lessons table)

### `GET /api/predictions/persona`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Params**: `persona` (gambler/balanced/conservative)
- **Returns**: Persona-filtered predictions

### `GET /api/predictions/export`
- **File**: `vps-service/api/prediction_tracking_routes.py`
- **Returns**: CSV export of predictions

---

## 4. Portfolio Domain

### `GET /api/portfolio`
- **File**: `vps-service/api/portfolio_routes.py`
- **Auth**: Required
- **Returns**: User's portfolio (positions, cash, equity, exposure)

### `POST /api/portfolio/position`
- **File**: `vps-service/api/portfolio_routes.py`
- **Auth**: Required
- **Body**: `ticker`, `quantity`, `entry_price`, `side`
- **Returns**: New position

### `DELETE /api/portfolio/position/<id>`
- **File**: `vps-service/api/portfolio_routes.py`
- **Auth**: Required
- **Returns**: Closed position

### `GET /api/portfolio/pnl-history`
- **File**: `vps-service/api/portfolio_routes.py`
- **Returns**: Daily PnL history (equity curve)

### `GET /api/portfolio/risk`
- **File**: `vps-service/api/risk_routes.py`
- **Returns**: Risk metrics (VaR, max drawdown, Sharpe)

### `GET /api/top-performers`
- **File**: `vps-service/api/top_performers_routes.py`
- **Params**: `period` (1D/1W/1M/3M/1Y)
- **Returns**: Top performing stocks

### `GET /api/portfolio/snapshot`
- **File**: `vps-service/api/portfolio_routes.py`
- **Returns**: Current portfolio snapshot (equity, exposure, PnL)

### `POST /api/portfolio/cash`
- **File**: `vps-service/api/portfolio_routes.py`
- **Body**: `amount`, `type` (deposit/withdraw)
- **Returns**: Updated cash balance

### `GET /api/portfolio/equity-curve`
- **File**: `vps-service/api/portfolio_routes.py`
- **Returns**: Equity curve (for charting)

### `GET /api/portfolio/positions/open`
- **File**: `vps-service/api/portfolio_routes.py`
- **Returns**: All open positions

---

## 5. Analysis Domain

### `GET /api/analyze/<ticker>`
- **File**: `vps-service/api/public_routes.py::analyze_stock`
- **Auth**: None
- **Params**: `intent` (live/daily/full/auto), `persona`
- **Cache**: AnalysisCache (per-ticker, TTL=60s) — see `core/cache_manager.py`
- **Returns**: `{success, ticker, signal, evidence, tech_score, entry, target, stop, proofs, persona_fit, ...}`

### `GET /api/analysis/professional/<ticker>`
- **File**: `vps-service/api/professional_analysis_routes.py`
- **Returns**: Professional-grade analysis (multi-timeframe + risk)

### `GET /api/analysis/stock/<ticker>`
- **File**: `vps-service/api/stock_analysis_routes.py`
- **Returns**: Standard stock analysis (technical + fundamental)

### `GET /api/indicators/<ticker>`
- **File**: `vps-service/api/public_routes.py::get_indicators`
- **Returns**: All technical indicators (RSI, MACD, MA, ATR, etc.)

### `GET /api/patterns/<ticker>`
- **File**: `vps-service/api/public_routes.py::detect_patterns`
- **Returns**: Detected candlestick + chart patterns

### `GET /api/fibonacci/<ticker>`
- **File**: `vps-service/api/public_routes.py::fibonacci_levels`
- **Returns**: Fibonacci retracement + extension levels

### `GET /api/timing/<ticker>`
- **File**: `vps-service/api/public_routes.py::get_timing`
- **Returns**: Timing analysis (entry/exit timing signals)

### `GET /api/live-analysis/<ticker>`
- **File**: `vps-service/api/public_routes.py::get_live_analysis`
- **Returns**: Live (real-time) analysis

### `GET /api/scan/live`
- **File**: `vps-service/api/public_routes.py::scan_live_opportunities`
- **Returns**: Live scan results (intraday)

### `GET /api/confluence/<ticker>`
- **File**: `vps-service/api/confluence_routes.py`
- **Returns**: Multi-factor confluence score

### `GET /api/screener`
- **File**: `vps-service/api/screener_routes.py`
- **Params**: `min_score`, `signal`, `sector`
- **Returns**: Screener results (filtered stocks)

### `GET /api/screener/advanced`
- **File**: `vps-service/api/advanced_screener_routes.py`
- **Params**: `filters` (JSON)
- **Returns**: Advanced screener results (multi-condition filters)

### `GET /api/scanner/sniper`
- **File**: `vps-service/api/sniper_routes.py`
- **Returns**: Sniper scanner results (high-precision picks)

### `GET /api/scanner/unified`
- **File**: `vps-service/api/scanner_routes.py`
- **Returns**: Unified scanner results (consolidates all scanners)

### `GET /api/v2/analyze/<ticker>`
- **File**: `vps-service/api/v2_routes.py`
- **Returns**: V2 analysis (newer engine output)

### `GET /api/unified-v2/<ticker>`
- **File**: `vps-service/api/unified_v2_routes.py`
- **Returns**: Unified V2 (merges V2 + professional + fundamental)

### `GET /api/regime`
- **File**: `vps-service/api/regime_routes.py`
- **Returns**: Current market regime (BULL/BEAR/SIDEWAYS/DEFENSIVE)

### `GET /api/persona/<ticker>`
- **File**: `vps-service/api/persona_routes.py`
- **Returns**: Persona classification for ticker (gambler/balanced/conservative)

---

## 6. Admin Domain

### `GET /api/admin/health`
- **File**: `vps-service/api/admin_routes.py`
- **Auth**: Admin
- **Returns**: System health (DB integrity, engine status, queue depth)

### `GET /api/admin/engines`
- **File**: `vps-service/api/admin_engine_settings_routes.py`
- **Returns**: Engine settings (buy_threshold, regime config, etc.)

### `POST /api/admin/engines/<engine>`
- **File**: `vps-service/api/admin_engine_settings_routes.py`
- **Auth**: Admin
- **Body**: `key`, `value`
- **Returns**: Updated engine setting

### `GET /api/optimizer/params`
- **File**: `vps-service/api/optimizer_params_routes.py`
- **Returns**: Current optimizer parameters

### `POST /api/optimizer/params`
- **File**: `vps-service/api/optimizer_params_routes.py`
- **Auth**: Admin
- **Body**: `param_name`, `value`, `ab_group` (A/B testing)
- **Returns**: Updated parameter

### `GET /api/learning/lessons`
- **File**: `vps-service/api/learning_routes.py`
- **Returns**: Learned lessons (from learning_engine)

### `POST /api/learning/lessons`
- **File**: `vps-service/api/learning_routes.py`
- **Auth**: Admin
- **Body**: `lesson_text`, `category`, `confidence`
- **Returns**: New lesson

### `GET /api/notifications`
- **File**: `vps-service/api/notifications_routes.py`
- **Auth**: Required
- **Returns**: User notifications

### `GET /api/news`
- **File**: `vps-service/api/news_routes.py`
- **Params**: `ticker`, `category`, `limit`
- **Returns**: News articles (from news.db.market_news)

### `GET /api/reports/<type>`
- **File**: `vps-service/api/reports_routes.py`
- **Params**: `start_date`, `end_date`
- **Returns**: Generated report (HTML/JSON)

### `GET /api/notebook/<ticker>`
- **File**: `vps-service/api/notebook_routes.py`
- **Returns**: Jupyter notebook for ticker analysis

### `POST /api/telegram/test`
- **File**: `vps-service/api/telegram_routes.py`
- **Auth**: Admin
- **Body**: `message`
- **Returns**: Test message send status

### `GET /api/admin/db-health`
- **File**: `vps-service/api/admin_routes.py`
- **Auth**: Admin
- **Returns**: DB health check for all 9 databases

---

## 7. Auth Middleware

Authentication is enforced by `vps-service/core/auth_middleware.py` which
decorates protected endpoints:

```python
from core.auth_middleware import require_auth, require_admin

@public_bp.route('/api/portfolio', methods=['GET'])
@require_auth
def get_portfolio():
    user = request.user  # injected by middleware
    ...
```

JWT tokens are validated against `auth.db.Session`. Admin role is checked
via `auth.db.User.role`.

---

## 8. Caching Layer (Phase 8.4)

Two caches work together:

1. **AnalysisCache** (per-ticker, TTL=60s) — caches analysis results from
   the DecisionRouter. Lives in `core/cache_manager.py` as `analysis_cache`.

2. **ApiResponseCache** (per-endpoint, TTL=60-300s) — caches full HTTP
   responses. Lives in `core/cache_manager.py` as `api_cache`. Currently
   applied to 4 endpoints:
   - `/api/market/overview` (TTL=300s)
   - `/api/market/intraday-pressure` (TTL=60s)
   - `/api/market/investor-flows` (TTL=300s)
   - `/api/sectors/tracking` (TTL=300s)

Cached responses include `cached: true/false` and `cache_ttl` so clients
can show freshness.

---

## 9. See Also

- `01-DATABASES-COMPLETE.md` — every DB these endpoints read from
- `03-HOW-IT-THINKS.md` — system flow (which engines feed which endpoints)
- `04-ENGINES-ARCHITECTURE.md` — the 4 engines behind these endpoints
- `vps-service/app.py` — the Flask entry point that mounts all blueprints
