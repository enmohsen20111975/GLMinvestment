# 03-ENGINEERING_AND_DEPLOYMENT.md

> **الملف المرجعي الثالث** — الأدوات + التبعيات + النشر + Ops + المراقبة.
> مصدر الحقيقة لكل ما يخص الهندسة والتشغيل.

---

## 1. التكنولوجيا الأساسية

### Frontend Stack
| التقنية | الإصدار | الاستخدام |
|---|---|---|
| Next.js | 14.2.28 | Framework (App Router) |
| React | 18.2.0 | UI library |
| TypeScript | 5.9.3 | Language (strict mode) |
| Tailwind CSS | 4 | Styling |
| shadcn/ui | new-york | Component library |
| Recharts | 2.15.4 | Charts |
| framer-motion | 12.23.2 | Animations |
| Zustand | 5.0.6 | Client state |
| TanStack Query | 5.82.0 | Server state |
| next-auth | 4.24.11 | Authentication |
| Prisma | 5.22.0 | ORM (3 schemas) |
| better-sqlite3 | 11.10.0 | SQLite direct access |
| @sentry/nextjs | 11.0.0 | Error tracking |
| lucide-react | 0.525.0 | Icons |
| Bun | latest | Runtime + package manager |

### Backend Stack (Python)
| التقنية | الإصدار | الاستخدام |
|---|---|---|
| Python | 3.11 | Runtime |
| Flask | latest | API framework |
| gunicorn | 4 workers × 2 threads | Production server |
| SQLite | built-in | Database |

### Infrastructure
| التقنية | الاستخدام |
|---|---|
| PM2 | Process manager (7 services) |
| Caddy | Reverse proxy + auto-TLS |
| Docker | Containerization (vps-service + optional Next.js) |
| GitHub Actions | CI pipeline |
| Sentry | Error tracking + performance |

---

## 2. التبعيات (74 dependencies)

### Core Dependencies (مستخدمة فعليًا)
```
next@14.2.28                    react@18.2.0
next-auth@4.24.11               @prisma/client@5.22.0
better-sqlite3@11.10.0          prisma@5.22.0
@tanstack/react-query@5.82.0   zustand@5.0.6
recharts@2.15.4                 framer-motion@12.23.2
lucide-react@0.525.0            zod@4.0.2
bcryptjs@3.0.3                  jsonwebtoken@9.0.3
@sentry/nextjs@11.0.0           socket.io-client@4.8.3
date-fns@4.1.0                  clsx@2.1.1
tailwind-merge@3.3.1            cmdk@1.1.1
```

### Radix UI Primitives (shadcn/ui components)
```
@radix-ui/react-accordion       @radix-ui/react-alert-dialog
@radix-ui/react-avatar          @radix-ui/react-checkbox
@radix-ui/react-dialog          @radix-ui/react-dropdown-menu
@radix-ui/react-label           @radix-ui/react-popover
@radix-ui/react-progress        @radix-ui/react-scroll-area
@radix-ui/react-select          @radix-ui/react-separator
@radix-ui/react-slider          @radix-ui/react-switch
@radix-ui/react-tabs            @radix-ui/react-toast
@radix-ui/react-tooltip         + 20 more
```

### DevDependencies (22)
```
typescript@5.9.3                eslint@9.0.0
eslint-config-next@15.3.3       vitest@2.1.8
@testing-library/react@16.1.0   jsdom@25.0.1
playwright@1.60.0               pm2@7.0.1
tsx@4.22.4                      @types/react@18
```

---

## 3. بنية المشروع (Directory Structure)

