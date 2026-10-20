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
