# Round 2 — Team 9: Integration & Workflow Audit (Verification)

**Task ID**: TEAM-9-INT-R2
**Auditor**: Integration specialist (general-purpose)
**Scope**: Re-verify 8 Round-1 cross-cutting findings via API probes (curl) + source inspection.
**Mode**: PURE RESEARCH — no code modified, no files deleted, no git push.
**Date**: 2026-10-09 (post Phase-0 audit-fix commit `62b7b36` + `42c32dd`)
**Reference**: Round 1 report at `/home/z/my-project/audit-reports/team-9-integration.md`

---

## 0. Method

For each of the 8 Round-1 findings I:

1. Attempted a live `curl` probe against `http://localhost:3001` (Next.js dev) and `http://127.0.0.1:8010` (Python).
2. Where the API was unreachable, fell back to **static source inspection** (`Read`, `Grep`, `git show`) of the exact file:line cited in Round 1.
3. Cross-checked `git log -p` to confirm whether the Phase-0 audit-fix commit (`62b7b36`) touched the relevant file.

---

## 1. TL;DR — Sandbox state blocked live API probes

| Service | Port | Status |
|---|---|---|
| Next.js dev | 3001 | 🔴 **500 on every route** — unresolved merge conflict in `src/modules/admin/components/DbBackupPanel.tsx:433-453` (`<<<<<<< HEAD` / `=======` / `>>>>>>> 04e3cf6…`). Webpack `Merge conflict marker encountered` halts compile. |
| Next.js proxy | 3000 | 🔴 Cascades to 500 (proxies 3001) |
| Python backend | 8010 | 🔴 DOWN (no listener) |
| WebSocket svc | 3005 | 🔴 DOWN — `proxy-server.js` logs `connect ECONNREFUSED 127.0.0.1:3005` continuously |
| Telegram events | 3003 | 🔴 DOWN |

**Production DBs are MISSING from this sandbox** (gitignored, never restored):

| DB file | Size | Tables found |
|---|---|---|
| `db/stocks.db` | **absent** | — |
| `db/data_engine.db` | **absent** | — |
| `db/intraday.db` | **absent** | — |
| `db/price_history.db` | **absent** | — |
| `db/historical.db` | **absent** | — |
| `db/news.db` | **0 bytes** | none |
| `db/auth.db` | **0 bytes** | none |
| `db/predictions.db` | 45 KB | `predictions`, `stored_analyses`, `prediction_lessons` — but `SELECT MAX(prediction_date), COUNT(*)` returns `(None, 0)` |
| `db/custom.db` | 24 KB | Prisma demo (`User`, `Post`) only |

Round 1 had 3-month-stale data (latest write 2026-06-25). Round 2 has **no data at all**. All "live" endpoints are therefore untestable end-to-end; verdicts below rely on source inspection.

---

## 2. Findings Verification Matrix

| # | Round-1 Finding | Round-2 Status | Evidence (file:line / commit) |
|---|---|---|---|
| **F1** | Prediction pipeline stalled — cron not installed | ❌ **NOT FIXED** | `crontab.txt` still references `/root/GLMinvestment` (line 30+); no `crond` process running; `predictions.db` has 0 rows |
| **F2** | History endpoint 404 — broken COALESCE schema | ✅ **FIXED** | `src/app/api/stocks/[ticker]/history/route.ts:54-62` — `COALESCE(open, close)` etc. (commit `62b7b36`) |
| **F3** | News ticker-tagging broken (0 tagged) | ❌ **NOT FIXED** | `news.db` is 0 bytes; no ticker-extraction pipeline exists in `news-agent/analyzer/news_analyzer.py` (single-ticker analysis only) |
| **F4** | expert-analysis contradicts canonical | ⚠️ **PARTIAL FIX** | Thresholds aligned to 78/65/55/40/25 in `src/lib/expert-analysis.ts:647` (commit `62b7b36`) — BUT route still does `signal: canonical.signal || prediction.signal` at `src/app/api/stocks/[ticker]/expert-analysis/route.ts:73` (stale fallback NOT removed) |
| **F5** | `/api/stocks/[ticker]` returns `rsi:50` + `rsi_source:"null"` | ❌ **NOT FIXED** | `src/app/api/stocks/[ticker]/route.ts:117-118` unchanged — `next.rsi = unified.technical.rsi ?? next.rsi; next.rsi_source = unified.technical.rsi_source;` |
| **F6** | 73 of 133 Python routes hardcode URL | ❌ **REGRESSED — now 133 of 157** | `grep -rln "http://127.0.0.1:8010\|http://localhost:8010" src/app/api` = 133; `grep -rln "@/lib/python-backend" src/app/api` = 26 |
| **F7** | Two parallel Telegram publish paths, only one writes audit | ❌ **NOT FIXED** | `/api/telegram/publish-stock/route.ts:177-179` writes `published_at`/`telegram_message_id`/`was_published=1`; `/api/telegram/post/route.ts` still has zero `was_published`/`published_at` references (confirmed via grep) |
| **F8** | No staleness detection on "live" endpoints | ❌ **NOT FIXED** | `grep -rn "stale:\s*true\|is_stale:\s*true\|data_age_hours\s*[:=]" src/app/api src/lib` returns zero matches; `/api/metals/gold/route.ts:174` still hardcodes `is_live: true` unconditionally |

