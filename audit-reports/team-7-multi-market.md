# Team 7: Multi-Market Audit

> **Task ID**: TEAM-7-MULTI-MARKET
> **Scope**: Multi-market support — EGX, TADAWUL, KSE, QSE, US, CRYPTO
> **Mode**: PURE RESEARCH (no code changes)
> **Date**: 2026-10-09

---

## Executive Summary

The platform advertises **6 markets** (`EGX | TADAWUL | KSE | QSE | US | CRYPTO`) in the UI `MarketType` union, but in practice **only EGX is fully wired end-to-end**. A central normalization helper (`src/lib/market-utils.ts`) was introduced in Phase 3 (commit b18b3f21) and applied to **5 API routes**, but ~80% of the codebase still relies on **5 different duplicate alias maps**, hardcoded EGX filters, and inconsistent market labels across DBs.

Most critically:

- **News segregation is completely broken**: `news.db.market_news.market` is always `'general'` for all 4,428 rows — the actual market is only in `market_code` column, which the `/api/news` route never queries.
- **No radar cache exists**: 0 `maker_radar_*.json` files on disk — only `.md` summaries for EGX/TADAWUL. The radar endpoint always reports `first_generation: true`.
- **Trading-hours drift** between `market-hours.ts` (TS, source of truth) and `market_config.py` (Python) for KSE, QSE, and the multi-market radar's UTC constants.
- **Persona predictions missing TADAWUL**: `persona_predictions` table has EGX/KSE/QSE rows but **0 TADAWUL rows**.
- **No US market profile** in Python `unified_config.py` (`MARKET_PROFILES` only has EGX, KSA, KSE, QSE, DFM, CRYPTO — US is silently dropped).

---

## 1. Market Data Inventory

### 1.1 stocks.db (34 MB) — Primary stock universe

| Market   | Rows | Notes |
|----------|------|-------|
| EGX      | 445  | Source of truth; includes EGX30/70/100 flags |
| TADAWUL  | 388  | Stored as `'TADAWUL'` (canonical) |
| KSE      | 139  | Stored as `'KSE'` |
| QSE      | 67   | Stored as `'QSE'` |
| **US**   | 0    | **MISSING** — no US stocks seeded |
| **CRYPTO** | —  | **NOT IN THIS TABLE** — handled via separate `data_engine.db.crypto_prices` |

Tables: `stocks` (1,039 rows), `stock_daily_prices` (10,529 rows, 959 distinct tickers — covers all 4 markets), `predictions` (4,172 rows), `market_indices` (5 rows — EGX30/50/70/100/33 only — NO indices for any other market).

### 1.2 price_history.db (53 MB) — Canonical price history

| Metric | Value | Issue |
|--------|-------|-------|
| Total rows | 274,574 | — |
| Distinct tickers | 762 | — |
| Market column | **NONE** | No way to filter by market without ticker→market join |
| EGX tickers | 324 (mapped via stocks.db) | OK |
| TADAWUL tickers | 95 | OK |
| KSE tickers | 129 | OK |
| CRYPTO (inferred) | 18 | BTC, ETH, SOL, etc. mixed in with stocks |
| **UNMAPPED tickers** | **196** | Includes bonds (`EG31X`, `EGT2204250426G0`), foreign tickers (`SEEF`, `BMMI`, `APMTB`), crypto (`DOGE`, `TON`, `HBAR`) |
| Latest date EGX | 2026-06-10 | OK |
| Latest date TADAWUL | 2026-06-03 | **7 days stale vs EGX** |
| Latest date KSE | 2026-06-10 | OK |

### 1.3 data_engine.db (60 MB) — Multi-market + crypto + gold

| Table | Rows | Market column | Issue |
|-------|------|---------------|-------|
| `stocks` | 2,205 | `market` (Arabic) | Labeled `'مصر'`, `'السعودية'`, `'الكويت'`, `'قطر'` — **incompatible with stocks.db's English codes** |
| `stock_prices` | 2,493 | `market` (Arabic) | Same Arabic labels — duplicate universe (vs stocks.db) |
| `historical_data` | 99,076 | `market` (Arabic descriptors) | Only 89 TADAWUL symbols + 10 US (AAPL etc.); also `الأسهم الأمريكية`, `العملات`, `الذهب والفضة`, `مؤشرات عالمية` |
| `crypto_prices` | 128,040 | n/a (single market) | 55 distinct symbols (BTC, ETH, USDT, …); `price_usd` column |
| `gold_prices` | 129,251 | `country` (Arabic) | Per-country gold retail price (Egypt, Saudi, Kuwait, Qatar + 10 other countries) — **NOT market gold spot price** |
| `silver_prices` | 21,490 | n/a | Silver spot |
| `exchange_rates` | 21,490 | n/a | Currency pairs |
| `btc_local_prices` | 8,440 | n/a | BTC priced in local currencies |
| `tab_*` (8 tables) | ~860 each | n/a | Fundamentals tabs (balance sheet, cash flow, etc.) — market inferred via `symbol` |

**Critical gap**: `data_engine.db.stocks` and `stocks.db.stocks` are **duplicate stock universes** with different market labels (Arabic vs English). They are not reconciled, so a TADAWUL ticker like `'1010'` (Al Rajhi Bank) appears in both DBs but with different `market` values (`'السعودية'` vs `'TADAWUL'`).

### 1.4 predictions.db (9 MB) — AI predictions

| Table | EGX | TADAWUL | KSE | QSE | US | CRYPTO | Issue |
|-------|-----|---------|-----|-----|----|----|-------|
| `predictions` | 2,951 | 2,402 | 2,566 | 1,420 | 0 | 0 | OK — 4 markets covered |
| `aiPrediction` | 2,951 | 2,402 | 2,566 | 1,420 | 0 | 0 | Mirror of `predictions` |
| `persona_predictions` | 1,514 | **0** | 508 | 198 | 0 | 0 | **TADAWUL has 0 persona predictions** — persona engine skips TADAWUL |
| `crypto_predictions` | — | — | — | — | — | 56 | Separate table; OK but tiny |
| `global_predictions` | 335 | 0 | 0 | 0 | 0 | 0 | **EGX-only** (history 2025-01 → 2026-06) |
| `real_predictions` | — | — | — | — | — | — | **No `market` column at all** — 95 distinct tickers, 91 look like 4-digit TADAWUL codes (`1010`, `1020`, `1030` …). Cannot filter by market. |
| `stored_analyses` | — | — | — | — | — | — | Has `market` column (good); sample shows TADAWUL rows |
| `expertRecommendation` | 115 | — | — | — | — | — | Not audited for market split |

