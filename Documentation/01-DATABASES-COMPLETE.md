# 01 — Databases Complete Reference

> **Single source of truth** for every SQLite database in the project.
> Generated as part of Phase 7.4 architecture documentation.

## 1. Overview

The project uses **9 SQLite databases** (plus 2 utility DBs) stored in `/db/`.
All access is routed through the central DAL (`vps-service/core/db_manager.py` —
see §11). Direct `sqlite3.connect()` calls are an architectural violation
flagged by `scripts/check_architecture.py`.

| # | Database | Path | Primary Use |
|---|----------|------|-------------|
| 1 | stocks.db | `db/stocks.db` | Stock master + daily prices + indices |
| 2 | predictions.db | `db/predictions.db` | All prediction/trade/portfolio data |
| 3 | price_history.db | `db/price_history.db` | Canonical 1.4M-row historical prices |
| 4 | data_engine.db | `db/data_engine.db` | Scraped EGX prices + metals + forex |
| 5 | intraday.db | `db/intraday.db` | Intraday OHLCV (5-min bars) |
| 6 | auth.db | `db/auth.db` | User accounts + subscriptions |
| 7 | crypto.db | `db/crypto.db` | Crypto watchlist + portfolio |
| 8 | crypto_learning.db | `db/crypto_learning.db` | Crypto prediction learning |
| 9 | news.db | `db/news.db` | News articles + market_news |
| - | metrics.db | `db/metrics.db` | (Utility) system metrics |
| - | custom.db | `db/custom.db` | (Utility) custom user data |

---

## 2. stocks.db — Stock Master

The canonical stock universe + market data. **Read by**: every analyzer,
every API endpoint serving stock data, every job that picks tickers.

### Tables (33)

| Table | Purpose |
|-------|---------|
| `stocks` | Master stock list — ticker, name, sector, market, is_active, current_price, change_percent, market_cap, avg_volume, rsi, ma_50, ma_200, high_52w, low_52w, trend |
| `stock_daily_prices` | Daily OHLCV per ticker (legacy fallback when price_history.db unavailable) |
| `stock_price_history` | Older price-history table (legacy) |
| `egksco_price_history` | EGX scraper output (legacy — was PRIMARY before price_history.db) |
| `egksco_stocks` | EGX official stock list |
| `egksco_sync_status` | Last-sync timestamps for the EGX scraper |
| `market_indices` | EGX30 / EGX70 / EGX100 constituent lists + last values |
| `market_regime_log` | Regime engine log (BULL / BEAR / SIDEWAYS / DEFENSIVE) |
| `learned_lessons` | Lessons extracted from past predictions |
| `indicator_trust_scores` | Per-indicator trust scores (e.g., RSI=0.62, MACD=0.71) |
| `indicator_weights` | Per-indicator weights used by master analyzer |
| `regime_indicator_weights` | Regime-specific weights (different in BULL vs BEAR) |
| `conjunction_patterns` | Learned multi-indicator conjunction patterns |
| `predictions` | (Older predictions table — predictions.db is canonical now) |
| `prediction_logs` | Per-prediction action log |
| `outcome_logs` | Per-prediction outcome (win/loss + PnL) |
| `signal_logs` | Raw signal log (every BUY/SELL signal emitted) |
| `screener_results` | Screener results cache |
| `maestro_personas` | Per-ticker persona classification (gambler/balanced/conservative) |
| `morning_reports` | Daily morning report snapshots |
| `news`, `news_items`, `telegram_news` | News tables (now superseded by news.db) |
| `analytics_events` | Frontend analytics events |
| `context_logs` | Analysis context log (debugging) |
| `cached_analysis` | Cached analysis results (per-ticker) |
| `portfolio_assets`, `financial_obligations`, `financial_transactions`, `obligation_payments` | Portfolio + financial tracking |
| `user_stock_watchlists` | User-specific watchlists |
| `gold_prices` | Gold prices (now canonical in data_engine.db) |
| `stocks_backup` | Backup of stocks table (recovery) |
| `ExpertRecommendation` | Expert-curated recommendations |

### Key Columns in `stocks`

