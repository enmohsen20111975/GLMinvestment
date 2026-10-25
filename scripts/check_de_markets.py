import sqlite3

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection('db/data_engine.db', writable=False).__enter__()
print('stocks markets:', conn.execute('SELECT market, COUNT(*) FROM stocks GROUP BY market').fetchall())
print('historical_data markets:', conn.execute('SELECT market, COUNT(*) FROM historical_data GROUP BY market').fetchall())
conn.close()