### 1.5 news.db (18 MB)

| Column | Distribution |
|--------|--------------|
| `market` | **`'general'` for all 4,428 rows** — completely useless for filtering |
| `market_code` | `GENERAL: 3,950` / `EGX: 223` / `QSE: 194` / `KSE: 47` / `TADAWUL: 14` — **this is the real market field** |
| `importance` | `0` for all rows — never populated |
| `is_catalyst` | `0` for all rows — never populated |

**The `/api/news` route filters on `market` column (line 130: `conditions.push('market = ?')`)**, which returns 0 rows for any market-specific query. This means the news UI shows ZERO news for TADAWUL/KSE/QSE users even though there ARE market-specific articles in `market_code`.

### 1.6 intraday.db (76 MB)

| Table | Rows | Notes |
|-------|------|-------|
| `stock_intraday` | 244,144 | EGX-heavy (likely) — not segregated analysis done |
| `crypto_intraday` | 28,216 | Crypto only |
| `commodity_intraday` | 13,120 | Gold/silver |

### 1.7 historical.db (42 MB)

| Table | Rows |
|-------|------|
| `historical_prices` | 175,299 |
| `daily_prices` | 110 |

Not analyzed per market (would require ticker-by-ticker join with stocks.db).

### 1.8 Coverage Gap Summary

| Market | Stocks | Daily Prices | Price History | Predictions | Persona Preds | News | Indices | Intraday |
|--------|--------|--------------|---------------|-------------|---------------|------|---------|----------|
| EGX | 445 | ✅ | ✅ 324 tickers | 2,951 | 1,514 | 223 | 5 (EGX30/50/70/100/33) | ✅ |
| TADAWUL | 388 | ✅ | 95 tickers | 2,402 | **0** ❌ | 14 | **0** ❌ | ❓ |
| KSE | 139 | ✅ | 129 tickers | 2,566 | 508 | 47 | **0** ❌ | ❓ |
| QSE | 67 | ✅ | (in 196 unmapped) | 1,420 | 198 | 194 | **0** ❌ | ❓ |
| US | **0** ❌ | ❌ | 10 tickers (AAPL etc.) | 0 | 0 | 0 | **0** ❌ | ❌ |
| CRYPTO | n/a | n/a | 18 in price_history + 55 in data_engine | 56 | n/a | 0 | n/a | 28k rows |

**Verdict**: Only EGX has full data pipeline coverage. TADAWUL has a major persona-prediction gap. US is essentially absent. CRYPTO is siloed but functional.

---

## 2. Market Segregation

### 2.1 The canonical helper — `src/lib/market-utils.ts`

The Phase 3 fix introduced `normalizeMarket()` with these capabilities:

```ts
normalizeMarket('KSA')          → 'TADAWUL'   // alias normalization
normalizeMarket('السعودية')     → 'TADAWUL'   // Arabic → English
sqlMarketVariants('TADAWUL')    → ['TADAWUL', 'KSA', 'السعودية']
buildMarketFilter('TADAWUL')    → { clause: 'market IN (?,?,?)', params: [...] }
pythonMarketCode('TADAWUL')     → 'KSA'        // Python unified_config.py key
```

This is correct and well-designed — **but applied to only 5 routes** (per worklog):
1. `/api/predictions/honest-tracking/list/route.ts`
2. `/api/stocks/route.ts`
3. `/api/stocks/[ticker]/unified/route.ts`
4. `/api/v2/unified/analyze/route.ts`
5. `/api/predictions/daily-picks/route.ts` (partial — uses its own duplicate `MARKET_MAP`)

### 2.2 The duplicate alias-map problem (5 maps, 1 truth)

| File | Symbol | TADAWUL → ? | Used by |
|------|--------|-------------|---------|
| `src/lib/market-utils.ts` | `MARKET_ALIASES` | `'TADAWUL'` (canonical) | 5 routes above |
| `src/lib/store.ts` | `MARKET_CODES` | **`'KSA'`** | Frontend (market-analysis components, persona tab, predictions tab, export) |
| `src/lib/market-data-access.ts` | `MARKET_ALIASES` | `'TADAWUL'` | market-pulse route, indices fetcher |
| `src/lib/egx-db.ts` | `FRONTEND_TO_ARABIC_MARKET` | `'السعودية'` | data_engine.db reads |
| `src/lib/data-engine-db.ts` | `marketCodeToArabic` (duplicate) | `'السعودية'` | duplicate of #4 |
| `src/app/api/predictions/daily-picks/route.ts` | `MARKET_MAP` | `'TADAWUL'` (KSA→TADAWUL) | inline duplicate |

**Direct contradiction**: `store.ts:MARKET_CODES['TADAWUL'] = 'KSA'` (used to send KSA to Python) vs `market-utils.ts:normalizeMarket('KSA') = 'TADAWUL'` (used to read stocks.db). The two maps **disagree** about what TADAWUL "is".

### 2.3 Inline `KSA→TADAWUL` hacks (5 occurrences)

These bypass the helper:

```ts
// In 3 components (MarketStatusTab.tsx, PredictionsTab.tsx, PersonaTab.tsx)
const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
```

Found at:
- `MarketStatusTab.tsx:232`
- `PredictionsTab.tsx:503`
- `PersonaTab.tsx:1412, 1512, 1717`

This is fragile — if the canonical code changes, all 5 sites must be updated manually.

### 2.4 Data leakage / cross-market contamination

