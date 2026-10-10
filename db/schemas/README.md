# Database Schemas (Canonical — v3.65.1+)

> **Superseded by**: `Documentation/DB_ARCHITECTURE.md` (the canonical, up-to-date reference)
> **This file**: kept for backward-compat; only points at the canonical docs.

---

## 📦 الـ 6 قواعد بيانات المعتمدة

| # | DB | Purpose | Tables |
|---|----|---------|--------|
| 1 | `stocks.db` | الأسهم + screener + signal_logs + outcome_logs + stock_daily_prices (fallback) | 15 |
| 2 | `price_history.db` | **THE single source** for price history (load_price_history reads this first) | 1 |
| 3 | `data_engine.db` | scraper data (gold/crypto/exchange/silver) + fundamentals (tab_*) + working copy of stocks | 17 |
| 4 | `intraday.db` | 5-min intraday snapshots (stock/crypto/commodity) — isolated, no overlap | 4 |
| 5 | `predictions.db` | stored_analyses + predictions + prediction_logs + ExpertRecommendation | 10 |
| 6 | `auth.db` | NextAuth users + portfolios + watchlists + subscriptions + api_tokens | 13 |

> **⚠️ Removed**: `custom.db` (was a Prisma tutorial default, empty, deleted in v3.65.1).
> **⚠️ Not yet canonical**: `historical.db` (175K rows, used by `data_engine/scrapers/historical_fetcher.py` + `src/lib/market-data-access.ts`) — see `Documentation/DB_CLEANUP_PLAN_v3.65.1.md` P1-1.

---

## 📐 Canonical architecture

Full details: **`Documentation/DB_ARCHITECTURE.md`**

Key rules:
1. `stocks` table exists in **both** stocks.db (canonical read source) AND data_engine.db (scraper working copy). `data_engine/sync.py:sync_current_prices()` UPSERTs from data_engine.db → stocks.db. **This is by design, NOT a bug.**
2. `gold_prices` canonical = **data_engine.db** (77K rows, live). The `stocks.db.gold_prices` (3 stale rows) is a BUG being fixed in v3.65.1.
3. `price_history.db.price_history` is the PRIMARY source for `load_price_history()`. `stocks.db.stock_daily_prices` is a FALLBACK.
4. `predictions` family lives ONLY in `predictions.db` (migrated from stocks.db in v3.65.0).
5. `intraday.db` has NO overlap with stocks.db or data_engine.db.
6. `auth.db` is the ONLY place for user/portfolio/watchlist data.

---

## 🚫 Removed (DO NOT recreate)

- `custom.db` — Prisma tutorial default, was empty, deleted v3.65.1
- `egx_investment.db` — old name, consolidated into stocks.db in v3.65.0
- `gold_prices.db` — never existed (alias pointed at non-existent file); gold_prices canonical = data_engine.db
- `stocks.db.{predictions, prediction_logs, ExpertRecommendation, stocks_backup, egksco_*, news, news_items, morning_reports, financial_obligations, financial_transactions, obligation_payments, indicator_weights, regime_indicator_weights, learned_lessons, maestro_personas, stock_price_history}` — all DROPPED in v3.65.0 cleanup
- `data_engine.db.lost_and_found` — SQLite junk, DROPPED in v3.65.0

---

## 🔧 Connection gateways

**Python** (`vps-service/`):
```python
from vps-service.core.db_manager import db_manager, get_connection
from vps-service.utils.db_paths import DBPaths
# DBPaths.STOCKS_DB, PREDICTIONS_DB, PRICE_HISTORY_DB, DATA_ENGINE_DB, INTRADAY_DB, AUTH_DB
```

**TypeScript** (`src/`):
```typescript
import { openDb, getStocksDb, getPredictionsDb, getDataEngineDb } from '@/lib/shared-db';
import { authDb } from '@/lib/db-auth';             // Prisma → auth.db
import { prisma as predictionsDb } from '@/lib/db-predictions';  // Prisma → predictions.db
```

---

## 📚 See also

- **`Documentation/DB_ARCHITECTURE.md`** — full canonical reference (data flow, schemas, gateways)
- **`Documentation/DB_CLEANUP_PLAN_v3.65.1.md`** — cleanup priorities (P0/P1/P2)
- **`db/CANONICAL_DB_INVENTORY.md`** — post-v3.65.0 inventory (row counts per table)
- **`db/db_inventory_post_cleanup.json`** — machine-readable inventory
- **`db/schemas/02_egx_investment_db_schema.sql`** — legacy schema (historical reference only)
