# Task 4-b (Alpha A4) — INVESTIGATION REPORT

**Task**: NO_TRADE banner + Market Regime display in `PredictionTrackingDashboard.tsx`

## Step 1 — Investigation

### Files identified

| File | Role |
|---|---|
| `src/modules/predictions/components/PredictionTrackingDashboard.tsx` | Shim — re-exports from `prediction-dashboard/`. |
| `src/modules/predictions/components/prediction-dashboard/PredictionTrackingDashboard.tsx` | Container (~150 LOC). Orchestrates HeaderBar + KpiCards + PersonaCards + FocusStocksBanner + CumulativeProfitChart + ProofTableCard + ProofModal. |
| `src/modules/predictions/components/prediction-dashboard/usePredictionTrackingState.ts` | State hook (~506 LOC). Owns fetch + filters + derived memos. |
| `src/modules/predictions/components/prediction-dashboard/ProofTableCard.tsx` | The big table card with toolbar + table/mobile view + empty state. |
| `src/modules/predictions/components/prediction-dashboard/types.ts` | All TS types (LivePrediction, LiveTrackingResponse, etc.). |
| `src/modules/predictions/components/prediction-dashboard/desktopColumns.tsx` | Column factory for UnifiedTable. |
| `src/modules/predictions/components/prediction-dashboard/helpers.ts` | format/compute utilities. |
| `src/modules/predictions/components/prediction-dashboard/constants.ts` | PERSONA_CONFIG, OUTCOME_CONFIG, DAYS_OPTIONS, etc. |

### Current API endpoint called by the dashboard

The hook calls **`/api/predictions/honest-tracking/live-tracking`** (NOT one of the 3 B4 endpoints). This endpoint returns historical predictions (YTD) — closed + pending — for win-rate / proof-of-trade display.

This is **separate** from the 3 endpoints B4 (Task 1-c) updated with `market_regime_info`:
1. `/api/daily/rebuild-predictions`
2. `/api/unified/predictions`
3. `/api/predictions/daily-picks`

### Current regime handling

**None.** The hook does NOT read `market_regime_info`. The dashboard does NOT know about DEFENSIVE / NORMAL / AGGRESSIVE.

### Current empty-state behavior

In `ProofTableCard.tsx` lines 225-230 — when `filteredPredictions.length === 0`:
```
<p className="font-bold text-sm">لا توجد صفقات تطابق خيارات الفلترة المحددة</p>
<p className="text-xs">جرب تغيير الفترة الزمنية أو تحديد شخصية أخرى</p>
```
→ Misleading: blames the user's filters. Does NOT say "DEFENSIVE market, NO_TRADE today".

### Client-side fabrication check

**No fabrication.** The hook does NOT generate picks. It only:
- Merges predictions from 3 personas (`allRawPredictions`).
- Dedups (`dedupedPredictions`).
- Applies quality filter (`qualityFilteredPredictions`).
- Aggregates by ticker (`aggregateByTicker`).
- Filters by outcome/persona/search/entryPeriod/days (`filteredPredictions`).

All transformations are pure client-side filtering of backend-supplied data.

### What's needed

1. **Add a separate fetch** in the hook to one of the B4 endpoints to retrieve `market_regime_info`. The cleanest is `/api/predictions/daily-picks?market={market}&limit=5` — this gives us BOTH the regime info AND today's qualifying picks (with per-pick `decision` field).
2. **Render a Market Warning Banner** at the top of the dashboard.
3. **Render a NO_TRADE panel** when DEFENSIVE + 0 qualifying picks + `no_trade_reason` non-empty.
4. **Render today's daily picks** (with per-pick `decision` field) when there are picks.
5. **NO indigo/blue** — use amber for DEFENSIVE, neutral for NORMAL, green (profit) for AGGRESSIVE.

### Architecture decision

The existing `filteredPredictions` table is the **historical tracking table** (win/loss across the year). It should NOT be hidden when NO_TRADE — historical trades are legitimate to display.

The new NO_TRADE panel + Market Regime Banner will be added **above** the existing table, as a new "today's regime" section. The historical table remains below for the win-rate / proof-of-trade view.

This preserves the existing UX (historical tracking) AND adds the new NO_TRADE clarity (today's recommendations).