**Net result: 1 of 8 fixed, 1 partial, 6 not fixed.** And F6 actually regressed.

---

## 3. Detailed Verification

### F1 — Prediction pipeline stalled — ❌ NOT FIXED

Evidence:

- `crontab.txt` (lines 30+) still has `/root/GLMinvestment` as `PROJECT_ROOT` (production VPS path). The header comment says to sed-replace for the sandbox, but **no sed was ever run**.
- `which crontab` → "command not found" — `crontab` binary itself is missing from this container, so even if `crontab.txt` were imported, it couldn't be installed without an apt-get.
- No `crond` process: `ps aux | grep cron` returns nothing.
- `db/predictions.db` (45 KB, 4 tables present) but `SELECT MAX(prediction_date), COUNT(*) FROM predictions` returns `(None, 0)` — **zero rows, no fresh nor stale data**.
- Cron **scripts** exist (`vps-service/jobs/daily_predictor.py`, `intraday_scanner.py`, `daily_closer.py`, `learning_engine.py`, `market_scheduler.py`, `crypto_lab_scheduler.py` — 15 .py files in `vps-service/jobs/`) plus `fix_cron_paths.sh`, `vps-service/scripts/setup_cron.sh`, `scripts/setup-backup-cron.sh`, `scripts/setup-daily-health-cron.sh`. So the **code** is there; the **runtime wiring** is not.
- Round 1 said "latest prediction 2026-06-25 — 3 months stale". Round 2: **no predictions at all** (sandbox reset wiped them; DBs never restored). This is a regression, not a fix.

### F2 — History endpoint COALESCE schema fix — ✅ FIXED

Round 1 found `COALESCE(open, open_price)` etc. — `open_price` column doesn't exist in `stock_daily_prices`.

Round 2 inspection of `src/app/api/stocks/[ticker]/history/route.ts` lines 53-62:

```sql
SELECT price_date as date,
       COALESCE(open, close) as open,    -- ← FIXED: was COALESCE(open, open_price)
       COALESCE(high, close) as high,
       COALESCE(low, close) as low,
       close as close,
       COALESCE(volume, 0) as volume
FROM stock_daily_prices
WHERE ticker = ?
ORDER BY price_date DESC
LIMIT ?
```

Confirmed by `git show 62b7b36 -- "src/app/api/stocks/[ticker]/history/route.ts"` — diff replaces the broken `open_price`/`high_price`/`low_price`/`close_price` fallbacks with `close`. The header comment "SCHEMA-FIX (2026-10-09, Team 9)" tags it as the explicit Round-1 fix.

⚠️ **Could not live-verify** because the dev server 500s (merge conflict blocker) and `stock_daily_prices` table doesn't exist in this sandbox (no `stocks.db`). But the source-level fix is correct and matches the Round-1 recommendation #2 verbatim.

### F3 — News ticker-tagging broken (0 tagged) — ❌ NOT FIXED

- `db/news.db` is **0 bytes** (empty file — no schema, no rows). Cannot verify "0 tagged" via SQL.
- `news-agent/analyzer/news_analyzer.py` exposes `analyze_stock_news(ticker, company_name, …)` — it takes a **single ticker as input** and analyzes news for that ticker. There is **no ticker-extraction routine** that scans article text and emits a list of mentioned tickers.
- `src/app/api/news/route.ts:279-294` POST handler stores whatever `tickers` array is in the request body:
  ```ts
  INSERT OR IGNORE INTO market_news (…, tickers, …) VALUES (…, ?, …)
  // tickers = JSON.stringify(tickers || [])
  ```
  The route is a **passthrough** — it persists what the caller provides. Without an upstream extractor, callers pass `[]`.
