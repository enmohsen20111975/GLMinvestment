# 04 — Engines Architecture

> The 4 engines + DAL + Enforcement Layer + Modularization + CI/CD + Caching.
> Part of Phase 7.4 architecture documentation.

## 1. Overview

The backend has **4 logical engines** that share a common foundation
(DAL + Enforcement Layer). Each engine is independent but communicates
through the database layer.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        vps-service/                                  │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │  JOB ENGINE   │  │  ANALYZER    │  │  LEARNING   │  │   API    │ │
│  │               │  │  ENGINE      │  │  ENGINE     │  │  ENGINE  │ │
│  │  • daily_     │  │              │  │              │  │          │ │
│  │    predictor  │  │  • decision_ │  │  • learning_ │  │  • Flask │ │
│  │  • daily_     │  │    router    │  │    engine   │  │    app   │ │
│  │    closer     │  │  • V20 fusion│  │  • weights  │  │  • 40+   │ │
│  │  • market_    │  │  • V38 back-  │  │    updater  │  │    routes│ │
│  │    scheduler  │  │    test       │  │  • lesson   │  │  • cache │ │
│  │  • price_     │  │  • master     │  │    extractor│  │    layer │ │
│  │    history_*  │  │    analyzer   │  │              │  │          │ │
│  │  • intraday_* │  │  • 20+ analy- │  │              │  │          │ │
│  │  • fetch_corp │  │    zers       │  │              │  │          │ │
│  │  • wal_check  │  │              │  │              │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
│         │                  │                │              │        │
│         └──────────────────┴────────────────┴──────────────┘        │
│                              │                                       │
│                              ▼                                       │
│              ┌───────────────────────────────┐                       │
│              │   CORE — Data Access Layer   │                       │
│              │   • db_manager.py (singleton) │                       │
│              │   • cache_manager.py          │                       │
│              │   • database.py (legacy DAL) │                       │
│              │   • migrator.py               │                       │
│              └───────────────────────────────┘                       │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                ┌──────────────┴───────────────┐
                │   ENFORCEMENT LAYER            │
                │   • scripts/check_architecture│
                │   • tests/test_architecture   │
                │   • .git/hooks/pre-commit     │
                │   • .github/workflows/arch-*  │
                └────────────────────────────────┘
```

---

## 2. Engine 1 — Job Engine

**Purpose**: Background cron jobs that run on a schedule.

**Location**: `vps-service/jobs/`

### Components

| File | Purpose | Schedule |
|------|---------|----------|
| `daily_predictor.py` | V40.2 prediction generator (4,717 LOC) | Daily 14:30 |
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
| `wal_checkpoint.py` | WAL checkpoint utility (manual) | Manual |

### Modularization Status (Phase 7.2 + 8.2)

`daily_predictor.py` was the mega-file (4,986 LOC). After Strangler Pattern
extraction, 8 functions/blocks were extracted to `predictor_modules/`:

**Phase 7.2 (5 modules)**:
- `persona_fit.py` — `compute_persona_fit()`
- `whale_guard.py` — `_whale_distribution_guard()`
- `db_helpers.py` — `_open_db()` + `_V402_DBM_AVAILABLE` + `_dbm`
- `scan_dates.py` — `get_scan_dates()`
- `cleanup.py` — `delete_old_v40_predictions()` (DISABLED)

**Phase 8.2 (3 modules)**:
- `summary.py` — `compute_and_save_summary()` (PF + JSON save)
- `dry_run_printer.py` — `print_dry_run_summary()`
- `price_cache.py` — `pre_cache_price_history()` (180x speedup)

**Result**: daily_predictor.py = 4,986 → 4,717 LOC (-269 LOC, -5.4%).

All 8 functions are re-imported at the top of `daily_predictor.py` so callers
see no behavior change (Strangler Pattern = semantic equivalence).

---

## 3. Engine 2 — Analyzer Engine

**Purpose**: Take a ticker + intent → return structured analysis.

**Location**: `vps-service/engines/` + `vps-service/analyzers/`

### Core Engines

| Engine | File | Speed | Use Case |
|--------|------|-------|----------|
| V20 Fusion Engine | `engines/v20_fusion_engine.py` | ~50ms | Real-time analysis (intent='live') |
| V38 Backtest Engine | `engines/v38_backtest_engine.py` | ~500ms | Full backtest (intent='full') |
| Master Analyzer | `engines/master_analyzer.py` | ~150ms | Daily depth (intent='daily') |
| Decision Router | `engines/decision_router.py` | <1ms | Picks the right engine per intent |

### Specialized Analyzers (20+ files in `analyzers/`)

| Analyzer | Purpose |
|----------|---------|
| `technical.py` | RSI, MACD, MA, ATR, Bollinger Bands |
| `fundamental.py` | P/E, ROE, debt ratios, dividend yield |
| `timing.py` | Entry/exit timing signals |
| `patterns.py` | Candlestick + chart patterns |
| `fibonacci.py` | Fibonacci retracement + extension |
| `risk.py` | VaR, max drawdown, Sharpe |
| `liquidity_filter.py` | Hard gate: minimum volume + turnover |
| `adaptive_weights.py` | Per-persona weight table (PERSONA_INPUT_WEIGHTS) |
| `core_scoring_engine.py` | Volume surge + accumulation + recovery detection |
| `prediction_tracker.py` | Writes/reads predictions table |
| `news_analyzer.py` | News sentiment (uses news.db.market_news) |
| `confluence_engine.py` | Multi-factor confluence scoring |
| ... | 8 more specialized analyzers |

### Pipeline

```
analyze(ticker, intent, persona)
    │
    ▼
