# TASK-C — Resource Monitoring Frontend + Predictions Technical Section

**Agent:** Z.ai Code (TASK-C frontend agent)
**Task ID:** TASK-C
**Completed:** 2026-10-04

## Summary

Built the frontend for the Resource Monitoring feature (3 new admin components) and added the technical explanation section to the predictions image card. Updated `/api/predictions` route to return `ai_reason`/`ai_narrative` (from stored_analyses join) and `technical_explanation` (parsed from `analysis_json`).

## Files Created

| Path | Purpose |
|------|---------|
| `src/modules/admin/components/ResourceHistoryChart.tsx` | Historical AreaChart for CPU/RAM/Disk %, plus PM2 online LineChart and optional Network I/O chart. Range selector 15m/1h/6h/24h/7d/30d. Auto-refresh every 30s. |
| `src/modules/admin/components/ResourceAlerts.tsx` | Health score gauge (0-100) + alerts list (max 10, scrollable). Auto-refresh every 60s. |
| `src/modules/admin/components/ProcessResourceHistory.tsx` | Per-process drill-down Dialog with CPU + Memory AreaCharts, restart event markers, range selector 1h/6h/24h. |

## Files Modified

| Path | Change |
|------|--------|
| `src/modules/admin/components/SystemMonitorPanel.tsx` | Added ResourceHistoryChart + ResourceAlerts side-by-side after Top Stats grid. Added TopProcessesSummary below PM2 table. Made PM2 rows clickable → opens ProcessResourceHistory dialog. Added 📊 icon button next to each process name. All 3 control buttons now stopPropagation. Existing 6s polling preserved. |
| `src/components/market/PredictionsImageCard.tsx` | Added TechnicalExplanation interface + extended PredictionPick with ai_reason/ai_narrative/technical_explanation. Inserted new collapsible section "📝 التحليل الفني" between the stocks table and the footer — uses shadcn Collapsible. Renders each stock's structured technical data (summary/candlestick/smc/volume/patterns/proofs/risk_note) with emojis, OR falls back to ai_narrative plain text. |
| `src/app/api/predictions/route.ts` | Added parseAnalysisJson() + enrichWithTechnical() helpers. Both ticker-scoped and local-DB-fallback branches now return `technical_explanation` (parsed from analysis_json server-side) and JOIN with `stored_analyses` for `ai_reason`/`ai_narrative`. Raw `analysis_json` blob is deleted from response to keep payload light. |

## Key APIs Used (from TASK-B)

| Endpoint | Used by |
|----------|---------|
| `GET /api/admin/system-resources/history?range=1h` | ResourceHistoryChart |
| `GET /api/admin/system-resources/anomalies?limit=10` | ResourceAlerts |
| `GET /api/admin/system-resources/process-history?name=X&range=1h` | ProcessResourceHistory |

## API Contract Extensions (TASK-C)

### `/api/predictions` response shape (changed)

Each prediction object now includes 3 new fields:

```json
{
  "id": 51314,
  "ticker": "MPCO",
  "technical_explanation": null,          // structured dict if present in analysis_json, else null
  "ai_reason": "السهم MPCO متعادل ...",   // from stored_analyses.ai_reason (latest row for ticker)
  "ai_narrative": "السهم MPCO متعادل ..." // from stored_analyses.ai_narrative
}
```

The raw `analysis_json` blob is no longer returned to keep the payload light — clients should consume the parsed `technical_explanation` field.

## Verification

- ✅ `bun run lint` — exit 0, no errors
- ✅ Dev server (port 3000 via proxy → 3001) responds:
  - GET `/` → 200
  - GET `/admin` → 200 (compiles + serves)
  - GET `/api/predictions?limit=3` → 200 (returns enriched data with 3 new fields, null when missing)
  - GET `/api/predictions?ticker=MPCO` → 200 (returns ai_reason + ai_narrative from stored_analyses join)
  - GET `/api/admin/system-resources/{history,anomalies,process-history}` → 403 (requireAdminAsync — endpoints exist)
- ✅ Existing SystemMonitorPanel functionality preserved (6s polling, threat banner, cleanup toolbar, storage breakdown, largest files, health checks)
- ✅ shadcn/ui components used: Card, Badge, Progress, Button, Skeleton, Collapsible, Dialog
- ✅ recharts: AreaChart, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceDot
- ✅ RTL layout (dir="rtl") + mobile responsive (grid-cols-1 → lg:grid-cols-3 / lg:grid-cols-4)

## Forward Pointers

- The 3 new admin components live in `src/modules/admin/components/` and are imported into SystemMonitorPanel — no new routes needed.
- The predictions API now exposes `technical_explanation` (structured) + `ai_reason` + `ai_narrative` (plain text) — frontend code can render either or both depending on data availability.
- The technical section in `PredictionsImageCard` only renders if at least one stock has technical data — graceful no-op otherwise.
- For images in the predictions table that don't have ai_reason/ai_narrative yet (most existing predictions), the technical section simply doesn't appear. Backend enrichment is incremental — once predictions/stored_analyses rows are populated with ai fields, the section auto-renders.
