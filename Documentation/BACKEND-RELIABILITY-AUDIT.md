# BACKEND-RELIABILITY-AUDIT
> **Task:** RADAR-CLOSURE-02 → تقرير برافو الأول (Backend & Financial Validation)
> **Branch:** main (post-production-fixes commit `08692fd`)
> **Date:** 2026-10-26
> **Scope:** جرد المحركات + DBs + مصادر الحقيقة + تقييم كل مجال + إصلاحات مرتبة بالأولوية

---

## Executive Summary

التقييم الإجمالى لبرافو: **58%** (كما قدّر المالك). بعد تنفيذ إصلاحات الإنتاج (schema migration + writer fixes + data cleanup)، التحسن المتوقع: **+8%** → **66%**. الهدف: 85%.

**العوائق الحرجة المتبقية:**
1. مصدر قرار غير موحّد (كل محرك يطلع recommendation بشكل مختلف)
2. لا يوجد source-of-truth مُعتمد لكل نوع بيانات
3. اختبارات المعادلات المالية شبه غائبة
4. إدارة رأس المال مش متصلة بالقرار النهائى
5. 450 API endpoint بدون توحيد response shape

---

## 1. جرد المحركات الفعلية (189 محرك)

### 1.1 التوزيع حسب الفئة

| الفئة | العدد | أمثلة | الحالة |
|---|---|---|---|
| **Core Analyzers** | 110+ | master_analyzer, confluence_engine_v3, core_scoring_engine | تعمل، لكن بدون عقد موحّد |
| **Technical** | 15 | technical, technical_weighted, technical_target_engine, smc_engine | متضاربة (3 محركات تقنية مختلفة) |
| **Fundamental** | 8 | fundamental, fundamental_engine, fundamental_scorer, fair_value_calculator | مصادر بيانات متفرقة |
| **Regime/Risk** | 15 | market_regime_engine, regime_detector, regime_filter, risk, risk_adaptive | غير متصلة بالقرار النهائى |
| **Crypto-specific** | 12 | crypto_analyzer, crypto_maestro, crypto_circuit, crypto_regime | منفصلة عن EGX |
| **AI/LLM** | 8 | ai_pattern_analyzer, ai_sentiment, narrative_generator | اختيارية |
| **Prediction/Tracking** | 10 | prediction_tracker, enhanced_prediction_tracker, real_backtester | جزئياً متصلة |
| **News/Sentiment** | 8 | news_fetcher_analyzer, news_impact_scorer, sentiment_analyzer | تعمل |
| **Position/Risk** | 6 | position_manager, position_sizing, risk, risk_adaptive | غير مُطبّقة على التوصية |
| **Supporting** | 30+ | stock_dna_analyzer, timing, session_timing, ticker_cooldown | مساعدة |

### 1.2 المحرك المركزي: `master_analyzer.py`
- **الدور:** يدمج كل المحركات + يطبّق Golden Rules الـ8
- **القواعد:**
  1. Liquidity First — يتخطّى التحليل لو مش tradeable
  2. Market Regime Filter — يعدّل الثقة حسب حالة السوق
  3. Sector-Relative Fundamentals — مقارنة داخل القطاع
  4. Session Dynamics — مش "best hours"
  5. Unified Scoring — Weighted combination
  6. Strict Thresholds — STRONG_BUY ≥ 55, BUY ≥ 50
  7. Risk Profile — Position, Stop, Target, Time
  8. Feedback Loop — يتعلّم من الأخطاء

**العقد:** غير موثّق بشكل رسمي. مدخلات/مخرجات المحرك مش معروفة بدقة.

---

## 2. جرد قواعد البيانات + مصادر الحقيقة

### 2.1 قواعد البيانات (7 DBs)

