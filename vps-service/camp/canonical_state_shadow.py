#!/usr/bin/env python3
"""
canonical_state_shadow.py — Shadow Mode Logger for Canonical State Integration
==============================================================================
يوفّر مراقبة معزولة (isolated observation) لـ canonical_state على التوقعات
بدون تغيير أي قرار إنتاجي.

المبدأ:
  - الـ Observer بـ يـ monkey-patch على `PredictionTracker.record_prediction`.
  - بعد كل record_prediction ناجح، بـ يجمع canonical_state للسهم+التاريخ.
  - بـ يخزن النتيجة في جدول منفصل `shadow_canonical_state_audit`.
  - لو canonical_state غير متاح → بـ يسجل NULL + يكمل (fail-safe).
  - مفيش أي تأثير على قرار التوقع نفسه.

التفعيل:
  - Env var `CANONICAL_STATE_SHADOW_MODE=1` لتفعيل الـ patching.
  - Default = معطّل (مش بـ يتـ import تلقائيًا).
  - يتخطى لو `V40_2_BACKTEST_MODE=1` لتفادي تلوث backtest runs.

السياسة المقترحة (مبدئية، مش للإنتاج):
  | State              | Allow Entry? | Priority Δ | Notes                          |
  |--------------------|--------------|------------|--------------------------------|
  | ACCUMULATION       | Yes          | +0         | Bullish context (already)      |
  | UPTREND            | Yes          | +0         | Bullish (already)               |
  | CORRECTION_HEALTHY | Yes          | +0         | Pullback in uptrend — neutral   |
  | DISTRIBUTION       | Log warning  | -5 (prop.) | Bearish flow — don't auto-reject|
  | DOWNTREND          | Log warning  | -5 (prop.) | Bearish — don't auto-reject     |
  | RECOVERY           | Yes          | +0         | Recovery attempt — neutral       |
  | STATE_UNCONFIRMED  | Yes          | +0         | Insufficient evidence            |
  | DATA_STALE         | Log warning  | +0         | Data quality, not trade signal   |
  | DATA_INCOMPLETE    | Log warning  | +0         | Data quality, not trade signal   |

  ملاحظة: الـ Priority Δ مقترح للتحليل بس — Shadow Mode لا يطبّقه.

الاستخدام:
  # في test أو script مستقل (مش في daily_predictor.py):
  import vps-service.camp.canonical_state_shadow as shadow
  shadow.activate()  # يفعّل الـ monkey-patch
  # ... run predictions normally ...
  audits = shadow.get_shadow_audits(limit=100)  # قراءة النتائج

الـ Audit table schema (CREATE TABLE IF NOT EXISTS — صفر schema migration):
  CREATE TABLE IF NOT EXISTS shadow_canonical_state_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER NOT NULL,           -- FK to predictions.id
      ticker TEXT NOT NULL,
      prediction_date TEXT NOT NULL,
      signal_type TEXT,                         -- BUY/ACCUMULATE/HOLD/etc.
      entry_price REAL,
      target_price REAL,
      stop_loss REAL,
      master_score REAL,
      evidence_count INTEGER,
      canonical_state TEXT,                     -- ACCUMULATION/UPTREND/...
      canonical_confidence REAL,
      canonical_prev_state TEXT,
      canonical_transition TEXT,
      canonical_days_in_state INTEGER,
      canonical_data_freshness TEXT,
      proposed_priority_delta INTEGER DEFAULT 0,  -- مقترح، مش مُطبّق
      proposed_action TEXT,                        -- 'ALLOW'/'WARN'/'REJECT' (مقترح)
      audit_timestamp TEXT DEFAULT (datetime('now'))
  );

Rule 67 (CALCULATION-CANONICAL) compliance:
  - canonical_state من canonical_stock_state.py::assess_state() (canonical source).
  - مفيش إعادة حساب.

Rule 20 (Python = Brain) compliance:
  - كل المنطق في Python. Node.js مش بـ يـ schema الـ audit table.

Rule 1 (لا تُلمس DBs الإنتاجية) compliance:
  - الـ audit table في `predictions.db` (sandbox فقط في هذه المرحلة).
  - ممكن يتسجّل في أي DB عبر `shadow_db_path` parameter.

Rule 68 (AGENT-QUALITY-GATE) compliance:
  - مفيش claims بدون verification.
  - الاختبارات في `scripts/test_shadow_mode_phase2.py`.
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Lazy imports — only when activated
_original_record_prediction = None
_patched = False

import sys as _bs_sys
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SHADOW_DB = PROJECT_ROOT / 'db' / 'predictions.db'
DEFAULT_STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# Allow override via env (for testing / custom deployment)
def _get_stocks_db_path() -> str:
    return os.environ.get('SHADOW_STOCKS_DB', str(DEFAULT_STOCKS_DB))

# Allow override via module attribute (for tests)
_stocks_db_override: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════
# POLICY MATRIX (مقترح للتحليل، مش مُطبّق في الإنتاج)
# ═══════════════════════════════════════════════════════════════════════════

PROPOSED_POLICY: Dict[str, Dict[str, Any]] = {
    'ACCUMULATION':       {'action': 'ALLOW', 'priority_delta': 0,  'rationale': 'Bullish context — already favorable'},
    'UPTREND':            {'action': 'ALLOW', 'priority_delta': 0,  'rationale': 'Bullish — already favorable'},
    'CORRECTION_HEALTHY': {'action': 'ALLOW', 'priority_delta': 0,  'rationale': 'Pullback in uptrend — neutral'},
    'DISTRIBUTION':       {'action': 'WARN',  'priority_delta': -5, 'rationale': 'Bearish flow — propose lower priority, not rejection'},
    'DOWNTREND':          {'action': 'WARN',  'priority_delta': -5, 'rationale': 'Bearish — propose lower priority, not rejection'},
    'RECOVERY':           {'action': 'ALLOW', 'priority_delta': 0,  'rationale': 'Recovery attempt — neutral'},
    'STATE_UNCONFIRMED':  {'action': 'ALLOW', 'priority_delta': 0,  'rationale': 'Insufficient evidence — do not fabricate'},
    'DATA_STALE':         {'action': 'WARN',  'priority_delta': 0,  'rationale': 'Data quality issue, not trade signal'},
    'DATA_INCOMPLETE':    {'action': 'WARN',  'priority_delta': 0,  'rationale': 'Data quality issue, not trade signal'},
    # Missing canonical_state → log only, no action proposed
    '':                  {'action': 'LOG_ONLY', 'priority_delta': 0, 'rationale': 'No canonical_state available for this ticker+date'},
}


def get_proposed_action(state: str) -> Dict[str, Any]:
    """Get proposed policy for a canonical state (for analysis only)."""
    return PROPOSED_POLICY.get(state, PROPOSED_POLICY[''])


# ═══════════════════════════════════════════════════════════════════════════
# AUDIT TABLE MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════

def ensure_audit_table(db_path: Optional[str] = None) -> str:
    """Create the shadow_canonical_state_audit table if not exists.

    Returns:
        Path to the DB where the table lives.
    """
    db_path = str(db_path or DEFAULT_SHADOW_DB)
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS shadow_canonical_state_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prediction_id INTEGER NOT NULL,
                ticker TEXT NOT NULL,
                prediction_date TEXT NOT NULL,
                signal_type TEXT,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                master_score REAL,
                evidence_count INTEGER,
                canonical_state TEXT,
                canonical_confidence REAL,
                canonical_prev_state TEXT,
                canonical_transition TEXT,
                canonical_days_in_state INTEGER,
                canonical_data_freshness TEXT,
                proposed_priority_delta INTEGER DEFAULT 0,
                proposed_action TEXT,
                audit_timestamp TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_shadow_audit_ticker_date
            ON shadow_canonical_state_audit(ticker, prediction_date)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_shadow_audit_state
            ON shadow_canonical_state_audit(canonical_state)
        """)
        conn.commit()
    finally:
        conn.close()
    return db_path


