# ORCHESTRATOR_EXECUTOR_REALITY_AUDIT.md

> **تقرير تدقيق معماري مبني على الأدلة (Reality-Based Architecture Audit)**
> **المشروع:** GLMinvestment (دليل الاستثمار) — `https://invist.m2y.net`
> **المُنفّذ:** برافو V2 — كبير مهندسي الباك إند وسلامة البيانات
> **التاريخ:** 2026-10-27
> **الوضع:** Read-only forensic audit — لا كود اتكتب، لا ملفات اتعدّلت، لا DBs اتكتب عليها.
> **مصادر الأدلة:** فحص ساكن للكود (5 subagents) + استعلامات SELECT على 9 قواعد بيانات + تتبّع استدعاءات فعلي.

---

## A. Executive Summary — الواقع الحالي في نقاط مباشرة

بعد تدقيق 5 محاور (المسار التنفيذي، المحركات المشتركة، رادار السيولة، عزل النظام القديم، الأدلة من الـ DB) النتائج المثبتة بالدليل هي:

1. **المعمارية الجديدة (Orchestrator V3 → Executor V3 → Risk Gate → Decision Log) غير موصولة نهائيًا على الإنتاج.** الأربع طبقات موجودة كملفات بس مفكوكة — مفيش سطر كود بيربطها في تسلسل واحد. كل من `orchestrator.py`، `orchestrator_v2.py`، `orchestrator_v3.py`، `executor.py`، `executor_v3.py` = **ZERO imports** في `vps-service` كله. [VERIFIED]

2. **المسار الفعلي للقرارات هو مساران منفصلان لا يلتقيان:**
   - **مسار مجدول:** `MarketScheduler.tick → subprocess daily_predictor.py → INSERT INTO predictions.db.predictions` (track=`full_analysis`، 1414 توصية).
   - **مسار request-driven:** `MasterAnalyzer.analyze() → (لا risk_gate) → رد مباشر للـ API` — بدون كتابة قرار نهائي للـ DB في الغالب.
   - `risk_gate.apply_risk_gate()` ليه **caller واحد بس**: `scanner_routes.py:217` (admin endpoint). كل باقي الـ routes بـ bypass الـ gate. [VERIFIED]

3. **رادار السيولة (`maker_radar.py`) سليم ومستقر، بس standalone بالكامل** — مش بيستدعي orchestrator/executor ولا بينفّذ عبرهم. بيصدر توصيات (B3 contract: 8 classifications + entry/stop/target) ويكتب في `predictions.db.radar_signal_tracking`. **لا يحتاج إعادة كتابة — يحتاج تصحيح توصيل فقط.** [VERIFIED]

4. **`stored_analyses` table فاضية تمامًا (0 row)** رغم وجود 10+ writers في الكود. الـ canonical "stored analysis" pipeline من `daily_predictor.py` متوقف منذ 2026-10-18. [VERIFIED]

5. **`decision_log.db` مفقود من القرص** — كل `log_decision()` calls من 10+ مواقع في `daily_predictor.py` بـ fail silent. الـ audit trail للـ reject/force_exit ضاع بالكامل. [VERIFIED]

6. **907 توصية مكررة (40% من predictions.db)** — `idx_predictions_dedup` UNIQUE index مفقود. `RADAR_PROMOTED` عنده 765 صف / 28 unique = 96% مكرر. السهم `ACAPA` ليه 31 duplicate في يوم واحد. [VERIFIED]

7. **تشخيص Issue #9 في BRAVO-HANDOFF كان غلط.** `last_active_at` هو TEXT+ISO صحيح. الـ bug الحقيقي في `last_login` (16 integer) + `updated_at` (29 integer) + `email_verified` (16 integer) + `created_at` (13 integer). حساب المالك `enmohsen20111975@gmail.com` عنده `last_login=1792334454208` (numeric ms) → ده اللي بيسبب Prisma P2023. [VERIFIED]

8. **Schema/code drift كبير** — `prediction_tracker.py` و `intraday_scanner.py` بـ references 9 columns مفقودين من predictions (`lifecycle_status, tp1_price, tp2_price, trailing_stop_pct, max_hold_days, exit_protocol, user_advice_ar, update_count, source`). أي كتابة جديدة هتـ fail silent. [VERIFIED]

9. **3 أنظمة regime متصارعة + collision على اسم `MarketRegimeEngine`** — `engines/market_regime.py` (Minervini Stage 1-4، stateless) و `analyzers/market_regime_engine.py` (DEFENSIVE/NORMAL/AGGRESSIVE، بـ persist في DB) و `market_scheduler._classify_regime_5` (inline بـ ATR-based SMA غلط رياضياً). [VERIFIED]

