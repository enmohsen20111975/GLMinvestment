# 📋 INDEX — خريطة المشروع الحالية (2026-10-19)

> **آخر تحديث:** 2026-10-19 (بعد التنظيف)
> **الـ goal:** خريطة واضحة لكل حاجة موجودة + إيه اللي شغال + إيه اللي في garage

---

## 🎯 الـ Canonical Systems (الـ شغّالة)

### 1. V40.2 Prediction Engine (الـ brain)
- **الملف:** `vps-service/jobs/daily_predictor.py`
- **الـ role:** الـ prediction generator الوحيد (Rule 35)
- **الـ features:**
  - Kill Filters (liquidity + free float + volatility)
  - partial_exit + trailing_stop
  - evaluate_risk() gate (R/R ≥ 1.8)
  - SMC + Volume Profile integration
  - Expert Memory V40.2 veto
  - Wyckoff State Machine (no leakage)
- **الـ backtest:** `v38_backtest_engine.py` + `v40_2_daily_generator.py`

### 2. V40.4 Multi-Market (6 markets)
- **الـ files:** `vps-service/engines/v38_backtest_engine.py` + `unified_config.py`
- **الـ markets:** EGX / KSA / KSE / QSE / DFM / CRYPTO
- **الـ features:** MarketProfile + ATR clamping + dynamic R:R floor

### 3. PILLARS Scoring System
- **الـ files:** `opportunity_quality.py` + `engine_settings.py` + `v38_backtest_engine.py`
- **PILLAR-1:** sector_change wiring
- **PILLAR-3:** ATR_STOP_MAX_PCT = 9.0 (settings-driven)
- **PILLAR-4:** accept BUY signal (was WAIT)

### 4. evaluate_risk() (position sizing)
- **الـ file:** `vps-service/engine/flow_system.py`
- **الـ features:**
  - R/R ≥ 1.8 (Rule 18)
  - position ≤ 2.5% (Rule 19)
  - ATR stop [5%, 9%]
  - Falling Knife filter

### 5. BRAVO-RADAR (MFM-based)
- **الـ file:** `scripts/liquidity_radar_v2.py`
- **الـ features:**
  - MFM (Money Flow Multiplier)
  - MARKET_CONFIG لـ 7 أسواق
  - phase classification (8 levels)
  - radar_integration HARD GATE

### 6. Canonical Indicators Library
- **الـ path:** `vps-service/analyzers/indicators/`
- **الـ modules:** rsi.py + atr.py + ma.py + macd.py
- **الـ rule:** Rule 54 (SSOT)

---

## 🔬 الـ Diagnostics (اللي احتفظنا بيه من الليلة دي)

### 1. CPCV + Monte Carlo Framework
- **الـ file:** `scripts/cpcv_validation.py`
- **الـ role:** Combinatorial Purged Cross-Validation + Monte Carlo
- **الـ findings:**
  - كشف الـ Statistical Trap (Generalization Ratio = 1.47 كان وهمي)
  - كشف إن V38 + SMC + VP + Core = ضوضاء

### 2. Feature Importance Analysis
- **الـ file:** `scripts/feature_importance_analysis.py`
- **الـ role:** تحليل أي input بـ يـدي قيمة فعلية
- **الـ findings:**
  - كل الـ features (V38/VP/Core/SMC) عندها علاقة عكسية
  - كشف الـ 92 توقع fabricated (actual_return = 50.0)

### 3. Inversion Test
- **الـ file:** `scripts/inversion_test.py`
- **الـ role:** اختبار هل الـ signals معكوسة (Polarity issue)
- **الـ findings:**
  - مفيش Polarity issue
  - V38 + VP + Core = ضوضاء (original ≈ inverted)
  - SMC = الواعد الوحيد (بس sample صغير)

### 4. Wyckoff State Machine
- **الـ file:** `scripts/wyckoff_state_machine.py`
- **الـ role:** آلة حالة وايكوف بـ Volume Profile (no leakage)
- **الـ features:**
  - 10 states واضحة
  - Volume Profile لتحديد الـ ranges
  - pattern-specific thresholds

### 5. Mean Reversion Analysis
- **الـ file:** `scripts/mean_reversion_analysis.py`
- **الـ role:** تحليل Mean Reversion في EGX
- **الـ findings:**
  - **WR p-value = 0.0%** → edge حقيقي!
  - الأسهم النازلة 10-15% في 3-5 أيام بـ ترتد (WR = 54-55%)
  - Regime filter (Bull+Range) بيـحسن الأداء

