"""
safe_insert_prediction — Single Sanctioned INSERT Entry Point (DEV-07 + DEV-12)
==============================================================================

THE ONLY sanctioned way to INSERT into the predictions table.

DEV-12 (2026-10-13 — PRODUCTION-AUDIT G3+G5):
The 3 INSERT statements that used to live inside
``PredictionTracker.record_prediction()`` have been consolidated into
``_execute_canonical_insert()`` in THIS file. ``record_prediction()`` now
calls ``safe_insert_prediction()`` for the actual INSERT, so the repo
contains exactly one INSERT site (this file) and the CI gate
``scripts/check_no_raw_insert.py`` only needs to whitelist ``safe_insert_prediction.py``.

Constitutional flow (defense-in-depth, every layer MUST pass):
    1. DEV-07 hard gate — reject None / non-positive prices up-front
    2. validate_prediction_evidence() — Rule 35 + 21 + 27 + DEV-03 price checks
    3. _execute_canonical_insert() — DB-level INSERT with 3 schema fallbacks
       (full 26-col → mid 16-col → old 15-col) + optional `market` column UPDATE

When called via ``PredictionTracker.record_prediction()``, additional guards
run BEFORE this function:
    - enforce_geometry_guard() (R1-R5)
    - data_quality_rules.validate_write() (W1-W9)
    - prediction_write_guard.validate_prediction_evidence() (re-check)
    - dedup (ticker, persona) → UPDATE existing if found
    - cap (5 pending per persona)

Acceptance (DEV-07):
    - safe_insert_prediction(entry_price=0) → None ✅
    - safe_insert_prediction(entry_price=None) → None ✅
    - safe_insert_prediction(entry_price=-10) → None ✅
    - safe_insert_prediction(valid args + V40.2 evidence) → prediction_id (int)

Acceptance (DEV-12):
    - test_valid_prediction → PASS (returns prediction_id int)
    - test_none_prices → None
    - test_zero_prices → None
    - test_wrong_direction → None (target <= entry for BUY)
    - test_missing_evidence → None (evidence_count < 3 for BUY)
    - test_guard_import_failure → None (fail-closed, not fail-open)

References:
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
    - Documentation/00-CONSTITUTION.md §21 (evidence-based)
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - worklog.md DEV-07 + DEV-12
"""
from __future__ import annotations

import os
import sys
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

# Resolve vps-service/ root for `core.*` and `analyzers.*` imports
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

# ─────────────────────────────────────────────────────────────────────────────
# Rule 54 / Phase 3: db_manager.connection() — fallback sqlite3.connect
# ─────────────────────────────────────────────────────────────────────────────
try:
    from core.db_manager import db_manager as _dbm
    _DBM_AVAILABLE = True
except Exception as _dbm_err:
    _DBM_AVAILABLE = False
    print(f"[safe_insert_prediction] db_manager not available ({_dbm_err}) — using raw sqlite3", flush=True)

from contextlib import contextmanager as _ctxmgr


@_ctxmgr
def _open_db(db_path: str, writable: bool = False):
    """Open a DB connection via db_manager — fallback to raw sqlite3."""
    ctx = None
    conn = None
    try:
        if _DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# DEV-12 §1 — The SINGLE canonical INSERT INTO predictions.
# ─────────────────────────────────────────────────────────────────────────────
# Three schema fallbacks (full → mid → old) preserved from the original
# PredictionTracker.record_prediction() block. They are NOT 3 separate INSERTs
# in the repo — they are 3 fallback branches inside ONE function, only one
# of which executes per call. The CI gate `check_no_raw_insert.py` whitelists
# this file, so the repo has exactly ONE sanctioned INSERT site.
# ─────────────────────────────────────────────────────────────────────────────

_FULL_SCHEMA_INSERT = '''
    INSERT INTO predictions (
        ticker, signal, signal_type,
        prediction_date, entry_price, target_price, stop_loss, master_score,
        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
        notes, persona, created_at, atr_at_entry,
        target_price_2, explosive_score, explosive_label,
        evidence_count, morning_bell, kill_filter_result,
        risk_reward, who_is_buying,
        support_level, resistance_level
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
'''

_MID_SCHEMA_INSERT = '''
    INSERT INTO predictions (
        ticker, signal, signal_type,
        prediction_date, entry_price, target_price, stop_loss, master_score,
        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
        notes, persona, created_at, atr_at_entry
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
'''

_OLD_SCHEMA_INSERT = '''
    INSERT INTO predictions (
        ticker, signal, signal_type,
        prediction_date, entry_price, target_price, stop_loss, master_score,
        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
        notes, persona, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
'''


