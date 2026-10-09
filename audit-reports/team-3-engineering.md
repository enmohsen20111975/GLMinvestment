# Team 3: Engineering Architecture Audit

**Project**: EGX Investment Platform (`egx-investment-platform` v3.4.41)
**Audit Date**: 2026-10-09
**Auditor**: Team-3-Engineering (sandboxed research-only audit)
**Scope**: Engineering architecture, code quality, technical debt, security, performance, dependencies

---

## Executive Summary

The EGX Investment Platform is a **large monolithic Next.js 14 application** (~298K LOC in `src/`, 449 API routes, 250 client components, 182 module files, 108 lib files) paired with a separate Python backend (`vps-service/`, not in scope). The codebase shows clear evidence of rapid iterative development over many months (worklog.md goes back to dozens of refactor waves). While recent security remediation work has visibly hardened the admin auth surface, the **engineering fundamentals are weak**: TypeScript strictness is undermined by `ignoreBuildErrors: true` + `noImplicitAny: false`, **ESLint is effectively disabled** (every important rule is off), and ~17 production dependencies are completely unused. The single Zustand store (`src/lib/store.ts`, 1541 LOC) has become a god-object holding almost all client state. Despite `@tanstack/react-query` being declared as a dependency, **zero usages exist** — all server state is fetched manually with `fetch()` inside `useEffect`/`useCallback`, leading to repeated polling logic, race conditions, and missing cache invalidation.

**Critical issues**: IDOR in `/api/user-posts` POST, raw SQL execution endpoint, disabled TypeScript checking, ~17 unused dependencies inflating bundle, N+1 query in leaderboard, hardcoded admin emails shipped to browser bundle.

---

## 1. Project Structure

### 1.1 Top-level layout
```
src/
├── app/                # Next.js App Router
│   ├── api/            # 449 route.ts files (Next.js Route Handlers)
│   ├── admin/          # 4 admin pages
│   ├── backtest/       # 1 page
│   ├── payment/        # 1 page
│   ├── layout.tsx, page.tsx (1049 LOC!), error.tsx, loading.tsx, not-found.tsx
│   ├── robots.ts, sitemap.ts
│   └── globals.css
├── components/          # 103 .tsx files (shared components)
│   ├── ui/             # shadcn/ui primitives (~40 files)
│   ├── auth/, layout/, market/, ...
├── modules/            # 182 files (feature modules)
│   ├── admin/components/      # 35 admin UI components
│   ├── market-analysis/components/   # 26 stock analysis components
│   ├── dashboard/components/         # 16 dashboard widgets
│   ├── portfolio/components/          # 12 portfolio components
│   ├── stock-analysis/components/     # 15 components
│   ├── radar/, predictions/, reports/, education/, ...
├── lib/                # 108 files (utilities, data-access, stores, HTTP clients)
├── hooks/              # 7 custom hooks
├── types/              # index.ts (598 LOC), v2.ts (324 LOC)
├── data/               # static data
└── middleware.ts       # 240 LOC (request ID, CDN cache, public/admin route map)
```

### 1.2 Module organization
- ✅ **Good**: Feature modules (`src/modules/<feature>/components/`) follow a consistent barrel-export pattern (`index.ts`).
- ✅ **Good**: shadcn/ui primitives isolated in `src/components/ui/`.
- ✅ **Good**: Test files co-located in `src/__tests__/` with logical sub-folders (`api/`, `radar/`, `security/`, `regime/`).
- ⚠️ **Concern**: Mixing of `src/components/` (103 files) and `src/modules/<feature>/components/` (180+ files) with no clear rule about which goes where. E.g. `src/components/auth/AuthView.tsx` vs `src/modules/auth/components/DevLoginForm.tsx`.
- ⚠️ **Concern**: `src/lib/` is a flat 108-file directory with no sub-folders (except `ai/`, `indicators/`, `schedulers/`, `protection/`, `honest-tracking/`). Hard to navigate.
- ⚠️ **Concern**: Multiple overlapping data-access files: `egx-db.ts`, `finance-db.ts`, `metrics-db.ts`, `community-db.ts`, `bot-link-db.ts`, `paper-trading-v2-db.ts`, `db-predictions.ts`, `db-auth.ts`, `db/index.ts`, `db.ts`, `new-db.ts`, `new-db-queries.ts`, `shared-db.ts`, `unified-db.ts`, `sqlite-admin.ts`, `sqlite-wrapper.ts`, `data-engine-db.ts`, `data-engine-db-sqljs.ts`, `flutter-sqlite-fallback.ts`. Naming implies multiple generations of "the new DB layer" co-existing without cleanup.

### 1.3 Total code volume
- `src/`: **~297,875 LOC** across `*.ts` + `*.tsx`
- 449 API route handlers
- 250 client components (`'use client'` directive)
- 715+ `console.*` calls (despite a structured `logger.ts` module existing)

---

## 2. Code Quality

### 2.1 TypeScript configuration (`tsconfig.json`)
```json
{
  "strict": true,
  "noImplicitAny": false,         // ⚠️ defeats half of strict mode
  "skipLibCheck": true,           // acceptable
  "allowJs": true,
  "target": "ES2017"
}
```
- ✅ `strict: true` is on.
- ❌ `noImplicitAny: false` opts OUT of one of the most valuable strict checks. Combined with `ignoreBuildErrors: true` (see 2.4), this means untyped code can ship to production without warning.

### 2.2 ESLint (`eslint.config.mjs`)
The ESLint config **disables virtually every meaningful rule**:
```js
"@typescript-eslint/no-explicit-any": "off",
"@typescript-eslint/no-unused-vars": "off",
"@typescript-eslint/no-non-null-assertion": "off",
"@typescript-eslint/ban-ts-comment": "off",
"react-hooks/exhaustive-deps": "off",      // ⚠️ potential stale closures everywhere
"react-hooks/purity": "off",
"react/no-unescaped-entities": "off",
"react/display-name": "off",
"@next/next/no-img-element": "off",
"@next/next/no-html-link-for-pages": "off",
"prefer-const": "off",
"no-unused-vars": "off",
"no-console": "off",                       // ⚠️ 715+ console.* calls
"no-debugger": "off",
"no-empty": "off",
"no-fallthrough": "off",
"no-unreachable": "off",
"no-useless-escape": "off",
```
- ❌ `bun run lint` produces **0 output lines** — every rule is disabled. Lint is a no-op.
- ❌ `no-debugger` and `no-unreachable` being off is a red flag — these catch real bugs.

