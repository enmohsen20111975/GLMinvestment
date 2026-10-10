# Team 6 — News System Audit · Round 2 (News Filter Fix Verification)

> **Task ID**: TEAM-6-NEWS-R2
> **Scope**: Verify the Round 1 finding "News filter broken (market field = 'general') — should use `market_code`". Re-verify the other 6 Round 1 findings as secondary check.
> **Mode**: PURE RESEARCH (no code modifications)
> **Date**: 2026-10-09 (post Phase 1-4 audit fixes)
> **Reference**: Round 1 report at `audit-reports/team-6-news.md`
> **Cross-reference**: Team 7 Round 2 report at `audit-reports/round2/team-7-multi-market.md`

---

## Executive Summary

The news filter fix was **applied in code** (commit `62b7b36428d78ab73f93a185e960860a61ea8ad1`, "P0-8: news filter broken (Team 7)", 2026-10-09 16:51 UTC) but is **broken at runtime** because the `market_code` column does not exist in the `market_news` schema created by `ensureNewsTable()` or the migration script. Every `GET /api/news?market=EGX` call will throw `no such column: market_code`, be caught by the try/catch, and return HTTP 500 `internal_error`.

| # | Round 1 Finding | Status | Notes |
|---|---|---|---|
| 1 | News filter broken (`market='general'`) | ⚠ **PARTIALLY FIXED / BROKEN** | Filter SQL uses `market_code`, but column doesn't exist → 500 error |
| 2 | 0 articles tagged EGX | ⚠ **Trivially true** | `db/news.db` is now 0 bytes (empty) post sandbox-reset #2 |
| 3 | 84% from AlphaVantage | ⚠ **No data** | DB is empty; not re-verifiable, but seed data is unchanged |
| 4 | news-agent never runs (no cron) | ❌ **NOT FIXED** | `crontab.txt` still has 0 news/agent entries |
| 5 | 3 broken RSS sources | ❌ **NOT FIXED** | Hardcoded broken list still: argaam, amwal, youm7 |
| 6 | Hardcoded Windows path | ❌ **NOT FIXED** | `marketmaker_news_scraper.py:9` still has `D:\My WebStie...` |
| 7 | V40_2_NEWS_IMPACT=0 (disabled) | ❌ **NOT FIXED** | `daily_predictor.py:2247` still `os.environ.get('V40_2_NEWS_IMPACT', '0')` |

**Net result: 0 fully fixed, 2 partial/regressed, 5 not fixed.**

---

## Detailed Verification

### #1 — News Filter Fix (PRIMARY TASK) ⚠ PARTIALLY FIXED / RUNTIME BROKEN

#### 1.1 What the fix did

The fix at `/home/z/my-project/src/app/api/news/route.ts` (lines 129-135 and 166-170) was applied in commit `62b7b36` ("P0-8: news filter broken (Team 7)"):

**GET `/api/news` main query (lines 129-135):**
```ts
if (market) {
  // FIX (2026-10-09, Team 7): market_code هو الـ column اللي فيه السوق الحقيقي
  // قبل كده: conditions.push('market = ?') ← الـ market column = 'general' دائماً
  // دلوقتي: بنفلتر بـ market_code (EGX, TADAWUL, KSE, QSE, US, CRYPTO)
  conditions.push('(market_code = ? OR market = ?)');
  params.push(market, market);
}
```

**GET `/api/news` count query (lines 166-170):** same pattern applied.

**Default value change (line 77 of `ensureNewsTable`):**
```sql
market TEXT DEFAULT 'EGX',  -- was: 'general' (per Round 1) — verified at line 77
```

This matches what Team 7 reported (`audit-reports/round2/team-7-multi-market.md` row #2).

#### 1.2 Why the fix is BROKEN at runtime

The `market_code` column **does not exist** in the table schema created by `ensureNewsTable()` (lines 62-92 of `route.ts`):

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS market_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    summary_ar TEXT,
    summary_en TEXT,
    source TEXT DEFAULT 'news_agent',
    source_type TEXT DEFAULT 'telegram',
    url TEXT,
    tickers TEXT DEFAULT '[]',
    importance INTEGER DEFAULT 0,
    sentiment TEXT DEFAULT 'neutral',
    impact_type TEXT DEFAULT 'general',
    market TEXT DEFAULT 'EGX',        -- ✅ exists
    image_paths TEXT DEFAULT '[]',
    ocr_text TEXT DEFAULT '',
    raw_analysis TEXT DEFAULT '{}',
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT,
    is_sent INTEGER DEFAULT 0,
    is_catalyst INTEGER DEFAULT 0,
    UNIQUE(title, source)
  )
