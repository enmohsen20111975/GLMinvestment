# Team 9: Integration & Workflow Audit

**Task ID**: TEAM-9-INTEGRATION
**Date**: 2026-10-09
**Scope**: Cross-cutting data flow, consistency, end-to-end workflows, service communication, caching, error propagation
**Method**: Static code inspection + live API probes (curl) against running Next.js at `:3000`. Python backend (`:8010`), WebSocket service (`:3005`), and Telegram events service (`:3003`) were observed DOWN during the audit (see `/api/health` snapshot below), which actually made the error-propagation half of the audit much easier to verify.

```json
{
  "status": "degraded",
  "components": {
    "nextjs":            {"status": "ok"},
    "python-backend":    {"status": "down", "port": 8010, "reachable": false},
    "ws-service":        {"status": "down", "port": 3005, "reachable": false},
    "telegram-events":   {"status": "down", "port": 3003, "reachable": false},
    "news-agent":        {"status": "ok"},
    "databases": {
      "stocks.db":       {"rows": 1039},
      "predictions.db":  {"rows": 9339, "latest": "2026-06-25"},
      "price_history.db":{"rows": 274574, "latest_date": "2026-06-10"},
      "data_engine.db":  {"rows": 2205, "latest": "2026-06-24"},
      "intraday.db":     {"size_mb": 74},
      "auth.db":         {"rows": 3}
    }
  }
}
```

> Note on stale data: every "live" DB snapshot shows the last write happened in **June 2026** — over 3 months ago. The audit therefore had no fresh pipeline to observe end-to-end. Findings about "stale-data risk" below are not theoretical; they are the current production state of this sandbox.

---

## 1. Data Flow Map

### 1.1 Stock prices

```
                  Python scrapers (vps-service/data/*.py)
                  ├─ egx_fetcher.py        → EGX EOD
                  ├─ egksco_scraper.py     → TADAWUL
                  ├─ enhanced_multi_market → KSE/QSE/DFM
                  └─ crypto_fetcher.py     → CoinGecko
                              │
                              ▼
                   data_engine.db (stocks, stock_prices)
                              │
                              ▼
        Python /api/stocks/{ticker} (port 8010) ─────────┐
                              │                          │
                              ▼                          ▼
              Next.js /api/stocks/[ticker]      Next.js /api/stocks/[ticker]/unified
              (proxy + injectUnifiedData)       (canonical, SQLite-only)
                              │                          │
                              └──────► React UI ◄────────┘
```

**Verified findings**:
- `unified-stock-data.ts:265-684` opens `stocks.db` (readonly) and reads the `stocks` row, `stock_daily_prices` history (last 30 rows), `predictions.db` (latest prediction), and `scripts/output/maker_radar_<MARKET>_<YYYYMMDD>.json` (radar cache).
- The Python backend is the **upstream** writer of `stocks.db`, but the Next.js side reads it directly (without going through Python). When Python is down, `getUnifiedStockData()` still works because it opens the SQLite file directly.
- `data_engine.db.stock_prices` (different table from `stocks.db.stock_daily_prices`) is the **intraday** store, but is NOT consumed by the unified stock module — it's only used by `data-engine/*` routes.

### 1.2 Predictions

```
   Python vps-service/jobs/daily_predictor.py (cron: 03:00 + 13:30 UTC, Sun–Thu)
                              │
                              ▼
                   predictions.db.predictions  (single source of truth)
                              │
            ┌─────────────────┼──────────────────────┐
            ▼                 ▼                      ▼
   /api/predictions/    /api/stocks/[ticker]/     /api/stocks/[ticker]/
   honest-tracking/list  unified (canonical)       comprehensive
```

**Verified findings**:
- Cron entries in `crontab.txt` reference `/root/GLMinvestment` (production path) — **never rewritten for this sandbox** (no `/home/z/my-project/.venv` venv, no crontab installed). Result: predictions.db stops at 2026-06-25.
- `unified-stock-data.ts:312-388` queries `predictions` with a 48-hour freshness filter (line 514) and falls back to `stored_analyses` table if no fresh row exists. The fallback writes `status: 'stored_analysis_fallback'` (line 379) so callers can detect the degraded path.

### 1.3 News

```
   Python vps-service/ai/news_agent.py (rss + telegram + web)
                              │
                              ▼
                Next.js /api/news  (POST)  ──►  news.db.market_news
                              │                       │
                              ▼ (non-blocking)        ▼
                  Python /api/news/agent (V40.2    React UI
                  impact scoring)              (/api/news GET)
```

**Verified findings**:
- `/api/news` (POST) at `src/app/api/news/route.ts:207-332` is the canonical ingest. It writes `market_news` in news.db (line 273) and asynchronously forwards to Python `/api/news/agent` for impact scoring (line 305).
- News agent process (PID 20414 / 16258 — actually observed alive in `/api/health`) is the only Python-side component that stays up. The actual News Agent binary at `/app/.venv/bin/python main.py` (PID 921) appears to be running but on its own (not the full VPS service).
- The forward-to-Python call uses `.catch(() => {})` (line 315) — a **fire-and-forget** that silently swallows all errors. If Python is down, no impact scores are written; news is stored without `importance` or `is_catalyst` flags being updated.
- `/api/stocks/[ticker]/news` reads `news.db.market_news` filtered by the JSON `tickers` column. **Live test: 0 news tagged for COMI** — even though 4428 news rows exist. The ticker-tagging pipeline is broken upstream (news_agent stores tickers as `'[]'`).

### 1.4 Gold / metals prices

```
   Python data/multi_source_metals_fetcher (Daleelak API)
                              │
                              ▼
                  data_engine.db.gold_prices
                  data_engine.db.silver_prices
                  data_engine.db.exchange_rates
                              │
                              ▼
                  Next.js /api/metals/gold
                  Next.js /api/data-engine/gold
                              │
                              ▼
                       React UI (Gold widget)
```

