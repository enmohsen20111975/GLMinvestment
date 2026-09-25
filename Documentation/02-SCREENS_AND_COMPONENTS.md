# 🖥️ 02 — دليل الشاشات والمكوّنات — GLMinvestment Frontend (Single Source of Truth)

> **هذا هو المصدر الأوحد للحقيقة (single source of truth) لكل شاشة وكل مكوّن** في الواجهة (Next.js 16 + React 18 + TypeScript). لكل عنصر: الحالة (نشط/ميت/مكرر)، الموقع، LOC، الوظيفة، الـ API المستدعى، والديون التقنية.
>
> **الهدف:** مرجع كامل لكل ما يخص الـ UI يمنع إنشاء شاشات/مكوّنات مكررة، ويوضّح ما هو نشط فعلًا على الإنتاج وما هو مرشّح للحذف.
>
> **آخر تحديث:** 2026-09-25 (DOC-CONSOLIDATION pass: إضافة §0 شاشة الحالات المُجمَّعة (Screen Status Rollup) + تحديث عدّادات §1 — 274 component، 653 API route، 5-market + UI-Mirror + SQLite fallback).
> **آخر تحديث سابق:** 2026-09-01 (إضافة NotebookAdminTab.tsx في AdminView + تحديث علامة "آخر تحديث" لتعكس الـ admin tab الجديد لـ Stock Notebooks).
> **آخر تحديث سابق:** 2026-08-17 (post R:R fix commit `65a748f` + post fundamentals activation `04354a5` + post PERSONA-UNIFY-A `c14597d`).
> **المصادر المُدمجة:** كل ملفات `Documentation/*.md` السابقة (PICKS-MANAGEMENT-SYSTEM · CLOSED_LOOP_FINAL · CURRENT_STATE · PERSONA_UNIFY_A_MEASUREMENT_REPORT · PROJECT_FULL_BLUEPRINT · API_DICTIONARY · V40_2_LIVE_INTEGRATION_PLAN · RR_FIX_FINAL_REPORT_20260817 · P0_V2_POST_DEPLOY_RUNBOOK · V34-INSTITUTIONAL-DECISION-ENGINE · GAPS_AND_MISSING · ULTRA-RESTORE-DATABASE-RECOVERY · DATA_ENGINE_FUNDAMENTALS_INVENTORY · FUNDAMENTALS_HISTORICAL_TEST_REPORT · RL-FIX-9-Predictions-Status-Logic · 03-REFACTORING_REPORT) + `audit_map.json` + `treadingView.code.text` + استكشاف آلي لـ `src/app/` + `src/components/`.
>
> 📚 **توحيد التوثيق:** هذا واحد من **4 ملفات رئيسية**:
> 1. `00-CONSTITUTION.md` — الحوكمة والقواعد.
> 2. `01-PROJECT_ANATOMY.md` — المعمارية والمحركات والـ DBs.
> 3. **`02-SCREENS_AND_COMPONENTS.md`** (هذا الملف) — كل شاشة وكل مكوّن.
> 4. `SYSTEM_HOW_IT_THINKS.md` — منطق التحليل.
>
> **القاعدة الدستورية المرتبطة:** Rule 3 (لا تُنشئ صفحات Next.js جديدة — كل شيء في الـ single-page shell) · Rule 20 (Python = العقل، Node = عرض فقط) · Rule 25 (أي refactoring يحتاج موافقة المالك + VERIFY-BEFORE-DELETE) · Rule 53 (CRYPTO-IN-MARKETS — UI-Mirror Protocol).

---

## 0. شاشة الحالات المُجمَّعة (Screen Status Rollup — 2026-09-25)

> **الهدف:** لقطة سريعة لحالة كل شاشة رئيسية في النظام. الحالات: ✅ working · ⚠️ partial · ❌ broken · 🚫 deprecated.
> التفاصيل الكاملة لكل شاشة في §4 (الـ views) و §9 (الـ admin).

| # | الشاشة (view ID) | الحالة | ملاحظات (2026-09-25) |
|---|---|---|---|
| 1 | `dashboard` | ✅ working | يعرض indices + backtest table + liquidity flow + intraday pressure + investors flow + crypto signals (حسب currentMarket). |
| 2 | `stocks` (stock-filters / screener) | ✅ working | schema-aware SQLite fallback (Python → SQLite → data_engine.db) + dynamic sectors لكل سوق. |
| 3 | `smart-confluence` | ✅ working | يعرض 20 BUY predictions مأخوذة من V40.2 generator. |
| 4 | `trading-chart` | ⚠️ partial (1 non-critical error in widget) | الشارت يعرض 5m/15m/30m/1h/1D/1W + range bar؛ خطأ widget غير حر في `<TradingViewChart>` (معالَج عبر `<ErrorBoundary>` — لا يسبب crash). |
| 5 | `recommendations` (متابعة التوقعات) | ✅ working | 6-7 tabs (3 personas + tracking + summary + missed + learn-from-errors). يستخدم `/api/predictions/honest-tracking/*`. |
| 6 | `picks-management` | ✅ working | 5 daily picks + history + active management. |
| 7 | `reports` | ✅ working | auth-protected — image cards (persona, market status, stock league, top trades). |
| 8 | `live-monitor` | ✅ working | مراقبة لحظية + intraday pressure + market depth + investors flow (EGX/TADAWUL/KSE/QSE فقط). |
| 9 | `trading-memory` | ✅ working | auth-protected — `/api/python/v4/insight/*` (⚠️ Blueprint `v4_bp` غير مسجّل — P1.9). |
| 10 | `portfolio` | ✅ working | Enhanced portfolio view + multi-portfolio + position deep-dive + risk profiler quiz. |
| 11 | `watchlist` | ✅ working | Enhanced watchlist + professional view. |
| 12 | `alerts-center` | ✅ working | مركز التنبيهات + smart alerts panel + sniper scan polling. |
| 13 | `wealth` | ✅ working | wealth charts + real return panel. |
| 14 | `crypto` (+ 8 crypto sub-views) | ✅ working | UI-Mirror Protocol — نفس المكوّنات بـ `currentMarket='CRYPTO'`. |
| 15 | `specialist-analysis` | ✅ working | تحليل المتخصصين + Fibonacci + Candlestick widgets. |
| 16 | `learning` + `academy` | ✅ working | مركز التعلم + أكاديمية + CandlestickSimulator + StrategySandbox + PaperTradingWorkstation. |
| 17 | `simulation` | ✅ working | محاكاة الورق + paper-trading-v2. |
| 18 | `zakat` + `tithes` | ✅ working | Islamic finance (zakat + tithes). |
| 19 | `subscription` | ✅ working | الباقات + Paymob + Google Play receipt verification. |
| 20 | `auth` + `settings` + `about` | ✅ working | NextAuth (Google + Bearer) + user settings + static about. |
| 21 | `admin` | ✅ working | 16+ sub-tabs (Maestro disabled per KILL-MAESTRO، NotebookAdminTab active، Backtest، Telegram، Crypto، Forex، SystemControl، Users، ...). |
| 22 | `backtesting` | ⚠️ partial (hidden) | `<EGXBacktestDashboard />` — لا entry في الـ sidebar (legacy). |
| 23 | `prediction-performance` / `prediction-credibility` | 🚫 deprecated (DEAD) | يرجّع placeholder — admin-only. |
| 24 | `community` | 🚫 deprecated (DEAD) | شالها الـ sidebar + CommunityView orphan (581 LOC). |
| 25 | `trading-journal` / `unified-analysis` / `StoredAnalysisView` | 🚫 deprecated (moved/distributed) | مُوزَّعة على admin / recommendations / specialist-analysis. |

**الإحصائيات الإجمالية (2026-09-25):**
- Next.js page routes: 20 (9 نشطة · 9 ميتة · 2 redirect)
- Next.js API routes: **653 route.ts** (156 top-level directory + nested) · 257 proxy لـ Python · ~331 direct · 163 tiny-proxy boilerplate
- Hash views في `page.tsx`: 45 (~35 نشطة · ~10 legacy/hidden/alias)
- React components: **274 tsx** + 3 ts (non-tsx) = 277 total under `src/components/`
- UI primitives المستخدمة: 49 (29 مستخدمة بكثرة + 20 orphan)
- مكوّنات orphan (dead): 71 (50,442 LOC ميتة — 26.6%)
- Flask Blueprints: 53 registered (33 DEPRECATED api files ~17,000 LOC)

---

## 📑 المحتويات

