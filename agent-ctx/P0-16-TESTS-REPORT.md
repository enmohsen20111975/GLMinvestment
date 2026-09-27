# P0 #16 — Critical Tests Report

**Task ID:** P0-16-TESTS
**Agent:** Test Engineer (critical tests + middleware fix)
**Date:** 2026-09-28

## Middleware Fix

### Bug
`src/middleware.ts` was imported via `import { randomUUID } from 'crypto'` (the Node.js built-in module). The Next.js Edge runtime does NOT support Node.js built-in modules — every request to the dev server returned **HTTP 500** with a stack trace referencing the missing `crypto` module.

This was a regression introduced by P0-11-AUTH (which added `x-request-id` header generation via `randomUUID()`).

### Fix
Replaced the Node.js `crypto` import with a runtime-portable `generateRequestId()` helper that:
1. Tries the **Web Crypto API** (`globalThis.crypto.randomUUID()`) — works in Edge runtime AND modern Node.js (19+).
2. Falls back to a **time-based ID** (`req-${Date.now()}-${Math.random().toString(36).slice(2,10)}`) if Web Crypto is unavailable.
3. Wraps both paths in `try/catch` so any failure → safe fallback (never 500).

### Verification
```
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
200
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health
200
$ curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/tab-data?tab=performance'; DROP TABLE predictions; --"
400
```

✅ App is healthy. SQLi protection still rejects malicious payloads.

---

## Tests Written

| File | LOC | Tests | Status |
|------|----:|------:|:------:|
| `src/__tests__/security/sql-injection.test.ts` | 111 | 6 | ✅ |
| `src/__tests__/security/auth-guard.test.ts` | 198 | 9 | ✅ |
| `src/__tests__/security/import-endpoint.test.ts` | 189 | 7 | ✅ |
| `src/__tests__/predictions/pipeline.test.ts` | 167 | 8 | ✅ |
| `src/__tests__/db/integrity.test.ts` | 165 | 11 | ✅ |
| `src/__tests__/api/health.test.ts` | 93 | 5 | ✅ |
| **Total** | **923** | **46** | ✅ |

### Critical paths covered

- **SQL injection** — verifies the 3 fixed endpoints (`/api/tab-data`, `/api/predictions/honest-tracking/live-tracking`, market param) reject classic DROP/DELETE/UNION/INSERT payloads with 400 (not 500, not silently executed).
- **Auth guards** — `requireAuthAsync` returns 401 when no session; `requireAdminAsync` returns 403 when no token/cookie and localhost bypass is disabled. Verifies happy-path of `X-Admin-Token` (base64 `admin:testpass`), `admin_session` cookie, and localhost bypass.
- **Import endpoint** — POST `/api/import` enforces auth (401), file size (413), file extension (400), `type` field validation (400), and rate-limit (≤5/min/IP). Verifies no 500 on malformed multipart.
- **Predictions pipeline** — `predictions.db` has zero duplicate `(ticker, prediction_date, persona)` groups (P0-18), has the UNIQUE index `idx_predictions_unique_ticker_date_persona`, `stored_analyses` populated (P0-1), `hunter_pick_tracking` populated (P0-2), no false TARGET_HIT from `maker_fuel_exhausted` (HELI fix), schema integrity (required columns present), no future-dated predictions, all TARGET_HIT predictions have valid `target_price`.
- **DB integrity** — All 4 critical DBs (`stocks.db`, `predictions.db`, `price_history.db`, `data_engine.db`) open read-only and respond to `SELECT 1`. `gold_prices` is NOT in `stocks.db` (moved out by P0-8) but IS in `data_engine.db` (canonical). `stocks.db.stocks` has ≥100 rows (real data).
- **Health endpoint** — `/api/health` returns 200/503, body has `status` + `components.{databases,nextjs,disk}`, `Cache-Control: no-store`, responds within 5s.

---

## Coverage Improvement

| Metric | Before | After |
|--------|--------|-------|
| Test files | 3 | **9** (+6 new) |
| Test LOC | 873 | **1,796** (+923 new) |
| Test cases | 75 | **121** (+46 new) |
| Coverage estimate | ~0.3% | ~0.6% (lines), but **critical paths** now covered |
| Test pass rate | 100% | **100%** (121/121) |
| Lint status | ✅ exit 0 | ✅ exit 0 |