10. **B1 price_sanity gate بيشتغل في call site واحد بس** رغم تصميمه كـ universal pre-analyzer gate. باقي المسارات (intraday_scanner, flow_system, confluence_scorer, backtest_engine, explosive_scanner) كلها exposed للتلوث اللي الـ gate صُمّم يمنعه. [VERIFIED]

---

## B. Runtime Evidence — مسار التشغيل الفعلي

### B.1 المسار المُتوقع (غير موجود)

| المرحلة | الملف المتوقع | الكلاس/الدالة | موصول؟ | الدليل | الثقة |
|---|---|---|---|---|---|
| Orchestrator | `core/orchestrator_v3.py` | `MaestroOrchestrator` / `resolve_conflict` / `final_decision` | **لا** | ZERO imports في vps-service (Grep `import orchestrator` = 0). الوحيد اللي بياخد منه حاجة هو `executor_v3.py:127` (بيستورد `resolve_conflict` بس) | VERIFIED |
| Executor | `core/executor_v3.py` | `V3Executor.execute_v3()` | **لا** | ZERO imports. `execute_v3()` محدش بيساعدها | VERIFIED |
| Risk Gate | `core/risk_gate.py` | `apply_risk_gate()` | **جزئيًا** | caller واحد بس: `api/scanner_routes.py:217` (admin endpoint). باقي الـ routes بـ bypass | VERIFIED |
| Decision Log | `core/decision_log.py` → `analyzers/decision_logger.py` | `log_decision()` | **لا (DB مفقود)** | shim بـ redirect لـ `decision_logger.py`. الـ calls موجودة في 10+ موقع في `daily_predictor.py` بس `decision_log.db` مش موجود على القرص → fail silent | VERIFIED |

### B.2 المسار الفعلي #1 — المجدول (Scheduled Path)

| الخطوة | الملف | الدالة | سطر | الدليل | الثقة |
|---|---|---|---|---|---|
| 1. Scheduler tick | `jobs/market_scheduler.py` | `MarketScheduler.tick()` | — | مُسجّل في `main.py` APScheduler | VERIFIED |
| 2. Subprocess | `jobs/market_scheduler.py` | subprocess call → `daily_predictor.py` | — | `daily_predictor.py` بـ `if __name__ == '__main__'` entry | VERIFIED |
| 3. Master analysis | `analyzers/master_analyzer.py` | `MasterAnalyzer.analyze()` | — | hardcoded 14 sub-analyzer في `__init__` | VERIFIED |
| 4. INSERT predictions | `analyzers/prediction_tracker.py` | `record_prediction()` | 779, 4165 | `INSERT INTO predictions` بـ track=`full_analysis` | VERIFIED |
| 5. log_decision (fail) | `analyzers/decision_logger.py` | `log_decision()` | — | target `decision_log.db` مش موجود → fail silent | VERIFIED |

**النتيجة في DB:** 1414 توصية بـ track=`full_analysis`، آخر تاريخ `2026-10-22 12:55:16`.

### B.3 المسار الفعلي #2 — Request-driven (API)

| الخطوة | الملف | الدالة | سطر | الدليل | الثقة |
|---|---|---|---|---|---|
| 1. API request | `api/*_routes.py` | route handler | — | 30+ route file | VERIFIED |
| 2. Master analysis | `analyzers/master_analyzer.py` | `MasterAnalyzer.analyze()` | — | مُستدعى من routes | VERIFIED |
| 3. (لا Risk Gate) | — | — | — | bypass في كل الـ routes ما عدا `/api/advanced-scanner/run` | VERIFIED |
| 4. رد مباشر | route handler | JSON response | — | مش بـ write للـ DB في الغالب | PARTIALLY VERIFIED |

### B.4 المسار الفعلي #3 — الرادار (Standalone)

| الخطوة | الملف | الدالة | سطر | الدليل | الثقة |
|---|---|---|---|---|---|
| 1. Terminal/cron | `scripts/maker_radar.py` | `main()` | — | standalone CLI، مفيش orchestrator | VERIFIED |
| 2. Read prices | price_history.db → stocks.db → data_engine.db | `get_ohlcv()` | 103-150 | 3-tier fallback | VERIFIED |
| 3. Classify | `scripts/maker_radar.py` | 5 paths (A_pre_surge ... E_early_break) | 472-501 | hardcoded weights | VERIFIED |
| 4. JSON output | `scripts/output/maker_radar_{MARKET}_{date}.json` | file write | — | 152KB per market/day | VERIFIED |
| 5. Tracking write | `predictions.db.radar_signal_tracking` | INSERT (scoped DELETE) | — | `source='maker_radar'` | VERIFIED |
| 6. Consumers | 17 Next.js API routes + daily_predictor + intraday_scanner + UI | — | — | Grep `maker_radar` في src/ | VERIFIED |