| Column | Type | Notes |
|--------|------|-------|
| `ticker` | TEXT PK | e.g., "COMI", "TMGH" |
| `name` / `name_ar` | TEXT | English + Arabic name |
| `market` | TEXT | "EGX" / "TADAWUL" / "KSE" / "QSE" / "DFM" / "BSE" |
| `sector` | TEXT | Sector name (e.g., "Banking") |
| `is_active` | INTEGER | 1 = active, 0 = purged/deactivated (corrupted tickers) |
| `current_price` | REAL | Latest close |
| `change_percent` | REAL | Today's % change |
| `volume` / `avg_volume` | REAL | Today's volume / 30-day avg |
| `market_cap` | REAL | Market capitalization (EGP) |
| `rsi`, `ma_50`, `ma_200` | REAL | Technical indicators (updated by daily_closer) |
| `high_52w`, `low_52w` | REAL | 52-week high/low |
| `trend` | TEXT | "UPTREND" / "DOWNTREND" / "SIDEWAYS" |

### Filtering Rule (Project-Wide)

**ALL reads from `stocks` MUST filter `WHERE is_active = 1`** (or
`is_active IS NULL` for backward compat with rows that haven't been
migrated). This is enforced by the DAL — the `db_manager.query()` shortcut
doesn't automatically inject it, but the EGX gate (`utils/egx_gate.py`) does.

---

## 3. predictions.db — Prediction Engine

The canonical store for every prediction, trade, portfolio position, and
learning signal. **Written by**: `daily_predictor.py`, `daily_closer.py`,
`learning_engine.py`. **Read by**: every API endpoint serving predictions.

### Tables (43 — main ones)

| Table | Purpose |
|-------|---------|
| `predictions` | **Canonical predictions table**. Columns: id, ticker, signal, prediction_date, kill_filter_result, evidence, tech_score, entry, target, stop, exit_price, exit_date, exit_reason, return_pct, is_win, pnl_pct, r_multiple_actual, persona_fit, persona_fit_scores, proofs, liquidity_type, liquidity_score, liquidity_pos_mult, liquidity_hold_mult, position_size_mult, volatility_class, atr_pct |
| `persona_predictions` | Per-persona predictions (separate from main predictions; same ticker = one trade, but persona-annotated) |
| `prediction_outcomes` | Outcome tracking per prediction_id |
| `prediction_outcomes_old` | Legacy outcomes (pre-2026-08) |
| `prediction_lessons` | Lessons learned from each prediction outcome |
| `stored_analyses` | Stored analysis results (used by auto_poster / Telegram) |
| `analysis_jobs` | Job queue for async analyses |
| `analysis_engine_status` | Per-engine status (running/idle/last_run) |
| `morning_bell_signals` | Top pick per day (= predictions[0] for each date) |
| `live_ai_signals` | Live AI signals (intraday) |
| `sniper_performance` | Sniper engine performance tracking |
| `hunter_pick_tracking` | Hunter pick tracking |
| `liquidity_backtest_results` | Liquidity analyzer backtest results |
| `liquidity_dynamic_threshold` | Dynamic thresholds (regime-aware) |
| `liquidity_signal_outcomes` | Liquidity signal outcome tracking |
| `portfolio_positions` | Open positions |
| `portfolio_pnl_history` | Daily PnL snapshot |
| `portfolio_state` | Portfolio state snapshot (cash, equity, exposure) |
| `portfolios` | Portfolio definitions |
| `equity_snapshots` | Daily equity curve |
| `historical_trades` | Closed trades (for backtesting) |
| `exit_notifications` | Exit-triggered notifications |
| `cash_transactions` | Cash in/out transactions |
| `corporate_actions` | Dividends, splits, etc. |
| `crypto_predictions` / `crypto_predictions_log` / `crypto_lessons` | Crypto predictions (separate from stock predictions) |
| `aiPrediction` / `aiPredictionStats` | AI model predictions + stats |
| `expert_recommendation` | Expert-curated recommendations (mirror of stocks.db) |
| `learned_lessons` | Lessons learned (mirror of stocks.db) |
| `optimizer_params_history` | Optimizer parameter history (A/B testing) |
| `quant_cache` | Quant-computed cache (factor scores, etc.) |
| `reports` | Generated reports (HTML/JSON) |
| `session_events` / `session_event_sent_log` | Session events + sent-to-Telegram log |
| `stock_stories` | Per-ticker narrative (for reports) |
| `telegram_news` / `telegram_signals` | Telegram messages sent + signals |
| `trade_journal_entries` | User trade journal entries |
| `cached_analysis` | Cached analyses (mirror of stocks.db) |