```
GLMinvestment/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout + Providers + RTL + SEO
│   │   ├── page.tsx                  # SPA shell (1085 LOC, 59 view switch)
│   │   ├── globals.css               # Colors + fonts + tabular-nums
│   │   ├── error.tsx                 # App error boundary
│   │   ├── global-error.tsx          # Root error boundary
│   │   ├── loading.tsx               # Suspense skeleton
│   │   ├── not-found.tsx             # 404
│   │   ├── robots.ts                 # robots.txt
│   │   ├── sitemap.ts                # sitemap.xml
│   │   ├── api/                      # 463 routes في 100 مجموعة
│   │   ├── admin/                    # admin pages (4)
│   │   ├── legal/                    # legal pages (3)
│   │   ├── payment/                  # payment/success page
│   │   ├── backtest/                 # backtest page
│   │   └── rescue/                   # rescue page
│   ├── modules/                       # 17 frontend modules
│   │   ├── admin/                    # 40+ admin components
│   │   ├── auth/                     # DevLoginForm
│   │   ├── crypto/                   # CryptoPortfolioView
│   │   ├── dashboard/                # DashboardView + widgets
│   │   ├── education/                # AcademyView
│   │   ├── market-analysis/          # MarketAnalysisView
│   │   ├── news/                     # NewsFeedView
│   │   ├── portfolio/                # PortfolioView + BagHolderRescue
│   │   ├── predictions/              # PredictionTracking
│   │   ├── publishing/               # UserPublishingView
│   │   ├── radar/                    # Radar components
│   │   ├── reports/                  # ExecutiveReportView
│   │   ├── screener/                 # StockScreenerAdvanced
│   │   ├── sharia/                   # ShariaView
│   │   ├── simulation/               # SimulationView
│   │   ├── stock-analysis/           # StockDetailView
│   │   └── subscription/              # PricingView + modals
│   ├── components/                    # 31 + 5 standalone
│   │   ├── ui/                       # 49 shadcn components
│   │   ├── shared/                   # UnifiedTable + SafeWidget + canonical views
│   │   ├── layout/                   # Header + Footer + TopBar + MobileNav
│   │   ├── auth/                     # AuthGate + AuthView + modals
│   │   ├── notifications/            # NotificationCenter + CentralAlertMonitor
│   │   ├── alerts/                   # AlertsCenterView
│   │   ├── watchlist/                # EnhancedWatchlistView
│   │   ├── v82/                      # V82DecisionPanel
│   │   ├── seasonality/              # SeasonalityDashboard
│   │   └── ... (22 more)
│   ├── lib/                          # SSOT modules + utilities
│   │   ├── cache-manager.ts          # Central LRU cache (SSOT)
│   │   ├── canonical-signal.ts       # TS port of Python (Rule 72)
│   │   ├── canonical-rsi.ts          # RSI port
│   │   ├── canonical-price.ts        # Price resolution chain
│   │   ├── token-hash.ts             # SHA-256 token hashing
│   │   ├── api-response.ts           # Unified envelope (apiOk/apiErr)
│   │   ├── market-pulse-proxy.ts     # Canonical proxy helper
│   │   ├── python-backend.ts         # PYTHON_BACKEND_URL + pythonFetch
│   │   ├── auth-helper.ts            # getSessionUserId + requireAuthAsync
│   │   ├── admin-auth-server.ts      # requireAdminAsync
│   │   ├── rate-limiter.ts           # Token-bucket rate limiter
│   │   ├── logger.ts                 # JSON structured logging
│   │   ├── db.ts                     # authDb (Prisma)
│   │   ├── db-predictions.ts         # predictionsDb (Prisma)
│   │   ├── egx-db.ts                 # stocks.db direct access
│   │   ├── shared-db.ts              # data_engine.db + stocks.db
│   │   ├── valid-views.ts            # SSOT for hash routes
│   │   ├── store.ts                  # Zustand store
│   │   └── ... (40+ more)
│   ├── hooks/                        # use-toast + use-mobile
│   └── instrumentation.ts            # Server instrumentation + graceful shutdown
├── prisma/
│   ├── schema.prisma                 # 2 models (default — legacy)
│   ├── auth-schema.prisma            # 18 models (User, ApiToken, ...)
│   ├── predictions-schema.prisma     # 10 models (Prediction, ...)
│   ├── seed-subscriptions.ts         # Seed (outdated — 3 plans vs 6)
│   └── SCHEMA_STATUS.md              # Model status documentation
├── vps-service/                      # Python backend (THE BRAIN)
│   ├── analyzers/                    # 126 files (39 active)
│   │   ├── indicators/               # atr.py + rsi.py + ma.py + srsi.py
│   │   ├── core_scoring_engine.py    # V40.2
│   │   ├── master_analyzer.py       # Canonical merger
│   │   ├── v68_oracle.py             # Probability/fingerprint
│   │   └── [v82, sniper, confluence_v3, board_of_analysts]  # DISABLED
│   ├── engines/                      # backtest_engine + historical_backfill
│   ├── modules/                      # 8 backend modules
│   ├── routes/                      # unified_v2 + misc + scanner + chart
│   ├── scripts/                      # auto_git_sync + apply_guard_triggers
│   ├── utils/                        # canonical_signal.py + shared_liquidity.py
│   ├── ai/                           # deepseek_news_service (env-only)
│   ├── data/                         # scrapers (canonical: data_engine)
│   ├── tests/                        # 13+ pytest files
│   ├── Dockerfile                    # Python 3.11-slim + HEALTHCHECK
│   ├── docker-compose.yml            # egx-backend + egx-scheduler
│   ├── config.py                     # SHARED_DB_NAMES + config
│   └── main.py                       # Flask app entry
├── data_engine/                      # Data factory (port 5000)
│   ├── scrapers/                     # egksco + crypto + gold + forex
│   └── app.py                        # Flask app entry
├── news-agent/                       # News collector service
│   ├── collectors/                   # scrapers + rss + disabled
│   ├── ui/                           # dashboard (env-only key)
│   └── main.py
├── telegram-events/                  # Telegram bot bridge (port 3003)
│   └── index.ts
├── mini-services/                    # (empty — placeholder)
├── scripts/                          # 366 maintenance scripts
│   ├── archive_diagnostics/          # 26 diagnostic scripts
│   ├── migrate_calc_indicators.py    # ATR/RSI migration tracker
│   ├── smoke_load_test.py            # Load testing
│   └── copy-sqljs-to-standalone.js    # Build helper
├── db/                               # SQLite databases
│   ├── auth.db                       # 288 KB (18 models)
│   ├── predictions.db                # 216 KB (10 models)
│   ├── custom.db                     # 24 KB (legacy)
│   ├── stocks.db                     # Production (not in sandbox)
│   ├── data_engine.db                # Production (not in sandbox)
│   └── ... (JSON snapshots + reports)
├── data/                             # Reference data
│   ├── db_snapshot_2026-10-10/       # 18-part zip (~340MB)
│   └── pine_scripts/                 # 4 TradingView scripts
├── Documentation/                    # 5 canonical files (this set)
├── tests/                            # Build pipeline tests
├── examples/                         # WebSocket demo
├── .github/workflows/ci.yml          # CI pipeline (4 jobs)
├── ecosystem.config.js               # PM2 config (8 services)
├── Caddyfile                         # Sandbox gateway (:81)
├── Caddyfile.production              # Production gateway (:443 + TLS)
├── Dockerfile                        # Next.js multi-stage build
├── docker-compose.yml                # Next.js containerization
├── .env.example                      # Full env template
├── .gitignore                        # Includes !.env.example exception
├── package.json                      # 27 scripts, 74 deps
├── tsconfig.json                     # strict: true
├── eslint.config.mjs                 # ESLint config
├── tailwind.config.ts                # Tailwind config
├── next.config.ts                    # Next.js config (withSentryConfig)
├── proxy-server.js                   # Sandbox proxy (:3000 → :3001)
├── worklog.md                        # 70,000+ lines work log
├── CHANGELOG.md                      # Changelog
├── BACKLOG.md                        # Backlog
├── README.md                         # Project README
└── sentry.client.config.ts           # Sentry client (safe no-op)
└── sentry.server.config.ts           # Sentry server (safe no-op)
```

