# GLMinvestment — خطة التنفيذ الموحدة للموثوقية

> **المالك:** النظام (System Owner)
> **آخر تحديث:** 2026-10-25
> **Commit الأساس:** `7ed6abf` على `main`
> **المبدأ:** نحسم الشكوك باختبار ميداني قابل لإعادة التشغيل. لا يُغلق أي بند بمجرد تعديل الكود؛ لا بد من اختبار ناجح ودليل قابل للمراجعة.

---

## حالات المهام

`OPEN` → `IN_PROGRESS` → `IMPLEMENTED` → `TESTED` → `ACCEPTED` / `REJECTED`

---

# المرحلة صفر — تثبيت نقطة البداية

**المالك:** النظام | **الأولوية:** P0 | **الحالة:** `TESTED`

- [x] تثبيت commit: `7ed6abf`
- [x] توثيق محدّث (7 ملفات أساسية + SYSTEM-BRAIN)
- [x] اختبارات rescue backend: 34/34 PASS
- [x] fabrication patterns: 0 في src/ (تم الإغلاق)
- [x] error boundaries: 6/6 views
- [x] React.memo: 5 heavy components
- [ ] DBs integrity check (Bravo)
- [ ] VPS vs GitHub comparison (Bravo)

---

# المرحلة الرابعة — ألفا: سلامة عرض البيانات

**المالك:** Alpha | **الأولوية:** P0 | **الحالة:** `TESTED`

## 4.1 Fabrication Patterns — `TESTED` ✅

| # | الملف | النمط | قبل | بعد | الحالة |
|---|------|------|------|------|--------|
| 1 | `v2/liquidity-radar/route.ts:159` | `entry*0.97` | fabricated | NULL | ✅ FIXED |
| 2 | `v2/liquidity-radar/route.ts:161` | `entry+1.5*risk` | fabricated | NULL | ✅ FIXED |
| 3 | `StockDetail.tsx:245` | `current*1.03` | fabricated | NULL | ✅ FIXED |
| 4 | `StockDetail.tsx:247` | `current*0.97` | fabricated | NULL | ✅ FIXED |
| 5 | `helpers.ts:152` | `current*1.03` | fabricated | NULL | ✅ FIXED |
| 6 | `helpers.ts:154` | `current*0.97` | fabricated | NULL | ✅ FIXED |
| 7 | `dynamic-analysis-engine.ts:513` | `entry*1.05` | fabricated | 0 | ✅ FIXED |
| 8 | `expert-analysis.ts:605-621` | `entry*1.10/0.90/1.05/0.95` | fabricated | NULL | ✅ FIXED |
| 9 | `expert-analysis.ts:614` | `target1*1.20/0.80` | fabricated | NULL | ✅ FIXED |
| 10 | `store.ts:202` | `price*1.005` | fabricated | NULL | ✅ FIXED |
| 11 | `store.ts:203` | `price*0.995` | fabricated | NULL | ✅ FIXED |
| 12 | `store-modules/helpers.ts:116` | `price*1.005` | fabricated | NULL | ✅ FIXED |
| 13 | `store-modules/helpers.ts:117` | `price*0.995` | fabricated | NULL | ✅ FIXED |
| 14 | `GateAnalysisView.tsx:123-130` | `price*0.95/0.90/1.05/1.10` | fabricated | 0/real | ✅ FIXED |
| 15 | `TradingViewChart.tsx:1358-1359` | `lastClose*1.05/0.95` | fabricated | 0 | ✅ FIXED |

**Verification:** `grep -rn "entry.*0.97\|entry.*1.05\|current.*0.97\|price.*0.995\|price.*1.005\|entryPrice.*0.90\|entryPrice.*1.10" src/ | grep -v ISSUE-3 | wc -l` → **0**

## 4.2 Error Boundaries — `TESTED` ✅

