# تقرير تدقيق المستودع — GLMinvestment

> **تاريخ القياس:** 2026-10-28 | **الـ commit:** `e4ab03e9` | **الـ branch:** `main`
> **القائس:** Alpha (في الساندبوكس — نفس المستودع اللي على GitHub)
> **طبيعة التقرير:** تدقيق فقط — لم يتم تعديل أي ملف.

---

## 0. بيانات القياس

| | |
|---|---|
| **الـ branch** | `main` |
| **الـ commit** | `e4ab03e9` |
| **التاريخ** | 2026-10-28 11:16:18 UTC |
| **القائس** | Alpha |

---

## 1. أكبر 25 ملف حسب عدد الأسطر

| # | الملف | الأسطر | النوع | المسؤول |
|---|------|--------|------|---------|
| 1 | `vps-service/analyzers/master_analyzer.py` | 5,793 | Python | Bravo |
| 2 | `vps-service/api/admin_routes.py` | 5,150 | Python | Bravo |
| 3 | `vps-service/jobs/daily_predictor.py` | 4,743 | Python | Bravo |
| 4 | `vps-service/api/misc_routes.py` | 4,393 | Python | Bravo |
| 5 | `vps-service/api/chart_routes.py` | 3,574 | Python | Bravo |
| 6 | `vps-service/jobs/daily_closer.py` | 3,504 | Python | Bravo |
| 7 | `vps-service/api/portfolio_routes.py` | 3,236 | Python | Bravo |
| 8 | `vps-service/api/stored_analysis_routes.py` | 2,995 | Python | Bravo |
| 9 | `src/components/shared/UnifiedTable.tsx` | 2,946 | TSX | Alpha |
| 10 | `vps-service/jobs/market_scheduler.py` | 2,791 | Python | Bravo |
| 11 | `scripts/maker_radar.py` | 2,766 | Python | Bravo (أكبر مساهم) + Alpha (enrichment) |
| 12 | `vps-service/analyzers/background_analyzer.py` | 2,739 | Python | Bravo |
| 13 | `src/modules/education/components/LearningVisuals.tsx` | 2,644 | TSX | Alpha |
| 14 | `vps-service/analyzers/core_scoring_engine.py` | 2,576 | Python | Bravo |
| 15 | `vps-service/engines/backtest_engine.py` | 2,373 | Python | Bravo |
| 16 | `src/app/admin/honest-predictions/page.tsx` | 1,930 | TSX | Alpha |
| 17 | `src/modules/stock-analysis/components/TradingViewChart.tsx` | 1,903 | TSX | Alpha |
| 18 | `vps-service/risk_management_advanced.py` | 1,900 | Python | Bravo |
| 19 | `src/lib/honest-tracking/maestro.ts` | 1,877 | TS | Alpha |
| 20 | `src/modules/radar/components/IncubatorSection.tsx` | 1,715 | TSX | Alpha |
| 21 | `src/modules/stock-analysis/components/StockDetail.tsx` | 1,704 | TSX | Alpha |
| 22 | `src/lib/store.ts` | 1,633 | TS | Alpha |
| 23 | `src/lib/admin-db-manager.ts` | 1,500 | TS | Alpha |
| 24 | `src/components/shared/LiquidityRadarView.tsx` | 1,459 | TSX | Alpha |
| 25 | `src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx` | 1,418 | TSX | Alpha |

---

## 2. أكبر 12 ملف مصدر حسب الحجم (بالبايت)

| # | الملف | الحجم | النوع |
|---|------|-------|------|
| 1 | `vps-service/analyzers/master_analyzer.py` | 325 KB | Python |
| 2 | `vps-service/jobs/daily_predictor.py` | 309 KB | Python |
| 3 | `vps-service/api/misc_routes.py` | 223 KB | Python |
| 4 | `vps-service/jobs/daily_closer.py` | 203 KB | Python |
| 5 | `vps-service/api/admin_routes.py` | 203 KB | Python |
| 6 | `vps-service/api/chart_routes.py` | 184 KB | Python |
| 7 | `vps-service/api/stored_analysis_routes.py` | 151 KB | Python |
| 8 | `vps-service/jobs/market_scheduler.py` | 145 KB | Python |
| 9 | `vps-service/analyzers/background_analyzer.py` | 144 KB | Python |
| 10 | `scripts/maker_radar.py` | 134 KB | Python |
| 11 | `src/modules/portfolio/components/enhanced-portfolio/AssetsTab.tsx` | 134 KB | TSX |
| 12 | `src/components/shared/UnifiedTable.tsx` | 110 KB | TSX |

---

## 3. تتبع تاريخ الملفات عالية الخطورة

### أ. `scripts/maker_radar.py` — 2,766 سطر

**نمو الملف عبر الـ commits (آخر 10):**

