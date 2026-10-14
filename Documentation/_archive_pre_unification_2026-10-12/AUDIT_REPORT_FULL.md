# AUDIT_REPORT_FULL — التقرير الميداني الشامل بكل الأماكن والإثباتات

> **هذا الملف الوثيقة المرجعية الكاملة** لفحص مشروع GLMinvestment بكل الأدلة (file:line) من 8 وكلاء متخصصين (AUDIT-A إلى AUDIT-H).
>
> **المُعدّ**: سوسو (الرئيس التنفيذي التقني)
> **التاريخ**: 2026-10-14
> **المنهجية**: فحص ميداني بـ 8 وكلاء Explore بالتوازي
> **حالة الـ git المحلي**: `ebb02ce` (متأخر عن remote بـ commitان لم يُفحصا)
> **نطاق الفحص**: 583,991 LOC (292,925 TS + 291,066 Python) + 463 API route + 30 Prisma model + 7 DBs + 7 PM2 services

---

## 📑 الفهرس

1. [AUDIT-A: الالتزام بالدستور (82 قاعدة)](#audit-a)
2. [AUDIT-B: الملفات الميتة + dead code](#audit-b)
3. [AUDIT-C: التداخل والتعارض](#audit-c)
4. [AUDIT-D: التعدد والازدواجية](#audit-d)
5. [AUDIT-E: الأسس الهندسية](#audit-e)
6. [AUDIT-F: قواعد البيانات + APIs](#audit-f)
7. [AUDIT-G: الأمان + الأسرار](#audit-g)
8. [AUDIT-H: جاهزية الإنتاج](#audit-h)
9. [الملخص التنفيذي + خطة المعالجة](#summary)

---

## <a name="audit-a"></a>1. AUDIT-A — الالتزام بالدستور (82 قاعدة)

### 1.1 ملخص تنفيذي

- **إجمالي القواعد المفحوصة بالتفصيل**: 22 قاعدة حرجة (من ضمن الـ 82 قاعدة) + مسح عينة لباقي القواعد
- **ملتزم ✅**: 14 قاعدة حرجة
- **ملتزم جزئيًا ⚠️**: 4 قواعد حرجة
- **مخالف ❌**: 3 قواعد حرجة
- **غير محسوم ❓**: 2 قاعدة (تحتاج تدقيق أعمق أو قرار المالك)
- **تعديلات أُجريت على الكود**: صفر (read-only audit)
- **استخدام `--force`**: صفر من جانب الوكيل (Rule 81 محترَمة)

### 1.2 جدول المخالفات الحرجة (مرتبة حسب الخطورة)

| القاعدة | المخالفة | الدليل (ملف:سطر) | التوصية |
|---|---|---|---|
| **Rule 81** (ABSOLUTE FORBIDDEN --force) | سكربت `auto_git_sync.py` يستخدم `git push --force-with-lease` في مسارين، ويُستدعى فعليًا من route.ts عبر `execSync` | `vps-service/scripts/auto_git_sync.py:279` و `:405` + نقطة الاستدعاء `src/app/api/admin/db-backup/route.ts:654` | **🔴 عاجل:** استبدال fallback `--force-with-lease` بـ `git pull --rebase` صافي أو abort + إشعار المالك. حذف السطرين 279 و 405. |
| **Rule 30** (CLIENT-FACING-STYLE no blue/indigo) | 7 مواقع `blue-*` / `indigo-*` في شاشات client-facing | `src/modules/market-analysis/components/ProfessionalTradingChart.tsx:1220,1393` + `src/modules/stock-analysis/components/TradingViewChart.tsx:1901` + `ComprehensiveStockAnalysis.tsx:1253` + `src/modules/predictions/components/MakerRadarTab.tsx:1218,1219,1705,3014,3316,3400,3526` + `src/modules/reports/components/ReportsView.tsx:1010,1012` | استبدال blue-600 بـ emerald-600 (اللون الكنسي) أو slate/cyan-500 للأكاسنت الإعلامية. AIGatekeeperTab مقبول (admin exception). |
| **Rule 67b** (CALCULATION-CANONICAL) | 6 تعريفات `calc_atr` + 2 تعريفات `calc_rsi` بدل 1 canonical | `vps-service/analyzers/indicators/atr.py:26` (canonical) + `analyzers/trend_following_analyzer.py:80` + `analyzers/core_scoring_engine.py:95` + `analyzers/dynamic_target_engine.py:228` + `scripts/honest_backtest_*.py` (3 ملفات) + `engines/backtest_engine.py:294` + `scripts/migrate_calc_indicators.py:41` | إكمال migration Phase 2 لـ Rule 67b — استيراد كل النسخ المكررة من `indicators/atr.py` و `indicators/rsi.py`. |

### 1.3 جدول الالتزام الجزئي

| القاعدة | الفجوة | الدليل | التوصية |
|---|---|---|---|
| **Rule 20** (RULE20-PURE-PROXY) | `computeStatsFromPredictions` في PredictionTrackingDashboard.tsx بيحسب `avgWinPct` + `profitFactor` + `cumulativeReturnPct` + `maxLoss` + `rrRatio` client-side. التعليقات في الكود نفسه توثّق أن winRate تم nullify لكن باقي الحسابات لا. | `src/modules/predictions/components/PredictionTrackingDashboard.tsx:468-540` | Python backend لازم يوفّر `stats` object كامل. مهمة منسقة Phase 3. |
| **Rule 20** | `/api/portfolio/rescue/route.ts` بيستخدم `buyPrice * 1.15` كـ fallback لـ bestPrice (synthetic) | `src/app/api/portfolio/rescue/route.ts:335` | عرض "— بيانات غير متاحة" أو تمرير السيناريوهات لـ Python endpoint. |
| **Rule 52/54** (UnifiedTable migration) | 10 ملفات لسه بتستخدم `<Table>` يدوي بدل `<UnifiedTable>` | `src/modules/admin/components/SuperLearningSystem.tsx` + `DatabaseManagerFull.tsx` + `src/modules/education/components/AcademyView.tsx` + `src/modules/sharia/components/ShariaView.tsx` + `src/modules/radar/components/AccuracyDashboard.tsx` + `MultiMarketRadarTab.tsx` + `PersonalizedRadarTab.tsx` + `src/app/admin/honest-predictions/page.tsx` + `src/app/admin/educational-cards/page.tsx` + `src/app/backtest/page.tsx` | إكمال migration لـ 10 شاشات المتبقية من أصل 21 (Rule 54). |
| **Rule 28/29/34** (NO-DUPLICATION) | 463 route.ts في المشروع؛ آخر إدخال AUDIT-INTERJECTION في worklog بيذكر 5 watchlist routes + 5 news routes مكررة | worklog.md:70730-70732 | توحيد الـ routes المتكررة. |

### 1.4 تفاصيل القواعد الحرجة

#### Rule 4 / Rule 63 — NO-NEW-SCREENS-FILES
- **الحالة:** ⚠️ ملتزم جزئيًا
- **الدليل:** بعد bootstrap commit (d0b480c, 2026-10-14) الذي أنشأ المشروع ككل، تمت إضافة:
  - `src/components/shared/LiquidityRadarView.tsx` (commit c2c0935) — مستورد في `page.tsx` (Rule 5 موفى) لكن بدون توثيق صريح لموافقة المالك.
  - `src/components/shared/VIPLiveSignalsFeed.tsx` (commit a2d04e5) — مستورد في `UnifiedPredictionsTab.tsx`.
  - `src/modules/portfolio/components/BagHolderRescuePanel.tsx` — مُصرّح به ضمنيًا بـ MASTER_STRATEGIC_PLAN T-06.
- **التعليق:** المكونات الجديدة متربطة فعليًا (Rule 5 موفى) لكن بدون توثيق موافقة المالك في CHANGELOG. تحتاج تأكيد.

#### Rule 16 — VERIFY-BEFORE-DELETE
- **الحالة:** ✅ ملتزم
- **الدليل:** `archive/pitch-deck-2026-10-14/` (ملفات مؤرشفة) + `Documentation/_archive_pre_unification_2026-10-12/` (10+ ملفات توثيق قديمة مؤرشفة، غير محذوفة).
- **التعليق:** ممارسة سليمة — dead code يُؤرشف لا يُحذف.

#### Rule 20 — RULE20-PURE-PROXY (Python=Brain, Node=Display)
- **الحالة:** ⚠️ ملتزم جزئيًا
- **الدليل الإيجابي:** 17 Node routes اتحوّلت لـ pure thin proxies (مذكور في constitution §Rule 20). Math.random مُستخدم فقط في ID generation.
- **الدليل السلبي:** `PredictionTrackingDashboard.tsx:468-540` بيحسب profitFactor + cumulativeReturnPct + maxLoss client-side. التعليق في السطر 491-494 يوثّق أن winRate اتـ nullified لكن باقي الحسابات لا.
- **التعليق:** يحتاج مهمة coordinated backend+frontend migration (مذكور في worklog P3-CLEAN-FIN-COMPUTATIONS كـ REMAINING out-of-scope).

#### Rule 27 — NO-FAKE-DATA
- **الحالة:** ✅ ملتزم
- **الدليل:** لا توجد `fundamental_score = 50.0` placeholders. لا `Math.random()` لإنتاج أرقام مالية. `Math.random()` مقتصر على:
  - ID generation (`alerts-store.ts:58`, `notification-store.ts:38`, `UnifiedTable.tsx:1117`, إلخ).
  - A/B testing للـ CTA templates (`cta-templates.ts:72`).
  - SimulationView (`SimulationView.tsx:416,464,514` — مصرّح به صراحةً بـ Rule 27).
- **التعليق:** سياسة الفراغ مُطبّقة بشكل صحيح في الـ KPI cards + Tooltips.

#### Rule 30 — CLIENT-FACING-STYLE (no blue/indigo)
- **الحالة:** ❌ مخالف
- **الدليل:** 7 مواقع `blue-*` / `indigo-*` في 5 شاشات client-facing:
  - `ProfessionalTradingChart.tsx:1220` (`text-blue-600` لأيقونة Waves)
  - `ProfessionalTradingChart.tsx:1393` (`text-blue-600 dark:text-blue-400` لـ entry color)
  - `TradingViewChart.tsx:1901` (`bg-blue-500` لـ dataSource indicator)
  - `ComprehensiveStockAnalysis.tsx:1253` (`bg-blue-500/20 text-blue-700 border-blue-500/40` لـ pivots)
  - `MakerRadarTab.tsx:1218,1219,1705,3014,3316,3400,3526` (7 مواقع blue classes)
  - `ReportsView.tsx:1010,1012` (`border-blue-200 bg-blue-50/30` لـ admin card)
- **الاستثناء المقبول:** `AIGatekeeperTab.tsx:298,300,436` (admin tab — Rule 30 exception).
- **التعليق:** `Documentation/UX_SCREEN_DESIGN_PACKAGE.md:68,1594,1880` بيؤكد أن blue/indigo ممارسة ممنوعة في client-facing.

#### Rule 50 — MONEY-AS-CUSTOMER-LIFE
- **الحالة:** ✅ ملتزم
- **الدليل:** كل الـ portfolio routes بتقرأ من `portfolio_assets` table:
  - `/api/portfolio/holdings/route.ts:146` (`SELECT * FROM portfolio_assets WHERE user_id = ?`)
  - `/api/portfolio/master/route.ts:68`
  - `/api/portfolio/equity-curve/route.ts:151`
  - `/api/portfolio/risk-summary/route.ts:103`
  - `/api/portfolio/smart-monitor/signals/route.ts:88`
  - `/api/portfolio/bag-holder-rescue/route.ts:140`
- **التعليق:** لا mock data في أي portfolio endpoint. الـ comments بتوثّق التاريخ (BEFORE/AFTER) — كانت hardcoded mock وتاتصلحت.

#### Rule 52 / Rule 54 — UnifiedTable + migration (21 screens)
- **الحالة:** ⚠️ ملتزم جزئيًا
- **الدليل الإيجابي:** `src/components/shared/UnifiedTable.tsx` موجود (1117+ سطر) + `UnifiedPublishButton.tsx` موجود. SectorTrackingTab.tsx هو النموذج المرجعي.
- **الدليل السلبي:** 10 ملفات لسه بتستخدم `<Table>` يدوي (مذكورة في جدول الالتزام الجزئي).
- **التعليق:** Rule 54 specified 21 screens needed migration — ~11 migrated، 10 remaining. الاستثناءات للجداول الصغيرة (≤3 أعمدة × ≤5 صفوف) ما ينطبقش على كل الـ 10.

#### Rule 53 — CRYPTO-IN-MARKETS
- **الحالة:** ✅ ملتزم
- **الدليل:** `MobileMoreSheet.tsx:40-50` — moreNavItems لا يحوي أي crypto entry. `TopBar.tsx:75-79` — CRYPTO موجود في ExchangeSelector فقط مع باقي الأسواق. `valid-views.ts:75-82` — crypto-* views تعمل كـ redirects للـ backwards compatibility مع Flutter (مصرّح به في Rule 53).
- **التعليق:** التنفيذ نموذجي.

#### Rule 60 — MODULE-SYSTEM
- **الحالة:** ✅ ملتزم
- **الدليل:** 17 frontend modules في `src/modules/` (radar, publishing, personalized [لاحظ: غير موجود كـ directory منفصل — مدمج في radar أو portfolio], stock-analysis, predictions, portfolio, screener, market-analysis, news, admin, crypto, education, reports, dashboard, simulation, subscription, auth, sharia). 8 backend modules في `vps-service/modules/` (admin, ai, market_data, market_regime, portfolio, predictions, radar, telegram).
- **التعليق:** مطابق لـ Rule 60 (17 frontend + 9 backend مذكورة، فعليًا 8 لأن root ليس module مستقل).

#### Rule 67b — CALCULATION-CANONICAL
- **الحالة:** ❌ مخالف
- **الدليل:** معيار القبول في القاعدة: `grep -r "def calc_atr|def calculate_atr" vps-service/ --include="*.py" | wc -l → 1`. النتيجة الفعلية: 6 تعريفات (atr.py canonical + trend_following_analyzer + core_scoring_engine + dynamic_target_engine + 3 honest_backtest scripts + backtest_engine). وبالنسبة لـ calc_rsi: 2 تعريفات (rsi.py canonical + migrate_calc_indicators.py).
- **التعليق:** Rule 67b بنفسه بيقول "الهجرة تدريجية: الـ 150+ inline copies هتـ migrates في Phase 2" — لذا هذا انتهاك معروف ومُتعَمَّد تأجيله. لكنه لا يزال انتهاكًا يوميًا.

#### Rule 72 — UNIFIED-DATA-CONTRACT
- **الحالة:** ✅ ملتزم
- **الدليل:** `vps-service/utils/canonical_signal.py` (309 LOC) + `src/lib/canonical-signal.ts` (271 LOC) — الـ TS port مطابق Python 100% (القاعدة تقول 246 LOC لكن الفعلي 271 — فرق 25 سطر بسبب self-tests إضافية). `shared_liquidity.py` موجود (1550 LOC). Self-tests مطبّقة في كلا الـ portين (canonical-signal.ts:236-272).
- **التعليق:** التحقق الذاتي (assertions) في canonical-signal.ts بيثبت التطابق.

#### Rule 73 — SINGLE-DISPLAY-SOURCE
- **الحالة:** ✅ ملتزم
- **الدليل:** `/api/stocks/[ticker]/unified` مستخدم في 7+ مكونات (SingleStockAnalysisView:366 + ProfessionalTradingChart:148 + GateAnalysisView:147 + StockDetail:1130 + ComprehensiveStockAnalysis:254 + UnifiedPublishButton:319 + SpecialistAnalysisView). التعليقات في الكود توثّق "single source of truth".
- **التعليق:** الـ canonical endpoint مفعّل ومُستخدم على نطاق واسع.

#### Rule 76 — TEAM-WORK-REVIEW
- **الحالة:** ✅ ملتزم
- **الدليل:** آخر 100 سطر من worklog.md بتظهر مراجعة شغل الفريق السابق (P3-CLEAN-FIN-COMPUTATIONS + P5-MARKET-TS-FIX). كل task بيبدأ بـ "Rule 76: قرأت آخر worklog entries". إدخالات worklog كلها فيها "Verification" sections.
- **التعليق:** ممارسة سليمة — تحقق قبل الادعاء.

#### Rule 78 — CONDITIONAL-TRADE-EXPOSURE
- **الحالة:** ✅ ملتزم
- **الدليل:** `ProfessionalTradingChart.tsx:730-828` — TradePlanCard يتعرض فقط لما `isBuySignal && (entry !== null || target1 !== null || stop !== null)`. للـ SELL/AVOID/KILL/REJECT → لوحة تحذير حمراء صريحة. لـ REDUCE → لوحة amber. لـ HOLD/WAIT → لوحة "إشارة انتظار". التعليق في السطر 764 بيقول "Rule 78 (TradePlanCard filter)" بشكل صريح.
- **التعليق:** التنفيذ نموذجي ومطابق للقاعدة تمامًا.

#### Rule 80 — MONEY-FLOW-CONSISTENCY
- **الحالة:** ✅ ملتزم
- **الدليل:** `src/lib/canonical-signal.ts:122-158` — `classifyMoneyFlow(buyPct, sellPct, netFlowEgp, phase)`:
  - لو `buyPct < 40` أو `netFlowEgp < 0` أو `phase === 'تخفيض'` → تصنيف 🔴 ضغط بيعي قوي / 🔴 سيولة خارجة قوية (ممنوع "سيولة داخلة" أبدًا).
  - لو `40 ≤ buyPct < 45` → 🟡 سيولة متوازنة (لا "داخلة" بعد).
  - لو `buyPct ≥ 45` و `diff ≥ 10` → 🟢 سيولة داخلة.
- **التعليق:** مطابق تمامًا للقاعدة (45% threshold). Self-tests في السطور 246-250 بتثبت السلوك.

#### Rule 81 — ABSOLUTE FORBIDDEN --force
- **الحالة:** ❌ مخالف (CRITICAL)
- **الدليل:** `vps-service/scripts/auto_git_sync.py:279,405` بيستخدم `git push --force-with-lease`. السكربت يُستدعى فعليًا من `src/app/api/admin/db-backup/route.ts:654` عبر `execSync('python3 vps-service/scripts/auto_git_sync.py', ...)`.
- **التعليق:** Rule 81 تقول صراحة: "ممنوع نهائياً تنفيذ `git push --force` أو `--force-with-lease` من أي ساندبوكس." السكربت docstring نفسه (السطر 13) بيقول "force push لو الـ ref lock فشل" — يقرّ بالمخالفة. هذا هو الأخطر لأنه على production path.

#### Rule 82 — VERIFIABLE-PROOF-MANDATE
- **الحالة:** ✅ ملتزم
- **الدليل:** آخر 100 سطر من worklog.md بتظهر إدخالات كاملة بـ Verification sections:
  - "Verification (PASS): lint: EXIT=0 ✅"
  - "bunx tsc --noEmit --skipLibCheck 2>&1 | rg ..." → EXIT=1 (ZERO matches) ✅
  - "curl /api/X: 200 ✅"
- **التعليق:** ممارسة سليمة — لا ادعاءات بدون إثبات.

---

## <a name="audit-b"></a>2. AUDIT-B — الملفات الميتة + dead code

### 2.1 ملخص تنفيذي

- **إجمالي الملفات الميتة/المؤرشفة**: 75 ملفًا (ميتة مؤكدة) + عدد من الـ orphan exports داخل ملفات حية
- **إجمالي أسطر dead code**: ~38,200 سطر
- **توزيع**: 1 مكون ميت كبير + 8 مسارات tombstone + 36 سكربت ميت + 4 ملفات disabled + 1 Prisma model ميتة + 1 type ميت + 2 npm script refs مكسورة + 1 duplicate + 3 null consts + 5+ orphan exports

### 2.2 جدول الملفات الميتة (مرتب حسب الحجم)

| المسار | النوع | أسطر | السبب | التوصية |
|---|---|---|---|---|
| `Documentation/_archive_pre_unification_2026-10-12/*.md` (29 ملف) | أرشيف docs | 30,881 | مجلد أرشيف صريح | إبقاء (أرشيف تاريخي مقصود) |
| `scripts/archive_diagnostics/*.py` (26 ملف) | أرشيف سكربتات | 5,942 | مجلد أرشيف صريح | إبقاء + لكن إصلاح `package.json:check:guards` |
| `src/modules/predictions/components/PredictionTrackingDashboard.tsx` | مكون ميت | 2,318 | مُصدّر في index.ts، غير مُستورد في أي ملف (Grep مؤكد) | **حذف فوري** |
| `scripts/patch_rootpage.py` + `_v2` + `_v3` + `_v4` + `_v5` | سكربتات مكررة | 1,523 | مُلغاة بـ v6 (وثّقها Documentation/06-SCRIPTS_DICTIONARY.md) | ترحيل إلى `archive/` |
| `data_engine/scrapers/metals_forex_fetcher.py.original` | ملف .original | 546 | لاحقة `.original` صريحة | حذف (النسخة الأصلية metals_forex_fetcher.py موجودة) |
| `scripts/archive_diagnostics/diagnose_explosive_rejections_v2.py` | أرشيف diagnostic | 548 | داخل مجلد archive_diagnostics | إبقاء (أرشيف diagnostic) |
| `scripts/archive_diagnostics/diagnose_liquidity_rejections.py` | أرشيف diagnostic | 484 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/diagnose_explosive_rejections.py` | أرشيف diagnostic | 464 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/check_no_raw_insert.py` | أرشيف + مكرر | 405 | مكرر — مطلوب من `scripts/` لكنه غير موجود هناك | **إصلاح package.json** أو نقل الملف |
| `scripts/archive_diagnostics/diagnose_production_state.py` | أرشيف diagnostic | 438 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_i18n_merge.py` | أرشيف diagnostic | 408 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/patch_rootpage_v2.py` | سكربت مكرر | 415 | ملغى بـ v6 | ترحيل إلى `archive/` |
| `scripts/patch_rootpage_v3.py` | سكربت مكرر | 381 | ملغى بـ v6 | ترحيل إلى `archive/` |
| `scripts/patch_rootpage_v5.py` | سكربت مكرر | 250 | ملغى بـ v6 | ترحيل إلى `archive/` |
| `scripts/patch_rootpage.py` (v1) | سكربت مكرر | 343 | ملغى بـ v6 | ترحيل إلى `archive/` |
| `scripts/archive_diagnostics/diagnose_utop_and_price_history.py` | أرشيف diagnostic | 285 | داخل مجلد archive_diagnostics | إبقاء |
| `src/app/api/maker-radar/footprint/route.ts` | tombstone route | 132 | يرجع 410 + كود معطّل في comment | حذف الكود المعلّق (lines 47-132) بعد فترة سماح |
| `news-agent/collectors/scrappers/investing_scraper.py.disabled` | ملف .disabled | 145 | لاحقة `.disabled` صريحة | حذف |
| `scripts/patch_rootpage_v4.py` | سكربت مكرر | 134 | ملغى بـ v6 | ترحيل إلى `archive/` |
| `scripts/patch_rootpage_v6.py` | سكربت final | 237 | الإصدار النهائي — لكن المهمة منجزة | **إبقاء كمرجع** أو أرشفة |
| `scripts/archive_diagnostics/check_no_hard_delete.py` | أرشيف + مكرر | 257 | مكرر — مطلوب من `scripts/` لكنه غير موجود هناك | **إصلاح package.json** أو نقل الملف |
| `scripts/archive_diagnostics/diagnose_v402_filters.py` | أرشيف diagnostic | 210 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_fix_db_restore.py` | أرشيف diagnostic | 218 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_fix_america_to_us.py` | أرشيف diagnostic | 184 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_fix_wave3_replace_error_leaks.py` | أرشيف diagnostic | 160 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_migrate_learning.py` | أرشيف diagnostic | 155 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/_migrate_specialist.py` | أرشيف diagnostic | 154 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/diagnose_v402_full.py` | أرشيف diagnostic | 157 | داخل مجلد archive_diagnostics | إبقاء |
| `scripts/archive_diagnostics/diagnose_entry_gate.py` | أرشيف diagnostic | 99 | داخل مجلد archive_diagnostics | إبقاء |
| `src/app/api/sniper/track/route.ts` | tombstone route | 107 | partially disabled | مراجعة بعد فترة سماح |
| `news-agent/collectors/investing_news_collector.py.disabled` | ملف .disabled | 108 | لاحقة `.disabled` صريحة | حذف |
| `news-agent/collectors/rss_collector.py.disabled` | ملف .disabled | 78 | لاحقة `.disabled` صريحة | حذف |
| `scripts/patch_watchlist4.py` | سكربت patch منجز | 63 | المهمة منجزة (patch EnhancedWatchlistView) | حذف أو أرشفة |
| `src/app/api/predictions/tracking/list/route.ts` | tombstone route | 58 | يرجع 410 (deprecated 2026-10-15) | إبقاء مؤقتًا ثم حذف |
| `src/app/api/stocks/[ticker]/professional-analysis/route.ts` | tombstone route | 56 | يرجع 410 | إبقاء مؤقتًا ثم حذف |
| `src/app/api/admin/generate-historical-predictions/route.ts` | tombstone route | 53 | يرجع 410 (MAESTRO-KILL) | إبقاء مؤقتًا ثم حذف |
| `scripts/patch_watchlist.py` + `2` + `3` | سكربتات patches منجزة | 134 | كلها patches لمهمة منجزة | حذف أو أرشفة |
| `src/app/api/backtesting/unified/route.ts` | tombstone route | 48 | يرجع 410 (RULE27-DISABLED) | إبقاء مؤقتًا ثم حذف |
| `src/app/api/recommendations/retroactive-evaluate/route.ts` | tombstone route | 44 | يرجع 410 (RULE20-DISABLED) | إبقاء مؤقتًا ثم حذف |
| `src/app/api/admin/generate-predictions/route.ts` | tombstone route | 35 | يرجع 410 (DISABLED 2026-09-02) | إبقاء مؤقتًا ثم حذف |
| `src/modules/market-analysis/components/LiveDashboard.tsx::LiveDashboardWidget` | orphan export | ~30 (inside file) | مُصدّر، غير مُستورد | إزالة الـ export |
| `src/modules/radar/components/RadarStatsCards.tsx::RadarSignalStatsCard` | orphan export | ~250 (block) | مُصدّر، غير مُستورد | إزالة الـ export + الدالة |
| `src/modules/radar/components/RadarStatsCards.tsx::SectorTreemapCard` | orphan export | ~150 (block) | مُصدّر، غير مُستورد | إزالة الـ export + الدالة |
| `src/app/page.tsx` (lines 273-275) | null consts dead | 3 | `const CryptoScreenerView = null` + 2 — متغيرات معلّقة | **حذف فوري** |
| `prisma/schema.prisma::User` + `Post` | Prisma models ميتة | ~20 | PrismaClient من @prisma/client غير مُنشأ في src/ (فقط Prisma namespace) | توثيق كـ legacy + خطة حذف |
| `src/lib/db-predictions.ts:27::AiPrediction` | type ميت | 1 | النوع dropped من الـ schema لكن ما زال مُعاد تصديره | **حذف فوري** |

### 2.3 مكونات معطّلة داخل شاشات نشطة

| المكون | الموقع | السبب |
|---|---|---|
| `LiveDashboardWidget` (function) | `src/modules/market-analysis/components/LiveDashboard.tsx:91` | مُصدّر + غير مُستورد — باقي دوال الملف (`HeartbeatStatusBar`, `WhaleAlertListener`) مستخدمة في `SingleStockAnalysisView.tsx` |
| `RadarSignalStatsCard` + `SectorTreemapCard` | `src/modules/radar/components/RadarStatsCards.tsx` | مُصدّرة في index.ts لكن غير مُستوردة — باقي دوال الملف (`EntryTimingCard`, `LiquidityFootprintCard`) مستخدمة في `MakerRadarTab.tsx` |
| `WhatsAppIcon` | `src/modules/screener/components/StockScreenerAdvanced.tsx:2620` | مُصدّرة في `screener/index.ts` لكنها مستخدمة داخليًا فقط — NewsFeedView.tsx يعرّف نسخته المحلية الخاصة |
| `useShariaDetail` + `deriveShariaSummary` | `src/modules/sharia/components/ShariaBadge.tsx:175,211` | مُصدّرة في `sharia/index.ts` لكنها مستخدمة داخليًا فقط |
| `MaestroWidget` (comment) | `src/modules/dashboard/index.ts:17` | تعليق `// export { MaestroWidget }` لملف لم يعد موجودًا — تعليق stale فقط |
| `CryptoScreenerView = null` + 2 | `src/app/page.tsx:273-275` | 3 متغيرات `null` معلّقة بدون consumers — تبقى من P1-CLEANUP task |

### 2.4 مكررات وظيفية (نفس الوظيفة في مكانين)

| المكرر 1 | المكرر 2 | التوصية |
|---|---|---|
| `src/modules/portfolio/components/StockSearchDropdown.tsx` (122 سطر، مُصدّر، مستخدم في PaperTradingWorkstation.tsx) | `src/modules/portfolio/components/EnhancedPortfolioView.tsx:321` (local function بنفس الاسم والـ signature، مستخدم داخليًا) | **دمج**: حذف الدالة المحلية من EnhancedPortfolioView.tsx واستخدام الـ import من ملف StockSearchDropdown.tsx (الـ DRY violation) |
| `scripts/check_no_hard_delete.py` + `check_no_raw_insert.py` (في `scripts/archive_diagnostics/`) | مطلوبان من `scripts/` في `package.json:19` | إما نقل الملفين إلى `scripts/` أو إصلاح `package.json` للمسار الصحيح |
| `WhatsAppIcon` (in StockScreenerAdvanced.tsx, مُصدّر) | `WhatsAppIcon` (in NewsFeedView.tsx:320, local function) | توحيد: استيراد من StockScreenerAdvanced في NewsFeedView |
| `MARKET_CODES` const | مُعرّف في `helpers.ts:211` + `lib/store.ts:619` + `components/market/MarketStatusExport.tsx:21` | توحيد في مكان واحد (canonical: `helpers.ts`) |
| 6 نسخ من `patch_rootpage_*.py` | v6 هو الـ final (موثّق في 06-SCRIPTS_DICTIONARY.md) | ترحيل v1-v5 إلى `archive/` |

### 2.5 توزيع dead code حسب الوحدة

| الوحدة | عدد الملفات الميتة | أسطر |
|---|---|---|
| `Documentation/_archive_pre_unification_2026-10-12/` | 29 | 30,881 |
| `scripts/archive_diagnostics/` | 26 | 5,942 |
| `scripts/` (versioned patches + tombstone refs) | 10 | 1,720 |
| `news-agent/collectors/` (.disabled) | 3 | 331 |
| `data_engine/scrapers/` (.original) | 1 | 546 |
| `src/app/api/` (tombstone routes) | 8 | 533 |
| `src/modules/predictions/components/` (PredictionTrackingDashboard) | 1 | 2,318 |
| `src/modules/radar/components/` (RadarStatsCards orphan blocks) | 1 file, 2 funcs | ~400 |
| `src/modules/market-analysis/components/` (LiveDashboard orphan) | 1 file, 1 func | ~30 |
| `src/modules/screener/` (orphan export) | 1 func | ~15 |
| `src/modules/sharia/` (orphan exports) | 1 file, 2 funcs | ~50 |
| `src/app/page.tsx` (null consts) | 3 vars | 3 |
| `prisma/schema.prisma` (User + Post) | 2 models | ~20 |
| `src/lib/db-predictions.ts` (AiPrediction type) | 1 type | 1 |
| `archive/pitch-deck-2026-10-14/` | 2 | (binary) |
| `news-agent/_disabled_dbs/` | 2 | (small JSON) |
| **الإجمالي** | **75+** | **~38,200** |

### 2.6 أخطاء حرجة مكتشفة

1. **`package.json:19` (`check:guards`)** — يستدعي `scripts/check_no_hard_delete.py` + `scripts/check_no_raw_insert.py` لكن الملفات **غير موجودة** في `scripts/` (موجودة في `scripts/archive_diagnostics/`). `npm run check:guards` سيفشل بـ FileNotFoundError.

2. **`package.json:20` (`data:fill-missing`)** — يستدعي `scripts/fill-missing-data-from-engine.py` لكن الملف **غير موجود** إطلاقًا. `npm run data:fill-missing` سيفشل.

3. **`src/lib/db-predictions.ts:27`** — يُعيد تصدير نوع `AiPrediction` لكن الـ model تم DROPPED من `prisma/predictions-schema.prisma:9` ("aiPrediction: DROPPED"). النوع غير موجود فعليًا → قد يسبب TS error في بعض الـ setups.

---

## <a name="audit-c"></a>3. AUDIT-C — التداخل والتعارض

### 3.1 ملخص تنفيذي
- **حالات التداخل الحرجة**: 5 (تؤثر على الإنتاج — أمن/وظائف خاطئة/تضارب منافذ)
- **حالات التداخل المتوسطة**: 7 (تؤثر على الجودة — مسارات مكررة/بيانات موازية)
- **حالات التداخل البسيطة**: 4 (تؤثر على الصيانة — أسماء/تعليقات قديمة)

### 3.2 التداخل الحرج (يؤثر على الإنتاج)

| # | النوع | الوصف | الأثر | الدليل |
|---|---|---|---|---|
| 1 | Auth overlap | `admin/layout.tsx` لا يزال يطبّق localhost bypass (`host.startsWith('localhost')`, `127.`, `10.`, `192.168.`, `NODE_ENV==='development'`) على مستوى الـ page guard، بينما `admin-auth-server.ts` ألغى الـ Method 3 localhost bypass في 2026-10-01 (BOOTCAMP-3) ويطلب الآن `ALLOW_ADMIN_BYPASS=true`. النتيجة: صفحات admin HTML تُعرض لأي طلب عبر proxy-server.js (الذي يضع `host: localhost:${PROXY_PORT}` — proxy-server.js:113) بينما API calls تُرفض بـ 403. هذا يكسر كل admin UI في sandbox ويخلق ثغرة أمنية محتملة لو NODE_ENV=development. | **CRITICAL** — admin UI accessible without auth; API/UI split-brain | `src/app/admin/layout.tsx:31-40` vs `src/lib/admin-auth-server.ts:198-209` |
| 2 | API overlaps | **23+ route stub** يستوردون `marketPulseProxy` وكلهم return نفس بيانات `/api/market-pulse` رغم أن أسماءهم تدّعي وظائف مختلفة تمامًا. المُطوّر وثّق هذا في تعليق (market-pulse-proxy.ts:4: "توحيد 37 mislabeled proxy routes"). Routes تشمل: `/api/recommendations`, `/api/recommendations/backtest`, `/api/subscribe/[plan]`, `/api/stocks/advanced-analysis`, `/api/self-learning`, `/api/v2/feedback/run`, `/api/v2/live-analysis`, `/api/advanced-analysis/results`, `/api/mobile/stocks/[ticker]/recommendation`, `/api/mobile/stocks/[ticker]/professional-analysis`, `/api/mobile/watchlist/intelligence`, `/api/mobile/zakat-calculator`, `/api/init-db`, `/api/admin/ab-test`, `/api/admin/ai-analyze`, `/api/system-control`, `/api/walk-forward-test`, `/api/seasonality-signals`, `/api/data-status`, `/api/iterative-learning`, `/api/features`, `/api/market/status`, `/api/market/sectors`. العميل (Flutter) يطلب `/api/mobile/zakat-calculator` ويتلقى بيانات market-pulse بدلاً من حساب الزكاة. | **CRITICAL** — API names lie about function; mobile app gets wrong data | `src/lib/market-pulse-proxy.ts:1-30` + `rg -l "marketPulseProxy" src/app/api` → 23 routes |
| 3 | Config overlaps | تعارض منافذ بين sandbox gateway و PM2 production gateway: `proxy-server.js` يستمع على `PROXY_PORT=3000` ويمرّر إلى Next.js على `NEXT_PORT=3001`. لكن `ecosystem.config.js` يشغّل Next.js مباشرة على `PORT=3000` (line 211: `next start -p 3000`) وws-service على 3005. لو شُغّلا معًا (مثلاً developer شغّل `.zscripts/start.sh` وPM2 في نفس الوقت) → EADDRINUSE على المنفذ 3000. Caddy (`:81` → `localhost:3000`) يجلس أمام أيٍّ منهما. | **HIGH** — port collision if both run | `proxy-server.js:18-20` vs `ecosystem.config.js:211` + `.zscripts/start.sh:76` |
| 4 | UI overlaps | 4 شاشات alias لمكوّن واحد `<MarketAnalysisView />` رغم اختلاف أسمائها: `#recommendations`, `#analysis`, `#advanced-analysis`, `#v2-analysis` كلها تُرجِع إلى نفس المكوّن (`<MarketAnalysisView />`). كذلك `#crypto-recommendations` يعود إليه. المُطوّر وثّق ذلك في تعليق (page.tsx:531-534: "advanced-analysis REMOVED — features distributed to #recommendations + #specialist-analysis")، لكنه أبقى الـ hash كـ alias بدل إعادة توجيه 301. الـ sidebar/الـ deep-links تظهر شاشات بأسماء مختلفة لكنها نفس الـ component — يربك المستخدم. | **HIGH** — UX confusion, 4 menu items for same screen | `src/app/page.tsx:526-535` (cases: recommendations, analysis, advanced-analysis, v2-analysis → same `MarketAnalysisView`) |
| 5 | UI overlaps | **`#screener` و`#trading-chart`** يتشاركان نفس الـ case block ويُرجِعان `<TradingChartView />` — لكن `#screener` اسمه يوحي بأنه StockScreenerAdvancedView. كذلك `#stock-filters` هو الذي فعلاً يُرجِع `<StockScreenerAdvancedView />` (page.tsx:514). النتيجة: 3 شاشات بأسماء مختلفة لـ function واحدة (filters) + شاشة `#screener` تعرض trading chart بدلاً من screener. | **HIGH** — wrong content for route name | `src/app/page.tsx:518-520` (case 'screener': + case 'trading-chart': → TradingChartView) vs `case 'stock-filters': → StockScreenerAdvancedView` |

### 3.3 التداخل المتوسط (يؤثر على الجودة)

| # | النوع | الوصف | الأثر | الدليل |
|---|---|---|---|---|
| 6 | API overlaps | **5 routes تقرأ نفس جدول `user_stock_watchlists`** في stocks.db: `/api/watchlist`, `/api/watchlist-enhanced`, `/api/mobile/watchlist`, `/api/portfolio/watchlists`, `/api/crypto/watchlist`. كلها تُرجِع نفس الحقول (`id, ticker, alert_price_above/below, change_percent, purchase_price, quantity`) مع اختلافات شكلية فقط. سادس route (`/api/portfolio/unified-watch`) proxies إلى Python (Rule 4 compliant) لكن الـ 5 الآخرين يفتحون SQLite مباشرة. | **MEDIUM** — 5 copies of same SQL; Rule 4 violation in 5 routes | `src/app/api/watchlist/route.ts:86`, `watchlist-enhanced/route.ts:30`, `mobile/watchlist/route.ts:53`, `portfolio/watchlists/route.ts:85`, `crypto/watchlist/route.ts` |
| 7 | Data overlaps | **جدولان لـ price alerts**: `user_stock_watchlists.alert_price_above/below/change_percent` (يُكتب من `/api/alerts/create`) + جدول منفصل `price_alerts` (يُكتب من `/api/alerts/quick-add`). كلاهما يخزّن نفس المفهوم (تنبيه سعر لسهم) لكن بـ schemas مختلفة. alert-engine.ts scheduler يقرأ من `user_stock_watchlists` فقط — إذن alerts المُنشأة عبر `/api/alerts/quick-add` (الجدول `price_alerts`) **لا يتم رصدها أبدًا** من scheduler. | **HIGH-MEDIUM** — quick-add alerts silently lost | `src/app/api/alerts/quick-add/route.ts:41-58` (CREATE price_alerts) vs `src/lib/schedulers/alert-engine.ts:274-301` (reads user_stock_watchlists only) |
| 8 | Data overlaps | **4 طبقات caching منفصلة** لبيانات stocks: (1) `cache-manager.ts` (PK3 SSOT, 60s TTL, 512 max LRU) يُستخدم من 5 routes فقط؛ (2) `data-adapter.ts:73` (`stockCache` + `historicalCache` Maps منفصلة)؛ (3) `egxpy-bridge.ts:31` (`cache` Map منفصل)؛ (4) `multi-source-adapter.ts:150` (`cache` Map منفصل). 3 من 4 layers لم تُهاجر إلى الـ SSOT رغم وجوده. | **MEDIUM** — divergent TTLs (2/3/5/60s); stale-data risk | `src/lib/cache-manager.ts:1-25` (SSOT) + `src/lib/data-adapter.ts:73-104` + `src/lib/egxpy-bridge.ts:28-57` + `src/lib/multi-source-adapter.ts:144-171` |
| 9 | API overlaps | **3 proxy catch-all routes** لنفس Python backend: `/api/proxy/[...path]` (199 LOC, canonical + auth), `/api/python/[...path]` (70 LOC, re-exports `proxyRequest` من الأول + special-case لـ v4/stats), `/api/proxy-prod/[...path]` (259 LOC, proxy إلى production server). لا يوجد frontend caller يستخدم `/api/proxy/` مباشرة (rg = 0 matches)؛ كلهم يستخدمون `/api/python/`. إذن `/api/proxy/` هو canonical لكنه غير مُستدعى مباشرة، و`/api/python/` هو الـ de-facto entry. كذلك `/api/telegram/[...path]` (124 LOC) + 3 specific routes (`/api/telegram/post`, `/api/telegram/send-daily-report`, `/api/telegram/publish-stock`) كلها proxies إلى Python. | **MEDIUM** — 6 proxy routes for one Python backend | `src/app/api/proxy/[...path]/route.ts` + `src/app/api/python/[...path]/route.ts:29` (imports proxyRequest from proxy) + `src/app/api/proxy-prod/[...path]/route.ts:42` + `src/app/api/telegram/[...path]/route.ts` + 3 specific telegram routes |
| 10 | Service overlaps | **WebSocket (port 3005) + REST polling يعملان بالتوازي** لنفس الـ live updates: `useRealtimeUpdates()` hook (ws-client.ts) يُستخدم من 3 components (RealtimeTicker, MakerRadarTab, MultiMarketRadarTab). لكن `LiveMonitor.tsx:1163` ما زال يُpoll `/api/live-monitor` كل 1000ms، و`CentralAlertMonitor.tsx:239` يُpoll `/api/sniper/scan` كل `POLL_INTERVAL_MS`. إذن لنفس هدف "live updates" نُشغّل socket.io + HTTP polling معًا — مضاعفة load على الـ server + احتمال تضارب البيانات (snapshot من polling ≠ snapshot من WS). | **MEDIUM** — double data path; inconsistent timestamps | `src/lib/ws-client.ts:124` (io + path /socket.io/) + `src/modules/dashboard/components/LiveMonitor.tsx:1163` (setInterval 1000ms) + `src/components/notifications/CentralAlertMonitor.tsx:239` (setInterval POLL_INTERVAL_MS) |
| 11 | API overlaps | **5+ routes للأخبار** كلها proxies إلى Python بنفس fallback chain: `/api/news`, `/api/news/latest`, `/api/news-feed`, `/api/mobile/news`, `/api/egxpilot/news`. الأول والثاني يستخدمان `/api/news/agent` كـ fallback، الثالث يستخدم `/api/news-feed` مع `/api/news` fallback، الرابع يستخدم `/api/mobile/news` مع `/api/news` fallback. كلهم return نفس الـ news items بشكل مختلف. كذلك `news-agent` service (PM2 #7) comment في ecosystem.config.js:39 يقول إنه POST إلى `/api/news/receive-from-news-agent` — **لكن هذا الـ route غير موجود** في `src/app/api/`. | **MEDIUM** — news-agent posts to non-existent endpoint; 5 redundant routes | `src/app/api/news/route.ts:146-153` + `news/latest/route.ts:71-75` + `news-feed/route.ts` + `mobile/news/route.ts` + `egxpilot/news/route.ts` (returns empty); ecosystem.config.js:39 references missing route |
| 12 | API overlaps | **3 routes لتوصية الخبراء** مع storage مزدوج: `/api/recommendations/expert` (pure proxy إلى Python) + `/api/expert-recommendations` (يقرأ من stocks.db مباشرة — Rule 4 violation) + `/api/expert-recommendations/batch` + `/api/expert-recommendations/import` + `/api/mobile/recommendations` (يقرأ من SQLite مع fallback). النتيجة: نفس الدلالة (expert recommendations) بـ 3 storage paths مختلفة (Python canonical / stocks.db / SQLite fallback). | **MEDIUM** — data drift between Python and SQLite caches | `src/app/api/recommendations/expert/route.ts` (Python) + `src/app/api/expert-recommendations/route.ts:5` (SQLite: "يقرأ البيانات من stocks.db فقط") + `src/app/api/mobile/recommendations/route.ts` (SQLite fallback) |

### 3.4 التداخل البسيط (يؤثر على الصيانة)

| # | النوع | الوصف | الأثر | الدليل |
|---|---|---|---|---|
| 13 | UI overlaps | **3 cases في page.tsx switch غير موجودين في VALID_VIEWS** — deep-link hashلهم يُرجِع dashboard (لأن `VALID_VIEWS_SET.has(hash)` يفشل): `prediction-credibility`, `prediction-performance`, `stock-detail`. الـ cases موجودة في page.tsx:511,540,541 كـ alias إلى `<StocksView />` أو رسالة "admin-only"، لكن hash مثل `#stock-detail` لا يُفعّل الـ case (يقع في default → `<DashboardView />`). | **LOW** — dead routes; silent redirect to dashboard | `src/app/page.tsx:511,540,541` vs `src/lib/valid-views.ts:16-47` (VALID_VIEWS array doesn't include these 3) |
| 14 | Naming overlaps | **`ShareButton.tsx` مكرّر** في مكانين: `src/components/share/ShareButton.tsx` (يستورد OFFICIAL_LINKS من publishing/lib) و`src/modules/publishing/components/ShareButton.tsx` (يستورد Facebook/Send/MessageCircle/Download icons). الأول مستخدم من 7 callers (StockDetail, StocksView, DeepAnalysis, SimulationView, DashboardView, AIAnalysisWidget, StockAdvancedAnalysisView). الثاني مستخدم داخليًا فقط من publishing module — overlap في الاسم مع اختلاف في الـ API. | **LOW** — confusing; import path matters | `src/components/share/ShareButton.tsx` (7 callers) vs `src/modules/publishing/components/ShareButton.tsx` (used by TradeResultsGenerator inside publishing module) |
| 15 | Config overlaps | **تعليقات stale في proxy-server.js** تشير إلى `next.config.mjs` (الذي **لا وجود له** — يوجد فقط `next.config.ts`). proxy-server.js:7 says: "standalone output is disabled in next.config.mjs" — هذا تعليق قديم قبل تغيير الامتداد إلى `.ts`. لا يضر الوظيفة لكنه يضلّل المُطوّر. | **LOW** — documentation drift | `proxy-server.js:7` references `next.config.mjs` vs actual `next.config.ts` (only `.ts` exists in project root) |
| 16 | Data overlaps | **`prisma/auth-schema.prisma:240` model `Watchlist`** (Postgres، auth.db) مقابل **`stocks.db.user_stock_watchlists`** (SQLite). الـ Prisma model Watchlist (auth-schema) غير مستخدَم من أي route فعلي (rg في src/app/api: لا caller). كل الـ watchlist routes تقرأ من SQLite فقط. Prisma model يبدو legacy migration لم تُكتمل. | **LOW-MEDIUM** — dead Prisma model; schema drift | `prisma/auth-schema.prisma:240` (model Watchlist) vs `src/app/api/watchlist/route.ts:86` (uses SQLite user_stock_watchlists) — `rg "db\.watchlist\|prisma.*[Ww]atchlist" src/app/api` returns 0 callers |

### 3.5 توصيات التوحيد (مرتبة حسب الأولوية)

1. **[P0] إصلاح `admin/layout.tsx` localhost bypass** — استبدل الأسطر 31-40 بـ `requireAdminAsync()` (من `@/lib/admin-auth-server`) ليكون نفس صلاحيات API guard. حاليًا: صفحات admin HTML تُعرض في sandbox بدون auth بينما API calls ترفض → split-brain. الفرق بين `ALLOW_ADMIN_BYPASS=true` (env var) و`host.startsWith('localhost')` (header spoofable) هو ثغرة أمنية.

2. **[P0] توحيد 23 route stub من `marketPulseProxy`** — إمّا تنفيذ الـ function الفعلية لكل route، أو إزالة الـ routes غير المستخدمة، أو إعادة تسميتها بوضوح كـ `/api/market-pulse/<alias-name>` مع 308 redirect. المُطوّر وثّق القصد ("Task P1-CLEANUP") لكنه ترك الـ misnaming. يجب على الأقل إضافة 308 redirects من الأسماء المضلّلة إلى `/api/market-pulse` لتوضيح أن البيانات هي نفسها.

3. **[P0] توحيد `price_alerts` و`user_stock_watchlists`** في schema واحد — إمّا ترحيل `/api/alerts/quick-add` إلى الكتابة في `user_stock_watchlists`، أو توسيع `alert-engine.ts:274` ليقرأ من `price_alerts` أيضًا. حاليًا الـ quick-add alerts تُكتب لكن لا تُرصد أبدًا (silent data loss).

4. **[P1] إصلاح `#screener` و`#stock-detail` في page.tsx** — `#screener` يجب أن يُرجِع `<StockScreenerAdvancedView />` (مثل `#stock-filters`) أو يُحذف مع 308 redirect. `#stock-detail` يجب إضافته إلى VALID_VIEWS أو حذف case. حاليًا `#screener` يعرض trading chart بدلاً من screener — bug وظيفي.

5. **[P1] توحيد 5 watchlist routes** في route واحد مع query parameter (مثل `/api/watchlist?shape=canonical|enhanced|mobile|crypto`). يقلّل 1229 LOC إلى ~300 LOC ويلغي 4 نسخ SQL مكررة. أو على الأقل: اجعل 4 من الـ 5 routes تستدعي `proxyToPython('/api/watchlist')` مثل `portfolio/unified-watch`.

6. **[P1] دمج 4 طبقات cache** في `cache-manager.ts` (الـ SSOT الموجود بالفعل). ابحث عن `const cache = new Map` في data-adapter.ts:73 + egxpy-bridge.ts:31 + multi-source-adapter.ts:150 واستبدلها بـ `import { cache } from '@/lib/cache-manager'`. الـ SSOT موجود لكنه غير مُستخدم في 3 من 4 طبقات.

7. **[P1] إزالة alias الشاشات الأربعة** (`#recommendations`, `#analysis`, `#advanced-analysis`, `#v2-analysis`) إلى canonical واحد (`#recommendations`) مع 308 redirects في middleware. كذلك `#crypto-recommendations`. هذا يقلّل الـ menu confusion ويبسّط tracking.

8. **[P2] دمج 5+ news routes** في `/api/news?shape=canonical|latest|feed|mobile|egxpilot` مع توحيد fallback chain. كذلك: إضافة `/api/news/receive-from-news-agent` route (مفقود) أو تحديث comment في `ecosystem.config.js:39` ليعكس الـ endpoint الصحيح.

9. **[P2] إنهاء WebSocket vs polling** — إمّا إيقاف `LiveMonitor.tsx:1163` polling (وإجباره على `useRealtimeUpdates()`)، أو إيقاف WS service لو الـ polling هو الـ canonical. حاليًا الاثنان يعملان معًا → double load + احتمال تضارب timestamps.

10. **[P2] توحيد 3 admin auth modules** (`admin-auth.ts` للـ client + `admin-auth-server.ts` للـ server + `admin-guard.ts` re-exports + `admin-identities.ts` للـ emails) في ملف واحد إن أمكن، أو توثيق تقسيم العمل بوضوح في README. حاليًا 4 ملفات لـ auth واحد مع 8 exports متشابهة الاسم (`isAdmin`, `isClientAdmin`, `isServerAdmin`, `requireAdmin`, `requireAdminAsync`, `verifyAdminRequest`, `verifyAdminCredentials`, `verifyAdminToken`).

11. **[P2] توحيد 3 expert-recommendations routes** — اختيار canonical واحد (يفضّل `/api/recommendations/expert` Python proxy) وجعل الباقي 308 redirect إليه. إزالة `/api/expert-recommendations` SQLite-direct path.

12. **[P3] إزالة Prisma `Watchlist` model** من `auth-schema.prisma:240` (لا caller)، أو توثيق أنه legacy.

13. **[P3] تحديث تعليقات proxy-server.js** لتشير إلى `next.config.ts` بدلاً من `next.config.mjs`.

14. **[P3] دمج `ShareButton.tsx` المكرّر** في مكان واحد (يفضّل `src/components/share/`) وإزالة النسخة الثانية من `src/modules/publishing/components/`، أو إعادة تسميتها (مثل `PublishingShareButton`).

---

## <a name="audit-d"></a>4. AUDIT-D — التعدد والازدواجية

### 4.1 ملخص تنفيذي
- حالات الازدواجية الحرجة: **4** (تؤثر على الصيانة + الأداء + اتساق البيانات)
- حالات التعدد الوظيفي (مبررة): **5** أنظمة منفصلة بمسؤوليات مختلفة (Auth / Subscription / News / Prisma / Mini-services)
- توصيات الدمج: **4** توصيات ذات أولوية (P1) + **5** (P2) + **3** (P3)
- نطاق الفحص: 360 مسار API + 366 سكربت + 126 محلل Python + 4 خدمات مصغرة + 4 pine scripts + 3 schemas

### 4.2 الازدواجية الحرجة (تؤثر على الصيانة والأداء)

| الوظيفة | المواقع المتعددة | التوصية |
|---|---|---|
| **Watchlist** (نفس الجدول `user_stock_watchlists`) | 4 مسارات تقرأ نفس الجدول: `/api/watchlist` + `/api/watchlist-enhanced` (يضيف live prices) + `/api/mobile/watchlist` (شكل mobile) + `/api/portfolio/watchlists` (مع Python fallback) — زائد `/api/portfolio/unified-watch` (proxy Python بحت) + `/api/finance/smart-watchlist` (جدول مختلف `portfolio_assets`) | **P1**: دمج في `/api/watchlist` واحد مع flag `?enrich=live\|full\|mobile`. حذف 3 مسارات مكررة |
| **قراءة سعر السهم** (6 مسارات متوازية رغم وجود canonical-price.ts) | `egx-db.ts` + `data-engine-db.ts` + `market-data-access.ts` + `egxpy-bridge.ts` + `multi-source-adapter.ts` + `unified-stock-data.ts` — ALL still imported by various routes. canonical-price.ts يعترف بوجودها كـ SSOT لكن لم يُكمل الترحيل | **P1**: إكمال الترحيل لـ canonical-price.ts + حذف الـ 6 مكتبات القديمة بعد التأكد من عدم وجود استيراد |
| **4 محركات معطّلة لكنها موصلة في UI/TS** | `v82_analyzer.py` (SUB_ENGINE_DISABLED=True) لكن `/api/v82/route.ts` + `V82DecisionPanel.tsx` + `case 'v82'` في page.tsx لا يزال يعمل. نفس النمط لـ `sniper_engine.py` (`/api/sniper/*` × 3) + `confluence_engine_v3.py` (لا يستورد) + `board_of_analysts.py` (لا يستورد) | **P1**: حذف الـ 4 محركات المعطّلة + مسارات TS المقابلة + مكونات UI. القاعدة 73 (SINGLE-DISPLAY-SOURCE) تنص صراحةً على أن canonical signal يأتي من master_analyzer.py فقط |
| **Scrapers مكررة بين خدمتين** | `vps-service/data/` يحوي: `egksco_scraper.py`, `crypto_fetcher.py`, `egx_fetcher.py`, `egx_fundamental_fetcher.py`, `eodhd_fetcher.py`, `stock_logo_scraper.py` — بينما `data_engine/scrapers/` يحوي: `egksco_scraper.py`, `crypto_fetcher.py`, `egxpilot_scraper.py`, `tradingview_scraper.py`, إلخ. كلاهما يكتب في نفس `db/data_engine.db` | **P1**: تحديد مصدر واحد. data_engine = data factory (canonical للـ scrapers)؛ vps-service/data/ = readers فقط. حذف الـ 6 scrapers المكررة من vps-service/data/ |

### 4.3 تعدد المسارات لنفس البيانات

| البيانات | المسارات المتعددة | التوصية |
|---|---|---|
| **Portfolio holdings** | `/api/portfolio/holdings` (read+enrich+PY fallback, جدول `portfolio_assets`) + `/api/finance/assets` (CRUD كامل، نفس الجدول) | **P2**: توحيد — `/api/finance/assets` للـ CRUD + `/api/portfolio/holdings` كـ subset للقراءة فقط مع flag اختياري للـ enrichment، أو دمج كامل |
| **News (شكل مختلف لكل مسار)** | `/api/news` (canonical, Python proxy) + `/api/news/latest` (lightweight) + `/api/news-feed` (multi-source) + `/api/egxpilot/news` (**STUB 53 سطر يرجع empty news — dead code**) + `/api/admin/news` (CRUD مباشر SQLite للـ admin) + `/api/mobile/news` (شكل mobile) + `/api/stocks/[ticker]/news` (لكل سهم) | **P2**: حذف `/api/egxpilot/news` (stub ميت)؛ توحيد `/api/news` + `/api/news/latest` عبر flag `?lite=true`؛ توحيد `/api/mobile/news` ليصبح `/api/news?shape=mobile` |
| **Mobile notifications vs Web notifications** | `/api/notifications` (CRUD للويب) + `/api/mobile/notifications` (comment in code يقول صراحةً "unified with web `/api/notifications`") | **P2**: حذف `/api/mobile/notifications` — تم التوحيد بالفعل، النسخة mobile زائدة |
| **Predictions** | `/api/predictions` (canonical) + `/api/predictions/tracking/*` (4 sub-routes) + `/api/predictions/honest-tracking/*` (6 sub-routes) + `/api/crypto-predictions` (وصول مباشر SQLite — مخالفة Rule 20) + `/api/global-predictions` (Python proxy) + `/api/unified/predictions` (Python proxy) + `/api/v4/stats` (Python proxy) | **P2**: دمج `/api/crypto-predictions` مع `/api/predictions?market=CRYPTO` (حذف الوصول المباشر لـ SQLite)؛ مراجعة تداخل `/api/v4/stats` مع `/api/predictions/honest-tracking/stats` و `/api/predictions/performance-dashboard` |
| **Subscribe 1-line proxy** | `/api/subscribe/[plan]` هو proxy سطر واحد إلى `/api/market-pulse` (تعليق يقول "kept for backward compat") | **P2**: حذف بعد تأكيد عدم وجود مستدعين في الـ frontend |
| **Stock price history** | `/api/stocks/[ticker]/history` (Python proxy canonical) + `/api/data-engine/stocks` (direct read) + `/api/unified-stocks` (Python proxy) + 6 libs متوازية في `src/lib/*` (انظر الجدول السابق) | **P1/P2**: إكمال ترحيل canonical-price.ts + توحيد المسارات المباشرة على Python proxy فقط |

### 4.4 الـ views ذات المسؤوليات المتعددة (مخاطر صيانة)

| View | عدد الأسطر | المهام المتعددة | التوصية |
|---|---|---|---|
| `page.tsx` | **1085** | switch بـ **59 case** لمسارات العرض — router/dispatcher ضخم. كل case يحمل view عبر dynamic import (لا منطق عمل، لكن 59 case كثيرة) | **P3**: تحويل إلى config-driven router — Map<viewId, lazy()> بـ 50 سطر بدل 1085 |
| `AdminView.tsx` | **2097** | **31 activeTab === 'X'** block عبر **6 hubs** (health/maestro/learning/data/users/telegram). كل tab يحمّل component منفصل (جيد) لكن الملف نفسه ضخم | **P3**: تقسيم إلى 6 hub-components (`HealthHub`, `MaestroHub`, …) كل واحد بـ ~350 سطر بدل 2097 |
| `SubscriptionView.tsx` | **1791** | pricing comparison + Paymob flow + Instapay modal + promo codes + B2B pricing + telegram info | **P3**: استخراج `PaymobCheckoutModal` + `PromoCodeInput` + `B2BSignupForm` + `TelegramLinkCard` كمكونات مستقلة (PricingView.tsx موجود بالفعل كمكوّن منفصل) |
| `AuthView.tsx` | **650** (وليس ~1500 كما في الـ spec) | Tabs (login/register) + Google OAuth button + promo code UI + DevLoginForm reference | **منخفض**: تقسيم PromoCode إلى مكون منفصل (`PromoCodeSection.tsx`)؛ الباقي مقبول لأنه متماسك (auth only) |
| `DashboardView.tsx` | **600** (وليس 601) | 6 widgets فقط في WidgetDescriptor registry (تم نقل 4 widgets لشاشات منفصلة بالفعل) | **منخفض**: معمارية جيدة (registry + PinnableWidget + SafeWidget). لا تشريح ضروري |
| `AdminView` sub-tabs | — | كل tab من الـ 31 يحمّل component مستقل (مثل `NewsManagementTab`, `EngineControlRoomTab`, `PromoCodesAdmin` …) — هذه مكونات مستقلة أصلاً (جيد) | يحتاج فقط تقسيم الـ router في AdminView نفسه (انظر P3 أعلاه) |

### 4.5 تعدد الـ engines / scripts

| Engine | الحالة | مستخدم؟ | التوصية |
|---|---|---|---|
| **core_scoring_engine.py** (V40.2) | نشط — THE BRAIN | ✅ نعم — مستورد في `master_analyzer.py`, `unified_v2_routes.py`, `scanner_routes.py`, `chart_routes.py` | الاحتفاظ به (canonical) |
| **master_analyzer.py** | نشط — الدمج الموحد | ✅ نعم — referenced via `from analyzers import master_analyzer` في `misc_routes.py` | الاحتفاظ به (THE BRAIN) |
| **v68_oracle.py** | نشط — supplements V40.2 بـ probability/fingerprint | ✅ نعم — مستورد في `unified_analysis.py` + `daily_predictor.py` | الاحتفاظ به (sub-component، ليس منافساً) |
| **v82_analyzer.py** | **SUB_ENGINE_DISABLED = True** (line 58) — short-circuits to disabled signal | ❌ معطّل، لكن `/api/v82/route.ts` + `V82DecisionPanel.tsx` + `case 'v82'` في page.tsx لا يزال موصلاً | **P1 حذف**: الموت بالكامل + UI + TS endpoint |
| **sniper_engine.py** | **SUB_ENGINE_DISABLED = True** (line 95) | ❌ معطّل، لكن `/api/sniper/scan`, `/api/sniper/track`, `/api/sniper/backtest` + sniper_routes.py في Python لا تزال موصلة | **P1 حذف**: الموت بالكامل + 3 TS endpoints + Python routes |
| **confluence_engine_v3.py** | **SUB_ENGINE_DISABLED = True** (line 40) | ❌ معطّل، لا تستورد بأي API route | **P1 حذف**: ميت تماماً |
| **board_of_analysts.py** | **SUB_ENGINE_DISABLED = True** (line 29) | ❌ معطّل، لا تستورد بأي API route | **P1 حذف**: ميت تماماً |
| **V55_Money_Flow.pine** | مرجع توثيقي فقط (لا يُنفّذ) | 📚 مرجعي — مستخدم كـ inspiration في master_analyzer + 3 TS files | الاحتفاظ به في `data/pine_scripts/` كأرشيف (لا حذف) |
| **V76_Golden_Hunter.pine** | مرجع توثيقي فقط | 📚 مرجعي — referenced as `v76_golden_retest` string في master_analyzer | الاحتفاظ به كأرشيف |
| **V60.2_Who_Is_Buying.pine** | مرجع توثيقي فقط | 📚 مرجعي — مستورد في master_analyzer (`EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine lines 670-760`) | الاحتفاظ به كأرشيف |
| **V82_Ultimate_EGX_Engine.pine** | مرجع توثيقي فقط — لكن V82_analyzer.py معطّل | 📚 مرجعي + 💀 مرتبط بمحرك معطّل | **P1**: حذف الـ pine مع الـ analyzer المعطّل |
| `scripts/` folder (366 ملف) | 13 audit + 8 backfill + 8 backtest + 22 clean + 11 check + 34 fix + 14 sync = 110 categorized + ~256 one-off | 📝 معظمها one-off maintenance scripts | **P3**: نقل كل ما يزيد عن 90 يوم إلى `scripts/archive/`؛ سياسة "use it or lose it" |

**عدد المحركات النشطة فعلياً**: 39 analyzer مستوردة في API routes (من أصل 126 ملف .py في analyzers/). 87 ملفاً قد تكون transitively imported أو dead — تحتاج audit منفصل.

### 4.6 توصيات التوحيد (مرتبة حسب الأولوية)

#### 🔴 P1 — حرج (تأثير مباشر على اتساق البيانات + الصيانة)
1. **Watchlist consolidation**: دمج 4 مسارات في واحد `/api/watchlist` مع `?enrich=live|full|mobile` flag. حذف `/api/watchlist-enhanced`, `/api/mobile/watchlist`, `/api/portfolio/watchlists`.
2. **Complete canonical-price.ts migration**: التحقق من عدم وجود مستوردين للـ 6 libs القديمة (egx-db, data-engine-db, market-data-access, egxpy-bridge, multi-source-adapter, unified-stock-data) في المسارات الحرجة → حذفها تدريجياً.
3. **Delete 4 disabled engines + their TS endpoints + UI**: `v82_analyzer.py` + `sniper_engine.py` + `confluence_engine_v3.py` + `board_of_analysts.py` + `/api/v82/*` + `/api/sniper/*` + `V82DecisionPanel.tsx` + `case 'v82'` + `case 'sniper-*'` في page.tsx + valid-views.ts entries.
4. **De-duplicate scrapers between services**: حذف الـ 6 scrapers المكررة في `vps-service/data/` — جعل `data_engine/scrapers/` هو المصدر الوحيد للـ data factory.

#### 🟠 P2 — عالي (تنظيف مسارات ميتة + توحيد الأشكال)
5. **حذف `/api/egxpilot/news`** (stub 53 سطر يرجع empty news — مخالفة Rule 27).
6. **حذف `/api/mobile/notifications`** — تم توحيده مع `/api/notifications`.
7. **حذف `/api/subscribe/[plan]`** — proxy سطر واحد لـ `/api/market-pulse`.
8. **Portfolio/Finance overlap**: مراجعة `/api/portfolio/holdings` vs `/api/finance/assets`.
9. **Cache TTL unification**: توحيد TTLs في `cache-manager.ts` فقط.
10. **`/api/crypto-predictions` direct SQLite removal**: تحويل إلى Python proxy.

#### 🟡 P3 — متوسط (تحسينات معمارية)
11. **تقسيم `AdminView.tsx` (2097 سطر)** إلى 6 hub-components.
12. **تحويل `page.tsx` switch (59 case)** إلى config-driven router.
13. **تقسيم `SubscriptionView.tsx` (1791 سطر)**.
14. **سياسة أرشفة `scripts/`**: نقل كل سكربت لم يُستخدم خلال 90 يوم.
15. **مراجعة 87 analyzer file** في vps-service/analyzers/.

#### ✅ مبرر (لا يحتاج توحيد — تعدد مقصود)
- **Auth 4 أنظمة** — جمهور/متطلبات أمنية مختلفة.
- **Subscription 5 قنوات** — كل منصة دفع لها flow منفصل.
- **News 5+ endpoints** — جمهور مختلف.
- **3 Prisma schemas** — فصل صحي للـ concerns.
- **4 mini-services** — مسؤوليات مختلفة.

---

## <a name="audit-e"></a>5. AUDIT-E — الأسس الهندسية

### 5.1 ملخص تنفيذي

| البُعد | الدرجة | أبرز ما يحكم الدرجة |
|---|---:|---|
| البنية المعمارية | **5/10** | 3-tier واضح من حيث المبدأ، لكن `proxy-server.js` يتعارض مع `ecosystem.config.js` على port 3000 + 6 Map caches متفرقة بدلاً من cache-manager SSOT |
| الأداء | **4/10** | lazy loading محترَم في page.tsx، لكن WebSocket Polling كل 2s لكل ticker + ESLint مُعطّل يُخفي anti-patterns |
| الأمان (أساسيات) | **4/10** | NextAuth cookies + better-sqlite3 prepared statements + rate-limiter module موجودة، لكن **Caddyfile لا يفرض HTTPS على :443** → secure cookies معطّلة فعلياً + rate-limit على 4 routes فقط من 463 |
| قابلية الصيانة | **4/10** | TypeScript strict mode لكن `noImplicitAny:false` + ESLint rules كلها "off" + 41 test file على 583,991 LOC = 0.00007 tests/LOC |
| قابلية النشر | **6/10** | PM2 ecosystem ممتاز 7 apps + .env loader + health endpoint عميق، لكن 3 npm scripts مكسورة + لا graceful shutdown في Next.js + لا .env.example |
| المراقبة | **5/10** | logger JSON + Sentry client/server + health endpoint، لكن Sentry يحتاج SENTRY_DSN يدوي + لا metrics aggregation + لا winston/pino |
| **الدرجة الإجمالية** | **28/60** | ينتج عن بُعد تعطيل HTTPS+ESLint+scripts المكسورة |

### 5.2 البنية المعمارية

#### نقاط القوة
- **معمارية 7-tier موثّقة بوضوح** في `ecosystem.config.js:5-40` (python-backend 8010 + data-engine 5000 + nextjs 3000 + ws-service 3005 + telegram-poster + telegram-interactive-bot + telegram-events 3003 + news-agent). الفصل بين العرض (Node) والمنطق (Python) فعلي.
- **Python backend URL موحّد**: `src/lib/python-backend.ts:64` يُصدّر `PYTHON_BACKEND_URL` واحدًا (مع fallback `127.0.0.1:8010`) — يُستخدم في كل الـ routes تقريباً عبر `pythonFetch()`.
- **SPA hash routing مقبول للحالة الراهنة**: `src/app/page.tsx:309-500` يبني UrlHashSync مزدوج مع `popstate` + `hashchange` fallback.
- **3 Prisma schemas منفصلة**: `prisma/schema.prisma` + `prisma/auth-schema.prisma` + `prisma/predictions-schema.prisma`.

#### نقاط الضعف
- ❌ **تعارض port 3000 حرج**: `ecosystem.config.js:211` يبدأ Next.js على `args: 'start -p 3000'`، بينما `proxy-server.js:18-20` يفتح `PROXY_PORT=3000` ويرسل الديناميك إلى `NEXT_PORT=3001`. proxy-server.js غير مُسجّل في PM2 → في الإنتاج، فقط `nextjs` يعمل على 3000.
- ⚠️ **Prisma + better-sqlite3 معاً**: `@prisma/client:5.22.0` + `better-sqlite3:11.10.0` + `sql.js:1.14.1` (3 محركات SQLite).
- ⚠️ **6 Map-based caches منفصلة** بـ TTLs مختلفة: `multi-source-adapter.ts:150` + `data-engine-db.ts:93` + `egx-db.ts:117` + `market-profile.ts:451` + `unified-db.ts:48` + `shared-db.ts:23`.

### 5.3 الأداء

#### نقاط القوة
- ✅ **dynamic imports محترَم**: `src/app/page.tsx:51-100` كل الـ views ثقيلة تستخدم `dynamicImport(() => import(...), { ssr: false, loading: <LazyTabLoader /> })` + ملفوفة بـ `withErrorBoundary`.
- ✅ **Health endpoint caching**: `src/app/api/health/route.ts:47` 60s TTL cache.
- ✅ **WebSocket adaptive polling**: `ws-service/index.ts:55-74` يتكيّف مع EGX session.

#### نقاط الضعف
- ❌ **WebSocket polling يضاعف load**: `ws-service/index.ts:65` `SESSION_POLL_INTERVAL_MS = 2_000` → 30 fetches/min لـ `/api/stocks?market=EGX&limit=100` + `/api/market/status` + لكل ticker مشترك فيه `/api/stocks/{ticker}` + كل 5s `/api/live/analysis/{ticker}`.
- ⚠️ **DB connections تُفتح ولا تُغلق**: `src/lib/db-auth.ts:17-22` يُنشئ PrismaClient في `globalThis` ولا يستدعي `.close()` أبداً (grep على `process.on('SIGTERM'` في src/ = 0 hits).
- ⚠️ **ESLint مُعطّل يُخفي anti-patterns**: `eslint.config.mjs:7-43` كل الـ 22 rules = "off". الـ build script `next build --no-lint` (package.json:8) يلغي حتى الفحص الأساسي.

### 5.4 أكبر 10 ملفات في src/ (LOC) — تحتاج تقسيم

| # | الملف | الأسطر | التوصية |
|---:|---|---:|---|
| 1 | `src/modules/predictions/components/MakerRadarTab.tsx` | 3,764 | تقسيم إلى 4-5 sub-component |
| 2 | `src/modules/portfolio/components/EnhancedPortfolioView.tsx` | 3,477 | استخراج HoldingsTable + RiskPanel + EquityCurveChart + AccountSwitcher |
| 3 | `src/modules/admin/components/DatabaseManagerFull.tsx` | 3,291 | تقسيم حسب DB |
| 4 | `src/components/advanced-analysis/SpecialistAnalysisView.tsx` | 2,971 | استخراج 6 analyst cards |
| 5 | `src/modules/screener/components/StockScreenerAdvanced.tsx` | 2,707 | استخراج FilterPanel + ResultsTable + PresetsManager |
| 6 | `src/components/shared/UnifiedTable.tsx` | 2,601 | تقسيم إلى TableCore + TableSort + TableFilter + TablePagination |
| 7 | `src/modules/education/components/LearningVisuals.tsx` | 2,583 | استخراج 5-6 visuals مستقلة |
| 8 | `src/modules/admin/components/SuperLearningSystem.tsx` | 2,489 | استخراج TrainingPanel + MetricsPanel + ModelComparison |
| 9 | `src/modules/education/components/AcademyView.tsx` | 2,483 | تقسيم حسب الـ lesson types |
| 10 | `src/modules/admin/components/EngineControlRoomTab.tsx` | 2,481 | استخراج EngineStatusGrid + EngineControls + EngineLogs |

**إجمالي LOC**: src/ = **292,925** سطر. vps-service/ = **291,066** سطر. **الإجمالي: 583,991 LOC**.

### 5.5 التبعيات

| Dependency | الإصدار | مستخدم؟ | ملاحظة |
|---|---|:---:|---|
| `@mdxeditor/editor` | `^3.39.1` | ❌ لا | 0 imports في src/ |
| `@xyflow/react` | `^12.11.1` | ❌ لا | 0 imports |
| `@reactuses/core` | `^6.0.5` | ❌ لا | 0 imports |
| `react-markdown` | `^10.1.0` | ❌ لا | 0 imports |
| `next-intl` | `^4.3.4` | ❌ لا | `layout.tsx:50` يصرّح "no next-intl plugin needed" |
| `react-syntax-highlighter` | `^15.6.1` | ❌ لا | 0 imports |
| `node-gyp` | `^13.0.1` | ❌ لا | 0 imports |
| `tailwindcss-animate` | `^1.0.7` | ⚠️ build-time only | يجب أن يكون في devDependencies |
| `next` | `14.2.28` | ✅ نعم | Next 15 متاح |
| `next-auth` | `^4.24.11` | ✅ نعم | v5 متاح (Auth.js) |
| `react` | `^18.2.0` | ✅ نعم | React 19 متاح |
| `prisma` | `5.22.0` | ✅ نعم | Prisma 6 متاح |
| `better-sqlite3` | `^11.10.0` | ✅ نعم | محرك SQLite الأساسي |
| `@sentry/nextjs` | `^11.0.0` | ✅ نعم | يعمل إذا SENTRY_DSN مُعيّن |
| `eslint-config-next` | `15.3.3` | ⚠️ mismatch | Next.js runtime هو 14.2.28، لكن eslint-config هو 15.3.3 |

### 5.6 مخاطر هندسية حرجة (مرتبة)

1. **🔴 Caddyfile لا يفرض HTTPS** (`Caddyfile:1` يستمع على `:81` فقط) → NextAuth secure cookies معطّلة فعلياً → session token يُنقل clear-text.
2. **🔴 ESLint rules كلها "off"** (`eslint.config.mjs:7-43`) + `next build --no-lint` (package.json:8).
3. **🔴 6 npm dependencies غير مستخدمة** → inflate bundle + attack surface + slower install.
4. **🔴 3 npm scripts مكسورة** (`check:guards` + `data:fill-missing`).
5. **🟡 تعارض port 3000** بين `ecosystem.config.js:211` و`proxy-server.js:18-20`.
6. **🟡 لا graceful shutdown في Next.js** (0 hits لـ `process.on('SIGTERM'` في src/).
7. **🟡 WebSocket polling كل 2s لكل ticker** (`ws-service/index.ts:65`).
8. **🟡 rate-limit على 4 routes فقط من 463**.
9. **🟢 6 Map-based caches متفرقة**.
10. **🟢 No .env.example**.

---

## <a name="audit-f"></a>6. AUDIT-F — قواعد البيانات + APIs

### 6.1 ملخص تنفيذي
- **عدد DBs الفعلية**: 3 فقط في `/db/` (auth.db 288KB + predictions.db 216KB + custom.db 24KB) — لكن الكود يذكر 7 DBs، فـ 4 مفقودة على الساندبوكس (stocks.db / data_engine.db / price_history.db / intraday.db) — مُوثّقة كـ `SHARED_DB_NAMES` في `src/lib/shared-db.ts:25` و `vps-service/config.py:43`.
- **عدد Prisma models**: 30 (default 2 + auth 18 + predictions 10) — 14 نشطة عبر Prisma + raw SQL، 6 Prisma-dead لكن raw SQL حي، 6 dead فعلياً، 1 type ميت (AiPrediction).
- **عدد routes تستخدم better-sqlite3 مباشرة**: 91 ملف (89 في `src/` + 2 test).
- **SQL injection risks**: 0 مؤكد — كل 22 ملف فيها template-string queries تستخدم hardcoded expressions أو whitelist-controlled identifiers أو bound `?` placeholders.
- **نسبة الالتزام بـ unified API contract**: 3% فقط (14/463 route يستخدمون `apiOk/apiErr/wrapHandler` من `src/lib/api-response.ts`).
- **CRITICAL**: Rule 81 violation ثاني مؤكد في `db-backup/route.ts:579` (`git push --force` مباشر) + `:654` (`auto_git_sync.py` → --force-with-lease).

### 6.2 جرد DBs

| DB | المسار | الحجم | مستخدم؟ | الجداول المعروفة (من Prisma) |
|---|---|---|---|---|
| auth.db | `/db/auth.db` | 288 KB | ✅ نعم (85+ refs) | User, Account, Session, SubscriptionPlan, UserSubscription, ApiToken, UserTelegramLink, Watchlist, PortfolioItem, PortfolioHistory, MarketPricing, Referral, UsageDaily, B2bApiKey, AdvancedAnalysisResult, DailyAnalysisSummary, PromoCode, VerificationToken (18) |
| predictions.db | `/db/predictions.db` | 216 KB | ✅ نعم (12+ Prisma + 14 raw SQL refs) | Prediction, PersonaPrediction, PredictionLog, ExpertRecommendation, ExpertTrackRecord, CachedAnalysis, StoredAnalysis, AnalysisJob, AnalysisEngineStatus, TechnicalIndicator (10) |
| custom.db | `/db/custom.db` | 24 KB | ❓ منخفض — referenced في custom أدمن فقط | unknown (Prisma لا يُديره) |
| **stocks.db** | غير موجود | — | ⚠️ referenced في 30+ ملف | stocks, stock_daily_prices, ExpertRecommendation, prediction_logs, market_news |
| **data_engine.db** | غير موجود | — | ⚠️ referenced في 25+ ملف | stocks, egksco_price_history, gold_prices, silver_prices, crypto_prices, exchange_rates, market_news, news_signals, sharia_metrics |
| **price_history.db** | غير موجود | — | ⚠️ getPriceHistoryDb redirects إلى stocks.db (`egx-db.ts:198`) | (deprecated — now routed) |
| **intraday.db** | غير موجود | — | ⚠️ referenced في `intraday-flow.ts:5` + live-monitor | stock_intraday, intraday_prices |

### 6.3 تحليل Prisma Schemas

#### `schema.prisma` (default — 2 models)
- **User**: ⚠️ مُتجاوز بواسطة `auth-schema.prisma` User (المُستخدم فعلياً عبر `authDb`).
- **Post**: ❌ ميت مؤكد (AUDIT-B).

#### `auth-schema.prisma` (18 models)

| Model | نشط؟ | المستدعون | ملاحظة |
|---|---|---|---|
| User | ✅ 85 refs | authDb.user.findUnique/findFirst/findMany/count/update | أساسي |
| Account | ✅ 3 refs | authDb.account (NextAuth) | — |
| Session | ⚠️ 1 ref | authDb.session | منخفض جداً |
| VerificationToken | ✅ NextAuth manages | — | managed by NextAuth |
| SubscriptionPlan | ✅ 6 refs | authDb.subscriptionPlan.findMany | seed outdated (3 plans فقط بدل 6) |
| UserSubscription | ✅ 31 refs | authDb.userSubscription | — |
| ApiToken | ✅ 10 refs | authDb.apiToken | — |
| UserTelegramLink | ⚠️ Prisma 0 refs لكن raw SQL 4 refs (`bot-link-db.ts:196,227,232`) | مُستخدم عبر better-sqlite3 على نفس الجدول |
| AdvancedAnalysisResult | ✅ 5 refs | authDb.advancedAnalysisResult | — |
| DailyAnalysisSummary | ✅ 4 refs | authDb.dailyAnalysisSummary | — |
| PromoCode | ✅ 13 refs | authDb.promoCode | — |
| Watchlist | ⚠️ Prisma 1 ref (`radar-alerts.ts:1087`) لكن الـ engine الفعلي يقرأ `user_stock_watchlists` | شبه ميت — Prisma model مُهمّش لصالح raw SQL على table مختلفة |
| PortfolioItem | ⚠️ Prisma 7 refs لكن engine يقرأ `portfolio_assets` (`alert-engine.ts:478,483`, bag-holder-rescue) | شبه مُهمّش |
| PortfolioHistory | ❌ 0 refs (Prisma + raw SQL) | ميت |
| MarketPricing | ✅ 8 refs | authDb.marketPricing.findFirst/findMany | — |
| Referral | ❌ 0 refs (Prisma + raw SQL) | ميت |
| UsageDaily | ✅ 2 refs | authDb.usageDaily.findUnique/upsert | — |
| B2bApiKey | ⚠️ 1 ref | authDb.b2bApiKey.create | منخفض |

#### `predictions-schema.prisma` (10 models)

| Model | نشط؟ | المستدعون | ملاحظة |
|---|---|---|---|
| Prediction | ✅ 12 refs | predictionsDb.prediction.findMany | أساسي — 21 @@index |
| PersonaPrediction | ⚠️ Prisma 0 refs لكن raw SQL 14 refs | persona_predictions table | مُستخدم عبر better-sqlite3 |
| PredictionLog | ⚠️ Prisma 0 refs لكن raw SQL 6+ refs | prediction_logs table | مُستخدم عبر better-sqlite3 |
| ExpertRecommendation | ⚠️ Prisma 0 refs لكن raw SQL (`egx-db.ts:363` ALTER TABLE) | expert_recommendations table | مُستخدم عبر better-sqlite3 |
| ExpertTrackRecord | ❌ 0 refs (Prisma + raw SQL) | ميت |
| CachedAnalysis | ⚠️ Prisma 0 refs لكن raw SQL 3+ refs (`new-db-queries.ts:231`, admin/purge-cache:63,95) | cached_analysis table |
| StoredAnalysis | ⚠️ Prisma 0 refs لكن raw SQL 3+ refs (`unified-stock-data.ts:372`, stored-analysis/results:145) | stored_analyses table |
| AnalysisJob | ❌ 0 refs (Prisma + raw SQL) | ميت |
| AnalysisEngineStatus | ⚠️ Prisma 0 refs لكن raw SQL 6 refs | analysis_engine_status table | مُستخدم عبر better-sqlite3 |
| TechnicalIndicator | ⚠️ Prisma 0 refs لكن raw SQL (`new-db-queries.ts:253`) | technical_indicators table |

### 6.4 better-sqlite3 access

| Route / lib file | Query type | Prepared? | Risk |
|---|---|---|---|
| `admin/analytics/route.ts:40-44` | `SELECT COUNT(*) ... WHERE created_at >= ${todayStart}` | ✅ `db.prepare(sql).get()` | 🟡 low — todayStart hardcoded SQLite expression، safe لكن non-idiomatic |
| `admin/news/route.ts:138,145` | `SELECT ... FROM market_news ${whereSql}` | ✅ `.get(...params)` / `.all(...params, limit, offset)` | ✅ safe — whereClauses[] + bound `?` |
| `admin/news/route.ts:395,400` | `DELETE FROM ... WHERE id IN (${placeholders})` | ✅ `.run(...numericIds)` | ✅ safe — `placeholders = ids.map(() => '?').join(',')` |
| `live-monitor/route.ts:68` | `SELECT ... WHERE UPPER(ticker) IN (${placeholders})` | ✅ `.all(...tickers)` | ✅ safe |
| `unified-db.ts:236,240` | `SELECT ... FROM stocks WHERE ${whereSQL} ... LIMIT ? OFFSET ?` | ✅ `.get(...params)` / `.all(...params, pageSize, offset)` | ✅ safe — whereClauses محددة مسبقاً |
| `egx-db.ts:554` | `SELECT COUNT(*) ... FROM stocks ${whereSQL}` | ✅ bound params | ✅ safe |
| `radar-db.ts:116` | `SELECT COUNT(*) FROM ${cfg.table}` | ✅ `.get()` | 🟡 medium — `cfg.table` من config object (not user input) — يفترض whitelist |
| `maker-radar/footprint/route.ts:63` (tombstone, 410) | `SELECT ${cfg.highCol}, ${cfg.lowCol} ... FROM ${cfg.table} WHERE ${cfg.tickerCol} = ?` | ✅ `.all(ticker, days)` | 🟡 medium — config-driven identifiers |
| `maker-radar/entry-timing/route.ts:17` | `SELECT ${cols} FROM ${cfg.table} WHERE ${cfg.tickerCol} = ?` | ✅ `.all(ticker)` | 🟡 medium — same pattern |
| `alert-engine.ts:128` | `ALTER TABLE user_notifications ADD COLUMN ${name} ${def}` | ✅ `.run()` | 🟡 low — name/def من fixed list in ensureUserNotifColumns |
| `sqlite-admin.ts:251` | `SELECT COUNT(*) AS c FROM "${tableName}" ${whereSql}` | ✅ bound params | 🟡 medium — admin-only + validateTableName |
| `admin-db-manager.ts:751` | `SELECT COUNT(*) AS c FROM "${table}"` | ✅ `.get()` | ✅ safe — validateTableName على `[A-Za-z_][A-Za-z0-9_]*` |
| `sharia/route.ts:185` | `SELECT COUNT(*) AS n FROM sharia_metrics m ${clause}` | ✅ `.get(params)` | ✅ safe |
| `stocks/[ticker]/orderbook/route.ts:72` | `PRAGMA table_info(${table})` | ✅ `.all()` | 🟡 medium — `table` من fixed whitelist (قراءة only) |
| `data-engine/health/route.ts:37` | `SELECT COUNT(*) as n FROM ${tableName}` | ✅ `.get()` | 🟡 medium — `tableName` من whitelist داخل route |

**استنتاج**: 0 SQL injection مؤكد. كل template-string queries إما hardcoded SQLite expressions أو whitelist-controlled identifiers أو bound `?` placeholders. 1 regression test suite (`src/__tests__/security/sql-injection.test.ts`) يغطي 3 endpoints.

### 6.5 API Contracts

#### نجاح: شكل شبه موحّد؟
- ✅ unified envelope مُعرّف في `src/lib/api-response.ts`: `{ success, data?, error?, timestamp }`.
- ⚠️ فقط **41 occurrences في 14 ملف** (3% من 463 route) يستخدمون `apiOk/apiErr/wrapHandler`. الـ 97% الباقية تستخدم `NextResponse.json({success, ...})` يدوي بدون `timestamp` field.

#### خطأ: شكل شبه موحّد؟
- ✅ pattern `{ success: false, error: string|{code,message,details} }` مهيمن.
- ⚠️ error تارة string، تارة code object. مختلط.

#### status codes: ملائمة؟
- ✅ 200 / 201 Created / 400 / 401 / 403 / 404 / 409 Conflict / 410 Gone (8 tombstone routes) / 500 / 502 Bad Gateway / 503 Service Unavailable. كلها موجودة وصحيحة الاستخدام.

#### pagination: متّسقة؟
- ❌ **3 أنظمة مختلطة**:
  - `page_size` (snake_case) في stocks/route.ts + admin/news/route.ts
  - `pageSize` (camelCase) في admin/users/route.ts + admin/db/[db]/[table]/route.ts
  - `limit`/`offset` في admin/db-manager/route.ts
  - 0 routes تستخدم cursor-based pagination
- 12 route تستخدم `LIMIT ? OFFSET ?` placeholders (سليم).

#### error messages: عربية؟
- ⚠️ مختلطة: ~60% عربي / ~40% English. مثال:
  - ✅ عربي: api-response.ts defaults ('غير مصرح'، 'ممنوع الوصول'، 'غير موجود'، 'خطأ داخلي').
  - ❌ English في data-engine/* ('Failed to read silver data', 'Failed to read stocks data', 'internal_error').
  - ❌ English في admin/news ('Invalid JSON body').
  - ❌ English في portfolio/master ('Authentication required').
  - ❌ English في live/analysis ('Live engine unavailable').

### 6.6 أدوات DB (admin/db-manager)

| الأداة | الآمنة؟ | التوصية |
|---|---|---|
| `truncate-table/route.ts` | ✅ آمنة | requireAdminAsync + P0 guard على predictions table (line 743) + validateTableName |
| `drop-table/route.ts` | ✅ آمنة | requireAdminAsync + validateTableName |
| `reindex/route.ts` | ✅ آمنة | requireAdminAsync |
| `repair/route.ts` (595 سطر) | ✅ آمنة | requireAdminAsync + path traversal guard + 6 steps |
| `db-backup/route.ts:579` | 🔴 **CRITICAL** | `git push --force` مباشر بدون --force-with-lease — يكسر Rule 81 |
| `db-backup/route.ts:654` | 🔴 **CRITICAL** | `execSync('python3 vps-service/scripts/auto_git_sync.py')` الذي بدوره يستخدم --force-with-lease |
| `backup/route.ts` + `restore/route.ts` | ✅ آمنة | WAL checkpoint قبل النسخ + integrity_check قبل الاستبدال |
| `export-all/route.ts` + `import-all/route.ts` | ✅ آمنة | Auto-backup ZIP قبل الاستبدال + integrity validation |
| `historical-backups/route.ts` | ✅ آمنة | Read-only browse |
| `recover/route.ts` + `recover-all/route.ts` | ✅ آمنة | requireAdminAsync |

### 6.7 Data Integrity

#### Foreign keys:
- ✅ 10 lib files تُفعّل `PRAGMA foreign_keys = ON`: `community-db.ts:15`, `data-sync.ts:226`, `new-db-queries.ts:79`, `sqlite-wrapper.ts:164`, `new-db.ts:193`, `unified-db.ts:92`, `egx-db.ts:181,212,265`.
- ❌ `shared-db.ts` (المسؤول عن `data_engine.db` + `stocks.db` + `price_history.db` + `intraday.db`) **لا يفعّل PRAGMA foreign_keys** — FK constraints غير مفعّلة على DBs المشتركة مع Python service.
- ⚠️ فقط 2 ملف فيه `FOREIGN KEY` references في SQL: `src/app/api/auth/register/route.ts` + `src/app/api/finance/schema/route.ts` + `db/schemas/02_egx_investment_db_schema.sql`.

#### Triggers:
- ✅ 4 triggers على `predictions` table (idempotent): trg_prevent_invalid_prices_insert + trg_prevent_invalid_prices_update + trg_prevent_wrong_direction + trg_prevent_invalid_prices (duplicate).
- 0 triggers على جداول أخرى.

#### Constraints:
- ✅ UNIQUE constraints جيدة: 13 `@@unique` عبر models.
- ⚠️ CHECK constraints موصى بها في `predictions-schema.prisma:12-38` (entry_price > 0, target_price > 0, stop_loss > 0, direction-aware stop_loss < entry_price) لكن migration غير موجود — غير مُطبّقة فعلياً.
- ✅ NOT NULL constraints على جميع الحقول الحرجة في Prisma.

### 6.8 أداء DB

#### indexes:
- ✅ **predictions-schema.prisma**: 21 `@@index` عبر 10 models على الأعمدة الحرجة.
- ✅ **auth-schema.prisma**: 9 `@@index`.
- ✅ indexes ممتازة على الجداول الحرجة.

#### N+1 risks:
- ⚠️ **مؤكد في `alert-engine.ts:insertNotification` (line 251 + 254)**: لكل ticker في loop، ينفّذ SELECT dedup + INSERT. لـ 100 tracked tickers × 5 alert types = ~1000 queries/run.
- ⚠️ **مؤكد في `radar-alerts.ts`**: loops at lines 562 + 1038 تستدعي `insertNotification(db, {...})` per ticker (نفس pattern).
- ✅ مُخفّض في `alert-engine.ts:runPortfolioPnLCheck`: يبني `priceMap` بـ SELECT واحد بـ `IN (${placeholders})` بدل query per ticker (line 498-500).

#### transactions:
- ✅ مستخدمة في **7 routes**: admin/sync-vps (line 270), admin/import-indices-csv (153), finance/obligations/payments (121), admin/db-manager/repair (498), market/sync-live (411), market/scheduled-sync (202 + 262).
- ✅ مستخدمة في **5 lib files**: instapay-db (252), sqlite-wrapper (196), bot-link-db (230), egx-db (42), metrics-db (249 + 567).
- ⚠️ `insertNotification` لا يستخدم transaction رغم أنه SELECT+INSERT — race condition محتمل بين الـ dedup والـ insert.

### 6.9 مخاطر DBs حرجة (مرتبة)

1. 🔴 **CRITICAL — Rule 81 violation ثاني**: `src/app/api/admin/db-backup/route.ts:579` يستخدم `git push --force` مباشر (بدون --force-with-lease) + `:654` يستدعي `auto_git_sync.py`.
2. 🔴 **PRAGMA foreign_keys معطّل في shared-db.ts**: الـ DBs المشتركة مع Python service (stocks.db, data_engine.db, price_history.db, intraday.db) لا تُفعّل FK constraints. أي `ON DELETE CASCADE` على User→Account/Session/ApiToken/Watchlist لا يعمل عبر هذه الـ connections، مما يُسبب orphan rows عند حذف User.
3. 🟡 **N+1 query في alert-engine.ts:insertNotification**: ~1000 queries/run على user_notifications لكل دورة alert.
4. 🟡 **API contract غير موحّد**: فقط 3% من routes تستخدم `apiOk/apiErr/wrapHandler`.
5. 🟡 **Pagination مختلطة (3 أنظمة)**: page_size / pageSize / limit+offset — 0 cursor-based.
6. 🟡 **6 Prisma models ميتة فعلياً**: Post, UserTelegramLink (Prisma side), PortfolioHistory, Referral, ExpertTrackRecord, AnalysisJob.
7. 🟡 **4 DBs مفقودة على الساندبوكس**: stocks.db, data_engine.db, price_history.db, intraday.db.
8. 🟢 **CHECK constraints غير مُطبّقة**: `predictions-schema.prisma:12-38` يوصي بـ CHECK لكن migration غير موجود.
9. 🟢 **error messages مختلطة عربي/إنجليزي**: ~40% English في data-engine/* + admin/news + portfolio/master.
10. 🟢 **seed-subscriptions.ts outdated**: يصنع 3 plans لكن schema الحالي يدعم 6 tiers في MarketPricing.
11. 🟢 **`db-predictions.ts:27` re-exports AiPrediction type** رغم أن `predictions-schema.prisma:9` يصرّح `aiPrediction: DROPPED`.
12. 🟢 **`Watchlist` + `PortfolioItem` Prisma models شبه ميتة**: engine الفعلي يقرأ من `user_stock_watchlists` و `portfolio_assets` عبر better-sqlite3.

---

## <a name="audit-g"></a>7. AUDIT-G — الأمان + الأسرار

### 7.1 ملخص تنفيذي
- 🔴 مخاطر حرجة: **7**
- 🟠 مخاطر عالية: **7**
- 🟡 مخاطر متوسطة: **6**
- 🟢 مخاطر منخفضة: **3**
- 🔑 أسرار مكشوفة: **3** (DeepSeek key + admin credentials في 3 ملفات + dashboard-key default)
- ✅ `.env` غير مُلتزم في git (يحميه `.gitignore:114,164,240`).
- لم أُجرِ أي تعديل (read-only audit). لم أُسجّل أي secret حقيقي — استخدمت mask.

### 7.2 الأسرار المكشوفة (CRITICAL)

| # | النوع | الموقع | القيمة (masked) | الإجراء |
|---|---|---|---|---|
| CRIT-1 | DeepSeek API Key (hardcoded fallback) | `vps-service/ai/deepseek_news_service.py:42` | `sk-4dc7a***...***` (32 hex chars) | Rotate key at DeepSeek dashboard + حذف fallback + الاعتماد على env فقط |
| CRIT-2 | Admin password (hardcoded) | `SESSION_HANDOFF_JIMMY.md:10` + `Documentation/SESSION_HANDOFF_JIMMY.md:10` + `test_stats.js:9` | `mohseny / M2y@0***...***` (base64 X-Admin-Token) | Rotate admin password فوراً + حذف الملفات من git history (`git filter-repo`) |
| LOW-1  | Dashboard API key (weak default) | `news-agent/ui/dashboard.py:42` | `change-me-dashboard-key` | Reject empty env var (fail closed) |

### 7.3 ثغرات OWASP Top 10

#### A01 Broken Access Control
- 🔴 **CRIT-3**: `/api/portfolio/accounts/route.ts:40,70` — userId defaults to hardcoded CUID `'48457b7f-40f2-4a7e-8955-d4d2cd1d79bd'` لو `user_id` غير مُمر؛ GET/POST بدون auth check.
- 🔴 **CRIT-4**: `/api/user-posts/[id]/route.ts:62-75` — DELETE يأخذ `user_id` من query string، أي مهاجم يعرف user_id الضحية يحذف منشوراتها.
- 🔴 **CRIT-6**: `/api/data-engine/control/route.ts:297` POST endpoint بدون auth — trigger scrapers + start/stop engine من anonymous.
- 🔴 **CRIT-7**: `/api/alerts/quick-add/route.ts` POST/GET بدون auth — أي anonymous يضيف/يقرأ price_alerts لأي user_id.
- 📊 **273 من 463 route.ts** بدون auth imports (لكن أغلبها GET لبيانات عامة — الأسواق/الأخبار — مقبول). الـ 15 route الحساس بدون auth: alerts/quick-add + portfolio/accounts + portfolio/accounts/[id]/{state,equity-curve} + portfolio + user-posts/[id]/{,like} + ads/successful-trades + data-engine/control + admin/auth + trade-results/export-image + user-posts.

#### A02 Sensitive Data Exposure
- 🟠 **HIGH-1**: `api_tokens` table يخزن Bearer tokens بصيغة plaintext — `token = egx_${user.id}_${randomUUID()}_${Date.now()}` في `/api/auth/login/route.ts:127` + `/api/auth/google-signin/route.ts:298`. لو DB اتسرق → كل tokens فعّالة فوراً (30 يوم TTL).
- 🟠 **HIGH-2**: `/api/admin/auth/route.ts:64` + `/api/admin/auth/token/route.ts:19` — admin token = `base64(${ADMIN_USERNAME}:${ADMIN_PASSWORD})` (Basic Auth masquerading)؛ لو الـ header leaked، password يُفك بـ base64 decode.
- 🟠 **HIGH-3**: `admin-auth-server.ts:23` + `/api/admin/auth/route.ts:75` — `admin_session` cookie value = ثابت env var (مش per-user، مش مُدوَّر، 7 أيام TTL).
- 🟡 **MED-3**: `/api/subscription/instapay/submit/route.ts:65-78` — receipts تُخزن في `public/uploads/receipts/` (URL pattern شبه predictable: `receipt_${timestamp}_${uuid8}.png`)؛ مفيش magic-byte verification.

#### A03 Injection (SQL + Command + XSS)
- ✅ **SQL injection**: `better-sqlite3` كلها parameterized (`?` placeholders + `${param}` tagged templates في Prisma). `$executeRawUnsafe` في `token-helper.ts:280` + `admin/users/route.ts:140-231` كله column names من allowlist ثابت + قيم bound parameters. **لا SQL injection مؤكدة**.
- 🟠 **HIGH-5 (Command Injection)**: `/api/admin/git-files/route.ts:145,159` — `execSync(\`git rm --cached "${f}"\`)` + `execSync(\`git add -f "${f}"\`)` مع shell. التحقق `f.includes('..') || f.startsWith('/')` لا يمنع shell metacharacters (مثل `foo";rm -rf /"`). admin-only لكن RCE عند privilege escalation.
- ✅ **XSS**: 2 hits لـ `dangerouslySetInnerHTML` — `src/lib/structured-data.tsx:174` + `src/components/ui/chart.tsx:83` — كلاهما يحقن JSON.stringify(schema) آمنة. لا XSS مؤكدة.
- 🟡 **MED-6**: `execSync` في `admin/db-backup/route.ts` (مر AUDIT-A) + `admin/system-resources/route.ts` + `admin/system-health/route.ts` — كلها admin-only لكن زيادة attack surface.

#### A05 Security Misconfiguration
- 🟢 **LOW-2**: `useSecureCookies: isHttps` في `next-auth/route.ts:13` — مرتبط بـ `NEXTAUTH_URL` prefix. لو `NEXTAUTH_URL` يبدأ بـ `http://localhost` → cookies مش secure في الإنتاج.
- 🟢 **LOW-3**: لا CSRF protection على `/api/bot/link-token` + `/api/admin/auth` POST routes.
- ✅ CORS: `proxy/[...path]/route.ts:58-77` + `proxy-prod/[...path]/route.ts:196` — same-origin فقط (لا `*`).
- ✅ `productionBrowserSourceMaps: false` في `next.config.ts:18`.

#### A06 Vulnerable Components
- ✅ `bcryptjs@3.0.3` (آمن، 12 salt rounds في `/api/auth/register/route.ts:109`).
- ✅ `jsonwebtoken@9.0.3` (آمن، HS256 في `src/lib/payment.ts:76`).
- ⚠️ `next-auth@4.24.11` (آخر 4.x — لكن v5 صدر، v4 لا يزال مدعوم).
- ✅ `better-sqlite3@11.10.0`, `@prisma/client@5.22.0`, `zod@4.0.2` (مُثبّت لكن **غير مستخدم** — MED-2).

#### A07 Authentication Failures
- 🔴 **CRIT-5**: `/api/auth/google-signin/route.ts:171` — `if (VALID_CLIENT_IDS.length > 0 && !audienceMatch)` — لو الـ env vars كلها unset → length=0 → audience check يُتخَطَّى بالكامل (fail-open).
- 🟠 **HIGH-4**: `/api/auth/google-signin/route.ts:294` — `adminEmails = ['enmohsen20111975@gmail.com', 'ceo@m2y.net']` hardcoded (مستقل عن `admin-identities.ts` — DRY violation). كمان line 355: `subscription_tier: isAdmin ? 'premium' : ...` — الأدمن يرجع بـ tier='premium' بدل 'admin'!
- 🟡 **MED-4**: Bearer tokens 30 يوم بدون refresh mechanism + لا token rotation على password change.
- ✅ Rate limiting على login/register/google-signin/b2b-signup (5 req/min/IP) — `lib/rate-limiter.ts`.

#### A08 Insecure Deserialization
- ✅ `JSON.parse` على user input موجود لكن في try/catch (safe-by-design).
- ✅ لا `eval()`/`new Function()` على user input.

#### A10 SSRF
- 🟡 `src/lib/data-adapter.ts:220,243,359,377,453,470` + `multi-source-adapter.ts` — استدعاءات لـ APIs خارجية (TwelveData/AlphaVantage/EODHD) من server-side. الأURLs ثابتة (مش user-controlled) — لا SSRF مؤكدة. لكن `data-engine/control/route.ts:73` يستخدم Flask URL من `DATA_ENGINE_URL` env (low risk).

### 7.4 auth/ التفصيلي

| المكون | الآلية | المخاطر | التوصية |
|---|---|---|---|
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth v4: JWT (30d) + Google OAuth + CredentialsProvider (gated بـ `ALLOW_FORM_LOGIN=true`) + session callback يتحقق من DB على كل request. Cookies: `httpOnly + sameSite:lax + secure=isHttps`. | `ALLOW_FORM_LOGIN` يجب أن يبقى OFF في الإنتاج. `useSecureCookies` مرتبط بـ NEXTAUTH_URL. Hardcoded backdoor `MOHSENY_HASH` مُزال ✅. | تأكيد `ALLOW_FORM_LOGIN=unset` + `NEXTAUTH_URL=https://...` في الإنتاج. |
| `src/lib/admin-auth-server.ts` | 3 methods: (1) X-Admin-Token header (base64 user:pass) + admin_session cookie، (2) NextAuth session + isAdmin() + DB subscription_tier='admin'، (3) `ALLOW_ADMIN_BYPASS=true` (default OFF). Localhost bypass DISABLED ✅ (مر AUDIT-C). | Admin session cookie value = static `ADMIN_SESSION_TOKEN` env (not per-user، مش مُدوَّر، 7d). Admin token = base64(password) → password يُستخرج بسهولة. | استبدال static token بـ per-user JWT (HIGH-2, HIGH-3). |
| `src/lib/admin-guard.ts` | Re-exports `requireAdminAsync` + يضيف `requireAuthAsync` (returns userId \|= 401). | لا جديد — يعتمد على `auth-helper.ts`. | نفس توصيات token hashing. |
| `src/lib/auth-helper.ts` | `getSessionUserId()` يفحص: Bearer token → admin_session cookie → NextAuth session. يستخدم `logger.ts` structured ✅. | admin_session cookie lookup في `auth-helper.ts:158-180` يفحص email/id/username — لو cookie leaked وقيمته تطابق user معروف، يُعتبر authenticated. | توقيع الـ admin_session cookie (HMAC) بدل plaintext match. |
| `src/lib/admin-identities.ts` | يقرأ admin emails/usernames من env vars (`ADMIN_EMAILS`, `ADMIN_USERNAMES`) مع fallback للـ defaults hardcoded. | Defaults تُشحن للـ browser bundle (`NEXT_PUBLIC_*`) — مقبول لأن server-side validation هو الحارس. | OK. |
| `src/lib/token-helper.ts` | `validateTokenWithUser(token)` — Prisma findUnique بـ plaintext token. raw query fallback لـ corrupted dates. | 🔴 Plaintext token lookup. 🟠 `console.log` للـ token أول 20 حرف (line 42) + raw query results (lines 51,59,65,91,96,101,281). | hash tokens في DB (HIGH-1) + ترحيل لـ `logger.ts` (HIGH-6). |
| `src/app/api/admin/auth/route.ts` | POST gated بـ `ALLOW_FORM_LOGIN === 'true'` ✅ (FIX-P1-SECURITY). يضبط admin_session cookie. | Token response = `base64(user:pass)` + cookie = static env. | نفس HIGH-2, HIGH-3. |
| `src/app/api/admin/auth/token/route.ts` | GET — يفحص admin_session cookie ضِد `ADMIN_SESSION_TOKEN` + يرجع `generateAdminToken()` = base64(user:pass). | Token يُرجَع للـ client (لـ X-Admin-Token header). | استبدال بـ random opaque token + DB hash. |
| `src/app/api/admin/auth/auto-cookie/route.ts` | POST — يفحص NextAuth session + isAdmin → يضبط admin_session cookie = ADMIN_SESSION_TOKEN. | يكشف email في response (`email: session.user.email`) — line 65. | إزالة `email` من response. |
| `src/app/api/bot/link-token/route.ts` | POST — يتحقق من `X-Bot-Secret` header ضد `BOT_API_SECRET` بـ constant-time compare ✅. TTL=10min + single-use ✅. SQL parameterized ✅. | لو `BOT_API_SECRET` unset → fail-closed ✅. | OK — نموذجي. |
| `src/app/api/auth/login/route.ts` | POST — rate-limited ✅, bcrypt.compare ✅, unified error message (no enumeration) ✅. | `console.log` للـ token creation ✅ (لا يسرب token value). user_id يُؤخَذ من DB (مش من body) ✅. لكن token يُخزَّن plaintext. | hash tokens (HIGH-1). |
| `src/app/api/auth/register/route.ts` | POST — rate-limited ✅, bcrypt 12 rounds ✅, validation (email/username/password length). | يرجع `api_key` = `egx_${user.id}_${Date.now()}` في response بدون تخزينه في DB (مفارقة!) — المستخدم يعتقد إنه API key لكن مفيش validation path لها. | إمّا تخزين الـ api_key أو إزالتها من response. |
| `src/app/api/auth/google-signin/route.ts` | POST — rate-limited ✅, Google tokeninfo verification ✅. | 🔴 CRIT-5 fail-open audience check + 🟠 HIGH-4 hardcoded adminEmails + tier='premium' bug. | إصلاحات P0/P1. |

### 7.5 CSRF / CORS / Rate Limiting

#### CSRF
- ✅ NextAuth CSRF token cookie مضبوط (`csrfToken` cookie + `__Host-` prefix في HTTPS) في `nextauth/route.ts:32-40`.
- 🟢 LOW-3: `/api/bot/link-token` + `/api/admin/auth` POST لا يستخدمون NextAuth CSRF token (لكن الأول محمي بـ shared secret + الثاني بـ ALLOW_FORM_LOGIN gate).

#### CORS
- ✅ `/api/proxy/[...path]/route.ts:58-77` + `/api/proxy-prod/[...path]/route.ts:196` — same-origin فقط.
- 🟡 MED-5: `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS` + `Allow-Credentials: true` — الأساليب مفتوحة بالكامل (لكن same-origin).

#### Rate Limiting
- ✅ 4 routes: `/api/auth/login`, `/api/auth/register`, `/api/auth/google-signin`, `/api/b2b/signup` — 5 req/min/IP.
- 🟠 HIGH-7: لا rate limiting على:
  - `/api/admin/auth` (brute-force admin password)
  - `/api/alerts/quick-add` (spam alerts)
  - `/api/subscription/instapay/submit` (mass receipt uploads)
  - `/api/redeem-promo` (brute-force promo codes)
  - `/api/portfolio/accounts` (mass portfolio enumeration)

### 7.6 Input Validation

| Route | Validation | المخاطر |
|---|---|---|
| 463 routes من `src/app/api/**/route.ts` | يدوي (`typeof` + length checks) — **0 route يستخدم zod** | 🟡 MED-2: مُثبّت `zod@4.0.2` لكن غير مستخدم. Validation غير مركزي. |
| `/api/expert-recommendations/route.ts` (PUT) | allowedFields whitelist + parameterized placeholders ✅ | آمن — column names من static list. |
| `/api/auth/login/route.ts` | typeof + length + unified error ✅ | آمن. |
| `/api/auth/register/route.ts` | typeof + length (email/username/password) ✅ | آمن (لا complexity rules لكن 8 chars min). |
| `/api/bot/link-token/route.ts` | typeof chat_id (number, finite, >0) + username slice(0,64) ✅ | آمن. |
| `/api/admin/users/route.ts` | searchParams + Prisma where clause ✅ | آمن (Prisma parameterizes). |
| `/api/alerts/quick-add/route.ts` | typeof + Number.isFinite ✅ | آمن validation، لكن **لا auth** (CRIT-7). |
| `/api/subscription/instapay/submit/route.ts` | File MIME + extension + size (10MB) ✅ | 🟡 MED-3: لا magic-byte + public dir. |
| `/api/admin/git-files/route.ts` | `f.includes('..') || f.startsWith('/')` فقط | 🟠 HIGH-5: لا يمنع shell metacharacters. |

### 7.7 Logging & Monitoring

#### passwords في logs؟
- ✅ لا تسجيل مباشر لكلمات المرور. `console.warn('[auth/login]', 'user_not_found', { username_or_email })` (line 91) — يسجل الـ identifier لكن ليس الـ password.
- 🟠 `console.log('[Auth Debug] Raw identifier:', rawIdentifier, 'password len:', (credentials?.password || '').length)` في `nextauth/route.ts:67` — يسجل password length فقط (مش القيمة) — مقبول لكن verbose.

#### tokens في logs؟
- 🔴 **HIGH-6**: `token-helper.ts:42` — `console.log('[Token Helper] Validating token:', token.substring(0, 20) + '...')` — يسجل أول 20 حرف من كل Bearer token (يكفي لـ brute-force prefix).
- 🟠 `token-helper.ts:91,96,281` — يسجل expires_at + userId + tokenId (low risk لكن verbose).
- 🟠 `google-signin/route.ts:141,142,166,173,201,343` — `console.log` للـ email + audience + token details (لا يستخدم `logger.ts`).
- ✅ `auth-helper.ts` + `admin-auth-server.ts` + `payment.ts` تستخدم `logger.ts` structured (no email/userId/IP leaks).

#### Sentry
- ✅ `sentry.client.config.ts` + `sentry.server.config.ts` — مهيّأ مع `beforeSend` filter للـ noise (no PII explicitly stripped لكن `denyUrls` للـ browser extensions).
- ✅ Sentry disabled لو `SENTRY_DSN` unset (safe no-op).
- ⚠️ لا `beforeSend` scrubbing للـ tokens/passwords.

#### error messages
- ✅ Production error messages generic ('حدث خطأ أثناء تسجيل الدخول').
- ⚠️ `/api/admin/users/route.ts:208` — `details: fatalFallbackError.message` في 500 response — يسرّب stack trace.
- ⚠️ `/api/auth/register/route.ts:149-167` — error messages تُميّز Prisma errors (`FOREIGN KEY constraint`, `no such table`, `SQLITE_CANTOPEN`) — تكشف معلومات DB internal structure.

### 7.8 Dependency Security

| Package | الإصدار | مخاطر معروفة |
|---|---|---|
| `bcryptjs` | 3.0.3 | ✅ آمن (pure-JS, 12 salt rounds). |
| `jsonwebtoken` | 9.0.3 | ✅ آمن (HS256 في payment.ts). |
| `next-auth` | 4.24.11 | ✅ آخر 4.x (v5 صدر لكن v4 مدعوم). |
| `better-sqlite3` | 11.10.0 | ✅ آمن (parameterized API). |
| `@prisma/client` | 5.22.0 | ⚠️ Prisma 5.22.0 known bug: يكتب DateTime? كـ millisecond timestamps (موثّق في `auth-helper.ts:24-26`). |
| `zod` | 4.0.2 | ✅ مُثبّت لكن **غير مستخدم** في أي route (MED-2). |
| `@sentry/nextjs` | ^11.0.0 | ✅ آمن. |

### 7.9 خطة المعالجة (مرتبة حسب الأولوية)

1. **P0 — فوري (CRIT-1, CRIT-2)**: Rotate DeepSeek API key + حذف `vps-service/ai/deepseek_news_service.py:42` fallback. حذف `SESSION_HANDOFF_JIMMY.md` (نسختين) + `test_stats.js` من git history عبر `git filter-repo`. Rotate admin password (`M2y@0***`).

2. **P0 — فوري (CRIT-3, CRIT-4, CRIT-6, CRIT-7)**: إضافة `requireAuthAsync` + `getSessionUserId` لكل الـ routes الحساسة (`/api/portfolio/accounts`, `/api/alerts/quick-add`, `/api/data-engine/control`, `/api/user-posts/[id]`). حذف hardcoded `48457b7f-40f2-4a7e-8955-d4d2cd1d79bd` default + استخدام `userId` من session فقط.

3. **P0 — فوري (CRIT-5)**: إصلاح fail-open في `/api/auth/google-signin/route.ts:171` — قلب الشرط لـ `if (!audienceMatch) return 401` بدون `length > 0` guard. لو `VALID_CLIENT_IDS` فاضي → return 500 "OAuth not configured".

4. **P1 (HIGH-1, HIGH-3)**: Hash Bearer tokens في `api_tokens` table (sha256) + مقارنة hash. استبدال `admin_session` cookie الـ static بـ per-user JWT signed بـ `NEXTAUTH_SECRET`.

5. **P1 (HIGH-2)**: استبدال `base64(user:pass)` admin token بـ random opaque token + تخزين hash في DB.

6. **P1 (HIGH-4)**: توحيد `adminEmails` من `@/lib/admin-identities` في `google-signin/route.ts:294` + إصلاح `subscription_tier: 'admin'` بدل `'premium'` في line 355.

7. **P1 (HIGH-5)**: استبدال `execSync(\`... "${f}"\`)` بـ `execFile('git', ['rm', '--cached', f], { shell: false })` في `/api/admin/git-files/route.ts:145,159`.

8. **P1 (HIGH-6)**: ترحيل `console.log` إلى `logger.ts` في `token-helper.ts` + `google-signin/route.ts` + `nextauth/route.ts`. حذف log للـ token prefix.

9. **P2 (HIGH-7)**: إضافة rate limiting لـ `/api/admin/auth` (5 req/min) + `/api/alerts/quick-add` + `/api/subscription/instapay/submit` + `/api/redeem-promo`.

10. **P2 (MED-2)**: إدخال zod schemas لـ POST routes الحساسة (login/register/alerts/portfolio/admin).

11. **P2 (MED-3)**: نقل receipts uploads خارج `public/` (إلى `private/uploads/receipts/`) + إضافة magic-byte verification (file-type package) + serving عبر signed URL route.

12. **P3 (LOW-1, LOW-2, LOW-3)**: Reject empty env var في `news-agent/ui/dashboard.py:42` + تأكيد `NEXTAUTH_URL=https://` + `ALLOW_FORM_LOGIN=unset` + `ALLOW_ADMIN_BYPASS=unset` في الإنتاج + CSRF protection على bot-link + admin-auth POST routes.

---

## <a name="audit-h"></a>8. AUDIT-H — جاهزية الإنتاج

### 8.1 ملخص تنفيذي
- **جاهزية الإنتاج: 4/10** (RED-leaning YELLOW)
- **blockers حرجة: 6**
- **warnings: 14**
- **جوانب مكتملة: 12+**

الإنتاج الحالي يعتمد على افتراضات غير محققة (NEXTAUTH_SECRET، SENTRY_DSN، TLS على Caddyfile). الـ sandbox شغّال لكن الـ production path فيه فجوات حرجة تمنع الـ go-live.

### 8.2 Build Pipeline

#### نقاط القوة
- `prebuild` (package.json:7) يُولّد 3 prisma schemas — كلها موجودة.
- `postbuild` (package.json:10) — `scripts/copy-sqljs-to-standalone.js` موجود ويتعامل بأمان مع غياب `.next/standalone`.
- `next.config.ts:9-11` — `typescript.ignoreBuildErrors: false` (جيد).
- `next.config.ts:18` — `productionBrowserSourceMaps: false`.
- `NODE_OPTIONS='--max-old-space-size=4096'` مناسب.

#### المخاطر
- 🔴 **sandbox/prod build divergence حرج**: `.zscripts/build.sh:50-98` يتطلّب `output: 'standalone'` ويحقنه تلقائياً لو مفقود. لكن `next.config.ts:13-14` معطّل صراحةً (UNIFY-FIX). النتيجة: sandbox يبني **مع** standalone، الإنتاج يبني **بدون** standalone — artifacts مختلفة.
- 🟡 `--no-lint` في build (package.json:8-9) — لا توجد بوابة lint إلزامية.
- 🟡 `reactStrictMode: false` (next.config.ts:12).
- 🟡 `npm run check:guards` مكسور + `npm run data:fill-missing` مكسور.

### 8.3 Start Scripts

| Script | NODE_OPTIONS | ملاحظة |
|---|---|---|
| `npm start` (package.json:11) | `--max-old-space-size=256` | 🔴 منخفض جداً لـ Next.js 14 |
| `start:safe` (package.json:12) | `--max-old-space-size=512` | 🟡 لا يزال ضيقاً |
| PM2 `nextjs` (ecosystem.config.js:214) | `--max-old-space-size=2048` | ✅ مناسب |

- 🔴 **`UV_THREADPOOL_SIZE=1`** (package.json:11) — مقيّد للإنتاج.
- 🟡 `npm start` NODE_OPTIONS منخفض جدًا.
- ✅ `NODE_ENV=production` مفعّل صراحةً في `npm start`.

### 8.4 PM2 Services (ecosystem.config.js)

| # | Service | المنفذ | env vars | restart policy | max_memory | kill_timeout | ملاحظة |
|---|---|---|---|---|---|---|---|
| 1 | python-backend | 8010 | NODE_ENV, PORT, TELEGRAM_*, EODHD_API_KEY | autorestart:true, max_restarts:10, restart_delay:5s | 500M | 10s | ✅ |
| 2 | data-engine | 5000 | NODE_ENV, PORT | autorestart:true, max_restarts:10 | 500M | 10s | ✅ |
| 3 | nextjs | 3000 | NODE_ENV, PORT, UV_THREADPOOL_SIZE=2, SWC=1, RAYON=1 | autorestart:true, max_restarts:10 | 1500M | 15s | ✅ |
| 4 | ws-service | 3005 | NODE_ENV, VPS_API_URL=http://localhost:8010 | autorestart:true, max_restarts:10 | 200M | 10s | ✅ |
| 5 | telegram-poster | — | NODE_ENV, TELEGRAM_* | autorestart:true, max_restarts:10 | 300M | 10s | ✅ |
| 5b | telegram-interactive-bot | — | NODE_ENV, TELEGRAM_*, BOT_API_SECRET, NEXT_PUBLIC_API_URL | autorestart:true, max_restarts:10 | 300M | 10s | ✅ |
| 6 | telegram-events | 3003 | NODE_ENV, PORT=3003, PYTHON_BACKEND_URL | autorestart:true, max_restarts:10 | 150M | 10s | ✅ |
| 7 | news-agent | — | NODE_ENV, PRODUCTION_SERVER_URL, OLLAMA_MODEL, COLLECTION_INTERVAL_MINUTES, MIN_IMPORTANCE_SCORE, MAX_NEWS_PER_BATCH, ENABLE_EGYPTIAN_SOURCES, TELEGRAM_*, TG_* | autorestart:true, max_restarts:10 | 300M | 10s | ✅ |

#### المخاطر
- 🔴 **لا يوجد `pm2-logrotate`** — ملفات `./logs/*-{error,out}.log` ستنمو بلا حدود.
- 🔴 **لا يوجد PM2 healthcheck** (`http_endpoint` / `wait_ready`).
- 🟡 `nextjs` `node_args: '--max-old-space-size=2048'` (line 214) — متباينة مع `npm start` (256MB).
- 🟡 `max_restarts: 10` بدون نافذة زمنية.

### 8.5 Gateway (proxy-server.js + Caddyfile)

#### sandbox vs production
- `proxy-server.js` مصمّم للـ **sandbox فقط**.
- في الإنتاج `nextjs` تُشغّل `next start -p 3000` مباشرة — **proxy-server.js غير مستخدم**.

#### HTTPS / TLS
- 🔴 **Caddyfile يفتح `:81` فقط** (line 1) — لا `:80`، لا `:443`، لا `tls` directive.
- لا يوجد domain name في Caddyfile — Caddy auto-TLS يتطلب domain.

#### WebSocket
- ✅ `proxy-server.js:150-192` — WebSocket upgrade handler كامل مع timeout (5s) + error handlers.

#### Caching
- 🔴 `proxy-server.js:22` — `const cache = new Map()` بلا TTL، بلا LRU، بلا max-size. **Memory leak risk**.
- ✅ Static files: `Cache-Control: public, max-age=31536000, immutable`.

#### X-Forwarded Headers (Caddyfile)
- ✅ `header_up Host {host}` (line 8, 17)
- ✅ `header_up X-Forwarded-For {remote_host}` (line 9, 18)
- ✅ `header_up X-Forwarded-Proto {scheme}` (line 10, 19)
- ✅ `header_up X-Real-IP {remote_host}` (line 11, 20)

#### XTransformPort
- ✅ Caddyfile:2-13 — `query XTransformPort=*` → `reverse_proxy localhost:{query.XTransformPort}`.

### 8.6 Environment Variables

#### إحصائيات
- **372 `process.env.` reference** عبر **211 ملف** في `src/`.
- `.env` يحتوي على سطر واحد فقط: `DATABASE_URL=file:/home/z/my-project/db/custom.db`.

| Env var | مطلوب؟ | fallback آمن؟ | المخاطر |
|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ (in .env) | منخفض |
| `NEXTAUTH_SECRET` | ✅ **CRITICAL** | ❌ (default `''`) | 🔴 NextAuth يفشل في الإنتاج بدونها |
| `NEXTAUTH_URL` | ✅ | ❌ (default `undefined`) | 🔴 Cookies secure flag يعتمد عليها |
| `GOOGLE_CLIENT_ID` | ✅ | ⚠️ `''` (fail-closed) | 🟡 Google OAuth معطّل بدونها |
| `GOOGLE_CLIENT_SECRET` | ✅ | ⚠️ `''` (fail-closed) | 🟡 Google OAuth معطّل بدونها |
| `SENTRY_DSN` | ⚠️ optional | ✅ no-op if empty | 🟡 Sentry معطّل فعلياً |
| `NEXT_PUBLIC_SENTRY_DSN` | ⚠️ optional | ✅ no-op if empty | 🟡 Sentry client-side معطّل |
| `PYTHON_BACKEND_URL` | ✅ | ✅ `http://127.0.0.1:8010` | منخفض |
| `DATA_ENGINE_URL` | ✅ | ✅ `http://localhost:5000` | منخفض |
| `ALLOW_FORM_LOGIN` | ⚠️ | ✅ `false` (secure default) | منخفض |
| `ALLOW_ADMIN_BYPASS` | ⚠️ | ✅ `false` (secure default) | منخفض |
| `BOT_API_SECRET` | ✅ (لـ bot endpoints) | ⚠️ `undefined` → 401 | 🟡 bot endpoints تفشل بدونها |
| `ADMIN_EMAILS` | ⚠️ | 🔴 hardcoded defaults (`admin-identities.ts:30-35`) | 🔴 4 إيميلات hardcoded |
| `TELEGRAM_BOT_TOKEN` | ✅ | ⚠️ `''` | 🟡 Telegram معطّل |
| `TELEGRAM_API_ID/HASH` | ✅ | ⚠️ `''` | 🟡 Telegram معطّل |
| `TELEGRAM_CHANNEL_ID` | ✅ | ⚠️ `''` | 🟡 Telegram معطّل |
| `NEXT_PUBLIC_API_URL` | ⚠️ | ✅ `''` (same-origin) | منخفض |
| `MAIN_DOMAIN` / `M2Y_API_URL` | ⚠️ | ✅ `https://m2y.net` | منخفض |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | ⚠️ | ✅ fail-closed | منخفض |
| `EODHD_API_KEY` | ⚠️ | ✅ `''` (skip) | منخفض |

#### 🔴 Blockers
1. `.env.example` **غير موجود**.
2. `NEXTAUTH_SECRET` غير معرّف في `.env`.
3. `SENTRY_DSN` غير معرّف.

### 8.7 Sentry

#### client config (sentry.client.config.ts)
- ✅ safe no-op لو `SENTRY_DSN` و `NEXT_PUBLIC_SENTRY_DSN` فارغان (lines 23, 26).
- ✅ `tracesSampleRate: 0.1` في الإنتاج (10% performance sampling).
- ✅ `sampleRate: 1.0` (100% errors).
- ✅ `replaysOnErrorSampleRate: 1.0` (session replay عند الأخطاء).
- ✅ `ignoreErrors` شامل: Hydration mismatches, ResizeObserver, AbortError, Network failures.
- ✅ `denyUrls`: browser extensions, chrome://, moz-extension://, GA, GTM.

#### server config (sentry.server.config.ts)
- ✅ safe no-op لو `SENTRY_DSN` فارغ.
- ✅ `tracesSampleRate: 0.1` في الإنتاج.
- ✅ `ignoreErrors`: ECONNRESET, EPIPE, ETIMEDOUT, ECONNREFUSED, AbortError, ENOENT.
- ✅ `beforeSend` يفلتر static-asset 404 stack frames.
- ⚠️ `integrations: []` (line 63) — يعطّل كل integrations الافتراضية.

#### source maps
- ✅ `productionBrowserSourceMaps: false` (next.config.ts:18).
- ⚠️ `hideSourceMaps: true` غير مُعّرّف صراحةً.

#### 🔴 Blocker
- `SENTRY_DSN` غير موجود في `.env` → Sentry معطّل فعلياً في الإنتاج رغم وجود الـ configs.

### 8.8 Health Checks

#### `/api/health` (src/app/api/health/route.ts)
- ✅ شامل: ping Python `/health` + check disk usage + port 8010 reachability + DB statuses relayed من Python.
- ✅ 60s TTL cache (line 47).
- ✅ HTTP status: 200 ok / 503 down / 200 degraded.
- ✅ Honest fallback: لو Python unreachable → `status:'degraded'`, `python:'down'`, DBs=`unknown` (Rule 27).
- ✅ `force-dynamic` + `runtime: 'nodejs'` (lines 2-3).

#### `/api/keepalive` (src/app/api/keepalive/route.ts)
- ✅ خفيف جداً: `status + timestamp + uptime` فقط.
- ✅ Unified Response Schema (`apiOk`).
- ✅ `force-dynamic`.

#### PM2 healthcheck
- 🔴 **غير موجود** في `ecosystem.config.js`.

### 8.9 Graceful Shutdown

#### Signals

| الخدمة | SIGTERM handler | SIGINT handler |
|---|---|---|
| Next.js (`next start`) | ❌ لا يوجد | ❌ لا يوجد |
| proxy-server.js | ❌ لا يوجد | ❌ لا يوجد |
| ws-service (Bun) | ✅ `index.ts:605-612` | ✅ `index.ts:614-621` |
| telegram-events (Bun) | ✅ `index.ts:116-119` | ✅ `index.ts:120-123` |
| python-backend (main.py) | ❌ لا يوجد | ❌ لا يوجد |
| data-engine (main.py) | ❌ لا يوجد | ❌ لا يوجد |
| telegram-poster | ✅ `auto_post_scheduler.py:1542-1553` (SIGINT only) | ✅ |
| telegram-interactive-bot | ❓ لم يُفحص | ❓ |
| news-agent (main.py) | ❌ لا يوجد | ❌ لا يوجد |

#### DB connections
- ✅ `db.close()` يُستدعى في `finally` blocks لكل query فردي.
- ⚠️ لا يوجد global connection pool.

#### in-flight requests
- 🔴 **غير مُنتظرة** في Next.js.
- 🔴 proxy-server.js لا يتعامل مع in-flight requests.
- ✅ ws-service + telegram-events: `io.close()` + `httpServer.close()` ينتظران الـ connections المفتوحة.

### 8.10 Tests

#### Unit
- ✅ `vitest.config.ts` موجود — `environment: 'jsdom'`, `setupFiles: ['./src/__tests__/setup.ts']`, `include: ['src/__tests__/**/*.test.{ts,tsx}']`.
- ✅ **21 test file** في `src/__tests__/` (ErrorBoundary, alerts/multi-stage-alerts, api/health, api/predictions/{historical-trades,learned-lessons}, db/integrity, radar/{MultiMarketRadarTab, SignalStrengthMeter, WeeklyReportTab, SignalTrackingTimeline, radar-alerts-path-upgrade, AccuracyDashboard, PersonalizedRadarTab}, regime/regime-engine, security/{import-endpoint, auth-guard, sql-injection}, shared/StockPublisher, signal-utils, test_phase_a_hotfix).
- ✅ `npm run test` / `npm run test:frontend` (vitest run).

#### Integration
- ✅ `vps-service/tests/` يحتوي 13+ pytest files (test_circuit_breaker, test_db_manager, test_phase1_guards, test_phase_a_hotfix, test_phase_b_integrity, test_prices_gate, test_risk_profile, test_router_e2e, test_safe_insert_prediction, test_sector_intelligence, test_v20_fusion, test_weekly_radar_report + unit/ subdir).
- ✅ `npm run test:backend` (cd vps-service && python3 -m pytest tests/ -v).

#### e2e / smoke
- 🟡 `scripts/smoke_load_test.py` موجود (467 سطر) — يقيس /api/health و /api/chart/full-analysis تحت 50 concurrent requests.
- 🟡 `tests/` directory يحتوي 3 shell scripts للـ **build pipeline**.
- 🔴 **لا يوجد e2e tests** بـ Playwright رغم وجوده في devDeps (package.json:135).
- 🔴 **لا يوجد CI workflow file** (لا .github/workflows/).

### 8.11 Docker

#### vps-service/Dockerfile
- ✅ موجود — Python 3.11-slim base.
- 🟡 **single-stage build** (lines 4-39) — لا multi-stage.
- ✅ gunicorn بـ 4 workers + 2 threads + timeout 120s (line 37-38).
- ✅ HEALTHCHECK مُعّرف (lines 33-34): `curl -f http://localhost:8010/health` كل 30s.
- ✅ Non-root-friendly (WORKDIR /app).

#### vps-service/docker-compose.yml
- ✅ egx-backend + egx-scheduler.
- ✅ `restart: unless-stopped`.
- ✅ healthcheck مُعّرف.
- ✅ log rotation: `max-size: "10m"`, `max-file: "3"` (lines 35-37).

#### Next.js Dockerfile
- 🔴 **غير موجود**.

#### Multi-stage build
- 🔴 لا يوجد multi-stage build في أي Dockerfile.

### 8.12 Monitoring & Alerting

#### Sentry alerts
- 🔴 **معطّل فعلياً** — `SENTRY_DSN` غير موجود في `.env`.
- ✅ configs مكتوبة بشكل آمن (no-op لو فارغ).
- 🔴 لا يوجد Sentry alert rules.

#### PM2 monitoring
- ✅ `pm2 monit` + `pm2 status` متاحان (package.json:31-32).
- ✅ `max_memory_restart` لكل خدمة.
- 🔴 لا يوجد alerting عند الـ restart أو الـ OOM.
- 🔴 لا يوجد `pm2-logrotate`.

#### logs
- 🔴 **لا توجد central log aggregation** — كل خدمة تكتب إلى `./logs/{service}-{error,out}.log`. لا Loki، لا ELK، لا Datadog.
- ✅ `time: true` في كل خدمة (timestamps في الـ logs).
- 🔴 بدون rotation — ملفات الـ logs ستنمو بلا حدود.

#### metrics
- ✅ `src/instrumentation.ts:29-84` — collects system metrics كل 15s إلى `db/metrics.db` مع tiered retention + anomaly detection.
- 🔴 **لا يوجد Prometheus endpoint** (لا `/metrics`).
- 🟡 `src/lib/metrics-collector.ts` + `metrics-db.ts` — internal-only.

### 8.13 Blockers الحرجة (يجب حلها قبل الإنتاج)

1. 🔴 **`NEXTAUTH_SECRET` غير معرّف في `.env`** (src/app/api/auth/[...nextauth]/route.ts:470 — default `''`). NextAuth سيفشل عند أول تسجيل دخول. التأثير: لا يمكن لأي مستخدم تسجيل الدخول.
2. 🔴 **`SENTRY_DSN` غير معرّف في `.env`** (sentry.client.config.ts:23 + sentry.server.config.ts:22). Sentry معطّل فعلياً رغم وجود الـ configs. التأثير: أي error في الإنتاج يضيع بدون trace.
3. 🔴 **Caddyfile يفتح `:81` بدون TLS** (Caddyfile:1). الإنتاج يحتاج `:80` (redirect) + `:443` مع TLS تلقائي. التأثير: لا HTTPS، الـ cookies secure flag معطّل، الـ OAuth redirects تفشل.
4. 🔴 **`.env.example` غير موجود** — المشغّل لا يملك checklist للـ env vars المطلوبة. التأثير: deployment ناقص بدون تكوين كامل.
5. 🔴 **sandbox/prod build divergence**: `.zscripts/build.sh:50-98` يحقن `output: 'standalone'` تلقائيًا — لكن `next.config.ts:13-14` معطّل صراحةً. التأثير: artifacts مختلفة بين sandbox و production.
6. 🔴 **npm scripts مكسورة**: `check:guards` يشير إلى `scripts/check_no_hard_delete.py` (غير موجود، هو في `scripts/archive_diagnostics/`) و `data:fill-missing` يشير إلى `scripts/fill-missing-data-from-engine.py` (غير موجود). التأثير: CI/pre-deploy checks ستفشل لو شُغّلت.

### 8.14 Warnings (يجب حلها لكن ليست blockers)

1. 🟡 `npm start` بـ `max-old-space-size=256MB` (package.json:11) — منخفض جداً.
2. 🟡 `--no-lint` في build (package.json:8-9) — لا توجد بوابة lint إلزامية.
3. 🟡 **لا يوجد PM2 healthcheck** (`http_endpoint` / `wait_ready`) في ecosystem.config.js.
4. 🟡 **لا يوجد `pm2-logrotate`** — ملفات الـ logs ستنمو بلا حدود.
5. 🟡 **HARDCODED DEFAULT_ADMIN_EMAILS** في `src/lib/admin-identities.ts:30-35` (4 إيميلات: enmohsen20111975@gmail.com + enmohsen2011975@gmail.com + ceo@m2y.net + mohseny@m2y.net).
6. 🟡 **لا يوجد graceful shutdown في Next.js** (لا SIGTERM/SIGINT handler).
7. 🟡 **لا يوجد graceful shutdown في proxy-server.js, python-backend/main.py, data_engine/main.py, news-agent/main.py**.
8. 🟡 `UV_THREADPOOL_SIZE=1` في `npm start` (package.json:11) — مقيّد جداً لـ async I/O.
9. 🟡 **لا يوجد Prometheus `/metrics` endpoint**.
10. 🟡 **لا يوجد CI workflow file** (لا `.github/workflows/`).
11. 🟡 **لا يوجد e2e tests** بـ Playwright رغم وجوده في devDeps.
12. 🟡 **لا يوجد Next.js Dockerfile** — الإنتاج يعتمد على PM2 فقط بدون containerization.
13. 🟡 **لا توجد central log aggregation** (Loki/ELK).
14. 🟡 **proxy-server.js in-memory `Map()` cache بلا TTL/LRU** (line 22) — memory leak risk تحت ضغط عالٍ.

### 8.15 جاهزية نهائية: 🟡 YELLOW (ميل إلى 🔴)

#### التوصية
**لا تُنشر للإنتاج حتى تُحل الـ Blockers الـ 6 الحرجة.** الترتيب:

1. (ساعة واحدة) أنشئ `.env.example` شامل (كل الـ env vars المذكورة في الجدول) + عبّئ `.env.production` بقيم حقيقية (NEXTAUTH_SECRET عشوائي 32+ char، SENTRY_DSN من Sentry dashboard، GOOGLE_CLIENT_* من Google Cloud Console).
2. (ساعة واحدة) اكتب `Caddyfile.production` على `:80` + `:443` مع domain الإنتاج (`invist.m2y.net`) + auto-TLS.
3. (30 دقيقة) احسم divergence الـ standalone: إما فعّله في `next.config.ts` (وعدّل ecosystem.config.js لاستخدام `node .next/standalone/server.js`) أو احذف auto-inject من `.zscripts/build.sh`.
4. (15 دقيقة) أصلح npm scripts المكسورة: انقل `scripts/check_no_hard_delete.py` و `check_no_raw_insert.py` من `scripts/archive_diagnostics/` إلى `scripts/`، أو احذف الـ script refs.
5. (ساعة واحدة) ثبّت `pm2-logrotate` (`pm2 install pm2-logrotate`) + أضف `http_endpoint` healthcheck لكل خدمة في ecosystem.config.js.
6. (اختياري، يوم) أضف SIGTERM/SIGINT handler في `src/instrumentation.ts` لإغلاق الـ in-flight requests بأمان.

**بعد هذه الخطوات** يمكن رفع الجاهزية إلى 🟢 GREEN.

---

## <a name="summary"></a>9. الملخص التنفيذي + خطة المعالجة

### 9.1 الأرقام الإجمالية

| البند | القيمة |
|---|---|
| **حجم المشروع** | 583,991 LOC (292,925 TS + 291,066 Python) |
| **عدد المسارات (API routes)** | 463 في 100 مجموعة |
| **عدد الوحدات (frontend modules)** | 17 |
| **عدد Prisma models** | 30 (18 auth + 10 predictions + 2 default) |
| **عدد قواعد البيانات (DBs)** | 7 موثّقة (3 متاحة فعليًا في sandbox) |
| **عدد خدمات PM2** | 7 |
| **عدد القواعد الدستورية** | 82 |
| **عدد شاشات UX** | 59 (موثّقة في حزمة UX) |
| **إجمالي dead code** | ~38,200 سطر (75+ ملف) |
| **التقييم الهندسي الإجمالي** | 28/60 (47%) |

### 9.2 إجابات الأسئلة الخمسة للمالك

| سؤال المالك | الإجابة المختصرة | الإجابة التفصيلية |
|---|---|---|
| **1. هل المشروع متوافق مع الدستور؟** | ⚠️ **جزئيًا (17 من 22 قاعدة حرجة)** | 14 ملتزم + 4 جزئيًا + 3 مخالفات حرجة + 2 غير محسومة |
| **2. هل هناك ملفات ميتة؟** | ✅ **نعم — 75+ ملف (~38,200 سطر)** | منها 30,881 سطر أرشيف توثيق + 5,942 سكرتبات diagnostic + 2,318 مكون ميت + 8 tombstone routes |
| **3. هل هناك تداخل أو تعارض؟** | ✅ **نعم — 16 حالة (5 حرجة + 7 متوسطة + 4 بسيطة)** | أهمها: 23 route mislabeled + admin auth split-brain + 4 شاشات alias + تعارض port 3000 |
| **4. هل هناك تعدد في المهام؟** | ✅ **نعم — 4 ازدواجيات حرجة + 5 تعددات مبررة** | 4 watchlist routes + 6 محركات معطّلة + 6 Map caches + 6 libs لقراءة الأسعار |
| **5. هل المشروع مبني على أسس هندسية سليمة؟** | ⚠️ **ضعيف (28/60)** | البنية 5/10 + الأداء 4/10 + الأمان 4/10 + الصيانة 4/10 + النشر 6/10 + المراقبة 5/10 |

### 9.3 الجاهزية النهائية: 🟡 YELLOW (ميل إلى 🔴)

**لا يُنصح بالانتقال للعمل الحي الكامل** حتى حل الـ 13 blocker حرج (3 أمني P0 + 3 دستوري P0 + 7 إنتاج P0).

### 9.4 خطة المعالجة المقترحة (مرتبة حسب الأولوية)

#### 🔴 Phase P0 — فوري (قبل أي عمل حي)

| # | الإجراء | الوقت المقدّر |
|---|---|---|
| 1 | Rotate DeepSeek API key + حذف fallback (`vps-service/ai/deepseek_news_service.py:42`) | 15 دقيقة |
| 2 | Rotate admin password + حذف `SESSION_HANDOFF_JIMMY.md` + `test_stats.js` من git history | 30 دقيقة |
| 3 | إضافة `requireAuthAsync` لـ 4 routes (`portfolio/accounts:40,70` + `user-posts/[id]:62-75` + `data-engine/control:297` + `alerts/quick-add`) | ساعة |
| 4 | إصلاح Google OAuth fail-open (`google-signin/route.ts:171`) | 15 دقيقة |
| 5 | حذف `--force` و `--force-with-lease` من `auto_git_sync.py:279,405` + `db-backup/route.ts:579,654` | 30 دقيقة |
| 6 | إنشاء `.env.example` + `.env.production` (NEXTAUTH_SECRET + SENTRY_DSN + GOOGLE_CLIENT_*) | ساعة |
| 7 | تحديث `Caddyfile` لإجبار HTTPS (`:80` redirect + `:443` + auto-TLS + security headers) | ساعة |
| 8 | احسم sandbox/prod build divergence (standalone) | 30 دقيقة |
| 9 | أصلح 3 npm scripts مكسورة (`check:guards` + `data:fill-missing`) | 15 دقيقة |

**إجمالي Phase P0**: ~5 ساعات.

#### 🟡 Phase P1 — عالي (خلال أسبوع)

1. Hash Bearer tokens في `api_tokens` table (sha256)
2. استبدال static admin_session بـ per-user JWT
3. استبدال `base64(user:pass)` admin token بـ random opaque token
4. توحيد `adminEmails` + إصلاح `tier='premium'` bug للأدمن (`google-signin/route.ts:294,355`)
5. استبدال `execSync` بـ `execFile` في `admin/git-files:145,159`
6. ترحيل `console.log` إلى `logger.ts` + حذف log للـ token prefix (`token-helper.ts:42`)
7. إزالة blue/indigo من 5 شاشات client-facing (Rule 30)
8. إكمال Rule 67b migration (calc_atr + calc_rsi)
9. إصلاح `admin/layout.tsx` localhost bypass (split-brain)
10. توحيد 23 route stub من `marketPulseProxy` (308 redirects)
11. توحيد `price_alerts` و `user_stock_watchlists`
12. إصلاح `#screener` bug (يعرض trading chart بدل screener)
13. حذف 4 محركات معطّلة (v82 + sniper + confluence_v3 + board_of_analysts)
14. إضافة rate limiting لـ admin/auth + alerts/quick-add + instapay/submit + redeem-promo
15. تفعيل ESLint rules تدريجيًا

#### 🟢 Phase P2 — متوسط (خلال شهر)

1. إكمال UnifiedTable migration (10 شاشات متبقية)
2. توحيد 5 watchlist routes
3. دمج 4 Map caches في cache-manager.ts
4. إزالة alias الشاشات الأربعة (`#analysis` + `#advanced-analysis` + `#v2-analysis`)
5. توحيد 5+ news routes
6. إنهاء WebSocket vs polling (اختر واحد)
7. إصلاح `PredictionTrackingDashboard.tsx` (نقل calculations إلى Python)
8. حذف dead code فوري (PredictionTrackingDashboard + null consts + AiPrediction type)
9. إضافة `pm2-logrotate` + PM2 healthcheck
10. إنشاء Prometheus `/metrics` endpoint
11. إضافة CI workflow file
12. إضافة graceful shutdown handlers

#### ⚪ Phase P3 — منخفض (خلال 3 أشهر)

1. تقسيم `AdminView.tsx` (2097 سطر) إلى 6 hub-components
2. تحويل `page.tsx` switch إلى config-driven router
3. تقسيم `SubscriptionView.tsx` (1791 سطر)
4. تقسيم أكبر 10 ملفات (MakerRadarTab 3764 + EnhancedPortfolioView 3477 + ...)
5. إزالة 7 dependencies غير مستخدمة
6. إنشاء Next.js Dockerfile + multi-stage build
7. إضافة e2e tests بـ Playwright
8. توثيق Prisma legacy models
9. ترحيل `scripts/archive_diagnostics/` + `patch_rootpage_v1-v5.py` إلى `archive/`
10. إزالة orphan exports
11. توحيد error messages (60% → 100% عربي)
12. توحيد pagination (3 أنظمة → 1)

### 9.5 ما لم أفعله (احترامًا للقيود)

- ❌ لم أُجرِ أي تعديل على الكود (read-only audit).
- ❌ لم أحذف أي ملف.
- ❌ لم أستخدم `git push --force` (Rule 81 محترَمة).
- ❌ لم أُسجّل أي secret حقيقي في التقرير (استخدمت mask).
- ✅ الوكلاء ألحقوا 8 أقسام في `worklog.md` (AUDIT-A إلى AUDIT-H) — هذا ضمن صلاحياتهم كـ worklog updates.

### 9.6 حدود الفحص (إفصاح)

1. **المحلي متأخر عن GitHub**: المحلي `ebb02ce` بينما remote أحدث بـ commitان (`39baced` + `2b3ef3f`). الفحص تم على المحلي. التحديثات الـ remote ربما عالجت بعض المشاكل — يحتاج تحقق بعد `git pull`.
2. **sandbox بدون DBs إنتاجية**: stocks.db + data_engine.db + intraday.db مفقودة، لذا لم أتمكن من اختبار الـ runtime behavior الفعلي للـ routes التي تقرأ منها.
3. **لم أُجرِ Agent Browser**: لم أتحقق بصريًا من الشاشات (تحتاج تفعيل dev server + بيانات).
4. **لم أُجرِ build/start/tests**: فقط فحص الكود الثابت.
5. **Python backend لم يُفحص بعمق**: vps-service/ يتطلب وكيل Python متخصص (خارج نطاق هذه المهمة — ركّزت على TS/Next.js).

### 9.7 خلاصة نهائية للمالك

#### السؤال: هل المشروع جاهز للعمل الحي الكامل؟

**الإجابة: لا.**

المشروع **جاهز بنسبة 47% فقط** (28/60). أمامه **13 blocker حرج** يجب حلها قبل أي deployment للإنتاج:

- **3 أمني P0**: أسرار مكشوفة + routes بدون auth + OAuth fail-open
- **3 دستوري P0**: `--force` + blue/indigo + canonical violations
- **7 إنتاج P0**: env vars ناقصة + لا HTTPS + scripts مكسورة + build divergence

#### التوصية النهائية لسوسو

**لا تنشر للإنتاج حتى:**
1. Rotate كل الأسرار المكشوفة (DeepSeek + admin password)
2. أصلح 4 routes بدون auth
3. أصلح Google OAuth fail-open
4. احذف `--force` من `auto_git_sync.py`
5. أنشئ `.env.production` + Caddyfile.production مع HTTPS
6. أصلح npm scripts المكسورة

**بعد هذه الـ 6 خطوات** (تقديريًا 5 ساعات عمل)، يصبح المشروع جاهزًا للإنتاج بنسبة ~70%. بقية الـ 30% هي تحسينات Phase P1/P2/P3.

### 9.8 القرارات المطلوبة من المالك

1. **هل تطلب مني تنفيذ Phase P0 الآن؟** (إصلاح الأسرار + auth + OAuth + Caddyfile + scripts) — يحتاج موافقتك لأنه تعديل كود.
2. **هل تريد مني مزامنة المحلي مع GitHub** (`git pull`) لفحص آخر commitين (`39baced` + `2b3ef3f`)؟
3. **هل تريد مني فحص Python backend بعمق** (وكيل متخصص)؟
4. **هل تريد تقريرًا منفصلًا لكل Phase P0/P1/P2/P3** بخطوات تنفيذ تفصيلية؟

---

**نهاية التقرير الشامل**

— **سوسو**، الرئيس التنفيذي التقني
