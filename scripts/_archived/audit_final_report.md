# GLMINVESTMENT MASTER AUDIT — FINAL REPORT
# Generated: 2026-08-19
# Dataset: data/active_databases_20260817_full.zip
# MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅

====================================
GLMINVESTMENT MASTER AUDIT
====================================

## FINAL STATUS: NOT_PROVEN

---

## PHASE 0 — TRUTH LAYER: ❌ FAIL (partially fixed)

### Dataset: ✅ PASS
- MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅
- 18 DBs extracted, integrity OK

### Provenance: ✅ FIXED
- stocks.db byte-drift → re-extracted from ZIP

### Duplicates: ⚠️ Structural
- persona_predictions.persona column degenerate (constant 'balanced')
- 0 real duplicates with canonical key (ticker, date, persona_type, entry)

### Channel Separation: ✅ PASS
- balanced ≠ morning_bell cleanly separated (0 overlap)

### KPI Provenance: ❌ FAIL → FIXED (5/6 aligned)
- 2 CRITICAL fixes: fake random backtest removed + avg_loss sign fixed
- 5 readers aligned to gold standard
- 1 reader marked NON_AUDITED (analyst/predictions — no morning_bell column)

---

## PHASE 1 — DATA INTEGRITY: ❌ FAIL (CRITICAL)

### Look-Ahead Bias: ❌ PROVEN
- 80/153 predictions use fundamentals with fiscal_end > prediction_date
- 146/153 predictions use stocks snapshot from 2026-08-17 for earlier predictions
- 148/153 predictions retroactively generated (created_at > prediction_date)
- **ALL KPIs MAY BE INFLATED by look-ahead bias**

### Price History: ❌ FAIL
- 43% of tickers have date gaps
- 17% stale (>30 days)
- 0.41% invalid OHLC

### Entry/Exit Sanity: ✅ PASS
- All 7 checks pass

### Corporate Actions: ❌ FAIL
- stocks.dps_ttm all zero (pipeline broken)
- No splits/rights tables

### Timestamps: ❌ FAIL
- News published_at mixed formats (84.9% compact, 15.1% ISO)

---

## PHASE 2 — BACKTEST INTEGRITY: ✅ PASS (with caveats)

### Commission/Slippage: ✅ balanced survives / ❌ morning_bell fails
| Scenario | balanced PF | morning_bell PF |
|----------|-------------|-----------------|
| NO_COST | 1.70 | 1.04 |
| BASE_COST (0.40%) | 1.53 | **0.92** ❌ |
| STRESS_COST (0.80%) | 1.37 | **0.82** ❌ |

### Regime Breakdown: ✅ balanced robust / morning_bell fragile
| Regime | balanced PF | morning_bell PF |
|--------|-------------|-----------------|
| Bear | 1.37 | **0.87** ❌ |
| Range | 1.15 | 1.18 |
| Bull | ∞ (n=2) | 0.00 (n=1) |

### Profit Concentration: ✅ DISTRIBUTED
- Top 1 = 2.40%, Top 10 = 21.65%
- Pareto: 80% from 34% of trades
- No single ticker dominant (max 19.64%)

### Portfolio MaxDD: ✅ PASS
- ALL: 7.48% | balanced: 6.13% | morning_bell: 5.39%

---

## PHASE 3 — EDGE DISCOVERY (Ablation): ⚠️ NEEDS_OWNER

Requires Python backend (V40.2) with ability to disable individual components.
Not available in sandbox — documented as limitation.

---

## PHASE 4 — BASELINE CHALLENGE: ❌ CRITICAL FINDING

