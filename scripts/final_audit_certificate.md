# GLMinvestment — FINAL AUDIT CERTIFICATE
# Batch 10 — Master Execution Complete
# Generated: 2026-08-19
# Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅

====================================
GLMINVESTMENT MASTER AUDIT — FINAL CERTIFICATE
====================================

## EDGE_STATUS: UNPROVEN

### السبب:
1. Look-ahead bias مثبت (بيانات مستقبلية استُخدمت في قرارات ماضية)
2. Buy&Hold يتفوق بـ 2.5× على exit logic الحالي
3. Simple momentum يتفوق على complex scoring
4. Learning loop مكسور تماماً (learned_lessons = 0)
5. Ablation غير مكتمل (يحتاج Python backend)

---

## 1. DATASET MD5 ✅
```
MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
MATCH: TRUE
predictions: 153 (148 closed, 5 active)
price_history: 288,194 rows | 1,260 tickers
stocks: 1,046 | data_engine: 970
```

## 2. Gold KPI Determinism ✅
```
4 KPI readers aligned (honest-tracking, credibility, live-monitor, platform-performance)
1 reader NON_AUDITED (analyst/predictions — no morning_bell column)
Same n_valid across runs: ✅ DETERMINISTIC
exclusion_breakdown: present ✅
capped_rows: 1 (HARD cap applied) ✅
avg_loss: -6.12 (negative) ✅
by_channel: [balanced, morning_bell] separated ✅
```

## 3. PIT Validation ❌ FAIL
```
Look-ahead bias PROVEN:
- 80/153 predictions use future fundamentals (fiscal_end > prediction_date)
- 146/153 use August 2026 stocks snapshot for January predictions
- 148/153 retroactively generated (created_at > prediction_date)
- news_articles.symbol NULL for all 7894 rows (cannot verify per-ticker)

CLASSIFICATION:
- retro_generated: 148/153 (96.7%)
- live-like: 5/153 (3.3%)
- pit_eligible: 0 (0% — all predictions use future data)

LIMITATION: All KPIs may be inflated by look-ahead bias.
```

## 4. Clean Backtest Tables

### Per Channel (NO_COST):
| Channel | n | WR | PF | Exp | avg_win | avg_loss | max_loss | max_win | TP% | Stop% |
|---------|-----|-----|-----|------|---------|----------|----------|---------|-----|-------|
| balanced | 108 | 54.6% | 1.70 | +1.95% | +8.66% | -6.13% | -7.59% | +50.0% | 38.1% | 47.6% |
| morning_bell | 39 | 46.2% | 1.04 | +0.13% | +7.39% | -6.09% | -7.23% | +11.2% | 35.9% | 53.8% |

### Commission Scenarios (balanced):
| Scenario | PF | Exp | Survives? |
|----------|-----|------|-----------|
| NO_COST | 1.70 | +1.95% | ✅ |
| BASE (0.40%) | 1.53 | +1.56% | ✅ |
| STRESS (0.80%) | 1.37 | +1.16% | ✅ |

### Commission Scenarios (morning_bell):
| Scenario | PF | Exp | Survives? |
|----------|-----|------|-----------|
| NO_COST | 1.04 | +0.13% | ⚠️ marginal |
| BASE (0.40%) | 0.92 | -0.27% | ❌ FAIL |
| STRESS (0.80%) | 0.82 | -0.67% | ❌ FAIL |

### Regime Breakdown (balanced):
| Regime | n | WR | PF | Exp |
|--------|-----|-----|-----|------|
| Bear | 27 | 48.1% | 1.37 | +1.17% |
| Range | 62 | 43.5% | 1.15 | +0.51% |
| Bull | 2 | 100% | ∞ | +9.10% |

### Profit Concentration:
- Top 1: 2.40% | Top 3: 6.96% | Top 5: 11.26% | Top 10: 21.65%
- Pareto: 80% from 34% of trades → DISTRIBUTED ✅

### Portfolio MaxDD:
- ALL: 7.48% | balanced: 6.13% | morning_bell: 5.39%

## 5. Baselines Table

