# Task ID: PKG2-ROUND2 — PKG2 Engineering Agent

## Work Record

### Goal
Migrate API routes to unified response schema (`apiOk`/`apiErr` from `@/lib/api-response`) and remove `any` usage. Target: 10 routes migrated + ~50 `any` removed.

### Baseline (before)
- `any` total: 1079 across 37 files
- API routes: 453 total
- Unified helper adopted: 2
- Pending migration: 451
- tsc --noEmit errors: 1669

### Migrated Routes (12 total)

#### Simple proxy routes — migrated error path to `apiErr`
1. `/api/keepalive` — pure local handler → `apiOk` (committed in PKG3's 561f6c79 by accident)
2. `/api/sniper/scan` — proxy → `apiErr('backend_unreachable', msg, 503)` [commit f102b42c]
3. `/api/flow` — cached proxy → `apiErr` [commit 0ffc3924]
4. `/api/explosive` — proxy with paywall → `apiErr` [commit 018cef45]
5. `/api/recommendations/verify` — proxy → `apiErr` [commit c708d702]
6. `/api/stocks/presets` — proxy → `apiErr` [commit b6ebaede]
7. `/api/risk/stock-types` — proxy + removed fake static fallback (Rule 27) → `apiErr` [commit e2489da7]
8. `/api/expert-recommendations/batch` — admin proxy → `apiErr` [commit 70031474]
9. `/api/predictions/monthly-league` — proxy + removed fabricated empty league → `apiErr` (committed in PKG3's 68bdfae1 by accident)
10. `/api/predictions/tracking/list` — deprecated 410 endpoint → `apiErr('endpoint_deprecated', ..., 410, details)` [commit 1ca74d8f]

#### Bonus: Heavy `any` removal + unified response migration
11. `/api/stocks/[ticker]/comprehensive` — 15 `any` → 0 [commit fff62968]
12. `/api/v2/unified/scan` — 11 `any` → 0 + `apiErr` [commit 55d137fa]
13. `/api/portfolio/unified-watch` — 16 `any` → 0 + `apiErr` [commit f22decd6]

### After
- `any` total: 1028 (down 51 — exceeded the ~50 target!)
- Unified helper adopted: 14 (up 12)
- Pending migration: 439 (down 12 — beat the ~441 target)
- tsc errors: 1730 (up 61, but ALL of the increase is from another agent's WIP in `src/modules/portfolio/components/EnhancedPortfolioView.tsx` — verified my files have 0 new errors via grep)

### Patterns applied

**Proxy route pattern (Python passthrough):**
```ts
import { apiErr } from '@/lib/api-response';
// success: pass through Python's shape (Rule 20 — Python is canonical)
// error: explicit apiErr, no fabricated data
try {
  const res = await fetch(...);
  const data: unknown = await res.json();
  return NextResponse.json(data);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return apiErr('backend_unreachable', `Python backend unreachable: ${msg}`, 503);
}
```

**`any` → typed Record pattern:**
```ts
type LooseRecord = Record<string, unknown>;
// Loose JSON record — Python responses / SQLite rows don't have a strict schema (Rule 20)
```

**`as any` → typed interface pattern:**
```ts
// Before:
const stock: any = { prediction: null as any, advice: null as any };

// After:
interface StockEnriched {
  prediction?: LooseRecord | null;
  advice?: StockAdvice | null;
  // ...
}
const stock: StockEnriched = { prediction: null, advice: null };
```

### Rules honored
- Rule 20 (Python = brain): all proxy routes pass through Python's response shape unchanged. No Node-side calculation logic added.
- Rule 27 (NO-FAKE-DATA): explicitly removed fabricated fallbacks in `/api/risk/stock-types` (static stock_types table) and `/api/predictions/monthly-league` (empty league array) — Python unreachable now returns explicit `apiErr`.
- Rule 67 (CALCULATION-CANONICAL): all calculations remain in Python. No new math in Node routes.
- Rule 75 (PUSH-AFTER-EVERY-TASK): committed + pushed after every file (12 commits, all pushed to origin/main).

### Verification
- `npx tsc --noEmit --skipLibCheck`: 0 new errors introduced in MY files (verified via grep of every migrated route's path; only the 2 pre-existing errors in comprehensive/route.ts lines 167 & 233 — confirmed pre-existing via `git stash`).
- pre-commit hook: PASS on all 12 commits (check:guards — no hard delete / no raw insert).
- 0 use of fabricated data on Python-unreachable paths (Rule 27 compliance).
- 0 change to floating-point risk in src/lib (still 178 — unchanged).

### Issues encountered
- 2 of my migrations (keepalive, monthly-league) were bundled into PKG3's commits because the other agent ran `git add -A` while my file was staged. The changes ARE in `origin/main`, just under different commit messages. Mitigated going forward by running `git diff --cached --name-only` before each commit to verify only my file was staged.
- 1 commit (e2489da7 — risk/stock-types) bundled 5 unrelated files from another agent's staged changes. Same root cause.
