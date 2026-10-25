#!/usr/bin/env python3
"""
sync_hunter_pick_tracking.py — مزامنة توقعات V40.2 إلى hunter_pick_tracking
================================================================
المشكلة: v40_2_daily_generator.py بيكتب في `predictions` لكن مش بيكتب في `hunter_pick_tracking`.
الحل: نقرأ أحدث توقعات V40.2 من `predictions` ونـ INSERT في `hunter_pick_tracking`.
"""
import sqlite3
import json
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"


def main():
    print("=" * 60)
    print("🔄 مزامنة توقعات V40.2 → hunter_pick_tracking")
    print("=" * 60)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(PREDICTIONS_DB), writable=False).__enter__()
    cur = conn.cursor()

    # 1. اقرأ أحدث 5 توقعات من V40.2 (status='active' OR 'ACTIVE')
    cur.execute("""
        SELECT ticker, persona, entry_price, stop_loss, target_price,
               prediction_date, risk_reward, signal, status
        FROM predictions
        WHERE prediction_date >= '2026-09-01'
          AND status IN ('active', 'ACTIVE')
        ORDER BY id DESC
        LIMIT 20
    """)
    rows = cur.fetchall()
    print(f"📊 Found {len(rows)} active V40.2 predictions since 2026-09-01")

    inserted = 0
    deduped = 0
    failed = 0

    for row in rows:
        ticker, persona, entry_price, stop_loss, target_price, prediction_date, risk_reward, signal, status = row

        # sanity check
        if not all([ticker, entry_price, target_price, stop_loss]):
            print(f"  ⚠️ skip {ticker} — missing fields")
            failed += 1
            continue

        # dedup check
        existing = cur.execute(
            "SELECT id FROM hunter_pick_tracking WHERE ticker = ? AND pick_date = ? LIMIT 1",
            (ticker, prediction_date)
        ).fetchone()
        if existing:
            deduped += 1
            continue

        # calc risk_reward if missing
        rr = risk_reward if risk_reward else (
            (target_price - entry_price) / (entry_price - stop_loss)
            if (entry_price - stop_loss) > 0 else 0
        )

        try:
            cur.execute("""
                INSERT INTO hunter_pick_tracking
                    (ticker, market, entry_price, stop_loss, target_price, risk_reward,
                     pick_date, status, narrative, personas)
                VALUES (?, 'EGX', ?, ?, ?, ?, ?, 'pending', ?, ?)
            """, (
                ticker,
                float(entry_price),
                float(stop_loss),
                float(target_price),
                float(rr),
                prediction_date,
                json.dumps({'source': 'V40.2_sync', 'signal': signal}, ensure_ascii=False),
                json.dumps([persona or 'balanced'], ensure_ascii=False),
            ))
            inserted += 1
            print(f"  ✅ {ticker} @ {entry_price} → target {target_price} (RR={rr:.2f})")
        except Exception as e:
            print(f"  ❌ {ticker} — {e}")
            failed += 1

    conn.commit()
    conn.close()

    print()
    print("=" * 60)
    print(f"📊 Summary: inserted={inserted}, deduped={deduped}, failed={failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