# ═══════════════════════════════════════════════════════════════════════════
# CANONICAL STATE READER (read from radar_signal_tracking)
# ═══════════════════════════════════════════════════════════════════════════

def fetch_canonical_state_for_ticker(
    ticker: str,
    as_of_date: str,
    stocks_db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Fetch the latest canonical_state for a ticker on/before as_of_date.

    Reads from `radar_signal_tracking` table (where state_history_tracker writes).
    Returns None if not available or DB fails.

    Args:
        ticker: Stock ticker (e.g., 'COMI').
        as_of_date: Assessment date (YYYY-MM-DD).
        stocks_db_path: Path to stocks.db. Defaults to <project>/db/stocks.db.

    Returns:
        Dict with canonical_state, confidence, prev_state, transition_type,
        days_in_state, data_freshness. None if unavailable.
    """
    if stocks_db_path is None:
        stocks_db_path = _stocks_db_override or _get_stocks_db_path()

    try:
        conn = sqlite3.connect(f'file:{stocks_db_path}?mode=ro', uri=True, timeout=10)
        try:
            row = conn.execute("""
                SELECT canonical_state, confidence, prev_state, transition_type,
                       days_in_state, data_freshness
                FROM radar_signal_tracking
                WHERE ticker = ?
                  AND signal_date <= ?
                  AND canonical_state != ''
                  AND signal_type = 'canonical_state'
                ORDER BY signal_date DESC
                LIMIT 1
            """, (ticker, as_of_date)).fetchone()
        finally:
            conn.close()

        if not row:
            return None

        return {
            'canonical_state': row[0],
            'confidence': row[1],
            'prev_state': row[2],
            'transition_type': row[3],
            'days_in_state': row[4],
            'data_freshness': row[5],
        }
    except Exception:
        # Fail-safe: any DB error → return None (don't break prediction)
        return None


# ═══════════════════════════════════════════════════════════════════════════
# SHADOW LOGIC (monkey-patch on PredictionTracker.record_prediction)
# ═══════════════════════════════════════════════════════════════════════════

def _shadow_record_prediction(self, *args, **kwargs) -> int:
    """Wrapper around PredictionTracker.record_prediction that logs canonical_state.

    Calls the original method first, then logs the audit record.
    Fails safely: if logging fails, returns the original prediction_id.
    """
    global _original_record_prediction
    if _original_record_prediction is None:
        # Should not happen — activate() sets this. Defensive.
        return 0

    # 1. Call original — get prediction_id
    prediction_id = _original_record_prediction(self, *args, **kwargs)

    # 2. Fail-fast: if prediction failed, don't log
    if not prediction_id:
        return prediction_id

    # 3. Extract key fields from kwargs (record_prediction signature)
    ticker = kwargs.get('ticker') or (args[0] if args else '')
    prediction_date = kwargs.get('prediction_date') or ''
    signal = kwargs.get('signal') or (args[1] if len(args) > 1 else '')
    entry_price = kwargs.get('entry_price')
    target_price = kwargs.get('target_price')
    stop_loss = kwargs.get('stop_loss')
    master_score = kwargs.get('master_score')
    evidence_count = kwargs.get('evidence_count', 0)

    # 4. Fetch canonical_state (fail-safe)
    try:
        cs = fetch_canonical_state_for_ticker(ticker, prediction_date)
    except Exception:
        cs = None

    # 5. Compute proposed policy (analysis only — not applied)
    if cs and cs.get('canonical_state'):
        policy = get_proposed_action(cs['canonical_state'])
        proposed_action = policy['action']
        proposed_priority_delta = policy['priority_delta']
    else:
        proposed_action = 'LOG_ONLY'
        proposed_priority_delta = 0

    # 6. Insert audit record (fail-safe)
    try:
        conn = sqlite3.connect(str(DEFAULT_SHADOW_DB), timeout=10)
        try:
            conn.execute("""
                INSERT INTO shadow_canonical_state_audit
                    (prediction_id, ticker, prediction_date, signal_type,
                     entry_price, target_price, stop_loss, master_score, evidence_count,
                     canonical_state, canonical_confidence, canonical_prev_state,
                     canonical_transition, canonical_days_in_state, canonical_data_freshness,
                     proposed_priority_delta, proposed_action)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                prediction_id, ticker, prediction_date, signal,
                entry_price, target_price, stop_loss, master_score, evidence_count,
                cs.get('canonical_state') if cs else None,
                cs.get('confidence') if cs else None,
                cs.get('prev_state') if cs else None,
                cs.get('transition_type') if cs else None,
                cs.get('days_in_state') if cs else None,
                cs.get('data_freshness') if cs else None,
                proposed_priority_delta, proposed_action,
            ))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        # Fail-safe: don't break prediction flow
        pass

    return prediction_id