- Round 1 recommended "investigate why `news_agent.py` is storing `tickers: '[]'`". Root cause is now clearer: the agent doesn't have an extractor at all — it's a per-ticker analyzer.
- Phase-0 commit `62b7b36` did add a `(market_code = ? OR market = ?)` clause to news filter (P0-8, Team 7 finding), but that fix is orthogonal to ticker-tagging.

### F4 — expert-analysis contradicts canonical — ⚠️ PARTIAL FIX

**Threshold alignment — FIXED** (`src/lib/expert-analysis.ts:647`):

```ts
// CANONICAL-FIX: استخدم canonical thresholds (78/65/55/40/25)
if (data.master_score >= 78) { rec = 'STRONG_BUY'; … }
else if (data.master_score >= 65) { rec = 'BUY'; … }
else if (data.master_score >= 55) { rec = 'ACCUMULATE'; … }
else if (data.master_score <= 25) { rec = 'STRONG_SELL'; … }
else if (data.master_score <= 40) { rec = 'SELL'; … }
// 41-54 = HOLD (canonical)
```

Matches `vps-service/analyzers/engine_settings.py:106-111` (`signal_strong_buy_threshold: 78, signal_buy_threshold: 65, signal_accumulate_threshold: 55, signal_hold_threshold: 40, signal_sell_threshold: 25`) and `src/lib/canonical-signal.ts:19-25` (`SIGNAL_THRESHOLDS`). Three sources, same thresholds — canonical.

**Stale-fallback contradiction — NOT FIXED** (`src/app/api/stocks/[ticker]/expert-analysis/route.ts:73-74`):

```ts
signal: canonical.signal || prediction.signal,              // ← still falls back to stale prediction
master_score: canonical.master_score || prediction.master_score,
```

The Round-1 recommendation #4 said: "change `canonical.signal || prediction.signal` to just `canonical.signal`. When canonical is null, the analysis should say 'no fresh prediction' rather than falling back to stale data." This line was **not touched** in `62b7b36` (confirmed via `git show 62b7b36 -- "src/app/api/stocks/[ticker]/expert-analysis/route.ts"` — diff is empty for this file).

**Verdict**: thresholds no longer drift, but the contradiction can still occur when `canonical.signal` is null and a stale `prediction.signal` is present. Severity downgraded from P1 to P2.

### F5 — `/api/stocks/[ticker]` returns `rsi:50` with `rsi_source:"null"` — ❌ NOT FIXED

`src/app/api/stocks/[ticker]/route.ts:117-118` is unchanged:

```ts
next.rsi = unified.technical.rsi ?? next.rsi;       // preserves stale Python value (50)
next.rsi_source = unified.technical.rsi_source;     // forces "null"
```

This produces the internally-inconsistent `{ rsi: 50, rsi_source: "null" }` payload. The Round-1 recommendation #6 offered two acceptable fixes:

1. `next.rsi = null` (cleanest — matches canonical route), OR
2. Preserve `next.rsi` AND set `rsi_source` to `"precomputed"`.

Neither was applied. `git log -- "src/app/api/stocks/[ticker]/route.ts"` shows the last touch was commit `88c7f06` ("feat(unify)") which predates the Round-1 audit. No Phase-0 commit touched this file.

### F6 — 73 of 133 Python routes hardcode URL — ❌ REGRESSED

Re-grep results (ripgrep via the Grep tool):

```
Routes hardcoding 'http://127.0.0.1:8010' or 'http://localhost:8010'    → 133
Routes importing from '@/lib/python-backend'                            →  26
Total routes referencing Python backend (either way)                   → 157
```

**Round 1**: 73 hardcode + 66 canonical = 139 total
**Round 2**: 133 hardcode + 26 canonical = 157 total

