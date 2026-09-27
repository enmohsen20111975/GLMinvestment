# 🔬 GLMinvestment — Master Dissection & Code Audit Report
# Lead Code Auditor — 2026-08-19
# Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅

====================================
MASTER DISSECTION — FINAL REPORT
====================================

## الإحصائيات المرعبة

| Metric | Count |
|--------|-------|
| Python files | 442 |
| Node API routes | 595 |
| Decision engines (تحتوي على signal logic) | 31 |
| Active production engines (تكتب predictions) | 6 |
| Dead/deprecated route files | 16 |
| Orphan Python files | 6+ |
| Hardcoded thresholds detected | ~110 |
| DRIFT cases (تضارب مع engine_settings) | 28 |
| Files opening DBs directly (bypass canonical) | 250+ |
| Files reading price_history via raw SQL | 40+ |
| Different schemas for tab_balance_sheet | 4 |
| Definitions of load_merged_history | 2 (split-brain) |

---

# 1. الخطايا المعمارية الكبرى (The Architecture Sins)

## الخطيئة #1: ستة محركات إنتاج متوازية تكتب على نفس الجدول

`predictions` table تستقبل writes من **6 مصادر مختلفة** بدون UNIQUE constraint:

1. `maestro_orchestrator.py:3462` → `PredictionTracker.record_prediction` (post-market scan)
2. `v40_2_daily_generator.py:417` → `PredictionTracker.record_prediction` (cron 15:05)
3. `sniper_routes.py:795` → `INSERT INTO predictions` **مباشر** (on-demand)
4. `ai_predictions_routes.py:848` → `INSERT INTO predictions` + `INSERT INTO aiPrediction`
5. `historical_predictions_v2_routes.py:466` → `INSERT INTO predictions` (admin backfill)
6. `crypto_prediction_engine.py:352` → `INSERT INTO crypto_predictions` (separate table)

**العاقبة:** صفوف متضاربة لنفس (ticker, prediction_date) من مصادر مختلفة.
`daily_closer` قد يُغلق الصف الخطأ.

## الخطيئة #2: SniperRoutes يكتب INSERT مباشر بدون مرور على PredictionTracker

```python
# sniper_routes.py:795-814 — 13 عمود فقط
cursor.execute('''INSERT INTO predictions
    (ticker, market, signal, signal_ar, confidence,
     entry_price, target_price, stop_loss, risk_reward,
     persona, status, maestro_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', ...)
```

بينما `record_prediction` يضع **22+ عمود** (يشمل `target_price_2`, `explosive_score`,
`evidence_count`, `morning_bell`, `kill_filter_result`).

**التعليق الاعترافي:** `sniper_routes.py:762`:
> `"# sniper_routes بـ يعمل INSERT مباشر (مش عبر record_prediction) فلازم نضيف"`

## الخطيئة #3: ثلاثة عتبات مختلفة لـ STRONG_BUY

| الملف | Threshold | السطر |
|------|-----------|------|
| `master_analyzer.py` | 80 | L434 |
| `confluence_engine_v3.py` | 75 ("Raised from 80") | L105 |
| `scoring_fix.py` | 70 ("أقل من 80 - أسهل") | L23 |
| `board_of_analysts.py` | 90 | L567 |
| `technical_weighted.py` | 65 | L110 |

**5 thresholds مختلفة لنفس المفهوم** — تباين 25 نقطة بين أعلى وأدنى!

## الخطيئة #4: Split-Brain في قراءة الأسعار

3 مصادر منفصلة لنفس البيانات:
1. `price_history.db.price_history` — المصدر الرسمي (40+ ملف يقرأ مباشرة)
2. `stocks.db.stock_daily_prices` — مصدر موازٍ (40+ ملف يقرأ منه)
3. `load_merged_history()` — الدالة الرسمية (7 callers فقط من 250+ ملف!)

**انتهاك Rule:** `prices.py:53-57` يقول: *"NO file may define load_merged_history"*
لكن `master_analyzer.py:778` يعرّفها بنفسه (300+ سطر، source-normalization منفصل).