def _execute_canonical_insert(
    db_path: str,
    ticker: str,
    signal: str,
    signal_type: str,
    prediction_date: str,
    entry_price,
    target_price,
    stop_loss,
    master_score,
    technical_score,
    fundamental_score,
    ai_pattern_score,
    sentiment_score,
    notes: str,
    persona: str,
    created_at_iso: str,
    atr_at_entry,
    target_price_2: float,
    explosive_score: float,
    explosive_label: str,
    evidence_count: int,
    morning_bell: int,
    kill_filter_result: str,
    risk_reward,
    who_is_buying_state: str,
    support_level: float,
    resistance_level: float,
    market: Optional[str] = None,
) -> Optional[int]:
    """DEV-12 §1: The single canonical INSERT INTO predictions.

    Args mirror the column order of the full-schema INSERT. The 3 schema
    fallbacks are tried in order: full → mid → old. If all 3 fail, returns
    None (no INSERT happened) — the caller should treat this as a rejection.

    Returns:
        prediction_id (int) on success, None on failure (logged loudly).
    """
    db_path = str(db_path)
    pred_id: Optional[int] = None

    try:
        with _open_db(db_path, writable=True) as conn:
            cursor = conn.cursor()

            # Try 1: full schema (26 columns)
            try:
                cursor.execute(_FULL_SCHEMA_INSERT, (
                    ticker, signal, signal_type,
                    prediction_date,
                    entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, persona,
                    created_at_iso,
                    atr_at_entry,
                    target_price_2, explosive_score, explosive_label,
                    evidence_count, morning_bell, kill_filter_result,
                    risk_reward, who_is_buying_state,
                    support_level, resistance_level,
                ))
            except Exception:
                # Try 2: mid schema (16 columns — no T2/explosive/evidence/
                # morning_bell/kill_filter/risk_reward/who_is_buying/support/
                # resistance columns)
                try:
                    cursor.execute(_MID_SCHEMA_INSERT, (
                        ticker, signal, signal_type,
                        prediction_date,
                        entry_price, target_price, stop_loss, master_score,
                        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                        notes, persona,
                        created_at_iso,
                        atr_at_entry,
                    ))
                except Exception:
                    # Try 3: old schema (15 columns — no atr_at_entry)
                    cursor.execute(_OLD_SCHEMA_INSERT, (
                        ticker, signal, signal_type,
                        prediction_date,
                        entry_price, target_price, stop_loss, master_score,
                        technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                        notes, persona,
                        created_at_iso,
                    ))

            pred_id = cursor.lastrowid
            conn.commit()

            # Post-INSERT: optional `market` column UPDATE.
            # The `market` column is added by historical_predictions_v2_routes
            # but is NOT in the base PredictionTracker schema. Best-effort
            # UPDATE — silently ignored if the column doesn't exist.
            if market and pred_id is not None:
                try:
                    conn.execute(
                        "UPDATE predictions SET market=? WHERE id=?",
                        (market, pred_id),
                    )
                    conn.commit()
                except sqlite3.OperationalError as _op_err:
                    if 'column' not in str(_op_err).lower():
                        print(
                            f"[DEV-12-MARKET-WARN] ticker={ticker} pred_id={pred_id} "
                            f"market={market} UPDATE OperationalError: {_op_err}",
                            flush=True,
                        )
                except Exception as _mkt_err:
                    print(
                        f"[DEV-12-MARKET-WARN] ticker={ticker} pred_id={pred_id} "
                        f"market={market} UPDATE failed: {_mkt_err}",
                        flush=True,
                    )

    except Exception as _ins_err:
        # The SQLite TRIGGER (DEV-07 / DEV-13) may ABORT here, raising
        # sqlite3.IntegrityError. Treat all exceptions as rejection + log.
        print(
            f"[DEV-12-INSERT-FAIL] ticker={ticker} signal={signal} "
            f"db={db_path} error={_ins_err}",
            flush=True,
        )
        return None

    if pred_id is None:
        print(
            f"[DEV-12-INSERT-FAIL] ticker={ticker} signal={signal} "
            f"cursor.lastrowid is None — INSERT did not return a row id",
            flush=True,
        )

    return pred_id


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
    db_path: Optional[str] = None,
    signal_type: Optional[str] = None,
    prediction_date: Optional[str] = None,
    created_at_iso: Optional[str] = None,
    technical_score: Optional[float] = None,
    fundamental_score: Optional[float] = None,
    ai_pattern_score: Optional[float] = None,
    sentiment_score: Optional[float] = None,
    atr_at_entry: Optional[float] = None,
    target_price_2: Optional[float] = None,
    explosive_score: Optional[float] = 0.0,
    explosive_label: Optional[str] = '',
    morning_bell: Optional[int] = 0,
    risk_reward: Optional[float] = None,
    who_is_buying_state: Optional[str] = '',
    support_level: float = 0.0,
    resistance_level: float = 0.0,
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
        db_path: optional explicit DB path. If None, uses DBPaths.PREDICTIONS_DB.
                 record_prediction() passes self.db_path here.
        signal_type: optional pre-computed signal_type (BUY / ACCUMULATE / HOLD /
                     REDUCE / SELL). If None, computed here from `signal`.
        prediction_date: optional explicit prediction_date string. If None,
                        computed via utils.trading_calendar.get_prediction_date_str.
        created_at_iso: optional explicit created_at ISO timestamp. If None,
                        computed as `<prediction_date>T09:00:00.000000`.
        technical_score, fundamental_score, ai_pattern_score, sentiment_score:
                     optional analysis component scores (None → NULL).
        atr_at_entry: ATR(14) at entry time (None → NULL).
        target_price_2: T2 multi-target price (None → 0.0).
        explosive_score: 0-100 explosive score (default 0.0).
        explosive_label: 'BOMB' / 'ROCKET' / 'SPARK' / '' (default '').
        morning_bell: 0/1 morning bell flag (default 0).
        risk_reward: pre-computed R:R ratio (None → NULL).
        who_is_buying_state: institutional-flow state string (default '').
        support_level: support level price (default 0.0).
        resistance_level: resistance level price (default 0.0).
        **kwargs: ignored (kept for backward-compat with callers that pass
                  extra fields like `evidence_count` etc.).

    Returns:
        prediction_id (int) if the INSERT succeeded, None if rejected by:
          - DEV-07 hard None/≤0 price gate
          - validate_prediction_evidence() (Rule 35/21/27)
          - DB-level INSERT failure (e.g., DEV-07/DEV-13 SQLite TRIGGER ABORT)
          - missing guard module (DEV-12: fail-closed, NOT fail-open)

    Side effects:
        - One row INSERTed into predictions table (on success)
        - Optional UPDATE on `market` column if market is provided
        - Loud print to stdout on every rejection (for grep-based monitoring)
    """
    # ════════════════════════════════════════════════════════════════════
    # DEV-07 HARD GATE — None / non-positive prices are NEVER allowed.
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
    # DEV-12 §1: validate_prediction_evidence (Rule 35 + 21 + 27 + DEV-03 prices)
    #
    # DEV-12 §2: FAIL-CLOSED — if the guard module is unavailable, REFUSE the
    # INSERT (return None) and log loudly. The previous behavior was
    # FAIL-OPEN (proceed without validation), which contradicted Rule 35.
    # ════════════════════════════════════════════════════════════════════
    try:
        from core.prediction_write_guard import validate_prediction_evidence
    except Exception as _imp:
        # DEV-12 §2: fail-closed. The guard module is the single enforcement
        # point for Rule 35 (V40.2 provenance) + Rule 21 (evidence) + Rule 27
        # (NO-FAKE-DATA). If it cannot be imported, we MUST NOT proceed —
        # the alternative is to silently write placeholder predictions, which
        # is exactly the failure mode that polluted the DB from 2026-09-27.
        print(
            f"[DEV-12-FAIL-CLOSED] prediction_write_guard module not importable "
            f"({_imp}) — REFUSING to insert (single-point guard missing). "
            f"Fix: ensure vps-service/core/prediction_write_guard.py exists.",
            flush=True,
        )
        return None

    try:
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
    except Exception as _ve_err:
        # DEV-12 §2: fail-closed on any validate_prediction_evidence error.
        print(
            f"[DEV-12-FAIL-CLOSED] validate_prediction_evidence raised "
            f"({_ve_err}) — REFUSING to insert.",
            flush=True,
        )
        return None

    if not _ok:
        print(
            f"[DEV-07-REJECT] ticker={ticker} signal={signal} "
            f"| {_reason}",
            flush=True,
        )
        return None

    # ════════════════════════════════════════════════════════════════════
    # DEV-12 §1: Resolve DB path (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
    # ════════════════════════════════════════════════════════════════════
    if db_path is None:
        try:
            from utils.db_paths import DBPaths
            db_path = DBPaths.PREDICTIONS_DB
        except Exception:
            db_path = str(_VPS_ROOT.parent / 'db' / 'predictions.db')

    # ════════════════════════════════════════════════════════════════════
    # Compute signal_type if not provided (caller may pre-compute it)
    # ════════════════════════════════════════════════════════════════════
    if signal_type is None:
        _sig = (signal or '').upper().strip()
        if _sig in ('STRONG_BUY', 'BUY'):
            signal_type = 'BUY'
        elif _sig == 'ACCUMULATE':
            signal_type = 'ACCUMULATE'
        elif _sig == 'HOLD':
            signal_type = 'HOLD'
        elif _sig == 'REDUCE':
            signal_type = 'REDUCE'
        else:
            signal_type = 'SELL'

    # ════════════════════════════════════════════════════════════════════
    # Normalize persona (caller may have already normalized — re-do for safety)
    # ════════════════════════════════════════════════════════════════════
    _persona = (persona or 'balanced').strip().lower()
    if _persona == 'investor':
        _persona = 'conservative'  # alias
    if _persona not in ('gambler', 'balanced', 'conservative'):
        _persona = 'balanced'

    # ════════════════════════════════════════════════════════════════════
    # Compute prediction_date + created_at_iso if not provided
    # ════════════════════════════════════════════════════════════════════
    try:
        from utils.trading_calendar import get_prediction_date_str
    except ImportError:
        def get_prediction_date_str(dt=None, market='EGX'):
            return (dt or datetime.now()).strftime('%Y-%m-%d')

    _pred_date = prediction_date if prediction_date else get_prediction_date_str(datetime.now())
    _created_at_iso = created_at_iso if created_at_iso else (_pred_date + 'T09:00:00.000000')

    # ════════════════════════════════════════════════════════════════════
    # Normalize T2 / explosive / evidence / morning_bell / kill_filter
    # ════════════════════════════════════════════════════════════════════
    _target_price_2 = float(target_price_2) if target_price_2 else 0.0
    _explosive_score = float(explosive_score) if explosive_score else 0.0
    _explosive_label = (explosive_label or '').strip().upper()
    _evidence_count = int(evidence_count) if evidence_count else 0
    _morning_bell = 1 if morning_bell else 0
    _kill_filter_result = (kill_filter_result or '').strip()

    # ════════════════════════════════════════════════════════════════════
    # DEV-12 §1: THE SINGLE CANONICAL INSERT (with 3 schema fallbacks).
    # ════════════════════════════════════════════════════════════════════
    return _execute_canonical_insert(
        db_path=db_path,
        ticker=ticker,
        signal=signal,
        signal_type=signal_type,
        prediction_date=_pred_date,
        entry_price=entry_price,
        target_price=target_price,
        stop_loss=stop_loss,
        master_score=master_score,
        technical_score=technical_score,
        fundamental_score=fundamental_score,
        ai_pattern_score=ai_pattern_score,
        sentiment_score=sentiment_score,
        notes=notes,
        persona=_persona,
        created_at_iso=_created_at_iso,
        atr_at_entry=atr_at_entry,
        target_price_2=_target_price_2,
        explosive_score=_explosive_score,
        explosive_label=_explosive_label,
        evidence_count=_evidence_count,
        morning_bell=_morning_bell,
        kill_filter_result=_kill_filter_result,
        risk_reward=risk_reward,
        who_is_buying_state=who_is_buying_state or '',
        support_level=float(support_level or 0.0),
        resistance_level=float(resistance_level or 0.0),
        market=market,
    )


# ════════════════════════════════════════════════════════════════════════
# CLI smoke test — exercises the DEV-07 acceptance paths.
# Usage: python3 vps-service/core/safe_insert_prediction.py
# ════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser(description='DEV-07 + DEV-12 safe_insert_prediction smoke test')
    ap.add_argument('--dry-run', action='store_true',
                    help='Run rejection-path tests (no INSERT attempted)')
    args = ap.parse_args()

    print('═══════════════════════════════════════════════════════════════')
    print('  DEV-07 + DEV-12 safe_insert_prediction() — acceptance smoke test')
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

    # DEV-12 §3 acceptance: wrong direction (BUY with target <= entry)
    r6 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=10.0, target_price=9.0, stop_loss=8.0,
        evidence_count=4, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 6  (BUY target<=entry)        → result={r6!r}  expected=None  '
          f'{"✅ PASS" if r6 is None else "❌ FAIL"}')

    # DEV-12 §3 acceptance: missing evidence (BUY with evidence_count < 3)
    r7 = safe_insert_prediction(
        ticker='TEST.CA', signal='BUY',
        entry_price=10.0, target_price=12.0, stop_loss=9.0,
        evidence_count=1, kill_filter_result='V40 evidence=test',
        master_score=72.0, notes='engine=v40_2', persona='balanced',
        market='EGX',
    )
    print(f'Test 7  (BUY evidence_count<3)     → result={r7!r}  expected=None  '
          f'{"✅ PASS" if r7 is None else "❌ FAIL"}')

    if args.dry_run:
        print()
        print('Dry-run complete. Remove --dry-run to attempt a real INSERT.')
    else:
        print()
        print('All rejection paths tested. Real INSERT requires V40.2 evidence.')