### V40.2 Predictions — Canonical

The ONLY sanctioned predictions have `kill_filter_result LIKE 'V40 evidence%'`.
These are written by `daily_predictor.py` (the V40.2 engine). Any other
predictions are considered rogue and are NOT shown to users.

**`delete_old_v40_predictions()` is DISABLED** (Rule 35 + Rule 27) — V40.2
predictions must NEVER be deleted. The dead-code path is preserved in
`predictor_modules/cleanup.py` for audit trail only.

---

## 4. price_history.db — Canonical Historical Prices

The **single source of truth** for OHLCV price history. Consolidated from
multiple legacy sources (egksco, stocks.db.stock_daily_prices, Yahoo, etc.)

### Tables (2)

| Table | Rows | Purpose |
|-------|------|---------|
| `price_history` | ~1.4M | Canonical OHLCV. Columns: ticker, date, open_price, high_price, low_price, close_price, volume |
| `sqlite_sequence` | - | SQLite internal autoincrement counter |

### Why It's Canonical

- 1,557 unique tickers (EGX + TADAWUL + KSE + QSE + indices)
- Date range: 2000-01-01 to present
- No duplicates (post-cleanup)
- All engines query this DB first; legacy sources are fallback only

The `pre_cache_price_history()` function in `predictor_modules/price_cache.py`
batch-queries this DB for ALL tickers at once (180x speedup vs per-ticker).

---

## 5. data_engine.db — Scraper Output

Real-time data from scrapers (EGX official + TradingView + metals + forex).

### Tables (19)

| Table | Purpose |
|-------|---------|
| `stock_prices` | Real-time stock prices (from TradingView) |
| `historical_data` | Historical daily OHLCV (from Yahoo/TradingView) |
| `gold_prices` / `gold_prices_clean` | Gold prices (XAU/EGP) — CANONICAL |
| `silver_prices` | Silver prices |
| `btc_local_prices` | BTC/EGP local prices |
| `crypto_prices` | Crypto prices |
| `exchange_rates` | USD/EGP, EUR/EGP, SAR/EGP |
| `lost_and_found` | Orphaned rows (data hygiene) |
| `egksco_price_history` | (Mirror of stocks.db) |
| `investors_data` | Official EGX investor flows disclosure (Arab/Foreign/Individuals) |
| `egksco_indices` | EGX indices values |
| `egksco_index_constituents` | Index constituent lists |
| `egksco_top_stocks` | Daily top gainers/losers |
| ... | (9 more utility tables) |

### Investor Flows — Official Source

`investors_data` is the **official** EGX disclosure of investor flows
(individuals / Arabs / foreigners buys + sells + net). The
`/api/market/investor-flows` endpoint reads from this table (not from
`egksco_price_history` which was the legacy buggy source).

---

## 6. intraday.db — Intraday OHLCV

5-minute bar data for stocks, crypto, and commodities.

### Tables (4)

| Table | Purpose |
|-------|---------|
| `stock_intraday` | 5-min bars for EGX stocks |
| `crypto_intraday` | 5-min bars for crypto |
| `commodity_intraday` | 5-min bars for gold/silver/oil |
| `intraday_meta` | Last-bar timestamp per ticker (used for staleness checks) |

The `/api/market/intraday-pressure` endpoint reads from this DB (cached for
60s — see `ApiResponseCache` in `core/cache_manager.py`).

---

## 7. auth.db — Authentication & Subscriptions

User accounts, sessions, subscriptions, posts, expert recommendations.

### Tables (13)