---

## 4. خدمات PM2 (8 services)

| # | Service | Port | Memory | Timeout | Auto-restart |
|---|---|---|---|---|---|
| 1 | python-backend | 8010 | 500M | 10s | ✅ |
| 2 | data-engine | 5000 | 500M | 10s | ✅ |
| 3 | nextjs | 3000 | 1500M | 15s | ✅ |
| 4 | ws-service | 3005 | 200M | 10s | ✅ |
| 5 | telegram-poster | — | 300M | 10s | ✅ |
| 6 | telegram-interactive-bot | — | 300M | 10s | ✅ |
| 7 | telegram-events | 3003 | 150M | 10s | ✅ |
| 8 | news-agent | — | 300M | 10s | ✅ |

### PM2 Commands
```bash
pm2 start ecosystem.config.js      # Start all services
pm2 status                          # View status
pm2 logs                            # View logs
pm2 monit                           # Real-time monitoring
pm2 restart all                     # Restart all
pm2 reload nextjs                    # Zero-downtime reload
```

### pm2-logrotate (مطلوب للإنتاج)
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 5. Build & Deploy

### Build Scripts (package.json)
```json
{
  "dev": "setsid -f bash scripts/watchdog.sh; sleep 10",
  "prebuild": "prisma generate && prisma generate --schema=prisma/auth-schema.prisma && prisma generate --schema=prisma/predictions-schema.prisma",
  "build": "NODE_OPTIONS='--max-old-space-size=4096' NEXT_TELEMETRY_DISABLED=1 next build --no-lint",
  "postbuild": "node scripts/copy-sqljs-to-standalone.js",
  "start": "NODE_ENV=production UV_THREADPOOL_SIZE=1 SWC_THREADPOOL=1 RAYON_NUM_THREADS=1 NODE_OPTIONS='--max-old-space-size=256 --no-warnings' next start -p 3000",
  "start:safe": "UV_THREADPOOL_SIZE=2 SWC_THREADPOOL=1 RAYON_NUM_THREADS=1 NODE_OPTIONS='--max-old-space-size=512' next start -p 3000",
  "lint": "eslint .",
  "test": "vitest run",
  "test:frontend": "vitest run",
  "test:backend": "cd vps-service && python3 -m pytest tests/ -v",
  "test:smoke": "python3 scripts/smoke_load_test.py",
  "db:generate": "prisma generate && prisma generate --schema=prisma/auth-schema.prisma && prisma generate --schema=prisma/predictions-schema.prisma",
  "db:push": "prisma db push"
}
```

