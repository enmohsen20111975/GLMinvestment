# MAESTRO-MAP.md — Trace Map (STEP 0)

> **Task:** MAESTRO-CANCER-1 STEP 0 (TRACE before any touch)
> **Agent:** Bravo
> **Status:** 🔴 STOP — live callers found beyond John's list. Need owner decision.

---

## 1. maestro_orchestrator.py (4,416 lines)

**Size:** 4,416 lines. **Imports:** 12+ files import from it.

### Live callers (CRITICAL — beyond John's list):

| Caller | Line | Import | Live? | Coupling |
|--------|------|--------|-------|----------|
| `jobs/daily_predictor.py` | L3811 | `run_expert_memory_phase` | ✅ LIVE | **Optional shim** (`except: pass` safe-by-design) — lesson-based veto |
| `telegram/auto_post_scheduler.py` | L1190 | `daily_opportunities` | ✅ LIVE | **Hard dependency** — generates telegram posts |
| `api/maestro_routes.py` | L26 | `MaestroOrchestrator` + more | ✅ LIVE | 13 endpoints on port 8010 |
| `analyzers/hunting_engine.py` | L53, L1066 | `MaestroOrchestrator` + `MaestroHumanContext` | ✅ LIVE | **Used by api/stock_analysis_routes.py:43** (LIVE API!) |
| `analyzers/unified_maestro.py` | L48 | `MaestroOrchestrator` + `MaestroResult` | ✅ LIVE | Used by background_analyzer |
| `analyzers/background_analyzer.py` | L110 | `MaestroOrchestrator` + `MaestroResult` | ✅ LIVE | **Used by jobs/market_scheduler.py:114** (CRON!) |
| `analyzers/crypto_maestro.py` | (via recorder) | `CryptoMaestroOrchestrator` | ✅ LIVE | Used by `live_signals/recorder.py:39` |
| `live_signals/recorder.py` | L116 | `MaestroOrchestrator` | ✅ LIVE | EGX signals recorder |
| `core/analysis_runner.py` | L244 | `background_analyzer` (chain) | ✅ LIVE | analysis batch runner |
| `analyzers/master_analyzer.py` | L2094 | `background_analyzer` (chain) | ✅ LIVE | core engine |
| `scripts/maestro_backfill_phase3.py` | L662 | `MaestroOrchestrator` | 🟡 script | manual backfill script |
| `scripts/publish_today_picks.py` | L75 | `MaestroOrchestrator` | 🟡 script | manual publish script |
| `scripts/rebuild_predictions.py` | L126 | `MaestroOrchestrator` | 🟡 script | manual rebuild script |

---

## 2. maestro_routes.py (13 endpoints)

**Size:** 1,094 lines. **Blueprint:** `maestro_bp` registered in `lightweight_server.py:L53`.

### Endpoints (13):
```
POST /api/maestro/run              ← 🔴 CRITICAL: anyone can trigger!
GET  /api/maestro/persona
GET  /api/maestro/stock/<ticker>
GET  /api/maestro/daily-opportunities
... (9 more — need full enumeration)
```

---

## 3. Zombie Analyzers — NOT Zombies!

John said "4 zombie analyzers". **They're NOT zombies — they have live callers:**

| Analyzer | Live Caller | Risk |
|----------|-------------|------|
| `crypto_maestro.py` | `live_signals/recorder.py:39` | 🟡 recorder might be cron'd |
| `unified_maestro.py` | `background_analyzer.py:118` | 🔴 chain to market_scheduler (cron) |
| `hunting_engine.py` | `api/stock_analysis_routes.py:43` | 🔴 **LIVE API endpoint!** |
| `background_analyzer.py` | `jobs/market_scheduler.py:114` | 🔴 **CRON job!** |

---

## 4. Thresholds Contradiction

| Source | Thresholds | Location |
|--------|------------|----------|
| maestro_orchestrator | 55/42/30 | L307, L329, L341, L349 |
| V40.2 (engine_settings) | 78/65/55 | SSOT |

**Customer impact:** contradictory recommendations (maestro vs V40.2).

---

## 5. Dependency Chain (the cancer spread)

```
daily_predictor.py (V40.2 heart)
  └── run_expert_memory_phase (optional shim — safe to remove)

telegram/auto_post_scheduler.py
  └── daily_opportunities (HARD dependency — needs V40.2 replacement)

api/stock_analysis_routes.py (LIVE API)
  └── hunting_engine
      └── MaestroOrchestrator + MaestroHumanContext

jobs/market_scheduler.py (CRON)
  └── background_analyzer
      └── unified_maestro
          └── MaestroOrchestrator

live_signals/recorder.py
  └── crypto_maestro
      └── CryptoMaestroOrchestrator (separate class?)

analyzers/master_analyzer.py (CORE engine)
  └── background_analyzer (chain above)
```

---

## 🔴 DECISION NEEDED FROM JOHN

**John's plan assumed:**
- daily_predictor = optional shim ✅ (verified safe)
- telegram = live (needs replacement) ✅ (verified)
- 4 zombies = safe to kill ❌ **WRONG — they have live callers**

**My recommendation:**

### Safe to proceed (STEP 1-3):
- STEP 1 (frontend disconnect): ✅ safe — maestro_routes 410 Gone
- STEP 2 (telegram disconnect): ✅ safe — replace daily_opportunities with V40.2
- STEP 3 (V40.2 heart): ✅ safe — run_expert_memory_phase is optional shim

### BLOCKED (need John's decision):
- **STEP 4 (kill 13 endpoints):** safe BUT hunting_engine still imports MaestroOrchestrator → will break stock_analysis_routes
- **STEP 5 (kill 4 zombies):** ❌ NOT SAFE — hunting_engine + background_analyzer + crypto_maestro have LIVE callers
- **STEP 6 (kill maestro_orchestrator.py):** ❌ NOT SAFE until ALL callers removed

### The real cancer map:
maestro_orchestrator is NOT just daily_predictor + telegram. It's:
- **5 live API/job callers** (daily_predictor, telegram, stock_analysis_routes, market_scheduler, live_signals/recorder)
- **3 scripts** (manual)
- **4 analyzer middlemen** (hunting_engine, unified_maestro, background_analyzer, crypto_maestro)

**To fully remove maestro_orchestrator, we need to:**
1. Replace `run_expert_memory_phase` in daily_predictor (or remove — it's optional)
2. Replace `daily_opportunities` in telegram with V40.2
3. Replace hunting_engine usage in stock_analysis_routes with V40.2
4. Replace background_analyzer in market_scheduler with V40.2
5. Replace crypto_maestro in live_signals/recorder with V40.2
6. Then kill the 4 middlemen
7. Then kill maestro_orchestrator.py

This is a **7-step surgical plan**, not 6.

---

## Recommendation

**Proceed with STEP 1-3 (safe disconnections).** STOP before STEP 4-6 until John reviews this map and confirms the expanded scope.

The cancer is deeper than expected. Removing maestro_orchestrator.py requires replacing its logic in 5 live callers, not just 2.
