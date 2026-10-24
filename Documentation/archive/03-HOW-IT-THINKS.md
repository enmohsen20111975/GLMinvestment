# 03 — How It Thinks (System Flow)

> End-to-end pipeline: how raw market data becomes a BUY/SELL signal in
> the user's Telegram. Part of Phase 7.4 architecture documentation.

## 1. The 6-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 6 — TELEGRAM PUBLISHER (user-facing)                       │
│   • auto_poster.py — daily BUY picks                            │
│   • target_hit_tracker.py — exit notifications                  │
│   • interactive_bot.py — user queries                           │
└─────────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 5 — LEARNING ENGINE (feedback loop)                        │
│   • learning_engine.py — extracts lessons from outcomes         │
│   • Updates indicator_weights, regime_indicator_weights          │
└─────────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4 — DAILY PREDICTOR (V40.2)                                │
│   • daily_predictor.py — generates predictions for every ticker │
│   • daily_closer.py — closes stale predictions + sets outcomes   │
└─────────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — MASTER ANALYZER (decision engine)                     │
│   • decision_router.py — picks the right engine per intent       │
│   • Engines: V20 Fusion, V38 Backtest, Master Analyzer, etc.     │
└─────────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — DATA ACCESS LAYER (DAL)                                │
│   • db_manager.py — single gateway for all 9 DBs                │
│   • WAL + busy_timeout + immutable fallback                     │
└─────────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — DATA ENGINE (ingestion)                                │
│   • scrapers/egksco_scraper.py — official EGX data              │
│   • scrapers/tradingview_rest.py — TradingView prices            │
│   • scrapers/metals_forex_fetcher.py — gold + FX                │
│   • scrapers/news_scraper.py — news articles                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1 — Data Engine (Ingestion)

**Purpose**: Fetch raw market data from external sources and persist to DBs.

### Components (in `data_engine/`)

- `main.py` — orchestrator: runs all scrapers in sequence
- `scrapers/egksco_scraper.py` — official EGX website (stocks + investor flows + indices)
- `scrapers/tradingview_rest.py` — TradingView REST API (real-time prices)
- `scrapers/tradingview_scraper.py` — TradingView web scraper (fallback)
- `scrapers/historical_fetcher.py` — historical OHLCV (Yahoo/TV)
- `scrapers/historical_fetcher_5years.py` — 5-year backfill
- `scrapers/metals_forex_fetcher.py` — gold (XAU/EGP) + USD/EUR/SAR
- `scrapers/news_scraper.py` — RSS + web scraping for news
- `scrapers/update_fundamentals.py` — P/E, ROE, debt ratios
- `scrapers/us_stock_scraper.py` — US stocks (for cross-market analysis)
- `scrapers/sharia_compliance_scraper.py` — Sharia compliance flags
- `scrapers/fetch_logos.py` — company logos
- `scrapers/egx_investors_scraper.py` — official EGX investor flows (primary)
- `scrapers/egx_investors_beta_parser.py` — beta coefficients
- `scrapers/egx_indices_live.py` — live EGX30/70/100 values
- `scrapers/tradingview_market_movers.py` — top gainers/losers
- `scrapers/tradingview_screener_lists.py` — TradingView screener exports
- `scrapers/crypto_fetcher.py` — crypto prices
- `scrapers/fallback_chain.py` — multi-source fallback for any symbol

### Data Flow

```
External Sources (EGX website, TradingView, Yahoo, NewsAPI, ...)
        │
        ▼
   data_engine/main.py (orchestrator)
        │
        ├──► stocks.db (master + indicators)
        ├──► price_history.db (canonical OHLCV)
        ├──► data_engine.db (real-time + metals + forex)
        ├──► intraday.db (5-min bars)
        ├──► news.db (market_news)
        └──► auth.db (user accounts — only auth scraper writes here)
```

### Schedule (cron)

```
# Pre-market (06:00 Cairo) — full sync
0 6 * * 0-4   cd /home/z/my-project && .venv/bin/python3 data_engine/main.py >> logs/data_engine.log 2>&1

# Intraday (every 5 min during market hours 10:00-14:30)
*/5 10-14 * * 0-4   cd /home/z/my-project && .venv/bin/python3 data_engine/scrapers/tradingview_rest.py --intraday
```

---

## 3. Layer 2 — Data Access Layer (DAL)

**Purpose**: Single gateway for every SQLite operation.

**File**: `vps-service/core/db_manager.py`

### What It Does

- Opens every connection with WAL mode + busy_timeout=30000 + synchronous=NORMAL
- Auto-checkpoints WAL after every write
- Readonly connections use `mode=ro` with `immutable=1` fallback (bypasses WAL corruption)
- Thread-safe singleton (every engine shares one instance)