`);
// Only ALTER attempt is `is_catalyst` — NO ALTER for `market_code`
try {
  db.exec(`ALTER TABLE market_news ADD COLUMN is_catalyst INTEGER DEFAULT 0`);
} catch { /* safe-by-design */ }
```

**Proof via simulation** (replicated exact schema in Python `sqlite3`):

```
=== Testing new filter (market_code = ? OR market = ?) ===
  ❌ FAILED: no such column: market_code

=== Testing legacy filter (market = ?) ===
  returned 0 rows   ← works fine

=== market_news columns ===
  id, title, content, summary_ar, summary_en, source, source_type, url,
  tickers, importance, sentiment, impact_type, market, image_paths,
  ocr_text, raw_analysis, published_at, fetched_at, sent_at, is_sent, is_catalyst
  → NO `market_code` column
```

Because the GET handler is wrapped in `try { ... } catch (error: any) { return NextResponse.json({ error: 'internal_error' }, { status: 500 }); }` (lines 201-204), the user-facing behavior is:

- **Before fix**: `GET /api/news?market=EGX` returned 200 with 0 news (filter never matched `'general'`)
- **After fix**: `GET /api/news?market=EGX` returns **500 `internal_error`** (filter crashes on missing column)
- `GET /api/news` (no `market` param) still works — no `market_code` reference in the SQL.

This is a **regression** for any caller that passes `?market=...`.

#### 1.3 Migration script also doesn't add `market_code`

`/home/z/my-project/scripts/migrate-news-table.py` (lines 36-58) creates `market_news` with the SAME schema (no `market_code` column). Worse, it reads `market_code` from the legacy `news_articles` table (line 70) but then **throws the value away** by mapping to `market_val = market or market_code or 'EGX'` (line 98) and inserting into the `market` column (line 112). The `market_code` value is lost in migration.

#### 1.4 POST handler never writes `market_code`

Even if a separate `ALTER TABLE market_news ADD COLUMN market_code` were run, the POST handler at `route.ts:211-336` does NOT populate the column:

- Body destructure (lines 226-244): has `market`, but **no `market_code` field** expected from agent
- INSERT statement (lines 277-299): inserts into `market` column only, no `market_code`

So new articles arriving via POST will have `market_code = NULL`, and the new filter `(market_code = ? OR market = ?)` will only match via the fallback `market = ?` clause.

#### 1.5 news-agent never sets `market_code`

A `rg "market_code"` search across `/home/z/my-project/news-agent/**` returned **0 files**. The news-agent Python service never writes a `market_code` field in its payloads to `/api/news/agent`.

#### 1.6 Other news endpoints NOT fixed

The fix was applied only to `/api/news/route.ts`. The other news-listing routes still use the broken legacy `market = ?` filter:

| Route | Filter column | Status |
|---|---|---|
| `/api/news/route.ts` (GET) | `(market_code = ? OR market = ?)` | ⚠ Will crash at runtime |
| `/api/news/latest/route.ts:78` | `market = ?` | ❌ Not fixed |
| `/api/mobile/news/route.ts:102` | `market = ?` | ❌ Not fixed |
| `/api/admin/news/route.ts` | no market filter | n/a (only `search`/`source`/`min_importance`) |
| `/api/news-feed/route.ts` | in-memory category filter | n/a (different filter design) |

#### 1.7 Frontend NewsFeedView EGX filter STILL BROKEN

Round 1 finding §7.12 documented that `src/modules/news/components/NewsFeedView.tsx` (lines 694-696) uses source-string matching:

```ts
if (marketFilter === 'EGX') {
  list = list.filter(
    (n) => n.category === 'egx' || n.source.includes('مصر') || n.source.includes('EGX') || n.source.includes('البورصة')
  );
}
```

