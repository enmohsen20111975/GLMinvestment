# 🔍 تقرير الفحص الشامل — مرحلة بمرحلة

**التاريخ**: 2026-10-20
**الفاحص**: Z.ai Code
**المنهج**: فحص كل مرحلة + تحديث الملف بعد كل مرحلة + البقاء على آخر تحديث من GitHub

---

## المرحلة 0 — fixture map (BRAVO-STAGE-0)

**الـ commit**: `7cf9998` + `a99da59`
**الملفات**: `agent-ctx/BRAVO-FIXTURE-MAP.json` (210KB) + `agent-ctx/BRAVO-DEAD-CODE-INVENTORY.md`

### الإحصائيات المعلنة:
- 711 ملف Python
- 402 dead (56.5%)
- 309 alive (43.5%)

### 🔴 مشكلة 1: maker_radar.py مصنف كـ dead (false positive خطير!)

**الملف**: `scripts/maker_radar.py` (1394 سطر)
**التصنيف**: `is_dead_candidate: true` (imported_by_count = 0)

**الحقيقة**: ده السكريبت الرئيسي للرادار! بيشتغل **كل 5 دقايق في cron**:
```
crontab.txt:201: */5 8-14 * * 0-4 ... python3 scripts/maker_radar.py --market EGX --json-only
crontab.txt:202: */5 8-14 * * 0-4 ... python3 scripts/maker_radar.py --market TADAWUL --json-only
```

**السبب**: الـ fixture map بـ count imports بس. maker_radar.py بيشتغل مستقل (مش بيـ import). برافو قال إنه عمل cron/PM2 detection بس واضح إنه **مش بيـ catch scripts/ folder** (بيـ catch vps-service/ بس).

### 🔴 مشكلة 2: 17 backfill script مصنفين كـ dead

```
DEAD: scripts/maker_radar.py ← FALSE POSITIVE (cron)
DEAD: vps-service/scripts/maestro_backfill_v2.py
DEAD: vps-service/scripts/backfill_with_personas.py
DEAD: scripts/backfill_yahoo_history.py
DEAD: vps-service/scripts/backfill_signal_memory.py
DEAD: vps-service/scripts/backfill_to_predictions.py
DEAD: vps-service/scripts/backfill_historical_predictions.py
DEAD: scripts/backfill_persona_classification.py
DEAD: vps-service/scripts/v40_2_historical_backfill.py
DEAD: scripts/backfill_phase0.py
DEAD: scripts/backfill_stale_radar_signals.py
DEAD: scripts/backfill_maestro_history.py
DEAD: scripts/backfill_price_history_gap.py
DEAD: scripts/backfill_history.py
DEAD: vps-service/scripts/backfill_confidence.py
DEAD: vps-service/scripts/backfill_intraday.py
DEAD: scripts/backfill_exit_type.py
```

**المشكلة**: backfill scripts بتشتغل مستقلة (cron/manual) مش بيـ importوا. لو حد أرشفهم زي ما عمل مع backtest_sniper → كارثة.

### 🔴 مشكلة 3: fixture map structure ضعيف

```json
{
  "path": "scripts/maker_radar.py",
  "module": null,           ← مش بيـ detect module
  "lines": 1394,
  "imported_by_count": 0,   ← بس مش بيـ check cron!
  "imported_by": [],
  "last_modified": "2026-10-20",
  "is_dead_candidate": true  ← غلط!
}
```

**اللي ناقص**:
- `cron_references` — هل السكريبت في crontab؟
- `pm2_references` — هل في ecosystem.config.js؟
- `entry_point` — هل فيه `if __name__ == '__main__'`؟
- `cli_args` — هل بيقبل --json-only الخ؟

### ✅ اللي شغال صح:
- 711 ملف inventory كامل
- AST parsing للـ imports شغال
- imported_by tracking دقيق (402/402 dead ليهم 0 importers)

### 📊 التقدير: 60% دقيق

| | العدد | الحالة |
|---|------|--------|
| total files | 711 | ✅ |
| dead candidates | 402 | ⚠️ فيه false positives |
| confirmed dead (archived) | 11 | ✅ |
| **false positives (scripts/)** | **17+** | 🔴 |

