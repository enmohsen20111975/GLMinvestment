"""
Prediction Write Guard (Rule 35 ENGINE-UNIFY + Rule 67 CALCULATION-CANONICAL)
============================================================================

The Single Gate. Every call to PredictionTracker.record_prediction() MUST
pass through validate_prediction_evidence() before INSERT.

This is the constitutional enforcement of Rule 35 (V40.2 is the only writer)
+ Rule 21 (BUY/STRONG_BUY require 6 evidences) + Rule 27 (NO-FAKE-DATA).

Background (2026-10-12):
- A microscopic audit discovered that V40.2 stopped producing evidence-based
  predictions from 2026-09-27. Three rogue paths filled the gap with
  placeholder predictions (evidence_count=0, score=50, kill_filter_result=NULL):
    B.1: sniper_routes.py::track_ticker() L812 — POST /api/sniper/track
    B.2: daily_predictor.py L3909 (CRYPTO path) — fake master_score
    B.3: daily_predictor.py L3343 (EGX path) when V40.2 evidence engine fails
- This guard is the architectural fix: a Single Gate that blocks all rogue
  paths at the canonical writer (record_prediction), regardless of caller.

Enforcement:
1. Rule 35 — Engine provenance: notes must contain engine=v40_2 OR
   engine=v40_2_intraday OR engine=dual_track_liquidity, OR kill_filter_result
   must start with a recognized engine signature (V40 evidence= / INTRADAY-5M /
   LIQUIDITY-TRACK-B).
2. Rule 21 — Evidence requirement: BUY/STRONG_BUY/ACCUMULATE require
   evidence_count >= 3 AND non-empty kill_filter_result.
3. Rule 27 — No placeholder: master_score must not be 50.0 for BUY signals,
   and HOLD with score=50 + empty kill_filter is also blocked (IMPROVEMENT-12
   WAIT→HOLD placeholder pattern).

Bypass:
- Set BYPASS_PREDICTION_WRITE_GUARD=1 ONLY for DB migrations/cleanup
  explicitly approved by the owner (Rule 25). The bypass is logged.

Reference:
- Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
- Documentation/00-CONSTITUTION.md §21 (V40.2 evidence-based)
- Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
- Documentation/00-CONSTITUTION.md §67 (CALCULATION-CANONICAL + ROOT-CAUSE-FIRST)
- worklog.md PRED-WRITE-GUARD task (2026-10-12)
"""
import os
from typing import Tuple

# Bypass env var — Rule 25 owner approval required
BYPASS_ENV = 'BYPASS_PREDICTION_WRITE_GUARD'

# Recognized engine signatures in kill_filter_result (proves provenance)
# These prefixes are emitted ONLY by sanctioned V40.2 engines:
#   - 'V40 evidence='       → daily_predictor.py EGX path (V40.2 daily)
#   - 'INTRADAY-5M'          → intraday_scanner.py (V40.2 intraday)
#   - 'LIQUIDITY-TRACK-B'    → dual_track_generator.py Track B (Rule 49)
ENGINE_SIGNATURES = (
    'V40 evidence=',
    'INTRADAY-5M',
    'LIQUIDITY-TRACK-B',
)

# Recognized engine_source tags in notes (Rule 35: "engine=v40_2")
ENGINE_TAGS = ('v40_2', 'v40_2_intraday', 'dual_track_liquidity')

# Signals that require full evidence (Rule 21)
EVIDENCE_REQUIRED_SIGNALS = frozenset(('BUY', 'STRONG_BUY', 'ACCUMULATE'))

