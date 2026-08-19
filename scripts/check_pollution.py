import sqlite3

print("=== data_engine.db.stocks — صفوف مشوهة (symbol يحتوي على مسافة) ===")
db = sqlite3.connect('db/data_engine.db')
db.row_factory = sqlite3.Row
rows = db.execute("SELECT symbol, name, price FROM stocks WHERE symbol LIKE '% %' LIMIT 15").fetchall()
for r in rows:
    print(f"  symbol='{r['symbol']}' | name='{r['name']}' | price={r['price']}")
polluted1 = db.execute("SELECT COUNT(*) FROM stocks WHERE symbol LIKE '% %'").fetchone()[0]
total1 = db.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
print(f"\n  الصفوف المشوهة: {polluted1} / {total1}")
print()
print("=== stocks.db.stocks — صفوف مشوهة ===")
db2 = sqlite3.connect('db/stocks.db')
db2.row_factory = sqlite3.Row
rows2 = db2.execute("SELECT ticker, name FROM stocks WHERE ticker LIKE '% %' LIMIT 15").fetchall()
for r in rows2:
    print(f"  ticker='{r['ticker']}' | name='{r['name']}'")
polluted2 = db2.execute("SELECT COUNT(*) FROM stocks WHERE ticker LIKE '% %'").fetchone()[0]
total2 = db2.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
print(f"\n  الصفوف المشوهة: {polluted2} / {total2}")
print()
print("=== تكرار symbol في data_engine ===")
dup = db.execute("SELECT symbol, COUNT(*) as c FROM stocks GROUP BY symbol HAVING c > 1 LIMIT 10").fetchall()
for r in dup:
    print(f"  symbol='{r['symbol']}' | count={r['c']}")
print(f"  إجمالي المكرر: {len(dup)}")