| DB | Tables | Rows | Size | الدور |
|---|---|---|---|---|
| stocks.db | 53 | 114,382 | 26MB | أسعار يومية + إشارات الرادار + بيانات أساسية |
| price_history.db | 3 | 1,402,672 | 358MB | تاريخ أسعار EGX الكامل (2000+) |
| data_engine.db | 29 | 4,115,361 | 507MB | بيانات من مصادر متعددة (EODHD, egksco, etc) |
| intraday.db | 6 | 988,704 | 197MB | أسعار اللحظى |
| predictions.db | 33 | 251,996 | 280MB | تتبع التوصيات + outcomes |
| news.db | 4 | 1,852 | 10MB | الأخبار |
| custom.db | 2 | 0 | 0MB | فارغ |

### 2.2 مصادر الحقيقة (Source of Truth) — مفقود

| نوع البيانات | المصدر المفترض | المصدر الفعلى | المشكلة |
|---|---|---|---|
| أسعار EGX اليومية | price_history.db | مُجزّأ بين 4 جداول | لا يوجد source-of-tright واحد |
| بيانات الأسهم (metadata) | stocks.db::stocks | موزّع على 3 جداول | تكرار + تعارض |
| المؤشرات الفنية | تُحسب عند الطلب | 3 محركات مختلفة | نتائج غير متطابقة |
| التوصيات | master_analyzer | كل محرك يطلع recommendation | لا يوجد unified decision |
| الصفقات المغلقة | predictions.db | مُجزّأ | حالات غير موحّدة |
| المحفظة | (غير موجود) | لا يوجد | إدارة رأس المال معطّلة |

### 2.3 الجداول الحرجة (radar-related)

| الجدول | DB | الصفوف | الدور | الحالة |
|---|---|---|---|---|
| radar_signal_tracking | stocks.db | 1,329 | إشارات الرادار | ✅ مُنظّف (post-cleanup) |
| stock_daily_prices | stocks.db | 90,232 | أسعار EGX يومية | ✅ مُنظّف (DEFAULT 'EGX' now) |
| price_history | price_history.db | 1,402,254 | تاريخ الأسعار | ⚠️ به market='US' قديم |
| historical_data | data_engine.db | 197,423 | بيانات تاريخية | ✅ به market column |
| egksco_price_history | data_engine.db | 60,097 | أسعار egksco | ✅ به market column |
| predictions | predictions.db | (varies) | التوصيات | ⚠️ حالات غير موحّدة |

---

## 3. المشاكل المفتوحة

### 3.1 حرجة (P0) — تمنع الاعتماد

| # | المشكلة | الأثر | الإصلاح |
|---|---|---|---|
| **P0-1** | لا يوجد unified decision source — كل محرك يطلع recommendation مختلف | التوصية النهائية مش متسقة | توحيد على master_analyzer + إيقاف الـ recommendation من باقى المحركات |
| **P0-2** | price_history.db لسه فيه market='US' قديم | استعلامات price_history تستخدم بيانات ملوّثة | data cleanup على price_history.db (مش بس stocks.db) |
| **P0-3** | إدارة رأس المال (position_manager) غير متصلة بالقرار | التوصية لا تحترم المخاطرة | ربط master_analyzer بـ position_manager |
| **P0-4** | لا توجد اختبارات للمعادلات المالية | صحة RSI/ATR/R:R غير مثبتة | كتابة unit tests لكل معادلة |

### 3.2 مهمة (P1) — تقلل الموثوقية

| # | المشكلة | الأثر |
|---|---|---|
| **P1-1** | 3 محركات تقنية مختلفة (technical, technical_weighted, technical_target_engine) | نتائج متضاربة |
| **P1-2** | 450 API endpoint بدون response schema موحّد | integration صعب |
| **P1-3** | تكرار بيانات الأسهم فى 3 جداول | تعارض محتمل |
| **P1-4** | حالات الصفقات غير موحّدة | تتبع غير دقيق |
| **P1-5** | لا يوجد engine contract موثّق | صعوبة الصيانة |

### 3.3 متوسطة (P2) — تحسينات

