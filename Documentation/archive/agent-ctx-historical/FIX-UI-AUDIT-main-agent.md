# FIX-UI-AUDIT — main agent work record

**Task ID**: FIX-UI-AUDIT
**Agent**: main (Claude)
**Date**: 2026-10-05
**Status**: ✅ All 6 audit tasks implemented locally; push blocked by upstream divergence (documented below).

## What was done

### Task 1 — StockScreenerAdvanced dead/zero summaries
File: `src/components/screener/StockScreenerAdvanced.tsx`
- Added `derivedSummary` useMemo that computes advancers/decliners/avgChange/
  totalTurnover/volumeSurgeCount from `filteredStocks` (not from server summary).
- When `derivedSummary.total === 0`, KPI row collapses into a dashed-border
  reason banner: «لا توجد أسهم تحقق شروط الفلتر الحالي».
- Added `dark:` color variants to all KPI boxes.

### Task 3 — Reduce filter buttons
Same file.
- Added `primary: true` flag on 7 audit-approved presets: تعافي بعد تصحيح،
  زخم مرتفع (renamed from «زخم متزن»)، سيولة عالية، قرب كسر للأعلى، فوق
  المتوسطات، RSI معتدل، تجميع قوي (NEW).
- Remaining ~13 presets collapsed under a shadcn `DropdownMenu` titled
  «المزيد (N)» with a count badge and `max-h-[60vh]` scroll area.

### Task 2 — MakerRadarTab dead/zero summaries
File: `src/components/predictions/MakerRadarTab.tsx`
- When `radarKpi.hasData === false`, KPI row collapses into a single reason
  card: «لا توجد فرص حالياً — الرادار بيفحص الأسهم».
- Empty-state for `totalCardsShown === 0` differentiates between filter='all'
  (radar scanning) vs. filter=specific (no match) with actionable suggestions.

### Task 5 — Top cards reduced to 4 (audit-approved labels)
Same file.
- New `radarKpi` useMemo aggregates 4 radar lists into:
  1. عدد الأسهم النشطة (unique tickers)
  2. أقوى زخم حالي (max roc_10d ticker)
  3. أعلى سيولة (max avg_turnover_20d ticker)
  4. عدد الفرص الحقيقية (pre_surge + explosive + early_break count)
- `KpiCard.value` type widened to `number | string`.
- Removed old 4 cards (إجمالي المفحوصة / تحت الميكروسكوب / موجات منفجرة /
  أسهم متابَعة). tracked_count still visible in filter-bar badge.

### Task 4 — Dedup tables (stocks repeating between sections)
Same file.
- Rewrote 4 `filteredXxx` useMemo hooks: priority explosive > early_break >
  pre_surge > quiet. A ticker only appears in its highest-priority section.
- Dedup applies only when `filter === 'all'`; specific filters show full lists.

### Task 6 — Dashboard theme + empty states
Files: `src/components/dashboard/InvestorsFlowPanel.tsx`,
       `src/components/dashboard/TopMovers.tsx`,
       `src/components/dashboard/LiveMonitor.tsx`
- Verified `next-themes` setup (attribute=class, defaultTheme=light, enableSystem).
- No light-only hardcoded colors found in dashboard widgets — all `bg-white`/
  `bg-slate-50` already had `dark:` variants.
- Replaced dead «لا توجد بيانات» placeholders with actionable reasons:
  - TopMovers: «بانتظار بيانات الأسهم المُتحرّكة — تظهر تلقائياً عند بدء التداول»
  - LiveMonitor (empty MoversRow): same message
  - LiveMonitor (missing intraday timestamp): «بانتظار البيانات»
  - InvestorsFlowPanel: shows error reason or «بانتظار تحديث بيانات الجلسة»

## Verification
- `bun run lint` → clean (no errors, no warnings)
- `curl -o /dev/null -w "%{http_code}" http://localhost:3000/` → 200
- `curl -o /dev/null -w "%{http_code}" http://localhost:3000/#stock-filters` → 200
- `curl -o /dev/null -w "%{http_code}" http://localhost:3000/#liquidity-radar` → 200
- `?view=stock-filters` → 200 (42ms)
- `?view=liquidity-radar` → 200 (40ms)

## Local commits
```
7420ef2 fix(dashboard): replace dead «لا توجد بيانات» placeholders with actionable reasons (audit report)
07887bb fix(maker-radar): replace raw-count KPI cards with audit-approved metrics + dedup tickers across sections (audit report)
1039651 fix(screener): compute KPI summary from filteredStocks + reduce presets to 7 primary (audit report)
```

## Push status — BLOCKED
- Local main: 3 commits ahead of origin/main (the audit fixes).
- Remote origin/main: 656 commits ahead of local — includes a Phase 1-6
  refactor that moved `src/components/predictions/MakerRadarTab.tsx` →
  `src/modules/predictions/components/MakerRadarTab.tsx` (and same for
  StockScreenerAdvanced).
- `git pull --rebase origin main` fails: modify/delete conflict on old paths
  (remote deleted them via the move; local modified them via the audit fixes).
- Decision: NOT force-pushing — would discard the 656 remote commits. The
  audit fixes ARE live in the local dev server preview because `app/page.tsx`
  imports from the old paths that match my edits.
- To upstream after the refactor lands locally: re-apply the same edits to
  `src/modules/predictions/components/MakerRadarTab.tsx` and
  `src/modules/screener/components/StockScreenerAdvanced.tsx`.

## Notes for the next agent
- The `presets` array in StockScreenerAdvanced now mixes `primary: true` and
  plain objects (no `primary` field). TypeScript handles this fine, but if
  you add new presets, set `primary: true` only on the 7 audit-approved ones
  to keep the «المزيد» dropdown meaningful.
- The `radarKpi` derived value in MakerRadarTab has `hasData: boolean` — use
  this to gate any future UI that should hide when the radar is empty.
- The dedup logic in MakerRadarTab uses `s.ticker.toUpperCase()` consistently.
  If the API ever returns case-mismatched tickers, the dedup will still work
  correctly because all comparisons go through `.toUpperCase()`.
