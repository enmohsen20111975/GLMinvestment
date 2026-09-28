# 📋 Execution Checklist — Phase 5-7 (Module Reorganization)

> **Created:** 2026-09-30
> **Rollback Tag:** `v-reorg-phase-4-complete` (نقطة رجوع آمنة)
> **Constitution Rules:** 1, 4, 5, 16, 25, 27, 32, 55-59

---

## Phase 5: توحيد DB Layer (20+ helpers → 4-5 canonical)

### Checklist قبل البدء:
- [x] قراءة الدستور (القواعد 1, 5, 6, 12, 27, 32)
- [x] إنشاء rollback tag: `v-reorg-phase-4-complete`
- [ ] جرد كل ملفات DB helpers في `src/lib/`
- [ ] تحديد الـ canonical files (4-5 ملفات)
- [ ] توثيق الخطة في `Documentation/`

### تنفيذ Phase 5:
- [ ] دمج `egx-db.ts` + `new-db.ts` + `db-helpers.ts` + `db-v2.ts` → `lib/db/stocks.ts`
- [ ] دمج `finance-db.ts` + `flutter-sqlite-fallback.ts` → `lib/db/finance.ts`
- [ ] نقل `radar-db.ts` + `radar-cache.ts` → `modules/radar/lib/` (تم بالفعل في Phase 3)
- [ ] إنشاء `lib/db/index.ts` كـ public interface
- [ ] تحديث كل الـ imports في `src/` (ممكن 100+ ملف)
- [ ] حذف الـ dead DB helpers (بعد التحقق من 0 importers)

### اختبارات Phase 5 القاسية:
- [ ] `bun run lint` → exit 0
- [ ] `bun run test` → كل الـ tests pass (259+)
- [ ] `curl localhost:3001/` → HTTP 200
- [ ] `curl localhost:3001/api/health` → HTTP 200 + كل الـ DBs reachable
- [ ] `curl localhost:3001/api/maker-radar` → HTTP 200 + بيانات
- [ ] `curl localhost:3001/api/stocks` → HTTP 200 + بيانات
- [ ] `curl localhost:3001/api/predictions/honest-tracking/list` → HTTP 200 + بيانات
- [ ] فحص Agent Browser: 3 شاشات (stocks + radar + recommendations)

### توثيق Phase 5:
- [ ] تحديث `Documentation/01-PROJECT_ANATOMY.md` بقسم DB الجديد
- [ ] تحديث `Documentation/00-CONSTITUTION.md` (آخر تحديث)
- [ ] إنشاء `agent-ctx/REORG-PHASE-5-REPORT.md`

### رفع Phase 5:
- [ ] `git add -A`
- [ ] `git commit -m "refactor: Phase 5 — DB layer consolidation"`
- [ ] `git tag v-reorg-phase-5-complete`
- [ ] `git push origin main --tags`

---

## Phase 6: نقل باقي 10 موديولات Frontend

### Checklist قبل البدء:
- [ ] التأكد إن Phase 5 اتعملها commit + tag
- [ ] جرد كل components في كل domain

### تنفيذ Phase 6 (كل موديول على حدة):
- [ ] Module: `stock-analysis/` (StockDetail + ComprehensiveStockAnalysis)
- [ ] Module: `predictions/` (PredictionTrackingView + PersonaTab + DualTrackView)
- [ ] Module: `portfolio/` (EnhancedPortfolioView + RoboAdvisorPanel)
- [ ] Module: `screener/` (StockScreenerAdvanced)
- [ ] Module: `market-analysis/` (MarketAnalysisView + SectorTrackingTab)
- [ ] Module: `news/` (NewsFeedView)
- [ ] Module: `admin/` (DatabaseManagerFull + SystemTopologyTab)
- [ ] Module: `crypto/` (CryptoAdvancedAnalysisView)
- [ ] Module: `education/` (AcademyView + LearningView)
- [ ] Module: `reports/` (ReportsView + WeeklyReportTab)
- [ ] Module: `dashboard/` (DashboardView + widgets)

### لكل موديول:
- [ ] `mkdir -p src/modules/<module>/components`
- [ ] `git mv` كل component
- [ ] تحديث كل imports
- [ ] إنشاء `index.ts`
- [ ] `bun run lint` بعد كل موديول

### اختبارات Phase 6 القاسية:
- [ ] `bun run lint` → exit 0
- [ ] `bun run test` → كل الـ tests pass
- [ ] `curl localhost:3001/` → HTTP 200
- [ ] فحص Agent Browser: كل الشاشات بتفتح

### توثيق Phase 6:
- [ ] إنشاء `agent-ctx/REORG-PHASE-6-REPORT.md`

### رفع Phase 6:
- [ ] `git commit -m "refactor: Phase 6 — 11 frontend modules created"`
- [ ] `git tag v-reorg-phase-6-complete`
- [ ] `git push origin main --tags`

---

## Phase 7: توثيق المعمارية الجديدة

### تنفيذ Phase 7:
- [ ] إنشاء `Documentation/MODULE_CATALOG.md` (كتالوج كل موديول)
- [ ] إنشاء `Documentation/ARCHITECTURE_DIAGRAM.md` (مخطط المعمارية)
- [ ] إنشاء `Documentation/MIGRATION_GUIDE.md` (دليل الترحيل)
- [ ] تحديث `Documentation/00-CONSTITUTION.md` (إضافة Rule 60: MODULE-SYSTEM)
- [ ] تحديث `Documentation/01-PROJECT_ANATOMY.md`
- [ ] تحديث `Documentation/02-SCREENS_AND_COMPONENTS.md`
- [ ] تحديث `Documentation/SYSTEM_HOW_IT_THINKS.md`
- [ ] تحديث `Documentation/README.md`

### اختبارات Phase 7:
- [ ] كل الـ docs متسقة (no broken links)
- [ ] `bun run lint` → exit 0
- [ ] `bun run test` → كل الـ tests pass

### رفع Phase 7 النهائي:
- [ ] `git commit -m "docs: Phase 7 — module catalog + architecture docs"`
- [ ] `git tag v-reorg-complete`
- [ ] `git push origin main --tags`

---

## 🔄 نقاط الرجوع (Rollback Points)

| Tag | المرحلة | الحالة |
|-----|---------|--------|
| `v-reorg-phase-4-complete` | قبل Phase 5 | ✅ تم |
| `v-reorg-phase-5-complete` | بعد Phase 5 | ⏳ |
| `v-reorg-phase-6-complete` | بعد Phase 6 | ⏳ |
| `v-reorg-complete` | نهاية Phase 7 | ⏳ |

**للرجوع:** `git checkout v-reorg-phase-X-complete` + `git reset --hard`

---

## 🚨 قواعد الطوارئ

1. **لو فشلت Phase 5:** `git checkout v-reorg-phase-4-complete` + `git reset --hard`
2. **لو فشلت Phase 6:** `git checkout v-reorg-phase-5-complete` + `git reset --hard`
3. **لو فشلت Phase 7:** `git checkout v-reorg-phase-6-complete` + `git reset --hard`
4. **لو الـ app وقع:** `pm2 restart all` + فحص `dev.log`
