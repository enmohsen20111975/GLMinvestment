#!/usr/bin/env python3
"""Full DB inventory for FULL-DB-INVENTORY-1."""
import sqlite3, os, json, sys

DB_DIR = "/home/z/my-project/db"

REQUESTED = [
    "stocks.db", "data_engine.db", "price_history.db", "predictions.db",
    "auth.db", "news.db", "intraday.db", "historical.db", "crypto.db",
    "metrics.db", "paper_trading.db", "decision_log.db", "community.db",
    "market.db", "crypto_learning.db", "egypt_stocks.db", "unified_stocks.db",
    "gold_prices.db", "bot-link.db", "custom.db",
]

def human(n):
    for u in ["B","KB","MB","GB"]:
        if n < 1024:
            return f"{n:.1f}{u}"
        n /= 1024
    return f"{n:.1f}TB"

def get_pk_unique(conn, table):
    pk_cols = []
    try:
        cur = conn.execute(f"PRAGMA table_info('{table}')")
        rows = cur.fetchall()
        pk_cols = [r[1] for r in rows if r[5]]
    except Exception as e:
        pk_cols = [f"ERR:{e}"]
    uniques = []
    try:
        cur = conn.execute(f"PRAGMA index_list('{table}')")
        for idx_row in cur.fetchall():
            if idx_row[2] == 1:
                idx_name = idx_row[1]
                origin = idx_row[3]
                cols_cur = conn.execute(f"PRAGMA index_info('{idx_name}')")
                cols = [c[2] for c in cols_cur.fetchall()]
                uniques.append(f"{'U' if origin=='u' else 'c'}:({','.join(cols)})")
    except Exception:
        pass
    return pk_cols, uniques

def table_info(conn, table):
    cur = conn.execute(f"PRAGMA table_info('{table}')")
    cols = []
    for r in cur.fetchall():
        cols.append(f"{r[1]}:{r[2]}{'* ' if r[5] else ''}{'+ ' if r[3] else ''}")
    return cols

def sample_rows(conn, table, n=3):
    try:
        cur = conn.execute(f'SELECT * FROM "{table}" LIMIT {n}')
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        out = []
        for r in rows:
            d = {}
            for c, v in zip(cols, r):
                if v is None:
                    d[c] = "NULL"
                elif isinstance(v, (int, float)):
                    d[c] = v
                elif isinstance(v, bytes):
                    d[c] = f"<BLOB {len(v)}B>"
                else:
                    s = str(v)
                    if len(s) > 80:
                        s = s[:77] + "..."
                    d[c] = s
            out.append(d)
        return out
    except Exception as e:
        return [f"ERR: {e}"]

def count_rows(conn, table):
    try:
        cur = conn.execute(f'SELECT COUNT(*) FROM "{table}"')
        return cur.fetchone()[0]
    except Exception as e:
        return f"ERR:{e}"

def inspect_db(path):
    info = {"path": path, "size": human(os.path.getsize(path)),
            "size_bytes": os.path.getsize(path),
            "tables": []}
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except Exception as e:
        info["error"] = f"OPEN ERR: {e}"
        return info
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [r[0] for r in cur.fetchall() if not r[0].startswith("sqlite_")]
        info["table_count"] = len(tables)
        for t in tables:
            ti = {"name": t, "count": count_rows(conn, t),
                  "columns": table_info(conn, t)}
            pk, uq = get_pk_unique(conn, t)
            ti["pk"] = pk
            ti["unique"] = uq
            ti["sample"] = sample_rows(conn, t, 3)
            info["tables"].append(ti)
    except Exception as e:
        info["error"] = f"INSPECT ERR: {e}"
    finally:
        conn.close()
    return info