### CI Pipeline (.github/workflows/ci.yml)
4 jobs على كل push/PR لـ main:
1. **lint** — `bun run lint`
2. **typecheck** — `bunx tsc --noEmit --skipLibCheck` (src/ only)
3. **python-compile** — `python3 -m py_compile` على كل `.py` في vps-service/
4. **secret-scanning** — بحث عن `sk-[a-f0-9]{32}` و `ghp_[a-zA-Z0-9]{36}`

### Dockerfile (Next.js — multi-stage)
```dockerfile
# Stage 1: deps — bun install
# Stage 2: builder — prisma generate × 3 + next build
# Stage 3: production — next start (port 3000, HEALTHCHECK)
```

### Deployment Steps
1. Clone repo + `bun install`
2. Copy `.env.example` → `.env.production` + fill real values
3. `bunx prisma db push` × 3 schemas
4. `bun run build`
5. Copy `Caddyfile.production` → `/etc/caddy/Caddyfile`
6. `pm2 start ecosystem.config.js`
7. `pm2 install pm2-logrotate`
8. Verify: `curl -I https://invist.m2y.net/api/health`

---

## 6. Environment Variables (الكاملة)

انظر `.env.example` للقالب الكامل. المتغيرات الحرجة:

| Var | مطلوب | Default | المخاطر |
|---|---|---|---|
| DATABASE_URL | ✅ | — | منخفض |
| NEXTAUTH_SECRET | ✅ | `''` | 🔴 لا يعمل NextAuth بدونها |
| NEXTAUTH_URL | ✅ | `undefined` | 🔴 secure cookies تعتمد عليها |
| GOOGLE_CLIENT_ID | ✅ | `''` | 🟡 OAuth معطّل |
| GOOGLE_CLIENT_SECRET | ✅ | `''` | 🟡 OAuth معطّل |
| SENTRY_DSN | optional | `''` | 🟡 Sentry معطّل |
| PYTHON_BACKEND_URL | ✅ | `http://127.0.0.1:8010` | منخفض |
| DATA_ENGINE_URL | ✅ | `http://localhost:5000` | منخفض |
| ALLOW_FORM_LOGIN | optional | `false` | منخفض (secure default) |
| ALLOW_ADMIN_BYPASS | optional | `false` | منخفض (secure default) |
| ADMIN_USERNAME | ✅ | — | منخفض |
| ADMIN_PASSWORD | ✅ | — | منخفض |
| BOT_API_SECRET | ✅ | — | 🟡 bot endpoints تفشل |
| DEEPSEEK_KEY | optional | `''` | 🟡 rule-based fallback |
| TELEGRAM_BOT_TOKEN | optional | `''` | 🟡 Telegram معطّل |
| EODHD_API_KEY | optional | `''` | منخفض |

---

## 7. المراقبة (Observability)

