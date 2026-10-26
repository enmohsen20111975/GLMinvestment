"""
risk_gate.py — Unified risk gate for trading decisions.
=========================================================
Applies 6 risk rules before emitting final_signal.
This is the ONLY place where risk rules are applied — prevents
bypass by individual engines.

Rules:
1. Liquidity filter blocked → NO_TRADE
2. R:R < 1.0 → downgrade one level
3. Position size > 25% capital → clamp to 25%
4. Conviction LOW → downgrade one level
5. Stale data → flag as "stale recommendation"
6. Critical engine failure → NO_TRADE (no fake)
"""
from __future__ import annotations
from typing import Dict, Tuple

# Signal hierarchy for downgrade
SIGNAL_ORDER = ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL', 'NO_TRADE']

def apply_risk_gate(
    signal: str,
    master_score: float,
    risk_profile: Dict,
    conviction_level: str = '',
    data_quality: str = 'fresh',
    liquidity_blocked: bool = False,
    critical_engine_failed: bool = False,
    position_size_pct: float = 5.0,
    capital: float = 10000.0,
) -> Tuple[str, list, float]:
    """Apply risk gate rules. Returns (final_signal, warnings, final_position_size_pct).
    
    FIX: position_size_pct is now returned (was local-only before).
    """
    warnings = []
    final_position_size = position_size_pct
    
    # Rule 1: Liquidity blocked
    if liquidity_blocked:
        return 'NO_TRADE', ['Liquidity filter blocked → NO_TRADE'], 0.0
    
    # Rule 6: Critical engine failure
    if critical_engine_failed:
        return 'NO_TRADE', ['Critical engine failed → NO_TRADE (no fake)'], 0.0
    
    final_signal = signal
    if final_signal not in SIGNAL_ORDER:
        final_signal = 'NO_TRADE'
        warnings.append(f'Unknown signal "{signal}" → NO_TRADE')
        return final_signal, warnings, 0.0
    
    # Rule 2: R:R < 1.0 → downgrade
    rr = risk_profile.get('risk_reward_ratio', 0) if risk_profile else 0
    if rr and rr < 1.0:
        idx = SIGNAL_ORDER.index(final_signal) if final_signal in SIGNAL_ORDER else len(SIGNAL_ORDER) - 2
        new_idx = min(idx + 1, len(SIGNAL_ORDER) - 1)
        final_signal = SIGNAL_ORDER[new_idx]
        warnings.append(f'R:R={rr:.2f} < 1.0 → downgrade to {final_signal}')
    
    # Rule 3: Position size > 25% → clamp (FIX: now affects returned value)
    if final_position_size > 25.0:
        warnings.append(f'Position size {final_position_size}% > 25% → clamped to 25%')
        final_position_size = 25.0
    
    # Rule 4: Conviction LOW → downgrade
    if conviction_level and conviction_level.upper() == 'LOW':
        idx = SIGNAL_ORDER.index(final_signal) if final_signal in SIGNAL_ORDER else len(SIGNAL_ORDER) - 2
        new_idx = min(idx + 1, len(SIGNAL_ORDER) - 1)
        final_signal = SIGNAL_ORDER[new_idx]
        warnings.append(f'Conviction LOW → downgrade to {final_signal}')
    
    # Rule 5: Stale data → flag
    if data_quality in ('stale', 'very_stale'):
        warnings.append(f'Data quality={data_quality} → stale recommendation (flagged)')
    
    return final_signal, warnings, final_position_size


def validate_risk_profile(risk_profile: Dict) -> Tuple[bool, list]:
    """Validate risk profile consistency. Returns (valid, errors)."""
    errors = []
    if not risk_profile:
        errors.append('Missing risk profile')
        return False, errors
    
    entry = risk_profile.get('entry_price', 0)
    stop = risk_profile.get('stop_loss', 0)
    target = risk_profile.get('target_price', 0)
    
    if entry <= 0:
        errors.append(f'Invalid entry_price: {entry}')
    if stop <= 0:
        errors.append(f'Invalid stop_loss: {stop}')
    if target <= 0:
        errors.append(f'Invalid target_price: {target}')
    
    # For long: stop < entry < target
    if entry > 0 and stop > 0 and target > 0:
        if not (stop < entry < target):
            errors.append(f'Levels inconsistent: entry={entry}, stop={stop}, target={target}')
    
    rr = risk_profile.get('risk_reward_ratio', 0)
    if rr <= 0:
        errors.append(f'Invalid R:R: {rr}')
    
    return len(errors) == 0, errors