### 2.3 `any` usage
- **766 occurrences** of `: any`, `<any>`, `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck` across 250+ files.
- Top offenders:
  - `src/lib/store.ts` (1541 LOC god store)
  - `src/lib/data-adapter.ts` (1342 LOC)
  - `src/lib/admin-db-manager.ts` (1500 LOC)
  - `src/app/api/chart/[ticker]/route.ts` (970 LOC) — uses `as any[]` for SQL rows
  - `src/app/api/finance/real-return/route.ts` — `as any` everywhere on row results

### 2.4 Build configuration (`next.config.ts`)
```ts
typescript: { ignoreBuildErrors: true },   // ❌ CRITICAL
reactStrictMode: false,                     // ❌ suppresses important dev warnings
```
- ❌ `ignoreBuildErrors: true` means TypeScript errors **do not block production builds**. Type errors can silently ship.
- ❌ Build script in `package.json`: `next build --no-lint` — both type-check and lint are bypassed at build time.

### 2.5 Error handling patterns
- 140+ empty `catch { /* ignore */ }` blocks across 58 files. Most are in the data-access layer where silent failures hide broken state.
- Examples:
  - `src/lib/auth-helper.ts:31` — `try { repairLastActiveAt(); } catch { /* non-fatal */ }`
  - `src/app/api/chart/[ticker]/route.ts:52` — DB open failure silently ignored → falls through to a different code path
  - `src/app/api/admin/db-manager.ts` — many `catch { /* ignore */ }` around table-introspection calls
- ✅ Good pattern: structured logger (`src/lib/logger.ts`) exists with redaction of PII; but only ~50 files actually use it — the other ~700 `console.*` calls bypass it.

### 2.6 Code organization quality
- 3 deprecated routes return HTTP 410 Gone with redirect hints (good pattern, see `/api/maestro/route.ts`).
- 1 dead code file committed: `src/app/api/deal-advisor/[ticker]/route.ts.preserved` (1012 LOC of preserved legacy code that should be removed).
- 20 TODO/FIXME comments — low count, but several indicate **unimplemented business logic**:
  - `src/app/api/google-play/verify-receipt/route.ts`: `// TODO: In production, verify with Google Play API` and `// TODO: Implement real Google Play API verification` — **payment verification is currently a no-op stub**.
  - `src/lib/egx-db.ts`: 8 TODOs for unimplemented DB methods (currency/gold/tips).
  - `src/app/api/predictions/route.ts`: stale-data filter TODO repeated.

---

## 3. Architecture Patterns

### 3.1 API route organization
- 449 Next.js Route Handlers under `src/app/api/`.
- Top-level route groups: `admin/` (83 routes), `mobile/` (12), `crypto/` (14), `stocks/` (13), `market/` (19), `predictions/` (28), `portfolio/` (16), `finance/` (16), `ai/` (3), `subscription/` (11), `auth/` (8), `v2/` (10), `radar/` (4), `maker-radar/` (15), `data-engine/` (9), `alerts/` (5), `bot/` (3), `expert-recommendations/` (3), `sharia/` (2), `unified-learning/` (6), `maestro/` (3), `v82/`, `v4/`, `paper-trading-v2/`, `instapay/`, `paymob/`, `news*` (4), `metals/`, `currency/` (3), `track/`, `push/`, `redeem-promo/`, `screener/`, `flow/`, `explosive/`, `feedback/`, `global-predictions/`, `prediction-performance/`, `news-feed/`, `live-monitor/`, `i18n/`, `cron/`, `system-control/`, `parse-recommendations/`, `proxy/`, `proxy-prod/`, `tips/`, `learning/`, `tab-data/`, `init-db/`, `keepalive/`, `health/`, `walk-forward/`, `walk-forward-test/`, `backtest/`, `backtesting/`, `crypto-backtesting/`, `crypto-predictions/`, `crypto-lab/`, `stored-analysis/`, `unified/`, `unified-stocks/`, `money/`, `seasonality-signals/`, `self-learning/`, `egx/investors/`, `egxpilot/`, `hunter/`, `deal-advisor/`, `disclosures/`, `kimi/`, `confluence/`, `sniper/`, `multi-market/`, `smart-confluence/`, `user-posts/`, `reports/`, `trading-journal/`, `zakat/`, `features/`, `data-status/`, `telegram/`, `import/`, `export/`, `app/version/`, `stock-profile/`, `fomo/`, `[...slug]/` (catch-all), etc.
- ⚠️ **Concern**: 449 routes is excessive. Many appear to be near-duplicates (e.g., `crypto/live` vs `crypto/[id]` vs `mobile/crypto` vs `mobile/crypto/[id]`; `recommendations` + `mobile/recommendations` + `expert-recommendations` + `expert-recommendations/batch` + `expert-recommendations/import` + `recommendations/expert` + `recommendations/retroactive-evaluate` + `recommendations/verify` + `recommendations/backtest`).
- ✅ Good: A `marketPulseProxy` helper has begun consolidating 37 mislabeled proxy routes into 1-line delegations (per its docstring). Pattern should be applied more widely.

### 3.2 Component composition
- 250 client components, all marked `'use client'`.
- Server components are essentially absent — the entire app is client-rendered with hash-based routing (`window.location.hash`), bypassing Next.js's RSC streaming benefits.
- Largest components (god components):
  - `src/modules/portfolio/components/EnhancedPortfolioView.tsx` — **3361 LOC**
  - `src/components/shared/UnifiedTable.tsx` — **2453 LOC**
  - `src/modules/admin/components/AdminView.tsx` — **2083 LOC**
  - `src/app/page.tsx` — **1049 LOC**
  - `src/app/api/chart/[ticker]/route.ts` — **970 LOC**
  - `src/app/api/admin/db-manager/route.ts` routes spread across 17 files (split is good)
- These files almost certainly mix data-fetching, business logic, and presentation — should be decomposed.