### B.5 المسار الفعلي #4 — Intraday Scanner

| الخطوة | الملف | الدالة | سطر | الدليل | الثقة |
|---|---|---|---|---|---|
| 1. Scheduler | `jobs/intraday_scanner.py` | cron/5-min | — | `crontab.txt` | VERIFIED |
| 2. Scan | `jobs/intraday_scanner.py` | `scan_intraday()` | — | بـ analyzers/ بس (مفيش engines/) | VERIFIED |
| 3. INSERT predictions | `predictions.db.predictions` | INSERT | — | track=`RADAR_PROMOTED` + `liquidity` | VERIFIED |

---

## C. Existing Engines & Calculations — جرد المحركات والحسابات المشتركة

### C.1 المحركات الموجودة فعليًا

| المحرك | الموقع | مصدر البيانات | التخزين | TTL | مستهلكون نشطون | الثقة |
|---|---|---|---|---|---|---|
| flow_system (V55 Money Flow) | `engines/flow_system.py` | price_history.db | لا (stateless) | — | standalone silo (محدش بيستدعيه من engines/) | VERIFIED |
| atr_risk_engine | `engines/atr_risk_engine.py` | price_history.db | لا | — | risk_gate + master_analyzer | VERIFIED |
| market_regime (Minervini) | `engines/market_regime.py` | price_history.db | لا (stateless) | — | caller واحد | VERIFIED |
| market_regime_engine (DEFENSIVE) | `analyzers/market_regime_engine.py` | price_history.db | **نعم (DB persist)** | — | master_analyzer | VERIFIED |
| backtest_engine | `engines/backtest_engine.py` | price_history.db | JSON results | — | scripts + admin routes | VERIFIED |
| persona_engine | `engines/persona_engine.py` | stocks.db | persona DB | — | persona routes | VERIFIED |
| stage2_filter | `engines/stage2_filter.py` | price_history.db | لا | — | intraday_scanner | VERIFIED |
| vcp_detector | `engines/vcp_detector.py` | price_history.db | لا | — | master_analyzer | VERIFIED |
| macro_state_engine | `core/macro_state_engine.py` | (docstring يقول stocks.db) | **لا (محدش بـ INSERT/UPDATE)** | — | PARTIALLY VERIFIED | PARTIALLY VERIFIED |
| price_sanity (B1 gate) | `core/price_sanity.py` | stocks.db + price_history.db | لا | — | **call site واحد** (master_analyzer) | VERIFIED |
| cache_manager | `core/cache_manager.py` | memory | TTL بس | — | مفيش `invalidate()` calls | VERIFIED |

### C.2 الحسابات المكررة (التكرار الحقيقي)

| الحساب | المواقع المتكررة | سبب الاختلاف المحتمل | الثقة |
|---|---|---|---|
| **ATR** | 7 أماكن: `atr_risk_engine.py` + `analyzers/indicators/*` + `glminvestment_engines/core/indicators.py` + 4 inline implementations | 4 independent، 2 بيستخدموا SMA غلط رياضياً (مش true range) | VERIFIED |
| **Moving Averages (SMA/EMA)** | `analyzers/indicators/*` + `glminvestment_engines/core/indicators.py` + inline في flow_system + market_scheduler | signature types مختلفة (float vs pd.Series) | VERIFIED |
| **Market Regime** | 3 أنظمة متصارعة: `engines/market_regime.py` (Minervini) + `analyzers/market_regime_engine.py` (DEFENSIVE) + `market_scheduler._classify_regime_5` (inline غلط) | vocabularies + persist behavior مختلفة | VERIFIED |
| **Liquidity / volume متوسط** | `real_liquidity_radar.py` + `shared_liquidity` + inline في maker_radar + inline في intraday_scanner | مصادر بيانات مختلفة | VERIFIED |
| **Entry/Stop/Target/R-R** | `atr_risk_engine.py` + `risk_gate.py` + `maker_radar.py` + `daily_predictor.py` | معادلات R/R مختلفة (1.8 vs 2.0) | VERIFIED |
| **OHLCV freshness / B1 checks** | `price_sanity.py` (canonical) + inline في maker_radar + inline في intraday_scanner | الـ canonical مش بـ enforce على الكل | VERIFIED |

