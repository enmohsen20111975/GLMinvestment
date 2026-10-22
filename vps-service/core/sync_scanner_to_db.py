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
import json
import logging
import os
import sys
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# SYNC-SCANNER-FIX (2026-10-22): إعادة function sync_scanner_to_stored_analyses
# اللي اتـ remove-ت في commit 854d9b3f (BRAVO-URGENT).
# السبب: daily_predictor.inject_whale_radar_picks() بيستوردها → import error → whale picks = 0.
# الحل: رجّعنا الـ function + احتفظنا بـ purge_stale_predictions + verify_invariants.
_vps_root = str(PROJECT_ROOT / "vps-service")
if _vps_root not in sys.path:
    sys.path.insert(0, _vps_root)


def _get_stock_names(tickers):
    """احصل على أسماء الأسهم (عربي/إنجليزي) من stocks.db."""
    name_map = {}
    if not STOCKS_DB.exists():
        return name_map
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        c = conn.cursor()
        placeholders = ",".join("?" for _ in tickers)
        rows = c.execute(
            f"SELECT ticker, name_ar, name FROM stocks WHERE ticker IN ({placeholders})",
            tickers,
        ).fetchall()
        for r in rows:
            name_map[r[0]] = (r[1] or r[2] or r[0])
        conn.close()
    except Exception as e:
        logger.warning(f"[sync_scanner] Error fetching stock names: {e}")
    return name_map


def sync_scanner_to_stored_analyses(market='EGX'):
    """شغّل Unified Scanner وحقن النتايج في stored_analyses.

    ده الجسر بين محرك الفحص الموحد (Unified Scanner) و قاعدة البيانات المعروضة.
    بيشغل run_market_scanner(market) وياخد الـ opportunities ويكتبها في stored_analyses.

    Returns:
        int: عدد الصفقات اللي اتـ inject-ت في stored_analyses.
    """
    # SYNC-SCANNER-FIX: import محلي عشان لو unified_scanner مش متاح، الـ function ما يقعش
    try:
        from core.unified_scanner import run_market_scanner
    except Exception as import_err:
        logger.error(f"[sync_scanner] Cannot import run_market_scanner: {import_err}")
        return 0

    print(f"[sync_scanner] Running Unified Scanner for {market}...", flush=True)
    try:
        results = run_market_scanner(market_name=market, timeframe='daily')
    except Exception as scan_err:
        logger.error(f"[sync_scanner] Scanner failed: {scan_err}")
        return 0

    print(f"[sync_scanner] Scanner returned {len(results)} opportunities.", flush=True)

    if not results:
        print(f"[sync_scanner] No opportunities from scanner — nothing to inject.", flush=True)
        return 0

    tickers = [r.get('ticker', '') for r in results if r.get('ticker')]
    names = _get_stock_names(tickers)
    now_iso = datetime.now().isoformat()
    today_date = datetime.now().strftime("%Y-%m-%d")

    conn = sqlite3.connect(str(PREDICTIONS_DB))
    c = conn.cursor()

    # 1. إفراغ البيانات القديمة المتجمدة لهذا السوق
    c.execute("DELETE FROM stored_analyses WHERE market = ?", (market,))

    # 2. حقن الصفقات الحية الصادقة فقط
    inserted = 0
    for r in results:
        t = r.get('ticker', '')
        if not t:
            continue
        name_ar = names.get(t, t)
        entry = r.get('entry_price', r.get('current_price', 0))
        target = r.get('target_price')
        tp1 = r.get('tp1_price', round(entry * 1.065, 2) if entry else 0)
        stop = r.get('stop_loss', 0)
        rr = round(r.get('risk_reward', 2.0), 2)
        score = r.get('score', 75)
        signal = r.get('signal', 'BUY')
        track = r.get('track', 'GOLDEN_DIP')

        # Safety: skip لو entry/target/stop ناقصة
        if not entry or not stop or entry <= 0:
            continue

        reason_text = (
            f"سهم ريّح عند الدعم ({track}) — دخول {entry:.2f}، "
            f"بيع نصف الكمية عند {tp1:.2f} (+6.5%)، الوقف {stop:.2f}، "
            f"أقصى مدة 5 أيام كاش."
        )

        analysis_json = {
            "balanced": {
                "verdict": f"شراء تكتيكي ({track})",
                "score": score,
                "reason": reason_text,
                "entry": entry,
                "target": target,
                "tp1": tp1,
                "stop": stop,
                "risk_reward": rr,
                "max_hold_days": 5,
            },
            "gambler": {
                "verdict": f"قاع ارتداد سريع ({track})",
                "score": score,
                "reason": f"صيد قاع — دخول {entry:.2f}، بيع نص الكمية {tp1:.2f}، وقف {stop:.2f}",
                "entry": entry,
                "target": target,
                "tp1": tp1,
                "stop": stop,
                "risk_reward": rr,
            },
            "investor": {
                "verdict": "شراء بقيمة عادلة",
                "score": score,
                "reason": f"سهم في ثلث القاع الرخيص (MLR < 0.50) — هدف {target or 0:.2f}، وقف {stop:.2f}",
                "entry": entry,
                "target": target,
                "stop": stop,
                "risk_reward": rr,
            }
        }

        row_id = f"unified_{t}_{market}"

        try:
            c.execute("""
                INSERT OR REPLACE INTO stored_analyses (
                    id, ticker, market, maestro_score, recommendation, recommendation_ar,
                    confidence, entry_price, target_price, stop_loss, risk_reward,
                    volume_ratio, analysis_json, analysis_type, analysis_version,
                    created_at, updated_at, signal, is_gambler_opportunity,
                    is_investor_opportunity, prediction_date, persona, master_score
                ) VALUES (
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?
                )
            """, (
                row_id, t, market, score, signal, f"شراء ({track})",
                score, entry, target, stop, rr,
                r.get('vol_ratio', 1.0), json.dumps(analysis_json, ensure_ascii=False), 'unified_scanner', '3.0',
                now_iso, now_iso, signal, 1,
                1, today_date, 'balanced', score
            ))
            inserted += 1
        except Exception as row_err:
            logger.warning(f"[sync_scanner] Failed to insert {t}: {row_err}")

    conn.commit()
    conn.close()
    print(f"[sync_scanner] Injected {inserted} live opportunities into stored_analyses", flush=True)
    return inserted


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