### Why It Exists

Before Phase 8, the project had ~100+ places doing `sqlite3.connect()` by hand. This caused:
- Database locking (concurrent connections without WAL/busy_timeout)
- Slow I/O (no connection reuse)
- Duplicated DB paths in every file (DRY violation)
- Hard to maintain (changing a DB path = editing 100 files)

The DAL solved all of these. It is enforced by `scripts/check_architecture.py`
(Phase 7.1) — any new direct `sqlite3.connect()` call is a CATEGORY B violation
that blocks commit.

See `01-DATABASES-COMPLETE.md` §11 for the full DAL API.

---

## 4. Layer 3 — Master Analyzer (Decision Engine)

**Purpose**: Take a ticker + intent, return a structured analysis (signal, entry, target, stop, evidence, persona_fit).

### Components

- `vps-service/core/analysis_runner.py` — orchestrator
- `vps-service/engines/decision_router.py` — picks the right engine per intent
- `vps-service/engines/master_analyzer.py` — the main analyzer
- `vps-service/engines/v20_fusion_engine.py` — V20 fusion (multi-factor)
- `vps-service/engines/v38_backtest_engine.py` — V38 backtest engine
- `vps-service/analyzers/*.py` — specialized analyzers (20+ files)

### Decision Flow (DecisionRouter)

```
analyze(ticker, intent='auto', persona='balanced')
    │
    ▼
DecisionRouter.route(ticker, intent, persona)
    │
    ├──► intent='live'    → V20FusionEngine (fast, real-time)
    ├──► intent='daily'   → MasterAnalyzer (full analysis, daily depth)
    ├──► intent='full'    → MasterAnalyzer + V38 Backtest (slowest, deepest)
    └──► intent='auto'    → pick based on market hours
                              (live during session, daily after close)

Result:
{
  'success': True,
  'ticker': 'COMI',
  'signal': 'BUY',  # BUY | STRONG_BUY | HOLD | SELL | INSTITUTIONAL_BUY
  'evidence': 5,  # 0-7 (count of confirmed signals)
  'tech_score': 78.5,  # 0-100
  'entry': 18.50,
  'target': 21.20,
  'stop': 17.40,
  'target_2': 24.50,  # extended target
  'atr': 0.45,
  'proofs': {
    'trend': '✅ Uptrend confirmed (MA50 > MA200)',
    'dna': '✅ Volume surge + accumulation pattern',
    'makers': '✅ Smart money net buying',
    'sector': '✅ Banking sector hot (+1.8%)',
    'fundamentals': '✅ P/E=8.2, ROE=22%, debt=15%',
  },
  'persona_fit': 'balanced',
  'fit_scores': {'gambler': 55.0, 'balanced': 75.0, 'conservative': 60.0},
  'liquidity_type': 'neutral',
  'liquidity_score': 65,
  'position_size_mult': 1.0,
  'volatility_class': 'NORMAL',
  'atr_pct': 2.4,
  'engine': 'master_analyzer',
  'intent': 'daily',
  'timing_ms': 145.2,
}
```

### Kill Filters (Hard Gates)

Before a BUY signal is emitted, multiple kill filters must pass:

1. **Liquidity filter** (`analyzers/liquidity_filter.py`) — minimum volume + turnover
2. **Sector heat filter** (`predictor_modules` + `load_sector_heat`) — reject if sector is falling
3. **Whale distribution guard** (`predictor_modules/whale_guard.py`) — block BUY if smart money is distributing
4. **Toxic ticker blocklist** (Rule 28) — skip known-bad tickers
5. **EGX canonical gate** (`utils/egx_gate.py`) — only EGX canonical tickers
6. **Regime filter** (DEFENSIVE → min_score=75, AGGRESSIVE → min_score=70)
7. **Persona fit** (optional — only if persona != 'balanced')

If ANY filter fails, the signal is downgraded to HOLD (or skipped entirely).

### AnalysisCache

Per-ticker analyses are cached for 60s (`analysis_cache` in `cache_manager.py`).
Same ticker + intent + persona within 60s = O(1) cache hit (no CPU spent).

---

## 5. Layer 4 — Daily Predictor (V40.2)

**Purpose**: For every ticker × every trading date, generate a prediction with entry/target/stop + simulated outcome.

**File**: `vps-service/jobs/daily_predictor.py` (4,717 LOC after Phase 7.2 + 8.2 extraction)

### Pipeline (run_generator)