**Verified findings**:
- `/api/metals/gold/route.ts:58-215` reads `gold_prices` table where `timestamp = MAX(timestamp)` and partitions by `karat` string matching (`'gold-24k'`, `'gold-21k'`, etc.).
- **Bug**: line 133 looks for `karat.toLowerCase() === 'gold-24k'` to populate `gold_ounce`. Live data has `karat='24'` (numeric) for some entries (e.g. الأردن/الإمارات) and `'gold-24k'` for others — the strict match fails and **`gold_ounce` returns null** for COMI-style cases. (Verified: response shows `gold_ounce: null`.)
- Gold data is 3+ months stale (last update 2026-06-24). The route still reports `is_live: true` (line 174) — no staleness detection.

---

## 2. Consistency Check (COMI, SWDY, ETEL)

Probed live (Python backend down) on 2026-10-09 13:39 UTC. All four endpoints returned HTTP 200, but with **field-level inconsistencies**:

### 2.1 Field comparison table (COMI, representative)

| Field                      | `/api/stocks/COMI` (proxy+inject) | `/api/stocks/COMI/unified` | `/api/stocks/COMI/comprehensive` | `/api/stocks/COMI/expert-analysis` |
|----------------------------|-----------------------------------|----------------------------|----------------------------------|------------------------------------|
| `current_price`            | 132.5                             | 132.5                      | 132.5                            | — (not at top level)               |
| `rsi`                      | **50**                            | **null**                   | **null**                         | `{value:null, signal:'NO_DATA'}`   |
| `rsi_source`               | **"null"**                        | "null"                     | (not exposed)                    | —                                  |
| `signal`                   | null                              | null                       | null                             | `recommendation: 'HOLD'`           |
| `signal_ar`                | "— لا يوجد توقع طازج"             | "— لا يوجد توقع طازج"      | "— لا يوجد توقع طازج"            | "انتظار"                           |
| `master_score` (canonical) | null                              | null                       | null                             | —                                  |
| `master_score` (prediction) | 48 (closed)                       | 48                         | — (in `prediction` block)        | `confidence: 48`                   |
| `entry_price`              | 137.86                            | 137.86                     | 137.86                           | 137.86 (inside `analysis.entry`)   |
| `target_price`             | 130.99                            | 130.99                     | 130.99                           | 130.99                             |
| `stop_loss`                | 143.37                            | 143.37                     | 143.37                           | 143.37                             |
| `prediction_date`          | 2026-06-10                        | 2026-06-10                 | 2026-06-10                       | (not exposed)                      |

### 2.2 Critical consistency bugs found

#### Bug 2.2.1 — `/api/stocks/[ticker]` returns **internally contradictory RSI**

`GET /api/stocks/COMI` returns:
```json
{ "rsi": 50, "rsi_source": "null" }
```