- **`real_predictions` table** has no `market` column. All 95 tickers (91 of which are 4-digit numeric TADAWUL codes) are stored together. Any query returns a mix of markets.
- **`price_history.db`** has no `market` column. Tickers from 5 markets (stocks + bonds + crypto) share the same table. Filtering requires a JOIN with `stocks.db` (which only knows 4 of the 5 markets).
- **`stocks.db.stocks` itself is clean**: 0 duplicate tickers across markets (verified — `SELECT ticker, COUNT(DISTINCT market) … HAVING > 1` returns 0 rows).
- **`data_engine.db.stocks` has 1 duplicate**: ticker `'MENA'` exists in both `'مصر'` and `'الكويت'` (MENA Capital — dual-listed?). Likely legitimate but causes ambiguity in single-ticker lookups.

### 2.5 Are predictions market-specific?

Yes — `predictions.db.predictions.market` is correctly populated for EGX/TADAWUL/KSE/QSE (the 4 markets with seeded data). The `honest-tracking/list` route uses `buildMarketFilter()` correctly.

But `real_predictions` and `global_predictions` lack market columns — they cannot be filtered.

---

## 3. Prediction Engine

### 3.1 Python `unified_config.py` MARKET_PROFILES (line 336-624)

| Market | Profile | ATR clamp | R:R floor | Strategy | Notes |
|--------|---------|-----------|-----------|----------|-------|
| EGX | ✅ | [5%, 9%] | 1.8 (Rule 18) | T+1 | Tuned (backtest 69.9% WR) |
| **KSA** (not TADAWUL) | ✅ | [3%, 6%] | 1.5 | Swing | Key is `'KSA'`, NOT `'TADAWUL'` |
| KSE | ✅ | [2%, 4.5%] | 1.5 | Swing | OK |
| QSE | ✅ | [2.5%, 5%] | 1.5 | Swing | OK |
| DFM | ✅ | [2.5%, 6%] | 1.5 | Swing | **Not in frontend MarketType** — orphan profile |
| CRYPTO | ✅ | [5%, 15%] | 1.8 | Breakout | OK |
| **US** | **❌ MISSING** | — | — | — | **No MarketProfile for US** — `get_market_profile('US')` returns `None` |

**Critical**: A US stock analysis request will raise `ValueError("سوق غير معروف: US. الخيارات: ['EGX', 'KSA', 'KSE', 'QSE', 'DFM', 'CRYPTO']")` (line 762 of `unified_config.py`). The frontend sends `market='US'` → Python crashes → API returns 500 (or fallback).

### 3.2 The KSA/TADAWUL key mismatch (Phase 3 fix)

The `pythonMarketCode()` helper in `market-utils.ts:164` does:
```ts
if (market === 'TADAWUL') return 'KSA';
return market;
```

This is applied **only** in `/api/v2/unified/analyze/route.ts` (line 113). Other Python-bound routes (e.g., `/api/predictions/daily-picks`) use their own `MARKET_MAP` that **also handles KSA→TADAWUL** but NOT Arabic aliases (`'السعودية'` would pass through unchanged).

### 3.3 Daily predictor (EGX-only)

`vps-service/jobs/daily_predictor.py:387` contains an explicit **EGX-MARKET-ISOLATION** gate that filters tickers to "EGX canonical" only:

```python
# EGX-MARKET-ISOLATION: فلتر صارم لـ EGX canonical فقط
# المشكلة: المصادر دي بتحتوي على tickers من 4 أسواق (EGX + TADAWUL + KSE + QSE)
```

This means **the daily predictor generates predictions for EGX only**. The 9,339 non-EGX predictions in `predictions.db` come from a different generator (likely `backfill_with_personas.py` or `maestro_backfill_v2.py` — not audited).

### 3.4 Persona predictions — TADAWUL gap

| Market | `persona_predictions` rows |
|--------|---------------------------|
| EGX | 1,514 |
| KSE | 508 |
| QSE | 198 |
| TADAWUL | **0** ❌ |

This means the persona tab (`PersonaTab.tsx`) shows ZERO persona-based picks for TADAWUL users — even though TADAWUL has 2,402 regular predictions. Either the persona engine wasn't run for TADAWUL, or its output is being filtered out.

### 3.5 Market-specific parameters — verification

Per `unified_config.py`:

| Param | EGX | KSA | KSE | QSE | DFM | CRYPTO |
|-------|-----|-----|-----|-----|-----|--------|
| `min_score_buy` | 65 | 68 | 65 | 68 | 67 | 72 |
| `min_rr` | 1.8 | 1.5 | 1.5 | 1.5 | 1.5 | 2.0 |
| `stop_atr_mult` | 2.5 | 2.0 | 2.0 | 2.0 | 2.0 | 2.5 |
| `position_size_pct` | 10 | 10 | 8 | 8 | 10 | 3 |
| `atr_stop_min_pct` | 5.0 | 3.0 | 2.0 | 2.5 | 2.5 | 5.0 |
| `atr_stop_max_pct` | 9.0 | 6.0 | 4.5 | 5.0 | 6.0 | 15.0 |
| `default_strategy` | T+1 | Swing | Swing | Swing | Swing | Breakout |

All values are market-specific ✅. The `UnifiedConfig.__init__` correctly loads `MARKET_PROFILES.get(market_code.upper())`.

### 3.6 `data_provider_type` field

Each MarketProfile has a `data_provider_type`:
- `financial_statements` for EGX, KSA, KSE, QSE, DFM
- `on_chain_tokenomics` for CRYPTO

And `price_db_table`:
- `price_history` for stocks
- `crypto_prices` for crypto

This is correctly modeled but the actual data sources (`_find_radar_db` in `maker_radar.py:72`) use a different per-market table dispatch that doesn't reference these fields.

---

## 4. Radar Analysis (رادار السيولة)

### 4.1 `MakerRadarTab.tsx` (3,820 lines)

**Source of truth**: `GET /api/maker-radar?market=EGX` (line 7 of component).