This is **still present at lines 694-696** in the current code — verified by `rg "EGX" src/modules/news/components/NewsFeedView.tsx` (lines 694-696, 796, 804, 811). No fix applied. Source names ("AlphaVantage", "GNews", "news_agent") never contain `مصر`/`EGX`/`البورصة` substrings, so the EGX tab will still return empty.

#### 1.8 Verdict

The Round 1 finding is **NOT effectively fixed**. The change at the SQL level is present, but:

1. **Schema is missing the `market_code` column** → 500 error on `?market=EGX`
2. **POST handler doesn't populate `market_code`** even if column existed
3. **Migration script drops `market_code`** during table copy
4. **news-agent never sets `market_code`** in its payload
5. **Other endpoints unchanged** (`/news/latest`, `/mobile/news`)
6. **Frontend filter unchanged** (still source-string matching)

**Required follow-up fix** (out of scope for this audit — research only):
1. Add `ALTER TABLE market_news ADD COLUMN market_code TEXT` to `ensureNewsTable()` (idempotent).
2. Update POST INSERT statement to write `market_code` (extract from body or normalize from `market`).
3. Backfill: `UPDATE market_news SET market_code = market WHERE market_code IS NULL`.
4. Update `/api/news/latest/route.ts` and `/api/mobile/news/route.ts` to use the same `(market_code = ? OR market = ?)` pattern.
5. Update `NewsFeedView.tsx` to pass `?market=EGX` server-side instead of client-side source-string filter.
6. Update `news-agent` payloads to include `market_code` derived from the collector source.

---

### #2 — 0 Articles Tagged EGX ⚠ TRIVIALLY TRUE (DB EMPTY)

**Round 1**: 4,428 articles in `market_news`, all with `market = 'general'` → 0 EGX.

**Round 2 verification**:

```
$ ls -la db/news.db
-rw-r--r-- 1 z z 0 Oct 9 18:19 ./db/news.db   ← 0 bytes!
```

The `db/news.db` file is now **empty (0 bytes)** — created Oct 9 18:19, no tables. After sandbox reset #2 (commit `aca19f9`), the news.db was NOT re-installed (only stocks/predictions DBs were restored per the worklog). It would be auto-created on first POST to `/api/news` via `ensureNewsTable()` — but news-agent is not running, so no POSTs happen.

**Practical impact**: News feed endpoint returns `{news: [], total: 0}` — the EGX filter bug (§1.2) cannot be exercised until at least one row exists. But the schema bug means it WILL crash on first use once data arrives.

---

### #3 — 84% from AlphaVantage ⚠ NO DATA (DB EMPTY)

**Round 1**: 3,736/4,428 = 84% AlphaVantage (foreign US/global news).

**Round 2 verification**: DB is 0 bytes — no articles to count. The AlphaVantage scraper (`data_engine/scrapers/news_scraper.py:294`) is still present and would re-populate with foreign news if `data_engine/main.py` runs. No P0 fix applied to filter AlphaVantage articles by EGX relevance.

---

### #4 — news-agent never runs (no cron) ❌ NOT FIXED

**Round 1**: `crontab.txt` (201 lines, 23 entries) had ZERO entries for news collection.

**Round 2 verification**:

```
$ wc -l crontab.txt
201 crontab.txt

$ rg -i "news|agent" crontab.txt
(no matches)
```

Still **0 entries** for news-agent or any news collector. The news collection pipeline is fully dormant. This is the root cause of finding #2 (DB empty) — no service ever writes to it.

---

### #5 — 3 Broken RSS Sources ❌ NOT FIXED

**Round 1**: argaam, amwal, youm7 return HTML instead of RSS (per `/api/admin/news-health` hardcoded list).

**Round 2 verification** at `/home/z/my-project/src/app/api/admin/news-health/route.ts` (lines 52-55):

```ts
const KNOWN_BROKEN_SOURCES: Array<{ source: string; reason: string }> = [
  { source: 'argaam', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
  { source: 'amwal', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
  { source: 'youm7', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
];
```

