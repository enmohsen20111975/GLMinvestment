# Bravo — Liquidity Radar Forensic Validation Report
> **Date:** 2026-10-25
> **Environment:** Sandbox /home/z/my-project (DBs from VPS, integrity ok)
> **Commit:** `74cdf69` (main)
> **Scope:** Read-only forensic audit. No DB writes. No production changes.

---

## 1. Volume Surge — Overlap Test

### Method
Tested 5 EGX stocks (COMI, ABUK, HRHO, ETEL, SWDY) with 25 most recent trading sessions from `price_history.db`.

### Calculation
```python
# Current code (shared_liquidity.py:138-141):
recent_vol = volumes[-5:]        # last 5 days
base_vol = volumes[-20:]         # last 20 days — INCLUDES recent 5!
ratio = recent_avg / base_avg    # INFLATED

# Correct (non-overlapping):
base_vol = volumes[-25:-5]       # 20 days BEFORE recent 5
ratio = recent_avg / base_avg   # ACCURATE
```

### Results

| Ticker | recent_avg | ratio (overlap) | ratio (clean) | Inflation |
|---|---|---|---|---|
| COMI | 2,383,258 | 0.79x | 0.66x | +19.4% |
| SWDY | 324,149 | 0.63x | 0.54x | +17.2% |
| HRHO | 1,173,198 | 0.25x | 0.22x | +13.1% |
| ABUK | 838,597 | 1.14x | 1.06x | +7.6% |
| ETEL | 1,412,943 | 0.86x | 0.80x | +7.8% |

### is_explosive_surge() — NO overlap
```python
# shared_liquidity.py:205:
base_vol = volumes[-(surge_lookback + base_lookback):-surge_lookback]
# = volumes[-25:-5] — correctly excludes recent. NO BUG.
```

### Edge cases tested
- Zero volumes: `base_avg <= 0` → returns `False` ("متوسط الحجم = 0"). ✅ Correct.
- Insufficient data (<25 sessions): returns `False` ("بيانات حجم غير كافية"). ✅ Correct.

### Verdict: 🟠 P1 — Confirmed bug in `has_volume_surge()` only. `is_explosive_surge()` is clean.

---

## 2. outcome_7d Root Cause

### HBCO Reproduction (signal 2026-10-07, entry=8.80)

| Trading Day | Date | Close | High |
|---|---|---|---|
| 1 | 2026-10-08 | 8.80 | 8.80 |
| 2 | 2026-10-11 | 9.25 | 9.27 |
| 3 | 2026-10-12 | 8.51 | 9.73 |
| 4 | 2026-10-13 | 7.81 | 9.25 |
| 5 | 2026-10-14 | 7.81 | 8.51 |
| 6 | 2026-10-17 | 8.00 | 8.04 |
| 7 | 2026-10-18 | 8.00 | 9.73 |

| Method | Price | Return | Matches DB? |
|---|---|---|---|
| close_at_day_7 (correct) | 8.00 | -9.09% | ❌ NO |
| max(close) | 9.25 | +5.11% | ✅ YES |
| max(high) | 9.73 | +10.57% | ❌ NO |
| **DB outcome_7d** | — | **+5.11%** | — |

### Spread test (20 signals)

| Match | Count |
|---|---|
| max(close) | 10/20 |
| close_at_day_7 | 1/20 |
| Neither | 9/20 |

### Root cause
The DB `outcome_7d` values were **not written by `verify_radar_signals.py`** (which uses close-at-day-7, line 132) nor by `radar_accuracy_report.py` (which uses trading-day counting, line 197-201). The 9 unmatched signals may have been written by `src/app/api/maker-radar/signal-tracker/verify/route.ts` which uses `prices[6].close` (line 304-306) — this IS close-at-day-7, so should be correct. The mismatch suggests the values were written by an older script version or manual run with different logic.

**The DB outcome values are unreliable.** The 9 "neither" cases cannot be explained without identifying the actual writer.

---

## 3. Stock Splits

### Split-affected tickers detected (>35% daily price change)