| Aspect | Finding |
|--------|---------|
| Default market | `'EGX'` (line 562) |
| Accepts `market` prop | ✅ |
| Fetches `/api/maker-radar?market=${market}` | ✅ (line 648) |
| Fetches `/api/stocks?market=${market}&page_size=1000` | ✅ (line 644) |
| Fetches `/api/unified/predictions?market=${market}&limit=1000` | ✅ (line 667) |
| Publish hashtags | **Hardcoded `['EGX', 'رادار_الميكرز', 'بورصة_مصر']`** (line 2108) — wrong for non-EGX |
| Stock card Sharia badge | **`{market === 'EGX' && (...)}`** (line 2187) — Sharia badge hidden for non-EGX |
| ExitRadarTab | `<ExitRadarTab market={market === 'CRYPTO' ? 'EGX' : market} />` (line 1666) — crypto users get EGX exit radar |
| WeeklyReportTab | Same crypto→EGX fallback (line 1671) |

### 4.2 `/api/maker-radar/route.ts`

```ts
// Line 62: read market query param, default 'EGX'
const market = url.searchParams.get('market') || 'EGX';
// Line 109: HARD-CODED branch + SQL INJECTION vulnerability
const marketFilter = market === 'EGX'
  ? `AND market IN ('EGX','مصر')`
  : `AND market = '${market}'`;  // ⚠ unsanitized string interpolation
```

**Critical issues**:
1. **SQL injection**: `${market}` is interpolated directly into SQL. A malicious `?market=' OR 1=1 --` would dump all stocks. Even though `market` is a query param, it's never validated/escaped.
2. **No alias handling**: Sending `market=KSA` produces `AND market = 'KSA'` which returns 0 rows (stocks.db stores `'TADAWUL'`). The `market-utils.ts:buildMarketFilter()` helper exists but is **not used here**.
3. **Crypto not handled**: For `market=CRYPTO`, the query runs `AND market = 'CRYPTO'` on `stocks.db.stocks` which has no crypto rows. The radar silently returns 0 results.

### 4.3 `/api/maker-radar/multi-market/route.ts` (better designed)

This is the more robust endpoint:

- ✅ Whitelist of 7 markets (EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD)
- ✅ Per-market `MARKET_META` table (currency, open/close UTC, Arabic name)
- ✅ Per-market cache file naming: `maker_radar_{MARKET}_*.json`
- ✅ Rule 67 honest warming-up flag (only true on first generation)
- ✅ Validates input and returns 400 for unknown markets

**But trading-hours constants are wrong**:

| Market | UTC hours (route.ts:149-156) | UTC hours (market-hours.ts) | Δ |
|--------|------------------------------|-----------------------------|---|
| EGX | 08:00 - 12:30 | 08:00 - 13:00 (10:00-15:00 Cairo, UTC+2) | **30 min early close** |
| TADAWUL | 07:00 - 12:00 | 07:00 - 12:00 (10:00-15:00 Riyadh, UTC+3) | ✅ |
| KSE | 06:00 - 10:30 | **05:00 - 09:45** (08:00-12:45 Kuwait, UTC+3) | **1h early open, 45m late close** |
| QSE | 06:00 - 10:00 | **06:30 - 10:00** (09:30-13:00 Doha, UTC+3) | **30m early open** |
| US | 14:30 - 21:00 | 14:30 - 21:00 (09:30-16:00 ET, EST only) | ⚠ **DST not handled** — US opens 13:30 UTC during EDT (Mar-Nov) |
| CRYPTO | 00:00 - 23:59 | 24/7 | ✅ |

### 4.4 Radar cache files

```
$ find scripts/output -name "maker_radar_*.json"
(empty)

$ find scripts/output -name "maker_radar_*"
maker_radar_EGX_20261004.md
maker_radar_TADAWUL_20261004.md
maker_radar_tab.png
maker_radar_stock_detail.png
```