Same 3 sources still hardcoded as broken. No scraper replacement or RSS-to-HTML migration done.

---

### #6 — Hardcoded Windows Path ❌ NOT FIXED

**Round 1**: `news-agent/collectors/scrappers/marketmaker_news_scraper.py:9` has `OUTPUT_PATH = 'D:\\My WebStie Applications\\news_agent\\data\\marketmaker_news.json'`.

**Round 2 verification** at line 9:

```python
OUTPUT_PATH = 'D:\\My WebStie Applications\\news_agent\\data\\marketmaker_news.json'
```

Same hardcoded Windows path. Will fail on Linux VPS with `FileNotFoundError: [Errno 2] No such file or directory: 'D:\\My WebStie Applications\\news_agent\\data\\marketmaker_news.json'`.

---

### #7 — V40_2_NEWS_IMPACT=0 (disabled) ❌ NOT FIXED

**Round 1**: `vps-service/jobs/daily_predictor.py:2247` uses `os.environ.get('V40_2_NEWS_IMPACT', '0') == '1'` — default OFF.

**Round 2 verification** at lines 2244-2247:

```python
# Toggle: V40_2_NEWS_IMPACT=1 (default OFF للـ backtest)
if os.environ.get('V40_2_NEWS_IMPACT', '0') == '1':
    from analyzers.news_fetcher_analyzer import get_news_with_impact
    ...
```

Default `'0'` unchanged. No `.env` file in the repo sets `V40_2_NEWS_IMPACT=1`. News impact on V40.2 predictions remains disabled.

---

## Additional Findings (New in Round 2)

### A1 — `news_signals` table still missing in `predictions.db`

Round 1 documented that `/api/news-feed/route.ts` and `/api/admin/news/route.ts` DELETE handler reference `predictions.db.news_signals`, which doesn't exist.

**Round 2 verification**:

```python
$ python3 -c "import sqlite3; db=sqlite3.connect('db/predictions.db'); print([r[0] for r in db.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()])"
['predictions', 'sqlite_sequence', 'stored_analyses', 'prediction_lessons']

$ python3 -c "import sqlite3; db=sqlite3.connect('db/predictions.db'); db.execute('SELECT * FROM news_signals LIMIT 1')"
sqlite3.OperationalError: no such table: news_signals
```

Still missing. Both routes silently fail when querying `news_signals` (try/catch hides the error). DELETE by `id` on `/api/admin/news` will also crash on row lookup.

### A2 — Migration script destroys `market_code` data

`scripts/migrate-news-table.py` (lines 67-113) reads `market_code` from the legacy `news_articles` table, but writes only to the `market` column of `market_news`. If/when the legacy DB is re-imported, all `market_code` values will be lost. This blocks any future backfill that would set `market_code` from the original article metadata.

### A3 — `/api/admin/news/route.ts` schema drift

`/api/admin/news/route.ts` (lines 78-101) defines `market_news` with `importance INTEGER DEFAULT 50` — different from `/api/news/route.ts:74` (`importance INTEGER DEFAULT 0`). Whichever route is invoked first wins the schema; subsequent ALTERs are silently skipped by `CREATE TABLE IF NOT EXISTS`. Can cause inconsistent default importance values.

### A4 — Team 7's Round 2 verification missed the schema bug

Team 7's `audit-reports/round2/team-7-multi-market.md` (row #2) marked the news filter as ✅ FIXED, but only verified the SQL change at lines 129-135. They did NOT verify:
- That the `market_code` column actually exists in the table schema
- That the POST handler writes `market_code`
- That the migration script preserves `market_code`

Their note "Cannot verify production data (news.db missing in sandbox after reset)" is misleading — the schema bug is verifiable from the `CREATE TABLE` DDL alone, regardless of whether the DB has data. This audit supersedes Team 7's finding on this specific item.

---

## Summary Statistics

