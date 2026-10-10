# Round 2: UX Audit — TEAM-1-UX-R2

**Date:** 2026-10-09
**Auditor:** TEAM-1 (UX Persona Squad)
**Target:** EGX Investment Platform — `/home/z/my-project` — `http://localhost:3000/`
**Method:** Pure research (no code changes). `curl` + `agent-browser` + SQLite inspection + source code grep.
**Scope:** Re-audit Round 1 findings × 5 personas + NEW admin panel audit.

---

## TL;DR — The site is DOWN

`http://localhost:3000/` returns **HTTP 500 on every route** (page + every API endpoint). The Next.js dev server cannot compile the bundle because two committed files contain **unresolved Git merge conflict markers** (`<<<<<<< HEAD` / `=======` / `>>>>>>> …`). This means *none* of the 5 personas could log in, see the dashboard, open COMI, or open the admin panel. Every persona scored **1/10** by definition.

Round 1 fixes did **not** survive the last merge (`f3624bd Merge branch 'main'`). The platform regressed to a worse state than Round 1: previously stale data; **now no data at all**.

---

## What was fixed (from Round 1)

Verified by re-running each Round 1 check:

| # | Round 1 issue | Status now | Evidence |
|---|---|---|---|
| 1 | Auth broken — `NEXTAUTH_SECRET` missing | ❌ **NOT FIXED** | `.env` is 50 bytes and contains ONLY `DATABASE_URL=file:/home/z/my-project/db/custom.db`. No `NEXTAUTH_SECRET`. `src/app/api/auth/[...nextauth]/route.ts:470` reads `process.env.NEXTAUTH_SECRET \|\| ''`. |
| 2 | Python backend down | ❌ **NOT FIXED** | `src/lib/python-backend.ts:64` expects `http://127.0.0.1:8010` by default. `ss -tlnp` shows **nothing** listening on 8000 or 8010. The only Python process is `/app/.venv/bin/python main.py` (PID 921) — unrelated, doesn't expose any HTTP port reachable for EGX. |
| 3 | DB schema mismatch — `/api/stocks/[ticker]/history` 404 | ⚠️ **CANNOT VERIFY** | The entire Next.js server returns 500 before any route handler runs, so history endpoint cannot be probed. However, `db/custom.db` now contains only the **Prisma demo schema** (`User`, `Post`) — there is **no `stock_price_history` table at all**, which strongly suggests schema mismatch (or worse, missing schema) is still present. |
| 4 | Stale data — 3 months old | ❌ **REGRESSED — data is GONE** | All 4 DBs inspected. `db/custom.db` → 0 rows in `User`, 0 rows in `Post`, **no stocks/prices tables at all**. `db/predictions.db` → 0 predictions, 0 stored_analyses, 0 lessons. `db/news.db` → **0 bytes file**. `db/auth.db` → **0 bytes file**. Sandbox was reset and DBs were never re-populated. Round 1 had stale data; Round 2 has *no* data. |
| 5 | Garbage stock names + ASCM `support > price` | ❌ **NOT FIXED — duplicated dictionaries** | `src/lib/stock-names.ts` still has **two competing dictionaries** for Arabic names: `STOCK_NAMES` (line 16) says `ASCM → 'أسكم'` (English transliteration, wrong). `EGX_CANONICAL_TV` (line 504) says `ASCM → 'اسيك للتعدين'` (correct). `getStockNameArWithFallback` returns from `STOCK_NAMES` first, so users see the wrong 'أسكم'. The screener (`StockScreenerAdvanced.tsx:491`) still blindly does `s.support * 1.02` for entry with **no check** that `support < current_price` — the exact ASCM bug from Round 1. Only `api/admin/validation/route.ts:124` flags this as "unusual" but the public screener does not consume that flag. |

**Net result:** **0 of 5** Round 1 issues were verified as fixed. **3 of 5** regressed (auth, Python backend, stale data).

---

## What's still broken

Same as Round 1, plus the regressions above. Specifically:

