#!/usr/bin/env python3
"""
cleanup_catastrophic.py — مسح التوقعات الكارثية من قاعدة البيانات
==================================================================
بيمسح (أو بـيـأرشف) التوقعات اللي هندستها كارثية واللي الـ geometry guard
كان هيرفضها لو اتولدت دلوقتي. ده بـ يـنظّف الـ legacy pollution اللي سببها
backfill scripts قديمة قبل ما الـ guard يتطبّق.

القواعد (نفس الـ geometry guard بالظبط + R:R أحكم):
  R1: target_price <= entry_price × 1.05   (هدف أقل من 5% — تافه)
  R2: stop_loss   >= entry_price × 0.95    (وقف أقل من 5% — مفيش حماية)
  R3: stop_loss   <= entry_price × 0.93    (وقف أكبر من 7% — خسارة قاتلة)
  R4: target_price >  entry_price × 3.0     (هدف خيالي)
  R5: (target-entry)/(entry-stop) < 2.0    (R:R أقل من 2:1)
  R6: stop_loss >= entry_price             (هندسة معكوسة)
  R7: target_price <= entry_price          (هندسة معكوسة)

الاستخدام:
  # مسح جاف (Dry-run) — بيشوف بس هيمسح إيه من غير ما يمسح
  python3 vps-service/scripts/cleanup_catastrophic.py --dry-run

  # مسح فعلي للتوقعات المعلقة فقط (آمن — مايمسحش اللي اتقفلت)
  python3 vps-service/scripts/cleanup_catastrophic.py

  # مسح شامل (شامل اللي اتقفلت — استخدم بحذر)
  python3 vps-service/scripts/cleanup_catastrophic.py --include-closed

  # مسار DB مخصص
  python3 vps-service/scripts/cleanup_catastrophic.py --db /path/to/predictions.db
"""
import os
import sys
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime


def resolve_db_path(cli_db: str = None) -> str:
    if cli_db:
        return cli_db
    _env_db = os.environ.get('PREDICTIONS_DB')
    if _env_db and Path(_env_db).exists():
        return _env_db
    _project_root = Path(__file__).resolve().parents[2]
    return str(_project_root / 'db' / 'predictions.db')


def find_catastrophic(conn: sqlite3.Connection, include_closed: bool = False) -> dict:
    """بترجع dict بـ IDs مصنّفة حسب السبب."""
    cur = conn.cursor()
    base_where = "signal IN ('BUY','STRONG_BUY','ACCUMULATE')"
    if not include_closed:
        base_where += " AND outcome_date IS NULL"

    # نطبّق نفس الـ geometry guard اللي في prediction_tracker.py بس بشدّاد
    # (R:R < 2.0 بدل 1.5، و stop <= 0.93 بدل 0.90)
    sql = f"""
        SELECT id, ticker, signal, entry_price, target_price, stop_loss,
               persona, status, actual_return, outcome_date,
               CASE
                 WHEN stop_loss >= entry_price OR target_price <= entry_price THEN 'inverted'
                 WHEN (entry_price - stop_loss) <= 0 THEN 'negative_risk'
                 WHEN target_price <= entry_price * 1.05 THEN 'target_too_close'
                 WHEN stop_loss   >= entry_price * 0.95 THEN 'stop_too_tight'
                 WHEN stop_loss   <= entry_price * 0.93 THEN 'stop_too_wide'
                 WHEN target_price >  entry_price * 3.0  THEN 'target_too_far'
                 WHEN (target_price - entry_price) / (entry_price - stop_loss) < 2.0 THEN 'low_rr'
                 ELSE 'ok'
               END AS reason
        FROM predictions
        WHERE {base_where}
    """
    rows = cur.execute(sql).fetchall()

    by_reason = {}
    catastrophic_ids = []
    for r in rows:
        pred_id, ticker, signal, entry, target, stop, persona, status, ret, outcome, reason = r
        if reason == 'ok':
            continue
        catastrophic_ids.append(pred_id)
        by_reason.setdefault(reason, []).append({
            'id': pred_id, 'ticker': ticker, 'signal': signal,
            'entry': entry, 'target': target, 'stop': stop,
            'persona': persona, 'status': status, 'return': ret, 'outcome': outcome,
        })
    return by_reason, catastrophic_ids


