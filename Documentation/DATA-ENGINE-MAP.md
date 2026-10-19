# DATA-ENGINE-MAP.md — Data Engine Audit (DATA-ENGINE-AUDIT-1)

> **Task:** DATA-ENGINE-AUDIT-1 (read-only audit — no fixes)
> **Agent:** Bravo
> **Scope:** data_engine/ + db/ + vps-service/data/ (READ ONLY)
> **Date:** 2026-10-18

---

## 1. Data Engine Service (port 5000)

**Entry point:** `data_engine/main.py` (1,165 lines, Flask app)

### Endpoints (18):
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | root |
| `/health` | GET | health check |
| `/status` | GET | scraper status |
| `/stats` | GET | stats |
| `/logs` | GET | logs |
| `/market-status` | GET | market open/close |
| `/trigger/stocks` | POST | trigger stock scrape |
| `/trigger/crypto` | POST | trigger crypto scrape |
| `/trigger/metals` | POST | trigger metals scrape |
| `/trigger/news` | POST | trigger news scrape |
| `/trigger/sync` | POST | trigger sync |
| `/trigger/all` | POST | trigger all scrapers |
| `/trigger/historical` | POST | trigger historical backfill |
| `/control/start` | POST | start engine |
| `/control/stop` | POST | stop engine |
| `/control/toggle/<scraper>` | POST | toggle scraper |
| `/control/clear-logs` | POST | clear logs |

### Core modules:
| File | Size | Purpose |
|------|------|---------|
| `main.py` | 1,165 lines | Flask app + endpoints + scheduler |
| `sync.py` | 32,941 bytes | `sync_current_prices()` + `sync_historical_prices()` + `sync_crypto_prices()` + `sync_metals_prices()` + `run_full_sync()` |
| `realtime_sync.py` | 7,962 bytes | webhook notifications to Next.js (`notify_nextjs()` + `post_scrape_hook()`) |
| `intraday_storage.py` | 45,710 bytes | stores tick data to `intraday.db` (stock/crypto/commodity) |

---

## 2. Scrapers (22 files in `data_engine/scrapers/`)

| Scraper | Source(s) | DB/Table written |
|---------|-----------|------------------|
| `crypto_fetcher.py` | CoinGecko | data_engine.db.crypto_prices + btc_local_prices |
| `egksco_scraper.py` | EGKSCO (egksco.com) | data_engine.db.egksco_price_history (DEPRECATED) |
| `egxpilot_scraper.py` | EGXPilot + TradingView + Yahoo | stocks.db.stocks |
| `fallback_chain.py` | EGKSCO + EGXPilot + TradingView + Yahoo | multi-source fallback |
| `historical_fetcher.py` | Yahoo | price_history.db.price_history |
| `historical_fetcher_5years.py` | Yahoo | price_history.db.price_history |
| `metals_forex_fetcher.py` | (metals/forex API) | data_engine.db.gold_prices + silver_prices + exchange_rates |
| `multi_market_scraper.py` | Forex | data_engine.db.exchange_rates |
| `news_scraper.py` | (news APIs) | news.db.market_news |
| `sharia_compliance_scraper.py` | (sharia sources) | data_engine.db.sharia_* |
| `technical_fetcher.py` | TradingView | data_engine.db.tab_technical_analysis |
| `tradingview_market_movers.py` | Investing + TradingView | stocks.db.stocks |
| `tradingview_rest.py` | TradingView | stocks.db.stocks |
| `tradingview_scraper.py` | EGXPilot + TradingView + Yahoo | stocks.db.stocks |
| `tradingview_screener_lists.py` | TradingView | data_engine.db.screener_lists |
| `update_fundamentals.py` | EGXPilot + TradingView | data_engine.db.tab_* (fundamentals) |
| `us_stock_scraper.py` | Yahoo | price_history.db.price_history (US stocks) |
| `yahoo_scraper.py` | EGXPilot + Yahoo | price_history.db.price_history |
| `auto_refresh_scheduler.py` | (scheduler) | N/A |
| `fetch_logos.py` | (logos) | stocks.db.stocks |
| `smart_scheduler.py` | (scheduler) | N/A |

---

## 3. DB Audit (read-only SELECT)

### stocks.db (68 tables)
| Table | Rows | Last Update | Notes |
|-------|------|-------------|-------|
| stocks | 1,240 | 2026-06-04 ⚠️ | **STALE** — last_updated column old |
| stock_daily_prices | 1,396,939 | 2026-10-18 ✅ | canonical (after price_unification) |
| market_indices | 5 | — | EGX30/70/100 |
| investors_data | 30 | 2026-09-26 ⚠️ | stale (scraper not running) |