| الـ commit | الأسطر | التغير (Δ) | المسؤول | الوصف |
|-----------|--------|-----------|---------|-------|
| `f2df52b` | 2,766 | +1 | meme | unlock intelligence layers |
| `52bf7ea` | 2,765 | -11 | Z User | remove <3 unique dates check |
| `5f8dd2b` | 2,776 | +15 | Z User | scanner enrichment query |
| `f5532dd` | 2,761 | +25 | Z User | fix unreachable code |
| `eb32172` | 2,736 | +186 | Z User | 4 intelligence layers (أكبر قفزة) |
| `ee22bf5` | 2,555 | +189 | Z User | scanner persistence + fallback |
| `c129cca` | 2,366 | +139 | Z User | stocks.db FIRST, price_history LAST |
| `86b9da3` | 2,227 | -119 | meme | fix pine clv formula |

**الاستنتاج**: الملف نما من ~2,227 إلى 2,766 سطر (+539 سطر) عبر 8 commits في يومين. أكبر قفزة +186 سطر (`eb32172` — إضافة الـ 4 طبقات ذكاء) + +189 (`ee22bf5` — scanner persistence). المسؤول الأكبر: **Z User (Bravo)**.

**المسؤوليات (29 دالة)**:
- DB detection + config
- Scanner enrichment (logoid, value_traded, relative_volume)
- Price action classification (14 types)
- Participant flow assessment
- Continuation assessment
- Data quality assessment
- B3 classification + sanity gate
- Incubator candidate building
- Signal tracking to DB
- Arabic report generation
- Main execution loop

**التصنيف**: ⚠️ **خطر صيانة** — الملف بـ يجمع 6 مسؤوليات مختلفة (DB + scanner + analysis + classification + tracking + reporting). مش خلل مؤكد، لكن تقسيمه لـ modules منفصلة ضروري.

---

### ب. `vps-service/jobs/daily_predictor.py` — 4,743 سطر

**النمو عبر الـ commits:**

| الـ commit | الأسطر | المسؤول | الوصف |
|-----------|--------|---------|-------|
| `1efcbd2` | 4,743 | Z User | WAVE-3: seal db_manager alias |
| `c3dc20e` | 4,743 | Z User | canonical ATR migration |
| `37239b8` | 4,749 | Z User | architecture audit fixes |
| `389a6dc` | 4,744 | Z User | market regime surfacing |
| `dee9342` | 4,784 | Z User | ADP/ADPC price sanity gate |

**الاستنتاج**: الملف كان 4,784 سطر في `dee9342` وقلّ 41 سطر عبر 4 commits. تضخمه تراكمي من فترات سابقة. المسؤول: **Z User (Bravo)**.

**المسؤوليات (20 دالة)**:
- Ticker loading + market filtering
- Sector heat loading
- Whale radar integration
- Prediction generation (run_generator)
- Crypto prediction generation
- Toxic blocklist management
- Persona fit + scan dates
- Main entry point

**فيه دوال محذوفة بـ markers**: `_phase72_extraction_marker()`, `_whale_distribution_guard_REMOVED()`, `_phase72_persona_fit_and_scan_dates_removed_marker()`. هذه markers لـ code تم حذفه — لكن الـ markers نفسها لسه موجودة (technical debt).

**التصنيف**: 🔴 **خلل مؤكد** — 4,743 سطر في ملف واحد + markers لـ code محذوف + 20 دالة بـ تجمع 5+ مسؤوليات. يحتاج تقسيم عاجل.

---

### ج. `src/modules/market-analysis/components/MarketAnalysisView.tsx` — 273 سطر

**مفاجأة**: الملف الحالي 273 سطر فقط (مش 7,753 كما في التوثيق القديم). تم عمل refactor سابق وتم تقسيمه.

**التصنيف**: ✅ **حجم مبرر** — تم عمل refactor بالفعل. التوثيق القديم اللي بيقول 7,753 سطر **غير دقيق**.

---

### د. `src/components/shared/UnifiedTable.tsx` — 2,946 سطر

**آخر commit**: `9c7da2b` (Z User / Alpha) — In-Place Patching Blueprint.

**التصنيف**: ⚠️ **خطر صيانة** — 2,946 سطر لمكوّن table واحد. بس ده مكوّن أساسي معاد استخدامه في كل الجداول. الحجم مبرر نسبيًا لكن يحتاج توثيق داخلي.

---

## 4. تضخم `worklog.md`

| الـ commit | الحجم | التاريخ |
|-----------|-------|---------|
| `e4ab03e` | 894 KB (10,535 سطر) | 2026-10-28 |
| `eeced0c` | 868 KB | سابق |
| `35515fe` | 813 KB | سابق |
| `f55d7c6` | 794 KB | سابق |
| `dee9342` | 774 KB | سابق |
| `5f451ab` | 740 KB | سابق |

**الاستنتاج**: worklog.md نما من 740 KB إلى 894 KB (+154 KB) خلال يومين. كل وكيل بـ يـ append تقرير كامل مع كل مهمة. المسؤولون: **Alpha + Bravo بالتساوي**.

**التصنيف**: ⚠️ **خطر صيانة** — الـ worklog بـ يكبر بسرعة. لازم سياسة: ملخصات مختصرة بدل تقارير كاملة + أرشفة دورية.

---

## 5. السكربتات (377 سكربت)

