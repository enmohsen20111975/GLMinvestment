# 🔬 Deep Data Analysis — Final Report

**Generated:** 2026-10-24T16:16:01.998168
**Data:** price_history.db (2000-11-27 → 2026-10-21)
**Analysis Period:** 2023-01 → 2026-09 (46 months, 42 OK)
**Universe:** ~750 active tickers
**Memory Strategy:** chunked (50 tickers/chunk) + gc.collect()

---

## 📋 Executive Summary

- **Clusters:** 6 clusters identified from 250 tickers (silhouette=0.295)
- **Regimes:** 16 Bull, 0 Bear, 29 Sideways months (45 total)
- **Feature IC:** 2800 samples analyzed across 8 features × 4 horizons
- **Setups:** 7 discovered from 18395 profitable days (41.7% hit rate), 3 ROBUST

---

## Phase A: Ticker Clusters

K-means clustering on 8 metrics → 6 clusters (silhouette=0.295)

### Cluster 1: "Trending-HighVol" (132 tickers)

| Metric | Value |
|---|---|
| Trend Score | 0.17 |
| Volatility P50 | 3.29% |
| Volatility P90 | 16.42% |
| Mean-Reversion | -0.26 |
| Seasonality | 27.55% |
| Vol Surge Freq | 12.30% |
| Avg Turnover | 51.21M EGP |
| Data Days | 1063.64 |

**Examples:** ODIN, MTIE, MICH, EPPK, EGBE, EFIH, AMPI, AIFI, ADIB, RAYA

### Cluster 2: "Trending-HighVol" (68 tickers)

| Metric | Value |
|---|---|
| Trend Score | 0.71 |
| Volatility P50 | 4.42% |
| Volatility P90 | 21.44% |
| Mean-Reversion | -0.13 |
| Seasonality | 56.65% |
| Vol Surge Freq | 13.22% |
| Avg Turnover | 32.50M EGP |
| Data Days | 1063.79 |

**Examples:** SIPC, IBCT, RKAZ, OCPH, MOSC, KWIN, FIRE, AXPH, AMES, ZEOT

### Cluster 3: "Seasonal" (35 tickers)

| Metric | Value |
|---|---|
| Trend Score | -0.08 |
| Volatility P50 | 4.37% |
| Volatility P90 | 8.14% |
| Mean-Reversion | -0.05 |
| Seasonality | 15.05% |
| Vol Surge Freq | 3.08% |
| Avg Turnover | 7.35M EGP |
| Data Days | 449.57 |

**Examples:** UASG, TRST, SUCE, MBSC, ICID, ADCI, IEEC, ADRI, VLMR, VERT

### Cluster 4: "Mean-Revert-LowVol" (13 tickers)

| Metric | Value |
|---|---|
| Trend Score | 0.01 |
| Volatility P50 | 0.07% |
| Volatility P90 | 11.60% |
| Mean-Reversion | -0.18 |
| Seasonality | 94.74% |
| Vol Surge Freq | 4.57% |
| Avg Turnover | 6.47M EGP |
| Data Days | 1061.46 |

**Examples:** SPHT, SEIGA, SAIB, NDRL, MISR, MEGM, ICLE, GPPL, CCAPP, DEIN

### Cluster 5: "Trending-HighVol" (1 tickers)

| Metric | Value |
|---|---|
| Trend Score | 0.29 |
| Volatility P50 | 4.30% |
| Volatility P90 | 100.66% |
| Mean-Reversion | -0.04 |
| Seasonality | 1899.14% |
| Vol Surge Freq | 12.05% |
| Avg Turnover | 6.40M EGP |
| Data Days | 1073.00 |

**Examples:** MENA

### Cluster 6: "Trending-HighVol" (1 tickers)

| Metric | Value |
|---|---|
| Trend Score | 1.71 |
| Volatility P50 | 3.45% |
| Volatility P90 | 94.42% |
| Mean-Reversion | -0.16 |
| Seasonality | 508.76% |
| Vol Surge Freq | 5.71% |
| Avg Turnover | 1108.41M EGP |
| Data Days | 457.00 |

**Examples:** T

**Devil's Advocate:**
1. Cluster stability across time not verified — a stock could shift clusters over 4 years
2. K-means assumes spherical clusters — elongated/overlapping clusters may be misassigned

---

## Phase B: Market Regime Deep Dive