0. [شاشة الحالات المُجمَّعة (Screen Status Rollup — 2026-09-25)](#0-شاشة-الحالات-المجمعة-screen-status-rollup--2026-09-25)
1. [نظرة عامة + الإحصائيات الكلية](#1-نظرة-عامة--الإحصائيات-الكلية)
2. [الشاشة الوحيدة المرئية: `/` (src/app/page.tsx)](#2-الشاشة-الوحيدة-المرئية--srcapppagetsx)
3. [بنية الـ Sidebar / Nav / Header / Footer](#3-بنية-الـ-sidebar--nav--header--footer)
4. [كل VIEW بحالته (ACTIVE/DEAD/DUPLICATE)](#4-كل-view-بحالته-activedeadduplicate)
5. [واجهة الشخصيات (Persona UI)](#5-واجهة-الشخصيات-persona-ui)
6. [واجهة متابعة التوقعات (Prediction-Tracking UI)](#6-واجهة-متابعة-التوقعات-prediction-tracking-ui)
7. [واجهة إدارة التوصيات (Picks Management UI)](#7-واجهة-إدارة-التوصيات-picks-management-ui)
8. [الطبقة المغلقة (Closed-Loop UI)](#8-الطبقة-المغلقة-closed-loop-ui)
9. [جرد شاشات الأدمن (Admin Views Inventory)](#9-جرد-شاشات-الأدمن-admin-views-inventory)
10. [جرد المكوّنات الميتة والمكررة (Dead/Duplicate Inventory)](#10-جرد-المكوّنات-الميتة-والمكررة-deadduplicate-inventory)
11. [الديون التقنية + خطة الـ Refactoring (مختصر)](#11-الديون-التقنية--خطة-الـ-refactoring-مختصر)
12. [المؤشرات الخارجية (TradingView Pine Script V34)](#12-المؤشرات-الخارجية-tradingview-pine-script-v34)
13. [خريطة التبعيات (Dependency Map)](#13-خريطة-التبعيات-dependency-map)
14. [المراجع والملفات المُدمجة](#14-المراجع-والملفات-المدمجة)

---

## 1. نظرة عامة + الإحصائيات الكلية

> **(مُحدَّث 2026-09-25 — DOC-CONSOLIDATION)** القيم النهائية مُجمَّعة في §0 (Screen Status Rollup). القيم التالية هي الأرقام المرجعية من الكود الفعلي.

| الفئة | العدد | الحالة |
|------|------:|--------|
| **Next.js page routes** | 20 | 9 نشطة · 9 ميتة · 2 redirect |
| **Next.js API routes** | **653** | 257 proxy لـ Python · 331 direct · 163 "tiny-proxy" boilerplate (~4,700 LOC) |
| **Hash views في `page.tsx`** | 45 | ~35 نشطة · ~10 legacy/hidden/alias |
| **React components** | **274** (tsx) + 3 (ts) = 277 | 49 UI primitives + 228 non-UI |
| **UI primitives المستخدمة** | 49 | 29 مستخدمة بكثرة · 20 orphan (~4,300 LOC) |
| **مكوّنات orphan (ميتة)** | 71 | **50,442 LOC ميتة (26.6% من الإجمالي)** |
| **مكوّنات massive (>500 LOC)** | 139 | 49 منها أيضًا orphan |
| **`garage/` directory** | 7 ملفات | **8,247 LOC — كلها ميتة** |
| **Flask Blueprints** | 53 مسجّل / 65 ملف | 33 DEPRECATED api files (~17,000 LOC) |
| **إجمالي LOC (Frontend components)** | ~189,785 | 100% |
| **إجمالي LOC (API routes)** | ~66,885 | 100% |

### قاعدة "Python = العقل، Node = عرض فقط" (Rule 20)

كل الـ API routes في `src/app/api/` يفترض أنها واحدة من 3 أنواع:
1. **🔄 Pure Proxy** — تمرّر الطلب لـ Python على `localhost:8010` (الغالبية العظمى).
2. **🔒 Auth/Paywall Gate** — تدير session/subscription/payment/JWT (Prisma + SQLite).
3. **⚠️ Architecture Violation** — 3 endpoints بتفحص SQLite مباشرة من Node (مرشّحة للإزالة).

> أي `if/for/compute/aggregate` في `route.ts` لغير الـ auth/subscription/paywall = **architecture violation**.

---

## 2. الشاشة الوحيدة المرئية: `/` (src/app/page.tsx)

> **القاعدة الدستورية 3:** لا تُنشئ صفحات Next.js جديدة. كل الـ views تُحمّل داخل `src/app/page.tsx` عبر hash-based routing.

### 2.1 الـ App Shell

**الملف:** `src/app/page.tsx` (~574 LOC) — **single-page shell**.

**آلية الـ routing:** hash-based عبر `useAppStore().currentView` (zustand). المستخدم يتنقّل عبر `/#<view-name>` (مثلاً `/#stocks`, `/#recommendations`, `/#admin`).

**تكوين الـ shell (الـ components المُستوردة داخله):**

```
page.tsx (AppShell)
├── <DbSchemaInit />              # POST /api/finance/schema + GET /api/init-db
├── <SessionSync />               # NextAuth → zustand
├── <UrlHashSync />               # hash ↔ currentView
├── <RealtimeTicker />            # Top scrolling ticker
├── <CentralAlertMonitor />       # polls /api/sniper/scan كل 60s
├── <AppGuideAutoOpen />          # PlatformGuide عند أول زيارة
├── <Sidebar />                   # Nav يميني (RTL، 4 أقسام + admin)
├── <main>{renderView()}</main>   # switch على currentView (45 case)
│   └── dynamic() + ssr:false + withErrorBoundary
├── <Footer />                    # Social + legal links (STICKY FOOTER — يجب أن يبقى ثابتًا أسفل كل الصفحات)
├── <MobileNav />                 # Bottom 5 icons (موبايل فقط)
├── <FloatingAssistant />         # زر AI عائم أسفل اليمين
├── <RoboNotifierToggle />        # زر إشعارات حية أسفل اليسار
├── <NotificationCenter />        # Panel منزلق للإشعارات
└── <Toaster dir="rtl" />         # Sonner toaster
```

### 2.2 آلية `renderView()`

كل case في الـ switch بـ يستخدم `next/dynamic` مع `ssr:false` لتفادي hydration errors:

```typescript
const StocksView = dynamic(() => import('@/components/stocks/StocksView'), { ssr: false });
const MarketAnalysisView = dynamic(() => import('@/components/analysis/MarketAnalysisView'), { ssr: false });
// ... 45 view مُسجّلة
```

كل view مُغلّف بـ `<ErrorBoundary>` (في `shared/ErrorBoundary.tsx`, 272 LOC) لمنع انهيار الـ shell بالكامل لو في view رمى استثناء.

### 2.3 الصفحات الفرعية (Next.js pages)

بجانب `/`، يوجد 11 صفحة Next.js نشطة (معظمها admin iframe أو legal):

| # | Route | File | LOC | الوظيفة |
|---|-------|------|----:|---------|
| 1 | `/admin/educational-cards` | `src/app/admin/educational-cards/page.tsx` | 1702 | Admin UI للـ educational cards (CRUD + نشر Telegram) — يُحمّل داخل AdminView iframe |
| 2 | `/admin/honest-predictions` | `src/app/admin/honest-predictions/page.tsx` | 1919 | Admin historical-predictions generator — iframe داخل AdminView |
| 3 | `/admin/reports` | `src/app/admin/reports/page.tsx` | 118 | Trading Reports Hub (Stock League image cards) |
| 4 | `/maestro` | `src/app/maestro/page.tsx` | 124 | Standalone Maestro page (admin-gated) |
| 5 | `/stock/[ticker]` | `src/app/stock/[ticker]/page.tsx` | 1233 | صفحة تفاصيل السهم (price/technicals/fundamentals/news/charts) |
| 6 | `/legal/disclaimer` | `src/app/legal/disclaimer/page.tsx` | 207 | إخلاء المسؤولية (عربي) — من Footer |
| 7 | `/legal/privacy` | `src/app/legal/privacy/page.tsx` | 195 | سياسة الخصوصية (عربي) |
| 8 | `/legal/terms` | `src/app/legal/terms/page.tsx` | 263 | شروط الخدمة (عربي) |
| 9 | `/payment/success` | `src/app/payment/success/page.tsx` | 156 | معالج نجاح الدفع (paymob callback) |
| 10 | `/admin` | `src/app/admin/page.tsx` | 35 | redirect → `/#admin` (الـ admin في الـ shell) |

> **الـ 9 صفحات الميتة (4,711 LOC) مذكورة في §10.1.**

---

## 3. بنية الـ Sidebar / Nav / Header / Footer

### 3.1 `layout/Sidebar.tsx` (604 LOC) — النشطة ✅

**الموقع:** `src/components/layout/Sidebar.tsx`
**الحالة:** ✅ ACTIVE (2 importers — page.tsx + AdminView)
**الوظيفة:** القائمة الجانبية اليمينية (RTL) — تحتوي 4 أقسام رئيسية + عناصر سفلية + زر admin.

**الأقسام الأربعة:**

| القسم | اللون | الحالة الافتراضية | العناصر |
|------|------|-------------------|---------|
| **market** (السوق) | emerald | مفتوح | dashboard, stocks, trading-chart, recommendations (متابعة التوقعات), picks-management, specialist-analysis, reports, learning, simulation, academy |
| **money-management** | amber | مفتوح | portfolio, watchlist, smart-confluence, alerts-center, wealth, live-monitor, trading-memory |
| **crypto** | orange | مفتوح | 6 عناصر (UI mirror protocol — نفس مكوّنات الأسهم مع `currentMarket='CRYPTO'`) |
| **islamic** | purple | مغلق | zakat, tithes |

**عناصر سفلية:** subscription, about, settings
**زر admin:** `admin` (يظهر فقط لو `user.is_admin`)

**ملاحظة (v3.66.8):** الـ sidebar شال entry الـ `advanced-analysis` (صار redirect لـ `#recommendations`).

### 3.2 `layout/MobileNav.tsx` (83 LOC) — ✅

**الحالة:** ACTIVE (2 importers)
**الوظيفة:** شريط سفلي بـ 5 أيقونات على الموبايل فقط: dashboard, recommendations, portfolio, trading-chart, settings.

### 3.3 `layout/Header.tsx` (226 LOC) — ✅

**الحالة:** ACTIVE (10 importers — ثاني أعلى مكوّن استخدامًا بعد ShareButton)
**الوظيفة:** رأس التطبيق RTL — يحتوي market switcher (EGX/Crypto) + بحث سهم + زر إشعارات.

### 3.4 `layout/Footer.tsx` (116 LOC) — ✅ (STICKY FOOTER)

**الحالة:** ACTIVE (2 importers)
**الوظيفة:** Footer بروابط اجتماعية + روابط قانونية (legal/disclaimer, privacy, terms).

> **متطلب STICKY FOOTER (مُلزم):** الـ Footer لازم يبقى مثبّتًا في أسفل الصفحة دائمًا حتى لو الـ content قصير. أي إعادة هيكلة للـ layout لازم تحافظ على هذا السلوك (يجب ألا يصبح `position: static` أو يُدفع خارج الشاشة عند views طويلة).

### 3.5 باقي مكوّنات الـ layout

| المكوّن | LOC | الحالة |
|---------|----:|--------|
| `RealtimeTicker` | 294 | ✅ active — شريط أسعار متحرك أعلى الـ Header |
| `CentralAlertMonitor` | 276 | ✅ active — polling `/api/sniper/scan` كل 60s |
| `RoboNotifierToggle` | (small) | ✅ active — زر إشعارات حية |
| `NotificationCenter` | (med) | ✅ active — panel منزلق |
| `PlatformGuide` (help/) | 486 | ✅ active (3 importers) — مودال تعليمي |

---

## 4. كل VIEW بحالته (ACTIVE/DEAD/DUPLICATE)

> كل view مُعرّف في `page.tsx` switch. الحالة:
> - ✅ **ACTIVE** — مُستورد من `page.tsx` + مرئي في الـ sidebar أو عبر hash route.
> - ⚠ **HIDDEN/ALIAS** — مُستورد لكن مش في الـ sidebar (alias أو legacy).
> - ❌ **DEAD** — في الـ switch لكن بـ يرجّع placeholder، أو مُزال من الـ sidebar + orphan component.

### 4.1 قسم السوق (market) — 10 views

| View ID | Label (Ar) | Component | LOC | Status | API المُستدعى |
|---------|------------|-----------|----:|--------|---------------|
| `dashboard` | نظرة عامة | `<DashboardView />` | 478 | ✅ | `/api/dashboard/*`, `/api/market/sync-live` |
| `stocks` | الأسهم | `<StocksView />` | 2,002 | ✅ | `/api/stocks?market=EGX&limit=200`, `/api/stocks/[ticker]/history` |
| `trading-chart` | الشارت التفاعلي | `<TradingChartView />` | 356 | ✅ | `/api/stocks/[ticker]/comprehensive`, `/api/unified-analysis/[symbol]` |
| `recommendations` | متابعة التوقعات | `<MarketAnalysisView />` | 6,450 | ✅ (BIGGEST) | `/api/predictions/honest-tracking/list`, `/api/predictions/honest-tracking/verify-pending` |
| `picks-management` | إدارة التوصيات | `<PicksManagementView />` | 753 | ✅ | `/api/predictions/daily-picks`, `/api/predictions/active-management` |
| `specialist-analysis` | تحليل المتخصصين | `<SpecialistAnalysisView />` | 1,061 | ✅ | `/api/expert-consensus`, `/api/market/sectors/intelligence` |
| `reports` | التقارير | `<ReportsView />` | 1,160 | ✅ | `/api/reports/*`, `/api/market/report/*` |
| `learning` | مركز التعلم | `<LearningView />` | 1,062 | ✅ | `/api/educational-cards`, `/api/learning/*` |
| `simulation` | المحاكاة | `<SimulationView />` | 1,775 | ✅ | `/api/simulation/*` |
| `academy` | أكاديمية M2y | `<AcademyView />` | 73 | ✅ | (static content) |

### 4.2 قسم إدارة الأموال (money-management) — 7 views

| View ID | Label (Ar) | Component | LOC | Status | API المُستدعى |
|---------|------------|-----------|----:|--------|---------------|
| `portfolio` | المحفظة الموحدة | `<EnhancedPortfolioView />` | 3,069 | ✅ | `/api/portfolio/*`, `/api/finance/*` |
| `watchlist` | قوائم المراقبة | `<EnhancedWatchlistView />` | 1,183 | ✅ | `/api/watchlist`, `/api/watchlist/[id]` |
| `smart-confluence` | تحليلات السوق | `<SmartConfluenceView />` | 273 | ✅ | `/api/confluence/*` |
| `alerts-center` | مركز التنبيهات | `<AlertsCenterView />` | 686 | ✅ | `/api/sniper/scan`, `/api/notifications/*` |
| `wealth` | الأموال | `<WealthCharts />` | 335 | ✅ | `/api/money/wealth` |
| `live-monitor` | المراقبة الحية | `<LiveMonitor />` | 1,329 | ✅ | `/api/live-tracking`, `/api/market/sync-live` |
| `trading-memory` | ذاكرة التداول | `<TradingMemoryView />` | 326 | ✅ | `/api/python/v4/insight/*`, `/api/python/v4/stats` (⚠ Blueprint v4_bp غير مسجّل — P1.9) |

### 4.3 قسم الـ Crypto (UI mirror protocol) — 8 views

> **UI-MIRROR PROTOCOL:** Crypto يستخدم نفس مكوّنات الأسهم (`DashboardView`, `StocksView`, `EnhancedWatchlistView`) مع `currentMarket='CRYPTO'`.

| View ID | Label (Ar) | Component | LOC | Status |
|---------|------------|-----------|----:|--------|
| `crypto` | العملات الرقمية | `<DashboardView />` (mirror) | — | ✅ |
| `crypto-live` | الحية | `<LiveMonitor />` (mirror) | — | ✅ |
| `crypto-recommendations` | التوصيات | `<CryptoRecommendationsView />` | 1,057 | ✅ |
| `crypto-analysis` | تحليل | `<CryptoAnalysisView />` | 1,090 | ✅ |
| `crypto-portfolio` | المحفظة | `<CryptoPortfolioView />` | 641 | ✅ |
| `crypto-watchlist` | قائمة المراقبة | `<EnhancedWatchlistView />` (mirror) | — | ✅ |
| `crypto-learning` | التعلم | `<CryptoLearningView />` | 1,106 | ✅ |
| `crypto-simulation` | المحاكاة | `<CryptoSimulationView />` | 1,804 | ✅ |

### 4.4 قسم الإسلامي (islamic) — 2 views

| View ID | Label (Ar) | Component | LOC | Status | API |
|---------|------------|-----------|----:|--------|-----|
| `zakat` | الزكاة | `<ZakatView />` | 1,142 | ✅ | `/api/zakat/*` |
| `tithes` | العشور | `<TithesView />` | 757 | ✅ | `/api/tithes/*` |

### 4.5 شاشات أخرى (bottom + admin) — 7 views

| View ID | Label (Ar) | Component | LOC | Status | API |
|---------|------------|-----------|----:|--------|-----|
| `subscription` | الباقات والاشتراكات | `<SubscriptionView />` | 1,430 | ✅ | `/api/subscription/*`, `/api/paymob/*` |
| `about` | من نحن | `<AboutView />` | 466 | ✅ | (static) |
| `settings` | الإعدادات | `<SettingsView />` | 258 | ✅ | `/api/auth/me`, `/api/user/settings` |
| `auth` | تسجيل الدخول | `<AuthView />` | 638 | ✅ | NextAuth `/api/auth/*` |
| `admin` | لوحة الأدمن | `<AdminView />` | 1,913 | ✅ | (16 sub-tabs — انظر §9) |
| `smart-assistant` | (legacy label) | `<SmartConfluenceView />` | 273 | ✅ | alias for `smart-confluence` |
| `backtesting` | (legacy) | `<EGXBacktestDashboard />` | 443 | ⚠ hidden | (no sidebar entry) |

### 4.6 شاشات alias / مُزالة من الـ sidebar (في الـ switch)

| View ID | الحالة | السبب |
|---------|--------|-------|
| `finance` | ⚠ alias | alias لـ `<EnhancedPortfolioView />` |
| `v2-analysis` | ⚠ alias | alias لـ `<MarketAnalysisView />` |
| `advanced-analysis` | ⚠ redirect | v3.66.8: يـ redirect لـ `<MarketAnalysisView />` |
| `sniper` | ⚠ merged | مدمج في persona tabs داخل `MarketAnalysisView` (comment line 166) |
| `prediction-performance` | ❌ DEAD | admin-only — يرجّع placeholder |
| `prediction-credibility` | ❌ DEAD | admin-only — يرجّع placeholder |
| `community` | ❌ DEAD | شالها الـ sidebar + `CommunityView` orphan (581 LOC) |
| `trading-journal` | ❌ moved | moved to Admin |
| `unified-analysis` | ❌ moved | moved to Admin (page stub 12 LOC ميت) |
| `StoredAnalysisView` | ❌ distributed | distributed إلى `#recommendations` + `#specialist-analysis` (المكوّن 1,896 LOC لسه على disk — orphan) |

---

## 5. واجهة الشخصيات (Persona UI)

> **المرجعية:** `00-CONSTITUTION.md` §5 (سياسة PERSONA-UNIFY-A) · `SYSTEM_HOW_IT_THINKS.md` §19.5 · `PERSONA_UNIFY_A_MEASUREMENT_REPORT.md` · `V34-INSTITUTIONAL-DECISION-ENGINE.md`.

### 5.1 `persona/PersonaSelector.tsx` (272 LOC) — ✅ ACTIVE

**الحالة:** ACTIVE (4 importers — أعلى مكوّن persona استخدامًا)
**الوظيفة:** منتقي شخصية المستثمر (investor/balanced/gambler → conservative/balanced/gambler). يُستخدم داخل `MarketAnalysisView` (tabs الشخصيات) + `SpecialistAnalysisView`.

**الـ 3 personas المعتمدة (بعد V34 fix):**

| Persona | min_score | target_mult | صفات |
|---------|----------:|------------:|------|
| `conservative` (المستثمر) | 50 | 1.8x | R/R ضيق + threshold معتدل |
| `balanced` (المتوازن) | 50 | 2.2x | ✅ الـ baseline (81.8% من predictions.db) |
| `gambler` (المضارب) | 35 | 3.0x | أهداف أبعد + threshold منخفض |

### 5.2 شخصية tabs داخل `MarketAnalysisView`

> **الـ 3 tabs (مضارب / متوازن / مستثمر)** — كل tab بـ يستدعي `/api/predictions/honest-tracking/list?persona=<gambler|balanced|conservative>`.
>
> **RL-FIX-9:** الـ API دلوقتي بـ يدعم `?persona=` filter (مش كان موجود قبل كده). SQL window = 220 يوم، LIMIT 500، dedup = per-(ticker, date).

### 5.3 Persona Image Cards (في `src/components/market/`)

| المكوّن | LOC | الحالة | الوظيفة |
|---------|----:|--------|---------|
| `market/PersonaImageCard.tsx` | 603 | ✅ active(1) | بطاقة صورة قابلة للمشاركة لـ persona summary |
| `market/MarketStatusImageCard.tsx` | 766 | ✅ active(1) | بطاقة حالة السوق |
| `market/ExpertPredictionsImageCard.tsx` | 525 | ✅ active(1) | توقعات الخبراء |
| `market/PredictionsImageCard.tsx` | 434 | ✅ active(1) | توقعات عامة |
| `market/StockLeagueImageCard.tsx` | 326 | ✅ active | Stock league (يستخدمه `/admin/reports`) |
| `market/TopTradesImageCard.tsx` | 208 | ✅ active | Top trades |
| `market/MarketScreenView.tsx` | 1,460 | ❌ DEAD (orphan) | legacy market screen |

> **6 cards متشابهة** — مرشّحة للتتوحّد في `<ShareableImageCard variant="..." />` [P2.10].

### 5.4 `DynamicRiskProfilerModal` + `RiskProfilerQuiz`

- **DynamicRiskProfilerModal** — مودال يظهر للمستخدم الجديد لتحديد persona بناءً على أسئلة (عمر/دخل/تحمل مخاطر). يكتب النتيجة في `auth.db` + zustand.
- **RiskProfilerQuiz** — quiz يخدمه الـ modal. (مدمج في `portfolio/` كجزء من EnhancedPortfolioView).

### 5.5 سياسة PERSONA-UNIFY-A (2026-08-17)

> **الخيار الآمن:** `compute_persona_fit()` في `v40_2_daily_generator.py` بـ derive 4 category scores من V40.2 proofs وبـ weightها بـ `PERSONA_INPUT_WEIGHTS`. الـ `kill_filter_result` بـ يُannotated بـ `| fit:<persona>(score)`.
>
> **حماية الـ baseline:** `persona='balanced'` في `predictions` **لم يُلمس** — أرقام 22/1/3 و 69.2% WR و 81.8% balanced لا تتغير. لا reclassify بدون موافقة المالك.

---

## 6. واجهة متابعة التوقعات (Prediction-Tracking UI)

> **المرجعية:** `RL-FIX-9-Predictions-Status-Logic.md` (كامل) · `audit_map.json` v3.66.4 + v3.66.8.

### 6.1 الـ view الأساسي: `MarketAnalysisView` (#recommendations)

**الملف:** `src/components/analysis/MarketAnalysisView.tsx` (~6,450 LOC — أكبر مكوّن في النظام)
**الحالة:** ✅ ACTIVE (BIGGEST non-UI component)

**الاسم بعد v3.66.8:** "متابعة التوقعات" (was: "التوصيات")
**البنية:** 2 tabs رئيسية + persona sub-tabs.

#### الـ tab 1: متابعة التوقعات (Live Tracking)

- بـ يعرض التوقعات النشطة + المغلقة في جدول
- لكل persona (gambler/balanced/conservative) tab منفصل
- يستدعي `/api/predictions/honest-tracking/list?persona=<X>` (SQLite مباشرة من Node — architecture violation، لكن مقبول مؤقتًا للأداء)
- **زر "تحقق من المعلّقة"** (verify-pending button) — POST `/api/predictions/honest-tracking/verify-pending` — بـ يفحص الأسعار الحالية ويقفل التوقعات اللي ضربت target/stop
- **status badges:** WIN (أخضر) / LOSS (أحمر) / PENDING (كهرماني) + TRAILING_PROFIT (زمردي) + EXPIRED (رمادي)
- **5-min auto-refresh** (Polling)

#### الـ tab 2: ملخص التوقعات (Summary)

- ملخص إجمالي: WR, PF, عدد المغلق/المعلق، أحدث 5 توقعات
- **نفس الـ API:** `/api/predictions/honest-tracking/list` + `/api/predictions/honest-tracking/stats`
- **كلا الـ tabs الآن يستخدمان SQLite عبر `/api/predictions/honest-tracking/*`** (RL-FIX-9 — كان tab 1 قبل كده بـ يستخدم `/api/stored-analysis/live-tracking` → Python → كان بـ يرجّع zeros لما Python down)

### 6.2 نظام الحالات (5-state Status Taxonomy — RL-FIX-9)

| الحالة (status) | exit_type | hit_target | hit_stop | is_correct | المعنى العربي | اللون |
|------------------|-----------|------------|----------|------------|----------------|--------|
| `TARGET_HIT` | `target_hit` | 1 | 0 | 1 | ✅ تم تحقيق الهدف | أخضر (WIN) |
| `TRAILING_PROFIT` | `trailing_profit` | 0 | 0 | 1 | 💰 خرج بربح | زمردی |
| `STOPPED` | `stop_loss` / `trailing_stop` | 0 | 1 | 0 | ❌ ضرب وقف | أحمر (LOSS) |
| `EXPIRED` | `expired` | 0 | 0 | 0 | ⌛ انتهت المدة | رمادي |
| `PENDING` | (NULL) | 0 | 0 | NULL | ⏳ لسه معلقة | كهرمانی |

> **القاعدة:** لا WIN/LOSS نهائي بدون `outcome_date`. الـ status بـ يُستنتج من `exit_type` + `outcome_date` في الـ route + UI (rule from `00-CONSTITUTION.md` §6).

### 6.3 مكوّنات tracking النشطة

| المكوّن | LOC | الحالة | الوظيفة |
|---------|----:|--------|---------|
| `predictions/PredictionTrackingDashboard.tsx` | 1,908 | ✅ active (2) | "Luxury edition" — جدول تفصيلي + WIN/LOSS/PENDING + 5-min auto-refresh |
| `predictions/PredictionTrackingView.tsx` | 599 | ✅ active (2) | Card-based أبسط، يتكلّم مع Python (legacy path — للتخلّص منه) |
| `predictions/PredictionsPerformanceView.tsx` | 341 | ❌ DEAD (orphan) | duplicate — مرشّح للحذف |
| `predictions/PredictionAccuracyWidget.tsx` | 256 | ❌ DEAD (orphan) | duplicate |
| `PredictionTrackingView.tsx` (root) | 725 | ❌ DEAD | ✅ حُذف في P3.3-partial |

### 6.4 الـ API endpoints (الـ active = `honest-tracking`)

| النظام | Routes | LOC | Status |
|-------|-------|----:|--------|
| **OLD**: `/api/predictions/tracking/*` | 4 (root, list, stats, verify) | 218 | ❌ مهجور — حذف [P3.7] |
| **NEW**: `/api/predictions/honest-tracking/*` | 7 (root, list, stats, live-tracking, learn-from-errors, missed-opportunities, verify-pending) | 2,545 | ✅ النشط |
| **DUPLICATE**: `/api/stored-analysis/live-tracking` | 1 | 169 | ❌ مكرر — حذف [P3.7] |

**أهم route:** `/api/predictions/honest-tracking/verify-pending` (690 LOC) — POST بـ يفحص كل PENDING ويقفل اللي ضربت target/stop باستخدام الأسعار الحية.

### 6.5 إصلاحات RL-FIX-9 في الـ UI

**`src/components/analysis/MarketAnalysisView.tsx`** (changes per RL-FIX-9):
- `PreviousPrediction` interface (lines 2181-2208): أضيف `is_live_return`, `exit_type`, `persona`
- Status color map (lines 2243-2252): أضيف `TRAILING_PROFIT` (emerald) + `EXPIRED` (slate)
- Return display (lines 2297-2308): badge "معاينة" للعائد اللحظي للـ PENDING
- API call (line 4667): بـ يمرّر `persona=${persona}` للـ endpoint

---

## 7. واجهة إدارة التوصيات (Picks Management UI)

> **المرجعية:** `PICKS-MANAGEMENT-SYSTEM.md` · `00-CONSTITUTION.md` §8.

### 7.1 `predictions/PicksManagementView.tsx` (753 LOC) — ✅ ACTIVE

**الـ view ID:** `picks-management` (في الـ sidebar قسم market)
**الـ APIs المُستدعاة:**
- `GET /api/predictions/daily-picks` — أعلى 5 توصيات لليوم
- `GET /api/predictions/daily-picks/history` — سجلّ التوصيات اليومية
- `GET /api/predictions/active-management` — إدارة كل المراكز المفتوحة
- `GET /api/predictions/{id}/management` — إدارة مركز واحد
- `POST /api/predictions/management/refresh` — تحديث

### 7.2 الـ Confidence Engine (Backend — `vps-service/analyzers/confidence_engine.py`)

**7 عوامل حساب الثقة (0-100%):**

| # | العامل | الوزن | الشرط |
|---|--------|-------|-------|
| 1 | Technical Score | 30 | master_score من maestro |
| 2 | Trend Strength | 15 | ADX > 25 + EMA alignment |
| 3 | Volume Confirmation | 15 | Volume > 1.5x avg + OBV rising |
| 4 | Risk/Reward Ratio | 15 | R/R ≥ 2.0 = full, < 1.0 = 0 |
| 5 | Volatility (ATR) | 10 | ATR معتدل (0.5-3%) = ممتاز |
| 6 | Explosive Signal | 10 | BB squeeze + volume spike |
| 7 | Data Quality | 5 | History ≥ 60d + no gaps |

### 7.3 الـ Daily Cap = 5 + الـ 4 Tiers

**الـ cap:** `select_top_picks(date, max_picks=5, min_confidence=65.0)` — أقصى 5 توصيات/يوم، dedup per-ticker، ترتيب بالثقة تنازليًا.

| Tier | النطاق | اللون | الإجراء |
|------|--------|-------|---------|
| 🥇 **TOP_PICK** | ≥ 80% | ذهبي | اختيار فوري |
| 🟢 **STRONG** | 65-79% | أخضر | اختيار إذا توفرت فرصة |
| 🟡 **WATCH** | 50-64% | أصفر | مراقبة فقط |
| 🔴 **SKIP** | < 50% | أحمر | تجاهل تام |

### 7.4 الـ Position Manager (7 توصيات إدارة)

لكل مركز مفتوح، الـ Position Manager بـ يولّد إحدى 7 توصيات: action + reason + new_stop + urgency.

> **القاعدة الدستورية Rule 22:** KPIs بـ تُحسب dedup-by-ticker (PERSONA-BALANCE) — السهم الواحد = صفقة واحدة.

---

## 8. الطبقة المغلقة (Closed-Loop UI)

> **المرجعية:** `CLOSED_LOOP_FINAL.md` (كامل) · `00-CONSTITUTION.md` §7.

### 8.1 الـ 4-file Closed-Loop Chain (Backend)

| # | الملف | الدور |
|---|------|------|
| 1 | `vps-service/utils/live_price.py` | مصدر السعر الموحّد: `get_live_price` (intraday → data_engine → fallback) |
| 2 | `vps-service/analyzers/maestro_orchestrator.py` | العقل: `run_expert_memory_phase` يقرأ الدروس → `applied_lesson` (توسيع وقف مسقوف) → `record_prediction` يكتب التوقع |
| 3 | `vps-service/jobs/daily_closer.py` | الإغلاق الآلي: يقفل على سعر التفعيل + `is_correct` من `exit_type` + `record_lesson_from_close` + `detect_and_record_missed_opportunities` |
| 4 | `vps-service/utils/lesson_store.py` | ذاكرة الدروس: `record_lesson_from_close` يصنّف (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT) → `get_persona_lesson_summary` / `get_ticker_lesson_summary` |

### 8.2 واجهة المستخدم للطبقة المغلقة

> **الطبقة المغلقة مش شاشة مستقلة — هي مدمجة في عدة views:**

| الـ view | كيف يعرض الـ closed-loop |
|---------|--------------------------|
| `#recommendations` (MarketAnalysisView) | يعرض WIN/LOSS/PENDING + status badges + `applied_lesson` في tooltip |
| `#live-monitor` (LiveMonitor) | متابعة لحظية للأسعار + exit triggers |
| `#trading-memory` (TradingMemoryView) | عرض الدروس المُتعلّمة (`STOP_TOO_TIGHT` count, `applied_lesson` widen_stop) |
| `#admin` (MaestroDashboard) | لوحة الـ lessons + win rate + PF + توقّعات مغلقة اليوم |

### 8.3 الـ UI "shipped" indicators للـ closed-loop شغّال

| Indicator | كيف تتحقق في الواجهة |
|-----------|----------------------|
| دروس جديدة يومياً | `#trading-memory` بـ يعرض دروس اليوم |
| `[LEARNING]` يظهر | `#admin` Maestro log بـ يعرض `applied_lesson: widen_stop +0.45ATR (STOP_TOO_TIGHT 3x on X)` |
| لا WIN بدون `outcome_date` | `#recommendations` ما بـ يعرضش WIN على صف PENDING |
| `is_correct` من `exit_type` | الـ status badge بـ يعكس `exit_type` مش `hit_stop` المباشر |

### 8.4 القاعدة الذهبية للـ closed-loop

> **Python = العقل · Node = عرض فقط. لا WIN/LOSS نهائي بدون `outcome_date`.** لو في WIN بـ `closedAt: null` = bug حرج.

---

## 9. جرد شاشات الأدمن (Admin Views Inventory)

> **الـ view الأساسي:** `admin/AdminView.tsx` (1,913 LOC) — ✅ ACTIVE (2 importers). بداخله 16 sub-tab (dynamic imports).

### 9.1 AdminView dynamic imports (الـ tabs النشطة)

```
AdminView (1,913 LOC)
├── <SuperLearningSystem />       # 2,403 LOC
├── <MaestroDashboard />          # 2,750 LOC — لوحة Maestro الرئيسية
├── <MaestroCommandCenter />      # 3,748 LOC — React Flow pipeline UI
├── <TelegramTab />               # 2,200 LOC — إدارة Telegram bot
├── <MultiMarketTab />            # 246 LOC
├── <ForexTab />                  # 300 LOC
├── <GoldSilverTab />             # 258 LOC
├── <DataEngineTab />             # 634 LOC
├── <EnginesStatusTab />          # 737 LOC
├── <EngineSettingsTab />         # 576 LOC
├── <SectorClassificationAdmin /> # 274 LOC
├── <RegimeDetectionWidget />     # 126 LOC
├── <SystemProblemsTab />         # 488 LOC
├── <PromoCodesAdmin />           # 592 LOC
├── <HumanRecommendationsAdmin /> # 964 LOC
├── <UsersManagement />           # 1,086 LOC
├── <DatabaseManagerFull />       # 3,259 LOC — بديل DatabaseManager
├── <NotebookAdminTab />          # 524 LOC — (جديد 2026-09-01) إدارة Stock Notebooks
└── <PurgeCacheButton />          # 223 LOC
```

> **جديد 2026-09-01:** `<NotebookAdminTab />` (524 LOC) في `src/components/admin/NotebookAdminTab.tsx` — واجهة إدارة Stock Notebooks. يستدعي `/api/notebooks/*` (7 endpoints في `vps-service/api/notebook_routes.py`). يعرض: قائمة النوتبوكس، إحصائيات، تعديل machine_summary، إضافة دروس، إعادة بناء جماعي.

> **Comment في AdminView:** 6 admin orphans شالهم الـ imports (IterativeLearningAdmin, CryptoLearningAdmin, StockImportCard, RecommendationsExport, CryptoPredictionGenerator, DatabaseExplorer) — "كانوا مستوردين بس مش مرسومين في أي tab".

### 9.2 جرد شاشات الأدمن المنفصلة (admin pages — iframe targets)

| الـ route | LOC | الوظيفة |
|---------|----:|---------|
| `/admin/educational-cards` | 1702 | CRUD للـ educational cards + نشر Telegram |
| `/admin/honest-predictions` | 1919 | مولّد التوقعات التاريخية |
| `/admin/reports` | 118 | Trading Reports Hub (Stock League image cards) |
| `/maestro` | 124 | Standalone Maestro page (admin-gated) |

### 9.3 مكوّنات admin إضافية (active + orphan)

| المكوّن | LOC | Status | الوظيفة |
|---------|----:|--------|---------|
| `admin/AdminView.tsx` | 1,913 | ✅ active | Main admin shell |
| `admin/MaestroDashboard.tsx` | 2,750 | ✅ active | Maestro control panel |
| `admin/MaestroCommandCenter.tsx` | 3,748 | ✅ active | React Flow pipeline UI |
| `admin/MaestroPage.tsx` | 297 | active(1) | Maestro top-level page |
| `admin/DatabaseManagerFull.tsx` | 3,259 | active(1) | الـ DB manager النشط |
| `admin/DatabaseManager.tsx` | 971 | ❌ DEAD | superseded by DatabaseManagerFull |
| `admin/SuperLearningSystem.tsx` | 2,403 | active(1) | نظام التعلّم الموحّد |
| `admin/TelegramTab.tsx` | 2,200 | active(1) | إدارة Telegram |
| `admin/EngineSettingsTab.tsx` | 576 | active | إعدادات المحركات |
| `admin/SystemProblemsTab.tsx` | 488 | active | مشاكل النظام |
| `admin/UsersManagement.tsx` | 1,086 | active | إدارة المستخدمين |
| `admin/PromoCodesAdmin.tsx` | 592 | active | أكواد الخصم |
| `admin/HumanRecommendationsAdmin.tsx` | 964 | active | توصيات يدوية |
| `admin/SectorClassificationAdmin.tsx` | 274 | active | تصنيف القطاعات |
| `admin/UnifiedCommandCenter.tsx` | 1,344 | ❌ DEAD | duplicate cmd center |
| `admin/UnifiedControlTab.tsx` | 883 | ❌ DEAD | duplicate |
| `admin/UnifiedBacktestingSystem.tsx` | 915 | ❌ DEAD | duplicate |
| `admin/SystemTopologyTab.tsx` | 1,674 | ❌ DEAD | duplicate |
| `admin/SystemTopologyControls.tsx` | 700 | ❌ DEAD | duplicate |
| `admin/PredictionGeneratorView.tsx` | 1,084 | ❌ DEAD | duplicate |
| `admin/PredictionClosingEngine.tsx` | 264 | ❌ DEAD | duplicate |
| `admin/RetroactivePredictionsAdmin.tsx` | 320 | ❌ DEAD | duplicate |
| `admin/CryptoLearningAdmin.tsx` | 939 | ❌ DEAD | removed from imports |
| `admin/CryptoMaestroPage.tsx` | 821 | ❌ DEAD | duplicate |
| `admin/TelegramAdmin.tsx` | 615 | ❌ DEAD | duplicate of TelegramTab |
| `admin/IterativeLearningAdmin.tsx` | 504 | ❌ DEAD | removed from imports |
| `admin/StockImportCard.tsx` | 296 | ❌ DEAD | removed |
| `admin/RecommendationsExport.tsx` | 267 | ❌ DEAD | removed |
| `admin/DatabaseExplorer.tsx` | 394 | ❌ DEAD | removed |
| `admin/AdminPredictionGenerator.tsx` | 434 | ❌ DEAD | duplicate |
| `admin/DataScraperControl.tsx` | — | ⚠ تحقق | (مرشّح للدمج) |
| `admin/MultiMarketTab.tsx` | 246 | active | أسواق متعددة |
| `admin/ForexTab.tsx` | 300 | active | فوركس |
| `admin/GoldSilverTab.tsx` | 258 | active | ذهب وفضة |
| `admin/EnginesStatusTab.tsx` | 737 | active | حالة المحركات |
| `admin/RegimeDetectionWidget.tsx` | 126 | active | كشف الـ regime |
| `admin/PurgeCacheButton.tsx` | 223 | active | زر مسح الكاش |
| `admin/WealthCharts.tsx` | 370 | ✅ active (2) | admin-side wealth |

### 9.4 `MaestroDashboard` (2,750 LOC) — ✅ النشطة

اللوحة الرئيسية للأدمن. تعرض:
- حالة المحركات (EnginesStatus)
- لوحة Maestro (React Flow pipeline في MaestroCommandCenter)
- توقعات اليوم + توقعات مغلقة + win rate
- إعدادات المحركات (EngineSettingsTab)
- إدارة Telegram
- SystemProblems + Regime

**إصلاح 2026-08-16 (PROD-FRONTEND-FIX):** MaestroDashboard كان بـ يعرض "Python Backend غير متصل" بسبب 3 أخطاء:
1. `app.run()` في `lightweight_server.py` كان قبل تسجيل routes — اتصلح بنقله لآخر الملف
2. Root `/health` endpoint مفقود — اتضاف
3. `status="degraded"` مرفوض — الـ dashboard بقى بـ يقبل `ok/healthy/degraded`

---

## 10. جرد المكوّنات الميتة والمكررة (Dead/Duplicate Inventory)

> **تفاصيل كاملة:** `03-REFACTORING_REPORT.md` §3-§7. هنا مختصر مُحدّث.

### 10.1 الـ 9 صفحات Next.js الميتة (4,711 LOC — للحذف [P3.2])

| # | Route | LOC | سبب الموت |
|---|-------|----:|-----------|
| 1 | `/admin/expert-recommendations` | 1079 | لا inbound link |
| 2 | `/admin/maestro` | 747 | functionality في `/#admin` + `/maestro` |
| 3 | `/admin/prediction-performance` | 823 | sidebar شال الـ link |
| 4 | `/community` | 324 | sidebar مفيهاش community + CommunityView orphan |
| 5 | `/education/analysis-types` | 469 | orphan |
| 6 | `/payment/fail` | 58 | paymob ما بـ redirectش لهنا |
| 7 | `/portfolio` | 1199 | sidebar بـ يستخدم `#portfolio` hash |
| 8 | `/prediction-performance` | 8 | stub يرجّع "admin only" |
| 9 | `/unified-analysis` | 12 | comment: "moved to Admin" |

### 10.2 الـ `garage/` directory بالكامل (8,247 LOC — للحذف [P3.1])

> **كل `src/components/garage/` ميت — parking lot للـ legacy.**

| File | LOC |
|------|----:|
| `garage/AdminPanel.tsx` | 2,012 |
| `garage/EnhancedAdminDashboard.tsx` | 1,447 |
| `garage/V2AdvancedAnalysisView.tsx` | 1,130 |
| `garage/BacktestingDashboard.tsx` | 1,022 |
| `garage/FeedbackDashboard.tsx` | 751 |
| `garage/HistoricalBackfillAdmin.tsx` | 679 |
| `garage/PaperTradingDashboard.tsx` | 606 |
| **المجموع** | **8,247** |

> ملاحظة: FeedbackDashboard + PaperTradingDashboard بـ يظهروا "active(1)" لأنهم مستوردين من EnhancedAdminDashboard اللي هو نفسه orphan — chained dead code.

### 10.3 أكبر 30 مكوّن ميت (مرتّبة حسب LOC)

| LOC | File | الملاحظة |
|----:|------|---------|
| 2,012 | `garage/AdminPanel.tsx` | garage parking lot — legacy admin |
| 1,988 | `stocks/AdvancedStockChart.tsx` | duplicate chart engine |
| 1,896 | `advanced-analysis/StoredAnalysisView.tsx` | ✅ distributed to `#recommendations` + `#specialist-analysis` (v3.66.8) |
| 1,674 | `admin/SystemTopologyTab.tsx` | duplicate |
| 1,460 | `market/MarketScreenView.tsx` | legacy market screen |
| 1,447 | `garage/EnhancedAdminDashboard.tsx` | garage parking — older admin |
| 1,344 | `admin/UnifiedCommandCenter.tsx` | duplicate cmd center |
| 1,131 | `analysis/ConfluencePanel.tsx` | duplicate |
| 1,130 | `garage/V2AdvancedAnalysisView.tsx` | garage parking |
| 1,084 | `admin/PredictionGeneratorView.tsx` | duplicate |
| 1,049 | `portfolio/InteractivePortfolioManager.tsx` | duplicate portfolio mgr |
| 1,022 | `garage/BacktestingDashboard.tsx` | garage parking |
| 995 | `stocks/SimpleStockChart.tsx` | duplicate chart (recharts) |
| 989 | `screener/MultiChartScreener.tsx` | orphan screener |
| 971 | `admin/DatabaseManager.tsx` | superseded by DatabaseManagerFull |
| 959 | `advanced-analysis/AdvancedAnalysisView.tsx` | orphan (v3.66.8 redirect) |
| 939 | `admin/CryptoLearningAdmin.tsx` | removed from imports |
| 915 | `admin/UnifiedBacktestingSystem.tsx` | duplicate |
| 883 | `admin/UnifiedControlTab.tsx` | duplicate |
| 881 | `ai-analysis/AIAnalysisDashboard.tsx` | orphan |
| 855 | `share/ShareDialog.tsx` | duplicate of ShareButton |
| 848 | `dashboard/MaestroCommandCenter.tsx` | duplicate of admin/ version |
| 828 | `stocks/LiveStocksTable.tsx` | orphan |
| 821 | `admin/CryptoMaestroPage.tsx` | duplicate |
| 750 | `performance/PerformanceStats.tsx` | orphan |
| 747 | `reports/DailyReportImageCard.tsx` | orphan |
| 744 | `stocks/StockAnalysisDashboard.tsx` | orphan |
| 729 | `recommendations/RecommendationsTable.tsx` | orphan |
| 725 | `PredictionTrackingView.tsx` (root) | ✅ حُذف في P3.3-partial |
| 715 | `self-learning/SelfLearningView.tsx` | orphan |

### 10.4 باقي المكوّنات الميتة (41 ملف — مختصر)

| LOC | File |
|----:|------|
| 700 | `admin/SystemTopologyControls.tsx` |
| 691 | `share/SocialShareManager.tsx` |
| 679 | `garage/HistoricalBackfillAdmin.tsx` |
| 646 | `command-center/CommandCenterV6.tsx` |
| 640 | `intelligence/PortfolioIntelligenceSection.tsx` |
| 615 | `hunter/HunterView.tsx` |
| 615 | `analyst/AnalystDashboardView.tsx` |
| 615 | `admin/TelegramAdmin.tsx` |
| 591 | `portfolio/PortfolioView.tsx` (old, superseded by EnhancedPortfolioView) |
| 589 | `risk/RiskManagementWidget.tsx` |
| 581 | `community/CommunityView.tsx` |
| 577 | `MainApp.tsx` ✅ حُذف في P3.3-partial |
| 577 | `deep-learning/DeepLearningControl.tsx` |
| 571 | `learning/MaestroEducationCenter.tsx` |
| 545 | `screener/StockScreener.tsx` |
| 516 | `recommendations/RecommendationsView.tsx` |
| 509 | `stocks/StockList.tsx` |
| 504 | `admin/IterativeLearningAdmin.tsx` |
| 497 | `intelligence/AlertsCenterView.tsx` (duplicate of alerts/AlertsCenterView) |
| 488 | `performance/UserPerformanceView.tsx` |
| 434 | `performance/AdminPredictionGenerator.tsx` |
| 426 | `analysis/RichChartCard.tsx` |
| 418 | `sniper/SniperView.tsx` (merged into MarketAnalysisView tabs) |
| 394 | `admin/DatabaseExplorer.tsx` |
| 387 | `dashboard/DataSyncButton.tsx` |
| 353 | `performance/PerformanceCharts.tsx` |
| 341 | `predictions/PredictionsPerformanceView.tsx` |
| 320 | `admin/RetroactivePredictionsAdmin.tsx` |
| 296 | `admin/StockImportCard.tsx` |
| 289 | `stocks/StockChart.tsx` (recharts orphan) |
| 281 | `news/NewsWidget.tsx` (superseded by news-feed-widget) |
| 267 | `admin/RecommendationsExport.tsx` |
| 264 | `admin/PredictionClosingEngine.tsx` |
| 256 | `predictions/PredictionAccuracyWidget.tsx` |
| 212 | `topology/LiveTopologyView.tsx` |
| 169 | `stocks/ConfluenceGauges.tsx` |
| 114 | `devil/DevilsLayerView.tsx` |
| 101 | `dashboard/EGXPilotNews.tsx` |
| 80 | `sync-prices-button.tsx` ✅ حُذف في P3.3-partial |
| 50 | `studio/EngineStudio.tsx` |

### 10.5 المكوّنات المكررة (Duplicates)

#### 10.5.1 Chart Components (8 components، ~7K LOC)

| File | LOC | Status | Library | Role |
|------|----:|--------|---------|------|
| `analysis/InteractiveChart.tsx` | 1,678 | ✅ active | lightweight-charts | Core chart engine (OHLC + indicators + SMC) |
| `stocks/TradingViewChart.tsx` | 1,737 | ✅ active | lightweight-charts | TradingView-style chart |
| `screener/ChartCard.tsx` | 712 | active(1) | recharts | Screener chart card |
| `screener/ComparisonChartCard.tsx` | 567 | active(1) | recharts | Comparison chart |
| `stocks/AdvancedStockChart.tsx` | 1,988 | ❌ DEAD | lightweight-charts | Duplicate of TradingViewChart |
| `stocks/SimpleStockChart.tsx` | 995 | ❌ DEAD | recharts | Simpler chart |
| `stocks/StockChart.tsx` | 289 | ❌ DEAD | recharts | Another simpler chart |
| `analysis/RichChartCard.tsx` | 426 | ❌ DEAD | wraps InteractiveChart | Card wrapper |

> **عائلتان متوازيتان:** lightweight-charts (InteractiveChart, TradingViewChart) + recharts (SimpleStockChart, StockChart, screener charts). **4 orphan charts = 3,698 LOC** deletable.

#### 10.5.2 Watchlist Views (3 components، 2.3K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `watchlist/EnhancedWatchlistView.tsx` | 1,183 | ✅ active | The one used by page.tsx |
| `watchlist/ProfessionalWatchlistView.tsx` | 467 | active(1)* | Referenced in TradingMemoryView |
| `watchlist/WatchlistView.tsx` | 713 | ❌ DEAD | Old version, superseded |

#### 10.5.3 Alerts Center Views (2 components، 1.2K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `alerts/AlertsCenterView.tsx` | 686 | ✅ active | Imported by page.tsx |
| `intelligence/AlertsCenterView.tsx` | 497 | ❌ DEAD | Same name, different module |

#### 10.5.4 Share Buttons (2 components، 1K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `share/ShareButton.tsx` | 583 | ✅ active (12 importers) | Full-featured |
| `shared/ShareButton.tsx` | 437 | active (2) | Simpler duplicate — مرشّح للدمج |

#### 10.5.5 Wealth Charts (2 components، 705 LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `admin/WealthCharts.tsx` | 370 | ✅ active (2) | Admin-side |
| `portfolio/WealthCharts.tsx` | 335 | active(1) | Portfolio-side |

#### 10.5.6 Analysis Views المتشتتة (7+ components، ~14K LOC عبر 3 directories)

| File | LOC | Status | Directory |
|------|----:|--------|-----------|
| `analysis/MarketAnalysisView.tsx` | 6,450 | ✅ active | analysis/ |
| `analysis/UnifiedAnalysisView.tsx` | 582 | active (3) | analysis/ |
| `analysis/SingleStockAnalysisView.tsx` | 1,370 | active (2) | analysis/ |
| `advanced-analysis/AdvancedAnalysisView.tsx` | 959 | ❌ DEAD | advanced-analysis/ |
| `advanced-analysis/StoredAnalysisView.tsx` | 1,896 | ❌ DEAD | advanced-analysis/ |
| `advanced-analysis/SpecialistAnalysisView.tsx` | 1,061 | active (2) | advanced-analysis/ |
| `stocks/StockAdvancedAnalysisView.tsx` | 679 | active(1) | stocks/ |
| `stocks/StockAnalysisDashboard.tsx` | 744 | ❌ DEAD | stocks/ |
| `stocks/ComprehensiveStockAnalysis.tsx` | 1,374 | active(1) | stocks/ |
| `stocks/DeepAnalysis.tsx` | 1,148 | active(1) | stocks/ |
| `stocks/GateAnalysisView.tsx` | 215 | active(1) | stocks/ |

> **Naming chaos** — محتاجة naming convention pass [P2.11].

#### 10.5.7 Stocks View (1 active + orphan sub-components)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `stocks/StocksView.tsx` | 2,002 | ✅ active | Main stocks view (page.tsx) |
| `stocks/LiveStocksTable.tsx` | 828 | ❌ DEAD | orphan table |
| `stocks/StockChart.tsx` | 289 | ❌ DEAD | recharts orphan |
| `stocks/AdvancedStockChart.tsx` | 1,988 | ❌ DEAD | duplicate |
| `stocks/SimpleStockChart.tsx` | 995 | ❌ DEAD | duplicate |
| `stocks/TradingViewChart.tsx` | 1,737 | ✅ active | TradingView-style |
| `stocks/StockList.tsx` | 509 | ❌ DEAD | orphan list |
| `stocks/StockAnalysisDashboard.tsx` | 744 | ❌ DEAD | orphan dashboard |
| `stocks/ComprehensiveStockAnalysis.tsx` | 1,374 | active(1) | comprehensive view |
| `stocks/DeepAnalysis.tsx` | 1,148 | active(1) | deep analysis |
| `stocks/GateAnalysisView.tsx` | 215 | active(1) | gate analysis |
| `stocks/ConfluenceGauges.tsx` | 169 | ❌ DEAD | orphan |

### 10.6 shadcn/ui Primitives غير المستخدمة (20 primitive، ~4,300 LOC)

| Primitive | LOC | الإجراء |
|-----------|----:|---------|
| `ui/sidebar.tsx` | 726 | حذف — الـ sidebar الفعلي في `layout/Sidebar.tsx` [P3.4] |
| `ui/menubar.tsx` | 276 | حذف |
| `ui/context-menu.tsx` | 252 | حذف |
| `ui/carousel.tsx` | 241 | حذف |
| `ui/calendar.tsx` | 217 | حذف |
| `ui/command.tsx` | 184 | حذف |
| `ui/navigation-menu.tsx` | 168 | حذف |
| `ui/drawer.tsx` | 135 | حذف |
| `ui/breadcrumb.tsx` | 109 | حذف |
| `ui/pagination.tsx` | 127 | حذف |
| `ui/input-otp.tsx` | 77 | حذف |
| `ui/toggle-group.tsx` | 73 | حذف |
| `ui/resizable.tsx` | 56 | حذف |
| `ui/toast.tsx` | 128 | ⚠ تحقق — sonner.toaster ممكن يستخدمه |
| `ui/toaster.tsx` | 34 | ⚠ تحقق |
| `ui/hover-card.tsx` | 44 | حذف |
| `ui/toggle.tsx` | 47 | حذف |
| `ui/radio-group.tsx` | 45 | حذف |
| `ui/sonner.tsx` | 25 | ⚠ تحقق |
| `ui/aspect-ratio.tsx` | 11 | حذف |

### 10.7 الـ Flask Blueprints الـ 33 الميتة (DEPRECATED — ~17,000 LOC)

> كل ملف في `vps-service/api/` يحمل header `# DEPRECATED: This route is not registered in lightweight_server.py`.

**أكبر 10:**

| File | LOC |
|------|----:|
| `crypto_learning_routes.py` | 1,939 |
| `analysis_routes.py` | 1,066 |
| `kimi_backtest.py` | 1,117 |
| `crypto_routes.py` | 1,407 |
| `tracking.py` | 564 |
| `unified_learning_routes.py` | 864 ⚠ (BP name collision) |
| `walk_forward_backtest.py` | 710 |
| `data_engine_routes.py` | 793 |
| `crypto_phase4_routes.py` | 965 |
| `educational_cards_routes.py` | 536 |

**باقي 23 ملف:** `analysis.py`, `analysis_engine_routes.py`, `backtest_routes.py`, `board_routes.py`, `crypto_simulation_routes.py`, `dynamic_analysis_routes.py`, `egksco_routes.py`, `expert_memory_v4_routes.py` ⚠ (مستورد من الواجهة — P1.9 fix), `fair_value_routes.py`, `feature_flags_routes.py`, `hunter_routes.py`, `market_manager_routes.py`, `market_report_routes.py`, `market_status_routes.py`, `monitor_routes.py`, `multi_market_routes.py`, `optimizer_params_routes.py` ⚠ (مستورد من prediction_optimizer — P1.6 fix), `performance_dashboard_routes.py`, `phase4_routes.py`, `smart_confluence_routes.py`, `t1_signals_routes.py`, `unified_maestro_routes.py`, `v2_analytics_routes.py`.

> **قبل الحذف:** كل ملف لازم نتأكد إن مفيش import منه من ملف نشط. خاصة `optimizer_params_routes.py` + `unified_learning_routes.py` + `expert_memory_v4_routes.py`.

---

## 11. الديون التقنية + خطة الـ Refactoring (مختصر)

> **تفاصيل كاملة:** `03-REFACTORING_REPORT.md` · `GAPS_AND_MISSING.md`. القاعدة الدستورية 25: أي refactoring يحتاج موافقة المالك + في فرع منفصل + VERIFY-BEFORE-DELETE.

### 11.1 الديون التقنية الحرجة

| الديون | الحجم | الخطورة |
|--------|------:|---------|
| كود ميت في الواجهة (71 orphan) | 50,442 LOC (26.6%) | 🔴 |
| `garage/` directory كامل ميت | 8,247 LOC | 🔴 |
| 20 UI primitive غير مستخدمة | ~4,300 LOC | 🟠 |
| 163 "tiny-proxy" route boilerplate | ~4,700 LOC | 🟡 |
| 33 DEPRECATED Flask blueprints | ~17,000 LOC | 🟠 |
| 9 صفحات Next.js ميتة | 4,711 LOC | 🟠 |
| 4 catch-all proxies متداخلة | 586 LOC | 🟡 |
| 3 أنظمة prediction-tracking متداخلة | ~2,932 LOC | 🟠 |

### 11.2 الثغرات الأمنية الـ 18 Critical (مُدمج من AUDIT_REPORT الأصلي — تم حذف المصدر بعد الدمج)

| ID | الموقع | الخطورة | الحالة |
|----|--------|---------|--------|
| **SEC-01** | NextAuth admin hardcoded | 🔴 | ✅ P0.1 — انتقل لـ env vars `ADMIN_EMAILS` |
| **SEC-03** | Paymob HMAC optional | 🔴 | ✅ P0.2 — HMAC إلزامي + أزيل fallback API key |
| **SEC-04** | `/api/python/*` no admin gate | 🔴 | ✅ P0.3 — استبدل بـ 308 redirect لـ `/api/proxy/*` |
| SEC-02 | NextAuth session secrets | 🔴 | ⏳ pending |
| SEC-05 | admin routes proxy | 🔴 | ⏳ |
| SEC-06 | crypto routes API keys | 🔴 | ⏳ |
| SEC-07 | portfolio routes validation | 🔴 | ⏳ |
| SEC-08 | telegram proxy rate limit | 🔴 | ⏳ |
| SEC-09 | auth.db encryption at rest | 🔴 | ⏳ |
| SEC-10 | predictions SQL injection | 🔴 | ⏳ |
| SEC-11 | admin token rotation | 🔴 | ⏳ |
| SEC-12 | webhook signature validation | 🔴 | ⏳ |
| MEM-01 | Next.js memory leak in page.tsx | 🔴 | ⏳ |

### 11.3 التناقضات في العتبات (Hardcoded Values)

| التناقض | القيم المتضاربة | الحالة |
|---------|-----------------|--------|
| `trailing_stop_activation_gain` | 2.0 (engine_settings) vs 3.0 (3 tests + institutional) | ✅ P0.4 — متوحّد على 2.0 |
| `tech_score_base` | 50 (engine_settings DEFAULT) vs hardcoded 50 in 2 files | ✅ P0.5 — استبدال بـ `get_setting()` |
| `STOP_LOSS_EGX/CRYPTO` dicts | hardcoded في `risk_management_advanced.py` | ✅ P0.6 — نقل لـ engine_settings |
| `REGIME_WEIGHTS` duplicate | `BASE_WEIGHTS` (sum 1.08) + `FULL_BASE_WEIGHTS` (sum 1.0) | ✅ P0.7 — حذف BASE_WEIGHTS |
| `default_stop_pct` / `max_stop_pct` | 7 قيم مختلفة | ⏳ P1.2 |
| `MAX_HOLDING_DAYS` | 30 / 90 / 90 / 30 / 1 / 20 (6 قيم) | ⏳ P1.1 |
| `position_max_stop_pct` | 6 قيم per-market | ⏳ P1.2 |

### 11.4 خطة التنفيذ المرحلية (مختصرة)

| المرحلة | المحتوى | الجهد | LOC محذوف/مُصلح |
|---------|---------|-------|----------------:|
| **P0** 🔴 | ثغرات أمنية + تناقضات حرجة | 1-2 يوم | ~2,000 (✅ معظمها DONE) |
| **P1** 🟠 | تناقضات متوسطة + regression tests + تسجيل `v4_bp` | 2-3 أيام | ~500 |
| **P2** 🟡 | توحيد محركات + تقسيم مكونات ضخمة + استبدال tiny-proxy | 4-5 أيام | ~15,000 (بواسطة الدمج) |
| **P3** 🟢 | حذف كود ميت + تنظيف UI primitives + 33 DEPRECATED | 3-4 أيام | ~90,261 |
| **P4** 🔵 | أداء + caching + pagination | 2-3 أيام | (إضافات) |
| **المجموع** | | **12-17 يوم** | **~107,761 LOC** |

### 11.5 مهام P3 المُنجزة جزئيًا

- ✅ **P3.3-partial:** حُذف 3 من 71 مكوّن orphan: `MainApp.tsx` (577) + root `PredictionTrackingView.tsx` (725) + `sync-prices-button.tsx` (80) = **1,382 LOC**.
- ✅ **P3.5:** حُذف `analyzers/simulated_*.py` (6 ملفات، 2,908 LOC).
- ✅ **P3.8-partial:** حُذف 3 ملفات مكسورة: `run.py` + `api/tracking.py` + `api/analysis.py` (686 LOC).
- ❌ **P3.9 ملغية:** كان مقترحًا حذف `expert_memory_v4` — هذا خطأ (الواجهة تستخدمه). نُقل لـ **P1.9**: تسجيل `v4_bp` في `lightweight_server.py`.

### 11.6 مكوّنات ضخمة مرشّحة للتقسيم [P2.7, P2.8]

| LOC | File | الإجراء |
|----:|------|---------|
| 6,450 | `analysis/MarketAnalysisView.tsx` | تقسيم → 8-10 ملفات (tabs/forms/modals) [P2.7] |
| 3,748 | `admin/MaestroCommandCenter.tsx` | (يخضع للـ React Flow — صعب التقسيم) |
| 3,259 | `admin/DatabaseManagerFull.tsx` | تقسيم per-tab |
| 3,069 | `portfolio/EnhancedPortfolioView.tsx` | تقسيم per-section |
| 2,750 | `admin/MaestroDashboard.tsx` | lazy tabs (أغلبها dynamic) |
| 2,403 | `admin/SuperLearningSystem.tsx` | lazy tabs |
| 2,200 | `admin/TelegramTab.tsx` | lazy sub-tabs |
| 2,188 | `academy/StrategySandbox.tsx` | تقسيم |
| 2,073 | `recommendations/AiRecommendations.tsx` | تقسيم |
| 2,068 | `reports/ExecutiveReportView.tsx` | تقسيم |
| 2,002 | `stocks/StocksView.tsx` | React.memo + useMemo [MEM-05] |
| 1,913 | `admin/AdminView.tsx` | lazy tabs [P2.8] |
| 1,908 | `predictions/PredictionTrackingDashboard.tsx` | تقسيم |

---

## 12. المؤشرات الخارجية (TradingView Pine Script V34)

> **الملف:** `Documentation/treadingView.code.text` (372 سطر — Pine Script v5).
>
> **هذا الملف هو الـ source الأصلي** لمؤشر TradingView الخارجي "محرك القرار المؤسسي V34 - Clean Financials" (CC BY-NC-SA 4.0 © LuxAlgo & BigBeluga). المنطق مُهاجر إلى Python في `vps-service/analyzers/institutional_decision_engine.py` + موثّق بالكامل في `SYSTEM_HOW_IT_THINKS.md` (Sections 3-9).

### 12.1 ما يفعله الـ Pine Script

المؤشر يعرض على TradingView chart وبيوفّر:
- **اختيار السوق:** تلقائي / EGX / Tadawul / Crypto
- **مدير محفظة:** سعر الشراء + الكمية → حساب PnL + نصيحة (امسك/زود/بيع)
- **رادار القطاع:** sector_name + sector_change (من Python)
- **عرض العناصر:** OB / FVG / Fair Value / DNA projections / Maker zones
- **إدارة المخاطر:** RR1=1.5, RR2=3.0 (مُهاجرة لـ `dynamic_rr_normal=1.5` + `dynamic_rr_outperform=2.0` في engine_settings)
- **محرّك البيانات:** ATR(14), RSI(14), Bollinger(20, 2.0), SMC elements

### 12.2 الترقية V34 → V39 → V40.2

| Feature | V34 (Pine) | V39 (Python) | V40.2 (Production) |
|---------|------------|--------------|---------------------|
| عدد الإثباتات | 5 | 6 (+benchmark) | 6 + R:R ≥ 1.5 floor gate |
| حد الشراء | ثابت 75 | ديناميكي ±10% | ديناميكي + kill filters |
| SL multiplier | 1.5 ثابت | ATR percentile 1.0-2.5 | ATR clamp [3%, 9%] |
| R:R ratio | 1.5/3.0 | 2.0/1.5 | dynamic 1.5/2.0 (outperform path) |
| TP1 | entry + risk × RR | DNA target لو بصمة طالعة | re-derive من clamped sl |

> **الـ V34 Pine Script هو artifact تاريخي.** المنطق الفعلي للنظام في Python (`institutional_decision_engine.py` + `v38_backtest_engine.py` + `v40_2_daily_generator.py`) ومُوثّق في `SYSTEM_HOW_IT_THINKS.md`. لا يتم تعديل الـ Pine Script — أي تطوير يحدث في Python ثم يُلهم نسخة Pine مستقبلية (إن لزم).

---

## 13. خريطة التبعيات (Dependency Map)

### 13.1 الـ Dashboard Widgets

```
DashboardView (478 LOC)
└── PinnableWidget grid (visible by user asset preference):
    ├── MarketSummary (81 LOC)
    ├── IndexCards (112 LOC)
    ├── TopMovers (147 LOC)
    ├── MarketSentiment (197 LOC)
    ├── CryptoSignalsWidget (233 LOC)
    ├── SeasonalitySignalsWidget (222 LOC)  ← SeasonalityDashboard
    ├── EidPredictionsWidget (254 LOC)
    ├── AutoAnalysisWidget (258 LOC)
    ├── NewsFeedWidget (211 LOC)
    ├── MaestroWidget (168 LOC)
    ├── LiveStockTicker (294 LOC)
    ├── MarketPulseWidget (873 LOC)
    ├── MultiMarketWidget (416 LOC)
    └── DevelopmentNotice (33 LOC)
```

### 13.2 الـ Chart Stack

```
TradingChartView (356 LOC, multi-chart workspace)
└── per chart slot:
    └── SingleStockAnalysisView (1,370 LOC)
        └── InteractiveChart (1,678 LOC)
            └── lightweight-charts (TradingView OSS)
                ├── candlestick series
                ├── volume histogram
                ├── SMA 20/50/200
                ├── RSI
                ├── CMF
                ├── Bollinger Bands
                ├── MACD (line/signal/histogram)
                ├── support/resistance levels
                ├── target/stop/entry price lines
                └── SMC (order blocks, FVGs, liquidity sweeps, fusion)
```

### 13.3 Backend ↔ Frontend data flow

```
User clicks /#stocks
  → useAppStore.setCurrentView('stocks')
  → page.tsx renderView() switch
  → dynamic(() => import('./stocks/StocksView')) with ssr:false
  → StocksView mounts
  → useEffect → fetch('/api/stocks?market=EGX&limit=200')
    → Next.js API route (src/app/api/stocks/route.ts)
      → if proxy: fetch('http://127.0.0.1:8010/api/stocks?...')
        → Flask blueprint stocks_bp (vps-service/api/stocks.py)
          → reads stocks.db (stocks table)
          → returns JSON
      → if direct: better-sqlite3 reads stocks.db
    → returns JSON to frontend
  → StocksView renders <StockTable>, <StockCard>, etc.
  → User clicks stock → router.push(`/stock/${ticker}`)
    → StockDetail page mounts
    → fetches /api/stock/[ticker] + /api/stocks/[ticker]/history + ...
```

### 13.4 الـ V40.2 Pipeline (Backend — مرتبط بالـ UI)

```
Cron (07:15 or 14:35 Cairo, Sun-Thu) OR manual trigger
  → jobs/v40_2_daily_generator.py --today-only
    → imports V38BacktestEngine from engines.v38_backtest_engine
    → set_strict_kill_filters(True) from liquidity_filter
    → for scan_date in get_scan_dates(start, end):
        → for ticker in get_tickers(min_days=200):
            → V38BacktestEngine.analyze(ticker, scan_date)
              → reads price_history.db (auto-resolved)
              → reads engine_settings via get_setting()
              → reads data_engine.db (fundamentals via fundamental_data_provider)
              → builds 6 proofs (trend/makers/dna/fundamental/sector/benchmark)
              → returns Trade with evidence_count, signal, r_multiple
              → compute_persona_fit() annotates kill_filter_result with | fit:<persona>(score)
        → sort by evidence_count DESC, take top MAX_PICKS_PER_DAY=5
        → R:R ≥ 1.5 floor gate (rejects sub-threshold setups)
        → write to predictions.db (evidence_count, kill_filter_result='V40 evidence...')
        → top 1 → morning_bell=1
  → daily_closer.py (next day) closes PENDING → TARGET_HIT/TRAILING_PROFIT/STOPPED/EXPIRED
  → learning_engine.py (Friday) → updates optimizer_params.json
```

### 13.5 الـ UI Polling Layer

| المكوّن | الـ API | الفترة |
|---------|--------|--------|
| `CentralAlertMonitor` | `/api/sniper/scan` | 60s |
| `PredictionTrackingDashboard` | `/api/predictions/honest-tracking/list` | 5min |
| `LiveMonitor` | `/api/live-tracking` + `/api/market/sync-live` | 30s |
| `RealtimeTicker` | `/api/market/live-prices` | 30s |

> **MEM-07:** Polling overhead — مرشّح للاستبدال بـ WebSocket (port 3005 / 8090) [P4.8].

---

## 14. المراجع والملفات المُدمجة

> كل ملفات `Documentation/*.md` السابقة (ما عدا الـ 4 master + `audit_map.json` + `treadingView.code.text`) مُدمجة هنا أو في الـ 3 ملفات الأخرى. تُعتبر **مراجع تاريخية** وسيُحذفها المالك.

### 14.1 الملفات المُدمجة هنا (في 02-SCREENS_AND_COMPONENTS.md)

| الملف المُدمج | المصدر | أين دُمج |
|--------------|--------|----------|
| `PICKS-MANAGEMENT-SYSTEM.md` | 498 lines | §7 (Picks Management UI) |
| `CLOSED_LOOP_FINAL.md` | 120 lines | §8 (Closed-Loop UI) |
| `RL-FIX-9-Predictions-Status-Logic.md` | 284 lines | §6 (Prediction-Tracking UI) |
| `03-REFACTORING_REPORT.md` | 937 lines | §10 + §11 (Dead/Duplicate + Refactoring) |
| `audit_map.json` | 24,910 lines | §4 (views inventory) + §10 (orphan inventory) — head read |
| `treadingView.code.text` | 372 lines | §12 (External Indicators) — head read |

### 14.2 الملفات المُدمجة في الـ master الأخرى

| الملف المُدمج | أين دُمج |
|--------------|----------|
| `CURRENT_STATE.md` | `00-CONSTITUTION.md` §4 (KPIs) + `01-PROJECT_ANATOMY.md` §13 |
| `PERSONA_UNIFY_A_MEASUREMENT_REPORT.md` | `00-CONSTITUTION.md` §5 (Persona policy) |
| `PROJECT_FULL_BLUEPRINT.md` | `01-PROJECT_ANATOMY.md` (architecture) |
| `API_DICTIONARY.md` | `01-PROJECT_ANATOMY.md` §7 (API Map) |
| `V40_2_LIVE_INTEGRATION_PLAN.md` | `00-CONSTITUTION.md` Rule 21 + `01-PROJECT_ANATOMY.md` |
| `RR_FIX_FINAL_REPORT_20260817.md` | `00-CONSTITUTION.md` Rule 18 + `01-PROJECT_ANATOMY.md` §13 |
| `P0_V2_POST_DEPLOY_RUNBOOK.md` | `00-CONSTITUTION.md` §4 (Hard Caps) |
| `V34-INSTITUTIONAL-DECISION-ENGINE.md` | `SYSTEM_HOW_IT_THINKS.md` §3-9 + هذا الملف §12 |
| `GAPS_AND_MISSING.md` | `00-CONSTITUTION.md` §15 (Critical Constraints) + هذا الملف §11 |
| `ULTRA-RESTORE-DATABASE-RECOVERY.md` | `00-CONSTITUTION.md` §10 (DB Safety) |
| `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` | `00-CONSTITUTION.md` §9 (Fundamentals) |
| `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md` | `00-CONSTITUTION.md` §9 (Fundamentals) |

### 14.3 الملفات المتبقية في `Documentation/`

| الملف | الدور |
|------|------|
| `00-CONSTITUTION.md` | Master #1 — الحوكمة والقواعد |
| `01-PROJECT_ANATOMY.md` | Master #2 — المعمارية |
| `02-SCREENS_AND_COMPONENTS.md` | Master #3 — هذا الملف |
| `SYSTEM_HOW_IT_THINKS.md` | Master #4 — منطق المحرك |
| `audit_map.json` | Machine-generated — يُعاد توليده عبر `scripts/audit_map.py` |
| `treadingView.code.text` | V34 Pine Script artifact (انظر §12) |
| باقي `*.md` | مراجع تاريخية — مرشّحة للحذف من قبل المالك |

---

## 📊 الإحصائيات النهائية للـ UI

| المؤشر | القيمة |
|--------|--------|
| إجمالي صفحات Next.js | 20 (9 نشطة، 9 ميتة، 2 redirect) |
| إجمالي API routes | 588 (257 proxy، 331 direct، 163 tiny-proxy) |
| إجمالي مكونات React | 328 (49 UI + 279 non-UI) |
| إجمالي LOC للواجهة | 189,785 (components) + 66,885 (API routes) |
| مكونات orphan | 71 (50,442 LOC = 26.6%) — ✅ 3 محذوفة (1,382 LOC) |
| مكونات massive (>500 LOC) | 139 (49 منها orphan) |
| UI primitives غير مستخدمة | 20 (~4,300 LOC) |
| `garage/` كامل ميت | 7 ملفات (8,247 LOC) |
| Flask blueprints ميتة (DEPRECATED) | 33 ملف (~17,000 LOC) |
| أنظمة prediction tracking متداخلة | 3 (1 نشط `honest-tracking`، 2 ميت/مكرر) |
| catch-all proxies متداخلة | 4 (مع overlap في الـ responsibilities — P0.3 ✅ موحّد على `/api/proxy/*`) |
| tiny-proxy boilerplate | 163 route (~4,700 LOC) — مرشّح للاستبدال [P2.12] |
| أصغر مكوّن نشط | `layout/MobileNav.tsx` (83 LOC) |
| أكبر مكوّن نشط | `analysis/MarketAnalysisView.tsx` (6,450 LOC) |
| أصغر صفحة نشطة | `/admin` redirect (35 LOC) |
| أكبر صفحة نشطة | `/admin/honest-predictions` (1,919 LOC) |

---

*هذا الملف هو مرجع الـ UI الكامل والمصدر الأوحد للحقيقة. أي إضافة/حذف شاشة أو مكوّن = تحديث هذا الملف فورًا + تحديث `audit_map.json` (عبر `scripts/audit_map.py`).*

*آخر تحديث: 2026-09-01 — إضافة NotebookAdminTab.tsx (524 LOC) في AdminView لـ إدارة Stock Notebooks. آخر تحديث سابق: 2026-08-17 — توحيد التوثيق (DOC-3). كل ملفات `Documentation/*.md` السابقة مُدمجة في الـ 4 master files.*

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `02-SCREENS_AND_COMPONENTS.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة `<NotebookAdminTab />` (524 LOC) في AdminView dynamic imports — واجهة إدارة Stock Notebooks تستدعي `/api/notebooks/*` (7 endpoints في `vps-service/api/notebook_routes.py`). |