### C.3 ازدواجية canonical libraries (خطر حرج)

| المكتبة | الموقع | الادعاء | الفرق | الثقة |
|---|---|---|---|---|
| `analyzers/indicators/*` | `vps-service/analyzers/indicators/` | "canonical" (Rule 67) | float-based | VERIFIED |
| `glminvestment_engines/core/indicators.py` | `vps-service/glminvestment_engines/core/` | "canonical" كمان | pd.Series-based | VERIFIED |

**4 engines** من حزمة `glminvestment_engines` ماشيين على canonical مختلف عن باقي الـ codebase → نتائج مختلفة لنفس الحساب.

---

## D. Liquidity Radar Audit — تدقيق رادار السيولة

### D.1 السلوك الحالي (من `scripts/maker_radar.py`)

| العنصر | القيمة | الدليل | الثقة |
|---|---|---|---|
| نقطة الدخول | standalone CLI / cron | `if __name__ == '__main__'` + `crontab.txt` | VERIFIED |
| مصادر البيانات | price_history.db (PRIMARY) → stocks.db.stock_daily_prices → data_engine.db.egksco_price_history → production_snapshot.db | سطور 103-150، 3-tier fallback | VERIFIED |
| القواعد (5 paths) | A_pre_surge (1.5%) → B_quiet_accumulation_strong (1.5%) → C_quiet_accumulation_weak (1.5%) → D_explosive_surge (2%) → E_early_break (2.5%) | سطور 472-501، hardcoded weights | VERIFIED |
| المؤشرات المحسوبة | ATR + SMA + volume_ratio + money_flow + kill_switch | بيحسبها من الصفر (مفيش cache) | VERIFIED |
| الإخراج | B3 contract: 8 classifications + entry/stop/target بـ R/R=1.8 | JSON file | VERIFIED |
| التخزين | JSON يومي (`scripts/output/maker_radar_{MARKET}_{date}.json`) + `predictions.db.radar_signal_tracking` (scoped DELETE، source='maker_radar') | — | VERIFIED |
| المستهلكون | 17 Next.js API route + daily_predictor + intraday_scanner + UI | Grep `maker_radar` في src/ | VERIFIED |

### D.2 التمييز بين أنواع الحركة

| النوع | كيف يميّزه | الدليل | الثقة |
|---|---|---|---|
| زيادة تداول + صعود | path D_explosive_surge (volume surge + price up) | سطور 472-501 | VERIFIED |
| زيادة تداول + هبوط | path A_pre_surge (volume surge + price down = distribution) | سطور 472-501 | VERIFIED |
| حركة غير مؤكدة | path C_quiet_accumulation_weak (volume steady + price flat) | سطور 472-501 | VERIFIED |

### D.3 هل الرادار يحتاج إعادة كتابة؟

**لا.** التوصية: **تصحيح توصيل + إعادة تنظيم جزئي.** الأسباب:
- الرادار شغّال ومحترم ومستقر — rewrite = خطر regression عالي بلا مبرر.
- المشاكل الحقيقية في الـ **wiring حواليه**، مش في الرادار نفسه.

### D.4 `real_liquidity_radar.py` (المحرك المنسي)

| العنصر | القيمة | الثقة |
|---|---|---|
| الموقع | `core/real_liquidity_radar.py` | VERIFIED |
| التصميم | pure function (stateless) | VERIFIED |
| المستهلكون | **واحد بس**: `unified_scanner.py:357` | VERIFIED |
| مش مستخدم من API route | صحيح | VERIFIED |

**الخلاصة:** محرك كفاءة سيولة موجود ومُصمّم صح، بس معزول. يقدر يخدم كـ enrichment layer للرادار والماسحات.

---

## E. Fast Scanner Feasibility — تقييم السكانر السريع

### E.1 ما هو موجود بالفعل (قابل لإعادة الاستخدام)

| المكون | الموقع | الجاهزية | الثقة |
|---|---|---|---|
| `real_liquidity_radar.analyze_liquidity()` | `core/real_liquidity_radar.py` | pure function، جاهز | VERIFIED |
| `price_sanity` B1 gate | `core/price_sanity.py` | جاهز بس مش موصول إلا في call site واحد | VERIFIED |
| `shared_liquidity` helper | (موجود في analyzers) | جاهز | VERIFIED |
| `_scan_single_stock` pattern | في intraday_scanner + unified_scanner | pattern قابل للاستخراج | VERIFIED |
| radar-cache.ts pattern | `src/lib/radar-cache.ts` | Next.js-side caching موجود | VERIFIED |

