# US-SCRAPER — Report

**Task ID:** US-SCRAPER
**Agent:** Python Engineer (US stock data scraper)
**Date:** 2026-09-28
**Status:** ✅ COMPLETE

---

## 1. Summary

The project had NO scraper that actually fetched US stock prices, despite the
frontend + radar scripts already supporting the US market. This task adds:

1. **`data_engine/scrapers/us_stock_scraper.py`** — fetches daily OHLCV for the
   top 50 US stocks (S&P 50 top components) from Yahoo Finance and writes
   them to `db/price_history.db` with `source='yahoo_us'`, `market='US'`,
   `adjusted=0`.
2. **`data_engine/scrapers/multi_market_scraper.py`** — a unified orchestrator
   that runs all 4 market scrapers (EGX + US + Crypto + Metals) in sequence,
   with graceful degradation (one market failing doesn't stop others).
3. **`crontab.txt`** — added 2 new cron entries (#17 US scraper at 22:00 UTC,
   #18 Multi-market scraper hourly 09:00-22:00 UTC).
4. **`data_engine/scrapers/smart_scheduler.py`** — wired the US scraper into
   the smart scheduler with market-aware intervals (5 min during US market
   hours 14:30-21:00 UTC, 1 hour EOD refresh otherwise).

---

## 2. New Files Created

| File | LOC | Description |
|------|-----|-------------|
| `data_engine/scrapers/us_stock_scraper.py` | ~440 | Yahoo Finance → price_history.db (50 US tickers, batch fetch, INSERT OR REPLACE) |
| `data_engine/scrapers/multi_market_scraper.py` | ~290 | Subprocess orchestrator for EGX + US + Crypto + Metals with fallback chains |

---

## 3. Modified Files

| File | Changes |
|------|---------|
| `data_engine/scrapers/smart_scheduler.py` | Added `us_stocks` task to `SCRIPTS` dict; added `US_STOCKS_INTERVAL_INTRA` (5 min) + `US_STOCKS_INTERVAL_EOD` (1 hr); added `is_us_market_open()` helper (NYSE/NASDAQ 14:30-21:00 UTC, Mon-Fri); wired US scraper into `run_smart_refresh()`; added US market to `markets_info` status file; rewrote `calculate_next_run()` to consider US market hours |
| `crontab.txt` | Added entry #17 (US scraper — daily 22:00 UTC Mon-Fri) and entry #18 (multi-market scraper — hourly 09-22 UTC) |
| `scripts/seed_us_stocks.py` | Already existed; ran it to seed 50 US stocks into `db/stocks.db` |

---

## 4. Coverage: 50 US Stocks

The scraper covers the top 50 US stocks by market cap (seeded via
`scripts/seed_us_stocks.py`):

```
AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, BRK.B, JPM, V,
JNJ, WMT, MA, PG, UNH, HD, CVX, MRK, ABBV, PFE,
KO, PEP, BAC, TMO, COST, AVGO, MCD, CRM, AMD, NFLX,
ACN, ADBE, DHR, ORCL, CMCSA, NEE, TXN, WFC, PM, IBM,
MS, QCOM, RTX, HON, UPS, INTC, CAT, BA, GE, GM
```

**Sectors covered:** Technology, Financials, Healthcare, Consumer Staples,
Consumer Discretionary, Communication Services, Energy, Industrials, Utilities.

---

## 5. Architecture Decisions

### 5.1 Yahoo Finance ticker handling
- **US tickers need no suffix** (unlike EGX `.CA`, TADAWUL `.SR`, KSE `.KW`).
- **Special case for share classes:** Yahoo uses hyphen (`-`) for share-class
  separators, not period (`.`). So `BRK.B` → `BRK-B` when querying Yahoo.
  This is handled in `_yahoo_symbol()`.
- A Yahoo-symbol-to-original-ticker map is built so the scraper can attribute
  rows to the original ticker (e.g., `BRK.B`) even after the Yahoo symbol
  transformation.

### 5.2 Batch fetching
- yfinance supports batch download of up to 10 tickers per call via
  `yf.download("AAPL MSFT GOOGL ...", period="30d", interval="1d",
  group_by="ticker")`.
- This is 10× more efficient than 50 sequential single-ticker calls.
- The scraper processes tickers in batches of 10 (configurable via
  `--batch-size` flag, capped at 20 for rate-limit safety).
- Rate-limit delay: 0.3 seconds between batches (matches the EGX yahoo scraper
  convention).

### 5.3 Schema forward-compatibility
- The actual production schema (per `agent-ctx/_audit_data.json`) is:
  ```sql
  CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      open_price REAL, high_price REAL, low_price REAL, close_price REAL,
      volume INTEGER,
      source TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now')),
      adjusted INTEGER DEFAULT 0,
      market TEXT,
      UNIQUE(ticker, date)
  )
  ```
- The `price_history_safetynet.py` script creates the table WITHOUT the
  `adjusted` and `market` columns. The US scraper handles both cases:
  - `CREATE TABLE IF NOT EXISTS` with the full schema (idempotent).
  - `ALTER TABLE price_history ADD COLUMN adjusted/market` wrapped in try/except
    to add the columns to existing tables (forward-compat).
- `INSERT OR REPLACE` works regardless of whether the dedup key is
  `UNIQUE(ticker, date)` or `PRIMARY KEY (ticker, date, source)`.

### 5.4 Status files
- US scraper status: `data/us_scraper_status.json` (per task brief).
- Multi-market status: `data/multi_market_scraper_status.json`.
- Smart scheduler status: `db/auto_refresh_status.json` (unchanged).

### 5.5 yfinance version compatibility
- yfinance 1.7 removed the `raise_errors` kwarg from `download()`.
- The scraper relies on try/except + empty-DataFrame check instead.
- The sandbox venv had yfinance 1.7.0 (installed during this task).

---

## 6. Test Results

### 6.1 Syntax verification ✅
```bash
$ python3 -c "import ast; ast.parse(open('data_engine/scrapers/us_stock_scraper.py').read())"
$ python3 -c "import ast; ast.parse(open('data_engine/scrapers/multi_market_scraper.py').read())"
$ python3 -c "import ast; ast.parse(open('data_engine/scrapers/smart_scheduler.py').read())"
```
All three files parse without errors.

### 6.2 Dry-run test ✅
```bash
$ python3 data_engine/scrapers/us_stock_scraper.py --dry-run
🇺🇸  US Stock Scraper — Yahoo Finance → price_history.db
📡 US scraper: 50 tickers | period=30d | batch=10 | dry_run=True
    1. AAPL
    2. ABBV
    ...
   50. WMT
✅ [DRY-RUN] Would fetch 50 tickers — no network/DB writes
```
Listed all 50 tickers without making any network calls or DB writes. ✅

### 6.3 Live AAPL + MSFT test ✅
```bash
$ python3 data_engine/scrapers/us_stock_scraper.py --tickers AAPL,MSFT --days 5
✅ DONE | processed=2 updated=2 failed=0 rows_inserted=10
```
Inserted 10 rows (5 days × 2 tickers) into `db/price_history.db`.

### 6.4 DB verification ✅
```python
>>> cur.execute("SELECT ticker, date, close_price FROM price_history WHERE market='US' ORDER BY date DESC LIMIT 10").fetchall()
[('AAPL', '2026-09-25', 341.07),
 ('MSFT', '2026-09-25', 516.17),
 ('AAPL', '2026-09-24', 335.92),
 ('MSFT', '2026-09-24', 497.93),
 ('AAPL', '2026-09-23', 337.02),
 ('MSFT', '2026-09-23', 500.59),
 ('AAPL', '2026-09-22', 339.75),
 ('MSFT', '2026-09-22', 498.0),
 ('AAPL', '2026-09-21', 338.98),
 ('MSFT', '2026-09-21', 501.61)]
```
All 10 rows present with correct OHLCV + `source='yahoo_us'`, `market='US'`,
`adjusted=0`.

### 6.5 Full 50-ticker production run ✅
```bash
$ python3 data_engine/scrapers/us_stock_scraper.py --days 30
✅ DONE | processed=50 updated=50 failed=0 rows_inserted=1500
```
**1,500 rows inserted** (50 tickers × 30 days). Runtime: ~5 seconds thanks to
batch fetching + yfinance threading.

### 6.6 Multi-market orchestrator test ✅
```bash
$ python3 data_engine/scrapers/multi_market_scraper.py --market US
✅ [US] primary succeeded (8.93s)
📊 DONE | 1/1 markets succeeded | runtime=8.93s
```
End-to-end subprocess execution works.

### 6.7 BRK.B special case ✅
After the initial run, `BRK.B` (Berkshire Hathaway class B) failed because
Yahoo uses `BRK-B`. After the fix (replacing `.` with `-` for Yahoo symbols),
BRK.B succeeds:
```bash
$ python3 data_engine/scrapers/us_stock_scraper.py --tickers BRK.B --days 5
✅ DONE | processed=1 updated=1 failed=0 rows_inserted=5
   last_close: 505.48
```

### 6.8 Smart scheduler integration ✅
```python
>>> from data_engine.scrapers.smart_scheduler import is_us_market_open
>>> is_us_market_open()
False  # 08:47 UTC is before US market open at 14:30 UTC ✅
>>> US_STOCKS_INTERVAL_INTRA, US_STOCKS_INTERVAL_EOD
(300, 3600)  # 5 min intraday, 1 hr EOD ✅
```

---

## 7. Cron Jobs Added

### Entry #17 — US Stock Scraper
```cron
# ─── 17. US Stock Scraper — جلب أسعار الأسهم الأمريكية ──────────────────
# يومياً 22:00 UTC (00:00 Cairo — بعد إغلاق السوق الأمريكي بساعة)
0 22 * * 1-5 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python3 data_engine/scrapers/us_stock_scraper.py >> /tmp/us_scraper.log 2>&1
```
- Runs daily Mon-Fri at 22:00 UTC (00:00 Cairo).
- US market closes at 21:00 UTC; we run at 22:00 to ensure Yahoo has EOD data.

### Entry #18 — Multi-Market Scraper
```cron
# ─── 18. Multi-Market Scraper — تشغيل كل السكرابرز ────────────────────
# كل ساعة خلال ساعات السوق العالمية (09:00-22:00 UTC = 11:00 Cairo-00:00 Cairo)
0 9-22 * * * cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python3 data_engine/scrapers/multi_market_scraper.py >> /tmp/multi_scraper.log 2>&1
```
- Runs hourly during 09:00-22:00 UTC (when at least one global market is open).
- Triggers all 4 scrapers (EGX + US + Crypto + Metals) in sequence.

---

## 8. Smart Scheduler Integration

The `smart_scheduler.py` now considers US market hours in its scheduling:

| Market State | Wait Interval | Rationale |
|--------------|---------------|-----------|
| EGX/TADAWUL/KSE/QSE open | 2 min (`STOCKS_INTERVAL`) | Most aggressive — Arabic markets are open |
| US market open (14:30-21:00 UTC, Mon-Fri) | 5 min (`US_STOCKS_INTERVAL_INTRA`) | Pull intraday US data |
| All markets closed | 1 hour (`US_STOCKS_INTERVAL_EOD`) | Light EOD refresh |

`is_us_market_open()` returns True only on Mon-Fri between 14:30-21:00 UTC.

---

## 9. Database State After Testing

```sql
-- All US rows in price_history.db
SELECT COUNT(*) FROM price_history WHERE market='US' AND source='yahoo_us';
-- → 1500

-- Distinct US tickers
SELECT COUNT(DISTINCT ticker) FROM price_history WHERE market='US';
-- → 50

-- Date range
SELECT MIN(date), MAX(date) FROM price_history WHERE market='US';
-- → '2026-08-14', '2026-09-25'

-- Schema (verified via PRAGMA table_info)
-- id INTEGER PRIMARY KEY AUTOINCREMENT
-- ticker TEXT NOT NULL
-- date TEXT NOT NULL
-- open_price REAL
-- high_price REAL
-- low_price REAL
-- close_price REAL
-- volume INTEGER
-- source TEXT DEFAULT 'system'
-- created_at TEXT DEFAULT (datetime('now'))
-- adjusted INTEGER DEFAULT 0
-- market TEXT
-- UNIQUE(ticker, date)
```

---

## 10. Constitution Compliance

- **Rule 27 (no mock data):** The scraper fetches REAL OHLCV from Yahoo
  Finance — no synthetic data, no placeholders.
- **Rule 32 (Python is brain):** All scraping happens in Python; Next.js
  reads from `price_history.db` via existing portable DB helpers (no schema
  changes, no new API endpoints needed).
- **Rule 1 (DB safety):** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` with
  try/except — idempotent, non-destructive. `INSERT OR REPLACE` is safe.
- No frontend changes needed — the existing radar/prediction code already
  supports `market='US'` (it was added by the user in a prior task).

---

## 11. Answer to the User's Question

> **User:** "أنت أضفت اسواق جديدة فين مصدر بياناتها هل ظبط فى محرك البيانات؟"
>
> **Answer:** Yes — the US market data source is now wired into the data
> engine. The `us_stock_scraper.py` fetches real OHLCV for 50 US stocks
> from Yahoo Finance, writes them to `db/price_history.db` with
> `source='yahoo_us'` + `market='US'` + `adjusted=0`, logs status to
> `data/us_scraper_status.json`, and runs automatically via cron at 22:00 UTC
> Mon-Fri + hourly via the multi-market orchestrator. The smart scheduler
> also pulls US data every 5 min during NYSE/NASDAQ market hours
> (14:30-21:00 UTC).
>
> **Verification:** 1,500 rows for 50 US tickers × 30 days successfully
> inserted into `db/price_history.db`.

---

## 12. Next Actions (Optional)

1. **Run `crontab crontab.txt`** on the VPS to install the new cron entries.
2. **Wire the US scraper status into the frontend** — the radar dashboard
   could read `data/us_scraper_status.json` to show "last US fetch: 22:00 UTC".
3. **Add US tickers to the radar scanner** — `scripts/maker_radar.py` and
   `scripts/exit_radar.py` already support `--market US`, but they may need
   the price_history data to be ingested into their analysis pipeline.
4. **Consider adding more US tickers** — expand from 50 to 100+ by editing
   `scripts/seed_us_stocks.py` (it's idempotent — re-running is safe).
5. **Add US market regime engine** — `vps-service/analyzers/market_regime_engine.py`
   currently only runs for EGX daily; could be extended to compute a US
   regime (S&P 500 / NASDAQ breadth + ATR + SMA cross).
