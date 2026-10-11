# Dead Components Archive — 2026-10-12 (Garage Lot #2)

> **Policy:** Rule 16 (VERIFY-BEFORE-DELETE) + Rule 25 (refactoring-gated) — لا حذف نهائي.
> Orphan components تنقل لـ archive/ (الـ "garage") بدلاً من الحذف، مع README يوثّق ليه اتأرشفوا.

## أمتى (When)
- **Date:** 2026-10-12
- **Task ID:** `ORPHAN-GARAGE-COLLECTOR`
- **Agent:** `general-purpose (Orphan Garage Collector)`
- **Source Task:** `MAESTRO-GHOST-HUNT` (post-cleanup garage sweep)

## ليه اتأرشفوا (Why)
كل ملف هنا اتأرشف لأنه **orphan** — مفيش أي importer حي في `src/` أو `vps-service/` بـ يستورده.
التحقق تم بـ `Grep` عن:
1. `from '...<ComponentName>'` (static imports)
2. `require('...<ComponentName>')` (CommonJS dynamic require)
3. `import('...<ComponentName>')` (ES dynamic import)

تم استثناء:
- self-imports (الملف نفسه)
- `archive/` (النسخ المؤرشفة القديمة)
- `index.ts` re-exports

## اللي اتأرشف (What) — 9 files (4,408 LOC)

| # | Component | LOC | Original Path (was) | Reason |
|---|-----------|-----|---------------------|--------|
| 1 | `crypto/CryptoTradingChartView.tsx` | 275 | `src/modules/crypto/components/CryptoTradingChartView.tsx` | 0 importers (page.tsx line 272 = `const X = null` stub, مش import) |
| 2 | `crypto/CryptoScreenerView.tsx` | 677 | `src/modules/crypto/components/CryptoScreenerView.tsx` | 0 importers (page.tsx line 271 = `const X = null` stub) |
| 3 | `crypto/CryptoAdditionalViews.tsx` | 34 | `src/modules/crypto/components/CryptoAdditionalViews.tsx` | 0 importers (zero matches في كل الـ codebase) |
| 4 | `crypto/CryptoAdvancedAnalysisView.tsx` | 688 | `src/modules/crypto/components/CryptoAdvancedAnalysisView.tsx` | 0 importers (page.tsx line 273 = `const X = null` stub) |
| 5 | `dashboard/PredictionsBacktestTable.tsx` | 533 | `src/modules/dashboard/components/PredictionsBacktestTable.tsx` | 0 importers (لقيته في dashboard/, مش predictions/ حسب ما الـ task description قال) |
| 6 | `market-analysis/AnalysisFlowDiagram.tsx` | 326 | `src/modules/market-analysis/components/AnalysisFlowDiagram.tsx` | 0 importers (لقيته في market-analysis/, مش reports/) |
| 7 | `stock-analysis/DataCoverageBanner.tsx` | 209 | `src/modules/stock-analysis/components/DataCoverageBanner.tsx` | 0 importers (لقيته في stock-analysis/, مش admin/) |
| 8 | `admin/HumanRecommendationsAdmin.tsx` | 1028 | `src/modules/admin/components/HumanRecommendationsAdmin.tsx` | 0 importers |
| 9 | `personalized/lib/personalized-radar.ts` | 583 | `src/modules/personalized/lib/personalized-radar.ts` | 0 importers (الـ "matches" كلها كانت strings للـ tab values + testids, مش imports) |

**Total archived:** 9 files / 4,408 LOC

## ملحوظة مهمة — proxy-client.ts NOT orphan

الـ task description صنّف `src/modules/reports/lib/proxy-client.ts` (438 LOC) كـ "true orphan".
بعد الفحص بـ Grep لقيته **مش orphan** — فيه 3 importers حية:

```typescript
// src/modules/reports/components/ReportsView.tsx:67-77
import {
  fetchDailyReport, fetchWeeklyReport, exportReportToPng, triggerPrint,
  safeFmtNum, safeFmtPct, safeFmtArDate,
  type DailyReportPayload, type WeeklyReportPayload,
} from '../lib/proxy-client';

// src/modules/reports/components/DailyMarketReport.tsx:59-68
import {
  fetchDailyReport, exportReportToPng, triggerPrint,
  safeFmtNum, safeFmtPct, safeFmtArDate,
  type DailyReportPayload, type ReportStockMini,
} from '../lib/proxy-client';

// src/modules/reports/components/StockAnalysisReport.tsx:81-86
import {
  exportReportToPng, triggerPrint, safeFmtNum, safeFmtPct,
} from '../lib/proxy-client';
```

→ **proxy-client.ts اتساب في مكانه** (`src/modules/reports/lib/proxy-client.ts`) — مش orphan.

## ازاي نرجّعه (Restore Instructions)

لو حابب ترجّع أي ملف لـ `src/`:

```bash
cd /home/z/my-project

# Example: restore CryptoTradingChartView.tsx
git mv archive/dead-components-20261012/crypto/CryptoTradingChartView.tsx \
       src/modules/crypto/components/CryptoTradingChartView.tsx

# Verify build:
bun run lint
```

بعد الـ restore لازم:
1. تضيف `import CryptoTradingChartView from '@/modules/crypto/components/CryptoTradingChartView'` في الـ consumer (page.tsx أو view.tsx).
2. تشيل stub `const CryptoTradingChartView = null;` من `src/app/page.tsx` (لو موجود).
3. تشغّل `bun run lint` للتأكد إن البناء سليم.

## المراجع (References)
- `Documentation/00-CONSTITUTION.md` Rule 16 (VERIFY-BEFORE-DELETE)
- `Documentation/00-CONSTITUTION.md` Rule 25 (refactoring-gated)
- `archive/dead-components-2026-10-08/` — الـ archive الأول من نفس الـ components (P1-CLEANUP)
- worklog.md entry: `ORPHAN-GARAGE-COLLECTOR` (2026-10-12)

## ملاحظة عن التطابق مع `archive/dead-components-2026-10-08/`
الـ 8 orphan components (مش personalized-radar.ts) عندهم **نسخة مطابقة** في `archive/dead-components-2026-10-08/` من P1-CLEANUP. ده معناه إن الـ "garage" دلوقتي فيه نسختين من نفس الكود (8 files × 2). ده ليس تكراراً سيئاً — الـ 20261012 هي النسخة "النهائية" (الأصل اتشال من src/)، والـ 2026-10-08 هي النسخة "التاريخية" (الأصل كان لسه في src/). لو حابب تختصر المساحة في المستقبل، احذف الـ 2026-10-08 (التاريخية) وسيب الـ 20261012 (النهائية).
