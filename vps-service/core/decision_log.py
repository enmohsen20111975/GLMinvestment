"""
core.decision_log — compatibility shim
======================================
Re-exports the public decision-logging API from its canonical location
``analyzers.decision_logger``.

Why this exists
---------------
The backtest scripts (``scripts/run_b0b4_full.py``,
``scripts/run_backtest_new_architecture.py``,
``scripts/test_integration_behavioral.py``) import the logger as::

    from core.decision_log import log_decision

while production code (``vps-service/jobs/daily_predictor.py``,
``vps-service/jobs/daily_closer.py``) imports it as::

    from analyzers.decision_logger import log_decision

Both names now resolve to the *same* implementation. This shim keeps the
backtest scripts working without modifying them, so historical comparisons
(B0–B4) stay reproducible.

Author: Z.ai Code
"""
from __future__ import annotations

from analyzers.decision_logger import (
    log_decision,
    get_decision_stats,
    REASON_CODES,
    DB_PATH,
)

# Backward-compatible alias: some scripts (e.g. test_integration_behavioral.py)
# import the older name `get_decision`. Keep it working.
get_decision = get_decision_stats

__all__ = [
    "log_decision",
    "get_decision_stats",
    "get_decision",  # alias
    "REASON_CODES",
    "DB_PATH",
]
