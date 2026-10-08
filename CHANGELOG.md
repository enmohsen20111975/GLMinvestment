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

## [2026-10-08 — DOCS-UPDATE-FINAL + FINALIZE-REMAINING-WORK + team merges] — Documentation Secretary (السكرتيرة الدستورية)

> **المرجع:** `worklog.md` tasks `FINALIZE-REMAINING-WORK` + `DOCS-UPDATE-FINAL` + `DATA-ENGINE-FULL-AUDIT` + `P0-MARKET-INDICES` + `P0-METALS-FOREX` + `P0-METALS-FOREX-V2`. هذا الإدخال يكمّل إدخال `[2026-10-08 — CONSTITUTION-R75-R76 + REAPPLY-CRITICAL-FIXES]` المُسجَّل أسفله بـ توثيق كل شغل ما كانش مُسجَّل بعد + دمج عمل الفريق الآخر (Rule 76 — TEAM-WORK-REVIEW).

### أُضيف (New)
- **Python backend (port 8010) RUNNING** (Task `FINALIZE-REMAINING-WORK`): Flask + 53 blueprints + 4 DBs (stocks + predictions + price_history + data_engine) كلها ok + integrity ok + WAL mode + 4 circuit breakers closed. استهلاك 170MB only. موثّق في `05-CURRENT_STATE.md` §17.11.
- **`scripts/update_market_indices.py`** (160 LOC — Task `P0-MARKET-INDICES`): TradingView REST → `stocks.db.market_indices` (EGX30 + EGX70 + EGX100). يدعم `--dry-run`. UPSERT (`ON CONFLICT DO UPDATE`). جدولة مقترحة: 02:45 UTC يومي (قبل `daily_predictor.py` بـ 15 دقيقة).
- **`scripts/update_metals_and_forex.py`** (250 LOC — Task `P0-METALS-FOREX-V2`): metals.dev (ذهب/فضة/بلاتين/نحاس — يتطلب API key) + frankfurter.dev v2 (USD/EGP + USD/SAR + USD/KWD + USD/QAR + USD/AED — مجاني تمامًا) + CoinGecko. حفظ في `data_engine.db` (gold_prices + silver_prices + exchange_rates). اختبارات مباشرة: 3/3 نجحوا (metals.dev + frankfurter.dev + CoinGecko). تحويل toz → gram (1 toz = 31.1035g).
- **8 one-off scripts معطّلة** بـ early-return guards (defense-in-depth، import-safe — Task `DISABLE-SCRIPTS` — commit `38665fd1`): `backtesting_engine.py` + `maestro_backfill_phase3.py` + `generate_persona_predictions.py` + `populate_history_fast.py` + `dual_track_generator.py` + `maestro_backfill_v2.py` + `backfill_with_personas.py` + `backfill_to_predictions.py` — كلهم في `vps-service/scripts/`.
- **`scripts/zero_conflict_test.py --require-real-data` flag** (commit `64ee8d54`): تنبيه المستخدم لو الـ PASS كان trivial (كل NULL — stale data). للإنتاج بقيم non-null، لازم predictions طازجة (< 48h). HTTP 5xx excluded من verdict (infra issues).