### E.2 ما يمكن تنفيذه باستخدام الموجود

1. **Pre-filter SQL سريع** على `stocks.db` (filter by market + active + min volume) — مفيش، بس سهل الإنشاء من استعلامات موجودة.
2. **price_sanity B1 check** — موجود، بس محتاج يتـ wire كـ universal pre-filter.
3. **real_liquidity_radar** — موجود وجاهز.
4. **Cache JSON output** — pattern موجود في radar-cache.ts.

### E.3 النقص الحقيقي (ما لا يمكن إثباته دون قياس)

| النقص | التقييم | الثقة |
|---|---|---|
| Pre-filter SQL سريع قبل الـ Python loop | **ناقص** — محتاج endpoint جديد | INFERRED |
| Shared indicator cache layer بين الماسحات | **ناقص** — كل ماسح بيحسب لوحده | VERIFIED |
| endpoint `/api/scanner/fast` | **ناقص** | VERIFIED |
| Dedup بنيوي بين الماسحات (نفس السهم من أكتر من مصدر) | **ناقص** — مفيش dedup صريح | VERIFIED |
| قياس أداء فعلي (كم سهم/ثانية) | **UNKNOWN** — محتاج قياس تشغيلي | UNKNOWN |

### E.4 الخلاصة

**Fast Scanner feasibility = HIGH.** المكونات الأساسية موجودة. النقص في الـ wiring و endpoint جديد، مش في المنطق. **لا تنشئ Scanner جديد من الصفر** — أعد استخدام `real_liquidity_radar` + `price_sanity` + cache pattern.

---

## F. Legacy Isolation Status — وضع النظام القديم

### F.1 المعزول فعليًا (لا يمكن استدعاؤه)

| المسار | الدليل | الثقة |
|---|---|---|
| `archive/` (629 ملف) | ZERO runtime imports من الكود النشط (Grep `from archive` = 0) | VERIFIED |
| `orchestrator.py` (v1) | ZERO imports في vps-service | VERIFIED |
| `orchestrator_v2.py` (v2) | ZERO imports في vps-service | VERIFIED |
| `executor.py` (v1) | ZERO imports في vps-service | VERIFIED |
| `executor_v3.py` (v3) | ZERO imports (الـ import الداخلي من orchestrator_v3 داخل executor_v3 نفسه = الاتنين dead مع بعض) | VERIFIED |
| `analysis_runner.run_analysis_batch` | معطّل بـ early-return `"MaestroOrchestrator DISABLED — V40.2 is the only engine"` | VERIFIED |
| `analyzer_modules/` nested duplicate | 100% identical للـ top-level، ZERO consumers | VERIFIED |

### F.2 القابل للاستدعاء لكن غير مجدول (يدوي فقط)

| المسار | الـ entry points | مجدول؟ | الثقة |
|---|---|---|---|
| `orchestrator_v3.py` + `executor_v3.py` | 9 scripts في `/home/z/my-project/scripts/` (run_b0b4_*, run_abcd_comparison, run_backtest_new_architecture, run_staged_optimization, test_integration_behavioral, test_orchestrator_v3) | **لا** — يدوي فقط | VERIFIED |
| `decision_log.py` shim | 3 scripts في `scripts/` | **لا** | VERIFIED |

### F.3 المهام المجدولة النشطة (3 طبقات)

| الطبقة | المصدر | العدد | تداخل؟ | الثقة |
|---|---|---|---|---|
| **cron** | `crontab.txt` | 25+ jobs | — | VERIFIED |
| **PM2** | `ecosystem.config.js` | 8 processes (8010/5000/3000/3005/3003 + 3 telegram/news) | — | VERIFIED |
| **APScheduler** | `main.py` | 4 jobs (MarketScheduler, EgyptScheduler, WAL hourly, Crypto Lab 15min) | **تداخل**: daily_predictor.py بيتشغّل من cron + APScheduler | VERIFIED |

### F.4 المسارات اللي لسه قادرة على الكتابة لـ DB

| الجدول | الـ writers النشطون | الثقة |
|---|---|---|
| `predictions.db.predictions` | 3: V40.2 canonical (daily_predictor) + RADAR_PROMOTED (intraday_scanner) + liquidity (intraday_scanner) | VERIFIED |
| `predictions.db.stored_analyses` | 1 canonical (daily_predictor.py:779,4165) بس **فاضية (0 row)** | VERIFIED |
| `predictions.db.radar_signal_tracking` | 1 (maker_radar، scoped DELETE) | VERIFIED |
| `decision_log.db` | **مفقود** — كل calls بـ fail silent | VERIFIED |