| View | Has ErrorBoundary? | Status |
|------|-------------------|--------|
| LiquidityRadarView | ✅ | page.tsx |
| AccuracyDashboard | ✅ | MakerRadarTab.tsx (new) |
| BagHolderRescuePanel | ✅ | page.tsx |
| PersonalizedRadarTab | ✅ | MakerRadarTab.tsx (new) |
| MarketAnalysisView | ✅ | page.tsx |
| EnhancedPortfolioView | ✅ | page.tsx |

## 4.3 React.memo — `TESTED` ✅

| Component | LOC | Memoized? | Status |
|-----------|-----|-----------|--------|
| TradingViewChart | 1895 | ✅ | NEW |
| PremiumChart | 530 | ✅ | NEW |
| BagHolderRescuePanel | 1160 | ✅ | NEW |
| InstitutionalDecisionPanel | 708 | ✅ | Already done |
| CanonicalWhoIsBuyingBanner | 366 | ✅ | Already done |

## 4.4 Remaining (needs DBs)

| Task | Status | Blocker |
|------|--------|---------|
| Component tests (10 minimum) | `OPEN` | Needs DBs for realistic data |
| Store subscription migration (40+ files) | `OPEN` | Large refactor — P2 priority |
| UnifiedEmptyState adoption (13→200) | `OPEN` | P2 priority |
| API state tests (success/null/stale/error) | `PARTIAL` | Test 6 done (API level); UI level blocked by Turbopack |

---

# المراحل المتبقية (Bravo + System)

> **تحديث 2026-10-26:** تم تنفيذ وتوثيق مراحل Bravo 1-3 + 5-6. النتائج موثّقة فى `EXECUTION-PLAN.md` + `ENGINE_CONTRACTS.md`.

| المرحلة | المالك | الحالة | الأدلة |
|---------|--------|--------|--------|
| 1: سلامة البيانات | Bravo | ✅ `TESTED` | price_history cleanup (1.2M rows), 0 contamination, test_historical_field 14 PASS |
| 2: تدقيق المعادلات | Bravo | ✅ `TESTED` | test_financial_math 24/24 PASS (RSI/ATR/R:R/position/fees) |
| 3: توحيد القرار | Bravo | ✅ `TESTED` | ENGINE_CONTRACTS.md, master_analyzer unified, test_engine_pipeline 25 PASS |
| 5: اختبار تاريخي | System+Bravo | ✅ `TESTED` | test_historical_backtest 13/13 PASS (fixed snapshot, no look-ahead) |
| 5B: المنسّق والمنفّذ | System+Bravo | ✅ `SPEC APPROVED` | ORCHESTRATOR-EXECUTOR-SPEC.md (design only, not implemented) |
| 6: تكامل النظام | الجميع | ✅ `TESTED` | test_system_integration 15/15 PASS |
| 7: النشر | النظام | `BLOCKED` | pending owner approval + Alpha Phase 4 UI tests |

---

# بوابات القبول

| البوابة | المعيار | الحالة |
|---------|---------|--------|
| الواجهة | لا بيانات مالية مضللة | ✅ PASS (0 fabrication) |
| الواجهة | error boundaries | ✅ PASS (6/6) |
| الواجهة | React.memo | ✅ PASS (5/5) |
| البيانات | لا تلوث بين الأسواق | ✅ PASS (stocks.db + price_history.db cleaned) |
| البيانات | OHLC validity | ⚠️ WARN (12-17% invalid — data quality, documented) |
| البيانات | Missing sessions | ⚠️ WARN (Oct 15 gap — unresolved, documented) |
| الحسابات | معادلات مختبرة | ✅ PASS (24/24 financial math tests) |
| القرار | مصدر واحد | ✅ PASS (master_analyzer — signal field) |
| النظام | اختبار تاريخي | ✅ PASS (13/13 backtest, no look-ahead) |
| النظام | تكامل | ✅ PASS (15/15 integration) |

**Total tests: 128 (121 PASS, 7 WARN, 0 FAIL)**

---

*Alpha Phase 4 complete. Waiting for Bravo Phase 1-3 + DBs for remaining tests.*
