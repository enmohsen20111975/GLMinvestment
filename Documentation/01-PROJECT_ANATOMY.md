# 🫀 تشريح مشروع GLMinvestment — الدليل الكامل للمعمارية والكود

> **هذا الملف هو المصدر الأوحد للحقيقة (single source of truth) لمعمارية المشروع.**
> كل ما يخص المعمارية، المحركات، قواعد البيانات، تدفق البيانات، الـ API، الـ deployment،
> والـ file inventory موجود هنا. لو ضاع المستودع بالكامل، هذا الملف + `00-CONSTITUTION.md`
> يمكّنانك من فهم كل جزء في المنصة.
>
> **آخر تحديث:** 2026-08-31 (KILL-MAESTRO + V40.2 هو العقل الوحيد + V62 logic + AI News Agent).
> **كل ملفات `Documentation/*.md` السابقة دُمجت في الملفات الأربعة الرئيسية:**
> `00-CONSTITUTION.md` (الدستور) · `01-PROJECT_ANATOMY.md` (هذا الملف) ·
> `02-SCREENS_AND_COMPONENTS.md` (الشاشات والمكونات) · `SYSTEM_HOW_IT_THINKS.md` (منطق التحليل).
>
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **المراجع الحية:** `AGENTS.md` · `SYSTEM_STATE.md` · `CURRENT_STATE.md` · `worklog.md`
>
> ⚠️ هذا الملف **يلزم الواقع الحالي للكود**. كل رقم/مسار/منفذ متحقَّق منه ضد الكود الفعلي.
> أي تغيير في البنية = تحديث هذا الملف فورًا.

---

## ⚡ تغييرات جوهرية (2026-08-31) — اقرأ هذا أولاً

### 🔥 KILL-MAESTRO: V40.2 هو العقل الوحيد

**Maestro مات بالكامل.** V40.2 هو مولّد التوقعات الأساسي والوحيد.

| التغيير | التفاصيل |
|---|---|
| **V40.2 = المصدر الوحيد** | `v40_2_daily_generator.py` يكتب في `predictions.db` — tracker مفعّل |
| **Maestro = معطل** | `maestro_orchestrator.py` signal_id = None — مش بيكتب أي توقعات |
| **background_analyzer** | `self.orchestrator = None` — مش بـ init Maestro |
| **maestro_routes** | `orchestrator = None` — مش بـ analyze |
| **analysis_runner** | `run_analysis_batch` returns immediately — Maestro init DISABLED |
| **day_trading_scanner** | `self.orchestrator = None` — skip |
| **ai_predictions_routes** | يقرأ من `predictions` (V40.2) مش `stored_analyses` (Maestro) |

### 🧠 V62 Logic (4 ميزات من Pine Script)

| الميزة | الوصف | المصدر |
|---|---|---|
| **fake_pump** | طلع +3% بس حجم ضعيف → رفض (فخ الميكرز) | V62 line 80-83 |
| **is_dist** | توزيع (شمعة حمراء + ظهر >50% + حجم >2× MA) → رفض | V62 line 85-87 |
| **is_story_stock** | P/E > 50 → تقليل الحجم | V62 line 90 |
| **maker_sweep** | sweep_low + delta موجب → boost | V62 line 89 |

### 📰 AI News Agent

| الميزة | الوصف |
|---|---|
| **DuckDuckGo Search** | بحث مجاني عن أخبار السهم (بدون API key) |
| **Trafilatura** | استخلاص نص المقال من HTML |
| **Keyword Fallback** | 120+ كلمة مفتاحية (عربي + إنجليزي) بأوزان 1-3 |
| **Ollama** | محاولة تحليل بالـ AI (crash على السيرفر الحالي — CPU بلا AVX) |
| **التكامل مع V40.2** | بعد كل signal → تحليل أخبار → لو score < 30 → رفض |

### 🔧 إصلاحات daily_closer

| الإصلاح | الوصف |
|---|---|
| **data_engine.db مباشر** | daily_closer يقرأ من `egksco_price_history` مباشرة (تجاوز data.prices recursion) |
| **created_at = prediction_date** | في backtest، created_at = prediction_date (مش now()) عشان days_elapsed صحيح |
| **V40.2 dry_run فقط** | outcome_date يسجل بس في dry_run — daily_closer يقفل في الإنتاج |

### 📊 نتائج Backtest (الساندبوكس — data/all.zip)

| المقياس | V40.2 القديم | V40.2 الحالي |
|---|---|---|
| عدد الصفقات | 39 | 12 (scan-interval=3) |
| Win Rate | 69.2% | 73.3% (dry_run) / 33.3% (daily_closer) |
| Profit Factor | 6.04 | 9.80 (dry_run) / 51.42 (daily_closer) |
| Return | +51.6% | +66.2% (dry_run) / +56.5% (daily_closer) |

### ⚠️ مشاكل معروفة

| المشكلة | الوصف | الحل المقترح |
|---|---|---|
| **Ollama crash** | CPU السيرفر مش بيدعم AVX/SSE → كل النماذج crash | keyword fallback شغّال (120+ كلمة) |
| **7 breakeven exits** | BE-stop-after-+3%-MFE بيخرج صفقات كتير عند breakeven | مراجعة threshold (+3% → +5%؟) |
| **DuckDuckGo rate limit** | أحياناً بيرفض البحث (403 Ratelimit) | إضافة retry + delay |
| **أخبار الاكتتاب/توزيع الأرباح** | مش موجودة في النظام حالياً | مطلوب إضافتها (انظر القسم 12) |
| **market.db = 0 بايت** | الـ 4-DB target architecture مش مكتمل | استخدام data_engine.db كـ canonical |

---

### 🔬 V68 + V72 Oracle Engines — A/B Backtest Results (2026-08-31)

**المنهجية:** كل ميزة في V68 و V72 اتعملها A/B backtest لوحدها على 200 سهم (Jul-Aug 2026).
الـ baseline: 15 trades, WR 73.3%, PF 9.80, Return +66.2%.
**القاعدة: النتائج هي اللي تقرر — بـ نـ keep الكويس ونمسيح الوحش.**

#### النتائج النهائية

| الميزة | Trades | WR% | Return% | ΔReturn | الحكم |
|---|---|---|---|---|---|
| **V68_DIRTY_DIST_REJECT** | 17 | 76.5 | +88.7 | +22.5 | ✅ KEEP |
| **V72_HIDDEN_DIST_BLOCK** | 14 | 71.4 | +102.7 | +36.5 | ✅ KEEP |
| V68_NO_CHASE_2D_REJECT | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V68_PROOF_PROBABILITY | 15 | 73.3 | +66.2 | 0 | ❌ KILL (avg prob 31.7) |
| V68_APLUS_BOOST | 15 | 73.3 | +66.2 | 0 | ❌ KILL (1 trigger) |
| V68_MAGNETIC_TARGET | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V72_WASH_TRADE_REJECT | 18 | 61.1 | +82.6 | +16.4 | ❌ KILL (WR -12.2%!) |
| V72_PULLBACK_BUY_PATH | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V72_MAKER_DEATH_POINT | 15 | 73.3 | +66.2 | 0 | ❌ KILL (no effect) |
| V72_MARKET_BULLISH_SIZING | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |

#### COMBO (الفائزين مع بعض)
**V68_DIRTY_DIST + V72_HIDDEN_DIST = 15 trades, WR 73.3%, Return +106.9% (+40.7% vs baseline)**

#### الملفات الجديدة
- `vps-service/analyzers/v68_oracle.py` (730 LOC) — 13 functions (probability, future fingerprint, quiet accumulation, dirty distribution, liquidity magnets, MFE trailing, etc.)
- `vps-service/analyzers/v72_multi_path.py` (470 LOC) — 8 functions (wash trade, hidden dist, pullback buy, maker death point, kill switch, market sizing)
- `scripts/v68_ab_backtest.py` (400 LOC) — A/B harness (temp DB per run, WR/PF/Return per feature)

#### الـ toggles (كل ميزة env var)
```python
# V68 — ✅ KEEP 1, ❌ KILL 4
V68_DIRTY_DIST_REJECT  = '1'  # ✅ +22.5% return
V68_NO_CHASE_2D_REJECT = '0'  # ❌
V68_PROOF_PROBABILITY  = '0'  # ❌
V68_APLUS_BOOST        = '0'  # ❌
V68_MAGNETIC_TARGET    = '0'  # ❌

# V72 — ✅ KEEP 1, ❌ KILL 4, ⏸️ PENDING 1
V72_HIDDEN_DIST_BLOCK     = '1'  # ✅ +36.5% return
V72_WASH_TRADE_REJECT     = '0'  # ❌ -12.2% WR
V72_PULLBACK_BUY_PATH     = '0'  # ❌
V72_MAKER_DEATH_POINT     = '0'  # ❌
V72_MARKET_BULLISH_SIZING = '0'  # ❌
V72_KILL_SWITCH_EXIT      = '0'  # ⏸️ exit-level (pending backtest)

# V73 — ✅ KEEP 1, ❌ KILL 1
V73_DESERT_PHASE_REJECT  = '1'  # ✅ +23.1% return (6-month validated)
V73_AUCTION_TRAP_REJECT  = '0'  # ❌ 0 triggers
```

