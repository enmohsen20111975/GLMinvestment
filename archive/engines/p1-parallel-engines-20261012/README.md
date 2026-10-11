# P1-PARALLEL-ENGINES-FIX — Archived Orphan Engines

Per Rule 16 (VERIFY-BEFORE-DELETE) + Rule 20 (Python=Brain) + Rule 28 (NO-DUPLICATION)
+ Rule 67 (CALCULATION-CANONICAL).

## Archived (orphan — no callers in src/)

### `prediction-validator.ts.orphan`
- Original path: `src/lib/prediction-validator.ts` (293 LOC).
- Self-documenting comment line 15: `mirrors vps-service/analyzers/prediction_validator.py`.
- Grep for callers in `src/`:
  - `from '@/lib/prediction-validator'` → 0 matches.
  - `validatePrediction | filterValidPredictions | deduplicatePredictions` → 0 callers outside the file itself.
- Verdict: orphan (Node-side duplicate of the canonical Python `prediction_validator.py`).
- Action: moved to archive. No replacement needed — the canonical Python
  module (`vps-service/analyzers/prediction_validator.py`) is already
  enforced by V40.2 + record_prediction pipeline (Rule 35).

## Archived (orphaned-by-proxy — had callers, now replaced by Python proxies)

### `gate-analyzer.ts.orphan`
- Original path: `src/lib/gate-analyzer.ts` (1066 LOC).
- Original callers: `src/modules/stock-analysis/components/GateAnalysisView.tsx`.
- Action: `GateAnalysisView.tsx` rewritten to `fetch('/api/stocks/<ticker>/gate-analysis?persona=...')`
  (pure proxy → Python canonical endpoint `misc_routes.py::/api/stocks/<ticker>/gate-analysis`).
- After the conversion, the TS engine is no longer imported anywhere.

### `dynamic-analysis-engine.ts.orphan`
- Original path: `src/lib/dynamic-analysis-engine.ts` (969 LOC).
- Original callers: `src/lib/gate-analyzer.ts:27` (only).
- Since `gate-analyzer.ts` is archived (above), this engine becomes orphan.
- The Python canonical home for the dynamic-parameter matrix + BB-squeeze
  detection + adaptive weights is `vps-service/analyzers/` (already used by
  the V40.2 generator). The TS copy was a parallel engine violating
  Rule 67 (CALCULATION-CANONICAL).

## Verification

```
$ rg "from '@/lib/prediction-validator'" src/       # 0 matches ✅
$ rg "from '@/lib/gate-analyzer'" src/               # 0 matches ✅
$ rg "from '@/lib/dynamic-analysis-engine'" src/     # 0 matches ✅
```

No code deletion — files moved to `archive/` per Rule 16.