### price_history.db (3 tables)
| Table | Rows | Last Update | Notes |
|-------|------|-------------|-------|
| price_history | 1,309,893 | 2026-10-18 ✅ | **CANONICAL** historical (DATA-LAYER-1) |
| screener_daily | 416 | 2026-08-23 ⚠️ | stale |

### data_engine.db (29 tables)
| Table | Rows | Last Update | Notes |
|-------|------|-------------|-------|
| egksco_price_history | 59,109 | 2026-10-18 | DEPRECATED (Rule 46 amended) |
| crypto_prices | 2,075,114 | 2026-10-18 14:53 ✅ | CoinGecko |
| btc_local_prices | 125,722 | 2026-10-18 14:50 ✅ | BTC in Arab currencies |
| gold_prices | 850,588 | 2026-10-18 14:54 ✅ | all karats + Arab countries |
| gold_prices_clean | 138,890 | 2026-10-18 14:54 ✅ | cleaned subset |
| silver_prices | 142,691 | 2026-10-18 14:54 ✅ | |
| exchange_rates | 144,963 | 2026-10-18 14:54 ✅ | forex |
| historical_data | 174,616 | 2026-10-15 ⚠️ | stale 3 days |
| egksco_stocks | 0 | — | **EMPTY** |
| tab_* (fundamentals) | 866 each | — | balance_sheet, income, cashflow, etc. |

### intraday.db (6 tables)
| Table | Rows | Last Update | Notes |
|-------|------|-------------|-------|
| stock_intraday | 46,278 | 2026-10-14 ⚠️ | **STALE 4 days** — intraday scraper not running |
| crypto_intraday | 702,486 | 2026-10-18 14:55 ✅ | 24/7 |
| commodity_intraday | 74,311 | 2026-10-18 14:54 ✅ | |

### predictions.db (46 tables)
| Table | Rows | Last Update | Notes |
|-------|------|-------------|-------|
| aiPrediction | 2,613 | 2026-10-11 ⚠️ | stale 7 days (V40.2 not running) |
| predictions | 1,491 | 2026-10-18 ✅ | |
| persona_predictions | 1,669 | 2026-08-30 ⚠️ | stale (disabled) |
| crypto_predictions_log | 187,345 | 2026-10-18 ✅ | |

### Other DBs
| DB | Table | Rows | Last Update | Notes |
|----|-------|------|-------------|-------|
| news.db | market_news | 1,019 | — ⚠️ | no date column |
| news.db | news_articles | 0 | — | **EMPTY** |
| metrics.db | resource_snapshot_5min | 0 | — | **EMPTY** |
| auth.db | User | 127 | 2026-10-03 ✅ | |
| historical.db | historical_prices | 73,526 | 2026-10-10 ⚠️ | stale 8 days |
| historical.db | daily_prices | 0 | — | **EMPTY** |
| crypto.db | cryptos | 0 | — | **EMPTY** |
| paper_trading.db | paper_trading_accounts | 2 | 2026-10-10 ✅ | |
| decision_log.db | decision_log | 208 | 2026-10-18 ✅ | |

---

## 4. Data Flow Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA ENGINE (port 5000)                       │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  scrapers/  │  │   sync.py    │  │  realtime   │  │  intraday │ │
│  │ (22 files)  │──│ (5 sync fns) │──│  _sync.py   │  │ _storage  │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └─────┬─────┘ │
└─────────┼─────────────────┼─────────────────┼───────────────┼──────┘
          │                 │                 │               │
          ▼                 ▼                 ▼               ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐
│  EXTERNAL       │ │   stocks.db  │ │ data_engine  │ │ intraday.db │
│  SOURCES        │ │              │ │     .db      │ │             │
│                 │ │ stocks       │ │ crypto_prices│ │ stock_      │
│ • TradingView   │ │ stock_daily  │ │ gold_prices  │ │  intraday   │
│ • Yahoo         │ │  _prices     │ │ exchange_    │ │ crypto_     │
│ • CoinGecko     │ │ market_index │ │  rates       │ │  intraday   │
│ • EGKSCO        │ │              │ │ egksco_      │ │ commodity_  │
│ • EGXPilot      │ │              │ │  price_hist  │ │  intraday   │
│ • Investing     │ │              │ │ (DEPRECATED) │ │             │
│ • Forex API     │ │              │ │              │ │             │
└─────────────────┘ └──────┬───────┘ └──────┬───────┘ └──────┬──────┘
                           │                │                │
                           ▼                ▼                ▼
                    ┌──────────────────────────────────────────────┐
                    │          CONSUMERS (vps-service/)             │
                    │                                              │
                    │  • lightweight_server.py (port 8010) — API   │
                    │  • daily_predictor.py → predictions.db       │
                    │  • telegram/auto_post_scheduler.py            │
                    │  • background_analyzer.py                     │
                    │  • hunting_engine.py (helpers)                │
                    └──────────────────────────────────────────────┘