**Summary:** 45 months — Bull: 16, Bear: 0, Sideways: 29

| Month | Regime | Breadth | Vol Index | Trading Days |
|---|---|---|---|---|
| 2023-01 | 🟡 Sideways | 67.2% | 16.5% | 20 |
| 2023-02 | 🟡 Sideways | 50.0% | 13.0% | 20 |
| 2023-03 | 🟡 Sideways | 29.5% | 28.2% | 22 |
| 2023-04 | 🟡 Sideways | 46.9% | 9.6% | 15 |
| 2023-05 | 🟡 Sideways | 54.8% | 11.9% | 22 |
| 2023-06 | 🟡 Sideways | 58.4% | 7.1% | 18 |
| 2023-07 | 🟡 Sideways | 43.5% | 13.6% | 18 |
| 2023-08 | 🟢 Bull | 63.1% | 6.4% | 23 |
| 2023-09 | 🟡 Sideways | 58.3% | 6.5% | 19 |
| 2023-10 | 🟢 Bull | 66.1% | 18.2% | 22 |
| 2023-11 | 🟢 Bull | 80.6% | 9.4% | 22 |
| 2023-12 | 🟢 Bull | 76.2% | 14.0% | 21 |
| 2024-01 | 🟢 Bull | 78.7% | 25.2% | 20 |
| 2024-02 | 🟢 Bull | 70.6% | 18.4% | 21 |
| 2024-03 | 🟡 Sideways | 33.6% | 27.3% | 21 |
| 2024-04 | 🟡 Sideways | 14.6% | 27.5% | 17 |
| 2024-05 | 🟡 Sideways | 15.2% | 18.7% | 19 |
| 2024-06 | 🟡 Sideways | 33.2% | 12.3% | 15 |
| 2024-07 | 🟢 Bull | 63.6% | 6.7% | 20 |
| 2024-08 | 🟢 Bull | 71.9% | 21.7% | 21 |
| 2024-09 | 🟢 Bull | 75.0% | 8.6% | 21 |
| 2024-10 | 🟢 Bull | 62.7% | 16.2% | 22 |
| 2024-11 | 🟢 Bull | 61.6% | 8.4% | 20 |
| 2024-12 | 🟡 Sideways | 45.7% | 11.1% | 23 |
| 2025-01 | 🟡 Sideways | 51.9% | 144.3% | 20 |
| 2025-02 | 🟡 Sideways | 47.2% | 3.9% | 20 |
| 2025-03 | 🟢 Bull | 64.8% | 144.4% | 22 |
| 2025-04 | 🟡 Sideways | 50.0% | 183.3% | 22 |
| 2025-05 | 🟡 Sideways | 45.6% | 127.3% | 21 |
| 2025-06 | 🟡 Sideways | 47.2% | 168.2% | 22 |
| 2025-07 | 🟡 Sideways | 44.1% | 199.3% | 23 |
| 2025-08 | 🟡 Sideways | 46.4% | 3.8% | 21 |
| 2025-09 | 🟡 Sideways | 44.3% | 95.3% | 23 |
| 2025-10 | 🟡 Sideways | 49.5% | 72.6% | 27 |
| 2025-11 | 🟡 Sideways | 47.0% | 31.2% | 25 |
| 2025-12 | 🟡 Sideways | 51.0% | 29.4% | 27 |
| 2026-01 | 🟡 Sideways | 49.5% | 95.3% | 26 |
| 2026-02 | 🟡 Sideways | 45.2% | 16.5% | 24 |
| 2026-03 | 🟡 Sideways | 39.6% | 56.3% | 27 |
| 2026-04 | 🟡 Sideways | 54.5% | 49.8% | 24 |
| 2026-05 | 🟡 Sideways | 55.0% | 46.0% | 19 |
| 2026-06 | 🟢 Bull | 62.2% | 15.2% | 21 |
| 2026-07 | 🟢 Bull | 78.3% | 23304.0% | 21 |
| 2026-08 | 🟢 Bull | 78.6% | 593.3% | 21 |
| 2026-09 | 🟢 Bull | 60.1% | 3931.5% | 26 |

**Regime Transitions:** 9
- 2023-08: Sideways → Bull
- 2023-09: Bull → Sideways
- 2023-10: Sideways → Bull
- 2024-03: Bull → Sideways
- 2024-07: Sideways → Bull
- 2024-12: Bull → Sideways
- 2025-03: Sideways → Bull
- 2025-04: Bull → Sideways
- 2026-06: Sideways → Bull

