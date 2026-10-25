#!/usr/bin/env python3
"""
تحليل الـ audit الكامل من الإنتاج — نستخرج المعلومات المهمة بس.
"""
import json
from pathlib import Path

FILE = Path("/home/z/my-project/upload/Pasted Content_1792679089473.txt")

with open(FILE, encoding='utf-8') as f:
    data = json.load(f)

print("="*70)
print("تحليل الـ audit الكامل من الإنتاج")
print("="*70)

critical_dbs = ['price_history.db', 'data_engine.db', 'stocks.db', 'predictions.db']

for db_name in critical_dbs:
    if db_name not in data:
        continue
    db = data[db_name]
    print(f"\n{'='*70}")
    print(f"[{db_name}] ({db.get('size_mb', 0)} MB)")
    print(f"{'='*70}")
    print(f"  tables ({len(db.get('tables', []))}): {db.get('tables', [])}")
    print(f"  views: {len(db.get('views', []))}")
    print(f"  triggers: {len(db.get('triggers', []))}")
    print(f"  indexes: {len(db.get('indexes', []))}")

    if db.get('views'):
        print(f"\n  VIEWS:")
        for v in db['views']:
            print(f"     -> {v['name']}")
            sql = v.get('sql', '')
            print(f"       SQL: {sql[:300]}")

    if db.get('triggers'):
        print(f"\n  TRIGGERS (مهمة — ALTER TABLE ممكن يأثر عليها):")
        for t in db['triggers']:
            print(f"     -> {t['name']} (on {t.get('table', '?')})")
            sql = t.get('sql', '')
            print(f"       SQL: {sql[:400]}")

    if db.get('indexes'):
        print(f"\n  INDEXES:")
        for idx in db['indexes']:
            print(f"     -> {idx['name']} (on {idx.get('table', '?')})")

print(f"\n{'='*70}")
print(f"فحص الامان: هل فيه views/triggers بتـ query على price_history table؟")
print(f"{'='*70}")

dangerous = []
for db_name, db in data.items():
    for v in db.get('views', []):
        sql_lower = v.get('sql', '').lower()
        if 'price_history' in sql_lower and 'stock_daily_prices' not in sql_lower:
            dangerous.append((db_name, 'view', v['name'], v.get('sql', '')[:200]))
    for t in db.get('triggers', []):
        sql_lower = t.get('sql', '').lower()
        table_lower = t.get('table', '').lower()
        if 'price_history' in (sql_lower + ' ' + table_lower):
            dangerous.append((db_name, 'trigger', t['name'], t.get('sql', '')[:200]))

if not dangerous:
    print("  [OK] مفيش views/triggers بتـ query مباشرة على price_history table.")
    print("     (views بتـ query على stock_daily_prices في stocks.db — مش هتتأثر)")
else:
    print(f"  [DANGER] لقيت {len(dangerous)} views/triggers محتاجة فحص:")
    for db, kind, name, sql in dangerous:
        print(f"     -> {db} / {kind} / {name}")
        print(f"       SQL: {sql}")

print(f"\n{'='*70}")
print(f"فحص price_history table columns")
print(f"{'='*70}")

ph = data.get('price_history.db', {})
schemas = ph.get('table_schemas', {})

if 'price_history' in schemas:
    print(f"\n  price_history table columns:")
    for col in schemas['price_history']:
        print(f"     -> {col['name']:20s} type={col.get('type', '?'):10s} pk={col.get('pk', 0)}")

    col_names = [c['name'] for c in schemas['price_history']]
    if 'market' in col_names:
        print(f"\n  [OK] market column موجود — Phase 2 unify مش هيحتاج يضيفه")
    else:
        print(f"\n  [WARN] market column مش موجود — Phase 2 unify هيضيفه (متوقع)")

    rc = ph.get('row_counts', {}).get('price_history', 'unknown')
    print(f"\n  price_history row count: {rc:,}" if isinstance(rc, int) else f"  price_history row count: {rc}")
else:
    print(f"  [ERROR] price_history table مش موجود في price_history.db!")

print(f"\n{'='*70}")
print(f"الـ tables الاضافية في price_history.db")
print(f"{'='*70}")

tables = ph.get('tables', [])
print(f"\n  كل الـ tables: {tables}")
for t in tables:
    if t == 'sqlite_sequence':
        continue
    if t in schemas:
        cols = [c['name'] for c in schemas[t]]
        rc = ph.get('row_counts', {}).get(t, '?')
        print(f"\n  [{t}]:")
        print(f"     columns: {cols}")
        print(f"     rows: {rc:,}" if isinstance(rc, int) else f"     rows: {rc}")

print(f"\n{'='*70}")
print(f"الـ tables الاضافية في data_engine.db")
print(f"{'='*70}")

de = data.get('data_engine.db', {})
de_tables = de.get('tables', [])
print(f"\n  كل الـ tables ({len(de_tables)}): {de_tables}")
for t in de_tables:
    if t == 'sqlite_sequence':
        continue
    if t in de.get('table_schemas', {}):
        cols = [c['name'] for c in de['table_schemas'][t]]
        rc = de.get('row_counts', {}).get(t, '?')
        print(f"\n  [{t}]:")
        print(f"     columns: {cols}")
        print(f"     rows: {rc:,}" if isinstance(rc, int) else f"     rows: {rc}")

print(f"\n{'='*70}")
print(f"الملخص النهائي")
print(f"{'='*70}")

total_triggers = sum(len(db.get('triggers', [])) for db in data.values())
total_views = sum(len(db.get('views', [])) for db in data.values())
total_tables = sum(len(db.get('tables', [])) for db in data.values())

print(f"  اجمالي DBs: {len(data)}")
print(f"  اجمالي tables: {total_tables}")
print(f"  اجمالي views: {total_views}")
print(f"  اجمالي triggers: {total_triggers}")
print(f"  views/triggers خطيرة على price_history: {len(dangerous)}")

if not dangerous:
    print(f"\n  [READY] آمن للـ deployment (بعد backup)")
else:
    print(f"\n  [STOP] راجع الـ views/triggers الخطيرة قبل الـ deploy")
