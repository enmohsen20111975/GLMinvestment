#!/usr/bin/env python3
"""
Backfill Confidence for existing predictions.
يحسب نسبة الثقة لكل التوقعات الموجودة بناءً على المعطيات المتاحة.
"""
import sqlite3
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')


def _clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def backfill_confidence(force_recalculate: bool = False):
    """إعادة حساب confidence لكل التوقعات.
    
    Args:
        force_recalculate: لو True، يُعيد حساب كل التوقعات (حتى اللي ليها confidence)
    """
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
    cur = conn.cursor()

    # Get predictions to update
    if force_recalculate:
        # Re-calculate ALL predictions (for new calibrated thresholds)
        cur.execute("""
            SELECT id, ticker, signal, signal_type, persona,
                   technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                   risk_reward, explosive_score, explosive_label, master_score,
                   atr_at_entry, entry_price, target_price, stop_loss
            FROM predictions
            LIMIT 50000
        """)
    else:
        # Only NULL or 0 confidence
        cur.execute("""
            SELECT id, ticker, signal, signal_type, persona,
                   technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                   risk_reward, explosive_score, explosive_label, master_score,
                   atr_at_entry, entry_price, target_price, stop_loss
            FROM predictions
            WHERE confidence IS NULL OR confidence = 0
            LIMIT 50000
        """)
    rows = cur.fetchall()
    print(f"Found {len(rows)} predictions to backfill")

    updated = 0
    for row in rows:
        (pred_id, ticker, signal, signal_type, persona,
         tech_score, fund_score, ai_score, sent_score,
         rr, expl_score, expl_label, master_score,
         atr_entry, entry, target, stop) = row

        # Build a synthetic indicator + decision from stored data
        ind = {
            'rsi': 50,  # default
            'ma20': entry or 0,
            'ma50': entry or 0,
            'close': entry or 0,
            'trend': 'NEUTRAL',
            'volume_spike': False,
            'volume_trend': 'stable',
            'volume_ratio': 1.0,
            'atr_pct': ((atr_entry / entry) * 100) if (atr_entry and entry) else 3.0,
            'history_len': 100,
            'quality_flags': [],
            'closes': [entry] * 20 if entry else [],
        }

        decision = {
            'signal': signal or 'HOLD',
            'entry_price': entry or 0,
            'target_price': target or 0,
            'stop_loss': stop or 0,
            'risk_reward': rr or 0,
            'explosive_score': expl_score or 0,
            'explosive_label': expl_label or '',
            'technical_score': tech_score or master_score or 50,
        }

        try:
            from analyzers.confidence_engine import compute_confidence
            result = compute_confidence(ind, decision, persona or 'balanced')
            confidence = result['confidence']
        except Exception as e:
            # Fallback: simple confidence from technical_score
            ts = tech_score or master_score or 50
            confidence = _clamp(ts + 5, 30, 90)

        cur.execute(
            "UPDATE predictions SET confidence = ? WHERE id = ?",
            (round(confidence, 1), pred_id)
        )
        updated += 1
        if updated % 1000 == 0:
            conn.commit()
            print(f"  Updated {updated}/{len(rows)}...")

    conn.commit()
    conn.close()
    print(f"\n✅ Backfilled {updated} predictions with confidence")

    # Verify
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=10.0)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM predictions WHERE confidence IS NOT NULL AND confidence > 0")
    with_conf = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions")
    total = cur.fetchone()[0]
    cur.execute("SELECT AVG(confidence) FROM predictions WHERE confidence > 0")
    avg_conf = cur.fetchone()[0] or 0
    cur.execute("""
        SELECT
            SUM(CASE WHEN confidence >= 75 THEN 1 ELSE 0 END) as top_pick,
            SUM(CASE WHEN confidence >= 60 AND confidence < 75 THEN 1 ELSE 0 END) as strong,
            SUM(CASE WHEN confidence >= 45 AND confidence < 60 THEN 1 ELSE 0 END) as watch,
            SUM(CASE WHEN confidence < 45 THEN 1 ELSE 0 END) as skip
        FROM predictions WHERE confidence > 0
    """)
    tiers = cur.fetchone()
    print(f"\n📊 Confidence Distribution (BACKTEST-CALIBRATED thresholds):")
    print(f"  Total with confidence: {with_conf}/{total}")
    print(f"  Average confidence: {avg_conf:.1f}%")
    print(f"  🔥 TOP_PICK (≥75%): {tiers[0]}")
    print(f"  ⭐ STRONG (60-74%): {tiers[1]}")
    print(f"  👁️ WATCH (45-59%): {tiers[2]}")
    print(f"  ⏭️ SKIP (<45%): {tiers[3]}")
    conn.close()


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'vps-service'))
    # Pass --force to re-calculate ALL predictions (for new calibrated thresholds)
    force = '--force' in sys.argv
    backfill_confidence(force_recalculate=force)
