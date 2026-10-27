# GLMinvestment — خطة التنفيذ الموحدة للموثوقية

> **المالك:** النظام (System Owner)
> **آخر تحديث:** 2026-10-25
> **Commit الأساس:** `b4516b4` على `main`
> **المبدأ:** نحسم الشكوك باختبار ميداني قابل لإعادة التشغيل. لا يُغلق أي بند بمجرد تعديل الكود؛ لا بد من اختبار ناجح ودليل قابل للمراجعة.

---

## حالات المهام

`OPEN` → `IN_PROGRESS` → `IMPLEMENTED` → `TESTED` → `ACCEPTED` / `REJECTED`

---

# المرحلة صفر — تثبيت نقطة البداية

**المالك:** النظام | **الأولوية:** P0 | **الحالة:** `TESTED`

- [x] تثبيت commit: `b4516b4`
- [x] توثيق محدّث (7 ملفات أساسية + SYSTEM-BRAIN)
- [x] اختبارات rescue backend: 34/34 PASS
- [x] اختبارات الواجهة: 10/10 PASS (fabrication-guard + api-shape + null-handling)
- [x] fabrication patterns: 0 في src/ (تم الإغلاق + اختبار آلي)
- [x] error boundaries: 6/6 views
- [x] React.memo: 5 heavy components
- [x] null→0 display: 5 ملفات مُصلحة (ShareButton, UserPublishingView, DailyPicksPoster, WatchlistIntelligenceSection, TradingJournalView)
- [ ] DBs integrity check (Bravo)
- [ ] VPS vs GitHub comparison (Bravo)

---

# المرحلة الرابعة — ألفا: سلامة عرض البيانات

**المالك:** Alpha | **الأولوية:** P0 | **الحالة:** `TESTED` ✅

## 4.1 Fabrication Patterns — `TESTED` ✅

| # | الملف | النمط | قبل | بعد | الحالة |
|---|------|------|------|------|--------|
| 1 | `v2/liquidity-radar/route.ts:159` | `entry*0.97` | fabricated | NULL | ✅ |
| 2 | `v2/liquidity-radar/route.ts:161` | `entry+1.5*risk` | fabricated | NULL | ✅ |
| 3 | `StockDetail.tsx:245` | `current*1.03` | fabricated | NULL | ✅ |
| 4 | `StockDetail.tsx:247` | `current*0.97` | fabricated | NULL | ✅ |
| 5 | `helpers.ts:152` | `current*1.03` | fabricated | NULL | ✅ |
| 6 | `helpers.ts:154` | `current*0.97` | fabricated | NULL | ✅ |
| 7 | `StockDetail.tsx:172` | `entryPrice*0.99` | fabricated | undefined | ✅ |
| 8 | `StockDetail.tsx:173` | `entryPrice*1.01` | fabricated | undefined | ✅ |
| 9 | `helpers.ts:79` | `entryPrice*0.99` | fabricated | undefined | ✅ |
| 10 | `helpers.ts:80` | `entryPrice*1.01` | fabricated | undefined | ✅ |
| 11 | `dynamic-analysis-engine.ts:513` | `entry*1.05` | fabricated | 0 | ✅ |
| 12 | `expert-analysis.ts:605-621` | `entry*1.10/0.90/1.05/0.95` | fabricated | NULL | ✅ |
| 13 | `expert-analysis.ts:614` | `target1*1.20/0.80` | fabricated | NULL | ✅ |
| 14 | `store.ts:202-203` | `price*1.005/0.995` | fabricated | NULL | ✅ |
| 15 | `store-modules/helpers.ts:116-117` | `price*1.005/0.995` | fabricated | NULL | ✅ |
| 16 | `GateAnalysisView.tsx:123-130` | `price*0.95/0.90/1.05/1.10` | fabricated | 0/real | ✅ |
| 17 | `TradingViewChart.tsx:1358-1359` | `lastClose*1.05/0.95` | fabricated | 0 | ✅ |
| 18 | `screener-advanced/helpers.ts:194-207` | `support*1.02/0.97, current*0.95/1.10` | fabricated | real/-1 | ✅ |
| 19 | `market-analysis/helpers.ts:108-121` | `entryPrice*0.90/1.08/1.12/0.93` | fabricated | 0 | ✅ |
| 20 | `market-analysis/helpers.ts:672-680` | `entryPrice*0.90/1.08/1.10` | fabricated | 0 | ✅ |

