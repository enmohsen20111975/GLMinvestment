# 🐉 خطة التنظيف الشاملة — ألفا + برافو

> **من:** جون (المدير التنفيذي)
> **إلى:** المالك (محسن) + فريق ألفا + فريق برافو
> **التاريخ:** 2026-10-19
> **المبدأ:** **الشك المطلق** — كل ملف، كل تعديل، لازم يـ verify قبل ما يدخل. مفيش حاجة تتـ delete بدون دليل قاطع.
> **القاعدة الذهبية:** بعد كل مرحلة — `bun run lint` + `npx tsc --noEmit` + `py_compile` + browser verify. لو أي اختبار فشل → BLOCKED.

---

## 📊 الـ Inventory (الأساس)

| المكوّن | files | dead ❌ | dead lines | active ✅ |
|---------|-------|---------|------------|-----------|
| `src/` | 919 | 35 | 4,324 | 884 |
| `vps-service/` | 434 | 4 | 1,102 | 430 |
| `scripts/` | 315 | 107 | ~30,000 | 16 |
| **الإجمالي** | **1,668** | **146** | **~35,400** | **1,330** |

---

# 🅰️ خطة ألفا (Frontend — src/)

## المرحلة A1: أرشفة الـ dead UI components (15 ملف — 2,654 سطر)

### الملفات المطلوب أرشفتها:
```
src/components/ui/sidebar.tsx          (726 سطر — 0 importers)
src/components/ui/menubar.tsx          (276 سطر — 0 importers)
src/components/ui/context-menu.tsx     (252 سطر — 0 importers)
src/components/ui/carousel.tsx         (241 سطر — 0 importers)
src/components/ui/calendar.tsx         (213 سطر — 0 importers)
src/components/ui/command.tsx          (184 سطر — 0 importers)
src/components/ui/navigation-menu.tsx  (168 سطر — 0 importers)
src/components/ui/drawer.tsx           (135 سطر — 0 importers)
src/components/ui/pagination.tsx       (127 سطر — 0 importers)
src/components/ui/breadcrumb.tsx       (109 سطر — 0 importers)
src/components/ui/input-otp.tsx        (77 سطر — 0 importers)
src/components/ui/resizable.tsx        (56 سطر — 0 importers)
src/components/ui/hover-card.tsx       (44 سطر — 0 importers)
src/components/ui/toaster.tsx          (35 سطر — 0 importers)
src/components/ui/aspect-ratio.tsx     (11 سطر — 0 importers)
```

### الخطوات:
1. لكل ملف: `grep -rn "<filename>" src/ --include="*.ts" --include="*.tsx"` → تأكد 0 importers.
2. `git mv` لـ `archive/garage/ui/`.
3. حدّث `archive/garage/INDEX.md`.

### الاختبار الصارم:
- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors.
- الـ dev server بيـ compile بنجاح.
- مفيش أي شاشة بـ crash (كل الـ shadcn components دي مش مستخدمة).

---

## المرحلة A2: أرشفة الـ dead libs (4 ملف — 851 سطر)

### الملفات:
```
src/lib/design-tokens.ts       (157 سطر — 0 importers)
src/lib/notification-beep.ts   (98 سطر — 0 importers)
src/lib/sw-register.ts         (78 سطر — 0 importers)
src/lib/data-validator.ts      (516 سطر — 0 importers)
src/lib/new-db.ts              (488 سطر — 0 importers)
```

### الخطوات:
1. لكل ملف: `grep -rn "<filename>" src/ --include="*.ts" --include="*.tsx"` → تأكد 0 importers.
2. `git mv` لـ `archive/garage/libs/`.
3. حدّث INDEX.md.

### الاختبار الصارم:
- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors.

---

## المرحلة A3: أرشفة الـ dead barrel files (14 ملف)

### الملفات:
```
src/modules/*/index.ts (14 ملف — كلهم 0 importers)
```

### الخطوات:
1. لكل ملف: `grep -rn "from '@/modules/<name>'" src/` → تأكد 0 importers.
2. `git mv` لـ `archive/garage/barrels/`.

### الاختبار:
- `bun run lint` → 0 errors.
- الـ modules لـ شغّالة (بيـ import المكونات مباشرة).

---

## المرحلة A4: أرشفة الـ dead .preserved + .disabled (5 ملف)

### الملفات:
```
src/app/api/deal-advisor/[ticker]/route.ts.preserved  (1012 سطر)
news-agent/collectors/investing_news_collector.py.disabled
news-agent/collectors/rss_collector.py.disabled
news-agent/collectors/scrappers/investing_scraper.py.disabled
news-agent/_disabled_dbs/  (مجلد كامل)
```

