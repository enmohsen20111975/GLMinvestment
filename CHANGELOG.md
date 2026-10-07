# سجل التغييرات السلوكية — CHANGELOG

> **الغرض:** توثيق كل تغيير سلوكي في المشروع (ليس التغييرات التجميلية). كل إدخال يصف ما تغيّر في سلوك النظام من منظور المستخدم/الإنتاج.
>
> **التنسيق:** [Keep a Changelog](https://keepachangelog.com/) — أحدث الإصدارات في الأعلى.
>
> **القاعدة:** أي عمل غير موثق = عمل لم يحدث (قانون المالك).
>
> **تاريخ الإنشاء:** 2026-10-07 (أول إصلاح توثيقي — بناءً على طلب المالك في بروتوكول الإقلاع).
>
> **ملاحظة:** الملفات التاريخية السابقة (`BREACH-LOG.md`، `EMERGENCY_REMEDIATION_PLAN.md`، `ENGINEERING_AUDIT_REPORT.md`، `UNIFICATION_MASTER_PLAN.md`، `REMAINING_TODO.md`، `REMAINING_PLAN_DETAILED.md`، `AUDIT_VERIFICATION_STATUS.md`، `BACKTEST_PROMPT.md`) تبقى كأرشيف مرجعي — هذا الملف هو السجل الحيّ من 2026-10-07 فصاعدًا.

---

## [Unreleased] — قيد العمل (لا رفع على GitHub)

### المُخطَّط (بانتظار إذن المالك)
- **ترحيل 41 bypass route** لـ canonical_signal (من أصل 47 route منتجة للقرار — 87% ما زالت bypass).
- **تعطيل 4 writers غير canonical** لـ predictions table (3 Python + 1 TS).
- **استكمال ترحيل 4 شاشات** لـ unified API (StocksView + MakerRadarTab + PredictionTrackingDashboard + TradingViewChart كاملًا).
- **توحيد master_analyzer.py THRESHOLDS** مع canonical (78/65/55/40/25).
- **إنشاء `scripts/zero_conflict_test.py`** (تصميم جاهز من Task 2c) — اختبار "نفس السهم/اليوم/الشخصية = نفس القرار" بمعايير صارمة.
- **تحديث التوثيق المتأثر**: 05-CURRENT_STATE + 01-PROJECT_ANATOMY + 02-SCREENS_AND_COMPONENTS + SYSTEM_HOW_IT_THINKS §5.7.
- **إضافة §0.8 لـ 02-SCREENS_AND_COMPONENTS** (Canonical Signal Migration — موعود في worklog لكن غير موجود فعليًا).
- **تحديث §5.7 في SYSTEM_HOW_IT_THINKS**: ATR clamp [3%,9%] → [5%,9%] (STALE — لم يُحدّث بعد EGX-STRATEGY).
- **تنظيف unified_config.py profiles**: ATR 3.0/9.0 للـ EGX profile → 5.0/9.0 (خطر override).

---

## [2026-10-07 — TRADING-CHART-V60.2] — ربط #trading-chart بمنطق Pine Script + المحرك الموحّد

### أُضيف (New)
- **`src/modules/market-analysis/components/CanonicalWhoIsBuyingBanner.tsx`** (380 LOC) — بانر محرك القرار المؤسسي V60.2 يعرض من المحرك الموحّد فقط:
  - **WHO IS BUYING?** (`prediction.who_is_buying`) — مطابق لـ Pine L669-763 (mirror في `master_analyzer.py::detect_who_is_buying` L846-1085).
  - الإشارة الكنسية (`canonical.signal_ar` — thresholds 78/65/55/40/25).
  - `master_score` + source badge (fresh prediction ≤ 48h vs fresh technical).
  - `money_flow` (5 مستويات مطابقة Pine L353-366) + `accumulation` + `phase`.
  - مستويات الدخول/الأهداف الثلاثة/الوقف/R:R/الثقة (من `prediction.*`).
  - RSI (Wilder) + ATR + support/resistance + HMM regime (من `technical.*` + `prediction.hmm_regime`).
  - `analysis_reason` (التعليق التحليلي العربي — مطابق Pine L919-951).
  - `net_flow` + `buy_value_m`/`sell_value_m` (من `radar.*`).
- **`src/lib/indicators/rsi.ts`** (95 LOC) — `computeRSI` (Wilder's) كـ PURE TypeScript (لا DB deps) + `classifyRSIState`. فصل الـ pure logic عن `unified-stock-data.ts` (الذي يستورد `better-sqlite3`).

### تغيّر (Changed)
- **`src/modules/market-analysis/components/SingleStockAnalysisView.tsx`**:
  - +جلب موازٍ لـ `/api/stocks/[ticker]/unified` داخل `fetchData` (مع `canonicalLoading` state).
  - +إدراج `<CanonicalWhoIsBuyingBanner>` قبل `predictionContext` banner.
  - +`import type { UnifiedStockData }` (type-only — آمن للـ client bundle).
- **`src/modules/crypto/components/CryptoAdvancedAnalysisView.tsx`** + **`src/modules/education/components/EntryTimingSimulator.tsx`**:
  - إعادة توجيه `import { computeRSI }` من `@/lib/unified-stock-data` → `@/lib/indicators/rsi` (إصلاح bug: كان يجرّ `better-sqlite3` للـ client bundle ويسبب `Module not found: Can't resolve 'fs'`).

### مُتحقَّق منه (Verified)
- ✅ `GET /` يرجع **HTTP 200** (التجميع نجح بعد إصلاح فصل RSI).
- ✅ `GET /api/stocks/PHDC/unified` يرجع **HTTP 404** + `{"success":false,"error":"stock_not_found"}` (الـ unified API route يعمل؛ DB فارغة = احترام Rule 27 NO-FAKE-DATA).
- ✅ صفر أخطاء TypeScript في الملفات المعدّلة.
- ✅ كل القيم من `getUnifiedStockData()` — لا حساب مالي في الواجهة (Rule 73 SINGLE-DISPLAY-SOURCE).
- ✅ مطابقة Pine V60.2: `who_is_buying` = mirror كنسي في `master_analyzer.py` (L846-1085) الذي يُصرِّح "المرجع: EGX_Pro Pine script (V60.2) lines 670-760".

### قيود (Constraints Honored)
- ❌ **لا push على GitHub** (`pushurl = "no-push-allowed"`).
- ❌ **لا بيانات وهمية** (DBs فارغة بـ schema مطابق فقط).
- ❌ **لم تُلمس الحمايات** (لم يُعدّل كود الإنتاج/Python).
- ❌ **لا تعديل لملفات VPS/db snapshots** (`db/` read-only).

### ما يحتاج إذن المالك
- سحب التحديثات الجديدة من GitHub يحتاج **توكن جديد** (القديم revoked لأسباب أمنية).
- التحقق البصري الكامل لـ `#trading-chart` يحتاج **DBs EGX حقيقية** (توجد على VPS الإنتاجي فقط).

---

## [2026-10-07] — إقلاع المدير العام + تشخيص شامل

### أُضيف (Documentation)
- **`CHANGELOG.md`** (هذا الملف) — أول إصلاح توثيقي بناءً على طلب المالك.
- **مدخل المدير العام (Task 0)** في `worklog.md` — تشخيص شامل بالأرقام.

### مُشخَّص (تحليل static — لم يُعدّل كود)
- **فريق 7 تخصصات** أطلق تحليل static متوازي (Tasks 1b/1c/1d/1e + 2a/2b/2c).
- **خريطة من-يستدعي-ماذا** بُنيت (Task 2a):
  - من 47 TS route تُنتج signal: **فقط 6 (13%) canonical حقيقي**، 41 (87%) bypass/legacy.
  - 104 route direct-DB (98 violation فعلية) + 27 split-brain route.
  - canonical_signal.py (309 LOC) + canonical-signal.ts (246 LOC) متطابقان 100%.
  - 4/8 شاشات فقط هاجرت فعليًا (StockDetail + ComprehensiveStockAnalysis + SpecialistAnalysisView + UnifiedPublishButton).
  - 4 writers غير canonical ما زالوا يكتبون في predictions.
  - master_analyzer.py THRESHOLDS dict يخالف canonical (REDUCE=35 vs 40, SELL=20 vs 25).
- **مراجعة حمايات رأس المال** (Task 2b):
  - **كل الحمايات سليمة في الكود الإنتاجي** (لم يضعفها التوحيد).
  - ATR clamp الإنتاجي = [5.0%, 9.0%] (engine_settings.py:240-241) ✅.
  - Hard Loss -7% ✅ + HARD cap ±50 ✅ + Split Guard 35% ✅ + Ticker Cooldown 5→14d ✅.
  - R:R floor 1.8 (target) / 1.5 (gate effective) ⚠️ ثغرة defense-in-depth.
  - §5.7 SYSTEM_HOW_IT_THINKS STALE (يقول [3%,9%] — الكود يقول [5%,9%]).
  - unified_config.py profiles فيها ATR 3.0/9.0 للـ EGX (خطر override).
- **تصميم اختبار صفر تضارب** (Task 2c):
  - unification_test.py الموجود فيه false-positive bug (silent skip للـ None).
  - تصميم `zero_conflict_test.py` جاهز (7 endpoints × 5 tickers × 6 canonical fields + HTTP status assertion + sub-fields override + edge cases).
  - عتبة القبول: mismatch_rate == 0.0%، threshold_drift == 0 نقطة.
  - يحتاج تشغيل backend (إذن المالك).

---

## [2026-10-07 — سابق] — UNIFICATION-ALL-PHASES-COMPLETE

> **مصدر:** `Documentation/UNIFICATION_MASTER_PLAN.md` + `worklog.md` (UNIFICATION-ALL-PHASES-COMPLETE).
> **التنفيذ:** 14 commits، ~85 ملف، 8 sub-agents بالتوازي.

### تغيّر (Behavior)
- **محرك قرار واحد:** `master_analyzer.py` + `canonical_signal.py` (thresholds 78/65/55/40/25) — المصدر الكنسي الوحيد لتصنيف الإشارات.
- **Maestro معطل نهائيًا:** API routes ترجع `410 Gone` + Python entry points فيها `MAESTRO_DISABLED=True` + UI widgets ترجع `null`.
- **5 sub-engines معطّلة:** board_of_analysts + confluence_v3 + sniper + v82 + professional_analysis (SUB_ENGINE_DISABLED=True).
- **RSI موحد:** Wilder's smoothing عبر `vps-service/analyzers/indicators/rsi.py::calc_rsi()` (Python) + `src/lib/unified-stock-data.ts::computeRSI()` (TS port مطابق) — 31 ملف.
- **العتبات موحدة:** `engine_settings.py` (78/65/55/40/25) + institutional thresholds متطابقة.
- **مصدر سعر واحد:** `stocks.db.stocks.current_price` (LIVE) + `stock_daily_prices` (HISTORICAL) — عبر canonical price-source hierarchy.
- **كاتب واحد:** `daily_predictor.py` (7 writers معطّلين عبر `SKIP_STORED_ANALYSES_WRITE=True`).
- **اختبار آلي:** `scripts/unification_test.py` (213 LOC) يضرب 5 endpoints × 7 tickers.
- **freshness gate:** PENDING predictions ≤ 48 ساعة (Rule 72).
- **سياسة الفراغ:** NULL → "— بيانات غير متاحة" (مش HOLD الكاذب).
- **Source transparency:** `unified=true` + `unified_source` tag في كل response من unified API.

### القواعد الدستورية المُضافة (اقتراحات مُنفّذة)
- **Rule 67 — CALCULATION-CANONICAL:** ATR/RSI/Position/Stop/PF/master_score/VWAP/SMA200 canonical formulas.
- **Rule 72 — UNIFIED-DATA-CONTRACT:** freshness gate على كل read sites (8 مواقع).
- **Rule 73 — SINGLE-DISPLAY-SOURCE:** أي شاشة تعرض signal/master_score/RSI/support/resistance تقرأ من مصدر عرض واحد.

### المراحل الأربع (مكتملة)
| المرحلة | Commits | ملفات | المخرج |
|---|---|---|---|
| Phase 0 | 2 | 7 UI | إخفاء الشارات غير الكانونية + تعطيل MaestroWidget |
| Phase 1 | 3 | 3 + 1 جديد | توحيد العتبات + حداثة + اختبار آلي |
| Phase 2 | 2 | 49 | توحيد RSI + قتل Maestro نهائيًا |
| Phase 3 | 1 | 27 | تعطيل sub-engines + مصدر سعر + كاتب واحد |

### ملاحظة حرجة (مُشخَّصة 2026-10-07)
التوحيد مُنفّذ في البنية الكانونية، لكن **التطبيق الفعلي غير مكتمل**: 87% من routes ما زالت bypass، 4/8 شاشات فقط هاجرت، 4 writers ما زالوا شغّالين، master_analyzer THRESHOLDS يخالف canonical. هذه الفجوات موثّقة في `[Unreleased]` أعلاه.

---

## [2026-10-04] — Wave 8 (Task `28-C`)

> **مصدر:** `Documentation/05-CURRENT_STATE.md` §17.1 + worklog.

### تغيّر (Behavior)
- **Pipeline coherence audit:** 243 routes مُرسمة، 89 direct-DB read مُعلَّمة.
- **`source_authority.py` مُوصَّل** في `master_analyzer.py` (Rule 66 end-to-end — commit `435c16f`).
- **32 Flutter endpoint استُرجِعت** (كانت أُرشفت بالخطأ في Wave 2 — التطبيق كان مكسورًا بصمت — commit `774a208`).
- **Backtest شامل:** 288 EGX stock × 4.5 شهر × 353 trades / **PF=4.74** (commit `d220fab`).
- **Visual redesign emerald:** 6 commits (بديل indigo المحظور).
- **Sharia UI شِحن:** `ShariaView.tsx` + `ShariaBadge.tsx` + `ShariaStockCard.tsx` (commits `324a095` + `704aa0c`).
- **Rules 64-66 مُضافة:** SHARIA + DATA-VALIDATION-LAYER + SOURCE-AUTHORITY (commits `ae1df26` + `5867808`).
- **News engine overhaul:** 6 مصادر، ~360 خبر/يوم، 123 صف HTML اتصلحت.
- **Data fix:** 3,664 صف `tab_*` تالف (symbol = TICKER + الاسم) اتصصلحوا.

### API
- **380 → 411 route.ts** (استرجاع 32 Flutter endpoint).

---

## [2026-10-03] — Wave 7 (Data + Chart quality)

### تغيّر (Behavior)
- **11 P0 data issues + 5 P0 chart issues** → 17 commits.
- **Score:** data 3→8/10 + chart 2→8/10.
- **DB recovery:** 222MB من `archive/databases-from-github/`.
- **P1-1..P1-12** مفتوحة (stored_analyses.risk_reward hardcoded 3.0 + Wilder ADX غير مُنفّذ + Graham formula مفقود + tab_balance_sheet column-shift bug + Rule 21 violation + egksco_scraper cron معطّل + 6+ calc_rsi مكررة + migration NULL).

---

## [2026-10-02] — Wave 6 (Payment System)

### تغيّر (Behavior)
- **5 P0 fixes:** m2y- prefix + subscription expiry + promo codes time-limited + 7 backend paywall gates + unified PAID_TIERS.
- **Health score:** 4.5→8/10.

---

## [2026-10-01] — Wave 2+3 + DOC-CONSOLIDATION

### تغيّر (Behavior)
- **436 dead files archived** + **313 dead routes** + education unification + radar tab consolidation.
- **i18n Phase 1:** 5 components migrated (MarketAnalysisView + StocksView + EnhancedWatchlistView + EnhancedPortfolioView + AlertsCenterView).
- **134 ملف توثيقي قديم ادمج** في 5 canonical.
- **DB layer unified** (Phase 5) في `src/lib/db/index.ts`.

---

## [2026-09-27] — P0 Wave (18 P0 fixes)

### تغيّر (Behavior)
- **stored_analyses + hunter_pick_tracking + price_history + telegram-events + v4_bp + cron + news-agent + DB unify + auth + SQLi + import hardening + async I/O + observability + tests + HELI reconcile + duplicate-write** — 18 P0 fixes.

---

## [2026-09-25] — DOC-CONSOLIDATION + Rules 45-49

### القواعد المُضافة
- **Rule 45 — SCREENER-FUNDAMENTALS-DEPTH.**
- **Rule 46 — DB-CLEANUP-WAVE-1+2+3:** 10→7 DBs (حذف 3 DBs + 9 duplicate tables + VACUUM — توفير ~41.5MB + 123 سطر كود ميت).
- **Rule 47 — NEWS-AGENT-INTEGRATION:** دمج news repo كـ submodule.
- **Rule 48 — …**
- **Rule 49 — DUAL-TRACK-PREDICTIONS.**

---

## [2026-09-24] — Rule 50 (MONEY-AS-CUSTOMER-LIFE)

### تغيّر (Behavior)
- **6 endpoints حرجة كانت ترجع بيانات وهمية هاردكود** (5 أسهم خيالية: COMI/ABUK/EAST/SWDY/HRHO) → أُصلِحت لقراءة محفظة العميل الحقيقية.
- **Tier 1:** `/api/portfolio/holdings` + `/api/portfolio/watchlists` + `/api/portfolio/bag-holder-rescue` + `/api/portfolio/smart-monitor/signals` + `/api/portfolio/risk-summary` + `WealthCharts.tsx`.
- **Tier 2:** محرك تنبيهات موحّد `src/lib/schedulers/alert-engine.ts`.

---

## [الأقدمية — قبل 2026-09-24]

> الأحداث الأقدم من 2026-09-24 موثّقة في `worklog.md` (الأرشيف الكامل) وملفات `Documentation/*.md` التاريخية. هذا CHANGELOG يبدأ من النقطة الحرجة (Rule 50 — حماية محفظة العميل) لأنها نقطة التحول الأخلاقية للمشروع.

---

**ملاحظة ختامية:** هذا الملف يُحدَّث مع كل عمل (إلزام روتيني). أي تغيير سلوكي غير موثق هنا = لم يحدث (قانون المالك).
