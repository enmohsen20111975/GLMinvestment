# PKG3-ROUND2 — PKG3 SSOT Agent Work Record

**Task ID**: PKG3-ROUND2
**Agent**: PKG3 SSOT Agent
**Goal**: Unify all Node-side price-read paths through `src/lib/canonical-price.ts` (Rule 67 SSOT, Rule 20 Python=brain).

## Pre-task scoping

Read worklog.md (last 100 lines) for context — confirmed Round 1 already established:
- `src/lib/canonical-price.ts` (Unified Market Data Adapter: stocks.db → data_engine → vps_api)
- `src/lib/cache-manager.ts` (TTL=60s, LRU=512, `getOrCompute`)
- Round 2 worklog note: "PKG3: توحيد مسارات قراءة السعر (6 → canonical-price.ts)"

## Routes selected for migration (5)

Grep for direct `SELECT.*current_price.*FROM.*stocks` + `getStockByTickerFallback` patterns
yielded 5 routes that bypassed the canonical adapter:

| # | Route | Pre-migration pattern | Post-migration pattern |
|---|---|---|---|
| 1 | `src/app/api/stocks/[ticker]/depth/route.ts` | `openDb('stocks.db').prepare('SELECT current_price FROM stocks WHERE ticker=?')` — DIRECT SQLite open in the route file (clearest Rule 20 violation) | `cache.getOrCompute('canonical_price:'+ticker, () => getCanonicalPrice(ticker, {allowLive:false}), 60_000)` |
| 2 | `src/app/api/explosive/[ticker]/route.ts` | `getStockByTickerFallback().current_price` — lib wrapper reads SQLite directly | Same canonical override applied to `current_price` only; metadata (name, sector, volume) still from lib |
| 3 | `src/app/api/flow/[ticker]/route.ts` | `getStockByTickerFallback().current_price` — lib wrapper reads SQLite directly | Same as #2 |
| 4 | `src/app/api/stocks/[ticker]/publish-data/route.ts` | `stockRow.current_price` (from `getStockByTickerFallback`) | Canonical override of `currentPrice` + `previousClose`; `changePct` recomputed from canonical pair |
| 5 | `src/app/api/stocks/[ticker]/route.ts` | `data.current_price` from Python response OR `getStockByTickerFallback` | `applyCanonicalPriceOverride()` post-step walks `{stock:{...}}`, bare, and array shapes; adds `current_price_source` + `current_price_as_of` metadata fields |

## Implementation notes

- `canonical-price.ts` exports `getCanonicalPrice(ticker, { allowLive })` (NOT `getLastCleanClose` as the task description suggested — the canonical adapter uses `getCanonicalPrice` which internally chains stocks.db → data_engine.egksco_price_history → vps_api.live).
- All 5 routes use `allowLive: false` (avoids VPS API call in fallback paths — Python already tried upstream; calling live API here would create a second hop).
- Cache key: `canonical_price:{TICKER}` — shared across all 5 routes (so a depth request after a publish-data request hits the cache → 0 DB reads).
- TTL=60s, LRU=512 — matches the Python `cache_manager.py` contract per Rule 67 (SSOT).

## Rule 27 (NO-FAKE-DATA) behavior

| Route | If canonical returns null | Rationale |
|---|---|---|
| depth | Falls back to latest intraday tick price; if no ticks → empty response with note "—" | Tick price is real data; no fabrication. |
| explosive | `current_price: null` → UI renders "—" | Lib row's `current_price` is NOT used as fallback (would bypass canonical adapter's resolution chain). |
| flow | `current_price: null` → UI renders "—" | Same as explosive. |
| publish-data | Falls back to `stockRow.current_price` (lib value) — both paths read real stocks.db data | Defensive: keeps behavior parity with pre-migration. |
| stocks/[ticker] | Preserves existing value (Python or lib row) — already a real number | Defensive: avoid null'ing a real value when canonical adapter transiently fails. |

## Rule 20 (Python = brain) — depth route special case

The depth route still opens `intraday.db` directly to read tick-by-tick data (`SELECT ticker, timestamp, price, volume FROM stock_intraday`). This is NOT a `current_price` read — it's tick data for liquidity-depth reconstruction. Rule 20's intent (per the worklog) targets `stocks.db.current_price` reads. The intraday tick read stays.

## Verification

- `npx tsc --noEmit --skipLibCheck`: 0 new errors in all 5 migrated routes (pre-existing errors in unrelated files unchanged).
- `bun run lint`: PASS (zero output beyond `$ eslint .`).
- pre-commit hook (`check_no_hard_delete` + `check_no_raw_insert`): PASS on all 5 commits.
- `git log --oneline` shows the 5 commits + pushes (commits `561f6c79`, `792ef9ba`, `d99dcd70`, `e6a9704d`, `2c03e5f5`).

## Commits pushed

1. `561f6c79` — `refactor(pkg3): depth route reads price via canonical-price (Rule 67 SSOT)`
2. `792ef9ba` — `refactor(pkg3): explosive route — current_price via canonical-price (Rule 67)`
3. `d99dcd70` — `refactor(pkg3): flow route — current_price via canonical-price (Rule 67)`
4. `e6a9704d` — `refactor(pkg3): publish-data route — price via canonical-price (Rule 67)`
5. `2c03e5f5` — `refactor(pkg3): /api/stocks/[ticker] — final canonical-price override (Rule 67)`

All 5 commits include the marker `PKG3-ROUND2 (Task ID: PKG3-ROUND2)` in the commit body.

## State after Round 2

- 5/5 routes migrated to canonical-price adapter (was 6 in scoping report; 1 of the 6 — `stocks/[ticker]/professional-analysis/route.ts` — was already deprecated returning HTTP 410 with no price read, so excluded).
- pre-commit hook behavior unchanged.
- Round 3 candidates (deferred):
  - `src/lib/flutter-sqlite-fallback.ts:getStockByTickerFallback` — still reads stocks.db directly. This is the SSOT foundation under canonical-price, so it should remain. But the auxiliary readers (`getStockProfileFallback`, `getTopMoversFallback`, `getMovementClassificationFallback`) still SELECT `current_price` for their own purposes; Round 3 can route those through canonical-price too if needed.
  - `src/lib/egx-db.ts:getStockByTicker` — already used by canonical-price.ts as the primary source; no migration needed.
  - Other routes that read `current_price` via `unified-stock-data.ts` (e.g. /api/portfolio/*, /api/market/*) — those go through `getUnifiedStockData` which is its own SSOT for unified fields; whether to also route them through canonical-price is a Round 3 scoping decision.