def activate(force: bool = False) -> bool:
    """Activate shadow mode by monkey-patching PredictionTracker.record_prediction.

    Args:
        force: if True, re-patch even if already patched.

    Returns:
        True if activation succeeded, False otherwise.
    """
    global _original_record_prediction, _patched

    if _patched and not force:
        return True

    # Skip if backtest mode (don't pollute backtest runs)
    if os.environ.get('V40_2_BACKTEST_MODE') == '1':
        return False

    # Skip if shadow mode not enabled (must be explicit)
    if os.environ.get('CANONICAL_STATE_SHADOW_MODE') != '1' and not force:
        return False

    try:
        # Lazy import to avoid circular dependencies
        sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
        from analyzers.prediction_tracker import PredictionTracker

        # Save original
        _original_record_prediction = PredictionTracker.record_prediction

        # Patch
        PredictionTracker.record_prediction = _shadow_record_prediction

        # Ensure audit table exists
        ensure_audit_table()

        _patched = True
        return True
    except Exception as e:
        # Fail-safe: don't break if patching fails
        print(f'[canonical_state_shadow] activation failed: {e}', file=sys.stderr)
        return False


def deactivate() -> bool:
    """Deactivate shadow mode by restoring original record_prediction.

    Returns:
        True if deactivation succeeded.
    """
    global _original_record_prediction, _patched

    if not _patched:
        return True

    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
        from analyzers.prediction_tracker import PredictionTracker

        PredictionTracker.record_prediction = _original_record_prediction
        _original_record_prediction = None
        _patched = False
        return True
    except Exception:
        return False