```

### Per-domain flow:

**EGX Live prices:**
```
TradingView/EGXPilot → egxpilot_scraper.py → stocks.db.stocks (current_price)
                                          → intraday.db.stock_intraday (ticks)
```

**EGX Daily historical (CANONICAL):**
```
Yahoo → historical_fetcher.py → price_history.db.price_history (1.3M rows)
                             → stocks.db.stock_daily_prices (replenished)
                             → V40.2 daily_predictor → predictions.db
                             → frontend
```

**Crypto:**
```
CoinGecko → crypto_fetcher.py → data_engine.db.crypto_prices (2M rows)
                             → data_engine.db.btc_local_prices
                             → intraday.db.crypto_intraday (ticks)
                             → frontend
```

**Gold/Metals:**
```
metals API → metals_forex_fetcher.py → data_engine.db.gold_prices (850K)
                                    → data_engine.db.gold_prices_clean
                                    → data_engine.db.silver_prices
                                    → intraday.db.commodity_intraday
                                    → frontend
```

**Forex:**
```
Forex API → multi_market_scraper.py → data_engine.db.exchange_rates (145K)
                                    → frontend
```

**News:**
```
news APIs → news_scraper.py → news.db.market_news (1,019 rows)
                            → frontend
```

---

## 5. Findings (no fixes — audit only)

### 🔴 STALE DATA (5 findings)

| # | DB.Table | Last Update | Stale by | Severity |
|---|----------|-------------|----------|----------|
| 1 | stocks.db.stocks | 2026-06-04 | ~4 months | 🔴 HIGH |
| 2 | intraday.db.stock_intraday | 2026-10-14 | 4 days | 🔴 HIGH |
| 3 | predictions.db.aiPrediction | 2026-10-11 | 7 days | 🟡 MEDIUM |
| 4 | data_engine.db.historical_data | 2026-10-15 | 3 days | 🟡 MEDIUM |
| 5 | historical.db.historical_prices | 2026-10-10 | 8 days | 🟡 MEDIUM |

### 🟡 DUPLICATION

| # | Issue | Status |
|---|-------|--------|
| 1 | egksco_price_history vs price_history | ✅ **NO mismatch** (100/100 sample match on 2026-10-18) |
| 2 | stocks.db.stock_daily_prices vs price_history.db | ✅ replenished (DATA-LAYER-1) |
| 3 | historical.db vs price_history.db | 🟡 overlap (historical.db = 73K rows, price_history = 1.3M) |

### 🟡 BROKEN/EMPTY TABLES (6)

| # | DB.Table | Rows | Issue |
|---|----------|------|-------|
| 1 | data_engine.db.egksco_stocks | 0 | EMPTY |
| 2 | news.db.news_articles | 0 | EMPTY (using market_news instead) |
| 3 | metrics.db.resource_snapshot_5min | 0 | EMPTY (metrics scraper not running) |
| 4 | metrics.db.resource_snapshot_1h | 0 | EMPTY |
| 5 | historical.db.daily_prices | 0 | EMPTY |
| 6 | crypto.db.cryptos | 0 | EMPTY |

### 🟡 BOTTLENECKS

| # | Issue | Impact |
|---|-------|--------|
| 1 | crypto_prices = 2M rows | queries may be slow without proper indexes |
| 2 | price_history = 1.3M rows | ✅ has indexes (ticker, date) |
| 3 | gold_prices = 850K rows | 🟡 may need partitioning |

### 🟡 SOURCES CONFLICT
- ✅ egksco vs price_history: **0 mismatches** in 100-sample (2026-10-18)
- 🟡 stocks.db.stocks.last_updated = 2026-06-04 → live prices may be stale

---

## 6. Summary

**Data Engine health:** ✅ **GOOD for crypto/gold/forex** (all fresh 2026-10-18), 🔴 **STALE for EGX live + intraday stocks**.

**Canonical sources (per DATA-LAYER-1 + this audit):**
- Stock historical: `price_history.db.price_history` ✅
- Stock live: `stocks.db.stocks` ⚠️ (stale)
- Stock intraday: `intraday.db.stock_intraday` ⚠️ (stale 4 days)
- Crypto: `data_engine.db.crypto_prices` ✅
- Gold: `data_engine.db.gold_prices` ✅
- Forex: `data_engine.db.exchange_rates` ✅

**Top 3 risks:**
1. 🔴 stocks.db.stocks last_updated = 2026-06-04 (4 months stale) — live prices may be wrong
2. 🔴 intraday.db.stock_intraday stale 4 days — intraday scraper not running
3. 🟡 predictions.db.aiPrediction stale 7 days — V40.2 daily_predictor not running

**No action taken** — audit only per mandate.