### 3.3 State management
- **6 Zustand stores**:
  - `src/lib/store.ts` (1541 LOC) — global app store: stocks, market overview, deep analysis, watchlists, portfolios, AI insights, recommendations, personas. This is a god store.
  - `src/lib/portfolio-store.ts`
  - `src/lib/alerts-store.ts`
  - `src/lib/notification-store.ts`
  - `src/lib/analysis-store.ts`
  - `src/lib/crypto-learning-store.ts`
- ❌ **`@tanstack/react-query` is in `package.json` but has ZERO usages** in `src/`. Server state is fetched manually with `fetch()` inside `useEffect`/`useCallback` everywhere, leading to:
  - No request deduplication
  - No automatic cache invalidation after mutations
  - No stale-while-revalidate
  - Inconsistent loading/error states per component
  - Polling logic reimplemented in `useVisibilityAwarePolling.ts` rather than using React Query's `refetchInterval`
- `src/lib/api-client.ts` is a thin fetch wrapper, but many components bypass it and call `fetch()` directly.

### 3.4 Server vs client component boundaries
- The middleware runs in the Edge runtime and explicitly **cannot** check NextAuth sessions (per its comment block).
- Auth is delegated to API routes via `requireAdminAsync` / `requireAuthAsync` / `getSessionUserId`.
- Almost all UI is `'use client'` — no use of Server Components for data fetching, no streaming.
- `getServerSession` is called inside API routes (acceptable pattern), but `getSessionUserId()` from `auth-helper.ts` runs **3 different auth methods** per request (Bearer token → admin_session cookie → NextAuth session), each making DB queries. This adds significant per-request latency.

### 3.5 HTTP client proliferation (DUPLICATE FUNCTIONALITY)
The codebase has **9 overlapping HTTP client modules** for talking to backends (Python backend, VPS, data-engine, production server):

| File | LOC | Purpose |
|---|---|---|
| `src/lib/vps-client.ts` | 657 | VPS API client with health check, cache |
| `src/lib/vps-adapter.ts` | 798 | Higher-level VPS adapter |
| `src/lib/data-adapter.ts` | 1342 | Multi-source EGX data adapter |
| `src/lib/multi-source-adapter.ts` | 1060 | Another multi-source adapter |
| `src/lib/python-backend.ts` | 160 | Direct Python backend calls |
| `src/lib/egxpy-bridge.ts` | — | EGX-Python bridge |
| `src/lib/market-pulse-proxy.ts` | 42 | Single helper for market-pulse proxy |
| `src/lib/api-client.ts` | 340 | Client-side fetch wrapper |
| `src/lib/server-url.ts` | 74 | Self-base URL + Python backend URL helpers |

- ⚠️ `PYTHON_BACKEND_URL` / `EGXPY_SERVICE_URL` / `VPS_API_URL` env vars are referenced **234 times** across 143 files, with hardcoded `http://127.0.0.1:8010` fallback strings scattered everywhere.
- ⚠️ Pattern duplication: every route does its own `try { fetch(...) } catch { ... }` block.

---

## 4. Technical Debt

### 4.1 Disabled ESLint rules (intentional)
- The entire `eslint.config.mjs` is a list of `"off"` rules (see §2.2). This is functionally equivalent to having no ESLint.

### 4.2 `ignoreBuildErrors: true`
- `next.config.ts` has `typescript.ignoreBuildErrors = true` — production builds do NOT type-check. Combined with `noImplicitAny: false`, type errors silently ship.

### 4.3 `--no-lint` on build
- `package.json` build script: `next build --no-lint` — production builds skip lint entirely.

### 4.4 Hardcoded values that should be env vars
- `src/lib/admin-identities.ts`: `DEFAULT_ADMIN_EMAILS` ships 4 hardcoded admin emails (`enmohsen20111975@gmail.com`, `enmohsen2011975@gmail.com`, `ceo@m2y.net`, `mohseny@m2y.net`) and 2 usernames (`mohseny`, `admin`) to the browser bundle via `getClientAdminEmails()` when `NEXT_PUBLIC_ADMIN_EMAILS` is unset.
- `src/app/api/finance/real-return/route.ts`: `DEFAULT_BANK_YIELD = 20` and `DEFAULT_INFLATION = 30` — business-critical financial defaults hardcoded.
- `src/app/api/proxy-prod/[...path]/route.ts`: `PRODUCTION_URL = 'https://invist.m2y.net'` — production URL hardcoded fallback.
- `src/app/api/paymob/create-payment/route.ts`: 8 hardcoded price defaults (e.g., `9900` for 99 EGP premium monthly) that should be in admin-editable pricing config.
- `src/app/api/auth/[...nextauth]/route.ts`: `console.log('[Auth Debug] ...')` statements print credentials/identifiers in production logs (lines 65, 67, 113).

### 4.5 Dead code / preserved files
- `src/app/api/deal-advisor/[ticker]/route.ts.preserved` — 1012 LOC of preserved legacy code in the repo (git history would suffice).
- 3 deprecated routes (`/api/maestro`, `/api/predictions/tracking/list`, `/api/stocks/[ticker]/professional-analysis`) return 410 — pattern is correct but the routes should be scheduled for deletion per Rule 4 (NO-DELETION) which the codebase claims to follow.
- `BACKLOG.md` exists at repo root indicating known tech debt is tracked.
- `download/` directory at root contains 7 markdown files (`PRODUCTION_ML_COMMANDS.md`, `LAPTOP_ML_COMMANDS.md`, `SERVER_FIX_COMMANDS.sh`, `DATA_AUDIT_REPORT.md`, etc.) — operational artifacts that don't belong in source repo.
- `comprehensive_production_fix.py`, `fix_cron_paths.sh`, `fix_production_db.sql`, `check_v402_predictions.sh`, `deep_server_audit.sh`, `radar_server_commands.sh`, `run-server.sh`, `test_stats.js` — all root-level shell/SQL/Python scripts that should be in `scripts/`.

### 4.6 Inconsistent error handling
- `console.error('[APIName] Error:', error)` pattern used in 250+ files instead of structured logger.
- Many error responses return generic Arabic strings (`'حدث خطأ'`) without error codes, making client-side error handling guesswork.

### 4.7 Multiple generations of "the new DB layer"
See §1.2 — `db.ts`, `new-db.ts`, `new-db-queries.ts`, `unified-db.ts`, `shared-db.ts`, `db/index.ts`, `db-auth.ts`, `db-predictions.ts` all coexist. Need consolidation.