The value (50) is the precomputed `stocks.db.stocks.rsi` column preserved by `injectUnifiedData`:
```ts
// src/app/api/stocks/[ticker]/route.ts:117-118
next.rsi = unified.technical.rsi ?? next.rsi;   // null ?? 50 → 50
next.rsi_source = unified.technical.rsi_source; // forced to "null"
```
The `rsi_source` is **forced** to `"null"` (the canonical module couldn't compute a fresh Wilder RSI because price history only has 11 days, fewer than the 14-period minimum). But the value 50 from Python's precomputed column is still served. The result: a UI showing `RSI = 50` next to a `rsi_source = "null"` tag — which the frontend cannot interpret reliably.

The canonical sibling route `/api/stocks/COMI/unified` returns `rsi: null, rsi_source: "null"` (consistent). So **the same number means different things on different screens**.

#### Bug 2.2.2 — `/api/stocks/[ticker]/expert-analysis` produces a real signal even when canonical says "no fresh prediction"

`src/app/api/stocks/[ticker]/expert-analysis/route.ts:74-75`:
```ts
signal: canonical.signal || prediction.signal,
master_score: canonical.master_score || prediction.master_score,
```

When canonical is null (because prediction is stale > 48h, Rule 20), the route **falls back to the stale `prediction.signal`** and recomputes a recommendation from the stale score. Live evidence:
- `/api/stocks/SWDY/expert-analysis` → `recommendation: "BUY"`, `confidence: 65.7`
- `/api/stocks/SWDY/unified` → `signal: null`, `signal_ar: "— لا يوجد توقع طازج"`

The user sees **BUY** on the expert-analysis screen and **"no fresh prediction"** on every other screen — for the same stock in the same second. This is exactly the kind of inconsistency Rule 20 + Rule 67 (UNIFIED-DATA-CONTRACT) was meant to prevent.

#### Bug 2.2.3 — `signal` field has 3 different representations across endpoints

| Endpoint                         | `signal` shape                          |
|----------------------------------|-----------------------------------------|
| `/api/stocks/[ticker]`           | `null` (SignalType \| null)             |
| `/api/stocks/[ticker]/unified`    | `null` (canonical.signal)               |
| `/api/stocks/[ticker]/comprehensive` | `null` (technical.signal)             |
| `/api/stocks/[ticker]/expert-analysis` | `"HOLD"` (string, capitalized)    |
| `/api/stocks?market=EGX` (list)  | `0` (numeric — raw `stocks.signal` column) |

The list endpoint returns `signal: 0` (a numeric SQLite column) while the detail endpoints return either `null` or `"HOLD"` (string). Frontend code that switches on `typeof signal` will hit different branches depending on which endpoint it consumes.

#### Bug 2.2.4 — `/api/stocks/[ticker]/publish-data` uses **camelCase** field names

```
GET /api/stocks/COMI/publish-data →
  data: { ticker, nameAr, nameEn, sector, currentPrice, previousClose,
          changePct, entryPrice, rsi, sma50, sma200, peRatio, pbRatio,
          roe, marketCap, market }
```

Every other endpoint uses snake_case (`current_price`, `entry_price`, `change_percent`). The publisher consumer has to know both shapes. This is documented as a "StockPublishData JSON" contract but the asymmetry is an integration smell — the publish-data route was written separately from the unified data contract and never migrated.

#### Bug 2.2.5 — `/api/stocks` list returns **invalid support/resistance** values

`GET /api/stocks?market=EGX&page_size=1` returns:
```json
{ "ticker":"ASCM", "current_price":60.31, "support":125.81, "resistance":144.75 }
```
Support (125.81) is **2× the current price** (60.31). A support level above the current price is mathematically meaningless — it indicates either stale DB data or a pre-computation that never re-synced after a price drop. The API passes it through to the UI without validation.

---

## 3. Canonical Source Verification

### 3.1 Is `src/lib/unified-stock-data.ts` truly the single source?

**Partially.** The module is *intended* as the canonical source (header comment Rule 67 + Rule 72) and is **imported by 5 routes**:

| Route                                                  | Imports `getUnifiedStockData`? | Truly uses canonical values? |
|--------------------------------------------------------|-------------------------------|------------------------------|
| `/api/stocks/[ticker]`                                 | ✅                            | ❌ (see Bug 2.2.1 — preserves Python's stale RSI) |
| `/api/stocks/[ticker]/unified`                         | ✅                            | ✅ clean canonical response |
| `/api/stocks/[ticker]/comprehensive`                   | ✅                            | ✅ overrides sub-engine signals (board/maestro/professional/hunter) |
| `/api/stocks/[ticker]/expert-analysis`                 | ✅                            | ❌ (see Bug 2.2.2 — falls back to stale prediction.signal) |
| `/api/stocks/[ticker]/recommendation`                  | ✅                            | ✅ injects canonical overrides |
| `/api/stocks/[ticker]/publish-data`                    | ✅ (imported)                 | ❌ returns camelCase shape, doesn't apply overrides consistently |
| `/api/stocks/[ticker]/professional-analysis`           | ❌                            | N/A — returns 410 Gone (deprecated) |

### 3.2 Competing sources per data type

| Data type        | Canonical source                         | Competing sources                                                                  |
|------------------|------------------------------------------|-------------------------------------------------------------------------------------|
| Price (live)     | `stocks.db.stocks.current_price` (unified-stock-data.ts:481) | `data_engine.db.stock_prices` (used by /api/data-engine/stocks); Python `/api/stocks/{ticker}` response field `current_price` |
| RSI              | `canonical-rsi.ts:computeRSI` (Wilder, period 14, fresh from `stock_daily_prices` last 30 rows) | `stocks.db.stocks.rsi` (precomputed by Python — sometimes 50, sometimes null); Python backend `/api/stocks/{ticker}?include=rsi` |
| Signal           | `unified-stock-data.ts:535` `canonicalSignal = masterScore !== null ? classifySignal(masterScore) : null` | `stocks.db.stocks.signal` (numeric 0..N); Python `/api/professional-analysis/{ticker}`; expert-analysis.ts `recommendation` string |
| Master score     | `predictions.db.predictions.master_score` filtered by `prediction_date <= 48h` | `stored_analyses.maestro_score` (fallback in unified-stock-data.ts:356); `stocks.db.stocks.signal` (sometimes used as proxy) |
| Support/Resistance | `unified-stock-data.ts:computeSupportResistance` (min/max of last 20 days' lows/highs) | `stocks.db.stocks.support`/`.resistance` (stale precomputed values — see Bug 2.2.5) |

### 3.3 Verdict

`unified-stock-data.ts` is **the canonical accessor** but it is **not yet the single source** — there are at least 4 routes that still read raw DB columns or Python responses without applying its overrides. The migration was started (Rule 67) but not completed.

---

## 4. End-to-End Workflows

### Workflow 1 — User opens stock → sees analysis

```
User clicks "COMI"
   │
   ├──► GET /api/stocks/COMI                  (200, sqlite_fallback + injectUnifiedData)
   ├──► GET /api/stocks/COMI/unified          (200, canonical)
   ├──► GET /api/stocks/COMI/comprehensive    (200, errors: ["deep-analysis: fetch failed","professional: fetch failed"])
   ├──► GET /api/stocks/COMI/expert-analysis  (200, BUY signal — conflicts with unified's null)
   ├──► GET /api/stocks/COMI/history          (404 — broken SQLite fallback, see §4.1)
   ├──► GET /api/stocks/COMI/news             (200, source:sqlite_fallback, 0 news — ticker-tagging broken)
   ├──► GET /api/stocks/COMI/recommendation    (200, source:sqlite_fallback_empty)
   └──► WebSocket subscribe:ticker (COMI)     (fails silently — WS service down)
```

**Broken links**:
1. `/api/stocks/COMI/history` returns 404 even though SQLite has 11 rows for COMI (Bug 4.1 below).
2. The 4 detail endpoints disagree on `signal` (Bug 2.2.2, 2.2.3).
3. News tab shows nothing for COMI (ticker-tagging pipeline broken).
4. WebSocket updates silently disabled — UI falls back to REST polling but doesn't tell the user.

#### Bug 4.1 — History endpoint SQLite fallback references non-existent columns

`src/app/api/stocks/[ticker]/history/route.ts:50-61`:
```sql
SELECT price_date as date,
       COALESCE(open, open_price) as open,    -- ← open_price doesn't exist
       COALESCE(high, high_price) as high,    -- ← high_price doesn't exist
       COALESCE(low, low_price) as low,       -- ← low_price doesn't exist
       COALESCE(close, close_price) as close, -- ← close_price doesn't exist
       COALESCE(volume, 0) as volume
FROM stock_daily_prices
WHERE ticker = ?
```

Verified schema: `stock_daily_prices(id, ticker, price_date, open, high, low, close, volume, change_percent, fetch_time)`. There is **no** `open_price`/`high_price`/`low_price`/`close_price` column. SQLite throws `no such column: open_price` (reproduced locally), the catch block fires, the route returns 404 — even though the table has 11 rows for COMI.

There is a **separate** `stock_price_history` table (used by `portfolio/holdings`, `bag-holder-rescue`, `data-sync.ts`) that DOES use the `_price` suffix. The history route mixes the two schemas.

### Workflow 2 — Daily prediction runs → appears in UI

```
Cron (03:00 UTC, Sun–Thu) → vps-service/jobs/daily_predictor.py --today-only
   │
   ▼
predictions.db.predictions (INSERT new rows with prediction_date = today)
   │
   ▼
GET /api/predictions/daily-picks?market=EGX  → reads predictions WHERE market='EGX' ORDER BY prediction_date DESC
   │
   ▼
React PredictionsTab / DailyPicksPoster
```

**Broken links**:
1. **Cron is not installed** on this sandbox (`crontab -l` is empty; `crontab.txt` references `/root/GLMinvestment`). Latest prediction in DB is 2026-06-25 → 3+ months stale.
2. With no fresh predictions, `/api/predictions/daily-picks` returns `picks: []` with `source: 'error-fallback'` and an Arabic message about predictions being generated for EGX first. The UI shows an empty state — graceful but unhelpful (no "last ran X hours ago" diagnostic).
3. The daily-picks route tries Python first (5s timeout) then falls back to SQLite. When Python is down, the SQLite fallback works for the listing itself — but if the DB query throws, the outer catch returns `source: 'error-fallback'` (route.ts:293) with HTTP 200 and an empty array. **The error is silently swallowed**.

### Workflow 3 — News scraped → appears in UI

```
Python news_agent (RSS / Telegram channel / Web)
   │
   ▼
POST /api/news  (writes news.db.market_news + forwards to /api/news/agent)
   │
   ▼
GET /api/news  (filter by market, catalyst, tickers)
   │
   ▼
React NewsFeedView
```

**Broken links**:
1. **Ticker-tagging is broken**: 4428 news rows in `news.db.market_news`, but **0 rows have any ticker** in the `tickers` JSON column (verified: `SELECT tickers FROM market_news WHERE tickers LIKE "%COMI%"` returns 0 rows). This means `/api/stocks/COMI/news` always returns 0 items.
2. The Python forward call (`/api/news/agent`) at `src/app/api/news/route.ts:305-315` uses `.catch(() => {})` — when Python is down (the current state), no impact scores are written. News is stored without `importance` or `is_catalyst` flags being set. The UI's "High-Impact Catalysts" filter (`/api/news?catalyst=true`) will return 0 results even if catalysts exist, because the flag was never set.
3. The news table has a `market` column but **4428 of 4428 rows** have `market='general'` (verified). So filtering by `market=EGX` returns nothing. The news_agent is not classifying news by market.

### Workflow 4 — Admin publishes to Telegram

```
Admin clicks "Publish" in StockPublisher
   │
   ├──► POST /api/telegram/publish-stock  (multipart/form-data with image)
   │       │
   │       ├──► Telegram Bot API: https://api.telegram.org/bot{TOKEN}/sendPhoto
   │       │    (or sendMessage fallback)
   │       │
   │       └──► predictions.db: UPDATE predictions SET published_at=NOW(),
   │                                    telegram_message_id=?,
   │                                    was_published=1
   │                                    WHERE ticker=? AND date(prediction_date)=date('now')
   │
   └──► (alternate path) POST /api/telegram/post  → proxied to Python /api/telegram/post/{action}
                                                     (NO audit-trail write-back)
```

**Broken links**:
1. **Two parallel paths to Telegram**: `/api/telegram/publish-stock` (direct Bot API call from Node) and `/api/telegram/post` (proxy to Python). They use different code paths and only the Node-side one writes the audit trail (`was_published`, `published_at`, `telegram_message_id`) to predictions.db. If the admin uses the Python-proxied path, no audit record is created.
2. `publish-stock` returns 503 if `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHANNEL_ID` env vars are missing — but the response doesn't distinguish between "missing config" and "Telegram rejected the message". Admin gets a generic error.
3. The `UPDATE predictions ... WHERE date(prediction_date)=date('now')` clause assumes a fresh prediction exists for today. If the daily predictor hasn't run (current state — 3 months stale), `updated_rows = 0` and the response includes `audit_note: "no matching predictions found for today — publish succeeded but audit trail is empty"`. The publish technically succeeds but leaves no trace.
4. `requireAdminAsync(req)` (line 37) gates the route. Verified structure looks correct (admin-only), but no defense against the **race condition** where the admin clicks "Publish" twice rapidly — both calls hit Telegram Bot API; only one succeeds, but the DB write-back runs twice.

---

## 5. Service Communication

### 5.1 Node ↔ Python

`src/lib/python-backend.ts` is the canonical helper:

```ts
const getPythonBackendUrl = (): string => {
  // Priority: PYTHON_BACKEND_URL env → VPS_API_URL → ... → http://127.0.0.1:8010
  // IPv6 ::1 fix: replaces 'localhost' with '127.0.0.1' server-side
};
export const PYTHON_BACKEND_URL = getPythonBackendUrl();
export function pythonFetch<T>(path, options): Promise<{success, data?, error?}>
export async function checkPythonBackendHealth(): Promise<{healthy, latency?, error?}>
```

**Issue**: of the 133 source files in `src/app/api/**` that talk to Python:
- **66** import `PYTHON_BACKEND_URL` from `@/lib/python-backend` (canonical)
- **73** hardcode `http://127.0.0.1:8010` or `http://localhost:8010` directly (drift)

The 73 hardcoders bypass the IPv6 fix and the env-var override. In production where `PYTHON_BACKEND_URL` might point to a different host (VPS), those routes will still hit localhost.

### 5.2 Telegram service

- **Direct path**: `/api/telegram/publish-stock` → `https://api.telegram.org/bot${TOKEN}/sendPhoto` (or `/sendMessage`).
- **Proxy path**: `/api/telegram/[...path]` and `/api/telegram/post` → Python backend on `:8010/api/telegram/...`.
- **Telegram events service** (port 3003) is **DOWN** in this sandbox — `curl http://localhost:3003/health` returns nothing. This is the service that polls Telegram channel updates. The Next.js side doesn't appear to depend on it for the publish flow; it's a separate ingestion path.
- The Python vps-service/telegram/ package (15 modules: `auto_poster.py`, `telegram_notifier.py`, `telegram_interactive_bot.py`, etc.) is the heavy lifter — runs only when Python is up.

### 5.3 WebSocket service

`vps-service/ws-service/index.ts` — a standalone Node process on port 3005:

- **Polls** Python `/api/stocks?market=EGX&limit=100` (snapshot) and `/api/market/status` (status) on adaptive interval (2s during EGX session, 30s outside).
- **Polls** Python `/api/live/analysis/{ticker}` for each subscribed ticker (5s during session).
- **Push endpoint**: `POST /broadcast` — Python's `data_engine/sync.py` posts price updates, the service emits `ticker:update` to subscribers.
- **Emitted events**: `market:snapshot`, `market:status`, `ticker:update`, `ticker:live`, `stock:alert`.
- **Currently DOWN** — `curl http://localhost:3005/health` returns empty. The React `useRealtimeUpdates()` hook (src/lib/ws-client.ts) tries to connect, fails after `MAX_RECONNECT_ATTEMPTS = 1`, sets `globalConnectFailed = true`, and silently disables real-time updates. The UI falls back to REST polling (which is also broken because Python is down).

**Critical**: when WS is down, the client never tells the user. The `setIsConnected(false)` state is exposed via the hook but no UI element surfaces it.

---

## 6. Caching

### 6.1 Next.js segment caching (`revalidate`)

| Endpoint                              | `revalidate` | Implication                                                  |
|---------------------------------------|--------------|--------------------------------------------------------------|
| `/api/metals/gold`                    | 30s          | Gold prices can be 30s stale (acceptable)                    |
| `/api/market-pulse`                   | 0 + custom 10s in-memory cache + 5min stale-cache | Layered caching — fresh data preferred, stale served if Python down |
| `/api/stocks/[ticker]/unified`        | 0            | Always fresh                                                 |
| `/api/stocks/[ticker]/expert-analysis`| 0            | Always fresh                                                 |
| `/api/predictions/honest-tracking/list`| 0 + `Cache-Control: no-store` | Always fresh + bypasses CDN  |
| Most other routes                     | `force-dynamic` (no `revalidate`) | Always re-executes                              |

### 6.2 In-memory caches (per-process, lost on restart)

| Module                                  | Cache key                          | TTL      | Risk                                                          |
|-----------------------------------------|------------------------------------|----------|---------------------------------------------------------------|
| `src/lib/data-engine-db.ts:92`          | `market_stats:*`, `stocks_market:*`, `all_stocks:*`, `top_movers:*` | 60s      | Stale for up to 60s after a DB write                          |
| `src/lib/data-adapter.ts:71`            | adapter-level                      | 5min     | Long TTL — stale data risk for 5 minutes                     |
| `src/lib/market-data-access.ts:416`     | `yahoo:{symbol}`, `crypto:global`, `crypto:fng` | variable (e.g. COINGECKO_CACHE_TTL_MS) | Third-party API results cached; if API changes, stale for TTL |
| `src/lib/protection/display-protection.ts:47` | protection config             | 30s      | Acceptable                                                    |
| `src/lib/auth-helper.ts:33`             | analytics throttle                 | varies   | In-memory only                                                |
| `src/lib/metrics-collector.ts`          | metrics                            | varies   | In-memory only                                                |
| `src/lib/rate-limiter.ts`               | rate-limit counters                | sliding  | In-memory only — resets on restart, affects multi-instance  |

### 6.3 Cache invalidation strategy

- **No explicit invalidation API** — every cache simply expires by TTL.
- The WS service's `pollMarketData()` updates `lastMarketSnapshot` (in-memory) on every poll. When it emits `market:snapshot`, clients get the freshest data. But if WS is down, the REST endpoint `/api/market-pulse` serves from its own in-memory cache (10s TTL) — which is **stale by up to 10s + 5min stale-cache window**.
- **No cache-busting mechanism** for admin actions. When an admin manually triggers a prediction refresh (via `/api/admin/engine-control-room/regenerate`), the user-facing `/api/predictions/daily-picks` may still serve stale data for up to 60s (data-engine-db TTL) or 5min (data-adapter TTL) depending on which code path is hit.

### 6.4 Stale-data risks identified

1. **Production state**: every DB shows last write in June 2026 (3+ months stale). All "live" endpoints (`is_live: true` in /api/metals/gold, `is_trading_hours` in /api/market-pulse) report live status without checking data freshness. A user opening the app today sees June prices labeled as live.
2. `/api/market/overview` returns `last_updated: "2026-03-11"` for indices — 7 months stale — with no warning.
3. `/api/stocks?market=EGX` returns `change_percent: -2.25` for ASCM — but the underlying `last_update` timestamp for the stocks table is `2026-07-10`. The user sees a price change as if it happened today.

---

## 7. Error Propagation

### 7.1 When Python is down

| Endpoint                                       | Behavior observed (Python DOWN)                                    |
|------------------------------------------------|---------------------------------------------------------------------|
| `/api/health`                                  | Returns 200, status `"degraded"`, lists python-backend `down`       |
| `/api/stocks/[ticker]`                         | Returns 200 with `source: sqlite_fallback` + injectUnifiedData      |
| `/api/stocks/[ticker]/unified`                 | Returns 200 (canonical, SQLite-only — never needed Python)          |
| `/api/stocks/[ticker]/comprehensive`           | Returns 200 + `errors: ["deep-analysis: fetch failed","professional: fetch failed"]` + canonical section still populated |
| `/api/stocks/[ticker]/expert-analysis`         | Returns 200 (never queries Python)                                  |
| `/api/stocks/[ticker]/recommendation`          | Returns 200 + `source: sqlite_fallback_empty` + Arabic message     |
| `/api/stocks/[ticker]/news`                    | Returns 200 + `source: sqlite_fallback` + 0 news (ticker-tagging broken) |
| `/api/stocks/[ticker]/history`                 | **Returns 404** — Bug 4.1 (broken SQL fallback)                     |
| `/api/stocks/[ticker]/publish-data`            | Returns 200 + `errors: ['python: unreachable or empty', ...]` + minimal data |
| `/api/predictions/daily-picks`                 | Returns 200 + empty picks + Arabic message + `source: 'error-fallback'` |
| `/api/predictions/honest-tracking/list`        | Returns 200 + reads from SQLite (works without Python)               |
| `/api/market/status`                           | **Returns 503** — uses `marketPulseProxy` which has NO fallback     |
| `/api/market-pulse`                            | Returns 200 + `source: sqlite_fallback` (has its own fallback)     |
| `/api/market/overview`                         | Returns 200 + `source: stocks_db_market_indices`                    |
| `/api/market/top-movers`                       | Returns 200 + `source: sqlite_fallback` (stale data)               |
| `/api/data-status`                             | Returns 500 `internal_error`                                        |
| `/api/data-engine/status`                      | Returns 200 + `success:false, error: "Failed to get market status: no such table: egksco_price_history"` (mixed: 200 + error in body) |
| `/api/data-engine/health`                      | Returns 200 + per-DB status with `price_history: status:down`       |

**Summary**: Most routes degrade gracefully (HTTP 200 + reduced data + Arabic message). **Three routes fail hard** when Python is down:
- `/api/stocks/[ticker]/history` — 404 (broken SQL fallback)
- `/api/market/status` — 503 (proxy has no fallback)
- `/api/data-status` — 500 (internal_error)

### 7.2 When DB is down

Not directly testable in this sandbox (all DBs are up). Code review findings:

- `unified-stock-data.ts` opens `better-sqlite3` in readonly mode with `fileMustExist: true`. If `stocks.db` is missing → exception caught at line 288 → `stock` is null → function returns null at line 292 → caller gets `404 stock_not_found`. **Graceful.**
- `predictions.db` failure (line 388): caught and logged; the function continues with `prediction = null`. **Graceful.**
- `/api/news` (route.ts:123): `new Database(DB_PATH, { readonly: true })` — if news.db missing → exception → catch at line 197 → returns 500 `internal_error`. **Hard fail** — no fallback to Python.
- `/api/metals/gold` (route.ts:59): `new Database(dbPath, { readonly: true, timeout: 5000 })` — if data_engine.db missing → catch at line 206 → returns 500. **Hard fail.**

### 7.3 Graceful degradation summary

| Component failure         | UI impact                                                                  |
|---------------------------|-----------------------------------------------------------------------------|
| Python backend down       | Most stock screens work (SQLite fallback); some endpoints 404/503/500      |
| WebSocket down            | UI silently falls back to REST polling; no user notification                |
| Telegram events down      | Publish flow still works (direct Bot API); channel ingestion stops          |
| News agent down           | No new news ingested; existing news still served                            |
| stocks.db missing         | All stock routes return 404; unified-stock-data returns null                |
| predictions.db missing    | Stock routes still work; canonical signal becomes null; predictions empty  |
| news.db missing           | /api/news returns 500                                                       |
| data_engine.db missing    | /api/metals/gold returns 500; gold prices unavailable                      |

---

## Critical Integration Issues

Ranked by user-visible impact:

### C1. **Prediction pipeline completely stalled** (P0)
- Latest prediction in `predictions.db` is 2026-06-25 — **3+ months stale**.
- Cron not installed (crontab.txt references `/root/GLMinvestment` production path).
- All `canonical.signal` fields are null across the UI; "BUY/HOLD/SELL" recommendations shown to users are either stale (expert-analysis) or empty.
- The `prediction_is_fresh` flag is `false` for every stock; `signal_ar = "— لا يوجد توقع طازج"` for every stock.

### C2. **History endpoint SQLite fallback is broken** (P0)
- `src/app/api/stocks/[ticker]/history/route.ts:50-61` references non-existent columns (`open_price`, `high_price`, `low_price`, `close_price`) in `stock_daily_prices`.
- Verified by direct SQLite query: `no such column: open_price`.
- Result: `/api/stocks/COMI/history` returns 404 even though 11 rows exist for COMI.
- Chart components on the stock detail page render an empty chart when Python is down — **even though local data is available**.

### C3. **Ticker-tagging for news is broken** (P0)
- 4428 news rows in news.db, **0 have any ticker** in the `tickers` JSON column.
- All news has `market='general'` — no market classification.
- Per-stock news tabs (`/api/stocks/[ticker]/news`) always return 0 items.
- News `is_catalyst` flag never set (Python impact-scorer not running, forward call silently dropped).
- The "High-Impact Catalysts" admin filter (added recently) returns 0 results — not because there are no catalysts, but because the flag was never written.

### C4. **Expert-analysis contradicts canonical signal** (P1)
- `src/app/api/stocks/[ticker]/expert-analysis/route.ts:74-75` falls back to `prediction.signal` when `canonical.signal` is null.
- Live evidence: SWDY shows "BUY" on expert-analysis but "no fresh prediction" everywhere else.
- Users see conflicting recommendations depending on which screen they open.

### C5. **`/api/market/status` has no fallback** (P1)
- `src/app/api/market/status/route.ts` is a 1-line proxy to `marketPulseProxy()` (in market-pulse-proxy.ts).
- `marketPulseProxy` returns 503 on Python failure — no SQLite fallback.
- Meanwhile `/api/market-pulse` (the canonical route) has its own fallback and returns 200.
- Frontends that call `/api/market/status` (legacy) get 503; those that call `/api/market-pulse` get 200. Inconsistent.

### C6. **RSI value/source contradiction in /api/stocks/[ticker]** (P1)
- `injectUnifiedData` at `src/app/api/stocks/[ticker]/route.ts:117-118`:
  ```ts
  next.rsi = unified.technical.rsi ?? next.rsi;        // preserves stale Python value
  next.rsi_source = unified.technical.rsi_source;      // forces "null"
  ```
- Returns `{ rsi: 50, rsi_source: "null" }` — internally inconsistent.
- The canonical `/api/stocks/[ticker]/unified` returns `rsi: null, rsi_source: "null"` (correct).
- A frontend that displays the RSI value will show "50" on one screen and "—" on another.

### C7. **News forward-to-Python is fire-and-forget** (P2)
- `src/app/api/news/route.ts:305-315` calls Python `/api/news/agent` with `.catch(() => {})`.
- When Python is down (current state), no impact scores or catalyst flags are written.
- The route returns 201 (created) as if everything is fine — admin has no signal that the scoring half failed.
- Recommended: at minimum, log the failure and add a `impact_scoring_pending: true` flag to the response.

### C8. **73 routes hardcode Python URL, bypassing canonical helper** (P2)
- 133 routes reference the Python backend; only 66 import `PYTHON_BACKEND_URL` from `@/lib/python-backend`.
- The other 73 hardcode `http://127.0.0.1:8010` or `http://localhost:8010` directly.
- The canonical helper has the IPv6 fix (`localhost` → `127.0.0.1` server-side) and env-var override — hardcoders miss both.
- In production where `PYTHON_BACKEND_URL` points to a different host, those 73 routes will still hit localhost.

### C9. **Two parallel Telegram publish paths, only one writes audit trail** (P2)
- `/api/telegram/publish-stock` (direct Bot API) writes `was_published`/`published_at`/`telegram_message_id` to predictions.db.
- `/api/telegram/post` (proxied to Python) does **not** write the audit trail.
- If an admin uses the wrong path, the publish succeeds but no DB record is created.

### C10. **No staleness detection on "live" endpoints** (P2)
- `/api/metals/gold` returns `is_live: true` even though last update was 2026-06-24.
- `/api/market-pulse` returns `market_status: CLOSED` and `is_trading_hours: false` (correct for current time) but the index `last_updated` is 2026-03-11.
- `/api/stocks/[ticker]` returns `last_update: 2026-07-10` — visible in the response but no UI warning.
- Users see stale data presented as live.

### C11. **publish-data uses camelCase, every other endpoint uses snake_case** (P3)
- `/api/stocks/[ticker]/publish-data` returns `currentPrice`, `entryPrice`, `sma50`, `peRatio`.
- All other endpoints use `current_price`, `entry_price`, `ma_50`, `pe_ratio`.
- The publisher consumer must adapt to both shapes.

### C12. **invalid support/resistance values pass through unvalidated** (P3)
- `/api/stocks?market=EGX` returns ASCM with `current_price: 60.31, support: 125.81, resistance: 144.75`.
- Support above current price is mathematically meaningless — indicates stale precomputed column.
- No validation in the API layer.

---

## Recommendations

### Immediate (P0 — fix this week)

1. **Restart the prediction pipeline**:
   - Install cron from `crontab.txt` after sed-replacing the production path with the sandbox path.
   - Or run `vps-service/jobs/daily_predictor.py --today-only --max-picks 5` manually to validate the pipeline.
   - Verify `predictions.db.predictions` has today's rows after the run.

2. **Fix the history endpoint SQL fallback** (`src/app/api/stocks/[ticker]/history/route.ts:50-61`):
   - Change `COALESCE(open, open_price)` → just `open` (since `stock_daily_prices` uses `open/high/low/close`).
   - OR migrate the table to use the `stock_price_history` schema that the rest of the codebase expects.
   - Either way, add a smoke test that runs the fallback query.

3. **Fix the news ticker-tagging pipeline**:
   - Investigate why `news_agent.py` is storing `tickers: '[]'` for every row.
   - Likely the NLP ticker-extraction model isn't running, or the agent isn't passing the tickers field to `/api/news` POST.
   - Without this, every per-stock News tab is empty.

### Short-term (P1 — fix this sprint)

4. **Make expert-analysis respect canonical signal**:
   - In `src/app/api/stocks/[ticker]/expert-analysis/route.ts:74`, change `canonical.signal || prediction.signal` to just `canonical.signal`.
   - When canonical is null, the analysis should say "no fresh prediction" rather than falling back to stale data.

5. **Add fallback to `/api/market/status`**:
   - Either inline the same SQLite fallback that `/api/market-pulse` uses, or simply make `/api/market/status` redirect to `/api/market-pulse` (the canonical route).

6. **Fix RSI/source contradiction in `/api/stocks/[ticker]`**:
   - When `unified.technical.rsi` is null, the inject helper should either:
     - Set `next.rsi = null` (cleanest — matches the canonical route), OR
     - Preserve `next.rsi` AND set `rsi_source` to `"precomputed"` (preserves the value but labels it correctly).
   - Currently it does neither — mixes the two.

7. **Migrate the 73 hardcoded Python URL routes** to import `PYTHON_BACKEND_URL` from `@/lib/python-backend`. Mechanical refactor, low risk, eliminates a class of production bugs.

### Medium-term (P2 — next quarter)

8. **Add staleness detection**:
   - Compute `data_age_hours` for every "live" response based on the latest DB timestamp.
   - Surface it in the response (`stale: true`, `last_updated: ...`).
   - Frontend should warn the user when `data_age_hours > 24`.

9. **Consolidate Telegram publish paths**:
   - Make `/api/telegram/post` also write the audit trail (or deprecate it in favor of `/api/telegram/publish-stock`).
   - Add an idempotency key to prevent double-publish on rapid clicks.

10. **Fix news forward-to-Python error handling**:
    - Replace `.catch(() => {})` with `.catch(err => console.error('[news] python forward failed:', err))`.
    - Add `impact_scoring_pending: true` to the response when the forward fails.
    - Surface in admin UI so the operator knows scoring is degraded.

11. **Unify field naming**:
    - Migrate `/api/stocks/[ticker]/publish-data` from camelCase to snake_case to match the rest of the API.
    - Or formally document the camelCase contract and apply it everywhere (less work, more churn).

12. **Add validation for support/resistance**:
    - In `unified-stock-data.ts:computeSupportResistance`, return null if support > current price or resistance < current price.
    - Don't pass through obviously broken values.

### Long-term (P3 — backlog)

13. **Document the canonical source for every field**:
    - The `download/UNIFIED_DATA_CONTRACT.md` file exists — extend it with a field-by-field table showing which route reads which source.
    - Add CI checks that fail if a route reads a "canonical" field (RSI, signal, master_score) from a non-canonical source.

14. **WebSocket health visibility**:
    - When `useRealtimeUpdates()` fails to connect, surface a non-blocking toast: "Live updates unavailable — showing delayed data."
    - Currently the failure is completely silent.

15. **Cache invalidation API**:
    - Add admin endpoints to flush specific cache keys (`/api/admin/cache/flush?key=...`).
    - Useful after manual data refreshes.

---

## Appendix A — Files inspected (key ones)

| File | Purpose | Issues found |
|------|---------|--------------|
| `src/lib/python-backend.ts` | Canonical Python URL helper | Used by 66/133 routes; 73 hardcode URL |
| `src/lib/unified-stock-data.ts` | Canonical stock data accessor (684 LOC) | Solid; correctly delegates to SQLite; handles fallbacks |
| `src/app/api/stocks/[ticker]/route.ts` | Stock detail proxy+inject | Bug 2.2.1 (RSI/source contradiction) |
| `src/app/api/stocks/[ticker]/unified/route.ts` | Canonical stock endpoint | Clean |
| `src/app/api/stocks/[ticker]/comprehensive/route.ts` | Aggregates Python + canonical | Correctly overrides sub-engine signals |
| `src/app/api/stocks/[ticker]/expert-analysis/route.ts` | Generates expert report | Bug 2.2.2 (falls back to stale prediction.signal) |
| `src/app/api/stocks/[ticker]/history/route.ts` | Price history | Bug 4.1 (broken SQL fallback — wrong column names) |
| `src/app/api/stocks/[ticker]/recommendation/route.ts` | Recommendation proxy+inject | Clean (injects canonical correctly) |
| `src/app/api/stocks/[ticker]/news/route.ts` | Per-ticker news | Returns 0 items (ticker-tagging broken upstream) |
| `src/app/api/stocks/[ticker]/publish-data/route.ts` | Publisher data assembly | Bug 2.2.4 (camelCase shape, inconsistent overrides) |
| `src/app/api/stocks/[ticker]/professional-analysis/route.ts` | Deprecated | Returns 410 Gone correctly |
| `src/app/api/stocks/route.ts` | Stock list | Bug 2.2.5 (passes through invalid support/resistance) |
| `src/app/api/news/route.ts` | News ingest + read | Bug C7 (fire-and-forget Python forward); news ticker-tagging broken |
| `src/app/api/metals/gold/route.ts` | Gold/metals | Bug 1.4 (gold_ounce null when karat key is numeric) |
| `src/app/api/market/status/route.ts` | Thin proxy to market-pulse | Bug C5 (no fallback — returns 503) |
| `src/app/api/market-pulse/route.ts` | Market pulse | Robust fallback chain (Python → stale cache → SQLite) |
| `src/app/api/predictions/daily-picks/route.ts` | Daily picks | Returns empty + Arabic message when no fresh predictions |
| `src/app/api/predictions/honest-tracking/list/route.ts` | Honest tracking list | Robust SQLite fallback with graceful error handling |
| `src/app/api/telegram/publish-stock/route.ts` | Direct Telegram publish + audit | Bug C9 (audit trail only here, not in /post) |
| `src/app/api/telegram/post/route.ts` | Proxy to Python Telegram | No audit trail write-back |
| `src/app/api/telegram/[...path]/route.ts` | Generic Telegram proxy | Returns 502/504 on Python failure |
| `vps-service/ws-service/index.ts` | WebSocket service (port 3005) | Currently down; silently degrades to REST polling |
| `crontab.txt` | Cron schedule | References production path `/root/GLMinvestment` — not installed in sandbox |

## Appendix B — Live probe results (Python down)

All probes performed 2026-10-09 13:39–13:46 UTC against `http://localhost:3000`.

| Endpoint | HTTP | Source | Notes |
|----------|------|--------|-------|
| `/api/health` | 200 | — | `status: degraded`, lists python/ws/telegram as down |
| `/api/stocks/COMI` | 200 | `sqlite_fallback` + injectUnifiedData | rsi:50, rsi_source:"null" (contradiction) |
| `/api/stocks/COMI/unified` | 200 | canonical (SQLite only) | rsi:null, rsi_source:"null" (clean) |
| `/api/stocks/COMI/comprehensive` | 200 | mixed | errors:["deep-analysis: fetch failed","professional: fetch failed"] |
| `/api/stocks/COMI/expert-analysis` | 200 | unified-stock-data + expert-analysis.ts | recommendation:"HOLD" (conflicts with null signal) |
| `/api/stocks/COMI/history` | 404 | — | Bug 4.1 (broken SQL fallback) |
| `/api/stocks/COMI/news` | 200 | `sqlite_fallback` | 0 news (ticker-tagging broken) |
| `/api/stocks/COMI/recommendation` | 200 | `sqlite_fallback_empty` | Arabic message |
| `/api/stocks/COMI/publish-data` | 200 | `sqlite_fallback_basic` | camelCase shape; minimal data |
| `/api/stocks?market=EGX&page_size=1` | 200 | `stocks.db` | ASCM: support 125.81 > price 60.31 (invalid) |
| `/api/stocks/SWDY/expert-analysis` | 200 | — | recommendation:"BUY" (conflicts with unified's null) |
| `/api/stocks/SWDY/unified` | 200 | canonical | signal:null, signal_ar:"no fresh prediction" |
| `/api/stocks/ETEL/expert-analysis` | 200 | — | recommendation:"BUY" (conflicts with unified's null) |
| `/api/stocks/ETEL/unified` | 200 | canonical | signal:null, signal_ar:"no fresh prediction" |
| `/api/news?limit=3` | 200 | news.db | 4428 total; 0 tagged with any ticker |
| `/api/news/latest?limit=2` | 200 | news.db | All `market: 'general'` (no market classification) |
| `/api/metals/gold` | 200 | data_engine.db | `gold_ounce: null` (Bug 1.4); `is_live: true` despite 3-month-old data |
| `/api/market/status` | 503 | — | Bug C5 (no fallback) |
| `/api/market-pulse` | 200 | `sqlite_fallback` | Has own fallback; works |
| `/api/market/overview` | 200 | stocks_db_market_indices | `last_updated: 2026-03-11` (7 months stale) |
| `/api/market/top-movers` | 200 | `sqlite_fallback` | Stale data; ASCM has price_change 106% but change_percent=0 |
| `/api/data-status` | 500 | — | Hard fail |
| `/api/data-engine/status` | 200 + body error | — | `error: "no such table: egksco_price_history"` |
| `/api/data-engine/health` | 200 | — | Per-DB status; `price_history` marked down |
| `/api/predictions/daily-picks` | 200 | `error-fallback` | Empty picks + Arabic message |
| `/api/predictions/honest-tracking/list` | 200 | `local-db` | Reads from SQLite directly; works |

## Appendix C — Data freshness snapshot

| Database | Latest write | Age (as of 2026-10-09) |
|----------|--------------|------------------------|
| stocks.db.stocks | 2026-07-10 | 3 months |
| stocks.db.stock_daily_prices (COMI) | 2026-07-10 | 3 months |
| predictions.db.predictions | 2026-06-25 | 3.5 months |
| data_engine.db.gold_prices | 2026-06-24 | 3.5 months |
| data_engine.db.crypto_prices | 2026-06-24 | 3.5 months |
| stocks.db.market_indices | 2026-03-11 | 7 months |
| news.db.market_news | 2026-06-24 | 3.5 months |

Every "live" data source is stale. The platform is currently operating entirely from SQLite fallbacks — Python pipeline has not produced new data in over 3 months.

---

**End of report.**
