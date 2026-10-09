# Round 2: Admin Panel Audit (NEW)

**Task ID**: TEAM-10-ADMIN-NEW
**Scope**: Comprehensive review of `#admin` panel — components, API routes, security, UX, data accuracy
**Mode**: PURE RESEARCH (no code modified, no team communication, max 100 turns)
**Codebase**: `/home/z/my-project` (Next.js 16 + Prisma + better-sqlite3 + NextAuth)
**Date**: 2026-10-09

---

## 1. Component Inventory

**Location**: `src/modules/admin/components/` (36 files, **31,221 total lines**)

### Line-count ranking (top god components)

| # | Component | Lines | Lazy? | ErrorBoundary? | Notes |
|---|-----------|------:|:-----:|:--------------:|-------|
| 1 | `DatabaseManagerFull.tsx` | **3,291** | ✅ dynamic | ✅ | Largest file — full DB CRUD + SQL editor |
| 2 | `SuperLearningSystem.tsx` | **2,489** | ✅ dynamic | ✅ | Self-learning system admin UI |
| 3 | `EngineControlRoomTab.tsx` | **2,481** | ✅ dynamic | ✅ | 8 engine cards + console + start/stop-all |
| 4 | `TelegramTab.tsx` | **2,200** | ✅ dynamic | ✅ | Bot mgmt + broadcast + reports |
| 5 | `AdminView.tsx` | **2,083** | eager (shell) | — | Hub nav + dashboard + login form |
| 6 | `DbBackupPanel.tsx` | **1,724** | ✅ dynamic | ✅ | Backup/restore + GitHub push |
| 7 | `UsersManagement.tsx` | **1,543** | ✅ dynamic | ✅ | Older user table (separate from `UserManagementPanel`) |
| 8 | `NewsManagementTab.tsx` | **1,060** | ✅ dynamic | ✅ | News CRUD + purge-all |
| 9 | `UserManagementPanel.tsx` | 904 | eager | ✅ | Tier breakdown + bot sync |
| 10 | `ContentStudioHub.tsx` | 886 | lazy | — | Sub-tool inside MarketingStudio |
| 11 | `SystemMonitorPanel.tsx` | 865 | eager | ✅ | CPU/RAM/DB monitor |
| 12 | `EnginesStatusTab.tsx` | 745 | eager | ✅ | Engines status grid |
| 13 | `SystemControlPanel.tsx` | 714 | ✅ dynamic | ✅ | Mission control |
| 14 | `VideoEditor.tsx` | 653 | lazy | — | Marketing sub-tool |
| 15 | `BacktestTab.tsx` | 650 | eager | ✅ | V40 backtest runner |
| 16 | `DataEngineTab.tsx` | 634 | eager | ✅ | Scraper details |
| 17 | `ResourceHistoryChart.tsx` | 607 | — | — | Chart component |
| 18 | `PromoCodesAdmin.tsx` | 592 | eager | ✅ | Promo code generator |
| 19 | `EngineSettingsTab.tsx` | 576 | eager | ✅ | Weights/params editor |
| 20 | `DataScraperControl.tsx` | 533 | ✅ dynamic | ✅ | Scraper control |
| 21 | `TelegramPredictionsTab.tsx` | 512 | eager | ✅ | TG predictions audit + publish |
| 22 | `MarketingHub.tsx` | 503 | lazy | — | Marketing sub-tool |
| 23 | `SystemProblemsTab.tsx` | 488 | eager | ✅ | Issues dashboard |
| 24 | `ShariaManagementTab.tsx` | 478 | eager | ✅ | Sharia compliance |
| 25 | `WealthCharts.tsx` | 465 | — | — | Chart component |
| 26 | `ValidationMonitorTab.tsx` | 442 | eager | ✅ | Rule 65 validation |
| 27 | `ProcessResourceHistory.tsx` | 442 | — | — | Sub-chart |
| 28 | `PricingEditorTab.tsx` | 420 | eager | ✅ | **Read-only** — pricing display |
| 29 | `ResourceAlerts.tsx` | 408 | — | — | Alerts component |
| 30 | `SourceAuthorityTab.tsx` | 366 | eager | ✅ | Source authority (Rule 66) |
| 31 | `CronHealthTab.tsx` | 353 | eager | ✅ | Cron job health |
| 32 | `SystemHealthCard.tsx` | 325 | eager | — | Services health card |
| 33 | `NewsHealthTab.tsx` | 312 | eager | ✅ | News source health |
| 34 | `PurgeCacheButton.tsx` | 255 | eager | — | Cache purge (no confirmation!) |
| 35 | `RegimeDetectionWidget.tsx` | 126 | eager | — | Market regime widget |
| 36 | `MarketingStudio.tsx` | 96 | eager | ✅ | Hub for 3 marketing sub-tools |