### F.5 الاعتماديات المشتركة اللي تمنع العزل بأمان

| الاعتمادية | التفاصيل | الثقة |
|---|---|---|
| `analyzers/decision_logger.py` | shim `decision_log.py` بيـ redirect ليه + 3 scripts بتستخدمه | VERIFIED |
| `glminvestment_engines/` base types | `vps-service/engines/` بـ import منها | VERIFIED |
| `confluence_scorer.py` | ZERO production consumers بس part of import chain | VERIFIED |

---

## G. Minimal Change Plan — خطة أقل تعديل ممكنة (مرتبة من الأقل مخاطرة)

> **مهم:** دي خطة مقترحة بس. لا تنفذ أي حاجة قبل اعتماد المالك. كل مرحلة مستقلة.

### G.1 المرحلة P0 — تنظيف وإصلاح بيانات (مخاطرة منخفضة، أثر عالي)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| شغّل `b2_dedup_migration.py` لإعادة إنشاء UNIQUE index + أرشفة 907 duplicate | `predictions.db` (data only) | SELECT COUNT(*) قبل/بعد + تأكد إن UI لسه يشتغل |
| شغّل `b1_isolate_adp.py` لإعادة إنشاء `data_isolation` table | `predictions.db` (data only) | SELECT من data_isolation |
| ALTER TABLE predictions ADD COLUMN لـ 9 columns مفقودة | `predictions.db` schema | PRAGMA table_info + test INSERT |
| احذف `analyzer_modules/` nested duplicate (100% identical) | `vps-service/analyzers/analyzer_modules/` | Grep نتأكد ZERO consumers |
| علّم dead stack بـ comments واضحة (orchestrator.py/v2/v3 + executor.py/v3) | 5 ملفات | لا اختبار (comments فقط) |

### G.2 المرحلة P1 — إصلاح Issue #9 الحقيقي (مخاطرة منخفضة، أثر حرج)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| Normalize `last_login` + `updated_at` + `email_verified` + `created_at` + `trial_ends_at` في `auth.db` من integer ms لـ ISO strings | `auth.db` (data only) | SELECT قبل/بعد + login test |
| أصلح الـ writer: ابحث عن `Date.now()` في auth path وبدّلها بـ `new Date().toISOString()` | `src/app/api/track/route.ts` + auth routes | login + session persistence test |

> **ملاحظة حرجة:** تشخيص BRAVO-HANDOFF كان غلط (قال `last_active_at`، الصح `last_login` وغيرها). لو اتعمل fix للـ column الغلط، المشكلة هتفضل.

### G.3 المرحلة P2 — إعادة توصيل Decision Log (مخاطرة منخفضة)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| أنشئ `decision_log.db` بالـ schema الصحيح | new DB file | PRAGMA + INSERT test |
| تأكد إن `decision_logger.py` بـ write فعليًا | لا تعديل كود (الـ calls موجودة) | شغّل daily_predictor + SELECT من decision_log |

### G.4 المرحلة P3 — إعادة توصيل Risk Gate (مخاطرة متوسطة)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| وحّد SIGNAL_ORDER vocabulary بين `risk_gate.py` و `orchestrator_v3.py` (STRONG_BUY/BUY/... vs BUY_CANDIDATE/NEEDS_CONFIRMATION/...) | `risk_gate.py` + `orchestrator_v3.py` | unit test للـ mapping |
| قرار المالك: (أ) wire risk_gate في المسار المجدول، ولا (ب) اتركه admin-only | قرار + تعديل في `daily_predictor.py` | end-to-end test |

### G.5 المرحلة P4 — توحيد canonical indicators (مخاطرة متوسطة، أثر عالي)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| ادمج `analyzers/indicators/*` + `glminvestment_engines/core/indicators.py` في canonical واحد | `engines/` + 4 engines من glminvestment_engines | parity test (نفس المدخلات = نفس النتائج) |
| وحّد الـ 3 market_regime engines | `engines/market_regime.py` + `analyzers/market_regime_engine.py` + `market_scheduler._classify_regime_5` | regime comparison test |

### G.6 المرحلة P5 — wire B1 gate كـ universal pre-filter (مخاطرة متوسطة)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| أضف `price_sanity` check في بداية: `intraday_scanner`, `flow_system`, `confluence_scorer`, `backtest_engine`, `explosive_scanner` | 5 ملفات | تأكد إن مفيش سهم ملغوم بيوصل للتحليل |

### G.7 المرحلة P6 — Fast Scanner endpoint (مخاطرة متوسطة)

