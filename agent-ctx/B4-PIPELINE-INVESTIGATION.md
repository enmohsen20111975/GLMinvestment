# B4 — Market Regime & NO_TRADE Pipeline Investigation Report

**Task ID:** 1-c
**Agent:** Bravo (B4 — Market Regime & NO_TRADE)
**Baseline commit:** `5a13c53`
**Scope:** Trace the full decision pipeline from regime source → predictor → risk_gate → decision_log → API → frontend, identify where counter-trend opportunities enter during BEAR/DEFENSIVE market, expose real `market_regime` + `no_trade_reason` + per-ticker `decision` to the API contract.

---

## 1. Pipeline Diagram (text)

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [1] analyzers/market_regime_engine.py  (MarketRegimeEngine, 1381 LOC)      │
 │      update_regime() / get_current_regime()                                 │
 │        • Computes 6 indicators: SMA20/50/200, breadth, ATR, turnover,      │
 │          loss_streak, drawdown                                              │
 │        • Applies 2-3 day hysteresis (prevents flip-flop)                   │
 │        • Persists to  stocks.db.system_settings (key = current_regime_EGX)  │
 │          JSON blob: {"current_regime": "DEFENSIVE|NORMAL|AGGRESSIVE", ...} │
 │        • Appends to  stocks.db.market_regime_log  (audit)                  │
 │        • Returns RegimeResult{ regime, thresholds:REGIME_CONFIG[regime],   │
 │                                 reasons, indicators }                      │
 │                                                                             │
 │      REGIME_CONFIG (the per-regime override applied to V40.2 defaults):    │
 │        DEFENSIVE  → min_rr=1.8, min_score=65, max_picks=5, pos_mult=0.5    │
 │        NORMAL    → min_rr=1.5, min_score=60, max_picks=5, pos_mult=0.8    │
 │        AGGRESSIVE → min_rr=1.5, min_score=70, max_picks=7, pos_mult=1.0    │
 └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  (read at start of run_generator)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [2] jobs/daily_predictor.py  (4730 LOC — main entry point)                │
 │      Lines 867-919: read MarketRegimeEngine → set _regime_name,            │
 │      _regime_cfg, override max_picks, DNA_MAX_OPEN_POSITIONS.               │
 │                                                                             │
 │      Lines 3758-3832: PICKS SELECTION — per scan_date                       │
 │        buy_signals = [s for s in all_day_signals                            │
 │                       if s.signal in ('BUY','STRONG_BUY','INSTITUTIONAL_BUY')]│
 │        picks = buy_signals[:max_picks]   (sorted by evidence/RR/score)      │
 │                                                                             │
 │        ⚠️ DEFECT #1  (lines 3761):                                          │
 │           NO_TRADE / HOLD / SELL signals silently dropped — never written  │
 │           to predictions / stored_analyses. The DB therefore has NO         │
 │           NO_TRADE rows for the API to surface.                             │
 │                                                                             │
 │        ⚠️ DEFECT #2  (lines 3777-3832) — RADAR FALLBACK:                     │
 │           if (_regime_name == 'DEFENSIVE') AND (len(picks) == 0):           │
 │             re-run detect_pre_surge / detect_quiet_accumulation             │
 │             fabricate dict { 'signal':'BUY', 'source':'radar_fallback',    │
 │                               'position_size_mult':0.5, ... }               │
 │             picks = fabricated_candidates[:max_picks]                      │
 │           Comment literally says: "RADAR FALLBACK (2026-10-05): لو DEFENSIVE│
 │           regime و مفيش picks → استخدم radar candidates"                   │
 │           → Injects counter-trend BUY signals during BEAR market.           │
 │                                                                             │
 │      Lines 3880-4040: HARD GATES (BRAVO-EVALUATE-RISK, HARD-QUANT-KILL):    │
 │        R:R ≥ 1.8, confidence ≥ 65%, falling-knife prevention.              │
 │        Skips (continue) any BUY signal that fails. Radar-fallback BUY      │
 │        signals also pass through these gates.                               │
 │                                                                             │
 │      Lines 4047-4186: WRITE — tracker.record_prediction() → predictions   │
 │      table; UPSERT into stored_analyses (id=v40_<TICKER>_EGX).             │
 └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [3] core/risk_gate.py  (108 LOC)                                          │
 │      apply_risk_gate() — Rule 1-6: liquidity / R:R / size / conviction /    │
 │      stale / critical-engine-failure → downgrade or NO_TRADE.              │
 │                                                                             │
 │      NOTE: This module is NOT invoked by daily_predictor.py. It is the     │
 │      gate used by orchestrator_v3.py + executor_v3.py (a SEPARATE v3       │
 │      pipeline that is not wired into the live predictions path). The live  │
 │      V40.2 pipeline has its own ad-hoc gates (lines 3880-4040 above).      │
 └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [4] analyzers/decision_logger.py  +  core/decision_log.py (shim)           │
 │      log_decision(symbol, decision_type, reason_code, ...)                 │
 │        • Persists reject_entry / force_exit to decision_log.db              │
 │        • Audit-only — does NOT drive the predictions table.                │
 │      REASON_CODES: late_entry, not_accumulation, danger_level_5,          │
 │                    disclosure_veto, news_veto, distribution_exit, ...      │
 └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [5] API endpoints serving the frontend                                    │
 │                                                                             │
 │  (a) /api/daily/rebuild-predictions   (misc_routes.py:1660, GET/POST)      │
 │        Reads predictions + stored_analyses (last 48h only)                 │
 │        Response shape: {success, performance, predictions_count,           │
 │          top_monthly_trades, activePredictions[], closedPredictions[],     │
 │          testing_candidates, market_status, stats, timestamp}               │
 │        ⚠️ NO market_regime field                                            │
 │        ⚠️ NO no_trade_reason field                                          │
 │        market_status only "نشط" / "كاش وانتظار..." — based on list size,   │
 │          NOT on actual MarketRegimeEngine regime.                          │
 │                                                                             │
 │  (b) /api/unified/predictions  (misc_routes.py:2555, GET/POST, @require_admin)│
 │        Reads stored_analyses + predictions                                  │
 │        Line 3362:  open_predictions = _cascading_fallback_select(           │
 │                                       predictions, target=5)               │
 │                                                                             │
 │        ⚠️ DEFECT #3 — CASCADING-FALLBACK-031  (misc_routes.py:2442-2543): │
 │          Tier 1 strict  (score≥70, RR≥1.5)                                 │
 │          Tier 2 moderate(score≥60, RR≥1.3)                                 │
 │          Tier 3 survival (score≥50, RR≥1.2)                                 │
 │          Tier 4 last_resort (score≥0,  RR≥0)  ← GUARANTEES 5 picks        │
 │          Comment literally says:                                            │
 │            "ده ضمان إن الشاشة متفضيش أبداً (حتى لو السوق هادي جداً)"        │
 │            ("Guarantees the screen NEVER goes empty — even when market     │
 │             is very calm/weak")                                             │
 │          → Fabricates 5 picks even when no real BUY qualifies.             │
 │                                                                             │
 │        Response shape: {success, predictions, active_predictions,           │
 │          previous_predictions, investor_predictions, trader_predictions,   │
 │          closed_predictions, open_predictions, total, closed_count,         │
 │          open_count, previous_count, testing_candidates, market,           │
 │          cascade{dominant_tier, tier_counts, note_ar, tiers}, stats, ...}   │
 │        ⚠️ NO market_regime field                                            │
 │        ⚠️ NO no_trade_reason field                                          │
 │        cascade.dominant_tier is the closest proxy but does NOT expose the  │
 │        real DEFENSIVE/NORMAL/AGGRESSIVE regime.                             │
 │                                                                             │
 │  (c) /api/predictions/daily-picks  (picks_management_routes.py:155, GET)   │
 │        SELECT * FROM stored_analyses WHERE confidence >= ?                  │
 │        Response shape: {success, date, persona, picks[], stats, limit}      │
 │        ⚠️ NO market_regime field                                            │
 │        ⚠️ NO no_trade_reason field                                          │
 │        ❌ No fallback fabrication here — pure SQL read.                     │
 │                                                                             │
 │  (d) /api/regime/market  (regime_routes.py:62, GET)                        │
 │        Calls RegimeDetector (a SEPARATE, older detector — NOT               │
 │        MarketRegimeEngine). Returns {success, data:{market_regime, ...}}    │
 │        ❌ Not part of the predictions response. Frontend would have to do  │
 │           a separate fetch and join client-side (which it currently doesn't │
 │           — exactly why the owner sees counter-trend picks during BEAR).   │
 └─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  [6] Frontend (Next.js — Alpha task A4 will consume the new fields)        │
 │      Currently: calls (a) and/or (b), reads activePredictions, renders    │
 │      cards. Because response lacks market_regime + no_trade_reason, and    │
 │      because (b) ALWAYS returns 5 picks via cascading fallback, the UI     │
 │      shows BUY recommendations regardless of market regime.                 │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Where Counter-Trend Opportunities Enter (file:line evidence)

| # | Source | File:Line | Mechanism | Severity |
|---|--------|-----------|-----------|----------|
| **D1** | RADAR FALLBACK | `vps-service/jobs/daily_predictor.py:3777-3832` | When `_regime_name == 'DEFENSIVE'` AND `len(picks) == 0`, fabricates BUY signals from `detect_pre_surge` / `detect_quiet_accumulation` results, with `source='radar_fallback'` and `position_size_mult=0.5`. The original V38/V40.2 engine did NOT emit BUY for these tickers — the fallback re-injects them as BUY. | **HIGH** — direct counter-trend injection at predictor level |
| **D2** | NO_TRADE filter | `vps-service/jobs/daily_predictor.py:3761` | `buy_signals = [s for s in all_day_signals if s.get('signal') in ('BUY','STRONG_BUY','INSTITUTIONAL_BUY')]` — silently drops NO_TRADE/HOLD/SELL signals. NO_TRADE never reaches `predictions` / `stored_analyses`, so the API has nothing to surface as NO_TRADE. | **HIGH** — hides the real decision |
| **D3** | CASCADING-FALLBACK-031 | `vps-service/api/misc_routes.py:2442-2543` (called at line 3362) | `_cascading_fallback_select(predictions, target=5)` ALWAYS returns up to 5 picks — Tier 4 (`last_resort`) has `min_score=0, min_rr=0`. Comment: "ضمان إن الشاشة متفضيش أبداً". The API serves these as `activePredictions` even when no real BUY signal qualifies. | **HIGH** — direct fabrication at API level |
| **D4** | Missing API fields | `vps-service/api/misc_routes.py:1983-2027` and `:3658-3695` | Response has NO `market_regime` field and NO `no_trade_reason` field. The frontend has no way to know the market is DEFENSIVE → cannot suppress UI rendering of BUY cards. | **HIGH** — contract gap |

### Secondary observations (NOT defects per se, but relevant)

- **`/api/daily/rebuild-predictions` (misc_routes.py:2019)** sets `market_status` based ONLY on `not active_predictions` — does NOT consult `MarketRegimeEngine.get_current_regime()`. So even when regime is DEFENSIVE, if cascading-fallback stuffed 5 picks, market_status = "نشط".
- **`core/risk_gate.py`** is functional but unused by the live V40.2 path — only `orchestrator_v3.py` + `executor_v3.py` (a separate v3 pipeline) reference it. Removing/keeping it doesn't affect the live path.
- **`core/orchestrator_v3.py` `final_decision()`** correctly emits `NO_TRADE` (lines 235-255) when data invalid, risk_blocked, confidence<60, or score in neutral zone. But this is the v3 path, NOT the V40.2 production path — V40.2 has its own gates in daily_predictor.py.

---

## 3. Verdict

### Is NO_TRADE reaching the API?
**NO.** Two layers strip it:
1. **daily_predictor.py:3761** filters signals to BUY-only before they ever hit the DB.
2. **API endpoints** read from `stored_analyses` + `predictions` tables — which contain only BUY-class signals. NO_TRADE rows are physically absent.

### Is the API fabricating opportunities?
**YES, at two layers:**
1. **Upstream fabrication** at `daily_predictor.py:3777-3832` (RADAR FALLBACK) — injects BUY signals during DEFENSIVE regime when the real engine produced 0 picks.
2. **API-level fabrication** at `misc_routes.py:3362` (CASCADING-FALLBACK-031) — always returns up to 5 picks via Tier 4 `last_resort`, even when no real BUY qualifies.

### Is the API exposing `market_regime` + `no_trade_reason`?
**NO.** Neither field exists in any predictions-serving response shape. The closest proxy is `cascade.dominant_tier` in `/api/unified/predictions`, but it reflects the fallback tier (strict/moderate/survival/last_resort), NOT the actual DEFENSIVE/NORMAL/AGGRESSIVE regime.

### Owner's symptom explanation
"Counter-trend recommendations / opportunities are appearing during a BEAR / DEFENSIVE market" — this is exactly what D1 + D3 produce:
- D1 injects BUY signals at predictor level when DEFENSIVE produces 0 picks.
- D3 stuffs 5 picks at API level when nothing qualifies.

The frontend then renders these as if they were legitimate recommendations.

---

## 4. Minimal Fix Plan (no rule/weight/threshold changes)

Per task constraints:
- DO NOT change trading rules to hide opportunities ✅ (we remove fabrication, not real signals)
- DO NOT change thresholds or weights ✅ (REGIME_CONFIG untouched)
- DO NOT let frontend fabricate ✅ (backend will supply the full decision set including NO_TRADE)
- DO NOT push to remote ✅ (local commit only)

### Fix A — Remove RADAR FALLBACK (daily_predictor.py:3777-3832)
Replace the 56-line fabrication block with a clean `no_trade_reason` log line. The regime-aware `min_score` filter at lines 3769-3775 (which DOES lower picks based on regime) stays unchanged — that is the legitimate regime-aware suppression.

### Fix B — Remove CASCADING-FALLBACK-031 last_resort tier (misc_routes.py)
- Keep Tier 1 strict / Tier 2 moderate / Tier 3 survival (these all have min_score and min_rr floors).
- Remove Tier 4 last_resort (which has min_score=0, min_rr=0 — pure fabrication).
- If `_cascading_fallback_select` returns < target → return what it has (possibly empty) + `no_trade_reason` field explaining why.

### Fix C — Add `market_regime` + `no_trade_reason` to API response shape
Add a helper `_get_market_regime_info()` in misc_routes.py that reads `stocks.db.system_settings` key `current_regime_<MARKET>` (no DB writes, read-only) and returns:
```python
{
  "market_regime": "DEFENSIVE",          # the persisted value
  "market_regime_source": "MarketRegimeEngine",
  "market_regime_reasons": [...],         # human-readable bullets
  "no_trade_reason": "BEAR/DEFENSIVE regime — no qualifying BUY signals"  # only when active_predictions is empty
}
```
Add this dict to the response of:
- `/api/daily/rebuild-predictions` (misc_routes.py:1983)
- `/api/unified/predictions` (misc_routes.py:3658)

### Fix D — Add `decision` field per pick
Each pick dict in `activePredictions[]` already has a `signal` field ('BUY'/'STRONG_BUY'/etc.). For consistency with the v3 `final_decision()` vocabulary, add a derived `decision` field that is `'NO_TRADE'` if `signal` is empty/HOLD, else `signal`. This lets the frontend know what the real decision was — not what the UI invented.

---

## 5. Tests

See `scripts/test_b4_market_regime.py` — three scenarios:
1. BEAR/DEFENSIVE regime → assert predictor does NOT fabricate BUY, API returns empty list + `market_regime='DEFENSIVE'` + `no_trade_reason`.
2. No valid opportunities (NORMAL regime but no picks qualify) → assert API returns empty list + `no_trade_reason`, NOT a fabricated 5-pick list.
3. Real exceptional BUY (high score, high RR, during DEFENSIVE regime) → assert it passes through unchanged (regime doesn't auto-suppress legitimate signals).

Test runs against in-memory fixtures + monkey-patched regime engine — no production DB writes.