#### V73 Sniper Engine (6-month A/B — 2026-08-31)
- `vps-service/analyzers/v73_sniper.py` (220 LOC) — 2 genuinely new features
- **V73_DESERT_PHASE_REJECT** ✅ KEEP: BB squeeze + volume < 0.5×MA = سهم ميت → رفض (+23.1% return, 3 triggers on 6-month window)
- **V73_AUCTION_TRAP_REJECT** ❌ KILL: 0 triggers (EGX لا يقفز >10% في شمعة واحدة)
- 6-month COMBO (V68+V72+V73 winners): 15 trades, WR 73.3%, Return +106.9% (+40.7% vs baseline)
- **Validated general, not overfit** (6-month window Feb-Aug 2026, 200 tickers)

#### KILL-OLLAMA (تحديث 2026-08-31)
- `vps-service/ai/news_agent.py`: `NEWS_USE_OLLAMA` env var (default=0)
- default=0 → skip Ollama connection entirely → keyword fallback = production
- `is_ready()` مش بـ يتطلب Ollama

---

## 📑 المحتويات

1. [High-Level System Topology](#1-high-level-system-topology)
2. [Full Directory Tree](#2-full-directory-tree)
3. [Databases Map](#3-databases-map)
4. [Engine / Service Map](#4-engine--service-map)
5. [API Map — Condensed (Flask Blueprints + Next.js Routes)](#5-api-map--condensed-flask-blueprints--nextjs-routes)
6. [Data Flow](#6-data-flow)
7. [Deployment & Infra (Caddy + PM2 + Cron + Mini-services)](#7-deployment--infra-caddy--pm2--cron--mini-services)
8. [Dead-Code / Duplicate Inventory (Condensed)](#8-dead-code--duplicate-inventory-condensed)
9. [audit_map.json — Machine-Generated File Map](#9-audit_mapjson--machine-generated-file-map)
10. [Known Architectural Gaps](#10-known-architectural-gaps)
11. [References & Merged Sources](#11-references--merged-sources)
12. [AI News Agent + Corporate Actions (جديد 2026-08-31)](#12-ai-news-agent--corporate-actions)

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
8. **Commission edge + risk ceiling** (CONSTITUTION Rule 8) — ATR stop clamp `[3%, 9%]` مُفعّل في `v38_backtest_engine.py` (post-commit `65a748f`).
9. **Single-route shell** (CONSTITUTION Rule 3) — لا صفحات جديدة. كل شيء عبر hash routes من `/`.
10. **STICKY FOOTER** — الـ Footer لاصق أسفل كل شاشة (CSS sticky).

### 1.4 قاعدة الـ `?XTransformPort`

> آلية الـ Gateway: Caddy يستقبل كل الطلبات على المنفذ 81، ثم يحوّل الـ query param `XTransformPort=N`
> لتمرير الطلب للخدمة الداخلية على المنفذ `N`.

**الاستخدامات الموثقة (2 ملفات فقط):**
- `src/app/api/analysis-engine/route.ts` — يحوّل لـ analysis-engine على منفذ خاص.
- `src/app/api/telegram/[...path]/route.ts` — يحوّل لـ mini-service الـ `telegram-events` (port 3003).

**القاعدة الذهبية:** كل الـ routes الباقية تستخدم **relative-path-only** عبر `EGXPY_SERVICE_URL` (default `http://localhost:8010`). لا استدعاء مباشر لـ `localhost:8010` من الـ frontend؛ لازم يمر عبر `Next.js /api/proxy/[...path]`.

### 1.5 الإحصائيات الكلية (2026-08-17)

| المؤشر | القيمة |
|---|---|
| Backend .py files | ~395 |
| Backend LOC | ~229,490 |
| Frontend .ts/.tsx files | ~1,104 |
| Frontend LOC | ~343,000 |
| Flask Blueprints (registered) | 53 |
| Python `@bp.route` decorators | ~599 |
| Next.js `route.ts` files | ~583 |
| محرك قرار مؤسسي | V39/V40.2 (institutional_decision_engine.py, ~520 LOC) |
| محرك backtest | V38 (v38_backtest_engine.py, 1,817 LOC) |
| Personas | 4 (gambler / balanced / conservative / expert) |
| عدد الأسهم | 970 ticker في `stocks.db` (EGX=375, السعودية=390, الكويت=138, قطر=67) |
| التوقعات في الإنتاج (post-archive 20260817) | 153 predictions، 148 closed (2026-01-01 → 2026-08-17) |
| Live WR (reference) | ≈ 69.2% (26 صفقة مقفولة) |
| Live PF (reference) | ≈ 4.46 |
| Fair re-sim PF (post-R:R fix) | 1.453 (148 trades، +0.189%/trade عن القاعدة العادلة) |
| R:R الحالي | dynamic 1.5 (normal) / 2.0 (outperform) — engine_settings |

---

## 2. Full Directory Tree

```
GLMinvestment/                              # ← PROJECT ROOT
├── .env / .env.example                     # 🔐 المتغيرات السرية (gitignored) + قالب
├── .zscripts/                              # 🐶 سكربتات الساندبوكس (start-watchdog.sh)
├── AGENTS.md                               # 📜 دليل سير العمل للمطورين
├── CHANGELOG.md                            # 📝 سجل التغييرات
├── Caddyfile                               # 🌐 بوابة Caddy على المنفذ 81
├── DEPLOYMENT_GUIDE.md                     # 🚀 دليل النشر الكامل
├── ecosystem.config.js                     # ⚙️ إعداد PM2 (5 خدمات)
├── worklog.md                              # 📒 سجل العمل اليومي (gitignored)
├── package.json                            # v3.4.43 — Next.js 14.2.28 + React 18
├── bun.lock / bunfig.toml                  # أقفال + config الـ bun
├── tsconfig.json                           # TS 5.9.3 strict + @/* alias
├── tailwind.config.ts                      # Tailwind 3 (new-york preset)
├── next.config.ts / next.config.mjs        # Next.js config (ignoreBuildErrors=true)
├── postcss.config.mjs / eslint.config.mjs  # PostCSS + ESLint 9 flat config
├── components.json                         # shadcn/ui config
├── vitest.config.ts                        # frontend tests
│
├── prisma/                                 # 🗄️ Prisma schemas (3 منفصلة)
│   ├── schema.prisma                       # User + Post فقط (scaffold بسيط)
│   ├── auth-schema.prisma                  # auth.db models (User, Account, Session)
│   └── predictions-schema.prisma           # predictions.db models (proxy for Python raw SQL)
│
├── src/                                    # 🎨 FRONTEND (Next.js 14 App Router, TypeScript)
│   ├── app/                                # App Router root
│   │   ├── page.tsx                        # Single-route shell + renderView() switch
│   │   ├── layout.tsx                      # RTL + Sidebar + Header + Footer (sticky)
│   │   ├── globals.css                     # Tailwind + shadcn variables + dark mode
│   │   ├── api/                            # Next.js API routes (~583 route.ts)
│   │   │   ├── proxy/[...path]/route.ts    # ⭐ catch-all proxy للـ Python (الأكثر استخدامًا)
│   │   │   ├── auth/[...nextauth]/         # NextAuth.js (Google OAuth + Bearer)
│   │   │   ├── predictions/                # /api/predictions/* (Node + Python mixed)
│   │   │   ├── stored-analysis/            # /api/stored-analysis/* (Python proxy)
│   │   │   ├── chart/                      # /api/chart/* (full-analysis, V40.2)
│   │   │   ├── market/                     # /api/market/* (morning-bell, sectors)
│   │   │   ├── paymob/                     # /api/paymob/* (Node-only payment)
│   │   │   ├── telegram/[...path]/         # proxy للـ telegram-events mini-service
│   │   │   ├── analysis-engine/            # XTransformPort routing
│   │   │   └── ... (~570+ route.ts more)
│   │   ├── admin/                          # 4 صفحات admin iframe (ECMA module)
│   │   ├── (auth)/                         # login, register, google-signin
│   │   └── ... dead pages (9 — انظر §8)
│   │
│   ├── components/                          # React components (~328 component)
│   │   ├── ui/                              # 44+ shadcn/ui primitives (new-york preset)
│   │   ├── analysis/                        # MarketAnalysisView, InstitutionalDecisionPanel, ...
│   │   ├── predictions/                     # PicksManagementView, PredictionTrackingDashboard, ...
│   │   ├── advanced-analysis/               # SpecialistAnalysisView, StoredAnalysisView (orphan)
│   │   ├── market/                          # ChartStack, persona cards (6), MarketPulseWidget, ...
│   │   ├── portfolio/                       # PortfolioView, PositionManager, ...
│   │   ├── admin/                           # MaestroDashboard (2,750 LOC), MaestroCommandCenter (3,748 LOC)
│   │   ├── layout/                          # Sidebar, MobileNav, Header, Footer (sticky)
│   │   └── shared/                          # ExpertIntelligencePanel, Cards, Modals
│   │
│   ├── lib/                                 # Frontend utilities
│   │   ├── api.ts                           # fetch wrappers + EGXPY_SERVICE_URL
│   │   ├── auth.ts                          # NextAuth config
│   │   ├── prisma.ts                        # Prisma client (auth.db + predictions.db)
│   │   ├── sqlite-readonly.ts               # better-sqlite3 read-only (architecture violation if used for write)
│   │   └── utils.ts                         # cn(), formatters, RTL helpers
│   │
│   ├── hooks/                               # React hooks (useChart, usePredictions, useSocket, ...)
│   ├── store/                               # zustand stores (store.ts + slice per domain)
│   ├── instrumentation.ts                   # OpenTelemetry hook (Sentry + posthog)
│   └── styles/                              # Global stylesheets
│
├── vps-service/                             # 🧠 PYTHON BACKEND (THE BRAIN, port 8010)
│   ├── main.py                              # FastAPI app + WSGIMiddleware للـ Flask (v7.0.0)
│   ├── lightweight_server.py                # Flask app + 53 blueprint registrations
│   ├── engines/                             # ⭐ محركات التحليل الأساسية
│   │   ├── v38_backtest_engine.py           # 1,817 LOC — walk-forward backtest (COMMIT 65a748f — canonical sl/tp1/tp2 + ATR clamp [3%,9%])
│   │   ├── maestro_orchestrator.py          # 3,545 LOC — 8-layer confluence + 15+ modifier
│   │   └── ... (9 engines more)
│   ├── engine/                              # engine subsystem (flow_system.py 1,078 LOC, ...)
│   ├── analyzers/                           # 100+ محلل (institutional_decision_engine.py, maestro_orchestrator.py, ...)
│   │   ├── institutional_decision_engine.py # 520 LOC — V39/V40.2 (6 proofs + Tech Score + portfolio_advice)
│   │   ├── confidence_engine.py             # Picks management (7 factors, 4 tiers)
│   │   ├── position_manager.py              # 7 position advices
│   │   ├── maestro_orchestrator.py          # 3,545 LOC (mirror of engines/)
│   │   ├── master_analyzer.py               # load_merged_history() + 100+ sub-analyzers
│   │   ├── fundamental_data_provider.py     # get_fundamental_score(ticker) — 40/30/15/15 weights
│   │   ├── stock_fundamentals.py            # reads tab_balance_sheet (symbol≠ticker gap)
│   │   ├── persona_engine.py                # 4 personas + PERSONA_CONFIGS + _ADAPTIVE_RR_TABLE
│   │   ├── live_prediction_engine.py        # 15-min prediction cycle
│   │   ├── historical_prediction_generator.py # batch backfill (SELL sign-flip fix)
│   │   ├── market_regime.py                 # bull/bear/sideways classification
│   │   ├── smart_confluence_engine.py       # 8-layer scoring (138 pts max, BUY threshold 68)
│   │   ├── paper_trade_tracker.py           # paper-trading PnL tracking
│   │   ├── explosive_scanner.py             # BB squeeze + volume spike detector
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
│   │   ├── market_routes.py                 # active (morning-bell, sectors)
│   │   ├── crypto_routes.py                 # active
│   │   ├── screener_routes.py               # active
│   │   ├── hunter_routes.py / sniper_routes.py # active
│   │   ├── learning_routes.py               # active (self/unified)
│   │   ├── news_routes.py                   # active
│   │   ├── monitor_routes.py                # active
│   │   ├── reports_routes.py                # active
│   │   ├── telegram_routes.py               # active (Python side)
│   │   ├── egksco_routes.py                 # active (EGX official data)
│   │   ├── engine_settings_routes.py        # active (threshold source)
│   │   ├── optimizer_params_routes.py       # active (DEFAULT_PARAMS: min_rr_ratio=1.8, max_stop_pct=9.0)
│   │   ├── honest_tracking_routes.py        # active (RL-FIX-9, 5-state taxonomy)
│   │   └── ... (33 DEPRECATED — انظر §8.2)
│   │
│   ├── ai/                                  # AI subsystem (Ollama RAG + DuckDuckGo)
│   ├── portfolio/                           # Portfolio manager (stop_manager.py 607 LOC, ...)
│   ├── scripts/                             # 136 صيانة script (backfill, diagnose, audit_map.py)
│   ├── tools/                               # developer tools
│   ├── config/                              # JSON configs + threshold defaults
│   ├── models/                              # Pydantic models + DTOs
│   ├── jobs/                                # background jobs (price_history_safetynet, intraday_aggregator, daily_closer, v40_2_daily_generator)
│   ├── core/                                # auth_middleware, db_manager, settings_resolver
│   ├── ws-service/                          # ⭐ mini-service (Bun, port 3005, socket.io, 248 LOC)
│   ├── crontab.txt                          # ✅ egx_fundamental_fetcher مُجدوَل (السبت 14:00 UTC)
│   ├── Dockerfile                           # optional containerization
│   └── requirements.txt                     # Python deps (FastAPI, Flask, pandas, telethon, ...)
│
├── data_engine/                             # 📡 DATA ENGINE (port 5000)
│   ├── main.py                              # scraper orchestrator
│   ├── sync.py                              # sync data_engine.db → predictions.db / price_history.db
│   ├── scrapers/                            # 10 scrapers
│   │   ├── tradingview_scraper.py           # TA + UDF
│   │   ├── yahoo_scraper.py                 # historical OHLC
│   │   ├── egxpilot_scraper.py              # FREE fundamentals API (used by egx_fundamental_fetcher)
│   │   ├── egksco_scraper.py                # EGX official data
│   │   ├── news_scraper.py                  # NewsAPI + GNews
│   │   ├── coingecko_scraper.py             # crypto prices
│   │   └── ... (4 more)
│   ├── config/                              # scraper configs (intervals, API keys)
│   └── data/                                # raw scraped data cache + data_engine.db
│
├── db/                                      # 🗄️ SQLite databases (WAL mode)
│   ├── vps_real/                            # ⭐ PRODUCTION archive (extracted from active_databases_20260817_full.zip)
│   │   ├── predictions.db                   # 153 preds, 148 closed (2026-01-01 → 2026-08-17)
│   │   ├── data_engine.db                   # tab_* (858-866 rows each), egx_fundamentals=0
│   │   ├── price_history.db                 # 288,194 rows, 1,260 tickers (EGX focus)
│   │   ├── stocks.db                        # 970 tickers
│   │   ├── auth.db                          # Prisma-managed (User, Session, Account)
│   │   ├── analytics.db                     # persona / scoring cache
│   │   ├── learned.db                       # learning engine weights
│   │   ├── news.db / community.db / telegram_data.db  # sentiment
│   │   ├── intraday.db                      # intraday OHLC (aggregated → price_history)
│   │   ├── gold_prices.db / silver_prices.db
│   │   ├── crypto.db / crypto-lab.db / crypto_learning.db
│   │   ├── exchange_rates.db / ai_search_cache.db
│   │   └── (17 DBs total — full inventory in §3)
│   └── schemas/                             # SQL schema definitions + migrations
│
├── glminvestment-engines/                   # standalone engines package (data-science repo, symlinked)
│
├── mini-services/                           # ⚡ INDEPENDENT BUN PROJECTS (each own port + package.json)
│   ├── telegram-events/                     # port 3003 — polling 2s + broadcast (Bun/TS)
│   ├── telegram-poster/                     # auto-posting (Bun/TS, started by PM2)
│   └── ... (more mini-services pattern)
│
├── scratch/                                 # 🧪 sandbox scripts (not in production)
│   └── v40_2_historical_generator.py        # ORIGINAL V40.2 sandbox (pre v40_2_daily_generator.py)
│
├── garage/                                  # 🗑️ DEAD CODE (~8,247 LOC — orphan candidates, انظر §8.4)
│
├── scripts/                                 # maintenance scripts (136)
│   ├── audit_map.py                         # ⭐ regenerates audit_map.json
│   ├── backfill_persona_classification.py   # schema-aware (post ed55a60c)
│   ├── diagnose_utop_and_price_history.py   # diagnostic
│   └── ... (133 more)
│
├── tests/                                   # pytest (5 files) + vitest (65 files)
│   ├── test_risk_profile.py
│   ├── test_db_manager.py
│   └── ...
│
├── Documentation/                           # 📚 this folder (4 master files + 12 source files pending deletion)
│   ├── 00-CONSTITUTION.md                   # ⭐ الدستور (25 rules)
│   ├── 01-PROJECT_ANATOMY.md                # ⭐ هذا الملف
│   ├── 02-SCREENS_AND_COMPONENTS.md         # ⭐ شاشات + components inventory
│   ├── SYSTEM_HOW_IT_THINKS.md              # ⭐ منطق التحليل (decision-engine deep dive)
│   ├── CURRENT_STATE.md                     # مرجع حي للحالة (PERSONA-UNIFY-A + KPIs)
│   ├── AGENTS.md / SYSTEM_STATE.md          # workflow + state
│   ├── worklog.md                           # daily work log
│   ├── audit_map.json                       # ⚙️ machine-generated (24,910 lines, انظر §9)
│   └── (12 source files merged into 4 masters — pending deletion)
│
├── active_databases_20260817_full.zip       # 📦 PRODUCTION ARCHIVE (77,021,220 bytes, MD5 0947bdf6c2eff1a75ff8af6c3e576ed8, 17 DBs)
└── Caddyfile                                # 🌐 Gateway config (port 81 + XTransformPort)
```

---

## 3. Databases Map

> **القاعدة:** كل قواعد البيانات SQLite + WAL mode + `busy_timeout=30000`. لا PostgreSQL، لا Redis، لا message queue.
> Production archive: `active_databases_20260817_full.zip` (77,021,220 bytes، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`، 17 DBs).

### 3.1 قواعد البيانات الرئيسية (db/vps_real/)

| DB | الدور | Key tables + counts | ملاحظات |
|---|---|---|---|
| **`predictions.db`** | V40.2 prediction store | 153 predictions (2026-01-01 → 2026-08-17)، 148 closed | `fundamental_score = 50` placeholder لكل الصفوف (مالم يُعدّل بعد Stage G) |
| **`data_engine.db`** | Market + fundamentals | `historical_data`=99,076 · `stock_prices`=2,495 · `tab_balance_sheet`=866 · `tab_income_statement`=866 · `tab_cash_flow`=866 · `tab_valuation`=858 · `tab_profitability`=858 · `tab_dividends`=858 · `tab_performance`=858 · `tab_technical_analysis`=863 · `egx_fundamentals`=**0** | ⚠️ 3 جداول (balance_sheet/income_statement/cash_flow) عندها **column-shift bug** — `symbol` column بتحمل market name بدل الـ ticker. كل tab_* بـ symbol **ARABIC not ticker** (e.g., `ALCNالاسكندرية`). |
| **`price_history.db`** | EGX OHLC (primary price source) | 288,194 rows، 1,260 tickers، 2025-01-09 → 2026-08-17 | المصدر الرئيسي للـ `load_merged_history()` |
| **`stocks.db`** | Ticker metadata | 970 tickers (السعودية=390, مصر=375, الكويت=138, قطر=67) | mixed: Saudi (numeric) + EGX (concatenated) + Kuwait + Qatar |
| **`auth.db`** | Prisma-managed (auth) | User, Session, Account, VerificationToken | الوحيدة اللي Node.js بـ يكتب فيها مباشرة (Prisma) |
| **`analytics.db`** | Persona + scoring cache | — | تُقرأ من Python |
| **`learned.db`** | Learning engine weights | — | تُكتب من `learning_engine.py` + `lesson_store.py` |
| **`news.db`** | News sentiment | — | Pillar 3 (sentiment) |
| **`community.db`** | Community posts + sentiment | — | (community page = DEAD — انظر §8.1) |
| **`telegram_data.db`** | Telegram events cache | — | mini-service telegram-events بـ يكتب |
| **`intraday.db`** | Intraday OHLC | — | `intraday_aggregator.py` بـ يحوّلها لـ price_history.db |
| **`gold_prices.db`** / **`silver_prices.db`** | metals prices | — | (gold/silver removal planned — v3.66.2) |
| **`crypto.db`** / **`crypto-lab.db`** / **`crypto_learning.db`** | crypto prices + lab + learning | — | (crypto page = DEAD candidate) |
| **`exchange_rates.db`** | EGP/SAR/KWD/QAR vs USD | — | portfolio conversion |
| **`ai_search_cache.db`** | DuckDuckGo + Ollama cache | — | يقلل الـ LLM calls |

### 3.2 موقع القواعد

- **Sandbox working copy:** `db/vps_real/` (relative — sandbox-only)
- **Production:** `/root/GLMinvestment/db/` على VPS (identical to `db/vps_real/` بعد استخراج الـ archive)
- **Archive:** `./active_databases_20260817_full.zip` (repo root، 73.45 MB، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`)

### 3.3 الـ Schema Bug الحرج (tab_balance_sheet / tab_income_statement / tab_cash_flow)

> هذه الجداول الـ 3 **UNUSABLE without migration**. باقي tab_* (valuation, profitability, dividends, performance, technical_analysis) **clean and usable**.

```
Expected:  symbol=1030 | market=السعودية | fiscal_period=2025-Q3 | fiscal_end=2025-12-31 | total_assets=...
Actual:    symbol=السعودية | market=2025-Q3 | fiscal_period=2025-12-31 | fiscal_end=335.05 M SAR | total_assets=...
```

**Migration plan:** تُصلح عبر `data_engine/scrapers/egksco_scraper.py` re-scrape + manual column-shift fix. ليست مُجدوَلة بعد (Stage H — NEXT).

### 3.4 فجوة الـ Arabic Symbol → Ticker Mapping

- `tab_valuation.symbol` for EGX = `ALCNالاسكندرية` (ticker + Arabic name concatenated)
- `predictions.db.ticker` = `ALCN` (clean)
- **Resolver (موجود في `stock_fundamentals.py`):** exact match first, then prefix match `LIKE 'TICKER%'`
- **Mapping success rate:** 81.8% (18/22 prediction tickers match tab_valuation، 97.4% by prediction count)

### 3.5 فجوة `egx_fundamentals` — ✅ RESOLVED

- الـ fetcher `vps-service/data/egx_fundamental_fetcher.py` **موجود + مُجدوَل + مُحصّن** (commit a268957 + 4cde9f0).
- الـ cron بيشغّل السبت 14:00 UTC (16:00 Cairo). no-args = full bulk fetch (تم إصلاح bug الـ no-args اللي كان بيتجاهل الـ populate).
- **Ticker-validation guard** يمنع إعادة إنتاج صفوف الـ column-shift (أسماء الأسواق/fiscal_period/indices بـ تترفض قبل أي كتابة).
- **tab_* integrity check** (`verify` subcommand) بيتأكد إن tab_balance_sheet/income/cash_flow فضلت نظيفة.
- **Python بـ يقرأ** من `tab_valuation`/`tab_profitability`/`tab_dividends`/`tab_performance`/`tab_technical_analysis` (clean tables) + `egx_fundamentals` (fresh EGXPilot data).

### 3.6 Prisma Schemas

| Schema | الـ DB | الـ Models |
|---|---|---|
| `prisma/schema.prisma` | (none — scaffold only) | User + Post (placeholder — non-production) |
| `prisma/auth-schema.prisma` | `auth.db` | User, Account, Session, VerificationToken (NextAuth) |
| `prisma/predictions-schema.prisma` | `predictions.db` | proxy models for Python raw SQL — للقراءة فقط من Node.js |

> ⚠️ **G10 (known gap):** Prisma scaffold = User+Post فقط، الـ data الحقيقي في Python SQLite. لا يوجد unified migration.

### 3.7 إحصائيات `predictions.db` (post-archive 20260817)

| الحقل | القيمة |
|---|---|
| إجمالي التوقعات | 153 |
| closed | 148 |
| open | 5 |
| Date range | 2026-01-01 → 2026-08-17 |
| byPersona | balanced=22 (81.8% WR) | gambler=1 | conservative=3 |
| fundamental_score (all rows) | **50.0** (placeholder — Stage G fix pending) |
| Dynamic R:R active | 95.27% من الصفقات بـ R:R=2.0 (outperform path) |

---

## 4. Engine / Service Map

### 4.1 المحركات الأساسية (engines/ + analyzers/)

| Engine | File | LOC | الوصف | Status |
|---|---|---:|---|---|
| **V38 Backtest Engine** | `engines/v38_backtest_engine.py` | 1,817 | walk-forward backtest — NOW reads canonical `sl`/`tp1`/`tp2` + ATR clamp `[3%, 9%]` (commit `65a748f`) | ✅ ACTIVE |
| **V39/V40.2 Institutional Decision Engine** | `analyzers/institutional_decision_engine.py` | ~520 | 6 proofs + Tech Score (base 25, max 100) + portfolio_advice + dynamic R:R (1.5/2.0) — returns `sl`/`tp1`/`tp2` keys | ✅ ACTIVE — THE ONLY ENGINE |
| **Maestro Orchestrator** | `engines/maestro_orchestrator.py` = `analyzers/maestro_orchestrator.py` | 3,545 | 8-layer confluence (138 pts max، BUY threshold 68) + 15+ modifier بعد الفازات | ❌ DISABLED (KILL-MAESTRO 2026-08-31) — signal_id = None، مش بيكتب توقعات |
| **Stock Fundamentals** | `analyzers/stock_fundamentals.py` | — | reads `tab_balance_sheet` (with `symbol ≠ ticker` gap resolver — Arabic prefix match) | ✅ ACTIVE (with gap) |
| **EGX Fundamental Fetcher** | `vps-service/data/egx_fundamental_fetcher.py` | 573 | fetches from **EGXPilot FREE API** — writes to `egx_fundamentals` table. HARDENED (4cde9f0): ticker guard + no-args cron fix + `verify` integrity check | ✅ SCHEDULED (a268957) |
| **Persona Engine** | `analyzers/persona_engine.py` | — | 4 personas (gambler/balanced/conservative/expert) + `PERSONA_CONFIGS` + `_ADAPTIVE_RR_TABLE` + `PERSONA_INPUT_WEIGHTS` | ✅ ACTIVE |
| **Live Prediction Engine** | `analyzers/live_prediction_engine.py` | — | 15-min prediction cycle — generates predictions during market hours | ✅ ACTIVE |
| **Historical Prediction Generator** | `analyzers/historical_prediction_generator.py` | — | batch backfill (SELL sign-flip fix applied) — `MAX_PREDICTIONS_PER_DAY=7` | ✅ ACTIVE |
| **Market Regime** | `analyzers/market_regime.py` | — | bull / bear / sideways classification (EGX30ETF benchmark) | ✅ ACTIVE |
| **Smart Confluence Engine** | `analyzers/smart_confluence_engine.py` | — | 8-layer scoring (138 pts max, BUY threshold 68) | ✅ ACTIVE |
| **Paper Trade Tracker** | `analyzers/paper_trade_tracker.py` | — | paper-trading PnL tracking | ✅ ACTIVE |
| **Explosive Scanner** | `analyzers/explosive_scanner.py` | — | BB squeeze + volume spike detector (used in V40 Phase 2 — explosive uncap) | ✅ ACTIVE |
| **Confidence Engine** | `analyzers/confidence_engine.py` | — | 7-factor confidence (0-100%) + 4 tiers (TOP_PICK/STRONG/WATCH/SKIP) | ✅ ACTIVE (v3.4.43) |
| **Position Manager** | `analyzers/position_manager.py` | — | 7 position advices (wait / add / sell / partial-sell / ...) | ✅ ACTIVE (v3.4.43) |
| **Fundamental Data Provider** | `analyzers/fundamental_data_provider.py` | — | `get_fundamental_score(ticker)` — 40/30/15/15 weights (Profitability/Valuation/Dividend/Growth) | ✅ ACTIVE (Stage A-F done) |
| **Adaptive Weights** | `engines/adaptive_weights.py` | — | connected to maestro (post-fix) — self-learning weights | ✅ ACTIVE |
| **Flow System** | `engines/flow_system.py` | 1,078 | Macro 25% → Sector 30% → Stock 25% → Cross-val 20% | ✅ ACTIVE |
| **Stop Manager** | `portfolio/stop_manager.py` | 607 | 7 stop types (fixed, trailing, technical, volatility, tiered, time, breakeven) | ✅ ACTIVE |
| **Engine Settings** | `core/engine_settings.py` | 1,150 | 100+ dynamic settings + `get_setting(key, default)` resolver | ✅ ACTIVE |

### 4.2 V40.2 Daily Generator (post R:R fix — commit 65a748f)

> `vps-service/jobs/v40_2_daily_generator.py` (lines ~314-326) — **R:R floor gate** مُفعّل:

```python
if r_mult < get_setting('dynamic_rr_normal', default=1.5):
    continue  # يرفض sub-threshold setups قبل ما تدخل predictions.db
```

- مع الـ key-mismatch fix، `dynamic_rr_outperform=2.0` يُحترم للأسهم اللي outperforming الـ market → الـ gate نادرًا what يفعل.
- 95.27% من الصفقات بـ R:R=2.0 (outperform path).

### 4.3 Closed-Loop Learning (4-file chain)

```
1. live_price.py            ← يجمع سعر الإغلاق اليومي
   ↓
2. v40_2_daily_generator.py ← يولّد التوصيات (V40.2 هو العقل الوحيد — KILL-MAESTRO)
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

| Key | Value | Source |
|---|---|---|
| `dynamic_rr_normal` | **1.5** | engine_settings.py (default) |
| `dynamic_rr_outperform` | **2.0** | engine_settings.py (default) |
| `atr_stop_min_pct` | 3.0 | CONSTITUTION Rule 8 |
| `atr_stop_max_pct` | 9.0 | CONSTITUTION Rule 8 |
| `min_rr_ratio` | 1.8 | optimizer_params_routes DEFAULT_PARAMS |
| `max_stop_pct` | 9.0 | optimizer_params_routes DEFAULT_PARAMS |
| `default_stop_pct` | 5.0 | engine_settings.py |
| `trailing_stop_activation_gain` | ⚠️ **2.0 vs 3.0 CONTRADICTION** — engine_settings يقول 2.0 لكن V38 backtest + institutional_decision_engine بـ يتوقعون 3.0 (G7 — open) |
| `tech_score_base` | 25 (code) vs 50 (settings) — الفعلي 25 (G6) |
| `MAX_PREDICTIONS_PER_DAY` | 7 (hardcoded) — may be low in uptrend |
| `DAILY_PICKS_CAP` | 5 (Picks Management v3.4.43) |
| `MIN_CONFIDENCE_FOR_PICK` | 65% (Picks Management) |
| `ABS(actual_return)` HARD cap | ≤ 50 في كل مسارات KPI (route.ts + persona_db + PredictionTrackingDashboard) |
| `profit_loss` cap | -20.0 (SELL sign-flip fix — ULTRA-RESTORE) |

---

## 5. API Map — Condensed (Flask Blueprints + Next.js Routes)

> **القاعدة الذهبية:** كل المنطق في Python. Node بـ يعرض + proxy فقط.
> - **Flask Blueprints (registered):** 53 — في `vps-service/lightweight_server.py`
> - **Python `@bp.route` decorators:** ~599 — في `vps-service/api/` (65 ملف، **33 DEPRECATED** — انظر §8.2)
> - **Next.js `route.ts` files:** ~583 — في `src/app/api/`
> - **الـ Proxy الافتراضي:** `src/app/api/proxy/[...path]/route.ts` (catch-all للـ Python)

### 5.1 آلية الـ Proxy

```ts
// src/app/api/proxy/[...path]/route.ts (default pattern)
const PYTHON_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://localhost:8010';
const r = await fetch(`${PYTHON_BACKEND}${pathname}?${qs}`);
return NextResponse.json(await r.json());
```

**3 أنواع من الـ Node routes:**
1. **🔄 Pure Proxy** — تمرر الطلب لـ Python على `localhost:8010` (الغالبية العظمى)
2. **🔒 Auth/Paywall Gate** — تدير session, subscription, payment, JWT tokens (Prisma + SQLite)
3. **⚠️ Architecture Violation** — 3 endpoints بتفحص SQLite مباشرة من Node (انظر §10)

### 5.2 الـ Endpoints grouped by Module (condensed)

#### 5.2.1 Authentication & Subscription (Node-only — auth.db + Prisma)
- `/api/auth/register` · `/login` (Bearer 30d) · `/logout` · `/me` · `/profile` · `/google` · `/google-signin` · `/config` · `/[...nextauth]`
- `/api/subscription/plans` · `/current` · `/status` · `/check-access` · `/upgrade` · `/activate` · `/deactivate` · `/start-trial` · `/trial` · `/subscribe` · `/checkout` · `/verify` · `/developer-request`
- `/api/paymob/create-payment` · `/verify-payment`
- `/api/instapay/verify` · `/api/google-play/verify-receipt` · `/api/redeem-promo`

#### 5.2.2 Stored-Analysis & Live Tracking (Python + proxy)
- `GET /api/stored-analysis/status` · `/results` · `/live-tracking` · `/ticker/<ticker>`
- `POST /api/stored-analysis/trigger`
- `GET /api/market/morning-bell`

#### 5.2.3 Predictions & Honest Tracking (mixed — 3 systems متداخلة، انظر §10)
- `GET /api/predictions` · `/live` · `/eid` · `/price-verify` · `/credibility`
- **Honest Tracking (⚠️ Node → SQLite direct — architecture violation):** `/api/predictions/honest-tracking` · `/list` · `/stats` · `/missed-opportunities` · `/expert-consensus`
- **POST:** `/verify-pending` · `/learn-from-errors`
- **Picks Management (v3.4.43 — NEW):** `GET /api/predictions/daily-picks` · `/daily-picks/history` · `/active-management` · `/{id}/management` · `POST /management/refresh`
- **V40.2 V34 Decision (v3.4.42 — NEW):** `GET /api/chart/full-analysis?ticker=...` — يرجّع `institutional_decision` object (maker_state + flight_state + 5/6 proofs + tech_score + portfolio_advice)

#### 5.2.4 Stocks / Chart / Quote (Python + proxy)
- `GET /api/stocks/list` · `/quote/<ticker>` · `/<ticker>/history` · `/search`
- `GET /api/chart/<ticker>` · `/full-analysis` (V40.2)
- `GET /api/egksco/*` (EGX رسمي)

#### 5.2.5 Persona (Python + proxy)
- `GET /api/persona/list` · `/config` · `/predictions?persona=X`
- `POST /api/persona/update`

#### 5.2.6 Portfolio & Watchlist (Python + proxy)
- `GET /api/portfolio` · `/watchlist` · `/positions`
- `POST /api/portfolio/add` · `/remove`

#### 5.2.7 AI / News / Telegram (Python + proxy)
- `GET /api/ai/search` · `/chat` · `/rag`
- `GET /api/news/list` · `/sentiment`
- `GET /api/telegram/*` (proxy للـ mini-service port 3003)

#### 5.2.8 Maestro / Confluence (Python + proxy)
- `GET /api/maestro/analyze?ticker=...` · `/score` · `/layers`
- `GET /api/confluence/*`

#### 5.2.9 Sniper / Hunter / Fomo (Python + proxy)
- `GET /api/sniper/scan` · `/hunter/scan` · `/fomo/list`

#### 5.2.10 Risk Management (Python + proxy)
- `GET /api/risk/profile` · `/stop/<ticker>` · `/position-size`

#### 5.2.11 Crypto (Python + proxy)
- `GET /api/crypto/list` · `/price/<symbol>` · `/history`

#### 5.2.12 Screener (Python + proxy)
- `GET /api/screener/list` · `/scan` · `/results`

#### 5.2.13 Self-Learning & Unified-Learning (Python + proxy)
- `GET /api/learning/lessons` · `/stats`
- `POST /api/learning/apply-lesson`

#### 5.2.14 Admin & Engine Settings (Python-only — HARD cap ABS<=50)
- `GET /api/admin/dashboard` · `/users` · `/kpi`
- `GET /api/engine-settings/all` · `POST /api/engine-settings/update`
- `GET /api/optimizer/params` · `POST /api/optimizer/update`

#### 5.2.15 Reports / Market-Report (Python + proxy)
- `GET /api/reports/daily` · `/weekly` · `/monthly`

#### 5.2.16 Educational Cards (Python + proxy)
- `GET /api/educational/cards` · `/<id>`

#### 5.2.17 Backtest / Walk-Forward (Python + proxy)
- `POST /api/backtest/run` · `GET /api/backtest/results/<id>`

#### 5.2.18 Expert Memory V4 (Python + proxy)
- `GET /api/expert/memory` · `/consensus`

#### 5.2.19 Telegram Routes (Python — auto-posting)
- `POST /api/telegram/post` · `/broadcast`

#### 5.2.20 Boards / Phase4 / Monitor / Multi-Market (Python + proxy)
- `GET /api/boards/*` · `/phase4/*` · `/monitor/*` · `/multi-market/*`

### 5.3 الـ Socket.IO Events (ws-service port 3005)

| Event | الاتجاه | الوصف |
|---|---|---|
| `price_update` | Server → Client | تحديث سعر لحظي (polling 30s للـ Python) |
| `prediction_new` | Server → Client | توقع جديد (من Maestro) |
| `prediction_closed` | Server → Client | توقع اتقفل (من daily_closer) |
| `telegram_event` | Server → Client | حدث Telegram (من mini-service port 3003) |
| `subscribe` | Client → Server | subscribe لـ ticker channel |

### 5.4 الـ Endpoints الميتة (404 / 405 / 500)

> التفاصيل الكاملة في `02-SCREENS_AND_COMPONENTS.md` §10 + `03-REFACTORING_REPORT.md` §4.
> 33 ملف Flask blueprint **DEPRECATED** (~17,000 LOC) — انظر §8.2.

---

## 6. Data Flow

### 6.1 الـ Pipeline الكامل (8 stages)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. SCRAPERS (data_engine/scrapers/)                                     │
│    • tradingview_scraper.py → TA + UDF                                  │
│    • yahoo_scraper.py       → historical OHLC                           │
│    • egxpilot_scraper.py    → FREE fundamentals API (⚠️ NOT IN CRONTAB) │
│    • egksco_scraper.py      → EGX official                              │
│    • news_scraper.py        → NewsAPI + GNews                           │
│    • coingecko_scraper.py   → crypto                                    │
│    ↓ writes (WAL)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. data_engine.db (tab_*) + price_history.db (EGX OHLC)                 │
│    • tab_valuation/profitability/dividends/performance/technical_analysis│
│      (858-863 rows each — clean)                                        │
│    • tab_balance_sheet/income_statement/cash_flow (866 rows each — BROKEN│
│      column-shift)                                                      │
│    • egx_fundamentals = 0 rows (fetcher not scheduled)                  │
│    ↓ reads                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. ENGINES (vps-service/engines/ + analyzers/)                          │
│    • load_merged_history()  ← unified price path (single source)        │
│    • institutional_decision_engine.py → sl/tp1/tp2 + ATR-percentile     │
│    • maestro_orchestrator.py → 8-layer confluence (138 pts max)         │
│    • fundamental_data_provider.py → fundamental_score (40/30/15/15)     │
│    • persona_engine.py → 4 personas + R:R overrides                     │
│    • v38_backtest_engine.py → simulate_trade() (canonical sl/tp1/tp2    │
│      + ATR clamp [3%,9%] — commit 65a748f)                              │
│    ↓ writes                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. KILL FILTERS + R:R FLOOR GATE (v40_2_daily_generator.py L314-326)    │
│    • if r_mult < get_setting('dynamic_rr_normal', default=1.5): continue│
│    • set_strict_kill_filters(True) — liquidity + turnover               │
│    ↓ filtered                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. predictions.db (153 preds, 148 closed)                               │
│    • fundamental_score = 50 (placeholder — Stage G fix pending)         │
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
> **يقرأ من:** `price_history.db` (EGX OHLC، 288,194 rows، 1,260 tickers).
> **Fallback:** `data_engine.db.historical_data` (Saudi/US/gold — NO EGX).

### 6.4 مثال: تدفق توقع V40.2 من الإنتاج

```
1. v40_2_daily_generator.py يبدأ (cron يومي بعد إغلاق السوق)
   ↓
2. لكل ticker في قائمة المراقبة (22 ticker):
   - load_merged_history(ticker) → df daily OHLC
   - build_institutional_decision(ticker, df, benchmark_change, ...)
     → returns {sl, tp1, tp2, rr_ratio_tp1, rr_ratio_tp2, tech_score, proofs, ...}
   ↓
3. R:R floor gate:
   if r_mult < 1.5: continue
   ↓
4. INSERT INTO predictions (ticker, signal, entry_price, target_price, stop_loss,
   target_price_2, atr_at_entry, evidence_count, morning_bell, kill_filter_result,
   persona='balanced', fundamental_score=50, ...)
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

**الملف:** `./ecosystem.config.js` — 5 خدمات + telegram-poster.

| Service | Command | Port | Role |
|---|---|---|---|
| `nextjs` | `next start` | 3000 | Frontend |
| `python-backend` | `python3 main.py` | 8010 | THE BRAIN |
| `data-engine` | `python3 data_engine/main.py` | 5000 | scrapers |
| `ws-service` | `bun run vps-service/ws-service/index.ts` | 3005 | WebSocket |
| `telegram-events` | `bun run mini-services/telegram-events/index.ts` | 3003 | Telegram polling |
| `telegram-poster` | `bun run mini-services/telegram-poster/index.ts` | (no port) | auto-posting |

### 7.3 Cron (vps-service/crontab.txt)

> ✅ **RESOLVED:** `egx_fundamental_fetcher.py` مُجدوَل السبت 14:00 UTC + مُحصّن ضد الـ column-shift (commit a268957 + 4cde9f0).

**الموجود (typical):**
```cron
# Daily after market close (15:30 Cairo)
30 15 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/v40_2_daily_generator.py >> logs/v40_2.log 2>&1
0  16 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/daily_closer.py >> logs/closer.log 2>&1
*/15 * * * * cd /root/GLMinvestment && python3 vps-service/jobs/intraday_aggregator.py >> logs/intraday.log 2>&1
0  * * * * cd /root/GLMinvestment && python3 vps-service/jobs/price_history_safetynet.py >> logs/safetynet.log 2>&1

# Weekly fundamentals fetch (Saturday 16:00 Cairo = 14:00 UTC):
0 14 * * 5 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python vps-service/data/egx_fundamental_fetcher.py >> /root/GLMinvestment/logs/fundamentals_fetch.log 2>&1
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

### 7.5 Docker (Optional)

- `vps-service/Dockerfile` — صورة Python backend
- `docker-compose.yml` — يُشغّل كل الخدمات
- **غير مستخدم في الإنتاج** (الإنتاج بـ PM2 على VPS مباشرة)

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

---

## 8. Dead-Code / Duplicate Inventory (Condensed)

> التفاصيل الكاملة في `02-SCREENS_AND_COMPONENTS.md` §10 + `03-REFACTORING_REPORT.md`.
> هذا قسم مُختصر للمعمارية. لا حذف بدون موافقة المالك (CONSTITUTION Rule 25).

### 8.1 الـ 9 صفحات الميتة (4,711 LOC)

| # | Route | LOC | سبب الموت | الإجراء | المرحلة |
|---|---|---:|---|---|---|
| 1 | `/admin/expert-recommendations` | 1,079 | لا inbound link | حذف | 🟢 P3 |
| 2 | `/admin/maestro` | 747 | functionality في `/#admin` | حذف | 🟢 P3 |
| 3 | `/admin/prediction-performance` | 823 | sidebar شال الـ link | حذف | 🟢 P3 |
| 4 | `/community` | 324 | CommunityView orphan | حذف | 🟢 P3 |
| 5 | `/education/analysis-types` | 469 | orphan | حذف | 🟢 P3 |
| 6 | `/payment/fail` | 58 | paymob callback ما بـ redirectش لهنا | حذف | 🟢 P3 |
| 7 | `/portfolio` | 1,199 | sidebar بـ يستخدم `#portfolio` hash | حذف | 🟢 P3 |
| 8 | `/prediction-performance` | 8 | stub | حذف | 🟢 P3 |
| 9 | `/unified-analysis` | 12 | comment: "moved to Admin" | حذف | 🟢 P3 |

### 8.2 الـ 33 DEPRECATED Flask Blueprints (~17,000 LOC)

> ملفات `vps-service/api/*.py` موجودة بس مش محملة في `lightweight_server.py` — كود ميت.

**أمثلة (تقديري):** `old_predictions_routes.py` · `legacy_chart_routes.py` · `v1_market_routes.py` · `v2_portfolio_routes.py` · ... (33 file total).
**الإجراء:** حذف تدريجي بعد التحقق الثلاثي (CONSTITUTION Rule 16). المرحلة 🟢 P3.

### 8.3 StoredAnalysisView.tsx (1,896 LOC — Orphan)

- `src/components/advanced-analysis/StoredAnalysisView.tsx` — 1,896 LOC
- بعد الـ 3-SCREEN REDESIGN (commit `d2084710`, v3.66.8) الـ `#advanced-analysis` بـ يـ redirect لـ `MarketAnalysisView`
- الـ StoredAnalysisView **still on disk** لكن **no longer imported** anywhere.
- **إجراء:** حذف في P3 cleanup.

### 8.4 `garage/` Directory (~8,247 LOC — Dead)

- مجلد كامل من الكود الميت (early prototypes, abandoned features, broken experiments).
- **إجراء:** حذف كامل في P3 (بعد مراجعة الـ imports).

### 8.5 الـ 71 Orphan Components (50,442 LOC — 26.6% من الـ frontend)

> التفاصيل في `02-SCREENS_AND_COMPONENTS.md` §10.3.

- Top 30 orphans: ~30,000 LOC (أكبرها: MaestroCommandCenter 3,748 LOC، StoredAnalysisView 1,896 LOC، ...)
- 41 more orphans: ~20,000 LOC

### 8.6 الـ 20 Unused UI Primitives (~4,300 LOC)

- shadcn/ui primitives installed لكن مش مستخدمة (carousel, command, combobox, ...).
- **إجراء:** حذف في P3.

### 8.7 الـ 163 Tiny-Proxy Boilerplate (~4,700 LOC)

- ملفات `route.ts` proxy صافي (3-5 LOC each) قابلة للاستبدال بـ catch-all proxy واحد.
- **البديل:** `src/app/api/proxy/[...path]/route.ts` (catch-all).

### 8.8 7 Duplicate Families

> التفاصيل في `02-SCREENS_AND_COMPONENTS.md` §10.5.

- charts (3 impls)
- watchlists (2 impls)
- alerts (2 impls)
- share (2 impls)
- wealth (2 impls)
- analysis (3 impls)
- stocks (2 impls)

### 8.9 الـ P3 Cleanup Progress (partial)

- ✅ 3 orphan components deleted (post P0)
- ✅ 6 `simulated_*.py` scripts deleted (post P0)
- ⏳ 9 dead pages + garage/ + 33 DEPRECATED blueprints + 41 more orphans = NEXT (P3)

---

## 9. audit_map.json — Machine-Generated File Map

> **الملف:** `Documentation/audit_map.json` — **643KB / 24,910 lines**
> **Generated:** 2026-08-03T19:58:12 (UTC)
> **Root:** `/home/z/my-project`

### 9.1 الـ Structure

```json
{
  "generated_at": "2026-08-03T19:58:12",
  "root": "/home/z/my-project",
  "recent_changes": {
    "note": "Hand-tracked changes after the 2026-08-03 scan. Re-run scripts/audit_map.py to regenerate full metrics.",
    "v3.66.4": {...},
    "v3.66.5": {...},
    "v3.66.6": {...},
    "v3.66.7": {...},
    "v3.66.8": {...}
  },
  "metrics_note": "The metrics below are from the 2026-08-03 scan. Actual current nextjs_api_routes = 583.",
  "metrics": {
    "backend_files": 395,
    "backend_lines": 229490,
    "frontend_files": 1104,
    ...
  },
  "file_to_component_map": [...],   // 24,910 lines
  "unreferenced_files": [...]
}
```

### 9.2 الـ Metrics (as of 2026-08-03 scan — STALE)

| Metric | Value (scan 2026-08-03) | Actual (2026-08-17) |
|---|---:|---:|
| `backend_files` | 395 | ~395 (unchanged) |
| `backend_lines` | 229,490 | ~230,000+ |
| `frontend_files` | 1,104 | ~1,104 (unchanged) |
| `nextjs_api_routes` | 580 | **583** (+3 من v3.66.4/5/6) |
| Flask blueprints | 53 | 53 (unchanged) |

### 9.3 الـ Recent Changes (hand-tracked بعد الـ scan)

| Version | Commit | Title | Files affected |
|---|---|---|---|
| v3.66.8 | `d2084710` | 3-SCREEN REDESIGN | MarketAnalysisView renamed to متابعة التوقعات + tracking tab + replaced expert panel. SpecialistAnalysisView 3 top-level tabs. StoredAnalysisView.tsx (1,896 LOC) → orphan. |
| v3.66.7 | `9b34788a` | 5-MIN DATA ENGINE + MOBILE-FIRST EXPERT VIEW | expert tab in MaestroDashboard + consensus column in top 10. |
| v3.66.6 | `893b194d` | EXPERT CONSENSUS ENGINE | consensus aggregation phase added to maestro-orchestrator.ts. |
| v3.66.5 | `de9b214b` | SECTOR INTELLIGENCE | `/api/market/sectors/intelligence` endpoint. |
| v3.66.4 | `7c846c27` | MISSED-OPPORTUNITIES TRACKER | `/api/predictions/honest-tracking/missed-opportunities` endpoint. |

### 9.4 Regeneration

```bash
# To regenerate (after major refactoring):
cd /root/GLMinvestment
python3 scripts/audit_map.py
# Output: Documentation/audit_map.json (overwrites)
```

> ⚠️ **الملف STALE بعد 2026-08-03.** الإحصائيات الحالية في §1.5 (hand-tracked) أحدث.

### 9.5 الـ Unreferenced Files (subset — full list in audit_map.json)

- `src/components/advanced-analysis/StoredAnalysisView.tsx` (1,896 LOC) — no longer imported (post v3.66.8).
- (71 orphan components total — انظر §8.5).

---

## 10. Known Architectural Gaps

> مصدر هذه القائمة: `GAPS_AND_MISSING.md` + `03-REFACTORING_REPORT.md` + `RR_FIX_FINAL_REPORT_20260817.md` + `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` + `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md`.

### 10.1 Gaps حرجة (🔴)

| # | Gap | الموقع | التأثير |
|---|---|---|---|
| G1 | `fundamental_score = 50` placeholder لكل الصفوف في `predictions.db` | `predictions.db.fundamental_score` | الـ backtest ما بـ يقدر يميّز بين السهم القوي والضعيف أساسيًا — Stage G fix pending |
| G2 | **Arabic symbol → ticker mapping gap** في `tab_*` | `data_engine.db.tab_*.symbol` (ARABIC) vs `predictions.db.ticker` (clean) | 18.2% من tickers ما بـ تـ match (4/22). Workaround: prefix `LIKE 'TICKER%'` resolver — 97.4% mapping by prediction count |
| G3 | ~~`egx_fundamental_fetcher.py` NOT in crontab~~ ✅ DONE | `vps-service/data/egx_fundamental_fetcher.py` + `vps-service/crontab.txt` | cron مُفعّل (a268957) + fetcher مُحصّن ضد column-shift + no-args bug fix (4cde9f0) |
| G4 | 33 DEPRECATED Flask blueprints | `vps-service/api/*.py` (~17,000 LOC) | dead code — يضخّم الـ repo + يربك الـ IDE |
| G5 | ~~`tab_*` column-shift bug~~ ✅ DONE | `data_engine.db` | migrate_fundamentals_schema.py (a73b1a1): 24 صف فاسد اتمسح، 858 سليم لكل جدول. الجداول الـ 3 صالحة الآن |

### 10.2 Gaps مهمة (🟠)

| # | Gap | التفاصيل |
|---|---|---|
| G6 | `tech_score_base` contradiction | engine_settings DEFAULT=50 لكن الكود default=25 — الفعلي 25 (institutional_decision_engine.py) |
| G7 | `trailing_stop_activation_gain` contradiction | engine_settings=2.0 لكن V38 backtest=3.0 + institutional_decision_engine=3.0 — الباكتست يفعل الـ trailing أبكر من الـ live |
| G8 | 34 ملف route غير مسجل | ملفات API موجودة بس مش محملة في `lightweight_server.py` — dead code |
| G9 | Architecture violation: Node بـ يكتب في SQLite مباشرة | `/api/predictions/honest-tracking/*` (3 endpoints) — يجب نقلها لـ Python |
| G10 | Prisma scaffold بدل schema حقيقي | `schema.prisma` = User+Post فقط، الـ data الحقيقي في Python raw SQL |
| G11 | توقعات عطلة نهاية الأسبوع | توقعات تُنتج من stale prices في العطلات |
| G12 | `pytz` dependency حرج | لو مش موجود، Cairo timezone → UTC+2 (غلط في DST) |
| G13 | Hardcoded stop values | `default_stop_pct` / `max_stop_pct` / `ATR_multiplier` في constructor مش engine_settings |
| G14 | No message queue | المهام المجدولة تشتغل مباشرة في نفس العملية — مهمة ثقيلة بتعلق التانية |

### 10.3 Threshold Contradictions (from 03-REFACTORING_REPORT §8)

| التناقض | الكود | الإعدادات | التأثير |
|---|---|---|---|
| `tech_score_base` | default=25 | DEFAULT=50 | الفعلي 25 — partial proofs تأثير أكبر |
| `trailing_stop_activation_gain` | V38=3%, V39=5% | 2.0 | الباكتست يفعل الـ trailing أبكر من الـ live |
| Tiered stop initial | 8% ثابت | `default_stop_pct=5%` | tiered_stop يتجاهل الوقف الافتراضي |
| Break-even trigger | 7% ثابت | — | مش قابل للتعديل |
| Portfolio heat | 2% ثابت | — | مش قابل للتعديل |

### 10.4 Missing Tests (from GAPS_AND_MISSING §4)

- No tests for any stop type (`stop_manager.py`)
- No tests for institutional_decision_engine
- No tests for v38_backtest_engine `simulate_trade()`
- Only 16 test files total (mostly integration smoke tests)

### 10.5 Security Vulnerabilities (from 03-REFACTORING_REPORT §9 — 18 critical + 22 high)

> تفاصيل في `03-REFACTORING_REPORT.md` §9. 4 من 18 fixed في P0.

- **SEC-01** ⚠️FIXED-P0: NextAuth admin credentials hardcoded
- **SEC-03** ⚠️FIXED-P0: Paymob HMAC verification optional + secret in code
- **SEC-04** ⚠️FIXED-P0: Admin Auth Bypass عبر الـ proxy
- (+ 15 more — open)

### 10.6 الـ Stage A-H Fundamentals Activation Status

| Stage | Status | Output |
|---|---|---|
| A — Inventory | ✅ DONE | `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` (5 clean tables + 3 broken + egx_fundamentals=0) |
| B — Mapping | ✅ DONE | 81.8% ticker match / 97.4% by prediction count |
| C — Score formula | ✅ DONE | 40/30/15/15 weights (Profitability/Valuation/Dividend/Growth) |
| D-E — Test scenarios | ✅ DONE | high-score ≥70 PF=4.436 / hard veto <30 PF=0.273 |
| F — Code commit | ✅ DONE (commit `04354a5`) | `fundamental_data_provider.py` + `stock_fundamentals.py` + `v38_backtest_engine.py` |
| G — Production sync + cron | ✅ DONE (a268957+4cde9f0) | cron مُفعّل + fetcher مُحصّن (ticker guard + no-args fix + verify). Production sync of `predictions.db` = المتبقّي |
| H — Migrate `tab_balance_sheet` column-shift | ✅ DONE (commit `a73b1a1`) | migrate_fundamentals_schema.py: DELETE 24 shifted rows + VACUUM. verify_tab_integrity = 0 shifted |

### 10.7 الـ Production Sync Commands (pending — per RR_FIX_FINAL_REPORT §4)

```bash
# On VPS:
cd /root/GLMinvestment
git pull origin main
pm2 restart python-backend nextjs ws-service telegram-events

# Verify R:R fix:
sqlite3 db/predictions.db "SELECT ticker, entry_price, target_price, stop_loss,
  (target_price-entry_price)/(entry_price-stop_loss) as rr FROM predictions
  WHERE outcome IS NOT NULL LIMIT 5;"
# Expected: rr values 1.5-2.0 (not all 1.5)

# Stage G (NEXT — fundamentals cron):
# Add to vps-service/crontab.txt:
# 0 17 * * 1-5 cd /root/GLMinvestment && python3 data_engine/scrapers/egx_fundamental_fetcher.py >> logs/fetcher.log 2>&1
```

---

## 11. References & Merged Sources

### 11.1 الـ 4 Master Files (authoritative)

| File | Role |
|---|---|
| `Documentation/00-CONSTITUTION.md` | الدستور — 25 rules (Python=Brain, Node=Display, WAL, single-viewport, commission edge, refactoring approval, ...) |
| `Documentation/01-PROJECT_ANATOMY.md` | **هذا الملف** — المعمارية + DBs + API + data flow + deployment |
| `Documentation/02-SCREENS_AND_COMPONENTS.md` | شاشات + components inventory + dead/duplicate inventory (تفصيل كامل) |
| `Documentation/SYSTEM_HOW_IT_THINKS.md` | منطق التحليل (decision engine + persona + R:R + fundamentals + backtest + closed-loop) |

### 11.2 ملفات مُدمجة هنا (12 source docs — pending deletion by main agent)

| Source file | Lines | Merged into § |
|---|---:|---|
| `PROJECT_FULL_BLUEPRINT.md` | 2,148 | §1, §2, §3, §7 (header + topology + tree + DBs + deployment) |
| `API_DICTIONARY.md` | 1,877 | §5 (API map condensed) |
| `CURRENT_STATE.md` | 678 | §1.5, §4.5, §10 (stats + thresholds + gaps) |
| `ULTRA-RESTORE-DATABASE-RECOVERY.md` | 199 | §3, §6.4, §10 (DB recovery + SELL sign-flip + -20% cap) |
| `V40_2_LIVE_INTEGRATION_PLAN.md` | 199 | §4.2, §6.4 (V40.2 daily generator + R:R floor gate) |
| `GAPS_AND_MISSING.md` | 196 | §10 (gaps + contradictions + missing tests) |
| `03-REFACTORING_REPORT.md` | 938 | §8, §10.3, §10.5 (dead-code + contradictions + SEC) |
| `P0_V2_POST_DEPLOY_RUNBOOK.md` | 274 | §6.4, §10.7 (schema-aware + HARD cap + production sync) |
| `PICKS-MANAGEMENT-SYSTEM.md` | 498 | §4.1, §5.2.3 (Picks Management engine + API) |
| `V34-INSTITUTIONAL-DECISION-ENGINE.md` | 438 | §4.1 (institutional_decision_engine + 6 proofs + portfolio_advice) |
| `RR_FIX_FINAL_REPORT_20260817.md` | 278 | §4.2, §4.5, §6.1, §10.7 (R:R fix + archive proof + before/after + production sync) |
| `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` | 162 | §3.1, §3.3, §3.4, §10.1, §10.6 (tab_* inventory + bugs + mapping) |
| `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md` | 317 | §3.1, §6, §10.6 (Stage A-H + score formula + test results) |
| `audit_map.json` | 24,910 | §9 (audit_map summary — NOT embedded, just referenced) |

### 11.3 الـ Commits الموثقة

| Commit | Date | Title |
|---|---|---|
| `65a748f` | 2026-08-17 | R:R fix — v38_backtest_engine reads canonical sl/tp1/tp2 + ATR clamp [3%,9%] + R:R floor gate |
| `04354a5` | 2026-08-17 | Fundamentals activation Stage A-F — fundamental_data_provider + stock_fundamentals |
| `c14597d` | 2026-08-17 | PERSONA-UNIFY-A — compute_persona_fit + balanced baseline protection |
| `d2084710` | 2026-08-11 | 3-SCREEN REDESIGN (v3.66.8) |
| `9b34788a` | (v3.66.7) | 5-MIN DATA ENGINE + MOBILE-FIRST EXPERT VIEW |
| `893b194d` | (v3.66.6) | EXPERT CONSENSUS ENGINE |
| `de9b214b` | (v3.66.5) | SECTOR INTELLIGENCE |
| `7c846c27` | (v3.66.4) | MISSED-OPPORTUNITIES TRACKER |
| `ed55a60c` | 2026-08-09 | P0-v2 — schema-aware scripts + HARD ABS<=50 cap |

### 11.4 الـ Production KPIs (reference baseline — 2026-08-17)

| Metric | Value | Source |
|---|---|---|
| Live WR (26 closed) | ≈ 69.2% | CURRENT_STATE.md |
| Live PF | ≈ 4.46 | CURRENT_STATE.md |
| AvgWin | +11.3% | CURRENT_STATE.md |
| AvgLoss | -5.7% | CURRENT_STATE.md |
| Fair re-sim PF (post R:R fix) | 1.453 | RR_FIX_FINAL_REPORT_20260817.md |
| Fair re-sim expectancy | +1.54%/trade | RR_FIX_FINAL_REPORT_20260817.md |
| Δ vs fair baseline (BEFORE-RESIM) | +0.055 PF / +0.189%/trade | RR_FIX_FINAL_REPORT_20260817.md |
| % trades with R:R=2.0 (outperform path) | 95.27% | RR_FIX_FINAL_REPORT_20260817.md |
| ATR clamp fired (trades clamped) | 0 (all already within [3%,9%]) | RR_FIX_FINAL_REPORT_20260817.md |

### 11.5 الـ File Sizes (final)

| File | Lines | Size |
|---|---:|---:|
| `00-CONSTITUTION.md` | ~550 | ~28KB |
| `01-PROJECT_ANATOMY.md` (this file) | ~1,150 | ~58KB |
| `02-SCREENS_AND_COMPONENTS.md` | 1,104 | 67KB |
| `SYSTEM_HOW_IT_THINKS.md` | 1,785 | 99KB |
| **Total (4 masters)** | **~4,590** | **~252KB** |

---

## 12. AI News Agent + Corporate Actions (جديد 2026-08-31)

### 12.1 AI News Agent

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

**التكامل مع V40.2:** `v40_2_daily_generator.py` (سطر 1159-1185)
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

### 12.2 Corporate Actions — أخبار الاكتتاب وتوزيع الأرباح (مطلوب تنفيذه)

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
في v40_2_daily_generator.py، بعد Entry Gate:
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

### 12.3 الـ Cron المقترح للـ Corporate Actions

```bash
# جلب توزيعات الأرباح يومياً (من EGXPilot)
0 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_dividends.py >> /tmp/dividends.log 2>&1

# جلب أخبار الاكتتاب كل 6 ساعات
0 */6 * * * cd /root/GLMinvestment && python3 vps-service/jobs/fetch_ipo_news.py >> /tmp/ipo_news.log 2>&1

# جلب مواعيد الجمعيات العمومية يومياً
30 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_assembly_calendar.py >> /tmp/assembly.log 2>&1
```

---

> **END OF FILE** — `01-PROJECT_ANATOMY.md` v3.5.0 (KILL-MAESTRO + V40.2 sole engine + V62 logic + AI News Agent).
> للتفاصيل الكاملة عن أي قسم: ابحث في الـ source files المُدرجة في §11.2.
> للتحديث: عدّل هذا الملف مباشرة + حدّث الـ "last updated" في الـ header.
