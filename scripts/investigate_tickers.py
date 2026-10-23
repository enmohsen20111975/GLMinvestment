import sqlite3
import re
import os

print("=" * 70)
print("🔍 LIVE FORENSIC INVESTIGATION OF TICKERS AND NAMES ACROSS ALL DBS")
print("=" * 70)

# 1. price_history.db contamination
if os.path.exists('db/price_history.db'):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection('db/price_history.db', writable=False).__enter__()
    bad = conn_ph.execute("""
        SELECT DISTINCT ticker FROM price_history 
        WHERE LENGTH(ticker) > 6 OR ticker LIKE '% %' 
        OR ticker GLOB '*[A-Z][a-z]*[A-Z]*'
        ORDER BY ticker
    """).fetchall()
    print(f"\n1. Contaminated tickers in price_history.db: {len(bad)}")
    for b in bad[:25]:
        # Count rows for each
        cnt = conn_ph.execute("SELECT COUNT(*) FROM price_history WHERE ticker = ?", (b[0],)).fetchone()[0]
        print(f"   - '{b[0]}' ({cnt} rows)")
    conn_ph.close()

# 2. stocks.db name_ar investigation
if os.path.exists('db/stocks.db'):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_s = db_manager.connection('db/stocks.db', writable=False).__enter__()
    arabic_re = re.compile(r'[\u0600-\u06FF]')
    rows = conn_s.execute("SELECT ticker, name, name_ar, market FROM stocks WHERE market='EGX'").fetchall()
    english_in_ar = []
    none_ar = []
    for t, n, na, m in rows:
        if not na:
            none_ar.append(t)
        elif not arabic_re.search(na):
            english_in_ar.append((t, n, na))
    print(f"\n2. stocks.db EGX stocks:")
    print(f"   - Total EGX stocks: {len(rows)}")
    print(f"   - English text in name_ar: {len(english_in_ar)}")
    print(f"   - name_ar is None/Empty: {len(none_ar)}")
    print(f"   - Sample English name_ar:")
    for t, n, na in english_in_ar[:10]:
        print(f"     * {t:6s}: name='{n}' | name_ar='{na}'")
    conn_s.close()

# 3. data_engine.db market investigation
if os.path.exists('db/data_engine.db'):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_de = db_manager.connection('db/data_engine.db', writable=False).__enter__()
    # Check what tables exist in data_engine.db
    tables = [r[0] for r in conn_de.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"\n3. data_engine.db tables: {', '.join(tables[:15])}")
    if 'stocks' in tables:
        markets = conn_de.execute("SELECT market, COUNT(*) FROM stocks GROUP BY market").fetchall()
        print("   Markets in data_engine.db.stocks:")
        for m in markets:
            print(f"     * {m[0]}: {m[1]} rows")

        # Check if there are Arabic names in data_engine.db
        cols = [c[1] for c in conn_de.execute("PRAGMA table_info(stocks)").fetchall()]
        print(f"   Columns in data_engine.db.stocks: {cols}")
        ar_names = conn_de.execute("SELECT symbol, name FROM stocks WHERE name GLOB '*[ا-ي]*' LIMIT 5").fetchall()
        print(f"   Arabic names in data_engine.db.stocks: {len(ar_names)}")
        for r in ar_names:
            print("     *", r)
    conn_de.close()

# 4. Check market.db
if os.path.exists('db/market.db'):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_m = db_manager.connection('db/market.db', writable=False).__enter__()
    try:
        tables_m = [r[0] for r in conn_m.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        print(f"\n4. market.db tables: {', '.join(tables_m[:10])}")
        if 'stocks' in tables_m:
            ar_m = conn_m.execute("SELECT ticker, name_ar FROM stocks WHERE name_ar GLOB '*[ا-ي]*' LIMIT 5").fetchall()
            print(f"   Arabic names in market.db: {len(ar_m)}")
            for r in ar_m:
                print("     *", r)
    except Exception as e:
        print(f"   market.db error: {e}")
    finally:
        conn_m.close()

# 5. Check sharia_scrape_latest.json
if os.path.exists('db/sharia_scrape_latest.json'):
    import json
    with open('db/sharia_scrape_latest.json', 'r', encoding='utf-8') as f:
        sharia_data = json.load(f)
        print(f"\n5. sharia_scrape_latest.json: {len(sharia_data)} items")
        for item in list(sharia_data.items())[:5]:
            print(f"   - {item[0]}: {item[1].get('name_ar') or item[1].get('name')}")

