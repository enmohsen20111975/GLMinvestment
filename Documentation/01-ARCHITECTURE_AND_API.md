# 🏛️ 01 — ARCHITECTURE & API Reference (المعمارية + مرجع الـ APIs)

> **الملف الأول من توحيد التوثيقات (DOC-UNIFY) — 2026-10-12.**
> هذا الملف هو **المصدر الأوحد للحقيقة** لمعمارية المشروع + خريطة الـ DBs + محركات V40.2 + مرجع الـ 411 API route + الـ Deployment + الـ Flutter App + الـ DB Resilience + الـ Runbooks.
>
> **المراجع التابعة (لا تكررها هنا — أشر إليها فقط):**
> - `00-CONSTITUTION.md` — الدستور (76 قاعدة) + DB Safety rules + Thresholds canonical + Persona policy
> - `02-SCREENS_AND_COMPONENTS.md` — شاشات الـ UI + 71 orphan + Pine Script V34 + Admin Views
> - `03-HOW_IT_THINKS.md` (سابقًا SYSTEM_HOW_IT_THINKS.md) — منطق V40.2 + Production Snapshot + 5-state taxonomy
>
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **Production URL:** `https://invist.m2y.net` · **Production root:** `/root/GLMinvestment/`
> **المراجع الحية:** `AGENTS.md` · `SYSTEM_STATE.md` · `worklog.md`

> **آخر تحديث:** 2026-10-12 (Task `DOC-UNIFY-2-ARCH-SCREENS` — توحيد التوثيقات. الملف مبني من دمج 5 مصادر مؤرشفة في `_archive_pre_unification_2026-10-12/`: `01-PROJECT_ANATOMY.md` (6,274 سطر — المصدر الرئيسي) + `03-API_REFERENCE.md` (1,476 سطر — يُدمج كاملًا كـ §5) + `09-FLUTTER-APP.md` (158 سطر — كـ §9) + `أوامر مساعدة .text` (308 سطر — كـ §7.5) + `DEPLOY-ROUND3.md` (275 سطر — كـ §15). قواعد DB Safety مُشار إليها فقط بـ `00-CONSTITUTION.md` §10 — لا تكرار.)
>
> **آخر تحديث سابق:** 2026-10-12 (Task `DOC-SECRETARY-SIDE-EFFECTS` — DOCUMENTATION-SECRETARY per Rule 70 — تحديث Documentation بعد SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE-COLLECTOR — 3 آثار جانبية عُولجت + 9 orphan components أُرشفت.)
>
> **آخر تحديث سابق:** 2026-10-12 (Task `DOC-SECRETARY-FINAL` — DOCUMENTATION-SECRETARY per Rule 70 — التحديث النهائي الشامل اللي بيعكس كل الإصلاحات الجديدة (P1-PARALLEL-ENGINES-FIX + MAESTRO-GHOST-HUNT + WRITE-GUARDED-EXTENSION).)

---

## 📑 المحتويات