```
1. Parse CLI args (--start, --end, --today-only, --yesterday-only, --dry-run)
2. get_scan_dates(start, end, scan_interval)
   → predictor_modules/scan_dates.py
   → tries price_history.db (PRIMARY), data_engine.db (fallback), stocks.db (fallback)
3. get_tickers(min_days, market_code)
   → queries price_history.db for tickers with >= MIN_TICKER_DAYS rows
   → filters through EGX gate (only canonical EGX tickers)
4. V38BacktestEngine setup (buy_threshold, market_regime, fundamentals, benchmark)
5. pre_cache_price_history(tickers, engine)
   → predictor_modules/price_cache.py
   → BATCH query price_history.db for ALL tickers at once (180x speedup)
6. For each ticker:
   a. engine.get_price_data(ticker) — uses pre-cached price data
   b. engine.analyze(ticker) — full V38 analysis
   c. Kill filters (liquidity + sector + whale + regime)
   d. If BUY: compute evidence + R-multiple + persona_fit
   e. Store signal in signals_by_date[scan_date]
7. For each scan_date:
   a. Sort signals by (evidence DESC, r_multiple DESC, tech_score DESC)
   b. Take top N = max_picks (default 5)
   c. Morning bell = picks[0]
   d. Regime-aware min_score filter (DEFENSIVE → 75, AGGRESSIVE → 70)
   e. Optional radar fallback (if DEFENSIVE regime and 0 picks)
   f. Store each pick to predictions.db.predictions
   g. Store morning bell to morning_bell_signals table
8. compute_and_save_summary()
   → predictor_modules/summary.py
   → Profit Factor, win rate, signal/evidence distributions
   → Saves JSON to vps-service/backtest_results/v40_2_generation_*.json
```

### Schedule

```
# Daily predictor (after market close + 30 min)
30 14 * * 0-4   cd /home/z/my-project && .venv/bin/python3 vps-service/jobs/daily_predictor.py --yesterday-only >> logs/v40_2_daily.log 2>&1
```

### Daily Closer

`vps-service/jobs/daily_closer.py` runs after the predictor:
- Finds predictions with exit_date <= today that haven't been closed
- Fetches actual exit price (from price_history.db)
- Computes PnL + R-multiple + is_win
- Updates predictions.exit_price, exit_date, exit_reason, return_pct, is_win, pnl_pct
- Triggers learning_engine to extract lessons

---

## 6. Layer 5 — Learning Engine

**Purpose**: Extract lessons from outcomes and update indicator weights.

**File**: `vps-service/jobs/learning_engine.py`

### Pipeline

```
For each closed prediction:
1. Read outcome (win/loss, PnL, R-multiple, exit_reason)
2. Read proofs (which signals fired: trend, dna, makers, sector, fundamentals)
3. Compute per-indicator performance:
   - For each indicator that fired: count wins vs losses
   - If indicator has > 60% win rate: increase its weight
   - If indicator has < 40% win rate: decrease its weight
4. Update stocks.db.indicator_weights
5. Update stocks.db.regime_indicator_weights (per-regime — BULL/BEAR/SIDEWAYS)
6. Extract lessons:
   - "When trend ✅ + sector ✅ + makers ✅ but fundamentals ❌ → 72% win rate"
   - "When sector ❌ → 38% win rate (below baseline)"
   - Save to predictions.db.prediction_lessons
7. Update indicator trust scores (stocks.db.indicator_trust_scores)
8. Discover conjunction patterns (stocks.db.conjunction_patterns)
```

### Schedule

```
# Learning engine (runs after daily_closer)
0 16 * * 0-4   cd /home/z/my-project && .venv/bin/python3 vps-service/jobs/learning_engine.py >> logs/learning.log 2>&1
```

### Feedback Loop

The weights learned in Layer 5 are read by Layer 3 (Master Analyzer) on its
next run. So the system gets smarter every day:

```
Day 1: Predict with weights v1
       → 100 predictions, 60 wins (60% WR)
Day 1 closer: Close predictions
Day 1 learning: Discover RSI win rate = 65%, MACD = 55%, sector = 70%
                Update weights: RSI ↑, MACD ↓, sector ↑
Day 2: Predict with weights v2
       → 100 predictions, 64 wins (64% WR)
...
```

---

## 7. Layer 6 — Telegram Publisher

**Purpose**: Deliver BUY/SELL signals to users via Telegram.

### Components (in `vps-service/telegram/`)

- `auto_poster.py` — daily BUY picks message (scheduled)
- `target_hit_tracker.py` — when a pick hits its target, send notification
- `telegram_notifier.py` — generic notification sender
- `telegram_interactive_bot.py` — user queries ("/analyze COMI")
- `auto_post_scheduler.py` — schedules messages for future delivery

### Daily Picks Message