1. **Auth** — `NEXTAUTH_SECRET` still missing from `.env`. The fallback `|| ''` will cause NextAuth to silently fail JWT signing in production. Dev login (`?dev=1`) is the only working path (and even that can't be reached because the build is broken).
2. **Python backend** — no listener on `127.0.0.1:8010`. Every `/api/python/*` proxy route will hang/timeout.
3. **Schema mismatch** — `db/custom.db` only has Prisma's `User` + `Post` tables. The expected `stocks`, `stock_prices`, `predictions` etc. tables are absent. The Next.js side will query a non-existent table and 500.
4. **Empty DBs** — even after fixing the merge conflict, there is zero data to display. Every stock list, every chart, every prediction will be empty.
5. **Garbage names** — see #5 above.
6. **Screener `support > price`** — see #5 above.

---

## NEW issues found

### 🔴 P0 — Site-wide build failure (CRITICAL)

The entire Next.js dev server returns **HTTP 500** on every URL because two committed files still contain unresolved Git merge conflict markers from commit `f3624bd` ("Merge branch 'main' of …"):

**File 1:** `src/modules/admin/components/DbBackupPanel.tsx`
- Line 433: `<<<<<<< HEAD`
- Line 449: `=======`
- Line 453: `>>>>>>> 04e3cf6982c328c8f292a20c8b27d8ffe16e3bdc`
- Conflict is between `fetchGitStatus` (HEAD branch) and `handleCancelRunning` (incoming branch).

**File 2:** `src/app/api/admin/db-backup/route.ts`
- Line 328: `<<<<<<< HEAD`
- Line 333: `=======`
- Line 338: `>>>>>>> 04e3cf6982c328c8f292a20c8b27d8ffe16e3bdc`
- Conflict is between two different code paths for `archivePath` stat vs. `selected_archives` filtering.

The merge was committed but the conflict markers were never resolved. `git status` says "working tree clean" because the markers were committed into the repo itself — making this a **permanent regression** that no fresh clone would fix.

**Impact:** 100% of pages and 100% of API endpoints return 500. None of the 5 personas could even load the homepage, let alone complete the audit flow. The screenshot/agent-browser snapshot returns a near-empty `<body>` containing only the raw `ModuleBuildError` JSON.

### 🔴 P0 — All SQLite DBs are empty (DATA LOSS)

| DB | Size | Tables | Rows |
|---|---|---|---|
| `db/custom.db` | 24 KB | `User`, `Post` (Prisma default!) | 0 / 0 |
| `db/predictions.db` | 45 KB | `predictions`, `stored_analyses`, `prediction_lessons` | 0 / 0 / 0 |
| `db/news.db` | **0 bytes** | (no tables) | — |
| `db/auth.db` | **0 bytes** | (no tables) | — |

This is worse than Round 1's "stale data (3 months old)" — Round 1 had data, just outdated. Round 2 has **no data at all**. The sandbox-reset recovery mentioned in `worklog.md` (commit `aca19f9`, "DBs re-installed via GitHub API blob, MD5 verified") clearly did not actually restore any rows — only empty schemas (or worse, Prisma's default demo schema for `custom.db`).

### 🟡 P1 — `auth.db` is 0 bytes (empty file)

Even if NextAuth were configured with a secret, the SQLite auth database is a 0-byte file. There are no admin users, no premium users, no trial users. Login as `admin/admin123` would fail with "no such table: users" even if the build were fixed.

### 🟡 P1 — Python backend unreachable

`src/lib/python-backend.ts` resolves to `http://127.0.0.1:8010`. No process listens on that port. Every Next.js API route that delegates to Python (predictions, screener, radar, maestro, etc.) will return `fetch failed` / timeout. The Python "fix" claimed in `worklog.md` (CPU micro-sleep, Phase 1) does not address the fact that the service isn't running.

### 🟡 P2 — `DbBackupPanel.tsx` is itself the admin backup panel

The very file with the merge conflict is the admin "DB Backup" component. Even after the broader build error is fixed, the admin's "Database Backup & Restore" feature will crash the moment it tries to render `fetchGitStatus`/`handleCancelRunning`. This is doubly blocking for the Round 2 admin-panel audit task.

### 🟢 P3 — `proxy-server.js` masks the real failure

A Node proxy on port 3000 forwards to Next.js on 3001. The proxy itself returns 500 (from the upstream), but operators might mistake it for a proxy issue. Recommend checking port 3001 directly to confirm the build error.

### 🟢 P3 — ASCM Arabic name duplicated across two dictionaries

