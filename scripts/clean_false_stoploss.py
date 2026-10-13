#!/usr/bin/env python3
"""
clean_false_stoploss.py — تنظيف صفقات القاع الشاذ (low=0.00) والتواريخ المستحيلة
=================================================================================
Task B-17 (Owner Directive 2026-10-14)

المشكلة المرصودة:
  - 50 صفقة مغلقة بـ lowest_price_reached = 0.00 → قيعان شاذة قفلت الصفقات ظلمًا
  - 54 صفقة مغلقة بـ outcome_date < prediction_date (تواريخ مستحيلة)
  - نتيجة: win_rate = 7.4% (وهمية) + avg_return = -6.48% (مسمومة بالقيعان الشاذة)

المنطق:
  1. أي صفقة بـ outcome_date < prediction_date = بيانات فاسدة (tracker مكسور)
  2. أي صفقة بـ lowest_price_reached = 0 أثناء فترة التتبع = قاع شاذ
  3. لا يمكن إنقاذ تاريخ مغلق من بيانات بتواريخ مستحيلة → حذف نهائي
  4. الاحتفاظ بالصفقات النشطة الصحيحة فقط (outcome_date IS NULL)

القواعد المحترمة:
  - Rule 27 (NO-FAKE-DATA): حذف البيانات الفاسدة بدل تركها تعرض نسب نجاح وهمية
  - Rule 20 (PYTHON=BRAIN): كل المنطق هنا Python
  - Idempotent: يمكن تشغيله多次 без أضرار

Usage:
    python3 scripts/clean_false_stoploss.py              # تقرير + تنظيف
    python3 scripts/clean_false_stoploss.py --dry-run    # تقرير فقط بدون تعديل
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="تنظيف صفقات القاع الشاذ والتواريخ المستحيلة")
    parser.add_argument("--dry-run", action="store_true", help="تقرير فقط بدون تعديل الـ DB")
    args = parser.parse_args()

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 1

    log("=" * 70)
    log("🧹 منظّف صفقات القاع الشاذ — False Stop-Loss Cleaner")
    log("=" * 70)
    log(f"Mode: {'🔍 DRY-RUN' if args.dry_run else '⚡ EXECUTE (DELETE corrupted rows)'}")
    log("")

    # نسخة احتياطية قبل أي تعديل
    if not args.dry_run:
        backup_path = STOCKS_DB.parent / "backups" / f"stocks_db_before_cleanup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.copy2(STOCKS_DB, backup_path)
        log(f"💾 نسخة احتياطية: {backup_path.name}", "OK")

    con = sqlite3.connect(str(STOCKS_DB))
    cur = con.cursor()

    # 1. إحصاء الوضع الراهن
    cur.execute("SELECT COUNT(*) FROM predictions")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
    closed = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL")
    active = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND outcome_date < prediction_date")
    impossible_dates = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND (lowest_price_reached = 0 OR lowest_price_reached IS NULL)")
    zero_lows = cur.fetchone()[0]

    log("📊 الوضع الراهن قبل التنظيف:")
    log(f"  إجمالي الصفقات: {total}")
    log(f"  مغلقة: {closed}")
    log(f"  نشطة: {active}")
    log(f"  بتواريخ مستحيلة (outcome < prediction): {impossible_dates}")
    log(f"  بقيعان شاذة (lowest=0): {zero_lows}")
    log("")

    # 2. تحديد الصفقات الفاسدة (تواريخ مستحيلة = tracker مكسور)
    cur.execute("""
        SELECT id, ticker, prediction_date, outcome_date, entry_price, stop_loss,
               lowest_price_reached, hit_stop, actual_return
        FROM predictions
        WHERE outcome_date IS NOT NULL
          AND outcome_date < prediction_date
        ORDER BY id
    """)
    corrupted = cur.fetchall()
    corrupted_ids = [r[0] for r in corrupted]

    log(f"🗑️ صفقات فاسدة للتأهل للحذف (تواريخ مستحيلة): {len(corrupted_ids)}")
    for r in corrupted[:10]:
        log(f"  id={r[0]} {r[1]:8} pred={r[2]} outcome={r[3]} entry={r[4]:.2f} stop={r[5]:.2f} lowest={r[6]} hit_stop={r[7]} ret={r[8]}")
    if len(corrupted_ids) > 10:
        log(f"  ... و {len(corrupted_ids) - 10} صفقة أخرى")
    log("")

    # 3. فحص: هل أي من الصفقات الفاسدة له تاريخ صحيح ممكن إنقاذه؟
    #    معيار الإنقاذ: outcome_date >= prediction_date AND lowest_price_reached > 0 AND exit_price > 0
    cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE outcome_date IS NOT NULL
          AND outcome_date >= prediction_date
          AND lowest_price_reached > 0
          AND exit_price > 0
    """)
    salvageable = cur.fetchone()[0]
    log(f" salvageable (تاريخ صحيح + بيانات كاملة): {salvageable}")

    # 4. تنفيذ الحذف
    deleted = 0
    if not args.dry_run and corrupted_ids:
        # حذف على دفعات (batch) لتجنب SQLite parameter limit
        batch = 500
        for i in range(0, len(corrupted_ids), batch):
            chunk = corrupted_ids[i:i + batch]
            placeholders = ",".join(["?" for _ in chunk])
            cur.execute(f"DELETE FROM predictions WHERE id IN ({placeholders})", chunk)
            deleted += cur.rowcount
        con.commit()
        log(f"✅ تم حذف {deleted} صفقة فاسدة", "OK")
    elif args.dry_run:
        log("ℹ️ DRY-RUN — لم يتم حذف شيء. أعد التشغيل بدون --dry-run للتنفيذ.", "WARN")
        deleted = 0

    # 5. إزالة التكرارات في الصفقات النشطة (نفس ticker + نفس prediction_date)
    cur.execute("""
        SELECT ticker, prediction_date, COUNT(*) as cnt
        FROM predictions
        WHERE outcome_date IS NULL
        GROUP BY ticker, prediction_date
        HAVING cnt > 1
    """)
    dup_groups = cur.fetchall()
    dedup_deleted = 0
    if dup_groups and not args.dry_run:
        for ticker, pdate, cnt in dup_groups:
            # احتفظ بأقل id (الأقدم)، احذف الباقي
            cur.execute("""
                DELETE FROM predictions
                WHERE rowid IN (
                    SELECT rowid FROM predictions
                    WHERE ticker = ? AND prediction_date = ? AND outcome_date IS NULL
                    ORDER BY id ASC
                    LIMIT -1 OFFSET 1
                )
            """, (ticker, pdate))
            dedup_deleted += cur.rowcount
        con.commit()
        log(f"✅ تم حذف {dedup_deleted} صفقة مكررة نشطة", "OK")

    # 6. الإحصاء النهائي
    cur.execute("SELECT COUNT(*) FROM predictions")
    final_total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
    final_closed = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL")
    final_active = cur.fetchone()[0]

    # Win rate النهائي
    cur.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) as wins,
               ROUND(AVG(actual_return), 2) as avg_ret
        FROM predictions WHERE outcome_date IS NOT NULL
    """)
    wr_row = cur.fetchone()
    win_rate = round((wr_row[1] / wr_row[0] * 100), 1) if wr_row[0] > 0 else 0.0

    log("")
    log("=" * 70)
    log("📊 الوضع النهائي بعد التنظيف:")
    log(f"  إجمالي الصفقات: {final_total} (كان {total})")
    log(f"  مغلقة (موثقة): {final_closed} (كان {closed})")
    log(f"  نشطة: {final_active} (كان {active})")
    log(f"  Win Rate النهائي: {win_rate}% (من {final_closed} صفقة مغلقة صحيحة)")
    log(f"  Avg Return النهائي: {wr_row[2]}%")
    log(f"  صفقات فاسدة محذوفة: {deleted}")
    log(f"  صفقات مكررة محذوفة: {dedup_deleted}")
    log("=" * 70)

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
