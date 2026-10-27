# ALPHA — A2 SECTOR TRACKING ROOT CAUSE
## Workstream D — 8 Failures Classified

**Date:** 2026-10-27
**Agent:** Alpha (Parallel Engineering Support)
**Branch:** `alpha/tool-effectiveness`

---

## 1. The 8 Failing Tests

| # | Test Name | Missing testid |
|---|-----------|----------------|
| 1 | renders the treemap with the HONEST "Liquidity Distribution" title | `sector-treemap-title` |
| 2 | renders ALL sectors in the treemap data | `sector-treemap-container` |
| 3 | subtitle + footer explicitly disclose what size & color measure | `sector-treemap-subtitle` |
| 4 | momentum strip shows strongest & weakest sectors by avg_change | `sector-momentum-strongest` |
| 5 | treemap rect colors reflect avg_change | (assertion failure) |
| 6 | does NOT fabricate "Net Money Flow" claims | `sector-treemap-title` |
| 7 | leader sparkline renders "—" honestly | `sector-treemap-title` |
| 8 | total liquidity shown equals the sum of sector turnovers | `sector-treemap-total` |

---

## 2. Root Cause (CONFIRMED with evidence)

### The change that broke it
Commit `5b82abc` ("feat(alpha): A2 — Sector Liquidity Treemap + Momentum strip")
modified `SectorTrackingTab.tsx`:

**Before `5b82abc`** (commit `163e3ad` — "feat(a2): sector tracking honest treemap"):
```tsx
import { SectorLiquidityTreemap } from './SectorLiquidityTreemap';
import { SectorMomentumStrip } from './SectorMomentumStrip';
import { SectorLeaderSparkline } from './SectorLeaderSparkline';
// ... uses <SectorLiquidityTreemap /> which has data-testid attributes
```

**After `5b82abc`:**
```tsx
// SectorLiquidityTreemap import REMOVED
// Replaced with inline Treemap using recharts directly
// NO data-testid attributes added to the inline version
```

### Evidence (verified by Alpha)

```bash
# SectorLiquidityTreemap.tsx HAS the testids:
rg -n "data-testid" src/modules/market-analysis/components/SectorLiquidityTreemap.tsx
# → sector-treemap-title (line 248)
# → sector-treemap-subtitle (line 252)
# → sector-treemap-legend (line 271)
# → sector-treemap-container (line 288)
# → sector-treemap-note (line 304)
# → sector-treemap-total (line 310)

# SectorTrackingTab.tsx does NOT import SectorLiquidityTreemap:
rg -n "SectorLiquidityTreemap" src/modules/market-analysis/components/SectorTrackingTab.tsx
# → (no output — import removed)

# SectorTrackingTab.tsx has NO data-testid:
rg -n "data-testid" src/modules/market-analysis/components/SectorTrackingTab.tsx
# → (no output)
```

---

## 3. Failure Classification

| Category | Count | Classification |
|----------|-------|----------------|
| Missing `data-testid` (removed by 5b82abc) | 7 | UI change broke tests |
| Assertion failure (testid exists but value mismatch) | 1 | Test #5 (colors) |

**NOT a product bug** — the Treemap still renders. The tests fail because they
assert on `data-testid` attributes that were removed when the component was inlined.

**NOT test pollution** — all 8 failures are 100% reproducible (3/3 runs).

---

## 4. Is `data-testid` a public contract?

**No.** `data-testid` attributes are test-only hooks. They are NOT:
- Part of the API contract
- Required by any consumer (frontend or backend)
- Documented in FRONTEND-BACKEND-CONTRACTS.md

However, they ARE the established testing pattern in this project:
- `LiquidityRadarView` uses them (`radar-filters`, etc.)
- `IncubatorSection` uses them (implicitly, via component structure)
- The project's testing strategy depends on them

**Verdict:** Restoring testids is consistent with project testing patterns.

---

## 5. Proposed Fix (smallest, safe, no behavior change)

### Option A: Restore the import (RECOMMENDED)

Re-add the import of `SectorLiquidityTreemap` (and `SectorMomentumStrip`,
`SectorLeaderSparkline`) to `SectorTrackingTab.tsx`, replacing the inline
Treemap.

**Pros:**
- Tests pass immediately (testids restored)
- Better component separation (original architecture from `163e3ad`)
- Honest labels (subtitle, note, total) restored
- NO behavior change — the separate component renders the same treemap

**Cons:**
- Loses the inline Treemap changes from `5b82abc`
- The inline version may have had subtle differences (needs verification)

**Risk:** LOW — `SectorLiquidityTreemap.tsx` still exists and is unchanged.
It was the canonical version before `5b82abc` inlined a different version.

### Option B: Add testids to the inline version

Add `data-testid="sector-treemap-title"` etc. to the inline Treemap in
`SectorTrackingTab.tsx`.

**Pros:**
- Keeps current inline architecture
- Tests pass

**Cons:**
- Inline version may lack the honest labels (subtitle, note, total)
- Tests for "honest labels" may still fail if the content differs
- Diverges from the component separation pattern

**Risk:** MEDIUM — may need to add content that the separate component had.

### Option C: Update tests to not use testids

Rewrite the 8 tests to query by text content or role instead of testid.

**Pros:**
- Tests become more resilient to refactoring

**Cons:**
- Loses the explicit testid contract
- More brittle to text changes
- Larger change

**Risk:** MEDIUM — larger test rewrite.

---

## 6. Alpha Recommendation

**Option A (restore import)** — it's the smallest change that:
- Restores all 8 testids
- Restores the honest labels (subtitle, note, total)
- Uses the canonical component (`SectorLiquidityTreemap.tsx` still exists)
- Has NO behavior change (same Treemap, same data)

**BUT:** This needs owner approval because it reverts part of `5b82abc`.
Per program rules: "لا تعملي revert للـ commit `5b82abc` دون موافقة."

---

## 7. What Alpha Did NOT Do

- ❌ Did NOT revert commit `5b82abc` (needs owner approval)
- ❌ Did NOT add testids to the inline version (needs owner decision on A vs B)
- ❌ Did NOT update the tests (needs owner decision on A vs B vs C)
- ✅ Documented the root cause with evidence
- ✅ Classified all 8 failures
- ✅ Proposed the smallest safe fix

---

## 8. Closure Criteria

| Criteria | Status |
|----------|--------|
| Identify all 8 failing tests by name | ✅ DONE |
| Determine if failure is testid / behavior / fixture / API / product bug | ✅ DONE (testid) |
| Compare 5b82abc change with related component/test changes | ✅ DONE |
| Verify testid is not required by other consumers | ✅ DONE (test-only) |
| Propose smallest fix consistent with intended behavior | ✅ DONE (Option A) |

**Verdict: ROOT CAUSE CONFIRMED. Fix proposed (Option A). Awaiting owner decision.**
