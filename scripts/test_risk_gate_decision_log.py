#!/usr/bin/env python3
"""
Tests for risk_gate + decision_log modules.
Run: python3 scripts/test_risk_gate_decision_log.py
"""
from __future__ import annotations
import sys, os, tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

PASS = 0; FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name}  {detail}')

print("=" * 60)
print("Risk Gate + Decision Log Tests")
print("=" * 60)

# ============================================================================
# Risk Gate Tests
# ============================================================================
print("\n=== Risk Gate Tests ===")
from core.risk_gate import apply_risk_gate, validate_risk_profile

# Rule 1: Liquidity blocked → NO_TRADE
sig, warns, pos = apply_risk_gate('BUY', 70, {}, liquidity_blocked=True)
check('Liquidity blocked → NO_TRADE', sig == 'NO_TRADE', f'got {sig}')

# Rule 6: Critical engine failure → NO_TRADE
sig, warns, pos = apply_risk_gate('STRONG_BUY', 85, {}, critical_engine_failed=True)
check('Engine failure → NO_TRADE', sig == 'NO_TRADE', f'got {sig}')

# Rule 2: R:R < 1.0 → downgrade
rp = {'risk_reward_ratio': 0.5, 'entry_price': 100, 'stop_loss': 95, 'target_price': 102}
sig, warns, pos = apply_risk_gate('STRONG_BUY', 80, rp)
check('R:R<1.0 → downgrade STRONG_BUY→BUY', sig == 'BUY', f'got {sig}')

# Rule 3: Position > 25% → clamp (warning only)
sig, warns, pos = apply_risk_gate('BUY', 70, {}, position_size_pct=40.0)
check('Position >25% → warning', any('clamped' in w for w in warns), warns)

# Rule 4: Conviction LOW → downgrade
sig, warns, pos = apply_risk_gate('BUY', 70, {}, conviction_level='LOW')
check('Conviction LOW → downgrade', sig != 'BUY' or 'downgrade' in ' '.join(warns), f'got {sig}')

# Rule 5: Stale data → flagged
sig, warns, pos = apply_risk_gate('HOLD', 50, {}, data_quality='very_stale')
check('Stale data → flagged', any('stale' in w.lower() for w in warns), warns)

# Normal case: no rules triggered
rp = {'risk_reward_ratio': 2.0, 'entry_price': 100, 'stop_loss': 95, 'target_price': 110}
sig, warns, pos = apply_risk_gate('BUY', 70, rp, data_quality='fresh')
check('Normal case → signal unchanged', sig == 'BUY', f'got {sig}')

# validate_risk_profile
valid, errors = validate_risk_profile({'entry_price': 100, 'stop_loss': 95, 'target_price': 110, 'risk_reward_ratio': 2.0})
check('Valid risk profile', valid, errors)

valid, errors = validate_risk_profile({'entry_price': 100, 'stop_loss': 105, 'target_price': 110, 'risk_reward_ratio': -1})
check('Invalid risk profile (stop>entry)', not valid, errors)

valid, errors = validate_risk_profile({})
check('Missing risk profile', not valid, errors)

# ============================================================================
# Decision Log Tests
# ============================================================================
print("\n=== Decision Log Tests ===")
from core.decision_log import log_decision, get_decision, count_decisions

# Log a decision
eid = log_decision(
    ticker='COMI',
    plan_id='test-plan-001',
    market_state='NORMAL',
    selected_engines=['technical', 'fundamental', 'liquidity', 'risk'],
    skipped_engines=[{'name': 'crypto', 'reason': 'not crypto market'}],
    engine_results={'technical': {'score': 70}, 'fundamental': {'score': 65}},
    final_signal='BUY',
    master_score=68.5,
    risk_profile={'entry_price': 124.5, 'stop_loss': 119.0, 'target_price': 135.0, 'risk_reward_ratio': 2.1, 'position_size': 5.0},
    code_version='ba0ecb2',
    config_version='v1.0',
    warnings=['high_52w invalid (stale)'],
    errors=[],
)
check('Decision logged with execution_id', bool(eid), f'got {eid}')

# Retrieve it
retrieved = get_decision(eid)
check('Decision retrieved', retrieved is not None, 'not found')
if retrieved:
    check('Retrieved ticker matches', retrieved['ticker'] == 'COMI', f"got {retrieved['ticker']}")
    check('Retrieved signal matches', retrieved['final_signal'] == 'BUY', f"got {retrieved['final_signal']}")
    check('Retrieved score matches', abs(retrieved['master_score'] - 68.5) < 0.1, f"got {retrieved['master_score']}")

# Count
n = count_decisions()
check(f'Decision count > 0 ({n})', n > 0, f'count={n}')

# ============================================================================
print(f"\n{'='*60}")
print(f"SUMMARY: {PASS} PASS, {FAIL} FAIL")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
