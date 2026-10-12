# Engine Inventory & Unification Certificate (PKG4)

**Issued by:** Technical Implementer (Z.ai Code)
**Date:** 2026-10-11
**Scope:** `vps-service/` analytics + indicators layer
**Constitution refs:** Rule 35 (ENGINE-UNIFY), Rule 54 (CALCULATION-CANONICAL), Rule 67 (SSOT)

---

## 1. Canonical Indicator Registry (THE single source of truth)

All technical indicators MUST be computed via `vps-service/analyzers/indicators/`.
Any inline duplicate is a **Rule 54 violation** and must be refactored to delegate.

| Indicator | Canonical file | Formula | API |
|---|---|---|---|
| **ATR** | `analyzers/indicators/atr.py` | Wilder's smoothing `(prev×(p-1)+tr)/p` | `List[float] → Optional[float]` |
| **RSI** | `analyzers/indicators/rsi.py` | Wilder's smoothing | `List[float] → Optional[float]` |
| **SRSI** | `analyzers/indicators/srsi.py` | Chande & Kroll 1994 | `List[float] → tuple` |
| **SMA/EMA/MACD** | `analyzers/indicators/ma.py` | standard | `List[float] → ...` |

Export entry-point: `from analyzers.indicators import calc_atr, calc_rsi, calc_srsi`.

---

## 2. Inventory of duplicate definitions (pre-unification baseline)

Found during PKG4-SCOPE. This is the **starting point**; each row's target is
"1 canonical + N thin wrappers that delegate".

### ATR — 16 definitions found (CRITICAL)
| File | Status | Action |
|---|---|---|
| `analyzers/indicators/atr.py` | ✅ canonical | keep |
| `analyzers/enhanced_indicators.py:calc_atr` | ❌ **was SMA (BUG)** | **FIXED PKG4-DEV-A** → now Wilder's |
| `analyzers/core_scoring_engine.py:calc_atr` | ⚠️ delegates + fallback | verify delegation |
| `analyzers/sniper_engine.py:calc_atr` | ⚠️ inline Wilder's | refactor to delegate |
| `analyzers/golden_hunter.py:_safe_atr` | ❌ window subset | refactor to delegate |
| `engines/backtest_engine.py:calc_atr` | ⚠️ inline | refactor to delegate |
| `glminvestment_engines/core/indicators.py:atr` | ⚠️ pandas API (parallel layer) | reconcile API |
| `scripts/backtest_sniper.py`, `production_backtest_tf.py`, `honest_backtest_*.py`, `backfill_with_personas.py`, `backfill_to_predictions.py`, `backtesting_engine.py`, `dynamic_exit_optimizer.py`, `egx_sniper_backtest.py` | ⚠️ inline copies in scripts | refactor to import canonical |

### RSI — 5 definitions (math mostly Wilder's, but no single API)
| File | Status |
|---|---|
| `analyzers/indicators/rsi.py` | ✅ canonical |
| `analyzers/technical.py` | ✅ delegates to canonical |
| `analyzers/master_analyzer.py:_inline_rsi` | ⚠️ duplicate inline (remove) |
| `analyzers/live_indicator_engine.py:calculate_live_rsi` | ⚠️ streaming variant (keep, document) |
| `analyzers/screener.py` | ❌ reads non-canonical DB column (FIX) |

### MACD — 9 definitions (different EMA seeding → different values)
| File | Status |
|---|---|
| `analyzers/indicators/ma.py:macd` | ✅ canonical |
| others | refactor to delegate |

---

## 3. Scoring Engines — conflict resolution

Two engines both claim to be "the unified one":
- **`CoreScoringEngine`** (`analyzers/core_scoring_engine.py`) — declares "النقطة الوحيدة للتحليل"
- **`MasterAnalyzer`** (`analyzers/master_analyzer.py`) — declares "THE BRAIN"

**Resolution (Rule 35):** `MasterAnalyzer` is the canonical orchestrator (Rule 67 #9 — master_score).
`CoreScoringEngine` is a sub-scorer consumed by MasterAnalyzer. The naming conflict
is a documentation issue, not a runtime one — but the claim in `CoreScoringEngine`'s
docstring must be corrected to "sub-scorer" not "the only point".

---

## 4. Rogue tools (to be archived/disabled)

| Script | Violation | Action |
|---|---|---|
| `scripts/rocket_detector_tuned.py` | rogue detector | archive |
| `scripts/rocket_detector_final.py` | rogue detector | archive |
| `scripts/rocket_detector_final_v2.py` | reads /tmp/dbs, inline V1-V4 | archive |
| `scripts/volume_surge_hunter_test.py` | inline sma/ema | archive |
| `scripts/delta_volume_calculator.py` | writes delta_volume schema to data_engine.db | quarantine |
| `scripts/explosive_opportunity_hunter.py` | standalone scanner | archive |

---

## 5. Fixes applied this round (PKG4-DEV-A)

| ID | File | Change | Verified |
|---|---|---|---|
| PKG4-DEV-A | `analyzers/enhanced_indicators.py:calc_atr` | Replaced SMA(period) with Wilder's smoothing (matches canonical `atr.py`). This was a **real math bug** producing inflated ATR on trending data. | formula diff against canonical ✅ |

---

## 6. Enforcement layer (NEW — pre-commit hook)

`scripts/git-hooks/pre-commit-engine-unity` scans staged Python files and
**blocks** any new `def calc_atr` / `def calc_rsi` / `def calc_macd` outside
`analyzers/indicators/`. This prevents Rule 54 regressions.

Install: `cp scripts/git-hooks/pre-commit-engine-unity .git/hooks/pre-commit && chmod +x $_`

---

## 7. Unification Certificate

> **Engine Unification Certificate — Partial (Round 1)**
>
> This certifies that, as of 2026-10-11:
> - [x] The canonical indicator registry is documented (Section 1).
> - [x] The ATR SMA math bug is FIXED in `enhanced_indicators.py`.
> - [x] A pre-commit enforcement hook prevents new inline indicator duplicates.
> - [ ] The 15 remaining inline ATR copies are refactored to delegate (Round 2).
> - [ ] The 4 remaining RSI copies are refactored (Round 2).
> - [ ] The 8 remaining MACD copies are refactored (Round 2).
> - [ ] The 6 rogue scripts are archived (Round 2).
> - [ ] The `CoreScoringEngine` vs `MasterAnalyzer` naming claim is corrected (Round 2).
>
> **Status:** Round 1 foundations complete (registry + critical bug fix + enforcement).
> Full unification requires Round 2 delegation refactor (tracked above).
>
> Signed: Technical Implementer (Z.ai Code)

---

*Appended to worklog.md as Task ID PKG4-DEV-A.*