**Devil's Advocate:**
1. Market proxy is equal-weighted (not cap-weighted) — may diverge from EGX30
2. Regime classification uses SMA200 — may lag actual turns by 1-2 months

---

## Phase C: Feature IC Analysis

Sample size: ~2800 observations per feature

| Feature | IC 5d | IC 10d | IC 20d | IC 40d | Hit Rate (>0.7) | Bull IC | Bear IC | n |
|---|---|---|---|---|---|---|---|---|
| liquidity | -0.01 | 0.01 | 0.02 | 0.00 | 46.40% | 0.02 | -0.01 | 2800 |
| whale_guard | -0.02 | 0.03 | 0.01 | 0.03 | 50.30% | 0.02 | 0.04 | 2800 |
| regime | 0.01 | 0.03 | 0.02 | -0.00 | 49.70% | 0.05 | 0.00 | 2800 |
| strict_entry | 0.01 | -0.02 | -0.01 | -0.03 | 49.30% | -0.03 | -0.01 | 2800 |
| sector_heat | -0.02 | 0.01 | 0.01 | 0.01 | 0% | 0.02 | -0.01 | 2800 |
| fundamentals | 0.00 | 0.01 | 0.02 | 0.04 | 44.10% | 0.03 | -0.02 | 2800 |
| risk | 0.04 | 0.01 | 0.02 | 0.06 | 0% | 0.02 | -0.01 | 2800 |
| news_stop | — | — | — | — | 49.10% | nan | nan | 2800 |

**Ranking (by IC 10d):**
1. **liquidity**: IC_10d=0.0081 (NOISE)
2. **whale_guard**: IC_10d=0.0310 (WEAK)
3. **regime**: IC_10d=0.0276 (WEAK)
4. **strict_entry**: IC_10d=-0.0216 (NOISE)
5. **sector_heat**: IC_10d=0.0073 (NOISE)
6. **fundamentals**: IC_10d=0.0110 (NOISE)
7. **risk**: IC_10d=0.0079 (NOISE)

**Devil's Advocate:**
1. IC ≠ causation — features may be coincidentally correlated with returns
2. Sample weighted toward 2025-2026 (more tickers) — may bias toward recent regimes
3. Forward returns are raw (no transaction costs deducted)

---

## Phase D: Feature Combinations

Correlation matrix (Spearman) — 2640 samples:

| | liquidity | whale_guard | regime | strict_entry | sector_heat | fundamentals | risk | news_stop |
|---|---|---|---|---|---|---|---|---|
| **liquidity** | 1.00 | 0.10 | 0.19 | -0.26 | 0.00 | 0.12 | 0.03 | — |
| **whale_guard** | 0.10 | 1.00 | 0.44 | -0.46 | 0.05 | 0.03 | 0.15 | — |
| **regime** | 0.19 | 0.44 | 1.00 | -0.58 | 0.04 | 0.02 | 0.09 | — |
| **strict_entry** | -0.26 | -0.46 | -0.58 | 1.00 | -0.02 | 0.00 | -0.21 | — |
| **sector_heat** | 0.00 | 0.05 | 0.04 | -0.02 | 1.00 | 0.20 | -0.01 | — |
| **fundamentals** | 0.12 | 0.03 | 0.02 | 0.00 | 0.20 | 1.00 | -0.01 | — |
| **risk** | 0.03 | 0.15 | 0.09 | -0.21 | -0.01 | -0.01 | 1.00 | — |
| **news_stop** | — | — | — | — | — | — | — | — |

**Top 10 Combinations (by IC boost):**

| Pair | IC A | IC B | IC Combined | Boost |
|---|---|---|---|---|
| fundamentals + risk | 0.02 | 0.02 | 0.04 | 0.01 |
| sector_heat + risk | 0.01 | 0.02 | 0.03 | 0.01 |
| liquidity + risk | 0.02 | 0.02 | 0.03 | 0.01 |
| regime + fundamentals | 0.02 | 0.02 | 0.03 | 0.01 |
| regime + risk | 0.02 | 0.02 | 0.03 | 0.01 |
| whale_guard + sector_heat | 0.01 | 0.01 | 0.01 | 0.00 |
| sector_heat + fundamentals | 0.01 | 0.02 | 0.02 | 0.00 |
| regime + sector_heat | 0.02 | 0.01 | 0.02 | 0.00 |
| liquidity + whale_guard | 0.02 | 0.01 | 0.02 | -0.00 |
| liquidity + sector_heat | 0.02 | 0.01 | 0.01 | -0.00 |