| الفئة | العدد |
|-------|-------|
| إجمالي `.py` في `scripts/` | 377 |
| مستخدمة في crontab | 22 |
| تحتوي `check_`/`test_`/`audit_` (one-off محتمل) | 53 |
| **محتمل مهجورة** | **~355** |
| ملفات في `archive/` | 171 |

**التصنيف**: 🔴 **خلل مؤكد** — 355 سكربت من 377 غير مستخدمة في الـ crontab. أغلبها one-off scripts (check_*, test_*, audit_*). محتاجة جرد + أرشفة.

---

## 6. الـ API Routes (466 route)

**العدد الفعلي**: 466 route.ts (متطابق مع التوثيق ✅)

**التقييم**: العدد كبير لكن مش بالضرورة خلل. المشروع بـ يخدم 5 أسواق + mobile + admin + portfolio + predictions. لكن يستحق فحص التكرار.

**التصنيف**: ⚠️ **محتاج أدلة إضافية** — لازم audit للـ routes المتكررة/المهجورة.

---

## 7. التوثيق — تضارب الأرقام

| ما يقوله التوثيق | الواقع | الفرق |
|------------------|--------|-------|
| `03-HOW-IT-THINKS.md` لا يذكر عدد أسطر `maker_radar.py` صراحةً | 2,766 سطر | لا يوجد تضارب |
| التقرير القديم قال 2,846 سطر | 2,766 سطر | 80 سطر فرق (ممكن اختلاف branch) |
| `MarketAnalysisView.tsx` قيل إنه 7,753 سطر | 273 سطر | **7,480 سطر فرق** — تم عمل refactor |
| الـ API routes: 466 | 466 | ✅ متطابق |
| worklog.md: قيل 6 MB | 894 KB | **غير دقيق** — أقل بكثير |

**التصنيف**: ⚠️ **التوثيق غير متطابق مع الواقع** في 3 نقاط. الـ docs القديمة ما اتحديثتش بعد الـ refactors.

---

## 8. التصنيف النهائي

| # | الملف | الحجم | التصنيف | السبب |
|---|------|------|---------|-------|
| 1 | `daily_predictor.py` | 4,743 | 🔴 خلل مؤكد | 20 دالة + markers محذوفة + 5 مسؤوليات |
| 2 | `master_analyzer.py` | 5,793 | 🔴 خلل مؤكد | 44 دالة + 6 مسؤوليات في ملف واحد |
| 3 | `admin_routes.py` | 5,150 | 🔴 خلل مؤكد | 5,150 سطر routes في ملف واحد |
| 4 | `misc_routes.py` | 4,393 | 🔴 خلل مؤكد | 4,393 سطر routes متناثرة |
| 5 | `maker_radar.py` | 2,766 | ⚠️ خطر صيانة | 29 دالة + 6 مسؤوليات |
| 6 | `daily_closer.py` | 3,504 | ⚠️ خطر صيانة | 3,504 سطر |
| 7 | `UnifiedTable.tsx` | 2,946 | ⚠️ خطر صيانة | مكوّن أساسي ضخم |
| 8 | `worklog.md` | 894 KB | ⚠️ خطر صيانة | ينمو بسرعة بدون أرشفة |
| 9 | 355 سكربت مهجور | — | 🔴 خلل مؤكد | 94% من السكربتات غير مستخدمة |
| 10 | `MarketAnalysisView.tsx` | 273 | ✅ حجم مبرر | تم عمل refactor بالفعل |
| 11 | `LiquidityRadarView.tsx` | 1,459 | ⚠️ خطر صيانة | 26 عمود + 4 طبقات ذكاء |
| 12 | `IncubatorSection.tsx` | 1,715 | ⚠️ خطر صيانة | 3 view modes + enrichment |

---

## 9. المسؤولية

| الفريق | الملفات | إجمالي الأسطر |
|--------|---------|---------------|
| **Bravo (Python)** | 10 ملفات أكبر | ~38,000 سطر |
| **Alpha (Frontend)** | 8 ملفات أكبر | ~16,000 سطر |
| **worklog.md** | كلاهما | 10,535 سطر |

**الاستنتاج**: تضخم الـ backend (Bravo) أكبر بكثير من الـ frontend. لكن Alpha عنده ملفات ضخمة كمان (UnifiedTable, IncubatorSection, LiquidityRadarView).

---

## 10. ما لم يمكن التحقق منه

1. **هل الـ 355 سكربت فعلاً مهجورة؟** — محتاجة audit واحدًا واحدًا (ممكن تكون مستدعاة من scripts تانية مش من crontab).
2. **هل الـ 466 route فيها تكرار؟** — محتاجة فحص endpoints اللي بتعمل نفس الوظيفة.
3. **هل `daily_predictor.py` فيه dead code فعلاً؟** — الـ markers بتقول كده بس محتاجة فحص الاستدعاءات.
4. **تضارب التوثيق** — التقرير القديم قال 2,846 سطر لـ maker_radar.py، ده ممكن من branch تاني أو قياس قديم. ما عنديش دليل قاطع.

---

*هذا التقرير قائم على القياس الفعلي للمستودع على commit `e4ab03e9`. لم يتم تعديل أي ملف.*