The **canonical import count actually dropped from 66 → 26** (some refactor removed imports in places, or my grep pattern is stricter than Round-1's). Either way, the drift is **worse**, not better — 85% of Python-talking routes now bypass the canonical helper, up from 55%. The IPv6 ::1 fix and `PYTHON_BACKEND_URL` env-var override in `src/lib/python-backend.ts` are bypassed by all of them.

No commit between Round 1 and Round 2 addresses this (searched `git log --all --grep="hardcode"` — no hits).

### F7 — Two parallel Telegram publish paths, only one writes audit trail — ❌ NOT FIXED

Both paths still exist:

- `/api/telegram/publish-stock/route.ts` — direct Bot API + audit-trail write:
  - Lines 17-19 (doc comment): `published_at`, `telegram_message_id`, `was_published=1`.
  - Lines 177-179: `UPDATE predictions SET published_at = datetime('now'), telegram_message_id = ?, was_published = 1 …`.
  - Line 197: returns `published_at: new Date().toISOString()`.
  - Line 200: `marked ${updatedRows} prediction(s) as published`.
- `/api/telegram/post/route.ts` — proxy to Python `/api/telegram/post/{action}`:
  - `grep -n "was_published\|telegram_message_id\|published_at" src/app/api/telegram/post/route.ts` → **0 matches**.
  - No DB write-back on the Node side.
- `/api/telegram/[...path]/route.ts` — generic catch-all proxy, same lack of audit trail.

Round-1 recommendation #9 ("Make `/api/telegram/post` also write the audit trail, OR deprecate it") was **not implemented**.

Cross-check: Team 5 Round-2 report independently confirms (their C3) that `auto_poster.py` on the Python side also doesn't write the audit trail — so even if `/api/telegram/post` proxied to a Python caller that wrote it, the Python side wouldn't either. Two layers of missing audit.

### F8 — No staleness detection — ❌ NOT FIXED

Targeted grep for the recommended patterns:

```
grep -rn "stale:\s*true\|is_stale:\s*true\|data_age_hours\s*[:=]\|stale_warning\|staleness_threshold" src/app/api src/lib
→ 0 matches
```

Spot-checks on the worst offenders from Round 1:

- `src/app/api/metals/gold/route.ts:172-174`:
  ```ts
  last_updated: lastUpdated,        // value comes from row timestamp (could be months old)
  source: 'data_engine.db',
  is_live: true,                   // ← still hardcoded true, regardless of last_updated age
  ```
  No `data_age_hours`, no `stale: boolean`, no threshold check.
- `src/app/api/market-pulse/route.ts:31`: only mention of "stale" is a code comment ("Return stale cache if available") — refers to Next.js segment cache, not data freshness.
- `src/app/api/predictions/daily-picks/route.ts`: zero staleness-related identifiers.
- `src/app/api/admin/cron-health/route.ts:227` has `jobs_stale_7d: jobsStale` — but this is internal cron-health telemetry surfaced only to admin, not a user-facing "data is N hours old" flag on stock/prices endpoints.

Round-1 recommendation #8 ("Compute `data_age_hours` for every 'live' response based on the latest DB timestamp. Surface it in the response (`stale: true`, `last_updated: …`)" — was not implemented.

---

## 4. Cross-team corroboration

Other Round-2 reports independently confirm pieces of the integration picture:

- **Team 1 (UX)**: "The site is DOWN — HTTP 500 on every route … unresolved Git merge conflict markers". Confirms F1/F8 sandbox blockers. Also notes `db/news.db` is 0 bytes and `db/auth.db` is 0 bytes.
- **Team 5 (Telegram)**: `auto_poster.py` doesn't write audit trail (their C3) — corroborates F7 from the Python side.
- **Team 7 (Multi-market)**: TADAWUL `persona_predictions = 0` (their #4) — same root cause as F1 (no generator running).
- **Team 7**: SQL injection in `/api/maker-radar` was fixed in the same Phase-0 commit (`76accf9`/`62b7b36`) — confirms the audit-fix wave landed but only addressed P0/P1 security items, leaving the P2/P3 integration drift untouched.

---

## 5. Net Assessment

Of the 8 Round-1 findings:

- **1 fixed** (F2 — history COALESCE schema)
- **1 partial** (F4 — thresholds aligned, but stale-fallback contradiction remains)
- **6 not fixed** (F1, F3, F5, F6, F7, F8)
- **1 regressed** (F6 — hardcode count grew from 73 → 133)

Plus a **new sandbox-wide blocker**: unresolved merge conflict in `src/modules/admin/components/DbBackupPanel.tsx:433-453` ships the entire Next.js dev server to HTTP 500, making every "live" probe impossible. This is not a Round-1 finding per se, but it directly impedes verification of every Round-1 finding that depended on curl. Other teams (Team 1, Team 5, Team 7, Team 8) hit the same wall.

**Recommended next actions (P0, in order):**

1. **Resolve the merge conflict** in `DbBackupPanel.tsx` (lines 433-453). Pick either HEAD's `fetchGitStatus` or the merged-in `handleCancelRunning` — they are not mutually exclusive and likely both should be kept.
2. **Restore the production DBs** to the sandbox (`stocks.db`, `data_engine.db`, `intraday.db`, `price_history.db`, `historical.db`, plus non-empty `news.db`/`auth.db`/`predictions.db`). Without them, no end-to-end verification is possible.
3. **Fix F5** (`src/app/api/stocks/[ticker]/route.ts:117-118`): set `next.rsi = unified.technical.rsi;` (drop the `?? next.rsi` fallback) — 1-line change, removes a user-visible contradiction.
4. **Fix F4 fully**: drop the `|| prediction.signal` fallback at `expert-analysis/route.ts:73` so the expert report says "no fresh prediction" instead of fabricating one.
5. **Install cron** for the sandbox: `apt-get install -y cron && sed "s|/root/GLMinvestment|$(pwd)|g" crontab.txt | crontab -` — then run `daily_predictor.py --today-only --max-picks 5` once manually to seed `predictions.db`.

**Recommended next actions (P1/P2):**

6. **F6**: mechanical refactor — `git grep -l "http://127.0.0.1:8010\|http://localhost:8010" src/app/api | xargs sed -i 's|http://\(127\.0\.0\.1\|localhost\):8010|PYTHON_BACKEND_URL|g'` (with imports added). Eliminates a class of production misconfigurations.
7. **F7**: either delete `/api/telegram/post/route.ts` (deprecate) or replicate the audit-trail block from `publish-stock/route.ts:175-185` into it.
8. **F8**: add a shared `computeStaleness(lastUpdated: string)` helper in `src/lib/staleness.ts`; call from `/api/metals/gold`, `/api/market-pulse`, `/api/stocks/[ticker]`, `/api/predictions/daily-picks`; surface `{ stale: true, data_age_hours: N }` when N > 24.

**Recommended next actions (P2/P3):**

9. **F3**: implement a ticker-extraction step in `news-agent/analyzer/news_analyzer.py` (regex over `stocks.db.stocks.ticker` + `name_ar` against article text) and call it before `POST /api/news`; or add a Node-side post-processor that scans stored articles and backfills the `tickers` JSON column.

---

## Appendix A — Probe log

All attempts against `http://localhost:3001` (Next.js dev, since 3000 proxies here) returned HTTP 500 within 5-10s. Sample:

```
/api/health                → 500  (ModuleBuildError: Merge conflict marker encountered)
/api/stocks/COMI           → 500
/api/stocks/COMI/unified   → 500
/api/stocks/COMI/history   → 500
/api/stocks/COMI/expert-analysis → 500
/api/stocks/COMI/news      → 500
/api/news?limit=1          → 500
/api/predictions/daily-picks → 500
/api/market-pulse          → 500
/api/metals/gold           → 500
```

`http://127.0.0.1:8010/api/health` → connection refused (Python backend down).
`http://localhost:3005/health` → connection refused (WS service down).
`http://localhost:3003/health` → connection refused (Telegram events down).

## Appendix B — Files inspected (key)

| File | Round-1 issue | Round-2 inspection result |
|---|---|---|
| `src/app/api/stocks/[ticker]/history/route.ts` | F2 broken COALESCE | ✅ FIXED (`62b7b36`) |
| `src/lib/expert-analysis.ts` | F4 threshold drift | ✅ FIXED (`62b7b36` line 647) |
| `src/app/api/stocks/[ticker]/expert-analysis/route.ts` | F4 stale fallback | ❌ line 73 unchanged |
| `src/app/api/stocks/[ticker]/route.ts` | F5 rsi/source contradiction | ❌ lines 117-118 unchanged |
| `src/app/api/telegram/publish-stock/route.ts` | F7 audit trail | — (still writes audit, as in Round 1) |
| `src/app/api/telegram/post/route.ts` | F7 missing audit | ❌ still 0 audit-trail references |
| `src/app/api/metals/gold/route.ts` | F8 hardcoded `is_live: true` | ❌ line 174 unchanged |
| `src/lib/python-backend.ts` | F6 canonical helper | — (helper exists; 133 routes bypass it) |
| `src/modules/admin/components/DbBackupPanel.tsx` | NEW blocker | 🔴 unresolved merge conflict at lines 433-453 |
| `crontab.txt` | F1 cron wiring | ❌ still references `/root/GLMinvestment`; no crond process |
| `db/predictions.db` | F1 stale pipeline | 🔴 0 rows (was 9,339 in Round 1) |
| `db/news.db` | F3 ticker-tagging | 🔴 0 bytes (was 7.4 MB / 4,428 rows in Round 1) |

---

**End of report.**