### الخطوات:
1. `git rm` (مفيش لازمة للأرشفة — دي .preserved/.disabled أصلاً).
2. تأكد إن مفيش imports لهم.

### الاختبار:
- `bun run lint` → 0 errors.

---

## المرحلة A5: إحياء الـ dead libs المفيدة (refactor)

### المشكلة:
فيه libs موجودة بس dead (0 importers) بينما 150+ ملف بيعيد اختراع نفس الوظيفة:

| lib | lines | importers | بيعيد اختراعه كم ملف؟ |
|---|---|---|---|
| `src/lib/format.ts` | 123 | **0** | 54 ملف (formatPrice/formatPercent/formatNumber) |
| `src/lib/python-backend.ts` | 160 | **26** | 150 ملف (BACKEND_URL boilerplate) |
| `src/lib/db-predictions.ts` | 27 | **DEAD** | 7 routes (SELECT FROM predictions) |
| `src/lib/admin-auth-server.ts` | 225 | partial | 14 ملف (auth boilerplate) |

### الخطوات:
1. **`format.ts`**: استخرج `formatPrice`, `formatPercent`, `formatNumber` من الـ 22 ملف → استخدم `@/lib/format.ts`.
2. **`python-backend.ts`**: بدّل `const BACKEND_URL = process.env...` في 150 ملف → `import { PYTHON_BACKEND_URL } from '@/lib/python-backend'`.
3. **`db-predictions.ts`**: استخرج `SELECT FROM predictions` في 7 routes → استخدم helper.

### الاختبار الصارم:
- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors.
- **كل شاشة بـ تستخدم formatPrice/formatPercent بتـ render صح** (browser verify).
- **كل API route بـ يستخدم PYTHON_BACKEND_URL بيرجّع نفس النتيجة** (curl verify).

---

## المرحلة A6: توحيد المكونات المتكررة

### التكرارات المطلوب حلها:

| # | التكرار | file 1 | file 2 | التوصية |
|---|---|---|---|---|
| 1 | ShareButton | `components/share/ShareButton.tsx` (587 سطر، 5 importers) | `modules/publishing/components/ShareButton.tsx` (449 سطر، 2 importers) | دمج في publishing/ + حذف share/ |
| 2 | StockSelector | `modules/stock-analysis/components/StockSelector.tsx` | `components/shared/StockSearchSelector.tsx` | توحيد في StockSearchSelector |
| 3 | StockDetailDrawer | `components/shared/ui/StockDetailDrawer.tsx` (dead) | inline في MakerRadarTab | حذف dead + توثيق الفرق |

### الخطوات:
1. لكل حالة: اقرا الاتنين + افهم الفرق + قرر الـ canonical.
2. انقل الـ imports من الـ non-canonical لـ canonical.
3. احذف الـ non-canonical.
4. lint + tsc + browser verify.

### الاختبار الصارم:
- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors.
- **كل شاشة بـ تستخدم ShareButton بـ تعمل صح** (browser verify: publish + copy link).
- **كل شاشة بـ تستخدم StockSelector بـ تعمل صح** (browser verify: search + select).

---

## المرحلة A7: استخراج `safeNum()` + helpers مكررة

### المشكلة:
`safeNum()` مكرر في 10 ملفات. `formatPrice/formatPercent` مكرر في 22 ملف.

### الخطوات:
1. أضف `safeNum()` لـ `@/lib/utils.ts`.
2. بدّل كل الـ copies الـ local بـ `import { safeNum } from '@/lib/utils'`.
3. نفس الشيء لـ `normalizeArabic()` و أي helper مكرر.

### الاختبار:
- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors.
- browser verify: كل شاشة بـ تستخدم safeNum بـ تعمل صح.

---

# 🅱️ خطة برافو (Backend — vps-service/ + scripts/)

## المرحلة B1: أرشفة الـ dead scripts (107 ملف — ~30,000 سطر)

### الفئات:

