# PERSONA-UNIFY-A Impact Measurement Report

**Source:** `production-archive-2026-08-09`  
**Timestamp:** 20260817_115102  
**Predictions DB:** `upload/extracted/predictions.db`  
**Price History DB:** `upload/extracted/price_history.db`  

---

## 1. Data Inventory

| Metric | Value |
|---|---|
| Total closed predictions | 631 |
| persona_predictions rows | 999 |
| Date range | 2026-05-10 → 2026-07-23 |
| Unique tickers | 48 |
| Tickers with price history | 48 |
| Tickers missing price history | 0 |
| Toxic rows (\|return\|>50%) | 0 |

**Persona distribution (raw, before dedup):**

- `balanced`: 70
- `conservative`: 280
- `gambler`: 281

**Exit-type distribution:**

- `stop_loss`: 285
- `target_hit`: 322
- `unknown`: 24

---

## 2. Scenario Comparison (Before/After Methodology)

| Scenario | N Trades | Win Rate | Avg Return | Max Gain | Max Loss | Toxic Excl. |
|---|---:|---:|---:|---:|---:|---:|
| A) LEGACY (no dedup, no cap) | 631 | 34.71% | -2.483% | 10.11% | -22.47% | 0 |
| B) DEDUP only | 631 | 34.71% | -2.483% | — | — | — |
| C) UNIFY-A (dedup + HARD cap) | 631 | 34.71% | -2.483% | 10.11% | -22.47% | 0 |

**Key deltas:**
- Dedup removed **0** duplicate trades
- HARD cap excluded **0** toxic rows
- Win rate shift: LEGACY 34.71% → UNIFY-A 34.71% (Δ 0.0pp)

---

## 3. Overall KPI (UNIFY-A canonical: dedup + HARD cap)

| Metric | Value |
|---|---:|
| Trades (deduped) | 631 |
| Win Rate | 34.71% |
| Profit Factor | 0.254 |
| Avg Win | +2.441% |
| Avg Loss | -5.458% |
| Avg Return | -2.483% |
| Total Return (sum) | -1566.87% |
| Expectancy/trade | -2.483% |
| Max Gain | +10.11% |
| Max Loss | -22.47% |

---

## 4. By Persona (coverage analysis — may overlap)

| Persona | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return | Expectancy |
|---|---:|---:|---:|---:|---:|---:|---:|
| balanced | 70 | 31.43% | 0.223 | +2.131% | -4.663% | -2.328% | -2.328% |
| gambler | 281 | 35.23% | 0.314 | +2.713% | -5.065% | -2.091% | -2.091% |
| conservative | 280 | 35.0% | 0.212 | +2.236% | -6.056% | -2.916% | -2.916% |

---

## 5. By Exit Type

| Exit Type | N | Win Rate | PF | Avg Return |
|---|---:|---:|---:|---:|
| target_hit | 322 | 68.01% | 10.999 | 1.509% |
| stop_loss | 285 | 0.0% | 0.0 | -7.203% |
| unknown | 24 | 0.0% | 0.0 | 0.0% |

---

## 6. Persona-Fit Analysis (proxy via persona_predictions.persona_type)

**Note:** persona_fit annotation was not yet written to predictions.quality_flags
in this archive (pre-UNIFY-A snapshot). Using persona_predictions.persona_type
as a proxy: tickers that appear frequently as gambler/investor fit candidates.

| Fit Bucket | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return |
|---|---:|---:|---:|---:|---:|---:|
| gambler_fit | 262 | 38.93% | 0.412 | +2.758% | -4.845% | -1.534% |
| investor_fit | 40 | 22.5% | 0.131 | +2.965% | -6.548% | -4.408% |
| balanced_fit | 329 | 32.83% | 0.186 | +2.097% | -5.706% | -3.005% |

### High-fit vs Rest

| Bucket | N | Win Rate | PF | Avg Return | Expectancy |
|---|---:|---:|---:|---:|---:|
| High-fit (≥3 appearances) | 16 | 68.75% | 2.405 | 1.428% | 1.428% |
| Rest of pool | 615 | 33.82% | 0.238 | -2.585% | -2.585% |

High-fit tickers count: **9**

---

## 7. Monthly Breakdown

| Month | N | Win Rate | PF | Avg Return |
|---|---:|---:|---:|---:|
| 2026-05 | 510 | 38.63% | 0.3 | -2.277% |
| 2026-06 | 108 | 17.59% | 0.067 | -3.811% |
| 2026-07 | 13 | 23.08% | 999.0 | 0.472% |

---

## 8. Setup Quality Analysis (R:R Diagnostic)

**CRITICAL:** Reveals whether entry/target/stop geometry is healthy.

| Metric | Value |
|---|---:|
| Invalid setups (target≤entry OR stop≥entry) | 106 |
| Inverted R:R (target_dist < stop_dist) | 368 |
| Healthy R:R (≥ 2.0) | 77 |
| Avg target distance | +161.77% |
| Avg stop distance | -11.42% |
| Avg R:R ratio | 38.33 |

### R:R by Persona

| Persona | N | Avg Target | Avg Stop | Avg R:R | Inverted R:R % |
|---|---:|---:|---:|---:|---:|
| balanced | 56 | +813.84% | -7.73% | 211.55 | 71.4% |
| gambler | 229 | +103.76% | -10.96% | 22.75 | 70.3% |
| conservative | 240 | +64.98% | -12.72% | 12.78 | 69.6% |

> **Interpretation:** R:R < 1 means the trade risks more than it aims to gain.
> Such setups require WR > 50% just to break even. R:R ≥ 2 allows profitability
> even at WR = 34%.

---

## 9. Methodology Notes

- **Trade unit (overall):** `(ticker, prediction_date)` unique after dedup
- **Dedup priority:** target_hit > fewer holding_days > higher master_score
- **HARD cap:** `ABS(actual_return) <= 50` (CONSTITUTION Rule 7)
- **byPersona:** coverage analysis (rows may overlap across personas — intentional)
- **high-fit proxy:** persona_predictions.persona_type frequency (>=3 appearances)
- **MaxDD:** not computed (requires position sizing assumptions — flagged as limitation)
- **Position sizing:** equal-weight assumed for all metrics (100% per trade notional)