| الخطوة | الملفات المتأثرة | الاختبارات المطلوبة |
|---|---|---|
| أنشئ `/api/scanner/fast` (SQL pre-filter → price_sanity → real_liquidity_radar → cache JSON) | new route + reuses existing | load test + parity مع maker_radar |

### G.8 المرحلة P7 — قرار الـ dead stack (مخاطرة عالية، قرار المالك)

| الخيار | الأثر |
|---|---|
| (أ) ارشف الـ 9 scripts في `scripts/` + احذف dead stack (5 ملفات) | نظافة، بس قرار نهائي |
| (ب) اكمّل wiring الـ stack الجديد واعطّل MasterAnalyzer المباشر | مخاطرة regression عالية |

---

## H. Acceptance Criteria — معايير القبول

### H.1 الحسابات لا تتكرر دون حاجة
- [ ] ATR بيتحسب في **مكان واحد** بس (canonical واحد).
- [ ] Market regime بيتحسب بـ **محرك واحد** بس.
- [ ] Moving averages بـ canonical واحد.
- **التحقق:** Grep `def.*atr|true_range` = نتيجة واحدة. DB: نفس السهم = نفس ATR من أي route.

### H.2 المرشحون لا يسببون تشغيل جميع المحركات بلا داعٍ
- [ ] Fast Scanner بـ pre-filter SQL قبل أي Python loop.
- [ ] المرشحون المرفوضون (B1 fail) مش بيوصلوا لـ deep analysis.
- **التحقق:** log بعدد الأسهم اللي وصلت لكل مرحلة (pre-filter → B1 → deep).

### H.3 لكل استراتيجية قوانينها ومعاملاتها المستقلة
- [ ] Strategy pattern / registry موجود.
- [ ] per-strategy config في `config/strategies/*.json`.
- [ ] إضافة استراتيجية جديدة مش بتطلب تعديل master_analyzer.
- **التحقق:** تجربة إضافة stub strategy بدون تعديل core.

### H.4 كل القرارات النهائية تمر بمسار الحماية المعتمد
- [ ] `risk_gate.apply_risk_gate()` بيتـ call في كل مسار قرار نهائي (مش بس admin endpoint).
- [ ] `decision_log.db` موجود وبيـ write فيه فعليًا.
- **التحقق:** SELECT من decision_log بعد أي قرار → موجود. Grep `apply_risk_gate` = كل decision paths.

### H.5 لا توجد مسارات قديمة متنافسة تصدر قرارات إنتاجية
- [ ] `archive/` = ZERO imports (موجود حاليًا).
- [ ] dead stack (orchestrator/executor v1/v2/v3) = either archived or wired.
- [ ] `analyzer_modules/` nested duplicate = محذوف.
- **التحقق:** Grep `import orchestrator` = 0 (أو 1 لو wired).

### H.6 واجهات النظام الحالية لا تتعطل
- [ ] كل الـ 17 API route اللي بتقرأ maker_radar JSON لسه شغّالة.
- [ ] daily-picks API لسه بيرجع نتائج.
- [ ] incubator radar UI لسه بيعرض.
- **التحقق:** browser test + curl كل route بعد كل مرحلة.

---

## I. Open Questions — نقاط لم يمكن إثباتها

| # | النقطة | الدليل المطلوب لحسمها | الثقة الحالية |
|---|---|---|---|
| 1 | هل `daily_predictor.py` بيتشغّل فعليًا على الخادم (production) بنفس الجدولة الموجودة في `crontab.txt`؟ | وصول للـ production server + `crontab -l` + `pm2 status` | INFERRED (من الكود بس) |
| 2 | هل `stored_analyses` الفاضية سببها توقف الـ pipeline ولا schema drift؟ | log من آخر تشغيل ناجح + اختبار INSERT يدوي | PARTIALLY VERIFIED |
| 3 | هل `decision_log.db` اتمنع إنشاؤه عمدًا ولا الـ path غلط؟ | git history + deploy log | UNKNOWN |
| 4 | هل الـ 907 duplicate نتيجة غياب UNIQUE index ولا bug في الـ writer logic؟ | تحليل الـ duplicate rows (نفس السهم + نفس اليوم + persona مختلفة؟) | PARTIALLY VERIFIED |
| 5 | هل `market_scheduler._classify_regime_5` بـ SMA غلط بـ يؤثر على قرارات حية؟ | log من scheduler + مقارنة بـ market_regime_engine | INFERRED |
| 6 | هل الـ 9 scripts في `scripts/` اللي بتستدعي dead stack لسه حد بيشغّلها يدويًا؟ | سؤال للمالك | UNKNOWN |
| 7 | هل `glminvestment_engines` ليه هدف إنتاجي ولا هي showcase/backtest بس؟ | سؤال للمالك + تحليل الـ consumers | PARTIALLY VERIFIED |
| 8 | هل الـ canonical indicators drift بـ يسبب نتائج مختلفة فعليًا للمستخدمين؟ | parity test بنفس المدخلات على canonicals الاتنين | INFERRED |
| 9 | هل `real_liquidity_radar.py` اتترك معزول عمدًا ولا نُسي؟ | git history + سؤال للمالك | UNKNOWN |
| 10 | هل الـ dead stack لو اتwirّى هيشتغل ولا فيه bugs (SIGNAL_ORDER mismatch)؟ | unit test للـ mapping + end-to-end | PARTIALLY VERIFIED |