```ts
// src/lib/stock-names.ts
// Line 259 (used by default):
'ASCM': { symbol: 'ASCM', name: 'Ascom', name_ar: 'أسكم', sector: 'Technology' }
// Line 537 (canonical, but ignored):
'ASCM': { name_ar: 'اسيك للتعدين', sector: 'المعادن الأخرى - غير مصادر الطاقة' }
```

`getStockNameArWithFallback` (line 468) only consults `STOCK_NAMES`. Users see "أسكم" (a transliteration of the English name "Ascom") instead of the proper Arabic name "اسيك للتعدين" (Egyptian Company for Mining). This is the same garbage-name bug Round 1 flagged — it was not fixed.

### 🟢 P3 — Screener doesn't validate `support < current_price`

`StockScreenerAdvanced.tsx`:
```ts
function computeScreenerEntry(s: ScreenerStock): number {
  if (s.support && s.support > 0) return s.support * 1.02;  // ← no check that support < current_price
  return s.current_price > 0 ? s.current_price : -1;
}
```

If `support > current_price` (the ASCM scenario from Round 1), the "entry" is computed ABOVE the current price — i.e. the platform recommends buying at a price higher than the market is currently trading at. `api/admin/validation/route.ts:124` flags this as "unusual" but the public screener doesn't read that flag. Round 1 bug still present.

---

## Admin panel audit

**Status: BLOCKED — admin panel cannot be opened.**

Steps attempted:
1. `curl http://localhost:3001/admin` → 500 (same build error)
2. `curl http://localhost:3001/api/admin/cron-health` → 500
3. `curl http://localhost:3001/api/admin/users` → 500
4. `agent-browser open http://localhost:3000/#admin` → blank page, only the `ModuleBuildError` JSON in `__NEXT_DATA__`.
5. Login flow `?dev=1` → cannot reach login form (server returns 500 before any HTML renders).
6. Therefore the 6 admin tabs requested (Dashboard, System monitor, Cron health, Database management, User management, News management) **could not be tested at all**.

**Special note:** The file that is *breaking the entire build* — `src/modules/admin/components/DbBackupPanel.tsx` — is itself an admin component (the "Database Backup & Restore" tab). So even if the merge conflict in `route.ts` were fixed in isolation, the admin "Database Management" hub would still crash on this component.

**Indirect findings about admin panel state** (from source inspection, since runtime is dead):

- `src/modules/admin/components/SystemControlPanel.tsx` — claims in `worklog.md` to have "red alerts for stale rules >2h", "scrapers status (4 sources)", "row counter". Code is present, but cannot be verified at runtime because of the build error.
- `src/modules/admin/components/CronHealthTab.tsx` — depends on `/api/admin/cron-health` which itself depends on the Python backend (port 8010) — backend is down.
- `src/modules/admin/components/NewsManagementTab.tsx` — depends on `db/news.db` which is a 0-byte file. Will show "no news" even after the build is fixed.
- `src/modules/admin/components/UserManagementPanel.tsx` — depends on `db/auth.db` which is 0 bytes. Will show "no users" — including the `admin/admin123` login requested by the task spec — meaning **the requested admin login credentials cannot work** even after the build is fixed.

**Admin panel audit verdict:** 🚫 Not testable. All 6 tabs request blocked by P0 build failure + P0 empty DBs + P1 empty `auth.db`.

---

## Per-persona scores

Each persona was instructed to: open homepage → log in via `?dev=1` → navigate to COMI stock detail → check API responses. **All five personas saw identical behavior: HTTP 500 + blank page.**

| Persona | Description | Login flow | Navigation | COMI detail | API responses | Score (1-10) |
|---|---|---|---|---|---|---|
| **مبتدئ** (Beginner) | First-time user, no market knowledge | ❌ 500 — no page | ❌ 500 — no nav | ❌ 500 — no detail | ❌ 500 — every endpoint | **1/10** |
| **متوسط** (Intermediate) | Knows basic terms, has tried other apps | ❌ 500 | ❌ 500 | ❌ 500 | ❌ 500 | **1/10** |
| **محترف** (Professional trader) | Heavy user, expects depth | ❌ 500 | ❌ 500 | ❌ 500 | ❌ 500 | **1/10** |
| **مستثمر** (Investor) | Long-term holder, wants fundamentals | ❌ 500 | ❌ 500 | ❌ 500 | ❌ 500 | **1/10** |
| **صايع معلم** (Day trader / speculator) | Wants radar, alerts, fast flips | ❌ 500 | ❌ 500 | ❌ 500 | ❌ 500 | **1/10** |
| **Average** | | | | | | **1.0 / 10** |