def main():
    print("="*80)
    print("FULL-DB-INVENTORY-1 — Full DB Inventory")
    print("="*80)
    print(f"\nDB DIR: {DB_DIR}\n")
    print("REQUESTED DBs (20):")
    for name in REQUESTED:
        path = os.path.join(DB_DIR, name)
        if os.path.exists(path):
            sz = os.path.getsize(path)
            print(f"  [OK] {name:<25} {human(sz):>10}  ({sz} bytes)")
        else:
            print(f"  [MISS] {name:<25} NOT FOUND")
    print()

    existing = [n for n in REQUESTED if os.path.exists(os.path.join(DB_DIR, n))]
    extras = []
    for f in os.listdir(DB_DIR):
        if f.endswith(".db") and f not in REQUESTED:
            extras.append(f)
    if extras:
        print(f"[!] EXTRA .db files in DB_DIR not in requested list: {extras}\n")

    results = []
    for name in existing:
        path = os.path.join(DB_DIR, name)
        print("="*80)
        print(f"FILE: {name}  ({human(os.path.getsize(path))})")
        print("="*80)
        info = inspect_db(path)
        results.append((name, info))
        if "error" in info:
            print(f"  ERROR: {info['error']}")
            continue
        print(f"  Tables: {info['table_count']}")
        for t in info["tables"]:
            print(f"\n  --- TABLE: {t['name']}  | rows: {t['count']} ---")
            print(f"      columns ({len(t['columns'])}):")
            for c in t["columns"]:
                print(f"        - {c}")
            print(f"      PK: {t['pk'] if t['pk'] else '(none)'}")
            print(f"      UNIQUE: {t['unique'] if t['unique'] else '(none)'}")
            print(f"      SAMPLE (3 rows):")
            if not t["sample"] or (isinstance(t["sample"], list) and t["sample"] and isinstance(t["sample"][0], str)):
                print(f"        {t['sample']}")
            else:
                for i, r in enumerate(t["sample"]):
                    js = json.dumps(r, ensure_ascii=False, default=str)
                    if len(js) > 200:
                        js = js[:197] + "..."
                    print(f"        [{i}] {js}")
        print()

    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    print("\n[A] DBs WITH DATA (rows > 0 in at least one table):")
    for name, info in results:
        total = sum(t["count"] for t in info["tables"] if isinstance(t["count"], int))
        active = sum(1 for t in info["tables"] if isinstance(t["count"], int) and t["count"] > 0)
        empty = sum(1 for t in info["tables"] if isinstance(t["count"], int) and t["count"] == 0)
        print(f"  {name:<22} tables={info['table_count']:>3} active={active:>3} empty={empty:>3} total_rows={total:>10,}")

    print("\n[B] EMPTY TABLES (count=0):")
    for name, info in results:
        for t in info["tables"]:
            if t["count"] == 0:
                print(f"  {name}.{t['name']}")

    print("\n[C] TABLES APPEARING IN MULTIPLE DBs (duplicate storage):")
    table_locations = {}
    for name, info in results:
        for t in info["tables"]:
            table_locations.setdefault(t["name"], []).append(name)
    for tname, locs in sorted(table_locations.items()):
        if len(locs) > 1:
            print(f"  {tname:<35} -> {', '.join(locs)}")

    print("\n[D] SCHEMA MISMATCHES (same table name, different column sets across DBs):")
    for tname, locs in sorted(table_locations.items()):
        if len(locs) > 1:
            colsets = []
            for name, info in results:
                for t in info["tables"]:
                    if t["name"] == tname:
                        colsets.append((name, tuple(sorted(c.split(':')[0] for c in t["columns"]))))
            uniq_colsets = set(cs[1] for cs in colsets)
            if len(uniq_colsets) > 1:
                print(f"  [!] {tname}:")
                for nm, cs in colsets:
                    print(f"       {nm:<22} cols({len(cs)}): {', '.join(cs)}")

    print("\n[E] MISSING DBs (requested but not found):")
    for name in REQUESTED:
        if not os.path.exists(os.path.join(DB_DIR, name)):
            print(f"  [MISS] {name}")

if __name__ == "__main__":
    main()