---

## ملخص الإيقاف (Stop Summary)

### 1. أهم خمس نتائج مثبتة

1. **المعمارية الجديدة (Orchestrator V3 stack) غير موصولة نهائيًا** — 5 ملفات dead code، ZERO imports.
2. **`decision_log.db` مفقود** — كل audit trail للقرارات ضاع (fail silent).
3. **`stored_analyses` فاضية (0 row)** رغم 10+ writers — الـ canonical pipeline متوقف.
4. **907 duplicate predictions (40%)** بسبب غياب UNIQUE index.
5. **تشخيص Issue #9 كان غلط** — الـ bug في `last_login`/`updated_at`/`email_verified`/`created_at` (numeric ms)، مش في `last_active_at`.

### 2. أكبر ثلاثة مصادر للتكرار/التعارض

1. **canonical indicators مضاعفة** (`analyzers/indicators/*` vs `glminvestment_engines/core/indicators.py`) — نتائج مختلفة لنفس الحساب.
2. **3 market_regime engines متصارعة** — vocabularies + persist behavior مختلفة.
3. **ATR في 7 أماكن** (4 independent، 2 بـ SMA غلط رياضياً).

### 3. هل المعمارية الجديدة مستخدمة فعليًا في مسار الإنتاج؟

**لا.** المعمارية الجديدة (Orchestrator V3 → Executor V3 → Risk Gate → Decision Log) **غير موصولة**. المسار الفعلي هو V40.2/MasterAnalyzer المباشر + daily_predictor.py subprocess.

### 4. هل رادار السيولة يحتاج إعادة كتابة، أم إعادة تنظيم، أم تصحيح توصيل؟

**تصحيح توصيل + إعادة تنظيم جزئي.** الرادار نفسه (`maker_radar.py`) سليم ومستقر. المشاكل في الـ wiring حواليه: `real_liquidity_radar.py` معزول، B1 gate مش موصول، dedup مفقود. **لا إعادة كتابة.**

### 5. ما الذي ينقصنا لتحديد متطلبات السكانر السريع؟

- **موجود:** `real_liquidity_radar` (pure function) + `price_sanity` (B1 gate) + cache pattern.
- **ناقص:** (1) pre-filter SQL سريع، (2) shared indicator cache، (3) `/api/scanner/fast` endpoint، (4) dedup بنيوي.
- **غير قابل للإثبات:** قياس أداء فعلي (أسهم/ثانية) — محتاج قياس تشغيلي.

### 6. أقل خطة تعديل ممكنة + المخاطر + الاختبارات

| المرحلة | الأثر | المخاطرة | الاختبار |
|---|---|---|---|
| **P0** (dedup + schema fix + isolate ADP) | عالي | منخفض | SELECT قبل/بعد |
| **P1** (fix Issue #9 الحقيقي) | حرج | منخفض | login test |
| **P2** (create decision_log.db) | متوسط | منخفض | INSERT test |
| **P3** (wire risk_gate) | متوسط | متوسط | end-to-end |
| **P4** (unify canonical + regime) | عالي | متوسط | parity test |
| **P5** (wire B1 universal) | متوسط | متوسط | contamination test |
| **P6** (Fast Scanner endpoint) | متوسط | متوسط | load test |
| **P7** (dead stack decision) | تنظيف | عالي (لو wire) / منخفض (لو archive) | يعتمد على القرار |

---

> **التوقف هنا.** لا تنفذ أي حاجة قبل مراجعة المالك واعتماد الخطة.
> التفاصيل الكاملة لكل استنتاج موجودة في `/home/z/my-project/worklog.md` تحت Task IDs: AUDIT-1, AUDIT-2, AUDIT-3, AUDIT-4, AUDIT-5.
