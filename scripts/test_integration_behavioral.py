#!/usr/bin/env python3
"""
Integration tests for Orchestrator + Executor + Risk Gate + Decision Log.
Tests that the FULL path works: Plan → Execute → Risk Gate → Decision Log.
Run: python3 scripts/test_integration_behavioral.py
"""
from __future__ import annotations
import sys, os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

PASS = 0; FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name}  {detail}')

print("="*70)
print("Integration Behavioral Tests — Orchestrator + Executor + Risk Gate + Decision Log")
print("="*70)

# ============================================================================
# 1. Orchestrator creates correct plan per market state
# ============================================================================
print("\n=== 1. Orchestrator: plan creation ===")
from core.orchestrator import create_plan, validate_plan, EnginePlan

plan_normal = create_plan('COMI', 'EGX', 'fresh', 'NORMAL')
check('Plan has ticker', plan_normal.ticker == 'COMI')
check('Plan has market', plan_normal.market == 'EGX')
check('Plan has market_state', plan_normal.market_state == 'NORMAL')
check('Plan selected engines non-empty', len(plan_normal.selected_engines) > 0)
check('Plan has plan_id', len(plan_normal.plan_id) > 0)

# 2. Orchestrator rejects insufficient data → NO_TRADE
print("\n=== 2. Orchestrator: insufficient data → NO_TRADE ===")
plan_blocked = create_plan('COMI', 'EGX', 'insufficient')
check('NO_TRADE on insufficient data', plan_blocked.decision_policy == 'no_trade')
check('No engines selected when blocked', len(plan_blocked.selected_engines) == 0)

# 3. Orchestrator: DEFENSIVE state skips high-risk engines
print("\n=== 3. Orchestrator: DEFENSIVE skips breakout ===")
plan_def = create_plan('COMI', 'EGX', 'fresh', 'DEFENSIVE')
check('DEFENSIVE skips breakout', 'breakout' not in plan_def.selected_engines)
check('DEFENSIVE has liquidity_filter', 'liquidity_filter' in plan_def.selected_engines)

# 4. Orchestrator: plan validation
print("\n=== 4. Orchestrator: plan validation ===")
valid, errors = validate_plan(plan_normal)
check('Valid plan passes', valid, str(errors))

bad_plan = EnginePlan(ticker='', market='', config_version='bad')
valid2, errors2 = validate_plan(bad_plan)
check('Invalid plan rejected', not valid2, str(errors2))

# 5. Orchestrator: determinism (same inputs → same plan)
print("\n=== 5. Orchestrator: determinism ===")
plan1 = create_plan('COMI', 'EGX', 'fresh', 'NORMAL')
plan2 = create_plan('COMI', 'EGX', 'fresh', 'NORMAL')
check('Same selected engines', plan1.selected_engines == plan2.selected_engines)
check('Same weights', plan1.engine_weights == plan2.engine_weights)

# ============================================================================
# 6. Executor executes plan
# ============================================================================
print("\n=== 6. Executor: executes plan ===")
from core.executor import execute_plan

result = execute_plan(plan_normal, prices=[], volumes=[], ticker='COMI', market='EGX')
check('Executor returns result', result is not None)
check('Result has execution_id', len(result.execution_id) > 0)
check('Result has plan_id', result.plan_id == plan_normal.plan_id)

# 7. Executor: NO_TRADE plan → no engines run
print("\n=== 7. Executor: NO_TRADE plan ===")
result_blocked = execute_plan(plan_blocked, prices=[], volumes=[], ticker='COMI')
check('NO_TRADE result signal', result_blocked.final_signal == 'NO_TRADE')
check('NO_TRADE not complete', result_blocked.complete == False)