def main():
    parser = argparse.ArgumentParser(description='مسح التوقعات الكارثية من DB')
    parser.add_argument('--db', help='مسار قاعدة البيانات', default=None)
    parser.add_argument('--dry-run', action='store_true',
                        help='بس اعرض هتمسح إيه (من غير مسح فعلي)')
    parser.add_argument('--include-closed', action='store_true',
                        help='امسح كمان اللي اتقفلت (افتراضياً بيمسح PENDING فقط)')
    parser.add_argument('--archive', action='store_true',
                        help='بدل ما تمسح، علّم status=rejected + data_quality=toxic')
    parser.add_argument('--yes', action='store_true',
                        help='تأكيد بدون سؤال (للـ automation)')
    args = parser.parse_args()

    db_path = resolve_db_path(args.db)
    print(f"=== CLEANUP CATASTROPHIC PREDICTIONS ===")
    print(f"DB path: {db_path}")
    if not Path(db_path).exists():
        print(f"ERROR: DB file not found: {db_path}")
        sys.exit(1)
    print(f"DB size: {Path(db_path).stat().st_size / 1024 / 1024:.2f} MB")
    print(f"Mode: {'DRY-RUN' if args.dry_run else ('ARCHIVE' if args.archive else 'DELETE')}")
    print(f"Scope: {'ALL (pending + closed)' if args.include_closed else 'PENDING only'}")
    print()

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    # Pre-counts
    total_pre = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    total_buy_pending = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE') "
        "AND outcome_date IS NULL"
    ).fetchone()[0]
    print(f"[PRE] Total predictions: {total_pre}")
    print(f"[PRE] Pending BUY-type:  {total_buy_pending}")
    print()

    by_reason, cat_ids = find_catastrophic(conn, include_closed=args.include_closed)
    print(f"[SCAN] Catastrophic found: {len(cat_ids)}")
    for reason, rows in sorted(by_reason.items(), key=lambda x: -len(x[1])):
        print(f"  {reason:20s} {len(rows):4d}")
    print()

    if not cat_ids:
        print("[OK] لا توقعات كارثية — الـ DB نظيف.")
        conn.close()
        return

    # Sample 10
    print("[SAMPLE] أول 10 كارثية:")
    sample_ids = cat_ids[:10]
    for r in by_reason.get('inverted', [])[:3] + by_reason.get('low_rr', [])[:3] + by_reason.get('stop_too_wide', [])[:4]:
        print(f"  id={r['id']:4d} {r['ticker']:6s} entry={r['entry']:8.2f} "
              f"target={r['target']:8.2f} stop={r['stop']:8.2f} "
              f"return={r['return'] if r['return'] is not None else '-':>6} status={r['status']}")
    print()

    if args.dry_run:
        print(f"[DRY-RUN] لو كنت هـمسح، كنت همسح {len(cat_ids)} صف.")
        print(f"[DRY-RUN] الـ DB بعد المسح المتوقع: {total_pre - len(cat_ids)} صف.")
        conn.close()
        return

    # Confirm
    if not args.yes:
        action = "أرشفة" if args.archive else "مسح"
        resp = input(f"\nمتأكد؟ هـ{action} {len(cat_ids)} توقع كارثي. (y/N): ").strip().lower()
        if resp not in ('y', 'yes'):
            print("[ABORT] تم الإلغاء.")
            conn.close()
            return

    # Backup
    backup_path = f"{db_path}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    print(f"[BACKUP] بنسخ الـ DB لـ {backup_path}")
    import shutil
    shutil.copy2(db_path, backup_path)

    # Execute
    cur = conn.cursor()
    placeholders = ','.join('?' * len(cat_ids))
    if args.archive:
        cur.execute(
            f"UPDATE predictions SET status='rejected', data_quality='toxic', "
            f"updated_at=? WHERE id IN ({placeholders})",
            (datetime.now().isoformat(), *cat_ids)
        )
        affected = cur.rowcount
        conn.commit()
        print(f"[ARCHIVE] تم تأرشفة {affected} توقع كـ rejected/toxic")
    else:
        cur.execute(f"DELETE FROM predictions WHERE id IN ({placeholders})", cat_ids)
        affected = cur.rowcount
        conn.commit()
        print(f"[DELETE] تم مسح {affected} توقع كارثي")

    # Post-counts
    total_post = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    buy_pending_post = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE signal IN ('BUY','STRONG_BUY','ACCUMULATE') "
        "AND outcome_date IS NULL"
    ).fetchone()[0]
    print()
    print(f"[POST] Total predictions: {total_post}  (قبل: {total_pre})")
    print(f"[POST] Pending BUY-type:  {buy_pending_post}  (قبل: {total_buy_pending})")
    print()
    print(f"[DONE] الـ DB دلوقتي نظيف من التوقعات الكارثية.")
    print(f"[BACKUP] النسخة الأصلية محفوظة في: {backup_path}")

    conn.close()


if __name__ == '__main__':
    main()
