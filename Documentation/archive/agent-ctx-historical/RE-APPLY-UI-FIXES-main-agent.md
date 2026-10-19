# RE-APPLY-UI-FIXES — main agent work record

**Task ID**: RE-APPLY-UI-FIXES
**Agent**: main (Claude)
**Date**: 2026-10-05
**Status**: ✅ All 4 file re-applies + worklog entry pushed to origin/main.

## Context
The previous agent (FIX-UI-AUDIT) made audit UI fixes to OLD file paths
under `src/components/{screener,predictions,dashboard}/`. The upstream
Phase 6 refactor (commit `1ad0cac`) had ALREADY moved those files to
`src/modules/{screener,predictions,dashboard}/components/`. The merge
`851aa54` resolved the modify/delete conflicts by taking upstream (new
paths), so the audit fixes did NOT propagate to the live `src/app/page.tsx`
imports (which use the NEW module paths). Owner saw zero UI improvements.

## What was re-applied to NEW paths

### 1. `src/modules/screener/components/StockScreenerAdvanced.tsx`
- **Fix A**: `derivedSummary` useMemo computes gainers/losers/avgChange/
  totalLiquidity/volumeMomentum directly from `filteredStocks` (Rule 27).
  KPI row collapses to dashed-border reason banner when `derivedSummary`
  is null (filter yields no rows).
- **Fix B**: 7 audit-approved presets marked `primary: true` (recovery,
  highMomentum [NEW, was balancedMomentum/«زخم متزن»], nearBreak,
  highLiquidity, aboveMa, moderateRsi, strongAccumulation [NEW —
  institutional accumulation]). Remaining ~14 presets collapsed under
  shadcn DropdownMenu «المزيد (N)» with count badge + max-h-[60vh] scroll.
- **Fix C**: `UnifiedTable` already had `showColumnFilters` (verified,
  no change needed).
- **i18n**: Added 3 new keys to ar.json + en.json:
  `presets.highMomentum`, `presets.strongAccumulation`, `presets.more`.

### 2. `src/modules/predictions/components/MakerRadarTab.tsx`
- **Fix A**: `radarKpi` useMemo aggregates 4 radar lists into 4 audit-
  approved metrics: عدد الأسهم النشطة / أقوى زخم حالي (max roc_10d ticker)
  / أعلى سيولة (max avg_turnover_20d ticker) / عدد الفرص الحقيقية
  (pre_surge + explosive + early_break count). Replaces 4 raw-count cards.
  When `radarKpi.hasData === false`, KPI row collapses to dashed-border
  reason card «لا توجد فرص حالياً — الرادار بيفحص الأسهم».
- **Fix B**: `dedupSet` useMemo deduplicates tickers across sections when
  `filter === 'all'`. Priority: explosive > early_break > pre_surge > quiet.
  Specific filters still show full list (drill-down preserved).
- **Fix C**: Empty-state for `totalCardsShown === 0` differentiates between
  filter='all' (radar scanning — «لا توجد فرص حالياً») vs. filter=specific
  (no match — suggests «عرض الكل»).
- **Type widening**: `KpiCardProps.value: number | string`. KpiCard render
  branches on typeof value (numbers get text-2xl + toLocaleString; tickers
  get text-xl + font-mono).

### 3. `src/modules/dashboard/components/TopMovers.tsx`
- Replaced dead «لا توجد بيانات» placeholder with actionable reason:
  «بانتظار بيانات الأسهم المُتحرّكة — تظهر تلقائياً عند بدء التداول» +
  TrendingUp icon. (Already had `dark:` variants, no theme regression.)

### 4. `src/modules/dashboard/components/InvestorsFlowPanel.tsx` + `LiveMonitor.tsx`
- InvestorsFlowPanel: 2x «لا يوجد» → «بانتظار البيانات» (inflow/outflow
  empty rows); sector_flow emptyTextAr → «بانتظار تدفّق القطاعات — يظهر
  تلقائياً عند بدء الجلسة». Error-state already actionable — unchanged.
- LiveMonitor: portfolio emptyTextAr → «المحفظة فارغة — أضف أسهماً لمتابعة
  أدائها مباشرةً». MoversRow empty + intraday timestamp already
  actionable — unchanged.

## Verification
- `bun run lint` → clean after EACH file edit (final: EXIT 0).
- All 5 HTTP checks: 200 (`/`, `/#stock-filters`, `/#liquidity-radar`,
  `/?view=stock-filters`, `/?view=liquidity-radar`).

## Push workflow
Before each push: `git stash && git pull --rebase origin main && git stash pop`.
All 4 pulls returned «Already up to date.» (no upstream divergence this time).
All 4 pushes completed cleanly to `origin/main` (no force-push needed).

## Commits pushed (4 fix commits + 1 worklog commit)
```
5586749 docs(worklog): append RE-APPLY-UI-FIXES work record
74c20f0 fix(dashboard): re-apply actionable empty-states to InvestorsFlowPanel + LiveMonitor
1d4bcae fix(dashboard): re-apply TopMovers actionable empty-state to NEW module path
11b2688 fix(maker-radar): re-apply audit UI fixes to NEW module path
36e0032 fix(screener): re-apply audit UI fixes to NEW module path
```

## Notes for the next agent
- All 5 fixed files now live exclusively under `src/modules/...` paths.
  The old `src/components/{screener,predictions,dashboard}/` paths no
  longer exist (deleted by Phase 6 refactor `1ad0cac`). Future audit
  fixes should target `src/modules/...` directly to avoid this re-apply
  cycle.
- The `presets` array mixes `primary: true` (7 of them) and objects
  without `primary` (~14). TS handles this fine. If you add new presets,
  set `primary: true` only on the 7 audit-approved ones to keep the
  «المزيد (N)» dropdown meaningful.
- The `radarKpi` derived value has `hasData: boolean` — use this to gate
  future UI that should hide when the radar is empty.
- The dedup logic uses `s.ticker.toUpperCase()` consistently; case-
  mismatched tickers from the API will still dedup correctly.