---

## 5. Security

### 5.1 Authentication architecture
- **3 admin auth methods** in `requireAdminAsync` (`src/lib/admin-auth-server.ts`):
  1. `X-Admin-Token` header or `admin_session` cookie (base64 `username:password`)
  2. `getSessionUserId()` (Bearer token or web session)
  3. NextAuth session with `isAdmin(email)` check OR `subscription_tier === 'admin'` in DB
- Plus optional `ALLOW_ADMIN_BYPASS=true` env (default OFF — good).
- ✅ Localhost bypass was REMOVED (BOOTCAMP-3 2026-10-01, per code comment).
- ✅ Hardcoded MOHSENY_HASH bcrypt backdoor was REMOVED (FIX-P1-SECURITY CRIT-6).
- ✅ Admin login form is gated by `ALLOW_FORM_LOGIN=true` (default off).
- ⚠️ `verifyAdminToken` uses base64-encoded `username:password` as a long-lived bearer token — not a JWT, no expiry, no rotation. Anyone who logs this token (e.g., via the 715 `console.log` calls) can replay it indefinitely.

### 5.2 Route-level auth coverage
- Total API routes: **449**
- Routes calling at least one auth helper (`requireAdminAsync`, `requireAuthAsync`, `verifyAdminRequest`, `requireAdminRequest`, `getSessionUserId`, `getServerSession`): **177 (39%)**
- Routes with NO auth guard at all: **272 (61%)**
- Admin routes (`/api/admin/*`): 83 total, 78 guarded, **5 unguarded**:
  - `src/app/api/admin/ai-analyze/route.ts` — thin proxy to `/api/market-pulse` (acceptable, but should still verify admin)
  - `src/app/api/admin/ab-test/route.ts` — same
  - `src/app/api/admin/auth/route.ts` — login endpoint (correctly unguarded)
  - `src/app/api/admin/auth/token/route.ts` — token-issue endpoint (correctly unguarded)
  - `src/app/api/admin/auth/auto-cookie/route.ts` — auto-cookie (should verify)

### 5.3 ❌ CRITICAL: IDOR in `/api/user-posts` POST
**File**: `src/app/api/user-posts/route.ts` lines 81-160
- POST handler accepts `user_id` directly from the request body and trusts it:
  ```ts
  const { user_id, ticker, direction, ... } = body;
  // ...
  const user = await db.user.findUnique({ where: { id: user_id } });
  // ...
  await db.userPost.create({ data: { user_id, ... } });
  ```
- **Impact**: Any authenticated user can publish posts, award themselves points, or inflate their stats by passing ANY `user_id` they know (user IDs are CUIDs but are exposed in API responses elsewhere).
- No `getSessionUserId()` call before writing.
- Award-points helper (`awardPoints`) also uses the attacker-supplied `user_id`.

