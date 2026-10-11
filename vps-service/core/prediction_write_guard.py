"""
Prediction Write Guard (Rule 35 ENGINE-UNIFY + Rule 67 CALCULATION-CANONICAL)
============================================================================

The Single Gate. Every call to PredictionTracker.record_prediction() MUST
pass through validate_prediction_evidence() before INSERT.

This is the constitutional enforcement of Rule 35 (V40.2 is the only writer)
+ Rule 21 (BUY/STRONG_BUY require 6 evidences) + Rule 27 (NO-FAKE-DATA).

Background (2026-10-12 — MANAGER + ASSISTANT audit):
- A microscopic audit discovered that V40.2 stopped producing evidence-based
  predictions from 2026-09-27. 1061 rogue placeholder predictions filled the DB
  (evidence_count=0, kill_filter_result=NULL, master_score=None/50).
- 519 of these are from Maestro backfill with FABRICATED target_price
  (avg R:R = 49.55, EDBM target = entry × 106!)
- Previous worklog claims about "PREDICTION-WRITE-GUARD installed" were
  FABRICATED — the file never existed in the codebase or git history.

Enforcement:
1. Rule 35 — Engine provenance: kill_filter_result must start with a
   recognized engine signature ('V40 evidence=' / 'INTRADAY-5M' /
   'LIQUIDITY-TRACK-B').
2. Rule 21 — Evidence requirement: BUY/STRONG_BUY/ACCUMULATE require
   evidence_count >= 3 AND non-empty kill_filter_result.
3. Rule 27 — No placeholder: master_score must not be 50.0 for BUY signals,
   and HOLD with score=50 + empty kill_filter is also blocked.

Bypass:
- Set BYPASS_PREDICTION_WRITE_GUARD=1 ONLY for DB migrations/cleanup
  explicitly approved by the owner (Rule 25). The bypass is logged.

Reference:
- Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
- Documentation/00-CONSTITUTION.md §21 (V40.2 evidence-based)
- Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
- Documentation/00-CONSTITUTION.md §67 (CALCULATION-CANONICAL + ROOT-CAUSE-FIRST)
- worklog.md MANAGER-FULL-AUDIT + ASSISTANT-INDEPENDENT-VERIFY tasks
"""
import os
from typing import Tuple

# Bypass env var — Rule 25 owner approval required
BYPASS_ENV = 'BYPASS_PREDICTION_WRITE_GUARD'

# Recognized engine signatures in kill_filter_result (proves provenance)
ENGINE_SIGNATURES = (
    'V40 evidence=',
    'INTRADAY-5M',
    'LIQUIDITY-TRACK-B',
)

# Signals that require full evidence (Rule 21)
EVIDENCE_REQUIRED_SIGNALS = frozenset(('BUY', 'STRONG_BUY', 'ACCUMULATE'))

# Minimum evidence count (V40.2 threshold — 3 of 6 evidences)
MIN_EVIDENCE_COUNT = 3

# Placeholder master_score (Rule 27 NO-FAKE-DATA — 50.0 is the engine_settings
# default tech_score_base, which means "no computation happened")
PLACEHOLDER_SCORE = 50.0


