"""
decision_log.py — Audit trail for every trading decision.
==========================================================
Records: execution_id, timestamp, ticker, plan, engine_results,
final_signal, master_score, risk_profile, code_version, warnings.

This module is READ-ONLY on production DBs — it writes to a separate
log DB (db/decision_log.db) that doesn't affect trading logic.
"""
from __future__ import annotations
import sqlite3, json, uuid, os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
LOG_DB = str(PROJECT_ROOT / 'db' / 'decision_log.db')

def _ensure_log_db():
    """Create the decision log DB if it doesn't exist."""
    os.makedirs(os.path.dirname(LOG_DB), exist_ok=True)
    c = sqlite3.connect(LOG_DB)
    c.execute("""
        CREATE TABLE IF NOT EXISTS decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            execution_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            ticker TEXT NOT NULL,
            plan_id TEXT,
            market_state TEXT,
            selected_engines TEXT,
            skipped_engines TEXT,
            engine_results TEXT,
            final_signal TEXT,
            master_score REAL,
            risk_profile TEXT,
            code_version TEXT,
            config_version TEXT,
            warnings TEXT,
            errors TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_dl_ticker ON decision_log(ticker)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_dl_signal ON decision_log(final_signal)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_dl_timestamp ON decision_log(timestamp)")
    c.commit()
    c.close()

def log_decision(
    ticker: str,
    plan_id: str = '',
    market_state: str = 'unknown',
    selected_engines: List[str] = None,
    skipped_engines: List[Dict] = None,
    engine_results: Dict = None,
    final_signal: str = 'NO_TRADE',
    master_score: float = 0.0,
    risk_profile: Dict = None,
    code_version: str = '',
    config_version: str = '',
    warnings: List[str] = None,
    errors: List[str] = None,
) -> str:
    """Log a trading decision. Returns execution_id."""
    _ensure_log_db()
    execution_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()
    
    c = sqlite3.connect(LOG_DB)
    c.execute("""
        INSERT INTO decision_log (
            execution_id, timestamp, ticker, plan_id, market_state,
            selected_engines, skipped_engines, engine_results,
            final_signal, master_score, risk_profile,
            code_version, config_version, warnings, errors
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        execution_id, timestamp, ticker, plan_id, market_state,
        json.dumps(selected_engines or []),
        json.dumps(skipped_engines or []),
        json.dumps(engine_results or {}),
        final_signal, master_score,
        json.dumps(risk_profile or {}),
        code_version, config_version,
        json.dumps(warnings or []),
        json.dumps(errors or []),
    ))
    c.commit()
    c.close()
    return execution_id

def get_decision(execution_id: str) -> Optional[Dict]:
    """Retrieve a decision by execution_id."""
    if not os.path.exists(LOG_DB):
        return None
    c = sqlite3.connect(f'file:{LOG_DB}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    cur = c.cursor()
    cur.execute("SELECT * FROM decision_log WHERE execution_id = ?", (execution_id,))
    row = cur.fetchone()
    c.close()
    if not row:
        return None
    result = dict(row)
    for k in ['selected_engines', 'skipped_engines', 'engine_results', 'risk_profile', 'warnings', 'errors']:
        if result.get(k):
            try:
                result[k] = json.loads(result[k])
            except:
                pass
    return result

def get_recent_decisions(limit: int = 10) -> List[Dict]:
    """Get recent decisions."""
    if not os.path.exists(LOG_DB):
        return []
    c = sqlite3.connect(f'file:{LOG_DB}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    cur = c.cursor()
    cur.execute("SELECT * FROM decision_log ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    c.close()
    return rows

def count_decisions() -> int:
    """Count total logged decisions."""
    if not os.path.exists(LOG_DB):
        return 0
    c = sqlite3.connect(f'file:{LOG_DB}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute("SELECT COUNT(*) FROM decision_log")
    n = cur.fetchone()[0]
    c.close()
    return n
