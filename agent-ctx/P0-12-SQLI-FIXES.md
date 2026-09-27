# P0 #12 — SQL Injection Fixes

**Task ID:** P0-12-SQLI
**Agent:** Security Engineer (SQL injection fix)
**Date:** 2026-09-27

## Summary

- **Files fixed:** 5
- **Vulnerabilities patched:** 7 (some files had multiple injection sites)
- **Lint status:** ✅ `bun run lint` exits 0
- **TypeScript status:** ✅ No new errors introduced (pre-existing module-resolution errors remain unchanged)

The AUDIT_ENGINEERING report flagged "11 SQL injection vulnerabilities". I systematically re-evaluated every `db.prepare(\`...${...}...\`)` pattern in `src/app/api/` and found that several of the audit's 11 hits were **false positives** (e.g. hardcoded arrays, DB-metadata-sourced names, parseInt-clamped integers, WHERE clauses built from safe `?` placeholders). The genuine vulnerabilities — where **user-controlled input** reaches a SQL string — were concentrated in 5 files; this document covers every fix applied.

## Per-file fixes

### 1. `src/app/api/predictions/honest-tracking/live-tracking/route.ts` — **CRITICAL (3 injection sites)**

**Vulnerability:** The `market` query parameter was interpolated directly into SQL via `` `${market.toUpperCase()}` `` in three separate queries (lines 62, 134, 219). A request like `?market=EGX'; DROP TABLE predictions; --` would have its payload upper-cased and concatenated into the SQL string verbatim. This endpoint has **no auth check** and is publicly reachable.

**Fix:** Added a single block of helpers near the top of `GET()`:
```typescript
const marketUpper = market !== 'all' ? market.toUpperCase() : null;
const marketWhereClause = marketUpper ? 'WHERE market = ?' : '';
const marketAndClause   = marketUpper ? 'AND market = ?' : '';
const marketParams: string[] = marketUpper ? [marketUpper] : [];
```
Each of the three query sites now interpolates the static clause string (`${marketWhereClause}` / `${marketAndClause}`) and passes `marketParams` as bound parameters via `.get(...marketParams)` / `.all(...marketParams)`. The third query (per-persona loop) was extended with `, ...marketParams` after its existing `(p, \`%persona=${p}%\`)` arguments.

**Lines changed:** 44–51 (new block), 71, 85, 143, 148, 228, 241.

### 2. `src/app/api/finance/screener/route.ts` — **CRITICAL (1 injection site)**

**Vulnerability:** Line 56 read `` `ta.market = '${marketMap[market] || market}'` ``. The `marketMap[market]` lookup is safe *only when the user passes a known alias* (`eg|sa|kw|qa`); the `|| market` fallback passed the **raw user-controlled string** straight into SQL — classic injection. Endpoint is public.

**Fix:**
- Added `const whereParams: (string | number)[] = []` to collect bound values.
- Replaced the interpolation with a strict lookup: `const resolvedMarket = marketMap[market]`. If undefined, the request is rejected with `400 Invalid market filter: '<value>'. Allowed: eg, sa, kw, qa, all`.
- Used `whereConditions.push('ta.market = ?'); whereParams.push(resolvedMarket);`.
- Updated both query executors to spread `whereParams` *before* the existing `limit, offset`:
  - `db.prepare(query).all(...whereParams, limit, offset)`
  - `db.prepare(countQuery).get(...whereParams)`

**Lines changed:** 44–71, 121, 180.

### 3. `src/app/api/tab-data/route.ts` — **CRITICAL (per audit reference)**

**Vulnerability:** The AUDIT_ENGINEERING report explicitly named this file as the worst case: `db.prepare(\`SELECT * FROM ${tableName}\`)` where `tableName` derived from the `tab` query string. The current code on `main` already had a partial fix (`validTabs` array check), but the LIMIT/OFFSET were still interpolated raw and the validation was loose.