**No JSON cache files exist on disk** — only Markdown summaries (which `findLatestRadarFile` doesn't read). This means:

- Every call to `/api/maker-radar` triggers `triggerBackgroundWarmup(market)` (line 88)
- The first response is always `503 warming_up: true, retry_after_seconds: 30` (line 96)
- Subsequent responses stay `warming_up: true` indefinitely until Python `maker_radar.py --json-only` runs to completion
- For non-EGX markets, the Python script may never succeed (DB empty for US, missing tables, etc.)

### 4.5 `radar-cache.ts` `triggerBackgroundWarmup()`

Correctly passes `--market` to the Python script:
```ts
const args = [
  SCRIPT_PATH,
  '--market', market,          // ← market-specific
  '--min-quiet-signals', '5',
  '--min-price', '1.0',
  '--json-only',
];
```

The Python `maker_radar.py` has its own per-market DB dispatch (`MARKET_CANDIDATES` dict at line 109), so each market gets routed to the correct source table. This part is sound.

### 4.6 Are radar results market-segregated?

**Yes** for cache files (`maker_radar_{MARKET}_*.json`). **No** for the enrichment step in `/api/maker-radar/route.ts` (line 109 SQL injection above). For multi-market route, results are properly segregated in the response shape (`markets: { EGX: {...}, TADAWUL: {...}, ... }`).

---

## 5. UI Market Switching

### 5.1 Three selector components

1. `src/components/shared/MarketSelector.tsx` — `Select` dropdown, 6 markets
2. `src/components/layout/ExchangeSelector.tsx` — `DropdownMenu`, 6 markets + flags 🇪🇬🇸🇦🇰🇼🇶🇦🇺🇸🪙
3. **Inline** buttons in `MobileNav`, `Header`, etc.

All three write to the same `useAppStore.currentMarket` field.

### 5.2 Persistence

```ts
// store.ts:617
const CURRENT_MARKET_KEY = 'egx_current_market';
// store.ts:784-792
currentMarket: hydrateFromStorage<MarketType>(CURRENT_MARKET_KEY, 'EGX'),
setCurrentMarket: (market) => {
  set({ currentMarket: market });
  window.localStorage.setItem(CURRENT_MARKET_KEY, JSON.stringify(market));
  // ...reloads stocks + dashboard
}
```

✅ Market persists across page refreshes via `localStorage`. Default is `'EGX'`.

### 5.3 Side effects on switch

| Action | Triggered | Market-aware? |
|--------|-----------|---------------|
| `loadStocks('', 1)` | ✅ | ✅ (passes `currentMarket` to API) |
| `loadDashboard()` | ✅ | ❌ (calls `getMarketOverview(currentMarket)` but most endpoints are EGX-only) |
| `loadV2Recommendations()` | ✅ | ✅ (uses `currentMarket` in URL) |
| `loadCryptoList()` | ✅ (only for CRYPTO) | n/a |

### 5.4 Inconsistency across screens

| Screen | Respects currentMarket? | Issue |
|--------|-------------------------|-------|
| Dashboard | Partial | EGX-specific widgets (MarketSummary, IndexCards, MarketPulse, MarketSentiment) **hidden** for non-EGX (line 202, 216, 228). No equivalent widgets for TADAWUL/KSE/QSE/US — these markets show EMPTY dashboard. |
| Stocks view | ✅ | Loads from `/api/stocks?market=${currentMarket}` |
| Predictions | ✅ | Uses `MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market]` hack |
| Persona tab | ✅ | Same hack |
| Market status tab | ✅ | Same hack |
| Live Monitor | ❌ | `live-monitor/route.ts:192` hardcoded `WHERE market = 'EGX'` — shows EGX stocks even on TADAWUL |
| Sector Intelligence | ❌ | `/api/market/sectors/intelligence` hardcodes `market: 'EGX'` (line 273) |
| Portfolio | Partial | `EnhancedPortfolioView` adds market badge (Phase 3 fix) but uses heuristic `inferStockMarket()` (digit→TADAWUL, alpha→EGX) which misclassifies alpha TADAWUL tickers |
| News | ❌ | Filter uses wrong column (`market` instead of `market_code`) — see §1.5 |
| Reports | Partial | Defaults to `'EGX'` everywhere |

### 5.5 `DevelopmentNotice.tsx` — markets under development

```ts
const DEVELOPMENT_MARKETS: MarketType[] = ['TADAWUL', 'KSE', 'DFM', 'BSE', 'QSE', 'US'];
```

**Bug**: `'DFM'` and `'BSE'` are NOT members of `MarketType` union (`'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO'`). This is a **TypeScript type error** that should be caught by `tsc --noEmit` — but the codebase has 1,258 baseline TS errors so it's lost in the noise. The runtime effect: `DEVELOPMENT_MARKETS.includes(currentMarket)` will never match `'DFM'` or `'BSE'` (since `currentMarket` can never hold those values), so they're dead entries.

---

## 6. Cross-Market Issues

### 6.1 Duplicate tickers across markets

- **stocks.db.stocks**: 0 duplicates (verified) ✅
- **data_engine.db.stocks**: 1 duplicate — `'MENA'` in both `'مصر'` and `'الكويت'` (likely dual-listing; not harmful but ambiguous)
- **price_history.db**: 196 unmapped tickers including bonds (`EG31X`, `EGT2204250426G0`) and unmapped stocks (`SEEF`, `BMMI`, `APMTB`, `TAO`, `DOGE`, `TON`, `HBAR`)

### 6.2 Currency mixing

| Market | Currency | Source of truth |
|--------|----------|-----------------|
| EGX | EGP (ج.م) | `MARKET_CURRENCY_LABEL['EGX']` ✅ |
| TADAWUL | SAR (ريال) | ✅ |
| KSE | KWD (د.ك) | ✅ |
| QSE | QAR (ر.ق) | ✅ |
| US | USD ($) | ✅ |
| CRYPTO | USD ($) | ✅ |

**Issue**: `MARKET_CURRENCY_LABEL` is defined in `store.ts:596` (frontend), but Python `MARKET_PROFILES` defines the same currencies independently. If they ever diverge, frontend display and Python calculation would mismatch. Verified they currently agree.

**Issue**: `EnhancedPortfolioView` computes portfolio total. If a user has EGX (EGP) + TADAWUL (SAR) + US (USD) stocks, the total is **summed without FX conversion**. This is a calculation bug, not just a market-segregation bug — but it surfaces only when the user mixes markets.

### 6.3 Timezone issues

| Component | Timezone handling |
|-----------|-------------------|
| `market-hours.ts` (TS) | Uses `Intl.DateTimeFormat` with explicit `timeZone` (Africa/Cairo, Asia/Riyadh, Asia/Kuwait, Asia/Qatar, America/New_York) ✅ DST-aware |
| `market_config.py` (Python) | Uses `pytz.timezone` ✅ DST-aware |
| `multi-market/route.ts` (TS) | Uses **UTC hour constants** — does NOT account for DST ❌ US market hours wrong from March-November |

### 6.4 Trading hours discrepancies (Python vs TS)

| Market | market_config.py | market-hours.ts | Match? |
|--------|------------------|-----------------|--------|
| EGX | 10:00-14:30 Cairo | 10:00-15:00 Cairo | ❌ **30 min diff** (Python says 14:30 close, TS says 15:00) |
| KSA | 10:00-15:00 Riyadh | 10:00-15:00 Riyadh | ✅ |
| KSE | 09:00-13:30 Kuwait | 08:00-12:45 Kuwait | ❌ **1h open + 45m close diff** |
| QSE | 09:00-13:00 Doha | 09:30-13:00 Doha | ❌ **30m open diff** |
| US | 09:30-16:00 ET | 09:30-16:00 ET | ✅ |
| CRYPTO | 24/7 | 24/7 | ✅ |

The Phase 3 worklog claims KSE/QSE hours were "corrected" in `market-hours.ts` — but `market_config.py` was **NOT updated** to match. So Python-side market-status checks (e.g., `is_market_open()` in `market_config.py:451`) will return WRONG results for EGX/KSE/QSE.

### 6.5 Weekend definitions

| Market | Weekend |
|--------|---------|
| EGX/TADAWUL/KSE/QSE | Fri + Sat (Arabic markets) |
| US | Sat + Sun |
| CRYPTO | None (24/7) |

`market-hours.ts` correctly checks `weekdayStr === 'Fri' || weekdayStr === 'Sat'` for Arabic markets. ✅

`multi-market/route.ts:167-169` has the same logic with `arabicMarkets` array. ✅

### 6.6 TADAWUL ticker format

TADAWUL uses 4-digit numeric tickers (`1010`, `2222` for Aramco, `4005`, etc.). The frontend's `inferStockMarket()` heuristic in `EnhancedPortfolioView` (line 89-110 per worklog) assumes:

```ts
// heuristic fallback
if (/^\d{4}$/.test(ticker)) return 'TADAWUL';
if (/USDT|BTC|ETH/.test(ticker)) return 'CRYPTO';
return 'EGX';
```

This works for most cases but **misclassifies**:
- TADAWUL alpha tickers (rare but exist)
- KSE/QSE tickers that happen to be 4-digit (some are)
- US tickers if a user manually enters one (US has no seeded stocks)

---

## 7. Data Integrity

### 7.1 Market label inconsistency across DBs (CRITICAL)

| DB | Table | Market column value(s) | Standard? |
|----|-------|------------------------|-----------|
| stocks.db | stocks | `EGX`/`TADAWUL`/`KSE`/`QSE` (English) | ✅ Canonical |
| stocks.db | predictions | `EGX`/`TADAWUL`/`KSE`/`QSE` (English) | ✅ Canonical |
| stocks.db | market_indices | n/a (EGX30/50/70/100/33 only) | ⚠ No market column |
| predictions.db | predictions / aiPrediction | `EGX`/`TADAWUL`/`KSE`/`QSE` (English) | ✅ Canonical |
| predictions.db | persona_predictions | `EGX`/`KSE`/`QSE` (English; no TADAWUL) | ⚠ TADAWUL gap |
| predictions.db | real_predictions | **NO MARKET COLUMN** | ❌ Cannot filter |
| predictions.db | global_predictions | `EGX` only | ❌ Single market |
| price_history.db | price_history | **NO MARKET COLUMN** | ❌ Cannot filter without join |
| data_engine.db | stocks | `مصر`/`السعودية`/`الكويت`/`قطر` (Arabic) | ❌ Diverges from stocks.db |
| data_engine.db | stock_prices | `مصر`/`السعودية`/`الكويت`/`قطر` (Arabic) | ❌ Same |
| data_engine.db | historical_data | `السعودية`/`الأسهم الأمريكية`/`العملات`/`الذهب والفضة`/`مؤشرات عالمية` (Arabic descriptors) | ❌ Yet another scheme |
| news.db | market_news | `market` = `'general'` for ALL rows; real market in `market_code` column | ❌ Broken filter |
| news.db | news_articles | Same — `market_code` only meaningful column | ❌ Same |

### 7.2 `news.db.market_news.market` field is dead data

Verified: ALL 4,428 rows have `market = 'general'`. The `/api/news` route filters on `market = ?` (line 130), so:

```
GET /api/news?market=EGX      → returns 0 rows (no row has market='EGX')
GET /api/news?market=TADAWUL  → returns 0 rows
GET /api/news?market=general  → returns all 4,428 rows (unfiltered)
GET /api/news                  → returns all 4,428 rows (unfiltered)
```

The real market is in `market_code` (with values GENERAL/EGX/QSE/KSE/TADAWUL) but **the API never queries this column**. The news UI shows ZERO market-specific news for non-EGX users.

### 7.3 Missing market field

| Table | Missing market field? | Impact |
|-------|----------------------|--------|
| `predictions.db.real_predictions` | ✅ MISSING | Cannot filter 95 mixed-market tickers |
| `price_history.db.price_history` | ✅ MISSING | Requires cross-DB join |
| `predictions.db.global_predictions` | Has field, but EGX-only | Need to seed other markets |
| `stocks.db.market_indices` | ✅ MISSING | Hard to add TASI/BKP/QE_INDEX indices |

### 7.4 Dead `importance` and `is_catalyst` columns in news

All 4,428 news rows have `importance = 0` and `is_catalyst = 0`. The admin panel has a `min_importance` filter (per worklog PHASE2-ADMIN-PANEL) — it will return 0 results for any non-zero threshold.

### 7.5 TADAWUL naming variants in stocks.db

Verified: stocks.db stores **`'TADAWUL'`** (not 'KSA' or 'السعودية'). This means:
- `WHERE market = 'TADAWUL'` → works
- `WHERE market = 'KSA'` → 0 rows
- `WHERE market = 'السعودية'` → 0 rows

The Phase 3 helper `buildMarketFilter('TADAWUL')` correctly produces `market IN ('TADAWUL','KSA','السعودية')` to handle all variants — but only 5 routes use it.

---

## Critical Issues

### 🔴 P0 — News filter completely broken (multi-market)
- `news.db.market_news.market` is always `'general'`; the real market is in `market_code` column.
- `/api/news` route filters on `market` column → returns 0 news for any non-EGX market.
- **Fix**: Change route to filter on `market_code` (with `normalizeMarket()` applied for alias handling). Also backfill `market` column from `market_code` for backward compat.
- **Impact**: All non-EGX users see empty news feed.

### 🔴 P0 — SQL injection in `/api/maker-radar/route.ts:109`
```ts
const marketFilter = market === 'EGX'
  ? `AND market IN ('EGX','مصر')`
  : `AND market = '${market}'`;  // ← unsanitized user input
```
- Direct string interpolation of user-supplied query param.
- **Fix**: Use `buildMarketFilter(normalizeMarket(market))` from `market-utils.ts`.
- **Impact**: Anyone with browser access can read all stocks rows; potential for `UNION SELECT` attacks on other tables.

### 🔴 P0 — No radar cache files exist on disk
- `scripts/output/` has only `.md` summaries; no `.json` cache.
- `/api/maker-radar` always returns `503 warming_up: true`.
- **Fix**: Either (a) run `python3 scripts/maker_radar.py --market=EGX --json-only` to bootstrap cache, or (b) check the Python script's JSON output path.
- **Impact**: The Maker Radar feature is effectively non-functional for ALL markets.

### 🔴 P0 — TADAWUL persona_predictions gap
- `persona_predictions` table has 0 TADAWUL rows (vs 1,514 EGX + 508 KSE + 198 QSE).
- Persona tab for TADAWUL users shows empty state.
- **Fix**: Run persona prediction generator for TADAWUL (likely `scripts/generate_persona_predictions.py` or equivalent).

### 🟠 P1 — US market has no `MarketProfile` in Python
- `unified_config.py:MARKET_PROFILES` has EGX/KSA/KSE/QSE/DFM/CRYPTO — NO `'US'` entry.
- Any analysis request with `market='US'` raises `ValueError`.
- **Fix**: Add a `'US': MarketProfile(...)` entry mirroring the DFM profile (currency=USD, strategy=Swing, ATR clamp [2.5%, 5%]).
- **Impact**: `/api/v2/unified/analyze` for US stocks always fails (or returns 500).

### 🟠 P1 — Trading hours drift between TS and Python
| Market | Python (market_config.py) | TS (market-hours.ts) | Multi-market radar UTC |
|--------|---------------------------|---------------------|------------------------|
| EGX | 10:00-14:30 | 10:00-15:00 | 08:00-12:30 ❌ |
| KSE | 09:00-13:30 | 08:00-12:45 | 06:00-10:30 ❌ |
| QSE | 09:00-13:00 | 09:30-13:00 | 06:00-10:00 ❌ |

- The Phase 3 fix corrected `market-hours.ts` but **never synced to `market_config.py`**.
- Python `is_market_open()` will report different status than the TS UI for EGX/KSE/QSE.
- **Fix**: Sync `market_config.py` to match `market-hours.ts`. Multi-market radar UTC constants need full audit (recompute from local hours + DST-aware conversion).

### 🟠 P1 — Hardcoded `WHERE market = 'EGX'` in 2 routes
1. `src/app/api/live-monitor/route.ts:192` — LiveMonitor widget shows EGX stocks regardless of selected market.
2. `src/app/api/market/sectors/intelligence/route.ts:273` — Sector intelligence hardcoded to EGX.

**Fix**: Read `market` from query params and use `buildMarketFilter()`.

### 🟠 P1 — 5 duplicate alias maps; TADAWUL→KSA vs TADAWUL→TADAWUL contradiction
- `store.ts:MARKET_CODES['TADAWUL'] = 'KSA'` (sends KSA to API)
- `market-utils.ts:MARKET_ALIASES['ksa'] = 'TADAWUL'` (canonical is TADAWUL)
- `market-data-access.ts:MARKET_ALIASES['tadawul'] = 'TADAWUL'`
- `egx-db.ts:FRONTEND_TO_ARABIC_MARKET['TADAWUL'] = 'السعودية'`
- `daily-picks/route.ts:MARKET_MAP['KSA'] = 'TADAWUL'`

**Fix**: Delete all duplicates; replace usages with `normalizeMarket()`, `sqlMarketVariants()`, `pythonMarketCode()`, and `marketCodeToArabic()` from `market-utils.ts`. Standardize the canonical form to `'TADAWUL'` (matches stocks.db).

### 🟡 P2 — `DevelopmentNotice.tsx` includes non-existent markets
- `DEVELOPMENT_MARKETS = ['TADAWUL','KSE','DFM','BSE','QSE','US']` — `'DFM'` and `'BSE'` are not valid `MarketType` values.
- TypeScript error suppressed by 1,258-baseline error noise.
- **Fix**: Remove `'DFM'` and `'BSE'` from the array.

### 🟡 P2 — MakerRadarTab publish hashtags hardcoded for EGX
- Line 2108: `hashtags={['EGX', 'رادار_الميكرز', 'بورصة_مصر']}`
- Line 2767: `hashtags={['رادار_السيولة', 'EGX', 'بورصة_مصر', 'تداول', 'استثمار']}`
- TADAWUL user publishing to social gets EGX hashtags.
- **Fix**: Derive from `currentMarket` via `MARKET_CODES` or `MARKET_NAMES_AR`.

### 🟡 P2 — `real_predictions` table lacks `market` column
- 95 tickers, 91 are 4-digit numeric (TADAWUL), 4 are alpha (likely EGX).
- Cannot filter by market.
- **Fix**: Add `market TEXT` column and backfill from ticker pattern (4-digit → TADAWUL, alpha → EGX).

### 🟡 P2 — `price_history.db` lacks `market` column
- 274,574 rows / 762 tickers, with 196 unmapped.
- Each query requires a JOIN with stocks.db.
- **Fix**: Add `market TEXT` column; backfill from `stocks.db.stocks` via ticker; for unmapped tickers, infer from pattern (bond → EGX, crypto → CRYPTO).

### 🟡 P2 — Persona predictions engine skips TADAWUL
- 0 TADAWUL rows in `persona_predictions` (vs 1,514 EGX).
- Likely the generator script (`generate_persona_predictions.py`) wasn't run for TADAWUL.
- **Fix**: Run `python3 vps-service/scripts/generate_persona_predictions.py --market=TADAWUL`.

### 🟡 P2 — Daily predictor is EGX-only
- `daily_predictor.py:387` has EGX-MARKET-ISOLATION gate.
- Non-EGX predictions in `predictions.db` come from other generators (backfill scripts).
- Live daily predictions for TADAWUL/KSE/QSE will not be generated by cron.
- **Fix**: Either remove the EGX-isolation gate (with proper safeguards) or run a separate daily predictor per market.

### 🟢 P3 — `MARKET_CURRENCY_LABEL` only in frontend
- Defined in `store.ts:596` but not mirrored in Python.
- If a market's currency changes (e.g., Lebanon redenomination), they'd diverge.

### 🟢 P3 — `MarketRegimeBanner` import unused
- `MakerRadarTab.tsx:52` imports `MarketRegimeBanner` but it's not always rendered for non-EGX markets.

### 🟢 P3 — Dashboard widgets missing for non-EGX
- `MarketSummary`, `IndexCards`, `MarketPulse`, `MarketSentiment` only render for EGX.
- For TADAWUL/KSE/QSE/US, the dashboard has gaps where these widgets would be.
- **Fix**: Either (a) generalize widgets to accept any market, or (b) build per-market equivalents.

---

## Recommendations

### Immediate (P0 — this week)

1. **Fix news filter** — Switch `/api/news` route to filter on `market_code` instead of `market`. Apply `normalizeMarket()` to handle TADAWUL/KSA/السعودية aliases.
2. **Patch SQL injection** in `/api/maker-radar/route.ts:109` — Replace with `buildMarketFilter(normalizeMarket(market))`.
3. **Bootstrap radar cache** — Run `python3 scripts/maker_radar.py --market=EGX --json-only` for each market to seed `maker_radar_{MARKET}_*.json` files.
4. **Run persona generator for TADAWUL** — Backfill the 0-row gap.

### Short-term (P1 — next 2 weeks)

5. **Add US MarketProfile** to `unified_config.py:MARKET_PROFILES` (mirror DFM with USD currency).
6. **Sync Python trading hours** in `market_config.py` to match `market-hours.ts` for EGX/KSE/QSE.
7. **Fix multi-market radar UTC constants** — compute from local hours + DST-aware offset (don't hardcode 06:00-10:30 for KSE).
8. **Remove hardcoded `WHERE market = 'EGX'`** in `live-monitor/route.ts` and `sectors/intelligence/route.ts`.
9. **Consolidate alias maps** — delete `MARKET_CODES` (store.ts), `MARKET_ALIASES` (market-data-access.ts), `FRONTEND_TO_ARABIC_MARKET` (egx-db.ts), `MARKET_MAP` (daily-picks/route.ts). Replace all usages with helpers from `market-utils.ts`. Standardize TADAWUL as canonical (matches stocks.db).
10. **Apply `market-utils.ts` helpers to remaining ~20 routes** that still do raw string comparison (audit the `grep "WHERE market = 'EGX'"` results).

### Medium-term (P2 — next month)

11. **Add `market` column** to `real_predictions` and `price_history` tables. Backfill via ticker→market join.
12. **Remove dead `'DFM'` and `'BSE'`** from `DevelopmentNotice.tsx`.
13. **Generalize dashboard widgets** (`MarketSummary`, `IndexCards`) to accept market parameter and show TASI for TADAWUL, BKP for KSE, QE_INDEX for QSE.
14. **Build per-market index seed data** in `stocks.db.market_indices` (TASI, BKP, QE_INDEX, SPY for US).
15. **Run persona generator for US** once US MarketProfile exists.
16. **Add a daily predictor variant** that runs per-market (not EGX-only) so non-EGX predictions stay fresh.
17. **Run market-aware radar warmup cron** for all 6 markets (currently cron likely only fires for EGX).

### Long-term (P3)

18. **Add unit tests for `normalizeMarket()`** covering all 6 canonical markets + aliases (TADAWUL/KSA/السعودية/saudi/تداول, etc.).
19. **Add CI check** that prevents new `WHERE market = '...'` literals without using `buildMarketFilter()`.
20. **Reconcile `data_engine.db.stocks` and `stocks.db.stocks`** — pick one as the source of truth and migrate the other to a view or remove it.
21. **Build a "Market Status Dashboard" admin view** showing per-market data freshness, prediction counts, news counts, and radar cache status — so the team can spot gaps early.
22. **Document the canonical market codes** in `Documentation/01-PROJECT_ANATOMY.md` §1.6 — clarify that:
    - Canonical code: `'TADAWUL'` (NOT `'KSA'`)
    - stocks.db stores: `'TADAWUL'`
    - Python `MARKET_PROFILES` key: `'KSA'` (legacy, requires `pythonMarketCode()` shim)
    - data_engine.db stores: `'السعودية'` (Arabic, requires `marketCodeToArabic()` shim)

---

## Audit Methodology

- **Read** `worklog.md` last 200 lines to understand Phase 3 context.
- **Inspected** all 9 SQLite DBs via Python `sqlite3` module (sqlite3 CLI not installed).
- **Counted** rows per market per table for: stocks.db, predictions.db, price_history.db, data_engine.db, news.db.
- **Read** `src/lib/market-utils.ts` (195 lines), `src/lib/market-hours.ts` (238 lines), `src/components/shared/MarketSelector.tsx`, `src/components/layout/ExchangeSelector.tsx`, `src/modules/dashboard/components/DevelopmentNotice.tsx`, `src/modules/dashboard/components/DashboardView.tsx` (280 lines), `src/modules/predictions/components/MakerRadarTab.tsx` (200 lines), `src/app/api/maker-radar/route.ts`, `src/app/api/maker-radar/multi-market/route.ts` (426 lines), `src/app/api/stocks/route.ts`, `src/app/api/stocks/[ticker]/unified/route.ts`, `src/app/api/v2/unified/analyze/route.ts` (130 lines), `src/app/api/predictions/daily-picks/route.ts` (90 lines), `src/app/api/news/route.ts` (200 lines), `src/app/api/live-monitor/route.ts` (40 lines), `src/modules/radar/lib/radar-cache.ts` (420 lines), `src/lib/store.ts` (160 lines of relevant section), `src/lib/market-data-access.ts` (130 lines), `src/lib/egx-db.ts` (greps).
- **Read Python** `vps-service/config/unified_config.py` (819 lines), `vps-service/config/market_config.py` (100 lines), `vps-service/jobs/daily_predictor.py` (greps), `scripts/maker_radar.py` (190 lines).
- **Cross-checked** trading hours between `market-hours.ts`, `market_config.py`, and `multi-market/route.ts` UTC constants.
- **Verified** ticker collisions via SQL (`SELECT ticker, COUNT(DISTINCT market) … HAVING > 1`).
- **Greps**: 18 distinct searches for hardcoded `'EGX'`, `MARKET_CODES`, `MARKET_ALIASES`, `WHERE market = 'EGX'`, `currentMarket`, `MARKET_PROFILES`, `market_code`.

**Constraints honored**:
- ❌ NO code modifications.
- ❌ NO communication with other teams.
- ✅ Focused exclusively on multi-market perspective.