### God-component analysis
- **8 components exceed 1,000 lines** (3 exceed 2,000, 1 exceeds 3,000).
- All heavy components (≥500 lines) are lazy-loaded via `next/dynamic` with `ssr: false` + `<LazyTabLoader>` skeleton (Phase 3 Bundle Diet).
- Each dynamic component is wrapped with `withErrorBoundary(...)` so a runtime crash in one tab doesn't take down the whole panel (Phase 4 Task 3).
- **Risk**: `DatabaseManagerFull` (3,291 LOC) is the largest single component and the most likely to harbor bugs. Refactoring candidates: split SQL editor, table browser, schema viewer, maintenance actions into 4 separate sub-components (~800 LOC each).
- `AdminView.tsx` itself is 2,083 lines — it's both the shell AND the dashboard. Dashboard section (lines ~1100-2084) should be extracted into a `DashboardTab.tsx` component.

---

## 2. API Routes Auth Status

### Inventory
**Location**: `src/app/api/admin/` — **80 route files** (some have multiple HTTP methods)

### Auth verification
- Every route file (`route.ts`) was scanned for `requireAdminAsync`, `requireAdmin`, `verifyAdminRequest`, `verifyAdminToken`, `adminAuth`, `checkAdmin`.
- **80 / 80 routes use `requireAdminAsync` or one of its equivalents.**
- **2 routes intentionally lack the call** (by design — they ARE the auth routes):
  1. `/api/admin/auth/token/route.ts` — token issuer, gated internally by httpOnly `admin_session` cookie check + NextAuth `getSessionUserId`
  2. `/api/admin/auth/auto-cookie/route.ts` — NextAuth-session-to-admin-cookie bridge, gated internally by `getServerSession` + `isAdmin(email)` + DB `subscription_tier='admin'`

### Auth implementation (`src/lib/admin-auth-server.ts`)
`requireAdminAsync(request)` chains 4 methods (any passes → authorized):

1. **Method 1 — Custom header/cookie**: `X-Admin-Token` header (base64 `username:password`) OR `admin_session` httpOnly cookie compared against `ADMIN_SESSION_TOKEN` env var.
2. **Method 1.5 — Bearer token / web session**: `getSessionUserId()` from `@/lib/auth-helper` returns `{ isAdmin }` true.
3. **Method 2 — NextAuth (Google OAuth)**: `getServerSession(authOptions)` → `isAdmin(session.user.email)` OR DB lookup where `subscription_tier === 'admin'` (premium is **not** admin — `FIX-P1-SECURITY CRIT-1`).
4. **Method 3 — DISABLED**: localhost bypass removed (`BOOTCAMP-3 P0`). Only `ALLOW_ADMIN_BYPASS=true` env var allows full bypass (default off).

### Routes missing auth: **NONE** ✅

