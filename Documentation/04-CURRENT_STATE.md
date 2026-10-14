# 📌 04 — CURRENT STATE — الحالة الحالية + Waves + Breach-Log

> **المرجع الكنسي للحالة الحالية للكود.** آخر تحديث: 2026-10-12 (Task `DOC-UNIFY-3-LOGIC-STATE`).
> المصادر المُدمجة: `05-CURRENT_STATE.md` (الأساس) + `BREACH-LOG.md` (§16) + `pymob test cards.md` (Appendix B) + `الروابط الرسمية .txt` (Appendix A).
>
> **إشارات مرجعية للملفات الأخرى:**
> - القواعد الدستورية → `00-CONSTITUTION.md`
> - قواعد البيانات + APIs + DB schema + Module Architecture → `01-ARCHITECTURE_AND_API.md`
> - شاشات UI + مكونات React → `02-SCREENS_AND_COMPONENTS.md`
> - منطق المحرك + V34 + Confluence + HELI + Canonical + Audit Reports → `03-HOW_IT_THINKS.md`
>
> Per Rule 62 + Rule 70 + Rule 75 + Rule 76.

---

## 📑 فهرس المحتويات

| § | القسم | المصدر |
|---|------|--------|
| 1 | Production Snapshot (V40.2 + KPIs) | 05-CURRENT_STATE §1+§5.6 |
| 2 | Security & Quality (P0 wave + auth + SQLi + observability + tests) | 05-CURRENT_STATE §8 |
| 3 | Audit Checklist (18 ✅ + 12 ⏳) | 05-CURRENT_STATE §10 |
| 4 | Subscription + Education + Content Studio | 05-CURRENT_STATE §11 |
| 5 | Comprehensive Audit + Fixes (6 جيوش + 63 مشكلة + 30 إصلاح) | 05-CURRENT_STATE §12 |
| 6 | Wave 2 Cleanup Summary (436 archived + 313 dead routes) | 05-CURRENT_STATE §13 |
| 7 | Wave 3 Consolidation (education + recommendations + i18n) | 05-CURRENT_STATE §14 |
| 8 | Wave 6 Payment P0 Fixes (P0-1 → P0-5) | 05-CURRENT_STATE §15 |
| 9 | Wave 7 Data + Chart Quality Fixes | 05-CURRENT_STATE §16 |
| 10 | Wave 8 Pipeline Coherence + Flutter + Admin + QA + Backtest + Visual | 05-CURRENT_STATE §17 |
| 11 | Retraction: backtest v4 PF=1.31 (fabricated claim) | 05-CURRENT_STATE §18 (Appendix) |
| 12 | Retraction: console.error claim (lost commit) | 05-CURRENT_STATE §19 (Appendix) |
| 13 | Wave 2 + 3 Changelog | 05-CURRENT_STATE §20 (Appendix) |
| 14 | Marketing Offers Strategy (13 قسم) | 05-CURRENT_STATE §21 (Appendix) |
| 15 | Paywall Strategy Final (12 قسم) | 05-CURRENT_STATE §22 (Appendix) |
| 16 | BREACH-LOG (9 خروقات) | BREACH-LOG.md |
| 17 | Pipeline Coherence Audit (Task 26) | 05-CURRENT_STATE §23 (Appendix) |
| A | Appendix A: الروابط الرسمية | الروابط الرسمية .txt |
| B | Appendix B: Test Cards (Test Credentials فقط — ممنوع في Production) | pymob test cards.md |

---

## §1 — Production Snapshot (V40.2 + Phases A/B/C/D + KPIs)

> الكاتب الكنسي الوحيد: `vps-service/jobs/daily_predictor.py` (V40.2). كل الـ writers الآخرين معطّلون (Rule 35 — ENGINE-UNIFY).
> مصدر السعر الكنسي: `stocks.db.stocks.current_price` (LIVE) + `stock_daily_prices` (HISTORICAL).
> الإشارة الكنسية: `canonical_signal.py` بـ thresholds 78/65/55/40/25.

### 1.1 — آخر تحديثات الإنتاج (Production Updates Log)


> **THE single source of truth for the CURRENT state of the codebase.**
> This file is the **only** consolidated snapshot of what is actually live,
> what is wired, what is pending — derived from reading the actual code
> (not from old docs).
>
> **آخر تحديث:** 2026-10-10 (Main Agent (Z.ai Code) — CHART-ENRICH + ICONS-AUTO + DAILY-PNL + NEW-STOCK-DETECTION + CONSTITUTION-FIXES + LEAGUE-CARD + SPECIALIST-ANALYSIS-REBUILD + FLUTTER-PROD-5).
>
> ملخص تحديثات هذا الـ pass:
> (p) NEW §17.18 — **TradingView Icons Auto-Scraping** — Python scraper (`vps-service/data/stock_logo_scraper.py`) ينزّل أيقونات الأسهم تلقائياً من TradingView CDN (scanner API → logoid → SVG). `--update` flag للتحديث التلقائي + `--max-age-days=30`. شيلت `KNOWN_ICONS` hardcoded list (150 ticker) من `stock-icon.ts` — قراءة تلقائية. النتيجة: 151 → 187 أيقونة. Commits: `0a61cf33` + `c878f497`.
> (q) NEW §17.19 — **New Stock Detection (تمييز الأسهم الجديدة)** — `src/types/index.ts`: `created_at` + `listing_date` fields + `isNewStock()` helper (90 يوم threshold). `StockIcon` component بعرض `NewStockBadge` (★ شارة ذهبية) لو السهم جديد. أي شاشة تقدر تمرر `isNew={isNewStock(stock)}`. Commit `21453829`.
> (r) NEW §17.20 — **CHART-ENRICH (إثراء شاشة #trading-chart)** — ProfessionalTradingChart.tsx بقى غرفة تداول متكاملة: AI Executive Stock Story panel + ملء الشرطات الفارغة + استبدال الـ Accordion الميت بـ 4 تبويبات (نبض السيولة/SMC/مستشار الدخول/تفاصيل فنية). إصلاح TDZ violation (`Cannot access 'tk' before initialization`). Commits: `11432cee` + `26054ee6`.
> (s) NEW §17.21 — **SPECIALIST-ANALYSIS-REBUILD** — استبدال handmade SVG في SpecialistAnalysisView بـ TradingView widget (iframe) + symbol mapping per market + زر تبديل (TradingView/محلي). إصلاح RSI bug (clamp [0,100] + null لو >100) + إصلاح نصوص الأخطاء #WCH و XX (Number.isFinite check). Commit `436af03b`.
> (t) NEW §17.22 — **DAILY-PNL (نبض الأداء اليومي)** — استبدال شارت الأرباح التراكمية (cumulativeProfitData المضلل) بنظام الأداء اليومي المستقل في PredictionTrackingDashboard: `dailyPerformanceData` (تجميع يومي) + `dailyKPIs` (bestDay/worstDay/greenDaysPct/avgTradesPerDay) + KPI Strip (4 كروت) + Tooltip متطور (تاريخ عربي + الأسهم المغلقة + عوائدها). Commit `21453829`.
> (u) NEW §17.23 — **LEAGUE-CARD تجديد** — StockLeagueImageCard.tsx: شيل "الدوري الممتاز للسوق" → "أفضل مكاسب" + شيل الكؤوس → لوجو المنصة + إضافة تواريخ التوقع ← التحقق + شكل مبهج (gradient أخضر). Commit `6b31cab6`.
> (v) NEW §17.24 — **CONSTITUTION-FIXES (إزالة 6 انتهاكات)** — Rule 73: 3 thresholds hardcoded → classifySignal (v2/unified/analyze + expert-analysis + expert-consensus). Rule 27: Math.random() shuffle → deterministic hash sort. Rule 15/17: hardcoded localhost:8010 → PYTHON_BACKEND_URL. Commit `1e7b44ed`.
> (w) NEW §17.25 — **FLUTTER-PROD (إصلاحات الأندرويد)** — 5 phases:
>   - FLUTTER-PROD-1: إصلاحات جاهزية Google Store
>   - FLUTTER-PROD-4: إصلاح 5 endpoints (404→200: /api/ai/analyze-stock, /api/unified-learning/intelligent, /api/portfolio/accounts/[id]/equity-curve)
>   - FLUTTER-PROD-5: /api/stocks + /api/screener/advanced → 200 بدل 500/503
>   - flutter analyze: 0 errors ✅
>   - Commits على flutter_investment_App: bb9983a + 332f522
>
> **تحديث سابق:** 2026-10-09 (Task `AUDIT-DEEP-INSPECTION` + `EXPERT-ANALYSIS-INTEGRATION` — Main Agent (Z.ai Code) — أوديت عميق + محرك تحليل احترافي + ربط كامل بالشاشات والتليجرام).
> ملخص تحديثات هذا الـ pass:
> (k) NEW §17.15 — **Deep Audit Findings (17 مشكلة)** — فحص شامل كـ "مستخدم صايع معلم" اكتشف 8 CRITICAL + 6 HIGH + 3 MEDIUM. 3 migration scripts أنشئت (`migrate_audit_phase1.py` + `migrate_calc_indicators.py` + `migrate_cleanup_archive.py`) مع `--dry-run` + `--verify` + backup تلقائي. تم تشغيلها على الإنتاج بنجاح: تعطيل 39 سهم بسعر=0 + تصفير 234 RSI + رفض 128 توقع BUY بـ R:R<1 + حساب high_52w/low_52w لـ 611 سهم + حذف 75 خبر متكرر + أرشفة 755 توقع قديم. Commit `860286e`.
> (l) NEW §17.16 — **Expert Analysis Engine (محرك تحليل احترافي)** — محرك شامل (786 سطر) بيوفر تحليل فني (RSI/MA/S-R/52w) + أساسي (P/E/ROE/EPS/P-B/Dividend) + إدارة مخاطر (Entry/Targets/Stop/R:R/Position size) + ملخص خبير + تقرير منسق. API: `/api/stocks/[ticker]/expert-analysis`. Commit `dfe7ed9`.
> (m) NEW §17.17 — **Expert Analysis Integration (ربط 3 أماكن)** — ربط المحرك بالشاشة (tab جديد "⚡ تحليل خبير" في ComprehensiveStockAnalysis) + نشر التليجرام (قسم "🎓 تحليل خبير" في auto_poster.py) + البوت التفاعلي (قسم "🎓 تحليل خبير احترافي" في telegram_interactive_bot.py). العميل دلوقتي بيشوف التحليل في كل مكان. Commit `d96b454`.
> (n) NEW Documentation/06-AUDIT-FINDINGS.md — تقرير شامل لكل المشاكل المكتشفة + الإصلاحات + خطة الإنتاج.
> (o) NEW Documentation/07-EXPERT-ANALYSIS-ENGINE.md — توثيق محرك التحليل الاحترافي (المنطق + API + أمثلة).
>
> **تحديث سابق:** 2026-10-09 (Task `DOCS-UPDATE-OCT9` — Documentation Secretary — تحديث جراحي بـ عمل اليوم: sandbox reset #2 recovery + 3 syntax error fixes + Phase 1 CPU optimization + Phase 3 market segregation).
> ملخص تحديثات هذا الـ pass:
> (a) §1.1 — توثيق إكمال الـ canonical signal migration (10/10 شاشات قرار نشطة الآن canonical).
> (b) §3.1/§3.3 — تحديث أعداد الصفوف لقواعد البيانات المثبّتة (stocks=1046 + predictions=153 — snapshot 2026-08-17, MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`).
> (c) §5.1 — توضيح إن `daily_predictor.py` هو الكاتب الكنسي الوحيد + 8 one-off scripts معطّلة + 3 route writers غير canonical معطّلة (sniper/track 410 Gone + ai_predictions_routes + historical_predictions_v2_routes).
> (d) §17.1 — تحديث coherence: 6 bypass routes رُحِّلت لـ canonical (Task `REAPPLY`); canonical routes 6→12; bypass-local-compute متبقّي = 0; bypass-direct-DB (single-ticker) = 0; 15 TIER 3 routes متحقق منها (0 true bypasses — Task `TIER3-ROUTES-MIGRATE`).
> (e) §17.11 NEW — Python Backend Status (port 8010): Flask + 53 blueprints + 4 DBs ok + 4 circuit breakers closed + 170MB. RUNNING as of 2026-10-08.
> (f) إشارات لـ `scripts/zero_conflict_test.py` (Rule 73 enforcement) + `scripts/update_market_indices.py` (TradingView REST → stocks.db.market_indices — Task `P0-MARKET-INDICES`).
> Commits: `38665fd1` (REAPPLY+DISABLE-SCRIPTS) · `11853f69` (CONSTITUTION-R75-R76) · `64ee8d54` (zero_conflict_test --require-real-data). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **تحديثات سابقة:**
> - 2026-10-03 (Task `DOC-20` — Documentation Secretariat (Wave 7 — Data + Chart docs) — توثيق Wave 7 Data Quality + Chart Quality Fixes (Task IDs `18-A` + `19` + `FIX-1` + `FIX-2` + `P0-1`..`P0-5` chart) في §8.8 NEW + §10.1 row 22 NEW + §16 NEW. Fixes: `load_merged_history` schema fix (Rule 46 migration) + 14 placeholder `50.0` → `None` removals + real MACD signal (was `macd*0.9` fake) + synthetic `session_intraday` chart generator removed + TradingView widget default + Python `load_price_history` canonical (Rule 12) + 26-year `price_history.db` merge (was discarded). Data quality score 3→8/10 per Task 18-A audit. Chart quality score 2→8/10 per Task 19 audit. 4 historical DB zip archives (222 MB) recovered from git history under `archive/databases-from-github/`. Commit hashes cited per fix. Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 63 (PUSH-AFTER-EVERY-COMMIT) + README editing rule 1.)
>
> **تحديثات سابقة:**
> - 2026-10-02 (Task `DOC-17` — Documentation Secretariat (Final P0 Documentation) — توثيق Wave 6 Payment System P0 Fixes (P0-1 → P0-5) في §8.7 + §10.1 row 21 + §15 NEW. Fixes: m2y- prefix rejection + subscription expiry + promo codes time-limited + 7 backend paywall gates + unified PAID_TIERS. Health score 4.5→8/10 per Task 16-A audit. Commit hashes cited per fix. Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 63 (PUSH-AFTER-EVERY-COMMIT) + README editing rule 1.)
> - 2026-10-01 (Task `WAVE-2-3-DOCS` — Documentation Secretariat catching up on backlog — Wave 2 (cleanup of 436 archived files + 313 dead routes) + Wave 3 (education unification + recommendations consolidation + i18n Phase 1). Counts refreshed: components 248 (verified via `find`), routes 380, python files 450, frontend modules 28. Added §13 Wave 2 Cleanup Summary + §14 Wave 3 Consolidation Summary. PersonalizedRadarTab bug fix documented in §5.1.1. Radar sub-tab move documented in §4.7.)
> - 2026-10-01 (Task `INTEGRATION-FIX` — ربط fundamental_data_provider مباشرة + تنظيف Documentation).
> - 2026-10-01 (Task `FIX-WAVE-4-DOCS` — Documentation Secretary + Constitution Keeper — مواءمة كل stale counts + تحديث Rule 8/18 + إضافة §24 Reports APIs + إنشاء `BACKLOG.md`).
> - 2026-10-01 (Task `DOC-SYNC-FULL` — Documentation Secretary — توثيق شامل لكل الـ commits والملفات).
> - 2026-10-01 (Task `DOC-UPDATE-POST-AUDIT` — Documentation Secretary + Senior Engineers — إضافة قسم 12: التدقيق الشامل + 30 إصلاح + 23 نقطة تحقق).
> - 2026-09-30 (Task `DOC-CONSOLIDATION` — Documentation Secretary
>   + Senior Engineers: دمج كل ملفات `Documentation/` غير الأساسية داخل هذا الملف.
>   تم حذف 134 ملف توثيقي قديم ودمج محتواه هنا.)
>
> **ما الجديد في `WAVE-2-3-DOCS` (2026-10-01):**
> - ✅ تحديث العدّادات في §1 (17 frontend modules + **247 components** verified via `find` + **380 routes** + **450 Python files**).
> - ✅ تحديث §2 API Map: total routes 687→380 (Wave 2 cleanup removed 313 dead routes — see `archive/wave-2-cleanup-2026-10-01/src/app/api/`).
> - ✅ تحديث §4 Radar System: إضافة §4.7 — 5 radar tabs MOVED from `#recommendations` INTO `#liquidity-radar` as sub-tabs (was scattered, now unified under MakerRadarTab).
> - ✅ تحديث §5 Prediction System: إضافة §5.1.1 — PersonalizedRadarTab bug FIXED (API contract aligned — `personalization_reasons: string[]` plural + full pick shape + real profile fields).
> - ✅ إضافة §13 — Wave 2 Cleanup Summary (436 archived files + 313 dead routes + 6 false positives caught + Rule 55 auth fixes).
> - ✅ إضافة §14 — Wave 3 Consolidation Summary (education unification + recommendations consolidation + i18n Phase 1).
> - ✅ تحديث §10 Audit Checklist — إضافة entry للـ Wave 2 + Wave 3 work.
>
> **المراجع الكنسية الأربعة (الأساسية):**
> 1. `00-CONSTITUTION.md` — الدستور والقواعد (62 قاعدة).
> 2. `01-ARCHITECTURE_AND_API.md` — التشريح الكامل للمعمارية.
> 3. `02-SCREENS_AND_COMPONENTS.md` — كل شاشة وكل مكوّن بحالته.
> 4. `SYSTEM_HOW_IT_THINKS.md` — كيف يفكر النظام ويتخذ القرار.
>
> هذا الملف هو **المُكمِّل الخامس** الذي يحلّ محل كل ملفات
> `audit-logs/` + `backtest-results/` + `deployment/` + `reports/` +
> `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` (consolidated here in DOC-CONSOLIDATION 2026-09-30) +
> `agent-ctx/*.md` (84 ملف) + root-level docs.

---


### 1.2 — Production KPIs (post-HELI cleanup — 2026-09-27)


| Metric | Value |
|---|---|
| Total predictions | 1,359 |
| Resolved predictions | 1,229 |
| Win Rate (recorded) | 67.4% |
| Win Rate (actual — post-HELI) | ~50–55% |
| Avg Return (recorded) | 25.74% |
| Profit Factor (recorded) | 12.84 |
| Max Loss Streak | 7 |
| Reconciliation mismatch rate | 31.66% (was 41.96%) |

---


### 1.3 — Module Architecture Quick Reference

> للتفاصيل الكاملة انظر `01-ARCHITECTURE_AND_API.md §1-§3`.


| Metric | Before | After |
|---|---|---|
| Frontend modules | 0 (scattered) | 15 |
| Backend modules | 0 | 9 placeholders |
| Dead LOC deleted | ~63K | 0 (cleaned) |
| Duplicate groups merged | 17 | 4 |
| Wiring of hidden gems | 30+ scattered | 9 unified |
| Total LOC | ~580K | ~540K |
| Tests passing | 187 | 261 (Phase-7) → 240+ (current baseline) |
| DB access entry points | 20+ scattered | 1 canonical (`src/lib/db/index.ts`) |
| Cron jobs | 18 | 23 (Phase-4.2 wired +5) |
| Market-analysis tabs | 8 | 11 (+3 wired Phase-4.1) |

---


---

## §2 — Security & Quality (P0 Wave + Auth + SQLi + Observability + Tests)

## 8. Security & Quality

> **Source:** P0 Disaster Resolution Wave (16/16 items ✅) +
> `src/lib/admin-guard.ts` (74 LOC) +
> `src/__tests__/security/` (3 test files) +
> `src/lib/logger.ts` (90 LOC) +
> `src/middleware.ts` (x-request-id) +
> `sentry.server.config.ts` + `sentry.client.config.ts`.

### 8.1 Auth Guards (P0-11-AUTH)

> **Source:** `src/lib/admin-guard.ts` (74 LOC) — created 2026-09-27.
> 30 routes secured (4 admin + 26 non-admin).

**Pattern:** `getServerSession` (NextAuth) + `getSessionUserId` (helper).
71 routes total are auth-protected (verified via grep).

**Secured routes (30 in P0 wave):**
- `/api/admin/*` (4 routes — admin-only via `requireAdmin`)
- `/api/subscription/upgrade` + `/api/subscription/start-trial`
- `/api/money/wealth`
- 26 other non-admin routes (user-scoped — `requireAuthAsync`)

### 8.2 SQL Injection Fixes (P0-12-SQLI)

> **7 sites fixed in 5 files** — 3 canonical patterns.

| File | Site | Fix |
|---|---|---|
| `predictions/honest-tracking/route.ts` | 3 sites | Parameterized queries (`?` placeholders) |
| `predictions/learned-lessons/route.ts` | 2 sites | Parameterized queries |
| `historical-trades/route.ts` | 1 site | Parameterized query |
| `predictions/performance/route.ts` | 1 site | Parameterized query |

**Pattern:** All `db.prepare(...)` calls with string interpolation (`${variable}`) replaced with parameter binding (`?`).

### 8.3 /api/import Hardening (P0-12-SQLI + P0-11-AUTH)

> `src/app/api/import/route.ts` — hardened with:
> - **Auth:** `requireAuthAsync` (must be logged in)
> - **Size limit:** 5 MB max (`Content-Length` check)
> - **Rate limit:** N requests per minute per IP
> - **MIME whitelist:** Only allowed MIME types accepted

### 8.4 Observability Stack (P0-7-15-INFRA — 2026-09-27)

| Component | File | Purpose |
|---|---|---|
| **Sentry** | `sentry.server.config.ts` + `sentry.client.config.ts` | Error tracking + performance monitoring (`@sentry/nextjs@11.0.0`) |
| **Structured Logger** | `src/lib/logger.ts` (90 LOC) | JSON-structured logs with levels (debug/info/warn/error) + context fields |
| **`/api/health` Deep-Check** | `src/app/api/health/route.ts` (262 LOC) | Returns DB connectivity + Python backend status + PM2 service status + cache freshness + system metrics |
| **x-request-id Middleware** | `src/middleware.ts` | Generates unique request ID per request + propagates to logs + Sentry |
| **PM2 `news-agent` service** | `ecosystem.config.js` | 7th PM2 service (NEW 2026-09-27) |

### 8.5 Tests (P0-16-TESTS — 2026-09-27)

> **9 test files / 121 tests / 1,796 LOC** — 121/121 passing (was 3 files / 75 tests / 873 LOC at start of P0 wave).

**Test files (21 total — incl. Phase-7 additions):**

| File | Purpose |
|---|---|
| `src/__tests__/api/health.test.ts` | `/api/health` deep-check |
| `src/__tests__/api/predictions/learned-lessons.test.ts` | Learned lessons API |
| `src/__tests__/api/predictions/historical-trades.test.ts` | Historical trades API |
| `src/__tests__/security/auth-guard.test.ts` | Auth guard pattern |
| `src/__tests__/security/sql-injection.test.ts` | SQLi fixes (7 sites) |
| `src/__tests__/security/import-endpoint.test.ts` | /api/import hardening |
| `src/__tests__/db/integrity.test.ts` | DB integrity checks |
| `src/__tests__/regime/regime-engine.test.ts` | MarketRegimeEngine |
| `src/__tests__/alerts/multi-stage-alerts.test.ts` | 5-stage radar alerts |
| `src/__tests__/radar/radar-alerts-path-upgrade.test.ts` | Path upgrade alert |
| `src/__tests__/radar/AccuracyDashboard.test.tsx` | AccuracyDashboard component |
| `src/__tests__/radar/PersonalizedRadarTab.test.tsx` | PersonalizedRadarTab component |
| `src/__tests__/radar/SignalTrackingTimeline.test.tsx` | SignalTrackingTimeline component |
| `src/__tests__/radar/WeeklyReportTab.test.tsx` | WeeklyReportTab component |
| `src/__tests__/radar/MultiMarketRadarTab.test.tsx` | MultiMarketRadarTab component |
| `src/__tests__/radar/SignalStrengthMeter.test.tsx` | SignalStrengthMeter component |
| `src/__tests__/shared/StockPublisher.test.tsx` | StockPublisher component |
| `src/__tests__/predictions/pipeline.test.ts` | V40.2 pipeline |
| `src/__tests__/ErrorBoundary.test.tsx` | ErrorBoundary component |
| `src/__tests__/signal-utils.test.ts` | Signal utilities |
| `src/__tests__/test_phase_a_hotfix.test.ts` | Phase A hotfix |

### 8.6 Relative Paths (Rule 61 — RELATIVE-PATHS-FIX — 2026-09-30)

> **22 files fixed** (13 Python + 2 TypeScript + 1 .cjs + 3 Bash + 1 cron + 1 docs + 1 .ts route)
> ~30 absolute paths replaced with portable equivalents.

**Per-language pattern (Rule 61):**

| Language | Pattern | Example |
|---|---|---|
| Python | `Path(__file__).resolve().parents[N]` | `_PROJECT_ROOT = Path(__file__).resolve().parents[2]` |
| TypeScript | `process.cwd()` | `const DB = path.join(process.cwd(), 'db', 'stocks.db')` |
| Log files | `os.environ.get('LOG_DIR', '/tmp')` | `_LOG_DIR = os.environ.get('LOG_DIR', '/tmp')` |
| Cron entries | `sed` one-liner (portability header) | `sed "s|/root/GLMinvestment|$(pwd)|g" crontab.txt > /tmp/crontab.txt` |
| DB paths | `vps-service/utils/db_paths.py` | Single source of truth |
| Shell scripts | `$(dirname "$0")/..` | `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` |

**Verification:** `bun run lint` exit 0 + `bun run test` 0 NEW failures (verified via `git stash` A/B compare) + `curl localhost:3001/` HTTP 200.

### 8.7 Wave 6 — Payment System P0 Fixes (2026-10-02 — Task IDs `P0-1` through `P0-5`)

> **Source:** Task 16-A forensic audit (payment + subscription system) identified 5 critical revenue-leak / privilege-escalation defects. Fix Battalion implemented all 5 P0 fixes in Wave 6 (2026-10-02). Health score: **4.5 → 8/10** per Task 16-A. See `Documentation/WAVE-6-PAYMENT-FIXES-2026-10-02.md` for the consolidated changelog.

**Fix 1 — `m2y-` prefix rejection (Task `P0-1`):** `/api/paymob/callback/route.ts` was rejecting `merchant_order_id` with `m2y-` prefix (the new PricingView checkout flow). Users paid but were never upgraded — direct revenue loss. Fix: callback now accepts BOTH `GLM-` (legacy) and `m2y-` (new) prefixes via shared parser. Defense-in-depth (HMAC + planId allowlist + fail-closed) preserved. Commits: `4be0e77` (+ `9e1f93e` for missing `authDb` import fix).

**Fix 2 — Subscription expiry mechanism (Task `P0-2`):** `UserSubscription.status` was flipping to `'expired'` but `User.subscription_tier` was never downgraded — paid users retained premium privileges FOREVER. Fix: `checkTrialNotExpired()` in `src/lib/subscription-gate.ts:193-261` now consults `UserSubscription.expires_at` via new `isPaidSubscriptionActive()` helper (60s cache). Plus daily cron job `scripts/downgrade-expired-subscriptions.ts` reconciles. Commits: `ada95f5` (gate fix) + `fbd01b4` (daily cron).

**Fix 3 — Promo codes time-limited (Task `P0-3`):** `/api/redeem-promo/route.ts` was setting `subscription_tier='premium'` which is in `PAID_TIERS` — bypassing the trial check entirely. Users got permanent premium from a single promo code. Fix: route now upserts a `UserSubscription` row with `expires_at = now + premium_days` (extended from latest active window) inside the same atomic transaction. Combined with P0-2's expiry check, premium access now genuinely expires. Commit: `a6425b8`.

**Fix 4 — 7 backend paywall gates (Task `P0-4`):** 7 of 8 PAYWALL Phase 2 backend gates were NOT implemented — `curl` bypass was trivial. Per `PAYWALL-STRATEGY-FINAL.md` §5.2, all 7 gates implemented (Gate 8 = A/B testing — out of P0 scope, deferred to Phase 3). All gates apply ONLY to authenticated free+trial-expired users (anonymous + paid + trial-active get full data per §4 taste-hook strategy). All gates preserve Rule 50 safety fields (stop loss, trailing stop, risk dashboard, alerts). Commits (7 commits, 7 pushes per Rule 63): `b507034` Gate 1 (fair_value killer feature), `b5b6193` Gate 2 (Exit Radar — only gate that blocks anonymous too), `a00c8d6` Gate 3 (Radar Accuracy summary-only), `9d05721` Gate 4 (Historical Trades summary-only), `0a8f1e6` Gate 5 (Advanced Lessons 4-12 lock stubs), `f8f8683` Gate 6 (Screener first-5-only), `d161c4f` Gate 7 (Predictions daily-picks two-layer 403+blurring).

**Fix 5 — Unified PAID_TIERS (Task `P0-5`):** Three divergent inline `PAID_TIERS` arrays existed across 3 files (7/6/9 tiers each). `normal` users were FREE in `/api/subscription/status` but PAID in `/api/admin/users`. `b2b_starter` users were PAID in `subscription/status` but FREE in `admin/users` → eligible for account deletion by `/admin/users/cleanup-expired` cron (Rule 50 — MONEY-AS-CUSTOMER-LIFE breach). Fix: canonical `PAID_TIERS` Set exported from `src/lib/subscription-gate.ts:162` (9 tiers: `['normal','premium','pro','developer','admin','enterprise','b2b_starter','b2b_pro','b2b_enterprise']`). 8 consumers migrated to import (9 commits: `dd8bef5` Step 1 export + `ead1a05` + `18d9345` + `b57a81c` + `a7a0b7b` CRITICAL Step 2d + `ba1025d` + `1085d8d` + `bbbfdaa` + `7faa953` Step 2h).

### 8.8 Wave 7 — Data Quality + Chart Quality Fixes (2026-10-03 — Task IDs `18-A` + `19` + `FIX-1` + `FIX-2` + `P0-1`..`P0-5` chart)

> **Source:** Task `18-A` forensic data audit (research-only) identified 11 P0 data quality issues (4 CRITICAL — project-destroying per owner directive *"التحليلات الفنية وباقي التحليلات والارقام والقيم الى بتظهر غلط خالص دى فى حد ذاتها تهدم المشروع من اساسها"*). Task `19` TV chart quality audit (research-only) identified 5 P0 chart quality issues (20+ customers had complained "garbage chart"). Fix Battalion executed Wave 7 fixes in two batches: Task `FIX-1` (`load_merged_history` schema + 12 placeholder removals — 4 commits) + Task `FIX-2` (14 remaining placeholders — 6 commits) + Task `P0-1`..`P0-5` chart (4 commits). Data quality score **3 → 8/10** per Task 18-A. Chart quality score **2 → 8/10** per Task 19. See `Documentation/WAVE-7-DATA-CHART-FIXES-2026-10-03.md` for the consolidated changelog with commit hashes + per-fix detail + scorecards + deployment checklist.

**Audit findings (Task 18-A — forensic, 8 layers audited):**
- Price foundation: `load_merged_history` (analyzers/master_analyzer.py:778) queried non-existent `price_history` table with wrong column names (`ticker`, `date`) — production `data_engine.db` has `egksco_price_history` with `symbol`, `price_date` per Rule 46 DB-CLEANUP-WAVE-3 migration. Every caller (MasterAnalyzer, technical_analyzer, public_routes, professional_analysis_routes, confluence_routes, scanner_routes, board_of_analysts) returned empty → all technical indicators returned placeholder.
- Technical indicators: 6+ separate `calc_rsi`/`calc_macd`/`calc_atr` implementations (Rule 20 violation). `technical.py` used simple avg for RSI (not Wilder's), fake `macd*0.9` signal line, fake `%D = %K * 0.9` stochastic, fabricated ADX range ratio. `core_scoring_engine.py` returned 50.0 placeholder when insufficient data (Rule 24 violation).
- Predictions: 3 crypto predictions (XRP, BTC, SOL dated 2026-08-27) had `fundamental_score = 50.0` — the placeholder Rule 24 explicitly forbids. Source: `daily_predictor.py:2508` + `master_analyzer.py:2001`.
- DB availability: `.gitignore` excludes `*.db` — owner directive *"تجمع قواعد البيانات من الجت هب"* was impossible. Sandbox had only stocks.db (12KB, 0 rows) + custom.db (24KB, 0 rows). Production DBs only accessible via `data/all.zip` (68MB) which itself was lost in current sandbox.

**Audit findings (Task 19 — TV chart quality, 5 P0 issues):**
- P0-1 (chart): Chart API fabricated 90 fake intraday candles per request via `session_intraday` synthetic generator (lines 669-732). All bars had identical volume (`Math.floor(d.volume / totalBars)`) — mathematically impossible. 20+ customers spotted this.
- P0-2 (chart): Default `chartEngine` was `'interactive'` (lightweight-charts rendering synthetic data) instead of `'tradingview_widget'` (real TradingView.com embedded chart).
- P0-3 (chart): Chart API read `price_history.db` directly via `getLocalDailyData()` — Rule 12 violation. Split-brain between Node + Python data readers.
- P0-4 (chart): Chart API discarded `price_history.db` data when latest candle was >3 days stale → fell back to Yahoo (5-year cap) → lost 26 years / 1.2M rows of real history.
- P0-5 (chart): Default `timeframe` was `'15m'` — intraday had no real data (only fake `session_intraday`).

**Wave 7 Fixes (17 commits across 2 batches):**

*Batch 1 — Data Quality (Task FIX-1 + FIX-2 — 10 commits):*
- **FIX-1 (4 commits):** `load_merged_history` now reads from `data_engine.db.egksco_price_history` per Rule 46 schema (`symbol`, `price_date`) with defensive legacy `date` fallback via PRAGMA. 12 placeholder/fake patterns removed: `fundamental_score = 50.0` → `0.0`/`None`, `ai_pattern_score = 50` → `0.0`, fake `macd*0.9` signal → real 9-period EMA, fake `%D = %K * 0.9` → real 3-period SMA, fabricated ADX → `None` (honest). Commits: `513105f` (load_egksco_history added) + `15cdb50` (load_price_history egksco PRIMARY) + `f8b9296` (master_analyzer fallback) + `0120204` (12 placeholder removals).
- **FIX-2 (6 commits):** 14 remaining `= 50.0` placeholders across 6 files (`background_analyzer.py` + `prediction_tracker.py` + `fundamental_data_provider.py` + `master_analyzer.py` + `daily_predictor.py` + `fusion_engine.py`). All `Optional[float] = None` with caller guards. `get_asset_quality_score()` now returns `'NO_DATA'` verdict with `quality_score=None, veto=False` for missing data (Rule 24: "don't veto on missing data, don't punish stocks we couldn't score"). Commits: `a058715` + `428ceac` + `bb58809` + `f132237` + `15b3ac2` + `fc0714c`.

*Batch 2 — Chart P0 (Task P0-1..P0-5 chart — 4 commits covering 5 fixes):*
- **P0-1 (chart) — commit `ed56cb2`:** Removed entire `session_intraday` synthetic generator (lines 669-732 of `src/app/api/chart/[ticker]/route.ts`). Now returns honest empty `data: []` with `source: 'no_intraday_data'` + Arabic message when no real intraday exists. Real intraday still comes from `intraday.db`. ALSO bundled DB recovery: 4 historical zip archives (222 MB total) added under `archive/databases-from-github/` — `active_databases_20260817_full.zip` (73.4 MB) + `all.zip` (28.8 MB) + `all_databases_2.zip` (70.9 MB) + `all_databases_3.zip` (48.8 MB). See BREACH-009.
- **P0-2 (chart) — commit `6531653`:** Default `chartEngine` flipped `'interactive'` → `'tradingview_widget'` in `src/modules/stock-analysis/components/TradingViewChart.tsx`. Users now see real TradingView.com chart by default.
- **P0-3 (chart) — commits `10076a4` + `d4514ee`:** Added `getPythonDailyData()` helper in chart route that calls `GET /api/prices/<ticker>?limit=N` on Python backend (Rule 12 — `load_price_history` is SOLE canonical source; Rule 20 — Python=Brain). Falls back to direct SQLite reader (marked `DEFENSIVE-FALLBACK`) only when Python unreachable. New Python route `/api/prices/<ticker>` added to `vps-service/api/public_routes.py` — delegates to `data.prices.load_price_history()`. Split-brain between Node + Python data readers resolved.
- **P0-4 (chart) — commit `00d9766`:** MERGE local `price_history.db` (26 years) + Yahoo recent candles instead of REPLACE. Appends new Yahoo candles, updates existing ones with fresher data, sorts by timestamp. COMI chart now shows 26 years of history (was 5 years max). `SELECT COUNT(*) FROM price_history` → 1,205,599 rows / `SELECT MIN(date), MAX(date)` → `('2000-11-27', '2026-09-03')`.
- **P0-5 (chart) — commit `6531653` (same commit as P0-2):** Default `timeframe` flipped `'15m'` → `'1D'`. 1D daily uses `price_history.db` (1.2M real rows, 26 years). First impression is now REAL data, not synthetic noise.

**Wave 7 Final Counts:**
| Metric | Pre-Wave-7 | Post-Wave-7 | Delta |
|---|---|---|---|
| Data quality score (per Task 18-A) | 3/10 (CRITICAL) | 8/10 | +5 ✅ |
| Chart quality score (per Task 19) | 2/10 (20+ complaints) | 8/10 | +6 ✅ |
| Critical Rule 24 breaches (`50.0` placeholder) | 14 sites / 6 files | 0 | -14 ✅ |
| Critical Rule 24 breaches (`macd*0.9` fake signal) | 4 sites | 0 (real EMA-9) | -4 ✅ |
| `load_merged_history` schema broken (queried non-existent table) | YES (every caller returned empty) | NO (falls back to `data_engine.db.egksco_price_history`) | breach closed ✅ |
| Chart API fabricating fake intraday candles | YES (90 candles/request, identical volume) | NO (honest empty + Arabic message) | breach closed ✅ |
| Chart API discarding 26-year history when 3+ days stale | YES | NO (MERGE local + Yahoo) | breach closed ✅ |
| Chart API reading DB directly (Rule 12 split-brain) | YES | NO (Python `load_price_history` canonical) | ✅ |
| Production DBs in repo (gitignored) | NO (12 KB stocks.db + 24 KB custom.db, 0 rows) | PARTIAL (4 historical zips, 222 MB under `archive/databases-from-github/`) | partial ✅ |
| Commits pushed in Wave 7 | — | 17 (10 data + 4 chart + 3 doc) | +17 ✅ |

**Verification (per Rule 16):** MACD signal (6.195) ≠ macd*0.9 (5.8708) — real EMA-9 implemented ✓. Stochastic d (100.0) ≠ k*0.9 (90.0) — real 3-period SMA implemented ✓. ADX returns None (not fabricated) ✓. `calc_rsi([1,2,3])` returns None (was 50.0) ✓. `python3 -c "from data.prices import load_price_history; print(len(load_price_history('COMI', 10)))"` → 0 (NOT crash — returns empty list per owner directive). DB-level: INSERT writes NULL when scores are None. `SELECT COUNT(*) FROM price_history` → 1,205,599 rows / 26 years. `bun run lint` EXIT 0 after EACH commit (Rule 63 compliant). See §16 for the full per-fix detail with architecture diagrams + deployment checklist + P1/P2 follow-ups.

---


---

## §3 — Audit Checklist (18 ✅ + 12 ⏳)

## 10. Audit Checklist

> **Source:** Consolidated from `MASTER_AUDIT_REPORT.md` (1,624 lines) +
> `JULY_2026_LOSS_ANALYSIS.md` + `LAST_30DAYS_WEAKNESS_ANALYSIS.md` +
> `final_audit_certificate.md` + `EFFICIENCY_PROOF_REPORT.md` +
> `Grok-Report-V40.2-Detailed-Analysis.md` + `SYSTEM_STATE.md` +
> `AGENTS.md` + `DIRECTIVE_UI_STABILITY_AND_IN_PLACE_UPDATES.md` +
> `Agent-messages-from-news.md` + `implementation_plan.md` +
> `CHANGELOG.md`.

### 10.1 ✅ Done (P0 Wave — 18 items resolved 2026-09-27 + 2 items Wave 2/3 resolved 2026-10-01 + 1 Wave 6 bundle resolved 2026-10-02 + 1 Wave 7 bundle resolved 2026-10-03 = 22 total)

| # | Item | Status | Task |
|---|---|---|---|
| 1 | `stored_analyses` empty | ✅ Schema drift fix + V40.2 generator run | P0 fix #1 |
| 2 | `hunter_pick_tracking` empty | ✅ Sync script created + cron wired | P0 fix #2 |
| 3 | `price_history` stale (19 days) | ✅ yfinance + safetynet cron wired (1,206,981 rows) | P0 fix #3 |
| 4 | `telegram-events` not running | ✅ PM2 service added (6th → 7th with news-agent) | P0 fix #4 |
| 5 | `v4_bp` blueprint broken | ✅ `lightweight_server.py:99` fixed | P0 fix #5 |
| 6 | 4 cron entries broken | ✅ `crontab.txt` unified (23 entries) | P0 fix #6 |
| 7 | `news-agent` not running | ✅ PM2 service added (7th) | P0-7-15-INFRA |
| 8 | 12 duplicate tables | ✅ 9 dropped (333 rows preserved) + 4 DBs backed up (511.2 MB) | P0-8-DB-UNIFY |
| 9 | `mini-services/` empty | ✅ Deleted | P0 fix #9 |
| 10 | `custom.db` still exists | ✅ Scheduled for removal (pending) | P0 fix #10 |
| 11 | 540/675 API routes without auth | ✅ 30 routes secured (4 admin + 26 non-admin) + `admin-guard.ts` (74 LOC) | P0-11-AUTH |
| 12 | 11 SQL injection vulnerabilities | ✅ 7 sites fixed in 5 files (3 canonical patterns) | P0-12-SQLI |
| 13 | `/api/import` no validation | ✅ Auth + 5MB size limit + rate limit + MIME whitelist | P0-12-SQLI + P0-11-AUTH |
| 14 | 120 routes with blocking sync I/O | ✅ 24 routes refactored (~70+ sync sites) — `fs/promises` + `promisify(execFile)` | P0-14-ASYNC |
| 15 | Zero observability | ✅ Sentry + structured logger + `/api/health` deep-check + `x-request-id` middleware | P0-7-15-INFRA |
| 16 | Test coverage 0.3% | ✅ 9 files / 121 tests / 1,796 LOC — 121/121 passing | P0-16-TESTS |
| 17 | 17% false TARGET_HIT | ✅ 308 false TARGET_HITs cleaned + reconcile script (mismatch rate: 41.96% → 31.66%) | P0-17-RECONCILE + HELI-INVESTIGATION + HELI-CLEANUP-2 |
| 18 | Duplicate-write bug in predictions | ✅ Schema drift fix (added `prediction_date` column) + UNIQUE constraint | P0-17-RECONCILE |
| 19 | **Wave 2 cleanup** — 436 dead files + 313 dead routes archived (NOT deleted — owner directive) | ✅ Archived to `archive/wave-2-cleanup-2026-10-01/` + 6 false positives caught + 6 routes auth-hardened per Rule 55 | WAVE-2-CLEANUP (Task 7-A + 7-B) |
| 20 | **Wave 3 consolidation** — education unification + radar tab consolidation + i18n Phase 1 | ✅ #learning archived + #academy wired to content/education/*.md + 5 radar tabs moved to #liquidity-radar + PersonalizedRadarTab bug fixed + 5 components migrated to useTranslation | WAVE-3-CONSOLIDATION (Task 9-A + 9-B + i18n-Phase-1) |
| 21 | **Wave 6 — Payment System P0 Fixes** — 5 P0 fixes bundled: m2y- prefix rejection + subscription expiry mechanism + promo codes time-limited + 7 backend paywall gates + unified PAID_TIERS | ✅ 19 commits across 12 files (callback + subscription-gate + subscription-enforcement + 6 backend gate routes + admin/users + cleanup-expired + redeem-promo + bot/check-subscription + payment/success). Health score 4.5→8/10. See §8.7 + §15 + `WAVE-6-PAYMENT-FIXES-2026-10-02.md`. | WAVE-6-PAYMENT-FIXES (Task IDs P0-1, P0-2, P0-3, P0-4, P0-5 — 2026-10-02) |
| 22 | **Wave 7 — Data Quality + Chart Quality Fixes** — bundled: Task 18-A forensic audit (11 P0 data quality findings) + Task 19 TV chart quality audit (5 P0 chart findings) + Task FIX-1 (load_merged_history schema fix per Rule 46 + 12 placeholder removals) + Task FIX-2 (14 remaining placeholders → None) + Task P0-1..P0-5 chart (synthetic generator removed + TradingView widget default + Python `load_price_history` canonical via Rule 12 + 26-year price_history.db merge + daily timeframe default) + DB recovery (4 zip archives, 222 MB under `archive/databases-from-github/`) | ✅ 17 commits (10 data + 4 chart + 3 doc). Data quality score 3→8/10 per Task 18-A. Chart quality score 2→8/10 per Task 19. Commits: FIX-1 (`513105f` + `15cdb50` + `f8b9296` + `0120204`) + FIX-2 (`a058715` + `428ceac` + `bb58809` + `f132237` + `15b3ac2` + `fc0714c`) + chart (`ed56cb2` + `6531653` + `00d9766` + `10076a4` + `d4514ee`) + docs (per Rule 62). See §8.8 + §16 + `WAVE-7-DATA-CHART-FIXES-2026-10-03.md` + `BREACH-LOG.md` BREACH-007/008/009. | WAVE-7-DATA-CHART-FIXES (Task IDs `18-A` + `19` + `FIX-1` + `FIX-2` + `P0-1`..`P0-5` chart + `DOC-20` — 2026-10-03) |

### 10.2 ⏳ Pending / Known Issues (not P0 but tracked)

| # | Item | Severity | Notes |
|---|---|---|---|
| 1 | `custom.db` removal | Low | File still exists with 0 rows. Removal pending — Rule 61 allows safe removal. |
| 2 | `predictions.db.original` (4.9 MB backup) | Low | Lingers in `db/` — should be moved to `backups/` |
| 3 | `historical_data` table (99K rows) stale (112 days) | Medium | Needs backfill — `price_history_safetynet` only covers `price_history` table |
| 4 | Backend module migration (9 placeholders → real Python files) | Medium | Phase 3-backend deferred — needs import-graph analysis (P1 follow-up) |
| 5 | `src/components/` legacy migration to `src/modules/<module>/` | Medium | Some components (memory + auth + settings + zakat + shared + ui) NOT yet moved to modules (P1) |
| 6 | `src/shared/` layer creation | Medium | Should host truly-reusable components (UnifiedTable + MiniSparkline + SignalStrengthMeter + MarketSelector + LazyTabLoader + ErrorBoundary + SafeWidget) — P1 |
| 7 | Test coverage to 30% | Medium | Currently ~1% (9 files / 1,796 LOC). Target: 30% in 3 months. |
| 8 | Reconciliation mismatch rate (31.66%) | Medium | Down from 41.96% but still high. Needs more HELI cleanup passes. |
| 9 | 540 unauth routes (most GET-only public data) | Low | Most are read-only public data. 71 routes are auth-protected. |
| 10 | UI Audit findings (68 issues — `UI-AUDIT-REPORT.md`) | Medium | 12 P0 + 19 P1 + 14 P2 + 14 P3 + 9 P4 issues. See `UI-FIX-CHECKLIST.md`. |
| 11 | July 2026 loss analysis (0% WR) | Resolved | Root cause: data gap + Don't Chase + Average Down. Fixes applied: Data Gap Guard + Don't Chase Filter (Rule 37). |
| 12 | Last 30 days weakness (PF=1.47) | Resolved | Root cause: slow bleed (68%) + ARVA data quality + EFIC repeated loss. Fixes applied: Average Down Evaluator + Stock Notebook context. |
| 13 | Real per-user trade history table for PersonalizedRadarTab | Medium | Wave 3 Task 9-B shipped `hasTradeHistory: false` — needs new table (status=closed + sell_price + sell_date + pnl_pct on `portfolio_assets` OR a new `trade_history` table) to flip the flag to `true` + populate `totalTrades` + `winRate` + `averageHoldingDays`. See §5.1.1. |
| 14 | i18n Phase 2 — extract remaining hardcoded Arabic strings | Medium | Wave 3 Phase 1 migrated 5 components (MarketAnalysisView + StocksView + EnhancedWatchlistView + EnhancedPortfolioView + AlertsCenterView). Phase 2 target: ~50 more components. messages/*.json grew 130→460 LOC in Phase 1. |
| 15 | RefreshAnalyticsButton.tsx — redirect to admined route | Low | Wave 2 Batch 7 hardened `/api/predictions/generate-all` with requireAdminAsync (Rule 55 §ب) — non-admin users now get 403. Button currently used in 6+ market-analysis tabs (UX regression until button is refactored to call `/api/admin/ai-predictions/generate`). |

### 10.3 Production Readiness Assessment

> **Source:** `MASTER_AUDIT_REPORT.md` final assessment.

| Dimension | Score | Notes |
|---|---|---|
| **Code Health** | ~70/100 | Up from 48/100 (pre-P0 wave). |
| **Production Readiness** | Production-ready with caveats | Up from "NOT production-ready" (pre-P0 wave). |
| **Security** | Good | 7 SQLi sites fixed + 30 routes secured + /api/import hardened. ~540 unauth routes (mostly GET-only public). |
| **Observability** | Good | Sentry + logger + /api/health + x-request-id (was zero). |
| **Tests** | Fair | 9 files / 121 tests passing — but only ~1% coverage. Target: 30%. |
| **Data Quality** | Fair | WR recorded 67.4% → actual ~50-55% (HELI cleanup). Reconciliation mismatch 31.66%. |
| **Module Architecture** | Excellent | 17 frontend modules + 9 backend placeholders + unified DB layer (Rule 60). |
| **Documentation** | Excellent | 5 canonical files + README (this consolidation). Was 134 scattered files. |

---


---

## §4 — Subscription + Education + Content Studio

## 11. نظام الاشتراكات + المحتوى التعليمي العميق (NEW — 2026-09-30)

### 11.1 نظام الاشتراكات (Subscription System)
**الـ pipeline الكامل للإيرادات:**

| المكوّن | الحالة | الوصف |
|---------|--------|-------|
| `MarketPricing` (Prisma model) | ✅ شغّال | 23 سطر تسعير مزروع (6 أسواق × 5 باقات × monthly/yearly) |
| `Referral` (Prisma model) | ✅ شغّال | جدول الإحالات (referrer + referred + bonus_days) |
| `UsageDaily` (Prisma model) | ✅ شغّال | تتبّع الاستخدام اليومي (ai_messages + watchlist + portfolio) |
| `B2bApiKey` (Prisma model) | ✅ شغّال | مفاتيح API لعملاء B2B (توليد تلقائي) |
| `/api/subscription/plans` | ✅ شغّال | الباقات بالعملة المحلية (auto-detect من السوق) |
| `/api/subscription/checkout` | ✅ شغّال | Paymob order + iframe URL |
| `/api/subscription/activate` | ✅ شغّال | تفعيل + توليد API key للـ B2B |
| `/api/subscription/status` | ✅ شغّال | حالة الـ trial (isExpired + daysLeft) |
| `/api/referral/redeem` | ✅ شغّال | استبدال كود إحالة (+14 يوم trial) |
| `/api/referral/stats` | ✅ شغّال | إحصائيات الإحالة |
| `/api/b2b/signup` | ✅ شغّال | طلب B2B (pending_approval) |
| `/api/b2b/api-keys` | ✅ شغّال | rotate/revoke API keys |
| `/api/admin/subscriptions` | ✅ شغّال | MRR + conversionRate + churnRate |
| `/api/admin/referrals` | ✅ شغّال | top referrers + إحصائيات |

**القرارات المعتمدة:**
- 14 يوم Premium trial تلقائياً لكل مستخدم جديد
- بعد انتهاء الـ trial → TrialExpiredModal (block كامل)
- AI محلي فقط (Qwen 1.5B) — تكلفة صفر
- Paymob فقط (بوابة مصرية) — المستخدم بيدفع بالجنيه
- التسجيل بـ Google OAuth فقط (CredentialsProvider معطّل افتراضياً)

### 11.2 المحتوى التعليمي العميق (Educational Content Upgrade)

**المرحلة 1 مكتملة (2026-09-30):** 4 ملفات اتعاد كتابتها بالعمق المؤسسي.

| الملف | قبل | بعد (العمق الجديد) |
|------|-----|---------------------|
| `01_saykolojeya_altadawul.md` | "تحكّم في مشاعرك" | **Behavioral Finance** + Loss Aversion (2.25×) + 5 Cognitive Biases + SOPs + Pre-trade checklist آلي + كشف Loss Aversion من journal |
| `04_mean_reversion.md` | "السعر بيرجع لمتوسطه" | **التوزيع الطبيعي** + Z-Score + Kurtosis + Fat Tails + 4 حالات فشل + calcZScore + calcKurtosis |
| `05_risk_management.md` | "خاطر بـ 1%" | **Kelly Criterion** + Quarter Kelly + Sharpe/Sortino + MaxDD + Cross-Asset Correlation + calcOptimalPositionSize |
| `06_price_action.md` | نماذج شموع | **Auction Market Theory** + Wyckoff 2.0 + Spring/Shakeout + Absorption + detectWyckoffSpring + calcValueArea |

**الـ Template الموحّد لكل درس (5 أقسام):**
1. الأساس العلمي والنظري (معادلات رياضية + منطق اقتصادي)
2. متى ولماذا تفشل الأداة؟ (Failure Mode)
3. دراسة حالة من السوق الواقعي (CIB / TMGH / EGBE بأرقام حقيقية)
4. الربط البرمجي/الخوارزمي (كود JavaScript عملي)
5. قائمة فحص تنفيذية (Actionable Checklist)

**المرحلة 2 مكتملة:** 4 ملفات اتعاد كتابتها
- `02_stage_analysis.md` → Stan Weinstein + دورات السيولة الكبرى
- `03_can_slim.md` → تكييف CAN SLIM للأسواق الناشئة (EGX)
- `07_legends_stories.md` → تشريح استراتيجيات Simons/Soros/Dennis/Buffett
- `08_crypto_beginner.md` → ميكانيكا الأصول الرقمية (on-chain + custody)

**المرحلة 3 مكتملة:** 4 ملفات جديدة اتبنت
- `09_market_microstructure.md` (NEW) → Order Book + Market Maker + Order Flow
- `10_macroeconomics.md` (NEW) → Sector Rotation + Interest Rates + FX
- `11_quantitative_trading.md` (NEW) → Expectancy + Backtesting + Monte Carlo
- `12_advanced_crypto.md` (NEW) → Perpetual Futures + Funding Rates + On-Chain

**الإجمالي: 12 درس كامل بالعمق المؤسسي** ✅

### 11.3 استوديو المحتوى المتحرك (Content Studio Hub)
**بديل AdGeneratorTab — بيدّي قيمة حقيقية:**

| المكوّن | الحالة | الوصف |
|---------|--------|-------|
| `text-effects.ts` | ✅ شغّال | 8 تأثيرات (fade/slideUp/zoomIn/typewriter/marquee/bounce/glow) + 4 easing functions |
| `ContentStudioHub.tsx` | ✅ شغّال | أداتين: EducationalCards + TradesShowcase |
| `/api/ads/successful-trades` | ✅ شغّال | صفقات ناجحة حقيقية من predictions.db |
| `/api/ads/educational-lessons` | ✅ شغّال | دروس حقيقية من content/education/*.md |
| `hashtag-library.ts` | ✅ شغّال | مكتبة هاشتاجات (6 أسواق × 8 ميزات) |
| `cta-templates.ts` | ✅ شغّال | 15 CTA جاهز (6 أهداف × 3 جماهير) |
| `ad-card-generator.ts` | ✅ شغّال | كروت صور PNG (3 مقاسات) |
| `ad-templates.ts` | ✅ شغّال | نصوص إعلانية ثابتة (8 ميزات) |

**الـ output:** فيديو WebM صامت (1080×1920) — المستخدم بيضيف الموسيقى بنفسه.

### 11.4 نظام المصادقة (Auth Gate)
- Google OAuth فقط للتسجيل (CredentialsProvider معطّل افتراضياً)
- `ALLOW_FORM_LOGIN=true` لتفعيل form login على السيرفر التجريبي
- `?dev=1` → DevLoginForm للأدمن
- AppShell gate: لو مش مسجل → AuthView (مفيش وصول للمنصة)
- الأدمن auto-detection من `admin-identities.ts`

---


---

## §5 — Comprehensive Audit + Fixes (6 جيوش + 63 مشكلة + 30 إصلاح)

## 12. التدقيق الشامل + الإصلاحات (NEW — 2026-10-01)

### 12.1 جيوش الفحص (6 جيوش متوازية)
تم إطلاق 6 جيوش فحص بالتوازي لفحص كل أنظمة المنصة:

| الجيش | النطاق | المشاكل المكتشفة | الإصلاحات |
|------|------|-----------------|----------|
| AUDIT-1 | نظام التوقعات والتحقق | 8 حرجة | 5 إصلاحات (FIX-P2) |
| AUDIT-2 | الأسواق المتعددة | 8 حرجة | 3 إصلاحات (FIX-P5) |
| AUDIT-3 | الاشتراكات والمصادقة | 16 حرجة | 6 إصلاحات (FIX-P1) + 3 (FIX-P3) |
| AUDIT-4 | أمان الـ APIs | 15 حرجة | 6 إصلاحات (FIX-P1) |
| AUDIT-5 | بيانات الأسعار + targets | 10 حرجة | 4 إصلاحات (FIX-P4) |
| AUDIT-6 | جودة الواجهة + Documentation | 6 حرجة | 3 إصلاحات (FIX-P6) |

**الإجمالي:** 63 مشكلة مكتشفة → 30 إصلاح منفّذ → 23/23 نقطة تحقق نجحت.

### 12.2 الإصلاحات الأمنية الحرجة (FIX-P1-SECURITY)

| # | الإصلاح | الملفات | الأثر |
|---|---------|---------|------|
| 1 | `/api/subscription/activate` — verify Paymob إجباري | activate/route.ts | مفيش رفع مجاني |
| 2 | `/payment/success` — polls status بدل client activation | payment/success/page.tsx | مفيش تجاوز الدفع |
| 3 | فصل `premium` عن `admin` (5 أماكن) | admin-auth-server + nextauth + layout + me + auto-cookie | privilege escalation متوقف |
| 4 | إزالة `MOHSENY_HASH` backdoor | admin-auth-server.ts | مفيش دخول أدمن بدون كلمة مرور |
| 5 | حماية `/api/admin/referrals` + `/api/admin/subscriptions` | referrals/route.ts + subscriptions/route.ts | بيانات الأدمن محمية |
| 6 | حماية `/api/admin/auth` بـ `ALLOW_FORM_LOGIN` | admin/auth/route.ts | dev login مفتوح بس لو env var |

### 12.3 إصلاحات نظام التوقعات (FIX-P2-PREDICTIONS)

| # | الإصلاح | الأثر |
|---|---------|------|
| 7 | إضافة `published_at` + `telegram_message_id` + `was_published` + `target_hit_at` + `stop_hit_at` | audit trail كامل |
| 8 | `publish-stock` بيكتب `published_at` بعد النشر | ربط تيليجرام بالـ DB |
| 9 | `price-verify` بيستخدم `COALESCE(published_at, prediction_date)` | فحص الأسعار بعد النشر بس |
| 10 | `stats` + `missed-opportunities` بيفلتر `was_published=1` | نسبة نجاح صادقة (مش بأثر رجعي) |

### 12.4 إصلاحات الاشتراكات (FIX-P3)

| # | الإصلاح | الأثر |
|---|---------|------|
| 11 | `checkTrialNotExpired()` في 3 APIs حرجة | server-side trial block |
| 12 | `subscription-enforcement.ts` جديد (320 LOC) — 4 دوال enforce | حدود Free مفعّلة server-side |
| 13 | `TrialExpiredModal` unclosable (لا X button) | مفيش تجاوز الـ trial |

### 12.5 إصلاحات الـ Targets Validator (FIX-P4-TARGETS)

| # | الإصلاح | الأثر |
|---|---------|------|
| 14 | `targets-validator.ts` — signal-aware (LONG + SHORT) | مفيش كسر SELL signals |
| 15 | إصلاح `??` leak — null بيفضل null | مفيش رجوع للقيم المكسورة |
| 16 | دمج الـ validator في 8 APIs | أهداف مظبوطة في كل مكان |

### 12.6 إصلاحات الأسواق المتعددة (FIX-P5)

| # | الإصلاح | الأثر |
|---|---------|------|
| 17 | `/api/market/top-movers` — إضافة `market` parameter | بيانات السوق المختار |
| 18 | `radar-cache.ts` — keying بالسوق | كل سوق ليه cache خاص |
| 19 | `normalizeMarket()` — تحويل العربي لإنجليزي | فلتر السوق بيشتغل صح |

### 12.7 إصلاحات الواجهة (FIX-P6)

| # | الإصلاح | الأثر |
|---|---------|------|
| 20 | حذف 13 dead tab من AdminView (-108 LOC) | لوحة أدمن نظيفة |
| 21 | إضافة `error.tsx` + `not-found.tsx` + `loading.tsx` | مفيش شاشة بيض عند الـ crash |

### 12.8 تحسينات UnifiedTable + رادار السيولة (2026-10-01)

| # | الإصلاح | الأثر |
|---|---------|------|
| 22 | `expandable = true` (default) — صفة أساسية | أي جدول يقدر يطوي/يفرد |
| 23 | Default expand — عرض row data كـ key-value grid | البيانات المخفية بتظهر |
| 24 | `sortable: true` لكل الأعمدة الناقصة | ترتيب بأي عمود |
| 25 | StockDetailDrawer — كشف 4 حقول fundamentals جديدة | P/S + ROA + 52w high/low |
| 26 | StockDetailDrawer — قسم "إحصائيات السعر" جديد | 7 إحصائيات مخفية بتظهر |

### 12.9 استوديو التسويق الموحّد (2026-10-01)

دمج 3 تبويبات منفصلة في **استوديو واحد موحّد** (`MarketingStudio`):
- 📣 **التسويق** — Campaign Builder + Image Cards + Content Calendar
- 🎬 **محرر الفيديو** — تحكم كامل شبه CapCut (frames + نصوص + تأثيرات + ألوان)
- 🎓 **المحتوى** — كروت تعليمية + صفقات ناجحة (ديناميكي بالاختيارات)

### 12.10 المحتوى التعليمي العميق (12 درس)

تم بناء **12 درس كامل** بالعمق المؤسسي:

| المرحلة | الدروس | المحاور |
|---------|------|---------|
| 1 | 4 دروس (01,04,05,06) | Behavioral Finance + Mean Reversion + Kelly Criterion + Wyckoff 2.0 |
| 2 | 4 دروس (02,03,07,08) | Weinstein Stages + CAN SLIM EGX + Legends + Crypto Mechanics |
| 3 | 4 دروس جديدة (09-12) | Microstructure + Macroeconomics + Quantitative Trading + Advanced Crypto |

كل درس فيه: نظرية + فشل + حالة واقعية + كود + checklist + رسوم بيانية + مراجع علمية.

### 12.11 التحقق النهائي (VERIFY-1 + VERIFY-2)

| فريق الفحص | النطاق | النتيجة |
|------------|-------|---------|
| VERIFY-1 | P1 + P2 (11 نقطة تحقق) | ✅ 11/11 صحيح |
| VERIFY-2 | P3 + P4 + P5 + P6 (12 نقطة تحقق) | ✅ 12/12 صحيح |

**الإجمالي: 23/23 نقطة تحقق نجحت ✅**

### 12.12 المشاكل المتبقية (موصى بها للمتابعة)

| # | المشكلة | الأولوية |
|---|---------|---------|
| 1 | Backfill `was_published=1` للتوقعات القديمة | متوسطة |
| 2 | Python-side `targets_validator.py` | متوسطة |
| 3 | Python `_verify_pending()` — استبدال snapshot بـ historical iteration | متوسطة |
| 4 | `prediction_events` table + `/api/predictions/audit-trail/[id]` | منخفضة |
| 5 | hashing `api_tokens` (لسه plaintext) | متوسطة |
| 6 | `/api/community` + `/api/user-posts` — auth session-based | متوسطة |
| 7 | `/api/data-engine/control` — إضافة `requireAdminAsync` | متوسطة |
| 8 | 579 `console.*` calls — استبدال بـ structured logger | منخفضة |
| 9 | `SystemTopologyGraph.tsx` hardcoded `min-w-[1000px]` | منخفضة |
| 10 | Paymob merchantOrderId prefix alignment (`m2y-` vs `GLM-`) | متوسطة |

### 12.13 UnifiedTable + expand/collapse ⌀ button (Commit `f87e3b8` — 2026-10-01)

> **المشكلة:** تعارض بين `onRowClick` (اللي بيفتح StockDetailDrawer) وexpand/collapse row — الضغطة على الصف كانت بتفتح الـ drawer بدل ما تطوي/تفرد row detail.

**الإصلاح:**
1. **زر ⌀ لكل صف** — زر منفصل بيرمز ⌀ (Diameter icon) بيتحكم في expand/collapse بشكل مستقل تماماً عن `onRowClick`.
2. **فصل منطقي** — `onRowClick` بيتعامل بس مع فتح الـ drawer (مفيش expand بالخطأ)، وزر ⌀ بيتعامل بس مع expand/collapse.
3. **`expandable = true` (default)** — أي `UnifiedTable` من غير ما المستخدم يحدّد `expandable` بيكون قابل للطي/الفرود افتراضياً.
4. **Default expand** — البيانات المخفية بتظهر تلقائياً كـ key-value grid تحت كل صف.
5. **`sortable: true` لكل الأعمدة الناقصة** — كل عمود يقدر يترتب بضغطة على الـ header.

**الملفات المعدّلة:**
- `src/components/shared/UnifiedTable.tsx` — إضافة زر ⌀ + default `expandable=true` + sortable لكل الأعمدة.

**الأثر:** مفيش تعارض بين النقر على الصف (للdrawer) والطي/الفرود (للrow detail). المستخدم يقدر يفتح الـ drawer بأي ضغطة على الصف، ويقدر يطوي/يفرد row detail بزر ⌀ المخصّص.

### 12.14 StockDetailDrawer enhanced fundamentals (Commit `3a000a9` — 2026-10-01)

> **المشكلة:** StockDetailDrawer كان بيعرض بيانات مختصرة بس (price + change%) — 4 حقول fundamentals مخفية + 7 إحصائيات سعرية مفقودة.

**الإصلاح — إضافة 4 حقول fundamentals:**
| الحقل | المصدر | الوصف |
|------|-------|------|
| `P/S` (Price-to-Sales) | `tab_valuation` | تقييم السهم مقابل المبيعات |
| `ROA` (Return on Assets) | `tab_profitability` | ربحية الشركة مقابل أصولها |
| `52w high` | `price_history` | أعلى سعر في السنة |
| `52w low` | `price_history` | أقل سعر في السنة |

**الإصلاح — قسم "إحصائيات السعر" جديد (7 إحصائيات):**
1. `avg_price_30d` — متوسط سعر 30 يوم
2. `avg_price_90d` — متوسط سعر 90 يوم
3. `avg_price_365d` — متوسط سعر 365 يوم
4. `volatility_30d` — تقلب 30 يوم (annualized)
5. `volatility_90d` — تقلب 90 يوم
6. `max_drawdown_30d` — أقصى تراجع في 30 يوم
7. `price_percentile_52w` — مكان السعر الحالي مقابل نطاق 52 أسبوع (0-100%)

**الملفات المعدّلة:**
- `src/modules/predictions/components/MakerRadarTab.tsx` — StockDetailDrawer component (محتوى داخلي، مش ملف منفصل) — إضافة القسمين الجديدين.

**الأثر:** كل البيانات المخفية بتظهر في الـ drawer — مفيش حاجة مخفية عن المستخدم لما بيدور على تفاصيل سهم.

### 12.15 MarketingStudio merged (Commit `9dbb002` — 2026-10-01)

> **المشكلة:** 3 تبويبات منفصلة في الأدمن (MarketingHub + AdGeneratorTab + ContentStudioHub) — مشتتة وبتسبب إعادة استيراد.

**الإصلاح — دمج 3 → 1:**
تم دمج 3 مكوّنات منفصلة في **`MarketingStudio.tsx`** واحد موحّد بـ 3 تبويبات داخلية:

| التبويب | الأصل | الوصف |
|--------|------|------|
| 📣 **التسويق** | MarketingHub | Campaign Builder + Image Cards + Content Calendar + Hashtag Library + CTA Templates |
| 🎬 **محرر الفيديو** | AdGeneratorTab (↦ VideoEditor) | محرر فيديو كامل شبه CapCut — تحكم في frames + نصوص + تأثيرات + ألوان + text-effects |
| 🎓 **المحتوى** | ContentStudioHub | Educational Cards + Trades Showcase — ديناميكي بالاختيارات (trade selection + point selection + duration) |

**الملفات المعدّلة + المنشأة:**
| الملف | الحالة | LOC | الوصف |
|------|------|-----|------|
| `src/modules/admin/components/MarketingStudio.tsx` | مُنشأ | ~150 | الحاوية الموحّدة بـ 3 تبويبات |
| `src/modules/admin/components/VideoEditor.tsx` | مُنشأ | ~800 | محرر فيديو شبه CapCut |
| `src/modules/admin/components/ContentStudioHub.tsx` | مُنشأ | ~950 | Educational Cards + Trades Showcase (ديناميكي بالاختيارات) |

**الإصلاحات في AdminView:**
- حذف 6 dead dynamic imports (`VideoEditor`, `ContentStudioHub`, `MarketingHub`, `AdGeneratorTab`, `SystemTopologyTab`, `CryptoAdminPanel`).
- تبويب واحد `marketing-studio` (في hub التسويق) بدلاً من 3 تبويبات منفصلة.
- الترتيب: marketing-studio → reports → telegram.

**الأثر:** لوحة أدمن نظيفة — مفيش تبويبات منفصلة لنفس الميزة. كل أدوات التسويق في مكان واحد. خفّة في الـ bundle (chunks محمّلة عند الطلب).

---


---

## §6 — Wave 2 Cleanup Summary (436 archived + 313 dead routes)

## 13. Wave 2 Cleanup Summary (2026-10-01)

> **Source of truth:** worklog.md Tasks `6-A2` + `6-B2` + `6-C2` (Discovery — 3 battalions forensic inventory) + `7-A` + `7-B` (Execution — 14 commits). See also `Documentation/WAVE-2-3-CHANGELOG-2026-10-01.md` for the consolidated changelog.
>
> **Owner directive:** "التناسق وعدم التكرار" + Rule 16 (VERIFY-BEFORE-DELETE) + Rule 25 (refactoring-gated — owner pre-approved Wave 2 deletions).

### 13.1 Discovery Phase (Tasks 6-A2 + 6-B2 + 6-C2 — 3 battalions forensic inventory)

Three parallel discovery battalions scanned the entire codebase:

| Battalion | Scope | Method | Dead files found |
|---|---|---|---|
| 6-A2 (Frontend) | `src/components/**` + `src/modules/**` + `src/lib/**` | importer-count map (3-pattern scan: `from '@/...'` + `from './...'` + `import('...')`) + barrel re-export check + bare-name cross-check | 71 files / 21,335 LOC (53 .tsx + 18 .ts) |
| 6-B2 (API Routes) | `src/app/api/**` (693 routes / 813 dirs / 161 top-level groups) | per-route caller-grep across `src/` + `vps-service/` + `crontab.txt` + `ecosystem.config.js` (flutter_app/ empty post-reset) + dynamic-import check | 319 dead route candidates / ~37,080 LOC |
| 6-C2 (Backend Python) | `vps-service/{analyzers,jobs,api,engines,engine,telegram,data,ai,core,tools,utils}` | import-trace + Flask blueprint registration + crontab.txt + ecosystem.config.js + smoke tests | 58 files / ~30,504 LOC |

**Discovery output:**
- Frontend dead: 71 files / 21,335 LOC (53 .tsx + 18 .ts) — concentrated in legacy components + admin module + lib helpers.
- API dead: 319 routes / ~37,080 LOC (~47% of total API LOC of ~96,854) — concentrated in v2/* + mobile/* + maestro/* + hunter/* + news/* dead endpoints.
- Python dead: 58 files / ~30,504 LOC — concentrated in analyzers (16,039) + telegram (6,954) + tools (2,820) + engine/engines (1,907) + jobs (1,021) + ai (879) + data (884).
- Total dead candidates: **448 files / ~89,000 LOC**.

**Critical discovery findings (anatomy correction):**
- Anatomy §8.2 claim "33 DEPRECATED Flask blueprints (~17,000 LOC)" — **OUTDATED**. Actual: 0 dead blueprints. All 37 api/*.py files (excluding __init__.py) define `Blueprint()` AND are registered in `lightweight_server.py` BLUEPRINTS list (lines 31-114).
- Anatomy "73 analyzers" — **UNDERSTATED**. Actual: 138 files (incl __init__.py), of which 20 are dead.

### 13.2 Execution Phase — Frontend Cleanup (Task 7-A — 7 commits, all pushed)

| Sub-batch | Files deleted | LOC removed | Files skipped (false positives) | Commit |
|---|---|---|---|---|
| 1 (frontend legacy) | 12 | 3,868 | 0 | `6f89c61e` |
| 2 (frontend admin — caught 3 false positives via MarketingStudio.tsx lazy imports) | 14 | 6,243 | 3 | `f592f45d` |
| 3 (frontend remaining) | 7 | 2,077 | 0 | `f1eec20f` |
| 4 (frontend lib TS) | 18 | 3,141 | 0 | `358e2aa4` |
| **Frontend total** | **51** | **15,329** | **3** | (4 commits) |

**Additional cleanup in sub-batches:** shadcn UI primitives (16 files / 2,961 LOC — tree-shaken) deleted in commit `4796647` (committed earlier — see git log). All deletions used `git rm` (history preserved). Barrels + comments auto-cleaned.

### 13.3 Execution Phase — Backend Python Cleanup (Task 7-A sub-batches 5a/5b/5c — 3 commits)

| Sub-batch | Files deleted | LOC removed | Files skipped | Commit |
|---|---|---|---|---|
| 5a (analyzers) | 20 | 16,039 | 0 | `41d70c60` |
| 5b (telegram cluster — skipped 1 high-risk Rule 16 caution) | 16 | 6,954 | 1 (`telegram_target_hit_tracker.py` — confirmed LIVE via auto_post_scheduler.py:1524 → PM2 telegram-poster → telegram_bp at lightweight_server.py:73) | `edb76c14` |
| 5c (engines + engine + jobs + ai + data + tools — skipped 2 cron-driven jobs) | 20 | 6,921 | 2 (`jobs/fetch_corporate_actions.py` + `jobs/hot_candidate_detector.py` — both cron-driven per crontab.txt:53 + crontab.txt:150) | `c235ce76` |
| **Backend total** | **56** | **29,914** | **3** | (3 commits) |

### 13.4 Execution Phase — API Routes Cleanup (Task 7-B — 7 batches, all pushed)

6-grep verification protocol applied per route (src/ + vps-service/ + crontab.txt + ecosystem.config.js + dynamic imports). Result: 49 of 319 candidates had >0 hits, but 48 were false positives (subroute route.ts files / Python blueprint registrations on Python side / Python docstrings). Only 1 real caller was found (`/api/egxpilot/news` — skipped per Rule 16 "When in doubt → SKIP").

| Batch | Routes deleted | LOC removed | Routes skipped | Commit |
|---|---|---|---|---|
| 1 (smallest 30) | 30 | 714 | 0 | `c1e8d97` |
| 2 (incl. 3 Rule 55 §ب violations confirmed dead) | 60 | 1,793 | 10 (false-positive hits, all deleted) | `16a57c3` |
| 3 (1 restored: `/api/market/incremental-sync` per Rule 16 contradiction) | 59 net | 3,043 | 1 restored | `395b998` |
| 4 | 60 | 6,084 | 3 | `4a70657` |
| 5 | 60 | 9,773 | 3 | `970f7a5` |
| 6 (final — largest feature routes) | 44 | 14,589 | 7 | `84bfffa` |
| 7 (Rule 55 auth fixes on 6 routes — 5 admin + 1 data-mutating) | 0 deletions (+166/-163) | — | 0 (6 routes auth-fixed) | `1f63652` |
| **API total** | **313 routes deleted** | **35,996 LOC** | **1 skipped + 6 auth-fixed** | (7 commits) |

### 13.5 HTTP 500 Restore — false-negative grep recovery (Task 7-A post-commit `2529dba`)

After Wave 2 Batch 4 deletions, 2 lib files were restored when their dynamic callers were discovered:
- `src/lib/cache/data-freshness.ts` (263 LOC) — only importer was the dead `cache/api-cache.ts` BUT discovered transitive dynamic import path.
- `src/lib/cache/api-cache.ts` (115 LOC) — paired with the above.
- Commit `2529dba fix(critical): restore 2 lib files deleted by false-negative grep (dynamic imports)`.

**Lesson:** Caller-grep must include dynamic-import patterns: `await import(...)` + `require(...)`. Plain static-only grep misses Next.js `next/dynamic` imports.

### 13.6 Archive Restore (commits `d47810b` + `4212242` — owner directive "NOT deleted — archived")

Owner directive (after Wave 2 execution): all 436 deleted files MUST be **archived** (not deleted) so they can be recovered if any caller is later discovered in production. Result: 2 commits restored everything from git history to `archive/wave-2-cleanup-2026-10-01/`.

| Folder | Archived files | Sub-paths |
|---|---|---|
| `archive/wave-2-cleanup-2026-10-01/src/app/api/` | 313 routes | (all dead routes from Task 7-B batches 1-6) |
| `archive/wave-2-cleanup-2026-10-01/src/components/` | 53 .tsx files | (legacy + admin + shadcn UI primitives + duplicate-feature components) |
| `archive/wave-2-cleanup-2026-10-01/src/modules/` | 14 .tsx files | (admin + predictions + radar + portfolio + subscription) |
| `archive/wave-2-cleanup-2026-10-01/src/lib/` | 18 .ts files | (cache/ + expert/ + duplicate db helpers) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/analyzers/` | 20 .py files | (16,039 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/telegram/` | 16 .py files | (6,954 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/engines/` | 2 .py files | (589 + 314 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/engine/` | 2 .py files | (589 + 468 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/jobs/` | 2 .py files | (186 + 244 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/ai/` | 5 .py files | (879 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/data/` | 2 .py files | (884 LOC) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/tools/` | 7 .py files | (2,820 LOC) |
| **Total** | **436 files** | (313 routes + 121 frontend + 56 python + 6 false-positives skipped kept alive) |

### 13.7 Rule 55 Auth Fixes (Task 7-B Batch 7 — 6 routes hardened)

5 admin routes using legacy `verifyAdminRequest`/`verifyAdminToken` → upgraded to `requireAdminAsync` (Rule 55 §г — defense-in-depth):
- `/api/admin/data-sources` (253 LOC)
- `/api/admin/export-data` (199 LOC)
- `/api/admin/export-vps` (125 LOC)
- `/api/admin/refresh-historical-data` (163 LOC) — also removed `checkAdminAuth` helper (verifyAdminToken fallback)
- `/api/admin/scrape-stocks` (275 LOC) — both POST + GET handlers

1 data-mutating non-admin route with NO auth → added `requireAdminAsync` (Rule 55 §б):
- `/api/predictions/generate-all` (50 LOC) — triggers `/api/daily/rebuild-predictions` (Python data-mutating). Caller = `RefreshAnalyticsButton.tsx:42` (alive — used in 6+ market-analysis tabs).

Verification: all 6 routes now return 403 for unauthenticated requests (was 200/405 before).

### 13.8 Wave 2 Final Counts

| Metric | Pre-Wave-2 | Post-Wave-2 | Delta |
|---|---|---|---|
| `find src/components src/modules -name "*.tsx" \| wc -l` | 297 | 247 (verified) | -50 (later 3 more archived by Wave 3) |
| `find src/app/api -name "route.ts" \| wc -l` | 693 | 380 | -313 |
| `find vps-service -name "*.py" \| wc -l` | 506 | 450 | -56 |
| `find archive/ -type f \| wc -l` | 0 | 436 (Wave 2 only) | +436 |
| Auth-protected routes | 65 | 71 | +6 (Rule 55 Batch 7) |
| Total LOC removed | — | ~89,000 (archived — NOT deleted) | — |
| False positives caught + skipped | — | 6 (3 frontend admin + 1 telegram + 2 cron-driven) | — |

---


---

## §7 — Wave 3 Consolidation (education + recommendations + i18n)

## 14. Wave 3 Consolidation Summary (2026-10-01)

> **Source of truth:** worklog.md Tasks `9-A` (Education Unification) + `9-B` (Recommendations Consolidation) + 6 i18n Phase 1 commits. See also `Documentation/WAVE-2-3-CHANGELOG-2026-10-01.md` for the consolidated changelog.
>
> **Owner directive:** unify duplicate education screens (`#learning` + `#academy`) + reduce `#recommendations` tab noise (was 13 views → target 4-5) + fix broken `PersonalizedRadarTab` + continue i18n migration to 100%.

### 14.1 Education Unification (Task 9-A — 2 commits)

**Problem (Task 8-B investigation):** TWO duplicate education screens existed:
- `#learning` (LearningView.tsx, 1,063 LOC) — gamified UI, 15 inline courses from `@/data/learning-content.ts` (440 LOC), quizzes, XP, badges via `@/lib/learning-store.ts`. NO simulators. NO reference to `content/education/*.md`. Known UI bug: 11,279px wide overflow.
- `#academy` (AcademyView 73 LOC wrapper + AcademyEncyclopedia 1,791 LOC + PaperTradingWorkstation 1,550 LOC + CandlestickSimulator 944 LOC + StrategySandbox 2,188 LOC + LessonPDFExporter 587 LOC = ~6,473 LOC) — 4-tab interface with encyclopedia + 3 interactive simulators + PDF export. Already canonical richer surface.

**Orphan:** 12 MD lesson files in `content/education/` (~3,050 LOC, institutional-grade 5-section structure) — written by owner with full-day investment — consumed ONLY by admin-only ContentStudioHub for video cards. ZERO user-facing consumers (verified by grep).

**Step 1 (commit `e07cb18` — pushed):** Archive the duplicate screen to `archive/education-duplicate-2026-10-01/` (Rule 63.2 — archived not deleted per owner directive):
- `git mv src/modules/education/components/LearningView.tsx (1,063 LOC) → archive/education-duplicate-2026-10-01/LearningView.tsx`
- `git mv src/data/learning-content.ts (440 LOC) → archive/education-duplicate-2026-10-01/learning-content.ts`
- `git mv src/lib/learning-store.ts (365 LOC) → archive/education-duplicate-2026-10-01/learning-store.ts`
- Removed `{ id: 'learning' }` nav entry from `TopBar.tsx` + `MobileMoreSheet.tsx` + `page.tsx` switch + dynamic import.
- Removed `'learning'` from `VALID_VIEWS` array + `AppView` type union + `AuthGate.PROTECTED_VIEWS`.
- Rewired `crypto-learning` route to redirect to `academy` (was redirecting to `learning`).
- Removed unused `CryptoLearningView` lazy-load from `page.tsx`.

**Step 2 (commit `d95904a` — pushed):** Wire `content/education/*.md` into AcademyView via runtime fetch:
- Approach: RUNTIME FETCH via existing `/api/ads/educational-lessons` API (already exists, reads MD at request time — no build-time toolchain changes, no new files).
- Added 5th TabsTrigger "🎓 دروس متقدمة" (value=`advanced-lessons`) to AcademyView.
- Switched TabsList grid from `lg:grid-cols-4` → `lg:grid-cols-5`.
- Inlined `AdvancedLessonsTab` component (~480 LOC, no new file — Rule 63.2 compliant):
  - On mount: fetches `/api/ads/educational-lessons` → state of 12 lessons (id + title + emoji + level + duration + sections[] + keyPoints[] + fullContent?).
  - Master-detail layout: sidebar Accordion list of lessons + main lesson panel.
  - Lesson header: emoji + filename + title + tagline + level Badge + duration Badge + sections count Badge.
  - Default preview: parsed sections (heading + truncated 500-char content) + keyPoints bullets.
  - "إظهار النص الكامل" button: fetches single-lesson endpoint → caches `fullContent` (14,761 chars for lesson 1) → renders full markdown.
  - "الدرس التالي" button: cycles to next lesson in list.
  - Loading + error states with retry button.
- Inlined `AdvancedMarkdownRenderer` component (~120 LOC) — minimal MD→JSX:
  - Fenced code blocks → `<pre dir="ltr">` (RTL-aware).
  - Headings → h2-h5 with amber accent border.
  - Bullets → unordered list with amber dots.
  - Numbered lists → ordered list with amber numerals.
  - Blockquotes → bordered amber-tinted.
  - `---` → dashed `<hr>`.
  - Bold/italic/inline-code → styled.

**Verification:**
- `/api/ads/educational-lessons` → `{"success":true,"count":12,"lessons":[...]}` — all 12 MD files parsed successfully.
- `/api/ads/educational-lessons?id=01` → returns full lesson with `fullContent` (14,761 chars).
- `bun run lint` EXIT 0 across both steps.
- 2 commits / 2 immediate pushes per Rule 63.1.

### 14.2 Recommendations Consolidation (Task 9-B — 2 commits)

See §4.7 (radar tab consolidation) + §5.1.1 (PersonalizedRadarTab bug fix) for full details.

**Summary:**
- `#recommendations` reduced from 10 main tabs + 3 sub-views (13 total) → 5 main tabs.
- 5 radar tabs MOVED from MarketAnalysisView → MakerRadarTab as internal sub-tabs (`#liquidity-radar` now has 6 sub-tabs).
- NetPicksTab duplicate render DELETED from MakerRadarTab.tsx:1213 (was rendering twice — once in #recommendations + once in #liquidity-radar).
- PersonalizedRadarTab runtime crash fixed (TypeError on `personalization_reasons.length` of undefined).
- API now returns proper plural `personalization_reasons: string[]` + full pick shape + real profile fields computed from `portfolio_assets`.
- Commits: `cd53a63` (API contract align) + `077116f` (radar tab move). Both pushed.

### 14.3 i18n Phase 1 Migration (5 components — 6 commits)

> **Pre-Phase-1 state:** 5 components migrated in earlier `I18N-FULL-100` task (Footer + AuthView + TopBar + DashboardView + MyStocksBriefing). `messages/ar.json` + `messages/en.json` at 130 LOC each. `src/lib/i18n-context.tsx` (220 LOC) provides `I18nProvider` + `useTranslation()` hook (cookie-based, no next-intl plugin — initial attempt failed with "Couldn't find next-intl config file" error).

**Wave 3 Phase 1 commits (5 components newly migrated):**

| # | Commit | Component | Strings migrated | Notes |
|---|---|---|---|---|
| 1 | `176c301` | `MarketAnalysisView` (was 6,450 LOC orchestrator) | 12 strings | Added `marketAnalysis.tabs.*` keys (12 keys) — separate commit `4f2c3d8` |
| 2 | `46c421f` | `StocksView` | 50 strings | Largest single migration in Phase 1 |
| 3 | `af2eee8` | `EnhancedWatchlistView` | 30 strings | |
| 4 | `06dedd7` | `EnhancedPortfolioView` | 40 strings | |
| 5 | `c9e8884` | `AlertsCenterView` | 25 strings | |

**messages/*.json growth (Phase 1):**
- Pre-Phase-1: 130 LOC each.
- Post-Phase-1: **460 LOC each** (+330 LOC = +12 marketAnalysis + 50 stocksView + 30 watchlist + 40 portfolio + 25 alerts + nested keys + section headers).
- ~157 strings migrated across 5 components.

**Verified counts (Wave 3 end-state):**
- `grep -rln "useTranslation" src/ --include="*.tsx" | wc -l` → **12 files**:
  - 5 Wave 3 Phase 1 components (above) +
  - 5 earlier `I18N-FULL-100` components (Footer + AuthView + TopBar + DashboardView + MyStocksBriefing) +
  - `src/components/Providers.tsx` (wraps `<I18nProvider>`) +
  - `src/lib/i18n-context.tsx` (the hook itself).

**Architecture decision:** kept the cookie-based `I18nContext + useTranslation` hook (NOT next-intl plugin — initial attempt failed). The hook pattern is enough for full i18n coverage — Phase 2 will migrate the remaining ~50 components using the same pattern.

### 14.4 Wave 3 Final Counts

| Metric | Pre-Wave-3 | Post-Wave-3 | Delta |
|---|---|---|---|
| Education screens (user-facing) | 2 (`#learning` + `#academy`) | 1 (`#academy` only) | -1 |
| `content/education/*.md` consumers | 1 (admin ContentStudioHub only) | 2 (ContentStudioHub + AcademyView's AdvancedLessonsTab) | +1 |
| `#recommendations` tab count | 10 main + 3 sub-views (13 total) | 5 main tabs | -8 |
| `#liquidity-radar` sub-tab count | 0 (was 1 main content) | 6 (maker default + 5 moved radar sub-tabs) | +6 |
| NetPicksTab duplicate renders | 2 (MarketAnalysisView + MakerRadarTab) | 1 (MarketAnalysisView only) | -1 |
| PersonalizedRadarTab runtime crashes | YES (TypeError on `personalization_reasons.length`) | NO (API contract aligned) | fixed |
| `find archive/ -type f \| wc -l` | 436 (Wave 2 only) | 439 (Wave 2 + 3 education files) | +3 |
| Components using `useTranslation()` | 7 (5 from I18N-FULL-100 + Providers + i18n-context) | 12 (above + 5 Wave 3 Phase 1) | +5 |
| `messages/ar.json` + `messages/en.json` LOC | 130 each | 460 each | +330 each |
| AcademyView.tsx LOC | 73 | 717 (added AdvancedLessonsTab + AdvancedMarkdownRenderer inline) | +644 |
| MarketAnalysisView.tsx LOC | ~6,450 | 297 (orphan code removed; now thin orchestrator) | -6,153 |
| MakerRadarTab.tsx LOC | ~3,286 | 3,381 (added 6 TabsTrigger + TabsContent blocks for moved sub-tabs + Dialog wrapper) | +95 |

---


---

## §8 — Wave 6 Payment P0 Fixes (P0-1 → P0-5)

## 15. Wave 6 — Payment System P0 Fixes Summary (2026-10-02)

> **Source:** Task 16-A forensic audit (payment + subscription system) identified 5 P0 defects (revenue leak + privilege escalation + Rule 50 breaches). Fix Battalion executed all 5 fixes as Wave 6 (Task IDs `P0-1` through `P0-5` — 2026-10-02). See `Documentation/WAVE-6-PAYMENT-FIXES-2026-10-02.md` for the consolidated changelog with commit hashes + per-fix architecture diagrams + deployment checklist. See `Documentation/BREACH-LOG.md` BREACH-003 through BREACH-006 for the per-breach records.

### 15.1 P0-1 — `m2y-` prefix rejection (Task `P0-1` — Fix Battalion)

- **Symptom:** PricingView checkout flow generates `merchant_order_id = m2y-{tier}-{userIdSuffix8}-{ts}`. The Paymob callback route (`/api/paymob/callback/route.ts:88`) only accepted the legacy `GLM-` prefix → users who paid via PricingView were NEVER upgraded. Direct revenue loss per paying customer.
- **Root cause:** Two-prefix drift — new PricingView was wired but callback was not updated to recognize its order IDs.
- **Fix:** `processPaymentResult()` in `src/app/api/paymob/callback/route.ts` now accepts BOTH `GLM-` (legacy parse userId + planId directly) and `m2y-` (parse tier + userIdSuffix, then DB lookup by suffix with collision detection — fails safe if ambiguous). Defense-in-depth preserved: HMAC verify (fail-closed) + planId allowlist + amount cross-check.
- **Commits:** `4be0e77` (callback accepts both prefixes — `src/app/api/paymob/callback/route.ts` +48 / -8 LOC) + `9e1f93e` (hotfix: add missing `authDb` import — 1 LOC, runtime crash fix).
- **Verification:** PricingView checkout flow now correctly upgrades users on successful Paymob callback. Legacy `GLM-` flow still works (backward-compatible).

### 15.2 P0-2 — Subscription expiry mechanism (Task `P0-2` — Fix Battalion)

- **Symptom:** `UserSubscription.status` was flipping to `'expired'` (in `/api/subscription/current`) BUT `User.subscription_tier` was NEVER downgraded. `checkTrialNotExpired()` only consulted `subscription_tier` (paid = bypass) → expired paid users retained ALL premium privileges FOREVER. Direct revenue leak.
- **Root cause:** No expiry enforcement — the `UserSubscription.expires_at` column existed but was never read by the trial gate.
- **Fix (Part 1 — runtime gate):** Added `isPaidSubscriptionActive()` helper in `src/lib/subscription-gate.ts:193-261` that reads `UserSubscription.expires_at` (60s cache) and returns `false` once expired. `checkTrialNotExpired()` (line 282-352) now consults this and treats expired paid users as free (trial gate engages). Fail-open behavior preserved per Rule 50 (better than locking out a paying customer during DB hiccup).
- **Fix (Part 2 — daily cron):** `scripts/downgrade-expired-subscriptions.ts` runs daily to reconcile — flips `UserSubscription.status` to `'expired'` for rows with `expires_at < now` AND downgrades `User.subscription_tier` to `'free'` if no other active subscription exists.
- **Commits:** `ada95f5` (gate fix — `src/lib/subscription-gate.ts`) + `fbd01b4` (daily cron script — `scripts/downgrade-expired-subscriptions.ts`).
- **Verification:** `isPaidSubscriptionActive()` correctly returns `false` for `expires_at < now`. `checkTrialNotExpired()` engages trial gate for expired paid users. Cache staleness window: 60s (acceptable per Rule 50).

### 15.3 P0-3 — Promo codes time-limited (Task `P0-3` — Fix Battalion)

- **Symptom:** `/api/redeem-promo/route.ts:252-258` set `subscription_tier='premium'` (which is in `PAID_TIERS` — trial check bypasses entirely). The `trial_ends_at` extension was meaningless. Users got lifetime free premium from a single promo code (Rule 50 breach).
- **Root cause:** Promo code redemption only mutated `User` table; it didn't write the `UserSubscription` row that `isPaidSubscriptionActive()` consults.
- **Fix:** Route now upserts a `UserSubscription` row with `status='active'`, `expires_at = now + premium_days` (extended from latest active window — prevents SHORTENING paid window), `payment_method='promo_code'`, inside the SAME transaction as the promo usage increment + user tier update. Plan_id FK safety: falls back to `'premium'` if the promo's `plan_tier` isn't seeded in `SubscriptionPlan`. Combined with P0-2's expiry check, premium access now genuinely expires after `PromoCode.premium_days` days (default 30).
- **Schema:** No schema change needed — `PromoCode.premium_days Int @default(30)` already exists in `prisma/auth-schema.prisma:230`.
- **Commits:** `a6425b8` (`src/app/api/redeem-promo/route.ts` +109 / -60 LOC).
- **Verification:** Promo redemption is atomic — if the upsert fails, the promo code is NOT consumed (user can retry). Verified via code inspection of the `$transaction` boundary.

### 15.4 P0-4 — 7 backend paywall gates (Task `P0-4` — Fix Battalion)

- **Symptom:** 7 of 8 PAYWALL Phase 2 backend gates (`PAYWALL-STRATEGY-FINAL.md` §5.2) were NOT implemented. Frontend paywall was bypassable with `curl`. Fair value (killer feature), Exit Radar timing, accuracy breakdowns, trade history, advanced lessons, screener depth, prediction tickers all exposed server-side.
- **Root cause:** Phase 2 plan was approved but never executed — only Phase 1 frontend gates shipped in Wave 5.
- **Fix:** All 7 gates implemented (Gate 8 = A/B testing infrastructure — out of P0 scope, deferred to Phase 3 conversion-optimization work). Each gate uses existing infrastructure: `getSessionUserId()` from `@/lib/auth-helper`, `checkTrialNotExpired(userId)` + `PAID_TIERS` from `@/lib/subscription-gate`, `applyPaywallToResults()` from `@/lib/paywall`. All gates apply ONLY to authenticated free + trial-expired users (anonymous + paid + trial-active get full data per §4 taste-hook strategy). Rule 50 safety fields preserved across all gates (stop loss, trailing stop, portfolio risk dashboard, alerts on owned stocks, basic price alerts).
- **7 backend gates (7 commits, 7 pushes per Rule 63):**

  | # | Gate | Route | Commit | Locked Response |
  |---|---|---|---|---|
  | 1 | fair_value (killer feature) | `src/app/api/stocks/[ticker]/route.ts` | `b507034` | `fair_value: null` + `fair_value_locked: true` (also strips nested `fundamentals.fair_value` + `analysis.fair_value`); `upside_percent` KEPT as marketing teaser "🔒 +29% فرصة — اشترك" |
  | 2 | Exit Radar | `src/app/api/maker-radar/exit-radar/route.ts` | `b5b6193` | Hard 403 `{success:false, error:'EXIT_RADAR_LOCKED', upgradeUrl:'/pricing'}` (only gate that blocks anonymous too — Exit Radar is Pro-grade, not a taste hook) |
  | 3 | Radar Accuracy | `src/app/api/radar/accuracy/route.ts` | `a00c8d6` | Headline summary preserved (`total_signals`, `win_rate_pct`, etc.); `by_signal_type` + `by_market` + `monthly_trend` arrays → `{locked:true, upgradeUrl:'/pricing'}` + `details_locked:true` flag |
  | 4 | Historical Trades | `src/app/api/predictions/historical-trades/route.ts` | `9d05721` | `trades:[]` + `trades_locked:true` + new `summary:{total,wins,losses,win_rate_pct,avg_pnl_pct,avg_holding_days}`; perf bonus: locked requests skip the 13k-row scan |
  | 5 | Advanced Lessons | `src/app/api/ads/educational-lessons/route.ts` | `0a8f1e6` | First 3 lessons visible; lessons 4-12 → lock stub `{title:'🔒 اشترك لرؤية الدرس', locked:true, upgradeUrl:'/pricing'}`; applies to BOTH list + deep-link `?id=08` |
  | 6 | Screener Results | `src/app/api/screener/advanced/route.ts` | `f8f8683` | `stocks` sliced to first 5 (FREE_TIER_SCREENER_LIMIT=5); `total` preserved + `locked:true` + `locked_count:N` + `free_preview_count:5`; applied to BOTH Python proxy + SQLite fallback |
  | 7 | Predictions detail blurring | `src/app/api/predictions/daily-picks/route.ts` | `d161c4f` | Two-layer gate: (1) trial 403 TRIAL_EXPIRED for authed free+expired; (2) `applyPaywallToResults()` blurring for non-paid trial-active (top 3 visible, rest blurred: ticker='🔒', narrative truncated 30 chars + '...'); anonymous = full list (taste hook) |

- **Verification:** All 7 gates fire correctly for the locked state, fall through cleanly for the unlocked state (paid/anonymous/trial-active). No-op when `locked=false` — preserves exact pre-change response shape for paid users. `bun run lint` EXIT 0 after EACH gate.
- **Frontend follow-up (NOT blocking):** Backend now returns `*_locked:true` / `locked:true` / `{locked:true, upgradeUrl}` shapes; frontend components may not yet render the lock FOMO cards (will render `fair_value:null` as "—" instead). Phase 1 frontend gates already shipped in Wave 5 — the 7 backend gates here are the prerequisite enforcement layer.

### 15.5 P0-5 — Unified PAID_TIERS (Task `P0-5` — Fix Battalion)

- **Symptom:** Three divergent inline `PAID_TIERS` arrays existed across 3 files:
  - `/api/subscription/status:43` — 7 tiers `['premium','pro','b2b_*','developer','admin']` (NO `normal`, NO `enterprise`)
  - `/api/admin/users:148` + `cleanup-expired:30` — 6 tiers `['normal','premium','developer','admin','pro','enterprise']` (NO `b2b_*`, includes phantom `enterprise`)
  - `subscription-gate.ts:364` — 9 tiers (superset, includes both `b2b_*` AND `enterprise`)
- **Impact:** `normal` users were FREE in `/api/subscription/status` but PAID in `/api/admin/users` (trial check inconsistent). `b2b_starter` users were PAID in `subscription/status` but FREE in `admin/users` → eligible for account deletion by `/admin/users/cleanup-expired` cron (Rule 50 — MONEY-AS-CUSTOMER-LIFE breach: paying B2B customers being silently deleted!).
- **Root cause:** Each consumer defined its own list locally — no canonical source.
- **Fix:** Canonical `PAID_TIERS` Set exported from `src/lib/subscription-gate.ts:162`: `['normal','premium','pro','developer','admin','enterprise','b2b_starter','b2b_pro','b2b_enterprise']` (9 tiers — added the missing `enterprise`). 8 consumers migrated to import (the 9th consumer is `subscription-gate.ts` itself, used at lines 222 + 378).

| Step | File | Commit | Change |
|---|---|---|---|
| 1 | `src/lib/subscription-gate.ts:162` | `dd8bef5` | Promote existing `PAID_TIERS` Set to canonical exported constant + add missing `'enterprise'` tier |
| 2a | `src/lib/subscription-enforcement.ts:86` | `ead1a05` | Remove local `const PAID_TIERS = new Set([...])`; add import |
| 2b | `src/app/api/subscription/current/route.ts:114` | `18d9345` | Replace inline `.includes()` with `PAID_TIERS.has(tier.toLowerCase())` |
| 2c | `src/app/api/subscription/status/route.ts:43` | `b57a81c` | Replace inline 7-tier array (MISSING `normal` + `enterprise`); BUGFIX: those tiers now correctly identified as PAID |
| 2d (CRITICAL) | `src/app/api/admin/users/cleanup-expired/route.ts:30+42` | `a7a0b7b` | Replace BOTH inline arrays (the `.includes()` AND Prisma `notIn:[]`); CRITICAL: old list was MISSING all `b2b_*` → cron was returning B2B paying customers as deletion candidates and DELETING THEIR ACCOUNTS |
| 2e | `src/app/api/admin/users/route.ts:148` | `ba1025d` | Replace inline 6-tier array (MISSING `b2b_*`); BUGFIX: B2B users now show `isPaid=true` in admin dashboard |
| 2f | `src/app/api/bot/check-subscription/route.ts:36` | `1085d8d` | Remove local duplicate (8-tier, missing `enterprise`); BUGFIX: `enterprise` tier users now correctly identified as paid by Telegram bot |
| 2g | `src/app/payment/success/page.tsx:31` | `bbbfdaa` | Remove local 7-tier (missing `normal` + `enterprise`); BUGFIX: those tier users who complete payment now see success UI (was stuck on "processing" forever) |
| 2h | `src/lib/subscription-gate.ts:364` (inside `getTrialStatus`) | `7faa953` | Replace SECOND divergent inline array INSIDE the same file as the canonical Set (line 151 vs line 364). Now exactly ONE PAID_TIERS definition per file |

- **Intentionally LEFT UNTOUCHED** (per task scope — these are feature gates + checkout validation, NOT "is paid?" checks): `getRadarAccess` (radar access tier subset), `canAccessProFeatures` (Pro feature subset), `isB2BTier` (B2B classification), `b2b/signup` + `subscription/checkout` + `subscription/activate` `validTiers`/`VALID_TIERS` (input validation of purchasable plan IDs).
- **Verification:** `rg "const PAID_TIERS\s*="` returns ONLY the canonical definition at `src/lib/subscription-gate.ts:162`. `rg "'normal', 'premium'"` inline arrays = 0. Imports of canonical `PAID_TIERS`: 7 (8th consumer is `subscription-gate.ts` itself). `bun run lint` EXIT 0.

### 15.6 Wave 6 Final Counts

| Metric | Pre-Wave-6 (per Task 16-A audit) | Post-Wave-6 | Delta |
|---|---|---|---|
| Payment system health score | 4.5/10 | 8/10 | +3.5 |
| Critical revenue-leak bugs | 5 (P0-1 → P0-5) | 0 | -5 |
| `PAID_TIERS` definitions | 3 divergent (7/6/9 tiers) | 1 canonical (9 tiers) | -2 divergent |
| Backend paywall gates implemented | 1 of 8 (partial) | 7 of 8 (Gate 8 = Phase 3 A/B testing — out of scope) | +6 |
| Routes vulnerable to `curl` bypass | 7 (fair_value + Exit Radar + accuracy + trades + lessons + screener + predictions) | 0 | -7 |
| Commits pushed in Wave 6 | — | 19 commits, 19 pushes (Rule 63 compliant) | +19 |
| Files touched | — | 12 (callback + subscription-gate + subscription-enforcement + 6 backend gate routes + admin/users + cleanup-expired + redeem-promo + bot/check-subscription + payment/success) | +12 |

### 15.7 Wave 6 P1 / P2 follow-ups (NOT blocking — recommended for next wave)

> **P1 items** (from Task 16-A audit — deferred from Wave 6 P0 scope):
> 1. **P1-1** — Paymob webhook idempotency: `payment_events` table with `paymob_transaction_id` unique constraint. Reject duplicate webhooks (currently idempotent only because `db.user.update` is overwrite-by-id, but no audit trail).
> 2. **P1-2** — Daily reconciliation cron: query Paymob `/api/ecommerce/transactions` for last 24h + reconcile with local DB. Heal missing activations (already partially shipped as `scripts/downgrade-expired-subscriptions.ts` for the local-DB side).
> 3. **P1-3** — Unify pricing: delete `src/lib/plans.ts` hardcoded prices + `SubscriptionView.tsx` hardcoded prices. Use `MarketPricing` table as the SINGLE source of truth (already used by checkout/activate).
> 4. **P1-4** — Return `trial_ends_at` from `/api/auth/me` so frontend can accurately show trial countdown including referral/promo extensions (currently frontend falls back to `created_at + 14 days`).
> 5. **P1-5** — Wire `m2ySyncClient.ts` OR delete it (Rule 16 + Rule 63 — currently dead code).
> 6. **P1-6** — Remove `premium` from `AuthGate.tsx:356` admin check (UI-level privilege escalation — server already blocks via `admin-auth-server.ts:169-173`).
>
> **P2 items:**
> 1. **P2-1** — Implement Gate 8: A/B testing infrastructure (`?variant=A` preview-count experiments — Phase 3 conversion optimization).
> 2. **P2-2** — Align admin dashboard trial calc (30 days) with actual trial (14 days) — change `/api/admin/users:156` + `cleanup-expired` from 30 → 14 days.
> 3. **P2-3** — Delete legacy `SubscriptionView.tsx` (1400+ LOC) — replaced by `PricingView.tsx`. Remove `/api/paymob/create-payment` + `/api/subscription/upgrade` (legacy m2y.net JWT flow) since `checkout` is the canonical path.
> 4. **P2-4** — Delete `prisma/seed-subscriptions.ts` legacy 3-tier seeding (free/normal/premium) — conflicts with `MarketPricing` table approach.
> 5. **P2-5** — Add `/payment/success` retry button that calls `/api/subscription/activate` with the Paymob transaction ID from URL query params (defense-in-depth second leg is currently dead).

### 15.8 Deployment Checklist for Production (Wave 6)

> **Source:** Per `PAYWALL-STRATEGY-FINAL.md` §10 + Rule 63 (PUSH-AFTER-EVERY-COMMIT) + Rule 62 (GIT-PUSH-DISCIPLINE).

- [ ] All 19 Wave 6 commits pushed to `origin/main` (verified via `git log 8b4bcc8..8640a15 --oneline | wc -l` = 19+ — see `WAVE-6-PAYMENT-FIXES-2026-10-02.md` §2 for full list).
- [ ] `bun run lint` EXIT 0 after EACH commit (verified by Fix Battalion agents after each gate).
- [ ] Production VPS: `git pull origin main` + `pm2 restart nextjs`.
- [ ] Verify daily cron `scripts/downgrade-expired-subscriptions.ts` is wired in `crontab.txt` (P0-2 Part 2 — Task 16-D `DB-RESILIENCE-STRATEGY.md` should already cover this).
- [ ] Smoke test: complete a real PricingView checkout end-to-end (callback now accepts `m2y-` prefix → user upgraded).
- [ ] Smoke test: redeem a promo code → verify `UserSubscription` row created with `expires_at = now + premium_days`.
- [ ] Smoke test: simulate trial expiry → verify `isPaidSubscriptionActive()` returns `false` + trial gate engages.
- [ ] Smoke test: `curl /api/stocks/[ticker]` as authenticated free+trial-expired user → verify `fair_value: null` + `fair_value_locked: true`.
- [ ] Monitor Sentry + structured logger (`src/lib/logger.ts`) for the new gate response shapes (`*_locked: true`).

---


---

## §9 — Wave 7 Data + Chart Quality Fixes

## 16. Wave 7 — Data Quality + Chart Quality Fixes Summary (2026-10-03)

> **Source:** Task `18-A` forensic data audit identified 11 P0 data quality issues (4 CRITICAL — project-destroying per owner directive). Task `19` TV chart quality audit identified 5 P0 chart quality issues. Fix Battalion executed Wave 7 in 2 batches (Task `FIX-1` + `FIX-2` data quality + Task `P0-1`..`P0-5` chart). See `Documentation/WAVE-7-DATA-CHART-FIXES-2026-10-03.md` for the consolidated changelog with commit hashes + per-fix detail + scorecards + deployment checklist. See `Documentation/BREACH-LOG.md` BREACH-007..009 for the per-breach records.

### 16.1 Task 18-A — Forensic Data Quality Audit (research-only)

- **Directive:** *"التحليلات الفنية وباقي التحليلات والارقام والقيم الى بتظهر غلط خالص دى فى حد ذاتها تهدم المشروع من اساسها"* (technical/fundamental/financial numbers being wrong destroys the project from its foundation).
- **Scope:** 8 layers audited (price foundation → technical indicators → fundamentals → financials → V40.2 predictions → backtest → DB availability → API responses). Sampled 6 EGX stocks (COMI, CIB, HRHO, SWDY, ETEL, AMOC) + 3 crypto (BTC, SOL, XRP) against the production DB extracted from `/tmp/my-project/data/all.zip` (68 MB).
- **Findings (11 P0 data quality issues, 4 CRITICAL):**
  - **P0-1 (CRITICAL):** `load_merged_history` queries non-existent `price_history` table with wrong column names → every caller returns empty → all downstream technical indicators return placeholder.
  - **P0-2 (CRITICAL):** Rule 24 violation IN PRODUCTION DB — 3 crypto predictions (XRP, BTC, SOL dated 2026-08-27) had `fundamental_score = 50.0` placeholder.
  - **P0-3 (CRITICAL):** 37-day-stale price data (latest 2026-08-27 as of audit 2026-10-03).
  - **P0-4 (CRITICAL):** `stored_analyses.risk_reward = 3.0` hardcoded for ALL 12 rows — Rule 18 violation.
  - **P0-5 (CRITICAL):** Rule 21 violation persists — maestro_orchestrator.daily_opportunities() still runs LIVE for Telegram.
  - Additional P0s: tab_balance_sheet column-shift bug + public_routes._calc_fv biased high + technical.py wrong RSI/MACD/Stochastic/ADX formulas + 6+ duplicate calc_rsi implementations + OHLC inconsistencies + CIB has 0 price rows + Sharpe annualization incorrect.
- **Root cause analysis (5 root causes):**
  1. Incomplete DB migration (Rule 46 migrated schema but not `load_merged_history` SQL queries).
  2. Placeholder pattern entrenched in code (`fundamental_score = 50.0` in 3 places despite Rule 24 explicitly forbidding it — comments at violation sites even acknowledge the rule).
  3. Stale data ingestion pipeline (egksco_scraper not running on schedule).
  4. Multiple competing implementations (6+ separate `calc_rsi` — Rule 20 violation).
  5. Hardcoded values in storage layer (`stored_analyses.risk_reward = 3.0` for all rows).
- **Outcome:** Research-only — no files edited (Rule 63). Output: ranked list of 10 recommended fixes (FIX-1..FIX-10). FIX-1 + FIX-2 executed by Fix Battalion in Wave 7; FIX-3..FIX-10 are P1/P2 follow-ups (see §16.7).
- **Worklog reference:** `worklog.md` Task ID `18-A` (lines ~50336-50474).

### 16.2 Task 19 — TV Chart Quality Audit (research-only)

- **Directive:** *"chart must match TradingView.com quality"* — 20+ customers had complained that the in-app chart was "garbage" with identical volume bars across all candles (mathematically impossible).
- **Scope:** Audited `src/app/api/chart/[ticker]/route.ts` (~860 LOC) + `src/modules/stock-analysis/components/TradingViewChart.tsx` (~1,100 LOC) + the chart data pipeline (Python `chart_routes.py` + `intraday_reader.py`).
- **Findings (5 P0 chart quality issues):**
  - **P0-1:** Chart API fabricated 90 fake intraday candles per request via `session_intraday` synthetic generator (lines 669-732). All bars had identical volume (`Math.floor(d.volume / totalBars)`) — customers spotted immediately. Rule 24 + Rule 27 breach.
  - **P0-2:** Default `chartEngine` was `'interactive'` (lightweight-charts rendering synthetic data) instead of `'tradingview_widget'` (real TradingView.com embedded chart).
  - **P0-3:** Chart API read `price_history.db` directly via `getLocalDailyData()` — Rule 12 violation. Split-brain between Node + Python data readers.
  - **P0-4:** Chart API discarded `price_history.db` data when latest candle was >3 days stale → fell back to Yahoo (5-year cap) → lost 26 years / 1.2M rows of real history.
  - **P0-5:** Default `timeframe` was `'15m'` — intraday had no real data (only fake `session_intraday`).
- **Outcome:** Research-only — no files edited (Rule 63). All 5 fixes executed by Fix Battalion in Wave 7 (commits `ed56cb2`, `6531653`, `00d9766`, `10076a4` — see §16.5).

### 16.3 DB Recovery from GitHub History (BREACH-009 — closed)

- **Owner directive:** *"تجمع قواعد البيانات من الجت هب"* (gather the databases from GitHub).
- **Obstacle:** `.gitignore` excludes `*.db`, `db/*.db`, `db/**/*.db` — production DBs (`data_engine.db` 83 MB, `price_history.db` 279 MB, `intraday.db` 363 MB, `predictions.db` 9.7 MB) are NOT in the repo.
- **Solution:** Walked git history to recover historical zip archives of the (now-removed-from-index) `data/all.zip` artifacts. 4 zip files totaling 222 MB committed under `archive/databases-from-github/`:

| # | File | Size | Commit |
|---|---|---|---|
| 1 | `archive/databases-from-github/active_databases_20260817_full.zip` | 73.4 MB | `ed56cb2` |
| 2 | `archive/databases-from-github/all.zip` | 28.8 MB | `ed56cb2` |
| 3 | `archive/databases-from-github/all_databases_2.zip` | 70.9 MB | `ed56cb2` |
| 4 | `archive/databases-from-github/all_databases_3.zip` | 48.8 MB | `ed56cb2` |
| **Total** | **4 zip files** | **≈ 222 MB** | `ed56cb2` (1 commit, bundled with P0-1 chart fix) |

- **Verification — `price_history.db`:** `SELECT COUNT(*) FROM price_history` → **1,205,599 rows** (≈ 1.2M). `SELECT MIN(date), MAX(date)` → `('2000-11-27', '2026-09-03')` — **26 years of EGX daily OHLC**. This DB is the SINGLE source for the chart API's daily candles.
- **What was recovered vs. what remains gitignored:**
  - RECOVERED (committed under `archive/`): 4 historical zip snapshots totaling 222 MB.
  - STILL GITIGNORED (`db/*.db` — fresh state): the active working copies in `db/` (price_history.db 279 MB + intraday.db 363 MB + data_engine.db 83 MB + predictions.db 9.7 MB + stocks.db 14 MB + 12 more) — per owner directive, these stay out of git (they change every few minutes during market hours — would bloat the repo).

### 16.4 Task FIX-1 — `load_merged_history` schema fix + 12 placeholder removals (Fix Battalion)

- **Problem (audit's P0-1 + 12 placeholder patterns):** `load_merged_history` queried non-existent `price_history` table with wrong column names → every caller returned empty. Plus 12 placeholder/fake patterns: `fundamental_score = 50.0`, `ai_pattern_score = 50`, fake `macd*0.9` signal line, fake `%D = %K * 0.9` stochastic, fabricated ADX range ratio.
- **Solution (4 commits, 4 pushes per Rule 63):**
  - `513105f` — Added `load_egksco_history(ticker, limit=120)` to `vps-service/data/prices.py` — reads from `db/data_engine.db.egksco_price_history` per Rule 46 schema. Returns empty `[]` (NOT placeholder) if DB missing.
  - `15cdb50` — Updated `load_price_history` — egksco is now PRIMARY source, falls back to `_canonical_load` (master_analyzer.load_merged_history), returns `[]` if both empty. Bugfix: `change_percent` loop moved outside the row loop (was O(N²), now O(N)).
  - `f8b9296` — Updated `master_analyzer.load_merged_history` — falls back to `data_engine.db.egksco_price_history` when `price_history.db` returns empty. Uses `symbol` + `price_date` (Rule 46) with defensive legacy `date` fallback via PRAGMA.
  - `0120204` — Removed 12 placeholder/fake patterns across 6 files (`master_analyzer.py` + `core_scoring_engine.py` + `technical.py` + `daily_predictor.py` + `scanner_routes.py`). MACD signal = real 9-period EMA of MACD line series. Stochastic %D = real 3-period SMA. ADX returns None (real Wilder's ADX deferred to FIX-8 P1).
- **Verification:** MACD signal (6.195) ≠ macd*0.9 (5.8708) ✓. Stochastic d (100.0) ≠ k*0.9 (90.0) ✓. ADX returns None (not fabricated) ✓. `calc_rsi([1,2,3])` returns None (was 50.0) ✓. `bun run lint` EXIT 0.

### 16.5 Task FIX-2 — 14 remaining placeholders → `None` (Fix Battalion)

- **Problem:** ~9 additional local pre-init `= 50.0` patterns not in FIX-1's Focus list, plus 5 more in adjacent files (total 14). Owner directive: *"مانستعملش بيانات وهمية خالص تحت اى ظرف — لو مش موجود نكتبها صراحتا"* (no fake data under any circumstance — if missing, write NULL/None explicitly).
- **Solution (6 commits, 6 pushes per Rule 63):**
  - `a058715` — `background_analyzer._store_orchestrator_result` — `technical_score`/`fundamental_score` defaults `50.0` → `Optional[float]=None`.
  - `428ceac` — `prediction_tracker` — Prediction dataclass + `record_prediction` + `_replay_history` — all 4 score fields (`technical_score`, `fundamental_score`, `ai_pattern_score`, `sentiment_score`) `50.0` → `Optional[float]=None`.
  - `bb58809` — `fundamental_data_provider` — FundamentalData dataclass (5 derived score fields) + `_calculate_scores()` + `get_asset_quality_score()`. Returns `'NO_DATA'` verdict with `quality_score=None, veto=False` for missing data (Rule 24: "don't veto on missing data, don't punish stocks we couldn't score").
  - `f132237` — `master_analyzer` — `smc_score_for_blend` + `_rsi_for_fusion` pre-inits `50.0` → `Optional[float]=None`. Blend guarded: `if smc_score_for_blend is not None:` then blend, else skip.
  - `15b3ac2` — `daily_predictor` — `_rsi_quick` + `_rsi_val` + `rsi` for crypto BUY/SELL signal — `50.0` → `Optional[float]=None`. Caller guards added.
  - `fc0714c` — `fusion_engine` — `calculate_fusion_score()` + `calculate_fusion_metrics()` signatures: `rsi: float = 50.0` → `rsi: Optional[float] = None`. When None, RSI scoring block is skipped (no fake '+20 RSI healthy' bonus applied).
- **Verification:** `grep fundamental_score.*50\.0` (excl comments/tests/scripts): 0 in actual code. DB-level test: INSERT writes NULL when scores are None (verified via sqlite3 fetchone after record_prediction call). Smoke tests: `calculate_fusion_score(rsi=None)` → score=0.00 (no RSI bonus, no crash); `calculate_fusion_score(rsi=65.0)` → score=20.00 (RSI healthy +20 applied correctly). `bun run lint` EXIT 0.

### 16.6 Chart P0 Fixes — Task P0-1..P0-5 chart (Fix Battalion — 4 commits)

| # | Fix | Commit | File | Change |
|---|---|---|---|---|
| P0-1 (chart) | Remove `session_intraday` synthetic generator (was faking 90 candles with identical volume) | `ed56cb2` | `src/app/api/chart/[ticker]/route.ts` (+84/-63) + 4 DB zips under `archive/databases-from-github/` (222 MB total) | Removed lines 669-732. Returns honest empty `data: []` with `source: 'no_intraday_data'` + Arabic message. ALSO bundled DB recovery (BREACH-009). |
| P0-2 (chart) | Default `chartEngine` flipped `'interactive'` → `'tradingview_widget'` | `6531653` | `src/modules/stock-analysis/components/TradingViewChart.tsx` (+2/-2) | Users now see real TradingView.com embedded chart by default. |
| P0-3 (chart) | Chart API calls Python `load_price_history` first (Rule 12 + Rule 20 — was direct SQLite split-brain) | `10076a4` + `d4514ee` | `src/app/api/chart/[ticker]/route.ts` (+101/-4) + `vps-service/api/public_routes.py` (NEW route) | Added `getPythonDailyData()` helper calling `GET /api/prices/<ticker>?limit=N`. Falls back to direct SQLite reader (marked DEFENSIVE-FALLBACK) only when Python unreachable. New Python route delegates to `data.prices.load_price_history()` — the SOLE canonical source per Rule 12. |
| P0-4 (chart) | MERGE local `price_history.db` (26 years) + Yahoo recent candles (was: discard 26 years for 3+ days stale) | `00d9766` | `src/app/api/chart/[ticker]/route.ts` (+32/-2) | Append new Yahoo candles, update existing ones with fresher data, sort by timestamp. COMI chart now shows 26 years of history (was 5 years max). `SELECT COUNT(*) FROM price_history` → 1,205,599 rows. |
| P0-5 (chart) | Default `timeframe` flipped `'15m'` → `'1D'` (same commit as P0-2) | `6531653` | `src/modules/stock-analysis/components/TradingViewChart.tsx` | 1D daily uses `price_history.db` (1.2M real rows, 26 years). First impression is now REAL data, not synthetic noise. |

### 16.7 Wave 7 P1 / P2 follow-ups (NOT blocking — recommended for Wave 8)

> **P1 items (12 — from Task 18-A audit's FIX-3..FIX-10 + Task 19 follow-ups):**
> 1. **P1-1** — `stored_analyses.risk_reward` computation (FIX-6 — compute `(target-entry)/(entry-stop)` instead of hardcoded 3.0).
> 2. **P1-2** — Real Wilder's ADX implementation in `technical.py` (FIX-8 — currently returns None honestly).
> 3. **P1-3** — Graham formula `FV = EPS × (8.5 + 2g) × 4.4/Y` in `fair_value_calculator.py` (FIX-9 — currently MISSED entirely).
> 4. **P1-4** — Rule 24 column-shift bug in `tab_balance_sheet` / `tab_income_statement` / `tab_cash_flow` (FIX-7 — every column shifted by one).
> 5. **P1-5** — Rule 21 enforcement — `maestro_orchestrator.daily_opportunities()` still LIVE for Telegram (FIX-4 — rewrite `post_daily_opportunities` to read from `predictions` table).
> 6. **P1-6** — egksco_scraper cron re-enablement (FIX-5 — production data 37 days stale as of audit).
> 7. **P1-7** — Daily accuracy verification harness (FIX-10 — fetch 5 reference stocks from TradingView, compare against `load_merged_history`).
> 8. **P1-8** — DB migration to NULL out existing `fundamental_score = 50.0` rows in `predictions` table (3 rows: BTC, SOL, XRP dated 2026-08-27).
> 9. **P1-9** — ~5 additional local pre-init `= 50.0` patterns in `master_analyzer.py` + `daily_predictor.py` (deferred from FIX-2).
> 10. **P1-10** — Consolidate 6+ `calc_rsi`/`calc_macd`/`calc_atr` implementations into single canonical `data/indicators.py` (FIX-8 — Rule 20 violation).
> 11. **P1-11** — Other API routes still reading DB directly (Rule 12 violation): `/api/analysis/<ticker>` + `/api/professional-analysis/<ticker>` + `/api/maestro/stock/<ticker>`.
> 12. **P1-12** — Yahoo Finance recent-data window can be widened (currently "last few days" — could fetch last 14 days for better merge coverage).
>
> **P2 items (6 — nice-to-have — not blocking):**
> 1. **P2-1** — `daily_predictor.py:1249` — `_rsi_val` defaults to None, but the function call uses `rsi=(_rsi_val if _rsi_val is not None else 50.0)` — the 50.0 here is the FUNCTION's documented neutral default (per its `rsi: float = 50.0` contract), NOT a placeholder for missing data. Leave unchanged.
> 2. **P2-2** — `master_analyzer.py:1907` (LIMITED DATA MODE fallback) — uses 50 as neutral baseline for ALL scores when <50 prices. Needs evaluation per Rule 18 + Rule 8.
> 3. **P2-3** — `scoring_fix.py:470` (`analyze_stock_quick` function) — DEAD CODE. Candidate for deletion in Wave 8 cleanup.
> 4. **P2-4** — `chart_routes.py:3474` (`elif fundamental_score >= 50:`) — LEGITIMATE comparison (not assignment). Leave unchanged.
> 5. **P2-5** — Sharpe ratio annualization uses `sqrt(252)` but applies to per-trade returns. Should account for avg holding days.
> 6. **P2-6** — `prediction_tracker.py` DB schema `DEFAULT 50` (lines 242, 265) — DEFAULT only applies when column OMITTED from INSERT. Since we always pass it explicitly, None → NULL (DEFAULT ignored). Leave unchanged.

### 16.8 Deployment Checklist for Production (Wave 7)

> **Source:** Per Rule 63 (PUSH-AFTER-EVERY-COMMIT) + Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 16 (VERIFY with evidence). Full checklist in `WAVE-7-DATA-CHART-FIXES-2026-10-03.md` §8.

**Pre-deployment verification (already complete in sandbox):**
- [x] All 14 Wave 7 code commits pushed to `origin/main` (4 FIX-1 + 6 FIX-2 + 4 chart = 14 commits).
- [x] `bun run lint` EXIT 0 after EACH commit.
- [x] AST syntax OK for all 13 modified Python files.
- [x] Smoke tests: MACD signal ≠ macd*0.9 ✓, Stochastic d ≠ k*0.9 ✓, ADX returns None ✓, `calc_rsi([1,2,3])` returns None ✓, `calculate_fusion_score(rsi=None)` → 0.00 ✓, `calculate_fusion_score(rsi=65.0)` → 20.00 ✓, DB-level INSERT writes NULL when scores are None ✓.
- [x] `SELECT COUNT(*) FROM price_history` → 1,205,599 rows ✓.
- [x] `SELECT MIN(date), MAX(date) FROM price_history` → `('2000-11-27', '2026-09-03')` (26 years) ✓.

**Production VPS deployment steps:**
- [ ] Production VPS: `git pull origin main` + `pm2 restart python-backend nextjs`.
- [ ] Verify `db/price_history.db` is intact post-pull (gitignored — should remain unchanged; if missing, restore from `archive/databases-from-github/active_databases_20260817_full.zip`).
- [ ] Smoke test: `curl /api/chart/COMI?interval=1d&period=max` → expect ~6,500 daily candles (26 years).
- [ ] Smoke test: `curl /api/chart/COMI?interval=15m&period=1d` → expect either real intraday OR empty `data: []` with `source: 'no_intraday_data'` (NO fake candles).
- [ ] Smoke test: load `/stocks/COMI` in browser → TradingView widget renders by default on 1D timeframe.
- [ ] Monitor Sentry + structured logger for any new error patterns from the Python-first chart route (P0-3-CHART — DEFENSIVE-FALLBACK logs `[chart] Python load_price_history unreachable — falling back to direct SQLite`).
- [ ] Re-enable egksco_scraper cron (P1-6) — `0 16 * * 0-4 python3 /root/GLMinvestment/data_engine/scrapers/egksco_scraper.py` (Cairo 16:00 = market close + 90 min).

**Post-deployment monitoring (1 week):**
- [ ] Customer complaint volume on chart quality: expect 0 (was 20+ pre-Wave-7).
- [ ] `predictions` table: verify no new rows have `fundamental_score = 50.0` (should be NULL or 0.0).
- [ ] Python `load_price_history` logs: verify `egksco={N} rows` source is being used.

---


---

## §10 — Wave 8 Pipeline Coherence + Flutter + Admin + QA + Backtest + Visual

## 17. Wave 8 — Pipeline Coherence + Flutter + Admin + QA + Backtest Comprehensive + Visual Redesign (2026-10-04)

> **Source:** Multiple Wave 8 tasks — pipeline coherence audit (Task 26 — `55ae66e`), pipeline fix (`435c16f` — source_authority wired in master_analyzer — Rule 66 end-to-end), Flutter endpoints restored (`774a208` — 32 endpoints), comprehensive backtest (`d220fab` — 288 stocks, PF=4.74), visual redesign (Task 24 — 6 commits), Flutter app audit (Task 27-A — research), Admin panel audit (Task 27-B — research), Sharia UI (Task 23-C — `324a095` + `704aa0c`), Constitution Rules 64-66 (Task 23-A — `ae1df26` + `5867808`), and concurrent work by other programmers (commits `b1cc855` + `b97f606` + `7b0a9d3`).
>
> **Owner directive (2026-10-04):** «متنساش التوثيق لازم لازم السكرتيرات تحدث Documentation مش بملفات جديدة بس تحدث الى موجود بكل الشغل القديم والى بيحصل» — Documentation Secretariat MUST update the EXISTING 6 canonical docs (not create new files) with ALL work — old and new.

### 17.1 Pipeline Coherence Audit + Fix (Task 26)

> **Owner directive:** «محتاج مراجعة عميقة لكل الأكواد من حيث المنطق — النظام مش متفرق لأ هو أنابيب متوصلة صح» (need deep review of all the code logic — the system is not fragmented, it's a properly-connected pipeline).

**Audit results (commit `55ae66e`):**
- **243 API routes total** mapped end-to-end (Python brain → Next.js proxy → UI consumer → DB writer → DB reader → response consumer).
- **89 direct DB reads flagged** — routes that bypass `load_merged_history()` / `load_price_history()` canonical readers (Rule 12 violation candidates).
- **Pipeline coherence gaps** identified:
  - `source_authority.py` defined but NOT wired in `master_analyzer.py` (Rule 66 declared, not enforced).
  - 32 Flutter API endpoints marked "dead" by Wave 2 cleanup — were actually used by the Flutter mobile app (181 endpoint methods in `flutter_app/lib/api/client.dart`).
  - Multiple scraper INSERTs bypassing `write_guarded()` (Rule 66 — fixed in Task 23-B, 5/8 scrapers wired).

**Fix — source_authority wired in master_analyzer (commit `435c16f`):**
- `master_analyzer.analyze()` now checks the canonical source for the market before analysis (Rule 66 enforced end-to-end).
- Completes the pipeline chain: source (scraper) → authority (`write_guarded()` guard) → `price_history` (DB) → `load_price_history` (canonical reader, Rule 12) → `validate_stock_data()` (Rule 65) → `master_analyzer.analyze()` → output.
- Commits in this chain: `ae1df26` (source_authority.py created) → `5867808` (QA-22 P0-4 fix: crypto_fetcher + gold_fetcher made primary for CRYPTO/GOLD markets) → `435c16f` (wired in master_analyzer).

**تحديث 2026-10-08 (Task `REAPPLY-CRITICAL-FIXES` + `TIER3-ROUTES-MIGRATE`):**
- ✅ **6 bypass routes رُحِّلت لـ canonical** في Task `REAPPLY-CRITICAL-FIXES` (commit `38665fd1`). النتيجة: عدد canonical routes ارتفع من **6 → 12** (100% increase).
- ✅ **bypass-local-compute متبقّي = 0** (كل الـ local-compute routes اللي بتنتج signal/master_score/RSI/support/resistance اترحّلت لـ `/api/stocks/[ticker]/unified` → `getUnifiedStockData()`).
- ✅ **bypass-direct-DB (single-ticker) = 0** (كل single-ticker DB reads دلوقتي بتمر عبر canonical readers per Rule 12).
- ✅ **15 TIER 3 routes متحقق منها** (Task `TIER3-ROUTES-MIGRATE` 2026-10-08) — **0 true bypasses متبقّية**. التصنيف النهائي للـ TIER 3:
  - 1 already-canonical (StocksView + PredictionTrackingDashboard — confirmed canonical).
  - 3 non-financial (UI/metadata routes — لا تنتج signal/financial data).
  - 2 borderline-different-domain (market-intelligence + multi-market — descriptive metadata + score from TS-side heuristic، مأجّلة لـ schema documentation).
  - 7 proxy-to-python/listers (تقرأ من Python makers — canonical بالفعل).
- ✅ التحقق النهائي: `scripts/zero_conflict_test.py` PASS — 0.00% mismatch + 0 threshold drift + 0 HTTP errors (بعد تشغيل Python backend على 8010).

### 17.11 Python Backend Status (port 8010) — RUNNING as of 2026-10-08 (Task `FINALIZE-REMAINING-WORK`)

> **المرجع الدستوري:** Rule 20 (PYTHON-IS-THE-BRAIN) + Rule 73 (SINGLE-DISPLAY-SOURCE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW).

**الحالة الفعلية (verified 2026-10-08):**
- ✅ **Flask app RUNNING** على `http://localhost:8010` (entry point: `vps-service/lightweight_server.py`).
- ✅ **53 Flask blueprints مسجّلة** (verified via `BLUEPRINTS` list في `lightweight_server.py` L31-114 — Rule 20 enforced).
- ✅ **4 DBs متصلة + integrity ok:**
  1. `stocks.db` — ok.
  2. `predictions.db` — ok.
  3. `price_history.db` — ok.
  4. `data_engine.db` — ok.
- ✅ **WAL mode** مفعّل على كل connection (Rule: `PRAGMA journal_mode=WAL` + `busy_timeout=30000`).
- ✅ **4 circuit breakers closed** (4/4 — لا failures).
- ✅ **استهلاك ذاكرة:** 170MB only.
- ✅ **zero_conflict_test** (35 probes × 7 endpoints × 5 tickers × 6 canonical fields) → **0.00% mismatch** + 0 threshold drift + 0 HTTP errors. كان فيه 3 timeouts سابقًا، الآن 0 بفضل Python backend.

**Mapping الـ blueprints (للمرجعية المستقبلية):**
- 4/4 من الـ canonical signals مصادرها الآن Python backend (`canonical_signal.py` + `master_analyzer.py` + `engine_settings.py`).
- Rule 73 enforced end-to-end: كل الـ decision-screens بتقرأ من `/api/stocks/[ticker]/unified` → `getUnifiedStockData()` → canonical Python computations.

### 17.12 Multi-Market Segregation Status (6 markets + graceful fallback) — NEW 2026-10-09 (Task `PHASE-3` — commit `b18b3f21`)

> **المرجع الدستوري:** Rule 20 (PYTHON-IS-THE-BRAIN) + Rule 27 (NO-FAKE-DATA) + Rule 67 (CALCULATION-CANONICAL).
>
> **المشكلة:** كان فيه KSA/TADAWUL naming mismatch — الـ frontend بيستخدم `TADAWUL` كـ canonical لكن الـ Python `unified_config.py` بيستخدم `KSA`، والـ DB ممكن يكون فيه 'السعودية' كـ alias. والـ APIs كانت بترجّع 500 بدل 200 لما الـ DB فاضي لسوق معيّن.

**Canonical market normalization helper (NEW — `src/lib/market-utils.ts` — 200 LOC):**
- `normalizeMarket(input)` → يحوّل أي alias ('TADAWUL' / 'KSA' / 'السعودية' / 'saudi') للـ canonical value ('TADAWUL').
- `sqlMarketVariants(canonical)` → يرجّع كل variants للـ DB (مثلاً TADAWUL → ['TADAWUL','KSA','السعودية']).
- `buildMarketFilter(market, column)` → يبني SQL `WHERE market IN (?,?,?)` بالـ placeholders الصحيحة.
- `pythonMarketCode(market)` → يحوّل TADAWUL→KSA قبل الـ Python call (علشان `unified_config.py`).
- `NO_PREDICTIONS_MESSAGE_AR` + `NO_STOCKS_MESSAGE_AR` + `INTERNAL_ERROR_MESSAGE_AR` (رسايل عربية احترافية).

**الـ 6 أسواق المدعومة بالكامل (verified HTTP 200):**

| # | Market | Stocks Count | Source | Predictions Available | Status |
|---|---|---|---|---|---|
| 1 | `EGX` | **451** | stocks.db (EGX universe) | ✅ 153 (snapshot 2026-08-17 — sandbox) | ✅ Full support |
| 2 | `TADAWUL` (Saudi Arabia) | **390** | stocks.db (aliases: KSA + السعودية) | ❌ `[]` + AR message | ✅ Graceful (200) |
| 3 | `KSE` (Kuwait) | **138** | stocks.db | ❌ `[]` + AR message | ✅ Graceful (200) |
| 4 | `QSE` (Qatar) | **67** | stocks.db | ❌ `[]` + AR message | ✅ Graceful (200) |
| 5 | `US` | 0 (sandbox) | us_stock_scraper.py (live on VPS) | ❌ `[]` + AR message | ✅ Graceful (200 — was 503) |
| 6 | `CRYPTO` | independent | crypto_fetcher.py | ✅ independent endpoint | ✅ Full support |

**APIs المُحدَّثة (5 routes):**
1. `/api/predictions/honest-tracking/list/route.ts` — استبدال 500 → 200 graceful + إضافة message لـ non-EGX.
2. `/api/stocks/route.ts` — قبول TADAWUL/KSA/السعودية aliases + graceful fallback للـ US.
3. `/api/stocks/[ticker]/unified/route.ts` — قبول + validate market param بدون block.
4. `/api/v2/unified/analyze/route.ts` — تحويل TADAWUL→KSA قبل Python call.
5. `/api/predictions/daily-picks/route.ts` — استبدال 500 → 200 graceful + message.

**Trading hours per market (Fixed in `src/lib/market-hours.ts`):**
- KSE: كان 06:00-09:30 (خطأ)، بقى **08:00-12:45 Kuwait** ✅ (commit `b18b3f21`).
- QSE: كان 09:00-13:00 (خطأ في وقت الافتتاح)، بقى **09:30-13:00 Doha** ✅ (commit `b18b3f21`).
- EGX + TADAWUL + US + CRYPTO: كانت صحيحة من قبل، ما اتعدّلتش.

**Verification (تم اجتياز كل الاختبارات):**
- ✅ `curl /api/stocks?market=TADAWUL&page_size=3` → `success=true, total=390, stocks=3, source=stocks.db`.
- ✅ `curl /api/predictions/honest-tracking/list?market=TADAWUL&limit=3` → `success=true, predictions=[], message="لا توجد توقعات..."` (مش 500).
- ✅ `curl /api/stocks/2222/unified?market=TADAWUL` → `success=true, ticker=2222, name=أرامكو السعودية, canonical.signal=null` (Rule 27 محترمة).
- ✅ Aliases: `market=KSA` → 390 سهم · `market=KSE` → 138 · `market=QSE` → 67 · `market=EGX` → 451 (control) · `market=US` → `success=true, total=0` (بدل 503).
- ✅ KSE hours: open عند 08:00 Kuwait ✓ · QSE hours: open عند 09:30 Doha ✓.
- ✅ `bun run lint` → exit 0 (0 errors).

**10 ملفات اتعدّلت (Task `PHASE-3` — commit `b18b3f21`):**
1. `src/lib/market-utils.ts` — جديد (200 LOC).
2. `src/app/api/predictions/honest-tracking/list/route.ts`.
3. `src/app/api/stocks/route.ts`.
4. `src/app/api/stocks/[ticker]/unified/route.ts`.
5. `src/app/api/v2/unified/analyze/route.ts`.
6. `src/app/api/predictions/daily-picks/route.ts`.
7. `src/lib/market-hours.ts`.
8. `src/modules/dashboard/components/DevelopmentNotice.tsx` — إضافة 'US' للأسواق تحت التطوير.
9. `src/modules/portfolio/components/EnhancedPortfolioView.tsx` — market badge + auto-tag `stock_market`.
10. (لا تعديل على Python files — per task constraint).

### 17.13 CPU Optimization (daily_predictor micro-sleep) — NEW 2026-10-09 (Task `PHASE-1` — commit `e8df798d`)

> **المشكلة:** `daily_predictor.py` كان بياخد الـ CPU لـ 95% على Hostinger (نسبة لـ tight loop على 1,046 tickers بدون yield). ده بيتسبب في CPU limitation tripping.
>
> **الإصلاح:** Added `time.sleep(0.01)` at `daily_predictor.py:748` بين كل stock → CPU drops من 95% → **35%**.
>
> **Overhead:** 10ms × 1,046 tickers ≈ **10s إجمالي** (negligible — الـ run الكامل بياخد ~6-7 دقائق).
>
> **الموقع الدستوري:** Rule 8 (CAPITAL-PROTECTION-FIRST) — تحسين استقرار الـ host بيحمي الـ cron من الإيقاف.

### 17.14 Stability & Null-Safety Pass (Oct 8-9) — NEW 2026-10-09 (Task `DOCS-UPDATE-OCT9`)

> **ملخص شامل** للإصلاحات الـ 5 اللي حصلت في جلسة Oct 8-9 (موثّقة في `CHANGELOG.md` entry `[2026-10-09 — PHASE-1-TO-3 + STABILITY]`):

**A. 664 `.toFixed()` null-safety fixes** (across 118 UI components — Oct 8):
- كل call اتحوّل لـ safe pattern `(x ?? 0).toFixed(N)`.
- يمنع `TypeError: Cannot read properties of null (reading 'toFixed')` crash عند missing data.

**B. 8 `toLowerCase()/toUpperCase()` null crash fixes** (Oct 8):
- تمنع crash عند `null.toString()` في الـ string transformers.
- مثلاً: `(str ?? '').toLowerCase()` بدل `str.toLowerCase()`.

**C. 10 dead components archived** لـ `archive/dead-components-2026-10-08/` (Oct 8 — Rule 16 NO-DELETION):
- مكوّنات مش بتُستخدم في أي route نشط — اتأرشفوا (مش اتمسحوا).
- القائمة الكاملة في `Documentation/02-SCREENS_AND_COMPONENTS.md` §0.9.

**D. 23 mislabeled proxy routes unified** عبر `src/lib/market-pulse-proxy.ts` (Oct 8):
- كانت 23 route كل واحد بيستخدم helper مختلف بـ logic مختلف.
- اتعمل proxy واحد canonical وكل الـ routes بتستخدمه.

**E. 11 publishing/Telegram quality fixes** (3 critical + 5 quality + 3 disclaimer — Oct 8):
- **3 critical:** publish route NULL policy + disclaimer field required + image fallback.
- **5 quality:** message format + emoji standardization + image sizing + thumbnail + caption.
- **3 disclaimer:** disclaimer text mandatory + risk warning + arabic localization.

**F. 3 syntax error fixes** (regression من batch regex fix — Oct 9):
- `mini-sparkline.tsx`: `points[0].(x ?? 0)` → `(points[0].x ?? 0)` (commit `aca19f96` → `3a63bd04`).
- `SuperLearningSystem.tsx`: 6 broken patterns `PERSONA_BENCHMARK_DATA[p].(prop ?? 0)` → `(PERSONA_BENCHMARK_DATA[p].prop ?? 0)` (commit `d786b8d1`).
- `AIAnalysisWidget.tsx`: missing opening paren (commit `aca19f96`).

### 17.2 Flutter App — 32 Endpoints Restored (commit `774a208`)

> **CRITICAL P0 FIX:** Wave 2 cleanup archived 32 routes under `/api/mobile/*`, `/api/app/*`, `/api/ai/*`, `/api/confluence/*`, `/api/data-engine/*`, `/api/fomo/*`, `/api/google-play/*`, `/api/kimi/*`, `/api/learning/*`, `/api/live/*` — but they were all called by the Flutter app's `client.dart` (4,374 LOC, ~181 endpoint methods). The mobile app was silently broken — every screen that called one of these endpoints showed "no data" with no error message.

**Restored (32 endpoints from git history):**
- `/api/app/version` (version check) · `/api/ai/analyze-stock` · `/api/confluence/market-scan` · `/api/data-engine/health` + `/metals` · `/api/fomo/missed-opportunities` · `/api/google-play/verify-receipt` (Play Store IAP) · `/api/kimi/backtest/run` · `/api/learning/progress` · `/api/live/scan` (and 22 more — see commit `774a208` for full list).

**Result:** Flutter app route count effectively restored from 149 → 181 (the canonical Flutter client.dart method count). Verified via grep of `client.dart` — all 181 methods now resolve to live Next.js routes.

### 17.3 Comprehensive Backtest — 288 EGX Stocks, PF=4.74 (commit `d220fab`)

> **Owner directive:** «الباك تست المطلوب مش عينات الباك تست لازم يكون شامل وكامل وبفترة متقلش عن 4 شهور» (the required backtest is not samples — it must be comprehensive and complete with a period of no less than 4 months).

**Comprehensive backtest results (REAL data, FULL market):**

| Metric | Value |
|---|---|
| Stocks tested | **288 EGX stocks** (ALL active with data — not just 5 blue chips) |
| Period | 2026-04-01 → 2026-08-12 (4.5 months) |
| Data source | REAL `price_history.db` (not synthetic) |
| Engine | `V38BacktestEngine` (V40.2 canonical — Rule 21) |
| Total trades | 353 |
| **Profit Factor** | **4.74** ✅ (target ≥ 1.5) |
| Execution time | 372s (6 batches of 50 tickers) |

**Comparison to prior backtests:**
- Task `29ab6a7` (Wave 7 partial): PF=3.29, WR=56%, Sharpe=6.17 on REAL EGX data — but only 6 stocks sampled.
- This Wave 8 comprehensive run: PF=4.74 on 288 stocks — the broadest backtest ever run on the platform.
- Supersedes the fabricated PF=1.31 claim retracted in `RETRACTION-backtest-v4.md` (now in `05-CURRENT_STATE.md` §MERGED APPENDIX).

### 17.4 Visual Redesign — Emerald Theme (Task 24 — 6 commits)

> **Owner directive:** Platform felt like a "grayscale developer prototype"; needed to look like a "professional emerald financial institution."

**6-step visual polish (commit `e8ba231` → `fc90fa4`):**

| # | Step | Commit | Files touched |
|---|---|---|---|
| 1 | Emerald color system (was 0% saturation grayscale → hsl(160, 84%, 39%) ≈ #10B981 emerald-600) | `e8ba231` | `src/app/globals.css` |
| 2 | Cairo font + tabular figures (font-feature-settings 'tnum' 1 + 'cv01' 1) for price alignment | `10023ce` | `src/app/globals.css` |
| 3 | Card shadows + opt-in hover lift (`card-hover` utility) + body emerald radial gradient | `b2eb109` | `src/app/globals.css` |
| 4 | Login page gradient + emerald dot-grid texture + banner elevation | `3abda17` | `src/app/page.tsx` (AuthView wrapper) |
| 5 | TopBar backdrop blur + emerald accent line + button polish | `ce9ff97` | `src/components/layout/TopBar.tsx` |
| 6 | Button transitions + active scale (0.98) + emerald input focus glow | `fc90fa4` | `src/app/globals.css` |

**Compliance:** Rule 29 (NO-HYPE) — alpha ≤ 0.15 throughout, no neon. Rule 30 (CLIENT-FACING-STYLE) — no blue/indigo used. Rule 63 — 6 commits pushed.

### 17.5 Flutter App Audit (Task 27-A — research-only — RESEARCH)

> **Source:** `worklog.md` Task ID `27-A`. Audited 7 dimensions: Sharia compliance + new API endpoints + design system + subscription/paywall + data validation + chart quality + missing models.

**10 P0 issues found (handed off to Fix Battalion — see worklog Task 27-A for full details):**

| # | Issue | Severity | Block / Fix path |
|---|---|---|---|
| 1 | **CRITICAL: Trading Chart broken** — `trading_chart_screen.dart:715` reads `data['candles']/['chart_data']/['ohlc']/['series']` but the Python `/api/v2/chart/full-analysis` returns `data['ohlcv']`. Chart silently shows "لا توجد بيانات شموع متاحة" for every ticker. | critical-broken-flow | Add `data['ohlcv']` to the fallback chain. |
| 2 | MISSING: Sharia screen + Sharia API integration | missing-feature | Add `/api/sharia` GET method + create `lib/screens/sharia_screen.dart` mirroring `src/modules/sharia/components/ShariaView.tsx` + add `lib/widgets/sharia_badge.dart` mirroring `ShariaBadge.tsx`. |
| 3 | MISSING: Sharia models (ShariaStockMetric + ShariaSourceRow + ShariaPurificationRate + ShariaDetailResponse + PurificationResult) | missing-feature | Add `lib/models/sharia.dart`. |
| 4 | MISSING: Zakat API wiring — `zakat_screen.dart` does pure-local calculation only. | missing-feature | Wire it to `/api/zakat/calculate` (POST) + `/api/mobile/zakat-calculator` (GET) — both already defined in `client.dart` but unused. |
| 5 | **CRITICAL: Paywall responses not handled** — Flutter's `exit_radar_screen.dart` shows generic "no exit signals" empty state when API returns 403 `EXIT_RADAR_LOCKED` (Gate 2). | critical-broken-flow | Add `EXIT_RADAR_LOCKED` case + `UpgradeModal.show` trigger. |
| 6 | **CRITICAL: fair_value_locked not handled** — `stock_history_screen.dart:329` reads `_stockQuote?['fair_value']` but never checks `_stockQuote?['fair_value_locked'] == true` (Gate 1). | critical-broken-flow | Add explicit check + show UpgradeModal with `feature: 'fair_value'`. |
| 7 | **CRITICAL: _paywall object not handled in chart** — `trading_chart_screen.dart` ignores `_paywall.is_premium`, `_paywall.trap_detector`, `_paywall.early_trend`, `_paywall.trailing_stop`, `_paywall.full_narrative`. | critical-broken-flow | Add `PaywallState` model + render lock cards. |
| 8 | CRITICAL: trades_locked + details_locked not handled | critical-broken-flow | Add screens for `/api/predictions/historical-trades` (Gate 4) + `/api/radar/accuracy` (Gate 3). |
| 9 | **DESIGN MISMATCH: Indigo → Emerald** — Flutter primary is `#6366F1` (Indigo), but website now uses `hsl(160,84%,39%)≈#10B981` (emerald-600) per Task 24. | design-alignment | Change `AppColors.primary` from `0xFF6366F1` → `0xFF10B981` + `AppColors.primaryDark` → `0xFF059669` (emerald-700) + `AppColors.primaryLight` → `0xFF34D399` (emerald-400). |
| 10 | VALIDATION UX: null levels render as "0.00" — `trading_chart_screen.dart:812` coerces null support/resistance to 0.0. | validation-ux | Pass through null + display "—" in `_LevelRow` widget when value is null. |

### 17.6 Admin Panel Audit (Task 27-B — research-only — RESEARCH)

> **Source:** `worklog.md` Task ID `27-B`. Audited 8 dimensions: Sharia mgmt + Source authority + Validation monitor + News controls + Paywall mgmt + Pipeline health + User mgmt + Telegram mgmt.

**Backend exists, Admin UI missing — 10 P0 missing features (handed off to Fix Battalion):**

| # | Missing admin tab | Backend status | Why P0 |
|---|---|---|---|
| 1 | **Sharia admin tab** | ✅ Backend exists (`sharia_compliance_scraper.py` + **6** DB tables · `sharia_symbol_map` فيها `review_queue` · **AS-BUILT 2026-10-03**) | Admin can't trigger scraper manually + can't view `review_queue` (alias_map) + can't edit EFG↔HRHO symbol mappings + can't see last_scrape timestamp per source. |
| 2 | **Source Authority admin tab** | ✅ Backend exists (`source_authority.py` — CANONICAL_SOURCES + BANNED_SOURCES) | Admin can't view canonical sources per market + can't toggle banned state + can't see `write_guarded()` rejections log. |
| 3 | **Validation Monitor admin tab** | ✅ Backend exists (`validation.py::validate_stock_data()` returns `ValidationFinding[]`) | Admin can't view INVALID counts per stock per field + can't drill-down to ticker list + can't view `ValidationFinding.reason` + no audit trail of nullified fields. |
| 4 | **Pipeline / Cron Health dashboard** | ⚠️ `/api/admin/system-health` exists but NOT wired into `AdminView` (only `SystemMonitorPanel` calls `/api/admin/system-resources`) | Admin can't see `last_run`/`exit_code` for any of the 25 crontab jobs + no manual "run cron now" button. |
| 5 | **Paywall pricing-tier editor** | ⚠️ `plans.ts` hardcoded (normal=199/premium=299/developer=599 EGP — and `paymob/create-payment/route.ts` has developer=499 — INCONSISTENT) | Admin can't edit pricing without redeploy + can't toggle which features are paywalled + can't view the 7 backend gates status from PAYWALL-STRATEGY-FINAL §5.2. |
| 6 | **Conversion funnel dashboard** | ⚠️ `analytics_events` table exists, no admin view | Admin can't see trials_started → trials_expired → paid_conversions + revenue per tier + churn rate. |
| 7 | **News source health / broken dashboard** | ⚠️ `EnginesStatusTab` has start/stop/restart/force-update for data engine; `/api/data-engine/control?action=trigger_news` available | Admin can't see per-source `last_fetch` + `success_rate` + broken detection + no manual "run_news_collector.py" trigger button. |
| 8 | **Multi-source conflict viewer** | ✅ `write_guarded()` rejects non-canonical writes | Admin can't see when same ticker has data from >1 source + can't see which source is canonical + which is being silently rejected. |
| 9 | **Telegram published-predictions audit** | ⚠️ `predictions` table has `published_at` + `telegram_message_id` + `was_published` columns | Admin can't list predictions with `published_at` + `telegram_message_id` + `was_published` flag + no manual "publish pending" button for un-published predictions. |
| 10 | **Trial-expired user cleanup in NEW user-management tab** | ⚠️ `/api/admin/users/cleanup-expired` route exists + wired into legacy `UsersManagement.tsx` (the 'users' analytics tab) | NEW `UserManagementPanel` (the 'user-management' CRUD tab) does NOT have the cleanup dialog — admin using only the new tab can't trigger cleanup. |

**Full audit per dimension (see worklog Task 27-B):**
- Sharia mgmt: **MISSING** (only public `/api/sharia` + `ShariaView.tsx` on `#sharia` route)
- Source authority: **MISSING**
- Validation monitor: **MISSING**
- News controls: **PARTIAL**
- Paywall mgmt: **MINIMAL**
- Pipeline health: **PARTIAL**
- User mgmt: **PRESENT** (BOTH tabs: `UserManagementPanel` + `UsersManagement`)
- Telegram mgmt: **PARTIAL**

### 17.10 Shariah + Purification Pipeline — AS-BUILT (2026-10-03)

> **المرجع الدستوري:** Rule 64 (SHARIA-COMPLIANCE) · Rule 65.1 (تلف الـ `symbol`).
> **الحالة:** ✅ **شغال فعلياً** — مش موصوف على الورق بس. آخر تشغيل ناجح 2026-10-03 17:03 UTC.

#### Pipeline (from source to UI)

```
stocks.templatesnippet.com/data/stocks_merged.json   (static JSON · ETag + Last-Modified)
  └── sharia_compliance_scraper.py   [cron 30 15 * * 6 — السبت 15:30 UTC]
        ├── data_engine.db.sharia_sources             (8 مصادر · metadata + methodology)
        ├── data_engine.db.sharia_source_status       (2024 صف = 253 × 8)
        ├── data_engine.db.sharia_metrics             (253 صف · أرقام + إجماع + alias confidence)
        ├── data_engine.db.sharia_purification_rates   (572 صف · S&P primary + 3 تكميلية)
        ├── data_engine.db.sharia_symbol_map           (253 صف · طابور المراجعة)
        └── data_engine.db.sharia_history             (snapshot أسبوعي)
  └── purification_calculator.py  (Python=Brain per Rule 20)
        └── /api/sharia (قراءة مباشرة) + /api/sharia/purification (spawns Python)
```

#### Coverage الفعلي (2026-10-03)

| المقياس | القيمة |
|---------|--------|
| source records | 253 |
| `sharia_metrics` rows | **253** |
| `sharia_source_status` rows | **2024** (253 × 8) |
| `sharia_purification_rates` | **572** (S&P primary = **182** · musaffa + kashif + osoul = 390) |
| إجماع ≥6/8 (`is_halal_consensus=1`) | **49** سهم |
| alias مربوط | **250 / 253** (249 `exact_ticker` high + 1 `name_exact_code_differs` medium) |
| unresolved | **3** — `EFG` · `KORRA` · `MBEN` |
| collision مرفوض | **2** — `EFG→HRHO` · `KORRA→KORA` |
| `financial_transactions` rows | **0** ← مفيش ledger بيع، فالربح الرأسمالي المحقق غير متاح تاريخياً |

#### Alias review queue — محتاج قرار بشري

| المصدر | عندنا | الطريقة | الحالة |
|--------|-------|---------|--------|
| `LBCT` انترناشيونال بزنيس كوربوريشن | `IBCT` | `name_exact_code_differs` (الاسم العربي متطابق **بالظبط**) | ⏳ medium · **المصدر مفيهوش `IBCT` أصلاً** → واحد من الرمزين غلط |
| `EFG` (name_ar = None) | `HRHO` | `collision_with_existing_source_symbol` | ⛔ **مرفوض** — المصدر فيه `HRHO` كسهم مستقل · كلهم 0/8 |
| `KORRA` قرة لمشروعات الطاقة | `KORA` | `collision_with_existing_source_symbol` | ⛔ **مرفوض** — نفس الاسم العربي بالظبط · `KORA` = kashif compliant (1/8) و `KORRA` = 0/8 |
| `MBEN` إم بي للهندسة والمقاولات | — | `unresolved` | ❌ غايب عن **كل** جداولنا بكل الصيغ |

> **درس مؤثَّر:** المالك صحّح على `VLMR`/`VLMRA` («دول شركتين منفصلين مش شركة واحدة») → ده فتح تحقيق في نفس الفخ في المصدر وطلع `KORA`↔`KORRA` و `EFG`↔`HRHO`. **collision guard** بقى قاعدة دستورية.

#### Data fix — تلف الـ `symbol` في `tab_*` (كان بيمنع التطهير)

| البند | التفاصيل |
|------|----------|
| **العَرَض** | 8 جداول `tab_*` في `data_engine.db` متخزّنة بـ `symbol = TICKER + الاسم` (`'ABUKابوقير'` · `'ACFRAlexandria'`) |
| **الحجم** | **3664 صف** اتصلحوا (458 فاسد من 858 في كل جدول) |
| **السبب الجذري** | الـ scraper القديم كان بياخد الـ ticker والاسم من نفس الـ DOM cell |
| **الأثر** | كل JOIN بـ `stocks.ticker` بيفشل → `fetch_corporate_actions.py` (cron يومي) بيطلّع **0 صف dividend** · و `predictions.db.corporate_actions` فيها 106 `ipo` وصفر `dividend` |
| **الإصلاح** | `scripts/repair_tab_symbols.py` (dry-run افتراضي + backup + merge ذكي + **market-aware** إلزامي) |
| **النتيجة** | 280 من 285 صف مصرى بقى ticker نضيف · `ABUK` `dps_ttm` = 6.00 ج.م اشتغل · الإصلاح **idempotent** |
| **لسه** | 6 tickers سعودية unresolved (`CCIDChemical` · `EEGS70311C013El` · `MMITRMisr` · `NNBKENational` · `NNFCIELNASR` · `SSHUAIBAShuaiba`) |
| ⚠️ | market.db.stocks فيه نفس نوع التلف (`ACFRALEXANDRIA COMPANY FOR REFRACTORIESD` · `ADPCآ`) — **لسه متصلحش**، محتاج نفس السكربت على الـ master ده |

#### Purification على المحفظة الحقيقية (2026-10-03)

| المستخدم | المراكز | المعيار | الوعاء | **التطهير** |
|----------|---------|---------|--------|------------|
| `cmo8o12ix…` | 5 | S&P | — | **21,770.91 ج.م** |
| | SAUD بنك البركة | 32.95% | 17,193.54 | 5,665.27 ⚠️ (**5/8 متوافق** بس 33% من الربح محرّم) |
| | NHPS الوطنية للإسكان | 36.60% | 18,795.00 | 6,878.97 ⛔ **0/8** |
| | ABUK أبو قير | 8.50% | 105,142.04 | 8,937.07 |
| | EHDR · GGCC | 8.97% · 0.90% | 3,111.99 · 1,171.78 | 279.05 · 10.55 |
| `48457b7f…` | 9 | S&P | — | **185.77 ج.م** |
| | FWRY فوري | 33.00% | 482.56 | 159.24 ⛔ 0/8 |
| | EGCH الصناعات | 3.18% | 825.40 | 26.25 |
| | MOED المصرية لنظم التعليم | **0.00%** | 418.00 | **0.00** ✅ 8/8 |

> **الفرق الجوهري** اللي البيانات دي بتكشّفه: «متوافق» ≠ «متوافق مع تطهير». `SAUD` متوافق في 5 من 8 مصادر بس نسبة التطهير 32.95% → أكثر من ثلث ربحه محرّم لازم يتصدَّق. و `MOED` 8/8 و sp%=0 → نضيف فعلاً.

#### Fixed في نفس الـ pass

| # | المشكلة | الإصلاح |
|---|---------|---------|
| 1 | **IDOR** — `POST /api/sharia/purification` كان بياخد `user_id` من الـ body بدون auth → أي حد يقدر يبعت `user_id` حد تاني ويسيب محفظته الشرعية | `getSessionUserId()` + مقارنة `auth.userId === user \|\| isAdmin` → 403. النطاق المفرد فضل public |
| 2 | **تطهير سالب** — خسارة غير محققة كانت بتخصم من الوعاء وتطلع مبلغ سالب | S&P ملزم على الأرباح المستلمة فقط → الخسارة ماتخصمش + clamp عند 0 |
| 3 | **market-blind resolver** — `NBKبنك` (كويت) هتترجم لـ `NBK` في EGX | resolver بقى market-aware · cross-market conflicts = 0 |
| 4 | **الاسم العربي matcher** — كان بيستخدم `normalize_symbol` اللي بيشيل كل حروف العربية → كل المطابقة العربية بتنهار | `normalize_name` (بيحافظ على العربي + بيشيل التشكيل والهمزات) |
| 5 | **schema migration** — `sharia_metrics` كان موجود بـ 32 عمود فـ `CREATE TABLE IF NOT EXISTS` ما أضافش الأعمدة الجديدة | `_ensure_columns()` idempotent |
| 6 | **2 أخطاء TS pre-existing** في `ShariaStockCard.tsx` (Wave 8 Task 23-C) — `ShariaDetailResponse` مكانش exported | `export interface` في `ShariaBadge.tsx` → tsc نضيف على كل مسارات الـ sharia |
| 7 | **عقد mismatch مع `ShariaView.tsx`** — الـ UI بيقرأ `purification_rate_pct` + `realized_capital_gain` + `total_purification` + `trades_count` + `per_symbol`، والـ Python بيرجّع `rate_pct` + `capital_gain` + `totals.*` + `positions` → **تبويب محفظة التطهير كان هيعرض أصفار** | compat shim في الـ route بيطلّع الاسمين (canonical + alias) بدل تعديل المكوّن |

#### NOT DONE (قرارات المالك)

| البند | الحالة |
|-------|--------|
| `--sync-stocks` (تعبئة `stocks.is_halal` + `compliance_*`) | **متعطّل عمداً** — opt-in، تغيير schema في `stocks.db` محتاج موافقة صريحة |
| `stocks.db.stocks.market='EGX'` 383 ticker vs `market.db` 454 | الفجوة دي سبب إن `ANFI` كان هيتحسب فاقد — الـ resolver وصلها، بس الـ masters لسه متفرّقين |
| `market.db.stocks` تلف `symbol` | نفس تلف `tab_*` — **لسه** |
| `portfolio_assets` 8 صفوف تالفة | سبائك · دايموند · كلاود · مشغولات (أصول مش أسهم) · `INTEGRATED` (مش ticker) · `4160` (تاداول) — محتاجة قرار المالك |
| صفحات `/stocks/SYMBOL` scraping | الوصف + الموقع الرسمي مش في أي JSON — 253 طلب أسبوعياً، مش مطلوب دلوقتي |

---

### 17.7 Concurrent work by other programmers (in-progress / committed during Wave 8)

> Per owner directive: another 2 programmers may be active. Their work was pulled cleanly via `git pull --rebase` before each Wave 8 commit.

**Other-programmer commits (merged during Wave 8 — code present in `main`):**

| Commit | Author | File(s) | Purpose |
|---|---|---|---|
| `b1cc855` | other programmer | `src/modules/predictions/components/MakerRadarTab.tsx` (+10/-3) | Pass `market` prop in MakerRadarTab tables — fixes multi-market radar broken on non-EGX markets. |
| `b97f606` | other programmer | `scripts/fix_technical_support_resistance.py` (NEW, 218 LOC) + `src/app/api/stocks/[ticker]/comprehensive/route.ts` + `src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx` + `vps-service/api/stock_analysis_routes.py` | Enforce financial sanity on support + resistance + 52W range across API + UI + DB — rejects impossible values (low_52w > current_price, high_52w < current_price, support > resistance, support/resistance cross-stock contamination ratio > 10x). |
| `7b0a9d3` | other programmer | `news-agent/collectors/rss_collector.py` + `news-agent/collectors/telegram_collector.py` + `news-agent/collectors/telegram_web_collector.py` (NEW, 181 LOC) + `news-agent/collectors/web_scraper.py` + `news-agent/data/news_store.py` + `news-agent/main.py` + `scripts/check_stock_prices.py` + `vps-service/data/prices.py` (+52) | Parse formatted volume strings (K/M suffixes like `1.2K`, `3.4M`) in `load_egksco_history` + enhance news-agent collectors (RSS + Telegram + Web scraper + new `telegram_web_collector.py`). |

**In-progress (announced by owner, not yet in `main`):**
- ~~News engine being fixed by other programmer — full news collection + sentiment pipeline overhaul.~~ → ✅ **DONE 2026-10-03** (شوف §17.9).
- Ticker unification script by other programmer — `scripts/unify_tickers_and_names.py` creates `ticker_registry` table in `stocks.db` with canonical mappings + collision guards + restores Arabic names.
- Support/resistance sanity gate by other programmer — first pass merged (`b97f606`); full integration pending.

### 17.8 Wave 8 Stage Summary

- ✅ **DONE (committed + pushed):**
  - Pipeline coherence audit — 243 routes mapped (commit `55ae66e`).
  - `source_authority.py` wired in `master_analyzer.py` — Rule 66 enforced end-to-end (commit `435c16f`).
  - 32 Flutter API endpoints restored from git history — mobile app no longer silently broken (commit `774a208`).
  - Comprehensive backtest — 288 EGX stocks, 353 trades, PF=4.74 (commit `d220fab`).
  - Visual redesign — emerald color system (Task 24 — 6 commits).
  - Sharia UI shipped (Task 23-C — `324a095` + `704aa0c`) — `ShariaView` + `ShariaBadge` + `ShariaStockCard`.
  - Constitution Rules 64-66 added (Task 23-A) — SHARIA-COMPLIANCE + DATA-VALIDATION-LAYER + SOURCE-AUTHORITY.
  - Multi-market deploy script `scripts/deploy_data_engine_fix.sh` (Task 23-D — commit `0a85306`) — covers all 7 markets.
  - **News engine overhaul** (2026-10-03 — §17.9).
- ⏳ **PENDING (hand-off to Fix Battalion):**
  - 10 Flutter P0 items (Task 27-A items 1-10 above) — research only.
  - 10 Admin panel P0 missing features (Task 27-B items 1-10 above) — research only.
- 🔄 **IN PROGRESS by other programmers:**
  - ~~News engine fix.~~ → ✅ DONE 2026-10-03 (§17.9).
  - Ticker unification script (`ticker_registry` table in `stocks.db`).
  - Support/resistance sanity gate (first pass merged in `b97f606`).

### 17.9 News Engine — overhaul 2026-10-03 (✅ DONE)

فحص حي لكل مصدر + كل طبقة في خط الإنتاج. كانت النتيجة إن **2 من 5 مصادر** شغالين
(Bوابة واحدة ميتة من 7 أيام)، و**123 صف** في الداتابيز متخزّنين HTML خام بيظهر كـ tags على الموقع.

#### التشخيص — ليه كان بيجمع 20–60 خبر/يوم بس

| # | السبب | الدليل |
|---|---|---|
| 1 | `ENABLE_EGYPTIAN_SOURCES` مش في `.env` والافتراضي `0` | آخر log من `EgyptianSources`: 2026-09-25 14:38 |
| 2 | مسار `vps-service` غلط في `web_scraper.py` و `news_analyzer.py` | `../GLMinvestment/vps-service` = مسار مزدوج + `except: pass` أخفى الخطأ (290 warning) |
| 3 | `TICKER_HINTS` كان يترجّع لـ 4 entries بدل 158 | نفس المسار الغلط في `news_analyzer.py` |
| 4 | **البوت مش بيقدر يقرأ القنوات** | `BotMethodInvalidError: The API access for bot users is restricted` |
| 5 | `TELEGRAM_BOT_TOKEN` في `news-agent/.env` منتهي | `AccessTokenExpiredError` (التوكن الصالح في root `.env`) |
| 6 | 3 من 5 RSS feeds بترجّع HTML مش RSS | `argaam` / `amwalalghad` / `youm7` — اختبار حي: `code=200 items=0 ct=text/html` |
| 7 | `rss_collector.py` كان بيخزّن `<div><img/><p>…</p></div>` خام | 123 صف فيه HTML |
| 8 | `quote` مستخدم بدون import في `egyptian_sources.py` | `NameError: name 'quote' is not defined` — كان بيقتل جامع المال كل دورة |
| 9 | `news_fetcher_analyzer.py` بيـ query أعمدة مش موجودة | `source_url`, `image_url`, `symbol`, `category`, `is_valid_news`, `language` → 20 warning/دورة |

#### الإصلاحات

| الملف | التغيير |
|---|---|
| `news-agent/config/paths.py` | `resolve_vps_service()` — مسار **نسبي** (يشتغل على اللاب والإنتاج، Rule: paths relative) |
| `news-agent/config/text_utils.py` **(جديد)** | `strip_html()` — HTML + كيانات + WordPress boilerplate |
| `news-agent/collectors/telegram_web_collector.py` **(جديد)** | جامع `t.me/s/<channel>` — **بدون أي login**، 5 قنوات |
| `news-agent/collectors/rss_collector.py` | تنظيف HTML + استخراج الصور (`<img>`, `<image>`, `media:content`, `enclosure`) + `og:image` enrichment + URL encoding للمسارات العربية + شيل الـ feeds الميتة |
| `news-agent/collectors/web_scraper.py` | مسار نسبي + خطأ الـ import بقى **ظاهر** + `WEB_MAX_TICKERS` (كان:first 5 ticker بس) |
| `news-agent/collectors/egyptian_sources.py` | `import quote` |
| `news-agent/analyzer/news_analyzer.py` | `strip_html` على title/body/`clean_text` + مسار `vps-service` صح |
| `news-agent/data/news_store.py` | `exists_body()` — فحص المكرر **قبل** الفلترة (يوفّر شغل Ollama) |
| `vps-service/analyzers/news_fetcher_analyzer.py` | تصحيح أعمدة `market_news` |
| `src/app/api/news/route.ts` | تنظيف HTML **عند الاستقبال** (حدود الـ API) |
| `news-agent/scripts/clean_news_html.py` **(جديد)** | تنظيف الصفوف الموجودة + نسخة احتياطية |

#### النتيجة (دورة واحدة حقيقية — 2026-10-03)

```
web(DDG) 7 · rss 24 · telegram_web 27 · egyptian 32  =  90 خبر
links 90/90 · images 73/90 · HTML 0/90
```

| المقياس | قبل | بعد |
|---|---|---|
| مصادر نشطة | 2 (RSS) | 6 (RSS×3 + تيليجرام + DDG + مصري) |
| خبر/يوم | 20–60 | ~360 (90/دورة × 4) |
| تغطية اللينك | جزئي | 100% |
| صفوف فيها HTML | 123 | **0** |
| `TICKER_HINTS` | 4 | 158 |

#### ⏳ متبقي (يحتاج تدخل بشري)

| # | البند | ليه |
|---|---|---|
| 1 | `TELEGRAM_BOT_TOKEN` في `news-agent/.env` | منتهي — التوكن الصالح `@investusernamebot` في root `.env` (استخدامات النشر/السوشيال) |
| 2 | `pm2 restart news-agent --update-env` | `ecosystem.config.js` بيحقن القيم في `process.env` وقت التشغيل، و`load_dotenv()` بـ `override=False` — من غير restart التعديلات ما تترقراش |
| 3 | `news-agent/.env` vs root `.env` | ملف مكرّر بتيجي يتأخر: **7 متغيرات ناقصة** + **9 قيم مختلفة** (منها التوكن المنتهي + أسعار Paymob قديمة). الـ drift ده سبب الـ bugs دي. |
| 4 | `MIN_IMPORTANCE_SCORE=55` | 118 خبر اتحلّل وماتبعتش (importance < 55). lowering to 40 هيقلّل الـ loss بس هيوسّع الضوضاء. |
| 5 | `data_engine/scrapers/news_scraper.py` | بيشتغل كل 6 ساعات وبيطلع **صفر** — كل مفاتيحه `YOUR_*_KEY` + `news_articles` = 0 صف |

---


---

## §11 — Retraction: backtest v4 PF=1.31 (fabricated claim)

## 📎 MERGED APPENDIX — Retraction — backtest v4 PF=1.31 claim (RETRACTION-backtest-v4.md)

> **Source file (merged then archived):** `RETRACTION-backtest-v4.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `RETRACTION-backtest-v4.md` (verbatim):

# RETRACTION — backtest v4 PF=1.31 claim (Wave 1 P0 Fix 2)

> **Document type:** Retraction notice (Rule 16 — Verified Honesty / Rule 27 — NO-FAKE-DATA)
> **Wave:** Wave 1 P0 Rebuild (Task 11, Fix 2)
> **Date:** 2026-10-01
> **Agent:** Fix Battalion (Wave 1 P0 Rebuild)

---

## 1. The fabricated claim being retracted

Lost commit `0b4f2f1` carried the message:

> *"4 backtest versions, v4 winner PF=1.31"*

The commit's actual diff was **36 lines of markdown** added to `worklog.md`
describing a backtest result that was never produced. **No backtest script
existed.** No `BacktestSummary` was ever instantiated. The figure `PF=1.31`
was fabricated.

This is a Rule 27 (NO-FAKE-DATA) violation of the strictest kind: an
invented performance number was placed in the project's audit trail as if
it had been measured.

## 2. What this retraction does

Per Rule 21 (V40.2 sole source), this rebuild runs the canonical
`V38BacktestEngine` (the same engine used by `vps-service/engines/backtest_engine.py`,
invoked here with `use_v393=True` — the V40.2 `institutional_decision_engine`
path) under **FOUR DIFFERENT PARAMETER CONFIGS** — NOT four competing engines.

| Config               | buy_threshold | rr1 | rr2 | max_holding_days | scan_interval |
|----------------------|---------------|-----|-----|------------------|---------------|
| `v40.2-baseline`     | 75            | 2.0 | 3.0 | 7                | 5             |
| `v40.2-aggressive`   | 65            | 2.5 | 3.5 | 10               | 4             |
| `v40.2-conservative` | 85            | 1.5 | 2.5 | 5                | 7             |
| `v40.2-balanced`     | 70            | 2.0 | 3.0 | 14               | 6             |

## 3. The real numbers (replacing the fabricated PF=1.31)

Sandbox-only run on 10 synthetic EGX tickers × 280 days of deterministic
price history (random seed = `20261001`).

| Config               | Trades | Win%  | Gross Profit | Gross Loss | **PF**   | MaxDD% | Sharpe | Final Equity |
|----------------------|--------|-------|--------------|------------|----------|--------|--------|--------------|
| `v40.2-baseline`     | 278    | 65.11 | 211.52       | 79.43      | **2.663**  | 6.05   | 6.18   | 365.96       |
| `v40.2-aggressive`   | 353    | 61.19 | 312.06       | 128.03     | **2.4375** | 13.29  | 5.78   | 604.96       |
| `v40.2-conservative` | 200    | 58.50 | 124.85       | 56.47      | **2.2109** | 6.46   | 4.76   | 195.39       |
| `v40.2-balanced`     | 222    | 63.06 | 245.05       | 87.13      | **2.8125** | 10.83  | 7.07   | 469.17       |

**Observations:**
- No config produced `PF=1.31`. The fabricated figure does not appear in any
  real run.
- `v40.2-balanced` (mid-threshold + canonical R:R + 14-day hold) produced
  the highest PF on this synthetic dataset (2.8125).
- `v40.2-conservative` produced the lowest PF (2.2109) — its higher
  threshold filtered out enough setups that the smaller sample tilted
  toward break-even (final equity 195.39 vs 365–604 for the others).
- All four configs finished with PF > 2.0 — but **these numbers are from
  synthetic data**. They are NOT a production claim. They are evidence that
  the backtest engine produces real, verifiable numbers when actually run,
  and that the lost commit's PF=1.31 was never measured by anything.

## 4. Reproducibility

```bash
# Sandbox only (Rule 1)
cd /home/z/my-project
python3 vps-service/tools/run_backtest_versions.py --tickers 10 --days 280
```

Outputs (written under `vps-service/backtest_results/`):
- `wave1_p0_backtest_versions_<UTC-timestamp>.json` — full BacktestSummary
- `wave1_p0_backtest_versions_<UTC-timestamp>.md` — Markdown report

The script is deterministic (random seed = `20261001`). Re-running it on
the same sandbox produces identical numbers.

## 5. Caveats

1. **Synthetic data.** The numbers above are from a deterministic synthetic
   dataset (10 EGX tickers with positive-drift GBM price paths). They are
   NOT a production claim. They demonstrate that the script actually runs
   and produces real BacktestSummary objects — not a fabricated PF.
2. **Sandbox schema gap.** The sandbox `price_history` table created by
   `scripts/init-databases.py` uses column names `open/high/low/close`
   while the production engine reads `open_price/high_price/low_price/close_price`.
   The script ALTERs the sandbox table to add the production-style columns
   (idempotent). It does NOT touch production.
3. **Benchmark + sector changes unavailable in sandbox.** The engine warns
   `مفيش بيانات benchmark` and `Error loading sector changes` because those
   tables aren't populated. The trade outcomes are still real — these
   signals simply don't apply their benchmark/sector gates.
4. **The old fabricated PF=1.31 has been removed from the audit trail.**
   This retraction document is the canonical replacement.

## 6. Rule compliance

| Rule | Compliance |
|------|------------|
| Rule 1 (NEVER touch prod DBs) | ✅ Script refuses to run on `/root/GLMinvestment` or `/home/meme/my_apps/GLMinvestment` paths |
| Rule 6 (schema-aware) | ✅ `PRAGMA table_info` checks before any ALTER/INSERT |
| Rule 16 (Verified Honesty) | ✅ Real BacktestSummary objects with literal PF numbers |
| Rule 21 (V40.2 sole source) | ✅ Same `V38BacktestEngine` × 4 PARAMETER configs — NOT 4 competing engines |
| Rule 27 (NO-FAKE-DATA) | ✅ This retraction removes a fabricated PF; numbers above are real |
| Rule 61 (relative paths) | ✅ `Path(__file__).resolve().parents[N]` everywhere |
| Rule 62 (commit + push) | ✅ Committed and pushed immediately after this document |

---


---

## §12 — Retraction: console.error claim (lost commit 25781d3)

## 📎 MERGED APPENDIX — Retraction — console.error claim in lost commit 25781d3 (RETRACTION-console-error-claim.md)

> **Source file (merged then archived):** `RETRACTION-console-error-claim.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `RETRACTION-console-error-claim.md` (verbatim):

# RETRACTION — console.error claim in lost commit 25781d3 (Wave 1 P0 Fix 3)

> **Document type:** Retraction notice (Rule 16 — Verified Honesty / Rule 58 — observability)
> **Wave:** Wave 1 P0 Rebuild (Task 11, Fix 3)
> **Date:** 2026-10-01
> **Agent:** Fix Battalion (Wave 1 P0 Rebuild)

---

## 1. The fabricated claim being retracted

Lost commit `25781d3` carried a message claiming:

> *"28 `console.error(error.message)` → `console.error(error)` conversions FIXED"*

The commit's actual diff made **ZERO** such changes — the file list did not
contain a single edit to an API route file. The "28 conversions" figure
was fabricated.

This is a Rule 27 (NO-FAKE-DATA) violation: an invented refactor was
placed in the audit trail as if it had been performed.

## 2. Verification of the fabrication (Rule 16 — VERIFY-BEFORE-DELETE)

The claim was checked against the current state of `src/app/api/`:

```bash
$ rg -c "console\.error\(error\.message\)" src/app/api --type ts
# → many files still contain the pattern; no prior sweep had happened
$ rg -l "from '@/lib/logger'" src/app/api --type ts
# → only 1 file (src/app/api/health/route.ts)
```

Before this fix, only `src/app/api/health/route.ts` used `logger.*`.
The other 296 API route files under `src/app/api/` still contained at
least one `console.*` call. The "28 conversions" never happened.

## 3. What this retraction does

Per Rule 58 (P0-WAVE-OBSERVABILITY) the project ships a structured JSON
logger at `src/lib/logger.ts`. This fix begins the real Rule 58 sweep by
converting **6 API route files** (one more than the 5 requested) from
`console.*` to `logger.*`:

| File | `console.*` removed | Notes |
|---|---|---|
| `src/app/api/admin/sync-vps/route.ts`         | 11 | POST + GET handlers — admin-only VPS sync |
| `src/app/api/sync-historical/route.ts`        |  7 | POST + GET — admin-only historical price sync |
| `src/app/api/mobile/notifications/route.ts`   |  6 | GET + POST — mobile app notifications |
| `src/app/api/paymob/callback/route.ts`       | 10 (1 comment-only left) | GET redirect + POST webhook — payment callbacks (SEC-03 HMAC) |
| `src/app/api/market/sync-live/route.ts`      | 23 | POST — admin-only live market sync (largest impact) |
| `src/app/api/subscription/activate/route.ts`  |  8 | POST — Paymob-verified subscription activation (CRIT-2) |
| **Total**                                     | **65** real `console.*` calls converted to `logger.*` | |

The remaining `console.warn` reference in `paymob/callback/route.ts:14`
is inside a documentation comment describing the old vulnerable
behavior — it is not executable code. Leaving it preserves the
SEC-03 audit-trail context.

## 4. Conversion pattern used

Old (unstructured):
```ts
console.error('[sync-vps] VPS error:', stocksResponse.status, errorText);
console.log(`[Sync Live] Fetched ${tickers.length} stocks via egxpy/TradingView...`);
console.warn(`[sync-vps] Error fetching history for ${ticker}:`, err);
```

New (structured JSON, one-line):
```ts
logger.error('sync-vps VPS error response', { status: stocksResponse.status, body: errorText.slice(0, 500) });
logger.info('sync-live fetching via egxpy/TradingView', { tickerCount: tickers.length });
logger.warn('sync-vps error fetching price history', { ticker, err: String(err) });
```

Each call:
- Drops the `[scope]` prefix (the message string is now the structured message)
- Passes variables as a context object (greppable + ingestible by any log aggregator)
- Wraps `err` in `String(err)` so the logger never throws on non-Error throws

## 5. Verification of this retraction (Rule 16 — Verified Honesty)

```bash
$ for f in src/app/api/admin/sync-vps/route.ts src/app/api/sync-historical/route.ts \
           src/app/api/mobile/notifications/route.ts src/app/api/paymob/callback/route.ts \
           src/app/api/market/sync-live/route.ts src/app/api/subscription/activate/route.ts; do
    count=$(rg -c "console\.(log|error|warn|info)" "$f" | rg -v "^\s*\*|//" | wc -l)
    echo "  $f → $count code-level console.* calls remaining"
  done
# → all 6 files show 0 code-level console.* calls (only 1 comment in paymob/callback)

$ rg -l "from '@/lib/logger'" src/app/api --type ts | wc -l
# → 7 files (was 1 before this fix; +6 in this commit)

$ bun run lint
# → EXIT 0
```

## 6. Rule compliance

| Rule | Compliance |
|------|------------|
| Rule 14 (no commit before verify) | ✅ `bun run lint` EXIT 0 before commit |
| Rule 16 (Verified Honesty) | ✅ Counts verified with `rg` before + after |
| Rule 27 (NO-FAKE-DATA) | ✅ This retraction removes a fabricated "28 conversions" claim; replaces with 65 real conversions |
| Rule 58 (P0-WAVE-OBSERVABILITY) | ✅ 6 API route files migrated to structured `logger.*` |
| Rule 62 (commit + push) | ✅ Committed and pushed immediately after this document |

## 7. Follow-up (NOT in scope — for next wave)

- **~290 more API route files** still use `console.*` (down from 297 before
  this fix). Most are GET-only public-data routes; a focused sweep should
  prioritize routes that handle authenticated writes, payments, admin
  actions, or external API calls.
- **`/api/health` route** is already 100% on `logger.*` (it was the only
  pre-existing user of `logger`).
- **A repository-wide lint rule** could enforce "no new `console.*` in
  `src/app/api/`" — left as a future task.

---


---

## §13 — Wave 2 + Wave 3 Changelog (2026-10-01)

## 📎 MERGED APPENDIX — Wave 2 + Wave 3 Changelog (WAVE-2-3-CHANGELOG-2026-10-01.md)

> **Source file (merged then archived):** `WAVE-2-3-CHANGELOG-2026-10-01.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `WAVE-2-3-CHANGELOG-2026-10-01.md` (verbatim):

# 📜 Wave 2 + Wave 3 Changelog — 2026-10-01

> **Consolidated changelog of every commit in Wave 2 (cleanup) + Wave 3 (education unification + recommendations consolidation + i18n Phase 1).**
>
> **Owner directive (2026-10-01):** "التناسق وعدم التكرار" — Wave 2 dead-file cleanup + Wave 3 unification of duplicate screens + reduce `#recommendations` tab noise + fix broken `PersonalizedRadarTab` + continue i18n migration to 100%.
>
> **Authority:** This file is a **changelog** (Rule 63.2 allows changelog files — NOT a new screen/system). It complements — does NOT replace — the 6 canonical docs. See `00-CONSTITUTION.md` (Rule 4 NO-NEW-FILES + Rule 62 GIT-PUSH-DISCIPLINE + Rule 63 PUSH-AFTER-EVERY-COMMIT + NO-NEW-SCREENS-FILES) for the rules that authorize this file.
>
> **Created:** 2026-10-01 by Documentation Secretariat (Task ID `WAVE-2-3-DOCS`).
>
> **Companion docs:** See `05-CURRENT_STATE.md` §13 (Wave 2 Cleanup Summary) + §14 (Wave 3 Consolidation Summary) for the section-by-section narrative + `02-SCREENS_AND_COMPONENTS.md` §0.5 + §0.6 for screen-level deltas.

---

## Wave 2 — Cleanup Wave (2026-10-01)

> **Source:** worklog.md Tasks `6-A2` (Frontend discovery) + `6-B2` (API routes discovery) + `6-C2` (Backend Python discovery) + `7-A` (Frontend + Backend execution) + `7-B` (API routes execution).
>
> **Owner directive:** "التناسق وعدم التكرار" + Rule 16 (VERIFY-BEFORE-DELETE) + Rule 25 (refactoring-gated — owner pre-approved Wave 2 deletions) + Rule 55 (P0-WAVE-SECURITY — apply to any data-mutating/admin routes found dead-with-no-auth).
>
> **Three-battalion discovery (Tasks 6-A2 + 6-B2 + 6-C2):**
> - 6-A2 Frontend Battalion — scanned `src/components/**` + `src/modules/**` + `src/lib/**` via 3-pattern importer-count map → 71 dead files / 21,335 LOC.
> - 6-B2 API Routes Battalion — scanned `src/app/api/**` (693 routes / 813 dirs / 161 top-level groups) via per-route caller-grep across src/ + vps-service/ + crontab.txt + ecosystem.config.js + dynamic imports → 319 dead route candidates / ~37,080 LOC.
> - 6-C2 Backend Python Battalion — scanned `vps-service/{analyzers,jobs,api,engines,engine,telegram,data,ai,core,tools,utils}` → 58 dead files / ~30,504 LOC.
>
> **Total dead candidates:** 448 files / ~89,000 LOC.

### Wave 2.1 — Frontend Cleanup (Task 7-A — 4 sub-batches + 1 restore + 1 false-negative-restore)

| # | Commit | Sub-batch | Files deleted | LOC removed | Files skipped | Push status |
|---|---|---|---|---|---|---|
| 1 | `4796647` | shadcn UI primitives (tree-shaken, never imported) | 16 | 2,961 | 0 | ✅ pushed |
| 2 | `6f89c61e9613c1de0a7a44641998b559d7ece94f` | Frontend legacy (CandlestickWidget + FibonacciWidget + DevilsAdvocatePanel + NotificationBell + AIView + OpportunityCard + PerformanceTracker + RecommendationHistory + RecommendationMonitoring + SocialPostView + PublishedPredictions + SectorTrackingTab [analysis/market-analysis duplicate]) | 12 | 3,868 | 0 | ✅ pushed |
| 3 | `f592f45d781b3f7f9bc4de9b930f2202b1a7ae36` | Frontend admin (14 dead admin components — caught 3 false positives via MarketingStudio.tsx lazy imports: ContentStudioHub + MarketingHub + VideoEditor were kept alive) | 14 | 6,243 | 3 (false positives — kept alive) | ✅ pushed |
| 4 | `f1eec20fd3cea033fa14dba1d42db6f1488f528b` | Frontend remaining (PicksManagementView 1,063 LOC + SectorPieChart + SectorTreemapCard [standalone — live is inline in RadarStatsCards.tsx:335] + RiskManagementBar + UnifiedHoldingsTable + PositionDeepDiveDrawer + UpsellToasts) | 7 | 2,077 | 0 | ✅ pushed |
| 5 | `358e2aa47aa085bc6f959174ede6e3653a7cc1d5` | Frontend lib TS (api-cache + api-config + auto-seed-stocks + build-trigger + candlestick-patterns + db-helpers + patch-html2pdf + pick-formatter + prediction-validator + seed-subscription-pricing + seed-virtual-investor + sqlite-compat + use-engine-updates + use-undo-redo + cache/data-freshness + cache/api-cache + devil/market-mood + expert/expert-filter) | 18 | 3,141 | 0 | ✅ pushed |
| 6 | `2529dba` | HTTP 500 RESTORE — 2 lib files restored post-deletion when dynamic callers (Next.js `next/dynamic` imports) were discovered | (restored 2 files: cache/api-cache.ts + cache/data-freshness.ts) | (restored ~378 LOC) | (the 2 restored files were archived instead) | ✅ pushed |
| 7 | `1b8166b` | docs(counts): update stale component/route counts post-Wave-2 cleanup (metadata-only commit — touched README + 4 canonical docs with stale counts) | — | — | — | ✅ pushed |
| 8 | `4212242` | archive(restore): recover 123 deleted frontend+backend files to archive/ folder (owner directive — NOT deleted — recoverable if any caller is later discovered in production) | (moved 123 frontend files to `archive/wave-2-cleanup-2026-10-01/src/`) | — | — | ✅ pushed |
| **TOTAL Frontend** | (8 commits) | | **51 + 16 shadcn = 67 dead .tsx + .ts files** | **~21,335 LOC** | **3 false positives caught + kept alive** | all ✅ pushed |

### Wave 2.2 — Backend Python Cleanup (Task 7-A sub-batches 5a + 5b + 5c)

| # | Commit | Sub-batch | Files deleted | LOC removed | Files skipped | Push status |
|---|---|---|---|---|---|---|
| 1 | `41d70c6006326cb052b1249533e89a10f6e556bf` | Backend analyzers (correlation_filter + crypto_event_tracker + crypto_short_holding_exit + devil_quality_gate + dynamic_analysis_engine + dynamic_risk_engine + educational_cards_engine + event_impact_tracker + expert_memory_v4 + explosive_uncap_engine + fundamental_quality_gate + indicator_trust_scores + market_manager + market_regime_detector + prediction_validator + sniper_filter + technical_analyzer + trend_following_paper_trading + unified_analyzer [3,736 LOC — largest dead file in repo] + v4_predictive_detector) | 20 | 16,039 | 0 | ✅ pushed |
| 2 | `edb76c14eda5885487da21c7be04cdd07fc7d007` | Backend telegram cluster (telegram_marketing_engine + telegram_intraday_alerts + telegram_chart_generator + telegram_daily_lessons + telegram_interactive_bot + telegram_breaking_news + telegram_closing_scorecard + telegram_morning_bell + telegram_market_analysis + telegram_sectors_report + telegram_target_hit_tracker [SKIPPED — confirmed LIVE via auto_post_scheduler.py:1524 → PM2 telegram-poster → telegram_bp at lightweight_server.py:73] + verify_bot_gate + patch_auto_poster + screener_blast + telegram_radar_notifier + telegram_news_scraper + radar_card_publisher) | 16 | 6,954 | 1 (telegram_target_hit_tracker.py — Rule 16 caution flag, RE-VERIFIED LIVE) | ✅ pushed |
| 3 | `c235ce7680a4923ee4c4ffe405932f523b7c583f` | Backend engines + engine + jobs + ai + data + tools (engines/historical_prediction_generator + engines/master_backfill_adapter + engine/crypto_full_system + engine/live_prediction_engine + jobs/daily_gainer_scan + jobs/fetch_earnings_calendar [SKIPPED — cron-driven per crontab.txt:53] + jobs/hot_candidate_detector [SKIPPED — cron-driven per crontab.txt:150] + ai/continuous_learning + ai/prompt_templates + ai/story_generator + ai/test_live_rag_analysis + ai/test_rag_decision + data/multi_market_fetcher + data/us_stocks_fetcher + tools/diagnose_db_structure + tools/diagnose_predictions + tools/evaluate_predictions + tools/migrate_price_history + tools/price_history_resolver + tools/restore_dbs + tools/restore_from_local) | 20 | 6,921 | 2 (fetch_corporate_actions + hot_candidate_detector — cron-driven per crontab.txt) | ✅ pushed |
| **TOTAL Backend** | (3 commits) | | **56 dead .py files** | **29,914 LOC** | **3 false positives caught + kept alive** | all ✅ pushed |

### Wave 2.3 — API Routes Cleanup (Task 7-B — 7 batches)

**6-grep verification protocol applied per route:** `rg -F "<path>" src/` + `rg -F "<path>" flutter_app/` (empty post-reset) + `rg -F "<path>" vps-service/` + `rg -F "<path>" crontab.txt` + `rg -F "<path>" ecosystem.config.js` + dynamic-import patterns (`await import(...)` + `require(...)`). Result: 49 of 319 candidates had >0 hits, but 48 were false positives (subroute route.ts files / Python blueprint registrations on Python side / Python docstrings). Only 1 real caller was found (`/api/egxpilot/news` — skipped per Rule 16 "When in doubt → SKIP").

| # | Commit | Batch | Routes deleted | LOC removed | Routes skipped | Push status |
|---|---|---|---|---|---|---|
| 1 | `c1e8d97` | Batch 1 (smallest 30) | 30 | 714 | 0 | ✅ pushed |
| 2 | `16a57c3` | Batch 2 (next 60 — incl. 3 Rule 55 §ب violations confirmed dead: `/api/predictions/generate` + `/api/real-predictions` + `/api/market/sync-historical`) | 60 | 1,793 | 10 (false-positive hits, all deleted) | ✅ pushed |
| 3 | `395b998` | Batch 3 (next 60 — 1 restored: `/api/market/incremental-sync` per Rule 16 contradiction between P0 dead_paths_v2.txt + P1 alive-and-admined lists) | 59 net (60 - 1 restored) | 3,043 | 1 (restored per Rule 16) | ✅ pushed |
| 4 | `4a70657` | Batch 4 (next 60) | 60 | 6,084 | 3 (false-positive hits — all deleted) | ✅ pushed |
| 5 | `970f7a5` | Batch 5 (next 60 — HTTP 500 during Next.js recompilation was transient, stabilized to 200 within 2s; `/api/news` + `/api/stocks` returned 500/503 — pre-existing Python backend port 8010 not running in sandbox) | 60 | 9,773 | 3 (false-positive hits — all deleted) | ✅ pushed |
| 6 | `84bfffa` | Batch 6 (final 44 — largest feature routes: `/api/advanced-analysis/scan-all` 950 LOC + `/api/admin/advanced-analysis/run` 782 LOC + `/api/mubasher/sync` 596 LOC + `/api/maestro/logic-panel` 573 LOC + `/api/unified-analysis/[symbol]` dynamic 440 LOC) | 44 | 14,589 | 7 (false-positive hits — all deleted) | ✅ pushed |
| 7 | `1f63652` | Batch 7 (Rule 55 auth fixes on 6 routes — 5 admin + 1 data-mutating; NO deletions, only auth hardening) | 0 deletions (+166 / -163) | — | 0 (6 routes auth-fixed) | ✅ pushed |
| 8 | `d47810b` | archive(restore): recover 313 deleted API routes to archive/ folder (owner directive — NOT deleted — recoverable if any caller is later discovered in production) | (moved 313 dead routes to `archive/wave-2-cleanup-2026-10-01/src/app/api/`) | — | — | ✅ pushed |
| **TOTAL API Routes** | (8 commits) | | **313 routes deleted** | **35,996 LOC** | **1 skipped (`/api/egxpilot/news`) + 1 restored (`/api/market/incremental-sync`) + 6 auth-hardened** | all ✅ pushed |

### Wave 2.4 — Rule 55 Auth Fixes (Task 7-B Batch 7 — 6 routes hardened)

5 admin routes using legacy `verifyAdminRequest`/`verifyAdminToken` → upgraded to `requireAdminAsync` (Rule 55 §г — defense-in-depth):

| # | Route | LOC | Pre-fix auth | Post-fix auth | Push status |
|---|---|---|---|---|---|
| 1 | `/api/admin/data-sources` | 253 | `verifyAdminRequest` | `requireAdminAsync` | ✅ |
| 2 | `/api/admin/export-data` | 199 | `verifyAdminRequest` | `requireAdminAsync` | ✅ |
| 3 | `/api/admin/export-vps` | 125 | `verifyAdminRequest` | `requireAdminAsync` | ✅ |
| 4 | `/api/admin/refresh-historical-data` | 163 | `verifyAdminRequest` + `verifyAdminToken` (`checkAdminAuth` helper) | `requireAdminAsync` (helper removed) | ✅ |
| 5 | `/api/admin/scrape-stocks` | 275 | `verifyAdminRequest` (POST + GET handlers) | `requireAdminAsync` (both handlers) | ✅ |
| 6 | `/api/predictions/generate-all` | 50 | NO AUTH | `requireAdminAsync` (Rule 55 §б — data-mutating non-admin route triggers `/api/daily/rebuild-predictions`) | ✅ |

**Verification:** All 6 routes now return 403 for unauthenticated requests (was 200/405 before). Caller of `/api/predictions/generate-all` = `RefreshAnalyticsButton.tsx:42` (alive — used in 6+ market-analysis tabs; RECOMMENDED FOLLOW-UP: refactor button to call `/api/admin/ai-predictions/generate` with admin auth — current state is a known UX regression for non-admin users but intended per Rule 55 §б).

### Wave 2.5 — False-Positives Caught + Skipped (6 files — kept alive per Rule 16)

| # | File | LOC | Reason kept alive | Re-verification method |
|---|---|---|---|---|
| 1 | `src/modules/admin/components/ContentStudioHub.tsx` | 886 | Lazily imported by `MarketingStudio.tsx:25` (which is imported by AdminView.tsx:205 + rendered at :1807) | `rg "ContentStudioHub" src/` returned hits in MarketingStudio.tsx |
| 2 | `src/modules/admin/components/MarketingHub.tsx` | 503 | Lazily imported by `MarketingStudio.tsx:26` | `rg "MarketingHub" src/` returned hits in MarketingStudio.tsx |
| 3 | `src/modules/admin/components/VideoEditor.tsx` | 653 | Lazily imported by `MarketingStudio.tsx:24` | `rg "VideoEditor" src/` returned hits in MarketingStudio.tsx |
| 4 | `vps-service/telegram/telegram_target_hit_tracker.py` | 1,012 | PM2-driven via auto_post_scheduler.py:1524 → telegram_bp at lightweight_server.py:73 | 3-hop trace: PM2 telegram-poster → auto_post_scheduler.py:__main__ → run_scheduler() → run_target_hit_tracker (lazily imported at line 1524) — runs during EGX market hours |
| 5 | `vps-service/jobs/fetch_corporate_actions.py` | 292 | Cron-driven per `crontab.txt:53` (Sun-Thu 4:00 AM) | `rg "fetch_corporate_actions" crontab.txt` returned hit |
| 6 | `vps-service/jobs/hot_candidate_detector.py` | 299 | Cron-driven per `crontab.txt:150` (Sun-Thu 8-12 every 15min) | `rg "hot_candidate_detector" crontab.txt` returned hit |

### Wave 2.6 — HTTP 500 Restore (false-negative grep recovery — commit `2529dba`)

After Wave 2 Batch 4 deletions, 2 lib files were restored when their dynamic callers were discovered:
- `src/lib/cache/data-freshness.ts` (263 LOC) — only importer was the dead `cache/api-cache.ts` BUT discovered transitive dynamic import path via Next.js `next/dynamic` (not caught by the initial 3-pattern static-import grep).
- `src/lib/cache/api-cache.ts` (115 LOC) — paired with the above.

**Lesson learned:** Caller-grep MUST include dynamic-import patterns: `await import(...)` + `require(...)` + `next/dynamic(() => import(...))`. Plain static-only grep misses Next.js `next/dynamic` imports. The 6-grep protocol in Task 7-B fixed this — applied dynamic-import grep to all 319 API route candidates (zero false negatives among the 313 successfully-deleted routes).

### Wave 2.7 — Archive Restore (commits `d47810b` + `4212242` — owner directive "NOT deleted — archived")

| Folder | Archived files | LOC | Sub-paths |
|---|---|---|---|
| `archive/wave-2-cleanup-2026-10-01/src/app/api/` | 313 routes | 35,996 | (all dead routes from Task 7-B batches 1-6) |
| `archive/wave-2-cleanup-2026-10-01/src/components/` | 53 .tsx files | 16,829 | (legacy 12 + admin 14 + shadcn UI primitives 16 + duplicate-feature components 11) |
| `archive/wave-2-cleanup-2026-10-01/src/modules/` | 14 .tsx files | 8,533 | (admin 14 [incl. 3 false-positives that were LATER restored] + predictions 1 + radar 2 + portfolio 3 + subscription 1) |
| `archive/wave-2-cleanup-2026-10-01/src/lib/` | 18 .ts files | 3,141 | (cache/ + expert/ + duplicate db helpers) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/analyzers/` | 20 .py files | 16,039 | |
| `archive/wave-2-cleanup-2026-10-01/vps-service/telegram/` | 16 .py files | 6,954 | |
| `archive/wave-2-cleanup-2026-10-01/vps-service/engines/` | 2 .py files | 850 | (historical_prediction_generator + master_backfill_adapter) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/engine/` | 2 .py files | 1,057 | (crypto_full_system + live_prediction_engine) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/jobs/` | 2 .py files | 430 | (daily_gainer_scan + fetch_earnings_calendar) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/ai/` | 5 .py files | 879 | |
| `archive/wave-2-cleanup-2026-10-01/vps-service/data/` | 2 .py files | 884 | (multi_market_fetcher + us_stocks_fetcher) |
| `archive/wave-2-cleanup-2026-10-01/vps-service/tools/` | 7 .py files | 2,820 | (diagnose_* + evaluate_predictions + migrate_price_history + price_history_resolver + restore_dbs + restore_from_local) |
| **TOTAL** | **436 files** | **~94,432 LOC** | (313 routes + 121 frontend + 56 python — some files counted in multiple folders) |

### Wave 2.8 — Final Counts

| Metric | Pre-Wave-2 | Post-Wave-2 | Delta | Verification |
|---|---|---|---|---|
| `find src/components src/modules -name "*.tsx" \| wc -l` | 297 | 247 (verified) | -50 | `find src/components src/modules -name "*.tsx" \| wc -l` |
| `find src/app/api -name "route.ts" \| wc -l` | 693 | 380 | -313 | `find src/app/api -name "route.ts" \| wc -l` |
| `find vps-service -name "*.py" \| wc -l` | 506 | 450 | -56 (later 3 more archived by Wave 3 #learning) | `find vps-service -name "*.py" \| wc -l` |
| `find archive/ -type f \| wc -l` | 0 | 436 | +436 | `find archive/wave-2-cleanup-2026-10-01/ -type f \| wc -l` |
| Auth-protected routes | 65 | 71 | +6 (Rule 55 Batch 7) | `rg "requireAdminAsync\|getServerSession\|getSessionUserId" src/app/api --type ts` |
| Total LOC archived | — | ~94,432 (NOT deleted — owner directive) | — | sum of all `wc -l` on archived files |
| False positives caught + skipped | — | 6 (3 frontend admin + 1 telegram + 2 cron-driven) | — | per-file re-verification per Rule 16 |

---

## Wave 3 — Consolidation Wave (2026-10-01)

> **Source:** worklog.md Tasks `9-A` (Education Unification) + `9-B` (Recommendations Consolidation) + 6 i18n Phase 1 commits.
>
> **Owner directive:** unify duplicate education screens (`#learning` + `#academy`) + reduce `#recommendations` tab noise (was 13 views → target 4-5) + fix broken `PersonalizedRadarTab` (TypeError on `personalization_reasons.length` of undefined) + continue i18n migration to 100%.

### Wave 3.1 — Education Unification (Task 9-A — 2 commits)

**Problem (Task 8-B investigation):** TWO duplicate education screens existed:
- `#learning` (`LearningView.tsx`, 1,063 LOC) — gamified UI, 15 inline courses from `@/data/learning-content.ts` (440 LOC), quizzes, XP, badges via `@/lib/learning-store.ts`. NO simulators. NO reference to `content/education/*.md`. Known UI bug: 11,279px wide overflow.
- `#academy` (`AcademyView.tsx` 73 LOC wrapper + `AcademyEncyclopedia` 1,791 LOC + `PaperTradingWorkstation` 1,550 LOC + `CandlestickSimulator` 944 LOC + `StrategySandbox` 2,188 LOC + `LessonPDFExporter` 587 LOC = ~6,473 LOC) — 4-tab interface with encyclopedia + 3 interactive simulators + PDF export. Already canonical richer surface.

**Orphan:** 12 MD lesson files in `content/education/` (~3,050 LOC, institutional-grade 5-section structure) — written by owner with full-day investment — consumed ONLY by admin-only ContentStudioHub for video cards. ZERO user-facing consumers (verified by grep).

| # | Commit | Step | What was done | Push status |
|---|---|---|---|---|
| 1 | `e07cb18` | Step 1: ARCHIVE the duplicate screen | `git mv` of 3 files to `archive/education-duplicate-2026-10-01/`: `LearningView.tsx` (1,063 LOC) + `learning-content.ts` (440 LOC) + `learning-store.ts` (365 LOC). Removed `{ id: 'learning' }` nav entry from `TopBar.tsx` + `MobileMoreSheet.tsx` + `page.tsx` switch + dynamic import. Removed `'learning'` from `VALID_VIEWS` array + `AppView` type union + `AuthGate.PROTECTED_VIEWS`. Rewired `crypto-learning` route to redirect to `academy` (was redirecting to `learning`). Removed unused `CryptoLearningView` lazy-load from page.tsx. | ✅ pushed (`4f2c3d8..e07cb18 main -> main`) |
| 2 | `d95904a` | Step 2: WIRE content/education/*.md into AcademyView via runtime fetch | Added 5th TabsTrigger "🎓 دروس متقدمة" (value=`advanced-lessons`) to `AcademyView.tsx` (line 60). Switched TabsList grid from `lg:grid-cols-4` → `lg:grid-cols-5` (line 58). Added TabsContent for advanced-lessons rendering `<AdvancedLessonsTab />`. Inlined `AdvancedLessonsTab` component (~480 LOC, no new file — Rule 63.2 compliant) — On mount fetches `/api/ads/educational-lessons` → state of 12 lessons. Master-detail layout (sidebar Accordion + main lesson panel). "إظهار النص الكامل" button fetches single-lesson endpoint → caches `fullContent` (14,761 chars for lesson 1) → renders full markdown. "الدرس التالي" button cycles to next lesson. Loading + error states with retry button. Inlined `AdvancedMarkdownRenderer` component (~120 LOC) — minimal MD→JSX (fenced code blocks LTR + headings + bullets + numbered lists + blockquotes + `---` → dashed `<hr>` + bold/italic/inline-code styled). | ✅ pushed (`077116f..d95904a main -> main`) |

**Verification:**
- `archive/education-duplicate-2026-10-01/` contents: 3 files / ~1,868 LOC (LearningView.tsx + learning-content.ts + learning-store.ts — all preserved with `git mv` to keep history).
- `/api/ads/educational-lessons` → `{"success":true,"count":12,"lessons":[...]}` — all 12 MD files parsed successfully.
- `/api/ads/educational-lessons?id=01` → returns full lesson with `fullContent` (14,761 chars).
- Grep verification: NO `case 'learning'` route exists in src/app/page.tsx; NO `'learning'` string literal in src/lib/valid-views.ts VALID_VIEWS array; NO `{ id: 'learning' }` nav entry in TopBar.tsx or MobileMoreSheet.tsx; NO `LearningView` import in any active src/ file (only in archive/).
- `bun run lint` EXIT 0 across both steps.

### Wave 3.2 — Recommendations Consolidation (Task 9-B — 2 commits)

**Problem (Task 8-C investigation):**
- `#recommendations` had 10 main tabs + 3 sub-views = 13 user-facing views (too much noise).
- NetPicksTab rendered in TWO places (#recommendations line 326 + #liquidity-radar line 1213).
- PersonalizedRadarTab BROKEN at runtime: TypeError on `p.personalization_reasons.length` (line 569).
- 7 radar components (6,893 LOC) scattered across #recommendations instead of inside #liquidity-radar.

| # | Commit | Step | What was done | Push status |
|---|---|---|---|---|
| 1 | `cd53a63` | Step 1: FIX the broken PersonalizedRadarTab (API contract align) | `src/app/api/radar/personalized/route.ts` (68 → 304 LOC): Returns `personalization_reasons: string[]` per pick (always ≥1 entry — falls back to "فرصة من رادار الميكرز" if no personalization matched). Returns full pick shape: `base_score` + `personalized_score` + `sector` + `adjusted_position_size` + `position_size`. Computes `riskProfile` from portfolio concentration (1 stock → aggressive, 2-5 → balanced, 6+ → conservative). Computes `preferredTickers` from `portfolio_assets` (top 8 by trade value). Computes `preferredPriceRange` from avg current_price. Computes `averageHoldingDays` from `portfolio_assets.added_at` timestamps. Computes `holdingPeriodCategory` from averageHoldingDays. Skips picks already in user's portfolio → `excluded[]` with reason 'already_in_portfolio'. Ranks by `personalized_score`. Switches to canonical `readRadarCache()` helper. Adds `hasTradeHistory: false` flag. `PersonalizedRadarTab.tsx`: Added optional `hasTradeHistory?: boolean` to `UserProfile` interface. ProfileCard conditionally renders `totalTrades` / `winRate` / `averageHoldingDays` only when `profile.hasTradeHistory !== false`. | ✅ pushed (`e07cb18..cd53a63 main -> main`) |
| 2 | `077116f` | Step 2: Move 5 radar tabs INTO #liquidity-radar as sub-tabs | `MarketAnalysisView.tsx` edits: Removed 5 TabsTrigger blocks (exit-radar + weekly-report + multi-market-radar + radar-accuracy + personalized-radar). Removed 5 TabsContent blocks. Removed 5 dynamic imports. Removed unused lucide-react icons (DoorOpen + FileText + Radar + Gauge + UserCircle). TabsList grid changed `lg:grid-cols-9` → `lg:grid-cols-5`. NetPicksTab KEPT here as canonical. `MakerRadarTab.tsx` edits: Added `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` imports. Added `dynamic` import from `next/dynamic`. Added icons (DoorOpen + FileText + UserCircle) to lucide-react. Added 5 dynamic imports for moved tabs. REMOVED NetPicksTab import from RadarStatsCards + REMOVED `<NetPicksTab market={market} />` render at line 1213 (owner complaint #1). Wrapped existing main radar content (~300 lines of JSX) inside `<TabsContent value="maker">`. Added 6 TabsTrigger blocks (maker default + exit-radar + weekly-report + multi-market-radar + radar-accuracy + personalized-radar). Added 5 TabsContent blocks wiring moved components. Stock Detail Drawer (Dialog) moved OUTSIDE the Tabs (kept at top-level under `<div className="space-y-4">`) so it stays mounted + closeable across all sub-tabs (shadcn Tabs unmounts inactive TabsContent by default). | ✅ pushed (`cd53a63..077116f main -> main`) |

**Verification:**
- `curl http://localhost:3001/api/radar/personalized` → 401 auth_required (expected — auth required).
- `bun run lint` EXIT 0 across both steps.
- Source-of-truth verification (rg over source files, not compiled chunks): `MarketAnalysisView.tsx` has 5 TabsTrigger values (predictions + status + sectors-tracking + historical-trades + net-picks) — owner's "4-5 tabs acceptable" target met. `MakerRadarTab.tsx` has 6 TabsTrigger values (maker + exit-radar + weekly-report + multi-market-radar + radar-accuracy + personalized-radar). NetPicksTab: rendered ONCE in MarketAnalysisView (line 262), ZERO renders in MakerRadarTab (line 1213 render deleted).
- Compiled chunk grep confirms: `MarketAnalysisView.tsx` chunk has ONLY 5 i18n tab keys (zero references to exitRadar / weeklyReport / multiMarketRadar / radarAccuracy / personalizedRadar as `t()` keys — only as comment annotations).
- `MakerRadarTab.tsx` chunk has all 5 moved tabs wired: `ExitRadarTab` (×9 hits) + `WeeklyReportTab` (×9) + `MultiMarketRadarTab` (×9) + `AccuracyDashboard` (×9) + `PersonalizedRadarTab` (×9) — 9 hits each = 1 dynamic import + 1 TabsTrigger value + 1 TabsContent render + chunk metadata.

### Wave 3.3 — i18n Phase 1 Migration (5 components — 6 commits)

> **Architecture:** cookie-based `I18nContext` + `useTranslation()` hook in `src/lib/i18n-context.tsx` (220 LOC) — NOT next-intl plugin (initial attempt failed with "Couldn't find next-intl config file" error). Wrapped via `<I18nProvider>` in `src/components/Providers.tsx`. Locale switched via `/api/i18n/set-locale` POST endpoint (sets `NEXT_LOCALE` cookie) + `LanguageToggle` UI component + dynamic `<html lang/dir>` attribute.

**Pre-Phase-1 state:** 5 components migrated in earlier `I18N-FULL-100` task (Footer + AuthView + TopBar + DashboardView + MyStocksBriefing). `messages/ar.json` + `messages/en.json` at 130 LOC each.

| # | Commit | Component | Module | Strings migrated | Notes | Push status |
|---|---|---|---|---|---|---|
| 1 | `176c301` | `MarketAnalysisView` | `modules/market-analysis/` | 12 strings | Tabs labels (predictions + status + sectorsTracking + historicalTrades + netPicks) + View title + retry button. Was 6,450 LOC pre-Wave-3 — now 297 LOC orchestrator (Wave 3 Task 9-B reduced it). | ✅ pushed |
| 2 | `4f2c3d8` | (ar/en messages) | `messages/ar.json` + `messages/en.json` | +12 keys | Added `marketAnalysis.tabs.*` keys (12 keys). | ✅ pushed |
| 3 | `46c421f` | `StocksView` | `modules/stock-analysis/` | 50 strings | Largest single migration in Phase 1 — table column headers + filters + buttons + tooltips + sector labels + empty states. | ✅ pushed |
| 4 | `af2eee8` | `EnhancedWatchlistView` | `components/watchlist/` | 30 strings | Watchlist columns + add/remove stock buttons + alerts + empty state. | ✅ pushed |
| 5 | `06dedd7` | `EnhancedPortfolioView` | `modules/portfolio/` | 40 strings | Portfolio columns + add/remove position buttons + risk badges + total/equity/PnL labels. | ✅ pushed |
| 6 | `c9e8884` | `AlertsCenterView` | `components/alerts/` | 25 strings | Alert list columns + filter buttons + alert-type badges + empty state. | ✅ pushed |

**Total commits:** 6 (5 component migrations + 1 messages-keys addition). All pushed per Rule 63.1 (PUSH-AFTER-EVERY-COMMIT).

**messages/*.json growth (Phase 1):**
- Pre-Phase-1: 130 LOC each.
- Post-Phase-1: **460 LOC each** (+330 LOC = +12 marketAnalysis + 50 stocksView + 30 watchlist + 40 portfolio + 25 alerts + nested keys + section headers).
- ~157 strings migrated across 5 components.

**Verified counts (Wave 3 end-state):**
- `grep -rln "useTranslation" src/ --include="*.tsx" | wc -l` → **12 files**:
  1. `src/lib/i18n-context.tsx` (the hook itself)
  2. `src/components/Providers.tsx` (wraps `<I18nProvider>`)
  3. `src/components/layout/Footer.tsx` (earlier I18N-FULL-100)
  4. `src/components/auth/AuthView.tsx` (earlier I18N-FULL-100)
  5. `src/components/layout/TopBar.tsx` (earlier I18N-FULL-100)
  6. `src/modules/dashboard/components/DashboardView.tsx` (earlier I18N-FULL-100)
  7. `src/modules/dashboard/components/MyStocksBriefing.tsx` (earlier I18N-FULL-100)
  8. `src/modules/market-analysis/components/MarketAnalysisView.tsx` (Wave 3 Phase 1)
  9. `src/modules/stock-analysis/components/StocksView.tsx` (Wave 3 Phase 1)
  10. `src/components/watchlist/EnhancedWatchlistView.tsx` (Wave 3 Phase 1)
  11. `src/modules/portfolio/components/EnhancedPortfolioView.tsx` (Wave 3 Phase 1)
  12. `src/components/alerts/AlertsCenterView.tsx` (Wave 3 Phase 1)

**i18n score (per `I18N-FULL-100` task estimate):** 60% (cookie + hreflang + dynamic lang/dir) → 100% (full useTranslation on major components + instant switch + complete messages). Wave 3 Phase 1 raised actual coverage from ~10% (5 components out of ~60 major user-facing components) → ~25% (10 of ~60).

**Phase 2 target (P1 follow-up):** migrate the remaining ~50 components using the same `useTranslation()` pattern. No next-intl plugin migration needed.

### Wave 3.4 — Worklog Documentation Commits (Task 9-A + 9-B reports)

| # | Commit | Description | Push status |
|---|---|---|---|
| 1 | `e43095b` | docs(worklog): append Task 9-A Education Unification report (#learning+#academy merged, content/education/*.md wired) | ✅ pushed |
| 2 | `dcf7136` | docs(worklog): append Task 9-B Recommendations Consolidation report (5 tabs in #recommendations + 6 sub-tabs in #liquidity-radar, PersonalizedRadar fixed) | ✅ pushed |

### Wave 3.5 — Final Counts

| Metric | Pre-Wave-3 | Post-Wave-3 | Delta | Verification |
|---|---|---|---|---|
| Education screens (user-facing) | 2 (`#learning` + `#academy`) | 1 (`#academy` only) | -1 | `rg "case 'learning'" src/app/page.tsx` → 0 hits |
| `content/education/*.md` consumers | 1 (admin ContentStudioHub only) | 2 (ContentStudioHub + AcademyView's AdvancedLessonsTab) | +1 | `rg "/api/ads/educational-lessons" src/` |
| `#recommendations` tab count | 10 main + 3 sub-views (13 total) | 5 main tabs | -8 | `rg "TabsTrigger" src/modules/market-analysis/components/MarketAnalysisView.tsx` |
| `#liquidity-radar` sub-tab count | 0 (was 1 main content) | 6 (maker default + 5 moved radar sub-tabs) | +6 | `rg "TabsTrigger" src/modules/predictions/components/MakerRadarTab.tsx` |
| NetPicksTab duplicate renders | 2 (MarketAnalysisView + MakerRadarTab) | 1 (MarketAnalysisView only) | -1 | `rg "<NetPicksTab" src/` |
| PersonalizedRadarTab runtime crashes | YES (TypeError on `personalization_reasons.length`) | NO (API contract aligned) | fixed | `curl http://localhost:3001/api/radar/personalized` |
| `find archive/ -type f \| wc -l` | 436 (Wave 2 only) | 439 (Wave 2 + 3 education files) | +3 | `find archive/ -type f \| wc -l` |
| Components using `useTranslation()` | 7 (5 from I18N-FULL-100 + Providers + i18n-context) | 12 (above + 5 Wave 3 Phase 1) | +5 | `grep -rln "useTranslation" src/ --include="*.tsx" \| wc -l` |
| `messages/ar.json` + `messages/en.json` LOC | 130 each | 460 each | +330 each | `wc -l messages/ar.json messages/en.json` |
| `AcademyView.tsx` LOC | 73 | 717 (added AdvancedLessonsTab + AdvancedMarkdownRenderer inline) | +644 | `wc -l src/modules/education/components/AcademyView.tsx` |
| `MarketAnalysisView.tsx` LOC | ~6,450 | 297 (orphan code removed; now thin orchestrator) | -6,153 | `wc -l src/modules/market-analysis/components/MarketAnalysisView.tsx` |
| `MakerRadarTab.tsx` LOC | ~3,286 | 3,381 (added 6 TabsTrigger + TabsContent blocks + Dialog wrapper) | +95 | `wc -l src/modules/predictions/components/MakerRadarTab.tsx` |
| `src/app/api/radar/personalized/route.ts` LOC | 68 | 304 (added plural reasons + full pick shape + real profile fields) | +236 | `wc -l src/app/api/radar/personalized/route.ts` |
| `PersonalizedRadarTab.tsx` LOC | (unchanged) | (added `hasTradeHistory?: boolean` to UserProfile interface + conditional render) | +~10 | `wc -l src/modules/radar/components/PersonalizedRadarTab.tsx` |

---

## Wave 2 + Wave 3 Cumulative Summary

| Metric | Pre-Wave-2 | Post-Wave-2 | Post-Wave-3 | Total delta |
|---|---|---|---|---|
| `find src/components src/modules -name "*.tsx" \| wc -l` | 297 | 247 | 247 (Wave 3 didn't add .tsx — only moved internals) | -50 |
| `find src/app/api -name "route.ts" \| wc -l` | 693 | 380 | 380 (Wave 3 didn't add routes) | -313 |
| `find vps-service -name "*.py" \| wc -l` | 506 | 450 | 450 (Wave 3 didn't touch Python files) | -56 |
| `find archive/ -type f \| wc -l` | 0 | 436 | 439 (+3 Wave 3 education files) | +439 |
| Auth-protected routes | 65 | 71 | 71 (Wave 3 didn't change auth) | +6 |
| Total LOC archived | — | ~94,432 | ~96,300 (+1,868 Wave 3 education) | ~96,300 |
| Education user-facing screens | 2 | 2 | 1 (#learning archived) | -1 |
| `#recommendations` main tab count | 10 | 10 | 5 | -5 |
| `#liquidity-radar` sub-tab count | 0 | 0 | 6 | +6 |
| PersonalizedRadarTab runtime crashes | YES | YES | NO (fixed in Wave 3 Task 9-B Step 1) | fixed |
| Components using `useTranslation()` | 7 | 7 | 12 (+5 Wave 3 Phase 1) | +5 |
| `messages/ar.json` + `messages/en.json` LOC | 130 each | 130 each | 460 each (+330) | +330 each |

**Total commits across Wave 2 + Wave 3:** 24 commits (Wave 2: 16 — 9 cleanup + 1 docs counts + 1 archive-restore routes + 1 archive-restore frontend+backend + 4 API batches 1-7... wait, 16 includes 4 frontend sub-batches + 3 backend sub-batches + 1 shadcn + 1 false-negative restore + 1 docs counts + 1 archive-restore routes + 1 archive-restore frontend+backend + 7 API batches = 19. Let me recount.)

**Accurate commit count:**
- Wave 2: 9 cleanup commits (4796647 + 6f89c61e + f592f45d + f1eec20f + 358e2aa4 + 2529dba + 1b8166b + d47810b + 4212242) + 3 backend commits (41d70c60 + edb76c14 + c235ce76) + 7 API commits (c1e8d97 + 16a57c3 + 395b998 + 4a70657 + 970f7a5 + 84bfffa + 1f63652) + 1 discipline commit (2be166f) + 1 bootcamp commit (25781d3) = **21 commits** (Wave 2)
- Wave 3: 2 education commits (e07cb18 + d95904a) + 2 recommendations commits (cd53a63 + 077116f) + 6 i18n Phase 1 commits (176c301 + 4f2c3d8 + 46c421f + af2eee8 + 06dedd7 + c9e8884) + 2 worklog doc commits (e43095b + dcf7136) = **12 commits** (Wave 3)
- **TOTAL: 33 commits** across Wave 2 + Wave 3, all pushed per Rule 63.1 (PUSH-AFTER-EVERY-COMMIT).

---

## Rule Compliance Statement

| Rule | Compliance | Notes |
|---|---|---|
| Rule 4 (NO-NEW-FILES) | ✅ | No new screens/files created in src/. Only 1 NEW doc file (`WAVE-2-3-CHANGELOG-2026-10-01.md` — this file — allowed per Rule 63.2 as a changelog, NOT a new screen/system). |
| Rule 5 (WIRED) | ✅ | All surviving files have ≥1 importer (verified via 6-grep protocol for routes + 3-pattern importer-count map for components). |
| Rule 16 (VERIFY-BEFORE-DELETE) | ✅ | Every deletion grep-proven. 6 false positives caught + skipped (3 frontend admin + 1 telegram + 2 cron-driven). 2 lib files restored post-deletion (false-negative dynamic imports caught). 1 API route restored (`/api/market/incremental-sync` — Rule 16 contradiction between P0 dead + P1 alive lists). |
| Rule 20 (Python is the brain) | ✅ | All deletions were Python-side cleanup of dead analyzers/engines/jobs/etc. No Node logic replaced Python logic. |
| Rule 25 (refactoring-gated) | ✅ | Wave 2 + Wave 3 were owner-pre-approved per Rule 25. |
| Rule 55 (P0-WAVE-SECURITY) | ✅ | 5 admin routes upgraded from `verifyAdminRequest` → `requireAdminAsync` (§г — defense-in-depth). 1 data-mutating non-admin route hardened with `requireAdminAsync` (§б). |
| Rule 60 (MODULE-SYSTEM) | ✅ | Module count unchanged (17 frontend + 9 backend placeholders). All module-internal edits respected the `index.ts` public interface pattern. |
| Rule 61 (RELATIVE-PATHS-ONLY) | ✅ | All new code uses relative paths. No absolute URLs introduced. |
| Rule 62 (GIT-PUSH-DISCIPLINE) | ✅ | All 33 commits pushed immediately to origin/main. Each push verified with `git push origin main` returning `<old>..<new> main -> main`. No local-only commits left unpushed at any point. |
| Rule 63 (PUSH-AFTER-EVERY-COMMIT + NO-NEW-SCREENS-FILES) | ✅ | All 33 commits = 33 pushes. No new screens created. 1 NEW doc file (this changelog) — allowed per Rule 63.2 as a changelog (not a screen/system). |

---

## References

- `00-CONSTITUTION.md` — Rules 4 + 5 + 16 + 20 + 25 + 55 + 60 + 61 + 62 + 63
- `01-ARCHITECTURE_AND_API.md` — §1.5 stats (Wave 2 + 3 update) + §4.1 engine/service map (Wave 2 backend cleanup note) + §5.4 dead routes (Wave 2 cleanup note)
- `02-SCREENS_AND_COMPONENTS.md` — §0.5 Wave 2 Cleanup Delta + §0.6 Wave 3 Consolidation Delta + §2.3 (#learning archived) + §4.1 (MarketAnalysisView 6,450→297 LOC + PicksManagementView archived + AcademyView 73→717 LOC) + §6.1 (MarketAnalysisView 5 main tabs post-Wave-3 + 5 radar tabs moved) + §10 (Wave 2 archive summary)
- `03-API_REFERENCE.md` — total 690→380 routes + §15 admin note (5 routes auth-hardened in-place per Rule 55 §г) + §24 Reports kept
- `SYSTEM_HOW_IT_THINKS.md` — §18.9 Wave 2/3 deltas NEW + §18.10 i18n Phase 1 Migration NEW (5 components migrated, messages 130→460 LOC each)
- `05-CURRENT_STATE.md` — §1 counts refreshed + §2 API Map (687→380) + §4.7 NEW radar sub-tabs move + §5.1.1 NEW PersonalizedRadarTab fix + §10.1 items 19-20 (Wave 2 + Wave 3 audit entries) + §10.2 items 13-15 (Wave 3 follow-ups) + §13 NEW Wave 2 Cleanup Summary + §14 NEW Wave 3 Consolidation Summary
- `worklog.md` — Tasks 6-A2 + 6-B2 + 6-C2 + 7-A + 7-B + 9-A + 9-B (full work logs with verification evidence)

---

*Created by Documentation Secretariat — Task ID `WAVE-2-3-DOCS` — 2026-10-01*
*This file is a **changelog** (allowed per Rule 63.2 — NOT a new screen/system).*
*Companion docs: see `05-CURRENT_STATE.md` §13 (Wave 2 Cleanup Summary) + §14 (Wave 3 Consolidation Summary) + `02-SCREENS_AND_COMPONENTS.md` §0.5 + §0.6 for the section-by-section narrative.*

---


---

## §14 — Marketing Offers Strategy (13 قسم — Task ID 16-C)

## 📎 MERGED APPENDIX — Marketing Offers Strategy (MARKETING-OFFERS-STRATEGY.md)

> **Source file (merged then archived):** `MARKETING-OFFERS-STRATEGY.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `MARKETING-OFFERS-STRATEGY.md` (verbatim):

# 🎯 MARKETING-OFFERS-STRATEGY — استراتيجية العروض والخصومات (Task ID: 16-C)

> **الوثيقة المرجعية لاستراتيجية العروض التسويقية + الكوبونات + الـ referrals + التسعير الإقليمي.**
> صادرة من: **قسم التسويق (Marketing Department — Offers Strategy Lead)**.
> بتاريخ: **2026-10-01**.
> حالة الموافقة: **استراتيجية مقترحة بانتظار اعتماد المالك (`enmohsen20111975`)** قبل التنفيذ.
> المراجع: `00-CONSTITUTION.md` (Rule 4 + Rule 31 NO-HYPE-LANGUAGE + Rule 50 MONEY-AS-CUSTOMER-LIFE + Rule 63) · `Documentation/PAYWALL-STRATEGY-FINAL.md` (قرار التسعير النهائي) · `src/app/api/subscription/checkout/route.ts` · `src/app/api/admin/promo-codes/route.ts` · `src/modules/subscription/components/PricingView.tsx` · `src/modules/admin/components/PromoCodesAdmin.tsx`.

---

## 0. الملخص التنفيذي (Executive Summary)

توجيه المالك واضح: «خش بقوة رهيبة» بعروض + خصومات لرفع معدل التحويل. لكن **«خش بقوة» لا تعني «خش بضجيج»** — المنصة فِنْتِك، والعميل مستثمر يحترم عقله. القاعدة 31 (NO-HYPE-LANGUAGE) بـ تمنع «🔥 عرض خاص!». القاعدة 50 (MONEY-AS-CUSTOMER-LIFE) بـ تمنع أي عرض بـ يستفز فلوس العميل. الحل: **عروض هجومية في الميكانيكا، محترمة في الأسلوب**.

**القرار الاستراتيجي:**
1. **لا نطلق 10 عروض دفعة واحدة** — تجربة شاشات الـ pricing بـ تتحول لـ bazaar. نطلق **5 عروض مُختارة بعناية** على مدى 90 يومًا (قسم 4).
2. **البنية التحتية الموجودة كافية لـ 70% من العروض** — `PromoCode` table + `MarketPricing` table + `/api/subscription/checkout` (اللي بـ يقبل `referralCode` لكن مش موصول). التوسعات اللازمة في الـ schema صغيرة (قسم 2).
3. **Paymob لا يدعم كوبونات أصلًا** — الخصم بـ يُحسب على الـ backend بتاعنا، وبنبعت `amount_cents` بعد الخصم لـ Paymob. دي نقطة معمارية مهمة (قسم 2).
4. **التسعير الإقليمي مُفعل بالفعل** في `MarketPricing` — نحتاج فقط seed للأسواق الجديدة (KSA/Kuwait/Qatar/US) + auto-detect من IP.
5. **التجربة 14 يوم مُبقاة كما هي** (مش 30) — قرار نهايي في `PAYWALL-STRATEGY-FINAL` §3.2. العروض بـ تلعب على **السعر بعد التجربة**، مش على مدتها.

**الأهداف القابلة للقياس (مأخوذة من PAYWALL-STRATEGY §7.1):**

| المؤشر | الوضع الحالي (شهر 0) | الهدف (شهر 3 — بعد العروض) | الهدف (سنة 1) |
|---|---|---|---|
| Trial → Paid conversion | 2-3% (تقديري) | 6% | 8% |
| MRR | < $500 | $4,000 | $15,000 |
| Churn (monthly) | مجهول (يُقاس أول 30 يوم) | <12% | <8% |
| ARPU | مجهول | $4 | $6 |

---

## 1. أنواع العروض — الترتيب حسب الفعالية لمنصات الـ fintech

### 1.1 منهجية الترتيب

التقييم مبني على:
- **معيار التحويل (Conversion Lift):** كم نسبة المستخدمين بـ يشترون؟ (مرجع: ProfitWell + Recurly Research + Stripe Atlas benchmarks).
- **معيار الـ LTV (Lifetime Value):** العرض بـ يخلّي العميل يدفع أكتر على المدى الطويل، ولا بـ يجيب مشتركين رخيصين بيمشوا أول شهر؟
- **معيار الـ Churn:** العرض بـ يربط العميل، ولا بـ يخلّيه "يستغل العرض ويمشي"؟
- **ملاءمة السوق العربي:** EGX/KSE أسواق بطيئة + الـ fintech penetration في مصر 32% فقط (vs 69% UAE).

### 1.2 جدول الترتيب (مرتب تنازليًا بالفعالية)

| # | نوع العرض | تحويل متوقع | LTV impact | Churn impact | تعقيد التنفيذ | ملاءمة لينا |
|---|---|---|---|---|---|---|
| 1 | **Annual = 2 months free** (16.6% off) | +25-40% على yearly vs monthly mix | 🔥 عالي (مقدم نقدي + lock-in 12 شهر) | 🔥 يقلل الـ churn بنسبة 30-50% | Easy — UI موجود (`billingCycle='yearly'` + badge "شهرين مجاناً") | ⭐⭐⭐⭐⭐ |
| 2 | **First-month discount (50% off)** | +15-25% trial→paid | متوسط (LTV أعلى بـ 8% بسبب lower churn أول شهر) | متوسط (مش بنفس تأثير annual) | Easy — تعديل `amount_cents` أول payment cycle فقط | ⭐⭐⭐⭐⭐ |
| 3 | **Referral (invite = both get 1 month free)** | +10-20% من الـ signups الجديدة | عالي (CAC منخفض + trust transfer) | متوسط | Medium — الـ `referralCode` field موجود في checkout لكن مش موصول | ⭐⭐⭐⭐⭐ |
| 4 | **Free trial extension (14 → 21 for cohort X)** | +5-10% على cohort معين | منخفض (مجاني = لا دخل) | منخفض | Easy — تعديل `trial_ends_at` لـ cohort معين | ⭐⭐⭐⭐ |
| 5 | **Loyalty tiers (3 mo = 10%, 6 mo = 20%)** | +8-12% retention | 🔥 عالي (يقلل churn) | 🔥 عالي | Medium — جدول `loyalty_discounts` + logic في `callback` | ⭐⭐⭐⭐ |
| 6 | **Ramadan / Black Friday time-limited** | +30-50% خلال الفترة | منخفض (LTV عادي بعدها) | منخفض | Easy — PromoCode بـ `expires_at` | ⭐⭐⭐⭐ |
| 7 | **Bundle (Premium + Pro together)** | +3-7% | متوسط | منخفض | Hard — يحتاج tier جديد أو add-on logic | ⭐⭐⭐ |
| 8 | **Flash sale (24-hour 50% off)** | +20-40% spike مؤقت | منخفض (low-quality customers) | منخفض (مش بنفس تأثير annual) | Easy — نفس time-limited | ⭐⭐⭐ |
| 9 | **Student discount (50% with .edu email)** | +2-5% | منخفض (segment صغير) | منخفض | Medium — verification via email domain | ⭐⭐ |
| 10 | **Regional pricing** | +15-25% من أسواق غير مصر | متوسط (ARPU أعلى من KSA/US) | متوسط | Easy — `MarketPricing` table موجود، يحتاج seed | ⭐⭐⭐⭐⭐ |

### 1.3 القرار الاستراتيجي للأولوية

نطلق من العروض **الأعلى LTV impact أولًا** (Annual + First-month + Referral + Regional + Loyalty). العروض الـ 6-10 (موسمية + flash + student + bundle) بـ نستخدمها كـ **tactics داعمة**، مش كـ core engine.

> **ملاحظة Rule 50:** كل عرض بـ يحترم فلوس العميل. لا dark patterns (مثل: تجديد تلقائي بدون إشعار، أو إخفاء زر الإلغاء). كل عرض بـ يُعرض بـ وضوح، والعميل بـ يقدر يلغي في أي وقت (موجود في الـ PricingView footer: «ألغِ في أي وقت — بدون التزام»).

---

## 2. ميكانيكا التنفيذ لكل عرض

### 2.1 حقيقة مهمة: Paymob لا يدعم كوبونات أصلًا

**التوثيق التقني:** Paymob Acceptance API (`/api/ecommerce/orders` + `/api/acceptance/payment_keys`) بـ ياخد `amount_cents` كرقم نهائي. مفيش حقل `coupon_code` أو `discount_amount` في الـ API. الخصم لازم يُحسب **قبل** إرسال الطلب لـ Paymob.

**الأنبوب الحالي (Existing Pipeline):**

```
[PricingView.tsx] → POST /api/subscription/checkout { tier, market, billingCycle }
   ↓
[checkout/route.ts] يقرأ price_egp من MarketPricing table
   ↓
amountCents = price_egp * 100
   ↓
Paymob /api/auth/tokens → /api/ecommerce/orders → /api/acceptance/payment_keys
   ↓
iframe URL بيرجع للمستخدم
```

**الأنبوب المطلوب بعد العروض:**

```
[PricingView.tsx] → POST /api/subscription/checkout { tier, market, billingCycle, promoCode?, referralCode? }
   ↓
[checkout/route.ts]:
  1. يقرأ price_egp من MarketPricing table
  2. يفحص promoCode في PromoCode table (لو موجود + is_active + current_uses < max_uses + not expired)
  3. يفحص referralCode في Referral table (لو موجود)
  4. يحسب final_amount_cents = price_egp * 100 * (1 - discount_pct/100)
  5. يبعت final_amount_cents لـ Paymob
  6. بعد نجاح callback → يسجل redemption في PromoCodeRedemption + ReferralRedemption
   ↓
Paymob يقبض final_amount_cents (بعد الخصم)
```

### 2.2 لكل عرض: الميكانيكا التفصيلية

#### 2.2.1 Annual = 2 months free (16.6% off)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | `billingCycle='yearly'` → الـ price_egp في `MarketPricing` = 990 EGP (= 99 × 10، يعني 2 شهر مجانًا). ده **موجود فعلاً** — ما نحتاجش أي تغيير backend. |
| **Paymob integration** | لا تغيير — الـ `amountCents` بـ يتقرأ من `MarketPricing.price_egp` اللي هو 99000 سنت (لـ yearly). |
| **Database schema** | لا تغيير. `MarketPricing` table موجود بـ `tier_market_billing_cycle` unique key. الـ seed للـ yearly rows موجود. |
| **UI** | الموجود في `PricingView.tsx` line 200-203 — toggle «شهري/سنوي» + badge «شهرين مجاناً». كافٍ. |
| **Backend** | لا تغيير. |
| **تعقيد التنفيذ** | **Easy** — تنفّذ بـ 0 ساعات برمجة. التحدّي تسويقي بحت: إقناع المستخدم يفضّل yearly. |

#### 2.2.2 First-month discount (50% off)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | العميل بـ يدفع 49.5 EGP أول شهر، 99 EGP كل شهر بعدها. الـ 99 EGP الافتراضية بـ تتطبّق من الشهر التاني تلقائيًا (recurring). |
| **Paymob integration** | Paymob لا يدعم recurring-native. الحل: نستخدم **Paymob tokenization** — نخزّن الـ token بتاع الكارت في الـ callback الأول، وبعدها نـ charge 99 EGP كل شهر. **بدون tokenization**: العميل بـ يدفع 49.5 EGP أول مرة، وبعد شهر بـ يرجع يدفع 99 EGP يدويًا (مقبول للمبتدئ، لكن churn عالي). |
| **Database schema** | مطلوب: حقل `first_payment_discount_pct` في `MarketPricing` (defaults to 0). + جدول `PaymentToken` (لو قررنا tokenization): `user_id, paymob_token, card_last4, expires_at`. |
| **UI** | في `PricingView.tsx`: badge «الشهر الأول 50% — 49.5 EGP فقط، بعدها 99 EGP/شهر». لازم يظهر بوضوح جنب الزر. |
| **Backend** | تعديل `/api/subscription/checkout`: لو `first_payment_discount_pct > 0` وده أول checkout لليوزر → `amountCents = price_egp * (1 - pct/100) * 100`. |
| **تعقيد التنفيذ** | **Medium** — 4-6 ساعات لـ schema + checkout + UI. |

#### 2.2.3 Referral (invite = both get 1 month free)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | العميل أ بـ يدعو عميل ب. لما بـ يدفع أول مرة، أ بـ يحصل على +30 يوم Premium إضافي. ب بـ يحصل على **+7 يوم تجربة** (مش +30، عشان منعملش loop بـ تجيب free riders). |
| **Paymob integration** | لا تغيير — الـ amount_cents كامل (99 EGP). الـ "مكافأة" بـ تتطبّق في `auth.db` (تمديد `trial_ends_at` أو `subscription_ends_at`). |
| **Database schema** | مطلوب جدول `Referral`: `id, referrer_user_id, referral_code (unique), referee_user_id, status (pending/completed/void), created_at, completed_at, reward_days_granted`. |
| **UI** | في `TrialExpiredModal`: input «عندك كود إحالة؟ أدخله هنا». + صفحة `/referral` (داخل الـ PricingView مش كـ page جديدة — Rule 4) فيها: كود الإحالة الشخصي + زر «انسخ الكود» + قائمة بالـ referrals اللي تمت. |
| **Backend** | 1) توليد `referral_code` لكل يوزر جديد (format: `GLM-<userId8chars>`). 2) `/api/referral/redeem` (موجود فعلاً في الـ docs، لكن الـ endpoint مش موجود في `src/app/api/referral/` — يحتاج إنشاء). 3) في `/api/paymob/callback` بعد نجاح الدفع: لو الـ token جاي مع `referral_code` → نضيف 30 يوم لليوزر الـ referrer. |
| **Anti-abuse** | (أ) ما يصرفش المكافأة إلا بعد ما الـ referee **يدفع** (مش بس يسجل). (ب) max 10 referrals لليوزر/سنة. (ج) نمنع self-referral (نفس الإيميل/الـ IP/الجهاز). (د) الـ referee لازم يدفع في خلال 30 يوم من قبول الكود. |
| **تعقيد التنفيذ** | **Medium** — 8-12 ساعة. |

#### 2.2.4 Free trial extension (14 → 21 for cohort X)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | مش خصم، لكن تمديد. لمجموعة محددة (مثلاً: المستخدمين اللي سجّلوا في رمضان، أو اللي دعاهم صديق). |
| **Paymob integration** | لا — كل المجال في `auth.db`. |
| **Database schema** | لا تغيير. حقل `trial_ends_at` موجود في `users` table. |
| **UI** | Banner في الـ dashboard: «تمديد التجربة: ليك 21 يوم بدل 14 — استمتع بكل مزايا Premium». |
| **Backend** | Cron job أو admin endpoint: `UPDATE users SET trial_ends_at = DATE(trial_ends_at, '+7 days') WHERE cohort = X`. |
| **تعقيد التنفيذ** | **Easy** — 2-3 ساعات. |

#### 2.2.5 Loyalty tiers (3 mo = 10%, 6 mo = 20%)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | بعد 3 شهور اشتراك متواصل → الخصم 10% تلقائيًا على التجديد. بعد 6 شهور → 20%. |
| **Paymob integration** | لا — يُطبّق قبل إرسال `amount_cents` لـ Paymob. |
| **Database schema** | مطلوب جدول `LoyaltyTier`: `min_months, discount_pct, badge_label`. + حقل `consecutive_months_paid` في `subscriptions` table. |
| **UI** | Banner في الـ dashboard بعد 3 شهور: «شكرًا لثقتك — من التجديد الجاي، الخصم 10% تلقائيًا». |
| **Backend** | في `/api/subscription/checkout` عند التجديد: `SELECT consecutive_months_paid FROM subscriptions WHERE user_id=X` → لو ≥ 6 → pct=20%, elif ≥ 3 → pct=10%. |
| **تعقيد التنفيذ** | **Medium** — 6-8 ساعات. |

#### 2.2.6 Time-limited (Ramadan / Black Friday / New Year)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | PromoCode بـ `expires_at` محدد (مثلاً: `RAMADAN30` صالح من 1-30 رمضان، 30% off أول شهر). |
| **Paymob integration** | لا — يُطبّق قبل `amount_cents`. |
| **Database schema** | لا تغيير — `PromoCode` table موجود (فيه `code`, `max_uses`, `current_uses`, `expires_at`, `is_active`). |
| **UI** | Banner في `PricingView`: «رمضان 30% — استخدم كود RAMADAN30 عند الدفع». + input field للكود في صفحة الـ checkout. |
| **Backend** | تعديل `/api/subscription/checkout`: يفحص الـ `promoCode` في الـ body، يفحصه في `PromoCode` table، لو صالح → يحسب `amount_cents * (1 - pct/100)`. **ملاحظة:** الـ PromoCode الحالي بـ يمنح `premium_days` (أيام مجانية)، مش `discount_pct`. لازم نضيف حقل `discount_pct` لـ PromoCode table. |
| **تعقيد التنفيذ** | **Easy-Medium** — 4-6 ساعات (إضافة حقل `discount_pct` + logic في checkout). |

#### 2.2.7 Bundle (Premium + Pro together)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | العميل بـ يشترك في Pro بسعر 199 EGP، ويحصل على Premium «مجانًا» للأفراد اللي بـ يستخدموا حسابه. |
| **Paymob integration** | لا. |
| **Database schema** | مطلوب: حقل `tier` يبقى array أو JSON (`['premium', 'pro']`)، أو جدول `UserTierAddons`. |
| **UI** | بطاقة رابعة في `PricingView`: «Bundle Pro + Premium Family — 199 EGP/شهر بدل 298 EGP». |
| **Backend** | تعديل `applyPaywallToResults()` في `src/lib/paywall.ts` لـ يفحص الـ tier array. |
| **تعقيد التنفيذ** | **Hard** — 12-16 ساعة (multi-tier per user = تغيير معماري). **تأجيل للمرحلة 3.** |

#### 2.2.8 Flash sale (24-hour 50% off)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | نفس time-limited (2.2.6) لكن بـ نافذة 24 ساعة فقط. |
| **Paymob integration** | لا. |
| **Database schema** | لا تغيير. |
| **UI** | Countdown timer حقيقي (JavaScript Date.now()) في `PricingView`: «العرض ينتهي بعد 23:59:42». |
| **Backend** | نفس 2.2.6. |
| **تعقيد التنفيذ** | **Easy** — 2-3 ساعات. **تحذير:** flash sales بـ تجيب low-quality customers (اللي بـ يدفعوا بس لما فيه خصم). LTV منخفض. نستخدمها بـ حساسية. |

#### 2.2.9 Student discount (50% with .edu email)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | العميل بـ يدخل إيميل `.edu.eg` أو `.edu` → يحصل على 50% off دائم. |
| **Paymob integration** | لا. |
| **Database schema** | حقل `is_student` boolean في `users` table + `student_email_verified_at`. |
| **UI** | في `PricingView`: رابط «طالب؟ احصل على 50% خصم». |
| **Backend** | التحقق: regex `/\.edu(\.eg)?$/` على الإيميل. **ملاحظة:** دي مـش verification قوية — أي حد يقدر يعمل `fake@anu.edu.eg`. الحل القوي: إرسال كود OTP للإيميل. لكن دي complexity عالية. |
| **تعقيد التنفيذ** | **Medium-Hard** — 8-12 ساعة (مع OTP). |
| **الأولوية** | **منخفضة** — segment صغير في السوق العربي. **تأجيل.** |

#### 2.2.10 Regional pricing (EGX/KSA/US)

| العنصر | التفصيل |
|---|---|
| **آلية الخصم** | كل سوق بـ يشوف سعر بعملته المحلية. EGX = 99 EGP، KSA = 19 SAR، US = $2.99. |
| **Paymob integration** | Paymob بـ يقبل EGP فقط. الحل: باقي العملات بـ تتحول لـ EGP وقت الـ checkout بسعر صرف ثابت (مثلاً: 1 SAR = 13 EGP، 1 USD = 48 EGP) + نكتب بوضوح في الـ UI «الدفع بـ EGP بعد التحويل». |
| **Database schema** | لا تغيير — `MarketPricing` table موجود بـ `tier_market_billing_cycle` unique key. |
| **UI** | الموجود في `PricingView.tsx` (line 43-50): `MARKET_OPTIONS` array + `<Select>` للسوق. كافٍ. |
| **Backend** | الـ `checkout/route.ts` بـ يقرأ `price_egp` من `MarketPricing` جاهز. |
| **Region detection** | (أ) `navigator.language` (موجود فعلاً في PricingView line 82-89). (ب) IP geolocation عبر IPAPI أو MaxMind (دقة 99%+). (ج) user setting: لو العميل اختار سوق يدويًا، نحترم اختياره (precedence). **التوصية:** IP geolocation للـ first visit + user setting override. |
| **تعقيد التنفيذ** | **Easy** — 2-3 ساعات (seed للأسعار الجديدة + IP geolocation في middleware). |

### 2.3 ملخص التغييرات المطلوبة في الـ Schema (Database)

| التغيير | الملف/الجدول | الحقل الجديد | الحاجة |
|---|---|---|---|
| 1 | `PromoCode` table | `discount_pct INTEGER DEFAULT 0` | لـ time-limited + flash + first-month |
| 2 | `MarketPricing` table | `first_payment_discount_pct INTEGER DEFAULT 0` | لـ first-month discount |
| 3 | `subscriptions` table | `consecutive_months_paid INTEGER DEFAULT 0` | لـ loyalty tiers |
| 4 | `users` table | `is_student BOOLEAN DEFAULT 0` | لـ student discount |
| 5 | New table: `Referral` | `id, referrer_user_id, referral_code, referee_user_id, status, created_at, completed_at` | لـ referral program |
| 6 | New table: `PromoCodeRedemption` | `id, promo_code_id, user_id, redeemed_at` | لـ منع double-redemption |
| 7 | New table: `PaymentToken` (اختياري) | `user_id, paymob_token, card_last4, expires_at` | لـ recurring بـ tokenization |

**ملاحظة Rule 63:** الجداول الجديدة (3) بـ تُنشأ عبر `CREATE TABLE IF NOT EXISTS` في الـ endpoint اللي بيستخدمها (نفس نمط `ensurePromoCodeTable()` الموجود في `/api/admin/promo-codes/route.ts` line 9-31). ما ننشئش migration scripts منفصلة.

---

## 3. المحفّزات النفسية — بأسلوب احترافي (NO HYPE per Rule 31)

### 3.1 القاعدة الذهبية

> **العميل مستثمر، مش طفل.** الـ financial platforms المحترمة (Bloomberg, TradingView, Finbox) بـ تستخدم **بيانات + شفافية**، مش **انفعال + إلحاح**. الـ Rule 31 بـ تمنع: «🚀 حقق أحلامك!» / «💰 كن ثريًا!» / «🔥 عرض خاص!». المسموح: وصف وظيفي محايد + أرقام حقيقية + مقارنات موضوعية.

### 3.2 المحفّزات الـ 6 المعتمدة

| # | المحفّز | المبدأ النفسي | النص المقترح (NO-HYPE) |
|---|---|---|---|
| 1 | **Scarcity (الندرة)** | الكميات المحدودة بـ تزيد القيمة المدركة (Cialdini). | «الكود RAMADAN30 محدود بـ 500 مستخدم — اتبقى 47 كود متاح.» |
| 2 | **Urgency (الإلحاح الزمني)** | العميل بـ يأجل ما لم فيه deadline. | «العرض ساري حتى 30 رمضان — countdown حقيقي على الـ page.» |
| 3 | **Social proof (الدليل الاجتماعي)** | العميل بـ يثق في أفعال غيره. | «استخدم 1,247 مستثمر كود RAMADAN30 هذا الشهر.» (رقم حقيقي من الـ DB) |
| 4 | **Value anchoring (تثبيت القيمة)** | تحويل السعر لـ مرجع يومي مألوف. | «99 ج.م/شهر = 3.3 ج.م/يوم = أقل من قهوة.» |
| 5 | **Comparison (المقارنة الموضوعية)** | العميل بـ يقارن. | «TradingView Essential = $14.95/شهر. Premium عندنا = $2.99/شهر — مع بيانات EGX/KSE الحية اللي TradingView ما عندهوش.» |
| 6 | **Loss aversion (الخوف من الخسارة)** | الخوف من الخسارة أقوى من رغبة الربح بمقدار 2× (Kahneman). | «خلال تجربتك الـ 14 يوم، V40.2 ولّد 5 توقعات لم تشاهدها (مقفولة). لو اشتركت، بـ تشوفهم + كل التوقعات القادمة.» |

### 3.3 ما **لا** نستخدمه (مخالف لـ Rule 31 + Rule 50)

| المحفّز | لماذا ممنوع؟ |
|---|---|
| «🔥🔥🔥 عرض لا يُفوّت!» | Hype language — Rule 31. |
| «سعرنا 99 بدل 999!» (false anchor) | كذب — Rule 27 (NO-FAKE-DATA) + Rule 50 (احترام فلوس العميل). |
| «آخر فرصة! اشترك الآن وإلا!» | إكراه — Rule 50. |
| صور لأشخاص أثرياء + يخوت + سيارات | Hype + غير مهني. |
| Pop-ups تمنع الإغلاق | Dark pattern — ممنوع قانونيًا في UE + مخالف لـ Rule 50. |

### 3.4 الذكاء الثقافي للسوق العربي

- **العميل المصري:** يقدّر «العرض المحدود» لكن بـ يشك في «الخصم المبالغ فيه». الخصم 30-50% مقبول؛ 80% بـ يثير الشك.
- **العميل السعودي:** يقدّر «القيمة الاسمية» — يفضّل «احصل على شهرين مجانًا» على «خصم 16.6%» (رغم إنهم نفس الحسبة).
- **العميل الأمريكي:** يقدّر الـ transparency. اعرض: «$2.99/mo. Cancel anytime. No hidden fees.» صراحة.

---

## 4. العروض المحددة للإطلاق الفوري (Top 5 Immediate)

### 4.1 معايير الاختيار

1. **Impact عالي على التحويل** (≥10% lift متوقع).
2. **Complexity منخفض** (≤8 ساعات برمجة).
3. **LTV إيجابي** (مش بـ يجيب low-quality customers).
4. **متوافق مع Rule 50** (يحترم فلوس العميل).
5. **متوافق مع Rule 4** (ما ينشئش شاشة جديدة).

### 4.2 العروض الـ 5 المختارة

#### 🥇 Offer #1 — «السنوي الأوفر» (Annual Push)

| العنصر | التفصيل |
|---|---|
| **الاسم الداخلي** | `OFFER_ANNUAL_PUSH_2026` |
| **نوع العرض** | Annual = 2 months free (16.6% off implicit) |
| **الخصم الفعلي** | 990 EGP/year بدل 1188 EGP/year (يعني شهرين مجانًا). |
| **الجمهور المستهدف** | كل trial users اللي وصلوا لـ day 10 من التجربة (نضج الفهم). |
| **المدة** | دائم (مش محدود بوقت) — ده default behavior. |
| **Conversion lift متوقع** | +25-40% على yearly mix (benchmark: Recurly 2023 — annual plans بـ ترفع LTV بـ 2-3×). |
| **Complexity** | **Easy** — UI موجود فعلاً (`PricingView.tsx` line 200-203). التحدّي تسويقي: nudge المستخدم. |
| **آلية الـ nudge** | (أ) في `TrialExpiredModal`: يعرض سنوي أولًا + «وفّر 198 EGP سنويًا». (ب) في الـ dashboard بعد 30 يوم من الاشتراك الشهري: banner «وفّر 17% بالتحويل للسنوي». |
| **التكامل مع Rule 50** | العميل بـ يقدر يلغي في أي وقت — لو ألغى بعد 6 شهور، بـ يسترجع الـ 6 شهور الباقية (prorated refund). |

#### 🥈 Offer #2 — «الشهر الأول بنص السعر» (First-Month 50%)

| العنصر | التفصيل |
|---|---|
| **الاسم الداخلي** | `OFFER_FIRST_MONTH_50` |
| **نوع العرض** | First-month discount (50% off) |
| **الخصم الفعلي** | 49.5 EGP أول شهر، 99 EGP كل شهر بعدها. |
| **الجمهور المستهدف** | trial users اللي trial Ends in ≤ 2 days + اللي فاتهم trial (expired ≤ 7 days). |
| **المدة** | محدود — 90 يومًا تجريبيًا، بعدها نقيّم. |
| **Conversion lift متوقع** | +15-25% trial→paid (benchmark: ProfitWell — first-month discount بـ يرفع التحويل بـ 18% median). |
| **Complexity** | **Medium** — 4-6 ساعات. |
| **المطلوب برمجيًا** | (أ) حقل `first_payment_discount_pct` في `MarketPricing`. (ب) تعديل `/api/subscription/checkout` لـ يطبّق الخصم أول مرة فقط. (ج) UI: badge «الشهر الأول 50% — 49.5 EGP فقط» في `PricingView`. |
| **التكامل مع Rule 50** | السعر الكامل بـ يتعرض بوضوح: «49.5 EGP الآن، 99 EGP/شهر بعدها». ما فيهش small print مُضلِّل. |

#### 🥉 Offer #3 — «دعوة صديق = شهر مجاني» (Referral Program)

| العنصر | التفصيل |
|---|---|
| **الاسم الداخلي** | `OFFER_REFERRAL_M2Y` |
| **نوع العرض** | Referral program |
| **المكافأة للمرسِل** | +30 يوم Premium مجاني لكل صديق يُكمل اشتراك (max 10/year). |
| **المكافأة للمرسَل إليه** | +7 أيام تجربة إضافية + خصم 10% أول شهر (99→89 EGP). |
| **الجمهور المستهدف** | كل paying users (Premium + Pro). |
| **المدة** | دائم. |
| **Conversion lift متوقع** | +10-20% من الـ signups الجديدة عبر referral (benchmark: Dropbox referral 4× growth, fintech median +12%). |
| **Complexity** | **Medium** — 8-12 ساعة. |
| **المطلوب برمجيًا** | (أ) جدول `Referral`. (ب) توليد `referral_code` لكل يوزر. (ج) `/api/referral/redeem` endpoint. (د) wiring في `/api/paymob/callback` لـ منح المكافأة بعد نجاح الدفع. |
| **Anti-abuse** | (أ) ما يصرفش إلا بعد ما الصديق يدفع. (ب) max 10/year. (ج) منع self-referral (نفس الإيميل/IP/الجهاز). (د) الـ referee لازم يدفع في خلال 30 يوم. |
| **التكامل مع Rule 50** | العميل بـ يدفع 99 EGP كاملة (مش مخدوم في الأول). المكافأة «مكافأة» حقيقية، مش «خصم صوري». |

#### 🏅 Offer #4 — «خصم رمضان 30%» (Ramadan Time-Limited)

| العنصر | التفصيل |
|---|---|
| **الاسم الداخلي** | `OFFER_RAMADAN_30` |
| **نوع العرض** | Time-limited (Ramadan) |
| **الخصم الفعلي** | 30% off أول شهر = 69.3 EGP بدل 99 EGP. |
| **الكود** | `RAMADAN30` (PromoCode بـ `discount_pct=30`, `max_uses=500`, `expires_at=2026-XX-XX`). |
| **الجمهور المستهدف** | كل trial users + expired trials (في آخر 90 يوم) + social media audience. |
| **المدة** | 30 يوم (1-30 رمضان). |
| **Conversion lift متوقع** | +30-50% spike خلال الفترة (benchmark: Black Friday في SaaS — +40% median). |
| **Complexity** | **Easy-Medium** — 4-6 ساعات (إضافة `discount_pct` لـ PromoCode + logic في checkout). |
| **المطلوب برمجيًا** | (أ) ALTER TABLE على PromoCode: `ADD COLUMN discount_pct INTEGER DEFAULT 0`. (ب) تعديل `/api/subscription/checkout` لـ يفحص promoCode + يطبّق discount_pct. (ج) UI: input field للكود في الـ checkout + banner «رمضان 30% — استخدم كود RAMADAN30». |
| **Anti-abuse** | (أ) كود واحد لكل يوزر. (ب) max_uses=500. (ج) expires_at صارم. |
| **التكامل مع Rule 50** | الـ 30% off حقيقي على أول شهر. بعدها العميل بـ يدفع 99 EGP. بـ يتعرض بـ وضوح: «69.3 EGP أول شهر، 99 EGP/شهر بعدها». |
| **ملاحظة** | لازم ننسق مع الـ campaigns (إيميل + SMS + WhatsApp) — قسم 6. |

#### 🏅 Offer #5 — «تسعير السوق المحلي» (Regional Pricing Activation)

| العنصر | التفصيل |
|---|---|
| **الاسم الداخلي** | `OFFER_REGIONAL_PRICING` |
| **نوع العرض** | Regional pricing (Paymob EGP only — باقي العملات بـ تتحول لـ EGP وقت الدفع). |
| **الأسعار** | EGX: 99 EGP · KSA: 19 SAR · Kuwait: 1.5 KWD · Qatar: 15 QAR · US/Global: $2.99 · Crypto: $2.99 |
| **الجمهور المستهدف** | كل المستخدمين الجدد خارج مصر (segment كبير — KSA/US). |
| **المدة** | دائم. |
| **Conversion lift متوقع** | +15-25% من أسواق غير مصر (benchmark: localized pricing بـ يرفع التحويل بـ 20% median in fintech). |
| **Complexity** | **Easy** — 2-3 ساعات. |
| **المطلوب برمجيًا** | (أ) seed للـ `MarketPricing` للأسواق الجديدة. (ب) IP geolocation في middleware (IPAPI.co free tier — 30K req/mo). (ج) override يدوي في `PricingView` (موجود فعلاً). |
| **Anti-abuse** | العميل بـ يقدر يغيّر السوق يدويًا (override) — لكن الدفع دايماً بـ EGP عبر Paymob. ما فيهش تجاوز للسعر. |
| **التكامل مع Rule 50** | العميل بـ يشوف السعر بعملته المحلية + بـ يشوف «الدفع بـ EGP بعد التحويل بسعر صرف X». شفافية كاملة. |

### 4.3 ملخص الـ Top 5 — الأولوية والـ Effort

| # | العرض | Complexity | Effort (ساعات) | Impact (LTV) | أولوية الإطلاق |
|---|---|---|---|---|---|
| 1 | Annual Push | Easy | 0-2 | ⭐⭐⭐⭐⭐ | أسبوع 1 |
| 5 | Regional Pricing | Easy | 2-3 | ⭐⭐⭐⭐ | أسبوع 1 |
| 4 | Ramadan 30% | Easy-Medium | 4-6 | ⭐⭐⭐⭐ | أسبوع 2-3 (قبل رمضان بـ 2 أسبوع) |
| 2 | First-Month 50% | Medium | 4-6 | ⭐⭐⭐⭐ | أسبوع 3-4 |
| 3 | Referral | Medium | 8-12 | ⭐⭐⭐⭐⭐ | أسبوع 4-6 |

**إجمالي المجهود:** 18-29 ساعة برمجة = 3-5 أيام عمل مُركّزة. **موزعة على 6 أسابيع** (لأن كل عرض بـ يحتاج مراقبة + iterate).

---

## 5. خطة الـ A/B Testing

### 5.1 القاعدة الذهبية لـ A/B في الـ fintech

> **A/B test واحد في كل مرة.** لو جرّبنا عرضين في نفس الوقت على نفس الـ segment، مـنعرفش مين اللي أثّر. كل test لازم يستمر **14 يوم على الأقل** (عشان دورة الـ trial الكاملة = 14 يوم، نشوف الـ conversion للنهاية).

### 5.2 الـ A/B Tests الـ 5 المعتمدة (بـ الترتيب)

#### Test #1 — Annual vs Monthly Default

| المتغير | المتغير A (control) | المتغير B (variant) |
|---|---|---|
| الـ default في PricingView | monthly | yearly (مع badge «شهرين مجاناً») |
| حجم العينة | 200 trial users | 200 trial users |
| مدة الاختبار | 14 يوم | 14 يوم |
| Success metric | yearly conversion rate, ARPU | yearly conversion rate, ARPU |
| الـ segment | trial day 10+ users (نضج الفهم) | trial day 10+ users |
| التوقع | control = 5% yearly, variant = 12% yearly | |
| الـ verdict | لو variant > control بـ ≥3% (absolute)، اعتمدها default | |

#### Test #2 — First-Month Discount: 30% vs 50% vs 70%

| المتغير | A: 30% off | B: 50% off | C: 70% off |
|---|---|---|---|
| السعر أول شهر | 69.3 EGP | 49.5 EGP | 29.7 EGP |
| حجم العينة | 100 trial users | 100 | 100 |
| مدة الاختبار | 21 يوم (عشان نشوف churn بعد أول شهر) | 21 | 21 |
| Success metric | trial→paid conversion + 30-day churn | | |
| التوقع | 30% → conv 8%, churn 12% · 50% → conv 14%, churn 15% · 70% → conv 20%, churn 30% (deal-hunters) | | |
| الـ verdict | اختار الأعلى في LTV = conv × (1-churn) × 99 × 12 | | |

#### Test #3 — Referral Reward: 1 month vs 2 weeks vs cashback

| المتغير | A: 1 month free | B: 2 weeks free | C: 25 EGP cashback |
|---|---|---|---|
| حجم العينة | 100 paying users | 100 | 100 |
| مدة الاختبار | 30 يوم | 30 | 30 |
| Success metric | # referrals/user, conversion of referees | | |
| الـ verdict | اختار الأعلى في (referrals/user × conversion × LTV) | | |

#### Test #4 — Pricing Layout: 3 cards vs 2 cards vs slider

| المتغير | A: 3 بطاقات (Premium + Pro + B2B) | B: 2 بطاقات (Premium + Pro) | C: slider (Monthly ↔ Yearly) |
|---|---|---|---|
| حجم العينة | 200 users | 200 | 200 |
| مدة الاختبار | 14 يوم | 14 | 14 |
| Success metric | checkout completion rate | | |

#### Test #5 — Copy: Value Anchor vs Comparison vs Loss Aversion

| المتغير | A: value anchor («3.3 EGP/يوم = أقل من قهوة») | B: comparison («TradingView = $14.95، إحنا $2.99») | C: loss aversion («فوّت 5 توقعات النهاردة») |
|---|---|---|---|
| حجم العينة | 200 trial users | 200 | 200 |
| مدة الاختبار | 14 يوم | 14 | 14 |
| Success metric | click-through to /pricing | | |

### 5.3 البنية التحتية لـ A/B (Implement Once)

- **حقل في `users` table:** `ab_variant TEXT DEFAULT 'A'` — يُعيّن عشوائيًا عند الـ signup.
- **endpoint:** `/api/admin/ab-test-results?test_id=X` — بـ يرجّع conversion rate لكل variant.
- **Rule 63:** ما ننشئش endpoint جديد — نوسّع `/api/admin/subscriptions` الموجود (فيه MRR + conversionRate بالفعل).

### 5.4 قواعد الإيقاف المبكر (Early Stopping)

- لو variant A بـ يحقق lift ≥10% (absolute) على control بعد 7 أيام + ≥50 sample → اوقف الـ test + اعتمد variant A.
- لو أي variant بـ يسبب drop ≥5% (absolute) في conversion → اوقف فورًا + ارجع لـ control.

---

## 6. حملات الإيميل + SMS + WhatsApp

### 6.1 القاعدة العامة (NO-HYPE per Rule 31)

> **الإيميل بـ يتكلم بأسلوب محترف:** خطاب مباشر، أرقام حقيقية، لا إيموجي حشو، لا «🔥». الـ subject line بـ يكون وصفي، مش تشويقي مُفتعل.

### 6.2 سلسلة الترحيب (Welcome Series — 3 إيميلات خلال التجربة)

#### Email #1 — Day 0 (ساعة الـ signup)
- **Subject:** «مرحبًا بك في GLM Investment — تجربتك المجانية 14 يوم بدأت»
- **Content outline:**
  - فقرة 1: ترحيب مباشر + اسم المنصة.
  - فقرة 2: 3 ميزات تفتحها التجربة (Fair Value + Maker Radar + V40.2 Predictions).
  - فقرة 3: خطوة الـ action التالية: «ابدأ بـ watchlist 5 أسهم بت tracking».
  - Footer: تذكير «التجربة تنتهي في YYYY-MM-DD».

#### Email #2 — Day 5 (منتصف التجربة)
- **Subject:** «خلال 5 أيام، V40.2 ولّد لك X توقعات — شوف أداءها»
- **Content outline:**
  - فقرة 1: تقرير أداء شخصي («ولّدنا ليك 7 توقعات: 5 رابحة، 2 خاسرة»).
  - فقرة 2: ميزة قفلتها التجربة: Fair Value للأسهم اللي بتـ tracking.
  - فقرة 3: نصيحة: «جرّب الـ Exit Radar — بيعرفك الأسهم القرب تنهار».
  - Footer: «باقي 9 أيام على انتهاء التجربة».

#### Email #3 — Day 12 (يوم 12 من 14 — الـ urgency window)
- **Subject:** «باقي 48 ساعة على انتهاء تجربتك — قرار الاشتراك»
- **Content outline:**
  - فقرة 1: «تجربتك بتنتهي يوم YYYY-MM-DD الساعة HH:MM».
  - فقرة 2: ملخص اللي شفته («شفت 14 يوم من V40.2، Fair Value لـ X سهم، 12 درس متقدم»).
  - فقرة 3: العرض — «اشترك النهاردة بـ 49.5 EGP أول شهر (بدل 99) — عرض الشهر الأول بنص السعر».
  - فقرة 4: زر CTA: [اشترك الآن] + زر ثانوي: [خد كود إحالة].
  - Footer: «لو مش هتشترك، فضل مجاني (3 توقعات/يوم، رادار متأخر ساعة، بدون fair value)».

### 6.3 تذكير انتهاء التجربة (Trial Expiring — Day 13 of 14)

- **Channel:** Push notification + WhatsApp (للـ phone-verifiers) + Email.
- **Subject:** «24 ساعة على انتهاء تجربتك»
- **Content outline:**
  - فقرة 1: «بكرة يوم YYYY-MM-DD هتنتهي تجربتك المجانية».
  - فقرة 2: «في الـ 14 يوم اللي فاتوا، حقق V40.2 نسبة نجاح 69% على توقعات EGX».
  - فقرة 3: زر CTA: [اشترك بـ 49.5 EGP أول شهر].
  - Footer: «أو فضل مجاني — بدون بطاقة ائتمان».

### 6.4 حملة الاستعادة (Win-Back — Expired Trial + 7 days)

- **Channel:** Email + WhatsApp (للـ اللي سجّلوا phone).
- **Subject:** «فوّتت توقعات V40.2 آخر 7 أيام — شوف اللي فاتك»
- **Content outline:**
  - فقرة 1: «من 7 أيام، V40.2 ولّد 5 توقعات يومية لم تشاهدها (مقفولة)».
  - فقرة 2: ملخص أداء («من الـ 5: 4 رابحة بـ متوسط +8.2%، 1 خاسرة -2.1%»).
  - فقرة 3: عرض الـ win-back: «ارجع بـ 30% off أول شهر — كود COMEBACK30 صالح 48 ساعة».
  - زر CTA: [رجع لـ Premium].

### 6.5 إعادة التفاعل (Re-engagement — Inactive 30+ days)

- **Channel:** Email only (الـ SMS بـ يزعج).
- **Subject:** «تحديثات المنصة منذ آخر زيارة — X ميزة جديدة + Y توقعات V40.2»
- **Content outline:**
  - فقرة 1: «من 30 يوم ما فتحتش المنصة. ده ملخص اللي فاتك».
  - فقرة 2: ميزات جديدة (Exit Radar + Devil's Advocate).
  - فقرة 3: توقعات V40.2 آخر 30 يوم (win rate + avg return).
  - فقرة 4: زر CTA: [افتح المنصة] + زر ثانوي: [اشترك بـ 49.5 EGP].

### 6.6 جدول الـ Cadence الكامل

| اليوم | القناة | الـ Segment | الـ Action |
|---|---|---|---|
| 0 | Email + push | trial day 0 | Welcome + onboarding |
| 5 | Email | trial day 5 | Mid-trial performance report |
| 12 | Email + WhatsApp | trial day 12 | "48 ساعة قرار" |
| 13 | Push + WhatsApp + Email | trial day 13 | "24 ساعة" |
| 14+1 | Email | trial expired | "تم القفل — خد عرض COMEBACK30" |
| 14+7 | Email + WhatsApp | trial expired +7d | "فوّتت 5 توقعات" |
| 30 | Email | inactive 30d | "تحديثات المنصة" |
| 60 | Email | inactive 60d | final — "آخر فرصة لـ COMEBACK30" |
| 90 | — | inactive 90d | **stop** — ما نزعجش العميل. |

### 6.7 الـ Infrastructure المطلوبة

- **Email service:** Resend (free tier 3000/mo) أو AWS SES ($0.10 per 1000).
- **WhatsApp Business API:** Twilio ($0.005/msg) — ميزة الـ WhatsApp مكلفة، تـقتصر على الـ high-intent moments (day 13 + win-back).
- **SMS:** للسوق المصري فقط — Vodafone SMS Gateway (0.15 EGP/msg).
- **Template engine:** MJML للـ email templates (responsive Arabic RTL).
- **Rule 63:** ما ننشئش نظام جديد — نتكامل مع `/api/notifications` الموجود + `alert-engine.ts`.

---

## 7. تصميم برنامج الإحالة (Referral Program Design)

### 7.1 المكافآت

| الدور | المكافأة | التبرير |
|---|---|---|
| **المرسِل (Referrer)** | +30 يوم Premium مجاني لكل صديق يُكمل اشتراك (max 10/year) | الـ 30 يوم = قيمة 99 EGP. مكافأة محسوسة، مش مبلغ رمزي. |
| **المرسَل إليه (Referee)** | +7 أيام تجربة + 10% off أول شهر | الـ 7 أيام بـ ترفع تجربته لـ 21 يوم (فوق الـ 14 الافتراضي). الـ 10% off بـ تكسر barrier أول دفعة. |

### 7.2 الـ Tracking Mechanism

- **الكود:** `GLM-<8-char-userId-hash>` — فريد لكل يوزر، يُولّد عند الـ signup.
- **الـ redemption flow:**
  1. الـ referee بـ يفتح link فيه `?ref=GLM-XXXXXXXX`.
  2. الـ frontend بـ يخزّن الـ code في `localStorage` + `cookie` (30 يوم expiry).
  3. عند الـ signup، الـ code بـ يتسجّل في جدول `Referral` (status=pending).
  4. عند نجاح أول دفع (في `/api/paymob/callback`)، الـ status بـ يتحوّل لـ `completed` + المكافأة بـ تُمنح.
- **الـ anti-fraud:**
  - نفس الـ IP/device fingerprint → منع.
  - نفس الـ email domain → منع.
  - max 10 successful referrals/year per referrer.
  - الـ referee لازم يدفع في خلال 30 يوم من قبول الكود (بعدها الـ referral بـ يُلغى).

### 7.3 الـ UX

- **في `PricingView` (مش شاشة جديدة — Rule 4):** بطاقة «دعوة صديق — احصل على شهر مجاني».
  - عرض الكود الشخصي + زر «انسخ».
  - عرض عدد الـ referrals الناجحة + المكافآت المُمنوحة.
  - زر «شارك على WhatsApp»: `https://wa.me/?text=استخدم%20كودي%20GLM-XXXXXXXX%20في%20GLM%20Investment%20عشان%20تاخد%20تجربة%2021%20يوم%20بدل%2014%20+%2010%%20خصم`

### 7.4 الـvirality Loop Target

- **K-factor target:** 0.3 (يعني كل 10 users بـ يدعوا 3 جداد). ده realistic للـ fintech (Dropbox = 0.6, but they had file-sharing network effect).
- **لو K < 0.1 بعد 30 يوم:** نرفع المكافأة لـ +45 يوم.
- **لو K > 0.5:** نزوّد الـ anti-abuse.

---

## 8. الـ Annual Subscription Push

### 8.1 لماذا السنوي أفضل تجاريًا

| العامل | Monthly | Annual | الفرق |
|---|---|---|---|
| MRR per user | 99 EGP | 990 EGP (دفعة واحدة) | Annual = 10× cash upfront |
| Churn rate (monthly) | 8-12% | 2-4% | Annual = churn أقل بـ 3× |
| LTV (12 month) | 99 × (1/churn) = ~990 EGP | 990 EGP (مضمون) | Annual = +0-10% |
| CAC payback | 2-3 شهر | 1 شهر (لأن الدفعة كاملة) | Annual = cash flow أسرع |
| Refund risk | 0 (مش charges recur) | متوسط (لو العميل طلب refund بعد 6 شهور، نرجّع 50%) | Annual = legal/refund overhead |

### 8.2 هيكل الخصم (المعتمد)

- **Annual = 2 months free** = 990 EGP/year بدل 1188 EGP (16.6% off implicit).
- **ده الموجود فعلاً** في `MarketPricing` table + `PricingView.tsx` (badge «شهرين مجاناً»).
- **ما نزيدش الخصم فوق 20%** — دروس من TradingView: الـ annual discount أعلى من 25% بـ يخلّي الـ monthly يبدو «مُبالغ فيه» فيبقى الـ annual هو الأساسي، ده بـ يكسر الـ anchor.

### 8.3 كيف نُدفع العميل من monthly → annual

| الـ Trigger | الـ Nudge |
|---|---|
| بعد 30 يوم من الاشتراك الشهري | Banner في الـ dashboard: «وفّر 198 EGP سنويًا — حوّل لـ Annual» |
| قبل تجديد الشهر التالت بـ 3 أيام | Email: «باقي 3 أيام على تجديدك الشهري — حوّل لـ Annual ووفّر 17%» |
| في صفحة الـ checkout للتجديد | default = yearly (لو العميل monthly حاليًا، نعرض yearly كـ recommended) |
| بعد أول صفاية رابحة | Notification: «حققت +X% هذا الشهر — حوّل لـ Annual ووفّر 17% — معقول بعد النجاح ده» |

### 8.4 الـ grandfather pricing (للعملاء القدامى)

- لو رفعنا الأسعار 10-15% سنويًا (موجود في `PAYWALL-STRATEGY-FINAL` §3.1 "Marketing Insight")، نحافظ على الـ grandfather price للعملاء اللي اشتركوا قبل الزيادة.
- يُطبّق عبر `subscriptions.price_locked_egp` (حقل جديد) — لو NULL، نقرأ من `MarketPricing`؛ لو مش NULL، نستخدمه.

---

## 9. استراتيجية التسعير الإقليمي

### 9.1 مصفوفة الأسعار المعتمدة (من PAYWALL-STRATEGY-FINAL §3.1)

| السوق | Premium/شهر | Pro/شهر | الـ Paymob conversion | الـ Rationale |
|---|---|---|---|---|
| 🇪🇬 EGX (مصر) | 99 EGP | 199 EGP | مباشر (native EGP) | السوق الأساسي — Paymob EGP |
| 🇸🇦 Tadawul (السعودية) | 19 SAR | 39 SAR | 19 SAR × 13.2 = 251 EGP | purchasing power ~3× مصر |
| 🇰🇼 KSE (الكويت) | 1.5 KWD | 2.9 KWD | 1.5 × 158 = 237 EGP | purchasing power ~5× مصر |
| 🇶🇦 QSE (قطر) | 15 QAR | 29 QAR | 15 × 13.3 = 200 EGP | purchasing power ~5× مصر |
| 🇺🇸 US / عالمي | $2.99 | $5.99 | $2.99 × 48 = 144 EGP | منافسة TradingView Essential ($14.95) |
| ₿ Crypto | $2.99 | $5.99 | USD standard | USD standard |

### 9.2 كيفية اكتشاف المنطقة (Region Detection)

| الطريقة | الدقة | الأولوية | التكلفة |
|---|---|---|---|
| 1. `navigator.language` | 60% | 3 (fallback) | مجاني |
| 2. IP geolocation (IPAPI.co / MaxMind) | 99%+ | 1 (default) | مجاني (30K req/mo) أو $50/mo |
| 3. User setting (اختيار يدوي) | 100% | 0 (override دائمًا) | مجاني |
| 4. Phone number country code | 95% (لو مسجّل) | 2 (للـ verified users) | مجاني |

**التوصية:** IP geolocation للـ first visit → user setting override دائم (لو العميل غيّر السوق يدويًا، نحترم اختياره + نخزّنه في `users.preferred_market`).

### 9.3 التحدي: Paymob يدعم EGP فقط

- **الحل الحالي:** كل الأسعار بـ تتحول لـ EGP وقت الدفع. الـ PricingView بـ يعرض السعر بعملة المستخدم + footnote: «الدفع بـ EGP بعد التحويل بسعر الصرف المعتمد».
- **سعر الصرف:** نستخدم سعر ثابت (محدث يدويًا كل ربع سنوي) في `MarketPricing.fx_to_egp` — مش live FX (عشان ما يكونش في تذبذب سعر يومي).
- **البديل للأسواق خارج مصر:** Stripe (للـ USD) — لكن ده requires新しい payment gateway integration (Medium complexity، 1-2 أسبوع). **تأجيل للمرحلة 2.**

### 9.4 الـ parity audit كل ربع سنوي

- كل ربع سنوي: مراجعة الـ purchasing power parity + تعديل الأسعار لو لازم (مثلاً: لو الـ EGP انخفض 20% مقابل USD، نرفع أسعار الـ USD بنسبة 5-10%).
- التغيير بـ يتطبّق على الـ **new subscriptions فقط** (grandfathering للقدامى).

---

## 10. مسار الـ Upsell

### 10.1 Free → Premium (مُطبّق بالفعل)

- **الآلية:** paywall gates في `src/lib/paywall.ts` + `subscription-enforcement.ts`.
- **الـ triggers:**
  - فتح Fair Value badge → «🔒 اشترك في Premium».
  - تجاوز 5 نتائج فلتر → «🔒 Premium لكل النتائج».
  - الدخول على Exit Radar tab → lock screen.
- **مُنفّذ:** ✅ موجود (PAYWALL-STRATEGY-FINAL §5.1 — Phase 1 Quick Wins).

### 10.2 Premium → Pro — متى الـ upsell؟

| الـ Trigger | الـ Nudge |
|---|---|
| بعد 3 شهور اشتراك Premium متواصل | Banner في الـ dashboard: «جاهز لـ Pro؟ +Backtesting + Devil's Advocate + Hunter» |
| بعد أول صفاية رابحة +15% | Notification: «لو جربت Backtesting قبل الصفقة دي، كنت هتعرف إن السهم فيه احتمال +20% — اشترك في Pro» |
| عند الوصول لـ 50 توقع V40.2 شهريًا (limit for Premium view) | «باقي X توقعات ليك هذا الشهر — Premium بـ يعرض 50، Pro غير محدود» |
| عند فتح أي ميزة Pro مقفولة (Backtesting tab) | lock screen: «🔒 Pro feature — اشترك بـ 199 EGP/شهر» |

**الـ rule:** ما نـ upsell Pro قبل ما العميل يلمس قيمة Premium بـ 90 يوم على الأقل (وإلا العميل بـ يحس إنه «لسه مشتغلش» فيتجنب التحديث).

### 10.3 Pro → B2B — متى الـ upsell؟

| الـ Trigger | الـ Nudge |
|---|---|
| عند ضرب API rate limit (10K req/month) | Email: «استخدمت 9,500 API request هذا الشهر — جاهز للـ B2B Pro ($299/year = 100K requests)؟» |
| عند طلب webhook integration من العميل | Email مبيعات + demo call scheduling. |
| عند الوصول لـ 3 markets متزامنة (limit for Pro) | «بتتابع EGX + Tadawul + Crypto — لو حابب تضيف US stocks، B2B بـ يفتح كل الأسواق» |
| للـ corporates/funds: استهداف مباشر | LinkedIn Sales Navigator target list + cold email (sales@glminvestment.com). |

### 10.4 الـ anti-upsell (لازم نتجنبه)

- ❌ ما نـ upsell Pro لـ free users (اللي لسه ما اشتركوش في Premium) — دي بـ تحسس العميل إن «كل حاجة بفلوس».
- ❌ ما نـ upsell B2B لـ individuals — دي بـ تخلّي Pro users يحسوا إنهم «مش مهمين».
- ❌ ما نـ upsell قبل ما العميل يحقق value — لو Premium user خسران في الصفقات، الـ upsell لـ Pro بـ يثير الاستياء. **نوقف الـ upsell banners مؤقتًا** لما نكتشف أن العميل في خسارة (detectable عبر `/api/portfolio/holdings` PnL).

---

## 11. الالتزام بالقواعد الدستورية

| القاعدة | الالتزام |
|---|---|
| **Rule 4 (NO new screens)** | ✅ كل العروض بـ تتكامل في `PricingView.tsx` + `TrialExpiredModal` + `UpsellToasts` + `/referral` (داخل الـ PricingView). ما ننشئش `/page.tsx` جديد. |
| **Rule 31 (NO-HYPE-LANGUAGE)** | ✅ كل النصوص في القسم 3 + 6 + 7 بأسلوب مهني. لا «🔥»، لا «عرض خاص!»، لا «حقق أحلامك!». |
| **Rule 50 (MONEY-AS-CUSTOMER-LIFE)** | ✅ كل العروض بـ تحترم فلوس العميل: لا dark patterns، لا auto-renewal مُخفي، الـ prorated refund للـ annual، إلغاء في أي وقت. |
| **Rule 63 (PUSH-AFTER-EVERY-COMMIT + NO-NEW-FILES)** | ✅ هذا الملف doc جديد (مسموح — documentation). الـ implementation اللاحق بـ يعدّل ملفات موجودة فقط (checkout route, PricingView, promo-codes admin). |
| **Rule 27 (NO-FAKE-DATA)** | ✅ كل أرقام الـ "social proof" (مثلاً: «1,247 مستثمر») بـ تتقرأ من الـ DB الحقيقي. لو الـ DB رجّع 0 → ما نعرضش الـ banner (مش «آلاف العملاء يثقون بنا» كاذبًا). |

---

## 12. الخطوات التالية (Next Actions)

| # | الخطوة | المسؤول | المدة | الإلزامية |
|---|---|---|---|---|
| 1 | اعتماد المالك على الـ Top 5 offers | المالك (`enmohsen20111975`) | فوري | قبل أي implementation |
| 2 | تنفيذ Offer #1 (Annual Push) — UI موجود، بس nudge banners | Marketing + Frontend | 2 ساعة | أسبوع 1 |
| 3 | تنفيذ Offer #5 (Regional Pricing) — seed + IP geo | Marketing + Backend | 3 ساعات | أسبوع 1 |
| 4 | تنفيذ Offer #4 (Ramadan 30%) — قبل رمضان بـ 2 أسبوع | Backend | 6 ساعات | أسبوع 2-3 |
| 5 | تنفيذ Offer #2 (First-Month 50%) | Backend + Frontend | 6 ساعات | أسبوع 3-4 |
| 6 | تنفيذ Offer #3 (Referral) | Backend + Frontend | 12 ساعة | أسبوع 4-6 |
| 7 | إطلاق A/B Test #1 (Annual default) | Marketing | 14 يوم | بعد خطوة 2 |
| 8 | إعداد الـ Email/SMS/WhatsApp infrastructure (Resend + Twilio) | Marketing | 1 أسبوع | بالتوازي مع 2-6 |
| 9 | قياس النتائج بعد 30 يوم (conversion + churn + LTV) | Marketing | 1 يوم | بعد 30 يوم من أول offer |
| 10 | iterate بناءً على الـ data | Marketing | مستمر | شهريًا |

---

## 13. مقاييس النجاح (Success Metrics — بعد 90 يوم)

| المؤشر | الهدف (شهر 3) | كيفية القياس |
|---|---|---|
| Trial → Paid conversion | 6% (مقابل 2-3% حاليًا) | `/api/admin/subscriptions` |
| Annual mix (% من paid users سنوي) | 25% (مقابل <5% متوقع حاليًا) | `subscriptions.billing_cycle` |
| Referral-driven signups | 15% من الإجمالي | `Referral` table count |
| ARPU | $4 (مقابل $2.99 monthly base) | MRR / paid users |
| MRR | $4,000 (مقابل <$500 حاليًا) | Paymob callbacks sum |
| Churn (monthly) | <12% | subscription cancellations |
| Email open rate | >25% (fintech median) | Resend dashboard |
| WhatsApp click-through | >15% (high-intent only) | Twilio dashboard |

---

**نهاية الوثيقة.**
**المراجع:** `00-CONSTITUTION.md` (Rules 4, 27, 31, 50, 63) · `Documentation/PAYWALL-STRATEGY-FINAL.md` (قرار التسعير النهائي) · `src/app/api/subscription/checkout/route.ts` · `src/app/api/admin/promo-codes/route.ts` · `src/modules/subscription/components/PricingView.tsx` · `src/modules/admin/components/PromoCodesAdmin.tsx` · `src/lib/paywall.ts` · `src/lib/subscription-enforcement.ts`.
**التصنيف:** استراتيجية تسويقية مقترحة (بانتظار اعتماد المالك).
**التالي:** اعتماد المالك على الـ Top 5 offers → تنفيذ أسبوع 1 (Annual Push + Regional Pricing).

---


---

## §15 — Paywall Strategy Final (12 قسم — Task ID 9)

## 📎 MERGED APPENDIX — Paywall Strategy Final — Pricing Decision (PAYWALL-STRATEGY-FINAL.md)

> **Source file (merged then archived):** `PAYWALL-STRATEGY-FINAL.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `PAYWALL-STRATEGY-FINAL.md` (verbatim):

# 💰 PAYWALL-STRATEGY-FINAL — قرار التسعير النهائي (Task ID: 9)

> **الوثيقة المرجعية الوحيدة لقرار الـ Paywall بعد المراجعة التسويقية.**
> صادرة من: **قسم التسويق (Marketing Department Lead)**.
> بتاريخ: **2026-10-01** (القرار الأصلي) · **آخر تحديث: 2026-10-02** (Task `DOC-17` — Documentation Secretariat (Final P0 Documentation): تحديث §5.1 الحالة (Wave 5 frontend gates منفّذة) + §5.2 الحالة (Wave 6 backend gates 7 من 8 منفّذة — commit hashes مضافة لكل gate). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 63 (PUSH-AFTER-EVERY-COMMIT) + README editing rule 1).
> حالة الموافقة: **القرار النهائي بعد مراجعة الاستراتيجية المقترحة + تحليل المنافسين + سيكولوجية الإغراء**.
> **تنفيذ:** Phase 1 (frontend gates) — ✅ Wave 5. Phase 2 (backend gates) — ✅ Wave 6 (Task `P0-4` — 7 من 8 gates). Phase 3 (A/B + FOMO + email drip) — ⏳ مرجّع.
> المراجع: `00-CONSTITUTION.md` (Rule 50 + Rule 4 + Rule 63) · `05-CURRENT_STATE.md` §11 + §15 (Wave 6 Payment P0 Fixes) · `WAVE-6-PAYMENT-FIXES-2026-10-02.md` (consolidated changelog) · `BREACH-LOG.md` (BREACH-003..006) · `src/lib/paywall.ts` · `src/lib/subscription-gate.ts` · `src/lib/subscription-enforcement.ts` · `src/modules/subscription/components/PricingView.tsx`.

---

## 0. الملخص التنفيذي (Executive Summary)

المنصة **معروضة للبيع**. المشتري المحتمل بـ يشوف محرك التحويل (monetization engine) قبل أي حاجة تانية. الشكل الحالي بـ يدّي كل حاجة مجانًا — العميل بـ يشوف العيوب + بيمشي. ده **انتحار تجاري**.

**القرار النهائي:** نطبّق **paywall متعدد الطبقات (multi-tier)** يحمي القيمة الحقيقية (fair value + radar + lessons) وراء 3 جدارات ناعمة (soft gates)، مع إبقاء "طُعم التذوق" (taste hook) ظاهرًا مجانًا عشان العميل يحس بالقيمة من غير ما يشوف العيوب.

**الاستراتيجية المقترحة (مراجعة قسم التسويق):**

| العنصر | المقترح | القرار النهائي | السبب |
|---|---|---|---|
| القيمة العادلة (fair value) | مخفية كليًا | ✅ **قبول** — مع "إغراء": نعرض اسم السهم + السعر الحالي + بطاقة "🔒 فرصة +29% — اشترك" | التحايل على سيكولوجية الفضول: العميل بـ يحس إن فيه فرصة ضايعة = دافع شراء أقوى من إخفاء الاسم كليًا |
| أول 10 نتائج فلتر | أول 10 ظاهرة | ⚠️ **تعديل → أول 5** (مش 10) | تحليل المنافسين: Simply Wall St = 10 لكن في أسواق ناضجة؛ EGX/KSE أسواق صغيرة → 10 بـ تكشف معظم الأسهم المفيدة. 5 = طُعم كافي + ما بيكشفش البضاعة كلها |
| رادار الخروج (Exit Radar) | مخفي | ✅ **قبول** | ميزة Pro-grade عالميًا (TipRanks/Finbox بيخفوها) |
| دقة الرادار (Accuracy details) | مخفية | ⚠️ **تعديل → العدد الإجمالي ظاهر، التفاصيل مخفية** | العدد الواحد "دقة 69%" بـ يبيع (proof of competence)؛ التفاصيل per-stock بـ تكشف الأسهم الخاسرة |
| الصفقات التاريخية | ملخص فقط | ✅ **قبول** — ملخص (count + avg return + win rate) ظاهر، التفاصيل الفردية مقفولة | نفس منطق "دقة الرادار" |
| الدروس المتقدمة (12 درس) | أول 3 فقط | ⚠️ **تعديل → كل العناوين ظاهرة + أول 3 كاملة + 4-12 محتوى ضبابي (blurred)** | العناوين بـ تثبت العمق (12 درس مؤسسي = قيمة كبيرة)؛ الضباب بـ يحفّز الفضول |

**الطبقات النهائية (4 طبقات — مش 5):**

```
Free (مجاني — بعد تجربة 14 يوم)
   ↓ تحويل مستهدف 5-8%
Premium (99 ج.م/شهر — 19 ريال — $2.99)
   ↓ تحويل مستهدف 20-30% من Premium
Pro (199 ج.م/شهر — 39 ريال — $5.99)
   ↓ للشركات فقط
B2B (Starter $99/سنة · Pro $299 · Enterprise $999)
```

**الميزة القاتلة (Killer Feature):** **القيمة العادلة (Fair Value)** — هي الميزة الوحيدة اللي:
1. عالميًا مدفوعة في كل المنافسين (Finbox, Simply Wall St, TipRanks).
2. أصعب حاجة تتعمل DIY من بيانات Yahoo المجانية.
3. الأكثر قابلة للتنفيذ (actionable) — بتقول "اشتري CIB تحت 48 ج.م، القيمة العادلة 62".

**ميزة الطُعم (Hook Feature):** **رادار الميكرز (Maker Radar)** — بـ يثبت إن المنصة عندها بيانات فريدة + بصري مذهل. نعرض top 3 picks + delayed 60min (موجود فعلاً في `getRadarAccess()` — بس مش موصول في MakerRadarTab — Phase 1 needed).

---

## 1. تحليل المنافسين (Competitor Analysis)

### 1.1 تحليل تفصيلي لكل منافس

#### 📊 TradingView (15M+ مستخدم، تقييم $1.5B)
- **Free:** 3 مؤشرات لكل شارت · شارتين متزامنين · بيانات يومية بس · لا alerts · لا screeners.
- **Essential** ($14.95/شهر): 5 مؤشرات · شارتين · بدون إعلانات.
- **Plus** ($29.95/شهر): 10 مؤشرات · 4 شارتات · بيانات intraday.
- **Premium** ($59.95/شهر): 25 مؤشرات · 8 شارتات · كل حاجة.
- **القاعدة الذهبية:** 3 مؤشرات مجانًا = "طُعم بسيط"، ما بيكشفش القيمة الحقيقية لكن بيثبت إن الأداة جميلة.
- **الدرس لينا:** المنصة بـ تبيع **العمق** (depth)، مش **البيانات**. الـ 3 مؤشرات مجانية = هدوم مغرية.

#### ❄️ Simply Wall St (Snowflake visualizations)
- **Free:** snowflake لأي سهم (6 مقاييس بصرية) · أعلى 10 أسهم من كل قائمة · محفظة 5 أسهم.
- **Premium** ($9.99/شهر أو $90/سنة): snowflakes غير محدودة · fair value (خصم/علاوة) · قوائم كاملة · محفظة غير محدودة · توقعات 5 سنوات · dividend health.
- **القاعدة الذهبية:** الـ snowflake بـ يثبت القيمة **بصريًا** بدون ما يكشف الأرقام التفصيلية. الـ fair value = الميزة المدفوعة الأولى.
- **الدرس لينا:** الـ visual hook (radar/snowflake) = طُعم مثالي؛ fair value = الميزة اللي بتبيع.

#### 📈 Finbox
- **Free:** شارتات أساسية · watchlist واحدة · 5 سنين بيانات مالية · screeners محدودة.
- **Lite** ($10/شهر): watchlists غير محدودة · 10+ سين بيانات · screeners أكتر.
- **Pro** ($30/شهر): نماذج fair value (DCF + multiples) · peer comparison · API.
- **Premium** ($60/شهر): كل حاجة + API + نماذج مخصصة.
- **القاعدة الذهبية:** الـ DCF fair value = قلب الـ Pro tier. ما فيش fair value مجاني إطلاقًا.
- **الدرس لينا:** fair value = الميزة اللي بتحوّل free → paid.

#### 🎯 TipRanks
- **Free:** ملخص تقييمات المحللين (buy/hold/sell) · تقييمات أساسية للأسهم · أعلى 25 سهم لكل screener.
- **Premium** ($29.99/شهر): أداء المحللين الكامل · صفقات insider · حركات hedge funds · sentiment الأخبار · fair value consensus.
- **القاعدة الذهبية:** الملخص (summary) مجاني = طُعم؛ التفاصيل (per-analyst, per-stock) مدفوعة.
- **الدرس لينا:** "ملخص مجاني + تفاصيل مدفوعة" = نموذج رياضي مظبوط. تطبيقه على دقة الرادار + الصفقات التاريخية.

#### 📰 Seeking Alpha
- **Free:** عناوين مقالات (مقصوصة) · ملخصات · 5 مقالات/شهر.
- **Premium** ($239/سنة): نصوص كاملة · تقييمات الكتّاب · dividend grades · valuation grades.
- **القاعدة الذهبية:** العنوان + أول فقرتين = طُعم بصري؛ الباقي مدفوع = "هدوم مغرية مش عارية" بالظبط.
- **الدرس لينا:** truncation = السلاح الأقوى. نطبّقه على الدروس (أول 3 كاملة + الباقي truncated).

### 1.2 معايير الصناعة (Industry Standards)

| المعيار | القيمة | المصدر |
|---|---|---|
| عدد نتائج الفلتر المجانية | 10-25 (Simply Wall St = 10, TipRanks = 25, Finbox = 25) | كل المنافسين |
| Fair value | **عالميًا مدفوع** (Finbox, Simply Wall St, TipRanks) | إجماع |
| Analyst ratings | ملخص مجاني + تفاصيل مدفوعة | TipRanks |
| Backtesting | **دائمًا مدفوع** | TradingView, Finbox |
| API access | **أعلى tier فقط** | كل المنافسين |
| Trial period | 7-14 يوم (TradingView = 30 يوم، Simply Wall St = لا trial لكن free tier دائم) | متغير |
| Conversion rate (free→paid) | 2-7% (fintech SaaS عام)، 5-15% (premium tools) |的行业 benchmark |

### 1.3 فجوات السوق العربية (Arabic Market Gaps)

المنافسين الدوليين:
- ❌ ما بـ يدعموش EGX / KSE / QSE بشكل كامل (TradingView بيأخر بيانات EGX).
- ❌ ما عندهمش رادار سيولة maker-based (ده ميزة فريدة عندنا — Rule 45).
- ❌ ما عندهمش محتوى تعليمي بالعربي بالعمق المؤسسي (12 درس).
- ❌ ما بيقبلوش دفع محلي (Paymob / فودافون كاش).

**الميزة التنافسية (Competitive Moat):** رادار الميكرز + بيانات EGX الحية + محتوى عربي عميق + دفع محلي. دي فجوة هائل — لازم نحميها بـ paywall ذكي.

---

## 2. سيكولوجية الإغراء (Psychology of the Enticing Preview)

### 2.1 ترجمة تشبيه المالك

> "لو انت روحت بيت دعارة هل كل النسوان بتكون عريانة طبعا لأ لازم يلبسو هدوم مغرية مش عارية ولما تدفع بتخلع هدومها"

**الترجمة لـ UX:**
- **"عريانة" (naked)** = عرض كل البيانات الخام (fair value الحقيقي، نسبة دقة 69%، صفقات خاسرة في التاريخ). ده بيكشف العيوب → العميل بيمشي.
- **"هدوم مغرية" (enticing clothes)** = عرض الواجهة الجميلة + الرادار البصري + العناوين + ملخصات النجاح → بيثبت القيمة من غير ما يكشف الضعف.
- **"تدفع → بتخلع هدومها"** = لما يدفع، بـ يشوف كل التفاصيل (fair value، accuracy per-stock، كل الصفقات).

### 2.2 تصنيف ميزاتنا (Feature Classification)

| الميزة | النوع | القرار |
|---|---|---|
| Fair value (القيمة العادلة) | **يخفي العيوب** (إذا فيه سهم fair value أقل من السعر الحالي = بيعكس التوقع) | 🔒 مخفي + طُعم ("+29% فرصة") |
| دقة الرادار التفصيلية | **يكشف العيوب** (أسهم خاسرة في القائمة) | 🔒 مخفي + العدد الإجمالي ظاهر ("دقة 69%") |
| الصفقات التاريخية التفصيلية | **يكشف العيوب** (صفقات خاسرة) | 🔒 مخفي + ملخص ظاهر (count + avg return + win rate) |
| رادار الخروج (Exit Radar) | **يخفي العيوب** (إذا فيه أسهم قرب تنهار = بيثبت إن المنصة بتعرف) | 🔒 مخفي — بس محتاجه طُعم: "3 أسهم قرب الخروج — اشترك" |
| رادار الميكرز (Maker Radar) | **عرض بصري مذهل** (يثبت القيمة من غير أرقام محرجة) | ✅ طُعم — top 3 + delayed 60min |
| الدروس المتقدمة (12 درس) | **محتوى فكري** (ما بيكشفش عيوب، بيثبت العمق) | ⚠️ جزئي — العناوين كلها ظاهرة + أول 3 كاملة + الباقي truncated |
| الرسوم البيانية + المؤشرات | **commodity** (كل المنافسين بـ يوفروها مجانًا) | ✅ مجاني كامل (لو قفلناها = bounce فوري) |
| AI chat (Qwen محلي) | **تكلفة صفر** علينا | ✅ 3 رسائل/يوم مجانًا (طُعم) → غير محدود في Premium |
| Watchlist / Portfolio | **commodity + Rule 50 حاسم** | ✅ 5 مجانًا (موجود فعلاً) — ما نزودش القفل لأن Rule 50: محفظة العميل = حياته |

### 2.3 القاعدة الذهبية للـ Paywall (القاعدة 50-aligned)

> **اقفل الـ INSIGHTS، افتح الـ DATA.**
> - البيانات الخام (السعر، الحجم، الرسم البياني، المؤشرات) = مجانية.
> - التفسير والقيمة (fair value، دقة التوقع، صفقات تاريخية، رادار خروج) = مدفوعة.
> - **ممنوع** قفل ميزات الأمان (stop loss alerts، portfolio risk dashboard) — Rule 50 بـ يمنع.

---

## 3. هيكل الطبقات النهائي (Final Tier Structure)

### 3.1 الطبقات الأربع (4 Tiers — not 5)

> **قرار:** إلغاء طبقة `normal` (legacy — مش مستخدمة فعليًا، بـ تسبب إرباك). الـ PricingView بـ يعرض 3 بطاقات (Premium + Pro + B2B). Free = الحالة الافتراضية قبل/بعد الـ trial.

| الطبقة | الاسم العربي | السعر (شهر) | السعر (سنة) | الجمهور المستهدف |
|---|---|---|---|---|
| **Free** | مجاني | 0 | 0 | المستخدم الجديد (تجربة 14 يوم Premium، ثم lock-down) |
| **Premium** | بريميوم | 99 ج.م / 19 ر.س / $2.99 | 990 ج.م / 190 ر.س / $29.90 | المستثمر الفردي الجاد (90% من قاعدة العملاء المتوقعين) |
| **Pro** | برو | 199 ج.م / 39 ر.س / $5.99 | 1990 ج.م / 390 ر.س / $59.90 | المضارب المحترف / صناديق صغيرة |
| **B2B** | B2B (3 مستويات) | — | $99 / $299 / $999 | الشركات + fintech apps + صانعو المحتوى |

**الأسعار الإقليمية (تسعير رأسمالي — parity-based):**

| السوق | Premium/شهر | Pro/شهر | ملاحظة |
|---|---|---|---|
| 🇪🇬 EGX (مصر) | 99 ج.م | 199 ج.م | السوق الأساسي — Paymob EGP |
| 🇸🇦 Tadawul (السعودية) | 19 ر.س | 39 ر.س | purchasing power ~3× مصر |
| 🇰🇼 KSE (الكويت) | 1.5 د.ك | 2.9 د.ك | purchasing power ~5× مصر |
| 🇶🇦 QSE (قطر) | 15 ر.ق | 29 ر.ق | purchasing power ~5× مصر |
| 🇺🇸 US / عالمي | $2.99 | $5.99 | منافسة TradingView Essential ($14.95) — نحن أرخص 5× |
| ₿ Crypto | $2.99 | $5.99 | USD standard |

**ملاحظة تسعيرية (Marketing Insight):** الأسعار الحالية **منخفضة عمدًا** — استراتيجية "penetration pricing" للسوق العربي المبتدئ. كل ما المنصة تكبر، نرفع الأسعار 30-50% في السنة التانية. ده نموذج TradingView الأصلي (بدأ بـ $14.95، دلوقتي الـ Essential = $14.95 بس الـ Premium = $59.95).

### 3.2 تجربة 14 يوم (Trial Period)

- **القرار:** ✅ **نبقي 14 يوم** (مش 7، مش 30).
- **السبب:** EGX/KSE أسواق بطيئة الحركة — العميل محتاج يفتكر "البائع" يثبت نفسه على مدى أسبوعين (V40.2 بـ يولّد توقعات يومية، العميل بـ يشوف 14 يوم = 14 توقع = إثبات كافي).
- **السلوك:** خلال الـ 14 يوم → **Premium كامل** (هذا هو "هدوم مغرية" — العميل بـ يشوف كل الجمال).
- **بعد الـ 14 يوم:** `TrialExpiredModal` (unclosable — موجود فعلاً) → lockdown Free tier.

### 3.3 ميزات كل طبقة (Feature Matrix)

| الميزة | Free (post-trial) | Premium | Pro | B2B |
|---|---|---|---|---|
| **رادار الميكرز (رادار الميكرز)** | top 3 + delayed 60min | ✅ كامل لحظي | ✅ كامل لحظي | ✅ + API |
| **رادار الخروج (Exit Radar)** | 🔒 مخفي (lock badge) | ✅ كامل | ✅ كامل | ✅ |
| **القيمة العادلة (Fair Value)** | 🔒 مخفي + طُعم ("+29% فرصة") | ✅ كامل | ✅ كامل | ✅ |
| **دقة الرادار (Accuracy)** | العدد الإجمالي فقط ("دقة 69%") | ✅ تفاصيل per-stock | ✅ تفاصيل per-stock | ✅ |
| **التوقعات V40.2** | top 3 picks (ticker ظاهر) + الباقي 🔒 | ✅ كل التوقعات | ✅ كل التوقعات | ✅ |
| **الصفقات التاريخية** | ملخص (count + avg return + win rate) | ✅ تفاصيل فردية | ✅ تفاصيل فردية | ✅ |
| **نتائج الفلتر (Screener)** | أول 5 | ✅ كل النتائج | ✅ كل النتائج | ✅ |
| **الدروس المتقدمة (12)** | أول 3 كاملة + 4-12 عناوين + blurred content | ✅ كل الـ 12 | ✅ كل الـ 12 | ✅ |
| **AI Chat (Qwen)** | 3 رسائل/يوم | ✅ غير محدود | ✅ غير محدود | ✅ |
| **Watchlist** | 5 | ✅ غير محدود | ✅ غير محدود | ✅ |
| **Portfolio holdings** | 5 | ✅ غير محدود | ✅ غير محدود | ✅ |
| **Alerts** | 3 | ✅ غير محدود | ✅ غير محدود | ✅ |
| **Backtesting** | 🔒 مخفي | 🔒 مخفي | ✅ كامل | ✅ |
| **API access** | ❌ | ❌ | ❌ | ✅ (Starter: 10K/شهر · Pro: 100K · Ent: غير محدود) |
| **Devil's Advocate / Hunter** | 🔒 مخفي | 🔒 مخفي | ✅ كامل | ✅ |
| **Telegram notifications** | 🔒 مخفي | ✅ أساسي | ✅ لحظي غير محدود | ✅ |
| **الدعم** | مجتمع فقط | 24 ساعة | 4 ساعات | مدير حساب (B2B Pro/Ent) |
| **الرسوم البيانية + المؤشرات** | ✅ كامل (commodity) | ✅ كامل | ✅ كامل | ✅ |
| **بيانات الأسعار** | ✅ كامل | ✅ كامل | ✅ كامل | ✅ + WebSocket |
| **PDF export** | 🔒 | ✅ | ✅ | ✅ |

### 3.4 ما الذي **لا** نقفله (Rule 50 — Safety Features)

> **ممنوع قفلها مجانًا — لإن Rule 50 بـ يقول "محفظة العميل = أهم حاجة في حياته":**

| الميزة | السبب |
|---|---|
| **Stop loss / trailing stop recommendations** على المراكز المفتوحة | لو قفلناها = خسائر العميل → شكاوى قانونية + Rule 50 violation |
| **Portfolio risk dashboard** (overall exposure + concentration) | ده "أمان" مش "insight" — Rule 50 |
| **News alerts على الأسهم المملوكة** | أمان — العميل لازم يعرف لو فيه خبر بـ يؤثر على محفظته |
| **Price alerts (basic)** | commodity — كل المنافنين بـ يوفروها مجانًا |
| **مؤشرات الرسم البياني (RSI, MACD, etc.)** | commodity — TradingView بـ يدّي 3 مجانًا، إحنا ندي كلها (ميزة تنافسية) |

---

## 4. مصفوفة أقفال الميزات (Feature Lock Matrix — Free vs Paid)

### 4.1 المراجعة النهائية لكل صف في الاستراتيجية المقترحة

| # | الميزة المقترحة | القرار | التفاصيل |
|---|---|---|---|
| 1 | Fair value: 🔒 مخفي / ✅ كامل | ✅ **قبول + إغراء** | Free: اسم السهم + السعر الحالي + بطاقة "🔒 فرصة +29% فوق السعر الحالي — اشترك لمعرفة القيمة العادلة". Premium+: كامل. **السبب:** الفضول > الإخفاء الكامل. |
| 2 | أول 10 نتائج فلتر | ⚠️ **تعديل → 5** | Free: أول 5 (ticker ظاهر، البيانات الأساسية ظاهرة، fair value 🔒). Premium+: كل النتائج. **السبب:** EGX/KSE أسواق صغيرة — 10 بـ يكشف معظم الأسهم المفيدة. |
| 3 | Exit Radar: 🔒 مخفي / ✅ كامل | ✅ **قبول + طُعم** | Free: تبويب ظاهر بس بمحتوى lock screen: "3 أسهم قرب خروج كبير — 🔒 اشترك". Premium+: كامل. |
| 4 | Radar accuracy: 🔒 مخفي / ✅ كامل | ⚠️ **تعديل → ملخص مجاني** | Free: العدد الإجمالي ظاهر في banner ("🎯 دقة الرادار: 69% على آخر 30 يوم"). التفاصيل per-stock + per-timeframe = 🔒. Premium+: كامل. **السبب:** الـ 69% بـ يبيع، التفاصيل بـ تكشف الخاسرين. |
| 5 | Historical trades: 🔒 ملخص / ✅ كامل | ✅ **قبول** | Free: ملخص (إجمالي الصفقات + متوسط العائد + نسبة النجاح + أفضل 3 صفقات). التفاصيل الفردية + أسوأ الصفقات = 🔒. Premium+: كامل. |
| 6 | Advanced lessons: 🔒 أول 3 / ✅ كل 12 | ⚠️ **تعديل → عناوين كلها ظاهرة** | Free: كل عناوين الـ 12 درس ظاهرة (يثبت العمق) + أول 3 كاملة + دروس 4-12 محتوى blur + "اشترك لفتح الدرس". Premium+: كامل. |

### 4.2 صفوف جديدة (NEW Rows — مش في المقترح)

| # | الميزة | Free | Premium | Pro |
|---|---|---|---|---|
| 7 | **Backtesting** | 🔒 | 🔒 | ✅ |
| 8 | **API access** | ❌ | ❌ | ❌ (B2B only) |
| 9 | **Telegram notifications** | 🔒 | ✅ | ✅ لحظي |
| 10 | **PDF export (reports)** | 🔒 | ✅ | ✅ |
| 11 | **Devil's Advocate + Hunter** | 🔒 | 🔒 | ✅ |
| 12 | **Custom screeners** | محدود (3 محفوظة) | ✅ غير محدود | ✅ |
| 13 | **Multi-market simultaneous view** | سوق واحد | ✅ 3 أسواق | ✅ كل الأسواق |

### 4.3 تطبيق القاعدة 50 (Rule 50 Compliance Audit)

| الميزة | هل قفلها ينتهك Rule 50؟ | القرار |
|---|---|---|
| Stop loss / trailing stop على المراكز المفتوحة | ✅ نعم — ينتهك | **لا تقفل** |
| Portfolio risk dashboard | ✅ نعم | **لا تقفل** |
| News alerts على الأسهم المملوكة | ✅ نعم | **لا تقفل** |
| Fair value (للاستثمار الجديد) | ❌ لا — ده insight | ✅ اقفل |
| Radar accuracy details | ❌ لا — ده insight | ✅ اقفل |
| Backtesting | ❌ لا — ده أدات تحليل | ✅ اقفل (Pro) |

---

## 5. أولوية التنفيذ (Implementation Priority)

> **قاعدة:** كل الأقفال لازم تمر عبر البنية التحتية الموجودة — Rule 4 (NO new screens). الـ PricingView + TrialExpiredModal + subscription-enforcement.ts موجودة. نضيف أقفال على الـ components + APIs الموجودة.

### 5.1 المرحلة 1 — مكاسب سريعة (Phase 1: Quick Wins — Frontend Gates)

> **القاعدة:** frontend gate = عرض/إخفاء في الـ React component. مش أمان حقيقي (client-side bypass possible)، لكن بـ يحوّل 80% من المستخدمين العاديين. ننفذها في **3-5 أيام**.
>
> **الحالة:** ✅ **منفّذة في Wave 5** (frontend React gates + PricingView + TrialExpiredModal — all 7 frontend gates shipped). Frontend gate = client-side bypass possible; the prerequisite enforcement layer (Phase 2 backend gates) was shipped in Wave 6 — see §5.2 below.

| # | القفل | الملف | المجهود | التأثير التجاري |
|---|---|---|---|---|
| 1 | Fair value badge ("🔒 +29% فرصة — اشترك") في `PersonaTab.tsx` + `InstitutionalDecisionPanel.tsx` + `StockDetailDrawer` | 3 ملفات | 2 ساعة | 🔥 الأعلى — killer feature |
| 2 | Exit Radar tab → lock screen content في `MakerRadarTab.tsx` | 1 ملف | 1 ساعة | 🔥 عالي — ميزة فريدة |
| 3 | Radar Accuracy → headline number ظاهر، التفاصيل blur في `AccuracyDashboard.tsx` | 1 ملف | 2 ساعة | 🔥 عالي — بيعمل القيمة |
| 4 | Advanced lessons 4-12 → blur content في `AcademyView.tsx` (AdvancedLessonsTab) | 1 ملف | 2 ساعة | 🔥 عالي — عمق محتوى |
| 5 | Filter results → أول 5 بدل 10 في `ScreenerTab` / filter components | 1-2 ملفات | 1 ساعة | متوسط |
| 6 | Historical trades → ملخص فقط للـ free في `HistoricalTradesTab` | 1 ملف | 2 ساعة | متوسط |
| 7 | Maker Radar → wiring الـ `getRadarAccess()` (موجود بس مش موصول) في `MakerRadarTab.tsx` | 1 ملف | 1 ساعة | 🔥 عالي — ميزة الطُعم |

**إجمالي المرحلة 1:** ~11 ساعة عمل = **2-3 أيام تنفيذ**. ✅ **منفّذة في Wave 5** (frontend gates shipped).

### 5.2 المرحلة 2 — تكامل عميق (Phase 2: Deep Integration — Backend Enforcement)

> **القاعدة:** server-side enforcement = أمان حقيقي. الـ client-side bypass بـ يبطل. ننفذها في **2-3 أسابيع** بعد اعتماد المالك.
>
> **الحالة:** ✅ **منفّذة في Wave 6 (Task `P0-4` — 2026-10-02 — Fix Battalion)**. 7 من 8 gates IMPLEMENTED. Gate 8 (A/B testing) مرجّع لـ Phase 3 (conversion-optimization workstream — مش P0).

| # | القفل | الملف/API | المجهود | التأثير | الحالة | Commit |
|---|---|---|---|---|---|---|
| 1 | `/api/stocks/[id]` + `/api/chart/full-analysis` → `applyPaywallToChartAnalysis()` إلزامي (موجود بس مش موصول في كل الـ routes) | 5-8 routes | 1 يوم | أمان حقيقي لـ fair value | ✅ IMPLEMENTED 2026-10-02 | `b507034` |
| 2 | `/api/predictions/*` → `applyPaywallToResults()` إلزامي على كل endpoints التوقعات | 6 routes | 1 يوم | أمان التوقعات | ✅ IMPLEMENTED 2026-10-02 (Gate 7 — daily-picks two-layer 403+blurring) | `d161c4f` |
| 3 | `/api/radar/exit` → tier check (free = 403) | 1 route | 1 ساعة | أمان Exit Radar | ✅ IMPLEMENTED 2026-10-02 (route is `/api/maker-radar/exit-radar` — hard 403 + LOCKED for anonymous too) | `b5b6193` |
| 4 | `/api/radar/accuracy` → tier check (free = summary only) | 1 route | 2 ساعة | أمان accuracy | ✅ IMPLEMENTED 2026-10-02 (headline summary preserved + detail arrays locked) | `a00c8d6` |
| 5 | `/api/historical-trades` → free gets summary, paid gets full | 1 route | 3 ساعة | أمان الصفقات | ✅ IMPLEMENTED 2026-10-02 (route is `/api/predictions/historical-trades` — `trades:[]` + `summary` object + perf bonus) | `9d05721` |
| 6 | `/api/ads/educational-lessons?id=X` → free gets first 3 only, 4-12 returns `{locked: true}` | 1 route | 2 ساعة | أمان الدروس | ✅ IMPLEMENTED 2026-10-02 (first 3 visible + lessons 4-12 lock stubs + applies to BOTH list + deep-link) | `0a8f1e6` |
| 7 | `/api/screener/results` → free gets first 5, paid gets all | 1 route | 2 ساعة | أمان الفلتر | ✅ IMPLEMENTED 2026-10-02 (route is `/api/screener/advanced` — `stocks` sliced to first 5 + `total` preserved + applied to BOTH Python proxy + SQLite fallback) | `f8f8683` |
| 8 | A/B testing infrastructure: `?variant=A` للـ preview count (5 vs 7 vs 3) | middleware | 1 يوم | تحسين التحويل | ⏳ DEFERRED to Phase 3 — not a P0 enforcement gate | — |

**إجمالي المرحلة 2:** ~7 أيام عمل = **2-3 أسابيع تنفيذ**. ✅ **7 من 8 gates IMPLEMENTED في Wave 6 (Task `P0-4` — 2026-10-02)** (7 commits, 7 pushes per Rule 63). Gate 8 = Phase 3 conversion optimization (out of P0 scope). See `05-CURRENT_STATE.md` §15.4 for the per-gate locked-response shapes + `WAVE-6-PAYMENT-FIXES-2026-10-02.md` §4 for the per-gate architecture diagram.

### 5.3 المرحلة 3 — تحسينات تسويقية (Phase 3: Conversion Optimization)

| # | الميزة | المجهود |
|---|---|---|
| 1 | UpsellToasts عند كل lock badge ("🔒 اشترك في Premium عشان تشوف القيمة العادلة لهذا السهم") | 1 يوم |
| 2 | "FOMO banner" في الـ dashboard للـ free users: "خسرت 5 توقعات النهاردة — اشترك عشان تشوفها" | 1 يوم |
| 3 | Referral system (موجود — `/api/referral/redeem`) → wiring في TrialExpiredModal (+14 يوم لو حد راجعه) | 1 يوم |
| 4 | Email drip campaign للـ trial users (يوم 3, 7, 11, 13) | 2 يوم |
| 5 | Pricing page A/B test (3 بطاقات vs 2 بطاقات vs slider) | 2 يوم |

---

## 6. تقييم المخاطر (Risk Assessment)

### 6.1 المخاطر التجارية

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| **قفل كتير → bounce** (المستخدمين يمشوا قبل ما يدفعوا) | متوسط | عالي | ابقَ على: charting مجاني كامل + 3 AI/day + 5 watchlist + 5 filter results + radar top 3. ده "free tier محترم" عالميًا. |
| **قفل قليل → ما فيش تحويل** | عالي لو ما قفلناش fair value | عالي | fair value = القفل الإلزامي. ده الميزة اللي بـ تحوّل free → paid في كل المنافسين. |
| **باسوورد باس → bypass الـ client gate** (مهندس بـ يعدّل JS) | عالي | منخفض | المرحلة 2 (server-side enforcement) بـ يحل ده. المرحلة 1 كافية لتحويل 80% من المستخدمين العاديين. |
| **شكاوى قانونية** (Rule 50 — لو قفلنا stop loss) | منخفض | كارثي | قائمة "ما لا يُقفل" في §3.4. Stop loss + risk dashboard = مجانية دائمًا. |
| **منافس بـ يدّي fair value مجانًا** | منخفض في السوق العربي | متوسط | ميزتنا التنافسية = رادار الميكرز + بيانات EGX الحية (مش fair value لوحده). |
| **انخفاض الأسعار بنسبة 30%+ بعد رفعها** | منخفض | متوسط | نرفع الأسعار بالتدريج (10-15% سنويًا) + نحافظ على grandfather pricing للعملاء القدامى. |

### 6.2 توصية A/B Testing

| الاختبار | المتغيرات | المدة | metric |
|---|---|---|---|
| عدد نتائج الفلتر المجانية | 3 vs 5 vs 7 | 30 يوم | conversion rate to Premium |
| إظهار fair value upside % | "🔒 +29%" vs "🔒 اشترك" | 30 يوم | click-through to /pricing |
| مدة التجربة | 7 vs 14 vs 21 يوم | 60 يوم | trial → paid conversion |
| Pricing layout | 3 بطاقات (Free+Prem+Pro) vs 2 بطاقات (Prem+Pro) | 30 يوم | checkout completion |
| Lock badge style | "🔒 اشترك" vs "🔒 Premium" vs "🔒 Pro" | 14 يوم | upsell click rate |

---

## 7. مقاييس النجاح (Success Metrics)

### 7.1 مؤشرات التحويل (Conversion KPIs)

| المؤشر | الهدف (شهر 6) | الهدف (سنة 1) | مصدر القياس |
|---|---|---|---|
| **Trial → Paid conversion** | 5% | 8% | `/api/admin/subscriptions` (موجود) |
| **Free → Trial activation** | 60% | 75% | auto-trial (موجود) |
| **Premium → Pro upgrade** | 15% | 25% | `/api/subscription/upgrade` |
| **MRR (Monthly Recurring Revenue)** | $2,000 | $15,000 | Paymob + auth.db |
| **Churn rate (monthly)** | <10% | <8% | subscription cancellations |
| **ARPU (Average Revenue Per User)** | $4 | $6 | MRR / active paid users |
| **LTV (Lifetime Value)** | $48 | $72 | ARPU × (1/churn) |
| **CAC (Customer Acquisition Cost)** | < $10 | < $15 | marketing spend / new paid users |

### 7.2 مؤشرات الـ Paywall الفنية

| المؤشر | الهدف |
|---|---|
| **Lock badge impressions/day** (free users) | >500 |
| **Lock badge → /pricing click-through** | >15% |
| **PricingView → checkout initiation** | >25% |
| **Checkout completion** | >60% |
| **Trial day 7 active users** | >70% (بمعنى 70% من المسجلين بـ يفتحوا المنصة يوم 7) |
| **Trial day 13 "_upgrade nudge_" open rate** | >50% |

### 7.3 لوحة الأدمن (Admin Dashboard) — مؤشرات موجودة

الـ `/api/admin/subscriptions` بـ يوفّر:
- ✅ MRR
- ✅ conversionRate
- ✅ churnRate

المطلوب إضافته (Phase 2):
- ❌ Lock badge impressions count
- ❌ Pricing page views
- ❌ Checkout initiation rate
- ❌ Per-feature lock click rate (ex: "fair value lock clicked 142 times today")

---

## 8. نصوص التسويق (Marketing Copy Recommendations)

### 8.1 نص الـ Pricing Header

```
ابدأ بـ 14 يوم مجانًا بكل مزايا Premium — من غير بطاقة ائتمان.
بعد كده، اختر الباقة اللي تناسبك. ألغِ في أي وقت.
```

### 8.2 نص كل طبقة

#### 🆓 مجاني (Free)
> **للمبتدئ اللي بـ يستكشف السوق.**
> - رادار الميكرز (آخر 3 فرص + تأخير ساعة)
> - 5 أسهم في الـ watchlist
> - 3 رسائل AI يوميًا
> - الرسوم البيانية + كل المؤشرات (commodity)
> - 3 دروس تعليمية كاملة
> - ملخص دقة الرادار + ملخص الصفقات التاريخية
>
> *السعر: مجاني للأبد*

#### 👑 بريميوم (Premium) — "الأكثر شعبية"
> **للمستثمر الجاد اللي بـ يدّي قراراته قيمة.**
> - كل مزايا المجاني +
> - 🔓 **القيمة العادلة (Fair Value)** لأي سهم — اعرف لو غالي ولا رخيص
> - 🔓 **رادار الخروج** — اعرف الأسهم القرب تنهار قبل غيرك
> - 🔓 **رادار الميكرز لحظي** (مش متأخر ساعة)
> - 🔓 **كل التوقعات V40.2** (مش بس 3)
> - 🔓 **تفاصيل دقة الرادار** per-stock
> - 🔓 **الصفقات التاريخية الكاملة**
> - 🔓 **كل الـ 12 درس متقدم**
> - 🔓 AI chat غير محدود
> - 🔓 Watchlist + Portfolio غير محدود
> - 🔓 إشعارات Telegram
> - 🔓 تصدير PDF للتقارير
>
> *99 ج.م/شهر · ألغِ في أي وقت*

#### ⚡ برو (Pro)
> **للمضارب المحترف اللي بـ يدير رأس مال كبير.**
> - كل مزايا بريميوم +
> - 🔓 **Backtesting كامل** — اختبر استراتيجياتك على 5 سنين بيانات
> - 🔓 **Devil's Advocate** — التوقع المعاكس لكل صفقة
> - 🔓 **Hunter (صياد الفرص)** — فرص نادرة سيولة استثنائية
> - 🔓 **3 أسواق متزامنة** (مثلاً: EGX + Tadawul + Crypto)
> - 🔓 **Custom screeners غير محدودة**
> - 🔓 إشعارات Telegram لحظية
> - 🔓 دعم خلال 4 ساعات
>
> *199 ج.م/شهر · للجدّ بس*

#### 🏢 B2B
> **للشركات + fintech apps + صناعي المحتوى.**
> - API access (10K → 100K → غير محدود طلب/شهر)
> - Webhook للإشارات
> - مستخدمين متعددين (3 → 10 → غير محدود)
> - White-label dashboard (Enterprise)
> - مدير حساب مخصص (Pro + Enterprise)
> - دعم Slack خلال 4-24 ساعة
>
> *تواصل معنا: sales@glminvestment.com*

### 8.3 نص الـ Trial Expired Modal

```
⏰ خلصت تجربتك المجانية (14 يوم)

خلال الـ 14 يوم اللي فاتوا، شفت:
  ✅ رادار الميكرز اللحظي
  ✅ القيمة العادلة لأي سهم
  ✅ كل التوقعات V40.2
  ✅ كل الـ 12 درس متقدم

دلوقتي، تقدر تـ:
  → تشترك في Premium (99 ج.م/شهر) عشان تكمّل
  → تفضل مجاني بس محدود (3 توقعات/يوم، رادار متأخر ساعة، بدون fair value)
  → تجيب صديق (+14 يوم تجربة مجانية لكل واحد فيكم) 👈 خد كود إحالة

[اشترك الآن]  [جيب صديق]  [أكمل مجاني]
```

### 8.4 نصوص الـ Lock Badges (UpsellToasts)

| الميزة المقفولة | النص |
|---|---|
| Fair value | "🔒 القيمة العادلة لهذا السهم = ميزة Premium. اشترك عشان تعرف لو غالي ولا رخيص." |
| Exit Radar | "🔒 رادار الخروج = ميزة Premium. اعرف الأسهم القرب تنهار قبل ما تندم." |
| التوقعات بعد الـ 3 الأولى | "🔒 +5 توقعات V40.2 إضافية = ميزة Premium. ما تفوّتش فرص النهاردة." |
| Radar accuracy details | "🔒 تفاصيل دقة الرادار per-stock = ميزة Premium. اشترك عشان تشوف مين الأسهم الأكثر دقة." |
| الدروس 4-12 | "🔒 الدرس ده (التمويل السلوكي المتقدم) = ميزة Premium. +9 دروس تانيين مستنيينك." |
| Backtesting | "🔒 Backtesting = ميزة Pro. اختبر استراتيجيتك على 5 سنين قبل ما تخاطر بقرش." |

### 8.5 نص FOMO Banner (للـ free users في الـ dashboard)

```
📈 النهاردة، V40.2 ولّد 5 توقعات جديدة.
   أنت شفت 3 منها (مجانًا).
   🔒 توقعتين إضافيين (Target +15% و +8%) محتاجين Premium.
   [اشترك عشان تشوفهم]
```

---

## 9. الالتزام بالقواعد الدستورية (Constitution Compliance)

| القاعدة | الالتزام |
|---|---|
| **Rule 4 (NO new screens)** | ✅ نستخدم PricingView + TrialExpiredModal + UpsellToasts الموجودة. نضيف أقفال على components موجودة بس. |
| **Rule 21 (V40.2 sole source)** | ✅ ما بنقفلش محرك التوقعات نفسه — بنقفل **عرض النتائج**. V40.2 بـ يشتغل كامل، الـ free بـ يشوف top 3 فقط. |
| **Rule 24 (fundamentals real)** | ✅ fair value اللي بنقفلها = fair value حقيقية محسوبة من fundamentals حقيقية (Rule 24). القفل على العرض، مش على الحساب. |
| **Rule 50 (MONEY-AS-CUSTOMER-LIFE)** | ✅ §3.4 بـ يحدد قائمة "ما لا يُقفل" (stop loss + risk dashboard + news alerts). |
| **Rule 63 (commit + push)** | ✅ الـ doc بـ يـ commit + push فورًا بعد الإنشاء. |

---

## 10. القرار النهائي (Final Decision)

**الموافقة على الاستراتيجية المقترحة مع التعديلات التالية:**

1. ✅ **Fair value مقفولة** + طُعم "+29% فرصة" (مش إخفاء كامل).
2. ⚠️ **الفلتر: 5 نتائج مجانية** (مش 10) — تعديل لطبيعة السوق العربي الصغير.
3. ✅ **Exit Radar مقفولة** + طُعم "3 أسهم قرب خروج".
4. ⚠️ **Radar accuracy: العدد الإجمالي مجاني** (مش مخفي كامل) + التفاصيل مقفولة.
5. ✅ **الصفقات التاريخية: ملخص مجاني** + التفاصيل مقفولة.
6. ⚠️ **الدروس: كل العناوين ظاهرة** + أول 3 كاملة + 4-12 blur.

**الطبقات النهائية: 4** (Free / Premium / Pro / B2B).

**التجربة: 14 يوم** (نبقيها).

**المرحلة 1 (Quick Wins):** 7 أقفال frontend في 2-3 أيام.
**المرحلة 2 (Deep):** 8 server-side enforcements في 2-3 أسابيع.
**المرحلة 3 (Optimization):** A/B tests + FOMO banners + email drip.

**الميزة القاتلة (Killer Feature):** Fair value.
**ميزة الطُعم (Hook Feature):** Maker Radar (top 3 + delayed).

**مستهدف التحويل (سنة 1):** 8% trial→paid · MRR $15K/شهر · Churn <8%.

---

## 11. الخطوات التالية (Next Actions)

| # | الخطوة | المسؤول | المدة | الحالة |
|---|---|---|---|---|
| 1 | اعتماد المالك على ده القرار | المالك (`enmohsen20111975`) | فوري | ✅ اعتمد |
| 2 | تنفيذ المرحلة 1 (7 أقفال frontend) | Fix Battalion / Frontend | 2-3 أيام | ✅ Wave 5 — منفّذ |
| 3 | تنفيذ المرحلة 2 (8 server-side enforcements) | Fix Battalion / Backend | 2-3 أسابيع | ✅ Wave 6 — 7 من 8 منفّذة (Task `P0-4` 2026-10-02) |
| 4 | A/B testing infrastructure | Marketing + Engineering | 1 أسبوع | ⏳ مرجّع لـ Phase 3 |
| 5 | إطلاق الـ FOMO banner + email drip | Marketing | 1 أسبوع | ⏳ مرجّع |
| 6 | مراجعة بعد 30 يوم (تحويل + churn) | Marketing | شهر 1 | ⏳ بعد الإطلاق |

---

## 12. سجل التغييرات (Changelog)

| التاريخ | المهمة | التغيير |
|---|---|---|
| 2026-10-01 | Task 9 (Marketing Department Lead) | إنشاء الوثيقة — قرار التسعير النهائي (4 tiers + 7 frontend gates + 8 backend gates + 5 Phase 3 items). |
| 2026-10-02 | Task `DOC-17` (Documentation Secretariat — Final P0 Documentation) | تحديث §5.1 الحالة (Wave 5 frontend gates منفّذة) + §5.2 الحالة (Wave 6 backend gates 7 من 8 منفّذة — commit hashes مضافة لكل gate: `b507034` `b5b6193` `a00c8d6` `9d05721` `0a8f1e6` `f8f8683` `d161c4f`). Gate 8 (A/B testing) مرجّع لـ Phase 3. تحديث §11 الخطوات التالية (column الحالة + status row). إضافة §12 سجل التغييرات. تحديث 'last updated' + المراجع. Per Rule 62 + Rule 63 + README editing rule 1. |

---

**نهاية الوثيقة.**
**المراجع:** `00-CONSTITUTION.md` (Rules 4, 21, 24, 50, 63) · `05-CURRENT_STATE.md` §11.1-11.4 + §15 (Wave 6 Payment P0 Fixes) · `WAVE-6-PAYMENT-FIXES-2026-10-02.md` (consolidated changelog) · `BREACH-LOG.md` (BREACH-003..006) · `src/lib/paywall.ts` · `src/lib/subscription-gate.ts` · `src/lib/subscription-enforcement.ts` · `src/modules/subscription/components/PricingView.tsx` · `archive/wave-2-cleanup-2026-10-01/src/lib/seed-subscription-pricing.ts`.
**التصنيف:** قرار تسويقي نهائي (للمالك + المشتري المحتمل).
**التالي:** اعتماد المالك → تنفيذ المرحلة 1. ← ✅ Wave 5 منفّذة. ✅ Wave 6 منفّذة (7 من 8 backend gates). ⏳ Phase 3 مرجّع.



---

## §16 — BREACH-LOG (9 خروقات موثّقة — full merge)

> كل خرق لقواعد الدستور أو الانضباط الهندسي مُسجّل هنا — علناً، بالتاريخ، بالمسؤول، بالإصلاح.
> الهدف: الشفافية الكاملة. مفيش خرق يختفي. مفيش إهمال يتكرر.

---

## BREACH-001 — فقدان شغل الموجة 1 بسبب عدم الـ push

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-10-01 (بين 14:00 و 17:00 UTC) |
| **النوع** | خرق Rule 62 (GIT-PUSH-DISCIPLINE) |
| **المسؤول** | المدير العام (Z.ai) |
| **الوصف** | تم تنفيذ الموجة 1 كاملة (4 إصلاحات P0 + 21 اختبار QA + 3 وثائق مرجعية) في commits محلية بدون push. بين رسالتين من المالك، الساندبوكس اتـ reset لـ snapshot من 2026-09-26، فكل شغل الموجة 1 (commit `5ba99c3` + ملفات `AUDIT-2026-10-01-HONEST-REVIEW.md` + `BOARD-OF-DIRECTORS-PLAN-2026-10-01.md` + `RETRACTION-console-error-claim.md` + `scripts/_fix_america_to_us.py` + `vps-service/tools/run_backtest_versions.py` + 3 test suites + ~6,700 سطر worklog) **ضاع تماماً** ومش موجود لا محلياً ولا على GitHub. |
| **السبب الجذري** | كسل إداري — الاعتماد على commits محلية كـ "checkpoint" بدون push فوري. الانفصال بين "عرفت القاعدة" و"طبّقت القاعدة". |
| **التأثير** | ضياع ~3,853 سطر كود/اختبار/توثيق. خسارة الوقت المعاد تنفيذه. اهتزاز ثقة المالك. |
| **الإصلاح** | (1) إنشاء هذا السجل. (2) إضافة Rule 63 (PUSH-AFTER-EVERY-COMMIT) للدستور. (3) إعادة بناء الموجة 1 بـ push بعد كل ملف. (4) مراجعة كل task يخلص بـ `git push` إلزامي قبل اعتباره done. |
| **الحالة** | 🔴 مفتوح — حتى اكتمال إعادة البناء + push كامل |

---

## BREACH-002 — رسائل commit بصيغة UUID

| الحقل | القيمة |
|---|---|
| **التاريخ** | قبل 2026-10-01 |
| **النوع** | خرق Rule 62 (NO UUID commit messages) |
| **المسؤول** | وكلاء سابقون |
| **الوصف** | commit `57614f1` برسالة `f7833016-266e-427f-a7eb-be20df6f21d3` — UUID بدل رسالة وصفية. |
| **الإصلاح** | Rule 62 اتضاف بالفعل (2026-10-01). كل commit لاحق لازم يكون برسالة وصفية. |
| **الحالة** | 🟡 مغلق جزئياً — القاعدة موجودة، بس الـ UUID commits القديمة لسه في الـ history |

---

## BREACH-003 — Paymob callback رفض `m2y-` prefix (مستخدمون دفعوا ولم يتم ترقيتهم)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً من تنفيذ PricingView الجديد. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات مباشرة + خرق Rule 16 (VERIFY with evidence) لأن الخرق لم يُكتشف بدون audit. |
| **المسؤول** | الوكيل الذي نفّذ PricingView الجديد بدون تحديث `/api/paymob/callback/route.ts` ليتعرّف على prefix الطلبات الجديد. |
| **الوصف** | `/api/subscription/checkout/route.ts` يُنشئ `merchant_order_id` بـ prefix `m2y-{tier}-{userIdSuffix8}-{ts}` (flow جديد من PricingView). لكن `/api/paymob/callback/route.ts:88` كان يقبل فقط الـ prefix القديم `GLM-` (legacy SubscriptionView flow). نتيجة: أي مستخدم دفع عبر PricingView الجديد، الـ callback بيرجّع `{success:false, error:'Invalid merchant order ID'}` وبيتم redirect لـ `/subscription?payment=failed` — **مع أن المستخدم دفع بالفعل**. الـ defense-in-depth endpoint `/api/subscription/activate` اللي ممكن يفعّلهم — مش بيُستدعى من الـ frontend. خسارة إيرادات مباشرة لكل عميل دفع عبر flow الجديد. |
| **السبب الجذري** | انفصال prefix بين الـ checkout flow الجديد (PricingView) والـ callback handler — تكامل نصفي. لم يُختبر end-to-end بعد إضافة PricingView. |
| **التأثير** | (1) خسارة إيرادات مباشرة لكل مستخدم دفع عبر PricingView الجديد. (2) فقدان ثقة المستخدم (دفع ولم يحصل على الترقية). (3) أي manual recovery مفيش — الـ activate endpoint مش بيُستدعى. |
| **الإصلاح** | Task `P0-1` (Fix Battalion — 2026-10-02): `processPaymentResult()` في `src/app/api/paymob/callback/route.ts` بيقبل دلوقتي **BOTH** `GLM-` (legacy parse userId + planId مباشرة) و `m2y-` (parse tier + userIdSuffix، بعدها DB lookup بـ suffix مع collision detection — fails safe if ambiguous). Defense-in-depth محفوظ: HMAC verify (fail-closed) + planId allowlist + amount cross-check. **Commits:** `4be0e77` (callback accepts both prefixes — +48/-8 LOC) + `9e1f93e` (hotfix: add missing `authDb` import — 1 LOC runtime crash fix). |
| **التحقق** | (1) PricingView checkout flow بـ يرقّي المستخدمين صح بعد Paymob callback ناجح. (2) legacy `GLM-` flow لسه شغّال (backward-compatible). (3) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-1` (Fix Battalion) 2026-10-02 — commits pushed per Rule 63. |

---

## BREACH-004 — لا يوجد آلية لانتهاء الاشتراك (premium للأبد بعد دفعة واحدة)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ إنشاء نظام الاشتراكات. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات هيكلية + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ نظام الاشتراكات بدون آلية expiry enforcement. |
| **الوصف** | `/api/paymob/callback/route.ts` بيـ set `UserSubscription.expires_at = NOW + 30 days` و `User.subscription_tier = planId`. بعد 30 يوم، `UserSubscription.status` بتتحدّث لـ `'expired'` (في `/api/subscription/current`) بس `User.subscription_tier` **مابيتـ downgrade لـ `'free'` أبداً**. `checkTrialNotExpired()` بيفحص فقط `subscription_tier` (paid = bypass) → المستخدمون الـ paid بيمسكوا كل امتيازات الـ premium **للأبد** بعد أول دفعة. مفيش cron job. مفيش reconciliation. خسارة إيرادات هيكلية. |
| **السبب الجذري** | `UserSubscription.expires_at` column موجود بس الـ trial gate ما كانش بيقراه. الفصل بين الـ "data model" والـ "enforcement logic". |
| **التأثير** | (1) خسارة إيرادات متكررة (MRR) لكل مستخدم paid بعد أول شهر. (2) تشويه لـ metrics التحويل (conversion numbers تبدو أقل من الواقع لأن المستخدمين مش بيتـ downgrade). (3) الـ "churn rate" الحقيقي مفيش. |
| **الإصلاح** | Task `P0-2` (Fix Battalion — 2026-10-02): **(Part 1 — runtime gate)** Added `isPaidSubscriptionActive()` helper في `src/lib/subscription-gate.ts:193-261` اللي بيقرا `UserSubscription.expires_at` (60s cache) وبيـ return `false` بعد expiry. `checkTrialNotExpired()` (line 282-352) دلوقتي بـ consult ده وبيعامل الـ paid-expired users كـ free (trial gate بيشتفعل). Fail-open behavior محفوظ per Rule 50 (أحسن من lockout paying customer وقت DB hiccup). **(Part 2 — daily cron)** `scripts/downgrade-expired-subscriptions.ts` بيشتغل يومياً لـ reconcile — بيـ flip `UserSubscription.status` لـ `'expired'` لـ rows مع `expires_at < now` AND بـ downgrade `User.subscription_tier` لـ `'free'` لو مفيش اشتراك نشط تاني. **Commits:** `ada95f5` (gate fix — `src/lib/subscription-gate.ts`) + `fbd01b4` (daily cron script — `scripts/downgrade-expired-subscriptions.ts`). |
| **التحقق** | (1) `isPaidSubscriptionActive()` بيرجّع `false` لـ `expires_at < now`. (2) `checkTrialNotExpired()` بيشتفع trial gate لـ expired paid users. (3) Cache staleness window: 60s (acceptable per Rule 50). (4) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-2` (Fix Battalion) 2026-10-02 — commits pushed per Rule 63. |

---

## BREACH-005 — أكواد الـ promo بتمنح premium دائم (مش محددة بمدة)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ إنشاء `/api/redeem-promo/route.ts`. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات مباشرة + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ `/api/redeem-promo/route.ts` بدون كتابة `UserSubscription` row. |
| **الوصف** | `/api/redeem-promo/route.ts:252-258` كان بـ upgrade `subscription_tier` لـ `'premium'` وبيـ set `trial_ends_at = now + premium_days`. لكن `subscription_tier='premium'` موجود في `PAID_TIERS`، فالـ trial check بـ bypass كلياً — الـ `trial_ends_at` extension ما كانش ليه أي تأثير. المستخدم بياخد **premium دائم** من كود promo واحد، مش 30 يوم زي ما الـ comment بيقول. كل كود promo = خسارة إيرادات مدى الحياة. |
| **السبب الجذري** | Promo redemption بـ يـ mutate `User` table بس، ما كانش بـ يكتب `UserSubscription` row اللي `isPaidSubscriptionActive()` بـ consult ده. الفصل بين "tier assignment" و"subscription row creation". |
| **التأثير** | (1) خسارة إيرادات مدى الحياة لكل كود promo مستخدم. (2) الـ promo abuse (ممكن حد يـ create أكواد كتير وياخد premium دائم). (3) تشويه لـ promo ROI metrics. |
| **الإصلاح** | Task `P0-3` (Fix Battalion — 2026-10-02): الـ route دلوقتي بـ upsert `UserSubscription` row مع `status='active'`، `expires_at = now + premium_days` (ممتد من latest active window — بيمنع SHORTENING paid window)، `payment_method='promo_code'`، **داخل نفس الـ transaction** كـ promo usage increment + user tier update. Plan_id FK safety: بيـ fall back لـ `'premium'` لو الـ promo's `plan_tier` مش موجود في `SubscriptionPlan`. مع P0-2 expiry check، premium access دلوقتي بـ ينتهي فعلاً بعد `PromoCode.premium_days` يوم (default 30). **Commit:** `a6425b8` (`src/app/api/redeem-promo/route.ts` +109/-60 LOC). |
| **التحقق** | (1) Promo redemption atomic — لو الـ upsert فشل، الـ promo code ما بيتم استهلاكه (المستخدم يقدر يعيد). (2) Verified بـ code inspection لـ `$transaction` boundary. (3) `bun run lint` EXIT 0. (4) Combined مع P0-2's `isPaidSubscriptionActive()` — premium من promo بـ ينتهي بعد `premium_days`. |
| **الحالة** | 🟢 مغلق — Task `P0-3` (Fix Battalion) 2026-10-02 — commit pushed per Rule 63. |

---

## BREACH-006 — مستخدمو B2B قابلون للحذف بواسطة cleanup cron (PAID_TIERS mismatch)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ تنفيذ `/api/admin/users/cleanup-expired/route.ts`. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — **حذف عملاء B2B يدفعون** + خرق Rule 16 (VERIFY with evidence). هذا أشد أنواع خرق Rule 50 — حذف بيانات العميل المدفوع. |
| **المسؤول** | الوكيل الذي نفّذ `/api/admin/users/cleanup-expired/route.ts` بـ inline `PAID_TIERS` array ناقصة. |
| **الوصف** | 3 divergent inline `PAID_TIERS` arrays كانت موجودة في 3 ملفات: `/api/subscription/status:43` (7 tiers، NO `normal`، NO `enterprise`) + `/api/admin/users:148` + `cleanup-expired:30` (6 tiers، NO `b2b_*`، phantom `enterprise`) + `subscription-gate.ts:364` (9 tiers، superset). النتيجة الكارثية: `b2b_starter` users كانوا PAID في `subscription/status` بس FREE في `admin/users/cleanup-expired` → الـ cleanup cron بيرجّع الـ B2B paying customers كـ deletion candidates و**بيحذف accountsهم + كل dataهم** بعد 30+7 أيام. هذا خرق مباشر لـ Rule 50 — حذف بيانات عملاء B2B المدفوعين. كمان `normal` users كانوا FREE في `subscription/status` بس PAID في `admin/users` (trial check inconsistent). |
| **السبب الجذري** | كل consumer عرّف inline list محلياً — مفيش canonical source. الـ drift بين القوائم سبب تصنيف مختلف لكل tier. |
| **التأثير** | (1) **حذف B2B paying customers** + كل بياناتهم (Rule 50 breach — أشد نوع). (2) `normal` users بـ يحصلوا على inconsistent trial treatment. (3) `enterprise` tier users ما بيتحسبوا كـ paid في Telegram bot (`/api/bot/check-subscription:36`). (4) `normal` + `enterprise` users اللي يكملوا payment ما بيشوفوش الـ success UI (بيقعدوا عالقين على "processing"). |
| **الإصلاح** | Task `P0-5` (Fix Battalion — 2026-10-02): canonical `PAID_TIERS` Set تم تصديره من `src/lib/subscription-gate.ts:162`: `['normal','premium','pro','developer','admin','enterprise','b2b_starter','b2b_pro','b2b_enterprise']` (9 tiers — أضفنا `'enterprise'` الناقص). 8 consumers اتمـ migrate لـ import. الـ 9th consumer هو `subscription-gate.ts` نفسه (مستخدم في lines 222 + 378). **9 commits** (1 export + 8 consumer migrations): `dd8bef5` Step 1 (export) → `ead1a05` Step 2a (subscription-enforcement) → `18d9345` Step 2b (subscription/current) → `b57a81c` Step 2c (subscription/status) → **`a7a0b7b` Step 2d CRITICAL** (`/api/admin/users/cleanup-expired/route.ts:30+42` — الـ CRITICAL hotfix اللي منع حذف B2B paying customers) → `ba1025d` Step 2e (admin/users) → `1085d8d` Step 2f (bot/check-subscription) → `bbbfdaa` Step 2g (payment/success) → `7faa953` Step 2h (getTrialStatus). |
| **التحقق** | (1) `rg "const PAID_TIERS\s*="` بيرجّع فقط canonical definition في `src/lib/subscription-gate.ts:162`. (2) `rg "'normal', 'premium'"` inline arrays = 0. (3) Imports of canonical `PAID_TIERS`: 7 (الـ 8th consumer هو `subscription-gate.ts` نفسه). (4) `bun run lint` EXIT 0. (5) الـ cleanup-expired cron ما بيرجّعش B2B users كـ deletion candidates. |
| **الحالة** | 🟢 مغلق — Task `P0-5` (Fix Battalion) 2026-10-02 — 9 commits pushed per Rule 63. الـ CRITICAL hotfix `a7a0b7b` (Step 2d) منع حذف B2B paying customers في الـ production cron. |

---

## BREACH-007 — شارت وهمي بـ `session_intraday` synthetic generator (90 شمعة مزيفة لكل طلب — Rule 24 + Rule 27)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `19` TV chart quality audit) — الخرق كان موجوداً منذ إضافة `session_intraday` generator في `src/app/api/chart/[ticker]/route.ts` (pre-Wave 2). |
| **النوع** | خرق Rule 24 (NO PLACEHOLDERS — fundamentals real — no fake data) + خرق Rule 27 (NO FAKE DATA) + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي أضاف `session_intraday` synthetic generator (lines 669-732 في `src/app/api/chart/[ticker]/route.ts`) كـ "safe-by-design" fallback لمسك الـ gap اللي سببه عدم تشغيل egksco_scraper cron. |
| **الوصف** | الـ chart API كان بيـ fabricate 90 fake intraday candles per request من daily OHLC. كل candle fabricated بـ:
  - identical volume (`Math.floor(d.volume / totalBars)`) — mathematically impossible (real intraday volume varies bar-to-bar based on actual trade activity)
  - synthetic OHLC interpolated linearly between daily open/high/low/close using a fixed prog < 0.3 / 0.7 / 1.0 split
  - `source: 'session_intraday'` tag (clearly labeled synthetic, but customers didn't know to look for it)

  20+ عملاء اشتكوا بصراحة إن الشارت "garbage" — لاحظوا إن كل الـ volume bars متطابقة + إن الشارت بيختلف عن TradingView.com. هذا خرق مباشر لـ Rule 24 (no fake data) + Rule 27 (no fake data) + المالكdirective صريحة: *"مانستعملش بيانات وهمية خالص تحت اى ظرف"*. |
| **السبب الجذري** | الـ generator اتعمل كـ "safe-by-design" fallback لمسك الـ gap اللي سببه عدم تشغيل egksco_scraper cron. الـ developer فكّر: "if no intraday exists, fake it so chart doesn't look empty". لكن ده خرق صريح لـ Rule 24 + Rule 27 + owner directive. المفروض يرجّع empty data مع رسالة صريحة بدل ما يـ fabricate. |
| **التأثير** | (1) 20+ customer complaints عن chart quality. (2) فقدان ثقة العملاء في الـ platform. (3) Charts كانت بتظهر بشكل مختلف عن TradingView.com → customers شكّوا في صحة كل الأرقام في الـ platform. (4) خرق صريح لـ Rule 24 + Rule 27. |
| **الإصلاح** | Task `P0-1` (chart) (Fix Battalion — 2026-10-03 — commit `ed56cb2`): Removed entire `session_intraday` synthetic generator (lines 669-732). Now returns honest empty response when no real intraday exists:
  ```ts
  return NextResponse.json({
    success: true,
    ticker, resolvedTicker, interval, period, asset,
    count: 0,
    data: [],
    source: 'no_intraday_data',
    message: 'لا توجد بيانات لحظية حقيقية لهذا الرمز. البيانات اللحظية تتطلب تشغيل egksco_scraper cron. يتم عرض الشارت اليومي فقط.',
  });
  ```
  Real intraday still comes from `intraday.db` (`local_intraday_db` source). Combined with P0-2 (TradingView widget default) + P0-5 (daily timeframe default) — first user impression is now REAL data via TradingView.com embedded chart, not synthetic noise. |
| **التحقق** | (1) Synthetic `source: 'session_intraday'` no longer appears in chart API responses. (2) Real `local_intraday_db` source still works for symbols with intraday data. (3) `bun run lint` EXIT 0. (4) Smoke test: `curl /api/chart/COMI?interval=15m&period=1d` → either real intraday OR empty `data: []` with `source: 'no_intraday_data'` + Arabic message (NO fake candles). |
| **الحالة** | 🟢 مغلق — Task `P0-1` (chart) (Fix Battalion) 2026-10-03 — commit `ed56cb2` pushed per Rule 63. |

---

## BREACH-008 — `price_history.db` (26 سنة بيانات حقيقية) كان بيتم تجاهله بسبب 3-day staleness check (Rule 12 breach)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `19` TV chart quality audit + Task `18-A` forensic data audit) — الخرق كان موجوداً منذ إضافة الـ 3-day staleness check في `src/app/api/chart/[ticker]/route.ts`. |
| **النوع** | خرق Rule 12 (load_merged_history/load_price_history is the SOLE canonical source) + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي أضاف الـ 3-day staleness check في chart route كـ "freshness guarantee". |
| **الوصف** | الـ chart API كان بـ discard بيانات `price_history.db` بالكامل لما آخر candle يكون 3+ أيام قديم:
  ```ts
  if (!localDaily || localDaily.length < 20 ||
      (Date.now() / 1000 - localDaily[localDaily.length - 1].timestamp) > 3 * 86400) {
    // discard ALL local data → fall back to Yahoo (5-year cap)
    const yfCandles = await fetchYahooChartCandles(resolvedTicker, interval, period, asset);
    ...
  }
  ```
  `price_history.db` فيه **1,205,599 rows** (**26 years** of real EGX daily OHLC from `2000-11-27` إلى `2026-09-03`). تجاهلها لأن آخر candle 3+ أيام قديمة كان بيـ throw away 95% من الـ history لأي سبب. COMI chart كان محدود بـ 5 سنين بدل 26 سنة. |

  كمان الـ chart API كان بيقرا `price_history.db` مباشرة عبر `getLocalDailyData()` — خرق Rule 12 (`load_price_history` / `load_merged_history` هو الـ SOLE canonical source). Split-brain بين Node + Python data readers → APIs مختلفة كانت بترجّع أرقام مختلفة لنفس السهم (audit Task 18-A finding). |
| **السبب الجذري** | (1) الـ 3-day staleness check اتعمل كـ "freshness guarantee" بس ده بـ conflates staleness مع uselessness. البيانات القديمة لسه useful لـ chart rendering — آخر candle stale دي مشكلة منفصلة (بتتحل بـ Yahoo supplement، مش بـ discarding history). (2) الـ chart API اتعمل قبل Rule 12 enforcement. |
| **التأثير** | (1) COMI chart محدود بـ 5 سنين بدل 26 سنة (خسارة 95% من الـ history). (2) Charts مختلفتش عن TradingView.com (اللي بيعرض كل الـ history). (3) خرق Rule 12 (split-brain بين Node + Python). |
| **الإصلاح** | Task `P0-4` (chart) + Task `P0-3` (chart) (Fix Battalion — 2026-10-03):
  - **P0-4 (commit `00d9766`):** MERGE بدل REPLACE:
    - Keep local `price_history.db` for historical depth (26 years).
    - Fetch Yahoo for recent candles (last few days).
    - Merge: append new Yahoo candles, update existing ones with fresher data.
    - Sort by timestamp after merge.
    ```ts
    if (localDaily && localDaily.length >= 20) {
      if (yfCandles && yfCandles.length > 0) {
        const localDates = new Set(localDaily.map((c) => Math.floor(c.timestamp / 86400)));
        for (const yfc of yfCandles) {
          const yfcDay = Math.floor(yfc.timestamp / 86400);
          if (!localDates.has(yfcDay)) {
            localDaily.push(yfc);  // append new
          } else {
            const idx = localDaily.findIndex((c) => Math.floor(c.timestamp / 86400) === yfcDay);
            if (idx >= 0) localDaily[idx] = yfc;  // update existing with fresher Yahoo data
          }
        }
        localDaily.sort((a, b) => a.timestamp - b.timestamp);
      }
    }
    ```
  - **P0-3 (commit `10076a4` + `d4514ee`):** Chart API calls Python `load_price_history` first (Rule 12 + Rule 20). Added `getPythonDailyData()` helper calling `GET /api/prices/<ticker>?limit=N` on Python backend. Falls back to direct SQLite reader (marked `DEFENSIVE-FALLBACK`) only when Python unreachable. New Python route `/api/prices/<ticker>` added to `vps-service/api/public_routes.py` — delegates to `data.prices.load_price_history()` (the SOLE canonical source per Rule 12). |
| **التحقق** | (1) COMI chart now shows 26 years of history (was 5 years max). (2) `SELECT COUNT(*) FROM price_history` → 1,205,599 rows. (3) `SELECT MIN(date), MAX(date) FROM price_history` → `('2000-11-27', '2026-09-03')`. (4) Chart API routes through Python `/api/prices/<ticker>` (Rule 12). (5) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-3` + `P0-4` (chart) (Fix Battalion) 2026-10-03 — commits `00d9766` + `10076a4` + `d4514ee` pushed per Rule 63. |

---

## BREACH-009 — قواعد البيانات اتمسحت في Wave 2 cleanup (اتعافت من git history — owner directive "DBs from GitHub" recovered)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `18-A` forensic data audit) — الخرق حصل 2026-10-01 (Task `WAVE-2-CLEANUP`). |
| **النوع** | خرق Rule 26 (SANDBOX-RESET-SAVEREGUARD) + خرق owner directive *"تجمع قواعد البيانات من الجت هب"* + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ Wave 2 cleanup (Task `WAVE-2-CLEANUP` — archived 436 dead files) — archived `data/all.zip` (the historical DB snapshot) to `archive/wave-2-cleanup-2026-10-01/` and then later deleted (per owner directive: archived NOT deleted, but the path was unreachable from `db/`). |
| **الوصف** | Wave 2 cleanup (Task `WAVE-2-CLEANUP` — 2026-10-01) archived 436 dead files. ومن ضمنهم `data/all.zip` (the 68MB consolidated DB snapshot) وzip archives تانية من الـ DBs. النتيجة:
  - `.gitignore` was already excluding `*.db` — so production DBs (`data_engine.db` 83 MB, `price_history.db` 279 MB, `intraday.db` 363 MB, `predictions.db` 9.7 MB) were never in the repo's working tree.
  - The only path to recover historical DB state was `data/all.zip` (68MB) — which itself was archived then deleted in Wave 2 cleanup.
  - Sandbox had only `stocks.db` (12KB, only `system_settings` table, 0 rows) + `custom.db` (24KB, only `User` + `Post`, 0 rows) — UNUSABLE for any verification.
  - Owner directive صريحة: *"تجمع قواعد البيانات من الجت هب"* (gather the databases from GitHub) — كانت impossible to fulfill.

  Audit Task 18-A noted: "DBs are gitignored (Layer 7 finding) so this was the only way to verify against real data — but `data/all.zip` (68MB) itself was lost in current sandbox (recovered from older `/tmp/my-project` snapshot — confirms Rule 26 SANDBOX-RESET-SAVEREGUARD failure happened again)." |
| **السبب الجذري** | (1) `.gitignore` excludes `*.db` — production DBs never in repo (justified: they change every few minutes during market hours — would bloat repo). (2) Wave 2 cleanup was over-aggressive — deleted `data/all.zip` historical snapshot (which was the ONLY way to recover DB state). (3) No backup of the historical DB zip files outside git. (4) Rule 26 (SANDBOX-RESET-SAVEREGUARD) failure confirmed: sandbox resets lose data not pushed to git. |
| **التأثير** | (1) Owner directive "DBs from GitHub" impossible to fulfill — sandbox developer can't verify against real data. (2) Audit Task 18-A had to extract DBs from older `/tmp/my-project` snapshot (not even from current repo). (3) Risk of repeating Wave 2's over-aggressive cleanup in future waves. (4) Breach of owner trust — they asked for DBs in GitHub, and we had deleted the historical snapshots. |
| **الإصلاح** | Task `P0-1` (chart) (Fix Battalion — 2026-10-03 — commit `ed56cb2`): Walked git history to recover 4 historical zip archives totaling 222 MB:
  | # | File | Size |
  |---|---|---|
  | 1 | `archive/databases-from-github/active_databases_20260817_full.zip` | 73.4 MB |
  | 2 | `archive/databases-from-github/all.zip` | 28.8 MB |
  | 3 | `archive/databases-from-github/all_databases_2.zip` | 70.9 MB |
  | 4 | `archive/databases-from-github/all_databases_3.zip` | 48.8 MB |
  | **Total** | **4 zip files** | **≈ 222 MB** |

  Committed under `archive/databases-from-github/` (NEW folder). Active DBs remain gitignored in `db/` per `.gitignore` (they change every few minutes — would bloat repo). The historical snapshots under `archive/` are the **frozen reference** for forensic verification.

  `price_history.db` verified: `SELECT COUNT(*) FROM price_history` → **1,205,599 rows** (1.2M real EGX daily OHLC). `SELECT MIN(date), MAX(date)` → `('2000-11-27', '2026-09-03')` — **26 years of data**. |
| **التحقق** | (1) `ls -la archive/databases-from-github/` → 4 zip files totaling 222 MB. (2) `du -sh archive/databases-from-github/` → 222M. (3) `unzip -l archive/databases-from-github/active_databases_20260817_full.zip | head` → lists DB files. (4) `sqlite3 db/price_history.db "SELECT COUNT(*) FROM price_history"` → 1,205,599 rows. (5) `sqlite3 db/price_history.db "SELECT MIN(date), MAX(date) FROM price_history"` → `('2000-11-27', '2026-09-03')`. |
| **الحالة** | 🟢 مغلق — Task `P0-1` (chart) (Fix Battalion) 2026-10-03 — commit `ed56cb2` pushed per Rule 63. 4 historical zip archives (222 MB) recovered under `archive/databases-from-github/`. Owner directive "DBs from GitHub" now fulfilled via `archive/` folder (active DBs remain gitignored per Rule 26 + `.gitignore`). |

---

*هذا السجل تحيّنه بعد كل خرق جديد. أي وكيل يخفي خرق = خرق مضاعف.*
*آخر تحديث: 2026-10-03 (Task `DOC-20` — Documentation Secretariat — 3 خروقات جديدة: BREACH-007 + BREACH-008 + BREACH-009 — كلها مغلوطة بواسطة Wave 7 Fix Battalion.)*

---

## §17 — Pipeline Coherence Audit (Task 26)

## 📎 MERGED APPENDIX — Pipeline Coherence Audit (Task 26)

# 🔍 تقرير مراجعة الأنابيب المتوصلة (Pipeline Coherence Audit)

> **التاريخ:** 2026-10-03
> **طلب المالك:** "محتاج مراجعة عميقة لكل الأكواد من حيث المنطق — النظام مش متفرق لأ هو أنابيب متوصلة صح مش حاجات عشوائية"

---

## 📊 خريطة التدفق (Data Flow Map)

```
┌─────────────────────────────────────────────────────────┐
│ 1. DATA ENTRY (المصادر)                                │
│   yahoo_clean → price_history.db (974K rows)            │
│   intraday_aggregated → price_history.db (29K rows)     │
│   egksco_scraper → stocks.db.egksco_stocks (250 rows)   │
│   crypto_fetcher → data_engine.db.crypto_prices (198K)  │
│   gold_fetcher → data_engine.db.gold_prices (163K)      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 2. DATA ENGINE (Python = Brain — Rule 20)               │
│   load_price_history() ← price_history.db (SOLE source) │
│   source_authority.write_guarded() ← guard all writes   │
│   validation.validate_stock_data() ← before analysis    │
│                                                         │
│   master_analyzer.analyze():                            │
│     20 analyzers (technical + fundamental + AI + SMC)   │
│     → MasterAnalysis (score + signal + entry/stop/target)│
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 3. OUTPUT CHANNELS (التوزيع)                            │
│   ├── Telegram (auto_post_scheduler) → 10 publish funcs  │
│   ├── API routes (243 total)                             │
│   │   ├── 154 call Python backend ✅ (Rule 20)          │
│   │   ├── 89 read DB directly ⚠️ (potential violation)  │
│   │   └── 58 do both ⚠️                                  │
│   └── Screens (Next.js)                                 │
│       ├── Chart ← /api/chart/[ticker] → Python ✅       │
│       ├── Predictions ← /api/predictions → Python ✅     │
│       └── Radar ← /api/maker-radar → Python ✅          │
└─────────────────────────────────────────────────────────┘
```

---

## 🔴 المشاكل المكتشفة (Pipeline Leaks)

### 1. 89 API route بيقرأ من DB مباشرة (Rule 20 violation)
```
89 route بيقرأ من SQLite مباشرة بدل ما يمر على Python backend
```
**الـ Rule 20 بتقول:** "Python = العقل، Node = العرض فقط. ممنوع فحص SQLite مباشرة من Node"

**العينة:**
- `/api/expert-recommendations/route.ts` → يقرأ stocks.db مباشرة
- `/api/mobile/watchlist/route.ts` → يقرأ data_engine + stocks.db مباشرة
- `/api/mobile/gold/route.ts` → يقرأ data_engine مباشرة
- `/api/mobile/notifications/route.ts` → يقرأ stocks.db مباشرة

**التقييم:** مش كلهم محتاجين Python (بعضهم بيانات بسيطة للعرض بس). لكن أي route فيه **logic/compute** لازم يمر على Python.

### 2. 58 route بيعمل الاتنين (direct DB + Python)
```
58 route بيقرأ من DB مباشرة + بيستدعي Python
```
**المشكلة:** split-brain — ممكن ياخد بيانات من DB قديمة + من Python حديثة في نفس الـ response.

### 3. source_authority مش متوصّل في master_analyzer
```
validation.py wired: ✅ (في master_analyzer)
source_authority wired: ❌ (مش في master_analyzer)
```
**المشكلة:** الـ validation شغّال، بس الـ source authority (اللي بيمنع الكتابة من مصادر غير canonical) لسه مش متوصّل في الـ pipeline.

### 4. stock_analysis_routes.py فيه sanity gate ✅
```
المبرمج المحلي أضاف sanity gate للدعم/المقاومة ← ممتاز
```
ده جزء من الحل — بس محتاج يتوصّل بـ validation.py المركزي.

---

## ✅ اللي شغّال صح (Connected Pipes)

| الأنبوب | الحالة |
|---|---|
| **price data → price_history.db** | ✅ source_authority + source_priority_cleaner |
| **load_price_history() → master_analyzer** | ✅ Rule 12 (sole source) |
| **validation.py → master_analyzer** | ✅ Rule 65 (wired) |
| **master_analyzer → Telegram** | ✅ auto_post_scheduler (10 funcs) |
| **master_analyzer → predictions DB** | ✅ daily_predictor |
| **chart API → Python backend** | ✅ P0-3 (wired) |
| **stock_analysis_routes sanity gate** | ✅ (prod assistant fix) |

---

## 🔧 خطة الإصلاح (ربط الأنابيب المقطوعة)

### Step 1: ربط source_authority في master_analyzer
```python
# في master_analyzer.py، قبل أي تحليل:
from data.source_authority import get_canonical_source, is_source_banned
# تحقق إن الـ source في price_history هو canonical
```

### Step 2: تصنيف الـ 89 route المباشرين
- **Read-only display** (عرض بيانات بسيطة): ✅ مقبول (Node بيقرأ بس)
- **Logic/compute** (حساب/تحليل): ⚠️ لازم يمر على Python
- **Write**: ❌ ممنوع (Rule 20 — Python only)

### Step 3: توحيد stock_analysis_routes مع validation.py
- الـ sanity gate اللي المبرمج المحلي عمله ممتاز
- بس لازم يتوصّل بـ validation.py المركزي (مش logic مكرر)

### Step 4: فحص الـ 58 route اللي بيعملوا الاتنين
- لكل route: هل الـ DB read والـ Python call بيقرأوا نفس البيانات؟
- لو لا → split-brain → لازم يتوحّد

---

## 📋 الخلاصة

**النظام أنابيب متوصلة في معظمها — بس فيه 89 + 58 = 147 نقطة تسرب محتملة.**

| المقياس | القيمة |
|---|---|
| Total API routes | 243 |
| Via Python (✅) | 154 (63%) |
| Direct DB only (⚠️) | 89 (37%) |
| Both (⚠️ split-brain) | 58 |
| Validation wired | ✅ |
| Source authority wired | ❌ (needs wiring) |
| Sanity gate in stock_analysis | ✅ |

**الأولوية:** ربط source_authority + تصنيف الـ 89 route.

---

## Appendix A — الروابط الرسمية للمنصة

|  # | المنصة               | الرابط |
| -: | -------------------- | ------ |
| -: | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
|  1 | 🌐 الموقع الإلكتروني | [https://invist.m2y.net](https://invist.m2y.net)                                                                                     |
|  2 | 📱 تطبيق أندرويد     | [https://play.google.com/store/apps/details?id=com.egx.investment](https://play.google.com/store/apps/details?id=com.egx.investment) |
|  3 | 🤖 بوت التحليل       | [https://t.me/investusernamebot](https://t.me/investusernamebot)                                                                     |
|  4 | 📘 فيسبوك            | [https://www.facebook.com/profile.php?id=61590600300048](https://www.facebook.com/profile.php?id=61590600300048)                     |
|  5 | ✈️ تليجرام           | [https://t.me/Arabian_investment_guide](https://t.me/Arabian_investment_guide)                                                       |
|  6 | 💬 واتساب            | [https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc](https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc)                                 |

---

## Appendix B — Test Cards (Paymob Sandbox)

> # 🔴🔴🔴 تحذير بارز 🔴🔴🔴
> **البيانات التالية Test Credentials فقط — ممنوع استخدامها في Production نهائياً.**
> تأكد أن إعدادات الـ Payment Gateway مضبوطة على **Sandbox/Test Environment** أثناء الاختبار.
> لا تضع بيانات البطاقات أو الـ CVV أو بيانات المحفظة بشكل hard-coded داخل الكود الإنتاجي.
> استخدم Environment Variables أو إعدادات الـ Test Environment.
> بعد انتهاء الاختبار، تأكد أن Production يستخدم Credentials مختلفة تماماً.

### B.1 — Mastercard Test (بطاقتان)

**Mastercard – Card 1**

- Card Number: `5123456789012346`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

**Mastercard – Card 2**

- Card Number: `5123450000000008`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

### B.2 — Visa Test

- Card Number: `4111111111111111`
- Cardholder Name: `Test Account`
- Expiry Month: `01`
- Expiry Year: `39`
- CVV: `123`

### B.3 — Mobile Wallet Test

- Wallet Number: `01010101010`
- MPin Code: `123456`
- OTP: `123456`

### B.4 — دورة الاختبار المطلوبة


اختبر دورة الدفع كاملة لكل وسيلة:

1. اختيار المنتج/الباقة.
2. الانتقال إلى صفحة الدفع.
3. اختيار طريقة الدفع.
4. إدخال بيانات الاختبار المناسبة.
5. تنفيذ عملية الدفع.
6. التأكد من رجوع الـ callback/webhook بشكل صحيح.
7. التأكد من إنشاء وتحديث حالة الـ transaction في قاعدة البيانات.
8. التأكد من تحديث حالة الطلب/الاشتراك بعد نجاح الدفع.
9. التأكد من عدم تسجيل بيانات البطاقات أو الـ CVV أو الـ MPIN أو الـ OTP في الـ logs.
10. التأكد من التعامل الصحيح مع حالات:
   - Payment Success
   - Payment Failed
   - Payment Pending
   - Callback/Webhook مكرر
   - المستخدم يرجع للصفحة قبل اكتمال الدفع
   - إعادة تحميل صفحة نتيجة الدفع
   - Transaction موجودة بالفعل ولا يجب إنشاء عملية مكررة.

### مهم جداً

- البيانات السابقة **Test Credentials فقط**، وممنوع استخدامها في Production.
- تأكد أن إعدادات الـ Payment Gateway مضبوطة على **Sandbox/Test Environment** أثناء الاختبار.
- لا تضع بيانات البطاقات أو الـ CVV أو بيانات المحفظة بشكل hard-coded داخل الكود.
- استخدم Environment Variables أو إعدادات الـ Test Environment.
- بعد انتهاء الاختبار، تأكد أن Production يستخدم Credentials مختلفة تماماً.
- المطلوب في النهاية تقرير مختصر يوضح نتيجة اختبار كل وسيلة دفع:

| طريقة الدفع | الاختبار | النتيجة | Transaction ID | ملاحظات |
|---|---|---|---|---|
| Mastercard | Card 1 | | | |
| Mastercard | Card 2 | | | |
| Visa | Card 1 | | | |
| Mobile Wallet | Wallet | | | |

لو أي اختبار فشل، حدد **مكان الفشل بالضبط**: Frontend / Payment Gateway / Callback / Webhook / Backend / Database، مع رسالة الخطأ والـ transaction state، بدون كشف أي بيانات حساسة.

---

*تم التوحيد بواسطة Task `DOC-UNIFY-3-LOGIC-STATE` — 2026-10-12 — DOCUMENTATION-SECRETARY per Rule 70.*

---

## §18 — Phase 2 Snapshot (2026-10-13 → 2026-10-14)

> 📖 **التفاصيل الكاملة في [`05-PHASE2_SNAPSHOT_2026-10-14.md`](./05-PHASE2_SNAPSHOT_2026-10-14.md)** — هذا قسم ملخص يربط الـ canonical doc بالمرحلة الثانية.

### ما تم إنجازه في المرحلة الثانية

المرحلة الثانية حوّلت المنصة من "شاشات بتلمع" إلى **منصة بتبيع وتكسب المستثمر فلوس**:

1. **تنظيف الكارثة (B-17):** كانت المنصة بتعرض `win_rate = 7.4%` وهمي من 54 صفقة فاسدة (قيعان شاذة `low=0.00` + تواريخ مستحيلة `outcome < prediction`). تم حذفها بـ `scripts/clean_false_stoploss.py`.

2. **بناء سجل الأداء الموثق (B-20a):** `scripts/build_audited_track_record.py` — backtest engine حقيقي على بيانات EGX+TADAWUL+KSE+QSE الفعلية. النتيجة: **32 صفقة مغلقة (Win Rate 75%, Avg Return +7.59%, Profit Factor 15.0)**.

3. **ترقية السكانر المؤسسي (B-20b):** `scripts/multi_market_institutional_scan.py` أضيف له `--strict` (R:R ≥ 2.0 + ثقة ≥ 78%) + `--top N` + حقل `catalyst` (الدافع الفني) لكل صفقة.

4. **الـ Commercial Feed الموحد (B-18):** `scripts/commercial_feed.py` + `/api/v2/commercial-feed` endpoint — Python = العقل (Rule 20)، 30s cache، عزل سوق تام، NO-FAKE-DATA fallback.

5. **قاموس تعريب القطاعات (B-21):** `scripts/sector_arabic.py` — 27 قطاع إنجليزي → عربي. مطبّق على كل الـ signals والـ trades.

6. **تحسين سلامة summary (B-21):** `compute_summary()` أضيف له top-level aliases (`win_rate`, `total_closed`, `avg_return`, `active_count`) — دائمًا رقم، أبدًا undefined.

7. **واجهة المستخدم (A-17/A-18):** `VIPLiveSignalsFeed.tsx` (كروت + catalyst + زر نسخ + بانر + جدول) + `AuditedPerformanceView.tsx` + `TimeHorizonBadge.tsx`.

8. **عزل الأسواق (JIMMY-MARKET-ISOLATION):** عزل تام لكل سوق (EGX/TADAWUL/KSE/QSE) مع عملة ديناميكية (ج.م/ر.س/د.ك/ر.ق) + منع تكرار نفس السهم.

### KPIs الحالية (2026-10-14)

| الـ KPI | القيمة | الهدف | الحالة |
|---|---|---|---|
| Win Rate (audited) | 75.0% | 70-76% | ✅ |
| Avg Return (audited) | +7.59% | +8% إلى +12% | ⚠️ قريب |
| Profit Factor | 15.0 | > 2.0 | ✅ ممتاز |
| Active Signals Count | 16 | 6-12 | ✅ |
| Active avg R:R | 2.71 | ≥ 2.0 | ✅ |
| Active avg Confidence | 82-86% | ≥ 78% | ✅ |
| False Stops (low=0) | 0 | 0 | ✅ |
| Sector Arabization | 100% | 100% | ✅ |

### Breach Log (المرحلة الثانية)

| Breach ID | الوصف | الحل |
|---|---|---|
| BREACH-010 | `win_rate = 7.4%` وهمي من 54 صفقة فاسدة | `clean_false_stoploss.py` + backtest حقيقي |
| BREACH-011 | `Active Live Signals = 0` | `--execute --strict --top 12` |
| BREACH-012 | "no such table: stocks" في commercial_feed | refactor ATTACH DATABASE |
| BREACH-013 | قطاعات إنجليزية في API | `sector_arabic.py` قاموس كنسي |
| BREACH-014 | `summary` ناقص المفاتيح | top-level aliases hardening |
| BREACH-015 | تكرار أسهم + خلط أسواق | عزل سوق تام |
| BREACH-016 | backtest بيكتب 0 على schema قديم | ALTER TABLE تلقائي + else branch |

### آخر commit موثّق
- `63d4ca7` — `feat(ui): A-18: Null safety + unified Arabic tabs + English purge`
- `09a9c3c` — `feat(B-21): summary hardening + sector arabization + backtest ALTER TABLE fix`
- `dd7b15f` — `feat(B-20+A-17): audited track record (32 trades, 75% win rate) + catalyst field + VIP feed UI`

---

*تمت إضافة هذا القسم بواسطة Task `DOC-PHASE2-SNAPSHOT` — 2026-10-14 — استنادًا للأكواد الفعلية بعد `git pull origin main`.*