| Strategy | n | WR | PF | Exp% | GLM beats? |
|----------|-----|-----|-----|------|------------|
| **GLMinvestment (balanced)** | 108 | 54.6% | **1.70** | **+1.96%** | — |
| Random (MC ×1000) | 108 | 54.5% | 1.58 | +1.16% | ✅ YES |
| Momentum (20d, top-3) | 114 | 64.9% | **2.57** | **+2.76%** | ❌ NO |
| RVOL (top-3) | 114 | 51.8% | 1.43 | +1.06% | ✅ YES |
| EGX Benchmark | 556 | 45.5% | 1.12 | +1.09% | ✅ YES |
| Buy & Hold (no TP/SL) | 108 | 44.4% | **2.45** | **+4.98%** | ❌ NO |

### Verdict: GLMinvestment beats 3/5 baselines but LOSES to Momentum + Buy&Hold

## 6. Exit Decomposition (RESEARCH)

| Exit Strategy | balanced Exp% | morning_bell Exp% | Observation |
|---------------|--------------|-------------------|-------------|
| Fixed TP/SL (current) | +0.76% | -0.10% | Current production |
| Buy&Hold 10d | +1.92% | -0.98% | Better than fixed |
| Buy&Hold 20d | +2.95% | -0.13% | Better than fixed |
| **Buy&Hold 30d** | **+3.46%** | **+0.13%** | **Best for balanced** |
| Trailing ATR×2 | +1.83% | -1.88% | Better than fixed for balanced |
| Partial T1 (50% at 1.5R) + BH 20d | +2.71% | -0.37% | Good balance |

### Answer: Does exit kill selection?
- **balanced: YES** — Fixed TP/SL cuts 78% of potential alpha (0.76% vs 3.46%)
- **morning_bell: NO** — Selection itself is weak (all exits near zero/negative)

## 7. Ablation: INCOMPLETE
```
Requires Python backend (V40.2) with ability to disable individual components.
Not available in sandbox — documented as limitation.
Components to test: fundamentals, volume/RVOL, sector, SMC, regime, dynamic R:R
```

## 8. Architecture Residual

### Prediction Writers (6 parallel — CRITICAL):
1. maestro_orchestrator → record_prediction ✅
2. v40_2_daily_generator → record_prediction ✅
3. sniper_routes → **FIXED** (was direct INSERT, now uses record_prediction) ✅
4. ai_predictions_routes → INSERT on predictions + aiPrediction ⚠️
5. historical_predictions_v2_routes → INSERT on predictions ⚠️
6. crypto_prediction_engine → INSERT on crypto_predictions (separate)

### Drift Residual (after Batch 1 fixes):
- V40.3 R/R floor: FIXED (5 locations aligned) ✅
- confidence_top_pick: FIXED (8 locations 80→75) ✅
- STRONG_BUY threshold: **5 different values (65/70/75/80/90)** — NEEDS_OWNER
- risk_per_trade: 2.0 vs 1.5 (2 locations) — NEEDS_OWNER
- persona_trail_atr: +1.0 ATR drift in sniper — NEEDS_OWNER

### Dead Code:
- 3 dead engines (dynamic_analysis, live_prediction, crypto_full_system)
- 15 orphan blueprint routes (DEPRECATED, not registered)
- 6 orphan files (correlation_filter, trend_following_paper_trading, 4 test files)

## 9. Learning Loop: BROKEN ❌

### 5 Breaks in the chain:
1. learned_lessons table TRUNCATED (was 8150 rows, now 0)
2. daily_closer cron NOT RUNNING
3. learning_engine cron NOT RUNNING
4. prediction_tracker.learn_from_failure() — SCHEMA MISMATCH (silent failure)
5. **V40.2 (active generator) does NOT read lessons** — completely blind

### Verdict:
The system HAS learning code that WORKS when manually triggered,
but the automated pipeline is BROKEN. The active generator (V40.2)
doesn't even read lessons. The system claims self-learning but
does NOT learn in practice.

---

## FINAL CERTIFICATE