| Table | Purpose |
|-------|---------|
| `User` | User accounts (email, hashed password, role) |
| `Account` | OAuth accounts (Google, Apple) |
| `Session` | Active sessions (JWT tokens) |
| `SubscriptionPlan` | Available plans (Free / Pro / Premium) |
| `UserSubscription` | Active subscriptions per user |
| `PromoCode` / `PromoRedemption` | Promo codes + redemptions |
| `Post` | User-generated posts |
| `ExpertRecommendation` | Expert-curated stock picks |
| `ExpertTrackRecord` | Expert performance track record |
| ... | (4 more auth-related tables) |

---

## 8. crypto.db — Crypto Universe

Crypto watchlist + portfolio + prediction logs.

### Tables (4)

| Table | Purpose |
|-------|---------|
| `cryptos` | Crypto master (symbol, name, chain, contract) |
| `crypto_watchlist` | User crypto watchlists |
| `crypto_portfolio` | User crypto holdings |
| `crypto_prediction_logs` | Crypto prediction outcomes |

---

## 9. crypto_learning.db — Crypto Prediction Learning

Lessons learned from crypto prediction outcomes.

### Tables

(Private to `learning_engine.py` — used for crypto-specific A/B testing
and parameter tuning.)

---

## 10. news.db — News Aggregation

News articles from multiple sources (RSS + scraping + API).

### Tables (4)

| Table | Purpose |
|-------|---------|
| `market_news` | **Canonical** market news (used by news-agent + analyzers) |
| `news_articles` | Full-text news articles |
| `news_api_keys` | API keys for news sources (NewsAPI, etc.) |
| `sqlite_sequence` | SQLite internal |

### Why news.db is Canonical

Previously, `stocks.db.news` and `stocks.db.market_news` were used but those
were phantom tables (no data). As of DATA-ENGINE-UNIFY-1, all news reads
go to `news.db.market_news`. This is enforced in the DAL alias map:

```python
'news': DBPaths.NEWS_DB,  # was: STOCKS_DB (phantom — empty)
```

---

## 11. The DAL — `vps-service/core/db_manager.py`

The **single gateway** for every SQLite operation. All engines MUST use it.

### API

```python
from core.db_manager import db_manager

# Read (returns list of dicts)
rows = db_manager.query('stocks', "SELECT ticker, name FROM stocks WHERE is_active=1")

# Read one row
row = db_manager.query_one('predictions', "SELECT * FROM predictions WHERE id=?", (pid,))

# Write (returns rowcount)
affected = db_manager.execute('predictions',
    "UPDATE predictions SET status=? WHERE id=?",
    ('CLOSED', pid))

# Batch write
db_manager.execute_many('predictions',
    "INSERT INTO predictions (ticker, signal) VALUES (?, ?)",
    [('COMI', 'BUY'), ('TMGH', 'BUY')])

# Transaction (BEGIN/COMMIT/ROLLBACK)
with db_manager.transaction('predictions') as conn:
    conn.execute("INSERT INTO predictions (...) VALUES (...)", (...))
    conn.execute("UPDATE prediction_logs SET ... WHERE ...", (...))

# Connection context (for raw access — still WAL/busy_timeout/immutable)
with db_manager.connection('stocks', writable=False) as conn:
    cur = conn.cursor()
    cur.execute("SELECT ...")
    rows = cur.fetchall()

# Schema helpers
if db_manager.table_exists('stocks', 'predictions'):
    cols = db_manager.table_columns('stocks', 'predictions')
    db_manager.ensure_column('stocks', 'predictions', 'new_col TEXT DEFAULT NULL')

# Health check
health = db_manager.health_check('stocks')
# {'db': 'stocks', 'path': '...', 'ok': True, 'journal_mode': 'wal', ...}

# Stats
stats = db_manager.get_stats()
# {'reads': 12345, 'writes': 678, 'errors': 0}
```

### What the DAL Does For You