## الخطيئة #5: Column-Shift في tab_balance_sheet

الـ schema الفعلي (من scraper): `(symbol TEXT, data TEXT)` — عمودين فقط.
لكن 4 schemas مختلفة متوقعة:
- `migrator.py:546` يفترض 8 أعمدة (ticker, total_assets, ...)
- `chart_routes.py:2411` يقرأ `total_assets, total_liabilities`
- `fundamental_data_provider.py:313` يقرأ `symbol, total_equity, debt`
- `persona_screener.py:260` يقرأ `market` غير معرّف

**النتيجة:** 8 صفوف shifted موثّقة. fundamental_data_provider يصطاد الخطأ بـ try/except
وُيرجع `None` بصمت → **كل التحليل الأساسي (debt, current_ratio, cash) = None في الإنتاج.**

## الخطيئة #6: Broken Blueprint Registration

`lightweight_server.py:42` يستورد `ai_predictions_bp` لكن الملف يعرّف `ai_pred_bp`
(بدون 's') → **7 routes تحت `/api/ai-predictions/*` كلها 404** بصمت.

## الخطيئة #7: V40.3 Directive لم ينتشر

المالك أصدر V40.3 DIRECTIVE: R/R floor مطلق = 1.5 تحت كل الظروف.
لكن:
- `admin/engine-settings/route.ts:62` → `min_rr_bear_market: 1.5` (should be 1.8)
- `admin/engine-settings/route.ts:63` → `min_rr_range_market: 1.2` (should be 1.5)
- `dynamic_target_engine.py:140` → gambler `min_rr = 1.2` (violates floor)
- `prediction_optimizer.py:332` → bull `min_rr = 1.2` (should be 2.0)

## الخطيئة #8: confidence_top_pick = 75 لم ينتشر في 7 مواقع

engine_settings غيّر `confidence_top_pick` من 80 → 75. لكن 7 مواقع لا تزال تستخدم 80:
- `flow_system.py:619`, `crypto_engine.py:234,320`, `explosive_scanner.py:467`
- `v2/unified/analyze/route.ts:85`, `ai/analyze-stock/route.ts:66`
- `ai/batch-analysis/route.ts:41`, `maestro/stock/[ticker]/route.ts:453`

## الخطيئة #9: 250+ ملف يفتح DBs مباشرة

`utils/db_paths.py` يعرّف `DBPaths` canonical لكن **5 ملفات فقط تستورده**.
كل route يعيد اختراع حساب المسار بـ 4+ أنماط مختلفة:
- `str(_PROJECT_ROOT / 'db' / 'predictions.db')`
- `os.environ.get('PREDICTIONS_DB', ...)`
- `os.path.join(PROJECT_ROOT, 'db', 'predictions.db')`
- `Path(__file__).parent.parent / 'db' / ...`

## الخطيئة #10: Learning Loop مكسور تماماً

`learned_lessons` table = **0 rows**. النظام يسجل lessons فقط في `prediction_logs`
(الذي آخر تحديث له 2025-02-20) لكن لا يطبقها. `expert_memory` module يقرأ
من جدول فارغ → كل lessons = None → النظام لا يتعلم.

---

# 2. جدول الازدواجية والتضارب (Conflict Matrix)

## A. محركات القرار المكررة

