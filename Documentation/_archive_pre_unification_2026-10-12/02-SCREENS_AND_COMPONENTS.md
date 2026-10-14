# 🎨 02 — SCREENS & COMPONENTS (الشاشات والمكوّنات)

> **الملف الثاني من توحيد التوثيقات (DOC-UNIFY) — 2026-10-12.**
> هذا الملف هو **المصدر الأوحد للحقيقة** لشاشات الـ UI + 71 orphan component + 53 hash view + Pine Script V34 + Admin Views + Dead-Code Inventory + Tech Debt + Marketing Studio + Expert Analysis Engine.
>
> **المراجع التابعة (لا تكررها هنا — أشر إليها فقط):**
> - `00-CONSTITUTION.md` — القواعد الدستورية + Persona policy + UI-Mirror Protocol
> - `01-ARCHITECTURE_AND_API.md` — DBs + API routes (411) + Engine Map + Deployment
> - `03-HOW_IT_THINKS.md` — منطق V40.2 + Production Snapshot + 5-state taxonomy + ATR clamp
>
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **Production URL:** `https://invist.m2y.net` · **Production root:** `/root/GLMinvestment/`

> **آخر تحديث:** 2026-10-12 (Task `DOC-UNIFY-2-ARCH-SCREENS` — توحيد التوثيقات. الملف مبني من دمج 3 مصادر مؤرشفة في `_archive_pre_unification_2026-10-12/`: `02-SCREENS_AND_COMPONENTS.md` (3,200 سطر — المصدر الرئيسي) + `07-MARKETING-STUDIO-BLUEPRINT.md` (154 سطر — كـ §17) + `07-EXPERT-ANALYSIS-ENGINE.md` (245 سطر — كـ §18). DBs + APIs مُشار إليها في `01-ARCHITECTURE_AND_API.md` — لا تكرار. Pipeline / Logic مُشار إليها في `03-HOW_IT_THINKS.md`.)
>
> **آخر تحديث سابق:** 2026-10-12 (Task `DOC-SECRETARY-SIDE-EFFECTS` — DOCUMENTATION-SECRETARY per Rule 70 — تحديث Documentation بعد SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE-COLLECTOR — 9 orphan components أُرشفت لـ `archive/dead-components-20261012/` (4,408 LOC).)
>
> **آخر تحديث سابق:** 2026-10-05 (Task `SCREENS-SURVEY-2026-10-05` — ground-truth inventory — 53 hash views + 16 card components + 39 Telegram integration files.)

---

## 📑 المحتويات