**Automated verification:** `npx vitest run src/__tests__/components/fabrication-guard.test.ts` → **2/2 PASS** (0 patterns found)

## 4.2 Error Boundaries — `TESTED` ✅

| View | Has ErrorBoundary? | Status |
|------|-------------------|--------|
| LiquidityRadarView | ✅ | page.tsx |
| AccuracyDashboard | ✅ | MakerRadarTab.tsx |
| BagHolderRescuePanel | ✅ | page.tsx |
| PersonalizedRadarTab | ✅ | MakerRadarTab.tsx |
| MarketAnalysisView | ✅ | page.tsx |
| EnhancedPortfolioView | ✅ | page.tsx |

## 4.3 React.memo — `TESTED` ✅

| Component | LOC | Memoized? |
|-----------|-----|-----------|
| TradingViewChart | 1895 | ✅ |
| PremiumChart | 530 | ✅ |
| BagHolderRescuePanel | 1160 | ✅ |
| InstitutionalDecisionPanel | 708 | ✅ |
| CanonicalWhoIsBuyingBanner | 366 | ✅ |

## 4.4 Component Tests — `TESTED` ✅

| Test File | Tests | Result |
|-----------|-------|--------|
| `fabrication-guard.test.ts` | 2 | ✅ PASS |
| `api-shape.test.ts` | 3 | ✅ PASS |
| `null-handling.test.ts` | 5 | ✅ PASS |
| **Total** | **10** | **10/10 PASS** |

**Command:** `npx vitest run src/__tests__/components/`
**Duration:** 2.14s
**Exit code:** 0

## 4.5 Null Handling Fix — `TESTED` ✅

5 files fixed — null financial values now display "—" instead of "0.00":
- `ShareButton.tsx` — targetPrice, stopLoss
- `UserPublishingView.tsx` — entry_price, target_price, stop_loss
- `DailyPicksPoster.tsx` — target_price, stop_loss
- `WatchlistIntelligenceSection.tsx` — target
- `TradingJournalView.tsx` — entry_price

**Verified by:** `null-handling.test.ts` (5/5 PASS)

## 4.6 Findings

| Finding | Severity | Status |
|---------|----------|--------|
| TradingViewChart has local indicator calculations (calcSMA, calcEMA, etc.) | LOW | Documented — chart display only, NOT financial decisions |
| PremiumChart uses backend indicators only | ✅ | No action needed |
| Turbopack CJS leak (dev mode only) | MEDIUM | Pre-existing, works on Webpack production |

## 4.7 Remaining (P2 — deferred)

| Task | Priority | Blocker |
|------|----------|---------|
| Store subscription migration (40+ files) | P2 | Large refactor |
| UnifiedEmptyState adoption (13→200) | P2 | Non-critical |
| UI-level API tests (blocked by Turbopack) | P2 | Needs Webpack or Turbopack fix |

---

# المراحل المتبقية (Bravo + System)

| المرحلة | المالك | الحالة |
|---------|--------|--------|
| 1: سلامة البيانات | Bravo | `OPEN` |
| 2: تدقيق المعادلات | Bravo | `OPEN` |
| 3: توحيد القرار | Bravo | `OPEN` |
| 5: مواصفات المنسّق والمنفّذ | System+Bravo | `OPEN` |
| 6: اختبار تاريخي | System+Bravo | `OPEN` |
| 7: تكامل النظام | الجميع | `OPEN` |
| 8: النشر | النظام | `OPEN` |

---

# بوابات القبول

| البوابة | المعيار | الحالة |
|---------|---------|--------|
| ✅ الواجهة — لا بيانات مالية مضللة | 0 fabrication patterns | **PASS** |
| ✅ الواجهة — error boundaries | 6/6 views | **PASS** |
| ✅ الواجهة — React.memo | 5/5 heavy components | **PASS** |
| ✅ الواجهة — component tests | 10/10 PASS | **PASS** |
| ✅ الواجهة — null handling | 5 files fixed + tested | **PASS** |
| ⏳ البيانات | لا تلوث بين الأسواق | Bravo |
| ⏳ الحسابات | معادلات مختبرة | Bravo |
| ⏳ القرار | مصدر واحد | Bravo |
| ⏳ النظام | اختبار تاريخي | System |

---

*Alpha Phase 4 COMPLETE. All gates passed. Waiting for Bravo Phase 1-3 + DBs.*