| فئة | count | أمثلة | التوصية |
|---|---|---|---|
| shell scripts يدوية | 39 | deploy-mobile-apis.sh, deploy_data_engine_fix.sh | archive |
| mean_reversion_* | 8 | mean_reversion_rigorous.py, mean_reversion_final.py | archive (استراتيجية معطّلة) |
| patch_rootpage_v* | 6 | patch_rootpage_v2.py → v6.py | archive (one-shot patches) |
| rocket_detector_* | 3 | rocket_detector_final.py, _tuned.py, _final_v2.py | archive |
| diagnose_* | 15 | diagnose_alias_duplicates.py, diagnose_data_pipeline.py | archive (one-shot diagnostics) |
| verify_* | 5 | verify_db_restore_final.py, verify_backtest.py | archive |
| migrate_* | 6 | migrate_stock_price_history.py | archive (one-shot migrations) |
| باقي dead | 25 | miscellaneous | archive |

### الخطوات:
1. لكل ملف: `grep -rn "<filename>" --include="*.py" --include="*.sh" .` → تأكد 0 refs.
2. تحقق إنه مش في `crontab.txt` أو `ecosystem.config.js`.
3. `git mv` لـ `archive/garage/scripts/`.
4. حدّث `archive/garage/INDEX.md`.

### الاختبار الصارم:
- `py_compile` على كل الـ active scripts → PASS.
- `crontab.txt` لسه شغّال (كل الـ 26 cron jobs موجودة).
- `ecosystem.config.js` لسه شغّال (كل الـ 8 PM2 apps موجودة).

---

## المرحلة B2: أرشفة الـ dead vps-service files (4 ملف)

### الملفات:
```
vps-service/utils/backtest_stats.py        (170 سطر — 0 importers)
vps-service/glminvestment_engines/examples/demo_confluence.py  (291 سطر — standalone demo)
vps-service/glminvestment_engines/cli_analyze.py                (216 سطر — standalone CLI)
```

### ⚠️ ملاحظة:
`vps-service/portfolio/purification_calculator.py` (425 سطر) ظهر كـ dead (0 importers) بس **جون رجّعه من garage** عشان `/api/sharia/purification` بـ spawnه. **ما تلمسه.**

### الخطوات:
1. لكل ملف: `grep -rn "<filename>" --include="*.py" .` → تأكد 0 refs.
2. `git mv` لـ `archive/garage/vps-service/`.

### الاختبار:
- `py_compile` على كل الـ active vps-service files → PASS.

---

## المرحلة B3: حل الـ route conflict في portfolio_routes.py

### 🔴 المشكلة الحرجة:
- `vps-service/api/portfolio_routes.py` (3046 سطر — Flask Blueprint `portfolio_bp` على `/api/portfolio`)
- `vps-service/ai/portfolio_routes.py` (462 سطر — FastAPI APIRouter `portfolio_router` على `/api/portfolio`)
- **كلاهما يخدم نفس الـ prefix!** ده route conflict صريح.

### الخطوات:
1. اقرا الاتنين + حدد أيه الـ endpoints في كل واحد.
2. لو فيه overlap → قرر أنهي canonical (الأرجح Flask blueprint في api/).
3. انقل أي endpoints فريدة من ai/ لـ api/.
4. احذف `ai/portfolio_routes.py` (أو rename لو فيه endpoints فريدة).
5. تأكد إن `main.py` بـ import الـ canonical بس.

### الاختبار الصارم:
- `py_compile` PASS.
- `curl /api/portfolio/holdings` → 200 (مش 500).
- `curl /api/portfolio/equity-curve` → 200.
- مفيش route conflict في الـ logs.

---

## المرحلة B4: حل الـ duplicate backtest_engine

### المشكلة:
- `vps-service/analyzers/backtest_engine.py` (1277 سطر — legacy)
- `vps-service/engines/backtest_engine.py` (2380 سطر — active)

### الخطوات:
1. `grep -rn "from.*backtest_engine import\|from.*backtest_engine.*import" vps-service/ --include="*.py"` → حدد مين بـ import أنهي.
2. لو analyzers/ version بـ 0 importers → archive.
3. لو فيه importers → انقلهم لـ engines/ version.

### الاختبار:
- `py_compile` PASS.
- `daily_predictor` بيـ import بنجاح (شغل برافو — اتصلح الـ syntax error).

---

## المرحلة B5: حل الـ duplicate scripts

| # | file 1 | file 2 | التوصية |
|---|---|---|---|
| 1 | `scripts/import_egx_indices.py` (347) | `vps-service/scripts/import_egx_indices.py` (181) | احتفظ بـ scripts/ (الأكمل) |
| 2 | `scripts/comprehensive_historical_test.py` (876) | `vps-service/scripts/comprehensive_historical_test.py` (341 dead) | حذف vps-service/ |
| 3 | `scripts/build_stock_profiles.py` (197) | `vps-service/scripts/build_stock_profiles.py` (603) | حذف scripts/ (الأصغر) |