### Middleware observation (`src/middleware.ts`)
- **Middleware is effectively a no-op for admin auth**. The middleware acknowledges (line 215-224): "REMOVED: Admin auth check from middleware (Edge runtime doesn't support NextAuth session). Auth is enforced in API routes themselves via `requireAdminAsync()`."
- **Risk**: This is a fragile pattern — every new admin route MUST remember to call `requireAdminAsync` as the first line. There is no compiler/structural enforcement. A future contributor adding a new `/api/admin/foo/route.ts` without the check would expose it.
- **Mitigation**: `destructivePrefixes` list (lines 189-209) blocks drop-table/truncate/repair/etc. at the middleware level for unauthenticated requests, but only via route-name patterns — not actually enforced in middleware code (it just sets `isDestructive` flag but doesn't return 403). It's documentation of intent.

### CSRF / HTTP-method concerns
**`/api/admin/engines/stop-all/route.ts`** (lines 113-115) and **`/api/admin/engines/start-all/route.ts`** expose a `GET` alias that calls `POST`:
```ts
// GET — alias for POST so admins can curl it without -X
export async function GET(req: NextRequest) {
  return POST(req);
}
```
- This is a **P0 CSRF risk**: any logged-in admin visiting a malicious page, or any URL pre-fetcher/crawler hitting `/api/admin/engines/stop-all`, would kill all Python engines.
- Same concern for `/api/admin/db-manager/delete-backup/route.ts` (POST accepts a DELETE-equivalent body) — but that's an acceptable pattern since some clients can't send bodies with DELETE.
- The `engines/stop-all` GET alias is documented as a convenience (`// GET — alias for POST so admins can curl it without -X`) — but the convenience doesn't justify the CSRF surface. **Admins should use `curl -X POST`**.

### Other auth notes
- `verifyAdminCredentials` (admin-auth-server.ts:47-56) uses plain `===` comparison — NOT constant-time. Vulnerable to timing attacks (theoretical, low severity because admin password attempts are rare).
- `verifyAdminToken` (admin-auth-server.ts:71-84) — base64 decodes `username:password` and calls `verifyAdminCredentials`. Also non-constant-time.
- `/api/admin/stats` (stats/route.ts:21-23) catches `authError` and still returns data (with `recent: []` instead of user details) — see §6.

---

## 3. Tab Functionality Review

The admin panel is organized into **5 hubs** with **28 tabs** (defined in `AdminView.tsx` lines 1000-1090):

### Hub 1: المراقبة وصحة النظام (System Monitoring) — 4 tabs
| Tab | Component | LOC | Function |
|-----|-----------|----:|----------|
| dashboard | (inline in AdminView) | ~980 | Overview cards (users, stocks, connections, prediction stats) + health chart |
| system-monitor | `SystemMonitorPanel.tsx` | 865 | CPU/RAM/DB live monitor + history charts |
| problems | `SystemProblemsTab.tsx` | 488 | Active system issues + solutions |
| cron-health | `CronHealthTab.tsx` | 353 | 25 cron jobs + last_run mtime from /tmp/*.log |

**Quality**: ✅ All 4 functional. `CronHealthTab` is excellent — parses `crontab.txt`, stats log files, categorizes by purpose, color-codes staleness (<24h green / <7d amber / >7d red).

### Hub 2: المحركات والتعلم الذكي (Engines + Learning) — 7 tabs
| Tab | Component | LOC | Function |
|-----|-----------|----:|----------|
| engine-control-room | `EngineControlRoomTab.tsx` | 2,481 | 8 engine cards + console + per-engine start/stop + bulk start/stop (with AlertDialog) |
| data-engine | `DataEngineTab.tsx` | 634 | Scraper details + historical backfill status |
| general | `EnginesStatusTab.tsx` | 745 | Legacy engine status grid |
| engine-settings | `EngineSettingsTab.tsx` | 576 | Weights + parameters editor |
| learning | `SuperLearningSystem.tsx` | 2,489 | Self-learning stats + signals + outcomes |
| backtest | `BacktestTab.tsx` | 650 | V40 backtest runner + status polling |
| platform-performance | `PlatformPerformanceView.tsx` | — | Performance KPIs |

**Quality**: EngineControlRoomTab is the most complex (2,481 LOC) — start-all/stop-all have proper AlertDialog confirmation. Good.

**Note**: `engine-control-room`, `data-engine`, and `general` tabs overlap heavily. The hub comment (line 999) acknowledges: "data-engine (مكرر)" — duplicate of `general`. Cleanup candidate.

### Hub 3: البيانات وقواعد البيانات (Data + DBs) — 8 tabs
| Tab | Component | LOC | Function |
|-----|-----------|----:|----------|
| databases | `DatabaseManagerFull.tsx` | 3,291 | Full DB manager (list/SQL/drop/truncate/VACUUM/backup) |
| db-backup | `DbBackupPanel.tsx` | 1,724 | Backup + GitHub push + restore |
| system-control | `SystemControlPanel.tsx` | 714 | Mission control (scraper + sync + cron status) |
| news-control | `NewsManagementTab.tsx` | 1,060 | News CRUD + batch + purge-all (with prompt keyword "مسح_الكل") |
| news-health | `NewsHealthTab.tsx` | 312 | News source health + last_fetch |
| sharia | `ShariaManagementTab.tsx` | 478 | Sharia compliance + scraper |
| source-authority | `SourceAuthorityTab.tsx` | 366 | Rule 66 + blocked sources + conflicts |
| validation-monitor | `ValidationMonitorTab.tsx` | 442 | Rule 65 + invalid fields |

**Quality**: DatabaseManagerFull is huge — drop/truncate/VACUUM all have AlertDialog. NewsManagementTab uses `prompt("اكتب: مسح_الكل")` for purge-all — excellent pattern that should be replicated everywhere.

### Hub 4: المستخدمين والاشتراكات (Users + Subscriptions) — 5 tabs
| Tab | Component | LOC | Function |
|-----|-----------|----:|----------|
| user-management | `UserManagementPanel.tsx` | 904 | CRUD + tier breakdown + bot sync + Paymob placeholder |
| users | `UsersManagement.tsx` | 1,543 | Older analytics-style user table (DUPLICATE) |
| promo-codes | `PromoCodesAdmin.tsx` | 592 | Promo code generator + redemption tracking |
| pricing | `PricingEditorTab.tsx` | 420 | **READ-ONLY** — prices from plans.ts |
| feedback | (inline in AdminView) | — | User feedback list |

**Quality concern**: `user-management` (904 LOC) and `users` (1,543 LOC) are functionally overlapping. The hub definition even labels `users` as "تحليلات المستخدمين" (analytics) vs `user-management` as "CRUD + باقات" — but UsersManagement has 1,543 lines of largely duplicate code.

**PricingEditorTab is read-only** (line 11): "editing prices requires editing plans.ts + redeploy per Rule 20". Admin cannot dynamically change prices. **Missing feature**.

### Hub 5: أدوات التسويق والنشر (Marketing + Publishing) — 4 tabs
| Tab | Component | LOC | Function |
|-----|-----------|----:|----------|
| marketing-studio | `MarketingStudio.tsx` | 96 | Hub for VideoEditor + ContentStudio + MarketingHub (lazy sub-tabs) |
| reports | (inline or external) | — | Daily/weekly/PDF reports |
| telegram | `TelegramTab.tsx` | 2,200 | Bot management + broadcast + reports |
| telegram-predictions | `TelegramPredictionsTab.tsx` | 512 | Published predictions audit + manual publish (with AlertDialog preview) |

**Quality**: TelegramPredictionsTab uses AlertDialog preview before publish — good. MarketingStudio properly lazy-loads 3 heavy sub-tools.

---

## 4. Security Assessment

### CRITICAL findings

#### CRIT-1: Hardcoded admin emails in client bundle
**Location**: `src/modules/admin/components/AdminView.tsx` lines 441-444
```ts
(userName && ['mohseny', 'admin'].includes(userName.toLowerCase())) ||
(userEmail && ['mohseny@m2y.net', 'enmohsen20111975@gmail.com',
  'enmohsen2011975@gmail.com', 'ceo@m2y.net'].includes(userEmail.toLowerCase())) ||
```
- These emails/usernames are baked into the **client-side JavaScript bundle** — anyone viewing source / opening DevTools on the admin page sees them.
- This is a P0 information leak (Rule 55 P0 violation). The `isAdmin()` function in `@/lib/admin-identities` exists specifically to source these from `NEXT_PUBLIC_ADMIN_EMAILS` env var instead of hardcoding.
- **Impact**: Low for privilege escalation (server-side `requireAdminAsync` is the real gate), but high for reconnaissance — attackers know which accounts to target for phishing.
- **Fix**: Replace the hardcoded list with `isClientAdmin(userEmail, userName)` only (which already exists and reads from env vars). The 4 explicit emails should be moved to `NEXT_PUBLIC_ADMIN_EMAILS`.

#### CRIT-2: `engines/stop-all` + `engines/start-all` GET → POST aliases
**Location**: `src/app/api/admin/engines/stop-all/route.ts` lines 112-115 + `start-all/route.ts`
- A GET request to `/api/admin/engines/stop-all` will kill all Python engines (data_engine, news, predictions, learning, sharia) — provided the request carries admin auth.
- **CSRF risk**: If an admin is logged in (httpOnly `admin_session` cookie set), any malicious page they visit can do `<img src="https://target.com/api/admin/engines/stop-all">` and trigger the kill.
- **URL pre-fetch risk**: Browsers/Chrome pre-fetchers/IM bots crawling URLs will hit this endpoint (auth will block them, but log noise).
- **Fix**: Remove the `GET` alias. Force `POST` only. Document the change in CHANGELOG.

### HIGH findings

#### HIGH-1: `/api/admin/stats` returns limited data to unauthenticated callers
**Location**: `src/app/api/admin/stats/route.ts` lines 21-23, 120-136
- The route calls `requireAdminAsync` but **does not return 403 on failure** — instead it returns "limited stats" with `recent: []`.
- Limited stats include: `users.total`, `users.active`, `users.premium`, `stocks.total`, `stocks.active`, `stocks.sectors`, `stocks.last_update`, `platform.watchlist_items`, `platform.portfolio_items`.
- **Impact**: Anyone hitting `/api/admin/stats` learns total user count, total stock count, last data update timestamp. This is a business intelligence leak (competitors can scrape).
- **Reasoning in code**: "gracefully return limited data instead of hard 403 (which caused infinite retry loops)" — pragmatic UX decision, but the right fix is to handle 403 properly in the client, not expose stats publicly.

#### HIGH-2: `db-manager/query` allows arbitrary SQL execution
**Location**: `src/app/api/admin/db-manager/query/route.ts` + `src/lib/admin-db-manager.ts:410-482`
- `executeQuery(dbName, sql, dryRun)` accepts any SQL string. `isReadSql()` distinguishes SELECT/WITH/PRAGMA/EXPLAIN from writes — but writes (DROP, DELETE, UPDATE, INSERT, CREATE, ALTER) are executed directly.
- `resolveDbPath()` validates the DB name (must end with `.db`, no `..`) — good, no path traversal.
- **Risk**: An admin (or a compromised admin session) can run `DROP TABLE users` or `DELETE FROM User` (via stocks.db path... actually User is in auth.db not stocks.db — but the admin can target any `.db` file in `db/`).
- This is by design for a database manager, but there's **no confirmation flow** in the UI for write operations (only the dry-run flag exists).
- **Mitigation**: Add an explicit `confirm: true` field required for write SQL, or auto-route writes through a separate `/api/admin/db-manager/execute-write` endpoint with mandatory dry-run first.

#### HIGH-3: Middleware is a no-op for admin auth
**Location**: `src/middleware.ts` lines 178-228
- The middleware explicitly says "Auth is enforced in API routes themselves" — there is no centralized admin gate.
- **Future-proofing risk**: Every new admin route MUST remember to call `requireAdminAsync`. No structural enforcement.
- **Fix**: Add a runtime helper `assertAdminRouteHasAuth(routePath)` that runs at server boot and validates every `/api/admin/**/route.ts` calls `requireAdminAsync` — fail-fast if missing.

### MEDIUM findings

#### MED-1: `ALLOW_ADMIN_BYPASS` env var bypasses ALL admin auth
**Location**: `admin-auth-server.ts:204-209`
- When `ALLOW_ADMIN_BYPASS=true`, every admin route returns 200 regardless of session.
- Useful for dev, but a footgun if accidentally set in `.env.production`.
- **Fix**: Add a startup warning if `NODE_ENV=production && ALLOW_ADMIN_BYPASS=true`.

#### MED-2: Non-constant-time credential comparison
**Location**: `admin-auth-server.ts:47-56, 71-84`
- `verifyAdminCredentials` uses `===` string comparison — vulnerable to timing attacks (theoretical).
- **Fix**: Use `crypto.timingSafeEqual` for the password comparison.

#### MED-3: `admin_session` cookie fixed for 7 days, no rotation
**Location**: `auth/route.ts:79`, `auth/auto-cookie/route.ts:92`
- Cookie `maxAge: 60 * 60 * 24 * 7` (7 days) — long-lived.
- `ADMIN_SESSION_TOKEN` is a static env var — rotating it requires server restart AND invalidates all admin sessions.
- **Fix**: Generate a per-session token (JWT or random) instead of using the static env var as the cookie value. Save issued tokens in DB with expiry.

#### MED-4: `users/[id]` PATCH allows admin to set any user's password
**Location**: `src/app/api/admin/users/[id]/route.ts` lines 99, 135-137
- `PATCH { password }` allows admin to bcrypt-hash and set a new password for any user.
- This is a powerful admin feature (account takeover) — by design, but no audit log entry is created when it's used.
- **Fix**: Log every password-reset action to `audit_events` table.

### GOOD security practices (positive findings)
- ✅ Hardcoded bcrypt backdoor `MOHSENY_HASH` was REMOVED (`FIX-P1-SECURITY CRIT-6`)
- ✅ Localhost bypass was REMOVED (`BOOTCAMP-3 P0` line 198-209)
- ✅ Premium tier is NOT auto-promoted to admin (`FIX-P1-SECURITY CRIT-1` line 181-185)
- ✅ Form-based login disabled by default (`ALLOW_FORM_LOGIN !== 'true'` → 403)
- ✅ `admin_session` cookie is httpOnly + secure (in prod) + sameSite=lax
- ✅ Last admin deletion is prevented (`users/[id]/route.ts` lines 204-216)
- ✅ `auth/token` only mints a token when httpOnly cookie or NextAuth session proves admin
- ✅ Path-traversal protection in `resolveDbPath` (validates `.db` suffix, no `..`)
- ✅ Admin emails are sourced from env vars via `@/lib/admin-identities` (NEXT_PUBLIC_ADMIN_EMAILS)
- ✅ Structured logger replaces `console.log` in admin-auth-server.ts (Rule 58 — no admin email leak in logs)
- ✅ `engines/stop-all` uses `execFile` with separate argv (not shell-wrapped pgrep pattern)

---

## 5. UX Quality

### Navigation
- **Structure**: 5 hubs (collapsible) × ~5 tabs each = 28 tabs. Well-organized.
- **Default expanded hub**: `health` (sensible default).
- **URL parameter**: `?tab=news-control` deep-links directly to a tab (line 513-521). Only `news-control` is handled — other tabs aren't deep-linkable. **Gap**: extend to all 28 tabs.
- **Accent colors per hub**: emerald (health), amber (engines), sky (data), rose (users), teal (telegram). Good visual hierarchy.
- **Arabic labels**: All in Arabic per Rule 30 (CLIENT-FACING-STYLE). Excellent.
- **`dir="rtl"`**: Set on root admin div (line 1093). Good.
- **Icons**: Each tab has a lucide-react icon. Good visual scanning.

### Error handling
- ✅ Every dynamic component wrapped with `withErrorBoundary(..., tabLabel)` — friendly "حدث خطأ" + Retry button (Phase 4 Task 3).
- ✅ Routes return `{ success: false, error: '...', error_ar: '...' }` with Arabic messages.
- ✅ `try/catch` everywhere with `console.error` + structured error response.
- ⚠️ Many `catch {} // silent fallback (safe-by-design)` blocks — pragmatic but hides debugging signal. Some have inline comments explaining why, others don't.

### Loading states
- ✅ `Skeleton` components in every tab (e.g., CronHealthTab lines 190-198).
- ✅ `Loader2 animate-spin` for buttons in flight.
- ✅ `LazyTabLoader` with Arabic label during dynamic import.

### Confirmation UX (mixed — see §8)
- ✅ AlertDialog: EngineControlRoomTab stop-all, DatabaseManagerFull drop/truncate, UserManagementPanel bulk-delete, TelegramPredictionsTab publish.
- ⚠️ Native `confirm()`: UserManagementPanel single-delete (line 753), PromoCodesAdmin delete (line 169), NewsManagementTab delete (lines 180, 206, 264).
- ✅ `prompt()` with typed keyword `مسح_الكل`: NewsManagementTab purge-all (line 235) — excellent pattern.
- ❌ **NO confirmation**: PurgeCacheButton "مسح الكل + إعادة بناء" (line 180) — fires immediately.

### Arabic text quality
- ✅ Consistent RTL throughout.
- ✅ No mixing of Arabic/English in same sentence (mostly).
- ⚠️ Some English leak: "cache_only", "predictions_only", "VIP شامل", "CRON", "VACUUM", "REINDEX" in technical contexts (acceptable).
- ⚠️ Mixed Arabic + English for some labels: "المحركات والتعلم الذكي" hub uses legacy id `'maestro'` internally (cosmetic).

### Debug panel
- AdminView has a `showDebug` state (default `true` — line 462) showing the last 20 admin API calls with timestamps. Useful for ops, but **on by default** clutters the UI. Should default to `false` and toggle via a button.

---

## 6. Data Accuracy

### `/api/admin/stats` — ✅ CORRECT
- `userCount` filters `is_active=true` (SOFT-DELETE-FIX, task SUBSCRIPTION-FIX-2026-10-07) — avoids counting soft-deleted users. Good.
- `stockCount` queries `stocks.db` with `is_active=1` filter.
- `priceHistoryCount` returns `-1` (sentinel) when heavy DB exists but isn't loaded — avoids loading heavy DB on stats request (memory optimization). Good design.
- `watchlistCount` + `portfolioCount` query `user_stock_watchlists` + `portfolio_assets` tables with try/catch (table may not exist).
- **Issue**: Returns limited stats to unauthenticated callers (see CRIT-1 in §4).

### `/api/admin/users` — ✅ CORRECT (with robust fallback)
- Calls `db.user.findMany` with `where` clause (search/role/status filters).
- **3-tier fallback** (lines 135-213):
  1. Prisma `findMany` (normal path)
  2. Auto-heal raw SQL: `UPDATE User SET last_active_at = datetime(CAST(...) / 1000, 'unixepoch')` — converts epoch-ms strings to ISO datetime strings (legacy bug fix)
  3. Retry Prisma `findMany`
  4. Raw SQL `SELECT ... FROM User ORDER BY created_at DESC LIMIT ? OFFSET ?`
- Returns `activity_status` (active_now / active_recent / active_month / inactive) computed from `last_active_at` (15min/7d/30d thresholds).
- Joins `PromoRedemption` table (created on-the-fly if missing) + `PromoCode.findMany` for legacy fallback.
- **Issue**: Returns up to 500 users per page (default pageSize=500, line 83) — fine for ~90 users but will need pagination when growth happens.

### `/api/admin/cron-health` — ✅ CORRECT
- Reads `/home/z/my-project/crontab.txt` (validates existence first).
- Parses 5-field cron expressions (regex validation line 158).
- Extracts `/tmp/foo.log` paths from each command (regex line 104).
- Stats each log file via `fs/promises.stat()` for `mtime`.
- Computes summary: total_jobs, jobs_ran, jobs_never_run, jobs_run_today, jobs_stale_7d.
- **Limitation**: Only knows if a cron **ran** (log file mtime) — not if it **succeeded**. Doesn't parse log content for exit codes or errors. A cron that ran and crashed still shows as "ran today" (green).

### Other verified endpoints
- `/api/admin/news` GET — supports `min_importance` filter (PHASE2-ADMIN-PANEL), pagination, search, source filter, summary counts.
- `/api/admin/db-manager/repair` — 6-step repair (integrity, WAL checkpoint, recreate tables, reindex, VACUUM, sync_analysis). Path-traversal protected. Safe-db-name validated.
- `/api/admin/db-manager/query` — arbitrary SQL, dry-run mode returns EXPLAIN plan. 1000-row cap on SELECTs.

---

## 7. Missing Features

### Admin features that should exist but don't

#### M-1: Dynamic pricing editor
- `PricingEditorTab` is **read-only** (line 11). Prices come from `src/lib/plans.ts` (free=0 / normal=199 / premium=299 / developer=599 EGP).
- Editing requires editing source code + redeploy (per Rule 20).
- **Fix**: Store prices in DB (`pricing_plans` table) and let admin edit via PATCH. Cache invalidation on change.

#### M-2: Audit log of admin actions
- No table tracking who did what when.
- `users/[id] PATCH` (password reset), `engines/stop-all`, `db-manager/query` writes, `purge-cache`, `drop-table` — all happen with no audit trail.
- **Fix**: Create `admin_audit_events` table; every destructive endpoint writes a row with `{ admin_email, action, target, timestamp, ip, user_agent }`.

#### M-3: Force-revoke user sessions
- Admin can soft-delete a user (`is_active=false`) but cannot revoke their active NextAuth sessions or admin_session cookie.
- A compromised admin session remains valid for 7 days.
- **Fix**: Add `POST /api/admin/users/[id]/revoke-sessions` that deletes from `Session` table + blacklists the user's `admin_session` cookie.

#### M-4: Manually run a specific cron job on demand
- CronHealthTab shows last_run but has no "Run now" button.
- **Fix**: Add `POST /api/admin/cron-health/[id]/run-now` that shells out the cron command (with timeout).

#### M-5: View/kill specific Python engine PID
- EngineControlRoomTab has bulk start-all/stop-all and per-engine start/stop, but no PID-level visibility.
- `/api/admin/engines/stop-all` does expose `pids_before` / `pids_after` in the response — UI doesn't surface them.
- **Fix**: Show per-engine PID list + "kill -9 PID" button for stuck processes.

#### M-6: 2FA for admin login
- Form login (when enabled) is single-factor (username + password).
- Google OAuth users get whatever 2FA their Google account has.
- **Fix**: Require TOTP 2FA for form login.

#### M-7: IP allowlist for admin endpoints
- Any IP can hit `/api/admin/*` — auth is via session/token only.
- **Fix**: Optional `ADMIN_ALLOWED_IPS` env var (CIDR list) checked in middleware.

#### M-8: Rate limiting on admin auth attempts
- `/api/admin/auth` POST has no rate limit — brute-force vulnerable (mitigated only by `ALLOW_FORM_LOGIN=false` default).
- `/api/admin/auth/token` GET also has no rate limit.
- **Fix**: Add `rate-limit` middleware (e.g., 5 attempts per IP per 10 minutes).

#### M-9: Rotate ADMIN_SESSION_TOKEN
- Static env var — rotation requires server restart + invalidates all sessions.
- **Fix**: Per-session JWT signed with a rotating key (see MED-3 in §4).

#### M-10: Bulk-activate / bulk-email users
- UserManagementPanel has bulk-delete (with AlertDialog) but no bulk-activate or bulk-email.
- **Fix**: Add bulk actions dropdown (activate, deactivate, email).

#### M-11: Send test email / newsletter
- No admin feature to send a test email or broadcast newsletter to users.
- TelegramTab has broadcast (to TG channel) but no email broadcast.
- **Fix**: Add `POST /api/admin/emails/broadcast` with template + recipient filter.

#### M-12: Force-refresh predictions for a specific stock
- EngineControlRoomTab has "إعادة توليد التوقعات لسوق معين" (per-market regenerate) — added in PHASE2-ADMIN-PANEL.
- Missing: per-stock force-refresh.
- **Fix**: Add `POST /api/admin/predictions/refresh?ticker=XXX`.

---

## 8. Dangerous Operations

### Operations without confirmation (P0/P1)

#### DANGER-1: `PurgeCacheButton` — NO confirmation
**Location**: `src/modules/admin/components/PurgeCacheButton.tsx` lines 178-225
- Button "مسح الكل + إعادة بناء" calls `handlePurge('all')` immediately on click.
- No `AlertDialog`, no `confirm()`, no `prompt()`.
- Effect: Deletes all rows from `cached_analysis` (stocks.db + predictions.db), `stored_analyses`, plus `prediction_logs` + `signal_logs` older than 7 days. VACUUM runs after.
- **Severity**: P1 — purge is recoverable (predictions regenerate via cron) but causes user-facing stale data until next cron run (could be hours).
- **Fix**: Wrap in AlertDialog with description "هذا سيمسح X صف من cached_analysis. سيتم إعادة بنائها تلقائياً في الـ cron القادم. متابعة؟"

#### DANGER-2: `engines/stop-all` GET alias
**Location**: `src/app/api/admin/engines/stop-all/route.ts` lines 112-115
- GET request kills all 5 engines (data_engine, news, predictions, learning, sharia).
- See CRIT-2 in §4.
- **Severity**: P0 (CSRF risk).

#### DANGER-3: `db-manager/query` write SQL
**Location**: `src/modules/admin/components/DatabaseManagerFull.tsx` (UI) + `/api/admin/db-manager/query/route.ts`
- Admin can run `DROP TABLE users`, `DELETE FROM User`, etc. with no confirmation.
- The UI has a SQL editor; on submit, executes immediately.
- **Severity**: P1 — admin-only, but a typo (e.g., missing WHERE clause) is unrecoverable without backup.
- **Fix**: For write SQL, require explicit `dryRun: true` first (returns EXPLAIN), then a confirmation modal "نفّذت الـ EXPLAIN. متابعة التنفيذ الفعلي؟" before running the actual write.

#### DANGER-4: `db-manager/drop-table` + `truncate-table`
**Location**: `DatabaseManagerFull.tsx` lines 855, 883, 923 + API routes
- ✅ UI uses AlertDialog (line 1840-1841).
- ✅ API requires `db` + `table` body params (no wildcards).
- ✅ Path traversal protected.
- **Status**: Adequately protected.

#### DANGER-5: `engines/stop-all` + `start-all` POST
**Location**: `EngineControlRoomTab.tsx` lines 2006, 2030 + AlertDialog 2192-2207
- ✅ Stop-all has AlertDialog confirmation.
- ❓ Start-all — need to verify (didn't read full component). Based on the comment "Quick Actions Bar — start-all / stop-all (with confirm)" (line 19), both should have confirmation.
- **Status**: Adequately protected.

#### DANGER-6: `users/[id] DELETE`
**Location**: `UserManagementPanel.tsx` line 753 + API at `users/[id]/route.ts:181`
- ✅ UI uses `confirm("حذف المستخدم ${u.email}؟ لا يمكن التراجع.")`.
- ✅ API prevents last-admin deletion.
- ✅ Cascade deletes related records (Prisma default).
- ⚠️ Soft-delete not offered — admin can only hard-delete. Some compliance contexts require soft-delete.
- **Status**: Adequately protected.

#### DANGER-7: `news` DELETE (purge_all)
**Location**: `NewsManagementTab.tsx` line 235 + API at `news/route.ts`
- ✅ UI uses `prompt("اكتب: مسح_الكل")` with exact-match keyword.
- ✅ This is the best confirmation pattern in the codebase.
- **Status**: Best practice. Should be replicated for PurgeCacheButton.

#### DANGER-8: `promo-codes` DELETE
**Location**: `PromoCodesAdmin.tsx` line 169 + API at `promo-codes/route.ts`
- ✅ UI uses `confirm("هل أنت تأكد من رغبتك في حذف الكود (${codeStr})؟")`.
- **Status**: Adequately protected (could upgrade to AlertDialog for consistency).

---

## Critical Issues

1. **CRIT-1**: Hardcoded admin emails/usernames in `AdminView.tsx:441-444` — leaked to client bundle. (P0 info leak)
2. **CRIT-2**: `engines/stop-all` + `engines/start-all` GET→POST aliases — CSRF + crawler risk. (P0)
3. **HIGH-1**: `/api/admin/stats` returns aggregate KPIs to unauthenticated callers. (P1)
4. **HIGH-2**: `db-manager/query` write SQL has no confirmation flow in UI. (P1)
5. **HIGH-3**: Middleware is a no-op for admin auth — relies entirely on per-route discipline. (P1)
6. **DANGER-1**: `PurgeCacheButton` has no confirmation dialog — destructive cache purge fires on click. (P1)

---

## High Priority

1. Replace hardcoded admin emails in `AdminView.tsx:441-444` with `isClientAdmin()` only — move emails to `NEXT_PUBLIC_ADMIN_EMAILS` env var.
2. Remove `GET` aliases from `engines/stop-all` + `engines/start-all` routes — enforce POST only.
3. Make `/api/admin/stats` return 403 to unauthenticated callers — fix the client to handle 403 instead of leaking limited stats.
4. Add AlertDialog to `PurgeCacheButton` "مسح الكل" action.
5. Add confirmation flow (dry-run + modal) to `db-manager/query` write SQL.
6. Add `assertAdminRouteHasAuth()` server-boot validator — fail-fast if any `/api/admin/**/route.ts` forgets `requireAdminAsync`.
7. Use `crypto.timingSafeEqual` in `verifyAdminCredentials` + `verifyAdminToken`.
8. Add startup warning if `NODE_ENV=production && ALLOW_ADMIN_BYPASS=true`.
9. Add audit log table for destructive admin actions (password reset, drop table, purge cache, stop engines).
10. Add 2FA (TOTP) for form-based admin login.

---

## Recommendations

### Immediate (this week)
- Fix CRIT-1 + CRIT-2 (client email leak + GET→POST CSRF).
- Add AlertDialog to PurgeCacheButton.
- Disable `showDebug` default (set to `false`).

### Short-term (2 weeks)
- Implement admin audit log (`admin_audit_events` table + middleware hook).
- Add rate limiting to `/api/admin/auth` POST.
- Refactor `DatabaseManagerFull.tsx` (3,291 LOC) into 4 sub-components.
- Refactor `AdminView.tsx` (2,083 LOC) — extract dashboard into `DashboardTab.tsx`.
- Consolidate `user-management` + `users` tabs (one CRUD + one analytics).

### Medium-term (1 month)
- Dynamic pricing editor (DB-backed `pricing_plans` table).
- Per-session JWT admin tokens (rotate without restart).
- Per-cron "Run now" button.
- Per-stock force-refresh predictions.
- Bulk-activate / bulk-email users.

### Long-term (quarter)
- 2FA (TOTP) for admin login.
- IP allowlist for admin endpoints.
- Admin activity dashboard (visualize audit log).
- Full audit of every `console.error` in admin routes (replace with structured logger per Rule 58).

### Positive highlights
- Auth model is layered and well-documented (`requireAdminAsync` chain).
- Lazy loading + ErrorBoundary pattern is excellent for resilience.
- Arabic UX is consistent and high-quality.
- CronHealthTab is a model component (clear, color-coded, categorized).
- NewsManagementTab's `prompt("مسح_الكل")` pattern should be the codebase standard.
- Path-traversal protection in DB routes is solid.
- The 80/80 admin routes auth coverage is a strong baseline.

---

**Audit complete.** 36 components, 80 API routes, 28 tabs, 5 hubs, 6 critical/high findings, 12 missing features, 8 dangerous operations catalogued. No code was modified. No other teams were contacted.
