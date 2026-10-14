# 09-FULL_ARCHITECTURE.md

> **Deep Dive 4** — المعمارية الشاملة العميقة + تدفق البيانات + البنية التحتية.
> مصدر الحقيقة لكل ما يخص البنية المعمارية على المستوى الهندسي.

---

## 1. المعمارية الرباعية (Quadruple-Service Architecture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        المستخدم النهائي                             │
│                                                                     │
│   ┌─────────────────┐    ┌─────────────────┐    ┌───────────────┐ │
│   │   Web Browser    │    │   Flutter App   │    │  Telegram Bot │ │
│   │   (Desktop/Mob)  │    │   (iOS/Android) │    │               │ │
│   └────────┬────────┘    └────────┬────────┘    └───────┬───────┘ │
└────────────┼──────────────────────┼──────────────────────┼─────────┘
             │                      │                      │
             ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Caddy Gateway (الإنتاج)                          │
│                                                                     │
│   :80  → 301 redirect to :443                                      │
│   :443 → auto-TLS (Let's Encrypt)                                  │
│   + Security headers (HSTS, X-Frame-Options, CSP, etc.)            │
│   + XTransformPort gateway (mini-services on other ports)         │
│   + WebSocket upgrade support                                      │
│   + gzip + zstd compression                                        │
│   + Access logging (JSON, rotated)                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js 14 (Port 3000)                            │
│                    "Node = DISPLAY ONLY" (Rule 20)                  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  App Router (src/app/)                                       │ │
│   │  ├── layout.tsx — Root layout + Providers + RTL + SEO       │ │
│   │  ├── page.tsx — SPA shell (1085 LOC, 59 view switch)        │ │
│   │  ├── api/ — 463 routes في 100 مجموعة                        │ │
│   │  ├── admin/ — 4 admin pages (server-gated)                  │ │
│   │  ├── legal/ — 3 legal pages                                 │ │
│   │  ├── payment/ — payment/success page                         │ │
│   │  ├── backtest/ — backtest dashboard                          │ │
│   │  └── rescue/ — BagHolderRescue page                          │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  Modules (src/modules/ — 17 frontend modules)                │ │
│   │  ├── admin/ (40+ components)                                 │ │
│   │  ├── dashboard/ (19 components)                              │ │
│   │  ├── stock-analysis/ (15 components)                         │ │
│   │  ├── market-analysis/ (20 components)                        │ │
│   │  ├── portfolio/ (12 components)                               │ │
│   │  ├── predictions/ (4 components)                             │ │
│   │  ├── education/ (10 components)                              │ │
│   │  ├── subscription/ (4 components)                            │ │
│   │  └── ... (9 more modules)                                    │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  SSOT Modules (src/lib/)                                     │ │
│   │  ├── cache-manager.ts — Central LRU cache (512 max, 60s TTL)│ │
│   │  ├── canonical-signal.ts — TS port of Python (271 LOC)      │ │
│   │  ├── canonical-rsi.ts — RSI port                             │ │
│   │  ├── canonical-price.ts — Price resolution chain            │ │
│   │  ├── token-hash.ts — SHA-256 token hashing                  │ │
│   │  ├── api-response.ts — Unified envelope (apiOk/apiErr)      │ │
│   │  ├── market-pulse-proxy.ts — Canonical proxy helper          │ │
│   │  ├── python-backend.ts — PYTHON_BACKEND_URL + pythonFetch   │ │
│   │  ├── auth-helper.ts — getSessionUserId + requireAuthAsync   │ │
│   │  ├── admin-auth-server.ts — requireAdminAsync               │ │
│   │  ├── rate-limiter.ts — Token-bucket rate limiter             │ │
│   │  ├── logger.ts — JSON structured logging                     │ │
│   │  ├── valid-views.ts — SSOT for hash routes                  │ │
│   │  ├── store.ts — Zustand store                                │ │
│   │  └── ... (40+ more)                                         │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  Database Layer                                              │ │
│   │  ├── Prisma (3 schemas)                                      │ │
│   │  │   ├── schema.prisma (2 models — legacy)                  │ │
│   │  │   ├── auth-schema.prisma (18 models)                     │ │
│   │  │   └── predictions-schema.prisma (10 models)              │ │
│   │  ├── better-sqlite3 (91 files direct access)                │ │
│   │  │   ├── egx-db.ts — stocks.db reader                       │ │
│   │  │   ├── shared-db.ts — data_engine.db + stocks.db          │ │
│   │  │   ├── finance-db.ts — finance queries                    │ │
│   │  │   └── ... (87 more)                                      │ │
│   │  └── sql.js (WASM SQLite for client-side)                   │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  Observability                                               │ │
│   │  ├── instrumentation.ts — graceful shutdown + metrics        │ │
│   │  ├── sentry.client.config.ts — client error tracking        │ │
│   │  ├── sentry.server.config.ts — server error tracking        │ │
│   │  ├── /api/health — deep health check (60s cache)            │ │
│   │  ├── /api/keepalive — lightweight keepalive                 │ │
│   │  └── /api/metrics — Prometheus metrics (text/plain)         │ │
│   └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               │ pythonFetch() — pure thin proxy (Rule 20)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Python Backend (Port 8010)                           │
│                 "Python = THE BRAIN" (Rule 20)                      │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  Flask + gunicorn (4 workers × 2 threads, timeout 120s)     │ │
│   │  Dockerfile: Python 3.11-slim + HEALTHCHECK every 30s       │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  vps-service/ — THE BRAIN                                    │ │
│   │  ├── analyzers/ (126 files, 39 active)                      │ │
│   │  │   ├── indicators/ (atr.py, rsi.py, ma.py, srsi.py)      │ │
│   │  │   │   └── Rule 67b: canonical calculations               │ │
│   │  │   ├── core_scoring_engine.py (V40.2 — THE BRAIN)        │ │
│   │  │   ├── master_analyzer.py (الدمج الموحد)                  │ │
│   │  │   │   └── THRESHOLDS: 78/65/55/40/25                     │ │
│   │  │   ├── v68_oracle.py (probability/fingerprint)           │ │
│   │  │   ├── institutional_decision_engine.py (6 proofs)        │ │
│   │  │   │   └── Maker states: accumulation/distribution/neutral│ │
│   │  │   └── [v82, sniper, confluence_v3, board_of_analysts]   │ │
│   │  │       └── SUB_ENGINE_DISABLED=True (do not re-enable)    │ │
│   │  ├── engines/                                                │ │
│   │  │   ├── backtest_engine.py                                  │ │
│   │  │   └── historical_backfill_engine.py                       │ │
│   │  ├── modules/ (8 backend modules)                           │ │
│   │  │   ├── admin/ — system management                         │ │
│   │  │   ├── ai/ — DeepSeek integration (env-only)              │ │
│   │  │   ├── market_data/ — scrapers + price history             │ │
│   │  │   ├── market_regime/ — bull/bear/range classification    │ │
│   │  │   ├── portfolio/ — portfolio analysis + risk             │ │
│   │  │   ├── predictions/ — V40.2 prediction engine             │ │
│   │  │   ├── radar/ — maker-radar + wyckoff                     │ │
│   │  │   └── telegram/ — bot integration                         │ │
│   │  ├── routes/ (unified_v2 + misc + scanner + chart)         │ │
│   │  ├── scripts/ (auto_git_sync + apply_guard_triggers)       │ │
│   │  │   └── Rule 81: NO --force (abort + notify)              │ │
│   │  ├── utils/ (canonical_signal.py + shared_liquidity.py)   │ │
│   │  ├── ai/ (deepseek_news_service — env-only, no fallback)  │ │
│   │  ├── data/ (scrapers — readers only, canonical in data_eng)│ │
│   │  ├── tests/ (13+ pytest files)                             │ │
│   │  ├── config.py (SHARED_DB_NAMES + config)                   │ │
│   │  └── main.py (Flask app entry)                              │ │
│   └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Data Engine (Port 5000)                              │
│                 "Data Factory" — يجلب البيانات                      │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  Flask — يجلب البيانات من:                                   │ │
│   │  ├── TradingView (live prices)                              │ │
│   │  ├── Yahoo Finance (historical)                             │ │
│   │  ├── EODHD (fundamentals)                                   │ │
│   │  └── Custom scrapers (EGX official)                        │ │
│   │                                                              │ │
│   │  scrapers/ (canonical data source):                          │ │
│   │  ├── egksco_scraper.py — EGX stocks                        │ │
│   │  ├── crypto_fetcher.py — Bitcoin/Ethereum/altcoins          │ │
│   │  ├── gold_silver_fetcher.py — precious metals              │ │
│   │  ├── forex_fetcher.py — currency exchange rates            │ │
│   │  └── tradingview_scraper.py — live quotes                  │ │
│   │                                                              │ │
│   │  يكتب في:                                                    │ │
│   │  ├── data_engine.db (stocks + prices + news + sharia)      │ │
│   │  └── stocks.db (shared with Next.js)                       │ │
│   └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. قواعد البيانات (7 DBs)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Database Layer (SQLite)                          │
│                                                                     │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────┐ │
│   │  auth.db (288 KB)   │  │ predictions.db (216)│  │ custom.db  │ │
│   │  18 Prisma models   │  │ 10 Prisma models    │  │ (legacy)   │ │
│   │                     │  │                     │  └────────────┘ │
│   │  • User             │  │  • Prediction      │                 │
│   │  • Account          │  │  • PersonaPredict  │  ┌────────────┐ │
│   │  • Session          │  │  • PredictionLog   │  │ metrics.db │ │
│   │  • ApiToken (hashed)│  │  • ExpertRecommend│  │ (system)   │ │
│   │  • SubscriptionPlan │  │  • CachedAnalysis  │  └────────────┘ │
│   │  • UserSubscription │  │  • StoredAnalysis │                 │
│   │  • MarketPricing    │  │  • AnalysisJob     │  ┌────────────┐ │
│   │  • PromoCode        │  │  • AnalysisEngine │  │ intraday.db│ │
│   │  • UserTelegramLink │  │  • TechnicalIndic │  │ (intraday) │ │
│   │  • Referral         │  │  • ExpertTrackRec │  └────────────┘ │
│   │  • UsageDaily       │  │                     │                 │
│   │  • B2bApiKey        │  │  21 @@index         │                 │
│   │  • + 8 more         │  │  4 triggers (guards)│                 │
│   └─────────────────────┘  └─────────────────────┘                 │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  stocks.db (shared — not Prisma managed)                    │ │
│   │  • stocks (ticker, name, price, sector, market)            │ │
│   │  • stock_daily_prices (OHLCV)                              │ │
│   │  • user_stock_watchlists (watchlist entries)               │ │
│   │  • portfolio_assets (holdings)                             │ │
│   │  • price_alerts (quick-add alerts)                        │ │
│   │  • market_news (news articles)                            │ │
│   │  • user_notifications (notifications)                      │ │
│   │  • user_posts (community — disabled)                       │ │
│   │  • community_* (disabled)                                   │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │  data_engine.db (shared — written by Data Engine)           │ │
│   │  • stocks (canonical stock list)                           │ │
│   │  • egksco_price_history (clean close prices)               │ │
│   │  • gold_prices / silver_prices / crypto_prices             │ │
│   │  • exchange_rates (forex)                                  │ │
│   │  • market_news (news + sentiment)                          │ │
│   │  • news_signals (importance scoring)                       │ │
│   │  • sharia_metrics (Islamic compliance)                     │ │
│   └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Connection Rules
- `PRAGMA foreign_keys = ON` في 10 lib files
- `shared-db.ts` لا يفعّل FK على DBs المشتركة مع Python (orphan rows محتملة)
- 4 triggers على predictions table (idempotent): prevent_invalid_prices + prevent_wrong_direction
- WAL mode for concurrent read/write

---

## 3. خدمات إضافية (4 mini-services)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ws-service (Port 3005) — Socket.io real-time push                 │
│  ├── Adaptive polling: 2s (session) / 30s (off) / 15min (delayed)  │
│  ├── Broadcasts: price updates + alert triggers                    │
│  ├── CORS: should be restricted to invist.m2y.net                  │
│  └── SIGTERM/SIGINT handlers (graceful shutdown)                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  telegram-events (Port 3003) — Telegram bot bridge                  │
│  ├── Forwards Telegram events to Python backend                    │
│  └── SIGTERM/SIGINT handlers                                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  telegram-poster + telegram-interactive-bot                          │
│  ├── poster: sends daily reports to Telegram channel                │
│  └── interactive: responds to bot commands (/stats, /predict)       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  news-agent — News collector service                                 │
│  ├── Collects news from Egyptian + international sources            │
│  ├── DeepSeek AI enrichment (env-only, no hardcoded keys)           │
│  ├── Filters by importance score (MIN_IMPORTANCE_SCORE)             │
│  └── POST to Python /api/news (canonical route)                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. تدفق البيانات (Data Flow)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  TradingView │     │ Yahoo Finance│     │    EODHD     │
│  (live)      │     │ (historical) │     │ (fundamentals)│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │  Data Engine   │
                   │  (port 5000)   │
                   │  scrapers/     │
                   └────────┬───────┘
                            │
                            ▼
                   ┌────────────────┐
                   │ data_engine.db │
                   │ stocks.db      │
                   └────────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │ Python Brain │ │ Next.js  │ │  ws-service  │
     │ (port 8010)  │ │(port 3000│ │  (port 3005) │
     │              │ │          │ │              │
     │ V40.2 + 6    │ │ reads   │ │ pushes live  │
     │ proofs +     │ │ via API │ │ prices via   │
     │ master_score │ │         │ │ Socket.io    │
     └──────┬───────┘ └────┬─────┘ └──────┬───────┘
            │              │              │
            └──────────────┼──────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │ predictions.db│
                   │ (updated by  │
                   │  Python)     │
                   └───────────────┘
```

### Rule 73: Single Display Source
```
Client requests stock detail
  → /api/stocks/[ticker]/unified (SSOT endpoint)
    → Python /api/stocks/[ticker]/unified
      → reads from stocks.db + data_engine.db
      → runs master_analyzer.py
      → returns unified response
  → Client renders TradePlanCard (if BUY per Rule 78)
```

---

## 5. أمان الاتصال (Communication Security)

### Between Services (localhost)
- Python backend: `http://127.0.0.1:8010`
- Data engine: `http://localhost:5000`
- WS service: `http://localhost:3005`
- All on localhost — no TLS needed internally

### Between Client + Caddy
- HTTPS enforced (Caddy auto-TLS)
- HSTS: max-age=31536000; includeSubDomains; preload
- Security headers: X-Frame-Options DENY + X-Content-Type-Options nosniff + CSP + Referrer-Policy
- CORS: same-origin only (no wildcard)

### Authentication Flow
```
1. User → /api/auth/google-signin (Google ID token)
2. Server verifies with Google tokeninfo
3. Server creates Bearer token: egx_${userId}_${uuid}_${timestamp}
4. Server hashes token (SHA-256) + stores hash in api_tokens
5. Server returns raw token to client (ONE TIME ONLY)
6. Client stores token + sends in Authorization: Bearer header
7. Server validates: hash(incoming) === stored_hash
8. Legacy tokens (plaintext) still work for 30 days (backward compat)
```

---

## 6. نظام الكاش الموحّد (Cache Architecture)

```
┌─────────────────────────────────────────────────────────────────────┐
│  cache-manager.ts (SSOT — LRU + TTL)                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Namespaces (prevent collisions):                            │  │
│  │  ├── da:stock:COMI          (data-adapter stocks)           │  │
│  │  ├── da:hist:COMI           (data-adapter historical)       │  │
│  │  ├── egxpy:quote:COMI       (egxpy-bridge quotes)           │  │
│  │  ├── msa:gold               (multi-source-adapter gold)     │  │
│  │  ├── msa:currency:USD      (multi-source-adapter currency)  │  │
│  │  └── health:deep            (health endpoint cache)         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Configuration:                                                    │
│  ├── maxEntries: 512 (LRU eviction)                               │
│  ├── default TTL: 60s                                              │
│  ├── Per-entry TTL: configurable per set() call                   │
│  └── getOrCompute(): read-through pattern                          │
│                                                                     │
│  Stats (via /api/metrics):                                         │
│  ├── entries (current count)                                       │
│  ├── hits / misses                                                 │
│  └── hitRate                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. المعمارية على مستوى الإنتاج (Production Topology)

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────┐
│  VPS (Hostinger / equivalent)                   │
│  IP: <production-ip>                            │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Caddy (:80 → :443)                       │ │
│  │  ├── auto-TLS (Let's Encrypt)             │ │
│  │  ├── Security headers                     │ │
│  │  └── reverse_proxy → localhost:3000       │ │
│  └──────────────────┬────────────────────────┘ │
│                     │                          │
│  ┌──────────────────▼────────────────────────┐ │
│  │  PM2 (8 services)                         │ │
│  │  ├── nextjs       (port 3000, 1500M RAM)  │ │
│  │  ├── python-backend (port 8010, 500M)     │ │
│  │  ├── data-engine  (port 5000, 500M)       │ │
│  │  ├── ws-service   (port 3005, 200M)       │ │
│  │  ├── telegram-events (port 3003, 150M)    │ │
│  │  ├── telegram-poster (300M)               │ │
│  │  ├── telegram-interactive-bot (300M)      │ │
│  │  └── news-agent (300M)                   │ │
│  └──────────────────┬────────────────────────┘ │
│                     │                          │
│  ┌──────────────────▼────────────────────────┐ │
│  │  SQLite DBs (in /root/GLMinvestment/db/) │ │
│  │  ├── auth.db                              │ │
│  │  ├── predictions.db                       │ │
│  │  ├── stocks.db                            │ │
│  │  ├── data_engine.db                       │ │
│  │  ├── intraday.db                          │ │
│  │  └── metrics.db                           │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Logs (pm2-logrotate)                     │ │
│  │  ├── ~/.pm2/logs/nextjs-out.log          │ │
│  │  ├── ~/.pm2/logs/nextjs-error.log        │ │
│  │  └── ... (8 services × 2 log files)      │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Cron Jobs                                 │ │
│  │  ├── Daily backup (midnight)              │ │
│  │  ├── DB VACUUM (weekly)                   │ │
│  │  └── pm2-logrotate (automatic)            │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 8. Build Pipeline

```
┌──────────────────────────────────────────────────────────┐
│  GitHub (main branch)                                   │
│                                                          │
│  Push → triggers CI (.github/workflows/ci.yml)          │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  CI Pipeline (4 jobs, parallel)                     │ │
│  │                                                    │ │
│  │  1. lint: bun run lint (EXIT=0 required)          │ │
│  │  2. typecheck: bunx tsc (src/ only)               │ │
│  │  3. python-compile: py_compile all .py files      │ │
│  │  4. secret-scanning: grep for sk-* + ghp_*        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  If all pass → ready for deploy                         │
└──────────────────────────────────────────────────────────┘

Deploy:
  ssh to VPS
  cd /root/GLMinvestment
  git pull --rebase origin main  (NEVER --force — Rule 81)
  bun install
  cd vps-service && source venv/bin/activate && pip install -r requirements.txt && cd ..
  bun run build
  pm2 reload all
  curl -I https://invist.m2y.net/api/health  (verify)
```

---

## 9. Limitations & Known Issues

1. **SPA hash routing** — لا SEO لكل شاشة (الـ search engines ترى Dashboard فقط)
2. **3 npm scripts مكسورة** — `check:guards` + `data:fill-missing`
3. **ESLint rules معطّلة** — 22 rule = "off"
4. **4 Map caches متبقية** — imports added but not yet consolidated
5. **10 شاشات تستخدم `<Table>` يدوي** — لم تُرحّل لـ UnifiedTable بعد
6. **6 Prisma models ميتة** — Post + PortfolioHistory + Referral + ExpertTrackRecord + AnalysisJob + Watchlist-side
7. **No central log aggregation** — لا Loki/ELK
8. **No e2e tests** — Playwright موجود لكن غير مستخدم

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