| المفهوم | الملف القديم | الملف الجديد | المعتمد | التضارب |
|---------|-------------|-------------|---------|---------|
| Confluence | `confluence_engine.py` (V1, STRONG_BUY=80) | `confluence_engine_v3.py` (V3, STRONG_BUY=75) | V3 داخل BoardOfAnalysts | Thresholds مختلفة |
| Smart Confluence | `smart_confluence_engine.py` ("STRONG BUY" بمسافة) | `maestro_orchestrator.py` | Maestro | String mismatch يكسر switch/case |
| Crypto | `crypto_full_system.py` (DEAD) | `crypto_prediction_engine.py` | prediction_engine | Dead code كامل |
| Live | `live_prediction_engine.py` (DEAD) | `live_indicator_engine.py` | indicator_engine | Thresholds مختلفة |
| Backfill | `smart_confluence_routes.py` (DEPRECATED) | `historical_predictions_v2_routes.py` | v2_routes | مساران مكرران |
| Analysis | `analysis_engine_v2.py` (DEPRECATED) | `master_analyzer.py` | master_analyzer | Plugin-based مهجور |
| Backtest | `backtest_engine.py` + `walk_forward_backtest.py` + `kimi_backtest.py` (3 DEPRECATED) | `v38_backtest_engine.py` | V38/V40.2 | 3 محركات backtest ميتة |

## B. عتبات متضاربة

| العتبة | engine_settings | الملفات المتضاربة | القيم المتضاربة |
|--------|----------------|------------------|----------------|
| min_rr_bull | 2.0 | prediction_optimizer:332, dynamic_target:140 | 1.2 (40% أقل!) |
| min_rr_bear | 1.8 | admin/route.ts:62, prediction_optimizer:332 | 1.5 (17% أقل) |
| min_rr_range | 1.5 | admin/route.ts:63, dynamic_target:116,124,132 | 1.2-1.3 (تحت الأرضية) |
| confidence_top_pick | 75 | 7 مواقع (flow/crypto/explosive/v2/ai/maestro) | 80 (لم ينتشر) |
| min_prediction_score | 60 | live_pred:440, crypto_full:580, expert-consensus:27 | 30-55 (نصف العتبة) |
| risk_per_trade_pct | 1.5 | risk_adaptive:310, risk.py:77 | 2.0 (33% أعلى) |
| trailing_stop_atr | 2.0 | sniper_engine:1441, sniper_filter:98 | 3.0 (50% أوسع) |
| persona_trail_balanced | 2.0 | sniper_engine:1850 | 3.0 (+1.0 ATR) |
| min_volume_shares | 50,000 | liquidity_filter:487 | 100,000 (ضعف) |
| STRONG_BUY score | 80 (master) | board:90, tech_weighted:65, scoring_fix:70, confluence_v3:75 | 65-90 (تباين 25 نقطة) |

## C. مسارات DB متضاربة

| المصدر | المسار | المستخدمون |
|--------|--------|-----------|
| price_history.db | `db/price_history.db` | 40+ ملف (raw SQL) |
| stocks.db.stock_daily_prices | `db/stocks.db` | 40+ ملف (raw SQL) |
| load_merged_history() | canonical | 7 callers فقط |
| DBPaths | `utils/db_paths.py` | 5 مستوردين فقط |

## D. Routes مكررة في Node.js

| Route 1 | Route 2 | التضارب |
|---------|---------|---------|
| `/api/proxy/[...path]` | `/api/python/[...path]` | نفس proxyRequest() — duplicate كامل |
| `/api/predictions` | `/api/predictions/tracking` | prefix overlap |
| `/api/predictions` | `/api/v2/predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/real-predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/global-predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/mobile/predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/unified/predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/admin/ai-predictions` | مساران للنفس البيانات |
| `/api/predictions` | `/api/ai-predictions` | مساران للنفس البيانات |

---

# 3. قائمة الأسئلة الحرجة للمالك (Needs Owner)

## 🔴 P0 — حرجة إنتاجياً (تؤثر على جودة الإشارات)

### Q1: توحيد مسار الكتابة على predictions
**السؤال:** هل أوحّد كل الـ 6 مسارات (Maestro + V40.2 + Sniper + ai_predictions + backfill + crypto)
على `PredictionTracker.record_prediction` فقط؟
- يلزم: إصلاح sniper_routes INSERT المباشر
- يلزم: إضافة `UNIQUE(ticker, prediction_date, source)` على جدول predictions
- المخاطرة: قد يتوقف sniper on-demand tracking مؤقتاً

