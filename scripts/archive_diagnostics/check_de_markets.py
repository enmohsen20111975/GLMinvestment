import sqlite3

conn = sqlite3.connect('db/data_engine.db')
print('stocks markets:', conn.execute('SELECT market, COUNT(*) FROM stocks GROUP BY market').fetchall())
print('historical_data markets:', conn.execute('SELECT market, COUNT(*) FROM historical_data GROUP BY market').fetchall())
conn.close()
