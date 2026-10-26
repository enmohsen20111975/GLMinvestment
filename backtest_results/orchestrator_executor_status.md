# ORCHESTRATOR EXECUTOR STATUS — Code Evidence
> **Task:** BRAVO MISSION CRITICAL — Phase 1
> **Date:** 2026-10-26
> **Base commit:** `9c68237`

---

## 1. Orchestrator — NOT IMPLEMENTED (spec only)

**Finding:** No orchestrator class/module exists in the codebase. The `ORCHESTRATOR-EXECUTOR-SPEC.md` is a design document only.

**Evidence:**
- `find . -name "*orchestrat*"` → 0 results (excluding archive/backups)
- `grep -rn "class Orchestrator\|def orchestrate" vps-service/` → 0 results
- The spec at `Documentation/ORCHESTRATOR-EXECUTOR-SPEC.md` says "SPEC APPROVED (design only — NOT implemented)"

**Verdict:** `NOT IMPLEMENTED` — engine selection is hardcoded in master_analyzer, not dynamic.

---

## 2. Executor — NOT IMPLEMENTED (master_analyzer acts as both)

**Finding:** No separate executor module exists. `MasterAnalyzer.analyze()` IS the executor — it runs all engines internally in a fixed order.

**Evidence:**
- `find . -name "*execut*" vps-service/` → 0 results (only skills/docs)
- `MasterAnalyzer.analyze()` at line 2056 calls all sub-engines directly
- The "pipeline" is: `analyze() → _run_technical() → _run_fundamental() → _run_confluence() → ... → return MasterAnalysis`

**Verdict:** `NOT IMPLEMENTED as separate module` — master_analyzer is monolithic (acts as both orchestrator + executor).

---

## 3. Actual Decision Path (proven from code)

```
1. Request: API endpoint OR daily_predictor.py cron
   ↓
2. scanner_routes.py:182 → MasterAnalyzer(DATABASE_PATH)
   ↓
3. analyzer.analyze(ticker) [line 2056]
   ↓
4. Internal pipeline (FIXED ORDER, no dynamic selection):
   a. _get_full_price_data() — price data from stocks.db/price_history.db
   b. Liquidity check (inline, not separate module)
   c. Market regime detection (inline)
   d. Technical analysis (calls technical.py, technical_weighted.py, smc_engine.py)
   e. Fundamental analysis (calls fundamental.py, fundamental_scorer.py)
   f. Confluence scoring (calls confluence_engine_v3.py)
   g. Conviction engine (calls conviction_engine.py)
   h. Risk profile calculation (inline)
   i. Position sizing (inline)
   ↓
5. Returns MasterAnalysis dataclass with:
   - signal (STRONG_BUY|BUY|HOLD|SELL|STRONG_SELL)
   - master_score (0-100)
   - risk_profile (entry, stop, target, R:R)
   - suggested_position_size
   ↓
6. scanner_routes.py:271 → maps to API response:
   "recommendation": analysis.signal
   "recommendation_ar": analysis.signal_ar
   ↓
7. API response → frontend
```

**Key finding:** The decision path is LINEAR and HARDCODED. There is no dynamic orchestrator selecting engines per market state.

---

## 4. Risk Gate — NOT CONNECTED to decision path

**Finding:** `vps-service/core/risk_gate.py` exists but is NEVER CALLED from the decision path.

**Evidence:**
- `grep -rn "apply_risk_gate\|from core.risk_gate" vps-service/ src/ scripts/` → only in test files
- `scanner_routes.py` does NOT import or call `apply_risk_gate`
- `daily_predictor.py` calls a DIFFERENT function: `engine.flow_system.evaluate_risk` (line 3953)
- `MasterAnalyzer.analyze()` does NOT call `apply_risk_gate`

**Risk gate position limitation:**
The `apply_risk_gate()` function modifies `position_size_pct` locally but does NOT return the clamped value. The function signature returns `(signal, warnings)` only.

**Verdict:** `NOT CONNECTED` — risk gate is a standalone module with tests, but NOT integrated into the production decision path.

---

## 5. Decision Log — PARTIALLY CONNECTED

**Finding:** There are TWO decision log systems:
1. `vps-service/core/decision_log.py` (my module) — NOT called from production
2. `vps-service/analyzers/decision_logger.py` (existing) — called from daily_predictor.py

**Evidence:**
- `daily_predictor.py:2612` → `from analyzers.decision_logger import log_decision`
- `daily_predictor.py:2755, 2797` → also calls `log_decision`
- `scanner_routes.py` does NOT call either log function

**Verdict:** `PARTIALLY CONNECTED` — daily_predictor logs some decisions, but scanner_routes (API path) does NOT log.

---

## 6. Summary Table

| Component | Exists? | Integrated? | Evidence |
|---|---|---|---|
| Orchestrator | ❌ NO (spec only) | N/A | 0 code files found |
| Executor | ❌ NO (master_analyzer is monolithic) | N/A | analyze() does everything |
| Risk Gate | ✅ YES (module exists) | ❌ NOT CONNECTED | 0 callers in production path |
| Decision Log | ✅ YES (2 modules) | ⚠️ PARTIAL | daily_predictor only, API path doesn't log |
| MasterAnalyzer | ✅ YES | ✅ Unified decision source | scanner_routes.py:182 |
| Market filter (C2) | ✅ YES | ✅ Connected | verify_radar_signals.py + route.ts |

---

## 7. What the ACTUAL path is today

```
API request → scanner_routes.py → MasterAnalyzer.analyze() → 
  [inline: data → liquidity → regime → technical → fundamental → 
   confluence → conviction → risk_profile → position_size] →
  MasterAnalysis(signal, score, risk_profile) →
  API response {"recommendation": signal}
```

**No orchestrator. No executor. No risk gate. No decision log (on API path).**

The system works, but the architecture is monolithic. The orchestrator/executor/risk_gate modules I created are standalone — they need to be WELDED into the production path.

---

## 8. What needs to happen for full integration

1. **Orchestrator:** Implement `select_engines(market_state, data_quality)` that returns a plan
2. **Executor:** Refactor `MasterAnalyzer.analyze()` to accept a plan and execute only selected engines
3. **Risk Gate:** Call `apply_risk_gate()` AFTER analyze() but BEFORE returning to API
4. **Decision Log:** Call `log_decision()` in scanner_routes.py after analysis
5. **Position size return:** Fix `apply_risk_gate()` to return clamped position_size

**This requires owner approval** — it changes the production decision path.