### 5.4 SQL injection risks
- ✅ `src/app/api/tab-data/route.ts` was fixed (P0-12-SQLI): now uses a `ALLOWED_TABS` whitelist of 8 hardcoded literals before interpolating `${tableName}` into the query.
- ✅ `src/lib/admin-db-manager.ts` validates table names via `validateTableName()` (regex `^[A-Za-z_][A-Za-z0-9_]*$`) and `resolveDbPath()` (basename check, no `..`).
- ⚠️ `src/lib/admin-db-manager.ts` still interpolates table/column names into queries:
  ```ts
  safeQueryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM "${t.name}"`);
  let sql = `SELECT * FROM "${table}"`;
  db.exec(`DELETE FROM "${table}"`);
  ```
  These are safe ONLY because the table name was previously validated — but the pattern is fragile (any new code path that skips validation = SQLi).
- ⚠️ `src/app/api/admin/db-manager/query/route.ts` exposes a **raw SQL execution endpoint** to admins. While it's behind `requireAdminAsync`, this is the highest-risk endpoint in the app — an admin compromise or CSRF/XSS in the admin UI = arbitrary SQL execution including `DROP DATABASE`. No statement-type whitelist (DDL/DML unrestricted).
- ⚠️ 70+ raw `db.prepare(...)` calls across `src/` use template strings (with `?` placeholders for user input in most cases).

### 5.5 XSS risks
- 2 `dangerouslySetInnerHTML` uses:
  - `src/components/ui/chart.tsx` — injects CSS theme variables (safe: built from internal `THEMES` constant).
  - `src/lib/structured-data.tsx` — injects `JSON.stringify(schema)` for JSON-LD `<script>` tags (safe: JSON.stringify escapes `<`, `>`, `&`).
- ✅ No user-content HTML rendering detected (markdown rendering via `react-markdown` is safe by default).

### 5.6 Secret management
- ✅ Admin passwords removed from source (SEC-01 fix).
- ✅ `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_SESSION_TOKEN` come from env vars (fail closed in production if missing).
- ✅ Paymob API key, HMAC, integration IDs come from env vars.
- ❌ `DEFAULT_ADMIN_EMAILS` in `src/lib/admin-identities.ts` ships 4 emails + 2 usernames to the browser bundle when `NEXT_PUBLIC_ADMIN_EMAILS` is unset. Comment claims "no regression" (the same emails were hardcoded before) but it leaks the admin roster to anyone who views source.
- ❌ `console.log('[Auth Debug] ...')` in `src/app/api/auth/[...nextauth]/route.ts` prints identifiers and partial credentials to logs (lines 65, 67, 113).

### 5.7 RCE risks
- `src/app/api/admin/pm2-control/route.ts` executes `pm2` shell commands. Has admin guard and uses `execFile` with argv split (safer than `exec` with shell interpolation). Action whitelist: `['start', 'stop', 'restart', 'status', 'start-all', 'stop-all', 'restart-all', 'save']`. Process name is passed through but only matched against `validActions` set (not against actual pm2 process names) — a sophisticated attacker who compromised admin auth could call `start` with an arbitrary `process_name` that PM2 might interpret, but the risk is contained by the admin auth gate.
- `src/app/api/admin/db-manager/query/route.ts` allows arbitrary SQL execution.

### 5.8 Path traversal
- ✅ `resolveDbPath()` in `src/lib/admin-db-manager.ts` uses `path.basename()` + endsWith `.db` check.
- ✅ `resolveBackupPath()` rejects paths containing `/`, `\`, or `..`.
- ✅ `/api/proxy-prod/[...path]/route.ts` uses an `ALLOWED_PATH_PREFIXES` whitelist and explicitly blocks `admin/` paths.

### 5.9 CORS
- `/api/proxy-prod/[...path]/route.ts` reflects Origin only when it matches the request Host (same-origin policy) — good.
- No global CORS configuration visible.

### 5.10 Rate limiting
- Only one in-memory rate limiter found: `/api/proxy-prod` (30 req/min per IP).
- `src/lib/rate-limiter.ts` exists but unclear how widely used.
- ⚠️ In-memory rate limiters do NOT survive process restarts and do NOT work across multiple workers/PM2 instances.

---

## 6. Performance

### 6.1 ❌ N+1 query in `/api/points/leaderboard`
**File**: `src/app/api/points/leaderboard/route.ts` lines 37-50
```ts
const usersWithAccuracy = await Promise.all(
  leaderboard.map(async (up) => {
    const wins = await db.userPost.count({ where: { user_id: up.user_id, outcome: 'win' } });
    const losses = await db.userPost.count({ where: { user_id: up.user_id, outcome: 'loss' } });
    ...
  })
);
```
- For a 50-user leaderboard, this fires **100 extra DB queries** (2 per user). Classic N+1.
- Fix: single `groupBy({ by: ['user_id', 'outcome'], where: { user_id: { in: userIds } } })` aggregate.

### 6.2 Unbounded queries
- 70+ `.all()` calls across API routes — many without `LIMIT`:
  - `src/app/api/sharia/route.ts:223` — `.all()` returns entire table.
  - `src/app/api/market/sectors/intelligence/route.ts:124` — `.all()`.
  - `src/app/api/recommendations/retroactive-evaluate/route.ts:47` — `.all() as any[]`.
- `findMany({})` patterns: most are now bounded by `take: limit`, but `src/app/api/trading-journal/stats/route.ts:37` calls `(db as any).tradingJournal.findMany({ where: { user_id: userId } })` with no `take` — could be large for power users.
- 26 `take:` patterns found across the API — only ~8 routes actually paginate. The other ~440 routes either have implicit small result sets or are unbounded.

### 6.3 Missing memoization
- Only **7 files** use `React.memo()` / `memo()` (25 total occurrences).
- 250 client components — most re-render on every parent re-render.
- 22 `eslint-disable-next-line react-hooks/exhaustive-deps` — these are deliberate stale-closure suppressions, but with `react-hooks/exhaustive-deps` rule fully disabled, the other 99% of effect dependency arrays are unchecked.

### 6.4 Large client bundle contributors
- `src/modules/portfolio/components/EnhancedPortfolioView.tsx` — 3361 LOC
- `src/components/shared/UnifiedTable.tsx` — 2453 LOC
- `src/modules/admin/components/AdminView.tsx` — 2083 LOC
- Heavy dependencies bundled:
  - `recharts` (used in 23 files — main charting lib)
  - `lightweight-charts` (used in 2 files only — could be lazy-loaded)
  - `framer-motion` (used in 13 files)
  - `html2canvas` (used in 22 files — heavy, ~200KB)
  - `@mdxeditor/editor` (UNUSED but installed — ~1MB)
  - `@xyflow/react` (UNUSED but installed — ~500KB)
  - `katex` + `react-katex` (used in 1 file — could be code-split)
  - `@tanstack/react-table` + `@tanstack/react-query` (UNUSED but installed)
- ✅ `next.config.ts` has `experimental.optimizePackageImports: true`.
- ✅ `src/components/shared/LazyTabLoader.tsx` exists — suggests lazy-loading pattern is used for some tabs.

### 6.5 Polling strategy
- `src/hooks/useVisibilityAwarePolling.ts` provides a visibility-aware polling hook (pauses when tab hidden). Good pattern.
- Many components still appear to set up their own `setInterval` polling without using this hook.
- `src/components/Providers.tsx` sets up a 60-second keepalive ping in production.

### 6.6 Cache strategy
- Multiple in-memory caches scattered across data-access files:
  - `src/lib/vps-client.ts` — `_vpsCache` Map (30s TTL)
  - `src/lib/data-adapter.ts` — `stockCache` + `historicalCache` Maps (5min TTL)
  - `src/lib/multi-source-adapter.ts` — likely its own cache
- No unified cache invalidation strategy.
- No `Cache-Control` headers on API responses (except middleware sets `no-store` for HTML pages).
- `src/modules/radar/lib/radar-cache.ts` exists for radar data.

---

## 7. Dependencies

### 7.1 Outdated / pinned-old versions
- `next: 14.2.28` — Next.js 15.x is current; 14.2 is still maintained but missing newer features (Turbopack stable, Partial Prerendering, improved RSC).
- `next-auth: ^4.24.11` — Auth.js v5 (next-auth v5) is the current major; v4 is in maintenance.
- `react: ^18.2.0` — React 19 is current.
- `prisma: 5.22.0` — Prisma 6.x is current.
- `eslint: ^9.0.0` + `eslint-config-next: 15.3.3` — version mismatch (eslint 9 vs next 15.3 config; next 14.2 is the actual runtime).

### 7.2 ❌ UNUSED dependencies (17 found, all should be removed)
| Package | Reason |
|---|---|
| `@tanstack/react-query` | 0 usages in `src/` — entire server-state layer is hand-rolled |
| `@tanstack/react-table` | 0 usages |
| `@xyflow/react` | 0 usages |
| `react-syntax-highlighter` | 0 usages |
| `@mdxeditor/editor` | 0 usages |
| `input-otp` | 0 usages |
| `embla-carousel-react` | 0 usages |
| `cmdk` | 0 usages |
| `vaul` | 0 usages |
| `react-resizable-panels` | 0 usages |
| `react-day-picker` | 0 usages |
| `@radix-ui/react-aspect-ratio` | 0 usages |
| `@radix-ui/react-menubar` | 0 usages |
| `@radix-ui/react-context-menu` | 0 usages |
| `@radix-ui/react-hover-card` | 0 usages |
| `@radix-ui/react-navigation-menu` | 0 usages |
| `uuid` | 0 usages (crypto.randomUUID used instead) |
| `next-intl` | 0 usages (cookie-based i18n per next.config.ts comment) |
| `@reactuses/core` | 0 usages |
| `@swc/helpers` | 0 explicit usages (auto-injected by Next.js; should not be in deps) |
| `date-fns` | 0 usages |
| `@sentry/nextjs` | 0 usages in `src/` (only `next.config.ts` wrapper) |
| `html-to-image` | 0 usages (html2canvas used instead) |
| `html2pdf.js` | 0 usages (postinstall patch script runs but unused) |
| `jspdf` | 0 usages |

### 7.3 Duplicate functionality
- **Charting**: `recharts` (23 files) + `lightweight-charts` (2 files) — 2 different charting libraries. lightweight-charts is used in only `TradingViewChart.tsx` and `InteractiveChart.tsx`. Should be lazy-loaded, not removed.
- **Image export**: `html2canvas` (22 files) + `html-to-image` (unused) + `html2pdf.js` (unused) + `jspdf` (unused) — only html2canvas is actually used. The postinstall `patch-html2canvas.js` script and `@types/html2pdf.js` dev dep are also dead weight.
- **HTTP clients**: 9 overlapping modules (see §3.5).
- **State management**: `zustand` (6 stores) + `@tanstack/react-query` (declared, unused).
- **Form handling**: `react-hook-form` + `@hookform/resolvers` + `zod` — used in only 2 files (`AuthView.tsx`, `ui/form.tsx`). Heavyweight for current usage.

### 7.4 Dev dependency concerns
- `playwright: ^1.60.0` — installed as devDep but no `playwright.config.ts` found and no e2e tests in `src/__tests__/` (only vitest unit tests). Either unused or used for ad-hoc screenshot scripts.
- `pm2: ^7.0.1` — installed as devDep but also referenced as a runtime binary in `src/app/api/admin/pm2-control/route.ts` (`LOCAL_PM2 = path.join(CWD, 'node_modules', 'pm2', 'bin', 'pm2')`). Should be a runtime dependency.
- `node-gyp: ^13.0.1` — should not be a direct dep (it's auto-installed by `better-sqlite3`).
- `@types/recharts: ^1.8.29` — recharts v2 is installed, but v1 types are pinned. Type definitions are wrong.

### 7.5 Optional dependencies
- `sharp: ^0.34.3` — listed as optionalDependency. Next.js image optimization uses sharp when available; correct placement.

---

## Critical Issues

### C1. IDOR in `/api/user-posts` POST
- **File**: `src/app/api/user-posts/route.ts:81-160`
- **Impact**: Any authenticated user can publish posts, award points, and modify other users' data by passing their `user_id` in the request body. No `getSessionUserId()` call before writing.
- **Fix**: Replace `body.user_id` with the authenticated userId from `getSessionUserId()`.

### C2. `ignoreBuildErrors: true` + disabled ESLint
- **File**: `next.config.ts`, `eslint.config.mjs`, `package.json` build script
- **Impact**: TypeScript errors silently ship to production. ESLint produces 0 output. `noImplicitAny: false` further weakens type-checking.
- **Fix**: Remove `ignoreBuildErrors: true`, re-enable critical ESLint rules (`no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `no-unreachable`, `no-debugger`), remove `--no-lint` from build script, and fix the resulting errors incrementally.

