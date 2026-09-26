# UNIFIED-TABLE-MIGRATION-FULL — مهندس تنفيذ

## المرجعيات المُطالعة قبل البدء
- `/home/z/my-project/worklog.md` (آخر ~100 سطر) — آخر تحديثات DOC-UPDATE-FINAL.
- `/home/z/my-project/src/components/shared/UnifiedTable.tsx` (الـ API الكامل + types).
- `/home/z/my-project/src/components/shared/UnifiedPublishButton.tsx` (props: content / title / image / filename / hashtags / variant).
- Canonical pattern: `src/components/analysis/market-analysis/SectorTrackingTab.tsx` (يستخدم UnifiedTable + expandable).

## خطة التنفيذ (4 دفعات × 5 ملفات)

### Batch 1 (الأهم):
1. `src/components/predictions/MakerRadarTab.tsx` — StockTable (17 عمود، 1 table).
2. `src/components/predictions/PredictionTrackingView.tsx`
3. `src/components/analysis/ExpertRecommendationsPanel.tsx`
4. `src/components/analysis/market-analysis/LiveTrackingTab.tsx`
5. `src/components/analysis/market-analysis/SectorTrackingTab.tsx` — canonical، غالباً لا يحتاج تغيير جوهري.

### Batch 2:
6. `src/components/portfolio/EnhancedPortfolioView.tsx`
7. `src/components/portfolio/RoboAdvisorPanel.tsx`
8. `src/components/watchlist/EnhancedWatchlistView.tsx`
9. `src/components/reports/DailyMarketReport.tsx`
10. `src/components/reports/ReportsView.tsx`

### Batch 3:
11. `src/components/screener/BottomPanel.tsx`
12. `src/components/simulation/SimulationView.tsx`
13-16. الـ 4 شاشات crypto.

### Batch 4 (admin):
17-20. الـ 4 شاشات admin.

## قواعد الترحيل لكل ملف:
- استبدال `<Table><TableHeader><TableBody>` بـ `<UnifiedTable>` + `columns: Column<T>[]`.
- إضافة `UnifiedPublishButton` حيث يوجد محتوى قابل للنشر.
- إضافة `columnToggle` + `filterable` props للأعمدة المناسبة.
- الحفاظ على كل البيانات/الـ state/الـ API calls/الـ handlers.
- استخدام `rowClassName` للتلوين الشرطي للصفوف.
- استخدام `onRowClick` للحفاظ على الـ row click handlers.
- استخدام `expandable` + `expandRender` للجداول اللي فيها expandable rows.

## التقدّم:
- [ ] Batch 1
- [ ] Batch 2
- [ ] Batch 3
- [ ] Batch 4

## ملخص نهائي (يُكتب بعد الانتهاء):
TODO