> Note: True line-coverage % is still low because the codebase is ~291K LOC. The **value** of these tests is breadth on the critical paths (auth, SQLi, predictions, DB integrity, health) — not raw line coverage. A 30% target should be achievable in 2-3 months by adding per-route API tests (one `*.route.test.ts` per file under `src/app/api/`).

---

## Test Results

```
$ bun run test
 Test Files  9 passed (9)
      Tests  121 passed (121)
   Duration  11.17s
```

```
$ bun run lint
$ echo EXIT: $?   # → 0
```

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
200
```

### All test files green

```
✓ src/__tests__/ErrorBoundary.test.tsx          (18 tests)
✓ src/__tests__/test_phase_a_hotfix.test.ts     (10 tests)
✓ src/__tests__/signal-utils.test.ts            (47 tests)
✓ src/__tests__/security/auth-guard.test.ts     ( 9 tests)
✓ src/__tests__/security/import-endpoint.test.ts( 7 tests)
✓ src/__tests__/security/sql-injection.test.ts  ( 6 tests)
✓ src/__tests__/predictions/pipeline.test.ts    ( 8 tests)
✓ src/__tests__/db/integrity.test.ts            (11 tests)
✓ src/__tests__/api/health.test.ts              ( 5 tests)
```

---

## Failures (and how they were resolved)

1. **Initial run** — `auth-guard.test.ts` failed with `Cannot read properties of undefined (reading 'get')` on `request.cookies.get(...)` in `verifyAdminRequest`. **Root cause:** `Request` (Web API) doesn't have `.cookies` (a `NextRequest` extension). **Fix:** built a duck-typed `{ headers: Headers; cookies: { get: (name) => { value } | undefined } }` stand-in.

2. **X-Admin-Token happy path failed** — `verifyAdminCredentials` reads `ADMIN_USERNAME`/`ADMIN_PASSWORD` at module-load time, so `vi.stubEnv` didn't affect already-evaluated constants. **Fix:** `vi.resetModules()` + `await import('@/lib/admin-guard')` AFTER stubbing env — re-evaluates the constants with the test values.

3. **SQLi test syntax error** — the test name `'rejects "'; DROP TABLE" payloads targeting arbitrary tables'` had an unescaped apostrophe that broke the string literal. **Fix:** renamed to `'rejects SQLi DROP/DELETE/UNION/INSERT payloads targeting arbitrary tables'`.

4. **HTTP-based tests silently skipped** — `describe.skipIf(!serverUp)` is evaluated at module-load time, but `serverUp` was being set in `beforeAll()` (which runs LATER). **Fix:** moved the probe to a top-level `await` so the boolean is set BEFORE the describe runs.

5. **Top-level fetch threw** `RequestInit: Expected signal to be an instance of AbortSignal` — vitest's jsdom `fetch` rejects Node's `AbortSignal.timeout()` instances. **Fix:** replaced `AbortSignal.timeout()` with a manual `Promise.race` timeout pattern in every HTTP-based test.

---

## Recommendations

1. **Add Playwright E2E tests** for golden paths (login, search, predictions view, portfolio). These catch browser-side regressions that vitest unit tests cannot.
2. **Add a CI pipeline** (GitHub Actions) that runs `bun run test && bun run lint` on every PR — block merge on red.
3. **Generate per-route API smoke tests** — for each file under `src/app/api/`/route.ts`, auto-generate a "responds 2xx or 4xx (not 5xx)" smoke test. With ~660 routes this would quickly push coverage to 10-15%.
4. **Target 30% coverage** in 3 months (industry minimum). Realistic path: ~2-3 person-weeks of focused test-writing.
5. **Add a regression test for middleware** — call `middleware(new NextRequest('http://localhost/'))` and assert the response has an `x-request-id` header. This would have caught the original P0-11-AUTH regression before it shipped.
6. **Document the vitest `AbortSignal.timeout` limitation** in `vitest.config.ts` — future test authors will save time by not rediscovering it.
