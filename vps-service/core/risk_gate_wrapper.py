"""
risk_gate_wrapper.py — Fail-closed wrapper around risk_gate.apply_risk_gate.

PURPOSE:
  The Reality-Based Architecture Audit (AUDIT-1) found that risk_gate is called
  from exactly ONE place in production (scanner_routes.py admin endpoint). Every
  other decision path bypasses it. This wrapper provides a single, safe entry
  point that:

  1. Builds the risk_gate arguments from the prediction fields.
  2. Calls apply_risk_gate in a try/except (NO swallowed exceptions).
  3. Returns a clear (allowed, reason) tuple.
  4. FAIL-CLOSED: if risk_gate throws OR returns NO_TRADE, the prediction is
     blocked. The caller MUST skip the INSERT and log_decision(risk_gate_blocked).

DESIGN (per Issue #4 directive):
  - "لا تبتلع exceptions في مسار الحماية/القرار" → exceptions are logged with
    exc_info=True and cause fail-closed (never silent).
  - "اجعل فشل Risk Gate يمنع إصدار توصية قابلة للتنفيذ (fail-closed)" → any
    failure returns allowed=False.
  - "لا تغيّر عتبات التداول أو تضف BUY/SELL semantics" → this wrapper does NOT
    change risk_gate rules; it only enforces that risk_gate runs.

USAGE:
  from core.risk_gate_wrapper import safe_apply_risk_gate
  allowed, reason, final_signal = safe_apply_risk_gate(
      signal='BUY',
      master_score=72.5,
      risk_reward=1.8,
      conviction_level='MEDIUM',
      data_quality='fresh',
  )
  if not allowed:
      log_decision(symbol=ticker, decision_type='reject_entry',
                   reason_code='risk_gate_blocked', reason_text=reason, ...)
      return  # skip INSERT
  # proceed with INSERT using final_signal
"""

from __future__ import annotations

import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# Only BUY-family signals are "actionable" (require risk gate). HOLD/SELL/NO_TRADE
# are not blocked by risk gate (they're already non-actionable or protective).
_ACTIONABLE_SIGNALS = {'BUY', 'STRONG_BUY', 'ACCUMULATE', 'WHALE_RADAR_BUY'}


def safe_apply_risk_gate(
    signal: str,
    master_score: float,
    risk_reward: float = 0.0,
    conviction_level: str = '',
    data_quality: str = 'fresh',
    liquidity_blocked: bool = False,
    critical_engine_failed: bool = False,
    position_size_pct: float = 5.0,
    capital: float = 10000.0,
) -> Tuple[bool, str, str]:
    """Apply risk gate with fail-closed behavior.

    Args:
        signal: the raw signal from the analyzer (e.g. 'BUY', 'STRONG_BUY').
        master_score: combined score (0-100).
        risk_reward: R:R ratio (e.g. 1.8).
        conviction_level: 'LOW'/'MEDIUM'/'HIGH' (optional).
        data_quality: 'fresh'/'stale' (optional, default 'fresh').
        liquidity_blocked: whether liquidity filter blocked (default False).
        critical_engine_failed: whether a critical engine failed (default False).
        position_size_pct: proposed position size % (default 5).
        capital: total capital (default 10000).

    Returns:
        (allowed, reason, final_signal)
        - allowed: True if the prediction may be published, False if it must be blocked.
        - reason: human-readable explanation (empty if allowed).
        - final_signal: the signal after risk gate adjustment (may differ from input).
    """
    # Non-actionable signals don't need the gate (they're already safe).
    if signal not in _ACTIONABLE_SIGNALS:
        return True, '', signal

    try:
        from core.risk_gate import apply_risk_gate
    except ImportError as e:
        # fail-closed: if risk_gate module is missing, block actionable signals.
        # This is a structural error — the operator must fix the import.
        logger.error(
            f"[risk_gate_wrapper] CRITICAL: cannot import risk_gate — "
            f"blocking actionable signal '{signal}' (fail-closed): {e}",
            exc_info=True,
        )
        return False, f'risk_gate module unavailable: {e}', 'NO_TRADE'

    # Build risk_profile dict from the available fields.
    risk_profile = {
        'risk_reward_ratio': risk_reward,
        'master_score': master_score,
    }

    try:
        final_signal, warnings, final_position_size = apply_risk_gate(
            signal=signal,
            master_score=master_score,
            risk_profile=risk_profile,
            conviction_level=conviction_level,
            data_quality=data_quality,
            liquidity_blocked=liquidity_blocked,
            critical_engine_failed=critical_engine_failed,
            position_size_pct=position_size_pct,
            capital=capital,
        )
    except Exception as e:
        # fail-closed: any exception in risk_gate blocks the prediction.
        # NO swallowed exceptions — full stacktrace logged.
        logger.error(
            f"[risk_gate_wrapper] risk_gate.apply_risk_gate threw for "
            f"signal='{signal}' master_score={master_score} R:R={risk_reward}: {e}",
            exc_info=True,
        )
        return False, f'risk_gate exception: {e}', 'NO_TRADE'

    # If risk_gate returned NO_TRADE, block.
    if final_signal == 'NO_TRADE':
        reason = '; '.join(warnings) if warnings else 'risk_gate returned NO_TRADE'
        logger.info(
            f"[risk_gate_wrapper] BLOCKED signal='{signal}' → NO_TRADE: {reason}"
        )
        return False, reason, 'NO_TRADE'

    # Signal was accepted (possibly downgraded). Log warnings for traceability.
    if warnings:
        logger.info(
            f"[risk_gate_wrapper] signal='{signal}' → '{final_signal}' "
            f"(warnings: {'; '.join(warnings)})"
        )

    return True, '', final_signal