### Health Endpoints
```
GET /api/health          — Deep health check (Python + DBs + disk)
GET /api/keepalive       — Lightweight keepalive (status + uptime)
GET /api/metrics         — Prometheus metrics (text/plain)
```

### Prometheus Metrics (/api/metrics)
```
glm_process_uptime_seconds
glm_process_memory_rss_bytes
glm_process_memory_heap_used_bytes
glm_health_status (0=healthy, 1=degraded)
glm_python_backend_reachable
glm_node_version_info
```

### Sentry
- Client: `sentry.client.config.ts` (safe no-op if SENTRY_DSN unset)
- Server: `sentry.server.config.ts` (safe no-op if SENTRY_DSN unset)
- `tracesSampleRate: 0.1` (production) / `1.0` (dev)
- `ignoreErrors`: Hydration, ResizeObserver, AbortError, ECONNRESET, EPIPE

### Logging
- `src/lib/logger.ts` — JSON structured logging (12-factor)
- Levels: error → stderr, warn → stderr, info/debug → stdout
- `LOG_LEVEL` env var controls verbosity

### Graceful Shutdown
- `src/instrumentation.ts` — SIGTERM + SIGINT handlers
- Disconnects Prisma (auth + predictions)
- 2s grace period for in-flight requests
- Prevents WAL corruption

---

## 8. Testing

### Frontend Tests (Vitest)
- 21 test files في `src/__tests__/`
- Coverage: ErrorBoundary, alerts, api/health, predictions, db/integrity, radar, regime, security (SQL injection + auth guard), shared

### Backend Tests (pytest)
- 13+ test files في `vps-service/tests/`
- Coverage: circuit_breaker, db_manager, phase1_guards, phase_a_hotfix, phase_b_integrity, prices_gate, risk_profile, router_e2e, safe_insert_prediction, sector_intelligence, v20_fusion, weekly_radar_report

### Smoke Tests
- `scripts/smoke_load_test.py` — 50 concurrent requests على /api/health + /api/chart/full-analysis

### Test Commands
```bash
bun run test                # Frontend (vitest)
bun run test:backend        # Backend (pytest)
bun run test:smoke          # Smoke load test
```

---

## 9. الأداء (Performance)

### Optimizations الحالية
- ✅ Dynamic imports لكل الـ heavy views (`ssr: false` + `LazyTabLoader`)
- ✅ `withErrorBoundary` HOC لكل view (isolation)
- ✅ `SafeWidget` لكل widget في Dashboard
- ✅ Cache-manager LRU (max 512) + per-entry TTL
- ✅ Health endpoint caching (60s TTL)
- ✅ WebSocket adaptive polling (2s session / 30s off-session)
- ✅ `productionBrowserSourceMaps: false`

### أكبر 10 ملفات (تحتاج تقسيم مستقبلي)
| الملف | LOC |
|---|---|
| MakerRadarTab.tsx | 3,764 |
| EnhancedPortfolioView.tsx | 3,477 |
| DatabaseManagerFull.tsx | 3,291 |
| SpecialistAnalysisView.tsx | 2,971 |
| StockScreenerAdvanced.tsx | 2,707 |
| UnifiedTable.tsx | 2,601 |
| LearningVisuals.tsx | 2,583 |
| SuperLearningSystem.tsx | 2,489 |
| AcademyView.tsx | 2,483 |
| EngineControlRoomTab.tsx | 2,481 |

---

## 10. Known Issues (موثّقة — لا تعديل)

1. **3 npm scripts مكسورة** (pre-existing):
   - `check:guards` — يشير لملفات في `scripts/archive_diagnostics/`
   - `data:fill-missing` — يشير لملف غير موجود
   - الإصلاح: نقل الملفات أو حذف الـ script refs

2. **ESLint rules كلها "off"** — `eslint.config.mjs:7-43` (22 rule معطّلة)

3. **`noImplicitAny: false`** في `tsconfig.json:13` رغم `strict: true`

4. **No Prettier** — تنسيق الكود غير موحّد

5. **6 Prisma models ميتة** (Post + PortfolioHistory + Referral + ExpertTrackRecord + AnalysisJob + Watchlist-side)

6. **4 Map caches متبقية** للترحيل (egx-db + data-engine-db + unified-db + market-profile — imports added but not yet consolidated)

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
