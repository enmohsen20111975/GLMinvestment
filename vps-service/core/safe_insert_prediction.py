"""
safe_insert_prediction — Single Sanctioned INSERT Entry Point (DEV-07)
=====================================================================

THE ONLY sanctioned way to INSERT into the predictions table.

Constitutional flow (defense-in-depth, every layer MUST pass):
    1. DEV-07 hard gate — reject None / non-positive prices up-front
    2. validate_prediction_evidence() — Rule 35 + 21 + 27 + DEV-03 price checks
    3. PredictionTracker.record_prediction() — canonical writer
       (which itself re-validates + enforces geometry guard + dedup + 5/persona cap)
    4. Post-INSERT: optional `market` column UPDATE (best-effort)

All other INSERT paths must be redirected here. The CI gate
(`scripts/check_no_raw_insert.py`) enforces this invariant, and the
SQLite TRIGGER (`vps-service/scripts/add_prediction_guard_trigger.py`)
is the database-level last line of defense.

Acceptance (DEV-07):
    - safe_insert_prediction(entry_price=0) → None ✅
    - safe_insert_prediction(entry_price=None) → None ✅
    - safe_insert_prediction(entry_price=-10) → None ✅
    - safe_insert_prediction(valid args + V40.2 evidence) → prediction_id (int)

References:
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
    - Documentation/00-CONSTITUTION.md §21 (evidence-based)
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - worklog.md DEV-07
"""
from __future__ import annotations

import os
import sys
import sqlite3
from pathlib import Path
from typing import Optional

# Resolve vps-service/ root for `core.*` and `analyzers.*` imports
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

# Recognized record_prediction() optional kwargs to forward
_RECORD_PREDICTION_KWARGS = (
    'technical_score',
    'fundamental_score',
    'ai_pattern_score',
    'sentiment_score',
    'notes',
    'persona',
    'atr_at_entry',
    'target_price_2',
    'explosive_score',
    'explosive_label',
    'prediction_date',
    'evidence_count',
    'morning_bell',
    'kill_filter_result',
    'risk_reward',
    'who_is_buying_state',
    'support_level',
    'resistance_level',
)