def is_active() -> bool:
    """Check if shadow mode is currently active."""
    return _patched


# ═══════════════════════════════════════════════════════════════════════════
# ANALYSIS QUERIES
# ═══════════════════════════════════════════════════════════════════════════

def get_shadow_audits(
    limit: int = 100,
    ticker: Optional[str] = None,
    canonical_state: Optional[str] = None,
    proposed_action: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Read shadow audit records for analysis.

    Args:
        limit: max records to return.
        ticker: filter by ticker (optional).
        canonical_state: filter by canonical state (optional).
        proposed_action: filter by proposed action (optional).
        db_path: path to predictions.db.

    Returns:
        List of audit records as dicts.
    """
    db_path = str(db_path or DEFAULT_SHADOW_DB)
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
        try:
            query = "SELECT * FROM shadow_canonical_state_audit WHERE 1=1"
            params: List[Any] = []
            if ticker:
                query += " AND ticker = ?"
                params.append(ticker)
            if canonical_state:
                query += " AND canonical_state = ?"
                params.append(canonical_state)
            if proposed_action:
                query += " AND proposed_action = ?"
                params.append(proposed_action)
            query += " ORDER BY id DESC LIMIT ?"
            params.append(limit)

            rows = conn.execute(query, params).fetchall()
            cols = [d[0] for d in conn.execute("SELECT * FROM shadow_canonical_state_audit LIMIT 0").description]
            return [dict(zip(cols, r)) for r in rows]
        finally:
            conn.close()
    except Exception:
        return []


def get_shadow_summary(db_path: Optional[str] = None) -> Dict[str, Any]:
    """Get aggregate summary of shadow audits.

    Returns:
        Dict with:
          - total_audits
          - per_canonical_state counts
          - per_proposed_action counts
          - avg_master_score per state
          - missing_canonical_state_count
    """
    db_path = str(db_path or DEFAULT_SHADOW_DB)
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10)
        try:
            total = conn.execute(
                "SELECT COUNT(*) FROM shadow_canonical_state_audit"
            ).fetchone()[0]
            missing = conn.execute(
                "SELECT COUNT(*) FROM shadow_canonical_state_audit WHERE canonical_state IS NULL"
            ).fetchone()[0]

            per_state = conn.execute("""
                SELECT COALESCE(canonical_state, 'NULL') as state, COUNT(*) as cnt, AVG(master_score) as avg_score
                FROM shadow_canonical_state_audit
                GROUP BY canonical_state
                ORDER BY cnt DESC
            """).fetchall()

            per_action = conn.execute("""
                SELECT proposed_action, COUNT(*) as cnt
                FROM shadow_canonical_state_audit
                GROUP BY proposed_action
                ORDER BY cnt DESC
            """).fetchall()

            return {
                'total_audits': total,
                'missing_canonical_state_count': missing,
                'per_canonical_state': [
                    {'state': r[0], 'count': r[1], 'avg_master_score': r[2]}
                    for r in per_state
                ],
                'per_proposed_action': [
                    {'action': r[0], 'count': r[1]} for r in per_action
                ],
            }
        finally:
            conn.close()
    except Exception as e:
        return {'error': str(e)}


if __name__ == '__main__':
    # CLI: print summary
    import json
    print('=== Shadow Mode Audit Summary ===')
    print(f'Active: {is_active()}')
    print()
    summary = get_shadow_summary()
    print(json.dumps(summary, indent=2, default=str))
