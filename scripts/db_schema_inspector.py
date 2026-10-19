#!/usr/bin/env python3
"""
db_schema_inspector.py — جلب التركيب المفصل لكل الجداول في أي DB
=====================================================================
سكربت مستقل (مش هيتـ push للـ GitHub). بيـ print:

  1. كل الـ DBs الموجودة في db/ folder.
  2. لكل DB: كل الـ tables + row count + columns + PK + indexes.
  3. لكل table: عينة 2 rows.
  4. ملخص شامل (JSON report).

الاستخدام:
  python3 scripts/db_schema_inspector.py                    # كل الـ DBs
  python3 scripts/db_schema_inspector.py data_engine.db     # DB واحد
  python3 scripts/db_schema_inspector.py --json             # JSON only (no sample rows)

آمن — read-only. ما بـ يـ modifyش أي حاجة.
=====================================================================
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"


def log(msg: str):
    print(msg, flush=True)


def inspect_table(conn, table: str, show_samples: bool = True) -> dict:
    """فحص table واحد."""
    info = {"table": table, "exists": True}

    try:
        # columns
        cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
        info["columns"] = []
        pk_col = None
        for c in cols:
            # c = (cid, name, type, notnull, dflt_value, pk)
            col_info = {
                "name": c[1],
                "type": c[2],
                "notnull": bool(c[3]),
                "default": c[4],
                "pk": bool(c[5]),
            }
            if c[5]:
                pk_col = c[1]
            info["columns"].append(col_info)
        info["pk_column"] = pk_col
        info["column_count"] = len(cols)

        # row count
        cnt = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        info["row_count"] = cnt

        # indexes
        idxs = conn.execute(f"PRAGMA index_list({table})").fetchall()
        info["indexes"] = []
        for idx in idxs:
            # idx = (seq, name, unique, origin, partial)
            idx_info = {"name": idx[1], "unique": bool(idx[2])}
            info["indexes"].append(idx_info)

        # sample rows
        if show_samples and cnt > 0:
            rows = conn.execute(f"SELECT * FROM {table} LIMIT 2").fetchall()
            col_names = [c[1] for c in cols]
            info["sample_rows"] = [dict(zip(col_names, r)) for r in rows]
        else:
            info["sample_rows"] = []

        # CREATE statement
        create_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        info["create_sql"] = create_sql[0] if create_sql else None

    except Exception as e:
        info["error"] = str(e)
        info["exists"] = False

    return info


def inspect_db(db_path: Path, show_samples: bool = True) -> dict:
    """فحص DB واحد كامل."""
    result = {
        "db_name": db_path.name,
        "db_path": str(db_path),
        "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "size_mb": round(db_path.stat().st_size / (1024 * 1024), 2) if db_path.exists() else 0,
        "exists": db_path.exists(),
        "tables": [],
    }

    if not db_path.exists():
        result["error"] = "DB file not found"
        return result

    try:
        conn = sqlite3.connect(str(db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row

        # كل الـ tables
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()

        result["table_count"] = len(tables)

        for (table_name,) in tables:
            table_info = inspect_table(conn, table_name, show_samples)
            result["tables"].append(table_info)

        conn.close()
    except Exception as e:
        result["error"] = str(e)

    return result


def main():
    parser = argparse.ArgumentParser(
        description="جلب التركيب المفصل لكل الجداول في أي DB"
    )
    parser.add_argument(
        "db_name",
        nargs="?",
        default=None,
        help="اسم DB واحد (مثلاً data_engine.db). لو مش موجود، بفحص كل الـ DBs.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="JSON output بس (من غير sample rows)",
    )
    parser.add_argument(
        "--samples",
        action="store_true",
        help="أظهر sample rows (default: True unless --json)",
    )
    args = parser.parse_args()

    show_samples = args.samples and not args.json

    log("=" * 70)
    log("🔍 DB Schema Inspector")
    log(f"DB_DIR: {DB_DIR}")
    log("=" * 70)

    # حدد الـ DBs المطلوب فحصها
    if args.db_name:
        db_path = DB_DIR / args.db_name
        db_paths = [db_path]
    else:
        db_paths = sorted(DB_DIR.glob("*.db"))

    if not db_paths:
        log("❌ مفيش DBs موجودة في db/")
        sys.exit(1)

    log(f"\n📊 DBs اللي هتـ فحص: {len(db_paths)}")
    for p in db_paths:
        log(f"  - {p.name}")
    log("")

    # فحص كل DB
    all_results = []
    for db_path in db_paths:
        log("=" * 70)
        log(f"📁 {db_path.name}")
        log("=" * 70)
        result = inspect_db(db_path, show_samples)
        all_results.append(result)

        if result.get("error"):
            log(f"  ❌ Error: {result['error']}")
            continue

        log(f"  📏 Size: {result['size_mb']} MB")
        log(f"  📋 Tables: {result['table_count']}")
        log("")

        for t in result["tables"]:
            if not t.get("exists"):
                log(f"  ❌ {t['table']}: {t.get('error', 'not found')}")
                continue

            pk = t.get("pk_column") or "(none)"
            log(f"  📊 {t['table']}: {t['row_count']} rows | PK={pk} | {t['column_count']} cols | {len(t['indexes'])} indexes")

            if show_samples:
                # أظهر columns
                cols_str = ", ".join(
                    f"{c['name']}({c['type']}){'[PK]' if c['pk'] else ''}"
                    for c in t["columns"][:8]
                )
                if t["column_count"] > 8:
                    cols_str += f" + {t['column_count'] - 8} more"
                log(f"      cols: {cols_str}")

                # أظهر sample
                if t["sample_rows"]:
                    for i, row in enumerate(t["sample_rows"][:1]):
                        # truncate long values
                        sample_str = ", ".join(
                            f"{k}={str(v)[:50]}" for k, v in list(row.items())[:5]
                        )
                        log(f"      sample[{i}]: {sample_str}")
        log("")

    # JSON report
    report = {
        "inspector": "db_schema_inspector",
        "timestamp": datetime.now().isoformat(),
        "db_dir": str(DB_DIR),
        "db_count": len(all_results),
        "dbs": all_results,
    }

    report_file = DB_DIR.parent / "scripts" / "output" / f"db_schema_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)

    log("=" * 70)
    log(f"📄 Full JSON report: {report_file}")
    log("=" * 70)

    # ملخص سريع
    log("\n📋 ملخص:")
    for r in all_results:
        if r.get("error"):
            log(f"  ❌ {r['db_name']}: {r['error']}")
        else:
            total_rows = sum(t.get("row_count", 0) for t in r["tables"] if t.get("exists"))
            log(f"  ✅ {r['db_name']}: {r['table_count']} tables, {total_rows} total rows, {r['size_mb']} MB")


if __name__ == "__main__":
    main()
