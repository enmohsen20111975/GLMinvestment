"""
test_safe_insert_prediction.py — DEV-12 §3 acceptance tests
===========================================================

Real pytest for ``core.safe_insert_prediction.safe_insert_prediction()``.

DEV-12 (2026-10-13 — PRODUCTION-AUDIT G3+G5):
The 3 INSERTs previously inlined in ``PredictionTracker.record_prediction()``
have been consolidated into ``_execute_canonical_insert()`` inside
``safe_insert_prediction.py``. These tests exercise every acceptance path
required by DEV-12 §3:

    - test_valid_prediction           → returns prediction_id (int) ✅
    - test_none_prices                → None (entry / target / stop)
    - test_zero_prices                → None (entry / target / stop)
    - test_wrong_direction            → None (BUY with target <= entry)
    - test_missing_evidence           → None (BUY with evidence_count < 3)
    - test_guard_import_failure       → None (fail-closed, NOT fail-open)

Run:
    cd vps-service && python3 -m pytest tests/test_safe_insert_prediction.py -v
"""
from __future__ import annotations

import os
import sys
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Ensure vps-service/ is on sys.path so `from core.safe_insert_prediction...`
# works regardless of where pytest is invoked from.
# ─────────────────────────────────────────────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))


# ─────────────────────────────────────────────────────────────────────────────
# Schema bootstrap — matches the "full schema" 26-column INSERT in
# `_execute_canonical_insert()`. We create a temp DB with this schema so
# `test_valid_prediction` can verify a real INSERT succeeds.
# ─────────────────────────────────────────────────────────────────────────────
_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    signal TEXT,
    signal_type TEXT,
    prediction_date TEXT,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    master_score REAL,
    technical_score REAL,
    fundamental_score REAL,
    ai_pattern_score REAL,
    sentiment_score REAL,
    notes TEXT,
    persona TEXT,
    created_at TEXT,
    atr_at_entry REAL,
    target_price_2 REAL,
    explosive_score REAL,
    explosive_label TEXT,
    evidence_count INTEGER,
    morning_bell INTEGER,
    kill_filter_result TEXT,
    risk_reward REAL,
    who_is_buying TEXT,
    support_level REAL,
    resistance_level REAL,
    market TEXT,
    outcome_date TEXT,
    status TEXT
);
"""


@pytest.fixture
def tmp_predictions_db(tmp_path, monkeypatch):
    """Create a temporary predictions.db with the full schema.

    Returns the path to the temp DB. The fixture also patches
    `DBPaths.PREDICTIONS_DB` to point at the temp DB so any code that
    resolves the path via DBPaths hits the temp file.
    """
    db_path = tmp_path / "predictions.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(_SCHEMA_SQL)
    conn.commit()
    conn.close()

    # Patch DBPaths.PREDICTIONS_DB so safe_insert_prediction defaults to the temp DB.
    try:
        from utils import db_paths as _db_paths_mod
        monkeypatch.setattr(_db_paths_mod.DBPaths, 'PREDICTIONS_DB', str(db_path))
    except Exception:
        # If DBPaths can't be imported, safe_insert_prediction falls back to
        # `<vps-root>/../db/predictions.db`. Tests pass db_path explicitly to
        # avoid relying on the default-resolution path.
        pass

    return str(db_path)


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance tests — DEV-12 §3
# ─────────────────────────────────────────────────────────────────────────────

class TestSafeInsertPrediction:
    """DEV-12 §3 acceptance tests."""

    def test_valid_prediction(self, tmp_predictions_db):
        """A fully-valid BUY prediction (V40.2 provenance + 6 evidences)
        is INSERTed and returns a non-None prediction_id."""
        from core.safe_insert_prediction import safe_insert_prediction

        pred_id = safe_insert_prediction(
            ticker='TEST.CA',
            signal='BUY',
            entry_price=10.0,
            target_price=12.0,
            stop_loss=9.0,
            evidence_count=4,
            kill_filter_result='V40 evidence=test_strong_evidence',
            master_score=72.0,
            notes='engine=v40_2 — strong buy signal',
            persona='balanced',
            market='EGX',
            db_path=tmp_predictions_db,
        )

        # Must return an int (prediction_id), not None.
        assert pred_id is not None, "valid prediction must return a non-None id"
        assert isinstance(pred_id, int), f"pred_id must be int, got {type(pred_id)}"

        # Verify the row was actually written.
        conn = sqlite3.connect(tmp_predictions_db)
        cur = conn.execute(
            "SELECT ticker, signal, entry_price, target_price, stop_loss, "
            "       evidence_count, kill_filter_result, master_score, persona, market "
            "FROM predictions WHERE id = ?",
            (pred_id,),
        )
        row = cur.fetchone()
        conn.close()

        assert row is not None, "row must exist after INSERT"
        assert row[0] == 'TEST.CA'
        assert row[1] == 'BUY'
        assert row[2] == 10.0
        assert row[3] == 12.0
        assert row[4] == 9.0
        assert row[5] == 4
        assert row[6] == 'V40 evidence=test_strong_evidence'
        assert row[7] == 72.0
        assert row[8] == 'balanced'
        assert row[9] == 'EGX'

    # ───────────────────────────────────────────────────────────────────────
    # None-price rejections (DEV-07 §3 + DEV-12 §3)
    # ───────────────────────────────────────────────────────────────────────

    def test_none_entry_price(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=None, target_price=10.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_none_target_price(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=None, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_none_stop_loss(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=None,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    # ───────────────────────────────────────────────────────────────────────
    # Zero / negative-price rejections (DEV-07 §3 + DEV-12 §3)
    # ───────────────────────────────────────────────────────────────────────

    def test_zero_entry_price(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=0, target_price=10.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_zero_target_price(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_zero_stop_loss(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_negative_entry_price(self, tmp_predictions_db):
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=-10, target_price=10.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    # ───────────────────────────────────────────────────────────────────────
    # Wrong-direction rejection (DEV-03 + DEV-12 §3)
    # ───────────────────────────────────────────────────────────────────────

    def test_wrong_direction_buy_target_le_entry(self, tmp_predictions_db):
        """BUY requires target > entry. target=9, entry=10 → REJECTED."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=9.0, stop_loss=8.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_wrong_direction_buy_target_eq_entry(self, tmp_predictions_db):
        """target == entry is also wrong direction for BUY."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=10.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    # ───────────────────────────────────────────────────────────────────────
    # Missing-evidence rejection (Rule 21 + DEV-12 §3)
    # ───────────────────────────────────────────────────────────────────────

    def test_missing_evidence_buy_count_below_threshold(self, tmp_predictions_db):
        """BUY requires evidence_count >= 3 (MIN_EVIDENCE_COUNT). count=1 → REJECTED."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=1, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_missing_evidence_buy_empty_kill_filter(self, tmp_predictions_db):
        """BUY requires non-empty kill_filter_result. Empty → REJECTED."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_missing_evidence_buy_placeholder_master_score(self, tmp_predictions_db):
        """BUY with master_score = 50.0 (placeholder) → REJECTED (Rule 27)."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=50.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    def test_missing_evidence_no_provenance(self, tmp_predictions_db):
        """No V40.2 provenance in notes/kill_filter → REJECTED (Rule 35)."""
        from core.safe_insert_prediction import safe_insert_prediction
        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='',  # no provenance
            master_score=72.0, notes='some random notes',  # no engine=v40_2 tag
            persona='balanced',
            db_path=tmp_predictions_db,
        )
        assert result is None

    # ───────────────────────────────────────────────────────────────────────
    # Fail-closed on guard import failure (DEV-12 §2 + §3)
    # ───────────────────────────────────────────────────────────────────────

    def test_guard_import_failure_fail_closed(self, tmp_predictions_db, monkeypatch):
        """If the prediction_write_guard module fails to import, safe_insert_prediction
        MUST refuse the INSERT (return None) — NOT fail-open and proceed.

        DEV-12 §2: the previous `except ImportError: fail-open` was rejected
        by the manager in Round 2. Fail-closed is the new contract.
        """
        # Built-in import machinery: patch __import__ to raise ImportError
        # ONLY for the prediction_write_guard module. Every other import
        # proceeds normally.
        real_import = __import__

        def _blocked_import(name, *args, **kwargs):
            if name == 'core.prediction_write_guard' or name.endswith('.prediction_write_guard'):
                raise ImportError("simulated by test_guard_import_failure")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr('builtins.__import__', _blocked_import)

        # Force re-import of safe_insert_prediction so the patched __import__
        # is in effect when safe_insert_prediction tries to import the guard.
        for mod_name in list(sys.modules.keys()):
            if 'safe_insert_prediction' in mod_name or 'prediction_write_guard' in mod_name:
                # Don't drop the module itself — just clear cached imports
                # of the guard inside safe_insert_prediction.
                if 'prediction_write_guard' in mod_name:
                    monkeypatch.delitem(sys.modules, mod_name, raising=False)

        from core.safe_insert_prediction import safe_insert_prediction

        result = safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )

        # DEV-12 §2: must be None — fail-closed.
        assert result is None, (
            "safe_insert_prediction must FAIL-CLOSED when prediction_write_guard "
            "is unimportable — return None, NOT proceed with the INSERT."
        )

    def test_guard_validate_raises_fail_closed(self, tmp_predictions_db, monkeypatch):
        """If validate_prediction_evidence raises ANY exception, safe_insert_prediction
        MUST refuse the INSERT (return None) — NOT fail-open.

        DEV-12 §2: `except Exception → return None` is the new contract.
        """
        from core import safe_insert_prediction as sip_mod

        def _raise_always(**kwargs):
            raise RuntimeError("simulated by test_guard_validate_raises")

        # Patch the imported reference inside safe_insert_prediction.
        # safe_insert_prediction does `from core.prediction_write_guard import
        # validate_prediction_evidence` lazily inside the function, so we
        # patch the source module's attribute.
        from core import prediction_write_guard as pwg_mod
        monkeypatch.setattr(pwg_mod, 'validate_prediction_evidence', _raise_always)

        result = sip_mod.safe_insert_prediction(
            ticker='TEST.CA', signal='BUY',
            entry_price=10.0, target_price=12.0, stop_loss=9.0,
            evidence_count=4, kill_filter_result='V40 evidence=test',
            master_score=72.0, notes='engine=v40_2', persona='balanced',
            db_path=tmp_predictions_db,
        )

        assert result is None, (
            "safe_insert_prediction must FAIL-CLOSED when validate_prediction_evidence "
            "raises — return None, NOT proceed with the INSERT."
        )