| Metric | Round 1 | Round 2 | Change |
|---|---|---|---|
| Articles in `news.db` | 4,428 | **0** (empty file) | ↓ Sandbox reset wiped DB |
| Articles tagged EGX (`market='EGX'` or `market_code='EGX'`) | 0 | 0 (trivially) | — |
| News filter uses `market_code` in SQL | ❌ No | ✅ Yes (route.ts only) | ↑ Code change |
| Filter works at runtime | n/a | ❌ No (missing column → 500) | ↓ REGRESSION on `?market=` queries |
| `market_code` column exists in schema | n/a | ❌ No | — |
| POST handler writes `market_code` | n/a | ❌ No | — |
| news-agent produces `market_code` field | ❌ No | ❌ No | — |
| Cron entries for news collection | 0 | 0 | — |
| Broken RSS sources hardcoded | 3 | 3 | — |
| Hardcoded Windows path in scraper | 1 | 1 | — |
| `V40_2_NEWS_IMPACT` env default | `'0'` | `'0'` | — |
| News endpoints with old `market = ?` filter | n/a | 2 (`/news/latest`, `/mobile/news`) | — |
| Frontend EGX filter uses source-string matching | Yes | Yes | — |
| `news_signals` table in `predictions.db` | Missing | Missing | — |

---

## Recommendations (Out of Scope — Research Only)

### P0 — Make the fix actually work

1. **Add `market_code` column to schema**:
   - In `ensureNewsTable()` (`/api/news/route.ts:62-92`): add `market_code TEXT` column to CREATE TABLE.
   - In `migrate-news-table.py` (lines 36-58): add `market_code TEXT` column.
   - In `/api/admin/news/route.ts` (lines 78-101): same.
2. **ALTER for existing DBs** (idempotent): wrap `ALTER TABLE market_news ADD COLUMN market_code TEXT` in try/catch like the existing `is_catalyst` ALTER.
3. **Backfill**: `UPDATE market_news SET market_code = market WHERE market_code IS NULL;` (since `market` default is now `'EGX'`, this is a safe one-time migration).
4. **Update POST INSERT** at `/api/news/route.ts:277-299` to include `market_code` (extract from body, fallback to `market`).
5. **Update news-agent** to populate `market_code` based on the collector's source market (e.g., telegram_collector → `'EGX'`, crypto_news_fetcher → `'CRYPTO'`).

### P0 — Schedule news-agent

Add cron entry to `crontab.txt`:
```
*/15 * * * * cd /home/z/my-project/news-agent && .venv/bin/python3 main.py --once >> /tmp/news_agent.log 2>&1
```

### P0 — Fix the Windows hardcoded path

Change `marketmaker_news_scraper.py:9` to use `config/paths.py` constant or `os.path.join(BASE_DIR, 'data', 'marketmaker_news.json')`.

### P1 — Unify the filter across all news endpoints

Apply the same `(market_code = ? OR market = ?)` pattern to:
- `/api/news/latest/route.ts:78`
- `/api/mobile/news/route.ts:102`
- `/api/admin/news/route.ts` (add a market filter)

### P1 — Fix the frontend EGX filter

Replace the source-string matching in `NewsFeedView.tsx:694-696` with passing `?market=EGX` to the API and letting the server filter via `market_code`.

### P1 — Replace broken RSS sources

Replace argaam, amwal, youm7 with HTML scrapers (since they return HTML not RSS).

### P2 — Enable V40_2_NEWS_IMPACT

Set `V40_2_NEWS_IMPACT=1` in production env once news collection is restored and articles have sentiment/importance populated.

---

## Conclusion

The Round 1 finding "News filter broken" was **addressed at the SQL-string level only**, but the fix is **broken at runtime** because the `market_code` column referenced in the WHERE clause does not exist in the `market_news` schema. This is a regression: any `GET /api/news?market=EGX` call will now return HTTP 500 instead of HTTP 200 with 0 articles.

**Highest-impact action**: Add `market_code TEXT` column to the `CREATE TABLE market_news` statement in `ensureNewsTable()` (and the migration script), then backfill `UPDATE market_news SET market_code = market`. Without this, the "fix" is non-functional.

Team 7's Round 2 report flagged this item as ✅ FIXED — this audit supersedes that finding with the schema-mismatch evidence.

The other 6 Round 1 findings remain unfixed. The news system is **dormant**: no cron, no agent runs, DB is empty, no articles to display. The entire news UI shows nothing for users.

---

**End of Round 2 News Audit**