# 8. Executor: critical engine failure → NO_TRADE
print("\n=== 8. Executor: critical failure → NO_TRADE ===")
plan_fail = create_plan('COMI', 'EGX', 'fresh', 'NORMAL')
result_fail = execute_plan(plan_fail, prices=[], volumes=[], ticker='COMI')
# With empty prices, master_analyzer should fail → critical
check('Empty data → not complete', result_fail.complete == False or len(result_fail.failed_engines) > 0)

# ============================================================================
# 9. Risk Gate: position_size returned (FIX verified)
# ============================================================================
print("\n=== 9. Risk Gate: position_size returned ===")
from core.risk_gate import apply_risk_gate

sig, warns, pos_size = apply_risk_gate('BUY', 70, {}, position_size_pct=40.0)
check('Position clamped from 40 to 25', pos_size == 25.0, f'got {pos_size}')
check('Warning about clamping', any('clamped' in w for w in warns), warns)

sig2, warns2, pos2 = apply_risk_gate('BUY', 70, {}, position_size_pct=5.0)
check('Normal position unchanged', pos2 == 5.0, f'got {pos2}')

# 10. Risk Gate: liquidity blocked → NO_TRADE
print("\n=== 10. Risk Gate: liquidity blocked ===")
sig3, warns3, pos3 = apply_risk_gate('STRONG_BUY', 90, {}, liquidity_blocked=True)
check('Liquidity blocked → NO_TRADE', sig3 == 'NO_TRADE')
check('NO_TRADE → 0 position', pos3 == 0.0)

# 11. Risk Gate: critical engine failure → NO_TRADE
print("\n=== 11. Risk Gate: engine failure → NO_TRADE ===")
sig4, warns4, pos4 = apply_risk_gate('BUY', 70, {}, critical_engine_failed=True)
check('Engine failure → NO_TRADE', sig4 == 'NO_TRADE')

# 12. Risk Gate: R:R < 1.0 → downgrade
print("\n=== 12. Risk Gate: R:R downgrade ===")
rp = {'risk_reward_ratio': 0.5}
sig5, warns5, pos5 = apply_risk_gate('STRONG_BUY', 80, rp, position_size_pct=5.0)
check('R:R<1 → downgrade', sig5 != 'STRONG_BUY', f'got {sig5}')

# ============================================================================
# 13. Decision Log: logs decision from full path
# ============================================================================
print("\n=== 13. Decision Log: full path logging ===")
from core.decision_log import log_decision, get_decision

eid = log_decision(
    ticker='COMI',
    plan_id=plan_normal.plan_id,
    market_state='NORMAL',
    selected_engines=plan_normal.selected_engines,
    skipped_engines=plan_normal.skipped_engines,
    engine_results={'technical': {'signal': 'BUY'}},
    final_signal=sig,
    master_score=70.0,
    risk_profile={'entry_price': 124.5, 'stop_loss': 119.0, 'target_price': 135.0},
    code_version='test',
    config_version='v1.0',
    warnings=warns,
    errors=[],
)
check('Decision logged', bool(eid))

retrieved = get_decision(eid)
check('Decision retrieved', retrieved is not None)
if retrieved:
    check('Retrieved has plan_id', retrieved.get('plan_id') == plan_normal.plan_id)
    check('Retrieved has final_signal', retrieved.get('final_signal') == sig)

# 14. Market isolation: different markets don't collide
print("\n=== 14. Market isolation ===")
plan_egx = create_plan('COMI', 'EGX', 'fresh', 'NORMAL')
plan_tad = create_plan('COMI', 'TADAWUL', 'fresh', 'NORMAL')
check('EGX plan market=EGX', plan_egx.market == 'EGX')
check('TADAWUL plan market=TADAWUL', plan_tad.market == 'TADAWUL')
check('Different markets → different plan_ids', plan_egx.plan_id != plan_tad.plan_id)

# ============================================================================
print(f"\n{'='*70}")
print(f"SUMMARY: {PASS} PASS, {FAIL} FAIL")
print(f"{'='*70}")
sys.exit(0 if FAIL == 0 else 1)