| Baseline | PF | Exp% | vs GLMinvestment |
|----------|-----|------|-----------------|
| **GLMinvestment (balanced)** | **1.70** | **+1.96%** | — |
| A: Random | 1.58 | +1.16% | ✅ GLM wins |
| **B: Momentum (simple)** | **2.57** | **+2.76%** | ❌ **GLM loses** |
| C: RVOL | 1.43 | +1.06% | ✅ GLM wins |
| D: EGX Benchmark | 1.12 | +1.09% | ✅ GLM wins |
| **E: Buy & Hold** | **2.45** | **+4.98%** | ❌ **GLM loses badly** |

### CRITICAL: GLMinvestment underperforms 2 simple baselines
1. **Buy & Hold** beats GLMinvestment by 2.5× (Exp +4.98% vs +1.96%)
   → TP/SL logic cuts winning trades too early
2. **Simple Momentum** beats GLMinvestment (PF 2.57 vs 1.70)
   → Complex scoring doesn't outperform simple 20-day return ranking

---

## PHASE 5 — RISK ENGINE: ✅ ACCEPTABLE

- Portfolio MaxDD: 7.48% (acceptable for 1% risk per trade)
- Max single-trade loss: -7.59% (within ATR stop 3-9% range)
- morning_bell should be quarantined (fails costs + fails in bear regime)

---

## FINAL AUDIT MATRIX

| Gate | Status | Evidence |
|------|--------|----------|
| Dataset Integrity | ✅ PASS | MD5 confirmed |
| MD5 | ✅ PASS | 0947bdf6... |
| Provenance | ✅ FIXED | stocks.db restored |
| Duplicates | ⚠️ Structural | persona degenerate column |
| Channel Separation | ✅ PASS | 0 overlap |
| Leakage | ❌ FAIL | Look-ahead proven (80+146/153) |
| Price Integrity | ❌ FAIL | 43% gaps + 17% stale |
| Backtest Integrity | ✅ PASS | balanced survives costs |
| Costs | ✅ PASS | balanced PF>1 at STRESS_COST |
| Regime | ✅ PASS | balanced regime-robust |
| Concentration | ✅ PASS | Distributed |
| Ablation | ⚠️ NEEDS_OWNER | Python backend required |
| Baselines | ❌ FAIL | Loses to Buy&Hold + Momentum |
| Risk | ✅ PASS | MaxDD 7.48% acceptable |
| Production Sync | ⚠️ NEEDS_OWNER | Live validation required |
| Personas | ⚠️ NEEDS_OWNER | gambler/investor all PENDING |
| Learning | ❌ FAIL | learned_lessons table empty (0 rows) |

---

## CONCLUSION: NOT_PROVEN

GLMinvestment has:
- ✅ A real selection edge (beats random + market benchmark)
- ✅ A cost-survivable edge (balanced survives 0.80% round-trip)
- ✅ A distributed profit profile (not concentrated)
- ✅ A regime-robust edge (works in bear AND range)

BUT:
- ❌ Look-ahead bias inflates all numbers (data not point-in-time)
- ❌ Buy & Hold outperforms by 2.5× (exit logic kills alpha)
- ❌ Simple momentum outperforms (complexity without alpha)
- ❌ morning_bell channel fails at realistic costs
- ❌ Learning loop not writing (learned_lessons empty)

### The Hard Truth
> **Machine Complexity ≠ Alpha.**

The system's 395 Python files + 583 routes produce PF=1.70.
A simple 20-day momentum screen produces PF=2.57.
Buy & Hold produces Exp=+4.98%.

The edge is in STOCK SELECTION, not in the exit logic or the scoring complexity.

### Recommended Next Steps (for Owner)
1. **Fix exit logic**: Replace fixed TP with trailing stop or raise TP to +12-15%
2. **Simplify scoring**: Test if momentum-only scoring matches or beats complex scoring
3. **Point-in-time data**: Fix look-ahead bias before trusting any KPI
4. **Quarantine morning_bell**: Disable until PF>1.2 at BASE_COST proven
5. **Fix learning loop**: learned_lessons table is empty — system isn't learning
6. **Run Ablation**: Requires Python backend to identify which components add real value
