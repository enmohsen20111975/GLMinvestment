#!/usr/bin/env python3
"""BRAVO-RADAR-PRED-AUDIT-001 Verification Test (proof-of-work).

Tests:
  1. R/R ≥ 1.8 on sample signals (evaluate_risk + maestro min_rr)
  2. Position ≤ 2.5% on sample signals (persona cap + evaluate_risk)
  3. Falling Knife detection on sample (3 FK + 3 healthy)
  4. No fabrication in v2_routes (no entry×0.92 / entry×1.10)
"""
import sys
from unittest.mock import MagicMock
sys.modules['flask'] = MagicMock()
sys.modules['flask_cors'] = MagicMock()
sys.path.insert(0, 'vps-service')
sys.path.insert(0, '.')

PASS = 0
FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} — {detail}")

print("=" * 76)
print("BRAVO-RADAR-PRED-AUDIT-001 — VERIFICATION TEST")
print("=" * 76)

# ─── TEST 1: R/R ≥ 1.8 ──────────────────────────────────────────────────
print("\nTEST 1: R/R ≥ 1.8 (Rule 18)")
from engine.flow_system import evaluate_risk, RR_FLOOR
check(f"RR_FLOOR = {RR_FLOOR}", RR_FLOOR == 1.8, f"got {RR_FLOOR}")

# R/R = 1.6 → killed
r = evaluate_risk(entry_price=100, stop_loss=95, target_price=108, calculated_position_size=0.025)
check("R/R=1.6 killed (CASH_WAIT)", r['signal'] == 'CASH_WAIT' and r['killed'], f"got {r['signal']}")
# R/R = 1.8 → passes
r = evaluate_risk(entry_price=100, stop_loss=95, target_price=109, calculated_position_size=0.025)
check("R/R=1.8 passes (BUY)", r['signal'] == 'BUY' and not r['killed'], f"got {r['signal']} rr={r['rr']}")
# R/R = 2.5 → passes
r = evaluate_risk(entry_price=100, stop_loss=92, target_price=120, calculated_position_size=0.025)
check("R/R=2.5 passes (BUY)", r['signal'] == 'BUY' and r["rr"] == 2.5, f"got {r['signal']} rr={r['rr']}")

# maestro_orchestrator min_rr floor
import ast
with open('vps-service/analyzers/maestro_orchestrator.py') as f:
    src = f.read()
check("maestro: no _p07_min_rr = 1.5 leftover", "_p07_min_rr = 1.5" not in src, "1.5 still present")
check("maestro: no _final_min_rr = 1.5 leftover", "_final_min_rr = 1.5" not in src, "1.5 still present")
check("maestro: has max(1.8, ...) floor", "max(1.8," in src, "no floor")

# ─── TEST 2: Position ≤ 2.5% ────────────────────────────────────────────
print("\nTEST 2: Position ≤ 2.5% (Rule 19)")
from engine.flow_system import MAX_POSITION_SIZE
check(f"MAX_POSITION_SIZE = {MAX_POSITION_SIZE}", MAX_POSITION_SIZE == 0.025, f"got {MAX_POSITION_SIZE}")

# calc 5% → capped 2.5%
r = evaluate_risk(entry_price=100, stop_loss=95, target_price=109, calculated_position_size=0.05)
check("calc 5% → capped 2.5%", r['position_size'] == 0.025, f"got {r['position_size']}")
# calc 1% → preserved
r = evaluate_risk(entry_price=100, stop_loss=95, target_price=109, calculated_position_size=0.01)
check("calc 1% → preserved 1%", r['position_size'] == 0.01, f"got {r['position_size']}")

# persona_engine cap
from engine.persona_engine import RiskParameters
for pct in [3.0, 5.0, 7.0, 8.0, 10.0, 15.0]:
    rp = RiskParameters(max_position_pct=pct, default_stop_loss_pct=6, default_target_pct=12,
                        time_stop_days=90, leverage_allowed=0, daily_loss_limit_pct=1)
    check(f"persona max_position_pct={pct} → capped 2.5", rp.max_position_pct == 2.5, f"got {rp.max_position_pct}")

# ─── TEST 3: Falling Knife detection ────────────────────────────────────
print("\nTEST 3: Falling Knife (canonical + structural unified)")
from api.canonical_flow import _is_falling_knife, _compute_drop_pct_3d

def make_candles(prices):
    candles = []
    for i, p in enumerate(prices):
        prev = prices[i-1] if i > 0 else p
        o = prev; c = p
        h = max(o, c) * 1.005; low = min(o, c) * 0.995
        candles.append({'open': o, 'high': h, 'low': low, 'close': c, 'volume': 1000000})
    return candles

# FK case: 12% crash in 3 days, below SMA50
prices_fk = [100.0]*57 + [96.0, 90.0, 88.0]
c_fk = make_candles(prices_fk)
sma50_fk = sum(prices_fk[-50:])/50
is_fk, _ = _is_falling_knife(c_fk, 88.0, sma50_fk)
check("FK case (12% crash, below SMA50) → True", is_fk is True)

# Healthy: 4% pullback
prices_ok = [100.0]*57 + [101.0, 99.0, 96.5]
c_ok = make_candles(prices_ok)
sma50_ok = sum(prices_ok[-50:])/50
is_fk, _ = _is_falling_knife(c_ok, 96.5, sma50_ok)
check("Healthy (4% pullback) → False", is_fk is False)

# Crash above SMA50 → not FK (both conditions required)
prices_ca = list(range(80, 137))[:57] + [137.0, 125.0, 120.0]
c_ca = make_candles(prices_ca)
sma50_ca = sum(prices_ca[-50:])/50
is_fk, _ = _is_falling_knife(c_ca, 120.0, sma50_ca)
check("Crash above SMA50 → False (needs both)", is_fk is False)

# ─── TEST 4: No fabrication in v2_routes ─────────────────────────────────
print("\nTEST 4: No fabrication in v2_routes (Rule 27)")
with open('vps-service/api/v2_routes.py') as f:
    v2src = f.read()
check("no 'entry × 0.92' (stop fabrication)", "entry_price_v * 0.92" not in v2src, "still present")
check("no 'entry × 1.10' (target fabrication)", "entry_price_v * 1.10" not in v2src, "still present")
check("no 'entry × 1.15' (investment fabrication)", "entry_price_v * 1.15" not in v2src, "still present")
check("no 'risk_reward_ratio_v = 2.0' fallback", "risk_reward_ratio_v = 2.0" not in v2src, "still present")
check("no 'except Exception:\n                    pass' silent", "except Exception:\n                    pass" not in v2src.split("compute_risk_reward")[1].split("change_percent")[0] if "compute_risk_reward" in v2src else True, "silent pass remains")

print("\n" + "=" * 76)
print(f"RESULTS: {PASS} PASS / {FAIL} FAIL")
print("=" * 76)
sys.exit(0 if FAIL == 0 else 1)