```
🚀 توصيات اليوم — 2026-10-23

1. COMI (Commercial Intl Bank)
   🎯 دخول: 18.50 | هدف: 21.20 | وقف: 17.40
   📊 إثبات: 5/7 (تrend+DNA+Makers+Sector+Fundamentals)
   💪 Persona: متوازن (75%)
   🏦 القطاع: Banking (ساخن +1.8%)

2. TMGH (Talaat Moustafa Group)
   ...
```

### Filtering (Rule 28 + is_active)

The auto_poster reads from `predictions.db.stored_analyses` and filters:
- `is_active = 1` in stocks.db (skip purged/deactivated tickers)
- Persona filter (default: balanced)
- Date = today

If a ticker was purged (e.g., CPMEC, HBCOH after the great purge of 2026-10),
it won't appear in the message even if it has a stored analysis.

---

## 8. End-to-End Walkthrough

Let's trace a single BUY signal from raw data to user notification:

```
10:00 AM (market open)
├── data_engine/scrapers/tradingview_rest.py fetches COMI real-time price
│   └── writes to stocks.db.stocks (current_price=18.50, change_percent=+1.2%)
│
14:30 PM (market close)
├── data_engine/scrapers/egksco_scraper.py fetches official close
│   └── writes to price_history.db.price_history (COMI 2026-10-23 18.50)
│
15:00 PM (post-close)
├── vps-service/jobs/daily_predictor.py --yesterday-only runs
│   ├── get_scan_dates() → ['2026-10-23']
│   ├── get_tickers() → [COMI, TMGH, ETEL, ...]
│   ├── pre_cache_price_history() → batch-loads 289 tickers × 3 years
│   ├── For COMI:
│   │   ├── V38BacktestEngine.analyze('COMI')
│   │   │   ├── Reads cached prices from engine._price_cache
│   │   │   ├── Computes MA50 > MA200 (uptrend ✅)
│   │   │   ├── Detects volume surge (+180% vs 30d avg) ✅
│   │   │   ├── Smart money net buying ✅
│   │   │   ├── Sector: Banking +1.8% ✅
│   │   │   ├── Fundamentals: P/E=8.2, ROE=22% ✅
│   │   │   └── Returns signal=BUY, evidence=5, tech_score=78.5
│   │   ├── _whale_distribution_guard() → False (no distribution)
│   │   ├── _is_ticker_blocklisted('COMI') → False (not in blocklist)
│   │   ├── compute_persona_fit() → balanced (75%)
│   │   └── Signals: BUY, entry=18.50, target=21.20, stop=17.40
│   ├── Stored to predictions.db.predictions
│   └── Morning bell = COMI (highest evidence)
│
16:00 PM
├── vps-service/jobs/learning_engine.py runs
│   └── Updates indicator_weights based on today's outcomes
│
20:00 PM
├── vps-service/telegram/auto_poster.py runs (scheduled)
│   ├── Reads predictions.db.stored_analyses for today
│   ├── Filters is_active=1 (COMI is active)
│   ├── Builds message: "🚀 توصيات اليوم..."
│   └── Sends to Telegram channel
│
Next day 14:30 PM
├── vps-service/jobs/daily_closer.py runs
│   ├── Finds COMI prediction with exit_date=2026-10-24
│   ├── Reads price_history.db for COMI 2026-10-24 close (= 21.30)
│   ├── Updates prediction: exit_price=21.30, is_win=True, pnl_pct=+15.1%
│   └── Triggers learning_engine (next cycle)
│
20:00 PM
├── vps-service/telegram/target_hit_tracker.py runs
│   ├── Finds COMI hit its target (21.20) today
│   └── Sends: "🎯 COMI hit target! +15.1%"
```

---

## 9. Engine Hierarchy (Speed)

| Engine | Speed | Use Case |
|--------|-------|----------|
| V20 Fusion | ~50ms | Real-time (intent='live') |
| Master Analyzer | ~150ms | Daily depth (intent='daily') |
| V38 Backtest | ~500ms | Full backtest (intent='full') |
| Daily Predictor (full scan, 289 tickers) | ~5-15 min | Cron job |
| Learning Engine | ~30s | Cron job |

The `pre_cache_price_history()` batch query (Phase 8.2) reduced the daily
predictor from 225s → 1.4s for the price-loading phase — a 180x speedup.

---

## 10. See Also

- `01-DATABASES-COMPLETE.md` — every DB the system reads/writes
- `02-API-DICTIONARY.md` — every endpoint exposed
- `04-ENGINES-ARCHITECTURE.md` — the 4 engines + caching layer
- `vps-service/jobs/daily_predictor.py` — the predictor source
- `vps-service/jobs/predictor_modules/` — extracted modules (Phase 7.2 + 8.2)
