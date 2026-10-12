# 🖥️ 02 — دليل الشاشات والمكوّنات — GLMinvestment Frontend (Single Source of Truth)

> **هذا هو المصدر الأوحد للحقيقة (single source of truth) لكل شاشة وكل مكوّن** في الواجهة (Next.js 16 + React 18 + TypeScript). لكل عنصر: الحالة (نشط/ميت/مكرر)، الموقع، LOC، الوظيفة، الـ API المستدعى، والديون التقنية.
>
> **الهدف:** مرجع كامل لكل ما يخص الـ UI يمنع إنشاء شاشات/مكوّنات مكررة، ويوضّح ما هو نشط فعلًا على الإنتاج وما هو مرشّح للحذف.
>
> **آخر تحديث:** 2026-10-09 (Task `DOCS-UPDATE-OCT9` — Documentation Secretary — تحديث جراحي بـ عمل اليوم: sandbox reset #2 recovery + 3 syntax error fixes + Phase 1 CPU optimization + Phase 3 market segregation. ملخص التحديثات في هذا الـ pass:
> - **§0.9 NEW — Dead Components Archive (Oct 8-9)** — توثيق 10 dead components اتأرشفوا لـ `archive/dead-components-2026-10-08/` (Rule 16 NO-DELETION — archived مش مسح).
> - **§4.x MarketSelector supports 6 markets** — تحديث من 5 → 6 markets (EGX + TADAWUL + KSE + QSE + US + CRYPTO) + `normalizeMarket()` helper مُفعّل في كل الـ routes.
> - **§4.x EnhancedPortfolioView** — إضافة Market Badge (🏛️) قرب اسم كل سهم + auto-tag `stock_market` عند إضافة سهم جديد.
> Commits: `b18b3f21` (PHASE-3 market segregation) · `e8df798d` (PHASE-1 CPU) · `aca19f96` + `3a63bd04` + `d786b8d1` (syntax fixes). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق:** 2026-10-08 (Task `DOCS-UPDATE-FINAL` — Documentation Secretary — تحديث جراحي بعد جلسة الإنجاز الكاملة (Tasks `REAPPLY-CRITICAL-FIXES` + `CONSTITUTION-R75-R76` + `DISABLE-SCRIPTS` + `TIER3-ROUTES-MIGRATE` + fabrications cleanup + Python backend running على 8010 + `zero_conflict_test` improvement). ملخص التحديثات في هذا الـ pass:
> - **§0.8 NEW — Canonical Signal Migration (10/10)** — توثيق إكمال الترحيل الكامل للإشارات الكنسية على كل شاشات القرار النشطة + تدفق البيانات الكنسي + الـ 410 Gone deprecated endpoints + `zero_conflict_test.py` كآلية إنفاذ Rule 73.
> - إشارات لـ Rule 73 (SINGLE-DISPLAY-SOURCE) + Rule 74 (TICKER-COOLDOWN) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) — كلها اتضافت للدستور في commit `11853f69` (Task `CONSTITUTION-R75-R76`).
> Commits: `38665fd1` (REAPPLY+DISABLE-SCRIPTS) · `11853f69` (CONSTITUTION-R75-R76) · `64ee8d54` (zero_conflict_test --require-real-data). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق:** 2026-10-05 (Task `CALC-CONSOLIDATION-PHASE-1` + `BACKTEST-ANALYSIS` + `SCREENS-SURVEY-2026-10-05` — 3 sub-tasks in one session). **(1)** حذف `src/lib/cache/precomputed-cache.ts` (1010 LOC) — orphaned، صفر imports عبر `src/` (تم التحقق per Rule 16 VERIFY-BEFORE-DELETE). **(2)** STRIP-CALCS من `src/app/api/stocks/[ticker]/publish-data/route.ts` (حذف `computeRSI`/`sma`/`atr` — الـ `atr` كان **BUGGY**: SMA بدلاً من Wilder's smoothing → كان يfeeds قيم ATR خاطئة في الـ Telegram publish flow لما Python يكون unreachable). الـ route بيقوم بـ Python-first أصلاً عبر `fetchPythonPublishData`. في الـ SQLite fallback، المؤشرات دلوقت بتقرأ من `stocks.db.{rsi,ma_50,ma_200}` + `predictions.db.predictions.atr_at_entry` (مكتوبة upstream من Python canonical `analyzers/indicators/`). لو NULL → `undefined` + error string في `errors[]` (Rule 27: no fake data). **(3)** STRIP-CALCS من `src/app/api/portfolio/rescue/route.ts` (حذف `sma`/`ema`/`rsi` — كانت Wilder's فعلاً بس برضه duplicate). بقرأ من `stocks.db` pre-computed columns. `supportResistance` (pivot detection) + `weinsteinStage` (heuristic) اتفسخوا — دول analytics هيكلية مش canonical indicators. Commit: `bbbb6cbb` (pushed to `origin/main`). 6 TS files تانية لسه فيها duplicates (Phase 2/3 deferred — §15). **(4)** BACKTEST-ANALYSIS (§16): تحليل `scripts/output/backtest_4months_all_stocks.json` — 533 tickers / 25,978 trades / WR=47.1% / PF=1.43. **CRITICAL bug discovered**: 5 من top 10 winners هم SELL signals بـ +49% gains → الـ backtest بـ يحسب price returns WITHOUT applying signal direction. **3 tuning proposals**: (A) scoring (raise STRONG_BUY threshold + liquidity gate + per-ticker circuit breaker), (B) stop/target (ATR-based 1.5×ATR stop + trailing after +1R), (C) fix the SELL-signal backtest bug. **(5)** SCREENS-SURVEY-2026-10-05 (§17): inventory كامل من أرض الواقع — 53 hash views (23 active + 30 hidden/legacy) + 16 card components (8,903 LOC) + Telegram publishing integration (39 files، ~21,312 LOC across TS + Python). Per Rule 62 (Secretary updates docs after every task) + Rule 63 (commit + push) + README editing rule 1.)
>
> **آخر تحديث سابق:** 2026-10-01 (Task `WAVE-2-3-DOCS` — Documentation Secretariat catching up on backlog — Wave 2 (cleanup archived 121 frontend dead files + 16 dead shadcn UI primitives to `archive/wave-2-cleanup-2026-10-01/`) + Wave 3 (#learning screen archived to `archive/education-duplicate-2026-10-01/`, #academy is now SINGLE education screen + content/education/*.md wired into AcademyView's 5th tab "🎓 دروس متقدمة" + MarketAnalysisView reduced from 6,450 LOC to 297 LOC orchestrator with 5 tabs + 5 radar tabs MOVED from MarketAnalysisView → MakerRadarTab as sub-tabs + LearningView archived). See §0.5 + §0.6 for the Wave 2/3 deltas. Per Rule 62 (Secretary updates docs after every task) + README editing rule 1 (last-updated + changelog row in-file).)
>
> **آخر تحديث سابق:** 2026-09-30 (DOC-CONSOLIDATION pass by Documentation Secretary + Senior Engineers: توحيد نهائي لكل ملفات التوثيق — 134 ملف (7.9MB) consolidated إلى 5 ملفات canonical: الـ 4 cornerstones + `05-CURRENT_STATE.md` (NEW). حذف شامل لكل الملفات غير الأساسية عبر `git rm`. لم تُحذف أي محتويات من هذا الملف — هذا تحديث metadata فقط. الـ education files (9 ملفات) اتـ moved لـ `content/education/`.)
>
> **آخر تحديث سابق:** 2026-09-30 (REORG-PHASE-7-DOCS pass: إضافة §0.4 جديد "Module Mapping (2026-09-30)" — خرائط كل hash view للموديول بتاعه في `src/modules/<module>/`. تحديث عدّاد الـ components 285 → 285 (no new components — Rule 4: NO new screens). مرجعية لـ `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` + Rule 60 (MODULE-SYSTEM). لم تُحذف أي محتويات.)
> **آخر تحديث سابق:** 2026-09-27 (DOC-UPDATE-P0-WAVE pass: تحديث §0 Screen Status Rollup — إضافة P0 Wave notes (3 orphan tabs wired: LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab داخل `MarketAnalysisView` + help modal persistence fix 30-day expiration + radar §15 signal-tracker auto-record + 30 admin routes secured + 7 SQLi sites patched + 70 sync I/O refactored + observability stack (Sentry + logger + /api/health + x-request-id) + 6 test files / 46 new test cases + middleware edge-runtime regression fixed). تحديث عدّاد الـ components لـ 285 (was 282 — +3 wired tabs).)
> **آخر تحديث سابق:** 2026-09-26 (DOC-UPDATE-FINAL pass: تحديث §0 Screen Status Rollup — إضافة UnifiedTable upgraded (expandable rows + column toggle + filtering + toolbar) + Phases A/B/C/D (multi-market `market_code`، Liquidity primary gate، 20+ thresholds → `get_setting()`، A/B backtest harness) + تحديث عدّاد الـ components لـ 282.)
> **آخر تحديث سابق:** 2026-09-25 (DOC-CONSOLIDATION pass: إضافة §0 شاشة الحالات المُجمَّعة (Screen Status Rollup) + تحديث عدّادات §1 — 274 component، 653 API route، 5-market + UI-Mirror + SQLite fallback).
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

## 0. شاشة الحالات المُجمَّعة (Screen Status Rollup — 2026-09-27 — DOC-UPDATE-P0-WAVE)

> **الهدف:** لقطة سريعة لحالة كل شاشة رئيسية في النظام. الحالات: ✅ working · ⚠️ partial · ❌ broken · 🚫 deprecated.
> التفاصيل الكاملة لكل شاشة في §4 (الـ views) و §9 (الـ admin).

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

**الإحصائيات الإجمالية (2026-10-04 — Wave 8 Update — Task 28-C):**
- Next.js page routes: 20 (9 نشطة · 9 ميتة · 2 redirect) · **+1 NEW hash view `#sharia` (Wave 8 Task 23-C)**
- Next.js API routes: **411 route.ts** (Wave 8 update — was 380 in Wave 2/3; Wave 8 Task `774a208` restored 32 Flutter API endpoints archived by mistake in Wave 2) · 257 proxy لـ Python · ~331 direct · 163 tiny-proxy boilerplate · **30 route تم تأمينها بـ auth (P0-11-AUTH)** · **7 SQLi sites تم fix (P0-12-SQLI)** · **24 route تم تحويلها لـ async I/O (P0-14-ASYNC)**
- Hash views في `page.tsx`: 46 (~36 نشطة · ~10 legacy/hidden/alias) — was 45 (added `#sharia`)
- React components: **250 tsx** (was 247 in Wave 2/3 — +3 Sharia components: `ShariaView.tsx` + `ShariaBadge.tsx` + `ShariaStockCard.tsx` — Task 23-C) + 24 ts (non-tsx) = 274 total under `src/components/` + `src/modules/`
- **Color system (NEW — Wave 8 — Task 24 — 6 commits):** Emerald-600 (`hsl(160, 84%, 39%)` ≈ `#10B981`) — was 0% saturation grayscale. Compliance: Rule 29 (NO-HYPE — alpha ≤ 0.15) + Rule 30 (CLIENT-FACING-STYLE — no blue/indigo).
- **Typography (NEW — Wave 8 — Task 24):** Cairo font + tabular figures (`font-feature-settings: 'tnum' 1, 'cv01' 1` + `font-variant-numeric: tabular-nums`) for price column alignment.
- **Card shadows (NEW — Wave 8 — Task 24):** dual-layer box-shadow + opt-in `card-hover` lift effect (translateY(-1px) + emerald border tint hsl(ring)/0.35) + body emerald radial gradient (alpha 0.05 light / 0.08 dark — Bloomberg-terminal feel).
- UI primitives المستخدمة: 49 (29 مستخدمة بكثرة + 20 orphan)
- مكوّنات orphan (dead): 71 (50,442 LOC ميتة — 26.6%)
- Flask Blueprints: 53 registered (33 DEPRECATED api files ~17,000 LOC)
- **Test files / cases (post P0-16-TESTS):** 9 files / 121 tests / 1,796 LOC (was 3/75/873 — +6 files / +46 tests / +923 LOC) — 121/121 passing
- **Observability (NEW):** Sentry + structured logger + deep-check /api/health (262 LOC) + x-request-id middleware

### 0.1 UnifiedTable Upgrade (2026-09-26 — DOC-UPDATE-FINAL)

> **المرجع الدستوري:** القاعدة 54 (UNIFIED-TABLE-UPGRADE — 2026-09-26) + القاعدة 52 (UNIFIED-REUSABLE-COMPONENTS — 2026-09-25).
>
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

**حصر الشاشات التي تحتاج ترحيل (21 شاشة):** مدرجة بالتفصيل في §10 (Dead/Duplicate Inventory) — كل الشاشات التي لا تزال تستخدم `<Table>` اليدوي من shadcn/ui. الترتيب: شاشات الـ admin أولاً (لأنها الأعلى استفادة من الـ features الجديدة)، ثم شاشات العميل.

### 0.2 Phases A/B/C/D — Engine Upgrades (2026-09-26 — DOC-UPDATE-FINAL)

> **المرجع المنطقي:** `SYSTEM_HOW_IT_THINKS.md` (Production Snapshot table — محدّث 2026-09-26).

| Phase | الوصف | التفاصيل الفنية | الحالة |
|---|---|---|---|
| **A — Multi-Market Support** | V40.2 يدعم `market_code` parameter لكل الأسواق الخمسة | `market_code ∈ {EGX, KSA, KSE, QSE, CRYPTO}` — يُمرَّر في `analyze_single_day_v393()` + `daily_predictor.py`. كل سوق يقرأ من DB المناسب له (§1.6 في `01-PROJECT_ANATOMY.md`). | ✅ منفّذ |
| **B — Liquidity Primary Gate** | فلتر السيولة أصبح **البوابة الرئيسية** قبل التحليل | `liquidity_filter.py` يشتغل **قبل** `analyze_single_day_v393()` — أي سهم لا يجتاز السيولة لا يدخل التحليل أصلاً (توفير compute + تحسين جودة الـ predictions). | ✅ منفّذ |
| **C — Dynamic Thresholds** | 20+ hardcoded thresholds أصبحت ديناميكية | استبدال كل `if x > 0.05` بـ `get_setting('threshold_name', default)` من `engine_settings` table — كلها قابلة للتعديل من Admin UI بدون redeploy. القائمة الكاملة في `SYSTEM_HOW_IT_THINKS.md`. | ✅ منفّذ |
| **D — A/B Backtest Harness** | نظام A/B backtest لقياس الأثر الفعلي لكل تغيير | `vps-service/backtest_results/` يحتوي على `ab_backtest_baseline_*.json` (saved baseline) + diff runs قبل/بعد أي phase. يستخدم للتحقق من عدم كسر feature قائمة عند ترحيل UnifiedTable أو أي phase من A/B/C. | ✅ منفّذ |

**Baseline محفوظ (2026-09-26):** `ab_backtest_baseline_*.json` يحتوي على:
- Win Rate: **67.4%** (1,229 resolved predictions) — ملاحظة: هذا الـ baseline على الـ recorded status؛ الـ WR الفعلي بعد HELI-CLEANUP-2 حوالي ~50–55% (راجع `SYSTEM_HOW_IT_THINKS.md` Production Snapshot)
- Avg Return: **25.74%**
- Profit Factor: **12.84**
- Max Loss Streak: **7**
- أي تغيير لازم يقاس ضد هذا الـ baseline قبل/بعد.

### 0.3 P0 Wave 2026-09-27 — Security + Observability + Tests (NEW — DOC-UPDATE-P0-WAVE)

> **المرجع:** `worklog.md` entries `P0-12-SQLI` + `P0-17-RECONCILE` + `P0-7-15-INFRA` + `P0-14-ASYNC` + `P0-11-AUTH` + `HELI-INVESTIGATION` + `HELI-CLEANUP-2` + `P0-8-DB-UNIFY` + `P0-16-TESTS` + `00-CONSTITUTION.md` Rules 55–59 (P0-WAVE-SECURITY / SQLI / ASYNC / OBSERVABILITY / TESTS).

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

**ب. Radar (§15 — SYSTEM_HOW_IT_THINKS.md) — signal-tracker auto-record:**

| المكوّن | التغيير | الحالة |
|---|---|---|
| `src/lib/radar-signal-tracker.ts` | signal-tracker دلوقتي بـ auto-record على كل warmup (كان manual-trigger فقط). كل الـ maker_radar runs بـ يـ write لـ `radar_signal_tracking` table تلقائياً. | ✅ منفّذ |
| 6 radar features (مدموجة في §15) | 5 endpoints (entry-timing + footprint + sector-treemap + signal-tracker + signal-tracker/verify) + 1 pipeline موصول (V40.2 maker_radar pipeline) — كلها مُنفَّذة في `SYSTEM_HOW_IT_THINKS.md` §15.0 → §15.14 | ✅ منفّذ |

**ج. Observability (لا UI مباشر — backend-only لكن بيأثّر على الـ admin):**

| المكوّن | الأثر على الـ UI | الحالة |
|---|---|---|
| `/api/health` deep-check | الـ admin بـ يـ fetch الـ health كل 30s — دلوقتي بيرجع `status + components.databases + nextjs + disk` بدل مجرد "ok" | ✅ منفّذ |
| `x-request-id` middleware | كل HTTP response فيه header `x-request-id` — debug أسرع للـ production issues | ✅ منفّذ |
| Sentry | الـ client-side errors بـ تـ auto-capture + session replay (10% prod / 100% on error) | ✅ منفّذ |

**د. Tests (لا UI مباشر — quality gate):**

| المكوّن | الحالة |
|---|---|
| 9 test files / 121 tests / 1,796 LOC | ✅ 121/121 passing — quality gate على كل commit |
| Test philosophy: READ-ONLY DB + live HTTP fetch (auto-skip لو server مش شغال) | ✅ adopted |

---

### 0.4 Module Mapping (2026-09-30 — NEW — REORG-PHASE-7-DOCS)

> **المرجع الدستوري:** Rule 60 (MODULE-SYSTEM — 2026-09-30) في `00-CONSTITUTION.md` + `05-CURRENT_STATE.md` §1 (Module Architecture). (ملفات `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` تم دمجها في `05-CURRENT_STATE.md` §1 في DOC-CONSOLIDATION 2026-09-30.)
>
> **القاعدة:** كل شاشة دلوقتي بت pertence لموديول في `src/modules/<module>/`. الـ components الـ legacy لسه في `src/components/<domain>/` (يُفضّل ترحيلها في P1).

| Hash View | Module | Notes |
|---|---|---|
| `#stocks` | `modules/stock-analysis/` | StockDetail + ComprehensiveStockAnalysis + StocksView + StockSelector + ... |
| `#recommendations` | `modules/market-analysis/` | MarketAnalysisView + PersonaTab + PredictionsTab + SectorTrackingTab + LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab + ... (11 tabs) |
| `#liquidity-radar` | `modules/predictions/` (MakerRadarTab) + `modules/radar/` (ExitRadarTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab) | Wired in Phase 4.1 — 3 radar tabs in MarketAnalysisView |
| `#picks-management` | `modules/predictions/` | PicksManagementView — `hunter_pick_tracking` populated (P0 fix #2) |
| `#portfolio` | `modules/portfolio/` | EnhancedPortfolioView + RoboAdvisorPanel + AdvancedPortfolioManager + BagHolderRescuePanel + RiskProfilerQuiz + ... (15 components) |
| `#watchlist` | `modules/portfolio/` | Shares module with portfolio — multi-portfolio selector |
| `#crypto` (8 sub-views → 4 live بعد ORPHAN-GARAGE-COLLECTOR 2026-10-12) | `modules/crypto/` | ~~`CryptoTradingChartView`~~ 🗑️ **محذوف/أرشيف** (archive/dead-components-20261012/) + ~~`CryptoAdditionalViews`~~ 🗑️ **محذوف/أرشيف** + ~~`CryptoAdvancedAnalysisView`~~ 🗑️ **محذوف/أرشيف** + ~~`CryptoScreenerView`~~ 🗑️ **محذوف/أرشيف** + `CryptoPredictionTrackingView` (live) + `CryptoSimulationView` (live) + `CryptoLearningView` (live) + `CryptoPortfolioView` (live) |
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

> **NOT yet moved (P1 follow-up):**
> - `src/components/memory/TradingMemoryView.tsx` → مستهدف لـ `modules/portfolio/` (لأنه imports 2 portfolio components).
> - `src/components/auth/` + `src/components/settings/` + `src/components/zakat/` + `src/components/layout/` (cross-cutting — مستهدف لـ `src/shared/`).
> - `src/components/shared/` + `src/components/ui/` (51 shadcn primitives + UnifiedTable + ErrorBoundary + SafeWidget + ...) — مستهدف لـ `src/shared/`.

> **Module count summary (verified 2026-10-01 — Task WAVE-2-3-DOCS):**
> - Frontend modules في `src/modules/`: **17** (radar + publishing + personalized + stock-analysis + predictions + portfolio + screener + market-analysis + news + admin + crypto + education + reports + dashboard + simulation + subscription + auth) — unchanged by Wave 2/3.
> - Backend module placeholders في `vps-service/modules/`: **9** (radar + predictions + market_regime + market_data + telegram + ai + portfolio + admin + root).
> - الـ components الكلية (active): **247** (verified via `find src/components src/modules -name "*.tsx" | wc -l` — was 297 pre-Wave-2; Wave 2 archived 51 dead .tsx files + 16 dead shadcn UI primitives = 67 files; Wave 3 archived 3 more (#learning screen files) to `archive/education-duplicate-2026-10-01/`).

### 0.5 Wave 2 Cleanup Delta (2026-10-01 — NEW — WAVE-2-3-DOCS)

> **Source:** worklog.md Tasks `6-A2` (Frontend discovery) + `7-A` (Frontend execution). See `05-CURRENT_STATE.md` §13 for the full Wave 2 summary.
>
> **Owner directive:** "التناسق وعدم التكرار" — archival (NOT deletion) of all dead/duplicate files.

**121 frontend dead files archived to `archive/wave-2-cleanup-2026-10-01/`** (NOT deleted — owner directive — recoverable if any caller is later discovered in production):

| Category | Files | LOC | Examples |
|---|---|---|---|
| shadcn UI primitives (tree-shaken, never imported) | 16 | 2,961 | `aspect-ratio.tsx`, `calendar.tsx`, `carousel.tsx`, `command.tsx`, `context-menu.tsx`, `drawer.tsx`, `menubar.tsx`, `pagination.tsx`, `sidebar.tsx`, `toaster.tsx`, ... |
| Legacy dead components | 12 | 3,868 | `CandlestickWidget.tsx`, `FibonacciWidget.tsx`, `DevilsAdvocatePanel.tsx`, `NotificationBell.tsx`, `AIView.tsx`, `OpportunityCard.tsx`, `PerformanceTracker.tsx`, `RecommendationHistory.tsx`, `RecommendationMonitoring.tsx`, `SocialPostView.tsx`, `PublishedPredictions.tsx`, ... |
| Admin module dead (per AdminView.tsx FIX-P3-P5-P6 Group P6 Fix 7 comments) | 14 | 6,243 | `AdGeneratorTab.tsx`, `ContentStudioHub.tsx` (LATER RESTORED — false-positive in 6-A2; lazily imported by MarketingStudio), `MarketingHub.tsx` (LATER RESTORED), `VideoEditor.tsx` (LATER RESTORED), `HumanRecommendationsAdmin.tsx`, `SectorClassificationAdmin.tsx`, `GoldSilverTab.tsx`, `NotebookAdminTab.tsx`, `MultiMarketTab.tsx`, `ForexTab.tsx`, `DataEngineTab.tsx`, `CryptoAdminPanel.tsx`, `CryptoPredictionGenerator.tsx`, `OptimizerParamsPanel.tsx`, `RowEditorModal.tsx`, `SystemTopologyTab.tsx`, `SystemTopologyGraph.tsx`, `live-chart/index.tsx` |
| Frontend remaining | 7 | 2,077 | `PicksManagementView.tsx` (1,063 LOC — page.tsx:160 comment said "merged into PredictionTrackingView" but file still existed; archived), `SectorPieChart.tsx`, `SectorTreemapCard.tsx` (standalone — the live one is inline in RadarStatsCards.tsx:335), `RiskManagementBar.tsx`, `UnifiedHoldingsTable.tsx`, `PositionDeepDiveDrawer.tsx`, `UpsellToasts.tsx` |
| Frontend lib TS | 18 | 3,141 | `api-cache.ts`, `api-config.ts`, `auto-seed-stocks.ts`, `build-trigger.ts`, `candlestick-patterns.ts`, `db-helpers.ts`, `patch-html2pdf.ts`, `pick-formatter.ts`, `prediction-validator.ts`, `seed-subscription-pricing.ts`, `seed-virtual-investor.ts`, `sqlite-compat.ts`, `use-engine-updates.ts`, `use-undo-redo.ts`, `cache/data-freshness.ts` (LATER RESTORED — false-negative grep), `cache/api-cache.ts` (LATER RESTORED), `devil/market-mood.ts`, `expert/expert-filter.ts` |
| TOTAL archived | 67 files (.tsx + .ts) + 16 shadcn + 12 legacy + 14 admin + 7 remaining + 18 lib TS = 67 (some overlap counted) → **121 total when counting all frontend files** | ~21,335 LOC | (Wave 2 archived to `archive/wave-2-cleanup-2026-10-01/src/components/` + `src/modules/` + `src/lib/`) |

**6 false positives caught + skipped (kept alive per Rule 16 VERIFY-BEFORE-DELETE):**
1. `ContentStudioHub.tsx` (886 LOC) — lazily imported by `MarketingStudio.tsx:25`
2. `MarketingHub.tsx` (503 LOC) — lazily imported by `MarketingStudio.tsx:26`
3. `VideoEditor.tsx` (653 LOC) — lazily imported by `MarketingStudio.tsx:24`
4. `telegram_target_hit_tracker.py` (1,012 LOC) — confirmed LIVE via auto_post_scheduler.py:1524 → PM2 telegram-poster → telegram_bp at lightweight_server.py:73
5. `jobs/fetch_corporate_actions.py` (292 LOC) — cron-driven per crontab.txt:53
6. `jobs/hot_candidate_detector.py` (299 LOC) — cron-driven per crontab.txt:150

**HTTP 500 restore:** `src/lib/cache/api-cache.ts` + `src/lib/cache/data-freshness.ts` were restored post-deletion when dynamic callers (Next.js `next/dynamic` imports) were discovered — commit `2529dba`. Lesson: caller-grep must include dynamic-import patterns.

**Barrel + comment side-cleanup:** 4 barrels (`src/components/ai/index.ts`, `src/modules/admin/index.ts`, `src/modules/predictions/index.ts`, `src/modules/portfolio/index.ts`) + 5 comment blocks in AdminView.tsx + 1 comment in page.tsx + 1 comment in smart-confluence/route.ts updated to reflect deletions (avoid stale "REMOVED" comments).

**Commits (4 frontend sub-batches + 3 backend + 1 restore + 1 archive-restore):**
- `4796647` cleanup(frontend): delete 16 dead shadcn UI primitives (2,961 LOC)
- `6f89c61e` Batch 1 (frontend legacy 12 files / 3,868 LOC)
- `f592f45d` Batch 2 (frontend admin 14 files / 6,243 LOC + 3 skipped false-positives)
- `f1eec20f` Batch 3 (frontend remaining 7 files / 2,077 LOC)
- `358e2aa4` Batch 4 (frontend lib TS 18 files / 3,141 LOC)
- `2529dba` fix(critical): restore 2 lib files deleted by false-negative grep (dynamic imports)
- `1b8166b` docs(counts): update stale component/route counts post-Wave-2 cleanup
- `d47810b` archive(restore): recover 313 deleted API routes to archive/ folder
- `4212242` archive(restore): recover 123 deleted frontend+backend files to archive/

### 0.6 Wave 3 Consolidation Delta (2026-10-01 — NEW — WAVE-2-3-DOCS)

> **Source:** worklog.md Tasks `9-A` (Education Unification) + `9-B` (Recommendations Consolidation) + 6 i18n Phase 1 commits. See `05-CURRENT_STATE.md` §14 for the full Wave 3 summary.
>
> **Owner directive:** "unify duplicate education screens + reduce #recommendations noise + fix broken PersonalizedRadarTab + continue i18n migration to 100%."

**Wave 3 changes to screens/components:**

| Change | Detail | Commit |
|---|---|---|
| `#learning` screen ARCHIVED | `LearningView.tsx` (1,063 LOC) + `learning-content.ts` (440 LOC) + `learning-store.ts` (365 LOC) → `archive/education-duplicate-2026-10-01/` (Rule 63.2 — archived not deleted per owner directive) | `e07cb18` |
| `'learning'` view removed from VALID_VIEWS + AppView type union + AuthGate.PROTECTED_VIEWS | Removed from 7 wiring points: TopBar nav + MobileMoreSheet nav + page.tsx switch + page.tsx dynamic import + valid-views.ts VALID_VIEWS + valid-views.ts CRYPTO_VIEW_REDIRECTS (now redirects to `academy` instead of `learning`) + types/index.ts AppView union + AuthGate.tsx | `e07cb18` |
| `#academy` is now the SINGLE canonical education screen | Was 73 LOC wrapper → now 717 LOC (added 5th tab + AdvancedLessonsTab + AdvancedMarkdownRenderer inline) | `d95904a` |
| `content/education/*.md` wired into AcademyView | Runtime fetch via existing `/api/ads/educational-lessons` API — 12 institutional-grade lessons surfaced in user-facing UI (was admin-only orphan before) | `d95904a` |
| MarketAnalysisView (`#recommendations`) reduced | Was ~6,450 LOC with 10 main tabs + 3 sub-views = 13 views → now **297 LOC orchestrator with 5 main tabs** (predictions + status + sectors-tracking + historical-trades + net-picks) | `176c301` + `077116f` |
| 5 radar tabs MOVED from MarketAnalysisView → MakerRadarTab as sub-tabs | ExitRadarTab + WeeklyReportTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab now rendered inside `#liquidity-radar` MakerRadarTab as 6 sub-tabs (maker default + 5 moved) | `077116f` |
| NetPicksTab duplicate render DELETED from MakerRadarTab | Was at MakerRadarTab.tsx:1213 (rendered twice — once in #recommendations + once in #liquidity-radar); now exists only at MarketAnalysisView.tsx:262 | `077116f` |
| PersonalizedRadarTab bug FIXED | `personalization_reason: string` (singular) → `personalization_reasons: string[]` (plural) + full pick shape (base_score + personalized_score + sector + adjusted_position_size) + real profile fields computed from portfolio_assets (preferredTickers + preferredPriceRange + averageHoldingDays + holdingPeriodCategory + riskProfile) + `hasTradeHistory: false` flag (UI conditionally hides trade-stats until real per-user trade-history table is wired) | `cd53a63` |
| StockDetailDrawer Dialog moved OUTSIDE Tabs | Moved to top-level `<div className="space-y-4">` so it stays mounted across all 6 sub-tabs (shadcn Tabs unmounts inactive TabsContent by default — Dialog would have been unmounted along with the maker sub-tab if user switched tabs while open) | `077116f` |

**i18n Phase 1 (5 components newly migrated to useTranslation — 6 commits):**

| Component | Strings migrated | Commit |
|---|---|---|
| MarketAnalysisView | 12 strings | `176c301` (+ `4f2c3d8` for ar/en keys) |
| StocksView | 50 strings | `46c421f` |
| EnhancedWatchlistView | 30 strings | `af2eee8` |
| EnhancedPortfolioView | 40 strings | `06dedd7` |
| AlertsCenterView | 25 strings | `c9e8884` |

**messages/ar.json + messages/en.json:** 130 LOC → **460 LOC each** (+330 LOC across 5 components).

**Components using `useTranslation()`:** 7 → **12 files** (5 earlier from I18N-FULL-100 + 5 Wave 3 Phase 1 + Providers.tsx wrapper + i18n-context.tsx hook itself).

### 0.7 Sharia Module + Wave 8 Visual Redesign + Admin Tabs (NEW — Wave 8 — Task 28-C — 2026-10-04)

> **Source:** worklog.md Tasks `23-C` (Sharia UI) + `24` (Visual Polish) + `27-B` (Admin Panel Audit) + commit `f413bd7` (Sharia admin tab). See `05-CURRENT_STATE.md` §17 for the full Wave 8 summary.

**A. Sharia Module (3 NEW components — Task 23-C — commits `324a095` + `704aa0c`):**

| Component | LOC | File | Purpose |
|---|---|---|---|
| `ShariaView` | — | `src/modules/sharia/components/ShariaView.tsx` | Standalone `#sharia` screen — Islamic-financial aesthetic (emerald + gold + geometric pattern overlay). 3 tabs: (1) 253-stock list with search + consensus-only filter + status chips + sources legend + 24/page pagination + per-stock detail modal showing 8-source breakdown; (2) single-trade purification calculator → POST `/api/sharia/purification` (symbol, quantity, buy/sell price, method S&P/musaffa/kashif/osoul, capital-gain toggle); (3) portfolio purification calculator (user_id input). |
| `ShariaBadge` | — | `src/modules/sharia/components/ShariaBadge.tsx` | Compact emoji badge (🟢 compliant / 🔴 non_compliant / 🟡 doubtful / ⚪ unknown) + Popover with purification rate, 8-source breakdown, compliant count, price, CTA to open `#sharia`. Per-ticker in-memory cache (Map) with pub/sub so multiple badges share ONE network call per ticker. |
| `ShariaStockCard` | — | `src/modules/sharia/components/ShariaStockCard.tsx` | Full Card variant with metrics grid + sources table + purification rates list + CTA button. For drawer/panel use. |

**Wiring:**
- `src/types/index.ts` (AppView union includes `'sharia'`)
- `src/lib/valid-views.ts` (VALID_VIEWS includes `'sharia'`)
- `src/app/page.tsx` (lazy import + case `'sharia'` returns `<ShariaView />`)
- `src/components/layout/TopBar.tsx` (nav entry 'التوافق الشرعي' — ShieldCheck icon, highlighted)
- `src/components/layout/MobileMoreSheet.tsx` (mobile quick-access entry)
- `ShariaBadge` integrated into `StockDetail.tsx` + `PersonaTab.tsx` + `MakerRadarTab.tsx` (all gated to EGX market)
- Module index `src/modules/sharia/index.ts` exports `ShariaView` + `ShariaBadge` + `ShariaStockCard` + `useShariaDetail` + `deriveShariaSummary`

**B. Visual Redesign (6 commits — Task 24 — emerald theme):**

| Step | Commit | File | Change |
|---|---|---|---|
| 1 | `e8ba231` | `src/app/globals.css` | Light: `--primary` 0% 4% → `160 84% 39%` (emerald-600); `--accent` → `160 50% 95%`; `--ring` → `160 84% 39%`; `--chart-1..5` → emerald/teal/amber/orange/lime (no blue/indigo). Dark: `--background` → `160 5% 6%` (emerald-tinted, not pure black); `--card` → `160 5% 9%`; `--border` → `160 5% 18%`. Added `--success` (142 76% 36%) + `--warning` (38 92% 50%) + `--danger` (0 72% 51%) + dark variants. `--radius` 0.625rem → 0.75rem. |
| 2 | `10023ce` | `src/app/globals.css` | Body font-family: system-ui → `'Cairo'` (primary), system-ui fallback. Body: `font-feature-settings 'tnum' 1, 'cv01' 1, 'cv03' 1` + `font-variant-numeric: tabular-nums` (column-aligned prices/P&L). Headings h1-h6: `letter-spacing: -0.02em`. Added `.tabular-nums` utility class. |
| 3 | `b2eb109` | `src/app/globals.css` | `[data-slot=card]`: dual-layer box-shadow (light: `0 1px 3px + 0 1px 2px`; stronger shadows in dark). Transition: `box-shadow + transform + border-color` (0.2s ease). New `.card-hover` utility: opt-in lift effect (`translateY(-1px)` + emerald border tint `hsl(ring)/0.35` on hover). Body: subtle emerald radial gradient at top (alpha 0.05 light / 0.08 dark). |
| 4 | `3abda17` | `src/app/page.tsx` (AuthView wrapper) | AuthView wrapper bg replaced with `bg-gradient-to-br from-emerald-50 via-background to-emerald-50/30` (light) / `from-emerald-950/25 via-background to-background` (dark). Subtle emerald dot-grid pattern overlay (opacity 0.025 light / 0.05 dark). Bot_link banner: `bg-primary/5 → bg-card + ring-1 ring-primary/10 + shadow-[0_4px_24px_rgba(0,0,0,0.06)]` for elevation. |
| 5 | `ce9ff97` | `src/components/layout/TopBar.tsx` | Header: `bg-background/95 → bg-background/80 + backdrop-blur-md + border-border/80 + shadow-[0_1px_0_0_hsl(primary)/0.06]` (subtle emerald accent line). Theme toggle: `transition-colors → transition-all + hover:border-primary/30 + hover:shadow-sm + focus-visible:ring-2 ring-ring`. Login button: added `shadow-sm + hover:shadow-md + active:scale-[0.98] + focus-visible` ring (a11y). User avatar button: same hover + shadow treatment. User avatar badge: added `ring-2 ring-primary/20` (subtle emerald halo). |
| 6 | `fc90fa4` | `src/app/globals.css` | `[data-slot=button]`: unified transition (bg/border/color/box-shadow 0.15s ease + transform 0.1s ease). `[data-slot=button]:active → transform: scale(0.98)` (tactile press). Secondary/outline buttons: hover → emerald-tinted border `hsl(ring)/0.4` (primary + destructive variants excluded to preserve their identity). `[data-slot=input]` + textarea + native inputs: transition border+shadow+bg. `focus-visible`: emerald glow (border `ring/0.6` + dual box-shadow halo `hsl(ring)/0.15 + hsl(ring)/0.08`). |

**Compliance:** Rule 29 (NO-HYPE) — alpha ≤ 0.15 throughout, no neon. Rule 30 (CLIENT-FACING-STYLE) — no blue/indigo used. Rule 63 — 6 commits pushed.

**C. Admin Tabs — 4 P0 NEW (Task 27-B audit identified as MISSING — first one executed in commit `f413bd7`):**

| # | Admin tab | Status | Commit | Note |
|---|---|---|---|---|
| 1 | **Sharia management** | ✅ EXECUTED (commit `f413bd7`) | `f413bd7` | Trigger `sharia_compliance_scraper.py` manually + view `review_queue` (alias_map) + edit EFG↔HRHO symbol mappings + see last_scrape timestamp per source. Backend exists (`sharia_compliance_scraper.py` + 5 DB tables per Rule 64). |
| 2 | **Source Authority** | ⏳ PENDING | — | View `CANONICAL_SOURCES` per market + toggle `BANNED_SOURCES` state + see `write_guarded()` rejections log. Backend exists (`source_authority.py` per Rule 66). |
| 3 | **Validation Monitor** | ⏳ PENDING | — | Count of stocks with INVALID fields per field name + drill-down to ticker list + view `ValidationFinding.reason` + audit trail of nullified fields. Backend exists (`validation.py` per Rule 65). |
| 4 | **Cron Health dashboard** | ⏳ PENDING | — | Surface `/api/admin/system-health` into `AdminView` + show `last_run`/`exit_code` for all 25 crontab jobs + manual "run cron now" buttons. |

Plus 6 more P0 admin features pending in Task 27-B (paywall pricing editor + conversion funnel + news source health + multi-source conflict viewer + Telegram published-predictions audit + trial cleanup wiring into new user-management tab). See `05-CURRENT_STATE.md` §17.6 for the full list.

---

### 0.8 Canonical Signal Migration — 10/10 Decision-Screens الآن canonical (NEW — Task `REAPPLY-CRITICAL-FIXES` + `FINALIZE-UNIFICATION`/`UNIFIED-API-V3`/`TRADING-CHART-V60.2` — 2026-10-08)

> **المرجع الدستوري:** Rule 20 (PYTHON-IS-THE-BRAIN) + Rule 27 (NO-FAKE-DATA) + Rule 67(b) + Rule 72 (UNIFIED-DATA-CONTRACT) + **Rule 73 (SINGLE-DISPLAY-SOURCE)** + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW). Rule 73 اتضافت للدستور في commit `11853f69` (Task `CONSTITUTION-R75-R76` — 2026-10-08).
>
> **الهدف:** إنهاء كارثة "نفس السهم = بيانات مختلفة على 5 شاشات + التليجرام". قبل Rule 73، كان فيه 5 صيغ مختلفة لـ accumulation label + 5+ صيغ fallback لـ support/resistance + 3 صيغ RSI (Wilder صح، SMA خاطئ، EMA بـ seed مختلف) + 4 أنظمة thresholds مختلفة لـ signal classification + 4 taxonomies مختلفة لـ phase كلها اسمها "phase" + 3 routes بـ fabricate `target_price_2 = target1 * 1.05` (Rule 27 violation).

#### A. الـ 10/10 active decision-screens الآن canonical

كل شاشة قرار (بتعرض signal/master_score/RSI/support/resistance) بـ تقرأ من مصدر عرض واحد. الـ 10 شاشات:

| # | Screen | Migration task | Status |
|---|---|---|---|
| 1 | `StockDetail` (تحليل سهم فردي) | `FINALIZE-UNIFICATION` | ✅ canonical |
| 2 | `ComprehensiveStockAnalysis` | `FINALIZE-UNIFICATION` | ✅ canonical |
| 3 | `SpecialistAnalysisView` | `FINALIZE-UNIFICATION` | ✅ canonical |
| 4 | `UnifiedPublishButton` | `FINALIZE-UNIFICATION` | ✅ canonical |
| 5 | `StocksView` (شاشة قائمة الأسهم) | `TIER3-ROUTES-MIGRATE` audit — confirmed already-canonical | ✅ canonical |
| 6 | `PredictionTrackingDashboard` | `TIER3-ROUTES-MIGRATE` audit — confirmed already-canonical | ✅ canonical |
| 7 | `MakerRadarTab` (رادار الميكرز + 5 sub-tabs) | `UNIFIED-API-V3` (committed) + `REAPPLY-CRITICAL-FIXES` (5 fabrication fallbacks removed — `entry*0.96`/`r1*1.04`/`entry*0.99`/`entry*1.01`/etc.) | ✅ canonical |
| 8 | `TradingViewChart` (`#trading-chart`) | `TRADING-CHART-V60.2` (Task 2026-10-07) — موصول بـ `getUnifiedStockData()` | ✅ canonical |
| 9 | `CanonicalWhoIsBuyingBanner` (NEW — `src/modules/market-analysis/components/`) | `TRADING-CHART-V60.2` (Task 2026-10-07 — 380 LOC) | ✅ canonical (NEW) |
| 10 | باقي 6 شاشات سبق ترحيلها في canonical migration phases (PersonaTab + PicksManagement + live-monitor + reports cards + alerts-center + watchlist view) | `PHASE-2-RSI-UNIFICATION` + predecessors | ✅ canonical |

#### B. Canonical Data Flow (Single Source of Truth)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Screen (decision-display)                                              │
│    └─ fetch('/api/stocks/[ticker]/unified')                             │
│         ↓                                                               │
│  src/app/api/stocks/[ticker]/unified/route.ts                          │
│    └─ getUnifiedStockData(ticker) ← src/lib/unified-stock-data.ts       │
│         ↓                                                               │
│  Canonical layers (TS port — مطابق Python 100%):                       │
│    ├─ canonical-signal.ts (246 LOC — classify_signal + canonical_signal_ar) │
│    ├─ canonical-rsi.ts (Wilder's smoothing — pure TS, لا DB deps)       │
│    └─ engine_settings reads (via Python proxy → engine_settings.py)    │
│         ↓                                                               │
│  Python backend (port 8010 — Rule 20):                                 │
│    ├─ canonical_signal.py (309 LOC — Python source of truth)            │
│    ├─ master_analyzer.py (THRESHOLDS = 78/65/55/40/25 — commits          │
│    │   c2ade8c6 Rule 71 + 38665fd1 REAPPLY)                             │
│    │   └─ _get_signal_from_score → canonical_signal.classify_signal    │
│    │   └─ _get_signal_arabic → canonical_signal.signal_ar              │
│    └─ engine_settings.py (1150 LOC — canonical thresholds source)       │
└─────────────────────────────────────────────────────────────────────────┘
```

#### C. HTTP 410 Gone — Deprecated Endpoints

الـ writers غير canonical اللي اتعطّلوا بـ HTTP 410 Gone أو early-return guards:

| Endpoint / File | Status | Reason |
|---|---|---|
| `POST /api/sniper/track` (`src/app/api/sniper/track/route.ts`) | HTTP **410 Gone** | non-canonical writer — Rule 35 |
| `ai_predictions_routes.py` (POST writers) | early-return guard | non-canonical writer |
| `historical_predictions_v2_routes.py` (POST writers) | early-return guard | non-canonical writer |
| (6 prior endpoints — earlier disabled in `FINALIZE-UNIFICATION`) | HTTP 410 Gone | Rule 35 — all consolidated under `/api/stocks/[ticker]/unified` |

#### D. `zero_conflict_test.py` — آلية إنفاذ Rule 73

> **الملف:** `scripts/zero_conflict_test.py` (~201 LOC — added in Task `DOC-SECRETARY-ACTIVATION` 2026-10-07).
> **التحديث 2026-10-08 (commit `64ee8d54`):** إضافة `--require-real-data` flag لتنبيه المستخدم لو الـ PASS كان trivial (كل NULL — stale data). للإنتاج بقيم non-null، لازم predictions طازجة (< 48h). HTTP 5xx excluded من verdict (infra issues).

**الـ test coverage (per run):**
- 35 probes × 7 endpoints × 5 tickers × 6 canonical fields = 7,350 data points per run.
- Acceptance thresholds: `mismatch_rate == 0.00%` + `threshold_drift == 0`.
- Latest result (2026-10-08 — with Python backend running on 8010): ✅ **PASS — 0.00% mismatch + 0 threshold drift + 0 HTTP errors** (was 3 timeouts previously — now 0 thanks to Python backend).

**Rule 73 enforcement:**
- لو أي شاشة قررت تنتج signal/master_score/RSI/support/resistance بدون ما تمرّ على `/api/stocks/[ticker]/unified` → الـ test هيرصمها mismatch فورًا.
- لو أي route فيه local computation للـ canonical fields → الـ test هيرصد drift في thresholds.

---

### 0.9 Dead Components Archive (Oct 8-9, 2026) — NEW 2026-10-09 (Task `DOCS-UPDATE-OCT9`)

> **المرجع:** `archive/dead-components-2026-10-08/` + worklog.md entries من Oct 8.
> **القاعدة الدستورية:** Rule 16 (NO-DELETION — VERIFY-BEFORE-DELETE) + Rule 25 (refactoring يحتاج موافقة المالك).

**10 dead components اتأرشفوا** (مش اتمسحوا — Rule 16 محترمة). كلهم مكوّنات مش بتُستخدم في أي route نشط + مش ليهم imports حية عبر `src/`. تم نقلهم لـ `archive/dead-components-2026-10-08/` بعد التحقق بـ grep شامل:

| # | Component (archived path) | LOC | Reason for archive |
|---|---|---:|---|
| 1 | `OldMarketAnalysisView.tsx` | ~6,450 | تم استبداله بـ orchestrator (297 LOC) + 5 tabs في Wave 3 |
| 2 | `LearningView.tsx` | ~1,200 | تم استبداله بـ AcademyView في Wave 3 |
| 3 | `LegacyStocksTable.tsx` | ~890 | تم استبداله بـ UnifiedTable (expandable + filterable) |
| 4 | `OldPredictionCard.tsx` | ~340 | تم استبداله بـ CanonicalPredictionCard |
| 5 | `MaestroWidget.tsx` | ~2,750 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — أرشيف في `archive/maestro-dead-code-20261012/`. كان معطل (KILL-MAESTRO 2026-08-31 → early-return null) ثم اتمسح. سيدي طلب: "Maestro ده ماضي أسود". |
| 6 | `V68OracleWidget.tsx` | ~1,100 | V68 A/B-test انتهى — deprecated |
| 7 | `V72OracleWidget.tsx` | ~980 | V72 A/B-test انتهى — deprecated |
| 8 | `OldRadarPanel.tsx` | ~1,540 | تم استبداله بـ MakerRadarTab + 5 sub-tabs |
| 9 | `LegacyPortfolioView.tsx` | ~890 | تم استبداله بـ EnhancedPortfolioView (3,069 LOC) |
| 10 | `OldTelegramPublisher.tsx` | ~420 | تم استبداله بـ UnifiedPublishButton (canonical) |

**ملخص الـ Wave (Oct 8):**
- ✅ **0 files deleted** (Rule 16 — archived only).
- ✅ **0 imports live** بعد الـ grep audit.
- ✅ كلهم موجودين في `archive/dead-components-2026-10-08/` (recoverable لو اكتُشف caller لاحقًا).

---

### 0.10 Multi-Market UI Updates (Oct 8-9, 2026) — NEW 2026-10-09 (Task `PHASE-3` — commit `b18b3f21`)

> **المرجع الدستوري:** Rule 53 (CRYPTO-IN-MARKETS) + Rule 27 (NO-FAKE-DATA) + Rule 73 (SINGLE-DISPLAY-SOURCE).

**A. MarketSelector (`src/components/shared/MarketSelector.tsx`) — 6 markets supported:**
- تم تحديث الـ MarketSelector من 5 → **6 markets**: EGX + TADAWUL + KSE + QSE + **US (graceful)** + CRYPTO.
- الـ store (`useAppStore.currentMarket`) بـ يتغيّر لما المستخدم يختار سوق → كل الـ views بـ تـ reload.
- `DevelopmentNotice.tsx` (سطر 9): تم إضافة 'US' لقائمة `DEVELOPMENT_MARKETS` (كانت ['TADAWUL','KSE','DFM','BSE','QSE']، بقت [..., 'US']). ده بيخلي العميل لما يختار US يشوف notice واضح بدل ما الـ dashboard يفضي بدون تفسير.
- currency labels (`MARKET_CURRENCY_LABEL` في store.ts): EGX='ج.م' + TADAWUL='ريال' + KSE='د.ك' + QSE='ر.ق' + US='$' + CRYPTO='$'. ✓

**B. EnhancedPortfolioView (`src/modules/portfolio/components/EnhancedPortfolioView.tsx`) — Market Badge:**
- قبل الإصلاح: كان بياخد `currentMarket` من store (سطر 499) لكن ما بيستخدمهوش — الأسهم من كل الأسواق كانت بتعرض مختلطة بدون تمييز.
- بعد الإصلاح (commit `b18b3f21`):
  - أُضيف `inferStockMarket(ticker, stored?)` helper (سطر 89-110): بيحدد السوق من `stored` field لو موجود، أو heuristic fallback (لو ticker أرقام فقط → 'TADAWUL' مثلًا 2222 = Aramco، لو فيه USDT/BTC/ETH → 'CRYPTO'، غير كده → 'EGX' افتراضي).
  - **أُضيف Market Badge (🏛️) قرب اسم كل سهم** (سطر 1341-1354): `🏛️ السوق السعودي` / `🏛️ بورصة الكويت` / `🏛️ بورصة قطر` / `🏛️ البورصة الأمريكية` / `🏛️ العملات الرقمية`. EGX مفيهوش badge (لأنه الافتراضي).
  - عند إضافة سهم جديد (سطر 769-773): بنخزن `payload.stock_market = currentMarket` تلقائياً، فالسهم الجديد بيتسجّل بالسوق الصح بدون تدخل يدوي من العميل.

**C. DashboardView (`src/modules/dashboard/components/DashboardView.tsx`) — EGX-specific widgets visibility:**
- الـ EGX-specific widgets (MarketSummary + IndexCards + MarketPulse + MarketSentiment) كلها `visible: () => currentMarket === 'EGX'` — مختفية صح للأسواق التانية (سطر 197-258).
- CRYPTO-specific widgets (CryptoSignalsWidget) `visible: (p) => p === 'crypto'` — شغّالة.

---

## 📑 المحتويات

0. [شاشة الحالات المُجمَّعة (Screen Status Rollup — 2026-09-26)](#0-شاشة-الحالات-المجمعة-screen-status-rollup--2026-09-26--doc-update-final)
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

> **(مُحدَّث 2026-09-26 — DOC-UPDATE-FINAL)** القيم النهائية مُجمَّعة في §0 (Screen Status Rollup). القيم التالية هي الأرقام المرجعية من الكود الفعلي.

| الفئة | العدد | الحالة |
|------|------:|--------|
| **Next.js page routes** | 20 | 9 نشطة · 9 ميتة · 2 redirect |
| **Next.js API routes** | **653** | 257 proxy لـ Python · 331 direct · 163 "tiny-proxy" boilerplate (~4,700 LOC) |
| **Hash views في `page.tsx`** | 45 | ~35 نشطة · ~10 legacy/hidden/alias |
| **React components** | **294** (tsx) + 24 (ts) = 318 total | 49 UI primitives + 245 non-UI (تحديث 2026-10-01 — +2 من 292 بعد إضافة Dashboard MyStocksBriefing + Portfolio Subscription components per FOCUS-5-TASKS) |
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
| 4 | ~~`/maestro`~~ | ~~`src/app/maestro/page.tsx`~~ | ~~124~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان standalone Maestro page (admin-gated). سيدي طلب حذفه: "Maestro ده ماضي أسود". |
| 5 | `/stock/[ticker]` | `src/app/stock/[ticker]/page.tsx` | 1233 | صفحة تفاصيل السهم (price/technicals/fundamentals/news/charts) |
| 6 | `/legal/disclaimer` | `src/app/legal/disclaimer/page.tsx` | 207 | إخلاء المسؤولية (عربي) — من Footer |
| 7 | `/legal/privacy` | `src/app/legal/privacy/page.tsx` | 195 | سياسة الخصوصية (عربي) |
| 8 | `/legal/terms` | `src/app/legal/terms/page.tsx` | 263 | شروط الخدمة (عربي) |
| 9 | `/payment/success` | `src/app/payment/success/page.tsx` | 156 | معالج نجاح الدفع (paymob callback) |
| 10 | `/admin` | `src/app/admin/page.tsx` | 35 | redirect → `/#admin` (الـ admin في الـ shell) |

> **الـ 9 صفحات الميتة (4,711 LOC) مذكورة في §10.1.**

> **Wave 3 (Task 9-A — 2026-10-01):** `#learning` hash view (LearningView.tsx) was **archived** to `archive/education-duplicate-2026-10-01/` (NOT deleted — owner directive). `'learning'` removed from `VALID_VIEWS` array + `AppView` type union + `AuthGate.PROTECTED_VIEWS` + `CRYPTO_VIEW_REDIRECTS` (now redirects `crypto-learning` → `academy`). All nav entries removed from TopBar + MobileMoreSheet + page.tsx switch + dynamic import. **`#academy` is now the SINGLE canonical education screen** with 5 tabs (was 4 — added 5th tab "🎓 دروس متقدمة" that fetches `/api/ads/educational-lessons` to render the 12 institutional-grade `content/education/*.md` lessons via inline `AdvancedLessonsTab` + `AdvancedMarkdownRenderer`).

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
| `recommendations` | متابعة التوقعات | `<MarketAnalysisView />` | 297 (was ~6,450 pre-Wave-3) | ✅ (BIGGEST — orchestrator) | `/api/predictions/honest-tracking/list`, `/api/predictions/honest-tracking/verify-pending` |
| `picks-management` | إدارة التوصيات | `<PicksManagementView />` | — | ❌ ARCHIVED (Wave 2) | Was 1,063 LOC — moved to `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/PicksManagementView.tsx` (page.tsx:160 comment said "merged into PredictionTrackingView" but file existed) |
| `specialist-analysis` | تحليل المتخصصين | `<SpecialistAnalysisView />` | 1,061 | ✅ | `/api/expert-consensus`, `/api/market/sectors/intelligence` |
| `reports` | التقارير | `<ReportsView />` | 1,160 | ✅ | `/api/reports/*`, `/api/market/report/*` |
| `simulation` | المحاكاة | `<SimulationView />` | 1,775 | ✅ | `/api/simulation/*` |
| `academy` | أكاديمية M2y | `<AcademyView />` | 717 (was 73 pre-Wave-3) | ✅ | `/api/ads/educational-lessons` (reads `content/education/*.md` — 12 institutional-grade lessons) — added 5th tab "🎓 دروس متقدمة" in Wave 3 Task 9-A |

> **Wave 3 (Task 9-A — 2026-10-01):** `#learning` view (LearningView.tsx, 1,063 LOC) was ARCHIVED to `archive/education-duplicate-2026-10-01/`. The `#academy` view is now the SINGLE canonical education screen (was 2 education screens pre-Wave-3).
>
> **Wave 3 (Task 9-B — 2026-10-01):** `#recommendations` (MarketAnalysisView) reduced from 10 main tabs + 3 sub-views = 13 views → **5 main tabs** (predictions + status + sectors-tracking + historical-trades + net-picks). LOC dropped from ~6,450 → 297 (orphan code moved to MakerRadarTab + duplicate-tab code removed). 5 radar tabs (exit-radar + weekly-report + multi-market-radar + radar-accuracy + personalized-radar) MOVED to `#liquidity-radar` (MakerRadarTab) as internal sub-tabs. See §4.7 (Radar System in `05-CURRENT_STATE.md`) for full details.
>
> **Wave 2 (Task 7-A — 2026-10-01):** `#picks-management` view component (`PicksManagementView.tsx`, 1,063 LOC) ARCHIVED to `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/` — page.tsx:160 comment said "merged into PredictionTrackingView" but the file still existed. The `#picks-management` hash route still works (renders PredictionTrackingView via alias) but the standalone component is no longer wired.

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

> **الخيار الآمن:** `compute_persona_fit()` في `daily_predictor.py` بـ derive 4 category scores من V40.2 proofs وبـ weightها بـ `PERSONA_INPUT_WEIGHTS`. الـ `kill_filter_result` بـ يُannotated بـ `| fit:<persona>(score)`.
>
> **حماية الـ baseline:** `persona='balanced'` في `predictions` **لم يُلمس** — أرقام 22/1/3 و 69.2% WR و 81.8% balanced لا تتغير. لا reclassify بدون موافقة المالك.

---

## 6. واجهة متابعة التوقعات (Prediction-Tracking UI)

> **المرجعية:** `RL-FIX-9-Predictions-Status-Logic.md` (كامل) · `audit_map.json` v3.66.4 + v3.66.8.

### 6.1 الـ view الأساسي: `MarketAnalysisView` (#recommendations)

**الملف:** `src/modules/market-analysis/components/MarketAnalysisView.tsx` (was ~6,450 LOC pre-Wave-3 — **now 297 LOC orchestrator** post-Wave-3 Task 9-B consolidation)
**الحالة:** ✅ ACTIVE (BIGGEST non-UI component — still orchestrator for 5 main tabs but reduced in size)

**الاسم بعد v3.66.8:** "متابعة التوقعات" (was: "التوصيات")
**البنية (post-Wave-3 Task 9-B):** **5 main tabs** (was 10 main + 3 sub-views = 13 pre-Wave-3).

> **تحديث P0-WAVE (2026-09-27):** تم wire **3 orphan tabs جديدة** جوّه الـ view (كانوا موجودين بس مش متوصّلين):
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
> - `radar-accuracy` → AccuracyDashboard
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
├── ~~<HumanRecommendationsAdmin />~~ 🗑️ **محذوف/أرشيف** (archive/dead-components-20261012/admin/ — 1,028 LOC — ORPHAN-GARAGE-COLLECTOR 2026-10-12)
├── <UsersManagement />           # 1,086 LOC
├── <DatabaseManagerFull />       # 3,259 LOC — بديل DatabaseManager
├── <NotebookAdminTab />          # 524 LOC — (جديد 2026-09-01) إدارة Stock Notebooks
├── <ShariaAdminTab />            # (NEW — Wave 8 — commit f413bd7) إدارة Sharia compliance (trigger scraper + view review_queue + edit symbol mappings + see last_scrape per source)
└── <PurgeCacheButton />          # 223 LOC
```

> **Wave 8 NEW tabs (Task 27-B audit identified as P0 MISSING — handoff to Fix Battalion):**
> - **Sharia management** — ✅ EXECUTED (commit `f413bd7`) — wired in AdminView.
> - **Source Authority** — ⏳ PENDING — view `CANONICAL_SOURCES` per market + toggle `BANNED_SOURCES` + see `write_guarded()` rejections log.
> - **Validation Monitor** — ⏳ PENDING — count of stocks with INVALID fields per field name + drill-down to ticker list + view `ValidationFinding.reason`.
> - **Cron Health dashboard** — ⏳ PENDING — surface `/api/admin/system-health` into `AdminView` + show `last_run`/`exit_code` for all 25 crontab jobs + manual "run cron now" buttons.
> - See §0.7.C + `05-CURRENT_STATE.md` §17.6 for the full P0 admin tab list (10 items — 1 done + 9 pending).

> **جديد 2026-09-01:** `<NotebookAdminTab />` (524 LOC) في `src/components/admin/NotebookAdminTab.tsx` — واجهة إدارة Stock Notebooks. يستدعي `/api/notebooks/*` (7 endpoints في `vps-service/api/notebook_routes.py`). يعرض: قائمة النوتبوكس، إحصائيات، تعديل machine_summary، إضافة دروس، إعادة بناء جماعي.

> **Comment في AdminView:** 6 admin orphans شالهم الـ imports (IterativeLearningAdmin, CryptoLearningAdmin, StockImportCard, RecommendationsExport, CryptoPredictionGenerator, DatabaseExplorer) — "كانوا مستوردين بس مش مرسومين في أي tab".

### 9.2 جرد شاشات الأدمن المنفصلة (admin pages — iframe targets)

| الـ route | LOC | الوظيفة |
|---------|----:|---------|
| `/admin/educational-cards` | 1702 | CRUD للـ educational cards + نشر Telegram |
| `/admin/honest-predictions` | 1919 | مولّد التوقعات التاريخية |
| `/admin/reports` | 118 | Trading Reports Hub (Stock League image cards) |
| `/maestro` | 124 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان standalone Maestro page (admin-gated). أرشيف في `archive/maestro-dead-code-20261012/`. سيدي طلب: "Maestro ده ماضي أسود — شيله". |

### 9.3 مكوّنات admin إضافية (active + orphan)

| المكوّن | LOC | Status | الوظيفة |
|---------|----:|--------|---------|
| `admin/AdminView.tsx` | 1,913 | ✅ active | Main admin shell |
| `admin/MaestroDashboard.tsx` | 2,750 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) | ~~/Maestro control panel~~ — أرشيف في `archive/maestro-dead-code-20261012/`. كان معطل KILL-MAESTRO 2026-08-31. |
| `admin/MaestroCommandCenter.tsx` | 3,748 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) | ~~/React Flow pipeline UI~~ — أرشيف في `archive/maestro-dead-code-20261012/`. |
| `admin/MaestroPage.tsx` | 297 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) | ~~/Maestro top-level page~~ — أرشيف. |
| `admin/CryptoMaestroPage.tsx` | 821 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) | كان ❌ DEAD duplicate، بعدها اتمسح نهائياً. |
| `admin/DatabaseManagerFull.tsx` | 3,259 | active(1) | الـ DB manager النشط |
| `admin/DatabaseManager.tsx` | 971 | ❌ DEAD | superseded by DatabaseManagerFull |
| `admin/SuperLearningSystem.tsx` | 2,403 | active(1) | نظام التعلّم الموحّد |
| `admin/TelegramTab.tsx` | 2,200 | active(1) | إدارة Telegram |
| `admin/EngineSettingsTab.tsx` | 576 | active | إعدادات المحركات |
| `admin/SystemProblemsTab.tsx` | 488 | active | مشاكل النظام |
| `admin/UsersManagement.tsx` | 1,086 | active | إدارة المستخدمين |
| `admin/PromoCodesAdmin.tsx` | 592 | active | أكواد الخصم |
| ~~`admin/HumanRecommendationsAdmin.tsx`~~ | ~~1,028~~ | 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/admin/`) | توصيات يدوية — 0 importers حية |
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
| `admin/CryptoMaestroPage.tsx` | 821 | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان ❌ DEAD duplicate، بعدها اتمسح نهائياً. |
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
>
> **تحديث Wave 2 (2026-10-01 — Task WAVE-2-3-DOCS):** كل الـ dead/duplicate files المذكورة في الأقسام 10.1-10.7 دي قد اتعملها ARCHIVE (NOT delete — owner directive) إلى `archive/wave-2-cleanup-2026-10-01/` عبر 4 frontend sub-batches + 3 backend sub-batches + 1 false-negative-restore + 1 archive-restore = 9 commits. انظر §0.5 لتفاصيل الـ 121 frontend dead files + 6 false positives caught + skipped. الخلاصة:
> - `archive/wave-2-cleanup-2026-10-01/src/components/` ← 53 dead .tsx (legacy + admin + shadcn UI primitives + duplicate-feature components)
> - `archive/wave-2-cleanup-2026-10-01/src/modules/` ← 14 dead .tsx (admin + predictions + radar + portfolio + subscription)
> - `archive/wave-2-cleanup-2026-10-01/src/lib/` ← 18 dead .ts (cache/ + expert/ + duplicate db helpers)
> - `archive/wave-2-cleanup-2026-10-01/vps-service/` ← 56 dead .py (analyzers + telegram + engines + engine + jobs + ai + data + tools)
> - `archive/wave-2-cleanup-2026-10-01/src/app/api/` ← 313 dead route.ts files (Task 7-B 7 batches)
> - **TOTAL archived: 436 files** + 3 more in Wave 3 (`archive/education-duplicate-2026-10-01/` for the LearningView triplet).
>
> **تحديث Wave 3 (2026-10-01 — Task 9-A):** `LearningView.tsx` + `learning-content.ts` + `learning-store.ts` (3 files / ~1,868 LOC) archived to `archive/education-duplicate-2026-10-01/`. `'learning'` hash view removed from 7 wiring points (TopBar + MobileMoreSheet + page.tsx switch + dynamic import + VALID_VIEWS + AppView type union + AuthGate.PROTECTED_VIEWS). `#academy` is now the SINGLE canonical education screen.

### 10.1 الـ 9 صفحات Next.js الميتة (4,711 LOC — للحذف [P3.2])

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
| `stocks/ComprehensiveStockAnalysis.tsx` | 1,430 | active(1) | stocks/ |
| `stocks/ExpertAnalysisPanel.tsx` | 🆕 285 | active(1) | stocks/ — NEW 2026-10-09 — تحليل خبير احترافي شامل (tab جديد في ComprehensiveStockAnalysis) |
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
| ~~3,748~~ | ~~`admin/MaestroCommandCenter.tsx`~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان (يخضع للـ React Flow — صعب التقسيم). أرشيف في `archive/maestro-dead-code-20261012/`. |
| 3,259 | `admin/DatabaseManagerFull.tsx` | تقسيم per-tab |
| 3,069 | `portfolio/EnhancedPortfolioView.tsx` | تقسيم per-section |
| ~~2,750~~ | ~~`admin/MaestroDashboard.tsx`~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان lazy tabs (أغلبها dynamic). أرشيف في `archive/maestro-dead-code-20261012/`. |
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

> **الـ V34 Pine Script هو artifact تاريخي.** المنطق الفعلي للنظام في Python (`institutional_decision_engine.py` + `v38_backtest_engine.py` + `daily_predictor.py`) ومُوثّق في `SYSTEM_HOW_IT_THINKS.md`. لا يتم تعديل الـ Pine Script — أي تطوير يحدث في Python ثم يُلهم نسخة Pine مستقبلية (إن لزم).

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
| 2026-09-27 | `02-SCREENS_AND_COMPONENTS.md` | DOC-UPDATE-P0-WAVE: تحديث علامة "آخر تحديث" لـ 2026-09-27. تحديث §0 Screen Status Rollup (3 orphan tabs wired + P0 wave notes على كل شاشة). إضافة §0.3 جديد "P0 Wave 2026-09-27 — Security + Observability + Tests" (4 جداول: UI المُتأثرة + Radar signal-tracker auto-record + Observability + Tests). تحديث §6.1 MarketAnalysisView بـ P0-WAVE note عن الـ 3 wired tabs. تحديث عدّاد الـ components 282→285. |
| 2026-09-01 | `02-SCREENS_AND_COMPONENTS.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة `<NotebookAdminTab />` (524 LOC) في AdminView dynamic imports — واجهة إدارة Stock Notebooks تستدعي `/api/notebooks/*` (7 endpoints في `vps-service/api/notebook_routes.py`). |
# 🔍 تقرير الـ Audit الشامل — 30 أغسطس 2026

> **هذا الملف هو السجل الرسمي لكل ما تم فحصه وإصلاحه في المراجعة الشاملة.**
> **آخر تحديث:** 2026-09-01 (إضافة قسم "تحديثات الجلسة 2026-09-01" — مراجعة الموديولات الجديدة)
> **آخر تحديث سابق:** 2026-08-30
> **الحالة:** ✅ كل المشاكل الحرجة (P0) تم إصلاحها — المنصة جاهزة للإنتاج

---

## 📊 الملخص التنفيذي

تم تنفيذ **4 جولات audit شاملة** بـ 3 subagents بالتوازي (frontend + backend + UI/UX):

| المرحلة | المدة | المشاكل المكتشفة | المُصلَحة |
|---------|------|------------------|-----------|
| AUDIT-1 (Frontend) | ~3 ساعات | 22 مشكلة | 22 ✅ |
| AUDIT-2 (Backend) | ~3 ساعات | 30 مشكلة | 25 ✅ |
| AUDIT-3 (UI/UX) | ~3 ساعات | 34 مشكلة | 28 ✅ |
| LEGAL-AUDIT | ~1 ساعة | 100+ مشكلة قانونية | 100+ ✅ |
| **الإجمالي** | **~10 ساعات** | **186+ مشكلة** | **175+ ✅** |

**النتيجة النهائية:**
- 🔴 P0 (حرج): **26/26 مُصلَحة** ✅
- 🟠 P1 (مهم): **22/27 مُصلَحة** ✅ (5 تحسينات بسيطة متبقية)
- 🟡 P2 (تحسين): **12/17 مُصلَحة** ✅
- ⚖️ قانوني: **100+/100+ مُصلَحة** ✅

---

## 🗂️ الـ Commits على GitHub

| Commit | التاريخ | الوصف |
|--------|---------|-------|
| `eb587486` AUDIT-FIX | 2026-08-30 | 13 مشكلة حرجة (footer, news, توقعات, DBs) |
| `56a1f01c` AUDIT-FIX-2 | 2026-08-30 | 17 مشكلة (7 Python endpoints, dark mode, ألوان) |
| `d729ae11` AUDIT-FIX-3 | 2026-08-30 | دعم CRYPTO في daily_predictor |
| `c350a4f9` LEGAL-AUDIT | 2026-08-30 | حماية قانونية شاملة (إزالة "توصية" + "مضمون") |

---

## 🔴 المشاكل الحرجة (P0) — كلها مُصلَحة ✅

### 1. Footer مش sticky + nested scroll hell
**الملف:** `src/app/page.tsx`
**المشكلة:** `<main>` كان عنده `min-h-screen overflow-y-auto` → الـ footer بيقع تحت الـ viewport
**الحل:** شيلت `min-h-screen overflow-y-auto` من `<main>` + ضفت `min-h-screen` على الـ wrapper

### 2. LiveStockTicker بيجيب أس EGX في وضع الكريبتو
**الملف:** `src/components/dashboard/DashboardView.tsx`
**المشكلة:** الـ ticker بيظهر في كل الأحوال حتى في وضع CRYPTO
**الحل:** `{currentMarket !== 'CRYPTO' && <LiveStockTicker />}`

### 3. news-feed-widget بيقرأ `window.__currentMarket` بدل store
**الملف:** `src/components/news-feed-widget.tsx`
**المشكلة:** pattern هش — مش reactive لتغيرات الـ market
**الحل:** استبدلت بـ `useAppStore((s) => s.currentMarket)`

### 4. توقعات CRYPTO ghost closures
**الملف:** `vps-service/jobs/daily_closer.py`
**المشكلة:** `get_pending_predictions()` بيجيب كل التوقعات بدون فلترة market → توقعات CRYPTO بتقفل بدون exit_price
**الحل:** ضفت `market_filter` parameter

### 5. انقسام `market='EGX'` vs `market='مصر'` في data_engine.db
**المشكلة:** 83 سهم `market='EGX'` + 293 سهم `market='مصر'` — كلها مصرية لكن الفلاتر بتختفي
**الحل:** `UPDATE stocks SET market = 'EGX' WHERE market = 'مصر'` — 293 صف تم تحويلهم

### 6. price_history.db ملف 0 بايت
**المشكلة:** كل الـ historical queries مكسورة بصمت
**الحل:** عملت schema صحيحة للـ price_history table

### 7. نصوص صينية مسربة
**الملفات:** `StockDetail.tsx`, `AcademyEncyclopedia.tsx`
**المشكلة:** "见" (jiàn), "未来" (wèilái), "一次性" (yīcìxìng) داخل نصوص عربية
**الحل:** استبدلت بـ "البيانات الخام غير متاحة", "المستقبلية", "لمرة واحدة"

### 8. DisclaimerBanner dismiss مش بيشتغل
**الملف:** `src/components/legal/DisclaimerBanner.tsx`
**المشكلة:** `useSyncExternalStore` + `storage` event بيشغل بين الـ tabs بس، مش على نفس الـ tab
**الحل:** استبدلت بـ `useState` مباشر

### 9. RoboNotifierToggle محجوب بالـ MobileNav
**الملف:** `src/app/page.tsx`
**المشكلة:** `bottom-4` (16px) تحت الـ MobileNav اللي بـ `z-50`
**الحل:** `bottom-4` → `bottom-20 lg:bottom-4`

### 10. `/api/crypto/stop` كاذب
**الملف:** `src/app/api/crypto/stop/route.ts`
**المشكلة:** بيرجع success من غير ما يوقف أي process
**الحل:** اعملت implement حقيقي: بيـ kill الـ PID + يـ update status

### 11. `/api/data-engine/control` بقرأ news.db من path غلط
**الملف:** `src/app/api/data-engine/control/route.ts`
**المشكلة:** `NEWS_DB = stocks.db` (خطأ) — news_articles موجودة في `news.db`
**الحل:** `stocks.db` → `news.db` (7894 خبر)

### 12. `/api/predictions` + `/api/predictions/live` بقرأوا من `aiPrediction` الفاضي
**الملفات:** `src/app/api/predictions/route.ts`, `src/app/api/predictions/live/route.ts`
**المشكلة:** `aiPrediction` table فاضي (0 صفوف) رغم إن `predictions` table فيها 91 صف
**الحل:** استبدلت بـ `predictions` table

### 13. `compute_stock_state` مش بيـ emit `NEAR_BREAKOUT`
**الملف:** `vps-service/utils/stock_state.py`
**المشكلة:** state معرف في الـ maps بس الكود مش بيـ emitه
**الحل:** ضفت condition: `below_ma50 + dist_from_ma50 > -2 + RSI 45-60 + vol_surge`

### 14-20. 7 Python crypto endpoints ناقصة
**الملف:** `vps-service/lightweight_server.py`
**المشكلة:** Next.js routes بتنادي endpoints مش موجودة → 503
**الحل:** اعملت 7 endpoints:
- `/api/crypto/sync` (POST) — CoinGecko + fallback
- `/api/crypto/analyze/<coin_id>` (GET) — OHLC + RSI
- `/api/crypto/<coin_id>/history` (GET) — market_chart
- `/api/crypto/watchlist` (GET/POST/DELETE) — SQLite
- `/api/crypto/portfolio` (GET/POST) — SQLite
- `/api/crypto/simulation/portfolio` (GET) — SQLite
- `/api/crypto/simulation/trade` (POST) — BUY/SELL
- `/api/crypto-phase4/events` (GET) — CoinGecko + fallback

### 21. crypto/full-analysis volume=0
**الملف:** `src/app/api/crypto/full-analysis/route.ts`
**المشكلة:** CoinGecko OHLC endpoint مابيرجعش volume
**الحل:** fetch volume من CoinGecko market_chart + `volumesByDate` map

### 22. crypto/[id] + crypto/full-analysis بدون fallback لـ crypto_prices DB
**الملف:** `src/app/api/crypto/[id]/route.ts`, `src/app/api/crypto/full-analysis/route.ts`
**المشكلة:** لو CoinGecko rate-limited → 404
**الحل:** fallback لـ `getCryptoBySymbol()` من crypto_prices (429K صف)

### 23. timezone handling ساذج في data-engine/status
**الملف:** `src/app/api/data-engine/status/route.ts`
**المشكلة:** `getUTCHours() + 2` hardcoded — مش بـ handle DST
**الحل:** استخدمت `toLocaleString` مع `timeZone` config

### 24. honest-tracking/list بـ fetch كل الصفوف بدون LIMIT
**الملف:** `src/app/api/predictions/honest-tracking/list/route.ts`
**المشكلة:** OOM risk على 5000+ توقع
**الحل:** ضفت `LIMIT 500` في الـ SQL

### 25. دعم CRYPTO في daily_predictor
**الملف:** `vps-service/jobs/daily_predictor.py`
**المشكلة:** معندوش أي دعم CRYPTO (0 matches لـ crypto/BTC)
**الحل:** ضفت `--market CRYPTO` flag + `get_crypto_tickers()` + `run_crypto_generator()`

### 26. selection bias في التوقعات (تم التوضيح)
**المشكلة:** كل التوقعات 91 صف: 76 STRONG_BUY + 12 WATCH + 3 BUY = صفر SELL/HOLD
**التوضيح:** مقصود — backtest script long-only. الإنتاج (MaestroOrchestrator.analyze) بيقبل كل الإشارات

---

## ⚖️ الحماية القانونية (مهم جداً) ✅

### المشكلة:
- **69 مرة "توصية"** في 30 ملف — خطر قانوني حسب هيئة الرقابة المالية (FRA)
- **15 مرة "مضمون"** — توقيع سجن محتمل
- **"8% سنوياً مضمون"** في DynamicRiskProfilerModal — خطير جداً
- **"صفقات قليلة لكن مضمونة"** في SuperLearningSystem

### الحل:

**1. إزالة كل "مضمون" الخطيرة:**
- "8% سنوياً مضمون" → "8% سنوياً عائد ثابت (شهادات إيداع)"
- "صفقات قليلة لكن مضمونة" → "صفقات قليلة ومدروسة المخاطر"
- "سيولة حقيقية مضمونة" → "سيولة حقيقية موثقة"

**2. استبدال "توصية" بـ "توقع":**
- 69 occurrence → 0 (ما عدا DisclaimerBanner — مطلوب قانونياً)
- في كل `src/components` + `src/lib` + `src/app`

**3. DisclaimerBanner أقوى** بـ 3 components:
- **DisclaimerBanner** (top banner — قابل للـ dismiss)
- **LegalDisclaimerFooter** (ثابت في أسفل كل شاشة)
- **InlineDisclaimer** (compact جوه البطاقات)

**النص القانوني الواضح:**
> ⚠️ إخلاء مسؤولية قانوني: هذه المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية فقط، وليست توصية استثمارية أو نصيحة مالية. القرار النهائي مسؤولية العميل وحده. لا يوجد أي ضمان للنتائج. السوق يحتوي على مخاطر، والخسارة ممكنة. استشر مستشارًا ماليًا مرخصًا قبل أي قرار استثماري.

**4. LegalDisclaimerFooter في كل شاشات:**
- ~~`CryptoScreenerView`~~ 🗑️ **محذوف/أرشيف** + ~~`CryptoAdvancedAnalysisView`~~ 🗑️ **محذوف/أرشيف** + ~~`CryptoTradingChartView`~~ 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/crypto/`) + `CryptoPredictionTrackingView` (live)
- StockScreenerAdvanced
- Footer.tsx (كل الصفحات)

---

## 🟠 المشاكل المهمة (P1) — 22/27 مُصلَحة

### المُصلَحة:
1. ✅ ألوان indigo/blue في StockScreenerAdvanced → teal/cyan
2. ✅ dark mode في TradingChartView + SingleStockAnalysisView
3. ✅ جداول الكريبتو overflow-auto على الموبايل
4. ✅ Labels عربية في CryptoScreenerView (الآن 🗑️ **محذوف/أرشيف** — ORPHAN-GARAGE-COLLECTOR 2026-10-12)
5. ✅ resetFilters بـ reset لـ initialMarket
6. ✅ 12 مكون shadcn dead اتمسحوا
7. ✅ currencyLabel يدعم كل الأسواق
8. ✅ tab screener ميت اتمسح من MarketAnalysisView
9. ✅ window.__currentMarket pattern اتمسح
10. ✅ adaptCryptoToStock: high/low/open تقريبي
11. ✅ Sidebar active state شغّال للمواقع الموجهة
12. ✅ Toaster القديم اتمسح — Sonner موحد
13. ✅ compute_stock_state RSI thresholds محسنة
14. ✅ INSUFFICIENT_DATA state جديد للأسهم بدون RSI
15. ✅ NEAR_PEAK state جديد (65 ≤ RSI < 70)
16. ✅ default min_price=0.50 + min_volume=1000 + min_turnover=50K
17. ✅ crypto-screener مستقل تماماً
18. ✅ crypto-analysis مستقل (CryptoAdvancedAnalysisView) (الآن 🗑️ **محذوف/أرشيف** — ORPHAN-GARAGE-COLLECTOR 2026-10-12)
19. ✅ #crypto مفيهاش أخبار أس EGX
20. ✅ news-feed-widget reactive لتغيرات الـ market
21. ✅ /api/news-feed?market=crypto filter
22. ✅ 6 APIs معطوبة اتصصلحت (data-engine/crypto, crypto-predictions, stats, recommendations, mr-signals, ohlc)

### المتبقية (5 تحسينات بسيطة):
- 🔜 touch targets تحت 44px في بعض الأماكن (h-7 w-7)
- 🔜 aria-labels إنجليزي في بعض المكونات
- 🔜 text-[9px], text-[10px] كتير (صعب القراءة)
- 🔜 Skeletons ناقصة في بعض الـ crypto views
- 🔜 N+1 queries في `/api/data-engine/control`

---

## 🟡 التحسينات (P2) — 12/17 مُصلَحة

### المُصلَحة:
1. ✅ 14 مكون shadcn dead اتمسحوا
2. ✅ Toaster القديم اتمسح
3. ✅ نصوص صينية اتمسحت
4. ✅ "Loading..." بالإنجليزي اتمسح
5. ✅ DisclaimerBanner dismiss شغّال
6. ✅ RoboNotifierToggle مش محجوب
7. ✅ timezone handling صح
8. ✅ honest-tracking LIMIT
9. ✅ crypto fallback لـ crypto_prices DB
10. ✅ crypto volume من market_chart
11. ✅ Sidebar active state
12. ✅ adaptCryptoToStock high/low/open

### المتبقية (5 تحسينات):
- 🔜 text-[9px] كتير
- 🔜 aria-labels إنجليزي
- 🔜 Skeletons ناقصة
- 🔜 N+1 queries
- 🔜 cache unbounded في بعض endpoints

---

## 📁 الملفات المُعدَلة (45 ملف)

### Frontend (src/components/):
- `legal/DisclaimerBanner.tsx` — DisclaimerBanner + LegalDisclaimerFooter + InlineDisclaimer
- `layout/Sidebar.tsx` — VIEW_TO_NAV_MAP لـ active state
- `layout/Footer.tsx` — نص قانوني أقوى
- `dashboard/DashboardView.tsx` — LiveStockTicker مخفي في CRYPTO
- `dashboard/MaestroCommandCenter.tsx`, `MaestroDashboard.tsx`, `MaestroLogicFlow.tsx`
- `news-feed-widget.tsx` — useAppStore بدل window.__currentMarket
- `analysis/MarketAnalysisView.tsx`, `TradingChartView.tsx`, `SingleStockAnalysisView.tsx`, `ExpertRecommendationsPanel.tsx`
- `screener/StockScreenerAdvanced.tsx` — ألوان + resetFilters + currencyLabel
- `crypto/CryptoScreenerView.tsx` 🗑️ (محذوف/أرشيف — ORPHAN-GARAGE-COLLECTOR 2026-10-12), `CryptoPredictionTrackingView.tsx` (live), `CryptoAdvancedAnalysisView.tsx` 🗑️ (محذوف/أرشيف), `CryptoTradingChartView.tsx` 🗑️ (محذوف/أرشيف)
- `predictions/PredictionTrackingView.tsx`, `PicksManagementView.tsx`, `PredictionTrackingDashboard.tsx`
- `stocks/StockDetail.tsx`, `ComprehensiveStockAnalysis.tsx`
- `academy/AcademyEncyclopedia.tsx`, `StrategySandbox.tsx`
- `admin/SuperLearningSystem.tsx`
- `persona/DynamicRiskProfilerModal.tsx`
- `portfolio/RiskProfilerQuiz.tsx`, `BagHolderRescuePanel.tsx`
- `reports/ReportsView.tsx`, `StockAnalysisReport.tsx`, `DailyMarketReport.tsx`, `ExecutiveReportView.tsx`
- `about/AboutView.tsx`
- `FeedbackWidget.tsx` — migration من useToast لـ sonner
- + 15 ملف تاني فيه "توصية" اتمسحت

### Backend (src/app/api/):
- `crypto/[id]/route.ts` — fallback لـ crypto_prices
- `crypto/full-analysis/route.ts` — volume + fallback
- `crypto/stop/route.ts` — implement حقيقي
- `crypto/start/route.ts` — حفظ PID
- `crypto/stats/route.ts`, `recommendations/route.ts`, `mr-signals/route.ts`, `ohlc/route.ts`
- `crypto-predictions/route.ts`
- `data-engine/crypto/route.ts`, `control/route.ts`, `status/route.ts`
- `news-feed/route.ts` — ?market=crypto filter
- `predictions/route.ts`, `predictions/live/route.ts`
- `predictions/honest-tracking/list/route.ts` — LIMIT 500

### Python (vps-service/):
- `lightweight_server.py` — 7 crypto endpoints جديدة
- `utils/stock_state.py` — RSI thresholds + NEAR_BREAKOUT + INSUFFICIENT_DATA
- `api/advanced_screener_routes.py` — default min_price/volume/turnover
- `jobs/daily_closer.py` — market_filter
- `jobs/daily_predictor.py` — --market CRYPTO

### DBs:
- `db/price_history.db` — schema صحيحة
- `db/data_engine.db.stocks` — توحيد market='EGX' (293 صف)

---

## ✅ التحقق النهائي

- **lint:** EXIT 0 ✅
- **Python syntax:** ✅
- **Browser tests:** كل الشاشات بتـ render ببيانات حقيقية ✅
- **APIs:** كل endpoints شغّالة ✅
- **المنصة محمية قانونياً** ✅

---

## 🚀 خطوات النشر على الـ VPS

```bash
git pull origin main
bun run build && pm2 restart all
pm2 restart python-backend

# لتوليد توقعات كريبتو:
python vps-service/jobs/daily_predictor.py --market CRYPTO --today-only
```

---

**انتهى التقرير. المنصة جاهزة للإنتاج.**

---

## 🆕 تحديثات الجلسة (2026-09-01) — مراجعة الموديولات الجديدة

> **ملاحظة:** كل الموديولات الجديدة التالية بـ feature flags default OFF عشان ما تؤثرش على الإنتاج الحالي. التحقق تم بـ grep + Read على الكود الفعلي.

### الموديولات المضافة (مراجعة Audit)

| الـ module | LOC | Toggle (default OFF) | الحالة |
|---|---:|---|---|
| `analyzers/egx_disclosure_engine.py` | 875 | `V40_2_DISCLOSURE_IMPACT` | ✅ موجود + 12 نوع إفصاح + dynamic scoring -2/+2 |
| `analyzers/strict_entry_filters.py` | 582 | `V40_2_STRICT_ENTRY` | ✅ موجود + 3 دوال (is_in_accumulation, is_liquidity_grab, is_late_entry) |
| `analyzers/short_holding_exit.py` | 614 | `V40_2_SHORT_HOLDING` / `V40_2_DISTRIBUTION_EXIT` | ✅ مُعاد كتابته — فلسفة هيكلية (`max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة) + `is_within_typical_correction` + `is_breakdown_not_correction` |
| `analyzers/unified_exit_engine.py` | 518 | `V40_2_UNIFIED_EXIT` | ✅ موجود + `MARKET_PROFILES` (STOCKS + CRYPTO) |
| `analyzers/stock_notebook.py` | 1,065 | `V40_2_NOTEBOOK_CONTEXT` | ✅ موجود + 259 ملف JSON في `notebooks/EGX/` + `apply_notebook_context()` |
| `analyzers/decision_logger.py` | 338 | — | ✅ موجود + `db/decision_log.db` + `log_decision()` + `get_decision_stats()` |
| `analyzers/news_fetcher_analyzer.py` | 507 | `V40_2_NEWS_IMPACT` | ✅ موجود + DuckDuckGo + sentiment -2/+2 |
| `analyzers/news_impact_scorer.py` | 432 | (يُستخدم في news_agent) | ✅ موجود + 14 event types |
| `analyzers/crypto_strict_filters.py` | 448 | `V40_2_CRYPTO_STRICT_ENTRY` | ✅ موجود |
| `analyzers/crypto_short_holding_exit.py` | 412 | (مدمج في unified) | ✅ موجود |
| `analyzers/crypto_news_fetcher.py` | 391 | `V40_2_CRYPTO_NEWS_IMPACT` | ✅ موجود |
| `analyzers/crypto_disclosure_engine.py` | 412 | `V40_2_CRYPTO_DISCLOSURE_IMPACT` | ✅ موجود |
| `api/notebook_routes.py` | 124 | — | ✅ موجود + 7 endpoints + مسجّل في `lightweight_server.py` كـ `notebook_bp` |
| `src/components/admin/NotebookAdminTab.tsx` | 524 | — | ✅ موجود + مستورد في AdminView |
| `ai/news_signals_reader.py` + `src/app/api/news/ingest/route.ts` | — | — | ✅ موجود (إضافة المبرمج الآخر) + `apply_news_bias_to_score()` |

### النتيجة

- ✅ كل الموديولات موجودة ومرتبطة بالـ V40.2 generator (`grep` أكّد الاستدعاءات في `daily_predictor.py`).
- ✅ كل الـ feature flags العشرة default OFF — الإنتاج الحالي مش متأثر.
- ✅ `decision_logger.py` بـ يسجل كل رفض/خروج في `db/decision_log.db` للمراقبة.
- ✅ `notebook_routes.py` مسجّل blueprint في `lightweight_server.py`.
- ⏳ التحقق الإنتاجي الكامل محتاج تفعيل كل flag واحد واحد + قياس الأداء.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `AUDIT_REPORT_2026-08-30.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تحديثات الجلسة (2026-09-01)" — مراجعة 15 موديول جديد (EGX Disclosure + Strict Entry + Short Holding Exit هيكلي + Unified Exit + Stock Notebook + Decision Logger + News Fetcher + News Impact Scorer + 4 Crypto modules + notebook_routes + NotebookAdminTab + news_signals_reader + /api/news/ingest). كلها default OFF. |
# 🏗️ تقرير الـ Audit الهندسي الشامل — 30 أغسطس 2026

> **الموقع:** `Documentation/AUDIT_ENGINEERING_2026-08-30.md`
> **آخر تحديث:** 2026-09-01 (إضافة قسم "تحديثات الجلسة 2026-09-01" — مراجعة هندسية للموديولات الجديدة)
> **الفريق:** Senior Full-Stack Engineer + Backend Engineer + Frontend Engineer + UX Designer
> **المنهجية:** 4 audit بالتوازي بمنظور مختلف لكل واحد
> **الهدف:** ترتيب المشروع كـ **نظام واحد متكامل** (مش موديولات منفصلة)

---

## 📊 الملخص التنفيذي

المشروع بني على معمارية رباعية سليمة (Next.js + Python + Data Engine + WS) مع قاعدة دستورية واضحة (35 قاعدة). فيه **نظام سليم متكامل** (V40.2 + daily_closer + screener + TelegramNotifier) مكتوب بـ ~3,000 LOC Python + Node proxy نظيف.

**لكن** فيه **نظام موازي كامل** اتبنى حديثاً (tomorrow_*) بـ ~1,400 LOC إضافي + **6,000 LOC** من Node logic مخالف لـ Rule 20 + **31 مشكلة UX** تخدش شخصية المشروع.

| النوع | العدد | الخطورة |
|------|------|---------|
| 🔴 P0 (حرج) | 16 | فورية |
| 🟠 P1 (مهم) | 22 | هيكلية |
| 🟡 P2 (تحسين) | 14 | جودة |
| **الإجمالي** | **52** | — |

---

## 🚨 القسم 1: الأنظمة الموازية (أكبر مشكلة)

### النظام الموازي لتوقعات الغد (بـ ~1,400 LOC)

| # | المكوّن | المكوّن الموازي (مخالف) | المكوّن الموجود (canonical) | القواعد المخالفة |
|---|---|---|---|---|
| **A** | مولّد التوقعات | `tomorrow_predictions_generator.py` (896 LOC) | `daily_predictor.py` (1466 LOC) | Rule 4, 21, 28, 29 |
| **B** | جدول التوقعات | `tomorrow_predictions` table (3 صفوف) | `predictions` table | Rule 28, 29 |
| **C** | حالة الأسهم النشطة | `tomorrow_active_status` table (0 صفوف) | `predictions WHERE outcome_date IS NULL` | Rule 28, 29 |
| **D** | أسهم تحت المراقبة | `tomorrow_watchlist` table (15 صف) | `stocks` table + `advanced_screener_routes.py` | Rule 28, 29 |
| **E** | تتبع التوقعات (4→3) | `/api/predictions/honest-tracking/*` (Node direct SQLite) | `/api/stored-analysis/live-tracking` (Python proxy) | Rule 20, 28 |
| **F** | إرسال تليجرام | `/api/tomorrow-predictions/send-telegram` (Node يبني الرسالة) | `TelegramNotifier.notify_daily_report()` (Python L79) | Rule 20, 28 |

### أنظمة تتبع متوازية (Rule 28 §1):
```
/api/predictions/tracking/*         (Python proxy ✅)
/api/predictions/honest-tracking/*  (Node direct SQLite ❌ — 6 endpoints, 2099 LOC)
/api/stored-analysis/live-tracking  (Python proxy ✅ — canonical)
/api/tomorrow-predictions           (Node direct SQLite ❌ — جديد)
```

---

## ⚠️ القسم 2: الانكسارات الهندسية

### مخالفة Rule 20 (Python = العقل، Node = العرض)
**13+ Node route فيها logic حقيقي** (~4,516 LOC):
- `/api/tomorrow-predictions/route.ts` (214 LOC) — SQLite مباشرة + stats
- `/api/tomorrow-predictions/send-telegram/route.ts` (229 LOC) — بناء رسالة Telegram في Node
- `/api/predictions/honest-tracking/*` (6 endpoints, 2099 LOC) — SQLite + aggregations
- `/api/maestro/logic-panel/route.ts` (574 LOC) — SQLite + توزيع إشارات
- `/api/predictions/credibility/route.ts` (489 LOC) — SQLite + dedup
- `/api/predictions/expert-consensus/route.ts` (449 LOC) — SQLite مزدوج
- `/api/predictions/price-verify/route.ts` (373 LOC) — SQLite writable + UPDATE
- `/api/predictions/live/route.ts` (197 LOC) — SQLite + aggregations

### مخالفة Rule 21 (V40.2 = مصدر التوقعات الوحيد)
`tomorrow_predictions_generator.py` بيستخدم:
1. `MaestroOrchestrator.analyze()` (مسار persona، أقل صرامة)
2. `simple_analysis()` fallback (RSI-only، بدون kill filters ولا evidence)
3. **مفيش** `institutional_decision_engine.build_institutional_decision()`
4. **مفيش** `liquidity_filter.set_strict_kill_filters(True)`
5. **مفيش** ATR clamp [3%, 9%]

---

## 🎨 القسم 3: مشاكل شخصية المشروع

### عبارات تحميسية + إيموجي زينة (Rule 30/31)
**25+ انتهاك صريح** في user-facing UI:

| الموقع | المخالفة |
|---|---|
| `AuthGate.tsx:108` | `🚀 سجل مجاناً للوصول لكل المميزات` |
| `AboutView.tsx:155` | `🚀 ورا كل شمعة على الشارت..` + عامية مصرية |
| `LearningView.tsx:271` | `+10 XP 🎉` |
| `MarketAnalysisView.tsx:4272` | `شاركها الآن على تليجرام / فيسبوك! 🚀` |
| `PredictionTrackingDashboard.tsx:4-8` | `LUXURY EDITION` / `ملوكية فائقة الفخامة` |
| `MaestroCommandCenter.tsx` | `🧠 محركات التوقع الأربعة` / `⚡ مراحل التحليل الست` |
| `StockScreener.tsx:87` | `🚀 اختراق` |
| `BottomPanel.tsx:310` | `🚀 استراتيجيات الصيد بنقرة واحدة` |

### مصطلحات تقنية مكشوفة للعميل (Rule 32)
- **"نظام المايسترو"** + `6 Phases` badge + "regime confidence" (MaestroWidget على الـ dashboard)
- **"نظام الـ 8 طبقات"** (MarketAnalysisView.tsx:534, 557, 600)
- **"V39 · Full Dynamic Adaptive"** (InstitutionalDecisionPanel.tsx:330)
- **"V20 Ultimate Fusion"** (SingleStockAnalysisView.tsx:1263)
- **"V40"** (PredictionTrackingDashboard.tsx:1476)
- **AboutView كاملاً**: عناوين فرعية إنجليزية تقنية + Veto/Boost/T+2/MACD/RSI/V20 + عامية مصرية + indigo/blue

### ألوان indigo/blue ممنوعة (في 10+ ملف)
- `ZakatView.tsx` (استخدام مكثف)
- `AboutView.tsx` (indigo في Core Engine node)
- `MaestroCommandCenter.tsx`
- `RealtimeTicker.tsx`
- `SmartConfluenceView.tsx`
- `SubscriptionView.tsx`
- `app/legal/privacy/page.tsx`
- + 4 ملفات تانية

---

## 🔧 القسم 4: مشاكل Frontend + UX

### تكرار في الـ components (Rule 28)
- **`StatCard`** مكررة في 10 نسخ
- **`formatPrice`/`formatNumber`/`formatPct`** مكررة في 20+ نسخة
- **`stocksMap` useMemo** مكررة في 3 نسخ في MarketAnalysisView
- **`fetchData` useCallback** مكررة في 5 نسخ
- **`VIEW_TO_NAV_MAP`** معرفة مرتين في Sidebar.tsx

### bugs حقيقية
1. **`StockScreenerAdvanced.tsx` duplicate `teal` key** (line 827 vs 835) — JS silent override
2. **`page.tsx` duplicate `VALID_VIEWS`** — 5 routes موجودة في array واحد بس مش في Set التاني = deep-linking مكسور
3. **`CryptoPortfolioView` محفظة في localStorage** بدل backend = مش متزامنة بين الأجهزة
4. **`PredictionPerformanceView` limit=5000** بدون virtualization = خطر OOM
5. **4 dynamic imports مش مستخدمة** في `page.tsx` (lines 103, 104, 153, 161) = ~200KB زايد

### مشاكل Sidebar (31 عنصر nav)
- **تكرار فعلي**: "متابعة التوقعات" + "إدارة التوقعات" + "تتبع التوقعات" (كريبتو)
- **تكرار فعلي**: "مركز التعلم" + "أكاديمية M2y"
- **تكرار فعلي**: "المحاكاة" + "محاكاة الكريبتو"
- **تكرار فعلي**: "فلاتر الأسهم" + "فلاتر الكريبتو"
- قسم "العملات الرقمية" بيتعرض مع قسم "السوق الحالي" في نفس الوقت (مفروض تبديل عبر ExchangeSelector)

### مشاكل السرعة
- **6 polling mechanisms** شغالة في نفس اللحظة على الـ dashboard
- **4 large lists** بدون virtualization (أخطرها limit=5000)
- **missing React.memo** على table rows في 4 ملفات كبيرة
- **5 fetchData بدون AbortController** = race conditions

### مشاكل mobile
- **زر إغلاق DisclaimerBanner** = 24px (تحت 44px المطلوب)
- **أزرار pagination** = 32px (تحت 44px)
- **tabs على الموبايل** = 5-6 أيقونات بلا نصوص = غير مفهوم

### تكرار الـ disclaimers (4 مستويات!)
1. `DisclaimerBanner` (sticky top, dismissable)
2. `LegalDisclaimerFooter` (footer ثابت)
3. `InlineDisclaimer` (جوه البطاقات)
4. `Footer.tsx` (نص رابع)

= **4 نصوص قانونية متكررة في نفس الصفحة** → ضوضاء بصرية + إضعاف الرسالة

---

## 🛠️ خطة الترتيب الهندسي

### 🔴 المرحلة 1 (P0) — حذف الأنظمة الموازية + إصلاح bugs

| # | المهمة | LOC | التأثير |
|---|---|---|---|
| P0-1 | حذف `tomorrow_predictions_generator.py` بالكامل | -896 | إزالة نظام موازي مخالف لـ Rule 21 |
| P0-2 | DROP 3 جداول من `predictions.db` (`tomorrow_*`) | -3 tables | إزالة تكرار DB |
| P0-3 | حذف `/api/tomorrow-predictions/route.ts` | -214 | إزالة Node direct SQLite |
| P0-4 | حذف `/api/tomorrow-predictions/send-telegram/route.ts` | -229 | إزالة logic من Node |
| P0-5 | حذف `/api/tomorrow-predictions/generate/route.ts` | -103 | إزالة spawn سكربت محذوف |
| P0-6 | حذف `vps-service/telegram/send_message.py` | -84 | إزالة relay مكرر |
| P0-7 | إعادة توصيل `LiveTrackingTab` → `/api/stored-analysis/live-tracking` | re-wire | تكامل مع canonical |
| P0-8 | إعادة توصيل `TomorrowPredictionsPanel` → `/api/unified/predictions` | re-wire | تكامل مع canonical |
| P0-9 | إصلاح `duplicate teal key` في StockScreenerAdvanced | bug fix | إزالة JS silent override |
| P0-10 | توحيد `VALID_VIEWS` في ملف واحد | bug fix | إصلاح deep-linking |
| P0-11 | حذف 4 dynamic imports مش مستخدمة في page.tsx | -200KB | تقليل bundle |
| P0-12 | إصلاح `CryptoPortfolioView` → backend بدل localStorage | architecture | مزامنة بين الأجهزة |
| P0-13 | تقليل `PredictionPerformanceView` limit=5000 → 100 + pagination | performance | منع OOM |

**صافي المرحلة 1:** -1,526 LOC + إصلاح 4 bugs

### 🟠 المرحلة 2 (P1) — نقل logic من Node لـ Python + إصلاح شخصية المشروع

| # | المهمة | التفاصيل |
|---|---|---|
| P1-1 | نقل `/api/predictions/honest-tracking/*` لـ Python | 6 endpoints (2099 LOC) → Python blueprints + Node pure proxies |
| P1-2 | إضافة Python endpoint `/api/telegram/send-daily-report` | يستخدم `TelegramNotifier.notify_daily_report()` الموجود |
| P1-3 | Node proxy للـ endpoint الجديد | 5 LOC proxy بدل 229 LOC logic |
| P1-4 | توحيد 3 أنظمة تتبع على `/api/stored-analysis/live-tracking` | حسب Rule 28 §1 |
| P1-5 | إعادة كتابة `AboutView.tsx` | إزالة إيموجي + عامية + مصطلحات تقنية + indigo |
| P1-6 | إزالة `🚀` + `🎉` من 10+ ملف | استبدال بنصوص احترافية |
| P1-7 | إزالة مصطلحات تقنية من UI | "نظام المايسترو" → "حالة السوق"، "V20/V39/V40" → تشال |
| P1-8 | استبدال indigo/blue بـ emerald/teal/amber في 10+ ملف | امتثال لقاعدة الألوان |
| P1-9 | توحيد `StatCard` في مكون واحد | استبدال 10 نسخ |
| P1-10 | توحيد `formatPrice`/`formatNumber`/`formatPct` في `src/lib/format.ts` | استبدال 20+ نسخة |
| P1-11 | نقل `adaptStock`/`adaptCryptoToStock` من store لـ `src/lib/adapters/` | فصل الـ adapters |
| P1-12 | نقل RSI/MA calculation من ~~`CryptoAdvancedAnalysisView`~~ لـ Python | Rule 20 — 🗑️ **CryptoAdvancedAnalysisView محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 — `archive/dead-components-20261012/crypto/`) |
| P1-13 | دمج قسم "العملات الرقمية" في Sidebar مع تبديل عبر ExchangeSelector | إزالة التكرار |
| P1-14 | توحيد آلية التنبيهات (إزالة `RoboNotifierToggle` العائم) | دمج في NotificationCenter |
| P1-15 | تقليل polling (دمج 6 mechanisms في واحد) | useVisibilityAwarePolling موحد |
| P1-16 | تكبير touch targets (h-6/h-8 → h-9) | 4 ملفات |
| P1-17 | إصلاح tabs على الموبايل (scrollable بدل grid) | MarketAnalysisView |
| P1-18 | جعل التبويب الافتراضي لـ `#recommendations` = `balanced` (التوقعات) | بدل `tracking` |
| P1-19 | إضافة `React.memo` على table rows في 4 ملفات كبيرة | performance |
| P1-20 | إضافة `AbortController` على 5 fetchData في MarketAnalysisView | منع race conditions |
| P1-21 | نقل `presets` array في StockScreenerAdvanced لـ `db/screener_lists.json` | configuration |
| P1-22 | إزالة `useEffect(loadDashboard)` المكرر في DashboardView | bug fix |

### 🟡 المرحلة 3 (P2) — تحسينات جودة + تقسيم

| # | المهمة | التفاصيل |
|---|---|---|
| P2-1 | توحيد الـ disclaimers (4 → 1) | حذف DisclaimerBanner العلوي + الاكتفاء بـ Footer |
| P2-2 | تقسيم `MarketAnalysisView.tsx` (7700 LOC) لـ `analysis/tabs/` folder | كل tab ملف منفصل |
| P2-3 | توحيد ألوان accent للأقسام (4 → 3) | emerald (سوق) + teal (كريبتو) + amber (أموال) |
| P2-4 | نقل قسم "حسابات دينية" تحت "إدارة الأموال" | إزالة قسم لعنصرين فقط |
| P2-5 | تبسيط Footer (9 عناصر → 4) | إزالة روابط زايدة |
| P2-6 | إضافة skeleton لـ MaestroWidget + MarketSummary + IndexCards | منع layout shift |
| P2-7 | إضافة empty state بدل `return null` | 3 ملفات |
| P2-8 | دمج `PredictionTrackingView` + `PredictionTrackingDashboard` | إزالة تكرار |
| P2-9 | تحديث `Documentation/01-PROJECT_ANATOMY.md` | إزالة إشارات tomorrow_* + تحديث §10.1 G9 |
| P2-10 | إضافة guard ضد Node direct SQLite في CI | منع تكرار المخالفة |
| P2-11 | إزالة `console.log([V20] 🚀)` من InteractiveChart | تنظيف console العميل |
| P2-12 | نقل display currency + FX rates لـ `/api/currency` | بدل store state ثابت |
| P2-13 | نقل user preferences لـ `/api/user/preferences` | بدل localStorage |
| P2-14 | إزالة `LIVE · {liveCountdown}s` badge | أسلوب تحميسي |

---

## 📊 الأثر المتوقع

| المقياس | قبل | بعد | التغيير |
|---|---|---|---|
| إجمالي LOC | ~85,000 | ~82,000 | **-3,000 LOC** |
| Node routes فيها logic | 13+ | 0 | **-4,516 LOC** |
| جداول DB مكررة | 3 | 0 | **-3 tables** |
| أنظمة تتبع متوازية | 4 | 1 | **توحيد** |
| عبارات تحميسية | 25+ | 0 | **امتثال Rule 31** |
| ألوان indigo/blue | 10+ ملفات | 0 | **امتثال قاعدة الألوان** |
| disclaimers متكررة | 4 | 1 | **توحيد** |
| Sidebar items | 31 | ~20 | **-35%** |
| polling mechanisms | 6 | 1 | **-83%** |
| bugs حقيقية | 4 | 0 | **إصلاح كامل** |

---

## ✅ القواعد اللي اتنفذت صح (نماذج تحتذى بها)

1. **V40.2 canonical pipeline** (`daily_predictor.py` + `institutional_decision_engine.py` + `liquidity_filter.py`) — 6 proofs + R:R floor + ATR clamp + closed-loop. ده المرجع.
2. **`/api/stored-analysis/live-tracking`** — Node pure proxy + Python blueprint. نموذج للـ Rule 20.
3. **`/api/screener/advanced`** — Node pure proxy + Python blueprint. نموذج للـ Rule 20.
4. **`TelegramNotifier.notify_target_hit()`** في `daily_closer.py:2769` — Python closed-loop بيستدعي TelegramNotifier مباشرة. نموذج للترابط.
5. **`PredictionTracker.record_prediction()`** — canonical entry point لأي توقع.
6. **`ErrorBoundary` + `SafeWidget` + `LazyTabLoader`** — بنية تحميل وأخطاء احترافية.
7. **`MarketPulseWidget`** — skeleton + error state + retry button = نموذج يحتذى به.
8. **`MobileNav`** بـ 5 عناصر فقط = نموذجي للموبايل.

---

## 🎯 الخلاصة

المشروع فيه **نظام سليم متكامل** (V40.2 + daily_closer + screener + TelegramNotifier) مكتوب بـ ~3,000 LOC Python + Node proxy نظيف. فوقه اتبنى **نظام موازي كامل** (tomorrow_*) + **6,000 LOC Node logic** + **31 مشكلة UX** تخدش شخصية المشروع.

**الخطوة الأولى الواجبة:** المرحلة 1 (P0) — حذف الأنظمة الموازية + إصلاح bugs. ده وحده بيلغي 80% من الانكسارات.

**الخطوة الثانية:** المرحلة 2 (P1) — نقل logic من Node لـ Python + إصلاح شخصية المشروع.

**الخطوة الثالثة:** المرحلة 3 (P2) — تحسينات جودة + تقسيم.

---

**انتهى التقرير.**

---

## 🆕 تحديثات الجلسة (2026-09-01) — مراجعة هندسية للموديولات الجديدة

> **المنهجية:** تم التحقق من كل موديول جديد بـ `grep` + `Read` للتأكد من: (1) وجود الملف، (2) ربطه بـ V40.2 generator، (3) feature flag default OFF، (4) عدم وجود تكرار مخالف للـ Rule 28.

### الموديولات الجديدة — تقييم هندسي

| الـ module | LOC | التقييم الهندسي |
|---|---:|---|
| `analyzers/egx_disclosure_engine.py` | 875 | ✅ سليم — 12 نوع إفصاح + dynamic scoring. مدمج في V40.2 خلف flag. لا تكرار. |
| `analyzers/strict_entry_filters.py` | 582 | ✅ سليم — 3 دوال (is_in_accumulation, is_liquidity_grab, is_late_entry). لا تكرار. |
| `analyzers/short_holding_exit.py` | 614 | ✅ **مُعاد كتابته بفلسفة هيكلية** — `max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة. أضاف `is_within_typical_correction` + `is_breakdown_not_correction` — جسر مع النوتبوك. **معالجة لـ Rule 38 (تحديث).** |
| `analyzers/unified_exit_engine.py` | 518 | ✅ سليم — `MARKET_PROFILES` (STOCKS + CRYPTO). يوحّد short_holding_exit + crypto_short_holding_exit (لا تكرار). |
| `analyzers/stock_notebook.py` | 1,065 | ✅ سليم — طبقة معرفة فوق المحركات (مش بديل). `apply_notebook_context()` جسر موحد. 259 ملف JSON. |
| `analyzers/decision_logger.py` | 338 | ✅ سليم — طبقة مراقبة (مش logic تداولي). `log_decision()` + `get_decision_stats()` + `db/decision_log.db`. |
| `analyzers/news_fetcher_analyzer.py` | 507 | ✅ سليم — يُكمّل (مش يُلغي) `news_agent.py` + `news_impact_scorer.py`. |
| `analyzers/news_impact_scorer.py` | 432 | ✅ سليم — 14 event types. يُستخدم في news_agent (مش تكرار). |
| `analyzers/crypto_strict_filters.py` | 448 | ✅ سليم — نظير EGX بـ thresholds مكيّفة لـ 24/7. لا تكرار (thresholds مختلفة). |
| `analyzers/crypto_short_holding_exit.py` | 412 | ✅ سليم — نظير EGX بـ ساعات بدل أيام. قابل للاستبدال بـ unified_exit_engine. |
| `analyzers/crypto_news_fetcher.py` | 391 | ✅ سليم — نظير EGX للكريبتو. |
| `analyzers/crypto_disclosure_engine.py` | 412 | ✅ سليم — نظير EGX لأحداث الكريبتو. |
| `api/notebook_routes.py` | 124 | ✅ سليم — 7 endpoints + مسجّل blueprint (`notebook_bp`). لا تكرار. |
| `src/components/admin/NotebookAdminTab.tsx` | 524 | ✅ سليم — مستورد في AdminView. لا تكرار. |
| `ai/news_signals_reader.py` + `src/app/api/news/ingest/route.ts` | — | ✅ سليم — جسر لـ News Agent خارجي. `apply_news_bias_to_score()` بـ يطبّق bias على V40.2. |

### التقييم العام

- ✅ **كل الموديولات مرتبطة + مستخدمة** (Rule 5 — كل كود لازم يتربط).
- ✅ **كلها بـ feature flags default OFF** — الإنتاج الحالي مش متأثر (Rule 33 — PRODUCTION-WIRING).
- ✅ **لا تكرار** — كل موديول له دور واضح، النظائر بين EGX + Crypto بـ thresholds مختلفة (مش تكرار صرف).
- ✅ **Python = العقل** (Rule 20) — كل الـ logic في Python، Node مجرد proxy للـ `/api/news/ingest` + `notebook_routes` proxy.
- ✅ **معالجة Rule 28 (NO-DUPLICATION)** — `unified_exit_engine.py` بـ يوحّد الخروج (يستبدل 2 ملف) بدل التكرار.
- ⏳ **قياس إنتاجي محتاج** — تفعيل كل flag واحد واحد + قياس الأداء على `/live-tracking`.

### نتائج باك-تست B0/B1/B2/B3 (200 سهم × 6 شهور)

| السيناريو | Trades | WR | Return | ملاحظة هندسية |
|---|---:|---:|---:|---|
| B0 (baseline) | 31 | 45.2% | +41.2% | كل flags OFF — الإنتاج الحالي |
| B1 (strict entry ON) | 14 | 35.7% | -17.6% | الـ flag بـ يرفض كتير — صفقات أقل |
| B2 (strict + widened stop) | 14 (4 stop_widened) | — | -18.8% | اتساع الوقف ما عوّضش |
| B3 (structural exit ON) | 14 | — | — | **لا exit من نوع max_holding ✅** — الفلسفة الهيكلية شغّالة |

### الخلاصة الهندسية

الموديولات الجديدة **سليمة هندسياً** ومرتبطة بالنظام المتكامل. الفلسفة الهيكلية للخروج (`short_holding_exit.py` المُعاد كتابته) بـ تعالج نقطة "الخروج الزمني بـ يقتل صفقات" اللي ظهرت في B1/B2. كلها default OFF لحد ما يتم القياس الإنتاجي.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `AUDIT_ENGINEERING_2026-08-30.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تحديثات الجلسة (2026-09-01)" — مراجعة هندسية لـ 15 موديول جديد (تقييم Rule 5/20/28/33 + نتائج باك-تست B0/B1/B2/B3 + خلاصة هندسية). |
# 📜 التقرير الشامل المفصل — إصلاحات 30-31 أغسطس 2026

> **الهدف:** وثيقة مرجعية كاملة لأي مشكلة مستقبلية. كل تعديل + السبب + الملف المتأثر + كيفية التراجع.
> **المؤلف:** Z.ai Code (Senior Full-Stack) + فريق المهندسين (4 audit بالتوازي)
> **الفترة:** 30-31 أغسطس 2026
> **الـ commits:** 14 commit على GitHub
> **آخر تحديث:** 2026-09-01 (إضافة قسم "تحديثات الجلسة 2026-09-01" — الموديولات الجديدة المرتبطة بالـ V40.2)

---

## 📊 الملخص التنفيذي

تم تنفيذ **6 مراحل** من الإصلاحات (P0 + P1-A + P1-B + P1-C + P1-D + P2)، كل مرحلة اختبرت بفريق مهندسين صارم. النتيجة: **نظام واحد متكامل** بدون تكرار، بأسلوب احترافي، وبدون مصطلحات تقنية مكشوفة.

| المقياس | قبل | بعد | التحسن |
|---|---|---|---|
| 🚀 + 🎉 في src/components/ | 17+ | 0 | 100% |
| مصطلحات تقنية مكشوفة | 10+ | 0 | 100% |
| indigo كألوان فعلية | 30 ملف | 0 | 100% |
| blue في ملفات العميل | 75 ملف | 0 | 100% |
| StatCard مكرر | 6 نسخ | 1 موحد | 83% |
| Node routes فيها logic | 3 (tomorrow) | 0 | 100% |
| جداول DB مكررة | 3 | 0 | 100% |
| disclaimers متكررة | 4 | 1 | 75% |
| bugs حقيقية | 4 | 0 | 100% |
| إجمالي LOC محذوف | — | ~1,600 | — |

---

## 🔴 المرحلة P0 — حذف النظام الموازي + إصلاح bugs

### المشكلة
اتبنى نظام موازي كامل لتوقعات الغد بـ ~1,400 LOC:
- `tomorrow_predictions_generator.py` (896 LOC) — مكرر لـ `daily_predictor.py`
- 3 جداول DB مكررة (`tomorrow_predictions` + `tomorrow_active_status` + `tomorrow_watchlist`)
- 3 Node routes فيها logic (SQLite مباشرة + بناء رسالة Telegram)
- بيستخدم `simple_analysis()` fallback (RSI-only) بدون V40.2 evidence → مخالف Rule 21

### الإصلاحات

#### P0-1: حذف النظام الموازي
- **حذف:** `vps-service/jobs/tomorrow_predictions_generator.py` (896 LOC)
- **حذف:** `vps-service/telegram/send_message.py` (84 LOC)
- **حذف:** `src/app/api/tomorrow-predictions/` (3 routes، 545 LOC)
- **السبب:** مخالف Rule 4 (لا شاشات جديدة) + Rule 21 (V40.2 = المصدر الوحيد) + Rule 28 (لا تكرار) + Rule 29 (نظام متكامل)
- **التراجع:** لو رجعنا النظام، نستخدم `git checkout 77176d93^ -- <file>` للملف المحذوف

#### P0-2: DROP 3 جداول من predictions.db
- **DROP:** `tomorrow_predictions` (3 صفوف)
- **DROP:** `tomorrow_active_status` (0 صفوف)
- **DROP:** `tomorrow_watchlist` (15 صف)
- **السبب:** مكررة لـ `predictions` + `stocks` tables
- **التراجع:** لو احتجنا الجداول، نعيد إنشائها من `tomorrow_predictions_generator.py` (git history)

#### P0-3: إعادة توصيل الـ tabs لـ canonical endpoints
- **LiveTrackingTab** دلوقتي يستخدم:
  - `/api/stored-analysis/live-tracking` (canonical Python proxy)
  - `/api/screener/advanced` (canonical Python proxy)
- **TomorrowPredictionsPanel** دلوقتي يستخدم:
  - `/api/unified/predictions` (canonical V40.2 endpoint)
  - `/api/telegram/send-daily-report` (Python TelegramNotifier proxy)
- **السبب:** Rule 20 (Node = display only) + Rule 5 (كل كود لازم يتربط)

#### P0-4: إصلاح duplicate teal key
- **الملف:** `src/components/screener/StockScreenerAdvanced.tsx`
- **المشكلة:** `teal` key معرف مرتين في colorMap (JS silent override)
- **الإصلاح:** شيلنا الـ duplicate
- **التراجع:** `git checkout 77176d93^ -- src/components/screener/StockScreenerAdvanced.tsx`

#### P0-5: توحيد VALID_VIEWS
- **الملف الجديد:** `src/lib/valid-views.ts`
- **المشكلة:** قائمتين متناقضتين في `page.tsx` (validViews array + VALID_VIEWS Set) → deep-linking مكسور لـ 5 routes
- **الإصلاح:** توحيد في ملف واحد + import في page.tsx
- **التراجع:** `git checkout 77176d93^ -- src/app/page.tsx` (يرجع القائمتين)

#### P0-6: حذف 4 dynamic imports مش مستخدمة
- **حذف:** PredictionPerformanceView + PredictionCredibilityTable (admin-only)
- **حذف:** IterativeLearningView + SimpleRecommendationsView (مش في switch)
- **السبب:** Rule 5 (كل كود لازم يتربط) + توفير ~200KB bundle
- **التراجع:** `git checkout 77176d93^ -- src/app/page.tsx`

### الاختبار: ✅ TEST-P0-STAGE1: PASS (8/8)

---

## 🟠 المرحلة P1-A — إصلاح شخصية المشروع

### المشكلة
- 17+ 🚀 + 🎉 في src/components/
- مصطلحات تقنية مكشوفة للعميل (V20/V34/V39/LuxAlgo/BigBeluga/نظام الـ 8 طبقات/نظام المايسترو)
- 30 ملف فيها indigo + 75 ملف فيها blue (مخالف لقاعدة الألوان)

### الإصلاحات

#### P1-A.1: إزالة 🚀 + 🎉 (17 ملف → 0)
- AuthGate: "🚀 سجل مجاناً" → "سجّل الدخول للوصول إلى المزايا الكاملة"
- AboutView: "🚀 ورا كل شمعة" → "ورا كل شمعة" + "🏗️ البنية المعمارية" → "البنية المعمارية"
- LearningView: "+10 XP 🎉" → "تم إكمال الدرس بنجاح"
- StockScreener: "🚀 اختراق" → "📈 اختراق"
- MarketAnalysisView: "شاركها الآن على تليجرام / فيسبوك! 🚀" → "شارك التوقع على تليجرام أو فيسبوك"
- SuperLearningSystem: "🎉 تم الوصول للهدف!" → "تم الوصول للهدف"
- + 11 ملف تاني

#### P1-A.2: إزالة مصطلحات تقنية مكشوفة
- "نظام المايسترو" → "حالة السوق المُجمّعة" (MaestroWidget + MaestroCommandCenter + DashboardView)
- "6 Phases" badge → "تحليل شامل"
- "🧠 محركات التوقع الأربعة" → "محركات التحليل"
- "⚡ مراحل التحليل الست" → "مراحل التحليل"
- "نظام الـ 8 طبقات" → "التحليل الفني الشامل"
- "V20 Ultimate Fusion" → "التحليل الفني الموحد"
- "V39 Full Dynamic Adaptive" → "لوحة القرار المؤسسي"
- "LuxAlgo + BigBeluga + SMC" → شال
- console.log([V20] 🚀) → removed (InteractiveChart)

#### P1-A.3: استبدال indigo بـ teal (30 ملف → 0)
- find src/components -name "*.tsx" -exec sed -i 's/indigo/teal/g' {} \;
- الباقي بس comments (مسموح)

#### P1-A.4: استبدال blue بـ teal في ملفات العميل (75 ملف → 0)
- find src/components -name "*.tsx" ! -path "*/admin/*" -exec sed -i 's/blue/teal/g' {} \;
- admin excluded (أقل أولوية)

### الاختبار: ✅ TEST-P1-A-RETRY: PASS (بعد إصلاح 5 مشاكل متبقية)

---

## 🟠 المرحلة P1-B — توحيد helpers + StatCard

### المشكلة
- 20+ نسخة من formatPrice/formatNumber/formatPercent في مكونات مختلفة
- 10 نسخ من StatCard function

### الإصلاحات

#### P1-B.1: إنشاء src/lib/format.ts
- `formatPrice(n, market)` — يدعم EGX/CRYPTO/TADAWUL/KSE/QSE
- `formatNumber(n, digits)` — K/M/B/T
- `formatPercent(n, digits)` — +/-
- `formatVolume(v)` — K/M/B
- `formatDate(date)` — DD/MM/YYYY
- `formatDateTime(date)`

#### P1-B.2: إنشاء src/components/ui/stat-card.tsx
- `StatCard({ icon, label, value, tone })` — موحد
- tone: neutral/positive/negative/warning

#### P1-B.3: حذف 6 StatCard functions محلية
- CryptoPredictionTrackingView
- ~~CryptoAdvancedAnalysisView~~ 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/crypto/`)
- ~~CryptoScreenerView~~ 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/crypto/`)
- PredictionTrackingView
- PicksManagementView
- DailyMarketReport
- استبدال بـ `import { StatCard } from '@/components/ui/stat-card'`

### الاختبار: ✅ TEST-P1-B: PASS (6/6)

---

## 🟠 المرحلة P1-C — Python endpoint للـ Telegram

### المشكلة
- Frontend بيدعو `/api/tomorrow-predictions/send-telegram` (محذوف)
- مفيش Python endpoint للـ daily report

### الإصلاحات

#### P1-C.1: Python endpoint
- **الملف:** `vps-service/api/telegram_routes.py`
- **الـ endpoint:** `POST /api/telegram/send-daily-report?market=EGX`
- بيستخدم `TelegramNotifier.notify_daily_report(market=market)` الموجود (سطر 79)
- Rule 20: كل logic في Python

#### P1-C.2: Node proxy
- **الملف:** `src/app/api/telegram/send-daily-report/route.ts`
- pure proxy — مفيش logic (fetch للـ Python endpoint بس)
- Rule 20: Node = display only

#### P1-C.3: الترابط
- Frontend (TomorrowPredictionsPanel) → `/api/telegram/send-daily-report` → Python `telegram_bp` → `TelegramNotifier.notify_daily_report()`

### الاختبار: ✅ TEST-P1-C: PASS (8/8)

---

## 🟠 المرحلة P1-D — إصلاح Sidebar + navigation + touch targets

### المشكلة
- touch targets تحت 44px (h-7 w-7 = 28px)
- default tab = 'tracking' (مفروض 'balanced' = التوقعات)
- useEffect(loadDashboard) مكرر
- tabs على الموبايل = grid (مش scrollable)

### الإصلاحات

#### P1-D.1: إصلاح touch targets
- ExpertIntelligencePanel: 3 أزرار h-8 w-8 → h-9 w-9
- EnhancedPortfolioView: أزرار تعديل/حذف h-7 w-7 → h-9 w-9
- النتيجة: 26 → 13 match (50% أقل)

#### P1-D.2: تغيير default tab
- `useState('tracking')` → `useState('balanced')`
- العميل يشوف التوقعات أول حاجة

#### P1-D.3: إزالة useEffect المكرر
- `DashboardView.tsx` كان فيه useEffect(loadDashboard) مرتين → واحدة

#### P1-D.4: tabs scrollable على الموبايل
- `grid-cols-3 sm:grid-cols-4 lg:grid-cols-6` → `flex overflow-x-auto sm:grid sm:grid-cols-3 lg:grid-cols-6`

### الاختبار: ✅ TEST-P1-D: PASS (5/5)

---

## 🟡 المرحلة P2 — توحيد disclaimers + إزالة عبارات تحميسية

### المشكلة
- 4 disclaimers متكررة (DisclaimerBanner + LegalDisclaimerFooter + InlineDisclaimer + Footer)
- ⚡ في refresh badge (أسلوب تحميسي)

### الإصلاحات

#### P2.1: توحيد disclaimers (4 → 1)
- شيلنا `DisclaimerBanner` العلوي من `layout.tsx`
- الاكتفاء بـ Footer + LegalDisclaimerFooter في الشاشات الحرجة

#### P2.2: إزالة ⚡ من refresh badge
- "⚡ تجديد {refreshMin}د" → "تجديد {refreshMin}د"

### الاختبار: ✅ TEST-P2-FINAL: PASS (5/5)

---

## 🗂️ قائمة الـ commits (مرجع للتراجع)

| Commit | المرحلة | الوصف |
|--------|---------|-------|
| `77176d93` | P0 | حذف النظام الموازي + إصلاح bugs |
| `85a6f813` | P1-A | إصلاح شخصية المشروع |
| `7423b726` | P1-A-fix | إصلاح 5 مشاكل متبقية |
| `166054f2` | P1-B | توحيد helpers + StatCard |
| `88abe2e1` | P1-C | Python endpoint للـ Telegram |
| `9cdb04b1` | P1-D | إصلاح Sidebar + navigation |
| `3124bee7` | P2 | توحيد disclaimers |

### كيفية التراجع عن أي مرحلة:
```bash
# عكس مرحلة P0 (يرجع النظام الموازي):
git revert 77176d93

# عكس مرحلة P1-A (يرجع 🚀 + indigo):
git revert 85a6f813 7423b726

# عكس كل المراحل دفعة واحدة:
git revert 77176d93..3124bee7
```

---

## 📁 الملفات الجديدة

| الملف | الوصف |
|------|-------|
| `src/lib/valid-views.ts` | مصدر واحد لكل الـ routes المسموح بها |
| `src/lib/format.ts` | دوال تنسيق موحدة (formatPrice + formatNumber + formatPercent) |
| `src/components/ui/stat-card.tsx` | StatCard موحد |
| `src/app/api/telegram/send-daily-report/route.ts` | Node proxy للـ Telegram |

## 📁 الملفات المحذوفة

| الملف | السبب |
|------|-------|
| `vps-service/jobs/tomorrow_predictions_generator.py` | نظام موازي مكرر |
| `vps-service/telegram/send_message.py` | relay مكرر |
| `src/app/api/tomorrow-predictions/` (3 routes) | Node logic + نظام موازي |

## 📁 الملفات المعدلة الأساسية

| الملف | التعديل |
|------|---------|
| `src/app/page.tsx` | توحيد VALID_VIEWS + حذف imports + إزالة case tomorrow |
| `src/components/analysis/MarketAnalysisView.tsx` | إعادة توصيل tabs + إزالة مصطلحات + default tab + scrollable tabs |
| `src/components/layout/Sidebar.tsx` | VIEW_TO_NAV_MAP + إزالة tomorrow item + Calendar import |
| `src/components/screener/StockScreenerAdvanced.tsx` | duplicate teal key + StatCard import |
| `src/app/layout.tsx` | إزالة DisclaimerBanner العلوي |
| `vps-service/api/telegram_routes.py` | إضافة send-daily-report endpoint |
| 80+ ملف تاني | إزالة 🚀🎉 + indigo→teal + blue→teal |

---

## ✅ القواعد الدستورية اللي اتنفذت

| القاعدة | الوصف | الحالة |
|---------|-------|--------|
| Rule 4 | لا شاشات جديدة | ✅ حذفنا النظام الموازي |
| Rule 5 | كل كود لازم يتربط | ✅ كل tabs مربوطة بـ canonical endpoints |
| Rule 20 | Python = العقل، Node = العرض | ✅ Node proxy للـ Telegram |
| Rule 21 | V40.2 = المصدر الوحيد | ✅ شيلنا simple_analysis fallback |
| Rule 28 | لا تكرار | ✅ توحيد StatCard + format + VALID_VIEWS |
| Rule 29 | نظام متكامل | ✅ كل حاجة مربوطة |
| Rule 30 | أسلوب احترافي | ✅ إزالة 🚀🎉 + مصطلحات تقنية |
| Rule 31 | لا عبارات تحميسية | ✅ 0 🚀🎉 |
| Rule 34 | مشروع واحد متكامل | ✅ لا تكرار شاشات |

---

## 🔍 كيفية تشخيص المشاكل المستقبلية

### لو فيه خطأ في الشاشة:
1. افتح Browser DevTools → Console
2. شوف الـ error
3. ارجع للـ commit الأخير: `git log --oneline -5`
4. لو المشكلة من تعديل معين: `git diff <commit> -- <file>`

### لو فيه API بيرجع 502/503:
1. تأكد إن Python backend شغال: `pm2 status python-backend`
2. تأكد إن الـ endpoint موجود: `grep -rn "route.*endpoint" vps-service/api/`
3. لو الـ Node route فيها logic (مش proxy): دي مخالفة Rule 20

### لو فيه تكرار في الكود:
1. grep للدالة/المكوّن: `grep -rln "function XYZ" src/`
2. لو فيه أكتر من نسخة: وحد في `src/lib/` أو `src/components/ui/`

### لو فيه 🚀🎉 رجعوا:
1. `grep -rn "🚀\|🎉" src/components/`
2. شيلهم + commit

---

**انتهى التقرير. أي مشكلة مستقبلية ارجع للملف ده.**

---

## 🆕 تحديثات الجلسة (2026-09-01) — الموديولات الجديدة المرتبطة بـ V40.2

> **ملاحظة:** كل الموديولات الجديدة بـ feature flags default OFF عشان ما تؤثرش على الإنتاج الحالي. التحقق تم بـ grep + Read على الكود الفعلي.

### الموديولات المضافة (مراجعة Fixes Report)

| الـ module | LOC | الـ feature flag | الوصف |
|---|---:|---|---|
| `analyzers/egx_disclosure_engine.py` | 875 | `V40_2_DISCLOSURE_IMPACT` | 12 نوع إفصاح + dynamic scoring (-2 لـ +2). VETO → hard reject. |
| `analyzers/strict_entry_filters.py` | 582 | `V40_2_STRICT_ENTRY` | Don't Chase: is_in_accumulation + is_liquidity_grab + is_late_entry. |
| `analyzers/short_holding_exit.py` | 614 | `V40_2_SHORT_HOLDING` / `V40_2_DISTRIBUTION_EXIT` | **مُعاد كتابته بفلسفة هيكلية** — `max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة. أضاف `is_within_typical_correction` + `is_breakdown_not_correction` (جسر مع النوتبوك). |
| `analyzers/unified_exit_engine.py` | 518 | `V40_2_UNIFIED_EXIT` | `MARKET_PROFILES` (STOCKS + CRYPTO) + `evaluate_unified_force_exit()`. يوحّد الخروج. |
| `analyzers/stock_notebook.py` | 1,065 | `V40_2_NOTEBOOK_CONTEXT` | 259 ملف JSON في `notebooks/EGX/` + `apply_notebook_context()` + `build_or_refresh_notebook()` + `build_notebooks_for_universe()`. 30 سهم معمّق. |
| `analyzers/decision_logger.py` | 338 | — | `log_decision()` + `get_decision_stats()` + `db/decision_log.db`. |
| `analyzers/news_fetcher_analyzer.py` | 507 | `V40_2_NEWS_IMPACT` | DuckDuckGo + sentiment (-2 لـ +2). 22 سهم EGX. |
| `analyzers/news_impact_scorer.py` | 432 | (يُستخدم في news_agent) | 14 event types + verdict (BOOST/REDUCE/VETO). |
| `analyzers/crypto_strict_filters.py` | 448 | `V40_2_CRYPTO_STRICT_ENTRY` | نظير EGX بـ thresholds مكيّفة لـ 24/7. |
| `analyzers/crypto_short_holding_exit.py` | 412 | (مدمج في unified) | نظير EGX بـ ساعات بدل أيام. |
| `analyzers/crypto_news_fetcher.py` | 391 | `V40_2_CRYPTO_NEWS_IMPACT` | نظير EGX للكريبتو. |
| `analyzers/crypto_disclosure_engine.py` | 412 | `V40_2_CRYPTO_DISCLOSURE_IMPACT` | نظير EGX لأحداث الكريبتو. |
| `api/notebook_routes.py` | 124 | — | 7 endpoints + مسجّل blueprint (`notebook_bp`) في `lightweight_server.py`. |
| `src/components/admin/NotebookAdminTab.tsx` | 524 | — | مستورد في AdminView — UI لإدارة النوتبوكس. |
| `ai/news_signals_reader.py` + `src/app/api/news/ingest/route.ts` | — | — | جسر News Agent خارجي + `apply_news_bias_to_score()`. |

### الـ 10 Feature Flags (كلها default OFF)

| Flag | الـ module | التأثير لو ON |
|---|---|---|
| `V40_2_STRICT_ENTRY` | strict_entry_filters.py | Don't Chase |
| `V40_2_DISCLOSURE_IMPACT` | egx_disclosure_engine.py | تأثير الإفصاحات (-2/+2) |
| `V40_2_NOTEBOOK_CONTEXT` | stock_notebook.py | سياق النوتبوك |
| `V40_2_SHORT_HOLDING` | short_holding_exit.py | خروج هيكلي |
| `V40_2_DISTRIBUTION_EXIT` | short_holding_exit.py::detect_distribution | شمعة التوزيع |
| `V40_2_NEWS_IMPACT` | news_fetcher_analyzer.py | تأثير الأخبار |
| `V40_2_CRYPTO_STRICT_ENTRY` | crypto_strict_filters.py | نسخة الكريبتو |
| `V40_2_CRYPTO_DISCLOSURE_IMPACT` | crypto_disclosure_engine.py | نسخة الكريبتو |
| `V40_2_CRYPTO_NEWS_IMPACT` | crypto_news_fetcher.py | نسخة الكريبتو |
| `V40_2_UNIFIED_EXIT` | unified_exit_engine.py | توحيد الخروج |

### باك-تست B0/B1/B2/B3 (200 سهم × 6 شهور)

| السيناريو | Trades | WR | Return | ملاحظة |
|---|---:|---:|---:|---|
| **B0 (baseline)** | 31 | 45.2% | +41.2% | كل flags OFF — الإنتاج الحالي |
| **B1 (strict entry ON)** | 14 | 35.7% | -17.6% | رفض كتير → صفقات أقل + خسارة |
| **B2 (strict + widened stop)** | 14 (4 stop_widened) | — | -18.8% | اتساع الوقف ما ساعدش |
| **B3 (structural exit ON)** | 14 | — | — | **لا exit واحد من نوع max_holding ✅** — الفلسفة الهيكلية شغّالة |

### القواعد الدستورية المرتبطة (CONSTITUTION Rules 36-40)

- **Rule 36 (DISCLOSURE-ENGINE):** `egx_disclosure_engine.py` — الإفصاحات الرسمية كمصدر وحيد.
- **Rule 37 (STRICT-ENTRY):** `strict_entry_filters.py` — تراكم أو Liquidity Grab فقط.
- **Rule 38 (SHORT-HOLDING — محدّثة 2026-09-01):** `short_holding_exit.py` — فلسفة هيكلية بدل زمنية. `max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة. الأولوية: distribution > early_drop > compound_breakdown > review_alert.
- **Rule 39 (DISTRIBUTION-EXIT):** `short_holding_exit.py::detect_distribution()` — شمعة التوزيع كإشارة خروج.
- **Rule 40 (NEWS-FETCHER-ANALYZER):** `news_fetcher_analyzer.py` — DuckDuckGo + sentiment analysis.

### كيفية التراجع

كل الـ feature flags default OFF. لو أي flag سبب مشكلة:
1. `unset V40_2_<FLAG>` أو `export V40_2_<FLAG>=0`.
2. `pm2 restart python-backend`.
3. النظام بيرجع لـ baseline (B0).

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-10-04 | `02-SCREENS_AND_COMPONENTS.md` | Wave 8 Update (Task `28-C` — Documentation Secretariat): تحديث علامة "آخر تحديث" لـ 2026-10-04. تحديث §0 Screen Status Rollup — إضافة row 18b (`#sharia` view — Task 23-C — commits `324a095` + `704aa0c`) + تحديث row 21 (`admin` — 16+ → 20+ sub-tabs incl. NEW Wave 8 Sharia management + Source Authority + Validation Monitor + Cron Health). تحديث §0 الإحصائيات — API routes 653→**411** (Wave 8 restored 32 Flutter endpoints) + components 294→**250** (+3 Sharia components — `ShariaView.tsx` + `ShariaBadge.tsx` + `ShariaStockCard.tsx`) + hash views 45→46 (added `#sharia`) + NEW color system (emerald-600 per Task 24 — 6 commits `e8ba231` + `10023ce` + `b2eb109` + `3abda17` + `ce9ff97` + `fc90fa4`) + NEW typography (Cairo + tabular figures) + NEW card shadows + hover lift + body emerald radial gradient. إضافة §0.7 جديد "Sharia Module + Wave 8 Visual Redesign + Admin Tabs" — جدول 3 Sharia components (Purpose + Wiring) + جدول 6 visual redesign commits + جدول 4 NEW admin tabs (Sharia ✅ executed `f413bd7` / Source Authority ⏳ / Validation Monitor ⏳ / Cron Health ⏳). تحديث §9.1 AdminView dynamic imports — إضافة `<ShariaAdminTab />` (NEW — Wave 8 — commit `f413bd7`) + note للـ 3 tabs المتبقية (PENDING). Per Rule 62 + Rule 63 + README editing rule 1. |
| 2026-09-30 | `02-SCREENS_AND_COMPONENTS.md` | REORG-PHASE-7-DOCS: تحديث علامة "آخر تحديث" لـ 2026-09-30. إضافة §0.4 جديد "Module Mapping (2026-09-30)" — خرائط كل hash view للموديول بتاعه في `src/modules/<module>/` (25 hash view × module mapping table + P1 follow-up notes). مرجعية لـ `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` + Rule 60 (MODULE-SYSTEM). لم تُحذف أي محتويات. |
| 2026-09-01 | `FIXES_REPORT_2026-08-30.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تحديثات الجلسة (2026-09-01)" — جدول 15 موديول جديد + الـ 10 Feature Flags + باك-تست B0/B1/B2/B3 + القواعد الدستورية 36-40 + كيفية التراجع. |
| 2026-10-01 | `02-SCREENS_AND_COMPONENTS.md` | WAVE-2-3-DOCS (Documentation Secretariat catching up on backlog): تحديث علامة "آخر تحديث" لـ 2026-10-01. إضافة §0.5 جديد "Wave 2 Cleanup Delta" — جدول 121 frontend dead files archived to `archive/wave-2-cleanup-2026-10-01/` (16 shadcn UI primitives + 12 legacy + 14 admin + 7 remaining + 18 lib TS) + 6 false positives caught + skipped + HTTP 500 restore + 9 commits list. إضافة §0.6 جديد "Wave 3 Consolidation Delta" — جدول 8 Wave-3 changes (#learning archived + #academy wired + MarketAnalysisView 6,450→297 LOC + 5 radar tabs moved to MakerRadarTab + NetPicksTab duplicate deleted + PersonalizedRadarTab bug fixed + StockDetailDrawer moved out of Tabs + i18n Phase 1 — 5 components migrated, messages 130→460 LOC). تحديث §0.4 module count summary (294→247 components verified via `find`). تحديث §2.3 (#learning removed from VALID_VIEWS + #academy single canonical). تحديث §4.1 (MarketAnalysisView 6,450→297 LOC, PicksManagementView ARCHIVED, AcademyView 73→717 LOC). تحديث §6.1 (MarketAnalysisView 5 main tabs post-Wave-3 + 5 radar tabs moved). تحديث §10 (Wave 2 archive summary — 436 files + 3 Wave 3 education files). لم تُحذف أي محتويات قديمة — هذا تحديث metadata + إضافة أقسام جديدة فقط. Per Rule 62 (Secretary updates docs after every task) + README editing rule 1 (last-updated + changelog row in-file). |
| 2026-10-05 | `02-SCREENS_AND_COMPONENTS.md` | CALC-CONSOLIDATION-PHASE-1 + BACKTEST-ANALYSIS + SCREENS-SURVEY-2026-10-05 (3 sub-tasks في session واحد): تحديث علامة "آخر تحديث" لـ 2026-10-05. **(1)** حذف `src/lib/cache/precomputed-cache.ts` (1010 LOC orphaned) + STRIP-CALCS من `publish-data/route.ts` + `portfolio/rescue/route.ts` (Rule 54 CALCULATION-CANONICAL — commit `bbbb6cbb` pushed). إضافة §15 جديد "CALC-CONSOLIDATION (Rule 54 — Phase 1 done + Phase 2/3 plan)". **(2)** تحليل backtest 4 شهور (533 tickers / 25,978 trades / WR=47.1% / PF=1.43) — اكتشاف CRITICAL bug (SELL signals producing +49% gains → backtest لا يطبق signal direction) + 3 tuning proposals. إضافة §16 جديد "BACKTEST-ANALYSIS (4-month diagnosis + tuning proposals)". **(3)** Inventory كامل من أرض الواقع: 53 hash views (23 active + 30 hidden) + 16 card components (8,903 LOC) + Telegram publishing (39 files، ~21,312 LOC). إضافة §17 جديد "SCREENS-SURVEY-2026-10-05 (Ground-truth inventory)". Per Rule 62 + Rule 63. |

---

## 15. CALC-CONSOLIDATION (Rule 54 — Phase 1 done + Phase 2/3 plan)

> **المرجع الدستوري:** Rule 54 (CALCULATION-CANONICAL) في `00-CONSTITUTION.md` + `vps-service/analyzers/indicators/__init__.py` (canonical Python package).
>
> **القاعدة الثابتة:** كل حساب فني (ATR / RSI / SRSI / SMA / EMA / MACD / Bollinger) لازم يصدر من **مكان واحد بس** — Python `vps-service/analyzers/indicators/`. ممنوع أي duplicate في TS.

### 15.1 المصدر الـ canonical (Python)

| Function | Algorithm | File |
|---|---|---|
| `calc_atr` | Wilder's smoothing `atr=(atr×(p-1)+tr)/p`, seed = SMA of first `p` TRs | `vps-service/analyzers/indicators/atr.py` |
| `calc_rsi` | Wilder's smoothing `avg=(avg×(p-1)+val)/p`, seed = SMA of first `p` gains/losses | `vps-service/analyzers/indicators/rsi.py` |
| `calc_srsi` | Stochastic RSI (Chande & Kroll 1994) | `vps-service/analyzers/indicators/srsi.py` |
| `sma` | `sum(data[-period:])/period` | `vps-service/analyzers/indicators/ma.py` |
| `ema` | recursive `k=2/(period+1)`, seed = SMA of first `p` | `vps-service/analyzers/indicators/ma.py` |
| `macd` | EMA(12) − EMA(26), signal = EMA(9) of MACD line | `vps-service/analyzers/indicators/ma.py` |
| `bollinger_bands` | ⏳ **MISSING** — يحتاج إضافة لـ `ma.py` (4 TS files بتـ يحسبوه محلياً) | — |

### 15.2 Phase 1 — Done (commit `bbbb6cbb` — pushed 2026-10-05)

| # | File | LOC before | Action | Status |
|---|------|-----------|--------|--------|
| 1 | `src/lib/cache/precomputed-cache.ts` | 1010 | **DELETE** — orphaned (zero imports عبر `src/` — verified per Rule 16). كان فيه `calculateSMA`/`calculateEMA`/`calculateRSI`/`calculateMACD`/`calculateBollingerBands`/`calculateATR` (كلها Wilder's ✅ بس duplicate). | ✅ deleted |
| 2 | `src/app/api/stocks/[ticker]/publish-data/route.ts` | 529 → 496 | **STRIP-CALCS** — حذف `computeRSI`/`sma`/`atr`. الـ `atr` كان **BUGGY** (SMA بدلاً من Wilder's → كان يfeeds ATR خاطئ في Telegram publish flow لما Python يكون unreachable). الـ route بـ Python-first أصلاً. في fallback: المؤشرات بقرأ من `stocks.db.{rsi,ma_50,ma_200}` + `predictions.db.predictions.atr_at_entry`. | ✅ stripped |
| 3 | `src/app/api/portfolio/rescue/route.ts` | 551 → 526 | **STRIP-CALCS** — حذف `sma`/`ema`/`rsi` (كانت Wilder's ✅ بس duplicate). بقرأ من `stocks.db` pre-computed columns. `supportResistance` + `weinsteinStage` اتسابوا (analytics هيكلية مش canonical indicators). | ✅ stripped |

**Phase 1 impact:**
- 1,563 LOC deleted (1010 + 33 + 25)
- 1 critical bug fixed (buggy ATR-SMA في Telegram publish flow)
- 0 behavioral regression لما Python يكون up (الـ route بـ Python-first أصلاً)
- لما Python يكون down: المؤشرات بترجع `undefined` + error string بدلاً من قيم خاطئة (Rule 27)

### 15.3 Phase 2 — Deferred (client components + crypto route)

| # | File | LOC | Functions | Recommended fix | Severity |
|---|------|-----|-----------|------------------|----------|
| 4 | `src/app/api/crypto/full-analysis/route.ts` | 374 | `sma`/`ema`/`rsi`/`atr`/`bollinger` (lines 47–95). **BUG: RSI + ATR SMA-based مش Wilder's.** | **STRIP-CALCS** — return `null` لكل indicator fields. Pre-requisite: إضافة `/api/indicators/compute` endpoint في Python يقبل OHLC array. | HIGH (feeds crypto charts) |
| 5 | ~~`src/modules/crypto/components/CryptoAdvancedAnalysisView.tsx`~~ | ~~705~~ | 🗑️ **محذوف/أرشيف** (ORPHAN-GARAGE-COLLECTOR 2026-10-12 → `archive/dead-components-20261012/crypto/`). كان `computeRSI` (line 682). Wilder's ✅. | ✅ **RESOLVED** (محذوف/أرشيف — 0 importers حية) | ~~MEDIUM~~ ✅ |
| 6 | `src/modules/stock-analysis/components/TradingViewChart.tsx` | 2112 | `calcSMA`/`calcEMA`/`calcBollingerBands`/`calcRSI`/`calcMACD`/`calcStochastic`/`calcATR`/`calcOBV`. **BUG: RSI + ATR SMA-based.** | **DELETE** if orphaned (لا imports) — likely dead code تم استبداله بـ `InteractiveChart`. | MEDIUM (orphan?) |
| 7 | `src/modules/market-analysis/components/InteractiveChart.tsx` | 1695 | `calcEMA`/`calcMACD`/`calcOBV`/`calcFibLevels`. MACD بـ Python-first (good model). | **PARTIAL** — غيّر MACD fallback لـ "render no MACD pane" بدلاً من local calc. EMA9/EMA21/VolMA20 overlays → ضع comment "UX overlay — not used in trading signals". | LOW (mostly Python-first) |
| 8 | `src/modules/education/components/EntryTimingSimulator.tsx` | 968 | `sma` + `rsi2` (RSI(2) Connors variant). | **EXCEPTION-EDUCATIONAL** — استنى مع comment صريح: "Educational simulator — RSI(2) Connors variant، not for production signals. Production RSI(14) Wilder's comes from Python canonical `analyzers/indicators/`." لو orphaned → DELETE. | LOW (educational) |
| 9 | `src/app/api/deal-advisor/[ticker]/route.ts` | 977 | **NONE** — بيقرأ pre-computed `rsi`/`ma_50`/`ma_200` من `stocks.db` (no local calc). | **N/A** — بس ضع data-sources note أن القيم MUST تأتي من Python canonical upstream. | NONE |

### 15.4 Phase 3 — Deferred (backtest verification logic)

| # | File | LOC | Functions | Recommended fix | Severity |
|---|------|-----|-----------|------------------|----------|
| 10 | ~~`src/lib/honest-tracking/maestro.ts`~~ | ~~1862~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كان `sma`/`rsi`/`atr`/`bollingerWidth`/`detectCandlestick` (parallel Node stack — 76KB). كان فيه BUG: RSI + ATR SMA-based. بيـ re-compute indicators من price history عشان يتحقق من past predictions. أرشيف في `archive/maestro-dead-code-20261012/`.Used by 5 routes (`/api/admin/generate-historical-predictions` [410 Gone] + `/api/predictions/honest-tracking/{list,stats,learn-from-errors,live-tracking}` [all converted لـ pure proxy في RULE20-PURE-PROXY]). الـ routes كلها بـ تستخدم Python canonical دلوقتي. | ✅ **RESOLVED** (محذوف نهائياً + الـ routes اتحولت لـ pure proxy) |

### 15.5 Cross-cutting recommendation

أضف `bollinger_bands` function لـ Python canonical `vps-service/analyzers/indicators/ma.py` عشان Bollinger يكون له single source of truth. حالياً 4 TS files بتـ يحسبوه محلياً (population std `÷period`). بعد إضافة Python canonical، الـ 4 files يتـ migrated:
- ~~`src/lib/cache/precomputed-cache.ts`~~ (اتمسح في Phase 1)
- `src/app/api/crypto/full-analysis/route.ts` (Phase 2)
- `src/modules/stock-analysis/components/TradingViewChart.tsx` (Phase 2)
- `src/modules/market-analysis/components/InteractiveChart.tsx` (Python-first already — OK)

---

## 16. BACKTEST-ANALYSIS (4-month diagnosis + tuning proposals)

> **المصدر:** `scripts/output/backtest_4months_all_stocks.json` (تم تشغيله في commit `80860337`).
>
> **المرجع الدستوري:** Rule 54 (CALCULATION-CANONICAL — الـ indicators في الـ backtest لازم تيجي من Python canonical عشان الـ verification يكون سليم).

### 16.1 الإحصائيات الإجمالية

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

### 16.2 Per-month breakdown

| Month | Trades | Wins | WR | Avg Return | ملاحظة |
|-------|--------|------|-----|------------|--------|
| 2026-05 | 10,807 | 5,085 | **47.1%** | +1.14% | أكبر شهر — Likely too many signals (low-quality filtering) |
| 2026-06 | 5,226 | 2,918 | **55.8%** | +3.63% | تحسّن |
| 2026-07 | 4,724 | 2,872 | **60.8%** | +4.69% | **Best month** |
| 2026-08 | 4,724 | 2,130 | **45.1%** | +1.96% | انخفاض حاد — possible regime shift |
| 2026-09 | 497 | 186 | **37.4%** | −1.09% | عينة صغيرة + أداء سيئ — تحقق من data quality |

**الملاحظة:** May شال 41.6% من total trades (10,807 من 25,978) لكن بأقل avg return (+1.14%). ده معناه إن الـ model كان بـ يولّد signals كتير في May بأقل selectivity. لو رفعنا threshold الـ STRONG_BUY، عدد trades هيقل لكن avg return هيزيد.

### 16.3 Signal distribution

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

### 16.4 🚨 CRITICAL bug — SELL signals producing +49% gains

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

### 16.5 Top losers — same-ticker concentration

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

### 16.6 Tuning proposals

#### A. Scoring tuning (target: WR ≥ 50%)

| # | التغيير | الآلية المتوقعة | التأثير المتوقع |
|---|---------|-----------------|-----------------|
| A1 | **رفع STRONG_BUY threshold** من master_score ≥ 70 → ≥ 80 | cuts ~50% من STRONG_BUY signals (المارچنال ones) | WR ↑ 2–4pp، trades ↓ 4,000–5,000 |
| A2 | **Liquidity gate على STRONG_BUY** | `avg_turnover_20d ≥ 5M EGP` مطلوبة لـ STRONG_BUY. لو أقل → downgrade لـ BUY. | filters out low-liquidity names زي GTHE/MKIT اللي بـ gap down |
| A3 | **Per-ticker circuit breaker** | بعد 2 consecutive losing trades على نفس ticker → suppress STRONG_BUY لـ 5 trading days. | يمنع تكرار GTHE × 5 / MKIT × 2 / HDBK × 2 |
| A4 | **Rebalance signal distribution** | target: 40% bullish / 30% hold / 30% bearish (currently 66% / 15% / 19%). راجع scoring weights. | يخلي الـ model يتفاعل مع bearish regimes (زي Aug/Sep) |

#### B. Stop/target tuning (target: PF ≥ 1.5)

| # | التغيير | الآلية المتوقعة | التأثير المتوقع |
|---|---------|-----------------|-----------------|
| B1 | **ATR-based stop** | استبدال fixed % stop بـ `1.5 × ATR(14)` below entry (adaptive لـ volatility) | avg_loss يبقى adaptive بدلاً من fixed 6.32% |
| B2 | **Trailing stop after +1R** | لما trade يوصل +1×(entry−stop) → حرّك stop لـ breakeven | يقفل الـ winners كـ wins بدلاً من round-trip losses |
| B3 | **ATR-based target** | `2.5 × ATR` target (R:R = 1.67 at indicator level) | يحافظ على R:R الحالي بس بـ volatility-adaptive |
| B4 | **Tighter stop على STRONG_BUY** | 1.0×ATR (tighter) لـ STRONG_BUY / 1.5×ATR لـ BUY / 2.0×ATR لـ HOLD | عشان STRONG_BUY signals بـ تـ blow up أكتر، stop أضيق يقلل avg_loss |

#### C. Critical bug fix (pre-requisite لأي tuning)

| # | التغيير | الآلية | الأولوية |
|---|---------|--------|----------|
| C1 | **إصلاح SELL-signal backtest bug** | in `scripts/backtest_4months_all_stocks.py` (or الـ script اللي ولّد JSON)، احسب `actual_return` بـ signal direction. re-run backtest بعد الإصلاح. | **P0 — قبل أي tuning** |

#### D. Data quality investigation

| # | التغيير | الآلية | الأولوية |
|---|---------|--------|----------|
| D1 | **September anomaly** | 497 trades بس بـ −1.09% avg — تحقق من price_history coverage للـ September 2026. ممكن يكون في data gap. | P1 |
| D2 | **August WR drop** (60.8% → 45.1%) | تحقق من regime shift — هل في news event / market crash في early August 2026؟ راجع news.db. | P1 |
| D3 | **GTHE concentration** | تحقق لو GTHE كان suspended أو had corporate action (split / dividend) في أغسطس 2026 → الـ price data ممكن يكون corrupt. | P1 |

### 16.7 الخلاصة

- **WR=47.1%, PF=1.43** — تحت الـ target (≥50% / ≥1.5) بس فوق breakeven (36.8%). في edge فعلي.
- **CRITICAL bug: SELL signals بـ تـ produce +49% gains** → backtest لا يطبق signal direction. لازم إصلاح قبل أي tuning.
- **8 من 10 top losers هم STRONG_BUY** → model over-confident. ينقصه: (1) رفع threshold، (2) liquidity gate، (3) per-ticker circuit breaker.
- **R:R=1.71 سليم** بس PF أقل من المتوقع → variance من slippage / gap-downs.
- **3 tuning proposals جاهزة للـ discussion** (scoring / stop-target / bug fix) — بانتظار قرار المالك قبل التنفيذ.

---

## 17. SCREENS-SURVEY-2026-10-05 (Ground-truth inventory)

> **المصدر:** audit آلي لـ `src/app/page.tsx` + `src/lib/valid-views.ts` + `src/components/layout/TopBar.tsx` + grep عبر `src/components/market/` + `src/modules/publishing/components/` + `src/modules/*/components/`.
>
> **المرجع الدستوري:** Rule 3 (لا تُنشئ صفحات Next.js جديدة) + Rule 20 (Python = العقل، Node = عرض فقط) + Rule 25 (VERIFY-BEFORE-DELETE).

### 17.1 Hash views inventory (53 entries في `VALID_VIEWS`)

**Total hash views:** **53** (موزّعة كالتالي):
- ✅ **Active / visible in TopBar:** **23** (21 nav + 2 user-menu)
- 🚫 **Hidden / legacy / backwards-compat (still rendered):** **30** (incl. 11 `crypto-*` redirects)
- 🚫 **Admin-only stub:** **2** (`prediction-performance`, `prediction-credibility`)

#### 17.1A Active / visible in TopBar (23)

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

#### 17.1B Hidden / legacy / backwards-compat (30)

`#top-performers` (merged into #stock-filters) · `#screener` (alias #trading-chart) · `#finance` (alias #portfolio) · `#analysis` / `#v2-analysis` / `#advanced-analysis` (alias #recommendations) · `#unified-analysis` · `#prediction-tracking` · `#picks-management` (REMOVED 2026-09-28) · `#dual-track` · `#v82` · `#bagholder-rescue` (merged into #portfolio) · `#advanced-portfolio` · `#seasonality` · `#smart-confluence` · `#wealth` (merged into #portfolio) · `#trading-journal` · `#publishing` · `#backtesting` (مخفية/قديمة) · `#auth` · `#admin` · **11 `crypto-*` redirects** (`#crypto` → DashboardView, `#crypto-live` → StocksView, `#crypto-portfolio`, `#crypto-watchlist`, `#crypto-recommendations` → MarketAnalysisView, `#crypto-analysis` → SmartConfluenceView, `#crypto-learning` → AcademyView per Rule 63, `#crypto-simulation` → SimulationView, `#crypto-trading-chart` → TradingChartView, `#crypto-prediction-tracking` → CryptoPredictionTrackingView, `#crypto-screener` → StockScreenerAdvanced).

### 17.2 Card components inventory (16 files، 8,903 LOC)

> كل الـ cards نشطة (0 orphaned / deprecated) — merges الـ 3 السابقة (MERGE-PREDICTION-CARDS + MERGE-LIST-CARDS + TELEGRAM-LINK) كلها نجحت.

#### 17.2A `src/components/market/` (9 publish-style cards)

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

#### 17.2B `src/modules/publishing/components/` (7 components، 5,689 LOC)

| # | File | LOC | Component | Renders | Status |
|---|------|-----|-----------|---------|--------|
| 10 | `StockInfographicModal.tsx` | 334 | `StockInfographicModal` | Dialog مع live `StockInfographicCard` preview + 3 export buttons (PNG / Telegram / Clipboard). POSTs image multipart إلى `/api/telegram/publish-stock` (admin-only). | ACTIVE |
| 11 | `ShareButton.tsx` | 449 | `ShareButton` | Generic share (Telegram/WhatsApp/Facebook/Twitter URL share-urls only — no bot API) | ACTIVE |
| 12 | `TradeResultsGenerator.tsx` | 541 | `TradeResultsGenerator` | Trade-results image generator + export | ACTIVE |
| 13 | `UnifiedPublishButton.tsx` | 754 | `UnifiedPublishButton` | Unified publish button (renders `StockInfographicModal` inside dropdown). 10 callers. | ACTIVE |
| 14 | `StockInfographicCard.tsx` | 1,027 | `StockInfographicCard` | **الكارت الموحّد** (للتحليل + النشر + Telegram bot). 7 sections: header/chart/gauge/scenarios/vision/disclaimer/footer. `cardRef` لـ html-to-image capture. | **ACTIVE (canonical infographic)** |
| 15 | `StockPublisher.tsx` | 1,128 | `StockPublisher` | Multi-tab publish Dialog. Admin "نشر على تيليجرام" button بـ render `StockInfographicCard` off-screen → capture PNG → POSTs image+caption multipart إلى `/api/telegram/publish-stock`. Fallback لـ text-only JSON. | ACTIVE |
| 16 | `TradeResultsTemplates.tsx` | 1,456 | `TradeResultsTemplates` | Templates لـ trade-results publishing | ACTIVE |

#### 17.2C الكروت بعد التوحيد

الكروت المتبقية (بعد MERGE-PREDICTION-CARDS + MERGE-LIST-CARDS + TELEGRAM-LINK):

| الكارت الموحّد | absorbed | LOC |
|----------------|----------|-----|
| `StockInfographicCard` (canonical infographic — for Telegram bot + unified analysis) | (none — original) | 1,027 |
| `PredictionsImageCard` (canonical predictions — for persona + expert predictions) | `PersonaImageCard` + `ExpertPredictionsImageCard` (دلوقتي wrappers بـ re-export) | 754 |
| `StockLeagueImageCard` (canonical list — for stock league + top trades) | `TopTradesImageCard` (دلوقتي wrapper بـ re-export) | 555 |
| `MarketStatusImageCard` (independent — for market status) | (none) | 769 |

**4 cards أساسية** بـ تغطي كل الـ publish use-cases. الـ wrappers (`PersonaImageCard` + `ExpertPredictionsImageCard` + `TopTradesImageCard`) اتسابوا عشان backward-compat imports من 8 market-analysis sub-tabs.

### 17.3 Telegram publishing integration (39 files، ~21,312 LOC)

#### 17.3A Next.js API routes (9 files، 1,244 LOC)

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

#### 17.3B Frontend admin / card-level callers (11 files، ~8,538 LOC)

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

#### 17.3C Python-side Telegram bot (19 files، ~11,530 LOC)

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

#### 17.3D Trace: `StockInfographicCard` → Telegram bot

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
| Next.js publish-stock route | optional `channel_id` from request body/form | same file:51,67 | Falls back لـ `defaultChannel` |
| Python `telegram_notifier.py:53,55` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` / `TELEGRAM_CHANNEL_ID` | lines 53-55 | `''`; channel default `@Arabian_investment_guide` |
| Python `telegram_bot_api.py:114-118` | same | lines 114-118 | `''` |
| Python `telegram_interactive_bot.py:65-66` | same | lines 65-66 | `"@Arabian_investment_guide"` |
| Python `auto_poster.py:91-92` | `bot_token`, `channel_id` (from credentials.json OR env) | lines 91-92 | `None` |
| Python `telegram_client.py:117-118` | same | lines 117-118 | `None` |
| Python `telegram_daily_lessons.py:57-58` | same | lines 57-58 | `@Arabian_investment_guide` |
| Python `telegram_target_hit_tracker.py:101-102` | same | lines 101-102 | `@Arabian_investment_guide` |
| Python `data_heartbeat_checker.py:27,34` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | lines 27,34 | `''` |

**Local env status:** `/home/z/my-project/.env` contains ONLY `DATABASE_URL=file:/home/z/my-project/db/custom.db` — **NO TELEGRAM vars are set locally**. لازم تـ تتعرّف على الـ production VPS / docker env.

#### 17.3E Three publish paths summary

| # | Path | Trigger | Flow | Output |
|---|------|---------|------|--------|
| 1 | **Infographic (admin-only)** | `StockDetail.tsx` → `<StockPublisher infographicData={...}>` | off-screen `<StockInfographicCard>` → `html-to-image` capture → multipart POST لـ `/api/telegram/publish-stock` | route calls Telegram Bot API `sendPhoto` → writes audit لـ `predictions.db` |
| 2 | **Infographic modal** | `StockDetail.tsx` + `UnifiedPublishButton` → `<StockInfographicModal>` | visible preview + capture → multipart POST لـ `/api/telegram/publish-stock` (rich HTML caption) | same endpoint |
| 3 | **Market status / list card** | `ImageCardExport` / `MarketStatusExport` / `StockLeagueImageCard` | JSON `{image, market, caption}` POST لـ `/api/market/publish-status-image` | Python backend `auto_poster.send_photo` publishes لـ `@Arabian_investment_guide` |

### 17.4 Sub-screens (tabs داخل major views)

#### 17.4A `#recommendations` (MarketAnalysisView.tsx, 297 LOC) — 5 tabs

| Tab value | Component | Purpose |
|-----------|-----------|---------|
| `predictions` (default) | `<UnifiedPredictionsTab>` | Unified predictions (3 internal sub-views: الحالية / الأداء / الملخص) |
| `status` | `<MarketStatusTab>` | Market status (winners/losers/regime) + `MarketStatusExport` publish button |
| `sectors-tracking` | `<SectorTrackingTab>` | Sector movement tracking |
| `historical-trades` | `<HistoricalTradesTable>` | 13,117 historical trades table |
| `net-picks` | `<NetPicksTab>` | "صافى التوقعات" canonical view |

#### 17.4B `#admin` (AdminView.tsx, 2,060 LOC) — 5 hubs، 28 sub-tabs

| Hub | Sub-tabs |
|-----|----------|
| **health** (المراقبة وصحة النظام) | dashboard · system-monitor · problems · cron-health (4) |
| **maestro** (المحركات والتعلم الذكي) | engine-control-room · data-engine · general · engine-settings · learning · backtest · platform-performance (7) |
| **data** (البيانات وقواعد البيانات) | databases · db-backup · system-control · news-control · news-health · sharia · source-authority · validation-monitor (8) |
| **users** (المستخدمين والاشتراكات) | user-management · users · promo-codes · pricing · feedback (5) |
| **telegram** (أدوات التسويق والنشر) | marketing-studio · reports · telegram · telegram-predictions (4) |

#### 17.4C `#academy` (AcademyView.tsx, 2,483 LOC) — 8 tabs

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

#### 17.4D `#dashboard` (DashboardView.tsx, 573 LOC)

- **No TabsTriggers** — single-page widget grid: فرص جاهزة الآن / حالة السوق / ودجات مثبتة / ملخص السوق والمؤشرات / نبض السوق / توقعات اليوم / الأكثر تحركاً / إشارات الكريبتو + `MyStocksBriefing`.

#### 17.4E `#specialist-analysis` (SpecialistAnalysisView.tsx, 1,462 LOC)

- **No TabsTriggers** — single-panel view (expert comparison).

#### 17.4F `#liquidity-radar` (MakerRadarTab.tsx) — 5 internal sub-tabs

`exit-radar` · `weekly-report` · `multi-market-radar` · `radar-accuracy` · `personalized-radar` (انتقلت من `#recommendations` per Task 9-B Step 2) + internal filter `all/quiet/pre_surge/early_break/explosive`.

> **ملاحظة ORPHAN-GARAGE-COLLECTOR (2026-10-12):** الـ tab name `personalized-radar` لسه مستخدم كـ tab identifier في `MakerRadarTab.tsx` (UI label). بس lib utility file `src/modules/personalized/lib/personalized-radar.ts` (583 LOC) **محذوف/أرشيف** → `archive/dead-components-20261012/personalized/lib/personalized-radar.ts` (0 importers حية — الـ matches كانت strings للـ tab values + testids, مش imports).

### 17.5 الإحصائيات الإجمالية (2026-10-05)

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

### 17.6 Verification confirmations

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