### Q2: توحيد STRONG_BUY threshold
**السؤال:** ما القيمة الرسمية لـ STRONG_BUY؟ (80 / 75 / 70 / 90 / 65)
- مقترح: 75 (كما في engine_settings.confidence_top_pick)
- يلزم: تحديث 5 ملفات (board_of_analysts, technical_weighted, scoring_fix, confluence_v1, confluence_v3)

### Q3: إصلاح V40.3 R/R drift
**السؤال:** هل أحدّث admin/engine-settings/route.ts fallback + dynamic_target_engine.py persona thresholds
إلى V40.3 floor (1.5 مطلق)؟
- يلزم: تحديث 5 مواقع
- المخاطرة: بعض personas (gambler) سترفض صفقات كانت تقبلها

### Q4: إصلاح broken ai_predictions_bp registration
**السؤال:** هل أصحح `lightweight_server.py:42` من `'ai_predictions_bp'` إلى `'ai_pred_bp'`؟
- يلزم: تغيير سطر واحد
- المخاطرة: قد تظهر routes كانت ميتة وتستهلك resources

## 🟡 P1 — تنظيف الكود الميت

### Q5: حذف 15 orphan blueprint files
**السؤال:** هل أحذف الـ 15 ملف route المُعلّم DEPRECATED + غير مسجّل؟
- القائمة الكاملة: educational_cards, kimi_backtest, market_status, multi_market,
  performance_dashboard, v2_analytics, hunter, data_engine, analysis_engine,
  analysis, backtest, crypto, crypto_simulation, smart_confluence, walk_forward
- المخاطرة: VERIFY-BEFORE-DELETE مطلوب (بعضها قد يُستدعى من admin)

### Q6: حذف 3 محركات dead code كاملة
**السؤال:** هل أحذف هذه المحركات المهجورة تماماً؟
1. `analyzers/dynamic_analysis_engine.py` — 0 callers
2. `engine/live_prediction_engine.py` — 0 callers
3. `engine/crypto_full_system.py` — 0 callers
- المخاطرة: منخفضة (لا مستورِد خارجي)

### Q7: توحيد load_merged_history
**السؤال:** هل أحذف التعريف المكرر في `master_analyzer.py:778` وأجبر الجميع على
استخدام `data/prices.py:load_price_history`؟
- يلزم: إعادة هيكلة 40+ ملف
- المخاطرة: عالية (قد يكسر analyzers)

### Q8: إصلاح column-shift في tab_*
**السؤال:** هل أُصلح 8 صفوف shifted في tab_balance_sheet + tab_income_statement؟
- يلزم: script تنظيف + backup
- المخاطرة: منخفضة (البيانات الفاسدة تُرجع None أصلاً)

## 🟢 P2 — تحسينات معمارية

### Q9: توحيد DBPaths
**السؤال:** هل أُهاجر كل 250+ ملف لاستخدام `utils/db_paths.py`؟
- المخاطرة: عالية جداً (تغيير واسع)

### Q10: توحيد confidence_top_pick = 75
**السؤال:** هل أحدّث 7 مواقع من 80 → 75؟
- المخاطرة: منخفضة (aligning to engine_settings)

---

# 4. خطة الجراحة الموصى بها

## المرحلة 1: إصلاحات حرجة فورية (بدون حذف)

```
STEP 1.1: إصلاح broken blueprint registration
  → lightweight_server.py:42: 'ai_predictions_bp' → 'ai_pred_bp'
  → يُفعّل 7 routes كانت ميتة

STEP 1.2: توحيد SniperRoutes على PredictionTracker
  → sniper_routes.py:795: استبدال INSERT المباشر بـ record_prediction()
  → يضمن schema متسق

STEP 1.3: إصلاح V40.3 R/R drift (5 مواقع)
  → admin/engine-settings/route.ts:62,63
  → dynamic_target_engine.py:116,124,132,140
  → prediction_optimizer.py:332

STEP 1.4: توحيد confidence_top_pick = 75 (7 مواقع)
  → flow_system.py:619
  → crypto_engine.py:234,320
  → explosive_scanner.py:467
  → v2/unified/analyze/route.ts:85
  → ai/analyze-stock/route.ts:66
  → ai/batch-analysis/route.ts:41
  → maestro/stock/[ticker]/route.ts:453
```