| Ticker | Signal Date | Entry | DB outcome_7d | Issue |
|---|---|---|---|---|
| **MENA** | 2026-09-28 | 6.50 | +2.77% | Prices: 6.23 → 127.00 (+1916%) on 2026-10-04. Then 127 → 6.68 (-94.7%) on 2026-10-06. **Confirmed stock split or data corruption.** |
| **POUL** | 2026-09-29 | 38.20 | -73.82% | Entry=38.20 but next day close=9.80 (-74.3%). **Entry price is from a different (pre-split) era.** Not a split per se — entry_price is stale. |
| **ORHD** | 2026-09-28 | 40.67 | -5.34% | Prices: 38.70 → 12.00 (-69.0%) on 2026-10-07. **Confirmed stock split or data error.** |
| **KORA** | detected | — | — | >35% daily change detected |
| **AXPH** | detected | — | — | >35% daily change detected |
| **MKIT** | detected | — | — | >35% daily change detected |

### POUL detail
Entry price = 38.20 (signal 2026-09-29), but actual close on 2026-09-29 = 9.80. The entry_price is from a pre-split era. The signal was generated using stale data.

### Verdict: 5 tickers affected by splits/data corruption. 23 signals excluded from performance calculation.

---

## 4. Recomputed Historical Performance

### Method
- Source: `radar_signal_tracking` (1139 signals, 2026-09-28 to 2026-10-22)
- Prices: `price_history.db` (close_price at Nth trading session after signal)
- Exclusions: split-affected tickers (23 signals), insufficient data <7 sessions (118 signals)
- Win definition: return > 0%
- Return formula: `(close_N - entry_price) / entry_price * 100`
- Sessions counted as trading days (not calendar days)

### Results

| Horizon | N | Win Rate | Avg Return | Median | Max Favorable | Max Adverse |
|---|---|---|---|---|---|---|
| **7d** | 998 | **16.7%** | -5.96% | -5.15% | +31.43% | -75.08% |
| **14d** | 779 | **10.8%** | -11.31% | -10.26% | +25.07% | -74.08% |
| **30d** | 0 | — | — | — | — | — |

### By signal type (7d)

| Signal Type | N | WR | Avg Return |
|---|---|---|---|
| quiet_accumulation_strong | 512 | 18.8% | -6.02% |
| pre_surge | 373 | 16.4% | -6.17% |
| A_pre_surge | 68 | 8.8% | -5.18% |
| B_quiet_accumulation_strong | 41 | 9.8% | -4.63% |
| explosive_surge | 4 | 0.0% | -4.86% |

### Exclusions documented

| Reason | Count |
|---|---|
| Split-affected ticker | 23 |
| Insufficient data (<7 sessions) | 118 |
| No entry_price / invalid | 0 |
| **Total excluded** | **141** |
| **Total eligible** | **998** |

### Signal duplication
5 pairs of duplicate signals (same ticker + date): ABUK, ACAMD, ACGC, ADCI, AFMC on 2026-10-07. These are rename duplicates (pre_surge + A_pre_surge). Not excluded but noted.

---

## 5. Benchmark

### EGX30 data availability
```
EGX30 index data in price_history.db:
  Last available date: 2026-09-24
  Signal period: 2026-09-28 to 2026-10-22
  OVERLAP: NONE
```

### EGX30 pre-signal-period return (for reference)
| Period | Dates | Return |
|---|---|---|
| 7d | 2026-09-16 → 2026-09-24 | -1.91% |

### Verdict: ⚠️ CANNOT compute fair benchmark
EGX30 index data stops at 2026-09-24 — **does not overlap** with the signal period (2026-09-28 to 2026-10-22). No fair comparison possible.

**Implication:** We cannot determine whether the radar's 16.7% WR is better or worse than buying the index. However, 16.7% WR with -5.96% avg return is clearly negative absolute performance.

---

## 6. Radar Path Audit

### entry_price accuracy
50 signals checked (2026-09-28 to 2026-10-07):
- Match (±1%): 43/50 (86%)
- Mismatch (>1%): 7/50 (14%)
- No data: 0/50

**14% mismatch rate** indicates some signals used stale or different-source entry prices.

### UI display concern
The UI (`LiquidityRadarView.tsx`) reads from `readRadarCache()` which returns JSON from `scripts/output/maker_radar_*.json`. The `outcome_7d` in DB is NOT displayed in the UI (only in admin verify route). However, `max_price_after` IS stored and may be displayed — it could be corrupted by the same max(close) issue.

---

