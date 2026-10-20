# BRAVO Dead Code Inventory — خريطة الملفات النشطة والميتة

> **Task ID:** BRAVO-DEEP-AUDIT-1 / STAGE-0
> **Agent:** برافو (تنين الباك إند والكم)
> **التاريخ:** 2026-10-20
> **المرجعية:** `agent-ctx/BRAVO-FIXTURE-MAP.json` (البيانات الخام)

## المنهجية

- **AST parsing** لكل ملف `.py` في `vps-service/` + `scripts/` (711 ملف).
- **Grep fallback** للكشف عن `from X import` و `import X` patterns.
- **Dynamic imports**: 38 API route module بـ يسجلوا ديناميكياً في `lightweight_server.py::BLUEPRINTS` — أضيفوا كـ importers.
- **Cron/PM2 scripts**: 27 script path من `crontab.txt` + `ecosystem.config.js` — أضيفوا كـ alive (script mode).
- **git log** آخر تعديل لكل ملف.

## الملخص العام

| الفئة | العدد | النسبة |
|------|------:|------:|
| إجمالي ملفات `.py` | 711 | 100% |
| **Alive** (لها importers أو cron/dynamic) | 309 | 43% |
| **Dead candidates** (0 importers) | 402 | 56% |

## التوزيع حسب المجلد (Dead candidates)

| المجلد | Dead | ملاحظة |
|--------|----:|--------|
| `vps-service/scripts` | 98 | one-shot scripts (fix/patch/diagnose/verify) |
| `vps-service/tests` | 25 | tests قديمة/معطلة |
| `vps-service/glminvestment_engines` | 7 | **dead مؤكد** (0 imports خارج المجلد) |
| `vps-service/jobs` | 3 | jobs قديمة |
| `vps-service/telegram` | 1 | — |
| `scripts/` (جذر) | 6 | scripts مستقلة |

## أعلى 12 Dead candidate (حسب الحجم، باستثناء tests)

| الحجم | آخر تعديل | المسار |
|------:|----------|--------|
| 1,965 | 2026-10-20 | `vps-service/scripts/honest_backtest_regime.py` |
| 1,602 | 2026-10-20 | `vps-service/scripts/honest_backtest_trend.py` |
| 1,417 | 2026-10-20 | `vps-service/telegram/telegram_interactive_bot.py` |
| 1,394 | 2026-10-20 | `scripts/maker_radar.py` |
| 1,336 | 2026-10-20 | `vps-service/scripts/backtest_sniper.py` |
| 1,289 | 2026-10-20 | `scripts/weekly_radar_report.py` |
| 1,282 | 2026-10-20 | `vps-service/scripts/production_backtest_tf.py` |
| 1,099 | 2026-10-20 | `vps-service/scripts/egx_backtest/egx_sniper_backtest.py` |
| 1,095 | 2026-10-20 | `vps-service/scripts/honest_backtest_egx.py` |
|   911 | 2026-10-20 | `scripts/v4_daily_detector.py` |
|   898 | 2026-10-20 | `scripts/run_strength_confirmation_test.py` |
|   895 | 2026-10-20 | `scripts/hybrid_stage_analyzer.py` |

> **ملاحظة:** `last_modified = 2026-10-20` لكل الملفات لأنها تاريخ آخر commit في الـ shallow clone. لازم `git fetch --unshallow` لمعرفة التواريخ الحقيقية.

## أعلى 15 Alive (الأكثر استيراداً)

| Importers | الحجم | المسار |
|----------:|------:|--------|
| 138 | 74 | `vps-service/analyzers/__init__.py` |
| 98 | 12 | `vps-service/utils/__init__.py` |
| 70 | 20 | `vps-service/core/__init__.py` |
| 55 | 578 | `vps-service/api/stocks.py` |
| 44 | 14 | `vps-service/data/__init__.py` |
| 41 | 231 | `vps-service/glminvestment_engines/core/indicators.py` ⚠️ |
| 40 | 88 | `vps-service/utils/risk_reward.py` |
| 38 | 590 | `vps-service/data/prices.py` |
| 33 | 419 | `vps-service/telegram/database.py` |
| 32 | 1,223 | `vps-service/core/database.py` |
| 30 | 34 | `vps-service/analyzers/indicators/__init__.py` |
| 29 | 487 | `vps-service/core/db_manager.py` |
| 28 | 66 | `vps-service/analyzers/indicators/rsi.py` |
| 25 | 5,764 | `vps-service/analyzers/master_analyzer.py` |
| 25 | 1,482 | `vps-service/analyzers/engine_settings.py` |

> **⚠️ تنبيه:** `glminvestment_engines/core/indicators.py` ظهر كـ alive (41 importers) — بس ده **false positive**: الـ importers كلهم جوه `glminvestment_engines/` نفسها (self-reference). محتاج فحص يدوي في المرحلة 2.

## قاعدة التحقق (Rule 16 — VERIFY-BEFORE-DELETE)

أي ملف dead لازم يتـحقق منه ثلاثياً قبل الحذف/الأرشفة:
1. **استدعاءات الواجهة** — `grep` في `src/` عن `fetch('/api/...')`.
2. **تسجيل الـ blueprint** — موجود في `BLUEPRINTS` list في `lightweight_server.py`.
3. **سجل الأداء** — مرجعية في `worklog.md` أو نتائج backtest.

## الخطوة التالية

المرحلة 0 اكتملت. الانتقال للمرحلة 3 (CALCULATION-CANONICAL) — أعلى قيمة، أقل خطر.