### 🎯 التوصية:
- أضف cron/PM2 detection للـ scripts/ folder
- أضف `entry_point` detection (`if __name__ == '__main__'`)
- متأكدش إن أي script في scripts/ dead إلا لو اتـ verify cron + PM2 + manual runs

---

## المراحل التالية (هتتـ فحص لاحقاً):
- [ ] المرحلة 1 — Engine Unification
- [ ] المرحلة 2 — core Unification
- [ ] المرحلة 3 — CALCULATION-CANONICAL
- [ ] المرحلة 5 — API audit
- [ ] المرحلة 6 — scripts archive
- [ ] المرحلة 7 — Quant Canonical
- [ ] المرحلة 8 — Tests

---

*آخر تحديث: بعد فحص المرحلة 0*

---

## المرحلة 1 — Engine Unification (STAGE-1)

**الـ commit**: `675ac0b`
**الـ goal**: دمج 3 engine folders → `engines/` واحد

### ✅ اللي شغال صح:
1. **15 modules** في `engines/` (موحدة من 3 مجلدات)
2. **engine/__init__.py shim** شغال:
   - بيـ re-export 7 modules من `engines/`
   - بيـ log errors (مش silent pass) ✅
   - بيـ set `sys.modules` للـ backward compat
3. **15 caller** لـ `engine.` (legacy) — الـ shim بيـ catchهم كلهم:
   - `jobs/daily_predictor.py` (1)
   - `analyzers/background_analyzer.py` (1)
   - `analyzers/master_analyzer.py` (1)
   - `api/admin_routes.py` (12)
4. **كل engines modules بتـ import بنجاح** (15/15)

### ⚠️ مشكلة 1: glminvestment_engines shim — no error handling

```python
# glminvestment_engines/engines/__init__.py
from engines.atr_risk_engine import analyze as analyze_atr_risk, ...
from engines.stage2_filter import analyze as analyze_stage2, ...
```

**المشكلة**: مفيش `try/except`. لو `engines.atr_risk_engine` فشل → الـ shim هـ crash كله.

**التوصية**: ضيف try/except + logging زي engine shim.

### ⚠️ مشكلة 2: persona_engine self-referencing import

```python
# engines/persona_engine.py:9 (docstring)
from engine.persona_engine import PersonaEngine, InvestorPersona
```

**المشكلة**: الملف في `engines/` بيـ recommend import من `engine.` (الـ shim). ده self-referencing بس بيشتغل (مش circular) لأن الـ shim بـ redirect لـ `engines.` تاني.

**التوصية**: حدّث الـ docstring لـ `from engines.persona_engine import ...`

### 📊 التقدير: 90% سليم

| | الحالة |
|---|--------|
| engines/ موحدة | ✅ 15/15 |
| engine shim | ✅ شغال + logging |
| backward compat | ✅ 15 callers |
| glminvestment shim | ⚠️ no error handling |
| persona docstring | ⚠️ self-referencing |

---

## المراحل التالية:
- [x] المرحلة 0 — fixture map
- [x] المرحلة 1 — Engine Unification
- [ ] المرحلة 2 — core Unification
- [ ] المرحلة 3 — CALCULATION-CANONICAL
- [ ] المرحلة 5 — API audit
- [ ] المرحلة 6 — scripts archive
- [ ] المرحلة 7 — Quant Canonical
- [ ] المرحلة 8 — Tests

*آخر تحديث: بعد فحص المرحلة 1*

---

## المرحلة 2 — core Unification (STAGE-2)

**الـ commit**: `71f72b8`
**الـ goal**: حل naming collision في `telegram/database.py` → rename لـ `telegram/telegram_db.py`

### ✅ كل حاجة شغالة صح:

1. **telegram/database.py** بقى shim:
   ```python
   from telegram.telegram_db import *  # noqa
   from telegram.telegram_db import db_manager  # explicit
   ```

2. **telegram/telegram_db.py** هو الـ canonical:
   - `class DatabaseManager` (line 23)
   - `db_manager = DatabaseManager()` (line 419)

3. **caller اتحديث**: `api/telegram_routes.py:27` → `from telegram.telegram_db import db_manager`

4. **import test**: `db_manager is dm2 = True` (same object ✅)

