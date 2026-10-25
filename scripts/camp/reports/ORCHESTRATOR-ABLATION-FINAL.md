# 📊 Orchestrator Ablation — Final Report

**Generated:** 2026-10-24T15:45:56.679912
**Universe:** 250 tickers (continuous in DEV+VAL+HOLDOUT)
**Data:** price_history.db (2026-01-01 → 2026-06-10)
**Decision log:** `/home/z/my-project/scripts/camp/results/decisions_log.jsonl`

---

## 📋 Executive Summary

- **Baseline (Exp_0):** 2050 signals, PF=1.02, DD=-83.4%
- **V38 reference:** 10 signals, PF=1.37, DD=-4.1%
- **Best orchestrator (Exp_2):** 110 signals, PF=1.11, DD=-32.5%
- **Holdout (May-Jun10):** 83 signals, PF=0.49

---

## 📊 Phase 3-6: Ablation Results (DEV = Jan-Feb 2026)

| Exp | Name | Signals | WR | PF | DD | Sharpe | ΔPF vs prev | Decision |
|---|---|---|---|---|---|---|---|---|
| Exp_0 | baseline (no features) | 2050 | 33.3% | 1.02 | -83.4% | 0.4 | — |  |
| Exp_1 | liquidity + risk (floor) | 184 | 43.5% | 1.02 | -31.2% | 0.12 | +0.00 | KEEP |
| Exp_2 | + regime (soft) | 110 | 45.5% | 1.11 | -32.5% | 0.54 | +0.09 | NEUTRAL |
| Exp_3 | + whale_guard (hard) | 94 | 41.5% | 0.93 | -32.5% | -0.36 | -0.18 | REJECT |
| Exp_4 | + strict_entry (soft) | 8 | 50.0% | 1.36 | -4.8% | 0.4 | +0.43 | KEEP |
| Exp_5 | + sector_heat | 14 | 28.6% | 0.53 | -9.1% | -1.15 | -0.83 | REJECT |
| Exp_6 | + fundamentals | 14 | 28.6% | 0.53 | -9.1% | -1.15 | +0.00 | NEUTRAL |
| Exp_7 | + news_stop (hard) | 14 | 28.6% | 0.53 | -9.1% | -1.15 | +0.00 | NEUTRAL |
| Exp_8 | + exit_logic | 44 | 29.5% | 0.54 | -26.1% | -2.03 | +0.01 | NEUTRAL |
| Exp_9 | strict_entry → hard | 8 | 50.0% | 1.36 | -4.8% | 0.4 | +0.82 | KEEP |
| Exp_V38 | V38 reference | 10 | 50.0% | 1.37 | -4.1% | 0.47 | — | REF |

## 📅 Monthly Breakdown (per experiment)

### Exp_0 — baseline (no features)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 1050 | 33.3% | 1.01 | -76.5% | 0.15 |
| 02 | 1000 | 33.2% | 1.03 | -63.9% | 0.42 |
| **DEV TOTAL** | **2050** | **33.3%** | **1.02** | **-83.4%** | **0.4** |

**Decision:** REJECT — PF dropped 0.34

**Devil's Advocate:**
1. Low WR (33.3%) — could be lucky on a few big winners
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_1 — liquidity + risk (floor)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 104 | 54.8% | 1.6 | -21.8% | 2.37 |
| 02 | 80 | 28.7% | 0.54 | -40.9% | -2.69 |
| **DEV TOTAL** | **184** | **43.5%** | **1.02** | **-31.2%** | **0.12** |

**Decision:** KEEP — DD-52.2%, PF+0.00

**Devil's Advocate:**
1. No obvious red flag — but no out-of-sample validation yet
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_2 — + regime (soft)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 60 | 58.3% | 1.82 | -21.8% | 2.31 |
| 02 | 50 | 30.0% | 0.59 | -31.0% | -1.83 |
| **DEV TOTAL** | **110** | **45.5%** | **1.11** | **-32.5%** | **0.54** |

**Decision:** NEUTRAL — PF+0.09, DD+1.3%, WR+2.0%

**Devil's Advocate:**
1. No obvious red flag — but no out-of-sample validation yet
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_3 — + whale_guard (hard)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 58 | 58.6% | 1.84 | -21.8% | 2.31 |
| 02 | 36 | 13.9% | 0.2 | -29.9% | -5.19 |
| **DEV TOTAL** | **94** | **41.5%** | **0.93** | **-32.5%** | **-0.36** |

**Decision:** REJECT — PF dropped 0.18

**Devil's Advocate:**
1. No obvious red flag — but no out-of-sample validation yet
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_4 — + strict_entry (soft)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 2 | 100.0% | 99.99 | -0.0% | 48.48 |
| 02 | 6 | 33.3% | 0.73 | -4.8% | -0.35 |
| **DEV TOTAL** | **8** | **50.0%** | **1.36** | **-4.8%** | **0.4** |