| القسم | الموضوع |
|------|---------|
| [§1](#1-high-level-system-topology) | High-Level Topology (Quadruple-Service + Ports) |
| [§2](#2-full-directory-tree) | Full Directory Tree |
| [§3](#3-databases-map) | Databases Map (18 DBs + counts + schema) |
| [§4](#4-engine--service-map) | Engine/Service Map (V40.2 + 30+ analyzer) |
| [§5](#5-api-reference-الكامل) | API Reference الكامل (411 route عبر 26 قسم) |
| [§6](#6-data-flow) | Data Flow (8 stages) |
| [§7](#7-deployment--infra) | Deployment (Caddy + PM2 + Cron + Mini-services) + §7.5 الأوامر المساعدة |
| [§8](#8-module-architecture) | Module Architecture (Frontend 17 + Backend 9) |
| [§9](#9-flutter-app) | Flutter App (49 screen + 60+ API) |
| [§10](#10-ai-news-agent--corporate-actions) | AI News Agent + Corporate Actions |
| [§11](#11-db-resilience-strategy) | DB Resilience Strategy (14 قسم) |
| [§12](#12-production-data-engine-fix-runbook) | Production Data Engine Fix Runbook (3 مراحل) |
| [§13](#13-tickersymbol-unification-plan) | Ticker/Symbol Unification Plan |
| [§14](#14-data-engine-architecture) | Data Engine Architecture |
| [§15](#15-deployment-runbook-round-3) | Deployment Runbook Round 3 |
| [§16](#16-dead-code-inventory-مختصر) | فهرس Dead-Code Inventory (مختصر — التفصيل في 02) |

---

## 1. High-Level System Topology

> **Python = THE BRAIN · Node.js = DISPLAY ONLY · SQLite لكل شيء · Caddy هو البوابة الوحيدة المُعرَّضة.**

### 1.1 المعمارية الرباعية المعتمدة (Quadruple-Service Architecture)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (User) — https://invist.m2y.net                                  │
│     ↓ HTTPS (single exposed port)                                         │
│  Caddy Gateway (port 81)  ←── ?XTransformPort=N → any internal service    │
└──────────────────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────────────┐
       ↓                      ↓                              ↓
┌─────────────────┐  ┌──────────────────────┐    ┌────────────────────────┐
│ Next.js         │  │ Python Backend       │    │ WebSocket Service      │
│ port 3000       │──│ port 8010            │←───│ port 3005 (ws-service) │
│ DISPLAY ONLY    │  │ THE BRAIN            │    │ socket.io, polling 30s │
│ ~969 TS/TSX     │  │ Flask + 53 BP + WSGI │    │ Bun/TypeScript         │
│ NextAuth+Prisma │  │ ~395 .py files       │    │ 248 lines              │
└─────────────────┘  └──────────┬───────────┘    └────────────────────────┘
                                │ reads/writes (WAL)
                                ↓
                   ┌────────────────────────────────┐
                   │  SQLite DBs (db/vps_real/*.db) │
                   │  • predictions.db (153 preds)  │
                   │  • data_engine.db (tab_*)     │
                   │  • stocks.db (970 tickers)    │
                   │  • price_history.db (288k)    │
                   │  • auth.db (Prisma)           │
                   │  • +12 supporting stores      │
                   └────────────────────────────────┘
                                ↑ writes (scrapers)
                   ┌────────────────────────────────┐
                   │  Data Engine (port 5000)       │
                   │  • scrapers: tradingview,      │
                   │    yahoo, egxpilot, egksco,    │
                   │    news, coingecko             │
                   │  • sync.py + main.py           │
                   └────────────────────────────────┘
                                ↑ talks to
                   ┌────────────────────────────────┐
                   │  External APIs                 │
                   │  • EGKSCO (EGX رسمي)           │
                   │  • TradingView (TA + UDF)      │
                   │  • Yahoo (historical)          │
                   │  • EGXPilot (free fundamentals)│
                   │  • CoinGecko (crypto)          │
                   │  • NewsAPI / GNews             │
                   │  • Google OAuth + Paymob       │
                   │  • Telegram Bot API            │
                   │  • Ollama (port 11434, local)  │
                   └────────────────────────────────┘
```

### 1.2 المنافذ المعتمدة (Ports)

| الخدمة | Port | اللغة | المسار | الدور |
|---|---|---|---|---|
| **Next.js (frontend)** | `3000` | TypeScript | `./` (project root) | العرض الأمامي (DISPLAY ONLY) — لا منطق ولا حسابات |
| **Python Backend** | `8010` | Python 3.12 | `./vps-service/` | THE BRAIN — كل التحليلات والحسابات (Flask + 53 BP على FastAPI/WSGI) |
| **Data Engine** | `5000` | Python 3.12 | `./data_engine/` | سحب البيانات من المصادر الخارجية (10 scrapers) |
| **ws-service** | `3005` | Bun/TypeScript | `./vps-service/ws-service/` | WebSocket updates (socket.io، polling كل 30s للـ Python) |
| **telegram-events** | `3003` | Bun/TypeScript | `./mini-services/telegram-events/` | polling لأحداث Telegram كل 2s + broadcast للـ clients |
| **Caddy Gateway** | `81` | Go (binary) | `./Caddyfile` | البوابة الموحدة المُعرَّضة للإنترنت + `XTransformPort` |
| **Ollama (Local LLM)** | `11434` | Go (systemd) | systemd unit | RAG AI inference (`qwen2.5:1.5b` / `glm-fast:latest`) |

> ⚠️ **منفذ واحد مكشوف:** فقط منفذ `81` (Caddy) يُعرَّض للإنترنت. كل الباقي خلف الـ gateway.

### 1.3 قواعد المعمارية الصارمة (NON-NEGOTIABLE)

1. **Python = THE BRAIN** — كل المنطق والحسابات والتحليلات في Python.
2. **Node.js = DISPLAY ONLY** — لا منطق ولا حسابات في الواجهة، فقط proxy + عرض. لو لقيت `if/for/compute/aggregate` في `route.ts` لغير الـ auth/subscription/paywall → **architecture violation**.
3. **No DB writes from Node.js** — Node.js لا يكتب في SQLite (يقرأ عبر proxy فقط، عدا `auth.db` لإدارة المستخدمين عبر Prisma).
4. **WAL mode إجباري** — كل connection جديد يطبّق `PRAGMA journal_mode=WAL` + `busy_timeout=30000`.
5. **Unified Data Pipeline** — `load_merged_history()` في `vps-service/analyzers/master_analyzer.py` هو المصدر الوحيد لقراءة الأسعار.
6. **Strict Liquidity Filter** — أي سهم turnover يومي < 500,000 EGP → يُسقط من `stored_analyses` نهائياً.
7. **Single-Viewport** — شاشة `#trading-chart` 75% شارت + 25% sidebar بدون scroll عمودي على desktop.
8. **Commission edge + risk ceiling** (CONSTITUTION Rule 8) — ATR stop clamp **`[5%, 9%]`** مُفعّل في `v38_backtest_engine.py` (post-commit `65a748f` baseline + Task `REAPPLY-CRITICAL-FIXES` commit `38665fd1` — 2026-10-08 — رفع الحد الأدنى 3.0→5.0). حماية رأس المال مقدسة (Rule 19).
9. **Single-route shell** (CONSTITUTION Rule 3) — لا صفحات جديدة. كل شيء عبر hash routes من `/`.
10. **STICKY FOOTER** — الـ Footer لاصق أسفل كل شاشة (CSS sticky).

### 1.4 قاعدة الـ `?XTransformPort`

> آلية الـ Gateway: Caddy يستقبل كل الطلبات على المنفذ 81، ثم يحوّل الـ query param `XTransformPort=N` لتمرير الطلب للخدمة الداخلية على المنفذ `N`.

**الاستخدامات الموثقة (2 ملفات فقط):**
- `src/app/api/analysis-engine/route.ts` — يحوّل لـ analysis-engine على منفذ خاص.
- `src/app/api/telegram/[...path]/route.ts` — يحوّل لـ mini-service الـ `telegram-events` (port 3003).

**القاعدة الذهبية:** كل الـ routes الباقية تستخدم **relative-path-only** عبر `EGXPY_SERVICE_URL` (default `http://localhost:8010`). لا استدعاء مباشر لـ `localhost:8010` من الـ frontend؛ لازم يمر عبر `Next.js /api/proxy/[...path]`.

### 1.5 الإحصائيات الكلية (2026-10-12 — post HIDDEN-WRITERS-AUDIT + P1-PARALLEL-ENGINES-FIX)

| المؤشر | القيمة |
|---|---|
| Backend .py files | **450** (post-Wave-2 — 58 dead archived) |
| Backend LOC | ~199,490 (was ~229,490 — ~30K LOC archived) |
| Frontend `.tsx` files (components) | **247** (Wave 2 archived 51 dead .tsx + 16 dead shadcn) |
| Frontend LOC | ~343,000 |
| Flask Blueprints (registered) | 53 |
| Python `@bp.route` decorators | ~599 |
| Next.js `route.ts` files | **411** (Wave 8 — restored 32 Flutter endpoints) — 30 route مُؤمَّنة بـ auth + 7 SQLi sites fixed + 24 route async I/O |
| محرك قرار مؤسسي | V40.2 (institutional_decision_engine.py, ~520 LOC) |
| محرك backtest | V38 (v38_backtest_engine.py, 1,817 LOC) |
| Personas (نموذج التوقع) | **3 فاعلة**: `conservative` + `balanced` (baseline 81.8%) + `gambler` — `expert` معطّلة (Rule 23) |
| **DBs على الإنتاج (5 قواعد — أحجام)** | stocks.db=**15 MB** · data_engine.db=**273 MB** · predictions.db=**225 MB** · intraday.db=**428 MB** · price_history.db=**293 MB** · + `auth.db` (0.2 MB) |
| **عدد أسهم EGX** | **380 سهم** (stocks.db — EGX) |
| **مكونات EGX30 / EGX70** | 27 سهم / 20 سهم |
| عدد الأسهم في `stocks.db` (كل الأسواق) | ~976 سهم (EGX=380 · TADAWUL=413 · KSE=128 · QSE=55) |
| الأسهم في `data_engine.db.stocks` | **1,585 سهم** |
| **التوقعات الكلية في `predictions.db.predictions`** | **1,359 prediction** (333 `TARGET_HIT` + 193 `closed_stop` + 77 `ACTIVE` + باقي الحالات) |
| سجل التوقعات `aiPrediction` | 2,459 صف |
| `persona_predictions` | 946 صف |
| `historical_trades` | 550 صفقة تاريخية |
| `outcome_logs` | 8,544 سجل outcome |
| `news.db.news_articles` | **7,894 خبر** |
| `price_history.db.price_history` | **1,206,981 صف** (1,336 ticker، 2000→2026) |
| `data_engine.db.historical_data` | 99,076 صف OHLC تاريخي |
| `data_engine.db.screener_lists` | 1,505 إدخال في 5 فئات |
| **Live Win Rate (1,229 resolved predictions)** | **~50-55%** (تنقيح حقيقي بعد HELI-CLEANUP-2 — كان مُسجَّل 67.4% قبل الـ reconciliation) |
| **Avg Return per resolved prediction** | **25.74%** |
| **Live Profit Factor (PF)** | **12.84** |
| **Reconciliation mismatch rate** | **31.66%** (384 mismatches من 1,213 closed predictions) |
| **Max Loss Streak** | **7 صفقات خاسرة متتالية** (observed worst-case) |
| Fair re-sim PF (post-R:R fix) | 1.453 (148 trades، +0.189%/trade عن القاعدة العادلة) |
| R:R الحالي | dynamic 1.8 (normal) / 2.0 (outperform) — engine_settings |
| **PM2 services (7 — كان 6)** | python-backend (8010) + data-engine (8011) + nextjs (3001) + ws-service (3005) + telegram-poster + telegram-events (3003) + **news-agent** |
| **Test files / cases** | **9 files / 121 tests / 1,796 LOC** — 121/121 passing |
| **Observability stack** | Sentry (@sentry/nextjs@11.0.0) + structured logger + `/api/health` deep-check (262 LOC) + x-request-id middleware |

### 1.6 الـ 6-Market Architecture + UI-Mirror Protocol + SQLite Fallback Pattern

> **تحديث 2026-10-09 (Task `PHASE-3` — commit `b18b3f21`):** Multi-Market Segregation الكامل لـ **6 أسواق**. `normalizeMarket()` helper في `src/lib/market-utils.ts` (200 LOC) بيحوّل أي alias للـ canonical قبل أي DB/Python call.

**الأسواق الستة المدعومة:**

| السوق | الكود | المصدر | عدد الأسهم | Predictions |
|---|---|---|---:|---|
| EGX (مصر) | `EGX` | `stocks.db` + `data_engine.db` | **451** (sandbox) | ✅ 153 |
| TADAWUL (السعودية) | `TADAWUL` (aliases: KSA + السعودية + saudi) | `stocks.db` | **390** | ❌ `[]` + AR message (graceful 200) |
| KSE (الكويت) | `KSE` | `stocks.db` | **138** | ❌ `[]` + AR message |
| QSE (قطر) | `QSE` | `stocks.db` | **67** | ❌ `[]` + AR message |
| US (أمريكا) | `US` | `us_stock_scraper.py` (live on VPS) | 0 (sandbox) | ❌ `[]` + AR message |
| CRYPTO | `CRYPTO` | `data_engine.db.crypto_prices` + `crypto.db` | ~200 active tickers | ✅ independent endpoint |

**Canonical Market Normalization Helper (`src/lib/market-utils.ts`):**
- `normalizeMarket(input)` → يحوّل أي alias للـ canonical ('TADAWUL' / 'KSA' / 'السعودية' / 'saudi' → 'TADAWUL').
- `sqlMarketVariants(canonical)` → يرجّع كل DB variants.
- `buildMarketFilter(market, column)` → يبني SQL `WHERE market IN (?,?,?)` بـ placeholders صحيحة.
- `pythonMarketCode(market)` → يحوّل TADAWUL→KSA قبل الـ Python call.
- `NO_PREDICTIONS_MESSAGE_AR` + `NO_STOCKS_MESSAGE_AR` + `INTERNAL_ERROR_MESSAGE_AR`.

**UI-Mirror Protocol (القاعدة 53 — CRYPTO-IN-MARKETS):**
- شاشات الأسهم (`DashboardView`, `StocksView`, `EnhancedWatchlistView`, `TradingChartView`) بتتشارك نفس المكوّنات مع `currentMarket='CRYPTO'`.
- الـ `<MarketSwitcher />` هو نقطة التبديل الوحيدة — تفاصيله في `02-SCREENS_AND_COMPONENTS.md` §3.
- لما `currentMarket='CRYPTO'` → `InvestorsFlowPanel` + `MarketDepthPanel` بـ تختفي.
- لما `currentMarket='US'` → `DevelopmentNotice` بـ يظهر.

**SQLite Fallback Pattern (القاعدة 20 — Python = العقل، Node = العرض فقط):**
1. **حاول Python أولاً** (`fetch(EGXPY_SERVICE_URL + path)`).
2. **لو Python رفض/تأخر → اقرأ من SQLite** عبر `src/lib/sqlite-compat.ts` + `src/lib/sqlite-wrapper.ts`.
3. **لو SQLite فاضي → اقرأ من `data_engine.db`** (tier-3 fallback).

### 1.7 P0 Wave 2026-09-27 — Security + Observability + Tests

> **المرجع:** `worklog.md` entries `P0-12-SQLI` + `P0-17-RECONCILE` + `P0-7-15-INFRA` + `P0-14-ASYNC` + `P0-11-AUTH` + `HELI-INVESTIGATION` + `HELI-CLEANUP-2` + `P0-8-DB-UNIFY` + `P0-16-TESTS`.
> **الحالة:** ✅ **16/16 P0 items مُنجَزة**. الـ code health ارتفع من 48/100 → ~70/100.

**أ. Security Stack (P0-11-AUTH + P0-12-SQLI + /api/import hardening):**

| المكوّن | الحالة | التفاصيل |
|---|---|---|
| `src/lib/admin-guard.ts` | ✅ NEW 2026-09-27 (74 LOC) | Thin re-export of `requireAdminAsync` + new `requireAuthAsync(req)` لـ user-scoped routes |
| 30 API routes secured | ✅ | 4 admin + 26 non-admin عبر 44 HTTP method handlers |
| 7 SQL injection sites fixed | ✅ | 5 ملفات: `predictions/honest-tracking/*` + `finance/screener/*` + `tab-data/*` + `admin/clear-junk-data/*` + `admin/db-explorer/*`. 3 canonical patterns: bound `?` params + Set whitelist + strict identifier regex |
| `/api/import` hardening | ✅ | auth + 5MB size limit + rate limit + MIME whitelist |

**ب. Observability Stack (P0-7-15-INFRA):**

| المكوّن | الحالة | التفاصيل |
|---|---|---|
| `@sentry/nextjs@11.0.0` | ✅ NEW | `sentry.client.config.ts` + `sentry.server.config.ts`. 10% tx sampling prod / 100% dev / 100% errors |
| `src/lib/logger.ts` | ✅ NEW (90 LOC) | Structured JSON logger (`{"timestamp","level","message",...context}`). 4 levels. 12-factor compliant |
| `/api/health` | ✅ rewritten (60→262 LOC) | يفتح كل DB read-only + SELECT 1 + يـ ping PM2 ports + يفحص disk space. HTTP 200 ok/degraded / HTTP 503 down |
| `src/middleware.ts` | ✅ updated | يضيف `x-request-id` header على كل response (UUIDv4) |
| `ecosystem.config.js` | ✅ updated (6→7 services) | تم إضافة `news-agent` كـ service سابع |

**ج. Async I/O Refactor (P0-14-ASYNC):**
- 24 API routes refactored — ~70+ individual sync sites converted من `readFileSync`/`writeFileSync`/`existsSync`/`execSync` لـ `fs/promises` + `promisify(execFile)`.

**د. Database Unification (P0-8-DB-UNIFY):**
- 9 duplicate tables dropped (من 12 المُكتشفة). التفاصيل في §3.
- 4 DBs backed up لـ `*.bak-unify` (511.2 MB total).

**هـ. HELI False-Target Forensics (HELI-INVESTIGATION + HELI-CLEANUP-2):**
- Root cause: `daily_closer.py` استخدم heuristic خاطئ في 4 sites.
- Source fix: استبدال الـ heuristic بـ `if target_price > 0 and highest_price_reached >= target_price: status='TARGET_HIT'` + write-time assertion.
- Data cleanup: 308 false TARGET_HITs نُظّفت. كل 333 rows اتـ backed up.

**و. Tests (P0-16-TESTS):**
- 6 new test files: `sql-injection.test.ts` + `auth-guard.test.ts` + `import-endpoint.test.ts` + `pipeline.test.ts` + `integrity.test.ts` + `health.test.ts`.
- Test coverage: 3→9 files / 75→121 tests / 873→1,796 LOC — **121/121 passing**.
- Test philosophy: READ-ONLY DB connections لـ integrity tests + live HTTP fetch against `localhost:3001` لـ API integration tests.

---

## 2. Full Directory Tree

```
GLMinvestment/                              # ← PROJECT ROOT
├── .env / .env.example                     # 🔐 المتغيرات السرية (gitignored) + قالب
├── .zscripts/                              # 🐶 سكربتات الساندبوكس
├── AGENTS.md                               # 📜 دليل سير العمل للمطورين
├── CHANGELOG.md                            # 📝 سجل التغييرات
├── Caddyfile                               # 🌐 بوابة Caddy على المنفذ 81
├── DEPLOYMENT_GUIDE.md                     # 🚀 دليل النشر الكامل
├── ecosystem.config.js                     # ⚙️ إعداد PM2 (7 خدمات)
├── worklog.md                              # 📒 سجل العمل اليومي (gitignored)
├── package.json                            # v3.4.43 — Next.js 14.2.28 + React 18
├── bun.lock / bunfig.toml                  # أقفال + config الـ bun
├── tsconfig.json                           # TS 5.9.3 strict + @/* alias
├── tailwind.config.ts                      # Tailwind 3 (new-york preset)
├── next.config.ts / next.config.mjs        # Next.js config
├── postcss.config.mjs / eslint.config.mjs  # PostCSS + ESLint 9 flat config
├── components.json                         # shadcn/ui config
├── vitest.config.ts                        # frontend tests
│
├── prisma/                                 # 🗄️ Prisma schemas (3 منفصلة)
│   ├── schema.prisma                       # User + Post فقط (scaffold)
│   ├── auth-schema.prisma                  # auth.db models (User, Account, Session)
│   └── predictions-schema.prisma           # predictions.db models (proxy for Python raw SQL)
│
├── src/                                    # 🎨 FRONTEND (Next.js 14 App Router, TypeScript)
│   ├── app/                                # App Router root
│   │   ├── page.tsx                        # Single-route shell + renderView() switch
│   │   ├── layout.tsx                      # RTL + Sidebar + Header + Footer (sticky)
│   │   ├── globals.css                     # Tailwind + shadcn variables + dark mode
│   │   ├── api/                            # Next.js API routes (411 route.ts)
│   │   │   ├── proxy/[...path]/route.ts    # ⭐ catch-all proxy للـ Python
│   │   │   ├── auth/[...nextauth]/         # NextAuth.js (Google OAuth + Bearer)
│   │   │   ├── predictions/                # /api/predictions/* (Node + Python mixed)
│   │   │   ├── stored-analysis/            # /api/stored-analysis/* (Python proxy)
│   │   │   ├── chart/                      # /api/chart/* (full-analysis, V40.2)
│   │   │   ├── market/                     # /api/market/* (morning-bell, sectors)
│   │   │   ├── paymob/                     # /api/paymob/* (Node-only payment)
│   │   │   ├── telegram/[...path]/         # proxy للـ telegram-events mini-service
│   │   │   ├── analysis-engine/            # XTransformPort routing
│   │   │   └── ... (~411 route.ts total)
│   │   ├── admin/                          # admin iframe pages
│   │   └── (auth)/                         # login, register, google-signin
│   │
│   ├── components/                          # React components (~247 component)
│   │   ├── ui/                              # 44+ shadcn/ui primitives (new-york preset)
│   │   ├── analysis/                        # MarketAnalysisView, InstitutionalDecisionPanel
│   │   ├── predictions/                     # PicksManagementView, PredictionTrackingDashboard
│   │   ├── advanced-analysis/               # SpecialistAnalysisView
│   │   ├── market/                          # ChartStack, persona cards (6), MarketPulseWidget
│   │   ├── portfolio/                       # PortfolioView, PositionManager
│   │   ├── admin/                           # AdminView + 34 components
│   │   ├── layout/                          # Sidebar, MobileNav, Header, Footer (sticky)
│   │   └── shared/                          # ExpertIntelligencePanel, Cards, Modals
│   │
│   ├── modules/                             # 🆕 Module system (17 modules — see §8)
│   │   ├── radar/                           # 8 components + 3 lib
│   │   ├── publishing/                      # 3 components + 2 lib
│   │   ├── personalized/                    # 1 lib
│   │   ├── stock-analysis/                  # 15 components (StockDetail)
│   │   ├── predictions/                     # 5 components (V40.2 tracking)
│   │   ├── portfolio/                       # 15 components (RoboAdvisor)
│   │   ├── screener/                        # 1 component (Advanced)
│   │   ├── market-analysis/                 # 24 components (SectorTracking)
│   │   ├── news/                            # 1 component (NewsFeedView)
│   │   ├── admin/                           # 34 components (DB Manager)
│   │   ├── crypto/                          # 8 components
│   │   ├── education/                       # 9 components (Academy+Learning)
│   │   ├── reports/                         # 5 components (Weekly Report)
│   │   ├── dashboard/                       # 21 widgets (home dashboard)
│   │   ├── simulation/                      # 1 component
│   │   ├── auth/                            # 1 component
│   │   └── subscription/                    # 4 components
│   │
│   ├── lib/                                 # Frontend utilities
│   │   ├── api.ts                           # fetch wrappers + EGXPY_SERVICE_URL
│   │   ├── auth.ts                          # NextAuth config
│   │   ├── prisma.ts                        # Prisma client (auth.db + predictions.db)
│   │   ├── sqlite-readonly.ts               # better-sqlite3 read-only
│   │   ├── market-utils.ts                  # ⭐ canonical market normalization (200 LOC)
│   │   ├── market-pulse-proxy.ts            # unified proxy لـ 23 mislabeled routes
│   │   ├── market-hours.ts                  # per-market trading hours
│   │   ├── subscription-gate.ts             # tier limits + access gates
│   │   ├── targets-validator.ts             # signal-aware validator
│   │   ├── visual-templates.ts              # 9 visual templates
│   │   ├── text-effects.ts                  # 8 text effects + 4 easing
│   │   ├── hashtag-library.ts               # 6 markets × 8 features hashtags
│   │   ├── cta-templates.ts                 # 15 CTA ready
│   │   ├── ad-card-generator.ts             # PNG card generator (3 sizes)
│   │   ├── subscription-enforcement.ts      # 4 enforce functions server-side
│   │   ├── admin-guard.ts                   # NEW 2026-09-27 — admin auth
│   │   ├── logger.ts                        # NEW 2026-09-27 — structured JSON logger
│   │   ├── bot-link-db.ts                   # SQLite schema + CRUD لـ bot_link_tokens
│   │   ├── chart-generator.ts               # Server-side chart PNG generator
│   │   ├── db/                              # canonical DB access (Rule 5)
│   │   │   ├── index.ts                     # single entry point
│   │   │   ├── db-auth.ts                   # auth.db (Prisma) — 5,031 importers
│   │   │   ├── db-predictions.ts            # predictions.db — 9 importers
│   │   │   ├── finance-db.ts                # stocks.db finance tables — 47 importers
│   │   │   ├── new-db.ts                    # user data (Prisma) — 14 importers
│   │   │   ├── egxpy-bridge.ts              # Python backend bridge — 13 importers
│   │   │   └── egx-data-sources.ts          # data sources config — 4 importers
│   │   └── utils.ts                         # cn(), formatters, RTL helpers
│   │
│   ├── hooks/                               # React hooks
│   ├── store/                               # zustand stores
│   ├── instrumentation.ts                   # OpenTelemetry hook (Sentry + posthog)
│   └── styles/                              # Global stylesheets
│
├── vps-service/                             # 🧠 PYTHON BACKEND (THE BRAIN, port 8010)
│   ├── main.py                              # FastAPI app + WSGIMiddleware للـ Flask (v7.0.0)
│   ├── lightweight_server.py                # Flask app + 53 blueprint registrations
│   ├── engines/                             # ⭐ محركات التحليل الأساسية
│   │   ├── v38_backtest_engine.py           # 1,817 LOC — walk-forward backtest (ATR clamp [5%,9%])
│   │   ├── maestro_orchestrator.py          # 🗑️ محذوف نهائياً (DELETE-MAESTRO 2026-10-12)
│   │   └── ... (3 engines more)
│   ├── analyzers/                           # 118 محلل (post-Wave-2 — was 138 pre)
│   │   ├── institutional_decision_engine.py # 520 LOC — V40.2 (6 proofs + Tech Score + portfolio_advice)
│   │   ├── master_analyzer.py               # ~5,400+ LOC — load_merged_history() + 100+ sub-analyzers
│   │   ├── confidence_engine.py             # Picks management (7 factors, 4 tiers)
│   │   ├── position_manager.py              # 7 position advices
│   │   ├── fundamental_data_provider.py     # get_fundamental_score() — 40/30/15/15 weights
│   │   ├── stock_fundamentals.py            # reads tab_balance_sheet (symbol≠ticker gap)
│   │   ├── persona_engine.py                # 4 personas + PERSONA_CONFIGS + _ADAPTIVE_RR_TABLE
│   │   ├── live_prediction_engine.py        # 15-min prediction cycle
│   │   ├── historical_prediction_generator.py # batch backfill
│   │   ├── market_regime.py                 # bull/bear/sideways classification
│   │   ├── smart_confluence_engine.py       # 8-layer scoring (138 pts max, BUY threshold 68)
│   │   ├── explosive_scanner.py             # BB squeeze + volume spike detector
│   │   ├── expert_analysis_engine.py        # 🆕 NEW 2026-10-12 — 859 LOC — expert analysis (RSI/MA/S-R/52W + fundamentals)
│   │   ├── gate_analysis_engine.py          # 🆕 NEW 2026-10-12 — 730 LOC — 5-gate analyzer
│   │   ├── indicators/                      # 🆕 Rule 54 canonical Python package
│   │   │   ├── atr.py                       # calc_atr (Wilder's smoothing)
│   │   │   ├── rsi.py                       # calc_rsi (Wilder's smoothing)
│   │   │   ├── srsi.py                      # calc_srsi (Stochastic RSI)
│   │   │   └── ma.py                        # sma + ema + macd
│   │   └── ... (~100 more)
│   │
│   ├── api/                                 # ⭐ 65 Flask blueprint files (33 DEPRECATED)
│   │   ├── stocks_routes.py                 # active
│   │   ├── predictions_routes.py            # active
│   │   ├── picks_management_routes.py       # active (v3.4.43)
│   │   ├── chart_routes.py                  # active (V40.2 /full-analysis)
│   │   ├── persona_routes.py                # active
│   │   ├── portfolio_routes.py              # active
│   │   ├── ai_routes.py                     # active
│   │   ├── admin_routes.py                  # active (HARD cap ABS<=50)
│   │   ├── market_routes.py                 # active
│   │   ├── crypto_routes.py                 # active
│   │   ├── screener_routes.py               # active
│   │   ├── hunter_routes.py / sniper_routes.py # active
│   │   ├── learning_routes.py               # active
│   │   ├── news_routes.py                   # active
│   │   ├── monitor_routes.py                # active
│   │   ├── reports_routes.py                # active
│   │   ├── telegram_routes.py               # active
│   │   ├── egksco_routes.py                 # active (EGX official data)
│   │   ├── engine_settings_routes.py        # active (threshold source)
│   │   ├── optimizer_params_routes.py       # active (DEFAULT_PARAMS: min_rr_ratio=1.8, max_stop_pct=9.0)
│   │   ├── honest_tracking_routes.py        # active (RL-FIX-9, 5-state taxonomy)
│   │   ├── misc_routes.py                   # active — expert-analysis + gate-analysis + trade-results endpoints
│   │   └── ... (33 DEPRECATED — انظر §16 + `02-SCREENS_AND_COMPONENTS.md` §10.7)
│   │
│   ├── ai/                                  # AI subsystem (Ollama RAG + DuckDuckGo)
│   │   └── news_agent.py                    # 340 LOC — AI News Agent (see §10)
│   ├── portfolio/                           # Portfolio manager
│   │   ├── stop_manager.py                  # 607 LOC — 7 stop types
│   │   ├── purification_calculator.py       # 🆕 Rule 64 — Sharia purification
│   │   └── ...
│   ├── scripts/                             # 136 صيانة script (backfill, diagnose, audit_map.py)
│   ├── tools/                               # developer tools
│   ├── config/                              # JSON configs + threshold defaults
│   │   └── unified_config.py                # ⭐ EGX profile: ATR clamp [5%,9%] + R:R floor 1.8
│   ├── models/                              # Pydantic models + DTOs
│   ├── jobs/                                # background jobs
│   │   ├── daily_predictor.py               # V40.2 generator (CPU sleep 0.01ms between tickers)
│   │   ├── daily_closer.py                  # يقفل الصفقات (SELL sign-flip fix + -20% cap)
│   │   ├── intraday_aggregator.py           # every 15 min
│   │   ├── price_history_safetynet.py       # hourly
│   │   └── wal_checkpoint.py                # hourly WAL checkpoint
│   ├── core/                                # auth_middleware, db_manager, settings_resolver
│   │   ├── engine_settings.py               # 1,150 LOC — 100+ dynamic settings + get_setting()
│   │   ├── safe_insert_prediction.py        # DEV-12 — canonical INSERT site
│   │   └── opportunity_quality.py           # ATR_STOP_MIN_PCT = 5.0 (was 3.0)
│   ├── data/                                # 🆕 Rule 64-66 — Source Authority + Validation
│   │   ├── source_authority.py              # 298 LOC — write_guarded() mandatory guard
│   │   ├── validation.py                    # ~400 LOC — validate_stock_data()
│   │   ├── source_priority_cleaner.py       # multi-source cleaner
│   │   └── egx_fundamental_fetcher.py       # 573 LOC — EGXPilot FREE API
│   ├── ws-service/                          # ⭐ mini-service (Bun, port 3005, socket.io, 248 LOC)
│   ├── crontab.txt                          # cron schedule
│   ├── Dockerfile                           # optional containerization
│   └── requirements.txt                     # Python deps (FastAPI, Flask, pandas, telethon)
│
├── data_engine/                             # 📡 DATA ENGINE (port 5000)
│   ├── main.py                              # scraper orchestrator
│   ├── sync.py                              # sync data_engine.db → predictions.db / price_history.db
│   ├── scrapers/                            # 10 scrapers
│   │   ├── tradingview_scraper.py           # TA + UDF (296 EGX stocks)
│   │   ├── yahoo_scraper.py                 # historical OHLC
│   │   ├── egxpilot_scraper.py              # FREE fundamentals API
│   │   ├── egksco_scraper.py                # EGX official (255 stocks) — wired write_guarded
│   │   ├── us_stock_scraper.py              # 🆕 2026-10-12 — wired write_guarded
│   │   ├── news_scraper.py                  # NewsAPI + GNews
│   │   ├── coingecko_scraper.py             # crypto prices
│   │   ├── sharia_compliance_scraper.py     # 🆕 Rule 64 — 855 LOC — 6 Sharia tables
│   │   └── ... (2 more)
│   ├── config/                              # scraper configs
│   └── data/                                # raw scraped data cache + data_engine.db
│
├── db/                                      # 🗄️ SQLite databases (WAL mode)
│   ├── predictions.db                       # 225 MB — V40.2 predictions
│   ├── data_engine.db                       # 273 MB — Market + fundamentals + metals + crypto + Sharia
│   ├── price_history.db                     # 293 MB — EGX OHLC (1,206,981 rows)
│   ├── stocks.db                            # 15 MB — Ticker metadata (5-market)
│   ├── intraday.db                          # 428 MB — Intraday OHLC
│   ├── auth.db                              # 0.2 MB — Prisma-managed (User, Session, Account)
│   ├── analytics.db                         # 86 KB — Persona + scoring cache
│   ├── learned.db                           # 12 KB — Learning engine weights
│   ├── news.db                              # 7,894 خبر — News sentiment
│   ├── community.db                         # 32 KB — Community posts
│   ├── gold_prices.db                       # 40 KB — metals prices
│   ├── silver_prices.db                     # — silver prices
│   ├── crypto.db                            # 32 KB — crypto prices (secondary)
│   ├── crypto-lab.db                        # — crypto lab
│   ├── crypto_learning.db                   # 72 KB — crypto learning
│   ├── finance.db                           # 4 KB — finance portfolio
│   ├── macro.db                             # 176 KB — macro indicators
│   ├── custom.db                            # 24 KB — custom widgets
│   ├── decision_log.db                      # — Decision Logger (Rule 37)
│   ├── _backups/                            # local backups (gitignored)
│   └── schemas/                             # SQL schema definitions + migrations
│
├── glminvestment-engines/                   # standalone engines package (data-science repo)
│
├── mini-services/                           # ⚡ INDEPENDENT BUN PROJECTS
│   ├── telegram-events/                     # port 3003 — polling 2s + broadcast
│   ├── telegram-poster/                     # auto-posting (Bun/TS, started by PM2)
│   └── ... (more mini-services pattern)
│
├── scratch/                                 # 🧪 sandbox scripts (not in production)
├── garage/                                  # 🗑️ DEAD CODE (~8,247 LOC — orphan candidates, §16)
├── scripts/                                 # maintenance scripts (136)
│   ├── audit_map.py                         # ⭐ regenerates audit_map.json
│   ├── backfill_persona_classification.py   # schema-aware (post ed55a60c)
│   ├── diagnose_utop_and_price_history.py   # diagnostic
│   ├── check_no_hard_delete.py              # CI gate 1 — no hard DELETE on predictions
│   ├── check_no_raw_insert.py               # CI gate 2 — no raw INSERT outside canonical writer
│   ├── institutional_multi_market_backtest.py # 955 LOC — backtest script
│   ├── verify_all_radar_signals.py          # 724 LOC — signal verification
│   └── ... (130 more)
│
├── tests/                                   # pytest (5 files) + vitest (65 files)
│   └── test_risk_profile.py / test_db_manager.py / ...
│
├── Documentation/                           # 📚 this folder (5 master files post-unification)
│   ├── 00-CONSTITUTION.md                   # ⭐ الدستور (76 قاعدة)
│   ├── 01-ARCHITECTURE_AND_API.md           # ⭐ هذا الملف
│   ├── 02-SCREENS_AND_COMPONENTS.md         # ⭐ شاشات + components inventory
│   ├── 03-HOW_IT_THINKS.md                  # ⭐ منطق التحليل (decision-engine deep dive)
│   ├── 05-CURRENT_STATE.md                  # مرجع حي للحالة
│   ├── _archive_pre_unification_2026-10-12/ # أرشيف ما قبل التوحيد
│   └── audit_map.json                       # ⚙️ machine-generated
│
├── flutter_app/                             # 📱 Flutter app submodule (see §9)
├── news-agent/                              # 📰 وكيل أخبار EGX محلي
├── active_databases_20260817_full.zip       # 📦 PRODUCTION ARCHIVE (77 MB, 17 DBs)
└── Caddyfile                                # 🌐 Gateway config (port 81 + XTransformPort)
```

---

## 3. Databases Map

> **القاعدة:** كل قواعد البيانات SQLite + WAL mode + `busy_timeout=30000`. لا PostgreSQL، لا Redis، لا message queue.
> Production archive: `active_databases_20260817_full.zip` (77,021,220 bytes، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`، 17 DBs).
> **DB Safety Rules:** مرجع `00-CONSTITUTION.md` §10 (DB Safety) + Rule 1 (NEVER touch prod DBs) + Rule 12 (`load_merged_history()` sole source) + Rule 16 (VERIFY-BEFORE-DELETE).

### 3.1 قواعد البيانات الرئيسية (db/) — مُحدّث 2026-10-12 (post HIDDEN-WRITERS-AUDIT cleanup)

> **2026-10-12 (HIDDEN-WRITERS-AUDIT cleanup):** 3 orphan duplicate tables اتمسحت (per Rule 28 + Rule 29):
> - `predictions.db.portfolios` (4 rows) → **DROPPED** — canonical هو `stocks.db.portfolios`
> - `predictions.db.ExpertRecommendation` (17 rows) → **DROPPED** — canonical هو `stocks.db.ExpertRecommendation`
> - `stocks.db.gold_prices` (3 legacy rows) → **DROPPED** — canonical هو `data_engine.db.gold_prices` (163,143 rows)

| DB | الدور | Key tables + counts (2026-10-12) | ملاحظات |
|---|---|---|---|
| **`predictions.db`** | V40.2 prediction store | `predictions`=**306** · `aiPrediction`=2,459 · `persona_predictions`=946 · `historical_trades`=550 · `outcome_logs`=8,544 · `live_ai_signals`=945 · `morning_bell_signals`=82 · `learned_lessons`=8,644 · `exit_notifications`=3,773 (50 table — بعد حذف `portfolios` + `ExpertRecommendation` duplicates) | `fundamental_score` بقى real (post FUNDAMENTALS-ACTIVATION). 153 placeholder predictions اتمسحت (status='INVALID'). **`predictions.master_score` = CANONICAL field** (V40.2 master score من `institutional_decision_engine.py::build_institutional_decision()`). **`stored_analyses.maestro_score` = legacy column** — Python بـ يقرأه بـ `COALESCE(maestro_score, master_score, 50)` fallback. |
| **`data_engine.db`** | Market + fundamentals + metals + crypto + Sharia | `stocks`=**1,585** · `historical_data`=99,076 · `stock_prices`=2,444 · `crypto_prices`=198,476 · `btc_local_prices`=76,877 · `gold_prices`=**163,143** (CANONICAL) · `gold_prices_clean`=27,440 · `silver_prices`=82,608 · `exchange_rates`=45,597 · `screener_lists`=**1,505** · `tab_balance_sheet`=866 · `tab_income_statement`=866 · `tab_cash_flow`=866 · `tab_valuation`=858 · `tab_profitability`=858 · `tab_dividends`=858 · `tab_performance`=858 · `tab_technical_analysis`=863 · + Sharia tables (sharia_sources + sharia_source_status + sharia_metrics + sharia_purification_rates + sharia_symbol_map + sharia_history — Rule 64) | الـ canonical price source بعد WAVE-2 migration: `data_engine.db.egksco_price_history`. الـ canonical gold prices source. |
| **`price_history.db`** | EGX OHLC (primary price source) + US stocks | `price_history`=**1,205,599** rows، 1,260 tickers (EGX focus)، 2025-01-09 → 2026-09-25. **Schema (13-column — extended 2026-10-12):** `ticker, market, date, open, high, low, close, volume, buy_volume, sell_volume, delta_volume, delta_pct, pressure, adjusted` (last 6 columns optional — populated by egksco_scraper via `write_guarded()`). | المصدر الرئيسي للـ `load_merged_history()`. **كل writes بتمر عبر `write_guarded()`** (Rule 12 + Rule 66 — per WRITE-GUARDED-EXTENSION 2026-10-12). |
| **`stocks.db`** | Ticker metadata (5-market) | `stocks`=**956** (EGX=360 · TADAWUL=413 · KSE=128 · QSE=55) · `egksco_stocks`=250 · `ExpertRecommendation`=**48** (CANONICAL) · `cached_analysis`=111 · `market_pulse_cache`=2,132 · `market_indices`=5 · `investors_data`=7 · `egksco_sync_status`=451 · `portfolios`=**9** (CANONICAL) · `indicator_trust_scores`=10 (54 table — بعد حذف `gold_prices` duplicate) · `ticker_registry` (NEW — Wave 8 — canonical ticker mappings + collision guards + restored Arabic names + `idx_tr_market` + `idx_tr_sharia` indexes) | mixed: Saudi (numeric) + EGX (concatenated) + Kuwait + Qatar — CRYPTO منفصل في `data_engine.db.crypto_prices` |
| **`auth.db`** | Prisma-managed (auth) | User, Session, Account, VerificationToken | الوحيدة اللي Node.js بـ يكتب فيها مباشرة (Prisma) |
| **`analytics.db`** | Persona + scoring cache | 86 KB | تُقرأ من Python |
| **`learned.db`** | Learning engine weights | 12 KB | تُكتب من `learning_engine.py` + `lesson_store.py` |
| **`news.db`** | News sentiment | `news_articles`=**7,894** · `news_agent_articles`=100 · `market_news`=43 (post NEWS-DB-SOT migration) | Pillar 3 (sentiment). المصدر الوحيد للأخبار (القاعدة 44). |
| **`community.db`** | Community posts + sentiment | 32 KB | (community page = DEAD candidate) |
| **`intraday.db`** | Intraday OHLC | 65 KB | `intraday_aggregator.py` بـ يحوّلها لـ price_history.db |
| **`gold_prices.db`** / **`silver_prices.db`** | metals prices | gold=40 KB | (gold/silver removal planned — v3.66.2) |
| **`crypto.db`** / **`crypto-lab.db`** / **`crypto_learning.db`** | crypto prices + crypto learning | crypto.db=32 KB · crypto_learning.db=72 KB | (crypto.db صار secondary بعد دمج crypto في `data_engine.db`) |
| **`finance.db`** / **`macro.db`** / **`custom.db`** | finance portfolio / macro indicators / custom widgets | finance.db=4 KB · macro.db=176 KB · custom.db=24 KB | finance.db شبه فاضي؛ macro.db فيه `macro_indicators`=3 |
| **`decision_log.db`** | Decision Logger | table `decision_log` | يُكتب من `decision_logger.py::log_decision()` (القاعدة 37 — Decision Logger) |

### 3.2 موقع القواعد

- **Sandbox working copy:** `db/` (relative — sandbox-only)
- **Production:** `/root/GLMinvestment/db/` على VPS
- **Archive:** `./active_databases_20260817_full.zip` (repo root، 73.45 MB، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`)

### 3.3 الـ Schema Bug الحرج (tab_balance_sheet / tab_income_statement / tab_cash_flow)

> هذه الجداول الـ 3 **UNUSABLE without migration**. باقي tab_* (valuation, profitability, dividends, performance, technical_analysis) **clean and usable**.

```
Expected:  symbol=1030 | market=السعودية | fiscal_period=2025-Q3 | fiscal_end=2025-12-31 | total_assets=...
Actual:    symbol=السعودية | market=2025-Q3 | fiscal_period=2025-12-31 | fiscal_end=335.05 M SAR | total_assets=...
```

**Migration plan:** تُصلح عبر `data_engine/scrapers/egksco_scraper.py` re-scrape + manual column-shift fix.

### 3.4 فجوة الـ Arabic Symbol → Ticker Mapping

- `tab_valuation.symbol` for EGX = `ALCNالاسكندرية` (ticker + Arabic name concatenated)
- `predictions.db.ticker` = `ALCN` (clean)
- **Resolver (موجود في `stock_fundamentals.py`):** exact match first, then prefix match `LIKE 'TICKER%'`
- **Mapping success rate:** 81.8% (18/22 prediction tickers match tab_valuation، 97.4% by prediction count)

### 3.5 فجوة `egx_fundamentals` — ✅ RESOLVED

- الـ fetcher `vps-service/data/egx_fundamental_fetcher.py` **موجود + مُجدوَل + مُحصّن** (commit a268957 + 4cde9f0).
- الـ cron بيشغّل السبت 14:00 UTC (16:00 Cairo).
- **Ticker-validation guard** يمنع إعادة إنتاج صفوف الـ column-shift.
- **tab_* integrity check** (`verify` subcommand) بيتأكد إن الجداول فضلت نظيفة.
- **Python بـ يقرأ** من `tab_valuation`/`tab_profitability`/`tab_dividends`/`tab_performance`/`tab_technical_analysis` (clean tables) + `egx_fundamentals` (fresh EGXPilot data).

### 3.6 Prisma Schemas

| Schema | الـ DB | الـ Models |
|---|---|---|
| `prisma/schema.prisma` | (none — scaffold only) | User + Post (placeholder — non-production) |
| `prisma/auth-schema.prisma` | `auth.db` | User, Account, Session, VerificationToken (NextAuth) |
| `prisma/predictions-schema.prisma` | `predictions.db` | proxy models for Python raw SQL — للقراءة فقط من Node.js |

### 3.7 إحصائيات `predictions.db` (post-archive 20260817)

| الحقل | القيمة |
|---|---|
| إجمالي التوقعات (current) | 1,359 |
| closed | ~1,213 |
| open / active | ~77 |
| byPersona | balanced=22 (81.8% WR) · gambler=1 · conservative=3 |
| fundamental_score | real (post FUNDAMENTALS-ACTIVATION) — was 50.0 placeholder |
| Dynamic R:R active | 95.27% من الصفقات بـ R:R=2.0 (outperform path) |

### 3.8 Sharia Compliance Tables (NEW — Wave 8 — Rule 64 — Task 23-A)

`data_engine.db` يضم 6 جداول Sharia مكتوبة بواسطة `data_engine/scrapers/sharia_compliance_scraper.py` (cron Sat 15:30 UTC):

| الجدول | المحتوى |
|---|---|
| `sharia_sources` | 8 مصادر Sharia (S&P Shariah + Musaffa + Kashif + Osoul + ...) |
| `sharia_source_status` | حالة الـ ETag + last-scrape per source |
| `sharia_metrics` | per-stock compliance (is_halal_consensus + compliant_sources_count + sp_haram_earning_pct + needs_review) |
| `sharia_purification_rates` | per-stock rate per method (S&P + musaffa + kashif + osoul) |
| `sharia_symbol_map` | alias map + match_method + alias_confidence + needs_review (collision guard) |
| `sharia_history` | audit log |

**المعايير المعتمدة:** S&P Shariah أساسي + Musaffa/Kashif/Osoul تكميلية + AAOIFI مستعدّة + `consensus_min=6`. تُقرأ من `/api/sharia` GET + `/api/sharia/purification` POST.

---

## 4. Engine / Service Map

### 4.1 المحركات الأساسية (engines/ + analyzers/)

> **Wave 2 (Task 7-A — 2026-10-01):** 58 dead Python files archived to `archive/wave-2-cleanup-2026-10-01/vps-service/` (NOT deleted — owner directive).

| Engine | File | LOC | الوصف | Status |
|---|---|---:|---|---|
| **V38 Backtest Engine** | `engines/v38_backtest_engine.py` | 1,817 | walk-forward backtest — NOW reads canonical `sl`/`tp1`/`tp2` + ATR clamp **`[5%, 9%]`** (commit `65a748f` baseline; commit `38665fd1` — رفع min 3.0→5.0 + V40_2_STOP_MAX_PCT default 7.0→9.0) | ✅ ACTIVE |
| **V39/V40.2 Institutional Decision Engine** | `analyzers/institutional_decision_engine.py` | ~520 | 6 proofs + Tech Score (base 25, max 100) + portfolio_advice + dynamic R:R (1.8/2.0 — `unified_config.py` EGX profile fixed 1.5→1.8) — returns `sl`/`tp1`/`tp2` keys | ✅ ACTIVE — THE ONLY ENGINE |
| **MasterAnalyzer** | `analyzers/master_analyzer.py` | ~5,400+ | **`THRESHOLDS` dict canonical:** 78/65/55/40/25. `_get_signal_from_score` يفوّض لـ `canonical_signal.classify_signal` (single source of truth per Rule 72 + Rule 73). `_get_signal_arabic` يفوّض لـ `canonical_signal.signal_ar`. removed `HOLD_LOW`/`HOLD_HIGH` brackets. | ✅ ACTIVE |
| **Maestro Orchestrator** | ~~`engines/maestro_orchestrator.py`~~ = ~~`analyzers/maestro_orchestrator.py`~~ | ~~3,545~~ | ~~8-layer confluence (138 pts max، BUY threshold 68)~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كل الـ files في `archive/maestro-dead-code-20261012/`. سيدي طلب: "Maestro ده ماضي أسود — شيله". |
| **Stock Fundamentals** | `analyzers/stock_fundamentals.py` | — | reads `tab_balance_sheet` (with `symbol ≠ ticker` gap resolver — Arabic prefix match) | ✅ ACTIVE (with gap) |
| **EGX Fundamental Fetcher** | `vps-service/data/egx_fundamental_fetcher.py` | 573 | fetches from **EGXPilot FREE API** — writes to `egx_fundamentals` table. HARDENED (4cde9f0): ticker guard + no-args cron fix + `verify` integrity check | ✅ SCHEDULED (a268957) |
| **Persona Engine** | `analyzers/persona_engine.py` | — | 4 personas (gambler/balanced/conservative/expert) + `PERSONA_CONFIGS` + `_ADAPTIVE_RR_TABLE` + `PERSONA_INPUT_WEIGHTS` | ✅ ACTIVE |
| **Live Prediction Engine** | `analyzers/live_prediction_engine.py` | — | 15-min prediction cycle | ✅ ACTIVE |
| **Historical Prediction Generator** | `analyzers/historical_prediction_generator.py` | — | batch backfill (SELL sign-flip fix applied) — `MAX_PREDICTIONS_PER_DAY=7` | ✅ ACTIVE |
| **Market Regime** | `analyzers/market_regime.py` | — | bull / bear / sideways classification (EGX30ETF benchmark) | ✅ ACTIVE |
| **Smart Confluence Engine** | `analyzers/smart_confluence_engine.py` | — | 8-layer scoring (138 pts max, BUY threshold 68) | ✅ ACTIVE |
| **Paper Trade Tracker** | `analyzers/paper_trade_tracker.py` | — | paper-trading PnL tracking | ✅ ACTIVE |
| **Explosive Scanner** | `analyzers/explosive_scanner.py` | — | BB squeeze + volume spike detector | ✅ ACTIVE |
| **Confidence Engine** | `analyzers/confidence_engine.py` | — | 7-factor confidence (0-100%) + 4 tiers (TOP_PICK/STRONG/WATCH/SKIP) | ✅ ACTIVE (v3.4.43) |
| **Position Manager** | `analyzers/position_manager.py` | — | 7 position advices (wait / add / sell / partial-sell / ...) | ✅ ACTIVE (v3.4.43) |
| **Fundamental Data Provider** | `analyzers/fundamental_data_provider.py` | — | `get_fundamental_score(ticker)` — 40/30/15/15 weights (Profitability/Valuation/Dividend/Growth) | ✅ ACTIVE (Stage A-F done) |
| **Adaptive Weights** | `engines/adaptive_weights.py` | — | connected to maestro (post-fix) — self-learning weights | ✅ ACTIVE |
| **Flow System** | `engines/flow_system.py` | 1,078 | Macro 25% → Sector 30% → Stock 25% → Cross-val 20% | ✅ ACTIVE |
| **Stop Manager** | `portfolio/stop_manager.py` | 607 | 7 stop types (fixed, trailing, technical, volatility, tiered, time, breakeven) | ✅ ACTIVE |
| **Engine Settings** | `core/engine_settings.py` | 1,150 | 100+ dynamic settings + `get_setting(key, default)` resolver | ✅ ACTIVE |
| **Source Authority** (NEW — Rule 66 — Task 23-A — 2026-10-03 + WRITE-GUARDED-EXTENSION 2026-10-12) | `vps-service/data/source_authority.py` | 298 | `write_guarded()` mandatory guard before any INSERT to `price_history.db` — `CANONICAL_SOURCES` per market (EGX=`intraday_aggregated` + `egksco` fallback، TADAWUL/KSE/QSE/US=`yahoo_clean` + `yahoo_us` fallback (NEW 2026-10-12)، CRYPTO=`crypto_fetcher`، GOLD=`gold_fetcher`) + `BANNED_SOURCES` (`egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill`). **Signature اتوسع (2026-10-12):** optional kwargs `buy_volume, sell_volume, delta_volume, delta_pct, pressure, adjusted, market_label` لـ support egksco delta columns. **Schema-aware INSERT** backward-compatible مع 8-column + 13-column schemas. Wired in 5/8 scrapers + `us_stock_scraper.py` (NEW 2026-10-12) + `egksco_scraper.py` (NEW 2026-10-12 — with delta_volume) + wired in `master_analyzer.analyze()` (commit `435c16f` — Rule 66 enforced end-to-end). | ✅ ACTIVE |
| **Data Validation Layer** (NEW — Rule 65 — Task 23-A — 2026-10-03) | `vps-service/data/validation.py` | ~400 | `validate_stock_data()` returns `ValidationDict` + `is_valid_overall`. INVALID fields (e.g. `current_price=0`, `low_52w > current_price`, `high_52w < current_price`, support/resistance cross-stock contamination ratio > 10x) are nullified — NOT set to fake values. If `current_price` INVALID → HOLD score=0. Stale 52W + OHLC integrity checks. Wired in `master_analyzer.py`. | ✅ ACTIVE |
| **Expert Analysis Engine** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/analyzers/expert_analysis_engine.py` | 859 | `generate_expert_analysis(snapshot)` — expert analysis engine (RSI/MA/S-R/52W + fundamentals P/E ROE EPS P/B Div + risk mgmt entry/target1/target2/stop/RR/position-size/risk-level + Arabic narrative). Exposed via `GET + POST /api/stocks/<ticker>/expert-analysis` (`misc_routes.py:6579` + `:6678`). Replaces `src/lib/expert-analysis.ts` (882 LOC archived — Rule 28 duplicate). | ✅ ACTIVE |
| **Gate Analysis Engine** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/analyzers/gate_analysis_engine.py` | 730 | `analyze_gates(snapshot)` — 5-gate analyzer (trend/momentum/volume/structure/RSI) + `_detect_bb_squeeze()` (ported from archived `src/lib/dynamic-analysis-engine.ts`) + Arabic narrative. Exposed via `GET + POST /api/stocks/<ticker>/gate-analysis` (`misc_routes.py:6695` + `:6776`). Replaces `src/lib/gate-analyzer.ts` (1,066 LOC archived). | ✅ ACTIVE |
| **Trade Results Aggregator** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/api/misc_routes.py::get_trade_results()` (line 6492) | ~150 | `GET /api/trade-results` — period bounds Cairo TZ-aware + 11-point validation + ReportStats aggregation. Reuses canonical `unified_config.MARKET_PROFILES` per Rule 67. Replaces `src/lib/trade-results-engine.ts` (685 LOC archived). | ✅ ACTIVE |
| **Sharia Compliance Scraper** (NEW — Rule 64 — Task 23-A — 2026-10-03) | `data_engine/scrapers/sharia_compliance_scraper.py` | 855 | scrapes from `stocks.templatesnippet.com` → writes 6 tables in `data_engine.db`. AAOIFI excluded. S&P Shariah primary + Musaffa/Kashif/Osoul supplementary. `consensus_min=6`. Cron: Sat 15:30 UTC. | ✅ ACTIVE (cron #25) |
| **Purification Calculator** (NEW — Rule 64 — Task 23-A — 2026-10-03) | `vps-service/portfolio/purification_calculator.py` | 425 | single-trade + portfolio purification (Python=Brain per Rule 20). Called by `/api/sharia/purification` POST endpoint. | ✅ ACTIVE |

### 4.2 V40.2 Daily Predictor (post R:R fix — commit 65a748f + commit 38665fd1)

> `vps-service/jobs/daily_predictor.py` (lines ~314-326) — **R:R floor gate** مُفعّل:

```python
if r_mult < get_setting('dynamic_rr_normal', default=1.8):
    continue  # يرفض sub-threshold setups قبل ما تدخل predictions.db
```

> **تحديث 2026-10-08 (Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`):**
> `dynamic_rr_normal` رفع من 1.5 → **1.8** (Rule 18 — حماية رأس المال مقدسة). مواءمة كاملة في:
> - `vps-service/config/unified_config.py` EGX profile (L377-380 + L147-150 defaults).
> - `vps-service/core/engine_settings.py` (canonical default).
> - `vps-service/jobs/daily_predictor.py` (consumer).
> - `vps-service/engines/backtest_engine.py` (V40_2_STOP_MAX_PCT default 7.0→9.0).

> **تحديث 2026-10-09 (Task `PHASE-1 — CPU optimization` — commit `e8df798d`):**
> `vps-service/jobs/daily_predictor.py:748` أُضيف `time.sleep(0.01)` بين الأسهم لتقليل استهلاك CPU من 95%→**35%** (يمنع Hostinger CPU limitation من إيقاف الـ cron). Overhead إجمالي: 10ms × 1,046 tickers ≈ **10s** (negligible مقابل ~6-7 دقائق runtime). الموقع الدستوري: Rule 8 (CAPITAL-PROTECTION-FIRST) — استقرار الـ cron بـ يحمي إنتاج التوقعات اليومية.

- مع الـ key-mismatch fix، `dynamic_rr_outperform=2.0` يُحترم للأسهم اللي outperforming الـ market → الـ gate نادرًا what يفعل.
- 95.27% من الصفقات بـ R:R=2.0 (outperform path).

### 4.3 Closed-Loop Learning (4-file chain)

```
1. live_price.py            ← يجمع سعر الإغلاق اليومي
   ↓
2. daily_predictor.py ← يولّد التوصيات (V40.2 هو العقل الوحيد — KILL-MAESTRO)
   ↓
3. daily_closer.py          ← يقفل الصفقات + يحسب profit_loss (SELL sign-flip fix + -20% cap)
   ↓
4. lesson_store.py          ← يخزن الدروس (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT)
   ↓
   applied_lesson widen_stop logic (+0.15×ATR per repeat, max 0.5×ATR)
```

### 4.4 الـ Mini-Services (Bun/TypeScript)

| Mini-service | Port | Role |
|---|---|---|
| `ws-service` | 3005 | WebSocket (socket.io) — polling 30s للـ Python + broadcast للـ clients |
| `telegram-events` | 3003 | polling 2s لأحداث Telegram + broadcast للـ clients |
| `telegram-poster` | (no port — script) | auto-posting للـ Telegram (started by PM2) |

> كل mini-service = **independent bun project** بـ own `package.json` + own port + `bun --hot` للـ hot-reload.

### 4.5 الـ Thresholds الحالية (engine_settings)

> **تحديث 2026-10-08 (Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`):**
> العتبات الكنسية للإشارات دلوقتي موحّدة على 3 طبقات: `canonical_signal.py` (Python source) + `engine_settings.py` (DB settings) + `master_analyzer.py` (consumer).

| Key | Value | Source |
|---|---|---|
| `dynamic_rr_normal` | **1.8** (was 1.5 — commit `38665fd1`) | engine_settings.py (default) + `unified_config.py` EGX profile |
| `dynamic_rr_outperform` | **2.0** | engine_settings.py (default) |
| `atr_stop_min_pct` | **5.0** (was 3.0 — Rule 8) | engine_settings.py + opportunity_quality.py + unified_config.py EGX |
| `atr_stop_max_pct` | **9.0** (V40_2_STOP_MAX_PCT default رفع من 7.0) | CONSTITUTION Rule 8 |
| `min_rr_ratio` | 1.8 | optimizer_params_routes DEFAULT_PARAMS |
| `max_stop_pct` | 9.0 | optimizer_params_routes DEFAULT_PARAMS |
| `default_stop_pct` | 5.0 | engine_settings.py |
| `THRESHOLDS['STRONG_BUY']` | **78** (was 80 — Rule 71 — commit `c2ade8c6`) | `master_analyzer.py` L495 + `canonical_signal.py` |
| `THRESHOLDS['BUY']` | 65 | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['ACCUMULATE']` | 55 | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['REDUCE']` | **40** (was 35 — commit `38665fd1`) | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['SELL']` | **25** (was 20 — Task `REAPPLY-CRITICAL-FIXES`) | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['STRONG_SELL']` | **25** (was 10 — Task `REAPPLY-CRITICAL-FIXES`) | `master_analyzer.py` + `canonical_signal.py` |
| `trailing_stop_activation_gain` | ⚠️ **2.0 vs 3.0 CONTRADICTION** — engine_settings يقول 2.0 لكن V38 backtest + institutional_decision_engine بـ يتوقعون 3.0 (G7 — open) |
| `tech_score_base` | 25 (code) vs 50 (settings) — الفعلي 25 (G6) |
| `MAX_PREDICTIONS_PER_DAY` | 7 (hardcoded) |
| `DAILY_PICKS_CAP` | 5 (Picks Management v3.4.43) |
| `MIN_CONFIDENCE_FOR_PICK` | 65% (Picks Management) |
| `ABS(actual_return)` HARD cap | ≤ 50 في كل مسارات KPI (route.ts + persona_db + PredictionTrackingDashboard) |
| `profit_loss` cap | -20.0 (SELL sign-flip fix — ULTRA-RESTORE) |

### 4.6 Canonical Indicators Package (Rule 54 — CALCULATION-CANONICAL)

> كل حساب فني (ATR / RSI / SRSI / SMA / EMA / MACD / Bollinger) لازم يصدر من **مكان واحد بس** — Python `vps-service/analyzers/indicators/`. ممنوع أي duplicate في TS.

| Function | Algorithm | File |
|---|---|---|
| `calc_atr` | Wilder's smoothing `atr=(atr×(p-1)+tr)/p`, seed = SMA of first `p` TRs | `vps-service/analyzers/indicators/atr.py` |
| `calc_rsi` | Wilder's smoothing `avg=(avg×(p-1)+val)/p`, seed = SMA of first `p` gains/losses | `vps-service/analyzers/indicators/rsi.py` |
| `calc_srsi` | Stochastic RSI (Chande & Kroll 1994) | `vps-service/analyzers/indicators/srsi.py` |
| `sma` | `sum(data[-period:])/period` | `vps-service/analyzers/indicators/ma.py` |
| `ema` | recursive `k=2/(period+1)`, seed = SMA of first `p` | `vps-service/analyzers/indicators/ma.py` |
| `macd` | EMA(12) − EMA(26), signal = EMA(9) of MACD line | `vps-service/analyzers/indicators/ma.py` |
| `bollinger_bands` | ⏳ **MISSING** — يحتاج إضافة لـ `ma.py` (4 TS files بتـ يحسبوه محلياً) | — |

> تفاصيل Phase 1/2/3 الـ CALC-CONSOLIDATION + الـ BACKTEST-ANALYSIS tuning proposals — مرجع `02-SCREENS_AND_COMPONENTS.md` §15 + §16.

---

## 5. API Reference الكامل

> **المرجع:** 411 route عبر 159+ top-level group (verified 2026-10-04 via `find src/app/api -name "route.ts" -type f | wc -l` — was 380 pre-Wave-8; Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2).
>
> **القواعد:**
> - كل route مُوثَّق بـ: HTTP method(s) + الـ path + وصف قصير + الـ auth المطلوب.
> - `[param]` = dynamic segment (مثل `/stocks/[ticker]`).
> - `[...path]` = catch-all segment (مثل `/python/[...path]` proxy).
> - الـ auth: `public` = لا شيء، `session` = NextAuth session، `admin` = admin_session cookie أو X-Admin-Token header.
> - كل المسارات نسبية (Rule 61 — RELATIVE-PATHS-ONLY) — تبدأ بـ `/api/`.

### 📑 فهرس سريع

| القسم | الوصف | عدد الـ routes |
|------|------|---------------|
| [§5.1 الصحة والنظام](#§51-الصحة-والنظام) | health / keepalive / stats / db-stats / version | 6 |
| [§5.2 المصادقة (Auth)](#§52-المصادقة-auth) | login / register / google / me / profile / logout | 9 |
| [§5.3 الاشتراكات والمدفوعات](#§53-الاشتراكات-والمدفوعات) | subscription / paymob / instapay / promo / payments | 22 |
| [§5.4 الأسهم والسوق (EGX)](#§54-الأسهم-والسوق-egx) | stocks / market / sectors / sparkline / depth / orderbook | 60 |
| [§5.5 الكريبتو](#§55-الكريبتو) | crypto / flow / explosive / crypto-lab / crypto-predictions | 30 |
| [§5.6 الذهب والمعادن والفوركس](#§56-الذهب-والمعادن-والفوركس) | metals / metals-forex / currency / gold | 9 |
| [§5.7 رادار السيولة (Maker Radar)](#§57-رادار-السيولة-maker-radar) | maker-radar + radar + multi-market + exit-radar | 20 |
| [§5.8 التوقعات الذكية](#§58-التوقعات-الذكية) | predictions / v2/pipeline / real-predictions / eid | 38 |
| [§5.9 المحفظة والمالية](#§59-المحفظة-والمالية) | portfolio / finance / watchlist / risk / zakat | 47 |
| [§5.10 الذكاء الاصطناعي](#§510-الذكاء-الاصطناعي) | ai / ai-proxy / ai-analysis / ads (مولّد الإعلانات) | 10 |
| [§5.11 التنبيهات والإشعارات](#§511-التنبيهات-والإشعارات) | alerts / notifications / push / scheduler | 10 |
| [§5.12 الأخبار](#§512-الأخبار) | news / news-feed / egxpilot/news / stocks/[ticker]/news / admin/news* | 7 |
| [§5.13 التيليجرام](#§513-التيليجرام) | telegram/post / share / publish-stock / daily-report | 5 |
| [§5.14 المحاكي والتعلّم](#§514-المحاكي-والتعلّم) | paper-trading-v2 / learning / learning-params / seasonality | 18 |
| [§5.15 الأدمن (Admin APIs)](#§515-الأدمن-admin-apis) | كل `/admin/*` الـ 117 route | 117 |
| [§5.16 محركات البيانات (Data Engine)](#§516-محركات-البيانات-data-engine) | data-engine / cron / scraper / sync / metals-forex | 35 |
| [§5.17 المحمول (Mobile APIs)](#§517-المحمول-mobile-apis) | كل `/mobile/*` (Flutter app) | 48 |
| [§5.18 الـ Proxies والـ Webhooks](#§518-الـ-proxies-والـ-webhooks) | python / proxy / proxy-prod / telegram/[...path] | 5 |
| [§5.19 محرّك Maestro](#§519-محرّك-maestro) | maestro / engines-status / engine-control | 12 |
| [§5.20 الـ v2 / v4 / v82 endpoints](#§520-الـ-v2--v4--v82-endpoints) | الإصدارات القديمة + الموحّدة | 27 |
| [§5.21 أدوات متنوّعة](#§521-أدوات-متنوّعة) | export / import / community / feedback / user-posts / points / tips / track / chart / scanner | 35 |
| [§5.22 Devil's Advocate](#§522-devils-advocate) | devil / market-mood / scenario-matrix / calendar | 5 |
| [§5.23 Hunter & Sniper](#§523-hunter--sniper) | hunter (5) + sniper (6) | 11 |
| [§5.24 التقارير (Reports)](#§524-التقارير-reports) | daily + morning + weekly reports | 3 |
| [§5.25 Sharia Compliance APIs](#§525-sharia-compliance-apis) | sharia list/detail + purification calculator | 2 |
| [§5.26 Source Authority Admin APIs](#§526-source-authority-admin-apis) | admin/sources (canonical + banned + rejections log) | 1 |

**الإجمالي:** **411 route** عبر 159+ top-level group.

---

### §5.1 الصحة والنظام

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `GET` | `/health` | فحص صحة الخادم (liveness probe) | public |
| `GET` | `/keepalive` | keepalive endpoint (تستخدمه PM2/cron) | public |
| `GET` | `/stats` | إحصائيات عامة (مستخدمين / أسهم / توقعات) | session |
| `GET` | `/db-stats` | إحصائيات الـ DBs (row counts لكل جدول) | admin |
| `GET` | `/app/version` | نسخة الـ app (Flutter بيتفحصها للتحديث) | public |
| `GET` | `/system/db-health` | صحة الـ DBs + حجمها + آخر تحديث | admin |

### §5.2 المصادقة (Auth)

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `*` | `/api/auth/[...nextauth]` | NextAuth.js catch-all (login / callback / signout) | public |
| `GET` | `/auth/config` | إعدادات NextAuth (providers المفعّلة) | public |
| `POST` | `/auth/google` | Google OAuth login (ID token → session) | public |
| `GET/POST` | `/auth/google-signin` | مسار بديل لتسجيل الدخول بـ Google | public |
| `POST` | `/auth/login` | login بـ username/password (form-based) | public |
| `POST` | `/auth/logout` | تسجيل خروج + مسح session | session |
| `GET` | `/auth/me` | بيانات المستخدم الحالي (id / email / tier / is_admin) | session |
| `GET/PUT/POST` | `/auth/profile` | عرض/تعديل الملف الشخصي | session |
| `POST` | `/auth/register` | تسجيل مستخدم جديد | public |

**Admin auth** (في `/admin/auth/*`):
- `POST /admin/auth` — verify credentials + set `admin_session` cookie
- `POST /admin/auth/auto-cookie` — auto-set admin cookie لو المستخدم أدمن مسجل بـ Google
- `GET /admin/auth/token` — جلب X-Admin-Token base64 (للـ API calls من المتصفح)

### §5.3 الاشتراكات والمدفوعات

#### Subscription (13 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/subscription/plans` | قائمة الباقات المتاحة (free / premium / pro) |
| `GET` | `/subscription/current` | باقة المستخدم الحالية + تاريخ الانتهاء |
| `GET` | `/subscription/status` | حالة الاشتراك (active / expired / trial) |
| `POST` | `/subscription/subscribe` | الاشتراك في باقة |
| `POST` | `/subscription/start-trial` | بدء فترة تجريبية مجانية |
| `POST` | `/subscription/trial` | بدء/تمديد trial |
| `POST` | `/subscription/checkout` | إنشاء session checkout |
| `POST` | `/subscription/verify` | التحقق من نجاح الدفع |
| `POST` | `/subscription/activate` | تفعيل اشتراك بعد دفع ناجح |
| `POST` | `/subscription/deactivate` | إلغاء اشتراك |
| `POST` | `/subscription/upgrade` | ترقية لباقة أعلى |
| `POST` | `/subscription/check-access` | gate للـ frontend (هل المستخدم يقدر يشوف المحتوى؟) |
| `POST` | `/subscription/developer-request` | طلب حساب developer (للمبرمجين) |
| `GET` | `/subscribe/[plan]` | اختصار اشتراك في باقة معيّنة |

#### Paymob (الدفع المصري)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/paymob/create-payment` | إنشاء payment intent |
| `GET/POST` | `/paymob/callback` | webhook من Paymob بعد الدفع |
| `POST` | `/paymob/process-wallet` | معالجة محفظة Mobily/فودافون كاش |

#### Instapay
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/instapay` | طلب/تأكيد دفع Instapay |
| `POST` | `/instapay/approve` | تأكيد تحويل Instapay |
| `POST/GET` | `/instapay/verify` | التحقق من تحويل Instapay |

#### مدفوعات متنوّعة
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/payments/result` | صفحة نتيجة الدفع (redirect target) |

#### 🆕 Subscription System (NEW — 2026-09-30, Task SUBSCRIPTION-SYSTEM)

نظام اشتراكات كامل: 14 يوم trial مجاني + Paymob checkout + حظر بعد انتهاء الـ trial + B2B + referrals.

**القرارات المعتمدة:**
- كل مستخدم جديد → 14 يوم Premium trial تلقائياً (يُضبط في `/api/auth/register` + `/api/auth/google-signin`)
- بعد انتهاء الـ trial → TrialExpiredModal (block كامل، X صغير مُتعَب)
- AI محلي فقط (Qwen 1.5B) — تكلفة صفر
- Paymob فقط للدفع — المستخدم بيدفع بالجنيه حتى لو السعر معروض بعملة تانية
- B2B API keys: توليد تلقائي بعد الدفع (`sk_live_<random32>`)

#### Subscription APIs (مُحدّثة)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/subscription/plans?market=egx` | الباقات المتاحة بالعملة المحلية (egx/tadawul/kse/qse/us/crypto/all) |
| `GET` | `/subscription/current` | باقة المستخدم + trial status (محدّث: 14 يوم + 0 warning) |
| `GET` | `/subscription/status` | حالة الاشتراك المبسّطة: `{ tier, status, isExpired, daysLeft, isPaid, trialEndsAt }` |
| `POST` | `/subscription/checkout` | إنشاء Paymob order + iframe URL (جديد — يقرأ MarketPricing من DB) |
| `POST` | `/subscription/activate` | تفعيل بعد الدفع + توليد API key تلقائياً للـ B2B (جديد) |
| `POST` | `/subscription/subscribe` | الاشتراك في باقة (قديم) |
| `POST` | `/subscription/upgrade` | ترقية (قديم) |
| `POST` | `/subscription/start-trial` | بدء trial (قديم) |
| `POST` | `/subscription/trial` | تمديد trial (قديم) |
| `POST` | `/subscription/verify` | التحقق من دفع (قديم) |
| `POST` | `/subscription/deactivate` | إلغاء (قديم) |
| `POST` | `/subscription/check-access` | gate (قديم) |

#### Referral APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/referral/redeem` | استبدال كود إحالة (+14 يوم trial للجديد) |
| `GET` | `/referral/stats` | إحصائيات الإحالة (code + total + active + credits) |

#### B2B APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/b2b/signup` | طلب B2B (pending_approval) — body: `{ tier, company, contactName, email, phone, useCase?, website? }` |
| `GET` | `/b2b/api-keys` | عرض API keys للمستخدم (B2B only) |
| `POST` | `/b2b/api-keys` | rotate/revoke API key — body: `{ action: 'rotate'|'revoke', keyId? }` |

#### Admin Subscription/Referral APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/subscriptions` | كل الاشتراكات + إحصائيات (MRR + activeTrials + conversionRate + churnRate) |
| `GET` | `/admin/referrals` | كل الإحالات + top referrers + إحصائيات |

#### Prisma Models الجديدة (prisma/auth-schema.prisma)
- `MarketPricing` — التسعير حسب السوق × الباقة × دورة الفوترة (23 سطر مزروع)
- `Referral` — جدول الإحالات (referrer + referred + code + bonus_days)
- `UsageDaily` — تتبّع الاستخدام اليومي (ai_messages + watchlist + portfolio + alerts)
- `B2bApiKey` — مفاتيح API للـ B2B (توليد تلقائي + monthly_limit + revoked_at)

#### التسعير المعتمد (seeded في DB)
| الباقة | مصر | السعودية | عالمي |
|--------|-----|---------|------|
| Premium شهري | 99 ج.م | 19 ريال | $2.99 |
| Premium سنوي | 990 ج.م | 190 ريال | $29.9 |
| Pro شهري | 199 ج.م | 39 ريال | $5.99 |
| Pro سنوي | 1990 ج.م | 390 ريال | $59.9 |
| B2B Starter | — | — | $99/سنة |
| B2B Pro | — | — | $299/سنة |
| B2B Enterprise | — | — | $999/سنة |

#### Helper Functions (src/lib/subscription-gate.ts)
- `getTierLimits(tier)` — حدود كل باقة (Free: 5 watchlist / 5 portfolio / 3 alerts)
- `canUseAI(tier, usedToday)` — فحص الاستخدام اليومي (Free: 3/يوم)
- `getRadarAccess(tier)` — Free → preview متأخر ساعة، Premium+ → لحظي
- `canAccessProFeatures(tier)` — backtest/Devil/Hunter للـ Pro+
- `isB2BTier(tier)` — فحص الـ B2B

| `POST` | `/google-play/verify-receipt` | التحقق من شراء Google Play |
| `POST` | `/redeem-promo` | استبدال كود خصم |
| `POST/GET` | `/seed-experts` | seeding خبراء (admin) |

### §5.4 الأسهم والسوق (EGX)

#### Stocks (27 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/stocks` | قائمة كل الأسهم (مع آخر سعر) |
| `GET` | `/stocks/search` | بحث بالرمز/الاسم |
| `GET` | `/stocks/[ticker]` | بيانات سهم واحد |
| `GET` | `/stocks/[ticker]/history` | تاريخ أسعار السهم |
| `GET` | `/stocks/[ticker]/depth` | عمق السوق (order book levels) |
| `GET` | `/stocks/[ticker]/orderbook` | orderbook كامل |
| `GET` | `/stocks/[ticker]/news` | أخبار السهم |
| `GET` | `/stocks/[ticker]/comprehensive` | تحليل شامل (فني + أساسي + سيولة) |
| `GET` | `/stocks/[ticker]/professional-analysis` | تحليل احترافي مفصّل |
| `GET` | `/stocks/[ticker]/expert-analysis` | 🆕 تحليل خبير احترافي شامل (فني + أساسي + مخاطر + تقرير منسق) — 2026-10-09 |
| `GET` | `/stocks/[ticker]/recommendation` | توصية السهم الحالية |
| `GET` | `/stocks/[ticker]/publish-data` | بيانات جاهزة للنشر (تيليجرام/سوشيال) |
| `GET` | `/stocks/[ticker]/dual-persona` | تحليل بزاويتين (مضارب/مستثمر) |
| `GET` | `/stocks/advanced-analysis` | تحليل متقدّم لكل الأسهم |
| `GET` | `/stocks/analysis` | تحليل جماعي |
| `GET` | `/stocks/batch-analysis` | تحليل batch (POST body) |
| `GET` | `/stocks/confluence` | confluence score لكل الأسهم |
| `GET` | `/stocks/data-coverage` | نسبة تغطية البيانات لكل سهم |
| `GET` | `/stocks/delta-volume` | delta volume (شراء-بيع) لكل سهم |
| `GET/POST` | `/stocks/fundamentals` | بيانات أساسية |
| `GET` | `/stocks/movement-classification` | تصنيف حركة السهم (دعم/مقاومة/اختراق) |
| `GET` | `/stocks/presets` | قوائم محفوظة (EGX 30 / S&P) |
| `GET` | `/stocks/recommendations` | توصيات جماعية |
| `GET` | `/stocks/screener` | screener متقدّم |
| `GET` | `/stocks/sparkline` | sparkline data (mini chart) |
| `GET` | `/stocks/technical` | مؤشرات فنية (RSI / MACD / MA) |
| `GET` | `/stocks/top-performers` | الأعلى ارتفاعًا/انخفاضًا |

#### Market (32 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/market/overview` | نظرة عامة على السوق (مؤشرات + حركة) |
| `GET` | `/market/summary` | ملخص اليوم (gainers / losers / volume) |
| `GET` | `/market/status` | حالة السوق (مفتوح/مغلق + مدة) |
| `GET` | `/market/indices` | مؤشرات EGX 30/70/100 |
| `GET` | `/market/top-movers` | الأكثر تحركًا |
| `GET` | `/market/sectors` | أداء القطاعات |
| `GET` | `/market/sectors/intelligence` | تحليل ذكي للقطاعات |
| `GET` | `/market/liquidity-flow` | تدفّق السيولة على السوق |
| `GET` | `/market/intraday-pressure` | ضغط الجلسة (buying/selling pressure) |
| `GET` | `/market/morning-bell` | جرس الصباح (توصيات بداية الجلسة) |
| `GET` | `/market/investing` | بيانات investing.com proxy |
| `GET` | `/market/regime` | حالة السوق (DEFENSIVE/NORMAL/AGGRESSIVE) |
| `GET` | `/market/exit-status` | حالة خروج التوقعات |
| `GET` | `/market/continuation/[ticker]` | احتمالية استمرار الاتجاه |
| `GET` | `/market/live-data` | بيانات لحظية |
| `GET` | `/market/connections` | حالة مصادر البيانات |
| `GET` | `/market/gold` | سعر الذهب في السوق |
| `POST` | `/market/publish-status-image` | نشر بطاقة حالة السوق على تيليجرام |
| `GET/POST` | `/market/refresh-data` | تحديث بيانات السوق |
| `POST/GET` | `/market/sync` | مزامنة بيانات السوق |
| `POST` | `/market/sync-historical` | مزامنة تاريخية (5 سنوات) |
| `POST` | `/market/sync-live` | مزامنة لحظية |
| `GET/POST` | `/market/incremental-sync` | مزامنة تدريجية |
| `GET/POST` | `/market/seed-historical` | seeding تاريخي |
| `POST` | `/market/bulk-update` | تحديث جماعي |
| `GET` | `/market/auto-seed` | seeding تلقائي للأسهم |
| `POST/GET` | `/market/scheduled-sync` | مزامنة مجدولة (cron) |
| `GET/POST` | `/market/test-sources` | اختبار مصادر البيانات |
| `GET` | `/market/report/daily` | تقرير يومي |
| `GET` | `/market/report/weekly` | تقرير أسبوعي |
| `GET` | `/market/report/status` | حالة إعداد التقارير |
| `GET` | `/market/recommendations/ai-insights` | رؤى AI للتوصيات |

#### Sectors
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/sectors/[sector]/stocks` | أسهم قطاع معيّن |
| `GET` | `/sectors/tracking` | تتبّع أداء القطاعات |

#### Chart & Stock-detail
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/chart/[ticker]` | بيانات شارت سهم |
| `GET` | `/stock-detail` | تفاصيل سهم (مختصر) |
| `GET` | `/stock/deep-analysis` | تحليل عميق لسهم |
| `GET` | `/stock-profile/[ticker]` | ملف تعريفي للشركة |

#### Dividends & Disclosures
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/dividend-analysis` | تحليل توزيعات الأرباح |
| `GET/POST` | `/dividend-calendar` | تقويم توزيعات الأرباح |
| `GET` | `/disclosures/company/[symbol]` | إفصاحات شركة |

#### EGX-specific
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/egx/investors` | حركة المستثمرين (أجانب/عرب/مصريين) |
| `POST/GET` | `/egx/investors/seed` | seeding بيانات المستثمرين |
| `GET/POST` | `/egxpilot/stocks` | بيانات egxpilot.com proxy |
| `GET` | `/egxpilot/news` | أخبار egxpilot |
| `GET/POST` | `/egxpilot/analysis/[ticker]` | تحليل egxpilot لسهم |

### §5.5 الكريبتو

#### Crypto (23 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/crypto` | قائمة العملات (مع آخر سعر) |
| `GET` | `/crypto/coins` | قائمة العملات الكاملة (metadata) |
| `GET` | `/crypto/[id]` | بيانات عملة |
| `GET` | `/crypto/[id]/history` | تاريخ أسعار عملة |
| `GET` | `/crypto/live` | أسعار لحظية |
| `GET` | `/crypto/stats` | إحصائيات السوق |
| `GET` | `/crypto/status` | حالة مزامنة الكريبتو |
| `GET/POST` | `/crypto/sync` | مزامنة بيانات الكريبتو |
| `POST` | `/crypto/start` | بدء scraping |
| `POST` | `/crypto/stop` | إيقاف scraping |
| `GET` | `/crypto/analyze` | تحليل عملة |
| `GET` | `/crypto/full-analysis` | تحليل شامل لعملة |
| `GET` | `/crypto/portfolio` | محفظة الكريبتو |
| `GET` | `/crypto/watchlist` | قائمة مراقبة الكريبتو |
| `GET` | `/crypto/recommendations` | توصيات الكريبتو |
| `GET` | `/crypto/events` | أحداث الكريبتو (fork / burn / airdrop) |
| `GET` | `/crypto/explosive` | فرص انفجارية |
| `GET` | `/crypto/explosive/[symbol]` | تفاصيل فرصة انفجارية |
| `GET` | `/crypto/mr-signals` | إشارات mean-reversion |
| `GET` | `/crypto/ohlc` | بيانات OHLC (شمعية) |
| `GET/POST` | `/crypto/simulation` | محاكاة تداول كريبتو |
| `GET` | `/crypto/flow` | تدفّق السيولة على الكريبتو |
| `GET` | `/crypto/flow/[symbol]` | تدفّق سيولة عملة |

#### ملحقات الكريبتو
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/crypto-backtesting` | باك-تست للكريبتو |
| `GET` | `/crypto-lab` | مختبر الكريبتو (تجارب) |
| `GET` | `/crypto-lab/predictions` | توقعات الكريبتو |
| `GET` | `/crypto-predictions` | توقعات بسيطة للكريبتو |
| `GET` | `/unified-crypto` | كريبتو موحّد (مع EGX) |

### §5.6 الذهب والمعادن والفوركس

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/metals/gold` | سعر الذهب الحالي |
| `GET` | `/metals/gold/history` | تاريخ أسعار الذهب |
| `POST` | `/metals-forex/start` | بدء scraping معادن/فوركس |
| `GET` | `/metals-forex/status` | حالة scraping |
| `POST` | `/metals-forex/stop` | إيقاف scraping |
| `GET` | `/currency` | قائمة العملات |
| `GET` | `/currency/list` | قائمة عملات للتحويل |
| `GET/POST` | `/currency/convert` | تحويل عملة |
| `POST/GET` | `/multi-market/sync` | مزامنة كل الأسواق |

### §5.7 رادار السيولة (Maker Radar)

#### Maker Radar (15 routes) — *قلب المنصة*
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/maker-radar` | الرادار الرئيسي (pre_surge + quiet + explosive + early_break lists) |
| `GET/POST` | `/maker-radar/warmup` | تشغيل سكريبت Python maker_radar.py + caching النتيجة |
| `GET` | `/maker-radar/stock` | رادار لسهم واحد |
| `GET` | `/maker-radar/timeline` | تسلسل زمني للإشارات |
| `GET` | `/maker-radar/entry-timing` | توقيت الدخول الأمثل |
| `GET` | `/maker-radar/fundamentals` | أساسيات الشركات |
| `GET` | `/maker-radar/footprint` | أثر السيولة (footprint analysis) |
| `GET` | `/maker-radar/live-watch` | مراقبة لحظية |
| `GET` | `/maker-radar/multi-market` | رادار متعدد الأسواق (7 أسواق) |
| `GET` | `/maker-radar/net-picks` | صافي الاختيارات (Net Picks) |
| `GET` | `/maker-radar/sector-treemap` | treemap للقطاعات |
| `GET` | `/maker-radar/signal-tracker` | تتبّع الإشارات (verify) |
| `POST` | `/maker-radar/signal-tracker/verify` | تحقق من إشارة |
| `POST/GET/DELETE` | `/maker-radar/track` | تتبّع سهم معيّن |
| `GET/POST` | `/maker-radar/exit-radar` | رادار الخروج (5 مسارات) |

#### Radar (4 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/radar/personalized` | رادار شخصي (حسب المحفظة) |
| `GET` | `/radar/accuracy` | دقة الرادار (backtest) |
| `GET/POST` | `/radar/weekly-report` | تقرير أسبوعي للرادار |
| `GET` | `/radar/weekly-report/pdf` | PDF للتقرير الأسبوعي |

#### Explosive & Hunter & Sniper
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/explosive` | فرص انفجارية |
| `GET` | `/explosive/[ticker]` | تفاصيل فرصة |
| `GET` | `/explosive/hunt` | بحث عن فرص |
| `GET` | `/flow` | تدفّق سيولة عام |
| `GET` | `/flow/[ticker]` | تدفّق سيولة سهم |

### §5.8 التوقعات الذكية

#### Predictions (37 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/predictions` | قائمة/إنشاء توقعات |
| `POST` | `/predictions/generate` | توليد توقع لسهم |
| `POST` | `/predictions/generate-all` | توليد توقعات لكل الأسهم |
| `GET` | `/predictions/live` | توقعات لحظية |
| `GET` | `/predictions/intraday` | توقعات داخل اليوم |
| `GET` | `/predictions/active-management` | إدارة نشطة للتوقعات |
| `GET` | `/predictions/daily-picks` | اختيارات اليوم |
| `GET` | `/predictions/backtest-list` | قائمة باك-تست |
| `GET` | `/predictions/credibility` | مصداقية التوقعات |
| `GET/POST` | `/predictions/eid` | توقعات الأعياد (موسمية) |
| `GET` | `/predictions/expert-consensus` | إجماع الخبراء |
| `GET` | `/predictions/export-pdf` | تصدير PDF للتوقعات |
| `GET` | `/predictions/historical-trades` | صفقات تاريخية |
| `GET/POST` | `/predictions/honest-tracking/*` | تتبّع صادق (6 routes فرعية) |
| `GET` | `/predictions/learned-lessons` | دروس مستفادة |
| `GET` | `/predictions/league-report` | تقرير دوري |
| `GET` | `/predictions/monthly-league` | دوري شهري |
| `GET` | `/predictions/performance` | أداء التوقعات |
| `GET` | `/predictions/performance-dashboard` | لوحة أداء |
| `POST/GET` | `/predictions/price-verify` | تحقق من الأسعار |
| `POST/GET` | `/predictions/refresh-v40` | تحديث بمحرك V40 |
| `GET/POST` | `/predictions/seed` | seeding توقعات |
| `GET/POST` | `/predictions/tracking` | تتبّع التوقعات |
| `GET` | `/predictions/tracking/list` | قائمة التتبّع |
| `GET` | `/predictions/tracking/stats` | إحصائيات التتبّع |
| `POST` | `/predictions/tracking/verify` | تحقق تتبّع |
| `GET` | `/predictions/verify` | تحقق توقع |
| `GET/POST` | `/predictions/dual-track/*` | مسار مزدوج (4 routes) |

#### Real predictions & global
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/real-predictions` | توقعات حقيقية (مش تجريبية) |
| `GET` | `/global-predictions` | توقعات عالمية |
| `GET` | `/prediction-performance` | أداء التوقعات |
| `GET` | `/unified/predictions` | توقعات موحّدة |

### §5.9 المحفظة والمالية

#### Portfolio (21 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/portfolio` | محفظة المستخدم |
| `GET/POST` | `/portfolio/accounts` | حسابات المحفظة |
| `GET` | `/portfolio/accounts/[id]/state` | حالة حساب |
| `GET` | `/portfolio/accounts/[id]/equity-curve` | منحنى equity لحساب |
| `GET` | `/portfolio/holdings` | حيازات المحفظة |
| `GET` | `/portfolio/assets` | أصول المحفظة |
| `GET` | `/portfolio/equity/curve` | منحنى equity الكلي |
| `GET` | `/portfolio/equity-curve` | منحنى equity (alias) |
| `GET` | `/portfolio/cashflow` | تدفّق نقدي |
| `GET` | `/portfolio/analyze` | تحليل المحفظة |
| `GET` | `/portfolio/intelligence` | ذكاء المحفظة |
| `GET` | `/portfolio/master` | محفظة رئيسية |
| `GET` | `/portfolio/risk-summary` | ملخص المخاطر |
| `GET` | `/portfolio/state` | حالة المحفظة |
| `GET` | `/portfolio/watchlists` | قوائم المراقبة |
| `GET` | `/portfolio/unified-watch` | قائمة مراقبة موحّدة (محفظة + رادار) |
| `GET` | `/portfolio/bag-holder-rescue` | إنقاذ المحفظة الراكدة |
| `GET` | `/portfolio/smart-monitor/signals` | إشارات المراقب الذكي |
| `POST/GET` | `/portfolio/check` | فحص صحة المحفظة |
| `POST/GET` | `/portfolio/import-real` | استيراد محفظة حقيقية |
| `GET` | `/portfolio/priority-sync` | مزامنة أولويات |

#### Finance (19 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE` | `/finance/assets` | إدارة الأصول (CRUD) |
| `PUT/DELETE` | `/finance/assets/[id]` | أصل واحد |
| `GET/POST` | `/finance/transactions` | المعاملات المالية |
| `DELETE` | `/finance/transactions/[id]` | معاملة |
| `GET/POST/PUT/DELETE` | `/finance/obligations` | الالتزامات المالية |
| `GET/POST` | `/finance/obligations/payments` | دفعات الالتزامات |
| `GET` | `/finance/calculate-values` | حساب قيم المحفظة |
| `GET` | `/finance/portfolio-analysis` | تحليل المحفظة المالي |
| `GET` | `/finance/projection` | توقعات مالية مستقبلية |
| `GET` | `/finance/real-return` | العائد الحقيقي (بعد التضخم) |
| `GET` | `/finance/reports` | تقارير مالية |
| `POST` | `/finance/schema` | schema قاعدة البيانات |
| `GET/POST` | `/finance/screener` | screener مالي |
| `GET/POST` | `/finance/seed-alert-thresholds` | seeding عتبات التنبيهات |
| `GET` | `/finance/smart-alerts` | تنبيهات ذكية |
| `GET` | `/finance/smart-analysis` | تحليل ذكي |
| `GET/POST` | `/finance/smart-confluence` | confluence مالي |
| `GET/POST` | `/finance/smart-watchlist` | قائمة مراقبة ذكية |
| `POST/GET` | `/finance/inflation` | بيانات التضخم |

#### Watchlist & Risk
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/watchlist` | قائمة المراقبة |
| `PUT/DELETE` | `/watchlist/[id]` | عنصر قائمة |
| `GET` | `/watchlist-enhanced` | قائمة مراقبة محسّنة |
| `GET` | `/risk/decision-table` | جدول قرارات المخاطر |
| `GET` | `/risk/position-size` | حجم الصفقة (position sizing) |
| `GET` | `/risk/stock-types` | أنواع الأسهم (مضاربة/استثمارية) |
| `GET` | `/risk/stop-loss` | حساب وقف الخسارة |
| `GET` | `/risk/targets` | أهداف الربح |
| `POST/GET` | `/zakat/calculate` | حاسبة الزكاة |
| `GET` | `/deal-advisor/[ticker]` | مستشار صفقة لسهم |

#### Money
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/money` | ملخص أموال |
| `GET` | `/money/wealth` | ثروة المستخدم |
| `GET` | `/money/smart-monitor` | مراقب ذكي للأموال |

### §5.10 الذكاء الاصطناعي

#### AI Chat & Analysis
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/ai/chat` | محادثة AI (DeepSeek/Ollama) |
| `POST` | `/ai/analyze-stock` | تحليل AI لسهم |
| `POST` | `/ai/batch-analysis` | تحليل batch |
| `GET` | `/ai/models` | قائمة النماذج المحلية المتاحة (Ollama + Piper TTS) |
| `GET` | `/ai-proxy` | proxy لخدمة AI خارجية |
| `GET/POST` | `/ai-analysis` | تحليل AI مختصر |
| `GET` | `/ai-performance` | أداء الـ AI |

#### AI Predictions
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/ai-predictions/evaluate` | تقييم توقعات AI |
| `GET` | `/ai-predictions/extract` | استخراج توقعات AI |

#### 🆕 Content Studio + Educational APIs (NEW — 2026-09-30, Task EDUCATION-UPGRADE)

استوديو المحتوى المتحرك + APIs للمحتوى التعليمي والصفقات الناجحة الحقيقية.

##### Content Studio APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/api/ads/successful-trades?limit=10` | صفقات ناجحة حقيقية من predictions.db (actual_return > 0) — بيستخدمها TradesShowcase |
| `GET` | `/api/ads/educational-lessons?id=01` | دروس تعليمية حقيقية من content/education/*.md — بيستخدمها EducationalCardsStudio |
| `POST` | `/api/ads/capture-screenshot` | التقاط screenshots من المسارات الحية (Playwright) |
| `POST` | `/api/ads/generate-script` | نصوص إعلانية ثابتة من ad-templates.ts (بدون AI) |
| `GET/POST` | `/api/ads/generate-voice` | TTS (متعطّل في الإنتاج — 503 لو TTS مش متاح) |

#### 🆕 مولّد الإعلانات (Ad Generator) — *Task AD-GENERATOR*
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/ads/generate-script` | توليد سكريبت إعلاني عربي بالعامية المصرية (Ollama LLM) — يرجّع `{ script, caption, hashtags, scenes, featureName }` |
| `GET/POST` | `/ads/generate-voice` | تحويل السكريبت لصوت WAV/MP3 (Piper TTS محلي) |
| `POST` | `/ads/capture-screenshot` | التقاط screenshot حقيقي من شاشة الميزة بـ Playwright headless (mobile 414×896, retina 828×1792) |

### §5.11 التنبيهات والإشعارات

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/alerts` | تنبيهات المستخدم |
| `DELETE` | `/alerts/[id]` | حذف تنبيه |
| `POST` | `/alerts/create` | إنشاء تنبيه |
| `GET/POST` | `/alerts/quick-add` | إضافة سريعة |
| `GET/POST/DELETE` | `/alerts/gold` | تنبيهات الذهب |
| `GET/POST` | `/alerts/scheduler` | مجدول التنبيهات (cron-based) |
| `GET/POST` | `/notifications` | إشعارات المستخدم |
| `POST/GET` | `/push/register` | تسجيل device للـ push notifications |
| `GET` | `/scheduler/run` | تشغيل scheduler |
| `GET` | `/tips/random` | نصيحة عشوائية |

### §5.12 الأخبار

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `GET` | `/news` | أخبار (`market_news` — المصدر الرسمي). `?market=` `?limit=` (≤100) `?offset=` `?tickers=COMI,EGBE` | public |
| `POST` | `/news` | استقبال من news-agent. **`x-agent-key`** header. **بينضّف HTML من `title`/`content`/`summary_*` قبل الحفظ** | agent |
| `GET` | `/news-feed` | feed موحّد: `market_news` + `predictions.news_signals` + EGX + crypto + fear&greed. `?market=crypto`. limit 50 · cache 300s | public |
| `GET` | `/egxpilot/news` | أخبار egxpilot.com | public |
| `GET` | `/stocks/[ticker]/news` | أخبار سهم واحد | public |
| `GET` | `/admin/news-health` | صحّة محرك الأخبار | admin |
| `GET` | `/admin/news` | إدارة/معاينة أخبار | admin |

### §5.13 التيليجرام

| Method | Path | الوصف |
|--------|------|------|
| `POST/GET` | `/telegram/post` | نشر رسالة على تيليجرام |
| `POST/GET` | `/telegram/share` | مشاركة محتوى |
| `POST` | `/telegram/publish-stock` | نشر كارت سهم |
| `POST` | `/telegram/send-daily-report` | إرسال تقرير يومي |
| `*` | `/telegram/[...path]` | catch-all proxy لـ Telegram Bot API |

### §5.14 المحاكي والتعلّم

#### Paper Trading
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/paper-trading` | محاكي تداول (قديم) |
| `GET` | `/paper-trading-v2/account` | حساب المحاكي v2 |
| `POST` | `/paper-trading-v2/order` | إنشاء أمر |
| `GET` | `/paper-trading-v2/orders` | قائمة الأوامر |
| `POST` | `/paper-trading-v2/orders/[id]/close` | إغلاق أمر |
| `GET` | `/paper-trading-v2/positions` | المراكز المفتوحة |
| `POST` | `/paper-trading-v2/reset` | إعادة تعيين المحاكي |

#### Learning
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/learning/content` | محتوى تعليمي |
| `GET` | `/learning/indicators` | مؤشرات تعليمية |
| `GET` | `/learning/patterns` | أنماط شارت |
| `GET/POST` | `/learning/progress` | تقدّم التعلّم |
| `GET` | `/learning/status` | حالة التعلّم |
| `GET` | `/learning-params` | بارامترات التعلّم |
| `GET` | `/learning-params/active` | البارامترات النشطة |
| `GET` | `/learning-params/init` | init بارامترات |
| `GET` | `/learning-params/save` | حفظ بارامترات |
| `GET` | `/self-learning` | تعلّم ذاتي |
| `GET` | `/iterative-learning` | تعلّم تكراري |
| `GET` | `/unified-learning/*` | تعلّم موحّد (6 routes) |

#### Seasonality & Trading Journal
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/seasonality-signals` | إشارات موسمية |
| `GET` | `/stock-seasonality` | موسمية سهم |
| `GET/POST` | `/trading-journal` | يوميات التداول |
| `GET` | `/trading-journal/stats` | إحصائيات اليوميات |
| `GET/POST/DELETE` | `/stock-notebook` | نوتبوك الأسهم (ملاحظات شخصية) |

### §5.15 الأدمن (Admin APIs)

> 117 route تحت `/admin/*`. كلها محمية بـ `admin_session` cookie أو `X-Admin-Token` header.

#### 15.1 مصادقة الأدمن
| Method | Path | الوصف |
|--------|------|------|
| `POST/DELETE` | `/admin/auth` | verify credentials + set cookie |
| `POST` | `/admin/auth/auto-cookie` | auto-set admin cookie (Google login) |
| `GET` | `/admin/auth/token` | جلب X-Admin-Token base64 |

#### 15.2 إدارة قواعد البيانات (DB Manager)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/admin/db` | قائمة الـ DBs |
| `GET/DELETE` | `/admin/db/[db]` | DB واحد |
| `GET/POST` | `/admin/db/[db]/[table]` | جدول داخل DB |
| `PUT/DELETE` | `/admin/db/[db]/[table]/[row]` | صف داخل جدول |
| `GET` | `/admin/db-explorer` | استكشاف DB |
| `GET` | `/admin/db-health` | صحة الـ DBs |
| `GET/POST/DELETE` | `/admin/db-backup` | نسخ احتياطي |
| `GET/POST` | `/admin/db-manager` | مدير الـ DB الرئيسي |
| `GET` | `/admin/db-manager/schema` | schema الـ DB |
| `GET` | `/admin/db-manager/export` | تصدير DB |
| `POST/GET` | `/admin/db-manager/export-all` | تصدير كل DBs |
| `POST` | `/admin/db-manager/import-all` | استيراد كل DBs |
| `POST` | `/admin/db-manager/import-egx30` | استيراد EGX 30 |
| `POST` | `/admin/db-manager/backup` | إنشاء backup |
| `POST` | `/admin/db-manager/auto-backup` | backup تلقائي |
| `GET/POST/DELETE` | `/admin/db-manager/historical-backups` | backups تاريخية |
| `DELETE/POST` | `/admin/db-manager/delete-backup` | حذف backup |
| `POST` | `/admin/db-manager/restore` | استعادة backup |
| `POST` | `/admin/db-manager/recover` | استعادة طارئة |
| `POST` | `/admin/db-manager/recover-all` | استعادة كل DBs |
| `POST` | `/admin/db-manager/repair` | إصلاح DB |
| `POST` | `/admin/db-manager/repair-all` | إصلاح كل DBs |
| `POST` | `/admin/db-manager/repair-engine` | إصلاح engine DB |
| `POST` | `/admin/db-manager/reindex` | إعادة indexing |
| `POST` | `/admin/db-manager/vacuum` | vacuum (تقليص الحجم) |
| `POST` | `/admin/db-manager/wal-checkpoint` | WAL checkpoint |
| `POST` | `/admin/db-manager/checkpoint-all` | checkpoint لكل DBs |
| `POST` | `/admin/db-manager/cleanup-old-backups` | تنظيف backups قديمة |
| `POST` | `/admin/db-manager/cleanup-symbols` | تنظيف رموز مكررة |
| `POST` | `/admin/db-manager/drop-table` | حذف جدول |
| `POST` | `/admin/db-manager/truncate-table` | تفريغ جدول |
| `POST` | `/admin/db-manager/query` | استعلام SQL مباشر |
| `POST` | `/admin/db-manager/integrity` | فحص سلامة |

#### 15.3 الباك-تست والتوقعات
| Method | Path | الوصف |
|--------|------|------|
| `GET/PUT` | `/admin/advanced-analysis/config` | إعدادات التحليل المتقدّم |
| `POST/GET` | `/admin/advanced-analysis/run` | تشغيل تحليل متقدّم |
| `POST` | `/admin/backtest/ab-test` | A/B test |
| `GET` | `/admin/backtest/engine-results` | نتائج engine |
| `POST` | `/admin/backtest/run-engine` | تشغيل engine باك-تست |
| `POST` | `/admin/backtest/v40/run` | باك-تست V40 |
| `GET` | `/admin/backtest/v40/stats` | إحصائيات V40 |
| `GET` | `/admin/backtest/v40/status/[jobId]` | حالة job |
| `GET/POST` | `/admin/clean-predictions` | تنظيف توقعات |
| `POST/GET` | `/admin/clear-junk-data` | مسح بيانات قديمة |
| `POST/GET` | `/admin/clear-predictions` | مسح توقعات |
| `POST/GET` | `/admin/close-predictions` | إغلاق توقعات |
| `GET` | `/admin/learned-lessons` | دروس مستفادة |
| `GET` | `/admin/historical-backfill/results` | نتائج backfill |
| `POST` | `/admin/historical-backfill/run` | تشغيل backfill |
| `GET` | `/admin/historical-backfill/status` | حالة backfill |
| `POST` | `/admin/generate-predictions` | توليد توقعات |
| `POST/GET` | ~~`/admin/generate-historical-predictions`~~ | 🗑️ **410 Gone** (MAESTRO-KILL 2026-10-12) — كان بـ INSERT fabricated predictions من Maestro stack (Rule 35 violation). الآن بيرجّع 410 + redirect لـ V40.2 `daily_predictor.py`. |
| `POST` | `/admin/retroactive-predictions` | توقعات بأثر رجعي |
| `POST/GET` | `/admin/fix-dates` | إصلاح تواريخ |
| `POST/GET` | `/admin/refresh-historical-data` | تحديث بيانات تاريخية |

#### 15.4 استيراد البيانات
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/admin/import-data` | استيراد بيانات |
| `POST/GET` | `/admin/import-egxpilot` | استيراد egxpilot |
| `POST` | `/admin/import-snapshot` | استيراد snapshot |
| `POST/GET` | `/admin/import-stocks` | استيراد أسهم |
| `POST/GET` | `/admin/scrape-stocks` | scrape أسهم |
| `POST/GET` | `/admin/sync-stocks-db` | مزامنة stocks.db |
| `POST` | `/admin/sync-fundamentals` | مزامنة بيانات أساسية |
| `POST/GET` | `/admin/sync-vps` | مزامنة VPS |

#### 15.5 إدارة المحركات
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/engine-control/status` | حالة المحركات |
| `POST` | `/admin/engine-control/toggle` | toggle محرك |
| `POST` | `/admin/engine-control/trigger` | تشغيل محرك يدويًا |
| `POST` | `/admin/engine-control/weights` | أوزان المحركات |
| `GET/POST` | `/admin/engine-settings` | إعدادات المحرك |
| `POST` | `/admin/engine-settings/reset` | reset إعدادات |
| `GET` | `/admin/engines-status` | حالة كل المحركات |
| `POST` | `/admin/build-stock-dna` | بناء DNA سهم |

#### 15.6 المستخدمين
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/users` | قائمة المستخدمين |
| `GET/PATCH/DELETE` | `/admin/users/[id]` | مستخدم واحد |
| `POST` | `/admin/users/cleanup-expired` | تنظيف حسابات منتهية |
| `GET/POST` | `/admin/v40-control` | تحكم V40 |
| `GET/POST` | `/admin/recommendation-settings` | إعدادات التوصيات |
| `GET/POST` | `/admin/recommendations` | توصيات (admin) |

#### 15.7 الاشتراكات والتيليجرام
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/admin/subscription/seed` | seeding باقات |
| `POST` | `/admin/subscription/set-plan` | تعيين باقة لمستخدم |
| `GET/POST` | `/admin/telegram-report` | تقارير تيليجرام |

#### 🤖 بوابة ربط بوت التليجرام (BOT-SUBSCRIPTION-GATE)

| Method | Path | المصادقة | الوصف |
|--------|------|----------|------|
| `POST` | `/api/bot/link-token` | `X-Bot-Secret` | البوت يولّد توكن ربط لمرة واحدة (TTL 10 دقايق) |
| `GET` | `/api/bot/check-subscription` | `X-Bot-Secret` | هل الـ `chat_id` مربوط؟ والاشتراك مدفوع/-trial نشط؟ |
| `POST` | `/api/bot/link-account` | NextAuth session | المتصفحأكّد الربط بعد ما المستخدم يسجّل دخوله |

#### 15.8 التقارير والكروت التعليمية
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/admin/reports` | تقارير |
| `GET/POST` | `/admin/reports/[id]` | تقرير واحد |
| `GET` | `/admin/reports/[id]/image` | صورة تقرير |
| `GET/POST` | `/admin/educational-cards` | كروت تعليمية |
| `GET/POST/DELETE` | `/admin/educational-cards/[id]` | كرت تعليمي |
| `GET` | `/admin/educational-cards/lessons` | دروس |
| `GET` | `/admin/educational-cards/[id]/image` | صورة كرت |

#### 15.9 متنوّع
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/stats` | إحصائيات عامة |
| `GET` | `/admin/analytics` | تحليلات |
| `GET` | `/admin/system-health` | صحة النظام |
| `GET` | `/admin/system-resources` | موارد النظام |
| `GET` | `/admin/system-topology` | طوبولوجيا النظام |
| `GET` | `/admin/monitor` | monitoring |
| `GET` | `/admin/market-status` | حالة السوق |
| `GET/POST` | `/admin/news` | أخبار (admin) |
| `GET/POST/PUT/DELETE` | `/admin/promo-codes` | أكواد خصم |
| `GET/POST` | `/admin/pm2-control` | تحكم PM2 |
| `GET/POST` | `/admin/purge-cache` | مسح الكاش |
| `GET` | `/admin/export-data` | تصدير بيانات |
| `GET` | `/admin/export-vps` | تصدير VPS |
| `GET/POST` | `/admin/currency` | عملات (admin) |
| `GET/POST` | `/admin/gold` | ذهب (admin) |
| `GET` | `/admin/seasonality` | موسمية |
| `GET` | `/admin/platform-performance` | أداء المنصة |
| `GET` | `/admin/phase4-status` | حالة phase 4 |
| `GET` | `/admin/feature-flags` | feature flags |
| `GET` | `/admin/data-sources` | مصادر البيانات |
| `POST` | `/admin/ai-analyze` | تحليل AI (admin) |
| `POST` | `/admin/ai-predictions/generate` | توليد توقعات AI |
| `POST` | `/admin/ai-predictions/evaluate-range` | تقييم مدى توقعات |
| `POST/GET` | `/admin/screener-refresh` | تحديث screener |
| `GET/POST` | `/admin/ab-test` | A/B test |
| `GET/POST/PUT/DELETE` | `/admin/daily-analysis` | تحليل يومي |

### §5.16 محركات البيانات (Data Engine)

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/data-engine/health` | صحة محرك البيانات |
| `GET` | `/data-engine/status` | حالة المحرك |
| `GET` | `/data-engine/stocks` | بيانات الأسهم |
| `GET` | `/data-engine/crypto` | بيانات الكريبتو |
| `GET` | `/data-engine/gold` | بيانات الذهب |
| `GET` | `/data-engine/silver` | بيانات الفضة |
| `GET` | `/data-engine/metals` | بيانات المعادن |
| `GET` | `/data-engine/forex` | بيانات الفوركس |
| `GET` | `/data-engine/new-db-stats` | إحصائيات الـ DB الجديد |
| `GET` | `/data-engine/compare-db` | مقارنة DBs |
| `GET/POST` | `/data-engine/control` | تحكم في المحرك |
| `POST/GET` | `/data-engine/reload` | إعادة تحميل |

#### Cron Jobs (10 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/cron/auto-sync` | مزامنة تلقائية |
| `GET/POST` | `/cron/scheduled` | مهام مجدولة |
| `GET` | `/cron/confluence` | confluence cron |
| `GET` | `/cron/daily-telegram` | تيليجرام يومي |
| `GET` | `/cron/learning` | تعلّم cron |
| `GET` | `/cron/precompute` | precompute |
| `GET` | `/cron/predictions` | توقعات cron |
| `GET` | `/cron/screener` | screener cron |
| `GET/POST` | `/cron/update-cache` | تحديث الكاش |
| `GET` | `/cron/verify-predictions` | تحقق التوقعات |

#### Scrapers & Sync
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/scraper/start` | بدء scraper |
| `GET` | `/scraper/status` | حالة scraper |
| `POST` | `/scraper/stop` | إيقاف scraper |
| `GET/POST` | `/sync-prices` | مزامنة الأسعار |
| `GET/POST` | `/sync-historical` | مزامنة تاريخية |
| `GET` | `/sync-names` | مزامنة أسماء الأسهم |
| `POST/GET` | `/mubasher/sync` | مزامنة mubasher |
| `POST/GET` | `/import` | استيراد عام |
| `POST` | `/data-import` | استيراد بيانات |

### §5.17 المحمول (Mobile APIs)

> 48 route تحت `/mobile/*` — مخصّصة لتطبيق Flutter. بتتبع نفس نمط الـ APIs العادية لكن بتردّ بـ format أبسط.

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/mobile/dashboard` | لوحة تحكم المحمول |
| `GET` | `/mobile/summary` | ملخص عام |
| `GET` | `/mobile/auth/me` | بيانات المستخدم |
| `GET` | `/mobile/portfolio` | محفظة المحمول |
| `GET/POST/DELETE` | `/mobile/portfolio` | إدارة محفظة |
| `GET` | `/mobile/portfolio/analyze` | تحليل محفظة |
| `GET` | `/mobile/portfolio/intelligence` | ذكاء محفظة |
| `GET` | `/mobile/watchlist` | قائمة مراقبة |
| `GET/POST/DELETE` | `/mobile/watchlist` | إدارة قائمة |
| `GET` | `/mobile/watchlist/intelligence` | ذكاء قائمة مراقبة |
| `GET/POST` | `/mobile/watchlist-enhanced` | قائمة محسّنة |
| `GET` | `/mobile/stocks/[ticker]` | سهم |
| `GET` | `/mobile/stocks/[ticker]/professional-analysis` | تحليل احترافي |
| `GET` | `/mobile/stocks/[ticker]/recommendation` | توصية |
| `GET` | `/mobile/stocks/EGX/professional-analysis` | تحليل EGX |
| `GET` | `/mobile/stocks/EGX/recommendation` | توصية EGX |
| `GET` | `/mobile/analysis/EGX` | تحليل EGX |
| `GET` | `/mobile/analysis/[ticker]` | تحليل سهم |
| `GET` | `/mobile/market/overview` | نظرة عامة سوق |
| `GET` | `/mobile/market/morning-bell` | جرس الصباح |
| `GET` | `/mobile/market/recommendations/ai-insights` | رؤى AI |
| `GET` | `/mobile/predictions` | توقعات |
| `GET` | `/mobile/predictions/continuation` | استمرار توقعات |
| `GET` | `/mobile/predictions/exit-status` | حالة خروج |
| `GET` | `/mobile/recommendations` | توصيات |
| `GET` | `/mobile/expert-recommendations` | توصيات خبراء |
| `GET/POST` | `/mobile/maestro` | Maestro engine |
| `GET` | `/mobile/signals` | إشارات |
| `GET` | `/mobile/alerts/check` | فحص تنبيهات |
| `GET/POST/DELETE` | `/mobile/alerts/settings` | إعدادات تنبيهات |
| `GET` | `/mobile/notifications` | إشعارات |
| `GET/POST` | `/mobile/news` | أخبار |
| `GET` | `/mobile/reports` | تقارير |
| `GET` | `/mobile/seasonality` | موسمية |
| `GET` | `/mobile/risk` | مخاطر |
| `GET/POST` | `/mobile/community` | مجتمع |
| `GET` | `/mobile/learning` | تعلّم |
| `GET` | `/mobile/ai/recommendations` | توصيات AI |
| `GET` | `/mobile/crypto` | كريبتو |
| `GET` | `/mobile/crypto/[id]` | عملة |
| `GET` | `/mobile/crypto/analysis` | تحليل كريبتو |
| `GET` | `/mobile/crypto/learning` | تعلّم كريبتو |
| `GET` | `/mobile/crypto/portfolio` | محفظة كريبتو |
| `GET` | `/mobile/crypto/recommendations` | توصيات كريبتو |
| `GET` | `/mobile/crypto/watchlist` | قائمة مراقبة كريبتو |
| `GET` | `/mobile/gold` | ذهب |
| `GET` | `/mobile/gold/history` | تاريخ الذهب |
| `GET` | `/mobile/currency` | عملات |
| `GET` | `/mobile/subscription` | اشتراك |
| `GET` | `/mobile/zakat-calculator` | حاسبة زكاة |

### §5.18 الـ Proxies والـ Webhooks

| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE/PATCH` | `/python/[...path]` | Proxy لـ Python backend (Flask on port 5000) |
| `GET/POST/PUT/DELETE/PATCH` | `/proxy/[...path]` | Proxy عام |
| `GET/POST/PUT/DELETE` | `/proxy-prod/[...path]` | Proxy للـ production VPS |
| `*` | `/telegram/[...path]` | Proxy لـ Telegram Bot API |
| `GET/POST/PUT/PATCH/DELETE` | `/[...slug]` | catch-all (404 handler) |

### §5.19 محرّك Maestro

> 🗑️ **DELETE-MAESTRO (2026-10-12):** كل `/api/maestro/*` endpoints اتمسحت نهائياً. سيدي طلب: "Maestro ده ماضي أسود". كل الـ files في `archive/maestro-dead-code-20261012/`.

| Method | Path | الوصف |
|--------|------|------|
| ~~`GET`~~ | ~~`/maestro`~~ | ~~نقطة الدخول الرئيسية~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/overview`~~ | ~~نظرة عامة~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/command-center`~~ | ~~مركز القيادة~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/config`~~ | ~~إعدادات Maestro~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/signals`~~ | ~~إشارات Maestro~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/news`~~ | ~~أخبار Maestro~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/personas`~~ | ~~personas (مضارب/مستثمر)~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/stock/[ticker]`~~ | ~~تحليل Maestro لسهم~~ 🗑️ محذوف |
| ~~`GET`~~ | ~~`/maestro/logic-panel`~~ | ~~لوحة المنطق~~ 🗑️ محذوف |

#### v2 Pipeline (محرك موحّد v2)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/v2/pipelines` | قائمة pipelines |
| `POST/PUT` | `/v2/pipeline` | إنشاء/تعديل pipeline |
| `GET` | `/v2/pipeline/[name]/summary` | ملخص pipeline |
| `PUT` | `/v2/pipeline/[name]/engine/[engine]/toggle` | toggle محرك داخل pipeline |
| `PUT` | `/v2/pipeline/[name]/engine/[engine]/weight` | وزن محرك |
| `GET` | `/v2/engines` | قائمة المحركات |
| `GET/POST` | `/v2/admin/config` | إعدادات v2 |
| `POST` | `/v2/analyze` | تحليل v2 |
| `POST` | `/v2/unified/analyze` | تحليل موحّد |
| `POST` | `/v2/unified/scan` | scan موحّد |
| `GET` | `/v2/unified/config` | إعدادات unified |
| `GET` | `/v2/unified/personas` | personas موحّدة |
| `GET` | `/v2/recommend` | توصية v2 |
| `GET` | `/v2/morning-recommendations` | توصيات الصباح |
| `GET` | `/v2/day-trading-opportunities` | فرق day-trading |
| `GET` | `/v2/stock/[symbol]/analysis` | تحليل سهم v2 |
| `GET` | `/v2/chart/full-analysis` | تحليل شامل للشارت |
| `GET` | `/v2/live-analysis` | تحليل لحظي |
| `GET` | `/v2/health` | صحة v2 |
| `GET` | `/v2/presets` | presets |
| `GET` | `/v2/feedback/*` | feedback على backtest/predictions/run/status (4 routes) |

### §5.20 الـ v4 / v82 endpoints

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/v4/stats` | إحصائيات v4 |
| `GET` | `/v82` | محرك v82 (قرارات) |

### §5.21 أدوات متنوّعة

#### Export & Import
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/export` | تصدير عام |
| `GET` | `/database-report` | تقرير DB |
| `GET/POST` | `/parse-recommendations` | parse توصيات |

#### Community & User Posts
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/community` | مجتمع |
| `GET/POST` | `/community/seed` | seeding مجتمع |
| `GET/POST` | `/community/posts/[post_id]/comments` | تعليقات منشور |
| `GET/POST` | `/user-posts` | منشورات مستخدمين |
| `GET/DELETE` | `/user-posts/[id]` | منشور |
| `POST` | `/user-posts/[id]/like` | إعجاب |

#### Feedback & Points
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/feedback` | ملاحظات مستخدمين |
| `GET` | `/points` | نقاط المستخدم |
| `GET` | `/points/leaderboard` | لوحة الصدارة |

#### Scanner & Screener
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/scanner/quick` | scan سريع |
| `GET/POST` | `/scanner/run` | scan كامل |
| `GET` | `/screener/advanced` | screener متقدّم |

#### Expert Recommendations
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE` | `/expert-recommendations` | توصيات خبراء (CRUD) |
| `GET` | `/expert-recommendations/active` | توصيات نشطة |
| `GET` | `/expert-recommendations/experts` | قائمة خبراء |
| `GET` | `/expert-recommendations/batch` | batch توصيات |
| `POST` | `/expert-recommendations/import` | استيراد توصيات |
| `GET` | `/recommendations/expert` | alias |

#### Recommendations
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/recommendations` | توصيات |
| `GET` | `/recommendations/backtest` | باك-تست توصيات |
| `GET` | `/recommendations/batch` | batch |
| `GET` | `/recommendations/verify` | تحقق |
| `POST` | `/recommendations/publish` | نشر |
| `POST` | `/recommendations/publish/batch` | نشر batch |
| `POST` | `/recommendations/retroactive-evaluate` | تقييم بأثر رجعي |

#### Smart Confluence & Unified
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/smart-confluence/tabs` | تبويبات |
| `GET` | `/smart-confluence/analysis/[symbol]` | تحليل |
| `GET` | `/unified-analysis` | تحليل موحّد |
| `GET` | `/unified-analysis/[symbol]` | تحليل سهم |
| `GET` | `/unified-analysis/recommendations` | توصيات |
| `GET` | `/unified-scoring` | scoring موحّد |
| `GET` | `/unified-stocks` | أسهم موحّدة |
| `GET` | `/unified-market-analysis` | تحليل سوق موحّد |
| `GET/POST` | `/unified` | نقطة موحّدة |

#### Tracking & Stats
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/track` | تتبّع page view (analytics) |
| `GET` | `/tab-data` | بيانات تبويب |
| `GET` | `/monthly-performance` | أداء شهري |
| `GET` | `/indicator-trust-scores` | درجة ثقة المؤشرات |
| `GET` | `/fomo/missed-opportunities` | فرص ضائعة (FOMO) |
| `GET` | `/data-status` | حالة البيانات |
| `GET` | `/test-db` | اختبار DB |
| `GET` | `/test-simple` | اختبار بسيط |
| `GET` | `/init-db` | init DB |
| `GET` | `/trading/time` | وقت التداول |
| `GET` | `/system-control` | تحكم في النظام |
| `GET` | `/topology` | طوبولوجيا |
| `POST/GET` | `/run-all` | تشغيل كل المحركات |
| `GET/POST` | `/live-monitor` | مراقب لحظي |
| `GET` | `/live-monitor/ledger` | سجل المراقب |
| `POST` | `/live-monitor/trigger` | تشغيل يدوي |
| `GET/POST` | `/auto-refresh/start` | بدء auto-refresh |
| `GET` | `/auto-refresh/status` | حالة auto-refresh |
| `POST` | `/auto-refresh/stop` | إيقاف |
| `GET/POST` | `/cache` | كاش |
| `POST/GET` | `/cache/clear` | مسح الكاش |
| `GET` | `/features` | ميزات مفعّلة |
| `GET` | `/eodhd/backfill-status` | حالة backfill EODHD |

### §5.22 Devil's Advocate

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/devil/market-mood` | مزاج السوق |
| `GET` | `/devil/calendar` | تقويم أحداث |
| `GET` | `/devil/card/[ticker]` | كرت سهم (Devil) |
| `GET` | `/devil/scenario/[ticker]` | سيناريوهات سهم |
| `POST` | `/devil/filter` | فلتر Devil |

### §5.23 Hunter & Sniper

#### Hunter (صياد الفرص)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/hunter/daily-picks` | اختيارات اليوم |
| `GET` | `/hunter/screener` | screener |
| `POST` | `/hunter/refresh` | تحديث |
| `POST` | `/hunter/publish-pick` | نشر اختيار |
| `GET` | `/hunter/cache-status` | حالة الكاش |

#### Sniper (قنّاص التنبيهات)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/sniper/scan` | scan |
| `POST` | `/sniper/track` | تتبّع |
| `GET` | `/sniper/backtest` | باك-تست |
| `GET` | `/sniper/closer/pending` | صفقات قيد الإغلاق |
| `POST` | `/sniper/closer/run` | إغلاق صفقات |
| `GET` | `/sniper/learning/performance` | أداء التعلّم |

### §5.24 التقارير (Reports)

> 3 route تحت `/reports/*` — توفّر تقارير يومية / صباحية / أسبوعية للعميل.

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/reports/daily` | تقرير السوق اليومي — proxy للـ Python على `:8010/api/market-pulse`. يمرّر الـ query string كما-is. timeout=30s. | session | `src/app/api/reports/daily/route.ts` |
| `GET` | `/reports/morning` | جلب آخر morning reports من `stocks.db.morning_reports` (default limit=5). يقبل `?date=YYYY-MM-DD` لجلب تقرير يوم محدد + `?limit=N`. | session | `src/app/api/reports/morning/route.ts` |
| `POST` | `/reports/morning` | استقبال morning report جديد من Python backend (يتطلب `Authorization: Bearer <API_KEY>` لو `API_KEY` env set). body: `{ report_date?, report_text (required), report_type?, generated_at? }`. upsert بـ `UNIQUE(report_date, report_type)`. | api-key (when configured) | `src/app/api/reports/morning/route.ts` |
| `DELETE` | `/reports/morning` | حذف morning reports قديمة. accepts `?before=YYYY-MM-DD` لحذف كل التقارير قبل تاريخ محدد. default: حذف كل التقارير الأقدم من 30 يوم. returns `{ success: true, deleted: <count> }`. | api-key (when configured) | `src/app/api/reports/morning/route.ts` |
| `GET` | `/reports/weekly` | تقرير السوق الأسبوعي — proxy للـ Python على `:8010/api/market-pulse`. يمرّر الـ query string كما-is. timeout=30s. | session | `src/app/api/reports/weekly/route.ts` |

#### Schema — `stocks.db.morning_reports` (table)

```sql
CREATE TABLE IF NOT EXISTS morning_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date  TEXT    NOT NULL,
  report_text  TEXT    NOT NULL,
  report_type  TEXT    DEFAULT 'daily',
  generated_at TEXT,
  received_at  TEXT    DEFAULT (datetime('now')),
  source       TEXT    DEFAULT 'python_engine',
  UNIQUE(report_date, report_type)
);
CREATE INDEX IF NOT EXISTS idx_morning_date ON morning_reports(report_date);
```

#### الـ flow:
```
Python engine (Kimi/GLM) يولّد morning report
    ↓
POST /api/reports/morning  (with API_KEY)
    ↓
stocks.db.morning_reports  (upsert by report_date + report_type)
    ↓
Flutter/Web client
    ↓
GET /api/reports/morning?limit=5  (latest reports)
    ↓
عرض في MorningBellSection.tsx
```

### §5.25 Sharia Compliance APIs (Rule 64)

> **المرجع الدستوري:** القاعدة 64 (SHARIA-COMPLIANCE — 2026-10-03 — Task 23-A).
> **الـ backend:** `data_engine/scrapers/sharia_compliance_scraper.py` (cron `30 15 * * 6` = السبت 15:30 UTC · conditional GET بالـ ETag) → يكتب **6** جداول في `data_engine.db`.
> **الـ calculator:** `vps-service/portfolio/purification_calculator.py` (Python=Brain per Rule 20).
> **المعايير:** S&P Shariah أساسي + Musaffa/Kashif/Osoul تكميلية + AAOIFI مستعدّة + `consensus_min=6`.
> **⚠️ الكشف الثلاثي:** `GET /api/sharia` لو `sharia_metrics` مش موجودة بيرجّع **503 + `error: 'sharia_not_scraped'`** مع الـ hint.

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/sharia` | قائمة الأسهم مع `is_halal_consensus` + `compliant_sources_count` + `sp_haram_earning_pct` + `raw_symbol` + `alias_method` + `alias_confidence` + `needs_review` + `compliant_sources` (group_concat) + 8-source breakdown. **معاملات الاستعلام:** `?symbol=X` (تفاصيل سهم واحد + تفصيل كل المصادر + `purification_rates[]` + السعر الحالي) · `?search=` (رمز أو اسم عربي) · `?consensus=true` (بس الإجماع ≥6/8) · `?method=S&P` · `?source=musaffa` · `?review=true` (طابور المراجعة اليدوية) · `?limit=&offset=`. الرد كمان بيرجّع `alias_map.totals` + `alias_map.review_queue` من `sharia_symbol_map`. | public | `src/app/api/sharia/route.ts` (Task 23-C · مُحدَّث 2026-10-03) |
| `POST` | `/sharia/purification` | حساب التطهير. **وضعان** — (أ) صفقة واحدة: `{ symbol, quantity, buy_price?, sell_price? }` (ب) محفظة: `{ user_id, portfolio_id?, method?, include_capital_gain? }`. `method` = `'S&P'` (الافتراضي) أو `'musaffa'` \| `'kashif'` \| `'osoul'`. `include_capital_gain: false` = تطهير على التوزيعات بس. الرجوع = `PositionResult` (rate_pct · purification_base · purification_amount · dividends · capital_gain · dps + dps_source · compliant_sources · is_halal_consensus · warnings[] · notes[] · alternative_rates[]) أو `portfolio` (positions[] + skipped[] + risk_summary + totals). Python proxy. | public للسهم المفرد · **session إجباري للـ portfolio** | `src/app/api/sharia/purification/route.ts` (Task 23-C · **IDOR fix 2026-10-03**) |

#### §5.25.1 — قواعد الحساب المطبَّقة فعلياً

| الحالة | السلوك | السبب |
|--------|--------|-------|
| `sell_price < buy_price` (خسارة غير محققة) | ماتخصمش من الوعاء + note واضح | معيار S&P ملزم على **الأرباح المستلمة** فعلاً |
| الوعاء = 0 أو سالب | `purification_amount` = 0 (مفيش "تطهير سالب") | التطهير التزام مش خصم |
| نسبة S&P غير منشورة | fallback لـ musaffa/kashif/osoul + warning صريح | S&P بتغطي 182 من 253 بس |
| `compliant_sources_count = 0` | warning: «التطهير مش هوالمشكلة، المشكلة في امتلاك السهم نفسه» | السهم غير شرعي أصلاً |
| `needs_review = 1` | warning: «ربط الرمز محتاج مراجعة» + طريقة الربط | `alias_confidence` مش `high` |
| DPS مش موجود | fallback: `tab_dividends.dps_ttm` → `stocks.dps_ttm` → اشتقاق `dividend_yield × current_price` | أعمدة DPS ناقصة في بياناتنا |
| `stock_ticker` تالف في `portfolio_assets` | بيتحط في `skipped[]` مع `reason` | `'FWRYFawry...'` · `'INTEGRATED'` · `'4160'` |
| `method` مش متاح للسهم | fallback لأول rate متاحة + warning | حماية بدل فشل صامت |

#### §5.25.2 — Alias map (طابور المراجعة اليدوية)

`sharia_symbol_map` بيحفظ كل حالة ربط بدرجة ثقتها. **الربط ما بينكتبش صامت لما الرمز مختلف.**

| `match_method` | الثقة | `needs_review` | الحالي |
|----------------|-------|----------------|--------|
| `exact_ticker` | high | 0 | **249** |
| `arabic_prefix_ticker` | high | 0 | (بيستخدم في `KORRA`) |
| `name_exact_code_differs` | medium | 1 | 1 — `LBCT→IBCT` |
| `symbol_in_name` | medium | 1 | (مرفوض بـ collision في حالتين) |
| `collision_with_existing_source_symbol` | conflict | 1 | **مرفوض** — `EFG→HRHO` · `KORRA→KORA` |
| `unresolved` | none | 1 | **3** — `EFG` · `KORRA` · `MBEN` |

> **Collision guard (إلزامي):** لو الرمز المترشّح موجود هو نفسه كـ `symbol` **مستقل في المصدر** → الربط مرفوض. السبب: `KORA` (kashif compliant) و `KORRA` (0/8) عندهم نفس الاسم العربي بالظبط بس هما سهمين مختلفين في المصدر. نفس الفخ موجود عندنا في `VLMR`/`VLMRA` (المالك: «دول شركتين منفصلين مش شركة واحدة»).

### §5.26 Source Authority Admin APIs (Rule 66)

> **المرجع الدستوري:** القاعدة 66 (SOURCE-AUTHORITY — 2026-10-03 — Task 23-A).
> **الـ backend:** `vps-service/data/source_authority.py` (298 LOC — `write_guarded()` mandatory guard before any INSERT to `price_history.db`) — wired in 5/8 scrapers per Task 23-B + wired in `master_analyzer.analyze()` per commit `435c16f` (Rule 66 enforced end-to-end).
> **الـ admin UI:** ⏳ PENDING — identified as P0 missing in Task 27-B audit.

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/admin/sources` | ⏳ PENDING (planned). يعرض `CANONICAL_SOURCES` لكل سوق (EGX=`intraday_aggregated` · TADAWUL/KSE/QSE/US=`yahoo_clean` · CRYPTO=`crypto_fetcher` · GOLD=`gold_fetcher`) + `BANNED_SOURCES` (`egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill`) + last write count per source per market + recent `write_guarded()` rejections. | admin | ⏳ PENDING (handoff to Fix Battalion — Task 27-B P0 #2) |
| `PATCH` | `/admin/sources/banned` | ⏳ PENDING (planned). Toggle banned state for a source. body: `{ source: 'yahoo_safetynet', banned: true }` → updates `BANNED_SOURCES` list in `source_authority.py` config. | admin | ⏳ PENDING |

> **Implementation status:** Backend (`source_authority.py`) is fully ACTIVE per Rule 66 — `write_guarded()` is wired in 5 scrapers (Task 23-B) + `master_analyzer.analyze()` (commit `435c16f`). The admin route to SURFACE this data is PENDING. See `05-CURRENT_STATE.md` §17.1.

### 🆕 الإصلاحات الأمنية + التحقق (NEW — 2026-10-01, Task FIX-P1 to FIX-P6)

#### APIs الأمنية المُصحّحة
| API | الإصلاح | قبل | بعد |
|-----|---------|------|------|
| `POST /api/subscription/activate` | verify Paymob إجباري | يقبل tier من body | يقبل paymobOrderId + transactionId فقط |
| `POST /api/admin/auth` | gated بـ ALLOW_FORM_LOGIN | مفتوح دايماً | 403 لو ALLOW_FORM_LOGIN !== 'true' |
| `GET /api/admin/referrals` | requireAdminAsync | مفتوح | محمي بـ admin auth |
| `GET /api/admin/subscriptions` | requireAdminAsync | مفتوح | محمي بـ admin auth |
| `POST /api/telegram/publish-stock` | يكتب published_at | fire-and-forget | يحدّث predictions DB بعد النشر |
| `GET /api/predictions/price-verify` | يستخدم published_at | يبدأ من prediction_date | يبدأ من COALESCE(published_at, prediction_date) |
| `GET /api/predictions/honest-tracking/stats` | يفلتر was_published=1 | يحسب كل التوقعات | يحسب بس المنشورة فعلاً |
| `GET /api/predictions/honest-tracking/missed-opportunities` | يفلتر was_published=1 | يحسب بأثر رجعي | يحسب بس المنشورة فعلاً |
| `GET /api/market/top-movers` | يقبل market parameter | بيتجاهل السوق | بيفلتر بالسوق المختار |
| `GET /api/maker-radar` | trial gate | مفتوح | 403 لو trial منتهي |
| `POST /api/ai/chat` | trial gate + AI daily limit | مفتوح | 403 لو trial منتهي + 3 رسائل/يوم للـ Free |
| `POST /api/watchlist` | enforceWatchlistLimit | مفتوح | 403 لو تجاوز 5 أسهم (Free) |
| `POST /api/finance/assets` | enforcePortfolioLimit | مفتوح | 403 لو تجاوز 5 صفقات (Free) |
| `POST /api/alerts/create` | enforceAlertLimit | مفتوح | 403 لو تجاوز 3 تنبيهات (Free) |

### Prisma Models الجديدة (predictions schema)
```prisma
published_at       DateTime?   // وقت النشر الفعلي على تيليجرام
telegram_message_id String?    // ربط رسالة تيليجرام بالتوقع
was_published      Int @default(0)  // هل اتنشر فعلاً؟
target_hit_at     DateTime?   // وقت تحقق الهدف
stop_hit_at       DateTime?   // وقت ضرب وقف الخسارة
@@index([was_published])        // index للفلترة السريعة
```

### Helper Libraries الجديدة
| المكتبة | الوصف |
|---------|------|
| `src/lib/targets-validator.ts` | signal-aware validator (LONG + SHORT) — 8 تأثيرات |
| `src/lib/visual-templates.ts` | 9 قوالب بصرية (gradient + accent + glow لكل ميزة) |
| `src/lib/text-effects.ts` | 8 تأثيرات نصية + 4 easing + 6 presets |
| `src/lib/hashtag-library.ts` | مكتبة هاشتاجات (6 أسواق × 8 ميزات) |
| `src/lib/cta-templates.ts` | 15 CTA جاهز (6 أهداف × 3 جماهير) |
| `src/lib/ad-card-generator.ts` | كروت صور PNG (3 مقاسات) |
| `src/lib/subscription-enforcement.ts` | 4 دوال enforce server-side (watchlist + portfolio + alerts + AI) |
| `src/lib/ad-templates.ts` | نصوص ثابتة لـ 8 ميزات (بدون AI) |

### 📊 إحصائيات سريعة

```
إجمالي الـ routes: 411 (verified 2026-10-04 — was 380 pre-Wave-8; Wave 8 Task 774a208 restored 32 Flutter API endpoints that were archived by mistake in Wave 2)
عدد الـ top-level groups: 159+ (Wave 8 restored 32 endpoints INSIDE existing groups — no new top-level groups created)

أكبر 10 مجموعات (post-Wave-8):
  117+  admin          (إدارة شاملة)
   ~57  mobile         (was ~25 post-Wave-2; Wave 8 restored 32 Flutter API endpoints)
   ~15  predictions    (was 37 — Wave 2 archived ~22 dead predictions routes)
   ~15  market         (was 32 — Wave 2 archived ~17 dead market routes)
   ~10  stocks         (was 26 — Wave 2 archived ~16 dead stocks routes)
    3  v2             (was 24 — Wave 2 archived ~21 dead v2 routes)
   ~10  crypto         (was 23 — Wave 2 archived ~13 dead crypto routes)
   ~10  portfolio      (was 21 — Wave 2 archived ~11 dead portfolio routes)
   ~10  finance        (was 19 — Wave 2 archived ~9 dead finance routes)
   15  maker-radar    (رادار السيولة — unchanged)
    2  sharia         (NEW — Wave 8 — Rule 64 — Task 23-C)
```

### 🔐 طبقات الحماية (Auth Tiers)

| Tier | الوصف | الـ routes |
|------|------|-----------|
| `public` | مفيش auth | `/health`, `/keepalive`, `/auth/login`, `/auth/register`, `/app/version` |
| `session` | NextAuth session cookie | أغلب routes الـ user-facing |
| `admin` | `admin_session` cookie أو `X-Admin-Token` header | كل `/admin/*` + `/db-stats` + `/system/*` |
| `subscription` | session + فحص باقة (premium/pro) | `/portfolio/*` + `/predictions/advanced` + `/ai/*` |

**Admin auth flow:**
1. POST `/admin/auth` بـ username+password → set `admin_session` cookie (httpOnly, 7d)
2. أو POST `/admin/auth/auto-cookie` لو المستخدم مسجل بـ Google وأدمن
3. كل `/admin/*` requests بتحقّق cookie تلقائياً (middleware)
4. fallback: header `X-Admin-Token: base64(username:password)`

### 🌐 المسارات النسبية (Rule 61 — RELATIVE-PATHS-ONLY)

كل الـ routes في الجدول ده بتبدأ بـ `/api/` (relative). **ممنوع** استخدام:
- `http://localhost:3000/api/...`
- `https://invist.m2y.net/api/...`
- أي absolute URL

في الـ frontend: `fetch('/api/...')` فقط.
في الـ services الخارجية: استخدم `process.env.SCREENSHOT_BASE_URL` (لو محتاج origin كامل زي Playwright).

### 📝 قواعد إضافة API جديد

1. **أنشئ ملف** `src/app/api/<group>/<name>/route.ts`.
2. **حدّد الـ HTTP methods** بالـ exports: `export async function GET/POST/PUT/DELETE/PATCH`.
3. **وثّق الـ route** في أول الملف بـ JSDoc comment block.
4. **حدّد الـ auth** عبر middleware (`src/middleware.ts`) أو `requireAdminAsync()` / `requireSession()`.
5. **حدّث هذا الملف** بإضافة الـ route للقسم المناسب (أو أنشئ قسم جديد لو group جديد).
6. **لا تستخدم** absolute URLs (Rule 61).
7. **اختبر** بـ `curl -X METHOD http://localhost:3001/api/...`.

---

## 6. Data Flow

### 6.1 الـ Pipeline الكامل (8 stages)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. SCRAPERS (data_engine/scrapers/)                                     │
│    • tradingview_scraper.py → TA + UDF                                  │
│    • yahoo_scraper.py       → historical OHLC                           │
│    • egxpilot_scraper.py    → FREE fundamentals API                     │
│    • egksco_scraper.py      → EGX official (255 stocks)                 │
│    • us_stock_scraper.py    → US stocks (NEW 2026-10-12 — write_guarded)│
│    • news_scraper.py        → NewsAPI + GNews                           │
│    • coingecko_scraper.py   → crypto                                    │
│    • sharia_compliance_scraper.py → Sharia (NEW — Rule 64)              │
│    ↓ writes (WAL) via write_guarded()                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. data_engine.db (tab_*) + price_history.db (EGX OHLC)                 │
│    • tab_valuation/profitability/dividends/performance/technical_analysis│
│      (858-863 rows each — clean)                                        │
│    • tab_balance_sheet/income_statement/cash_flow (866 rows each — BROKEN│
│      column-shift)                                                      │
│    • egx_fundamentals (fresh EGXPilot data via cron)                    │
│    ↓ reads                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. ENGINES (vps-service/engines/ + analyzers/)                          │
│    • load_merged_history()  ← unified price path (single source)        │
│    • institutional_decision_engine.py → sl/tp1/tp2 + ATR-percentile     │
│    • maestro_orchestrator.py → 🗑️ محذوف (DELETE-MAESTRO 2026-10-12)    │
│    • fundamental_data_provider.py → fundamental_score (40/30/15/15)     │
│    • persona_engine.py → 4 personas + R:R overrides                     │
│    • v38_backtest_engine.py → simulate_trade() (canonical sl/tp1/tp2     │
│      + ATR clamp [5%,9%])                                               │
│    • expert_analysis_engine.py → 859 LOC (NEW 2026-10-12)               │
│    • gate_analysis_engine.py → 730 LOC (NEW 2026-10-12)                 │
│    ↓ writes                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. KILL FILTERS + R:R FLOOR GATE (daily_predictor.py L314-326)          │
│    • if r_mult < get_setting('dynamic_rr_normal', default=1.8): continue│
│      (Task REAPPLY-CRITICAL-FIXES — commit 38665fd1 — رفع من 1.5→1.8)  │
│    • set_strict_kill_filters(True) — liquidity + turnover               │
│    ↓ filtered                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. predictions.db (snapshot 2026-08-17 archive: 153 preds, 148 closed)  │
│    • fundamental_score = real (post FUNDAMENTALS-ACTIVATION)            │
│    • evidence_count + morning_bell + kill_filter_result                 │
│    • persona = 'balanced' (default — PROTECTED by PERSONA-UNIFY-A)      │
│    ↓ reads                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 6. CLOSING ENGINE (daily_closer.py)                                     │
│    • simulate_trade() — partial exits + trailing                        │
│    • SELL sign-flip fix + -20% cap (ULTRA-RESTORE)                      │
│    • HARD cap ABS(actual_return) <= 50 (P0-v2 — Rule 7)                 │
│    • 5-state taxonomy: TARGET_HIT/TRAILING_PROFIT/STOPPED/EXPIRED/PENDING│
│    ↓ writes outcome + actual_return                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ 7. LEARNING LOOP (lesson_store.py)                                      │
│    • STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT   │
│    • applied_lesson widen_stop logic (+0.15×ATR/repeat, max 0.5×ATR)   │
│    ↓ writes lessons + applied_lesson                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ 8. FLASK API (port 8010) → Next.js /api/proxy → UI                      │
│    • /api/predictions/honest-tracking/* (RL-FIX-9 — 5-state taxonomy)   │
│    • /api/chart/full-analysis (V40.2 — institutional_decision)          │
│    • /api/predictions/daily-picks (Picks Management — Top 5/day)        │
│    • /api/market/morning-bell                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 الـ Thresholds Source

- **`get_setting(key, default)`** في `vps-service/core/engine_settings.py` (1,150 LOC) — المصدر الوحيد للـ thresholds.
- **`engine_settings` table** في `learned.db` — thresholds قابلة للتعديل من Admin UI.
- **Fallback chain:** `get_setting(key, default)` → checks DB → falls back to Python default.
- **Optimizer DEFAULT_PARAMS** في `optimizer_params_routes.py`: `min_rr_ratio=1.8`, `max_stop_pct=9.0` (موحّد مع json بعد PERSONA-UNIFY-A Phase 3).

### 6.3 `load_merged_history()` — Unified Price Path

> **موجود في:** `vps-service/analyzers/master_analyzer.py`
> **الدور:** المصدر الوحيد لقراءة الأسعار (PHASE 1 — CONSTITUTION).
> **يقرأ من:** `price_history.db` (EGX OHLC، **1,206,981 rows، 1,336 tickers**).
> **Fallback:** `data_engine.db.historical_data` (Saudi/US/gold — NO EGX).

### 6.4 مثال: تدفق توقع V40.2 من الإنتاج

```
1. daily_predictor.py يبدأ (cron يومي بعد إغلاق السوق)
   ↓
2. لكل ticker في قائمة المراقبة (22 ticker):
   - load_merged_history(ticker) → df daily OHLC
   - build_institutional_decision(ticker, df, benchmark_change, ...)
     → returns {sl, tp1, tp2, rr_ratio_tp1, rr_ratio_tp2, tech_score, proofs, ...}
   ↓
3. R:R floor gate:
   if r_mult < 1.8: continue
   ↓
4. INSERT INTO predictions (ticker, signal, entry_price, target_price, stop_loss,
   target_price_2, atr_at_entry, evidence_count, morning_bell, kill_filter_result,
   persona='balanced', fundamental_score=real, ...)
   ↓
5. (Next day) daily_closer.py يفحص الـ predictions المفتوحة:
   - if exit_price <= sl: STOPPED
   - if exit_price >= tp1: TARGET_HIT (partial exit 50%)
   - if exit_price >= tp2: TRAILING_PROFIT (move stop to breakeven)
   - if holding_days > MONITORING_PERIOD_DAYS: EXPIRED
   - else: PENDING
   ↓
6. UPDATE predictions SET outcome='WIN'/'LOSS', actual_return=...,
   exit_type=..., closed_at=...
   (with HARD cap ABS(actual_return) <= 50)
   ↓
7. lesson_store.py يضيف درس لو STOP_TOO_TIGHT أو TARGET_HIT_OK
   ↓
8. /api/predictions/honest-tracking/list يرجّع الـ 5-state taxonomy
   → MarketAnalysisView UI (متابعة التوقعات + ملخص التوقعات tabs)
```

### 6.5 مؤشرات EGX30/EGX70 + مصادر البيانات المُحدَّثة (2026-09-26)

**أ. مؤشرات EGX30 و EGX70 — بيانات حقيقية من CSV:**
- **EGX30 Index:** قيمته الحالية **53,776.69** — مأخوذة من CSV الرسمي.
- **EGX70 Index:** قيمته الحالية **19,834.95** — مأخوذة من CSV الرسمي.
- المصدر: ملفات CSV داخل `data_engine/indices/` يتم تحديثها يدوياً/نصف آلياً ومقروءة عبر `load_index_history('EGX30' | 'EGX70')`.

**ب. TradingView scanner (`tradingview_scraper.py`):**
- يغطّي **296 سهماً** من EGX — تحديث يومي بعد إغلاق السوق.
- يكتب: TA indicators (RSI, MACD, EMA20/50/200, ATR, Volume profile) + UDF intraday candles.

**ج. egksco_scraper (`egksco_scraper.py`):**
- يغطّي **255 سهماً** من EGX (المصدر الرسمي لـ EGX).
- يكتب: **186 سجل price_history** لكل تشغيل (incremental updates).
- يُعتبَر الـ authoritative source لأسعار EGX end-of-day.

**د. price_history.db (السجل الموحّد للأسعار):**
- **1,206,981 صف**
- **1,336 ticker** مغطّاة (2000 → 2026).
- يُغذّي `load_merged_history()` — المصدر الوحيد للأسعار التاريخية.

**هـ. الـ Pipeline المُحدَّث:**
```
TradingView scanner (296 EGX) ─┐
egksco_scraper (255 EGX)     ─┼─→ price_history.db (1,206,981 rows / 1,336 ticker)
CSV indices (EGX30/EGX70)    ─┘   ↓
                                  load_merged_history() + load_index_history()
                                  ↓
                                  V40.2 daily generator + V38 backtest
```

> **Pipeline / Logic تفاصيل كاملة:** مرجع `03-HOW_IT_THINKS.md` (SYSTEM_HOW_IT_THINKS سابقًا) — Production Snapshot + 5-state taxonomy + ATR clamp + R:R floor gate.

---

## 7. Deployment & Infra (Caddy + PM2 + Cron + Mini-services)

### 7.1 Caddy Gateway (port 81 — single exposed port)

**الملف:** `./Caddyfile`

- يستقبل كل الـ HTTPS على المنفذ 81 (المُعرَّض للإنترنت فقط).
- يحوّل الـ query param `?XTransformPort=N` للخدمة الداخلية على المنفذ `N`.
- الـ default (بدون `XTransformPort`): يحوّل لـ Next.js على المنفذ 3000.

**مثال Caddyfile (مبسط):**
```
invist.m2y.net {
    reverse_proxy localhost:3000  # default → Next.js

    @telegram path /api/telegram/*
    reverse_proxy @telegram localhost:3003  # telegram-events mini-service

    @ws path /socket.io/*
    reverse_proxy @ws localhost:3005  # ws-service
}
```

### 7.2 PM2 Ecosystem

**الملف:** `./ecosystem.config.js` — 7 خدمات + telegram-poster.

| Service | Command | Port | Role |
|---|---|---|---|
| `nextjs` | `next start` | 3000 | Frontend |
| `python-backend` | `python3 main.py` | 8010 | THE BRAIN |
| `data-engine` | `python3 data_engine/main.py` | 5000 | scrapers |
| `ws-service` | `bun run vps-service/ws-service/index.ts` | 3005 | WebSocket |
| `telegram-events` | `bun run mini-services/telegram-events/index.ts` | 3003 | Telegram polling |
| `telegram-poster` | `bun run mini-services/telegram-poster/index.ts` | (no port) | auto-posting |
| `news-agent` | `python3 news-agent/main.py` | (no port) | EGX news agent (NEW 2026-09-27) |

### 7.3 Cron (vps-service/crontab.txt)

> ✅ **RESOLVED:** `egx_fundamental_fetcher.py` مُجدوَل السبت 14:00 UTC + مُحصّن ضد الـ column-shift (commit a268957 + 4cde9f0).

**الموجود (typical):**
```cron
# Daily after market close (15:30 Cairo)
30 15 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/daily_predictor.py >> logs/v40_2.log 2>&1
0  16 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/daily_closer.py >> logs/closer.log 2>&1
*/15 * * * * cd /root/GLMinvestment && python3 vps-service/jobs/intraday_aggregator.py >> logs/intraday.log 2>&1
0  * * * * cd /root/GLMinvestment && python3 vps-service/jobs/price_history_safetynet.py >> logs/safetynet.log 2>&1

# Weekly fundamentals fetch (Saturday 16:00 Cairo = 14:00 UTC):
0 14 * * 5 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python vps-service/data/egx_fundamental_fetcher.py >> /root/GLMinvestment/logs/fundamentals_fetch.log 2>&1

# Sharia compliance scraper (Saturday 15:30 UTC):
30 15 * * 6 cd /root/GLMinvestment && python3 data_engine/scrapers/sharia_compliance_scraper.py >> logs/sharia.log 2>&1

# Hourly WAL checkpoint
0 * * * * cd /root/GLMinvestment && python3 vps-service/jobs/wal_checkpoint.py >> logs/wal.log 2>&1

# Daily backup at 01:30 UTC
30 1 * * * cd /root/GLMinvestment && python3 vps-service/scripts/smart_db_backup.py >> logs/backup.log 2>&1
```

### 7.4 الـ Mini-Services Pattern

كل mini-service = **independent bun project**:
- own `package.json` (own dependencies)
- own port (3003, 3005, ...)
- `bun --hot` للـ hot-reload في dev
- started via PM2 في production (أو كـ long-running script)

**أمثلة:**
- `mini-services/telegram-events/` — port 3003 (polling 2s + socket.io broadcast)
- `vps-service/ws-service/` — port 3005 (polling 30s للـ Python + socket.io server)
- `mini-services/telegram-poster/` — script (auto-posting، no port)

### 7.5 الأوامر المساعدة (Helper Commands Runbook)

> **المصدر:** `أوامر مساعدة .text` (308 سطور — مُدمج كاملًا في هذا القسم).
> **المسار الإنتاجي:** `/root/GLMinvestment/` (مع التأكد من cwd قبل أي أمر)
> **الـ URL:** `https://invist.m2y.net` · **المستخدم:** `root`

#### 7.5.1 البنية التحتية (7 خدمات PM2)

| # | الخدمة | المنفذ | الوصف |
|---|---|---|---|
| 1 | `python-backend` | 8010 | 🧠 العقل — كل المنطق + التوقعات + V40.2 |
| 2 | `data-engine` | 5000 | 📡 جلب الأسعار (TradingView + Yahoo) |
| 3 | `nextjs` | 3000 | 🎨 العرض فقط (Next.js production) |
| 4 | `ws-service` | 3005 | ⚡ WebSocket لتحديثات الأسعار اللحظية |
| 5 | `telegram-poster` | — | 📱 نشر تيليجرام (scheduler) |
| 6 | `telegram-interactive-bot` | — | 🤖 البوت التفاعلي |
| 7 | `telegram-events` | 3003 | 📡 socket.io relay لأحداث تيليجرام |
| 8 | `news-agent` | — | 📰 وكيل أخبار EGX محلي |

**Ollama (Local AI / RAG):** منفصل — مُدار بـ systemd على المنفذ 11434 (ليس PM2).

#### 7.5.2 الأوامر الأساسية (الأكثر استخداماً)

**✅ فحص الحالة (Status):**
```bash
cd /root/GLMinvestment
pm2 status
pm2 list
```

**✅ فحص الـ Health:**
```bash
# فحص شامل للنظام كله
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool

# فحص Python backend مباشرة
curl -s http://127.0.0.1:8010/health

# فحص data-engine
curl -s http://127.0.0.1:3000/api/data-engine/health

# فحص admin cron health
curl -s http://127.0.0.1:3000/api/admin/cron-health
```

**✅ السجلات (Logs):**
```bash
# كل السجل الحي لكل الخدمات
pm2 logs

# سجل خدمة معينة فقط
pm2 logs python-backend --lines 100
pm2 logs nextjs --lines 50
pm2 logs data-engine --lines 50
pm2 logs news-agent --lines 50

# سجل لآخر N سطر فقط
pm2 logs python-backend --lines 200 --nostream
```

**✅ إعادة التشغيل (Restart):**
```bash
# إعادة تشغيل خدمة واحدة
pm2 restart python-backend
pm2 restart nextjs
pm2 restart data-engine
pm2 restart ws-service

# إعادة تشغيل كل الخدمات
pm2 restart all

# إعادة تشغيل مع تحديث متغيرات البيئة
pm2 restart python-backend --update-env
```

**✅ الإيقاف والتشغيل (Stop/Start):**
```bash
# تشغيل كل الخدمات من ecosystem.config.js
cd /root/GLMinvestment
pm2 start ecosystem.config.js

# إيقاف كل الخدمات
pm2 stop all

# حذف كل الخدمات من PM2 (لا يحذف الكود)
pm2 delete all

# إعادة تشغيل كل شيء من الصفر
pm2 delete all && pm2 start ecosystem.config.js
```

#### 7.5.3 التحديث من GitHub (Deploy)

**الطريقة الآمنة (موصى بها):**
```bash
cd /root/GLMinvestment

# 1. سحب آخر التحديثات
git pull origin main

# 2. تثبيت JS dependencies (لو تغير package.json)
bun install

# 3. توليد Prisma client (لو تغير schema)
bun run db:generate

# 4. إعادة بناء Next.js + إعادة تشغيله (atomic — ملف واحد)
bash scripts/rebuild-and-restart.sh

# 5. فحص الحالة
pm2 status
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

**تحديث Python backend فقط (بدون build):**
```bash
cd /root/GLMinvestment
git pull origin main
pm2 restart python-backend --update-env
pm2 restart data-engine --update-env
pm2 restart news-agent --update-env
```

**تحديث Next.js فقط (بعد تعديل frontend):**
```bash
cd /root/GLMinvestment
git pull origin main
bash scripts/rebuild-and-restart.sh
# هذا يساوي: bun run build && pm2 restart nextjs --update-env
```

#### 7.5.4 رادار السيولة + التوقعات (الأوامر المهمة)

**تشغيل رادار السيولة يدوياً (كل الأسهم EGX):**
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate  # أو .venv حسب الإعداد
python3 scripts/maker_radar.py --json-only
# النتيجة: scripts/output/maker_radar_EGX_<DATE>.json
```

**تشغيل الرادار لسوق آخر:**
```bash
python3 scripts/maker_radar.py --market TADAWUL --json-only
python3 scripts/maker_radar.py --market CRYPTO --json-only
python3 scripts/maker_radar.py --market GOLD --json-only
```

**تقرير الدقة التاريخية:**
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# عينة سريعة (250 يوم × 100 سهم)
python3 scripts/output/radar_historical_accuracy.py --top 250 --limit-tickers 100 --min-rows 90

# فحص فترة محددة
python3 scripts/output/radar_historical_accuracy.py --start 2026-01-01 --end 2026-06-30

# النتيجة: scripts/output/radar_historical_accuracy.json
```

**إغلاق التوقعات المنتهية (Daily Closer):**
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate
python3 -c "
import sys
sys.path.insert(0, 'vps-service')
from jobs.daily_closer import DailyCloser
closer = DailyCloser()
n = closer.run()
print(f'Closed {n} predictions')
"
```

**توليد توقعات V40.2 يدوياً:**
```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate
python3 scripts/v40_2_build_predictions.py
```

#### 7.5.5 قواعد البيانات (DB Safety)

> ⚠️ **Rule 1 (CONSTITUTION):** ممنوع لمس DBs الإنتاجية إلا عبر أدوات read-only.
> الاسترجاع يكون فقط عبر `vps-service/tools/restore_from_local.py` وبعد إذن المالك.

**فحص حالة DBs (read-only — آمن):**
```bash
cd /root/GLMinvestment
sqlite3 db/predictions.db "SELECT COUNT(*), status FROM predictions GROUP BY status"
sqlite3 db/stocks.db "SELECT COUNT(*) FROM stocks"
sqlite3 db/stocks.db "SELECT COUNT(*) FROM stock_daily_prices"
sqlite3 db/price_history.db "SELECT MIN(date), MAX(date), COUNT(*) FROM price_history"
```

**فحص DB integrity:**
```bash
sqlite3 db/predictions.db "PRAGMA integrity_check;"
sqlite3 db/stocks.db "PRAGMA integrity_check;"
```

**WAL checkpoint (لتسريع القراءة بعد عمليات كتابة كثيرة):**
```bash
sqlite3 db/predictions.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 db/stocks.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

**نسخة احتياطية قبل أي تعديل (محلي فقط — لا يُرفع لـ GitHub):**
```bash
cd /root/GLMinvestment
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p db/_backups
cp db/predictions.db db/_backups/predictions_${TS}.bak
cp db/stocks.db db/_backups/stocks_${TS}.bak
cp db/price_history.db db/_backups/price_history_${TS}.bak
# ملاحظة: db/_backups/ في .gitignore — آمن
```

#### 7.5.6 فحص الـ Lint + Tests (قبل أي commit)

```bash
cd /root/GLMinvestment

# Lint (Frontend)
bun run lint

# Tests (Frontend)
bun run test

# Tests (Backend Python)
cd vps-service && source venv/bin/activate && python3 -m pytest tests/ -v

# Type check (Frontend)
npx tsc --noEmit -p tsconfig.json

# Python syntax check
python3 -c "import sys; sys.path.insert(0, 'vps-service'); import main"
```

#### 7.5.7 استرداد الكوارث (Disaster Recovery)

**لو الـ Next.js مات ولا يريد أن يبدأ:**
```bash
cd /root/GLMinvestment
pm2 stop nextjs
rm -rf .next
bun run build
pm2 start nextjs --update-env
sleep 6
curl -s http://127.0.0.1:3000/api/health
```

**لو Python backend مات:**
```bash
cd /root/GLMinvestment
pm2 stop python-backend
source vps-service/venv/bin/activate
python3 -c "import sys; sys.path.insert(0,'vps-service'); import main" # تحقق imports
pm2 start python-backend --update-env
sleep 4
curl -s http://127.0.0.1:8010/health
```

**لو كل الخدمات معلقة (إعادة تشغيل كاملة):**
```bash
cd /root/GLMinvestment
pm2 delete all
pm2 start ecosystem.config.js
sleep 15
pm2 status
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

**لو git في حالة سيئة (recover):**
```bash
cd /root/GLMinvestment
git status
git fetch origin
git reset --hard origin/main  # ⚠️ يحذف كل التغييرات المحلية غير الملتزمة!
bash scripts/git-recover-and-push.sh  # سكريبت استرداد موجود في المشروع
```

#### 7.5.8 مراقبة الأداء (Monitoring)

**فحص استهلاك الذاكرة لكل خدمة:**
```bash
pm2 monit
# أو
pm2 list
```

**فحص system resources:**
```bash
free -h
df -h
top -bn1 | head -20
```

**فحص الـ cron jobs:**
```bash
crontab -l | head -30
```

#### 7.5.9 أمان

**تغيير إعدادات Admin (لو لزم):**
```bash
# المتغيرات المطلوبة في .env (لا تُرفع لـ GitHub):
# ADMIN_USERNAME=...
# ADMIN_PASSWORD=...
# ADMIN_EMAIL=...
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...
# NEXTAUTH_SECRET=...
# NEXTAUTH_URL=https://invist.m2y.net
```

**فحص الـ Sentry للأخطاء الإنتاجية:**
```bash
# السجلات تُرسل تلقائياً عبر sentry.client.config.ts + sentry.server.config.ts
# راجع dashboard Sentry للتفاصيل
```

#### 7.5.10 في حالة الطوارئ

| المشكلة | الحل السريع |
|---|---|
| الموقع لا يفتح | `pm2 status` ← شوف nextjs شغال؟ لو لأ: `pm2 restart nextjs` |
| API يرجع 500 | `pm2 logs python-backend --lines 50` ← شوف الخطأ |
| الأسعار لا تتحدث | `pm2 restart data-engine` + `curl http://127.0.0.1:5000/health` |
| التوقعات متوقفة | `pm2 logs python-backend \| grep -i v40` + شغل `python3 scripts/v40_2_build_predictions.py` يدوياً |
| تيليجرام لا ينشر | `pm2 restart telegram-poster` + `pm2 logs telegram-poster --lines 50` |
| ذاكرة عالية | `pm2 monit` + شوف الخدمة الأكثر استهلاكاً + `pm2 restart <name>` |

#### 7.5.11 قواعد صارمة (CONSTITUTION)

- ممنوع لمس DBs الإنتاجية إلا بأدوات read-only أو بعد إذن المالك (`restore_from_local.py`).
- ممنوع `restore_dbs.py` أو أي سكريبت يكتب فوق DB إنتاجي.
- ممنوع force push على `origin/main`.
- ممنوع `reset --hard` بدون فهم تام للتغييرات التي ستُفقد.
- كل المسارات نسبية (لا مسارات مطلقة مثل `/home/meme/...` في الكود).
- **VERIFY-BEFORE-DELETE** — حتى الملفات التي تبدو ميتة يجب سؤال المالك قبل حذفها.
- **لا بيانات وهمية** — كل اختبار يستخدم بيانات حقيقية أو لا يُنفذ.

### 7.6 Variables & Secrets (`.env`)

```bash
# Python
EGXPY_SERVICE_URL=http://localhost:8010
PYTHON_BACKEND_URL=http://localhost:8010
VPS_API_URL=http://localhost:8010

# Frontend
NEXTAUTH_URL=https://invist.m2y.net
NEXTAUTH_SECRET=<random>
GOOGLE_CLIENT_ID=<oauth>
GOOGLE_CLIENT_SECRET=<oauth>

# External APIs
EGKSCO_API_KEY=<egx-official>
EGXPILOT_API_KEY=<free>
NEWSAPI_KEY=<news>
COINGECKO_API_KEY=<crypto>
PAYMOB_API_KEY=<payment>
TELEGRAM_BOT_TOKEN=<telegram>
OLLAMA_HOST=http://localhost:11434

# DBs
DATABASE_URL=file:./db/auth.db
PREDICTIONS_DB=file:./db/predictions.db
```

### 7.7 Docker (Optional)

- `vps-service/Dockerfile` — صورة Python backend
- `docker-compose.yml` — يُشغّل كل الخدمات
- **غير مستخدم في الإنتاج** (الإنتاج بـ PM2 على VPS مباشرة)

---

## 8. Module Architecture

> **المرجع الدستوري:** Rule 60 (MODULE-SYSTEM — 2026-09-30) في `00-CONSTITUTION.md`.
> **المراحل:** 7 phases اتعملت في الفترة من 2026-09-25 لـ 2026-09-30 — حذف + دمج + ترحيل + توحيد + توثيق.

### 8.1 Frontend Modules (17 — `src/modules/`)

كل موديول ليه `index.ts` re-export shim كـ public interface. الـ imports بين الموديولات عبر الـ `index.ts` فقط.

| # | Module | Purpose | Components | Lib | LOC (approx) |
|---|---|---|---:|---:|---:|
| 1 | `radar/` | رادار السيولة + Exit Radar + Multi-Market + Accuracy + Personalized + Weekly Report + Signal Tracking | 8 | 3 | ~6K |
| 2 | `publishing/` | StockPublisher + UnifiedPublishButton + ShareButton + official links | 3 | 2 | ~3K |
| 3 | `personalized/` | Personalized Radar logic | — | 1 | ~1K |
| 4 | `stock-analysis/` | تحليل سهم فردي (StockDetail + ComprehensiveStockAnalysis + TreasuryBondsView + ...) | 15 | — | ~15K |
| 5 | `predictions/` | تتبع التوقعات + PersonaTab + DualTrack + MakerRadarTab + PicksManagement | 5 | — | ~20K |
| 6 | `portfolio/` | المحفظة + RoboAdvisor + BagHolderRescue + Risk Profiler Quiz + ... | 15 | — | ~12K |
| 7 | `screener/` | فلترة الأسهم المتقدمة (StockScreenerAdvanced) | 1 | — | ~8K |
| 8 | `market-analysis/` | تحليل السوق + SectorTracking + MarketAnalysisView + PersonaTab + PredictionsTab + ... | 24 | — | ~10K |
| 9 | `news/` | الأخبار + التحليلات (NewsFeedView) | 1 | — | ~5K |
| 10 | `admin/` | الأدمن (DB Manager + Topology + Users + Backtest + Notebook + Telegram + ... + live-chart/ + platform-performance/) | 34 | — | ~15K |
| 11 | `crypto/` | الكريبتو (8 sub-views) | 8 | — | ~8K |
| 12 | `education/` | الأكاديمية + التعلم (AcademyView + LearningView + CandlestickSimulator + ...) | 9 | — | ~5K |
| 13 | `reports/` | التقارير (ReportsView + DataManager + StockAnalysisReport + DailyMarketReport + ExecutiveReportView) | 5 | — | ~5K |
| 14 | `dashboard/` | الرئيسية + widgets (DashboardView + 21 widgets) | 21 | — | ~8K |
| 15 | `simulation/` | المحاكاة (SimulationView) | 1 | — | ~3K |
| 16 | `auth/` | المصادقة (DevLoginForm + auth gate) | 1 | — | ~1K |
| 17 | `subscription/` | الاشتراكات (PricingView + TrialExpiredModal + TrialCountdownBanner + UpsellToasts) | 4 | — | ~3K |
| **Total** | **17 modules** | | **150+** | **6** | **~120K** |

### 8.2 Backend Modules (9 placeholders — `vps-service/modules/`)

Placeholders only — Python file moves deferred (needs import-graph analysis). كل موديول فيه `__init__.py` docstring placeholder يوضّح scope.

| # | Module | Purpose | Status |
|---|---|---|---|
| 1 | `radar/` | maker_radar + exit_radar + signal_tracker | placeholder |
| 2 | `predictions/` | V40.2 generator + daily_closer + learning engine | placeholder |
| 3 | `market_regime/` | MarketRegimeEngine | placeholder |
| 4 | `market_data/` | data_engine + scrapers (TradingView + Yahoo + crypto + metals + us_stock) | placeholder |
| 5 | `telegram/` | auto_poster + card_publisher | placeholder |
| 6 | `ai/` | glm_finance_agent + nightly_analysis | placeholder |
| 7 | `portfolio/` | position_manager + stop_manager + smart_exit | placeholder |
| 8 | `admin/` | admin tools (evaluate_predictions + diagnose + restore) | placeholder |
| 9 | (root) | `vps-service/modules/__init__.py` | placeholder |

> **Follow-up (P1):** تنفيذ Phase 3-backend الفعلي — ترحيل الـ Python files لـ `vps-service/modules/<module>/` + تحديث الـ imports.

### 8.3 DB Layer (Phase 5 — موحّد عبر `src/lib/db/index.ts`)

**Single entry point:** `src/lib/db/index.ts`

| Source File | DB / Purpose | Importers |
|---|---|---:|
| `db-auth.ts` | `auth.db` — Prisma client (`db`, `authDb`) + User/Account/Session/SubscriptionPlan types | 5,031 |
| `db-predictions.ts` | `predictions.db` — `predictionsDb` accessor | 9 |
| `modules/radar/lib/radar-db.ts` | `stocks.db` radar tables — `getRadarDb`, `parseVolume`, `computeTurnover`, `getRadarDbConfig` | re-exported |
| `finance-db.ts` | `stocks.db` finance tables — `getFinanceDb`, `isFinanceDbAvailable` | 47 |
| `new-db.ts` | user data (Prisma) — `getDb`, `getReadOnlyDb` | 14 |
| `egxpy-bridge.ts` | Python backend bridge — `callPython`, `callPythonAsync` | 13 |
| `egx-data-sources.ts` | data sources config — `getDataSource`, `listDataSources` | 4 |

> **Phase 5 deletions:** `db-helpers.ts` + `db-v2.ts` + `egx-trading-hours.ts` (0 importers — dead facades) + ~22K LOC dead DB helpers كاملة.

### 8.4 Reorganization Stats (Before/After)

| Metric | Before | After | Delta |
|---|---:|---:|---|
| Frontend modules | 0 (scattered) | 15 | +15 |
| Backend modules | 0 (scattered) | 9 placeholders + root | +9 |
| Dead LOC | ~63,000 (estimated) | 0 in new module layer | -43,321 deleted (21,321 Phase 1-2 + 22,000 Phase 5) |
| Duplicate groups | 17 | 4 merged (Phase 2) + remaining targeted in P1 | -4 |
| Wiring disconnects | 30+ | 7 wired (Phase 4) + 2 already wired (audit verified) | -9 |
| Total LOC | ~580K | ~540K | -40K LOC |
| Tests passing | 187 | 259 passed / 15 pre-existing failures / 9 skipped (283 total) — 0 NEW failures | +72 passing |
| Frontend components | 274 (scattered) | 285 in modules + legacy | +11 wired |
| API routes | 653 | 653 (no new routes — Rule 4) | 0 |
| DB access entry points | 20+ scattered helpers | 1 canonical `src/lib/db/index.ts` | consolidated |
| Cron jobs | 18 | 22 (+4 wired in Phase 4.2) | +4 |
| market-analysis tabs | 8 | 11 (+3 wired in Phase 4.1) | +3 |

### 8.5 Module Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                Next.js Frontend (port 3001 — dev)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/modules/ (17 modules — see §8.1)                     │  │
│  │  ├── radar/              (liquidity radar — 8 components)  │  │
│  │  ├── publishing/         (3 components + 2 lib)            │  │
│  │  ├── personalized/       (1 lib)                           │  │
│  │  ├── stock-analysis/     (15 components — StockDetail)     │  │
│  │  ├── predictions/        (5 components — V40.2 tracking)    │  │
│  │  ├── portfolio/          (15 components — RoboAdvisor)      │  │
│  │  ├── screener/           (1 component — Advanced)           │  │
│  │  ├── market-analysis/    (24 components — SectorTracking)   │  │
│  │  ├── news/               (1 component — NewsFeedView)      │  │
│  │  ├── admin/              (34 components — DB Manager)       │  │
│  │  ├── crypto/             (8 components)                     │  │
│  │  ├── education/          (9 components — Academy+Learning) │  │
│  │  ├── reports/            (5 components — Weekly Report)      │  │
│  │  ├── dashboard/          (21 widgets — home dashboard)      │  │
│  │  └── simulation/         (1 component)                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/lib/db/index.ts (canonical DB access — Rule 5)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/app/api/ (411 routes — thin proxies to Python)       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕ HTTP (localhost:8010)
┌─────────────────────────────────────────────────────────────────┐
│              Python Backend (port 8010 — Flask/FastAPI)         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  vps-service/modules/ (9 placeholders — Phase 3.2)         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────────────┐
│                       Data Layer (SQLite)                       │
│  • stocks.db (14 MB) • predictions.db (235 MB)                  │
│  • data_engine.db (285 MB) • auth.db (0.2 MB)                    │
│  • price_history.db (307 MB) • intraday.db (448 MB)             │
└─────────────────────────────────────────────────────────────────┘
```

### 8.6 Phase History

| Phase | Task ID | What was done |
|---|---|---|
| Phase 1-2 | `REORG-PHASE-1-2` | حذف 21,321 LOC ميت (frontend lib + components + backend analyzers) + دمج 4 duplicate groups |
| Phase 3-4 | `REORG-PHASE-3-4` | إنشاء 3 frontend modules (radar + publishing + personalized) + 8 backend module placeholders + wiring 7 hidden gems (3 frontend tabs + 4 cron jobs) |
| Phase 5 | `REORG-PHASE-5` | توحيد DB layer (إنشاء `src/lib/db/index.ts`) + حذف 22K LOC إضافية من الـ dead DB helpers |
| Phase 6 | `REORG-PHASE-6` | إنشاء 12 frontend modules إضافية (screener + news + simulation + education + crypto + reports + predictions + portfolio + dashboard + stock-analysis + market-analysis + admin) — 139 files moved via `git mv` (R100 history preserved) |
| Phase 7 | `REORG-PHASE-7-DOCS` | توثيق الـ module architecture الجديدة |

---

## 9. Flutter App

> **المصدر:** `09-FLUTTER-APP.md` (158 سطر — مُدمج كاملًا في هذا القسم).
> **Repo URL:** `github.com/enmohsen20111975/flutter_investment_App.git`
> **Submodule path:** `/home/z/my-project/flutter_app/` (linked via `.gitmodules` per Task `FOCUS-5-TASKS-FLUTTER`)

### 9.1 نظرة عامة

تطبيق الأندرويد بيمثل واجهة العميل للمنصة. بيتكامل مع الـ Next.js backend عبر نفس الـ APIs.

- **اللغة:** Dart + Flutter
- **الشاشات:** 49 شاشة (عميل فقط — مفيش شاشات أدمن)
- **الـ APIs:** 60+ endpoint على Next.js backend
- **الحالة:** جاهز للنشر على Google Play Store

### 9.2 البنية

**الشاشات الرئيسية:**
- **Dashboard** — لوحة تحكم العميل + market selector (6 أسواق)
- **Stocks** — قائمة الأسهم + بحث + تفاصيل السهم
- **Radar** — رادار الأسهم + canonical levels (effEntry/effTarget1/effStop/effRR)
- **Reports** — التقارير الذكية + market selector + disclaimer احترافي
- **Portfolio** — المحفظة + أداء الصفقات
- **Watchlist** — قائمة المتابعة
- **News** — الأخبار (market-filtered)
- **Academy** — الأكاديمية التعليمية
- **Simulation** — المحاكاة
- **Settings** — الإعدادات + المفضلة

**API Integration:**
- **Base URL:** من env config (dev: localhost:3000, prod: invist.m2y.net)
- **Auth:** NextAuth session cookie + JWT tokens
- **Market param:** كل endpoints بتاخد `?market=EGX|TADAWUL|KSE|QSE|US|CRYPTO`

### 9.3 سجل التحديثات (FLUTTER-PROD)

#### FLUTTER-PROD-1 (2026-10-10) — جاهزية Google Store
- إصلاحات جاهزية النشر على Google Play
- Commit: `bb9983a`

#### FLUTTER-PROD-4 (2026-10-10) — إصلاح 5 endpoints
- `/api/ai/analyze-stock`: 404 → 200 + `analysis: null` (graceful empty)
- `/api/unified-learning/intelligent`: 503 → 200 + `insights: []`
- `/api/portfolio/accounts/[id]/equity-curve`: 502 → 200 + `snapshots: []`
- `/api/mobile/recommendations`: 500 → 200
- `/api/predictions`: 500 → 200

#### FLUTTER-PROD-5 (2026-10-10) — إصلاح endpoints حرجة
- `/api/stocks`: 500/503 → 200 (graceful fallback لو DB مش متاح)
- `/api/screener/advanced`: 500 → 200
- Commit: `332f522`

#### التحقق النهائي:
- ✅ `flutter analyze`: 0 errors
- ✅ كل endpoints اللي Flutter بيتصل بيها بترجع 200
- ✅ صفر compile errors

### 9.4 الـ APIs المستخدمة (60+ endpoint)

**Stocks:**
- `GET /api/stocks?market=X` — قائمة الأسهم
- `GET /api/stocks/[ticker]` — تفاصيل سهم
- `GET /api/stocks/[ticker]/unified` — التحليل الموحّد (canonical)
- `GET /api/stocks/[ticker]/expert-analysis` — تحليل خبير احترافي
- `GET /api/stocks/[ticker]/history` — بيانات تاريخية OHLCV

**Predictions:**
- `GET /api/predictions` — التوقعات
- `GET /api/predictions/tracking` — تتبع التوقعات
- `GET /api/predictions/honest-tracking` — التتبع الصادق
- `GET /api/predictions/dual-track` — التوقعات المزدوجة

**Market:**
- `GET /api/live/scan?market=X` — top movers
- `GET /api/news-feed?market=X` — الأخبار
- `GET /api/explosive?market=X` — أسهم انفجارية
- `GET /api/confluence/market-scan?market=X` — مسح السوق

**Portfolio:**
- `GET /api/portfolio/accounts` — حسابات المحفظة
- `GET /api/portfolio/accounts/[id]/equity-curve` — منحنى رأس المال
- `GET /api/portfolio/risk-summary` — ملخص المخاطر

**AI / Learning:**
- `GET /api/ai/analyze-stock?ticker=X` — تحليل AI
- `GET /api/unified-learning/intelligent` — insights ذكية

**Mobile-specific:**
- `GET /api/mobile/recommendations` — توصيات للجوال
- `GET /api/app/version` — فحص إصدار التطبيق

### 9.5 Flutter App Architecture Overview

| المكوّن | القيمة | ملاحظات |
|---|---|---|
| Submodule path | `/home/z/my-project/flutter_app/` | Linked via `.gitmodules` — every backend change automatically gets a mirror Flutter method in the same session |
| Repo URL | `github.com/enmohsen20111975/flutter_investment_App.git` | |
| App version (pubspec.yaml) | **3.0.1+44** | `version: 3.0.1+44` |
| Total `.dart` files | **113** | `find flutter_app/lib -name '*.dart' \| wc -l` |
| `lib/api/client.dart` LOC | 4,374 | Single Flutter API client file — one method per backend endpoint |
| `lib/api/mobile_api.dart` LOC | 273 | Mobile wrapper (subset of `client.dart` for mobile-specific routes) |
| Endpoint methods in `client.dart` | **~181** | ~181 unique endpoint methods per Task 27-A audit |
| Model files | 16 | `lib/models/` barrel export `lib/models/types.dart` |
| Screens | 46+ | `lib/screens/*.dart` |
| Theme primary color | `#6366F1` (Indigo) — **DESIGN MISMATCH**: website is `hsl(160,84%,39%)≈#10B981` (emerald-600) per Task 24 | **P0 item 9** in Task 27-A audit — needs migration to emerald |
| `AppColors.primary` (Flutter) | `0xFF6366F1` | Target: `0xFF10B981` (emerald-600) + `AppColors.primaryDark` → `0xFF059669` (emerald-700) + `AppColors.primaryLight` → `0xFF34D399` (emerald-400) |
| Flutter `pubspec.yaml` dependencies | ~80 packages | includes `flutter_riverpod` for state management + `dio`/`http` for HTTP + `google_fonts` + `fl_chart` for charts |

### 9.6 Flutter → Backend API contract (Wave 8 update — Task `774a208`)

- Wave 2 cleanup had archived 32 routes under `/api/mobile/*`, `/api/app/*`, `/api/ai/*`, `/api/confluence/*`, `/api/data-engine/*`, `/api/fomo/*`, `/api/google-play/*`, `/api/kimi/*`, `/api/learning/*`, `/api/live/*` — they were actually called by `flutter_app/lib/api/client.dart` (181 methods). Mobile app was silently broken — every screen that called one of these showed "no data".
- Wave 8 commit `774a208` restored all 32 endpoints from git history → Flutter app now has 181/181 endpoint methods resolving to live Next.js routes.

### 9.7 الإعدادات

**Environment Config:**
```dart
// lib/api/config.dart
class ApiConfig {
  static const String devBaseUrl = 'http://localhost:3000';
  static const String prodBaseUrl = 'https://invist.m2y.net';
  static String get baseUrl => kReleaseMode ? prodBaseUrl : devBaseUrl;
}
```

**Market Codes (موحّدة مع المنصة):**
```dart
const MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'];
```

### 9.8 النشر (Deployment)

**Google Play Store:**
1. `flutter build appbundle --release`
2. رفع الـ `.aab` على Play Console
3. مراجعة سياسات Google Play (مخاطر مالية + disclaimers)
4. النشر

**المتطلبات:**
- ✅ Target SDK: أحدث
- ✅ Min SDK: 21+ (Android 5.0+)
- ✅ Permissions: INTERNET only
- ✅ No tracking without consent

### 9.9 التكامل مع المنصة

**Single Source of Truth:**
- التطبيق بـ يقرأ من نفس الـ DBs بتاعة المنصة
- نفس الـ canonical signals (classifySignal من canonical-signal.ts)
- نفس MarketProfile (موجود في market-profile.ts — port لـ Python unified_config.py)
- نفس الـ thresholds (78/65/55/40/25 — Rule 73)

**Rule 20 (Python = العقل):**
- التطبيق بـ يعرض البيانات فقط (مش بيحسب)
- كل الحسابات في Python backend + canonical TypeScript functions
- التطبيق بـ يستدعي APIs وبـ يعرض النتايج

### 9.10 الإحصائيات

- **عدد الشاشات:** 49
- **عدد الـ APIs:** 60+
- **حجم الكود:** ~15,000 سطر Dart
- **آخر تحديث:** 2026-10-10
- **الحالة:** جاهز للنشر ✅

### 9.11 Outstanding P0 items (handoff to Fix Battalion — Task 27-A)

- 10 P0 issues identified (chart broken / missing Sharia screen / missing paywall handling / indigo→emerald / null levels render as "0.00" / etc.)

---

## 10. AI News Agent + Corporate Actions

### 10.1 AI News Agent

**الملف:** `vps-service/ai/news_agent.py` (340 LOC)

وكيل ذكي لجلب وتحليل الأخبار باستخدام أدوات مجانية:

| المكون | الحزمة | الوصف | الحالة |
|---|---|---|---|
| **DuckDuckGo Search** | `ddgs` | بحث مجاني عن أخبار السهم (بدون API key) | ✅ شغّال |
| **Trafilatura** | `trafilatura` | استخلاص نص المقال من HTML → نص نقي | ✅ شغّال |
| **Ollama** | `ollama` | تحليل بالـ AI المحلي (qwen2.5:1.5b) | ❌ crash (CPU بلا AVX) |
| **Keyword Fallback** | (مدمج) | 120+ كلمة مفتاحية (عربي + إنجليزي) بأوزان 1-3 | ✅ شغّال (الإنتاج) |

**كيف يعمل:**
```
V40.2 يولّد signal
  ↓
News Agent يبحث (DuckDuckGo) عن أخبار السهم
  ↓
يستخرج نص المقال (Trafilatura)
  ↓
يحاول Ollama → crash → keyword fallback
  ↓
يرجع: sentiment (positive/negative/neutral) + score (0-100) + summary
  ↓
لو score < 30 (سلبي جداً) → ارفض الإشارة
```

**التكامل مع V40.2:** `daily_predictor.py` (سطر 1159-1185)
- بعد بناء كل signal → شغل News Agent
- خزّن `news_sentiment` + `news_score` + `news_summary` في signal
- لو `score < 30 AND confidence > 0.5` → ارفض الإشارة
- safe-by-design: لو فشل → تجاهل (لا تأثير على التوقعات)

**اختبار الإنتاج (2026-08-31):**
```
SWDY (Ezz Steel):    positive, score=90/100, 3 كلمات إيجابية (وزن 8)
HRHO (Hassan Allam): positive, score=80/100, 2 كلمات إيجابية (وزن 6)
COMI (CIB):          neutral, score=50/100, لا توجد أخبار (DuckDuckGo rate limit)
```

### 10.2 Corporate Actions — أخبار الاكتتاب وتوزيع الأرباح (مطلوب تنفيذه)

**المشكلة:** النظام الحالي ما بيجيبش أخبار الاكتتاب (IPO) ولا توزيع الأرباح (Dividends) ولا مواعيدها.
دي معلومات بتقلب تحليلات السهم بشكل كبير:

| الحدث | التأثير على السهم | المصدر المقترح |
|---|---|---|
| **اكتتاب جديد (IPO)** | سهم جديد يدخل السوق → سيولة بتتحرك | DuckDuckGo + EGX website |
| **توزيع أرباح (Dividend)** | ex-div date → السعر ينزل بقيمة التوزيع | EGXPilot + data_engine.db.tab_dividends |
| **split/reverse split** | تغيير عدد الأسهم → السعر يتغير | EGX announcements |
| **general assembly** | قرارات مهمة (توزيع/زيادة رأس مال) | EGX website |

**الخطة المقترحة (4 مراحل):**

#### المرحلة 1: جدول توزيع الأرباح (Dividend Calendar)
```
المصدر: data_engine.db.tab_dividends (موجود بالفعل — 858 صف)
المنطق:
  - قبل كل توقع، افحص هل السهم عنده ex-div date خلال 7 أيام
  - لو ex-div قريب → خزّن كـ warning (مش رفض)
  - لو ex-div خلال 2 يوم → رفض الدخول (السعر هينزل)
```

#### المرحلة 2: أخبار الاكتتاب (IPO News)
```
المصدر: DuckDuckGo search "EGX IPO Egypt stock"
المنطق:
  - ابحث عن أخبار الاكتتاب الجديد
  - لو فيه اكتتاب جديد → تأثير على سيولة السوق
  - خزّن في news_agent كـ "ipo_alert"
```

#### المرحلة 3: General Assembly Calendar
```
المصدر: EGX website scraping
المنطق:
  - اجمع مواعيد الجمعيات العمومية
  - قبل كل توقع، افحص هل السهم عنده جمعية قريبة
  - لو الجمعية خلال 3 أيام → warning (قرارات ممكن تقلب السعر)
```

#### المرحلة 4: دمج Corporate Actions في V40.2
```
في daily_predictor.py، بعد Entry Gate:
  1. فحص Dividend Calendar → warning/reject
  2. فحص IPO News → warning
  3. فحص General Assembly → warning/reject
  4. خزّن كل corporate actions في signal للـ audit
```

**DB tables المطلوبة:**
```sql
-- جدول جديد في predictions.db
CREATE TABLE IF NOT EXISTS corporate_actions (
    id TEXT PRIMARY KEY,
    ticker TEXT,
    action_type TEXT,  -- 'dividend', 'ipo', 'split', 'assembly'
    action_date TEXT,
    details TEXT,      -- JSON بتفاصيل الحدث
    source TEXT,       -- 'egx', 'duckduckgo', 'egxpilot'
    created_at TEXT
);
```

### 10.3 الـ Cron المقترح للـ Corporate Actions

```bash
# جلب توزيعات الأرباح يومياً (من EGXPilot)
0 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_dividends.py >> /tmp/dividends.log 2>&1

# جلب أخبار الاكتتاب كل 6 ساعات
0 */6 * * * cd /root/GLMinvestment && python3 vps-service/jobs/fetch_ipo_news.py >> /tmp/ipo_news.log 2>&1

# جلب مواعيد الجمعيات العمومية يومياً
30 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_assembly_calendar.py >> /tmp/assembly.log 2>&1
```

---

## 11. DB Resilience Strategy

> **المصدر:** `DB-RESILIENCE-STRATEGY.md` (مُدمج من `01-PROJECT_ANATOMY.md` §appendix).
> **Task ID:** 16-D · **Agent:** Strategic Thinking (DB Resilience + SQL Alternative)
> **Status:** 📋 STRATEGIC — for owner review. **Nothing in this document is implemented.**
> **Date:** 2026-10-02 · **Author:** Z.ai strategic-thinking sub-agent
> **Compliance:** Constitution Rule 1 (NEVER touch prod DBs) · Rule 6 (schema-aware) · Rule 12 (`load_merged_history()` sole source) · Rule 63 (new documentation file — permitted; no new screens, no new system files, no DB writes).
>
> **Reading order:** §11.0 owner brief → §11.1 risk audit → §11.2 backup strategy → §11.3 PostgreSQL alternative → §11.4 Turso / libSQL alternative → §11.5 sharding → §11.6 PITR → §11.7 HA → §11.8 retention → §11.9 monitoring → §11.10 DR runbook → §11.11 cost-benefit → §11.12 ranked recommendations → §11.13 decision matrix → §11.14 what this doc does NOT do → §11.15 references.

### §11.0 — Owner Brief (what triggered this document)

The owner (`enmohsen20111975`) raised three concrete worries on 2026-10-02:

1. **"How do we escape DB corruption problems?"** — SQLite has no built-in corruption repair tool beyond `.recover` (which is lossy). One bad write can cascade across the WAL.
2. **"Continuous backups are consuming all server disk."** — the existing `smart_db_backup.py` keeps 7 full-file copies of each of 6 DBs totaling ~1.23 GB uncompressed × 7 = ~8.6 GB just for daily rotation, plus hourly WAL files, plus `.bak-unify` snapshots from prior migrations. On a small VPS this is real pressure.
3. **"Is there a viable alternative to SQLite?"** — the owner has heard of PostgreSQL and wants to know whether (and when) a migration is worth it.

This document does **not** prescribe a single path. It lays out the options, the trade-offs, the costs, and the trigger conditions, so the owner can decide.

### §11.1 — DB Corruption Risk Audit (current state, 2026-10-02)

#### 11.1.1 What we actually have today (verified by reading the code)

| Component | Path | Status |
|---|---|---|
| **6 production DBs** | `db/*.db` | stocks (14 MB), data_engine (272 MB), predictions (224 MB), price_history (293 MB), auth (208 KB), intraday (427 MB) — **total ~1.23 GB** |
| **Smart backup guard** | `vps-service/scripts/smart_db_backup.py` | ✅ active, runs daily at 01:30 UTC via `crontab.txt` entry #10 |
| **Hourly WAL checkpoint** | `vps-service/jobs/wal_checkpoint.py` | ✅ active, runs hourly on 4 DBs (stocks + predictions + price_history + data_engine) — **intraday.db and auth.db NOT covered** |
| **Daily integrity check** | `smart_db_backup.py` runs `PRAGMA integrity_check` on every backup cycle | ✅ active |
| **Auto-restore on shrink** | `smart_db_backup.py` will restore from last good backup if file shrinks ≥ 20%, integrity_check fails, OR any table loses ≥ 20% of rows (P27-ROW-LOSS guard) | ✅ active — strong defense |
| **Off-site backup** | none | ❌ **GAP** — all 7 backup generations live on the same VPS disk as production DBs |
| **Compression** | none — backups are raw `.db` files copied via `sqlite3.backup()` | ❌ **GAP** — wastes ~60-70% disk |
| **Rotation policy** | keep last 7 per DB | ⚠️ no weekly, no monthly, no annual tiers |
| **PITR (point-in-time recovery)** | none — SQLite WAL is checkpointed away hourly, no archiving | ❌ **GAP** — recovery granularity = "as of last 01:30 UTC backup" = up to 24 h data loss |
| **`scripts/auto-backup.sh`** | referenced by `scripts/setup-backup-cron.sh` but **file does NOT exist on disk** | ❌ **GAP** — if an engineer installs the cron via `setup-backup-cron.sh`, backups silently never run. The real working cron is `crontab.txt` entry #10 calling `smart_db_backup.py`. |
| **`.bak-unify` migration snapshots** | `db/*.db.bak-unify` (511 MB total) | ⚠️ lingering from P0-8-DB-UNIFY (2026-09-25) — never cleaned up |
| **`.bak-heli-fix` / `.bak-full-cleanup` / `.bak-heli-expired-fix`** | `db/predictions.db.bak-*` (3 × 235 MB = 705 MB) | ⚠️ lingering from HELI-CLEANUP-2 (2026-09-27) — never cleaned up |
| **`databases_backup.tar.gz` in git (37 MB)** | stale snapshot, dated ~2026-09-25 | ⚠️ ages with every commit, bloats git repo |

**Estimated disk wasted by lingering `.bak-*` files:** 511 MB + 705 MB = **~1.2 GB** — almost the same as a full production DB set. Cleaning these (after Rule 1-confirmed-safe verification) is the single biggest immediate win.

#### 11.1.2 SQLite corruption causes — applicability to our 6 DBs

| Cause | Mechanism | Our exposure |
|---|---|---|
| **Concurrent writers** | SQLite serializes writes via file lock. Two processes writing simultaneously get `SQLITE_BUSY`; on badly-configured systems (no `busy_timeout`), writes can fail mid-transaction. | 🟡 Moderate. `wal_checkpoint.py` sets `busy_timeout=30000` and we use WAL mode everywhere. However, `intraday_scanner.py` writes every 5 minutes during market hours AND `tradingview_scraper.py` writes every 5 minutes simultaneously to `data_engine.db`. |
| **Power loss / unclean shutdown** | WAL not checkpointed → orphan pages → on next open, recovery may fail. | 🟡 Moderate. Hourly checkpointing reduces but does not eliminate this. A crash at 12:59 UTC (just before 13:00 checkpoint) could lose up to 59 minutes of writes. |
| **Disk full during write** | SQLite extends file with sparse pages; if disk fills mid-extension, the DB header can be left in an inconsistent state. | 🟠 **HIGH**. This is the owner's actual worry. If backups fill the disk, the production DBs crash. Feedback loop: backup writes → disk fills → production write fails → corruption. |
| **Filesystem corruption** | ext4 / xfs rare but possible. RAID not present on small VPS. | 🟡 Moderate. No mitigation except off-site backup. |
| **Bad migration script** | An `ALTER TABLE` or `DROP TABLE` that mis-handles foreign keys. | 🟠 **HIGH historically**. We have `production-migrate.py` + 14+ `migrate-*.{ts,py,sh}` scripts. HELI-CLEANUP-2 already corrupted 308 rows by setting TARGET_HITs wrongly — recovered only because backups existed. |
| **OS / SQLite version mismatch** | SQLite library upgrade while WAL file from old version is mid-checkpoint. | 🟢 Low. We pin via `requirements.txt` and run `sqlite3` from system package. |
| **NFS / network filesystem** | SQLite explicitly warns: "do not place SQLite DB on NFS." | 🟢 None — our VPS uses local ext4. |

#### 11.1.3 Risk ranking per DB

| DB | Size | Write frequency | Criticality | Corruption risk | Impact if lost |
|---|---|---|---|---|---|
| **`intraday.db`** | 427 MB | every 5 min during market (10:00-14:00 Cairo) | 🟠 MEDIUM (re-aggregatable from `price_history.db` via `intraday_aggregator.py`) | 🔴 **HIGHEST** | Rebuild from price_history.db — 1-2 hours of CPU. Tolerable. |
| **`predictions.db`** | 224 MB | 5 writes/day from `daily_predictor.py` + 5 writes/day from `intraday_scanner.py` + 1 write/day from `daily_closer.py` + ad-hoc from `learning_engine.py` | 🔴 **CRITICAL** (1,359 predictions + 8,544 outcome_logs + 946 persona_predictions + 8,644 learned_lessons — irreplaceable backtest history) | 🟠 HIGH | Permanent loss of historical accuracy data. Backtest engine breaks. Win-rate KPIs irreproducible. Owner's #1 worry. |
| **`data_engine.db`** | 272 MB | every 5 min from `tradingview_scraper.py` + hourly from `multi_market_scraper.py` + daily from `egx_fundamental_fetcher.py` | 🟡 MEDIUM (re-scrapeable) | 🟠 HIGH (3 concurrent writers) | 2-4 hours to re-scrape all tab_* + gold + crypto + exchange_rates. Tolerable but annoying. |
| **`price_history.db`** | 293 MB | 2x/day from `daily_price_updater.py` + daily from `us_stock_scraper.py` + Yahoo fallback | 🔴 **CRITICAL** (1,206,795 rows — 25-year price history. Cannot be re-scraped for old data.) | 🟡 MODERATE (low write frequency, mostly appends) | Permanent loss of pre-2024 prices. `load_merged_history()` returns nothing. **Rule 12 violated.** Engine produces 0 results. |
| **`stocks.db`** | 14 MB | 1 write/day from `egx_fundamental_fetcher.py` + occasional from `update_stocks_from_csv.py` | 🟡 MEDIUM (1,046 tickers + radar tracking + system_settings) | 🟢 LOW | Easily reconstructable from `data/all.zip` archive (per Constitution §13). |
| **`auth.db`** | 208 KB | NextAuth sessions + Prisma migrations + admin actions | 🔴 **CRITICAL** (206 users + their sessions + subscriptions + watchlists + portfolio) | 🟢 LOW (single writer: NextAuth via Prisma) | All users logged out. Subscription state lost. Watchlists gone. **Bad UX but not catastrophic** if restored within hours. |

#### 11.1.4 What happens if `predictions.db` corrupts? (worst-case walkthrough)

**Scenario:** at 12:45 UTC on a trading day, `intraday_scanner.py` is mid-INSERT when the VPS OOM-killer terminates it (low RAM scenario). The WAL is left in a half-applied state. On next open, `PRAGMA integrity_check` returns `"database disk image is malformed"`.

**Current mitigation:** `smart_db_backup.py` at 01:30 UTC next day will:
1. Run `wal_checkpoint(TRUNCATE)` — **may fail** on corrupt DB.
2. Run `PRAGMA integrity_check` — returns non-`ok`.
3. Trigger auto-restore from the last good backup (the one from 01:30 UTC the day before the corruption happened).

**Data lost:** everything between the last successful backup (01:30 UTC yesterday) and the corruption moment (12:45 UTC today) = **~11 hours of writes** = that day's intraday signals + that day's post-market closes (the `daily_closer.py` 14:00 UTC run never happened) + the morning `daily_predictor.py` 03:00 UTC run if the corruption happened before it.

**Estimated RPO (Recovery Point Objective) with current setup:** **up to 24 hours.**
**Estimated RTO (Recovery Time Objective):** ~5 minutes (auto-restore is fast) + ~30 minutes for engineer to verify restore worked + restart PM2 = **~35 minutes**.

**Verdict:** acceptable for `stocks.db` / `data_engine.db` (re-scrapeable). **Unacceptable** for `predictions.db` (loses 1 day of prediction history + 1 day of outcome_logs feeding the learning engine = permanent gap in backtest data).

#### 11.1.5 RPO / RTO targets the owner should pick

| Tier | DBs | RPO target | RTO target | Reasoning |
|---|---|---|---|---|
| **Tier-1 (crown jewels)** | predictions.db, price_history.db, auth.db | ≤ 15 minutes | ≤ 1 hour | Cannot be re-scraped/reconstructed. User trust = subscription revenue. |
| **Tier-2 (re-aggregatable)** | data_engine.db, intraday.db | ≤ 4 hours | ≤ 4 hours | Tolerable to lose a half-day of scrapes; rebuildable. |
| **Tier-3 (reconstructable)** | stocks.db | ≤ 24 hours | ≤ 1 day | Reconstruction from `data/all.zip` per Constitution §13. |

These targets are the **input** that drives §11.2 backup strategy and §11.3 / §11.4 technology choice. Today we meet Tier-3 only. Tier-1 / Tier-2 require either Litestream (§11.2.5) or PostgreSQL PITR (§11.3 / §11.6).

### §11.2 — Backup Strategy (fix the "consuming all disk" problem)

#### 11.2.1 The actual disk math (today)

```
stocks.db          14.21 MB
data_engine.db    272.46 MB
predictions.db    224.34 MB
price_history.db  292.91 MB
auth.db            0.20 MB
intraday.db       427.47 MB
                  ─────────
                  1.23 GB  ← one full backup generation
```

Current rotation in `smart_db_backup.py`: **`KEEP_BACKUPS = 7`** = 7 daily generations per DB.

```
1.23 GB × 7 = 8.61 GB   ← 7-day rotation, UNCOMPRESSED, raw .db files
```

Plus lingering `.bak-unify` + `.bak-heli-*` from past migrations: **~1.2 GB**.
Plus hourly WAL files pre-checkpoint (transient, max ~5-10 MB per DB): ~30 MB.

**Total disk consumed by DB+backup today: ~10 GB on the same VPS as production.**

#### 11.2.2 Why it feels like "all server space"

Two reasons:

1. **No compression.** A SQLite `.db` file compresses ~60-70% with gzip because pages are mostly empty space (SQLite pre-allocates 4 KB pages). 1.23 GB raw → ~430 MB gzipped. **~7 GB saved immediately** without changing the rotation policy at all.

2. **All backups on the same disk.** If the VPS disk is 40 GB and 10 GB is backups, that's 25% gone before any log, build artifact, or `node_modules` growth. The owner's complaint isn't the rotation count — it's the absolute disk share.

#### 11.2.3 Recommended new rotation (7-4-12-1 Grandfather-Father-Son)

| Generation | Frequency | Count | Compressed size each | Total |
|---|---|---|---|---|
| **Daily** | 02:00 UTC daily | 7 | ~62 MB | ~430 MB |
| **Weekly** | Sunday 02:30 UTC | 4 | ~430 MB | ~1.7 GB |
| **Monthly** | 1st of month 02:30 UTC | 12 | ~430 MB | ~5.2 GB |
| **Annual (cold)** | 1st of January 03:00 UTC | kept 5 years | ~430 MB | ~2.2 GB |

**Total local retention:** ~9.5 GB. Compared to today's 8.6 GB (7 daily only), we get **7× more recovery points for only ~10% more disk** — because the monthly/annual tiers compress the same data we already had.

#### 11.2.4 Off-site upload (the actual fix for "all server space")

Move all backups **off the VPS** to a cheap object store. Options ranked by price-per-GB-month (October 2026 public pricing, US-East region):

| Provider | Plan | $/GB-month | Cost for 10 GB | Notes |
|---|---|---|---|---|
| **Backblaze B2** | pay-as-you-go | **$0.006** | **$0.06/mo** | S3-compatible API, free egress up to 3× stored, no minimum retention |
| **Cloudflare R2** | pay-as-you-go | $0.015 | $0.15/mo | S3-compatible, **zero egress fees** (best if we restore often) |
| **Wasabi** | pay-as-you-go | $0.0099 | $0.10/mo | 90-day minimum retention — fine for monthly/annual tiers |
| AWS S3 Glacier Instant | archive | $0.004 | $0.04/mo | retrieval takes 1-5 min; **egress costs $0.09/GB** on restore — cheap to store, painful to restore |
| AWS S3 Standard | pay-as-you-go | $0.023 | $0.23/mo | cheapest managed option, expensive egress |
| Google Cloud Storage Nearline | 30-day min | $0.010 | $0.10/mo | OK for monthly tier |
| Dropbox / OneDrive | 2 TB plan | ~$0.005 effective | $10/mo flat | overkill; no S3 API |

**Recommendation:** **Backblaze B2 for everything.** $0.006/GB × 10 GB = **$0.06/month**. Free egress up to 3× stored volume per day = restore the full DB set up to 3×/day for free. S3-compatible API → drop-in `b2sdk` or `aws s3 cp` with custom endpoint.

#### 11.2.5 Continuous backup via Litestream (the SQLite-native answer)

Litestream ([litestream.io](https://litestream.io)) is a tool that streams the SQLite WAL to object storage (S3/B2/Azure/GCS) **continuously** — every commit is replicated within ~1 second. It's a daemon that runs alongside the SQLite process.

**Why it matters here:**
- RPO drops from "24 hours" to **"1 second"** for DBs we put on Litestream.
- Disk usage on the VPS drops to **zero** for backups — all replicas live in B2.
- No schema rewrite, no migration. Litestream talks to the SQLite file directly.
- Restore = `litestream restore -o db/predictions.db` from the latest replica.

**Cost for our 6 DBs on B2:**
- ~1.2 GB per replica × 1 (Litestream keeps only the latest state + WAL history)
- Storage cost: ~$0.007/month for the data
- WAL churn: assume ~10 MB new WAL per day across all DBs. After compaction: ~300 MB/month of historical WAL = $0.002/mo.
- **Total Litestream-on-B2 cost: ~$0.01/month.**

**Trade-offs:**
- Adds a daemon (`litestream replicate`) per DB. Manageable via PM2 ecosystem entry.
- WAL retention is configurable; if we keep 30 days, that's PITR for 30 days.
- Litestream is **single-writer only** — if a second process opens the DB in write mode, Litestream aborts. We already satisfy this (Python = brain, Node = read-only via proxy), but it's a constraint to enforce.

**Recommendation:** put **`predictions.db`, `price_history.db`, `auth.db`** on Litestream → B2 (the Tier-1 crown jewels). The other 3 (data_engine, intraday, stocks) stay on the existing `smart_db_backup.py` since they're rebuildable.

#### 11.2.6 Backup verification (the part most teams forget)

A backup that has never been restored is not a backup — it's a hope.

**Schedule:**
- **Daily:** `PRAGMA integrity_check` on each backup file (already done in `smart_db_backup.py`).
- **Weekly:** pick one random daily backup, restore to `/tmp/restore-test/`, run `python3 vps-service/tools/diagnose_db_structure.py` against it, verify row counts match the production DBs within 0.1%. Tear down.
- **Monthly:** full DR drill (§11.10) — restore all 6 DBs to a clean sandbox, boot the Next.js app pointed at the restored DBs, smoke-test 5 critical endpoints (`/api/health`, `/api/predictions/daily-picks`, `/api/maker-radar`, `/api/auth/session`, `/api/chart/COMI`).

**Time budget:** 2-3 hours/month of an engineer's time. Worth it.

#### 11.2.7 What to delete today (after Rule 1 verification)

These are the lingering `.bak-*` files consuming ~1.2 GB that serve no forward-going purpose:

```
db/stocks.db.bak-unify              14.2 MB   (P0-8-DB-UNIFY 2026-09-25)
db/predictions.db.bak-unify        224.3 MB   (P0-8-DB-UNIFY 2026-09-25)
db/auth.db.bak-unify                 0.2 MB   (P0-8-DB-UNIFY 2026-09-25)
db/data_engine.db.bak-unify        272.5 MB   (P0-8-DB-UNIFY 2026-09-25)
db/predictions.db.bak-heli-fix     235   MB   (HELI-CLEANUP-2 2026-09-27)
db/predictions.db.bak-full-cleanup 235   MB   (HELI-CLEANUP-2 2026-09-27)
db/predictions.db.bak-heli-expired 235   MB   (HELI-CLEANUP-2 2026-09-27)
                                  ──────
                                  1.22 GB
```

**Action:** upload them to B2 cold storage (one-time, ~$0.007/mo to retain), then `rm` from the VPS. This single action reclaims ~1.2 GB — about the same as the production DBs themselves.

**Note:** deletion requires owner approval (Rule 1 + Rule 16 VERIFY-BEFORE-DELETE). This document proposes; owner disposes.

#### 11.2.8 Fix `scripts/auto-backup.sh` phantom reference

`scripts/setup-backup-cron.sh` (line 21) installs a cron that calls `scripts/auto-backup.sh` — **a file that does not exist** (verified via `ls`). If any engineer follows the README in that script, daily backups silently never run.

**Fix options:**
1. **Delete `scripts/setup-backup-cron.sh`** and update its README to point at `crontab.txt` entry #10 (the real, working schedule).
2. **Create `scripts/auto-backup.sh`** as a wrapper that just calls `python3 vps-service/scripts/smart_db_backup.py` — keeps the old install path working.

Option 1 is cleaner (Rule 63 — fewer files, not more). Option 2 is safer (backward-compatible). Owner's call.

#### 11.2.9 Wrap-up: §11.2 budget summary

| Change | Disk saved on VPS | Monthly cost | Engineering time |
|---|---|---|---|
| Gzip all backups | ~6 GB | $0 | 2 hours (modify `smart_db_backup.py`) |
| Upload to B2 + delete local copies | ~9 GB | $0.06 | 4 hours (b2sdk integration) |
| Clean `.bak-unify` + `.bak-heli-*` | ~1.2 GB | $0.007 (B2 cold) | 1 hour |
| Add Litestream for Tier-1 DBs | 0 (Litestream is additive) | $0.01 | 6 hours (per-DB config + PM2 entry) |
| 7-4-12-1 rotation (vs current 7-only) | -0.9 GB (more retention, less disk via compression) | $0 (same B2 bucket) | 3 hours |
| Monthly DR drill | 0 | $0 | 3 hours/month recurring |
| **Total** | **~17 GB freed on VPS** | **~$0.08/month** | **~16 hours one-time + 3 hours/month recurring** |

### §11.3 — SQLite → PostgreSQL Migration (the "real DB" option)

#### 11.3.1 When does SQLite stop being enough?

Trigger conditions (any one):

| Trigger | Threshold | Why |
|---|---|---|
| **Concurrent writers > 1** | > 1 process doing writes simultaneously | SQLite serializes writes; second writer gets `SQLITE_BUSY` and retries. PostgreSQL MVCC handles this natively. |
| **Single DB size > 10 GB** | > 10 GB | SQLite's `VACUUM` becomes slow (minutes); backup-by-copy becomes painful. PostgreSQL has tablespaces, partitioning, parallel VACUUM. |
| **Write throughput > 100 writes/sec sustained** | > 100 w/s sustained | SQLite's WAL append hits fsync bottlenecks. PostgreSQL group-commit amortizes fsync. |
| **Need for PITR < 1 hour** | RPO < 60 min | SQLite has no WAL archiving. PostgreSQL has continuous WAL archiving → recovery to any point in time. |
| **Need for read replicas** | > 1000 concurrent readers | SQLite read replicas require Litestream + manual failover. PostgreSQL streaming replication is automatic. |
| **Multi-region / geographic redundancy** | yes | SQLite + Litestream can do this but it's bolt-on. PostgreSQL native. |
| **Complex joins across DBs** | yes | We currently `ATTACH DATABASE` for joins across our 6 SQLite files — fragile and slow. PostgreSQL schemas solve this elegantly. |

**Where we are today (2026-10-02):**
- Largest DB: `intraday.db` 427 MB — **35× under the 10 GB threshold**.
- Concurrent writers: 2-3 on `data_engine.db` during market hours — **at the edge but manageable with WAL + busy_timeout** (proven working for 2+ months).
- Write throughput: peak ~5 writes/sec on `intraday.db` during market — **20× under the threshold**.
- Cross-DB joins: yes (we have `ATTACH DATABASE` in `load_merged_history` and `db_manager`) — **this is a real pain point**, not a hypothetical.

**Verdict:** we are **NOT yet** at the trigger conditions for the largest DBs. The closest trigger is **cross-DB joins** (a developer-experience pain, not a capacity pain) and **PITR < 1 hour** (a disaster-recovery pain, addressed by Litestream more cheaply than PostgreSQL).

#### 11.3.2 PostgreSQL benefits

- **MVCC** — readers never block writers, writers never block readers. Solves our `SQLITE_BUSY` worries on `data_engine.db`.
- **Streaming replication** — built-in primary/replica with sub-second lag.
- **PITR via WAL archiving** — restore to any second in time.
- **Partitioning** — `price_history` table can be partitioned by year (`PARTITION BY RANGE (date)`) → 25-year history becomes 25 small partitions.
- **Connection pooling** (PgBouncer) — survives 1000+ concurrent requests.
- **Managed services** (Supabase / Neon / Railway / RDS) handle ops: automated backups, autoscaling, point-in-time recovery, monitoring.

#### 11.3.3 Migration cost (honest estimate)

| Phase | Effort | Risk |
|---|---|---|
| Schema rewrite (SQLite → Postgres types) | 2-3 days | 🟡 LOW — most types map 1:1 |
| Data migration script (pgloader or custom) | 2-3 days | 🟡 MEDIUM — pgloader handles 80%, the other 20% is per-table custom logic |
| Rewrite Python DB layer (`core/db_manager.py`, `core/database.py`, `core/persona_db.py`, `core/crypto_database.py`) | 5-7 days | 🔴 HIGH — central, ~3,000 LOC |
| Rewrite Prisma schema | 1-2 days | 🟡 LOW — Prisma supports Postgres natively |
| Migrate `load_merged_history()` (Rule 12) | 1 day | 🔴 HIGH — most-touched code in the engine, 50+ call sites |
| Update cron jobs | 1 day | 🟢 LOW — mostly path changes |
| Migrate `scripts/smart_db_backup.py` → `pg_dump` | 1 day | 🟢 LOW |
| Re-test everything | 3-5 days | 🔴 HIGH — backtest results MUST match within 0.01% (Rule 14) |
| **Total** | **~3-4 weeks of focused engineering** | One person, no parallel work |

#### 11.3.4 Managed PostgreSQL pricing (October 2026 public pricing)

| Provider | Plan | RAM | Storage | $/month | Best for |
|---|---|---|---|---|---|
| **Supabase Free** | 1 project | 500 MB | 500 MB | $0 | prototyping only — too small for our 1.2 GB |
| **Supabase Pro** | 1 project | 8 GB | 8 GB | $25 | small production — fits our DBs with room to grow |
| **Supabase Team** | 1 project | 8 GB | 8 GB + daily backups + PITR 7 days | $99 | if we need PITR + SOC2 compliance |
| **Neon Free** | 1 project | 0.25 CU autoscale | 3 GB | $0 | dev — autoscale to zero is nice |
| **Neon Launch** | 1 project | 2 CU fixed | 10 GB | $19 | small production |
| **Neon Scale** | 1 project | 7 CU fixed | 20 GB + PITR 7 days | $69 | medium production with PITR |
| **Railway Pro** | 1 instance | 8 GB | 10 GB | $20 + usage | simple, generous disk |
| **AWS RDS db.t4g.micro** | 1 instance | 1 GB | 20 GB | ~$14 + storage | cheapest managed, but you manage PITR yourself |
| **AWS RDS db.t4g.small** | 1 instance | 2 GB | 20 GB | ~$28 + storage | small production with PITR via automated backups |
| **DigitalOcean Managed Postgres** | 1 db | 1 GB | 10 GB | $15 | simple pricing, no egress fees |
| **Self-hosted Postgres on VPS** | DIY | same VPS RAM | same VPS disk | $0 software, +VPS upgrade ~$10 | cheapest but you manage ops |

**Recommendation IF migrating:** **Neon Launch ($19/month)** or **Supabase Pro ($25/month)** — both include automated backups, both support PITR, both have generous free tiers for dev, and both support branch-based dev workflows.

#### 11.3.5 Hybrid model (most pragmatic)

Keep SQLite for what it does well; move only the painful DBs.

| DB | Recommendation | Reason |
|---|---|---|
| `stocks.db` (14 MB, 1 write/day) | **Keep SQLite** | Tiny, read-heavy, no concurrency issue |
| `data_engine.db` (272 MB, 3 concurrent writers) | **Move to PostgreSQL** | The actual concurrency pain point |
| `predictions.db` (224 MB, 5 writes/day, Tier-1) | **Move to PostgreSQL** | Tier-1 crown jewel — needs PITR |
| `price_history.db` (293 MB, 2 writes/day, Tier-1) | **Keep SQLite + Litestream** | Append-only, read-heavy, partitioning can wait |
| `auth.db` (208 KB, single Prisma writer, Tier-1) | **Move to PostgreSQL** | Users/sessions/subscriptions — needs PITR, scales with users |
| `intraday.db` (427 MB, 5-min writes during market) | **Move to PostgreSQL** | Highest write throughput, time-series nature fits Postgres partitioning |

Hybrid gives us 4 DBs on Postgres (~$25/month on Supabase Pro or Neon Scale) and 2 on SQLite + Litestream (~$0.01/month on B2). Total ~$25/month.

#### 11.3.6 Trigger condition — when to actually migrate

```
MIGRATE WHEN any of these becomes true:
  1. intraday.db size > 2 GB   (currently 427 MB — ~5× growth → ~10 months at current rate)
  2. data_engine.db writes fail with SQLITE_BUSY > 5×/day for 7 consecutive days
  3. We need PITR < 15 minutes for compliance / customer promise
  4. We onboard > 500 paying users (auth.db will start hitting write contention
     on subscription state changes)
  5. Cross-DB joins across our 6 SQLite files become a measurable dev-velocity
     bottleneck (heuristic: if we add more than 2 ATTACH DATABASE calls per quarter)
```

**Today (2026-10-02):** none triggered. Stay on SQLite + Litestream + B2.

### §11.4 — SQLite → Turso / libSQL (modern SQLite fork)

#### 11.4.1 What is Turso / libSQL

- **libSQL** is an open-source fork of SQLite maintained by Turso, ChiselStrike, and the community. Adds: native replication, async APIs, embedded compute (run SQL inside the DB via WASM), vector search.
- **Turso** ([turso.tech](https://turso.tech)) is the managed service for libSQL: hosted primary + replicas in 30+ regions, automatic backups, branching for dev.

#### 11.4.2 Why it matters for us

- **Zero schema rewrite.** libSQL IS SQLite. Our existing `CREATE TABLE`, `INSERT`, `PRAGMA table_info`, `load_merged_history()` — all work unchanged.
- **Native replication.** Turso's "embedded replicas" mode: writes go to the primary in the cloud, reads come from the local replica file → fast + durable.
- **Branching for dev.** `turso db branch prod main-test` creates a copy of production for testing migrations.
- **Generous free tier.** 500 databases, 9 GB total, 1 billion row reads/month. Our entire 1.2 GB fits.

#### 11.4.3 Migration effort

```python
# Before (SQLite)
import sqlite3
conn = sqlite3.connect('db/predictions.db')

# After (libSQL)
import libsql
conn = libsql.connect('libsql://predictions-glminvestment.turso.io',
                       auth_token=os.environ['TURSO_TOKEN'])
```

That's it. The rest of the code is unchanged. **Total migration effort: ~1 day per DB**.

#### 11.4.4 Turso pricing (October 2026)

| Plan | Databases | Storage | Row reads/month | Row writes/month | $/month |
|---|---|---|---|---|---|
| Free | 500 | 9 GB total | 1 billion | 25 million | $0 |
| Scaler | 500 | 9 GB (additional $0.75/GB) | 25 billion | 50 million | $29 |
| Enterprise | custom | custom | custom | custom | contact |

**Cost for us:** Free tier covers all 6 DBs (1.2 GB total) easily. Our current write volume estimate: ~10,000 writes/day = 300,000/month — **83× under the free-tier cap**.

#### 11.4.5 Trade-offs

| Pro | Con |
|---|---|
| Zero schema rewrite | Adds a network hop for writes (~50ms latency per write) |
| Free tier covers us | Embedded replicas need a Turso client library |
| Branching for dev is great | "Embedded replica" feature requires libSQL (not vanilla SQLite). Tools that read the DB file directly (`sqlite3` CLI, better-sqlite3 from Node, Prisma for auth.db) won't work with embedded replicas |
| Backups automatic | Turso doesn't yet support PITR (only snapshot backups every 24h) — same RPO as our current SQLite setup unless we add Litestream alongside |
| 30+ edge regions | Vendor lock-in — Turso is a small company. libSQL itself is open-source (we can self-host), but Turso's control plane is closed. |

#### 11.4.6 Recommendation

Turso is the **lowest-effort path** to "modern DB with replication + managed backups". Recommended for the owner who wants resilience without rewriting the DB layer.

**Specific recommendation:**
- Move **`auth.db`** to Turso free tier first — smallest DB, lowest risk, tests the workflow.
- If that works for 30 days without issues, move **`predictions.db`** (Tier-1 crown jewel).
- Keep **`price_history.db`** on local SQLite + Litestream (largest, Turso's 9 GB free-tier limit would be a stretch if all 6 DBs grow).

### §11.5 — Database Sharding / Partitioning (when DBs grow)

#### 11.5.1 When to consider

Currently not needed. Triggers:
- `price_history.db` > 5 GB (currently 293 MB) — partition by year.
- `intraday.db` > 5 GB (currently 427 MB) — partition by month.
- `predictions.db` > 1 GB (currently 224 MB) — partition by year of prediction date.

At current growth rate (1-2 MB/day on `intraday.db` + `price_history.db`), we hit 5 GB in **~5-10 years**.

#### 11.5.2 If we needed it today

- **SQLite:** partition by creating separate files (`price_history_2024.db`, `price_history_2025.db`) and using `ATTACH DATABASE` + `UNION ALL` views. Works but fragile.
- **PostgreSQL:** native `PARTITION BY RANGE (date)` — much cleaner.

#### 11.5.3 Per-DB future plan

| DB | Today | At 5 GB | At 10 GB |
|---|---|---|---|
| `stocks.db` | 14 MB | keep as-is | keep as-is (always small) |
| `data_engine.db` | 272 MB | keep as-is | move `crypto_prices` to separate `crypto_history.db` |
| `predictions.db` | 224 MB | partition by year | move to Postgres partitioning |
| `price_history.db` | 293 MB | partition by year | move to Postgres partitioning |
| `auth.db` | 208 KB | keep as-is | keep as-is (always small) |
| `intraday.db` | 427 MB | partition by month (only keep last 90 days hot) | archive > 1 year to cold storage |

### §11.6 — Point-in-Time Recovery (PITR)

#### 11.6.1 Why PITR matters

Without PITR, "restore" means "roll back to last backup" — losing all writes between backup and now. With PITR, "restore" means "roll back to any second in time" — e.g., "restore to 2 hours ago, just before that bad migration corrupted 308 rows."

The HELI-CLEANUP-2 incident (2026-09-27) is exactly the case PITR solves: 308 rows were wrongly set to `TARGET_HIT` by a buggy script, and we recovered only because we had `.bak-heli-fix` snapshots taken manually before the run. With PITR, we'd just `pg_restore --target-time '2026-09-27 14:30:00'`.

#### 11.6.2 SQLite PITR options

| Approach | RPO | Cost | Effort | Recommendation |
|---|---|---|---|---|
| Periodic snapshots (current) | up to 24h | $0 | $0 | what we have — insufficient for Tier-1 |
| **Litestream continuous WAL streaming** | 1 sec | $0.01/mo B2 | 6h per DB | **recommended for Tier-1** |
| WAL archiving via custom script (copy `-wal` file every minute to B2) | 1 min | $0.005/mo | 8h, fragile | not worth it when Litestream exists |
| rqlite (distributed SQLite via Raft) | 0 (sync) | higher complexity | 2-3 days per DB | overkill — rqlite sacrifices some SQLite compatibility |

#### 11.6.3 PostgreSQL PITR options

- **WAL archiving to S3/B2** — built-in via `archive_command` setting. RPO = 1 WAL segment (~16 MB by default = a few minutes of writes).
- **Continuous WAL streaming to replica** — sub-second RPO via `pg_receivewal`.
- **Managed service PITR** — Supabase offers 7-day PITR on Team plan ($99/mo). Neon offers 7-day PITR on Scale plan ($69/mo).

#### 11.6.4 Recommendation

For **Tier-1** DBs (predictions, price_history, auth):
- Stay on SQLite + **Litestream → B2** (RPO ~1 sec, $0.01/mo, 6h engineering).
- This gets us PITR for 30 days (configurable) for **~$0.01/month**.

If we later move to PostgreSQL, Litestream is replaced by native WAL archiving (RPO ~1 min, included in Supabase/Neon plans).

### §11.7 — High Availability (HA)

#### 11.7.1 Current state

**Single VPS = single point of failure.** If the Hetzner/OVH/whatever box dies (hardware failure, datacenter fire, billing lapsed), all 6 DBs are gone unless off-site backup exists. RTO with current setup: **4-8 hours**.

This is **the biggest unaddressed risk** in the project.

#### 11.7.2 HA options per DB tier

| Tier | DBs | HA strategy | RTO | Cost |
|---|---|---|---|---|
| Tier-1 (crown jewels) | predictions, price_history, auth | Litestream → B2 + secondary VPS ready to spin up + restore script | 1 hour | $5/month secondary VPS + $0.01 B2 |
| Tier-2 (re-aggregatable) | data_engine, intraday | Weekly full B2 backup; restore from scraper is acceptable | 4 hours | $0.06 B2 |
| Tier-3 (reconstructable) | stocks | Restore from `data/all.zip` in git | 1 day | $0 |

#### 11.7.3 PostgreSQL HA options

- **Managed (Supabase/Neon/RDS):** HA built-in. Provider handles failover. RTO ~1 minute for replica promotion. Costs included in plan.
- **Self-hosted with Patroni:** Patroni + etcd + HAProxy. RTO ~30 seconds. Effort: 2-3 weeks of senior-devops time. Overkill for our scale.

#### 11.7.4 Recommendation

For SQLite path: Litestream + B2 + a $5/month secondary VPS kept warm (running `litestream restore` periodically as a drill). Total: $5.01/month. This is the cheapest meaningful HA we can get.

For PostgreSQL path: Supabase Pro ($25/month) includes managed HA — no extra cost, no extra effort.

### §11.8 — Data Retention Policy

#### 11.8.1 Current state (no formal policy)

We keep everything forever. `price_history.db` has prices from 2000 → 2026 (25 years). `predictions.db` has predictions from 2026-01-01 → 2026-09-25. No archival, no deletion, no policy.

#### 11.8.2 Recommended retention per DB

| DB | Table | Hot retention | Cold retention (S3 Glacier) | Reasoning |
|---|---|---|---|---|
| `price_history.db` | `price_history` | 5 years rolling (2021-2026) | forever (Glacier, ~$0.004/GB) | Backtest needs 5 years of data. Pre-2021 is "nice to have" for regime analysis but rarely queried. |
| `predictions.db` | `predictions` | forever (hot) | n/a | Only 1,359 rows — tiny. Keep all for backtest reproducibility. |
| `predictions.db` | `outcome_logs` | 2 years rolling | forever (Glacier) | 8,544 rows. Older logs feed learning engine rarely. |
| `predictions.db` | `learned_lessons` | 2 years rolling | forever (Glacier) | 8,644 rows. Same logic. |
| `intraday.db` | all tables | 90 days rolling | 1 year in Glacier | High-volume. After 90 days, only daily-aggregated data in `price_history.db` matters. |
| `data_engine.db` | `crypto_prices`, `gold_prices`, `silver_prices`, `exchange_rates` | 1 year rolling | forever (Glacier) | Tick data — 1 year covers all seasonal analyses. |
| `data_engine.db` | `tab_*` (fundamentals) | forever (hot) | n/a | Only ~860 rows per table. Tiny. |
| `stocks.db` | all tables | forever (hot) | n/a | Only ~1,046 tickers. Tiny. |
| `auth.db` | `Session` | 30 days rolling (delete expired) | n/a | NextAuth standard. Sessions beyond 30 days are useless. |
| `auth.db` | `analytics_events` | 90 days rolling | 1 year (Glacier) | Privacy/compliance — keep 90 days hot for product analytics, then archive. |
| `auth.db` | `User`, `UserSubscription`, `PortfolioItem` | forever (hot) | n/a | User data — required for legal/tax reasons in most jurisdictions. |

#### 11.8.3 Cold storage cost

Estimated cold-archive size: ~500 MB. AWS S3 Glacier Instant Retrieval: $0.004/GB/mo × 0.5 GB = **$0.002/month**. Negligible.

#### 11.8.4 Implementation note

Archival should be a new cron job: `vps-service/scripts/archive_old_data.py`, runs weekly, moves rows older than the hot-retention threshold into Parquet files in B2 Glacier, then `DELETE FROM ... WHERE date < ...` on the hot DB.

**Rule 1 caveat:** this script writes to prod DBs — needs owner approval and Rule 16 VERIFY-BEFORE-DELETE compliance (dry-run mode that prints counts before deleting).

### §11.9 — Monitoring + Alerting

#### 11.9.1 Current state

- `vps-service/scripts/data_heartbeat_checker.py` runs daily at 01:00 UTC (crontab entry #9) — checks DB freshness.
- `/api/health` endpoint checks DB file existence + SELECT 1 + PM2 ports + disk space.
- Sentry for errors.
- Structured JSON logger (`src/lib/logger.ts`).
- `smart_db_backup.py` writes `last_run_report.json` with backup status.

#### 11.9.2 Gaps

- **No alerting on backup failure.** If `smart_db_backup.py` exits with code 2 (failure), nothing emails or Telegrams the owner.
- **No disk-space alert.** If disk fills to 90%, `/api/health` returns `degraded` but no proactive alert.
- **No corruption-detection alert.** `smart_db_backup.py` runs `PRAGMA integrity_check` but only at backup time. If corruption happens at 02:00, it's not detected until 01:30 UTC next day.

#### 11.9.3 Recommended additions

| Monitor | Frequency | Alert channel | Tool |
|---|---|---|---|
| Disk usage ≥ 70% | hourly check | Telegram + email | cron + `df` + Telegram bot |
| Disk usage ≥ 85% | hourly | Telegram + email + SMS | same |
| Disk usage ≥ 95% | hourly | Telegram + email + auto-kill non-essential PM2 processes | same + `pm2 stop news-agent` |
| `PRAGMA integrity_check` per DB | every 6 hours (4×/day, up from 1×) | Telegram on failure | extend `wal_checkpoint.py` |
| Backup job failure (`smart_db_backup.py` exit ≠ 0) | on each run | Telegram | wrap cron entry with `&& curl -d "OK" ... \|\| curl -d "FAIL" ...` |
| Slow query (> 5 seconds) | continuous | log only | Python `sqlite3.set_trace_callback` or Postgres `pg_stat_statements` |
| Litestream replication lag > 60 sec | continuous | Telegram | Litestream has built-in metrics endpoint |
| B2 backup upload failure | on each upload | Telegram | wrap `b2sdk` calls in try/except + Telegram alert |
| DB file size change > 50% in 24 hours | daily | Telegram | simple `du` diff |

#### 11.9.4 Cost

All alerts via the existing Telegram bot (already configured for radar alerts per `vps-service/telegram/`). $0 additional infrastructure cost. Engineering: ~4 hours to wire up the alerting endpoints.

### §11.10 — Disaster Recovery Plan + Runbook

#### 11.10.1 Recovery objectives (formalized)

- **RPO (Recovery Point Objective):** Tier-1 DBs ≤ 15 min (Litestream), Tier-2 ≤ 4 hours, Tier-3 ≤ 24 hours.
- **RTO (Recovery Time Objective):** Tier-1 ≤ 1 hour, Tier-2 ≤ 4 hours, Tier-3 ≤ 1 day.

#### 11.10.2 Runbook: prod VPS dies completely

```bash
# ─── STEP 0: Provision new VPS ──────────────────────────────────
ssh root@new-vps

# ─── STEP 1: Install dependencies ────────────────────────────────
apt update && apt install -y git python3 python3-venv nodejs npm sqlite3
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git ~/GLMinvestment
cd ~/GLMinvestment

# ─── STEP 2: Restore code from git ──────────────────────────────
git log --oneline -5  # verify latest commit hash

# ─── STEP 3: Restore DBs from B2 (latest Litestream replica) ────
curl -fsSL https://litestream.io/install.sh | bash

litestream restore -o db/predictions.db   s3://glminvestment-backups/predictions.db
litestream restore -o db/price_history.db s3://glminvestment-backups/price_history.db
litestream restore -o db/auth.db          s3://glminvestment-backups/auth.db

b2 authorize-account <B2_KEY_ID> <B2_KEY>
b2 download_file_by_name glminvestment-backups smart/latest/data_engine.db db/data_engine.db
b2 download_file_by_name glminvestment-backups smart/latest/intraday.db    db/intraday.db

unzip data/all.zip -d db/  # Tier-3 (stocks)

# ─── STEP 4: Verify integrity ────────────────────────────────────
for db in db/*.db; do
  echo "=== $db ==="
  sqlite3 "$db" "PRAGMA integrity_check;"
  sqlite3 "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
done

# ─── STEP 5: Run production migration (idempotent) ──────────────
python3 scripts/production-migrate.py

# ─── STEP 6: Configure .env ──────────────────────────────────────
# Copy .env from secrets manager / encrypted backup

# ─── STEP 7: Start PM2 ───────────────────────────────────────────
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# ─── STEP 8: Update DNS / Caddy to point at new VPS ──────────────
# (out of scope — owner via Caddyfile + DNS provider)

# ─── STEP 9: Verify via /api/health ──────────────────────────────
curl http://localhost:3000/api/health
# Expected: status: "ok" or "degraded"

# ─── STEP 10: Notify owner via Telegram ──────────────────────────
python3 -c "from telegram.telegram_notifier import send_alert; send_alert('VPS recovery complete — all systems nominal')"
```

**Total estimated time:** 30 minutes if backups are clean + 30 minutes for DNS propagation = ~1 hour RTO. Matches Tier-1 target.

#### 11.10.3 Runbook: single DB corruption (no full VPS loss)

```bash
# ─── STEP 0: Identify the corrupt DB ─────────────────────────────
# /api/health will return degraded + which DB failed integrity_check

# ─── STEP 1: Stop the affected PM2 process (NOT all PM2) ────────
pm2 stop python-backend  # or whichever writes to the corrupt DB

# ─── STEP 2: Restore from Litestream (Tier-1) or smart_db_backup (Tier-2/3) ────
litestream restore -o db/predictions.db s3://glminvestment-backups/predictions.db
# OR
cp db/backups/smart/predictions.<latest-timestamp>.db db/predictions.db

# ─── STEP 3: Run production-migrate to apply any pending migrations ────
python3 scripts/production-migrate.py

# ─── STEP 4: Restart PM2 ─────────────────────────────────────────
pm2 restart python-backend

# ─── STEP 5: Verify ──────────────────────────────────────────────
curl http://localhost:3000/api/health
```

**Total time:** ~5 minutes. Matches Tier-1 RTO.

#### 11.10.4 Who has access to backups?

- **B2 credentials:** stored in `.env` as `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY`. Owner (`enmohsen20111975`) holds the master B2 account credentials offline.
- **GitHub repo (code + `data/all.zip`):** owner is admin on the GitHub org.
- **VPS root SSH key:** owner + 1 trusted engineer.
- **Telegram alert bot:** owner is the only subscriber to the alert channel.

### §11.11 — Cost-Benefit Analysis

#### 11.11.1 Option comparison

| Option | Effort | $/month | RPO (Tier-1) | RTO (Tier-1) | Maint burden |
|---|---|---|---|---|---|
| **A: Status quo (smart_db_backup only)** | $0 | $0 | 24h | 1h | low |
| **B: SQLite + gzip + B2 + Litestream** | 16h | $0.07 | 1 sec | 1h | low |
| **C: Turso (libSQL) for Tier-1 DBs** | 6h/DB × 3 = 18h | $0 (free tier) | 1 sec | 30 min | low (managed) |
| **D: Hybrid (SQLite for read-heavy, PostgreSQL for write-heavy)** | 3-4 weeks | $25-69 | 1 min | 15 min | medium |
| **E: Full PostgreSQL migration** | 3-4 weeks | $25-99 | 1 min | 15 min | medium-high |
| **F: Self-hosted PostgreSQL on same VPS** | 3-4 weeks + ongoing ops | $0 + VPS upgrade ($10) | 1 min | 1h | high (you own ops) |

#### 11.11.2 Recommendation matrix

| Owner priority | Best option | Why |
|---|---|---|
| "Lowest cost, biggest win" | **B** (SQLite + gzip + B2 + Litestream) | $0.07/month, 16h engineering, fixes the disk problem AND the corruption-recovery problem |
| "Set and forget, modern stack" | **C** (Turso) | $0/month on free tier, 18h engineering, gets managed backups + replication + branching for free |
| "We're going to scale to 10,000+ users" | **D** (Hybrid) | $25-69/month, 3-4 weeks engineering, future-proofs write-heavy DBs |
| "Maximum simplicity, we own the data" | **F** (Self-hosted PG) | $10/month VPS upgrade, 3-4 weeks, no vendor lock-in but high ops burden |

### §11.12 — Ranked Recommendations (top 3)

#### 🥇 Recommendation 1: Adopt Litestream + gzip + B2 (Option B)

**Why ranked #1:** Smallest engineering investment for the biggest immediate win. Addresses BOTH of the owner's stated worries:

- "DB corruption problems" → Litestream gives 1-second RPO, far better than current 24-hour.
- "Backups consuming all server disk" → gzip saves ~70% disk + B2 moves everything off the VPS.

**Cost:** $0.07/month + 16 hours engineering.
**Trigger condition to start:** none — applicable today.
**Estimated payback:** immediate (frees ~17 GB on VPS, reduces RPO by 86,400×).

#### 🥈 Recommendation 2: Pilot Turso for `auth.db` (Option C, partial)

**Why ranked #2:** Lowest-risk way to test "is SQLite-native modernization worth it." Auth.db is the smallest (208 KB) and has the cleanest Prisma schema — if Turso's libSQL driver works cleanly with Prisma + our cron jobs for 30 days, we have evidence to either roll forward to predictions.db or roll back with minimal loss.

**Cost:** $0/month + 6 hours engineering.
**Trigger condition to start:** after Recommendation 1 is in production for 30 days (so we have a clean baseline).
**Estimated payback:** proves/disproves the modernization thesis before committing to Recommendation 3.

#### 🥉 Recommendation 3: Define formal trigger conditions for PostgreSQL migration

**Why ranked #3:** Don't migrate today — we're 5-35× under every trigger threshold. But document the triggers (§11.3.6) and review quarterly. When a trigger fires, the migration decision is data-driven, not vibes-driven.

**Cost:** $0/month + 2 hours documentation.
**Trigger condition to start:** none — pure policy.
**Estimated payback:** avoids a $25-99/month commitment we don't yet need.

### §11.13 — Decision Matrix for Owner

| Question | If YES → | If NO → |
|---|---|---|
| Is the VPS disk ≥ 80% full right now? | Approve Recommendation 1 immediately (gzip + B2 cleanup = 17 GB freed in 16h) | Schedule Recommendation 1 for next sprint |
| Are you comfortable with $0.07/month ongoing cost? | Approve Recommendation 1 | Stay on smart_db_backup.py (status quo) |
| Have we hit any PostgreSQL migration trigger (§11.3.6)? | Approve Recommendation 3 (start migration) | Approve Recommendation 3 (document triggers, defer migration) |
| Are you OK with a 30-day Turso pilot on auth.db? | Approve Recommendation 2 | Defer Turso until Recommendation 1 is stable |
| Do we have an off-site copy of `.env` (B2 + Telegram bot tokens)? | Approve runbook (§11.10) | Owner action: copy `.env` to offline storage (printed + password manager) — non-negotiable prerequisite |

### §11.14 — What this document does NOT do

- Does **not** touch any production DB (Rule 1).
- Does **not** run any migration script.
- Does **not** modify `smart_db_backup.py` or any cron entry.
- Does **not** install Litestream, Turso, PostgreSQL, or any new dependency.
- Does **not** create any new screen or system file (Rule 63.2 — this is documentation, permitted).
- Does **not** commit the owner to any of the recommendations. Owner reviews, owner decides, owner issues a follow-up task.

### §11.15 — References (verified 2026-10-02)

- `00-CONSTITUTION.md` — Rule 1 (never touch prod DBs), Rule 6 (schema-aware), Rule 12 (`load_merged_history()` sole source), Rule 16 (VERIFY-BEFORE-DELETE), Rule 58 (observability), Rule 61 (relative paths), Rule 62 (git-push-discipline), Rule 63 (no new screens/files).
- `01-ARCHITECTURE_AND_API.md` — §3 DB architecture, §3.7 statistics for `predictions.db`, §3.1 DB map, §6 data flow.
- `vps-service/scripts/smart_db_backup.py` — current backup mechanism (read in full — verified rotation, integrity_check, auto-restore logic).
- `vps-service/jobs/wal_checkpoint.py` — hourly WAL checkpoint job (read in full — verified targets = stocks + predictions + price_history + data_engine).
- `scripts/production-migrate.py` — idempotent migration script (read in full).
- `scripts/setup-backup-cron.sh` — broken cron installer (auto-backup.sh missing).
- `crontab.txt` — actual production cron (entry #10 calls smart_db_backup.py).
- External references: [litestream.io](https://litestream.io), [turso.tech](https://turso.tech), [backblaze.com/b2](https://backblaze.com/b2), [supabase.com/pricing](https://supabase.com/pricing), [neon.tech/pricing](https://neon.tech/pricing).

---

## 12. Production Data Engine Fix Runbook

> **المصدر:** `PROD-DATA-FIX-RUNBOOK.md` (مُدمج من `01-PROJECT_ANATOMY.md` §appendix).
> **التاريخ:** 2026-10-03
> **لمن:** المبرمج المساعد على الـ production server
> **من:** المدير العام (Z.ai)
> **الهدف:** إصلاح كارثة البيانات + منع تكرارها
> **المرجعية:** الدستور Rule 12 + 20 + 24 + 63 + §14 Data Engine Architecture

### 12.1 قبل ما تبدأ

#### القواعد الإلزامية (من الدستور):
- **Rule 1**: ممنوع الكتابة المباشرة في prod DBs إلا عبر scripts محددة
- **Rule 12**: `load_merged_history()` هو المصدر الوحيد للأسعار
- **Rule 20**: Python = العقل، Node = العرض
- **Rule 24**: ممنوع بيانات وهمية — لو مش موجود، اكتب NULL
- **Rule 63**: كل commit = push فوري

#### الـ scripts اللي لازم تستخدمها (موجودة في الكود):
```
vps-service/data/validation.py          — Data Validation Layer
vps-service/data/source_authority.py    — Canonical Source Guard
vps-service/data/source_priority_cleaner.py — تنظيف المصادر المتعددة
```

### 12.2 المرحلة 1: التشخيص (Diagnose)

شغّل الأوامر دي على الـ prod وسجّل النتائج:

#### 12.2.1 فحص الـ pipeline timestamps

```bash
cd /root/GLMinvestment

# Check latest timestamps in ALL DBs
python3 << 'EOF'
import sqlite3

checks = [
    ('db/stocks.db', 'stocks', 'last_update'),
    ('db/stocks.db', 'stock_daily_prices', 'fetch_time'),
    ('db/price_history.db', 'price_history', 'created_at'),
    ('db/data_engine.db', 'crypto_prices', 'timestamp'),
    ('db/data_engine.db', 'gold_prices', 'timestamp'),
    ('db/intraday.db', 'stock_intraday', 'timestamp'),
]

print("=== Pipeline Freshness Check ===")
for db, table, col in checks:
    try:
        conn = sqlite3.connect(db)
        row = conn.execute(f'SELECT MAX({col}) FROM {table}').fetchone()
        print(f"  {db}.{table}: latest = {row[0] if row else 'NULL'}")
        conn.close()
    except Exception as e:
        print(f"  {db}.{table}: ERROR {e}")
EOF
```

**النتيجة المتوقعة:** لو أي table آخر تاريخ < اليوم → الـ cron وقف.

#### 12.2.2 فحص الـ PM2 processes

```bash
pm2 list
```

**تحقق:** هل كل الـ processes `online`؟
- `python-backend` (port 8010)
- `data-engine`
- `nextjs`
- `ws-service` (port 3005)
- `telegram-events` (port 3003)
- `news-agent`
- `telegram-interactive-bot`
- `telegram-poster`

#### 12.2.3 فحص الـ crontab

```bash
crontab -l | grep -v "^#"
```

**تحقق:** هل فيه cron jobs لـ:
- `daily_price_updater.py`
- `tradingview_scraper.py`
- `price_history_safetynet.py`
- `egksco_scraper.py`
- `us_stock_scraper.py`
- `multi_market_scraper.py`

#### 12.2.4 فحص الـ multi-source problem

```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/price_history.db')

# Count tickers with multiple sources
multi = conn.execute("""
    SELECT COUNT(*) FROM (
        SELECT ticker FROM price_history
        GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
    )
""").fetchone()[0]
print(f"Tickers with MULTIPLE sources: {multi}")

# Show sources
sources = conn.execute("""
    SELECT source, COUNT(*) as cnt, COUNT(DISTINCT ticker) as tickers,
           MAX(date) as latest
    FROM price_history GROUP BY source ORDER BY cnt DESC
""").fetchall()
print("\nSources:")
for s in sources:
    print(f"  {s[0]}: {s[1]:,} rows, {s[2]} tickers, latest={s[3]}")

# CRST specifically
print("\nCRST sources:")
for r in conn.execute("""
    SELECT source, COUNT(*), MIN(close_price), MAX(close_price), MAX(date)
    FROM price_history WHERE ticker='CRST' GROUP BY source
""").fetchall():
    print(f"  {r[0]}: {r[1]} rows, price {r[2]:.3f}-{r[3]:.3f}, latest={r[4]}")

conn.close()
EOF
```

#### 12.2.5 فحص الـ close column NULL

```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
total = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
null_close = conn.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0").fetchone()[0]
print(f"Total stocks: {total}")
print(f"close IS NULL or 0: {null_close} ({null_close*100//total}%)")
print(f"close > 0: {total - null_close} ({(total-null_close)*100//total}%)")
conn.close()
EOF
```

#### 12.2.6 مقارنة الأسعار بالواقع (الـ QA Battalion test)

```bash
python3 << 'EOF'
import sqlite3, requests

conn = sqlite3.connect('db/stocks.db')

# Test 5 EGX stocks
test_tickers = ['COMI', 'HRHO', 'SWDY', 'ETEL', 'TMGH']
print("=== EGX Price Accuracy Test ===")
for ticker in test_tickers:
    db_price = conn.execute(
        "SELECT current_price FROM stocks WHERE ticker = ?", (ticker,)
    ).fetchone()
    if db_price and db_price[0]:
        try:
            r = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.CA",
                timeout=5
            )
            if r.status_code == 200:
                real_price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                diff_pct = abs(db_price[0] - real_price) / real_price * 100
                status = "✅ OK" if diff_pct < 2 else "❌ INVALID"
                print(f"  {ticker}: DB={db_price[0]:.2f} vs Real={real_price:.2f} → {diff_pct:.1f}% {status}")
            else:
                print(f"  {ticker}: DB={db_price[0]:.2f} — Yahoo returned {r.status_code}")
        except Exception as e:
            print(f"  {ticker}: DB={db_price[0]:.2f} — Error: {e}")
    else:
        print(f"  {ticker}: DB price is NULL")

conn.close()
EOF
```

**سجّل كل النتائج** — هتحتاجها للمرحلة التالية.

### 12.3 المرحلة 2: الإصلاح (Fix)

#### 12.3.1 إعادة تشغيل الـ pipeline (P0-1: السبب الجذري)

```bash
cd /root/GLMinvestment

# 1. Pull latest code
git pull origin main

# 2. Restart PM2 processes
pm2 reload ecosystem.config.js --update-env

# 3. Verify all processes online
pm2 list

# 4. Restart crontab
crontab crontab.txt

# 5. Verify cron jobs
crontab -l | grep -c "python3"  # should be > 15

# 6. Manually trigger the fetchers to test
python3 vps-service/scripts/daily_price_updater.py 2>&1 | tail -20
python3 data_engine/scrapers/tradingview_scraper.py 2>&1 | tail -10
```

#### 12.3.2 تنظيف المصادر المتعددة (P0: source unification)

```bash
cd /root/GLMinvestment

# DRY RUN first — see what will be deleted
python3 vps-service/data/source_priority_cleaner.py

# If looks correct → LIVE cleanup (creates backup automatically)
python3 vps-service/data/source_priority_cleaner.py --live

# Verify
python3 -c "
import sqlite3
conn = sqlite3.connect('db/price_history.db')
multi = conn.execute('SELECT COUNT(*) FROM (SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1)').fetchone()[0]
print(f'Multi-source tickers: {multi} (should be 0)')
conn.close()
"
```

#### 12.3.3 إصلاح close column NULL (P0-2)

```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')

# Fix: populate close from current_price
updated = conn.execute("""
    UPDATE stocks SET close = current_price
    WHERE (close IS NULL OR close = 0) AND current_price > 0
""").rowcount
conn.commit()

# Verify
still_null = conn.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0").fetchone()[0]
print(f"Fixed {updated} stocks. Remaining NULL: {still_null}")
conn.close()
EOF
```

#### 12.3.4 اختبار الـ validation layer

```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sys; sys.path.insert(0, 'vps-service')
from data.validation import validate_stock_data, summarize_validation
from data.source_authority import get_canonical_source, get_market_for_ticker

# Test CRST (the bug stock)
vd = validate_stock_data(
    ticker='CRST',
    current_price=3.02,
    high_52w=1.95,
    low_52w=0.99,
    support=158.73,
    resistance=137.97,
)
print("=== CRST Validation ===")
print(summarize_validation(vd))
print(f"is_valid_overall: {vd.is_valid_overall}")

# Test a normal stock
vd2 = validate_stock_data(
    ticker='COMI',
    current_price=127.69,
    high_52w=145.0,
    low_52w=95.0,
    support=120.0,
    resistance=140.0,
)
print("\n=== COMI Validation ===")
print(f"is_valid_overall: {vd2.is_valid_overall}")

# Test source authority
print("\n=== Source Authority ===")
for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD']:
    print(f"  {market}: canonical = {get_canonical_source(market)}")
EOF
```

#### 12.3.5 اختبار شامل بعد الإصلاح

```bash
# Re-run the price accuracy test (from 12.2.6)
# All prices should now be within 2% of real prices
python3 << 'EOF'
import sqlite3, requests

conn = sqlite3.connect('db/stocks.db')
test_tickers = ['COMI', 'HRHO', 'SWDY', 'ETEL', 'TMGH']
print("=== POST-FIX Price Accuracy Test ===")
all_ok = True
for ticker in test_tickers:
    db_price = conn.execute("SELECT current_price FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
    if db_price and db_price[0]:
        try:
            r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.CA", timeout=5)
            if r.status_code == 200:
                real_price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                diff_pct = abs(db_price[0] - real_price) / real_price * 100
                status = "✅" if diff_pct < 2 else "❌"
                if diff_pct >= 2:
                    all_ok = False
                print(f"  {status} {ticker}: DB={db_price[0]:.2f} vs Real={real_price:.2f} → {diff_pct:.1f}%")
        except Exception as e:
            print(f"  ⚠️ {ticker}: {e}")
conn.close()
print(f"\nOverall: {'✅ ALL OK' if all_ok else '❌ STILL HAS ISSUES'}")
EOF
```

### 12.4 المرحلة 3: التحقق النهائي (Verify)

#### 12.4.1 Checklist

```bash
echo "=== FINAL VERIFICATION CHECKLIST ==="

# 1. Pipeline running?
LATEST=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/stocks.db'); print(conn.execute('SELECT MAX(last_update) FROM stocks').fetchone()[0])")
echo "1. Latest stocks update: $LATEST"

# 2. Multi-source cleaned?
MULTI=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/price_history.db'); print(conn.execute('SELECT COUNT(*) FROM (SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1)').fetchone()[0])")
echo "2. Multi-source tickers: $MULTI (should be 0)"

# 3. close column fixed?
NULL_CLOSE=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/stocks.db'); print(conn.execute('SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0').fetchone()[0])")
echo "3. close NULL/0: $NULL_CLOSE (should be 0)"

# 4. PM2 processes?
PM2_COUNT=$(pm2 list | grep -c "online")
echo "4. PM2 online processes: $PM2_COUNT (should be 8)"

# 5. Cron jobs?
CRON_COUNT=$(crontab -l | grep -c "python3")
echo "5. Cron jobs: $CRON_COUNT (should be > 15)"

echo ""
echo "=== ALL CHECKS COMPLETE ==="
```

#### 12.4.2 مراقبة بعد 24 ساعة

بعد 24 ساعة من الإصلاح، شغّل:

```bash
# Check if fresh data is flowing
python3 << 'EOF'
import sqlite3
from datetime import datetime

conn = sqlite3.connect('db/stocks.db')
latest = conn.execute("SELECT MAX(last_update) FROM stocks").fetchone()[0]
if latest:
    dt = datetime.fromisoformat(latest)
    age_hours = (datetime.now() - dt).total_seconds() / 3600
    if age_hours < 24:
        print(f"✅ Data is fresh (age: {age_hours:.1f}h)")
    else:
        print(f"❌ Data is STALE (age: {age_hours:.1f}h) — pipeline may have stopped again")
conn.close()
EOF
```

### 12.5 ماذا لو فشل شيء؟

#### لو الـ pipeline وقف تاني بعد الإصلاح:

1. شوف الـ logs:
```bash
tail -100 /tmp/price_updater_morning.log
tail -100 /tmp/tradingview.log
pm2 logs python-backend --lines 50
```

2. شوف أخطاء الـ cron:
```bash
grep -i "error\|traceback\|failed" /tmp/*.log | tail -30
```

3. لو فيه خطأ في `source_authority.py`:
```bash
python3 -c "
import sys; sys.path.insert(0, 'vps-service')
from data.source_authority import write_guarded, get_market_for_ticker
print('source_authority imported OK')
print('EGX canonical:', get_canonical_source('EGX'))
"
```

#### لو الـ validation.py crashed:

```bash
python3 -c "
import sys; sys.path.insert(0, 'vps-service')
from data.validation import validate_stock_data
vd = validate_stock_data('TEST', current_price=100, high_52w=120, low_52w=80)
print('validation OK, valid:', vd.is_valid_overall)
"
```

### 12.6 ملخص للمبرمج المساعد

#### المشكلة:
1. **الـ pipeline كله وقف** — كل الـ DBs آخر تاريخ = 2026-09-05
2. **930 سهم عندهم مصادر متعددة** بأسعار مختلفة
3. **close column = NULL** لـ 99% من الأسهم
4. **الأسعار غلط** — 0/7 طابقت الواقع

#### الحل (نفّذ بالترتيب):
1. **`git pull origin main`** — أحدّث الكود
2. **`pm2 reload ecosystem.config.js --update-env`** — إعادة تشغيل
3. **`crontab crontab.txt`** — إعادة تشغيل الـ cron
4. **`python3 vps-service/data/source_priority_cleaner.py --live`** — تنظيف المصادر
5. **إصلاح close column** (السكربت في 12.3.3)
6. **اختبار الأسعار** (السكربت في 12.3.5)

#### الملفات اللي أنشأتها (موجودة في الكود بعد `git pull`):
- `vps-service/data/validation.py` — Data Validation Layer
- `vps-service/data/source_authority.py` — Canonical Source Guard
- `vps-service/data/source_priority_cleaner.py` — Multi-source cleaner
- §14 Data Engine Architecture — الـ architecture الكامل

#### بعد الإصلاح:
- كل سهم ليه **مصدر واحد بس** (canonical)
- الـ validation layer بيـ catch أي بيانات غلط
- الـ source guard بيمنع الكتابة المتعددة
- **نفس التنظيم لازم يتعمل على باقي السيرفرات** (زي ما المالك أمر)

---

## 13. Ticker/Symbol Unification Plan

> **المصدر:** `TICKER-SYMBOL-UNIFICATION-PLAN.md` (مُدمج من `01-PROJECT_ANATOMY.md` §appendix).
> **التاريخ:** 2026-10-03
> **المرجعية:** الدستور Rule 12 + 20 + 24 + 63 + 66
> **الهدف:** "تخلى كل المصادر تكتب الأسماء والرموز صح ويكون فية توحيد ليهم"

### 13.1 المشكلة المكتشفة (التحقيق الجنائي)

#### 13.1.1 تلوث الرموز بالأسماء في `price_history.db`
```
ACAPA Capital HoldingD    ← الاسم العربي اتلصق بالـ ticker!
ACFRAlexandria Company... ← نفس المشكلة
ACTFAct FinancialD       ← نفس المشكلة
```
**السبب:** أحد الـ scrapers بياخد الـ ticker + name مع بعض ويكتبهم في عمود واحد.

#### 13.1.2 `name_ar` فيه أسماء إنجليزية (stocks.db)
```
HRHO: name_ar = "EFG Holding S.A.E."  ← ده إنجليزي مش عربي!
KORA: name_ar = "KORRA"                ← الاسم العربي هو نفس الرمز!
VLMR: name_ar = "Valmore Holding"      ← إنجليزي!
```

#### 13.1.3 `market` فيه قيم عربية في data_engine.db
```
data_engine.db.stocks: market = 'مصر'  ← عربي
stocks.db.stocks:      market = 'EGX'   ← إنجليزي
```
**النتيجة:** JOIN بين الـ DBs بيفشل لأن `market` مختلف.

#### 13.1.4 رموز مختلفة لنفس الشركة

| المصدر | الرمز | الاسم الحقيقي |
|---|---|---|
| stocks.db | HRHO | EFG Holding S.A.E. |
| المصدر الشرعي | EFG | name_ar=None |
| **الحقيقة** | **HRHO** هي الرمز الرسمي في EGX | مجموعة إي اف جي القابضة |

| المصدر | الرمز | الاسم الحقيقي |
|---|---|---|
| stocks.db | KORA | KORRA |
| data_engine.db | KORA | KORAKORRAD ← ملوث! |
| المصدر الشرعي | KORRA | شركة كورا للاستثمار |

#### 13.1.5 80 سهم في stocks.db مش موجودين في data_engine.db
```
PIOH, BLDG, 9413, AOTM, PACL, 4328, GMCC, ORTE, OCIC, 9409 ...
```
**السبب:** data_engine.db أحدث (1585 سهم) لكن stocks.db قديم (956 سهم).

#### 13.1.6 أسماء عربية ملوثة بالأسماء الإنجليزية
```
data_engine.db: KORA → name = "KORAKORRAD"  ← الرمز اتكرر + D في الآخر!
price_history.db: AIDC → "AIDCArabia for Investment..."  ← ticker+name مدموجين!
```

### 13.2 الحل (Ticker/Symbol Canonical Registry)

#### المبدأ
**ننشئ جدول `ticker_registry` واحد في `stocks.db`** — هو المرجع الوحيد لربط الرموز. ✅ **منفّذ فعلًا في Wave 8 (Task 28-C — commit `774a208`) عبر `scripts/unify_tickers_and_names.py`.**

#### الـ Schema
```sql
CREATE TABLE IF NOT EXISTS ticker_registry (
    canonical_ticker TEXT PRIMARY KEY,     -- الرمز الرسمي (HRHO, KORA, COMI)
    egx_ticker TEXT,                       -- الرمز في EGX (لو مختلف)
    sharia_symbol TEXT,                    -- الرمز في المصدر الشرعي
    yahoo_symbol TEXT,                     -- الرمز في Yahoo Finance
    tradingview_symbol TEXT,               -- الرمز في TradingView
    name_en TEXT,                          -- الاسم الإنجليزي
    name_ar TEXT,                          -- الاسم العربي
    market TEXT,                           -- EGX / TADAWUL / KSE / QSE / US / CRYPTO / GOLD
    sector TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    updated_at TEXT
);
```

#### كيف يعمل:
1. كل scraper قبل ما يكتب → يـ lookup في `ticker_registry`
2. لو الـ ticker مش موجود → يرفض الكتابة (مش بيعمل جديد عشوائي)
3. لو موجود → يستخدم `canonical_ticker` في الكتابة
4. لو فيه mapping مختلف (EFG → HRHO) → البيانات تتكتب تحت HRHO

#### الـ Mappings المعروفة (Collision Guard):
```python
TICKER_MAPPINGS = {
    # المصدر الشرعي → الرمز الرسمي
    'EFG': 'HRHO',       # EFG Holding → HRHO (الرمز الرسمي في EGX)
    'KORRA': 'KORA',     # KORRA = KORA (نفس الشركة، رمز مختلف في المصدر)
    'LBCT': 'IBCT',     # International Business Corp = IBCT

    # أسماء ملوثة → الرمز الصحيح
    'ACAPA Capital HoldingD': 'ACAP',
    'ACFRAlexandria Company For RefractoriesD': 'ACFR',
    'ACTFAct FinancialD': 'ACTF',
    'AIDCArabia for Investment and Development': 'AIDC',

    # Yahoo suffixes
    'COMI.CA': 'COMI',
    'HRHO.CA': 'HRHO',
    '2222.SR': '2222',  # Aramco
}

# شركتين مختلفتين — ممنوع الدمج:
SEPARATE_COMPANIES = {
    'VLMR': 'Valmore Holding',
    'VLMRA': 'Valmore Holding (different class)',  # شركة مختلفة!
}
```

### 13.3 الـ Instructions للمبرمجين على الـ prod

#### Step 1: إنشاء `ticker_registry` في stocks.db
```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
conn.execute("""
    CREATE TABLE IF NOT EXISTS ticker_registry (
        canonical_ticker TEXT PRIMARY KEY,
        egx_ticker TEXT,
        sharia_symbol TEXT,
        yahoo_symbol TEXT,
        tradingview_symbol TEXT,
        name_en TEXT,
        name_ar TEXT,
        market TEXT,
        sector TEXT,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        updated_at TEXT
    )
""")
# Populate from stocks.db.stocks (canonical source)
conn.execute("""
    INSERT OR REPLACE INTO ticker_registry
    (canonical_ticker, name_en, name_ar, market, sector, updated_at)
    SELECT ticker, name, name_ar, market, sector, datetime('now')
    FROM stocks WHERE market = 'EGX'
""")
# Add known mappings
mappings = [
    ('HRHO', 'HRHO', 'EFG', 'HRHO.CA', 'HRHO', 'EFG Holding S.A.E.', 'مجموعة إي اف جي القابضة', 'EGX'),
    ('KORA', 'KORA', 'KORRA', 'KORA.CA', 'KORA', 'KORRA', 'شركة كورا للاستثمار', 'EGX'),
    ('IBCT', 'IBCT', 'LBCT', 'IBCT.CA', 'IBCT', 'International Business Corp.', 'انترناشيونال بزنيس كوربوريشن', 'EGX'),
]
for m in mappings:
    conn.execute("""
        UPDATE ticker_registry SET
        egx_ticker=?, sharia_symbol=?, yahoo_symbol=?, tradingview_symbol=?,
        name_en=?, name_ar=?
        WHERE canonical_ticker=?
    """, (m[1], m[2], m[3], m[4], m[5], m[6], m[0]))
conn.commit()
count = conn.execute("SELECT COUNT(*) FROM ticker_registry").fetchone()[0]
print(f"✅ ticker_registry created with {count} entries")
conn.close()
EOF
```

#### Step 2: تنظيف الأسماء الملوثة في price_history.db
```bash
python3 << 'EOF'
import sqlite3, re
conn = sqlite3.connect('db/price_history.db')

# Find tickers with Arabic/name contamination
bad = conn.execute("""
    SELECT DISTINCT ticker FROM price_history
    WHERE LENGTH(ticker) > 6 OR ticker LIKE '% %' OR ticker GLOB '*[A-Z][a-z]*[A-Z]*'
""").fetchall()
print(f"Contaminated tickers found: {len(bad)}")

for (bad_ticker,) in bad:
    # Extract the real ticker (first all-caps part)
    match = re.match(r'^([A-Z]{2,6})', bad_ticker)
    if match:
        clean = match.group(1)
        sconn = sqlite3.connect('db/stocks.db')
        exists = sconn.execute("SELECT 1 FROM stocks WHERE ticker = ?", (clean,)).fetchone()
        sconn.close()
        if exists:
            updated = conn.execute(
                "UPDATE price_history SET ticker = ? WHERE ticker = ?",
                (clean, bad_ticker)
            ).rowcount
            conn.commit()
            print(f"  {bad_ticker} → {clean}: {updated} rows fixed")
        else:
            print(f"  {bad_ticker} → {clean}: SKIP (not in stocks.db)")
    else:
        print(f"  {bad_ticker}: cannot extract clean ticker")
conn.close()
EOF
```

#### Step 3: توحيد `market` في data_engine.db
```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/data_engine.db')
market_map = {
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
    'أمريكا': 'US',
}
for ar, en in market_map.items():
    updated = conn.execute("UPDATE stocks SET market = ? WHERE market = ?", (en, ar)).rowcount
    if updated:
        print(f"  market '{ar}' → '{en}': {updated} rows")
conn.commit()
conn.close()
EOF
```

#### Step 4: تنظيف `name_ar` في stocks.db (أسماء إنجليزية → عربية)
```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
import re
arabic_re = re.compile(r'[\u0600-\u06FF]')
rows = conn.execute("SELECT ticker, name, name_ar FROM stocks WHERE market = 'EGX'").fetchall()
english_name_ar = 0
for ticker, name, name_ar in rows:
    if name_ar and not arabic_re.search(name_ar):
        english_name_ar += 1
print(f"Stocks with English in name_ar: {english_name_ar}/{len(rows)}")
print("(Needs manual Arabic name import from EGX official list)")
conn.close()
EOF
```

#### Step 5: إضافة `ticker_registry` lookup في كل scrapers
```bash
# Every scraper should do:
# 1. Before writing: lookup canonical_ticker from ticker_registry
# 2. If not found: SKIP (don't create random ticker)
# 3. If found: write with canonical_ticker
```

### 13.4 ملخص المشكلة + الحل

| المشكلة | العدد | الحل |
|---|---|---|
| tickers ملوثة بالأسماء في price_history | ~10 | تنظيف: استخراج الرمز الصحيح |
| name_ar = English (مش عربي) | ~200+ | استيراد أسماء عربية من EGX |
| market = عربي في data_engine | ~1000 | UPDATE → English |
| 80 سهم مش موجودين في data_engine | 80 | sync من stocks.db |
| رموز مختلفة لنفس الشركة (EFG↔HRHO) | ~5 | ticker_registry mapping |
| شركتين مختلفتين بنفس الاسم (VLMR≠VLMRA) | 2 | SEPARATE_COMPANIES guard |

### 13.5 ضمانات عدم التكرار

1. **ticker_registry** — جدول واحد مرجعي لكل الرموز ✅
2. **كل scraper يـ lookup قبل الكتابة** — ممنوع إنشاء ticker جديد بدون تسجيل
3. **Collision guard** — شركتين مختلفتين لا يدمجان
4. **market values موحدة** — إنجليزي في كل الـ DBs

---

## 14. Data Engine Architecture

> **المصدر:** `DATA-ENGINE-ARCHITECTURE.md` (مُدمج من `01-PROJECT_ANATOMY.md` §appendix).
> **التاريخ:** 2026-10-03
> **المرجعية:** الدستور Rule 12 + Rule 20 + Rule 24 + Rule 63
> **الهدف:** "البيانات النهائية تكون واحدة بس مش كذا مكان" + منع تكرار الكارثة

### 14.1 الإجابة على أسئلة المالك

#### السؤال 1: أي قاعدة بيانات وأي جدول؟

**في 4 قواعد بيانات فيهم بيانات أسعار — وده المشكلة:**

| # | DB | الجدول | الصفوف | المشكلة |
|---|---|---|---|---|
| 1 | `price_history.db` | `price_history` | 1,090,044 | **8 مصادر بيكتبوا فيه!** |
| 2 | `stocks.db` | `stock_daily_prices` | 47,534 | تاريخ يومي تاني (مختلف) |
| 3 | `stocks.db` | `stocks` | 956 | بيانات لحظية + high_52w + support + resistance |
| 4 | `data_engine.db` | `historical_data` | 99,076 | تاريخ يومي تالت |
| 5 | `data_engine.db` | `egksco_price_history` | 0 | فاضي |
| 6 | `intraday.db` | `stock_intraday` | 1,105,352 | بيانات لحظية |

**الخلاصة:** مفيش مصدر واحد — فيه **6 أماكن** بتخزن أسعار!

#### السؤال 2: سبب التداخل

**كل scraper بيكتب في `price_history.db` من غير ما يشوف اللي قبله:**

| الـ Scraper | الـ source اللي بيكتبه |
|---|---|
| `daily_price_updater.py` | `egx_investment_migration` |
| `intraday_aggregator.py` | `intraday_aggregated` |
| `egksco_scraper.py` | `egksco` |
| `eodhd_fetcher.py` | `yahoo_clean` |
| `gap_filler.py` | `yfinance_backfill` |
| `price_history_safetynet.py` | `yahoo_safetynet` |
| TradingView live (frontend) | `tradingview_live` |
| egxpilot | `egxpilot_live` |

**مفيش source authority** — كل واحد بيكتب `INSERT OR REPLACE` على نفس الجدول بـ `source` مختلفة.

#### السؤال 3: هل ده في كل الأسواق؟

**6 أسواق متأثرة (مش 4):**

| السوق | عدد الأسهم | مكان التخزين | المصدر |
|---|---|---|---|
| EGX | 360 | stocks.db + price_history.db | egksco + yahoo + intraday |
| TADAWUL | 413 | stocks.db + price_history.db | yahoo_clean |
| KSE | 128 | stocks.db + price_history.db | yahoo_clean |
| QSE | 55 | stocks.db + price_history.db | yahoo_clean |
| US | (من Yahoo) | price_history.db | yahoo_clean |
| CRYPTO | BTC/ETH/SOL... | data_engine.db.crypto_prices (198K rows) | crypto_fetcher |
| GOLD | XAU | data_engine.db.gold_prices (163K rows) | gold_fetcher |

**المشكلة موجودة في كل الـ 6 أسواق** — مش EGX بس.

#### السؤال 4: هل البدائل متوافقة 100%؟

**لا — وده المشكلة الأساسية:**

| المصدر | نوع البيانات | التوافق |
|---|---|---|
| `yahoo_clean` | يومي (RAW unadjusted) | ✅ كامل |
| `egx_investment_migration` | يومي (legacy) | ⚠️ stale (آخر يونيو 2026) |
| `intraday_aggregated` | يومي (من intraday) | ⚠️ ممكن يختلف في الـ OHLC |
| `tradingview_live` | لحظي | ❌ ممكن يبقى صف واحد بس |
| `egksco` | لحظي | ❌ تغطية محدودة (30 سهم) |

**النتيجة:** نفس السهم ممكن يكون عنده 3 أسعار مختلفة لنفس اليوم من 3 مصادر.

#### السؤال 5: الحل النهائي الكامل

**المبدأ:** "البيانات النهائية تكون واحدة بس" — مصدر واحد canonical لكل سهم.

### 14.2 الـ Architecture الصحيح (الحل النهائي)

#### المرحلة 1: تحديد المصدر القانوني (Canonical Source)

**لكل سهم — مصدر واحد بس يكتب في `price_history.db`:**

| السوق | المصدر القانوني | الاحتياطي | السبب |
|---|---|---|---|
| **EGX** | `intraday_aggregated` | `egksco` → `yahoo_clean` | بيانات لحظية حقيقية من EGKSCO |
| **TADAWUL** | `yahoo_clean` | `egx_investment_migration` | تاريخ طويل + موثوق |
| **KSE** | `yahoo_clean` | — | تاريخ طويل + موثوق |
| **QSE** | `yahoo_clean` | — | تاريخ طويل + موثوق |
| **US** | `yahoo_clean` | — | Yahoo هو المصدر الموثوق للأسهم الأمريكية |
| **CRYPTO** | `tradingview_live` | `crypto_fetcher` | بيانات لحظية |
| **GOLD** | `yahoo_clean` | `gold_fetcher` | تاريخ طويل + موثوق |

**القاعدة:** لما مصدر يقع، المصدر الاحتياطي يكتب — **بس بنفس الـ source name** (مش اسم جديد).

#### المرحلة 2: توحيد مكان التخزين

**TABLE واحدة فقط للأسعار اليومية: `price_history.db.price_history`**

- ❌ يلغى `stocks.db.stock_daily_prices` (47K صف → يدمج في price_history)
- ❌ يلغى `data_engine.db.historical_data` (99K صف → يدمج في price_history)
- ❌ يلغى `data_engine.db.egksco_price_history` (فاضي أصلاً)
- ✅ `intraday.db.stock_intraday` يفضل للبيانات اللحظية (مش يومية)

#### المرحلة 3: ترتيب المصادر (Source Hierarchy)

```python
# Per market — مصدر رئيسي + احتياطي واحد بس
CANONICAL_SOURCES = {
    'EGX':     ['intraday_aggregated', 'egksco', 'yahoo_clean'],
    'TADAWUL': ['yahoo_clean', 'egx_investment_migration'],
    'KSE':     ['yahoo_clean'],
    'QSE':     ['yahoo_clean'],
    'US':      ['yahoo_clean'],
    'CRYPTO':  ['tradingview_live', 'crypto_fetcher'],
    'GOLD':    ['yahoo_clean', 'gold_fetcher'],
}

# القاعدة:
# 1. لو المصدر الرئيسي موجود + بياناته recent (< 7 أيام) → استخدمه
# 2. لو وقع → جرّب المصدر الاحتياطي
# 3. أي مصدر تالت → امسحه (ممنوع كتابته أصلاً)
```

#### المرحلة 4: منع الكتابة المتعددة

**كل scraper لازم يشيك قبل ما يكتب:**

```python
# في كل scraper قبل INSERT:
def write_price(ticker, date, ohlc, source):
    market = get_market_for_ticker(ticker)
    canonical = CANONICAL_SOURCES[market][0]
    if source != canonical:
        # هل المصدر القانوني متاح؟
        if is_source_available(canonical, ticker):
            # نعم — لا تكتب (الاحتياطي ممنوع)
            return
        # لا — المصدر القانوني وقع → اسمح للاحتياطي بالكتابة
        # بس بنفس اسم المصدر القانوني (مش اسمه هو)
        source = canonical  # اكتب باسم المصدر القانوني
    INSERT OR REPLACE INTO price_history (ticker, date, ..., source=canonical)
```

#### المرحلة 5: مقارنة بالأسعار الحقيقية

**Daily validation cron (يومي 03:00 صباحاً):**

```python
# 1. اختر 10 أسهم عشوائية من كل سوق
# 2. اسحب السعر الحقيقي من Yahoo Finance / TradingView
# 3. قارن بالسعر في price_history.db
# 4. لو الفرق > 5% → صُنف المصدر كـ "INVALID" + نفّذ إعادة الـ scraping
# 5. لو الفرق > 20% → ألغِ المصدر نهائياً
```

#### المرحلة 6: حذف المصادر الغلط

**لو مصدر بياناته غلط → يُمسح فوراً من محرك البيانات:**

```python
# إذا discovered إن source معين بياناته غلطة:
DELETE FROM price_history WHERE source = 'egxpilot_live'  # مثلاً
# + امسح الـ scraper نفسه من CANONICAL_SOURCES
# + سجّل الحادثة في BREACH-LOG.md
```

### 14.3 الحالة الحالية (before) vs الهدف (after)

| المقياس | الحالي | الهدف |
|---|---|---|
| **عدد DBs بأسعار** | 4 | **1** (`price_history.db`) |
| **عدد الجداول بأسعار يومية** | 4 | **1** (`price_history`) |
| **مصادر لكل سهم** | 1-8 (متضاربة) | **1** (canonical) |
| **كتابة متعددة** | كل scraper يكتب لحاله | **guarded** (canonical only) |
| **مقارنة بالواقع** | لا يوجد | **daily cron** |
| **حذف المصادر الغلط** | لا يوجد | **تلقائي** |

### 14.4 خطة التنفيذ (5 خطوات)

#### Step 1: دمج `stock_daily_prices` + `historical_data` → `price_history`
- انقل 47K + 99K صف لـ `price_history.db.price_history`
- استخدم `source='migration_consolidated'`
- بعد النقل: أفرغ الجداول القديمة (مش نحذفها — Rule 16)

#### Step 2: طبّق `CANONICAL_SOURCES` في كل scrapers
- عدّل كل scraper: قبل INSERT، شيك على `CANONICAL_SOURCES[market]`
- لو المصدر مش canonical → لا تكتب (إلا لو canonical وقع)

#### Step 3: شغّل `source_priority_cleaner.py --live` على prod
- نفس اللي اتعمل في sandbox
- يحذف المصادر غير الـ canonical

#### Step 4: فعّل daily validation cron
- `scripts/validate_prices_against_reality.py`
- يقارن 10 أسهم عشوائية بالأسعار الحقيقية
- لو فرق > 5% → alert + re-scrape

#### Step 5: فعّل `validation.py` في الـ pipeline
- قبل أي scoring: `validate_stock_data()`
- لو field INVALID → لا يستخدم في الـ score

### 14.5 ضمانات عدم تكرار المشكلة

1. **CANONICAL_SOURCES** — مصدر واحد لكل سوق (مش 8) ✅ (مُنفّذ في `source_authority.py`)
2. **Guarded writes** — كل scraper يشيك قبل الكتابة ✅ (مُنفّذ في `write_guarded()`)
3. **Daily validation** — مقارنة بالواقع يومياً ⏳ (مخطط — Step 4)
4. **Auto-deletion** — المصادر الغلط تُمسح تلقائياً ⏳ (مخطط — Step 6)
5. **Validation Layer** — قبل أي scoring ✅ (مُنفّذ في `validation.py`)

---

## 15. Deployment Runbook Round 3

> **المصدر:** `DEPLOY-ROUND3.md` (مُدمج كاملًا في هذا القسم).
> **Date:** 2026-10-13
> **Scope:** DEV-15 (rebuild DEV-08 from root — price-verified hit timestamps) + DEV-16 (recover 28 deleted legit predictions) + DEV-17 (this runbook).
> **Goal:** Eliminate the fake-hit-timestamp + fake-TARGET_HIT/STOPPED pollution left by DEV-02 / DEV-08, and restore the 28 V40.2-legit predictions that were deleted from production during the rogue-cleanup wave.

### 15.1 Pre-Deployment

1. **Backup both DBs** — mandatory before any round-3 migration step:

    ```bash
    cd /path/to/GLMinvestment/db
    cp predictions.db predictions.db.bak.round3
    cp stocks.db      stocks.db.bak.round3
    ```

2. **Pull the latest main:**

    ```bash
    cd /path/to/GLMinvestment
    git pull origin main
    ```

3. **CI gate 1 — no hard DELETE on predictions:**

    ```bash
    python3 scripts/check_no_hard_delete.py
    ```
    → expected: `✅ PASS: 0 active DELETE FROM predictions`

4. **CI gate 2 — no raw INSERT on predictions outside canonical writer:**

    ```bash
    python3 scripts/check_no_raw_insert.py
    ```
    → expected: `✅ PASS: 0 active INSERT INTO predictions outside canonical writers`
    → canonical writer: `vps-service/core/safe_insert_prediction.py`

5. **Pytest — 16 acceptance tests on safe_insert_prediction:**

    ```bash
    cd vps-service
    python3 -m pytest tests/test_safe_insert_prediction.py -v
    ```
    → expected: `16 passed`

### 15.2 Migration

6. **Add the `prev_status` column** (DEV-11 §2 — needed for DEV-15 fake-hit conversions to record the prior status, so `restore_archived.py` can revert if needed):

    ```bash
    python3 vps-service/scripts/add_prev_status_column.py --dry-run
    python3 vps-service/scripts/add_prev_status_column.py
    ```
    → idempotent: re-running prints `✓ Column 'prev_status' already exists — no-op.`

7. **Install / verify the 3 SQLite triggers** (DEV-13 — already installed in Round 2; verify they are still firing):

    ```bash
    python3 vps-service/scripts/apply_guard_triggers.py --dry-run
    python3 vps-service/scripts/apply_guard_triggers.py
    python3 vps-service/scripts/apply_guard_triggers.py --verify
    ```
    → expected: 3 triggers FIRED (trg_prevent_invalid_prices_insert + trg_prevent_invalid_prices_update + trg_prevent_wrong_direction)

### 15.3 Cleanup (dry-run first!)

8. **Unified cleanup — dry-run** (DEV-04 — marks rogue predictions as INVALID but does NOT delete them; idempotent):

    ```bash
    python3 vps-service/scripts/unified_prediction_cleanup.py --dry-run
    ```
    → review the printed counts: rogue predictions by status + by source pattern. Take a screenshot or save the output for the audit trail.

9. **Unified cleanup — execute**:

    ```bash
    python3 vps-service/scripts/unified_prediction_cleanup.py --execute
    ```
    → backup table `predictions_rogue_backup_<ts>` is created inside the DB
    → affected rows get `status='INVALID'` + notes appended
    → idempotent: re-running the dry-run prints `✅ DB is clean.`

### 15.4 Backfill hit timestamps (DEV-15)

10. **Backfill — dry-run** (price-verified — scans `stock_daily_prices` for the first candle that crossed the target/stop level):

    ```bash
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    ```
    → review the 3-category report per side:
      - (a) `confirmed_by_prices` — found a candle that crossed the level
      - (b) `no_price_data`     — no `stock_daily_prices` rows between the dates
      - (c) 🚨 `fake_hit`        — had prices but none crossed → will be converted

11. **Backfill — execute**:

    ```bash
    python3 vps-service/scripts/backfill_hit_timestamps.py --execute
    ```
    → backup `db/predictions.bak.dev-15.<UTC-ts>.db` is created automatically
    → confirmed rows: `target_hit_at` / `stop_hit_at` overwritten with the actual candle date (idempotent on re-run)
    → 🚨 fake rows converted:
        - `TARGET_HIT` → `closed_win` (if `actual_return > 0`) or `EXPIRED`
        - `STOPPED`    → `EXPIRED`
      with `prev_status` recorded + a `DEV-15-FAKE-*` marker appended to notes

    → idempotent: re-running `--dry-run` afterward should print `0` for both scan counts.

### 15.5 Recover the 28 deleted legit predictions (DEV-16)

12. **Recover — dry-run** (identifies the diff between the local backup DB with all 38 legit rows and the production target with only 10 legit remaining):

    ```bash
    python3 vps-service/scripts/recover_deleted_legit.py --dry-run \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```
    → review the printed plan: number of missing legit rows to recover, sample list (id + ticker + prediction_date + persona + entry/target).

13. **Recover — execute**:

    ```bash
    python3 vps-service/scripts/recover_deleted_legit.py --execute \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```
    → backup `db/predictions.bak.dev-16.<UTC-ts>.db` is created automatically
    → every INSERT goes through `safe_insert_prediction()` (the single canonical INSERT site — DEV-12 §1). Rows rejected by the DEV-07 hard gate (None / <=0 price) or DEV-12 prediction_write_guard (Rule 35 + Rule 21 + Rule 27) or DEV-13 SQLite triggers are logged and skipped.

    → idempotent: re-running `--dry-run` afterward should print `✓ Nothing to recover — target already has all legit rows.`

### 15.6 Restart + Verify

14. **Restart the python-backend so the new daily_closer logic takes effect for all future closes** (DEV-15 §1 — `datetime.now(timezone.utc)` is replaced by a `stock_daily_prices` lookup):

    ```bash
    pm2 restart python-backend
    ```

15. **Verify the active prediction count** — after Round 3, the active set should be ~48 (10 already-legit + 28 recovered + new V40.2 predictions made since):

    ```bash
    sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE status NOT IN ('INVALID','ARCHIVED');"
    ```
    → expected: ~48 (or higher if new V40.2 predictions were made since the backup).

16. **Hit the honest-tracking stats endpoint and verify no placeholders:**

    ```bash
    curl -s https://invest.m2y.net/api/predictions/honest-tracking/stats | jq .
    ```
    → expected: `master_score` distribution has no `50.0` placeholder entries, `evidence_count` is `>= 3` for all rows shown, no `kill_filter_result` is empty.

17. **Verify idempotency of the whole pipeline** — re-run the dry-run of each script in sequence. All of them should report 0 work to do:

    ```bash
    python3 vps-service/scripts/add_prev_status_column.py --dry-run
    python3 vps-service/scripts/apply_guard_triggers.py --dry-run
    python3 vps-service/scripts/unified_prediction_cleanup.py --dry-run
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    python3 vps-service/scripts/recover_deleted_legit.py --dry-run \
      --source-db db/predictions.bak.dev-08.<UTC-ts>.db \
      --target-db db/predictions.db
    ```

### 15.7 Rollback (if needed)

If anything goes wrong, the recovery path is:

1. **Restore the converted fake-hit rows** (revert DEV-15 conversions):

    ```bash
    python3 vps-service/scripts/restore_archived.py --dry-run
    python3 vps-service/scripts/restore_archived.py --execute
    ```
    → uses the `prev_status` column (added in step 6) to revert `closed_win`/`EXPIRED` → `TARGET_HIT`/`STOPPED`. This handles the DEV-15 conversions cleanly because each converted row has `prev_status='TARGET_HIT'` or `prev_status='STOPPED'` recorded.

2. **Restore the DB files from the round3 backup** (covers everything else — the rogue-cleanup INVALID conversions, the 28 recovered legit rows, the trigger installation, the prev_status column):

    ```bash
    cp db/predictions.db.bak.round3 db/predictions.db
    cp db/stocks.db.bak.round3      db/stocks.db
    pm2 restart python-backend
    ```

3. **Verify the rollback** — re-run the idempotency dry-runs from step 17. They should report the same state as before Round 3 started.

### 15.8 Audit trail (what to keep)

After a successful Round 3 deployment, retain the following artifacts for the audit trail (per Rule 27 — NO-FAKE-DATA transparency):

- `db/predictions.db.bak.round3` — pre-round3 state of predictions.db
- `db/stocks.db.bak.round3`      — pre-round3 state of stocks.db
- `db/predictions.bak.dev-15.<UTC-ts>.db` — auto-backup before DEV-15 backfill
- `db/predictions.bak.dev-16.<UTC-ts>.db` — auto-backup before DEV-16 recovery
- `predictions_rogue_backup_<ts>` table inside predictions.db — snapshot of the rogue rows that were marked INVALID (DEV-04)
- Output of each `--dry-run` step (saved as a text file in `scripts/output/`)

These artifacts let any future auditor verify:
- which rows were converted from `TARGET_HIT`/`STOPPED` to `closed_win`/`EXPIRED`
- which rows were recovered as new legit predictions
- which rows were marked `INVALID` by the unified cleanup
- the exact `prev_status` of every converted row (so the conversion can be reversed deterministically)

### 15.9 References

- `00-CONSTITUTION.md` §27 (NO-FAKE-DATA) + §35 (ENGINE-UNIFY)
- `agent-ctx/DEV-08-lead-technical-implementer.md` (the wrong implementation being replaced by DEV-15)
- `agent-ctx/DEV-11-14-lead-technical-implementer.md` (DEV-11 prev_status + DEV-12 safe_insert_prediction + DEV-13 triggers + DEV-14 CI gates)
- `agent-ctx/DEV-15-17-lead-technical-implementer.md` (this round — full work record)
- `vps-service/jobs/daily_closer.py::_mark_closed` (DEV-15 §1 — price-aware hit-timestamp writer for future closes)
- `vps-service/scripts/backfill_hit_timestamps.py` (DEV-15 §2 — retroactive equivalent for legacy rows)
- `vps-service/scripts/recover_deleted_legit.py` (DEV-16 — recover 28 deleted legit predictions)
- `vps-service/scripts/restore_archived.py` (DEV-11 §5 — rollback path)

---

## 16. Dead-Code Inventory (مختصر)

> **التفاصيل الكاملة:** مرجع `02-SCREENS_AND_COMPONENTS.md` §10 (Dead/Duplicate Inventory) + §11 (Tech Debt + Refactoring).
> هذا قسم مختصر للمعمارية فقط. لا حذف بدون موافقة المالك (CONSTITUTION Rule 25 — VERIFY-BEFORE-DELETE).

### 16.1 الـ 9 صفحات الميتة (4,711 LOC)

| # | Route | LOC | سبب الموت | الإجراء |
|---|---|---:|---|---|
| 1 | `/admin/expert-recommendations` | 1,079 | لا inbound link | حذف (P3) |
| 2 | ~~`/admin/maestro`~~ | ~~747~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) | كان functionality في `/#admin` |
| 3 | `/admin/prediction-performance` | 823 | sidebar شال الـ link | حذف (P3) |
| 4 | `/community` | 324 | CommunityView orphan | حذف (P3) |
| 5 | `/education/analysis-types` | 469 | orphan | حذف (P3) |
| 6 | `/payment/fail` | 58 | paymob callback ما بـ redirectش لهنا | حذف (P3) |
| 7 | `/portfolio` | 1,199 | sidebar بـ يستخدم `#portfolio` hash | حذف (P3) |
| 8 | `/prediction-performance` | 8 | stub | حذف (P3) |
| 9 | `/unified-analysis` | 12 | comment: "moved to Admin" | حذف (P3) |

### 16.2 الـ 33 DEPRECATED Flask Blueprints (~17,000 LOC)

> ملفات `vps-service/api/*.py` موجودة بس مش محملة في `lightweight_server.py` — كود ميت.
> **أمثلة (تقديري):** `old_predictions_routes.py` · `legacy_chart_routes.py` · `v1_market_routes.py` · `v2_portfolio_routes.py` · ... (33 file total).
> **الإجراء:** حذف تدريجي بعد التحقق الثلاثي (CONSTITUTION Rule 16). المرحلة P3.

### 16.3 StoredAnalysisView.tsx (1,896 LOC — Orphan)

- `src/components/advanced-analysis/StoredAnalysisView.tsx` — 1,896 LOC
- بعد الـ 3-SCREEN REDESIGN (commit `d2084710`, v3.66.8) الـ `#advanced-analysis` بـ يـ redirect لـ `MarketAnalysisView`
- الـ StoredAnalysisView **still on disk** لكن **no longer imported** anywhere.
- **إجراء:** حذف في P3 cleanup.

### 16.4 `garage/` Directory (~8,247 LOC — Dead)

- مجلد كامل من الكود الميت (early prototypes, abandoned features, broken experiments).
- **إجراء:** حذف كامل في P3 (بعد مراجعة الـ imports).

### 16.5 الـ 71 Orphan Components (50,442 LOC — 26.6% من الـ frontend)

> التفاصيل الكاملة في `02-SCREENS_AND_COMPONENTS.md` §10.3 + §10.4 — كل الـ 71 orphan component موثّقة بالتفصيل.
> Top 30 orphans: ~30,000 LOC (أكبرها: StoredAnalysisView 1,896 LOC، AdvancedStockChart 1,988 LOC، ...)
> 41 more orphans: ~20,000 LOC

### 16.6 الـ 20 Unused UI Primitives (~4,300 LOC)

- shadcn/ui primitives installed لكن مش مستخدمة (carousel, command, combobox, ...).
- **إجراء:** حذف في P3.

### 16.7 الـ 163 Tiny-Proxy Boilerplate (~4,700 LOC)

- ملفات `route.ts` proxy صافي (3-5 LOC each) قابلة للاستبدال بـ catch-all proxy واحد.
- **البديل:** `src/app/api/proxy/[...path]/route.ts` (catch-all).

### 16.8 7 Duplicate Families

> التفاصيل في `02-SCREENS_AND_COMPONENTS.md` §10.5.

- charts (3 impls)
- watchlists (2 impls)
- alerts (2 impls)
- share (2 impls)
- wealth (2 impls)
- analysis (3 impls)
- stocks (2 impls)

### 16.9 الـ P3 Cleanup Progress (partial)

- ✅ 3 orphan components deleted (post P0)
- ✅ 6 `simulated_*.py` scripts deleted (post P0)
- ⏳ 9 dead pages + garage/ + 33 DEPRECATED blueprints + 41 more orphans = NEXT (P3)

### 16.10 SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE (2026-10-12)

قسم جديد يوثّق 3 آثار جانبية اكتُشفت وعُولجت + 9 orphan components أُرشفت لـ `archive/dead-components-20261012/` (4,408 LOC) + `proxy-client.ts` verified NOT orphan (3 importers حية — اتبقى في مكانه).

> التفاصيل الكاملة لكل orphan component — مرجع `02-SCREENS_AND_COMPONENTS.md` §10.

---

*هذا الملف هو المصدر الأوحد للحقيقة لمعمارية المشروع + الـ APIs + الـ deployment. أي تغيير في البنية = تحديث هذا الملف فورًا.*
*تم التوحيد بواسطة Documentation Unification Agent — Task ID `DOC-UNIFY-2-ARCH-SCREENS` — 2026-10-12.*
*المصادر المؤرشفة في `_archive_pre_unification_2026-10-12/`.*