def safe_insert_prediction(
    ticker: str,
    signal: str,
    entry_price: float,
    target_price: float,
    stop_loss: float,
    evidence_count: int,
    kill_filter_result: str,
    master_score: float,
    notes: str,
    persona: str,
    market: str = None,
    **kwargs,
) -> Optional[int]:
    """The ONLY sanctioned way to INSERT into the predictions table.

    Args:
        ticker: stock symbol (e.g. 'COMI.CA')
        signal: BUY / STRONG_BUY / ACCUMULATE / HOLD / SELL / ...
        entry_price: entry price (MUST be > 0 — DEV-07 hard gate)
        target_price: target price (MUST be > 0 — DEV-07 hard gate)
        stop_loss: stop loss (MUST be > 0 — DEV-07 hard gate)
        evidence_count: V40.2 evidence count (0-6)
        kill_filter_result: V40.2 kill filter JSON signature (proves provenance)
        master_score: computed master_score (must not be 50.0 placeholder)
        notes: prediction notes (may contain engine=v40_2 tag per Rule 35)
        persona: 'gambler' | 'balanced' | 'conservative'
        market: 'EGX' / 'KSA' / 'KSE' / 'QSE' / 'CRYPTO' / ... (optional column
                — best-effort UPDATE after INSERT; silently ignored if column
                missing from the schema)
        **kwargs: forwarded to PredictionTracker.record_prediction() as optional
                  fields (technical_score, fundamental_score, ai_pattern_score,
                  sentiment_score, atr_at_entry, target_price_2, explosive_score,
                  explosive_label, prediction_date, morning_bell, risk_reward,
                  who_is_buying_state, support_level, resistance_level).

    Returns:
        prediction_id (int) if the INSERT succeeded, None if rejected by:
          - DEV-07 hard None/≤0 price gate
          - validate_prediction_evidence() (Rule 35/21/27)
          - record_prediction()'s geometry / cap / dedup guards
          - missing guard module (fail-closed)

    Side effects:
        - One row INSERTed into predictions table (on success)
        - Optional UPDATE on `market` column if market is provided
        - Loud print to stdout on every rejection (for grep-based monitoring)
    """
    # ════════════════════════════════════════════════════════════════════
    # DEV-07 HARD GATE — None / non-positive prices are NEVER allowed.
    # This is the single-point defense. Even if a caller bypasses
    # validate_prediction_evidence() somehow, this gate blocks None/0/negative.
    # ════════════════════════════════════════════════════════════════════
    if entry_price is None:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"entry_price=None — rejected (None not allowed — DEV-07 §3)",
            flush=True,
        )
        return None
    if target_price is None:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"target_price=None — rejected (None not allowed — DEV-07 §3)",
            flush=True,
        )
        return None
    if stop_loss is None:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"stop_loss=None — rejected (None not allowed — DEV-07 §3)",
            flush=True,
        )
        return None

    # Cast to float (defensive — accepts Decimal/int/str-numeric)
    try:
        _ep = float(entry_price)
        _tp = float(target_price)
        _sl = float(stop_loss)
    except (TypeError, ValueError) as _cast:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"price cast failed (entry={entry_price!r} target={target_price!r} "
            f"stop={stop_loss!r}) — rejected: {_cast}",
            flush=True,
        )
        return None

    if _ep <= 0:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"entry_price={_ep} <= 0 — rejected (must be > 0)",
            flush=True,
        )
        return None
    if _tp <= 0:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"target_price={_tp} <= 0 — rejected (must be > 0)",
            flush=True,
        )
        return None
    if _sl <= 0:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"stop_loss={_sl} <= 0 — rejected (must be > 0)",
            flush=True,
        )
        return None

    # ════════════════════════════════════════════════════════════════════
    # Step 1: validate_prediction_evidence (Rule 35 + 21 + 27 + DEV-03 prices)
    # ════════════════════════════════════════════════════════════════════
    try:
        from core.prediction_write_guard import validate_prediction_evidence
    except ImportError as _imp:
        print(
            f"[DEV-07-FAIL-CLOSED] prediction_write_guard module not importable "
            f"({_imp}) — REFUSING to insert (single-point guard missing). "
            f"Fix: ensure vps-service/core/prediction_write_guard.py exists.",
            flush=True,
        )
        return None

    _ok, _reason = validate_prediction_evidence(
        signal=signal,
        evidence_count=evidence_count,
        kill_filter_result=kill_filter_result,
        master_score=master_score,
        notes=notes,
        source='safe_insert_prediction',
        entry_price=entry_price,
        target_price=target_price,
        stop_loss=stop_loss,
    )
    if not _ok:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"| {_reason}",
            flush=True,
        )
        return None

    # ════════════════════════════════════════════════════════════════════
    # Step 2: PredictionTracker.record_prediction() — canonical writer
    # record_prediction() itself re-validates (defense in depth) + enforces
    # geometry guard (R1-R5) + dedup + 5-per-persona cap.
    # ════════════════════════════════════════════════════════════════════
    try:
        from analyzers.prediction_tracker import PredictionTracker
    except ImportError as _imp:
        print(
            f"[DEV-07-FAIL-CLOSED] prediction_tracker module not importable "
            f"({_imp}) — REFUSING to insert (canonical writer missing).",
            flush=True,
        )
        return None

    # Resolve DB path (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
    try:
        from utils.db_paths import DBPaths
        _db_path = DBPaths.PREDICTIONS_DB
    except Exception:
        _db_path = str(_VPS_ROOT.parent / 'db' / 'predictions.db')

    try:
        _tracker = PredictionTracker(_db_path)
    except Exception as _init_err:
        print(
            f"[DEV-07-FAIL-CLOSED] PredictionTracker init failed "
            f"(db={_db_path}): {_init_err}",
            flush=True,
        )
        return None

    # Forward only recognized optional kwargs (ignore unknown ones silently —
    # safe_insert_prediction() is meant as a generic entrypoint)
    _rp_kwargs = {}
    for _k in _RECORD_PREDICTION_KWARGS:
        if _k in kwargs and kwargs[_k] is not None:
            _rp_kwargs[_k] = kwargs[_k]

    try:
        _pred_id = _tracker.record_prediction(
            ticker=ticker,
            signal=signal,
            entry_price=entry_price,
            target_price=target_price,
            stop_loss=stop_loss,
            master_score=master_score,
            notes=notes,
            persona=persona,
            evidence_count=evidence_count,
            kill_filter_result=kill_filter_result,
            **_rp_kwargs,
        )
    except Exception as _rp_err:
        # Catch-all: record_prediction() should never raise (it returns None on
        # rejection), but if it does, treat as rejection + log loudly.
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"record_prediction() raised: {_rp_err}",
            flush=True,
        )
        return None

    if _pred_id is None:
        # record_prediction() rejected (geometry / dedup / cap / guard)
        return None

    # ════════════════════════════════════════════════════════════════════
    # Step 3 (post-INSERT): optional `market` column UPDATE.
    # The `market` column is added by historical_predictions_v2_routes but
    # is NOT in the base PredictionTracker schema. Best-effort UPDATE —
    # silently ignored if the column doesn't exist (OperationalError).
    # ════════════════════════════════════════════════════════════════════
    if market:
        try:
            _conn = sqlite3.connect(_db_path, timeout=10.0)
            try:
                _conn.execute(
                    "UPDATE predictions SET market=? WHERE id=?",
                    (market, _pred_id),
                )
                _conn.commit()
            except sqlite3.OperationalError as _op_err:
                # Column 'market' does not exist — silently skip
                # (the INSERT succeeded; market is informational only)
                if 'column' not in str(_op_err).lower():
                    print(
                        f"[DEV-07-MARKET-WARN] ticker={ticker} pred_id={_pred_id} "
                        f"market={market} UPDATE OperationalError: {_op_err}",
                        flush=True,
                    )
            finally:
                _conn.close()
        except Exception as _mkt_err:
            # Do NOT fail the INSERT — market column is informational only
            print(
                f"[DEV-07-MARKET-WARN] ticker={ticker} pred_id={_pred_id} "
                f"market={market} UPDATE failed: {_mkt_err}",
                flush=True,
            )

    return _pred_id