```text
EDGE_STATUS: UNPROVEN
PIT_VALIDATION: FAIL (look-ahead bias proven — 80/153 fundamentals + 146/153 stocks snapshot)
CLEAN_BACKTEST:
  balanced: n=108, WR=54.6%, PF=1.70, Exp=+1.95%, max_loss=-7.59%
  morning_bell: n=39, WR=46.2%, PF=1.04, Exp=+0.13%, max_loss=-7.23%
  Commission: balanced survives STRESS (PF=1.37), morning_bell FAILS BASE (PF=0.92)
  Regime: balanced robust (bear+range), morning_bell range-only
  Concentration: distributed (Top1=2.4%, Pareto 80% from 34%)
  MaxDD: 7.48% (acceptable)
CLEAN_BASELINES:
  GLM beats Random: YES (PF 1.70 vs 1.58)
  GLM beats RVOL: YES (PF 1.70 vs 1.43)
  GLM beats Benchmark: YES (PF 1.70 vs 1.12)
  GLM beats Momentum: NO (PF 1.70 vs 2.57)
  GLM beats Buy&Hold: NO (Exp +1.96% vs +4.98%)
EXIT_DECOMPOSITION:
  balanced: Fixed TP/SL Exp=+0.76% vs Buy&Hold 30d Exp=+3.46% → EXIT KILLS SELECTION
  morning_bell: All exits near zero → SELECTION is the bottleneck
ABLATION: INCOMPLETE (needs Python backend)
ARCHITECTURE_RESIDUAL:
  Writers: 6 parallel (sniper FIXED, 2 remaining direct INSERTs)
  Drifts: V40.3 R/R FIXED, confidence FIXED, STRONG_BUY 5 values NEEDS_OWNER
  Dead code: 3 engines + 15 routes + 6 files
LEARNING_LOOP: BROKEN (5 breaks — table empty + cron not running + V40.2 blind)
WHAT_SURVIVES_WITHOUT_FUTURE_DATA: balanced has a real selection edge (beats random + benchmark) but exit logic destroys 78% of it and simple momentum outperforms the complex scoring
BEATS_MOMENTUM: NO
EXIT_KILLS_SELECTION: YES (for balanced)
NEXT_ALLOWED:
  - Fix exit logic (trailing stop or partial T1)
  - Fix learning loop (5 breaks)
  - Run ablation (needs Python backend)
  - Quarantine morning_bell (fails costs)
  - Fix STRONG_BUY unification (NEEDS_OWNER)
NEXT_FORBIDDEN:
  - Claiming Edge PROVEN
  - Adding new features before fixing exit + learning
  - Deleting code without VERIFY-BEFORE-DELETE
  - Tuning production thresholds
FILES_CHANGED: 11 (Batch 1) + 5 (Phase 0 KPI alignment) + 2 (Phase 0 critical fixes)
COMMITS: Pending owner approval
```

---

## THE HARD TRUTH (1 sentence)

بعد إزالة المستقبل من البيانات، النظام يتفوق على العشوائية والـ benchmark لكن **لا يتفوق على momentum بسيط**، و**exit logic الحالي يقتل 78% من الـ alpha** على قناة balanced، و**learning loop مكسور تماماً** — فالنظام يدّعي التعلم الذاتي لكنه لا يتعلم.

---

## RECOMMENDED NEXT STEPS (for Owner)

1. **إصلاح exit logic** (P0): trailing ATR×2 أو partial T1 → متوقع Exp من +0.76% → +1.8% على balanced
2. **إصلاح learning loop** (P0): 5 breaks — تشغيل cron + إصلاح schema + ربط V40.2
3. **عزل morning_bell** (P1): fails at BASE_COST (PF=0.92)
4. **توحيد STRONG_BUY** (P1): 5 قيم مختلفة (65-90) → توحيد على 75
5. **حذف dead code** (P2): 3 engines + 15 routes + 6 files (VERIFY-BEFORE-DELETE)
6. **تشغيل ablation** (P2): يحتاج Python backend
7. **Point-in-time data** (P2): إصلاح look-ahead bias
