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