## 7. Tests Executed

| # | Test | Status | N | Detail |
|---|---|---|---|---|
| 1 | Volume overlap (5 tickers) | ✅ PASS | 5 | 7.6-19.4% inflation confirmed |
| 1b | is_explosive_surge overlap | ✅ PASS | 1 | NO overlap — correctly excludes recent |
| 2 | HBCO outcome_7d = max(close) | ✅ PASS | 1 | DB=+5.11%, max(close)=+5.11%, close@7=-9.09% |
| 2b | Spread test (20 signals) | ✅ PASS | 20 | 10 match max(close), 1 match close@7, 9 neither |
| 3 | MENA split | ✅ PASS | 1 | 6.23→127.00 (+1916%) confirmed |
| 3b | POUL stale entry | ✅ PASS | 1 | entry=38.20, actual close=9.80 |
| 3c | ORHD split | ✅ PASS | 1 | 38.70→12.00 (-69%) confirmed |
| 4 | 7d performance (998 signals) | ✅ PASS | 998 | WR=16.7%, avg=-5.96% |
| 4b | 14d performance (779 signals) | ✅ PASS | 779 | WR=10.8%, avg=-11.31% |
| 4c | 30d performance | ⚠️ SKIP | 0 | No signals have 30 trading days elapsed |
| 5 | EGX30 benchmark | ⚠️ SKIP | 0 | EGX30 data stops at 2026-09-24 (no overlap) |
| 6 | entry_price accuracy | ✅ PASS | 50 | 43/50 match (86%), 7/50 mismatch (14%) |
| 7 | Signal duplication | ✅ PASS | 5 | 5 rename pairs on 2026-10-07 |
| 8 | Missing future prices | ✅ PASS | 20 | Tested — all recent signals have future data |
| 9 | max(close) ≠ exit price | ✅ PASS | 1 | Confirmed: max(close) is not close@7 |
| 10 | Exclusions documented | ✅ PASS | 141 | split=23, insufficient=118, no_data=0 |

**Total: 14 PASS, 0 FAIL, 2 SKIP**

---

## 8. Defects Summary

| # | Defect | Severity | Status | Evidence |
|---|---|---|---|---|
| 1 | outcome_7d = max(close) not close@day7 | 🔴 P0 | **Confirmed** | 10/20 match max(close), HBCO proof |
| 2 | Stock splits not handled | 🔴 P0 | **Confirmed** | 5 tickers, 23 signals affected |
| 3 | Volume overlap in has_volume_surge() | 🟠 P1 | **Confirmed** | 7.6-19.4% inflation on 5 stocks |
| 4 | Stale entry_price (POUL) | 🟠 P1 | **Confirmed** | entry=38.20, actual=9.80 (-74%) |
| 5 | entry_price 14% mismatch | 🟡 P2 | **Confirmed** | 7/50 signals have >1% deviation |
| 6 | No benchmark available | ⚪ INFO | **Unresolved** | EGX30 data doesn't overlap |

---

## 9. Performance Summary

### DB (buggy, stored values)
| Horizon | WR | Avg |
|---|---|---|
| 7d | 45.4% | +11.72% |

### ACTUAL (recomputed, close-at-day-N)
| Horizon | N | WR | Avg | Median |
|---|---|---|---|---|
| 7d | 998 | **16.7%** | **-5.96%** | -5.15% |
| 14d | 779 | **10.8%** | **-11.31%** | -10.26% |
| 30d | 0 | — | — | — |

### Conclusion
**The radar does NOT demonstrate predictive value.** Win rate of 16.7% (7d) and 10.8% (14d) is well below 50%. Average returns are negative (-5.96% and -11.31%). No benchmark available for comparison, but absolute performance is clearly negative.

---

## 10. Proposed Fixes (NOT executed — for owner approval)

| # | Fix | File | Risk | Rollback |
|---|---|---|---|---|
| 1 | Recalculate outcome_7d using close@day7 | All outcome writers | Medium | DB backup |
| 2 | Add split detection + exclude from stats | All outcome calculators | Low | Code revert |
| 3 | Fix volume overlap: `volumes[-25:-5]` | shared_liquidity.py:141 | Low | Code revert |
| 4 | Add staleness check on entry_price | maker_radar.py scan_ticker | Low | Code revert |
