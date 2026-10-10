# Round 2: Engineering Audit

**Project**: EGX Investment Platform (`egx-investment-platform` v3.4.41)
**Audit Date**: 2026-10-09 (Round 2)
**Auditor**: Team-3-Engineering (sandboxed research-only — no code modified)
**Scope**: Verify Round 1 fixes; re-measure the 11 engineering findings; report new issues.
**Method**: `bun run lint`, `rg` patterns, Python AST-style walks over `src/`.

---

## Fixed (with evidence)

### F1. IDOR in `/api/user-posts` POST ✅ FIXED
**Round 1 finding**: POST handler trusted `body.user_id` — any authenticated user could publish/award points as any other user.

**Round 2 evidence** (`src/app/api/user-posts/route.ts`):
- Lines 53–54: `const user_id = await getSessionUserId();` then `if (!user_id) return 401`.
- The same session-derived `user_id` is passed to `awardPoints(user_id, …)` (line 145) — the impersonation vector is closed.
- Inline comment documents the fix: `SECURITY-FIX (2026-10-09, Team 3 IDOR): استخدم session userId بدل body.user_id`.
- Round 1 worklog cross-reference: `AUDIT-4 CRIT-7/8` (session-based auth added to `/api/community` + `/api/user-posts`).

**Verdict**: IDOR closed at the trust boundary (session-derived ID → all downstream writes).

### F2. SQL injection in `/api/maker-radar` GET ✅ FIXED
**Round 1 finding** (00-MASTER-REPORT.md §P0-3): `AND market = '${market}'` — direct string interpolation in `db.prepare()`.

