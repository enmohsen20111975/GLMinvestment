#!/usr/bin/env python3
"""
Diagnostic script — لماذا 0 predictions؟
شغل ده على الابتوب: python3 -m learning_engine.cli.diagnose_predictions
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from learning_engine.adapters.predictions_adapter import PredictionsAdapter

def main():
    pa = PredictionsAdapter()

    print("=" * 60)
    print("Diagnostic: predictions.db")
    print("=" * 60)

    # 1. هل DB موجود؟
    print(f"\n[1] DB path: {pa.db_path}")
    print(f"    exists: {pa.db_path.exists()}")
    if not pa.db_path.exists():
        print("    ❌ predictions.db NOT FOUND")
        print("    حل: ضع predictions.db في مجلد db/ أو:")
        print("    export PREDICTIONS_DB_PATH=/path/to/predictions.db")
        return

    print(f"    size: {pa.db_path.stat().st_size / 1024 / 1024:.1f} MB")

    # 2. هل table موجودة؟
    import sqlite3
    conn = sqlite3.connect(f"file:{pa.db_path}?mode=ro", uri=True)
    cur = conn.cursor()

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%predict%'")
    tables = [r[0] for r in cur.fetchall()]
    print(f"\n[2] prediction tables: {tables}")

    if "predictions" not in tables:
        print("    ❌ 'predictions' table NOT FOUND")
        conn.close()
        return

    # 3. عدد الصفوف
    cur.execute("SELECT COUNT(*) FROM predictions")
    total = cur.fetchone()[0]
    print(f"\n[3] total predictions: {total:,}")

    # 4. كم resolved؟
    cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
    resolved = cur.fetchone()[0]
    print(f"    resolved (outcome_date IS NOT NULL): {resolved:,}")

    # 5. ما هي الأعمدة الموجودة؟
    cur.execute("PRAGMA table_info(predictions)")
    cols = [r[1] for r in cur.fetchall()]
    print(f"\n[4] columns ({len(cols)}): {cols[:20]}")
    if len(cols) > 20:
        print(f"    ... +{len(cols)-20} more: {cols[20:]}")

    # 6. ما هي الـ markets الموجودة؟
    if "market" in cols:
        cur.execute("SELECT market, COUNT(*) FROM predictions GROUP BY market ORDER BY COUNT(*) DESC")
        markets = cur.fetchall()
        print(f"\n[5] markets in predictions:")
        for m in markets:
            print(f"    '{m[0]}': {m[1]:,}")

        cur.execute("SELECT market, COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY market")
        resolved_markets = cur.fetchall()
        print(f"\n[6] markets in RESOLVED predictions:")
        for m in resolved_markets:
            print(f"    '{m[0]}': {m[1]:,}")
    else:
        print("\n[5] ❌ NO 'market' column in predictions table!")
        print("    الكود بـ يفلتر بـ market لكن الجدول مش فيه العمود ده")

    # 7. عينة 5 صفوف
    print(f"\n[7] sample 5 predictions:")
    cur.execute(f"SELECT {', '.join(cols[:10])} FROM predictions LIMIT 5")
    for r in cur.fetchall():
        print(f"    {r}")

    # 8. عينة 5 resolved
    if resolved > 0:
        print(f"\n[8] sample 5 RESOLVED predictions:")
        cur.execute(f"SELECT {', '.join(cols[:10])} FROM predictions WHERE outcome_date IS NOT NULL LIMIT 5")
        for r in cur.fetchall():
            print(f"    {r}")

    # 9. فحص persona column (لو موجود)
    if "persona" in cols:
        cur.execute("SELECT persona, COUNT(*) FROM predictions GROUP BY persona")
        personas = cur.fetchall()
        print(f"\n[9] persona distribution:")
        for p in personas:
            print(f"    '{p[0]}': {p[1]:,}")

    conn.close()

    # 10. التشخيص
    print(f"\n{'='*60}")
    print("DIAGNOSIS")
    print(f"{'='*60}")

    if total == 0:
        print("❌ predictions table is EMPTY — no data to train on")
    elif resolved == 0:
        print("❌ NO resolved predictions (outcome_date all NULL)")
        print("   daily_closer.py needs to run to resolve outcomes")
    elif resolved < 50:
        print(f"⚠️  Only {resolved} resolved predictions (< 50 minimum)")
        print("   Try: --min-samples 10")
    else:
        # فحص EGX تحديدًا
        conn = sqlite3.connect(f"file:{pa.db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM predictions WHERE market = 'EGX' AND outcome_date IS NOT NULL")
        egx_resolved = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL")
        all_resolved = cur.fetchone()[0]
        conn.close()

        if egx_resolved == 0 and all_resolved > 0:
            print(f"❌ EGX has 0 resolved, but total resolved = {all_resolved}")
            print("   market column might have different values (not 'EGX')")
            print("   Check [5] above for actual market values")
        else:
            print(f"✅ {egx_resolved} EGX resolved predictions available")
            print("   The issue might be in feature building or label building")
            print("   Run: python3 -m learning_engine.cli.prepare_dataset --label-type direction --horizon 5 --market EGX")


if __name__ == "__main__":
    main()