def validate_prediction_evidence(
    signal: str,
    evidence_count,
    kill_filter_result: str,
    master_score,
    notes: str = '',
    source: str = 'unknown',
    entry_price: float = None,
    target_price: float = None,
    stop_loss: float = None,
) -> Tuple[bool, str]:
    """
    Validate that a prediction meets Rule 35 + Rule 21 + Rule 27 before INSERT.

    Args:
        signal: BUY / STRONG_BUY / ACCUMULATE / HOLD / REDUCE / SELL / WAIT
        evidence_count: V40.2 evidence count (0-6)
        kill_filter_result: V40.2 kill filter JSON signature (non-empty if V40.2)
        master_score: computed master_score (must not be 50.0 placeholder)
        notes: prediction notes (may contain engine=v40_2 tag per Rule 35)
        source: caller identifier for logging
        entry_price: entry price (must be > 0 — DEV-03)
        target_price: target price (must be > 0 — DEV-03)
        stop_loss: stop loss price (must be > 0 — DEV-03)

    Returns:
        (is_valid, reason) — if is_valid=False, reason explains the violation.
        if is_valid=True, reason describes the accepted provenance.
    """
    # Bypass for DB migrations / cleanup (Rule 25 — owner approval required)
    if os.environ.get(BYPASS_ENV) == '1':
        return True, f'bypassed ({BYPASS_ENV}=1 — Rule 25 owner approval)'

    sig = (signal or '').upper().strip()
    kf = kill_filter_result or ''
    nt = notes or ''
    try:
        ev = int(evidence_count or 0)
    except (TypeError, ValueError):
        ev = 0

    # ─── DEV-03 (2026-10-12 — DUAL-TRACK): Price validation ───────────
    # All prices must be strictly positive. Zero or negative = invalid data
    # (stock not trading, delisted, or data corruption).
    if entry_price is not None and float(entry_price) <= 0:
        return False, (
            f'DEV-03 violation: entry_price must be > 0, got {entry_price} '
            f'(source={source}) — stock may be delisted or price=0'
        )
    if target_price is not None and float(target_price) <= 0:
        return False, (
            f'DEV-03 violation: target_price must be > 0, got {target_price} '
            f'(source={source})'
        )
    if stop_loss is not None and float(stop_loss) <= 0:
        return False, (
            f'DEV-03 violation: stop_loss must be > 0, got {stop_loss} '
            f'(source={source})'
        )

    # ─── DEV-03 (continued): Direction validation ─────────────────────
    # BUY: target > entry, stop < entry
    # SELL: target < entry, stop > entry
    if (entry_price is not None and target_price is not None
            and float(entry_price) > 0 and float(target_price) > 0):
        if sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
            if float(target_price) <= float(entry_price):
                return False, (
                    f'DEV-03 violation: {sig} requires target_price > entry_price, '
                    f'got target={target_price} <= entry={entry_price} (source={source})'
                )
        elif sig in ('SELL', 'STRONG_SELL', 'REDUCE'):
            if float(target_price) >= float(entry_price):
                return False, (
                    f'DEV-03 violation: {sig} requires target_price < entry_price, '
                    f'got target={target_price} >= entry={entry_price} (source={source})'
                )

    if (entry_price is not None and stop_loss is not None
            and float(entry_price) > 0 and float(stop_loss) > 0):
        if sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
            if float(stop_loss) >= float(entry_price):
                return False, (
                    f'DEV-03 violation: {sig} requires stop_loss < entry_price, '
                    f'got stop={stop_loss} >= entry={entry_price} (source={source})'
                )
        elif sig in ('SELL', 'STRONG_SELL', 'REDUCE'):
            if float(stop_loss) <= float(entry_price):
                return False, (
                    f'DEV-03 violation: {sig} requires stop_loss > entry_price, '
                    f'got stop={stop_loss} <= entry={entry_price} (source={source})'
                )

    # ─── Rule 35: engine_source provenance check ─────────────────────────
    engine_proven = False

    # Check: notes engine tag (per Rule 35)
    for tag in ('engine=v40_2', 'engine=v40_2_intraday', 'engine=dual_track_liquidity'):
        if tag in nt:
            engine_proven = True
            break

    # Check: kill_filter_result signature (proves V40.2 pipeline ran)
    if not engine_proven:
        for sig_prefix in ENGINE_SIGNATURES:
            if kf.startswith(sig_prefix):
                engine_proven = True
                break

    if not engine_proven:
        return False, (
            f'Rule 35 violation: predictions must originate from V40.2 / '
            f'V40.2-intraday / dual_track. notes must contain '
            f'engine=v40_2|engine=v40_2_intraday|engine=dual_track_liquidity, '
            f'OR kill_filter_result must start with one of {ENGINE_SIGNATURES}. '
            f'Got notes="{nt[:80]}" kill_filter="{kf[:80]}" (source={source})'
        )

    # ─── Rule 21: BUY/STRONG_BUY/ACCUMULATE require evidence ─────────────
    if sig in EVIDENCE_REQUIRED_SIGNALS:
        if ev < MIN_EVIDENCE_COUNT:
            return False, (
                f'Rule 21 violation: {sig} requires evidence_count >= '
                f'{MIN_EVIDENCE_COUNT} (V40.2 minimum), got {ev} '
                f'(source={source})'
            )

        if not kf:
            return False, (
                f'Rule 21 violation: {sig} requires non-empty kill_filter_result '
                f'(V40.2 evidence pipeline output). Got empty/NULL '
                f'(source={source})'
            )

        # Rule 27: master_score must not be placeholder 50 for BUY signals
        if master_score is not None:
            try:
                if abs(float(master_score) - PLACEHOLDER_SCORE) < 0.01:
                    return False, (
                        f'Rule 27 violation: {sig} master_score=50.0 is '
                        f'placeholder (engine_settings.tech_score_base default), '
                        f'not computed from V40.2 evidence '
                        f'(source={source})'
                    )
            except (TypeError, ValueError):
                pass

    # ─── Rule 27: HOLD/REDUCE/SELL placeholder detection ────────────────
    elif sig in ('HOLD', 'REDUCE', 'SELL', 'WAIT'):
        if master_score is not None:
            try:
                if (abs(float(master_score) - PLACEHOLDER_SCORE) < 0.01
                        and not kf):
                    return False, (
                        f'Rule 27 violation: {sig} with placeholder '
                        f'master_score=50.0 + empty kill_filter_result — '
                        f'this matches the IMPROVEMENT-12 WAIT→HOLD placeholder '
                        f'pattern that polluted DB from 2026-09-27 '
                        f'(source={source})'
                    )
            except (TypeError, ValueError):
                pass

    return True, f'OK (evidence={ev}, signal={sig})'


if __name__ == '__main__':
    # CLI: audit the predictions.db
    import sys
    from pathlib import Path
    db = sys.argv[1] if len(sys.argv) > 1 else str(
        Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db'
    )
    print(f"[AUDIT] DB: {db}")

    import sqlite3
    conn = sqlite3.connect(db)
    cur = conn.cursor()

    total = cur.execute(
        "SELECT COUNT(*) FROM predictions"
    ).fetchone()[0]

    placeholders = cur.execute(
        """SELECT COUNT(*) FROM predictions
           WHERE evidence_count = 0
             AND (kill_filter_result IS NULL OR kill_filter_result = '')"""
    ).fetchone()[0]

    sanctioned = cur.execute(
        """SELECT COUNT(*) FROM predictions
           WHERE evidence_count >= 3
             AND kill_filter_result IS NOT NULL
             AND kill_filter_result != ''"""
    ).fetchone()[0]

    print(f"  total predictions: {total}")
    print(f"  placeholder (evidence=0 + kill_filter empty): {placeholders}")
    print(f"  sanctioned (evidence>=3 + kill_filter non-empty): {sanctioned}")
    print(f"  placeholder %: {round(placeholders/total*100, 1) if total else 0}%")

    conn.close()
