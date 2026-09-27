# PHASE 1 — DATA INTEGRITY GATE REPORT
# Generated: 2026-08-19
# Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅

====================================
GLMINVESTMENT MASTER AUDIT — PHASE 1
====================================

GATE STATUS: **FAIL** (look-ahead bias proven — CRITICAL)

---

## 1.1 — Look-Ahead Bias: ❌ FAIL (CRITICAL)

### Finding 1: Fundamentals Look-Ahead
- **80/153 predictions** use fundamentals with `fiscal_end > prediction_date`
- Example: prediction 2026-01-01 uses Q1-2026 financials (not available until March 2026)
- Impact: PE/ROE/EPS values used in decisions were NOT available at decision time

### Finding 2: Stocks Snapshot Look-Ahead
- **146/153 predictions** use `stocks` snapshot from 2026-08-17
- Predictions from 2026-01-01 use August 2026 stock data (PE, RSI, MA50, etc.)
- Impact: Technical indicators used were NOT point-in-time

### Finding 3: Retroactive Generation
- **148/153 predictions** have `created_at > prediction_date`
- The dataset is a RETROACTIVE BACKTEST, not live predictions
- This is the structural prerequisite that makes look-ahead possible

### Finding 4: News Symbol Missing
- `news_articles.symbol` is NULL for ALL 7,894 rows
- Cannot verify news point-in-time correctness per ticker

## 1.2 — Price History Completeness: ❌ FAIL

| Issue | Count | % | Severity |
|-------|-------|---|----------|
| Date gaps (548 tickers) | 22,653 missing days | 43.49% | HIGH |
| Stale prices (>30d) | 214 tickers | 17% | HIGH |
| Invalid OHLC | 1,191 rows | 0.41% | LOW |
| Volume anomalies | 3,665 rows | 1.27% | LOW |
| Duplicate dates | 0 | 0% | PASS |
| Impossible prices | 0 | 0% | PASS |

## 1.3 — Entry/Exit Price Sanity: ✅ PASS

All 7 checks pass:
- entry_price > 0 ✓
- stop_loss logical (BUY: stop < entry) ✓
- target_price logical (BUY: target > entry) ✓
- exit_price > 0 ✓
- |return| <= 50 (HARD cap) ✓
- highest_price vs target consistent ✓
- lowest_price vs stop consistent ✓

## 1.4 — Corporate Actions: ❌ FAIL

- `stocks.dps_ttm` ALL ZERO (293 stocks have yield>0 but dps_ttm=0)
- No splits/rights/corporate_actions tables (data_missing)
- Prices are RAW (no adjusted column — no split adjustment)
- `tab_dividends` has real data (858 rows) but not synced to stocks table

## 1.5 — Timestamp Consistency: ❌ FAIL

- `news_articles.published_at` mixed formats: 84.9% compact, 15.1% ISO
- prediction_date: PASS (no Friday/Saturday predictions) ✅
- outcome_date: PASS ✅
- price_history date format: PASS ✅

---

## GATE DECISION

| Gate | Status | Evidence |
|------|--------|----------|
| Look-Ahead Bias | ❌ FAIL | 80/153 fundamentals + 146/153 stocks + 148/153 retroactive |
| Price History | ❌ FAIL | 43% gaps + 17% stale |
| Entry/Exit Sanity | ✅ PASS | All 7 checks pass |
| Corporate Actions | ❌ FAIL | dps_ttm all zero + no splits table |
| Timestamp Consistency | ❌ FAIL | News mixed formats |

**NEXT_PHASE_ALLOWED: CONDITIONAL**

### Critical Interpretation
The look-ahead bias means **all KPIs from BACKTEST-FULL-001 may be inflated**:
- balanced PF=1.71 → may be lower with point-in-time data
- morning_bell PF=1.04 → may be even worse (negative?)

### What This Means
The dataset is a **retroactive backtest** — predictions were generated after the fact using
data that wasn't available at the time. This is a known limitation of backfill datasets.

### Recommended Path Forward
1. **Document this as CRITICAL LIMITATION** in all KPI reports
2. **Add `audit_disclaimer` to all KPI responses**: "Results may be inflated by look-ahead bias"
3. **Continue to PHASE 2-5** with this caveat — the relative comparison (balanced vs morning_bell)
   is still meaningful even if absolute numbers are inflated
4. **Point-in-time backtest** requires Python backend (V40.2) running with historical data —
   not available in sandbox