**Decision:** KEEP — DD-27.7%, PF+0.43

**Devil's Advocate:**
1. Small sample (8 signals) — statistically weak
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_5 — + sector_heat

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 3 | 66.7% | 2.72 | -1.1% | 0.73 |
| 02 | 11 | 18.2% | 0.31 | -10.9% | -1.92 |
| **DEV TOTAL** | **14** | **28.6%** | **0.53** | **-9.1%** | **-1.15** |

**Decision:** REJECT — PF dropped 0.83

**Devil's Advocate:**
1. Small sample (14 signals) — statistically weak
2. Low WR (28.6%) — could be lucky on a few big winners
3. Bear market 2026 — V38 baseline is weak, so comparison may be biased

### Exp_6 — + fundamentals

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 3 | 66.7% | 2.72 | -1.1% | 0.73 |
| 02 | 11 | 18.2% | 0.31 | -10.9% | -1.92 |
| **DEV TOTAL** | **14** | **28.6%** | **0.53** | **-9.1%** | **-1.15** |

**Decision:** NEUTRAL — PF+0.00, DD+0.0% — within thresholds

**Devil's Advocate:**
1. Small sample (14 signals) — statistically weak
2. Low WR (28.6%) — could be lucky on a few big winners
3. Bear market 2026 — V38 baseline is weak, so comparison may be biased

### Exp_7 — + news_stop (hard)

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 3 | 66.7% | 2.72 | -1.1% | 0.73 |
| 02 | 11 | 18.2% | 0.31 | -10.9% | -1.92 |
| **DEV TOTAL** | **14** | **28.6%** | **0.53** | **-9.1%** | **-1.15** |

**Decision:** NEUTRAL — PF+0.00, DD+0.0% — within thresholds

**Devil's Advocate:**
1. Small sample (14 signals) — statistically weak
2. Low WR (28.6%) — could be lucky on a few big winners
3. Bear market 2026 — V38 baseline is weak, so comparison may be biased

### Exp_8 — + exit_logic

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 34 | 32.4% | 0.6 | -21.8% | -1.45 |
| 02 | 10 | 20.0% | 0.36 | -7.9% | -1.59 |
| **DEV TOTAL** | **44** | **29.5%** | **0.54** | **-26.1%** | **-2.03** |

**Decision:** NEUTRAL — PF+0.01, DD+17.0%, WR+0.9%

**Devil's Advocate:**
1. Low WR (29.5%) — could be lucky on a few big winners
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_9 — strict_entry → hard

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 2 | 100.0% | 99.99 | -0.0% | 48.48 |
| 02 | 6 | 33.3% | 0.73 | -4.8% | -0.35 |
| **DEV TOTAL** | **8** | **50.0%** | **1.36** | **-4.8%** | **0.4** |

**Decision:** KEEP — DD-21.3%, PF+0.82

**Devil's Advocate:**
1. Small sample (8 signals) — statistically weak
2. Bear market 2026 — V38 baseline is weak, so comparison may be biased
3. 28-day holdout is short — real test needs Q3/Q4 2026 data

### Exp_V38 — V38 reference

| Month | Signals | WR | PF | DD | Sharpe |
|---|---|---|---|---|---|
| 01 | 5 | 60.0% | 1.91 | -1.7% | 0.66 |
| 02 | 5 | 40.0% | 0.97 | -4.1% | -0.03 |
| **DEV TOTAL** | **10** | **50.0%** | **1.37** | **-4.1%** | **0.47** |

---

## 🔒 Phase 7: Holdout Verification

| Set | Period | Signals | WR | PF | DD | Sharpe | vs DEV PF |
|---|---|---|---|---|---|---|---|
| DEV | 2026-01-01→2026-02-28 | 110 | 45.5% | 1.11 | -32.5% | 0.54 | 100% |
| VAL | 2026-03-01→2026-04-30 | 108 | 48.1% | 1.31 | -31.2% | 1.37 | 118% |
| HOLDOUT | 2026-05-01→2026-06-10 | 83 | 20.5% | 0.49 | -24.3% | -2.85 | 44% |

### Verdict: **B) OVERFIT — النتايج مش بتصمد**

---

## 🆚 Final Comparison: Orchestrator vs V38

| Metric | V38 | Orchestrator (best) | Δ |
|---|---|---|---|
| signals | 10 | 110 | +100.00 |
| wr | 50.0 | 45.5 | -4.50 |
| pf | 1.37 | 1.11 | -0.26 |
| max_dd | 4.1 | 32.5 | -28.40 |
| sharpe | 0.47 | 0.54 | +0.07 |

---

## 🎯 Next Step Recommendation

النتايج مش promising بما يكفي. ننصح بإعادة التفكير في الـ feature set أو الرجوع للـ drawing board (AI/ML/event-driven approach).

---

*Report generated by camp/ablation_runner.py*
