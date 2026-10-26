#!/usr/bin/env python3
"""
Tests for orchestrator_v3 — سياسة المالك المحددة.
Run: python3 scripts/test_orchestrator_v3.py
"""
from __future__ import annotations
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

PASS = 0; FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name}  {detail}')

print("="*60)
print("Orchestrator V3 Tests — Owner Policy")
print("="*60)

from core.orchestrator_v3 import (
    create_v3_plan, normalize_weights, classify_regime,
    final_decision, resolve_conflict, RAW_WEIGHTS, ENGINE_FAMILIES
)

# === 1. Weight normalization: sum = 1.0 ===
print("\n=== 1. Weight normalization ===")
for state, raw in RAW_WEIGHTS.items():
    if not raw: continue
    available = list(raw.keys())
    normed = normalize_weights(raw, available)
    total = sum(normed.values())
    check(f'{state} weights sum=1.0', abs(total - 1.0) < 0.01, f'sum={total:.4f}')

# === 2. FUND/EVENT excluded when not available ===
print("\n=== 2. FUND/EVENT exclusion ===")
normed = normalize_weights(RAW_WEIGHTS['S1'], ['TREND', 'MOM', 'MR', 'BRK', 'FLOW'])
check('FUND excluded when not available', 'FUND' not in normed)
check('EVENT excluded when not available', 'EVENT' not in normed)
check('Remaining sum=1.0', abs(sum(normed.values()) - 1.0) < 0.01)

# === 3. NO_TRADE on insufficient data ===
print("\n=== 3. NO_TRADE on insufficient data ===")
plan = create_v3_plan('COMI', prices=[], volumes=[])
check('Empty data → NO_TRADE', plan.decision_policy == 'no_trade')

plan2 = create_v3_plan('COMI', prices=[100]*30, volumes=[])
check('<50 sessions → NO_TRADE', plan2.decision_policy == 'no_trade')

# === 4. State classification ===
print("\n=== 4. State classification ===")
# Bull stable
prices_bull = [100 + i*0.5 for i in range(60)]
market, state = classify_regime(prices_bull)
check('Bull stable market', market in ('BULL_STABLE', 'BULL_WEAK'), f'got {market}')

# Bear
prices_bear = [120 - i*0.5 for i in range(60)]
market2, state2 = classify_regime(prices_bear)
check('Bear market', 'BEAR' in market2, f'got {market2}')

# Sideways
prices_side = [100 for i in range(60)]
market3, state3 = classify_regime(prices_side)
check('Sideways market', market3 in ('SIDEWAYS', 'CONFLICTING'), f'got {market3}')

# === 5. Plan creation with valid data ===
print("\n=== 5. Plan creation ===")
plan3 = create_v3_plan('COMI', prices_bull, [100000]*60, fund_available=True, event_available=True)
check('Plan has state_code', plan3.state_code != '')
check('Plan has weights', len(plan3.normalized_weights) > 0)
check('Plan has selected engines', len(plan3.selected_engines) > 0)
check('Plan has execution order', len(plan3.execution_order) > 0)

# === 6. FUND excluded from weights when not available ===
print("\n=== 6. FUND exclusion in plan ===")
plan_no_fund = create_v3_plan('COMI', prices_bull, [100000]*60, fund_available=False)
check('FUND not in weights', 'FUND' not in plan_no_fund.normalized_weights)
check('FUND engines not selected', not any(e in ENGINE_FAMILIES['FUND'] for e in plan_no_fund.selected_engines))

# === 7. Final decision table ===
print("\n=== 7. Final decision table ===")
d, _ = final_decision(70, 80, True, False)
check('Score≥60 + Conf≥70 → BUY_CANDIDATE', d == 'BUY_CANDIDATE', f'got {d}')

d, _ = final_decision(40, 70, True, False)
check('Score 30-60 + Conf≥60 → NEEDS_CONFIRMATION', d == 'NEEDS_CONFIRMATION', f'got {d}')

d, _ = final_decision(10, 80, True, False)
check('Score -30..30 → NO_TRADE', d == 'NO_TRADE', f'got {d}')

d, _ = final_decision(70, 50, True, False)
check('Conf<60 → NO_TRADE', d == 'NO_TRADE', f'got {d}')

d, _ = final_decision(70, 80, False, False)
check('Invalid data → NO_TRADE', d == 'NO_TRADE', f'got {d}')

d, _ = final_decision(70, 80, True, True)
check('Risk blocked → NO_TRADE', d == 'NO_TRADE', f'got {d}')

# === 8. Conflict resolution ===
print("\n=== 8. Conflict resolution ===")
ok, _ = resolve_conflict({'TREND': 50, 'MOM': -50, 'BRK': 0, 'FLOW': 50})
check('TREND+ vs MOM- → conflict', not ok)

ok2, _ = resolve_conflict({'TREND': 50, 'MOM': 40, 'BRK': 30, 'FLOW': 50})
check('No conflict when aligned', ok2)

ok3, _ = resolve_conflict({'TREND': 10, 'MOM': 10, 'BRK': 50, 'FLOW': 5})
check('BRK+ vs FLOW- → conflict', not ok3)

# === 9. Engine family mapping verified ===
print("\n=== 9. Engine family mapping ===")
for family, engines in ENGINE_FAMILIES.items():
    check(f'{family} has engines', len(engines) > 0)

# === 10. Determinism ===
print("\n=== 10. Determinism ===")
p1 = create_v3_plan('COMI', prices_bull, [100000]*60)
p2 = create_v3_plan('COMI', prices_bull, [100000]*60)
check('Same state_code', p1.state_code == p2.state_code)
check('Same weights', p1.normalized_weights == p2.normalized_weights)

print(f"\n{'='*60}")
print(f"SUMMARY: {PASS} PASS, {FAIL} FAIL")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
