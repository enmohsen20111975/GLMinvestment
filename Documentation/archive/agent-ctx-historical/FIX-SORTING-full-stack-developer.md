# FIX-SORTING — UnifiedTable multi-column sort + per-column filter

**Agent**: full-stack-developer (Claude Code)
**Task ID**: FIX-SORTING
**Date**: 2026-10-05
**Commit**: `d5b1377` on `main`

## Context
Owner frustrated: "الفرز غبى لأقصى درجة" — single-column sort, no per-column filter, sort cycle
cleared instead of keeping state. Single source of truth file:
`/home/z/my-project/src/components/shared/UnifiedTable.tsx`.

## Changes

### `src/components/shared/UnifiedTable.tsx` (full rewrite of sort/filter logic)

**State migration**:
- REMOVED: `sortKey: string | null` + `sortDir: SortDirection`
- ADDED: `sortConfigs: SortConfig[]` where `SortConfig = { key: string; direction: 'asc' | 'desc' }`
- ADDED: `columnFilters: Record<string, Set<string>>` (per-column filter state)
- ADDED: `filterSearch: Record<string, string>` (per-open-dropdown search text)
- ADDED: `showColumnFilters?: boolean` prop (default `false` — backward compatible)

**Multi-column sort behavior** (`handleSort`):
- Regular click → replace `sortConfigs` with single column (cycle: new→asc, asc→desc, desc→cleared)
- Shift+Click → ADD to multi-sort stack (new→asc, asc→desc, desc→removed from stack)
- Visual: priority badge (1,2,3…) + `ArrowUp`/`ArrowDown` when multi-sort active
- Per-column `X` button to remove that column from the sort stack
- `aria-sort` updated correctly

**Per-column filter dropdown** (only when `showColumnFilters=true`):
- Filter icon (lucide `Filter`) in each header next to sort indicator
- Clicking opens `DropdownMenu` with:
  - Search `Input` (filters the value list)
  - "تحديد الكل" / "إلغاء الكل" buttons
  - `Checkbox` per unique value (deduplicated, alphabetically sorted via `localeCompare(b, 'ar')`)
  - "مسح" link in header to clear this column's filter
- Filter icon turns `text-primary` + shows count badge when active
- Active filter count + global "مسح الفلاتر" button appears above table

**Filtering/sorting pipeline**:
```
filteredData = data.filter(matchesAllColumnFilters)
sortedData    = [...filteredData].sort(multiConfigComparator)
```
- `compareValues` extended to handle boolean equality
- `cellValueKey(v)` helper normalizes values to Set-key-safe strings

### `src/components/screener/StockScreenerAdvanced.tsx`
- Added `showColumnFilters` prop to the screener results `UnifiedTable<ScreenerStock>` instance
  (Tab 1: screener) — owner can immediately verify at `#stock-filters`.

## Why "the sort was stupid"
1. `sortConfigs` was a single string — couldn't represent priority/tie-breakers
2. `null` cycle cleared the sort entirely (the `setSortKey(null)` branch was reached too easily)
3. With the new state, every click is constructive: asc→desc→cleared only happens on the
   ACTIVE column when multi-sort isn't engaged, and Shift+Click never destroys the stack.

## Verification
- ✅ `bun run lint` → clean (no errors, no warnings)
- ✅ `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → 200
- ✅ `curl http://localhost:3000/` body has no `ModuleBuildError` or `statusCode:500`
- ✅ Pushed to `origin/main` (commit `d5b1377`)
- ✅ Backward compatible: `showColumnFilters` defaults to `false` — all other UnifiedTable
  consumers (28 usages across the project) are unchanged.

## Things tried that DID NOT work first time
- Initial draft declared `setFilterSearch` as both a state setter and a `useCallback` name →
  SWC build error "the name `setFilterSearch` is defined multiple times" (HTTP 500).
  Fixed by renaming the callback to `updateFilterSearch`.
- ESLint didn't catch the duplicate-name issue (uses block-scoped rules); SWC did. Lesson:
  always check the dev server response body, not just HTTP code, after big rewrites.
- `clearSort` helper was added but never used → removed.

## Files touched
1. `src/components/shared/UnifiedTable.tsx` — main rewrite (+315/-138 net)
2. `src/components/screener/StockScreenerAdvanced.tsx` — `showColumnFilters` prop wired up

## Next steps for the owner
- Visit `#stock-filters` (StockScreenerAdvancedView) → Tab 1 (Screener) → click any column
  header to sort. Shift+Click to add to multi-sort. Click the Filter icon to open the
  per-column filter dropdown.
- If they like it, propagate `showColumnFilters` to other UnifiedTable consumers
  (Holdings, PredictionsBacktest, LiveMonitor, etc.) — they'll inherit the feature
  for free.