**Fix:**
- Replaced the `validTabs` array with a module-level `ALLOWED_TABS = new Set([...])` of 8 valid tab names, with a comment explaining the audit context.
- Switched the check from `validTabs.includes(tab)` to `ALLOWED_TABS.has(tab)` (O(1) and semantically a set operation).
- Added a helpful error message listing allowed values.
- Clamped `limit` to `1 ≤ x ≤ 1000` and `offset` to `≥ 0` (parseInt + `||` fallback for NaN).
- Replaced `LIMIT ${limit} OFFSET ${offset}` with `LIMIT ? OFFSET ?` and pushed both as bound parameters.
- Re-typed `params` from `any[]` to `(string | number)[]` and split out a dedicated `countParams: string[]` so the count query stays type-clean.

**Lines changed:** 1–80 (essentially the whole file, since the structure needed cleanup to support the new types).

### 4. `src/app/api/admin/clear-junk-data/route.ts` — **HIGH (4 interpolation sites; admin-auth)**

**Vulnerability:** The POST handler destructured `const { tables = [...] } = body` — so `body.tables` (user-controlled) replaced the safe default and was then interpolated into `SELECT COUNT(*) as count FROM ${table}`, `DELETE FROM ${table}`, and `SELECT COUNT(*) as count FROM ${table}` (4 sites total). Admin-auth protects the endpoint, but an admin (or stolen admin token) could wipe *any* table — `tables: ['stocks']` would `DELETE FROM stocks`.

**Fix:**
- Added module-level `ALLOWED_CLEAR_TABLES = new Set(['prediction_logs', 'signal_logs', 'outcome_logs', 'ExpertRecommendation', 'cached_analysis'])`.
- Replaced the destructure with explicit validation: collect `requestedTables`, filter through `ALLOWED_CLEAR_TABLES.has(t)`, fall back to the default list if the request supplied no valid tables.
- Surface rejected tables in the response (`results[rejectedName] = { ..., error: 'Table ... is not in the safe-to-clear whitelist' }`) so admins can see what was blocked.
- Loosened the result-type to `Record<..., { ...; error?: string }>` to fix a pre-existing TS error and to allow the new error field.
- In the GET path (which used a hardcoded list — already safe), added `safeTables = tables.filter((t) => ALLOWED_CLEAR_TABLES.has(t))` for defence-in-depth.

**Lines changed:** 7–18 (new const), 38–62 (POST validation), 137–143 (GET defence-in-depth), 50, 141 (type fixes).

### 5. `src/app/api/admin/db-explorer/route.ts` — **MEDIUM (3 interpolation sites; admin-auth)**

**Vulnerability:** The `tableName` query parameter was interpolated into `PRAGMA table_info("${tableName}")` and `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`. The code did already validate `tableName` against `tableInfo.find(t => t.name === tableName)` (so only existing-table names were used), but a malicious string containing `"` characters could theoretically break out of the double-quoted interpolation pattern. Admin-auth required, but defence-in-depth still applies.

**Fix:**
- Added a strict SQLite-identifier regex `/^[A-Za-z_][A-Za-z0-9_]*$/` check on `tableName` *before* the existence lookup. Any non-matching value returns `400 Invalid table name '<value>'. Only alphanumeric + underscore identifiers are allowed.`
- For the `tables.map((t) => ...)` site where `t.name` comes from `sqlite_master` (DB metadata, not user input), added the same regex check before using it in `SELECT COUNT(*) as count FROM "${safeName}"` — defends against a corrupted `sqlite_master` row.

**Lines changed:** 78–90 (tableInfo.map hardening), 84–103 (tableName regex check).

## Verification