5. **naming collision اتحل**: `core/database.py` ليه `DatabaseManager` مختلف (general DB) و `telegram/telegram_db.py` ليه `DatabaseManager` (telegram-specific)

### 📊 التقدير: 100% سليم

| | الحالة |
|---|--------|
| shim | ✅ شغال |
| canonical | ✅ telegram_db.py |
| caller | ✅ اتحديث |
| import test | ✅ same object |
| naming collision | ✅ اتحل |

---

## المراحل التالية:
- [x] المرحلة 0 — fixture map
- [x] المرحلة 1 — Engine Unification
- [x] المرحلة 2 — core Unification
- [ ] المرحلة 3 — CALCULATION-CANONICAL
- [ ] المرحلة 5 — API audit
- [ ] المرحلة 6 — scripts archive
- [ ] المرحلة 7 — Quant Canonical
- [ ] المرحلة 8 — Tests

*آخر تحديث: بعد فحص المرحلة 2*

---

## المرحلة 3 — CALCULATION-CANONICAL (STAGE-3a + 3b)

**الـ commits**: `e16f66b` (3a) + `3f1fb6a` (3b) + `c79417d` (FIX3)
**الـ goal**: canonical indicators + delegation + no fabrication

### ✅ اللي شغال صح:

1. **13 canonical functions** كلها موجودة:
   - calc_atr, calc_rsi, calc_srsi, calc_bollinger, calc_bollinger_series
   - calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile
   - sma, ema, macd

2. **delegation في 5 ملفات**:
   - engines/backtest_engine.py (11 canonical imports, **0 fabrication** ✅)
   - analyzers/enhanced_indicators.py (6 imports, 2 fabrication ⚠️)
   - analyzers/sniper_engine.py (8 imports, 4 fabrication ⚠️)
   - analyzers/core_scoring_engine.py (8 imports, 5 fabrication ⚠️)
   - analyzers/prediction_optimizer.py (4 imports, 3 fabrication ⚠️)

3. **regression test PASS** — 0 inline violations (بس بـ exclude backtest_engine)

### 🔴 مشكلة 1: 46 fabrication instance لسه موجودة

```
engines/backtest_engine.py:       0 fabrication ✅
analyzers/enhanced_indicators.py: 2 fabrication (Stochastic + Williams %R)
analyzers/sniper_engine.py:       4 fabrication
analyzers/core_scoring_engine.py: 5 fabrication
analyzers/prediction_optimizer.py: 3 fabrication
+ 22 ملف تاني بـ 32 instance
= 46 total
```

**أمثلة**:
```python
# enhanced_indicators.py:164 (Stochastic)
return 50.0, 50.0  # ← fabrication

# enhanced_indicators.py:231 (Williams %R)
return -50.0  # ← fabrication

# sniper_engine.py:962
return 50.0, 0.0, 0.0  # ← fabrication

# core_scoring_engine.py:60
return 0.0, 0.0, "neutral"  # ← fabrication
```

### 🔴 مشكلة 2: regression test بـ exclude files

```python
ALLOWED_INLINE_FILES = {
    "analyzers/indicators/rsi.py",  # ← صح (canonical source)
    ...
    # backtest_engine.py مش موجود في الـ list (اتشال) ✅
}
```

**بس** الـ test بـ check `def calc_*` patterns بس. مش بـ check fabrication patterns (`return 50.0`). فالـ "0 violations" مش بـ catch الـ 46 fabrication.

### 📊 التقدير: 70% سليم

| | الحالة |
|---|--------|
| 13 canonical functions | ✅ كلها موجودة |
| delegation | ✅ 5 ملفات |
| backtest_engine fabrication | ✅ 0 (اتصلح) |
| باقي الملفات fabrication | 🔴 46 instance |
| regression test | ⚠️ بـ check def patterns بس |

---

## المراحل التالية:
- [x] المرحلة 0 — fixture map
- [x] المرحلة 1 — Engine Unification
- [x] المرحلة 2 — core Unification
- [x] المرحلة 3 — CALCULATION-CANONICAL
- [ ] المرحلة 5 — API audit
- [ ] المرحلة 6 — scripts archive
- [ ] المرحلة 7 — Quant Canonical
- [ ] المرحلة 8 — Tests

*آخر تحديث: بعد فحص المرحلة 3*