### 6. Dynamic Scoring Research
- **الـ file:** `scratch/research/DYNAMIC_SCORING_RESEARCH.md`
- **الـ role:** research على 28 مصدر (papers + books)
- **الـ content:** 10 patterns + adaptive weights + EGX calibration

---

## 🗑️ archive/garage/ (الـ duplicates — مـشـ شغّالة)

### الـ duplicate scripts (9 files):
| الـ script | الـ reason |
|-----------|-----------|
| `backtest_hybrid_weights.py` | duplicate لـ V40 scoring |
| `backtest_radar_aware.py` | duplicate لـ V40 + radar |
| `backtest_dynamic_patterns.py` | duplicate لـ V40 patterns |
| `backtest_wyckoff_v2.py` | duplicate لـ V40 + wyckoff |
| `no_v38_validation.py` | duplicate diagnostic |
| `regime_based_validation.py` | duplicate diagnostic |
| `smc_only_validation.py` | duplicate لـ V40 backtest |
| `smc_deep_validation.py` | duplicate لـ V40 backtest |
| `mean_reversion_fixed_risk.py` | duplicate لـ evaluate_risk() |

### الـ duplicate research (1 file):
| الـ file | الـ reason |
|---------|-----------|
| `adaptive_scoring_engine.py` | duplicate لـ V40 engine |

---

## 📊 الـ Data Layer (الـ DBs)

### Canonical DBs:
| الـ DB | الـ role | الـ size |
|--------|---------|---------|
| `db/price_history.db` | canonical price history (1.3M rows, 26 سنة) | 352MB |
| `db/data_engine.db` | egksco + metals + crypto + fundamentals | 482MB |
| `db/stocks.db` | stocks metadata + daily_prices + screener | 29MB |
| `db/predictions.db` | predictions + learning + outcomes | 281MB |
| `db/auth.db` | users + subscriptions | 376KB |

### predictions.db Status (بعد التنظيف):
| الـ status | count |
|-----------|-------|
| INVALID_FABRICATED | 157 |
| INVALID_INST_BUY_KILLED | 28 |
| INVALID_MAKER_FUEL_PLACEHOLDER | 93 |
| INVALID_ZERO_PLACEHOLDER | 18 |
| **Total INVALID** | **296** |
| **clean closed** | **104** |
| **WR الحقيقي** | **29.81%** |

---

## 📚 الـ Documentation

| الـ file | الـ content |
|---------|-------------|
| `Documentation/00-CONSTITUTION.md` | الـ rules (1-75) |
| `Documentation/ENGINES-AND-TOOLS-MAP.md` | خريطة 46 أداة |
| `Documentation/DATA-SOURCES.md` | canonical DB spec |
| `Documentation/أعمال-فريق-برافو.md` | سجل برافو الكامل |
| `Documentation/الفريق/برافو.md` | شخصية برافو |

---

## 🎯 الـ Roadmap الجديد

### 1. نشغل V40 engine بـ simulate_trade مصحح
- الـ V40 فيه `partial_exit` + `trailing_stop` + `kill_filters`
- بس `simulate_trade` ما كانش بـ يستخدمهم!
- **ده اللي كان مفروض يـتـعمل من البداية**

### 2. نـختبر Mean Reversion كـ signal في V40 engine
- الـ Mean Reversion edge حقيقي (WR p-value = 0.0%)
- V40 engine بـ يدعم أي signal type
- نشتري الأسهم النازلة 10-15% بدل الصاعدة

### 3. نـستخدم evaluate_risk() للـ position sizing
- بدل ما نـعمل Fixed Risk جديد
- `evaluate_risk()` فيه Rule 18 + Rule 19

### 4. نـوقف بناء scripts جديدة من الصفر
- V40 engine موجود + شغال
- محتاج بس تـفعيل + testing

---

## 📋 الـ Lessons Learned

| الـ lesson | التفاصيل |
|-----------|----------|
| ❌ ما تـقرأش worklog.md كامل قبل ما تبدأ | ده = إعادة اختراع العجلة |
| ❌ ما تـبنـيش scripts جديدة لو فيه engine موجود | استخدم الـ existing |
| ✅ الـ diagnostics (CPCV + Inversion + Feature Importance) ليها قيمة | احتفظ بـ |
| ✅ الـ Mean Reversion edge حقيقي | وري V40 engine |
| ✅ الـ fabricated data كارثة | اتـنظفت (296 INVALID) |

---

**برافو — كل رقم مشتبه فيه حتى يثبت. بالدليل مش بالكلام.**