| Concern | DAL Behavior |
|---------|--------------|
| **WAL mode** | Auto-sets `journal_mode=WAL` on writable connections |
| **Busy timeout** | Auto-sets `busy_timeout=30000` (30s) on every connection |
| **Synchronous** | Auto-sets `synchronous=NORMAL` on writes (balance of speed/safety) |
| **WAL checkpoint** | Auto-runs `wal_checkpoint(PASSIVE)` after every write |
| **Readonly safety** | Opens with `mode=ro`; if WAL/-shm corrupted, falls back to `immutable=1` |
| **Foreign keys** | Auto-enables `foreign_keys=ON` on writable connections |
| **Connection lifecycle** | Auto-close in `finally` (no leaked connections) |
| **Thread safety** | Singleton; each `connection()` call opens a fresh thread-local conn |

### Singleton Pattern

`DBManager` uses double-checked locking (`__new__` + `_instance` +
`_instance_lock`) so every engine in every thread gets the SAME instance.
This is verified by `tests/test_architecture.py::test_db_manager_singleton`.

---

## 12. Architecture Enforcement

The `scripts/check_architecture.py` AST scanner enforces the DAL pattern:

- **CATEGORY B (VIOLATION)**: direct `sqlite3.connect()` in normal code path
  → blocks commit via `.git/hooks/pre-commit`
- **CATEGORY A (WARNING)**: `sqlite3.connect()` inside `except` block
  → safety fallback (allowed, logged for audit)
- **Whitelist** (5 files allowed to call sqlite3 directly):
  - `vps-service/core/db_manager.py` (the DAL itself)
  - `vps-service/core/database.py` (legacy DAL — backward compat)
  - `vps-service/lightweight_server.py` (standalone server)
  - `vps-service/core/migrator.py` (schema migration tool)
  - `vps-service/jobs/wal_checkpoint.py` (WAL checkpoint utility)

Baseline (2026-10-23): 515 violations in vps-service/, 544 in scripts/.
The ratchet only allows the count to go DOWN as code is migrated.

---

## 13. DB Aliases (DAL Shorthand)

The DAL accepts short names that resolve to absolute paths via
`_DB_ALIASES`:

| Alias | Resolves To |
|-------|-------------|
| `stocks` | `db/stocks.db` |
| `predictions` | `db/predictions.db` |
| `price_history` | `db/price_history.db` |
| `data_engine` | `db/data_engine.db` |
| `intraday` | `db/intraday.db` |
| `auth` | `db/auth.db` |
| `crypto` | `db/crypto.db` |
| `crypto_learning` | `db/crypto_learning.db` |
| `news` | `db/news.db` |
| `telegram_data` | `db/stocks.db` (consolidated July 2026) |
| `analytics` | `db/stocks.db` (consolidated July 2026) |
| `gold_prices` | `db/data_engine.db` (canonical — was phantom `gold_prices.db`) |
| `historical` | `db/price_history.db` (fallback: predictions.db) |
| `community` | `db/stocks.db` (fallback: predictions.db) |

---

## 14. Cross-DB Joins

SQLite supports cross-database joins via `ATTACH DATABASE`. The DAL doesn't
expose this directly (it opens one connection per call), so cross-DB joins
must be done manually:

```python
with db_manager.connection('stocks', writable=False) as conn:
    conn.execute("ATTACH DATABASE ? AS predictions_db", (DBPaths.PREDICTIONS_DB,))
    rows = conn.execute("""
        SELECT s.ticker, s.name, p.signal, p.prediction_date
        FROM stocks s
        LEFT JOIN predictions_db.predictions p ON s.ticker = p.ticker
        WHERE s.is_active = 1
    """).fetchall()
```

---

## 15. Backup Strategy

- DBs are gitignored (`.gitignore`: `*.db`, `*.db-shm`, `*.db-wal`)
- Production DBs are backed up via `scripts/cleanup_db_architecture.py`
  (daily cron — writes ZIP to `db/*.db.zip`)
- WAL files (`-shm`, `-wal`) are NOT backed up — they're rebuilt on first
  connection
- `db_manager.health_check()` verifies integrity (`PRAGMA integrity_check`)

---

## 16. See Also

- `02-API-DICTIONARY.md` — every API endpoint that reads these DBs
- `03-HOW-IT-THINKS.md` — system flow (data engine → analyzer → predictor)
- `04-ENGINES-ARCHITECTURE.md` — the 4 engines + DAL + caching layer
- `05-DATA-ACCESS-LAYER-PLAN.md` — original DAL migration plan
