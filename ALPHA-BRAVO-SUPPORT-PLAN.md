# ALPHA-BRAVO SUPPORT PLAN
## Task Ownership & Overlap Map

**Date:** 2026-10-27
**Agent:** Alpha (Parallel Engineering Support)
**Branch:** `alpha/tool-effectiveness`
**Program:** GLMinvestment Tool & Engine Effectiveness Program — Phase 2

---

## 1. Coordination Status

### Alpha branch state
- Branch: `alpha/tool-effectiveness`
- Base: `aad604b` (Bravo's latest — "break circular session render loop")
- Alpha deliverables: 7 files (P0 Gate + Phase 1-5) — all intact
- No conflicts with Bravo (Alpha = docs only, Bravo = .tsx/.ts auth files)

### Bravo's recent commits (last 5)
| Commit | Description | Files Touched |
|--------|-------------|---------------|
| `aad604b` | break circular session render loop (React error 185) | page.tsx, LiquidityRadarView, useAuthCheck, next-auth-shim |
| `b73da52` | Merge origin/main | merge commit |
| `f2f1139` | Alpha program report | ALPHA-PROGRAM-REPORT.md (Alpha) |
| `127f037` | eliminate loading deadlock | page.tsx, useAuthCheck, next-auth-shim |
| `526c0b5` | connect next-auth-shim to app store | next-auth-shim, page.tsx |

### Files Bravo owns (DO NOT TOUCH without coordination)
- `src/lib/next-auth-shim.ts` ← Bravo active
- `src/hooks/useAuthCheck.ts` ← Bravo active
- `src/app/page.tsx` ← Bravo active
- `src/app/api/auth/me/route.ts` ← Bravo active
- `src/app/api/auth/[...nextauth]/route.ts` ← Bravo active
- `src/app/api/auth/login/route.ts` ← Bravo active
- `vps-service/**` (Python) ← Bravo active
- `db/**` (databases) ← Bravo active

### Files Alpha owns (Bravo should not touch)
- `src/__tests__/components/incubator-panel.test.tsx`
- `src/__tests__/components/a1-liquidity-radar.test.tsx`
- `src/__tests__/components/a4-no-trade-banner.test.tsx`
- `src/__tests__/components/fabrication-guard.test.tsx`
- `src/__tests__/components/api-shape.test.tsx`
- `src/__tests__/components/null-handling.test.tsx`
- `src/modules/radar/components/IncubatorSection.tsx` (unless coordination)

### Shared files (need coordination)
- `src/components/shared/LiquidityRadarView.tsx` (Bravo modified in f7083c6, Alpha in 7f8697e)
- `src/components/shared/SectorTrackingTab.tsx` (has test failures — needs decision)

---

## 2. Task Overlap Map

### Bravo's P0 Issues (owns)
| Issue | Status | Alpha support? |
|-------|--------|----------------|
| P2023 Prisma crash (last_active_at) | ✅ Fixed (cdc17b8) | Alpha verified tests pass |
| ADMIN_USERNAME mismatch | ✅ Fixed (cdc17b8) | Alpha verified |
| Auth redirect loop | ✅ Fixed (b497061 + cdc17b8 + 7f8697e) | Alpha fixed shim + isGuest |
| Circular session render (React 185) | ✅ Fixed (aad604b) | Alpha will verify tests |
| Loading deadlock | ✅ Fixed (127f037) | Alpha will verify tests |

### Alpha's independent tasks (no Bravo overlap)
| Task | Priority | Status |
|------|----------|--------|
| Re-verify test count (don't copy 69) | P0 | ✅ DONE — actual: 69 tests, 9 FAIL (not 8) |
| Investigate incubator-panel test pollution | P0 | 🔄 IN PROGRESS |
| `?? 0` on financial fields — build tests | P0 | ⏳ PENDING |
| Classify API consumers by evidence level | P1 | ⏳ PENDING |
| a2-sector-tracking FAIL root cause | P0 | 🔄 INVESTIGATING |

### Tasks needing Bravo coordination
| Task | Why | Action |
|------|-----|--------|
| `comprehensive` vs `professional-analysis` API overlap | Need Bravo to confirm backend logic | Alpha documented question |
| 4 APIs with 0 web consumers | Need Bravo to verify mobile/admin | Alpha documented in garage candidates |
| v82 engine status | Need Bravo to confirm if exists | Alpha documented as BLOCKED |

---

## 3. Workstream Plan

### Workstream A: Financial API contract tests (P0)
**Goal:** Build tests that prevent missing/null financial fields from displaying as `0.00`.

**Scope:**
- Trace data path: API response → component → render
- Identify where `?? 0` converts null → 0
- Build tests that verify `null` → "—" (not 0.00) for:
  - entry_price
  - target_price
  - stop_loss
  - risk_reward

**DO NOT:**
- Change engine formulas
- Change scoring logic
- Change entry/target calculations
- Change stop-loss rules
- Change financial risk policies

**Deliverable:** Tests in `src/__tests__/components/financial-null-handling.test.tsx`

### Workstream B: Regression tests (P0)
**Goal:** Verify actual test results + build reproducible tests for Bravo's fixes.

**Findings so far:**
- Actual test count: **69 tests** (7 files)
- Actual PASS: **60** (not 67 as previously reported)
- Actual FAIL: **9** (not 8 as previously reported)
- **NEW finding:** incubator-panel test passes alone (12/12) but FAILS when run with other tests → **test pollution**

**Action:**
- Investigate test pollution root cause
- Build reproducible test for the pollution
- Hand off to Bravo if pollution is in shared code

### Workstream C: API consumer verification (P1)
**Goal:** Classify API consumers by evidence level (not just grep matches).

**Evidence levels:**
1. Static reference found (rg match)
2. Direct code caller confirmed (function call)
3. Reachable through screen/route/scheduled job (code trace)
4. Runtime behavior verified (browser/network)

**Deliverable:** Updated `API-REDUNDANCY-AND-USAGE.md` with evidence levels

---

## 4. Communication Protocol

### Alpha will NOT:
- Modify Bravo-owned files without explicit coordination
- Merge to main without owner approval
- Claim an issue is fixed without showing evidence
- Re-run successful tests without technical reason
- Copy previous test counts without verification

### Alpha WILL:
- Work only on `alpha/tool-effectiveness` branch
- Document all findings with actual commands + results
- Hand off engine issues to Bravo (not fix them)
- Build reproducible tests for Bravo's defects
- Update worklog with real evidence

---

## 5. Success Criteria (per owner directive)

| Criterion | How measured |
|-----------|--------------|
| New useful tests that catch real bugs | Test files added + bugs found |
| Less time for Bravo on repro + integration | Handoff reports with repro steps |
| No file conflicts or unauthorized changes | Git diff clean, no overlap |

---

## Next Actions

1. ✅ Coordinate (this doc)
2. 🔄 Workstream B: investigate incubator test pollution (IN PROGRESS)
3. ⏳ Workstream A: build financial null-handling tests
4. ⏳ Workstream C: classify API consumers
5. ⏳ Deliverable 2: ALPHA-REGRESSION-TEST-REPORT.md
6. ⏳ Deliverable 3: ALPHA-BRAVO-HANDOFF.md
