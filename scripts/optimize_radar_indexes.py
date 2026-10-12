#!/usr/bin/env python3
"""
optimize_radar_indexes.py — DB Optimization for radar_signal_tracking
=====================================================================
Task TITAN-HEAVY-PUMP-3-DB-OPTIMIZATION

يضيف فهرس مركب (composite index) على (status, signal_date, ticker)
لتسريع استعلامات الرادار إلى أجزاء من الثانية.

Idempotent — يستخدم CREATE INDEX IF NOT EXISTS.
لا يحذف أي index موجود (Rule 1 — VERIFY-BEFORE-DELETE).
"""
import sys
import sqlite3
import time
from pathlib import Path

# المسار إلى قاعدة البيانات المعتمدة (db/stocks.db)
DB_PATH = Path(__file__).resolve().parent.parent / 'db' / 'stocks.db'

# اسم الفهرس المركب الجديد
COMPOSITE_INDEX_NAME = 'idx_radar_sig_status_date_ticker'

# تعريف الفهرس المركب — يغطي أكثر أنماط الاستعلام شيوعًا على الرادار
# (تصفية حسب status + ترتيب زمني + تمييز بالـ ticker).
# CREATE INDEX IF NOT EXISTS يضمن الـ idempotency.
COMPOSITE_INDEX_SQL = f"""
CREATE INDEX IF NOT EXISTS {COMPOSITE_INDEX_NAME}
ON radar_signal_tracking(status, signal_date, ticker)
"""


def list_indexes(conn):
    """قائمة الفهارس الحالية على radar_signal_tracking."""
    return conn.execute("""
        SELECT name, sql FROM sqlite_master
        WHERE type='index' AND tbl_name='radar_signal_tracking'
        ORDER BY name
    """).fetchall()


def benchmark_query(conn, label: str, n_runs: int = 5) -> float:
    """
    قياس زمن استعلام تجريبي شائع على الرادار.

    الاستعلام يجمع الإشارات المصنّفة verified_win منذ 2026-09-01
    مع ترتيب زمني تنازلي ثم حسب ticker — وهو نمط شائع في لوحات
    الـ Radar UI والتقارير الأسبوعية.
    """
    query = """
        SELECT ticker, signal_date, status, entry_price
        FROM radar_signal_tracking
        WHERE status = 'verified_win' AND signal_date >= '2026-09-01'
        ORDER BY signal_date DESC, ticker
    """
    times = []
    for _ in range(n_runs):
        t0 = time.perf_counter()
        conn.execute(query).fetchall()
        times.append(time.perf_counter() - t0)
    avg_ms = (sum(times) / len(times)) * 1000
    print(f"  [{label}] avg time over {n_runs} runs: {avg_ms:.3f} ms")
    return avg_ms


def main():
    """نقطة الدخول الرئيسية للسكريبت."""
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    # فتح اتصال بقاعدة البيانات (read-write لإضافة الفهرس)
    conn = sqlite3.connect(str(DB_PATH))

    print("=" * 60)
    print("DB Optimization: radar_signal_tracking composite index")
    print("=" * 60)

    # 1) الفهارس قبل الإضافة — للتحقق وعدم تكرار أي فهرس موجود
    print("\n=== Indexes BEFORE ===")
    before_indexes = list_indexes(conn)
    for name, sql in before_indexes:
        print(f"  {name}")
    if not before_indexes:
        print("  (لا توجد فهارس على الجدول)")

    # 2) قياس الأداء قبل إضافة الفهرس
    print("\n=== Benchmark BEFORE ===")
    before_ms = benchmark_query(conn, "BEFORE")

    # 3) إضافة الفهرس المركب (idempotent — آمن لإعادة التشغيل)
    print(f"\n=== Adding composite index: {COMPOSITE_INDEX_NAME} ===")
    conn.execute(COMPOSITE_INDEX_SQL)
    conn.commit()
    print(f"  ✓ Index created (idempotent — safe to re-run)")

    # 4) الفهارس بعد الإضافة — يجب أن يظهر الفهرس الجديد
    print("\n=== Indexes AFTER ===")
    after_indexes = list_indexes(conn)
    for name, sql in after_indexes:
        print(f"  {name}")

    # 5) قياس الأداء بعد إضافة الفهرس
    print("\n=== Benchmark AFTER ===")
    after_ms = benchmark_query(conn, "AFTER")

    # 6) ملخص التحسن
    improvement = before_ms - after_ms
    improvement_pct = (improvement / before_ms * 100) if before_ms > 0 else 0
    print(f"\n=== SUMMARY ===")
    print(f"  Before:  {before_ms:.3f} ms")
    print(f"  After:   {after_ms:.3f} ms")
    print(f"  Improvement: {improvement:.3f} ms ({improvement_pct:.1f}% faster)")
    print(f"  New index added: {COMPOSITE_INDEX_NAME}")
    print(f"  Total indexes on table: {len(before_indexes)} → {len(after_indexes)}")

    conn.close()
    print("\n[done] DB optimization complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
