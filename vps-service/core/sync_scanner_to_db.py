"""
core/sync_scanner_to_db.py — تطهير التوصيات الميتة + ضمان الثوابت الرياضية
=========================================================================
**BRAVO-URGENT**: purge stale predictions + enforce math invariants.

1. Stale Purge: أي صفقة BUY أقدم من 48 ساعة → status = 'STOPPED_OUT'
2. Stop Violation: أي صفقة stop_loss >= entry_price → status = 'STOPPED_OUT'
3. Low RR: أي صفقة R/R < 1.5 → status = 'STOPPED_OUT'
4. stored_analyses: أي صفقة BUY + stop >= entry → delete from active

Usage:
    python3 vps-service/core/sync_scanner_to_db.py
    # or
    from core.sync_scanner_to_db import purge_stale_predictions
    purged = purge_stale_predictions()
"""
from __future__ import annotations

import sqlite3
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'


def purge_stale_predictions(db_path: Path = None) -> dict:
    """تطهير التوصيات الميتة القديمة + ضمان الثوابت الرياضية.

    Returns:
        dict: {stale_48h, stop_violation, low_rr, sa_violations, total_purged}
    """
    if db_path is None:
        db_path = PREDICTIONS_DB

    if not db_path.exists():
        logger.error(f"DB not found: {db_path}")
        return {'error': 'DB not found'}

    conn = sqlite3.connect(str(db_path), timeout=30.0)
    cur = conn.cursor()
    stats = {}

    # 1. Stale Purge: BUY predictions older than 48h → STOPPED_OUT
    stale_count = cur.execute("""
        UPDATE predictions SET 
            status = 'STOPPED_OUT',
            exit_type = 'STALE_PURGE_48H',
            outcome_date = datetime('now'),
            updated_at = datetime('now')
        WHERE signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
        AND status = 'testing'
        AND created_at < datetime('now', '-2 days')
    """).rowcount
    stats['stale_48h'] = stale_count
    logger.info(f"Stale purge (48h): {stale_count} predictions → STOPPED_OUT")

    # 2. Stop Violation: stop_loss >= entry_price → STOPPED_OUT
    stop_violation = cur.execute("""
        UPDATE predictions SET 
            status = 'STOPPED_OUT',
            exit_type = 'STOP_VIOLATION',
            outcome_date = datetime('now'),
            updated_at = datetime('now')
        WHERE signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
        AND status = 'testing'
        AND stop_loss IS NOT NULL 
        AND entry_price IS NOT NULL
        AND stop_loss >= entry_price
    """).rowcount
    stats['stop_violation'] = stop_violation
    logger.info(f"Stop violation (stop >= entry): {stop_violation} predictions → STOPPED_OUT")

    # 3. Low RR: R/R < 1.5 → STOPPED_OUT (Rule: R/R >= 1.5 mandatory)
    low_rr = cur.execute("""
        UPDATE predictions SET 
            status = 'STOPPED_OUT',
            exit_type = 'LOW_RR_PURGE',
            outcome_date = datetime('now'),
            updated_at = datetime('now')
        WHERE signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
        AND status = 'testing'
        AND risk_reward IS NOT NULL
        AND risk_reward < 1.5
    """).rowcount
    stats['low_rr'] = low_rr
    logger.info(f"Low RR purge (<1.5): {low_rr} predictions → STOPPED_OUT")

    # 4. stored_analyses: BUY + stop >= entry → mark as stale
    sa_violations = cur.execute("""
        UPDATE stored_analyses SET 
            recommendation = 'STALE',
            recommendation_ar = 'توصية ميتة — تجاهل'
        WHERE recommendation LIKE '%BUY%' 
        AND stop_loss IS NOT NULL
        AND entry_price IS NOT NULL
        AND stop_loss >= entry_price
    """).rowcount
    stats['sa_violations'] = sa_violations
    logger.info(f"stored_analyses violations: {sa_violations} → STALE")

    # 5. stored_analyses: BUY + R/R < 1.5 → mark as stale
    sa_low_rr = cur.execute("""
        UPDATE stored_analyses SET 
            recommendation = 'STALE',
            recommendation_ar = 'مخاطرة عالية — تجاهل'
        WHERE recommendation LIKE '%BUY%' 
        AND risk_reward IS NOT NULL
        AND risk_reward < 1.5
    """).rowcount
    stats['sa_low_rr'] = sa_low_rr
    logger.info(f"stored_analyses low RR: {sa_low_rr} → STALE")

    conn.commit()

    # 6. Verification query (the mandatory proof)
    remaining_violations = cur.execute("""
        SELECT COUNT(*) FROM stored_analyses 
        WHERE recommendation LIKE '%BUY%' 
        AND stop_loss IS NOT NULL
        AND entry_price IS NOT NULL
        AND stop_loss >= entry_price
    """).fetchone()[0]
    stats['remaining_violations'] = remaining_violations
    stats['total_purged'] = stale_count + stop_violation + low_rr + sa_violations + sa_low_rr

    # Also purge old low_rr from closed predictions (historical cleanup)
    historical_low_rr = cur.execute("""
        UPDATE predictions SET 
            exit_type = COALESCE(exit_type, 'LOW_RR_HISTORICAL')
        WHERE signal IN ('BUY', 'STRONG_BUY')
        AND status IN ('CLOSED', 'STOPPED')
        AND risk_reward IS NOT NULL
        AND risk_reward < 1.5
        AND exit_type IS NULL
    """).rowcount
    stats['historical_low_rr'] = historical_low_rr

    conn.close()
    logger.info(f"Total purged: {stats['total_purged']} | Remaining violations: {remaining_violations}")
    return stats


def verify_invariants(db_path: Path = None) -> dict:
    """التحقق من الثوابت الرياضية — النتيجة الحتمية: 0 صفوف.

    Returns:
        dict: {buy_stop_violations, buy_low_rr, total_active_buy, proof_query_result}
    """
    if db_path is None:
        db_path = PREDICTIONS_DB

    if not db_path.exists():
        return {'error': 'DB not found'}

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = conn.cursor()

    # The mandatory proof query
    proof = cur.execute("""
        SELECT COUNT(*) FROM stored_analyses 
        WHERE recommendation LIKE '%BUY%' 
        AND stop_loss >= entry_price
    """).fetchone()[0]

    # Additional checks
    buy_stop = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY')
        AND status = 'testing'
        AND stop_loss >= entry_price
    """).fetchone()[0]

    buy_low_rr = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY')
        AND status = 'testing'
        AND risk_reward < 1.5
    """).fetchone()[0]

    total_active = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY')
        AND status = 'testing'
    """).fetchone()[0]

    conn.close()
    return {
        'proof_query_result': proof,  # MUST be 0
        'buy_stop_violations': buy_stop,
        'buy_low_rr': buy_low_rr,
        'total_active_buy': total_active,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("BRAVO — Stale Purge + Invariant Enforcement")
    print("=" * 60)

    stats = purge_stale_predictions()
    print(f"\n--- Purge Results ---")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    print(f"\n--- Verification ---")
    verification = verify_invariants()
    for k, v in verification.items():
        status = "✅" if (k == 'proof_query_result' and v == 0) else ""
        print(f"  {k}: {v} {status}")

    if verification.get('proof_query_result') == 0:
        print(f"\n✅ PROOF PASSED: 0 rows with stop >= entry in BUY recommendations")
    else:
        print(f"\n❌ PROOF FAILED: {verification.get('proof_query_result')} violations remain")