**Redundant Pairs:** None (all |corr| < 0.80) — features are independent

**Devil's Advocate:**
1. Pairwise IC boost may not hold in multivariate settings (3+ features)
2. Combinations could overfit to the 2023-2026 period

---

## Phase E: Discovered Setups

K-means on 18395 profitable days (fr20 > 3%) → 7 setups (silhouette=0.316)
Profitable rate: 41.7% of 44113 total observed days

### Setup 1: "High Volatility Spike" ✅ ROBUST

- **Win Rate:** 100.0%
- **Avg Gain:** +949.41%
- **Sample:** 6594 occurrences

| Feature | Value |
|---|---|
| rsi | 38.03 |
| vol_ratio | 0.99 |
| dist_sma50 | -8.96 |
| dist_52w_high | -42.61 |
| ret_5d | -2.66 |
| ret_20d | -7.75 |
| atr_pct | 5.33 |
| above_sma200 | 0.02 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 153 | 4309.8% |
| 2024 | 273 | 2415.4% |
| 2025 | 3399 | 194.0% |
| 2026 | 2710 | 243.3% |

**Examples:** 1010(2025-07-21,+7.27%), 1010(2025-07-22,+8.3%), 1010(2025-07-23,+5.5%), 1010(2025-07-24,+10.47%), 1010(2025-07-27,+6.73%)

### Setup 2: "Setup-2" ✅ ROBUST

- **Win Rate:** 100.0%
- **Avg Gain:** +154.93%
- **Sample:** 5385 occurrences

| Feature | Value |
|---|---|
| rsi | 57.67 |
| vol_ratio | 1.02 |
| dist_sma50 | 3.81 |
| dist_52w_high | -17.4 |
| ret_5d | 1.64 |
| ret_20d | 4.73 |
| atr_pct | 4.47 |
| above_sma200 | 0.0 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 141 | 3819.1% |
| 2024 | 37 | 14554.1% |
| 2025 | 4084 | 131.9% |
| 2026 | 839 | 641.8% |

**Examples:** 1010(2025-04-03,+6.45%), 1010(2025-04-06,+9.31%), 1010(2025-04-07,+13.01%), 1010(2025-04-08,+4.92%), 1010(2025-04-09,+6.19%)

### Setup 3: "High Volatility Spike" ✅ ROBUST

- **Win Rate:** 100.0%
- **Avg Gain:** +358.15%
- **Sample:** 6031 occurrences

| Feature | Value |
|---|---|
| rsi | 58.24 |
| vol_ratio | 1.03 |
| dist_sma50 | 33.01 |
| dist_52w_high | -15.35 |
| ret_5d | 20.34 |
| ret_20d | 322.05 |
| atr_pct | 5.19 |
| above_sma200 | 1.0 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 721 | 836.5% |
| 2024 | 401 | 1504.0% |
| 2025 | 1265 | 476.8% |
| 2026 | 3644 | 165.5% |

**Examples:** 1010(2025-10-29,+3.84%), 1010(2025-10-30,+7.59%), 1010(2025-11-02,+10.25%), 1010(2025-11-03,+12.24%), 1010(2025-11-04,+7.07%)

### Setup 4: "High Volatility Spike" ⚠️ NEEDS VALIDATION

- **Win Rate:** 100.0%
- **Avg Gain:** +5.1%
- **Sample:** 12 occurrences

| Feature | Value |
|---|---|
| rsi | 90.76 |
| vol_ratio | 0.17 |
| dist_sma50 | 374.84 |
| dist_52w_high | -0.71 |
| ret_5d | 0.41 |
| ret_20d | 100266.47 |
| atr_pct | 6.19 |
| above_sma200 | 1.0 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 0 | 0% |
| 2024 | 0 | 0% |
| 2025 | 0 | 0% |
| 2026 | 12 | 100.0% |

