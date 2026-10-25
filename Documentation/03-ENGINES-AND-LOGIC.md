<div dir="rtl" lang="ar">

# 03 — المحركات والمنطق (Engines & Logic)

> **المصدر الموحّد للحقيقة:** الكود الفعلي فقط — `vps-service/engines/*.py` + `vps-service/analyzers/*.py` (119 ملف) + `vps-service/jobs/*.py` + `vps-service/core/*.py` + `grep` على الـ classes/functions.
> **آخر تحديث:** 2026-10-24 (إعادة كتابة شاملة بواسطة Bravo+GLM).
> **القاعدة الحاكمة:** Rule 21 — V40.2 هو محرك التوقعات الإنتاجي الوحيد. Rule 20 — Python=Brain. Rule 67 — كل حساب له canonical file واحد.

---

## 📑 جدول المحتويات

1. [نظرة عامة (Overview)](#1-نظرة-عامة-overview)
2. [V40.2 — المحرك الإنتاجي الوحيد (Rule 21 + Rule 73)](#2-v402--المحرك-الإنتاجي-الوحيد-rule-21--rule-73)
3. [الـ 4 Logical Engines (Job + Analyzer + Learning + API)](#3-الـ-4-logical-engines-job--analyzer--learning--api)
4. [Master Analyzer — THE BRAIN](#4-master-analyzer--the-brain)
5. [V38 Backtest Engine](#5-v38-backtest-engine)
6. [Institutional Decision Engine — V40 (6 Proofs)](#6-institutional-decision-engine--v40-6-proofs)
7. [Liquidity Filter — Kill Gate](#7-liquidity-filter--kill-gate)
8. [Flow System — 4 طبقات](#8-flow-system--4-طبقات)
9. [Market Regime Engine — Minervini Stages](#9-market-regime-engine--minervini-stages)
10. [ATR Risk Engine + Stop Management](#10-atr-risk-engine--stop-management)
11. [Persona Engine — 7 شخصيات](#11-persona-engine--7-شخصيات)
12. [قائمة الـ 119 Analyzer](#12-قائمة-الـ-119-analyzer)
13. [قائمة الـ 15 Engine في `vps-service/engines/`](#13-قائمة-الـ-15-engine-في-vps-serviceengines)
14. [قائمة الـ 15 Job في `vps-service/jobs/`](#14-قائمة-الـ-15-job-في-vps-servicejobs)
15. [دورة حياة التوقع (Prediction Lifecycle)](#15-دورة-حياة-التوقع-prediction-lifecycle)
16. [نظام الـ Backtest](#16-نظام-الـ-backtest)
17. [إدارة المخاطر (Risk Management)](#17-إدارة-المخاطر-risk-management)
18. [Canonical Indicators (Rule 67) — 13 functions](#18-canonical-indicators-rule-67--13-functions)
19. [Kill Filters (Hard Gates)](#19-kill-filters-hard-gates)
20. [الـ 5 Pillars (Constitution §الـ 5 Pillars)](#20-الـ-5-pillars-constitution--الـ-5-pillars)
21. [Decision Flow النهائي](#21-decision-flow-النهائي)
22. [الأداء (Performance)](#22-الأداء-performance)

---

## 1. نظرة عامة (Overview)

الـ Backend في GLMinvestment مبني على **4 logical engines** بـ تتشارك common foundation (DAL + Enforcement Layer):

```
┌──────────────────────────────────────────────────────────────────────┐
│                        vps-service/                                  │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  JOB ENGINE   │  │  ANALYZER    │  │  LEARNING   │  │   API    │ │
│  │               │  │  ENGINE      │  │  ENGINE     │  │  ENGINE  │ │
│  │  • daily_     │  │              │  │              │  │          │ │
│  │    predictor  │  │  • master_   │  │  • learning_│  │  • Flask │ │
│  │  • daily_     │  │    analyzer  │  │    engine   │  │    app   │ │
│  │    closer     │  │  • V38 back- │  │  • weights  │  │  • 40+   │ │
│  │  • market_    │  │    test      │  │    updater  │  │    routes│ │
│  │    scheduler  │  │  • institut- │  │  • lesson   │  │  • cache │ │
│  │  • price_     │  │    ional     │  │    extractor│  │    layer │ │
│  │    history_*  │  │  • flow_     │  │              │  │          │ │
│  │  • intraday_* │  │    system    │  │              │  │          │ │
│  │  • fetch_corp │  │  • market_   │  │              │  │          │ │
│  │  • wal_check  │  │    regime    │  │              │  │          │ │
│  │               │  │  • 119       │  │              │  │          │ │
│  │               │  │    analyzers  │  │              │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
│         │                  │                │              │        │
│         └──────────────────┴────────────────┴──────────────┘        │
│                              │                                       │
│                              ▼                                       │
│              ┌──────────────────────────────────┐                     │
│              │   CORE — Data Access Layer       │                     │
│              │   • db_manager.py (singleton)     │                     │
│              │   • cache_manager.py              │                     │
│              │   • database.py (legacy DAL)     │                     │
│              │   • migrator.py                   │                     │
│              └──────────────────────────────────┘                     │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                ┌──────────────┴───────────────┐
                │   ENFORCEMENT LAYER            │
                │   • scripts/check_architecture│
                │   • tests/test_architecture    │
                │   • .git/hooks/pre-commit      │
                │   • .github/workflows/arch-*   │
                └────────────────────────────────┘
```

### الإحصائيات الكلية

| المقياس | القيمة |
|---|---|
| **عدد الـ Python files** | 227 ملف |
| **عدد الـ LOC** | 175,167 سطر |
| **عدد الـ engines في `vps-service/engines/`** | 15 ملف (بما فيهم `__init__.py`) |
| **عدد الـ analyzers في `vps-service/analyzers/`** | 119 ملف (117 ملف `.py` + `__init__.py` + `analyzer_modules/`) |
| **عدد الـ jobs في `vps-service/jobs/`** | 15 ملف |
| **عدد الـ core files** | 14 ملف |
| **عدد الـ canonical indicators** | 13 functions (Rule 67) |
| **عدد الأسواق المغطاة** | 5 (EGX + TADAWUL + KSE + QSE + US + Crypto + Gold) |
| **عدد الـ blueprints في lightweight_server.py** | 30+ |

### الـ 6 طبقات (Layers)

```
LAYER 6 — TELEGRAM PUBLISHER (user-facing)
    • auto_poster.py — daily BUY picks
    • target_hit_tracker.py — exit notifications
    • interactive_bot.py — user queries
                ▲
LAYER 5 — LEARNING ENGINE (feedback loop)
    • learning_engine.py — extracts lessons from outcomes
    • Updates indicator_weights, regime_indicator_weights, indicator_trust_scores
                ▲
LAYER 4 — DAILY PREDICTOR (V40.2)
    • daily_predictor.py — generates predictions for every ticker
    • daily_closer.py — closes stale predictions + sets outcomes
                ▲
LAYER 3 — MASTER ANALYZER (decision engine)
    • master_analyzer.py — the main analyzer
    • v38_backtest_engine.py — full backtest (intent='full')
    • institutional_decision_engine.py — V40 (6 proofs)
                ▲
LAYER 2 — DATA ACCESS LAYER (DAL)
    • db_manager.py — single gateway for all 9 DBs
    • WAL + busy_timeout + immutable fallback
                ▲
LAYER 1 — DATA ENGINE (ingestion)
    • 27 scrapers in data_engine/scrapers/
    • egksco, tradingview, yahoo, metals.dev, daleelak, ...
```

---

## 2. V40.2 — المحرك الإنتاجي الوحيد (Rule 21 + Rule 73)

### 2.1 — لماذا V40.2 وحده؟

القاعدة 21 صريحة: **V40.2 هو محرك التوقعات الإنتاجي الوحيد** (evidence-based). أي توقع BUY/STRONG_BUY لازم يمرّ بـ V40.2 pipeline. القاعدة 73 (SINGLE-DISPLAY-SOURCE) تكمل: كل شاشة بتعرض signal/master_score/RSI/support/resistance تقرأ من `/api/stocks/[ticker]/unified` (V40.2 output only).

> **⚠️ تحذير تاريخي (V4 ≠ V40):** "V4 كان بيدى أفضل نتائج" = **V40.2** (`jobs/v40_2_daily_generator.py`) — مش `ExpertMemoryV4`. خلط التسميتين كاد يحذف ميزة خاطئة.

### 2.2 — V40.2 Pipeline

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
9. _integrate_whale_radar_predictions() (WHALE_RADAR INTEGRATOR)
   → reads maker_radar_EGX_YYYYMMDD.json
   → filters: path=B_quiet_accumulation_strong + signals>=5 + turnover>=5M + no_distribution
   → INSERT into stored_analyses (signal='WHALE_RADAR_BUY')
   → sync_scanner_to_stored_analyses() → injects BUY picks only (rejects HOLD/ILLIQUID)
```

### 2.3 — V40.2 vs V40.1 (backtest comparison)

| المقياس | V40.1 | V40.2 | التحسّن |
|---|---:|---:|---|
| Profit Factor | 1.221 | **1.327** | +8.7% |
| Max Drawdown | 29.7% | **12.4%** | -58.2% |
| Win Rate (live production) | ~60% | **~69.2%** | +9.2pp |

### 2.4 — V40.2 changes vs V40.1

- **Strict kill-filter mode** (no market-open relaxation)
- **Real EGX30ETF benchmark** (loaded lazily by the engine)
- **Tightened entry conditions** (real benchmark + mapping fix + absorption 1.5)
- **`partial_exit_at_rr = 1.5`** (let winners run further)

### 2.5 — WHALE_RADAR INTEGRATOR (Hunter Mode — 2026-10-20)

| الإعداد | القيمة |
|---|---|
| **Output dir** | `scripts/output/maker_radar_EGX_YYYYMMDD.json` |
| **MIN_TURNOVER** | 5,000,000 EGP (EXPERIMENTAL — was 10M) |
| **MIN_SIGNALS** | 5 (5/6 or 6/6 signals verified) |
| **POSITION_SIZE** | 0.02 (2% of portfolio — strict risk management) |
| **MIN_RR** | 1.8 (per owner directive) |
| **persona** | `gambler` |
| **who_is_buying_state** | `WHALE_RADAR` |
| **Filters applied** | `path=B_quiet_accumulation_strong` + `signals>=5` + `turnover>=5M` + `no_distribution` |
| **Output** | INSERT into `stored_analyses` (signal='WHALE_RADAR_BUY') |

---

## 3. الـ 4 Logical Engines (Job + Analyzer + Learning + API)

### Engine 1 — Job Engine

| البند | القيمة |
|---|---|
| **Purpose** | Background cron jobs تشتغل على schedule |
| **Location** | `vps-service/jobs/` |
| **عدد الـ jobs** | 15 ملف |

**Components:**

| File | Purpose | Schedule |
|------|---------|----------|
| `daily_predictor.py` | V40.2 prediction generator (4,717 LOC after extraction) | Daily 14:30 |
| `daily_closer.py` | Closes stale predictions + sets outcomes | Daily 14:35 |
| `learning_engine.py` | Extracts lessons from outcomes | Daily 16:00 |
| `market_scheduler.py` | Orchestrates the daily market cycle | Continuous |
| `price_history_safetynet.py` | Backfills missing price data | Hourly |
| `price_history_stale_monitor.py` | Detects stale price data | Every 6h |
| `intraday_aggregator.py` | Aggregates 5-min bars → daily | Hourly |
| `intraday_scanner.py` | Scans for intraday signals | Every 5 min |
| `hot_candidate_detector.py` | Detects hot candidates (real-time) | Continuous |
| `fetch_corporate_actions.py` | Fetches dividends/splits | Weekly |
| `fetch_inflation_worldbank.py` | Inflation data from WorldBank | Monthly |
| `crypto_lab_scheduler.py` | Crypto prediction lab | Daily |
| `wal_checkpoint.py` | WAL checkpoint utility | Manual |
| `predictor_modules/` (folder) | 8 extracted modules (Phase 7.2 + 8.2 Strangler Pattern) | — |
| `closer_modules/` (folder) | 2 extracted modules | — |

#### Modularization Status (Phase 7.2 + 8.2)

`daily_predictor.py` كان mega-file (4,986 LOC). بعد Strangler Pattern extraction، 8 functions/blocks اتـ extracted لـ `predictor_modules/`:

**Phase 7.2 (5 modules):**

| Module | Function | الوظيفة |
|---|---|---|
| `persona_fit.py` | `compute_persona_fit()` | حساب ملاءمة الـ persona (balanced/gambler/conservative) |
| `whale_guard.py` | `_whale_distribution_guard()` | حماية من تصريف الحيتان (block BUY if smart money distributing) |
| `db_helpers.py` | `_open_db()` + `_V402_DBM_AVAILABLE` + `_dbm` | DB helpers للـ V40.2 |
| `scan_dates.py` | `get_scan_dates()` | حساب تواريخ الـ scan (PRIMARY: price_history.db) |
| `cleanup.py` | `delete_old_v40_predictions()` (DISABLED) | تنظيف التوقعات القديمة |

**Phase 8.2 (3 modules):**

| Module | Function | الوظيفة |
|---|---|---|
| `summary.py` | `compute_and_save_summary()` | Profit Factor + JSON save |
| `dry_run_printer.py` | `print_dry_run_summary()` | طباعة ملخص الـ dry-run |
| `price_cache.py` | `pre_cache_price_history()` | BATCH query price_history.db (180x speedup) |

**النتيجة:** `daily_predictor.py` = 4,986 → 4,717 LOC (-269 LOC, -5.4%). كل الـ 8 functions re-imported at the top عشان callers ما يحسوش بأي تغيير (Strangler Pattern = semantic equivalence).

#### `closer_modules/` (2 modules)

| Module | Function | الوظيفة |
|---|---|---|
| `atr_helpers.py` | ATR calculation helpers للـ daily_closer | حساب الـ ATR وقت الإغلاق |
| `pending_helpers.py` | helpers للـ pending predictions | معالجة التوقعات المعلّقة |

### Engine 2 — Analyzer Engine

| البند | القيمة |
|---|---|
| **Purpose** | Take a ticker + intent → return structured analysis |
| **Location** | `vps-service/engines/` (15 file) + `vps-service/analyzers/` (119 file) |
| **عدد الـ analyzers** | 117 ملف `.py` (plus `__init__.py` + `analyzer_modules/`) |

**Core Engines:**

| Engine | File | Speed | Use Case |
|--------|------|-------|----------|
| V40.2 (sole production engine) | `jobs/daily_predictor.py` | ~5-15 min (full scan, 289 tickers) | Cron job (Rule 21) |
| V38 Backtest Engine | `engines/backtest_engine.py` | ~500ms | Full backtest (intent='full') |
| Master Analyzer | `analyzers/master_analyzer.py` | ~150ms | Daily depth (intent='daily') |
| Institutional Decision Engine | `analyzers/institutional_decision_engine.py` | ~100ms | V40 (6 proofs + kill filters) |

### Engine 3 — Learning Engine

| البند | القيمة |
|---|---|
| **Purpose** | Extract lessons from prediction outcomes + update indicator weights |
| **Location** | `vps-service/jobs/learning_engine.py` |
| **Schedule** | Daily 16:00 (بعد الـ daily_closer) |

#### Feedback Loop

```
Closed prediction (with outcome)
    │
    ▼
1. Read outcome (win/loss, PnL, R-multiple, exit_reason)
2. Read proofs (which signals fired: trend, dna, makers, sector, fundamentals)
3. Per-indicator performance:
   - Win rate per indicator
   - Update stocks.db.indicator_weights
   - Update stocks.db.regime_indicator_weights (per-regime)
   - Update stocks.db.indicator_trust_scores
4. Extract lessons:
   - Save to predictions.db.prediction_lessons
   - Discover conjunction patterns (stocks.db.conjunction_patterns)
5. Master Analyzer reads new weights on next run → smarter predictions
```

#### Learning Tables (in `stocks.db`)

| Table | الوظيفة |
|---|---|
| `indicator_weights` | current weights (per indicator) |
| `regime_indicator_weights` | per-regime weights (BULL/BEAR/SIDEWAYS) |
| `indicator_trust_scores` | trust score (0-1) per indicator |
| `conjunction_patterns` | multi-indicator patterns |
| `learned_lessons` | extracted lessons |

#### Learning Tables (in `predictions.db`)

| Table | الوظيفة |
|---|---|
| `prediction_lessons` | per-prediction lessons |
| `learned_lessons_predictions` | mirror (legacy) |

### Engine 4 — API Engine

| البند | القيمة |
|---|---|
| **Purpose** | Expose HTTP endpoints for the frontend + mobile apps |
| **Location** | `vps-service/api/` + `vps-service/lightweight_server.py` (Flask) + `vps-service/main.py` (FastAPI) |
| **عدد الـ blueprints** | 30+ blueprint files (one per domain) |
| **عدد الـ routes** | 406+ endpoints |

#### Request Lifecycle

```
HTTP Request
    │
    ▼
Flask app (lightweight_server.py on port 8010)
    │
    ├──► Blueprint routing (api/<domain>_routes.py)
    │
    ├──► Auth middleware (core/auth_middleware.py)
    │    ├──► require_auth: validates JWT against auth.db.Session
    │    └──► require_admin: checks auth.db.User.subscription_tier
    │
    ├──► Cache check (core/cache_manager.py)
    │    ├──► AnalysisCache (per-ticker, 60s TTL)
    │    └──► ApiResponseCache (per-endpoint, 60-300s TTL)
    │
    ├──► Engine call (engines/decision_router.py)
    │
    ├──► DAL call (core/db_manager.py)
    │
    └──► JSON response (Flask jsonify)
```

---

## 4. Master Analyzer — THE BRAIN

| البند | القيمة |
|---|---|
| **File** | `vps-service/analyzers/master_analyzer.py` |
| **LOC** | 5,764 LOC |
| **Callers** | 25 (أعلى محرك استخدامًا) |
| **Status** | ⚠️ PARTIAL (بعض functions اتـ migrated لـ canonical indicators Rule 67) |
| **Speed** | ~150ms per ticker |
| **Use case** | Daily depth (intent='daily') |

### Golden Rules (8 قواعد داخل Master Analyzer)

| # | Rule | الوظيفة |
|---|------|---------|
| 1 | **Liquidity First** | Skip analysis if not tradeable — `liquidity_filter.py::LiquidityFilter` |
| 2 | **Market Regime Filter** | Adjust confidence based on market condition — `market_regime_engine.py` |
| 3 | **Sector-Relative Fundamentals** | Compare within sector — `sector_relative.py` |
| 4 | **Session Dynamics** | Not "best hours" — `session_timing.py` |
| 5 | **Unified Scoring** | Weighted combination — `core_scoring_engine.py` |
| 6 | **Strict Thresholds** | STRONG_BUY >= 55, BUY >= 50 (optimized: 61.5%/68.4% WR) |
| 7 | **Risk Profile** | Position, Stop, Target, Time for each signal |
| 8 | **Feedback Loop** | Learn from mistakes — `learning_engine.py` |

### Key Functions in `master_analyzer.py`

| Function | LOC | الوظيفة |
|---|---|---|
| `_parse_volume_float(v)` | 25 | parse "154.48\u202fK" → 154480.0 (Arabic TradingView format) |
| `_safe_div(a, b, default=1.0)` | 12 | Safe division — يمنع float division by zero |
| `_check_screener_stale()` | 50 | Check if screener data is stale (>24h) |
| `_trigger_screener_fetch_background()` | 40 | Trigger background refetch |
| `get_screener_tags(ticker, market)` | 200 | Get screener tags (valuation, profitability, ...) |
| `_ema_seeded(values, period)` | 12 | Seeded EMA (first value = SMA) |
| `_calc_macd(closes, fast=12, slow=26, signal=9)` | 25 | MACD calculation (legacy — canonical في `ma.py`) |
| `_detect_candlestick_patterns(ohlcv)` | 60 | 16 candlestick patterns |
| `_calc_fibonacci_levels(closes, highs, lows, lookback=30)` | 40 | Fibonacci retracement + extension |
| `class MasterAnalysis` | 800+ | التحليل الكامل (signal, entry, target, stop, proofs, ...) |
| `detect_who_is_buying(...)` | 280 | كشف من بـ يشتري (makers, institutions, retail) |
| `generate_analysis_reason(...)` | 120 | Arabic narrative explanation |
| `load_merged_history(ticker, db_path, limit=100)` | 700+ | **Rule 12 — المصدر الموحّد للأسعار**: يدمج price_history.db + stocks.db.stock_daily_prices + data_engine.db |
| `class MasterAnalyzer` | 3,800+ | THE BRAIN — main analyzer class |

### `MasterAnalyzer.analyze()` Pipeline

```
analyze(ticker, intent='daily', persona='balanced')
    │
    ▼
1. load_merged_history(ticker)
   → PRIMARY: stocks.db.stock_daily_prices
   → FALLBACK 1: data_engine.db.egksco_price_history
   → FALLBACK 2: price_history.db.price_history
    │
    ▼
2. Compute indicators (canonical — Rule 67):
   - calc_rsi(closes, period=14)
   - calc_atr(highs, lows, closes, period=14)
   - sma(closes, period=20/50/200)
   - ema(closes, period=12/26)
   - macd(closes, fast=12, slow=26, signal=9)
   - calc_bollinger_series(closes, period=20, std_dev=2.0)
   - calc_mfi(highs, lows, closes, volumes, period=14)
   - calc_adx(highs, lows, closes, period=14)
   - calc_vwap(...)
   - calc_volume_profile(closes, volumes)
    │
    ▼
3. Apply Golden Rules:
   - LiquidityFilter (kill gate 1)
   - MarketRegimeEngine (adjust confidence)
   - SectorRelativeAnalyzer (relative strength)
   - SessionTiming (entry timing)
   - CoreScoringEngine (unified score)
   - RiskManager (position, stop, target, time)
    │
    ▼
4. detect_who_is_buying()
   - Smart Money (SMC): OB + FVG + sweeps
   - Volume Profile: VWAP + OBV + accumulation/distribution
   - Whale distribution guard
    │
    ▼
5. Build proofs (6 institutional proofs):
   - Proof 1: Trend (MA50 > MA200)
   - Proof 2: Makers (smart money accumulation)
   - Proof 3: DNA (pattern matching)
   - Proof 4: Fundamentals (P/E, ROE, debt)
   - Proof 5: Sector (sector heat)
   - Proof 6: Benchmark (outperformance)
    │
    ▼
6. compute_tech_score()
   → weighted sum (8+26+8+8+8+24 = 82 weight total)
    │
    ▼
7. Apply thresholds:
   - STRONG_BUY >= 55
   - BUY >= 50
   - HOLD >= 40
   - SELL < 40
    │
    ▼
8. compute_persona_fit()
   - balanced: default
   - gambler: high-risk/high-reward preference
   - conservative: low-risk/stable preference
    │
    ▼
9. Return MasterAnalysis dict:
{
  'success': True, 'ticker': 'COMI', 'signal': 'BUY',
  'evidence': 5, 'tech_score': 78.5,
  'entry': 18.50, 'target': 21.20, 'stop': 17.40,
  'proofs': {...}, 'persona_fit': 'balanced',
  'fit_scores': {...}, 'engine': 'master_analyzer',
  'timing_ms': 145.2
}
```

---

## 5. V38 Backtest Engine

| البند | القيمة |
|---|---|
| **File** | `vps-service/engines/backtest_engine.py` |
| **LOC** | 2,375 LOC |
| **Callers** | 4 |
| **Status** | ✅ CORE |
| **Speed** | ~500ms per ticker |
| **Use case** | Full backtest (intent='full') |

### 9 Subsystems

| # | Subsystem | الوظيفة |
|---|---|---|
| 1 | **Data & Momentum Engine** | ATR, RSI, Bollinger Bands, Squeeze/Expansion detection |
| 2 | **Makers Engine** | تجميع/تصريف/سحب سيولة/لا عرض (Smart Money) — `class MakerState` |
| 3 | **DNA Future Pattern Engine** | Pattern matching للـ future projection — `dna_pattern_match()` |
| 4 | **Fundamentals Engine** | P/E, ROE — `class FundamentalsState` + `evaluate_fundamentals()` |
| 5 | **Sector Engine** | قطاع السهم + sector momentum |
| 6 | **5 Proofs System** | نظام الإثباتات الخمسة — `class ProofResult` + `calculate_score_and_proofs()` |
| 7 | **Adaptive Learning Engine** | Adaptive threshold — `adaptive_threshold()` |
| 8 | **Fair Value (VWAP)** | VWAP + premium/discount — `calc_fair_value()` |
| 9 | **Order Blocks & Liquidity Sweeps Engine** | OB + sweeps detection — `detect_order_blocks_and_sweeps()` |

### Key Classes

| Class | الوظيفة |
|---|---|
| `MakerState` | accumulation / distribution / quiet / no-supply / pull-back |
| `FundamentalsState` | pe_ratio, roe, debt_to_equity, dividend_yield |
| `OrderBlockState` | bullish OB, bearish OB, sweep direction |
| `ProofResult` | one of 5 proofs + weight + verified (bool) |
| `Trade` | entry_price, target_price, stop_loss, exit_reason, return_pct |
| `BacktestSummary` | win_rate, profit_factor, total_trades, max_drawdown |
| `V38BacktestEngine` | main class — orchestrates the 9 subsystems |

### `simulate_trade()` — محاكاة الصفقة

```
simulate_trade(trade, future_closes, future_dates, max_holding=None, future_atrs=None)
    │
    ▼
1. ATR stop clamp [5%, 9%] (Rule 8 — Task REAPPLY-CRITICAL-FIXES)
   - V40_2_STOP_MAX_PCT env var default = 9.0 (was 7.0 stale)
   - If stop distance > 9% → tighten to 9% + re-derive target to preserve R:R
    │
    ▼
2. Data sanity guard — clamp single-bar jumps >2x or <0.5x
   - Protects against corrupt/split-unadjusted data
    │
    ▼
3. Data Gap Guard (V40.3) — carry forward last valid close when price=0
   - EGKSCO data has days where O=H=L=C=<last_close> (no trading)
    │
    ▼
4. Walk through future_closes day by day:
   - Did high >= target? → TARGET_HIT (full exit)
   - Did low <= stop? → STOPPED (full exit at stop)
   - Did we hit 1R (partial exit at 50%)? → move stop to breakeven
   - Did we hit 2R (partial exit at 30%)? → trailing stop activates
   - Did max_holding expire? → EXIT (TIME_STOP_EXPIRED)
    │
    ▼
5. Compute final return_pct:
   - If partial exits happened: weighted average (partial portion + remaining portion)
   - Apply hard_loss_ceiling_pct = 7.0 (Rule 19 — cap recorded loss)
   - Apply split_drop_threshold_pct = 35.0 (Rule 19 — exclude if ABS(return) > 35%)
    │
    ▼
6. Set trade.exit_reason:
   - target_hit | stop_loss | expired | trailing_stop | no_data
```

---

## 6. Institutional Decision Engine — V40 (6 Proofs)

| البند | القيمة |
|---|---|
| **File** | `vps-service/analyzers/institutional_decision_engine.py` |
| **LOC** | 1,507 LOC |
| **Callers** | 5 |
| **Status** | ✅ CORE — V40 (inspired by LuxAlgo + BigBeluga V39 Pine Script) |
| **Speed** | ~100ms per ticker |
| **Use case** | V40 (6 proofs + kill filters) — جزء من V40.2 pipeline |

### الـ 7 مكونات (Inspired by LuxAlgo & BigBeluga V39)

| # | المكون | الوظيفة |
|---|---|---|
| 1 | **Maker State** | تجميع / تصريف / هدوء — من SMC + VSA + Volume (ديناميكي بالانحراف المعياري) |
| 2 | **Flight State** | طائر للأعلى / واقع للأسفل / عرضي / قابل للانفجار — من BB + Break + Volume + Maker |
| 3 | **6 Proofs** | ترند / ميكرز / بصمة / أساسي / قطاع / القوة النسبية — نظام الإثباتات الستة |
| 4 | **Tech Score** | 0-100 — مجموع الإثباتات + قاعدة ديناميكية |
| 5 | **Signal Final** | شراء انفجار مؤسسي / شراء قوي / انتظر / بيع وتجنب |
| 6 | **Portfolio Advice** | امسك / زود / بيع / بيع جزئي — حسب المركز المفتوح |
| 7 | **Backtest Tracking** | win_rate, profit_factor, net_return — تتبع الأداء الفعلي |

### إضافات V39 (dynamic adaptive)

| الميزة | الوظيفة |
|---|---|
| **إثبات 6** | القوة النسبية للمؤشر العام (outperforming benchmark) |
| **حجم غير طبيعي ديناميكي** | `vol_surge = vol_ma + (vol_std × 1.5)` بدل ratio ثابت |
| **حالة القيمة العادلة ديناميكية** | بناءً على الانحراف المعياري لـ premium بدل ±5% ثابت |
| **وقف خسارة ديناميكي** | ATR percentile → SL multiplier (1.0-2.5) بدل 1.5 ثابت |
| **R:R ديناميكي** | outperforming_market → 2.0 / else → 1.5 |
| **هدف البصمة كـ TP1** | لو DNA projection bullish |
| **تتبع باكتست** | win_rate, profit_factor, total_trades, dynamic_thresh |
| **تعلم ذاتي** | ضبط الحد بناءً على نسبة النجاح (±10%) |
| **مؤشر جودة النموذج** | ✅ دقيق / ⚠️ محتاج ضبط |

### Key Functions

| Function | الوظيفة |
|---|---|
| `_safe_float(val, default=0.0)` | تحويل آمن لأي قيمة إلى float |
| `_compute_vol_stats(volumes, window=20)` | إحصائيات الحجم ديناميكياً (avg, std, dynamic_surge_threshold) |
| `_detect_maker_state(...)` | تجميع / تصريف / هدوء / لا عرض / سحب سيولة |
| `_detect_flight_state(...)` | طائر / واقع / عرضي / قابل للانفجار |
| `_build_6_proofs(...)` | نظام الإثباتات الستة |
| `_compute_tech_score(proofs)` | 0-100 weighted sum |
| `_count_strong_evidences(proofs)` | عدّ الإثباتات القوية (0-6) |
| `_check_market_breadth_veto(...)` | veto لو market breadth سيئ |
| `_compute_signal_final(...)` | شراء انفجار / شراء قوي / انتظر / بيع |
| `_compute_portfolio_advice(...)` | امسك / زود / بيع / بيع جزئي |
| `_compute_dynamic_fair_state(...)` | حالة القيمة العادلة ديناميكية |
| `_compute_dynamic_sl_mult(...)` | SL multiplier ديناميكي (1.0-2.5) |
| `_compute_self_learning_thresh(...)` | ضبط الحد ذاتياً (±10%) |
| `_compute_model_quality(...)` | ✅ دقيق / ⚠️ محتاج ضبط |
| `build_institutional_decision(...)` | THE MAIN ENTRY — بتبني القرار المؤسسي الكامل |

### V40 (6 Proofs) Weights

| Proof | Weight | Description |
|---|---:|---|
| 1. Trend (MA50 > MA200) | 8 | Uptrend confirmation |
| 2. Makers (smart money) | 26 | Most important — accumulation/distribution |
| 3. DNA (pattern matching) | 8 | Future projection |
| 4. Fundamentals (P/E, ROE) | 8 | Real fundamentals (Rule 24 — no placeholder 50) |
| 5. Sector (sector heat) | 8 | Sector momentum |
| 6. Benchmark (outperformance) | 24 | Outperforming EGX30 |
| **Total** | **82** | (Note: weights are normalized to 0-100 in tech_score) |

### AXIS-4 Veto + V40 Evidence-Count Gate

الـ institutional_decision_engine بـ يطبّق **AXIS-4 Veto**: لو أي proof من الـ 4 axes (Trend, Makers, Sector, Benchmark) فشل بشكل حرج → veto كامل (signal = HOLD or SELL).

الـ **V40 evidence-count gate**: لازم على الأقل N proofs (default = 4 من 6) متأكدة عشان BUY. لو أقل → HOLD.

---

## 7. Liquidity Filter — Kill Gate

| البند | القيمة |
|---|---|
| **File** | `vps-service/analyzers/liquidity_filter.py` |
| **LOC** | 1,101 LOC |
| **Callers** | 8 |
| **Status** | ✅ CORE — أول خطوة قبل أي تحليل |

### الفلسفة

> **القاعدة الذهبية:** السيولة أولاً، التحليل تاني.

### Kill Filters (5 فلاتر استبعاد)

| # | Filter | الحد | المصدر |
|---|---|---|---|
| 1 | **Penny Stock Filter** | price < 1.00 EGP = EXCLUDED (manipulation risk) | `min_stock_price` = 1.0 |
| 2 | **Daily Volume Filter** | volume < `MIN_VOLUME` (100K shares) = EXCLUDED | `min_volume_shares` = 100,000 |
| 3 | **Daily Turnover Filter** | turnover < `MIN_TURNOVER` (3M EGP legacy, 500K default) = EXCLUDED | `min_turnover_egp` = 500,000 |
| 4 | **Liquidity Ratio Filter** | liquidity < 10% of avg = EXCLUDED (dead) | `liquidity_dead_ratio` = 0.1 |
| 5 | **Suspended Stock Filter** | suspended = 1 = EXCLUDED | (DB column) |

### Dynamic Liquidity V2 (2026-09-04)

الحد الديناميكي مبني على سعر السهم:

| Price bucket | MIN_TURNOVER | السبب |
|---|---:|---|
| < 5 EGP (low_price) | 80,000 EGP | penny stocks — سيولة أقل ضرورية |
| 5-15 EGP (mid_price) | 200,000 EGP | mid-cap — سيولة معتدلة |
| > 15 EGP (high_price) | 400,000 EGP | large-cap — سيولة عالية مطلوبة |

### `evaluate_kill_filters()` (DB-free, pure function)

```python
def evaluate_kill_filters(
    ticker: str,
    current_price: float,
    avg_volume: float,
    avg_turnover: float,
    suspended: bool = False,
    strict_mode: bool = False,
) -> Dict[str, Any]:
    """
    Returns:
        {
            'passed': bool,
            'kill_reasons': List[str],
            'kill_details': Dict[str, Any],
            'kill_filter_active': bool,
        }
    """
```

### `set_strict_kill_filters(enabled: bool)`

```python
# V40.2 strict mode: MIN_TURNOVER = 3,000,000 EGP (kill_filter_min_turnover_egp)
set_strict_kill_filters(True)   # قبل الـ V40.2 backtest
set_strict_kill_filters(False)  # بعد الـ backtest
```

### Pump-and-Dump Guard

لو `turnover < PUMP_AND_DUMP_TURNOVER_FLOOR` AND `price_change > 50%` → EXCLUDED (pump-and-dump suspicion).

### Liquidity Bypass (Position Size Multiplier)

لو السهم عبى kill filter بس الـ signal قوي، فيه `LIQUIDITY_BYPASS_POSITION_SIZE` (default = 0.5): اقبل الإشارة بس قلّل حجم المركز 50%.

---

## 8. Flow System — 4 طبقات

| البند | القيمة |
|---|---|
| **File** | `vps-service/engines/flow_system.py` |
| **LOC** | 1,304 LOC |
| **Callers** | 8 |
| **Status** | ✅ WIRED |
| **Speed** | ~80ms per ticker |

### الفلسفة

> "النظام الذي ينيك السوق" — يحلل 4 طبقات ويعطي **Flow Score واحد**.

### الـ 4 طبقات (Layers)

| # | Layer | Weight | الوظيفة |
|---|---|---:|---|
| 1 | **MACRO FLOWS** | 25% | التدفقات الكبرى — USD/EGP inverse correlation + CBE Interest Rate + Foreign Inflows + Oil Prices + Global markets |
| 2 | **SECTOR FLOWS** | 30% | دوران القطاعات — Sector turnover vs 20-day avg + Sector vs EGX30 (outperforming) + Sector leader momentum + Sector breadth |
| 3 | **STOCK FLOWS** | 25% | تدفق السهم الواحد — Volume vs 20-day avg + Price vs sector avg + Block trades detection + RSI not overbought + Near support not resistance |
| 4 | **CROSS-VALIDATION** | 20% | التحقق المتقاطع — Stock direction = Sector direction + Sector direction = Market direction + Volume confirms price + No divergence |

### Flow Score Interpretation

| Score | Label | القرار |
|---:|---|---|
| ≥ 80 | 🔥 "نار" | دخول قوي |
| 60-79 | ✨ "شرارة" | دخول حذر |
| 40-59 | 🌫️ "رماد" | استنى |
| < 40 | ❄️ "بارد" | ماتدخلش |

### Key Classes

| Class | الوظيفة |
|---|---|
| `FlowScore` | dataclass — total_score, layer_scores, recommendation, confidence |
| `FlowSystemEngine` | main class — `analyze(ticker)` returns FlowScore |

### Top-level Functions

| Function | الوظيفة |
|---|---|
| `get_flow_score(ticker)` | Returns FlowScore for one ticker |
| `get_top_flow_stocks(limit=20)` | Returns top 20 stocks by flow_score |
| `get_flow_summary()` | Returns market-wide flow summary (sector-level) |

---

## 9. Market Regime Engine — Minervini Stages

| البند | القيمة |
|---|---|
| **File** | `vps-service/engines/market_regime.py` + `vps-service/analyzers/market_regime_engine.py` |
| **LOC** | 529 (engines) + 1,374 (analyzers) |
| **Callers** | 3 (engines) + 5 (analyzers) |
| **Status** | ✅ WIRED |

### Minervini Stage Classification

| Stage | Name | Description | Trading Allowed |
|---:|---|---|:---:|
| 1 | Consolidation | price around SMA200, low slope | ⚠️ Half position |
| 2 | **Bull Market** | price > SMA200, SMA50 > SMA200, positive slope | ✅ Full position |
| 3 | Distribution | price > SMA200 but weakening | ⚠️ Half position |
| 4 | **Bear Market** | price < SMA200, negative slope | ❌ NO TRADING |

### `RegimeResult` dataclass

```python
@dataclass
class RegimeResult:
    stage: int               # 1-4
    stage_name: str          # "Bull Market", "Bear Market", etc.
    price: float             # Current EGX30 price
    sma50: float             # 50-day SMA
    sma200: float            # 200-day SMA
    slope_50: float          # SMA50 slope (%)
    slope_200: float         # SMA200 slope (%)
    adx: float               # ADX value (0 if not enough data)
    confidence: float        # 0-100
    trading_allowed: bool    # Whether trading is allowed
    position_modifier: float  # 1.0 (full), 0.5 (half), 0.0 (none)
    date: str                # Date of analysis
    index_ticker: str        # Which index was used
    reason: str              # Human-readable explanation
```

### Market Regime Engine (Analyzers — DEFENSIVE/NORMAL/AGGRESSIVE)

`analyzers/market_regime_engine.py` بـ يستخدم system منفصل:

| Regime | min_score | الوظيفة |
|---|---:|---|
| **DEFENSIVE** | 75 | خفّض picks + لا تقبل إلا أقوى الإشارات |
| **NORMAL** | 70 (default) | عتبة عادية |
| **AGGRESSIVE** | 70 | عتبة عادية + ارتفاع max_picks |

### Data Source

| Engine | Source |
|---|---|
| `engines/market_regime.py` | `price_history.db` (EGX30/EGX100 ticker, 2021-2026) — default `_DEFAULT_DB = db/price_history.db` |
| `analyzers/market_regime_engine.py` | Multi-market (EGX30, TADAWUL, KSE, QSE, SPY, BTC, GOLD) |

### Canonical Indicators Used (Rule 67)

```python
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.adx import calc_adx as _canonical_adx
```

---

## 10. ATR Risk Engine + Stop Management

| البند | القيمة |
|---|---|
| **File** | `vps-service/engines/atr_risk_engine.py` |
| **LOC** | 264 LOC |
| **Callers** | 1 |
| **Status** | ✅ WIRED |
| **Source** | Welles Wilder (مخترع ATR) + Michael Covel (Trend Following) |

### الفلسفة

> "الوقف الثابت (-8%) غلط لأنه: ضيق جداً لسهم متقلب → يتضرب قبل ما يتحرك؛ واسع جداً لسهم هادي → مخاطرة زايدة بلا داعي."
>
> **الحل:** الوقف = entry - (multiplier × ATR)
> - ATR بيقيس التقلب الحقيقي (شامل الفجوات)
> - multiplier أكبر = وقف أوسع = يتحمل الضجيج بس مخاطرة أكبر

### ATRRiskConfig

```python
@dataclass(frozen=True)
class ATRRiskConfig:
    atr_period: int = 14
    # مضاعف الـ ATR لكل persona
    scalper_multiplier: float = 2.0     # وقف ضيق، صفقات سريعة
    investor_multiplier: float = 3.0    # وقف واسع، يتحمل التذبذب
    # Covel الأصلي بيقترح 4× بس ده واسع جداً على EGX (سيولة أقل)
```

### Stop Management Layered (Rule 8 + Rule 19)

| Layer | الحد | المصدر |
|---|---|---|
| **ATR stop (initial)** | entry - (multiplier × ATR) | `atr_risk_engine.py` |
| **ATR clamp [min, max]** | [5%, 9%] | Rule 8 — `atr_stop_min_pct=5.0` + `atr_stop_max_pct=9.0` |
| **Hard Loss Ceiling** | -7.0% | Rule 19 — `hard_loss_ceiling_pct=7.0` in `daily_closer.py::_mark_closed` |
| **Split Guard** | 35% | Rule 19 — `split_drop_threshold_pct=35.0` (exclude trade if ABS(return) > 35%) |
| **Cap on SELL PnL** | -20% | `max(profit_loss, -20.0)` in `daily_closer.py` (منع الشذوذ الرياضي) |
| **Position max stop** | 10% | `position_max_stop_pct=10.0` (POSITION-LAYER hard cap, الإنتاج) |

### Per-Stock-Type Stops (in `engine_settings.py`)

| Stock Type | Stop % |
|---|---:|
| Large Bank EGX (COMI, HRHO) | -7% |
| Medium Bank EGX (SAUD, CAII) | -8% |
| Large Real Estate EGX (MNHD, ORHD) | -10% |
| Small Real Estate EGX | -12% |
| Large Industrial EGX (SWDY, ESRS) | -8% |
| Small Industrial EGX | -10% |
| Speculative EGX | -5% (tightest — سريع الانهيار) |
| Suspended EGX | 0% (لا تدخل) |
| Bitcoin (BTC) | -10% |
| Ethereum (ETH) | -12% |
| Large Altcoin | -15% |
| Small Altcoin | -20% |
| Meme Coin | -25% |

### Position Sizing (Rule 19 — Position Cap 2.5%)

```python
# BRAVO-RADAR-PRED-AUDIT-001 Fix 2 (Rule 19 — Position Cap 2.5%):
# أي persona مايتعرضش max_position_pct > 2.5% للمستخدم/الـ API.
# الـ cap هنا بسيط: clamp القيمة لـ 2.5% مع الحفاظ على الـ type signature.
if self.max_position_pct > 2.5:
    self.max_position_pct = 2.5
```

### Position Sizing Formula (RiskManager)

```
Position Size (shares) = (Capital × Risk%) / (Entry - Stop)

where:
  Capital = total portfolio value (EGP)
  Risk% = 2% default (1% for scalpers — كثرة الصفقات)
  (Entry - Stop) = risk per share (EGP)
```

### Take Profit Tiers (Mark Douglas)

| Tier | Trigger | Action |
|---|---|---|
| 1R | price hits entry + 1×risk | Sell 30% + move stop to breakeven |
| 2R | price hits entry + 2×risk | Sell 50% of remaining |
| Trailing | highest_price - 2.5% | Trail the last 20% |

---

## 11. Persona Engine — 7 شخصيات

| البند | القيمة |
|---|---|
| **File** | `vps-service/engines/persona_engine.py` |
| **LOC** | 986 LOC |
| **Callers** | 2 |
| **Status** | ✅ WIRED |
| **Source** | ANALYSIS_STRATEGY_BIBLE_v1.0.md |

### الـ 7 شخصيات

| Persona | max_position_pct | default_stop_loss_pct | default_target_pct | time_stop_days | leverage | الوصف |
|---|---:|---:|---:|---:|---:|---|
| `conservative` | 1.0% | 5% | 8% | 30 | 0× | المحافظ |
| `cautious` | 1.5% | 6% | 10% | 21 | 0× | المتوسط الحذر |
| `balanced` | 2.0% | 7% | 12% | 14 | 0× | المتوازن (default للإنتاج) |
| `active_trader` | 2.0% | 5% | 10% | 10 | 0× | المضارب المنتظم |
| `adventurer` | 2.5% | 8% | 15% | 7 | 1× | المغامر |
| `gambler` | 2.5% | 10% | 20% | 5 | 2× | المقامر المحسن |
| `hedger` | 1.0% | 4% | 6% | 60 | 0× | المتحوط المؤسسي |

> ⚠️ **ملاحظة تاريخية:** الـ code تذكر أحياناً `expert` (شخصية رابعة تجريبية)، لكن في الإنتاج الفعلي `predictions.persona` ∈ {`balanced`, `gambler`, `conservative`} فقط (Rule 23). أي إشارة لـ `expert` هي legacy ولم تُفعّل.

### Rule 23 — PERSONA-UNIFY-A

جدول `predictions.persona` **محمي**: `persona='balanced'` ثابت لكل V40.2 picks. الـ `persona_fit` بـ يتـ annotated في `kill_filter_result` فقط (رؤية تحليلية).

للأسهم اللي strongly fit gambler/conservative (fit_score ≥ 50): بـ يُكتب row منفصل في `persona_predictions` من نفس الـ pool القوي + بـ يتـ closed فورًا بالـ outcome المحاكى.

### Rule 22 — KPIs by dedup-by-ticker

السهم الواحد = صفقة واحدة حتى لو تكرر بين الشخصيات. التكرار بين الشخصيات = إشارة أقوى، مش 3 صفقات منفصلة. أي حساب WR / PF لازم يكون على مستوى `(ticker, prediction_date)` فريد أولًا.

---

## 12. قائمة الـ 119 Analyzer

> في `vps-service/analyzers/` (117 ملف `.py` + `__init__.py` + `analyzer_modules/` subfolder).

### الـ Top 20 Key Analyzers (per task request)

| # | Analyzer | LOC | الفلسفة | Status |
|---|---|---:|---|---|
| 1 | **master_analyzer.py** | 5,764 | THE BRAIN — يدمج كل analyzers + Golden Rules | ⚠️ PARTIAL |
| 2 | **institutional_decision_engine.py** | 1,507 | V40 — 6 إثباتات موزونة + kill filters + AXIS-4 veto | ✅ CORE |
| 3 | **liquidity_filter.py** | 1,101 | Hard gate: minimum volume + turnover + penny stock filter | ✅ CORE |
| 4 | **core_scoring_engine.py** | 2,576 | TechnicalScorer + VolumeScorer + CandlestickScorer + FundamentalScorer + RiskCalculator | ⚠️ PARTIAL |
| 5 | **confluence_engine_v3.py** | 1,233 | Confluence دمج المحركات — multi-factor confluence scoring | ✅ WIRED |
| 6 | **prediction_optimizer.py** | 1,589 | تحسين التوقعات (optimizer_params.json) | ✅ WIRED |
| 7 | **sniper_engine.py** | 2,026 | "قناص مش رشاش" — 5 Gates + 6 عوامل | ✅ WIRED |
| 8 | **persona_screener.py** | 1,945 | parent: investor + gambler (dual-persona) | ✅ WIRED |
| 9 | **market_regime_engine.py** | 1,374 | DEFENSIVE/NORMAL/AGGRESSIVE | ✅ WIRED |
| 10 | **adaptive_weights.py** | 789 | Per-persona weight table (PERSONA_INPUT_WEIGHTS) | ✅ WIRED |
| 11 | **prediction_tracker.py** | 1,405 | Writes/reads predictions table — track + verify | ✅ CORE |
| 12 | **backtest_engine.py** | 2,375 | V38 Backtest (داخل analyzers/ كـ legacy location) | ✅ CORE |
| 13 | **egx_disclosure_engine.py** | 928 | 12 نوع إفصاح EGX | ✅ WIRED |
| 14 | **strict_entry_filters.py** | 829 | تجميع أو Liquidity Grab فقط | ✅ WIRED |
| 15 | **short_holding_exit.py** | 609 | إخراج قصير المدى | ✅ WIRED |
| 16 | **smc_engine.py** | 452 | Smart Money: OB + FVG + Sweeps | ✅ WIRED |
| 17 | **volume_profile.py** | 344 | VWAP + OBV + تجميع/توزيع | ✅ WIRED |
| 18 | **v68_oracle.py** | 734 | V68 Oracle | ⚠️ DEAD |
| 19 | **golden_hunter.py** | 411 | V76 Golden Hunter | ⚠️ DEAD |
| 20 | **fair_value_calculator.py** | 200 | Fair value: VWAP + premium/discount | ✅ WIRED |

### باقي الـ 99 analyzer

| # | File | LOC | الوظيفة |
|---|---|---:|---|
| 21 | `adaptive_weights.py` | 789 | أوزان ديناميكية حسب الريجيم |
| 22 | `ai_pattern_analyzer.py` | — | AI pattern detection |
| 23 | `ai_sentiment.py` | — | AI sentiment analysis |
| 24 | `alert_system.py` | — | alert system |
| 25 | `background_analyzer.py` | — | background analysis |
| 26 | `bag_holder_rescue.py` | — | rescue for bag holders (KILL/GOLDEN_DIP/HOLD) |
| 27 | `board_of_analysts.py` | — | board of analysts ensemble |
| 28 | `breakout_signal.py` | — | breakout detection |
| 29 | `candle_probability_engine.py` | — | candle probability engine |
| 30 | `candlestick.py` | — | candlestick patterns |
| 31 | `confidence_engine.py` | — | confidence engine |
| 32 | `conviction_engine.py` | 498 | conviction engine |
| 33 | `crypto_analyzer.py` | — | crypto analyzer |
| 34 | `crypto_circuit.py` | — | crypto circuit breaker |
| 35 | `crypto_disclosure_engine.py` | — | crypto disclosure engine |
| 36 | `crypto_maestro.py` | — | crypto maestro |
| 37 | `crypto_news_fetcher.py` | — | crypto news fetcher |
| 38 | `crypto_quality_gate.py` | — | crypto quality gate |
| 39 | `crypto_regime.py` | — | crypto regime |
| 40 | `crypto_strict_filters.py` | — | crypto strict filters |
| 41 | `decision_logger.py` | — | decision logging |
| 42 | `dividend_checker.py` | — | dividend checker |
| 43 | `dynamic_context_engine.py` | — | dynamic market context |
| 44 | `dynamic_target_engine.py` | — | dynamic target engine |
| 45 | `egx_stocks_dictionary.py` | — | EGX stocks dictionary |
| 46 | `engine_settings.py` | — | ⭐ canonical engine settings (~100 keys) |
| 47 | `enhanced_indicators.py` | — | enhanced indicators |
| 48 | `enhanced_prediction_tracker.py` | — | enhanced prediction tracker |
| 49 | `expert_memory_bridge.py` | — | expert memory bridge |
| 50 | `expert_quality_gate.py` | — | expert quality gate |
| 51 | `feedback_loop.py` | — | feedback loop |
| 52 | `fibonacci.py` | — | Fibonacci retracement + extension |
| 53 | `fundamental.py` | 613 | fundamental analysis |
| 54 | `fundamental_data_provider.py` | — | ⭐ Rule 24 — `get_fundamental_score(ticker)` |
| 55 | `fundamental_engine.py` | — | fundamental engine |
| 56 | `fundamental_enhanced.py` | — | enhanced fundamental |
| 57 | `fundamental_relative.py` | — | sector-relative fundamentals |
| 58 | `fundamental_scorer.py` | 567 | fundamental scorer |
| 59 | `fusion_engine.py` | 745 | fusion engine |
| 60 | `hmm_market_regime.py` | — | HMM market regime |
| 61 | `hunting_engine.py` | — | hunting engine |
| 62 | `indicators/` (folder) | — | ⭐ canonical indicators (Rule 67) — 13 files |
| 63 | `institutional_levels.py` | — | institutional levels |
| 64 | `intraday_reader.py` | — | intraday reader |
| 65 | `kimi_fixes.py` | — | kimi fixes |
| 66 | `learning_file_storage.py` | — | learning file storage |
| 67 | `live_indicator_engine.py` | — | live indicator engine |
| 68 | `live_news_integration.py` | — | live news integration |
| 69 | `market_daily_report.py` | — | market daily report |
| 70 | `multi_path_detector.py` | — | multi-path detector |
| 71 | `multi_timeframe_engine.py` | — | multi-timeframe engine |
| 72 | `narrative_generator.py` | — | narrative generator (Arabic) |
| 73 | `news_fetcher_analyzer.py` | — | news fetcher (uses news.db.market_news) |
| 74 | `news_impact_scorer.py` | — | news impact scorer |
| 75 | `news_stop_filter.py` | — | news stop filter |
| 76 | `nightly_quant_job.py` | — | nightly quant job |
| 77 | `patterns.py` | — | patterns |
| 78 | `persona_gambler.py` | — | gambler persona |
| 79 | `persona_investor.py` | — | investor persona |
| 80 | `position_manager.py` | — | position manager |
| 81 | `position_sizing.py` | — | position sizing |
| 82 | `production_data_client.py` | — | production data client |
| 83 | `quant_cache.py` | — | quant cache |
| 84 | `quant_engine.py` | 316 | quant engine |
| 85 | `quant_overdrive.py` | 381 | quant overdrive |
| 86 | `radar_integration.py` | — | radar integration |
| 87 | `real_backtester.py` | — | real backtester |
| 88 | `real_return_engine.py` | — | real return engine |
| 89 | `regime_detector.py` | — | regime detector |
| 90 | `regime_filter.py` | — | regime filter (per-stock + market-level) |
| 91 | `reports_engine.py` | — | reports engine |
| 92 | `risk.py` | — | RiskManager + RiskAssessment |
| 93 | `risk_adaptive.py` | — | adaptive risk |
| 94 | `scoring_fix.py` | 513 | scoring fix |
| 95 | `screener.py` | — | screener |
| 96 | `screener_integration.py` | — | screener integration |
| 97 | `seasonality_first_engine.py` | — | seasonality first engine |
| 98 | `seasonality_scorer.py` | — | seasonality scorer |
| 99 | `sector_relative.py` | 471 | sector-relative fundamentals |
| 100 | `sentiment_analyzer.py` | — | sentiment analyzer |
| 101 | `session_timing.py` | — | session timing (best hours) |
| 102 | `smart_portfolio_monitor.py` | — | smart portfolio monitor |
| 103 | `social_card_generator.py` | — | social card generator |
| 104 | `stock_dna_analyzer.py` | — | stock DNA analyzer |
| 105 | `stock_notebook.py` | — | stock notebook |
| 106 | `technical.py` | 613 | technical analysis |
| 107 | `technical_explainer.py` | — | technical explainer (Arabic) |
| 108 | `technical_target_engine.py` | — | technical target engine |
| 109 | `technical_weighted.py` | 542 | technical weighted |
| 110 | `ticker_cooldown.py` | — | ⭐ Rule 74 — ticker cooldown (5 losses → 14 days) |
| 111 | `timing.py` | — | entry/exit timing |
| 112 | `trader_levels_engine.py` | — | trader levels engine |
| 113 | `unified_analysis.py` | — | unified analysis |
| 114 | `unified_learning_engine.py` | — | unified learning engine |
| 115 | `unified_maestro.py` | 607 | unified maestro |
| 116 | `v82_analyzer.py` | 769 | V82 analyzer |
| 117 | `volume_profile.py` | 344 | VWAP + OBV + تجميع/توزيع |

### الـ DEAD Analyzers (موجودة بس مش مربوطة)

| Analyzer | LOC | السبب |
|---|---:|---|
| `conviction_engine.py` | 498 | DEAD — 0 callers |
| `fusion_engine.py` | 745 | DEAD — 0 callers |
| `unified_maestro.py` | 607 | DEAD — 0 callers |
| `v82_analyzer.py` | 769 | DEAD — 0 callers |
| `quant_engine.py` | 316 | DEAD — 0 callers |
| `quant_overdrive.py` | 381 | DEAD — 0 callers |
| `fundamental_scorer.py` | 567 | DEAD — superseded by `fundamental_data_provider.py` |
| `technical.py` | 613 | DEAD — superseded by canonical indicators |
| `technical_weighted.py` | 542 | DEAD — superseded |
| `scoring_fix.py` | 513 | DEAD — historical fix only |

> ⚠️ **Rule 16 + Rule 25 — VERIFY-BEFORE-DELETE:** لا تحذف DEAD analyzers بدون triple-verify (not imported by daily_predictor/core/jobs/live_signals + not in crontab + importers كلهم try/except أو dead).

---

## 13. قائمة الـ 15 Engine في `vps-service/engines/`

| # | Engine | LOC | Callers | الفلسفة |
|---|---|---:|---:|---|
| 1 | **backtest_engine.py** | 2,375 | 4 | ✅ CORE — V38: 9 subsystems + simulate_trade |
| 2 | **market_regime.py** | 529 | 3 | Minervini Stage 1-4 detection |
| 3 | **atr_risk_engine.py** | 264 | 1 | Wilder ATR stop: scalper=2×, investor=3× |
| 4 | **flow_system.py** | 1,304 | 8 | 4 طبقات: MACRO(25%) + SECTOR(30%) + STOCK(25%) + CROSS(20%) |
| 5 | **crypto_engine.py** | 395 | 1 | crypto engine (مخفف) |
| 6 | **donchian_breakout.py** | 224 | 0* | Turtle Traders 20/55 يوم |
| 7 | **explosive_scanner.py** | 688 | 2 | Volume(25%) + Price(30%) + Sector(20%) + SmartMoney(15%) + Market(10%) |
| 8 | **historical_backfill_engine.py** | 1,216 | 2 | تعلم من 180 يوم |
| 9 | **paper_trade_tracker.py** | 1,170 | 1 | Historical + Iterative learning |
| 10 | **persona_engine.py** | 986 | 2 | 7 شخصيات: محافظ→مقامر |
| 11 | **stage2_filter.py** | 266 | 0* | SEPA: 5 شروط صارمة للـ Stage 2 |
| 12 | **stock_fundamentals.py** | 648 | 1 | 9 جداول من data_engine.db |
| 13 | **take_profit_tiers.py** | 265 | 0* | Mark Douglas: 1R→ثلث + BE + 2R→ثلث + trail |
| 14 | **vcp_detector.py** | 337 | 0* | Volatility Contraction Pattern |
| 15 | `__init__.py` | — | — | package marker |

> (* = من package shim، بيشتغلوا عبر `glminvestment_engines`)

---

## 14. قائمة الـ 15 Job في `vps-service/jobs/`

| # | Job | LOC | الوظيفة | Cron |
|---|---|---:|---|---|
| 1 | **daily_predictor.py** | 4,717 | V40.2 predictions + TP1 + user_advice_ar + WHALE_RADAR integrator | `30 14 * * 0-4` |
| 2 | **daily_closer.py** | 3,501 | TP1 exit + Time Stop 5D + trailing 2.5% + hard_loss_ceiling -7% | بعد الـ predictor |
| 3 | **market_scheduler.py** | 2,780 | جدولة السوق | مستمر |
| 4 | **intraday_scanner.py** | 652 | scan + promote incubator | `*/5 10-14 * * 0-4` |
| 5 | **learning_engine.py** | 1,413 | تعلم iterative — extracts lessons + updates indicator_weights | `0 16 * * 0-4` |
| 6 | **intraday_aggregator.py** | 390 | تجميع intraday → daily | `*/2 * * * *` |
| 7 | **price_history_safetynet.py** | ~400 | ملء price_history.db من Yahoo | `0 6 * * 0-4` |
| 8 | **price_history_stale_monitor.py** | ~250 | كشف stale price data | `0 */6 * * *` |
| 9 | **hot_candidate_detector.py** | ~300 | كشف hot candidates (real-time) | `* * * * *` |
| 10 | **fetch_corporate_actions.py** | ~200 | جلب dividends/splits | `0 6 * * 6` |
| 11 | **fetch_inflation_worldbank.py** | ~150 | inflation data from WorldBank | `0 6 1 * *` |
| 12 | **crypto_lab_scheduler.py** | ~250 | crypto prediction lab | Daily |
| 13 | **wal_checkpoint.py** | ~100 | WAL checkpoint utility | `30 3 * * *` |
| 14 | `closer_modules/` (folder) | — | 2 extracted modules (atr_helpers, pending_helpers) | — |
| 15 | `predictor_modules/` (folder) | — | 8 extracted modules (Phase 7.2 + 8.2 Strangler) | — |

---

## 15. دورة حياة التوقع (Prediction Lifecycle)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: GENERATE (daily_predictor.py)                                     │
│  ─────────────────────────────────────────────────────                      │
│  For each ticker × scan_date:                                              │
│    • V38BacktestEngine.analyze(ticker) → MasterAnalysis                    │
│    • Kill filters (liquidity + sector + whale + regime + toxic)             │
│    • If BUY: compute evidence + R-multiple + persona_fit                  │
│    • Sort signals by (evidence DESC, r_multiple DESC, tech_score DESC)    │
│    • Take top N (max_picks=5)                                              │
│    • Morning bell = picks[0]                                              │
│    • Regime-aware min_score filter (DEFENSIVE → 75, AGGRESSIVE → 70)       │
│    • Tracker.record_prediction() → INSERT into predictions.db.predictions │
└────────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: TRACK (prediction_tracker.py)                                    │
│  ───────────────────────────────────────                                    │
│  For each PENDING prediction:                                              │
│    • track_momentum(prediction_id, current_price)                          │
│    • Update highest_price_reached, lowest_price_reached                    │
│    • Check if target_price touched → mark target_hit_at                    │
│    • Check if stop_loss touched → mark stop_hit_at                         │
└────────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: CLOSE (daily_closer.py)                                          │
│  ───────────────────────────────────────                                    │
│  For each PENDING prediction (next day):                                   │
│    • _mark_closed():                                                       │
│      - TARGET_HIT: if high >= target_price → exit_price = target_price    │
│      - STOPPED: if low <= stop_loss → exit_price = stop_loss              │
│      - TRAILING_STOP: trailing stop hit → exit_price = trailing_stop      │
│      - TIME_STOP_5D_EXPIRED: holding_days >= 5 + no new high → exit       │
│    • Apply hard_loss_ceiling_pct = 7.0 (Rule 19)                           │
│    • Apply split_drop_threshold_pct = 35.0 (Rule 19)                       │
│    • Cap SELL PnL: max(profit_loss, -20.0)                                │
│    • Update: exit_price, exit_reason, exit_type, status='CLOSED',          │
│              closed_at, actual_return, pnl_pct, is_correct, holding_days  │
│    • Ticker Cooldown check: 5 losses/سهم → 14 days (Rule 74)              │
│    • Circuit Breaker check: 3 losses متتالية → 3 days (Rule 74)            │
└────────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: VERIFY (learning_engine.py)                                      │
│  ─────────────────────────────────────────                                  │
│  For each CLOSED prediction:                                              │
│    • Read outcome (win/loss, PnL, R-multiple, exit_reason)                │
│    • Read proofs (which signals fired)                                    │
│    • Per-indicator performance:                                          │
│      - Win rate per indicator                                            │
│      - Update stocks.db.indicator_weights                                │
│      - Update stocks.db.regime_indicator_weights (per-regime)             │
│      - Update stocks.db.indicator_trust_scores                           │
│    • Extract lessons:                                                    │
│      - Save to predictions.db.prediction_lessons                         │
│      - Discover conjunction patterns (stocks.db.conjunction_patterns)   │
│    • Master Analyzer reads new weights on next run → smarter predictions │
└────────────────────────────────────────────────────────────────────────────┘
```

### Prediction Status Taxonomy (Rule 5 — prediction-status)

| Status | المعنى | Transition |
|---|---|---|
| `PENDING` | توقع جديد — لم يُغلق بعد | → CLOSED |
| `CLOSED` | تم إغلاق التوقع بـ exit_reason | (final) |
| `EXPIRED` | انتهت المدة القصوى (max_holding_days = 30) | (final) |
| `CANCELLED` | تم إلغاء التوقع يدوياً (admin) | (final) |

### exit_reason values

| exit_reason | الوصف |
|---|---|
| `target_hit` | target_price تم الوصول إليه |
| `stop_loss` | stop_loss تم تفعيله |
| `trailing_stop` | trailing stop hit (بعد partial exit) |
| `expired` | max_holding_days expired |
| `time_stop_5d` | 5 أيام بلا新高 high → exit |
| `no_data` | missing price data |
| `cancelled` | manual cancel by admin |

---

## 16. نظام الـ Backtest

### 16.1 — V38 Backtest Engine (`engines/backtest_engine.py`)

#### Pipeline

```python
# 1. Setup engine
engine = V38BacktestEngine(
    buy_threshold=68,
    market_regime=MarketRegimeEngine().get_regime(),
    fundamentals_provider=FundamentalDataProvider(),
    benchmark_ticker='EGX30ETF'
)

# 2. Pre-cache price history (180x speedup)
pre_cache_price_history(tickers, engine)

# 3. For each ticker × date:
for ticker in tickers:
    for scan_date in scan_dates:
        # 3a. Get cached price data
        price_data = engine.get_price_data(ticker)

        # 3b. Run full V38 analysis
        analysis = engine.analyze(ticker)

        # 3c. Apply kill filters
        kill_result = evaluate_kill_filters(
            ticker, price, volume, turnover, suspended=False,
            strict_mode=True
        )
        if not kill_result['passed']:
            continue

        # 3d. If BUY: simulate trade
        trade = Trade(
            entry_price=analysis['entry'],
            target_price=analysis['target'],
            stop_loss=analysis['stop'],
            signal='BUY'
        )
        future_closes = engine.get_future_closes(ticker, scan_date, days=30)
        simulated = simulate_trade(trade, future_closes, future_dates, future_atrs)

        # 3e. Store prediction + outcome
        tracker.record_prediction(
            ticker=ticker,
            signal='BUY',
            entry_price=trade.entry_price,
            target_price=trade.target_price,
            stop_loss=trade.stop_loss,
            ...
        )

# 4. Compute summary
summary = BacktestSummary(trades)
# - win_rate, profit_factor, total_trades, max_drawdown
# - by_ticker, by_sector, by_persona breakdowns
```

### 16.2 — `real_backtester.py` (`analyzers/real_backtester.py`)

Backtester آخر للـ walk-forward analysis. يدعم:

- **Time-based split**: train على 2021-2024، test على 2025-2026
- **No look-ahead bias**: كل trade بـ يستخدم بس البيانات المتاحة وقتها
- **No survivorship bias**: يشمل delisted tickers في الـ training
- **Transaction costs**: 0.5% per trade (commission + slippage)

### 16.3 — `paper_trade_tracker.py` (`engines/paper_trade_tracker.py`)

| الميزة | الوظيفة |
|---|---|
| **Historical mode** | simulate trades على historical data |
| **Iterative mode** | simulate trade-by-trade (one at a time) |
| **Position tracking** | per-ticker position state (entry, current_price, PnL) |
| **Outcome calculation** | exact match with daily_closer.py logic |

### 16.4 — Backtest Output

```json
// vps-service/backtest_results/v40_2_generation_20261024.json
{
  "scan_date": "2026-10-23",
  "total_signals": 12,
  "by_signal": {
    "BUY": 9,
    "STRONG_BUY": 3,
    "HOLD": 0,
    "SELL": 0
  },
  "by_evidence": {
    "evidence_6": 2,
    "evidence_5": 5,
    "evidence_4": 3,
    "evidence_3": 2
  },
  "morning_bell": {
    "ticker": "COMI",
    "evidence": 6,
    "tech_score": 82.3,
    "r_multiple": 2.1
  },
  "summary": {
    "win_rate": 0.692,
    "profit_factor": 1.327,
    "max_drawdown": 0.124,
    "expectancy_per_trade": 0.0154
  }
}
```

---

## 17. إدارة المخاطر (Risk Management)

### 17.1 — القواعد الأساسية (Rules 7-19)

| Rule | القيمة | المصدر |
|---|---|---|
| Rule 7 | HARD cap على عدد التوقعات اليومية | predictions.db + auth.db (subscription gating) |
| Rule 8 | ATR stop clamp [5%, 9%] | `engine_settings.py`: `atr_stop_min_pct=5.0`, `atr_stop_max_pct=9.0` |
| Rule 9 | Trailing FLOOR not CAP | `trailing_stop_activation_gain=2.0`, `trailing_stop_pct=2.5` |
| Rule 10 | EXIT_POLICY = `partial_1r_trailing` | `daily_closer.py` + `take_profit_tiers.py` |
| Rule 18 | R:R floor = 1.8 | `engine_settings.py`: `dynamic_rr_normal=1.8`, `dynamic_rr_outperform=2.0` |
| Rule 19 | Hard Loss Ceiling = -7% + Split Guard = 35% | `daily_closer.py`: `hard_loss_ceiling_pct=7.0`, `split_drop_threshold_pct=35.0` |

### 17.2 — Stop Loss Layered

| Layer | الحد | المصدر |
|---|---|---|
| Initial stop | `entry - (multiplier × ATR)` | `atr_risk_engine.py` |
| ATR clamp | [5%, 9%] | Rule 8 — `atr_stop_min_pct=5.0`, `atr_stop_max_pct=9.0` |
| Hard Loss Ceiling | -7% (cap recorded loss) | Rule 19 — `hard_loss_ceiling_pct=7.0` |
| Split Guard | 35% (exclude trade if ABS(return) > 35%) | Rule 19 — `split_drop_threshold_pct=35.0` |
| Cap on SELL PnL | -20% (منع الشذوذ الرياضي) | `daily_closer.py` |
| Position max stop | 10% | `position_max_stop_pct=10.0` |

### 17.3 — Position Sizing (Rule 19 — Position Cap 2.5%)

```python
# Formula:
position_size = (capital × risk_pct) / (entry - stop)

# where:
#   capital = total portfolio value (EGP)
#   risk_pct = 2% default (1% for scalpers — كثرة الصفقات)
#   (entry - stop) = risk per share (EGP)
#
# BRAVO-RADAR-PRED-AUDIT-001 Fix 2 (Rule 19):
# أي persona مايتعرضش max_position_pct > 2.5% للمستخدم/الـ API.
```

### 17.4 — Take Profit Tiers (Mark Douglas)

| Tier | Trigger | Action |
|---|---|---|
| TP1 | price hits entry + 1×risk (1R) | Sell 30% (`exit_engine_tp1_partial_pct=0.30`) + move stop to breakeven |
| TP2 | price hits entry + 2×risk (2R) | Sell 50% of remaining (`exit_engine_tp2_exit_pct=0.80`) |
| Trailing | highest_price - 2.5% | Trail the last 20% (Mark Douglas "let winners run") |

### 17.5 — Trailing Stop (Rule 9 — FLOOR not CAP)

| البند | القيمة |
|---|---|
| **Activation gain** | `trailing_stop_activation_gain = 2.0` (يبدأ بعد 2R) |
| **Trailing %** | `trailing_stop_pct = 2.5` (2.5% under highest_price) |
| **Rule 9** | FLOOR — الـ trailing stop ما ينزلش تحت breakeven بعد ما يوصلها |

### 17.6 — Time Stop (5 أيام)

| البند | القيمة |
|---|---|
| **Time stop** | 5 أيام بلا新高 high → EXIT (`TIME_STOP_5D_EXPIRED`) |
| **Max holding** | `max_holding_days = 30` (default للـ trend-following) |
| **Min movement** | `time_stop_min_movement_pct = 3.0` (3% خلال الـ time stop) |

### 17.7 — Ticker Cooldown + Circuit Breaker (Rule 74)

| الحماية | الترايغر | مدة الوقف | المرجع في الكود |
|---|---|---|---|
| **Ticker Cooldown** | 5 خسارات متتالية على نفس الـ ticker | **14 يوم** | `vps-service/jobs/daily_predictor.py:2844-2851` |
| **Circuit Breaker** | 3 خسارات متتالية على أي ticker | **3 أيام** | `vps-service/jobs/daily_closer.py:3287` + `vps-service/utils/circuit_breaker.py:48-53` |

**قواعد صارمة:**
- Ticker Cooldown = per-ticker hard stop (لا override)
- Circuit Breaker = حماية منفصلة (لا دمج مع Ticker Cooldown)
- كلاهما حمايات رأس مال مقدسة (Rule 19): **لا تُلمس، لا تُضعف، لا تُخفّف thresholds**
- ممنوع bypass flag في الإنتاج (مسموح فقط في backtest sandbox)
- ممنوع توليد توصية على ticker في cooldown بأي persona (Rule 23)

### 17.8 — Hard Caps Table (الحدود الحرجة)

| Key | القيمة | المصدر | الوظيفة |
|---|---:|---|---|
| `atr_stop_min_pct` | 5.0 | `engine_settings.py` | Rule 8 — stop distance ≥ 5% |
| `atr_stop_max_pct` | 9.0 | `engine_settings.py` | Rule 8 — stop distance ≤ 9% |
| `hard_loss_ceiling_pct` | 7.0 | `daily_closer.py` | Rule 19 — سقف الخسارة الأقصى لكل صفقة |
| `split_drop_threshold_pct` | 35.0 | `daily_closer.py` | Rule 19 — exclude split-drop trades |
| `dynamic_rr_normal` | 1.8 | `engine_settings.py` | Rule 18 — R:R عادي |
| `dynamic_rr_outperform` | 2.0 | `engine_settings.py` | Rule 18 — R:R عند outperforming benchmark |
| `min_turnover_egp` | 500,000 | `engine_settings.py` | حد السيولة العادي |
| `kill_filter_min_turnover_egp` | 3,000,000 | `liquidity_filter.py` | V40.2 strict mode (Rule 13) |
| `min_volume_shares` | 100,000 | `liquidity_filter.py` | حد الحجم الأدنى |
| `min_stock_price` | 1.0 | `liquidity_filter.py` | penny stock filter |
| `max_holding_days` | 30 | `engine_settings.py` | أقصى مدة احتفاظ |
| `position_max_stop_pct` | 10.0 | `engine_settings.py` | POSITION-LAYER hard cap |
| `max_position_pct` | 2.5 | `persona_engine.py` | Rule 19 — Position Cap |
| `default_risk_percent` | 2.0 | `risk.py` | نسبة المخاطرة الافتراضية |
| `min_score` | 60 | `engine_settings.py` | حد القبول الإنتاجي |
| `buy_threshold_score` | 68 | `engine_settings.py` | عتبة BUY (canonical, Rule 67) |
| `strong_buy_threshold` | 75 | `engine_settings.py` | عتبة STRONG_BUY |
| `WHALE_RADAR_MIN_TURNOVER` | 5,000,000 | `daily_predictor.py` | WHALE_RADAR minimum (EXPERIMENTAL) |
| `WHALE_RADAR_MIN_RR` | 1.8 | `daily_predictor.py` | WHALE_RADAR R:R floor |
| `WHALE_RADAR_POSITION_SIZE` | 0.02 | `daily_predictor.py` | WHALE_RADAR position (2%) |

> ⚠️ **ممنوع** رفع `hard_loss_ceiling_pct` فوق 7% أو `split_drop_threshold_pct` فوق 35% بدون موافقة المالك + قياس backtest.

---

## 18. Canonical Indicators (Rule 67) — 13 functions

| # | Indicator | File | LOC | الصيغة |
|---|---|---|---:|---|
| 1 | `calc_rsi` | `rsi.py` | 66 | Wilder's smoothing |
| 2 | `calc_atr` | `atr.py` | 74 | Wilder's smoothing |
| 3 | `calc_srsi` | `srsi.py` | 125 | Stochastic RSI |
| 4 | `sma` | `ma.py` | 125 | Simple MA |
| 5 | `ema` | `ma.py` | 125 | Exponential MA |
| 6 | `macd` | `ma.py` | 125 | MACD(12,26,9) |
| 7 | `calc_bollinger` | `bollinger.py` | 119 | BB + bandwidth + %b |
| 8 | `calc_mfi` | `mfi.py` | 98 | Money Flow Index |
| 9 | `calc_adx` | `adx.py` | 143 | ADX/DMI Wilder's |
| 10 | `calc_vwap` | `vwap.py` | 103 | VWAP session/rolling |
| 11 | `calc_vwap_premium` | `vwap.py` | 103 | VWAP premium % |
| 12 | `calc_volume_profile` | `volume_profile.py` | 132 | POC/VAH/VAL |
| 13 | `calc_bollinger_series` | `bollinger.py` | 119 | BB series للرسوم |

> كلهم **Pure Functions** — 60/66 inline functions تم delegation (91%).

### Rule 67 — CALCULATION-CANONICAL

```python
# ❌ FORBIDDEN — inline calculation
def my_rsi(closes, period=14):
    deltas = np.diff(closes)
    gains = ...
    return 100 - (100 / (1 + rs))

# ✅ CANONICAL — use the single source
from analyzers.indicators.rsi import calc_rsi
rsi = calc_rsi(closes, period=14)
```

---

## 19. Kill Filters (Hard Gates)

قبل أي BUY signal يطلع، لازم يعدي كل الـ kill filters دي:

| # | Filter | File | الحد |
|---|---|---|---|
| 1 | **Liquidity filter** | `analyzers/liquidity_filter.py::evaluate_kill_filters` | minimum volume + turnover (dynamic) |
| 2 | **Sector heat filter** | `predictor_modules` + `load_sector_heat` | reject if sector is falling |
| 3 | **Whale distribution guard** | `predictor_modules/whale_guard.py` | block BUY if smart money is distributing |
| 4 | **Toxic ticker blocklist** | `config/toxic_ticker_blocklist.json` (Rule 28) | skip known-bad tickers |
| 5 | **EGX canonical gate** | `utils/egx_gate.py` | only EGX canonical tickers |
| 6 | **Regime filter** | `analyzers/regime_filter.py` | DEFENSIVE → min_score=75, AGGRESSIVE → min_score=70 |
| 7 | **Persona fit** | `predictor_modules/persona_fit.py` | (optional — only if persona != 'balanced') |
| 8 | **Ticker Cooldown** | `analyzers/ticker_cooldown.py` (Rule 74) | 5 losses → 14 days block |
| 9 | **Circuit Breaker** | `utils/circuit_breaker.py` (Rule 74) | 3 losses → 3 days block |
| 10 | **R:R floor gate** | `vps-service/jobs/daily_predictor.py:314-326` | R:R < 1.8 → reject (Rule 18) |
| 11 | **ATR stop clamp** | `engines/backtest_engine.py::simulate_trade` | stop distance > 9% → tighten (Rule 8) |
| 12 | **Penny stock filter** | `liquidity_filter.py` | price < 1.0 EGP → reject |
| 13 | **Suspended stock filter** | `liquidity_filter.py` | suspended = 1 → reject |

> لو أي filter فشل، الـ signal يتـ downgrade لـ HOLD (أو يتـ skip بالكامل).

---

## 20. الـ 5 Pillars (Constitution §الـ 5 Pillars)

| # | Pillar | File | الوظيفة |
|---|---|---|---|
| 1 | **Liquidity First** | `analyzers/liquidity_filter.py` | Hard gate: لا تحلل سهم مش متداول |
| 2 | **Market Regime** | `analyzers/market_regime_engine.py` | DEFENSIVE/NORMAL/AGGRESSIVE |
| 3 | **Sector-Relative Fundamentals** | `analyzers/fundamental_relative.py` | مقارنة بـ القطاع (مش absolute) |
| 4 | **Session Dynamics** | `analyzers/session_timing.py` | توقيت الدخول (مش "best hours") |
| 5 | **Unified Scoring** | `analyzers/master_analyzer.py` | Weighted combination — THE BRAIN |
| 6 | **Risk Profile** | `core/opportunity_quality.py` | Position, Stop, Target, Time |
| 7 | **Feedback Loop** | `analyzers/feedback_loop.py` + `jobs/learning_engine.py` | Learn from mistakes |

---

## 21. Decision Flow النهائي

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
  'evidence': 5,  # 0-6 (count of confirmed signals)
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
    'benchmark': '✅ Outperforming EGX30 (+2.1% vs +0.5%)',
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

### AnalysisCache

Per-ticker analyses are cached for 60s (`AnalysisCache` in `cache_manager.py`). Same ticker + intent + persona within 60s = O(1) cache hit (no CPU spent).

---

## 22. الأداء (Performance)

### Engine Speed Hierarchy

| Engine | Speed | Use Case |
|--------|-------|----------|
| V20 Fusion | ~50ms | Real-time (intent='live') |
| Master Analyzer | ~150ms | Daily depth (intent='daily') |
| V38 Backtest | ~500ms | Full backtest (intent='full') |
| Daily Predictor (full scan, 289 tickers) | ~5-15 min | Cron job |
| Learning Engine | ~30s | Cron job |

### Performance Optimizations

| Optimization | Effect | File |
|---|---|---|
| `pre_cache_price_history()` (Phase 8.2) | 180x speedup (225s → 1.4s for price-loading phase) | `predictor_modules/price_cache.py` |
| `AnalysisCache` (60s TTL) | O(1) cache hit for repeated analyses | `core/cache_manager.py` |
| `ApiResponseCache` (60-300s TTL) | Caches full API responses | `core/cache_manager.py` |
| WAL mode | Readers don't block writer | `core/db_manager.py` |
| `immutable=1` fallback | Bypasses WAL for cold reads | `core/db_manager.py` |
| `better-sqlite3` native | 5-10x faster than sql.js | `src/lib/shared-db.ts` |
| Strangler Pattern extraction | -5.4% LOC in daily_predictor.py | `predictor_modules/*` |

### KPIs الحالية (live production)

| KPI | Value | Target | Status |
|---|---:|---:|:---:|
| Win Rate (live production) | ~69.2% (تقارير المالك 2026-08-17) | ≥ 60% | ✅ |
| Profit Factor (live production) | ~4.46 | ≥ 1.5 | ✅ |
| Expectancy per trade | +1.54% (after dynamic R:R 1.5/2.0 fix) | > 0 | ✅ |
| Max Drawdown (V40.2 backtest) | 12.4% | < 20% | ✅ |

---

## 📚 مراجع إضافية

| المرجع | المحتوى |
|---|---|
| `Documentation/00-CONSTITUTION.md` | Rule 8 (ATR stop) + Rule 18 (R:R) + Rule 19 (Hard Loss Ceiling) + Rule 20 (Python=Brain) + Rule 21 (V40.2 sole production engine) + Rule 22 (dedup-by-ticker) + Rule 23 (PERSONA-UNIFY-A) + Rule 24 (Fundamentals real) + Rule 67 (CALCULATION-CANONICAL) + Rule 73 (SINGLE-DISPLAY-SOURCE) + Rule 74 (TICKER-COOLDOWN) |
| `Documentation/01-ARCHITECTURE.md` | المعمارية العامة + الـ 4 services |
| `Documentation/02-DATABASES-AND-DATA.md` | الـ DBs + DAL + مصادر البيانات |
| `Documentation/04-ENGINES-ARCHITECTURE.md` | تفاصيل إضافية عن الـ 4 logical engines |
| `Documentation/ENGINES-MASTER-REFERENCE.md` | موسوعة المحركات الشاملة |
| `Documentation/03-HOW-IT-THINKS.md` | كيف يحلّل النظام سهمًا (الـ 6 طبقات) |
| `vps-service/engines/` | الـ 15 engine file |
| `vps-service/analyzers/` | الـ 119 analyzer file |
| `vps-service/jobs/` | الـ 15 job file |
| `vps-service/analyzers/indicators/` | الـ 13 canonical indicator (Rule 67) |

</div>