- `bun run lint` → ✅ exit 0, zero eslint errors
- `npx tsc --noEmit --skipLibCheck` on the 5 modified files → only pre-existing module-resolution errors remain (`Cannot find module '@/lib/...'` — these exist on `main` too and are a project-config issue, not introduced by these edits)
- Manual review: ✅ all 5 fixes use either:
  - bound `?` parameters (live-tracking, screener, tab-data market/limit/offset), or
  - a `Set`-based whitelist with explicit 400 rejection (tab-data, clear-junk-data), or
  - a strict identifier regex with explicit 400 rejection (db-explorer).
- No file was rewritten unnecessarily — every change is surgical and preserves the original intent (pagination, market filtering, admin junk-clearing workflow).

## Vulnerabilities NOT fixed (out of scope for this task)

The audit's "11 vulnerabilities" count includes several false positives that were verified safe but left unchanged to avoid breaking unrelated code paths:

- `src/app/api/admin/news/route.ts:124, 381, 386` — `${whereSql}` is built entirely from `?`-placeholder clauses; `${placeholders}` is generated as `numericIds.map(() => '?').join(',')` (literal `?` chars, not values). Safe pattern.
- `src/app/api/stocks/route.ts:104, 120` — `whereSQL` built from `?`-placeholder clauses only.
- `src/app/api/admin/analytics/route.ts:39-43` — `${todayStart}` is a hardcoded SQL datetime expression string, not user input.
- `src/app/api/expert-recommendations/route.ts:267` — `updateFields` is built only from a hardcoded `allowedFields` array.
- `src/app/api/finance/schema/route.ts:93`, `src/app/api/notifications/route.ts:54` — interpolated identifiers come from hardcoded arrays.
- `src/app/api/smart-confluence/tabs/route.ts:48`, `src/app/api/stock-detail/route.ts:46`, `src/app/api/data-engine/health/route.ts:37/45`, `src/app/api/data-engine/new-db-stats/route.ts:54`, `src/app/api/db-stats/route.ts:33`, `src/app/api/market/sectors/intelligence/route.ts:37`, `src/app/api/news/latest/route.ts:176`, `src/app/api/predictions/expert-consensus/route.ts:121`, `src/app/api/stocks/[ticker]/orderbook/route.ts:72`, `src/app/api/maker-radar/signal-tracker/route.ts:143`, `src/app/api/maker-radar/entry-timing/route.ts:212`, `src/app/api/maker-radar/footprint/route.ts:133`, `src/app/api/maker-radar/stock/route.ts:71`, `src/app/api/maker-radar/signal-tracker/verify/route.ts:120`, `src/app/api/predictions/credibility/route.ts:97`, `src/app/api/news/route.ts:70`, `src/app/api/predictions/honest-tracking/list/route.ts:367`, `src/app/api/predictions/honest-tracking/live-tracking/route.ts:108/111/145` — all interpolate either:
  - DB-metadata-sourced names (e.g. `sqlite_master.name`, `PRAGMA table_info` results), or
  - parseInt-clamped integers (e.g. `${limit}`, `${days}`, `${minScore}`, `${limit * 3}`), or
  - hardcoded config values from `src/lib/radar-db.ts` (`CANDIDATES` array), or
  - WHERE clauses built exclusively from safe `?` placeholders.

These could all be hardened for consistency, but the task scope was "top 5 most critical" — they were intentionally left for a future hardening sweep.

## Next actions

1. **Add automated regression test** that hits `/api/tab-data?tab='; DROP TABLE tab_performance; --` and asserts a 400 response (plus a negative test for `/api/tab-data?tab=performance` returning 200).
2. **Add an ESLint custom rule** that flags `db.prepare(\`...${userInput}...\`)` patterns — the audit's grep-based approach caught these but a lint rule would prevent regressions. Skipped in this task due to time constraints.
3. **Address the audit's separate P0 finding about 540 unauthenticated API routes** — adding auth to public endpoints like `/api/tab-data`, `/api/finance/screener`, and `/api/predictions/honest-tracking/live-tracking` would limit the blast radius even further (these are now SQLi-safe but still publicly callable).