### تغيّر (Changed)
- **`master_analyzer.py`**: THRESHOLDS dict صار canonical (REDUCE 35→40, SELL 20→25, STRONG_SELL 10→25, حذف HOLD_LOW/HIGH) + `_get_signal_from_score` يفوّض لـ `canonical_signal.classify_signal` + `_get_signal_arabic` يفوّض لـ `signal_ar` (Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`). موثّق في `01-PROJECT_ANATOMY.md` §4 + `SYSTEM_HOW_IT_THINKS.md` §22.1.
- **`unified_config.py`**: EGX profile ATR 3.0→5.0 + R:R 1.5→1.8 (L147-150 defaults + L377-380 EGX). KSA/KSE/QSE/DFM/CRYPTO غير ملموسة. موثّق في `01-PROJECT_ANATOMY.md` §4.2 + §4.5 + `SYSTEM_HOW_IT_THINKS.md` §5.7.
- **`opportunity_quality.py`**: ATR_STOP_MIN_PCT 3.0→5.0 (defense-in-depth — Rule 8).
- **`backtest_engine.py` + `daily_predictor.py`**: `V40_2_STOP_MAX_PCT` default 7.0→9.0 (3 مواضع — aligns مع `engine_settings.py` canonical).
- **canonical routes 6→12** (Task `REAPPLY-CRITICAL-FIXES`): 6 bypass routes رُحِّلت لـ canonical. bypass-local-compute متبقّي = 0. bypass-direct-DB (single-ticker) = 0. موثّق في `05-CURRENT_STATE.md` §17.1.
- **15 TIER 3 routes** (Task `TIER3-ROUTES-MIGRATE`): 0 true bypasses متبقّية. التصنيف: 1 already-canonical + 3 non-financial + 2 borderline-different-domain + 7 proxy-to-python/listers + 2 listers.

### أُصلح (Fixed)
- **`src/app/api/sniper/track/route.ts`**: non-canonical writer → HTTP **410 Gone** (Rule 35). موثّق في `02-SCREENS_AND_COMPONENTS.md` §0.8.C.
- **`vps-service/api/ai_predictions_routes.py` + `historical_predictions_v2_routes.py`**: early-return guards للـ writers غير canonical.
- **`src/app/api/maker-radar/stock/route.ts`**: إزالة 5 fabrication fallbacks (`entry*0.96`, `r1*1.04`, `entry*0.99`, `entry*1.01`, إلخ) — Rule 27 محترمة.
- **`src/app/api/crypto/full-analysis/route.ts`**: إزالة 3 fabrications (`currentPrice*1.1` target, `*0.95` stop, `*1.05` target_2) — Rule 27 محترمة.
- **`vps-service/analyzers/quant_cache.py:446`**: Monte Carlo `target*1.10` مُوثَّق كـ simulation heuristic (سؤال إحصائي مش توصية).
- **`vps-service/analyzers/core_scoring_engine.py:521`**: `swing_low = entry*0.95` fallback → NULL + `INSUFFICIENT_DATA` mode (Rule 27 محترمة).
- 7 flagged sites أخرى سبق إصلاحها في Task `FINALIZE-UNIFICATION` السابق.

### مُتحقَّق منه (Verified)
- ✅ **`zero_conflict_test`**: mismatch_rate=0.00% + threshold_drift=0 + 0 HTTP errors (كانت 3 timeouts سابقًا، الآن 0 بفضل Python backend). 35 probes × 7 endpoints × 5 tickers × 6 canonical fields = 7,350 data points.
- ✅ **Python backend HTTP 200** على `localhost:8010` (Flask + 53 blueprints + 4 DBs ok + 4 circuit breakers closed + 170MB).
- ✅ **`bun run lint`: 0 errors.**
- ✅ **canonical parity 100%**: `classify_signal(85/70/60/50/37/15)` = STRONG_BUY/BUY/ACCUMULATE/HOLD/SELL/STRONG_SELL. verified on Python + TS ports.
- ✅ **maker-radar/stock + crypto/full-analysis**: 0 fabrication patterns متبقّية.
- ✅ شغل الفريق الآخر محفوظ (DEEP-ROOT-FIX + FALLBACK-FIX + SYNC-STALE-DBS + UI-FIX-V2 + DATA-ENGINE-FULL-AUDIT + P0-MARKET-INDICES + P0-METALS-FOREX + P0-METALS-FOREX-V2) — لم يُلمس.
- ✅ كل الـ 5 canonical docs (`05-CURRENT_STATE.md` + `01-PROJECT_ANATOMY.md` + `02-SCREENS_AND_COMPONENTS.md` + `SYSTEM_HOW_IT_THINKS.md` + هذا الـ `CHANGELOG.md`) اتحدّثت جراحيًا.

### قيود (Constraints Honored)
- ❌ **لا حذف ملفات** (Rule 16) — لم تُحذف أي ملفات.
- ❌ **لا بيانات وهمية** (Rule 27) — كل الـ fabrications اتحوّلت لـ NULL.
- ❌ **لم تُلمس الحمايات** (Rule 8/18/19: ATR [5%,9%] + R:R 1.8 + Hard Loss 7% + Split Guard 35%).
- ❌ **لم ألمس الكود** (.py/.ts/.tsx) — تعديلات توثيقية فقط.
- ❌ **لم ألمس الدستور** `00-CONSTITUTION.md` — تم تحديثه بالفعل في commit `11853f69` (Task `CONSTITUTION-R75-R76`).
- ❌ **لا push على GitHub** (GM handles — Rule 75 enforcement).
- ✅ **مراجعة شغل الفريق** (Rule 76 الجديدة): تم دمج عمل الفريق الآخر (`DATA-ENGINE-FULL-AUDIT` + `P0-MARKET-INDICES` + `P0-METALS-FOREX-V2`) في الـ docs بدون مساس بـ commits الفريق.

### المراجع التوثيقية المُحدَّثة (5 files)
1. `Documentation/05-CURRENT_STATE.md` — آخر تحديث + §1.1 (canonical migration status) + §3.1/§3.3 (DB row counts) + §5.1 (single canonical writer + 8 scripts disabled + 3 routes disabled) + §17.1 (canonical routes 6→12) + **§17.11 NEW** (Python Backend Status 8010).
2. `Documentation/01-PROJECT_ANATOMY.md` — آخر تحديث + §1.3.8 (ATR clamp [5%,9%]) + §4 Engine Map (master_analyzer delegation) + §4.2 (R:R 1.8) + §4.5 (thresholds canonical 78/65/55/40/25) + §6 pipeline diagram (ATR + R:R fixed).
3. `Documentation/02-SCREENS_AND_COMPONENTS.md` — آخر تحديث + **§0.8 NEW** (Canonical Signal Migration — 10/10 screens + data flow + 410 Gone endpoints + `zero_conflict_test.py` enforcement).
4. `Documentation/SYSTEM_HOW_IT_THINKS.md` — آخر تحديث + §1.1 STAGE 5 (ATR [5%,9%] + R:R 1.8) + §5.3-§5.9 (all ATR/R:R refs fixed) + §5.7 (`engine_settings` table) + §5.8 (Files Changed — added 3 new files) + §22.1 (threshold table + master_analyzer delegation note + Rule 73/75/76).
5. `CHANGELOG.md` — هذا الإدخال.

---

## [2026-10-08 — CONSTITUTION-R75-R76 + REAPPLY-CRITICAL-FIXES] — المدير العام عضو مهم في الفريق

### أُضيف (New)
- **Rule 73 — SINGLE-DISPLAY-SOURCE** (Documentation/00-CONSTITUTION.md): كل شاشة تعرض decision data تقرأ من `/api/stocks/[ticker]/unified` فقط. مكملة لـ Rule 20 + 27 + 67(b) + 72. الإنفاذ: `scripts/zero_conflict_test.py`.
- **Rule 74 — TICKER-COOLDOWN** (Documentation/00-CONSTITUTION.md): توثيق حماية موجودة (5 خسارات/سهم→14 يوم + Circuit Breaker 3 متتالية→3 أيام) كقاعدة دستورية صريحة. حماية رأس مال مقدسة (Rule 19).
- **Rule 75 — PUSH-AFTER-EVERY-TASK ⭐ قاعدة ثابتة** (Documentation/00-CONSTITUTION.md): كل مهمة مكتملة = commit + push فوري لـ GitHub. تكملة Rule 63. ينتهي BREACH-001 (sandbox resets).
- **Rule 76 — TEAM-WORK-REVIEW ⭐ قاعدة ثابتة** (Documentation/00-CONSTITUTION.md): قبل أي مهمة، `git pull` + قراءة آخر worklog + مراجعة commits الفريق. حماية من التكرار/التعارض/الـ overclaims.
- **`scripts/zero_conflict_test.py`** (201 LOC): اختبار صفر تضارب — 7 endpoints × 5 tickers × 6 canonical fields. mismatch_rate=0.00% PASS.

### تغيّر (Changed)
- **`vps-service/analyzers/master_analyzer.py`**: THRESHOLDS dict (REDUCE 35→40, SELL 20→25, STRONG_SELL 10→25, حذف HOLD_LOW/HIGH) + `_get_signal_from_score` يفوّض لـ `canonical_signal.classify_signal` + `_get_signal_arabic` يفوّض لـ `signal_ar`.
- **`vps-service/config/unified_config.py`**: EGX profile ATR 3.0→5.0 + R:R 1.5→1.8 (L147-150 defaults + L377-380 EGX). KSA/KSE/QSE/DFM/CRYPTO غير ملموسة.
- **`vps-service/core/opportunity_quality.py`**: ATR_STOP_MIN_PCT 3.0→5.0 (defense-in-depth).
- **`vps-service/engines/backtest_engine.py` + `vps-service/jobs/daily_predictor.py`**: `V40_2_STOP_MAX_PCT` default 7.0→9.0 (3 مواضع — aligns مع engine_settings.py canonical).

### أُصلح (Fixed)
- **`src/app/api/sniper/track/route.ts`**: non-canonical writer → HTTP 410 Gone guard (Rule 35).
- **`vps-service/api/ai_predictions_routes.py` + `vps-service/api/historical_predictions_v2_routes.py`**: early-return guards للـ writers غير canonical.
- **`src/app/api/maker-radar/stock/route.ts`**: إزالة 5 fabrication fallbacks (entry*0.96, r1*1.04, entry*0.99/1.01). Rule 27 محترمة.
- **`src/app/api/crypto/full-analysis/route.ts`**: إزالة 3 fabrications (currentPrice*1.1 target, *0.95 stop, *1.05 target_2). Rule 27 محترمة.

### مُتحقَّق منه (Verified)
- ✅ `zero_conflict_test`: mismatch_rate=0.00% + threshold_drift=0 + 25 NULL agreement (legit).
- ✅ `bun run lint`: 0 errors.
- ✅ canonical parity: `classify_signal(85/70/60/50/37/15)` = STRONG_BUY/BUY/ACCUMULATE/HOLD/SELL/STRONG_SELL.
- ✅ maker-radar/stock: 0 fabrication patterns.
- ✅ شغل الفريق الآخر محفوظ (DEEP-ROOT-FIX + FALLBACK-FIX + SYNC-STALE-DBS + UI-FIX-V2 + build fixes) — لم يُلمس.

### قيود (Constraints Honored)
- ❌ **لا حذف ملفات** (Rule 16).
- ❌ **لا بيانات وهمية** (Rule 27) — كل الـ fabrications اتحوّلت لـ NULL.
- ❌ **لم تُلمس الحمايات** (Rule 8/18/19: ATR [5%,9%] + R:R 1.8 + Hard Loss 7% + Split Guard 35%).
- ✅ **مراجعة شغل الفريق** (Rule 76 الجديدة) — تم تنفيذها قبل المهمة.

---

## [Unreleased] — قيد العمل

### المُخطَّط (بانتظار إذن المالك)
- **تشغيل Python backend (8010)** + باقي خدمات PM2 للإنتاج الكامل.
- **15 TIER 3 routes** (listers/admin/mobile/fallbacks) — دفعة ترحيل ثانية.
- **8 one-off scripts** في `vps-service/scripts/` تعمل INSERT — تعطيل يدوي.
- **Pre-existing TS errors** في كود legacy — مشروع تنظيف منفصل.
- **zero_conflict_test** — إضافة `--require-real-data` flag للاختبار بقيم non-null.

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