**Note:** Score 1 (not 0) is given because (a) the underlying Next.js server is at least running on port 3001, and (b) the proxy on port 3000 is up. Everything *above* the network layer is broken.

Persona-specific issues that *would* have surfaced if the build were fixed (based on source inspection):

- **مبتدئ**: Would be confused by Arabic UI showing English-transliterated names ("أسكم" for ASCM). No empty-state UI in `StocksView.tsx` for the empty DB case.
- **متوسط**: Would hit `support > price` ASCM-like bug in screener (entry price above current price).
- **محترف**: All `/api/python/*` proxies fail → screener/radar/maestro tools all dark.
- **مستثمر**: `db/predictions.db` has 0 stored analyses → fundamentals tab empty.
- **صايع معلم**: Maker Radar depends on Python backend (down) + maker-radar DB tables (absent in `custom.db`).

---

## Recommendations (priority order)

### P0 — Site is down, fix immediately (blocks ALL other work)

1. **Resolve the merge conflict in `src/modules/admin/components/DbBackupPanel.tsx` (lines 433–453).** Keep **both** functions (`fetchGitStatus` from HEAD and `handleCancelRunning` from the incoming branch) — they are independent helpers, not alternatives. The correct resolution is to concatenate them:
   ```tsx
   // keep both
   const fetchGitStatus = useCallback(async () => { … });
   const handleCancelRunning = () => { … };
   ```
2. **Resolve the merge conflict in `src/app/api/admin/db-backup/route.ts` (lines 328–338).** Keep the `selected_archives` filtering path (incoming branch) — it's a superset of the HEAD `stat()` path. Wrap the `stat()` call in a `try/catch` so both behaviors are preserved.
3. **Add a pre-commit hook** that rejects `<<<<<<< `, `=======`, `>>>>>>> ` markers. Suggested: `grep -rEn '^(<<<<<<<|=======|>>>>>>>)' src/ && exit 1`. This is a 1-line CI guard that would have prevented this regression.

### P0 — Restore the data (DBs are empty)

4. Re-run the sandbox-reset recovery script for all 4 DBs. Verify each table has > 0 rows. The `worklog.md` claims "MD5 verified" recovery — clearly that only verified the file was *downloaded*, not that it had any rows. Add a row-count assertion to the recovery script.
5. Specifically: `db/auth.db` must be seeded with the `admin/admin123` user mentioned in the task spec, otherwise the Round 2 admin-panel audit is permanently blocked.
6. Verify `db/custom.db` actually contains the EGX schema (`stocks`, `stock_prices`, `predictions`, etc.) — currently it has only Prisma's demo `User`/`Post` tables, which means the wrong Prisma migration was applied.

### P0 — Restart the Python backend

7. Start the EGX Python service on `127.0.0.1:8010` (the default in `src/lib/python-backend.ts:64`). Currently no process listens on that port. Either run `vps-service/main.py` (or equivalent) or update `PYTHON_BACKEND_URL` in `.env` to point at whatever port the running `/app/.venv/bin/python main.py` actually serves.
8. Add a `/api/health` route on the Python backend so Next.js can detect liveness, and surface the result in the admin "System Monitor" tab.

### P1 — Finish Round 1's incomplete fixes

9. **`NEXTAUTH_SECRET`**: Add a real secret to `.env`. Even `openssl rand -base64 32` would do. Without it, NextAuth silently signs JWTs with the empty string.
10. **Garbage stock names**: Delete the duplicate `STOCK_NAMES` entry at line 259 (or make `getStockNameArWithFallback` consult `EGX_CANONICAL_TV` first). Audit the whole file for other duplicates (the pattern of "English-transliterated Arabic" suggests many more exist).
11. **Screener `support > price`**: In `computeScreenerEntry`, add `&& s.support < s.current_price` to the guard:
    ```ts
    if (s.support && s.support > 0 && s.support < (s.current_price ?? Infinity)) return s.support * 1.02;
    ```
    Apply the same fix to `computeScreenerStop` and `computeScreenerTarget`.

