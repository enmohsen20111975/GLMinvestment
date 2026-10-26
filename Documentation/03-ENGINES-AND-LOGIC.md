# 03 — المحركات والمنطق الاستثماري

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:
1. **Rule-Based** (110 محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama glm-fast:latest — 40% وزن فقط)

## 2. المحرك المركزي: master_analyzer.py

- **5,794 LOC** — يجمع 9 مصادر دليل
- 8 قواعد ذهبية (Hard Veto)
- عتبات الإشارة: STRONG_BUY≥78, BUY≥65, ACCUMULATE≥55, NEUTRAL 45-54, AVOID<45

## 3. فهرس المحركات (8 فئات)

### 3.1 Master/Fusion (10 engines)
master_analyzer, core_scoring_engine, confluence_engine_v3, institutional_decision_engine, v68_oracle, fusion_engine, unified_maestro, hunting_engine, seasonality_first_engine

### 3.2 Technical/Indicator (16 engines)
technical, technical_weighted, technical_target, enhanced_indicators, multi_timeframe, live_indicator_engine, candlestick, candle_probability, patterns, fibonacci, volume_profile, smc_engine, multi_path_detector, support_resistance_calculator, dynamic_target_engine, breakout_signal

### 3.3 Regime/Risk/Liquidity (15 engines)
market_regime_engine (1380 LOC), regime_detector, regime_filter, hmm_market_regime, crypto_regime, risk, risk_adaptive, liquidity_filter, strict_entry_filters, crypto_quality_gate, expert_quality_gate, expert_memory_bridge, ticker_cooldown

### 3.4 Fundamental/Seasonality (12 engines)
fundamental_scorer (Piotroski + Altman Z), fundamental_relative, fair_value_calculator, real_return_engine, seasonality_scorer, dividend_checker, sector_relative

### 3.5 Prediction Tracking/Learning (12 engines)
prediction_tracker, unified_learning_engine (THE LEARNING BRAIN), prediction_optimizer, adaptive_weights, quant_overdrive (Monte Carlo 500 paths), quant_cache

### 3.6 Persona/Position/Portfolio (10 engines)
persona_screener (7 personas), persona_investor, persona_gambler, position_manager, smart_portfolio_monitor, bag_holder_rescue, short_holding_exit, stock_dna_analyzer

### 3.7 Rescue Framework (5 modules — جديد)
loss_attribution (6-cause taxonomy), rescue_classifier (A/B/C/D + INSUFFICIENT_DATA), averaging_simulator (5×5 grid), liquidity_allocator (4 actions), monitoring_plan

### 3.8 Reporting (8 engines)
narrative_generator, social_card_generator, reports_engine, market_daily_report, conviction_engine, confidence_engine

## 4. نظام Confluence Scoring

```
FINAL = w1×Tech + w2×SMC + w3×Vol + w4×Fund + w5×Regime + w6×Persona + w7×Season + w8×News

SMC weight = 60% (dominant)
Technical = 15%
Volume = 10%
Fundamentals = 15%
```

## 5. Market Regime (3 حالات)

| Regime | Threshold | Position Size |
|--------|-----------|---------------|
| DEFENSIVE | EGX30 drops 5% in 5d | Half size, threshold 70+ |
| NORMAL | default | Full size, threshold 65+ |
| AGGRESSIVE | EGX30 up 8% in 5d | +25% size, threshold 55+ |

Hysteresis: 2-3 days to prevent flip-flop.

## 6. Minervini Stages

| Stage | الشرط | الإشارة |
|-------|-------|---------|
| 1 (Base) | price ≈ 200SMA flat | NEUTRAL |
| 2 (Bull) | price > 200SMA rising + Golden Cross + ADX≥25 | BUY |
| 3 (Top) | price > 200SMA but flattening | AVOID |
| 4 (Bear) | price < 200SMA falling | STRONG_AVOID (HARD VETO) |
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
# BRAVO — Radar Closure Report (RADAR-CLOSURE-02, Part A)
> **Branch:** fix/radar-forensic-minimal
> **Date:** 2026-10-25
> **Task:** RADAR-CLOSURE-02 / Part A (Bravo)
> **Base commit:** `532180e`

---

## A1. Commit Size Analysis (532180e — 1.4M insertions)

**Finding:** The commit contains 3,835 files / 1,403,993 insertions. This is NOT a forensic-only commit — it's a full project restoration onto origin/main.

### File breakdown by category:

| Category | Count | Notes |
|---|---|---|
| `src/` (Next.js app) | 1,293 | Project source code |
| `archive/` | 629 | Historical worklogs/JSON |
| `scripts/` | 538 | Python/JS scripts (incl. our forensic files) |
| `vps-service/` | 512 | Backend service |
| `notebooks/` | 259 | Jupyter notebooks |
| `public/` | 191 | Static assets (incl. binaries) |
| `Documentation/` | 105 | Markdown docs (incl. our reports) |
| `backups/` | 57 | Backup JSON/TXT (not DBs) |
| `data_engine/` | 36 | Data engine config |
| `agent-ctx/` | 20 | Agent context files |

### Large binaries (> 100KB) accidentally included:

| File | Size |
|---|---|
| `pitch-deck.pdf` | 2.1 MB |
| `public/logo-new.png` | 1.2 MB |
| `public/logo-full.png` | 1.2 MB |
| `scripts/output/radar_upgrade_main.png` | 1.2 MB |
| 5 chart PNGs (Arabic names) | 440-520 KB each |
| `audit-reports/.../audit-invist.m2y.net-1005.pdf` | 372 KB |
| `public/radar-source-update.tar.gz` | 319 KB |
| `public/radar-new-files.tar.gz` | 53 KB |
| Various report PNGs | 300 KB each |
| Font files (NotoSansArabic) | 240-248 KB each |

### DBs / sensitive files:
- **NO `.db` files in commit** ✅ (DBs are in `db/` on disk but gitignored)
- **NO `node_modules/`** ✅
- **NO `.next/` build artifacts** ✅
- `tool-results/` CSVs: 4 original files tracked (force-added), but **D2/D3/D4 CSVs were lost in reset** — recreated in this closure.

### Root cause of bloat:
The commit was a `git add -A` on a fresh branch (orphan-style) that captured the entire GLMinvestment project, not just forensic deliverables. The forensic files are a tiny subset (~10 files, ~2KB each).

### Recommendation (not executed — needs owner approval):
1. Squash the forensic-only changes into a clean commit on top of `main`
2. Move large binaries (`pitch-deck.pdf`, logos, chart PNGs) to a separate `assets-large/` branch (like `db-snapshot`)
3. Do NOT delete — just reorganize

---

## A2. Market Isolation — All Paths Fixed

### Paths fixed with `market='EGX'` filter:

| File | Line(s) | Path | Filter applied? |
|---|---|---|---|
| `scripts/verify_radar_signals.py` | 59-129 | `_fetch_n_sessions_from_sources` | ✅ C2 (prev commit) |
| `scripts/verify_radar_signals.py` | 206-213 | price_history.db fallback | ✅ C2 (prev commit) |
| `scripts/generate_unified_audit.py` | 122-149 | `fetch_nth_session_unified_or_ph` | ✅ C2 (prev commit) |
| `scripts/radar_accuracy_report.py` | 137-143 | `build_price_index` (4-source merge) | ✅ **FIXED THIS COMMIT** |
| `src/app/api/maker-radar/signal-tracker/verify/route.ts` | 120-138 | `fetchPricesAfter` | ✅ **FIXED THIS COMMIT** |

### Paths NOT fixed (out of scope, documented for owner):

| File | Path | Why not fixed |
|---|---|---|
| `scripts/maker_radar.py` | entry_price lookup | Reads from `stock_daily_prices` at signal creation. Fixing requires changing signal creation logic — owner approval needed (may affect live signals). |
| `vps-service/utils/shared_liquidity.py` | volume surge volumes | Reads from `price_history.db` volumes. Volume data market-filtering is a separate concern (volumes may be legitimately cross-market for crypto). |

### Test evidence (all PASS):
```
python3 scripts/test_bravo_fixes_v2.py   → 25/25 PASS ✅
python3 scripts/test_c4_regression.py     → 12/12 PASS ✅
```

---

## A3. Schema + Ingestion — Permanent Fix Proposal

### Current schema bugs (confirmed):
```sql
CREATE TABLE stock_daily_prices (
    ... market TEXT DEFAULT 'US',  -- BUG: should be 'EGX'
    UNIQUE(ticker, price_date)      -- BUG: market NOT in key
);
```

### Proposed permanent fix (NOT executed — needs owner approval):

**Step 1: Schema migration (reversible)**
```sql
-- Backup first
CREATE TABLE stock_daily_prices_backup AS SELECT * FROM stock_daily_prices;

-- Change DEFAULT
ALTER TABLE stock_daily_prices RENAME TO stock_daily_prices_old;
CREATE TABLE stock_daily_prices (
    ... market TEXT DEFAULT 'EGX',
    UNIQUE(ticker, price_date, market)  -- market in key
);
INSERT INTO stock_daily_prices SELECT * FROM stock_daily_prices_old;
-- Verify row count matches, then DROP old
```

**Step 2: Writer fixes (code change)**
- `eodhd_fetcher.py:195` — add `market` column to INSERT, value from `get_market_for_ticker(ticker)`
- `daily_price_updater.py:165` — same fix

**Step 3: Data cleanup (UPDATE — reversible)**
```sql
UPDATE stock_daily_prices
SET market = (SELECT s.market FROM stocks s WHERE s.ticker = stock_daily_prices.ticker)
WHERE market != (SELECT s.market FROM stocks s WHERE s.ticker = stock_daily_prices.ticker);
-- Expected: 72,324 rows updated from 'US' to correct market
```

**Step 4: Query filters already applied** (C2 fix — `market='EGX'` in all read paths).

**Rollback plan:** Restore from `stock_daily_prices_backup`. Code changes reverted via `git checkout main`.

### Why not execute now:
- Schema migration is a DB write → owner approval required
- Data cleanup affects 72,324 rows → owner approval required
- Writer fixes change production ingestion behavior → owner approval required

---

## A4. Signal Outcome Integrity — Policy Clarification

### Current state (4 categories):

| Status | Count | Has outcome_7d? | Writer | In accuracy stats? |
|---|---|---|---|---|
| `verified_win` | 75 | YES | verify_radar_signals / radar_accuracy_report | YES (current) |
| `verified_loss` | 457 | 259 YES, 198 NO | radar_accuracy_report (all) + verify_radar_signals (pending only) | YES (current) |
| `stale_data` | 432 | 259 YES, 173 NO | radar_accuracy_report (all) | **POLICY QUESTION** |
| `pending` | 351 | 57 YES, 294 NO | verify_radar_signals | NO (pending = not verified) |
| `disqualified_illiquid` | 14 | NO | maker_radar | NO |

### The 259 stale_data + outcome_7d signals:
- Written by `radar_accuracy_report.py --write` (processes ALL signals, no status filter)
- These have `verified_at=NULL` (verify_radar_signals only sets verified_at for pending→verified)
- Their outcomes were computed from contaminated price sources (before C2 fix)

### Policy options (for owner decision — NOT decided by Bravo):

**Option A: Exclude stale_data from accuracy stats entirely**
- Pro: clean stats (only verified_win/loss counted)
- Con: 259 outcomes computed but discarded; reduces sample size
- Effect: WR recalculated on 75+457=532 verified-only signals

**Option B: Include stale_data in separate "stale" category**
- Pro: preserves data, shows both clean + stale WR
- Con: two sets of numbers may confuse
- Effect: Main WR (verified only) + Stale WR (stale_data with outcomes)

**Option C: Recompute stale_data outcomes with C2 fix, then include**
- Pro: uses corrected data
- Con: stale signals had stale ENTRY prices — may not be fair to verify them
- Effect: 259 outcomes recomputed, included in stats

**Bravo recommendation:** Option B (separate category). But owner must decide.

### What is fixed (not a policy question):
- ✅ `radar_accuracy_report.py` now filters by `market='EGX'` (C2 fix)
- ✅ Outcomes recomputed on isolated copy use clean EGX data
- ✅ Signal status NOT overwritten by outcome writes (verified_at distinguishes true verifications)

---

## A5. EGX Session Gaps — Resolved vs Unresolved

### Resolved:
| Date | Status | Evidence |
|---|---|---|
| Oct 6, 2026 (Tue) | ✅ HOLIDAY — Armed Forces Day | All 461 EGX tickers missing = correct (market closed) |

### Unresolved (documented, not assumed):
| Date | Status | Evidence |
|---|---|---|
| Oct 15, 2026 (Thu) | ⚠️ UNKNOWN_GAP | All 461 EGX tickers missing, 0 have data. No documented EGX holiday found. Could be: (a) undocumented holiday, (b) feed outage, (c) data cleanup side-effect. **Cannot classify without independent EGX calendar.** |
| Oct 17, 2026 (Sat) | ⚠️ WEEKEND_ROW_EXISTS | Row exists in `historical_data` tagged `market='EGX'` for COMI. EGX does not trade Saturdays. This is either: (a) foreign-market data mistagged, (b) ingestion bug, (c) exceptional session. **Cannot classify without source trace.** |

### Impact on outcomes:
- Oct 15 gap: signals with signal_date around Oct 8 may have their 7th session shifted (Oct 15 skipped → 7th session is Oct 18 instead of Oct 15)
- Oct 17 weekend row: if included in N-th session count, it's a false session (EGX didn't trade)