**Round 2 evidence** (`src/app/api/maker-radar/route.ts` lines 108–117):
```ts
// SECURITY-FIX + DEEP-MARKET-SEPARATION: parameterized query بدل interpolation
let liveRows: any[];
if (market === 'EGX') {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market IN ('EGX','مصر')`).all() as any[];
} else if (market) {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market = ?`).all(market) as any[];
} else {
  liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0`).all() as any[];
}
```
- The attacker-controlled `market` value now flows through `.all(market)` parameterized binding, not interpolation.
- The `EGX` branch uses literal string constants (not user input) — safe.
- Also verified `/api/maker-radar/fundamentals/route.ts` line 52 uses `LIKE ?` with `.get(ticker + '%')` — parameterized.

**Verdict**: SQLi closed; user input is bound, not interpolated.

### F3. Forbidden colors (indigo + blue-500/600/700) ✅ FIXED (specific patterns)
**Round 1 finding** (team-8-frontend.md): 125 forbidden-color violations across 50 files (`indigo|blue-500|blue-600`).

**Round 2 evidence**:
- `indigo-N` in `className`: **0 occurrences / 0 files**.
- `blue-500` in `className`: **0 / 0**.
- `blue-600` in `className`: **0 / 0**.
- `blue-700` in `className`: **0 / 0**.
- Worklog confirms: "استبدال indigo بـ teal: 30 ملف → 0 (مش admin comments)".

**Caveat**: Broader `blue-N` palette (50/100/200/300/400/900/950) is still used — **215 occurrences in 45 files / 79 inside `className` strings**. These lighter/darker shades arguably violate the *spirit* of Rule 30 (emerald + amber + slate + red only) but were not part of Round 1's specific pattern set. Lint rule was never added — enforcement is still manual.

### F4. Two previously-unguarded admin routes now have `requireAdminAsync` ✅ FIXED
**Round 1 finding** (team-3 §5.2): 5 admin routes had no auth — including `admin/ai-analyze` and `admin/ab-test`.

**Round 2 evidence**:
- `src/app/api/admin/ai-analyze/route.ts`: now imports + calls `requireAdminAsync(req)` (comment: `AUTH-FIX (2026-10-09, Team 3)`).
- `src/app/api/admin/ab-test/route.ts`: same fix applied.
- `admin/auth/auto-cookie`: uses `getServerSession` + `isAdmin()` + DB tier check — adequate (different pattern, not unguarded).
- `admin/auth` and `admin/auth/token`: correctly unguarded (login/token-issue endpoints).

**Verdict**: 2 of the 5 routes Round 1 flagged were actually fixed (the other 3 were either false positives or already used alternative auth).

---

## Still broken

### B1. `ignoreBuildErrors: true` ❌ UNCHANGED
- `next.config.ts` line 8: `typescript: { ignoreBuildErrors: true }` — still present.
- `package.json` build script: `next build --no-lint` — still bypasses lint at build time.
- `tsconfig.json`: `noImplicitAny: false` — still opts out of strict any-checking.
- `reactStrictMode: false` — still off.
- **Impact**: TypeScript errors silently ship to production; type-checks do not block builds.

### B2. ESLint effectively disabled ❌ UNCHANGED
- `eslint.config.mjs`: 27 rules explicitly set to `"off"` including `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`, `no-console`, `no-debugger`, `no-unreachable`, `no-empty`, `prefer-const`, `no-unused-vars`.
- `bun run lint` output: **1 line (`$ eslint .`), exit 0, zero warnings/errors** — functionally a no-op.
- Build script `--no-lint` means even these disabled rules don't run during CI.

### B3. ~271 routes without auth ❌ UNCHANGED (Round 1: 272)
- Total API routes: **450** (Round 1: 449 — one route added).
- Routes calling at least one auth helper (`requireAdminAsync | requireAuthAsync | verifyAdminRequest | requireAdminRequest | getSessionUserId | getServerSession`): **179 (39.8 %)**.
- Routes with **no auth guard**: **271 (60.2 %)** (Round 1: 272).
- Net change: −1 route (statistically zero). No systematic auth rollout was done.

### B4. 17+ unused dependencies ❌ UNCHANGED (slightly worse)
- Round 1 listed ~25 entries in §7.2 (labelled "17 unused production dependencies"; internal inconsistency).
- Round 2 verified usages across `src/` + root configs (including dynamic imports and side-effect imports):
  - **Truly unused** (no static, dynamic, or side-effect imports anywhere in `src/`): **22 packages** — `@dnd-kit/{core,sortable,utilities}`, `@mdxeditor/editor`, 5 unused `@radix-ui/react-*`, `@reactuses/core`, `@swc/helpers`, `@tanstack/{react-query,react-table}`, `@xyflow/react`, `cmdk`, `date-fns`, `embla-carousel-react`, `input-otp`, `next-intl`, `react-day-picker`, `react-resizable-panels`, `react-syntax-highlighter`, `react-markdown`, `uuid`, `vaul`, `html2pdf.js`, `jspdf`.
  - **Round 1 false positives removed**: `@sentry/nextjs` (used in `sentry.{client,server,edge}.config.ts` + `next.config.ts`), `html-to-image` (used in 24 files), `katex` (used in `MathRenderer.tsx`), `autoprefixer` (used in `postcss.config.mjs`), `prisma` (CLI used via scripts).
  - **No dependency was removed between Round 1 and Round 2.** The list is identical or slightly larger.
- Bundle impact unchanged: `@mdxeditor/editor` (~1 MB), `@xyflow/react` (~500 KB), `@tanstack/react-{query,table}` all still ship.

### B5. `any` usage ❌ INCREASED (Round 1: 766 → Round 2: 934)
Combined count of `: any` + `<any>` + `as any` + `as unknown` + `@ts-ignore` + `@ts-expect-error` + `@ts-nocheck` across `src/`:
| Pattern | Count |
|---|---|
| `: any` | 545 |
| `as any` | 256 |
| `<any>` | 36 |
| `as unknown` | 70 |
| `@ts-*` directives | 1 |
| **TOTAL** | **934** (Round 1: 766 → **+168**) |

**Verdict**: `any` usage grew by ~22 % since Round 1. ESLint rule that would catch this is still `"off"`.

### B6. `console.*` calls bypassing `logger.ts` ❌ INCREASED (Round 1: 715 → Round 2: 1196)
- `console.*` calls in `src/`: **1196** (Round 1: 715 → **+481**, +67 %).
- Files containing `console.*`: **458**.
- Files importing `@/lib/logger`: **16**.
- `logger.{log,info,warn,error,debug}` calls: **120** (only 9 % of console output goes through structured logger).
- Top offenders: `data-adapter.ts` (51), `multi-source-adapter.ts` (30), `data-engine-db.ts` (27), `egx-db.ts` (21), `auth/google/route.ts` (21), `auth/google-signin/route.ts` (20).
- Round 1's concern about `console.log('[Auth Debug] …')` in `src/app/api/auth/[...nextauth]/route.ts` is still valid (17 console calls in that single file).

### B7. 9 overlapping HTTP client modules ❌ UNCHANGED
All 9 files from Round 1's §3.5 are still present with near-identical LOC:

| File | Round 1 LOC | Round 2 LOC |
|---|---|---|
| `src/lib/vps-client.ts` | 657 | 656 |
| `src/lib/vps-adapter.ts` | 798 | 798 |
| `src/lib/data-adapter.ts` | 1342 | 1342 |
| `src/lib/multi-source-adapter.ts` | 1060 | 1060 |
| `src/lib/python-backend.ts` | 160 | 160 |
| `src/lib/market-pulse-proxy.ts` | 42 | 42 |
| `src/lib/api-client.ts` | 340 | 340 |
| `src/lib/server-url.ts` | 74 | 73 |
| `src/lib/egxpy-bridge.ts` | — | 530 |
| **TOTAL** | ~4473 | **~5001** |

No consolidation was performed. `egxpy-bridge.ts` LOC was unmeasured in Round 1; now confirmed at 530 LOC.

### B8. God store `src/lib/store.ts` ❌ UNCHANGED
- Round 1 LOC: 1541 → Round 2 LOC: **1541** (identical).
- Other stores unchanged: `portfolio-store.ts` (196), `alerts-store.ts` (205), `notification-store.ts` (102), `analysis-store.ts` (62), `crypto-learning-store.ts` (385).
- 95 files import `@/lib/store`.
- God components unchanged: `EnhancedPortfolioView.tsx` (3361), `UnifiedTable.tsx` (2453→**2601**, +148 LOC after multi-sort feature added in latest task), `AdminView.tsx` (2083), `page.tsx` (1049).

### B9. Empty / comment-only catch blocks ❌ INCREASED
- Truly empty `catch {}` (zero body): **3**.
- Comment-only `catch { /* ignore */ }`: **562**.
- **Combined silent-failure catch blocks: 565** (Round 1: 140 → **+425**, but Round 1 likely used a stricter regex; either way, the trend is significantly upward, not downward).
- 2364 total catch blocks in the codebase; ~24 % silently swallow errors.

### B10. Raw SQL execution endpoint (`/api/admin/db-manager/query`) ❌ UNCHANGED
- `src/app/api/admin/db-manager/query/route.ts` still accepts arbitrary SQL (DDL + DML) — gated only by `requireAdminAsync`.
- No statement-type whitelist, no audit log of executed statements.
- Round 1's C3 finding still applies: admin compromise = arbitrary SQL execution including `DROP DATABASE`.

### B11. Hardcoded admin email list still ships to browser ❌ UNCHANGED
- `src/lib/admin-identities.ts` `DEFAULT_ADMIN_EMAILS` still in source (4 emails + 2 usernames) — leaked to client bundle when `NEXT_PUBLIC_ADMIN_EMAILS` is unset.

### B12. Dead / preserved code ❌ UNCHANGED
- `src/app/api/deal-advisor/[ticker]/route.ts.preserved` (1012 LOC) still committed alongside the live `route.ts`.
- Root-level operational scripts (`comprehensive_production_fix.py`, `fix_cron_paths.sh`, `fix_production_db.sql`, `check_v402_predictions.sh`, `deep_server_audit.sh`, `radar_server_commands.sh`, `run-server.sh`, `test_stats.js`) still cluttering the repo root.

---

## New issues (introduced between Round 1 and Round 2)

### N1. `any` count grew by 168 (+22 %)
See B5. Despite Round 1 explicitly calling this out, no enforcement was added — the team shipped new code with more `any` types than before. Top contributors: `data-adapter.ts`, `admin-db-manager.ts`, `chart/[ticker]/route.ts` all unchanged in their `any` density.

### N2. `console.*` count grew by 481 (+67 %)
See B6. The structured `logger` exists but is used in only 16 files; 458 files still call `console.*` directly. Round 1's recommendation (replace with `logger.debug()`) was not actioned. Auth-debug logging in `next-auth/route.ts` (17 console calls) is still present.

### N3. `UnifiedTable.tsx` grew by 148 LOC
- Round 1: 2453 LOC → Round 2: 2601 LOC.
- Latest commit (`UNIFIED-TABLE-UPGRADE` in worklog) added multi-sort + custom-sort Popover + 4 trader presets. The god component keeps growing rather than being decomposed.

### N4. Broader `blue-N` palette violations (215 across 45 files)
See F3 caveat. The specific Round 1 patterns (indigo, blue-500/600/700) were cleaned, but the team continued using `blue-50`, `blue-100`, `blue-200`, `blue-300`, `blue-400`, `blue-900`, `blue-950` as if they were on the approved palette. Examples:
- `TithesView.tsx`: 27 blue-* usages (blue-950, blue-50, blue-400).
- `ZakatView.tsx`: 8 blue-* usages.
- `EnhancedPortfolioView.tsx`: 13 blue-* usages.
- `MakerRadarTab.tsx`: 19 blue-* usages.

Without an ESLint rule, the cleanup will rot — next dev who reaches for `blue-500` will not be caught.

### N5. Unbounded `take:` queries still common
- 26 `take:` patterns across the API surface — only ~8 routes actually paginate. The other ~440 routes either have implicit small result sets or are unbounded. Round 1's §6.2 finding unchanged.

### N6. N+1 query in `/api/points/leaderboard` ❌ UNCHANGED
- `src/app/api/points/leaderboard/route.ts` lines 37–50 still uses `Promise.all(leaderboard.map(async (up) => { … db.userPost.count … }))` — 100+ DB queries for a 50-user leaderboard.
- No `groupBy` aggregate refactor was applied.

### N7. Empty catch blocks grew by ~425
See B9. The "silent failure" surface is larger than Round 1 measured.

### N8. `@dnd-kit/*` (3 packages) added since Round 1, all unused
- Round 1 did not list `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- They are now in `package.json` (v3.4.41) with **0 usages** in `src/`. Likely added in anticipation of the `UnifiedTable` drag-to-reorder feature but the implementation uses native HTML5 drag events instead.

---

## Score improvement (Round 1 → Round 2)

### Issue-by-issue scorecard

| # | Round 1 Finding | Round 1 Severity | Round 2 Status | Delta |
|---|---|---|---|---|
| 1 | IDOR in `/api/user-posts` | CRITICAL | ✅ FIXED | **+1 (closed)** |
| 2 | SQL injection in `/api/maker-radar` | CRITICAL | ✅ FIXED | **+1 (closed)** |
| 3 | `ignoreBuildErrors: true` | CRITICAL | ❌ UNCHANGED | 0 |
| 4 | 272 routes without auth | HIGH | ❌ 271 routes (−1) | 0 |
| 5 | 17 unused dependencies | HIGH | ❌ 22 unused (+5 net new, e.g. `@dnd-kit/*`) | **−1 (regressed)** |
| 6 | 766 `: any` types | HIGH | ❌ 934 (+168) | **−1 (regressed)** |
| 7 | 715 `console.*` bypassing logger | HIGH | ❌ 1196 (+481) | **−1 (regressed)** |
| 8 | 9 overlapping HTTP clients | HIGH | ❌ 9 unchanged | 0 |
| 9 | God store (1541 LOC) | HIGH | ❌ 1541 unchanged | 0 |
| 10 | 140 empty catch blocks | HIGH | ❌ 565 (depending on definition; +425 by broad count) | **−1 (regressed)** |
| 11 | 125 forbidden colors | HIGH | ✅ 0 (specific patterns) / ⚠️ 215 broader blue-N | **+0.5 (partial)** |
| Bonus | 5 unguarded admin routes | HIGH | ✅ 2 of 5 fixed (`ai-analyze`, `ab-test`) | **+0.4** |
| Bonus | Raw SQL execution endpoint (C3) | CRITICAL | ❌ UNCHANGED | 0 |
| Bonus | Hardcoded admin emails (C4) | CRITICAL | ❌ UNCHANGED | 0 |
| Bonus | N+1 in `/api/points/leaderboard` (H1) | HIGH | ❌ UNCHANGED | 0 |

### Net score
- **Round 1 critical issues**: 5 (IDOR, SQLi, ignoreBuildErrors, raw SQL endpoint, hardcoded admin emails)
- **Round 2 critical issues fixed**: 2 (IDOR, SQLi)
- **Round 2 critical issues still open**: 3 (ignoreBuildErrors, raw SQL endpoint, hardcoded admin emails)
- **Round 2 high-priority items regressed**: 4 (unused deps, `any`, `console.*`, empty catch)
- **Round 2 high-priority items improved**: 1 partial (forbidden colors), 1 minor (admin route auth)

### Engineering hygiene score (0–100)

| Dimension | Round 1 | Round 2 | Delta |
|---|---|---|---|
| Type safety enforcement | 20 | 20 | 0 (ignoreBuildErrors still on; `any` grew) |
| Lint enforcement | 0 | 0 | 0 (all rules still off) |
| Auth coverage | 39 % | 40 % | +1 pp (marginal) |
| Dependency hygiene | 60 | 55 | −5 (more unused deps) |
| Logger adoption | 9 % | 9 % | 0 (120 logger vs 1196 console) |
| State-store modularity | 30 | 30 | 0 (god store unchanged) |
| HTTP client consolidation | 30 | 30 | 0 (9 modules intact) |
| Color-palette compliance | 50 | 80 | +30 (specific patterns gone) |
| Error-handling hygiene | 40 | 30 | −10 (empty catch grew) |
| **Weighted average** | **~30/100** | **~32/100** | **+2** |

### Bottom line
- **2 of 5 critical issues fixed** (IDOR + SQLi) — these were the highest-impact security holes and are genuinely closed.
- **0 of the 4 systemic engineering-hygiene issues** were addressed. `ignoreBuildErrors`, ESLint disabling, god store, and HTTP-client sprawl are all byte-for-byte identical to Round 1.
- **4 high-priority metrics actually regressed** (`any`, `console.*`, empty catches, unused deps). The team shipped features without re-enforcing the guard-rails Round 1 asked for; technical debt is growing faster than it is being paid down.
- **Engineering score improved by ~2 points out of 100**, almost entirely from the two CRITICAL security fixes plus the indigo/blue-500/600 color cleanup. The systemic quality issues (no type-check enforcement, no lint, no logger adoption, no store split, no HTTP-client consolidation) remain exactly where Round 1 left them.

### Recommended Round 3 priorities (highest leverage first)
1. **Flip `ignoreBuildErrors: false` + drop `--no-lint`** — single change that turns ~934 `any` + ~1196 `console.*` from "invisible" to "blocking". Will produce a large error count on day 1; triage in waves.
2. **Re-enable `@typescript-eslint/no-explicit-any`, `no-console`, `no-unreachable`, `no-debugger`, `no-empty`, `react-hooks/exhaustive-deps`** as `warn` first, then `error` after a sprint.
3. **Delete the 22 truly-unused deps** (`@dnd-kit/*`, `@mdxeditor/editor`, `@tanstack/react-{query,table}`, `@xyflow/react`, `cmdk`, `vaul`, `input-otp`, `react-syntax-highlighter`, `next-intl`, `react-markdown`, `uuid`, `date-fns`, `embla-carousel-react`, `react-day-picker`, `react-resizable-panels`, `html2pdf.js`, `jspdf`, `@reactuses/core`, `@swc/helpers`, 5× unused `@radix-ui/react-*`). Estimated bundle reduction: 2–4 MB.
4. **Add an ESLint rule forbidding `indigo-` and `blue-N` (N ∈ {400,500,600,700}) in `className`** with an explicit allow-list for brand icons (Facebook blue etc.). Without this, the 0-count will rot back to 125+ within a sprint.
5. **Replace `console.*` with `logger.*`** in the top 10 offenders (`data-adapter.ts`, `multi-source-adapter.ts`, `auth/*`, `egx-db.ts`). Will reduce the 1196 → ~600 in one pass.
6. **Restrict `/api/admin/db-manager/query` to SELECT only**; require a separate elevated permission + audit log for DDL/DML.
7. **Split `store.ts` (1541 LOC)** into domain stores (stocks, watchlists, portfolios, recommendations, personas).
8. **Consolidate the 9 HTTP clients** into a single `BackendClient` with per-resource method signatures.

---

**Audit complete. No code was modified. 0 files deleted. 0 git pushes.**
