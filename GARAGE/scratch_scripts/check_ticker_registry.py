import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
cur = conn.cursor()

total = cur.execute("SELECT count(*) FROM ticker_registry WHERE market='EGX'").fetchone()[0]
no_tv = cur.execute("SELECT count(*) FROM ticker_registry WHERE market='EGX' AND (tradingview_symbol IS NULL OR tradingview_symbol='')").fetchone()[0]
english_ar = cur.execute("SELECT count(*) FROM ticker_registry WHERE market='EGX' AND name_ar = name_en").fetchone()[0]
duplicates = cur.execute("""
    SELECT name_en, count(*) c, group_concat(canonical_ticker) 
    FROM ticker_registry 
    WHERE market='EGX' 
    GROUP BY name_en 
    HAVING c > 1
""").fetchall()

print(f'Total EGX in ticker_registry: {total}')
print(f'EGX with NO tradingview_symbol: {no_tv}')
print(f'EGX with name_ar == name_en (untranslated): {english_ar}')
print(f'Duplicate companies under different tickers: {len(duplicates)}')
for d in duplicates[:10]:
    print('  Duplicate:', d)