### Action taken:
- C2 fix (`market='EGX'`) does NOT remove Oct 17 from `historical_data` (it's tagged EGX there)
- The audit script's `fetch_sessions_with_gaps` detects Oct 17 as a DATE_GAP (>4 day jump from Oct 14)
- Signals affected by these gaps are flagged in `tool-results/audit_f1_gaps.csv` for review

### What is NOT done (needs owner decision):
- No independent EGX trading calendar cross-check (out of scope for this task)
- No deletion of Oct 17 rows (preserved as evidence per owner directive)
- No assumption that Oct 15 was a holiday (classified UNKNOWN)

---

## A6. Acceptance Tests — Actual Execution Results

### Test execution (run on 2026-10-25):

```bash
$ python3 scripts/test_bravo_fixes_v2.py
=== RESULTS: 25/25 ✅ PASS, 0 FAIL ===

$ python3 scripts/test_c4_regression.py
=== RESULTS: 12/12 ✅ PASS, 0 FAIL ===

$ python3 scripts/generate_unified_audit.py
# Produces: tool-results/UNIFIED_AUDIT_REPORT.md + 3 CSVs
# Numbers: 433 compared, 361 changed, 121 W→L (unfiltered)
```

### Isolated recalculation (with ALL C2 fixes):
```python
# Script: inline recalc using _fetch_n_sessions_from_sources(market_filter='EGX')
Total compared: 433
Changed (>0.5%): 338
Win→Loss flips: 97
Old WR: 42.7% (stored, biased)
New WR: 28.6% (EGX-filtered, clean)
```

### Test quality verification:
- ✅ Tests use real DB data (not mocks)
- ✅ Tests verify actual behavior (market filter changes results — C4-T08)
- ✅ Tests fail on pre-fix code (C4-T02b: without filter, contaminated source returns)
- ✅ Tests cover all modified paths (verify_radar_signals, generate_unified_audit, radar_accuracy_report, verify/route.ts)
- ⚠️ Tests do NOT cover maker_radar.py entry_price (out of scope — documented)

### What 28.6% means (per owner's directive):
28.6% is the **recomputed WR after C2 fix** (market='EGX' filter applied to all price queries). It is NOT:
- The "true" WR (still affected by Oct 15 gap, Oct 17 weekend row, POUL/ORHD unadjusted entry_price)
- The "final" WR (stale_data policy not decided)
- A verified production number (computed on sandbox DB copy, not production)

**28.6% is a corrected intermediate result.** It proves the market filter changes outcomes significantly (from 8.79% contaminated to 28.6% EGX-filtered). Final WR requires resolving A3 (schema), A4 (stale policy), A5 (session gaps).

---

## Part C — Integration & Final Verdict

### Deliverables verified:
| Deliverable | File | Status |
|---|---|---|
| D1 Data Lineage | Documentation/DATA_LINEAGE.md | ✅ Published |
| D2 Contamination Audit | tool-results/MARKET_CONTAMINATION_AUDIT.csv | ✅ 1,103 rows |
| D3 Session Gaps | tool-results/EGX_SESSION_GAPS.csv | ✅ 1,822 rows |
| D4 Stale Outcomes | tool-results/STALE_SIGNAL_OUTCOMES.csv | ✅ 432 rows |
| C1 Code Path Map | Documentation/C1_CODE_PATH_MAP.md | ✅ Published |
| C2 Market Filter | 5 paths fixed | ✅ 4 fixed this commit, 1 out-of-scope |
| C3 Outcome Policy | Documented (3 options for owner) | ✅ Documented |
| C4 Regression Tests | scripts/test_c4_regression.py | ✅ 12/12 PASS |

### Final Verdict: CONDITIONAL ACCEPT

**ACCEPTED:**
- ✅ Root cause proven (schema + writers)
- ✅ Market isolation applied to 4 of 5 read paths (maker_radar.py out of scope)
- ✅ All tests pass (37/37)
- ✅ Isolated recalculation reproducible (WR 28.6%)
- ✅ All evidence CSVs published

**BLOCKED (requires owner decision):**
- ❌ Schema migration (DEFAULT 'US' → 'EGX') — A3
- ❌ Writer fixes (eodhd_fetcher + daily_price_updater) — A3
- ❌ Data cleanup (UPDATE 72,324 rows) — A3
- ❌ stale_data policy (Option A/B/C) — A4
- ❌ Oct 15 / Oct 17 classification (needs independent EGX calendar) — A5
- ❌ maker_radar.py entry_price market filter — A2 (out of scope)
- ❌ Merge to main

### Rollback plan:
- All code changes on `fix/radar-forensic-minimal` — revert via `git checkout main`
- No DB writes made — no DB rollback needed
- No production deployment — no service rollback needed

### Reproduction (single command):
```bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment && git checkout fix/radar-forensic-minimal
python3 scripts/test_bravo_fixes_v2.py      # 25/25 PASS
python3 scripts/test_c4_regression.py       # 12/12 PASS
python3 scripts/generate_unified_audit.py   # CSVs + report
# Isolated recalculation:
python3 -c "from scripts.verify_radar_signals import _fetch_n_sessions_from_sources; print(_fetch_n_sessions_from_sources('COMI','2026-10-08',7,market_filter='EGX'))"
```

### Token acknowledgment:
GitHub token `ghp_***` leaked in chat. **Must be revoked from https://github.com/settings/tokens immediately.** This task did not use it.
# ENGINE_CONTRACTS.md — Master Analyzer + Pipeline
> **Phase 3 deliverable:** unified decision source + engine contracts
> **Branch:** main | **Date:** 2026-10-26

---

## 1. Master Analyzer Contract (the unified decision source)

### Inputs
```python
MasterAnalyzer.analyze(
    ticker: str,           # EGX stock symbol (e.g. 'COMI')
    prices: List[float],   # closing prices, oldest→newest (min 50 for full analysis)
    volumes: List[float],   # volumes matching prices
    market_pulse: dict,    # optional: real-time market regime
    history: List[Dict],   # optional: prediction history for learning
    **kwargs
) → MasterAnalysis
```

### Outputs (MasterAnalysis dataclass — key fields)
```python
MasterAnalysis = {
    # Final decision (UNIFIED SOURCE)
    recommendation: str,       # STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL | NO_TRADE
    master_score: float,        # 0-100 weighted score
    
    # Price levels
    entry_price: float,
    stop_loss: float,
    target_price: float,
    current_price: float,
    
    # Risk management
    risk_reward_ratio: float,
    suggested_position_size: float,  # % of capital
    
    # Confidence
    conviction_score: float,
    conviction_level: str,
    
    # Metadata
    signal_type: str,
    reasons: List[str],
    data_quality: str,       # fresh | stale | very_stale
    analyzed_at: str,
}
```

### Thresholds (canonical — single source of truth)
```python
THRESHOLDS = {
    'STRONG_BUY': 78,
    'BUY': 65,
    'HOLD': 45,
    'SELL': 35,
    'STRONG_SELL': 25,
}
# master_score >= 78 → STRONG_BUY
# master_score >= 65 → BUY
# master_score >= 45 → HOLD
# master_score >= 35 → SELL (was ACCUMULATE)
# master_score < 25 → STRONG_SELL
```

---

## 2. Decision Pipeline (actual execution order)

```
1. Market Data (price_history.db) → prices + volumes
2. Data Validation → staleness check, market='EGX' filter
3. Liquidity Filter → skip if turnover < threshold
4. Market Regime → DEFENSIVE / NORMAL / AGGRESSIVE
5. Technical Analysis → RSI, ATR, MA, SMC, Support/Resistance
6. Fundamental Analysis → sector-relative scoring
7. Confluence Scoring → 8-layer weighted combination
8. Conviction Engine → confidence level
9. Risk Profile → entry, stop, target, R:R
10. Position Sizing → suggested_position_size (% of capital)
11. Final Decision → recommendation (from master_score vs THRESHOLDS)
12. Output → MasterAnalysis dataclass
```

### Authority per stage
| Stage | Engine | Authority |
|---|---|---|
| 1-2 | data layer | data source + validation |
| 3 | liquidity_filter | can BLOCK (skip analysis) |
| 4 | market_regime_engine | adjusts confidence, cannot block |
| 5-6 | technical + fundamental | scoring only, no recommendation |
| 7 | confluence_engine_v3 | weighted combination |
| 8 | conviction_engine | confidence level |
| 9-10 | risk + position_sizing | entry/stop/target/size |
| 11 | **master_analyzer (FINAL)** | **only source of recommendation** |

### Conflict resolution
- If liquidity_filter blocks → NO_TRADE (overrides everything)
- If market_regime = DEFENSIVE → threshold raised (+5 to STRONG_BUY/BUY)
- If conviction_level = LOW → downgrade recommendation one level
- If risk_reward < 1.0 → downgrade to HOLD

---

## 3. Position Manager Contract

### Inputs
```python
manage_position(
    prediction: dict,     # from MasterAnalysis
    current_price: float,
    price_lookup_fn: callable,
) → position_action: dict
```

### Outputs
```python
position_action = {
    action: str,       # HOLD | TRIM | EXIT | ADD
    reason: str,
    current_return: float,
    holding_days: int,
    target_progress: float,
}
```

### Connection to master_analyzer
- `master_analyzer` emits `suggested_position_size` + `entry_price` + `stop_loss`
- `position_manager` takes ACTIVE predictions (post-entry) and manages them
- **Gap identified:** `position_manager` is NOT called during initial analysis — only for tracking
- **Fix proposed:** integrate `position_manager` check into master_analyzer.analyze() to prevent new signals that conflict with existing positions

---

## 4. Engines Inventory (production-active)

### Tier 1 — Core (always runs)
| Engine | File | Role | Tests? |
|---|---|---|---|
| master_analyzer | analyzers/master_analyzer.py | FINAL decision | pending |
| market_regime_engine | analyzers/market_regime_engine.py | regime detection | pending |
| liquidity_filter | analyzers/liquidity_filter.py | tradeable filter | pending |
| confluence_engine_v3 | analyzers/confluence_engine_v3.py | 8-layer scoring | pending |
| conviction_engine | analyzers/conviction_engine.py | confidence level | pending |

### Tier 2 — Analysis (contributes scores)
| Engine | File | Role |
|---|---|---|
| technical | analyzers/technical.py | RSI, MA, MACD |
| technical_weighted | analyzers/technical_weighted.py | weighted technical |
| fundamental | analyzers/fundamental.py | P/E, EPS, sector |
| fundamental_scorer | analyzers/fundamental_scorer.py | fundamental scoring |
| smc_engine | analyzers/smc_engine.py | order blocks, FVG |
| support_resistance_calculator | analyzers/support_resistance_calculator.py | levels |
| candlestick | analyzers/candlestick.py | patterns |
| fibonacci | analyzers/fibonacci.py | fib levels |

### Tier 3 — Risk & Position
| Engine | File | Role |
|---|---|---|
| risk | analyzers/risk.py | risk assessment |
| risk_adaptive | analyzers/risk_adaptive.py | adaptive risk |
| position_manager | analyzers/position_manager.py | active position management |
| position_sizing | analyzers/position_sizing.py | initial size calc |

### Tier 4 — Auxiliary (optional/contextual)
| Engine | File | Role |
|---|---|---|
| news_impact_scorer | analyzers/news_impact_scorer.py | news sentiment |
| sentiment_analyzer | analyzers/sentiment_analyzer.py | market sentiment |
| seasonality_scorer | analyzers/seasonality_scorer.py | seasonal patterns |
| ticker_cooldown | analyzers/ticker_cooldown.py | repeat signal prevention |

---

## 5. Sub-engines that MUST NOT emit recommendations

The following engines compute intermediate scores but **must not** emit a final `recommendation` field. Only `master_analyzer` does.

| Engine | Current behavior | Fix needed? |
|---|---|---|
| technical.py | emits `recommendation` | YES — change to `technical_signal` |
| fundamental.py | emits `recommendation` | YES — change to `fundamental_signal` |
| smc_engine.py | emits `recommendation` | YES — change to `smc_signal` |
| candlestick.py | emits `pattern_type` | NO — correct |
| conviction_engine.py | emits `conviction_action` | NO — correct (not recommendation) |

**Rule:** any field named `recommendation` in the output MUST come from `master_analyzer`. Sub-engines emit `*_signal` (intermediate).
# ORCHESTRATOR-EXECUTOR-SPEC
> **Phase 5B:** Design specification for Coordinator (المنسّق) + Executor (المنفّذ)
> **Status:** SPEC APPROVED (design only — NOT implemented per owner directive)
> **Date:** 2026-10-26
> **Rule:** لا برمجة قبل اعتماد المسار الفعلى + حسم مصدر القرار + قواعد المخاطر

---

## 1. المنسّق (Orchestrator)

### 1.1 الدور
المنسّق لا يحسب المؤشرات ولا يصدر توصيات. يختار المحركات المناسبة لكل حالة سوق، وينتج خطة تشغيل للمنفّذ.

### 1.2 العقد (Contract)

```python
class OrchestratorPlan:
    # Inputs snapshot
    ticker: str
    market_state: str          # DEFENSIVE | NORMAL | AGGRESSIVE | UNKNOWN
    data_quality: str          # fresh | stale | very_stale | insufficient
    available_engines: List[str]
    
    # Selection result
    selected_engines: List[str]    # engines to run
    skipped_engines: List[Dict]     # [{name, reason}]
    weights: Dict[str, float]      # engine → weight (from approved config)
    thresholds: Dict[str, float]   # decision thresholds (from approved config)
    
    # Metadata
    plan_id: str
    created_at: str
    config_version: str             # which weights/thresholds set used
    decision_policy: str            # "full" | "partial_allowed" | "no_trade"
```

### 1.3 القيود الإلزامية
- ❌ لا يحسب المؤشرات الفنية بنفسه
- ❌ لا ينشئ توصية مالية مستقلة
- ❌ لا يغيّر الأوزان أو العتبات ذاتيًا
- ✅ يكتشف البيانات غير الصالحة قبل بدء التحليل
- ✅ ينتج خطة واضحة قابلة للاختبار
- ✅ كل قرار تشغيل له سبب قابل للتدقيق

### 1.4 منطق الاختيار
```
IF data_quality == 'insufficient':
    → NO_TRADE (skip all engines)
ELIF market_state == 'DEFENSIVE':
    → skip high-risk engines (crypto, breakout)
    → raise thresholds (+5 to STRONG_BUY/BUY)
    → selected = [technical, fundamental, liquidity, risk]
ELIF market_state == 'AGGRESSIVE':
    → include breakout + momentum engines
    → selected = [technical, fundamental, liquidity, breakout, momentum, risk]
ELSE:  # NORMAL or UNKNOWN
    → standard engine set
    → selected = [technical, fundamental, liquidity, confluence, risk]
```

### 1.5 الاختبارات الإلزامية
| الاختبار | ما يثبت |
|---|---|
| Market state known → correct engines selected | selection logic works |
| Market state UNKNOWN → safe default | no crash on unknown |
| Data insufficient → NO_TRADE | data gate works |
| Engine failure → skipped + logged | fault tolerance |
| Same inputs → same plan | determinism |
| Unapproved weights → rejected | config safety |

---

## 2. المنفّذ (Executor)

### 2.1 الدور
ينفّذ خطة المنسّق حرفيًا. يشغّل المحركات بالترتيب، يوحّد شكل النتائج، يطبّق بوابات المخاطر، يسلم للقرار النهائى.

### 2.2 العقد (Contract)

```python
class ExecutorResult:
    # Plan reference
    plan_id: str
    
    # Engine outputs
    engine_results: Dict[str, Dict]   # engine → its output dict
    failed_engines: List[Dict]        # [{name, error, timestamp}]
    
    # Final decision (from master_analyzer only)
    final_signal: str                 # STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL | NO_TRADE
    master_score: float
    risk_profile: Dict                # entry, stop, target, R:R, position_size
    
    # Audit trail
    execution_id: str
    started_at: str
    completed_at: str
    code_version: str                 # git SHA
    config_version: str
    warnings: List[str]
    errors: List[str]
```

### 2.3 القيود الإلزامية
- ❌ لا يعيد تفسير الخطة من تلقاء نفسه
- ❌ لا يتجاوز حدود المخاطر
- ❌ لا يخفى فشل المحركات (يحوّل النتيجة المفقودة إلى NULL، مش محايد)
- ❌ لا يخرج قرارًا مكتملًا عند نقص الأدلة الحرجة
- ❌ لا يكتب على DB الإنتاج فى مرحلة الاختبار
- ✅ يمكن تتبع كل قرار إلى نتائجه ومدخلاته
- ✅ يطبّق بوابات المخاطر قبل إخراج القرار

### 2.4 بوابة المخاطر (Risk Gate)
```
BEFORE emitting final_signal:
1. IF liquidity_filter blocked → NO_TRADE
2. IF risk_reward_ratio < 1.0 → downgrade one level
3. IF position_size > 25% capital → clamp to 25%
4. IF conviction_level == 'LOW' → downgrade one level
5. IF data_quality in ('stale', 'very_stale') → flag as "stale recommendation"
6. IF any critical engine failed → NO_TRADE (not faked)
```

### 2.5 الاختبارات الإلزامية
| الاختبار | ما يثبت |
|---|---|
| Full successful run | pipeline works end-to-end |
| Single engine failure | fault tolerance |
| Critical engine failure | NO_TRADE (no fake) |
| Invalid engine output | rejected, not converted to neutral |
| Duplicate request | no double-write |
| Conflicting engine signals | conflict resolution works |
| Timeout | handled gracefully |
| Plan ↔ Result ↔ Decision match | contract consistency |

---

## 3. الترتيب والاعتماديات

```
Orchestrator → produces Plan
    ↓
Executor ← receives Plan
    ↓
Executor runs engines (per plan)
    ↓
Executor applies Risk Gate
    ↓
Executor emits final_signal (from master_analyzer)
    ↓
Decision Log (audit trail)
```

### 3.1 ما لا يفعله المنسّق
- لا يشغّل المحركات (ده شغل المنفّذ)
- لا يحسب الأوزان (يقرأها من config معتمد)
- لا يصدر recommendation

### 3.2 ما لا يفعله المنفّذ
- لا يختار المحركات (ده شغل المنسّق)
- لا يغيّر الأوزان أو العتبات
- لا يصدر recommendation مستقل (يستخدم master_analyzer)

---

## 4. سجل القرار (Decision Log)

كل قرار يُسجّل:
```json
{
  "execution_id": "uuid",
  "timestamp": "2026-10-26T...",
  "ticker": "COMI",
  "plan_id": "uuid",
  "selected_engines": ["technical", "fundamental", "liquidity", "risk"],
  "skipped_engines": [{"name": "crypto", "reason": "not crypto market"}],
  "engine_results": {...},
  "final_signal": "BUY",
  "master_score": 68.5,
  "risk_profile": {"entry": 124.5, "stop": 119.0, "target": 135.0, "R:R": 2.1, "position_size": 5.0},
  "code_version": "d4a551a",
  "config_version": "v1.0",
  "warnings": ["high_52w invalid (stale)"],
  "errors": []
}
```

---

## 5. شرط الإغلاق

المواصفات deprecation:
- ✅ المنسّق: عقد + قيود + منطق اختيار + اختبارات
- ✅ المنفّذ: عقد + قيود + بوابة مخاطر + اختبارات
- ✅ الترتيب + الاعتماديات
- ✅ سجل القرار

**لا تنفّذ برمجيًا** قبل:
1. اعتماد المالك على المواصفات
2. حسم مصدر القرار النهائى (master_analyzer confirmed)
3. حسم قواعد المخاطر (risk gate rules approved)
4. اختبار على بيانات ثابتة (historical snapshot)

---

## 6. علاقة المواصفات بالكود الحالى

| العنصر | موجود حاليًا؟ | المطلوب |
|---|---|---|
| master_analyzer كـ decision source | ✅ نعم | تأكيد أنه المصدر الوحيد |
| Engine weights | ⚠️ موزّعة | توحيد فى config واحد |
| Risk gate | ⚠️ جزئي | توحيد + اختبار |
| Decision log | ❌ غير موجود | إنشاء |
| Orchestrator | ❌ غير موجود | تصميم معتمد (هذا الملف) |
| Executor | ⚠️ master_analyzer يعمل كليهما | فصل لاحقًا (بعد اعتماد المالك) |
# 🧠 كيف يفكر النظام — المرجع المعماري الكامل

> **ملخص تنفيذي:** وثيقة هندسية شاملة تشرح كيف "يفكر" منصة GLMinvestment من اللحظة التي تدخل فيها بيانات السوق الخام حتى اللحظة التي يصل فيها توصية BUY/SELL لمستخدم في Telegram. مبنية على فحص عميق لـ **493 endpoint** + **110 محرك تحليل** + **9 قواعد بيانات** + **7 خدمات**.

| | |
|---|---|
| **الإصدار** | 1.0 — 2026-10-25 |
| **القارئ المستهدف** | مهندس باك إند / مهندس معماري / CTO / مطور جديد |
| **طول القراءة** | ~45 دقيقة |
| **عدد المخططات** | 22 مخطط (Mermaid + ASCII) |

---

## 📑 فهرس المحتويات

1. [الفلسفة — كيف يفكر النظام فلسفياً](#1-الفلسفة--كيف-يفكر-النظام-فلسفيا)
2. [البنية المعمارية الرباعية](#2-البنية-المعمارية-الرباعية)
3. [خريطة الخدمات والموانئ](#3-خريطة-الخدمات-والموانئ)
4. [خريطة قواعد البيانات (9 قواعد)](#4-خريطة-قواعد-البيانات-9-قواعد)
5. [مصادر البيانات الـ12](#5-مصادر-البيانات-ال12)
6. [المخطط العام لتدفق البيانات](#6-المخطط-العام-لتدفق-البيانات)
7. [المحرك المركزي: master_analyzer.py](#7-المحرك-المركزي-master_analyzerpy)
8. [فهرس المحركات الـ110 (حسب الفئة)](#8-فهرس-المحركات-ال110-حسب-الفئة)
9. [منطق الـ Confluence Scoring](#9-منطق-ال-confluence-scoring)
10. [نظام Market Regime (DEFENSIVE / NORMAL / AGGRESSIVE)](#10-نظام-market-regime)
11. [تصنيف Minervini للمراحل (Stage 1-4)](#11-تصنيف-minervini-للمراحل-stage-1-4)
12. [نظام الـ Personas (7 أنماط مستثمر)](#12-نظام-ال-personas-7-أنماط-مستثمر)
13. [حلقة التعلم الذاتي (Learning Loop)](#13-حلقة-التعلم-الذاتي-learning-loop)
14. [ثلاثة مسارات تدفق بيانات كاملة](#14-ثلاثة-مسارات-تدفق-بيانات-كاملة)
15. [طبقة الذكاء الاصطناعي (Ollama + RAG)](#15-طبقة-الذكاء-الاصطناعي-ollama--rag)
16. [التحديث اللحظي (WebSocket)](#16-التحديث-اللحظي-websocket)
17. [جدول القرارات (Decision Tables)](#17-جدول-القرارات-decision-tables)
18. [قائمة الـ Endpoints الكاملة (493)](#18-قائمة-ال-endpoints-الكاملة-493)
19. [الجدول الزمني للـ Cron Jobs](#19-الجدول-الزمني-لل-cron-jobs)
20. [معجم المصطلحات](#20-معجم-المصطلحات)

---

## 1. الفلسفة — كيف يفكر النظام فلسفياً

النظام **لا يستخدم Deep Learning** (لا LSTM، لا Transformer، لا TensorFlow). بدلاً من ذلك، يعتمد على **3 ركائز فلسفية**:

### 1.1 القاعدة + الإحصاء (Rule-Based + Statistical)

```mermaid
flowchart LR
    A[قواعد هندسية<br/>110 محرك] --> D[قرار]
    B[نماذج إحصائية<br/>Bayesian + HMM + Monte Carlo] --> D
    C[تعلّم ذاتي<br/>Iterative Learning] --> D
    D --> E[توصية BUY/SELL<br/>مرفقة بـ R:R + Stop]
```

**لماذا؟** لأن مؤشرات Tushar Chande و Mark Minervini أثبتت تفوقها على LSTM على بيانات الأسواق الناشئة (مثل EGX) بسبب:
- حجم بيانات محدود (1,240 سهم EGX × 6 أشهر = غير كافٍ للتدريب العميق)
- تشوّش الأخبار المحلية (TL;DR من Telegram يحتاج Context لا Pattern)
- حاجة المستخدم لتفسير منطقي للقرار (LLM "صندوق أسود" غير مقبول)

### 1.2 فلسفة الـ Confluence (التقاء الأدلة)

النظام لا يعتمد على مؤشر واحد أبداً. كل قرار يجمع **5-9 مصادر دليل** بأوزان نسبية:

```mermaid
flowchart TB
    subgraph "أدلة فنية"
        T1[Technical 25%]
        T2[SMC/Order Blocks 60%]
        T3[Volume Profile 10%]
        T4[Candle Prob 5%]
    end
    subgraph "أدلة أساسية"
        F1[Piotroski F-Score]
        F2[Altman Z-Score]
        F3[Sector Relative P/E]
    end
    subgraph "أدلة سياقية"
        R1[Market Regime]
        R2[Persona Fit]
        R3[Seasonality]
        R4[News Sentiment]
    end
    
    T1 & T2 & T3 & T4 & F1 & F2 & F3 & R1 & R2 & R3 & R4 --> S[Confluence Score 0-100]
    S --> G{Score ≥ 78?}
    G -->|Yes| STRONG_BUY
    G -->|65-77| BUY
    G -->|55-64| ACCUMULATE
    G -->|45-54| NEUTRAL
    G -->|< 45| AVOID
```

### 1.3 فلسفة "Market Context is King"

النظام لا يصدر قراراً دون معرفة **سياق السوق الكلي** أولاً:

```mermaid
flowchart TD
    Start([كل سهم 1400 EGX]) --> R{Market Regime?}
    R -->|DEFENSIVE| D1[نصف حجم الصفقة<br/>رفع عتبة القبول لـ 70]
    R -->|NORMAL| D2[حجم كامل<br/>عتبة قبول 65]
    R -->|AGGRESSIVE| D3[زيادة 25% حجم<br/>قبول 55]
    
    D1 --> S{Stock Stage?}
    D2 --> S
    D3 --> S
    
    S -->|Stage 4| VETO[❌ HARD VETO<br/>بغض النظر عن Score]
    S -->|Stage 3| AVOID
    S -->|Stage 2| PROCEED
    S -->|Stage 1| WAIT
```

**القاعدة الذهبية:** إذا كان السوق في Stage 4 (هبوط) أو Regime DEFENSIVE، فإن أي سهم في Stage 4 يحظر حتى لو كانت كل المؤشرات الفنية إيجابية.

### 1.4 فلسفة "Learning Never Stops"

```mermaid
flowchart LR
    P[توصية اليوم] --> X[تنفيذ افتراضي<br/>paper_trade]
    X --> O[متابعة 1/5/10/20 يوم<br/>outcome_log]
    O --> L[extract lessons<br/>19,983 lesson learned]
    L --> W[update weights<br/>adaptive_weights.py]
    W --> P2[توصية الغد<br/>بأوزان محدثة]
    P2 --> X
```

كل توصية تُختبر بعد 1، 5، 10، 20 يوم وتُسجّل النتيجة (WIN/LOSS/BREAKEVEN). يوجد حالياً **8,544 outcome logs** + **19,983 lessons** في قاعدة البيانات.

---

## 2. البنية المعمارية الرباعية

النظام يتكوّن من **7 خدمات مستقلة** متصلة عبر HTTP + WebSocket، جميعها خلف بوابة Caddy واحدة:

```mermaid
flowchart TB
    User[👤 المستخدم<br/>متصفح / Telegram]
    
    subgraph "Gateway Layer"
        Caddy[Caddy :81<br/>Reverse Proxy<br/>XTransformPort routing]
    end
    
    subgraph "Display Layer"
        NextJS[Next.js :3000<br/>عرض فقط<br/>لا منطق]
    end
    
    subgraph "Brain Layer"
        Python[Python FastAPI :8010<br/>THE BRAIN<br/>110 analyzers]
        DataEngine[Data Engine :5000<br/>جلب البيانات]
    end
    
    subgraph "Real-time Layer"
        WS[WS Service :3005<br/>socket.io]
        TgEvents[Telegram Events :3003<br/>socket.io relay]
    end
    
    subgraph "Intelligence Layer"
        Ollama[Ollama :11434<br/>glm-fast LLM]
        NewsAgent[news-agent<br/>Python polling]
        TgBot[Telegram Interactive Bot]
        TgPoster[Telegram Auto-Poster]
    end
    
    subgraph "Persistence Layer"
        DB1[(stocks.db<br/>22MB)]
        DB2[(predictions.db<br/>276MB)]
        DB3[(price_history.db<br/>97MB)]
        DB4[(intraday.db<br/>170MB)]
        DB5[(data_engine.db<br/>51MB)]
        DB6[(auth.db)]
        DB7[(news.db)]
        DB8[(metrics.db)]
        DB9[(crypto.db)]
    end
    
    User -->|HTTPS| Caddy
    Caddy --> NextJS
    Caddy -.->|?XTransformPort=8010| Python
    Caddy -.->|?XTransformPort=3005| WS
    Caddy -.->|?XTransformPort=3003| TgEvents
    
    NextJS -->|API proxy /api/python/*| Python
    NextJS -->|better-sqlite3 readonly| DB1
    NextJS -->|Prisma| DB6
    
    Python --> DB1
    Python --> DB2
    Python --> DB3
    Python --> DB4
    Python --> DB5
    Python --> DB7
    
    DataEngine -->|scrapers| DB5
    DataEngine -->|sync| DB1
    DataEngine -->|sync| DB3
    DataEngine -->|intraday| DB4
    
    WS -->|poll 2s/30s| Python
    WS -->|broadcast| NextJS
    
    NewsAgent -->|Ollama| Ollama
    NewsAgent -->|POST /api/news| NextJS
    
    TgBot -->|query| Python
    TgPoster -->|publish| Python
```

### الجدول الإجمالي للخدمات

| # | الخدمة | المنفذ | اللغة | الدور | نقطة الدخول |
|---|---|---|---|---|---|
| 1 | Caddy | 81 | Go | Gateway + Reverse Proxy | Caddyfile |
| 2 | Next.js | 3000 | TypeScript | DISPLAY ONLY | `next start` |
| 3 | Python Backend | 8010 | Python (FastAPI + Flask) | THE BRAIN | `vps-service/main.py` |
| 4 | Data Engine | 5000 | Python (Flask) | جلب البيانات | `data_engine/main.py` |
| 5 | WS Service | 3005 | Bun + socket.io | تحديث لحظي | `vps-service/ws-service/index.ts` |
| 6 | Telegram Events | 3003 | Bun + socket.io | relay لأحداث Telegram | `telegram-events/index.ts` |
| 7 | Ollama | 11434 | Go | LLM محلي | systemd |
| 8 | News Agent | — | Python | تجميع + تحليل أخبار | PM2 |
| 9 | Telegram Poster | — | Python | جدولة النشر | PM2 |
| 10 | Telegram Bot | — | Python | بوت تفاعلي | PM2 |

---

## 3. خريطة الخدمات والموانئ

```mermaid
graph LR
    subgraph "الخارج"
        U[👤 المستخدم]
        TG[Telegram API]
        TV[TradingView]
        EG[EGKSCO]
        CG[CoinGecko]
        YF[Yahoo Finance]
        WB[World Bank]
        RSS[5 RSS EGX]
    end
    
    subgraph "السيرفر"
        C[Caddy :81] --> N[Next :3000]
        C --> P[Python :8010]
        C --> WS[WS :3005]
        C --> TE[TE :3003]
        
        N -->|proxy /api/python/*| P
        N -->|better-sqlite3| DB[(SQLite)]
        
        DE[Data Engine :5000] --> TV
        DE --> EG
        DE --> CG
        DE --> YF
        
        NA[news-agent] --> RSS
        NA --> Ollama[Ollama :11434]
        NA -->|POST /api/news| N
        
        P --> DB
        DE --> DB
        
        TB[Tg Bot] --> TG
        TP[Tg Poster] --> TG
        P --> TB
        P --> TP
    end
    
    U -->|HTTPS| C
    TG -.->|webhook| TE
```

### قواعد التوجيه (Routing Rules)

| الطلب | كيف يتوجّه؟ |
|---|---|
| `/` أو `/api/*` بدون XTransformPort | → Next.js :3000 |
| `/api/python/[path]?XTransformPort=8010` | → Python :8010 |
| `/?XTransformPort=3005` (socket.io) | → WS :3005 |
| `/?XTransformPort=3003` (socket.io) | → TE :3003 |
| `/api/reports/proxy?XTransformPort=8010` | → Python reports engine |

⚠️ **قاعدة صارمة:** كل طلبات API في الكود **يجب** تستخدم relative path + XTransformPort. لا يُسمح بـ `fetch('http://localhost:8010/...')` أبداً.

---

## 4. خريطة قواعد البيانات (9 قواعد)

```mermaid
erDiagram
    stocks_db ||--o{ stocks : contains
    stocks_db ||--o{ stock_daily_prices : contains
    stocks_db ||--o{ screener_presets : contains
    stocks_db ||--o{ ticker_registry : contains
    stocks_db ||--o{ outcome_logs : contains
    stocks_db ||--o{ real_evaluated_predictions : contains
    stocks_db ||--o{ macro_indicators : contains
    stocks_db ||--o{ system_settings : contains
    stocks_db ||--o{ ExpertRecommendation : contains
    stocks_db ||--o{ persona_predictions : contains
    
    predictions_db ||--o{ predictions : contains
    predictions_db ||--o{ stored_analyses : contains
    predictions_db ||--o{ cached_analysis : contains
    predictions_db ||--o{ crypto_predictions_log : contains
    predictions_db ||--o{ live_ai_signals : contains
    predictions_db ||--o{ learned_lessons : contains
    predictions_db ||--o{ regime_indicator_weights : contains
    predictions_db ||--o{ quant_cache : contains
    predictions_db ||--o{ paper_trades : contains
    predictions_db ||--o{ historical_trades : contains
    predictions_db ||--o{ stock_stories : contains
    predictions_db ||--o{ user_trades : contains
    predictions_db ||--o{ trade_outcomes : contains
    predictions_db ||--o{ telegram_recommendations : contains
    predictions_db ||--o{ market_regime_log : contains
    predictions_db ||--o{ wealth_tracking : contains
    predictions_db ||--o{ equity_snapshots : contains
    
    price_history_db ||--o{ price_history : contains
    
    intraday_db ||--o{ stock_intraday : contains
    intraday_db ||--o{ crypto_intraday : contains
    intraday_db ||--o{ commodity_intraday : contains
    
    data_engine_db ||--o{ stocks : contains
    data_engine_db ||--o{ crypto_prices : contains
    data_engine_db ||--o{ gold_prices : contains
    data_engine_db ||--o{ exchange_rates : contains
    data_engine_db ||--o{ historical_data : contains
    data_engine_db ||--o{ tab_balance_sheets : contains
    data_engine_db ||--o{ tab_income_statements : contains
    data_engine_db ||--o{ tab_cash_flows : contains
    
    auth_db ||--o{ User : contains
    auth_db ||--o{ Account : contains
    auth_db ||--o{ Session : contains
    auth_db ||--o{ ApiToken : contains
    auth_db ||--o{ UserSubscription : contains
    auth_db ||--o{ PortfolioItem : contains
    auth_db ||--o{ UserTelegramLink : contains
    
    news_db ||--o{ market_news : contains
    
    metrics_db ||--o{ resource_snapshot_raw : contains
    metrics_db ||--o{ resource_snapshot_5min : contains
    metrics_db ||--o{ pm2_process_snapshot : contains
```

### جدول مفصل بحجم كل DB

| # | اسم DB | الحجم | # جداول | أبرز الجداول | الدور |
|---|---|---|---|---|---|
| 1 | `stocks.db` | 22.66 MB | 51 | stocks (1,240), stock_daily_prices (85,626), outcome_logs (8,544), screener_presets (2,175) | **Operational read-mostly** — متزامن من data_engine.db |
| 2 | `predictions.db` | **276.91 MB** | 33 | crypto_predictions_log (187,345), historical_trades (22,650), learned_lessons (19,983), predictions (1,499) | **THE BRAIN STORE** — كل مخرجات المحركات |
| 3 | `price_history.db` | 97.07 MB | 2 | price_history (428,357) | OHLCV اليومي الكنسي |
| 4 | `intraday.db` | 170.26 MB | 6 | stock_intraday, crypto_intraday, commodity_intraday | سلاسل زمنية لحظية (7 يوم retention) |
| 5 | `data_engine.db` | 51.56 MB | 19 | stocks (2,492), crypto_prices (58,891), gold_prices (77,659), historical_data (99,076) | **Write target للـ scrapers** |
| 6 | `auth.db` | 0.25 MB | 14 | User, Account, Session, ApiToken, UserSubscription | مستخدمون + اشتراكات (Prisma) |
| 7 | `news.db` | 5.95 MB | 4 | market_news (SOT), news_articles (legacy) | أخبار من news-agent |
| 8 | `metrics.db` | 6.13 MB | 3 | resource_snapshot_raw/5min/1h, pm2_process_snapshot | مراقبة الأداء |
| 9 | `crypto.db` | 0.03 MB | 3 | cryptos, crypto_prediction_logs | metadata كريبتو |

### استراتيجية الطبقات (Tiered Strategy)

```mermaid
flowchart LR
    subgraph "Tier 1: Write-Heavy Raw"
        DE[(data_engine.db<br/>51MB)]
        IN[(intraday.db<br/>170MB)]
    end
    
    subgraph "Tier 2: Read-Heavy Synced"
        ST[(stocks.db<br/>22MB)]
        PH[(price_history.db<br/>97MB)]
    end
    
    subgraph "Tier 3: Brain Output"
        PR[(predictions.db<br/>276MB)]
    end
    
    subgraph "Tier 4: User State"
        AU[(auth.db)]
        NW[(news.db)]
    end
    
    DE -->|sync_current_prices| ST
    IN -->|post-market aggregate| PH
    DE -->|Maestro orchestrator| PR
    ST -->|analysis| PR
```

---

## 5. مصادر البيانات الـ12

| # | المصدر | الفيب | من يجلبها | أين تُخزَّن | الجدول |
|---|---|---|---|---|---|
| 1 | **TradingView** | REST API + screener | `data_engine/scrapers/tradingview_*.py` | data_engine.db | stocks |
| 2 | **EGKSCO** | EGX fundamentals + 15min prices | `egksco_scraper.py` | data_engine.db | stocks + tab_* |
| 3 | ~~EGXPilot~~ | DEPRECATED | — | — | — |
| 4 | ~~Yahoo Finance~~ | ARCHIVED (أمس) | — | — | — |
| 5 | **CoinGecko-style** | BTC/ETH OHLCV | `crypto_fetcher.py` | data_engine.db | crypto_prices (58,891) |
| 6 | **Metals & Forex** | XAU, XAG, Oil, EUR/USD, USD/EGP, SAR/USD | `metals_forex_fetcher.py` | data_engine.db | gold_prices (77,659) + exchange_rates (32,270) |
| 7 | **World Bank API** | Egypt CPI inflation | `fetch_inflation_worldbank.py` | stocks.db | macro_indicators |
| 8 | **RSS (EGX)** | argaam, amwalalghad, masrawy, hapijournal, youm7 | `news-agent/collectors/rss_collector.py` | news.db | market_news |
| 9 | **Web scraping** | mubasher, alborsaa, almalnews, DuckDuckGo | `news-agent/collectors/web_scraper.py` | news.db | market_news |
| 10 | **Telegram channels** | 13 قناة EGX (sahmmisr, borsablarabi, easier_stock...) | `telegram_collector.py` (Telethon) — **DISABLED by default** | news.db | market_news |
| 11 | **Ollama** | LLM محلي (qwen2.5:1.5b + glm-fast) | `news-agent/analyzer/news_analyzer.py` | في الذاكرة فقط | — |
| 12 | ~~EODHD~~ | ملغى الاشتراك | — | — | — |

---

## 6. المخطط العام لتدفق البيانات

```mermaid
flowchart TD
    subgraph "L1: Data Ingestion"
        TV[TradingView] --> DE
        EG[EGKSCO] --> DE
        CG[CoinGecko] --> DE
        MF[Metals/FX] --> DE
        RSS[RSS/Web] --> NA[news-agent]
        NA -->|Ollama| OLL[glm-fast]
        NA -->|POST /api/news| NX[Next.js]
    end
    
    subgraph "L2: Storage"
        DE[data_engine.db]
        IN[intraday.db]
        ST[stocks.db]
        PH[price_history.db]
        NW[news.db]
    end
    
    subgraph "L3: Analysis (110 engines)"
        MA[master_analyzer<br/>5794 LOC]
        SC[confluence_scorer]
        RG[market_regime_engine]
        UN[unified_learning_engine<br/>1365 LOC]
        QU[quant_overdrive<br/>Monte Carlo]
        AI[glm_finance_agent<br/>Ollama LLM]
    end
    
    subgraph "L4: Output Store"
        PR[(predictions.db)]
    end
    
    subgraph "L5: API"
        NX2[Next.js /api/*]
        PY[Python :8010]
    end
    
    subgraph "L6: User"
        FE[Frontend React]
        TG[Telegram]
    end
    
    DE --> ST
    DE --> PH
    DE --> IN
    NX --> NW
    
    ST --> MA
    PH --> MA
    IN --> MA
    NW --> MA
    ST --> RG
    PH --> RG
    
    MA --> SC
    RG --> SC
    AI --> SC
    QU --> SC
    
    SC --> PR
    UN --> PR
    MA --> PR
    
    PR --> PY
    ST --> PY
    
    PY --> NX2
    NX2 --> FE
    PY --> TG
```

---

## 7. المحرك المركزي: master_analyzer.py

هذا هو **العقل المدبر** — 5,794 سطر Python. يجمع **8 قواعد ذهبية** + 9 مصادر دليل.

### 7.1 مخطط الإدخال/المعالجة/الإخراج

```mermaid
flowchart TB
    subgraph "INPUTS"
        T1[ticker symbol]
        T2[stocks.db row]
        T3[price_history 250 day]
        T4[intraday candles today]
        T5[fundamental data 9 tables]
        T6[sector data]
        T7[news sentiment]
        T8[market regime]
    end
    
    subgraph "PROCESSING PIPELINE"
        P1[1. Liquidity Filter<br/>filter illiquid stocks]
        P2[2. Market Regime Check<br/>DEFENSIVE? Cut size]
        P3[3. Sector Strength<br/>vs EGX30/100]
        P4[4. Session Timing<br/>pre-market/intraday/close]
        P5[5. Technical Analysis<br/>RSI, MACD, ADX, BB]
        P6[6. Fundamental Score<br/>Piotroski + Altman]
        P7[7. News Sentiment<br/>from news.db]
        P8[8. AI Pattern Detection<br/>candlestick + chart patterns]
        P9[9. Multi-Timeframe<br/>1D + 1W + 1M alignment]
        P10[10. Volume Profile<br/>POC, VAH, VAL]
        
        G[8 GOLDEN RULES<br/>Hard Veto Layer]
        
        CS[Confluence Score 0-100]
        
        PS[Persona Suitability<br/>7 personas]
        
        DT[Dynamic Targets<br/>ATR-based entries/stops]
    end
    
    subgraph "OUTPUT"
        O1[signal: STRONG_BUY/BUY/ACCUMULATE/NEUTRAL/AVOID]
        O2[entry_price]
        O3[target_price + 3 tiers TP1/TP2/TP3]
        O4[stop_loss ATR-based]
        O5[master_score 0-100]
        O6[confidence 0-100]
        O7[R:R ratio]
        O8[reasoning narrative Arabic]
        O9[proof list - 6 proofs]
    end
    
    T1 --> P1
    T2 --> P1
    T3 --> P5
    T4 --> P5
    T5 --> P6
    T6 --> P3
    T7 --> P7
    T8 --> P2
    
    P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8 --> P9 --> P10
    P10 --> G
    G -->|veto| VETO[❌ REJECT]
    G -->|pass| CS
    CS --> PS
    PS --> DT
    DT --> O1 & O2 & O3 & O4 & O5 & O6 & O7 & O8 & O9
```

### 7.2 الـ 8 قواعد ذهبية (Hard Veto)

| # | القاعدة | الشرط | النتيجة |
|---|---|---|---|
| 1 | Liquidity Floor | turnover < 1M EGP/day | AVOID |
| 2 | Stage 4 Hard Veto | price < 200SMA + 200SMA falling | STRONG_AVOID (بغض النظر عن score) |
| 3 | Earnings Blackout | within 3 days of earnings | NEUTRAL (wait) |
| 4 | Gap Down > 5% | gap down > 5% from prev close | AVOID 24h |
| 5 | Volume Spike Anomaly | volume > 5× avg + price up < 2% | distribution warning |
| 6 | Market Regime Override | Regime = DEFENSIVE + stock beta > 1.5 | half size + higher threshold |
| 7 | News Negative Sentiment | news sentiment < -0.6 in last 24h | AVOID 24h |
| 8 | Ticker Cooldown | within 7 days of last false signal | SKIP (ticker_cooldown.py) |

### 7.3 عتبات الإشارة (Thresholds)

```python
# من analyzers/canonical_signal.py (SSOT)
STRONG_BUY ≥ 78   # + persona fit + market regime aligned
BUY ≥ 65
ACCUMULATE ≥ 55   # build position gradually
NEUTRAL 45-54    # wait
AVOID < 45       # sell or stay away
STRONG_AVOID     # hard veto (Stage 4 etc.)
```

---

## 8. فهرس المحركات الـ110 (حسب الفئة)

### 8.1 — Master/Fusion Orchestrators (10 engines)

```mermaid
mindmap
  root((MASTER BRAINS))
    master_analyzer
      :5794 LOC
      :8 Golden Rules
      :Thresholds 78/65/55
    core_scoring_engine
      :2576 LOC
      :Unified Stock+Profile+Persona
    sniper_engine
      :DISABLED Rule 67/73
    confluence_engine_v3
      :SMC 60% Fund 15% Vol 10% Tech 15%
      :DISABLED signal
    institutional_decision_engine
      :V39 Pine port
      :6 Proofs + dynamic_thresh
    board_of_analysts
      :DISABLED
    v82_analyzer
      :DISABLED
      :9-condition gate + Kill Switch
    v68_oracle
      :Future Fingerprint
      :Prob 4×25=0-100
    fusion_engine
      :V20 LuxAlgo+BigBeluga+SMC
    unified_maestro
      :Market Router
      :EGX→Maestro / CRYPTO→CryptoMaestro
```

### 8.2 — Technical/Indicator (16 engines)

| Engine | LOC | ماذا يفعل |
|---|---|---|
| `technical.py` | 613 | RSI, MACD, ADX, BB canonical |
| `technical_weighted.py` | 542 | مؤشرات بأوزان حسب Regime |
| `technical_target_engine.py` | 888 | أهداف سعرية من المؤشرات |
| `technical_explainer.py` | 718 | تفسير عربي للمؤشرات |
| `enhanced_indicators.py` | 393 | مؤشرات مركبة |
| `multi_timeframe_engine.py` | 317 | 1D + 1W + 1M alignment |
| `live_indicator_engine.py` | 1143 | delta لحظي من cached_analysis |
| `intraday_reader.py` | 291 | قراءة intraday.db |
| `candlestick.py` | 492 | أنماط الشموع اليابانية |
| `candle_probability_engine.py` | 377 | احتمالات الشموع |
| `patterns.py` | 281 | H&S, Double Top, Triangles |
| `fibonacci.py` | 281 | retracement + extension |
| `volume_profile.py` | 344 | POC, VAH, VAL |
| `smc_engine.py` | 452 | Order Blocks + FVG + Liquidity Sweeps |
| `multi_path_detector.py` | 502 | multi-scenario paths |
| `support_resistance_calculator.py` | 943 | fractal pivots |

### 8.3 — Regime/Risk/Liquidity (15 engines)

```mermaid
flowchart LR
    subgraph "Regime Detection"
        MRE[market_regime_engine<br/>1380 LOC<br/>2-3 day hysteresis]
        RD[regime_detector]
        RF[regime_filter]
        HMM[hmm_market_regime<br/>Hidden Markov Model]
        CR[crypto_regime]
    end
    
    subgraph "Risk"
        RSK[risk.py<br/>CANONICAL per-trade]
        RAD[risk_adaptive.py<br/>CANONICAL adaptive]
    end
    
    subgraph "Liquidity"
        LF[liquidity_filter<br/>1111 LOC]
        SEF[strict_entry_filters]
        CSF[crypto_strict_filters]
        CQG[crypto_quality_gate<br/>5 factors → Health 0-100]
    end
    
    subgraph "Quality Gates"
        EQG[expert_quality_gate<br/>6 tests]
        EMB[expert_memory_bridge<br/>agree +18 / disagree -25]
        TC[ticker_cooldown<br/>7-day freeze]
    end
    
    MRE --> RSK
    HMM --> MRE
    LF --> SEF
    EQG --> EMB
```

### 8.4 — Fundamental/Seasonality/Sector (12 engines)

| Engine | ماذا يحسب |
|---|---|
| `fundamental.py` | الأساسيات الكلاسيكية |
| `fundamental_engine.py` | محرك أساسي موحّد |
| `fundamental_relative.py` | P/E نسبة للقطاع |
| `fundamental_scorer.py` | **Piotroski F-Score + Altman Z-Score** |
| `fair_value_calculator.py` | قيمة عادلة (DCF) |
| `real_return_engine.py` | عائد حقيقي بعد التضخم |
| `seasonality_scorer.py` | أفضل/أسوأ شهور للسهم |
| `dividend_checker.py` | توزيعات أرباح |
| `sector_relative.py` | أداء نسبي للقطاع (18 قطاع EGX) |
| `backtest_engine.py` | Walk-Forward Validation |

### 8.5 — Prediction Tracking/Learning (12 engines)

```mermaid
flowchart TB
    subgraph "Prediction Lifecycle"
        PT[prediction_tracker<br/>1429 LOC]
        EPT[enhanced_prediction_tracker<br/>1027 LOC - gold-standard]
    end
    
    subgraph "Learning"
        ULE[unified_learning_engine<br/>1365 LOC - THE LEARNING BRAIN]
        PO[prediction_optimizer<br/>1586 LOC]
        AW[adaptive_weights<br/>791 LOC - Persona weight matrix]
        LFS[learning_file_storage]
        FL[feedback_loop]
        DL[decision_logger]
    end
    
    subgraph "Quant"
        QE[quant_engine]
        QO[quant_overdrive<br/>SMFI + Monte Carlo 500 paths]
        QC[quant_cache<br/>nightly 03:00 Cairo]
        NJQ[nightly_quant_job]
    end
    
    PT --> EPT --> ULE
    ULE --> PO
    PO --> AW
    QE --> QO --> QC
    NJQ --> QC
```

#### تفصيل unified_learning_engine (العقل التعلّمي)

```mermaid
flowchart TB
    subgraph "5 Learning Modules"
        M1[Iterative Learning<br/>adjusts weights based on<br/>last 100 outcomes]
        M2[Bayesian Intelligent<br/>posterior probability<br/>updates per indicator]
        M3[Mirror 6 Questions<br/>What worked? When? Why?<br/>What didn't? Why not?<br/>What to do next?]
        M4[IndicatorTrust<br/>per-indicator hit rate]
        M5[PatternDetect<br/>recurring patterns]
        M6[LessonMining<br/>extracts textual lessons<br/>19,983 lessons stored]
        M7[CrossValidation<br/>walk-forward validation]
    end
    
    subgraph "Outputs"
        O1[learned_lessons table]
        O2[regime_indicator_weights table]
        O3[optimizer_params.json<br/>atomic write]
    end
    
    M1 --> O2
    M2 --> O2
    M3 --> O1
    M4 --> O2
    M5 --> O1
    M6 --> O1
    M7 --> O3
```

### 8.6 — Persona/Position/Portfolio (10 engines)

```mermaid
flowchart LR
    subgraph "Personas (7 types)"
        P1[Conservative<br/>low risk + dividends]
        P2[Investor<br/>growth + fundamentals]
        P3[Gambler<br/>high beta + momentum]
        P4[Hedger<br/>gold + bonds + EGX]
        P5[Swing<br/>3-30 days]
        P6[Day Trader<br/>intraday only]
        P7[Position Trader<br/>weeks-months]
    end
    
    subgraph "Position Management"
        PM[position_manager<br/>HOLD/TRAIL/EXIT per day]
        PS[position_sizing]
        SPM[smart_portfolio_monitor]
    end
    
    subgraph "Rescue"
        BHR[bag_holder_rescue<br/>FALLING_KNIFE → liquidate]
        SHE[short_holding_exit]
        SRE[stock_rescue_engine<br/>Golden Dip → cooldown + TP1 +6.5%]
    end
    
    subgraph "DNA"
        SDA[stock_dna_analyzer<br/>yearly behavior narrative<br/>best/worst months]
        SN[stock_notebook]
    end
    
    P1 & P2 & P3 & P4 & P5 & P6 & P7 --> PM
    PM --> SPM
    SPM --> BHR
    SPM --> SHE
```

### 8.7 — Reporting (8 engines)

| Engine | المخرج |
|---|---|
| `narrative_generator.py` | تفسير عربي للقرار |
| `social_card_generator.py` | صورة بطاقة للسوشيال ميديا |
| `reports_engine.py` | PDF reports |
| `market_daily_report.py` | تقرير يومي شامل |
| `conviction_engine.py` | MAX 15% / NORMAL 10% position |
| `confidence_engine.py` | 7 factors × 0-15 = 0-100 |

### 8.8 — Canonical Indicator Library (10 files)

```python
# analyzers/indicators/ — THE SSOT (Rule 54)
# كل المحركات الأخرى يجب أن تستدعي هذه، لا أن تعيد الحساب
adx.py              # 143 LOC - ADX/DI+/DI-
atr.py              # 74 LOC - Wilder ATR
bollinger.py        # 119 LOC - BB upper/middle/lower
flow_indicators.py  # 367 LOC - MFI + CMF + OBV
ma.py               # 125 LOC - SMA/EMA/MACD
mfi.py              # 98 LOC - Money Flow Index
rsi.py              # 66 LOC - RSI Wilder
srsi.py             # 125 LOC - Stochastic RSI
volume_profile.py   # 132 LOC - POC/VAH/VAL
vwap.py             # 103 LOC - Volume Weighted Average Price
```

---

## 9. منطق الـ Confluence Scoring

الـ Confluence هو **الاتحاد النهائي** لكل الأدلة. كل محرك ينتج score جزئي، والـ confluence_scorer يدمجها بأوزان نسبية.

### 9.1 — معادلة الـ Confluence الكلية

```
FINAL_SCORE = w1×Tech + w2×SMC + w3×Vol + w4×Fund + w5×Regime + w6×Persona + w7×Season + w8×News

حيث الأوزان الافتراضية (Confluence Engine V3):
  w1 = 0.15  (Technical 15%)
  w2 = 0.60  (SMC 60%) ←—the dominant signal
  w3 = 0.10  (Volume 10%)
  w4 = 0.15  (Fundamentals 15%)

ثم ضرب في liquidity_multiplier (0.5 - 1.2)
ثم ضرب في regime_multiplier (DEFENSIVE=0.7, NORMAL=1.0, AGGRESSIVE=1.15)
ثم persona_fit_bonus (-10 إلى +15)
```

### 9.2 — خريطة الأوزان

```mermaid
flowchart TB
    subgraph "Stage 1: Per-Engine Scores 0-100"
        T[Technical Score<br/>RSI + MACD + ADX + BB]
        S[SMC Score<br/>OB + FVG + Sweep]
        V[Volume Score<br/>MFI + OBV + Profile]
        F[Fundamental Score<br/>Piotroski + Altman]
        R[Regime Score<br/>DEFENSIVE/NORMAL/AGGRESSIVE]
        P[Persona Fit Score<br/>7 personas]
        SS[Seasonality Score<br/>best/worst months]
        N[News Sentiment<br/>-1.0 to +1.0]
    end
    
    subgraph "Stage 2: Weighted Sum"
        W1[T×0.15]
        W2[S×0.60]
        W3[V×0.10]
        W4[F×0.15]
        W5[R×1.0 → multiplier]
        W6[P×1.0 → bonus]
        W7[SS×1.0 → bonus]
        W8[N×1.0 → bonus]
    end
    
    subgraph "Stage 3: Multipliers"
        LM[Liquidity Mult<br/>0.5 - 1.2]
        RM[Regime Mult<br/>0.7 / 1.0 / 1.15]
        PB[Persona Bonus<br/>-10 to +15]
    end
    
    subgraph "Stage 4: Final"
        FS[FINAL SCORE 0-100]
    end
    
    T --> W1
    S --> W2
    V --> W3
    F --> W4
    R --> W5
    P --> W6
    SS --> W7
    N --> W8
    
    W1 & W2 & W3 & W4 -->|sum| FS
    W5 --> RM --> FS
    W6 & W7 & W8 -->|add bonus| FS
    LM --> FS
```

### 9.3 — Minervini Confluence (الـ 5 محركات الأصلية)

```python
# glminvestment_engines/confluence/confluence_scorer.py
WEIGHTS = {
    'donchian':    0.30,   # Turtle breakout
    'atr':         0.25,   # Wilder risk
    'stage2':      0.20,   # Minervini trend
    'vcp':         0.10,   # Volatility Contraction
    'persona':     0.10,   # Persona fit
    'seasonality': 0.05,   # Calendar effects
}

# HARD VETO: if EGX30 < SMA200 → STRONG_AVOID regardless of score
```

---

## 10. نظام Market Regime

### 10.1 — الثلاث حالات

```mermaid
stateDiagram-v2
    [*] --> NORMAL: default
    
    NORMAL --> DEFENSIVE: EGX30 drops 5%<br/>in 5 days OR<br/>EGX30 < SMA200
    NORMAL --> AGGRESSIVE: EGX30 up 8%<br/>in 5 days AND<br/>volatility < 20%
    
    DEFENSIVE --> NORMAL: 3 days stable<br/>above SMA200
    AGGRESSIVE --> NORMAL: 2 days pullback<br/>-3% from peak
    
    note right of DEFENSIVE
        - Cash mode
        - Half position size
        - Higher threshold (70+)
        - Skip high-beta
    end note
    
    note right of NORMAL
        - Full position size
        - Standard threshold (65+)
        - All stocks eligible
    end note
    
    note right of AGGRESSIVE
        - +25% position size
        - Lower threshold (55+)
        - Take more trades
        - Shorter holds OK
    end note
```

### 10.2 — آلية الـ Hysteresis

لمنع التذبذب السريع بين الحالات (flip-flop):

```python
# analyzers/market_regime_engine.py
HYSTERESIS_DAYS = {
    'DEFENSIVE → NORMAL': 3,  # يتطلب 3 أيام استقرار فوق SMA200
    'NORMAL → DEFENSIVE': 1,  # فوري يوم واحد هبوط حاد
    'AGGRESSIVE → NORMAL': 2, # يتطلب يومين pullback
    'NORMAL → AGGRESSIVE': 5, # يتطلب 5 أيام صعود مستمر
}

# Stored in stocks.db.system_settings key='current_regime_EGX'
# Read by: daily_predictor, liquidity_filter, position_sizing, /api/market/regime
```

### 10.3 — من يقرأ الـ Regime؟

```mermaid
flowchart LR
    MRE[market_regime_engine] -->|writes| SS[stocks.db.system_settings]
    SS -->|reads| DP[daily_predictor]
    SS -->|reads| LF[liquidity_filter]
    SS -->|reads| PS[position_sizing]
    SS -->|reads| AP[/api/market/regime/]
    SS -->|reads| MA[master_analyzer]
```

---

## 11. تصنيف Minervini للمراحل (Stage 1-4)

نظام Mark Minervini SEPA (Specific Entry Point Analysis) يصنّف كل سهم إلى واحدة من 4 مراحل:

```mermaid
flowchart TD
    Start([Stock price vs 200SMA]) --> Q1{price > 200SMA?}
    
    Q1 -->|No + 200SMA falling| S4[Stage 4<br/>BEAR/Downtrend<br/>❌ STRONG_AVOID HARD VETO]
    Q1 -->|No + 200SMA rising| S1[Stage 1<br/>BASE/Consolidation<br/>NEUTRAL - wait]
    
    Q1 -->|Yes| Q2{200SMA rising?}
    Q2 -->|No| S3[Stage 3<br/>TOP/Distribution<br/>AVOID]
    Q2 -->|Yes| Q3{Within 25% of 52wHigh?}
    
    Q3 -->|No| S2_3[Stage 2 Extended<br/>caution]
    Q3 -->|Yes| Q4{> 70% above 200SMA?}
    
    Q4 -->|Yes| S3
    Q4 -->|No| Q5{ADX ≥ 25?}
    
    Q5 -->|No| S2_weak[Stage 2 Weak<br/>low momentum]
    Q5 -->|Yes| Q6{Golden Cross?<br/>50SMA > 200SMA}
    
    Q6 -->|Yes| S2[Stage 2<br/>BULL/Uptrend<br/>✅ BUY/STRONG_BUY]
    Q6 -->|No| S2_emerging[Stage 2 Emerging<br/>early entry]
```

### جدول المراحل

| Stage | الاسم | الشرط الفني | الإشارة | أمثلة سلوكية |
|---|---|---|---|---|
| 1 | Base / Consolidation | price ≈ 200SMA flat | NEUTRAL (wait) | تجميع، انقباض حجمي |
| 2 | Uptrend / Bull | price > 200SMA rising + Golden Cross + ADX≥25 + ≤25% from 52wHigh + ≤70% above 200SMA | **BUY / STRONG_BUY** | VCP, breakout, volume surge |
| 3 | Distribution / Top | price > 200SMA but 200SMA flat or price > 70% above | AVOID | lower highs, volume divergence |
| 4 | Downtrend / Bear | price < 200SMA + 200SMA falling | **STRONG_AVOID (HARD VETO)** | lower lows, death cross |

### تطبيق في الكود

```python
# glminvestment_engines/engines/stage2_filter.py
def classify_stage(price_data):
    price = price_data[-1].close
    sma200 = SMA(price_data, 200)[-1]
    sma50 = SMA(price_data, 50)[-1]
    high_52w = max(c.close for c in price_data[-260:])
    adx = ADX(price_data, 14)[-1]
    
    if price < sma200 and sma200 < SMA(price_data, 200)[-2]:
        return 'Stage 4'  # HARD VETO
    if price < sma200:
        return 'Stage 1'
    if sma200 > SMA(price_data, 200)[-2]:
        return 'Stage 3'  # distribution
    if (price - high_52w) / high_52w > -0.25:
        if price / sma200 - 1 <= 0.70:
            if adx >= 25 and sma50 > sma200:
                return 'Stage 2'  # BUY
            return 'Stage 2 Emerging'
        return 'Stage 3'
    return 'Stage 2 Extended'
```

---

## 12. نظام الـ Personas (7 أنماط مستثمر)

النظام لا يصدر توصية "واحدة تناسب الجميع". بدلاً من ذلك، يحسب لكل سهم مدى ملاءمته لـ 7 شخصيات مختلفة:

```mermaid
flowchart TB
    Stock[Stock Analysis] --> P1[Conservative<br/>risk_score: 0-30]
    Stock --> P2[Investor<br/>risk_score: 30-50]
    Stock --> P3[Gambler<br/>risk_score: 70-100]
    Stock --> P4[Hedger<br/>diversified]
    Stock --> P5[Swing<br/>3-30 days]
    Stock --> P6[Day Trader<br/>intraday]
    Stock --> P7[Position Trader<br/>weeks-months]
    
    P1 --> R1[Match Score 0-100]
    P2 --> R2[Match Score 0-100]
    P3 --> R3[Match Score 0-100]
    P4 --> R4[Match Score 0-100]
    P5 --> R5[Match Score 0-100]
    P6 --> R6[Match Score 0-100]
    P7 --> R7[Match Score 0-100]
    
    R1 & R2 & R3 & R4 & R5 & R6 & R7 --> DB[(persona_predictions<br/>1,669 rows)]
    
    User[User] -->|profile.risk_tolerance| SelectPersona
    SelectPersona{User Persona?} -->|matched| Recommend[Personalized Picks]
```

### مصفوفة الأوزان حسب الـ Persona (adaptive_weights.py)

| Persona | SMC | Fund | Tech | Volume | Regime | Season | News |
|---|---|---|---|---|---|---|---|
| Conservative | 0.15 | **0.50** | 0.10 | 0.05 | 0.15 | 0.03 | 0.02 |
| Investor | 0.20 | 0.35 | 0.15 | 0.10 | 0.10 | 0.05 | 0.05 |
| Gambler | **0.45** | 0.05 | 0.25 | 0.15 | 0.05 | 0.03 | 0.02 |
| Hedger | 0.10 | 0.30 | 0.05 | 0.05 | 0.20 | 0.05 | 0.25 |
| Swing | 0.30 | 0.15 | 0.25 | 0.15 | 0.10 | 0.03 | 0.02 |
| Day | 0.25 | 0.05 | **0.40** | 0.20 | 0.05 | 0.02 | 0.03 |
| Position | 0.20 | 0.25 | 0.15 | 0.10 | 0.20 | **0.07** | 0.03 |

> لاحظ كيف يتم تفضيل SMC عند الـ Gambler، وFundamentals عند الـ Conservative/Hedger، وTechnical عند الـ Day Trader.

---

## 13. حلقة التعلم الذاتي (Learning Loop)

```mermaid
flowchart LR
    subgraph "Day T"
        P1[Prediction generated<br/>signal=BUY, entry=12.5, target=14.0, stop=11.8]
    end
    
    subgraph "Day T+1"
        P2[Market opens<br/>paper_trade executes]
        M1[price moved to 12.7<br/>+1.6%]
    end
    
    subgraph "Day T+5"
        M2[price reached 13.8<br/>near TP1]
        O1[Outcome Log #1<br/>5-day return: +10.4%<br/>status: WIN_PENDING]
    end
    
    subgraph "Day T+10"
        M3[price reached 14.1<br/>TP hit!]
        O2[Outcome Log #2<br/>10-day return: +12.8%<br/>status: WIN<br/>exit_type: TARGET_HIT]
    end
    
    subgraph "Day T+11"
        L[Lesson Extraction]
        L --> L1[Indicator Trust:<br/>RSI=68%, MACD=71%, ADX=55%]
        L --> L2[Pattern:<br/>VCP+breakout worked in Stage 2]
        L --> L3[Lesson Text:<br/>"Stage 2 + VCP + ADX>30 → +10% in 10 days"]
        
        L1 --> W[Update regime_indicator_weights]
        L2 --> S[Update stock_stories]
        L3 --> LL[Insert learned_lessons<br/>19,983 total]
        
        W --> NextPred[Day T+12 prediction<br/>uses updated weights]
    end
    
    P1 --> P2
    P2 --> M1
    M1 --> M2
    M2 --> O1
    O1 --> M3
    M3 --> O2
    O2 --> L
```

### آلية التعلّم التفصيلية

```python
# analyzers/unified_learning_engine.py (THE LEARNING BRAIN - 1365 LOC)

# 5 modules work in parallel:

# 1. Iterative Learning
#    - Takes last 100 outcomes
#    - For each indicator: count(WIN) / count(TOTAL)
#    - If hit_rate > 0.60 → boost weight by 5%
#    - If hit_rate < 0.40 → cut weight by 10%
#    - Writes: regime_indicator_weights

# 2. Bayesian Intelligent
#    - Prior: current weight distribution
#    - Likelihood: P(outcome | indicator on)
#    - Posterior: updated weight
#    - Uses: beta distribution conjugate prior

# 3. Mirror (6 Questions)
#    - What worked?
#    - When did it work?
#    - Why did it work?
#    - What didn't work?
#    - Why not?
#    - What to do next?
#    → generates textual lessons for LLM consumption

# 4. IndicatorTrust
#    - Per-indicator hit rate over last 200 trades
#    - If < 0.45 → DISABLE indicator
#    - If > 0.65 → mark as "high-trust"

# 5. CrossValidation
#    - Walk-forward: train on months 1-5, test on month 6
#    - If accuracy drops > 10% → regime shift detected
#    - Writes: optimizer_params.json (atomic)
```

### إحصائيات التعلم الحالية

| Metric | Value |
|---|---|
| Total predictions logged | 1,499 active + 4,035 evaluated |
| Outcome logs (1/5/10/20-day) | 8,544 |
| Learned lessons (text) | 19,983 |
| Historical trades (backtest) | 22,650 |
| Stock stories (RAG) | varies |
| Iterative weight updates | continuous |
| Quant cache snapshots | 03:00 Cairo daily |

---

## 14. ثلاثة مسارات تدفق بيانات كاملة

### 14.1 — مسار التوصية اليومية (Daily Prediction)

```mermaid
sequenceDiagram
    participant CRON as Cron<br/>(14:30 Cairo)
    participant DP as daily_predictor<br/>4730 LOC
    participant MA as master_analyzer
    participant SC as confluence_scorer
    participant RG as market_regime_engine
    participant PR as predictions.db
    participant TP as telegram_poster
    participant TG as Telegram Channel
    participant DC as daily_closer<br/>(T+1..T+N)
    participant TR as prediction_tracker
    
    CRON->>DP: trigger --today-only
    
    DP->>RG: get current_regime_EGX
    RG-->>DP: NORMAL
    
    loop For each stock (1,240 EGX stocks)
        DP->>MA: analyze(ticker, regime=NORMAL)
        
        MA->>MA: 1. Liquidity Filter
        MA->>MA: 2. Stage Classifier
        MA->>MA: 3. Technical (RSI/MACD/ADX/BB)
        MA->>MA: 4. Fundamental (Piotroski/Altman)
        MA->>MA: 5. SMC (OB/FVG/Sweep)
        MA->>MA: 6. Volume Profile
        MA->>MA: 7. News Sentiment
        MA->>MA: 8. Multi-Timeframe
        MA->>MA: 9. 8 Golden Rules Veto
        
        MA->>SC: confluence(scores)
        SC-->>MA: FINAL_SCORE 0-100
        
        MA->>MA: persona_fit × 7
        MA->>MA: ATR-based targets (entry/stop/TP1/TP2/TP3)
        
        MA-->>DP: signal, score, entry, stop, targets, proofs
        
        opt Score >= 65 (BUY threshold)
            DP->>PR: INSERT predictions (was_published=0)
        end
    end
    
    DP->>DP: rank top picks per persona
    DP->>TP: send top 5 BUY picks
    
    loop For each pick
        TP->>TG: post recommendation card
        TP->>PR: UPDATE was_published=1
    end
    
    Note over DC,TR: Day T+1 to T+20
    
    loop Every market day
        DC->>PR: fetch active predictions
        loop For each active prediction
            DC->>DC: compute current P&L
            opt TP hit
                DC->>PR: exit_type=TARGET_HIT, pnl_pct=...
            end
            opt Stop hit
                DC->>PR: exit_type=STOP_LOSS, pnl_pct=...
            end
            opt Trailing exit
                DC->>PR: exit_type=TRAILING_EXIT
            end
            opt Time exit (20 days)
                DC->>PR: exit_type=TIME_EXIT
            end
        end
    end
    
    TR->>PR: aggregate outcome_logs (1d/5d/10d/20d)
    TR->>TR: extract lessons → learned_lessons
    TR->>TR: update regime_indicator_weights
```

### 14.2 — مسار إشارة الـ Maker Radar اللحظية

```mermaid
sequenceDiagram
    participant FE as Frontend<br/>MakerRadarTab
    participant NX as Next.js /api/maker-radar
    participant RC as radar-cache.ts
    participant SP as child_process.spawn<br/>scripts/maker_radar.py
    participant DE as data_engine.db
    participant ST as stocks.db
    participant PY as Python :8010
    participant WS as WS :3005
    
    FE->>NX: GET /api/maker-radar?market=EGX
    
    NX->>RC: readRadarCache(EGX)
    alt Cache fresh (< 5 min)
        RC-->>NX: cached JSON
    else Cache stale
        RC->>SP: spawn python maker_radar.py EGX
        SP->>DE: read egksco_price_history
        SP->>DE: read historical_data
        SP->>SP: compute 3 tracks:
        Note over SP: Track 1: Quiet Accumulation (vol≥2%)<br/>Track 2: Explosive Surge (vol≥2%)<br/>Track 3: Early Break (vol≥2.5%)
        SP->>RC: write db/maker_radar_tracking.json
        SP->>RC: write scripts/output/maker_radar_EGX_YYYYMMDD.json
        RC-->>NX: fresh JSON
    end
    
    NX->>ST: enrich with live prices (better-sqlite3)
    NX->>NX: trial-expiry gate check
    alt Free user
        NX-->>FE: 60min-delayed data
    else Premium user
        NX-->>FE: real-time data
    end
    
    FE->>WS: io("/?XTransformPort=3005")
    WS->>PY: poll /api/stocks every 2s during session
    PY-->>WS: price updates
    WS->>FE: emit "ticker:update" / "stock:alert"
    FE->>FE: live update without refresh
```

### 14.3 — مسار تحليل المحفظة (Portfolio Analysis)

```mermaid
sequenceDiagram
    participant U as User
    participant NX as Next.js /api/portfolio/holdings
    participant AH as auth-helper<br/>getSessionUserId
    participant AU as auth.db
    participant PY as Python :8010
    participant PR as ai/portfolio_routes.py
    participant ST as stocks.db
    participant DE as data_engine.db
    participant PD as predictions.db
    participant BHR as bag_holder_rescue
    participant SM as smart_portfolio_monitor
    
    U->>NX: GET /api/portfolio/holdings
    
    NX->>AH: getSessionUserId(req)
    AH->>AU: verify session/bearer/admin_cookie
    AU-->>AH: userId, isAdmin
    AH->>AU: UPDATE last_active_at (throttled)
    AH-->>NX: {userId, isAdmin}
    
    NX->>PY: proxy to ${PYTHON_BACKEND}/api/portfolio/holdings<br/>?XTransformPort=8010
    PY->>PR: route to FastAPI sub-router
    
    PR->>AU: SELECT portfolio_items WHERE user_id=?
    AU-->>PR: [{symbol, shares, purchase_price}]
    
    loop For each holding
        PR->>ST: SELECT current_price, sector, beta
        ST-->>PR: live price + metadata
        
        PR->>DE: SELECT fundamentals (tab_balance_sheets, tab_income_statements)
        DE-->>PR: P/E, P/B, ROE, debt ratio
        
        PR->>PD: SELECT latest prediction (signal, target, stop)
        PD-->>PR: BUY/SELL recommendation
        
        PR->>PR: compute P&L, equity, sector exposure
        PR->>BHR: check FALLING_KNIFE
        alt Stock down > 15% in 5 days
            BHR-->>PR: {action: LIQUIDATE, reason: FALLING_KNIFE}
        else Stock down 5-15% but fundamentals OK
            BHR-->>PR: {action: HOLD_COOLDOWN, TP1: +6.5%}
        end
        
        PR->>SM: check concentration risk
        alt Single position > 25% of equity
            SM-->>PR: {alert: OVER_CONCENTRATED}
        end
    end
    
    PR->>PR: aggregate: equity_curve, sector_breakdown, risk_summary
    PR-->>PY: JSON response
    PY-->>NX: 200 OK
    NX-->>U: portfolio dashboard data
```

---

## 15. طبقة الذكاء الاصطناعي (Ollama + RAG)

### 15.1 — المعمارية

```mermaid
flowchart TB
    subgraph "Local AI Stack"
        OL[Ollama Service<br/>:11434]
        M1[Model: qwen2.5:1.5b<br/>base]
        M2[Model: glm-fast:latest<br/>custom Modelfile]
        
        OL --> M1
        OL --> M2
    end
    
    subgraph "AI Layer (12 files)"
        GFA[glm_finance_agent.py<br/>228 LOC<br/>THE Ollama client]
        DE[decision_engine.py<br/>299 LOC<br/>RAG - find_similar_stories]
        NA[nightly_analysis.py<br/>389 LOC<br/>02:00 Cairo cron]
        LAI[live_ai_monitor.py<br/>604 LOC<br/>every 15min during session]
        HSD[hot_stocks_detector.py<br/>748 LOC]
        MNR[market_news_reader.py<br/>174 LOC]
        NAG[news_agent.py<br/>388 LOC<br/>DuckDuckGo + trafilatura]
        TR[trade_recorder.py<br/>1464 LOC]
        HTG[historical_trade_generator.py<br/>746 LOC]
        TSI[telegram_signal_importer.py<br/>818 LOC]
        PR2[portfolio_routes.py<br/>FastAPI sub-router]
    end
    
    subgraph "Anti-Hallucination"
        SP[SYSTEM_PROMPT<br/>forbids number fabrication]
        RG[RAG: stock_stories table]
        FN[Smart Fallback<br/>if Ollama down]
    end
    
    GFA -->|POST /api/generate| OL
    GFA --> SP
    DE --> RG
    NA --> GFA
    LAI --> GFA
    HSD --> LAI
    
    RG -->|find_similar_stories| DE
    DE -->|augment prompt| GFA
```

### 15.2 — الـ Prompt الإنشائي (Anti-Hallucination)

```python
# ai/glm_finance_agent.py
SYSTEM_PROMPT = """
You are GLM Finance Agent.
You receive structured market data and must:
1. NEVER fabricate numbers. If a metric is missing, say "غير متوفر".
2. Always ground your analysis in the provided indicators.
3. If uncertain, output "PROBABILITY_LOW" instead of guessing.
4. Output in Arabic, structured JSON format.
5. Reference similar past patterns from stock_stories (RAG).
6. Maximum 3 sentences per reasoning point.

You may use these patterns:
- Stage 2 breakout → 65% historical hit rate
- VCP after Stage 1 → 71% hit rate
- SMC Order Block + volume surge → 68% hit rate

Forbidden phrases:
- "I think" / "ربما" / "قد"
- Specific prices not in input
- Future dates with certainty
"""
```

### 15.3 — أين يدخل الـ AI فعلياً في القرار؟

```mermaid
flowchart LR
    subgraph "Layer 1: Data"
        D[stocks.db + price_history + news]
    end
    
    subgraph "Layer 2: Rule-based Engines"
        R1[master_analyzer]
        R2[confluence_scorer]
        R3[market_regime]
        R4[persona_fit]
    end
    
    subgraph "Layer 3: AI Augmentation"
        A1[Ollama LLM<br/>narrative generation]
        A2[RAG<br/>similar stories]
        A3[Live AI Monitor<br/>15min hot stocks]
    end
    
    subgraph "Layer 4: Final Score"
        F[confluence_score =<br/>maestro × 0.6 + ai × 0.4]
    end
    
    D --> R1 & R2 & R3 & R4
    D --> A2
    A2 --> A1
    R1 --> F
    A1 --> F
```

> **ملاحظة مهمة:** الـ AI **لا يتخذ القرار النهائي وحده**. هو يساهم بـ 40% فقط في الـ Confluence Score. الـ 60% الأخرى من المحركات الـ rule-based.

---

## 16. التحديث اللحظي (WebSocket)

### 16.1 — معمارية مزدوجة القناة

```mermaid
flowchart LR
    subgraph "Channel 1: Push (instant)"
        DE[data_engine sync.py] -->|POST /broadcast| WS[WS :3005]
        WS -->|socket.emit market:snapshot| FE[Frontend]
    end
    
    subgraph "Channel 2: Poll (backup)"
        WS -->|poll /api/stocks every 2s<br/>during session| PY[Python :8010]
        WS -->|poll /api/live/analysis every 30s| PY
        PY -->|JSON| WS
        WS -->|emit ticker:update| FE
    end
    
    subgraph "Channel 3: Telegram Events"
        TE[TE :3003] -->|poll /api/telegram/events every 2s| PY
        PY -->|events| TE
        TE -->|emit telegram:event| AdminTab[Admin TelegramTab]
    end
```

### 16.2 — أحداث socket.io

| Event | الاتجاه | التردد | البيانات |
|---|---|---|---|
| `market:snapshot` | WS → FE | عند كل sync | {EGX30, EGX100, top_movers} |
| `market:status` | WS → FE | كل 30s | {session: open/closed, next_event} |
| `ticker:update` | WS → FE | كل 2s | {ticker, price, change_pct, volume} |
| `stock:alert` | WS → FE | عند trigger | {ticker, alert_type, message} |
| `telegram:event` | TE → Admin | كل 2s | {message_id, channel, text} |

### 16.3 — قاعدة Caddy للـ WebSocket

```
# Caddyfile
?XTransformPort=3005 → localhost:3005  (socket.io)
?XTransformPort=3003 → localhost:3003  (socket.io)
?XTransformPort=8010 → localhost:8010  (Python API)
default             → localhost:3000  (Next.js)
```

⚠️ **في الكود الأمامي:** دائماً استخدم `io("/?XTransformPort=3005")` — **لا** `io("http://localhost:3005")`.

---

## 17. جدول القرارات (Decision Tables)

### 17.1 — Decision Tree الرئيسي

```mermaid
flowchart TD
    Start([طلب تحليل سهم]) --> L1{Liquidity OK?}
    L1 -->|No| REJECT[AVOID - illiquid]
    L1 -->|Yes| L2{Stage?}
    
    L2 -->|Stage 4| VETO[STRONG_AVOID HARD VETO]
    L2 -->|Stage 1| WAIT[NEUTRAL - wait]
    L2 -->|Stage 3| AVOID[AVOID - distribution]
    L2 -->|Stage 2| L3{Regime?}
    
    L3 -->|DEFENSIVE| L3a{Score ≥ 70?}
    L3 -->|NORMAL| L3b{Score ≥ 65?}
    L3 -->|AGGRESSIVE| L3c{Score ≥ 55?}
    
    L3a -->|Yes| L4
    L3a -->|No| NEUTRAL1[NEUTRAL]
    L3b -->|Yes| L4
    L3b -->|No| NEUTRAL2[NEUTRAL]
    L3c -->|Yes| L4
    L3c -->|No| NEUTRAL3[NEUTRAL]
    
    L4{News sentiment?} -->|<-0.6| NEWS_AVOID[AVOID 24h]
    L4{News sentiment?} -->|>=-0.6| L5{Ticker in cooldown?}
    
    L5 -->|Yes| SKIP[SKIP - 7d freeze]
    L5 -->|No| L6{Earnings within 3d?}
    
    L6 -->|Yes| EARN_NEUTRAL[NEUTRAL - earnings blackout]
    L6 -->|No| L7{Final score?}
    
    L7 -->|≥ 78| SB[STRONG_BUY]
    L7 -->|65-77| BUY[BUY]
    L7 -->|55-64| ACC[ACCUMULATE]
    L7 -->|< 55| AVOID_F[AVOID]
```

### 17.2 — Position Sizing Decision Table

| Regime | Score | Beta | Position Size | Stop Type |
|---|---|---|---|---|
| DEFENSIVE | 65-77 | < 1.0 | 5% of equity | ATR × 2.0 |
| DEFENSIVE | 65-77 | 1.0-1.5 | 3% of equity | ATR × 2.5 |
| DEFENSIVE | 65-77 | > 1.5 | SKIP | — |
| DEFENSIVE | ≥ 78 | < 1.0 | 7.5% of equity | ATR × 1.5 |
| DEFENSIVE | ≥ 78 | 1.0-1.5 | 5% of equity | ATR × 2.0 |
| DEFENSIVE | ≥ 78 | > 1.5 | 3% of equity | ATR × 2.5 |
| NORMAL | 65-77 | any | 7.5% of equity | ATR × 1.5 |
| NORMAL | ≥ 78 | any | 10% of equity | ATR × 1.5 |
| AGGRESSIVE | 55-64 | any | 7.5% of equity | ATR × 1.5 |
| AGGRESSIVE | 65-77 | any | 12.5% of equity | ATR × 1.2 |
| AGGRESSIVE | ≥ 78 | any | 15% MAX | ATR × 1.0 |

### 17.3 — Exit Strategy Decision Table

| Condition | Action | Exit Type |
|---|---|---|
| price ≥ TP3 | SELL 100% | TARGET_HIT |
| TP2 ≤ price < TP3 | SELL ⅓ + move stop to TP2 | UPDATE_TRAILING |
| TP1 ≤ price < TP2 | SELL ⅓ + move stop to BE | SELL_TIER_1 |
| price ≤ stop | SELL 100% | STOP_LOSS |
| price ≤ entry × 0.95 (5% loss) | SELL 100% (2% rule) | RISK_LIMIT |
| Day 20 reached | SELL 100% | TIME_EXIT |
| Trailing stop hit (after TP1) | SELL remaining | TRAILING_EXIT |
| FALLING_KNIFE detected | SELL 100% immediately | EMERGENCY_EXIT |
| Earnings within 1 day | SELL 50% (reduce risk) | PRE_EARNINGS_TRIM |

---

## 18. قائمة الـ Endpoints الكاملة (493)

### توزيع حسب الـ Method

| Method | Count |
|---|---|
| GET | 288 |
| POST | 198 |
| PUT | 1 |
| DELETE | 2 |
| **Total** | **493** |

### أهم الـ Endpoints حسب الفئة

#### تحليل وتوصيات
| Endpoint | Engine |
|---|---|
| `GET /api/analysis/<ticker>` | master_analyzer |
| `GET /api/predict/<ticker>` | master_analyzer |
| `GET /api/predictions/generate-all` | daily_predictor |
| `GET /api/predictions/daily-picks` | picks_management |
| `GET /api/confluence/analyze/<ticker>` | confluence_engine_v3 |
| `POST /api/confluence/generate-predictions` | confluence_engine_v3 |

#### تتبع التوقعات
| Endpoint | Engine |
|---|---|
| `GET /api/predictions/tracking/*` (10 endpoints) | prediction_tracker |
| `GET /api/predictions/active-management` | position_manager |

#### الـ AI
| Endpoint | Engine |
|---|---|
| `GET /api/ai/live/scan` | live_ai_monitor |
| `GET /api/ai/live/signals` | live_ai_monitor |
| `GET /api/ai/hot-stocks` | hot_stocks_detector |
| `POST /api/ai/trades/record` | trade_recorder |
| `GET /api/ai/historical/generate` | historical_trade_generator |
| `POST /api/ai/telegram/import` | telegram_signal_importer |
| `GET /api/ai/premium/predictions` | confluence (maestro×0.6 + ai×0.4) |

#### Risk Management (22 endpoints)
| Endpoint | Engine |
|---|---|
| `/api/risk/position-size` | risk_management_advanced |
| `/api/risk/stop-loss` | risk_management_advanced |
| `/api/risk/trailing` | risk_management_advanced |
| `/api/risk/portfolio-concentration` | risk_management_advanced |
| + 18 more | risk_management_advanced |

#### Admin (87 endpoints)
| Endpoint | Engine |
|---|---|
| `POST /api/admin/trigger-analysis` | master_analyzer |
| `POST /api/admin/run-daily-analysis` | daily_predictor |
| `POST /api/admin/historical-backfill/run` | historical_backfill_engine |
| `POST /api/admin/iterative-learning/run` | unified_learning_engine |
| `GET /api/admin/engine-settings` | engine_settings |
| + 82 more | various |

#### Market Data
| Endpoint | Engine |
|---|---|
| `GET /api/market/intraday-pressure` | market_master |
| `GET /api/market/investor-flows` | market_master |
| `GET /api/market/liquidity-radar` | market_master |
| `GET /api/market/top-movers` | market_master |
| `GET /api/regime/market` | market_regime_engine |
| `GET /api/regime/stock/<ticker>` | market_regime_engine |

#### Scanner
| Endpoint | Engine |
|---|---|
| `GET /api/scanner/quick` | screener |
| `GET /api/explosive/scan` | explosive_scanner |
| `GET /api/explosive/top` | explosive_scanner |
| `GET /api/flow/heatmap` | flow_system |
| `GET /api/flow/top` | flow_system |

#### Crypto
| Endpoint | Engine |
|---|---|
| `GET /api/crypto/<coin_id>/history` | crypto_engine |
| `GET /api/crypto/analyze/<coin_id>` | crypto_engine |
| `GET /api/crypto/flow/<symbol>` | crypto_engine |
| `GET /api/crypto/live` | crypto_engine |

#### Backtest & Learning
| Endpoint | Engine |
|---|---|
| `GET /api/v38-backtest/*` (6 endpoints) | backtest_engine |
| `GET /api/unified-learning/*` (16 endpoints) | unified_learning_engine |
| `GET /api/learning/*` (5 endpoints) | learning_routes |
| `GET /api/prediction-optimizer/*` (4 endpoints) | prediction_optimizer |

---

## 19. الجدول الزمني للـ Cron Jobs

```mermaid
gantt
    title الجدول الزمني للـ Cron Jobs (Cairo Time)
    dateFormat HH:mm
    axisFormat %H:%M
    
    section Pre-Market
    News Agent Polling        :active, news, 06:00, 14h
    
    section Market Hours (10-14:30)
    MarketScheduler tick (60s) :active, ms, 10:00, 4h
    Intraday Scanner (5min)    :active, is, 10:00, 4h
    Live AI Monitor (15min)    :active, lai, 10:00, 4h
    WS Hyper Polling (2s)     :active, ws, 10:00, 4h
    Crypto Lab (5min 24/7)     :active, cl, 00:00, 24h
    
    section Post-Market
    Daily Predictor (14:30)    :crit, dp, 14:30, 30m
    Daily Closer (14:35)       :crit, dc, 14:35, 1h
    Intraday Aggregator (15:00) :ia, 15:00, 30m
    Price History Safetynet    :phs, 15:00, 30m
    
    section Nightly
    Nightly Quant Cache (03:00) :crit, nq, 03:00, 1h
    Daily Portfolio Yield (03:00) :dpy, 03:00, 15m
    Nightly AI Analysis (02:00) :naa, 02:00, 1h
    
    section Hourly
    WAL Checkpoint             :active, wal, 00:00, 24h
    Price History Stale Monitor :phm, 00:00, 24h
```

### جدول تفصيلي

| Job | Schedule (Cairo) | Duration | Output |
|---|---|---|---|
| MarketScheduler.tick() | every 60s, 10:00-14:30 | 60s | updates intraday |
| Intraday Scanner | every 5min, 10:00-14:30 | 30s | writes intraday.db |
| Live AI Monitor | every 15min, 10:00-14:30 | 2min | writes live_ai_signals |
| WS Hyper Polling | every 2s, 24/7 | instant | pushes to frontend |
| Crypto Lab Scheduler | every 5min, 24/7 | 1min | writes crypto_predictions_log |
| Daily Predictor | 14:30 post-close | 30min | writes predictions.db.predictions |
| Daily Closer | 14:35 post-close | 1h | updates outcomes |
| Intraday Aggregator | 15:00 | 30min | aggregates to price_history |
| Price History Safetynet | 15:00 | 30min | Yahoo fallback |
| Nightly Quant Cache | 03:00 | 1h | writes quant_cache |
| Nightly AI Analysis | 02:00 | 1h | updates stored_analyses ai_* columns |
| Daily Portfolio Yield | 03:00 | 15min | writes wealth_tracking |
| WAL Checkpoint | hourly | 5s | PRAGMA wal_checkpoint(TRUNCATE) |
| Price History Stale Monitor | hourly | 5s | alerts if frozen |

---

## 20. معجم المصطلحات

| Term | المعنى |
|---|---|
| **ADX** | Average Directional Index — قوة الترند (≥25 = قوي) |
| **ATR** | Average True Range — تقلب السعر (Wilder) |
| **BOS** | Break of Structure — SMC اصطلاح لكسر هيكلية السعر |
| **Confluence** | التقاء عدة أدلة فنية في نفس الاتجاه |
| **FVG** | Fair Value Gap — فجوة قيمة عادلة (SMC) |
| **Golden Cross** | تقاطع 50SMA فوق 200SMA (إشارة صعود) |
| **HMM** | Hidden Markov Model — نموذج ماركوف المخفي |
| **Liquidity Sweep** | SMC اصطلاح لجمع السيولة قبل الانعكاس |
| **MFI** | Money Flow Index — مؤشر تدفق الأموال |
| **OB** | Order Block — كتلة طلبات مؤسسية (SMC) |
| **POC** | Point of Control — أعلى مستوى حجمي |
| **R:R** | Risk:Reward ratio |
| **R-multiple** | Van Tharp — الربح مقسوماً على المخاطرة |
| **Regime** | حالة السوق (DEFENSIVE/NORMAL/AGGRESSIVE) |
| **SEPA** | Specific Entry Point Analysis (Minervini) |
| **SMA** | Simple Moving Average |
| **SMC** | Smart Money Concepts |
| **Stage 1-4** | Minervini trend stages |
| **TP1/TP2/TP3** | Take Profit tiers (Douglas) |
| **VCP** | Volatility Contraction Pattern (Minervini) |
| **VWAP** | Volume Weighted Average Price |
| **WAL** | Write-Ahead Logging (SQLite) |
| **Walk-Forward** | backtest method — train on past, test on next |

---

## خاتمة

هذا النظام ليس "نظام تداول آلي" بالمعنى التقليدي. هو **مساعد قرار هجين** يجمع بين:

1. **القواعد الهندسية** (110 محرك) — مبنية على نظريات Minervini, Wilder, Covel, Douglas, Lynch
2. **الإحصاء** (Bayesian + HMM + Monte Carlo) — لتعديل الأوزان ديناميكياً
3. **الـ LLM المحلي** (Ollama + glm-fast) — للتفسير والسياق
4. **حلقة التعلم الذاتي** (8,544 outcomes + 19,983 lessons) — تحسّن نفسها يومياً

**الفلسفة الجوهرية:** لا يوجد مؤشر واحد كافٍ. القرار الصحيح يحتاج التقاء (Confluence) عدة أدلة + سياق السوق الكلي + ملاءمة شخصية المستثمر + تعلّم من الأخطاء السابقة.

---

> **المراجع:**
> - `Documentation/03-HOW-IT-THINKS.md` (الإصدار السابق، 444 LOC)
> - `Documentation/04-ENGINES-ARCHITECTURE.md`
> - `Documentation/ENGINES-MASTER-REFERENCE.md`

---

## 21. تحديث رادار السيولة — Forensic Fixes (2026-10-25)

> **مهم:** هذا القسم يوثّق إصلاحات تمت على فرع `fix/radar-closure-final` (commit `b253243`). **لم تُدمج إلى main بعد** — بانتظار موافقة المالك. النص أدناه يعكس الحالة الحقيقية للنظام بعد الإصلاح.

### 21.1 — مشكلة عزل السوق (Market Contamination)

**السبب الجذرى المُثبت:**
- `stock_daily_prices.market TEXT DEFAULT 'US'` — الـ schema default خاطئ (يجب `'EGX'`)
- `eodhd_fetcher.py:195` + `daily_price_updater.py:165` — INSERT بدون `market` column → DEFAULT 'US' يطبّق
- `UNIQUE(ticker, price_date)` — `market` ليس جزء من المفتاح → same-ticker-different-market يصطدم
- 427 من 461 EGX ticker (93%) اتلوّثوا يوم **2026-10-08** (single batch event)

**الإصلاح المُنفّذ (C2 — Market Isolation):**
أضيف `market_filter='EGX'` لكل استعلامات الأسعار:
- `scripts/verify_radar_signals.py` — `_fetch_n_sessions_from_sources(market_filter='EGX')`
- `scripts/radar_accuracy_report.py` — `AND market='EGX'` فى `build_price_index`
- `src/app/api/maker-radar/signal-tracker/verify/route.ts` — `marketClause` فى `fetchPricesAfter`
- `scripts/generate_unified_audit.py` — filter عبر `fetch_nth_session_unified_or_ph`

**الـ schema migration (مقترح، غير منفّذ):**
```sql
-- مقترح: DEFAULT 'US' → DEFAULT 'EGX'
-- مقترح: UNIQUE(ticker, price_date) → UNIQUE(ticker, price_date, market)
```

### 21.2 — عدّ جلسات التداول (F1-v2)

**المشكلة:** `verify_radar_signals.py` كان بيحسب `signal_date + timedelta(days=7)` (calendar days) — ده بياخد أول سعر بعد 7 أيام تقويمية، مش الجلسة السابعة الفعلية. عطلات الجمعة+السبت بتتخطى، فالنتيجة بتكون الجلسة 5 أو 6 مش 7.

**الإصلاح:** `_fetch_n_sessions_from_sources()` بتجلب أول N صف `ORDER BY date ASC LIMIT N` — ده بيطابق الـ TS route `prices[N-1]` تماماً. العطلات والويكاند بتتخطى تلقائياً.

### 21.3 — طفرة السيولة (F3-v2)

**المشكلة:** `has_volume_surge()` كان بيستخدم `volumes[-20:]` كـ baseline — ده بيتداخل مع `recent_vol = volumes[-5:]`، فآخر 5 جلسات بتحسب فى البسط والمقام → نسبة منحازة.

**الإصلاح:** `volumes[-(surge_lookback + base_lookback):-surge_lookback]` = `volumes[-25:-5]` (غير متداخل). **لا fallback** — لو <25 جلسة، الرفض واضح بدل استخدام baseline متداخل.

### 21.4 — حالة `stale_data`

**الـ writers:**
- `maker_radar.py:806` — `initial_status = 'stale_data' if staleness_days > 3` (عند INSERT)
- `backfill_stale_radar_signals.py:179` — UPDATE retroactive لو age > 7 أيام

**الـ outcome_7d للـ stale signals:**
- 259 من 432 stale_data signals ليها `outcome_7d` SET
- دى كتبها `radar_accuracy_report.py --write` (بيعالج ALL signals، `WHERE signal_date >= cutoff`)
- `verified_at = NULL` لأن `verify_radar_signals.py` بيتعامل مع `status='pending'` فقط

**السياسة (3 خيارات للمالك):**
- Option A: استبعاد stale_data من إحصائيات الدقة
- Option B: فئة منفصلة (توصية برافو)
- Option C: إعادة حساب + تضمين

### 21.5 — فجوات جلسات EGX

| التاريخ | الحالة | السبب |
|---|---|---|
| 2026-10-06 (Tue) | ✅ عطلة مؤكدة | Armed Forces Day — EGX مغلقة |
| 2026-10-15 (Thu) | ⚠️ غير محسوم | كل 461 ticker غايبين، لا إفصاح موثّق |
| 2026-10-17 (Sat) | ⚠️ غير محسوم | صف موجود بـ `market='EGX'` فى `historical_data` — يوم سبت |

### 21.6 — الإجراءات الرأسمالية

| Ticker | الحدث | المعامل | الحالة |
|---|---|---|---|
| POUL | اندماج + زيادة رأس مال (Sep 28) | 0.2542 (close-to-close) | 🟡 غير محسوم (6.27% خطأ vs reference 10.36) |
| ORHD | أسهم مجانية 2328:721 (Oct 7) | 0.30967 | ✅ مؤكد (0.09% خطأ) |
| MENA | لا إجراء (data glitch) | N/A | ⚠️ بيانات فاسدة (127→6.68 revert) |

### 21.7 — الأرقام بعد الإصلاح

| Metric | Stored (قبل) | Post-fix (بعد C2) |
|---|---|---|
| Total signals | 1,329 | 1,329 |
| Compared | 438 | 438 |
| Win Rate | 42.7% | **28.3%** |
| Changed (>0.5% diff) | — | 343 (78%) |

**ملاحظة:** 28.3% نتيجة وسيطة، مش نهائية. تحتاج حل A3 (schema) + A4 (stale policy) + A5 (session gaps) قبل الاعتماد النهائى.

### 21.8 — ملفات الأدلة

| الملف | السجلات |
|---|---|
| `tool-results/MARKET_CONTAMINATION_AUDIT.csv` | 1,103 tickers |
| `tool-results/EGX_SESSION_GAPS.csv` | 1,822 gap records |
| `tool-results/STALE_SIGNAL_OUTCOMES.csv` | 432 signals |
| `tool-results/audit_signal_fate.csv` | 1,329 rows (per-signal) |
| `Documentation/BRAVO-RADAR-CLOSURE-01.md` | تقرير الإغلاق الكامل |

### 21.9 — حالة الاعتماد

- ✅ السبب الجذرى مُثبت
- ✅ الإصلاح (C2) مُنفّذ + مُختبَر (37/37 PASS)
- ❌ Schema migration — بانتظار موافقة المالك
- ❌ Writer fixes — بانتظار موافقة المالك
- ❌ Data cleanup — بانتظار موافقة المالك
- ❌ Merge لـ main — بانتظار موافقة المالك
> - `Documentation/01-ARCHITECTURE.md`
> - `Documentation/00-CONSTITUTION.md`
> - الكود المصدري في `/home/z/my-project/vps-service/`

*هذه الوثيقة هي المرجع المعماري الكامل النهائي للنظام.*
