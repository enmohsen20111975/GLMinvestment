#!/usr/bin/env python3
"""BRAVO-WIRE-EVALUATE-RISK-001 — Verification test.

Tests that evaluate_risk() correctly gates predictions before INSERT.
Simulates the daily_predictor gate logic.
"""
import sys
from unittest.mock import MagicMock
sys.modules['flask'] = MagicMock()
sys.modules['flask_cors'] = MagicMock()
sys.path.insert(0, 'vps-service')

from engine.flow_system import evaluate_risk

PASS = 0; FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {name}")
    else: FAIL += 1; print(f"  ✗ {name} — {detail}")

print("=" * 72)
print("BRAVO-WIRE-EVALUATE-RISK-001 — VERIFICATION")
print("=" * 72)

# Simulate the daily_predictor INSERT gate logic
def simulate_insert_gate(signal, entry, stop, target, confidence=70):
    """Returns ('INSERTED', position_size) or ('SKIPPED', reason)."""
    if signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
        risk_eval = evaluate_risk(
            entry_price=entry, stop_loss=stop, target_price=target,
            calculated_position_size=0.025, confidence=confidence
        )
        if risk_eval['killed']:
            return ('SKIPPED', risk_eval['kill_reason'])
        return ('INSERTED', risk_eval['position_size'])
    return ('INSERTED', 0.025)

print("\nTEST 1: R/R=1.0 → KILLED + skipped")
r = simulate_insert_gate('BUY', 100, 95, 105)  # rr=1.0
check("R/R=1.0 skipped", r[0] == 'SKIPPED', f"got {r[0]}")
check("reason mentions Rule 18", "Rule 18" in r[1], f"reason: {r[1]}")

print("\nTEST 2: R/R=1.5 → KILLED + skipped")
r = simulate_insert_gate('BUY', 100, 96, 106)  # rr=1.5
check("R/R=1.5 skipped", r[0] == 'SKIPPED', f"got {r[0]}")

print("\nTEST 3: R/R=1.8 → PASS + inserted")
r = simulate_insert_gate('BUY', 100, 95, 109)  # rr=1.8
check("R/R=1.8 inserted", r[0] == 'INSERTED', f"got {r[0]}")
check("position_size = 0.025", r[1] == 0.025, f"got {r[1]}")

print("\nTEST 4: R/R=2.5 → PASS + inserted + position capped 2.5%")
r = simulate_insert_gate('STRONG_BUY', 100, 92, 120, confidence=85)  # rr=2.5
check("R/R=2.5 inserted", r[0] == 'INSERTED', f"got {r[0]}")
check("position capped to 0.025", r[1] == 0.025, f"got {r[1]}")

print("\nTEST 5: invalid geometry (stop>=entry) → KILLED + skipped")
r = simulate_insert_gate('BUY', 100, 100, 110)  # stop=entry
check("invalid geometry skipped", r[0] == 'SKIPPED', f"got {r[0]}")
check("reason mentions INVALID_GEOMETRY", "INVALID_GEOMETRY" in r[1], f"reason: {r[1]}")

print("\nTEST 6: non-BUY signal (HOLD) → not gated (inserted)")
r = simulate_insert_gate('HOLD', 100, 95, 105)
check("HOLD not gated", r[0] == 'INSERTED', f"got {r[0]}")

print(f"\n{'='*72}")
print(f"RESULTS: {PASS} PASS / {FAIL} FAIL")
print(f"{'='*72}")
sys.exit(0 if FAIL == 0 else 1)