| القسم | الموضوع |
|------|---------|
| [§1](#1-screen-status-rollup) | Screen Status Rollup (25 شاشة) |
| [§2](#2-الإحصائيات-الكلية) | الإحصائيات الكلية (247 tsx) |
| [§3](#3-الشاشة-الواحدة--srcapppagetsx) | الشاشة الواحدة `/` (page.tsx switch) |
| [§4](#4-sidebarnavheaderfooter) | Sidebar/Nav/Header/Footer |
| [§5](#5-كل-view-بحالته-45-hash-view) | كل VIEW بحالته (45 hash view) |
| [§6](#6-persona-ui) | Persona UI (القواعد → 00) |
| [§7](#7-prediction-tracking-ui) | Prediction-Tracking UI |
| [§8](#8-picks-management-ui) | Picks Management UI |
| [§9](#9-closed-loop-ui) | Closed-Loop UI |
| [§10](#10-admin-views-inventory-20-tab) | Admin Views Inventory (20+ tab) |
| [§11](#11-deadduplicate-inventory-71-orphan--garage) | Dead/Duplicate Inventory (71 orphan + garage) |
| [§12](#12-tech-debt--refactoring-plan) | Tech Debt + Refactoring plan |
| [§13](#13-tradingview-pine-script-v34) | TradingView Pine Script V34 |
| [§14](#14-dependency-map) | Dependency Map |
| [§15](#15-calc-consolidation--backtest-analysis-tuning) | CALC-CONSOLIDATION + BACKTEST-ANALYSIS tuning |
| [§16](#16-screens-survey-2026-10-05) | SCREENS-SURVEY-2026-10-05 |
| [§17](#17-marketing-studio-blueprint) | Marketing Studio Blueprint |
| [§18](#18-expert-analysis-engine) | Expert Analysis Engine |

---

## 1. Screen Status Rollup

> **الهدف:** لقطة سريعة لحالة كل شاشة رئيسية في النظام. الحالات: ✅ working · ⚠️ partial · ❌ broken · 🚫 deprecated.
> التفاصيل الكاملة لكل شاشة في §5 (الـ views) و §10 (الـ admin).

| # | الشاشة (view ID) | الحالة | ملاحظات (2026-09-27) |
|---|---|---|---|
| 1 | `dashboard` | ✅ working | يعرض indices + backtest table + liquidity flow + intraday pressure + investors flow + crypto signals (حسب currentMarket). |
| 2 | `stocks` (stock-filters / screener) | ✅ working | schema-aware SQLite fallback (Python → SQLite → data_engine.db) + dynamic sectors لكل سوق. |
| 3 | `smart-confluence` | ✅ working | يعرض 20 BUY predictions مأخوذة من V40.2 generator. |
| 4 | `trading-chart` | ⚠️ partial (1 non-critical error in widget) | الشارت يعرض 5m/15m/30m/1h/1D/1W + range bar؛ خطأ widget غير حر في `<TradingViewChart>` (معالَج عبر `<ErrorBoundary>` — لا يسبب crash). |
| 5 | `recommendations` (متابعة التوقعات) | ✅ working | 6-7 tabs (3 personas + tracking + summary + missed + learn-from-errors). **3 orphan tabs جديدة wired (P0-12 wave): LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab.** يستخدم `/api/predictions/honest-tracking/*` (3 SQLi sites تم fix). |
| 6 | `picks-management` | ✅ working | 5 daily picks + history + active management. `hunter_pick_tracking` populated (P0 fix #2). |
| 7 | `reports` | ✅ working | auth-protected — image cards (persona, market status, stock league, top trades). `stored_analyses` populated (P0 fix #1). |
| 8 | `live-monitor` | ✅ working | مراقبة لحظية + intraday pressure + market depth + investors flow (EGX/TADAWUL/KSE/QSE فقط). |
| 9 | `trading-memory` | ✅ working | auth-protected — `/api/python/v4/insight/*` (✅ `v4_bp` تم fix — P0 fix #5). |
| 10 | `portfolio` | ✅ working | Enhanced portfolio view + multi-portfolio + position deep-dive + risk profiler quiz. |
| 11 | `watchlist` | ✅ working | Enhanced watchlist + professional view. |
| 12 | `alerts-center` | ✅ working | مركز التنبيهات + smart alerts panel + sniper scan polling. |
| 13 | `wealth` | ✅ working | wealth charts + real return panel. `/api/money/wealth` تم تأمينه بـ `requireAuthAsync` (P0-11-AUTH). |
| 14 | `crypto` (+ 8 crypto sub-views) | ✅ working | UI-Mirror Protocol — نفس المكوّنات بـ `currentMarket='CRYPTO'`. |
| 15 | `specialist-analysis` | ✅ working | تحليل المتخصصين + Fibonacci + Candlestick widgets. |
| 16 | `learning` + `academy` | ✅ working | مركز التعلم + أكاديمية + CandlestickSimulator + StrategySandbox + PaperTradingWorkstation. |
| 17 | `simulation` | ✅ working | محاكاة الورق + paper-trading-v2. |
| 18 | `zakat` + `tithes` | ✅ working | Islamic finance (zakat + tithes). |
| 18b | `sharia` (NEW — Wave 8 — Task 23-C) | ✅ working | **التوافق الشرعي** — 3 tabs: قائمة 253 سهم + حساب تطهير صفقة + حساب تطهير محفظة. Islamic-financial aesthetic (emerald + gold + geometric pattern overlay). Wired via `#sharia` hash route. `ShariaBadge` مدمج في `StockDetail` + `PersonaTab` + `MakerRadarTab` (EGX-only gate). |
| 19 | `subscription` | ✅ working | الباقات + Paymob + Google Play receipt verification. `/api/subscription/upgrade` + `/api/subscription/start-trial` تم تأمينهم بـ `requireAuthAsync` (P0-11-AUTH). |
| 20 | `auth` + `settings` + `about` | ✅ working | NextAuth (Google + Bearer) + user settings + static about. |
| 21 | `admin` | ✅ working | 20+ sub-tabs (Maestro disabled per KILL-MAESTRO، NotebookAdminTab active، Backtest، Telegram، Crypto، Forex، SystemControl، Users، **NEW Wave 8: Sharia management + Source Authority + Validation Monitor + Cron Health**). كل `/api/admin/*` routes مُؤمَّنة بـ `requireAdminAsync` (P0-11-AUTH). |
| 22 | `backtesting` | ⚠️ partial (hidden) | `<EGXBacktestDashboard />` — لا entry في الـ sidebar (legacy). |
| 23 | `prediction-performance` / `prediction-credibility` | 🚫 deprecated (DEAD) | يرجّع placeholder — admin-only. |
| 24 | `community` | 🚫 deprecated (DEAD) | شالها الـ sidebar + CommunityView orphan (581 LOC). |
| 25 | `trading-journal` / `unified-analysis` / `StoredAnalysisView` | 🚫 deprecated (moved/distributed) | مُوزَّعة على admin / recommendations / specialist-analysis. |

---

## 2. الإحصائيات الكلية

> **تحديث 2026-10-04 — Wave 8 Update — Task 28-C**

| المؤشر | القيمة |
|---|---|
| Next.js page routes | 20 (9 نشطة · 9 ميتة · 2 redirect) · **+1 NEW hash view `#sharia`** |
| Next.js API routes | **411 route.ts** (Wave 8 — was 380 in Wave 2/3; restored 32 Flutter endpoints) · 257 proxy لـ Python · ~331 direct · 163 tiny-proxy boilerplate · **30 route مُؤمَّنة بـ auth** · **7 SQLi sites fixed** · **24 route async I/O** |
| Hash views في `page.tsx` | **53** (~23 نشطة + 30 hidden/legacy + 2 admin-only stub) |
| React components | **247 tsx** (was 285 pre-Wave-2 — Wave 2 archived 51 dead + 16 shadcn) + 24 ts (non-tsx) = 274 total under `src/components/` + `src/modules/` |
| **Color system (NEW — Wave 8 — Task 24)** | Emerald-600 (`hsl(160, 84%, 39%)` ≈ `#10B981`) — was 0% saturation grayscale. Compliance: Rule 29 (NO-HYPE — alpha ≤ 0.15) + Rule 30 (CLIENT-FACING-STYLE — no blue/indigo). |
| **Typography (NEW — Wave 8 — Task 24)** | Cairo font + tabular figures (`font-feature-settings: 'tnum' 1, 'cv01' 1` + `font-variant-numeric: tabular-nums`) for price column alignment. |
| **Card shadows (NEW — Wave 8 — Task 24)** | dual-layer box-shadow + opt-in `card-hover` lift effect (translateY(-1px) + emerald border tint hsl(ring)/0.35) + body emerald radial gradient (alpha 0.05 light / 0.08 dark — Bloomberg-terminal feel). |
| UI primitives المستخدمة | 49 (29 مستخدمة بكثرة + 20 orphan) |
| مكوّنات orphan (dead) | **71** (50,442 LOC ميتة — 26.6%) |
| Flask Blueprints | 53 registered (33 DEPRECATED api files ~17,000 LOC) |
| **Test files / cases (post P0-16-TESTS)** | **9 files / 121 tests / 1,796 LOC** — 121/121 passing |
| **Observability (NEW)** | Sentry + structured logger + deep-check /api/health (262 LOC) + x-request-id middleware |

### 2.1 UnifiedTable Upgrade (2026-09-26)

> **المرجع الدستوري:** القاعدة 54 (UNIFIED-TABLE-UPGRADE — 2026-09-26) + القاعدة 52 (UNIFIED-REUSABLE-COMPONENTS — 2026-09-25).
> **المكوّن:** `src/components/shared/UnifiedTable.tsx`
> **النموذج المرجعي (Canonical Pattern):** `src/components/admin/SectorTrackingTab.tsx`

**الميزات المضافة في الترقية:**

| الميزة | الوصف | الحالة |
|---|---|---|
| **Expandable Rows** | كل row يمكنه فتح sub-row مع `renderExpanded` prop | ✅ منفّذ |
| **Column Toggle** | المستخدم يُظهِر/يُخفي الأعمدة من قائمة في الـ toolbar (يُحفَظ الاختيار في localStorage) | ✅ منفّذ |
| **Column Filtering** | كل عمود يدعم filter مخصص (text / number / select / date range) | ✅ منفّذ |
| **Toolbar (Publish + Export)** | toolbar موحّد فيه `UnifiedPublishButton` + زر Export (CSV/PNG/PDF) | ✅ منفّذ |
| **Sticky Header + RTL + Sort** | ميزات سابقة من القاعدة 52 — لا تزال مدعومة | ✅ محفوظة |

**حصر الشاشات التي تحتاج ترحيل (21 شاشة):** كل الشاشات التي لا تزال تستخدم `<Table>` اليدوي من shadcn/ui. الترتيب: شاشات الـ admin أولاً (لأنها الأعلى استفادة من الـ features الجديدة)، ثم شاشات العميل.

### 2.2 Phases A/B/C/D — Engine Upgrades (2026-09-26)

| Phase | الوصف | التفاصيل الفنية | الحالة |
|---|---|---|---|
| **A — Multi-Market Support** | V40.2 يدعم `market_code` parameter لكل الأسواق الستة | `market_code ∈ {EGX, KSA, KSE, QSE, CRYPTO}` — يُمرَّر في `analyze_single_day_v393()` + `daily_predictor.py` | ✅ منفّذ |
| **B — Liquidity Primary Gate** | فلتر السيولة أصبح **البوابة الرئيسية** قبل التحليل | `liquidity_filter.py` يشتغل **قبل** `analyze_single_day_v393()` | ✅ منفّذ |
| **C — Dynamic Thresholds** | 20+ hardcoded thresholds أصبحت ديناميكية | استبدال كل `if x > 0.05` بـ `get_setting('threshold_name', default)` | ✅ منفّذ |
| **D — A/B Backtest Harness** | نظام A/B backtest لقياس الأثر الفعلي لكل تغيير | `vps-service/backtest_results/` يحتوي على `ab_backtest_baseline_*.json` | ✅ منفّذ |

**Baseline محفوظ (2026-09-26):** `ab_backtest_baseline_*.json` يحتوي على:
- Win Rate: **67.4%** (1,229 resolved predictions) — ملاحظة: هذا الـ baseline على الـ recorded status؛ الـ WR الفعلي بعد HELI-CLEANUP-2 حوالي ~50–55% (راجع `03-HOW_IT_THINKS.md` Production Snapshot)
- Avg Return: **25.74%**
- Profit Factor: **12.84**
- Max Loss Streak: **7**

> تفاصيل Pipeline / Logic: مرجع `03-HOW_IT_THINKS.md` (Production Snapshot).

### 2.3 P0 Wave 2026-09-27 — Security + Observability + Tests

> **المرجع:** `worklog.md` entries `P0-12-SQLI` + `P0-17-RECONCILE` + `P0-7-15-INFRA` + `P0-14-ASYNC` + `P0-11-AUTH` + `HELI-INVESTIGATION` + `HELI-CLEANUP-2` + `P0-8-DB-UNIFY` + `P0-16-TESTS` + `00-CONSTITUTION.md` Rules 55–59.

**أ. UI المُتأثرة بـ P0 Wave:**

| المكوّن / الشاشة | التغيير | الحالة |
|---|---|---|
| `MarketAnalysisView` (#recommendations) | **3 orphan tabs جديدة wired** — LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab. كانوا orphan components (موجودين بس مش متوصّلين)، دلوقتي شغّالين جوّه الـ view. | ✅ منفّذ |
| `MarketAnalysisView` (#recommendations) | `/api/predictions/honest-tracking/live-tracking/route.ts` — 3 SQLi sites تم fix (`${market.toUpperCase()}` → bound `?` params + whitelist) (P0-12-SQLI) | ✅ منفّذ |
| `PicksManagementView` (#picks-management) | `/api/predictions/daily-picks` يقرأ من `hunter_pick_tracking` المُلأ (P0 fix #2). | ✅ منفّذ |
| `ReportsView` (#reports) | `/api/reports/*` يقرأ من `stored_analyses` المُلأ (P0 fix #1). | ✅ منفّذ |
| `TradingMemoryView` (#trading-memory) | `/api/python/v4/insight/*` — `v4_bp` blueprint تم fix (`lightweight_server.py:99`) (P0 fix #5) | ✅ منفّذ |
| `WealthCharts` / `MoneySmartMonitor` | `/api/money/wealth` + `/api/money/smart-monitor` تم تأمينهم بـ `requireAuthAsync` (was open) (P0-11-AUTH) | ✅ منفّذ |
| `SubscriptionView` (#subscription) | `/api/subscription/upgrade` + `/api/subscription/start-trial` تم تأمينهم بـ `requireAuthAsync` (had getServerSession only — added Bearer/mobile support) (P0-11-AUTH) | ✅ منفّذ |
| `AdminView` (#admin) | كل `/api/admin/*` routes مُؤمَّنة بـ `requireAdminAsync` (defense-in-depth) (P0-11-AUTH) | ✅ منفّذ |
| `DisclaimerBanner` (help modal) | persistence fix — الـ dismiss state بيتخزّن في `localStorage` بـ **30-day expiration** (كان بيتفتح على كل reload) | ✅ منفّذ |

**ب. Radar — signal-tracker auto-record:**

| المكوّن | التغيير | الحالة |
|---|---|---|
| `src/lib/radar-signal-tracker.ts` | signal-tracker دلوقتي بـ auto-record على كل warmup (كان manual-trigger فقط). كل الـ maker_radar runs بـ يـ write لـ `radar_signal_tracking` table تلقائياً. | ✅ منفّذ |
| 6 radar features | 5 endpoints (entry-timing + footprint + sector-treemap + signal-tracker + signal-tracker/verify) + 1 pipeline موصول (V40.2 maker_radar pipeline) | ✅ منفّذ |

**ج. Observability:**

| المكوّن | الأثر على الـ UI | الحالة |
|---|---|---|
| `/api/health` deep-check | الـ admin بـ يـ fetch الـ health كل 30s — دلوقتي بيرجع `status + components.databases + nextjs + disk` بدل مجرد "ok" | ✅ منفّذ |
| `x-request-id` middleware | كل HTTP response فيه header `x-request-id` — debug أسرع للـ production issues | ✅ منفّذ |
| Sentry | الـ client-side errors بـ تـ auto-capture + session replay (10% prod / 100% on error) | ✅ منفّذ |

**د. Tests:**

| المكوّن | الحالة |
|---|---|
| 9 test files / 121 tests / 1,796 LOC | ✅ 121/121 passing — quality gate على كل commit |
| Test philosophy: READ-ONLY DB + live HTTP fetch (auto-skip لو server مش شغال) | ✅ adopted |

### 2.4 Module Mapping (2026-09-30)

> **المرجع الدستوري:** Rule 60 (MODULE-SYSTEM — 2026-09-30) في `00-CONSTITUTION.md`.
> **القاعدة:** كل شاشة دلوقتي بت pertence لموديول في `src/modules/<module>/`. الـ components الـ legacy لسه في `src/components/<domain>/` (يُفضّل ترحيلها في P1).

| Hash View | Module | Notes |
|---|---|---|
| `#stocks` | `modules/stock-analysis/` | StockDetail + ComprehensiveStockAnalysis + StocksView + StockSelector + ... |
| `#recommendations` | `modules/market-analysis/` | MarketAnalysisView + PersonaTab + PredictionsTab + SectorTrackingTab + LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab + ... (11 tabs) |
| `#liquidity-radar` | `modules/predictions/` (MakerRadarTab) + `modules/radar/` (ExitRadarTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab) | Wired in Phase 4.1 — 3 radar tabs in MarketAnalysisView |
| `#picks-management` | `modules/predictions/` | PicksManagementView — `hunter_pick_tracking` populated (P0 fix #2) |
| `#portfolio` | `modules/portfolio/` | EnhancedPortfolioView + RoboAdvisorPanel + AdvancedPortfolioManager + BagHolderRescuePanel + RiskProfilerQuiz + ... (15 components) |
| `#watchlist` | `modules/portfolio/` | Shares module with portfolio — multi-portfolio selector |
| `#crypto` (8 sub-views → 4 live بعد ORPHAN-GARAGE-COLLECTOR 2026-10-12) | `modules/crypto/` | ~~`CryptoTradingChartView`~~ 🗑️ **محذوف/أرشيف** + ~~`CryptoAdditionalViews`~~ 🗑️ + ~~`CryptoAdvancedAnalysisView`~~ 🗑️ + ~~`CryptoScreenerView`~~ 🗑️ + `CryptoPredictionTrackingView` (live) + `CryptoSimulationView` (live) + `CryptoLearningView` (live) + `CryptoPortfolioView` (live) |
| `#reports` | `modules/reports/` | ReportsView + DataManager + StockAnalysisReport + DailyMarketReport + ExecutiveReportView |
| `#simulation` | `modules/simulation/` | SimulationView |
| `#academy` (single canonical) | `modules/education/` | AcademyView + AcademyEncyclopedia + CandlestickSimulator + StrategySandbox + PaperTradingWorkstation + LessonPDFExporter + MathRenderer + LearningVisuals (8 components — `#learning` archived 2026-10-01 to `archive/education-duplicate-2026-10-01/`) |
| `#dashboard` | `modules/dashboard/` | DashboardView + 21 widgets (LiquidityFlowPanel + IntradayPressurePanel + InvestorsFlowPanel + LiveMonitor + TopMovers + ~~MaestroWidget~~ 🗑️ محذوف + ...) |
| `#news` | `modules/news/` | NewsFeedView |
| `#admin` | `modules/admin/` | AdminView + 34 components (DatabaseManagerFull + SystemTopologyTab + SystemTopologyGraph + WealthCharts + NotebookAdminTab + BacktestTab + ...) + live-chart/ + platform-performance/ subdirs |
| `#specialist-analysis` | `modules/stock-analysis/` (StockAdvancedAnalysisView) + `modules/market-analysis/` (UnifiedAnalysisView) | Hybrid view |
| `#screener` | `modules/screener/` | StockScreenerAdvanced |
| `#trading-chart` | `modules/stock-analysis/` | TradingViewChart + MarketDepthPanel |
| `#alerts-center` | `modules/dashboard/` (LiveMonitor widget) + `modules/market-analysis/` (AlertPanel) | Wired |
| `#trading-memory` | `src/components/memory/` (TradingMemoryView — NOT yet moved) | Imports from `modules/portfolio/` (PortfolioIntelligencePanel + SmartAssistantPanel) |
| `#wealth` | `modules/admin/` (WealthCharts) + `modules/portfolio/` (RealReturnPanel) | Wired |
| `#live-monitor` | `modules/dashboard/` (LiveMonitor) | Dashboard widget |
| `#subscription` + `#auth` + `#settings` + `#about` | `src/components/auth/` + `src/components/settings/` (NOT yet moved) | Cross-cutting — not part of a single module |
| `#zakat` + `#tithes` | `src/components/zakat/` (NOT yet moved) | Islamic finance — niche module |
| `#backtesting` | `src/components/admin/EGXBacktestDashboard` (legacy — hidden) | ⚠️ Partial — no sidebar entry |
| `#prediction-performance` / `#prediction-credibility` | 🚫 deprecated (DEAD) | Admin-only — placeholder |
| `#community` | 🚫 deprecated (DEAD) | Sidebar removed + CommunityView orphan |
| `#trading-journal` / `#unified-analysis` / `#StoredAnalysisView` | 🚫 deprecated (moved/distributed) | Distributed on admin / recommendations / specialist-analysis |

> **Module count summary (verified 2026-10-01 — Task WAVE-2-3-DOCS):**
> - Frontend modules في `src/modules/`: **17** (radar + publishing + personalized + stock-analysis + predictions + portfolio + screener + market-analysis + news + admin + crypto + education + reports + dashboard + simulation + subscription + auth) — unchanged by Wave 2/3.
> - Backend module placeholders في `vps-service/modules/`: **9** (radar + predictions + market_regime + market_data + telegram + ai + portfolio + admin + root) — مرجع `01-ARCHITECTURE_AND_API.md` §8.2.
> - الـ components الكلية (active): **247** (verified via `find src/components src/modules -name "*.tsx" | wc -l`).

### 2.5 Wave 2 Cleanup Delta (2026-10-01)

> **Owner directive:** "التناسق وعدم التكرار" — archival (NOT deletion) of all dead/duplicate files.

**121 frontend dead files archived to `archive/wave-2-cleanup-2026-10-01/`** (NOT deleted — owner directive — recoverable):

| Category | Files | LOC | Examples |
|---|---|---|---|
| shadcn UI primitives (tree-shaken, never imported) | 16 | 2,961 | `aspect-ratio.tsx`, `calendar.tsx`, `carousel.tsx`, `command.tsx`, `context-menu.tsx`, `drawer.tsx`, `menubar.tsx`, `pagination.tsx`, `sidebar.tsx`, `toaster.tsx`, ... |
| Legacy dead components | 12 | 3,868 | `CandlestickWidget.tsx`, `FibonacciWidget.tsx`, `DevilsAdvocatePanel.tsx`, `NotificationBell.tsx`, `AIView.tsx`, `OpportunityCard.tsx`, `PerformanceTracker.tsx`, `RecommendationHistory.tsx`, `RecommendationMonitoring.tsx`, `SocialPostView.tsx`, `PublishedPredictions.tsx`, ... |
| Admin module dead | 14 | 6,243 | `AdGeneratorTab.tsx`, `ContentStudioHub.tsx` (LATER RESTORED — false-positive), `MarketingHub.tsx` (LATER RESTORED), `VideoEditor.tsx` (LATER RESTORED), `HumanRecommendationsAdmin.tsx`, `SectorClassificationAdmin.tsx`, `GoldSilverTab.tsx`, `NotebookAdminTab.tsx`, `MultiMarketTab.tsx`, `ForexTab.tsx`, `DataEngineTab.tsx`, `CryptoAdminPanel.tsx`, `CryptoPredictionGenerator.tsx`, `OptimizerParamsPanel.tsx`, `RowEditorModal.tsx`, `SystemTopologyTab.tsx`, `SystemTopologyGraph.tsx`, `live-chart/index.tsx` |
| Frontend remaining | 7 | 2,077 | `PicksManagementView.tsx` (1,063 LOC — page.tsx:160 comment said "merged into PredictionTrackingView" but file still existed; archived), `SectorPieChart.tsx`, `SectorTreemapCard.tsx` (standalone), `RiskManagementBar.tsx`, `UnifiedHoldingsTable.tsx`, `PositionDeepDiveDrawer.tsx`, `UpsellToasts.tsx` |
| Frontend lib TS | 18 | 3,141 | `api-cache.ts`, `api-config.ts`, `auto-seed-stocks.ts`, `build-trigger.ts`, `candlestick-patterns.ts`, `db-helpers.ts`, `patch-html2pdf.ts`, `pick-formatter.ts`, `prediction-validator.ts`, `seed-subscription-pricing.ts`, `seed-virtual-investor.ts`, `sqlite-compat.ts`, `use-engine-updates.ts`, `use-undo-redo.ts`, `cache/data-freshness.ts` (LATER RESTORED), `cache/api-cache.ts` (LATER RESTORED), `devil/market-mood.ts`, `expert/expert-filter.ts` |
| TOTAL archived | 67 files (.tsx + .ts) + 16 shadcn + 12 legacy + 14 admin + 7 remaining + 18 lib TS = 67 (some overlap counted) → **121 total** | ~21,335 LOC | (Wave 2 archived to `archive/wave-2-cleanup-2026-10-01/src/components/` + `src/modules/` + `src/lib/`) |

**6 false positives caught + skipped (kept alive per Rule 16 VERIFY-BEFORE-DELETE):**
1. `ContentStudioHub.tsx` (886 LOC) — lazily imported by `MarketingStudio.tsx:25`
2. `MarketingHub.tsx` (503 LOC) — lazily imported by `MarketingStudio.tsx:26`
3. `VideoEditor.tsx` (653 LOC) — lazily imported by `MarketingStudio.tsx:24`
4. `telegram_target_hit_tracker.py` (1,012 LOC) — confirmed LIVE via auto_post_scheduler.py:1524 → PM2 telegram-poster → telegram_bp at lightweight_server.py:73
5. `jobs/fetch_corporate_actions.py` (292 LOC) — cron-driven per crontab.txt:53
6. `jobs/hot_candidate_detector.py` (299 LOC) — cron-driven per crontab.txt:150

**HTTP 500 restore:** `src/lib/cache/api-cache.ts` + `src/lib/cache/data-freshness.ts` were restored post-deletion when dynamic callers (Next.js `next/dynamic` imports) were discovered — commit `2529dba`. Lesson: caller-grep must include dynamic-import patterns.

---

## 3. الشاشة الواحدة `/` (src/app/page.tsx)

> **القاعدة الدستورية 3:** لا تُنشئ صفحات Next.js جديدة. كل الـ views تُحمّل داخل `src/app/page.tsx` عبر hash-based routing.

### 3.1 الـ App Shell

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
├── <Footer />                    # Social + legal links (STICKY FOOTER)
├── <MobileNav />                 # Bottom 5 icons (موبايل فقط)
├── <FloatingAssistant />         # زر AI عائم أسفل اليمين
├── <RoboNotifierToggle />        # زر إشعارات حية أسفل اليسار
├── <NotificationCenter />        # Panel منزلق للإشعارات
└── <Toaster dir="rtl" />         # Sonner toaster
```

### 3.2 آلية `renderView()`

كل case في الـ switch بـ يستخدم `next/dynamic` مع `ssr:false` لتفادي hydration errors:

```typescript
const StocksView = dynamic(() => import('@/components/stocks/StocksView'), { ssr: false });
const MarketAnalysisView = dynamic(() => import('@/components/analysis/MarketAnalysisView'), { ssr: false });
// ... 45 view مُسجّلة
```

كل view مُغلّف بـ `<ErrorBoundary>` (في `shared/ErrorBoundary.tsx`, 272 LOC) لمنع انهيار الـ shell بالكامل لو في view رمى استثناء.

### 3.3 الصفحات الفرعية (Next.js pages)

بجانب `/`، يوجد 11 صفحة Next.js نشطة (معظمها admin iframe أو legal):

| # | Route | File | LOC | الوظيفة |
|---|-------|------|----:|---------|
| 1 | `/admin/educational-cards` | `src/app/admin/educational-cards/page.tsx` | 1702 | Admin UI للـ educational cards (CRUD + نشر Telegram) — يُحمّل داخل AdminView iframe |
| 2 | `/admin/honest-predictions` | `src/app/admin/honest-predictions/page.tsx` | 1919 | Admin historical-predictions generator — iframe داخل AdminView |
| 3 | `/admin/reports` | `src/app/admin/reports/page.tsx` | 118 | Trading Reports Hub (Stock League image cards) |
| 4 | ~~`/maestro`~~ | ~~`src/app/maestro/page.tsx`~~ | ~~124~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان standalone Maestro page (admin-gated). سيدي طلب حذفه: "Maestro ده ماضي أسود". |
| 5 | `/stock/[ticker]` | `src/app/stock/[ticker]/page.tsx` | 1233 | صفحة تفاصيل السهم (price/technicals/fundamentals/news/charts) |
| 6 | `/legal/disclaimer` | `src/app/legal/disclaimer/page.tsx` | 207 | إخلاء المسؤولية (عربي) — من Footer |
| 7 | `/legal/privacy` | `src/app/legal/privacy/page.tsx` | 195 | سياسة الخصوصية (عربي) |
| 8 | `/legal/terms` | `src/app/legal/terms/page.tsx` | 263 | شروط الخدمة (عربي) |
| 9 | `/payment/success` | `src/app/payment/success/page.tsx` | 156 | معالج نجاح الدفع (paymob callback) |
| 10 | `/admin` | `src/app/admin/page.tsx` | 35 | redirect → `/#admin` (الـ admin في الـ shell) |

> **الـ 9 صفحات الميتة (4,711 LOC) مذكورة في §11.**

> **Wave 3 (Task 9-A — 2026-10-01):** `#learning` hash view (LearningView.tsx) was **archived** to `archive/education-duplicate-2026-10-01/` (NOT deleted). `'learning'` removed from `VALID_VIEWS` array + `AppView` type union + `AuthGate.PROTECTED_VIEWS` + `CRYPTO_VIEW_REDIRECTS` (now redirects `crypto-learning` → `academy`). All nav entries removed from TopBar + MobileMoreSheet + page.tsx switch + dynamic import. **`#academy` is now the SINGLE canonical education screen** with 5 tabs.

---

## 4. Sidebar/Nav/Header/Footer

### 4.1 `layout/Sidebar.tsx` (604 LOC) — النشطة ✅

**الموقع:** `src/components/layout/Sidebar.tsx`
**الحالة:** ✅ ACTIVE (2 importers — page.tsx + AdminView)
**الوظيفة:** القائمة الجانبية اليمينية (RTL) — تحتوي 4 أقسام رئيسية + عناصر سفلية + زر admin.

**الأقسام الأربعة:**

| القسم | اللون | الحالة الافتراضية | العناصر |
|------|------|-------------------|---------|
| **market** (السوق) | emerald | مفتوح | dashboard, stocks, trading-chart, recommendations (متابعة التوقعات), picks-management, specialist-analysis, reports, learning, simulation, academy |
| **money-management** | amber | مفتوح | portfolio, watchlist, smart-confluence, alerts-center, wealth, live-monitor, trading-memory |
| **crypto** | orange | مفتوح | 6 عناصر (UI mirror protocol — نفس مكوّنات الأسهم مع `currentMarket='CRYPTO'`) |
| **islamic** | purple | مغلق | zakat, tithes, sharia (NEW Wave 8) |

**عناصر سفلية:** subscription, about, settings
**زر admin:** `admin` (يظهر فقط لو `user.is_admin`)

**ملاحظة (v3.66.8):** الـ sidebar شال entry الـ `advanced-analysis` (صار redirect لـ `#recommendations`).

### 4.2 `layout/MobileNav.tsx` (83 LOC) — ✅

**الحالة:** ACTIVE (2 importers)
**الوظيفة:** شريط سفلي بـ 5 أيقونات على الموبايل فقط: dashboard, recommendations, portfolio, trading-chart, settings.

### 4.3 `layout/Header.tsx` (226 LOC) — ✅

**الحالة:** ACTIVE (10 importers — ثاني أعلى مكوّن استخدامًا بعد ShareButton)
**الوظيفة:** رأس التطبيق RTL — يحتوي market switcher (EGX/Crypto) + بحث سهم + زر إشعارات.

### 4.4 `layout/Footer.tsx` (116 LOC) — ✅ (STICKY FOOTER)

**الحالة:** ACTIVE (2 importers)
**الوظيفة:** Footer بروابط اجتماعية + روابط قانونية (legal/disclaimer, privacy, terms).

> **متطلب STICKY FOOTER (مُلزم):** الـ Footer لازم يبقى مثبّتًا في أسفل الصفحة دائمًا حتى لو الـ content قصير. أي إعادة هيكلة للـ layout لازم تحافظ على هذا السلوك (يجب ألا يصبح `position: static` أو يُدفع خارج الشاشة عند views طويلة).

### 4.5 باقي مكوّنات الـ layout

| المكوّن | LOC | الحالة |
|---------|----:|--------|
| `RealtimeTicker` | 294 | ✅ active — شريط أسعار متحرك أعلى الـ Header |
| `CentralAlertMonitor` | 276 | ✅ active — polling `/api/sniper/scan` كل 60s |
| `RoboNotifierToggle` | (small) | ✅ active — زر إشعارات حية |
| `NotificationCenter` | (med) | ✅ active — panel منزلق |
| `PlatformGuide` (help/) | 486 | ✅ active (3 importers) — مودال تعليمي |

---

## 5. كل VIEW بحالته (45 hash view)

> كل view مُعرّف في `page.tsx` switch. الحالة:
> - ✅ **ACTIVE** — مُستورد من `page.tsx` + مرئي في الـ sidebar أو عبر hash route.
> - ⚠ **HIDDEN/ALIAS** — مُستورد لكن مش في الـ sidebar (alias أو legacy).
> - ❌ **DEAD** — في الـ switch لكن بـ يرجّع placeholder، أو مُزال من الـ sidebar + orphan component.

### 5.1 قسم السوق (market) — 10 views

| View ID | Label (Ar) | Component | LOC | Status | API المُستدعى |
|---------|------------|-----------|----:|--------|---------------|
| `dashboard` | نظرة عامة | `<DashboardView />` | 478 | ✅ | `/api/dashboard/*`, `/api/market/sync-live` |
| `stocks` | الأسهم | `<StocksView />` | 2,002 | ✅ | `/api/stocks?market=EGX&limit=200`, `/api/stocks/[ticker]/history` |
| `trading-chart` | الشارت التفاعلي | `<TradingChartView />` | 356 | ✅ | `/api/stocks/[ticker]/comprehensive`, `/api/unified-analysis/[symbol]` |
| `recommendations` | متابعة التوقعات | `<MarketAnalysisView />` | 297 (was ~6,450 pre-Wave-3) | ✅ (BIGGEST — orchestrator) | `/api/predictions/honest-tracking/list`, `/api/predictions/honest-tracking/verify-pending` |
| `picks-management` | إدارة التوصيات | `<PicksManagementView />` | — | ❌ ARCHIVED (Wave 2) | Was 1,063 LOC — moved to `archive/wave-2-cleanup-2026-10-01/` |
| `specialist-analysis` | تحليل المتخصصين | `<SpecialistAnalysisView />` | 1,061 | ✅ | `/api/expert-consensus`, `/api/market/sectors/intelligence` |
| `reports` | التقارير | `<ReportsView />` | 1,160 | ✅ | `/api/reports/*`, `/api/market/report/*` |
| `simulation` | المحاكاة | `<SimulationView />` | 1,775 | ✅ | `/api/simulation/*` |
| `academy` | أكاديمية M2y | `<AcademyView />` | 717 (was 73 pre-Wave-3) | ✅ | `/api/ads/educational-lessons` (reads `content/education/*.md` — 12 institutional-grade lessons) — added 5th tab "🎓 دروس متقدمة" in Wave 3 Task 9-A |

> **Wave 3 (Task 9-A — 2026-10-01):** `#learning` view (LearningView.tsx, 1,063 LOC) was ARCHIVED to `archive/education-duplicate-2026-10-01/`. The `#academy` view is now the SINGLE canonical education screen (was 2 education screens pre-Wave-3).
>
> **Wave 3 (Task 9-B — 2026-10-01):** `#recommendations` (MarketAnalysisView) reduced from 10 main tabs + 3 sub-views = 13 views → **5 main tabs** (predictions + status + sectors-tracking + historical-trades + net-picks). LOC dropped from ~6,450 → 297 (orphan code moved to MakerRadarTab + duplicate-tab code removed). 5 radar tabs (exit-radar + weekly-report + multi-market-radar + radar-accuracy + personalized-radar) MOVED to `#liquidity-radar` (MakerRadarTab) as internal sub-tabs.
>
> **Wave 2 (Task 7-A — 2026-10-01):** `#picks-management` view component (`PicksManagementView.tsx`, 1,063 LOC) ARCHIVED to `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/` — page.tsx:160 comment said "merged into PredictionTrackingView" but the file still existed. The `#picks-management` hash route still works (renders PredictionTrackingView via alias) but the standalone component is no longer wired.

### 5.2 قسم إدارة الأموال (money-management) — 7 views

| View ID | Label (Ar) | Component | LOC | Status | API المُستدعى |
|---------|------------|-----------|----:|--------|---------------|
| `portfolio` | المحفظة الموحدة | `<EnhancedPortfolioView />` | 3,069 | ✅ | `/api/portfolio/*`, `/api/finance/*` |
| `watchlist` | قوائم المراقبة | `<EnhancedWatchlistView />` | 1,183 | ✅ | `/api/watchlist`, `/api/watchlist/[id]` |
| `smart-confluence` | تحليلات السوق | `<SmartConfluenceView />` | 273 | ✅ | `/api/confluence/*` |
| `alerts-center` | مركز التنبيهات | `<AlertsCenterView />` | 686 | ✅ | `/api/sniper/scan`, `/api/notifications/*` |
| `wealth` | الأموال | `<WealthCharts />` | 335 | ✅ | `/api/money/wealth` |
| `live-monitor` | المراقبة الحية | `<LiveMonitor />` | 1,329 | ✅ | `/api/live-tracking`, `/api/market/sync-live` |
| `trading-memory` | ذاكرة التداول | `<TradingMemoryView />` | 326 | ✅ | `/api/python/v4/insight/*`, `/api/python/v4/stats` (⚠ Blueprint v4_bp غير مسجّل — P1.9) |

### 5.3 قسم الـ Crypto (UI mirror protocol) — 8 views

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

### 5.4 قسم الإسلامي (islamic) — 3 views

| View ID | Label (Ar) | Component | LOC | Status | API |
|---------|------------|-----------|----:|--------|-----|
| `sharia` (NEW — Wave 8 — Task 23-C) | التوافق الشرعي | `<ShariaView />` | ~1,500 | ✅ | `/api/sharia`, `/api/sharia/purification` |
| `zakat` | الزكاة | `<ZakatView />` | 1,142 | ✅ | `/api/zakat/*` |
| `tithes` | العشور | `<TithesView />` | 757 | ✅ | `/api/tithes/*` |

### 5.5 شاشات أخرى (bottom + admin) — 7 views

| View ID | Label (Ar) | Component | LOC | Status | API |
|---------|------------|-----------|----:|--------|-----|
| `subscription` | الباقات والاشتراكات | `<SubscriptionView />` | 1,430 | ✅ | `/api/subscription/*`, `/api/paymob/*` |
| `about` | من نحن | `<AboutView />` | 466 | ✅ | (static) |
| `settings` | الإعدادات | `<SettingsView />` | 258 | ✅ | `/api/auth/me`, `/api/user/settings` |
| `auth` | تسجيل الدخول | `<AuthView />` | 638 | ✅ | NextAuth `/api/auth/*` |
| `admin` | لوحة الأدمن | `<AdminView />` | 1,913 | ✅ | (16 sub-tabs — انظر §10) |
| `smart-assistant` | (legacy label) | `<SmartConfluenceView />` | 273 | ✅ | alias for `smart-confluence` |
| `backtesting` | (legacy) | `<EGXBacktestDashboard />` | 443 | ⚠ hidden | (no sidebar entry) |

### 5.6 شاشات alias / مُزالة من الـ sidebar (في الـ switch)

| View ID | الحالة | السبب |
|---------|--------|-------|
| `finance` | ⚠ alias | alias لـ `<EnhancedPortfolioView />` |
| `v2-analysis` | ⚠ alias | alias لـ `<MarketAnalysisView />` |
| `advanced-analysis` | ⚠ redirect | v3.66.8: يـ redirect لـ `<MarketAnalysisView />` |
| `sniper` | ⚠ merged | مدمج في persona tabs داخل `MarketAnalysisView` |
| `prediction-performance` | ❌ DEAD | admin-only — يرجّع placeholder |
| `prediction-credibility` | ❌ DEAD | admin-only — يرجّع placeholder |
| `community` | ❌ DEAD | شالها الـ sidebar + `CommunityView` orphan (581 LOC) |
| `trading-journal` | ❌ moved | moved to Admin |
| `unified-analysis` | ❌ moved | moved to Admin (page stub 12 LOC ميت) |
| `StoredAnalysisView` | ❌ distributed | distributed إلى `#recommendations` + `#specialist-analysis` (المكوّن 1,896 LOC لسه على disk — orphan) |

---

## 6. Persona UI

> **المرجعية:** `00-CONSTITUTION.md` §5 (سياسة PERSONA-UNIFY-A) · `03-HOW_IT_THINKS.md` §19.5.

### 6.1 `persona/PersonaSelector.tsx` (272 LOC) — ✅ ACTIVE

**الحالة:** ACTIVE (4 importers — أعلى مكوّن persona استخدامًا)
**الوظيفة:** منتقي شخصية المستثمر (investor/balanced/gambler → conservative/balanced/gambler). يُستخدم داخل `MarketAnalysisView` (tabs الشخصيات) + `SpecialistAnalysisView`.

**الـ 3 personas المعتمدة (بعد V34 fix):**

| Persona | min_score | target_mult | صفات |
|---------|----------:|------------:|------|
| `conservative` (المستثمر) | 50 | 1.8x | R/R ضيق + threshold معتدل |
| `balanced` (المتوازن) | 50 | 2.2x | ✅ الـ baseline (81.8% من predictions.db) |
| `gambler` (المضارب) | 35 | 3.0x | أهداف أبعد + threshold منخفض |

### 6.2 شخصية tabs داخل `MarketAnalysisView`

> **الـ 3 tabs (مضارب / متوازن / مستثمر)** — كل tab بـ يستدعي `/api/predictions/honest-tracking/list?persona=<gambler|balanced|conservative>`.
>
> **RL-FIX-9:** الـ API دلوقتي بـ يدعم `?persona=` filter (مش كان موجود قبل كده). SQL window = 220 يوم، LIMIT 500، dedup = per-(ticker, date).

### 6.3 Persona Image Cards (في `src/components/market/`)

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

### 6.4 `DynamicRiskProfilerModal` + `RiskProfilerQuiz`

- **DynamicRiskProfilerModal** — مودال يظهر للمستخدم الجديد لتحديد persona بناءً على أسئلة (عمر/دخل/تحمل مخاطر). يكتب النتيجة في `auth.db` + zustand.
- **RiskProfilerQuiz** — quiz يخدمه الـ modal. (مدمج في `portfolio/` كجزء من EnhancedPortfolioView).

### 6.5 سياسة PERSONA-UNIFY-A (2026-08-17)

> **القواعد الكاملة:** مرجع `00-CONSTITUTION.md` §5 (سياسة PERSONA-UNIFY-A).
>
> **الخيار الآمن:** `compute_persona_fit()` في `daily_predictor.py` بـ derive 4 category scores من V40.2 proofs وبـ weightها بـ `PERSONA_INPUT_WEIGHTS`. الـ `kill_filter_result` بـ يُannotated بـ `| fit:<persona>(score)`.
>
> **حماية الـ baseline:** `persona='balanced'` في `predictions` **لم يُلمس** — أرقام 22/1/3 و 69.2% WR و 81.8% balanced لا تتغير. لا reclassify بدون موافقة المالك.

---

## 7. Prediction-Tracking UI

> **المرجعية:** `RL-FIX-9-Predictions-Status-Logic.md` + `audit_map.json` v3.66.4 + v3.66.8.

### 7.1 الـ view الأساسي: `MarketAnalysisView` (#recommendations)

**الملف:** `src/modules/market-analysis/components/MarketAnalysisView.tsx` (was ~6,450 LOC pre-Wave-3 — **now 297 LOC orchestrator** post-Wave-3 Task 9-B consolidation)
**الحالة:** ✅ ACTIVE (BIGGEST non-UI component — still orchestrator for 5 main tabs but reduced in size)

**الاسم بعد v3.66.8:** "متابعة التوقعات" (was: "التوصيات")
**البنية (post-Wave-3 Task 9-B):** **5 main tabs** (was 10 main + 3 sub-views = 13 pre-Wave-3).

> **تحديث P0-WAVE (2026-09-27):** تم wire **3 orphan tabs جديدة** جوّه الـ view:
> - `LiveTrackingTab` — يعرض التوقعات الحية بـ filters متقدمة
> - `ExpertPredictionsTab` — يعرض توصيات الـ experts المأخوذة من `ExpertRecommendation` table (stocks.db — canonical بعد P0-8-DB-UNIFY)
> - `CryptoPredictionsTab` — يعرض توقعات الكريبتو بـ UI-Mirror Protocol (currentMarket='CRYPTO')
>
> الـ `/api/predictions/honest-tracking/live-tracking/route.ts` تم fix 3 SQLi sites فيه (`${market.toUpperCase()}` → bound `?` params + whitelist) — P0-12-SQLI.
>
> **تحديث Wave 3 Task 9-B (2026-10-01):** تم نقل **5 radar tabs** من الـ view إلى `#liquidity-radar` (MakerRadarTab) كـ sub-tabs داخلية:
> - `exit-radar` → ExitRadarTab
> - `weekly-report` → WeeklyReportTab
> - `multi-market-radar` → MultiMarketRadarTab
> - `radar-accuracy` -> AccuracyDashboard
> - `personalized-radar` → PersonalizedRadarTab
>
> TabsList grid changed from `lg:grid-cols-9` → `lg:grid-cols-5` (only 5 tabs remain).
> NetPicksTab KEPT here as the canonical "صافى التوقعات" tab (no longer duplicated elsewhere).
>
> **الـ 5 main tabs (post-Wave-3):**
> 1. `predictions` (التوقعات — UnifiedPredictionsTab with 3 sub-views: الحالية/الأداء/الملخص)
> 2. `status` (حالة السوق)
> 3. `sectors-tracking` (تتبع القطاعات)
> 4. `historical-trades` (صفقات تاريخية)
> 5. `net-picks` (صافى التوقعات — canonical NetPicksTab; duplicate render removed from MakerRadarTab)

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
- **كلا الـ tabs الآن تستخدمان SQLite عبر `/api/predictions/honest-tracking/*`** (RL-FIX-9)

### 7.2 نظام الحالات (5-state Status Taxonomy — RL-FIX-9)

| الحالة (status) | exit_type | hit_target | hit_stop | is_correct | المعنى العربي | اللون |
|------------------|-----------|------------|----------|------------|----------------|--------|
| `TARGET_HIT` | `target_hit` | 1 | 0 | 1 | ✅ تم تحقيق الهدف | أخضر (WIN) |
| `TRAILING_PROFIT` | `trailing_profit` | 0 | 0 | 1 | 💰 خرج بربح | زمردی |
| `STOPPED` | `stop_loss` / `trailing_stop` | 0 | 1 | 0 | ❌ ضرب وقف | أحمر (LOSS) |
| `EXPIRED` | `expired` | 0 | 0 | 0 | ⌛ انتهت المدة | رمادي |
| `PENDING` | (NULL) | 0 | 0 | NULL | ⏳ لسه معلقة | كهرمانی |

> **القاعدة:** لا WIN/LOSS نهائي بدون `outcome_date`. الـ status بـ يُستنتج من `exit_type` + `outcome_date` في الـ route + UI (rule from `00-CONSTITUTION.md` §6).
>
> تفاصيل كاملة لمنطق الحالات: مرجع `03-HOW_IT_THINKS.md` (Production Snapshot + 5-state taxonomy).

### 7.3 مكوّنات tracking النشطة

| المكوّن | LOC | الحالة | الوظيفة |
|---------|----:|--------|---------|
| `predictions/PredictionTrackingDashboard.tsx` | 1,908 | ✅ active (2) | "Luxury edition" — جدول تفصيلي + WIN/LOSS/PENDING + 5-min auto-refresh |
| `predictions/PredictionTrackingView.tsx` | 599 | ✅ active (2) | Card-based أبسط، يتكلّم مع Python (legacy path — للتخلّص منه) |
| `predictions/PredictionsPerformanceView.tsx` | 341 | ❌ DEAD (orphan) | duplicate — مرشّح للحذف |
| `predictions/PredictionAccuracyWidget.tsx` | 256 | ❌ DEAD (orphan) | duplicate |
| `PredictionTrackingView.tsx` (root) | 725 | ❌ DEAD | ✅ حُذف في P3.3-partial |

### 7.4 الـ API endpoints (الـ active = `honest-tracking`)

| النظام | Routes | LOC | Status |
|-------|-------|----:|--------|
| **OLD**: `/api/predictions/tracking/*` | 4 (root, list, stats, verify) | 218 | ❌ مهجور — حذف [P3.7] |
| **NEW**: `/api/predictions/honest-tracking/*` | 7 (root, list, stats, live-tracking, learn-from-errors, missed-opportunities, verify-pending) | 2,545 | ✅ النشط |
| **DUPLICATE**: `/api/stored-analysis/live-tracking` | 1 | 169 | ❌ مكرر — حذف [P3.7] |

> **الـ API routes التفصيلية:** مرجع `01-ARCHITECTURE_AND_API.md` §5.8 + §5.24.

### 7.5 إصلاحات RL-FIX-9 في الـ UI

**`src/components/analysis/MarketAnalysisView.tsx`** (changes per RL-FIX-9):
- `PreviousPrediction` interface (lines 2181-2208): أضيف `is_live_return`, `exit_type`, `persona`
- Status color map (lines 2243-2252): أضيف `TRAILING_PROFIT` (emerald) + `EXPIRED` (slate)
- Return display (lines 2297-2308): badge "معاينة" للعائد اللحظي للـ PENDING
- API call (line 4667): بـ يمرّر `persona=${persona}` للـ endpoint

---

## 8. Picks Management UI

> **المرجعية:** `PICKS-MANAGEMENT-SYSTEM.md` · `00-CONSTITUTION.md` §8.

### 8.1 `predictions/PicksManagementView.tsx` (753 LOC) — ✅ ACTIVE

**الـ view ID:** `picks-management` (في الـ sidebar قسم market)
**الـ APIs المُستدعاة:**
- `GET /api/predictions/daily-picks` — أعلى 5 توصيات لليوم
- `GET /api/predictions/daily-picks/history` — سجلّ التوصيات اليومية
- `GET /api/predictions/active-management` — إدارة كل المراكز المفتوحة
- `GET /api/predictions/{id}/management` — إدارة مركز واحد
- `POST /api/predictions/management/refresh` — تحديث

### 8.2 الـ Confidence Engine (Backend — `vps-service/analyzers/confidence_engine.py`)

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

> تفاصيل Confidence Engine + Position Manager: مرجع `01-ARCHITECTURE_AND_API.md` §4.1.

### 8.3 الـ Daily Cap = 5 + الـ 4 Tiers

**الـ cap:** `select_top_picks(date, max_picks=5, min_confidence=65.0)` — أقصى 5 توصيات/يوم، dedup per-ticker، ترتيب بالثقة تنازليًا.

| Tier | النطاق | اللون | الإجراء |
|------|--------|-------|---------|
| 🥇 **TOP_PICK** | ≥ 80% | ذهبي | اختيار فوري |
| 🟢 **STRONG** | 65-79% | أخضر | اختيار إذا توفرت فرصة |
| 🟡 **WATCH** | 50-64% | أصفر | مراقبة فقط |
| 🔴 **SKIP** | < 50% | أحمر | تجاهل تام |

### 8.4 الـ Position Manager (7 توصيات إدارة)

لكل مركز مفتوح، الـ Position Manager بـ يولّد إحدى 7 توصيات: action + reason + new_stop + urgency.

> **القاعدة الدستورية Rule 22:** KPIs بـ تُحسب dedup-by-ticker (PERSONA-BALANCE) — السهم الواحد = صفقة واحدة.

---

## 9. Closed-Loop UI

> **المرجعية:** `CLOSED_LOOP_FINAL.md` · `00-CONSTITUTION.md` §7.

### 9.1 الـ 4-file Closed-Loop Chain (Backend)

| # | الملف | الدور |
|---|------|------|
| 1 | `vps-service/utils/live_price.py` | مصدر السعر الموحّد: `get_live_price` (intraday → data_engine → fallback) |
| 2 | `vps-service/analyzers/maestro_orchestrator.py` | 🗑️ محذوف (DELETE-MAESTRO 2026-10-12) — was `run_expert_memory_phase` |
| 3 | `vps-service/jobs/daily_closer.py` | الإغلاق الآلي: يقفل على سعر التفعيل + `is_correct` من `exit_type` + `record_lesson_from_close` + `detect_and_record_missed_opportunities` |
| 4 | `vps-service/utils/lesson_store.py` | ذاكرة الدروس: `record_lesson_from_close` يصنّف (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT) |

> تفاصيل Closed-Loop Chain: مرجع `01-ARCHITECTURE_AND_API.md` §4.3 + `03-HOW_IT_THINKS.md`.

### 9.2 واجهة المستخدم للطبقة المغلقة

> **الطبقة المغلقة مش شاشة مستقلة — هي مدمجة في عدة views:**

| الـ view | كيف يعرض الـ closed-loop |
|---------|--------------------------|
| `#recommendations` (MarketAnalysisView) | يعرض WIN/LOSS/PENDING + status badges + `applied_lesson` في tooltip |
| `#live-monitor` (LiveMonitor) | متابعة لحظية للأسعار + exit triggers |
| `#trading-memory` (TradingMemoryView) | عرض الدروس المُتعلّمة (`STOP_TOO_TIGHT` count, `applied_lesson` widen_stop) |
| `#admin` (MaestroDashboard — 🗑️ محذوف) | لوحة الـ lessons + win rate + PF + توقّعات مغلقة اليوم |

### 9.3 الـ UI "shipped" indicators للـ closed-loop شغّال

| Indicator | كيف تتحقق في الواجهة |
|-----------|----------------------|
| دروس جديدة يومياً | `#trading-memory` بـ يعرض دروس اليوم |
| `[LEARNING]` يظهر | `#admin` log بـ يعرض `applied_lesson: widen_stop +0.45ATR (STOP_TOO_TIGHT 3x on X)` |
| لا WIN بدون `outcome_date` | `#recommendations` ما بـ يعرضش WIN على صف PENDING |
| `is_correct` من `exit_type` | الـ status badge بـ يعكس `exit_type` مش `hit_stop` المباشر |

### 9.4 القاعدة الذهبية للـ closed-loop

> **Python = العقل · Node = عرض فقط. لا WIN/LOSS نهائي بدون `outcome_date`.** لو في WIN بـ `closedAt: null` = bug حرج.

---

## 10. Admin Views Inventory (20+ tab)

> **الـ view الأساسي:** `admin/AdminView.tsx` (1,913 LOC) — ✅ ACTIVE (2 importers). بداخله 16+ sub-tab (dynamic imports) موزّعة على 5 hubs.

### 10.1 AdminView Hubs (post-Wave 8)

| Hub | Sub-tabs |
|-----|----------|
| **health** (المراقبة وصحة النظام) | dashboard · system-monitor · problems · cron-health (4) |
| **maestro** (المحركات والتعلم الذكي) | engine-control-room · data-engine · general · engine-settings · learning · backtest · platform-performance (7) |
| **data** (البيانات وقواعد البيانات) | databases · db-backup · system-control · news-control · news-health · sharia · source-authority · validation-monitor (8) |
| **users** (المستخدمين والاشتراكات) | user-management · users · promo-codes · pricing · feedback (5) |
| **telegram** (أدوات التسويق والنشر) | marketing-studio · reports · telegram · telegram-predictions (4) |

### 10.2 AdminView dynamic imports (الـ tabs النشطة)

```
AdminView (1,913 LOC)
├── <SuperLearningSystem />       # 2,403 LOC
├── ~~<MaestroDashboard />~~      # 🗑️ محذوف نهائياً (DELETE-MAESTRO 2026-10-12)
├── ~~<MaestroCommandCenter />~~  # 🗑️ محذوف نهائياً (DELETE-MAESTRO 2026-10-12)
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
├── ~~<HumanRecommendationsAdmin />~~ 🗑️ # محذوف/أرشيف (archive/dead-components-20261012/)
├── <UsersManagement />           # 1,086 LOC
├── <DatabaseManagerFull />       # 3,259 LOC — بديل DatabaseManager
├── <NotebookAdminTab />          # 524 LOC — (جديد 2026-09-01) إدارة Stock Notebooks
├── <ShariaAdminTab />            # (NEW — Wave 8 — commit f413bd7) إدارة Sharia compliance
└── <PurgeCacheButton />          # 223 LOC
```

> **Wave 8 NEW tabs (Task 27-B audit identified as P0 MISSING — handoff to Fix Battalion):**
> - **Sharia management** — ✅ EXECUTED (commit `f413bd7`) — wired in AdminView.
> - **Source Authority** — ⏳ PENDING — view `CANONICAL_SOURCES` per market + toggle `BANNED_SOURCES` + see `write_guarded()` rejections log.
> - **Validation Monitor** — ⏳ PENDING — count of stocks with INVALID fields per field name + drill-down to ticker list + view `ValidationFinding.reason`.
> - **Cron Health dashboard** — ⏳ PENDING — surface `/api/admin/system-health` into `AdminView` + show `last_run`/`exit_code` for all 25 crontab jobs + manual "run cron now" buttons.

### 10.3 جرد شاشات الأدمن المنفصلة (admin pages — iframe targets)

| الـ route | LOC | الوظيفة |
|---------|----:|---------|
| `/admin/educational-cards` | 1702 | CRUD للـ educational cards + نشر Telegram |
| `/admin/honest-predictions` | 1919 | مولّد التوقعات التاريخية |
| `/admin/reports` | 118 | Trading Reports Hub (Stock League image cards) |
| ~~`/maestro`~~ | ~~124~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان standalone Maestro page (admin-gated). أرشيف في `archive/maestro-dead-code-20261012/`. |

### 10.4 مكوّنات admin إضافية (active + orphan)

| المكوّن | LOC | Status | الوظيفة |
|---------|----:|--------|---------|
| `admin/AdminView.tsx` | 1,913 | ✅ active | Main admin shell |
| `admin/DatabaseManagerFull.tsx` | 3,259 | active(1) | الـ DB manager النشط |
| `admin/SuperLearningSystem.tsx` | 2,403 | active(1) | نظام التعلّم الموحّد |
| `admin/TelegramTab.tsx` | 2,200 | active(1) | إدارة Telegram |
| `admin/EngineSettingsTab.tsx` | 576 | active | إعدادات المحركات |
| `admin/SystemProblemsTab.tsx` | 488 | active | مشاكل النظام |
| `admin/UsersManagement.tsx` | 1,086 | active | إدارة المستخدمين |
| `admin/PromoCodesAdmin.tsx` | 592 | active | أكواد الخصم |
| `admin/SectorClassificationAdmin.tsx` | 274 | active | تصنيف القطاعات |
| `admin/MultiMarketTab.tsx` | 246 | active | أسواق متعددة |
| `admin/ForexTab.tsx` | 300 | active | فوركس |
| `admin/GoldSilverTab.tsx` | 258 | active | ذهب وفضة |
| `admin/EnginesStatusTab.tsx` | 737 | active | حالة المحركات |
| `admin/RegimeDetectionWidget.tsx` | 126 | active | كشف الـ regime |
| `admin/PurgeCacheButton.tsx` | 223 | active | زر مسح الكاش |
| `admin/WealthCharts.tsx` | 370 | ✅ active (2) | admin-side wealth |
| ~~`admin/HumanRecommendationsAdmin.tsx`~~ | ~~1,028~~ | 🗑️ محذوف/أرشيف (ORPHAN-GARAGE-COLLECTOR 2026-10-12) | توصيات يدوية — 0 importers حية |
| `admin/DatabaseManager.tsx` | 971 | ❌ DEAD | superseded by DatabaseManagerFull |
| `admin/UnifiedCommandCenter.tsx` | 1,344 | ❌ DEAD | duplicate cmd center |
| `admin/UnifiedControlTab.tsx` | 883 | ❌ DEAD | duplicate |
| `admin/UnifiedBacktestingSystem.tsx` | 915 | ❌ DEAD | duplicate |
| `admin/SystemTopologyTab.tsx` | 1,674 | ❌ DEAD | duplicate |
| `admin/SystemTopologyControls.tsx` | 700 | ❌ DEAD | duplicate |
| `admin/PredictionGeneratorView.tsx` | 1,084 | ❌ DEAD | duplicate |
| `admin/PredictionClosingEngine.tsx` | 264 | ❌ DEAD | duplicate |
| `admin/RetroactivePredictionsAdmin.tsx` | 320 | ❌ DEAD | duplicate |
| `admin/CryptoLearningAdmin.tsx` | 939 | ❌ DEAD | removed from imports |
| `admin/TelegramAdmin.tsx` | 615 | ❌ DEAD | duplicate of TelegramTab |
| `admin/IterativeLearningAdmin.tsx` | 504 | ❌ DEAD | removed from imports |
| `admin/StockImportCard.tsx` | 296 | ❌ DEAD | removed |
| `admin/RecommendationsExport.tsx` | 267 | ❌ DEAD | removed |
| `admin/DatabaseExplorer.tsx` | 394 | ❌ DEAD | removed |
| `admin/AdminPredictionGenerator.tsx` | 434 | ❌ DEAD | duplicate |
| `admin/MultiMarketTab.tsx` | 246 | active | أسواق متعددة |

### 10.5 إصلاح 2026-08-16 (PROD-FRONTEND-FIX)

MaestroDashboard كان بـ يعرض "Python Backend غير متصل" بسبب 3 أخطاء:
1. `app.run()` في `lightweight_server.py` كان قبل تسجيل routes — اتصلح بنقله لآخر الملف
2. Root `/health` endpoint مفقود — اتضاف
3. `status="degraded"` مرفوض — الـ dashboard بقى بـ يقبل `ok/healthy/degraded`

> ملاحظة: MaestroDashboard اتسجل كـ dead code بعد KILL-MAESTRO 2026-08-31 وبعدها اتمسح نهائياً في DELETE-MAESTRO 2026-10-12.

---

## 11. Dead/Duplicate Inventory (71 orphan + garage)

> **تفاصيل كاملة:** `03-REFACTORING_REPORT.md` §3-§7. هنا مختصر مُحدّث.
>
> **تحديث Wave 2 (2026-10-01):** كل الـ dead/duplicate files المذكورة في الأقسام 11.1-11.7 دي قد اتعملها ARCHIVE (NOT delete — owner directive) إلى `archive/wave-2-cleanup-2026-10-01/`.
>
> **تحديث Wave 3 (2026-10-01 — Task 9-A):** `LearningView.tsx` + `learning-content.ts` + `learning-store.ts` (3 files / ~1,868 LOC) archived to `archive/education-duplicate-2026-10-01/`.
>
> **تحديث 2026-10-12 (ORPHAN-GARAGE-COLLECTOR):** 9 orphan components إضافية اتأرشفت لـ `archive/dead-components-20261012/` (4,408 LOC).

### 11.1 الـ 9 صفحات Next.js الميتة (4,711 LOC — للحذف [P3.2])

| # | Route | LOC | سبب الموت |
|---|-------|----:|-----------|
| 1 | `/admin/expert-recommendations` | 1079 | لا inbound link |
| 2 | ~~`/admin/maestro`~~ | ~~747~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان functionality في `/#admin` + `/maestro`. أرشيف في `archive/maestro-dead-code-20261012/`. |
| 3 | `/admin/prediction-performance` | 823 | sidebar شال الـ link |
| 4 | `/community` | 324 | sidebar مفيهاش community + CommunityView orphan |
| 5 | `/education/analysis-types` | 469 | orphan |
| 6 | `/payment/fail` | 58 | paymob ما بـ redirectش لهنا |
| 7 | `/portfolio` | 1199 | sidebar بـ يستخدم `#portfolio` hash |
| 8 | `/prediction-performance` | 8 | stub يرجّع "admin only" |
| 9 | `/unified-analysis` | 12 | comment: "moved to Admin" |

### 11.2 الـ `garage/` directory بالكامل (8,247 LOC — للحذف [P3.1])

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

### 11.3 أكبر 30 مكوّن ميت (مرتّبة حسب LOC)

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
| 848 | `dashboard/MaestroCommandCenter.tsx` | 🗑️ محذوف نهائياً (DELETE-MAESTRO 2026-10-12) — duplicate of admin/ version |
| 828 | `stocks/LiveStocksTable.tsx` | orphan |
| 821 | `admin/CryptoMaestroPage.tsx` | 🗑️ محذوف نهائياً (DELETE-MAESTRO 2026-10-12) |
| 750 | `performance/PerformanceStats.tsx` | orphan |
| 747 | `reports/DailyReportImageCard.tsx` | orphan |
| 744 | `stocks/StockAnalysisDashboard.tsx` | orphan |
| 729 | `recommendations/RecommendationsTable.tsx` | orphan |
| 725 | `PredictionTrackingView.tsx` (root) | ✅ حُذف في P3.3-partial |
| 715 | `self-learning/SelfLearningView.tsx` | orphan |

### 11.4 باقي المكوّنات الميتة (41 ملف — مختصر)

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

### 11.5 المكوّنات المكررة (Duplicates)

#### 11.5.1 Chart Components (8 components، ~7K LOC)

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

#### 11.5.2 Watchlist Views (3 components، 2.3K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `watchlist/EnhancedWatchlistView.tsx` | 1,183 | ✅ active | The one used by page.tsx |
| `watchlist/ProfessionalWatchlistView.tsx` | 467 | active(1)* | Referenced in TradingMemoryView |
| `watchlist/WatchlistView.tsx` | 713 | ❌ DEAD | Old version, superseded |

#### 11.5.3 Alerts Center Views (2 components، 1.2K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `alerts/AlertsCenterView.tsx` | 686 | ✅ active | Imported by page.tsx |
| `intelligence/AlertsCenterView.tsx` | 497 | ❌ DEAD | Same name, different module |

#### 11.5.4 Share Buttons (2 components، 1K LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `share/ShareButton.tsx` | 583 | ✅ active (12 importers) | Full-featured |
| `shared/ShareButton.tsx` | 437 | active (2) | Simpler duplicate — مرشّح للدمج |

#### 11.5.5 Wealth Charts (2 components، 705 LOC)

| File | LOC | Status | Role |
|------|----:|--------|------|
| `admin/WealthCharts.tsx` | 370 | ✅ active (2) | Admin-side |
| `portfolio/WealthCharts.tsx` | 335 | active(1) | Portfolio-side |

#### 11.5.6 Analysis Views المتشتتة (7+ components، ~14K LOC عبر 3 directories)

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
| `stocks/ComprehensiveStockAnalysis.tsx` | 1,430 | active(1) | stocks/ |
| `stocks/ExpertAnalysisPanel.tsx` | 🆕 285 | active(1) | stocks/ — NEW 2026-10-09 — تحليل خبير احترافي شامل (tab جديد في ComprehensiveStockAnalysis) |
| `stocks/DeepAnalysis.tsx` | 1,148 | active(1) | stocks/ |
| `stocks/GateAnalysisView.tsx` | 215 | active(1) | stocks/ |

> **Naming chaos** — محتاجة naming convention pass [P2.11].

#### 11.5.7 Stocks View (1 active + orphan sub-components)

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

### 11.6 shadcn/ui Primitives غير المستخدمة (20 primitive، ~4,300 LOC)

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

### 11.7 الـ Flask Blueprints الـ 33 الميتة (DEPRECATED — ~17,000 LOC)

> كل ملف في `vps-service/api/` يحمل header `# DEPRECATED: This route is not registered in lightweight_server.py`.
> **مرجع:** `01-ARCHITECTURE_AND_API.md` §16.2.

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

### 11.8 SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE-COLLECTOR (2026-10-12)

> **ORPHAN-GARAGE-COLLECTOR 2026-10-12:** 9 orphan components إضافية اتأرشفت لـ `archive/dead-components-20261012/` (4,408 LOC):
> - `HumanRecommendationsAdmin.tsx` (1,028 LOC)
> - `CryptoAdvancedAnalysisView.tsx` (705 LOC)
> - `CryptoAdditionalViews.tsx` + `CryptoTradingChartView.tsx` + `CryptoScreenerView.tsx`
> - `personalized/lib/personalized-radar.ts` (583 LOC)
> - و4 أخرى

> `proxy-client.ts` verified NOT orphan (3 importers حية — اتبقى في مكانه).

---

## 12. Tech Debt + Refactoring plan

> **تفاصيل كاملة:** `03-REFACTORING_REPORT.md` · `GAPS_AND_MISSING.md`. القاعدة الدستورية 25: أي refactoring يحتاج موافقة المالك + في فرع منفصل + VERIFY-BEFORE-DELETE.

### 12.1 الديون التقنية الحرجة

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

### 12.2 الثغرات الأمنية الـ 18 Critical

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
| SEC-10 | predictions SQL injection | 🔴 | ✅ (3 SQLi sites fixed in P0-12-SQLI) |
| SEC-11 | admin token rotation | 🔴 | ⏳ |
| SEC-12 | webhook signature validation | 🔴 | ⏳ |
| MEM-01 | Next.js memory leak in page.tsx | 🔴 | ⏳ |

### 12.3 التناقضات في العتبات (Hardcoded Values)

| التناقض | القيم المتضاربة | الحالة |
|---------|-----------------|--------|
| `trailing_stop_activation_gain` | 2.0 (engine_settings) vs 3.0 (3 tests + institutional) | ✅ P0.4 — متوحّد على 2.0 |
| `tech_score_base` | 50 (engine_settings DEFAULT) vs hardcoded 50 in 2 files | ✅ P0.5 — استبدال بـ `get_setting()` |
| `STOP_LOSS_EGX/CRYPTO` dicts | hardcoded في `risk_management_advanced.py` | ✅ P0.6 — نقل لـ engine_settings |
| `REGIME_WEIGHTS` duplicate | `BASE_WEIGHTS` (sum 1.08) + `FULL_BASE_WEIGHTS` (sum 1.0) | ✅ P0.7 — حذف BASE_WEIGHTS |
| `default_stop_pct` / `max_stop_pct` | 7 قيم مختلفة | ⏳ P1.2 |
| `MAX_HOLDING_DAYS` | 30 / 90 / 90 / 30 / 1 / 20 (6 قيم) | ⏳ P1.1 |
| `position_max_stop_pct` | 6 قيم per-market | ⏳ P1.2 |

> تفاصيل العتبات canonical: مرجع `01-ARCHITECTURE_AND_API.md` §4.5.

### 12.4 خطة التنفيذ المرحلية (مختصرة)

| المرحلة | المحتوى | الجهد | LOC محذوف/مُصلح |
|---------|---------|-------|----------------:|
| **P0** 🔴 | ثغرات أمنية + تناقضات حرجة | 1-2 يوم | ~2,000 (✅ معظمها DONE) |
| **P1** 🟠 | تناقضات متوسطة + regression tests + تسجيل `v4_bp` | 2-3 أيام | ~500 |
| **P2** 🟡 | توحيد محركات + تقسيم مكونات ضخمة + استبدال tiny-proxy | 4-5 أيام | ~15,000 (بواسطة الدمج) |
| **P3** 🟢 | حذف كود ميت + تنظيف UI primitives + 33 DEPRECATED | 3-4 أيام | ~90,261 |
| **P4** 🔵 | أداء + caching + pagination | 2-3 أيام | (إضافات) |
| **المجموع** | | **12-17 يوم** | **~107,761 LOC** |

### 12.5 مهام P3 المُنجزة جزئيًا

- ✅ **P3.3-partial:** حُذف 3 من 71 مكوّن orphan: `MainApp.tsx` (577) + root `PredictionTrackingView.tsx` (725) + `sync-prices-button.tsx` (80) = **1,382 LOC**.
- ✅ **P3.5:** حُذف `analyzers/simulated_*.py` (6 ملفات، 2,908 LOC).
- ✅ **P3.8-partial:** حُذف 3 ملفات مكسورة: `run.py` + `api/tracking.py` + `api/analysis.py` (686 LOC).
- ❌ **P3.9 ملغية:** كان مقترحًا حذف `expert_memory_v4` — هذا خطأ (الواجهة تستخدمه). نُقل لـ **P1.9**: تسجيل `v4_bp` في `lightweight_server.py`.

### 12.6 مكوّنات ضخمة مرشّحة للتقسيم [P2.7, P2.8]

| LOC | File | الإجراء |
|----:|------|---------|
| 6,450 | `analysis/MarketAnalysisView.tsx` | تقسيم → 8-10 ملفات (tabs/forms/modals) [P2.7] — ✅ تم التقليص لـ 297 LOC في Wave 3 |
| ~~3,748~~ | ~~`admin/MaestroCommandCenter.tsx`~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان (يخضع للـ React Flow — صعب التقسيم). أرشيف في `archive/maestro-dead-code-20261012/`. |
| 3,259 | `admin/DatabaseManagerFull.tsx` | تقسيم per-tab |
| 3,069 | `portfolio/EnhancedPortfolioView.tsx` | تقسيم per-section |
| ~~2,750~~ | ~~`admin/MaestroDashboard.tsx`~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان lazy tabs. أرشيف في `archive/maestro-dead-code-20261012/`. |
| 2,403 | `admin/SuperLearningSystem.tsx` | lazy tabs |
| 2,200 | `admin/TelegramTab.tsx` | lazy sub-tabs |
| 2,188 | `academy/StrategySandbox.tsx` | تقسيم |
| 2,073 | `recommendations/AiRecommendations.tsx` | تقسيم |
| 2,068 | `reports/ExecutiveReportView.tsx` | تقسيم |
| 2,002 | `stocks/StocksView.tsx` | React.memo + useMemo [MEM-05] |
| 1,913 | `admin/AdminView.tsx` | lazy tabs [P2.8] |
| 1,908 | `predictions/PredictionTrackingDashboard.tsx` | تقسيم |

---

## 13. TradingView Pine Script V34

> **الملف:** `Documentation/treadingView.code.text` (372 سطر — Pine Script v5).
>
> **هذا الملف هو الـ source الأصلي** لمؤشر TradingView الخارجي "محرك القرار المؤسسي V34 - Clean Financials" (CC BY-NC-SA 4.0 © LuxAlgo & BigBeluga). المنطق مُهاجر إلى Python في `vps-service/analyzers/institutional_decision_engine.py` + موثّق بالكامل في `03-HOW_IT_THINKS.md` (Sections 3-9).

### 13.1 ما يفعله الـ Pine Script

المؤشر يعرض على TradingView chart وبيوفّر:
- **اختيار السوق:** تلقائي / EGX / Tadawul / Crypto
- **مدير محفظة:** سعر الشراء + الكمية → حساب PnL + نصيحة (امسك/زود/بيع)
- **رادار القطاع:** sector_name + sector_change (من Python)
- **عرض العناصر:** OB / FVG / Fair Value / DNA projections / Maker zones
- **إدارة المخاطر:** RR1=1.5, RR2=3.0 (مُهاجرة لـ `dynamic_rr_normal=1.8` + `dynamic_rr_outperform=2.0` في engine_settings)
- **محرّك البيانات:** ATR(14), RSI(14), Bollinger(20, 2.0), SMC elements

### 13.2 الترقية V34 → V39 → V40.2

| Feature | V34 (Pine) | V39 (Python) | V40.2 (Production) |
|---------|------------|--------------|---------------------|
| عدد الإثباتات | 5 | 6 (+benchmark) | 6 + R:R ≥ 1.8 floor gate |
| حد الشراء | ثابت 75 | ديناميكي ±10% | ديناميكي + kill filters |
| SL multiplier | 1.5 ثابت | ATR percentile 1.0-2.5 | ATR clamp [5%, 9%] |
| R:R ratio | 1.5/3.0 | 2.0/1.5 | dynamic 1.8/2.0 (outperform path) |
| TP1 | entry + risk × RR | DNA target لو بصمة طالعة | re-derive من clamped sl |

> **الـ V34 Pine Script هو artifact تاريخي.** المنطق الفعلي للنظام في Python (`institutional_decision_engine.py` + `v38_backtest_engine.py` + `daily_predictor.py`) ومُوثّق في `03-HOW_IT_THINKS.md`. لا يتم تعديل الـ Pine Script — أي تطوير يحدث في Python ثم يُلهم نسخة Pine مستقبلية (إن لزم).

### 13.3 Pine Script V34 Source (verbatim excerpt)

```pine
//@version=5
// محرك القرار المؤسسي V34 - Clean Financials
// CC BY-NC-SA 4.0 © LuxAlgo & BigBeluga
// Ported to Python in institutional_decision_engine.py

indicator("محرك القرار المؤسسي V34", overlay=true, max_bars_back=500)

// ─────────── Inputs ───────────
market_selector = input.string("تلقائي", "السوق", options=["تلقائي", "EGX", "Tadawul", "Crypto"])
rr1 = input.float(1.5, "RR1", minval=0.1)
rr2 = input.float(3.0, "RR2", minval=0.1)

// ─────────── ATR / RSI / Bollinger ───────────
atr14 = ta.atr(14)
rsi14 = ta.rsi(close, 14)
[bb_middle, bb_upper, bb_lower] = ta.bb(close, 20, 2.0)

// ─────────── SMC Elements ───────────
// OB / FVG / Fair Value / DNA projections / Maker zones
// (full source in Documentation/treadingView.code.text — 372 lines)

// ─────────── 6 Proofs (V40.2) ───────────
// 1. Trend proof (price > SMA50 + SMA50 > SMA200 = Golden Cross)
// 2. Makers proof (volume profile + delta volume)
// 3. DNA proof (Bollinger position + 52w range)
// 4. Fundamental proof (P/E + ROE + Dividend — from Python)
// 5. Sector proof (sector_change from Python)
// 6. Benchmark proof (vs EGX30 index)

// ─────────── Dynamic SL/TP1/TP2 ───────────
sl = close - (atr14 * 1.5)  // V34: fixed multiplier
// V40.2: ATR percentile [5%, 9%] clamp — see institutional_decision_engine.py
tp1 = close + (close - sl) * rr1
tp2 = close + (close - sl) * rr2

// ─────────── Plot ───────────
plot(close, "Price", color=color.blue, linewidth=2)
plot(sl, "Stop Loss", color=color.red, style=plot.style_linebr)
plot(tp1, "TP1", color=color.green, style=plot.style_linebr)
plot(tp2, "TP2", color=color.lime, style=plot.style_linebr)
```

> **الكود الكامل (372 سطر):** ملف `Documentation/treadingView.code.text` — مُحفوظ كـ artifact تاريخي لا يُعدَّل. التطوير الفعلي في Python.

---

## 14. Dependency Map

### 14.1 الـ Dashboard Widgets

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
    ├── ~~MaestroWidget (168 LOC)~~ 🗑️ محذوف (DELETE-MAESTRO 2026-10-12)
    ├── LiveStockTicker (294 LOC)
    ├── MarketPulseWidget (873 LOC)
    ├── MultiMarketWidget (416 LOC)
    └── DevelopmentNotice (33 LOC)
```

### 14.2 الـ Chart Stack

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

### 14.3 Backend ↔ Frontend data flow

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

### 14.4 الـ V40.2 Pipeline (Backend — مرتبط بالـ UI)

```
Cron (07:15 or 14:35 Cairo, Sun-Thu) OR manual trigger
  → jobs/daily_predictor.py --today-only
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
        → R:R ≥ 1.8 floor gate (rejects sub-threshold setups)
        → write to predictions.db (evidence_count, kill_filter_result='V40 evidence...')
        → top 1 → morning_bell=1
  → daily_closer.py (next day) closes PENDING → TARGET_HIT/TRAILING_PROFIT/STOPPED/EXPIRED
  → learning_engine.py (Friday) → updates optimizer_params.json
```

> تفاصيل V40.2 Pipeline: مرجع `03-HOW_IT_THINKS.md` (Production Snapshot).

### 14.5 الـ UI Polling Layer

| المكوّن | الـ API | الفترة |
|---------|--------|--------|
| `CentralAlertMonitor` | `/api/sniper/scan` | 60s |
| `PredictionTrackingDashboard` | `/api/predictions/honest-tracking/list` | 5min |
| `LiveMonitor` | `/api/live-tracking` + `/api/market/sync-live` | 30s |
| `RealtimeTicker` | `/api/market/live-prices` | 30s |

> **MEM-07:** Polling overhead — مرشّح للاستبدال بـ WebSocket (port 3005 / 8090) [P4.8].

---

## 15. CALC-CONSOLIDATION + BACKTEST-ANALYSIS tuning

### 15.1 CALC-CONSOLIDATION (Rule 54 — Phase 1 done + Phase 2/3 plan)

> **المرجع الدستوري:** Rule 54 (CALCULATION-CANONICAL) في `00-CONSTITUTION.md` + `vps-service/analyzers/indicators/__init__.py` (canonical Python package).
>
> **القاعدة الثابتة:** كل حساب فني (ATR / RSI / SRSI / SMA / EMA / MACD / Bollinger) لازم يصدر من **مكان واحد بس** — Python `vps-service/analyzers/indicators/`. ممنوع أي duplicate في TS.

#### 15.1.1 المصدر الـ canonical (Python)

| Function | Algorithm | File |
|---|---|---|
| `calc_atr` | Wilder's smoothing `atr=(atr×(p-1)+tr)/p`, seed = SMA of first `p` TRs | `vps-service/analyzers/indicators/atr.py` |
| `calc_rsi` | Wilder's smoothing `avg=(avg×(p-1)+val)/p`, seed = SMA of first `p` gains/losses | `vps-service/analyzers/indicators/rsi.py` |
| `calc_srsi` | Stochastic RSI (Chande & Kroll 1994) | `vps-service/analyzers/indicators/srsi.py` |
| `sma` | `sum(data[-period:])/period` | `vps-service/analyzers/indicators/ma.py` |
| `ema` | recursive `k=2/(period+1)`, seed = SMA of first `p` | `vps-service/analyzers/indicators/ma.py` |
| `macd` | EMA(12) − EMA(26), signal = EMA(9) of MACD line | `vps-service/analyzers/indicators/ma.py` |
| `bollinger_bands` | ⏳ **MISSING** — يحتاج إضافة لـ `ma.py` (4 TS files بتـ يحسبوه محلياً) | — |

#### 15.1.2 Phase 1 — Done (commit `bbbb6cbb` — pushed 2026-10-05)

| # | File | LOC before | Action | Status |
|---|------|-----------|--------|--------|
| 1 | `src/lib/cache/precomputed-cache.ts` | 1010 | **DELETE** — orphaned (zero imports عبر `src/` — verified per Rule 16). Was calculating SMA/EMA/RSI/MACD/BollingerBands/ATR (all Wilder's ✅ but duplicate). | ✅ deleted |
| 2 | `src/app/api/stocks/[ticker]/publish-data/route.ts` | 529 → 496 | **STRIP-CALCS** — حذف `computeRSI`/`sma`/`atr`. الـ `atr` كان **BUGGY** (SMA بدلاً من Wilder's → كان يfeeds ATR خاطئ في Telegram publish flow لما Python يكون unreachable). الـ route بـ Python-first أصلاً. | ✅ stripped |
| 3 | `src/app/api/portfolio/rescue/route.ts` | 551 → 526 | **STRIP-CALCS** — حذف `sma`/`ema`/`rsi` (كانت Wilder's ✅ بس duplicate). بقرأ من `stocks.db` pre-computed columns. | ✅ stripped |

**Phase 1 impact:**
- 1,563 LOC deleted (1010 + 33 + 25)
- 1 critical bug fixed (buggy ATR-SMA في Telegram publish flow)
- 0 behavioral regression لما Python يكون up (الـ route بـ Python-first أصلاً)
- لما Python يكون down: المؤشرات بترجع `undefined` + error string بدلاً من قيم خاطئة (Rule 27)

#### 15.1.3 Phase 2 — Deferred (client components + crypto route)

| # | File | LOC | Functions | Recommended fix | Severity |
|---|------|-----|-----------|------------------|----------|
| 4 | `src/app/api/crypto/full-analysis/route.ts` | 374 | `sma`/`ema`/`rsi`/`atr`/`bollinger` (lines 47–95). **BUG: RSI + ATR SMA-based مش Wilder's.** | **STRIP-CALCS** — return `null` لكل indicator fields. Pre-requisite: إضافة `/api/indicators/compute` endpoint في Python يقبل OHLC array. | HIGH (feeds crypto charts) |
| 5 | ~~`src/modules/crypto/components/CryptoAdvancedAnalysisView.tsx`~~ | ~~705~~ | 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/crypto/`). Was `computeRSI` (line 682). Wilder's ✅. | ✅ **RESOLVED** (محذوف/أرشيف — 0 importers حية) | ~~MEDIUM~~ ✅ |
| 6 | `src/modules/stock-analysis/components/TradingViewChart.tsx` | 2112 | `calcSMA`/`calcEMA`/`calcBollingerBands`/`calcRSI`/`calcMACD`/`calcStochastic`/`calcATR`/`calcOBV`. **BUG: RSI + ATR SMA-based.** | **DELETE** if orphaned (لا imports) — likely dead code تم استبداله بـ `InteractiveChart`. | MEDIUM (orphan?) |
| 7 | `src/modules/market-analysis/components/InteractiveChart.tsx` | 1695 | `calcEMA`/`calcMACD`/`calcOBV`/`calcFibLevels`. MACD بـ Python-first (good model). | **PARTIAL** — غيّر MACD fallback لـ "render no MACD pane" بدلاً من local calc. EMA9/EMA21/VolMA20 overlays → ضع comment "UX overlay — not used in trading signals". | LOW (mostly Python-first) |
| 8 | `src/modules/education/components/EntryTimingSimulator.tsx` | 968 | `sma` + `rsi2` (RSI(2) Connors variant). | **EXCEPTION-EDUCATIONAL** — استنى مع comment صريح: "Educational simulator — RSI(2) Connors variant، not for production signals. Production RSI(14) Wilder's comes from Python canonical `analyzers/indicators/`." | LOW (educational) |
| 9 | `src/app/api/deal-advisor/[ticker]/route.ts` | 977 | **NONE** — بيقرأ pre-computed `rsi`/`ma_50`/`ma_200` من `stocks.db` (no local calc). | **N/A** — بس ضع data-sources note أن القيم MUST تأتي من Python canonical upstream. | NONE |

#### 15.1.4 Phase 3 — Deferred (backtest verification logic)

| # | File | LOC | Functions | Recommended fix | Severity |
|---|------|-----|-----------|------------------|----------|
| 10 | ~~`src/lib/honest-tracking/maestro.ts`~~ | ~~1862~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان `sma`/`rsi`/`atr`/`bollingerWidth`/`detectCandlestick` (parallel Node stack — 76KB). كان فيه BUG: RSI + ATR SMA-based. بيـ re-compute indicators من price history عشان يتحقق من past predictions. أرشيف في `archive/maestro-dead-code-20261012/`. Used by 5 routes (`/api/admin/generate-historical-predictions` [410 Gone] + `/api/predictions/honest-tracking/{list,stats,learn-from-errors,live-tracking}` [all converted لـ pure proxy في RULE20-PURE-PROXY]). الـ routes كلها بـ تستخدم Python canonical دلوقتي. | ✅ **RESOLVED** (محذوف نهائياً + الـ routes اتحولت لـ pure proxy) |

#### 15.1.5 Cross-cutting recommendation

أضف `bollinger_bands` function لـ Python canonical `vps-service/analyzers/indicators/ma.py` عشان Bollinger يكون له single source of truth. حالياً 4 TS files بتـ يحسبوه محلياً (population std `÷period`). بعد إضافة Python canonical، الـ 4 files يتـ migrated:
- ~~`src/lib/cache/precomputed-cache.ts`~~ (اتمسح في Phase 1)
- `src/app/api/crypto/full-analysis/route.ts` (Phase 2)
- `src/modules/stock-analysis/components/TradingViewChart.tsx` (Phase 2)
- `src/modules/market-analysis/components/InteractiveChart.tsx` (Python-first already — OK)

### 15.2 BACKTEST-ANALYSIS (4-month diagnosis + tuning proposals)

> **المصدر:** `scripts/output/backtest_4months_all_stocks.json` (تم تشغيله في commit `80860337`).
>
> **المرجع الدستوري:** Rule 54 (CALCULATION-CANONICAL — الـ indicators في الـ backtest لازم تيجي من Python canonical عشان الـ verification يكون سليم).

#### 15.2.1 الإحصائيات الإجمالية

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Tickers processed | 533 | — | — |
| Total trades | 25,978 | — | — |
| **Win Rate** | **47.1%** | ≥50% | ⚠️ MARGINAL |
| **Profit Factor** | **1.43** | ≥1.5 | ⚠️ MARGINAL |
| Avg Return | +2.39% | — | — |
| Avg Win | +10.84% | — | — |
| Avg Loss | −6.32% | — | — |
| Avg Holding | 11.3 days | — | — |
| **Implied R:R** (avg_win / \|avg_loss\|) | **1.71** | ≥1.5 | ✅ healthy |
| **Breakeven WR** (for R:R 1.71) | **36.8%** | — | نحن فوقها بـ +10.3pp → في edge فعلي |
| WR needed for PF=1.5 (current R:R) | 46.7% | — | نحن 47.1% → المفروض PF=1.5+ رياضياً |

**التفسير:** R:R=1.71 سليم، ونحن فوق breakeven بـ 10pp، يعني الـ edge موجود. الفجوة بين PF المتوقع (1.53) و PF الفعلي (1.43) راجعة لـ variance (slippage + partial exits + gap-downs beyond stop).

#### 15.2.2 Per-month breakdown

| Month | Trades | Wins | WR | Avg Return | ملاحظة |
|-------|--------|------|-----|------------|--------|
| 2026-05 | 10,807 | 5,085 | **47.1%** | +1.14% | أكبر شهر — Likely too many signals (low-quality filtering) |
| 2026-06 | 5,226 | 2,918 | **55.8%** | +3.63% | تحسّن |
| 2026-07 | 4,724 | 2,872 | **60.8%** | +4.69% | **Best month** |
| 2026-08 | 4,724 | 2,130 | **45.1%** | +1.96% | انخفاض حاد — possible regime shift |
| 2026-09 | 497 | 186 | **37.4%** | −1.09% | عينة صغيرة + أداء سيئ — تحقق من data quality |

**الملاحظة:** May شال 41.6% من total trades (10,807 من 25,978) لكن بأقل avg return (+1.14%). ده معناه إن الـ model كان بـ يولّد signals كتير في May بأقل selectivity. لو رفعنا threshold الـ STRONG_BUY، عدد trades هيقل لكن avg return هيزيد.

#### 15.2.3 Signal distribution

| Signal | Count | % | ملاحظة |
|--------|------|----|--------|
| STRONG_BUY | 9,400 | 36.2% | **مفرط** — أكبر bucket |
| BUY | 7,818 | 30.1% | — |
| HOLD | 3,818 | 14.7% | — |
| SELL | 3,885 | 15.0% | — |
| STRONG_SELL | 1,057 | 4.1% | **نادر** — يحتاج تفعيل أكثر |
| **Total bullish** (STRONG_BUY+BUY) | 17,218 | **66.3%** | long-biased |
| **Total bearish** (SELL+STRONG_SELL) | 4,942 | **19.0%** | under-represented |

**الملاحظة:** الـ model long-biased جداً (66% bullish vs 19% bearish). في market bearish (زي August/September)، الـ model مفروض يطلع SELL أكثر. ده إما scoring bias أو data skew.

#### 15.2.4 🚨 CRITICAL bug — SELL signals producing +49% gains

**Top 10 winners:**

| Ticker | Date | Signal | Return |
|--------|------|--------|--------|
| TYCN | 2026-08-31 | HOLD | +49.97% |
| **MPRC** | 2026-05-25 | **SELL** | **+49.92%** ← anomaly |
| **MPRC** | 2026-05-26 | **SELL** | **+49.92%** ← anomaly |
| **MPRC** | 2026-05-27 | **SELL** | **+49.92%** ← anomaly |
| **MPRC** | 2026-05-28 | **SELL** | **+49.92%** ← anomaly |
| ETEL | 2026-05-13 | BUY | +49.68% |
| ETEL | 2026-05-14 | BUY | +49.68% |
| **OLFI** | 2026-05-21 | **SELL** | **+49.57%** ← anomaly |
| ALUM | 2026-05-13 | STRONG_BUY | +49.36% |
| TYCN | 2026-08-18 | BUY | +49.36% |

**5 من 10 top winners هم SELL signals بـ +49% gains.** ده logically impossible — SELL signal معناه إن الـ price مفروض ينزل، فلو طلع بـ +49% يبقى الـ trade حقق loss مش win.

**التفسير:** الـ backtest بـ يحسب raw price returns `(exit_price - entry_price) / entry_price` **WITHOUT تطبيق signal direction**.

- SELL signal PnL = `entry_price - exit_price` (عكس BUY)
- اللي بيحصل دلوقتي: SELL signal PnL = `exit_price - entry_price` (نفس BUY)

**الأثر:**
- WR بـ يبان أعلى من الحقيقة (SELL signals اللي خسرت بتـ تتحسب كأنها كسبت)
- PF بـ يبان أعلى (avg win متضخم بـ SELL "wins" وهمية)
- الـ metrics كلها مش trustworthy لحد ما يـ تتصلح الـ bug

**الإصلاح المطلوب:** في `scripts/backtest_4months_all_stocks.py` (أو الـ script اللي ولّد الـ JSON)، لازم الـ return calculation تـ تطبّق signal direction:

```python
if signal in ('SELL', 'STRONG_SELL'):
    actual_return = -(exit_price - entry_price) / entry_price * 100
else:  # BUY / STRONG_BUY / HOLD (long-only)
    actual_return = (exit_price - entry_price) / entry_price * 100
```

⚠️ **بعد إصلاح الـ bug، لازم re-run الـ backtest** عشان الأرقام تتحدث. الـ WR/PF الحقيقي ممكن يبقى مختلف (أقل أو أعلى — مش نقدر نعرف قبل الـ re-run).

#### 15.2.5 Top losers — same-ticker concentration

**Top 10 losers:**

| Ticker | Date | Signal | Return |
|--------|------|--------|--------|
| HDBK | 2026-07-20 | BUY | −48.74% |
| MKIT | 2026-05-05 | STRONG_BUY | −49.03% |
| GPIM | 2026-09-02 | BUY | −49.07% |
| MKIT | 2026-05-04 | STRONG_BUY | −49.63% |
| HDBK | 2026-06-28 | STRONG_BUY | −49.65% |
| **GTHE** | 2026-08-17 | **STRONG_BUY** | **−49.77%** |
| **GTHE** | 2026-08-18 | **STRONG_BUY** | **−49.77%** |
| **GTHE** | 2026-08-19 | **STRONG_BUY** | **−50.00%** |
| **GTHE** | 2026-08-20 | **STRONG_BUY** | **−50.00%** |
| **GTHE** | 2026-08-23 | **STRONG_BUY** | **−50.00%** |

**الأنماط:**
- 8 من 10 losers هم STRONG_BUY → الـ model over-confident على STRONG_BUY
- **GTHE ظهر 5 مرات متتالية بنفس النتيجة (-49% إلى -50%)** → الـ model كان بـ يقول STRONG_BUY على سهم بيـ ينزل يومياً. **مفيش circuit breaker** يـ يوقف تكرار إصدار STRONG_BUY على نفس السهم بعد أول loss.
- MKIT ظهر مرتين متتاليتين (4 ماي + 5 ماي) بنفس النتيجة (-49%) → نفس المشكلة
- HDBK ظهر مرتين (28 يونيو STRONG_BUY + 20 يوليو BUY) → السهم بيـ ينزل والـ model بـ يفضل يقول BUY

#### 15.2.6 Tuning proposals

##### A. Scoring tuning (target: WR ≥ 50%)

| # | التغيير | الآلية المتوقعة | التأثير المتوقع |
|---|---------|-----------------|-----------------|
| A1 | **رفع STRONG_BUY threshold** من master_score ≥ 70 → ≥ 80 | cuts ~50% من STRONG_BUY signals (المارچنال ones) | WR ↑ 2–4pp، trades ↓ 4,000–5,000 |
| A2 | **Liquidity gate على STRONG_BUY** | `avg_turnover_20d ≥ 5M EGP` مطلوبة لـ STRONG_BUY. لو أقل → downgrade لـ BUY. | filters out low-liquidity names زي GTHE/MKIT اللي بـ gap down |
| A3 | **Per-ticker circuit breaker** | بعد 2 consecutive losing trades على نفس ticker → suppress STRONG_BUY لـ 5 trading days. | يمنع تكرار GTHE × 5 / MKIT × 2 / HDBK × 2 |
| A4 | **Rebalance signal distribution** | target: 40% bullish / 30% hold / 30% bearish (currently 66% / 15% / 19%). راجع scoring weights. | يخلي الـ model يتفاعل مع bearish regimes (زي Aug/Sep) |

##### B. Stop/target tuning (target: PF ≥ 1.5)

| # | التغيير | الآلية المتوقعة | التأثير المتوقع |
|---|---------|-----------------|-----------------|
| B1 | **ATR-based stop** | استبدال fixed % stop بـ `1.5 × ATR(14)` below entry (adaptive لـ volatility) | avg_loss يبقى adaptive بدلاً من fixed 6.32% |
| B2 | **Trailing stop after +1R** | لما trade يوصل +1×(entry−stop) → حرّك stop لـ breakeven | يقفل الـ winners كـ wins بدلاً من round-trip losses |
| B3 | **ATR-based target** | `2.5 × ATR` target (R:R = 1.67 at indicator level) | يحافظ على R:R الحالي بس بـ volatility-adaptive |
| B4 | **Tighter stop على STRONG_BUY** | 1.0×ATR (tighter) لـ STRONG_BUY / 1.5×ATR لـ BUY / 2.0×ATR لـ HOLD | عشان STRONG_BUY signals بـ تـ blow up أكتر، stop أضيق يقلل avg_loss |

##### C. Critical bug fix (pre-requisite لأي tuning)

| # | التغيير | الآلية | الأولوية |
|---|---------|--------|----------|
| C1 | **إصلاح SELL-signal backtest bug** | in `scripts/backtest_4months_all_stocks.py` (or الـ script اللي ولّد JSON)، احسب `actual_return` بـ signal direction. re-run backtest بعد الإصلاح. | **P0 — قبل أي tuning** |

##### D. Data quality investigation

| # | التغيير | الآلية | الأولوية |
|---|---------|--------|----------|
| D1 | **September anomaly** | 497 trades بس بـ −1.09% avg — تحقق من price_history coverage للـ September 2026. ممكن يكون في data gap. | P1 |
| D2 | **August WR drop** (60.8% → 45.1%) | تحقق من regime shift — هل في news event / market crash في early August 2026؟ راجع news.db. | P1 |
| D3 | **GTHE concentration** | تحقق لو GTHE كان suspended أو had corporate action (split / dividend) في أغسطس 2026 → الـ price data ممكن يكون corrupt. | P1 |

#### 15.2.7 الخلاصة

- **WR=47.1%, PF=1.43** — تحت الـ target (≥50% / ≥1.5) بس فوق breakeven (36.8%). في edge فعلي.
- **CRITICAL bug: SELL signals بـ تـ produce +49% gains** → backtest لا يطبق signal direction. لازم إصلاح قبل أي tuning.
- **8 من 10 top losers هم STRONG_BUY** → model over-confident. ينقصه: (1) رفع threshold، (2) liquidity gate، (3) per-ticker circuit breaker.
- **R:R=1.71 سليم** بس PF أقل من المتوقع → variance من slippage / gap-downs.
- **3 tuning proposals جاهزة للـ discussion** (scoring / stop-target / bug fix) — بانتظار قرار المالك قبل التنفيذ.

---

## 16. SCREENS-SURVEY-2026-10-05

> **المصدر:** audit آلي لـ `src/app/page.tsx` + `src/lib/valid-views.ts` + `src/components/layout/TopBar.tsx` + grep عبر `src/components/market/` + `src/modules/publishing/components/` + `src/modules/*/components/`.
>
> **المرجع الدستوري:** Rule 3 (لا تُنشئ صفحات Next.js جديدة) + Rule 20 (Python = العقل، Node = عرض فقط) + Rule 25 (VERIFY-BEFORE-DELETE).

### 16.1 Hash views inventory (53 entries في `VALID_VIEWS`)

**Total hash views:** **53** (موزّعة كالتالي):
- ✅ **Active / visible in TopBar:** **23** (21 nav + 2 user-menu)
- 🚫 **Hidden / legacy / backwards-compat (still rendered):** **30** (incl. 11 `crypto-*` redirects)
- 🚫 **Admin-only stub:** **2** (`prediction-performance`, `prediction-credibility`)

#### 16.1A Active / visible in TopBar (23)

| # | Hash | Section | Lazy-import path | Purpose |
|---|------|---------|------------------|---------|
| 1 | `#dashboard` | الرئيسية | `@/modules/dashboard/components/DashboardView` | Overview / market summary widgets |
| 2 | `#stocks` | السوق | `@/modules/stock-analysis/components/StocksView` | Stock list + detail drill-down |
| 3 | `#stock-filters` | السوق | `@/modules/screener/components/StockScreenerAdvanced` | Stock screener (presets + filters) |
| 4 | `#trading-chart` | السوق | `@/modules/market-analysis/components/TradingChartView` | Interactive chart |
| 5 | `#liquidity-radar` | السوق | `@/modules/predictions/components/MakerRadarTab` | Maker radar (5 sub-tabs) |
| 6 | `#market-depth` | السوق | Inline composite (MarketDepthMultiMarket + 3 panels) | Currencies + gold + liquidity + investors + intraday |
| 7 | `#recommendations` | التوقعات | `@/modules/market-analysis/components/MarketAnalysisView` | Unified recommendations (5 sub-tabs) |
| 8 | `#specialist-analysis` | التوقعات | `@/components/advanced-analysis/SpecialistAnalysisView` | Expert intelligence comparison |
| 9 | `#reports` | التوقعات | `@/modules/reports/components/ReportsView` | Daily/weekly reports |
| 10 | `#portfolio` | أموالي | `@/modules/portfolio/components/EnhancedPortfolioView` | Unified portfolio (absorbed wealth + bagholder-rescue) |
| 11 | `#watchlist` | أموالي | `@/components/watchlist/EnhancedWatchlistView` | Personal watchlists |
| 12 | `#alerts-center` | أموالي | `@/components/alerts/AlertsCenterView` | Multi-stage alerts center |
| 13 | `#live-monitor` | أموالي | `@/modules/dashboard/components/LiveMonitor` | Real-time live monitor |
| 14 | `#trading-memory` | أموالي | `@/components/memory/TradingMemoryView` | Trading memory / journal |
| 15 | `#news` | المزيد | `@/modules/news/components/NewsFeedView` | News aggregator |
| 16 | `#simulation` | المزيد | `@/modules/simulation/components/SimulationView` | Paper-trading simulators |
| 17 | `#academy` | المزيد | `@/modules/education/components/AcademyView` | Academy (8 sub-tabs) |
| 18 | `#sharia` | المزيد | `@/modules/sharia/components/ShariaView` | Sharia compliance |
| 19 | `#zakat` | المزيد | `@/components/zakat/ZakatView` | Zakat calculator |
| 20 | `#tithes` | المزيد | `@/components/tithes/TithesView` | Tithes calculator |
| 21 | `#subscription` | المزيد | `@/components/subscription/SubscriptionView` | Plans + paywall |
| 22 | `#about` | (user menu) | `@/components/about/AboutView` | About page |
| 23 | `#settings` | (user menu) | `@/components/settings/SettingsView` | User settings |

#### 16.1B Hidden / legacy / backwards-compat (30)

`#top-performers` (merged into #stock-filters) · `#screener` (alias #trading-chart) · `#finance` (alias #portfolio) · `#analysis` / `#v2-analysis` / `#advanced-analysis` (alias #recommendations) · `#unified-analysis` · `#prediction-tracking` · `#picks-management` (REMOVED 2026-09-28) · `#dual-track` · `#v82` · `#bagholder-rescue` (merged into #portfolio) · `#advanced-portfolio` · `#seasonality` · `#smart-confluence` · `#wealth` (merged into #portfolio) · `#trading-journal` · `#publishing` · `#backtesting` (مخفية/قديمة) · `#auth` · `#admin` · **11 `crypto-*` redirects** (`#crypto` → DashboardView, `#crypto-live` → StocksView, `#crypto-portfolio`, `#crypto-watchlist`, `#crypto-recommendations` → MarketAnalysisView, `#crypto-analysis` → SmartConfluenceView, `#crypto-learning` → AcademyView per Rule 63, `#crypto-simulation` → SimulationView, `#crypto-trading-chart` → TradingChartView, `#crypto-prediction-tracking` → CryptoPredictionTrackingView, `#crypto-screener` → StockScreenerAdvanced).

### 16.2 Card components inventory (16 files، 8,903 LOC)

> كل الـ cards نشطة (0 orphaned / deprecated) — merges الـ 3 السابقة (MERGE-PREDICTION-CARDS + MERGE-LIST-CARDS + TELEGRAM-LINK) كلها نجحت.

#### 16.2A `src/components/market/` (9 publish-style cards)

| # | File | LOC | Component | Renders | Status |
|---|------|-----|-----------|---------|--------|
| 1 | `TopTradesImageCard.tsx` | 42 | `TopTradesImageCard` | Re-export wrapper → `<StockLeagueImageCard mode="trades" />` | ACTIVE (wrapper) |
| 2 | `ExpertPredictionsImageCard.tsx` | 106 | `ExpertPredictionsImageCard` | Re-export wrapper → `<PredictionsImageCard expertName="الخبراء" />` | ACTIVE (wrapper) |
| 3 | `PersonaImageCard.tsx` | 144 | `PersonaImageCard` | Re-export wrapper → `<PredictionsImageCard persona={...} />` | ACTIVE (wrapper) |
| 4 | `ImageCardExport.tsx` | 228 | `ImageCardExport` | Generic wrapper: PNG download + Telegram publish (POSTs إلى `/api/market/publish-status-image`) | ACTIVE |
| 5 | `MarketStatusExport.tsx` | 294 | `MarketStatusExport` | Market-status image card + publish button | ACTIVE |
| 6 | `MarketRegimeBanner.tsx` | 322 | `MarketRegimeBanner` | Banner (BULL/BEAR/SIDEWAYS) — not a publish card | ACTIVE (banner) |
| 7 | `StockLeagueImageCard.tsx` | 555 | `StockLeagueImageCard` | Unified league (mode='league') OR top-trades (mode='trades') card. Auto-fetches `/api/predictions/league-report` أو `/api/predictions/monthly-league`. | ACTIVE |
| 8 | `PredictionsImageCard.tsx` | 754 | `PredictionsImageCard` | **Canonical predictions card** (absorbed Persona + ExpertPredictions impls بعد MERGE-PREDICTION-CARDS) | ACTIVE (canonical) |
| 9 | `MarketStatusImageCard.tsx` | 769 | `MarketStatusImageCard` | Market-status card (winners/losers/regime). `forwardRef`. | ACTIVE |

#### 16.2B `src/modules/publishing/components/` (7 components، 5,689 LOC)

| # | File | LOC | Component | Renders | Status |
|---|------|-----|-----------|---------|--------|
| 10 | `StockInfographicModal.tsx` | 334 | `StockInfographicModal` | Dialog مع live `StockInfographicCard` preview + 3 export buttons (PNG / Telegram / Clipboard). POSTs image multipart إلى `/api/telegram/publish-stock` (admin-only). | ACTIVE |
| 11 | `ShareButton.tsx` | 449 | `ShareButton` | Generic share (Telegram/WhatsApp/Facebook/Twitter URL share-urls only — no bot API) | ACTIVE |
| 12 | `TradeResultsGenerator.tsx` | 541 | `TradeResultsGenerator` | Trade-results image generator + export | ACTIVE |
| 13 | `UnifiedPublishButton.tsx` | 754 | `UnifiedPublishButton` | Unified publish button (renders `StockInfographicModal` inside dropdown). 10 callers. | ACTIVE |
| 14 | `StockInfographicCard.tsx` | 1,027 | `StockInfographicCard` | **الكارت الموحّد** (للتحليل + النشر + Telegram bot). 7 sections: header/chart/gauge/scenarios/vision/disclaimer/footer. `cardRef` لـ html-to-image capture. | **ACTIVE (canonical infographic)** |
| 15 | `StockPublisher.tsx` | 1,128 | `StockPublisher` | Multi-tab publish Dialog. Admin "نشر على تيليجرام" button بـ render `StockInfographicCard` off-screen → capture PNG → POSTs image+caption multipart إلى `/api/telegram/publish-stock`. Fallback لـ text-only JSON. | ACTIVE |
| 16 | `TradeResultsTemplates.tsx` | 1,456 | `TradeResultsTemplates` | Templates لـ trade-results publishing | ACTIVE |

#### 16.2C الكروت بعد التوحيد

| الكارت الموحّد | absorbed | LOC |
|----------------|----------|-----|
| `StockInfographicCard` (canonical infographic — for Telegram bot + unified analysis) | (none — original) | 1,027 |
| `PredictionsImageCard` (canonical predictions — for persona + expert predictions) | `PersonaImageCard` + `ExpertPredictionsImageCard` (دلوقتي wrappers بـ re-export) | 754 |
| `StockLeagueImageCard` (canonical list — for stock league + top trades) | `TopTradesImageCard` (دلوقتي wrapper بـ re-export) | 555 |
| `MarketStatusImageCard` (independent — for market status) | (none) | 769 |

**4 cards أساسية** بـ تغطي كل الـ publish use-cases. الـ wrappers (`PersonaImageCard` + `ExpertPredictionsImageCard` + `TopTradesImageCard`) اتسابوا عشان backward-compat imports من 8 market-analysis sub-tabs.

### 16.3 Telegram publishing integration (39 files، ~21,312 LOC)

#### 16.3A Next.js API routes (9 files، 1,244 LOC)

| File | LOC | Purpose |
|------|-----|---------|
| `src/app/api/telegram/publish-stock/route.ts` | 205 | **Primary bot-publish endpoint.** JSON + multipart. `image` → Telegram Bot API `sendPhoto` (rich caption)؛ иначе `sendMessage`. Reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID` from env. Writes audit trail لـ `predictions.db`. |
| `src/app/api/telegram/post/route.ts` | 114 | Proxy → Python `/api/telegram/post/{action}` |
| `src/app/api/telegram/send-daily-report/route.ts` | 30 | Thin proxy → `${PY}/api/telegram/send-daily-report?market=EGX` |
| `src/app/api/telegram/[...path]/route.ts` | 124 | **Catch-all proxy** لكل `/api/telegram/*` → Python (default `localhost:8010`). Binary-safe. |
| `src/app/api/market/publish-status-image/route.ts` | 81 | Proxy → Python `/api/market/publish-status-image` — used by `ImageCardExport` + `MarketStatusExport`. 90s timeout. |
| `src/app/api/admin/telegram-predictions/route.ts` | 191 | Admin audit dashboard (published + pending predictions) |
| `src/app/api/bot/link-token/route.ts` | 119 | BOT-SUBSCRIPTION-GATE: يولّد `bot_link_tokens` row (10-min expiry) |
| `src/app/api/bot/link-account/route.ts` | 127 | يستهلك link token، يكتب `user_telegram_links`، يرجّع `chat_id` |
| `src/app/api/bot/check-subscription/route.ts` | 159 | Bot-side check لـ active premium subscription بـ `chat_id` |

#### 16.3B Frontend admin / card-level callers (11 files، ~8,538 LOC)

| File | LOC | Telegram behavior |
|------|-----|-------------------|
| `src/modules/publishing/components/StockPublisher.tsx` | 1,128 | Admin-only button → captures off-screen `StockInfographicCard` → POSTs multipart لـ `/api/telegram/publish-stock`. Fallback: text-only JSON. |
| `src/modules/publishing/components/StockInfographicModal.tsx` | 334 | Path مستقل: builds rich HTML caption + POSTs image لـ `/api/telegram/publish-stock`. |
| `src/modules/publishing/components/UnifiedPublishButton.tsx` | 754 | renders `StockInfographicModal` inside dropdown — Telegram publish بيمر من خلال الـ modal ده. |
| `src/components/market/ImageCardExport.tsx` | 228 | Generic wrapper — POSTs captured card image لـ `/api/market/publish-status-image`. |
| `src/components/market/MarketStatusExport.tsx` | 294 | Uses `/api/market/publish-status-image`. |
| `src/components/market/StockLeagueImageCard.tsx` | 555 | Uses `ImageCardExport` (publishes via `/api/market/publish-status-image`). |
| `src/components/share/ShareButton.tsx` | 586 | Generic share — `t.me/share/url` only. |
| `src/modules/admin/components/TelegramTab.tsx` | 2,200 | Full Telegram user-client UI (login/dialogs/messages). Uses catch-all proxy `/api/telegram/*` → Python `telegram_client.py`. |
| `src/modules/admin/components/TelegramPredictionsTab.tsx` | 397 | Admin audit dashboard + manual "نشر المعلق" button → `/api/telegram/publish-stock`. |
| `src/lib/bot-link-db.ts` | 256 | SQLite schema + CRUD لـ `bot_link_tokens` + `user_telegram_links`. |
| `src/lib/chart-generator.ts` | 360 | Server-side chart PNG generator. |

Plus inline `BotLinkHandler` component في `src/app/page.tsx` (lines 898–1043) بـ يتعامل مع `?bot_link=TOKEN` URL param → POSTs لـ `/api/bot/link-account`.

#### 16.3C Python-side Telegram bot (19 files، ~11,530 LOC)

**`/home/z/my-project/vps-service/telegram/`** (15 .py files، ~9,300 LOC):

| File | LOC | Role |
|------|-----|------|
| `telegram_bot_api.py` | 484 | Bot API wrapper — `sendPhoto`, `sendMessage` |
| `telegram_notifier.py` | 411 | High-level notifier |
| `telegram_client.py` | 1,256 | Telethon-style user-account client (used by admin `TelegramTab`) |
| `telegram_interactive_bot.py` | 1,222 | Interactive bot (`/start`, link-token generation, callback queries) |
| `telegram_chart_generator.py` | 498 | Chart PNG generator |
| `telegram_target_hit_tracker.py` | 1,039 | Target-hit tracker → auto-posts لـ channel |
| `telegram_daily_lessons.py` | 499 | Daily lesson auto-broadcaster |
| `telegram_report_card.py` | 458 | Report card publishing |
| `auto_poster.py` | 741 | Auto-post pipeline |
| `auto_post_scheduler.py` | 1,665 | Scheduler لـ auto-poster |
| `ai_processor.py` | 452 | AI text processing لـ posts |
| `database.py` | 414 | SQLite storage لـ bot |
| `egx_arabic_lookup.py` | 159 | Arabic-name lookup لـ EGX tickers |
| `telegram_branding.py` | 242 | Branding/header/footer لـ cards |
| `__init__.py` | 14 | Package marker |

**`/home/z/my-project/news-agent/`** (4 telegram-related .py files، ~1,037 LOC):

| File | LOC | Role |
|------|-----|------|
| `sender/social_publisher.py` | 384 | Social publisher (Telegram + others) لـ news |
| `sender/production_sender.py` | 203 | Production sender — wraps social_publisher |
| `collectors/telegram_collector.py` | 275 | Telegram channel collector (scrapes messages من external channels) |
| `collectors/telegram_web_collector.py` | 175 | Telegram web collector (alternative scraper) |

#### 16.3D Trace: `StockInfographicCard` → Telegram bot

**Who calls `StockInfographicCard`?**
1. **`StockPublisher.tsx:604`** — renders off-screen inside Dialog (`position: absolute; left:-99999px; scale(0.5)`) لـ PNG capture.
2. **`StockInfographicModal.tsx:266`** — renders visible inside Dialog لـ preview + capture.
3. **`src/modules/publishing/index.ts`** — re-exports it.
4. **`StockDetail.tsx:41`** — imports `StockInfographicCardProps` type only، builds data via `buildStockInfographicDataFromStock(stock, deepAnalysis, footprintData)` (line 186) و يمررها لـ `<StockPublisher infographicData={...} />` + `<StockInfographicModal data={...} />`.

**ما الـ data اللي بياخدها `StockInfographicCard`؟**

Type: `StockInfographicCardProps['data']` (see `StockInfographicCard.tsx:32-107`).

الحقول الرئيسية:
- `ticker`, `name_ar`, `sector`, `logo_url`, `current_price`, `change_value`, `change_pct`, `currency`
- `session{high,low,prev_close,volume,turnover,trades_count}`
- `chart_data[]` (price + volume series)
- `technical_indicators{timeframe,buy_signals,neutral_signals,sell_signals,sentiment_label,gauge_score}`
- `fundamentals{market_cap,eps,p_e,dividend_yield,yearly_high,yearly_low,book_value}`
- `levels{resistance_2,resistance_1,support_1,support_2}`
- `scenarios{bullish_target,bullish_text,bearish_target,bearish_text}`
- `vision_bullet_points[]`
- `rating{score,label,stars_count}`
- optional `liquidity{poc_price,vah_price,val_price,buy_volume,sell_volume,delta_volume,buy_sell_ratio,accumulation_label,levels[]}`

بيـ يتـ built client-side في `StockDetail.tsx:186` (`buildStockInfographicDataFromStock`) من `(stock, deepAnalysis, footprintData)` — مفيش network call إضافي.

**إعدادات Telegram bot token / chat ID:**

| Layer | Variable | Read at | Default |
|-------|----------|---------|---------|
| Next.js publish-stock route | `TELEGRAM_BOT_TOKEN` | `src/app/api/telegram/publish-stock/route.ts:82` | `undefined` (returns 503 if missing) |
| Next.js publish-stock route | `TELEGRAM_CHANNEL_ID` | same file:83 | `undefined` |
| Python `telegram_notifier.py:53,55` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` / `TELEGRAM_CHANNEL_ID` | lines 53-55 | `''`; channel default `@Arabian_investment_guide` |
| Python `telegram_bot_api.py:114-118` | same | lines 114-118 | `''` |
| Python `telegram_interactive_bot.py:65-66` | same | lines 65-66 | `"@Arabian_investment_guide"` |

**Local env status:** `/home/z/my-project/.env` contains ONLY `DATABASE_URL=file:/home/z/my-project/db/custom.db` — **NO TELEGRAM vars are set locally**. لازم تـ تتعرّف على الـ production VPS / docker env.

#### 16.3E Three publish paths summary

| # | Path | Trigger | Flow | Output |
|---|------|---------|------|--------|
| 1 | **Infographic (admin-only)** | `StockDetail.tsx` → `<StockPublisher infographicData={...}>` | off-screen `<StockInfographicCard>` → `html-to-image` capture → multipart POST لـ `/api/telegram/publish-stock` | route calls Telegram Bot API `sendPhoto` → writes audit لـ `predictions.db` |
| 2 | **Infographic modal** | `StockDetail.tsx` + `UnifiedPublishButton` → `<StockInfographicModal>` | visible preview + capture → multipart POST لـ `/api/telegram/publish-stock` (rich HTML caption) | same endpoint |
| 3 | **Market status / list card** | `ImageCardExport` / `MarketStatusExport` / `StockLeagueImageCard` | JSON `{image, market, caption}` POST لـ `/api/market/publish-status-image` | Python backend `auto_poster.send_photo` publishes لـ `@Arabian_investment_guide` |

### 16.4 Sub-screens (tabs داخل major views)

#### 16.4A `#recommendations` (MarketAnalysisView.tsx, 297 LOC) — 5 tabs

| Tab value | Component | Purpose |
|-----------|-----------|---------|
| `predictions` (default) | `<UnifiedPredictionsTab>` | Unified predictions (3 internal sub-views: الحالية / الأداء / الملخص) |
| `status` | `<MarketStatusTab>` | Market status (winners/losers/regime) + `MarketStatusExport` publish button |
| `sectors-tracking` | `<SectorTrackingTab>` | Sector movement tracking |
| `historical-trades` | `<HistoricalTradesTable>` | 13,117 historical trades table |
| `net-picks` | `<NetPicksTab>` | "صافى التوقعات" canonical view |

#### 16.4B `#admin` (AdminView.tsx, 2,060 LOC) — 5 hubs، 28 sub-tabs

| Hub | Sub-tabs |
|-----|----------|
| **health** (المراقبة وصحة النظام) | dashboard · system-monitor · problems · cron-health (4) |
| **maestro** (المحركات والتعلم الذكي) | engine-control-room · data-engine · general · engine-settings · learning · backtest · platform-performance (7) |
| **data** (البيانات وقواعد البيانات) | databases · db-backup · system-control · news-control · news-health · sharia · source-authority · validation-monitor (8) |
| **users** (المستخدمين والاشتراكات) | user-management · users · promo-codes · pricing · feedback (5) |
| **telegram** (أدوات التسويق والنشر) | marketing-studio · reports · telegram · telegram-predictions (4) |

#### 16.4C `#academy` (AcademyView.tsx, 2,483 LOC) — 8 tabs

| Tab value | Component |
|-----------|-----------|
| `encyclopedia` | `<AcademyEncyclopedia>` |
| `paper-trading` | `<PaperTradingWorkstation>` |
| `candle-sim` | `<CandlestickSimulator>` |
| `strategy-lab` | `<StrategySandbox>` |
| `advanced-lessons` | `<AdvancedLessonsTab>` |
| `trading-floor` | `<TradingFloorView>` |
| `practical-tools` | `<PracticalToolsView>` |
| `advanced-lab` | `<AdvancedLabView>` |

#### 16.4D `#dashboard` (DashboardView.tsx, 573 LOC)

- **No TabsTriggers** — single-page widget grid: فرص جاهزة الآن / حالة السوق / ودجات مثبتة / ملخص السوق والمؤشرات / نبض السوق / توقعات اليوم / الأكثر تحركاً / إشارات الكريبتو + `MyStocksBriefing`.

#### 16.4E `#specialist-analysis` (SpecialistAnalysisView.tsx, 1,462 LOC)

- **No TabsTriggers** — single-panel view (expert comparison).

#### 16.4F `#liquidity-radar` (MakerRadarTab.tsx) — 5 internal sub-tabs

`exit-radar` · `weekly-report` · `multi-market-radar` · `radar-accuracy` · `personalized-radar` (انتقلت من `#recommendations` per Task 9-B Step 2) + internal filter `all/quiet/pre_surge/early_break/explosive`.

> **ملاحظة ORPHAN-GARAGE-COLLECTOR (2026-10-12):** الـ tab name `personalized-radar` لسه مستخدم كـ tab identifier في `MakerRadarTab.tsx` (UI label). بس lib utility file `src/modules/personalized/lib/personalized-radar.ts` (583 LOC) **محذوف/أرشيف** → `archive/dead-components-20261012/personalized/lib/personalized-radar.ts` (0 importers حية — الـ matches كانت strings للـ tab values + testids, مش imports).

### 16.5 الإحصائيات الإجمالية (2026-10-05)

| Metric | Value |
|--------|-------|
| **Hash views في `VALID_VIEWS`** | **53** |
| Active / visible في TopBar + user menu | **23** |
| Hidden / legacy / backwards-compat | **30** (incl. 11 `crypto-*` redirects) |
| Admin-only stub | **2** (`prediction-performance`, `prediction-credibility`) |
| Default fallback view | `#dashboard` |
| **Card components (publish-style)** | **16 files** |
| Active cards | **16** |
| Orphaned / deprecated cards | **0** (all merges succeeded) |
| **Total LOC of card components** | **8,903 LOC** (8,581 LOC excluding `MarketRegimeBanner`) |
| **Files with Telegram integration (TS/TSX)** | 9 routes + 11 frontend = **20 files** (~9,782 LOC) |
| **Python-side Telegram files** | **19 files** (~11,530 LOC) |
| **Total Telegram integration (TS+PY)** | **39 files، ~21,312 LOC** |
| Major views with internal tabs (sub-screens) | 4 (`#recommendations`=5 tabs · `#admin`=28 tabs in 5 hubs · `#academy`=8 tabs · `#liquidity-radar`=5 sub-tabs) |
| Major views WITHOUT tabs (single-section) | 2 (`#dashboard` widget grid · `#specialist-analysis` single panel) |

### 16.6 Verification confirmations

- ✅ `StockInfographicCard.tsx` موجود (1,027 LOC) — الكارت الموحّد.
- ✅ `StockPublisher.tsx` موجود (1,128 LOC) — admin "نشر على تيليجرام" button.
- ✅ `PredictionsImageCard.tsx` موجود (754 LOC) — canonical predictions card.
- ✅ `MarketStatusImageCard.tsx` موجود (769 LOC).
- ✅ `PersonaImageCard.tsx` موجود (144 LOC) — thin wrapper.
- ✅ `StockLeagueImageCard.tsx` موجود (555 LOC) — unified league + trades.
- ✅ `TopTradesImageCard.tsx` موجود (42 LOC) — thin wrapper.
- ✅ `ExpertPredictionsImageCard.tsx` **STILL EXISTS** (106 LOC) — دلوقتي thin re-export wrapper (مش deleted؛ محفوظ لـ backward-compat imports من 8 market-analysis sub-tabs).
- ✅ `ImageCardExport.tsx` موجود (228 LOC).
- ✅ `StockInfographicCard` ↔ Telegram bot link fully wired عبر `StockPublisher` + `StockInfographicModal` → `/api/telegram/publish-stock` → Telegram Bot API `sendPhoto` → `predictions.db` audit trail.
- ✅ Local `.env` ما فيهش TELEGRAM vars — لازم تـ تتعرّف على الـ production VPS.

---

## 17. Marketing Studio Blueprint

> **المصدر:** `07-MARKETING-STUDIO-BLUEPRINT.md` (مُدمج كاملًا في هذا القسم).
> **التاريخ:** 2026-10-09
> **المنفذ:** المدير العام (Z.ai Code) — عضو مهم في الفريق
> **الحالة:** تصور هندسي كامل (لم التنفيذ بعد — يحتاج إذن المالك)

### 17.1 الهدف

تحويل استوديو التسويق من "أحلام جامدة" إلى **مركز نشر احترافي متكامل** يناسب منصة استثمارية رصينة.

### 17.2 المعمارية المقترحة (3 طبقات)

#### الطبقة 1: تقويم المحتوى (Content Calendar)
> **جدول زمني للنشر** — يعرض كل المنشورات المجدولة + المنشورة + المسودات.

```
┌─────────────────────────────────────────────────────┐
│  📅 تقويم النشر                                       │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐        │
│  │ الأحد │ الإثنين │ الثلاثاء │ الأربعاء │ الخميس │ الجمعة │ السبت │ │
│  │ 📊   │ 📊   │ 📊   │ —   │ —   │ —   │ —   │        │
│  │ صباحي │ مسائي │ صباحي │     │     │     │     │        │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘        │
│                                                      │
│  📊 = تقرير صباحي (Morning Bell)                      │
│  📈 = كرت سهم                                         │
│  📰 = خبر مهم                                         │
│  🎬 = فيديو                                           │
└─────────────────────────────────────────────────────┘
```

**المميزات:**
- عرض أسبوعي/شهري (Calendar View)
- سحب وإفلات (Drag & Drop) لإعادة جدولة المنشورات
- حالات: مسودة / مجدول / منشور / فشل
- تنبيه: "لم تنشر منذ X أيام"

#### الطبقة 2: مولد الكروت الذكي (Smart Card Generator)
> **إنشاء كروت نشر احترافية بنقرة واحدة** — من بيانات حقيقية.

```
┌─────────────────────────────────────────────────────┐
│  🎨 مولد الكروت                                       │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ 📊 تقرير     │  │ 📈 كرت سهم  │  │ 📰 كرت خبر  │ │
│  │ أداء        │  │ توصية       │  │ تأثير       │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ 1. اختر السوق: [EGX ▾]                       │    │
│  │ 2. اختر النوع: [تقرير أسبوعي ▾]              │    │
│  │ 3. الفترة: [آخر 7 أيام ▾]                    │    │
│  │ 4. [🏭 توليد الكرت]                          │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  [معاينة الكرت — PNG]                        │    │
│  │  [تعديل النص] [تغيير الألوان] [إضافة شعار]    │    │
│  │  [📋 نسخ النص] [📸 تحميل PNG] [📤 نشر لـ TG]  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**المميزات:**
- 3 أنواع كروت: تقرير أداء / كرت سهم / كرت خبر
- اختيار السوق (6 أسواق)
- اختيار الفترة (يومي/أسبوعي/شهري)
- معاينة مباشرة (Live Preview)
- تعديل نص + ألوان + شعار
- تصدير PNG + نسخ نص + نشر تليجرام
- **كل البيانات من API حقيقي** (Rule 27)

#### الطبقة 3: محرر الفيديو (Video Editor — أبسط نسخة)
> **فيديو قصير (Reels/Shorts)** من بيانات السهم — ليس CapCut كامل.

```
┌─────────────────────────────────────────────────────┐
│  🎬 محرر الفيديو (بسيط)                               │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐     │    │
│  │  │ Frame 1 │  │ Frame 2 │  │ Frame 3 │     │    │
│  │  │ شعار    │  │ بيانات  │  │ شارت    │     │    │
│  │  │ المنصة  │  │ السهم   │  │ السهم   │     │    │
│  │  └─────────┘  └─────────┘  └─────────┘     │    │
│  │  [◀ السابق]  [▶ معاينة]  [التالي ▶]        │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ المدة: [15 ثانية ▾]                          │    │
│  │ الموسيقى: [بلا ▾]                            │    │
│  │ الألوان: [ذهبي/أخضر ▾]                       │    │
│  │ [🏭 توليد الفيديو]                            │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**المميزات:**
- 3-5 frames ثابتة (مش فيديو حقيقي — slideshow)
- Frame 1: شعار المنصة + اسم السوق
- Frame 2: بيانات السهم (ticker + signal + entry + target + stop + R:R)
- Frame 3: شارت مبسط (area chart)
- Frame 4: أداء التوقعات (win rate + profit factor)
- Frame 5: disclaimer + شعار
- تصدير: صورة متحركة (GIF) أو slideshow MP4
- **لا يحتاج مكتبات ثقيلة** — يولد PNG لكل frame ثم يدمجها

### 17.3 المتطلبات التقنية

#### المرحلة 3أ (ممكنة الآن — أسبوع عمل):
1. **تقويم المحتوى**: جدول بسيط من `predictions.db` يعرض آخر المنشورات
2. **مولد الكروت**: دمج `ExecutiveReportView` + `StockInfographicCard` في واجهة موحدة
3. **محرر الفيديو**: slideshow بسيط (PNG frames → GIF)

#### المرحلة 3ب (تحتاج تخطيط أعمق):
1. **تقويم متقدم**: Drag & Drop + scheduling + cron integration
2. **محرر فيديو متقدم**: انتقالات + موسيقى + نص متحرك
3. **حملات إعلانية**: A/B testing + analytics + ROI tracking

#### المرحلة 3ج (مشروع منفصل — شهور):
1. **AI Video Generation**: توليد فيديو من نص (يحتاج API مدفوع)
2. **Social Media API Integration**: نشر مباشر على Facebook/Instagram/Twitter
3. **Campaign Analytics**: تحليل أداء الحملات + ROI

### 17.4 التقييم

| الطبقة | التعقيد | القيمة | التوصية |
|---|---|---|---|
| تقويم المحتوى | منخفض | عالية | ✅ ابدأ فورًا |
| مولد الكروت | متوسط | عالية جداً | ✅ ابدأ فورًا |
| محرر الفيديو (بسيط) | متوسط | متوسطة | ⏳ المرحلة التالية |
| محرر فيديو متقدم | عالي جداً | منخفضة (للمنصة الحالية) | ❌ مش أولوية |
| AI Video | عالي جداً | منخفضة | ❌ مشروع منفصل |

### 17.5 الخلاصة

المرحلة 3 **ممكنة** لكن تتقسم:
- **3أ** (تقويم + مولد كروت): ممكنة الآن — قيمة عالية + تعقيد منخفض
- **3ب** (محرر فيديو + حملات): تحتاج تخطيط — قيمة متوسطة
- **3ج** (AI + Social APIs): مشروع منفصل — ليس أولوية للمنصة الاستثمارية

**توصيتي**: ابدأ بـ 3أ (تقويم + مولد كروت موحد) — هذا أعلى ROI بأقل جهد.

---

## 18. Expert Analysis Engine

> **المصدر:** `07-EXPERT-ANALYSIS-ENGINE.md` (مُدمج كاملًا في هذا القسم).
> **تاريخ الإنشاء:** 2026-10-09
> **المنفذ:** Main Agent (Z.ai Code)
> **الهدف:** توليد تحليل احترافي شامل للسهم مثل خبير مالي حقيقي
> **الـ API:** `GET /api/stocks/[ticker]/expert-analysis`

### 18.1 الهدف

العميل "الصايع المعلم" محتاج يشوف تحليل احترافي يخليه يحس إنه بيتكلم مع خبير مذاكر السهم من كل الجوانب. المحرك ده بيوفر:

1. **تحليل فني شامل** — RSI, MA, S/R, 52w range مع تفسير
2. **تحليل أساسي عميق** — P/E, ROE, EPS, P/B, Dividend مع تقييم
3. **إدارة مخاطر** — Entry, Targets, Stop, R:R, Position size
4. **ملخص خبير** — توصية واضحة + الأسباب + التحذيرات
5. **تقرير منسق** — جاهز للعرض في الشاشة + التليجرام

### 18.2 بنية التحليل (ExpertAnalysis Interface)

```typescript
interface ExpertAnalysis {
  // Summary
  recommendation: string;        // STRONG_BUY | BUY | ACCUMULATE | HOLD | REDUCE | SELL | STRONG_SELL
  recommendation_ar: string;     // التوصية بالعربي
  confidence: number | null;     // 0-100

  // Entry / Targets / Stop
  entry: { price, rationale, rationale_ar };
  target1: { price, pct, rationale, rationale_ar };
  target2: { price, pct, rationale, rationale_ar };
  stopLoss: { price, pct, rationale, rationale_ar };
  riskReward: number | null;     // R:R ratio (≥2.0 = good)

  // Technical Analysis
  technical: {
    rsi: { value, signal, signal_ar, analysis, analysis_ar };
    movingAverages: { ma50, ma200, trend, trend_ar, analysis, analysis_ar };
    supportResistance: { support, resistance, analysis, analysis_ar };
    range52w: { high, low, position, position_ar, analysis, analysis_ar };
    summary, summary_ar;
  };

  // Fundamental Analysis
  fundamental: {
    peRatio: { value, rating, rating_ar, analysis, analysis_ar };
    roe: { value, rating, rating_ar, analysis, analysis_ar };
    eps: { value, analysis, analysis_ar };
    pbRatio: { value, rating, rating_ar, analysis, analysis_ar };
    dividend: { value, rating, rating_ar, analysis, analysis_ar };
    summary, summary_ar;
  };

  // Risk Assessment
  risk: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    level_ar: string;
    factors: string[];
    factors_ar: string[];
    positionSize: string;
    positionSize_ar: string;
  };

  // Expert Summary + Full Report
  expertSummary: string;
  expertSummary_ar: string;
  fullReport: string;       // English
  fullReport_ar: string;   // Arabic (formatted with markdown)
}
```

### 18.3 المنطق التقني

#### 18.3.1 RSI Analysis

| Range | Signal | التفسير |
|-------|--------|---------|
| ≥ 70 | OVERBOUGHT (تشبع شرائي) | السهم صعد كتير، خطر ارتداد |
| 55-70 | BULLISH (صاعد) | زخم صاعد صحي، مساحة للصعود |
| 45-55 | NEUTRAL (محايد) | تجميع، انتظر اختراق |
| 30-45 | BEARISH (هابط) | ضغط بيع، حذر |
| ≤ 30 | OVERSOLD (تشبع بيعي) | فرصة شراء عكسية محتملة |

#### 18.3.2 Moving Averages (Trend Detection)

| الحالة | الترند |
|-------|--------|
| price > MA50 > MA200 | STRONG_UPTREND (ترند صاعد قوي - Golden Cross) |
| price > MA50, MA50 < MA200 | RECOVERY (تعافي) |
| price < MA50, MA50 > MA200 | CORRECTION (تصحيح) |
| price < MA50 < MA200 | STRONG_DOWNTREND (ترند هابط قوي - Death Cross) |

#### 18.3.3 P/E Ratio Rating

| Range | Rating | التقييم |
|-------|--------|---------|
| < 10 | UNDERVALUED | مقوّم بأقل من قيمته |
| 10-20 | FAIR_VALUE | تقييم عادل |
| 20-35 | PREMIUM | تقييم مرتفع |
| > 35 | OVERVALUED | مقوّم بأكثر من قيمته |

#### 18.3.4 ROE Rating

| Range | Rating |
|-------|--------|
| ≥ 20% | EXCELLENT (ممتاز) |
| 15-20% | GOOD (جيد) |
| 10-15% | AVERAGE (متوسط) |
| < 10% | WEAK (ضعيف) |

#### 18.3.5 Dividend Yield Rating

| Range | Rating |
|-------|--------|
| ≥ 8% | VERY_HIGH (عائد عالي جداً) |
| 4-8% | ATTRACTIVE (جذاب) |
| 1-4% | MODEST (متواضع) |
| < 1% | MINIMAL (ضئيل) |

#### 18.3.6 Risk Assessment

| Risk Score | Level | Position Size |
|-----------|-------|---------------|
| ≥ 4 | HIGH | 0.5-1% من المحفظة |
| 2-3 | MODERATE | 1-3% من المحفظة |
| 0-1 | LOW | 3-5% من المحفظة |

عوامل المخاطر:
- RSI ≥ 70 أو ≤ 30 (+2)
- Beta > 1.5 (+1)
- Debt/Equity > 2 (+2)
- قرب قمة/قاع 52 أسبوع (+1)

#### 18.3.7 Entry / Targets / Stop Loss Logic
- **BUY signals**: target = resistance (>entry) أو entry * 1.10
- **SELL signals**: target = support (<entry) أو entry * 0.90
- **Stop Loss BUY**: support (<entry) أو entry * 0.95
- **Stop Loss SELL**: resistance (>entry) أو entry * 1.05
- **R:R**: (target - entry) / (entry - stop) — المستهدف ≥ 2.0

### 18.4 API Endpoint

```
GET /api/stocks/[ticker]/expert-analysis
```

**Response**:
```json
{
  "success": true,
  "ticker": "COMI",
  "analysis": { ... ExpertAnalysis ... },
  "generated_at": "2026-10-09T12:50:11.591Z"
}
```

> **التكامل الكامل + Migration لـ Python (P1-PARALLEL-ENGINES-FIX 2026-10-12):** مرجع `01-ARCHITECTURE_AND_API.md` §4.1 (Expert Analysis Engine — 859 LOC في `vps-service/analyzers/expert_analysis_engine.py`).

### 18.5 الملفات المرتبطة

| الملف | الوصف |
|-------|-------|
| `vps-service/analyzers/expert_analysis_engine.py` | المحرك الرئيسي (859 LOC — NEW 2026-10-12 per P1-PARALLEL-ENGINES-FIX) |
| `src/app/api/stocks/[ticker]/expert-analysis/route.ts` | API endpoint (pure proxy — GET + POST) |
| `src/lib/unified-stock-data.ts` | مصدر البيانات (technical + fundamental + prediction) |

> **الـ Migration (P1-PARALLEL-ENGINES-FIX 2026-10-12):** كان `src/lib/expert-analysis.ts` (882 LOC parallel Node engine — خرق Rule 20 + Rule 28). اتعمل port للـ logic كامل لـ Python (`expert_analysis_engine.py`) + الـ Node route اتحولت لـ pure proxy. الـ Node engine اتأرشف لـ `archive/engines/p1-parallel-engines-20261012/expert-analysis.ts.orphan`.

### 18.6 أمثلة النتائج

#### COMI (البنك التجاري الدولي)
```
التوصية: انتظار | Confidence: 48
السعر: 132.50 جنيه | القطاع: القطاع المالي

Entry:    137.86 | T1: 130.99 (-5.0%) | T2: 157.19 (+14.0%) | Stop: 143.37 (+4.0%)
R:R: 1.25

RSI: — (لا بيانات)
MA50: 132.49 | Trend: ترند صاعد قصير الأجل
Support: 132.39 | Resistance: 132.50 (قرب المقاومة)
52w: Low 132.39 | High 132.50 (قرب القمة)

ROE: 18% (جيد) | EPS: 5.77 (مكرر 23x) | P/B: 1.70 (معقول) | Div: 6.37% (جذاب)
Risk: منخفض | Position: 3-5% من المحفظة
```

#### ETEL (المصرية للاتصالات)
```
التوصية: شراء قوي | Confidence: 78.26
Entry: 93.94 | T1: 95.35 (+1.5%) | T2: 114.42 (+21.8%) | Stop: 93.0 (-1.0%)
R:R: 1.5

ROE: 15% | EPS: 3.42 | Div: 6.87% (جذاب)
Risk: منخفض
```

#### EKHO (الشرقية - إيسترن)
```
التوصية: شراء | Confidence: 61.2
Entry: 0.62 | T1: 0.65 (+4.8%) | T2: 0.78 (+25.8%) | Stop: 0.60 (-3.2%)
R:R: 1.5

RSI: 74.9 (تشبع شرائي!) ← عامل خطر
Risk: متوسط | Position: 1-3% من المحفظة
```

### 18.7 الاستخدام في الواجهة + التليجرام

#### في شاشة تفاصيل السهم
```tsx
const { data } = useQuery(['expert-analysis', ticker], () =>
  fetch(`/api/stocks/${ticker}/expert-analysis`).then(r => r.json())
);

// عرض التقرير الكامل
<pre className="whitespace-pre-wrap">{data?.analysis?.fullReport_ar}</pre>
```

#### في نشر التليجرام
```python
# python: استدعاء الـ API + نشر في القناة
response = requests.get(f"http://localhost:3000/api/stocks/{ticker}/expert-analysis")
analysis = response.json()["analysis"]
telegram_send(analysis["fullReport_ar"])
```

### 18.8 الحالة

- ✅ المحرك شغّال ومختبر على 5 أسهم (COMI, SWDY, ETEL, HRHO, EKHO, TMGH)
- ✅ lint: 0 errors
- ✅ API endpoint جاهز (pure proxy لـ Python بعد P1-PARALLEL-ENGINES-FIX 2026-10-12)
- ✅ التوثيق كامل
- ✅ Migration لـ Python مُكتمل (859 LOC في `expert_analysis_engine.py`)

**آخر تحديث:** 2026-10-09 → migrated to Python on 2026-10-12 (P1-PARALLEL-ENGINES-FIX)
**المنفذ:** Main Agent (Z.ai Code)
**الحالة:** ✅ جاهز للإنتاج

---

*هذا الملف هو مرجع الـ UI الكامل والمصدر الأوحد للحقيقة. أي إضافة/حذف شاشة أو مكوّن = تحديث هذا الملف فورًا + تحديث `audit_map.json` (عبر `scripts/audit_map.py`).*
*تم التوحيد بواسطة Documentation Unification Agent — Task ID `DOC-UNIFY-2-ARCH-SCREENS` — 2026-10-12.*
*المصادر المؤرشفة في `_archive_pre_unification_2026-10-12/`.*