**Examples:** 1140(2026-07-27,+4.52%), 1140(2026-07-30,+5.41%), 1140(2026-08-02,+5.57%), 1140(2026-08-03,+5.57%), 1140(2026-08-04,+5.57%)

### Setup 5: "High Volatility Spike" ⚠️ NEEDS VALIDATION

- **Win Rate:** 100.0%
- **Avg Gain:** +11.39%
- **Sample:** 69 occurrences

| Feature | Value |
|---|---|
| rsi | 98.12 |
| vol_ratio | 0.0 |
| dist_sma50 | 1501.04 |
| dist_52w_high | -1.67 |
| ret_5d | 9239.32 |
| ret_20d | 10004.0 |
| atr_pct | 7.38 |
| above_sma200 | 1.0 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 0 | 0% |
| 2024 | 0 | 0% |
| 2025 | 0 | 0% |
| 2026 | 69 | 100.0% |

**Examples:** 1050(2026-07-19,+6.18%), 1050(2026-07-20,+6.74%), 1050(2026-07-21,+4.63%), 1111(2026-07-21,+4.35%), 1111(2026-07-22,+8.96%)

### Setup 6: "Oversold Bounce" ⚠️ NEEDS VALIDATION

- **Win Rate:** 100.0%
- **Avg Gain:** +58.66%
- **Sample:** 125 occurrences

| Feature | Value |
|---|---|
| rsi | 31.99 |
| vol_ratio | 1.81 |
| dist_sma50 | -50.1 |
| dist_52w_high | -82.28 |
| ret_5d | -23.57 |
| ret_20d | -35.25 |
| atr_pct | 86.73 |
| above_sma200 | 0.09 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 0 | 0% |
| 2024 | 0 | 0% |
| 2025 | 77 | 162.3% |
| 2026 | 48 | 260.4% |

**Examples:** 1120(2026-07-21,+4.83%), 1120(2026-07-22,+7.64%), 1120(2026-07-26,+5.81%), 1120(2026-07-27,+5.44%), 1120(2026-08-02,+6.22%)

### Setup 7: "High Volatility Spike" ⚠️ NEEDS VALIDATION

- **Win Rate:** 100.0%
- **Avg Gain:** +16.79%
- **Sample:** 176 occurrences

| Feature | Value |
|---|---|
| rsi | 76.78 |
| vol_ratio | 8.76 |
| dist_sma50 | 155.88 |
| dist_52w_high | -18.81 |
| ret_5d | 4.78 |
| ret_20d | 1762.79 |
| atr_pct | 9.26 |
| above_sma200 | 0.86 |

**Yearly Robustness:**

| Year | n | WR |
|---|---|---|
| 2023 | 16 | 1100.0% |
| 2024 | 6 | 2933.3% |
| 2025 | 17 | 1035.3% |
| 2026 | 135 | 130.4% |

**Examples:** 1050(2026-07-30,+10.49%), 1050(2026-08-03,+9.98%), 1050(2026-08-04,+9.98%), 1050(2026-08-05,+9.98%), 1060(2026-08-03,+3.5%)

**Devil's Advocate:**
1. Clustering on profitable days = survivorship bias (losing days not clustered)
2. Forward 20d return > 3% threshold is arbitrary — different thresholds yield different clusters
3. No transaction costs (0.3% commission) deducted from gains

---

## 🎯 Strategic Recommendation

1. **Cluster to target:** "Trending-HighVol" (132 tickers) — largest universe
2. **Highest-EV Setup:** "High Volatility Spike" — WR=100.0%, avg gain=+949.41%
3. **ROBUST setups (validated across 2023-2026):** 3 — priority for strategy building

---

## ⚠️ Honest Limitations

1. **Memory constraint:** 4GB sandbox → 50-150 ticker samples (not full 750)
2. **Look-ahead bias:** Feature scores computed on same-day close; forward returns start next day
3. **Survivorship bias:** Delisted tickers may not be in DB
4. **Transaction costs:** 0.3% commission NOT deducted from forward returns
5. **2023-2024 data:** Only ~215 tickers (vs 750+ in 2025-2026) — less representative
6. **Regime lag:** SMA200-based regime may lag actual market turns by 1-2 months
7. **Feature IC is Spearman** — captures monotonic but not necessarily linear relationships
8. **Setup clustering on profitable days only** — does not profile losing setups

---

*Report generated by camp/data_analyzer.py + camp/report_writer.py*
