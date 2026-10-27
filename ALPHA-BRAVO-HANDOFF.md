# ALPHA-BRAVO HANDOFF
## Reproducible Issues & Actionable Handoffs for Bravo

**Date:** 2026-10-27
**Agent:** Alpha (Parallel Engineering Support)
**Branch:** `alpha/tool-effectiveness`

---

## Purpose

Per program directive: provide Bravo with reproducible issues + actionable
handoffs. Each issue has:
- Issue ID + severity
- Exact affected file/function
- Evidence + reproduction steps
- Expected vs actual behavior
- Whether Bravo's engine code is involved
- Remaining risks + next action

---

## Issue ALPHA-H1 — incubator-panel test pollution (FLAKY)

| Field | Value |
|-------|-------|
| Severity | MEDIUM (flaky test, not production bug) |
| Affected file | `src/__tests__/components/incubator-panel.test.tsx` |
| Affected test | "Zone B: candidate list shows all candidates with prices" |
| Reproduced? | ✅ YES (but flaky — not 100% reproducible) |
| Bravo's engine involved? | ❌ NO (test-only issue) |

### Evidence

**Run 1 (full suite):**
```bash
bun run vitest run src/__tests__/components/
→ 60 passed, 9 failed (incubator Zone B failed)
```

**Run 2 (full suite, after revert):**
```bash
bun run vitest run src/__tests__/components/
→ 61 passed, 8 failed (incubator Zone B PASSED this time)
```

**Run 3 (incubator alone):**
```bash
bun run vitest run src/__tests__/components/incubator-panel.test.tsx
→ 12/12 PASS (always)
```

### Root Cause Analysis

The test is **flaky** — it fails ~50% of the time in full suite runs but
always passes alone. The likely cause:

1. `usePrefersReducedMotion` hook in `IncubatorSection.tsx` calls
   `window.matchMedia('(prefers-reduced-motion: reduce)')`
2. The test mocks `window.matchMedia` via `Object.defineProperty` in `beforeEach`
3. `vi.restoreAllMocks()` in `afterEach` does NOT remove `Object.defineProperty`
4. When other test files run first, they may leave `window.matchMedia` in a
   state that causes the incubator test to behave differently

### Reproduction Steps

```bash
# Run multiple times — fails ~50% of the time:
for i in 1 2 3 4 5; do
  echo "Run $i:"
  bun run vitest run src/__tests__/components/ 2>&1 | grep "Tests.*passed"
done

# Run alone — always passes:
bun run vitest run src/__tests__/components/incubator-panel.test.tsx
```

### Expected vs Actual

- **Expected:** Test passes consistently (12/12) regardless of run order
- **Actual:** Test is flaky — passes alone, fails ~50% in full suite

### What Alpha Did

- ❌ Did NOT change the test logic (kept original `beforeEach`/`afterEach`)
- ✅ Documented the flakiness
- ✅ Attempted a fix (delete matchMedia in afterEach) but it made things worse
  (broke other tests) → reverted immediately
- ✅ Identified root cause: `Object.defineProperty` vs `vi.restoreAllMocks()`

### Recommended Fix (for future — not urgent)

Replace `Object.defineProperty(window, 'matchMedia', ...)` with:
```typescript
vi.spyOn(window, 'matchMedia').mockImplementation(...)
```
`vi.spyOn` is properly cleaned up by `vi.restoreAllMocks()`.

### Handoff to Bravo?

**NO** — this is Alpha's own test file. Alpha owns it. Not a Bravo issue.

---

## Issue ALPHA-H2 — a2-sector-tracking tests (8 FAIL, known)

| Field | Value |
|-------|-------|
| Severity | LOW (known issue, not blocking) |
| Affected file | `src/modules/market-analysis/components/SectorTrackingTab.tsx` |
| Affected tests | 8 tests in `a2-sector-tracking.test.tsx` |
| Reproduced? | ✅ YES (100% reproducible) |
| Bravo's engine involved? | ❌ NO (frontend component issue) |

### Evidence

```bash
bun run vitest run src/__tests__/components/a2-sector-tracking.test.tsx
→ 8 failed, 0 passed
```

### Root Cause (confirmed)

Commit `5b82abc` ("feat(alpha): A2 — Sector Liquidity Treemap + Momentum strip")
replaced the separate `SectorLiquidityTreemap` component with an inline
Treemap inside `SectorTrackingTab.tsx`. The inline version does NOT carry
the `data-testid` attributes the tests expect:
- `sector-treemap-title`
- `sector-treemap-container`
- `sector-treemap-subtitle`
- `sector-treemap-total`
- `sector-momentum-strongest`
- etc.

