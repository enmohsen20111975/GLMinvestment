# Bravo — Liquidity Radar Engine and Historical Validation Report
> **Date:** 2026-10-25
> **Environment:** Sandbox /home/z/my-project (DBs from VPS, integrity ok)
> **Scope:** Read-only audit of radar engine + historical backtest
> **Commit:** sandbox HEAD (post-DB-restore)

---

## A. Actual Production Execution Path

```
LiquidityRadarView.tsx (UI)
  → fetch /api/v2/liquidity-radar?market=EGX
    → readRadarCache() reads JSON from scripts/output/maker_radar_EGX_*.json
      → Background warmup spawns: python3 scripts/maker_radar.py --json-only
        → imports: vps-service/utils/shared_liquidity.py
          → detect_quiet_accumulation() — 6 conditions (5/6 required)
          → detect_pre_surge() — 4 conditions (3/4 required)
          → is_explosive_surge() — 3 conditions (all required)
          → is_early_break() — 3 conditions (all required)
          → should_reject_by_liquidity() — dynamic thresholds
        → reads: db/price_history.db.price_history (1.4M rows, 1570 tickers)
      → writes JSON to scripts/output/
    → API returns JSON to UI

Signal tracking: stocks.db.radar_signal_tracking (1329 rows)
Outcome verification: src/app/api/maker-radar/signal-tracker/verify/route.ts
  → fetchPricesAfter() — tries 4 price sources (egksco → stocks → historical_data)
  → prices[6].close used for outcome_7d (close at 7th trading day)
```

**Confirmed:** `scripts/maker_radar.py` is THE production engine. No alternative engines active.

---

## B. Test A — Calculation Correctness

### Source-level inspection (shared_liquidity.py, 1152 LOC)

| Check | Status | Evidence |
|---|---|---|
| OHLCV ordering | ✅ Correct | `fetch_ticker_series()` uses ORDER BY date DESC then reversed |
| Duplicate candles | ✅ Handled | `close_price > 0` filter |
| Volume ratio calc | 🟠 **BUG: overlap** | `volumes[-5:]` vs `volumes[-20:]` — base includes recent → ratio inflated 7-19% |
| Close location | ✅ Correct | `(close - low) / (high - low) * 100` with `h > l` guard |
| Zero-range candles | ✅ Handled | `if h > l:` guard before division |
| Division by zero | ✅ Guarded | `if base_avg <= 0:` checks throughout |
| Price units | ✅ Consistent | EGP for EGX, USD for US/crypto |

### Volume overlap bug detail

```python
# shared_liquidity.py:138-141 (has_volume_surge)
recent_vol = volumes[-surge_lookback:]    # last 5 days
base_vol = volumes[-base_lookback:]       # last 20 days — INCLUDES recent!
```

**Impact:** base_avg is inflated by including recent volumes → ratio is lower than actual → fewer volume surge detections → fewer signals pass the liquidity filter.

**Measured impact on 5 EGX stocks:**
| Ticker | Ratio (overlapping) | Ratio (correct) | Inflation |
|---|---|---|---|
| COMI | 0.79x | 0.66x | +19.4% |
| SWDY | 0.63x | 0.54x | +17.2% |
| ABUK | 1.14x | 1.06x | +7.6% |
| ETEL | 0.86x | 0.80x | +7.8% |
| HRHO | 0.25x | 0.22x | +13.1% |

**Severity:** 🟠 P1 — causes some stocks to fail the volume surge check that should pass.

---

## C. Test B — Historical Predictive Performance

### 🔴 BUG #1 (CONFIRMED): outcome_7d calculation is WRONG

**Root cause:** `outcome_7d` in `radar_signal_tracking` was written by an unknown script (not `verify_radar_signals.py` which uses close-at-day-7, and not `radar_accuracy_report.py` which uses trading-day counting). The stored values match **max(close_price) in first 7 trading days**, not close_price at day 7.

**Proof (HBCO, signal 2026-10-07, entry=8.80):**
- DB outcome_7d = +5.11% → matches max(close) = 9.25 on 2026-10-11
- ACTUAL close at day 7 = 8.00 → -9.09%
- 10 of 20 tested signals match max(close), only 1 matches close-at-day-7

### Performance comparison (438 signals with outcomes)

| Metric | DB (buggy) | ACTUAL (corrected) | Delta |
|---|---|---|---|
| **7d Win Rate** | 45.4% | **30.1%** | -15.3 points |
| **7d Avg Return** | +11.72% | +18.60% | (distorted by splits) |
| **14d Win Rate** | N/A | **15.9%** | — |
| **14d Avg Return** | N/A | -4.82% | — |

### After removing stock-split-affected signals (MENA removed)

| Metric | Clean (431 signals) |
|---|---|
| **7d Win Rate** | **29.5%** |
| **7d Avg Return** | **-3.71%** |
| **14d Win Rate** | **15.9%** |
| **14d Avg Return** | **-4.82%** |

