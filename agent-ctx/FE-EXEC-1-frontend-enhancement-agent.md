# Task ID: FE-EXEC-1
**Agent**: Frontend Enhancement Agent
**File**: `/home/z/my-project/src/components/reports/ExecutiveReportView.tsx`
**Status**: ✅ COMPLETE

## Summary
Enhanced the Executive Report dashboard (ملخص التوقعات) with 4 changes:
1. Added "اليوم" (1d) and "أمس" (2d) timeframe options
2. Added Top Losers highlight card (rose theme)
3. Added Missed Opportunities section (4 categories, 2x2 grid)
4. Added Total Profit (إجمالي الربح) as 5th KPI card

## Changes Made (file went from 1066 → 1328 lines)

### Imports (line 22-27)
Added `CheckCircle` and `AlertTriangle` to the lucide-react import. `TrendingUp` and `TrendingDown` were already imported.

### Type updates (line 38)
```ts
export type ReportTimeframe = 1 | 2 | 7 | 14 | 30 | 60 | 90 | 180 | 365 | 0;
```
Extended to allow values `1` and `2`.

### New interfaces (lines 84-105)
Added `MissedOpportunityItem` and `MissedOpportunitiesResponse` types for the missed-opportunities API response.

### TIMEFRAME_OPTIONS (lines 107-118)
Added two new entries at the START:
- `{ value: 1, label: 'اليوم', badge: '1d' }`
- `{ value: 2, label: 'أمس', badge: '2d' }`

### State (lines 140-141)
```ts
const [missedOpps, setMissedOpps] = useState<MissedOpportunitiesResponse | null>(null);
const [missedOppsLoading, setMissedOppsLoading] = useState(false);
```

### fetchMissedOpps (lines 175-191) + useEffect (lines 193-195)
Separate fetch from main data flow — calls `/api/predictions/honest-tracking/missed-opportunities?threshold=10&limit=8&market={market}` with `cache: 'no-store'`. Doesn't block the main report rendering.

### computedStats.totalProfit (line 247)
```ts
const totalProfit = closed.reduce((s, p) => s + Number(p.returnPct || 0), 0);
```
Added to the returned stats object (line 229).

### topLosses useMemo (lines 298-304)
New memo: filters `outcome === 'LOSS' && returnPct < 0`, sorts ascending (most negative first), takes top 4.

### KPI grid (lines 566-608)
Changed `lg:grid-cols-4` → `lg:grid-cols-5` and added 5th KPI card for "إجمالي الربح" (Total Profit). Card uses emerald accent if positive, rose if negative. Added optional `icon` prop to KpiCard component to display a small icon next to the label.

### Top Losers HighlightCard (lines 835-852)
New row below the Top Gains + Fastest Gains row. Uses TrendingDown icon, rose accent. Uses existing HighlightCard component (with sign-display fix below).

### HighlightCard sign fix (line 1115)
Fixed hardcoded `+{value}%` to `{value >= 0 ? '+' : ''}{value}%` so losses display as `-5.2%` instead of `+-5.2%`.

### Missed Opportunities section (lines 915-962)
New section (numbered 6) between persona breakdown (5) and Win/Loss proportion bar (now 7). 2x2 grid (md+) of MissedOppCard components:
1. **Missed Bulls** (missed_bulls) — amber theme — "فرص ضاعت / قلنا بيع والسهم طلع"
2. **False Positives** (false_positives) — rose theme — "توصيات خاطئة / قلنا شراء والسهم نزل"
3. **Correct Buys** (correct_buys) — emerald theme — "توصيات صحيحة (شراء)"
4. **Correct Sells** (correct_sells) — teal theme — "توصيات صحيحة (بيع)"

### MissedOppCard sub-component (lines 1216-1327)
Defined at the bottom of the file near other sub-components. Features:
- Header with icon + title + subtitle + count badge
- Loading state: 3 Skeleton rows
- Empty state: "لا توجد بيانات"
- Items (up to 8): ticker, signal badge (green for BUY/STRONG_BUY, red for SELL/STRONG_SELL), pct_change (colored), entry_price → current_price, prediction_date
- Mobile responsive (text-[11px] → text-sm sm:text-base)
- max-h-80 overflow-y-auto for long lists
- Dark theme matching the rest of the report (bg-slate-900/70, border-white/10)

## Important Discovery
The task spec said the missed-opportunities API returns `change_pct`, but the actual API (`/api/predictions/honest-tracking/missed-opportunities/route.ts`) returns `pct_change`. I used the correct field name `pct_change` in my TypeScript interface and rendering code so the frontend will actually work with the real backend.

## Lint Status
- `bun run lint`: ✅ 0 errors
- `npx tsc --noEmit -p tsconfig.json`: ✅ 0 errors specific to ExecutiveReportView.tsx (only pre-existing errors in unrelated `scripts/*.ts` files about `#!` shebangs)

## No Backend Changes
All work is frontend-only. The backend APIs already exist and work as documented in worklog Task IDs 8, 9, 10, and EXPLORE-1.