### C3. Raw SQL execution endpoint
- **File**: `src/app/api/admin/db-manager/query/route.ts`
- **Impact**: Admins can execute arbitrary SQL (DDL+DML) against any SQLite DB. An admin compromise = full data destruction. No statement-type whitelist.
- **Fix**: Restrict to SELECT only; require a separate elevated permission for DDL/DML; add audit logging of every executed statement.

### C4. Hardcoded admin email list shipped to browser
- **File**: `src/lib/admin-identities.ts` (DEFAULT_ADMIN_EMAILS)
- **Impact**: Anyone viewing page source knows the admin email roster — useful for targeted phishing or credential stuffing.
- **Fix**: Remove `DEFAULT_ADMIN_EMAILS` fallback; require `NEXT_PUBLIC_ADMIN_EMAILS` to be set explicitly (fail closed for client-side admin UI gating — server-side enforcement is the real security boundary).

### C5. ~17 unused production dependencies
- **Impact**: Inflated bundle size (~3-5MB of dead code shipped to browser for packages like `@mdxeditor/editor`, `@xyflow/react`, `@tanstack/react-query`, `@tanstack/react-table`), slower installs, larger attack surface for supply-chain attacks.
- **Fix**: Remove the 17 unused deps listed in §7.2.

---

## High Priority

### H1. N+1 query in `/api/points/leaderboard`
- 100+ DB queries for a 50-user leaderboard.
- Fix: single `groupBy` aggregate.

### H2. 5 admin routes without `requireAdminAsync`
- `admin/ai-analyze`, `admin/ab-test`, `admin/auth/auto-cookie` — should at minimum verify admin status.
- (The 2 `/admin/auth/*` routes that issue tokens are correctly unguarded.)

### H3. `X-Admin-Token` is base64 `username:password` — no expiry, no rotation
- **File**: `src/lib/admin-auth-server.ts` `verifyAdminToken`
- Token = `Buffer.from('user:pass').toString('base64')` — equivalent to basic auth. Anyone who captures it (via the 715 `console.log` calls) can replay indefinitely.
- Fix: Use JWT with short expiry + refresh token, or use the existing `admin_session` cookie with HMAC-signed session ID.

### H4. `console.log('[Auth Debug] ...')` in NextAuth route
- **File**: `src/app/api/auth/[...nextauth]/route.ts` lines 65, 67, 113
- Logs include identifier, password length, and match results — visible to anyone with log access.
- Fix: Replace with structured `logger.debug()` calls (which already redact PII) — `logger` is imported in `auth-helper.ts` but NOT in this file.

### H5. God store: `src/lib/store.ts` (1541 LOC)
- Single Zustand store manages stocks, market overview, deep analysis, watchlists, portfolios, AI insights, recommendations, personas — every domain.
- Fix: Split into domain-specific stores (already partially done with `portfolio-store.ts`, `alerts-store.ts`, etc.). Migrate remaining domains.