DecisionRouter.route(ticker, intent, persona)
    │
    ├──► if intent='live'   → V20FusionEngine.analyze(ticker)
    ├──► if intent='daily'   → MasterAnalyzer.analyze(ticker, depth='daily')
    ├──► if intent='full'    → MasterAnalyzer.analyze(ticker, depth='full')
    │                            + V38BacktestEngine.simulate(ticker)
    └──► if intent='auto'    → pick based on market hours

Result (see 03-HOW-IT-THINKS.md §4 for full schema):
{
  'success': True, 'ticker': 'COMI', 'signal': 'BUY',
  'evidence': 5, 'tech_score': 78.5,
  'entry': 18.50, 'target': 21.20, 'stop': 17.40,
  'proofs': {...}, 'persona_fit': 'balanced',
  'fit_scores': {...}, 'engine': 'master_analyzer',
}
```

---

## 4. Engine 3 — Learning Engine

**Purpose**: Extract lessons from prediction outcomes + update indicator weights.

**Location**: `vps-service/jobs/learning_engine.py`

### Feedback Loop

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

### Learning Tables

- `stocks.db.indicator_weights` — current weights (per indicator)
- `stocks.db.regime_indicator_weights` — per-regime weights (BULL/BEAR/SIDEWAYS)
- `stocks.db.indicator_trust_scores` — trust score (0-1) per indicator
- `stocks.db.conjunction_patterns` — multi-indicator patterns
- `stocks.db.learned_lessons` — extracted lessons
- `predictions.db.prediction_lessons` — per-prediction lessons
- `predictions.db.learned_lessons` — mirror (legacy)

---

## 5. Engine 4 — API Engine

**Purpose**: Expose HTTP endpoints for the frontend + mobile apps.

**Location**: `vps-service/api/` + `vps-service/app.py`

### Structure

- `app.py` — Flask entry point; registers all blueprints
- `api/*.py` — 40+ blueprint files (one per domain)

See `02-API-DICTIONARY.md` for the full endpoint list.

### Request Lifecycle

```
HTTP Request
    │
    ▼
Flask app (app.py)
    │
    ├──► Blueprint routing (api/<domain>_routes.py)
    │
    ├──► Auth middleware (core/auth_middleware.py)
    │    ├──► require_auth: validates JWT against auth.db.Session
    │    └──► require_admin: checks auth.db.User.role
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

## 6. Data Access Layer (DAL)

**File**: `vps-service/core/db_manager.py` (487 LOC — already complete, do NOT modify)

### API Surface

- `db_manager.query(db, sql, params)` — SELECT → list of dicts
- `db_manager.query_one(db, sql, params)` — SELECT → single dict (or None)
- `db_manager.execute(db, sql, params)` — INSERT/UPDATE/DELETE → rowcount
- `db_manager.execute_many(db, sql, params_list)` — batch INSERT/UPDATE
- `db_manager.transaction(db)` — context manager (BEGIN/COMMIT/ROLLBACK)
- `db_manager.connection(db, writable=False)` — raw connection context
- `db_manager.table_exists(db, table)` — bool
- `db_manager.table_columns(db, table)` — list of column names
- `db_manager.ensure_column(db, table, column_def)` — safe ALTER
- `db_manager.health_check(db)` — integrity + journal_mode + page_count
- `db_manager.get_stats()` — {reads, writes, errors}
- `db_manager.reset_stats()` — zero counters

### Connection Settings

Every writable connection auto-sets:
- `PRAGMA journal_mode=WAL`
- `PRAGMA busy_timeout=30000` (30s)
- `PRAGMA synchronous=NORMAL`
- `PRAGMA wal_autocheckpoint=1000`
- `PRAGMA foreign_keys=ON`

Every readonly connection auto-sets:
- `mode=ro` (with `immutable=1` fallback if WAL/-shm corrupted)
- `PRAGMA busy_timeout=30000`
- `PRAGMA query_only=1` (extra safety)

After every write: `PRAGMA wal_checkpoint(PASSIVE)` runs automatically.

### Singleton Pattern

`DBManager.__new__` uses double-checked locking with `_instance` + `_instance_lock`
so every engine in every thread shares ONE instance.

Verified by `tests/test_architecture.py::test_db_manager_singleton`.

---

## 7. Enforcement Layer (Phase 7.1)

**Purpose**: Prevent new code from bypassing the DAL.

### Components

#### `scripts/check_architecture.py` (449 LOC)
AST-based scanner that detects:
- **CATEGORY B (VIOLATION)**: direct `sqlite3.connect()` in normal code path
- **CATEGORY A (WARNING)**: `sqlite3.connect()` inside `except` block (safety fallback)
- **Monkey-patch (WARNING)**: `sqlite3.connect = patched_func` (WAL hook)

Flags:
- `--strict` — exit(1) on any CATEGORY B violation
- `--file PATH` — scan a single file
- `--quiet` — suppress CATEGORY A warnings

Whitelist (5 files allowed to use sqlite3 directly):
- `vps-service/core/db_manager.py` (the DAL itself)
- `vps-service/core/database.py` (legacy DAL — backward compat)
- `vps-service/lightweight_server.py` (standalone server)
- `vps-service/core/migrator.py` (schema migration tool)
- `vps-service/jobs/wal_checkpoint.py` (WAL checkpoint utility)

#### `vps-service/tests/test_architecture.py` (5 pytest tests)
1. `test_no_direct_sqlite_connect_in_vps_service` — baseline ratchet (515)
2. `test_no_direct_sqlite_connect_in_scripts` — baseline ratchet (544)
3. `test_db_manager_exists` — DAL file present + importable
4. `test_db_manager_has_query_method` — DAL exposes query/execute/connection
5. `test_db_manager_singleton` — DAL uses singleton pattern

#### `.git/hooks/pre-commit`
Bash script that runs `check_architecture.py` on STAGED .py files only.
Blocks the commit if any staged file introduces a NEW direct
`sqlite3.connect()` call. CATEGORY A warnings (safety fallbacks) are allowed.

---

## 8. CI/CD Pipeline (Phase 8.1)

**File**: `.github/workflows/architecture-checks.yml`

### Jobs

#### `architecture-guard`
1. Checkout code
2. Set up Python 3.12
3. Install pytest
4. Run `python3 scripts/check_architecture.py --strict`
5. Run `python3 -m pytest tests/test_architecture.py -v --tb=short`

#### `syntax-check`
1. Checkout code
2. Set up Python 3.12
3. For every `.py` file (excluding `archive/`, `garage/`, `__pycache__/`):
   - Run `python3 -m py_compile "$f"`
   - If any file fails: count + exit 1
4. If all files compile: pass

### Triggers
- `push` to `main` / `develop`
- `pull_request` to `main` / `develop`

---

## 9. Caching Layer (Phase 8.4)

**File**: `vps-service/core/cache_manager.py`

### Two Caches

#### `AnalysisCache` (per-ticker analysis, TTL=60s)
- Key: `(ticker_upper, intent_lower, persona_lower)`
- Value: router response dict
- Backend: `cachetools.TTLCache` (fallback: dict + timestamps)
- Singleton: `analysis_cache = AnalysisCache()`
- API: `get()`, `set()`, `invalidate()`, `clear()`, `get_stats()`, `reset_stats()`

#### `ApiResponseCache` (per-endpoint response, TTL=60-300s) — NEW in Phase 8.4
- Key: `endpoint_name|sorted_params_string`
- Value: `(expiry_ts, data)`
- Backend: in-memory dict + threading.Lock
- Singleton: `api_cache = ApiResponseCache(default_ttl=300, maxsize=256)`
- LRU-by-expiry eviction (oldest expiry_ts evicted when at capacity)
- API: `get(endpoint, params)`, `set(endpoint, data, ttl, params)`, `invalidate(endpoint, params)`, `clear()`, `get_stats()`, `reset_stats()`

### Endpoints Using ApiResponseCache

| Endpoint | TTL | Params |
|----------|-----|--------|
| `/api/market/overview` | 300s | `{market or 'all'}` |
| `/api/market/intraday-pressure` | 60s | None (single cache entry) |
| `/api/market/investor-flows` | 300s | `{market}` |
| `/api/sectors/tracking` | 300s | ALL filter params (market, sort, order, ...) |

Each cached response includes:
- `cached: true/false` — whether this is a cache hit
- `cache_ttl: <seconds>` — TTL for client transparency

---

## 10. Modularization Status (Strangler Pattern)

### Phase 7.2 — Extracted 5 functions to `predictor_modules/`

| Module | Function | Original LOC |
|--------|----------|--------------|
| `persona_fit.py` | `compute_persona_fit()` | 37 |
| `whale_guard.py` | `_whale_distribution_guard()` | 24 |
| `db_helpers.py` | `_open_db()` + flag + singleton | 41 |
| `scan_dates.py` | `get_scan_dates()` | 87 |
| `cleanup.py` | `delete_old_v40_predictions()` (DISABLED) | 58 |
| **Total** | | **247 LOC** |

### Phase 8.2 — Extracted 3 blocks from `run_generator()` to `predictor_modules/`

| Module | Function | Original LOC |
|--------|----------|--------------|
| `summary.py` | `compute_and_save_summary()` | 52 |
| `dry_run_printer.py` | `print_dry_run_summary()` | 11 |
| `price_cache.py` | `pre_cache_price_history()` | 34 |
| **Total** | | **97 LOC** |

### Cumulative Impact

| Metric | Before Phase 7.2 | After Phase 8.2 | Change |
|--------|-------------------|------------------|--------|
| `daily_predictor.py` LOC | 4,986 | 4,717 | -269 (-5.4%) |
| # of predictor_modules | 0 | 8 | +8 |
| Modularization degree | 0% | ~7% (of mega-file) | +7% |

### Strangler Pattern Principles Followed

1. **Semantic equivalence**: every extracted function is copied VERBATIM
2. **Re-import at top of mega-file**: callers see no behavior change
3. **Original definitions removed**: no duplicate code
4. **Stub markers preserved**: line offsets approximately preserved for git blame
5. **Path setup moved BEFORE imports**: needed because `db_helpers.py` imports
   from `core.db_manager` (requires `vps-service/` on `sys.path`)

---

## 11. Architecture Rules

These rules are enforced by code review + the scanner + the test suite:

| Rule | Description | Enforcement |
|------|-------------|-------------|
| **DAL-only** | No direct `sqlite3.connect()` (except in 5 whitelist files) | check_architecture.py + pre-commit hook |
| **WAL on writes** | Every write connection MUST set WAL + busy_timeout | db_manager.py auto-sets |
| **Readonly safety** | Reads use `mode=ro` with `immutable=1` fallback | db_manager.py auto-sets |
| **No fake data** | Rule 27 — never invent numbers | Code review |
| **Verify before delete** | Rule 16 — disabled functions kept as dead code | cleanup.py preserves dead code |
| **Engine unify** | Rule 35 — V40.2 is the only sanctioned predictor | delete_old_v40_predictions() is DISABLED |
| **Strangler Pattern** | Extract → re-import → remove original | daily_predictor.py + predictor_modules/ |
| **Singleton DAL** | All engines share ONE DBManager instance | tests/test_architecture.py |
| **is_active filter** | All reads from `stocks` must filter `is_active=1` | EGX gate + code review |
| **No push to main** | Sandbox only | Manual enforcement |
| **Pre-commit hook** | Blocks commit if any staged .py introduces new violation | .git/hooks/pre-commit |

---

## 12. Future Work

### Remaining modularization targets (not done in Phase 7.2 + 8.2)

| Block | LOC | Risk | Notes |
|-------|-----|------|-------|
| `get_tickers()` | ~145 | Medium | Uses EGX gate + 3 DB fallbacks |
| `load_sector_heat()` | ~30 | Low | Single DB read |
| `_integrate_whale_radar_predictions()` | ~300 | High | Many internal deps |
| Radar fallback block in run_generator | ~50 | Medium | Uses `detect_pre_surge` etc. |
| `inject_whale_radar_picks()` | ~150 | Medium | Standalone function |
| `main()` CLI parser | ~150 | Low | Pure CLI |

### DAL migration progress

| Status | Count |
|--------|-------|
| Whitelisted (allowed to use sqlite3 directly) | 5 files |
| Migrated to DAL | ~10 files |
| Still using direct sqlite3.connect | ~490 files |
| **Total .py files in vps-service + scripts + data_engine** | ~762 |

The baseline ratchet (515 + 544 = 1059 violations) only goes DOWN as
files are migrated. New code that adds violations makes
`tests/test_architecture.py` FAIL.

---

## 13. See Also

- `01-DATABASES-COMPLETE.md` — every DB the engines read/write
- `02-API-DICTIONARY.md` — every endpoint the API engine exposes
- `03-HOW-IT-THINKS.md` — system flow (end-to-end walkthrough)
- `vps-service/jobs/predictor_modules/__init__.py` — module docstring
- `vps-service/core/db_manager.py` — the DAL source
- `vps-service/core/cache_manager.py` — the caching layer source
- `scripts/check_architecture.py` — the enforcement scanner
