# 01 — المعمارية التقنية الكاملة

> **مصدر الحقيقة:** الكود الفعلي (`.ts` / `.tsx` / `.py` / `.json`). كل اسم مذكور هنا موجود فعلياً في الـ filesystem.
> **آخر مراجعة:** 2026-10-24 (بعد Phase 9 Final + F-Phase3 Splits + B0.1 Blueprints).
> **الإصدار:** v3.4.43 (`egx-investment-platform`).
>
> هذا الملف هو **المصدر المرجعي الوحيد** للمعمارية. أي تعارض بين هذا الملف وملف آخر ← هذا الملف هو الصحيح.

---

## 📑 فهرس المحتويات

1. [نظرة عامة على النظام (3 طبقات)](#1-نظرة-عامة-على-النظام)
2. [الخدمات الثمانية (PM2 Ecosystem)](#2-الخدمات-الثمانية-pm2-ecosystem)
3. [مخطط المنافذ (Ports Map)](#3-مخطط-المنافذ-ports-map)
4. [الطبقة ألفا — الفرونت إند (Frontend)](#4-الطبقة-ألفا--الفرونت-إند)
5. [الطبقة برافو — الباك إند (Backend)](#5-الطبقة-برافو--الباك-إند-backend)
6. [مخطط تدفق البيانات (Data Flow)](#6-مخطط-تدفق-البيانات-data-flow)
7. [الجسور الثلاثة (3 Proxy Routes)](#7-الجسور-الثلاثة-3-proxy-routes)
8. [WebSocket Real-time (ws-service)](#8-websocket-real-time-ws-service)
9. [نظام المصادقة (Auth System)](#9-نظام-المصادقة-auth-system)
10. [Phase 3 — Modularization Summary](#10-phase-3--modularization-summary)
11. [Performance Notes](#11-performance-notes)
12. [قواعد معمارية حاكمة (Architecture Rules)](#12-قواعد-معمارية-حاكمة)
13. [مصفوفة الملفات الرئيسية (Key Files Matrix)](#13-مصفوفة-الملفات-الرئيسية-key-files-matrix)

---

## 1. نظرة عامة على النظام

GLMinvestment هو منصة استثمارية متعددة الأصول (EGX + Crypto + Metals + Forex + Indices) مبنية على **معمارية ثلاثية الطبقات** مع فصل صارم بين العرض والمنطق.

### 1.1 الطبقات الثلاث الرئيسية

| الطبقة | الاسم الرمزي | المسار | المنفذ | التقنية | الدور |
|---|---|---|---|---|---|
| **ألفا (Alpha)** | العرض | `src/` | 3000 | Next.js 16 + React 18 + TS | عرض فقط (SPA) + 464 API route + 3 proxy للـ Python |
| **برافو العقل (Bravo-Brain)** | المنطق | `vps-service/` | 8010 | Python 3 + FastAPI + Flask (مُركّب عبر `a2wsgi`) | كل المنطق: محركات، تحليل، مخاطر، توقعات، باك تست |
| **برافو السحب (Bravo-Data)** | البيانات | `data_engine/` | 5000 | Python 3 + Flask | سحب الأسعار الحية من 20+ مصدر → SQLite DBs |

### 1.2 الخدمات المساعدة (Auxiliary Services)

| الخدمة | المسار | المنفذ | التقنية | الدور |
|---|---|---|---|---|
| **برافو Push** | `vps-service/ws-service/` | 3005 | Socket.io + Bun | Push لحظي للأسعار للمتصفح (Hyper Polling 2s داخل الجلسة) |
| **Telegram Events Relay** | `telegram-events/` | 3003 | Bun + Socket.io | Relay لأحداث Telegram اللحظية (يقرأه `admin/TelegramTab.tsx`) |
| **Telegram Auto-Poster** | `vps-service/telegram/auto_post_scheduler.py` | — | Python + Telethon | جدولة النشر التلقائي للقناة (daily picks / morning bell / weekly / monthly) |
| **Telegram Interactive Bot** | `vps-service/telegram/telegram_interactive_bot.py` | — | Python + Telethon | البوت التفاعلي `@investusernamebot` (تحليل، رادار، اختيار أسهم) |
| **News Agent** | `news-agent/` | — | Python + Ollama | جمع الأخبار المصرية (RSS/Telegram/Web) وتحليلها محلياً → POST للسيرفر |
| **Ollama** | النظام (systemd) | 11434 | Go + llama.cpp | AI محلي (نموذج `qwen2.5:1.5b` + `glm-fast`) لتحليل الأخبار و الـ RAG |

### 1.3 القاعدة الحاكمة (Rule 20 — Python = Brain)

> **`Next.js = العرض، Python = العقل`.**
> أي حساب أو منطق في الواجهة = مخالفة. الـ 3 proxy routes هي الجسر الوحيد بين Node و Python (انظر §7).

**العواقب:**
- لا يحق للفرونت إند إجراء أي حساب مالي (RSI، MACD، Sharpe، P/E ratios…).
- لا يحق للفرونت إند قراءة `stocks.db` أو `predictions.db` مباشرةً (يستخدم Prisma لـ auth/predictions فقط).
- كل البيانات التحليلية تأتي عبر API call إلى Python أو عبر 3 proxy routes محددة.

---

## 2. الخدمات الثمانية (PM2 Ecosystem)

ملف التكوين: **`ecosystem.config.js`** (424 LOC). يستخدم PM2 لإدارة 7 خدمات + خدمة Ollama خارجية (systemd).

| # | اسم الخدمة في PM2 | اللغة | المنفذ | الذاكرة القصوى | المُفسّر (Interpreter) | ملف الدخول | cwd | الوظيفة |
|---|---|---|---|---|---|---|---|---|
| 1 | `python-backend` | Python 3 | **8010** | 500M | `.venv/bin/python` | `main.py` | `vps-service/` | THE BRAIN — FastAPI + Flask مركّب |
| 2 | `data-engine` | Python 3 | **5000** | 500M | `.venv/bin/python` (interpreter:none) | `main.py` | `data_engine/` | سحب البيانات من 20+ مصدر |
| 3 | `nextjs` | Node.js ≥22 | **3000** | 1500M | Node 22+ عبر `getNodeInterpreter()` | `node_modules/next/dist/bin/next` | `./` | Next.js production server (`next start -p 3000`) |
| 4 | `ws-service` | Bun | **3005** | 200M | Bun عبر `getBunInterpreter()` | `index.ts` | `vps-service/ws-service/` | WebSocket push service |
| 5 | `telegram-poster` | Python 3 | — | 300M | `.venv/bin/python` | `telegram/auto_post_scheduler.py` | `vps-service/` | جدولة النشر التلقائي للقناة |
| 5b | `telegram-interactive-bot` | Python 3 | — | 300M | `.venv/bin/python` | `telegram/telegram_interactive_bot.py` | `vps-service/` | البوت التفاعلي |
| 6 | `telegram-events` | Bun | **3003** | 150M | Bun عبر `getBunInterpreter()` | `index.ts` | `telegram-events/` | Socket.io relay لأحداث Telegram |
| 7 | `news-agent` | Python 3 | — | 300M | `news-agent/.venv/bin/python` (fallback `.venv` أو `python3`) | `main.py` | `news-agent/` | جمع وتحليل الأخبار |
| — | `ollama` | Go | **11434** | — | (systemd) | `ollama serve` | — | AI محلي (نموذج qwen2.5:1.5b + glm-fast) |

### 2.1 ملاحظات تكوين PM2

- **`.env` auto-loader:** يقرأ `ecosystem.config.js` ملف `.env` يدوياً قبل بدء أي خدمة (`fs.readFileSync(envFile, 'utf8')`).
- **`getBunInterpreter()`:** يبحث عن `$BUN_PATH` → `~/.bun/bin/bun` → fallback `bun`.
- **`getNodeInterpreter()`:** يفرض Node ≥22 (لأن `better-sqlite3@13.0.3` يسبب SIGSEGV على Node 18/20). يبحث في `~/.nvm/versions/node/v*/bin/node` بترتيب تنازلي.
- **`max_memory_restart`:** يُعاد تشغيل الخدمة تلقائياً عند تجاوز الذاكرة.
- **`max_restarts: 10`** + **`restart_delay: 5000`** — منع storm إعادة التشغيل.
- **`kill_timeout: 10000`–`15000`** — مهلة طويلة لـ Next.js بسبب Turbopack cleanup.

### 2.2 إدارة الـ credentials (SECURITY)

كل الـ tokens مأخوذة من `.env` فقط — لا hardcoded credentials في الـ repo (تم إصلاحها في SECURITY-P0):

| المتغير | المستخدم |
|---|---|
| `TELEGRAM_BOT_TOKEN` | telegram-poster + telegram-interactive-bot |
| `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` | Telethon client |
| `TELEGRAM_CHANNEL_ID` | القناة المستهدفة للنشر |
| `EODHD_API_KEY` | eodhd_fetcher (subscription cancelled — fallback empty) |
| `BOT_API_SECRET` | interactive bot auth |
| `PRODUCTION_SERVER_URL` | news-agent target (`http://127.0.0.1:3000`) |
| `OLLAMA_MODEL` | news-agent AI model (`qwen2.5-coder:7b`) |
| `NEXT_PUBLIC_API_URL` | frontend → `https://invist.m2y.net` |

---

## 3. مخطط المنافذ (Ports Map)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Localhost (127.0.0.1)                            │
│                                                                            │
│  ┌─────────────┐    HTTP/JSON    ┌─────────────┐                           │
│  │  Next.js    │ ──────────────► │  Python     │                          │
│  │  :3000      │                │  :8010      │                          │
│  │  (Alpha)    │ ◄───────────── │  (Bravo)    │                          │
│  └──────┬──────┘   SSE/stream   └──────┬──────┘                          │
│         │                                ▲                                 │
│         │ socket.io (proxy)              │                                  │
│         ▼                                │ HTTP                             │
│  ┌─────────────┐                  ┌──────┴──────┐                          │
│  │  ws-service │ ── poll 2-30s ──►│             │                          │
│  │  :3005      │                  │             │                          │
│  │  (Push)     │ ◄── broadcast ── │             │                          │
│  └─────────────┘   POST /broadcast│             │                          │
│                                   │             │                          │
│  ┌─────────────┐                  │             │                          │
│  │ telegram-   │ ── poll ───────► │             │                          │
│  │ events      │                  │             │                          │
│  │  :3003      │                  │             │                          │
│  └─────────────┘                  │             │                          │
│                                   │             │                          │
│                                   │             │                          │
│  ┌─────────────┐   SQLite WAL     │             │                          │
│  │ data-engine │ ◄─────────────► │             │                          │
│  │  :5000      │    db/*.db       │             │                          │
│  │  (Data)     │                  │             │                          │
│  └──────┬──────┘                  │             │                          │
│         │                          │             │                          │
│         │ 20+ external sources    │             │                          │
│         ▼                          │             │                          │
│  ┌──────────────────────────────────────────────┐                          │
│  │  TradingView / Yahoo / CoinGecko / RSS /     │                          │
│  │  Mubasher / Reuters / Bloomberg / WorldBank  │                          │
│  └──────────────────────────────────────────────┘                          │
│                                                                            │
│  ┌─────────────┐    HTTP :11434                                             │
│  │  Ollama     │ ◄──── glm_finance_agent.py (AI/RAG)                       │
│  │  (systemd)  │                                                             │
│  └─────────────┘                                                            │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ Public Internet
                                  │
                          ┌───────┴────────┐
                          │  Nginx Reverse │
                          │  Proxy (TLS)   │
                          │  invist.m2y.net│
                          └────────────────┘
```

| Port | البروتوكول | المالك | الوصول من الخارج |
|---|---|---|---|
| **3000** | HTTP | nextjs (PM2) | عبر Nginx (TLS termination) |
| **3003** | HTTP + Socket.io | telegram-events | داخلي فقط (admin tab) |
| **3005** | HTTP + Socket.io | ws-service | عبر Next.js rewrite (`/socket.io/*`) |
| **5000** | HTTP | data-engine | داخلي فقط |
| **8010** | HTTP + FastAPI + Flask | python-backend | داخلي + عبر 3 proxy routes |
| **11434** | HTTP | ollama (systemd) | localhost فقط |

---

## 4. الطبقة ألفا — الفرونت إند

### 4.1 المعمارية العامة

| الميزة | القيمة |
|---|---|
| **Framework** | Next.js **16.1.3** (App Router) |
| **React** | 18.2 |
| **TypeScript** | 5.9.3 |
| **Bundler** | Turbopack (Next 16 default) |
| **Build Tool** | `next build --no-lint` مع `NODE_OPTIONS='--max-old-space-size=4096'` |
| **Runtime Memory** | `--max-old-space-size=256` (production) — عمداً صغير لـ VPS |
| **Threading** | `UV_THREADPOOL_SIZE=1`, `SWC_THREADPOOL=1`, `RAYON_NUM_THREADS=1` |
| **Total LOC** | **328,956** سطر (TS + TSX) عبر **976** ملف |
| **API Routes** | **464** route handler (`src/app/api/**/route.ts`) |
| **SPA Shell** | `src/app/page.tsx` — شاشة وحيدة `'use client'` |

### 4.2 المعمارية المعمارية (SPA Pattern)

التطبيق يستخدم **SPA بشاشة وحيدة** مع `switch(currentView)`:

```
src/app/page.tsx (shell)
    │
    ├── useAppStore (zustand) → currentView: string
    │
    ├── URL hash sync (مثلاً `#admin`, `#stocks`, `#predictions`)
    │
    ├── VALID_VIEWS_SET (src/lib/valid-views.ts) — قائمة ~50 view مسموح بيها
    │       Default → 'dashboard'
    │
    └── switch(currentView) {
            case 'dashboard': return <DashboardView />
            case 'admin':     return <AdminView />
            case 'stocks':    return <StocksView />
            case 'crypto-*':   fallthrough إلى non-crypto counterpart
            ...
        }
```

- **Lazy loading:** كل view يُحمَّل عبر `dynamicImport(() => ..., { ssr: false })` + `withErrorBoundary(...)` عشان أي crash ما يقتلش الصفحة.
- **~50 view** مسموح بيها (قائمة `VALID_VIEWS_SET` في `src/lib/valid-views.ts`).
- **crypto-* views:** 8 cases تـ fallthrough إلى نفس الـ component بتاع الـ non-crypto counterpart (Phase 3.1 unified).

### 4.3 الـ Modules الـ 19 (`src/modules/`)

كل feature موجود في مجلد مستقل تحت `src/modules/<feature>/` بـ هيكل ثابت:

```
src/modules/<feature>/
    ├── index.ts                    (barrel export)
    ├── lib/                        (pure helpers — logic)
    │   ├── *.ts
    │   └── *.tsx (لو فيه JSX)
    └── components/                 (UI components)
        ├── <Feature>View.tsx       (container — < 500 LOC بعد Strangler)
        ├── <feature>/              (sub-components folder)
        │   ├── helpers.ts
        │   ├── types.ts
        │   ├── constants.ts
        │   └── *.tsx
        └── ...
```

| # | Module | المسار | عدد الملفات | المكون الرئيسي | الوظيفة |
|---|---|---|---|---|---|
| 1 | **admin** | `src/modules/admin/` | ~60 | `AdminView.tsx` + `admin-view/AdminView.tsx` | لوحة تحكم المالك (users + DBs + engines + telegram + news + crons) |
| 2 | **auth** | `src/modules/auth/` | 1 | `DevLoginForm.tsx` | تسجيل دخول التطوير |
| 3 | **crypto** | `src/modules/crypto/` | 2 | `CryptoPortfolioView.tsx` + `CryptoPredictionTrackingView.tsx` | شاشات الكريبتو المخصصة |
| 4 | **dashboard** | `src/modules/dashboard/` | ~22 | `DashboardView.tsx` | الصفحة الرئيسية ( widgets متنوعة) |
| 5 | **education** | `src/modules/education/` | ~30 | `AcademyView.tsx` + `PaperTradingWorkstation.tsx` + `StrategySandbox.tsx` | الأكاديمية + محاكي التداول + sandbox |
| 6 | **index-detail** | `src/modules/index-detail/` | 1 | `IndexDetailView.tsx` | تفاصيل المؤشر (EGX30, S&P500…) |
| 7 | **market-analysis** | `src/modules/market-analysis/` | ~40 | `MarketAnalysisView.tsx` + `SingleStockAnalysisView.tsx` + `UnifiedAnalysisView.tsx` | التحليل الموحد + persona + morning bell + predictions |
| 8 | **news** | `src/modules/news/` | 1 | `NewsFeedView.tsx` | عرض الأخبار |
| 9 | **personalized** | `src/modules/personalized/` | 1 | (lib only) `lib/personalized-radar.ts` | رادار مخصص لكل مستخدم |
| 10 | **portfolio** | `src/modules/portfolio/` | ~17 | `EnhancedPortfolioView.tsx` + `enhanced-portfolio/EnhancedPortfolioView.tsx` | المحفظة + robo-advisor + bag-holder rescue |
| 11 | **predictions** | `src/modules/predictions/` | ~22 | `PredictionTrackingDashboard.tsx` + `prediction-dashboard/PredictionTrackingDashboard.tsx` + `MakerRadarTab.tsx` | تتبع التوقعات + رادار صانع السوق |
| 12 | **publishing** | `src/modules/publishing/` | ~16 | `UnifiedPublishButton.tsx` + `StockPublisher.tsx` + `StockInfographicModal.tsx` | نشر على Telegram + بطاقات إنفوجرافيك + trade results |
| 13 | **radar** | `src/modules/radar/` | ~12 | `ExitRadarTab.tsx` + `NetPicksTab.tsx` + `WeeklyReportTab.tsx` + `MultiMarketRadarTab.tsx` | رادار متعدد (exit + incubator + accuracy + multi-market) |
| 14 | **reports** | `src/modules/reports/` | ~17 | `ExecutiveReportView.tsx` + `executive-report/ExecutiveReportView.tsx` + `StockAnalysisReport.tsx` | التقارير التنفيذية + اليومية |
| 15 | **screener** | `src/modules/screener/` | ~13 | `StockScreenerAdvanced.tsx` + `screener-advanced/StockScreenerAdvanced.tsx` | screener متقدم (TradingView-style) |
| 16 | **sharia** | `src/modules/sharia/` | ~10 | `ShariaView.tsx` + `sharia-view/ShariaView.tsx` | الأسهم المتوافقة مع الشريعة + حاسبة التطهير |
| 17 | **simulation** | `src/modules/simulation/` | ~10 | `SimulationView.tsx` + `simulation-view/SimulationView.tsx` | محاكي الاستثمار + تقارير |
| 18 | **stock-analysis** | `src/modules/stock-analysis/` | ~25 | `StocksView.tsx` + `stocks-view/StocksView.tsx` + `StockDetail.tsx` + `TradingViewChart.tsx` | عرض الأسهم + تفاصيل السهم + الرسوم البيانية |
| 19 | **subscription** | `src/modules/subscription/` | 3 | `PricingView.tsx` + `TrialCountdownBanner.tsx` + `TrialExpiredModal.tsx` | صفحة الأسعار + شريط Trial + مودال انتهاء الفترة |

### 4.4 الـ Hooks الـ 19 (`src/hooks/`)

| # | Hook | الملف | الـ LOC تقريبياً | الوظيفة |
|---|---|---|---|---|
| 1 | `useApiQuery` + `useLiveApiQuery` + `useConditionalApiQuery` | `use-api-query.ts` | ~250 | Wrapper لـ TanStack Query v5 (يحل 268 manual useEffect+fetch pattern) |
| 2 | `usePagination<T>` | `use-pagination.ts` | ~80 | Pagination hook (auto-reset + slice + helpers) — يحل 7+ inline patterns |
| 3 | `useDebounce<T>` | `use-debounce.ts` | ~30 | Debounce لـ search inputs |
| 4 | `useAuthCheck` | `useAuthCheck.ts` | — | التحقق من session + subscription tier |
| 5 | `useToast` | `use-toast.ts` | — | shadcn toast wrapper |
| 6 | `useMobile` | `use-mobile.ts` | — | كشف mobile viewport |
| 7 | `usePortfolioData` | `usePortfolioData.ts` | — | بيانات المحفظة (Strangler) |
| 8 | `useMakerRadarData` | `useMakerRadarData.ts` | — | بيانات رادار صانع السوق |
| 9 | `useLiveMonitorData` | `useLiveMonitorData.ts` | — | بيانات live monitor |
| 10 | `useVisibilityAwarePolling` | `useVisibilityAwarePolling.ts` | — | polling يتوقف عند tab blur |
| 11 | `useMarketPulseData` | `useMarketPulseData.ts` | — | نبض السوق اللحظي |
| 12 | `useStocksViewData` | `useStocksViewData.ts` | — | بيانات شاشة StocksView (Strangler from 2,316 LOC) |
| 13 | `useScreenerData` | `useScreenerData.ts` | — | بيانات screener متقدم (Strangler from 2,723 LOC) |
| 14 | `usePersonaTabData` | `usePersonaTabData.ts` | — | بيانات persona tab (Strangler from 2,676 LOC) |
| 15 | `useSpecialistAnalysisData` | `useSpecialistAnalysisData.ts` | 565 | بيانات specialist analysis (Strangler from 2,916 LOC) |
| 16 | `useAcademyData` | `useAcademyData.ts` | — | بيانات academy (Strangler from 2,483 LOC) |
| 17 | `useEngineControlRoomData` | `useEngineControlRoomData.ts` | — | بيانات engine control room (Strangler from 2,481 LOC) |
| 18 | `useDatabaseManagerData` | `useDatabaseManagerData.ts` | — | بيانات DB manager (Strangler from 3,291 LOC) |
| 19 | `useSuperLearningData` | `useSuperLearningData.ts` | — | بيانات super learning system |

### 4.5 الـ Unified Components الـ 35 (`src/components/shared/ui/`)

مجلد **`src/components/shared/ui/`** — يحتوي على **32** ملف `.tsx` (3 منهم re-exports لـ WidgetCard/WidgetStat/WidgetError من `../`).

> **الـ blueprint:** كل UI component جديد لازم يُبنى هنا أولاً (Rule 73 — SINGLE-DISPLAY-SOURCE).

| # | Component | الملف | الوظيفة |
|---|---|---|---|
| 1 | `PriceDisplay` | `PriceDisplay.tsx` | عرض السعر بصيغة موحدة (محل الـ inline price formats) |
| 2 | `PriceText` | `PriceText.tsx` | سعر + 5 markets + 5 sizes + 4 weights + 4 tones |
| 3 | `PriceValue` | `PriceValue.tsx` | قيمة سعرية raw (Phase 3) |
| 4 | `ChangePill` | `ChangePill.tsx` | +/- بـ color (يحل 286+ inline `.toFixed()`) |
| 5 | `ChangeText` | `ChangeText.tsx` | نص تغيير (Phase 3) |
| 6 | `DeltaBadge` | `DeltaBadge.tsx` | شارة delta (Phase 5 — Live screens) |
| 7 | `TrendIndicator` | `TrendIndicator.tsx` | مؤشر اتجاه (سهم صاعد/هابط) |
| 8 | `SignalBadge` | `SignalBadge.tsx` | شارة إشارة (BUY/SELL/HOLD…) — يستخدم `lib/signals.ts` |
| 9 | `StatusBadge` | `StatusBadge.tsx` | 7 statuses رسمية + helper `getStatusBadgeClass()` (يحل 22 bug `/40`) |
| 10 | `SeverityBadge` | `SeverityBadge.tsx` | 5 levels (critical/high/medium/low/info) + helper |
| 11 | `LifecycleBadge` | `LifecycleBadge.tsx` | proven/testing/closed مع `getLifecycle()` من `lib/lifecycle.ts` |
| 12 | `RiskRewardBadge` | `RiskRewardBadge.tsx` | شارة risk/reward ratio |
| 13 | `FinancialBadge` | `FinancialBadge.tsx` | شارة مالية (P/E, ROE…) |
| 14 | `FlowPhaseTag` | `FlowPhaseTag.tsx` | طور التدفق (accumulation/distribution) |
| 15 | `ConfidenceMeter` | `ConfidenceMeter.tsx` | شريط ثقة أفقي (0-100) + role=progressbar |
| 16 | `WickLiquidityBar` | `WickLiquidityBar.tsx` | شريط سيولة الـ wick |
| 17 | `LiquidityFlashCell` | `LiquidityFlashCell.tsx` | خلية سيولة فلّاشة (Phase 5 — Live) |
| 18 | `StockCard` | `StockCard.tsx` | بطاقة سهم موحدة + helpers `isWarningOrVeto` / `isBuyOpportunity` |
| 19 | `MarketTable` | `MarketTable.tsx` | جدول سوق موحد (generics `MarketTableColumn<T>`) |
| 20 | `UnifiedPagination` | `UnifiedPagination.tsx` | RTL-aware pagination + `disabled` prop |
| 21 | `UnifiedEmptyState` | `UnifiedEmptyState.tsx` | empty state موحد + `actionLabel`/`onAction` |
| 22 | `PersonaEmptyState` | `PersonaEmptyState.tsx` | empty state لـ persona (يستخدم `getPersonaTheme`) |
| 23 | `AsyncBoundary` | `AsyncBoundary.tsx` | Loading+Error+Empty+Success في واحد (render-prop) |
| 24 | `SkeletonRow` + `TabSkeleton` + `TableSkeleton` + `CardSkeleton` | `Skeleton.tsx` | 4 variants من skeleton (يحل 328+ inline `<Skeleton>`) |
| 25 | `FilterDrawer` | `FilterDrawer.tsx` | درج فلترة جانبي |
| 26 | `StockDetailDrawer` | `StockDetailDrawer.tsx` | درج تفاصيل سهم |
| 27 | `StockRescueModal` | `StockRescueModal.tsx` | مودال إنقاذ سهم خاسر |
| 28 | `ActionMenu` | `ActionMenu.tsx` | قائمة actions منسدلة |
| 29 | `Label` | `Label.tsx` | Label موحد (Phase 3) |
| 30 | `NumText` | `NumText.tsx` | نص رقمي موحد (Phase 3) |
| 31 | `DateText` | `DateText.tsx` | نص تاريخ موحد (Phase 3) |
| 32 | `SectionTitle` | `SectionTitle.tsx` | عنوان قسم موحد (Phase 3) |
| 33 | `WidgetCard` | `../WidgetCard.tsx` (re-export) | بطاقة widget موحدة (Phase 3) — يحل manual `<Card>` patterns |
| 34 | `WidgetStat` + `WidgetStatGrid` | `../WidgetStat.tsx` (re-export) | شبكة إحصائيات موحدة (Phase 3) |
| 35 | `WidgetError` | `../WidgetError.tsx` (re-export) | بطاقة خطأ موحدة (Phase 3) |

### 4.6 الـ lib (`src/lib/`)

أكثر من **100** ملف مساعد في `src/lib/`. أهمها:

| الفئة | الملف | الوظيفة |
|---|---|---|
| **Auth** | `auth-helper.ts` | JWT verification (NextAuth + Bearer for mobile) |
| **Auth** | `admin-auth.ts` + `admin-auth-server.ts` + `admin-guard.ts` + `admin-identities.ts` | مصادقة الأدمن |
| **Auth** | `db-auth.ts` | Prisma auth DB access |
| **Subscription** | `subscription-gate.ts` | TIER_LIMITS + `getTierLimits()` + `canAccessFeature()` + `canAddMore()` + `PAID_TIERS` + `isPaidSubscriptionActive()` |
| **Subscription** | `subscription-enforcement.ts` | Server-side free-tier limit enforcement |
| **Subscription** | `plans.ts` | `PlanData` interface + 4 plans (free / normal / premium / developer) |
| **Subscription** | `paywall.ts` + `trial-abuse-guard.ts` | جدار الدفع + حماية إساءة الـ trial |
| **DB** | `db.ts` + `db-predictions.ts` + `new-db.ts` + `finance-db.ts` + `shared-db.ts` | Prisma + better-sqlite3 access |
| **DB** | `egx-db.ts` + `data-engine-db.ts` + `data-engine-db-sqljs.ts` | EGX + data_engine DBs |
| **API** | `api-client.ts` + `python-backend.ts` + `vps-adapter.ts` + `egxpy-bridge.ts` | API clients للـ Python |
| **State** | `store.ts` + `store-modules/` (5 files) | Zustand store + slice modules |
| **Realtime** | `ws-client.ts` | Socket.io client للـ ws-service |
| **Indicators** | `indicators/rsi.ts` + `canonical-rsi.ts` + `canonical-signal.ts` | مؤشرات RSIcanonical |
| **AI** | `ai/ollama.ts` + `ai/deepseek-client.ts` + `ai/memory.ts` + `ai/tools.ts` + `ai/tts.ts` | AI clients |
| **Tracking** | `honest-tracking/` (4 files: maestro + 3 modules) | نظام التتبع الصادق |
| **Scheduling** | `schedulers/radar-alerts.ts` + `scheduler/index.ts` | جدولة تنبيهات الرادار |
| **Format** | `format.ts` + `utils.ts` | canonical `formatPrice()` + cn() helper |
| **Validation** | `data-validator.ts` + `prediction-validator.ts` + `targets-validator.ts` | تحقق من البيانات |
| **Misc** | `valid-views.ts` | قائمة الـ 50 view المسموح بيها |
| **Misc** | `market-constants.ts` + `sector-constants.ts` + `persona-config.ts` + `market-utils.ts` + `market-hours.ts` | ثوابت السوق |

### 4.7 الـ shared components خارج `ui/`

`src/components/shared/` (خارج `ui/`):

| الملف | الوظيفة |
|---|---|
| `UnifiedTable.tsx` (2,942 LOC) | جدول موحد (generics + sorting + pagination) |
| `PredictionCard.tsx` | بطاقة توقع |
| `WidgetCard.tsx` + `WidgetStat.tsx` + `WidgetError.tsx` | Phase 3 widget unification |
| `ChartToggle.tsx` | مبدّل نوع الرسم البياني |
| `DataTrustBadge.tsx` | شارة مصداقية البيانات |
| `ErrorBoundary.tsx` | React error boundary |
| `FlashingChangeCell.tsx` + `FlashingPriceCell.tsx` | خلايا فلّاشة للأسعار |
| `FormulaEngine.ts` | محرك صيغ (expr-eval) |
| `LazyTabLoader.tsx` | loader للتبويبات الـ lazy |
| `LiquidityRadarView.tsx` | رادار السيولة |
| `MarketSelector.tsx` | مبدّل السوق (EGX/Crypto/Forex) |
| `StockFeelCard.tsx` + `StockSearchSelector.tsx` | بطاقة شعور السهم + بحث |

---

## 5. الطبقة برافو — الباك إند (Backend)

### 5.1 الإحصائيات الكاملة

| المؤشر | القيمة |
|---|---|
| **إجمالي LOC** (Python) | **255,122** سطر عبر **426** ملف |
| **Blueprints معرّفة** | **41** (via `Blueprint()` call في 39 ملف) |
| **Blueprints مسجّلة في lightweight_server.py** | **38** (3 commented out) |
| **FastAPI routers** | **1** (`portfolio_router` من `ai/portfolio_routes.py`) |
| **Analyzers** (top-level) | **117** ملف |
| **Analyzers مع modules** | **131** ملف (مع `analyzer_modules/` + `indicators/`) |
| **Engines** | **14** ملف (top-level) |
| **Core modules** | **18** ملف |
| **Jobs (cron)** | **14** ملف (top-level, بدون `__init__.py`) |
| **Predictor modules** (Strangler) | **8** (`predictor_modules/`) |
| **Closer modules** (Strangler) | **2** (`closer_modules/`) |
| **Analyzer modules** (Strangler) | **5** (`analyzer_modules/`) |

### 5.2 الدخول الرئيسي (Entry Point)

| الملف | الدور |
|---|---|
| `vps-service/main.py` | **FastAPI entry** — يصنع FastAPI app + يركّب Flask WSGI عبر `a2wsgi.WSGIMiddleware` |
| `vps-service/lightweight_server.py` (1,926 LOC) | **Flask app** — يسجّل كل الـ blueprints + يخدم `/api/market-pulse` و `/api/live-monitor` |

**التسلسل:**

```python
# vps-service/main.py
app = FastAPI(
    title="GLM Finance VPS Service",
    description="...",
    version="3.4.43"
)

# Mount Flask app (lightweight_server.py) via a2wsgi
from lightweight_server import app as flask_app
app.mount("/", WSGIMiddleware(flask_app))

# FastAPI routers
app.include_router(portfolio_router)  # from ai.portfolio_routes
```

### 5.3 المحركات الأربعة (4 Engines)

> **المصدر:** `Documentation/04-ENGINES-ARCHITECTURE.md`. كل engine مستقل لكنه يتواصل عبر طبقة الـ DAL.

#### Engine 1 — Job Engine (الـ cron jobs)

**المسار:** `vps-service/jobs/` (14 ملف top-level + 8 + 2 sub-modules)

| الملف | الجدولة | الوظيفة |
|---|---|---|
| `daily_predictor.py` (4,717 LOC) | يومياً 14:30 | توليد توقعات V40.2 (الـ mega file — بعد Strangler -269 LOC) |
| `daily_closer.py` (3,501 LOC) | يومياً 14:35 | إغلاق التوقعات المنتهية + تحديد النتائج |
| `learning_engine.py` | يومياً 16:00 | استخراج الدروس من النتائج + تحديث أوزان المؤشرات |
| `market_scheduler.py` (2,780 LOC) | مستمر | تنسيق دورة السوق اليومية |
| `price_history_safetynet.py` | كل ساعة | backfill بيانات الأسعار المفقودة |
| `price_history_stale_monitor.py` | كل 6 ساعات | كشف البيانات الـ stale |
| `intraday_aggregator.py` | كل ساعة | تجميع 5-min bars → daily |
| `intraday_scanner.py` | كل 5 دقايق | مسح إشارات intraday |
| `hot_candidate_detector.py` | مستمر | كشف hot candidates real-time |
| `fetch_corporate_actions.py` | أسبوعياً | توزيعات + splits |
| `fetch_inflation_worldbank.py` | شهرياً | بيانات التضخم من WorldBank |
| `crypto_lab_scheduler.py` | يومياً | مختبر توقعات الكريبتو |
| `daily_portfolio_yield.py` | يومياً | حساب عائد المحفظة اليومي |
| `wal_checkpoint.py` | يدوي | WAL checkpoint utility |

**Sub-modules (Strangler Pattern):**

| Package | الملفات |
|---|---|
| `jobs/predictor_modules/` (8 modules) | `persona_fit.py`, `whale_guard.py`, `db_helpers.py`, `scan_dates.py`, `cleanup.py`, `summary.py`, `dry_run_printer.py`, `price_cache.py` |
| `jobs/closer_modules/` (2 modules) | `atr_helpers.py`, `pending_helpers.py` |

#### Engine 2 — Analyzer Engine

**المسار:** `vps-service/engines/` (14 ملف) + `vps-service/analyzers/` (117 ملف top-level)

##### Core Engines (4)

| Engine | الملف | السرعة | الـ intent | الوظيفة |
|---|---|---|---|---|
| **V20 Fusion Engine** | `engines/v20_fusion_engine.py` | ~50ms | `live` | تحليل لحظي (intent='live') |
| **V38 Backtest Engine** | `engines/v38_backtest_engine.py` | ~500ms | `full` | باك تست كامل |
| **Master Analyzer** | `engines/master_analyzer.py` (5,764 LOC) | ~150ms | `daily` | تحليل يومي عميق |
| **Decision Router** | `engines/decision_router.py` | <1ms | `auto` | اختيار المحرك حسب الـ intent |

##### Other Engines (10)

| الملف | الوظيفة |
|---|---|
| `crypto_engine.py` | محرك الكريبتو |
| `explosive_scanner.py` | كاشف الانفجارات السعرية |
| `donchian_breakout.py` | Donchian breakout engine |
| `stage2_filter.py` | Stage 2 filter (Weinstein) |
| `paper_trade_tracker.py` | متتبع paper trades |
| `stock_fundamentals.py` | الأساسيات |
| `market_regime.py` | النظام العام للسوق (BULL/BEAR/SIDEWAYS) |
| `historical_backfill_engine.py` | backfill تاريخي |
| `atr_risk_engine.py` | ATR risk engine |
| `take_profit_tiers.py` | طبقات take profit |
| `flow_system.py` | نظام التدفق |
| `persona_engine.py` | محرك الـ personas (investor/gambler/...) |
| `vcp_detector.py` | VCP (Volatility Contraction Pattern) detector |
| `backtest_engine.py` | باك تست موحد |

##### Specialized Analyzers (أهم 30 من 117)

| الـ Analyzer | الوظيفة |
|---|---|
| `master_analyzer.py` (5,764 LOC) | أعقد analyzer — يستدعي 20+ analyzer فرعي |
| `background_analyzer.py` (2,733 LOC) | تحليل في الخلفية |
| `technical.py` | RSI, MACD, MA, ATR, Bollinger |
| `fundamental.py` + `fundamental_enhanced.py` + `fundamental_relative.py` + `fundamental_engine.py` + `fundamental_data_provider.py` + `fundamental_scorer.py` | P/E, ROE, debt, dividend yield |
| `timing.py` | توقيت الدخول/الخروج |
| `patterns.py` | candlestick + chart patterns |
| `fibonacci.py` | retracement + extension |
| `risk.py` + `risk_adaptive.py` | VaR, max drawdown, Sharpe |
| `liquidity_filter.py` | hard gate: minimum volume + turnover |
| `adaptive_weights.py` | persona-based weight table (PERSONA_INPUT_WEIGHTS) |
| `core_scoring_engine.py` | volume surge + accumulation + recovery |
| `prediction_tracker.py` + `enhanced_prediction_tracker.py` | writes/reads predictions table |
| `news_analyzer.py` + `news_fetcher_analyzer.py` + `news_impact_scorer.py` + `news_stop_filter.py` + `crypto_news_fetcher.py` + `live_news_integration.py` + `ai_sentiment.py` | أخبار + sentiment |
| `confluence_engine_v3.py` | multi-factor confluence scoring |
| `decision_logger.py` | سجل قرارات التحليل |
| `unified_learning_engine.py` | محرك التعلّم الموحد |
| `unified_analysis.py` + `unified_maestro.py` | تحليل موحد |
| `v82_analyzer.py` + `v68_oracle.py` | إصدارات التحليل المتقدمة |
| `smc_engine.py` | Smart Money Concepts |
| `volume_profile.py` | Volume Profile + POC |
| `candle_probability_engine.py` | احتمالات الشموع |
| `golden_hunter.py` + `hunting_engine.py` | صياد الفرص الذهبية |
| `bag_holder_rescue.py` | إنقاذ المحافظ الخاسرة |
| `sniper_engine.py` + `sniper_detector.py` | محرك القناص |
| `real_return_engine.py` | العائد الحقيقي (معدّل بالتضخم) |
| `smart_portfolio_monitor.py` | مراقبة المحفظة الذكية |
| `institutional_decision_engine.py` + `institutional_levels.py` | قرار مؤسسي |
| `position_sizing.py` + `position_manager.py` | حساب حجم المركز + إدارته |
| `expert_quality_gate.py` + `crypto_quality_gate.py` + `strict_entry_filters.py` + `strict_entry_gate.py` (في indicators) | بوابات جودة صارمة |
| `board_of_analysts.py` | مجلس المحللين (multi-analyst voting) |
| `persona_screener.py` + `persona_investor.py` + `persona_gambler.py` | تصفية personas |
| `candlestick.py` | patterns شمعية |
| `support_resistance_calculator.py` | حساب الدعم والمقاومة |
| `intraday_reader.py` | قارئ intraday |
| `seasonality_first_engine.py` + `seasonality_scorer.py` | الموسمية |
| `multi_timeframe_engine.py` + `multi_path_detector.py` | multi-timeframe + multi-path |
| `regime_detector.py` + `regime_filter.py` + `hmm_market_regime.py` + `market_regime_engine.py` + `crypto_regime.py` | كشف النظام |
| `feedback_loop.py` | حلقة التغذية الراجعة |
| `stock_dna_analyzer.py` | DNA السهم |
| `confidence_engine.py` + `conviction_engine.py` | الثقة + الإقناع |
| `real_backtester.py` + `backtest_engine.py` | باك تست |
| `crypto_analyzer.py` + `crypto_maestro.py` + `crypto_circuit.py` + `crypto_disclosure_engine.py` + `crypto_strict_filters.py` | تحليل الكريبتو |
| `dynamic_target_engine.py` + `dynamic_context_engine.py` + `technical_target_engine.py` + `technical_weighted.py` | targets ديناميكية |
| `fair_value_calculator.py` | fair value |
| `position_manager.py` + `short_holding_exit.py` | إدارة المركز + exit قصير المدى |
| `trader_levels_engine.py` | مستويات المتداول |
| `egx_disclosure_engine.py` + `egx_stocks_dictionary.py` | إفصاحات EGX + قاموس الأسهم |
| `ticker_cooldown.py` | cooldown للـ ticker (منع التكرار) |
| `expert_memory_bridge.py` | ذاكرة الخبراء |
| `quant_engine.py` + `quant_cache.py` + `quant_overdrive.py` + `nightly_quant_job.py` | quantitative engine |
| `social_card_generator.py` | توليد بطاقات social media |
| `narrative_generator.py` | توليد سرد تحليلي |
| `radar_integration.py` + `screener_integration.py` | تكامل الرادار + screener |
| `production_data_client.py` | عميل بيانات الإنتاج |
| `live_indicator_engine.py` + `enhanced_indicators.py` + `live_news_integration.py` | مؤشرات لحظية |
| `engine_settings.py` | إعدادات المحرك (dynamic) |
| `reports_engine.py` + `market_daily_report.py` | تقارير |
| `unified_maestro.py` | مايسترو موحد (قديم — V40.2 هو الـ sole engine) |
| `scoring_fix.py` + `scoring_fix.py` (analyzer_modules) | إصلاحات الـ scoring |
| `breakout_signal.py` | إشارة breakout |
| `kimi_fixes.py` | إصلاحات Kimi (AI model) |
| `session_timing.py` | توقيت الجلسة |
| `learning_file_storage.py` | تخزين ملفات التعلّم |
| `alert_system.py` | نظام التنبيهات |
| `dividend_checker.py` | فاحص التوزيعات |
| `ai_pattern_analyzer.py` | تحليل patterns بالـ AI |
| `dynamic_context_engine.py` | محرك السياق الديناميكي |
| `technical_explainer.py` | شارح فني |
| `prediction_optimizer.py` | محسّن التوقعات |
| `screener.py` | screener الأساسي |

##### Indicators Sub-package (`analyzers/indicators/` — 9 modules)

مؤشرات canonical (Rule 67 — Pure Functions، NO DB):

| الملف | المؤشرات |
|---|---|
| `ma.py` | Simple/Exponential Moving Averages |
| `rsi.py` | Relative Strength Index (canonical SSOT) |
| `atr.py` | Average True Range |
| `adx.py` | Average Directional Index |
| `srsi.py` | Stochastic RSI |
| `mfi.py` | Money Flow Index |
| `bollinger.py` | Bollinger Bands |
| `vwap.py` | Volume-Weighted Average Price |
| `volume_profile.py` | Volume Profile |
| `flow_indicators.py` | CMF + OBV + POC + cooldown + signal_stage (Flow indicators جديدة) |

##### Analyzer Modules Sub-package (`analyzers/analyzer_modules/` — 5 modules)

| الملف | الوظيفة |
|---|---|
| `screener_helpers.py` (219 LOC) | helpers لـ screener |
| `fibonacci.py` (50 LOC) | fibonacci helpers |
| `candlestick.py` (66 LOC) | candlestick helpers |
| `helpers.py` (52 LOC) | helpers عامة |
| `indicators.py` (67 LOC) | indicators wrappers |

#### Engine 3 — Learning Engine

**المسار:** `vps-service/jobs/learning_engine.py`

**Feedback Loop:**

```
Closed prediction (with outcome)
    │
    ▼
1. Read outcome (win/loss, PnL, R-multiple, exit_reason)
2. Read proofs (which signals fired)
3. Per-indicator performance:
   ├── Update stocks.db.indicator_weights
   ├── Update stocks.db.regime_indicator_weights (per-regime)
   └── Update stocks.db.indicator_trust_scores
4. Extract lessons:
   ├── predictions.db.prediction_lessons
   └── stocks.db.conjunction_patterns
5. Master Analyzer reads new weights on next run → smarter predictions
```

**Learning Tables:**

| DB | Table | الوظيفة |
|---|---|---|
| `stocks.db` | `indicator_weights` | الأوزان الحالية لكل مؤشر |
| `stocks.db` | `regime_indicator_weights` | أوزان حسب النظام (BULL/BEAR/SIDEWAYS) |
| `stocks.db` | `indicator_trust_scores` | درجة ثقة (0-1) لكل مؤشر |
| `stocks.db` | `conjunction_patterns` | أنماط متعددة المؤشرات |
| `stocks.db` | `learned_lessons` | الدروس المستخرجة |
| `predictions.db` | `prediction_lessons` | دروس لكل توقع |
| `predictions.db` | `learned_lessons` | mirror (legacy) |

#### Engine 4 — API Engine

**المسار:** `vps-service/api/` (40 ملف: 39 blueprint + `__init__.py`)

##### الـ Blueprints الـ 38 المسجّلة في `lightweight_server.py`

| # | Blueprint Name | الملف | URL Prefix (تقريبي) | الوظيفة |
|---|---|---|---|---|
| 1 | `chart_bp` | `chart_routes.py` (3,560 LOC) | `/api/chart/*` | بيانات الرسوم البيانية |
| 2 | `stock_analysis_bp` | `stock_analysis_routes.py` | `/api/stock-analysis/*` | تحليل سهم مفرد |
| 3 | `public_bp` | `public_routes.py` | `/api/public/*` | endpoints عامة |
| 4 | `stored_analysis_bp` | `stored_analysis_routes.py` (2,982 LOC) | `/api/stored-analysis/*` | تحليلات مخزّنة |
| 5 | `sector_tracking_bp` | `sector_tracking_routes.py` | `/api/sectors/tracking/*` | تتبع القطاعات (heatmap + rotation) |
| 6 | `advanced_screener_bp` | `advanced_screener_routes.py` | `/api/screener/advanced/*` | screener متقدم (TradingView-style) |
| 7 | `top_performers_bp` | `top_performers_routes.py` | `/api/top-performers/*` | أعلى/أدنى الأسهم في فترات متعددة |
| 8 | `market_bp` (legacy في stored_analysis) | `stored_analysis_routes.py` | `/api/market/morning-bell` | morning bell (top 3 EGX opportunities) |
| 9 | `v2_bp` | `v2_routes.py` | `/api/v2/*` | V2 endpoints |
| 10 | `unified_v2_bp` | `unified_v2_routes.py` | `/api/unified-v2/*` | V2 موحد |
| 11 | `confluence_bp` | `confluence_routes.py` | `/api/confluence/*` | confluence engine |
| 12 | `screener_bp` | `screener_routes.py` | `/api/screener/*` | screener أساسي |
| 13 | `ai_pred_bp` | `ai_predictions_routes.py` | `/api/ai-predictions/*` | AI predictions |
| 14 | `prediction_tracking_bp` | `prediction_tracking_routes.py` (2 endpoints) | `/api/predictions/tracking/*` | تتبع التوقعات |
| 15 | `tracking_bp` | `prediction_tracking_routes.py` (2 endpoints) | `/api/tracking/*` | tracking (legacy alias) |
| 16 | `sniper_bp` | `sniper_routes.py` | `/api/sniper/*` | محرك القناص |
| 17 | `reports_bp` | `reports_routes.py` | `/api/reports/*` | التقارير |
| 18 | `risk_bp` | `risk_routes.py` | `/api/risk/*` | المخاطر |
| 19 | `notebook_bp` | `notebook_routes.py` | `/api/notebook/*` | دفتر ملاحظات السهم |
| 20 | `learning_bp` | `learning_routes.py` | `/api/learning/*` | التعلّم |
| 21 | `unified_learning_bp` | `unified_learning_routes.py` | `/api/unified-learning/*` | تعلّم موحد (25 routes) |
| 22 | `optimizer_params_bp` | `optimizer_params_routes.py` | `/api/prediction-optimizer/*` | محسّن المعاملات |
| 23 | `news_bp` | `news_routes.py` | `/api/news/*` | الأخبار (يستقبل من news-agent) |
| 24 | `telegram_bp` | `telegram_routes.py` | `/api/telegram/*` | Telegram management |
| 25 | `portfolio_bp` | `portfolio_routes.py` (3,207 LOC) | `/api/portfolio/*` | المحفظة |
| 26 | `misc_bp` | `misc_routes.py` (4,194 LOC) | `/api/*` (misc) | misc endpoints |
| 27 | `admin_bp` | `admin_routes.py` (5,133 LOC) | `/api/admin/*` | admin endpoints |
| 28 | `analytics_bp` | `analytics.py` | `/api/analytics/*` | تحليلات |
| 29 | `prof_analysis_bp` | `professional_analysis_routes.py` | `/api/professional-analysis/*` | تحليل احترافي |
| 30 | `stocks_bp` | `stocks.py` | `/api/stocks/*` | الأسهم |
| 31 | `regime_bp` | `regime_routes.py` | `/api/regime/*` | النظام العام |
| 32 | `scanner_bp` | `scanner_routes.py` | `/api/scanner/*` | scanner |
| 33 | `persona_bp` | `persona_routes.py` | `/api/persona/*` | personas |
| 34 | `ai_bp` | `ai_routes.py` | `/api/ai/*` | AI endpoints (premium) |
| 35 | `admin_engine_settings_bp` | `admin_engine_settings_routes.py` | `/api/admin/engine-settings/*` | إعدادات المحرك الديناميكية |
| 36 | `historical_preds_v2_bp` | `historical_predictions_v2_routes.py` | `/api/historical-predictions/v2/*` | مولّد توقعات تاريخية (SSE progress) |
| 37 | `picks_mgmt_bp` | `picks_management_routes.py` | `/api/predictions/daily-picks` + `/api/predictions/active-management` | Picks Management v3.4.43 |
| 38 | `v38_backtest_bp` | `v38_backtest_routes.py` | `/api/v38/backtest/*` | V38 Institutional Decision Backtest |
| 39 | `market_master_bp` | `market_master_endpoints.py` | `/api/market/intraday-pressure` + `/api/market/investor-flows` + `/api/market/metals-forex` + `/api/liquidity-radar` | market master |
| 40 | `market_data_bp` | `market_routes.py` (B2 جديد) | `/api/market/top-movers` | top movers |
| 41 | `notifications_bp` | `notifications_routes.py` (B3 جديد) | `/api/notifications/priority` | priority notifications + IDOR guard |

> **Note:** maestro_bp معطّل (BRAVO-MAESTRO-CANCER-1) — V40.2 هو الـ sole engine.
> **Note:** v4_bp شيل (P0-FIX 2026-09-27) — كان module غير موجود.

##### FastAPI Router إضافي (mounted separately)

| Router | الملف | الوظيفة |
|---|---|---|
| `portfolio_router` | `ai/portfolio_routes.py` | FastAPI native router — mounted مباشرة على `app` (يُطابق أولاً قبل Flask) |

#### Core Modules (`vps-service/core/` — 18 ملف)

| الملف | الوظيفة |
|---|---|
| `db_manager.py` (487 LOC) | **DAL singleton** — `query`/`query_one`/`execute`/`execute_many`/`transaction`/`connection`/`table_exists`/`table_columns`/`ensure_column`/`health_check`/`get_stats`/`reset_stats` |
| `database.py` | legacy DAL (backward compat — في whitelist) |
| `cache_manager.py` | `AnalysisCache` (TTL=60s, per-ticker) + `ApiResponseCache` (TTL=60-300s, per-endpoint, maxsize=256, LRU-by-expiry) |
| `migrator.py` | schema migration tool (في whitelist) |
| `auth_middleware.py` | `require_auth` (JWT ضد auth.db.Session) + `require_admin` (auth.db.User.role) |
| `logging_config.py` | إعداد الـ logging |
| `http_client.py` | HTTP client (requests wrapper) |
| `egypt_scheduler.py` | جدولة بتوقيت القاهرة |
| `scheduler_manager.py` | مدير الجداول |
| `analysis_runner.py` | مشغّل التحليل |
| `persona_db.py` | DB للـ personas |
| `macro_state_engine.py` | macro state engine |
| `opportunity_quality.py` | جودة الفرصة |
| `real_liquidity_radar.py` | رادار السيولة الحقيقي |
| `stock_rescue_engine.py` | محرك إنقاذ السهم الخاسر |
| `sync_scanner_to_db.py` | مزامنة scanner → DB |
| `unified_scanner.py` | scanner موحد |
| `data_source_circuit_breaker.py` | circuit breaker للمصادر |

### 5.4 Data Access Layer (DAL)

> **المصدر:** `core/db_manager.py` (487 LOC — **complete, DO NOT modify**).

#### API Surface

| Method | الوظيفة |
|---|---|
| `db_manager.query(db, sql, params)` | SELECT → list of dicts |
| `db_manager.query_one(db, sql, params)` | SELECT → single dict (or None) |
| `db_manager.execute(db, sql, params)` | INSERT/UPDATE/DELETE → rowcount |
| `db_manager.execute_many(db, sql, params_list)` | batch INSERT/UPDATE |
| `db_manager.transaction(db)` | context manager (BEGIN/COMMIT/ROLLBACK) |
| `db_manager.connection(db, writable=False)` | raw connection context |
| `db_manager.table_exists(db, table)` | bool |
| `db_manager.table_columns(db, table)` | list of column names |
| `db_manager.ensure_column(db, table, column_def)` | safe ALTER |
| `db_manager.health_check(db)` | integrity + journal_mode + page_count |
| `db_manager.get_stats()` | `{reads, writes, errors}` |
| `db_manager.reset_stats()` | zero counters |

#### Connection Settings (auto-applied)

**Writable connections:**
- `PRAGMA journal_mode=WAL`
- `PRAGMA busy_timeout=30000` (30s)
- `PRAGMA synchronous=NORMAL`
- `PRAGMA wal_autocheckpoint=1000`
- `PRAGMA foreign_keys=ON`
- بعد كل write: `PRAGMA wal_checkpoint(PASSIVE)` تلقائياً

**Readonly connections:**
- `mode=ro` (مع `immutable=1` fallback لو WAL/-shm تالف)
- `PRAGMA busy_timeout=30000`
- `PRAGMA query_only=1` (حماية إضافية)

#### Singleton Pattern

`DBManager.__new__` يستخدم **double-checked locking** مع `_instance` + `_instance_lock` — كل engine في كل thread يشارك **نفس الـ instance**. يتم التحقق منه بواسطة `tests/test_architecture.py::test_db_manager_singleton`.

### 5.5 Enforcement Layer (Phase 7.1)

| المكون | المسار | الوظيفة |
|---|---|---|
| `check_architecture.py` (449 LOC) | `scripts/check_architecture.py` | AST-based scanner يكشف `sqlite3.connect()` مباشر (CATEGORY B = VIOLATION) |
| `test_architecture.py` (5 tests) | `vps-service/tests/test_architecture.py` | baseline ratchet (515 + 544 = 1059 violations) |
| `pre-commit` hook | `.git/hooks/pre-commit` | يفحص ملفات `.py` staged فقط — يمنع commit لو فيه violation جديد |
| `architecture-checks.yml` | `.github/workflows/architecture-checks.yml` | CI/CD: تشغيل الـ scanner + tests على كل push/PR |

**Whitelist (5 ملفات مسموح لها بـ `sqlite3.connect` مباشر):**

1. `vps-service/core/db_manager.py` (الـ DAL نفسه)
2. `vps-service/core/database.py` (legacy DAL)
3. `vps-service/lightweight_server.py` (standalone server)
4. `vps-service/core/migrator.py` (schema migration tool)
5. `vps-service/jobs/wal_checkpoint.py` (WAL checkpoint utility)

### 5.6 Caching Layer (Phase 8.4)

**الملف:** `vps-service/core/cache_manager.py`

| Cache | Key | TTL | Backend | الوظيفة |
|---|---|---|---|---|
| `AnalysisCache` | `(ticker_upper, intent_lower, persona_lower)` | 60s | `cachetools.TTLCache` (fallback: dict+timestamps) | per-ticker analysis response |
| `ApiResponseCache` | `endpoint_name\|sorted_params_string` | 60-300s | in-memory dict + threading.Lock (maxsize=256, LRU-by-expiry) | per-endpoint response |

**Endpoints بتستخدم `ApiResponseCache`:**

| Endpoint | TTL | Params |
|---|---|---|
| `/api/market/overview` | 300s | `{market or 'all'}` |
| `/api/market/intraday-pressure` | 60s | None (single cache entry) |
| `/api/market/investor-flows` | 300s | `{market}` |
| `/api/sectors/tracking` | 300s | ALL filter params (market, sort, order, ...) |

كل response يتضمن:
- `cached: true/false` — هل هو cache hit
- `cache_ttl: <seconds>` — TTL للشفافية للعميل

---

## 6. مخطط تدفق البيانات (Data Flow)

### 6.1 التدفق الكامل من المصدر إلى المتصفح

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1 — Data Collection (data_engine :5000)                                 │
│                                                                                │
│  TradingView  ─┐                                                              │
│  Yahoo Finance ─┤                                                              │
│  CoinGecko     ─┤──► data_engine/scrapers/  ──►  db/*.db                       │
│  Mubasher      ─┤                              ├── stocks.db                   │
│  Reuters       ─┤                              ├── intraday.db                │
│  Bloomberg     ─┤                              ├── crypto.db                  │
│  WorldBank     ─┤                              ├── metals.db                  │
│  RSS Feeds     ─┤                              ├── news.db                    │
│  Telegram Ch.  ─┤                              └── predictions.db             │
│  EGX Official  ─┘                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SQLite WAL (shared filesystem)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2 — Analysis (python-backend :8010)                                     │
│                                                                                │
│  Jobs (cron) ──► daily_predictor.py ──► master_analyzer.py                    │
│                       │                          │                            │
│                       │                          ├──► technical.py            │
│                       │                          ├──► fundamental.py          │
│                       │                          ├──► timing.py                │
│                       │                          ├──► patterns.py              │
│                       │                          ├──► risk.py                  │
│                       │                          ├──► 100+ other analyzers     │
│                       │                          └──► writes predictions.db   │
│                       │                                                       │
│                       ├──► learning_engine.py (feedback loop)              │
│                       └──► daily_closer.py (closes predictions)             │
│                                                                                │
│  HTTP API ──► /api/* (Flask blueprints + FastAPI router)                      │
│              ├──► core/db_manager.py (DAL — singleton)                        │
│              ├──► core/cache_manager.py (AnalysisCache + ApiResponseCache)    │
│              └──► JSON response                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/JSON
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3 — Display (nextjs :3000)                                              │
│                                                                                │
│  Browser ──► /socket.io (ws-service push)                                     │
│                                                                                │
│  Browser ──► /api/* (Next.js route handlers — 464 routes)                    │
│              ├──► Direct: Prisma → auth.db / predictions.db                   │
│              ├──► Proxy: 3 routes → http://127.0.0.1:8010/*                  │
│              └──► All other: fetch from Python via EGXPY_SERVICE_URL          │
│                                                                                │
│  page.tsx (SPA shell) ──► useAppStore (zustand) ──► switch(currentView)       │
│                          └──► <View /> ──► useXxxData hook ──► useApiQuery    │
│                                                              └──► fetch()     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 مثال: طلب توقع يومي من المتصفح

```
User clicks "Daily Picks" tab in browser
    │
    ▼
page.tsx → setCurrentView('predictions')
    │
    ▼
<PredictionTrackingDashboard /> (lazy-loaded via dynamicImport)
    │
    ▼
usePredictionTrackingState(market) hook
    │
    ▼
useApiQuery({ queryKey: ['daily-picks', market], queryFn: () =>
    fetch('/api/predictions/daily-picks?market=EGX').then(r => r.json())
})
    │
    ▼
Next.js route handler: src/app/api/predictions/daily-picks/route.ts
    │
    ├──► Internal? NO — هذا proxy route
    │
    ▼
next.config.mjs rewrite: /api/predictions/daily-picks → http://127.0.0.1:8010/api/predictions/daily-picks
    │
    ▼
Flask blueprint: picks_mgmt_bp.picks_management_routes.py
    │
    ▼
DAL: db_manager.query('predictions.db', "SELECT * FROM daily_picks WHERE ...")
    │
    ▼
JSON response → TanStack Query cache → React re-render → UI update
```

### 6.3 مثال: push لحظي لسهم (Real-time)

```
data_engine:5000 finishes polling TradingView
    │
    ▼
data_engine/sync.py POSTs to ws-service:3005/broadcast
    │
    ├──► body: { ticker: 'COMI', price: 18.50, change: 1.2% }
    │
    ▼
ws-service:3005 receives broadcast
    │
    ▼
socket.io.emit('ticker:update', { ticker: 'COMI', price: 18.50, ... })
    │
    ▼
All connected browsers (subscribed to 'COMI') receive event
    │
    ▼
ws-client.ts → useAppStore.updateTicker('COMI', { price: 18.50 })
    │
    ▼
React re-render with new price (NO refetch needed)
```

### 6.4 مثال: دورة التعلّم الذاتي (Self-Learning)

```
Daily 14:35 — daily_closer.py runs
    │
    ▼
For each pending prediction:
    ├──► Read current price from stocks.db
    ├──► Compute outcome (win/loss, PnL, R-multiple)
    ├──► Update predictions.db.predictions SET outcome = ...
    └──► Write to predictions.db.prediction_outcomes
    │
    ▼
Daily 16:00 — learning_engine.py runs
    │
    ▼
For each closed prediction:
    ├──► Read outcome + proofs (which signals fired)
    ├──► For each indicator that fired:
    │       ├──► Update stocks.db.indicator_weights (win rate)
    │       ├──► Update stocks.db.regime_indicator_weights (per regime)
    │       └──► Update stocks.db.indicator_trust_scores
    ├──► Extract lessons → predictions.db.prediction_lessons
    └──► Discover conjunction patterns → stocks.db.conjunction_patterns
    │
    ▼
Next day 14:30 — daily_predictor.py runs
    │
    ▼
master_analyzer.py reads new weights → smarter predictions
```

---

## 7. الجسور الثلاثة (3 Proxy Routes)

> **Rule 20:** الـ 3 proxy routes هي الجسر الوحيد بين Node و Python.

**التكوين:** `next.config.mjs` → `async rewrites()` — يعيد توجيه الطلبات من Next.js إلى Python backend على `http://127.0.0.1:8010`.

| # | Source (Next.js) | Destination (Python) | الوظيفة |
|---|---|---|---|
| 1 | `/api/predictions/daily-picks` | `http://127.0.0.1:8010/api/predictions/daily-picks` | Picks Management — Top 5 daily |
| 2 | `/api/predictions/daily-picks/history` | `http://127.0.0.1:8010/api/predictions/daily-picks/history` | Picks history |
| 3 | `/api/predictions/active-management` | `http://127.0.0.1:8010/api/predictions/active-management` | Position management (HOLD/TRAIL/EXIT) |
| 4 | `/api/predictions/management/refresh` | `http://127.0.0.1:8010/api/predictions/management/refresh` | Refresh picks cache |
| 5 | `/api/predictions/management/health` | `http://127.0.0.1:8010/api/predictions/management/health` | Health check |
| 6 | `/socket.io/:path*` | `http://127.0.0.1:3005/socket.io/:path*` | WebSocket proxy (ws-service) |

> **Note:** V38 Backtest proxy **تمت إزالته** (2026-08-13) — تم دمجه في Maestro unified engine. المنفذ 8011 لم يعد مستخدماً (يسبب 500 errors).

### 7.1 لماذا 3 proxy routes فقط؟

- **الفصل الصارم:** كل المنطق في Python، العرض فقط في Node.
- **حتى الـ 464 API route في Next.js** غالباً ما تكون wrappers بسيطة تـ fetch من Python عبر `EGXPY_SERVICE_URL` (env var = `http://localhost:8010`).
- **الـ proxy routes رسمية** (عبر `rewrites()`) لأنها الأكثر استخداماً وُحاجة performance عالية (no Node.js overhead).

### 7.2 متى يجب أن يُضاف proxy route جديد؟

- عند الحاجة لـ endpoint من Python يستخدمه الفرونت إند بشكل متكرر.
- يجب أن يكون الـ endpoint مستقراً (no breaking changes) لأنه جزء من الـ contract بين Node و Python.
- البديل: استخدم `fetch()` من داخل Next.js route handler مع `EGXPY_SERVICE_URL`.

---

## 8. WebSocket Real-time (ws-service)

### 8.1 الخدمة

| الخاصية | القيمة |
|---|---|
| **الاسم في PM2** | `ws-service` |
| **المنفذ** | 3005 |
| **اللغة** | TypeScript + Bun |
| **الـ interpreter** | Bun (`getBunInterpreter()` — يبحث عن `$BUN_PATH` → `~/.bun/bin/bun` → `bun`) |
| **المسار** | `vps-service/ws-service/index.ts` (622 LOC) |
| **max_memory_restart** | 200M |
| **env** | `VPS_API_URL=http://localhost:8010` |

### 8.2 استراتيجية Hyper Polling (P19)

| الفترة | Poll Interval | السبب |
|---|---|---|
| وقت الجلسة (10:00 → 14:30 Cairo) | **2 ثانية** | Hyper Polling — بيانات لحظية حقيقية |
| خارج الجلسة | 30 ثانية | لا حاجة للـ live updates |
| Live Score وقت الجلسة | **5 ثواني** | بدل 5 دقايق (P19) |
| Live Score خارج الجلسة | 5 دقايق | — |
| Delayed Mode (`DELAYED_DATA_MINUTES>0`) | **15 دقيقة** | البيانات متأخرة 5 دقايق فالـ polling السريع بلا فائدة (P41) |

**أيام تداول EGX:** الأحد → الخميس (Sun=0 … Thu=4).
**وقت الجلسة:** 10:00 → 14:30 بتوقيت القاهرة.

### 8.3 الأحداث (Events)

#### أحداث يـ pushها الـ ws-service للعملاء:

| Event | متى | البيانات |
|---|---|---|
| `market:update` | تحديث جماعي لأسعار الأسهم | `{ tickers: [...], timestamp }` |
| `market:snapshot` | لقطة كاملة للسوق | `{ market_state, gainers, losers, ... }` |
| `market:status` | حالة السوق (مفتوح/مقفل + gainers/losers) | `{ is_open, gainers_count, losers_count }` |
| `stock:alert` | تنبيه لسهم معين (ارتفاع/انخفاض) | `{ ticker, alert_type, value }` |
| `ticker:update` | تحديث لسهم واحد (Hyper Polling: 2s وقت الجلسة) | `{ ticker, price, change, volume }` |
| `ticker:live` | تحديث Live Score/مؤشرات (5s وقت الجلسة، أو 15min لو delayed) | `{ ticker, live_score, indicators }` |

#### أحداث يستقبلها من العميل:

| Event | الوظيفة |
|---|---|
| `subscribe:ticker` | اشتراك في سهم معين |
| `unsubscribe:ticker` | إلغاء اشتراك |
| `getMarketOverview` | طلب لحظة سوقية |

### 8.4 مصادر البيانات

1. **Polling:** كل 2-30s (حسب الجلسة) يسحب من `http://localhost:8010/api/market-pulse` + endpoints أخرى.
2. **Broadcast Push:** `data_engine/sync.py` يـ POST على `ws-service:3005/broadcast` بعد كل sync — لـ push فوري من غير انتظار poll جاي.

### 8.5 Paywall Throttling (PAYWALL-043)

| Tier | Ticker Update Interval |
|---|---|
| Premium | 5 ثواني |
| Free | 15 ثانية |

### 8.6 العميل (Frontend Client)

**الملف:** `src/lib/ws-client.ts`

```ts
// pseudo-code
const socket = io({
  path: '/socket.io',           // proxied to :3005 via next.config.mjs
  transports: ['websocket'],
});

socket.on('ticker:update', (data) => {
  useAppStore.getState().updateTicker(data.ticker, data);
});
```

### 8.7 telegram-events service (منفصل)

| الخاصية | القيمة |
|---|---|
| **الاسم في PM2** | `telegram-events` |
| **المنفذ** | 3003 |
| **اللغة** | TypeScript + Bun |
| **المسار** | `telegram-events/index.ts` |
| **env** | `PORT=3003`, `PYTHON_BACKEND_URL=http://127.0.0.1:8010` |
| **العميل** | `src/modules/admin/components/telegram-tab/TelegramTab.tsx` (يتصل عبر `?XTransformPort=3003`) |

**الوظيفة:** Socket.io relay service لأحداث Telegram اللحظية (messages، members، chat updates). يتم قراءته من admin TelegramTab.

---

## 9. نظام المصادقة (Auth System)

### 9.1 المكونات

| المكون | الملف | الوظيفة |
|---|---|---|
| **NextAuth.js** | `src/app/api/auth/[...nextauth]/route.ts` | NextAuth v4.24.11 — JWT strategy |
| **Prisma Auth Client** | `prisma/auth-schema.prisma` + `@prisma/auth-client` | SQLite `auth.db` |
| **Prisma Predictions Client** | `prisma/predictions-schema.prisma` + `@prisma/predictions-client` | SQLite `predictions.db` (لكن أغلب الاستخدام عبر Python) |
| **Auth Helper** | `src/lib/auth-helper.ts` | JWT verification (NextAuth + Bearer for mobile) |
| **Admin Auth** | `src/lib/admin-auth.ts` + `admin-auth-server.ts` + `admin-guard.ts` + `admin-identities.ts` | مصادقة الأدمن (Bearer token + role check) |
| **DB Auth** | `src/lib/db-auth.ts` | Prisma auth DB access wrapper |
| **Subscription Gate** | `src/lib/subscription-gate.ts` | TIER_LIMITS + helpers (client-side) |
| **Subscription Enforcement** | `src/lib/subscription-enforcement.ts` | Server-side free-tier limit enforcement |
| **Trial Abuse Guard** | `src/lib/trial-abuse-guard.ts` | منع إساءة الـ trial |

### 9.2 الـ Subscription Tiers (10 tiers)

> **المصدر:** `src/lib/subscription-gate.ts` → `TIER_LIMITS`

| Tier | max_watchlist | max_portfolio | max_alerts | ai_analysis | deep_analysis | export_data | priority_support | السعر (EGP/شهر) |
|---|---|---|---|---|---|---|---|---|
| `free` | 3 | 1 | 1 | ❌ | ❌ | ❌ | ❌ | 0 |
| `normal` (legacy) | 25 | 3 | 15 | ✅ | ❌ | ❌ | ❌ | 199 |
| `premium` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | 299 |
| `pro` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | (custom) |
| `b2b_starter` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | (custom) |
| `b2b_pro` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | (custom) |
| `b2b_enterprise` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | (custom) |
| `developer` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | 599 |
| `admin` | 9999 | 9999 | 9999 | ✅ | ✅ | ✅ | ✅ | — |

**`PAID_TIERS` (Rule: SINGLE SOURCE OF TRUTH):** `Set<'normal' | 'premium' | 'pro' | 'b2b_starter' | 'b2b_pro' | 'b2b_enterprise' | 'developer' | 'admin'>`.

> **Note:** `b2b_starter` تم حذفه كـ tier فعلي (Rule 50) — بقايا مستخدميه تم تخفيضهم لـ `free`، لكن الـ tier ما زال مذكوراً للتوافق مع البيانات القديمة.

### 9.3 الـ Plans (4 plans for pricing UI)

> **المصدر:** `src/lib/plans.ts`

| Plan ID | Name (Ar) | Price | Price Yearly | مميزات |
|---|---|---|---|---|
| `free` | الأساسية | 0 EGP | 0 EGP | 5 watchlist + 1 portfolio + 3 alerts + تحليلات أساسية |
| `normal` | الاحترافية | 199 EGP | 1990 EGP | 25 watchlist + 5 portfolios + 15 alerts + تحليل متقدم |
| `premium` | المتقدمة | 299 EGP | 2990 EGP | unlimited everything + API access |
| `developer` | المطورين | 599 EGP | 5990 EGP | كل ميزات Premium + API + Webhooks + SDK |

### 9.4 AI Daily Limits

> **المصدر:** `src/lib/subscription-gate.ts` → `AI_DAILY_LIMITS`

| Tier | Daily AI messages |
|---|---|
| `free` | 3 |
| `normal` | 9999 |
| `premium` | 9999 |
| `pro` | 9999 |
| `b2b_starter` | 9999 |
| `b2b_pro` | 9999 |
| `b2b_enterprise` | 9999 |
| `developer` | 9999 |

### 9.5 Trial System

**`checkTrialNotExpired()` في `src/lib/subscription-gate.ts`:**

```
IF user is on PAID_TIERS AND has active subscription:
    RETURN ok = true (paid users bypass trial check)
ELSE:
    IF trial_ends_at is in the past:
        RETURN { ok: false, status: 'TRIAL_EXPIRED', upgradeUrl: '/pricing' }
    ELSE:
        RETURN ok = true
```

**`isPaidSubscriptionActive()`:**
- يقرأ `UserSubscription.expires_at` من auth.db
- لو `expires_at` فارغ ← assume lifetime subscription
- لو منتهي ← false (حتى لو `subscription_tier` هو `premium`)

### 9.6 Guest Mode

| المتغير | الموقع | الوظيفة |
|---|---|---|
| `isGuestUser` | `useAppStore` (zustand) | هل المستخدم ضيف؟ |
| `isViewAllowedForGuest(view)` | `src/lib/subscription-gate.ts` | هل يسمح للضيف برؤية هذا الـ view؟ |

الـ Guest Mode يسمح بتصفح محدود دون تسجيل دخول — يستخدم لـ demo + acquisition.

### 9.7 Backend Auth (Python)

| المكون | الملف | الوظيفة |
|---|---|---|
| `auth_middleware.py` | `vps-service/core/auth_middleware.py` | `require_auth` (JWT ضد auth.db.Session) + `require_admin` (auth.db.User.role) |
| `audit_api_auth.py` (Phase 9.2) | `vps-service/scripts/audit_api_auth.py` (218 LOC) | يفحص 443 routes عبر 29 API files — يصنّفها (Public / User / User+Admin / SENSITIVE_NO_AUTH) |
| `test_api_integration.py` (Phase 9.3) | `vps-service/tests/test_api_integration.py` (181 LOC, 13 tests) | DB consistency (6) + Market endpoints (3) + Protected endpoints (2) + Response shapes (2) |

**نتائج Phase 9.2 Auth Audit:**
- **Public:** 200 routes
- **User:** 39 routes
- **User/Admin:** 46 routes
- **SENSITIVE_NO_AUTH:** 158 routes (HIGH RISK — under remediation)

---

## 10. Phase 3 — Modularization Summary

### 10.1 نظرة عامة

**Phase 3** هو أكبر عملية modularization في تاريخ المشروع — تطبيق **Strangler Pattern** لتفكيك الـ mega files إلى modules صغيرة قابلة للصيانة.

### 10.2 الإحصائيات

| المؤشر | القيمة |
|---|---|
| **Mega files تم تفكيكها** | **23** (وصلت إلى 1000+ LOC) |
| **Hooks تم استخراجها** | **19** (في `src/hooks/`) — منهم 8 من F-Strangler series |
| **Unified components في `ui/`** | **35** (32 ملف + 3 widget re-exports) |
| **Backend modules مستخرجة** | **15** (8 predictor + 5 analyzer + 2 closer) |
| **LOC تم تخفيضه من mega files** | ~3,500+ LOC |
| **Total LOC (frontend)** | 328,956 |
| **Total LOC (backend)** | 255,122 |

### 10.3 الفصول الفرعية لـ Phase 3

#### Phase 0 — Foundation (P0-COMPONENT-UNIFICATION)

| الناتج | الملفات |
|---|---|
| **7 canonical lib files** | `modules/market-analysis/lib/{sector-map, lifecycle, signals}.ts` + `lib/{market-constants, sector-constants, persona-config}.ts` |
| **3 hooks أساسية** | `hooks/{use-api-query, use-pagination, use-debounce}.ts` |
| **QueryClientProvider wired** | `components/Providers.tsx` (TanStack Query v5.82.0 كان مثبّت ولكن غير مستخدم) |

#### Phase 1 — Unified Components (P0-COMPONENT-UNIFICATION Phase 1)

| الناتج | العدد |
|---|---|
| **NEW components** | 10 (LifecycleBadge, StatusBadge, UnifiedPagination, Skeleton×4, AsyncBoundary, ChangePill, PriceText, SeverityBadge, ConfidenceMeter, PersonaEmptyState) |
| **Refactored components** | 1 (SignalBadge — باستخدام canonical `lib/signals.ts`) |
| **Barrel updated** | `src/components/shared/ui/index.ts` (يصدر كل الـ 11 components) |

#### Phase 2 — Codemod Migrations (P0-COMPONENT-UNIFICATION Phase 2)

| الـ migration | الحالة | الإحصائيات |
|---|---|---|
| **2.6 PALETTE_MIGRATION** | ✅ DONE | 301 replacements في 22 ملف — 0 raw palette في HTML |
| **2.4 Pagination** | partial (4/7) | PersonaTab + LiquidityRadarView + HistoricalTradesTable + ShariaView |
| **2.2 Empty states** | partial (7/36+) | SectorTrackingTab + SmartTip + TopUpRecommendations + ExpertIntelligencePanel + MarketStatusTab + InvestorsFlowPanel ×2 |
| **2.7 fmtPrice** | partial (5/16+) | MarketDepthLiquidityWidget + LiquidityRadarView + PaperTradingWorkstation + ExitRadarTab + WeeklyReportTab |
| **2.3 Skeletons** | deferred | 377 inline patterns — per-file analysis |
| **2.5 useApiQuery** | deferred | 268 manual useEffect+fetch patterns |
| **2.1 Tables** | deferred | 44+ inline tables |

#### Phase 3.1 — page.tsx renderView Simplification

**التغيير:** 8 `crypto-*` cases تـ fallthrough إلى نفس الـ component بتاع الـ non-crypto counterpart.

```
case 'crypto-live':           → falls through to 'live'
case 'crypto-recommendations': → falls through to 'recommendations'
case 'crypto-trading-chart':  → falls through to 'trading-chart'
case 'crypto-screener':       → falls through to 'stock-filters'
case 'crypto-watchlist':       → falls through to 'watchlist'
case 'crypto-simulation':     → falls through to 'simulation'
case 'crypto-learning':       → falls through to 'academy'
```

3 cases تبقى منفصلة (components مختلفة):
- `crypto-portfolio` → `<CryptoPortfolioView />`
- `crypto-analysis` → `<SmartConfluenceView />`
- `crypto-prediction-tracking` → `<CryptoPredictionTrackingView />`

**LOC saved:** ~20 LOC.

#### F-Strangler-* Series (Backend Strangler Pattern)

سلسلة من 8 عمليات استخراج data-fetching logic من mega files إلى hooks:

| Task ID | الملف الأصلي | LOC قبل | hook المستخرج | LOC الـ hook |
|---|---|---|---|---|
| F-Strangler-Specialist | `SpecialistAnalysisView.tsx` | 2,916 | `useSpecialistAnalysisData.ts` | 565 |
| F-Strangler-DBManager | `DatabaseManagerFull.tsx` | 3,291 | `useDatabaseManagerData.ts` | — |
| F-Strangler-Screener | `StockScreenerAdvanced.tsx` | 2,723 | `useScreenerData.ts` | — |
| F-Strangler-PersonaTab | `PersonaTab.tsx` | 2,676 | `usePersonaTabData.ts` | — |
| F-Strangler-AcademyView | `AcademyView.tsx` | 2,483 | `useAcademyData.ts` | — |
| F-Strangler-EngineControlRoom | `EngineControlRoomTab.tsx` | 2,481 | `useEngineControlRoomData.ts` | — |
| F-Strangler-StocksView | `StocksView.tsx` | 2,316 | `useStocksViewData.ts` | — |
| F-Strangler-LearningVisuals | `LearningVisuals.tsx` | 2,621 | **SKIPPED** (لا يمكن تطبيق Strangler — dependencies معقدة) | — |

#### F-Phase3-Split-* Series (Folder splits)

| Task ID | الملف الأصلي | LOC قبل | المجلد الجديد | LOC بعد |
|---|---|---|---|---|
| F-Phase3-Split-Admin | `AdminView.tsx` | 2,105 | `admin-view/` (10 ملفات) | shim 28 LOC + container 458 LOC |
| F-Phase3-Split-Predictions | `PredictionTrackingDashboard.tsx` | 2,098 | `prediction-dashboard/` (14 ملف) | shim 30 LOC + container 152 LOC |
| F-Phase3-Split-StocksView | `StocksView.tsx` | — | `stocks-view/` (13 ملف) | — |
| F-Phase3-Split-TelegramTab | `TelegramTab.tsx` | 2,200 | `telegram-tab/` (12 ملف) | container 225 LOC |
| F-Phase3-Split-Simulation | `SimulationView.tsx` | 2,130 | `simulation-view/` (10 ملفات) | container 324 LOC |
| F-Phase3-Split-StrategySandbox | `StrategySandbox.tsx` | 2,188 | `strategy-sandbox/` (10 ملفات) | container 247 LOC |
| F-Phase3-Split-AcademyEncyclopedia | `AcademyEncyclopedia.tsx` | 2,054 | `academy-encyclopedia/` (10 ملفات) | — |
| F-Phase3-Split-ExecutiveReport | `ExecutiveReportView.tsx` | 2,087 | `executive-report/` (11 ملف) | — |
| F-Phase3-Split-Persona | `PersonaTab.tsx` | 2,676 | `persona/` (8 ملفات) | — |
| F-Phase3-Split-MakerRadar | `MakerRadarTab.tsx` | 3,763 | `maker-radar/` (8 ملفات) | — |
| F-Phase3-Split-Screener | `StockScreenerAdvanced.tsx` | 2,723 | `screener-advanced/` (12 ملف) | — |
| F-Phase3-Split-Sharia | `ShariaView.tsx` | — | `sharia-view/` (8 ملفات) | — |
| F-Phase3-Split-EnhancedPortfolio | `EnhancedPortfolioView.tsx` | 3,281 | `enhanced-portfolio/` (8 ملفات) | — |
| F-Phase3-Split-DBManager | `DatabaseManagerFull.tsx` | 3,291 | `db-manager/` (12 ملف) | — |
| F-Phase3-Split-EngineControl | `EngineControlRoomTab.tsx` | 2,481 | `engine-control/` (7 ملفات) | — |
| F-Phase3-Split-SuperLearning | `SuperLearningSystem.tsx` | 2,489 | `super-learning/` (8 ملفات) | — |
| F-Phase3-Split-SingleStock | `SingleStockAnalysisView.tsx` | — | `single-stock/` (7 ملفات) | — |
| F-Phase3-Split-ExpertRecs | `ExpertRecommendationsPanel.tsx` | — | `expert-recommendations/` (5 ملفات) | — |
| F-Phase3-Split-TradingViewChart | `TradingViewChart.tsx` | — | `trading-view-chart/` (5 ملفات) | — |
| F-Phase3-Split-StockDetail | `StockDetail.tsx` | — | `stock-detail/` (4 ملفات) | — |
| F-Phase3-Split-TradeResults | `TradeResultsGenerator.tsx` | — | `trade-templates/` (5 ملفات) | — |
| F-Phase3-Split-PaperTrading | `PaperTradingWorkstation.tsx` | — | `paper-trading-ws/` (7 ملفات) | — |
| F-Phase3-Split-LearningVisuals | `LearningVisuals.tsx` | 2,621 | `learning-visuals/` (3 ملفات) | — |
| F-Strangler-DBManager (also split) | `DatabaseManagerFull.tsx` | — | `db-manager/` (12 ملف) | — |

#### Phase 3 Adoption Batches (1-4)

سلسلة من 4 batches لتبني `WidgetCard` + `WidgetStatGrid` في dashboard widgets:

| Batch | الملفات | التغيير |
|---|---|---|
| **Batch 1** | MarketSummary + TopMovers + IndexCards + MarketSentiment | manual `<Card>` → `<WidgetCard>` + `<WidgetStatGrid>` |
| **Batch 2** | (4 widgets أخرى) | نفس النمط |
| **Batch 3** | (4 widgets أخرى) | نفس النمط |
| **Batch 4** | (4 widgets أخرى) | نفس النمط |

### 10.4 Backend Modularization (Phase 9 Final)

| Package | عدد الملفات | الملفات |
|---|---|---|
| `predictor_modules/` (Phase 7.2 + 8.2) | 8 | persona_fit, whale_guard, db_helpers, scan_dates, cleanup, summary, dry_run_printer, price_cache |
| `analyzer_modules/` (Phase 9.1) | 5 | screener_helpers (219 LOC), fibonacci (50 LOC), candlestick (66 LOC), helpers (52 LOC), indicators (67 LOC) |
| `closer_modules/` (Phase 9.1) | 2 | atr_helpers (53 LOC), pending_helpers (53 LOC) |

**التأثير التراكمي:**

| Metric | قبل Phase 7.2 | بعد Phase 8.2 | التغيير |
|---|---|---|---|
| `daily_predictor.py` LOC | 4,986 | 4,717 | -269 (-5.4%) |
| # of predictor_modules | 0 | 8 | +8 |
| Modularization degree | 0% | ~7% (of mega-file) | +7% |

### 10.5 مبدأ Strangler Pattern المُتّبع

1. **Semantic equivalence:** كل function مستخرجة تُنسخ VERBATIM.
2. **Re-import at top of mega-file:** الـ callers لا يرون تغيير في الـ behavior.
3. **Original definitions removed:** لا تكرار للكود.
4. **Stub markers preserved:** الـ line offsets محفوظة تقريباً لـ git blame.
5. **Path setup moved BEFORE imports:** ضروري لأن `db_helpers.py` يستورد من `core.db_manager` (يتطلب `vps-service/` على `sys.path`).

### 10.6 نتائج Phase 9 النهائية

| الاختبار | النتيجة |
|---|---|
| Architecture check (CATEGORY B violations) | 0 ✅ |
| Architecture tests | 5/5 PASS ✅ |
| predictor_modules tests | 24/24 PASS ✅ |
| **Total** | **29/29 PASS ✅** |

**Backend Status: 100% Ready for Production Merge ✅**

---

## 11. Performance Notes

### 11.1 Build Configuration (`next.config.mjs`)

| الإعداد | القيمة | السبب |
|---|---|---|
| `typescript.ignoreBuildErrors` | `true` | تجاهل TS errors أثناء build (1672 pre-existing errors في `archive/`) |
| `eslint.ignoreDuringBuilds` | `true` | تجاهل ESLint errors أثناء build |
| `reactStrictMode` | `false` | تعطيل strict mode في production |
| `staticPageGenerationTimeout` | 300 (5 min) | زيادة timeout لتوليد الصفحات على VPS بطيء |
| `experimental.cpus` | 1 | تقييد الـ build worker إلى CPU واحد |
| `experimental.optimizePackageImports` | (24 package) | tree-shaking أفضل لـ lucide-react + @radix-ui/* + recharts + framer-motion |

### 11.2 `serverExternalPackages` (Next 16)

> **FIX (Next 16):** `serverComponentsExternalPackages` تم نقله من `experimental` إلى top-level `serverExternalPackages`.

هذه الـ packages **native Node modules** + **Prisma clients** لازم **لا** تـ bundled للـ browser:

```js
serverExternalPackages: [
  "better-sqlite3",        // native C++ addon
  "sql.js",                // WASM module
  "@prisma/client",       // main Prisma client
  "@prisma/auth-client",  // auth DB client
  "@prisma/predictions-client",  // predictions DB client
]
```

**بدون هذا:** Turbopack يحاول bundling → `ReferenceError: module is not defined` في الـ browser.

### 11.3 Static Generation Disabled

كل الـ routes مع `dynamic = 'force-dynamic'` (global default في `next.config.mjs`):

- السبب: build كان يـ crash مع SIGSEGV أثناء `Generating static pages (0/64)` بسبب heavy modules.
- آمن لأن كل الـ pages `'use client'` أصلاً (تـ render في الـ browser).
- لا فائدة SEO من static generation (الـ pages محتاجة JS).

### 11.4 Output File Tracing

| الإعداد | القيمة |
|---|---|
| `outputFileTracingRoot` | `__dirname` (project root) |
| `outputFileTracingExcludes["*"]` | `**/*.db`, `**/*.db-wal`, `**/*.db-shm`, `**/*.db-journal`, `**/*.zip`, `./vps-service/data/egksco/*.pdf`, `./node_modules/pm2/**/*`, `./node_modules/playwright/**/*` |

يمنع تتبّع ملفات الـ DB الثقيلة في `node_modules` أثناء build.

### 11.5 Webpack Alias

```js
config.resolve.alias["@"] = path.resolve(__dirname, "src");
```

يسمح بـ imports مثل `@/lib/utils` بدلاً من `../../../lib/utils`.

### 11.6 Caching Headers

```js
headers() → {
  source: "/_next/static/:path*",
  headers: [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }]
}
```

Static assets تـ cache لساعة في الـ browser.

### 11.7 Code Splitting

- **Route-level:** كل `view` في `switch(currentView)` يـ dynamic-import بـ `ssr: false`.
- **Module-level:** كل مجلد في `src/modules/<feature>/` له `index.ts` barrel — يسهل tree-shaking.
- **Component-level:** `withErrorBoundary(...)` يلف كل view بـ ErrorBoundary منع crash cascade.

### 11.8 Production Memory Limits

| الخدمة | max_memory_restart | node_args |
|---|---|---|
| `nextjs` | 1500M | `--max-old-space-size=2048 --no-warnings` |
| `python-backend` | 500M | — |
| `data-engine` | 500M | — |
| `ws-service` | 200M | — |
| `telegram-poster` | 300M | — |
| `telegram-interactive-bot` | 300M | — |
| `telegram-events` | 150M | — |
| `news-agent` | 300M | — |

### 11.9 Threading Limits (VPS Optimization)

```bash
UV_THREADPOOL_SIZE=2      # libuv thread pool
SWC_THREADPOOL=1          # SWC compiler threads
RAYON_NUM_THREADS=1       # better-sqlite3 native threads
```

يمنع الـ thread contention على VPS محدود الـ CPUs.

### 11.10 Backend Performance

#### SQLite WAL Mode

- كل الـ DBs تعمل بـ WAL (Write-Ahead Logging) — يسمح بـ concurrent reads مع writes.
- `PRAGMA busy_timeout=30000` (30s) — يمنع `SQLITE_BUSY` errors.
- `PRAGMA synchronous=NORMAL` — توازن بين الأداء والأمان.
- `PRAGMA wal_autocheckpoint=1000` — checkpoint تلقائي كل 1000 pages.
- بعد كل write: `PRAGMA wal_checkpoint(PASSIVE)` تلقائياً.

#### Readonly Connections

- `mode=ro` مع `immutable=1` fallback لو WAL/-shm تالف — حماية ضد الـ corruption.
- `PRAGMA query_only=1` — حماية إضافية ضد الكتابة العرضية.

#### Cache Layer

- `AnalysisCache` (TTL=60s, per-ticker) — يخفف الحمل على master_analyzer.py.
- `ApiResponseCache` (TTL=60-300s, per-endpoint, LRU-by-expiry, maxsize=256) — يخفف الحمل على الـ endpoints الثقيلة.

### 11.11 Frontend Performance

#### TanStack Query (React Query v5.82.0)

- **`QueryClientProvider`** موصول في `components/Providers.tsx` (Phase 0).
- **`useApiQuery` hook** (Phase 0) — wrapper قياسي يحل 268 manual useEffect+fetch pattern.
- **`useLiveApiQuery`** — polling تلقائي.
- **`useConditionalApiQuery`** — conditional fetching بناءً على state.

#### Zustand (State Management)

- `useAppStore` في `src/lib/store.ts` (Zustand v5.0.6).
- Store مقسّم إلى slices في `src/lib/store-modules/` (5 ملفات: actions, types, helpers, store-helpers, constants).

#### Hyper Polling (ws-service)

- 2 ثانية وقت الجلسة (بدل 5-30 ثانية) — تحديثات لحظية حقيقية.
- 15 دقيقة في delayed mode — منع إغراق المستخدم بإشارات متأخرة.

---

## 12. قواعد معمارية حاكمة

### 12.1 القواعد الرئيسية

| Rule | الوصف | الإنفاذ |
|---|---|---|
| **Rule 4 (NO-DELETION)** | ممنوع حذف ملفات الـ deprecated (يُسمح بـ redirect + 410 Gone) | Code review |
| **Rule 5 (NO-HARDCODED-SECRETS)** | ممنوع hardcoded credentials في الـ repo | SECURITY-P0 audit |
| **Rule 16 (VERIFY-BEFORE-DELETE)** | الـ functions المعطّلة تـترك كـ dead code | cleanup.py preserves dead code |
| **Rule 20 (Python=Brain)** | Next.js = العرض، Python = العقل | Code review |
| **Rule 27 (NO-FAKE-DATA)** | ممنوع اختراع أرقام | Code review |
| **Rule 30 (COLOR-PALETTE)** | Emerald + Amber + Cyan فقط (ممنوع أزرق/indigo) | PALETTE_MIGRATION codemod (301 replacements) |
| **Rule 35 (ENGINE-UNIFY)** | V40.2 هو الـ sole predictor | `delete_old_v40_predictions()` معطّل |
| **Rule 50 (B2B-CONSOLIDATION)** | b2b_starter تم حذفه، users تم تخفيضهم لـ free | subscription-gate.ts |
| **Rule 67 (CANONICAL-INDICATORS)** | 13 canonical indicators كـ Pure Functions | analyzers/indicators/ SSOT |
| **Rule 73 (SINGLE-DISPLAY-SOURCE)** | كل UI component جديد في `shared/ui/` | Code review |
| **Rule 75 (COMMIT-PUSH)** | commit + push فوري بعد verification | Manual enforcement |
| **Rule 76 (GIT-REBASE)** | `git pull --rebase` قبل كل push | Manual enforcement |
| **DAL-only** | ممنوع `sqlite3.connect()` مباشر (إلا 5 whitelist) | check_architecture.py + pre-commit hook |
| **WAL on writes** | كل write connection يضع WAL + busy_timeout | db_manager.py auto-sets |
| **Readonly safety** | reads بـ `mode=ro` + `immutable=1` fallback | db_manager.py auto-sets |
| **is_active filter** | كل reads من `stocks` تـ filter `is_active=1` | EGX gate + code review |
| **Pre-commit hook** | يمنع commit لو أي staged .py فيه violation جديد | .git/hooks/pre-commit |
| **Singleton DAL** | كل engines تشارك ONE DBManager instance | tests/test_architecture.py |

### 12.2 Backend Architecture Status

> **المصدر:** `Documentation/BACKEND-ARCHITECTURE-AUDIT.md` (2026-10-23)

| المؤشر | القيمة |
|---|---|
| إجمالي ملفات Python | 426 |
| إجمالي الأسطر (LOC) | 248,347 (قبل Phase 9) → 255,122 (بعد Phase 9) |
| Blueprints معرّفة | 41 |
| Blueprints مسجّلة | 38 |
| ملفات بتستخدم `db_manager` (صح) | 36 |
| ملفات بتستخدم `sqlite3.connect` مباشر (violation) | 240 → baseline ratchet (515+544=1059) |
| ملفات فيها logging | 122 |
| ملفات بدون logging | 297 |
| ملفات فاضية (`__init__.py` = 0 lines) | 7 |

### 12.3 Top 10 Largest Backend Files (Complexity Hotspots)

| File | LOC |
|---|---|
| `analyzers/master_analyzer.py` | 5,764 |
| `api/admin_routes.py` | 5,133 |
| `jobs/daily_predictor.py` | 4,986 → 4,717 (بعد Phase 8.2) |
| `api/misc_routes.py` | 4,194 |
| `api/chart_routes.py` | 3,560 |
| `jobs/daily_closer.py` | 3,501 |
| `api/portfolio_routes.py` | 3,207 |
| `api/stored_analysis_routes.py` | 2,982 |
| `jobs/market_scheduler.py` | 2,780 |
| `analyzers/background_analyzer.py` | 2,733 |

---

## 13. مصفوفة الملفات الرئيسية (Key Files Matrix)

### 13.1 Frontend — Configuration

| الملف | الوظيفة |
|---|---|
| `package.json` | dependencies + scripts (v3.4.43) |
| `next.config.mjs` | Next 16 config (serverExternalPackages + rewrites + experimental) |
| `ecosystem.config.js` | PM2 config (7 services + .env loader + Bun/Node resolvers) |
| `tsconfig.json` | TypeScript config |
| `tailwind.config.ts` | Tailwind v3 config |
| `prisma/auth-schema.prisma` | Auth DB schema |
| `prisma/predictions-schema.prisma` | Predictions DB schema |
| `prisma/schema.prisma` | Main DB schema (legacy) |

### 13.2 Frontend — Core

| الملف | الوظيفة |
|---|---|
| `src/app/page.tsx` | SPA shell (switch currentView) |
| `src/app/layout.tsx` | Root layout (RTL + Arabic + fonts) |
| `src/lib/store.ts` | Zustand store |
| `src/lib/store-modules/` | Store slices (5 ملفات) |
| `src/lib/valid-views.ts` | قائمة الـ 50 view المسموح بيها |
| `src/lib/subscription-gate.ts` | TIER_LIMITS + PAID_TIERS + trial check |
| `src/lib/auth-helper.ts` | JWT verification (NextAuth + Bearer) |
| `src/lib/api-client.ts` | Python API client |
| `src/lib/ws-client.ts` | Socket.io client |
| `src/lib/format.ts` | canonical `formatPrice()` + helpers |
| `src/components/Providers.tsx` | QueryClientProvider + Theme + Sonner |
| `src/components/shared/ui/index.ts` | Barrel للـ 35 unified components |

### 13.3 Backend — Entry & Config

| الملف | الوظيفة |
|---|---|
| `vps-service/main.py` | FastAPI entry + WSGIMiddleware mount |
| `vps-service/lightweight_server.py` (1,926 LOC) | Flask app + 38 blueprint registrations |
| `vps-service/requirements.txt` | Python dependencies |
| `vps-service/.env` | secrets (TELEGRAM, EODHD, etc.) |

### 13.4 Backend — Core Engine

| الملف | LOC | الوظيفة |
|---|---|---|
| `vps-service/core/db_manager.py` | 487 | DAL singleton |
| `vps-service/core/cache_manager.py` | — | AnalysisCache + ApiResponseCache |
| `vps-service/core/auth_middleware.py` | — | JWT + role check |
| `vps-service/core/database.py` | — | legacy DAL (backward compat) |
| `vps-service/core/migrator.py` | — | schema migration tool |

### 13.5 Backend — Engines

| الملف | LOC | الوظيفة |
|---|---|---|
| `vps-service/engines/master_analyzer.py` | 5,764 | أعقد analyzer |
| `vps-service/engines/v20_fusion_engine.py` | — | live analysis (~50ms) |
| `vps-service/engines/v38_backtest_engine.py` | — | backtest (~500ms) |
| `vps-service/engines/decision_router.py` | — | engine picker (<1ms) |
| `vps-service/engines/persona_engine.py` | — | personas |

### 13.6 Backend — Jobs

| الملف | LOC | الجدولة |
|---|---|---|
| `vps-service/jobs/daily_predictor.py` | 4,717 | يومياً 14:30 |
| `vps-service/jobs/daily_closer.py` | 3,501 | يومياً 14:35 |
| `vps-service/jobs/learning_engine.py` | — | يومياً 16:00 |
| `vps-service/jobs/market_scheduler.py` | 2,780 | مستمر |
| `vps-service/jobs/predictor_modules/` (8 ملفات) | ~250 | (Strangler extraction) |
| `vps-service/jobs/closer_modules/` (2 ملفات) | ~106 | (Strangler extraction) |

### 13.7 Backend — API (Top 10 largest blueprints)

| الملف | LOC | Blueprint |
|---|---|---|
| `vps-service/api/admin_routes.py` | 5,133 | `admin_bp` |
| `vps-service/api/misc_routes.py` | 4,194 | `misc_bp` |
| `vps-service/api/chart_routes.py` | 3,560 | `chart_bp` |
| `vps-service/api/portfolio_routes.py` | 3,207 | `portfolio_bp` |
| `vps-service/api/stored_analysis_routes.py` | 2,982 | `stored_analysis_bp` + `market_bp` |

### 13.8 Documentation Files

| الملف | الوظيفة |
|---|---|
| `00-CONSTITUTION.md` | الدستور الحاكم (القواعد) |
| `01-ARCHITECTURE.md` (هذا الملف) | المعمارية التقنية الكاملة |
| `01-DATABASES-COMPLETE.md` | كل الـ DBs |
| `02-API-DICTIONARY.md` | كل الـ endpoints |
| `02-DATABASES-AND-DATA.md` | الـ DBs والـ data |
| `03-HOW-IT-THINKS.md` | تدفق النظام end-to-end |
| `04-ENGINES-ARCHITECTURE.md` | الـ 4 engines مفصّلة |
| `04-TEAM.md` | الفريق |
| `05-DATA-ACCESS-LAYER-PLAN.md` | خطة DAL |
| `05-SCREENS-AND-COMPONENTS.md` | كل الشاشات والمكونات |
| `BACKEND-ARCHITECTURE-AUDIT.md` | audit الباك إند |
| `ENGINES-MASTER-REFERENCE.md` | مرجع المحركات |
| `INDEX.md` | فهرس التوثيق |

---

## 📌 خاتمة

هذا الملف هو **المصدر المرجعي الوحيد** لمعمارية GLMinvestment. أي تعارض بين هذا الملف وأي مصدر آخر ← هذا الملف هو الصحيح.

**المراجعة الأخيرة:** 2026-10-24
**الإصدار:** v3.4.43
**الحالة:** Backend 100% ready for production ✅ | Frontend Phase 3 modularization مكتمل ~95%

---

### 🔗 See Also

- [`00-CONSTITUTION.md`](./00-CONSTITUTION.md) — القواعد الحاكمة
- [`01-DATABASES-COMPLETE.md`](./01-DATABASES-COMPLETE.md) — كل الـ DBs
- [`02-API-DICTIONARY.md`](./02-API-DICTIONARY.md) — كل الـ endpoints
- [`03-HOW-IT-THINKS.md`](./03-HOW-IT-THINKS.md) — تدفق النظام
- [`04-ENGINES-ARCHITECTURE.md`](./04-ENGINES-ARCHITECTURE.md) — الـ 4 engines مفصّلة
- [`05-SCREENS-AND-COMPONENTS.md`](./05-SCREENS-AND-COMPONENTS.md) — كل الشاشات
- [`BACKEND-ARCHITECTURE-AUDIT.md`](./BACKEND-ARCHITECTURE-AUDIT.md) — audit الباك إند
- [`ENGINES-MASTER-REFERENCE.md`](./ENGINES-MASTER-REFERENCE.md) — مرجع المحركات