## المرحلة 2: حذف الكود الميت (VERIFY-BEFORE-DELETE)

```
STEP 2.1: حذف 3 محركات dead code كاملة
  → analyzers/dynamic_analysis_engine.py (0 callers)
  → engine/live_prediction_engine.py (0 callers)
  → engine/crypto_full_system.py (0 callers)

STEP 2.2: حذف 15 orphan blueprint files
  → VERIFY: grep كل ملف للتأكد من عدم وجود مستوردين
  → احذف: educational_cards, kimi_backtest, market_status, multi_market,
    performance_dashboard, v2_analytics, hunter, data_engine, analysis_engine,
    analysis, backtest, crypto, crypto_simulation, smart_confluence, walk_forward

STEP 2.3: إزالة تعليق DEPRECATED الخاطئ
  → expert_memory_v4_routes.py:1 (الملف يعمل فعلياً!)

STEP 2.4: حذف orphan files
  → correlation_filter.py (0 imports)
  → trend_following_paper_trading.py (0 imports)
  → test_maestro_direct.py, test_quick_check.py, test_db_connection.py, test_phase3.py
```

## المرحلة 3: توحيد المحرك الواحد

```
STEP 3.1: توحيد مسار الكتابة
  → كل الـ 6 مسارات تستخدم PredictionTracker.record_prediction
  → إضافة UNIQUE(ticker, prediction_date, source) على predictions table

STEP 3.2: توحيد STRONG_BUY threshold
  → 75 كـ standard (matches engine_settings.confidence_top_pick)
  → تحديث: board_of_analysts (90→75), technical_weighted (65→75),
    scoring_fix (70→75), confluence_v1 (80→75), confluence_v3 (already 75)

STEP 3.3: توحيد data path
  → إجبار كل analyzers على استخدام load_price_history() من data/prices.py
  → حذف التعريف المكرر في master_analyzer.py:778

STEP 3.4: توحيد DBPaths
  → migration كل 250+ ملف لاستخدام utils/db_paths.py
```

## المرحلة 4: إصلاح fundamentals

```
STEP 4.1: إصلاح 8 صفوف shifted في tab_*
  → script: scripts/fix_tab_shifted.py
  → backup قبل التعديل

STEP 4.2: توحيد schema المتوقع من tab_*
  → كل consumers يقرأون نفس الأعمدة
  → حذف migrator.py schema المضلل (لا يُستخدم فعلياً)
```

---

## الملخص التنفيذي

> **المبدأ الحاكم: Machine Complexity ≠ Alpha.**

الـ audit كشف أن النظام يحتوي على:
- **31 محرك قرار** (6 فعّالة فقط)
- **28 drift** في العتبات
- **16 ملف route ميت**
- **3 محركات dead code كاملة**
- **4 schemas مختلفة** لنفس جدول fundamentals
- **2 تعريف** لـ load_merged_history (split-brain)
- **5 thresholds مختلفة** لـ STRONG_BUY
- **250+ ملف** يفتح DBs بطرق مختلفة
- **0 rows** في learned_lessons (learning loop مكسور)

**الجراحة الموصى بها:**
1. إصلاح 4 إصلاحات حرجة فورية (broken blueprint + sniper INSERT + V40.3 + confidence)
2. حذف 3 محركات + 15 route + 6 orphan file = **~24 ملف ميت**
3. توحيد مسار كتابة predictions على PredictionTracker فقط
4. توحيد STRONG_BUY = 75 (5 ملفات)
5. توحيد data path على load_price_history()
6. إصلاح tab_* column-shift

**الهدف:** تقليل 442 ملف Python إلى ~350-380 ملف فعّال،
وتقليل 31 محرك قرار إلى 6 محركات فعّالة فقط،
وتوحيد 28 drift إلى 0.