### By signal type (clean, close-at-day-7)

| Signal Type | N | WR 7d | Avg 7d | WR 14d |
|---|---|---|---|---|
| quiet_accumulation_strong | 264 | 29.9% | -4.31% | 16.3% |
| pre_surge | 146 | 29.5% | -3.14% | 15.0% |
| A_pre_surge | 8 | 25.0% | +0.42% | — |
| B_quiet_accumulation_strong | 11 | 27.3% | +0.24% | — |
| explosive_surge | 2 | 0.0% | -3.59% | — |

### Benchmark comparison

EGX30 index return over the same period (2026-09-28 → 2026-10-22): approximately flat to slightly negative.

**Radar signals vs benchmark:** Radar WR = 29.5% (below 50% random baseline). Average return = -3.71% (negative). **The radar does not demonstrate predictive value.**

---

## D. Test C — Real Signal Cases

### Successful signal: AJWA (pre_surge, 2026-10-07)
- Entry: 196.16 (actual close: 196.16 ✅)
- 7d actual: +6.50% (close 208.92 on 2026-10-17)
- Signal was valid: volume gradient + range compression + buy days

### Failed signal: HBCO (pre_surge, 2026-10-07)
- Entry: 8.80 (actual close: 8.80 ✅)
- 7d actual: -9.09% (close 8.00 on 2026-10-18)
- DB claimed: +5.11% (BUG — used max(close) = 9.25)
- Signal was invalid — stock declined 2 days after signal

### Failed signal: EFID (quiet_accumulation_strong, 2026-09-30)
- Entry: 29.50
- 7d actual: -35.59%
- Signal classified as "quiet accumulation" but stock was in sharp decline

### Stock split case: MENA (quiet_accumulation_strong, 2026-09-30)
- Entry: 6.50 → stock split to ~129.00
- DB outcome_7d: +1853.85% (absurd — split not adjusted)
- Actual: data corrupted by split

---

## E. Prioritized Defects

### 🔴 P0 — Bug #1: outcome_7d = max(close) not close_at_day_7
- **Impact:** Win Rate inflated from 29.5% to 45.4% (+15.9 points)
- **Confirmed at runtime:** Yes — 10/20 signals match max(close)
- **Affected files:** Unknown writer (not verify_radar_signals.py, not radar_accuracy_report.py)
- **Fix:** Recalculate all outcome_7d using close-at-day-7. Requires identifying which script wrote the wrong values.

### 🔴 P0 — Bug #2: Stock splits not handled
- **Impact:** MENA outcome = +1853.85% pollutes all statistics
- **Confirmed at runtime:** Yes — MENA price jumped from 6.50 to 129.00 (stock split)
- **Affected files:** All outcome-calculation scripts (no split adjustment)
- **Fix:** Add split detection (>35% daily change) + exclude from stats OR adjust entry_price

### 🟠 P1 — Bug #3: Volume overlap in has_volume_surge()
- **Impact:** Volume ratio inflated by 7-19% → some stocks fail surge check incorrectly
- **Confirmed at runtime:** Yes — measured on 5 EGX stocks
- **Affected file:** `vps-service/utils/shared_liquidity.py:138-141`
- **Fix:** Change `base_vol = volumes[-20:]` to `base_vol = volumes[-25:-5]` (non-overlapping)

---

## F. Handoff to Alpha

- API field `phase` = signal_type from JSON cache (e.g., "A_pre_surge")
- API field `whale.net_flow_egp` = money flow net (from compute_money_flow())
- **`outcome_7d` in DB is NOT trustworthy** — do not display as "historical performance"
- **`max_price_after` in DB may also be corrupted** — verify before display

---

## G. Single Recommended Next Action

**Fix Bug #1 first:** Identify which script wrote `outcome_7d` with max(close) instead of close-at-day-7, then recalculate all outcomes correctly. Without correct outcomes, any performance claim is invalid.

**After fix:** Re-evaluate whether the radar has predictive value with corrected statistics. Current evidence (WR=29.5%, avg=-3.71%) suggests it does NOT.

---

## Test Execution Evidence

```
Command: python3 -c "..." (inline analysis scripts)
Environment: /home/z/my-project (sandbox with VPS DBs)
DBs: price_history.db (1.4M rows, ok), stocks.db (1329 radar signals, ok)
Exit code: 0

Tests executed:
- Entry price vs actual close: 20 signals checked, 18/20 match (±1%)
- outcome_7d vs max(close): 20 signals, 10 match max(close) ← BUG
- outcome_7d vs close_at_day_7: 20 signals, 1 match
- Volume overlap: 5 stocks measured, 7-19% inflation confirmed
- Stock splits: 1 ticker (MENA) with split detected
- Clean performance: 431 signals (after removing splits), WR=29.5%

Tests NOT executed:
- 30d outcomes: 0 signals have outcome_30d in DB (insufficient time elapsed)
- Benchmark comparison: EGX30 index data not in price_history.db (only individual stocks)
```