### H6. 9 overlapping HTTP client modules (~5200 LOC)
- See §3.5.
- Fix: Consolidate into a single `BackendClient` with clear method signatures per resource. Eliminate the 234 scattered `http://127.0.0.1:8010` fallback strings.

### H7. 449 API routes — many near-duplicates
- Multiple parallel hierarchies (`mobile/*` vs root `*`, `v2/*` vs root `*`, `crypto/*` vs `mobile/crypto/*`, `recommendations/*` vs `expert-recommendations/*`).
- Fix: Audit and consolidate; many can be `marketPulseProxy`-style 1-liners.

### H8. `react-hooks/exhaustive-deps` disabled
- Effect dependency arrays are not checked. Stale closures are likely causing subtle bugs (especially in 250+ polling components).
- Fix: Re-enable the rule and fix the violations (currently 22 explicit disables would become errors).

### H9. Production console.log calls (715+)
- 715 `console.log`/`console.error`/`console.warn` calls across 250 files bypass the structured `logger.ts`.
- Fix: Codemod to replace `console.*` with `logger.*` calls; enable `no-console` ESLint rule (error level for non-test files).

---

## Medium Priority

### M1. 140+ empty `catch {}` blocks
- Silent error swallowing across data-access layer.
- Fix: At minimum log via `logger.warn()`; or re-throw where the caller can meaningfully handle.

### M2. Server components not used for data fetching
- All 250 components are `'use client'`. Hash-based routing bypasses Next.js RSC streaming.
- Fix: Migrate static page shells to Server Components; keep only interactive bits as client islands. (Large effort — sequence by feature.)

### M3. `@tanstack/react-query` declared but unused
- Either remove the dependency or migrate server-state fetching to use it (would solve cache invalidation, deduplication, and polling consistency issues).

### M4. Multiple "new DB layer" generations co-existing
- `db.ts`, `new-db.ts`, `new-db-queries.ts`, `unified-db.ts`, `shared-db.ts`, `db/index.ts`, `db-auth.ts`, `db-predictions.ts` — naming suggests iterative refactors without removing the old versions.
- Fix: Pick one canonical module per database, mark others deprecated, delete after migration.

### M5. In-memory rate limiter in `/api/proxy-prod`
- Doesn't survive restarts, doesn't work across PM2 cluster workers.
- Fix: Move to Redis-backed rate limiter, or use a proper middleware (e.g. `@upstash/ratelimit`).

### M6. `route.ts.preserved` dead code (1012 LOC)
- `src/app/api/deal-advisor/[ticker]/route.ts.preserved` — should be deleted; git history is the preservation mechanism.

### M7. Root-level operational scripts in source repo
- `comprehensive_production_fix.py`, `fix_cron_paths.sh`, `fix_production_db.sql`, `check_v402_predictions.sh`, `deep_server_audit.sh`, `radar_server_commands.sh`, `run-server.sh`, `test_stats.js` at repo root.
- Fix: Move to `scripts/ops/` or `scripts/fix/`.

### M8. Hardcoded financial defaults in `/api/finance/real-return`
- `DEFAULT_BANK_YIELD = 20` and `DEFAULT_INFLATION = 30` are business-critical.
- Fix: Move to `engine_settings` table (already used by Python backend for similar values).

### M9. Paymob price defaults hardcoded
- 8 plan prices hardcoded in `/api/paymob/create-payment/route.ts` lines 27-44.
- Fix: Move to `market_pricing` DB table (table already exists per Prisma schema).

### M10. `@types/recharts: ^1.8.29` mismatched with `recharts: ^2.15.4`
- Wrong types version.
- Fix: Remove `@types/recharts` (recharts v2 ships its own types).

---

## Low Priority

### L1. 20 TODO/FIXME comments — several indicate unimplemented features
- `google-play/verify-receipt`: payment verification is a stub.
- `lib/egx-db.ts`: 8 unimplemented DB methods.
- Should be triaged into either BACKLOG.md or implemented.

### L2. 3 deprecated routes return 410 — good pattern
- Should be scheduled for actual deletion (with a deprecation period in CHANGELOG).

### L3. Inconsistent error responses
- Mix of Arabic-only error strings, English error codes, and HTTP status codes.
- Fix: Establish an error-response convention (e.g., `{ success: false, error: 'CODE', error_ar: '...' }`) and codemod existing routes.

### L4. `next.config.ts` has `reactStrictMode: false`
- React Strict Mode helps catch bugs in development. Should be enabled (or at least enabled in dev).
- Note: enabling may surface existing bugs that were suppressed.

### L5. `bun run lint` script returns 0 output
- Either lint isn't actually running, or all rules are disabled (verified: §2.2 the latter).
- Fix: see C2.

### L6. Missing `runtime = 'nodejs'` marker on 364 of 449 routes
- Routes that use Prisma or `better-sqlite3` should explicitly set `export const runtime = 'nodejs'`. Many do (85 have it), but 364 don't — most work by default but explicit is safer.

### L7. `BACKLOG.md` exists — should be reviewed for items already addressed
- The worklog shows many completed refactor waves (P0, P1, P2, Phase 1-4, etc.). BACKLOG.md may have stale items.

### L8. Test coverage unclear
- 13 test files in `src/__tests__/` covering radar, security, regime, predictions, db integrity. No coverage report config in `vitest.config.ts`. No CI configuration visible.
- Fix: Add coverage thresholds; add CI workflow file (`.github/workflows/`).

### L9. `examples/websocket/` directory
- `examples/websocket/server.ts` + `frontend.tsx` — example code in source repo.
- Fix: Move to `docs/examples/` or remove (git history suffices).

### L10. Mix of Arabic and English in code comments
- Comments switch between Arabic and English mid-file. Not a bug, but hurts readability for non-Arabic-reading contributors.
- Fix: Establish a convention (English for code-level comments; Arabic OK for user-facing strings).

---

## Recommendations

### Immediate (P0 — this week)
1. **Fix IDOR in `/api/user-posts` POST** — replace body `user_id` with `getSessionUserId()` result. (1 LOC change + test.)
2. **Remove `ignoreBuildErrors: true`** from `next.config.ts` and fix the resulting type errors. Start with `noImplicitAny: true` to surface implicit `any`s.
3. **Remove the 17 unused dependencies** from `package.json`. Verify with `bun install` + build + smoke test.
4. **Remove `console.log('[Auth Debug] ...')` calls** in `src/app/api/auth/[...nextauth]/route.ts` — replace with structured `logger.debug()` calls that already redact PII.
5. **Add statement-type whitelist to `/api/admin/db-manager/query`** — at minimum restrict to `SELECT` for non-super-admin contexts; add audit logging of every executed statement.

