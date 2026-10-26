# Task 2-b / A1 — Investigation Report (Liquidity Radar UI fix)

## File path under review
`src/components/shared/LiquidityRadarView.tsx` (877 LOC)

## Current data source (line 287)
```
fetch(`/api/v2/liquidity-radar?market=${encodeURIComponent(market)}`, { cache: 'no-store' })
```
Reads from `RadarResponse` interface which has `stocks: RadarStock[]` — that's all it consumes (no `results`, no `summary`).

## Current filter-count logic (lines 687–690)
```ts
const count = f.key === 'all'
  ? (data?.stocks?.length ?? 0)
  : (data?.stocks ?? []).filter((st) => phaseToBucket(st.phase) === f.key).length;
```
- `phaseToBucket(st.phase)` is a STRING-CONTAINS heuristic on `phase` (e.g. `phase.includes('quiet_accumulation') → 'quiet_accumulation'`).
- This is the root cause of "vanishing":
  1. `hideInactive` defaults to `true` (line 276) → drops every stock whose turnover_egp / volume×price / net_flow_egp < 1.5M EGP (lines 324–344). That filters out roughly 316 of ~347 scanned stocks before they reach the UI.
  2. `BucketKey` enum is `{ dry_accumulation, accumulation_confirmed, distribution_risk, illiquid_trap, quiet_accumulation, whale_inflow, whale_outflow, bottom_absorption, correction_exhaustion }` — NONE of these correspond 1:1 with B3's `classification` enum `{ quiet_accumulation, distribution, dead_trap, liquidity_drought, rule80_downtrend, unclassified, DATA_INVALID, INSUFFICIENT_DATA }`.
  3. When `phase === 'غير معروفة'` (which is what unclassified stocks get from the API at line 219 of route.ts), `phaseToBucket` returns `'neutral'` → stock matches NO bucket → it disappears from every chip except "All".

## What's missing (vs. B3 contract)
1. UI's `RadarStock` interface is missing ALL B3 fields: `classification`, `data_quality_status`, `reasons`, `sanity_status`, `scan_timestamp`, `company`, `market`, `currency`, `phase` (already there).
2. UI's `RadarResponse` interface is missing: `results`, `summary`, `source_count`.
3. `data_quality` enum in `src/modules/predictions/components/maker-radar/types.ts:81` is `'fresh'|'stale'|'very_stale'|'unknown'|null` — needs `'invalid'|'unavailable'` added.
4. `hideInactive=true` default conflicts with HARD CONSTRAINT #1 ("Show ALL stocks the API sends"). Must default to OFF or be removed.
5. `getPhaseInfo` + `phaseToBucket` are phase-string heuristics — should be replaced with classification-driven logic.

## Notes
- Dev server OOM-kills in this 4GB sandbox (dmesg shows `oom-killer: next-server (v1)` repeatedly). Will rely on `bun run lint` + `tsc --noEmit` + fixture test (vitest + @testing-library/react) per owner's directive.
- `api-shape.test.ts` asserts `RadarStock` fields in UI ⊇ API's `RadarStock` fields. Adding B3 fields to UI's interface is REQUIRED (or that test would still pass since it only checks API→UI direction, but the types won't compile when we read `classification`).
