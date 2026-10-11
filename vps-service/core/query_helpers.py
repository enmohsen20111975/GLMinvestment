"""
query_helpers — Shared SQL fragments for predictions queries (DEV-11)
=====================================================================

DEV-11 (2026-10-13 — PRODUCTION-AUDIT G1+G2):
The previous per-file inline filter `status != 'INVALID'` excluded only one
"hidden" status (INVALID) but let every other masked-deletion status slip
through. The masked-wipe (UPDATE WHERE 1=1) used status='ARCHIVED' to hide
rows it had silently erased. Same story for status='REJECTED_BAD_RR' (the
geometry-guard's silent-rejection channel that nonetheless left a row in
the table).

`ACTIVE_PREDICTION_FILTER` is the single, canonical SQL fragment for the
"this prediction is honest data and counts toward analytics" question.
Every read path that computes win-rate / PF / league-report / honest-tracking
stats MUST apply it.

Usage
-----
Import the constant and substitute it into your WHERE clauses:

    from core.query_helpers import ACTIVE_PREDICTION_FILTER

    cursor.execute(
        "SELECT id, ticker, signal, entry_price, target_price, stop_loss "
        "FROM predictions "
        "WHERE outcome_date IS NULL "
        "  AND " + ACTIVE_PREDICTION_FILTER + " "
        "ORDER BY created_at ASC"
    )

Semantics
---------
A prediction is considered "active" (counts toward analytics) when its
status is NOT one of:

- ``'INVALID'``           — placeholder row written by rogue path (Rule 27
                           NO-FAKE-DATA). Stored as INVALID so downstream
                           queries can skip it.
- ``'ARCHIVED'``          — masked-wipe victim (DEV-06 / DEV-11). The row
                           still physically exists (we never DELETE), but
                           its outcome is no longer trustworthy because
                           the wipe erased its closed-state without an
                           audit trail.
- ``'REJECTED_BAD_RR'``   — geometry guard rejected the row but the
                           write path left a stub. Excluded by every
                           honest-tracking stat.

The list is FROZEN — adding a new excluded status requires updating this
file and every consumer automatically picks up the change. That is the
point of centralizing the filter.

References
----------
- Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
- Documentation/00-CONSTITUTION.md §21 (V40.2 evidence-based)
- agent-ctx/DEV-11-14-lead-technical-implementer.md §1
- worklog.md DEV-11
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# DEV-11 §3 — The single canonical "active prediction" filter.
# Used by every read path that computes analytics / league-report / honest-
# tracking / daily_closer / telegram_target_hit_tracker.
# ─────────────────────────────────────────────────────────────────────────────
ACTIVE_PREDICTION_FILTER = (
    "status NOT IN ('INVALID', 'ARCHIVED', 'REJECTED_BAD_RR')"
)

# Same filter as a Python set, for in-process membership checks (e.g., when
# filtering row dicts returned from a SELECT *).
ACTIVE_PREDICTION_EXCLUDED_STATUSES = frozenset((
    'INVALID',
    'ARCHIVED',
    'REJECTED_BAD_RR',
))


def is_active_status(status: str | None) -> bool:
    """Python-side helper — True if `status` is an active (analytics-eligible) value.

    Useful for filtering row dicts after a SELECT *:
        rows = [r for r in all_rows if is_active_status(r.get('status'))]

    Args:
        status: the value of the predictions.status column (may be None).

    Returns:
        True if the row should count toward honest-tracking / league-report
        stats. False if it is a placeholder / archived / rejected stub.
    """
    if status is None:
        # NULL status historically means "pending" (the daily_closer comment
        # at L319-320 documents this). Treat NULL as active so we don't
        # silently drop pending predictions from analytics.
        return True
    return (status.upper().strip() not in ACTIVE_PREDICTION_EXCLUDED_STATUSES)


__all__ = (
    'ACTIVE_PREDICTION_FILTER',
    'ACTIVE_PREDICTION_EXCLUDED_STATUSES',
    'is_active_status',
)