### Short-term (P1 — next 2-4 weeks)
6. **Re-enable critical ESLint rules** incrementally: `no-unreachable`, `no-debugger`, `no-unused-vars`, `react-hooks/exhaustive-deps`. Fix violations in waves.
7. **Fix N+1 in leaderboard** — single `groupBy` aggregate.
8. **Consolidate HTTP client modules** — pick one canonical client per backend (Python/VPS/data-engine/prod-proxy) and migrate all routes to use it.
9. **Split the Zustand god store** (`src/lib/store.ts`, 1541 LOC) into domain stores.
10. **Audit the 272 unguarded API routes** — for each, decide: public (move to public-prefixes list), user-scoped (add `requireAuthAsync`), or admin (add `requireAdminAsync`).
11. **Replace `X-Admin-Token` base64 scheme** with a JWT (short expiry + refresh) or HMAC-signed session ID.
12. **Add `requireAdminAsync` to the 3 unguarded admin routes** (`ai-analyze`, `ab-test`, `auth/auto-cookie`).

### Medium-term (P2 — next 1-2 months)
13. **Migrate server-state fetching to React Query** — eliminate manual polling logic in 250+ components; get request deduplication, cache invalidation, and stale-while-revalidate for free.
14. **Decompose god components** — start with `EnhancedPortfolioView.tsx` (3361 LOC), `UnifiedTable.tsx` (2453 LOC), `AdminView.tsx` (2083 LOC). Target <500 LOC per component.
15. **Consolidate DB layers** — pick one module per DB (`db.ts`, `db-auth.ts`, `db-predictions.ts`, `data-engine-db.ts`, etc.) and delete the duplicates (`new-db.ts`, `new-db-queries.ts`, `unified-db.ts`, `shared-db.ts`).
16. **Adopt Server Components** for static page shells — start with admin pages and reports, which are mostly read-only.
17. **Replace `console.*` with `logger.*`** via codemod — 715 calls across 250 files. Then enable `no-console` ESLint rule.
18. **Move hardcoded financial/paymob defaults** into `engine_settings` / `market_pricing` DB tables.
19. **Move root-level scripts** (`comprehensive_production_fix.py`, etc.) into `scripts/ops/`.
20. **Delete `route.ts.preserved`** and similar dead-code files.

### Long-term (P3 — next quarter)
21. **Upgrade Next.js 14 → 15**, React 18 → 19, Prisma 5 → 6, next-auth 4 → 5 (Auth.js). Sequence carefully with feature flags.
22. **Reduce API route count from 449** by consolidating duplicate hierarchies. Target <200 routes.
23. **Add Redis** for rate limiting, session storage, and cross-process cache.
24. **Establish a CI workflow** with type-check, lint, test, and build gates. No PR merges without green CI.
25. **Add test coverage thresholds** and integration tests for the highest-risk routes (admin DB manager, payments, auth).

---

## Appendix A: File Counts
- API routes: 449
- Client components: 250
- Module files: 182
- Lib files: 108
- Test files: 13
- Total `src/` LOC: ~297,875

## Appendix B: Auth Coverage Breakdown
- Total API routes: 449
- Routes with explicit auth guard: 177 (39%)
- Routes without any auth guard: 272 (61%)
- Admin routes (`/api/admin/*`): 83
- Admin routes guarded: 78 (94%)
- Admin routes unguarded: 5 (3 are auth/token endpoints, 2 are thin proxies)

## Appendix C: ESLint Rule Status
- Total rules in `eslint.config.mjs`: 23
- Rules set to `"off"`: 23 (100%)
- `bun run lint` output: 0 lines (effectively no-op)

## Appendix D: Top Offenders by File Size
| File | LOC |
|---|---|
| `src/modules/portfolio/components/EnhancedPortfolioView.tsx` | 3361 |
| `src/components/shared/UnifiedTable.tsx` | 2453 |
| `src/modules/admin/components/AdminView.tsx` | 2083 |
| `src/lib/admin-db-manager.ts` | 1500 |
| `src/lib/store.ts` | 1541 |
| `src/app/page.tsx` | 1049 |
| `src/lib/data-adapter.ts` | 1342 |
| `src/lib/multi-source-adapter.ts` | 1060 |
| `src/app/api/deal-advisor/[ticker]/route.ts.preserved` (dead) | 1012 |
| `src/app/api/chart/[ticker]/route.ts` | 970 |
| `src/lib/market-data-access.ts` | 763 |
| `src/lib/vps-adapter.ts` | 798 |
| `src/lib/vps-client.ts` | 657 |
| `src/types/index.ts` | 598 |

## Appendix E: Methodology
- Read `worklog.md` (last ~400 lines) for project context
- Read `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `src/middleware.ts`
- Ran `bun run lint` (0 output)
- Used ripgrep/Grep for: `TODO|FIXME|HACK`, `: any|as any|@ts-ignore`, `dangerouslySetInnerHTML`, raw SQL template strings, `console.*`, `useEffect/useState/useMemo/useCallback`, `useQuery/useMutation`, Zustand `create(`, `requireAdminAsync`, `process.env.*`, `eslint-disable`, `import from` for each dependency
- Read sample files: `auth-helper.ts`, `admin-auth-server.ts`, `admin-identities.ts`, `admin-guard.ts`, `admin-db-manager.ts`, `market-pulse-proxy.ts`, `server-url.ts`, `api-client.ts`, `vps-client.ts`, `data-adapter.ts`, `store.ts`, `tab-data/route.ts`, `points/leaderboard/route.ts`, `user-posts/route.ts`, `admin/db-manager/query/route.ts`, `admin/pm2-control/route.ts`, `proxy-prod/[...path]/route.ts`, `deal-advisor/[ticker]/route.ts`, `maestro/route.ts`, `[...nextauth]/route.ts`, `finance/real-return/route.ts`, `Providers.tsx`
- **No code was modified.** All findings are observational.

---

**End of report.**