---

## المرحلة 5 — API audit (STAGE-5)

**الـ commit**: توثيق في `agent-ctx/BRAVO-STAGE-5-API-AUDIT.md`
**الـ goal**: فحص الـ API duplicate pairs

### ✅ النتيجة: different concerns (مش duplicate)
- v2_routes vs unified_v2_routes: different prefixes + endpoints
- ai vs ai_predictions: different concerns
- screener × 3: different screening modes
- learning × 2: basic vs advanced

### 📊 التقدير: 100% (audit فقط، مفيش implementation)

---

## المرحلة 6 — scripts archive (STAGE-6a + 6b)

**الـ commits**: `1bec950` + `2e27867`
**الـ goal**: أرشفة dead scripts

### ✅ 22 script مؤرشف في `archive/old-scripts/`

### ⚠️ مشكلة: الـ archived scripts جت من fixture map (اللي فيه false positives)
- maker_radar.py مش مؤرشف (صح) ✅
- بس الـ 17 backfill script اللي لقيتها false positives — محتاج verify إنها مش مؤرشفه

### 📊 التقدير: 85% (محتاج verify الـ backfill scripts)

---

## المرحلة 7 — Quant Canonical (STAGE-7)

**الـ commit**: `9a593c1`
**الـ goal**: canonical fair_value + position_sizing

### ✅ اللي شغال:
1. **fair_value.py**: `calc_fundamental_fair_value` + `calc_upside_percent` + `calc_vwap_fair_value`
2. **position_sizing.py**: `calculate_risk_based_position` + `calculate_kelly_position`
3. **callers**:
   - `api/stocks.py:33` → fair_value ✅
   - `api/portfolio_routes.py:86` → position_sizing ✅

### ✅ الإصلاحات اللي اتعملت (من التقرير الثاني):
- kelly position_size بقى shares (مش value) ✅
- fair_value max اشتال ✅
- vwap_fair_value return 0.0 اشتال ✅

### 📊 التقدير: 95% سليم

---

## المرحلة 8 — Tests (STAGE-8)

**الـ commit**: `33b61a3`
**الـ goal**: integration test suite

### ✅ bravo tests (15 tests):
```
15 passed in 3.73s
```
- 13 test functions في test_bravo_unification.py (assert-based ✅)
- 2 test functions في test_canonical_compliance.py (pytest-compatible ✅)

### 🔴 مشكلة: 528 tests الإجمالية
```
24 failed, 444 passed, 43 skipped, 2 xfailed, 15 errors in 4.43s
```
- **24 failed + 15 errors = 39 مشكلة** (مش 31 pre-existing زي ما برافو قال)
- الفشل في: test_phase_g_critical_engines + test_regression_settings + test_settings_resolver + test_signal_quality

### 📊 التقدير: 84% pass rate (444/528)

---

## 📊 الملخص النهائي لكل المراحل

| المرحلة | التقدير | المشاكل |
|---------|--------|---------|
| 0 — fixture map | 60% | 3 (false positives + missing cron detection) |
| 1 — Engine Unification | 90% | 2 (glminvestment shim + persona docstring) |
| 2 — core Unification | 100% | 0 ✅ |
| 3 — CALCULATION-CANONICAL | 70% | 2 (46 fabrication + regression test blind) |
| 5 — API audit | 100% | 0 ✅ |
| 6 — scripts archive | 85% | 1 (backfill verify) |
| 7 — Quant Canonical | 95% | 0 ✅ |
| 8 — Tests | 84% | 1 (39 مشكلة مش 31) |

### الإجمالي: **80% سليم + 20% محتاج شغل**

### كل المشاكل المجمعة (للإرسال للفريق):
1. 🔴 fixture map: maker_radar.py + 17 backfill false positives
2. ⚠️ glminvestment shim: no error handling
3. ⚠️ persona_engine docstring: self-referencing
4. 🔴 46 fabrication instance في 22 ملف
5. ⚠️ regression test: بـ check def patterns بس (مش fabrication)
6. ⚠️ scripts archive: backfill scripts محتاجين verify
7. 🔴 24 failed + 15 errors في الـ 528 tests (مش 31 pre-existing)

*آخر تحديث: بعد فحص كل المراحل (0-8)*