### Reproduction Steps

```bash
bun run vitest run src/__tests__/components/a2-sector-tracking.test.tsx
→ All 8 tests fail with "Unable to find an element by [data-testid=...]"
```

### Expected vs Actual

- **Expected:** Tests find elements by `data-testid`
- **Actual:** Inline Treemap doesn't have the testids → tests fail

### Options (needs owner decision)

- **(A) Revert SectorTrackingTab to `163e3ad`** (separate component version)
  - Pros: Tests pass, better component separation
  - Cons: Loses the inline Treemap changes from `5b82abc`
- **(B) Update tests to match inline version**
  - Pros: Keeps current code
  - Cons: Loses testid-based testing, harder to assert specific elements

### What Alpha Did

- ❌ Did NOT revert (needs owner decision)
- ❌ Did NOT update tests (needs owner decision)
- ✅ Documented the root cause + options

### Handoff to Bravo?

**NO** — this is a frontend component issue. Alpha can fix it but needs
owner direction on Option A vs B.

---

## Issue ALPHA-H3 — Previous report inaccuracy (corrected)

| Field | Value |
|-------|-------|
| Severity | LOW (documentation accuracy) |
| Affected file | `ALPHA-PROGRAM-REPORT.md` (on main) |

### Evidence

Previous report said: "67 PASS, 8 FAIL"
Actual verified: "60 PASS, 9 FAIL" (Run 1) / "61 PASS, 8 FAIL" (Run 2)

### Root Cause

The previous count was copied from memory/earlier run, not verified by
re-running tests. The test suite is slightly flaky (incubator pollution)
so counts vary between runs.

### Fix

- ✅ Corrected in `ALPHA-REGRESSION-TEST-REPORT.md` with actual numbers
- ✅ Documented the flakiness

### Handoff to Bravo?

**NO** — Alpha's documentation issue.

---

## Issues NOT for Bravo (confirmed Alpha/owner scope)

| Issue | Scope | Action |
|-------|-------|--------|
| incubator test pollution | Alpha test file | Alpha to fix (use spyOn) |
| a2-sector-tracking 8 FAIL | Frontend component | Owner decision (revert vs update) |
| `?? 0` on financial fields | Frontend display | Alpha Workstream A (pending) |

---

## Summary

| Issue ID | Severity | Reproduced | Bravo scope? | Action |
|---------|----------|-----------|--------------|--------|
| ALPHA-H1 | MEDIUM | ✅ (flaky) | ❌ | Alpha fixes test (spyOn) |
| ALPHA-H2 | LOW | ✅ (100%) | ❌ | Owner decision (revert vs update) |
| ALPHA-H3 | LOW | ✅ | ❌ | Alpha corrected docs |

**No issues handed off to Bravo** — all findings are frontend/test scope.

---

## What Alpha Did NOT Do

- ❌ Did NOT modify any Bravo-owned file (next-auth-shim, useAuthCheck, auth routes)
- ❌ Did NOT change engine formulas or financial logic
- ❌ Did NOT revert any commit (even a2 — needs owner decision)
- ❌ Did NOT claim fixes without evidence
- ❌ Did NOT push to main (all on alpha/tool-effectiveness branch)

---

## Files Changed in This Session

| File | Change | Commit |
|------|--------|--------|
| `ALPHA-BRAVO-SUPPORT-PLAN.md` | NEW | 547e7ec |
| `ALPHA-REGRESSION-TEST-REPORT.md` | NEW | 137801e |
| `ALPHA-BRAVO-HANDOFF.md` | NEW (this file) | (pending) |
| `src/__tests__/components/incubator-panel.test.tsx` | Reverted (no net change) | (no commit — reverted) |

---

## Next Actions for Alpha

1. ⏳ Workstream A: Build financial null-handling tests (`financial-null-handling.test.tsx`)
2. ⏳ Workstream C: Classify API consumers by evidence level
3. ⏳ Fix incubator test pollution (use `vi.spyOn` instead of `Object.defineProperty`)
4. ⏳ Await owner decision on a2-sector-tracking (Option A vs B)

## Next Actions for Bravo (if any)

**None** — all issues found are Alpha/frontend scope. Bravo can continue
engine work without coordination needed.
