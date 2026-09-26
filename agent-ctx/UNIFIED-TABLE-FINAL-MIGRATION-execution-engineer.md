# UNIFIED-TABLE-FINAL-MIGRATION — مهندس تنفيذ

## المرجعيات المُطالعة قبل البدء
- `/home/z/my-project/worklog.md` (آخر ~60 سطر) — آخر تحديثات DOC-UPDATE-FINAL.
- `/home/z/my-project/src/components/shared/UnifiedTable.tsx` (الـ API الكامل + types).
- `/home/z/my-project/src/components/shared/UnifiedPublishButton.tsx` (props: content / title / image / filename / hashtags / variant).
- Canonical pattern: `src/components/analysis/market-analysis/SectorTrackingTab.tsx` (يستخدم UnifiedTable + expandable + UnifiedPublishButton).
- Previous migration context: `/home/z/my-project/agent-ctx/UNIFIED-TABLE-MIGRATION-FULL-execution-engineer.md`.

## خطة التنفيذ
- **Part 1**: ترحيل 6 شاشات بـ manual `<Table>` إلى `UnifiedTable`:
  1. `SimulationView.tsx` — 3 جداول (Stock List + Holdings + Transactions).
  2. `CryptoSimulationView.tsx` — 3 جداول (Coin List + Holdings + Transactions).
  3. `SuperLearningSystem.tsx` — 2 جدول (Sector Report + Engine Breakdown) + جدول Trades = 3 تم ترحيلهم.
  4. `CryptoPredictionGenerator.tsx` — 1 جدول (Predictions List).
  5. `DatabaseManagerFull.tsx` — 3 جداول (Tables List + Selected Table Rows + Schema Columns في AlertDialog).
  6. `HumanRecommendationsAdmin.tsx` — 1 جدول (Recommendations List مع expandable).

- **Part 2**: إضافة `UnifiedPublishButton` إلى 7 شاشات:
  1. `StocksView.tsx` ✓ (أُضيف)
  2. `StockScreenerAdvanced.tsx` ✓ (أُضيف)
  3. `MakerRadarTab.tsx` — موجود بالفعل (تحقق من import + استخدام)
  4. `PredictionTrackingView.tsx` — موجود بالفعل
  5. `ExpertRecommendationsPanel.tsx` — موجود بالفعل
  6. `EnhancedPortfolioView.tsx` — موجود بالفعل
  7. `EnhancedWatchlistView.tsx` ✓ (أُضيف — الـ import كان موجوداً لكن الزر لم يكن مستخدماً)

## قواعد الترحيل لكل ملف:
- استبدال `<Table><TableHeader><TableBody>` بـ `<UnifiedTable>` + `columns: Column<T>[]`.
- إضافة `columnToggle` + `filterable` props للأعمدة المناسبة.
- الحفاظ على كل البيانات/الـ state/الـ API calls/الـ handlers.
- استخدام `rowClassName` للتلوين الشرطي للصفوف (مثل win/loss).
- استخدام `onRowClick` للحفاظ على الـ row click handlers.
- استخدام `expandable` + `expandRender` للجداول اللي فيها expandable rows (مثل HumanRecommendationsAdmin).

## ملاحظات تقنية مهمة
1. **CRLF → LF**: ملفا SimulationView.tsx و CryptoSimulationView.tsx كانوا بـ CRLF line endings — تم تحويلهم إلى LF أولاً (sed) قبل البدء في الـ edits.
2. **DatabaseManagerFull جدول الصفوف المختارة**: كان به server-side sorting عبر props.onSort — تم الحفاظ عليه بإضافة Select dropdown للـ sort فوق الـ UnifiedTable بدلاً من الـ header click.
3. **SuperLearningSystem persona benchmark matrix**: جدول مقارنة معقد بـ sticky columns + special header formatting — تُرك كما هو لأنه لا يناسب UnifiedTable.

## التقدّم النهائي
- [x] Batch 1: SimulationView + CryptoSimulationView + SuperLearningSystem (lint clean)
- [x] Batch 2: CryptoPredictionGenerator + DatabaseManagerFull + HumanRecommendationsAdmin (lint clean)
- [x] Batch 3: StocksView + StockScreenerAdvanced + MakerRadarTab-verify (lint clean)
- [x] Batch 4: PredictionTrackingView-verify + ExpertRecommendationsPanel-verify + EnhancedPortfolioView-verify + EnhancedWatchlistView (lint clean)

## ملخص نهائي
- **6 شاشات تم ترحيلها إلى UnifiedTable** بإجمالي **14 جدول** manual تم استبدالها:
  - SimulationView: 3 جداول (stock list + holdings + transactions)
  - CryptoSimulationView: 3 جداول (coin list + holdings + transactions)
  - SuperLearningSystem: 3 جداول (sector report + engine breakdown + trades)
  - CryptoPredictionGenerator: 1 جدول (predictions list)
  - DatabaseManagerFull: 3 جداول (tables list + selected table rows + schema columns)
  - HumanRecommendationsAdmin: 1 جدول (recommendations list مع expandable)

- **3 شاشات أُضيف إليها UnifiedPublishButton فعلياً**:
  - StocksView.tsx ✓
  - StockScreenerAdvanced.tsx ✓
  - EnhancedWatchlistView.tsx ✓ (الـ import كان موجوداً لكن الزر لم يكن مستخدماً)

- **4 شاشات تُحقق منها أن UnifiedPublishButton موجود بالفعل** (من migration سابق):
  - MakerRadarTab.tsx ✓
  - PredictionTrackingView.tsx ✓
  - ExpertRecommendationsPanel.tsx ✓
  - EnhancedPortfolioView.tsx ✓

- **lint**: نظيف بعد كل batch (`bun run lint` يمر بدون أخطاء).

## الإجراءات التالية المقترحة (لا تتطلب موافقة المالك):
- لا شيء — المهمة كاملة.
- لو المالك رغب: ترحيل persona benchmark matrix في SuperLearningSystem (يحتاج تصميم خاص).