# ════════════════════════════════════════════════════════════════════════
# CLI smoke test — exercises the DEV-07 acceptance paths.
# Usage: python3 vps-service/core/safe_insert_prediction.py
# ════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser(description='DEV-07 safe_insert_prediction smoke test')
    ap.add_argument('--dry-run', action='store_true',
                    help='Run rejection-path tests (no INSERT attempted)')
    args = ap.parse_args()

    print('═══════════════════════════════════════════════════════════════')
    print('  DEV-07 safe_insert_prediction() — acceptance smoke test')
    print('═══════════════════════════════════════════════════════════════')

    # Test 1: entry_price=None → None (DEV-07 §3 None gate)
    r1 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=None, target_price=10.0, stop_loss=9.0,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 1  (entry_price=None)        → result={r1!r}  expected=None  '
          f'{"✅ PASS" if r1 is None else "❌ FAIL"}')

    # Test 2: entry_price=0 → None (DEV-07 §3 zero gate)
    r2 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=0, target_price=10.0, stop_loss=9.0,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 2  (entry_price=0)            → result={r2!r}  expected=None  '
          f'{"✅ PASS" if r2 is None else "❌ FAIL"}')

    # Test 3: entry_price=-10 → None (DEV-07 §3 negative gate)
    r3 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=-10, target_price=10.0, stop_loss=9.0,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 3  (entry_price=-10)         → result={r3!r}  expected=None  '
          f'{"✅ PASS" if r3 is None else "❌ FAIL"}')

    # Test 4: target_price=None → None
    r4 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=10.0, target_price=None, stop_loss=9.0,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 4  (target_price=None)        → result={r4!r}  expected=None  '
          f'{"✅ PASS" if r4 is None else "❌ FAIL"}')

    # Test 5: stop_loss=None → None
    r5 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=10.0, target_price=12.0, stop_loss=None,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 5  (stop_loss=None)          → result={r5!r}  expected=None  '
          f'{"✅ PASS" if r5 is None else "❌ FAIL"}')

    if args.dry_run:
        print()
        print('Dry-run complete. Remove --dry-run to attempt a real INSERT.')
    else:
        print()
        print('All rejection paths tested. Real INSERT requires V40.2 evidence.')
