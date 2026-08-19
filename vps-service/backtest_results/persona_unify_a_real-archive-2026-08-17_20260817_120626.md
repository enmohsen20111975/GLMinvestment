# PERSONA-UNIFY-A Impact Measurement Report

**Source:** `real-archive-2026-08-17`  
**Timestamp:** 20260817_120626  
**Predictions DB:** `db/vps_real/predictions.db`  
**Price History DB:** `db/vps_real/price_history.db`  

---

## 1. Data Inventory

| Metric | Value |
|---|---|
| Total closed predictions | 148 |
| persona_predictions rows | 1052 |
| Date range | 2026-01-01 → 2026-05-28 |
| Unique tickers | 18 |
| Tickers with price history | 18 |
| Tickers missing price history | 0 |
| Toxic rows (\|return\|>50%) | 1 |

**Persona distribution (raw, before dedup):**

- `balanced`: 148

**Exit-type distribution:**

- `unknown`: 148

---

## 2. Scenario Comparison (Before/After Methodology)

| Scenario | N Trades | Win Rate | Avg Return | Max Gain | Max Loss | Toxic Excl. |
|---|---:|---:|---:|---:|---:|---:|
| A) LEGACY (no dedup, no cap) | 148 | 52.7% | 1.487% | 50.54% | -7.59% | 1 |
| B) DEDUP only | 146 | 52.74% | 1.528% | — | — | — |
| C) UNIFY-A (dedup + HARD cap) | 145 | 52.41% | 1.19% | 31.96% | -7.59% | 0 |

**Key deltas:**
- Dedup removed **2** duplicate trades
- HARD cap excluded **0** toxic rows
- Win rate shift: LEGACY 52.7% → UNIFY-A 52.41% (Δ -0.29pp)

---

## 3. Overall KPI (UNIFY-A canonical: dedup + HARD cap)

| Metric | Value |
|---|---:|
| Trades (deduped) | 145 |
| Win Rate | 52.41% |
| Profit Factor | 1.409 |
| Avg Win | +7.816% |
| Avg Loss | -6.109% |
| Avg Return | 1.19% |
| Total Return (sum) | 172.48% |
| Expectancy/trade | 1.19% |
| Max Gain | +31.96% |
| Max Loss | -7.59% |

---

## 4. By Persona (coverage analysis — may overlap)

| Persona | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return | Expectancy |
|---|---:|---:|---:|---:|---:|---:|---:|
| balanced | 145 | 52.41% | 1.409 | +7.816% | -6.109% | 1.19% | 1.19% |

---

## 5. By Exit Type

| Exit Type | N | Win Rate | PF | Avg Return |
|---|---:|---:|---:|---:|
| unknown | 145 | 52.41% | 1.409 | 1.19% |

---

## 6. Persona-Fit Analysis (proxy via persona_predictions.persona_type)

**Note:** persona_fit annotation was not yet written to predictions.quality_flags
in this archive (pre-UNIFY-A snapshot). Using persona_predictions.persona_type
as a proxy: tickers that appear frequently as gambler/investor fit candidates.

| Fit Bucket | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return |
|---|---:|---:|---:|---:|---:|---:|
| gambler_fit | 1 | 100.0% | 999.0 | +3.785% | 0.0% | 3.785% |
| balanced_fit | 4 | 25.0% | 0.55 | +9.374% | -5.677% | -1.914% |
| neutral | 140 | 52.86% | 1.436 | +7.85% | -6.129% | 1.26% |

### High-fit vs Rest

| Bucket | N | Win Rate | PF | Avg Return | Expectancy |
|---|---:|---:|---:|---:|---:|
| Rest of pool | 145 | 52.41% | 1.409 | 1.19% | 1.19% |

High-fit tickers count: **16**

---

## 7. Monthly Breakdown

| Month | N | Win Rate | PF | Avg Return |
|---|---:|---:|---:|---:|
| 2026-01 | 27 | 59.26% | 1.803 | 1.943% |
| 2026-02 | 25 | 44.0% | 0.835 | -0.581% |
| 2026-03 | 31 | 51.61% | 1.102 | 0.31% |
| 2026-04 | 37 | 45.95% | 0.975 | -0.083% |
| 2026-05 | 25 | 64.0% | 3.521 | 5.12% |

---

## 8. Setup Quality Analysis (R:R Diagnostic)

**CRITICAL:** Reveals whether entry/target/stop geometry is healthy.

| Metric | Value |
|---|---:|
| Invalid setups (target≤entry OR stop≥entry) | 0 |
| Inverted R:R (target_dist < stop_dist) | 0 |
| Healthy R:R (≥ 2.0) | 0 |
| Avg target distance | +9.19% |
| Avg stop distance | -6.13% |
| Avg R:R ratio | 1.5 |

### R:R by Persona

| Persona | N | Avg Target | Avg Stop | Avg R:R | Inverted R:R % |
|---|---:|---:|---:|---:|---:|
| balanced | 146 | +9.19% | -6.13% | 1.5 | 0.0% |

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