# Minimum evidence count (V40.2 threshold — 3 of 6 evidences)
# Rule 21 lists 6 evidences (Trend 8 + Makers 26 + DNA 8 + Fundamentals 8
# + Sector 8 + Benchmark 24 = 82 weight). We require at least 3 to ensure
# the engine actually computed evidence (not a fallback placeholder).
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

    # ─── Rule 35: engine_source provenance check ─────────────────────────
    # The prediction must come from V40.2 / V40.2-intraday / dual_track.
    # Provenance is proven by:
    #   (a) notes containing engine=v40_2 / engine=v40_2_intraday /
    #       engine=dual_track_liquidity
    #   (b) kill_filter_result starting with a recognized engine signature
    engine_proven = False
    engine_tag = 'unknown'

    # Check (a): notes engine tag (per Rule 35 — "engine_source tag: كل توقع
    # جديد في notes فيه engine=v40_2")
    for tag in ENGINE_TAGS:
        if f'engine={tag}' in nt:
            engine_proven = True
            engine_tag = tag
            break

    # Check (b): kill_filter_result signature (proves V40.2 pipeline ran)
    if not engine_proven:
        for sig_prefix in ENGINE_SIGNATURES:
            if kf.startswith(sig_prefix):
                engine_proven = True
                engine_tag = sig_prefix.split('=')[0].split('-')[0].lower()
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
                f'(source={source}, engine={engine_tag})'
            )

        if not kf:
            return False, (
                f'Rule 21 violation: {sig} requires non-empty kill_filter_result '
                f'(V40.2 evidence pipeline output). Got empty/NULL '
                f'(source={source}, engine={engine_tag})'
            )

        # Rule 27: master_score must not be placeholder 50 for BUY signals
        if master_score is not None:
            try:
                if abs(float(master_score) - PLACEHOLDER_SCORE) < 0.01:
                    return False, (
                        f'Rule 27 violation: {sig} master_score=50.0 is '
                        f'placeholder (engine_settings.tech_score_base default), '
                        f'not computed from V40.2 evidence '
                        f'(source={source}, engine={engine_tag})'
                    )
            except (TypeError, ValueError):
                pass  # non-numeric master_score — let downstream handle

    # ─── Rule 27: HOLD/REDUCE/SELL placeholder detection ────────────────
    # IMPROVEMENT-12 WAIT→HOLD placeholders have: master_score=50 + empty
    # kill_filter_result. These polluted the DB from 2026-09-27 when V40.2
    # evidence engine started failing silently.
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
                        f'(source={source}, engine={engine_tag})'
                    )
            except (TypeError, ValueError):
                pass

    return True, f'OK (engine={engine_tag}, signal={sig}, evidence={ev})'


def audit_predictions_db(db_path: str, cutoff_date: str = '2026-09-27') -> dict:
    """
    Audit predictions.db for placeholder predictions (read-only).

    Returns a dict with counts of:
    - total predictions since cutoff
    - placeholder predictions (evidence=0 + kill_filter empty)
    - placeholder breakdown by signal
    - sanctioned predictions (V40.2 with evidence >= 3)

    Useful for verifying the cleanup script + monitoring future violations.
    """
    import sqlite3
    if not os.path.exists(db_path):
        return {'error': f'DB not found: {db_path}'}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    try:
        total = cur.execute(
            "SELECT COUNT(*) FROM predictions WHERE prediction_date >= ?",
            (cutoff_date,),
        ).fetchone()[0]

        placeholders = cur.execute(
            """SELECT COUNT(*) FROM predictions
               WHERE evidence_count = 0
                 AND (kill_filter_result IS NULL OR kill_filter_result = '')
                 AND prediction_date >= ?""",
            (cutoff_date,),
        ).fetchone()[0]

        sanctioned = cur.execute(
            """SELECT COUNT(*) FROM predictions
               WHERE evidence_count >= 3
                 AND kill_filter_result IS NOT NULL
                 AND kill_filter_result != ''
                 AND prediction_date >= ?""",
            (cutoff_date,),
        ).fetchone()[0]

        by_signal = {}
        for r in cur.execute(
            """SELECT signal, COUNT(*) as cnt FROM predictions
               WHERE evidence_count = 0
                 AND (kill_filter_result IS NULL OR kill_filter_result = '')
                 AND prediction_date >= ?
               GROUP BY signal ORDER BY cnt DESC""",
            (cutoff_date,),
        ).fetchall():
            by_signal[r['signal']] = r['cnt']

        return {
            'cutoff_date': cutoff_date,
            'total_predictions': total,
            'placeholder_predictions': placeholders,
            'sanctioned_predictions': sanctioned,
            'placeholder_breakdown_by_signal': by_signal,
            'placeholder_pct': round(placeholders / total * 100, 2) if total else 0,
        }
    finally:
        conn.close()


if __name__ == '__main__':
    # CLI: audit the predictions.db
    import sys
    from pathlib import Path
    db = sys.argv[1] if len(sys.argv) > 1 else str(
        Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db'
    )
    print(f"[AUDIT] DB: {db}")
    result = audit_predictions_db(db)
    for k, v in result.items():
        print(f"  {k}: {v}")