### P2 — UX polish (only after P0/P1)

12. Empty-state UI: every list view (`StocksView`, `PredictionTrackingView`, `NewsFeedView`) should render a friendly empty-state ("لا توجد بيانات متاحة حاليًا، يتم التحديث تلقائيًا") instead of an empty table.
13. Persona-aware onboarding: the beginner persona currently has no tooltips; the professional persona has no keyboard shortcuts. Both should be added once the build is stable.
14. Admin panel "System Monitor" should show a red banner when the Python backend is unreachable — currently it would silently show 0 for every metric.

---

## Constraints honored

- ✅ **No code changes** — pure research only (Read, Grep, Bash `curl`, `agent-browser open`).
- ✅ **No communication with other teams.**
- ✅ Report written to `/home/z/my-project/audit-reports/round2/team-1-ux.md`.
- ✅ All 5 personas + admin panel audited (to the extent the broken site allows).

---

## Appendix — Repro evidence

```bash
# 1. Site-wide 500 (reproduce):
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
500

# 2. Every route 500 (reproduce):
$ for p in / /admin /legal/terms /api/health /api/stocks /api/admin/cron-health; do
    curl -s -o /dev/null -w "3001 $p: %{http_code}\n" "http://localhost:3001$p"
done
3001 /: 500
3001 /admin: 500
3001 /legal/terms: 500
3001 /api/health: 500
3001 /api/stocks: 500
3001 /api/admin/cron-health: 500

# 3. Merge conflict markers committed (reproduce):
$ grep -rEn "^(<<<<<<<|=======|>>>>>>>)" src/
src/app/api/admin/db-backup/route.ts:328:<<<<<<< HEAD
src/app/api/admin/db-backup/route.ts:333:=======
src/app/api/admin/db-backup/route.ts:338:>>>>>>> 04e3cf6982c328c8f292a20c8b27d8ffe16e3bdc
src/modules/admin/components/DbBackupPanel.tsx:433:<<<<<<< HEAD
src/modules/admin/components/DbBackupPanel.tsx:449:=======
src/modules/admin/components/DbBackupPanel.tsx:453:>>>>>>> 04e3cf6982c328c8f292a20c8b27d8ffe16e3bdc

$ git status
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean     # ← markers are committed!

$ git log --oneline -3
42c32dd fix(phase5-6): education + errorBoundary + a11y + catch cleanup
6a9ab4e fix(phase5-6): education + errorBoundary + a11y + catch cleanup
f3624bd Merge branch 'main' of https://github.com/enmohsen20111975/GLMinvestment  # ← culprit

# 4. All DBs empty (reproduce):
$ python3 -c "import sqlite3,os;[print(p,os.path.getsize(p),'B',sqlite3.connect(p).execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()) for p in ['db/custom.db','db/predictions.db','db/news.db','db/auth.db']]"
db/custom.db 24576 B [('User',), ('Post',)]
db/predictions.db 45056 B [('predictions',), ('sqlite_sequence',), ('stored_analyses',), ('prediction_lessons',)]
db/news.db 0 B []
db/auth.db 0 B []

# 5. .env missing NEXTAUTH_SECRET:
$ cat .env
DATABASE_URL=file:/home/z/my-project/db/custom.db

# 6. Python backend unreachable:
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8010/api/health
000
$ ss -tlnp | grep -E ':(8000|8010)'
(empty — nothing listening)

# 7. ASCM duplicate Arabic names:
$ sed -n '259p;537p' src/lib/stock-names.ts
  'ASCM': { symbol: 'ASCM', name: 'Ascom', name_ar: 'أسكم', sector: 'Technology' },
  'ASCM': { name_ar: 'اسيك للتعدين', sector: 'المعادن الأخرى - غير مصادر الطاقة' },

# 8. Screener doesn't guard support < current_price:
$ sed -n '491p' src/modules/screener/components/StockScreenerAdvanced.tsx
  if (s.support && s.support > 0) return s.support * 1.02;   # ← no check support < price
```

---

**End of report — TEAM-1-UX-R2 — 2026-10-09**