### الخطوات:
1. لكل حالة: اقرا الاتنين + حدد أنهي canonical.
2. احذف الـ non-canonical.
3. تأكد إن مفيش imports لـ الـ non-canonical.

### الاختبار:
- `py_compile` PASS.

---

## المرحلة B6: توحيد الـ SQL CREATE TABLE (141 ملف)

### المشكلة:
141 ملف فيه `CREATE TABLE IF NOT EXISTS` — كل واحد بـ يعمل نفس الـ table بـ schema مختلف.

### الخطوات:
1. حدد الـ canonical schema لكل table (من `prisma/schema.prisma` + `core/migrator.py`).
2. شيل كل `CREATE TABLE` من الـ 141 ملف.
3. خلي الـ `migrator.py` هو الـ source الوحيد لـ CREATE TABLE.
4. الـ 141 ملف بـ تـ query الـ tables بس (مش create).

### الاختبار الصارم:
- `py_compile` PASS على كل الـ 141 ملف.
- `main.py` بـ startup بنجاح (migrator بيـ create كل الـ tables).
- `curl /api/market/overview` → 200 (tables موجودة).

---

## 📋 جدول الاختبارات الصارمة (لكل مرحلة)

| الاختبار | ألفا | برافو | متى |
|---|---|---|---|
| `bun run lint` | ✅ | — | بعد كل مرحلة |
| `npx tsc --noEmit` | ✅ | — | بعد كل مرحلة |
| `py_compile` | — | ✅ | بعد كل مرحلة |
| dev server compile | ✅ | — | بعد كل مرحلة |
| `curl` API test | ✅ | ✅ | بعد كل مرحلة |
| Agent Browser | ✅ | — | بعد المراحل الحرجة |
| `crontab.txt` intact | — | ✅ | بعد B1 |
| `ecosystem.config.js` intact | — | ✅ | بعد B1 |
| `pm2 status` | — | ✅ | على الإنتاج |

---

## ⚠️ مبدأ الشك — قواعد إلزامية

1. **كل ملف قبل الحذف**: `grep -rn "<filename>" . --include="*.ts" --include="*.tsx" --include="*.py"` → لازم 0 نتايج.
2. **كل ملف قبل الحذف**: تحقق إنه مش في `crontab.txt` أو `ecosystem.config.js`.
3. **كل ملف قبل الحذف**: تحقق إنه مش في `archive/garage/INDEX.md` كـ "RESTORED".
4. **بعد كل مرحلة**: `lint` + `tsc` + `py_compile` → لازم 0 errors.
5. **بعد كل مرحلة**: browser verify على شاشة واحدة على الأقل.
6. **لو أي اختبار فشل**: BLOCKED → رجّع التعديل → اصلح → أعد الاختبار.
7. **ما تـ deleteش أي ملف بدون `git mv`** (Rule 16 — archive مش delete).
8. **ما تـ pushش بدون إذن جون** (Rule 75 معلّقة).

---

## 📊 الملخص النهائي

| المرحلة | الفريق | الملفات | السطور | الخطر |
|---|---|---|---|---|
| A1 | ألفا | 15 dead UI | 2,654 | 🟢 low |
| A2 | ألفا | 5 dead libs | 1,317 | 🟢 low |
| A3 | ألفا | 14 dead barrels | ~400 | 🟢 low |
| A4 | ألفا | 5 .preserved/.disabled | ~1,050 | 🟢 low |
| A5 | ألفا | إحياء 4 libs | refactor | 🟡 medium |
| A6 | ألفا | توحيد 3 مكونات | ~1,000 | 🟡 medium |
| A7 | ألفا | استخراج safeNum | refactor | 🟢 low |
| B1 | برافو | 107 dead scripts | ~30,000 | 🟢 low |
| B2 | برافو | 3 dead vps files | 677 | 🟢 low |
| B3 | برافو | route conflict | 462 | 🔴 high |
| B4 | برافو | duplicate engine | 1,277 | 🟡 medium |
| B5 | برافو | duplicate scripts | ~700 | 🟡 medium |
| B6 | برافو | SQL CREATE TABLE | 141 ملف | 🔴 high |

**الإجمالي: ~146 ملف dead + ~35,000 سطر + 8 حالات تكرار + 150 ملف copy-paste.**

---

**جون — الخطتين جاهزتين. ألفا وبرافو يبدأوا. كل مرحلة بـ اختبارات صارمة. مبدأ الشك مطلق.**
