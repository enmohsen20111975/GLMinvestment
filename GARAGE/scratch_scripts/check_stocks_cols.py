import sqlite3

conn_st = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
cols = [r[1] for r in conn_st.execute("PRAGMA table_info(stocks)").fetchall()]
print("stocks table columns with support/resist/target:")
for c in cols:
    if any(k in c for k in ['supp', 'resist', 'targ', 'stop']):
        print("  ", c)