| # | المشكلة |
|---|---|
| P2-1 | 189 محرك بدون inventory رسمي |
| P2-2 | feedback_loop شغّال بس مش متصل بكل المحركات |
| P2-3 | cache layer غير موحّد |

---

## 4. الاختبارات الموجودة

### 4.1 الاختبارات الحالية (81 ملف)

| الفئة | العدد | الحالة |
|---|---|---|
| Python tests (vps-service/) | 25 | شغّالة، لكن تغطية منخفضة |
| TypeScript tests (src/) | 40 | معظمها UI |
| Bravo radar tests | 4 | 37/37 PASS ✅ |
| Skills tests | 12 | غير متعلقة بالـ backend |

### 4.2 التغطية الفعلية

| المجال | اختبارات موجودة? | نسبة التغطية |
|---|---|---|
| Data integrity | جزئى (radar only) | 15% |
| Engine unit tests | شبه غائبة | 5% |
| Mathematical calculations | غائبة | 0% |
| API integration | جزئى | 20% |
| Financial calculations | غائبة | 0% |
| Backtesting | موجود (backtest_engine) | 30% |
| Prediction tracking | جزئى | 25% |

---

## 5. الاختبارات الناقصة

### 5.1 المطلوب كتابته (priority order)

| # | الاختبار | النوع | الأولوية |
|---|---|---|---|
| 1 | RSI calculation test (Wilder's formula) | unit | P0 |
| 2 | ATR calculation test | unit | P0 |
| 3 | Moving Averages (SMA/EMA) test | unit | P0 |
| 4 | Support/Resistance test | unit | P0 |
| 5 | Entry/Stop/Target test (R:R = 2 example) | unit | P0 |
| 6 | Position sizing test | unit | P0 |
| 7 | Commission calculation test | unit | P1 |
| 8 | Portfolio risk test | unit | P1 |
| 9 | master_analyzer integration test | integration | P0 |
| 10 | Signal → Recommendation → Track → Close → Return cycle | integration | P0 |
| 11 | API response schema validation | integration | P1 |
| 12 | Data source consistency (price in 4 tables match) | data integrity | P0 |
| 13 | Stale data handling test | unit | P1 |
| 14 | Market filter isolation test | unit | ✅ exists (C4) |
| 15 | Corporate action adjustment test | unit | P1 |

---

## 6. تقييم كل مجال

| المجال | التقدير الحالى | بعد إصلاحات الإنتاج | الهدف | الفجوة |
|---|---|---|---|---|
| المعمارية والتنظيم | 75% | 75% | 85% | 10pp |
| جودة البيانات | 45% | **60%** (+15) | 85% | 25pp |
| قواعد البيانات | 45% | **55%** (+10) | 85% | 30pp |
| المنطق الفني | 78% | 78% | 85% | 7pp |
| المنطق الرياضي | 65% | 65% | 85% | 20pp |
| المحركات منفردة | 65% | 65% | 85% | 20pp |
| تكامل المحركات | 55% | 55% | 85% | 30pp |
| APIs | 55% | 55% | 85% | 30pp |
| إدارة رأس المال | 50% | 50% | 85% | 35pp |
| الاختبارات | 45% | **50%** (+5) | 85% | 35pp |
| التوثيق | 80% | **85%** (+5) | 85% | 0pp ✅ |
| **الإجمالى** | **58%** | **63%** | **85%** | **22pp** |

---

## 7. قائمة الإصلاحات مرتبة بالأولوية

### المرحلة 1 (الأسبوع 1) — Data Integrity

| # | الإصلاح | الملفات | الجهد |
|---|---|---|---|
| 1.1 | data cleanup على price_history.db (مثل stocks.db) | scripts/migrate_schema_and_cleanup.py (extend) | 2h |
| 1.2 | توحيد source-of-truth للأسعار (price_history.db يبقى المرجع) | docs + queries | 4h |
| 1.3 | inventory رسمي للجداول + ownership matrix | Documentation/DATA_OWNERSHIP.md | 3h |
| 1.4 | اختبار data consistency بين 4 جداول أسعار | tests/test_price_consistency.py | 4h |

### المرحلة 2 (الأسبوع 2) — Mathematical & Capital Validation

| # | الإصلاح | الملفات | الجهد |
|---|---|---|---|
| 2.1 | unit tests للمعادلات المالية (RSI, ATR, MA, R:R, position sizing) | tests/test_financial_math.py | 8h |
| 2.2 | توثيق engine contracts (10 محركات أساسية) | Documentation/ENGINE_CONTRACTS.md | 6h |
| 2.3 | ربط position_manager بـ master_analyzer | vps-service/analyzers/master_analyzer.py | 6h |
| 2.4 | اختبار entry/stop/target cycle كامل | tests/test_entry_stop_target.py | 4h |

### المرحلة 3 (الأسبوع 3) — Engine Integration

| # | الإصلاح | الملفات | الجهد |
|---|---|---|---|
| 3.1 | توحيد recommendation source (master_analyzer فقط) | كل analyzers | 8h |
| 3.2 | إيقاف recommendation من المحركات الفرعية | technical, fundamental, etc | 4h |
| 3.3 | توثيق ترتيب المحركات الفعلى | Documentation/ENGINE_PIPELINE.md | 3h |
| 3.4 | اختبار تكامل المحركات (integration test) | tests/test_engine_integration.py | 6h |

### المرحلة 4 (الأسبوع 4) — APIs & Response Standardization

| # | الإصلاح | الملفات | الجهد |
|---|---|---|---|
| 4.1 | توحيد API response schema | src/lib/api-response.ts (new) | 8h |
| 4.2 | توحيد error codes | src/lib/error-codes.ts | 4h |
| 4.3 | اختبار كل endpoint مهم | tests/test_api_endpoints.py | 8h |

---

## 8. حالة القبول الحالية

### ✅ مُنجز:
- [x] Schema migration (DEFAULT 'EGX') — commit `08692fd`
- [x] Data cleanup (41,070 rows) — commit `08692fd`
- [x] Writer fixes (eodhd_fetcher + daily_price_updater) — commit `08692fd`
- [x] Radar forensic fixes merged to main — commit `08692fd`
- [x] Market filter (C2) in all read paths — commit `08692fd`
- [x] 37/37 tests PASS (F1/F3/C4 regression)
- [x] Backup verified (db/backup_20261026_061508/)

### ❌ مُتبقّى (يمنع الاعتماد النهائى):
- [ ] price_history.db data cleanup (لم يُنظّف بعد)
- [ ] Unified decision source (master_analyzer فقط)
- [ ] position_manager متصل بالقرار
- [ ] اختبارات المعادلات المالية
- [ ] engine contracts موثّقة
- [ ] API response schema موحّد

### الحكم: **CONDITIONAL ACCEPT** — الإصلاحات الإنتاجية نجحت، لكن الاعتماد النهائى يحتاج المراحل 1-4.

---

## 9. خطة الرجوع (Rollback)

إذا حدثت مشكلة بعد الإصلاحات الإنتاجية:

```bash
# 1. استرجاع DBs من الـ backup
cp db/backup_20261026_061508/stocks.db.bak db/stocks.db
cp db/backup_20261026_061508/price_history.db.bak db/price_history.db
cp db/backup_20261026_061508/data_engine.db.bak db/data_engine.db

# 2. الرجوع لـ commit قبل الإصلاحات
git checkout 3af1118  # قبل schema migration

# 3. إعادة تشغيل الخدمات
bun run dev
```

---

## 10. الخطوة التالية

هذا التقرير هو **النقطة الأولى** من خطة المالك. التالى:
- **ألفا:** FRONTEND-RELIABILITY-AUDIT (بعد هذا التقرير)
- **النظام:** SYSTEM-INTEGRATION-ACCEPTANCE (بعد الاثنين)

برافو جاهز لتنفيذ المرحلة 1 (Data Integrity) فور موافقة المالك.
